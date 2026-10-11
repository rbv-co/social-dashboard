// A FONTE DA CÓPIA DE SEGURANÇA NO POSTGRES PRÓPRIO (saída do Supabase, Plano 4).
//
// Depois do corte não existe mais PostgREST: a cópia (coletor/guardar-copia-do-banco.mjs, agendada
// NA VPS por coletor/vps/robos.cron) lê o Postgres da API direto, com o papel SÓ LEITURA `copia`
// (ops/vps/api-db/papel-copia.sql), por COPIA_DATABASE_URL. Cada linha sai como row_to_json — o MESMO
// JSON que o PostgREST devolvia (ele monta a resposta com as funções JSON do próprio Postgres), então
// os arquivos, o manifesto e a conferência mensal não mudam.
//
// `Client` é injetável para o teste não precisar de banco; sem ele, usa o `pg` do coletor.
export const NOME_DO_ROBO = 'guardar-copia-do-banco';

const NOME_DE_TABELA = /^[a-z_][a-z0-9_]*$/;

export async function abrirFontePg(url, { Client } = {}) {
  if (!Client) ({ default: { Client } } = await import('pg'));
  const cli = new Client({ connectionString: url });
  await cli.connect();
  return {
    /** Todas as tabelas do schema public (a regra é copiar TUDO menos o que o robô exclui). */
    async tabelas() {
      const r = await cli.query(`select table_name from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`);
      return r.rows.map((x) => x.table_name);
    },
    /** Uma tabela inteira. O nome vem do próprio banco, mas vai validado e entre aspas mesmo assim. */
    async ler(nome) {
      if (!NOME_DE_TABELA.test(nome)) throw new Error(`nome de tabela recusado: ${nome}`);
      const r = await cli.query(`select row_to_json(t)::text as j from public."${nome}" t`);
      return r.rows.map((x) => JSON.parse(x.j));
    },
    /** A linha da rodada em robos_execucoes (o painel de saúde cobra este robô como crítico). */
    async registrar(deuCerto, recado) {
      await cli.query(`insert into robos_execucoes (robo, ok, status_code, resposta, conferido_em)
        values ($1, $2, $3, $4, now())`, [NOME_DO_ROBO, deuCerto, deuCerto ? 200 : 500, String(recado).slice(0, 2000)]);
    },
    /** A conexão do Zoho que o dono liga em Acessos → Zoho (a mesma de antes, agora lida do banco novo). */
    async conexaoZoho() {
      const r = await cli.query(`select client_id, client_secret, refresh_token, data_center
        from acessos_conexoes where provedor = 'zoho' limit 1`);
      const c = r.rows[0];
      if (!c?.refresh_token) {
        throw new Error('A Central não está conectada ao Zoho. Abra Acessos → Zoho e clique em conectar.');
      }
      return c;
    },
    fechar: () => cli.end(),
  };
}
