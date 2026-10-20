// Produto (detalhe do Bling) lido do ESPELHO DO CORE, sem gastar a cota do Bling (3 req/s dividida
// com todos os apps). Usado pelos robôs do selo: fotos-do-selo-do-bling.mjs e classificar-material-dos-lotes.mjs.
//
// Liga com `CORE_LEITURA_PRODUTO_DETALHE=true`; desligada, os robôs seguem no Bling como sempre.
// Precisa de `bling_produtos_detalhe` na whitelist do espelho (PEDIDO-AO-PLANO-03 de 20/10/2026).
//
// Uma leitura por LISTA de SKUs (em lotes de 50), nunca uma por lote: o balde do Core é 120/min por consumidor.
// Falha de leitura LANÇA (o cliente já tenta 429/5xx de novo); ausência NÃO é falha: o SKU simplesmente
// não aparece no Map e o robô diz "não achei", igual faz com o Bling.
import { ligada, criarClienteCore } from '../../supabase/functions/_shared/core-leitura.js';
import { achatar } from './fotos-do-selo.mjs';

const LOTE = 50;
const MARGEM_DA_VALIDADE_MS = 60 * 60 * 1000;   // imagem que vence em menos de 1 h não dá tempo de baixar

export const leituraDoCoreLigada = (env) => ligada('PRODUTO_DETALHE', env);

/** Consumidor próprio quando houver (`CORE_ESPELHO_TOKEN`, plano 03-G); senão o token de sempre. */
export const clienteDoEspelho = (env, extra = {}) =>
  criarClienteCore({ url: env?.CORE_URL, token: env?.CORE_ESPELHO_TOKEN || env?.CORE_API_TOKEN, ...extra });

const objeto = (d) => (typeof d === 'string' ? JSON.parse(d) : d);

// Os links das imagens do Bling são assinados e têm `validade`. Detalhe velho no Core = link morto.
function imagensVencidas(produto, agora) {
  const internas = produto?.midia?.imagens?.internas;
  if (!Array.isArray(internas)) return false;
  return internas.some((i) => {
    const t = Date.parse(String(i?.validade ?? '').replace(' ', 'T') + 'Z');   // o Bling manda sem fuso (UTC)
    return Number.isFinite(t) && t - agora < MARGEM_DA_VALIDADE_MS;
  });
}

/**
 * Map achatar(sku) -> { id, produto, imagensVencidas } só dos SKUs com UM produto ativo no Core e detalhe
 * guardado. Código repetido com mais de um ativo fica de fora (não adivinha).
 */
export async function produtosDoCorePorSku(core, skus, agora = Date.now()) {
  const unicos = [...new Set(skus.filter(Boolean).map(String))];
  const ativoPorSku = new Map();                    // achatar(codigo) -> id | null (ambíguo)
  for (let i = 0; i < unicos.length; i += LOTE) {
    const { linhas } = await core.todas('produtos_bling',
      { campos: ['id_bling', 'codigo'], id_situacaocadastro: 1, codigo: unicos.slice(i, i + LOTE) });
    for (const p of linhas) {
      const k = achatar(p.codigo);
      ativoPorSku.set(k, ativoPorSku.has(k) ? null : String(p.id_bling));
    }
  }
  const ids = [...new Set([...ativoPorSku.values()].filter(Boolean))];
  const detalhes = new Map();
  for (let i = 0; i < ids.length; i += LOTE) {
    const { linhas } = await core.todas('bling_produtos_detalhe',
      { campos: ['id_bling', 'detalhe'], id_bling: ids.slice(i, i + LOTE) });
    for (const d of linhas) detalhes.set(String(d.id_bling), objeto(d.detalhe));
  }
  const saida = new Map();
  for (const [k, id] of ativoPorSku) {
    const produto = id && detalhes.get(id);
    if (produto) saida.set(k, { id, produto, imagensVencidas: imagensVencidas(produto, agora) });
  }
  return saida;
}

/** O produto de um SKU no mapa de `produtosDoCorePorSku`, ou undefined. */
export const doMapa = (mapa, sku) => mapa.get(achatar(sku));
