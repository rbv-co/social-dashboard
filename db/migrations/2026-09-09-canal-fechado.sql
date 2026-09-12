-- QUANDO A LOJA FECHOU. Canal com data aqui sai dos menus das telas de venda
-- daqui pra frente, e CONTINUA aparecendo quando o período escolhido alcança os
-- dias em que ela operava.
--
-- Pedido do dono, 09/09/2026: "oculte os canais de vendas, dom pedro pq
-- fecharam, deixe somente o histórico pra trás".
--
-- ⚠️ ESTA MIGRATION NÃO FECHA LOJA NENHUMA — só cria o campo. A data do Dom
-- Pedro (31/08/2026, combinada com ele) entra DEPOIS do deploy, pela Config de
-- Admin. Plantar o dado antes deixaria uma janela com o banco à frente do
-- código servido, que é o defeito de [[feedback_codigo_no_ar_antes_do_dado]].
--
-- ⚠️ NÃO SE APAGA NADA: venda, meta, equipe e patrimônio do canal ficam como
-- estão. Esconder do menu e apagar o histórico são coisas diferentes, e é o
-- histórico que o dono pediu para manter.
--
-- A escrita já está coberta: `bling_lojas` tem UPDATE de TABELA para
-- `authenticated` (não por coluna), sob a política `bling_lojas_grupo_superadmin`
-- — coluna nova entra debaixo da mesma trava. Conferido em 09/09/2026 antes de
-- escrever isto, e conferido de novo depois de aplicar.
alter table public.bling_lojas
  add column if not exists fechado_em date;

comment on column public.bling_lojas.fechado_em is
  'Dia em que a loja fechou. Nulo = aberta. O canal some dos menus de venda '
  'quando o período começa depois desta data, e reaparece quando o período '
  'alcança dias anteriores. Editável em Config de Admin › Canais de venda.';
