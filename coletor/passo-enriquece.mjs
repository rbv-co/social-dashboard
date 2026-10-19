// PASSO 4 do agente semanal: enriquecimento LLM (híbrido).
// A) Desenvolvimento + hero comercial (Sonnet)  B) análise por post (Sonnet)  C) resumos de módulo (Opus).
// Lê o que os passos 1-3 já gravaram na rodada. Idempotente. RODADA = env ou hoje (BR).
import fs from 'fs';
import { structured, SONNET, OPUS, usageSummary } from './lib-llm.mjs';
import { registrarExecucao } from './registrar-execucao.mjs';
import { abrirRest } from './lib/rest-pg.mjs';
const _t0 = Date.now();

const env = {};
try { for (const l of fs.readFileSync(new URL('./.env', import.meta.url), 'utf8').split('\n')) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ''); } } catch (e) {}
if (!process.env.ANTHROPIC_API_KEY && env.ANTHROPIC_API_KEY) process.env.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY;
const RODADA = process.env.RODADA || new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
// REST_VIA_PG=1 (plano 03 da virada): o mesmo caminho vira SQL no api-db; sem a flag segue o REST do Supabase.
const R = await abrirRest({ ...env, ...process.env }).catch((e) => { console.error('✗ ' + e.message); process.exit(1); });
async function rest(method, path, body, prefer = 'return=representation') {
  const r = await R.fetch(R.REST + '/' + path, { method, headers: { ...R.sb, Prefer: prefer }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); if (!r.ok) throw new Error(method + ' ' + path + ' → ' + r.status + ' ' + t.slice(0, 160)); return t ? JSON.parse(t) : null;
}
const get = p => rest('GET', p);
const prods = n => Array.isArray(n && n.produtos) ? n.produtos : [];
const base = { url: null, fonte: 'RBV · Observatório', data_publicacao: RODADA, rodada: RODADA, destaque: false, imagem_url: null, produtos: null, resumo: null };
const IG_CATS = ['Top Viral', 'Últimos Posts', 'Reels'];

const all = await get(`noticias_concorrentes?rodada=eq.${RODADA}&select=id,marca,categoria,titulo,resumo,produtos,destaque,url`);
if (!all.length) { console.error('✗ nada na rodada ' + RODADA + ' — rode os passos 1-3 antes.'); process.exit(1); }
const byMarca = {}; for (const r of all) (byMarca[r.marca] = byMarca[r.marca] || []).push(r);
const marcas = Object.keys(byMarca);
console.log(`PASSO enriquece · rodada ${RODADA} · ${marcas.length} marcas · Sonnet=${SONNET} Opus=${OPUS}`);

const fmtP = p => (p.nome || '').slice(0, 60) + (p.preco ? ' (R$' + p.preco + ')' : '');
const igUnique = rs => { const m = {}; for (const r of rs) for (const p of prods(r)) { if (p.url && !m[p.url]) m[p.url] = p; } return Object.values(m); };
const topViralImg = rs => { const tv = rs.find(r => r.categoria === 'Top Viral'); return (tv && prods(tv)[0] && prods(tv)[0].img) || null; };

let okA = 0, okB = 0, okC = 0;
for (const marca of marcas) {
  const rs = byMarca[marca];
  const best = prods(rs.find(r => r.categoria === 'Best-seller'));
  const nov = prods(rs.find(r => r.categoria === 'Lançamento'));
  const editoriais = rs.filter(r => prods(r).length === 0 && !/^resumo/i.test(r.categoria) && r.categoria !== 'Desenvolvimento');
  const igRows = rs.filter(r => IG_CATS.includes(r.categoria));
  const igPosts = igUnique(igRows);
  const ehProduto = best.length > 0;

  // RETOMÁVEL / ANTI-DESPERDÍCIO: se a marca JÁ está completa nesta rodada (tem os resumos que
  // a verificação exige), pula a marca INTEIRA — não re-chama Sonnet nem Opus, não re-cobra a
  // busca web. É o que faz um RE-DISPARO custar só a(s) marca(s) que faltou (ex.: só a Victor
  // Hugo que deu timeout), e não as 12 de novo. Critério "completa" = igual ao passo-verifica:
  // Resumo Marketing (todas) + Resumo Comercial (só as marcas com loja/produto).
  // Forçar refazer tudo: rodar com REFAZER_RESUMOS=1.
  if (!process.env.REFAZER_RESUMOS) {
    const temM = rs.some(r => r.categoria === 'Resumo Marketing');
    const temC = rs.some(r => r.categoria === 'Resumo Comercial');
    if (temM && (!ehProduto || temC)) {
      console.log(`  ⏭ ${marca}: já enriquecida nesta rodada — pulando (economiza a busca web/Opus)`);
      continue;
    }
  }

  // ── A) Desenvolvimento + hero comercial (Sonnet) — só p/ marcas com loja ──
  if (ehProduto) {
    try {
      const ctx = `MARCA: ${marca}\nBEST-SELLERS: ${best.slice(0, 12).map(fmtP).join(' · ')}\nNOVIDADES: ${nov.slice(0, 10).map(fmtP).join(' · ')}\nEDITORIAIS (manchetes da semana): ${editoriais.map(e => e.categoria + ': ' + e.titulo).join(' | ') || '—'}\nINSTAGRAM (legendas recentes): ${igPosts.slice(0, 6).map(p => (p.nome || '').slice(0, 100)).join(' || ')}`;
      const out = await structured({
        model: SONNET, maxTokens: 1200,
        system: 'Você é analista de inteligência competitiva da marca de bolsas Vessel. Escreve PT-BR, direto, sem emoji.',
        user: `Com base nos dados da concorrente abaixo, escreva o HERO da vista "Comercial & Desenvolvimento": uma leitura de PRODUTO (faixa de preço, modelos, materiais, no que a marca aposta) E, explicitamente, a ESTRATÉGIA DE CAMPANHA/AÇÃO COMERCIAL atual a partir do site + Instagram (coleção, drop, embaixadora, data comercial). Texto corrido (prosa, SEM markdown), 4-6 frases, terminando com uma "Leitura p/ Vessel:". Título curto e específico (ex.: "Acessível e sintético: campeãs de R$X a R$Y").\n\n${ctx}`,
        schema: { type: 'object', properties: { titulo: { type: 'string' }, resumo: { type: 'string' } }, required: ['titulo', 'resumo'] },
      });
      const row = { ...base, marca, categoria: 'Desenvolvimento', destaque: true, titulo: String(out.titulo).slice(0, 200), resumo: String(out.resumo), imagem_url: topViralImg(rs) || (best[0] && best[0].img) || null };
      await rest('DELETE', `noticias_concorrentes?marca=eq.${encodeURIComponent(marca)}&rodada=eq.${RODADA}&categoria=eq.Desenvolvimento`);
      await rest('POST', 'noticias_concorrentes', [row]);
      okA++;
    } catch (e) { console.log(`  ✗ A ${marca}: ${String(e).slice(0, 120)}`); }
  }

  // ── B) análise por post (Sonnet) ──
  if (igPosts.length) {
    try {
      const lista = igPosts.map((p, i) => `${i + 1}. url=${p.url} | tipo=${p.tipo || 'imagem'} | ❤${p.curtidas ?? '?'} 💬${p.comentarios ?? '?'} | ${(p.nome || '').slice(0, 200)}`).join('\n');
      const out = await structured({
        model: SONNET, maxTokens: 4096,
        system: 'Você é analista de inteligência competitiva da marca de bolsas Vessel. Escreve PT-BR, sem emoji.',
        user: `Para CADA post do Instagram da concorrente ${marca} abaixo, escreva uma ANÁLISE de 1 frase (12-22 palavras) explicando por que engajou e/ou o que a marca faz de marketing ali (embaixadora, ícone de produto, data comercial, formato/reel, preço/CTA, estética, collab). Específico, útil pro time comercial. Devolva um item por post com a url idêntica.\n\n${lista}`,
        schema: { type: 'object', properties: { itens: { type: 'array', items: { type: 'object', properties: { url: { type: 'string' }, analise: { type: 'string' } }, required: ['url', 'analise'] } } }, required: ['itens'] },
      });
      const map = {}; for (const it of (out.itens || [])) if (it.url && it.analise) map[it.url] = String(it.analise);
      let patched = 0;
      for (const r of igRows) {
        let chg = false; const np = prods(r).map(p => { if (p.url && map[p.url]) { chg = true; return { ...p, analise: map[p.url] }; } return p; });
        if (chg) { await rest('PATCH', `noticias_concorrentes?id=eq.${r.id}`, { produtos: np }); patched++; }
      }
      if (patched) okB++;
    } catch (e) { console.log(`  ✗ B ${marca}: ${String(e).slice(0, 120)}`); }
  }

  // ── C) resumos de módulo (Opus) ──
  try {
    const viral = igRows.find(r => r.categoria === 'Top Viral');
    const engLeaders = prods(viral || {}).slice(0, 5).map(p => `❤${p.curtidas ?? '?'}/💬${p.comentarios ?? '?'}: ${(p.nome || '').slice(0, 90)}`).join(' | ');
    const ctxC = `MARCA: ${marca}${ehProduto ? '' : ' (monitorada SÓ em Marketing — não concorre em bolsa)'}\n` +
      `BEST-SELLERS: ${best.slice(0, 12).map(fmtP).join(' · ') || '—'}\nNOVIDADES: ${nov.slice(0, 10).map(fmtP).join(' · ') || '—'}\n` +
      `EDITORIAIS/MANCHETES: ${editoriais.map(e => e.categoria + ': ' + e.titulo + (e.resumo ? ' — ' + String(e.resumo).slice(0, 160) : '')).join(' | ') || '—'}\n` +
      `INSTAGRAM (mais engajados): ${engLeaders || '—'}`;
    const out = await structured({
      model: OPUS, maxTokens: 4096,
      system: 'Você é analista sênior de inteligência competitiva da marca de bolsas Vessel. PT-BR, estratégico e específico, sem encheção.',
      user: `Escreva DOIS resumos de módulo (markdown) sobre a concorrente, no estilo: abertura criativa + seções "## O que as campeãs revelam"/"## Onde isso se encaixa no tabuleiro" + "## Movimento recomendado p/ Vessel" (3 bullets de ação) + um "**Veredito competitivo:**" final.\n` +
        `1) COMERCIAL & DESENVOLVIMENTO: foco em PRODUTO (modelos, cores, materiais, preço, apostas).${ehProduto ? '' : ' Como esta marca é monitorada SÓ em marketing, faça um resumo curto dizendo isso e remetendo à vista de Marketing.'}\n` +
        `2) MARKETING: foco em campanhas, embaixadoras, manchetes/corporativo e comportamento no Instagram (o que viralizou e por quê).\n` +
        `Para cada um: titulo curto, resumo em markdown (250-380 palavras; use ## e listas com "-"), e 5-7 tags curtas. Use a escada de preço do painel como referência quando útil.\n\n${ctxC}`,
      schema: { type: 'object', properties: {
        comercial: { type: 'object', properties: { titulo: { type: 'string' }, resumo: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } }, required: ['titulo', 'resumo'] },
        marketing: { type: 'object', properties: { titulo: { type: 'string' }, resumo: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } }, required: ['titulo', 'resumo'] },
      }, required: ['comercial', 'marketing'] },
    });
    const mk = (cat, o) => ({ ...base, marca, categoria: cat, fonte: 'RBV · Observatório · síntese estratégica do módulo', titulo: String(o.titulo).slice(0, 200), resumo: String(o.resumo), produtos: (o.tags || []).slice(0, 8).map(t => ({ nome: String(t).slice(0, 60) })) });
    for (const c of ['Resumo Comercial', 'Resumo Marketing']) await rest('DELETE', `noticias_concorrentes?marca=eq.${encodeURIComponent(marca)}&rodada=eq.${RODADA}&categoria=eq.${encodeURIComponent(c)}`);
    await rest('POST', 'noticias_concorrentes', [mk('Resumo Comercial', out.comercial), mk('Resumo Marketing', out.marketing)]);
    okC++;
  } catch (e) { console.log(`  ✗ C ${marca}: ${String(e).slice(0, 120)}`); }
  console.log(`  ✓ ${marca}`);
}
const u = usageSummary();
console.log(`Enriquecimento: A(hero) ${okA} · B(análises) ${okB} · C(resumos) ${okC} / ${marcas.length} marcas.`);
console.log(`Custo LLM: ${u.text}`);
try {
  await rest('POST', 'coletor_log', [{ fase: 'enriquece-custo', encontradas: marcas.length, inseridas: okC, detalhe: `rodada ${RODADA} · A${okA} B${okB} C${okC} · ${u.text}` }], 'return=minimal'); // o papel só tem INSERT em coletor_log: sem RETURNING
} catch (e) { console.log('aviso: falha ao logar custo:', String(e).slice(0, 100)); }
if (R.via === 'rest' && !process.env.SUPABASE_SERVICE_KEY) process.env.SUPABASE_SERVICE_KEY = env.SUPABASE_SERVICE_KEY;
await registrarExecucao({
  robo: 'coletor-noticias', acao: 'enriquecimento', modelo: `${SONNET}+${OPUS}`,
  inputTokens: u.tin, outputTokens: u.tout, chamadas: u.calls, usd: u.usd,
  duracaoMs: Date.now() - _t0, itens: okC, unidade: 'notícias',
  status: 'ok', detalhe: `rodada ${RODADA} · A${okA} B${okB} C${okC}`,
});
await R.fechar();
