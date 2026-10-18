// Ensaio dos papéis dos robôs `pg` no api-db: cada papel PLANEJA (EXPLAIN EXECUTE, nada é gravado) as instruções literais do
// código do robô dele; `permission denied` = GRANT que falta no papel-robo-*.sql. O PREPARE de robos-prepare.mjs roda como dono e
// não vê isso (a permissão só é checada ao planejar a execução).
// Uso (na VPS, de um checkout com coletor/node_modules): node ops/virada/robos-papeis-ensaio.mjs HOST BANCO DIR_SENHAS
//   HOST = IP do api-db na api_net. Senhas lidas de DIR_SENHAS/<arquivo>.senha, nunca impressas. Saída: 0 sem `permission denied`.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { instrucoes } from './robos-prepare.mjs';

const coletor = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'coletor');
const { Client } = createRequire(join(coletor, 'x.js'))('pg');

// papel -> [arquivo da senha, arquivos do coletor cujas instruções ele roda]
export const PAPEIS = {
  robo_reporte: ['robo-reporte', ['vps/reportar-rodada.mjs']],
  robo_selo: ['robo-selo', ['fotos-do-selo-do-bling.mjs', 'lib/fotos-do-selo.mjs']],
  robo_pedidos_vessel: ['robo-pedidos-vessel', ['trazer-vendedores-do-bling.mjs', 'trazer-pedidos-do-bling.mjs', 'lib/ajustes-de-valor.mjs', 'lib/colunas-existem.mjs']],
  robo_shopify: ['robo-shopify', ['trazer-pedidos-da-shopify.mjs', 'lib/colunas-existem.mjs']],
  robo_metaads_zoho: ['robo-metaads-zoho', ['meta-ads-no-zoho.mjs', 'lib/abas-do-meta-ads.mjs', 'lib/zoho-da-central.mjs', 'lib/ajustes-de-valor.mjs']],
  robo_vigia_meta: ['robo-vigia-meta', ['vigia-problemas-meta.mjs', 'lib/fonte-pg.mjs']],
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [host, banco, dir] = process.argv.slice(2);
  if (!host || !banco || !dir) { console.error('uso: HOST BANCO DIR_SENHAS'); process.exit(2); }
  let negados = 0;
  for (const [papel, [arq, arquivos]] of Object.entries(PAPEIS)) {
    const stmts = instrucoes(arquivos.map((f) => [f, readFileSync(join(coletor, f), 'utf8')]));
    const c = new Client({ host, port: 5432, user: papel, database: banco, password: readFileSync(join(dir, `${arq}.senha`), 'utf8').trim(), ssl: false });
    await c.connect();
    let ok = 0;
    for (const [i, { nome, sql }] of stmts.entries()) {
      try {
        await c.query('begin');
        await c.query(`prepare p${i} as ${sql}`);
        const { rows } = await c.query('select cardinality(parameter_types) n from pg_prepared_statements where name = $1', [`p${i}`]);
        await c.query(`explain execute p${i}${rows[0].n ? `(${Array(rows[0].n).fill('null').join(',')})` : ''}`);
        ok++;
      } catch (e) {
        if (e.code === '42501') negados++;
        console.log(`${e.code === '42501' ? 'NEGADO' : 'ERRO  '} ${papel} ${nome}: ${e.message}\n         ${sql.slice(0, 150)}`);
      } finally { await c.query('rollback').catch(() => {}); await c.query('deallocate all').catch(() => {}); }
    }
    console.log(`${papel}: ${ok}/${stmts.length} instruções planejadas`);
    await c.end();
  }
  process.exit(negados ? 1 : 0);
}
