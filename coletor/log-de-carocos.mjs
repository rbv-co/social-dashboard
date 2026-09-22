// O LOG DOS CAROÇOS NO ANGU — roda as conferências e sobe a planilha.
//
//   node coletor/log-de-carocos.mjs --ensaio                 # só mostra
//   node coletor/log-de-carocos.mjs --ensaio --gravar-em x.xlsx
//   node coletor/log-de-carocos.mjs                          # ⚠️ sobe no Zoho
//
// ⚠️ QUEM MANTÉM O LOG NO DIA A DIA NÃO É ESTE ARQUIVO. Desde 22/09/2026 é a
// edge `vessel-log-de-carocos`, chamada pelo cron do banco de 10 em 10 minutos.
// Este aqui ficou como ENSAIO (montar e olhar sem enviar) e como RESGATE, se a
// edge estiver quebrada — pelo mesmo código e pela mesma função do banco.
//
// O QUE É: pedido do dono em 21/09/2026 — "um log de possíveis erros, o que
// PARECE ser erro, caroço no angu". As conferências, a gravidade e a frase do
// que fazer moram em `lib/carocos-no-angu.mjs`, com teste. Aqui só se executa,
// monta e envia.
//
// ⚠️ ELE NÃO CONSERTA NADA, e é de propósito. Um robô que arruma sozinho o que
// "parece" errado vai um dia apagar dado bom — venda duplicada pode ser duas
// bolsas iguais no mesmo dia. Ele só aponta, e diz o que fazer.
//
// ⚠️ UMA CONFERÊNCIA QUE QUEBRA NÃO DERRUBA AS OUTRAS. Consulta com erro de SQL
// (coluna renomeada numa migration, por exemplo) vira uma linha de aviso dentro
// do próprio log, na aba do assunto. O contrário — a rodada morrer inteira —
// deixaria o dono sem log nenhum e sem saber por quê.
import './lib/carregar-env.mjs';
import { writeFileSync } from 'node:fs';
import pg from 'pg';
import { CONFERENCIAS, montarAbasDoLog } from '../supabase/functions/_shared/carocos-no-angu.js';
import { montarXlsx, bytesIguais } from '../supabase/functions/_shared/planilha-xlsx.js';
import { abasDoXlsx } from '../supabase/functions/_shared/ler-xlsx.mjs';
import {
  RAIZ_RBV, conexaoZoho, tokenZoho, caminhoDePastas,
  baixarArquivoBinario, subirArquivoBinario,
} from './lib/zoho-da-central.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://kounqtdoioootxqegkij.supabase.co';
const REST = SUPABASE_URL + '/rest/v1';
const cab = {
  apikey: process.env.SUPABASE_SERVICE_KEY,
  Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
};

const ensaio = process.argv.includes('--ensaio');
const gravarEm = (() => {
  const i = process.argv.indexOf('--gravar-em');
  return i > 0 ? process.argv[i + 1] : null;
})();

// ⚠️ FORA da "Base de clientes", por pedido do dono: aquela pasta é a base que
// ele lê todo dia; esta é a que ele abre quando desconfia de alguma coisa.
const CAMINHO = ['04. Vessel Brasil', '17. Marketing', 'Acompanhamento'];
const ARQUIVO = 'Log de caroços.xlsx';
const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const cli = new pg.Client({ connectionString: process.env.DATABASE_URL });
await cli.connect();

// ⚠️ A MESMA FUNÇÃO QUE A EDGE CHAMA, e não uma cópia das consultas aqui. Duas
// listas de SQL para o mesmo log é como o ensaio passa a mentir sobre o que o
// robô de verdade faz.
const resultados = {};
const quebradas = [];
try {
  const { rows: [{ vessel_carocos: tudo }] } = await cli.query('select public.vessel_carocos()');
  for (const c of CONFERENCIAS) {
    const linhas = tudo?.[c.chave];
    if (Array.isArray(linhas)) { resultados[c.chave] = linhas; continue; }
    resultados[c.chave] = [];
    quebradas.push(`${c.chave}: a função do banco não devolveu esta conferência`);
  }
} finally {
  await cli.end();
}

// O DIA do cabeçalho do Resumo, no fuso de quem lê.
//
// ⚠️ SÓ O DIA, NUNCA A HORA, e isso não é preguiça. Um relógio dentro da
// planilha muda os bytes a cada rodada, e o robô passaria a regravar o arquivo
// TODA VEZ — a comparação "só sobe se mudou" viraria enfeite. Com o dia, duas
// rodadas do mesmo dia geram bytes idênticos e nada sobe à toa; virou o dia, o
// log sobe uma vez, que é exatamente o que um log diário deve fazer.
// (Foi por este mesmo motivo que a planilha da base NÃO tem carimbo de hora.)
const agora = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric',
}).format(new Date());

const abas = montarAbasDoLog(resultados, agora);
const bytes = await montarXlsx(abas);

let achados = 0;
for (const c of CONFERENCIAS) {
  const n = (resultados[c.chave] ?? []).length;
  achados += n;
  if (n > 0) console.log(`  ${String(n).padStart(4)}  ${c.titulo}  (${c.gravidade})`);
}
console.log(`\n  ${CONFERENCIAS.length} conferências · ${achados} linha(s) no total`
  + ` · ${(bytes.length / 1024).toFixed(1)} KB`);
if (quebradas.length) {
  console.log(`\n  ⚠️ ${quebradas.length} conferência(s) NÃO rodaram:`);
  for (const q of quebradas) console.log(`     ${q}`);
}

if (gravarEm) {
  writeFileSync(gravarEm, bytes);
  console.log(`\ngravei em ${gravarEm}`);
}

if (ensaio) {
  for (const a of abasDoXlsx(bytes)) {
    console.log(`\n──────── ${a.nome} (${a.linhas.length} linha(s)) ────────`);
    for (const l of a.linhas.slice(0, 6)) console.log('  ' + l.filter(Boolean).join(' | ').slice(0, 150));
  }
  console.log('\nensaio: montei o log e não enviei nada.\n');
  process.exit(0);
}

const tz = await tokenZoho(await conexaoZoho(REST, cab));
const pasta = await caminhoDePastas(tz, RAIZ_RBV, CAMINHO);
const laDentro = await baixarArquivoBinario(tz, pasta, ARQUIVO);
// ⚠️ SÓ REGRAVA SE DIFERE — o mesmo cuidado do espelho da base: subir igual
// todo dia enche o histórico do Zoho de versões idênticas.
if (bytesIguais(laDentro, bytes)) {
  console.log(`\n= ${ARQUIVO} não mudou.\n`);
} else {
  await subirArquivoBinario(tz, pasta, ARQUIVO, bytes, TIPO_XLSX);
  console.log(`\n↑ ${ARQUIVO} em ${CAMINHO.join(' / ')}\n`);
}
