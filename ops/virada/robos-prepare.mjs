// As instruções SQL dos robôs que falam com o banco por `pg` valem no `api-db`? `PREPARE` valida tabela, coluna, função e tipo
// SEM executar nada (dentro de `begin read only` + `rollback`). Saída: o SQL para o psql; sem nenhum `ERROR`, passou.
//
//   node ops/virada/robos-prepare.mjs | ssh op 'docker exec -i api-db sh -c "psql -X -At -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\""' 2>&1 | grep -E '^ERROR'
//
// (15/10/2026, plano 06: 64 instruções, 0 erro.) Pega só texto literal que COMEÇA em select/insert into/update/delete from/with;
// o que leva `${…}` fica de fora (SQL montado em tempo de execução). Robô `pg` novo entra na lista abaixo.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROBOS_PG = [
  'fotos-do-selo-do-bling.mjs', 'lib/fotos-do-selo.mjs', 'trazer-vendedores-do-bling.mjs', 'trazer-pedidos-do-bling.mjs',
  'trazer-pedidos-da-shopify.mjs', 'guardar-copia-do-banco.mjs', 'lib/fonte-pg.mjs', 'vigia-problemas-meta.mjs',
  'meta-ads-no-zoho.mjs', 'lib/abas-do-meta-ads.mjs', 'espelho-da-vessel-na-vps.mjs', 'lib/espelho-da-vessel.mjs',
  'lembretes-da-vessel-na-vps.mjs', 'log-de-carocos.mjs', 'conteudo-fila.mjs', 'conteudo-ideias.mjs', 'conteudo-semana.mjs',
  'lib/conteudo-banco.mjs', 'lib/zoho-da-central.mjs', 'lib/ajustes-de-valor.mjs', 'lib/colunas-existem.mjs',
];

/** As instruções SQL literais de `textos` = [[nome, conteúdo]], sem repetir: [{ nome, sql }]. */
export function instrucoes(textos) {
  const vistos = new Set();
  const achadas = [];
  for (const [nome, t] of textos) {
    for (const m of t.matchAll(/`([^`]*)`|'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"/g)) {
      const s = (m[1] ?? m[2] ?? m[3] ?? '').trim();
      if (!s || s.includes('${')) continue;
      if (!/^(select|insert\s+into|update|delete\s+from|with)\b/i.test(s)) continue;
      if (!/\b(from|into|set)\b/i.test(s) && !/^select\s+(public\.)?[a-z_]+\(/i.test(s)) continue;
      const k = s.replace(/\s+/g, ' ').replace(/;\s*$/, '');
      if (vistos.has(k)) continue;
      vistos.add(k);
      achadas.push({ nome, sql: k });
    }
  }
  return achadas;
}

/** O SQL (para o psql) com um PREPARE por instrução encontrada em `textos` = [[nome, conteúdo]]. */
export function sqlDePrepare(textos) {
  const achadas = instrucoes(textos);
  let sql = 'begin read only;\n';
  achadas.forEach(({ nome, sql: k }, i) => {
    const n = i + 1;
    sql += `\\echo ## ${n} ${nome}\nsavepoint s${n};\nprepare p${n} as ${k};\nrollback to s${n};\n`;
  });
  return { sql: sql + 'rollback;\n', total: achadas.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const coletor = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'coletor');
  const { sql, total } = sqlDePrepare(ROBOS_PG.map((f) => [f, readFileSync(join(coletor, f), 'utf8')]));
  process.stdout.write(sql);
  process.stderr.write(`${total} instruções\n`);
}
