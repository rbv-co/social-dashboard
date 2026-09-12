// coletor/registrar-execucao.mjs
// Helper de telemetria do "Painel de Status do Claude". Grava UMA linha por
// execução de robô em ia_execucoes (custo/tokens/tempo/volume) via service key.
//
// Regra de ouro: telemetria NUNCA derruba um robô. Tudo em try/catch silencioso.
//
// A REGRA DE CUSTO mudou de casa em 18/08/2026: foi para `lib/custo-da-execucao.mjs`,
// com teste. Aqui ela não tinha como quebrar teste nenhum, e foi por isso que um
// `: 0` escondido gravou 473 criativos pagos como US$ 0,00 durante um mês.
// Reexportado para quem já importava daqui não quebrar.
export { PRECO, calcularUsd, ehModeloAnthropic, custoDaExecucao } from './lib/custo-da-execucao.mjs';
import { custoDaExecucao } from './lib/custo-da-execucao.mjs';

// Registra uma execução. `usd` é opcional: se vier undefined, calcula de modelo+tokens.
export async function registrarExecucao({
  robo, acao, modelo = null,
  inputTokens = 0, outputTokens = 0, chamadas = 0,
  usd, duracaoMs = null, itens = null, unidade = null,
  status = 'ok', detalhe = null,
}) {
  try {
    // Lê o env na hora da chamada (scripts como panorama populam o .env em runtime).
    const SUPABASE_URL = process.env.SUPABASE_URL || 'https://kounqtdoioootxqegkij.supabase.co';
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
    if (!SERVICE_KEY) { console.error('aviso ia_execucoes: falta SUPABASE_SERVICE_KEY'); return; }
    // NULO quando ninguém sabe (motor pago de fora), 0 só quando é zero mesmo.
    const custo = custoDaExecucao({ modelo, inputTokens, outputTokens, usd });
    const body = {
      robo, acao, modelo,
      input_tokens: inputTokens, output_tokens: outputTokens, chamadas,
      usd: Number(Number(custo).toFixed(4)),
      duracao_ms: duracaoMs, itens, unidade, status, detalhe,
      github_run_id: process.env.GITHUB_RUN_ID || null,
    };
    const r = await fetch(SUPABASE_URL + '/rest/v1/ia_execucoes', {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: 'Bearer ' + SERVICE_KEY,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(body),
    });
    if (!r.ok && ![200, 201, 204].includes(r.status)) {
      console.error('aviso ia_execucoes: POST -> ' + r.status + ' ' + (await r.text()).slice(0, 200));
    }
  } catch (e) {
    console.error('aviso ia_execucoes:', e.message);
  }
}
