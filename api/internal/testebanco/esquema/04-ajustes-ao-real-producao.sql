-- Ajustes das tabelas PRESUMIDAS ao que a PRODUÇÃO realmente tem (plano 02 da REVISAO-TESTES-2026-10, 15/10/2026).
-- O DDL de origem destas tabelas não está no repositório (01-tabelas-5-01/5-06/5-07 foram escritos pelo que o
-- código usa); o information_schema de produção (testdata/producao_colunas.tsv) mostrou tipo, NOT NULL e default
-- diferentes, colunas faltando e uma coluna a mais. Um ALTER por diferença, para o esquema de teste ser o real.
-- O teste esquema_vs_producao_test.go reprova qualquer divergência nova. Colunas que faltavam entram NO FIM da tabela (a ordem
-- difere da produção: insert posicional em teste depende da ordem do esquema de teste, não da de produção).

alter table public.access_requests alter column created_at drop not null;
alter table public.access_requests alter column email set not null;
alter table public.access_requests alter column message set default ''::text;
alter table public.access_requests alter column name set not null;
-- audit_log: a produção chama a coluna de `at` (o esquema de teste tinha `created_at`, que a produção não tem)
alter table public.audit_log rename column created_at to at;
alter table public.audit_log alter column at drop not null;
alter table public.access_requests alter column status drop not null;
alter table public.account_insights alter column clicks type integer using clicks::integer;
alter table public.account_insights alter column clicks set default 0;
alter table public.account_insights alter column frequency set default 0;
alter table public.account_insights alter column impressions type integer using impressions::integer;
alter table public.account_insights alter column impressions set default 0;
alter table public.account_insights alter column reach type integer using reach::integer;
alter table public.account_insights alter column reach set default 0;
alter table public.account_insights alter column spend set default 0;
alter table public.accounts alter column instagram_id set not null;
alter table public.accounts alter column name set not null;
alter table public.accounts alter column username set not null;
alter table public.audit_log alter column action drop not null;
-- audit_log.id: produção usa identity ALWAYS (o esquema de teste tinha bigserial)
alter table public.audit_log alter column id drop default;
drop sequence public.audit_log_id_seq;
alter table public.audit_log alter column id add generated always as identity;
alter table public.campaign_filters alter column selected_ids set default '{}'::text[];
alter table public.campaign_filters alter column updated_at set default now();
alter table public.campaign_insights alter column clicks type integer using clicks::integer;
alter table public.campaign_insights alter column clicks set default 0;
alter table public.campaign_insights alter column impressions type integer using impressions::integer;
alter table public.campaign_insights alter column impressions set default 0;
alter table public.campaign_insights alter column reach type integer using reach::integer;
alter table public.campaign_insights alter column reach set default 0;
alter table public.campaign_insights alter column spend type numeric(14,4) using spend::numeric(14,4);
alter table public.campaign_insights alter column spend set default 0;
-- campaigns.account_id: em produção é NOT NULL; no teste fica NULL de propósito (ver esquema_vs_producao_test.go: os testes de
-- pode_ver_conta(null) semeiam campanha sem conta).
alter table public.campaigns alter column synced_at set default CURRENT_DATE;
alter table public.content_snapshots alter column account_id drop not null;
alter table public.content_snapshots alter column period_days set default 30;
alter table public.content_snapshots alter column posts_count set default 0;
alter table public.content_snapshots alter column reels_count set default 0;
alter table public.content_snapshots alter column stories_count set default 0;
alter table public.content_snapshots alter column story_follows set not null;
alter table public.content_snapshots alter column story_follows set default 0;
alter table public.content_snapshots alter column story_interactions set not null;
alter table public.content_snapshots alter column story_interactions set default 0;
alter table public.content_snapshots alter column story_nav_back set not null;
alter table public.content_snapshots alter column story_nav_back set default 0;
alter table public.content_snapshots alter column story_nav_exit set not null;
alter table public.content_snapshots alter column story_nav_exit set default 0;
alter table public.content_snapshots alter column story_nav_forward set not null;
alter table public.content_snapshots alter column story_nav_forward set default 0;
alter table public.content_snapshots alter column story_nav_next set not null;
alter table public.content_snapshots alter column story_nav_next set default 0;
alter table public.content_snapshots alter column story_navigation set not null;
alter table public.content_snapshots alter column story_navigation set default 0;
alter table public.content_snapshots alter column story_profile_visits set not null;
alter table public.content_snapshots alter column story_profile_visits set default 0;
alter table public.content_snapshots alter column story_reach set default 0;
alter table public.content_snapshots alter column story_replies set default 0;
alter table public.content_snapshots alter column story_shares set default 0;
alter table public.daily_snapshots alter column account_id drop not null;
alter table public.daily_snapshots alter column followers_count set not null;
alter table public.daily_snapshots alter column followers_count set default 0;
alter table public.data_integrity_checks alter column created_at drop not null;
alter table public.data_integrity_checks alter column detail set default ''::text;
alter table public.engagement_snapshots alter column account_id drop not null;
alter table public.engagement_snapshots alter column accounts_engaged set not null;
alter table public.engagement_snapshots alter column accounts_engaged set default 0;
alter table public.engagement_snapshots alter column comments set not null;
alter table public.engagement_snapshots alter column comments set default 0;
alter table public.engagement_snapshots alter column created_at drop not null;
alter table public.engagement_snapshots alter column likes set default 0;
alter table public.engagement_snapshots alter column period_days set default 30;
alter table public.engagement_snapshots alter column profile_views set not null;
alter table public.engagement_snapshots alter column profile_views set default 0;
alter table public.engagement_snapshots alter column reach type bigint using reach::bigint;
alter table public.engagement_snapshots alter column reach set not null;
alter table public.engagement_snapshots alter column reach set default 0;
alter table public.engagement_snapshots alter column saves set default 0;
alter table public.engagement_snapshots alter column shares set default 0;
alter table public.engagement_snapshots alter column total_interactions set not null;
alter table public.engagement_snapshots alter column total_interactions set default 0;
alter table public.engagement_snapshots alter column views type bigint using views::bigint;
alter table public.engagement_snapshots alter column views set not null;
alter table public.engagement_snapshots alter column views set default 0;
alter table public.fabrica_marcas alter column caption_template set default '{desconto} em bolsas {marca} · chame a gente 💬'::text;
alter table public.gt_ponderada_config alter column limiares_resultado set not null;
alter table public.gt_ponderada_config alter column limiares_resultado set default '{"manter": 1.3, "dentroMeta": 1.0, "escalarForte": 0.8}'::jsonb;
alter table public.gt_ponderada_config alter column metas set default '{"leads": 0.20, "padrao": 0.20, "vendas": 0.20, "trafego": 0.20, "mensagens": 0.20, "engajamento": 0.20, "reconhecimento": 0.20}'::jsonb;
alter table public.ia_execucoes alter column usd drop not null;
alter table public.ia_execucoes alter column usd drop default;
alter table public.profiles alter column features set default ARRAY['banco'::text];
alter table public.social_metas alter column valor set not null;
alter table public.vessel_atendimentos alter column teste set default false;
alter table public.vessel_client_advisors alter column teste set default false;
alter table public.vessel_convite_aberturas alter column teste set default false;
alter table public.vessel_pessoas alter column teste set default false;
alter table public.account_insights add column created_at timestamp with time zone default now();
alter table public.account_insights add column id bigint generated always as identity;
alter table public.accounts add column created_at timestamp with time zone default now();
alter table public.accounts add column page_id text;
alter table public.campaign_insights add column id bigserial;
alter table public.content_snapshots add column created_at timestamp with time zone default now();
alter table public.content_snapshots add column id uuid not null default gen_random_uuid();
alter table public.content_snapshots add column story_impressions integer default 0;
alter table public.daily_snapshots add column created_at timestamp with time zone default now();
alter table public.daily_snapshots add column id uuid not null default gen_random_uuid();
alter table public.engagement_snapshots add column id uuid not null default gen_random_uuid();
alter table public.social_metas add column updated_at timestamp with time zone not null default now();
alter table public.social_metas add column updated_by uuid default auth.uid();

-- Restrições e índices únicos que a produção tem e o esquema de teste não tinha (testdata/producao_restricoes.tsv).
alter table public.access_requests add check (status = any (array['pending'::text, 'approved'::text, 'denied'::text]));
create unique index on public.access_requests (lower(email)) where (status = 'pending'::text);
alter table public.account_insights add foreign key (account_id) references public.accounts(id);
alter table public.account_insights add primary key (id);
alter table public.accounts add unique (instagram_id);
alter table public.acessos_pessoas add foreign key (profile_id) references public.profiles(id) on delete set null;
create unique index on public.acessos_pessoas (profile_id) where (profile_id is not null);
alter table public.campaign_filters add foreign key (account_id) references public.accounts(id) on delete cascade;
alter table public.campaign_insights add foreign key (account_id) references public.accounts(id) on delete cascade;
alter table public.campaign_insights add primary key (id);
alter table public.campaigns add foreign key (account_id) references public.accounts(id) on delete cascade;
create unique index on public.carrinho_eventos (evento_shopify_id) where (evento_shopify_id is not null);
alter table public.checkout_abandono add check ((mensagem_status is null) or (mensagem_status = any (array['enviando'::text, 'enviada'::text, 'falhou'::text, 'ignorada'::text])));
alter table public.content_snapshots add foreign key (account_id) references public.accounts(id) on delete cascade;
alter table public.content_snapshots add primary key (id);
alter table public.daily_snapshots add foreign key (account_id) references public.accounts(id) on delete cascade;
alter table public.daily_snapshots add primary key (id);
alter table public.data_integrity_checks add foreign key (account_id) references public.accounts(id);
alter table public.engagement_snapshots add foreign key (account_id) references public.accounts(id) on delete cascade;
alter table public.engagement_snapshots add primary key (id);
alter table public.profiles add check (role = any (array['admin'::text, 'viewer'::text]));
-- social_metas: produção tem PRIMARY KEY (account_id, periodo, indicador); o teste tinha só UNIQUE
do $$ declare c text; begin
  select conname into c from pg_constraint where conrelid = 'public.social_metas'::regclass and contype = 'u';
  execute format('alter table public.social_metas drop constraint %I', c);
end $$;
alter table public.social_metas add primary key (account_id, periodo, indicador);
-- vessel_stylists: a produção também aceita `sem_contato` no lugar de whatsapp/instagram
do $$ declare c text; begin
  select conname into c from pg_constraint where conrelid = 'public.vessel_stylists'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%instagram%';
  execute format('alter table public.vessel_stylists drop constraint %I', c);
end $$;
alter table public.vessel_stylists add check ((whatsapp is not null) or (nullif(btrim(coalesce(instagram, ''::text)), ''::text) is not null) or sem_contato);
-- chatwoot_eventos: só o webhook grava; o relatório OPR lê (/redes/chatwoot-eventos)
create table if not exists public.chatwoot_eventos (id bigint generated always as identity primary key,
  tipo text not null check (tipo in ('lead_novo', 'lead_quente', 'qualified_lead')),
  chatwoot_account_id integer, conversation_id bigint not null, conversation_display_id bigint, contact_id bigint,
  contact_name text, contact_phone_number text, loja text, classificacao_ia text,
  criado_em_chatwoot timestamptz not null, dia_br date not null, recebido_em timestamptz not null default now(),
  unique (conversation_id, tipo));
