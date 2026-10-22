// coletor/lib/storage-upload.mjs
// Upload resiliente dos criativos da Fábrica para o storage da API da Central
// (`PUT /arquivos/{bucket}/{path}`, token de serviço `srv_` com `meta.fabrica`).
// Antes subia no Supabase Storage, desligado em 22/10/2026 (plano 01-C).
//
// O proxy na frente às vezes devolve um 400/5xx/reset transitório no meio de um
// lote grande — um único blip derrubava o job inteiro e perdia até os criativos
// que já tinham subido. Retry com backoff; 401/403/413/415 são definitivos (não
// adianta repetir). `x-upsert: true`: subir o mesmo caminho 2x dá a mesma URL.
//
// Dependências injetáveis (fetchImpl/sleepImpl) pra testar sem rede.
import { setTimeout as sleep } from 'node:timers/promises';

const DEFINITIVOS = [401, 403, 413, 415];

export async function subirStorageResiliente({
  url, token, bucket, path, buf,
  contentType = 'image/png',
  tentativas = 10,
  urlPublica = process.env.CENTRAL_PUBLIC_URL || 'https://central.rbvcompany.com',
  fetchImpl = fetch,
  sleepImpl = sleep,
  onRetry,
}) {
  if (!url || !token) throw new Error('upload exige CENTRAL_API_URL + CENTRAL_API_TOKEN: o Supabase Storage foi desligado');
  let ultimo;
  for (let t = 1; t <= tentativas; t++) {
    let definitivo = false;
    try {
      const r = await fetchImpl(`${url}/arquivos/${bucket}/${path}`, {
        method: 'PUT',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': contentType, 'x-upsert': 'true' },
        body: buf,
      });
      if (r.ok) return `${urlPublica.replace(/\/+$/, '')}/storage/v1/object/public/${bucket}/${path}`;
      definitivo = DEFINITIVOS.includes(r.status);
      ultimo = new Error('upload ' + path + ' ' + r.status + ' ' + (await r.text()).slice(0, 120));
    } catch (e) { ultimo = e; }
    if (definitivo) break;
    if (t < tentativas) { onRetry?.(t, ultimo); await sleepImpl(Math.min(1500 * t, 8000)); }
  }
  throw ultimo;
}
