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

/** Timeout ou queda de rede: a chamada ao Zoho pode ter chegado e a resposta não (nunca presumir que falhou). */
export const semResposta = (x) => ['AbortError', 'TimeoutError'].includes(x?.name) || (x instanceof TypeError && /fetch failed/i.test(x.message));

/** Marca a lista com o resultado da rodada (era o que a edge fazia, index.ts:561-584; o robô da VPS não gravava `planilha_em`).
 *  Sucesso: `planilha_em` só nas linhas criadas ATÉ o instante em que a rodada começou a ler (quem chegou durante o envio não
 *  entrou na planilha e fica para a próxima). Falha: o motivo vai nas linhas que ainda esperam (ou, se nenhuma espera, na mais nova);
 *  o estado do robô de contatos (`ultimo_erro` que começa por "bling ") nunca é sobrescrito. Relança o erro. */
export function comMarcaNaLista(cli, executar) {
  return async () => {
    const { rows: [{ t }] } = await cli.query('select now()::text as t');
    try {
      await executar();
    } catch (x) {
      const frase = String(x?.message ?? x).slice(0, 400);
      const { rowCount } = await cli.query(`update vessel_lista_espera set ultimo_erro = $1 where planilha_em is null
         and (ultimo_erro is null or ultimo_erro not like 'bling %')`, [frase]);
      if (!rowCount) {
        await cli.query(`update vessel_lista_espera set ultimo_erro = $1 where id = (select max(id) from vessel_lista_espera
           where planilha_em is not null and (ultimo_erro is null or ultimo_erro not like 'bling %'))`, [frase]);
      }
      throw x;
    }
    await cli.query(`update vessel_lista_espera set planilha_em = now() where planilha_em is null and criado_em <= $1::timestamptz`, [t]);
    // planilha em dia: o erro dela (inclusive o que ficou na linha mais nova quando nenhuma esperava) deixa de valer
    await cli.query(`update vessel_lista_espera set ultimo_erro = null where ultimo_erro is not null and ultimo_erro not like 'bling %' and planilha_em is not null`);
  };
}

/** Um passo: devolve 'sem_pedido' | 'cedo' | 'feito' | 'falhou' | 'incerto'. `executar` roda a rodada (injetável no teste);
 *  `aoErro` recebe a mensagem quando falhou/incerto (a linha de saúde precisa dela). */
export async function passo(cli, executar, { intervaloMin = INTERVALO_MIN, aoErro = () => {} } = {}) {
  await cli.query(`update disparos_pendentes set situacao = 'incerto', atualizado_em = now(), erro = 'atendimento interrompido: sem resultado em 30 min'
     where robo = $1 and situacao = 'atendendo' and atualizado_em < now() - interval '30 minutes'`, [ROBO]);
  await cli.query(`delete from disparos_pendentes where robo = $1 and situacao in ('feito', 'falhou', 'incerto')
     and atualizado_em < now() - interval '30 days'`, [ROBO]);
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
  let erro = null, estado = 'feito';
  try { await executar(); } catch (x) { erro = String(x?.message ?? x).slice(0, 400); estado = semResposta(x) ? 'incerto' : 'falhou'; }
  const { rowCount } = await cli.query(`update disparos_pendentes set situacao = $2, erro = $3, atualizado_em = now() where id = $1 and situacao = 'atendendo'`,
    [p.id, estado, erro]);
  if (!rowCount) { // passou de 30 min: a reconciliação já a marcou 'incerto' e o resultado se perderia calado
    erro = `pedido ${p.id} já não estava atendendo (reconciliado como incerto); resultado '${estado}' não gravado`; estado = 'incerto';
  }
  if (erro) aoErro(erro);
  return estado;
}

async function registrar(cli, inicio, estado, erro) {
  await cli.query(`insert into robos_execucoes (robo, disparado_em, status_code, ok, resposta, conferido_em)
     values ($1, $2, $3, $4, $5, now())`, [ROBO, inicio, erro ? 500 : 200, !erro, erro ? erro.slice(0, 500) : estado]);
}

/** O laço do serviço. `umaVez` dá UM passo e termina com `cli.end()` sem reentrar: o fim da conexão que o próprio laço provoca
 *  não é queda (antes, `on('end')` via `parar=false`, saía com 1 e a prova do t+19 da virada falhava por desenho). */
export async function servir(cli, executar, { umaVez = false, sair = process.exit, esperaS = 60 } = {}) {
  let parar = false;
  const sinal = () => { parar = true; };
  const sinais = ['SIGTERM', 'SIGINT'];
  for (const s of sinais) process.on(s, sinal);
  // pg.Client não reconecta e o advisory lock vai com a conexão: cair é melhor que girar em falso (systemd: Restart=always)
  cli.on('error', (x) => { console.error(`conexão com o banco caiu: ${x.message}`); sair(1); });
  cli.on('end', () => { if (!parar) sair(1); });
  do {
    const inicio = new Date();
    let estado = null, erro = null;
    try { estado = await passo(cli, executar, { aoErro: (m) => { erro = m; } }); } catch (x) { erro = String(x?.message ?? x); }
    try { await registrar(cli, inicio, estado, erro); } catch { /* a linha de saúde não derruba o robô */ }
    if (erro) console.error(`${new Date().toISOString()} ${erro}`);
    if (umaVez) parar = true;
    for (let i = 0; i < esperaS && !parar; i++) await new Promise((r) => setTimeout(r, 1000));
  } while (!parar);
  for (const s of sinais) process.off(s, sinal);
  await cli.end();
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
  // Sem prazo, uma chamada travada do Zoho prende o único processo (e quem leva 'atendendo' a 'incerto' é ele mesmo).
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = (u, o = {}) => fetchOriginal(u, { signal: AbortSignal.timeout(120_000), ...o });
  const executar = comMarcaNaLista(cli, () => rodada({ ler: lerPelaPg(cli), conexao: conexaoPelaPg(cli), log: () => {} }));
  await servir(cli, executar, { umaVez: process.argv.includes('--uma-vez') });
}
