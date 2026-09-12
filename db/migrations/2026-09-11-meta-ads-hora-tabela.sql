-- CAMPANHA POR HORA: gasto e conversas iniciadas, de hora em hora, com delta
-- já calculado (não recorte nativo da Meta — ver
-- docs/superpowers/specs/2026-09-11-meta-ads-relatorio-por-hora-design.md).
--
-- Nome espelha `campaign_insights` de propósito: mesma entidade (campanha x
-- dia), com uma dimensão a mais (hora) e as colunas de conversa que
-- `campaign_insights` não tem.
create table public.campaign_insights_hora (
  campaign_id          text        not null,
  -- Sem FK para accounts/campaigns de propósito — mesmo desenho solto que
  -- `campaign_insights` já usa (spec §3). Ambas são sincronizadas por
  -- convenção, não por integridade referencial.
  account_id           uuid        not null,
  dia                  date        not null,
  hora                 smallint    not null check (hora between 0 and 23),
  -- Cru: o que a Meta respondeu para "o dia até agora", no momento da rodada.
  -- Fica gravado para auditoria — se o delta parecer errado, dá pra conferir
  -- contra a fonte sem precisar disparar a Meta de novo.
  gasto_acumulado      numeric(12,2) not null default 0,
  conversas_acumuladas integer     not null default 0,
  -- O que a tela lê: a diferença já calculada pelo robô contra a última
  -- leitura gravada naquele dia (não necessariamente hora-1 — uma rodada
  -- perdida não pode fazer a próxima parecer negativa ou duplicada).
  gasto_hora           numeric(12,2) not null default 0,
  conversas_hora       integer     not null default 0,
  coletado_em          timestamptz not null default now(),
  unique (campaign_id, account_id, dia, hora)
);

comment on table public.campaign_insights_hora is
  'Gasto e conversas iniciadas por campanha, de hora em hora, com delta já '
  'calculado. Alimentada pela Edge Function coletar-dados-hora.';

alter table public.campaign_insights_hora enable row level security;

-- Mesma trava das outras 19 tabelas com account_id
-- (db/migrations/2026-07-31-allowed-accounts-no-banco.sql). Entra aqui em vez
-- de alterar aquela migration, que já rodou.
create policy so_contas_permitidas on public.campaign_insights_hora
  as restrictive for select to authenticated
  using (public.pode_ver_conta(account_id::text));
