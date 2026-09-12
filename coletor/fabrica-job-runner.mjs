#!/usr/bin/env node
// coletor/fabrica-job-runner.mjs — wrapper de status da Fábrica de Anúncios (UI Estúdio).
// Lê 1 linha de fabrica_jobs (fila criada pela Edge fabrica-trigger), marca 'rodando', chama o
// run() certo (gerar-criativos.mjs ou subir-estudio.mjs) conforme job.tipo, e grava o estado
// terminal. A rodada (fabrica_campanhas) só fecha (fechada_em) quando o 'subir' termina 100%
// (pendentes===0) — em rate limit (pendentes>0) o job vira 'erro' pra UI oferecer re-disparar,
// sem fechar a rodada (idempotente: subir-estudio.mjs pula os ads já criados).
//
// Uso (mesmo padrão do GitHub Actions runner, Task 6):
//   FABRICA_JOB_ID=<uuid> node --import ./lib/curl-fetch.mjs fabrica-job-runner.mjs
//   node fabrica-job-runner.mjs --job <uuid>
import './lib/carregar-env.mjs';
import { registrarExecucao } from './registrar-execucao.mjs';
import { run as gerarRun } from './gerar-criativos.mjs';
import { exportarCampanhaZoho } from './exportar-zoho.mjs';
import { run as subirRun } from './subir-estudio.mjs';
import { run as ativarRun } from './ativar-estudio.mjs';
import { run as excluirRun } from './excluir-estudio.mjs';
import { run as previewRun } from './gerar-previews.mjs';

const URL = process.env.SUPABASE_URL || 'https://kounqtdoioootxqegkij.supabase.co';
const SK = process.env.SUPABASE_SERVICE_KEY;
const REST = URL + '/rest/v1';
const H = { apikey: SK, Authorization: 'Bearer ' + SK, 'Content-Type': 'application/json' };

// --- Supabase REST (service key) — mesmo padrão de sbGet/sbPost dos outros .mjs do coletor
// (subir-estudio.mjs, gerar-criativos.mjs); sbPatch é o análogo de sbPost trocando o método. ---
async function sbGet(p) {
  const r = await fetch(REST + p, { headers: H });
  if (!r.ok) throw new Error('GET ' + p + ' ' + r.status + ' ' + (await r.text()).slice(0, 200));
  return r.json();
}
async function sbPatch(p, body) {
  const r = await fetch(REST + p, { method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error('PATCH ' + p + ' ' + r.status + ' ' + (await r.text()).slice(0, 200));
  return r;
}
async function sbPost(p, body, prefer) {
  const r = await fetch(REST + p, { method: 'POST', headers: prefer ? { ...H, Prefer: prefer } : H, body: JSON.stringify(body) });
  if (!r.ok && ![200, 201, 204].includes(r.status)) throw new Error('POST ' + p + ' ' + r.status + ' ' + (await r.text()).slice(0, 200));
  return r;
}

// GERAÇÃO EM LOTES QUE SE AUTO-ENCADEIAM: quando um lote termina com trabalho restante (o teto
// HERO_IA_MAX foi atingido), cria o job do PRÓXIMO lote (mesma campanha/params) e dispara o próprio
// Action via GITHUB_TOKEN (workflow_dispatch é permitido pra ele). A idempotência do gerar-criativos
// (pula os criativos já existentes) faz cada lote continuar de onde parou — do início ao fim, sem
// travar (cada lote é curto, bem abaixo do timeout). Guard de segurança: para em 300 lotes.
async function encadearProximoLote(params) {
  const continuacao = (params.continuacao || 0) + 1;
  if (continuacao > 300) { console.warn('encadeamento: limite de 300 lotes atingido — parando por segurança'); return; }
  const prox = { ...params, continuacao };
  const novo = await sbPost('/fabrica_jobs', [{ tipo: 'gerar', params: prox, status: 'enfileirado' }], 'return=representation');
  const novoId = (await novo.json())[0].id;
  if (prox.campanhaId) await sbPatch(`/fabrica_campanhas?id=eq.${prox.campanhaId}`, { job_id: novoId });
  const repo = process.env.GITHUB_REPO, token = process.env.GH_TOKEN;
  if (!repo || !token) { console.warn('sem GH_TOKEN/GITHUB_REPO — próximo lote (job ' + novoId + ') ficou enfileirado; dispare manualmente'); return; }
  const gh = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/fabrica.yml/dispatches`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'User-Agent': 'fabrica-runner' },
    body: JSON.stringify({ ref: 'main', inputs: { job_id: novoId } }),
  });
  if (!gh.ok) console.warn('encadeamento dispatch falhou ' + gh.status + ' ' + (await gh.text()).slice(0, 150));
  else console.log('lote ' + continuacao + ' encadeado: job ' + novoId);
}

// --- statusCampanhaGerar(): função pura — mapeia o resultado do gerar pro status da campanha.
// Sucesso (true) → 'pronta', Falha (false) → 'erro'. ---
export function statusCampanhaGerar(ok) { return ok ? 'pronta' : 'erro'; }

// --- estadoTerminalSubir(): função pura — mapeia o resultado de subir-estudio.mjs.run() pro
// estado terminal do job. Só fecha a rodada (fecha:true) quando NADA ficou pendente (100% subiu);
// rate limit (pendentes>0) vira 'erro' pra UI oferecer "re-disparar" (subir-estudio é idempotente,
// então re-rodar só completa o que falta, sem duplicar). ---
export function estadoTerminalSubir(res) {
  // Nada escolhido no Curar: não subiu nada, então não é 'concluido' e a rodada NÃO fecha. Antes
  // caía no return final e a tela dizia "Publicado (pausado)!" com 0 anúncios — job 66a8e030.
  if (res.semCriativos) {
    return { status: 'erro', fecha: false, erro: 'Nenhum criativo escolhido — volte no passo Curar e escolha pelo menos um antes de publicar.' };
  }
  if (res.pendentes > 0) return { status: 'erro', fecha: false, erro: 'rate limit — re-disparar pra continuar' };
  // Multi-loja parcial: alguma loja não subiu. As outras SUBIRAM de verdade (o `resultado` é gravado
  // junto), então não é "tudo falhou" — mas também não é 'concluido', e a rodada não fecha.
  if (res.falhas?.length) {
    return {
      status: 'erro', fecha: false,
      erro: `Subiu ${res.campanhas?.length ?? 0} de ${(res.campanhas?.length ?? 0) + res.falhas.length} loja(s). Não subiu: ${res.falhas.map((f) => `${f.loja} (${f.erro})`).join('; ')}`,
    };
  }
  return { status: 'concluido', fecha: true };
}

// --- estadoTerminalAtivar(): função pura — mapeia o resultado de ativar-estudio.mjs.run() pro
// estado terminal do job. Ativação parcial (algum POST não voltou 200) tem que virar 'erro' — senão
// a UI reporta sucesso limpo com ads ainda PAUSED no Gerenciador (money-path). ---
export function estadoTerminalAtivar(res) {
  if (res.falhas?.length || res.ativados < res.total) {
    return { status: 'erro', erro: `Ativou ${res.ativados} de ${res.total}. ${res.falhas?.length || 0} não ativaram — alguns anúncios podem já estar ativos; confira no Gerenciador.` };
  }
  return { status: 'concluido' };
}

// --- estadoTerminalExcluir(): função pura — exclusão parcial (algum DELETE não voltou 200) vira
// 'erro' pra UI avisar; senão 'concluido'. ---
export function estadoTerminalExcluir(res) {
  if (res.falhas?.length || res.excluidos < res.total) {
    return { status: 'erro', erro: `Excluiu ${res.excluidos} de ${res.total}. ${res.falhas?.length || 0} não saíram — confira no Gerenciador.` };
  }
  return { status: 'concluido' };
}

async function main() {
  const jobId = process.env.FABRICA_JOB_ID || (process.argv.includes('--job') ? process.argv[process.argv.indexOf('--job') + 1] : null);
  if (!jobId) throw new Error('FABRICA_JOB_ID ausente (env FABRICA_JOB_ID ou --job <uuid>)');

  const job = (await sbGet(`/fabrica_jobs?select=*&id=eq.${jobId}`))[0];
  if (!job) throw new Error('job não encontrado: ' + jobId);

  await sbPatch(`/fabrica_jobs?id=eq.${jobId}`, {
    status: 'rodando',
    github_run_id: process.env.GITHUB_RUN_ID || null,
    updated_at: new Date().toISOString(),
  });

  // Telemetria do Painel de Status do Claude. A Fábrica não chama a API de texto
  // da Anthropic aqui → custo zero (usd=0); registramos tempo e volume produzido.
  const _t0 = Date.now();
  const _robo = { gerar: 'fabrica-gerar', subir: 'fabrica-subir', ativar: 'fabrica-ativar', excluir: 'fabrica-excluir', preview: 'fabrica-preview' };
  const _acao = { gerar: 'gerar criativos', subir: 'subir campanha', ativar: 'ativar anúncios', excluir: 'excluir remessa', preview: 'gerar previews' };
  // O MOTOR DE CADA TAREFA, e por que isto importa (18/08/2026).
  //
  // Antes, TODA tarefa da Fábrica era registrada com `modelo: null, usd: 0` — e
  // `gerar` chama o gpt-image-2, que é API PAGA da OpenAI. Resultado: 473
  // criativos gravados como US$ 0,00, e a tela do Status do Claude AFIRMANDO que
  // criar imagem custa R$ 0.
  //
  // As outras tarefas (subir, ativar, excluir, preview) não chamam IA nenhuma:
  // para elas o zero é verdade, e continua zero. A diferença agora está escrita.
  const _motor = { gerar: 'gpt-image-2' };
  const motor = _motor[job.tipo] || null;

  const reg = (itens, unidade, status, detalhe) => registrarExecucao({
    robo: _robo[job.tipo] || 'fabrica', acao: _acao[job.tipo] || job.tipo,
    modelo: motor,
    // `usd` fica de fora de propósito quando há motor pago: sem ele,
    // custoDaExecucao() devolve NULO ("não sei") em vez de zero. O valor real
    // virá do gasto cobrado, quando a chave de administrador da OpenAI existir.
    ...(motor ? {} : { usd: 0 }),
    duracaoMs: Date.now() - _t0, itens, unidade, status, detalhe,
  });

  try {
    if (job.tipo === 'gerar') {
      const r = await gerarRun(job.params || {});
      await sbPatch(`/fabrica_jobs?id=eq.${jobId}`, { status: 'concluido', resultado: r, updated_at: new Date().toISOString() });
      if (r.incompleto && r.novas > 0) {
        // lote parcial: encadeia o próximo automaticamente; campanha segue 'gerando' (não marca pronta)
        await encadearProximoLote(job.params || {});
        await reg(r.criativos, 'criativos', 'ok', 'lote ' + ((job.params?.continuacao || 0) + 1) + ' (+' + r.novas + ')');
      } else {
        // completo (ou nada novo progrediu). Conta o TOTAL da campanha: se 0, NÃO diz "pronto pra curar"
        // — marca 'erro' com o motivo (SKU sem foto/preço, ou nenhum look ativo) pra o front avisar.
        let itens = 0;
        try { if (job.params?.campanhaId) itens = (await sbGet(`/fabrica_criativos?select=id&campanha_id=eq.${job.params.campanhaId}`)).length; } catch (_) {}
        if (job.params?.campanhaId && itens === 0) {
          const motivo = (r.pulados && r.pulados.length)
            ? 'Nenhum criativo gerado — ' + r.pulados.map((p) => `${p.sku}: ${p.motivo}`).join('; ')
            : 'Nenhum criativo gerado. Verifique se o produto tem foto no Bling e se há looks ativos p/ o objetivo.';
          await sbPatch(`/fabrica_campanhas?id=eq.${job.params.campanhaId}`, { status: statusCampanhaGerar(false) });
          await sbPatch(`/fabrica_jobs?id=eq.${jobId}`, { erro: motivo.slice(0, 500) });
          await reg(0, 'criativos', 'erro', motivo.slice(0, 120));
        } else {
          if (job.params?.campanhaId) await sbPatch(`/fabrica_campanhas?id=eq.${job.params.campanhaId}`, { status: statusCampanhaGerar(true) });
          await reg(itens, 'criativos', 'ok', r.incompleto ? 'encerrado (sem progresso)' : 'completo');
          // campanha completa -> exporta os finais pro Zoho WorkDrive (nuvem), por loja -> data. Best-effort.
          if (job.params?.campanhaId) {
            try { await exportarCampanhaZoho({ campanhaId: job.params.campanhaId, sbGet }); }
            catch (e) { console.warn('zoho export falhou:', String(e.message).slice(0, 120)); }
          }
        }
      }
    } else if (job.tipo === 'subir') {
      const r = await subirRun(job.params || {});
      const t = estadoTerminalSubir(r);
      await sbPatch(`/fabrica_jobs?id=eq.${jobId}`, { status: t.status, resultado: r, erro: t.erro || null, updated_at: new Date().toISOString() });
      if (t.fecha && job.params?.campanhaId) {
        await sbPatch(`/fabrica_campanhas?id=eq.${job.params.campanhaId}`, { fechada_em: new Date().toISOString() });
      }
      await reg(r?.subidos ?? r?.criados ?? r?.total ?? null, 'anúncios', t.status === 'concluido' ? 'ok' : 'parcial', t.erro || 'custo zero');
    } else if (job.tipo === 'ativar') {
      const r = await ativarRun(job.params || {});
      const t = estadoTerminalAtivar(r);
      await sbPatch(`/fabrica_jobs?id=eq.${jobId}`, { status: t.status, resultado: r, erro: t.erro || null, updated_at: new Date().toISOString() });
      await reg(r?.ativados ?? null, 'anúncios', t.status === 'concluido' ? 'ok' : 'parcial', t.erro || 'custo zero');
    } else if (job.tipo === 'excluir') {
      const r = await excluirRun(job.params || {});
      const t = estadoTerminalExcluir(r);
      await sbPatch(`/fabrica_jobs?id=eq.${jobId}`, { status: t.status, resultado: r, erro: t.erro || null, updated_at: new Date().toISOString() });
      await reg(r?.excluidos ?? null, 'campanhas', t.status === 'concluido' ? 'ok' : 'parcial', t.erro || 'custo zero');
    } else if (job.tipo === 'preview') {
      // gera a galeria de preview dos looks (dados de amostra) — não toca campanha/objetivo.
      const r = await previewRun();
      await sbPatch(`/fabrica_jobs?id=eq.${jobId}`, { status: 'concluido', resultado: r, updated_at: new Date().toISOString() });
      await reg(null, 'previews', 'ok', 'custo zero');
    } else {
      throw new Error('tipo inválido: ' + job.tipo);
    }
  } catch (e) {
    await sbPatch(`/fabrica_jobs?id=eq.${jobId}`, { status: 'erro', erro: String(e.message).slice(0, 500), updated_at: new Date().toISOString() });
    if (job?.tipo === 'gerar' && job?.params?.campanhaId) await sbPatch(`/fabrica_campanhas?id=eq.${job.params.campanhaId}`, { status: statusCampanhaGerar(false) });
    await reg(null, null, 'erro', String(e.message).slice(0, 500));
    throw e;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error('FALHOU:', e.message); process.exit(1); });
}
