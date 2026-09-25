// A TRIAGEM DA VAGA DO TIVOLI — lê `vessel_candidaturas`, leva os currículos
// para o Zoho e sobe "Triagem Tivoli Vendedora.xlsx" em
// 04. Vessel Brasil / 10. RH-DP.
//
//   node coletor/triagem-tivoli-no-zoho.mjs --ensaio
//   node coletor/triagem-tivoli-no-zoho.mjs --ensaio --gravar-em x.xlsx
//   node coletor/triagem-tivoli-no-zoho.mjs            # ⚠️ sobe no Zoho
//   ... --incluir-testes   (só para provar: leva também as linhas `teste`)
//
// As colunas e o porquê de cada uma moram em `lib/abas-da-triagem.mjs`.
import './lib/carregar-env.mjs';
import { writeFileSync } from 'node:fs';
import {
  montarAbasDaTriagem, nomeDoCurriculo, VAGA, PASTA_DOS_CURRICULOS,
} from './lib/abas-da-triagem.mjs';
import { montarXlsx, bytesIguais } from '../supabase/functions/_shared/planilha-xlsx.js';
import { abasDoXlsx } from '../supabase/functions/_shared/ler-xlsx.mjs';
import {
  RAIZ_RBV, conexaoZoho, tokenZoho, caminhoDePastas, arquivosDe,
  baixarArquivoBinario, subirArquivoBinario,
} from './lib/zoho-da-central.mjs';

const BASE = process.env.SUPABASE_URL || 'https://kounqtdoioootxqegkij.supabase.co';
const REST = BASE + '/rest/v1';
const cab = {
  apikey: process.env.SUPABASE_SERVICE_KEY,
  Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
};
const ensaio = process.argv.includes('--ensaio');
const incluirTestes = process.argv.includes('--incluir-testes');
const gravarEm = (() => {
  const i = process.argv.indexOf('--gravar-em');
  return i > 0 ? process.argv[i + 1] : null;
})();

// ⚠️ `TRIAGEM_PROVA=1` grava numa pasta de prova DENTRO do RH-DP, para provar o
// robô no Zoho de verdade sem misturar teste com candidata. Apagar depois.
const CAMINHO = ['04. Vessel Brasil', '10. RH-DP',
  ...(process.env.TRIAGEM_PROVA ? ['_PROVA do robô (pode apagar)'] : [])];
const ARQUIVO = 'Triagem Tivoli Vendedora.xlsx';
const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// ⚠️ LEITURA QUE FALHA PARA O ROBÔ. Se a consulta der erro e o robô seguisse
// com lista vazia, subiria uma planilha sem ninguém — e o RH leria "ninguém se
// candidatou", com as anotações dele apagadas junto.
const filtroTeste = incluirTestes ? '' : '&teste=eq.false';
const r = await fetch(`${REST}/vessel_candidaturas?vaga=eq.${VAGA}${filtroTeste}`
  + '&select=id,criado_em,nome,whatsapp,cidade,experiencia,fim_de_semana,curriculo,origem,na_planilha_em'
  + '&order=criado_em.desc&limit=5000', { headers: cab });
if (!r.ok) throw new Error(`o banco recusou a leitura das candidaturas (HTTP ${r.status}): ${await r.text()}`);
const candidaturas = await r.json();
console.log(`${VAGA}: ${candidaturas.length} candidatura(s)${incluirTestes ? ' (com testes)' : ''}`);

const tz = ensaio ? null : await tokenZoho(await conexaoZoho(REST, cab));
const pasta = ensaio ? null : await caminhoDePastas(tz, RAIZ_RBV, CAMINHO);

// ── os currículos: só os que ainda não estão lá ────────────────────────────
if (!ensaio) {
  const pastaCv = await caminhoDePastas(tz, pasta, [PASTA_DOS_CURRICULOS]);
  const jaLa = new Set((await arquivosDe(tz, pastaCv)).map((a) => a.nome));
  let levados = 0;
  for (const c of candidaturas) {
    const nome = nomeDoCurriculo(c);
    if (!nome || jaLa.has(nome)) continue;
    const baixa = await fetch(`${BASE}/storage/v1/object/vessel-curriculos/${c.curriculo}`, { headers: cab });
    if (!baixa.ok) {
      // Um currículo que não baixa não pode derrubar a planilha de todos.
      console.warn(`⚠️ não baixei o currículo de ${c.id} (HTTP ${baixa.status})`);
      continue;
    }
    const tipo = baixa.headers.get('content-type') || 'application/octet-stream';
    await subirArquivoBinario(tz, pastaCv, nome, Buffer.from(await baixa.arrayBuffer()), tipo);
    levados++;
  }
  console.log(`currículos levados agora: ${levados} (já estavam lá: ${jaLa.size})`);
}

const laDentro = ensaio ? null : await baixarArquivoBinario(tz, pasta, ARQUIVO);
// ⚠️ ACRESCENTA, NÃO REESCREVE: o que está no arquivo volta como o RH deixou.
// Se a planilha perdeu a aba ou a coluna do ID, `montarAbasDaTriagem` LANÇA e
// o robô para aqui, sem subir nada.
const lidas = laDentro ? abasDoXlsx(laDentro) : null;
const { abas, entregues, novas } = montarAbasDaTriagem(candidaturas, lidas);
console.log(`linhas que já estavam (mantidas como o RH deixou): ${abas[0].linhas.length - novas}`);
console.log(`candidatas novas no topo: ${novas}`);

const bytes = await montarXlsx(abas);
if (gravarEm) { writeFileSync(gravarEm, bytes); console.log(`gravei em ${gravarEm}`); }
if (ensaio) { console.log('ensaio: montei a planilha e não enviei nada.'); process.exit(0); }

if (novas === 0 && laDentro) {
  // ⚠️ SEM CANDIDATA NOVA, NÃO SE SOBE NADA — nem a mesma planilha regravada.
  // Subir por cima enquanto o RH está com o arquivo aberto no Zoho é o jeito
  // mais fácil de brigar com a edição dele.
  console.log(`= ${ARQUIVO}: nenhuma candidata nova, não mexi.`);
} else if (bytesIguais(laDentro, bytes)) {
  console.log(`= ${ARQUIVO} não mudou.`);
} else {
  await subirArquivoBinario(tz, pasta, ARQUIVO, bytes, TIPO_XLSX);
  console.log(`↑ ${ARQUIVO} em ${CAMINHO.join(' / ')}`);
}

// Só DEPOIS de subir: marca quem passou a estar na planilha. Marcar antes, e o
// envio falhar, faria a candidata parecer "apagada pelo RH" e nunca entrar.
const marcar = entregues.filter((id) => !candidaturas.find((c) => String(c.id) === id)?.na_planilha_em);
if (marcar.length) {
  const m = await fetch(`${REST}/vessel_candidaturas?id=in.(${marcar.join(',')})`, {
    method: 'PATCH',
    headers: { ...cab, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ na_planilha_em: new Date().toISOString() }),
  });
  if (!m.ok) throw new Error(`subi a planilha mas não marquei as entregues (HTTP ${m.status}): ${await m.text()}`);
  console.log(`marcadas como entregues: ${marcar.length}`);
}
