-- O DESCONTO DO ITEM É PORCENTAGEM, NÃO REAIS — e a coluna dizia o contrário
--
-- ⚠️ COMO ISSO APARECEU: comparando a tabela nova, pedido a pedido, com a que o
-- comercial já usa. Um item de R$ 97,80 saiu por R$ 0,80 na minha conta, porque
-- eu subtraía `desconto` como se fosse dinheiro.
--
-- MEDIDO, não suposto: em 1.125 itens, o maior `desconto` é 84,36 — e em 21
-- deles ele é MAIOR que o valor do próprio item. Em reais, isso seria pagar
-- para a cliente levar. É porcentagem.
--
-- O conserto tem duas partes, e a segunda é a que importa:
--
--   1. a coluna passa a se chamar `desconto_percentual`. Nome que mente é pior
--      que coluna ausente: quem chegar depois vai subtrair de novo, e o erro
--      volta com outra cara.
--   2. entra `total_do_item`, JÁ CALCULADO. Assim ninguém precisa saber desta
--      pegadinha para somar receita direito — e o próximo a usar a tabela não
--      repete o meu erro.

alter table public.vessel_pedido_itens
  rename column desconto to desconto_percentual;

alter table public.vessel_pedido_itens
  add column if not exists total_do_item numeric(12,2);

comment on column public.vessel_pedido_itens.desconto_percentual is
  '⚠️ PORCENTAGEM, nao reais. O Bling manda assim. Medido em 17/09/2026: em 21 '
  'de 1.125 itens o valor e MAIOR que o do proprio item — so faz sentido como %.';
comment on column public.vessel_pedido_itens.total_do_item is
  'quantidade x valor_unitario x (1 - desconto_percentual/100). Existe JA '
  'CALCULADO para ninguem precisar saber da pegadinha acima para somar receita.';

-- Acerta o que já está gravado.
update public.vessel_pedido_itens
   set total_do_item = round(
         coalesce(quantidade, 0) * coalesce(valor_unitario, 0)
         * (1 - coalesce(desconto_percentual, 0) / 100.0), 2)
 where total_do_item is null;
