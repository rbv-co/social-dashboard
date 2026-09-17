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

test('⚠️ ja_tem_dono e dono_curto atravessam — senão peça com dona vira "livre" calado', () => {
  // vessel_abrir_pedido_de_registro já devolve os dois campos; a versão
  // anterior de vessel_registrar_como_cliente montava o retorno do zero
  // (json_build_object com só ok/pedido/sku/cliente_id) e os dois se
  // perdiam — a página não teria como avisar a cliente que a peça já tem
  // dona. Rodada de correção 2 da Tarefa 7.
  const f = SQL.slice(SQL.indexOf('function public.vessel_registrar_como_cliente'),
                       SQL.indexOf('-- ── o portão'));
  assert.match(f, /'ja_tem_dono'/, 'o retorno de vessel_registrar_como_cliente precisa de ja_tem_dono');
  assert.match(f, /'dono_curto'/, 'o retorno de vessel_registrar_como_cliente precisa de dono_curto');
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
