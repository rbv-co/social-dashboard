// supabase/functions/_shared/rodada-de-mensagens.js
//
// Uma RODADA do robô de mensagens de abandono, com `sb` (Supabase) e `cliente` (Chatwoot)
// injetados: a edge só monta as dependências, e é aqui que a lógica é testada de verdade.
// Design: docs/superpowers/specs/2026-09-29-mensagem-de-abandono-design.md
import {
  decidirEnvio, formatarNomeCompleto, montarTemplateParams, normalizarTelefone, primeiroNome, validarConfig,
} from './mensagem-de-abandono.js'
import { classificarErro, ErroChatwoot } from './cliente-chatwoot.js'

/** Mostra o sufixo do link sem a chave secreta de recuperação (a resposta do cron fica em log). */
const amostraDoSufixo = (s) => s.replace(/(key=)[^&]*/i, '$1…')

/**
 * @returns {Promise<{status: number, corpo: object}>}
 * config: { modo, limite, atrasoMin, soPara, linkBase, templateNome, idioma, templateTexto, chatwoot }
 */
export async function processarRodada({ sb, cliente, config, agora = new Date() }) {
  const { modo } = config
  const seco = modo === 'seco'

  // 1) Configuração: falha FECHADA. Nada de lead é tocado com segredo ausente ou inválido.
  const problemas = validarConfig(config)
  if (problemas.length) return { status: 500, corpo: { ok: false, erro: 'config_invalida', problemas } }

  // Chamada ao banco que só LOGA o erro (o item já foi decidido; não há o que refazer aqui).
  const rpc = async (nome, args) => {
    const r = await sb.rpc(nome, args)
    if (r.error) console.error(`falha em ${nome}:`, r.error.message)
    return r
  }

  // O modo seco é só leitura: nem a "faxina" dos travados roda nele.
  if (!seco) await rpc('liberar_mensagens_travadas', {})

  const { data: linhas, error } = await sb.rpc('pegar_para_mensagem', {
    p_limite: config.limite,
    p_atraso_min: config.atrasoMin,
    p_reservar: !seco,
    p_ultimos11: modo === 'lista' ? config.soPara.map((n) => n.slice(-11)) : null,
  })
  if (error) return { status: 500, corpo: { ok: false, erro: 'falha_ao_pegar', detalhe: error.message } }
  const lote = linhas ?? []
  const devolverTodos = () => Promise.all(lote.map((l) => rpc('devolver_mensagem', { p_token: l.token, p_contar: false })))

  // 2) Bloqueados: só os telefones deste lote. ⚠️ Se a leitura FALHAR, não se envia nada: a lista
  //    de quem pediu para parar é a trava principal, e "não consegui ler" NÃO é "ninguém pediu".
  const telefones = [...new Set(lote.map((l) => normalizarTelefone(l.telefone)).filter(Boolean))]
  let bloqueados = new Set()
  if (telefones.length) {
    const r = await sb.from('contatos_sem_mensagem').select('telefone').in('telefone', telefones)
    if (r.error) {
      console.error('falha ao ler bloqueados; rodada abortada:', r.error.message)
      if (!seco) await devolverTodos()
      return { status: 500, corpo: { ok: false, erro: 'falha_bloqueados' } }
    }
    bloqueados = new Set((r.data ?? []).map((b) => b.telefone))
  }

  const resultado = []
  const pendentes = lote.map((l) => l.token)

  for (const linha of lote) {
    const d = decidirEnvio({ linha, bloqueados, agora, baseLink: config.linkBase })
    const curto = String(linha.token).slice(0, 8)

    if (seco) {
      resultado.push({
        token: curto, decisao: d.acao, motivo: 'motivo' in d ? d.motivo : null,
        telefone_final: 'telefone' in d ? d.telefone.slice(-4) : null,
        sufixo_amostra: 'sufixoUrl' in d ? amostraDoSufixo(d.sufixoUrl) : null,
      })
      continue
    }
    pendentes.splice(pendentes.indexOf(linha.token), 1)

    if (d.acao === 'ignorar') {
      await rpc('marcar_mensagem', { p_token: linha.token, p_status: 'ignorada', p_motivo: d.motivo })
      resultado.push({ token: curto, resultado: 'ignorada', motivo: d.motivo })
      continue
    }
    if (d.acao === 'esperar') {
      await rpc('devolver_mensagem', { p_token: linha.token, p_contar: false })
      resultado.push({ token: curto, resultado: 'esperando', motivo: d.motivo })
      continue
    }

    try {
      const contatoId = await cliente.acharOuCriarContato({ nome: formatarNomeCompleto(d.nome), telefone: d.telefone })
      const conversaId = await cliente.abrirConversa({ contatoId, telefone: d.telefone })
      const texto = (config.templateTexto || `[template ${config.templateNome}]`).replace('{{1}}', primeiroNome(d.nome))
      await cliente.enviarTemplate({
        conversaId, texto,
        templateParams: montarTemplateParams({ nomeTemplate: config.templateNome, idioma: config.idioma, nome: d.nome, sufixoUrl: d.sufixoUrl }),
      })
      // ⚠️ A mensagem JÁ SAIU. Se gravar falhar, não devolve nem reenvia: o item fica `enviando` e,
      // passados 10 min, vira `falhou/travada_sem_confirmacao` (visível), nunca uma segunda mensagem.
      const gravou = await rpc('marcar_mensagem', { p_token: linha.token, p_status: 'enviada', p_conversa: conversaId })
      resultado.push({ token: curto, resultado: gravou.error ? 'enviada_sem_gravar' : 'enviada' })
    } catch (e) {
      const tipo = classificarErro(e)
      const detalhe = e instanceof ErroChatwoot
        ? `${e.passo}:${e.status} ${JSON.stringify(e.corpo ?? '').slice(0, 160)}`
        : String(e).slice(0, 160)
      if (tipo === 'parar') {
        // Credencial/permissão: o problema não é do lead. Devolve este e os que sobraram, sem contar tentativa.
        for (const t of [linha.token, ...pendentes]) await rpc('devolver_mensagem', { p_token: t, p_contar: false })
        console.error('chatwoot recusou a credencial; rodada interrompida:', detalhe)
        return { status: 502, corpo: { ok: false, erro: 'credencial_recusada', detalhe, resultado } }
      }
      if (tipo === 'tentar_de_novo') await rpc('devolver_mensagem', { p_token: linha.token, p_contar: true })
      else await rpc('marcar_mensagem', { p_token: linha.token, p_status: 'falhou', p_motivo: detalhe })
      resultado.push({ token: curto, resultado: tipo === 'falhou' ? 'falhou' : 'tentar_de_novo', detalhe })
    }
  }

  return { status: 200, corpo: { ok: true, modo, quantidade: resultado.length, resultado } }
}
