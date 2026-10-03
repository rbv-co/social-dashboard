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
// ⚠️ ESTE ROBÔ SÓ SABE QUE FOI LIGADO QUANDO SHOPIFY_ADMIN_TOKEN E
// SHOPIFY_SHOP_DOMAIN EXISTIREM EM coletor/.env — até lá, ele PARA (lança) e
// diz exatamente o que falta. Não é erro silencioso: o robô do Bling continua
// rodando normalmente, e este é um robô SEPARADO (cron próprio), então faltar
// a credencial da Shopify não derruba a importação de mais nada.
//
// ⚠️ MESMO DESENHO DE CONFIANÇA DO ROBÔ DO BLING: uma rodada funda (30 dias)
// 1x por dia, mais uma conferência de janela curta de hora em hora — pra
// pegar pedido que mudou de status (ex: Pix confirmado depois) sem esperar o
// dia seguinte. Ver .github/workflows/pedidos-da-shopify.yml.
import './lib/carregar-env.mjs';
import pg from 'pg';
import { shopifyPedidos } from './lib/shopify-admin.mjs';
import { pedidoDoPayload } from '../supabase/functions/_shared/pedido-shopify.js';

const arg = (nome, padrao) => {
  const a = process.argv.find((x) => x.startsWith(`--${nome}=`));
  return a ? a.split('=')[1] : padrao;
};
const dias = Number(arg('dias', 30));
const ensaio = process.argv.includes('--ensaio');

const DOMINIO = process.env.SHOPIFY_SHOP_DOMAIN;
const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
if (!DOMINIO || !TOKEN) {
  throw new Error('faltam SHOPIFY_SHOP_DOMAIN e/ou SHOPIFY_ADMIN_TOKEN em coletor/.env — '
    + 'o robô do Bling não é afetado, só este aqui para até a credencial existir.');
}

const cli = new pg.Client({ connectionString: process.env.DATABASE_URL });
await cli.connect();

const desde = new Date();
desde.setDate(desde.getDate() - dias);
console.log(`\njanela: desde ${desde.toISOString()}${ensaio ? '  (ENSAIO — nada será gravado)' : ''}\n`);

const brutos = await shopifyPedidos(DOMINIO, TOKEN, { atualizadosApartirDe: desde.toISOString() });
console.log(`${brutos.length} pedidos na Shopify na janela`);

let gravados = 0, invalidos = 0;
for (const bruto of brutos) {
  const p = pedidoDoPayload(bruto);
  if (!p) { invalidos++; continue; }
  if (ensaio) continue;
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
console.log(`  inválidos ${invalidos}  (payload sem id — não dá pra gravar sem chave)`);

await cli.end();
