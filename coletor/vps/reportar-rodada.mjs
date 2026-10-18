// Grava UMA rodada de robô em `robos_execucoes` pelo Postgres próprio (papel `robo_reporte`, ops/vps/api-db/papel-robo-reporte.sql).
// Chamado pelo rodar-robo.sh quando há REPORTAR_DATABASE_URL (a URL vai pelo ambiente, nunca por argumento).
// Uso: node reportar-rodada.mjs <robo> <status> <ok:true|false> <texto>
// NUNCA falha: banco fora, senha errada ou timeout viram uma linha no stderr e exit 0 — o painel é o segundo canal de aviso e
// não pode derrubar nem mudar o código de saída de um robô.
import pg from 'pg';

const [robo, status, ok, resposta] = process.argv.slice(2);
const cli = new pg.Client({ connectionString: process.env.REPORTAR_DATABASE_URL, connectionTimeoutMillis: 8000, query_timeout: 8000 });
cli.on('error', () => {});   // queda no meio: o catch abaixo já cobre; sem ouvinte vira exceção não tratada
try {
  await cli.connect();
  await cli.query(
    'insert into robos_execucoes (robo, status_code, ok, resposta, conferido_em) values ($1, $2, $3, $4, now())',
    [robo, Number(status), ok === 'true', resposta],
  );
} catch (e) {
  console.error(`aviso: não gravei a rodada de ${robo} em robos_execucoes (${e.code ?? e.name})`);
} finally {
  await cli.end().catch(() => {});
}
process.exit(0);
