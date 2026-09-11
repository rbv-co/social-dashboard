import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/* ⚠️ POR QUE ESTE ARQUIVO EXISTE
 *
 * A escolha do caminho (visita ou loja online) é uma SEGUNDA escrita, feita
 * depois de a pessoa já estar no banco. Sem prova de identidade, a porta
 * pública passaria a aceitar "grave visita na linha 412" — sobre a linha de
 * qualquer cliente.
 *
 * Este teste falha se a senha de uso único sair da migration, se ela passar a
 * ser guardada em texto puro, ou se `loja` nascer presa a uma loja só. */

const SQL = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)),
       'migrations/2026-09-11-vessel-lista-objetivo-e-loja.sql'), 'utf8')

test('as duas colunas do dono entram', () => {
  assert.match(SQL, /add column if not exists objetivo\s+text/i)
  assert.match(SQL, /add column if not exists loja\s+text/i)
})

test('⚠️ a COLUNA guarda impressão digital, nunca a senha crua', () => {
  assert.match(SQL, /add column if not exists senha_hash\s+text/i)
  // ⚠️ A busca é DENTRO DO `alter table`, e não no arquivo todo. As funções que
  // as Tasks 2 e 3 acrescentam a este mesmo arquivo declaram `p_senha text` —
  // uma varredura solta casaria com o parâmetro delas e acusaria coluna crua
  // onde não há nenhuma, duas tarefas depois desta passar.
  const alter = SQL.slice(SQL.indexOf('alter table'), SQL.indexOf(';', SQL.indexOf('alter table')))
  assert.ok(!/\bsenha\s+text/i.test(alter.replace(/senha_hash\s+text/gi, '')),
    'nenhuma COLUNA guarda a senha crua')
})

test('⚠️ `loja` nasce aceitando AS DUAS lojas abertas', () => {
  assert.match(SQL, /tivoli/i)
  assert.match(SQL, /iguatemi/i)
})

test('⚠️ a senha EXPIRA — senão vale para sempre', () => {
  assert.match(SQL, /senha_em\s+timestamptz/i)
})

/**
 * O corpo de UMA função, e não daí até o fim do arquivo.
 * ⚠️ A migration guarda duas funções. Uma fatia que vai até o fim arrastaria a
 * `vessel_marcar_objetivo` para dentro da conta — e ela tem `json_build_object`
 * SEM senha, de propósito. O teste ficaria verde hoje e vermelho quando a Task 3
 * entrasse, apontando para a tarefa errada. Mesmo cuidado de `ultimaDefinicaoDe`
 * em `db/cartao-trava-a-serie.test.mjs`.
 */
function corpoDaFuncao(nome) {
  const i = SQL.indexOf('create or replace function public.' + nome)
  assert.notEqual(i, -1, 'a função ' + nome + ' não está na migration')
  const resto = SQL.slice(i)
  const fim = resto.indexOf('$function$;')
  return fim === -1 ? resto : resto.slice(0, fim + 11)
}

test('⚠️ TODO caminho de saída devolve senha — inclusive os falsos', () => {
  const corpo = corpoDaFuncao('vessel_entrar_na_lista')
  const saidas = corpo.match(/json_build_object\(/g) || []
  const comSenha = corpo.match(/'senha'/g) || []
  assert.equal(comSenha.length, saidas.length,
    'a armadilha e o teto por IP precisam devolver senha FALSA: sem ela, a '
    + 'ausência da senha vira o sinal de que o robô foi pego')
})

test('⚠️ quem JÁ ESTÁ na lista também recebe senha de verdade', () => {
  assert.match(SQL, /ja_na_lista[\s\S]{0,400}?'senha'/i)
})

test('⚠️ a senha só chega ao banco passada por digest', () => {
  // Esta aferição mora AQUI, e não na Task 1: a Task 1 é só coluna, e coluna
  // não faz conta. Quem transforma a senha em impressão digital é esta função,
  // na hora de gravar. Exigir `digest(` de uma migration que só tem `alter
  // table` empurraria quem a implementasse a inventar uma função para o teste
  // passar — que foi exatamente o que aconteceu em 11/09/2026.
  const corpo = corpoDaFuncao('vessel_entrar_na_lista')
  assert.match(corpo, /digest\(/i)
  assert.ok(!/senha_hash\s*=\s*v_senha/i.test(corpo),
    'a senha crua nunca é atribuída à coluna de impressão digital')
})
