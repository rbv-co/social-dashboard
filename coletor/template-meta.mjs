// coletor/template-meta.mjs
// Consulta e cria modelos de mensagem do WhatsApp pela API da Meta (Graph API).
//
//   Ver o modelo A (status, categoria, motivo de recusa e a ORDEM dos botões):
//     META_WABA_ID=... META_TOKEN=... node coletor/template-meta.mjs consultar recuperacao_checkout_v1
//
//   Criar o modelo A (recuperacao_checkout_v1) ou o B (recuperacao_checkout_v2). Sem --enviar só
//   MOSTRA o que seria enviado:
//     node coletor/template-meta.mjs criar a
//     META_WABA_ID=... META_TOKEN=... node coletor/template-meta.mjs criar a --enviar
//   A Meta trava o NOME de um modelo já usado (mesmo recusado ou apagado). Se ela disser que o nome
//   já existe, crie o mesmo texto com outro nome:  criar a --nome=recuperacao_checkout_a2 --enviar
//   (e use o nome novo em TEMPLATE_NOME, o segredo do robô).
//
// META_WABA_ID = id da conta do WhatsApp Business. META_TOKEN = token de acesso com permissão
// whatsapp_business_management (de um usuário do sistema). Quem passa é o dono, pelo ambiente:
// nunca coloque o token neste arquivo. O token nunca é impresso.
import { montarTemplate, validarTemplate, TEMPLATE_A, TEMPLATE_B } from '../supabase/functions/_shared/template-meta.js'

const e = process.env
const VERSAO = e.META_API_VERSION || 'v21.0'
const [, , comando, argumento] = process.argv
const enviar = process.argv.includes('--enviar')

const falhar = (msg, codigo = 1) => { console.error(msg); process.exit(codigo) }
const exigirAmbiente = () => {
  if (!e.META_WABA_ID || !e.META_TOKEN) falhar('Defina META_WABA_ID e META_TOKEN no ambiente.')
}
async function graph(caminho, { metodo = 'GET', corpo } = {}) {
  const r = await fetch(`https://graph.facebook.com/${VERSAO}/${e.META_WABA_ID}${caminho}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${e.META_TOKEN}`, 'Content-Type': 'application/json' },
    body: corpo ? JSON.stringify(corpo) : undefined,
    signal: AbortSignal.timeout(20000),
  })
  const json = await r.json().catch(() => ({}))
  if (!r.ok) {
    const err = json.error ?? {}
    falhar(`A Meta recusou (HTTP ${r.status}): ${err.error_user_msg ?? err.message ?? 'sem detalhe'} [code ${err.code ?? '?'}, fbtrace ${err.fbtrace_id ?? '?'}]`, 2)
  }
  return json
}

if (comando === 'consultar') {
  if (!argumento) falhar('Uso: consultar <nome-do-modelo>')
  exigirAmbiente()
  const { data } = await graph(`/message_templates?name=${encodeURIComponent(argumento)}&fields=name,status,category,language,rejected_reason,components`)
  if (!data?.length) falhar(`Nenhum modelo chamado "${argumento}" nesta conta.`, 3)
  for (const t of data) {
    console.log(`${t.name} [${t.language}] status=${t.status} categoria=${t.category}${t.rejected_reason && t.rejected_reason !== 'NONE' ? ` motivo_da_recusa=${t.rejected_reason}` : ''}`)
    const botoes = t.components?.find((c) => c.type === 'BUTTONS')?.buttons ?? []
    // ⚠️ A ORDEM importa: o robô preenche o botão de link na posição 0 (o primeiro).
    botoes.forEach((b, i) => console.log(`  botão ${i}: ${b.type} "${b.text}"${b.url ? ` -> ${b.url}` : ''}`))
    if (!botoes.length) console.log('  (sem botões)')
  }
} else if (comando === 'criar') {
  const modelo = { a: TEMPLATE_A, b: TEMPLATE_B }[argumento]
  if (!modelo) falhar('Uso: criar <a|b> [--nome=outro_nome] [--enviar]')
  const nomeNovo = process.argv.find((a) => a.startsWith('--nome='))?.slice('--nome='.length)
  const escolhido = nomeNovo ? { ...modelo, nome: nomeNovo } : modelo
  const problemas = validarTemplate(escolhido)
  if (problemas.length) falhar(`Modelo inválido:\n- ${problemas.join('\n- ')}`)
  const payload = montarTemplate(escolhido)
  if (!enviar) {
    console.log('SÓ MOSTRANDO (nada foi enviado). Para criar de verdade, acrescente --enviar.\n')
    console.log(JSON.stringify(payload, null, 2))
  } else {
    exigirAmbiente()
    const r = await graph('/message_templates', { metodo: 'POST', corpo: payload })
    console.log(`Enviado para revisão da Meta: id=${r.id} status=${r.status} categoria=${r.category}`)
  }
} else {
  falhar('Comandos: consultar <nome> | criar <a|b> [--nome=outro_nome] [--enviar]')
}
