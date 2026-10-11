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
  // A senha NÃO vai na URL: o `pg` lê PGPASSWORD do ambiente quando a URL não a traz (é como o copia-do-banco.sh a
  // entrega), então nenhuma URL com senha circula em log, erro ou argumento.
  const cfg = { connectionString: url };
  let cli = new Client(cfg);
  // Sem este ouvinte, a queda da conexão (api-db reiniciado durante os minutos de envio ao Zoho) vira exceção não
  // tratada. Com ele, a próxima leitura falha com frase clara e o registro final reconecta.
  let caiu = null;
  cli.on('error', (e) => { caiu = e; });
  await cli.connect();
  const vivo = () => {
    if (caiu) throw new Error(`a conexão com o banco caiu no meio da rodada: ${caiu.message}`);
    return cli;
  };
  return {
    /**
     * Todas as tabelas do schema public (a regra é copiar TUDO menos o que o robô exclui).
     * ⚠️ `pg_tables` e não `information_schema.tables`: esta só mostra as tabelas em que o papel tem privilégio, e a
     * que ele não pode ler SUMIRIA da cópia sem erro (a trava de encolhimento só olha o manifesto novo). Com
     * `pg_tables` ela aparece e a leitura falha ALTO ("permission denied"); só as de SEM_COPIA são puladas, sem ler.
     * Views não entram (não são tabelas): a cópia guarda os dados, as views vêm do esquema.
     */
    async tabelas() {
      const r = await vivo().query(`select tablename from pg_tables where schemaname = 'public' order by 1`);
      return r.rows.map((x) => {
        if (!NOME_DE_TABELA.test(x.tablename)) throw new Error(`nome de tabela recusado: ${x.tablename}`);
        return x.tablename;
      });
    },
    /** Uma tabela inteira. O nome vem do próprio banco, mas vai validado e entre aspas mesmo assim. */
    async ler(nome) {
      if (!NOME_DE_TABELA.test(nome)) throw new Error(`nome de tabela recusado: ${nome}`);
      const r = await vivo().query(`select row_to_json(t)::text as j from public."${nome}" t`);
      return r.rows.map((x) => JSON.parse(x.j));
    },
    /** A linha da rodada em robos_execucoes (o painel de saúde cobra este robô como crítico). */
    async registrar(deuCerto, recado) {
      const sql = `insert into robos_execucoes (robo, ok, status_code, resposta, conferido_em)
        values ($1, $2, $3, $4, now())`;
      const valores = [NOME_DO_ROBO, deuCerto, deuCerto ? 200 : 500, String(recado).slice(0, 2000)];
      if (!caiu) return void await cli.query(sql, valores);
      // A conexão caiu depois da leitura (ex.: durante o envio): reconecta só para deixar o registro.
      const novo = new Client(cfg);
      novo.on('error', () => {});
      await novo.connect();
      try { await novo.query(sql, valores); } finally { await novo.end().catch(() => {}); }
    },
    /** A conexão do Zoho que o dono liga em Acessos → Zoho (a mesma de antes, agora lida do banco novo). */
    async conexaoZoho() {
      const r = await vivo().query(`select client_id, client_secret, refresh_token, data_center
        from acessos_conexoes where provedor = 'zoho' limit 1`);
      const c = r.rows[0];
      if (!c?.refresh_token) {
        throw new Error('A Central não está conectada ao Zoho. Abra Acessos → Zoho e clique em conectar.');
      }
      return c;
    },
    fechar: () => (caiu ? Promise.resolve() : cli.end()),
  };
}
