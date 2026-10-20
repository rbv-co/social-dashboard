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
 * `{ linhas, espelhadoEm, sincronia }`. Falha de leitura LANÇA (nunca devolve lista parcial:
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
    let sincronia = null;           // bloco do core (03-E); null enquanto o core não o manda
    for (let p = 0; p < maxPaginas; p++) {
      const j = await get(`/api/interno/espelho/${tabela}`, { limite: 1000, ...params, cursor });
      if (!Array.isArray(j?.data)) throw new Error(`core ${tabela} sem lista`);
      linhas.push(...j.data);
      espelhadoEm = j.espelhado_em ?? espelhadoEm;
      sincronia = j.sincronia ?? sincronia;
      cursor = j.proximo_cursor;
      if (!cursor) return { linhas, espelhadoEm, sincronia };
    }
    throw new Error(`core ${tabela}: paginas demais (${maxPaginas})`);
  }

  const contagem = (tabela, params) => get(`/api/interno/espelho/${tabela}/contagem`, params);

  return { get, todas, contagem };
}

/**
 * Cliente do ESPELHO a partir do ambiente (`CORE_URL`, e o token do consumidor `central-espelho` em
 * `CORE_ESPELHO_TOKEN` — balde próprio no core —, ou `CORE_API_TOKEN` enquanto ele não existir).
 * Só serve leitura do espelho: bling/proxy e meta/graph seguem com o token de sempre.
 */
export const clienteDoAmbiente = (env, extra = {}) =>
  criarClienteCore({ url: env?.CORE_URL, token: env?.CORE_ESPELHO_TOKEN || env?.CORE_API_TOKEN, ...extra });

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
 * Limite de idade da sincronização POR TABELA: `CORE_ESPELHO_MAX_IDADE_MIN` aceita um número (vale para
 * todas) ou `tabela=min,tabela=min` (com um número solto como padrão), ex.: `estoque_depositos=2160,30`.
 * Vazio/ausente = 0 = sem limite (o estado de antes). Valor torto vira 0: não inventa limite.
 */
export function limiteDeIdadeMin(env, tabela) {
  let padrao = 0;
  for (const parte of String(env?.CORE_ESPELHO_MAX_IDADE_MIN ?? '').split(',').map((x) => x.trim()).filter(Boolean)) {
    const [chave, valor] = parte.includes('=') ? parte.split('=').map((x) => x.trim()) : [null, parte];
    const n = Number(valor);
    if (!Number.isFinite(n) || n < 0) continue;
    if (chave === tabela) return n;
    if (chave === null) padrao = n;
  }
  return padrao;
}

/**
 * A leitura está defasada? Decide pelo bloco `sincronia` do core (03-E): `atrasado`, `ultimo_ok` mais velho
 * que o limite, ou `tempo_real === false` (webhook mudo). SEM o bloco NÃO acusa: `espelhado_em` é só a última
 * mudança de linha, e tabela quieta não é tabela parada. Devolve `{ defasado, motivo }`, nunca lança.
 */
export function idadeDoEspelho(sincronia, { maxIdadeMin = 0, agora = Date.now() } = {}) {
  if (!sincronia) return { defasado: false, semSincronia: true };
  if (sincronia.atrasado === true) return { defasado: true, motivo: 'o core marcou a sincronização como atrasada' };
  if (sincronia.tempo_real === false) return { defasado: true, motivo: 'o core está sem receber evento em tempo real' };
  const t = Date.parse(sincronia.ultimo_ok || '');
  if (maxIdadeMin > 0 && sincronia.ultimo_ok && !Number.isFinite(t)) {
    return { defasado: true, motivo: 'o core mandou `ultimo_ok` ilegível' };   // dado torto não vale como "fresco"
  }
  if (maxIdadeMin > 0 && Number.isFinite(t) && agora - t > maxIdadeMin * 60e3) {
    return { defasado: true, motivo: `última sincronização boa há mais de ${maxIdadeMin} min (${sincronia.ultimo_ok})` };
  }
  return { defasado: false };
}

/**
 * Saldo físico de UM depósito por SKU, do espelho. Devolve Map sku → saldo só dos
 * SKUs que o espelho conhece (produto ativo COM linha de saldo nesse depósito).
 *
 * ⚠️ Diferença de propósito em relação ao Bling: lá "lido e ausente = zero". Aqui
 * ausente = "o espelho não sabe" (produto novo ainda não sincronizado) e o SKU fica
 * FORA do Map, logo INTOCADO no Shopify — nunca vira esgotado por lacuna do espelho.
 *
 * Travas: espelho sem NENHUMA linha do depósito lança (espelho vazio ≠ estoque zero). Idade: o Map vem com
 * `defasado` (boolean) e `motivo` (ver `idadeDoEspelho`); quem PUBLICA decide com isso não gravar. Não lança por
 * idade: defasado é um estado a mostrar, não um erro.
 */
export async function saldoDoDepositoPorSku(core, { skus, depositoId, maxIdadeMin = 0, agora = Date.now() }) {
  const [{ linhas: prods }, { linhas: saldos, sincronia }] = await Promise.all([
    core.todas('produtos_bling', { campos: ['id_bling', 'codigo'], id_situacaocadastro: 1 }),
    core.todas('estoque_depositos', { campos: ['id_bling', 'saldo'], deposito_id: depositoId }),
  ]);
  if (!saldos.length) throw new Error(`core: espelho sem saldos do deposito ${depositoId}`);
  const saldoPorId = new Map(saldos.map((s) => [String(s.id_bling), Number(s.saldo) || 0]));
  const saldo = new Map();
  for (const p of prods) {
    const sku = String(p.codigo || '').trim();
    if (skus.has(sku) && saldoPorId.has(String(p.id_bling))) saldo.set(sku, saldoPorId.get(String(p.id_bling)));
  }
  const idade = idadeDoEspelho(sincronia, { maxIdadeMin, agora });
  saldo.defasado = idade.defasado;
  saldo.motivo = idade.motivo;
  return saldo;
}
