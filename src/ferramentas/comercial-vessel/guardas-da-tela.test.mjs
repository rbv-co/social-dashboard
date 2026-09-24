import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ferramentaDaRota } from '../../compartilhado/catalogo-de-ferramentas.js'

/* AS GUARDAS DO MENU DO COMERCIAL VESSEL — no estilo de
 * `../beauty-sessions/guardas-da-tela.test.mjs`: leem o `.vue` de verdade e
 * conferem o FIO que liga a tela à regra pura.
 *
 * ⚠️ POR QUE ISTO EXISTE: um teste de unidade sobre `ENDERECO_DO_GERADOR_DE_CARTAO`
 * (enderecos-publicos.test.mjs) prova que o ENDEREÇO está certo — nunca prova
 * que o `.vue` usou um `<a>` de verdade em vez de um `<div @click>`, nem que o
 * card está atrás do MESMO porteiro que os outros módulos Vessel. Foram
 * exatamente esses dois pontos que o pedido do dono deixou explícitos: a
 * porta tem de poder ser aberta noutra aba, copiada e conferida ANTES de
 * clicar — o que só um `<a>` de verdade garante — e quem só tem `carrinho`
 * não pode enxergar este card.
 */

const CAMINHO = new URL('./tela-de-menu-comercial-vessel.vue', import.meta.url)
const ler = () => readFileSync(CAMINHO, 'utf8')

// Acha a tag de abertura do elemento que carrega o título do Appointment
// Card, voltando até o '<a ' ou '<div ' mais próximo ANTES do título. Não
// basta procurar "existe um <a> em algum lugar do arquivo" — o defeito real
// seria trocar SÓ este card por um <div>, deixando os outros cinco <a>-livres
// intactos (não há outro <a> na tela hoje).
function tagDeAberturaDoCard(fonte) {
  const idxTitulo = fonte.indexOf('>Appointment Card<')
  assert.ok(idxTitulo !== -1, 'o card "Appointment Card" precisa existir na tela')
  const antes = fonte.slice(0, idxTitulo)
  const idxA = antes.lastIndexOf('<a ')
  const idxDiv = antes.lastIndexOf('<div class="cvmenu-card"')
  assert.ok(idxA !== -1, 'não achei nenhuma tag <a ...> antes do título "Appointment Card"')
  assert.ok(idxA > idxDiv,
    'a tag mais próxima antes do título "Appointment Card" é um <div class="cvmenu-card">, não um <a> — ' +
    'a porta virou clique de sistema em vez de link de verdade')
  const fimDaTag = fonte.indexOf('>', idxA)
  return fonte.slice(idxA, fimDaTag + 1)
}

test('⚠️ o card do Appointment Card é um <a> que sai do sistema, não um <div> com @click', () => {
  const tag = tagDeAberturaDoCard(ler())
  assert.doesNotMatch(tag, /@click/,
    'o card do Appointment Card não pode ter @click — é uma porta que SAI do sistema, tem de dar para ' +
    'abrir noutra aba, copiar o link e ver para onde vai antes de clicar')
  assert.match(tag, /target="_blank"/, 'falta target="_blank" no card do Appointment Card')
  assert.match(tag, /rel="noopener noreferrer"/,
    'falta rel="noopener noreferrer" — obrigatório junto de target="_blank"')
  assert.match(tag, /:href="ENDERECO_DO_GERADOR_DE_CARTAO"/,
    'o card do Appointment Card precisa apontar para ENDERECO_DO_GERADOR_DE_CARTAO')
})

// 24/09/2026: cada cartão tem a SUA chave, lida do catálogo por podeAbrir().
test('⚠️ o card do Appointment Card está atrás da chave DELE (podeAbrir), não sempre visível', () => {
  const tag = tagDeAberturaDoCard(ler())
  assert.match(tag, /v-if="podeAbrir\('appointment-card'\)"/,
    'o card do Appointment Card precisa estar atrás de v-if="podeAbrir(\'appointment-card\')" — sem isso, ' +
    'alguém com só "carrinho" enxergaria um card que não devia')
  assert.equal(ferramentaDaRota('appointment-card')?.key, 'atendimentos.appointment-card')
})

// ⚠️ Quem tem SÓ 'carrinho' tem de ver o Funil e NÃO ver o Appointment Card —
// é o par de casos que a regra do dono pediu por extenso. Conferido aqui pelo
// TEXTO da tela (os dois v-if certos, na tag certa), não só pela unidade de
// hasPermission — hasPermission já está certa; o que falta provar é a
// LIGAÇÃO com o template.
test('⚠️ o Funil de Carrinho continua atrás da chave carrinho, não de atendimentos', () => {
  const fonte = ler()
  const idxTituloFunil = fonte.indexOf('>Funil de Carrinho<')
  assert.ok(idxTituloFunil !== -1, 'o card do Funil de Carrinho precisa existir na tela')
  const antes = fonte.slice(0, idxTituloFunil)
  const idxDivFunil = antes.lastIndexOf('<div class="cvmenu-card"')
  const fimDaTag = fonte.indexOf('>', idxDivFunil)
  const tagFunil = fonte.slice(idxDivFunil, fimDaTag + 1)
  assert.match(tagFunil, /v-if="podeAbrir\('funil-carrinho'\)"/,
    'o card do Funil de Carrinho precisa continuar atrás da rota dele')
  assert.equal(ferramentaDaRota('funil-carrinho')?.key, 'carrinho')
})

// ── O MATERIAL GRÁFICO (23/09/2026) ─────────────────────────────────────────
// ⚠️ A PORTA E A ROTA NÃO PODEM DIVERGIR: um card que aponta para um nome que
// o roteiro não conhece cai no "nao-encontrada" e volta para a Central calado;
// uma rota com chave diferente da do card mostra o card para quem a rota
// barra. Os três pontos são conferidos juntos: o card, o nome e a chave.
test('⚠️ o card do Material Gráfico está atrás da chave dele e abre a rota material-grafico', () => {
  const fonte = ler()
  const idxTitulo = fonte.indexOf('>Material Gráfico<')
  assert.ok(idxTitulo !== -1, 'o card "Material Gráfico" precisa existir no menu')
  const antes = fonte.slice(0, idxTitulo)
  const idxDiv = antes.lastIndexOf('<div class="cvmenu-card"')
  const tag = fonte.slice(idxDiv, fonte.indexOf('>', idxDiv) + 1)
  assert.match(tag, /v-if="podeAbrir\('material-grafico'\)"/, 'o card precisa estar atrás de podeAbrir(material-grafico)')
  assert.match(tag, /@click="ir\('material-grafico'\)"/, 'o card precisa abrir a rota material-grafico')

  const mapa = readFileSync(new URL('../../mapa-de-enderecos.js', import.meta.url), 'utf8')
  const linha = mapa.split('\n').find((l) => l.includes("name: 'material-grafico'"))
  assert.ok(linha, 'a rota material-grafico precisa existir em mapa-de-enderecos.js')
  assert.match(linha, /path: '\/material-grafico'/)
  // A chave da rota e a do card saem do MESMO lugar (o catálogo): não há
  // mais `recurso:` escrito na rota para divergir.
  assert.doesNotMatch(linha, /recurso:/, 'a rota voltou a declarar a própria chave — ela sai do catálogo')
  assert.equal(ferramentaDaRota('material-grafico')?.key, 'atendimentos.material-grafico')
  assert.match(linha, /tela-de-material-grafico\.vue/)
})
