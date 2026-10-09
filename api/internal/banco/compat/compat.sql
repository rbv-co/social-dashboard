-- Camada de compatibilidade com o que o Supabase oferecia, para restaurar o schema
-- `public` de produção sem reescrever, no dia 1, as funções que o usam:
--   64 funções chamam auth.uid(); 18 chamam extensions.* (pgcrypto/uuid-ossp); 1 chama auth.role().
-- Idempotente. NÃO cria policies nem dá permissão a ninguém: a autorização é do Go.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end
$$;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;

create schema if not exists auth;

-- A API grava a identidade na transação: select set_config('app.usuario_id', '<uuid>', true).
-- Valor ausente ou inválido vira null (nunca erro) e não vaza para a transação seguinte.
create or replace function auth.uid() returns uuid
language plpgsql stable as $$
declare v text := nullif(current_setting('app.usuario_id', true), '');
begin
  return v::uuid;
exception when invalid_text_representation then
  return null;
end
$$;

-- Conservador: sem configuração é 'authenticated', nunca 'service_role'.
create or replace function auth.role() returns text
language sql stable as $$
  select coalesce(nullif(current_setting('app.papel_db', true), ''), 'authenticated')
$$;
