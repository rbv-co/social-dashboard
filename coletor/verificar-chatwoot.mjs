// coletor/verificar-chatwoot.mjs
// Confere, contra o Chatwoot REAL, cada passo que o robô de mensagens de abandono usa.
// Sem --enviar: só busca (e cria, se não existir) o CONTATO do número informado.
//   CHATWOOT_URL=... CHATWOOT_CONTA_ID=... CHATWOOT_CAIXA_ID=... CHATWOOT_API_TOKEN=... \
//   NUMERO=5519999999999 node coletor/verificar-chatwoot.mjs
// Com --enviar (e TEMPLATE_NOME, TEMPLATE_IDIOMA, LINK_SUFIXO): abre a conversa e manda o template
// PARA O NÚMERO INFORMADO. Use SÓ o número do dono.
// As credenciais vêm do ambiente que o dono passa: nunca as coloque neste arquivo.
import { criarClienteChatwoot } from '../supabase/functions/_shared/cliente-chatwoot.js'
import { montarTemplateParams, normalizarTelefone } from '../supabase/functions/_shared/mensagem-de-abandono.js'

const e = process.env
const telefone = normalizarTelefone(e.NUMERO ?? '')
if (!telefone) { console.error('NUMERO inválido (celular brasileiro com DDD).'); process.exit(1) }
const c = criarClienteChatwoot({
  url: e.CHATWOOT_URL, contaId: e.CHATWOOT_CONTA_ID, caixaId: Number(e.CHATWOOT_CAIXA_ID), token: e.CHATWOOT_API_TOKEN,
})
const ver = (rotulo, valor) => console.log(rotulo.padEnd(22), JSON.stringify(valor))

try {
  const contatoId = await c.acharOuCriarContato({ nome: 'Teste do dono', telefone })
  ver('contato id', contatoId)
  if (!process.argv.includes('--enviar')) {
    console.log('Só contato. Use --enviar para abrir a conversa e mandar o template.')
    process.exit(0)
  }
  const conversaId = await c.abrirConversa({ contatoId, telefone })
  ver('conversa id', conversaId)
  const tp = montarTemplateParams({
    nomeTemplate: e.TEMPLATE_NOME, idioma: e.TEMPLATE_IDIOMA || 'pt_BR', nome: 'Teste do dono', sufixoUrl: e.LINK_SUFIXO,
  })
  ver('mensagem id', await c.enviarTemplate({ conversaId, texto: `[template ${e.TEMPLATE_NOME}]`, templateParams: tp }))
} catch (erro) {
  console.error('FALHOU no passo:', erro.passo ?? '(rede)', erro.status ?? '', JSON.stringify(erro.corpo ?? String(erro)).slice(0, 300))
  process.exit(2)
}
