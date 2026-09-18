// PROVA DA TRANSFERÊNCIA DE PROPRIEDADE, em transação com ROLLBACK.
//
//   node coletor/provar-transferencia-de-propriedade.mjs
//
// ⚠️ NADA DO QUE ACONTECE AQUI FICA NO BANCO. A migration é aplicada DENTRO da
// transação, as contas são de mentira e nascem aqui dentro, e no fim tudo volta
// atrás. As peças usadas são as três do LOTE DE TESTE
// (3316452c-24c6-4441-b01d-6350c0b7cef3) — nenhuma bolsa vendida é tocada.
//
// ⚠️ A SENHA DO BANCO É LIDA DE coletor/.env E NUNCA IMPRESSA.
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

const MIGRATION = new URL('../db/migrations/2026-09-18-zzzzz-vessel-transferencia-de-propriedade.sql',
  import.meta.url);

const PECA_A1 = 'TBNWXAS28A';   // conta A (lote de teste)
const PECA_A2 = 'VBDK9AANRU';   // conta A
const PECA_B  = 'LCQXFCCM97';   // conta B

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

// Sessão de mentira para uma conta de mentira: grava o hash do token do mesmo
// jeito que `vessel_conta_entrar` faria. Nenhuma sessão de ninguém é copiada.
async function contaDeMentira(nome, cpf, email) {
  const c = await uma(
    `insert into public.vessel_clientes (nome, cpf, email, whatsapp, nascimento, senha_hash, teste)
     values ($1, $2, $3, '19999990000', '1990-01-01',
             extensions.crypt('nao-usada', extensions.gen_salt('bf', 4)), true)
     returning id`, [nome, cpf, email]);
  const token = 'prova-' + Math.random().toString(36).slice(2) + '-' + Date.now();
  await q(
    `insert into public.vessel_sessoes (cliente_id, token_hash, expira_em)
     values ($1, encode(extensions.digest($2, 'sha256'), 'hex'), now() + interval '1 hour')`,
    [c.id, token]);
  return { id: c.id, token };
}

const gerar    = (t, p) => uma(`select public.vessel_transferencia_gerar($1, $2) as r`, [t, p]).then((x) => x.r);
const aberta   = (t, p) => uma(`select public.vessel_transferencia_aberta($1, $2) as r`, [t, p]).then((x) => x.r);
const cancelar = (t, p) => uma(`select public.vessel_transferencia_cancelar($1, $2) as r`, [t, p]).then((x) => x.r);
const aceitar  = (t, p, c) => uma(`select public.vessel_transferencia_aceitar($1, $2, $3) as r`, [t, p, c]).then((x) => x.r);

const fotoDoRegistro = (codigo) => uma(
  `select nome, cpf, comprado_em, garantia_ate, pedido_id, bling_pedido,
          bling_contato_id, onde_comprou, registrado_em, cliente_id
     from public.vessel_registros where codigo = $1`, [codigo]);

await q('begin');
try {
  console.log('\n── aplicando a migration DENTRO da transação');
  await q(readFileSync(MIGRATION, 'utf8'));
  console.log('   aplicou sem erro');

  // CPFs válidos de teste (dígito verificador confere) que não existem na base.
  const A = await contaDeMentira('Prova Dona A', '39053344705', 'prova-a@exemplo.invalido');
  const B = await contaDeMentira('Prova Recebe B', '19131243055', 'prova-b@exemplo.invalido');
  const C = await contaDeMentira('Prova Terceira C', '52998224725', 'prova-c@exemplo.invalido');

  // As três peças do lote de teste passam a ser das contas de mentira, só
  // dentro desta transação — para não mexer nos registros de verdade ao provar.
  await q(`update public.vessel_registros set cliente_id = $1,
             nome = 'Prova Dona A', cpf = '39053344705' where codigo = any($2)`,
    [A.id, [PECA_A1, PECA_A2]]);
  await q(`update public.vessel_registros set cliente_id = $1,
             nome = 'Prova Terceira C', cpf = '52998224725' where codigo = $2`,
    [C.id, PECA_B]);

  // ── (a) a dona gera e recebe o código ────────────────────────────────────
  console.log('\n(a) a DONA gera e recebe o código');
  const g1 = await gerar(A.token, PECA_A1);
  conferir('gerar respondeu ok', g1.ok === true, JSON.stringify(g1));
  conferir('veio um código de 6 DÍGITOS', /^[0-9]{6}$/.test(g1.codigo_transferencia ?? ''),
    String(g1.codigo_transferencia));
  const dias = (new Date(g1.vale_ate) - Date.now()) / 86400000;
  conferir('vale por 7 dias', dias > 6.9 && dias < 7.1, `${dias.toFixed(3)} dias`);
  const guardado = await uma(
    `select codigo_hash from public.vessel_transferencias where peca_codigo = $1`, [PECA_A1]);
  conferir('o banco guarda só o HASH (bcrypt), nunca os 6 dígitos',
    guardado.codigo_hash.startsWith('$2') && !guardado.codigo_hash.includes(g1.codigo_transferencia));
  const ab = await aberta(A.token, PECA_A1);
  conferir('"tem convite aberto?" diz que sim e NÃO devolve o código',
    ab.ok === true && ab.tem === true && ab.codigo_transferencia === undefined, JSON.stringify(ab));

  // ── (b) outra pessoa NÃO gera ────────────────────────────────────────────
  console.log('\n(b) outra pessoa NÃO gera');
  const gB = await gerar(B.token, PECA_A1);
  conferir('quem não é a dona recebe nao_e_sua', gB.ok === false && gB.motivo === 'nao_e_sua',
    JSON.stringify(gB));
  const abB = await aberta(B.token, PECA_A1);
  conferir('e nem consegue perguntar se existe convite',
    abB.ok === false && abB.motivo === 'nao_e_sua', JSON.stringify(abB));
  const cB = await cancelar(B.token, PECA_A1);
  conferir('e nem cancelar o convite da outra',
    cB.ok === false && cB.motivo === 'nao_e_sua', JSON.stringify(cB));
  const sem = await gerar('token-que-nao-existe', PECA_A1);
  conferir('sem sessão nenhuma: sem_sessao', sem.ok === false && sem.motivo === 'sem_sessao',
    JSON.stringify(sem));

  // ── (c) quem recebe aceita e vira dona, com a garantia INTACTA ───────────
  console.log('\n(c) quem recebe ACEITA e vira dona — a garantia não muda');
  const antes = await fotoDoRegistro(PECA_A1);
  const ac = await aceitar(B.token, PECA_A1, g1.codigo_transferencia);
  const depois = await fotoDoRegistro(PECA_A1);
  conferir('aceitar respondeu ok e devolveu a garantia', ac.ok === true && !!ac.garantia_ate,
    JSON.stringify(ac));
  conferir('a peça está no nome de B agora',
    depois.cliente_id === B.id && depois.nome === 'Prova Recebe B' && depois.cpf === '19131243055',
    `${depois.nome} / ${depois.cpf}`);

  const PRESERVAR = ['garantia_ate', 'comprado_em', 'pedido_id', 'bling_pedido',
                     'bling_contato_id', 'onde_comprou', 'registrado_em'];
  const mostrar = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v));
  console.log('\n    CAMPO              ANTES                 DEPOIS                IGUAL?');
  let todosIguais = true;
  for (const campo of PRESERVAR) {
    const iguais = mostrar(antes[campo]) === mostrar(depois[campo]);
    if (!iguais) todosIguais = false;
    console.log(`    ${campo.padEnd(18)} ${mostrar(antes[campo]).padEnd(21)} `
      + `${mostrar(depois[campo]).padEnd(21)} ${iguais ? 'sim' : '⛔ NÃO'}`);
  }
  conferir('garantia_ate, comprado_em, pedido_id, bling_pedido e bling_contato_id IGUAIS', todosIguais);
  conferir('a garantia devolvida é a MESMA do registro',
    mostrar(new Date(ac.garantia_ate)) === mostrar(antes.garantia_ate),
    `${ac.garantia_ate} x ${mostrar(antes.garantia_ate)}`);

  const trilha = await uma(
    `select acao, detalhes, feito_por from public.vessel_edicoes
      where codigo = $1 order by feito_em desc limit 1`, [PECA_A1]);
  conferir('a trilha registrou transferida_pela_dona', trilha.acao === 'transferida_pela_dona',
    trilha.acao);
  conferir('a trilha diz DE quem e PARA quem',
    trilha.detalhes.de?.cliente_id === A.id && trilha.detalhes.para?.cliente_id === B.id);
  conferir('a trilha NÃO guarda o código de 6 dígitos',
    !JSON.stringify(trilha.detalhes).includes(g1.codigo_transferencia));

  // ── (d) o mesmo código não serve duas vezes ──────────────────────────────
  console.log('\n(d) o mesmo código NÃO serve duas vezes');
  const d2 = await aceitar(C.token, PECA_A1, g1.codigo_transferencia);
  conferir('a segunda vez é codigo_invalido', d2.ok === false && d2.motivo === 'codigo_invalido',
    JSON.stringify(d2));
  const aindaB = await fotoDoRegistro(PECA_A1);
  conferir('e a peça continua com B', aindaB.cliente_id === B.id);

  // ── (e) código errado 6x ─────────────────────────────────────────────────
  console.log('\n(e) código ERRADO 6 vezes — as 5 primeiras codigo_invalido, da 6ª em diante o teto');
  // Zera o contador desta peça antes de medir: as provas (c) e (d) já gastaram
  // duas tentativas da janela de 24h, e o que se quer medir aqui é a CONTAGEM,
  // não o resto do ensaio. Some no rollback como todo o resto.
  await q(`delete from public.vessel_tentativas_de_transferencia where codigo = $1`, [PECA_A2]);
  const g2 = await gerar(A.token, PECA_A2);
  conferir('a dona gerou um convite para a segunda peça', g2.ok === true, JSON.stringify(g2));
  const errado = (n) => String((Number(g2.codigo_transferencia) + n) % 1000000).padStart(6, '0');
  const motivos = [];
  for (let i = 1; i <= 6; i++) motivos.push((await aceitar(B.token, PECA_A2, errado(i))).motivo);
  console.log(`    motivos, na ordem: ${motivos.join(', ')}`);
  conferir('as 5 primeiras: codigo_invalido',
    motivos.slice(0, 5).every((m) => m === 'codigo_invalido'), motivos.slice(0, 5).join(','));
  conferir('a 6ª: muitas_tentativas', motivos[5] === 'muitas_tentativas', motivos[5]);
  conferir('nenhuma resposta revelou nada além do motivo',
    motivos.every((m) => ['codigo_invalido', 'muitas_tentativas'].includes(m)));
  const comTeto = await aceitar(B.token, PECA_A2, g2.codigo_transferencia);
  conferir('⚠️ com o teto estourado, nem o código CERTO passa',
    comTeto.ok === false && comTeto.motivo === 'muitas_tentativas', JSON.stringify(comTeto));
  const naoTrocou = await fotoDoRegistro(PECA_A2);
  conferir('e a peça continua com A', naoTrocou.cliente_id === A.id);

  // ── (f) convite vencido ──────────────────────────────────────────────────
  console.log('\n(f) convite VENCIDO não vale');
  await q(`delete from public.vessel_tentativas_de_transferencia where codigo = $1`, [PECA_A2]);
  // ⚠️ EMPURRAR SÓ O `vale_ate` PARA TRÁS NÃO PASSA — e isso é o CHECK
  // `vale_ate > criado_em` funcionando: convite não pode vencer antes de
  // nascer. A simulação honesta é envelhecer o convite inteiro: nascido há 8
  // dias, vencido ontem. (Medido na primeira rodada desta prova, 18/09/2026.)
  await q(`update public.vessel_transferencias
              set criado_em = now() - interval '8 days',
                  vale_ate  = now() - interval '1 day'
            where peca_codigo = $1 and usado_em is null and cancelado_em is null`, [PECA_A2]);
  const venc = await aceitar(B.token, PECA_A2, g2.codigo_transferencia);
  conferir('convite vencido: codigo_invalido', venc.ok === false && venc.motivo === 'codigo_invalido',
    JSON.stringify(venc));
  const abVenc = await aberta(A.token, PECA_A2);
  conferir('e a tela da dona já não mostra convite aberto', abVenc.ok === true && abVenc.tem === false,
    JSON.stringify(abVenc));

  // ── (g) gerar de novo cancela o anterior; o índice não deixa dois abertos ─
  console.log('\n(g) gerar de novo CANCELA o anterior — e o índice não deixa dois abertos');
  await q(`delete from public.vessel_tentativas_de_transferencia where codigo = $1`, [PECA_A2]);
  const g3 = await gerar(A.token, PECA_A2);
  const g4 = await gerar(A.token, PECA_A2);
  conferir('os dois gerar responderam ok', g3.ok === true && g4.ok === true);
  conferir('e vieram códigos DIFERENTES', g3.codigo_transferencia !== g4.codigo_transferencia);
  const contagem = await uma(
    `select count(*) filter (where usado_em is null and cancelado_em is null) as abertos,
            count(*) filter (where cancelado_em is not null) as cancelados
       from public.vessel_transferencias where peca_codigo = $1`, [PECA_A2]);
  conferir('ficou UM convite aberto só', Number(contagem.abertos) === 1, `abertos=${contagem.abertos}`);
  conferir('os anteriores estão cancelados', Number(contagem.cancelados) >= 1,
    `cancelados=${contagem.cancelados}`);
  const velho = await aceitar(B.token, PECA_A2, g3.codigo_transferencia);
  conferir('o código VELHO já não vale', velho.ok === false && velho.motivo === 'codigo_invalido',
    JSON.stringify(velho));
  // E o índice único, provado na unha: dois abertos à mão têm de ser recusados.
  let indiceBarrou = false;
  try {
    await q('savepoint dois_abertos');
    await q(`insert into public.vessel_transferencias (peca_codigo, cliente_de, codigo_hash, vale_ate)
             values ($1, $2, 'hash-de-mentira', now() + interval '7 days')`, [PECA_A2, A.id]);
    await q('release savepoint dois_abertos');
  } catch (e) {
    indiceBarrou = e.code === '23505';
    await q('rollback to savepoint dois_abertos');
  }
  conferir('⚠️ o índice único recusa um SEGUNDO convite aberto (erro 23505)', indiceBarrou);
  // cancelar de verdade, pela porta da dona
  await q(`delete from public.vessel_tentativas_de_transferencia where codigo = $1`, [PECA_A2]);
  const canc = await cancelar(A.token, PECA_A2);
  const abDepois = await aberta(A.token, PECA_A2);
  conferir('a dona cancela e não sobra convite aberto',
    canc.ok === true && abDepois.tem === false, JSON.stringify(abDepois));

  // ── (h) a dona tentando aceitar o próprio convite ────────────────────────
  console.log('\n(h) a DONA tentando aceitar o PRÓPRIO convite → sua_ja');
  await q(`delete from public.vessel_tentativas_de_transferencia where codigo = $1`, [PECA_B]);
  const g5 = await gerar(C.token, PECA_B);
  conferir('C gerou o convite da peça dela', g5.ok === true, JSON.stringify(g5));
  const eu = await aceitar(C.token, PECA_B, g5.codigo_transferencia);
  conferir('a própria dona recebe sua_ja', eu.ok === false && eu.motivo === 'sua_ja',
    JSON.stringify(eu));
  const aindaC = await fotoDoRegistro(PECA_B);
  conferir('e a peça continua com ela', aindaC.cliente_id === C.id);

  // ── as peças de verdade continuam de pé (dentro da transação) ────────────
  console.log('\n(extra) o convite morre se a peça trocar de dona por OUTRO caminho');
  await q(`delete from public.vessel_tentativas_de_transferencia where codigo = $1`, [PECA_B]);
  await q(`update public.vessel_registros set cliente_id = $1, nome = 'Prova Dona A',
             cpf = '39053344705' where codigo = $2`, [A.id, PECA_B]);
  const orfao = await aceitar(B.token, PECA_B, g5.codigo_transferencia);
  conferir('o convite da dona antiga já não vale',
    orfao.ok === false && orfao.motivo === 'codigo_invalido', JSON.stringify(orfao));

  // ── (i, parte 1) o portão, medido no ACL de verdade ─────────────────────
  console.log('\n(i) anon e authenticated BARRADOS nas quatro funções (+ a do teto)');
  const AS_CINCO = [
    'public.vessel_transferencia_gerar(text,text)',
    'public.vessel_transferencia_aberta(text,text)',
    'public.vessel_transferencia_cancelar(text,text)',
    'public.vessel_transferencia_aceitar(text,text,text)',
    'public.vessel_tentativa_de_transferencia(text)',
  ];
  for (const f of AS_CINCO) {
    const a = await uma(
      `select has_function_privilege('anon', $1::regprocedure, 'execute') as anon,
              has_function_privilege('authenticated', $1::regprocedure, 'execute') as auth,
              has_function_privilege('service_role', $1::regprocedure, 'execute') as servico,
              coalesce((select p.proacl::text from pg_proc p where p.oid = $1::regprocedure), '') as acl`,
      [f]);
    const curto = f.replace('public.vessel_', '').split('(')[0];
    conferir(`${curto.padEnd(26)} anon=não, authenticated=não, service_role=sim`,
      a.anon === false && a.auth === false && a.servico === true,
      `anon=${a.anon} auth=${a.auth} servico=${a.servico}`);
    // ⚠️ E NADA PARA O "PUBLIC" (o papel de todo mundo). Uma entrada que começa
    // com "=" no ACL é o PUBLIC — foi assim que uma função de administração
    // ficou executável por qualquer logado em 30/08/2026.
    conferir(`${curto.padEnd(26)} sem direito para o PUBLIC`,
      !/(^|,)=/.test(a.acl.replace(/^\{|\}$/g, '')), a.acl);
  }

  console.log('\n(extra) peça FORA do lote de teste não gera convite');
  const real = await uma(
    `select p.codigo from public.vessel_pecas p
       join public.vessel_lotes l on l.id = p.lote_id
       join public.vessel_registros r on r.codigo = p.codigo
      where not l.teste limit 1`);
  if (real) {
    await q(`update public.vessel_registros set cliente_id = $1 where codigo = $2`, [A.id, real.codigo]);
    const fora = await gerar(A.token, real.codigo);
    conferir('lote não marcado como teste: fora_do_teste',
      fora.ok === false && fora.motivo === 'fora_do_teste', JSON.stringify(fora));
  } else {
    console.log('  (não achei peça registrada fora do lote de teste — pulei)');
  }
} finally {
  await q('rollback');
  console.log('\n── ROLLBACK feito: nada disto ficou no banco.');
  // Conferência do rollback, já FORA da transação.
  const sobrou = await uma(
    `select to_regclass('public.vessel_transferencias') as tabela,
            (select count(*) from public.vessel_clientes where email like 'prova-%@exemplo.invalido') as contas`);
  conferir('a tabela nova NÃO ficou no banco', sobrou.tabela === null, String(sobrou.tabela));
  conferir('nenhuma conta de mentira ficou', Number(sobrou.contas) === 0, String(sobrou.contas));
  const peca = await uma(`select nome, cliente_id, garantia_ate from public.vessel_registros where codigo = $1`, [PECA_A1]);
  conferir('a peça de teste voltou ao dono original', peca.nome === 'Breno Vale', peca.nome);
  await client.end();
}

// ══════════════════════════════════════════════════════════════════════════
// (i, parte 2) A PORTA PÚBLICA, DE VERDADE, COM A CHAVE QUE ESTÁ NO HTML
// ══════════════════════════════════════════════════════════════════════════
// ⚠️ NÃO GRAVA NADA E NÃO USA A CHAVE DE SERVIÇO. A chave abaixo é a MESMA que
// mora dentro do JavaScript de vesselbrasil.com.br (src/compartilhado/
// conectar-no-banco-de-dados.js) — é o que qualquer visitante tem na mão.
//
// ⚠️ A ARMADILHA DESTA PROVA, e por que ela tem um CONTROLE: 404 do PostgREST
// significa "não achei função com essa assinatura" — e é a MESMA resposta de
// "existe, mas você não pode". Um 404 por assinatura errada lido como "fechada"
// já deu prova falsa neste projeto (ver o cabeçalho de
// coletor/provar-porta-de-vessel-pessoas.mjs). Por isso:
//   · o CONTROLE é `vessel_pedido_marcado_presente`, que é concedida a anon e
//     não grava nada: se ELA responder 200, o caminho HTTP está funcionando e
//     um 404 nas outras não é erro de digitação meu;
//   · a IRMÃ JÁ FECHADA é `vessel_conta_da_sessao`, do mesmo portão desta
//     tarefa e já no ar: o que as quatro novas têm de responder é o mesmo que
//     ela responde hoje.
//
// ⚠️ HOJE as quatro funções ainda NÃO estão no banco (esta prova só as aplicou
// dentro de uma transação que voltou atrás). Então o 404 delas ainda não prova
// o portão — quem prova o portão AGORA é o ACL medido em (i, parte 1). Depois
// de aplicar a migration de verdade, esta mesma prova roda de novo e a resposta
// tem de deixar de ser 200 do mesmo jeito — só que virando 401, que é o que a
// irmã já fechada responde hoje (medido em 18/09/2026: `vessel_conta_da_sessao`
// = 401, e as quatro novas = 404 por ainda não existirem). Se alguma virar 200,
// o revoke não pegou.
const URL_BANCO = 'https://kounqtdoioootxqegkij.supabase.co';
const CHAVE_PUBLICA = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtvdW5xdGRvaW9vb3R4cWVna2lqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyMDMwMDUsImV4cCI6MjA5NDc3OTAwNX0.MVXa6jngjKXkH3eZ7as_j_k8Eb7lJKcFmO4kCKAnuHM';
const cab = { apikey: CHAVE_PUBLICA, Authorization: `Bearer ${CHAVE_PUBLICA}`,
              'Content-Type': 'application/json' };
const chamar = async (f, corpo) => {
  const r = await fetch(`${URL_BANCO}/rest/v1/rpc/${f}`,
    { method: 'POST', headers: cab, body: JSON.stringify(corpo) });
  return { status: r.status, corpo: (await r.text()).slice(0, 70) };
};

console.log('\n(i, parte 2) chamando pela PORTA PÚBLICA, com a chave que está no HTML');
const controle = await chamar('vessel_pedido_marcado_presente', { p_texto: 'sonda' });
conferir(`CONTROLE: uma função aberta responde 200 (HTTP ${controle.status})`,
  controle.status === 200, controle.corpo);

const irma = await chamar('vessel_conta_da_sessao', { p_token: 'sonda' });
conferir(`irmã já fechada vessel_conta_da_sessao NÃO responde 200 (HTTP ${irma.status})`,
  irma.status !== 200, irma.corpo);

for (const [f, corpo] of [
  ['vessel_transferencia_gerar', { p_token: 'sonda', p_codigo: 'TBNWXAS28A' }],
  ['vessel_transferencia_aberta', { p_token: 'sonda', p_codigo: 'TBNWXAS28A' }],
  ['vessel_transferencia_cancelar', { p_token: 'sonda', p_codigo: 'TBNWXAS28A' }],
  ['vessel_transferencia_aceitar', { p_token: 'sonda', p_codigo: 'TBNWXAS28A', p_codigo_transferencia: '000000' }],
  ['vessel_tentativa_de_transferencia', { p_codigo: 'TBNWXAS28A' }],
]) {
  const r = await chamar(f, corpo);
  conferir(`${f.replace('vessel_', '').padEnd(28)} NÃO responde 200 (HTTP ${r.status})`,
    r.status !== 200, r.corpo);
}

console.log(`\n${falhou === 0 ? '✅' : '⛔'} ${passou} prova(s) passaram, ${falhou} falharam.\n`);
process.exitCode = falhou === 0 ? 0 : 1;
