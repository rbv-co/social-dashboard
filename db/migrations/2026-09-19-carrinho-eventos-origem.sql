-- db/migrations/2026-09-19-carrinho-eventos-origem.sql
--
-- Atribuição multi-canal (não só Meta): UTM (utm_source/medium/campaign,
-- de qualquer campanha marcada — Google, e-mail, influencer) e gclid
-- (clique de anúncio do Google Ads), mesmo truque do fbclid — vêm da
-- própria URL de entrada, não são cookie, nenhum navegador filtra isso.
-- referrer é de onde a pessoa veio quando não tem UTM/fbclid/gclid
-- nenhum (Instagram orgânico, Google orgânico, etc.) — só do documento na
-- entrada, nunca reescrito por navegação interna.
alter table public.carrinho_eventos
  add column if not exists utm_source text,
  add column if not exists utm_medium text,
  add column if not exists utm_campaign text,
  add column if not exists gclid text,
  add column if not exists referrer text;
