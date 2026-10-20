// O ROBÔ DOS CONTATOS DA LISTA DE ESPERA NO BLING (plano 07 da INTEGRACAO-CORE-2026-10).
//
// Escritor vivo de `vessel_lista_espera.bling_id/bling_em` (até 20/10/2026 só a edge do Supabase congelado escrevia). Roda na VPS
// ao lado do api-db (como o robô da planilha), um passo por execução, agendado por cron com flock (`vessel-servico contatos`):
//
//   DATABASE_URL=... CORE_API_TOKEN=... VESSEL_CONTATOS_BLING=1 node coletor/vessel-contatos-no-bling.mjs
//   ... --ensaio          só conta o que faria (nenhuma chamada ao Bling, nenhuma escrita)
//   ... --id 654 --id 655 só estas linhas (ação manual: vale mesmo com a flag desligada)
//
// Flag `VESSEL_CONTATOS_BLING` (padrão desligada): sem `=1` e sem `--id` o robô não faz nada. Tudo passa pelo proxy do Core (token e
// cota do Bling são dele). Cada linha é uma transação própria com `for update skip locked`; a chave de idempotência é estável, então
// nem duas instâncias criam dois contatos. `ultimo_erro` guarda o estado, em texto que começa por "bling " (a planilha usa a mesma
// coluna e NÃO pode apagar isto): `bling tentativa N/5: ...` (volta na próxima rodada), `bling incerto: ...` e `bling definitivo: ...`
// (não voltam sozinhos: incerto = conferir no Bling; definitivo = corrigir o cadastro e zerar `ultimo_erro`).
import { blingViaCore } from '../supabase/functions/_shared/core-bling-proxy.js';
import { contatoDaLinha } from './lib/contato-da-lista.mjs';

export const ROBO = 'vessel-contatos-no-bling';
export const TETO_TENTATIVAS = 5;
// Linhas por passo (1 passo por minuto): cada linha custa 2 a 3 chamadas ao Core, que divide os 150/min do Bling com todos os apps.
export const LOTE = 5;
const ELEGIVEL = `bling_em is null
  and (ultimo_erro is null or ultimo_erro !~ '^bling (incerto|definitivo)')
  and coalesce(substring(ultimo_erro from '^bling tentativa (\\d+)/')::int, 0) < ${TETO_TENTATIVAS}`;

const COLUNAS = 'id, nome, email, whatsapp, origem, criado_em, ultimo_erro';

/** Conta o que o robô pegaria (o ensaio). Só números. */
export async function ensaio(cli, { ids = [] } = {}) {
  const { rows } = await cli.query(`select origem, count(*)::int as n from vessel_lista_espera
     where ${ELEGIVEL} and (cardinality($1::bigint[]) = 0 or id = any($1)) group by origem order by origem`, [ids]);
  return rows;
}

/** Um passo. `proxy` é o `{ chamar }` do Core. Devolve `{ criados, reaproveitados, tenta, incertos, definitivos, pausa, ocupado }`.
 *  UM passo por banco por vez: trava de sessão (advisory) no começo, solta no fim. Nenhuma transação fica aberta durante as chamadas
 *  ao Bling (o api-db derruba sessão parada em transação aos 60 s e a trava da linha seguraria a RPC da pessoa que acabou de se
 *  cadastrar): cada linha é lida, levada ao Bling e gravada com `where bling_em is null` (se mudou no meio, não grava por cima). */
export async function passo(cli, proxy, { ids = [], limite = LOTE, espera = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const r = { criados: 0, reaproveitados: 0, tenta: 0, incertos: 0, definitivos: 0, pausa: null, ocupado: false };
  const { rows: [{ ok }] } = await cli.query(`select pg_try_advisory_lock(hashtext('robo:${ROBO}')) as ok`);
  if (!ok) { r.ocupado = true; return r; }
  const vistos = [];
  try {
    while (vistos.length < limite && !r.pausa) {
      const { rows: [linha] } = await cli.query(`select ${COLUNAS} from vessel_lista_espera
         where ${ELEGIVEL} and (cardinality($1::bigint[]) = 0 or id = any($1)) and id <> all($2::bigint[])
         order by id limit 1`, [ids, vistos]);
      if (!linha) break;
      vistos.push(linha.id);
      if (vistos.length > 1) await espera(400); // o Bling dá 3 chamadas por segundo para todos os apps
      const x = await contatoDaLinha(proxy, linha);
      if (x.pausa) { r.pausa = x.pausa; break; }
      if (x.id) {
        await cli.query(`update vessel_lista_espera set bling_id = $2, bling_em = now(),
           ultimo_erro = case when ultimo_erro like 'bling %' then null else ultimo_erro end where id = $1 and bling_em is null`, [linha.id, x.id]);
        r[x.reaproveitado ? 'reaproveitados' : 'criados']++;
      } else {
        const antes = Number(/^bling tentativa (\d+)\//.exec(linha.ultimo_erro ?? '')?.[1] ?? 0);
        const texto = x.tipo === 'tenta' ? `bling tentativa ${antes + 1}/${TETO_TENTATIVAS}: ${x.erro}` : `bling ${x.tipo}: ${x.erro.replace(/^incerto: /, '')}`;
        await cli.query('update vessel_lista_espera set ultimo_erro = $2 where id = $1 and bling_em is null', [linha.id, texto.slice(0, 500)]);
        r[{ tenta: 'tenta', incerto: 'incertos', definitivo: 'definitivos' }[x.tipo]]++;
      }
    }
  } finally {
    await cli.query(`select pg_advisory_unlock(hashtext('robo:${ROBO}'))`).catch(() => {});
  }
  return r;
}

/** Resumo sem dado pessoal para `robos_execucoes`. */
export const resumo = (r) => `${r.criados} criado(s), ${r.reaproveitados} reaproveitado(s), ${r.tenta} a tentar de novo, ${r.incertos} incerto(s), ${r.definitivos} recusado(s)`
  + (r.pausa ? `; parou (${r.pausa})` : '');

async function registrar(cli, inicio, r, erro) {
  const falhou = erro || r?.pausa || r?.incertos || r?.definitivos || r?.tenta;
  const movimento = erro || (r && (r.criados + r.reaproveitados + r.tenta + r.incertos + r.definitivos > 0 || r.pausa));
  if (!movimento) { // rodada ociosa: um batimento a cada 30 min basta para a tela de saúde não achar o robô parado
    const { rows: [u] } = await cli.query(`select max(conferido_em) > now() - interval '30 minutes' as recente from robos_execucoes where robo = $1`, [ROBO]);
    if (u.recente) return;
  }
  await cli.query(`insert into robos_execucoes (robo, disparado_em, status_code, ok, resposta, conferido_em) values ($1, $2, $3, $4, $5, now())`,
    [ROBO, inicio, falhou ? 500 : 200, !falhou, (erro ? String(erro.message ?? erro) : r ? resumo(r) : 'ocioso').slice(0, 500)]);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = process.argv.slice(2);
  const ids = arg.flatMap((a, i) => (a === '--id' ? [Number(arg[i + 1])] : [])).filter(Number.isInteger);
  const so_ensaio = arg.includes('--ensaio');
  if (!process.env.DATABASE_URL) { console.error('⛔ Falta DATABASE_URL.'); process.exit(1); }
  if (!so_ensaio && process.env.VESSEL_CONTATOS_BLING !== '1' && !ids.length) process.exit(0); // desligado
  const { default: pg } = await import('pg');
  const cli = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await cli.connect();
  let saida = 0;
  try {
    if (so_ensaio) {
      for (const l of await ensaio(cli, { ids })) console.log(`${l.origem}: ${l.n} a levar ao Bling`);
    } else {
      const proxy = blingViaCore({ ...process.env, CORE_BLING_PROXY: 'true' });
      const inicio = new Date();
      let r = null, erro = null;
      try { r = await passo(cli, proxy, { ids }); } catch (x) { erro = x; saida = 1; }
      if (r?.ocupado) { console.error('outro processo já é o robô de contatos deste banco'); process.exit(0); }
      try { await registrar(cli, inicio, r, erro); } catch { /* a linha de saúde não derruba o robô */ }
      console.log(`${inicio.toISOString()} ${erro ? `ERRO: ${String(erro.message ?? erro).slice(0, 200)}` : resumo(r)}`);
    }
  } finally {
    await cli.end();
  }
  process.exit(saida);
}
