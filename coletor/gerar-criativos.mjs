#!/usr/bin/env node
// coletor/gerar-criativos.mjs
// F2a: gera criativos (produto De/Por + promo) da última rodada da F1 + campanha.
// Uso: node gerar-criativos.mjs --pct 50 --nome "50% OFF - Sales" [--parcelas 10] [--dry]
//
// Modo "estrela" (F3 task 3b): em vez de ler fabrica_candidatos (F1, tag
// vazia), monta a lista de produtos a partir dos dados REAIS do Gestor
// Comercial (curva ABC/BCG): top faturamento (gc_vendas_item) que TEM
// estoque no depósito da loja (gc_estoque_item). Preço vem do Bling.
// Uso: node gerar-criativos.mjs --pct 50 --nome "Tivoli Estrela" \
//        --estrela 205834140 --deposito 14888726315 [--limite 20] [--dry]
import './lib/carregar-env.mjs';
import { loginServico, blingProdutos } from './lib/bling-comercial.mjs';
import { fotoDataUrl, fotoEhStudio } from './lib/foto-produto.mjs';
import { renderPNG, fecharRender } from './lib/render-criativo.mjs';
import { TEMPLATES, DIM } from './templates-criativos/templates.mjs';
import { variacoesProduto, variacoesPromo, precoDePor, parcelado } from './lib/criativo-modelo.mjs';
import { gerarLookIA, IA_LOOKS } from './hero-ia/hero-ia.mjs';
import { pilulaDeGarantiaDoSku } from './hero-ia/texto-da-garantia.mjs';
import { gerarCopysProduto, gerarCopyPromo } from './lib/copy-efeito.mjs';
import { carregarMarcasELojas } from './lib/config-lojas.mjs';
import { carregarObjetivos, mapaObjetivo, looksDoObjetivo } from './lib/objetivos.mjs';
import { objetivosDoTemplate } from './templates-criativos/templates.mjs';
import { looksAtivosOrdenados } from './lib/looks.mjs';
import { subirStorageResiliente } from './lib/storage-upload.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const URL = process.env.SUPABASE_URL || 'https://kounqtdoioootxqegkij.supabase.co';
const SK = process.env.SUPABASE_SERVICE_KEY;
const REST = URL + '/rest/v1';
const H = { apikey: SK, Authorization: 'Bearer ' + SK, 'Content-Type': 'application/json' };
const BUCKET = 'fabrica-criativos';
const sane = (s) => String(s).replace(/[^a-zA-Z0-9._-]+/g, '_');

// SP-3: o loop de promo usa 'promo-number-hero' (hardcoded em variacoesPromo). Só gera promo
// quando o objetivo permite esse look (ou quando não há objetivo — CLI legado).
export function objetivoPermitePromo(objetivo) {
  if (!objetivo) return true;
  const objs = objetivosDoTemplate('promo-number-hero');
  return objs.length === 0 || objs.includes(objetivo);
}

async function sbGet(p) { const r = await fetch(REST + p, { headers: H }); if (!r.ok) throw new Error('GET ' + p + ' ' + r.status); return r.json(); }
async function sbPost(p, body, prefer) { const r = await fetch(REST + p, { method: 'POST', headers: prefer ? { ...H, Prefer: prefer } : H, body: JSON.stringify(body) }); if (!r.ok && ![200,201,204].includes(r.status)) throw new Error('POST ' + p + ' ' + r.status + ' ' + (await r.text()).slice(0,200)); return r; }

async function garantirBucket() {
  await fetch(URL + '/storage/v1/bucket', { method: 'POST', headers: { apikey: SK, Authorization: 'Bearer ' + SK, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true }) }).catch(() => {});
}
async function subir(path, buf) {
  // Retry com backoff: o proxy do Storage devolve nginx 400/5xx transitório no
  // meio de lotes grandes; sem retry, 1 blip matava o job inteiro (perdendo até
  // os criativos já subidos). Ver lib/storage-upload.mjs.
  return subirStorageResiliente({
    url: URL, sk: SK, bucket: BUCKET, path, buf,
    contentType: path.endsWith('.mp4') ? 'video/mp4' : 'image/png',   // mp4 (motion) sobe com o tipo certo
    onRetry: (t, e) => console.warn(`  [storage retry ${t}/9] ${path.split('/').pop()}: ${e.message.slice(0, 60)}`),
  });
}

// Modo estrela: top faturamento (gc_vendas_item) do canal, cruzado com
// estoque>0 (gc_estoque_item) do depósito, com preço resolvido no Bling.
async function candidatosEstrela(token, canalLojaId, depositoId, limite) {
  const vendas = await sbGet(`/gc_vendas_item?select=sku,produto,faturamento&canal_loja_id=eq.${canalLojaId}`);
  const fatPorSku = new Map();
  const nomePorSku = new Map();
  for (const v of vendas) {
    if (!v.sku) continue;
    const fat = Number(v.faturamento) || 0;
    fatPorSku.set(v.sku, (fatPorSku.get(v.sku) || 0) + fat);
    if (!nomePorSku.has(v.sku)) nomePorSku.set(v.sku, v.produto);
  }

  const estoque = await sbGet(`/gc_estoque_item?select=sku,saldo&deposito_id=eq.${depositoId}`);
  const saldoPorSku = new Map();
  for (const e of estoque) {
    if (!e.sku) continue;
    const saldo = Number(e.saldo) || 0;
    saldoPorSku.set(e.sku, (saldoPorSku.get(e.sku) || 0) + saldo);
  }

  const ranked = [...fatPorSku.entries()]
    .filter(([sku, fat]) => fat > 0 && (saldoPorSku.get(sku) || 0) > 0)
    .sort((a, b) => b[1] - a[1]);

  console.log('estrela:', ranked.length, 'SKUs com faturamento + estoque no canal/depósito');

  const prodMap = await blingProdutos(token);
  const precoPorCodigo = new Map();
  for (const p of Object.values(prodMap)) {
    if (p.codigo) precoPorCodigo.set(String(p.codigo).toUpperCase(), p.preco);
  }

  const out = [];
  for (const [sku, fat] of ranked) {
    if (out.length >= limite) break;
    const preco = precoPorCodigo.get(String(sku).toUpperCase());
    if (preco == null || !(preco > 0)) { console.log('  sem preço no Bling, pulado:', sku); continue; }
    out.push({ id: null, sku, nome: nomePorSku.get(sku) || sku, preco, deposito_id: depositoId, faturamento: fat });
  }
  return out;
}

// Modo lista explícita (Estúdio): resolve nome/preço via mapas Bling
// (codigo.toUpperCase()->preco e ->nome descritivo). O NOME descritivo é essencial:
// gerarCopysProduto extrai a cidade dele ("Bolsa Executiva Grande Pisa Panacota" -> "Bolsa Pisa").
// Sem ele (fallback pro SKU), o criativo saía com "LV1159-Panacota" no lugar do nome. id=null
// (não há candidato). Pula sem preço.
export function candsDeItens(itens, precoPorCodigo, nomePorCodigo = {}) {
  return (itens || []).map((it) => {
    const cod = String(it.sku).toUpperCase();
    const preco = precoPorCodigo[cod];
    if (preco == null) return null;
    return { id: null, sku: it.sku, nome: nomePorCodigo[cod] || it.sku, preco, deposito_id: it.deposito, pct: it.pct };
  }).filter(Boolean);
}

// Monta a linha de fabrica_criativos de um criativo de produto. Pura (sem I/O) p/ teste.
// storage_path/url são acrescentados no run() (dependem do upload).
export function linhaCriativoProduto({ campanhaId, cand, v, url, storagePath, legenda }) {
  return {
    campanha_id: campanhaId, sku: cand.sku, arquetipo: 'produto',
    template: v.template, formato: v.formato, variante: v.variante,
    preco_de: v.preco_de, preco_por: v.preco_por,
    storage_path: storagePath, url, legenda: legenda || null,
  };
}

// Looks que EXIGEM uma foto de modelo/humana (usam dados.modeloFotoUrl, não o recorte
// do produto). Sem foto de modelo real, o look sai com <img src="undefined"> (um criativo
// "de modelo" sem modelo). Enquanto não há IA generativa pra criar a foto, esses looks são
// pulados quando o SKU não tem foto de modelo. Ver fotos-modelo-map.json.
export const MODEL_LOOKS = ['produto-modelo'];
export function filtraLooksModelo(looks, temFotoModelo) {
  if (temFotoModelo) return looks;
  return (looks || []).filter((l) => !MODEL_LOOKS.includes(l));
}
// Mapa SKU -> URL da foto de modelo (fotos-modelo-map.json ao lado deste arquivo).
function carregarMapaModelo() {
  try {
    const p = join(dirname(fileURLToPath(import.meta.url)), 'fotos-modelo-map.json');
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch (e) { console.warn('aviso: fotos-modelo-map.json indisponível:', e.message); return {}; }
}

export async function run({
  pct = 50, nome = null, parcelas = 10, limite = null, dry = false,
  loja = null, fonte = null, estrela = null, deposito = null, looks = null, modos = null, itens = null, campanhaId = null,
  heroIa = false, heroIaMax = null,
  objetivo = null,
} = {}) {
  const PCT = Number(pct);
  const NOME = nome || (PCT + '% OFF');
  const PARCELAS = Number(parcelas);
  const DRY = !!dry;
  const LOJA = loja;
  const FONTE = fonte;
  const ESTRELA_CANAL = estrela;
  const ESTRELA_DEPOSITO = deposito;
  let heroIaLooks = heroIa ? ['hero-ia'] : [];   // looks IA a rodar: --hero-ia/params.heroIa + looks IA ativos (curadoria)
  // Teto de GERAÇÕES gpt-image por LOTE (job). Medido: ~4,5min/geração + o MP4 (motion) do 16:9.
  // 6 gerações ≈ 27min + motion + deps ≈ 38min, folga segura no timeout de 45min do Action (com 10 o
  // lote chegou a 43min — perto demais). Ao atingir o teto, o runner encadeia o próximo lote sozinho
  // (idempotência retoma). Ajuste via HERO_IA_MAX/param heroIaMax.
  const orcamentoIA = { restante: Number(heroIaMax ?? process.env.HERO_IA_MAX ?? 6) };
  // sem --limite (limite null): Infinity no modo normal, 20 candidatos no modo estrela
  const LIMITE = limite == null ? Infinity : Number(limite);
  const ESTRELA_LIMITE = limite == null ? 20 : Number(limite);

  // --looks produto-heroi,produto-sage-circulo  |  --modos avista,parcelado
  // (opts.looks/opts.modos podem chegar como string "a,b" via CLI, ou já
  // como array quando run() é chamado programaticamente)
  const LOOKS = looks == null ? null
    : Array.isArray(looks) ? looks
    : String(looks).split(',').map(s => s.trim()).filter(Boolean);
  const MODOS_MAP = { avista: false, parcelado: true };
  const MODOS = modos == null ? null
    : Array.isArray(modos) ? modos.map(m => typeof m === 'boolean' ? m : MODOS_MAP[m])
    : String(modos).split(',').map(s => s.trim()).filter(Boolean).map(s => MODOS_MAP[s]);
  const opts = {};
  if (LOOKS && LOOKS.length) opts.looks = LOOKS;
  if (MODOS && MODOS.length) opts.modos = MODOS;

  // SP-5A: os looks vêm de fabrica_looks (ativos, curados). Só filtra por objetivo quando o
  // chamador não passou --looks explícito. Soft-fail: tabela indisponível/vazia (unseeded) cai no
  // fallback SP-3; tabela POVOADA mas sem look ativo p/ o objetivo => semLooks (respeita "desligar
  // tudo": não gera nada em vez de regerar os desativados via fallback). Ver follow-up do review final.
  let semLooks = false;
  if (!(LOOKS && LOOKS.length)) {
    // Leitura RESILIENTE da curadoria. Uma falha de rede transitória NÃO pode cair no fallback
    // SP-3 (que ignora `ativo` e geraria os looks DESATIVADOS) — era assim que looks desligados
    // vazavam pra geração. Retry; se ainda falhar, ABORTA o job (o usuário re-dispara) em vez de
    // gerar em silêncio o que foi desligado. SP-3 só vale p/ tabela genuinamente VAZIA (fresh install).
    let fabricaLooks = null, leu = false;
    for (let t = 1; t <= 4 && !leu; t++) {
      try { fabricaLooks = await sbGet('/fabrica_looks?select=chave,objetivos,ativo,excluido,ordem,tipo&order=ordem'); leu = true; }
      catch (e) {
        if (t === 4) throw new Error('fabrica_looks indisponível após 4 tentativas — abortando p/ NÃO gerar looks desativados (curadoria não confirmada): ' + e.message);
        console.warn(`  [fabrica_looks retry ${t}/3] ${String(e.message).slice(0, 60)}`);
        await sleep(Math.min(600 * t, 4000));
      }
    }
    const povoada = Array.isArray(fabricaLooks) && fabricaLooks.length > 0;
    if (povoada) {
      const ativosTodos = looksAtivosOrdenados(fabricaLooks, objetivo);
      heroIaLooks = [...new Set([...heroIaLooks, ...ativosTodos.filter((k) => IA_LOOKS[k])])];   // looks IA curados (galeria)
      const ativos = ativosTodos.filter((k) => TEMPLATES[k]); // só code-looks conhecidos
      if (ativos.length) opts.looks = ativos;
      else semLooks = true; // povoada, nada ativo p/ este objetivo -> não gera (respeita "desligar tudo")
    } else if (objetivo) {
      // Tabela genuinamente VAZIA (leitura OK, 0 linhas = unseeded/fresh install): fallback SP-3.
      try {
        const { porChave } = await carregarObjetivos(sbGet);
        const row = mapaObjetivo(porChave, objetivo);
        const looksDisponiveis = Object.keys(TEMPLATES).filter((k) => { const o = objetivosDoTemplate(k); return o.length === 0 || o.includes(objetivo); });
        const permitidos = looksDoObjetivo(row, looksDisponiveis);
        if (permitidos.length) opts.looks = permitidos;
      } catch (e) {
        console.warn('aviso: fallback SP-3 (fabrica_objetivos) indisponível, sem filtro por objetivo:', e.message);
      }
    }
  }

  // Curadoria "desligou tudo" p/ este objetivo: nada a renderizar. Curto-circuita ANTES de
  // loginServico/Bling/gerarCopysProduto (que faz chamada LLM por produto) — não queima IA à toa.
  if (semLooks && !heroIaLooks.length) { console.log('nenhum look ativo p/ o objetivo — nada gerado'); return { campanhaId, criativos: 0, novas: 0, incompleto: false }; }

  const token = await loginServico();

  let cands;
  if (itens?.length) {
    const prodMap = await blingProdutos(token);          // id -> {nome, codigo, preco}
    const precoPorCodigo = {};
    const nomePorCodigo = {};
    for (const p of Object.values(prodMap)) if (p.codigo) {
      const cod = String(p.codigo).toUpperCase();
      precoPorCodigo[cod] = p.preco;
      if (p.nome) nomePorCodigo[cod] = p.nome;
    }
    cands = candsDeItens(itens, precoPorCodigo, nomePorCodigo);
    console.log('itens | candidatos (lista explícita):', cands.length);
    for (const c of cands) console.log('  ', c.sku, '| R$', c.preco, '| pct', c.pct, '|', c.deposito_id);
  } else if (ESTRELA_CANAL) {
    if (!ESTRELA_DEPOSITO) throw new Error('--estrela requer --deposito');
    cands = await candidatosEstrela(token, ESTRELA_CANAL, ESTRELA_DEPOSITO, ESTRELA_LIMITE);
    console.log('estrela | candidatos (top faturamento c/ estoque):', cands.length);
    for (const c of cands) console.log('  ', c.sku, '| R$', c.preco, '| fat R$', c.faturamento.toFixed(2), '|', c.nome);
  } else {
    // F1 aposentada — fabrica_rodadas/fabrica_candidatos foram dropadas na
    // migration 019. Os únicos caminhos vivos são itens (Estúdio) e --estrela.
    throw new Error('gerar-criativos: forneça itens (modo Estúdio) ou --estrela <canal> --deposito <dep>');
  }

  // objetivo vira contexto de tom pra gerarCopysProduto/gerarCopyPromo (copy-efeito);
  // sem mudança obrigatória lá — o campo existe no objeto, uso é best-effort.
  const campanha = { desconto_tipo: 'fixo', desconto_pct: PCT, parcelas: PARCELAS, objetivo };

  // Marca ativa (fabrica_marcas.ativo) — parametriza o prompt do copy/legenda. O dedup dos
  // criativos é por sku (1 arte por produto, não por loja), então a marca aqui é a marca ativa
  // do momento (há 1 hoje), não a marca de um depósito específico. Resolvida em soft-fail: se
  // não vier, gerarCopysProduto cai no default ("a marca") — não quebra o gerar.
  try {
    const { marcaAtiva } = await carregarMarcasELojas(sbGet);
    campanha.marca = marcaAtiva?.nome || null;
  } catch (e) {
    console.warn('aviso: marca não resolvida (segue com default):', e.message);
    campanha.marca = null;
  }

  // campanha: quando o trigger já criou a rodada (SP-2), usa ela; senão cria (CLI legado).
  if (!DRY) {
    if (!campanhaId) {
      const c = await sbPost('/fabrica_campanhas', [{ nome: NOME, desconto_tipo: 'fixo', desconto_pct: PCT, parcelas: PARCELAS }], 'return=representation');
      campanhaId = (await c.json())[0].id;
    }
    await garantirBucket();
  }

  // produtos únicos por sku (arte é por produto, não por loja), limitados por --limite
  const vistos = new Set();
  const produtosUnicos = [];
  for (const c of cands) {
    if (c.sku && vistos.has(c.sku)) continue;
    if (c.sku) vistos.add(c.sku);
    produtosUnicos.push(c);
  }
  const produtos = produtosUnicos.slice(0, LIMITE);
  console.log('produtos únicos:', produtosUnicos.length, '| gerando para:', produtos.length);

  // copy de efeito em lote (uma chamada pros produtos + uma pra promo)
  // passa o pct POR ITEM (cand.pct) — a legenda usa o desconto do próprio SKU, igual à arte
  const copys = await gerarCopysProduto(produtos.map(c => ({ sku: c.sku, nome: c.nome, pct: c.pct ?? campanha.desconto_pct })), campanha);
  const copyPromo = await gerarCopyPromo(campanha);
  console.log('copy promo:', copyPromo);

  let gerados = 0;
  // Idempotência p/ geração em LOTES (auto-encadeada): storage_paths já gerados nesta campanha. Cada
  // lote pula o que já existe (não regenera nem gasta gpt) e faz o próximo pedaço — retoma do zero
  // sem duplicar. `incompletoIA` sinaliza que o teto do lote foi atingido com trabalho restante.
  const existentesIA = new Set();
  if (!DRY && campanhaId) {
    try { for (const r of await sbGet(`/fabrica_criativos?select=storage_path&campanha_id=eq.${campanhaId}`)) if (r.storage_path) existentesIA.add(r.storage_path); }
    catch (e) { console.warn('aviso: não listou existentes p/ idempotência:', e.message); }
  }
  let incompletoIA = false, novasIA = 0;
  const pulados = []; // SKUs pulados + motivo (p/ o runner avisar quando 0 criativos)
  // dedup de foto por sku (produtos iguais em lojas diferentes)
  const fotoCache = new Map();
  const fotoDe = async (sku) => { if (!fotoCache.has(sku)) fotoCache.set(sku, await fotoDataUrl(token, sku)); return fotoCache.get(sku); };

  const mapaModelo = carregarMapaModelo();
  const looksBase = opts.looks && opts.looks.length ? opts.looks : ['produto-heroi'];

  // PRODUTO (pulado inteiro se nenhum look ativo p/ o objetivo — respeita a curadoria)
  for (const cand of produtos) {
    if (semLooks && !heroIaLooks.length) { console.log('  nenhum look ativo p/ o objetivo — nada gerado'); break; }
    if (cand.preco == null) { console.log('  sem preço:', cand.sku); pulados.push({ sku: cand.sku, motivo: 'sem preço no Bling' }); continue; }
    const foto = await fotoDe(cand.sku);
    if (!foto) { console.warn('  sem foto:', cand.sku, cand.nome); pulados.push({ sku: cand.sku, motivo: 'sem foto no Bling' }); continue; }
    if (!fotoEhStudio(cand.sku)) { console.log('  foto amadora (avaliada na foto crua), pulado:', cand.sku); pulados.push({ sku: cand.sku, motivo: 'foto amadora (não é de estúdio)' }); continue; }
    const copyInfo = copys.get(cand.sku) || {};
    // LOOKS DE CÓDIGO — só quando há look de código ativo. hero-ia roda à parte (abaixo).
    if (!semLooks) {
      // Sem foto de modelo real p/ este SKU, pula os looks que exigem modelo (produto-modelo).
      const modeloUrl = mapaModelo[cand.sku] || null;
      const looksCand = filtraLooksModelo(looksBase, !!modeloUrl);
      if (!looksCand.length) console.log('  só look de modelo, mas sem foto de modelo — pulado:', cand.sku);
      else for (const v of variacoesProduto({ ...cand, fotoDataUrl: foto }, campanha, { ...opts, looks: looksCand }, cand.pct ?? campanha.desconto_pct)) {
      v.dados.copyEfeito = copyInfo.copy;
      v.dados.nome = copyInfo.nome;
      if (v.template === 'produto-modelo') { v.dados.modeloFotoUrl = modeloUrl; v.dados.varianteCor = v.dados.varianteCor || 'sage'; }
      const html = TEMPLATES[v.template].render(v.dados, v.formato);
      const buf = await renderPNG(html, DIM[v.formato]);
      gerados++;
      if (DRY) { console.log('  [dry] produto', cand.sku, v.variante, v.formato, buf.length, 'bytes'); continue; }
      const path = `${campanhaId}/produto/${sane(cand.sku)}-${sane(v.variante)}-${v.formato}.png`;
      const url = await subir(path, buf);
      // candidato_id foi removido de fabrica_criativos na migration 019 (F1 aposentada — cand.id
      // já vinha sempre null no modo lista/estrela, que são os únicos caminhos vivos). Mandar essa
      // chave pro PostgREST com a coluna inexistente quebraria o insert em TODO job de verdade.
      await sbPost('/fabrica_criativos', [linhaCriativoProduto({
        campanhaId, cand, v, url, storagePath: path, legenda: copyInfo.legenda,
      })], 'return=minimal');
      }
    }

    // Motor Hero-IA (fonte ADITIVA): roda cada look IA ativo (galeria) e/ou 'hero-ia' via --hero-ia/params.heroIa.
    // Não toca nos looks de código; preço vem do MESMO `dados` (Bling). Publica com template = a chave do look IA.
    if (heroIaLooks.length && !DRY && foto) {
      const pct = cand.pct ?? campanha.desconto_pct ?? 0;
      const pp = precoDePor(cand.preco, pct);
      // Pílula de garantia (decisão do dono, 18/09/2026): pelo material do LOTE mais
      // recente do SKU (canvas 2 anos, couro 6 meses). Sem material, ou se a busca
      // falhar (rede/banco), sai `null` e a arte é gerada SEM pílula — nunca chuta
      // "2 anos". Ver coletor/hero-ia/texto-da-garantia.mjs.
      const garantiaTexto = await pilulaDeGarantiaDoSku(cand.sku, sbGet);
      const dados = {
        name: String(copyInfo.nome || cand.nome || cand.sku).toUpperCase(),
        camp: 'NOVA COLEÇÃO', tagline: 'ELEGÂNCIA ATEMPORAL',
        precoDe: pp.de, precoPor: pp.por, parcelado: parcelado(pp.porNum, campanha.parcelas),
        parcelas: campanha.parcelas, pct: Math.round(pct), bagDataUrl: foto,
        preco_de: cand.preco, preco_por: pp.porNum,
        modeloFotoUrl: mapaModelo[cand.sku] || null, // foto REAL da modelo+bolsa (acervo); looks de modelo
        // IA só rodam com ela — a imagem da modelo não pode ser gerada por IA. Sem ela: só looks de bolsa.
        garantiaTexto,
      };
      for (const lk of heroIaLooks) {
        try {
          const r = await gerarLookIA(lk, { sku: sane(cand.sku), campanhaId, dados, subir, orcamento: orcamentoIA, existentes: existentesIA,
            inserirLinhas: (rows) => sbPost('/fabrica_criativos', rows, 'return=minimal') });
          gerados += r.ok; novasIA += r.novas || 0; if (r.cortou) incompletoIA = true;
        } catch (e) { console.warn('  ' + lk + ' falhou p/', cand.sku, e.message); }
      }
    }
  }

  // PROMO (usa a 1ª foto disponível como símbolo)
  const primeiraFoto = [...fotoCache.values()].find(Boolean) || null;
  const promoAtivo = !semLooks && (!opts.looks || opts.looks.includes('promo-number-hero'));
  if (primeiraFoto && objetivoPermitePromo(objetivo) && promoAtivo) {
    for (const v of variacoesPromo(campanha, primeiraFoto, 'Coleção')) {
      v.dados.copyEfeito = copyPromo;
      const html = TEMPLATES[v.template].render(v.dados, v.formato);
      const buf = await renderPNG(html, DIM[v.formato]);
      gerados++;
      if (DRY) { console.log('  [dry] promo', v.variante, v.formato, buf.length, 'bytes'); continue; }
      const path = `${campanhaId}/promo/${sane(v.variante)}-${v.formato}.png`;
      const url = await subir(path, buf);
      // promo: copyPromo é a linha CURTA da arte (~40 chars), não um texto de anúncio persuasivo —
      // deixa legenda null pra o subir cair na legenda de marca (fallback) nesse criativo.
      await sbPost('/fabrica_criativos', [{ campanha_id: campanhaId, arquetipo: 'promo', template: v.template, formato: v.formato, variante: v.variante, storage_path: path, url, legenda: null }], 'return=minimal');
    }
  }

  await fecharRender();
  console.log(DRY ? `\n(--dry) geraria ${gerados} criativos.` : `\ngerado: ${gerados} criativos | campanha ${campanhaId}` + (incompletoIA ? ` | LOTE PARCIAL (+${novasIA} gpt) — encadeia próximo` : ''));
  return { campanhaId, criativos: gerados, novas: novasIA, incompleto: incompletoIA, pulados };
}

function flag(f, d) { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; }
if (import.meta.url === `file://${process.argv[1]}`) {
  run({
    pct: Number(flag('--pct', 50)), nome: flag('--nome', null),
    parcelas: Number(flag('--parcelas', 10)), limite: flag('--limite') ? Number(flag('--limite')) : null,
    dry: process.argv.includes('--dry'), loja: flag('--loja', null), fonte: flag('--fonte', null),
    estrela: flag('--estrela', null), deposito: flag('--deposito', null),
    looks: flag('--looks', null), modos: flag('--modos', null),
    heroIa: process.argv.includes('--hero-ia'), heroIaMax: flag('--hero-ia-max') ? Number(flag('--hero-ia-max')) : null,
  }).then((r) => console.log('gerar concluído:', r)).catch(async (e) => { await fecharRender(); console.error('FALHOU:', e.message); process.exit(1); });
}
