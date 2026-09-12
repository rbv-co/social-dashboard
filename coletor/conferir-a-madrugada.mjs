#!/usr/bin/env node
// CONFERE, DE MANHÃ, O QUE OS ROBÔS FIZERAM DE MADRUGADA — e avisa na tela.
//
// Duas coisas rodam de madrugada e ninguém fica acordado para ver:
//   03h07 · o backfill dos quatro números (neste Mac, launchd)
//   04h07 · o vigia dos problemas da Meta (no GitHub Actions)
//
// POR QUE ELE NÃO PERGUNTA AO GITHUB SE O VIGIA RODOU: rodar não é o que
// interessa — interessa o registro ter chegado. Um job verde que gravou nada
// seria "sucesso" na aba Actions e mentira aqui. Então a pergunta é feita ao
// banco: quando foi a última vez que um problema foi visto?
//
// Não conserta nada, não grava nada. Só lê e avisa.
import './lib/carregar-env.mjs';
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://kounqtdoioootxqegkij.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const REST = SUPABASE_URL + '/rest/v1';
const sb = { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY };

const AQUI = dirname(fileURLToPath(import.meta.url));
const MARCADOR = join(AQUI, '.backfill-numeros-PRONTO');
const LOG = join(AQUI, 'backfill-madrugada.log');

// Conta linhas sem sair carregando tudo: o PostgREST devolve o total no
// cabeçalho Content-Range quando se pede `count=exact`.
async function contar(caminho) {
  const r = await fetch(REST + caminho, {
    headers: { ...sb, Prefer: 'count=exact', Range: '0-0', 'Range-Unit': 'items' },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const faixa = r.headers.get('content-range') || '';
  const total = Number(faixa.split('/')[1]);
  return Number.isFinite(total) ? total : null;
}

// A PURGA DA FÁBRICA (04h17). Ela saiu do texto puro em 18/08 e passou a usar o
// mesmo `disparar_robo` dos outros robôs — que registra a execução. Antes disso
// ela não deixava rastro nenhum, então "não rodou" e "rodou e ninguém viu" eram
// indistinguíveis. Agora dá para perguntar.
async function ultimaPurga() {
  const r = await fetch(
    `${REST}/robos_execucoes?robo=eq.fabrica-purga&select=disparado_em,status_code,ok&order=disparado_em.desc&limit=1`,
    { headers: sb },
  );
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const [linha] = await r.json();
  return linha || null;
}

async function ultimaVezDoVigia() {
  const r = await fetch(`${REST}/gt_problemas_meta?select=ultima_vez&order=ultima_vez.desc&limit=1`, { headers: sb });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const [linha] = await r.json();
  return linha?.ultima_vez ? new Date(linha.ultima_vez) : null;
}

const horas = (ms) => ms / 3600000;

function ultimaLinhaUtilDoLog() {
  if (!existsSync(LOG)) return 'sem registro nenhum';
  const linhas = readFileSync(LOG, 'utf8').trim().split('\n').filter((l) => l.trim());
  return linhas[linhas.length - 1] || 'registro vazio';
}

function avisar(titulo, texto) {
  console.log(`${titulo}\n${texto}`);
  // `display notification` não aceita aspas soltas no texto; troca por aspa simples.
  const limpo = (s) => String(s).replace(/["\\]/g, "'").slice(0, 240);
  execFile('/usr/bin/osascript', [
    '-e',
    `display notification "${limpo(texto)}" with title "${limpo(titulo)}"`,
  ], () => {});
}

async function principal() {
  const partes = [];
  let algoErrado = false;

  // ---- 1. o backfill
  try {
    const faltam = await contar('/campaign_insights?select=campaign_id&conversas=is.null');
    if (existsSync(MARCADOR)) {
      partes.push(`Backfill: TERMINOU. Faltam ${faltam} linha(s) que a Meta nao devolve.`);
    } else if (faltam === 0) {
      partes.push('Backfill: nao sobrou linha, mas o marcador de PRONTO nao apareceu. Vale olhar o registro.');
      algoErrado = true;
    } else {
      partes.push(`Backfill: ainda faltam ${faltam} linha(s). Continua na proxima madrugada.`);
    }
  } catch (e) {
    partes.push(`Backfill: nao consegui conferir no banco (${e.message}).`);
    algoErrado = true;
  }

  // ---- 2. o vigia
  try {
    const visto = await ultimaVezDoVigia();
    if (!visto) {
      partes.push('Vigia: a tabela de problemas esta vazia.');
      algoErrado = true;
    } else {
      const atras = horas(Date.now() - visto.getTime());
      // O vigia roda 04h07. Às 9h, um registro de menos de 12h significa que ele
      // passou hoje. Mais que isso e ninguem registrou desde ontem.
      if (atras <= 12) {
        partes.push(`Vigia: passou ha ${atras.toFixed(1)}h. Registro em dia.`);
      } else {
        partes.push(`Vigia: NAO passou. Ultimo registro ha ${atras.toFixed(0)}h.`);
        algoErrado = true;
      }
    }
  } catch (e) {
    partes.push(`Vigia: nao consegui conferir no banco (${e.message}).`);
    algoErrado = true;
  }

  // ---- 3. a purga da Fábrica
  try {
    const purga = await ultimaPurga();
    if (!purga) {
      partes.push('Purga da Fabrica: NENHUM registro. Ela mudou de molde em 18/08 -- se nao aparecer, o cron novo nao esta chamando.');
      algoErrado = true;
    } else {
      const atras = horas(Date.now() - new Date(purga.disparado_em).getTime());
      const boa = purga.ok !== false && (purga.status_code == null || purga.status_code < 400);
      if (atras <= 12 && boa) {
        partes.push('Purga da Fabrica: rodou.');
      } else if (!boa) {
        partes.push(`Purga da Fabrica: FALHOU (codigo ${purga.status_code}). Quase certo que e o segredo da funcao.`);
        algoErrado = true;
      } else {
        partes.push(`Purga da Fabrica: nao rodou. Ultima ha ${atras.toFixed(0)}h.`);
        algoErrado = true;
      }
    }
  } catch (e) {
    partes.push(`Purga da Fabrica: nao consegui conferir (${e.message}).`);
    algoErrado = true;
  }

  console.log('Ultima linha do registro do backfill:');
  console.log('  ' + ultimaLinhaUtilDoLog());

  avisar(algoErrado ? 'iamundi · a madrugada pede atencao' : 'iamundi · a madrugada correu bem', partes.join(' '));
}

principal().catch((e) => {
  avisar('iamundi · nao consegui conferir a madrugada', (e && e.message) || String(e));
  process.exit(1);
});
