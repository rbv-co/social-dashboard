-- +goose Up
create table usuarios (
  id                  uuid primary key,
  email               text not null,
  senha_hash          text,
  email_confirmado_em timestamptz,
  criado_em           timestamptz not null default now(),
  desativado_em       timestamptz
);
create unique index usuarios_email_unico on usuarios (lower(email));

create table sessoes (
  token_hash      text primary key,
  usuario_id      uuid not null references usuarios (id) on delete cascade,
  tipo            text not null default 'painel' check (tipo in ('painel', 'cliente', 'servico')),
  impersonador_id uuid references usuarios (id),
  criada_em       timestamptz not null default now(),
  expira_em       timestamptz not null,
  ultimo_uso_em   timestamptz not null default now()
);
create index sessoes_usuario_idx on sessoes (usuario_id);

-- +goose Down
drop table sessoes;
drop table usuarios;
