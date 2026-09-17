-- O PEDIDO GUARDA A DATA DA VENDA QUE A CASA JÁ CALCULOU
--
-- ⚠️ MESMA VERDADE EM DOIS CAMPOS É COMO DOIS PAINÉIS DISCORDAM EM PÚBLICO.
-- `bling_pedido_nota` já traz `data_da_venda` e `origem_da_data`, escritas pelo
-- robô `notas-dos-pedidos.mjs` — é o número que a Gestão à Vista, a Análise de
-- Vendas e os relatórios usam. Recalcular a data aqui daria um segundo número,
-- parecido e não igual, e um dia alguém perguntaria por que o painel da Vessel
-- diz 12 e o comercial diz 14.
--
-- Então o robô dos pedidos COPIA o número já impresso, em vez de derivar o dele.

alter table public.vessel_pedidos
  add column if not exists data_da_venda date,
  add column if not exists origem_da_data text;

comment on column public.vessel_pedidos.data_da_venda is
  'A data em que a venda CONTA, copiada de bling_pedido_nota.data_da_venda — que '
  'e o numero que os paineis comerciais ja usam. Nunca recalcular aqui.';
comment on column public.vessel_pedidos.origem_da_data is
  'De onde aquela data saiu (pedido ou nota), tambem copiado. Serve para saber '
  'por que uma venda caiu no dia em que caiu.';

-- A consulta do retorno ao Meta e a do painel: "o que foi vendido no dia que
-- conta", e nao "no dia em que o pedido foi criado".
create index if not exists vessel_pedidos_data_da_venda_idx
  on public.vessel_pedidos (data_da_venda);
