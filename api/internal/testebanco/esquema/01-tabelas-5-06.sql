-- FATIA 5.6 do esquema de produção para os testes (D0 reconstruído: Rulings 5.1-1 e 5.6-1). Carrega
-- depois de 01-tabelas-5-01…5-05 (ordem de nome); pode_ver_conta vem em 03-funcoes-5-06.sql, depois de
-- 02-gatilhos.sql (precisa de conta_ativa). Nenhuma destas tabelas tem gatilho em produção
-- (levantamento/03-triggers.csv: zero linhas), por isso o gerador não muda. Tabelas anteriores às
-- migrations: colunas = as que o worker grava (api/internal/meta/*_test.go, conferidas em produção por
-- cmd/api/conferir.go) + as que as telas leem; o que não tem fonte leva "presumido" e é conferido pelo
-- `api worker conferir`. ads_snapshots fica FORA (Ruling 5.6-9: ninguém grava, só um contador a lê).

-- accounts: id/name/instagram_id/ad_account_id/access_token = cmd/api/conferir.go:24; username,
-- profile_picture_url, picture_url, accent_color = os selects das telas (tela-de-admin.vue:3968,
-- tela-de-analise-campanhas.vue:213); publicacao_automatica = 2026-07-30-conteudo-04-hora-h.sql:21-22;
-- conteudo_usa_portal = 2026-08-01-conteudo-12-concorrentes-por-marca.sql:33-34; persona =
-- 2026-08-12-persona-da-marca.sql:23-24. Em produção o SELECT de `authenticated` é concedido COLUNA A
-- COLUNA (2026-08-13-persona-grant-de-leitura.sql:9-15): access_token e publicacao_automatica não são
-- legíveis pelo navegador — as rotas usam lista fechada (Ruling 5.6-8). Tipos: presumidos (texto).
create table public.accounts (
  id                    uuid primary key default gen_random_uuid(),
  name                  text,
  username              text,
  instagram_id          text,
  ad_account_id         text,
  access_token          text,
  profile_picture_url   text,
  picture_url           text,
  accent_color          text,
  publicacao_automatica boolean not null default false,
  conteudo_usa_portal   boolean not null default false,
  persona               text
);

-- coleta.go:177-178 (on conflict (account_id, captured_at)); gained/lost: tela-de-redes-sociais.vue:2106
create table public.daily_snapshots (
  account_id      uuid not null,
  captured_at     date not null,
  followers_count int,
  gained          int,
  lost            int,
  unique (account_id, captured_at)
);

-- 2026-07-16-followers-leituras.sql:13-18 + origem (2026-09-17-followers-leituras-origem.sql)
create table public.followers_leituras (
  id              bigserial primary key,
  account_id      uuid not null references public.accounts(id) on delete cascade,
  followers_count integer not null,
  lido_em         timestamptz not null default now(),
  origem          text
);

-- coleta.go:566-584 (upsertEng); created_at: lido pelo Admin (tela-de-admin.vue:1777), presumido
create table public.engagement_snapshots (
  account_id         uuid not null,
  captured_at        date not null,
  period_days        int not null,
  likes int, comments int, saves int, shares int, reach int, views int, total_interactions int,
  accounts_engaged   int,
  profile_views      int,
  created_at         timestamptz not null default now(),
  unique (account_id, captured_at, period_days)
);

-- coleta.go:199-209
create table public.content_snapshots (
  account_id  uuid not null,
  captured_at date not null,
  period_days int not null,
  posts_count int, reels_count int, stories_count int, story_shares int, story_replies int,
  story_reach int, story_interactions int, story_navigation int, story_profile_visits int,
  story_follows int, story_nav_forward int, story_nav_back int, story_nav_exit int, story_nav_next int,
  unique (account_id, captured_at, period_days)
);

-- coleta_anuncios.go:24-26; account_id ANULÁVEL como no teste do worker (hora_test.go:19): a linha sem
-- conta é visível a todos (pode_ver_conta(null) = true), e o mundo da Task 2 tem uma
create table public.campaigns (
  campaign_id text primary key,
  account_id  uuid,
  name        text,
  objective   text,
  status      text,
  synced_at   date
);

-- supabase/migrations/20260817_baldes_de_campanha_conjuntos_e_contagens.sql
create table public.campaign_adsets (
  adset_id          text primary key,
  campaign_id       text not null,
  account_id        uuid not null references public.accounts(id) on delete cascade,
  destination_type  text,
  optimization_goal text,
  synced_at         date not null default current_date
);

-- 2026-09-18-meta-ads-catalogo-anuncios.sql
create table public.ads (
  ad_id        text primary key,
  campaign_id  text not null,
  account_id   uuid not null,
  name         text not null default '',
  status       text not null default '',
  destino_link text,
  synced_at    date not null default current_date
);

-- coleta_anuncios.go:144-148 + 2026-07-02-campaign-insights-actions.sql + 20260817_baldes…sql (conversas…)
create table public.campaign_insights (
  campaign_id     text not null,
  account_id      uuid not null,
  captured_at     date not null,
  period_days     int not null,
  spend           numeric,
  impressions bigint, clicks bigint, reach bigint,
  post_engagement int, likes int, comments int, shares int, saves int,
  conversas int, cadastros int, compras int, visitas int,
  unique (campaign_id, account_id, captured_at, period_days)
);

-- presumido: o upsert do coletor Python (projetos/central-inteligencia/redes-sociais/coletor/coletar.py:337-345)
create table public.account_insights (
  account_id  uuid not null,
  captured_at date not null,
  period_days int not null,
  spend       numeric,
  impressions bigint,
  clicks      bigint,
  reach       bigint,
  frequency   numeric,
  unique (account_id, captured_at, period_days)
);

-- 2026-09-11-meta-ads-hora-tabela.sql + 2026-09-12-meta-ads-hora-cliques.sql
create table public.campaign_insights_hora (
  campaign_id          text not null,
  account_id           uuid not null,
  dia                  date not null,
  hora                 smallint not null check (hora between 0 and 23),
  gasto_acumulado      numeric(12,2) not null default 0,
  conversas_acumuladas integer not null default 0,
  gasto_hora           numeric(12,2) not null default 0,
  conversas_hora       integer not null default 0,
  coletado_em          timestamptz not null default now(),
  cliques_acumulados   integer not null default 0,
  cliques_hora         integer not null default 0,
  unique (campaign_id, account_id, dia, hora)
);

-- 2026-09-12-meta-ads-hora-visitas-perfil-da-conta.sql
create table public.perfil_visitas_hora (
  account_id         uuid not null,
  dia                date not null,
  hora               smallint not null check (hora between 0 and 23),
  visitas_acumuladas integer not null default 0,
  visitas_hora       integer not null default 0,
  coletado_em        timestamptz not null default now(),
  unique (account_id, dia, hora)
);

-- 2026-09-18-meta-ads-ad-insights-hora.sql
create table public.ad_insights_hora (
  ad_id              text not null,
  campaign_id        text not null,
  account_id         uuid not null,
  dia                date not null,
  hora               smallint not null check (hora between 0 and 23),
  gasto_acumulado    numeric not null default 0,
  gasto_hora         numeric not null default 0,
  cliques_acumulados integer not null default 0,
  cliques_hora       integer not null default 0,
  coletado_em        timestamptz not null default now(),
  unique (ad_id, account_id, dia, hora)
);

-- 2026-09-17-visitas-perfil-dia.sql (sem rota: Ruling 5.6-9; está aqui para a foto e para o 5.11)
create table public.visitas_perfil_dia (
  account_id   uuid not null references public.accounts(id) on delete cascade,
  dia          date not null,
  visitas      integer not null,
  calculado_em timestamptz not null default now(),
  primary key (account_id, dia)
);

-- presumido: (account_id, periodo, indicador, valor) com onConflict nas três primeiras
-- (tela-de-redes-sociais.vue:1357-1359; spec 2026-08-17-baldes…-design.md:86-88). account_id é TEXTO:
-- a policy sai `pode_ver_conta(account_id)` sem ::text (o Postgres descarta o cast de texto para texto).
create table public.social_metas (
  account_id text not null,
  periodo    text not null,
  indicador  text not null,
  valor      numeric,
  unique (account_id, periodo, indicador)
);

-- presumido: POST com `resolution=merge-duplicates` e sem on_conflict = conflito pela PK
-- (tela-de-redes-sociais.vue:3830-3834); account_id uuid (a policy faz ::text); selected_ids text[]
-- (null = todas, [] = nenhuma; coletar.py:244 lê a lista)
create table public.campaign_filters (
  account_id   uuid primary key,
  selected_ids text[],
  updated_at   timestamptz
);
