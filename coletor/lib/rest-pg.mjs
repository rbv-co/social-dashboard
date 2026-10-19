// O TRANSPORTE DOS ROBÔS "SÓ-REST" (plano 03 da virada Supabase → API Go).
//
// Nove robôs falavam com o PostgREST do Supabase por `fetch(`${REST}/tabela?filtro...`)`. Aqui o MESMO caminho vira SQL
// parametrizado no api-db, com o papel do robô (ops/vps/api-db/papel-robo-*.sql): o GRANT por coluna é a única tranca,
// então um robô só enxerga e grava o que o papel dele permite.
//
//   const r = await abrirRest();            // abre o banco (ou prepara o REST) ANTES de qualquer trabalho
//   await r.fetch(`${r.REST}/bling_pedido_nota?pedido_id=in.(1,2)`, { headers: r.sb });
//   await r.fechar();
//
// REST_VIA_PG=1 liga o pg (o rodar-robo.sh exporta com SAIU_DO_SUPABASE). Sem a flag nada muda: é o ROLLBACK da virada
// (`git revert` ou desligar a flag). A mera presença de DATABASE_URL NÃO decide: hoje ele pode apontar para o pooler do Supabase.
//
// Só o subconjunto que os robôs usam: filtros eq/neq/gt/gte/lt/lte/in/is, select de colunas, order, limit, POST (com
// on_conflict e Prefer merge/ignore-duplicates), PATCH e DELETE (estes só COM filtro). O resto é recusado em voz alta:
// ignorar um filtro em silêncio devolveria linhas demais (e um DELETE sem filtro apagaria a tabela).
//
// Valores sempre por parâmetro ($n); identificadores só passam pela lista segura abaixo.
import { lerCaminhoPostgrest, ErroDeTraducao } from '../../src/compartilhado/banco-pela-api.js';
import { abrirBanco } from './conteudo-banco.mjs';

const PREFIXO = 'pg://rest/';
const IDENT = /^[a-z_][a-z0-9_]*$/;
const OPERADORES = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' };

const ident = (n) => {
  if (!IDENT.test(n)) throw new ErroDeTraducao(`identificador fora da lista segura: ${n}`);
  return `"${n}"`;
};

export function modoPg(env = process.env) {
  if (env.REST_VIA_PG !== '1') return false;
  if (!env.DATABASE_URL) throw new Error('REST_VIA_PG=1 mas falta DATABASE_URL (a URL do api-db com o papel do robô)');
  if (/supabase\.(com|co)/.test(env.DATABASE_URL)) throw new Error('REST_VIA_PG=1 mas DATABASE_URL aponta para o Supabase (o banco agora é o novo)');
  return true;
}

// where + valores a partir dos filtros do caminho; `inicio` é o número do próximo $n.
function onde(filtros, alias, inicio = 1) {
  const valores = [];
  const p = (v) => { valores.push(v); return `$${inicio + valores.length - 1}`; };
  const partes = filtros.map(({ col, op, val }) => {
    const c = `${alias}.${ident(col)}`;
    if (OPERADORES[op]) return `${c} ${OPERADORES[op]} ${p(val)}`;
    if (op === 'in') {
      const m = /^\((.*)\)$/s.exec(val);
      if (!m) throw new ErroDeTraducao(`in sem tradução: ${val}`);
      const itens = m[1].split(',').map((s) => s.trim().replace(/^"(.*)"$/, '$1')).filter((s) => s !== '');
      if (!itens.length) return 'false';
      return `${c} in (${itens.map(p).join(', ')})`;
    }
    if (op === 'is' && ['null', 'true', 'false'].includes(val)) return `${c} is ${val}`;
    throw new ErroDeTraducao(`${col}=${op}.${val} sem tradução`);
  });
  return { sql: partes.length ? ` where ${partes.join(' and ')}` : '', valores };
}

const colunasDoCorpo = (linhas) => {
  const cols = [];
  for (const l of linhas) for (const k of Object.keys(l)) if (!cols.includes(k)) cols.push(k);
  if (!cols.length) throw new ErroDeTraducao('corpo sem colunas');
  return cols;
};

const resp = (status, corpo) => ({
  status, ok: status < 300,
  json: async () => (typeof corpo === 'string' ? JSON.parse(corpo) : corpo),
  text: async () => (typeof corpo === 'string' ? corpo : JSON.stringify(corpo ?? '')),
});

export async function abrirRest(env = process.env, { Client } = {}) {
  if (!modoPg(env)) {
    if (!env.SUPABASE_SERVICE_KEY) throw new Error('falta SUPABASE_SERVICE_KEY');
    const k = env.SUPABASE_SERVICE_KEY;
    return {
      via: 'rest', db: null,
      REST: (env.SUPABASE_URL || 'https://kounqtdoioootxqegkij.supabase.co') + '/rest/v1',
      sb: { apikey: k, Authorization: 'Bearer ' + k, 'Content-Type': 'application/json' },
      fetch: (...a) => globalThis.fetch(...a),
      fechar: async () => {},
    };
  }
  const db = await abrirBanco(env.DATABASE_URL, { Client });
  // Uma consulta por vez no mesmo cliente (o `pg` deprecia concorrência); a fila também mantém a ordem das escritas.
  let fila = Promise.resolve();
  const emFila = (fn) => { const p = fila.then(fn); fila = p.catch(() => {}); return p; };

  async function executar(url, init = {}) {
    if (!url.startsWith(PREFIXO)) throw new ErroDeTraducao(`URL fora do pg: ${url}`);
    const metodo = (init.method || 'GET').toUpperCase();
    const prefer = String((init.headers || {}).Prefer || '');
    const ret = prefer.includes('return=representation');
    const t = lerCaminhoPostgrest(url.slice(PREFIXO.length));
    const tab = ident(t.tabela);
    const corpo = init.body ? JSON.parse(init.body) : undefined;

    if (metodo === 'GET') {
      const cols = t.select && t.select !== '*' ? t.select.split(',').map((c) => `x.${ident(c.trim())}`).join(', ') : 'x.*';
      const w = onde(t.filtros, 'x');
      const ordem = t.ordem.length ? ` order by ${t.ordem.map((o) => `x.${ident(o.col)} ${o.asc ? 'asc' : 'desc'}`).join(', ')}` : '';
      const lim = t.limite != null ? ` limit ${Number.isInteger(t.limite) && t.limite >= 0 ? t.limite : (() => { throw new ErroDeTraducao('limit inválido'); })()}` : '';
      return resp(200, await db.linhas(`select ${cols} from public.${tab} x${w.sql}${ordem}${lim}`, w.valores));
    }
    if (metodo === 'POST') {
      const linhas = Array.isArray(corpo) ? corpo : [corpo];
      if (!linhas.length) return resp(201, []);
      const cols = colunasDoCorpo(linhas);
      const lista = cols.map(ident).join(', ');
      let sql = `insert into public.${tab} (${lista}) select ${lista} from json_populate_recordset(null::public.${tab}, $1::json)`;
      if (t.onConflict) {
        const chave = t.onConflict.split(',').map((c) => c.trim());
        const alvo = chave.map(ident).join(', ');
        const resto = cols.filter((c) => !chave.includes(c));
        if (prefer.includes('ignore-duplicates') || !resto.length) sql += ` on conflict (${alvo}) do nothing`;
        else if (prefer.includes('merge-duplicates')) sql += ` on conflict (${alvo}) do update set ${resto.map((c) => `${ident(c)} = excluded.${ident(c)}`).join(', ')}`;
        else throw new ErroDeTraducao('on_conflict sem Prefer de resolução');
      }
      if (ret) sql += ` returning to_json(${tab})::text as j`;
      const r = await db.rodar(sql, [JSON.stringify(linhas)]);
      return resp(201, ret ? r.rows.map((x) => JSON.parse(x.j)) : '');
    }
    if (metodo === 'PATCH' || metodo === 'DELETE') {
      if (!t.filtros.length) throw new ErroDeTraducao(`${metodo} sem filtro recusado`);
      let sql; let valores;
      if (metodo === 'PATCH') {
        const cols = colunasDoCorpo([corpo]);
        const w = onde(t.filtros, 't', 2);
        sql = `update public.${tab} as t set ${cols.map((c) => `${ident(c)} = s.${ident(c)}`).join(', ')} from json_populate_record(null::public.${tab}, $1::json) as s${w.sql}`;
        valores = [JSON.stringify(corpo), ...w.valores];
        if (ret) sql += ' returning to_json(t)::text as j';
      } else {
        const w = onde(t.filtros, 'x');
        sql = `delete from public.${tab} as x${w.sql}${ret ? ' returning to_json(x)::text as j' : ''}`;
        valores = w.valores;
      }
      const r = await db.rodar(sql, valores);
      return ret ? resp(200, r.rows.map((x) => JSON.parse(x.j))) : resp(204, '');
    }
    throw new ErroDeTraducao(`método sem tradução: ${metodo}`);
  }

  return {
    via: 'pg', db, REST: PREFIXO.slice(0, -1), sb: {},
    // Erro do banco (GRANT, duplicidade, tipo) vira resposta como a do PostgREST, para o robô tratar como já trata;
    // erro sem `code` (conexão caída, tradução recusada) sobe como exceção.
    fetch: (url, init) => emFila(async () => {
      try { return await executar(url, init); }
      catch (e) {
        if (!e.code) throw e;
        return resp({ 42501: 403, 23505: 409 }[e.code] || 400, JSON.stringify({ code: e.code, message: e.message }));
      }
    }),
    fechar: () => db.fechar(),
  };
}
