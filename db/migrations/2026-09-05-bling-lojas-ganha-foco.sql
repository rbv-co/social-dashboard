-- QUAIS CANAIS O ROBO DETALHA.
--
-- Ate 05/09/2026 essa lista estava CRAVADA em `coletor/relatorios-comerciais.mjs`
-- (`CANAIS`, tres itens), e todo pedido de outro canal era DESCARTADO antes de
-- virar dado. Canal novo criado no Bling nunca apareceria: nem as vendas dele,
-- nem ele proprio — porque `bling_lojas` tambem nunca foi atualizada por robo
-- nenhum, foi preenchida a mao uma vez em 21/05/2026.
--
-- ⚠️ POR QUE NAO "DETALHAR TODOS": detalhar pedido custa uma chamada por pedido.
-- Ligar os 14 canais de uma vez multiplicaria as chamadas e bateria no limite do
-- Bling — que nesta casa ja virou lista vazia sem erro antes.
--
-- O PADRAO E `true` DE PROPOSITO: canal que passar a existir DEPOIS de hoje e,
-- quase certamente, loja nova que o dono quer ver. Os 14 que ja existem ficam
-- como estao — so os tres de sempre em foco.
alter table public.bling_lojas
  add column if not exists foco boolean not null default true;

update public.bling_lojas set foco = false;

update public.bling_lojas set foco = true
 where loja_id in (
   205834140,  -- Loja Santa Barbara d'Oeste (Tivoli)
   205657609,  -- Loja Dom Pedro
   205451611   -- Atacado Nuvem Shop
 );
