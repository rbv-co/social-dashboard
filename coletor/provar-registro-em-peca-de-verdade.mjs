// PROVA DA FASE 2 DO REGISTERED PIECES, em transação com ROLLBACK.
//
//   node coletor/provar-registro-em-peca-de-verdade.mjs
//
// ⚠️ NADA DO QUE ACONTECE AQUI FICA NO BANCO. A migration é aplicada DENTRO da
// transação, as contas são de mentira e nascem aqui dentro, e no fim tudo volta
// atrás com `rollback` — inclusive as LEITURAS gravadas e os registros criados
// sobre peças de verdade.
//
// ⚠️ PEÇAS DE VERDADE SÃO USADAS DE PROPÓSITO: a Fase 2 existe justamente para
// tirar a trava de lote de teste, e hoje NÃO EXISTE lote marcado `teste` no
// banco (0 de 139, medido em 18/09/2026). Provar em peça de mentira provaria
// outra coisa. As peças usadas estão listadas em PECAS, logo abaixo; nenhuma
// delas tem dona hoje, menos a PX9FWMYJET, que é a única peça registrada do
// banco (registro do dono, feito pelo caminho antigo, sem conta) e aqui é só
// LIDA e usada para provar que a trava da dona continua barrando.
//
// ⚠️ A SENHA DO BANCO É LIDA DE coletor/.env E NUNCA IMPRESSA.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

const COLETOR = new URL('.', import.meta.url).pathname;
for (const raw of readFileSync(join(COLETOR, '.env'), 'utf8').split('\n')) {
  const l = raw.trim(); if (!l || l.startsWith('#')) continue;
  const i = l.indexOf('='); if (i === -1) continue;
  const k = l.slice(0, i).trim(); let v = l.slice(i + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (!(k in process.env)) process.env[k] = v;
}

const MIGRATION = new URL(
  '../db/migrations/2026-09-19-vessel-registro-em-peca-de-verdade.sql', import.meta.url);

// Peças DE VERDADE (gravadas, sem registro e sem pedido — medido em 18/09/2026).
const PECA_LIVRE     = '264EFLZU7M';   // (a) registro estando logada
const PECA_TRANSFERE = '2DJ9SNDVS9';   // (c) transferência de ponta a ponta
const PECA_PENDENTE  = '2QQE9SBAUU';   // (d) pedido pendente não gera convite
const PECA_DO_DONO   = 'PX9FWMYJET';   // (b) e (e) — a única registrada do banco
const CPF_DO_DONO    = '44426113865';  // o CPF que está nesse registro

// A chave publicável que mora dentro do HTML de vesselbrasil.com.br / da
// Central (src/compartilhado/conectar-no-banco-de-dados.js). É pública por
// desenho; está aqui para provar que ela NÃO alcança as funções.
const SUPABASE_URL = 'https://kounqtdoioootxqegkij.supabase.co';
const CHAVE_PUBLICAVEL = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtvdW5xdGRvaW9vb3R4cWVna2lqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyMDMwMDUsImV4cCI6MjA5NDc3OTAwNX0.MVXa6jngjKXkH3eZ7as_j_k8Eb7lJKcFmO4kCKAnuHM';

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

// Conta de verdade, pela porta de verdade: `vessel_conta_criar` + `vessel_conta_entrar`.
// Nenhuma sessão de ninguém é copiada; o token sai do próprio login.
let nSeq = 0;
async function contaDeMentira(nome, cpf, email, whatsapp = '19999990000') {
  const senha = 'prova-' + (++nSeq) + '-' + Date.now();
  const criada = (await uma(
    `select public.vessel_conta_criar($1,$2,$3,$4,$5,$6) as r`,
    [nome, cpf, email, whatsapp, '1990-01-01', senha])).r;
  if (!criada.ok) throw new Error('não criou a conta de mentira: ' + JSON.stringify(criada));
  const entrou = (await uma(
    `select public.vessel_conta_entrar($1,$2,false) as r`, [email, senha])).r;
  if (!entrou.ok) throw new Error('não entrou na conta de mentira: ' + JSON.stringify(entrou));
  // ⚠️ conta de mentira fica marcada `teste = true`, como as irmãs deste
  // projeto — mesmo com rollback, se alguém um dia rodar sem transação a
  // linha se identifica sozinha.
  await q(`update public.vessel_clientes set teste = true where id = $1`, [criada.cliente_id]);
  return { id: criada.cliente_id, token: entrou.token, senha, email, cpf, criada };
}

const registrar = (t, p, onde, quando) => uma(
  `select public.vessel_registrar_como_cliente($1,$2,$3,$4) as r`, [t, p, onde, quando]).then((x) => x.r);
const gerar   = (t, p) => uma(`select public.vessel_transferencia_gerar($1,$2) as r`, [t, p]).then((x) => x.r);
const aceitar = (t, p, c) => uma(`select public.vessel_transferencia_aceitar($1,$2,$3) as r`, [t, p, c]).then((x) => x.r);
const minhas  = (t) => uma(`select public.vessel_minhas_pecas($1) as r`, [t]).then((x) => x.r);

const fotoDoRegistro = (codigo) => uma(
  `select nome, cpf, comprado_em, garantia_ate, pedido_id, bling_pedido,
          bling_contato_id, onde_comprou, registrado_em, cliente_id
     from public.vessel_registros where codigo = $1`, [codigo]);

await q('begin');
try {
  console.log('\n── o retrato de HOJE (antes de qualquer mudança)');
  const antes = await uma(`
    select (select count(*) from public.vessel_lotes where teste) as lotes_teste,
           (select count(*) from public.vessel_lotes) as lotes,
           (select count(*) from public.vessel_pecas) as pecas,
           (select count(*) from public.vessel_clientes) as contas,
           (select count(*) from public.vessel_registros) as registros`);
  console.log('  ', JSON.stringify(antes));
  conferir('nenhum lote marcado `teste` existe hoje — a trava desliga TUDO',
    Number(antes.lotes_teste) === 0, JSON.stringify(antes));

  console.log('\n── antes da migration: a peça de verdade responde fora_do_teste');
  const antesConta = await contaDeMentira('Prova Zero', '39053344705', 'prova-zero@exemplo.invalido');
  const antesReg = await registrar(antesConta.token, PECA_LIVRE, 'Loja', '2026-09-01');
  conferir('registro em peça de verdade era `fora_do_teste`',
    antesReg.ok === false && antesReg.motivo === 'fora_do_teste', JSON.stringify(antesReg));

  console.log('\n── aplicando a migration DENTRO da transação');
  await q(readFileSync(MIGRATION, 'utf8'));
  console.log('   aplicou sem erro');

  // ══════════════════════════════════════════════════════════════════════
  // (a) peça de verdade, livre: registro estando logada abre pedido PENDENTE
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n(a) peça de verdade, livre: registro estando logada');
  const A = await contaDeMentira('Prova Dona A', '10765432196', 'prova-a@exemplo.invalido');
  const regA = await registrar(A.token, PECA_LIVRE, 'Loja Iguatemi', '2026-09-01');
  conferir('registro em peça de verdade agora PASSA', regA.ok === true, JSON.stringify(regA));
  conferir('a peça estava livre (`ja_tem_dono` falso)', regA.ja_tem_dono === false, JSON.stringify(regA));

  const pedA = await uma(
    `select estado, cliente_id from public.vessel_pedidos_de_registro where id = $1`, [regA.pedido]);
  conferir('o pedido nasce PENDENTE — ninguém casou nada no Bling',
    pedA.estado === 'pendente', JSON.stringify(pedA));
  conferir('o pedido nasce ligado à conta', pedA.cliente_id === A.id, JSON.stringify(pedA));
  conferir('a peça NÃO ganhou registro só por abrir pedido',
    (await fotoDoRegistro(PECA_LIVRE)) === undefined);

  const minhasA = await minhas(A.token);
  conferir('em "Minhas peças" ela aparece como "em conferência"',
    minhasA.ok && minhasA.pecas.length === 1
      && minhasA.pecas[0].codigo === PECA_LIVRE
      && minhasA.pecas[0].estado === 'em conferência', JSON.stringify(minhasA));

  // ══════════════════════════════════════════════════════════════════════
  // (b) a trava da dona continua: CPF diferente em peça com dona
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n(b) a trava da dona continua barrando (peça com dona, CPF diferente)');
  const B = await contaDeMentira('Prova Outra B', '52998224725', 'prova-b@exemplo.invalido');
  const regB = await registrar(B.token, PECA_DO_DONO, 'Loja', '2026-09-01');
  conferir('abrir pedido numa peça com dona continua possível (vai para a fila)',
    regB.ok === true && regB.ja_tem_dono === true, JSON.stringify(regB));

  // ⚠️ CONFERÊNCIA SINTÉTICA: nada aqui consulta o Bling. É a MESMA porta que
  // a edge usa (`p_quem_decidiu = 'bling'`), chamada por uma conexão direta
  // do dono do banco — o único jeito, além da chave de serviço, que o portão
  // do 'bling' aceita. O número do pedido é inventado, com prefixo PROVA-.
  const decidir = (pedido, conf) => uma(
    `select public.vessel_decidir_pedido_de_registro($1,'aprovado','bling',$2::jsonb) as r`,
    [pedido, JSON.stringify(conf)]).then((x) => x.r);

  const decB = await decidir(regB.pedido, { pedido: 'PROVA-0001', contato: '999', quando: '2026-09-01' });
  conferir('aprovação automática NÃO toma a peça de quem já é dona: ja_tem_dona',
    decB.ok === false && decB.motivo === 'ja_tem_dona', JSON.stringify(decB));

  const fotoDono = await fotoDoRegistro(PECA_DO_DONO);
  conferir('o registro do dono ficou intocado (CPF é o de sempre)',
    String(fotoDono.cpf).replace(/\D/g, '') === CPF_DO_DONO, JSON.stringify(fotoDono.cpf));

  // ══════════════════════════════════════════════════════════════════════
  // (c) transferência em peça de verdade, de ponta a ponta
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n(c) transferência em peça de verdade');
  const D = await contaDeMentira('Prova Dona D', '11144477735', 'prova-d@exemplo.invalido');
  const E = await contaDeMentira('Prova Recebe E', '12345678909', 'prova-e@exemplo.invalido');

  const regD = await registrar(D.token, PECA_TRANSFERE, 'Loja Tivoli', '2026-09-02');
  conferir('D registra a peça de verdade', regD.ok === true, JSON.stringify(regD));
  const decD = await decidir(regD.pedido, { pedido: 'PROVA-0002', contato: '18011672411', quando: '2026-09-02' });
  conferir('aprovação (conferência SINTÉTICA, service_role/dono do banco) passa',
    decD.ok === true && decD.estado === 'aprovado', JSON.stringify(decD));

  const antesTroca = await fotoDoRegistro(PECA_TRANSFERE);
  console.log('    ANTES :', JSON.stringify(antesTroca));
  conferir('o registro nasceu ligado à conta de D (gatilho do pedido_id)',
    antesTroca.cliente_id === D.id, JSON.stringify(antesTroca.cliente_id));

  const convite = await gerar(D.token, PECA_TRANSFERE);
  conferir('a dona gera o convite numa peça de VERDADE (era `fora_do_teste`)',
    convite.ok === true && /^\d{6}$/.test(String(convite.codigo_transferencia)),
    JSON.stringify({ ...convite, codigo_transferencia: '******' }));

  const aceito = await aceitar(E.token, PECA_TRANSFERE, convite.codigo_transferencia);
  conferir('a outra conta aceita e a peça troca de dona', aceito.ok === true, JSON.stringify(aceito));

  const depoisTroca = await fotoDoRegistro(PECA_TRANSFERE);
  console.log('    DEPOIS:', JSON.stringify(depoisTroca));
  conferir('o nome passou para quem recebeu', depoisTroca.nome === 'Prova Recebe E', depoisTroca.nome);
  conferir('o cliente_id passou para quem recebeu', depoisTroca.cliente_id === E.id);
  for (const campo of ['garantia_ate', 'comprado_em', 'pedido_id', 'bling_pedido', 'bling_contato_id']) {
    conferir(`${campo} PRESERVADO na troca`,
      String(antesTroca[campo]) === String(depoisTroca[campo]),
      `${JSON.stringify(antesTroca[campo])} → ${JSON.stringify(depoisTroca[campo])}`);
  }
  // ⚠️ `pg` DEVOLVE `date` COMO OBJETO Date, e o json da função devolve o
  // mesmo dia como texto '2028-09-02'. Comparar com String() diria que são
  // diferentes quando são o mesmo dia — por isso os dois passam por `soDia`.
  const soDia = (v) => (v instanceof Date
    ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
    : String(v).slice(0, 10));
  conferir('a garantia devolvida é a MESMA do registro (não é recalculada)',
    soDia(aceito.garantia_ate) === soDia(antesTroca.garantia_ate),
    `${soDia(aceito.garantia_ate)} vs ${soDia(antesTroca.garantia_ate)}`);

  const minhasE = await minhas(E.token);
  const minhasD = await minhas(D.token);
  conferir('a peça está em "Minhas peças" de quem recebeu',
    minhasE.pecas.some((p) => p.codigo === PECA_TRANSFERE && p.estado === 'registrada'),
    JSON.stringify(minhasE));
  conferir('e saiu de "Minhas peças" de quem entregou',
    !minhasD.pecas.some((p) => p.codigo === PECA_TRANSFERE), JSON.stringify(minhasD));

  // ══════════════════════════════════════════════════════════════════════
  // (d) quem NÃO é dona registrada não gera convite — nem com pedido PENDENTE
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n(d) quem não é dona registrada não gera convite');
  const semNada = await gerar(A.token, PECA_PENDENTE);
  conferir('sem nenhum vínculo com a peça: nao_e_sua',
    semNada.ok === false && semNada.motivo === 'nao_e_sua', JSON.stringify(semNada));

  const regPend = await registrar(A.token, PECA_PENDENTE, 'Loja', '2026-09-03');
  conferir('A abre um pedido de registro (fica PENDENTE)', regPend.ok === true, JSON.stringify(regPend));
  const comPendente = await gerar(A.token, PECA_PENDENTE);
  conferir('COM pedido de registro pendente continua: nao_e_sua',
    comPendente.ok === false && comPendente.motivo === 'nao_e_sua', JSON.stringify(comPendente));

  const aindaLivre = await gerar(A.token, PECA_LIVRE);
  conferir('a peça de (a), também só com pedido pendente: nao_e_sua',
    aindaLivre.ok === false && aindaLivre.motivo === 'nao_e_sua', JSON.stringify(aindaLivre));

  const naoEDona = await gerar(D.token, PECA_TRANSFERE);
  conferir('quem JÁ FOI dona e transferiu também não gera mais: nao_e_sua',
    naoEDona.ok === false && naoEDona.motivo === 'nao_e_sua', JSON.stringify(naoEDona));

  // ══════════════════════════════════════════════════════════════════════
  // (e) conta nova com o CPF do registro real enxerga a peça
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n(e) conta nova com o CPF do registro de verdade (PX9FWMYJET)');
  const regAntes = await fotoDoRegistro(PECA_DO_DONO);
  conferir('antes: o registro de verdade não tem conta dona',
    regAntes.cliente_id === null, JSON.stringify(regAntes.cliente_id));

  const F = await contaDeMentira('Prova Dono F', CPF_DO_DONO, 'prova-f@exemplo.invalido');
  const regDepois = await fotoDoRegistro(PECA_DO_DONO);
  conferir('depois: o registro ficou com cliente_id preenchido',
    regDepois.cliente_id === F.id, JSON.stringify(regDepois.cliente_id));
  conferir('e nada mais do registro mudou',
    ['nome', 'cpf', 'comprado_em', 'garantia_ate', 'pedido_id', 'bling_pedido',
     'bling_contato_id', 'onde_comprou', 'registrado_em']
      .every((c) => String(regAntes[c]) === String(regDepois[c])));

  const minhasF = await minhas(F.token);
  conferir('a peça aparece em "Minhas peças" da conta nova',
    minhasF.ok && minhasF.pecas.some((p) => p.codigo === PECA_DO_DONO && p.estado === 'registrada'),
    JSON.stringify(minhasF));

  const trilhaF = await q(
    `select codigo, acao, detalhes from public.vessel_edicoes
      where acao = 'conta_ligada_pelo_cpf' and detalhes ->> 'cliente_id' = $1
      order by codigo`, [F.id]);
  conferir('a trilha registrou a ligação', trilhaF.rowCount > 0,
    JSON.stringify(trilhaF.rows.map((r) => [r.codigo, r.detalhes.onde])));
  conferir('a trilha leva o CPF MASCARADO, nunca inteiro',
    trilhaF.rows.every((r) => !String(r.detalhes.cpf ?? '').includes(CPF_DO_DONO)),
    JSON.stringify(trilhaF.rows.map((r) => r.detalhes.cpf)));

  const pedidosDoDono = await uma(
    `select count(*) filter (where cliente_id = $1) as ligados, count(*) as total
       from public.vessel_pedidos_de_registro
      where regexp_replace(coalesce(cpf,''), '\\D', '', 'g') = $2`, [F.id, CPF_DO_DONO]);
  conferir('os pedidos daquele CPF também ficaram ligados',
    Number(pedidosDoDono.ligados) === Number(pedidosDoDono.total) && Number(pedidosDoDono.total) > 0,
    JSON.stringify(pedidosDoDono));

  // ══════════════════════════════════════════════════════════════════════
  // (f) CPF sem registro nenhum: nada muda, e a resposta é IDÊNTICA
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n(f) conta nova com CPF sem registro nenhum');
  const contagemAntes = await uma(`
    select (select count(*) from public.vessel_registros where cliente_id is not null) as regs,
           (select count(*) from public.vessel_pedidos_de_registro where cliente_id is not null) as peds,
           (select count(*) from public.vessel_edicoes where acao = 'conta_ligada_pelo_cpf') as trilha`);
  const G = await contaDeMentira('Prova Sem Peca G', '71428793860', 'prova-g@exemplo.invalido');
  const contagemDepois = await uma(`
    select (select count(*) from public.vessel_registros where cliente_id is not null) as regs,
           (select count(*) from public.vessel_pedidos_de_registro where cliente_id is not null) as peds,
           (select count(*) from public.vessel_edicoes where acao = 'conta_ligada_pelo_cpf') as trilha`);
  conferir('CPF sem peça: nada é ligado e nada entra na trilha',
    JSON.stringify(contagemAntes) === JSON.stringify(contagemDepois),
    `${JSON.stringify(contagemAntes)} → ${JSON.stringify(contagemDepois)}`);

  const formaF = Object.keys(F.criada).sort();
  const formaG = Object.keys(G.criada).sort();
  conferir('a resposta de criar conta tem os MESMOS campos com e sem peça',
    JSON.stringify(formaF) === JSON.stringify(formaG), `${formaF} vs ${formaG}`);
  conferir('nenhum campo conta peça, quantidade ou "tem registro"',
    formaG.join(',') === 'cliente_id,email,ok', formaG.join(','));
  conferir('a resposta de quem TEM peça não diz que tem',
    F.criada.ok === true && Object.keys(F.criada).length === 3, JSON.stringify(F.criada));

  const minhasG = await minhas(G.token);
  conferir('"Minhas peças" da conta sem peça vem vazia',
    minhasG.ok && minhasG.pecas.length === 0, JSON.stringify(minhasG));

  // ══════════════════════════════════════════════════════════════════════
  // (g) anon e authenticated continuam barrados — ACL medido
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n(g) o portão: anon e authenticated barrados');
  const FUNCOES = [
    'public.vessel_registrar_como_cliente(text,text,text,date,boolean,text)',
    'public.vessel_transferencia_gerar(text,text)',
    'public.vessel_transferencia_aceitar(text,text,text)',
    'public.vessel_conta_criar(text,text,text,text,date,text)',
  ];
  for (const f of FUNCOES) {
    const p = await uma(
      `select has_function_privilege('anon', $1, 'execute') as anon,
              has_function_privilege('authenticated', $1, 'execute') as auth,
              has_function_privilege('service_role', $1, 'execute') as servico`, [f]);
    conferir(`${f.split('(')[0]}: anon NÃO, authenticated NÃO, service_role SIM`,
      p.anon === false && p.auth === false && p.servico === true, JSON.stringify(p));
  }

  console.log('\n── desfazendo tudo (rollback)');
} finally {
  await q('rollback');
}

// ══════════════════════════════════════════════════════════════════════════
// (g, segunda metade) UMA CHAMADA HTTP DE VERDADE, com a chave publicável
// ══════════════════════════════════════════════════════════════════════════
// ⚠️ FORA da transação, porque a rede não enxerga o que não foi gravado. O que
// esta parte mede é o portão QUE ESTÁ NO AR hoje — e a migration só REVOGA de
// novo, nunca concede: o `has_function_privilege` acima prova o estado depois
// dela.
// ⚠️ NADA AQUI GRAVA. Os três argumentos são escolhidos para que, MESMO se a
// chave passasse, a função pare antes de escrever: token inválido responde
// `sem_sessao`, e CPF de dígito verificador errado responde `cpf_invalido`.
// A chave de serviço NÃO é usada nesta parte.
console.log('\n(g) chamada HTTP de verdade com a chave publicável (nada grava)');
const CHAMADAS = [
  ['vessel_registrar_como_cliente', { p_token: 'token-que-nao-existe', p_codigo: PECA_LIVRE }],
  ['vessel_transferencia_gerar',    { p_token: 'token-que-nao-existe', p_codigo: PECA_LIVRE }],
  ['vessel_transferencia_aceitar',  { p_token: 'token-que-nao-existe', p_codigo: PECA_LIVRE, p_codigo_transferencia: '000000' }],
  ['vessel_conta_criar', { p_nome: 'Nao Grava', p_cpf: '00000000000', p_email: 'nao@exemplo.invalido',
                           p_whatsapp: '19999990000', p_nascimento: '1990-01-01', p_senha: 'nao-usada' }],
];
for (const [nome, corpo] of CHAMADAS) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${nome}`, {
    method: 'POST',
    headers: { apikey: CHAVE_PUBLICAVEL, Authorization: `Bearer ${CHAVE_PUBLICAVEL}`,
               'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  const texto = (await r.text()).slice(0, 200);
  conferir(`${nome}: a chave publicável é recusada (${r.status})`,
    r.status === 404 || r.status === 401 || r.status === 403, `${r.status} ${texto}`);
  console.log(`      ${r.status} ${texto}`);
}

await client.end();
console.log(`\n${falhou === 0 ? '✓ TUDO PASSOU' : '✗ FALHOU'} — ${passou} ok, ${falhou} falhas`);
process.exit(falhou === 0 ? 0 : 1);
