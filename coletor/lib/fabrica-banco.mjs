// O BANCO DO ROBÔ DA FÁBRICA, DEPOIS DO SUPABASE (Plano 7 + 5.8).
//
// O robô (`fabrica-job-runner.mjs` e os módulos) fala com as tabelas `fabrica_*`
// pela REST do Supabase com a chave de serviço. Com `CENTRAL_API_URL` +
// `CENTRAL_API_TOKEN` (o token `srv_` do usuário `robo-fabrica`, com `meta.fabrica`
// em `permissions`), passa a falar com a API:
//   - LEITURAS de `fabrica_*`: o MESMO caminho PostgREST que o robô já monta,
//     traduzido pela ponte do front (`src/compartilhado/banco-pela-api.js`) para
//     `GET /fabrica/<recurso>` — uma tradução só, testada nos dois lados;
//   - ESCRITAS: as rotas do robô (`/fabrica/robo/*`), uma por operação.
// O que NÃO é `fabrica_*` (o Storage dos criativos, Plano 6; `gc_*`, 5.5) segue na
// REST do Supabase: quem decide é o caminho, não o robô inteiro.

import { robosNaApi, loginServico } from './bling-comercial.mjs';
import { configurarApi, pedir } from '../../src/compartilhado/api.js';
import { lerCaminhoPostgrest, lerPelaApi } from '../../src/compartilhado/banco-pela-api.js';

export const fabricaNaApi = () => robosNaApi();
/** O caminho REST é de uma tabela da Fábrica (e vai para a API, com a chave ligada)? */
export const vaiParaApi = (caminho) => fabricaNaApi() && /^\/?fabrica_/.test(String(caminho));

let _pronta = false;
async function api() {
  if (!_pronta) {
    configurarApi({ base: process.env.CENTRAL_API_URL.trim(), token: await loginServico({ naApi: true }) });
    _pronta = true;
  }
}

function falha(oQue, r) {
  // a frase da API e o código; o token nunca entra em mensagem
  return new Error(`${oQue} -> ${r.status} ${(r.error && (r.error.message || r.error.codigo)) || ''}`.trim());
}

async function chamar(metodo, caminho, corpo, { aceitar404 = false } = {}) {
  await api();
  const r = await pedir(metodo, caminho, corpo === undefined ? {} : { corpo });
  if (r.error && !(aceitar404 && r.status === 404)) throw falha(`${metodo} ${caminho}`, r);
  return r.data;
}

// Os tetos das rotas do robô; o Supabase não tinha. Cortar é melhor que perder a
// escrita inteira (um `erro` longo derrubava junto o `resultado` com os ids da Meta).
const cortar = (v, n) => (typeof v === 'string' && v.length > n ? v.slice(0, n - 1) + '…' : v);

/** `GET` de uma tabela `fabrica_*` no formato PostgREST (`/fabrica_jobs?select=*&id=eq.x`). */
export async function lerFabrica(caminho) {
  await api();
  const r = await lerPelaApi(lerCaminhoPostgrest(String(caminho).replace(/^\//, '')));
  if (r.error) throw new Error(`GET ${caminho} -> ${r.error.status} ${r.error.message}`);
  return r.data;
}

// `?id=eq.x` / `?chave=eq.x` → x (o robô só escreve por chave)
function chaveDe(caminho, col) {
  const p = lerCaminhoPostgrest(String(caminho).replace(/^\//, ''));
  const f = p.filtros.find((x) => x.col === col && x.op === 'eq');
  if (!f || p.filtros.length !== 1) throw new Error(`${caminho}: a rota do robô escreve só por ${col}`);
  return { tabela: p.tabela, valor: f.val };
}

// O que as rotas do robô aceitam (o resto do corpo seria 400): `updated_at` é do servidor.
const soCampos = (o, campos) => Object.fromEntries(Object.entries(o || {}).filter(([k]) => campos.includes(k)));

/** Atualiza um job (`PATCH /fabrica/robo/jobs/{id}`). */
export async function patchJob(id, campos) {
  const c = soCampos(campos, ['status', 'github_run_id', 'resultado', 'erro']);
  if ('erro' in c) c.erro = cortar(c.erro, 2000);
  return chamar('PATCH', `/fabrica/robo/jobs/${encodeURIComponent(id)}`, c);
}

/** Cria (ou devolve, idempotente) o job do próximo lote do `gerar`. → id do job. */
export async function proximoLote(jobId) {
  const d = await chamar('POST', `/fabrica/robo/jobs/${encodeURIComponent(jobId)}/proximo-lote`);
  return d && d.job_id;
}

/**
 * A escrita REST que os módulos já fazem, levada à rota do robô. Devolve um
 * `Response` mínimo, como o `fetch` que os módulos liam. Escrita que a API não
 * tem (criar rodada fora do painel, trocar o `job_id` da rodada) RECUSA alto.
 */
export async function escreverFabrica(metodo, caminho, corpo) {
  const tabela = String(caminho).replace(/^\//, '').split('?')[0];
  const linhas = Array.isArray(corpo) ? corpo : [corpo];
  if (metodo === 'POST' && tabela === 'fabrica_criativos') {
    // a rota aceita até 200 por vez, numa transação
    for (let i = 0; i < linhas.length; i += 200) await chamar('POST', '/fabrica/robo/criativos', linhas.slice(i, i + 200));
    return respostaMinima(201);
  }
  if (metodo === 'POST' && tabela === 'fabrica_meta_jobs') {
    const ids = [];
    for (const l of linhas) ids.push(await chamar('POST', '/fabrica/robo/meta-jobs', { ...l, erro: cortar(l.erro, 2000) }));
    return respostaMinima(201, ids);
  }
  if (metodo === 'PATCH' && tabela === 'fabrica_looks') {
    const { valor } = chaveDe(caminho, 'chave');
    // look sem linha: o PATCH do PostgREST mudava 0 linhas e seguia; a rota dá 404
    await chamar('PATCH', `/fabrica/robo/looks/${encodeURIComponent(valor)}`, soCampos(corpo, ['preview_url']), { aceitar404: true });
    return respostaMinima(204);
  }
  if (metodo === 'PATCH' && tabela === 'fabrica_jobs') {
    await patchJob(chaveDe(caminho, 'id').valor, corpo);
    return respostaMinima(204);
  }
  if (metodo === 'PATCH' && tabela === 'fabrica_campanhas') {
    const { valor } = chaveDe(caminho, 'id');
    const c = {};
    if (corpo.status) c.status = corpo.status;
    if (corpo.fechada_em) c.fechar = true;
    if ('job_id' in corpo || !Object.keys(c).length) throw new Error(`${caminho}: a rota do robô só muda status e fecha a rodada (o próximo lote é proximoLote)`);
    await chamar('PATCH', `/fabrica/robo/campanhas/${encodeURIComponent(valor)}`, c);
    return respostaMinima(200);
  }
  throw new Error(`${metodo} ${caminho}: não há rota do robô para isto na API (criar rodada é só pelo painel)`);
}

function respostaMinima(status, dados = []) {
  return { ok: true, status, json: async () => dados, text: async () => '' };
}

// Os robôs da Fábrica que gravam `ia_execucoes` pela rota do robô (os outros robôs
// desse módulo moram na VPS e vão por `pg`).
export const ROBOS_DA_FABRICA = ['fabrica', 'fabrica-gerar', 'fabrica-subir', 'fabrica-ativar', 'fabrica-excluir', 'fabrica-preview'];

/** `POST /fabrica/robo/execucoes` com o corpo que `registrarExecucao` monta. */
export async function registrarExecucaoNaApi(corpo) {
  return chamar('POST', '/fabrica/robo/execucoes', { ...corpo, detalhe: cortar(corpo.detalhe, 500) });
}
