import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Achado de segurança (18/09/2026): a aprovação automática ('bling') gravava
// com `on conflict do update` e TOMAVA a peça de quem já era dona. A trava
// mora em vessel_decidir_pedido_de_registro e só vale para 'bling' + aprovado.

const PASTA = join(dirname(fileURLToPath(import.meta.url)), 'migrations');
const NOVA = '2026-09-18-zzzz-vessel-registro-nao-toma-peca-com-dona.sql';
const ANTERIOR = '2026-09-18-zz-vessel-garantia-pelo-material.sql';

const ler = (nome) => readFileSync(join(PASTA, nome), 'utf8');

function corpoDaFuncao(sql) {
  const ini = sql.indexOf('create or replace function public.vessel_decidir_pedido_de_registro');
  const fim = sql.indexOf('$function$;', ini);
  assert.ok(ini >= 0 && fim > ini, 'achei a função no arquivo');
  return sql.slice(ini, fim);
}

// tira o bloco novo (entre as marcas), os comentários e junta os espaços
function semATrava(corpo) {
  return corpo
    .replace(/-- >>> TRAVA DA DONA[\s\S]*?-- <<< TRAVA DA DONA/g, '')
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const NOVO = corpoDaFuncao(ler(NOVA));
const VELHO = corpoDaFuncao(ler(ANTERIOR));
const TRAVA = NOVO.match(/-- >>> TRAVA DA DONA \(18\/09[\s\S]*?-- <<< TRAVA DA DONA/)?.[0] ?? '';

test('⚠️ a migration nova é a ÚLTIMA a redefinir a função (senão a zz- a apaga)', () => {
  const ordem = readdirSync(PASTA).filter((f) => f.endsWith('.sql')).sort();
  const mexem = ordem.filter((f) =>
    /create or replace function public\.vessel_decidir_pedido_de_registro/i.test(ler(f)));
  assert.equal(mexem.at(-1), NOVA);
  assert.ok(ordem.indexOf(NOVA) > ordem.indexOf('2026-09-18-zzz-vessel-verificar-nome-completo.sql'),
    'tem de ordenar depois da zzz-');
});

test('⚠️ fora do bloco da trava, a função é IDÊNTICA à anterior (= banco)', () => {
  assert.equal(semATrava(NOVO), semATrava(VELHO));
});

test('a trava só vale para bling + aprovado, e vem ANTES do update e do insert', () => {
  assert.ok(TRAVA, 'bloco da trava existe');
  assert.match(TRAVA, /if p_quem_decidiu = 'bling' and p_estado = 'aprovado' then/);
  const posTrava = NOVO.indexOf('-- >>> TRAVA DA DONA (18/09');
  const posUpdate = NOVO.indexOf('update public.vessel_pedidos_de_registro\n     set estado = p_estado');
  const posInsert = NOVO.indexOf('insert into public.vessel_registros');
  assert.ok(posTrava > 0 && posTrava < posUpdate && posUpdate < posInsert);
  assert.doesNotMatch(TRAVA, /na_mao/, 'o caminho na_mao não é tocado');
});

test('⚠️ a) CPF diferente (ou registro sem CPF) → ja_tem_dona, sem gravar nada', () => {
  const a = TRAVA.slice(TRAVA.indexOf('if found then'), TRAVA.indexOf("'ja_tem_dona'"));
  assert.match(a, /coalesce\(v_reg\.cpf, ''\), '\\D', '', 'g'\) = ''/);
  assert.match(a, /<>/);
  assert.doesNotMatch(a, /update|insert/i);
  assert.match(TRAVA, /json_build_object\('ok', false, 'motivo', 'ja_tem_dona'\)/);
});

test('b) mesmo CPF → fecha o pedido sem tocar vessel_registros nem vessel_edicoes', () => {
  const b = TRAVA.slice(TRAVA.indexOf("'ja_tem_dona'"), TRAVA.indexOf('-- c)'));
  assert.match(b, /update public\.vessel_pedidos_de_registro/);
  assert.match(b, /motivo = 'já registrada no mesmo CPF'/);
  assert.match(b, /'ja_era_sua', true/);
  assert.match(b, /'garantia_ate', v_reg\.garantia_ate/);
  assert.doesNotMatch(b, /vessel_registros|vessel_edicoes/);
});

test('c) pedido do Bling já sustenta outra peça do mesmo SKU → pedido_ja_usado', () => {
  const c = TRAVA.slice(TRAVA.indexOf('-- c)'));
  assert.match(c, /r\.bling_pedido = p_conferencia ->> 'pedido'/);
  assert.match(c, /r\.codigo <> v_ped\.codigo/);
  assert.match(c, /l\.sku is not distinct from v_sku/);
  assert.match(c, /'motivo', 'pedido_ja_usado'/);
});

test("⚠️ 'bling' só para a chave de serviço ou o dono do banco — antes de ler qualquer tabela", () => {
  const ini = NOVO.indexOf("-- >>> TRAVA DA DONA (quem pode dizer 'bling')");
  const fim = NOVO.indexOf('-- <<< TRAVA DA DONA', ini);
  assert.ok(ini > 0 && fim > ini, 'bloco do portão existe');
  const portao = NOVO.slice(ini, fim);
  assert.match(portao, /if p_quem_decidiu = 'bling' and not \(/);
  assert.match(portao, /current_setting\('role', true\) = 'service_role'\s+and coalesce\(auth\.role\(\), 'service_role'\) = 'service_role'/);
  assert.match(portao, /current_setting\('role', true\) = 'none' and auth\.role\(\) is null/);
  assert.match(portao, /'motivo', 'sem_permissao'/);
  assert.doesNotMatch(portao, /current_user|session_user/, 'current_user é sempre o dono da função; session_user não distingue');
  assert.ok(ini < NOVO.indexOf('from public.vessel_pedidos_de_registro'), 'barra antes de ler o pedido');
  // o portão do na_mao continua o mesmo, e vem antes
  assert.ok(NOVO.indexOf("if p_quem_decidiu = 'na_mao' and not public.is_vessel_admin() then") < ini);
});

test('trava contra corrida: linha da peça e número do pedido do Bling', () => {
  assert.match(TRAVA, /for no key update of p/);
  assert.match(TRAVA, /pg_advisory_xact_lock\(\s*hashtext\('vessel_bling_pedido:'/);
});

test('⚠️ assinatura igual e nenhuma grant/revoke nesta migration', () => {
  assert.match(NOVO, /vessel_decidir_pedido_de_registro\(\s*p_pedido uuid, p_estado text, p_quem_decidiu text,\s*p_conferencia jsonb default null::jsonb, p_motivo text default null::text\s*\) returns json/);
  assert.match(NOVO, /security definer/);
  const sql = ler(NOVA).split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
  assert.doesNotMatch(sql, /\bgrant\b|\brevoke\b/i);
  assert.doesNotMatch(sql, /set_config|request\.jwt/i, 'nada se passa por admin');
});
