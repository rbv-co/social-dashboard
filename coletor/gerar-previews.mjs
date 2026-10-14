#!/usr/bin/env node
// coletor/gerar-previews.mjs
// SP-5 Fase A: gera a galeria de preview de cada code-look (produto ou promo)
// com dados de AMOSTRA (não usa candidatos reais) — sobe pro Storage e grava
// fabrica_looks.preview_url (a do formato feed 1080x1350) pra alimentar a UI
// de curadoria dos looks.
import './lib/carregar-env.mjs';
import { renderPNG, fecharRender } from './lib/render-criativo.mjs';
import { TEMPLATES, DIM } from './templates-criativos/templates.mjs';
import { variacoesProduto, variacoesPromo } from './lib/criativo-modelo.mjs';
import { subirStorageResiliente } from './lib/storage-upload.mjs';
// Plano 7 (5.8): as tabelas `fabrica_*` vão pela API quando CENTRAL_API_* estiver no
// ambiente (lib/fabrica-banco.mjs); o resto (Storage, gc_*) segue na REST do Supabase.
import { vaiParaApi, lerFabrica, escreverFabrica } from './lib/fabrica-banco.mjs';

const URL = process.env.SUPABASE_URL || 'https://kounqtdoioootxqegkij.supabase.co';
const SK = process.env.SUPABASE_SERVICE_KEY;
const REST = URL + '/rest/v1';
const H = { apikey: SK, Authorization: 'Bearer ' + SK, 'Content-Type': 'application/json' };
const BUCKET = 'fabrica-criativos';

// foto de amostra neutra (data URL PNG cinza 1x1) — o preview é ilustrativo,
// não depende de nenhuma foto real de produto.
const FOTO_AMOSTRA = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

// dadosAmostra(): função pura — candidato/campanha de exemplo coerentes (De/Por + pct),
// coincide com o formato que variacoesProduto/variacoesPromo esperam de verdade.
export function dadosAmostra() {
  const cand = { sku: 'AMOSTRA', nome: 'Bolsa Modelo', categoria: 'bolsas', preco: 449.9, pct: 50 };
  const campanha = { nome: 'Amostra', desconto_pct: 50, desconto_tipo: 'fixo', parcelas: 10, marca: 'a marca' };
  return { cand, campanha, fotoDataUrl: FOTO_AMOSTRA };
}

async function sbPatch(p, body) {
  if (vaiParaApi(p)) return escreverFabrica('PATCH', p, body);
  const r = await fetch(REST + p, { method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify(body) });
  if (!r.ok && ![200, 204].includes(r.status)) throw new Error('PATCH ' + p + ' ' + r.status);
}

async function subir(path, buf) {
  // Retry com backoff — mesmo motivo de gerar-criativos (proxy do Storage
  // devolve 400/5xx transitório em lote). Ver lib/storage-upload.mjs.
  return subirStorageResiliente({
    url: URL, sk: SK, bucket: BUCKET, path, buf,
    onRetry: (t, e) => console.warn(`  [storage retry ${t}/9] ${path.split('/').pop()}: ${e.message.slice(0, 60)}`),
  });
}

// run(): pra cada code-look do registry TEMPLATES, gera a variante certa (produto via
// variacoesProduto, promo usa dados da 1ª variante mas renderiza com o chave atual) com os dados de
// amostra, renderiza nos 2 formatos, sobe pro Storage e grava preview_url (do formato
// feed 1080x1350) em fabrica_looks. Não toca campanha/objetivo — é só ilustrativo.
export async function run() {
  const { cand, campanha, fotoDataUrl } = dadosAmostra();
  let n = 0;
  try {
    for (const chave of Object.keys(TEMPLATES)) {
      const arq = TEMPLATES[chave].arquetipo;
      let v;
      if (arq === 'promo') {
        // promo: pega dados da 1ª variante mas renderiza com o chave atual
        const base = variacoesPromo(campanha, fotoDataUrl, 'Coleção')[0];
        v = base ? { template: chave, formato: base.formato, dados: base.dados } : null;
      } else {
        const variants = variacoesProduto({ ...cand, fotoDataUrl }, campanha, { looks: [chave] }, 50);
        v = variants[0];
      }
      if (!v) { console.warn('sem variante p/', chave); continue; }
      let feedUrl = null;
      for (const formato of Object.keys(DIM)) {
        const html = TEMPLATES[chave].render(v.dados, formato);
        const buf = await renderPNG(html, DIM[formato]);
        const url = await subir(`_previews/${chave}-${formato}.png`, buf);
        if (formato === '1080x1350') feedUrl = url;
      }
      if (feedUrl) await sbPatch(`/fabrica_looks?chave=eq.${chave}`, { preview_url: feedUrl });
      n++;
    }
  } finally {
    await fecharRender();
  }
  console.log(`previews gerados: ${n} looks`);
  return { previews: n };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
