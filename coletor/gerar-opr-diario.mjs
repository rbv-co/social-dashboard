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
import {
  deltaDeSeguidoresPorHora, seguidoresNoDia, seguidoresTotalNoFimDoDia,
  montarMensagemLeadsFechamentoDia, montarMensagemSeguidoresFechamentoDia,
} from '../src/ferramentas/meta-ads/relatorio-por-hora.js';
import { visitasPerfilDoDiaMeta, salvarVisitasPerfilDoDia } from './lib/visitas-perfil-meta.mjs';

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

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Retentativa com backoff (18/09/2026) — visto 3x (2x local, 1x no cron real
// do GitHub Actions) o mesmo erro ("Illegal base64 character 2c": a Z-API
// tentando decodificar o prefixo "data:image/...;base64," como se fosse
// base64 de verdade). Tentei reproduzir de propósito (2 send-text reais
// seguidos de send-image, o mesmo padrão do robô) 2x e as duas vezes
// funcionou de primeira — não é 100% determinístico, então não é bug óbvio
// de conexão reaproveitada nem payload errado (confirmado: o base64 puro
// nunca tem vírgula). Parece falha transiente do LADO da Z-API que se
// resolve sozinha em alguns segundos — mas 3 tentativas de 2s (primeira
// versão deste fix) NÃO foram suficientes no cron real. Backoff mais longo
// (3s/6s/12s/24s, 5 tentativas) dá mais chance de pegar a janela boa.
async function mandarImagemWhatsapp(buf, legenda) {
  const instanceId = process.env.ZAPI_INSTANCE_ID;
  const instanceToken = process.env.ZAPI_INSTANCE_TOKEN;
  const clientToken = process.env.ZAPI_TOKEN;
  const body = JSON.stringify({ phone: GRUPO_WHATSAPP, image: `data:image/png;base64,${buf.toString('base64')}`, caption: legenda });

  let ultimoErro;
  for (let tentativa = 1; tentativa <= 5; tentativa++) {
    const r = await fetch(`https://api.z-api.io/instances/${instanceId}/token/${instanceToken}/send-image`, {
      method: 'POST',
      headers: { 'Client-Token': clientToken, 'Content-Type': 'application/json' },
      body,
    });
    if (r.ok) return;
    ultimoErro = new Error(`Z-API send-image: ${r.status} ${await r.text()}`);
    if (tentativa < 5) await esperar(3000 * 2 ** (tentativa - 1));
  }
  throw ultimoErro;
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
  let dados, html, mensagemLeads, mensagemSeguidores;
  try {
    const [campanhas, insights, leituras, contas] = await Promise.all([
      sbGet('/campaigns?select=campaign_id,name'),
      sbGet(`/campaign_insights?select=campaign_id,spend,likes,comments,shares,saves,conversas,post_engagement&account_id=eq.${CONTA_VESSEL}&captured_at=eq.${dia}&period_days=eq.0`),
      // 48h de folga: garante leitura ANTERIOR ao primeiro bucket de ontem, pra
      // deltaDeSeguidoresPorHora ter "anterior" pra comparar desde a primeira
      // hora do dia inteiro (não só a última hora, como no relatório por hora).
      sbGet(`/followers_leituras?select=followers_count,lido_em,origem&account_id=eq.${CONTA_VESSEL}&lido_em=gte.${new Date(Date.now() - 48 * 3600 * 1000).toISOString()}&order=lido_em.asc`),
      sbGet(`/accounts?select=instagram_id,access_token&id=eq.${CONTA_VESSEL}`),
    ]);

    const nomesPorCampanha = Object.fromEntries(campanhas.map((c) => [c.campaign_id, c.name]));
    const campanhasDoDia = agruparCampanhasDoDia(insights, nomesPorCampanha);
    const deltas = deltaDeSeguidoresPorHora(leituras);
    const seguidoresDoDia = seguidoresNoDia(deltas, dia);
    // Direto da Meta, dia já FECHADO — não soma perfil_visitas_hora (achado
    // com o dono, 17/09/2026: a leitura de hora em hora sempre perde os
    // últimos ~55min do dia, veja coletor/lib/visitas-perfil-meta.mjs). O
    // fechamento roda de manhã, bem depois da virada — pede o dia inteiro
    // numa chamada só, sem esse buraco.
    const { instagram_id: igId, access_token: token } = contas[0];
    const visitasPerfilDoDia = await visitasPerfilDoDiaMeta(igId, token, dia);
    // Alimenta o cache que a tela do OPR lê pra qualquer período (fora de
    // --dry — dry é só preview, nunca escreve nada além do PNG local).
    if (!DRY) await salvarVisitasPerfilDoDia(REST, H, CONTA_VESSEL, dia, visitasPerfilDoDia);

    dados = montarDadosOpr(campanhasDoDia, seguidoresDoDia, visitasPerfilDoDia);
    html = montarHtmlOpr(dados, { conta: 'Vessel Brasil', periodoLabel: periodoLabel(dia) });

    // Mensagens de FECHAMENTO DO DIA (pedido do dono, 17/09/2026) — mandadas
    // antes da imagem do OPR. Usam os mesmos dados já buscados acima, direto
    // de `campanhasDoDia`/`deltas` (nunca passam pelo rollout de
    // `montarDadosOpr` — essas mensagens são da MESMA família das de hora em
    // hora, que já mostram dado real desde 12/09, não fazem parte do
    // rollout campo-a-campo do OPR).
    const gastoSeguidoresDoDia = campanhasDoDia
      .filter((c) => c.tipo === 'seguidores')
      .reduce((s, c) => s + c.gasto, 0);
    const seguidoresTotal = seguidoresTotalNoFimDoDia(deltas, dia);
    mensagemLeads = montarMensagemLeadsFechamentoDia(dia, campanhasDoDia);
    mensagemSeguidores = montarMensagemSeguidoresFechamentoDia(
      dia, seguidoresDoDia, visitasPerfilDoDia, gastoSeguidoresDoDia, seguidoresTotal,
    );
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
    console.log('--- mensagem de leads (fechamento do dia) ---');
    console.log(mensagemLeads ?? '(nenhuma campanha WPP no dia — mensagem não seria enviada)');
    console.log('--- mensagem de seguidores (fechamento do dia) ---');
    console.log(mensagemSeguidores ?? '(sem dado de seguidor/visita no dia — mensagem não seria enviada)');
    return;
  }

  // As duas mensagens de FECHAMENTO DO DIA vão ANTES da imagem (pedido do
  // dono, 17/09/2026) — cada uma tenta independente, uma falhando não
  // impede a outra nem a imagem (mesmo espírito de enviar-relatorio-hora).
  for (const [nome, msg] of [['leads', mensagemLeads], ['seguidores', mensagemSeguidores]]) {
    if (!msg) continue;
    try {
      await mandarTextoWhatsapp(msg);
    } catch (e) {
      console.error(`Falha ao mandar a mensagem de fechamento (${nome}):`, e.message);
    }
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
