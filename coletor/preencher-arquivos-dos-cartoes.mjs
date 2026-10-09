// coletor/preencher-arquivos-dos-cartoes.mjs
// Preenche `vessel_cartao_arquivos` (onde está, no Zoho, cada arquivo de cartão) para os cartões que o robô entregou ANTES
// de gravar os ids. Sem a linha, a edge `vessel-baixar-cartao` cai na busca lenta (dias -> pastas -> arquivo).
//
//   node --env-file=coletor/.env --import ./coletor/lib/curl-fetch.mjs coletor/preencher-arquivos-dos-cartoes.mjs            # a seco: só conta
//   node --env-file=coletor/.env --import ./coletor/lib/curl-fetch.mjs coletor/preencher-arquivos-dos-cartoes.mjs --gravar   # grava
//
// Percorre os dias do MAIS VELHO para o mais novo: peça refeita em outro dia tem o mesmo nome de arquivo nos dois, e vale o
// mais novo (a edge e o robô seguem a mesma regra). Só grava arquivo de peça que o banco diz ter cartão (`cartao_gerado_em`).
import { listarPasta } from './lib/zoho-workdrive.mjs';
import { conexaoZoho } from './lib/zoho-da-central.mjs';
import { diasEmOrdem, pastaDoSku, ehPastaDosCartoes } from '../supabase/functions/_shared/cartao-no-zoho.js';

const GRAVAR = process.argv.includes('--gravar');
const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) { console.error('faltam SUPABASE_URL e SUPABASE_SERVICE_KEY'); process.exit(1); }
const cab = { apikey: SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY };
const RAIZ_FOTOS_ID = process.env.ZOHO_PASTA_FOTOS || '6kuqn469a1e0841ee49e0bd0d18cab60c9cd5';
// "<SKU>_cartao_<NN>_<frente|verso>.<png|pdf>" — o nome que o robô dá (coletor/lib/cartoes-da-fila.js, `rotuloDoCartao`).
const NOME = /^(.+)_cartao_(\d+)_(?:frente|verso)\.(?:png|pdf)$/;

const z = await conexaoZoho(`${SUPABASE_URL}/rest/v1`, cab);
Object.assign(process.env, {
  ZOHO_CLIENT_ID: z.client_id, ZOHO_CLIENT_SECRET: z.client_secret, ZOHO_REFRESH_TOKEN: z.refresh_token,
  ZOHO_DC: String(z.data_center || '.com').replace(/^\./, ''),
});

// (SKU, nº na série) -> código da peça, só das que têm cartão.
const r = await fetch(`${SUPABASE_URL}/rest/v1/vessel_pecas?cartao_gerado_em=not.is.null&select=codigo,numero_na_serie,vessel_lotes(sku)&limit=5000`, { headers: cab });
if (!r.ok) throw new Error('vessel_pecas -> ' + r.status);
const codigoDe = new Map((await r.json()).map((p) => [`${p.vessel_lotes?.sku}|${Number(p.numero_na_serie)}`, p.codigo]));
console.log(`peças com cartão no banco: ${codigoDe.size}`);

const vb = (await listarPasta(RAIZ_FOTOS_ID)).find((p) => p.folder && p.name.normalize('NFC') === 'Vessel Brasil');
const raiz = (await listarPasta(vb.id)).find((p) => p.folder && ehPastaDosCartoes(p.name));
const dias = diasEmOrdem((await listarPasta(raiz.id)).filter((p) => p.folder)).reverse(); // do mais velho ao mais novo

const linhas = new Map(); // `${codigo}|${nome}` -> linha; o dia mais novo sobrescreve
let semPeca = 0;
for (const dia of dias) {
  for (const sub of (await listarPasta(dia.id)).filter((p) => p.folder)) {
    for (const f of (await listarPasta(sub.id)).filter((x) => !x.folder)) {
      const m = NOME.exec(f.name);
      const codigo = m && codigoDe.get(`${m[1]}|${Number(m[2])}`);
      if (!codigo) { semPeca++; continue; }
      linhas.set(`${codigo}|${f.name}`, { codigo, nome: f.name, zoho_id: f.id, pasta_id: sub.id, atualizado_em: new Date().toISOString() });
    }
  }
  console.log(`  dia ${dia.name.trim()}: ${linhas.size} arquivos até aqui`);
}
console.log(`arquivos para gravar: ${linhas.size} (de ${new Set([...linhas.values()].map((l) => l.codigo)).size} peças); sem peça com cartão no banco: ${semPeca}`);

if (!GRAVAR) { console.log('(a seco: nada foi gravado; use --gravar)'); process.exit(0); }
const todas = [...linhas.values()];
for (let i = 0; i < todas.length; i += 200) {
  const w = await fetch(`${SUPABASE_URL}/rest/v1/vessel_cartao_arquivos?on_conflict=codigo,nome`, {
    method: 'POST', headers: { ...cab, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(todas.slice(i, i + 200)),
  });
  if (!w.ok) throw new Error(`gravar -> ${w.status} ${(await w.text()).slice(0, 200)}`);
}
console.log(`gravados: ${todas.length}`);
