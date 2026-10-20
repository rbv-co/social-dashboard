// Copia os objetos dos buckets do Supabase Storage para o disco da API (ARQUIVOS_DIR/<bucket>/<caminho>): o passo do
// roteiro da virada que o Plano 6 deixa pronto. NÃO muda nada no Supabase: só lê (lista e baixa).
//
// Uso:   SUPABASE_URL=https://<projeto>.supabase.co SUPABASE_SERVICE_KEY=... node coletor/copiar-storage-para-disco.mjs <destino> [bucket ...]
//        --ensaio   só lista e conta, sem gravar
// Padrão: todos os buckets da API (os de `arquivos/buckets.go`; `ig-cache` e `fotos-modelo` entraram em 20/10, só leitura).
//
// Idempotente: objeto que já está no destino com o mesmo tamanho é pulado; rodar de novo só traz o que falta.
// O destino precisa ser do mesmo usuário do serviço da API (ela lê e grava ali). A chave de serviço vem do ambiente e
// nunca é impressa; caminho de objeto só aparece em erro, nunca a URL assinada.
import { mkdir, stat, writeFile, rename } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

const BUCKETS = ['acessos-avatars', 'acessos-termos', 'arquivos', 'avatars', 'conteudo', 'fabrica-criativos', 'fotos-modelo', 'ig-cache', 'profile-pics', 'publico', 'vessel-curriculos'];
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const ensaio = process.argv.includes('--ensaio');
const [destino, ...pedidos] = args;
const URL_BASE = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const CHAVE = process.env.SUPABASE_SERVICE_KEY || '';
if (!destino || !URL_BASE || !CHAVE) {
  console.error('uso: SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node coletor/copiar-storage-para-disco.mjs <destino> [bucket ...] [--ensaio]');
  process.exit(1);
}
const buckets = pedidos.length ? pedidos : BUCKETS;
for (const b of buckets) if (!BUCKETS.includes(b)) { console.error(`bucket fora da lista da API: ${b}`); process.exit(1); }
const raiz = resolve(destino);
const cab = { Authorization: `Bearer ${CHAVE}`, apikey: CHAVE };

// lista uma "pasta" (a API do Storage lista um nível por vez; pasta vem sem `id`)
async function listar(bucket, prefixo) {
  const itens = [];
  for (let offset = 0; ; offset += 1000) {
    const r = await fetch(`${URL_BASE}/storage/v1/object/list/${bucket}`, {
      method: 'POST', headers: { ...cab, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix: prefixo, limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } }),
    });
    if (!r.ok) throw new Error(`listar ${bucket}/${prefixo}: HTTP ${r.status}`);
    const l = await r.json();
    itens.push(...l);
    if (l.length < 1000) return itens;
  }
}

async function* objetos(bucket, prefixo = '') {
  for (const it of await listar(bucket, prefixo)) {
    if (it.name === '.emptyFolderPlaceholder') continue;
    const caminho = prefixo ? `${prefixo}/${it.name}` : it.name;
    if (it.id === null || it.id === undefined) yield* objetos(bucket, caminho); // pasta
    else yield { caminho, tamanho: it.metadata?.size ?? null };
  }
}

const seguro = (p) => p.split('/').every((s) => s && s !== '.' && s !== '..' && !s.includes('\\') && !s.includes('\0'));

let copiados = 0, pulados = 0, falhas = 0, bytes = 0;
for (const bucket of buckets) {
  let n = 0;
  for await (const o of objetos(bucket)) {
    n++;
    if (!seguro(o.caminho)) { console.error(`pulei caminho inseguro em ${bucket}`); falhas++; continue; }
    const alvo = join(raiz, bucket, ...o.caminho.split('/'));
    if (!alvo.startsWith(join(raiz, bucket) + sep)) { falhas++; continue; }
    try {
      const st = await stat(alvo).catch(() => null);
      if (st && o.tamanho !== null && st.size === o.tamanho) { pulados++; continue; }
      if (ensaio) { copiados++; continue; }
      const r = await fetch(`${URL_BASE}/storage/v1/object/authenticated/${bucket}/${o.caminho.split('/').map(encodeURIComponent).join('/')}`, { headers: cab });
      if (!r.ok) throw new Error(`baixar: HTTP ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      if (o.tamanho !== null && buf.length !== o.tamanho) throw new Error(`tamanho ${buf.length} ≠ ${o.tamanho}`);
      await mkdir(dirname(alvo), { recursive: true });
      const tmp = `${alvo}.copia-${process.pid}`;
      await writeFile(tmp, buf, { mode: 0o640 });
      await rename(tmp, alvo);
      copiados++; bytes += buf.length;
    } catch (e) {
      falhas++;
      console.error(`falhou ${bucket}/${o.caminho}: ${e.message}`);
    }
  }
  console.log(`${bucket}: ${n} objeto(s)`);
}
console.log(`${ensaio ? 'ENSAIO: ' : ''}copiados ${copiados} (${(bytes / 1048576).toFixed(1)} MiB), já estavam ${pulados}, falhas ${falhas}`);
process.exit(falhas ? 1 : 0);
