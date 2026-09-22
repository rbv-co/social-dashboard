-- A CONFERÊNCIA AO VIVO DOS PEDIDOS: a marca de quando cada um foi conferido.
--
-- O DEFEITO (medido em 21/09/2026, e achado por uma pergunta do dono sobre a
-- Gestão à Vista): o robô que traz os pedidos pergunta ao Bling SÓ pelos que
-- estão com situação 9 (atendido). Pedido que muda de estado DEPOIS de
-- importado nunca é revisitado — entra como venda e fica venda para sempre.
--
-- Medido na hora: dos 223 pedidos dos últimos 60 dias, **2 já estavam
-- cancelados no Bling** e continuavam contados como venda aqui — R$ 3.850 a
-- mais. E não é caso raro: a loja refaz o pedido quando erra, e no mesmo dia
-- 21/09 a venda da Luiza Maria Carvalho tinha TRÊS pedidos (2680 e 2681
-- cancelados, 2682 valendo). Foi justamente isso que fez a Gestão à Vista
-- mostrar R$ 6.900 num momento em que dois estavam como atendidos — ela lê o
-- Bling ao vivo e se corrige sozinha; a nossa base é que guardava o fantasma.
--
-- ⚠️ POR QUE UMA COLUNA DE "CONFERIDO", E NÃO SÓ CORRIGIR A SITUAÇÃO.
-- Sem ela não dá para separar três coisas que parecem iguais:
--   • pedido conferido agora, e É venda            (conferido recente, situação 9)
--   • pedido conferido agora, e NÃO é mais venda   (conferido recente, situação ≠ 9)
--   • pedido que ninguém confere há semanas        (conferido antigo ou nulo)
-- O terceiro é o perigoso: é o fantasma de hoje, e ele não se denuncia sozinho.
-- Com a coluna, `select ... where conferido_no_bling_em < now() - interval '1 day'`
-- responde "o que eu ainda não sei" — que é a pergunta que faltava existir.
--
-- ⚠️ `situacao_id` PODE FICAR NULO, e isso tem significado próprio: o pedido
-- sumiu do Bling (apagado, não cancelado). Cancelado tem número (12); apagado
-- não tem estado nenhum. Quem contar venda filtra `situacao_id = 9` e os dois
-- ficam de fora, cada um pelo seu motivo.

alter table public.vessel_pedidos
  add column if not exists conferido_no_bling_em timestamptz;

comment on column public.vessel_pedidos.conferido_no_bling_em is
  'Quando o robo conferiu este pedido contra o Bling pela ultima vez. Nulo = '
  'nunca foi conferido desde que a conferencia passou a existir (21/09/2026). '
  'Serve para achar o que esta velho, nao so o que esta errado.';

comment on column public.vessel_pedidos.situacao_id is
  'A situacao do pedido NO BLING, conferida a cada rodada. 9 = atendido, e e a '
  'UNICA que conta como venda. 12 = cancelado. NULO = o pedido sumiu do Bling.';

-- Quem conta venda passa a filtrar por situação; o índice deixa isso barato.
create index if not exists vessel_pedidos_situacao_idx
  on public.vessel_pedidos (situacao_id);

-- E o que está velho é o que se procura primeiro.
create index if not exists vessel_pedidos_conferido_idx
  on public.vessel_pedidos (conferido_no_bling_em nulls first);
