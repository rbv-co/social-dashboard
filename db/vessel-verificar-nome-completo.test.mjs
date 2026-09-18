import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Decisão do dono (18/09/2026): o certificado real mostra o NOME COMPLETO da
// dona. `dono_nome` passa a vir sempre que `dono_curto` vem — mesmo portão —
// e nada mais muda em vessel_verificar.

const PASTA = join(dirname(fileURLToPath(import.meta.url)), 'migrations');
const NOVA = '2026-09-18-zzz-vessel-verificar-nome-completo.sql';
const ANTERIOR = '2026-09-18-zz-vessel-garantia-pelo-material.sql';

const ler = (nome) => readFileSync(join(PASTA, nome), 'utf8').toLowerCase();

function corpoDaFuncao(sql) {
  const ini = sql.indexOf('create or replace function public.vessel_verificar');
  const fim = sql.indexOf('$$;', ini);
  return sql.slice(ini, fim);
}

// tira comentários de linha e a linha do dono_nome, e junta os espaços
function semDonoNome(corpo) {
  return corpo
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .filter((l) => !l.includes("'dono_nome'"))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const NOVO = corpoDaFuncao(ler(NOVA));
const VELHO = corpoDaFuncao(ler(ANTERIOR));

test('⚠️ a migration nova roda DEPOIS da zz-garantia (senão é apagada por ela)', () => {
  const ordem = readdirSync(PASTA).filter((f) => f.endsWith('.sql')).sort();
  const ultimasQueMexem = ordem.filter((f) => ler(f).includes('function public.vessel_verificar'));
  assert.equal(ultimasQueMexem.at(-1), NOVA,
    'a última migration a redefinir vessel_verificar tem de ser a do nome completo');
});

test('⚠️ dono_nome usa exatamente o portão do dono_curto (nome curto existe)', () => {
  const linha = NOVO.split('\n').find((l) => l.includes("'dono_nome'"));
  assert.match(linha,
    /'dono_nome',\s*case\s+when\s+public\.vessel_nome_curto\(v_reg\.nome\)\s+is\s+not\s+null\s+then\s+v_reg\.nome\s+else\s+null\s+end/);
  assert.doesNotMatch(linha, /v_peca\.teste/, 'o nome completo não depende mais do lote de teste');
});

test('dono_curto continua igual, para toda peça', () => {
  assert.match(NOVO, /'dono_curto',\s*public\.vessel_nome_curto\(v_reg\.nome\)/);
});

test('⚠️ fora a linha do dono_nome, a função é IDÊNTICA à que está no banco', () => {
  assert.equal(semDonoNome(NOVO), semDonoNome(VELHO));
});

test('⚠️ nenhuma grant/revoke nesta migration — as permissões ficam como estão', () => {
  const sql = ler(NOVA).split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
  assert.doesNotMatch(sql, /\bgrant\b|\brevoke\b/);
});
