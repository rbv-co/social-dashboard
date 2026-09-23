import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  ACOES, itemDaBeauty, itemDoPrivateEdit, itemDaStylist, itensDaAcao, filtrarItens,
  fraseDoVazio, diaEmSaoPaulo, sequenciaDoCodigo,
} from './material-grafico-regras.js'
import { nomeDoArquivoDoQr } from '../../compartilhado/qr.js'

const BS = { codigo: 'BS-20260925-CPS-01', quando: '2026-09-25', praca: 'CPS', loja: 'iguatemi',
  parceiro: 'Salão Aurora', ativa: true, arquivada: false }
const PE = { codigo: 'PE-20260926-CPS-01', chave: 'K7Q2M9TX', quando: '2026-09-27T01:00:00Z',
  anfitria: 'Marina Castro', stylist: 'STY-0001', local: 'Loja do Iguatemi', praca: 'CPS', ativa: true, arquivada: false }
const STY = { codigo: 'STY-0001', nome: 'Marina Castro', cidade: 'Campinas', ativa: true }

test('as três ações do plano, na ordem, com a cor de cada uma e a legenda do plano', () => {
  assert.deepEqual(ACOES.map((a) => a.chave), ['beauty-session', 'private-edit', 'stylist-circle'])
  assert.deepEqual(ACOES.map((a) => a.cor), ['--cor-beauty-sessions', '--cor-private-edit', '--cor-stylist-circle'])
  assert.equal(ACOES[0].legenda, 'Prepare sua visita')
  assert.equal(ACOES[1].legenda, 'Confirme sua presença')
})

test('⚠️ cada cor de ação existe como token em estilos-globais.css (senão o grupo sai sem cor)', () => {
  const css = readFileSync(new URL('../../estilos/estilos-globais.css', import.meta.url), 'utf8')
  for (const a of ACOES) assert.match(css, new RegExp(`${a.cor}:#`), `falta o token ${a.cor}`)
  assert.match(css, /--cor-material-grafico:#/)
  assert.match(css, /\.tela-material-grafico\{ --modulo:var\(--cor-material-grafico\); \}/)
})

test('Beauty: QR da MESA, quem/quando claro, legenda e nome do arquivo do plano', () => {
  const i = itemDaBeauty(BS)
  assert.equal(i.endereco, 'https://vesselbrasil.com.br/bs/BS-20260925-CPS-01')
  assert.equal(i.titulo, '25/09/2026 · Salão Aurora')
  assert.deepEqual(i.linhas, ['Iguatemi Campinas'])
  assert.equal(i.codigo, 'BS-20260925-CPS-01')
  assert.equal(i.legenda, 'Prepare sua visita')
  assert.equal(nomeDoArquivoDoQr({ ...i.arquivo, formato: 'png' }), 'VESSEL_beauty-session_CPS_2026-09-25_qr_v01.png')
  assert.equal(i.ativo, true)
  assert.deepEqual(i.situacao, { texto: 'Aceitando', tom: 'viva' })
})

test('⚠️ Beauty: a segunda sessão do mesmo dia não baixa com o nome da primeira', () => {
  const um = itemDaBeauty(BS)
  const dois = itemDaBeauty({ ...BS, codigo: 'BS-20260925-CPS-02' })
  assert.notEqual(nomeDoArquivoDoQr(um.arquivo), nomeDoArquivoDoQr(dois.arquivo))
})

test('Beauty sem salão diz isso, em vez de um título pela metade', () => {
  assert.equal(itemDaBeauty({ ...BS, parceiro: null }).titulo, '25/09/2026 · sem salão informado')
})

test('⚠️ Private Edit: o QR vai pela CHAVE, nunca pelo código (o código é adivinhável)', () => {
  const i = itemDoPrivateEdit(PE)
  assert.equal(i.endereco, 'https://vesselbrasil.com.br/pe/K7Q2M9TX')
  assert.doesNotMatch(i.endereco, /PE-2026/)
  assert.equal(i.legenda, 'Confirme sua presença')
  assert.deepEqual(i.linhas, ['Loja do Iguatemi'])
})

test('⚠️ Private Edit: a data do arquivo é o dia em SÃO PAULO, não o dia em UTC', () => {
  // 01h UTC do dia 27 = 22h do dia 26 em Campinas.
  const i = itemDoPrivateEdit(PE)
  assert.equal(i.titulo, '26/09/2026 às 22h00 · Marina Castro')
  assert.equal(nomeDoArquivoDoQr({ ...i.arquivo, formato: 'svg' }), 'VESSEL_private-edit_CPS_2026-09-26_qr_v01.svg')
  assert.equal(diaEmSaoPaulo('2026-09-27T01:00:00Z'), '2026-09-26')
  assert.equal(diaEmSaoPaulo(''), '')
  assert.equal(diaEmSaoPaulo('lixo'), '')
})

test('Private Edit sem chave válida não tem QR (a tela explica, não inventa link)', () => {
  assert.equal(itemDoPrivateEdit({ ...PE, chave: null }).endereco, '')
  assert.equal(itemDoPrivateEdit({ ...PE, chave: 'curta' }).endereco, '')
})

test('Stylist: um QR por parceira, nome · código · cidade, arquivo pelo código', () => {
  const i = itemDaStylist(STY)
  assert.equal(i.endereco, 'https://vesselbrasil.com.br/s/STY-0001')
  assert.equal(i.titulo, 'Marina Castro')
  assert.deepEqual(i.linhas, ['Campinas'])
  assert.equal(i.codigo, 'STY-0001')
  assert.equal(i.legenda, '')
  assert.equal(nomeDoArquivoDoQr({ ...i.arquivo, formato: 'png' }), 'VESSEL_stylist-circle_STY-0001_qr_v01.png')
  assert.deepEqual(itemDaStylist({ ...STY, ativa: false }).situacao, { texto: 'Desativada', tom: 'parada' })
})

test('⚠️ Private Edit cancelado, realizado ou não realizado NÃO é ativo, mesmo com ativa: true', () => {
  /* O status muda sem `ativa` mudar, e o /pe/<chave> passa a recusar. Com a
   * regra antiga (só ativa/arquivada) estes três apareciam por padrão com o
   * selo "Aceitando" — um QR para uma porta fechada indo para a gráfica. */
  for (const [status, texto, tom] of [['cancelado', 'Cancelado', 'queda'], ['realizado', 'Realizado', 'viva'],
    ['nao_realizado', 'Não realizado', 'queda']]) {
    const i = itemDoPrivateEdit({ ...PE, status, ativa: true })
    assert.equal(i.ativo, false, status)
    assert.deepEqual(i.situacao, { texto, tom }, status)
    assert.equal(filtrarItens([i]).length, 0, `${status} apareceu na lista padrão`)
  }
  const agendado = itemDoPrivateEdit({ ...PE, status: 'agendado' })
  assert.equal(agendado.ativo, true)
  assert.deepEqual(agendado.situacao, { texto: 'Agendado', tom: 'andamento' })
  assert.deepEqual(itemDoPrivateEdit({ ...PE, arquivada: true }).situacao, { texto: 'Arquivada', tom: 'parada' })
})

test('a frase de "sem QR" é a de cada ação, não a do Private Edit para todas', () => {
  assert.match(itemDaBeauty({ ...BS, codigo: 'lixo' }).motivoSemQr, /sessão/)
  assert.match(itemDoPrivateEdit({ ...PE, chave: null }).motivoSemQr, /chave de convite/)
  assert.match(itemDaStylist({ ...STY, codigo: 'x' }).motivoSemQr, /parceira/)
  assert.equal(itemDaBeauty({ ...BS, codigo: 'lixo' }).endereco, '')
})

test('o que é ATIVO: nem encerrado, nem arquivado, nem desativada', () => {
  assert.equal(itemDaBeauty({ ...BS, ativa: false }).ativo, false)
  assert.equal(itemDaBeauty({ ...BS, arquivada: true }).ativo, false)
  assert.equal(itemDoPrivateEdit({ ...PE, ativa: false }).ativo, false)
  assert.equal(itemDoPrivateEdit({ ...PE, arquivada: true }).ativo, false)
  assert.equal(itemDaStylist({ ...STY, ativa: false }).ativo, false)
  // `ativa` ausente conta como aberta (a regra de filtros.js)
  assert.equal(itemDaStylist({ codigo: 'STY-0009', nome: 'X' }).ativo, true)
})

test('⚠️ por padrão só o ativo; o filtro traz os encerrados de volta', () => {
  const itens = itensDaAcao('beauty-session', [BS, { ...BS, codigo: 'BS-20260926-CPS-02', quando: '2026-09-26', ativa: false }])
  assert.equal(filtrarItens(itens).length, 1)
  assert.equal(filtrarItens(itens, { mostrarEncerrados: true }).length, 2)
})

test('a busca ignora acento e maiúscula, e acha por código, nome, salão, anfitriã e cidade', () => {
  const b = itensDaAcao('beauty-session', [BS])
  const p = itensDaAcao('private-edit', [PE])
  const s = itensDaAcao('stylist-circle', [STY, { codigo: 'STY-0002', nome: 'Âna Paula', cidade: 'São Paulo', ativa: true }])
  assert.equal(filtrarItens(b, { busca: 'aurora' }).length, 1)
  assert.equal(filtrarItens(b, { busca: 'bs-20260925' }).length, 1)
  assert.equal(filtrarItens(p, { busca: 'marina' }).length, 1)
  assert.equal(filtrarItens(s, { busca: 'ana' }).length, 1)
  assert.equal(filtrarItens(s, { busca: 'sao paulo' }).length, 1)
  assert.equal(filtrarItens(s, { busca: 'nada-disso' }).length, 0)
})

test('os itens saem em ordem: sessões e encontros por data, parceiras por código', () => {
  const b = itensDaAcao('beauty-session', [{ ...BS, codigo: 'BS-20261016-CPS-AME', quando: '2026-10-16' }, BS])
  assert.deepEqual(b.map((i) => i.codigo), ['BS-20260925-CPS-01', 'BS-20261016-CPS-AME'])
  const s = itensDaAcao('stylist-circle', [{ ...STY, codigo: 'STY-0002' }, STY])
  assert.deepEqual(s.map((i) => i.codigo), ['STY-0001', 'STY-0002'])
})

test('lista que não é lista (resposta estranha do banco) vira zero itens, não quebra', () => {
  assert.deepEqual(itensDaAcao('private-edit', null), [])
  assert.throws(() => itensDaAcao('appointment-card', []), /desconhecida/)
})

test('a frase do vazio diz POR QUE está vazio — nada criado, busca ou só encerrados', () => {
  assert.match(fraseDoVazio('beauty-session', { total: 0 }), /Nenhuma Beauty Session criada/)
  assert.match(fraseDoVazio('private-edit', { total: 3, busca: 'xyz' }), /Nenhum encontro com "xyz"/)
  assert.match(fraseDoVazio('stylist-circle', { total: 3 }), /Mostrar também encerrados/)
})

test('a sequência do código', () => {
  assert.equal(sequenciaDoCodigo('BS-20261016-CPS-AME'), 'AME')
  assert.equal(sequenciaDoCodigo('STY-0001'), '')
})
