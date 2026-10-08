// coletor/trazer-pedidos-da-shopify.mjs
//
// TRAZ OS PEDIDOS DA LOJA SHOPIFY, DIRETO DA API DELA — sem passar pelo Bling.
//
//   node coletor/trazer-pedidos-da-shopify.mjs              # janela de 30 dias
//   node coletor/trazer-pedidos-da-shopify.mjs --dias=90
//   node coletor/trazer-pedidos-da-shopify.mjs --ensaio     # lê e não grava
//
// ⚠️ POR QUE ESTE ROBÔ EXISTE
// A Loja Shopify (loja_id 205512275 no Bling) é lida hoje pelas telas de venda
// através do Bling. O dono quer parar de depender do Bling pra esta loja —
// ver docs/superpowers/specs/2026-10-03-pedidos-da-shopify-direto-design.md.
//
// ⚠️ ESTE ROBÔ SÓ SABE QUE FOI LIGADO QUANDO SHOPIFY_SHOP E UMA CREDENCIAL
// (SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET, ou SHOPIFY_ACCESS_TOKEN) EXISTIREM
// EM coletor/.env — mesmos nomes de coletor/estoque-do-site.mjs. Até lá, ele
// PARA (lança) e diz exatamente o que falta. Não é erro silencioso: o robô do Bling continua
// rodando normalmente, e este é um robô SEPARADO (cron próprio), então faltar
// a credencial da Shopify não derruba a importação de mais nada.
//
// ⚠️ MESMO DESENHO DE CONFIANÇA DO ROBÔ DO BLING: uma rodada funda (30 dias)
// 1x por dia, mais uma conferência de janela curta de hora em hora — pra
// pegar pedido que mudou de status (ex: Pix confirmado depois) sem esperar o
// dia seguinte. Ver .github/workflows/pedidos-da-shopify.yml.
//
// ⚠️ RISCO ACEITO: ESCRITA FORA DE ORDEM. A Shopify não garante a ordem de
// entrega dos webhooks, e uma busca deste robô pode trazer um estado mais
// antigo que o que o webhook acabou de gravar — então, em tese, uma gravação
// mais velha sobrescreve uma mais nova (ex: o pedido virou `refunded` e um
// `paid` atrasado chega depois). A conferência de hora em hora relê o pedido e
// corrige sozinha em até uma hora; por isso não há trava de versão aqui.
import './lib/carregar-env.mjs';
import pg from 'pg';
import { shopifyPedidos, tokenShopify } from './lib/shopify-admin.mjs';
import { pedidoDoPayload } from '../supabase/functions/_shared/pedido-shopify.js';
import { clienteDoAmbiente } from '../supabase/functions/_shared/core-leitura.js';
import { shopifyLeituraLigada, pedidosDoEspelho, SQL_UPSERT_PEDIDO_SEM_PII } from '../supabase/functions/_shared/core-shopify.js';

const arg = (nome, padrao) => {
  const a = process.argv.find((x) => x.startsWith(`--${nome}=`));
  return a ? a.split('=')[1] : padrao;
};
const dias = Number(arg('dias', 30));
const ensaio = process.argv.includes('--ensaio');

// CORE_SHOPIFY_LEITURA=true: lê do espelho do core (sem credencial da Shopify). Desligada (padrão):
// caminho antigo, idêntico.
const DO_CORE = shopifyLeituraLigada(process.env);
const DOMINIO = process.env.SHOPIFY_SHOP;
if (!DO_CORE && !DOMINIO) {
  throw new Error('falta SHOPIFY_SHOP em coletor/.env — '
    + 'o robô do Bling não é afetado, só este aqui para até a credencial existir.');
}
const TOKEN = DO_CORE ? null : await tokenShopify(DOMINIO);

const cli = new pg.Client({ connectionString: process.env.DATABASE_URL });
await cli.connect();

const desde = new Date();
desde.setDate(desde.getDate() - dias);
console.log(`\njanela: desde ${desde.toISOString()}${ensaio ? '  (ENSAIO — nada será gravado)' : ''}\n`);

// No espelho não há nome/e-mail/payload do cliente: grava só o resto e preserva o que o webhook já gravou.
const brutos = DO_CORE ? null : await shopifyPedidos(DOMINIO, TOKEN, { atualizadosApartirDe: desde.toISOString() });
const doEspelho = DO_CORE ? await pedidosDoEspelho(clienteDoAmbiente(process.env), { desde }) : null;
console.log(`${(brutos || doEspelho).length} pedidos ${DO_CORE ? 'no espelho do core' : 'na Shopify'} na janela`);

let gravados = 0, invalidos = 0;
for (const bruto of brutos || doEspelho) {
  const p = DO_CORE ? bruto : pedidoDoPayload(bruto);
  if (!p) { invalidos++; continue; }
  if (ensaio) continue;
  if (DO_CORE) {
    await cli.query(SQL_UPSERT_PEDIDO_SEM_PII,
      [p.id, p.numero, p.loja_id, p.total, p.moeda, p.status_financeiro, p.criado_em_shopify]);
    gravados++;
    continue;
  }
  await cli.query(
    `insert into shopify_pedidos
       (id, numero, loja_id, total, moeda, status_financeiro, cliente_nome, cliente_email, criado_em_shopify, bruto, atualizado_em)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
     on conflict (id) do update set
       numero = excluded.numero, total = excluded.total, moeda = excluded.moeda,
       status_financeiro = excluded.status_financeiro,
       cliente_nome = excluded.cliente_nome, cliente_email = excluded.cliente_email,
       criado_em_shopify = excluded.criado_em_shopify, bruto = excluded.bruto,
       atualizado_em = now()`,
    [p.id, p.numero, p.loja_id, p.total, p.moeda, p.status_financeiro, p.cliente_nome, p.cliente_email, p.criado_em_shopify, p.bruto],
  );
  gravados++;
}

console.log(`\n  gravados  ${gravados}`);
console.log(`  inválidos ${invalidos}  (payload sem id ou sem created_at — não dá pra gravar)`);

await cli.end();
