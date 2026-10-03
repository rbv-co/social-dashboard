# Valor líquido de troca: forma de pagamento por pedido — design

Data: 03/10/2026. Estado: **rascunho para revisão do dono** (desenho aprovado em conversa; esta especificação ainda não).

## Objetivo

O total de vendas por vendedora (Gestão à Vista, Análise de Vendas) soma `pedido.total` do Bling sem olhar
a forma de pagamento. Quando parte do pagamento é "Devolução de mercadorias" — uma troca, não dinheiro novo
entrando — esse valor conta como venda nova e infla o número.

Achado real: pedido #2708 (Kariny, 01/10/2026), total R$ 1.900,00, sendo R$ 1.600,00 em "Devolução de
mercadorias" (a bolsa trocada) e R$ 300,00 pagos de verdade. O relatório de outubro para a Kariny caiu de
R$ 7.002,50 para R$ 5.402,50 ao corrigir manualmente esse único pedido.

## Decisões do dono (registradas em 03/10/2026)

- **Regra de negócio**: conta só o valor pago de verdade. `total` do pedido passa a ser `total - devolução`.
- **Granularidade**: guarda cada forma de pagamento do pedido, linha por linha (não só o agregado).
- **Backfill**: só mês atual (outubro) em diante — não varre todo o histórico de `bling_pedido_nota`.
- **Latência aceita**: pedido com troca feito hoje só corrige no relatório a partir do robô do dia seguinte
  (07h34 UTC). As telas não passam a buscar parcela ao vivo.
- **Upsert por `parcela_id`** (o id que o Bling dá à parcela), não delete-then-insert por pedido.
- **Classificação por `tipoPagamento`** (código fixo do catálogo `formas-pagamentos` do Bling), não por nome
  de texto — medido: `tipoPagamento = 5` é exclusivamente "Devolução de mercadorias" nas 77 formas de
  pagamento cadastradas nesta conta. Nome é editável pela loja; o código não.
- **Dedup incluído**: `_gvUpdateVendRanking` e o bloco de ranking por vendedor dentro de `renderGestaoVista`
  (hoje dois cálculos quase idênticos) passam a usar um único helper, para a correção (e qualquer futura)
  não entrar só num dos dois.

## Fora do escopo (agora)

- Tela de auditoria mostrando forma de pagamento por pedido — a tabela existe, mas nenhuma tela lê linha a
  linha ainda; é dado para a função pura, não para exibição direta.
- Correção ao vivo no mesmo dia (decidido: espera o robô).
- Backfill de meses anteriores a outubro/2026.
- Cache do catálogo `formas-pagamentos` em tabela própria — o robô busca em memória a cada rodada (77 linhas,
  1 chamada) e descarta.

## Arquitetura

### 1. Tabela nova

```sql
create table public.bling_pedido_forma_pagamento (
  parcela_id         bigint primary key,   -- id da parcela no Bling
  pedido_id          bigint not null,
  loja_id            bigint,
  forma_pagamento_id bigint not null,
  valor              numeric(12,2) not null,
  data_vencimento    date,
  eh_devolucao       boolean not null,     -- tipoPagamento=5 no catálogo do Bling, decidido no robô
  atualizado_em      timestamptz not null default now()
);
```

RLS no mesmo padrão de `bling_pedido_nota`: leitura para todo `authenticated`, restritiva por
`pode_ver_canal(loja_id)`, escrita só via `service_role` (o robô).

Índices: `pedido_id` (join com o pedido), `loja_id` (RLS), e um parcial
`create index ... on bling_pedido_forma_pagamento (pedido_id) where eh_devolucao` — é essa fatia pequena
que as telas leem a cada recarga, sem o corte de 500 ids que `bling_pedido_vendedor`/`pvMap` têm hoje.

### 2. Proxy do Bling

`supabase/functions/bling-proxy/index.ts`: adiciona `/^formas-pagamentos$/` a `CAMINHOS_PERMITIDOS`. Mesmo
teste de sempre em `caminhos-permitidos.test.mjs`: liberado pra este, e `financeiro`/`contas/pagar`/
`contas/receber` continuam bloqueados.

### 3. Robô (`coletor/trazer-pedidos-do-bling.mjs`)

Já busca `detalhe = blingProxy(token, 'pedidos/vendas/${p.id}', {})` por pedido (linha 195) — `detalhe.parcelas`
vem de graça, sem chamada nova.

1. Uma vez por rodada: busca `formas-pagamentos` inteiro, monta `Map(forma_pagamento_id → tipoPagamento)`.
   Se essa leitura falhar, o robô **lança e para** — mesma postura de `ajustesDeValor`/`linhasDaJanela`:
   seguir sem o catálogo classificaria toda troca como venda normal de novo.
2. Por pedido, por parcela de `detalhe.parcelas`: resolve `eh_devolucao = tipoPagamento === 5` via o mapa.
   `forma_pagamento_id` ausente do catálogo (raro) → grava com `eh_devolucao=false`, conta e loga (mesmo
   estilo dos contadores de "órfãos" que o robô já tem).
3. `insert ... on conflict (parcela_id) do update set valor, eh_devolucao, data_vencimento, atualizado_em`.
   Limitação aceita: se o Bling recriar a parcela com id novo ao editar o pedido, a linha antiga fica órfã —
   caso raro, não tratado agora.

Backfill: rodar o robô (janela padrão de 30 dias, cron diário já existente) cobre outubro inteiro sozinho —
nenhum script novo.

### 4. Função pura + teste

`supabase/functions/_shared/valor-liquido-de-troca.js` (espelhada em `src/compartilhado/`, mesmo tratamento
de `valor-corrigido.js`):

```js
export function ehDevolucaoDeMercadoria(tipoPagamento) {
  return tipoPagamento === 5;
}

export function aplicarValorLiquidoDeTroca(pedidos, devolucoesPorPedido) {
  return {
    pedidos: pedidos.map((p) => {
      const devolucao = devolucoesPorPedido.get(String(p.id)) || 0;
      if (!devolucao) return p;
      return { ...p, totalComTroca: p.total, valorDevolucao: devolucao, total: p.total - devolucao };
    }),
  };
}
```

Mais `buscarDevolucoes(url, chave)` ao lado, mesmo padrão de `ajustesDeValor`: lê
`bling_pedido_forma_pagamento` inteira filtrando `eh_devolucao=eq.true` (sem `.in(ids)`), soma por `pedido_id`,
devolve `Map(pedido_id -> valor)`.

Teste (`valor-liquido-de-troca.test.mjs`):
- Caso real: pedido #2708, total 1900, devolução 1600 → `total` líquido 300, `totalComTroca` 1900 preservado.
- Pedido sem devolução: objeto sai sem mudança.
- Duas parcelas de devolução no mesmo pedido: soma as duas.

### 5. Telas

Em `tela-de-gestao-a-vista.vue` (~linhas 670-679) e `tela-de-analise-vendas.vue` (~linhas 448-462): soma
`buscarDevolucoes` ao `Promise.all` que já busca `ajustesDeValor`; aplica `aplicarValorLiquidoDeTroca` logo
depois de `aplicarValorCorrigido` e antes de qualquer soma por vendedora/loja, para os períodos atual,
anterior e (na Análise de Vendas) os 15 dias. Dali em diante `p.total` já é o valor líquido — nenhuma outra
soma muda (`_gvUpdateVendRanking`, `renderGestaoVista`, `renderSALojaTable` continuam somando `p.total` como
já fazem).

Dedup: extrai `calcularRankingPorVendedor(pedidos, pm, vm)` usado por `_gvUpdateVendRanking` (linha 324) e
pelo bloco equivalente dentro de `renderGestaoVista` (~linhas 1180-1200), hoje duplicado.

Erros: se `buscarDevolucoes` falhar, mesmo comportamento que já existe hoje quando `ajustesDeValor` falha
(postura não alterada por este trabalho).

## Verificação manual pós-implementação

1. Rodar o robô, conferir `select * from bling_pedido_forma_pagamento where pedido_id = 27018529287` — duas
   linhas, uma com `eh_devolucao=true` e `valor=1600`.
2. Abrir Gestão à Vista e Análise de Vendas filtradas em outubro: ranking da Kariny mostra R$ 300,00 para o
   pedido #2708, total do mês R$ 5.402,50.
3. `caminhos-permitidos.test.mjs` e `valor-liquido-de-troca.test.mjs` verdes.
