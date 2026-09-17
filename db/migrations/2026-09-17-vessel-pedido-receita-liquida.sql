-- A RECEITA LÍQUIDA DO PEDIDO — o dinheiro que entrou de verdade
--
-- Decisão do dono em 17/09/2026: o painel novo conta pelo que ENTROU NO CAIXA,
-- não pelo preço de tabela.
--
-- ⚠️ E O "TOTAL" DO BLING NÃO É ESSE NÚMERO. Medido em 456 pedidos de 90 dias:
--
--   itens, preço cheio ................... R$ 165.044,04
--   menos o desconto do pedido ........... R$   3.359,91
--   = o que o Bling chama de "total" ..... R$ 161.545,19   ← NÃO desconta o
--                                                             desconto do ITEM
--   itens já com o desconto do item ...... R$ 155.015,10
--   menos o desconto do pedido ........... R$   3.359,91
--   = LÍQUIDO DE VERDADE ................. R$ 151.655,19
--
-- Quase dez mil reais de diferença em noventa dias. Quem somasse `total_do_bling`
-- achando que era o líquido erraria 6% para cima, e erraria calado.
--
-- Por isso o número entra CALCULADO numa coluna própria, com nome que diz o que
-- ele é. Ninguém devia precisar conhecer esta pegadinha para somar receita.

alter table public.vessel_pedidos
  add column if not exists receita_liquida numeric(12,2);

comment on column public.vessel_pedidos.receita_liquida is
  'O dinheiro que entrou: soma dos itens JA com o desconto do item, menos o '
  'desconto do pedido. ⚠️ NAO e o `total_do_bling` — aquele nao desconta o '
  'desconto do ITEM e sai ~6% maior. Quando ha ajuste manual (nota autorizada '
  'que congelou o pedido errado), o ajuste VENCE: ele e o valor real.';

-- Acerta o que já está gravado.
update public.vessel_pedidos p
   set receita_liquida = round(greatest(
         coalesce(p.total_corrigido,
                  (select coalesce(sum(i.total_do_item), 0) from public.vessel_pedido_itens i
                    where i.pedido_id = p.id) - coalesce(p.desconto, 0)),
         0), 2)
 where receita_liquida is null;

create index if not exists vessel_pedidos_receita_idx
  on public.vessel_pedidos (data_da_venda, receita_liquida);
