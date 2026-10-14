-- +goose Up
-- Links de uso único de convite e de troca de senha (antes, do Auth do Supabase). Só o hash
-- do token é guardado; o token em claro vai uma vez, no e-mail.
create table if not exists tokens_de_senha (
  token_hash text primary key,
  usuario_id uuid not null references usuarios (id) on delete cascade,
  tipo       text not null check (tipo in ('convite', 'recuperacao')),
  criado_em  timestamptz not null default now(),
  expira_em  timestamptz not null,
  usado_em   timestamptz
);
create index if not exists tokens_de_senha_usuario_idx on tokens_de_senha (usuario_id);

-- +goose Down
drop table if exists tokens_de_senha;
