-- CLIQUES NO LINK em campaign_insights_hora.
--
-- Pedido do dono (12/09/2026): métrica própria pras campanhas [+ SEGUIDORES],
-- diferente de conversas/custo-por-lead — a Meta não atribui "novo seguidor"
-- a uma campanha (conferido na Graph API real, nenhuma campanha testada
-- tinha ação de follow). O clique no link é o número real disponível por
-- campanha: quem foi levado até a página. Vem do MESMO array `actions` que
-- já buscamos pra conversas — nenhuma chamada nova à Meta.
alter table public.campaign_insights_hora
  add column if not exists cliques_acumulados integer not null default 0,
  add column if not exists cliques_hora        integer not null default 0;

comment on column public.campaign_insights_hora.cliques_acumulados is
  'link_click cru do dia até a hora da rodada (auditoria).';
comment on column public.campaign_insights_hora.cliques_hora is
  'Delta de link_click já calculado pelo robô — a tela lê esta coluna, nunca recalcula.';
