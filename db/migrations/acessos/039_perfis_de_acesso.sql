-- PERFIS DE ACESSO (D7-D11 do desenho 2026-08-11).
--
-- POR QUE ISTO EXISTE: 15 pessoas em 12 formatos de acesso distintos, e o dono
-- classificou isso como "foi acontecendo, deveria ter padrão". Dar acesso a
-- alguém novo era marcar item por item.
--
-- POR QUE O PERFIL NÃO SUBSTITUI `profiles.permissions`: essa coluna é
-- consultada por `hasPermission` em toda tela e por RLS no banco. Trocar a fonte
-- da verdade por uma junção tornaria cada checagem de acesso um risco novo. Aqui
-- o perfil é uma CAMADA: ele diz o que gravar em `permissions`, e quem lê
-- continua lendo o mesmo lugar de sempre.
--
-- `permissions_excecao` é o que D9 exige: o que foi dado à mão àquela pessoa,
-- fora do perfil. Ao recalcular, o perfil manda no que ele cobre e a exceção
-- sobrevive por cima. Sem essa coluna não dá para distinguir "veio do perfil" de
-- "alguém deu de propósito", e a primeira mudança de perfil apagaria trabalho.

begin;

create table if not exists public.acessos_perfis (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null unique,
  -- O MESMO formato de `profiles.permissions`: { "chave": ["ver","editar"] }.
  -- Formato diferente entre os dois exigiria conversão em toda leitura, e
  -- conversão é onde acesso se perde em silêncio.
  permissions jsonb not null default '{}'::jsonb,
  criado_em   timestamptz not null default now(),
  criado_por  uuid references auth.users(id)
);

alter table public.profiles
  add column if not exists perfil_id uuid references public.acessos_perfis(id) on delete set null;

-- `on delete set null`: apagar um perfil NÃO pode apagar o acesso de ninguém.
-- Quem estava nele fica com as permissões que já tinha, só deixa de ser
-- propagado. Cascade aqui zeraria gente sem ninguém pedir.

alter table public.profiles
  add column if not exists permissions_excecao jsonb not null default '{}'::jsonb;

alter table public.acessos_perfis enable row level security;

do $$ begin
  -- LER: quem administra usuários precisa ver os perfis pra escolher um.
  if not exists (select 1 from pg_policies
                  where tablename = 'acessos_perfis' and policyname = 'acessos_perfis_ler') then
    create policy acessos_perfis_ler on public.acessos_perfis
      for select to authenticated using (true);
  end if;
  -- ESCREVER: só superadmin. Perfil é uma alavanca que muda várias pessoas de
  -- uma vez — é o mesmo motivo de `guard_user_permissions` existir.
  if not exists (select 1 from pg_policies
                  where tablename = 'acessos_perfis' and policyname = 'acessos_perfis_escrever') then
    create policy acessos_perfis_escrever on public.acessos_perfis
      for all to authenticated
      using (public.is_superadmin()) with check (public.is_superadmin());
  end if;
end $$;

commit;
