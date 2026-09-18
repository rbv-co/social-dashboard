import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SQL = readFileSync(join(dirname(fileURLToPath(import.meta.url)),
  'migrations/2026-09-18-vessel-verificar-nome-completo-no-teste.sql'), 'utf8').toLowerCase();

// Pedido do dono (17/09/2026): nome completo na peca, sem abreviar. Alcance
// decidido pelo dono: SO para peca de lote de teste (vessel_lotes.teste),
// para nao deixar as clientes reais das 157 bolsas consultaveis pela chave
// anonima do HTML publico antes da Fase 2.

test('⚠️ o campo dono_nome existe no retorno de vessel_verificar', () => {
  const f = SQL.slice(SQL.indexOf('function public.vessel_verificar'));
  assert.match(f, /'dono_nome'/, 'falta a chave dono_nome no json_build_object');
});

test('⚠️ dono_nome so vem preenchido quando a peca e de lote de teste (v_peca.teste)', () => {
  const f = SQL.slice(SQL.indexOf('function public.vessel_verificar'));
  const trecho = f.slice(f.indexOf("'dono_nome'"), f.indexOf("'pode_revelar'"));
  assert.match(trecho, /case\s+when\s+coalesce\(v_peca\.teste,\s*false\)\s+then\s+v_reg\.nome\s+else\s+null\s+end/,
    'dono_nome tem que ser condicional a v_peca.teste, com else null explicito');
});

test('⚠️ fora do lote de teste, dono_nome vem null — nunca o nome completo por acidente', () => {
  const f = SQL.slice(SQL.indexOf('function public.vessel_verificar'));
  const trecho = f.slice(f.indexOf("'dono_nome'"), f.indexOf("'pode_revelar'"));
  assert.match(trecho, /else\s+null\s+end/, 'sem o else null, peca de verdade tambem devolveria o nome completo');
});

test('dono_curto continua existindo, sem mudanca, para toda peca', () => {
  const f = SQL.slice(SQL.indexOf('function public.vessel_verificar'));
  assert.match(f, /'dono_curto',\s*public\.vessel_nome_curto\(v_reg\.nome\)/,
    'dono_curto precisa continuar exatamente como estava, para toda peca (teste ou nao)');
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
    "'fabricado_em'", "'fotos'", "'teste'", "'registrada'", "'dono_curto'",
    "'pode_revelar'", "'registrada_em'", "'garantia_ate'",
  ];
  for (const chave of chaves) {
    assert.ok(f.includes(chave), `retorno de vessel_verificar perdeu a chave ${chave}`);
  }
});

test('a assinatura da funcao nao muda — create or replace, mesmo parametro', () => {
  assert.match(SQL, /create or replace function public\.vessel_verificar\(p_codigo text\)/);
});
