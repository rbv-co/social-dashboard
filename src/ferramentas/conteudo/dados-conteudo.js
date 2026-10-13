// Conversa com o banco e com o depósito de arquivos.
//
// Fica separado das telas por dois motivos: as telas continuam pequenas (regra
// desta ferramenta), e todo lugar que grava passa pelo mesmo caminho — inclusive
// o registro na trilha de eventos, que é fácil de esquecer quando cada botão
// escreve por conta própria.
//
// Este arquivo NÃO é testável em node (importa a cadeia do Supabase, que lê
// `window`). O que precisa de teste mora nos módulos puros ao lado.

import { sbClient } from '../../compartilhado/conectar-no-banco-de-dados.js'
// Chave `admin` (Plano 7): `profiles` pela API (5.1).
import { deOnde } from '../../compartilhado/banco-pela-api.js'
import { estado } from '../../compartilhado/controle-de-login-e-usuario.js'
import { deCampoDeDataHora } from './grade-do-calendario.js'

export const BUCKET = 'conteudo'

// Esquecer uma coluna aqui NÃO dá erro: o campo chega `undefined` e a tela
// simplesmente não mostra aquilo. Já aconteceu com `conteudo_usa_portal`, que
// fazia a caixinha do Portal nascer desmarcada mesmo para quem o usava.
const CAMPOS_PECA =
  'id,account_id,titulo,formato,status,legenda,hashtags,observacoes,' +
  'publicar_em,publicado_em,avisado_em,ig_media_id,ig_permalink,responsavel,' +
  'criado_por,aprovado_por,aprovado_em,motivo_reprovacao,created_at,updated_at'

function _uid() {
  return estado.currentSession?.user?.id || null
}

// Duas consultas montam filtro do PostgREST por texto (`.or('account_id.eq.X,...')`),
// que é o único jeito de dizer "desta marca OU de todas". Texto colado em filtro
// pede confirmação de formato: um valor com vírgula ou parêntese mudaria a
// lógica do filtro, não só o valor.
//
// Hoje isso não daria acesso a nada — o RLS destas tabelas não separa por marca
// (nenhuma tabela do projeto separa; a restrição por `allowed_accounts` é só de
// front em todo o sistema). É defesa para o dia em que separar.
function _idDeConta(id) {
  if (!/^[0-9a-fA-F-]{36}$/.test(String(id || ''))) {
    throw new Error('Perfil inválido.')
  }
  return id
}

// O front tem DOIS campos de permissão que precisam concordar: `permissions`
// (que hasPermission lê) e `features` (que o RLS lê). Quando eles divergem, o
// banco devolve lista vazia e a tela diz "nenhuma peça ainda" — que é a mentira
// mais cara possível, porque parece funcionamento normal. Esta função existe só
// para a tela poder dizer a verdade: "sua permissão está pela metade".
export function permissaoIncompleta() {
  if (estado.is_superadmin || estado.role === 'admin') return false
  const veNoFront = (estado.permissions?.conteudo || []).includes('ver')
  const veNoBanco = (estado.features || []).includes('conteudo')
  return veNoFront && !veNoBanco
}

export function podeAprovar() {
  if (estado.is_superadmin || estado.role === 'admin') return true
  return (estado.permissions?.['conteudo.aprovar'] || []).includes('ver')
}

// ── Leitura ─────────────────────────────────────────────────────────────────

export async function listarContas() {
  const { data, error } = await deOnde(sbClient)
    .from('accounts')
    // `conteudo_usa_portal` alimenta a caixinha do painel "A marca". Sem ela o
    // campo chega undefined e a caixa nasce desmarcada mesmo para quem usa o
    // Portal — o usuário desmarcaria algo que já estava ligado sem perceber.
    .select('id,name,username,accent_color,profile_picture_url,picture_url,conteudo_usa_portal')
    .order('name')
  if (error) throw new Error(`Não consegui carregar os perfis: ${error.message}`)

  // allowed_accounts null = todos. Superadmin sempre vê todos.
  const permitidas = estado.is_superadmin ? null : (estado.allowed_accounts ?? null)
  if (!Array.isArray(permitidas)) return data || []
  return (data || []).filter(c => permitidas.includes(c.id))
}

export async function listarPecas(accountId) {
  let q = sbClient.from('conteudo_pecas').select(CAMPOS_PECA)
  if (accountId) q = q.eq('account_id', accountId)
  const { data, error } = await q.order('publicar_em', { ascending: true, nullsFirst: false })
  if (error) throw new Error(`Não consegui carregar as peças: ${error.message}`)
  return data || []
}

export async function carregarPeca(id) {
  const { data, error } = await sbClient.from('conteudo_pecas').select(CAMPOS_PECA).eq('id', id).maybeSingle()
  if (error) throw new Error(`Não consegui carregar a peça: ${error.message}`)
  return data
}

export async function listarArquivos(pecaId) {
  const { data, error } = await sbClient
    .from('conteudo_arquivos')
    .select('id,peca_id,ordem,bucket,caminho,tipo,mime,bytes')
    .eq('peca_id', pecaId)
    .order('ordem')
  if (error) throw new Error(`Não consegui carregar os arquivos: ${error.message}`)
  return data || []
}

// A miniatura de cada peça: o primeiro arquivo, para todas as peças de uma vez.
// Uma consulta e um lote de assinaturas — não 40 idas ao servidor num mês cheio.
// Devolve { peca_id: url }; peça sem imagem simplesmente não aparece no objeto.
export async function miniaturasDasPecas(pecaIds) {
  if (!pecaIds?.length) return {}
  const { data, error } = await sbClient
    .from('conteudo_arquivos')
    .select('peca_id,caminho,tipo')
    .in('peca_id', pecaIds)
    .eq('ordem', 1)
    .eq('tipo', 'imagem')
  if (error) return {}

  const urls = await urlsAssinadas((data || []).map(a => a.caminho))
  return Object.fromEntries(
    (data || []).map(a => [a.peca_id, urls[a.caminho]]).filter(([, u]) => u),
  )
}

// A medição mais recente de cada peça, para o rodapé do cartão. Uma consulta
// para a lista toda — não uma por cartão.
export async function metricasDasPecas(pecaIds) {
  if (!pecaIds?.length) return {}
  const { data, error } = await sbClient
    .from('conteudo_metricas')
    .select('peca_id,capturado_em,curtidas,comentarios,alcance,salvamentos,compartilhamentos,visualizacoes')
    .in('peca_id', pecaIds)
    .order('capturado_em', { ascending: false })
  if (error) return {}

  // A consulta vem ordenada do mais novo para o mais velho, então a primeira
  // linha de cada peça é a leitura mais recente.
  const saida = {}
  for (const m of data || []) if (!saida[m.peca_id]) saida[m.peca_id] = m
  return saida
}

// As perguntas esperando resposta ("É este post?"). Só as sugestões — o que já
// foi confirmado virou vínculo na peça, e o recusado não volta.
export async function sugestoesDeCasamento(pecaIds) {
  if (!pecaIds?.length) return {}
  const { data, error } = await sbClient
    .from('conteudo_casamentos')
    .select('id,peca_id,ig_media_id,ig_permalink,ig_timestamp,ig_caption,ig_thumb,pontuacao,motivo')
    .in('peca_id', pecaIds)
    .eq('situacao', 'sugerido')
    .order('pontuacao', { ascending: false })
  if (error) return {}

  const saida = {}
  for (const c of data || []) if (!saida[c.peca_id]) saida[c.peca_id] = c
  return saida
}

export async function decidirCasamento(casamentoId, confirma) {
  const { data, error } = await sbClient.rpc('conteudo_decidir_casamento', {
    p_casamento: casamentoId, p_confirma: confirma,
  })
  if (error) throw new Error(error.message.replace(/^.*?:\s*/, ''))
  return Array.isArray(data) ? data[0] : data
}

export async function listarEventos(pecaId) {
  const { data, error } = await sbClient
    .from('conteudo_eventos')
    .select('id,de,para,acao,detalhe,quem,quando')
    .eq('peca_id', pecaId)
    .order('quando', { ascending: false })
  if (error) throw new Error(`Não consegui carregar o histórico: ${error.message}`)
  return data || []
}

// ── Escrita ─────────────────────────────────────────────────────────────────

export async function registrarEvento(pecaId, { de = null, para = null, acao, detalhe = null }) {
  // A trilha não pode derrubar a ação principal: se o evento falhar, a peça já
  // mudou de estado e reverter seria pior. Registra o problema e segue.
  const { error } = await sbClient.from('conteudo_eventos').insert({
    peca_id: pecaId, de, para, acao, detalhe, quem: _uid(),
  })
  if (error) console.warn('[conteudo] não consegui registrar o evento:', error.message)
}

export async function criarPeca(dados) {
  const { data, error } = await sbClient
    .from('conteudo_pecas')
    .insert({ ...dados, criado_por: _uid() })
    .select(CAMPOS_PECA)
    .single()
  if (error) throw new Error(`Não consegui criar a peça: ${error.message}`)
  await registrarEvento(data.id, { para: data.status, acao: 'criou' })
  return data
}

export async function atualizarPeca(id, campos) {
  const { data, error } = await sbClient
    .from('conteudo_pecas')
    .update(campos)
    .eq('id', id)
    .select(CAMPOS_PECA)
    .single()
  if (error) throw new Error(`Não consegui salvar: ${error.message}`)
  return data
}

// Mudança de estado que NÃO é aprovar/reprovar (essas passam pela RPC abaixo).
export async function mudarStatus(peca, novoStatus, extras = {}) {
  const campos = { status: novoStatus, ...extras }
  // Reagendar tem que limpar a marca de avisado, senão a peça remarcada nunca
  // mais dispara push (o cron só olha quem tem avisado_em nulo).
  if (novoStatus === 'agendada') campos.avisado_em = null
  if (novoStatus === 'publicada' && !campos.publicado_em) campos.publicado_em = new Date().toISOString()

  // DESAGENDAR TAMBÉM LIMPA A MARCA DE AVISADO.
  //
  // A data FICA de propósito: quem desagenda quase sempre quer pausar, não
  // perder o horário que escolheu — e a faixa "Sai a seguir" agora avisa que
  // falta agendar, em vez de fingir que a peça vai sair.
  //
  // Mas a marca de avisado tem de sair: uma peça avisada, desagendada e
  // reagendada mais tarde continuaria marcada como já avisada, e o robô da
  // hora H — que só olha quem tem o campo nulo — nunca mais tocaria nela.
  //
  // Só ao VOLTAR para antes do agendamento. Ao publicar ou arquivar, a marca
  // fica: ela é o registro de que o aviso saiu, e apagá-la perderia isso sem
  // ganhar nada (peça publicada não recebe aviso de qualquer jeito).
  const ANTES_DE_AGENDAR = ['rascunho', 'em_aprovacao', 'aprovada', 'reprovada']
  if (peca.status === 'agendada' && ANTES_DE_AGENDAR.includes(novoStatus)) {
    campos.avisado_em = null
  }

  const atualizada = await atualizarPeca(peca.id, campos)
  await registrarEvento(peca.id, { de: peca.status, para: novoStatus, acao: 'mudou_status' })
  return atualizada
}

// Aprovar/reprovar vai pela função do banco: ela valida a permissão, impede que
// dois aprovadores decidam a mesma peça e grava o evento na mesma transação.
// Quem pode ser responsável por uma peça: quem consegue abrir a ferramenta.
//
// Não filtra por quem tem o AVISO ligado de propósito. Escolher alguém que ainda
// não ligou é legítimo — a notificação nasce desmarcada e a pessoa liga depois.
// Esconder essa gente da lista faria parecer que ela não existe.
export async function listarPessoas() {
  const { data, error } = await deOnde(sbClient)
    .from('profiles')
    .select('id,email,name,role,is_superadmin,features')
    .order('email')
  if (error) return []
  return (data || [])
    .filter(p => p.role === 'admin' || p.is_superadmin || (p.features || []).includes('conteudo'))
    .map(p => ({ id: p.id, nome: p.name || p.email, email: p.email }))
}

// APROVAR JÁ AGENDANDO, num passo.
//
// Passa por função do banco e não por `mudarStatus` porque a trigger que guarda
// a aprovação só vigia a entrada em 'aprovada'/'reprovada'. Um caminho comum
// em_aprovacao → agendada seria um UPDATE simples e pularia o guardião — ou
// seja, qualquer pessoa com acesso poria conteúdo na fila sem ninguém aprovar.
export async function aprovarEAgendar(pecaId) {
  const { data, error } = await sbClient.rpc('conteudo_aprovar_e_agendar', { p_peca: pecaId })
  if (error) throw new Error(error.message)
  return data
}

export async function decidir(pecaId, decisao, motivo = null) {
  const { data, error } = await sbClient.rpc('conteudo_decidir', {
    p_peca: pecaId, p_decisao: decisao, p_motivo: motivo,
  })
  if (error) throw new Error(error.message.replace(/^.*?:\s*/, ''))
  return Array.isArray(data) ? data[0] : data
}

// ── Ideias ──────────────────────────────────────────────────────────────────

// Ideias da marca + as que valem para todas (account_id nulo).
export async function listarIdeias(accountId) {
  const { data, error } = await sbClient
    .from('conteudo_ideias')
    // As colunas do roteiro completo (producao/cta/porque_formato) entram aqui.
    // Esquecer uma não dá erro nenhum: o campo chega `undefined` e o painel
    // simplesmente não mostra a seção. Se algo sumir do roteiro aberto, é a
    // primeira linha a conferir.
    .select(
      'id,account_id,titulo,gancho,formato,pilar,roteiro,producao,porque_formato,cta,'
      + 'legenda_sugerida,hashtags_sugeridas,por_que_agora,origem,situacao,peca_id,created_at',
    )
    .or(`account_id.eq.${_idDeConta(accountId)},account_id.is.null`)
    .neq('situacao', 'descartada')
    .order('created_at', { ascending: false })
  if (error) throw new Error(`Não consegui carregar as ideias: ${error.message}`)
  return data || []
}

export async function criarIdeia(dados) {
  const { data, error } = await sbClient
    .from('conteudo_ideias')
    .insert({ ...dados, origem: 'manual', criado_por: _uid() })
    .select('*').single()
  if (error) throw new Error(`Não consegui salvar a ideia: ${error.message}`)
  return data
}

// Editar uma ideia. Vale tanto para arrumar o que a IA escreveu quanto para
// continuar uma que foi anotada à mão pela metade.
//
// `origem` NÃO é tocada de propósito: se a IA sugeriu, ela continua marcada
// como sugestão da IA mesmo depois de a pessoa reescrever — o selo conta de
// onde a ideia nasceu, não quem digitou por último.
// Ligar a peça ao post real na mão, colando o link.
//
// A SAÍDA QUE NÃO EXISTIA: o casamento automático só acontece se o robô achar e
// propuser. Quando ele não acha — publicação fora da janela, legenda muito
// reescrita, story (que a Meta não devolve de forma confiável) — a peça ficava
// sem métrica para sempre e não havia o que fazer na tela.
export async function casarNaMao(pecaId, linkOuCodigo) {
  const { data, error } = await sbClient.rpc('conteudo_casar_na_mao', {
    p_peca: pecaId,
    p_media: linkOuCodigo,
  })
  if (error) throw new Error(error.message)
  return data
}

export async function atualizarIdeia(id, campos) {
  const { data, error } = await sbClient
    .from('conteudo_ideias')
    .update(campos)
    .eq('id', id)
    .select('*').single()
  if (error) throw new Error(`Não consegui salvar a ideia: ${error.message}`)
  return data
}

export async function mudarSituacaoDaIdeia(id, situacao) {
  const { error } = await sbClient.from('conteudo_ideias').update({ situacao }).eq('id', id)
  if (error) throw new Error(`Não consegui atualizar: ${error.message}`)
}

// A ideia vira rascunho. Passa por função do banco para que criar a peça,
// marcar a ideia como usada e ligar as duas aconteça de uma vez só.
export async function ideiaViraPeca(ideiaId, accountId, publicarEm = null) {
  const { data, error } = await sbClient.rpc('conteudo_ideia_virar_peca', {
    p_ideia: ideiaId, p_account: accountId, p_publicar_em: publicarEm,
  })
  if (error) throw new Error(error.message.replace(/^.*?:\s*/, ''))
  return Array.isArray(data) ? data[0] : data
}

export async function pedirIdeiasParaIA(accountId, quantas = 12) {
  return _pedirAIA({ account_id: accountId, quantas, modo: 'ideias' })
}

// Pedir a SEMANA montada. Mesma fila e mesmo disparador do robô de pauta: muda
// o `modo`, que escolhe qual script roda lá no Actions.
export async function pedirSemanaParaIA(accountId, segunda) {
  return _pedirAIA({ account_id: accountId, modo: 'semana', segunda })
}

async function _pedirAIA(corpo) {
  const { data, error } = await sbClient.functions.invoke('conteudo-trigger', {
    body: corpo,
  })
  if (error) {
    // O corpo do erro traz o motivo real (ex.: já tem rodada em andamento).
    const detalhe = await error.context?.json?.().catch(() => null)
    if (detalhe?.error === 'ja_rodando') throw new Error('Já tem uma rodada em andamento para esta marca. Espere ela terminar.')
    if (detalhe?.error === 'sem_permissao') throw new Error('Você não tem permissão para pedir isso à IA.')
    throw new Error(detalhe?.detail || error.message || 'Não consegui falar com a IA.')
  }
  return data
}

// O PLANO ACEITO VIRA PEÇAS.
//
// Uma peça por slot, em rascunho e com data marcada — nunca já agendada: a arte
// ainda não existe, e uma peça agendada sem arte dispararia o aviso da hora H
// com as mãos vazias.
//
// Quem veio do banco carrega a legenda e as hashtags que a ideia já tinha, e a
// ideia é marcada como usada. Quem é pauta nova nasce só com título e legenda
// do gancho — o resto se escreve na peça.
export async function planoViraPecas(accountId, slots) {
  const criadas = []
  for (const s of Array.isArray(slots) ? slots : []) {
    const ideia = s.ideia || null
    const titulo = ideia?.titulo || s.titulo_novo
    if (!titulo || !s.data) continue

    const peca = await criarPeca({
      account_id: accountId,
      titulo,
      formato: s.formato || ideia?.formato || 'feed',
      legenda: ideia?.legenda_sugerida || s.gancho_novo || '',
      hashtags: ideia?.hashtags_sugeridas || '',
      // A data vem do plano em horário de Brasília; `deCampoDeDataHora` faz a
      // conversão que o resto da ferramenta já usa.
      publicar_em: _instanteDoSlot(s),
      observacoes: s.porque_neste_dia || null,
    })
    criadas.push(peca)

    if (ideia?.id) {
      // Não usa `ideiaViraPeca` porque a peça já foi criada aqui, com os campos
      // do plano; aquela função cria uma peça vazia por conta própria.
      await sbClient.from('conteudo_ideias')
        .update({ situacao: 'usada', peca_id: peca.id })
        .eq('id', ideia.id)
    }
  }
  return criadas
}

// "2026-08-03" + "19:00" → o instante em UTC. Passa pelo mesmo caminho do campo
// de data da peça para não haver duas conversões de fuso diferentes na
// ferramenta — que é como nasce um post agendado três horas fora.
function _instanteDoSlot(slot) {
  const hora = /^\d{2}:\d{2}$/.test(slot?.hora || '') ? slot.hora : '12:00'
  return deCampoDeDataHora(`${slot.data}T${hora}`)
}

export async function verJob(jobId) {
  const { data, error } = await sbClient
    .from('conteudo_jobs').select('id,status,resultado,erro').eq('id', jobId).maybeSingle()
  if (error) return null
  return data
}

// ── Blocos de texto ─────────────────────────────────────────────────────────

export async function listarBlocos(accountId) {
  const { data, error } = await sbClient
    .from('conteudo_blocos')
    .select('id,account_id,tipo,nome,texto,usos,ativo')
    .or(`account_id.eq.${_idDeConta(accountId)},account_id.is.null`)
    .eq('ativo', true)
    .order('tipo')
  if (error) return []
  return data || []
}

export async function salvarBloco(bloco) {
  const { data, error } = await sbClient
    .from('conteudo_blocos')
    .upsert({ ...bloco, criado_por: bloco.id ? undefined : _uid() })
    .select('*').single()
  if (error) throw new Error(`Não consegui salvar o bloco: ${error.message}`)
  return data
}

export async function apagarBloco(id) {
  const { error } = await sbClient.from('conteudo_blocos').update({ ativo: false }).eq('id', id)
  if (error) throw new Error(`Não consegui remover: ${error.message}`)
}

// ── Concorrentes da marca ────────────────────────────────────────────────────
//
// Concorrente é de cada marca, nunca do sistema. O robô de pauta puxava o Portal
// de Notícias (moda e calçado) para TODA conta, e a primeira pauta do Breno Vale
// saiu citando @Isla e @Santa Lolla como concorrentes dele.

export async function listarConcorrentes(accountId) {
  const { data, error } = await sbClient
    .from('conteudo_concorrentes')
    .select('id,account_id,handle,nome,observacao,ativo')
    .eq('account_id', _idDeConta(accountId))
    .eq('ativo', true)
    .order('nome')
  if (error) return []
  return data || []
}

export async function salvarConcorrente(concorrente) {
  const { data, error } = await sbClient
    .from('conteudo_concorrentes')
    .upsert(concorrente)
    .select('*').single()
  if (error) {
    // 23505 = o mesmo @ já está cadastrado nesta marca. O aviso genérico do
    // Postgres não diz nada a quem está preenchendo o formulário.
    if (error.code === '23505') throw new Error('Esse @ já está na lista desta marca.')
    throw new Error(`Não consegui salvar o concorrente: ${error.message}`)
  }
  return data
}

export async function apagarConcorrente(id) {
  const { error } = await sbClient.from('conteudo_concorrentes').update({ ativo: false }).eq('id', id)
  if (error) throw new Error(`Não consegui remover: ${error.message}`)
}

// Liga/desliga o Portal de Notícias para esta marca. Só faz sentido para quem é
// do nicho que o Portal cobre — hoje, moda e calçado.
export async function mudarUsoDoPortal(accountId, usa) {
  const { error } = await deOnde(sbClient)
    .from('accounts')
    .update({ conteudo_usa_portal: !!usa })
    .eq('id', _idDeConta(accountId))
  if (error) throw new Error(`Não consegui mudar o Portal de Notícias: ${error.message}`)
}

// Pede o aviso da hora H de novo. A Edge carimba `avisado_em` ANTES de enviar
// (para não avisar duas vezes), então um push perdido no caminho fica sem
// segunda chance — este é o botão que dá.
export async function reavisar(pecaId) {
  const { data, error } = await sbClient.rpc('conteudo_reavisar', { p_peca: pecaId })
  if (error) throw new Error(error.message.replace(/^.*?:\s*/, ''))
  return Array.isArray(data) ? data[0] : data
}

export async function excluirPeca(pecaId) {
  // Os arquivos do depósito não somem sozinhos com o `on delete cascade` da
  // tabela — o Storage é outro mundo. Apaga primeiro, senão viram lixo eterno.
  const arquivos = await listarArquivos(pecaId).catch(() => [])
  if (arquivos.length) {
    await sbClient.storage.from(BUCKET).remove(arquivos.map(a => a.caminho))
  }
  const { error } = await sbClient.from('conteudo_pecas').delete().eq('id', pecaId)
  if (error) throw new Error(`Não consegui excluir: ${error.message}`)
}

// ── Arquivos ────────────────────────────────────────────────────────────────

function _extensao(nome) {
  const m = String(nome || '').match(/\.([a-z0-9]+)$/i)
  return m ? m[1].toLowerCase() : 'bin'
}

function _slug(nome) {
  return String(nome || 'arquivo')
    .replace(/\.[^.]+$/, '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 40) || 'arquivo'
}

export async function subirArquivo(peca, file, ordem) {
  const caminho = `${peca.account_id}/${peca.id}/${ordem}-${_slug(file.name)}.${_extensao(file.name)}`

  const { error: erroUp } = await sbClient.storage
    .from(BUCKET)
    .upload(caminho, file, { upsert: true, contentType: file.type })
  if (erroUp) throw new Error(`Não consegui enviar ${file.name}: ${erroUp.message}`)

  const { data, error } = await sbClient
    .from('conteudo_arquivos')
    .insert({
      peca_id: peca.id,
      ordem,
      bucket: BUCKET,
      caminho,
      tipo: file.type.startsWith('video/') ? 'video' : 'imagem',
      mime: file.type,
      bytes: file.size,
    })
    .select('id,peca_id,ordem,bucket,caminho,tipo,mime,bytes')
    .single()
  if (error) {
    // Não deixa o arquivo órfão no depósito se a linha não entrou.
    await sbClient.storage.from(BUCKET).remove([caminho])
    throw new Error(`Enviei ${file.name} mas não consegui registrar: ${error.message}`)
  }
  return data
}

// DUPLICAR UMA PEÇA, com a arte junto.
//
// POR QUE ISTO EXISTE: conteúdo real é repetitivo. "O mesmo carrossel do mês
// passado com outro produto" é o caso mais comum de todos, e sem isto a pessoa
// refazia tudo do zero — inclusive subindo os arquivos de novo.
//
// A CÓPIA NASCE EM RASCUNHO E SEM DATA. Herdar a data criaria dois posts no
// mesmo horário, que é o oposto do que quem duplica quer. E herdar o status
// colocaria no ar, sem revisão, algo que ninguém leu.
export async function duplicarPeca(peca) {
  const nova = await criarPeca({
    account_id: peca.account_id,
    titulo: `${peca.titulo || 'Peça'} (cópia)`,
    formato: peca.formato,
    legenda: peca.legenda || '',
    hashtags: peca.hashtags || '',
    observacoes: peca.observacoes || null,
    publicar_em: null,
  })

  const arquivos = await listarArquivos(peca.id)
  const copiados = []
  for (const a of arquivos) {
    // O caminho carrega o id da peça; sem trocar, as duas apontariam para o
    // MESMO objeto no depósito — e apagar uma levaria a arte da outra junto.
    const destino = a.caminho.replace(`/${peca.id}/`, `/${nova.id}/`)

    // SE A TROCA NÃO ACONTECEU, NÃO COPIA. Um caminho fora do padrão (arquivo
    // antigo, importado à mão) sairia idêntico daqui, e a linha nova apontaria
    // para o objeto da peça ORIGINAL. Ninguém veria nada de errado — até
    // alguém apagar a cópia e a arte sumir das duas.
    if (destino === a.caminho) continue

    const { error: erroCopia } = await sbClient.storage.from(BUCKET).copy(a.caminho, destino)
    if (erroCopia) continue   // um arquivo que falha não impede os outros

    const { data, error } = await sbClient.from('conteudo_arquivos').insert({
      peca_id: nova.id,
      ordem: a.ordem,
      bucket: a.bucket,
      caminho: destino,
      tipo: a.tipo,
      mime: a.mime,
      bytes: a.bytes,
    }).select('id').single()
    if (error) {
      // Não deixa cópia órfã no depósito se a linha não entrou.
      await sbClient.storage.from(BUCKET).remove([destino])
      continue
    }
    copiados.push(data)
  }

  await registrarEvento(nova.id, {
    acao: 'duplicou',
    detalhe: `Cópia de "${peca.titulo || 'sem título'}"${copiados.length ? ` com ${copiados.length} arquivo(s)` : ''}.`,
  })

  return { peca: nova, arquivos: copiados.length, arquivosOriginais: arquivos.length }
}

export async function removerArquivo(arquivo) {
  await sbClient.storage.from(BUCKET).remove([arquivo.caminho])
  const { error } = await sbClient.from('conteudo_arquivos').delete().eq('id', arquivo.id)
  if (error) throw new Error(`Não consegui remover o arquivo: ${error.message}`)
}

export async function trocarOrdem(arquivoId, novaOrdem) {
  const { error } = await sbClient.from('conteudo_arquivos').update({ ordem: novaOrdem }).eq('id', arquivoId)
  if (error) throw new Error(`Não consegui reordenar: ${error.message}`)
}

// O bucket é PRIVADO: arte que ainda não foi publicada não pode ter URL
// adivinhável. Toda exibição passa por um link assinado de validade curta.
export async function urlAssinada(caminho, segundos = 3600) {
  const { data, error } = await sbClient.storage.from(BUCKET).createSignedUrl(caminho, segundos)
  if (error) return null
  return data?.signedUrl || null
}

// URL que BAIXA em vez de abrir.
//
// A diferença é o `download` na assinatura: ele faz o depósito responder com
// Content-Disposition: attachment, e aí o navegador salva o arquivo.
//
// O atributo `download` de um link NÃO resolveria isto: ele é ignorado quando o
// arquivo está em outro domínio — e o nosso está, no domínio do Supabase. Sem
// esse parâmetro, o que acontece é abrir uma aba com a imagem, que no iPhone
// ainda esbarra no bloqueador de pop-up a partir do segundo arquivo.
export async function urlParaBaixar(caminho, nome, segundos = 3600) {
  const { data, error } = await sbClient.storage
    .from(BUCKET)
    .createSignedUrl(caminho, segundos, { download: nome || true })
  if (error) return null
  return data?.signedUrl || null
}

export async function urlsAssinadas(caminhos, segundos = 3600) {
  if (!caminhos?.length) return {}
  const { data, error } = await sbClient.storage.from(BUCKET).createSignedUrls(caminhos, segundos)
  if (error) return {}
  return Object.fromEntries((data || []).map(d => [d.path, d.signedUrl]))
}
