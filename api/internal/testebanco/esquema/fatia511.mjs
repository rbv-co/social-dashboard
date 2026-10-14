// Gera 01-tabelas-5-11.sql e 03-funcoes-5-11.sql (fatia 5.11: as 62 RPCs de atendimentos da Vessel).
// Tabelas: o DDL das migrations (db/migrations/*.sql, em ordem de nome): create table, alter table, índices e
// tipos que citam as tabelas da fatia. Funções: VERBATIM do levantamento (02-funções.csv), as RPCs de
// atendimentos/rpc.go mais o fecho do que elas chamam, menos o que as outras fatias já carregam.
// Uso (raiz do repo): node api/internal/testebanco/esquema/fatia511.mjs <dir do levantamento>
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) { console.error('uso: fatia511.mjs <dir do levantamento>'); process.exit(1); }
const aqui = 'api/internal/testebanco/esquema';

function lerCSV(t) {
  const L = []; let c = '', l = [], q = false;
  for (let i = 0; i < t.length; i++) {
    const x = t[i];
    if (q) { if (x === '"' && t[i + 1] === '"') { c += '"'; i++; } else if (x === '"') q = false; else c += x; }
    else if (x === '"') q = true; else if (x === ',') { l.push(c); c = ''; }
    else if (x === '\n') { l.push(c); L.push(l); l = []; c = ''; } else if (x !== '\r') c += x;
  }
  if (c || l.length) { l.push(c); L.push(l); }
  return L;
}

// divide em comandos respeitando '...', $tag$...$tag$ e comentários
function comandos(sql) {
  const out = []; let ini = 0, i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (c === '-' && sql[i + 1] === '-') { while (i < sql.length && sql[i] !== '\n') i++; }
    else if (c === '/' && sql[i + 1] === '*') { i = sql.indexOf('*/', i + 2); i = i < 0 ? sql.length : i + 2; }
    else if (c === "'") { i++; while (i < sql.length && !(sql[i] === "'" && sql[i + 1] !== "'")) i += sql[i] === "'" ? 2 : 1; i++; }
    else if (c === '$') { const m = /^\$[A-Za-z_]*\$/.exec(sql.slice(i)); if (m) { const f = sql.indexOf(m[0], i + m[0].length); i = f < 0 ? sql.length : f + m[0].length; } else i++; }
    else if (c === ';') { out.push(sql.slice(ini, i).replace(/^(\s*(--[^\n]*)?\n)+/, '').trim()); ini = ++i; }
    else i++;
  }
  const r = sql.slice(ini).trim(); if (r) out.push(r);
  return out.filter(Boolean);
}

const nomes = [...readFileSync('api/internal/atendimentos/rpc.go', 'utf8').matchAll(/^\t(?:grava|le|tabela)\("([a-z0-9_]+)"/gm)].map((m) => m[1]);
const [cab, ...lin] = lerCSV(readFileSync(join(dir, '02-funções.csv'), 'utf8'));
const funcoes = new Map(lin.filter((l) => l.length === cab.length).map((l) => [l[cab.indexOf('proname')], l[cab.indexOf('definicao')]]));

// fecho das funções chamadas
const fecho = new Set(nomes);
for (let mud = true; mud;) {
  mud = false;
  for (const n of [...fecho]) for (const m of (funcoes.get(n) ?? '').matchAll(/\b([a-z_][a-z0-9_]*)\s*\(/g)) if (funcoes.has(m[1]) && !fecho.has(m[1])) { fecho.add(m[1]); mud = true; }
}
// tabelas citadas pelo fecho
const tabelas = new Set();
for (const n of fecho) for (const m of (funcoes.get(n) ?? '').toLowerCase().matchAll(/\b(?:(?:from|join)\s+(?:public\.)?(vessel_[a-z_]+)\b(?!\s*\()|(?:into|update)\s+(?:public\.)?(vessel_[a-z_]+)\b)/g)) tabelas.add(m[1] ?? m[2]);
// tabelas que uma tabela da fatia referencia (FK) entram também; a verificação é rodar o SQL
const jaTem = readdirSync(aqui).filter((f) => /^(01-tabelas-5-(0\d|10)|02-gatilhos|03-funcoes-5-(0\d|10))\.sql$/.test(f)).map((f) => readFileSync(join(aqui, f), 'utf8')).join('\n');
// o que as migrações goose da API e a camada de compatibilidade já definem (ex.: disparar_robo, que a 00007 troca) vale mais que o CSV
const daApi = [...readdirSync('api/internal/banco/migracoes').filter((f) => f.endsWith('.sql')).map((f) => readFileSync(join('api/internal/banco/migracoes', f), 'utf8')), readFileSync('api/internal/banco/compat.go', 'utf8')].join('\n');
const jaFuncao = (n) => new RegExp(`function\\s+(?:public\\.)?${n}\\s*\\(`, 'i').test(jaTem + daApi);
const jaTabela = (t) => new RegExp(`create\\s+table\\s+(if\\s+not\\s+exists\\s+)?public\\.${t}\\b`, 'i').test(jaTem);

function extrair() {
for (const f of migr) {
  for (const c of comandos(readFileSync(join('db/migrations', f), 'utf8'))) {
    const alvo = /^\s*(create\s+table(?:\s+if\s+not\s+exists)?|alter\s+table(?:\s+if\s+exists)?(?:\s+only)?|create\s+(?:unique\s+)?index(?:\s+concurrently)?(?:\s+if\s+not\s+exists)?\s+\S+\s+on)\s+(?:public\.)?([a-z_][a-z0-9_]*)/i.exec(c);
    if (!alvo || !noAr.includes(alvo[2].toLowerCase())) continue;
    // só estrutura: nada de RLS, policy, grant, comentário, gatilho, cron
    if (/^\s*alter\s+table[\s\S]*\b(enable|disable|force)\s+row\s+level|\bowner\s+to\b|\benable\s+trigger\b|\bdisable\s+trigger\b/i.test(c)) continue;
    usadas.add(alvo[2].toLowerCase());
    ddl.push({ f, c, tipo: /^create\s+table/i.test(c) ? 0 : /^alter/i.test(c) ? 1 : 2, tab: alvo[2].toLowerCase() });
  }
}
}
// create table antes de alter e índice (migrations antigas alteram o que outra, de nome anterior, cria) e as
// tabelas na ordem das FKs (references) entre si
function ordenar(l) {
  const cr = l.filter((d) => d.tipo === 0), depende = (d) => [...d.c.matchAll(/references\s+(?:public\.)?([a-z_][a-z0-9_]*)/gi)].map((m) => m[1].toLowerCase()).filter((t) => t !== d.tab && cr.some((x) => x.tab === t));
  const feitas = new Set(), ord = [];
  while (ord.length < cr.length) {
    const p = cr.find((d) => !ord.includes(d) && depende(d).every((t) => feitas.has(t)));
    if (!p) throw new Error('ciclo de FK entre ' + cr.filter((d) => !ord.includes(d)).map((d) => d.tab));
    ord.push(p); feitas.add(p.tab);
  }
  return [...ord, ...l.filter((d) => d.tipo === 1), ...l.filter((d) => d.tipo === 2)];
}
const migr = readdirSync('db/migrations').filter((f) => f.endsWith('.sql')).sort();
const noAr = [...tabelas].filter((t) => !jaTabela(t));
const usadas = new Set();
let ddl = [];
let noDdl, vivos, defGatilho, gatilhos;
// ponto fixo: tabela nova puxa função (CHECK, gatilho), função nova puxa tabela, e assim por diante
for (let volta = true; volta;) {
volta = false;
// uma tabela da fatia que referencia (FK) outra tabela vessel_* que nenhuma fatia carrega puxa a outra também
for (let mud = true; mud;) {
  mud = false; usadas.clear(); ddl = [];
  extrair();
  for (const d of ddl) for (const m of d.c.matchAll(/references\s+(?:public\.)?(vessel_[a-z0-9_]+)/gi)) {
    const t = m[1].toLowerCase();
    if (!noAr.includes(t) && !jaTabela(t)) { noAr.push(t); mud = true; }
  }
}
// funções que o DDL chama (CHECK, coluna gerada, default): entram no fecho e vão ANTES das tabelas
const chamaNoDdl = (n) => ddl.some((d) => new RegExp(`(?<!references\\s+|\\bon\\s+|table\\s+(?:if\\s+not\\s+exists\\s+)?)public\\.${n}\\s*\\(`, 'i').test(d.c));
noDdl = [...funcoes.keys()].filter(chamaNoDdl);
for (let mud = true; mud;) {
  mud = false;
  for (const n of [...noDdl, ...fecho]) for (const m of (funcoes.get(n) ?? '').matchAll(/\b([a-z_][a-z0-9_]*)\s*\(/g)) if (funcoes.has(m[1]) && !fecho.has(m[1]) && !noDdl.includes(m[1]) && noDdl.includes(n)) { noDdl.push(m[1]); mud = true; }
}
noDdl.forEach((n) => fecho.add(n));
// gatilhos vivos (03-triggers.csv) das tabelas da fatia, na última definição que as migrations têm; o do
// espelho da lista de espera não tem migration no repositório (coletor/espelhar-vessel-no-zoho.mjs:10): vem do CSV
// (AFTER INSERT / AFTER UPDATE, sem OF nem WHEN visíveis)
const [cabG, ...linG] = lerCSV(readFileSync(join(dir, '03-triggers.csv'), 'utf8'));
vivos = new Map();
for (const l of linG) if (l.length === cabG.length && usadas.has(l[cabG.indexOf('event_object_table')])) {
  const k = l[cabG.indexOf('trigger_name')];
  const v = vivos.get(k) ?? { tabela: l[cabG.indexOf('event_object_table')], momento: l[cabG.indexOf('action_timing')], ev: [], acao: l[cabG.indexOf('action_statement')] };
  v.ev.push(l[cabG.indexOf('event_manipulation')]); vivos.set(k, v);
}
defGatilho = new Map();
for (const f of migr) for (const c of comandos(readFileSync(join('db/migrations', f), 'utf8'))) {
  const m = /^create\s+(?:or\s+replace\s+)?trigger\s+([a-z_0-9]+)/i.exec(c);
  if (m && vivos.has(m[1])) defGatilho.set(m[1], c.replace(/^create\s+(?:or\s+replace\s+)?trigger/i, 'create or replace trigger') + ';');
}
gatilhos = [...vivos].sort(([a], [b]) => a.localeCompare(b)).map(([nome, v]) => defGatilho.get(nome)
  ?? `create or replace trigger ${nome} ${v.momento} ${v.ev.join(' or ')} on public.${v.tabela} for each row ${v.acao};`);
for (const v of vivos.values()) { const n = /execute\s+function\s+(?:public\.)?([a-z_0-9]+)/i.exec(v.acao)?.[1]; if (n) fecho.add(n); }
for (const c of defGatilho.values()) { const n = /execute\s+(?:function|procedure)\s+(?:public\.)?([a-z_0-9]+)/i.exec(c)?.[1]; if (n) fecho.add(n); }
for (let mud = true; mud;) {
  mud = false;
  for (const n of [...fecho]) for (const m of (funcoes.get(n) ?? '').matchAll(/\b([a-z_][a-z0-9_]*)\s*\(/g)) if (funcoes.has(m[1]) && !fecho.has(m[1])) { fecho.add(m[1]); mud = true; }
}
for (const n of fecho) for (const m of (funcoes.get(n) ?? '').toLowerCase().matchAll(/\b(?:(?:from|join)\s+(?:public\.)?(vessel_[a-z_]+)\b(?!\s*\()|(?:into|update)\s+(?:public\.)?(vessel_[a-z_]+)\b)/g)) {
  const t = m[1] ?? m[2];
  if (!noAr.includes(t) && !jaTabela(t)) { noAr.push(t); volta = true; }
}
}
const semDdl = noAr.filter((t) => !usadas.has(t));
const novas = [...fecho].filter((n) => !jaFuncao(n) && !noDdl.includes(n)).sort();
writeFileSync(join(aqui, '01-tabelas-5-11.sql'),
  `-- FATIA 5.11 do esquema de produção para os testes (GERADO por fatia511.mjs: create/alter table e índices das\n` +
  `-- migrations em db/migrations, em ordem de nome, das tabelas que as 62 RPCs de atendimentos da Vessel tocam).\n` +
  `-- Sem RLS, policy nem gatilho (os gatilhos vivos vão em 03-funcoes-5-11.sql). Tabelas: ${[...usadas].sort().join(', ')}\n` +
  `${semDdl.length ? `-- SEM DDL nas migrations: ${semDdl.join(', ')}\n` : ''}\n` + (noDdl.length ? `-- funções que o DDL usa (CHECK/default), verbatim do levantamento\nset check_function_bodies = off;\n` + noDdl.map((n) => funcoes.get(n).trim() + ';\n').join('\n') + '\n' : '') + ordenar(ddl).map((d) => `-- ${d.f}\n${d.c};`).join('\n\n') + '\n');
writeFileSync(join(aqui, '03-funcoes-5-11.sql'),
  `-- VERBATIM de levantamento/02-funções.csv (gerado por fatia511.mjs, Plano 5.11): as 62 RPCs de atendimentos da\n` +
  `-- Vessel e o fecho do que elas chamam que as outras fatias ainda não carregam (${novas.length} funções).\n` +
  `set check_function_bodies = off;\n\n` + novas.map((n) => funcoes.get(n).trim() + ';\n').join('\n') + '\n-- gatilhos vivos\n' + gatilhos.join('\n\n') + '\n');
console.log(`fecho ${fecho.size}, novas ${novas.length}, tabelas ${noAr.length}, ddl ${ddl.length}, sem ddl: ${semDdl.join(',') || '-'}`);
