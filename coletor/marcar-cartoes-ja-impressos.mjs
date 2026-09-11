// MARCA AS PEÇAS QUE JÁ TÊM CARTÃO IMPRESSO — de uma vez, olhando o Zoho.
//
//   node marcar-cartoes-ja-impressos.mjs            (só mostra o plano)
//   node marcar-cartoes-ja-impressos.mjs --gravar
//
// ⚠️ POR QUE ISTO EXISTE. `cartao_gerado_em` nasceu vazia em 11/09/2026, e é ela
// que impede o número de série de uma peça mudar depois de o cartão sair. Mas os
// cartões da primeira leva JÁ EXISTEM: 670 arquivos no Zoho, gerados em
// 07/09/2026. Sem esta marca, a trava nova protege só o futuro e as peças que
// já têm papel dentro da bolsa continuam podendo ser renumeradas — que é
// exatamente o defeito que ela veio impedir.
//
// ⚠️ E A MARCA NÃO É `now()`. A data é a da PASTA em que o cartão saiu. Marcar
// com a data de hoje faria a trilha dizer que o cartão da Maelle foi impresso
// depois de a bolsa já estar na loja.
//
// O casamento é por (chave do produto, posição na série) — a mesma conta do
// número de série. O nome do arquivo traz a posição: `<SKU>_cartao_07_frente.png`.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

const AQUI = '/Users/erickmartins/iamundi/coletor';
for (const raw of readFileSync(join(AQUI, '.env'), 'utf8').split('\n')) {
  const l = raw.trim(); if (!l || l.startsWith('#')) continue;
  const i = l.indexOf('='); if (i === -1) continue;
  const k = l.slice(0, i).trim(); let v = l.slice(i + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (!(k in process.env)) process.env[k] = v;
}

const ZOHO = process.env.VESSEL_FOTOS_ZOHO
  || '/Users/erickmartins/Library/CloudStorage/ZohoWorkDriveTrueSync-RBV&Company/01. RBV and Company'
   + '/04. Vessel Brasil/17. Marketing/Fotos por SKU (coletor)/Vessel Brasil';
const RAIZ = join(ZOHO, 'Cartões com EAN');
const gravar = process.argv.includes('--gravar');
const chave = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** O inventário do que EXISTE em papel: [{chave, posicao, dia}] */
function cartoesNoZoho() {
  const achados = [];
  for (const dia of readdirSync(RAIZ)) {
    // ⚠️ AS PASTAS DE BACKUP FICAM DE FORA. "Cartões com EAN - BKP 07-09-2026
    // (numero de serie antigo)" guarda 620 cartões que DEIXARAM de valer — é o
    // estrago que esta trava existe para não repetir. Marcá-los prenderia
    // números por causa de papel que foi para o lixo.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) continue;
    let dentro = [];
    try { if (!statSync(join(RAIZ, dia)).isDirectory()) continue; dentro = readdirSync(join(RAIZ, dia)); }
    catch { continue; }
    for (const pasta of dentro) {
      const caminho = join(RAIZ, dia, pasta);
      try { if (!statSync(caminho).isDirectory()) continue; } catch { continue; }
      const sku = (pasta.toUpperCase().match(/SS[0-9]+[A-Z]{1,2}\.[A-Z]?[0-9]+/) || [])[0];
      if (!sku) continue;
      for (const arquivo of readdirSync(caminho)) {
        const m = arquivo.match(/_cartao_(\d+)_frente\.png$/i);
        if (m) achados.push({ chave: chave(sku), posicao: Number(m[1]), dia });
      }
    }
  }
  return achados;
}

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true, ca: readFileSync(join(AQUI, 'supabase-ca.crt'), 'utf8') },
});
await client.connect();
try {
  const papeis = cartoesNoZoho();
  console.log(`cartões em papel no Zoho: ${papeis.length}`);

  const { rows: pecas } = await client.query(`
    select p.codigo, p.numero_na_serie, l.sku, p.gravada_em, p.cartao_gerado_em,
           exists (select 1 from public.vessel_registros r where r.codigo = p.codigo) as tem_garantia
      from public.vessel_pecas p join public.vessel_lotes l on l.id = p.lote_id`);

  const porChave = new Map();
  for (const c of papeis) {
    const k = `${c.chave}|${c.posicao}`;
    // Reimpressão: fica a data MAIS NOVA, que é a do papel que vale.
    if (!porChave.has(k) || porChave.get(k) < c.dia) porChave.set(k, c.dia);
  }

  const aMarcar = [];
  for (const p of pecas) {
    if (p.cartao_gerado_em) continue;
    const dia = porChave.get(`${chave(p.sku)}|${p.numero_na_serie}`);
    if (dia) aMarcar.push({ ...p, dia });
  }

  const novasPresas = aMarcar.filter((p) => !p.gravada_em && !p.tem_garantia);
  console.log(`peças no banco: ${pecas.length}`);
  console.log(`a marcar: ${aMarcar.length}`);
  console.log(`  destas, ${aMarcar.length - novasPresas.length} já estavam presas por gravação ou garantia`);
  console.log(`  e ${novasPresas.length} passam a ficar presas AGORA:`);
  for (const p of novasPresas) {
    console.log(`    ${p.codigo}  ${p.sku} nº ${p.numero_na_serie}  (cartão de ${p.dia})`);
  }

  if (!gravar) { console.log('\nnada gravado — use --gravar'); process.exit(0); }

  // Uma transação só: ou todas ficam marcadas, ou nenhuma. Metade marcada é o
  // pior dos mundos — ninguém sabe onde parou.
  await client.query('begin');
  let n = 0;
  for (const p of aMarcar) {
    const r = await client.query(
      `update public.vessel_pecas set cartao_gerado_em = $2::date
        where codigo = $1 and cartao_gerado_em is null`, [p.codigo, p.dia]);
    n += r.rowCount;
  }
  await client.query('commit');
  console.log(`\n✓ ${n} peça(s) marcadas com a data do papel.`);
} catch (e) {
  await client.query('rollback').catch(() => {});
  console.error('✗ FALHOU:', e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
