#!/usr/bin/env node
// RECUPERAR AS CURTIDAS QUE FICARAM ZERADAS NO HISTÓRICO.
//
// O QUE ACONTECEU: entre 21/07 e 06/08/2026 a Meta respondeu o detalhamento das
// interações pela metade várias vezes (curtidas/salvos/compartilhamentos zerados,
// comentários presentes, total certo) e o guarda do coletor deixou passar — ver
// supabase/functions/_shared/leitura-de-engajamento.js, que conta a história
// inteira. O coletor já foi consertado; isto aqui limpa o que ficou gravado.
//
// COMO: para cada linha suspeita, pergunta à Meta de novo a MESMA janela que
// aquela linha representa (ancorada na data em que ela foi capturada, não em
// hoje) e regrava. Se a Meta responder pela metade OUTRA VEZ, a linha é deixada
// como está — o mesmo guarda do coletor decide, então não há como este script
// gravar o problema que veio consertar.
//
// Uso:
//   node recuperar-curtidas-zeradas.mjs            # PRÉVIA, não grava
//   node recuperar-curtidas-zeradas.mjs --gravar   # grava
//
// Sem deps externas (Node 18+). Os tokens saem do banco; nada fica no código.

import './lib/carregar-env.mjs';
import { leituraServe, somaDoDetalhe } from '../supabase/functions/_shared/leitura-de-engajamento.js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://kounqtdoioootxqegkij.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const REST = SUPABASE_URL + '/rest/v1';
const GRAPH = 'https://graph.facebook.com/v21.0';
// CORE_META=true: a Graph passa pelo proxy do `core` (token global); não lê accounts.access_token. Ver lib/core-meta.mjs.
const META = metaDoColetor();
const sb = { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY, 'Content-Type': 'application/json' };

const GRAVAR = process.argv.includes('--gravar');
const PARCELAS = ['likes', 'comments', 'saves', 'shares'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const inicioDoDia = (dia) => Math.floor(new Date(`${dia}T00:00:00-03:00`).getTime() / 1000);
const fimDoDia = (dia) => Math.floor(new Date(`${dia}T23:59:59-03:00`).getTime() / 1000);
const diaMenos = (dia, n) => {
  const d = new Date(`${dia}T12:00:00-03:00`);
  d.setDate(d.getDate() - n);
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
};

// A MESMA janela que o coletor usa (coletar-dados/index.ts), só que ancorada na
// data da linha em vez de "hoje". Se estas contas divergirem, a recuperação
// grava um número que não é o que aquela linha significa.
function janela(dia, dias) {
  if (dias === 0)  return [inicioDoDia(dia), fimDoDia(dia)];
  if (dias === 1)  return [inicioDoDia(diaMenos(dia, 1)), inicioDoDia(dia)];
  if (dias === 99) return [inicioDoDia(`${dia.slice(0, 7)}-01`), fimDoDia(dia)];
  return [inicioDoDia(diaMenos(dia, dias)), inicioDoDia(dia)];
}

async function sbGet(caminho) {
  const r = await fetch(REST + caminho, { headers: sb });
  if (!r.ok) throw new Error(`GET ${caminho} -> ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

async function pedirAMeta(igId, token, dia, dias) {
  const [since, until] = janela(dia, dias);
  const url = new URL(`${GRAPH}/${igId}/insights`);
  url.searchParams.set('metric', 'likes,comments,saves,shares,reach,views,total_interactions,accounts_engaged,profile_views');
  url.searchParams.set('period', 'day');
  url.searchParams.set('metric_type', 'total_value');
  url.searchParams.set('since', String(since));
  url.searchParams.set('until', String(until));
  url.searchParams.set('access_token', token);
  const r = await META.fetch(url.toString());
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.data) return { erro: j?.error?.message || `HTTP ${r.status}` };
  const v = {};
  for (const it of j.data) v[it.name] = it.total_value?.value ?? 0;
  return { leitura: v };
}

async function regravar(id, leitura) {
  const corpo = {};
  for (const k of [...PARCELAS, 'reach', 'views', 'total_interactions', 'accounts_engaged', 'profile_views']) {
    if (k in leitura) corpo[k] = leitura[k] ?? 0;
  }
  const r = await fetch(`${REST}/engagement_snapshots?id=eq.${id}`, {
    method: 'PATCH', headers: { ...sb, Prefer: 'return=minimal' }, body: JSON.stringify(corpo),
  });
  if (!r.ok && ![200, 204].includes(r.status)) {
    throw new Error(`PATCH ${id} -> ${r.status} ${(await r.text()).slice(0, 200)}`);
  }
}

async function main() {
  if (!SERVICE_KEY) { console.error('✗ Falta SUPABASE_SERVICE_KEY (coletor/.env)'); process.exit(1); }

  const contas = await sbGet('/accounts?select=' + META.colunas('id,name,instagram_id,access_token'));
  const porId = Object.fromEntries(contas.map((c) => [c.id, c]));

  // O mesmo critério do guarda: alcance real, curtidas zeradas e interação
  // suficiente para desmentir o zero.
  const ruins = await sbGet(
    '/engagement_snapshots?select=id,account_id,captured_at,period_days,likes,comments,saves,shares,total_interactions,reach'
    + '&reach=gt.0&likes=eq.0&total_interactions=gte.50&order=captured_at.desc',
  );
  console.log(`${ruins.length} linha(s) suspeita(s).${GRAVAR ? '' : '  (PRÉVIA — nada será gravado)'}\n`);
  if (!ruins.length) return;

  let recuperadas = 0, aindaParcial = 0, erros = 0;
  for (const linha of ruins) {
    const c = porId[linha.account_id];
    const rotulo = `${(c?.name || '?').padEnd(18)} ${linha.captured_at} p${String(linha.period_days).padEnd(2)}`;
    if (!META.token(c || {})) { erros++; console.log(`  ! ${rotulo}  sem token`); continue; }

    const { leitura, erro } = await pedirAMeta(c.instagram_id, META.token(c), linha.captured_at, linha.period_days);
    await sleep(250); // a Graph API não gosta de rajada
    if (erro) { erros++; console.log(`  ! ${rotulo}  ${String(erro).slice(0, 80)}`); continue; }

    // O MESMO guarda do coletor decide. Se a Meta respondeu pela metade de novo,
    // não regrava: manter o zero antigo é melhor que gravar um zero novo com
    // cara de recuperado.
    if (!leituraServe(leitura)) {
      aindaParcial++;
      console.log(`  · ${rotulo}  a Meta respondeu pela metade de novo (soma ${somaDoDetalhe(leitura)} de ${leitura.total_interactions ?? 0}) — mantida`);
      continue;
    }

    recuperadas++;
    console.log(`  ✓ ${rotulo}  curtidas ${linha.likes} → ${leitura.likes}  ·  salvos ${linha.saves} → ${leitura.saves ?? 0}`);
    if (GRAVAR) await regravar(linha.id, leitura);
  }

  console.log(`\nrecuperadas: ${recuperadas} · ainda pela metade: ${aindaParcial} · erro: ${erros}`);
  if (!GRAVAR && recuperadas) console.log('Prévia. Rode de novo com --gravar para valer.');
}

main().catch((e) => { console.error('✗ ' + e.message); process.exit(1); });
