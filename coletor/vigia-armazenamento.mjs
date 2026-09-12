// VIGIA DO ARMAZENAMENTO — soma o que cada balde do Storage ocupa e avisa antes de encher.
//
// POR QUE ELE EXISTE (19/08/2026): o plano grátis do Supabase dá 1 GB de arquivos.
// O projeto estava em 876 MB (88%) e ninguém tinha sido avisado — a conta só aparece
// se alguém abrir o painel. Passar do teto não dá erro bonito: a subida de arquivo
// começa a falhar, e no iamundi isso vira criativo que não sobe e foto que não aparece.
//
// Ele só LÊ. Não apaga nada. Quem apaga é a `faxina-fabrica.mjs` (sobras da Fábrica) e
// a `passo-faxina.mjs` (mídia órfã do ig-cache).
import fs from 'fs';

const env = {};
try { for (const l of fs.readFileSync(new URL('./.env', import.meta.url), 'utf8').split('\n')) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ''); } } catch (e) {}
const URL_SB = process.env.SUPABASE_URL || env.SUPABASE_URL || 'https://kounqtdoioootxqegkij.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_KEY || env.SUPABASE_SERVICE_KEY;
const WEBHOOK = process.env.ALERT_WEBHOOK_URL || env.ALERT_WEBHOOK_URL || '';
const TETO_GB = Number(process.env.TETO_GB || 1);        // plano grátis = 1 GB de arquivos
const AVISAR_EM = Number(process.env.AVISAR_EM || 80);   // % a partir da qual ele avisa (rodada segue verde)
const FALHAR_EM = Number(process.env.FALHAR_EM || 95);   // % a partir da qual a rodada fica vermelha

if (!KEY) { console.error('✗ falta SUPABASE_SERVICE_KEY.'); process.exit(1); }
const sbH = { apikey: KEY, Authorization: 'Bearer ' + KEY };
const jh = { ...sbH, 'Content-Type': 'application/json' };
const mb = (n) => (n / 1048576).toFixed(1) + ' MB';

async function listar(balde, prefixo = '') {
  let bytes = 0, arqs = 0, offset = 0;
  for (;;) {
    const r = await fetch(`${URL_SB}/storage/v1/object/list/${balde}`, {
      method: 'POST', headers: jh,
      body: JSON.stringify({ prefix: prefixo, limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } }),
    });
    if (!r.ok) break;
    const arr = await r.json();
    if (!Array.isArray(arr) || !arr.length) break;
    for (const o of arr) {
      if (!o || !o.name) continue;
      if (o.id) { bytes += Number(o.metadata?.size || 0); arqs++; }
      else { const d = await listar(balde, prefixo + o.name + '/'); bytes += d.bytes; arqs += d.arqs; }
    }
    if (arr.length < 1000) break;
    offset += 1000;
  }
  return { bytes, arqs };
}

const baldes = await (await fetch(URL_SB + '/storage/v1/bucket', { headers: sbH })).json();
if (!Array.isArray(baldes)) { console.error('✗ não consegui listar os baldes.'); process.exit(1); }

const linhas = [];
for (const b of baldes) linhas.push({ nome: b.name, ...await listar(b.name) });
linhas.sort((a, b) => b.bytes - a.bytes);

const total = linhas.reduce((s, l) => s + l.bytes, 0);
const teto = TETO_GB * 1073741824;
const pct = (total / teto) * 100;

console.log(`Armazenamento do Supabase — ${mb(total)} de ${TETO_GB} GB (${pct.toFixed(0)}%)`);
for (const l of linhas) console.log(`  ${l.nome.padEnd(20)} ${String(l.arqs).padStart(5)} arquivos  ${mb(l.bytes).padStart(10)}`);

// DOIS NÍVEIS, e a razão importa. A primeira versão deste robô saía com erro já
// aos 80% — e o projeto vive em 86%. Ou seja: ele deixaria a rodada VERMELHA
// todo santo dia, para sempre. Alarme que toca todo dia deixa de ser alarme: em
// uma semana ninguém mais olha, e aí uma falha DE VERDADE da faxina (que roda no
// mesmo job) fica escondida atrás do vermelho de sempre.
//
//   80%  → AVISO: a rodada segue verde e o recado aparece como anotação na aba
//          Actions. É informação, não emergência: ainda dá pra decidir com calma.
//   95%  → FALHA: aí é emergência. Faltam ~50 MB pro Storage começar a recusar
//          arquivo, e a rodada precisa gritar.
if (pct >= FALHAR_EM || pct >= AVISAR_EM) {
  const grave = pct >= FALHAR_EM;
  const maiores = linhas.slice(0, 3).map((l) => `${l.nome} ${mb(l.bytes)}`).join(', ');
  const msg = `Supabase do iamundi com ${pct.toFixed(0)}% do armazenamento (${mb(total)} de ${TETO_GB} GB). Maiores: ${maiores}.${grave ? ' Passando de 100%, subida de arquivo começa a FALHAR.' : ''}`;
  // Comando do GitHub Actions: faz o recado aparecer no topo da rodada e na
  // listagem, em vez de ficar enterrado no meio do log.
  console.log(`::${grave ? 'error' : 'warning'} title=Armazenamento do Supabase::${msg}`);
  console.error((grave ? '✗ ' : '⚠️ ') + msg);
  if (WEBHOOK) { try { await fetch(WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: msg, content: msg }) }); } catch (e) {} }
  process.exit(grave ? 1 : 0);
}
console.log('✓ dentro do teto.');
