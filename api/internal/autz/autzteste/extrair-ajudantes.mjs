// Extrai do levantamento de produção (02-funções.csv, fora do git) as funções SQL que as
// policies chamam, e as que ELAS chamam, verbatim, para o oráculo do teste de contrato.
// Uso (na raiz do repositório):
//   node api/internal/autz/autzteste/extrair-ajudantes.mjs <caminho/02-funções.csv> > api/internal/autz/autzteste/ajudantes.sql
import { readFileSync } from 'node:fs';

const [csvPath] = process.argv.slice(2);
if (!csvPath) {
  console.error('uso: extrair-ajudantes.mjs <02-funções.csv>');
  process.exit(2);
}

// CSV com campos entre aspas que atravessam linhas ("" = aspas dentro do campo).
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

const [cab, ...linhas] = lerCSV(readFileSync(csvPath, 'utf8'));
const iNome = cab.indexOf('proname'), iDef = cab.indexOf('definicao');
const funcoes = new Map(linhas.filter((l) => l.length > iDef).map((l) => [l[iNome], l[iDef]]));

const catalogo = JSON.parse(readFileSync(new URL('../catalogo-policies-producao.json', import.meta.url), 'utf8'));
const chamadas = (texto) => [...funcoes.keys()].filter((n) => new RegExp(`\\b${n}\\(`).test(texto));

// Fechamento: as funções citadas nas policies + as que o vessel_pode e cia. chamam + as que os
// portões de RPC dos sub-planos usam (lista fixa abaixo).
const extras = ['pode_aprovar_frota', 'pode_cadastrar_pessoa_rapida', 'is_vessel_atendimentos', 'is_vessel_atendimentos_editar'];
const fila = [...new Set([...catalogo.flatMap((p) => chamadas(`${p.using ?? ''} ${p.withCheck ?? ''}`)), ...extras])];
const vistas = new Set();
while (fila.length) {
  const n = fila.shift();
  if (vistas.has(n)) continue;
  if (!funcoes.has(n)) { console.error(`função ${n} não está no CSV`); process.exit(1); }
  vistas.add(n);
  fila.push(...chamadas(funcoes.get(n)));
}

const nomes = [...vistas].sort();
process.stdout.write(
  '-- GERADO por extrair-ajudantes.mjs a partir do levantamento de produção (02-funções.csv).\n' +
  '-- NÃO EDITE À MÃO: rode o script de novo. Corpos verbatim de produção.\n' +
  `-- Funções (${nomes.length}): ${nomes.join(', ')}\n` +
  'set check_function_bodies = off;\n\n' +
  nomes.map((n) => funcoes.get(n).trim() + ';\n').join('\n'),
);
