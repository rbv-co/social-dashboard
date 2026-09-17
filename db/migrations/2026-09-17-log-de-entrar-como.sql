-- REGISTRO DE "ENTRAR COMO" — quem entrou como quem, quando.
--
-- "Entrar como" (docs/superpowers/specs/2026-09-17-entrar-como-usuario-design.md)
-- gera uma sessao REAL de outra pessoa. A partir dai dado real dela e exposto,
-- e isso precisa de trilha -- diferente da "Visao como", que so le
-- configuracao e nunca precisou de auditoria.
--
-- So a Edge Function grava (chave de servico, ignora RLS). So super-admin le.

create table if not exists public.entradas_como_outro_usuario (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references public.profiles(id),
  admin_email text not null,
  alvo_id uuid not null references public.profiles(id),
  alvo_email text not null,
  criado_em timestamptz not null default now()
);

alter table public.entradas_como_outro_usuario enable row level security;

drop policy if exists "superadmin le entradas como outro usuario" on public.entradas_como_outro_usuario;
create policy "superadmin le entradas como outro usuario"
  on public.entradas_como_outro_usuario
  for select
  using (public.superadmin_pela_ficha());
