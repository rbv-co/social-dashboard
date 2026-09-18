-- db/migrations/2026-09-18-carrinho-eventos-fbp-fbc.sql
--
-- Cruzamento com a atribuição do Meta (Facebook/Instagram Ads): _fbp
-- (id de navegador do Pixel do Meta, existe pra qualquer visitante com o
-- Pixel do Meta rodando na loja) e _fbc (id do clique do anúncio, só existe
-- em quem chegou por um link com fbclid). Quem não veio do Meta segue
-- identificado só pelo cart_token, que já é gravado hoje — ver LEIA-ME.txt
-- de src/ferramentas/funil-carrinho.
alter table public.carrinho_eventos
  add column if not exists fbp text,
  add column if not exists fbc text;
