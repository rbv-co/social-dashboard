// O BANCO DO ROBÔ DE CONTEÚDO NA VPS (saída do Supabase, Plano 5.9/7).
//
// Os robôs de pauta (conteudo-ideias.mjs, conteudo-semana.mjs) e o vigia (conteudo-fila.mjs) leem e gravam o
// Postgres da API direto, com o papel `conteudo_robo` (ops/vps/api-db/papel-conteudo.sql), por
// CONTEUDO_DATABASE_URL. A senha NÃO vai na URL: o `pg` lê PGPASSWORD do ambiente (como o copia-do-banco.sh).
//
// Cada leitura sai como row_to_json: o MESMO JSON que o PostgREST devolvia (datas em ISO, números como número),
// então conteudo-contexto.mjs e os prompts não mudam.
//
// `Client` é injetável para o teste não precisar de banco; sem ele, usa o `pg` do coletor.
export async function abrirBanco(url, { Client } = {}) {
  if (!url) throw new Error('falta CONTEUDO_DATABASE_URL');
  if (!Client) ({ default: { Client } } = await import('pg'));
  const cli = new Client({ connectionString: url });
  let caiu = null;
  // Sem este ouvinte, a queda da conexão vira exceção não tratada no meio da chamada à IA.
  cli.on('error', (e) => { caiu = e; });
  await cli.connect();
  const vivo = () => {
    if (caiu) throw new Error(`a conexão com o banco caiu no meio da rodada: ${caiu.message}`);
    return cli;
  };
  const linhas = async (sql, valores = []) =>
    (await vivo().query(`select row_to_json(t)::text as j from (${sql}) t`, valores)).rows.map((x) => JSON.parse(x.j));
  const rodar = (sql, valores = []) => vivo().query(sql, valores);
  return { linhas, rodar, fechar: () => cli.end().catch(() => {}) };
}

// O job da fila. Quem o marcou `rodando` foi o vigia; o script só lê.
export async function lerJob(db, id) {
  const [job] = await db.linhas('select id, account_id, params from conteudo_jobs where id = $1', [id]);
  if (!job) throw new Error(`job ${id} não encontrado`);
  return job;
}

// As leituras que as duas pautas dividem. `ideias` muda de um robô para o outro (ver os chamadores).
// NUNCA lê access_token: o papel nem tem permissão nessa coluna.
export async function lerMarca(db, accountId, { pecasColunas, ideiasSql, ideiasValores }) {
  // Em série de propósito: o `pg` deprecia duas consultas ao mesmo tempo no mesmo cliente.
  const contas = await db.linhas('select id, name, username, conteudo_usa_portal from accounts where id = $1', [accountId]);
  const blocos = await db.linhas('select tipo, nome, texto from conteudo_blocos where account_id = $1 and ativo', [accountId]);
  const pecas = await db.linhas(`select ${pecasColunas} from conteudo_pecas where account_id = $1
               order by ${pecasColunas.includes('publicar_em') ? 'publicar_em' : 'publicado_em'} desc limit 60`, [accountId]);
  const ideias = await db.linhas(ideiasSql, ideiasValores);
  const doNicho = await db.linhas('select handle, nome, observacao from conteudo_concorrentes where account_id = $1 and ativo', [accountId]);
  return { conta: contas[0] || {}, blocos, pecas, ideias, doNicho };
}

// A leitura mais recente de cada peça publicada (o insumo que só existe por causa da Fase 3).
export async function metricasDasPecas(db, ids) {
  const metricas = await db.linhas(
    'select peca_id, capturado_em, alcance, curtidas from conteudo_metricas where peca_id = any($1::uuid[]) order by capturado_em desc',
    [ids],
  );
  const ultima = {};
  for (const m of metricas) if (!ultima[m.peca_id]) ultima[m.peca_id] = m;
  return ultima;
}

export const concorrentesDoPortal = (db) =>
  db.linhas('select marca, titulo, resumo from noticias_concorrentes order by rodada desc limit 8');

// Grava as ideias da rodada de uma vez só (tudo ou nada). `roteiro` é jsonb: vai como texto JSON, porque o
// `pg` transformaria o array em array do Postgres.
export async function gravarIdeias(db, accountId, ideias, { modelo, jobId }) {
  await db.rodar('begin');
  try {
    for (const i of ideias) {
      await db.rodar(
      `insert into conteudo_ideias (account_id, titulo, gancho, formato, pilar, roteiro, producao, porque_formato, cta,
         legenda_sugerida, hashtags_sugeridas, por_que_agora, origem, modelo, job_id)
       values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,'ia',$13,$14)`,
      [accountId, i.titulo, i.gancho || null, i.formato || null, i.pilar || null,
        JSON.stringify(Array.isArray(i.roteiro) ? i.roteiro : []), i.producao || null, i.porque_formato || null,
        i.cta || null, i.legenda_sugerida || null, i.hashtags_sugeridas || null, i.por_que_agora || null,
        modelo, jobId || null],
      );
    }
    await db.rodar('commit');
  } catch (e) { await db.rodar('rollback').catch(() => {}); throw e; }
}

// `and status = 'rodando'`: job que o vigia já expirou (ou outro fechou) não é reaberto nem sobrescrito.
export const concluirJob = (db, id, resultado) =>
  db.rodar(`update conteudo_jobs set status = 'concluido', resultado = $2::jsonb, updated_at = now() where id = $1 and status = 'rodando'`,
    [id, JSON.stringify(resultado)]);

export const falharJob = (db, id, erro) =>
  db.rodar(`update conteudo_jobs set status = 'erro', erro = $2, updated_at = now() where id = $1 and status = 'rodando'`,
    [id, String(erro).slice(0, 500)]);

// Telemetria (ia_execucoes) pelo mesmo papel; o `body` é o de registrar-execucao.mjs.
export const gravarExecucao = (db, b) =>
  db.rodar(
    `insert into ia_execucoes (robo, acao, modelo, input_tokens, output_tokens, chamadas, usd, duracao_ms, itens, unidade, status, detalhe, github_run_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [b.robo, b.acao, b.modelo, b.input_tokens, b.output_tokens, b.chamadas, b.usd, b.duracao_ms, b.itens, b.unidade,
      b.status, b.detalhe, b.github_run_id]);
