import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// A função do teto é chamada SÓ pela edge, com a chave de serviço. Se ficar
// concedida a `anon`, qualquer visitante a chama direto e enche (ou esvazia) o
// contador. E se o contador contar linhas `acertou = false`, quem digitar
// `teto:criar:global` como LOGIN (o `entrar` grava a chave como foi digitada)
// trava o cadastro de todo mundo.
const SQL = readFileSync(join(dirname(fileURLToPath(import.meta.url)),
  'migrations/2026-10-08-vessel-teto-de-chamadas.sql'), 'utf8').toLowerCase();
const CODIGO = SQL.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

test('⚠️ a função é revogada de anon E authenticated e concedida só a service_role', () => {
  const assinatura = 'vessel_teto_de_chamadas(text, int, int)';
  assert.ok(CODIGO.includes(`revoke all on function public.${assinatura} from public, anon, authenticated`));
  assert.ok(CODIGO.includes(`grant execute on function public.${assinatura} to service_role`));
  assert.ok(!/grant[^;]+\b(anon|authenticated)\b/.test(CODIGO.replace(/revoke[^;]+;/g, '')));
});

test('⚠️ só conta e só grava linhas `acertou = true` — a chave não se forja pelo login', () => {
  assert.match(CODIGO, /select count\(\*\)[\s\S]*?acertou = true/);
  assert.match(CODIGO, /insert into public\.vessel_tentativas_de_login \(chave, acertou\) values \(p_chave, true\)/);
  assert.ok(!/acertou = false/.test(CODIGO), 'contar `false` abre a forja pelo login');
});

test('só aceita chave com o prefixo `teto:` e limpa apenas a própria chave', () => {
  assert.match(CODIGO, /p_chave !~ '\^teto:'/);
  assert.match(CODIGO, /delete from public\.vessel_tentativas_de_login\s+where chave = p_chave/);
});
