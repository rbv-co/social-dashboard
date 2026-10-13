#!/usr/bin/env node
// Atualizador DIÁRIO dos cards de canais do Gestor Comercial — SEM IA.
// Roda no GitHub Actions (cron diário). Recalcula SÓ os NÚMEROS dos cards
// (faturamento real do Bling + ritmo de meta) e faz um PATCH cirúrgico no
// campo dados_json do briefing MAIS RECENTE, trocando só canaisFoco/diaDoMes/
// diasNoMes e marcando numerosAtualizadosEm. NÃO chama o Claude, NÃO cria
// briefing novo, NÃO toca no texto (briefing/conteudo), estoque, calendário,
// comparativo, oportunidades nem garimpo. Custo ~zero.
//
// Reusa a MESMA lógica do robô semanal (gestor-comercial.mjs) via libs:
//   loginServico/blingPedidos (lib/bling-comercial.mjs),
//   CANAIS/realPorCanalDe/canaisFocoDe (lib/comercial-canais.mjs).
// Sem deps externas — fetch nativo (Node 18+).

import { loginServico, robosNaApi, blingPedidos } from './lib/bling-comercial.mjs';
import { realPorCanalDe, canaisFocoDe } from './lib/comercial-canais.mjs';
import { registrarExecucao } from './registrar-execucao.mjs';

const _t0 = Date.now(); // início da rodada (para medir duração no painel de status)

const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://kounqtdoioootxqegkij.supabase.co';
const GESTOR_EMAIL = process.env.GESTOR_USER_EMAIL;
const GESTOR_PASS = process.env.GESTOR_USER_PASSWORD;

// Sem IA: não precisa da chave da Anthropic. Só Bling (conta de serviço) + Supabase.
if (!SERVICE_KEY || (!robosNaApi() && (!GESTOR_EMAIL || !GESTOR_PASS))) {
  console.error('✗ Faltam segredos: SUPABASE_SERVICE_KEY, GESTOR_USER_EMAIL, GESTOR_USER_PASSWORD');
  process.exit(1);
}

const REST = SUPABASE_URL + '/rest/v1';

// ── Supabase REST (service key: ignora RLS, igual ao robô semanal) ──
const sb = { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY, 'Content-Type': 'application/json' };
async function sbGet(path) {
  const r = await fetch(REST + path, { headers: sb });
  if (!r.ok) throw new Error('REST GET ' + path + ' -> ' + r.status + ' ' + (await r.text()).slice(0, 200));
  return r.json();
}
async function sbPatch(path, body) {
  const r = await fetch(REST + path, { method: 'PATCH', headers: { ...sb, Prefer: 'return=minimal' }, body: JSON.stringify(body) });
  if (!r.ok && ![200, 201, 204].includes(r.status)) throw new Error('REST PATCH ' + path + ' -> ' + r.status + ' ' + (await r.text()).slice(0, 200));
  return r;
}

// ── Data de hoje em America/Sao_Paulo (YYYY-MM-DD) — idêntico ao gestor-comercial ──
function hojeBR() {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });
  return f.format(new Date());
}

async function main() {
  const hoje = hojeBR();
  const [y, m, d] = hoje.split('-').map(Number);
  const diasNoMes = new Date(y, m, 0).getDate();
  const di = `${y}-${String(m).padStart(2, '0')}-01`;
  const df = hoje;
  console.log('== Cards Comercial (diário, sem IA) · ' + hoje + ' ==');

  // 1) faturamento real por canal (mês corrente) via bling-proxy — mesma lógica do semanal
  const token = await loginServico({ naApi: true });
  const pedidos = await blingPedidos(token, di, df);
  const realPorCanal = realPorCanalDe(pedidos);

  // 2) metas do mês + recálculo do ritmo por canal (metaPace, via canaisFocoDe)
  const metas = await sbGet(`/bling_metas?year=eq.${y}&month=eq.${m}&select=loja_id,loja_nome,meta_valor,daily_goals`);
  const canaisFoco = canaisFocoDe({ metas, realPorCanal, diaDoMes: d, diasNoMes });

  // 3) briefing MAIS RECENTE — só ele recebe os números novos
  const recentes = await sbGet('/gestao_comercial_briefings?select=id,rodada,dados_json&order=created_at.desc&limit=1');
  if (!recentes.length) {
    console.log('nenhum briefing existente — nada a atualizar (o robô semanal ainda não rodou).');
    await registrarExecucao({
      robo: 'cards-comercial-diario', acao: 'atualizar cards', modelo: null, usd: 0,
      duracaoMs: Date.now() - _t0, itens: 0, unidade: 'briefings',
      status: 'ok', detalhe: 'sem briefing p/ atualizar',
    });
    return;
  }
  const alvo = recentes[0];

  // 4) PATCH cirúrgico: preserva TODO o dados_json e troca só os números dos
  // cards (canaisFoco) + o "dia do mês" do hero + o carimbo de atualização.
  // NÃO mexe em briefing/conteudo/estoque/calendario/comparativo/etc.
  const novoDados = {
    ...(alvo.dados_json || {}),
    canaisFoco,
    diaDoMes: d,
    diasNoMes,
    numerosAtualizadosEm: new Date().toISOString(),
  };
  await sbPatch('/gestao_comercial_briefings?id=eq.' + encodeURIComponent(alvo.id), { dados_json: novoDados });

  console.log('cards atualizados no briefing', alvo.rodada, '·',
    canaisFoco.map(c => `${c.canal}=${Math.round(c.realizado)} (${c.percentMeta}% da meta, ${c.status})`).join(' · '));

  // Telemetria do painel de status: custo 0 (sem IA).
  await registrarExecucao({
    robo: 'cards-comercial-diario', acao: 'atualizar cards', modelo: null, usd: 0,
    duracaoMs: Date.now() - _t0, itens: 1, unidade: 'briefings',
    status: 'ok', detalhe: 'briefing ' + alvo.rodada + ' · ' + pedidos.length + ' pedidos no mês',
  });
}

main().catch(async (e) => {
  console.error('FALHA:', e.message);
  await registrarExecucao({
    robo: 'cards-comercial-diario', acao: 'atualizar cards', modelo: null, usd: 0,
    duracaoMs: Date.now() - _t0, status: 'erro', detalhe: e.message.slice(0, 500),
  });
  process.exit(1);
});
