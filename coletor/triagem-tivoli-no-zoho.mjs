// A TRIAGEM DA VAGA DO TIVOLI — puxa os cadastros do formulário do Meta e sobe
// "Triagem Tivoli Vendedora.xlsx" no Zoho (04. Vessel Brasil / 10. RH-DP).
//
//   node coletor/triagem-tivoli-no-zoho.mjs --ensaio
//   node coletor/triagem-tivoli-no-zoho.mjs --ensaio --gravar-em x.xlsx
//   node coletor/triagem-tivoli-no-zoho.mjs            # ⚠️ sobe no Zoho
//
// As colunas e o porquê de cada uma moram em `lib/abas-da-triagem.mjs`.
//
// ⚠️ O TOKEN PRECISA DE `leads_retrieval`. Sem ela o Meta responde (#200) e o
// robô PARA com erro — nunca sobe planilha vazia, que o RH leria como "ninguém
// se candidatou".
import './lib/carregar-env.mjs';
import { writeFileSync } from 'node:fs';
import { montarAbasDaTriagem, anotacoesDoRh, FORMULARIO_DA_VAGA } from './lib/abas-da-triagem.mjs';
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

const CONTA_DA_VESSEL = '1197997517858139';
const PAGINA_DA_VESSEL = '324679337390168';
const CAMINHO = ['04. Vessel Brasil', '10. RH-DP'];
const ARQUIVO = 'Triagem Tivoli Vendedora.xlsx';
const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const G = 'https://graph.facebook.com/v21.0';

async function graph(url) {
  const r = await fetch(url);
  const j = await r.json();
  if (j.error) {
    const dica = j.error.code === 200
      ? '\n  → o token não tem `leads_retrieval`. Gere outro no Business Manager com essa permissão.'
      : '';
    throw new Error(`Meta: ${j.error.message}${dica}`);
  }
  return j;
}

const [conta] = await (await fetch(
  `${REST}/accounts?ad_account_id=eq.${CONTA_DA_VESSEL}&select=access_token`, { headers: cab })).json();
if (!conta?.access_token) throw new Error(`sem token para a conta ${CONTA_DA_VESSEL} em accounts`);

const { access_token: tokenDaPagina } = await graph(
  `${G}/${PAGINA_DA_VESSEL}?fields=access_token&access_token=${conta.access_token}`);
if (!tokenDaPagina) throw new Error('o token não devolveu o token da página da Vessel');

// ⚠️ SEGUIR `paging.next` INTEIRO: a URL já traz o cursor e o token.
const leads = [];
let url = `${G}/${FORMULARIO_DA_VAGA}/leads?fields=created_time,field_data,platform&limit=500&access_token=${tokenDaPagina}`;
while (url) {
  const pag = await graph(url);
  leads.push(...(pag.data || []));
  url = pag.paging?.next || null;
}
console.log(`formulário ${FORMULARIO_DA_VAGA}: ${leads.length} cadastro(s)`);

const tz = ensaio ? null : await tokenZoho(await conexaoZoho(REST, cab));
const pasta = ensaio ? null : await caminhoDePastas(tz, RAIZ_RBV, CAMINHO);
const laDentro = ensaio ? null : await baixarArquivoBinario(tz, pasta, ARQUIVO);
const anotacoes = laDentro ? anotacoesDoRh(abasDoXlsx(laDentro)) : new Map();
console.log(`anotações do RH preservadas: ${anotacoes.size}`);

const bytes = await montarXlsx(montarAbasDaTriagem(leads, anotacoes));
if (gravarEm) { writeFileSync(gravarEm, bytes); console.log(`gravei em ${gravarEm}`); }
if (ensaio) { console.log('ensaio: montei a planilha e não enviei nada.'); process.exit(0); }

if (bytesIguais(laDentro, bytes)) {
  console.log(`= ${ARQUIVO} não mudou.`);
} else {
  await subirArquivoBinario(tz, pasta, ARQUIVO, bytes, TIPO_XLSX);
  console.log(`↑ ${ARQUIVO} em ${CAMINHO.join(' / ')}`);
}
