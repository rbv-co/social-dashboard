// PROVA DA MIGRATION DOS CARTÕES, em transação com ROLLBACK.
// Nada do que acontece aqui fica no banco.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

const COLETOR = '/Users/erickmartins/iamundi/coletor';
for (const raw of readFileSync(join(COLETOR, '.env'), 'utf8').split('\n')) {
  const l = raw.trim(); if (!l || l.startsWith('#')) continue;
  const i = l.indexOf('='); if (i === -1) continue;
  const k = l.slice(0, i).trim(); let v = l.slice(i + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (!(k in process.env)) process.env[k] = v;
}
const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true, ca: readFileSync(join(COLETOR, 'supabase-ca.crt'), 'utf8') },
});
await client.connect();
const q = (sql, p) => client.query(sql, p);
const uma = async (sql, p) => (await q(sql, p)).rows[0];
let passou = 0, falhou = 0;
const conferir = (nome, ok, detalhe = '') => {
  if (ok) { passou++; console.log(`  ✓ ${nome}`); }
  else { falhou++; console.log(`  ✗ ${nome}${detalhe ? '  — ' + detalhe : ''}`); }
};

await q('begin');
try {
  // ⚠️ VESTIR UM ADMIN, DENTRO DA TRANSAÇÃO. Quase toda função desta tela é
  // gateada por `is_vessel_admin()`, que lê `auth.uid()` — e numa conexão
  // direta esse valor é nulo. Sem isto, a prova para no primeiro `sem_permissao`
  // e não chega a provar nada. O claim é LOCAL: some no rollback, e nenhuma
  // sessão de ninguém é copiada para cá.
  const admin = (await uma(
    `select id, email from public.profiles where is_superadmin order by created_at limit 1`));
  if (!admin) throw new Error('não achei nenhum superadmin para vestir');
  console.log(`   vestindo ${admin.email} (só dentro desta transação)\n`);
  await q(`select set_config('request.jwt.claims', json_build_object('sub', $1::text)::text, true)`, [admin.id]);

  console.log('── aplicando a migration dentro da transação');
  await q(readFileSync('/Users/erickmartins/iamundi/db/migrations/2026-09-11-vessel-cartoes-fila-e-trava.sql', 'utf8'));
  console.log('   aplicou sem erro\n');

  // Um lote de mentira, com 5 peças, num SKU que não existe.
  const lote = (await uma(`insert into public.vessel_lotes (modelo, cor, sku, quantidade, fabricado_em)
     values ('PROVA', 'Teste', 'ZZ9999XX.T9', 5, current_date) returning id`)).id;
  for (let n = 1; n <= 5; n++) {
    await q(`insert into public.vessel_pecas (codigo, lote_id, numero_na_serie) values ($1, $2, $3)`,
      [`PROVA${n}`, lote, n]);
  }
  const serie = async () => (await q(
    `select codigo, numero_na_serie from public.vessel_pecas where lote_id = $1 order by codigo`, [lote])).rows;

  // ── a definição de presa ──
  console.log('── a regra de "presa"');
  conferir('peça solta não está presa',
    (await uma(`select public.vessel_peca_presa('PROVA1') as m`)).m === null);
  await q(`update public.vessel_pecas set gravada_em = now() where codigo='PROVA1'`);
  conferir('gravada diz "gravada"',
    (await uma(`select public.vessel_peca_presa('PROVA1') as m`)).m === 'gravada');
  await q(`update public.vessel_pecas set cartao_gerado_em = now() where codigo='PROVA2'`);
  conferir('⚠️ com CARTÃO impresso diz "cartao" (é o que esta migration acrescenta)',
    (await uma(`select public.vessel_peca_presa('PROVA2') as m`)).m === 'cartao');

  // ── a trava no renumerar ──
  console.log('\n── o cartão impresso trava o número');
  await q(`update public.vessel_pecas set numero_na_serie = 40 + numero_na_serie where lote_id = $1`, [lote]);
  const antes = await serie();
  await q(`select public.vessel_renumerar_lote($1)`, [lote]);
  const depois = await serie();
  const doCartao = (linhas) => linhas.find((l) => l.codigo === 'PROVA2').numero_na_serie;
  const daSolta = (linhas) => linhas.find((l) => l.codigo === 'PROVA4').numero_na_serie;
  conferir('a peça COM cartão mantém o número',
    doCartao(antes) === doCartao(depois), `${doCartao(antes)} → ${doCartao(depois)}`);
  conferir('a peça sem nada foi renumerada',
    daSolta(antes) !== daSolta(depois), `${daSolta(antes)} → ${daSolta(depois)}`);

  // ── e no excluir ──
  console.log('\n── o cartão impresso impede apagar o lote');
  await q(`update public.vessel_pecas set gravada_em = null where lote_id = $1`, [lote]);
  const rec = (await uma(`select public.vessel_excluir_lote($1) as r`, [lote])).r;
  conferir('recusa com motivo "tem_cartao"', rec.motivo === 'tem_cartao', JSON.stringify(rec));
  conferir('diz QUANTAS peças têm cartão', rec.cartoes === 1, JSON.stringify(rec));

  // ── e no encolher pela edição ──
  console.log('\n── e impede encolher o lote por baixo dele');
  const ed = (await uma(
    `select public.vessel_editar_lote($1, 'PROVA', 'Teste', 'ZZ9999XX.T9', current_date, 0, null) as r`, [lote])).r;
  conferir('quantidade 0 é recusada', ed.ok === false, JSON.stringify(ed));

  // ── o pedido ──
  console.log('\n── pedir cartões');
  const vazio = (await uma(`select public.vessel_pedir_cartoes(array[]::text[]) as r`)).r;
  conferir('sem peça nenhuma: recusa', vazio.motivo === 'nenhuma_peca', JSON.stringify(vazio));
  const inexistente = (await uma(`select public.vessel_pedir_cartoes(array['NAOEXISTE']) as r`)).r;
  conferir('peça que não existe: recusa ANTES de entrar na fila',
    inexistente.motivo === 'peca_nao_existe', JSON.stringify(inexistente));

  // ⚠️ A MESMA PEÇA DUAS VEZES VIRA UMA. Marcar duas vezes na tela não pode
  // render dois cartões com o mesmo número de série — foi esse o defeito de
  // 09/09, por outro caminho.
  const feito = (await uma(`select public.vessel_pedir_cartoes(array['PROVA3','PROVA3','PROVA5']) as r`)).r;
  conferir('o pedido entra na fila', feito.ok === true, JSON.stringify(feito));
  conferir('a peça repetida conta UMA vez', feito.pecas === 2, JSON.stringify(feito));
  conferir('avisa quantas estão sendo REFEITAS', feito.refazendo === 0, JSON.stringify(feito));
  const pedido = feito.pedido;

  // E sem sessão de admin nenhuma peça entra.
  await q(`select set_config('request.jwt.claims', null, true)`);
  conferir('sem sessão de admin, o pedido é recusado',
    (await uma(`select public.vessel_pedir_cartoes(array['PROVA5']) as r`)).r.motivo === 'sem_permissao');
  await q(`select set_config('request.jwt.claims', json_build_object('sub', $1::text)::text, true)`, [admin.id]);

  console.log('\n── a fila');
  const pego = (await uma(`select public.vessel_cartao_pegar_da_fila() as r`)).r;
  conferir('o robô pega o pedido e ele vira "rodando"',
    pego.pedido && pego.pedido.situacao === 'rodando', JSON.stringify(pego.pedido?.situacao));
  conferir('não sobra ninguém na fila',
    (await uma(`select public.vessel_cartao_pegar_da_fila() as r`)).r.pedido === null);
  conferir('⚠️ pedido em aberto JÁ prende o número (antes de o arquivo existir)',
    (await uma(`select public.vessel_peca_presa('PROVA3') as m`)).m === 'cartao');

  const fim = (await uma(
    `select public.vessel_cartao_pedido_terminou($1, true, 'Cartões com EAN/2026-09-11', null, array['PROVA3']) as r`,
    [pedido])).r;
  conferir('terminar marca SÓ as peças confirmadas', fim.marcadas === 1, JSON.stringify(fim));
  conferir('a peça confirmada ficou marcada',
    (await uma(`select cartao_gerado_em is not null as m from public.vessel_pecas where codigo='PROVA3'`)).m === true);
  conferir('⚠️ a peça NÃO confirmada continua livre',
    (await uma(`select cartao_gerado_em is null as m from public.vessel_pecas where codigo='PROVA5'`)).m === true);
  conferir('o pedido guardou a pasta',
    (await uma(`select pasta from public.vessel_cartao_pedidos where id=$1`, [pedido])).pasta
      === 'Cartões com EAN/2026-09-11');

  // ── a trava da tabela ──
  console.log('\n── a trava da tabela nova');
  const trava = await q(`select relrowsecurity from pg_class where oid='public.vessel_cartao_pedidos'::regclass`);
  conferir('RLS ligada', trava.rows[0].relrowsecurity === true);
  const grants = (await q(`select grantee, privilege_type from information_schema.role_table_grants
     where table_schema='public' and table_name='vessel_cartao_pedidos'
       and grantee in ('anon','authenticated')`)).rows;
  const soLeitura = grants.filter((g) => g.grantee === 'authenticated').map((g) => g.privilege_type).sort();
  // ⚠️ NADA ALÉM DE SELECT — nem `references`, nem `trigger`. Ver o comentário
  // da migration: a lista nominal de revoke deixava os dois de pé.
  conferir('authenticated só LÊ', JSON.stringify(soLeitura) === '["SELECT"]', JSON.stringify(soLeitura));
  conferir('anon não alcança nada',
    grants.filter((g) => g.grantee === 'anon').length === 0,
    JSON.stringify(grants.filter((g) => g.grantee === 'anon')));
  // E a peça continua legível por quem é admin: a trava não pode cegar a tela.
  conferir('a tela ainda lê os pedidos',
    (await q(`select id from public.vessel_cartao_pedidos`)).rows.length >= 1);

  console.log(`\nPASSOU: ${passou}   FALHOU: ${falhou}`);
} catch (e) {
  console.error('\n✗ ERRO:', e.message);
  falhou++;
} finally {
  await q('rollback');
  console.log('\n↩︎ rollback — nada ficou no banco');
  await client.end();
}
process.exit(falhou ? 1 : 0);
