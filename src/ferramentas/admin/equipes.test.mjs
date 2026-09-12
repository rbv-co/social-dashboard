import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  PAPEIS, acharPapel, nivelDo,
  podeAdministrarTime, papeisQuePossoConceder, podeRemover,
  avisosDoTime, validarTime, canaisLivres, linhaDoTime, ordenarTimes,
  veOEstoque, podeLiberarEstoque, PAPEIS_DO_TIME,
} from './equipes.js'

const dono = { is_superadmin: true }
const gente = { is_superadmin: false }

// Os times reais, como ficaram no banco em 04/08/2026.
const TIVOLI = { id: 't1', nome: 'Tivoli', tipo: 'loja', canal_loja_id: 205834140, local_id: 'l1', setor_id: 's1', deposito_id: 14888726315, ordem: 10 }
const DOMPEDRO = { id: 't2', nome: 'Dom Pedro', tipo: 'loja', canal_loja_id: 205657609, local_id: 'l2', setor_id: 's2', ordem: 20 }
const IGUATEMI = { id: 't3', nome: 'Iguatemi Campinas', tipo: 'loja', canal_loja_id: null, ordem: 30 }

// ── A regra de ouro: ninguém concede o que não tem ──────────────────────────

test('supervisora NAO administra o time', () => {
  // Sem isto ela se promoveria a gestora e sairia do próprio cerco em dois
  // cliques. O sistema já teve esse buraco antes, no cadastro de usuário.
  assert.equal(podeAdministrarTime(gente, 'supervisora'), false)
  assert.equal(podeAdministrarTime(gente, 'vendedora'), false)
  assert.equal(podeAdministrarTime(gente, 'gestor'), true)
})

test('o dono administra qualquer time, mesmo sem ser membro', () => {
  assert.equal(podeAdministrarTime(dono, null), true)
  assert.equal(podeAdministrarTime(dono, 'vendedora'), true)
})

test('ninguem sem sessao administra nada', () => {
  assert.equal(podeAdministrarTime(null, 'gestor'), false)
  assert.deepEqual(papeisQuePossoConceder(null, 'gestor'), [])
})

test('quem nao administra nao concede papel nenhum', () => {
  assert.deepEqual(papeisQuePossoConceder(gente, 'supervisora'), [])
  assert.deepEqual(papeisQuePossoConceder(gente, 'vendedora'), [])
})

test('gestor concede ate gestor — precisa poder passar o bastao', () => {
  const ids = papeisQuePossoConceder(gente, 'gestor').map((p) => p.id)
  // Sem 'supervisora' desde 27/08: ela mora no GRUPO, nao no time.
  assert.deepEqual(ids, ['vendedora', 'gestor'])
})

// ── A supervisora saiu do seletor DO TIME (27/08/2026) ──────────────────────

test('nem o superadmin concede supervisora DENTRO do time', () => {
  // Decisao do dono: "a supervisora fica a nivel pai, gestora e vendedora fica a
  // nivel loja". Dois lugares para conceder a mesma coisa, com alcances
  // diferentes, e ninguem saberia qual vale.
  const ids = papeisQuePossoConceder(dono, 'gestor').map((p) => p.id)
  assert.deepEqual(ids, ['vendedora', 'gestor'])
  assert.ok(!ids.includes('supervisora'))
})

test('mas supervisora CONTINUA em PAPEIS, com o nivel dela', () => {
  // Tira-la da lista faria uma supervisora antiga virar nivel 0 e perder acesso
  // em silencio. Hoje nao existe nenhuma, e mesmo assim a regra tem de aguentar.
  assert.equal(nivelDo('supervisora'), 2)
  assert.ok(acharPapel('supervisora'), 'o papel continua existindo')
})

test('supervisora ANTIGA de time continua vendo e liberando o estoque', () => {
  assert.deepEqual(veOEstoque({ papel: 'supervisora' }, []), { ve: true, porque: 'pelo papel' })
  assert.equal(podeLiberarEstoque(gente, 'supervisora'), true)
})

// ── O último gestor não sai ─────────────────────────────────────────────────

test('o ULTIMO gestor nao pode ser removido', () => {
  // Senão o time fica sem quem coloque gente de volta, e só o dono destrava.
  const membros = [
    { id: 'm1', papel: 'gestor' },
    { id: 'm2', papel: 'vendedora' },
  ]
  const r = podeRemover(gente, 'gestor', membros[0], membros)
  assert.equal(r.pode, false)
  assert.match(r.porque, /último gestor/)
})

test('havendo dois gestores, um pode sair', () => {
  const membros = [{ id: 'm1', papel: 'gestor' }, { id: 'm2', papel: 'gestor' }]
  assert.equal(podeRemover(gente, 'gestor', membros[0], membros).pode, true)
})

test('vendedora sai sem cerimonia', () => {
  const membros = [{ id: 'm1', papel: 'gestor' }, { id: 'm2', papel: 'vendedora' }]
  assert.equal(podeRemover(gente, 'gestor', membros[1], membros).pode, true)
})

test('o dono tira ate o ultimo gestor', () => {
  const membros = [{ id: 'm1', papel: 'gestor' }]
  assert.equal(podeRemover(dono, null, membros[0], membros).pode, true)
})

test('quem nao administra nao remove, e o motivo diz isso', () => {
  const r = podeRemover(gente, 'vendedora', { papel: 'vendedora' }, [])
  assert.equal(r.pode, false)
  assert.match(r.porque, /não administra/)
})

// ── O que falta num time ────────────────────────────────────────────────────

test('time SEM canal do Bling avisa que nao vai mostrar faturamento', () => {
  // É o caso que mais confunde: tudo parece certo e o número vem zerado.
  const a = avisosDoTime(IGUATEMI)
  assert.ok(a.some((x) => x.grave && /faturamento/.test(x.texto)))
})

test('time completo nao inventa aviso', () => {
  assert.deepEqual(avisosDoTime(TIVOLI), [])
})

test('canal de venda nao e cobrado por local nem setor', () => {
  // Atacado Nuvem Shop não tem endereço nem gente de RH — cobrar isso seria
  // pedir para preencher o que não existe.
  const canal = { nome: 'Atacado Nuvem Shop', tipo: 'canal', canal_loja_id: 205451611, deposito_id: 14888248253 }
  assert.deepEqual(avisosDoTime(canal), [])
})

// ── Validação ao salvar ─────────────────────────────────────────────────────

test('time sem nome nao passa', () => {
  assert.match(validarTime({ nome: '  ' }, []), /nome/)
})

test('nome repetido nao passa, mesmo com caixa diferente', () => {
  assert.match(validarTime({ nome: 'tivoli' }, [TIVOLI]), /Já existe/)
})

test('renomear o proprio time NAO acusa repeticao', () => {
  assert.equal(validarTime({ id: 't1', nome: 'Tivoli' }, [TIVOLI, DOMPEDRO]), '')
})

test('um canal do Bling pertence a UM time so, e o erro diz de quem e', () => {
  // O banco já barra por índice único, mas o erro dele ("duplicate key value
  // violates unique constraint") não diz nada a quem cadastra uma loja.
  const erro = validarTime({ nome: 'Santa Bárbara', canal_loja_id: 205834140 }, [TIVOLI])
  assert.match(erro, /já é do time "Tivoli"/)
})

test('o seletor esconde os canais ja usados por outro time', () => {
  const canais = [
    { loja_id: 205834140, nome: "Loja Santa Bárbara d'Oeste" },
    { loja_id: 205657609, nome: 'Loja Dom Pedro' },
    { loja_id: 205680515, nome: 'Amazon Seller' },
  ]
  const livres = canaisLivres(canais, [TIVOLI, DOMPEDRO], null).map((c) => c.nome)
  assert.deepEqual(livres, ['Amazon Seller'])
})

test('editando um time, o canal DELE continua na lista', () => {
  // Senão editar o nome do Tivoli apagaria o canal dele sem ninguém pedir.
  const canais = [{ loja_id: 205834140, nome: "Loja Santa Bárbara d'Oeste" }]
  assert.equal(canaisLivres(canais, [TIVOLI], 't1').length, 1)
})

// ── A lista ─────────────────────────────────────────────────────────────────

test('a linha do time conta quem tem dentro, por papel', () => {
  const membros = [
    { equipe_id: 't1', papel: 'gestor' },
    { equipe_id: 't1', papel: 'vendedora' },
    { equipe_id: 't1', papel: 'vendedora' },
    { equipe_id: 't2', papel: 'vendedora' },
  ]
  const l = linhaDoTime(TIVOLI, membros)
  assert.equal(l.quantos, 3)
  assert.match(l.quemTem, /2 vendedoras/)
  assert.match(l.quemTem, /1 gestor/)
})

test('time vazio DIZ que esta vazio, em vez de sair em branco', () => {
  assert.equal(linhaDoTime(TIVOLI, []).quemTem, 'ninguém ainda')
})

test('inativo vai pro fim da lista', () => {
  const lista = ordenarTimes([
    { id: 'a', nome: 'Antigo', ativo: false, ordem: 1 },
    { id: 'b', nome: 'Tivoli', ativo: true, ordem: 10 },
    { id: 'c', nome: 'Dom Pedro', ativo: true, ordem: 20 },
  ])
  assert.deepEqual(lista.map((t) => t.nome), ['Tivoli', 'Dom Pedro', 'Antigo'])
})

test('sem ordem definida, o nome desempata em portugues', () => {
  const lista = ordenarTimes([
    { id: 'a', nome: 'Órfão', ativo: true },
    { id: 'b', nome: 'Atacado', ativo: true },
  ])
  assert.deepEqual(lista.map((t) => t.nome), ['Atacado', 'Órfão'])
})

// ── O catálogo ──────────────────────────────────────────────────────────────

test('todo papel se explica em portugues, sem jargao', () => {
  for (const p of PAPEIS) {
    assert.ok(p.explicacao.length > 25, `${p.id} sem explicação de verdade`)
    assert.ok(!/RLS|policy|scope|role/i.test(p.explicacao), `${p.id}: jargão na explicação`)
  }
})

test('a escada dos papeis nao tem empate', () => {
  const niveis = PAPEIS.map((p) => p.nivel)
  assert.equal(new Set(niveis).size, niveis.length)
})

test('papel que nao existe tem nivel zero, e nao estoura', () => {
  assert.equal(nivelDo('presidente'), 0)
  assert.equal(nivelDo(null), 0)
  assert.equal(acharPapel('presidente'), null)
})

// ── O estoque é liberado, não herdado ───────────────────────────────────────

test('supervisora e gestor veem o estoque PELO PAPEL', () => {
  assert.equal(veOEstoque({ papel: 'supervisora' }, []).ve, true)
  assert.equal(veOEstoque({ papel: 'gestor' }, []).ve, true)
})

test('vendedora NAO ve estoque so por estar no time', () => {
  // Decisão do dono: estar no time abre as vendas; o estoque é decisão de quem
  // supervisiona.
  assert.equal(veOEstoque({ papel: 'vendedora', equipe_id: 't1', profile_id: 'p1' }, []).ve, false)
})

test('vendedora COM liberacao ve — e so a do time dela', () => {
  const liberacoes = [{ equipe_id: 't1', profile_id: 'p1', chave: 'estoque' }]
  assert.equal(veOEstoque({ papel: 'vendedora', equipe_id: 't1', profile_id: 'p1' }, liberacoes).ve, true)
  // mesma pessoa, OUTRO time: não vale
  assert.equal(veOEstoque({ papel: 'vendedora', equipe_id: 't2', profile_id: 'p1' }, liberacoes).ve, false)
  // outra pessoa, mesmo time: não vale
  assert.equal(veOEstoque({ papel: 'vendedora', equipe_id: 't1', profile_id: 'p9' }, liberacoes).ve, false)
})

test('liberacao de OUTRA chave nao serve para estoque', () => {
  const liberacoes = [{ equipe_id: 't1', profile_id: 'p1', chave: 'outra-coisa' }]
  assert.equal(veOEstoque({ papel: 'vendedora', equipe_id: 't1', profile_id: 'p1' }, liberacoes).ve, false)
})

test('a supervisora LIBERA, mesmo sem administrar o time', () => {
  // Ela não põe nem tira gente — mas o estoque é dela.
  assert.equal(podeAdministrarTime(gente, 'supervisora'), false)
  assert.equal(podeLiberarEstoque(gente, 'supervisora'), true)
  assert.equal(podeLiberarEstoque(gente, 'vendedora'), false)
  assert.equal(podeLiberarEstoque(dono, null), true)
  assert.equal(podeLiberarEstoque(null, 'gestor'), false)
})

test('time sem deposito avisa que o estoque vai aparecer vazio', () => {
  // Vazio se confunde com "acabou o produto".
  const semDeposito = { nome: 'Tivoli', tipo: 'loja', canal_loja_id: 1, local_id: 'l', setor_id: 's' }
  assert.ok(avisosDoTime(semDeposito).some(a => /estoque/.test(a.texto)))
})
