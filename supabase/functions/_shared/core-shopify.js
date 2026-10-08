// Leituras da Shopify pelo serviço `core` (o core é o ÚNICO dono da Shopify).
// SOMENTE LEITURA — nada aqui escreve na Shopify (a escrita de estoque é outra tarefa).
//
// FLAG: `CORE_SHOPIFY_LEITURA=true` (ou 1) liga. Ausente/qualquer outra coisa = DESLIGADO
// e o caminho antigo (Admin API direto) segue idêntico. Usa `CORE_URL`/`CORE_API_TOKEN`.
//
// DUAS FONTES, conforme o que o core guarda:
//  - ESPELHO (`GET /api/interno/espelho/shopify_*`): pedidos. O espelho NÃO tem nome/e-mail/
//    telefone/endereço do cliente nem o JSON do pedido — por isso o que ele alimenta no
//    Supabase NUNCA toca nessas colunas (ver SQL_UPSERT_PEDIDO_SEM_PII).
//  - PROXY (`POST /api/interno/shopify/proxy`): estoque do site. O espelho não tem
//    `inventoryItem.tracked` e a escrita usa o saldo lido como trava otimista
//    (`changeFromQuantity`) — precisa ser o saldo AO VIVO, então a mesma consulta GraphQL
//    de antes passa pelo proxy (resposta idêntica à da Shopify).
//
// Módulo puro (roda na edge e no coletor); `fetchImpl` e `esperar` injetáveis para o teste.
import { CORE_URL_PADRAO } from './core-leitura.js';
import { LOJA_ID_SHOPIFY } from './pedido-shopify.js';

export function shopifyLeituraLigada(env) {
  const v = String(env?.CORE_SHOPIFY_LEITURA ?? '').trim().toLowerCase();
  return v === 'true' || v === '1';
}

const esperarPadrao = (ms) => new Promise((r) => setTimeout(r, ms));

/** GraphQL de LEITURA pelo proxy do core. Devolve `data`; lança em erro (token nunca vai na mensagem). */
export function graphqlPeloCore({ url, token, fetchImpl = globalThis.fetch, esperar = esperarPadrao } = {}) {
  if (!token) throw new Error('CORE_API_TOKEN ausente');
  const base = String(url || CORE_URL_PADRAO).replace(/\/+$/, '');
  return async function graphql(query, variaveis) {
    for (let t = 0; t < 4; t++) {
      const r = await fetchImpl(`${base}/api/interno/shopify/proxy`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ tipo: 'graphql', query, variaveis }),
      });
      if (r.status === 429 || r.status >= 500) { await esperar(700 * (t + 1)); continue; }
      const j = await r.json().catch(() => null);
      if (!r.ok || !j || j.errors) throw new Error(`core shopify/proxy -> ${r.status} ${JSON.stringify(j?.errors || j?.erro || '').slice(0, 300)}`);
      return j.data;
    }
    throw new Error('core shopify/proxy -> 429/5xx repetido');
  };
}

export const graphqlDoAmbiente = (env, extra = {}) =>
  graphqlPeloCore({ url: env?.CORE_URL, token: env?.CORE_API_TOKEN, ...extra });

/**
 * Variantes do site no formato de `variantesDoShopify` (edge e coletor), lidas pelo proxy.
 * Mesma consulta e mesmas travas de antes: só `tracked`; local com nome trocado lança.
 * `comNome` = o coletor também quer `displayName` (impressão do ensaio).
 */
export async function variantesDoSiteViaCore(graphql, { local, nomeLocal, comNome = false }) {
  const out = [];
  let after = null;
  do {
    const d = await graphql(`query($after:String){ productVariants(first:100, after:$after){
      pageInfo{ hasNextPage endCursor }
      nodes{ sku ${comNome ? 'displayName ' : ''}inventoryItem{ id tracked
        inventoryLevel(locationId:"${local}"){ location{ name } quantities(names:["available"]){ quantity } } } } } }`, { after });
    const pv = d.productVariants;
    for (const v of pv.nodes) {
      if (!v.inventoryItem?.tracked) continue;
      const lvl = v.inventoryItem.inventoryLevel;
      if (lvl && lvl.location?.name !== nomeLocal) throw new Error('o local do Shopify mudou de nome: ' + lvl.location?.name);
      const linha = { sku: v.sku, inventoryItemId: v.inventoryItem.id, noLocal: !!lvl,
                      disponivel: lvl ? lvl.quantities[0]?.quantity ?? 0 : null };
      if (comNome) linha.nome = v.displayName;
      out.push(linha);
    }
    after = pv.pageInfo.hasNextPage ? pv.pageInfo.endCursor : null;
  } while (after);
  return out;
}

// O espelho devolve datas em UTC como 'AAAA-MM-DD HH:MM:SS' (sem fuso).
const isoUtc = (s) => {
  if (!s) return null;
  const t = String(s);
  return /[zZ]|[+-]\d\d:?\d\d$/.test(t) ? t : `${t.replace(' ', 'T')}Z`;
};

/**
 * Pedidos do espelho atualizados desde `desde` (Date), no formato das colunas de
 * `shopify_pedidos` SEM dado pessoal. O espelho não filtra por data (sem `updated_at`):
 * lê tudo (a loja tem poucas centenas de pedidos em 60 dias) e filtra aqui.
 * ponytail: leitura integral por rodada; se o volume crescer, filtrar por status/canal no core.
 */
export async function pedidosDoEspelho(core, { desde } = {}) {
  const { linhas } = await core.todas('shopify_pedidos',
    { campos: ['shopify_id', 'nome', 'status_financeiro', 'total', 'moeda', 'criado_em', 'atualizado_em'] });
  const corte = desde ? desde.getTime() : 0;
  const out = [];
  for (const l of linhas) {
    const criado = isoUtc(l.criado_em);
    if (l.shopify_id == null || !criado) continue;                       // inválido, como pedidoDoPayload
    const att = Date.parse(isoUtc(l.atualizado_em) || criado);
    if (att < corte) continue;
    out.push({
      id: Number(l.shopify_id),
      numero: l.nome ?? null,
      loja_id: LOJA_ID_SHOPIFY,
      total: Number(l.total) || 0,
      moeda: l.moeda || 'BRL',
      status_financeiro: l.status_financeiro || 'pending',
      criado_em_shopify: criado,
    });
  }
  return out;
}

// Grava SEM tocar em cliente_nome/cliente_email/bruto: em linha nova ficam null/'{}' (o webhook
// repassado pelo core, `receber-webhook-pedido-shopify`, preenche); em linha existente ficam como estão.
export const SQL_UPSERT_PEDIDO_SEM_PII = `insert into shopify_pedidos
       (id, numero, loja_id, total, moeda, status_financeiro, cliente_nome, cliente_email, criado_em_shopify, bruto, atualizado_em)
     values ($1,$2,$3,$4,$5,$6,null,null,$7,'{}'::jsonb, now())
     on conflict (id) do update set
       numero = excluded.numero, total = excluded.total, moeda = excluded.moeda,
       status_financeiro = excluded.status_financeiro,
       criado_em_shopify = excluded.criado_em_shopify,
       atualizado_em = now()`;
