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
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { listarPasta, acharOuCriarPasta, uploadArquivo, baixarArquivo } from './lib/zoho-workdrive.mjs';
import { conexaoZoho } from './lib/zoho-da-central.mjs';
import { agruparPorSku, nomeDaSubpasta, planoDeDevolucao, rotuloDoCartao, arquivosDoCartao } from './lib/cartoes-da-fila.js';
import { fazerCartao } from './lib/cartao-de-uma-peca.mjs';
import { emParalelo, sincronizarPasta, podarPastas, versaoDoTratamento } from './lib/espelho-de-fotos.mjs';
import { comTrava } from './lib/trava-de-arquivo.mjs';

const SECO = process.argv.includes('--seco');
const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) { console.error('faltam SUPABASE_URL e SUPABASE_SERVICE_KEY'); process.exit(1); }

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

// ⚠️ O ZOHO É O DA CENTRAL (Acessos → Zoho, tabela `acessos_conexoes`), e NÃO os segredos ZOHO_* do GitHub: em
// 06/10/2026 os dois deram `inactive_client` (o aplicativo do Zoho tinha caído) e renovar em dois lugares é pedir
// para um ficar velho. Assim há UM lugar para reconectar. O cliente de coletor/lib/zoho-workdrive.mjs lê o
// ambiente na hora de usar, então basta preenchê-lo aqui. Sem conexão, para ANTES de pegar pedido: ele fica na fila.
{
  const z = await conexaoZoho(`${SUPABASE_URL}/rest/v1`, cab);
  process.env.ZOHO_CLIENT_ID = z.client_id;
  process.env.ZOHO_CLIENT_SECRET = z.client_secret;
  process.env.ZOHO_REFRESH_TOKEN = z.refresh_token;
  process.env.ZOHO_DC = String(z.data_center || '.com').replace(/^\./, '');
}
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

const SIMULTANEAS = 6; // chamadas ao Zoho ao mesmo tempo (listar 71 pastas em fila levava ~50 s)
const AQUI = dirname(fileURLToPath(import.meta.url));
// Com FOTOS_CACHE (VPS) o espelho é PERMANENTE: só baixa o que mudou no Zoho. Sem ele (GitHub Actions) é refeito a cada
// pedido, como sempre foi. Regras de validade em lib/espelho-de-fotos.mjs.
const CACHE = !!process.env.FOTOS_CACHE;
// Na VPS pode haver mais de um robô ao mesmo tempo (vigia, CARTOES_WORKERS). O que eles dividem — o espelho de fotos, o
// que o gerador guarda por nome de arquivo e o "achar ou criar pasta" no Zoho — passa por esta trava. O resto (Chrome,
// código de barras, upload, conferência) roda em paralelo. Sem FOTOS_CACHE só há um robô: não trava nada.
const exclusivo = (fn) => (CACHE ? comTrava(resolve(process.env.FOTOS_CACHE) + '.trava', fn) : fn());
const VARREDURA_VALE_MS = 15 * 60 * 1000; // a busca do desenho do modelo nas ~70 pastas irmãs vale por 15 min
const segs = (t0) => ((Date.now() - t0) / 1000).toFixed(1) + 's';

/** Apaga o que o gerador derivou das fotos (recorte, foto tratada, desenho tratado). Ele guarda por NOME de arquivo. */
function limparDerivados() {
  for (const d of [join(AQUI, 'fotos-cutout'), join(VESSEL, 'cartao', 'fotos-tratadas'), join(VESSEL, 'cartao', 'desenhos-tratados')]) rmSync(d, { recursive: true, force: true });
  console.log('  fotos tratadas guardadas apagadas (uma foto ou o tratamento mudou)');
}

/**
 * Espelha em disco a estrutura que o gerador espera (VESSEL_FOTOS_ZOHO): uma pasta por produto. Nas pastas dos
 * SKUs pedidos baixa as imagens. As outras pastas só entram se faltar desenho: `desenhoDoModelo` (que procura o
 * desenho a lápis do modelo, guardado numa pasta de cor só) só é consultado quando a pasta do SKU NÃO tem o seu
 * próprio .jpg/.jpeg (`desenhoDaPasta` vem antes). Aí baixa só os .jpg/.jpeg das demais.
 */
async function espelharFotos(pastas, skus, raiz) {
  const arquivoManifesto = join(raiz, '.manifesto.json');
  let estado = { arquivos: {}, varridoEm: 0, tratamento: '' };
  if (CACHE) { try { estado = { ...estado, ...JSON.parse(readFileSync(arquivoManifesto, 'utf8')) }; } catch { /* primeira vez */ } }
  const m = estado.arquivos;
  let trocados = 0;

  if (CACHE) {
    // O que muda o resultado do tratamento: os scripts e os recortes à mão. Mudou = o que está guardado é de outra regra.
    const v = versaoDoTratamento([
      join(VESSEL, 'cartao', 'tratar-foto.py'), join(VESSEL, 'cartao', 'preparar-desenho.py'), join(VESSEL, 'cartao', 'recortes-a-mao'),
      join(AQUI, 'recortar.py'), join(AQUI, 'lib', 'cutout.mjs'),
    ]);
    if (v !== estado.tratamento) { trocados++; estado.tratamento = v; }
    trocados += podarPastas(raiz, new Set(pastas.map((p) => limpo(p.name))), m);
  }

  const sync = async (p, quer) => {
    const lista = (await listarPasta(p.id)).filter((x) => !x.folder);
    const r = await sincronizarPasta({
      dir: join(raiz, limpo(p.name)),
      remotos: lista.filter((x) => quer.test(x.name)).map((x) => ({ ...x, nome: limpo(x.name) })),
      todosNomes: new Set(lista.map((x) => limpo(x.name))),
      manifesto: m, baixar: (f) => baixarArquivo(f.id), simultaneas: SIMULTANEAS,
    });
    trocados += r.trocados;
    return lista;
  };

  const alvos = [...new Set(skus.flatMap((s) => pastasDoSku(pastas, s)))];
  let faltaDesenho = false;
  await emParalelo(alvos, SIMULTANEAS, async (p) => {
    const lista = await sync(p, /\.(png|jpe?g|webp)$/i);
    if (!lista.some((x) => /\.jpe?g$/i.test(x.name))) faltaDesenho = true;
  });
  if (faltaDesenho && !(CACHE && Date.now() - estado.varridoEm < VARREDURA_VALE_MS)) {
    const ids = new Set(alvos.map((p) => p.id));
    await emParalelo(pastas.filter((p) => !ids.has(p.id)), SIMULTANEAS, (p) => sync(p, /\.jpe?g$/i));
    estado.varridoEm = Date.now();
  }
  if (trocados) limparDerivados();
  if (CACHE) writeFileSync(arquivoManifesto, JSON.stringify(estado));
}

async function processar(pedido, estado, ctx) {
  const t0 = Date.now(); let t = t0;
  const tempos = {}; const marca = (e) => { tempos[e] = (tempos[e] || 0) + (Date.now() - t) / 1000; t = Date.now(); }; // soma entre SKUs
  const { porSku, semDados } = agruparPorSku(pedido.pecas, await buscarPecas(pedido.pecas));
  for (const x of semDados) estado.falhas.push({ rotulo: x.codigo, motivo: x.motivo });

  const { vbId, pastas } = await pastasDeFotos();
  const dia = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }); // AAAA-MM-DD
  estado.pasta = `Cartões com EAN/${dia}`;
  const pastaDia = await exclusivo(async () => acharOuCriarPasta(await acharOuCriarPasta(vbId, 'Cartões com EAN'), dia));
  marca('zoho (pastas)');

  // ⚠️ O caminho tem de ser o MESMO em todos os pedidos da rodada: `dados.mjs` fixa VESSEL_FOTOS_ZOHO no primeiro
  // import e o módulo fica em cache. Pasta nova por pedido = do 2º em diante o gerador aponta para uma pasta
  // apagada ("não achei a pasta de fotos do Zoho", 09/10). Por isso o caminho é fixo e só o conteúdo é refeito.
  process.env.VESSEL_FOTOS_ZOHO = FOTOS; // ANTES de importar o gerador
  if (!CACHE) rmSync(FOTOS, { recursive: true, force: true });
  mkdirSync(FOTOS, { recursive: true });
  await exclusivo(() => espelharFotos(pastas, [...porSku.keys()], FOTOS));
  const { gerarCartao } = await import(pathToFileURL(join(VESSEL, 'cartao', 'gerar.mjs')).href);
  marca('fotos');

  const series = new Map(); // nº de série impresso -> quantas vezes (duas bolsas com a mesma identidade = defeito)
  for (const [sku, pecas] of porSku) {
    const achadas = pastasDoSku(pastas, sku);
    if (achadas.length !== 1) {
      const motivo = achadas.length ? `${achadas.length} pastas de foto com o mesmo SKU (cada SKU tem de ter UMA)` : 'sem pasta de fotos no Zoho';
      for (const p of pecas) estado.falhas.push({ rotulo: `${sku} nº${p.numero}`, motivo });
      continue;
    }
    // ⚠️ Falha num SKU NÃO derruba o pedido: as peças dele viram falha e o próximo SKU segue (06/10: um erro de Zoho
    // aqui deixou 7 peças de outros SKUs sem nem serem tentadas).
    let idSubpasta;
    try { idSubpasta = await exclusivo(() => acharOuCriarPasta(pastaDia, nomeDaSubpasta(achadas[0].name, sku))); }
    catch (e) { for (const p of pecas) estado.falhas.push({ rotulo: `${sku} nº${p.numero}`, motivo: curto(e) }); continue; }
    const feitas = [];
    for (const peca of pecas) {
      const rotulo = rotuloDoCartao(sku, peca.numero);
      try {
        const c = await fazerCartao({ exclusivo, gerarCartao, vessel: VESSEL, trabalho: ctx.trabalho, sku, numero: peca.numero });
        const tUp = Date.now();
        await emParalelo(c.arquivos, 4, (f) => uploadArquivo(idSubpasta, f, readFileSync(join(c.saida, f)), MIME[f.split('.').pop()]));
        c.tempos.upload = +((Date.now() - tUp) / 1000).toFixed(1);
        console.log(`  ⏱ ${rotulo}: ` + Object.entries(c.tempos).map(([k, v]) => `${k} ${v}s`).join(' · '));
        rmSync(c.saida, { recursive: true, force: true });
        series.set(c.serie, (series.get(c.serie) || 0) + 1);
        feitas.push({ peca, rotulo, serie: c.serie });
        console.log(`  ✓ ${rotulo}  série ${c.serie}  GTIN ${c.gtin}`);
      } catch (e) {
        estado.falhas.push({ rotulo: `${sku} nº${peca.numero}`, motivo: curto(e) });
        console.log(`  ✗ ${rotulo}  ${curto(e)}`);
      }
    }
    marca('cartões');
    // Confirma NO ZOHO (não no que o upload respondeu): só conta o cartão cujos 4 arquivos aparecem na pasta.
    let noZoho;
    try { noZoho = new Set((await listarPasta(idSubpasta)).map((x) => x.name)); }
    catch (e) { for (const f of feitas) estado.falhas.push({ rotulo: `${sku} nº${f.peca.numero}`, motivo: 'não consegui conferir no Zoho: ' + curto(e) }); continue; }
    for (const f of feitas) {
      const faltando = arquivosDoCartao(f.rotulo).filter((n) => !noZoho.has(n));
      if (series.get(f.serie) > 1) estado.falhas.push({ rotulo: `${sku} nº${f.peca.numero}`, motivo: `número de série repetido (${f.serie})` });
      else if (faltando.length) estado.falhas.push({ rotulo: `${sku} nº${f.peca.numero}`, motivo: `não achei no Zoho: ${faltando.join(', ')}` });
      else estado.confirmadas.push(f.peca.codigo);
    }
    marca('conferir no Zoho');
  }
  console.log('  ⏱ pedido: ' + Object.entries(tempos).map(([k, v]) => `${k} ${v.toFixed(1)}s`).join(' · ') + ` · total ${segs(t0)}`);
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

const FOTOS = CACHE ? resolve(process.env.FOTOS_CACHE) : join(mkdtempSync(join(tmpdir(), 'cartoes-fotos-')), 'fotos');
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
