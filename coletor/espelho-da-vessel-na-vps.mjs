// O ROBÔ DA PLANILHA DA VESSEL NA VPS (no lugar da edge `vessel-espelhar-lista` e do workflow do GitHub Actions).
//
// Roda ao lado do Postgres da API (padrão do robô `cartoes-ean`): lê as 11 abas direto do banco com `pg`, lê a conexão do Zoho
// de `acessos_conexoes` e atende a fila `disparos_pendentes` do robô `vessel-espelhar-lista` (o gatilho
// `vessel_lista_espera_espelhar` enfileira a cada cadastro; o pedido se junta enquanto ninguém atende). A planilha só é
// regravada se mudou (lib/espelho-da-vessel.mjs). O Actions não alcança o banco da VPS, e é por isso que este robô mora aqui.
//
//   DATABASE_URL=postgres://... node coletor/espelho-da-vessel-na-vps.mjs            # laço: um passo por minuto, até SIGTERM
//   DATABASE_URL=...            node coletor/espelho-da-vessel-na-vps.mjs --uma-vez  # um passo só (teste, cron)
//   DATABASE_URL=...            node coletor/espelho-da-vessel-na-vps.mjs --ensaio   # monta as abas e imprime; não grava no Zoho
//
// Mesmo protocolo da API (internal/banco/disparos.go: AtenderDisparo): pegar o pedido é UM comando com `for update skip
// locked`; 'atendendo' há mais de 30 min vira 'incerto'; no máximo UM atendimento a cada 5 min (cota do Zoho e do arquivo). Cada
// passo grava uma linha em robos_execucoes com o nome `vessel-espelhar-lista` (a tela de saúde dos robôs cobra esse nome).
// UM só processo por banco (advisory lock): dois seriam dois escritores no mesmo arquivo. Sem segredo no log: só mensagem.
import { rodada } from './lib/espelho-da-vessel.mjs';

export const ROBO = 'vessel-espelhar-lista';
export const INTERVALO_MIN = 5;

const COLUNAS_OK = /^(\*|[a-z0-9_]+(,[a-z0-9_]+)*)$/;
const TABELA_OK = /^[a-z0-9_]+$/;

/** Leitura no formato do PostgREST (to_json: timestamps ISO, numeric como número), que é o que montarAbas espera. */
export function lerPelaPg(cli) {
  return async ({ tabela, colunas }) => {
    if (!TABELA_OK.test(tabela) || !COLUNAS_OK.test(colunas)) throw new Error(`consulta recusada: ${tabela}`);
    if (!cli.__utc) { await cli.query("set time zone 'UTC'"); cli.__utc = true; } // o PostgREST do Supabase respondia em UTC
    const { rows } = await cli.query(`select to_json(t) as linha from (select ${colunas} from public."${tabela}") t`);
    return rows.map((r) => r.linha);
  };
}

export function conexaoPelaPg(cli) {
  return async () => {
    const { rows: [r] } = await cli.query(`select to_json(c) as linha from (select client_id, client_secret, refresh_token, data_center
      from public.acessos_conexoes where provedor = 'zoho' limit 1) c`);
    if (!r?.linha?.refresh_token) throw new Error('A Central não está conectada ao Zoho. Abra Acessos → Zoho e clique em conectar.');
    return r.linha;
  };
}

/** Um passo: devolve 'sem_pedido' | 'cedo' | 'feito' | 'falhou'. `executar` roda a rodada (injetável no teste). */
export async function passo(cli, executar, { intervaloMin = INTERVALO_MIN } = {}) {
  await cli.query(`update disparos_pendentes set situacao = 'incerto', atualizado_em = now(), erro = 'atendimento interrompido: sem resultado em 30 min'
     where robo = $1 and situacao = 'atendendo' and atualizado_em < now() - interval '30 minutes'`, [ROBO]);
  const { rows: [e] } = await cli.query(`select
      exists (select 1 from disparos_pendentes where robo = $1 and situacao = 'pendente') as espera,
      exists (select 1 from disparos_pendentes where robo = $1 and situacao in ('atendendo', 'feito', 'falhou', 'incerto')
              and atualizado_em > now() - make_interval(mins => $2::int)) as recente`, [ROBO, intervaloMin]);
  if (!e.espera) return 'sem_pedido';
  if (e.recente) return 'cedo';
  const { rows: [p] } = await cli.query(`update disparos_pendentes d set situacao = 'atendendo', atualizado_em = now()
     where d.id = (select id from disparos_pendentes where robo = $1 and situacao = 'pendente' order by id limit 1 for update skip locked)
     returning d.id`, [ROBO]);
  if (!p) return 'sem_pedido'; // outro atendente pegou
  let erro = null;
  try { await executar(); } catch (x) { erro = String(x?.message ?? x).slice(0, 400); }
  await cli.query(`update disparos_pendentes set situacao = $2, erro = $3, atualizado_em = now() where id = $1 and situacao = 'atendendo'`,
    [p.id, erro ? 'falhou' : 'feito', erro]);
  return erro ? 'falhou' : 'feito';
}

async function registrar(cli, inicio, estado, erro) {
  await cli.query(`insert into robos_execucoes (robo, disparado_em, status_code, ok, resposta, conferido_em)
     values ($1, $2, $3, $4, $5, now())`, [ROBO, inicio, erro ? 500 : 200, !erro, erro ? erro.slice(0, 500) : estado]);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!process.env.DATABASE_URL) { console.error('⛔ Falta DATABASE_URL.'); process.exit(1); }
  const { default: pg } = await import('pg');
  const cli = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await cli.connect();
  const ensaio = process.argv.includes('--ensaio');
  if (ensaio) {
    await rodada({ ler: lerPelaPg(cli), conexao: conexaoPelaPg(cli), ensaio: true, mostrar: process.argv.includes('--mostrar') });
    await cli.end();
    process.exit(0);
  }
  const { rows: [{ ok }] } = await cli.query(`select pg_try_advisory_lock(hashtext('robo:vessel-espelhar-lista')) as ok`);
  if (!ok) { console.error('outro processo já é o espelho deste banco'); process.exit(2); }
  const executar = () => rodada({ ler: lerPelaPg(cli), conexao: conexaoPelaPg(cli), log: () => {} });
  let parar = false;
  for (const s of ['SIGTERM', 'SIGINT']) process.on(s, () => { parar = true; });
  do {
    const inicio = new Date();
    let estado = null, erro = null;
    try { estado = await passo(cli, executar); } catch (x) { erro = String(x?.message ?? x); }
    try { await registrar(cli, inicio, estado, erro); } catch { /* a linha de saúde não derruba o robô */ }
    if (estado === 'falhou' || erro) console.error(`${new Date().toISOString()} ${erro ?? 'falhou'}`);
    if (process.argv.includes('--uma-vez')) break;
    for (let i = 0; i < 60 && !parar; i++) await new Promise((r) => setTimeout(r, 1000));
  } while (!parar);
  await cli.end();
}
