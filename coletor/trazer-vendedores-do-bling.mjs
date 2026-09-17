// A LISTA DE VENDEDORES DO BLING, COPIADA PARA O NOSSO BANCO.
//
//   node coletor/trazer-vendedores-do-bling.mjs [--ensaio]
//
// PARA QUE SERVE: a Client Advisor digita o nome no gerador de cartão, e o
// sistema pergunta "você é Fulana de Tal?" — o nome dessa pergunta sai DAQUI.
// Confirmado uma vez, o convite que ela manda (CA-03) e a venda que ela faz no
// Bling passam a ser a mesma pessoa, e o show rate dela ganha o "e quanto
// vendeu".
//
// ⚠️ POR QUE COPIAR, EM VEZ DE PERGUNTAR AO BLING NA HORA: o gerador é uma
// página pública, com a chave anônima. Ela não pode falar com o Bling — e não
// deve mesmo. A busca do nome tem de morrer dentro do nosso banco.
//
// ⚠️ NINGUÉM É APAGADO AQUI. Vendedor que sai do Bling vira `situacao = 'E'` e
// FICA: as vendas antigas dele continuam apontando para esta linha, e apagá-la
// deixaria essas vendas sem dono, sem erro nenhum aparecer.
import './lib/carregar-env.mjs';
import pg from 'pg';

const BLING = 'https://api.bling.com.br/Api/v3';
const ensaio = process.argv.includes('--ensaio');
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * O token, e a renovação só se precisar.
 *
 * ⚠️ RENOVAR ROTACIONA O `refresh_token`: renovar e não gravar de volta deixa o
 * próximo que usar o antigo ser recusado. Por isso a gravação vem junto, e por
 * isso só renovamos quando o atual já não serve — renovar por precaução, com
 * outro robô rodando ao lado, é o que derruba os dois.
 */
async function pegarToken(cli) {
  const { rows: [t] } = await cli.query(
    'select * from bling_tokens order by id desc limit 1');
  if (!t?.access_token) throw new Error('não há token do Bling guardado.');
  if (new Date(t.expires_at) > new Date(Date.now() + 5 * 60 * 1000)) return t.access_token;

  console.log('o token estava vencendo; renovando.');
  const credenciais = Buffer.from(`${t.client_id}:${t.client_secret}`).toString('base64');
  const r = await fetch(`${BLING}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded',
               Authorization: `Basic ${credenciais}` },
    body: `grant_type=refresh_token&refresh_token=${t.refresh_token}`,
  });
  if (!r.ok) throw new Error(`não consegui renovar o acesso ao Bling (${r.status}).`);
  const novo = await r.json();
  await cli.query(
    `update bling_tokens set access_token = $1, refresh_token = $2,
            expires_at = $3, updated_at = now() where id = $4`,
    [novo.access_token, novo.refresh_token,
     new Date(Date.now() + novo.expires_in * 1000).toISOString(), t.id]);
  return novo.access_token;
}

const cli = new pg.Client({ connectionString: process.env.DATABASE_URL });
await cli.connect();

try {
  const token = await pegarToken(cli);
  const cabecalho = { Authorization: `Bearer ${token}`, Accept: 'application/json' };

  // ── 1. a lista inteira ────────────────────────────────────────────────────
  const vendedores = new Map();
  for (let pagina = 1; pagina <= 20; pagina++) {
    const r = await fetch(`${BLING}/vendedores?pagina=${pagina}&limite=100`, { headers: cabecalho });
    if (!r.ok) throw new Error(`o Bling recusou a lista de vendedores (${r.status}).`);
    const lote = (await r.json()).data || [];
    for (const v of lote) vendedores.set(String(v.id), v);
    if (lote.length < 100) break;
    await espera(380);                              // o Bling limita 3 por segundo
  }
  console.log(`${vendedores.size} vendedores na lista do Bling`);

  // ── 2. os que VENDERAM mas não aparecem na lista ──────────────────────────
  // ⚠️ A LISTA NÃO TRAZ TODO MUNDO. Medido em 17/09/2026: dos 17 vendedores com
  // venda na janela de 90 dias, só 9 vinham na lista — os outros 8 (gente que
  // saiu, ou que está inativa) só aparecem pedindo um por um. Sem este passo, a
  // Client Advisor que trocou de loja não se acharia na pergunta.
  const { rows: comVenda } = await cli.query(
    `select distinct vendedor_id::text as id from public.vessel_pedidos
      where vendedor_id is not null`);
  const faltando = comVenda.map((v) => v.id).filter((id) => !vendedores.has(id));
  console.log(`${faltando.length} vendedores com venda que não vieram na lista; buscando um a um`);
  for (const id of faltando) {
    await espera(380);
    const r = await fetch(`${BLING}/vendedores/${id}`, { headers: cabecalho });
    if (r.ok) vendedores.set(id, (await r.json()).data);
    else console.log(`  ${id}: o Bling respondeu ${r.status}`);
  }

  // ── 3. gravar ─────────────────────────────────────────────────────────────
  if (ensaio) {
    console.log('\nENSAIO — nada foi gravado. O que entraria:\n');
    for (const v of vendedores.values())
      console.log(`  ${String(v.id).padEnd(12)} ${v.contato?.nome || '(sem nome)'}`);
    process.exit(0);
  }

  let gravados = 0;
  for (const v of vendedores.values()) {
    const nome = (v.contato?.nome || '').trim();
    if (!nome) continue;
    await cli.query(
      `insert into public.vessel_vendedores_bling
         (bling_vendedor_id, nome, chave, loja_id, situacao, atualizado_em)
       values ($1, $2, public.vessel_chave_do_nome($2), nullif($3, 0), $4, now())
       on conflict (bling_vendedor_id) do update
         set nome = excluded.nome, chave = excluded.chave,
             loja_id = excluded.loja_id, situacao = excluded.situacao,
             atualizado_em = now()`,
      [v.id, nome, v.loja?.id ?? 0, v.situacao || v.contato?.situacao || null]);
    gravados++;
  }

  const { rows: [conta] } = await cli.query(
    `select count(*)::int as total,
            count(*) filter (where situacao = 'A')::int as ativos,
            (select count(*)::int from public.vessel_client_advisors
              where bling_vendedor_id is not null) as ja_ligados
       from public.vessel_vendedores_bling`);
  console.log(`\n${gravados} gravados. Agora sao ${conta.total} vendedores (${conta.ativos} ativos), `
    + `${conta.ja_ligados} ja ligados a uma Client Advisor.`);
} catch (erro) {
  console.error('\n⛔ ' + erro.message);
  process.exitCode = 1;
} finally { await cli.end(); }
