// coletor/robo-de-cartoes.mjs
// O ROBÔ DA FILA DE CARTÕES EAN. Roda no GitHub Actions (.github/workflows/cartoes-ean.yml).
//
//   node --import ./coletor/lib/curl-fetch.mjs coletor/robo-de-cartoes.mjs          # esvazia a fila
//   node --env-file=coletor/.env coletor/robo-de-cartoes.mjs --seco                 # só olha: não pega, não gera, não sobe
//
// FLUXO (por pedido):  pega da fila -> liga cada `codigo` ao SKU e ao nº da peça -> baixa as fotos do Zoho ->
// gera o HTML, exporta (Chrome, 600 dpi), LÊ o código de barras do PNG impresso -> sobe 4 arquivos no Zoho ->
// confere no Zoho que os arquivos estão lá -> devolve ao banco SÓ as peças confirmadas.
//
// ⚠️ A MARCA `cartao_gerado_em` PRENDE O NÚMERO DE SÉRIE. Peça só entra em `p_pecas` depois de: PNG gerado, GTIN
// lido da imagem igual ao do Bling, e os 4 arquivos listados na pasta do Zoho. Ver `planoDeDevolucao`.
// ⚠️ O pedido SEMPRE volta ao banco (pronto ou falhou), mesmo quando algo estoura no meio. Só não volta se o
// processo for morto; aí `vessel_cartao_recolocar_travados` o devolve à fila depois de 150 min.
//
// O gerador do cartão mora no repositório do SITE (vessel-brasil/cartao), que o workflow baixa em ./vessel-brasil.
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { zohoAtivo, listarPasta, acharOuCriarPasta, uploadArquivo, baixarArquivo } from './lib/zoho-workdrive.mjs';
import { agruparPorSku, nomeDaSubpasta, planoDeDevolucao, rotuloDoCartao } from './lib/cartoes-da-fila.js';
import { fazerCartao } from './lib/cartao-de-uma-peca.mjs';

const SECO = process.argv.includes('--seco');
const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) { console.error('faltam SUPABASE_URL e SUPABASE_SERVICE_KEY'); process.exit(1); }
if (!zohoAtivo()) { console.error('faltam os segredos do Zoho (ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN)'); process.exit(1); }

const VESSEL = resolve(process.env.VESSEL_DIR || 'vessel-brasil');
// "Fotos por SKU (coletor)", no Zoho; dentro dela ficam "Vessel Brasil" e, dentro desta, "Cartões com EAN".
const RAIZ_FOTOS_ID = process.env.ZOHO_PASTA_FOTOS || '6kuqn469a1e0841ee49e0bd0d18cab60c9cd5';
const REGEX_SKU = /SS[0-9]+[A-Z]{1,2}\.[A-Z]?[0-9]+/g;
const NFC = (s) => String(s).normalize('NFC');
const limpo = (s) => String(s).replace(/[\u0000-\u001F\u007F/\\]/g, '-');
const MIME = { png: 'image/png', pdf: 'application/pdf' };

/** Primeira linha útil de um erro (inclui o stderr de processo filho) — cabe na coluna `erro` do pedido. */
function curto(e) {
  const texto = (e?.stderr ? e.stderr.toString() : '') || e?.message || String(e);
  const linhas = texto.split('\n').map((l) => l.trim()).filter(Boolean);
  return (linhas.at(-1) || 'erro sem mensagem').slice(0, 160);
}

const cab = { apikey: SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY };
async function rpc(nome, corpo = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${nome}`, {
    method: 'POST', headers: { ...cab, 'Content-Type': 'application/json' }, body: JSON.stringify(corpo),
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`${nome} -> ${r.status} ${txt.slice(0, 200)}`);
  return txt ? JSON.parse(txt) : null;
}
async function ler(caminho) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${caminho}`, { headers: cab });
  if (!r.ok) throw new Error(`${caminho.split('?')[0]} -> ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

/** vessel_pecas com o SKU do lote, em lotes de 100 códigos (limite de tamanho da URL). */
async function buscarPecas(codigos) {
  const linhas = [];
  for (let i = 0; i < codigos.length; i += 100) {
    const lista = codigos.slice(i, i + 100).map((c) => `"${String(c).replace(/"/g, '')}"`).join(',');
    linhas.push(...await ler(`vessel_pecas?select=codigo,numero_na_serie,vessel_lotes(sku)&codigo=in.(${encodeURIComponent(lista)})`));
  }
  return linhas;
}

/** As subpastas de "Vessel Brasil" no Zoho e o id da própria "Vessel Brasil". */
async function pastasDeFotos() {
  const vb = (await listarPasta(RAIZ_FOTOS_ID)).find((x) => x.folder && NFC(x.name) === 'Vessel Brasil');
  if (!vb) throw new Error('não achei a pasta "Vessel Brasil" dentro de "Fotos por SKU (coletor)" no Zoho');
  return { vbId: vb.id, pastas: (await listarPasta(vb.id)).filter((x) => x.folder) };
}

const pastasDoSku = (pastas, sku) =>
  pastas.filter((p) => (p.name.toUpperCase().match(REGEX_SKU) || []).includes(sku.toUpperCase()));

/**
 * Espelha em disco a estrutura que o gerador espera (VESSEL_FOTOS_ZOHO): uma pasta por produto. Nas pastas dos
 * SKUs pedidos baixa as imagens; em TODAS as outras baixa só os .jpg/.jpeg, porque o desenho a lápis do modelo
 * mora numa pasta de cor só (ver `desenhoDoModelo`). As pastas vazias existem para o casamento por nome.
 */
async function espelharFotos(pastas, skus, raiz) {
  const alvos = new Set(skus.flatMap((s) => pastasDoSku(pastas, s).map((p) => p.id)));
  for (const p of pastas) {
    const dir = join(raiz, limpo(p.name));
    mkdirSync(dir, { recursive: true });
    const quer = alvos.has(p.id) ? /\.(png|jpe?g|webp)$/i : /\.jpe?g$/i;
    for (const f of (await listarPasta(p.id)).filter((x) => !x.folder && quer.test(x.name))) {
      writeFileSync(join(dir, limpo(f.name)), await baixarArquivo(f.id));
    }
  }
}

async function processar(pedido, estado, ctx) {
  const { porSku, semDados } = agruparPorSku(pedido.pecas, await buscarPecas(pedido.pecas));
  for (const x of semDados) estado.falhas.push({ rotulo: x.codigo, motivo: x.motivo });

  const { vbId, pastas } = await pastasDeFotos();
  const dia = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }); // AAAA-MM-DD
  estado.pasta = `Cartões com EAN/${dia}`;
  const pastaDia = await acharOuCriarPasta(await acharOuCriarPasta(vbId, 'Cartões com EAN'), dia);

  const fotos = join(ctx.trabalho, 'fotos');
  process.env.VESSEL_FOTOS_ZOHO = fotos; // ANTES de importar o gerador: `dados.mjs` lê isto ao carregar
  await espelharFotos(pastas, [...porSku.keys()], fotos);
  const { gerarCartao } = await import(pathToFileURL(join(VESSEL, 'cartao', 'gerar.mjs')).href);

  const series = new Map(); // nº de série impresso -> quantas vezes (duas bolsas com a mesma identidade = defeito)
  for (const [sku, pecas] of porSku) {
    const achadas = pastasDoSku(pastas, sku);
    if (achadas.length !== 1) {
      const motivo = achadas.length ? `${achadas.length} pastas de foto com o mesmo SKU (cada SKU tem de ter UMA)` : 'sem pasta de fotos no Zoho';
      for (const p of pecas) estado.falhas.push({ rotulo: `${sku} nº${p.numero}`, motivo });
      continue;
    }
    const idSubpasta = await acharOuCriarPasta(pastaDia, nomeDaSubpasta(achadas[0].name, sku));
    const feitas = [];
    for (const peca of pecas) {
      const rotulo = rotuloDoCartao(sku, peca.numero);
      try {
        const c = await fazerCartao({ gerarCartao, vessel: VESSEL, trabalho: ctx.trabalho, sku, numero: peca.numero });
        for (const f of c.arquivos) await uploadArquivo(idSubpasta, f, readFileSync(join(c.saida, f)), MIME[f.split('.').pop()]);
        rmSync(c.saida, { recursive: true, force: true });
        series.set(c.serie, (series.get(c.serie) || 0) + 1);
        feitas.push({ peca, rotulo, serie: c.serie });
        console.log(`  ✓ ${rotulo}  série ${c.serie}  GTIN ${c.gtin}`);
      } catch (e) {
        estado.falhas.push({ rotulo: `${sku} nº${peca.numero}`, motivo: curto(e) });
        console.log(`  ✗ ${rotulo}  ${curto(e)}`);
      }
    }
    // Confirma NO ZOHO (não no que o upload respondeu): só conta o cartão cujos 4 arquivos aparecem na pasta.
    const noZoho = new Set((await listarPasta(idSubpasta)).map((x) => x.name));
    for (const f of feitas) {
      const faltando = arquivosDoCartao(f.rotulo).filter((n) => !noZoho.has(n));
      if (series.get(f.serie) > 1) estado.falhas.push({ rotulo: `${sku} nº${f.peca.numero}`, motivo: `número de série repetido (${f.serie})` });
      else if (faltando.length) estado.falhas.push({ rotulo: `${sku} nº${f.peca.numero}`, motivo: `não achei no Zoho: ${faltando.join(', ')}` });
      else estado.confirmadas.push(f.peca.codigo);
    }
  }
}

async function secoMode() {
  const fila = await ler('vessel_cartao_pedidos?situacao=in.(na_fila,rodando)&select=id,situacao,criado_em,pecas&order=criado_em');
  console.log(`pedidos na fila: ${fila.length}`);
  const { pastas } = await pastasDeFotos();
  for (const p of fila) {
    const { porSku, semDados } = agruparPorSku(p.pecas, await buscarPecas(p.pecas));
    console.log(`\npedido ${p.id.slice(0, 8)} (${p.situacao}, ${p.criado_em.slice(0, 16)}): ${p.pecas.length} peças em ${porSku.size} SKUs`);
    for (const x of semDados) console.log(`  ✗ ${x.codigo}: ${x.motivo}`);
    for (const [sku, pecas] of porSku) {
      const a = pastasDoSku(pastas, sku);
      const nums = pecas.map((x) => x.numero).join(',');
      console.log(`  ${a.length === 1 ? '✓' : '✗'} ${sku.padEnd(13)} nº ${nums.padEnd(28)} ${a.length === 1 ? '-> ' + nomeDaSubpasta(a[0].name, sku) : a.length ? a.length + ' pastas com este SKU' : 'SEM PASTA DE FOTOS NO ZOHO'}`);
    }
  }
}

if (SECO) { await secoMode(); process.exit(0); }

// Pedido que ficou `rodando` porque o robô anterior foi morto volta para a fila. Se a função ainda não existe no
// banco (migration pendente), segue sem ela: é a retaguarda, não o caminho principal.
await rpc('vessel_cartao_recolocar_travados', { p_minutos: 150 }).catch((e) => console.log('aviso: ' + e.message));

let feitos = 0;
for (;;) {
  const { pedido } = await rpc('vessel_cartao_pegar_da_fila');
  if (!pedido) break;
  console.log(`\npedido ${pedido.id.slice(0, 8)}: ${pedido.pecas.length} peças`);
  const trabalho = mkdtempSync(join(tmpdir(), 'cartoes-'));
  const estado = { confirmadas: [], falhas: [], pasta: null };
  try { await processar(pedido, estado, { trabalho }); }
  catch (e) { estado.falhas.push({ rotulo: 'pedido', motivo: curto(e) }); console.log('✗ ' + curto(e)); }
  finally { rmSync(trabalho, { recursive: true, force: true }); }
  for (const c of planoDeDevolucao({ pedidas: pedido.pecas, confirmadas: estado.confirmadas, falhas: estado.falhas, pasta: estado.pasta })) {
    const r = await rpc('vessel_cartao_pedido_terminou', { p_pedido: pedido.id, p_ok: c.ok, p_pasta: c.pasta, p_erro: c.erro, p_pecas: c.pecas });
    console.log(`  devolvido: ok=${c.ok} marcadas=${r?.marcadas ?? 0}${c.erro ? ' erro=' + c.erro.slice(0, 120) : ''}`);
  }
  feitos++;
}
console.log(`\nfila vazia. pedidos tratados: ${feitos}`);
