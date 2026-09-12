-- A data em que a venda REALMENTE aconteceu: a da nota, não a do pedido.
--
-- POR QUE ESTA TABELA EXISTE
-- A dashboard de vendas lança o dinheiro na data do PEDIDO (`data`, do Bling).
-- Só que o pedido é gerado num dia e faturado em outro: medido em 11/08/2026,
-- os pedidos nº2429 (R$ 3.644,30) e nº2427 (R$ 2.550,74) foram feitos na terça
-- 04/08 e a nota saiu na quarta 05/08. Nos últimos 30 dias, 18 pedidos somando
-- R$ 19.375,69 caíram um dia antes do dia certo.
--
-- O padrão: a loja emite NFC-e no mesmo dia; o Atacado emite NF-e no dia
-- seguinte. Por isso o erro se concentra no Atacado.
--
-- POR QUE NÃO DEU PRA USAR O QUE JÁ TINHA
-- `dataSaida` do pedido parecia a resposta óbvia e NÃO é: nos 493 pedidos
-- atendidos dos últimos 90 dias ela veio idêntica a `data` em 100% dos casos.
-- O Bling a preenche na criação e nunca a atualiza no faturamento. A única
-- data confiável é a `dataEmissao` da nota — que exigiu liberar o escopo de
-- NF-e/NFC-e no token (feito em 11/08/2026).
--
-- O QUE ESTA MIGRATION NÃO FAZ
-- Não muda número nenhum na tela. Ela só cria o lugar onde a data certa passa
-- a ser guardada. Quem preenche é o robô coletor/notas-dos-pedidos.mjs; quem
-- passa a ler são as telas, numa etapa seguinte e separada.

create table if not exists public.bling_pedido_nota (
  pedido_id      bigint      primary key,          -- id do pedido no Bling
  loja_id        bigint,                           -- canal (loja.id do Bling)
  data_pedido    date        not null,             -- o dia que a dashboard usa HOJE
  total          numeric(12,2),                    -- só p/ conferência e relatório de impacto

  nota_id        bigint,                           -- nulo = pedido concluído SEM nota
  modelo         text        check (modelo in ('nfe', 'nfce')),
  nota_numero    text,
  nota_serie     int,
  nota_situacao  smallint,                         -- situação da nota no Bling
  data_da_nota   date,                             -- dataEmissao — o dia que vale
  emitida_em     timestamptz,                      -- dataEmissao com hora, p/ auditoria

  -- A DATA QUE VALE, decidida pelo banco e não por cada tela: se existe nota,
  -- é o dia dela; sem nota, continua sendo o dia do pedido. Coluna gerada de
  -- propósito — se ficasse a cargo de quem lê, cinco telas dariam cinco
  -- respostas, que é exatamente a doença que este projeto já teve.
  data_da_venda  date generated always as (coalesce(data_da_nota, data_pedido)) stored,
  origem_da_data text generated always as (case when data_da_nota is null then 'pedido' else 'nota' end) stored,

  conferido_em   timestamptz not null default now()
);

comment on table public.bling_pedido_nota is
  'Elo pedido → nota fiscal, para lançar a venda no dia em que a nota saiu. Preenchida pelo robô coletor/notas-dos-pedidos.mjs.';
comment on column public.bling_pedido_nota.data_da_venda is
  'O dia em que a venda conta: o da nota quando existe, senão o do pedido.';
comment on column public.bling_pedido_nota.origem_da_data is
  'De onde veio a data_da_venda: "nota" ou "pedido" (pedido = concluído sem nota emitida).';

-- Índices: a leitura é sempre por FAIXA DE DIA (o telão pede "hoje", "últimos
-- 7 dias", "este mês") e por canal.
create index if not exists idx_bpn_data_da_venda on public.bling_pedido_nota (data_da_venda desc);
create index if not exists idx_bpn_data_pedido   on public.bling_pedido_nota (data_pedido desc);
-- loja_id é lido pela política de escopo por time — coluna de RLS sem índice
-- é o jeito clássico de a tela ficar lenta só para quem tem time.
create index if not exists idx_bpn_loja          on public.bling_pedido_nota (loja_id);

alter table public.bling_pedido_nota enable row level security;

-- Leitura para quem está logado; escrita só pelo robô (service_role, que não
-- passa por RLS). Mesmo padrão de gc_vendas_item.
drop policy if exists bpn_leitura on public.bling_pedido_nota;
create policy bpn_leitura on public.bling_pedido_nota
  for select to authenticated using (true);

-- E o escopo por time continua valendo: quem só pode ver o canal dela não
-- passa a ver os outros por esta porta nova. RESTRICTIVE, como em
-- gc_vendas_item — política permissiva nova deixaria tudo passar e PARECERIA
-- instalada.
drop policy if exists bpn_so_do_meu_canal on public.bling_pedido_nota;
create policy bpn_so_do_meu_canal on public.bling_pedido_nota
  as restrictive for select to authenticated
  using (public.pode_ver_canal(loja_id));
