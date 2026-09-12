#!/usr/bin/env node
// Agente Gestor Comercial — roda no GitHub Actions (cron semanal).
// Coleta faturamento real (Bling via bling-proxy, autenticado como conta de
// serviço), metas e notícias de concorrentes; o Claude (Opus 4.8) escreve o
// briefing; grava em gestao_comercial_briefings. Log em gestor_log.
// Sem deps externas — fetch nativo (Node 18+).

import fs from 'fs';
import { loginServico, blingProxy, blingPedidos, blingProdutos, blingSaldoFoco, classificarItem, DEP_FOCO } from './lib/bling-comercial.mjs';
import { CANAIS, realPorCanalDe, canaisFocoDe } from './lib/comercial-canais.mjs';
import { bcgClass } from './lib/classificacao-comercial.mjs';
import { registrarExecucao } from './registrar-execucao.mjs';
// A REGRA DE "ISTO E LOJA?" MORA EM UM LUGAR SO — a mesma pergunta respondida
// em dois arquivos e a que diverge no dia em que um deles muda.
import { normalizarDepositos, ehDepositoDeLoja } from '../src/ferramentas/gestao-a-vista/estoque-gv.js';
import { pathToFileURL } from 'node:url';

const _t0 = Date.now(); // início da rodada (para medir duração no painel de status)

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY_GESTOR || process.env.ANTHROPIC_API_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://kounqtdoioootxqegkij.supabase.co';
const ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtvdW5xdGRvaW9vb3R4cWVna2lqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyMDMwMDUsImV4cCI6MjA5NDc3OTAwNX0.MVXa6jngjKXkH3eZ7as_j_k8Eb7lJKcFmO4kCKAnuHM';
const GESTOR_EMAIL = process.env.GESTOR_USER_EMAIL;
const GESTOR_PASS = process.env.GESTOR_USER_PASSWORD;
const MODEL = process.env.GESTOR_MODEL || 'claude-opus-4-8';

if (!ANTHROPIC_API_KEY || !SERVICE_KEY || !GESTOR_EMAIL || !GESTOR_PASS) {
  console.error('✗ Faltam segredos: ANTHROPIC_API_KEY_GESTOR, SUPABASE_SERVICE_KEY, GESTOR_USER_EMAIL, GESTOR_USER_PASSWORD');
  process.exit(1);
}

// CANAIS foco vive em ./lib/comercial-canais.mjs (fonte única, reusada pelo
// atualizador diário dos cards). Comportamento idêntico ao antigo const local.
const REST = SUPABASE_URL + '/rest/v1';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── Supabase REST (service key) ──
const sb = { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY, 'Content-Type': 'application/json' };
async function sbGet(path) {
  const r = await fetch(REST + path, { headers: sb });
  if (!r.ok) throw new Error('REST GET ' + path + ' -> ' + r.status + ' ' + (await r.text()).slice(0, 200));
  return r.json();
}
async function sbInsert(path, body, prefer) {
  const r = await fetch(REST + path, { method: 'POST', headers: prefer ? { ...sb, Prefer: prefer } : sb, body: JSON.stringify(body) });
  if (!r.ok && ![200, 201, 204].includes(r.status)) throw new Error('REST POST ' + path + ' -> ' + r.status + ' ' + (await r.text()).slice(0, 200));
  return r;
}
async function logGestor(fase, erro, detalhe) {
  try { await sbInsert('/gestor_log', { fase, erro: erro || null, detalhe: detalhe || null }, 'return=minimal'); }
  catch (e) { console.error('aviso log:', e.message); }
}


// Percorre os detalhes dos pedidos (janela ~90d) e retorna, por produto:
// giro = unidades vendidas NO MÊS (data >= mesStart) e ultimaVenda = data da
// venda mais recente (para "dias sem vender" nas oportunidades).
async function blingVendas(token, pedidos, mesStart, maxPedidos = 500) {
  const giro = {}, ultimaVenda = {};
  for (const p of pedidos.slice(0, maxPedidos)) {
    const dataPedido = String(p.data || '').slice(0, 10);
    const resp = await blingProxy(token, 'pedidos/vendas/' + p.id, {});
    for (const it of (resp.data?.itens || [])) {
      const pid = String(it.produto?.id || '');
      if (!pid) continue;
      const q = Number(it.quantidade) || 0;
      if (dataPedido >= mesStart) giro[pid] = (giro[pid] || 0) + q;
      if (!ultimaVenda[pid] || dataPedido > ultimaVenda[pid]) ultimaVenda[pid] = dataPedido;
    }
  }
  return { giro, ultimaVenda };
}

// Resumo estratégico de estoque por canal foco: só produtos vendáveis (LV),
// agrupados por CATEGORIA, com estoque vs giro do mês e os itens parados (com
// estoque e sem venda no mês) — base para ações por categoria e por item.
function montarEstoque(saldoPorDep, prodMap, giro, diaDoMes) {
  return DEP_FOCO.map(x => {
    const saldos = saldoPorDep[x.deposito_id] || {};
    const porCat = {};   // categoria → { skus, unidEstoque, vendidoMes, parados[] }
    const rupturas = []; // itens que giram e estão com estoque baixo
    let totalUnid = 0, totalSkus = 0;
    for (const [pid, saldo] of Object.entries(saldos)) {
      const nome = prodMap[pid]?.nome || pid;
      const cat = classificarItem(nome);
      if (!cat) continue;            // ignora não-vendável (sacola/tnt/insumo)
      const vendidoMes = giro[pid] || 0;
      totalUnid += saldo; totalSkus++;
      const c = porCat[cat] || (porCat[cat] = { categoria: cat, skus: 0, unidEstoque: 0, vendidoMes: 0, parados: [] });
      c.skus++; c.unidEstoque += saldo; c.vendidoMes += vendidoMes;
      if (vendidoMes === 0) c.parados.push({ nome, codigo: prodMap[pid]?.codigo || '', saldo });
      // Ruptura: vende de verdade (>=2/mês) e tem menos de ~1 mês de cobertura
      if (vendidoMes >= 2) {
        const ritmoDia = vendidoMes / (diaDoMes || 1);
        const diasCobertura = ritmoDia > 0 ? Math.round(saldo / ritmoDia) : 999;
        if (diasCobertura <= 20) rupturas.push({ nome, codigo: prodMap[pid]?.codigo || '', categoria: cat, saldo, vendidoMes, diasCobertura });
      }
    }
    const categorias = Object.values(porCat)
      .map(c => ({ ...c,
        sellThrough: (c.unidEstoque + c.vendidoMes) > 0 ? Math.round(100 * c.vendidoMes / (c.unidEstoque + c.vendidoMes)) : 0,
        parados: c.parados.sort((a, b) => b.saldo - a.saldo).slice(0, 6) }))
      .sort((a, b) => b.unidEstoque - a.unidEstoque);
    rupturas.sort((a, b) => a.diasCobertura - b.diasCobertura);
    return { canal: x.canal, skusVendaveis: totalSkus, unidadesEmEstoque: totalUnid, categorias, rupturas: rupturas.slice(0, 10) };
  });
}

// ── Oportunidades da Semana (vitrine de ofertas do varejo) ──
// Degradê de % (amplo/base): rotaciona entre as categorias a cada semana.
const PARES_OPP = [[40, 15], [35, 20], [30, 25], [25, 30], [20, 35], [15, 40]];
const CAT_OFERTA = ['Transversal', 'Tote', 'Festa/Clutch', 'Bolsa de ombro', 'Bolsa de mão', 'Mochila', 'Bolsa (outros)'];
// ⚠️ ESTA LISTA DEIXOU DE SER A VERDADE em 05/09/2026 — era o terceiro lugar do
// repositório com os depósitos escritos à mão. Ficou como SEMENTE.
//
// Quem manda agora é `bling_depositos`, e a regra de "isto é loja?" mora em UM
// lugar só (`estoque-gv.js`), importada aqui: a mesma pergunta respondida em
// dois arquivos é a que diverge no dia em que um deles muda.
const LOJAS_VAREJO_SEMENTE = [
  { loja: 'Tivoli (Santa Bárbara)', deposito_id: '14888726315' },
  { loja: 'Shopping Dom Pedro',     deposito_id: '14888617206' },
];
const DEP_PULMAO_SEMENTE = '14888248253';

// As lojas de varejo e o pulmão, a partir do que o Bling tem hoje. Sem depósito
// nenhum, cai na semente — o robô publica a vitrine de sempre em vez de nenhuma.
export function lojasEPulmao(depositosDoBanco) {
  const deps = normalizarDepositos(depositosDoBanco);
  const lojas = deps.filter(ehDepositoDeLoja)
    .map((d) => ({ loja: d.nome.replace(/^estoque\s+loja\s+/i, '').trim() || d.nome,
                   deposito_id: String(d.id) }));
  const pulmao = deps.find((d) => d.pulmao);
  if (!lojas.length) return { lojas: LOJAS_VAREJO_SEMENTE, pulmao: DEP_PULMAO_SEMENTE };
  return { lojas, pulmao: pulmao ? String(pulmao.id) : DEP_PULMAO_SEMENTE };
}
function _diasSemVender(ultima, hoje) {
  if (!ultima) return '90+';
  const d = Math.round((new Date(hoje + 'T00:00:00') - new Date(ultima + 'T00:00:00')) / 864e5);
  return String(Math.max(0, d));
}
// 12 itens por loja de varejo: 6 categorias (mais estoque parado) × (1 Amplo + 1 Base),
// com o degradê de % rotacionado pela semana. Só bolsas/mochilas, encalhados primeiro.
// Alvo de composição BCG dos 12 (âncora provada + apostas + liquidação) e desconto por quadrante.
const BCG_META = { 'Estrela': 2, 'Vaca leiteira': 3, 'Interrogação': 4, 'Abacaxi': 3 };
// Escada de desconto por nível de desejo (campeã leva menos, parada leva mais) — respeita 15/20/25/30/35/40.
const LADDER = [15, 20, 25, 30, 35, 40];
function montarOportunidades(saldoPorDep, prodMap, giro, ultimaVenda, hoje, depositos = null) {
  const { lojas: LOJAS_VAREJO, pulmao: DEP_PULMAO } = lojasEPulmao(depositos);
  const saldoPulmao = saldoPorDep[DEP_PULMAO] || {};
  return LOJAS_VAREJO.map(L => {
    const saldos = saldoPorDep[L.deposito_id] || {};
    const cands = [];
    for (const [pid, saldo] of Object.entries(saldos)) {
      const meta = prodMap[pid]; if (!meta) continue;
      const cat = classificarItem(meta.nome);
      if (!cat || !CAT_OFERTA.includes(cat)) continue;
      if (saldo < 2 || (Number(meta.preco) || 0) <= 0) continue;
      const it = { pid, sku: meta.codigo || pid, nome: meta.nome, categoria: cat, preco: Number(meta.preco), estoqueLoja: saldo, estoquePulmao: saldoPulmao[pid] || 0, giro: giro[pid] || 0, diasSemVender: _diasSemVender(ultimaVenda[pid], hoje) };
      it.bcg = bcgClass(it);
      cands.push(it);
    }
    if (!cands.length) return { loja: L.loja, itens: [] };
    const byQ = { 'Estrela': [], 'Vaca leiteira': [], 'Interrogação': [], 'Abacaxi': [] };
    for (const it of cands) byQ[it.bcg].push(it);
    const cap = (a, b) => (b.preco * b.estoqueLoja) - (a.preco * a.estoqueLoja);
    byQ['Estrela'].sort((a, b) => b.giro - a.giro || b.preco - a.preco);
    byQ['Vaca leiteira'].sort((a, b) => b.giro - a.giro || cap(a, b));
    byQ['Interrogação'].sort((a, b) => b.giro - a.giro || (parseInt(a.diasSemVender) || 999) - (parseInt(b.diasSemVender) || 999));
    byQ['Abacaxi'].sort(cap);   // queima o maior capital parado primeiro
    const usados = new Set(); const escolhidos = [];
    const take = (q, n) => { let c = 0; for (const it of byQ[q]) { if (c >= n || escolhidos.length >= 12) break; if (usados.has(it.pid)) continue; usados.add(it.pid); escolhidos.push(it); c++; } return c; };
    for (const q of ['Estrela', 'Vaca leiteira', 'Interrogação', 'Abacaxi']) take(q, BCG_META[q]);          // cota-alvo
    for (const q of ['Interrogação', 'Vaca leiteira', 'Estrela', 'Abacaxi']) { if (escolhidos.length >= 12) break; take(q, 12); }  // completa 12 c/ sobra
    const sel = escolhidos.slice(0, 12);
    const rankQ = { 'Estrela': 0, 'Vaca leiteira': 1, 'Interrogação': 2, 'Abacaxi': 3 };
    const desir = [...sel].sort((a, b) => rankQ[a.bcg] - rankQ[b.bcg] || b.giro - a.giro);
    // a cada PAR do mesmo nível de desejo: 1 vai pro Amplo e 1 pra Base (estrela nos dois!), com o mesmo degrau de desconto da escada
    const itens = desir.map((it, idx) => {
      const pct = LADDER[Math.min(Math.floor(idx / 2), LADDER.length - 1)];
      const publico = (idx % 2 === 0) ? 'Amplo' : 'Base';
      const precoDesc = it.preco * (1 - pct / 100);
      return {
        sku: it.sku, descricao: it.nome, categoria: it.categoria, publico,
        precoOriginal: Math.round(it.preco * 100) / 100, pct,
        precoComDesconto: Math.round(precoDesc * 100) / 100, parcela6x: Math.round((precoDesc / 6) * 100) / 100,
        estoqueLoja: it.estoqueLoja, estoquePulmao: it.estoquePulmao, diasSemVender: it.diasSemVender, giro: it.giro,
      };
    });
    return { loja: L.loja, itens };
  });
}
function _rOpp(v) { return 'R$ ' + (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
// Matriz BCG por item (determinístico): participação (sell-through) x crescimento (recência de venda).
// bcgClass vem de ./lib/classificacao-comercial.mjs (extraída daqui, lógica idêntica).

// Mix BCG ideal dentro dos 12 itens da vitrine por loja (âncora provada + apostas + liquidação controlada).
const BCG_ALVO = { estrela: 2, vaca: 3, interrogacao: 4, abacaxi: 3 };
function buildOportunidadesMd(opp) {
  let md = '## 🛒 Oportunidades da Semana\n\n*Vitrine fixa de queima: 12 itens por loja (Tivoli e Dom Pedro, separados), priorizando bolsas/mochilas paradas. A coluna **Público**: a cada par de itens do mesmo nível, um entra no **Amplo** (fluxo do shopping / clientes novos) e um na **Base** (base que já comprou / recompra) — os dois recebem um pouco de cada quadrante, inclusive uma Estrela. O **desconto** segue o desejo do item (campeã leva menos, parada leva mais), na escada 15/20/25/30/35/40. A **Composição BCG** mostra o mix ideal da vitrine (âncoras que vendem + apostas + liquidação) vs. o que entrou. Preço com desconto e parcela já calculados.*\n';
  for (const loja of opp) {
    md += '\n### ' + loja.loja + '\n\n';
    if (!loja.itens.length) { md += '_Sem itens elegíveis com estoque esta semana._\n'; continue; }
    const cnt = { 'Estrela': 0, 'Vaca leiteira': 0, 'Interrogação': 0, 'Abacaxi': 0 };
    for (const it of loja.itens) cnt[bcgClass(it)]++;
    md += '::bcgmix e:' + cnt['Estrela'] + '/' + BCG_ALVO.estrela + ' v:' + cnt['Vaca leiteira'] + '/' + BCG_ALVO.vaca + ' i:' + cnt['Interrogação'] + '/' + BCG_ALVO.interrogacao + ' a:' + cnt['Abacaxi'] + '/' + BCG_ALVO.abacaxi + '::\n\n';
    md += '| SKU | Descrição | Categoria | BCG | Público | Preço orig. | % | Com desconto | 6x | Estoque (loja/pulmão) | Dias s/ vender |\n|---|---|---|---|---|---|---|---|---|---|---|\n';
    for (const it of loja.itens) {
      md += '| ' + it.sku + ' | ' + it.descricao + ' | ' + it.categoria + ' | ' + bcgClass(it) + ' | ' + it.publico + ' | ' + _rOpp(it.precoOriginal) + ' | ' + it.pct + '% | ' + _rOpp(it.precoComDesconto) + ' | ' + _rOpp(it.parcela6x) + ' | ' + it.estoqueLoja + ' / ' + it.estoquePulmao + ' | ' + it.diasSemVender + ' |\n';
    }
  }
  return md;
}

// ── Garimpo do Gestor (até 5 itens livres POR LOJA, curados pela IA) ──
// Princípio: a IA ESCOLHE do cardápio; o SISTEMA precifica (LLM não calcula preço).
const GARIMPO_MAX = 5;          // por loja
const GARIMPO_TETO = 40;        // % máximo de desconto (padrão)
const GARIMPO_TETO_ALTO = 60;   // % máximo das ofertas-âncora agressivas
const GARIMPO_MAX_ALTO = 2;     // quantas ofertas por loja podem usar o teto alto (60%)
// Cardápio de candidatos por loja de varejo: qualquer item vendável com estoque e preço.
function montarCardapio(saldoPorDep, prodMap, giro, ultimaVenda, hoje, capPorLoja = 60, depositos = null) {
  const { lojas: LOJAS_VAREJO, pulmao: DEP_PULMAO } = lojasEPulmao(depositos);
  const saldoPulmao = saldoPorDep[DEP_PULMAO] || {};
  const out = {};
  for (const L of LOJAS_VAREJO) {
    const saldos = saldoPorDep[L.deposito_id] || {};
    const itens = [];
    for (const [pid, saldo] of Object.entries(saldos)) {
      const meta = prodMap[pid]; if (!meta) continue;
      const cat = classificarItem(meta.nome); if (!cat) continue;   // ignora não-vendável
      const preco = Number(meta.preco) || 0;
      if (saldo < 1 || preco <= 0) continue;
      itens.push({
        pid, sku: meta.codigo || pid, nome: meta.nome, categoria: cat, preco,
        estoqueLoja: saldo, estoquePulmao: saldoPulmao[pid] || 0,
        giro: giro[pid] || 0, diasSemVender: _diasSemVender(ultimaVenda[pid], hoje),
      });
    }
    // repertório: prioriza capital parado (preço×estoque), mas a lista mista deixa a IA
    // escolher tanto encalhado quanto mover (item-isca) — ela decide.
    itens.sort((a, b) => (b.preco * b.estoqueLoja) - (a.preco * a.estoqueLoja));
    out[L.loja] = itens.slice(0, capPorLoja);
  }
  return out;
}
// Cardápio compacto pro prompt
function cardapioMd(cardapio) {
  let md = '';
  for (const loja in cardapio) {
    md += `\n### ${loja}\n`;
    if (!cardapio[loja].length) { md += '_sem itens com estoque_\n'; continue; }
    md += 'SKU | Item | Categoria | Preço | Estoque(loja/pulmão) | Giro mês | Dias s/ vender\n';
    for (const it of cardapio[loja]) {
      md += `${it.sku} | ${it.nome} | ${it.categoria} | ${_rOpp(it.preco)} | ${it.estoqueLoja}/${it.estoquePulmao} | ${it.giro} | ${it.diasSemVender}\n`;
    }
  }
  return md;
}
// Casa a chave de loja escolhida pela IA com a loja real (tolerante a variação de texto)
function _garimpoKeyMatch(obj, loja) {
  if (!obj) return [];
  const want = loja.toLowerCase();
  for (const k of Object.keys(obj)) {
    const kl = k.toLowerCase();
    if (kl === want || (want.includes('tivoli') && kl.includes('tivoli')) || (want.includes('dom pedro') && kl.includes('dom pedro'))) {
      return Array.isArray(obj[k]) ? obj[k] : [];
    }
  }
  return [];
}
// Valida os picks da IA contra o cardápio e precifica (exato pelo sistema).
function validarGarimpo(picksPorLoja, cardapio, oportunidades, depositos = null) {
  const { lojas: LOJAS_VAREJO } = lojasEPulmao(depositos);
  const usadosOpp = {};   // loja -> SKUs já nos 12 (não repetir)
  for (const o of (oportunidades || [])) usadosOpp[o.loja] = new Set((o.itens || []).map(i => String(i.sku)));
  const out = [];
  for (const L of LOJAS_VAREJO) {
    const cat = cardapio[L.loja] || [];
    const bySku = {}; cat.forEach(i => { bySku[String(i.sku)] = i; });
    const picks = _garimpoKeyMatch(picksPorLoja, L.loja);
    const vistos = new Set(); const itens = []; let altos = 0;
    for (const p of picks) {
      if (itens.length >= GARIMPO_MAX) break;
      const sku = String(p?.sku || '').trim();
      const it = bySku[sku];
      if (!it || vistos.has(sku)) continue;                      // sku inexistente/duplicado
      if (usadosOpp[L.loja] && usadosOpp[L.loja].has(sku)) continue; // já está nos 12
      let pct = Math.round(Number(p?.pct) || 0);
      if (!pct) continue;
      // até GARIMPO_MAX_ALTO ofertas-âncora por loja podem chegar a 60%; as demais ficam no teto de 40%.
      const tetoItem = (pct > GARIMPO_TETO && altos < GARIMPO_MAX_ALTO) ? GARIMPO_TETO_ALTO : GARIMPO_TETO;
      if (tetoItem === GARIMPO_TETO_ALTO) altos++;
      pct = Math.max(1, Math.min(tetoItem, pct));                // trava 1..40 (ou 1..60 nas âncoras)
      vistos.add(sku);
      const precoDesc = it.preco * (1 - pct / 100);
      itens.push({
        sku: it.sku, descricao: it.nome, categoria: it.categoria,
        precoOriginal: Math.round(it.preco * 100) / 100, pct,
        precoComDesconto: Math.round(precoDesc * 100) / 100,
        parcela6x: Math.round((precoDesc / 6) * 100) / 100,
        estoqueLoja: it.estoqueLoja, estoquePulmao: it.estoquePulmao,
        diasSemVender: it.diasSemVender, motivo: String(p?.motivo || '').slice(0, 160),
      });
    }
    out.push({ loja: L.loja, itens });
  }
  return out;
}
function buildGarimpoMd(garimpo) {
  let md = '## 💎 Garimpo do Gestor\n\n*As "apostas" da semana: itens escolhidos a dedo (qualquer categoria, desconto até 40% — e até 2 ofertas-âncora por loja podem chegar a 60%) pra destravar venda. A coluna **Por quê** explica cada escolha. Preço com desconto e parcela já calculados — é só aplicar.*\n';
  for (const loja of garimpo) {
    md += '\n### ' + loja.loja + '\n\n';
    if (!loja.itens.length) { md += '_Sem apostas esta semana._\n'; continue; }
    md += '| SKU | Descrição | Categoria | BCG | Preço orig. | % | Com desconto | 6x | Estoque (loja/pulmão) | Dias s/ vender | Por quê |\n|---|---|---|---|---|---|---|---|---|---|---|\n';
    for (const it of loja.itens) {
      md += '| ' + it.sku + ' | ' + it.descricao + ' | ' + it.categoria + ' | ' + bcgClass(it) + ' | ' + _rOpp(it.precoOriginal) + ' | ' + it.pct + '% | ' + _rOpp(it.precoComDesconto) + ' | ' + _rOpp(it.parcela6x) + ' | ' + it.estoqueLoja + ' / ' + it.estoquePulmao + ' | ' + it.diasSemVender + ' | ' + it.motivo + ' |\n';
    }
  }
  return md;
}
// Extrai o bloco ```garimpo {json} ``` da resposta do LLM e devolve {picks, limpo}
function parseGarimpoBlock(texto) {
  const m = texto.match(/```garimpo\s*([\s\S]*?)```/i);
  if (!m) return { picks: null, limpo: texto };
  let picks = null;
  try { picks = JSON.parse(m[1].trim()); } catch (e) { picks = null; }
  return { picks, limpo: texto.replace(m[0], '').trim() };
}

// ── Anthropic (retry em 429/5xx/rede) ──
async function anthropic(body, tentativas = 6) {
  for (let t = 0; t < tentativas; t++) {
    let r;
    try { r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify(body) }); }
    catch (e) { console.log('  rede falhou; aguardando…'); await sleep(Math.min(60, 8 * (t + 1)) * 1000); continue; }
    if (r.ok) return r.json();
    if (r.status === 429 || r.status >= 500) { const ra = parseInt(r.headers.get('retry-after') || '0', 10); console.log('  rate/sobrecarga ' + r.status + '; aguardando…'); await sleep((ra > 0 ? ra : Math.min(60, 8 * (t + 1))) * 1000); continue; }
    throw new Error('Anthropic ' + r.status + ' ' + JSON.stringify(await r.json().catch(() => ({}))).slice(0, 300));
  }
  throw new Error('Anthropic: tentativas esgotadas');
}

// ── Datas (America/Sao_Paulo) ──
function hojeBR() {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });
  return f.format(new Date()); // YYYY-MM-DD
}

// ── Calendário comercial BR (datado, p/ a IA não inventar datas) ──
function _nthSunday(y, monthIdx, n) {            // n-ésimo domingo do mês
  const d = new Date(y, monthIdx, 1); let c = 0;
  for (;;) { if (d.getDay() === 0 && ++c === n) return new Date(d); d.setDate(d.getDate() + 1); }
}
function _lastFriday(y, monthIdx) {              // última sexta do mês
  const d = new Date(y, monthIdx + 1, 0);
  while (d.getDay() !== 5) d.setDate(d.getDate() - 1);
  return d;
}
function proximasDatasComerciais(hoje, dias = 80) {
  const base = new Date(hoje + 'T00:00:00');
  const eventos = [];
  for (const y of [base.getFullYear(), base.getFullYear() + 1]) {
    eventos.push(
      { nome: 'Dia das Mães',       data: _nthSunday(y, 4, 2) },   // 2º domingo de maio
      { nome: 'Dia dos Namorados',  data: new Date(y, 5, 12) },    // 12/06
      { nome: 'Dia dos Pais',       data: _nthSunday(y, 7, 2) },   // 2º domingo de agosto
      { nome: 'Dia do Cliente',     data: new Date(y, 8, 15) },    // 15/09
      { nome: 'Dia das Crianças',   data: new Date(y, 9, 12) },    // 12/10
      { nome: 'Black Friday',       data: _lastFriday(y, 10) },    // última 6ª de novembro
      { nome: 'Natal',              data: new Date(y, 11, 25) },   // 25/12
    );
  }
  const fim = new Date(base); fim.setDate(base.getDate() + dias);
  return eventos
    .filter(e => e.data >= base && e.data <= fim)
    .sort((a, b) => a.data - b.data)
    .map(e => ({ nome: e.nome, data: e.data.toISOString().slice(0, 10), emDias: Math.round((e.data - base) / 864e5) }));
}

async function main() {
  const hoje = hojeBR();
  const [y, m, d] = hoje.split('-').map(Number);
  const diasNoMes = new Date(y, m, 0).getDate();
  const di = `${y}-${String(m).padStart(2, '0')}-01`;
  const df = hoje;
  console.log('== Gestor Comercial · ' + hoje + ' · ' + MODEL + ' ==');
  await logGestor('inicio', null, 'rodada ' + hoje + ' (' + MODEL + ')');
  let _totIn = 0, _totOut = 0, _chamadas = 0; // uso da API p/ calcular o custo da rodada

  // 1) faturamento real por canal (mês corrente) via bling-proxy
  const token = await loginServico();
  const pedidos = await blingPedidos(token, di, df);
  const realPorCanal = realPorCanalDe(pedidos);

  // 2) metas do mês (todas as lojas; casa pelos canais foco quando houver)
  const metas = await sbGet(`/bling_metas?year=eq.${y}&month=eq.${m}&select=loja_id,loja_nome,meta_valor,daily_goals`);

  // 3) concorrentes recentes (últimas ~2 semanas)
  const desde = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);
  const noticias = await sbGet(`/noticias_concorrentes?rodada=gte.${desde}&select=marca,titulo,resumo,categoria,fonte,data_publicacao&order=data_publicacao.desc&limit=40`);

  // 3.5) estoque por armazém dos canais foco + giro do mês (itens parados)
  let estoque = [], oportunidades = [], cardapio = {};
  try {
    const prodMap = await blingProdutos(token);
    const saldoPorDep = await blingSaldoFoco(token, prodMap);
    const di90 = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
    const pedidos90 = await blingPedidos(token, di90, df);
    const { giro, ultimaVenda } = await blingVendas(token, pedidos90, di);
    estoque = montarEstoque(saldoPorDep, prodMap, giro, d);
    const weekNum = Math.floor(Date.now() / (7 * 864e5));
    oportunidades = montarOportunidades(saldoPorDep, prodMap, giro, ultimaVenda, hoje, weekNum);
    cardapio = montarCardapio(saldoPorDep, prodMap, giro, ultimaVenda, hoje);
    console.log('estoque/opp:', estoque.map(e => `${e.canal}=${e.rupturas.length} rupt`).join(' · '), '| ofertas:', oportunidades.map(o => `${o.loja}=${o.itens.length}`).join(' · '), '| cardápio:', Object.entries(cardapio).map(([l, a]) => `${l}=${a.length}`).join(' · '));
  } catch (e) {
    console.error('aviso estoque/opp:', e.message); // não derruba o briefing
  }

  // 3.6) comparativo com o briefing anterior (semana vs semana)
  let comparativo = null;
  try {
    const ant = await sbGet('/gestao_comercial_briefings?select=rodada,dados_json&order=created_at.desc&limit=8');
    const prev = (ant || []).find(b => b.rodada !== hoje && b.dados_json);
    if (prev) {
      const prevCanais = prev.dados_json.canaisFoco || [];
      comparativo = {
        rodadaAnterior: prev.rodada,
        canais: CANAIS.map(c => {
          const at = realPorCanal[c.loja_id];
          const pv = prevCanais.find(p => p.canal === c.nome);
          return {
            canal: c.nome,
            realizadoAnterior: pv ? pv.realizado : null,
            realizadoAtual: Math.round(at),
            deltaRealizado: pv ? Math.round(at - pv.realizado) : null,
            percentMetaAnterior: pv ? pv.percentMeta : null,
          };
        }),
      };
      console.log('comparativo vs', prev.rodada, 'montado');
      // tendência: variação de giro por categoria vs a rodada anterior
      const prevEst = {};
      for (const e of (prev.dados_json.estoque || [])) { prevEst[e.canal] = {}; for (const c of (e.categorias || [])) prevEst[e.canal][c.categoria] = c.vendidoMes || 0; }
      for (const e of estoque) for (const c of (e.categorias || [])) { const pv = prevEst[e.canal] ? prevEst[e.canal][c.categoria] : undefined; c.deltaGiro = (pv == null) ? null : (c.vendidoMes - pv); }
    } else {
      console.log('sem briefing anterior de outra data p/ comparar');
    }
  } catch (e) { console.error('aviso comparativo:', e.message); }

  // 4) monta o pacote de números (com ritmo de meta por canal foco)
  const canaisResumo = canaisFocoDe({ metas, realPorCanal, diaDoMes: d, diasNoMes });
  const calendario = proximasDatasComerciais(hoje);
  const dados = { rodada: hoje, mesReferencia: `${y}-${String(m).padStart(2, '0')}`, diaDoMes: d, diasNoMes, canaisFoco: canaisResumo, totalPedidosMes: pedidos.length, comparativo, estoque, calendario };

  // 5) Claude escreve o briefing (persona de gestor-chefe, cabeça de dono)
  const sys = 'Você é o gestor comercial-chefe (cabeça de dono) de uma operação de varejo e atacado de moda em bolsas (marca Vessel). '
    + 'Pensa como dono: prioriza caixa, giro e competitividade; é criativo e agressivo no ponto certo; escreve briefings semanais AFIADOS, diretos e 100% acionáveis — chão de loja, sem encheção, sem repetir número à toa. '
    + 'Foco TOTAL em 3 canais: Shopping Tivoli (Santa Bárbara), Shopping Dom Pedro e Atacado Nuvem Shop. '
    + 'REGRAS DE MARCA (invioláveis): (1) a Vessel NÃO trabalha com itens nem público MASCULINO — nunca sugira produto, campanha ou segmentação masculina; (2) as bolsas são de CANVAS (tecido premium), MUITO mais duráveis que couro — JAMAIS chame ou trate o produto como "couro"; ao posicionar/argumentar venda, destaque o Canvas/tecido premium e a durabilidade superior ao couro.';
  const lojasGarimpo = LOJAS_VAREJO.map(l => l.loja).join('" e "');
  const user = 'Dados desta semana (R$ reais do Bling, metas e movimento de concorrentes):\n\n'
    + 'NÚMEROS:\n' + JSON.stringify(dados, null, 2) + '\n\n'
    + 'CONCORRENTES (últimas 2 semanas):\n' + (noticias.length ? noticias.map(n => `- [${n.marca}/${n.categoria}] ${n.titulo} (${n.fonte}, ${n.data_publicacao})`).join('\n') : '(sem notícias recentes)') + '\n\n'
    + 'CARDÁPIO PARA O GARIMPO (itens disponíveis por loja — escolha SÓ daqui):\n' + (cardapioMd(cardapio) || '(sem cardápio)') + '\n\n'
    + 'COMO ESCREVER (importante): você fala com o DONO do negócio, que NÃO é técnico. Seja CLARO, simples e direto. Explique cada número e cada termo na primeira vez que usar, em português do dia a dia — ex.: "sell-through 30% = de cada 10 peças disponíveis no mês, 3 venderam"; "ruptura = risco de faltar, porque vende rápido e tem pouco estoque". Nada de jargão solto. Toda recomendação tem que deixar claro O QUÊ, ONDE e POR QUÊ. '
    + 'Escreva o briefing em markdown com EXATAMENTE estas 5 seções, nesta ordem, e NENHUMA outra: '
    + '## 📌 Leitura da Semana (3-5 bullets: o que importa de verdade e o que decidir agora) · '
    + '## 🎯 Metas & Ritmo (por canal: % da meta, se está adiantado ou atrasado, e projeção de fechamento do mês; use dados.comparativo p/ dizer se faturou MAIS ou MENOS que a semana passada — deltaRealizado em R$. Se comparativo for null, diga que é a 1ª medição) · '
    + '## 📦 Estoque: repor x queimar (use dados.estoque[].categorias (sellThrough, deltaGiro, parados) + dados.estoque[].rupturas. Organize em DUAS frentes claras: (A) REPOR/DESTACAR — o que vende e pode FALTAR (ruptura) ou está acelerando; (B) QUEIMAR/COMBO — o que está parado ou desacelerando e trava dinheiro em estoque. Aponte REALOCAÇÃO entre lojas (parado num canal e girando no outro). Cite nome/código. Não mencione sacola/TNT/insumo) · '
    + '## ⚔️ Concorrência & Calendário (PRIMEIRO: o que os concorrentes fizeram e o NOSSO contra-ataque direto — preço, combo, vitrine, argumento de venda — citando nossos produtos/códigos. DEPOIS: use SOMENTE as datas de dados.calendario (reais e datadas) e monte, pra cada data próxima, uma campanha objetiva: tema, categorias-alvo, mecânica e o que preparar já) · '
    + '## ✅ Plano de Ataque (lista numerada com os 3-5 movimentos mais importantes da semana: o quê, onde, urgência e impacto esperado. Inclua AQUI as mecânicas criativas que sugerir — combo ex. bolsa+carteira, brinde por faixa de valor, leve 2 pague 1, kit presente. SEMPRE que um movimento empurrar bolsas/produtos específicos, cite-os por nome/código E ancore-os no Garimpo: esses MESMOS itens devem entrar nas suas apostas do bloco garimpo (quando existirem no cardápio), pra o desconto sustentar o movimento — escreva "(ver Garimpo)" ao lado do item ancorado). '
    + 'Use só os números reais fornecidos. Não invente faturamento, datas nem produtos fora dos dados. '
    + 'NÃO escreva nenhuma tabela de ofertas nem uma seção própria de "Garimpo" no texto — as tabelas de Garimpo e Oportunidades são geradas pelo sistema (com preços exatos) e anexadas no FIM. Sua única entrega sobre o Garimpo é o bloco JSON abaixo. '
    + 'GARIMPO (suas apostas): escolha até ' + GARIMPO_MAX + ' itens POR LOJA do CARDÁPIO (qualquer item; criativo e competitivo — encalhado de alto capital, item-isca de tráfego ou resposta a concorrente), desconto INTEIRO de 5% a ' + GARIMPO_TETO + '% — e ATÉ ' + GARIMPO_MAX_ALTO + ' desses itens por loja podem chegar a ' + GARIMPO_TETO_ALTO + '% (ofertas-âncora: reserve pra encalhado pesado/alto capital que precisa de empurrão forte). Um motivo curto e CLARO pra cada. Não repita itens das Oportunidades. '
    + 'O Garimpo é a MUNIÇÃO DE PREÇO do Plano de Ataque, não uma lista solta: PRIORIZE as bolsas/itens que você recomendou atacar no Plano de Ataque (sempre que estiverem no cardápio) e, no "motivo" de cada um, amarre à jogada do Plano (ex.: "sustenta o movimento 2: combo bolsa+carteira"). Só preencha as vagas restantes com apostas livres (isca de tráfego ou resposta a concorrente). '
    + 'Saída NESTA ORDEM: (1) as 5 seções; (2) uma linha "RESUMO: <1 frase>"; (3) por ÚLTIMO, um bloco de código ```garimpo contendo JSON no formato '
    + '{"' + lojasGarimpo + '":[{"sku":"<código do cardápio>","pct":30,"motivo":"..."}]} — use EXATAMENTE esses nomes de loja como chaves e SKUs do cardápio.';

  // Modos manuais (sem custo de API): GESTOR_DUMP = só coleta dados e para; GESTOR_BRUTO_FILE = usa narrativa escrita à mão.
  let bruto;
  if (process.env.GESTOR_BRUTO_FILE) {
    bruto = fs.readFileSync(process.env.GESTOR_BRUTO_FILE, 'utf8').trim();
    console.log('narrativa manual de', process.env.GESTOR_BRUTO_FILE, '(sem LLM)');
  } else if (process.env.GESTOR_DUMP) {
    fs.writeFileSync(process.env.GESTOR_DUMP, JSON.stringify({ rodada: hoje, periodo: `Semana de ${hoje} (${dados.mesReferencia})`, sys, user, dados, oportunidades, cardapio }, null, 2));
    console.log('DUMP escrito em', process.env.GESTOR_DUMP, '— parando antes do LLM (nada gravado).');
    return;
  } else {
    const resp = await anthropic({ model: MODEL, max_tokens: 16000, thinking: { type: 'adaptive' }, system: sys, messages: [{ role: 'user', content: user }] });
    _chamadas++; _totIn += (resp && resp.usage && resp.usage.input_tokens) || 0; _totOut += (resp && resp.usage && resp.usage.output_tokens) || 0;
    bruto = resp.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  }
  // extrai e remove o bloco garimpo ANTES do RESUMO (que deve ficar no fim do texto limpo)
  const { picks: garimpoPicks, limpo } = parseGarimpoBlock(bruto);
  const garimpo = validarGarimpo(garimpoPicks, cardapio, oportunidades);
  console.log('garimpo:', garimpo.map(g => `${g.loja}=${g.itens.length}`).join(' · '));
  const mResumo = limpo.match(/RESUMO:\s*(.+)\s*$/);
  const resumo = mResumo ? mResumo[1].trim() : (canaisResumo.map(c => `${c.canal}: ${c.percentMeta}% da meta`).join(' · '));
  // monta o conteúdo final: corpo do LLM + Garimpo + Oportunidades (POR ÚLTIMO) + RESUMO
  let corpo = limpo.replace(/\n*RESUMO:.*$/s, '').trim();
  if (garimpo.some(o => o.itens.length)) corpo += '\n\n' + buildGarimpoMd(garimpo);
  if (oportunidades.some(o => o.itens.length)) corpo += '\n\n' + buildOportunidadesMd(oportunidades);
  const conteudo = corpo + '\n\nRESUMO: ' + resumo;
  const periodo = `Semana de ${hoje} (${dados.mesReferencia})`;

  // 6) grava o briefing
  await sbInsert('/gestao_comercial_briefings', [{ rodada: hoje, periodo, resumo, conteudo, dados_json: { ...dados, oportunidades, garimpo } }], 'return=minimal');
  console.log('briefing gravado. canais:', canaisResumo.map(c => `${c.canal}=${c.percentMeta}%`).join(', '));
  const _usd = _totIn / 1e6 * 5 + _totOut / 1e6 * 25; // Opus 4.8: US$5/1M entrada, US$25/1M saída
  console.log(`💰 Custo da rodada: ~US$ ${_usd.toFixed(2)} (~R$ ${(_usd * 5.5).toFixed(2)}) · ${_chamadas} chamadas · ${_totIn} tokens entrada + ${_totOut} saída (câmbio aprox. 5,5)`);
  await logGestor('fim', null, 'pedidos=' + pedidos.length + ' · ' + canaisResumo.map(c => `${c.canal}:${c.status}`).join(' · '));
  await registrarExecucao({
    robo: 'gestor-comercial', acao: 'briefing semanal', modelo: MODEL,
    inputTokens: _totIn, outputTokens: _totOut, chamadas: _chamadas,
    duracaoMs: Date.now() - _t0, itens: 1, unidade: 'briefings',
    status: 'ok', detalhe: periodo,
  });
}

// ⚠️ SÓ RODA QUANDO CHAMADO DIRETO. Até 05/09/2026 este `main()` estava solto:
// QUALQUER `import` deste arquivo disparava o robô inteiro contra produção —
// login, chamadas ao Bling, chamadas à IA e escrita no log. Descobri isso da
// pior maneira, importando o arquivo para testar uma função pura: o robô saiu
// rodando e gravou uma linha "início" às 21:00 de 05/09.
//
// É também o motivo de este arquivo nunca ter tido teste: não havia como
// importá-lo sem executá-lo. O irmão `relatorios-comerciais.mjs` já tinha esta
// trava; este ficou sem.
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch(async (e) => {
    console.error('FALHA:', e.message);
    await logGestor('fim', e.message.slice(0, 500), 'falha geral');
    await registrarExecucao({ robo: 'gestor-comercial', acao: 'briefing semanal', modelo: MODEL, duracaoMs: Date.now() - _t0, status: 'erro', detalhe: e.message.slice(0, 500) });
    process.exit(1);
  });
}
