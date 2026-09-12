-- CORREÇÃO DA CORREÇÃO: profile_visits/profile_views não existe pra estes
-- anúncios.
--
-- A migration 2026-09-12-meta-ads-hora-visitas-nao-cliques.sql presumiu que o
-- dado certo era profile_visits/profile_views. Conferido ao vivo na Graph API
-- (12/09/2026, 30 dias de histórico, todo anúncio [+ SEGUIDORES] ativo ou
-- pausado): NENHUM gera essa ação — o destino configurado é link, não
-- "Instagram Profile" (é uma opção separada em Tráfego, não automática).
-- Mudar isso é decisão de mídia no Ads Manager, não de código.
--
-- O robô (coletar-dados-hora) tenta profile_visits/profile_views primeiro e
-- cai pra link_click — hoje sempre cai, mas se o destino do anúncio mudar no
-- futuro, o dado certo entra sem precisar mexer no código de novo.
comment on column public.campaign_insights_hora.cliques_acumulados is
  'profile_visits/profile_views cru do dia até a hora da rodada, com fallback '
  'para link_click quando o anúncio não tiver destino "Instagram Profile" '
  '(hoje é sempre o caso — ver visitasNoPerfil() em '
  'supabase/functions/_shared/delta-de-hora.js). Auditoria.';
comment on column public.campaign_insights_hora.cliques_hora is
  'Delta já calculado pelo robô (mesma métrica de cliques_acumulados) — a '
  'tela lê esta coluna, nunca recalcula.';
