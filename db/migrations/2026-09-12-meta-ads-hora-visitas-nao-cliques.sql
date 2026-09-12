-- CORREÇÃO: a coluna "cliques_*" nunca devia ter sido link_click.
--
-- Pedido do dono (12/09/2026): "visitantes na página é profile_visits ou
-- profile_views" — as campanhas [+ SEGUIDORES] não têm link de destino, então
-- link_click não existe pra elas (o coletor gravava zero, ou clique de outro
-- lugar do anúncio, nunca "visitante"). O robô (coletar-dados-hora) passou a
-- ler profile_visits/profile_views. Coluna mantém o nome "cliques_*" (mexer
-- no nome exigiria migrar todo o histórico e não foi pedido) — o comentário
-- é atualizado para não mentir pra quem olhar o schema depois.
comment on column public.campaign_insights_hora.cliques_acumulados is
  'Visita ao perfil (profile_visits/profile_views) cru do dia até a hora da '
  'rodada (auditoria). NUNCA link_click — corrigido em 12/09/2026, ver '
  'visitasNoPerfil() em supabase/functions/_shared/delta-de-hora.js.';
comment on column public.campaign_insights_hora.cliques_hora is
  'Delta de visita ao perfil já calculado pelo robô — a tela lê esta coluna, '
  'nunca recalcula. NUNCA link_click — corrigido em 12/09/2026.';
