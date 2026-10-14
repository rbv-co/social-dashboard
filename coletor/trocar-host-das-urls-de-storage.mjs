// Troca o HOST das URLs do Supabase Storage gravadas no banco (https://<projeto>.supabase.co/storage/v1/object/...) pelo da
// API (https://<host>/storage/v1/object/...): a rota /storage/v1/object/public/{bucket}/* serve o mesmo caminho, então a
// troca de host basta. Passo do roteiro da virada (NOTAS-DA-IMPLANTACAO, Plano 6, item 3).
//
// Uso:   DATABASE_URL=postgres://... node coletor/trocar-host-das-urls-de-storage.mjs --host-novo https://api.exemplo.com            (RELATÓRIO, não grava)
//        DATABASE_URL=...            node coletor/trocar-host-das-urls-de-storage.mjs --host-novo https://api.exemplo.com --aplicar
//
// Sem `--aplicar` só conta, por coluna. Com `--aplicar`: UMA transação; antes de mexer em cada tabela guarda as linhas que vão
// mudar em `bkp_urls_<AAAAMMDDHHMM>_<tabela>` (create table as select: some só quando alguém apagar); desfazer = copiar de
// volta. Colunas text, varchar e jsonb do schema public (jsonb por replace no texto). NÃO toca em outro schema nem em coluna
// de outro tipo; imprime contagens, nunca o conteúdo das linhas.
// `pg` só é carregado quando o script roda de verdade (o teste das funções puras não precisa dele nem do coletor/node_modules).

const ANTIGO = String.raw`https://[a-z0-9-]+\.supabase\.co(/storage/v1/object/(?:public|sign)/)`;

export function parseHostNovo(h) {
  let u;
  try { u = new URL(h); } catch { throw new Error('--host-novo precisa ser uma URL (https://host)'); }
  if (u.protocol !== 'https:' || u.pathname !== '/' || u.search || u.hash || u.username) {
    throw new Error('--host-novo: só a origem, em https (sem caminho, query nem usuário)');
  }
  return u.origin;
}

const id = (x) => '"' + String(x).replaceAll('"', '""') + '"';

/** A expressão que troca o host na coluna (jsonb vai e volta pelo texto). */
export function expressao(coluna, tipo, hostNovo) {
  const c = id(coluna);
  const troca = `regexp_replace(${tipo === 'jsonb' ? `${c}::text` : c}, '${ANTIGO}', $1 || '\\1', 'g')`;
  return tipo === 'jsonb' ? `(${troca})::jsonb` : troca;
}

export async function achar(cli) {
  const { rows } = await cli.query(`select c.table_name, c.column_name, c.data_type from information_schema.columns c
      join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
     where c.table_schema = 'public' and c.table_name not like 'bkp\\_urls\\_%' and c.data_type in ('text', 'character varying', 'jsonb') order by 1, 2`);
  const achadas = [];
  for (const r of rows) {
    const col = r.data_type === 'jsonb' ? `${id(r.column_name)}::text` : id(r.column_name);
    const { rows: [n] } = await cli.query(`select count(*)::int n from public.${id(r.table_name)} where ${col} ~ $1`, [ANTIGO]);
    if (n.n > 0) achadas.push({ tabela: r.table_name, coluna: r.column_name, tipo: r.data_type === 'jsonb' ? 'jsonb' : 'text', linhas: n.n });
  }
  return achadas;
}

export async function aplicar(cli, achadas, hostNovo, carimbo) {
  await cli.query('begin');
  try {
    const porTabela = new Map(); // agrupamento à mão: a VPS roda Node 20 (sem o groupBy do 21)
    for (const a of achadas) porTabela.set(a.tabela, [...(porTabela.get(a.tabela) ?? []), a]);
    for (const [tabela, cols] of porTabela) {
      const onde = cols.map((c) => `${c.tipo === 'jsonb' ? `${id(c.coluna)}::text` : id(c.coluna)} ~ '${ANTIGO}'`).join(' or ');
      const bkp = `bkp_urls_${carimbo}_${tabela}`.slice(0, 63);
      await cli.query(`create table public.${id(bkp)} as select * from public.${id(tabela)} where ${onde}`);
      const set = cols.map((c) => `${id(c.coluna)} = ${expressao(c.coluna, c.tipo, hostNovo)}`).join(', ');
      await cli.query(`update public.${id(tabela)} set ${set} where ${onde}`, [hostNovo]);
    }
    await cli.query('commit');
  } catch (e) { await cli.query('rollback'); throw e; }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const i = process.argv.indexOf('--host-novo');
  if (i < 0 || !process.env.DATABASE_URL) { console.error('uso: DATABASE_URL=... node coletor/trocar-host-das-urls-de-storage.mjs --host-novo https://api.exemplo.com [--aplicar]'); process.exit(1); }
  const hostNovo = parseHostNovo(process.argv[i + 1] || '');
  const { default: pg } = await import('pg');
  const cli = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await cli.connect();
  try {
    const achadas = await achar(cli);
    for (const a of achadas) console.log(`${a.tabela}.${a.coluna} (${a.tipo}): ${a.linhas} linha(s)`);
    console.log(`${achadas.length} coluna(s), ${achadas.reduce((s, a) => s + a.linhas, 0)} linha(s) com URL do Supabase Storage`);
    if (process.argv.includes('--aplicar') && achadas.length) {
      const d = new Date().toISOString().replace(/\D/g, '').slice(0, 12);
      await aplicar(cli, achadas, hostNovo, d);
      const resto = await achar(cli);
      console.log(`trocado para ${hostNovo}; backup em bkp_urls_${d}_<tabela>; sobraram ${resto.length} coluna(s) com a URL antiga`);
      process.exit(resto.length ? 1 : 0);
    } else console.log(process.argv.includes('--aplicar') ? 'nada a trocar' : 'relatório: nada foi gravado (use --aplicar)');
  } finally { await cli.end(); }
}
