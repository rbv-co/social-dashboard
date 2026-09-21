// O ENSAIO DA PLANILHA DA VESSEL — e o resgate, se a edge cair.
//
//   node coletor/espelhar-vessel-no-zoho.mjs --ensaio                  # monta e não envia
//   node coletor/espelhar-vessel-no-zoho.mjs --ensaio --mostrar        # imprime as abas
//   node coletor/espelhar-vessel-no-zoho.mjs --ensaio --gravar-em x.xlsx
//   node coletor/espelhar-vessel-no-zoho.mjs                           # ⚠️ ESCREVE no Zoho
//
// ⚠️ QUEM ESCREVE A PLANILHA NO DIA A DIA NÃO É ESTE ARQUIVO.
// É a edge `vessel-espelhar-lista`, e ela escreve AO VIVO: um gatilho no banco
// (`vessel_lista_espera_espelhar`) a dispara no segundo em que alguém se
// cadastra, e o cron a chama de 3 em 3 minutos. Foi pedido do dono em 12/09/2026.
// Havia também um robô deste repositório escrevendo de hora em hora, no GitHub
// Actions; ele foi desligado em 21/09/2026 para não existirem DOIS escritores no
// mesmo arquivo — o último a subir venceria, e a planilha ficaria pulando entre
// duas versões sem ninguém entender por quê.
//
// Este arquivo continua existindo por dois motivos que valem a manutenção:
//   1. ENSAIO: monta a planilha contra o banco de verdade e imprime, sem enviar
//      nada. É como se confere uma coluna nova antes de publicar a edge.
//   2. RESGATE: se a edge estiver quebrada e o dono precisar da planilha agora,
//      rodar sem `--ensaio` grava o mesmo arquivo, pelo mesmo código.
//
// As abas, as colunas e o fuso moram em `supabase/functions/_shared/`, porque a
// edge (Deno) e o node precisam dos MESMOS. Ver `abas-da-vessel.js`.
import './lib/carregar-env.mjs';
import { writeFileSync } from 'node:fs';
import {
  RAIZ_RBV, conexaoZoho, tokenZoho, caminhoDePastas,
  baixarArquivoBinario, subirArquivoBinario,
} from './lib/zoho-da-central.mjs';
import { montarXlsx, bytesIguais } from '../supabase/functions/_shared/planilha-xlsx.js';
import { abasDoXlsx } from '../supabase/functions/_shared/ler-xlsx.mjs';
import { montarAbas, CONSULTAS } from '../supabase/functions/_shared/abas-da-vessel.js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://kounqtdoioootxqegkij.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const REST = SUPABASE_URL + '/rest/v1';
const cab = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

const ensaio = process.argv.includes('--ensaio');
// ⚠️ `--mostrar` IMPRIME AS ABAS, lidas de volta do arquivo pronto. Contar
// linhas não prova que a coluna certa tem o dado certo: uma planilha com as
// colunas trocadas tem o mesmo número de linhas de uma correta.
const mostrar = process.argv.includes('--mostrar');
const gravarEm = (() => {
  const i = process.argv.indexOf('--gravar-em');
  return i > 0 ? process.argv[i + 1] : null;
})();

// A pasta onde o dono já trabalha. ⚠️ Por NOME, nunca por id cravado: pasta
// recriada no Zoho muda de id, e um id fixo continuaria apontando, calado, para
// o lugar errado. O mesmo caminho está na edge — se mudar aqui, mudar lá.
const CAMINHO = ['04. Vessel Brasil', '17. Marketing', 'Base de clientes'];
const ARQUIVO = 'Base de clientes.xlsx';
const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * ⚠️ TRÊS TENTATIVAS, E NÃO UMA. Medido em 12/09/2026: na virada do minuto
 * vários cron disparam juntos e o PostgREST devolve `Gateway Timeout`. Com 15
 * leituras por rodada, uma falha solta derrubaria a rodada inteira.
 */
async function ler({ tabela, colunas }) {
  const linhas = [];
  for (let inicio = 0; ; inicio += 1000) {
    // Sem `order`: quem ordena é a aba (ver o aviso em `CONSULTAS`).
    const url = `${REST}/${tabela}?select=${colunas}&limit=1000&offset=${inicio}`;
    let parte = null;
    let ultimoErro = '';
    for (let tentativa = 1; tentativa <= 3; tentativa++) {
      const r = await fetch(url, { headers: cab });
      if (r.ok) { parte = await r.json(); break; }
      ultimoErro = `HTTP ${r.status} ${(await r.text()).slice(0, 120)}`;
      if (tentativa < 3) await new Promise((ok) => setTimeout(ok, 600 * tentativa));
    }
    if (parte === null) throw new Error(`${tabela}: ${ultimoErro}`);
    linhas.push(...parte);
    if (parte.length < 1000) break;
  }
  return linhas;
}

// ── a rodada ─────────────────────────────────────────────────────────────────
if (!SERVICE_KEY) { console.error('⛔ Falta SUPABASE_SERVICE_KEY.'); process.exit(1); }

// Em grupos de cinco, e não as quinze de uma vez: é o mesmo cuidado do
// `Gateway Timeout` acima.
const dados = {};
const chaves = Object.keys(CONSULTAS);
for (let i = 0; i < chaves.length; i += 5) {
  const lote = chaves.slice(i, i + 5);
  const partes = await Promise.all(lote.map((n) => ler(CONSULTAS[n])));
  lote.forEach((n, x) => { dados[n] = partes[x]; });
}

const abas = montarAbas(dados);
for (const a of abas) {
  console.log(`  ${a.nome.padEnd(20)} ${String(a.linhas.length).padStart(5)} linha(s)`
    + `  ${a.colunas.length} colunas`);
}

const bytes = await montarXlsx(abas);
console.log(`\n  ${ARQUIVO}: ${(bytes.length / 1024).toFixed(1)} KB, ${abas.length} abas`);

if (mostrar) {
  for (const aba of abasDoXlsx(bytes)) {
    console.log(`\n──────── ${aba.nome} ────────`);
    console.log(aba.colunas.join(' | '));
    for (const l of aba.linhas.slice(0, 5)) console.log(l.join(' | '));
  }
}

if (gravarEm) {
  writeFileSync(gravarEm, bytes);
  console.log(`\ngravei em ${gravarEm}`);
}

if (ensaio) {
  console.log('\nensaio: montei a planilha e não enviei nada.\n');
  process.exit(0);
}

console.log('\n⚠️ ESCREVENDO NO ZOHO À MÃO. No dia a dia quem faz isso é a edge '
  + '`vessel-espelhar-lista`, ao vivo.');

const tz = await tokenZoho(await conexaoZoho(REST, cab));
const pasta = await caminhoDePastas(tz, RAIZ_RBV, CAMINHO);

const laDentro = await baixarArquivoBinario(tz, pasta, ARQUIVO);
// ⚠️ SÓ REGRAVA SE DIFERE. Subir igual a cada rodada enche o histórico do Zoho
// de versões idênticas e faz a planilha parecer que mudou quando não mudou.
if (bytesIguais(laDentro, bytes)) {
  console.log(`\n= ${ARQUIVO} não mudou.\n`);
} else {
  await subirArquivoBinario(tz, pasta, ARQUIVO, bytes, TIPO_XLSX);
  console.log(`\n↑ ${ARQUIVO} regravada em ${CAMINHO.join(' / ')}\n`);
}
