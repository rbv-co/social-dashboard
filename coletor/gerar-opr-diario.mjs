#!/usr/bin/env node
// coletor/gerar-opr-diario.mjs
// Gera o relatório OPR diário (Paid Media Performance) — imagem consolidando
// o dia ANTERIOR (Growth/Seguidores + Engagement + Leads) — e manda pro
// grupo de WhatsApp via Z-API. Cron: .github/workflows/opr-diario.yml, 08h
// BRT. Ver spec: docs/superpowers/specs/2026-09-17-relatorio-opr-diario-design.md.
//
// Uso: node coletor/gerar-opr-diario.mjs [--dry]
//   --dry: salva o PNG em coletor/opr-preview.png, imprime os números no
//   terminal e para — NUNCA chama a Z-API. Modo de teste/preview.
//   sem --dry (modo do cron, ligado em 17/09/2026 depois do dono aprovar o
//   preview): salva o MESMO PNG (fica de rastro no artefato do Actions) e
//   manda pro grupo de verdade.
import './lib/carregar-env.mjs';
import { writeFile } from 'node:fs/promises';
import { renderPNG, fecharRender } from './lib/render-criativo.mjs';
import { montarHtmlOpr, DIM_OPR } from './lib/template-opr.mjs';
import { agruparCampanhasDoDia, montarDadosOpr } from '../src/ferramentas/meta-ads/relatorio-diario-opr.js';
import { deltaDeSeguidoresPorHora, seguidoresNoDia, visitasPerfilNoDia } from '../src/ferramentas/meta-ads/relatorio-por-hora.js';

// Nome sem ser "URL" — o global `URL` (usado abaixo pra montar o caminho do
// PNG em --dry) fica sombreado por um `const URL` no escopo do módulo.
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://kounqtdoioootxqegkij.supabase.co';
const SK = process.env.SUPABASE_SERVICE_KEY;
const REST = SUPABASE_URL + '/rest/v1';
const H = { apikey: SK, Authorization: 'Bearer ' + SK, 'Content-Type': 'application/json' };
const CONTA_VESSEL = 'b6883e82-07cb-4f21-9fd7-ea7626786174';
// Mesmo grupo de teste do relatório por hora (enviar-relatorio-hora/index.ts).
const GRUPO_WHATSAPP = '120363431546698175-group';

const DRY = process.argv.includes('--dry');

async function sbGet(p) {
  const r = await fetch(REST + p, { headers: H });
  if (!r.ok) throw new Error('GET ' + p + ' ' + r.status);
  return r.json();
}

function ontemBR() {
  // -24h de "agora" cai solidamente em "ontem" em SP contanto que "agora" não
  // esteja perto da virada — o cron roda 08h BRT, 8h de folga da meia-noite.
  const ontem = new Date(Date.now() - 24 * 3600 * 1000);
  return ontem.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}
function periodoLabel(diaISO) {
  const [ano, mes, d] = diaISO.split('-');
  return `${d}/${mes}/${ano}`;
}

async function mandarImagemWhatsapp(buf, legenda) {
  const instanceId = process.env.ZAPI_INSTANCE_ID;
  const instanceToken = process.env.ZAPI_INSTANCE_TOKEN;
  const clientToken = process.env.ZAPI_TOKEN;
  const r = await fetch(`https://api.z-api.io/instances/${instanceId}/token/${instanceToken}/send-image`, {
    method: 'POST',
    headers: { 'Client-Token': clientToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: GRUPO_WHATSAPP, image: `data:image/png;base64,${buf.toString('base64')}`, caption: legenda }),
  });
  if (!r.ok) throw new Error(`Z-API send-image: ${r.status} ${await r.text()}`);
}
async function mandarTextoWhatsapp(mensagem) {
  const instanceId = process.env.ZAPI_INSTANCE_ID;
  const instanceToken = process.env.ZAPI_INSTANCE_TOKEN;
  const clientToken = process.env.ZAPI_TOKEN;
  const r = await fetch(`https://api.z-api.io/instances/${instanceId}/token/${instanceToken}/send-text`, {
    method: 'POST',
    headers: { 'Client-Token': clientToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: GRUPO_WHATSAPP, message: mensagem }),
  });
  if (!r.ok) throw new Error(`Z-API send-text: ${r.status} ${await r.text()}`);
}

async function main() {
  const dia = ontemBR();

  // Busca + agregação num try/catch só: qualquer falha aqui (rede, coluna
  // errada, credencial) é a mesma categoria de problema pro dono — "o
  // relatório não saiu" — e cai no mesmo aviso de texto (spec 6.3). Em
  // --dry nunca manda aviso — só relança, pra nunca arriscar tocar Z-API
  // nesse modo, nem em erro.
  let dados, html;
  try {
    const [campanhas, insights, leituras, visitas] = await Promise.all([
      sbGet('/campaigns?select=campaign_id,name'),
      sbGet(`/campaign_insights?select=campaign_id,spend,likes,comments,shares,saves,conversas,post_engagement&account_id=eq.${CONTA_VESSEL}&captured_at=eq.${dia}&period_days=eq.0`),
      // 48h de folga: garante leitura ANTERIOR ao primeiro bucket de ontem, pra
      // deltaDeSeguidoresPorHora ter "anterior" pra comparar desde a primeira
      // hora do dia inteiro (não só a última hora, como no relatório por hora).
      sbGet(`/followers_leituras?select=followers_count,lido_em&account_id=eq.${CONTA_VESSEL}&lido_em=gte.${new Date(Date.now() - 48 * 3600 * 1000).toISOString()}&order=lido_em.asc`),
      sbGet(`/perfil_visitas_hora?select=dia,hora,visitas_hora&account_id=eq.${CONTA_VESSEL}&dia=eq.${dia}`),
    ]);

    const nomesPorCampanha = Object.fromEntries(campanhas.map((c) => [c.campaign_id, c.name]));
    const campanhasDoDia = agruparCampanhasDoDia(insights, nomesPorCampanha);
    const deltas = deltaDeSeguidoresPorHora(leituras);
    const seguidoresDoDia = seguidoresNoDia(deltas, dia);
    const visitasPerfilDoDia = visitasPerfilNoDia(visitas, dia);

    dados = montarDadosOpr(campanhasDoDia, seguidoresDoDia, visitasPerfilDoDia);
    html = montarHtmlOpr(dados, { conta: 'Vessel Brasil', periodoLabel: periodoLabel(dia) });
  } catch (e) {
    console.error('Falha ao buscar/agregar dados:', e.message);
    if (DRY) throw e;
    await mandarTextoWhatsapp(`⚠️ Relatório OPR de ${periodoLabel(dia)} não saiu — falha ao buscar dados: ${e.message}`);
    return;
  }

  let buf;
  try {
    buf = await renderPNG(html, DIM_OPR);
  } catch (e) {
    console.error('Falha ao renderizar a imagem:', e.message);
    if (DRY) throw e;
    await mandarTextoWhatsapp(`⚠️ Relatório OPR de ${periodoLabel(dia)} não saiu — falha ao renderizar: ${e.message}`);
    return;
  } finally {
    await fecharRender();
  }

  // Salva sempre (dry ou real) — fica de rastro no artefato do Actions
  // mesmo numa rodada real, útil pra conferir depois o que foi mandado.
  await writeFile(new URL('./opr-preview.png', import.meta.url), buf);

  if (DRY) {
    console.log('--dry: PNG salvo em coletor/opr-preview.png, nada enviado.');
    console.log(JSON.stringify(dados, null, 2));
    return;
  }

  try {
    await mandarImagemWhatsapp(buf, `Paid Media Performance — ${periodoLabel(dia)}`);
  } catch (e) {
    console.error('Falha ao mandar a imagem, avisando por texto:', e.message);
    await mandarTextoWhatsapp(`⚠️ Relatório OPR de ${periodoLabel(dia)} não saiu — ${e.message}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
