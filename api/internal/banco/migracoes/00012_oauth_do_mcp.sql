-- +goose Up
-- MCP da Frota (ChatGPT): o OAuth 2.1 da própria API (docs/superpowers/specs/2026-10-19-mcp-frota-chatgpt-design.md).
-- O token de acesso é uma sessão de tipo 'mcp': auth.Exigir nega todo tipo fora de painel/serviço, então ele
-- só abre POST /mcp. Códigos e refresh guardam só o HASH (sha256, o mesmo das sessões).
alter table sessoes drop constraint if exists sessoes_tipo_check;
alter table sessoes add constraint sessoes_tipo_check check (tipo in ('painel', 'cliente', 'servico', 'mcp'));
alter table sessoes add constraint sessoes_mcp_sem_impersonador check (tipo <> 'mcp' or impersonador_id is null);

-- Cliente público (sem segredo), do registro dinâmico (RFC 7591). redirect_uris já validadas na API (https, host permitido).
create table if not exists oauth_clientes (
  id            text primary key,
  nome          text not null check (length(nome) between 1 and 100),
  redirect_uris text[] not null check (cardinality(redirect_uris) between 1 and 5),
  criado_em     timestamptz not null default now()
);

-- Código de autorização: 10 min, uso único (o token apaga a linha ao trocar).
create table if not exists oauth_codigos (
  codigo_hash  text primary key,
  cliente_id   text not null references oauth_clientes (id) on delete cascade,
  usuario_id   uuid not null references usuarios (id) on delete cascade,
  redirect_uri text not null,
  desafio      text not null, -- code_challenge (PKCE S256)
  expira_em    timestamptz not null
);

-- Refresh rotativo. familia: a cadeia nascida de um consentimento; refresh já usado que volta = vazamento,
-- e a família inteira (refresh e sessões) cai. sessao_hash: o token de acesso emitido junto.
create table if not exists oauth_refresh (
  token_hash  text primary key,
  familia     uuid not null,
  cliente_id  text not null references oauth_clientes (id) on delete cascade,
  usuario_id  uuid not null references usuarios (id) on delete cascade,
  sessao_hash text not null,
  expira_em   timestamptz not null,
  usado_em    timestamptz
);
create index if not exists oauth_refresh_familia_idx on oauth_refresh (familia);
create index if not exists oauth_refresh_usuario_idx on oauth_refresh (usuario_id);

-- +goose Down
drop table if exists oauth_refresh;
drop table if exists oauth_codigos;
drop table if exists oauth_clientes;
delete from sessoes where tipo = 'mcp';
alter table sessoes drop constraint if exists sessoes_mcp_sem_impersonador;
alter table sessoes drop constraint if exists sessoes_tipo_check;
alter table sessoes add constraint sessoes_tipo_check check (tipo in ('painel', 'cliente', 'servico'));
