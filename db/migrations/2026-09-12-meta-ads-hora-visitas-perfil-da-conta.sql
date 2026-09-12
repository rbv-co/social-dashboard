-- VISITAS AO PERFIL da CONTA, por hora — pedido do dono (12/09/2026), "vai
-- atras desse dado".
--
-- Confirmado ao vivo na Graph API que NÃO dá por campanha (nenhum anúncio
-- [+ SEGUIDORES] tem destino "Instagram Profile" — ver
-- 2026-09-12-meta-ads-hora-visitas-fallback-clique.sql). O que existe é
-- `profile_views` no Instagram Graph Insights, mas só da CONTA inteira
-- (orgânico + todo anúncio junto, sem separar por campanha) — mesma
-- limitação que já vale pra seguidores.
--
-- E só vem como ACUMULADO DO DIA (metric_type=total_value, sem period=hour —
-- testado, a Meta recusa). Por isso o desenho é igual campaign_insights_hora:
-- o robô pergunta "quanto teve hoje até agora" a cada rodada e GRAVA o
-- acumulado; o delta contra a hora anterior já vem calculado (visitas_hora),
-- a tela nunca recalcula. Reseta por dia (não atravessa a virada como
-- seguidores, que é estoque — visita é atividade, como gasto e conversa).
create table public.perfil_visitas_hora (
  account_id         uuid        not null,
  dia                date        not null,
  hora               smallint    not null check (hora between 0 and 23),
  visitas_acumuladas integer     not null default 0,
  visitas_hora       integer     not null default 0,
  coletado_em        timestamptz not null default now(),
  unique (account_id, dia, hora)
);

comment on table public.perfil_visitas_hora is
  'Visitas ao perfil do Instagram (profile_views), da CONTA inteira, por '
  'hora, com delta já calculado. Alimentada pela Edge Function '
  'coletar-dados-hora.';

alter table public.perfil_visitas_hora enable row level security;

create policy so_contas_permitidas on public.perfil_visitas_hora
  as restrictive for select to authenticated
  using (public.pode_ver_conta(account_id::text));
