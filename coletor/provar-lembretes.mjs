// PROVA POR ROLLBACK do "Register Later" (o lembrete de registrar depois).
//
// Desenho:   docs/superpowers/specs/2026-09-19-register-later-design.md
// Migration: db/migrations/2026-09-19-zzz-vessel-lembretes-register-later.sql
//
// ⚠️ NADA É GRAVADO NO BANCO REAL. Tudo acontece dentro de um `begin` que
// termina em `rollback`, inclusive a aplicação da própria migration — dá para
// rodar contra o banco de verdade sem medo, e foi assim que esta entrega foi
// provada ANTES de alguém aplicar coisa nenhuma.
//
// As irmãs deste arquivo são os `.prova.sql` de db/provas/. Esta é em node
// porque o que se prova aqui não é só o que o banco RESPONDE: é que a resposta
// seja BYTE POR BYTE a mesma em situações diferentes (peça livre, peça com
// dona, segundo pedido no mesmo dia, peça que não existe) — e isso se compara
// melhor em JavaScript do que em `select`.
//
// Uso:  node coletor/provar-lembretes.mjs
//
// ⚠️ EM WORKTREE NOVO, `coletor/node_modules` e `coletor/.env` não vêm junto
// (o primeiro não se versiona, o segundo é gitignored). Sem eles o script nem
// arranca. Copie o `.env` do checkout principal e rode `npm install` dentro de
// `coletor/` — ou aponte a pasta do principal com um link.
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, '..');
const MIGRATION = join(RAIZ, 'db/migrations/2026-09-19-zzz-vessel-lembretes-register-later.sql');

function lerEnv(p) {
  const o = {};
  for (const raw of readFileSync(p, 'utf8').split('\n')) {
    const l = raw.trim();
    if (!l || l.startsWith('#')) continue;
    const i = l.indexOf('=');
    if (i < 0) continue;
    let v = l.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    o[l.slice(0, i).trim()] = v;
  }
  return o;
}
// ⚠️ A DATABASE_URL É LIDA AQUI DENTRO e não sai em nenhuma linha de saída.
const E = lerEnv(join(AQUI, '.env'));

const AS_14 = ['desmarcar_gravada','sobrescrever_para_fila','sobrescrever_para_baixa',
  'registro_aprovado','registro_recusado','dono_trocado','baixar_garantia',
  'lote_excluido','peca_excluida','etiqueta_adotada','numero_trocado',
  'transferida_pela_dona','material_do_lote','conta_ligada_pelo_cpf'];

let passou = 0, falhou = 0;
const ok = (nome, cond, extra = '') => {
  if (cond) { passou++; console.log(`  OK   ${nome}${extra ? ' — ' + extra : ''}`); }
  else { falhou++; console.log(`  FALHA ${nome}${extra ? ' — ' + extra : ''}`); }
};
const mesmaResposta = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const c = new pg.Client({ connectionString: E.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

try {
  await c.query('begin');

  // ── 0. a lista fechada de acoes ANTES ────────────────────────────────────
  const antes = (await c.query(
    `select pg_get_constraintdef(oid) d from pg_constraint where conname='vessel_edicoes_acao_check'`)).rows[0].d;
  const acoesAntes = [...antes.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]);
  console.log(`\n[0] a lista fechada de vessel_edicoes.acao ANTES: ${acoesAntes.length} acoes`);

  // ── 1. aplica a migration ────────────────────────────────────────────────
  console.log('\n[1] aplicando a migration dentro da transacao...');
  await c.query(readFileSync(MIGRATION, 'utf8'));
  console.log('    aplicou sem erro.');

  const depois = (await c.query(
    `select pg_get_constraintdef(oid) d from pg_constraint where conname='vessel_edicoes_acao_check'`)).rows[0].d;
  const acoesDepois = [...depois.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]);
  ok('as 14 acoes da trilha continuam LA, intocadas',
    AS_14.every((a) => acoesDepois.includes(a)) && acoesDepois.length === 14,
    `${acoesDepois.length} acoes: ${acoesDepois.join(',')}`);

  // ── 2. dados de ensaio ───────────────────────────────────────────────────
  const lote = (await c.query(
    `insert into public.vessel_lotes (modelo, cor, sku, quantidade, fabricado_em, teste, material)
     values ('ENSAIO LEMBRETE','Preto','ENSAIO-LEMBRETE',3, current_date, true, 'canvas')
     returning id`)).rows[0].id;
  const LIVRE = 'ENSAIOLEMBRETE1';
  const COMDONA = 'ENSAIOLEMBRETE2';
  const SEGUNDA = 'ENSAIOLEMBRETE3';
  for (const [i, cod] of [LIVRE, COMDONA, SEGUNDA].entries()) {
    await c.query(`insert into public.vessel_pecas (codigo, lote_id, numero_na_serie) values ($1,$2,$3)`,
      [cod, lote, i + 1]);
  }
  await c.query(
    `insert into public.vessel_registros (codigo, nome, whatsapp, cpf) values ($1,'Dona do Ensaio','','39053344705')`,
    [COMDONA]);
  console.log(`\n[2] 3 pecas de ensaio criadas; ${COMDONA} ja tem dona.`);

  const criar = async (cod, email, tok, cons) =>
    (await c.query(`select public.vessel_lembrete_criar($1,$2,$3,$4) r`, [cod, email, tok, cons])).rows[0].r;
  const contar = async (cod) =>
    Number((await c.query(`select count(*) n from public.vessel_lembretes where peca_codigo=$1`, [cod])).rows[0].n);

  // ── 3. cria lembrete em peca livre ───────────────────────────────────────
  console.log('\n[3] criar lembrete');
  const rSucesso = await criar(LIVRE, '  Ana@Exemplo.COM ', null, true);
  ok('peca livre: cria', mesmaResposta(rSucesso, { ok: true }) && (await contar(LIVRE)) === 1,
    JSON.stringify(rSucesso));
  const linha = (await c.query(`select * from public.vessel_lembretes where peca_codigo=$1`, [LIVRE])).rows[0];
  ok('e-mail guardado com trim e minusculo', linha.email === 'ana@exemplo.com', linha.email);
  ok('consentimento_em gravado', linha.consentimento_em !== null);
  ok('token_hash nasce vazio (so e sorteado na hora do envio)', linha.token_hash === null);

  // ── 4. as recusas ────────────────────────────────────────────────────────
  console.log('\n[4] as recusas');
  const semCons = await criar(SEGUNDA, 'b@exemplo.com', null, false);
  ok('sem consentimento: recusa com motivo proprio',
    mesmaResposta(semCons, { ok: false, motivo: 'sem_consentimento' }) && (await contar(SEGUNDA)) === 0,
    JSON.stringify(semCons));
  const emailRuim = await criar(SEGUNDA, 'nao-e-email', null, true);
  ok('e-mail invalido: recusa com motivo proprio',
    mesmaResposta(emailRuim, { ok: false, motivo: 'email_invalido' }) && (await contar(SEGUNDA)) === 0,
    JSON.stringify(emailRuim));

  const jaRegistrada = await criar(COMDONA, 'c@exemplo.com', null, true);
  ok('peca JA REGISTRADA: a MESMA resposta do sucesso, e nada gravado',
    mesmaResposta(jaRegistrada, rSucesso) && (await contar(COMDONA)) === 0,
    JSON.stringify(jaRegistrada));

  const segundoEm24h = await criar(LIVRE, 'outra@exemplo.com', null, true);
  ok('2o pedido na mesma peca dentro de 24h: a MESMA resposta, e nada gravado',
    mesmaResposta(segundoEm24h, rSucesso) && (await contar(LIVRE)) === 1,
    JSON.stringify(segundoEm24h));

  const naoExiste = await criar('NAOEXISTE999', 'd@exemplo.com', null, true);
  ok('peca que nao existe: a MESMA resposta, e nada gravado',
    mesmaResposta(naoExiste, rSucesso) && (await contar('NAOEXISTE999')) === 0,
    JSON.stringify(naoExiste));

  // ── 5. o indice unico ────────────────────────────────────────────────────
  console.log('\n[5] o indice unico parcial');
  // empurra o pedido para tras para sair do teto de 24h
  await c.query(`update public.vessel_lembretes set criado_em = now() - interval '2 days' where peca_codigo=$1`, [LIVRE]);
  const terceiro = await criar(LIVRE, 'terceira@exemplo.com', null, true);
  ok('fora das 24h, mas com um aberto: a MESMA resposta, e continua UM so',
    mesmaResposta(terceiro, rSucesso) && (await contar(LIVRE)) === 1, JSON.stringify(terceiro));
  let barrou = false;
  try {
    await c.query('savepoint s1');
    await c.query(`insert into public.vessel_lembretes (peca_codigo,email,consentimento_em)
                   values ($1,'x@exemplo.com',now())`, [LIVRE]);
  } catch (e) { barrou = e.code === '23505'; }
  await c.query('rollback to savepoint s1');
  ok('o indice unico recusa DOIS abertos na mesma peca, por baixo', barrou);

  // ── 6. a fila do robo ────────────────────────────────────────────────────
  console.log('\n[6] a fila do robo');
  const fila = async () => (await c.query(`select public.vessel_lembretes_a_enviar() r`)).rows[0].r;
  await c.query(`update public.vessel_lembretes set criado_em = now() - interval '2 days' where peca_codigo=$1`, [LIVRE]);
  let f = await fila();
  ok('com 2 dias: nao aparece na fila', f.linhas.length === 0, JSON.stringify(f.linhas));

  await c.query(`update public.vessel_lembretes set criado_em = now() - interval '8 days' where peca_codigo=$1`, [LIVRE]);
  f = await fila();
  ok('com 8 dias: aparece na fila como "7"',
    f.linhas.length === 1 && f.linhas[0].qual === 7 && f.linhas[0].email === 'ana@exemplo.com',
    JSON.stringify(f.linhas.map((l) => ({ qual: l.qual, email: l.email, temToken: !!l.token }))));
  const token7 = f.linhas[0].token;
  const id = f.linhas[0].id;
  const guardado = (await c.query(`select token_hash from public.vessel_lembretes where id=$1`, [id])).rows[0].token_hash;
  ok('o token veio em claro na fila e so o HASH ficou no banco',
    typeof token7 === 'string' && token7.length === 64 && guardado !== token7
    && guardado === (await c.query(`select encode(extensions.digest($1,'sha256'),'hex') h`, [token7])).rows[0].h);

  // ── 7. marcar enviado ────────────────────────────────────────────────────
  console.log('\n[7] marcar enviado');
  const marcar = async (qual) =>
    (await c.query(`select public.vessel_lembrete_marcar_enviado($1,$2) r`, [id, qual])).rows[0].r;
  const m7 = await marcar(7);
  ok('marcar 7 funciona', m7.ok === true && m7.marcado === true, JSON.stringify(m7));
  const data7 = (await c.query(`select enviado_7_em from public.vessel_lembretes where id=$1`, [id])).rows[0].enviado_7_em;
  const m7bis = await marcar(7);
  const data7bis = (await c.query(`select enviado_7_em from public.vessel_lembretes where id=$1`, [id])).rows[0].enviado_7_em;
  ok('marcar 7 DE NOVO nao repete nem empurra a data',
    m7bis.marcado === false && String(data7) === String(data7bis), JSON.stringify(m7bis));

  f = await fila();
  ok('com 8 dias e o de 7 ja marcado: sai da fila', f.linhas.length === 0);

  await c.query(`update public.vessel_lembretes set criado_em = now() - interval '31 days' where id=$1`, [id]);
  f = await fila();
  ok('com 31 dias: volta na fila como "30"', f.linhas.length === 1 && f.linhas[0].qual === 30,
    JSON.stringify(f.linhas.map((l) => l.qual)));
  const token30 = f.linhas[0].token;
  ok('o token do envio de 30 e OUTRO (sorteado de novo)', token30 !== token7);

  const m30 = await marcar(30);
  ok('marcar 30 funciona', m30.marcado === true);
  const m30bis = await marcar(30);
  ok('marcar 30 DE NOVO nao repete', m30bis.marcado === false);
  f = await fila();
  ok('depois do de 30, some da fila de vez', f.linhas.length === 0);
  const mRuim = await marcar(99);
  ok('marcar com "qual" invalido e recusado', mRuim.ok === false && mRuim.motivo === 'qual_invalido');

  // ── 8. cancelar por token ────────────────────────────────────────────────
  console.log('\n[8] cancelar pelo link do e-mail');
  await c.query(`update public.vessel_lembretes set enviado_30_em = null, cancelado_em = null,
                 cancelado_por = null, criado_em = now() - interval '8 days', enviado_7_em = null where id=$1`, [id]);
  f = await fila();
  const tokenVivo = f.linhas[0].token;
  const cancelar = async (t) =>
    (await c.query(`select public.vessel_lembrete_cancelar_por_token($1) r`, [t])).rows[0].r;

  const antesDoErrado = (await c.query(`select * from public.vessel_lembretes where id=$1`, [id])).rows[0];
  const rErrado = await cancelar('naoehotokencerto'.repeat(4));
  const depoisDoErrado = (await c.query(`select * from public.vessel_lembretes where id=$1`, [id])).rows[0];
  ok('token ERRADO: mesma resposta e NADA muda',
    mesmaResposta(rErrado, { ok: true })
    && JSON.stringify(antesDoErrado) === JSON.stringify(depoisDoErrado), JSON.stringify(rErrado));
  const rVazio = await cancelar('');
  ok('token VAZIO: mesma resposta', mesmaResposta(rVazio, { ok: true }));

  const rCerto = await cancelar(tokenVivo);
  const cancelada = (await c.query(`select * from public.vessel_lembretes where id=$1`, [id])).rows[0];
  ok('token CERTO: mesma resposta, e a linha fica cancelada pela cliente',
    mesmaResposta(rCerto, rErrado) && cancelada.cancelado_em !== null
    && cancelada.cancelado_por === 'cliente', JSON.stringify(rCerto));
  f = await fila();
  ok('cancelada, sai da fila', f.linhas.length === 0);

  // ── 9. o registro mata o lembrete ────────────────────────────────────────
  console.log('\n[9] o registro mata o lembrete');
  await c.query(`delete from public.vessel_lembretes where peca_codigo=$1`, [LIVRE]);
  const rNovo = await criar(SEGUNDA, 'nova@exemplo.com', null, true);
  ok('lembrete novo na peca 3', mesmaResposta(rNovo, { ok: true }) && (await contar(SEGUNDA)) === 1);
  await c.query(`update public.vessel_lembretes set criado_em = now() - interval '8 days' where peca_codigo=$1`, [SEGUNDA]);
  f = await fila();
  ok('vencido, aparece na fila', f.linhas.length === 1 && f.linhas[0].peca_codigo === SEGUNDA);

  await c.query(
    `insert into public.vessel_registros (codigo, nome, whatsapp, cpf) values ($1,'Nova Dona','','39053344705')`,
    [SEGUNDA]);
  const morto = (await c.query(`select * from public.vessel_lembretes where peca_codigo=$1`, [SEGUNDA])).rows[0];
  ok("o gatilho cancelou com cancelado_por='registro'",
    morto.cancelado_em !== null && morto.cancelado_por === 'registro', morto.cancelado_por);
  f = await fila();
  ok('e some da fila quando a peca ganha registro', f.linhas.length === 0);

  // ── 9b. a conta, quando houver ───────────────────────────────────────────
  console.log('\n[9b] o token de sessao liga o lembrete a conta');
  const cli = (await c.query(
    `insert into public.vessel_clientes (nome,cpf,email,senha_hash,teste)
     values ('Ana do Ensaio','39053344705','ana.ensaio@exemplo.com','x',true) returning id`)).rows[0].id;
  const tokSessao = 'token-de-ensaio-' + Date.now();
  await c.query(
    `insert into public.vessel_sessoes (cliente_id, token_hash, expira_em)
     values ($1, encode(extensions.digest($2,'sha256'),'hex'), now() + interval '1 hour')`,
    [cli, tokSessao]);
  await c.query(`delete from public.vessel_lembretes where peca_codigo=$1`, [LIVRE]);
  const rLogada = await criar(LIVRE, 'ana.ensaio@exemplo.com', tokSessao, true);
  const comConta = (await c.query(`select cliente_id from public.vessel_lembretes where peca_codigo=$1`, [LIVRE])).rows[0];
  ok('logada: o lembrete nasce ligado a conta, e a resposta e a MESMA',
    mesmaResposta(rLogada, { ok: true }) && comConta.cliente_id === cli, JSON.stringify(rLogada));

  await c.query(`delete from public.vessel_lembretes where peca_codigo=$1`, [LIVRE]);
  const rTokRuim = await criar(LIVRE, 'ana.ensaio@exemplo.com', 'token-que-nao-existe', true);
  const semConta = (await c.query(`select cliente_id from public.vessel_lembretes where peca_codigo=$1`, [LIVRE])).rows[0];
  ok('token de sessao invalido NAO derruba o lembrete: ele so fica sem conta',
    mesmaResposta(rTokRuim, { ok: true }) && semConta && semConta.cliente_id === null,
    JSON.stringify(rTokRuim));

  // ── 10. ACL ──────────────────────────────────────────────────────────────
  console.log('\n[10] o portao (ACL medido)');
  const FUNCOES = ['vessel_lembrete_criar(text,text,text,boolean)',
    'vessel_lembrete_cancelar_por_token(text)',
    'vessel_lembretes_a_enviar()',
    'vessel_lembrete_marcar_enviado(uuid,integer)'];
  for (const f2 of FUNCOES) {
    const r = (await c.query(
      `select has_function_privilege('anon', $1, 'execute') a,
              has_function_privilege('authenticated', $1, 'execute') u,
              has_function_privilege('service_role', $1, 'execute') s,
              has_function_privilege('public', $1, 'execute') p`, [`public.${f2}`])).rows[0];
    ok(`ACL de ${f2.split('(')[0]}`, r.a === false && r.u === false && r.s === true,
      `anon=${r.a} authenticated=${r.u} service_role=${r.s} public=${r.p}`);
  }
  const tab = (await c.query(
    `select has_table_privilege('anon','public.vessel_lembretes','select') a,
            has_table_privilege('authenticated','public.vessel_lembretes','insert') i,
            relrowsecurity rls
       from pg_class where oid='public.vessel_lembretes'::regclass`)).rows[0];
  ok('a tabela nasce com RLS ligada', tab.rls === true);
  const pol = (await c.query(
    `select policyname, cmd, roles::text from pg_policies where tablename='vessel_lembretes'`)).rows;
  ok('uma politica so, de SELECT, para authenticated',
    pol.length === 1 && pol[0].cmd === 'SELECT' && pol[0].roles === '{authenticated}',
    JSON.stringify(pol));

  // ── 10b. o mesmo portao, VESTINDO o papel (nao so lendo o catalogo) ──────
  console.log('\n[10b] vestindo o papel de anon e de authenticated');
  for (const papel of ['anon', 'authenticated']) {
    for (const [oque, sql] of [
      ['executar vessel_lembrete_criar', `select public.vessel_lembrete_criar('X','a@b.com',null,true)`],
      ['executar vessel_lembretes_a_enviar', `select public.vessel_lembretes_a_enviar()`],
      ['executar vessel_lembrete_cancelar_por_token', `select public.vessel_lembrete_cancelar_por_token('x')`],
      ['executar vessel_lembrete_marcar_enviado', `select public.vessel_lembrete_marcar_enviado(gen_random_uuid(),7)`],
    ]) {
      let erro = null;
      await c.query('savepoint sp');
      try { await c.query(`set local role ${papel}`); await c.query(sql); }
      catch (e) { erro = e.code; }
      await c.query('rollback to savepoint sp');
      await c.query('reset role');
      ok(`${papel} NAO consegue ${oque}`, erro === '42501', `erro=${erro}`);
    }
    // leitura e escrita na tabela, pela porta de dados
    let linhasVistas = null, erroInsert = null;
    await c.query('savepoint sp');
    try {
      await c.query(`set local role ${papel}`);
      linhasVistas = Number((await c.query('select count(*) n from public.vessel_lembretes')).rows[0].n);
    } catch (e) { linhasVistas = `erro ${e.code}`; }
    await c.query('rollback to savepoint sp');
    await c.query('reset role');
    await c.query('savepoint sp');
    try {
      await c.query(`set local role ${papel}`);
      await c.query(`insert into public.vessel_lembretes (peca_codigo,email,consentimento_em)
                     values ('INVADIDA','x@y.com',now())`);
    } catch (e) { erroInsert = e.code; }
    await c.query('rollback to savepoint sp');
    await c.query('reset role');
    ok(`${papel} nao ENXERGA linha nenhuma na tabela`, linhasVistas === 0, `viu ${linhasVistas}`);
    ok(`${papel} nao consegue GRAVAR na tabela`, erroInsert === '42501', `erro=${erroInsert}`);
  }

  // ── 11. o gatilho nao existia em duplicidade ─────────────────────────────
  const trig = (await c.query(
    `select count(*) n from pg_trigger where not tgisinternal
      and tgrelid='public.vessel_registros'::regclass and tgname='vessel_registros_mata_o_lembrete'`)).rows[0].n;
  ok('o gatilho existe, uma vez so', Number(trig) === 1);

} finally {
  await c.query('rollback');
  const sobrou = await c.query(
    `select count(*) n from information_schema.tables where table_name='vessel_lembretes'`);
  console.log(`\n[rollback] desfeito. vessel_lembretes ainda existe no banco real? ${Number(sobrou.rows[0].n) > 0 ? 'SIM (ERRO!)' : 'nao'}`);
  await c.end();
}

console.log(`\n=== ENSAIO: ${passou} provas OK, ${falhou} falhas ===`);
process.exit(falhou === 0 ? 0 : 1);
