// Leitura do espelho do Bling pelo serviço `core` (GET /api/interno/espelho/{tabela}).
//
// POR QUE EXISTE: o `core` é o dono do espelho do Bling. Em vez de cada robô
// ler produto/saldo direto do Bling (cota de 150/min compartilhada com o ERP),
// ele pode ler do espelho. SOMENTE LEITURA — nada aqui escreve no core nem no Bling.
//
// ⚠️ CADA CONSUMIDOR TEM A PRÓPRIA CHAVE: `CORE_LEITURA_<NOME>=true` liga.
// Ausente ou qualquer outra coisa = DESLIGADO, e o caminho antigo (Bling direto)
// segue idêntico. Token em `CORE_API_TOKEN`, URL em `CORE_URL`
// (padrão https://core.rbvcompany.com). O token nunca vai para mensagem de erro.
//
// Módulo puro (sem Deno/Node): roda na edge e no coletor, e `fetchImpl` é injetável
// para o teste.

export const CORE_URL_PADRAO = 'https://core.rbvcompany.com';

/** `CORE_LEITURA_<nome>` ligada? `env` é um objeto (process.env / Deno.env.toObject()). */
export function ligada(nome, env) {
  const v = String(env?.[`CORE_LEITURA_${nome}`] ?? '').trim().toLowerCase();
  return v === 'true' || v === '1';
}

/** A única decisão flag-ligada/desligada: devolve o que a fonte escolhida devolver. */
export function escolherFonte(nome, env, { bling, core }) {
  return ligada(nome, env) ? core() : bling();
}

const esperarPadrao = (ms) => new Promise((r) => setTimeout(r, ms));

function queryString(params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null) continue;
    if (k === 'campos' && Array.isArray(v)) q.set(k, v.join(','));
    else if (Array.isArray(v)) for (const x of v) q.append(`${k}[]`, String(x));
    else q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

/**
 * Cliente do core. `todas` segue `proximo_cursor` até acabar e devolve
 * `{ linhas, espelhadoEm }`. Falha de leitura LANÇA (nunca devolve lista parcial:
 * quem consome decide estoque com isto), inclusive Core sem responder em `prazoMs`.
 */
export const PRAZO_PADRAO_MS = 30_000;

export function criarClienteCore({ url, token, fetchImpl = globalThis.fetch, esperar = esperarPadrao, prazoMs = PRAZO_PADRAO_MS } = {}) {
  if (!token) throw new Error('CORE_API_TOKEN ausente');
  const base = String(url || CORE_URL_PADRAO).replace(/\/+$/, '');

  async function get(caminho, params) {
    for (let t = 0; t < 4; t++) {
      const r = await fetchImpl(`${base}${caminho}${queryString(params)}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        // Core pendurado = erro em prazo conhecido, não robô parado até o limite do wrapper.
        signal: AbortSignal.timeout(prazoMs),
      });
      if (r.status === 429 || r.status >= 500) { await esperar(700 * (t + 1)); continue; }
      if (!r.ok) throw new Error(`core ${caminho} -> ${r.status}`);
      return r.json();
    }
    throw new Error(`core ${caminho} -> 429/5xx repetido`);
  }

  async function todas(tabela, params = {}, { maxPaginas = 500 } = {}) {
    const linhas = [];
    let cursor = null;
    let espelhadoEm = null;
    for (let p = 0; p < maxPaginas; p++) {
      const j = await get(`/api/interno/espelho/${tabela}`, { limite: 1000, ...params, cursor });
      if (!Array.isArray(j?.data)) throw new Error(`core ${tabela} sem lista`);
      linhas.push(...j.data);
      espelhadoEm = j.espelhado_em ?? espelhadoEm;
      cursor = j.proximo_cursor;
      if (!cursor) return { linhas, espelhadoEm };
    }
    throw new Error(`core ${tabela}: paginas demais (${maxPaginas})`);
  }

  const contagem = (tabela, params) => get(`/api/interno/espelho/${tabela}/contagem`, params);

  return { get, todas, contagem };
}

/** Cliente a partir do ambiente (`CORE_URL`, `CORE_API_TOKEN`). */
export const clienteDoAmbiente = (env, extra = {}) =>
  criarClienteCore({ url: env?.CORE_URL, token: env?.CORE_API_TOKEN, ...extra });

/**
 * Catálogo no formato de `blingProdutos`: { [id_bling]: { nome, codigo, preco } }.
 * Só produtos ativos (`id_situacaocadastro` = 1), como a listagem padrão do Bling.
 */
export async function catalogoDoCore(core) {
  const { linhas } = await core.todas('produtos_bling',
    { campos: ['id_bling', 'codigo', 'descricao', 'preco'], id_situacaocadastro: 1 });
  const prod = {};
  for (const p of linhas) {
    prod[String(p.id_bling)] = { nome: String(p.descricao || '').slice(0, 60), codigo: p.codigo || '', preco: Number(p.preco) || 0 };
  }
  return prod;
}

/**
 * Saldo físico de UM depósito por SKU, do espelho. Devolve Map sku → saldo só dos
 * SKUs que o espelho conhece (produto ativo COM linha de saldo nesse depósito).
 *
 * ⚠️ Diferença de propósito em relação ao Bling: lá "lido e ausente = zero". Aqui
 * ausente = "o espelho não sabe" (produto novo ainda não sincronizado) e o SKU fica
 * FORA do Map, logo INTOCADO no Shopify — nunca vira esgotado por lacuna do espelho.
 *
 * Travas: espelho sem NENHUMA linha do depósito lança (espelho vazio ≠ estoque zero);
 * e, se `maxIdadeMin` > 0, `espelhado_em` (maior updated_at da tabela) mais velho que isso também lança.
 */
export async function saldoDoDepositoPorSku(core, { skus, depositoId, maxIdadeMin = 0, agora = Date.now() }) {
  const [{ linhas: prods }, { linhas: saldos, espelhadoEm }] = await Promise.all([
    core.todas('produtos_bling', { campos: ['id_bling', 'codigo'], id_situacaocadastro: 1 }),
    core.todas('estoque_depositos', { campos: ['id_bling', 'saldo'], deposito_id: depositoId }),
  ]);
  if (!saldos.length) throw new Error(`core: espelho sem saldos do deposito ${depositoId}`);
  if (maxIdadeMin > 0) {
    const t = Date.parse(espelhadoEm || '');
    if (!t || agora - t > maxIdadeMin * 60e3) {
      throw new Error(`core: espelho de estoque parado ha mais de ${maxIdadeMin} min (espelhado_em ${espelhadoEm})`);
    }
  }
  const saldoPorId = new Map(saldos.map((s) => [String(s.id_bling), Number(s.saldo) || 0]));
  const saldo = new Map();
  for (const p of prods) {
    const sku = String(p.codigo || '').trim();
    if (skus.has(sku) && saldoPorId.has(String(p.id_bling))) saldo.set(sku, saldoPorId.get(String(p.id_bling)));
  }
  return saldo;
}
