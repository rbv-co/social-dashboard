// coletor/lib/zoho-workdrive.mjs
// Sobe os criativos FINAIS pro Zoho WorkDrive (NUVEM), organizados por loja -> data. Roda no CI (a
// fábrica é nuvem), então independe de máquina/TrueSync. OAuth via refresh token (secrets ZOHO_*).
// Sem os secrets -> zohoAtivo() é false e o chamador pula (no-op), sem quebrar nada.
import { randomUUID } from 'node:crypto';

const DC = () => process.env.ZOHO_DC || 'com';
export function zohoAtivo() {
  return !!(process.env.ZOHO_REFRESH_TOKEN && process.env.ZOHO_CLIENT_ID && process.env.ZOHO_CLIENT_SECRET);
}

let _at = null, _atExp = 0, _renovando = null;
// Várias chamadas em paralelo com o token vencido pedem UM token novo só (o Zoho limita as renovações).
function accessToken() {
  if (_at && Date.now() < _atExp) return Promise.resolve(_at);
  return _renovando ||= renovar().finally(() => { _renovando = null; });
}
async function renovar() {
  const body = new URLSearchParams({
    grant_type: 'refresh_token', refresh_token: process.env.ZOHO_REFRESH_TOKEN,
    client_id: process.env.ZOHO_CLIENT_ID, client_secret: process.env.ZOHO_CLIENT_SECRET,
  }).toString();
  const r = await fetch(`https://accounts.zoho.${DC()}/oauth/v2/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('zoho token -> ' + (j.error || r.status));
  _at = j.access_token; _atExp = Date.now() + 50 * 60 * 1000; // renova antes de 1h
  return _at;
}
const API = () => `https://www.zohoapis.${DC()}/workdrive/api/v1`;
async function authH() { return { Authorization: 'Zoho-oauthtoken ' + (await accessToken()) }; }

// ⚠️ O ZOHO INVALIDA O TOKEN ANTES DE 1 HORA. Em 06/10/2026, 21 min depois de o robô de cartões começar, o upload voltou
// 500 {"id":"F7003","title":"Invalid OAuth token."} e a rodada perdeu 9 cartões. Quem vê esse erro renova o token e
// tenta UMA vez de novo (o upload sobrescreve pelo nome, então repetir é seguro). Qualquer outro erro passa direto.
// `montar(cabecalho)` faz a chamada; o corpo da resposta de erro é lido numa cópia para não gastar o original.
async function zoho(montar) {
  for (let tentativa = 0; ; tentativa++) {
    let r = await montar(await authH());
    // Zoho devolve 429 quando as chamadas vêm rápido demais: espera e tenta de novo (até 3 vezes).
    for (let i = 1; r.status === 429 && i <= 3; i++) { await new Promise((ok) => setTimeout(ok, 2000 * i)); r = await montar(await authH()); }
    if (r.ok || tentativa) return r;
    const txt = await (r.clone ? r.clone() : r).text().catch(() => '');
    if (!/F7003|invalid.{0,3}oauth/i.test(txt)) return r;
    _at = null; // o próximo authH() pede um token novo
  }
}

// ⚠️ PAGINA. A API devolve poucos itens por chamada (50 no máximo); a pasta "Vessel Brasil" tem dezenas de
// subpastas, e sem paginar `acharOuCriarPasta` não via a pasta que já existia — e criava outra igual.
const POR_PAGINA = 50;
export async function listarPasta(parentId) {
  const todos = [];
  for (let offset = 0; offset < 5000; offset += POR_PAGINA) {
    const r = await zoho(async (h) => fetch(`${API()}/files/${parentId}/files?page%5Blimit%5D=${POR_PAGINA}&page%5Boffset%5D=${offset}`, { headers: { ...h, Accept: 'application/vnd.api+json' } }));
    const j = await r.json();
    // Leitura que falhou NÃO é pasta vazia: devolver [] aqui fazia "não achei" -> criar pasta duplicada.
    if (!r.ok) throw new Error('zoho listar ' + parentId + ' -> ' + r.status + ' ' + JSON.stringify(j.errors || j).slice(0, 120));
    const pagina = Array.isArray(j.data) ? j.data : [];
    todos.push(...pagina);
    if (pagina.length < POR_PAGINA) break;
  }
  return todos.map((d) => ({ id: d.id, name: (d.attributes?.name || '').trim(), folder: d.attributes?.is_folder }));
}

// Baixa o arquivo por id. Devolve Buffer; erro de rede/permissão LANÇA (arquivo que não veio não é arquivo vazio).
export async function baixarArquivo(fileId) {
  const r = await zoho(async (h) => fetch(`${API()}/download/${encodeURIComponent(fileId)}`, { headers: h }));
  if (!r.ok) throw new Error('zoho download ' + fileId + ' -> ' + r.status);
  return Buffer.from(await r.arrayBuffer());
}

// acha (por nome) ou cria uma subpasta dentro de parentId; devolve o id. Cacheado em memória por run.
const _cachePasta = new Map();
export async function acharOuCriarPasta(parentId, nome) {
  const chave = parentId + '/' + nome;
  if (_cachePasta.has(chave)) return _cachePasta.get(chave);
  const itens = await listarPasta(parentId);
  // NFC dos dois lados: "Cartões" pode estar composto ou decomposto (acento solto) conforme quem criou a pasta, e
  // sem normalizar "não achei" cria uma segunda pasta com o mesmo nome.
  let id = itens.find((x) => x.folder && x.name.normalize('NFC') === nome.normalize('NFC'))?.id;
  if (!id) {
    const r = await zoho(async (h) => fetch(`${API()}/files`, {
      method: 'POST', headers: { ...h, 'Content-Type': 'application/vnd.api+json', Accept: 'application/vnd.api+json' },
      body: JSON.stringify({ data: { attributes: { name: nome, parent_id: parentId }, type: 'files' } }),
    }));
    const j = await r.json();
    id = Array.isArray(j.data) ? j.data[0]?.id : j.data?.id;
    if (!id) throw new Error('zoho criar pasta "' + nome + '" -> ' + JSON.stringify(j.errors || j).slice(0, 150));
  }
  _cachePasta.set(chave, id);
  return id;
}

// multipart/form-data como Buffer (o shim curl-fetch do CI não serializa FormData nativo)
function multipart(parts) {
  const boundary = '----wd' + randomUUID().replace(/-/g, '');
  const chunks = [];
  const txt = (s) => chunks.push(Buffer.from(s, 'utf8'));
  for (const p of parts) {
    txt(`--${boundary}\r\n`);
    if (p.buf != null) { txt(`Content-Disposition: form-data; name="${p.name}"; filename="${p.filename}"\r\nContent-Type: ${p.mime}\r\n\r\n`); chunks.push(p.buf); txt('\r\n'); }
    else txt(`Content-Disposition: form-data; name="${p.name}"\r\n\r\n${p.value}\r\n`);
  }
  txt(`--${boundary}--\r\n`);
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

export async function uploadArquivo(parentId, filename, buf, mime = 'application/octet-stream') {
  const { body, contentType } = multipart([
    { name: 'content', filename, mime, buf },
    { name: 'parent_id', value: parentId },
    { name: 'filename', value: filename },
    { name: 'override-name-exist', value: 'true' },
  ]);
  const r = await zoho(async (h) => fetch(`${API()}/upload`, {
    method: 'POST', headers: { ...h, 'Content-Type': contentType }, body, curlMaxTime: 120,
  }));
  if (!r.ok) throw new Error('zoho upload "' + filename + '" -> ' + r.status + ' ' + (await r.text()).slice(0, 150));
  return true;
}
