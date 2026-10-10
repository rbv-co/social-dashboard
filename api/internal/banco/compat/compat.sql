-- Camada de compatibilidade com o que o Supabase oferecia, para restaurar o schema
-- `public` de produção sem reescrever, no dia 1, as funções que o usam:
--   64 funções chamam auth.uid(); 18 chamam extensions.* (pgcrypto/uuid-ossp); 1 chama auth.role().
-- Idempotente (reaplicar é seguro). NÃO é à prova de corrida entre sessões concorrentes: só a criação dos
-- papéis tolera isso; create schema/extension if not exists e create or replace function, rodados em
-- paralelo, podem falhar. Aplique a camada de uma sessão só. NÃO cria policies nem dá permissão a ninguém: a autorização é do Go.

do $$
declare r text;
begin
  -- Corrida entre sessões: o papel pode surgir entre o exists e o create (duplicate_object; em transações
  -- concorrentes o Postgres dá unique_violation).
  foreach r in array array['anon','authenticated','service_role'] loop
    if not exists (select 1 from pg_roles where rolname = r) then
      begin
        execute format('create role %I nologin', r);
      exception when duplicate_object or unique_violation then null;
      end;
    end if;
  end loop;
end
$$;

create schema if not exists extensions;

-- "create extension if not exists" passa calado se a extensão já existir em OUTRO schema
-- (ex.: public), e aí extensions.gen_random_bytes() não resolveria. Falha com mensagem clara.
do $$
declare e record;
begin
  for e in select x.extname, n.nspname from pg_extension x join pg_namespace n on n.oid = x.extnamespace
           where x.extname in ('pgcrypto', 'uuid-ossp') and n.nspname <> 'extensions' loop
    raise exception 'a extensão % já está instalada no schema %, não em "extensions"; use um banco novo ou mova-a (alter extension % set schema extensions)', e.extname, e.nspname, quote_ident(e.extname);
  end loop;
end
$$;

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
