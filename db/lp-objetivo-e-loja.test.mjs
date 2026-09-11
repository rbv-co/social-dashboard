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

test('⚠️ cada saída grava (ou não) a senha no lugar certo — não só no total', () => {
  // ⚠️ Um teste que só contasse "são 4 gravações no total" passaria mesmo se
  // alguém movesse uma gravação de lugar — por exemplo, gravasse na armadilha
  // e esquecesse no insert final. Por isso cada saída é conferida pelo NOME,
  // numa janela de texto que começa e termina em marcos únicos dela.
  //
  // ⚠️ NÃO ANCORAR em `situacao`: duas saídas diferentes respondem
  // `situacao: 'reservado'` — a promoção lista→pré-venda (que GRAVA) e o teto
  // por IP mudo (que NÃO PODE gravar). Um teste que procurasse `'reservado'`
  // arriscaria confirmar a gravação errada.
  const corpo = corpoDaFuncao('vessel_entrar_na_lista')
  const grava = /senha_hash\s*=\s*encode\(extensions\.digest|senha_hash, senha_em\)/

  function janela(nome, inicio, fim) {
    const i = corpo.indexOf(inicio)
    assert.notEqual(i, -1, 'marco de início do caminho "' + nome + '" não achado: ' + inicio)
    const j = corpo.indexOf(fim, i)
    assert.notEqual(j, -1, 'marco de fim do caminho "' + nome + '" não achado: ' + fim)
    return corpo.slice(i, j + fim.length)
  }

  assert.match(
    janela('ja_na_lista', 'if not v_prevenda then', "'ja_na_lista'"),
    grava, 'o caminho ja_na_lista deveria gravar a senha antes de responder')

  assert.match(
    janela('ja_reservado', "if v_atual.origem = 'pre-venda' then", "'ja_reservado'"),
    grava, 'o caminho ja_reservado deveria gravar a senha antes de responder')

  assert.match(
    janela('promoção lista→pré-venda', "set origem = 'pre-venda'", 'where id = v_atual.id;'),
    grava, 'a promoção lista→pré-venda deveria gravar a senha no mesmo update que muda a origem')

  assert.match(
    janela('insert final (cadastro novo)', 'insert into public.vessel_lista_espera', 'returning id into v_id;'),
    grava, 'o insert final (cadastro novo) deveria gravar a senha')

  assert.doesNotMatch(
    janela('armadilha anti-robô', 'if coalesce(trim(p_armadilha)', 'end if;'),
    grava, 'a armadilha anti-robô NÃO pode gravar: senha real ali dá a um robô uma senha que funciona')
})
