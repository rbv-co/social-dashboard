// Gera 02-gatilhos.sql: os gatilhos de produção das tabelas declaradas em 01-tabelas-*.sql e o
// fechamento das funções que eles chamam, VERBATIM do levantamento (02-funções.csv, 03-triggers.csv).
// Uso (na raiz do repositório):
//   node api/internal/testebanco/esquema/gerar-gatilhos.mjs <dir do levantamento> > api/internal/testebanco/esquema/02-gatilhos.sql
// O 03-triggers.csv não traz FOR EACH nem WHEN: todos saem "for each row", sem WHEN. Ao acrescentar
// tabela, confira nas migrations a orientação e o WHEN de cada gatilho novo.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [dir] = process.argv.slice(2);
if (!dir) {
  console.error('uso: gerar-gatilhos.mjs <dir do levantamento>');
  process.exit(2);
}

function lerCSV(texto) {
  const linhas = [];
  let campo = '', linha = [], aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') aspas = false;
      else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === ',') { linha.push(campo); campo = ''; }
    else if (c === '\n') { linha.push(campo); linhas.push(linha); linha = []; campo = ''; }
    else if (c !== '\r') campo += c;
  }
  if (campo || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas;
}

const aqui = fileURLToPath(new URL('.', import.meta.url));
const tabelas = new Set(readdirSync(aqui).filter((a) => /^01-tabelas-.*\.sql$/.test(a))
  .flatMap((a) => [...readFileSync(join(aqui, a), 'utf8').matchAll(/create table public\.([a-z_][a-z0-9_]*)/g)].map((m) => m[1])));

const [cabF, ...linF] = lerCSV(readFileSync(join(dir, '02-funções.csv'), 'utf8'));
const iNome = cabF.indexOf('proname'), iDef = cabF.indexOf('definicao');
const funcoes = new Map(linF.filter((l) => l.length > iDef).map((l) => [l[iNome], l[iDef]]));

const [cabG, ...linG] = lerCSV(readFileSync(join(dir, '03-triggers.csv'), 'utf8'));
const c = (n) => cabG.indexOf(n);
const gatilhos = new Map();
for (const l of linG) {
  if (l.length < cabG.length || !tabelas.has(l[c('event_object_table')])) continue;
  const chave = `${l[c('event_object_table')]}.${l[c('trigger_name')]}`;
  const g = gatilhos.get(chave) ?? { tabela: l[c('event_object_table')], nome: l[c('trigger_name')],
    momento: l[c('action_timing')], eventos: [], acao: l[c('action_statement')] };
  g.eventos.push(l[c('event_manipulation')]);
  gatilhos.set(chave, g);
}

const chamadas = (texto) => [...funcoes.keys()].filter((n) => new RegExp(`\\b${n}\\(`).test(texto));
const fila = [...gatilhos.values()].flatMap((g) => chamadas(g.acao));
const vistas = new Set();
while (fila.length) {
  const n = fila.shift();
  if (vistas.has(n)) continue;
  if (!funcoes.has(n)) { console.error(`função ${n} não está no CSV`); process.exit(1); }
  vistas.add(n);
  fila.push(...chamadas(funcoes.get(n)));
}

const nomes = [...vistas].sort();
const ordem = [...gatilhos.values()].sort((a, b) => `${a.tabela}.${a.nome}`.localeCompare(`${b.tabela}.${b.nome}`));
process.stdout.write(
  '-- GERADO por gerar-gatilhos.mjs a partir do levantamento de produção (02-funções.csv, 03-triggers.csv).\n' +
  '-- NÃO EDITE À MÃO: rode o script de novo. Corpos verbatim de produção.\n' +
  `-- Tabelas: ${[...tabelas].sort().join(', ')}\n` +
  `-- Funções (${nomes.length}): ${nomes.join(', ')}\n` +
  'set check_function_bodies = off;\n\n' +
  nomes.map((n) => funcoes.get(n).trim() + ';\n').join('\n') + '\n' +
  ordem.map((g) => `create trigger ${g.nome} ${g.momento} ${g.eventos.join(' or ')} on public.${g.tabela} for each row ${g.acao};\n`).join(''),
);
