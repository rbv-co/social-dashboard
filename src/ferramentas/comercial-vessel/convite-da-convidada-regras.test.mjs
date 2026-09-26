import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  primeiroNome, linkDaConvidada, linkDaConvidadaParaEquipe, dataPorExtenso, horarioCurto, mensagemDoConvite,
  linkDoWhatsApp, nomeDoArquivo, textosDoCartao, LINHAS_DO_CONVITE,
} from './convite-da-convidada-regras.js'

const QUANDO = '2026-10-10T22:00:00Z' // 19h de São Paulo, sábado

test('primeiro nome', () => {
  assert.equal(primeiroNome('  Beatriz Montenegro Siqueira '), 'Beatriz')
  assert.equal(primeiroNome(''), '')
})
test('link só com as duas chaves no formato', () => {
  assert.equal(linkDaConvidada('k7q2m9tx', 'H3N8P4WZ'), 'https://vesselbrasil.com.br/pe/K7Q2M9TX/H3N8P4WZ')
  assert.equal(linkDaConvidada('K7Q2M9TX', 'O0I1ABCD'), '')
  assert.equal(linkDaConvidada('', 'H3N8P4WZ'), '')
})
test('o link da equipe é o mesmo com o marcador, e a mensagem não o leva', () => {
  assert.equal(linkDaConvidadaParaEquipe('k7q2m9tx', 'H3N8P4WZ'), 'https://vesselbrasil.com.br/pe/K7Q2M9TX/H3N8P4WZ?equipe=1')
  assert.equal(linkDaConvidadaParaEquipe('K7Q2M9TX', 'O0I1ABCD'), '')
  const m = mensagemDoConvite({ quem: 'equipe', convidada: 'Beatriz', stylist: 'Ana', quando: QUANDO,
    local: 'Loja', link: linkDaConvidada('K7Q2M9TX', 'H3N8P4WZ') })
  assert.doesNotMatch(m, /equipe=1/)
})
test('data e hora no fuso de São Paulo, não em UTC', () => {
  assert.equal(dataPorExtenso(QUANDO), 'sábado, 10 de outubro')
  assert.equal(horarioCurto(QUANDO), '19h')
  assert.equal(horarioCurto('2026-10-10T22:30:00Z'), '19h30')
  assert.equal(dataPorExtenso('2026-10-11T02:30:00Z'), 'sábado, 10 de outubro')
})
const BASE = { convidada: 'Beatriz Siqueira', stylist: 'Marina Castro', quando: QUANDO,
  local: 'Loja do Iguatemi Campinas', link: 'https://vesselbrasil.com.br/pe/K7Q2M9TX/H3N8P4WZ' }
test('mensagem da stylist: o texto aprovado, palavra por palavra', () => {
  assert.equal(mensagemDoConvite({ ...BASE, quem: 'stylist' }),
    'Beatriz, estou preparando uma VESSEL Private Edit para um pequeno grupo de clientes. Vou apresentar uma '
    + 'seleção de bolsas sob o meu olhar, com a equipe da VESSEL à disposição. Será em sábado, 10 de outubro, '
    + 'às 19h, em Loja do Iguatemi Campinas. Gostaria muito de ter você comigo. Confirme sua presença por aqui: '
    + 'https://vesselbrasil.com.br/pe/K7Q2M9TX/H3N8P4WZ')
})
test('mensagem da equipe: o texto aprovado, palavra por palavra', () => {
  assert.equal(mensagemDoConvite({ ...BASE, quem: 'equipe' }),
    'Beatriz, a Marina está preparando uma VESSEL Private Edit para um pequeno grupo de clientes e gostaria '
    + 'muito de ter você com ela. Será em sábado, 10 de outubro, às 19h, em Loja do Iguatemi Campinas, com uma '
    + 'seleção de bolsas preparada pela Marina e a equipe da VESSEL à disposição. Confirme sua presença por aqui: '
    + 'https://vesselbrasil.com.br/pe/K7Q2M9TX/H3N8P4WZ')
})
test('sem local, a frase não fica com "em ,"', () => {
  assert.doesNotMatch(mensagemDoConvite({ ...BASE, local: null, quem: 'stylist' }), /em ,|em \./)
})
test('WhatsApp só com número brasileiro completo', () => {
  assert.equal(linkDoWhatsApp('5519999990000', 'Oi & tchau'), 'https://wa.me/5519999990000?text=Oi%20%26%20tchau')
  assert.equal(linkDoWhatsApp('19999990000', 'x'), '')
})
test('nome do arquivo sem acento e com a data do encontro', () => {
  assert.equal(nomeDoArquivo('Ângela Souza', QUANDO), 'private-edit_angela_2026-10-10.png')
})
test('textos do cartão: título, hosted by e o nome inteiro da convidada', () => {
  const t = textosDoCartao({ convidada: 'Beatriz Siqueira', stylist: 'Marina Castro', quando: QUANDO, local: 'Loja X' })
  assert.equal(t.titulo, 'PRIVATE EDIT')
  assert.equal(t.hosted, 'Hosted by Marina Castro')
  assert.equal(t.nome, 'Beatriz Siqueira')
  assert.equal(t.quando, 'SÁBADO, 10 DE OUTUBRO')
  assert.equal(t.horario, '19H')
  for (const l of LINHAS_DO_CONVITE) assert.ok(l.campo in t, `a linha ${l.campo} não tem texto`)
})
test('as linhas que vêm de fora encolhem para caber', () => {
  for (const campo of ['nome', 'hosted', 'local', 'quando']) {
    const l = LINHAS_DO_CONVITE.find((x) => x.campo === campo)
    assert.ok(l.larguraMaxima && l.tamanhoMinimo, `${campo} sem larguraMaxima/tamanhoMinimo`)
  }
})

// ── FIAÇÃO: os arquivos da marca, o cartão e a tela (Task 6) ────────────────
import { readFileSync as lerArquivo, existsSync } from 'node:fs'
const ler = (f) => lerArquivo(new URL(f, import.meta.url), 'utf8')
test('FIAÇÃO: os arquivos da marca estão na pasta pública', () => {
  for (const f of ['fundo.png', 'logomarca-escura.png', 'fontes/vessel-versatile.woff2',
    'fontes/vessel-versatile-light.woff2', 'fontes/vessel-angeletta.woff2']) {
    assert.ok(existsSync(new URL(`../../../public/cartao-private-edit/${f}`, import.meta.url)), `falta ${f}`)
  }
})
test('FIAÇÃO: o cartão usa as regras e marca "convite enviado" pelo banco', () => {
  const c = ler('./cartao-da-convidada.vue')
  assert.match(c, /mensagemDoConvite\(/)
  assert.match(c, /linkDaConvidada\(/)
  assert.match(c, /vessel_chave_da_convidada/)
  assert.match(c, /p_marca: 'enviado'/)
  assert.match(c, /v-trava-rolagem/)
  assert.match(ler('./desenhar-convite.js'), /LINHAS_DO_CONVITE/)
})
test('FIAÇÃO: a lista de convidadas abre o cartão', () => {
  assert.match(ler('./tela-de-private-edit.vue'), /<cartao-da-convidada/)
})

// ── FIAÇÃO: correções da revisão — rodada 1 (Task 6) ────────────────────────
test('FIAÇÃO: "Baixar cartão" só existe com o arquivo pronto (sem marcar sem PNG)', () => {
  const c = ler('./cartao-da-convidada.vue')
  assert.match(c, /v-else-if="imagem"[^>]*class="btn"[^>]*:download=/)
  assert.doesNotMatch(c, /aria-disabled="!imagem"/, 'o link de baixar não pode existir desabilitado — precisa sumir')
})
test('FIAÇÃO: os botões de WhatsApp exigem mensagem pronta e não aparecem em erro', () => {
  const c = ler('./cartao-da-convidada.vue')
  assert.match(c, /quem === 'equipe' && whatsDela && mensagem && !erro/)
  assert.match(c, /quem === 'stylist' && whatsDaStylist && mensagem && !erro/)
})
test('FIAÇÃO: stylist sem WhatsApp válido tem aviso próprio, não a nota genérica', () => {
  assert.match(ler('./cartao-da-convidada.vue'),
    /quem === 'stylist' && !whatsDaStylist[\s\S]{0,120}não tem WhatsApp válido/)
})
test('FIAÇÃO: toBlob nulo não vira arquivo fantasma', () => {
  assert.match(ler('./cartao-da-convidada.vue'), /if \(!blob\) throw new Error\('png'\)/)
})
test('FIAÇÃO: compartilhar só engole o cancelamento (AbortError), avisa nas outras falhas', () => {
  const c = ler('./cartao-da-convidada.vue')
  assert.match(c, /AbortError/)
  assert.match(c, /Não consegui abrir o compartilhamento/)
})
test('FIAÇÃO: a cache de fontes se reseta numa falha de carregamento', () => {
  assert.match(ler('./desenhar-convite.js'), /\.catch\(\(e\) => \{ fontesProntas = null; throw e \}\)/)
})
test('FIAÇÃO: a linha de abertura do convite não aparece vazia', () => {
  assert.match(ler('./tela-de-private-edit.vue'),
    /v-if="c\.convite_aberto_em \|\| c\.convite_enviado_em"[^>]*class="cv-sub"/)
})
