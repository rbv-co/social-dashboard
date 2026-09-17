// LÊ UMA CÓPIA DE SEGURANÇA DE VOLTA.
//
//   node coletor/restaurar-copia.mjs --listar
//   node coletor/restaurar-copia.mjs --conferir 2026-09-16
//   node coletor/restaurar-copia.mjs --restaurar 2026-09-16
//
// ⚠️ ELE NUNCA ESCREVE POR CIMA DA TABELA VIVA.
// `--restaurar` cria um schema separado (`copia_AAAAMMDD`) e escreve lá dentro,
// e depois imprime a comparação linha a linha com o que está em produção.
// Voltar para produção é passo à mão, com alguém olhando essa comparação.
// Restauração automática por cima de dado vivo é como se perde o dado DUAS
// vezes: primeiro o estrago, depois a tentativa de consertar.
//
// ⚠️ E BACKUP QUE NUNCA FOI RESTAURADO NÃO É BACKUP, É UM ARQUIVO.
// Por isso `--conferir` existe e é barato: ele baixa a cópia e confere cada
// arquivo contra o manifesto — contagem de linhas e soma de verificação. Roda
// todo dia 1º pelo agendamento, junto com a cópia.
import './lib/carregar-env.mjs';
import { createHash } from 'node:crypto';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://kounqtdoioootxqegkij.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const REST = SUPABASE_URL + '/rest/v1';
const WD = 'https://www.zohoapis.com/workdrive/api/v1';
const RAIZ = 'wbp6sefe483fe7da14c6ebe53225105f1f389';
const PASTA_BASE = '00. Copias de seguranca da Central';

const cabSb = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
const wdCab = (t) => ({ Authorization: `Zoho-oauthtoken ${t}`, Accept: 'application/vnd.api+json' });
const soma = (texto) => createHash('sha256').update(texto).digest('hex');

async function tokenZoho() {
  const r = await fetch(`${REST}/acessos_conexoes?provedor=eq.zoho`
    + '&select=client_id,client_secret,refresh_token,data_center&limit=1', { headers: cabSb });
  const [c] = await r.json();
  if (!c?.refresh_token) throw new Error('A Central não está conectada ao Zoho.');
  let dc = String(c.data_center || '.com');
  if (!dc.startsWith('.')) dc = '.' + dc;
  const t = await fetch(`https://accounts.zoho${dc}/oauth/v2/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: c.client_id,
      client_secret: c.client_secret, refresh_token: c.refresh_token }),
  }).then((x) => x.json());
  if (!t?.access_token) throw new Error('Não consegui entrar no Zoho.');
  return t.access_token;
}

async function pastasDe(t, paiId) {
  const r = await fetch(`${WD}/files/${encodeURIComponent(paiId)}/folders?page%5Blimit%5D=200`,
    { headers: wdCab(t) });
  const j = r.ok ? await r.json().catch(() => null) : null;
  return (j?.data ?? []).map((f) => ({ id: String(f.id), nome: String(f?.attributes?.name ?? '').trim() }));
}
async function arquivosDe(t, pastaId) {
  const r = await fetch(`${WD}/files/${encodeURIComponent(pastaId)}/files?page%5Blimit%5D=500`,
    { headers: wdCab(t) });
  const j = r.ok ? await r.json().catch(() => null) : null;
  return (j?.data ?? []).map((f) => ({ id: String(f.id), nome: String(f?.attributes?.name ?? '').trim() }));
}
async function baixar(t, id) {
  const r = await fetch(`${WD}/download/${encodeURIComponent(id)}`,
    { headers: { Authorization: `Zoho-oauthtoken ${t}` } });
  if (!r.ok) throw new Error(`não consegui baixar (HTTP ${r.status})`);
  return await r.text();
}

async function acharPastaDoDia(t, dia) {
  const base = (await pastasDe(t, RAIZ)).find((p) => p.nome === PASTA_BASE);
  if (!base) throw new Error(`não achei a pasta "${PASTA_BASE}" no Zoho`);
  const diario = (await pastasDe(t, base.id)).find((p) => p.nome === 'diario');
  if (!diario) throw new Error('não achei a pasta "diario"');
  const todas = (await pastasDe(t, diario.id))
    .filter((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.nome))
    .sort((a, b) => b.nome.localeCompare(a.nome));
  if (!dia) return { todas, escolhida: null };
  const escolhida = todas.find((p) => p.nome === dia);
  if (!escolhida) throw new Error(`não existe cópia de ${dia}. Tem: ${todas.map((p) => p.nome).join(', ')}`);
  return { todas, escolhida };
}

const comando = process.argv[2];
const dia = process.argv[3];
const t = await tokenZoho();

if (comando === '--listar') {
  const { todas } = await acharPastaDoDia(t, null);
  console.log(`\n${todas.length} cópias em ${PASTA_BASE} / diario:\n`);
  for (const p of todas) console.log('  ' + p.nome);
  console.log();
  process.exit(0);
}

if (!dia || !/^\d{4}-\d{2}-\d{2}$/.test(dia)) {
  console.error('uso: restaurar-copia.mjs --listar | --conferir <AAAA-MM-DD> | --restaurar <AAAA-MM-DD>');
  process.exit(2);
}

const { escolhida } = await acharPastaDoDia(t, dia);
const arquivos = await arquivosDe(t, escolhida.id);
const oManifesto = arquivos.find((a) => a.nome === 'manifesto.json');
if (!oManifesto) throw new Error(`a cópia de ${dia} não tem manifesto — não dá para confiar nela`);
const manifesto = JSON.parse(await baixar(t, oManifesto.id));

console.log(`\nCÓPIA DE ${dia} (${manifesto.tipo}) — ${Object.keys(manifesto.tabelas).length} tabelas\n`);

let falhas = 0;
const conteudo = {};
for (const [tabela, esperado] of Object.entries(manifesto.tabelas)) {
  const arq = arquivos.find((a) => a.nome === `${tabela}.jsonl`);
  if (!arq) { console.log(`  ⛔ ${tabela.padEnd(32)} FALTA o arquivo`); falhas++; continue; }
  const texto = await baixar(t, arq.id);
  conteudo[tabela] = texto;
  const linhas = texto.trim() ? texto.trim().split('\n').length : 0;
  const somaOk = soma(texto) === esperado.soma;
  const linhasOk = linhas === esperado.linhas;
  if (!somaOk || !linhasOk) {
    console.log(`  ⛔ ${tabela.padEnd(32)} ${linhas}/${esperado.linhas} linhas, `
      + `soma ${somaOk ? 'bate' : 'NAO BATE'}`);
    falhas++;
  } else if (esperado.linhas > 0) {
    console.log(`  ok ${tabela.padEnd(32)} ${String(esperado.linhas).padStart(7)} linhas, soma bate`
      + (esperado.sem_o_valor ? `  (sem ${esperado.sem_o_valor.join('/')})` : ''));
  }
}

if (falhas) {
  console.error(`\n⛔ ${falhas} arquivo(s) com problema. Esta cópia NÃO está íntegra.\n`);
  process.exit(1);
}
console.log('\nA CÓPIA ESTÁ ÍNTEGRA: todo arquivo bate com o manifesto, linha e soma.');

if (comando === '--conferir') {
  console.log('(--conferir para aqui. Use --restaurar para escrever num schema separado.)\n');
  process.exit(0);
}

// ── restaurar, num schema SEPARADO ───────────────────────────────────────────
const { default: pg } = await import('pg');
const schema = 'copia_' + dia.replace(/-/g, '');
const cli = new pg.Client({ connectionString: process.env.DATABASE_URL });
await cli.connect();
console.log(`\nescrevendo em ${schema} (NUNCA por cima do vivo)…\n`);
await cli.query(`drop schema if exists ${schema} cascade`);
await cli.query(`create schema ${schema}`);

const comparacao = [];
for (const [tabela, texto] of Object.entries(conteudo)) {
  // A tabela da cópia nasce com a MESMA forma da de produção, e recebe os
  // registros como JSON. Assim não é preciso adivinhar tipo de coluna.
  // O nome vem do manifesto, que este mesmo projeto escreveu — mas vai entre
  // aspas de qualquer jeito: nome de tabela concatenado em SQL é como se abre
  // uma porta que ninguém queria abrir.
  const alvo = `"${schema}"."${tabela.replace(/"/g, '')}"`;
  await cli.query(`create table ${alvo} (linha jsonb)`);
  const linhas = texto.trim() ? texto.trim().split('\n') : [];
  for (let i = 0; i < linhas.length; i += 500) {
    const lote = linhas.slice(i, i + 500);
    await cli.query(
      `insert into ${alvo} (linha) select * from unnest($1::jsonb[])`,
      [lote]);
  }
  const { rows: [viva] } = await cli.query(
    `select count(*)::int as n from public."${tabela.replace(/"/g, '')}"`)
    .catch(() => ({ rows: [{ n: null }] }));
  comparacao.push({ tabela, na_copia: linhas.length, em_producao: viva.n });
}
await cli.end();

console.log(`${'tabela'.padEnd(32)} ${'na copia'.padStart(9)} ${'em producao'.padStart(12)}  diferenca`);
for (const c of comparacao.sort((a, b) => b.na_copia - a.na_copia)) {
  if (c.na_copia === 0 && c.em_producao === 0) continue;
  const d = c.em_producao === null ? '(a tabela nao existe mais)' : c.em_producao - c.na_copia;
  console.log(`${c.tabela.padEnd(32)} ${String(c.na_copia).padStart(9)} `
    + `${String(c.em_producao ?? '—').padStart(12)}  ${d > 0 ? '+' + d : d}`);
}
console.log(`\nA cópia está em ${schema}. Nada em produção foi tocado.`);
console.log('Para jogar fora quando terminar de olhar:');
console.log(`  drop schema ${schema} cascade;\n`);
