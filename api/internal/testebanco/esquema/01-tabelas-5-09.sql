-- FATIA 5.9 do esquema de produção para os testes (D0 reconstruído: Rulings 5.1-1, 5.7-1 e 5.9-1). Carrega
-- depois de 01-tabelas-5-01.sql (usuarios, profiles) e 01-tabelas-5-06.sql (accounts, com
-- publicacao_automatica e conteudo_usa_portal: NÃO redeclarar). FKs de auth.users viram public.usuarios
-- (ops/migracao/limpar-dump.mjs:64). Todas com DDL no repositório: sem presumido. O único gatilho de produção
-- nestas tabelas (conteudo_pecas_guarda, levantamento/03-triggers.csv:5) e as 6 RPCs do painel vão VERBATIM
-- em 03-funcoes-5-09.sql.

-- db/migrations/2026-07-29-conteudo-01-fundacao.sql:14-58 (criado_por/aprovado_por: auth.users → usuarios)
-- + 2026-08-01-conteudo-16-responsavel-e-aprovar-agendando.sql:15-16 (responsavel → profiles)
create table public.conteudo_pecas (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references public.accounts(id) on delete cascade,
  titulo       text not null,
  formato      text not null check (formato in ('feed', 'reels', 'stories', 'carrossel')),
  status       text not null default 'rascunho'
               check (status in ('rascunho', 'em_aprovacao', 'aprovada', 'reprovada',
                                 'agendada', 'publicada', 'arquivada')),
  legenda      text not null default '',
  hashtags     text not null default '',
  observacoes  text,
  publicar_em  timestamptz,
  publicado_em timestamptz,
  avisado_em   timestamptz,
  ig_media_id  text,
  ig_permalink text,
  criado_por        uuid references public.usuarios(id),
  aprovado_por      uuid references public.usuarios(id),
  aprovado_em       timestamptz,
  motivo_reprovacao text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  responsavel  uuid references public.profiles(id) on delete set null,
  constraint conteudo_agendada_tem_data
    check (status <> 'agendada' or publicar_em is not null),
  constraint conteudo_publicada_tem_data
    check (status <> 'publicada' or publicado_em is not null)
);
-- 01-fundacao.sql:64-77 e 16:23-24
create index conteudo_pecas_conta_idx on public.conteudo_pecas (account_id, publicar_em);
create index conteudo_pecas_status_idx on public.conteudo_pecas (status, publicar_em);
create index conteudo_pecas_horah_idx on public.conteudo_pecas (publicar_em)
  where status = 'agendada' and avisado_em is null;
create unique index conteudo_pecas_ig_media_uq on public.conteudo_pecas (ig_media_id)
  where ig_media_id is not null;
create index conteudo_pecas_responsavel_idx on public.conteudo_pecas (responsavel)
  where responsavel is not null;

-- 01-fundacao.sql:83-105
create table public.conteudo_arquivos (
  id        uuid primary key default gen_random_uuid(),
  peca_id   uuid not null references public.conteudo_pecas(id) on delete cascade,
  ordem     int  not null default 1,
  bucket    text not null default 'conteudo',
  caminho   text not null,
  tipo      text not null check (tipo in ('imagem', 'video')),
  mime      text,
  bytes     bigint,
  largura   int,
  altura    int,
  duracao_s numeric,
  created_at timestamptz not null default now(),
  unique (peca_id, ordem)
);
create index conteudo_arquivos_peca_idx on public.conteudo_arquivos (peca_id, ordem);

-- 01-fundacao.sql:111-126
create table public.conteudo_eventos (
  id       bigserial primary key,
  peca_id  uuid not null references public.conteudo_pecas(id) on delete cascade,
  de       text,
  para     text,
  acao     text not null,
  detalhe  text,
  quem     uuid,
  quando   timestamptz not null default now()
);
create index conteudo_eventos_peca_idx on public.conteudo_eventos (peca_id, quando desc);

-- db/migrations/2026-07-31-conteudo-07-metricas.sql:13-27
create table public.conteudo_metricas (
  peca_id           uuid not null references public.conteudo_pecas(id) on delete cascade,
  capturado_em      date not null,
  curtidas          int,
  comentarios       int,
  alcance           int,
  salvamentos       int,
  compartilhamentos int,
  visualizacoes     int,
  bruto             jsonb,
  primary key (peca_id, capturado_em)
);

-- 07-metricas.sql:38-65
create table public.conteudo_casamentos (
  id           uuid primary key default gen_random_uuid(),
  peca_id      uuid not null references public.conteudo_pecas(id) on delete cascade,
  ig_media_id  text not null,
  ig_permalink text,
  ig_timestamp timestamptz,
  ig_caption   text,
  ig_thumb     text,
  pontuacao    numeric not null,
  motivo       text,
  situacao     text not null default 'sugerido'
               check (situacao in ('sugerido', 'confirmado', 'recusado', 'automatico')),
  decidido_por uuid,
  decidido_em  timestamptz,
  created_at   timestamptz not null default now(),
  unique (peca_id, ig_media_id)
);
create index conteudo_casamentos_peca_idx on public.conteudo_casamentos (peca_id, created_at desc);
create index conteudo_casamentos_pendentes_idx on public.conteudo_casamentos (situacao) where situacao = 'sugerido';

-- db/migrations/2026-07-31-conteudo-10-ideias.sql:13-56 + 2026-08-01-conteudo-13-roteiro-completo.sql:20-27
create table public.conteudo_ideias (
  id         uuid primary key default gen_random_uuid(),
  account_id uuid references public.accounts(id) on delete cascade,
  titulo     text not null,
  gancho     text,
  formato    text check (formato in ('feed', 'reels', 'stories', 'carrossel')),
  pilar      text,
  roteiro    jsonb not null default '[]'::jsonb,
  legenda_sugerida  text,
  hashtags_sugeridas text,
  por_que_agora text,
  referencia    text,
  origem     text not null default 'manual' check (origem in ('manual', 'ia')),
  modelo     text,
  job_id     uuid,
  situacao   text not null default 'nova'
             check (situacao in ('nova', 'favorita', 'usada', 'descartada')),
  peca_id    uuid references public.conteudo_pecas(id) on delete set null,
  criado_por uuid,
  created_at timestamptz not null default now(),
  cta            text,
  producao       text,
  porque_formato text
);
create index conteudo_ideias_conta_idx on public.conteudo_ideias (account_id, situacao, created_at desc);
create index conteudo_ideias_novas_idx on public.conteudo_ideias (created_at desc) where situacao in ('nova', 'favorita');

-- 10-ideias.sql:61-77
create table public.conteudo_blocos (
  id         uuid primary key default gen_random_uuid(),
  account_id uuid references public.accounts(id) on delete cascade,
  tipo       text not null check (tipo in ('legenda', 'hashtags', 'cta', 'assinatura')),
  nome       text not null,
  texto      text not null,
  usos       int not null default 0,
  ativo      boolean not null default true,
  criado_por uuid,
  created_at timestamptz not null default now()
);
create index conteudo_blocos_conta_idx on public.conteudo_blocos (account_id, tipo, ativo);

-- 10-ideias.sql:83-98 (criado_por: auth.users → usuarios)
create table public.conteudo_jobs (
  id            uuid primary key default gen_random_uuid(),
  tipo          text not null default 'ideias',
  account_id    uuid references public.accounts(id) on delete cascade,
  params        jsonb not null default '{}'::jsonb,
  status        text not null default 'enfileirado'
                check (status in ('enfileirado', 'rodando', 'concluido', 'erro')),
  github_run_id text,
  resultado     jsonb,
  erro          text,
  criado_por    uuid references public.usuarios(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index conteudo_jobs_status_idx on public.conteudo_jobs (status, created_at desc);

-- db/migrations/2026-08-01-conteudo-12-concorrentes-por-marca.sql:12-30
create table public.conteudo_concorrentes (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  handle      text not null,
  nome        text,
  observacao  text,
  ativo       boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (account_id, handle)
);
create index conteudo_concorrentes_da_conta on public.conteudo_concorrentes (account_id) where ativo;
