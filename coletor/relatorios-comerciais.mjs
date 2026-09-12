#!/usr/bin/env node
// Job Relatórios Comerciais — pré-agrega vendas por item/mês/canal em
// gc_vendas_item e estoque por depósito foco em gc_estoque_item. Fonte: Bling
// (via bling-proxy, conta de serviço). Idempotente (upsert). Reusa os helpers
// de lib/bling-comercial.mjs (mesma coleta do Gestor).
//
// Uso:
//   node relatorios-comerciais.mjs               # só o mês corrente (roda diário)
//   node relatorios-comerciais.mjs --backfill=12 # os últimos 12 meses (uma vez)
//
// Sem deps externas — fetch nativo (Node 18+).

import './lib/carregar-env.mjs';   // popula process.env do .env ANTES de importar a lib (que lê env no topo)
import { pathToFileURL } from 'node:url';
import {
  loginServico, blingProxy, blingPedidos, blingProdutos, blingSaldoFoco,
  classificarItem, classificarItemDetalhado, categoriaDeEstoque, DEP_FOCO,
  blingDepositos,
} from './lib/bling-comercial.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://kounqtdoioootxqegkij.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const REST = SUPABASE_URL + '/rest/v1';
const sb = { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY, 'Content-Type': 'application/json' };

// ⚠️ ESTA LISTA DEIXOU DE SER A VERDADE em 05/09/2026, pelo mesmo motivo dos
// depósitos: canal novo criado no Bling nunca aparecia, e todo pedido de canal
// fora dela era DESCARTADO antes de virar dado. Ela ficou como SEMENTE, para o
// caso de a leitura da tabela falhar.
//
// A verdade agora é `bling_lojas.foco`. Ver `canaisDeFoco` logo abaixo.
const CANAIS_SEMENTE = [
  { nome: 'Tivoli',    loja_id: '205834140' },
  { nome: 'Dom Pedro', loja_id: '205657609' },
  { nome: 'Atacado',   loja_id: '205451611' },
];

// OS CANAIS QUE O ROBO DETALHA, lidos da tabela. Se a leitura falhar, devolve a
// semente — perder um canal novo por soluço de rede é ruim; perder a coleta
// inteira é pior.
export async function canaisDeFoco(sbGetJson) {
  try {
    const linhas = await sbGetJson('/bling_lojas?select=loja_id,nome,foco&foco=is.true');
    if (Array.isArray(linhas) && linhas.length) {
      return linhas.map((l) => ({ nome: l.nome, loja_id: String(l.loja_id) }));
    }
  } catch (e) {
    console.warn('  não consegui ler os canais (segue com a lista antiga):', e.message);
  }
  return CANAIS_SEMENTE;
}

// CANAL QUE APARECEU NOS PEDIDOS E NAO ESTA CADASTRADO entra sozinho.
//
// ⚠️ O NOME NAO VEM DO BLING. A API não tem `/canais-de-venda` nem `/lojas`
// (as duas dão 404, medido em 05/09/2026) e o pedido traz só `loja:{id}`. Então
// o canal entra com um nome provisório e alguém o renomeia na Config de Admin —
// o que NÃO dá para automatizar é o nome, não o reconhecimento.
export function canaisNovosNosPedidos(pedidos, jaCadastrados) {
  const conhecidos = new Set([...jaCadastrados].map(String));
  const novos = new Map();
  for (const p of (pedidos || [])) {
    const id = String(p?.loja?.id ?? '');
    if (!id || conhecidos.has(id) || novos.has(id)) continue;
    novos.set(id, { loja_id: Number(id), nome: `Canal #${id.slice(-4)}`, foco: true });
  }
  return [...novos.values()];
}

// ── Agregação pura: soma itens dos pedidos DAQUELE canal, por SKU ──
// pedidos: [{ loja:{id}, itens:[{ codigo, descricao, quantidade, valor, produto:{id} }] }]
// Retorna mapa sku → { sku, produto, unidades, faturamento }.
// faturamento = Σ (valor unitário do item × quantidade) — sem rateio de frete/desconto do pedido.
export function agregarVendas(pedidos, canalLojaId) {
  const mapa = {};
  const alvo = String(canalLojaId);
  for (const p of (pedidos || [])) {
    if (String(p?.loja?.id ?? '') !== alvo) continue;
    for (const it of (p.itens || [])) {
      const pid = String(it.produto?.id ?? '');
      const sku = String(it.codigo || pid || '').trim();
      if (!sku) continue;
      const q = Number(it.quantidade) || 0;
      const v = Number(it.valor) || 0;
      if (!mapa[sku]) mapa[sku] = { sku, produto: String(it.descricao || '').slice(0, 120), unidades: 0, faturamento: 0 };
      mapa[sku].unidades += q;
      mapa[sku].faturamento += v * q;
    }
  }
  return mapa;
}

// ── Meses do range: mês corrente, ou os últimos N (inclusive o corrente) ──
// Retorna [{ mes:'YYYY-MM-01', ini:'YYYY-MM-01', fim:'YYYY-MM-DD' }], mais antigo primeiro.
export function mesesRange(backfillN = 0, hoje = new Date()) {
  const n = Math.max(1, backfillN || 1);
  const out = [];
  const y = hoje.getUTCFullYear(), m = hoje.getUTCMonth(); // 0-11
  for (let k = n - 1; k >= 0; k--) {
    const d = new Date(Date.UTC(y, m - k, 1));
    const yy = d.getUTCFullYear(), mm = d.getUTCMonth();
    const p2 = (x) => String(x).padStart(2, '0');
    const ini = `${yy}-${p2(mm + 1)}-01`;
    const ultimo = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
    const fim = `${yy}-${p2(mm + 1)}-${p2(ultimo)}`;
    out.push({ mes: ini, ini, fim });
  }
  return out;
}

// ── Supabase REST leitura (service key) ──
// A chave de servico passa por cima da RLS, como no resto deste robo.
async function sbGetJson(caminho) {
  const r = await fetch(`${REST}${caminho}`, { headers: sb });
  if (!r.ok) throw new Error(`GET ${caminho} -> ${r.status} ${(await r.text()).slice(0, 160)}`);
  return r.json();
}

// ── Supabase REST upsert (service key) ──
async function upsert(table, conflict, rows) {
  if (!rows.length) return;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const r = await fetch(`${REST}/${table}?on_conflict=${conflict}`, {
      method: 'POST',
      headers: { ...sb, Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(chunk),
    });
    if (!r.ok && ![200, 201, 204].includes(r.status)) {
      throw new Error(`upsert ${table} -> ${r.status} ${(await r.text()).slice(0, 200)}`);
    }
  }
}

// ── Apaga o que DEIXOU de existir no mês ─────────────────────────────────
//
// POR QUE: o upsert só insere e atualiza — nunca remove. Se um pedido saiu de
// setembro para outubro (porque a venda passa a contar no dia da NOTA) e ele era
// a única venda daquele SKU em setembro, o recálculo de setembro simplesmente
// não produz aquela linha... e a linha ANTIGA fica no banco, com o valor velho.
// O SKU passa a aparecer nos dois meses, inflando a Curva ABC e a Matriz BCG.
//
// A regra: quem não foi tocado por ESTA rodada não pertence mais a este mês.
// Por isso o carimbo é enviado explicitamente — é ele que separa "recalculado
// agora" de "sobra de uma rodada antiga".
//
// Apaga DEPOIS de gravar, nunca antes: se a rodada morrer no meio, o mês fica
// com o dado velho (que é ruim) em vez de vazio (que é pior).
async function limparSobrasDoMes(mes, canalLojaId, carimbo) {
  const alvo = `${REST}/gc_vendas_item?mes=eq.${mes}&canal_loja_id=eq.${canalLojaId}` +
               `&atualizado_em=lt.${encodeURIComponent(carimbo)}`;
  const r = await fetch(alvo, { method: 'DELETE', headers: { ...sb, Prefer: 'return=representation' } });
  if (!r.ok) throw new Error(`limpar sobras ${mes}/${canalLojaId} -> ${r.status} ${(await r.text()).slice(0, 200)}`);
  const apagadas = await r.json().catch(() => []);
  if (apagadas.length) console.log(`      (${apagadas.length} linha(s) que deixaram de existir neste mês foram removidas)`);
}

async function main() {
  if (!SERVICE_KEY) { console.error('✗ Falta SUPABASE_SERVICE_KEY'); process.exit(1); }
  const bf = Number((process.argv.find(a => a.startsWith('--backfill=')) || '').split('=')[1]) || 0;
  const meses = mesesRange(bf);
  console.log(`→ Relatórios comerciais: ${meses.length} mês(es) [${meses[0].mes}..${meses.at(-1).mes}]`);

  const token = await loginServico();
  // Marca desta rodada: o que ficar com carimbo anterior a isto é sobra.
  const carimbo = new Date().toISOString();

  // ── OS CANAIS, lidos da tabela em vez de escritos aqui ──
  const CANAIS = await canaisDeFoco(sbGetJson);
  const CANAL_IDS = new Set(CANAIS.map((c) => c.loja_id));
  console.log(`→ Canais em foco (${CANAIS.length}): ${CANAIS.map((c) => c.nome).join(', ')}`);

  // Todos os cadastrados, para saber quem e NOVO nos pedidos.
  let cadastrados = new Set(CANAIS.map((c) => c.loja_id));
  try {
    const todos = await sbGetJson('/bling_lojas?select=loja_id');
    cadastrados = new Set((todos || []).map((l) => String(l.loja_id)));
  } catch { /* segue com os de foco; no pior caso um canal e reinserido */ }

  // ── Vendas por item/mês/canal ──
  for (const { mes, ini, fim } of meses) {
    const pedidos = await blingPedidos(token, ini, fim);
    if (pedidos.length >= 1000) console.warn(`  ⚠ ${mes}: ${pedidos.length} pedidos (limite de paginação atingido — possível truncamento)`);

    // CANAL NOVO ENTRA SOZINHO. Ele passa a valer já nesta rodada.
    const novos = canaisNovosNosPedidos(pedidos, cadastrados);
    if (novos.length) {
      await upsert('bling_lojas', 'loja_id', novos);
      for (const n of novos) {
        cadastrados.add(String(n.loja_id));
        CANAIS.push({ nome: n.nome, loja_id: String(n.loja_id) });
        CANAL_IDS.add(String(n.loja_id));
        console.log(`  ✚ canal novo no Bling: ${n.nome} — renomeie na Config de Admin`);
      }
    }

    const foco = pedidos.filter(p => CANAL_IDS.has(String(p?.loja?.id ?? '')));
    console.log(`  ${mes}: ${pedidos.length} pedidos, ${foco.length} nos canais foco — detalhando itens…`);

    const detalhados = [];
    for (const p of foco) {
      let d;
      try { d = await blingProxy(token, 'pedidos/vendas/' + p.id, {}); }
      catch (e) { console.warn(`    pedido ${p.id} falhou (segue):`, e.message); continue; }
      detalhados.push({ loja: p.loja, itens: d.data?.itens || [] });
    }

    for (const canal of CANAIS) {
      const mapa = agregarVendas(detalhados, canal.loja_id);
      const rows = Object.values(mapa).map(x => ({
        mes, canal_loja_id: Number(canal.loja_id), sku: x.sku, produto: x.produto,
        categoria: classificarItem(x.produto), unidades: Math.round(x.unidades),
        faturamento: Math.round(x.faturamento * 100) / 100,
        // O carimbo vai EXPLÍCITO: o default do banco só vale quando a linha
        // nasce, e o upsert regrava apenas as colunas enviadas. Sem isto, uma
        // linha recalculada hoje continua exibindo a data da primeira vez — foi
        // essa coluna mentindo que me fez achar que set/2025 não tinha sido
        // reprocessado, quando tinha.
        atualizado_em: carimbo,
      }));
      await upsert('gc_vendas_item', 'mes,canal_loja_id,sku', rows);
      // A limpeza só roda se o mês trouxe pedidos. Um mês que volta VAZIO do
      // Bling é muito mais provavelmente um soluço de rede do que um mês sem
      // nenhuma venda — e limpar em cima disso apagaria o mês inteiro.
      if (pedidos.length) await limparSobrasDoMes(mes, canal.loja_id, carimbo);
      const fat = rows.reduce((s, r) => s + r.faturamento, 0);
      console.log(`    ${canal.nome}: ${rows.length} SKUs, R$ ${fat.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
    }
  }

  // ── Estoque por depósito foco (snapshot atual) ──
  //
  // Aqui vale `categoriaDeEstoque`, NÃO `classificarItem`: no estoque a pergunta
  // é "isto é produto vendável?", e o pega-tudo da lista respondia "sim" a todo
  // nome desconhecido. Era assim que argola, botão, couro e camurça chegavam ao
  // telão da Gestão à Vista.
  // ── OS DEPOSITOS QUE EXISTEM, direto do Bling ──
  //
  // ⚠️ ISTO RODA ANTES DO SALDO, de proposito: e daqui que sai o NOME de cada
  // deposito. Sem esta chamada, um deposito novo entraria no estoque como um
  // numero sem nome, e a tela mostraria uma coluna que ninguem sabe o que e.
  //
  // Se a chamada falhar, o robo NAO para: segue com a lista-semente `DEP_FOCO`,
  // que e o comportamento antigo. Perder o deposito novo por um soluco de rede e
  // ruim; perder a coleta inteira e pior.
  console.log('→ Depósitos do Bling…');
  let depositos = [];
  try {
    depositos = await blingDepositos(token);
    if (depositos.length) {
      await upsert('bling_depositos', 'deposito_id',
        depositos.map((d) => ({ ...d, atualizado_em: new Date().toISOString() })));
      console.log(`  ${depositos.length} depósitos: ${depositos.map((d) => d.nome).join(', ')}`);
    }
  } catch (e) {
    console.warn('  não consegui listar os depósitos (segue com a lista antiga):', e.message);
  }
  // A lista que vai ser percorrida: a do Bling quando deu certo, a semente quando não.
  const depositosParaColetar = depositos.length
    ? depositos.map((d) => ({ deposito_id: String(d.deposito_id), canal: d.nome }))
    : DEP_FOCO;

  console.log('→ Estoque por depósito…');
  const prodMap = await blingProdutos(token);
  const saldoPorDep = await blingSaldoFoco(token, prodMap);
  const naoReconhecidos = new Map();   // sku -> nome, para a vigia abaixo
  for (const { deposito_id, canal } of depositosParaColetar) {
    const saldos = saldoPorDep[deposito_id] || {};
    const rows = Object.entries(saldos).map(([pid, saldo]) => {
      const meta = prodMap[pid] || {};
      const nome = meta.nome || '';
      const sku = String(meta.codigo || pid);
      if (nome.trim() && !classificarItemDetalhado(nome).reconhecido) naoReconhecidos.set(sku, nome);
      return {
        deposito_id: Number(deposito_id), sku, produto: nome.slice(0, 120),
        categoria: categoriaDeEstoque(nome), saldo: Math.round(Number(saldo) || 0),
        // ⚠️ ATE 05/09/2026 ESTA COLUNA NAO ERA ESCRITA AQUI. Ela tem `default
        // now()`, e nao ha gatilho — entao guardava quando o SKU apareceu pela
        // PRIMEIRA vez naquele deposito, e nao quando foi conferido. Uma delas
        // marcava 30/07 com o robo rodando todo dia. Nome que mente e pior que
        // coluna que falta: quem olhasse concluiria que o robo parou.
        atualizado_em: new Date().toISOString(),
      };
    });
    await upsert('gc_estoque_item', 'deposito_id,sku', rows);
    console.log(`  ${canal}: ${rows.length} SKUs com saldo`);
  }

  // ── A VIGIA ───────────────────────────────────────────────────────────────
  // O conserto acima inverteu o lado para o qual a lista erra: agora o nome que
  // ela não conhece fica FORA do estoque. Isso é o certo para insumo e é o
  // errado para uma linha de produto nova — e sumir da tela sem ninguém saber é
  // pior de perceber do que aparecer indevidamente. Por isso o número sai no log
  // de toda rodada, com exemplos: se ele crescer de repente, é produto novo
  // faltando na lista, não insumo.
  if (naoReconhecidos.size) {
    const exemplos = [...naoReconhecidos.values()].slice(0, 8).join(' | ');
    console.warn(`  ⚠️ ${naoReconhecidos.size} SKUs sem classificação (ficam FORA do estoque): ${exemplos}`);
  } else {
    console.log('  todos os SKUs do estoque foram reconhecidos pela lista.');
  }

  console.log('✓ concluído.');
}

// só executa main() quando chamado direto (o teste importa agregarVendas sem rodar a coleta)
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch(e => { console.error('Erro:', e.message); process.exit(1); });
}
