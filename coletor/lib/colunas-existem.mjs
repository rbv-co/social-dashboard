// coletor/lib/colunas-existem.mjs
//
// ⚠️ POR QUE ISTO EXISTE (achado C5 da revisão final, 17/09/2026)
//
// `coletor/trazer-pedidos-do-bling.mjs` roda todo dia às 07h34 UTC direto da
// `main` (.github/workflows/pedidos-da-vessel.yml). Se a migration que cria
// `vessel_pedidos.observacoes`/`observacoes_internas`
// (db/migrations/2026-09-17-vessel-registro-com-conta.sql) entrar na `main`
// ANTES de ser aplicada no banco, o robô morre com `column "observacoes" does
// not exist` — e a VENDA DO DIA inteira não entra, em silêncio, como toda
// falha de cron neste projeto.
//
// O robô confere, uma vez por rodada, se as colunas existem de verdade no
// banco (via `information_schema`, não supondo pela data do arquivo) e grava
// SEM elas quando faltarem, avisando no log. A venda nunca se perde calada —
// o pior que acontece é `observacoes` ficar vazia até alguém aplicar a
// migration, que é exatamente o estado de "antes desta fase existir".
//
// Recebe uma função `consulta(sql, params) => Promise<{rows}>` em vez do
// cliente do `pg` direto, no mesmo padrão de `canaisDeFoco` em
// `relatorios-comerciais.mjs`: dá para testar sem banco de verdade.
export async function colunasExistem(consulta, tabela, colunas) {
  const { rows } = await consulta(
    `select column_name from information_schema.columns
      where table_schema = 'public' and table_name = $1 and column_name = any($2::text[])`,
    [tabela, colunas]);
  const achadas = new Set(rows.map((r) => r.column_name));
  return colunas.every((c) => achadas.has(c));
}
