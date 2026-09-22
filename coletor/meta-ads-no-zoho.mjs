// A PLANILHA DO META ADS — roda as consultas e sobe no Zoho.
//
//   node coletor/meta-ads-no-zoho.mjs --ensaio
//   node coletor/meta-ads-no-zoho.mjs --ensaio --gravar-em x.xlsx
//   node coletor/meta-ads-no-zoho.mjs            # ⚠️ sobe no Zoho
//
// As abas, as colunas e o porquê de cada recorte moram em
// `lib/abas-do-meta-ads.mjs`. Aqui só se executa, monta e envia.
//
// ⚠️ FORA DA "BASE DE CLIENTES", na mesma pasta do log de caroços: aquela é a
// base que o dono lê todo dia; esta é a do dinheiro que sai.
import './lib/carregar-env.mjs';
import { writeFileSync } from 'node:fs';
import pg from 'pg';
import { CONSULTAS, montarAbasDoMetaAds, CONTA_DA_VESSEL, DIAS_NA_JANELA }
  from './lib/abas-do-meta-ads.mjs';
import { montarXlsx, bytesIguais } from '../supabase/functions/_shared/planilha-xlsx.js';
import { abasDoXlsx } from '../supabase/functions/_shared/ler-xlsx.mjs';
import {
  RAIZ_RBV, conexaoZoho, tokenZoho, caminhoDePastas,
  baixarArquivoBinario, subirArquivoBinario,
} from './lib/zoho-da-central.mjs';

const REST = (process.env.SUPABASE_URL || 'https://kounqtdoioootxqegkij.supabase.co') + '/rest/v1';
const cab = {
  apikey: process.env.SUPABASE_SERVICE_KEY,
  Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
};
const ensaio = process.argv.includes('--ensaio');
const gravarEm = (() => {
  const i = process.argv.indexOf('--gravar-em');
  return i > 0 ? process.argv[i + 1] : null;
})();

const CAMINHO = ['04. Vessel Brasil', '17. Marketing', 'Acompanhamento'];
const ARQUIVO = 'Meta Ads.xlsx';
const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const cli = new pg.Client({ connectionString: process.env.DATABASE_URL });
await cli.connect();

let dados;
try {
  // ⚠️ A TRADUÇÃO DO NÚMERO DA META PARA O ID INTERNO ACONTECE AQUI, UMA VEZ.
  // As consultas recebem o UUID de `accounts.id`; nenhuma delas precisa saber
  // que existem dois jeitos de nomear a mesma conta.
  const { rows: [conta] } = await cli.query(
    'select id, name from public.accounts where ad_account_id = $1', [CONTA_DA_VESSEL]);
  if (!conta) {
    throw new Error(`não achei a conta ${CONTA_DA_VESSEL} em accounts. `
      + 'Se a conta de anúncio mudou, é aqui que se troca o número.');
  }
  console.log(`conta: ${conta.name} (${CONTA_DA_VESSEL})\n`);

  dados = {
    resultados: (await cli.query(CONSULTAS.resultados, [conta.id])).rows,
    dias: (await cli.query(CONSULTAS.dias, [conta.id, String(DIAS_NA_JANELA)])).rows,
    anuncios: (await cli.query(CONSULTAS.anuncios, [conta.id])).rows,
    leads: (await cli.query(CONSULTAS.leads, [conta.id])).rows,
    problemas: (await cli.query(CONSULTAS.problemas, [CONTA_DA_VESSEL])).rows,
  };
} finally {
  await cli.end();
}

const abas = montarAbasDoMetaAds(dados);
const bytes = await montarXlsx(abas);
for (const a of abas) {
  console.log(`  ${a.nome.padEnd(26)} ${String(a.linhas.length).padStart(5)} linha(s)`);
}
console.log(`\n  ${ARQUIVO}: ${(bytes.length / 1024).toFixed(1)} KB`);

if (gravarEm) {
  writeFileSync(gravarEm, bytes);
  console.log(`\ngravei em ${gravarEm}`);
}

if (ensaio) {
  for (const a of abasDoXlsx(bytes)) {
    console.log(`\n──────── ${a.nome} ────────`);
    console.log('  ' + a.colunas.join(' | '));
    for (const l of a.linhas.slice(0, 4)) console.log('  ' + l.join(' | ').slice(0, 170));
  }
  console.log('\nensaio: montei a planilha e não enviei nada.\n');
  process.exit(0);
}

const tz = await tokenZoho(await conexaoZoho(REST, cab));
const pasta = await caminhoDePastas(tz, RAIZ_RBV, CAMINHO);
const laDentro = await baixarArquivoBinario(tz, pasta, ARQUIVO);
if (bytesIguais(laDentro, bytes)) {
  console.log(`\n= ${ARQUIVO} não mudou.\n`);
} else {
  await subirArquivoBinario(tz, pasta, ARQUIVO, bytes, TIPO_XLSX);
  console.log(`\n↑ ${ARQUIVO} em ${CAMINHO.join(' / ')}\n`);
}
