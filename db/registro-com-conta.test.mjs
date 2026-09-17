import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SQL = readFileSync(join(dirname(fileURLToPath(import.meta.url)),
  'migrations/2026-09-17-vessel-registro-com-conta.sql'), 'utf8').toLowerCase();

test('⚠️ registrar exige sessão', () => {
  const f = SQL.slice(SQL.indexOf('function public.vessel_registrar_como_cliente'));
  assert.match(f, /vessel_conta_da_sessao/);
  assert.match(f, /sem_sessao/);
});

test('⚠️ as duas funções novas são revogadas de anon E authenticated, uma a uma', () => {
  // ⚠️ A primeira versão deste teste casava o NOME DA FUNÇÃO colado ao texto
  // '...to (anon|authenticated)' — mas o revoke/grant deste arquivo é montado
  // num LAÇO com `format('grant execute on function public.%s to
  // service_role', f)`. O papel de verdade não está perto do nome nenhuma vez:
  // está uma linha abaixo, dentro do template. Trocar `service_role` por
  // `authenticated` no format() fazia o teste antigo continuar VERDE — teste
  // que não prova nada. Aqui: acha o bloco `do $$ ... end $$` e exige as DUAS
  // assinaturas, uma a uma, pelo nome, e confere o TEXTO do template de
  // revoke/grant (mesmo padrão de db/contas-nascem-fechadas.test.mjs).
  const bloco = SQL.match(/do \$\$[\s\S]*?end \$\$;/);
  assert.ok(bloco, 'falta o bloco do $$ que revoga e concede as funções novas');
  const assinaturas = [
    'vessel_registrar_como_cliente(text,text,text,date)',
    'vessel_candidatos_de_presente(text)',
  ];
  for (const assinatura of assinaturas) {
    assert.ok(bloco[0].includes(`'${assinatura}'`),
      `falta ${assinatura} no array que revoga/concede`);
  }
  assert.match(bloco[0], /revoke all on function public\.%s from public, anon, authenticated/);
  assert.match(bloco[0], /grant execute on function public\.%s to service_role/);
});

test('⚠️ nenhuma função ganha grant para anon ou authenticated em lugar nenhum do arquivo', () => {
  // Olha o TEXTO inteiro, inclusive dentro de um format(...): se o template do
  // grant virar '...to authenticated', esta regex casa mesmo sem `format` ter
  // rodado — é o que faltava no teste anterior.
  assert.ok(!/grant execute on function[^;]*\bto\b[^;]*\b(anon|authenticated)\b/.test(SQL));
});

test('a marca PRESENTE é lida sem acento e sem maiúscula', () => {
  assert.match(SQL, /translate\(lower\(p_texto\)/);
});

test('⚠️ vessel_aprovar_presente NÃO existe — a aprovação usa vessel_decidir_pedido_de_registro', () => {
  assert.ok(!SQL.includes('vessel_aprovar_presente'));
});
