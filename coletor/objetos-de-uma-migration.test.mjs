// A EXTRACAO E O PONTO CEGO DO CONFERIDOR.
//
// `conferir-migrations-pendentes.mjs` diz "ja aplicada" quando TODOS os objetos
// que o .sql cria existem no banco. Se a extracao deixar um objeto de fora, a
// migration passa sem ter sido conferida inteira — e a divida de registro volta
// disfarcada de lista limpa, que e pior do que a divida aberta.
//
// Por isso estes testes rodam contra os .sql REAIS de db/migrations, e nao
// contra exemplos que eu inventei: exemplo inventado prova que a regex casa com
// o que eu lembrei de escrever.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { objetosDe, semComentario } from './objetos-de-uma-migration.mjs'

const DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'db', 'migrations')
const ler = (f) => readFileSync(join(DIR, f), 'utf8')
const tem = (lista, tipo, alvo, dono) => lista.some((o) =>
  o.tipo === tipo && o.alvo === alvo && (dono === undefined || o.dono === dono))

test('acha tabela, funcao, trigger, policy e indice de uma migration real', () => {
  const o = objetosDe(ler('2026-08-18-fila-do-pdf-do-aceite.sql'))
  assert.ok(tem(o, 'tabela', 'frota_uso_pdf'), 'perdeu a tabela')
  assert.ok(tem(o, 'funcao', 'frota_uso_enfileirar_pdf'), 'perdeu a funcao')
  assert.ok(tem(o, 'trigger', 'trg_frota_uso_enfileirar_pdf'), 'perdeu o trigger')
  assert.ok(tem(o, 'policy', 'frota_uso_pdf_ler', 'frota_uso_pdf'), 'perdeu a policy')
})

test('acha policy com nome ENTRE ASPAS e espacos', () => {
  // `create policy "quem ve vendas grava vendedores" on public.bling_vendedores`
  const o = objetosDe(ler('2026-08-18-cache-de-vendas-so-quem-ve-vendas.sql'))
  assert.ok(tem(o, 'policy', 'quem ve vendas grava vendedores', 'bling_vendedores'),
    'policy com aspas e espaco passou batido')
})

test('acha view e indice unico', () => {
  assert.ok(tem(objetosDe(ler('2026-08-19-vigia-dos-robos-para-de-mentir.sql')), 'view', 'robos_saude'))
  const o = objetosDe(ler('2026-08-28-vessel-lista-de-espera.sql'))
  assert.ok(tem(o, 'indice', 'vessel_lista_espera_email_idx'), 'perdeu o indice unico')
  assert.ok(tem(o, 'tabela', 'vessel_lista_espera'))
})

test('acha COLUNA nova, e guarda a tabela dona junto', () => {
  const o = objetosDe(ler('2026-08-20-grupo-do-canal.sql'))
  assert.ok(tem(o, 'coluna', 'grupo', 'bling_lojas'),
    'coluna nova sem a tabela dona nao da para conferir')
})

test('NAO conta o que esta dentro de comentario', () => {
  // As migrations desta casa explicam o defeito no comentario, e varias citam
  // `create ...` como exemplo do que NAO fazer. Contar isso faria o conferidor
  // procurar no banco um objeto que nunca existiu, e reprovar uma migration
  // que esta aplicada — o alarme falso que ensina a ignorar o alarme.
  const sql = `
    -- create table public.nunca_existiu (id int);
    /* create function public.tambem_nao() returns void as $$ $$ language sql; */
    create table public.existe_de_verdade (id int);
  `
  const o = objetosDe(sql)
  assert.deepEqual(o.map((x) => x.alvo), ['existe_de_verdade'])
  assert.doesNotMatch(semComentario(sql), /nunca_existiu|tambem_nao/)
})

test('o mesmo objeto criado duas vezes conta UMA', () => {
  // `2026-08-30-vessel-zz-...` recria funcoes que ela mesma ja tinha citado.
  const o = objetosDe(`
    create or replace function public.f() returns void as $$ $$ language sql;
    create or replace function public.f() returns void as $$ $$ language sql;
  `)
  assert.equal(o.length, 1)
})

test('migration que so mexe em DADOS nao devolve objeto — e isso e de proposito', () => {
  // Ela sai como INCONCLUSIVA no conferidor, e `--registrar` a deixa de fora.
  // Melhor uma pendencia que sobra do que um registro que mente.
  const o = objetosDe(ler('2026-08-28-vessel-espelho-agendado.sql'))
  assert.deepEqual(o, [])
})

test('TODA migration do repositorio ou devolve objeto ou e so-dados', () => {
  // Varredura do diretorio INTEIRO, e nao dos arquivos que eu escolhi acima: e
  // assim que uma forma de `create` que ninguem usava ainda passa batida.
  const arquivos = readdirSync(DIR).filter((f) => f.endsWith('.sql'))
  assert.ok(arquivos.length > 100, `esperava 100+ migrations, achei ${arquivos.length}`)
  const mudas = []
  for (const f of arquivos) {
    const sql = semComentario(ler(f))
    const cria = /\bcreate\s+(or\s+replace\s+)?(table|view|function|trigger|policy|(unique\s+)?index|materialized)/i.test(sql)
      || /alter\s+table[\s\S]{0,80}?add\s+column/i.test(sql)
    if (cria && objetosDe(ler(f)).length === 0) mudas.push(f)
  }
  assert.deepEqual(mudas, [],
    'estas migrations criam objeto mas a extracao nao viu nenhum — o conferidor '
    + 'as daria como conferidas sem ter conferido nada')
})
