# Pedidos da Loja Shopify direto da API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir a fundação (tabela, robô, webhook, telas) para a Loja Shopify (`loja_id` 205512275) parar de ser lida via Bling e passar a ser lida direto da API da própria Shopify — faltando só o dono colocar o token depois.

**Architecture:** Uma tabela nova e isolada (`shopify_pedidos`) recebe pedido por dois caminhos que gravam do mesmo jeito (upsert por `id` do pedido): um robô periódico (mesmo desenho de confiança do robô do Bling) e um webhook em tempo real. As duas telas de venda aprendem a tirar essa loja do caminho Bling e somar os pedidos desta tabela nova no lugar, sem mudar nenhuma lógica de soma existente.

**Tech Stack:** Node 18+ (`node:test`), Postgres/Supabase (RLS), Vue 3 (telas), Deno (edge function de webhook), Shopify Admin REST API 2024-01.

**Spec:** `docs/superpowers/specs/2026-10-03-pedidos-da-shopify-direto-design.md`

## Global Constraints

- Só vale **daqui pra frente** — nenhuma task desta plan faz backfill de pedido antigo.
- Mecanismo é **robô periódico E webhook**, os dois — não um só.
- Tabela **nova e isolada** (`shopify_pedidos`) — nunca mexer em `vessel_pedidos` nem em nada que o Stylist Circle já lê.
- `loja_id` fixo **205512275** em toda linha da tabela nova, para o agrupamento por canal das telas não precisar mudar.
- **O que conta como venda**: `financial_status` igual a `paid` ou `partially_refunded`. Qualquer outro valor (incluindo valor novo/desconhecido que a Shopify venha a mandar) conta como "não é venda" — nunca o contrário.
- **Dia da venda** = `created_at` do pedido na Shopify, sem nenhuma correção de nota fiscal (a Shopify não tem esse problema).
- Troca/devolução (API de `refunds` da Shopify) **fora de escopo** nesta fundação.
- Sem credencial real da Shopify disponível nesta implementação — toda função que chama a API de verdade fica pronta mas não testável ao vivo; os testes usam payload sintético baseado no formato documentado publicamente pela Shopify.
- Toda regra testável nova é função pura com teste ao lado, em arquivo próprio — padrão do projeto (`PADRAO-DA-CENTRAL.md`).

## Review Focus

- Pedido Shopify **sem objeto `customer`** (comprador anônimo/removido): não pode quebrar a extração — `cliente_nome`/`cliente_email` ficam `null`.
- `financial_status` **desconhecido/novo** (a Shopify pode adicionar valores): tem que contar como "não é venda" por padrão, nunca o contrário — um valor novo não pode silenciosamente virar faturamento.
- **Webhook entregue mais de uma vez** (comportamento documentado da Shopify — reenvia se não receber 2xx a tempo): o upsert por `id` não pode duplicar a venda.
- **Cabeçalho `Link` ausente ou malformado** na resposta da Shopify (página única, ou formato inesperado): o robô tem que parar de paginar de forma limpa, nunca entrar em loop infinito nem lançar.
- **Tabela `shopify_pedidos` fora do ar na hora da tela carregar**: a tela não pode ficar vazia nem quebrar — mesmo padrão de "não sei, mantém como está" dos outros bridges (`valor-corrigido.js`, `valor-liquido-de-troca.js`).

---

### Task 1: Migration — tabela `shopify_pedidos`

**Files:**
- Create: `db/migrations/2026-10-03-pedidos-da-shopify.sql`

**Interfaces:**
- Produces: tabela `public.shopify_pedidos (id, numero, loja_id, total, moeda, status_financeiro, cliente_nome, cliente_email, criado_em_shopify, bruto, atualizado_em)`, usada pelas Tasks 4, 6, 7.

- [ ] **Step 1: Escrever a migration**

```sql
-- Pedido da Loja Shopify, trazido direto da API dela — sem passar pelo Bling.
--
-- POR QUE ESTA TABELA EXISTE
-- A Loja Shopify (loja_id 205512275 no Bling) é lida hoje pelas telas de venda
-- através do Bling, igual qualquer outra loja. O dono quer parar de depender
-- do Bling pra ESTA loja e ler direto da API da própria Shopify — medido em
-- 03/10/2026: todo pedido dela cai num vendedor-placeholder "Fábrica"
-- (vendor_id 15596565431), ou seja, não tem vendedora de verdade atribuída, e
-- por isso não precisa da mesma lógica de vendedor/forma-de-pagamento das
-- outras lojas (ver bling_pedido_forma_pagamento).
--
-- `bruto jsonb` guarda o payload inteiro: é dado novo, formato ainda não
-- testado em produção — melhor poder reprocessar um campo que o desenho
-- inicial não previu do que ter que pedir pra Shopify mandar de novo.
--
-- O QUE ESTA MIGRATION NÃO FAZ
-- Não muda número nenhum nas telas. Só cria o lugar onde o pedido passa a ser
-- guardado; quem preenche é o robô coletor/trazer-pedidos-da-shopify.mjs e o
-- webhook receber-webhook-pedido-shopify; quem passa a ler são as telas, numa
-- etapa seguinte e separada.

create table if not exists public.shopify_pedidos (
  id                bigint        primary key,        -- order id da própria Shopify
  numero            text,                               -- order_number / name (ex: "#1042")
  loja_id           bigint        not null default 205512275,
  total             numeric(12,2) not null,
  moeda             text          not null default 'BRL',
  status_financeiro text          not null,             -- financial_status cru da Shopify
  cliente_nome      text,
  cliente_email     text,
  criado_em_shopify timestamptz   not null,             -- created_at do pedido na Shopify
  bruto             jsonb         not null,             -- payload cru, para auditoria/replay
  atualizado_em     timestamptz   not null default now()
);

comment on table public.shopify_pedidos is
  'Pedido da Loja Shopify (loja_id 205512275), trazido direto da API da Shopify — não passa pelo Bling. Preenchido pelo robô coletor/trazer-pedidos-da-shopify.mjs e pelo webhook receber-webhook-pedido-shopify.';
comment on column public.shopify_pedidos.status_financeiro is
  'financial_status cru da Shopify. O que conta como venda (paid, partially_refunded) é decidido por quem lê, não aqui — ver supabase/functions/_shared/pedido-shopify.js.';
comment on column public.shopify_pedidos.bruto is
  'Payload inteiro do pedido, cru. Dado novo, formato ainda não testado em produção — permite reprocessar um campo que o desenho inicial não previu.';

-- criado_em_shopify: leitura por faixa de dia, mesmo padrão de bling_pedido_nota.
-- status_financeiro: filtro de "o que conta como venda" roda em toda leitura.
-- loja_id: lido pela política de escopo por time, mesmo motivo das tabelas irmãs.
create index if not exists idx_shopify_pedidos_data   on public.shopify_pedidos (criado_em_shopify desc);
create index if not exists idx_shopify_pedidos_status on public.shopify_pedidos (status_financeiro);
create index if not exists idx_shopify_pedidos_loja   on public.shopify_pedidos (loja_id);

alter table public.shopify_pedidos enable row level security;

-- Leitura para quem está logado; escrita só pelo robô e pelo webhook
-- (service_role, que não passa por RLS). Mesmo padrão de bling_pedido_nota.
drop policy if exists shopify_pedidos_leitura on public.shopify_pedidos;
create policy shopify_pedidos_leitura on public.shopify_pedidos
  for select to authenticated using (true);

drop policy if exists shopify_pedidos_so_do_meu_canal on public.shopify_pedidos;
create policy shopify_pedidos_so_do_meu_canal on public.shopify_pedidos
  as restrictive for select to authenticated
  using (public.pode_ver_canal(loja_id));
```

- [ ] **Step 2: Aplicar no banco**

```bash
cd /Users/gabrielgertrudes/Projetos/Trabalho/lavessel/social-dashboard/.claude/worktrees/pedidos-shopify-direto
DATABASE_URL=$(grep -m1 '^DATABASE_URL=' coletor/.env | cut -d= -f2-)
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/2026-10-03-pedidos-da-shopify.sql
```

Expected: `CREATE TABLE`, `COMMENT` x3, `CREATE INDEX` x3, `ALTER TABLE`, `DROP POLICY`/`CREATE POLICY` x2 — sem erro vermelho.

- [ ] **Step 3: Confirmar RLS e índices**

```bash
psql "$DATABASE_URL" -c "\d public.shopify_pedidos"
psql "$DATABASE_URL" -c "select polname, permissive, cmd from pg_policies where tablename='shopify_pedidos';"
```

Expected: tabela com as 10 colunas, 3 índices, 2 policies (`shopify_pedidos_leitura` PERMISSIVE, `shopify_pedidos_so_do_meu_canal` RESTRICTIVE).

- [ ] **Step 4: Commit**

```bash
git add db/migrations/2026-10-03-pedidos-da-shopify.sql
git commit -m "feat: tabela shopify_pedidos (pedido da Loja Shopify direto da API)"
```

---

### Task 2: Função pura — extrair pedido do payload e decidir o que conta como venda

**Files:**
- Create: `supabase/functions/_shared/pedido-shopify.js`
- Test: `supabase/functions/_shared/pedido-shopify.test.mjs`

**Interfaces:**
- Produces: `pedidoDoPayload(corpo): {id, numero, loja_id, total, moeda, status_financeiro, cliente_nome, cliente_email, criado_em_shopify, bruto} | null`, `ehVendaValida(statusFinanceiro): boolean` — usados pelas Tasks 4 e 6.

- [ ] **Step 1: Escrever o teste (falhando)**

```js
// supabase/functions/_shared/pedido-shopify.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pedidoDoPayload, ehVendaValida } from './pedido-shopify.js';

// Payload real da Shopify tem dezenas de campos; aqui só os que usamos, no
// formato documentado publicamente pela Admin API (2024-01).
const payloadCompleto = () => ({
  id: 5987654321098,
  name: '#1042',
  order_number: 1042,
  total_price: '349.90',
  currency: 'BRL',
  financial_status: 'paid',
  created_at: '2026-10-02T18:30:00-03:00',
  customer: { first_name: 'Maria', last_name: 'Silva', email: 'maria@exemplo.com' },
});

test('o caso comum: payload completo vira pedido pronto pra gravar', () => {
  const p = pedidoDoPayload(payloadCompleto());
  assert.equal(p.id, 5987654321098);
  assert.equal(p.numero, '#1042');
  assert.equal(p.loja_id, 205512275);
  assert.equal(p.total, 349.90);
  assert.equal(p.moeda, 'BRL');
  assert.equal(p.status_financeiro, 'paid');
  assert.equal(p.cliente_nome, 'Maria Silva');
  assert.equal(p.cliente_email, 'maria@exemplo.com');
  assert.equal(p.criado_em_shopify, '2026-10-02T18:30:00-03:00');
  assert.deepEqual(p.bruto, payloadCompleto());
});

test('sem customer (comprador anônimo/removido): não quebra, campos ficam nulos', () => {
  const payload = { ...payloadCompleto(), customer: null };
  const p = pedidoDoPayload(payload);
  assert.equal(p.cliente_nome, null);
  assert.equal(p.cliente_email, null);
});

test('customer com só um dos nomes: junta o que tem', () => {
  const payload = { ...payloadCompleto(), customer: { first_name: 'Maria', email: 'maria@exemplo.com' } };
  const p = pedidoDoPayload(payload);
  assert.equal(p.cliente_nome, 'Maria');
});

test('sem id: payload inválido, não dá pra gravar sem chave', () => {
  const payload = { ...payloadCompleto(), id: undefined };
  assert.equal(pedidoDoPayload(payload), null);
});

test('sem name nem order_number: numero fica nulo, resto do pedido entra do mesmo jeito', () => {
  const payload = { ...payloadCompleto(), name: undefined, order_number: undefined };
  const p = pedidoDoPayload(payload);
  assert.equal(p.numero, null);
  assert.equal(p.id, payloadCompleto().id);
});

test('sem moeda: assume BRL (toda venda desta loja é em reais)', () => {
  const payload = { ...payloadCompleto(), currency: undefined };
  assert.equal(pedidoDoPayload(payload).moeda, 'BRL');
});

test('total_price ausente ou quebrado vira 0, nunca NaN', () => {
  for (const ruim of [undefined, null, '', 'abacaxi']) {
    const p = pedidoDoPayload({ ...payloadCompleto(), total_price: ruim });
    assert.equal(p.total, 0);
  }
});

test('paid e partially_refunded contam como venda', () => {
  assert.equal(ehVendaValida('paid'), true);
  assert.equal(ehVendaValida('partially_refunded'), true);
});

test('qualquer outro status, inclusive um que a Shopify ainda não inventou, NÃO conta', () => {
  for (const naoConta of ['pending', 'authorized', 'partially_paid', 'refunded', 'voided', 'um_status_novo_que_nao_existe_ainda', '', null, undefined]) {
    assert.equal(ehVendaValida(naoConta), false, `"${naoConta}" não podia contar como venda`);
  }
});

test('null/undefined no payload inteiro não quebra', () => {
  assert.equal(pedidoDoPayload(null), null);
  assert.equal(pedidoDoPayload(undefined), null);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
node --test supabase/functions/_shared/pedido-shopify.test.mjs
```

Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

```js
// supabase/functions/_shared/pedido-shopify.js
//
// Transforma o payload cru de um pedido da Shopify (da API ou de um webhook —
// é o MESMO formato de objeto "order" nos dois casos) na linha que vai para
// `shopify_pedidos`, e decide o que conta como venda.
//
// POR QUE ISTO MORA EM supabase/functions/_shared/ E NÃO EM src/ OU coletor/
// Mesmo motivo dos vizinhos valor-corrigido.js e pedido-para-mensagem.js: o
// webhook (receber-webhook-pedido-shopify, Deno) e o robô
// (trazer-pedidos-da-shopify.mjs, Node) usam a MESMA regra — duas cópias da
// mesma regra discordam cedo ou tarde.
//
// LOJA_ID É FIXO: esta tabela é só da Loja Shopify (205512275). Não existe
// hoje nenhuma outra loja que fale com este código.
const LOJA_ID_SHOPIFY = 205512275;

// O que conta como venda. "Pending" (Pix/boleto ainda não confirmado) e
// qualquer status que a Shopify venha a inventar NÃO contam — o lado seguro
// é nunca contar um status desconhecido como faturamento.
//
// Exportado (não só a função) porque src/compartilhado/pedidos-shopify.js
// (Task 7) precisa da LISTA, não só do predicado — o filtro `.in()` do
// Supabase pede um array de valores, e duas cópias desta lista discordariam
// cedo ou tarde (mesma lição de todo módulo _shared deste projeto).
export const STATUS_QUE_CONTAM = ['paid', 'partially_refunded'];

export function ehVendaValida(statusFinanceiro) {
  return STATUS_QUE_CONTAM.includes(statusFinanceiro);
}

export function pedidoDoPayload(corpo) {
  if (!corpo || corpo.id == null) return null;
  const nome = [corpo.customer?.first_name, corpo.customer?.last_name].filter(Boolean).join(' ');
  return {
    id: Number(corpo.id),
    numero: corpo.name ?? (corpo.order_number != null ? `#${corpo.order_number}` : null),
    loja_id: LOJA_ID_SHOPIFY,
    total: Number(corpo.total_price) || 0,
    moeda: corpo.currency || 'BRL',
    status_financeiro: corpo.financial_status || 'pending',
    cliente_nome: nome || null,
    cliente_email: corpo.customer?.email || null,
    criado_em_shopify: corpo.created_at || null,
    bruto: corpo,
  };
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
node --test supabase/functions/_shared/pedido-shopify.test.mjs
```

Expected: todos PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/pedido-shopify.js supabase/functions/_shared/pedido-shopify.test.mjs
git commit -m "feat: função pura que extrai pedido do payload da Shopify e decide o que conta como venda"
```

---

### Task 3: Paginação da Admin API da Shopify — `linkDaProximaPagina`

**Files:**
- Create: `coletor/lib/shopify-admin.mjs`
- Test: `coletor/lib/shopify-admin.test.mjs`

**Interfaces:**
- Produces: `linkDaProximaPagina(cabecalhoLink): string | null` (pura, testada), `shopifyPedidos(dominioDaLoja, token, {atualizadosApartirDe}): Promise<Array>` (I/O, sem teste dedicado — mesmo padrão de `blingDepositos`) — usada pela Task 4.

- [ ] **Step 1: Escrever o teste da parte pura (falhando)**

```js
// coletor/lib/shopify-admin.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkDaProximaPagina } from './shopify-admin.mjs';

// A Shopify pagina orders.json por cursor no cabeçalho Link (formato RFC 8288),
// não por número de página — isso mudou há anos e `page` nem é mais aceito
// neste endpoint.
const linkComNext = '<https://loja.myshopify.com/admin/api/2024-01/orders.json?page_info=abc123&limit=250>; rel="next"';
const linkComOsDois = '<https://loja.myshopify.com/admin/api/2024-01/orders.json?page_info=zzz&limit=250>; rel="previous", '
  + '<https://loja.myshopify.com/admin/api/2024-01/orders.json?page_info=abc123&limit=250>; rel="next"';
const linkSoAnterior = '<https://loja.myshopify.com/admin/api/2024-01/orders.json?page_info=zzz&limit=250>; rel="previous"';

test('extrai a URL de rel="next" quando é o único link', () => {
  assert.equal(linkDaProximaPagina(linkComNext), 'https://loja.myshopify.com/admin/api/2024-01/orders.json?page_info=abc123&limit=250');
});

test('extrai rel="next" mesmo com rel="previous" também presente', () => {
  assert.equal(linkDaProximaPagina(linkComOsDois), 'https://loja.myshopify.com/admin/api/2024-01/orders.json?page_info=abc123&limit=250');
});

test('só rel="previous" (última página): não tem próxima, devolve null', () => {
  assert.equal(linkDaProximaPagina(linkSoAnterior), null);
});

test('cabeçalho ausente: devolve null, não lança', () => {
  for (const vazio of [null, undefined, '']) {
    assert.equal(linkDaProximaPagina(vazio), null);
  }
});

test('cabeçalho malformado: devolve null em vez de quebrar o robô', () => {
  assert.equal(linkDaProximaPagina('isto não é um Link header de verdade'), null);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
node --test coletor/lib/shopify-admin.test.mjs
```

Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

```js
// coletor/lib/shopify-admin.mjs
//
// Chamadas diretas à Admin API da Shopify (REST). Paralelo a
// bling-comercial.mjs, mas SEM proxy: o token de app fica só aqui, no robô
// que roda no servidor — nunca chega ao navegador, então não precisa do
// desenho de "edge function com allowlist" que o Bling exige.
const API_VERSION = '2024-01';

// A Shopify pagina orders.json por CURSOR, no cabeçalho Link (RFC 8288) — não
// por número de página. Pura: só parseia texto, não faz rede.
export function linkDaProximaPagina(cabecalhoLink) {
  if (!cabecalhoLink || typeof cabecalhoLink !== 'string') return null;
  for (const parte of cabecalhoLink.split(',')) {
    const [urlBruta, relBruto] = parte.split(';').map((s) => s?.trim());
    if (!urlBruta || !relBruto) continue;
    if (relBruto.replace(/\s/g, '') !== 'rel="next"') continue;
    const m = urlBruta.match(/^<(.+)>$/);
    if (m) return m[1];
  }
  return null;
}

// Busca TODOS os pedidos (qualquer status) atualizados a partir de uma data,
// seguindo a paginação por cursor até acabar. `status=any` é necessário: por
// padrão a Shopify só devolve pedidos "open" (não cancelados/arquivados), e
// pedido cancelado é um FATO a medir (mesma lição do robô do Bling), não um
// erro a esconder.
export async function shopifyPedidos(dominioDaLoja, token, { atualizadosApartirDe } = {}) {
  let url = `https://${dominioDaLoja}/admin/api/${API_VERSION}/orders.json?status=any&limit=250`
    + (atualizadosApartirDe ? `&updated_at_min=${encodeURIComponent(atualizadosApartirDe)}` : '');
  const todos = [];
  while (url) {
    let resposta;
    for (let tentativa = 0; tentativa < 5; tentativa++) {
      resposta = await fetch(url, { headers: { 'X-Shopify-Access-Token': token, Accept: 'application/json' } });
      if (resposta.status === 429) { await new Promise((r) => setTimeout(r, 1000 * (tentativa + 1))); continue; }
      if (resposta.status >= 500) { await new Promise((r) => setTimeout(r, 1500 * (tentativa + 1))); continue; }
      break;
    }
    if (!resposta.ok) {
      throw new Error(`Shopify orders.json -> ${resposta.status} ${(await resposta.text()).slice(0, 200)}`);
    }
    const corpo = await resposta.json();
    todos.push(...(corpo.orders || []));
    url = linkDaProximaPagina(resposta.headers.get('Link'));
  }
  return todos;
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
node --test coletor/lib/shopify-admin.test.mjs
```

Expected: todos PASS (os 5 testes de `linkDaProximaPagina`; `shopifyPedidos` não tem teste dedicado, mesmo padrão de `blingDepositos`).

- [ ] **Step 5: Commit**

```bash
git add coletor/lib/shopify-admin.mjs coletor/lib/shopify-admin.test.mjs
git commit -m "feat: shopifyPedidos e paginação por cursor da Admin API da Shopify"
```

---

### Task 4: Robô — `coletor/trazer-pedidos-da-shopify.mjs`

**Files:**
- Create: `coletor/trazer-pedidos-da-shopify.mjs`

**Interfaces:**
- Consumes: `shopifyPedidos` (Task 3), `pedidoDoPayload` (Task 2).
- Produces: linhas gravadas em `shopify_pedidos` — verificadas manualmente quando o dono ligar o token (fora desta plan).

- [ ] **Step 1: Escrever o robô**

```js
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
```

- [ ] **Step 2: Checar sintaxe**

```bash
node --check coletor/trazer-pedidos-da-shopify.mjs
```

Expected: sem erro.

- [ ] **Step 3: Rodar em ensaio — SEM credencial ainda, confirma a mensagem de erro certa**

```bash
node coletor/trazer-pedidos-da-shopify.mjs --ensaio
```

Expected: lança `Error: faltam SHOPIFY_SHOP_DOMAIN e/ou SHOPIFY_ADMIN_TOKEN...` — isso é o esperado nesta fase (sem credencial real). Não tente configurar credencial fake só pra "passar" este step; a mensagem de erro clara É o resultado correto agora.

- [ ] **Step 4: Commit**

```bash
git add coletor/trazer-pedidos-da-shopify.mjs
git commit -m "feat: robô que traz os pedidos da Loja Shopify direto da API"
```

---

### Task 5: Workflow do GitHub Actions

**Files:**
- Create: `.github/workflows/pedidos-da-shopify.yml`

- [ ] **Step 1: Escrever o workflow, espelhando `.github/workflows/pedidos-da-vessel.yml`**

```yaml
name: Pedidos da Loja Shopify (direto da API, sem Bling)

# Mesmo desenho de confiança do robô do Bling: varredura funda 1x por dia +
# conferência de janela curta de hora em hora, pra pegar pedido que mudou de
# status (Pix confirmado depois, por exemplo) sem esperar o dia seguinte.
#
# ⚠️ SÓ COMEÇA A FUNCIONAR QUANDO SHOPIFY_ADMIN_TOKEN E SHOPIFY_SHOP_DOMAIN
# FOREM CADASTRADOS EM Settings → Secrets → Actions deste repositório. Até lá,
# toda rodada falha com uma mensagem clara (ver coletor/trazer-pedidos-da-shopify.mjs)
# e não afeta nenhum outro robô.
on:
  schedule:
    - cron: '41 7 * * *'     # varredura profunda: 30 dias (17 min depois do robô do Bling, mesmo motivo de espaçamento)
    - cron: '41 * * * *'     # conferência ao vivo: 3 dias
  workflow_dispatch:
    inputs:
      dias:
        description: 'Janela em dias (vazio = 30)'
        required: false
        default: ''
      ensaio:
        description: 'Só ler, sem gravar? (qualquer texto = sim)'
        required: false
        default: ''

concurrency:
  group: pedidos-da-shopify
  cancel-in-progress: false

jobs:
  trazer:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v6
        with:
          node-version: '22'
      - name: Instalar as dependências do coletor
        working-directory: coletor
        run: npm ci

      - name: Trazer os pedidos da Shopify
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
          SHOPIFY_ADMIN_TOKEN: ${{ secrets.SHOPIFY_ADMIN_TOKEN }}
          SHOPIFY_SHOP_DOMAIN: ${{ secrets.SHOPIFY_SHOP_DOMAIN }}
          DIAS: ${{ github.event.inputs.dias }}
          ENSAIO: ${{ github.event.inputs.ensaio }}
          QUAL_CRON: ${{ github.event.schedule }}
        run: |
          if [ -n "$DIAS" ] && ! printf '%s' "$DIAS" | grep -qE '^[0-9]+$'; then
            echo "DIAS inválido (esperado número): $DIAS"; exit 1
          fi
          padrao=30
          if [ "$QUAL_CRON" = "41 * * * *" ]; then padrao=3; fi
          argumentos="--dias=${DIAS:-$padrao}"
          if [ -n "$ENSAIO" ]; then argumentos="$argumentos --ensaio"; fi
          echo "janela: $argumentos  (cron: ${QUAL_CRON:-manual})"
          node coletor/trazer-pedidos-da-shopify.mjs $argumentos
```

- [ ] **Step 2: Validar YAML**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/pedidos-da-shopify.yml'))" && echo "YAML ok"
```

Expected: `YAML ok`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/pedidos-da-shopify.yml
git commit -m "feat: cron do robô de pedidos da Shopify (varredura diária + conferência de hora em hora)"
```

---

### Task 6: Webhook — `receber-webhook-pedido-shopify`

**Files:**
- Create: `supabase/functions/receber-webhook-pedido-shopify/index.ts`

**Interfaces:**
- Consumes: `assinaturaValida` (já existe, `supabase/functions/_shared/verificar-webhook-shopify.js`), `pedidoDoPayload` (Task 2).

- [ ] **Step 1: Escrever a edge function, espelhando `receber-webhook-checkout/index.ts`**

```ts
// supabase/functions/receber-webhook-pedido-shopify/index.ts
//
// Webhook NATIVO da Shopify para pedido — mesma família de
// receber-webhook-checkout, mas para o evento de PEDIDO (não checkout
// iniciado). Cadastrar no admin da Shopify (Configurações → Notificações →
// Webhooks) apontando pra esta URL, nos tópicos orders/create, orders/paid e
// orders/updated — os três mandam o MESMO formato de objeto "order", e o
// upsert por id aqui é idempotente, então não importa qual tópico disparou
// nem se a Shopify reentrega o mesmo evento (ela reentrega se não receber 2xx
// a tempo — comportamento documentado).
//
// Mesma autenticação de receber-webhook-checkout: assinatura HMAC no
// cabeçalho X-Shopify-Hmac-Sha256, contra SHOPIFY_WEBHOOK_SECRET.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { assinaturaValida } from '../_shared/verificar-webhook-shopify.js';
import { pedidoDoPayload } from '../_shared/pedido-shopify.js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SEGREDO_DO_WEBHOOK = Deno.env.get('SHOPIFY_WEBHOOK_SECRET') ?? '';

const responder = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return responder({ ok: false }, 405);

  const corpoCru = await req.text();
  const assinatura = req.headers.get('x-shopify-hmac-sha256');
  if (!(await assinaturaValida(SEGREDO_DO_WEBHOOK, corpoCru, assinatura))) {
    return responder({ error: 'nao_autorizado' }, 401);
  }

  const pedido = pedidoDoPayload(JSON.parse(corpoCru));
  if (!pedido) return responder({ ok: true, ignorado: 'payload sem id' });

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  const { error } = await sb.from('shopify_pedidos').upsert({
    id: pedido.id, numero: pedido.numero, loja_id: pedido.loja_id, total: pedido.total,
    moeda: pedido.moeda, status_financeiro: pedido.status_financeiro,
    cliente_nome: pedido.cliente_nome, cliente_email: pedido.cliente_email,
    criado_em_shopify: pedido.criado_em_shopify, bruto: pedido.bruto,
    atualizado_em: new Date().toISOString(),
  });
  // A Shopify tenta de novo se não receber 2xx — erro de banco nunca deve
  // virar tempestade de retentativas por um problema que retry não resolve;
  // loga pro robô (que roda de hora em hora) alcançar depois.
  if (error) console.error('falha ao gravar pedido da Shopify:', error.message);

  return responder({ ok: true });
});
```

- [ ] **Step 2: Checar sintaxe (TypeScript, sem Deno instalado localmente, só sintaxe JS equivalente)**

```bash
node --check <(sed 's/: unknown//; s/!: *string/ = ""/; s/Deno\.env\.get/process.env.__get/; s/Deno\.serve/(()=>{})/' supabase/functions/receber-webhook-pedido-shopify/index.ts) 2>&1 | tail -5 || echo "checagem aproximada só — TypeScript real é validado no deploy"
```

Expected: sem erro de sintaxe grosseiro (parênteses, chaves). Este projeto não roda `tsc` localmente para edge functions — a validação de tipo de verdade acontece no deploy (fora do escopo desta plan, que só prepara a fundação).

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/receber-webhook-pedido-shopify/index.ts
git commit -m "feat: webhook que recebe pedido da Shopify em tempo real"
```

---

### Task 7: Bridge do navegador — buscar e mesclar pedidos da Shopify

**Files:**
- Create: `src/compartilhado/pedidos-shopify.js`
- Test: `src/compartilhado/pedidos-shopify.test.mjs`

**Interfaces:**
- Consumes: `STATUS_QUE_CONTAM` (array exportado por `supabase/functions/_shared/pedido-shopify.js`, Task 2) — não duplica a lista de status.
- Produces: `buscarPedidosShopifyDoPeriodo(sbClient, di, df): Promise<Array|null>`, `mesclarPedidosShopify(pedidosBling, linhasShopify, lojaIdShopify = 205512275): Array` — usados pelas Tasks 8 e 9.

- [ ] **Step 1: Escrever o teste (falhando)**

```js
// src/compartilhado/pedidos-shopify.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buscarPedidosShopifyDoPeriodo, mesclarPedidosShopify } from './pedidos-shopify.js';

const pedBling = (id, lojaId, total = 100) => ({ id, total, loja: { id: lojaId } });
const linhaShopify = (id, total, data = '2026-10-02') => ({ id, total, criado_em_shopify: `${data}T12:00:00Z`, status_financeiro: 'paid' });

function sbComResposta(linhas, chamadas = []) {
  return {
    from: () => ({
      select: () => ({
        gte: (campo, valor) => { chamadas.push(['gte', campo, valor]); return {
          lte: (campo2, valor2) => { chamadas.push(['lte', campo2, valor2]); return {
            in: (campo3, valor3) => { chamadas.push(['in', campo3, valor3]); return Promise.resolve({ data: linhas, error: null }); },
          }; },
        }; },
      }),
    }),
  };
}

test('mescla: pedido Bling de OUTRA loja não é tocado', () => {
  const r = mesclarPedidosShopify([pedBling(1, 999999)], []);
  assert.deepEqual(r, [pedBling(1, 999999)]);
});

test('mescla: pedido Bling da loja Shopify é descartado', () => {
  const r = mesclarPedidosShopify([pedBling(1, 205512275)], []);
  assert.equal(r.length, 0);
});

test('mescla: pedido Shopify entra no formato de pedido do Bling', () => {
  const r = mesclarPedidosShopify([], [linhaShopify(555, 349.90, '2026-10-02')]);
  assert.equal(r.length, 1);
  assert.equal(r[0].id, 555);
  assert.equal(r[0].total, 349.90);
  assert.equal(r[0].data, '2026-10-02');
  assert.equal(r[0].loja.id, 205512275);
});

test('mescla: pedido de outra loja sobrevive junto com o da Shopify', () => {
  const r = mesclarPedidosShopify([pedBling(1, 999999, 50)], [linhaShopify(555, 100)]);
  assert.equal(r.length, 2);
  assert.ok(r.some((p) => p.id === 1 && p.loja.id === 999999));
  assert.ok(r.some((p) => p.id === 555 && p.loja.id === 205512275));
});

test('mescla: listas vazias não quebram', () => {
  assert.deepEqual(mesclarPedidosShopify([], []), []);
  assert.deepEqual(mesclarPedidosShopify(null, null), []);
});

test('busca: filtra por período e por status que conta como venda', async () => {
  const chamadas = [];
  await buscarPedidosShopifyDoPeriodo(sbComResposta([], chamadas), '2026-10-01', '2026-10-31');
  assert.deepEqual(chamadas[0], ['gte', 'criado_em_shopify', '2026-10-01']);
  assert.deepEqual(chamadas[1], ['lte', 'criado_em_shopify', '2026-10-31']);
  assert.deepEqual(chamadas[2], ['in', 'status_financeiro', ['paid', 'partially_refunded']]);
});

test('busca: banco fora do ar devolve null — "não sei", nunca lista vazia disfarçada de "sem venda"', async () => {
  const sbFalso = { from: () => ({ select: () => ({ gte: () => ({ lte: () => ({ in: () => Promise.resolve({ data: null, error: { message: 'caiu' } }) }) }) }) }) };
  assert.equal(await buscarPedidosShopifyDoPeriodo(sbFalso, '2026-10-01', '2026-10-31'), null);
});

test('busca: exceção também devolve null, sem derrubar', async () => {
  const sbFalso = { from: () => { throw new Error('sem rede'); } };
  assert.equal(await buscarPedidosShopifyDoPeriodo(sbFalso, '2026-10-01', '2026-10-31'), null);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
node --test src/compartilhado/pedidos-shopify.test.mjs
```

Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

```js
// src/compartilhado/pedidos-shopify.js
//
// A ponte entre as TELAS e os pedidos da Loja Shopify. Busca no Supabase
// (bridge do navegador) e mescla no formato que as telas já entendem — depois
// disso nenhuma lógica de soma/ranking precisa saber que esta loja tem uma
// fonte diferente.
//
// Mesma régua de "o que conta como venda" do robô/webhook — importada do
// MESMO módulo (ver supabase/functions/_shared/pedido-shopify.js), não uma
// segunda cópia da lista. O arquivo é JS puro sem nada específico de Deno,
// então o navegador (via bundler) consegue importar dele direto.
import { STATUS_QUE_CONTAM } from '../../supabase/functions/_shared/pedido-shopify.js';

const LOJA_ID_SHOPIFY = 205512275;

// Devolve null quando não deu para consultar — "não sei", e quem chama
// mantém a tela como está (nunca interpreta null como "zero venda").
export async function buscarPedidosShopifyDoPeriodo(sbClient, di, df) {
  try {
    const { data, error } = await sbClient
      .from('shopify_pedidos')
      .select('id,total,criado_em_shopify,status_financeiro')
      .gte('criado_em_shopify', di)
      .lte('criado_em_shopify', df)
      .in('status_financeiro', STATUS_QUE_CONTAM);
    if (error) return null;
    return data || [];
  } catch {
    return null;
  }
}

// pedidosBling   : o array de pedidos que a tela já tem (formato do Bling)
// linhasShopify  : o que buscarPedidosShopifyDoPeriodo devolveu (nunca null aqui — quem chama já tratou isso)
// Devolve um array no MESMO formato de pedido do Bling — a loja Shopify
// passa a vir só desta fonte, nunca das duas ao mesmo tempo.
export function mesclarPedidosShopify(pedidosBling, linhasShopify, lojaIdShopify = LOJA_ID_SHOPIFY) {
  const semShopify = (pedidosBling || []).filter((p) => Number(p?.loja?.id) !== lojaIdShopify);
  const doShopify = (linhasShopify || []).map((l) => ({
    id: l.id,
    total: Number(l.total) || 0,
    data: String(l.criado_em_shopify || '').slice(0, 10),
    loja: { id: lojaIdShopify },
  }));
  return [...semShopify, ...doShopify];
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
node --test src/compartilhado/pedidos-shopify.test.mjs
```

Expected: todos PASS.

- [ ] **Step 5: Commit**

```bash
git add src/compartilhado/pedidos-shopify.js src/compartilhado/pedidos-shopify.test.mjs
git commit -m "feat: ponte do navegador para buscar e mesclar pedidos da Shopify nas telas"
```

---

### Task 8: Integrar na Gestão à Vista

**Files:**
- Modify: `src/ferramentas/gestao-a-vista/tela-de-gestao-a-vista.vue`

**Interfaces:**
- Consumes: `buscarPedidosShopifyDoPeriodo`, `mesclarPedidosShopify` (Task 7).

- [ ] **Step 1: Ler o arquivo e localizar os pontos de inserção por CONTEÚDO**

Este arquivo pode ter sido alterado por outra branch em paralelo (a branch `valor-liquido-de-troca`, que mexe nesta mesma tela). Leia o arquivo ANTES de editar e localize pelo texto, não por número de linha:

1. O import de `valor-corrigido.js` (ou, se a outra branch já estiver mesclada aqui, o import de `valor-liquido-de-troca.js` também) — adicione o import novo logo depois, no mesmo bloco de imports locais.
2. O bloco `Promise.all([...])` que já busca `aplicarDataDaVenda`/`buscarAjustesDeValor` (ou, se já mesclado, também `buscarDevolucoes`) — é o MESMO ponto onde `pedidos`/`pedidosPrev` ficam prontos antes do recorte por time.

- [ ] **Step 2: Import**

Adicionar, junto dos outros imports de `src/compartilhado/`:

```js
import { buscarPedidosShopifyDoPeriodo, mesclarPedidosShopify } from '../../compartilhado/pedidos-shopify.js'
```

- [ ] **Step 3: Buscar e mesclar**

Se a branch `valor-liquido-de-troca` AINDA NÃO estiver mesclada aqui, o bloco hoje é exatamente este (localize pelo texto `const [ajuste,ajustePrev,ajustesDeValor,ajustesDeVendedor]`):

```js
    const [ajuste,ajustePrev,ajustesDeValor,ajustesDeVendedor]=await Promise.all([
      aplicarDataDaVenda(sbClient,pedidosBrutos,di,df),
      aplicarDataDaVenda(sbClient,pedidosPrevBrutos,diPrev,dfPrev),
      buscarAjustesDeValor(sbClient),
      buscarAjustesDeVendedor(sbClient),
    ]);
    if(myLoad!==_gvLoadId)return;
    let pedidos=aplicarValorCorrigido(ajuste.pedidos,ajustesDeValor).pedidos;
    let pedidosPrev=aplicarValorCorrigido(ajustePrev.pedidos,ajustesDeValor).pedidos;
```

Troque por:

```js
    const [ajuste,ajustePrev,ajustesDeValor,ajustesDeVendedor,pedidosShopify,pedidosShopifyPrev]=await Promise.all([
      aplicarDataDaVenda(sbClient,pedidosBrutos,di,df),
      aplicarDataDaVenda(sbClient,pedidosPrevBrutos,diPrev,dfPrev),
      buscarAjustesDeValor(sbClient),
      buscarAjustesDeVendedor(sbClient),
      buscarPedidosShopifyDoPeriodo(sbClient,di,df),
      buscarPedidosShopifyDoPeriodo(sbClient,diPrev,dfPrev),
    ]);
    if(myLoad!==_gvLoadId)return;
    let pedidos=aplicarValorCorrigido(ajuste.pedidos,ajustesDeValor).pedidos;
    let pedidosPrev=aplicarValorCorrigido(ajustePrev.pedidos,ajustesDeValor).pedidos;
    // A LOJA SHOPIFY SAI DO BLING E ENTRA SÓ POR AQUI. Ver
    // docs/superpowers/specs/2026-10-03-pedidos-da-shopify-direto-design.md.
    // mesclarPedidosShopify tira o que o Bling trouxer dessa loja (trava
    // contra conta em dobro) e põe no lugar o que veio da Shopify direto.
    pedidos=mesclarPedidosShopify(pedidos,pedidosShopify||[]);
    pedidosPrev=mesclarPedidosShopify(pedidosPrev,pedidosShopifyPrev||[]);
```

**Se a branch `valor-liquido-de-troca` JÁ estiver mesclada aqui**, o `Promise.all` vai ter mais elementos (`buscarDevolucoes`) e vai haver mais duas linhas de `aplicarValorLiquidoDeTroca` depois das de `aplicarValorCorrigido` — o padrão é o mesmo, só adaptado: acrescente `buscarPedidosShopifyDoPeriodo(sbClient,di,df)` e a versão `Prev` ao array JÁ EXISTENTE (nunca crie um segundo `Promise.all`), e as duas linhas de `mesclarPedidosShopify` por ÚLTIMO — depois de QUALQUER outra correção de valor (`aplicarValorCorrigido` e `aplicarValorLiquidoDeTroca`), e antes do recorte por time (`filtrarPedidos`).

- [ ] **Step 4: Rodar testes e build**

```bash
npm test
npm run build
```

Expected: suíte sem regressão nova (compare a contagem de falhas antes e depois desta mudança — qualquer falha pré-existente não relacionada a este arquivo não é sua responsabilidade), build sem erro.

- [ ] **Step 5: Commit**

```bash
git add src/ferramentas/gestao-a-vista/tela-de-gestao-a-vista.vue
git commit -m "feat: Gestão à Vista lê a Loja Shopify direto da API, não mais do Bling"
```

---

### Task 9: Integrar na Análise de Vendas

**Files:**
- Modify: `src/ferramentas/analise-vendas/tela-de-analise-vendas.vue`

**Interfaces:**
- Consumes: `buscarPedidosShopifyDoPeriodo`, `mesclarPedidosShopify` (Task 7).

- [ ] **Step 1: Ler o arquivo e localizar por conteúdo**

Mesmo aviso da Task 8: localize o `Promise.all` com as 3 janelas (`aplicarDataDaVenda` atual/anterior/15 dias) pelo CONTEÚDO, não por número de linha — este arquivo também pode já ter sido alterado pela branch `valor-liquido-de-troca`.

- [ ] **Step 2: Import**

```js
import { buscarPedidosShopifyDoPeriodo, mesclarPedidosShopify } from '../../compartilhado/pedidos-shopify.js'
```

- [ ] **Step 3: Buscar e mesclar nas TRÊS janelas**

Se a branch `valor-liquido-de-troca` AINDA NÃO estiver mesclada aqui, o bloco hoje é exatamente este (localize pelo texto `const[aj,ajPrev,aj15,ajustesDeValor]`):

```js
    const[aj,ajPrev,aj15,ajustesDeValor]=await Promise.all([
      aplicarDataDaVenda(sbClient,pedidosBrutos,di,df),
      aplicarDataDaVenda(sbClient,pedidosPrevBrutos,diPrev,dfPrev),
      aplicarDataDaVenda(sbClient,pedidos15Brutos,di15,df15),
      buscarAjustesDeValor(sbClient),
    ]);
    aj.pedidos=aplicarValorCorrigido(aj.pedidos,ajustesDeValor).pedidos;
    ajPrev.pedidos=aplicarValorCorrigido(ajPrev.pedidos,ajustesDeValor).pedidos;
    aj15.pedidos=aplicarValorCorrigido(aj15.pedidos,ajustesDeValor).pedidos;
```

Troque por:

```js
    const[aj,ajPrev,aj15,ajustesDeValor,pedidosShopify,pedidosShopifyPrev,pedidosShopify15]=await Promise.all([
      aplicarDataDaVenda(sbClient,pedidosBrutos,di,df),
      aplicarDataDaVenda(sbClient,pedidosPrevBrutos,diPrev,dfPrev),
      aplicarDataDaVenda(sbClient,pedidos15Brutos,di15,df15),
      buscarAjustesDeValor(sbClient),
      buscarPedidosShopifyDoPeriodo(sbClient,di,df),
      buscarPedidosShopifyDoPeriodo(sbClient,diPrev,dfPrev),
      buscarPedidosShopifyDoPeriodo(sbClient,di15,df15),
    ]);
    aj.pedidos=aplicarValorCorrigido(aj.pedidos,ajustesDeValor).pedidos;
    ajPrev.pedidos=aplicarValorCorrigido(ajPrev.pedidos,ajustesDeValor).pedidos;
    aj15.pedidos=aplicarValorCorrigido(aj15.pedidos,ajustesDeValor).pedidos;
    // A LOJA SHOPIFY SAI DO BLING E ENTRA SÓ POR AQUI — mesma regra da
    // Gestão à Vista. Ver docs/superpowers/specs/2026-10-03-pedidos-da-shopify-direto-design.md.
    aj.pedidos=mesclarPedidosShopify(aj.pedidos,pedidosShopify||[]);
    ajPrev.pedidos=mesclarPedidosShopify(ajPrev.pedidos,pedidosShopifyPrev||[]);
    aj15.pedidos=mesclarPedidosShopify(aj15.pedidos,pedidosShopify15||[]);
```

**Se a branch `valor-liquido-de-troca` JÁ estiver mesclada aqui**, o `Promise.all` vai ter mais um elemento (`buscarDevolucoes`) e mais três linhas de `aplicarValorLiquidoDeTroca` (uma por janela) depois das de `aplicarValorCorrigido` — mesmo padrão adaptado: acrescente os três `buscarPedidosShopifyDoPeriodo` ao array JÁ EXISTENTE, e as três linhas de `mesclarPedidosShopify` por ÚLTIMO, depois de QUALQUER outra correção de valor, antes do `filtrarPedidos` por time.

- [ ] **Step 4: Rodar testes e build**

```bash
npm test
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/ferramentas/analise-vendas/tela-de-analise-vendas.vue
git commit -m "feat: Análise de Vendas lê a Loja Shopify direto da API, não mais do Bling"
```

---

### Task 10: Verificação final e nota de operação

**Files:** nenhum (só verificação e uma nota curta no topo do robô, se faltar)

- [ ] **Step 1: Suíte inteira**

```bash
npm test
```

Expected: os testes novos desta plan (Tasks 2, 3, 7) passam; nenhuma regressão nova nos arquivos tocados pelas Tasks 8/9.

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: sem erro.

- [ ] **Step 3: Checklist do que falta pro dono "só chegar e ligar"**

Confirme que existe, em algum lugar visível (o topo do robô já cobre isso, não precisa duplicar):
1. Nome exato das variáveis a configurar: `SHOPIFY_ADMIN_TOKEN`, `SHOPIFY_SHOP_DOMAIN` (em `coletor/.env` local e em Settings → Secrets → Actions do GitHub).
2. Nome exato do segredo de webhook a conferir/cadastrar: `SHOPIFY_WEBHOOK_SECRET` (já existe para o webhook de checkout — confirmar se é o mesmo app ou se a Shopify pede um segredo por webhook).
3. Onde cadastrar o webhook novo no admin da Shopify: Configurações → Notificações → Webhooks, tópicos `orders/create`, `orders/paid`, `orders/updated`, apontando para a URL de `receber-webhook-pedido-shopify` depois do deploy.

Se algum desses três pontos não estiver claro em nenhum comentário do código desta plan, acrescente uma linha curta no topo de `coletor/trazer-pedidos-da-shopify.mjs` — não crie um arquivo de documentação novo só para isso.
