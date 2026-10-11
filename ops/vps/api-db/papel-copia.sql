-- Papel `copia`: o que a cópia de segurança para o Zoho (coletor/guardar-copia-do-banco.mjs, agendada na
-- VPS por coletor/vps/robos.cron) usa depois do corte (Plano 4, Task 11). Lê todas as tabelas do public
-- e só escreve a linha da rodada em robos_execucoes (o painel de saúde cobra o robô como crítico).
--
-- Rodar como o dono do banco, depois da carga e de `api migrar` (só com ok do dono). A senha entra pelo
-- AMBIENTE (\getenv), nunca na linha de comando (que qualquer `ps` do host mostra):
--   SENHA_COPIA="$(cat /root/secrets/copia.senha)" docker exec -i -e SENHA_COPIA api-db psql -U api -d api < /root/api-db/papel-copia.sql
-- Reaplicar é seguro: a senha é trocada e os GRANTs são refeitos.
\set ON_ERROR_STOP on
\getenv senha SENHA_COPIA
\if :{?senha}
\else
  do $$ begin raise exception 'falta SENHA_COPIA no ambiente'; end $$;
\endif

select not exists (select 1 from pg_roles where rolname = 'copia') as criar \gset
\if :criar
  create role copia login;
\endif
alter role copia with login nosuperuser nocreatedb nocreaterole noinherit connection limit 2 password :'senha';

grant connect on database :"DBNAME" to copia;
grant usage on schema public to copia;
grant select on all tables in schema public to copia;
-- Tabela que nascer depois (migração nova) também entra: a regra da cópia é "copiar TUDO menos o decidido".
alter default privileges in schema public grant select on tables to copia;

-- O hash dos tokens de sessão não sai nem por engano (SEM_COPIA já pula a tabela; o banco garante).
revoke select on public.sessoes from copia;

-- A linha da rodada (robos_execucoes.id é bigserial: o insert precisa da sequência).
grant insert on public.robos_execucoes to copia;
grant usage on sequence public.robos_execucoes_id_seq to copia;
