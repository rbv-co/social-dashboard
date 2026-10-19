#!/usr/bin/env node
// Gera o "Panorama do Mercado" (resumão escrito por IA) da edição mais recente do
// Observatório de Concorrência e grava em noticias_panorama. Foco: campanhas COMERCIAIS,
// campanhas de MARKETING e AÇÕES PROMOCIONAIS, + semelhanças entre marcas.
// Uso local:  ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY_GESTOR node panorama-mercado.mjs
// No workflow do agente de notícias roda com ANTHROPIC_API_KEY já no ambiente.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// carrega .env (mesmo padrão dos outros scripts)
try {
  for (const raw of readFileSync(join(__dirname, '.env'), 'utf8').split('\n')) {
    const l = raw.trim(); if (!l || l.startsWith('#')) continue;
    const i = l.indexOf('='); if (i === -1) continue;
    const k = l.slice(0, i).trim(); let v = l.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
} catch (_) {}
// a lib-llm lê ANTHROPIC_API_KEY no import → garante antes de importar
if (!process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY_GESTOR) process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY_GESTOR;

// REST_VIA_PG=1 (plano 03 da virada): o mesmo caminho vira SQL no api-db; sem a flag segue o REST do Supabase.
const { abrirRest } = await import('./lib/rest-pg.mjs');
const R = await abrirRest().catch((e) => { console.error('✗ ' + e.message); process.exit(1); });
const H = R.sb;
const rest = (p) => R.REST + p;

const { structured, OPUS, usageSummary } = await import('./lib-llm.mjs');
const { registrarExecucao } = await import('./registrar-execucao.mjs');
const _t0 = Date.now();

// 1) edição mais recente
const ultR = await R.fetch(rest('/noticias_concorrentes?select=rodada&order=rodada.desc&limit=1'), { headers: H }).then(r => r.json());
const rodada = ultR && ultR[0] && ultR[0].rodada;
if (!rodada) { console.error('✗ sem rodada'); process.exit(1); }
const itens = await R.fetch(rest('/noticias_concorrentes?rodada=eq.' + rodada + '&select=marca,categoria,titulo,resumo,destaque&order=marca.asc'), { headers: H }).then(r => r.json());
console.log('edição', rodada, '·', itens.length, 'itens');

// 2) monta o contexto (foco campanhas/marketing/promo, mas manda tudo pro modelo julgar)
const ctx = itens.filter(n => !/^resumo/i.test(String(n.categoria || ''))).map(n =>
  `- [${n.marca}] (${n.categoria})${n.destaque ? ' ★' : ''} ${String(n.titulo || '').trim()}${n.resumo ? ' — ' + String(n.resumo).replace(/\s+/g, ' ').trim().slice(0, 300) : ''}`
).join('\n');
const marcas = [...new Set(itens.map(n => n.marca))];

const system = `Você é o analista-chefe do Observatório de Concorrência da RBV (varejo de calçados/moda femininos premium). Escreve um RESUMÃO EXECUTIVO do mercado em português do Brasil, em markdown, tom editorial e direto, para a diretoria. NÃO invente dados: use SOMENTE o que está nos itens fornecidos; cite as marcas pelo nome. O FOCO é, nesta ordem: (1) campanhas de MARKETING, (2) campanhas COMERCIAIS / desenvolvimento de produto, (3) AÇÕES PROMOCIONAIS (descontos, liquidações, cupons, datas). Destaque SEMELHANÇAS e movimentos em comum entre marcas (o que várias estão fazendo ao mesmo tempo). Seja específico (marca + o que fez). Texto corrido com parágrafos de verdade, não listas soltas de uma linha.`;

const user = `Edição ${rodada}. Marcas observadas (${marcas.length}): ${marcas.join(', ')}.

ITENS DA EDIÇÃO:
${ctx}

Escreva o resumão em markdown com estas seções (use ## para os títulos), cada uma com 1–3 parágrafos densos:
## Panorama geral
## Campanhas de marketing
## Campanhas comerciais & desenvolvimento
## Ações promocionais
## Semelhanças & movimentos em comum
## Leitura para a RBV
Em "Leitura para a RBV", traga 3–5 recomendações práticas. Não use tabelas. Não cite SKUs.`;

const schema = { type: 'object', properties: { markdown: { type: 'string', description: 'o resumão completo em markdown' } }, required: ['markdown'] };

console.log('gerando com', OPUS, '…');
const out = await structured({ model: OPUS, system, user, schema, maxTokens: 6000, toolName: 'panorama' });
const md = (out && out.markdown || '').trim();
if (!md || md.length < 200) { console.error('✗ resposta vazia/curta'); process.exit(1); }
const uso = usageSummary().text;

// 3) upsert noticias_panorama
const r = await R.fetch(rest('/noticias_panorama?on_conflict=rodada'), {
  method: 'POST',
  headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' },
  body: JSON.stringify({ rodada, conteudo_md: md, modelo: OPUS, uso }),
});
if (!r.ok) { console.error('✗ falha ao gravar', r.status, await r.text()); process.exit(1); }
console.log('✓ panorama gravado para', rodada, '·', md.length, 'chars ·', uso);
const _u = usageSummary();
await registrarExecucao({
  robo: 'panorama', acao: 'panorama do mercado', modelo: OPUS,
  inputTokens: _u.tin, outputTokens: _u.tout, chamadas: _u.calls, usd: _u.usd,
  duracaoMs: Date.now() - _t0, itens: 1, unidade: 'panoramas',
  status: 'ok', detalhe: `rodada ${rodada} · ${md.length} chars`,
});
await R.fechar();
