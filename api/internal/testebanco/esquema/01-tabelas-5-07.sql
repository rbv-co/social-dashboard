-- (plano 02, 15/10/2026) O que aqui é "presumido" foi conferido contra o information_schema de produção: as diferenças estão corrigidas
-- em 04-ajustes-ao-real-producao.sql e esquema_vs_producao_test.go reprova divergência nova.
-- FATIA 5.7 do esquema de produção para os testes (D0 reconstruído: Rulings 5.1-1, 5.6-1 e 5.7-1).
-- Carrega depois de 01-tabelas-5-1…5-6 (ordem de nome) e antes de 01-tabelas-5-8. As funções e o
-- único gatilho vêm em 03-funcoes-5-07.sql. Nenhuma FK para accounts: em produção account_id destas
-- tabelas é TEXTO sem FK (as policies fazem pode_ver_conta(account_id) sem cast). FKs de auth.users
-- viram public.usuarios (ops/migracao/limpar-dump.mjs:64). "presumido" = sem DDL no repositório;
-- conferido pelo `api worker conferir` no banco restaurado.

-- db/migrations/2026-07-02-gt-config-metricas.sql:1-5
create table public.gt_config_metricas (
  balde      text primary key,
  metricas   jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

-- db/migrations/2026-07-02-gt-budget-analises.sql:1-14; impactos: presumido jsonb (o robô grava um
-- objeto: coletor/budget-ia.mjs:508, 1039; a tela o lê em tela-de-gestao-trafego.vue:1019)
create table public.gt_budget_analises (
  campaign_id              text primary key,
  account_id               text not null,
  objetivo                 text,
  effective_status         text,
  budget_atual_centavos    integer,
  budget_sugerido_centavos integer,
  veredito                 text,
  justificativa            text,
  impacto_estimado         text,
  impactos                 jsonb,
  modelo                   text not null default 'claude-opus-4-8',
  gerado_em                timestamptz not null default now(),
  valida_ate               timestamptz
);

-- db/migrations/2026-07-02-gt-ad-analises.sql:1-10
create table public.gt_ad_analises (
  ad_id         text primary key,
  campaign_id   text,
  account_id    text,
  veredito      text,
  justificativa text,
  modelo        text not null default 'claude-opus-4-8',
  gerado_em     timestamptz not null default now(),
  valida_ate    timestamptz
);

-- db/migrations/2026-07-29-fila-decisoes.sql:1-15 + escopo (2026-07-29-fila-escopo-criativos.sql e o
-- check de 2026-08-12-fila-escopo-saude.sql)
create table public.gt_fila_decisoes (
  id                       bigserial primary key,
  campaign_id              text not null,
  account_id               text,
  veredito                 text not null,
  budget_atual_centavos    integer,
  budget_sugerido_centavos integer,
  analise_gerada_em        timestamptz,
  decisao                  text not null check (decisao in ('aprovada', 'recusada')),
  decidido_em              timestamptz not null default now(),
  decidido_por             uuid,
  silenciar_ate            timestamptz,
  aplicado                 jsonb not null default '[]'::jsonb,
  erro                     text,
  escopo                   text not null default 'orcamento'
                           constraint gt_fila_decisoes_escopo_check check (escopo in ('orcamento', 'criativos', 'saude'))
);

-- supabase/migrations/20260728_ponderada_config.sql:1-8 + metas_por_conta (2026-07-29-regua-metas-por-conta.sql);
-- limiares_resultado: presumido jsonb anulável (lido em tela-de-gestao-trafego.vue:1563 e regua.js:57)
create table public.gt_ponderada_config (
  id                 int primary key default 1 check (id = 1),
  pesos              jsonb not null default '{"curtidas":1,"comentarios":10,"salvamentos":30,"compartilhamentos":20}'::jsonb,
  metas              jsonb not null default '{"engajamento":0.15,"reconhecimento":0.15}'::jsonb,
  limiares           jsonb not null default '{"escalarForte":0.8,"dentroMeta":1.0,"manter":1.3}'::jsonb,
  updated_at         timestamptz not null default now(),
  updated_by         uuid,
  metas_por_conta    jsonb not null default '{}'::jsonb,
  limiares_resultado jsonb
);

-- supabase/migrations/20260728_ponderada_config.sql:10-16
create table public.gt_ponderada_config_log (
  id         bigserial primary key,
  mudou_em   timestamptz not null default now(),
  mudou_quem uuid,
  antes      jsonb,
  depois     jsonb
);

-- supabase/migrations/20260728_objetivo_por_interacao.sql:1-8
create table public.gt_objetivo_interacao (
  alvo_id    text primary key,
  nivel      text not null check (nivel in ('campanha','anuncio')),
  interacao  text not null check (interacao in ('curtidas','comentarios','salvamentos','compartilhamentos')),
  conta_id   uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- db/migrations/2026-08-03-gt-rascunhos-de-campanha.sql:1-20 (criado_por: auth.users → usuarios)
create table public.gt_campanhas_rascunho (
  id          uuid primary key default gen_random_uuid(),
  account_id  text not null,
  criado_por  uuid not null references public.usuarios(id) default auth.uid(),
  estado      jsonb not null default '{}'::jsonb,
  passo       int not null default 0,
  nome        text not null default '',
  tipo        text not null default '',
  status      text not null default 'rascunho' check (status in ('rascunho', 'criada', 'falhou')),
  resultado   jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- db/migrations/2026-08-17-guardar-o-motivo-da-meta.sql:1-18
create table public.gt_problemas_meta (
  ad_id         text        not null,
  codigo        integer     not null,
  account_id    text,
  campaign_id   text,
  conta_nome    text,
  campanha_nome text,
  ad_nome       text,
  titulo        text,
  detalhe       text,
  nivel         text,
  grave         boolean     not null default false,
  primeira_vez  timestamptz not null default now(),
  ultima_vez    timestamptz not null default now(),
  resolvido_em  timestamptz,
  primary key (ad_id, codigo)
);

-- DONA: fatia 5.8 (Fábrica). Declarada aqui porque interesses_sugeridos (5.7) tem FK para ela e esta
-- fatia carrega antes da 5.8 (Ruling 5.7-1): a fatia 5.8 NÃO a redeclara; coluna que faltar entra lá
-- com `alter table public.fabrica_marcas add column if not exists …`.
-- db/migrations/018_fabrica_marcas_lojas.sql:2-12 + segmento (2026-07-31-marca-segmento.sql:17-18)
-- + termos_produto (2026-08-01-interesses-termos-de-produto.sql:31-32)
create table public.fabrica_marcas (
  id               uuid primary key default gen_random_uuid(),
  nome             text not null,
  caption_template text not null default 'Ofertas {marca} · chame a gente no WhatsApp 💬',
  ad_account       text not null,
  page_id          text not null,
  ig_id            text not null,
  account_id       text not null,
  ativo            boolean not null default true,
  created_at       timestamptz not null default now(),
  segmento         text,
  termos_produto   text[] not null default '{}'
);

-- db/migrations/2026-07-31-interesses-sugeridos.sql:1-11
create table public.interesses_sugeridos (
  id        uuid primary key default gen_random_uuid(),
  marca_id  uuid not null references public.fabrica_marcas(id) on delete cascade,
  objetivo  text not null,
  itens     jsonb not null default '[]'::jsonb,
  propostos int not null default 0,
  validos   int not null default 0,
  modelo    text,
  gerado_em timestamptz not null default now(),
  unique (marca_id, objetivo)
);
