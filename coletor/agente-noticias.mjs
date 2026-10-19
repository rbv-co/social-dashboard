#!/usr/bin/env node
// Agente coletor de notícias — roda no GitHub Actions (cron diário).
// Cérebro: Claude (Sonnet 4.6) com a ferramenta de web search — pesquisa,
// julga relevância/recência e resume por marca. Gravação: REST do Supabase (ou pg com REST_VIA_PG=1, plano 03 da virada).
// Observabilidade: grava início/fim na tabela public.coletor_log.
//
// Segredos (via env): ANTHROPIC_API_KEY e, no caminho REST do Supabase, SUPABASE_SERVICE_KEY (em pg: DATABASE_URL).

import { abrirRest } from './lib/rest-pg.mjs';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.COLETOR_MODEL || 'claude-sonnet-4-6';

if (!ANTHROPIC_API_KEY) {
  console.error('✗ Falta ANTHROPIC_API_KEY no ambiente.');
  process.exit(1);
}

const MARCAS = ['Santa Lolla', 'Arezzo&Co', 'Schutz', 'Anacapri', 'Capodarte', 'Luz da Lua', 'Petite Jolie', 'Jorge Bischoff', 'Dumond', 'Carmen Steffens', 'Isla', 'Luiza Barcelos', 'Victor Hugo', "L'Occitane"];
const CATEGORIAS = ['Campanha', 'Estratégia', 'Lançamento', 'Preço/Promo', 'Marketing', 'Design', 'Moda', 'Faturamento', 'Expansão', 'Tendência'];
const HOJE = process.env.RODADA || new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
let R; // aberto no início do main(): banco fora = falha antes de qualquer trabalho

// ── Supabase REST ──
async function sbInsert(path, body, extraPrefer) {
  const headers = { ...R.sb };
  if (extraPrefer) headers.Prefer = extraPrefer;
  const r = await R.fetch(R.REST + path, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!r.ok && r.status !== 201 && r.status !== 200 && r.status !== 204) {
    const t = await r.text();
    throw new Error('Supabase POST ' + path + ' -> ' + r.status + ' ' + t.slice(0, 300));
  }
  return r;
}
async function logColetor(fields) {
  try { await sbInsert('/coletor_log', fields, 'return=minimal'); }
  catch (e) { console.error('aviso: falha ao gravar coletor_log:', e.message); }
}

// ── Anthropic ──
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const baseHeaders = {
  'x-api-key': ANTHROPIC_API_KEY,
  'anthropic-version': '2023-06-01',
  'content-type': 'application/json',
};
const sleep = (ms) => new Promise(res => setTimeout(res, ms));
async function anthropic(body, tentativas = 3) {
  // CUSTO: um timeout re-cobra a web search que o servidor JÁ fez → no máx. 1 retry de timeout.
  // O retry cheio fica só p/ 429/529 (requisição rejeitada, não cobrada).
  let netErros = 0;
  for (let t = 0; t < tentativas; t++) {
    let r;
    try {
      // 300s (era 120s): a busca web da Anthropic às vezes demora quando a conta está lenta.
      // Dar mais tempo pra ela COMPLETAR é melhor até pro custo — um abort por timeout desperdiça
      // a busca que o servidor já cobrou e ainda força um retry (cobra de novo). Esperar mais cobra 1x.
      r = await fetch(ANTHROPIC_URL, { method: 'POST', headers: baseHeaders, body: JSON.stringify(body), signal: AbortSignal.timeout(300000) });
    } catch (netErr) {
      netErros++;
      if (netErros > 1) throw new Error('Anthropic: timeout repetido (conta lenta) — desisto p/ não re-cobrar a web search');
      console.log('    erro de rede (' + netErr.message + '); 1 nova tentativa…');
      await sleep(5000);
      continue;
    }
    if (r.ok) return r.json();
    // 429 (rate limit) ou 529/500 (sobrecarga) → requisição rejeitada (não cobrada) → pode repetir
    if (r.status === 429 || r.status === 529 || r.status >= 500) {
      const ra = parseInt(r.headers.get('retry-after') || '0', 10);
      const espera = (ra > 0 ? ra : Math.min(30, 8 * (t + 1))) * 1000;
      console.log('    rate limit/sobrecarga (' + r.status + '); aguardando ' + (espera / 1000) + 's…');
      await sleep(espera);
      continue;
    }
    const j = await r.json().catch(() => ({}));
    throw new Error('Anthropic ' + r.status + ' ' + JSON.stringify(j).slice(0, 300));
  }
  throw new Error('Anthropic: esgotadas as tentativas');
}

const SCHEMA = {
  type: 'object',
  properties: {
    noticias: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          titulo: { type: 'string' },
          resumo: { type: 'string' },
          categoria: { type: 'string', enum: CATEGORIAS },
          url: { type: 'string' },
          fonte: { type: 'string' },
          data_publicacao: { type: 'string' },
          destaque: { type: 'boolean' },
        },
        required: ['titulo', 'resumo', 'categoria', 'url', 'fonte', 'data_publicacao', 'destaque'],
        additionalProperties: false,
      },
    },
  },
  required: ['noticias'],
  additionalProperties: false,
};

const MKT_ONLY = { "L'Occitane": 'cosméticos/beleza' };  // referências de marketing (não concorrem em bolsa)
function promptPesquisa(marca) {
  if (MKT_ONLY[marca]) {
    return 'Você é analista de inteligência competitiva da Vessel (bolsas femininas), estudando a "' + marca + '" como REFERÊNCIA DE MARKETING — ela é de ' + MKT_ONLY[marca] + ', NÃO concorre em bolsa. '
      + 'Pesquise o que a marca está fazendo AGORA de MARKETING no site e Instagram oficiais (últimos ~60 dias): CAMPANHAS, EMBAIXADORES/celebridades, conceito e ESTRATÉGIA de conteúdo, ações de PROPÓSITO/experiência, lançamentos com forte apelo de marca. '
      + 'NÃO procure "best-sellers" nem produtos de bolsa. Use a busca várias vezes. NUNCA invente — só fontes reais com URL (prefira site/Instagram oficial). '
      + 'Ao terminar, resuma com detalhe a estratégia de marketing + o APRENDIZADO aplicável à Vessel.';
  }
  const ehMercado = marca === 'Mercado';
  if (ehMercado) {
    return 'Você é analista de inteligência competitiva da Vessel (bolsas femininas). '
      + 'Pesquise as tendências MAIS RECENTES do setor de moda/bolsas/calçados no Brasil (priorize os últimos 30 dias): '
      + 'formatos, cores, materiais, design, comportamento de consumo, dados de varejo/faturamento e promoções. '
      + 'Use a busca várias vezes com queries diferentes. NUNCA invente — só fontes reais com URL. Ao terminar, resuma com detalhe.';
  }
  return 'Você é analista de inteligência competitiva da Vessel (bolsas femininas), investigando a marca "' + marca + '" (moda/bolsas/calçados). '
    + 'FOCO PRIMÁRIO (o mais importante): o que a marca está fazendo AGORA no SITE OFICIAL e no INSTAGRAM OFICIAL (@' + marca.toLowerCase().replace(/[^a-z0-9]/g, '') + ' e variações). Investigue: '
    + '(1) CAMPANHAS atuais e posicionamento/ESTRATÉGIA de marketing; '
    + '(2) coleções/LANÇAMENTOS em destaque na home e no feed; '
    + '(3) produtos BEST-SELLERS — os "mais vendidos"/"queridinhos"/mais desejados (procure a seção "mais vendidos" do e-commerce e o que ela mais empurra/repete). '
    + 'FOCO SECUNDÁRIO: notícias gerais recentes (faturamento, expansão, tendências, imprensa). '
    + 'Use a busca várias vezes (site oficial, instagram, "mais vendidos", "campanha 2026", imprensa). '
    + 'NUNCA invente — só fontes reais com URL verificável (prefira o site/Instagram oficial da marca). '
    + 'Ao terminar, RESUMA COM DETALHE o que a marca está fazendo: campanha, estratégia, lançamentos e best-sellers, com o insight competitivo para a Vessel.';
}

function promptEstrutura(marca, notas) {
  return 'Notas de pesquisa sobre "' + marca + '":\n\n' + notas + '\n\n'
    + 'Com base APENAS nessas notas, gere a lista de itens. '
    + 'Para cada item: titulo (curto, sem aspas duplas), '
    + 'resumo DETALHADO (3 a 5 frases que deem um NORTE CLARO do que a marca está fazendo — descreva a campanha/estratégia/lançamento ou o best-seller concreto, e termine com o insight competitivo para a Vessel; não seja genérico), '
    + 'categoria (EXATAMENTE um de: ' + CATEGORIAS.join(', ') + (MKT_ONLY[marca] ? '; como esta marca é referência de MARKETING, use só Campanha/Marketing/Estratégia/Tendência — NUNCA Lançamento' : '') + '), url (link real — PREFIRA o site/Instagram oficial da marca), fonte (nome da fonte/veículo ou "Site oficial"/"Instagram oficial"), '
    + 'data_publicacao (YYYY-MM-DD, a data real; se desconhecida, a mais provável), '
    + 'destaque (true para os itens de FOCO PRIMÁRIO — site/Instagram oficial, campanha, estratégia, best-seller; false para as notícias gerais secundárias). '
    + 'Priorize os itens de foco primário (campanha/estratégia/best-seller do site e IG). Inclua só itens com fonte e URL reais. Se não houver nada relevante, retorne lista vazia.';
}

// Extrai a imagem de capa (og:image/twitter:image) de uma URL. Ignora logos (e-commerce
// costuma devolver o logo da marca como og:image em páginas de categoria). null se não achar.
async function ogImage(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    const html = await r.text();
    const m = html.match(/<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)[^"']*["'][^>]*>/i);
    if (!m) return null;
    const c = m[0].match(/content=["']([^"']+)["']/i);
    const img = c ? c[1] : null;
    if (!img || !/^https?:\/\//.test(img) || /logo/i.test(img)) return null;
    return img.slice(0, 1000);
  } catch (e) { return null; }
}

// Fase 1: loop agêntico de pesquisa (web search). Fase 2: estrutura em JSON a
// partir SÓ do texto-resumo (não reenvia os resultados brutos — economiza tokens
// e respeita o limite de TPM da conta).
async function coletarMarca(marca) {
  const messages = [{ role: 'user', content: promptPesquisa(marca) }];
  const tools = [{ type: 'web_search_20260209', name: 'web_search', max_uses: 2 }]; // 2 buscas/marca (web search = $10/1000; era 3)

  let notas = '';
  for (let i = 0; i < 4; i++) { // teto de turnos agênticos (busca→busca→responde cabe em ~3; era 6)
    const resp = await anthropic({ model: MODEL, max_tokens: 3000, tools, messages });
    messages.push({ role: 'assistant', content: resp.content });
    notas = resp.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
    if (resp.stop_reason === 'pause_turn' || resp.stop_reason === 'tool_use') continue;
    break; // end_turn / max_tokens → pesquisa terminou
  }
  if (!notas.trim()) return [];

  // Passo 2: estruturar em JSON validado — input pequeno (só as notas de texto)
  const estrut = await anthropic({
    model: MODEL,
    max_tokens: 8192,
    messages: [{ role: 'user', content: promptEstrutura(marca, notas) }],
    output_config: { format: { type: 'json_schema', schema: SCHEMA } },
  });
  const txt = (estrut.content.find(b => b.type === 'text') || {}).text || '{"noticias":[]}';
  let parsed;
  try { parsed = JSON.parse(txt); } catch (e) { parsed = { noticias: [] }; }
  const lista = Array.isArray(parsed.noticias) ? parsed.noticias : [];

  // Sanitiza + injeta marca/rodada (não confia no modelo p/ esses campos)
  const out = lista
    .filter(n => n && n.titulo && n.url && CATEGORIAS.includes(n.categoria))
    .filter(n => !(MKT_ONLY[marca] && n.categoria === 'Lançamento'))  // marca só-marketing não vai p/ vista Comercial (escondida)
    .map(n => ({
      marca,
      titulo: String(n.titulo).slice(0, 300),
      resumo: n.resumo ? String(n.resumo).slice(0, 1500) : null,
      categoria: n.categoria,
      url: String(n.url).slice(0, 1000),
      fonte: n.fonte ? String(n.fonte).slice(0, 200) : null,
      data_publicacao: /^\d{4}-\d{2}-\d{2}$/.test(n.data_publicacao || '') ? n.data_publicacao : null,
      rodada: HOJE,
      destaque: !!n.destaque,
    }));
  // Enriquece com a imagem de capa (og:image) de cada matéria
  for (const item of out) { item.imagem_url = await ogImage(item.url); }
  return out;
}

async function main() {
  R = await abrirRest();
  console.log('== Coletor de notícias · rodada ' + HOJE + ' · modelo ' + MODEL + ' ==');
  await logColetor({ fase: 'inicio', detalhe: 'rodada ' + HOJE + ' (' + MODEL + ')' });

  const t0 = Date.now();
  const ORCAMENTO_MIN = parseInt(process.env.COLETOR_ORCAMENTO_MIN || '30', 10); // teto de tempo p/ NÃO queimar crédito se a conta estiver lenta
  let encontradas = 0, inseridas = 0;
  const resumo = [];
  for (const marca of MARCAS) {
    if ((Date.now() - t0) / 60000 > ORCAMENTO_MIN) {
      console.log('  ⏱ teto de ' + ORCAMENTO_MIN + 'min atingido — encerrando a rodada (evita gasto excessivo)');
      resumo.push('(interrompido: teto de tempo)');
      break;
    }
    try {
      const lista = await coletarMarca(marca);
      encontradas += lista.length;
      if (lista.length) {
        await sbInsert('/noticias_concorrentes?on_conflict=marca,titulo,rodada', lista,
          'resolution=ignore-duplicates,return=minimal');
        inseridas += lista.length;
      }
      resumo.push(marca + ': ' + lista.length);
      console.log('  ' + marca + ' → ' + lista.length + ' notícia(s)');
    } catch (e) {
      resumo.push(marca + ': ERRO');
      console.error('  ' + marca + ' → ERRO: ' + e.message);
    }
    await sleep(45000); // espaça as marcas p/ respeitar o limite de tokens/minuto (Tier 1 = 30k/min)
  }

  console.log('== Total: ' + inseridas + ' enviadas (dedupe no banco) ==');
  await logColetor({ fase: 'fim', encontradas, inseridas, erro: null, detalhe: resumo.join(' · ') });
  await R.fechar();
}

main().catch(async (e) => {
  console.error('FALHA GERAL:', e.message);
  await logColetor({ fase: 'fim', erro: e.message.slice(0, 500), detalhe: 'falha geral' });
  process.exit(1);
});
