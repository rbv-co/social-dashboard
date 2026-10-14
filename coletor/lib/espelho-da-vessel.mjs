// A RODADA DA PLANILHA DA VESSEL (monta as 11 abas, compara com o arquivo no Zoho e só regrava se mudou), separada de
// ONDE os dados vêm: o ensaio/resgate (`espelhar-vessel-no-zoho.mjs`) lê pelo PostgREST do Supabase; o robô da VPS
// (`espelho-da-vessel-na-vps.mjs`) lê o Postgres próprio com `pg`. As abas, as colunas e o fuso moram em
// `supabase/functions/_shared/` (a edge e o node precisam dos MESMOS): ver `abas-da-vessel.js`.
import { writeFileSync } from 'node:fs';
import { RAIZ_RBV, tokenZoho, caminhoDePastas, baixarArquivoBinario, subirArquivoBinario } from './zoho-da-central.mjs';
import { montarXlsx, bytesIguais } from '../../supabase/functions/_shared/planilha-xlsx.js';
import { abasDoXlsx } from '../../supabase/functions/_shared/ler-xlsx.mjs';
import { montarAbas, CONSULTAS } from '../../supabase/functions/_shared/abas-da-vessel.js';

// A pasta onde o dono já trabalha. ⚠️ Por NOME, nunca por id cravado: pasta recriada no Zoho muda de id, e um id fixo
// continuaria apontando, calado, para o lugar errado.
export const CAMINHO = ['04. Vessel Brasil', '17. Marketing', 'Base de clientes'];
export const ARQUIVO = 'Base de clientes.xlsx';
const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * `ler({ tabela, colunas })` devolve as linhas; `conexao()` devolve a conexão do Zoho (client_id, client_secret,
 * refresh_token, data_center). Em grupos de cinco leituras, e não as quinze de uma vez (o `Gateway Timeout` do PostgREST).
 * Devolve { gravou, bytes } e nunca grava no Zoho com `ensaio`.
 */
export async function rodada({ ler, conexao, ensaio = false, mostrar = false, gravarEm = null, log = console.log }) {
  const dados = {};
  const chaves = Object.keys(CONSULTAS);
  for (let i = 0; i < chaves.length; i += 5) {
    const lote = chaves.slice(i, i + 5);
    const partes = await Promise.all(lote.map((n) => ler(CONSULTAS[n])));
    lote.forEach((n, x) => { dados[n] = partes[x]; });
  }
  const abas = montarAbas(dados);
  for (const a of abas) log(`  ${a.nome.padEnd(20)} ${String(a.linhas.length).padStart(5)} linha(s)  ${a.colunas.length} colunas`);
  const bytes = await montarXlsx(abas);
  log(`\n  ${ARQUIVO}: ${(bytes.length / 1024).toFixed(1)} KB, ${abas.length} abas`);
  if (mostrar) {
    // ⚠️ `--mostrar` IMPRIME AS ABAS, lidas de volta do arquivo pronto: contar linhas não prova que a coluna certa tem o dado certo.
    for (const aba of abasDoXlsx(bytes)) {
      log(`\n──────── ${aba.nome} ────────`);
      log(aba.colunas.join(' | '));
      for (const l of aba.linhas.slice(0, 5)) log(l.join(' | '));
    }
  }
  if (gravarEm) { writeFileSync(gravarEm, bytes); log(`\ngravei em ${gravarEm}`); }
  if (ensaio) { log('\nensaio: montei a planilha e não enviei nada.\n'); return { gravou: false, bytes }; }
  const tz = await tokenZoho(await conexao());
  const pasta = await caminhoDePastas(tz, RAIZ_RBV, CAMINHO);
  const laDentro = await baixarArquivoBinario(tz, pasta, ARQUIVO);
  // ⚠️ SÓ REGRAVA SE DIFERE: subir igual a cada rodada enche o histórico do Zoho de versões idênticas.
  if (bytesIguais(laDentro, bytes)) { log(`\n= ${ARQUIVO} não mudou.\n`); return { gravou: false, bytes }; }
  await subirArquivoBinario(tz, pasta, ARQUIVO, bytes, TIPO_XLSX);
  log(`\n↑ ${ARQUIVO} regravada em ${CAMINHO.join(' / ')}\n`);
  return { gravou: true, bytes };
}
