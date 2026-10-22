// coletor/lib/storage-upload.mjs
// Upload resiliente dos criativos da Fábrica para o storage da API da Central
// (`PUT /arquivos/{bucket}/{path}`, token de serviço `srv_` com `meta.fabrica`).
// Antes subia no Supabase Storage, desligado em 22/10/2026 (plano 01-C).
//
// O proxy na frente às vezes devolve um 400/5xx/reset transitório no meio de um
// lote grande — um único blip derrubava o job inteiro e perdia até os criativos
// que já tinham subido. Retry com backoff só para o que pode passar (rede, 5xx, 408, 429); os demais 4xx
// (permissão, tamanho, tipo, caminho) são definitivos. `x-upsert: true`: o mesmo caminho 2x dá a mesma URL.
//
// Dependências injetáveis (fetchImpl/sleepImpl) pra testar sem rede.
import { setTimeout as sleep } from 'node:timers/promises';

const definitivo = (status) => status < 500 && ![408, 429].includes(status);

export async function subirStorageResiliente({
  url, token, bucket, path, buf,
  contentType = 'image/png',
  tentativas = 10,
  urlPublica = process.env.CENTRAL_PUBLIC_URL || 'https://central.rbvcompany.com',
  fetchImpl = fetch,
  sleepImpl = sleep,
  onRetry,
}) {
  if (!url || !String(token || '').trim()) throw new Error('upload exige CENTRAL_API_URL + CENTRAL_API_TOKEN: o Supabase Storage foi desligado');
  url = String(url || '').trim().replace(/\/+$/, '');
  let ultimo;
  for (let t = 1; t <= tentativas; t++) {
    let parar = false;
    try {
      const r = await fetchImpl(`${url}/arquivos/${bucket}/${path}`, {
        method: 'PUT',
        headers: { Authorization: 'Bearer ' + String(token).trim(), 'Content-Type': contentType, 'x-upsert': 'true' },
        body: buf,
      });
      if (r.ok) return `${urlPublica.replace(/\/+$/, '')}/storage/v1/object/public/${bucket}/${path}`;
      parar = definitivo(r.status);
      ultimo = new Error('upload ' + path + ' ' + r.status + ' ' + (await r.text()).slice(0, 120));
    } catch (e) { ultimo = e; }
    if (parar) break;
    if (t < tentativas) { onRetry?.(t, ultimo); await sleepImpl(Math.min(1500 * t, 8000)); }
  }
  throw ultimo;
}
