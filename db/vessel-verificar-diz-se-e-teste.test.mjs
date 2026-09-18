import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SQL = readFileSync(join(dirname(fileURLToPath(import.meta.url)),
  'migrations/2026-09-18-vessel-verificar-diz-se-e-teste.sql'), 'utf8').toLowerCase();

// A pagina /verify/novo decidia "e peca de teste?" pelo prefixo TESTE- do
// SKU. O lote de teste real usa o SKU verdadeiro SS1088-Mostarda e so e
// teste porque vessel_lotes.teste = true no banco — a pagina nunca via isso
// e o botao de registro nascia hidden para sempre. Aqui provamos que
// vessel_verificar passou a expor esse campo, lido do lugar certo.
test('⚠️ vessel_verificar devolve o campo teste, lido de vessel_lotes.teste', () => {
  const f = SQL.slice(SQL.indexOf('function public.vessel_verificar'));
  assert.match(f, /l\.teste/, 'o select precisa trazer l.teste do lote');
  assert.match(f, /'teste',\s*coalesce\(v_peca\.teste,\s*false\)/,
    'o json de retorno precisa da chave teste, lida de vessel_lotes via v_peca');
});

test('vessel_verificar continua gravando em vessel_leituras (achou ou nao)', () => {
  const f = SQL.slice(SQL.indexOf('function public.vessel_verificar'));
  assert.match(f, /insert into public\.vessel_leituras/,
    'toda leitura, achando ou nao o codigo, tem de continuar gravada');
  assert.match(f, /v_peca\.codigo is not null/);
});

test('⚠️ nenhuma chave existente do retorno foi removida ou renomeada', () => {
  const f = SQL.slice(SQL.indexOf('function public.vessel_verificar'));
  const chaves = [
    "'ok'", "'modelo'", "'cor'", "'sku'", "'numero'", "'total'",
    "'fabricado_em'", "'fotos'", "'registrada'", "'dono_curto'",
    "'pode_revelar'", "'registrada_em'", "'garantia_ate'",
  ];
  for (const chave of chaves) {
    assert.ok(f.includes(chave), `retorno de vessel_verificar perdeu a chave ${chave}`);
  }
});

test('a assinatura da funcao nao muda — create or replace, mesmo parametro', () => {
  assert.match(SQL, /create or replace function public\.vessel_verificar\(p_codigo text\)/);
});
