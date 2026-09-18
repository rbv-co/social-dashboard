import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/* ⚠️ POR QUE ESTE ARQUIVO EXISTE
 *
 * A chave anônima da Supabase está DENTRO do HTML das páginas públicas. Se uma
 * destas funções ficar concedida a `anon`, qualquer visitante chama
 * `vessel_conta_entrar` direto e a página vira chutador de senha; se
 * `vessel_clientes` ganhar política aberta, a lista de clientes vaza.
 * Já aconteceu no projeto de uma tabela nova nascer sem a trava das irmãs. */

const SQL = readFileSync(join(dirname(fileURLToPath(import.meta.url)),
  'migrations/2026-09-17-vessel-contas-base.sql'), 'utf8').toLowerCase();

test('⚠️ as três tabelas nascem com RLS ligada', () => {
  for (const t of ['vessel_clientes', 'vessel_sessoes', 'vessel_tentativas_de_login']) {
    assert.match(SQL, new RegExp(`alter table public.${t}\\s+enable row level security`));
  }
});

test('⚠️ sessão e tentativas não têm política nenhuma', () => {
  for (const t of ['vessel_sessoes', 'vessel_tentativas_de_login']) {
    assert.ok(!new RegExp(`create policy[^;]+on public.${t}`).test(SQL),
      `${t} não pode ter política: token de sessão não se lê em tela`);
  }
});

test('⚠️ a política de clientes é SÓ de leitura e gateada por is_vessel_admin', () => {
  const m = SQL.match(/create policy[^;]+on public\.vessel_clientes[^;]+;/);
  assert.ok(m, 'falta a política de leitura do painel');
  assert.match(m[0], /for select/);
  assert.match(m[0], /is_vessel_admin\(\)/);
});

test('⚠️ as seis funções de conta são revogadas de anon E authenticated, uma a uma', () => {
  // ⚠️ A primeira versão deste teste casava com o TEXTO LITERAL '%s' do
  // format() — passava mesmo se o array esquecesse uma função, ou se o
  // revoke/grant não rodasse em nenhuma delas. Aqui o teste acha o bloco
  // `do $$ ... end $$` e exige as SEIS assinaturas, uma a uma, pelo nome.
  const bloco = SQL.match(/do \$\$[\s\S]*?end \$\$;/);
  assert.ok(bloco, 'falta o bloco do $$ que revoga e concede as funções de conta');
  const assinaturas = [
    'vessel_conta_criar(text,text,text,text,date,text)',
    'vessel_conta_entrar(text,text,boolean,text,text)',
    'vessel_conta_da_sessao(text)',
    'vessel_conta_sair(text,boolean)',
    'vessel_conta_pedido_de_nova_senha(text)',
    'vessel_conta_efetivar_nova_senha(uuid,text)',
    'vessel_conta_editar(text,text,text,text,text)',
  ];
  for (const assinatura of assinaturas) {
    assert.ok(bloco[0].includes(`'${assinatura}'`),
      `falta ${assinatura} no array que revoga/concede`);
  }
  assert.match(bloco[0], /revoke all on function public\.%s from public, anon, authenticated/);
  assert.match(bloco[0], /grant execute on function public\.%s to service_role/);
});

test('⚠️ nenhuma função ganha grant para anon ou authenticated em lugar nenhum do arquivo', () => {
  assert.ok(!/grant execute on function[^;]*\bto\b[^;]*\b(anon|authenticated)\b/.test(SQL));
});

test('⚠️ pgcrypto é chamado qualificado (extensions.)', () => {
  for (const f of ['crypt(', 'gen_salt(', 'digest(', 'gen_random_bytes(']) {
    const solto = new RegExp(`(?<!extensions\\.)\\b${f.replace('(', '\\(')}`);
    assert.ok(!solto.test(SQL), `${f} sem o prefixo extensions. quebra com search_path=public`);
  }
});

test('⚠️ a senha é guardada com bcrypt, nunca em claro nem em sha', () => {
  assert.match(SQL, /extensions\.crypt\([^)]*extensions\.gen_salt\('bf'/);
});

test('⚠️ C6 — vessel_conta_criar exige CPF com dígito verificador válido, não só 11 dígitos', () => {
  // Antes, "11111111111" (e qualquer sequência de 11 dígitos) passava aqui.
  // `vessel_abrir_pedido_de_registro` recusa esse mesmo CPF depois, quando a
  // cliente tenta registrar a peça — e como o CPF não muda pelo perfil, a
  // conta fica morta para sempre, sem formulário nenhum na tela para
  // consertar.
  const f = SQL.slice(SQL.indexOf('function public.vessel_conta_criar'),
                       SQL.indexOf('-- ── entrar'));
  assert.match(f, /vessel_cpf_valido\(v_cpf\)/,
    'vessel_conta_criar precisa da MESMA validação de vessel_abrir_pedido_de_registro');
});

test('⚠️ C4 — "esqueci a senha" vira dois passos: pedir, depois efetivar', () => {
  // A senha só pode trocar DEPOIS que o e-mail sair — a função que troca não
  // pode mais ser a mesma que decide para onde mandar.
  assert.match(SQL, /function public\.vessel_conta_pedido_de_nova_senha\(p_login text\)/);
  assert.match(SQL, /function public\.vessel_conta_efetivar_nova_senha\(p_cliente_id uuid, p_senha text\)/);
  assert.ok(!SQL.includes('function public.vessel_conta_nova_senha('),
    'a função antiga (que trocava a senha ANTES de mandar o e-mail) não pode sobrar');
});

test('⚠️ C4 — o pedido de nova senha tem teto de 3 por hora, contado ache ou não o perfil', () => {
  const f = SQL.slice(SQL.indexOf('function public.vessel_conta_pedido_de_nova_senha'),
                       SQL.indexOf('function public.vessel_conta_efetivar_nova_senha'));
  assert.match(f, /interval '1 hour'/);
  assert.match(f, />=\s*3/);
  // a contagem tem de acontecer ANTES do "if v_c.id is null": senão um login
  // sem perfil nunca bateria no teto, e essa diferença de comportamento já
  // seria o vazamento que a resposta idêntica existe para fechar.
  const posConta = f.search(/insert into public\.vessel_tentativas_de_login/);
  const posAcha = f.search(/v_c\.id is null/);
  assert.ok(posConta > -1 && posAcha > -1 && posConta < posAcha,
    'o pedido tem de ser contado antes de saber se o perfil existe');
});

test('⚠️ C4 — efetivar a senha nova derruba as sessões abertas', () => {
  const f = SQL.slice(SQL.indexOf('function public.vessel_conta_efetivar_nova_senha'));
  assert.match(f, /update public\.vessel_sessoes set encerrada_em = now\(\)/);
});
