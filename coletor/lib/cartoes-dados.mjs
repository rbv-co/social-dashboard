// O BANCO DO ROBÔ DE CARTÕES EAN (plano 04 da virada Supabase → API Go).
//
// O robô (coletor/robo-de-cartoes.mjs) e o vigia (coletor/cartoes-fila.mjs) só falam com o banco por aqui, com dois
// transportes que devolvem a MESMA forma:
//   - REST do Supabase (SUPABASE_URL + SUPABASE_SERVICE_KEY): o de hoje, e o ROLLBACK da virada;
//   - `pg` no api-db com o papel `robo_cartoes` (ops/vps/api-db/papel-robo-cartoes.sql), quando CARTOES_DATABASE_URL existe
//     (o vigia a monta quando há CARTOES_DB_SENHA).
// Tirar CARTOES_DATABASE_URL do /etc/cartoes-ean.env e reiniciar o serviço volta ao REST. A senha NÃO vai na URL: o `pg`
// lê PGPASSWORD do ambiente (o vigia a exporta de CARTOES_DB_SENHA).
//
// O rest-pg.mjs não serve aqui: este robô chama RPC e embed (`vessel_lotes(sku)`), que ele recusa de propósito.
//
// ⚠️ UMA CONEXÃO POR OPERAÇÃO, e não uma aberta o pedido inteiro: o pedido leva minutos (Chrome, Zoho) e uma conexão parada
// por esse tempo cai sem avisar. Só a devolução (`pedido_terminou`) tenta de novo, e só se a CONEXÃO falhou: ela é
// idempotente (reaplica as mesmas marcas). `pegar_da_fila` nunca repete: se a resposta se perdeu depois do commit, repetir
// pegaria um SEGUNDO pedido e deixaria o primeiro `rodando` (a retaguarda `recolocar_travados` devolve esse à fila).
import { conexaoZoho, conexaoZohoPg } from './zoho-da-central.mjs';

// nome -> [parâmetro, tipo SQL] em ordem; é a lista fechada do que o papel pode chamar.
const RPCS = {
  vessel_cartao_recolocar_travados: [['p_minutos', 'int']],
  vessel_cartao_pegar_da_fila: [],
  vessel_cartao_pedido_terminou: [['p_pedido', 'uuid'], ['p_ok', 'boolean'], ['p_pasta', 'text'], ['p_erro', 'text'], ['p_pecas', 'text[]']],
};
const RETENTAVEIS = new Set(['vessel_cartao_pedido_terminou']);
const ESPERAS_MS = [2000, 8000, 20000];

export function modoPg(env = process.env) {
  if (!env.CARTOES_DATABASE_URL) return false;
  if (/supabase\.(com|co)/.test(env.CARTOES_DATABASE_URL)) throw new Error('CARTOES_DATABASE_URL aponta para o Supabase (o banco agora é o novo)');
  return true;
}

// Erro de conexão (rede, servidor reiniciando, 08/57), em oposição ao erro SQL (permissão, constraint), que repetir não resolve.
const deConexao = (e) => !/^[0-9A-Z]{5}$/.test(e?.code ?? '') || /^(08|57)/.test(e.code);

export async function abrirDados(env = process.env, { Client, esperar = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  return modoPg(env) ? dadosPg(env.CARTOES_DATABASE_URL, { Client, esperar }) : dadosRest(env);
}

// ── REST do Supabase (o que o robô fazia inline) ─────────────────────────────────────────────────────────────────────
function dadosRest({ SUPABASE_URL, SUPABASE_SERVICE_KEY }) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error('faltam SUPABASE_URL e SUPABASE_SERVICE_KEY (ou CARTOES_DATABASE_URL)');
  const cab = { apikey: SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY };
  const base = `${SUPABASE_URL}/rest/v1`;
  const ler = async (caminho) => {
    const r = await fetch(`${base}/${caminho}`, { headers: cab });
    if (!r.ok) throw new Error(`${caminho.split('?')[0]} -> ${r.status} ${(await r.text()).slice(0, 200)}`);
    return r.json();
  };
  return {
    via: 'rest',
    conexaoZoho: () => conexaoZoho(base, cab),
    async rpc(nome, corpo = {}) {
      const r = await fetch(`${base}/rpc/${nome}`, { method: 'POST', headers: { ...cab, 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
      const txt = await r.text();
      if (!r.ok) throw new Error(`${nome} -> ${r.status} ${txt.slice(0, 200)}`);
      return txt ? JSON.parse(txt) : null;
    },
    async pecas(codigos) {
      const linhas = [];
      for (let i = 0; i < codigos.length; i += 100) { // limite de tamanho da URL
        const lista = codigos.slice(i, i + 100).map((c) => `"${String(c).replace(/"/g, '')}"`).join(',');
        linhas.push(...await ler(`vessel_pecas?select=codigo,numero_na_serie,vessel_lotes(sku)&codigo=in.(${encodeURIComponent(lista)})`));
      }
      return linhas;
    },
    pedidosAbertos: () => ler('vessel_cartao_pedidos?situacao=in.(na_fila,rodando)&select=id,situacao,criado_em,pecas&order=criado_em'),
    naFila: (limite) => ler(`vessel_cartao_pedidos?situacao=eq.na_fila&select=id&limit=${Number(limite)}`),
    async guardarIds(linhas) {
      const r = await fetch(`${base}/vessel_cartao_arquivos?on_conflict=codigo,nome`, {
        method: 'POST', headers: { ...cab, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(linhas),
      });
      if (!r.ok) throw new Error(`vessel_cartao_arquivos -> ${r.status} ${(await r.text()).slice(0, 120)}`);
    },
  };
}

// ── pg no api-db, papel robo_cartoes ─────────────────────────────────────────────────────────────────────────────────
function dadosPg(url, { Client, esperar }) {
  // Uma conexão por operação (ver o cabeçalho). Cada leitura sai como row_to_json: o MESMO JSON que o PostgREST devolvia.
  const comBanco = async (fn) => {
    if (!Client) ({ default: { Client } } = await import('pg'));
    const cli = new Client({ connectionString: url, connectionTimeoutMillis: 15000, statement_timeout: 30000 });
    cli.on('error', () => {}); // a queda aparece como erro da query; sem ouvinte viraria exceção solta
    await cli.connect();
    try { return await fn(cli); } finally { await cli.end().catch(() => {}); }
  };
  const linhas = (sql, valores = []) => comBanco(async (cli) =>
    (await cli.query(`select row_to_json(t)::text as j from (${sql}) t`, valores)).rows.map((x) => JSON.parse(x.j)));
  return {
    via: 'pg',
    conexaoZoho: () => comBanco(conexaoZohoPg),
    async rpc(nome, corpo = {}) {
      const params = RPCS[nome];
      if (!params) throw new Error(`${nome}: função fora da lista do papel robo_cartoes`);
      const sql = `select public.${nome}(${params.map(([, t], i) => `$${i + 1}::${t}`).join(', ')}) as r`;
      const valores = params.map(([p]) => corpo[p] ?? null);
      for (let t = 0; ; t++) {
        try { return (await comBanco((cli) => cli.query(sql, valores))).rows[0].r; }
        catch (e) {
          if (!RETENTAVEIS.has(nome) || !deConexao(e) || t >= ESPERAS_MS.length) throw new Error(`${nome} -> ${e.code ?? 'sem conexão'} ${String(e.message).slice(0, 200)}`);
          console.log(`  aviso: ${nome} sem conexão (${e.message.slice(0, 80)}); tento de novo em ${ESPERAS_MS[t] / 1000}s`);
          await esperar(ESPERAS_MS[t]);
        }
      }
    },
    async pecas(codigos) {
      return linhas(`select p.codigo, p.numero_na_serie, case when l.id is null then null else json_build_object('sku', l.sku) end as vessel_lotes
        from vessel_pecas p left join vessel_lotes l on l.id = p.lote_id where p.codigo = any($1::text[])`, [codigos]);
    },
    pedidosAbertos: () => linhas(`select id, situacao, criado_em, pecas from vessel_cartao_pedidos where situacao in ('na_fila', 'rodando') order by criado_em`),
    naFila: (limite) => linhas(`select id from vessel_cartao_pedidos where situacao = 'na_fila' limit $1`, [Number(limite)]),
    async guardarIds(l) {
      const col = (k) => l.map((x) => x[k] ?? null);
      await comBanco((cli) => cli.query(
        `insert into vessel_cartao_arquivos (codigo, nome, zoho_id, pasta_id, atualizado_em)
         select * from unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::timestamptz[])
         on conflict (codigo, nome) do update set zoho_id = excluded.zoho_id, pasta_id = excluded.pasta_id, atualizado_em = excluded.atualizado_em`,
        [col('codigo'), col('nome'), col('zoho_id'), col('pasta_id'), col('atualizado_em')]));
    },
  };
}
