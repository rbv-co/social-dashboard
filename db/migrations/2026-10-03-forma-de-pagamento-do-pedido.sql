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
