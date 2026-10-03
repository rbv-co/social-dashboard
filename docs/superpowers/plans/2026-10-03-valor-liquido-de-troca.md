# Valor líquido de troca Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parar de contar "devolução de mercadoria" (troca) como venda nova no total por vendedora da Gestão à Vista e da Análise de Vendas.

**Architecture:** Uma tabela nova (`bling_pedido_forma_pagamento`) guarda, linha a linha, a forma de pagamento de cada pedido, com `eh_devolucao` já decidido pelo robô (via `tipoPagamento=5` no catálogo `formas-pagamentos` do Bling). Uma função pura (`aplicarValorLiquidoDeTroca`) subtrai essas devoluções do `total` do pedido, no mesmo ponto do pipeline onde `aplicarValorCorrigido` já atua hoje nas duas telas.

**Tech Stack:** Node 18+ (`node:test`), Postgres/Supabase (RLS), Vue 3 (telas), Deno (edge function `bling-proxy`), API Bling v3.

**Spec:** `docs/superpowers/specs/2026-10-03-valor-liquido-de-troca-design.md`

## Global Constraints

- Nenhuma tabela nova de cache para o catálogo `formas-pagamentos` — o robô busca em memória a cada rodada e descarta (decisão da spec).
- Classificação de devolução é por `tipoPagamento` (código fixo do Bling), nunca por nome de texto da forma de pagamento.
- Upsert por `parcela_id` (chave natural do Bling), não delete-then-insert.
- Backfill só outubro/2026 em diante — a janela padrão do robô (30 dias) já cobre isso sozinha.
- Latência aceita: pedido de hoje só corrige no relatório a partir do robô do dia seguinte (07h34 UTC). Nenhuma tela busca parcela ao vivo.
- Toda regra testável nova (classificação, cálculo de valor líquido, extração de linhas de parcela) é função pura com teste ao lado, em arquivo próprio — padrão do projeto (`PADRAO-DA-CENTRAL.md`).
- `npm test` roda tudo; `npm run build` precisa continuar passando depois de qualquer mudança nas `.vue`.

## Review Focus

- Pedido com **duas ou mais parcelas de devolução**: o valor líquido tem que subtrair a SOMA, não só a última parcela lida.
- `forma_pagamento_id` de uma parcela **que não está no catálogo** (Bling adicionou/removeu uma forma entre a leitura do catálogo e a do pedido): a parcela tem que ser gravada mesmo assim, com `eh_devolucao=false` — nunca pode derrubar o robô nem sumir com a parcela.
- Catálogo `formas-pagamentos` **inacessível no robô**: o robô tem que parar (lançar), não seguir gravando tudo como `eh_devolucao=false` — isso reintroduziria exatamente o bug que está sendo corrigido, calado.
- Tabela `bling_pedido_forma_pagamento` **fora do ar na hora da tela carregar**: a tela não pode ficar vazia nem travar — mesmo comportamento de hoje quando `bling_pedido_ajuste_valor` falha (devolve "não sei", pedidos ficam com o total de antes).
- Pedido **sem nenhuma parcela de devolução**: o objeto do pedido não pode ganhar `totalComTroca`/`valorDevolucao` nem ter o `total` alterado — só quem tem devolução é tocado.

---

### Task 1: Migration — tabela `bling_pedido_forma_pagamento`

**Files:**
- Create: `db/migrations/2026-10-03-forma-de-pagamento-do-pedido.sql`

**Interfaces:**
- Produces: tabela `public.bling_pedido_forma_pagamento (parcela_id, pedido_id, loja_id, forma_pagamento_id, valor, data_vencimento, eh_devolucao, atualizado_em)`, usada pelas Tasks 4, 5, 8.

- [ ] **Step 1: Escrever a migration**

```sql
-- Forma de pagamento de cada pedido, linha por linha — para separar troca
-- (devolução de mercadoria) de venda nova.
--
-- POR QUE ESTA TABELA EXISTE
-- Medido em 03/10/2026: pedido #2708 (Kariny, 01/10/2026) tem total R$1.900,00,
-- sendo R$1.600,00 pagos em "Devolução de mercadorias" (uma bolsa trocada) e só
-- R$300,00 em dinheiro/cartão de verdade. A Gestão à Vista e a Análise de Vendas
-- somam `pedido.total` sem olhar a forma de pagamento, então a troca contava
-- como venda nova inteira.
--
-- O NOME da forma de pagamento é editável pela loja no Bling ("Devolução de
-- mercadorias" pode virar outro texto amanhã). O que não muda é o
-- `tipoPagamento` do catálogo `formas-pagamentos` do Bling — medido:
-- tipoPagamento=5 é exclusivamente devolução nas 77 formas desta conta. Por
-- isso `eh_devolucao` é decidido pelo robô (que lê o catálogo) e gravado aqui
-- já pronto — a tela nunca precisa saber o que é tipoPagamento.
--
-- O QUE ESTA MIGRATION NÃO FAZ
-- Não muda número nenhum sozinha. Só cria o lugar; quem preenche é o robô
-- coletor/trazer-pedidos-do-bling.mjs, e quem passa a ler (bling_pedido_forma_
-- pagamento where eh_devolucao) são as telas, numa etapa seguinte e separada.

create table if not exists public.bling_pedido_forma_pagamento (
  parcela_id         bigint        primary key,      -- id da parcela no Bling
  pedido_id          bigint        not null,
  loja_id            bigint,                          -- canal, para o escopo por time
  forma_pagamento_id bigint        not null,
  valor              numeric(12,2) not null,
  data_vencimento    date,
  eh_devolucao       boolean       not null,          -- tipoPagamento=5 no catálogo do Bling
  atualizado_em      timestamptz   not null default now()
);

comment on table public.bling_pedido_forma_pagamento is
  'Forma de pagamento de cada pedido, linha por linha. Preenchida pelo robô coletor/trazer-pedidos-do-bling.mjs. eh_devolucao=true é o que as telas de venda subtraem do total (ver supabase/functions/_shared/valor-liquido-de-troca.js).';
comment on column public.bling_pedido_forma_pagamento.eh_devolucao is
  'true quando o tipoPagamento desta forma, no catálogo do Bling, é 5 (devolução de mercadoria/crédito loja). Decidido no robô, não na tela.';

-- pedido_id: join com o pedido. loja_id: lido pela política de escopo por
-- time — coluna de RLS sem índice é o jeito clássico de a tela ficar lenta só
-- para quem tem time. devolucao: é essa fatia pequena (só pedidos com troca)
-- que as telas leem a cada recarga, sem o corte de 500 ids que pvMap/pm têm.
create index if not exists idx_bpfp_pedido     on public.bling_pedido_forma_pagamento (pedido_id);
create index if not exists idx_bpfp_loja       on public.bling_pedido_forma_pagamento (loja_id);
create index if not exists idx_bpfp_devolucao  on public.bling_pedido_forma_pagamento (pedido_id) where eh_devolucao;

alter table public.bling_pedido_forma_pagamento enable row level security;

-- Leitura para quem está logado; escrita só pelo robô (service_role, que não
-- passa por RLS). Mesmo padrão de bling_pedido_nota.
drop policy if exists bpfp_leitura on public.bling_pedido_forma_pagamento;
create policy bpfp_leitura on public.bling_pedido_forma_pagamento
  for select to authenticated using (true);

-- RESTRICTIVE: política permissiva nova deixaria tudo passar e PARECERIA
-- instalada. O escopo por time continua valendo por esta porta nova também.
drop policy if exists bpfp_so_do_meu_canal on public.bling_pedido_forma_pagamento;
create policy bpfp_so_do_meu_canal on public.bling_pedido_forma_pagamento
  as restrictive for select to authenticated
  using (public.pode_ver_canal(loja_id));
```

- [ ] **Step 2: Aplicar no banco**

```bash
cd /Users/gabrielgertrudes/Projetos/Trabalho/lavessel/social-dashboard
set -a && source coletor/.env && set +a
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/2026-10-03-forma-de-pagamento-do-pedido.sql
```

Expected: `CREATE TABLE`, `COMMENT`, `CREATE INDEX` x3, `ALTER TABLE`, `DROP POLICY`/`CREATE POLICY` x2 — sem erro vermelho.

- [ ] **Step 3: Confirmar RLS e índices**

```bash
psql "$DATABASE_URL" -c "\d public.bling_pedido_forma_pagamento"
psql "$DATABASE_URL" -c "select polname, permissive, cmd from pg_policies where tablename='bling_pedido_forma_pagamento';"
```

Expected: a tabela existe com as 8 colunas, 3 índices listados, e duas policies (`bpfp_leitura` PERMISSIVE, `bpfp_so_do_meu_canal` RESTRICTIVE).

- [ ] **Step 4: Commit**

```bash
git add db/migrations/2026-10-03-forma-de-pagamento-do-pedido.sql
git commit -m "feat: tabela bling_pedido_forma_pagamento (forma de pagamento por pedido)"
```

---

### Task 2: Função pura — `ehDevolucaoDeMercadoria` e `aplicarValorLiquidoDeTroca`

**Files:**
- Create: `supabase/functions/_shared/valor-liquido-de-troca.js`
- Test: `supabase/functions/_shared/valor-liquido-de-troca.test.mjs`

**Interfaces:**
- Produces: `ehDevolucaoDeMercadoria(tipoPagamento): boolean`, `aplicarValorLiquidoDeTroca(pedidos, linhasDeDevolucao): { pedidos, ajustados }` — usados pela Task 3 (browser) e pelas Tasks 9/10 (telas). `linhasDeDevolucao` é `[{ pedido_id, valor }]` (mesma forma que `ajustes` em `valor-corrigido.js`).

- [ ] **Step 1: Escrever o teste (falhando)**

```js
// supabase/functions/_shared/valor-liquido-de-troca.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ehDevolucaoDeMercadoria, aplicarValorLiquidoDeTroca } from './valor-liquido-de-troca.js';

// A REGRA mora aqui (e não em src/) pelo mesmo motivo do data-da-venda/valor-
// corrigido: a Edge e os robôs não alcançam src/. Testes do que é do navegador
// ficam em src/compartilhado/valor-liquido-de-troca.test.mjs.

const ped = (id, total, extra = {}) => ({ id, total, loja: { id: 205834116 }, ...extra });
const linha = (pedido_id, valor) => ({ pedido_id, valor });

test('tipoPagamento=5 é devolução de mercadoria; qualquer outro, não', () => {
  assert.equal(ehDevolucaoDeMercadoria(5), true);
  assert.equal(ehDevolucaoDeMercadoria('5'), false, 'o Bling manda número, não string — não forçar conversão aqui');
  for (const outro of [1, 3, 4, 15, 16, 20, 99, 0, null, undefined]) {
    assert.equal(ehDevolucaoDeMercadoria(outro), false, `tipoPagamento ${outro} não é devolução`);
  }
});

test('o caso real: pedido #2708, total 1900 com 1600 de devolução vira 300', () => {
  const r = aplicarValorLiquidoDeTroca([ped(27018529287, 1900)], [linha(27018529287, 1600)]);
  assert.equal(r.pedidos[0].total, 300);
  assert.equal(r.pedidos[0].totalComTroca, 1900, 'o valor bruto fica guardado para explicar depois');
  assert.equal(r.pedidos[0].valorDevolucao, 1600);
  assert.equal(r.ajustados, 1);
});

test('pedido sem devolução não é tocado — nem ganha marca', () => {
  const r = aplicarValorLiquidoDeTroca([ped(1, 1900), ped(2, 500)], [linha(1, 1600)]);
  assert.equal(r.pedidos[1].total, 500);
  assert.equal(r.pedidos[1].totalComTroca, undefined);
  assert.equal(r.pedidos[1].valorDevolucao, undefined);
  assert.equal(r.ajustados, 1);
});

test('duas parcelas de devolução no mesmo pedido somam', () => {
  const r = aplicarValorLiquidoDeTroca([ped(1, 1000)], [linha(1, 300), linha(1, 200)]);
  assert.equal(r.pedidos[0].total, 500);
  assert.equal(r.pedidos[0].valorDevolucao, 500);
});

test('entra DEPOIS de valor-corrigido na cadeia: subtrai do total já corrigido', () => {
  // Simula o pedido já tendo passado por aplicarValorCorrigido.
  const jaCorrigido = { ...ped(1, 1900), total: 1615, totalDoBling: 1900, valorAjustado: true };
  const r = aplicarValorLiquidoDeTroca([jaCorrigido], [linha(1, 600)]);
  assert.equal(r.pedidos[0].total, 1015, 'subtrai do total corrigido, não do bruto do Bling');
  assert.equal(r.pedidos[0].totalComTroca, 1615, 'guarda o total ANTES da devolução, que já era o corrigido');
  assert.equal(r.pedidos[0].valorAjustado, true, 'marca de valor-corrigido não se perde');
});

test('devolução de pedido que não está na lista é ignorada — não inventa venda', () => {
  const r = aplicarValorLiquidoDeTroca([ped(1, 1900)], [linha(1, 100), linha(999, 50)]);
  assert.equal(r.pedidos.length, 1);
  assert.equal(r.ajustados, 1);
});

test('valor quebrado (zero, negativo, texto, nulo) não é aplicado', () => {
  for (const ruim of [0, -1, null, undefined, '', 'abacaxi', NaN]) {
    const r = aplicarValorLiquidoDeTroca([ped(1, 1900)], [linha(1, ruim)]);
    assert.equal(r.pedidos[0].total, 1900, `devolução ${String(ruim)} não podia passar`);
    assert.equal(r.ajustados, 0);
  }
});

test('valor em texto (numeric do Postgres volta como string) é aceito', () => {
  const r = aplicarValorLiquidoDeTroca([ped(1, 1900)], [linha(1, '1600.00')]);
  assert.equal(r.pedidos[0].total, 300);
});

test('sem devolução nenhuma, a lista volta como veio', () => {
  for (const vazio of [[], null, undefined]) {
    const r = aplicarValorLiquidoDeTroca([ped(1, 1900)], vazio);
    assert.equal(r.pedidos[0].total, 1900);
    assert.equal(r.ajustados, 0);
  }
});

test('lista de pedidos vazia não quebra', () => {
  for (const vazio of [[], null, undefined]) {
    const r = aplicarValorLiquidoDeTroca(vazio, [linha(1, 100)]);
    assert.deepEqual(r.pedidos, []);
  }
});

test('não muda o objeto original', () => {
  const original = ped(1, 1900);
  aplicarValorLiquidoDeTroca([original], [linha(1, 600)]);
  assert.equal(original.total, 1900);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
node --test supabase/functions/_shared/valor-liquido-de-troca.test.mjs
```

Expected: FAIL — `Cannot find module './valor-liquido-de-troca.js'`.

- [ ] **Step 3: Implementar**

```js
// supabase/functions/_shared/valor-liquido-de-troca.js
//
// O valor que ENTROU de verdade num pedido, separado do que foi troca.
//
// POR QUE ISTO EXISTE
// Medido em 03/10/2026: pedido #2708 (Kariny) tem total R$1.900,00 no Bling,
// mas R$1.600,00 desse total é a forma de pagamento "Devolução de
// mercadorias" — o valor de uma bolsa trocada, não dinheiro novo. Só
// R$300,00 entraram de verdade. As telas de venda somavam o total inteiro.
//
// POR QUE A CLASSIFICAÇÃO É POR tipoPagamento E NÃO PELO NOME
// O nome de uma forma de pagamento é texto livre, editável pela loja no
// Bling a qualquer momento. `tipoPagamento` é um código fixo do catálogo do
// Bling; medido nas 77 formas desta conta, tipoPagamento=5 é exclusivamente
// "Devolução de mercadorias". Quem decide isso é o robô (que lê o catálogo
# `formas-pagamentos`), e grava pronto em bling_pedido_forma_pagamento.eh_devolucao
// — esta função só soma o que já veio marcado.
//
// POR QUE ISTO MORA EM supabase/functions/_shared/ E NÃO EM src/
// Mesmo motivo dos vizinhos valor-corrigido.js e data-da-venda.js: roda no
// Deno e no robô do coletor, que não alcançam src/.
//
// ENTRA DEPOIS de aplicarValorCorrigido, nunca antes: o valor corrigido pode
// já ter mudado o total (nota fiscal congelada com valor errado), e a
// devolução tem que subtrair do número que vale de verdade, não do bruto do
// Bling — ver o teste "entra DEPOIS de valor-corrigido na cadeia".

function valorValido(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;   // devolução de 0 não existe
  return n;
}

// O código do Bling (não o nome) que marca "devolução de mercadoria / crédito
// loja". Comparação estrita: o Bling manda número no JSON; forçar conversão
// de texto aqui esconderia um bug de quem chama (ver teste do tipo errado).
export function ehDevolucaoDeMercadoria(tipoPagamento) {
  return tipoPagamento === 5;
}

// pedidos          : o que a tela tem na mão, já passado por valor-corrigido
// linhasDeDevolucao: linhas de bling_pedido_forma_pagamento onde eh_devolucao
//                    já veio true — [{ pedido_id, valor }], pode ter mais de
//                    uma por pedido.
// Devolve { pedidos, ajustados }.
export function aplicarValorLiquidoDeTroca(pedidos, linhasDeDevolucao) {
  const porId = new Map();
  for (const l of linhasDeDevolucao || []) {
    const valor = valorValido(l?.valor);
    if (valor === null) continue;
    const chave = String(l.pedido_id);
    porId.set(chave, (porId.get(chave) || 0) + valor);
  }

  let ajustados = 0;
  const saida = (pedidos || []).map((p) => {
    const devolucao = porId.get(String(p?.id ?? ''));
    if (!devolucao) return p;                        // sem devolução, nada muda
    ajustados++;
    return { ...p, total: p.total - devolucao, totalComTroca: p.total, valorDevolucao: devolucao };
  });

  return { pedidos: saida, ajustados };
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
node --test supabase/functions/_shared/valor-liquido-de-troca.test.mjs
```

Expected: todos os testes PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/valor-liquido-de-troca.js supabase/functions/_shared/valor-liquido-de-troca.test.mjs
git commit -m "feat: função pura do valor líquido de troca (devolução de mercadoria)"
```

---

### Task 3: Bridge do navegador — `src/compartilhado/valor-liquido-de-troca.js`

**Files:**
- Create: `src/compartilhado/valor-liquido-de-troca.js`
- Test: `src/compartilhado/valor-liquido-de-troca.test.mjs`

**Interfaces:**
- Consumes: `ehDevolucaoDeMercadoria`, `aplicarValorLiquidoDeTroca` (Task 2).
- Produces: `buscarDevolucoes(sbClient): Promise<Array|null>`, `aplicarDevolucaoDeTroca(sbClient, pedidos): Promise<{pedidos, ajustados, semBanco}>` — usados pelas Tasks 9 e 10.

- [ ] **Step 1: Escrever o teste (falhando)**

```js
// src/compartilhado/valor-liquido-de-troca.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aplicarDevolucaoDeTroca, buscarDevolucoes } from './valor-liquido-de-troca.js';

// A regra pura é testada em supabase/functions/_shared/valor-liquido-de-troca.test.mjs.
// Aqui ficam só os testes do que é do navegador: buscar as linhas e não deixar
// a tela quebrar quando o banco não responde. Mesmo arranjo de valor-corrigido.test.mjs.

const ped = (id, total = 1900) => ({ id, total, loja: { id: 205834116 } });
const linha = (pedido_id, valor) => ({ pedido_id, valor });

function sbComPaginas(paginas, chamadas = []) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          range: async (de, ate) => {
            chamadas.push([de, ate]);
            return { data: paginas.shift() ?? [], error: null };
          },
        }),
      }),
    }),
  };
}

test('banco fora do ar: a tela fica como está hoje, NUNCA vazia', async () => {
  const sbFalso = { from: () => ({ select: () => ({ eq: () => ({ range: async () => ({ data: null, error: { message: 'caiu' } }) }) }) }) };
  const r = await aplicarDevolucaoDeTroca(sbFalso, [ped(1), ped(2)]);
  assert.equal(r.pedidos.length, 2, 'perder a tela de vendas é pior que mostrar o valor bruto');
  assert.equal(r.semBanco, true);
  assert.equal(r.pedidos[0].total, 1900);
  assert.equal(r.ajustados, 0);
});

test('consulta que estoura exceção também devolve "não sei", sem derrubar', async () => {
  const sbFalso = { from: () => { throw new Error('sem rede'); } };
  assert.equal(await buscarDevolucoes(sbFalso), null);
});

test('com banco respondendo, a devolução entra', async () => {
  const r = await aplicarDevolucaoDeTroca(sbComPaginas([[linha(27018529287, '1600.00')]]), [ped(27018529287)]);
  assert.equal(r.pedidos[0].total, 300);
  assert.equal(r.pedidos[0].totalComTroca, 1900);
  assert.equal(r.ajustados, 1);
  assert.equal(r.semBanco, false);
});

test('tabela vazia: ninguém é tocado e nada quebra', async () => {
  const r = await aplicarDevolucaoDeTroca(sbComPaginas([[]]), [ped(1), ped(2)]);
  assert.equal(r.ajustados, 0);
  assert.equal(r.pedidos.length, 2);
  assert.equal(r.semBanco, false);
});

test('busca pagina de mil em mil — o PostgREST corta em 1000 sem avisar', async () => {
  const chamadas = [];
  const pagina1 = Array.from({ length: 1000 }, (_, i) => linha(i + 1, 10));
  const sb = sbComPaginas([pagina1, [linha(1001, 10)]], chamadas);
  const linhas = await buscarDevolucoes(sb);
  assert.equal(linhas.length, 1001);
  assert.deepEqual(chamadas[0], [0, 999]);
  assert.deepEqual(chamadas[1], [1000, 1999]);
});

test('a tabela inteira (filtrada por eh_devolucao) é lida — não se filtra pelos ids da janela', async () => {
  const chamadas = [];
  await buscarDevolucoes(sbComPaginas([[]], chamadas));
  assert.equal(chamadas.length, 1, 'uma consulta só, sem depender de quantos pedidos a janela tem');
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
node --test src/compartilhado/valor-liquido-de-troca.test.mjs
```

Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

```js
// src/compartilhado/valor-liquido-de-troca.js
//
// A ponte entre as TELAS e a regra do valor líquido de troca.
//
// A REGRA em si mora em `supabase/functions/_shared/valor-liquido-de-troca.js`,
// porque a Edge e os robôs não alcançam `src/`. Aqui fica só o que é do
// navegador: buscar as linhas no Supabase pelo cliente logado. Mesmo arranjo
// de valor-corrigido.js.
import { aplicarValorLiquidoDeTroca } from '../../supabase/functions/_shared/valor-liquido-de-troca.js'

export { aplicarValorLiquidoDeTroca, ehDevolucaoDeMercadoria } from '../../supabase/functions/_shared/valor-liquido-de-troca.js'

// ── Busca as devoluções ──────────────────────────────────────────────────
// Lê só a fatia `eh_devolucao=true` de bling_pedido_forma_pagamento — é de
// exceção (a maioria dos pedidos não tem troca), e filtrar por `in(<ids>)`
// traria de volta o corte de 500 ids que já morde o cache de vendedores.
//
// Devolve null quando não deu para consultar — null significa "não sei", e
// quem chama mantém a tela como está. Uma tela de vendas nunca pode ficar
// vazia por causa deste ajuste.
export async function buscarDevolucoes(sbClient) {
  const linhas = [];
  const PAGINA = 1000;   // o PostgREST corta em 1000 sem avisar — paginar sempre
  try {
    for (let inicio = 0; ; inicio += PAGINA) {
      const { data, error } = await sbClient
        .from('bling_pedido_forma_pagamento')
        .select('pedido_id,valor')
        .eq('eh_devolucao', true)
        .range(inicio, inicio + PAGINA - 1);
      if (error) return null;
      linhas.push(...(data || []));
      if (!data || data.length < PAGINA) break;
    }
  } catch { return null; }
  return linhas;
}

// ── O atalho que as telas usam ───────────────────────────────────────────
export async function aplicarDevolucaoDeTroca(sbClient, pedidos) {
  const linhas = await buscarDevolucoes(sbClient);
  if (linhas === null) {
    return { pedidos: pedidos || [], ajustados: 0, semBanco: true };
  }
  return { ...aplicarValorLiquidoDeTroca(pedidos, linhas), semBanco: false };
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
node --test src/compartilhado/valor-liquido-de-troca.test.mjs
```

Expected: todos PASS.

- [ ] **Step 5: Commit**

```bash
git add src/compartilhado/valor-liquido-de-troca.js src/compartilhado/valor-liquido-de-troca.test.mjs
git commit -m "feat: ponte do navegador para o valor líquido de troca"
```

---

### Task 4: Liberar `formas-pagamentos` no proxy do Bling

**Files:**
- Modify: `supabase/functions/bling-proxy/caminhos-permitidos.test.mjs:36-44`
- Modify: `supabase/functions/bling-proxy/index.ts:46-62`

**Interfaces:**
- Produces: endpoint `formas-pagamentos` liberado no proxy, usado pela Task 6.

- [ ] **Step 1: Adicionar ao teste (falhando)**

Em `supabase/functions/bling-proxy/caminhos-permitidos.test.mjs`, no array do teste `'os caminhos que as telas usam CONTINUAM abertos'` (linha 37-42), adicionar `'formas-pagamentos'`:

```js
test('os caminhos que as telas usam CONTINUAM abertos', () => {
  for (const bom of [
    'pedidos/vendas', 'pedidos/vendas/123', 'vendedores/45',
    'produtos', 'produtos/999', 'estoques/saldos',
    'nfe', 'nfe/7', 'nfce', 'nfce/7',
    'depositos', 'formas-pagamentos',
  ]) {
    assert.ok(permite(bom), `caminho que uma tela usa foi fechado: ${bom}`);
  }
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
node --test supabase/functions/bling-proxy/caminhos-permitidos.test.mjs
```

Expected: FAIL em `'caminho que uma tela usa foi fechado: formas-pagamentos'`.

- [ ] **Step 3: Liberar no allowlist**

Em `supabase/functions/bling-proxy/index.ts`, dentro de `CAMINHOS_PERMITIDOS` (linha 46-62), adicionar logo após `depositos`:

```ts
  /^depositos$/,
  // `formas-pagamentos` entrou em 03/10/2026: só o CATÁLOGO (id, descrição,
  // tipoPagamento) de formas de pagamento cadastradas. Não traz pedido, não
  // traz cliente, não traz saldo — usado para separar devolução de
  // mercadoria (tipoPagamento=5) de venda nova. Ver
  // supabase/functions/_shared/valor-liquido-de-troca.js.
  /^formas-pagamentos$/,
  /^nfe$/,
```

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
node --test supabase/functions/bling-proxy/caminhos-permitidos.test.mjs
```

Expected: todos os testes PASS, incluindo `'⚠️ o que NAO e da Central continua fechado'` (confirma que `financeiro`/`contas/pagar`/`contas/receber` seguem bloqueados).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/bling-proxy/index.ts supabase/functions/bling-proxy/caminhos-permitidos.test.mjs
git commit -m "feat: libera formas-pagamentos (só catálogo) no proxy do Bling"
```

---

### Task 5: Publicar o `bling-proxy` atualizado — ⚠️ PASSO MANUAL, CONFIRMAR ANTES

**Não automatizar este passo.** `CLAUDE.md` deste repositório documenta dois incidentes (13/08 e 17/09/2026) de publicação de edge function sobrescrevendo trabalho de outra pessoa. Antes de rodar `supabase functions deploy`, EU (o agente) preciso parar e seguir, na ordem, o checklist de `CLAUDE.md` seção "ANTES DE PUBLICAR EDGE FUNCTION":

- [ ] **Step 1: `git fetch` e partir de `origin/main` atualizado**

```bash
git fetch origin
git log origin/main -1
```

Confirmar que a Task 4 já está mergeada em `main` antes de publicar — só se publica o que já está na `main`.

- [ ] **Step 2: Baixar o que está no ar e comparar arquivo por arquivo**

```bash
npx supabase functions download bling-proxy --project-ref kounqtdoioootxqegkij --use-api --workdir /tmp/no-ar
shasum -a 256 /tmp/no-ar/bling-proxy/index.ts supabase/functions/bling-proxy/index.ts
```

Se o hash do que está no ar for diferente do que havia ANTES desta Task (não do que vou publicar agora), parar e descobrir quem publicou — o `entrypoint_path` no painel do Supabase mostra o computador de origem.

- [ ] **Step 3: Publicar com `verify_jwt` desligado**

```bash
npx supabase functions deploy bling-proxy --project-ref kounqtdoioootxqegkij --no-verify-jwt
```

- [ ] **Step 4: Conferir autenticação**

```bash
curl -s -o /dev/null -w "%{http_code}\n" "$SUPABASE_URL/functions/v1/bling-proxy" \
  -H "Authorization: Bearer errado" -H "apikey: $SUPABASE_SERVICE_KEY" -H "Content-Type: application/json" \
  -d '{"endpoint":"formas-pagamentos","params":{}}'
```

Expected: `401`, e o corpo deve ser `{"error":"nao_autorizado"}` — nunca `503`.

- [ ] **Step 5: Smoke test do endpoint liberado**

Rodar a chamada de leitura já usada durante o desenho (login da conta de serviço + `bling-proxy` com `endpoint: "formas-pagamentos"`) e confirmar que volta a lista de formas de pagamento, não erro de caminho bloqueado.

---

### Task 6: `blingFormasDePagamento` — busca o catálogo do Bling

**Files:**
- Modify: `coletor/lib/bling-comercial.mjs`

**Interfaces:**
- Consumes: `blingProxy(token, endpoint, params)` (já existe no arquivo).
- Produces: `blingFormasDePagamento(token): Promise<Array<{id: number, tipoPagamento: number}>>` — usado pela Task 8.

- [ ] **Step 1: Implementar** (sem teste dedicado — é I/O puro contra o Bling, mesmo padrão de `blingDepositos` no mesmo arquivo, que também não tem teste)

Em `coletor/lib/bling-comercial.mjs`, logo depois da função `blingDepositos` (linha 46):

```js
// O catálogo de formas de pagamento: id → tipoPagamento (código fixo do
// Bling, não o nome — a loja pode renomear a forma de pagamento a qualquer
// hora; o código não muda). Usado para marcar tipoPagamento=5 ("Devolução de
// mercadorias"/crédito loja) nas parcelas de um pedido. Ver
// supabase/functions/_shared/valor-liquido-de-troca.js.
//
// Bounded em 20 páginas (2000 formas) por segurança, mesmo padrão de
// blingProdutos — esta conta tem 77 hoje.
export async function blingFormasDePagamento(token, maxPaginas = 20) {
  const todas = [];
  for (let pagina = 1; pagina <= maxPaginas; pagina++) {
    const resp = await blingProxy(token, 'formas-pagamentos', { pagina, limite: 100 });
    const d = resp.data;
    if (!Array.isArray(d) || !d.length) break;
    todas.push(...d);
    if (d.length < 100) break;
  }
  return todas
    .map((f) => ({ id: Number(f.id), tipoPagamento: Number(f.tipoPagamento) }))
    .filter((f) => Number.isFinite(f.id));
}
```

- [ ] **Step 2: Commit**

```bash
git add coletor/lib/bling-comercial.mjs
git commit -m "feat: blingFormasDePagamento busca o catálogo de formas de pagamento do Bling"
```

---

### Task 7: `linhasDeFormaPagamento` — extrai as parcelas de um pedido

**Files:**
- Create: `coletor/lib/forma-pagamento.mjs`
- Test: `coletor/lib/forma-pagamento.test.mjs`

**Interfaces:**
- Consumes: `ehDevolucaoDeMercadoria` (Task 2).
- Produces: `linhasDeFormaPagamento(pedidoId, lojaId, parcelas, tipoPagamentoPorFormaId): Array<{parcela_id, pedido_id, loja_id, forma_pagamento_id, valor, data_vencimento, eh_devolucao}>` — usado pela Task 8. `tipoPagamentoPorFormaId` é um `Map(String(forma_pagamento_id) -> tipoPagamento)`.

- [ ] **Step 1: Escrever o teste (falhando)**

```js
// coletor/lib/forma-pagamento.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linhasDeFormaPagamento } from './forma-pagamento.mjs';

// Parcelas reais do pedido #2708 (Kariny, 01/10/2026), lidas no Bling em
// 03/10/2026: detalhe.parcelas = [
//   { id: 19590588502, valor: 300,  dataVencimento: '2026-10-01', formaPagamento: { id: 7621351 } },  // Cartão 1x
//   { id: 19590588503, valor: 1600, dataVencimento: '2026-10-01', formaPagamento: { id: 7467470 } },  // Devolução de mercadorias
// ]
const parcelasReais = [
  { id: 19590588502, valor: 300, dataVencimento: '2026-10-01', formaPagamento: { id: 7621351 } },
  { id: 19590588503, valor: 1600, dataVencimento: '2026-10-01', formaPagamento: { id: 7467470 } },
];
const catalogo = new Map([['7621351', 3], ['7467470', 5]]); // 3 = Cartão, 5 = Devolução

test('o caso real: pedido #2708 vira duas linhas, só a de 1600 marcada como devolução', () => {
  const linhas = linhasDeFormaPagamento(27018529287, 205834116, parcelasReais, catalogo);
  assert.equal(linhas.length, 2);
  const cartao = linhas.find((l) => l.parcela_id === 19590588502);
  const devolucao = linhas.find((l) => l.parcela_id === 19590588503);
  assert.equal(cartao.eh_devolucao, false);
  assert.equal(cartao.valor, 300);
  assert.equal(cartao.pedido_id, 27018529287);
  assert.equal(cartao.loja_id, 205834116);
  assert.equal(cartao.forma_pagamento_id, 7621351);
  assert.equal(cartao.data_vencimento, '2026-10-01');
  assert.equal(devolucao.eh_devolucao, true);
  assert.equal(devolucao.valor, 1600);
});

test('forma de pagamento fora do catálogo: grava a parcela com eh_devolucao=false, não some com ela', () => {
  const parcela = [{ id: 1, valor: 50, dataVencimento: '2026-10-01', formaPagamento: { id: 999999 } }];
  const linhas = linhasDeFormaPagamento(1, 1, parcela, new Map());
  assert.equal(linhas.length, 1, 'a parcela tem que ser gravada mesmo sem achar o tipoPagamento');
  assert.equal(linhas[0].eh_devolucao, false);
  assert.equal(linhas[0].forma_pagamento_id, 999999);
});

test('parcela sem id ou sem formaPagamento é descartada — não dá para gravar sem chave', () => {
  const parcelas = [
    { valor: 50, formaPagamento: { id: 1 } },           // sem id da parcela
    { id: 2, valor: 50 },                                // sem formaPagamento
    { id: 3, valor: 50, formaPagamento: {} },            // formaPagamento sem id
  ];
  const linhas = linhasDeFormaPagamento(1, 1, parcelas, catalogo);
  assert.equal(linhas.length, 0);
});

test('sem parcela nenhuma, devolve lista vazia', () => {
  for (const vazio of [[], null, undefined]) {
    assert.deepEqual(linhasDeFormaPagamento(1, 1, vazio, catalogo), []);
  }
});

test('loja_id nulo é aceito (detalhe do Bling sem loja)', () => {
  const linhas = linhasDeFormaPagamento(1, null, [parcelasReais[0]], catalogo);
  assert.equal(linhas[0].loja_id, null);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
node --test coletor/lib/forma-pagamento.test.mjs
```

Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

```js
// coletor/lib/forma-pagamento.mjs
//
// Transforma `detalhe.parcelas` (do pedido no Bling) nas linhas que vão para
// `bling_pedido_forma_pagamento`. Pura: não lê nem grava nada — quem chama
// (trazer-pedidos-do-bling.mjs) já tem o catálogo tipoPagamentoPorFormaId em
// mãos (ver blingFormasDePagamento, em bling-comercial.mjs).
import { ehDevolucaoDeMercadoria } from '../../supabase/functions/_shared/valor-liquido-de-troca.js';

// pedidoId, lojaId     : do pedido (detalhe.loja?.id pode vir null)
// parcelas             : detalhe.parcelas do Bling
// tipoPagamentoPorFormaId : Map(String(forma_pagamento_id) -> tipoPagamento)
export function linhasDeFormaPagamento(pedidoId, lojaId, parcelas, tipoPagamentoPorFormaId) {
  return (parcelas || [])
    .filter((parcela) => parcela?.id != null && parcela?.formaPagamento?.id != null)
    .map((parcela) => {
      const formaId = Number(parcela.formaPagamento.id);
      const tipo = tipoPagamentoPorFormaId?.get(String(formaId));
      return {
        parcela_id: parcela.id,
        pedido_id: pedidoId,
        loja_id: lojaId ?? null,
        forma_pagamento_id: formaId,
        valor: Number(parcela.valor) || 0,
        data_vencimento: parcela.dataVencimento || null,
        // tipo===undefined (forma fora do catálogo): grava mesmo assim, do
        // lado seguro (não marca como devolução sem ter certeza).
        eh_devolucao: tipo !== undefined && ehDevolucaoDeMercadoria(tipo),
      };
    });
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
node --test coletor/lib/forma-pagamento.test.mjs
```

Expected: todos PASS.

- [ ] **Step 5: Commit**

```bash
git add coletor/lib/forma-pagamento.mjs coletor/lib/forma-pagamento.test.mjs
git commit -m "feat: linhasDeFormaPagamento extrai as parcelas de um pedido do Bling"
```

---

### Task 8: Robô — gravar forma de pagamento por pedido

**Files:**
- Modify: `coletor/trazer-pedidos-do-bling.mjs:1-45` (imports), `:101-104` (catálogo, uma vez por rodada), `:194-225` (dentro do laço por pedido)

**Interfaces:**
- Consumes: `blingFormasDePagamento` (Task 6), `linhasDeFormaPagamento` (Task 7).
- Produces: linhas gravadas em `bling_pedido_forma_pagamento` — consumidas pela Task 3/9/10 em produção, e verificadas manualmente na Task 11.

- [ ] **Step 1: Import novo**

Em `coletor/trazer-pedidos-do-bling.mjs`, linha 38 (junto dos outros imports de `bling-comercial.mjs`):

```js
import { loginServico, blingProxy, blingFormasDePagamento } from './lib/bling-comercial.mjs';
import { linhasDeFormaPagamento } from './lib/forma-pagamento.mjs';
```

- [ ] **Step 2: Buscar o catálogo uma vez por rodada**

Logo após a linha 104 (`console.log(`\njanela: ...`)`), antes do passo "1. TODOS os pedidos":

```js
  // ── 0. o catálogo de formas de pagamento, uma vez por rodada ───────────────
  // Decide quais parcelas são devolução de mercadoria (tipoPagamento=5), não
  // venda nova. Se não der para ler, o robô TEM que parar — seguir sem o
  // catálogo classificaria toda troca como venda normal de novo, o bug que
  // esta mudança corrige. Ver supabase/functions/_shared/valor-liquido-de-troca.js.
  const formasDePagamento = await blingFormasDePagamento(token);
  if (!formasDePagamento.length) {
    throw new Error('catálogo de formas de pagamento veio vazio — não dá para classificar devolução, parando.');
  }
  const tipoPagamentoPorFormaId = new Map(formasDePagamento.map((f) => [String(f.id), f.tipoPagamento]));
  console.log(`${formasDePagamento.length} formas de pagamento no catálogo`
    + ` (${formasDePagamento.filter((f) => f.tipoPagamento === 5).length} marcadas como devolução)`);
```

- [ ] **Step 3: Gravar as linhas por pedido**

Dentro do laço `for (const p of pedidos) { ... }` (linha 194), logo depois do bloco que insere em `vessel_pedidos` (depois do `cli.query(insert into vessel_pedidos ...)` que devolve `linha`, por volta da linha 289-290 — ver o arquivo atual para a linha exata onde esse `cli.query` termina):

```js
    // ── forma de pagamento desta venda, linha por linha ──────────────────────
    // Upsert por parcela_id (chave do próprio Bling): se o Bling recriar a
    // parcela com id novo ao editar o pedido, a linha antiga fica órfã — caso
    // raro, aceito por ora (ver spec).
    const linhasFP = linhasDeFormaPagamento(p.id, detalhe.loja?.id || null, detalhe.parcelas, tipoPagamentoPorFormaId);
    for (const l of linhasFP) {
      await cli.query(
        `insert into bling_pedido_forma_pagamento
           (parcela_id, pedido_id, loja_id, forma_pagamento_id, valor, data_vencimento, eh_devolucao, atualizado_em)
         values ($1,$2,$3,$4,$5,$6,$7, now())
         on conflict (parcela_id) do update set
           pedido_id = excluded.pedido_id, loja_id = excluded.loja_id,
           forma_pagamento_id = excluded.forma_pagamento_id, valor = excluded.valor,
           data_vencimento = excluded.data_vencimento, eh_devolucao = excluded.eh_devolucao,
           atualizado_em = now()`,
        [l.parcela_id, l.pedido_id, l.loja_id, l.forma_pagamento_id, l.valor, l.data_vencimento, l.eh_devolucao],
      );
    }
```

Isso entra DEPOIS do `if (ensaio) continue;` existente (linha 225) — em modo ensaio, nada é gravado, igual ao resto do robô.

- [ ] **Step 4: Rodar em modo ensaio contra produção**

```bash
cd /Users/gabrielgertrudes/Projetos/Trabalho/lavessel/social-dashboard
node coletor/trazer-pedidos-do-bling.mjs --dias=5 --ensaio
```

Expected: loga a contagem de formas de pagamento e a de devolução (`X marcadas como devolução`), processa os pedidos sem erro, e termina sem gravar nada (ensaio).

- [ ] **Step 5: Rodar de verdade (gravando) para a janela de outubro**

```bash
node coletor/trazer-pedidos-do-bling.mjs --dias=5
```

Expected: roda sem lançar, loga `gravados: N`.

- [ ] **Step 6: Conferir o pedido #2708 no banco**

```bash
set -a && source coletor/.env && set +a
curl -s "$SUPABASE_URL/rest/v1/bling_pedido_forma_pagamento?pedido_id=eq.27018529287&select=*" \
  -H "apikey: $SUPABASE_SERVICE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_KEY"
```

Expected: duas linhas — `parcela_id=19590588502` com `eh_devolucao=false, valor=300`, e `parcela_id=19590588503` com `eh_devolucao=true, valor=1600`.

- [ ] **Step 7: Commit**

```bash
git add coletor/trazer-pedidos-do-bling.mjs
git commit -m "feat: robô grava forma de pagamento por pedido (separa troca de venda nova)"
```

---

### Task 9: Extrair `calcularRankingPorVendedor` (dedup) em Gestão à Vista

**Files:**
- Create: `src/ferramentas/gestao-a-vista/ranking-por-vendedor.js`
- Test: `src/ferramentas/gestao-a-vista/ranking-por-vendedor.test.mjs`
- Modify: `src/ferramentas/gestao-a-vista/tela-de-gestao-a-vista.vue:324-352` (`_gvUpdateVendRanking`), `:1177-1200` (bloco dentro de `renderGestaoVista`)

**Interfaces:**
- Produces: `calcularRankingPorVendedor(pedidos, pedidosPrev, pedidoVendorMap, vendedoresCache, canaisMap): { vendsArr, porVendPrev }` — usado pelas duas funções da `.vue` acima.

- [ ] **Step 1: Escrever o teste (falhando)**

```js
// src/ferramentas/gestao-a-vista/ranking-por-vendedor.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularRankingPorVendedor } from './ranking-por-vendedor.js';

const ped = (id, vendedorId, total, lojaId = 1) => ({ id, total, vendedor: { id: vendedorId }, loja: { id: lojaId } });

test('soma total e conta pedidos por vendedora', () => {
  const r = calcularRankingPorVendedor(
    [ped(1, 10, 300), ped(2, 10, 200), ped(3, 20, 500)],
    [],
    {},
    { 10: { nome: 'Kariny Stefany' }, 20: { nome: 'Outra Vendedora' } },
    { 1: 'Shopping Tivoli' },
  );
  const kariny = r.vendsArr.find((v) => v.nm === 'Kariny Stefany');
  assert.equal(kariny.total, 500);
  assert.equal(kariny.cnt, 2);
  assert.equal(kariny.canal, 'Shopping Tivoli');
});

test('usa pedidoVendorMap por cima de p.vendedor?.id quando presente', () => {
  const r = calcularRankingPorVendedor(
    [ped(1, 10, 300)], [], { 1: 999 }, { 999: { nome: 'Corrigida' }, 10: { nome: 'Errada' } }, {},
  );
  assert.equal(r.vendsArr[0].nm, 'Corrigida');
});

test('sem nome conhecido, cai em "Sem vendedor"', () => {
  const r = calcularRankingPorVendedor([ped(1, 77, 100)], [], {}, {}, {});
  assert.equal(r.vendsArr[0].nm, 'Sem vendedor');
});

test('porVendPrev soma o período anterior pela mesma chave', () => {
  const r = calcularRankingPorVendedor(
    [ped(1, 10, 300)], [ped(2, 10, 250)], {}, { 10: { nome: 'Kariny' } }, {},
  );
  assert.equal(r.porVendPrev['10'], 250);
});

test('ordena do maior para o menor total', () => {
  const r = calcularRankingPorVendedor(
    [ped(1, 10, 100), ped(2, 20, 900)], [], {}, { 10: { nome: 'A' }, 20: { nome: 'B' } }, {},
  );
  assert.equal(r.vendsArr[0].nm, 'B');
  assert.equal(r.vendsArr[1].nm, 'A');
});

test('listas vazias não quebram', () => {
  const r = calcularRankingPorVendedor([], [], {}, {}, {});
  assert.deepEqual(r.vendsArr, []);
  assert.deepEqual(r.porVendPrev, {});
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
node --test src/ferramentas/gestao-a-vista/ranking-por-vendedor.test.mjs
```

Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

```js
// src/ferramentas/gestao-a-vista/ranking-por-vendedor.js
//
// O cálculo do ranking por vendedora, extraído de dentro de duas funções da
// tela (_gvUpdateVendRanking e renderGestaoVista) que faziam a MESMA conta
// com nomes de variável diferentes. Até 03/10/2026 eram dois lugares — e
// uma correção (ex: valor líquido de troca) que entrasse só num deles faria
// os dois discordarem, o mesmo tipo de bug que data-da-venda e
// valor-corrigido já existem para evitar em outro canto da tela.
export function calcularRankingPorVendedor(pedidos, pedidosPrev, pedidoVendorMap, vendedoresCache, canaisMap) {
  const vm = vendedoresCache || {};
  const pm = pedidoVendorMap || {};
  const cm = canaisMap || {};

  const porVendObj = {};
  (pedidos || []).forEach((p) => {
    const vId = pm[p.id] || p.vendedor?.id;
    const vNome = (vm[vId]?.nome || 'Sem vendedor').split(' ').slice(0, 2).join(' ');
    const canal = cm[p.loja?.id] || '';
    const key = vId || vNome;
    if (!porVendObj[key]) porVendObj[key] = { nm: vNome, total: 0, cnt: 0, canalCnt: {} };
    porVendObj[key].total += parseFloat(p.total || 0);
    porVendObj[key].cnt++;
    if (canal) porVendObj[key].canalCnt[canal] = (porVendObj[key].canalCnt[canal] || 0) + 1;
  });
  Object.values(porVendObj).forEach((vd) => {
    const e = Object.entries(vd.canalCnt);
    vd.canal = e.sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  });
  const vendsArr = Object.values(porVendObj).sort((a, b) => b.total - a.total);

  const porVendPrev = {};
  (pedidosPrev || []).forEach((p) => {
    const vId = pm[p.id] || p.vendedor?.id;
    const vNome = (vm[vId]?.nome || 'Sem vendedor').split(' ').slice(0, 2).join(' ');
    const key = vId || vNome;
    porVendPrev[key] = (porVendPrev[key] || 0) + parseFloat(p.total || 0);
  });

  return { porVendObj, vendsArr, porVendPrev };
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
node --test src/ferramentas/gestao-a-vista/ranking-por-vendedor.test.mjs
```

Expected: todos PASS.

- [ ] **Step 5: Usar o helper em `_gvUpdateVendRanking`**

Em `tela-de-gestao-a-vista.vue`, substituir o corpo de `_gvUpdateVendRanking` (linhas 324-353, do `const porVendObj={};` até `const porVendPrev=...` inclusive, mantendo o resto da função — `maxVend`, `numCls`, `fmtR0`, `fmtK`, `el.innerHTML=...` — intocado):

```js
function _gvUpdateVendRanking(){
  const ctx=window._gvRenderCtx;
  if(!ctx)return;
  const el=document.getElementById('gv-rank-inner-v');
  if(!el)return;
  const pedidos=ctx.pedidosView||ctx.pedidos;
  const {pedidosPrev,canais}=ctx;
  const {porVendObj,vendsArr,porVendPrev}=calcularRankingPorVendedor(
    pedidos,pedidosPrev,window._gvPedidoVendorMap,window._gvVendedoresCache,canais);
  const maxVend=vendsArr[0]?.total||1;
  function numCls(i){return i===0?'gold':i===1?'silver':i===2?'bronze':'rest';}
  function fmtR0(v){return 'R$ '+Math.round(Number(v)).toLocaleString('pt-BR');}
  function fmtK(v){const a=Math.abs(v);return a>=1e6?(v/1e6).toFixed(1)+'M':a>=1e3?(v/1e3).toFixed(0)+'k':String(Math.round(v));}
  el.innerHTML=vendsArr.slice(0,12).map((vd,i)=>{
    // Mesma busca de chave de antes da extração: porVendObj mapeia
    // id-ou-nome -> objeto do vendedor, e porVendPrev usa a mesma chave.
    const key=Object.keys(porVendObj).find(k=>porVendObj[k]===vd)||vd.nm;
    const vPrev=porVendPrev[key]||0;
    const vDelta=vPrev>0?Math.round((vd.total-vPrev)/vPrev*100):null;
    return `<div class="gv-rank-entry">
      <span class="gv-rank-num ${numCls(i)}">${i+1}</span>
      <div class="gv-rank-body">
        <div class="gv-rank-row">
          <span class="gv-rank-nm">${escHtml(vd.nm)}${vd.canal?` <span style="opacity:.55;font-size:.85em">· ${escHtml(vd.canal)}</span>`:''}</span>
          <div style="display:flex;align-items:center;gap:3px;flex-shrink:0">
            ${vDelta!=null?`<span class="gv-rank-delta ${vDelta>=0?'up':'dn'}">${vDelta>=0?'↑':'↓'}${Math.abs(vDelta)}%</span>`:''}
            <span class="gv-rank-v">${fmtR0(vd.total)}</span>
          </div>
        </div>
        <div class="gv-rank-bar"><div class="gv-rank-bar-fill ${numCls(i)}" style="width:${Math.round(vd.total/maxVend*100)}%"></div></div>
        <div class="gv-rank-hint">${vd.cnt} pedido${vd.cnt!==1?'s':''}</div>
      </div>
    </div>`;
  }).join('');
}
```

- [ ] **Step 6: Usar o helper no bloco de `renderGestaoVista`**

Substituir as linhas 1177-1200 (do comentário `// Per vendedor` até `const maxV=vendsArr[0]?.total||1;`) por:

```js
  // Per vendedor — usa mapa pedido→vendedor preenchido em background pelo _gvBuildSkuSlide
  const {vendsArr,porVendPrev}=calcularRankingPorVendedor(
    pedidos,pedidosPrev,window._gvPedidoVendorMap,window._gvVendedoresCache,canais);
  const maxV=vendsArr[0]?.total||1;
```

(As variáveis `vendsArr`, `porVendPrev` e `maxV` são consumidas logo abaixo, linha 1202 em diante, exatamente como antes — não mudam de forma.)

- [ ] **Step 7: Importar o helper**

No topo do `.vue`, junto dos outros imports de módulos locais (perto da linha 134-140):

```js
import { calcularRankingPorVendedor } from './ranking-por-vendedor.js'
```

- [ ] **Step 8: Rodar o build e a suíte inteira**

```bash
npm test
npm run build
```

Expected: suíte verde, build sem erro.

- [ ] **Step 9: Testar na tela (critério de pronto desta task)**

```bash
npm run dev -- --port 5199 --strictPort
```

Abrir Gestão à Vista a 375px num navegador de verdade (per `PADRAO-DA-CENTRAL.md`), conferir que o ranking por vendedora no telão e o ranking dentro do board renderizam os MESMOS números para as mesmas vendedoras (eram dois cálculos antes — confirmar que continuam batendo depois da extração).

- [ ] **Step 10: Commit**

```bash
git add src/ferramentas/gestao-a-vista/ranking-por-vendedor.js src/ferramentas/gestao-a-vista/ranking-por-vendedor.test.mjs src/ferramentas/gestao-a-vista/tela-de-gestao-a-vista.vue
git commit -m "refactor: extrai calcularRankingPorVendedor, usado pelos dois rankings da Gestão à Vista"
```

---

### Task 10: Integrar valor líquido de troca na Gestão à Vista

**Files:**
- Modify: `src/ferramentas/gestao-a-vista/tela-de-gestao-a-vista.vue:137` (import), `:670-679` (Promise.all + aplicação)

**Interfaces:**
- Consumes: `buscarDevolucoes`, `aplicarValorLiquidoDeTroca` (Task 3).

- [ ] **Step 1: Import**

Linha 138, logo depois do import de `valor-corrigido.js`:

```js
import { buscarDevolucoes, aplicarValorLiquidoDeTroca } from '../../compartilhado/valor-liquido-de-troca.js'
```

- [ ] **Step 2: Somar ao `Promise.all` e aplicar depois de `aplicarValorCorrigido`**

Substituir as linhas 670-679:

```js
    const [ajuste,ajustePrev,ajustesDeValor,ajustesDeVendedor,devolucoes]=await Promise.all([
      aplicarDataDaVenda(sbClient,pedidosBrutos,di,df),
      aplicarDataDaVenda(sbClient,pedidosPrevBrutos,diPrev,dfPrev),
      buscarAjustesDeValor(sbClient),
      buscarAjustesDeVendedor(sbClient),
      buscarDevolucoes(sbClient),
    ]);
    if(myLoad!==_gvLoadId)return;
    // `let`, e não `const`: o recorte por time (mais abaixo) reatribui os dois.
    let pedidos=aplicarValorCorrigido(ajuste.pedidos,ajustesDeValor).pedidos;
    let pedidosPrev=aplicarValorCorrigido(ajustePrev.pedidos,ajustesDeValor).pedidos;
    // E A DEVOLUÇÃO DE MERCADORIA (troca), que não é venda nova. Entra DEPOIS
    // do valor corrigido, subtraindo do total que já vale de verdade — não do
    // bruto do Bling. Ver src/compartilhado/valor-liquido-de-troca.js.
    pedidos=aplicarValorLiquidoDeTroca(pedidos,devolucoes||[]).pedidos;
    pedidosPrev=aplicarValorLiquidoDeTroca(pedidosPrev,devolucoes||[]).pedidos;
```

- [ ] **Step 3: Rodar o build e a suíte inteira**

```bash
npm test
npm run build
```

Expected: verde.

- [ ] **Step 4: Testar na tela com o pedido real**

```bash
npm run dev -- --port 5199 --strictPort
```

Abrir Gestão à Vista, período outubro/2026, a 375px. Conferir que o total exibido para a Kariny não inclui mais os R$1.600,00 do pedido #2708 (o total do mês para ela deve bater R$5.402,50, não R$7.002,50 — conferido manualmente no início desta conversa).

- [ ] **Step 5: Commit**

```bash
git add src/ferramentas/gestao-a-vista/tela-de-gestao-a-vista.vue
git commit -m "feat: Gestão à Vista desconta devolução de mercadoria do total de vendas"
```

---

### Task 11: Integrar valor líquido de troca na Análise de Vendas

**Files:**
- Modify: `src/ferramentas/analise-vendas/tela-de-analise-vendas.vue:94` (import), `:448-456` (Promise.all + aplicação nas 3 janelas)

**Interfaces:**
- Consumes: `buscarDevolucoes`, `aplicarValorLiquidoDeTroca` (Task 3).

- [ ] **Step 1: Import**

Linha 95, logo depois do import de `valor-corrigido.js`:

```js
import { buscarDevolucoes, aplicarValorLiquidoDeTroca } from '../../compartilhado/valor-liquido-de-troca.js'
```

- [ ] **Step 2: Somar ao `Promise.all` e aplicar nas 3 janelas**

Substituir as linhas 448-456:

```js
    const[aj,ajPrev,aj15,ajustesDeValor,devolucoes]=await Promise.all([
      aplicarDataDaVenda(sbClient,pedidosBrutos,di,df),
      aplicarDataDaVenda(sbClient,pedidosPrevBrutos,diPrev,dfPrev),
      aplicarDataDaVenda(sbClient,pedidos15Brutos,di15,df15),
      buscarAjustesDeValor(sbClient),
      buscarDevolucoes(sbClient),
    ]);
    aj.pedidos=aplicarValorCorrigido(aj.pedidos,ajustesDeValor).pedidos;
    ajPrev.pedidos=aplicarValorCorrigido(ajPrev.pedidos,ajustesDeValor).pedidos;
    aj15.pedidos=aplicarValorCorrigido(aj15.pedidos,ajustesDeValor).pedidos;
    // E A DEVOLUÇÃO DE MERCADORIA (troca), que não é venda nova — mesma regra
    // da Gestão à Vista. Ver src/compartilhado/valor-liquido-de-troca.js.
    aj.pedidos=aplicarValorLiquidoDeTroca(aj.pedidos,devolucoes||[]).pedidos;
    ajPrev.pedidos=aplicarValorLiquidoDeTroca(ajPrev.pedidos,devolucoes||[]).pedidos;
    aj15.pedidos=aplicarValorLiquidoDeTroca(aj15.pedidos,devolucoes||[]).pedidos;
```

- [ ] **Step 3: Rodar o build e a suíte inteira**

```bash
npm test
npm run build
```

Expected: verde.

- [ ] **Step 4: Testar na tela**

A 375px, abrir Análise de Vendas, loja do pedido #2708 (loja_id 205834116), outubro/2026. Conferir a linha da Kariny: coluna "Ontem" (se o período selecionado cair em 01/10) ou "Mês" mostrando o valor líquido, não o bruto.

- [ ] **Step 5: Commit**

```bash
git add src/ferramentas/analise-vendas/tela-de-analise-vendas.vue
git commit -m "feat: Análise de Vendas desconta devolução de mercadoria do total de vendas"
```

---

### Task 12: Verificação final de ponta a ponta

**Files:** nenhum (só verificação)

- [ ] **Step 1: Suíte inteira**

```bash
npm test
```

Expected: tudo verde, incluindo `valor-liquido-de-troca.test.mjs` (dois arquivos), `forma-pagamento.test.mjs`, `ranking-por-vendedor.test.mjs`, `caminhos-permitidos.test.mjs`.

- [ ] **Step 2: Build de produção**

```bash
npm run build
```

Expected: sem erro.

- [ ] **Step 3: Conferir o banco**

```bash
set -a && source coletor/.env && set +a
psql "$DATABASE_URL" -c "select count(*) filter (where eh_devolucao) as devolucoes, count(*) as total from bling_pedido_forma_pagamento;"
```

Expected: `devolucoes >= 1` (pelo menos o pedido #2708).

- [ ] **Step 4: Conferir as duas telas a 375px num navegador de verdade**

Gestão à Vista e Análise de Vendas, outubro/2026, loja 205834116: total da Kariny bate R$5.402,50 (01/10: R$3.102,50 = 1.472,50+300+1.330; 02/10: R$2.300,00), não mais R$7.002,50.

- [ ] **Step 5: Confirmar o cron diário vai repetir isso sozinho**

```bash
cat .github/workflows/pedidos-da-vessel.yml | grep -A3 "cron\|schedule"
```

Expected: o cron já chama `trazer-pedidos-do-bling.mjs` sem flags extras — nenhuma mudança de infraestrutura necessária, a Task 8 já cobre as próximas rodadas.
