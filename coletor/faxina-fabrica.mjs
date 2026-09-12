// FAXINA DAS SOBRAS DO BUCKET `fabrica-criativos`.
//
// POR QUE ELE EXISTE (medido em 19/08/2026): a purga que já roda (edge `fabrica-purga`,
// 04h17) apaga arquivo pelo `storage_path` GRAVADO NA LINHA de `fabrica_criativos`.
// Arquivo que nunca virou linha, ela não enxerga — e fica pra sempre. Os dois casos
// achados no bucket:
//   1) os MP4 (motion, 16:9) que a geração sobe junto do PNG mas não registra no banco;
//   2) pastas de rodadas que sumiram do banco (a linha da campanha foi apagada e o
//      arquivo ficou órfão).
// Contado na hora: 81 arquivos / 64 MB de sobra num bucket de 165 MB.
//
// A REGRA (conservadora de propósito): só apaga arquivo dentro de pasta de RODADA
// (nome da pasta = uuid da campanha) que o banco confirma estar MORTA — campanha
// purgada, ou campanha que não existe mais. Pasta de biblioteca (`_previews`,
// `favoritos`, `logo`, qualquer nome que não seja uuid) NUNCA entra. E arquivo que
// ainda é apontado por linha viva de `fabrica_criativos` ou por `fabrica_looks`
// também não entra, mesmo dentro de pasta morta.
//
// DRY=1 só lista o que apagaria (não apaga nada).
import fs from 'fs';

const env = {};
try { for (const l of fs.readFileSync(new URL('./.env', import.meta.url), 'utf8').split('\n')) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ''); } } catch (e) {}
const URL_SB = process.env.SUPABASE_URL || env.SUPABASE_URL || 'https://kounqtdoioootxqegkij.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_KEY || env.SUPABASE_SERVICE_KEY;
const BUCKET = 'fabrica-criativos';
const DRY = process.env.DRY === '1';
const DIAS_MIN = Number(process.env.DIAS_MIN || 7);   // não encosta em nada recém-subido
const TETO = Number(process.env.TETO || 400);          // teto de arquivos por rodada do robô

if (!KEY) { console.error('✗ falta SUPABASE_SERVICE_KEY.'); process.exit(1); }
const sbH = { apikey: KEY, Authorization: 'Bearer ' + KEY };
const jh = { ...sbH, 'Content-Type': 'application/json' };
const EH_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function get(path) {
  const r = await fetch(URL_SB + '/rest/v1/' + path, { headers: sbH });
  if (!r.ok) throw new Error('GET ' + path + ' ' + r.status);
  return r.json();
}

// ---- 1) o que o banco AINDA reconhece como vivo -----------------------------
const campanhas = await get('fabrica_campanhas?select=id,fechada_em,purgado_em');
const criativos = await get('fabrica_criativos?select=storage_path,purgado_em');
const looks = await get('fabrica_looks?select=preview_url');

const estadoDaRodada = new Map(campanhas.map((k) => [k.id, k.purgado_em ? 'purgada' : 'viva']));
const vivos = new Set(criativos.filter((c) => !c.purgado_em && c.storage_path).map((c) => c.storage_path));
const caminhoDe = (u) => { const m = String(u || '').match(new RegExp('/' + BUCKET + '/(.+?)(\\?|$)')); return m ? decodeURIComponent(m[1]) : null; };
for (const l of looks) { const p = caminhoDe(l.preview_url); if (p) vivos.add(p); }

// TRAVA 1: se as consultas voltarem vazias (falha silenciosa de rede/RLS), NÃO apaga nada.
// Sem isso, um erro de leitura viraria "não tem dono, pode apagar" — e levaria o bucket junto.
if (!campanhas.length || !vivos.size) {
  console.error(`✗ banco respondeu vazio (campanhas ${campanhas.length}, arquivos vivos ${vivos.size}) — abortando por segurança.`);
  process.exit(0);
}
console.log(`Banco: ${campanhas.length} rodadas · ${vivos.size} arquivos com dono vivo.`);

// ---- 2) varre o bucket inteiro (recursivo: pasta vem com id null) ------------
async function listar(prefixo = '') {
  const achados = [];
  let offset = 0;
  for (;;) {
    const r = await fetch(`${URL_SB}/storage/v1/object/list/${BUCKET}`, {
      method: 'POST', headers: jh,
      body: JSON.stringify({ prefix: prefixo, limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } }),
    });
    if (!r.ok) throw new Error('list ' + prefixo + ' ' + r.status);
    const arr = await r.json();
    if (!Array.isArray(arr) || !arr.length) break;
    for (const o of arr) {
      if (!o || !o.name) continue;
      const caminho = prefixo + o.name;
      if (o.id) achados.push({ caminho, criado: o.created_at, bytes: Number(o.metadata?.size || 0) });
      else achados.push(...await listar(caminho + '/'));       // é pasta: desce
    }
    if (arr.length < 1000) break;
    offset += 1000;
  }
  return achados;
}
const objetos = await listar();
const limite = Date.now() - DIAS_MIN * 864e5;

// ---- 3) decide arquivo por arquivo ------------------------------------------
const apagar = [];
let guardados = 0, recentes = 0, biblioteca = 0;
for (const o of objetos) {
  const pasta = o.caminho.split('/')[0];
  if (!EH_UUID.test(pasta)) { biblioteca++; continue; }                       // _previews, favoritos, logo...
  if (estadoDaRodada.get(pasta) === 'viva') { guardados++; continue; }        // rodada em andamento
  if (vivos.has(o.caminho)) { guardados++; continue; }                        // ainda apontado por linha viva
  if (new Date(o.criado).getTime() > limite) { recentes++; continue; }        // acabou de subir
  apagar.push(o);
}
const mb = (n) => (n / 1048576).toFixed(1) + ' MB';
const total = apagar.reduce((s, o) => s + o.bytes, 0);
console.log(`Bucket: ${objetos.length} arquivos · guardados ${guardados} · biblioteca ${biblioteca} · recentes ${recentes} · sobra ${apagar.length} (${mb(total)}).`);

// TRAVA 2: teto por rodada. Se a conta explodir, é sinal de que a regra pegou algo
// que não devia — melhor sair pela metade e o dono olhar do que varrer o bucket.
if (apagar.length > TETO) {
  console.error(`✗ ${apagar.length} arquivos passam do teto de ${TETO} — abortando pra você conferir.`);
  process.exit(1);
}
if (!apagar.length) { console.log('Nada a apagar.'); process.exit(0); }

for (const o of apagar.slice(0, 20)) console.log(`  ${DRY ? 'apagaria' : 'apaga'}: ${o.caminho} (${mb(o.bytes)})`);
if (apagar.length > 20) console.log(`  ... e mais ${apagar.length - 20}.`);

if (DRY) { console.log(`(DRY) nada foi apagado — liberaria ${mb(total)}.`); process.exit(0); }

// ---- 4) apaga em lotes -------------------------------------------------------
let feitos = 0, falhas = 0;
for (let i = 0; i < apagar.length; i += 100) {
  const lote = apagar.slice(i, i + 100).map((o) => o.caminho);
  const r = await fetch(`${URL_SB}/storage/v1/object/${BUCKET}`, { method: 'DELETE', headers: jh, body: JSON.stringify({ prefixes: lote }) });
  if (r.ok) feitos += lote.length; else { falhas += lote.length; console.error(`  falha no lote ${i}: ${r.status} ${await r.text()}`); }
}
console.log(`Faxina da Fábrica: ${feitos} apagados (${mb(total)} liberados)${falhas ? ` · ${falhas} falhas` : ''}.`);
