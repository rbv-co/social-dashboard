-- +goose Up
-- Contas de serviço (Plano 5.13): tokens de longa duração dos robôs do coletor/. O robô é um usuário
-- (sem senha) com perfil próprio; o token só identifica esse usuário. Só o HASH (sha256, o mesmo das
-- sessões) é guardado; o token em claro é impresso uma vez pelo `api servico criar`.
create table if not exists tokens_de_servico (
  id            uuid primary key default gen_random_uuid(),
  usuario_id    uuid not null references usuarios (id) on delete cascade,
  nome          text not null unique check (nome ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  token_hash    text not null unique,
  criado_em     timestamptz not null default now(),
  revogado_em   timestamptz,
  ultimo_uso_em timestamptz
);
create index if not exists tokens_de_servico_usuario_idx on tokens_de_servico (usuario_id);

-- Sessão de serviço nunca é "entrar como" (defesa no banco, além do auth.SoServico; pedido da trilha B).
alter table sessoes add constraint sessoes_servico_sem_impersonador
  check (tipo <> 'servico' or impersonador_id is null);

-- +goose Down
alter table sessoes drop constraint if exists sessoes_servico_sem_impersonador;
drop table if exists tokens_de_servico;
