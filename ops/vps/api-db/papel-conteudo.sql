-- Papel `conteudo_robo`: o que o robô de pauta de Conteúdo (coletor/conteudo-ideias.mjs, conteudo-semana.mjs e o
-- vigia coletor/conteudo-fila.mjs) usa na VPS depois do corte (Plano 5.9/7). Lê o contexto da marca, grava as
-- ideias, fecha o job e deixa a linha de custo em ia_execucoes. Mínimo privilégio: nenhuma função, nenhuma outra tabela.
--
-- Rodar como o dono do banco, depois da carga e de `api migrar` (só com ok do dono). A senha entra pelo
-- AMBIENTE (\getenv), nunca na linha de comando:
--   SENHA_CONTEUDO="$(cat /root/secrets/conteudo.senha)" docker exec -i -e SENHA_CONTEUDO api-db psql -U api -d api < /root/api-db/papel-conteudo.sql
-- Reaplicar é seguro: a senha é trocada e os GRANTs são refeitos.
\set ON_ERROR_STOP on
\getenv senha SENHA_CONTEUDO
\if :{?senha}
\else
  do $$ begin raise exception 'falta SENHA_CONTEUDO no ambiente'; end $$;
\endif

-- TRAVA (igual à do papel-pdv.sql): "nenhuma função" só vale com o EXECUTE de PUBLIC já revogado (papel-copia.sql, regra 15).
select exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
               where p.pronamespace = 'public'::regnamespace and a.grantee = 0 and a.privilege_type = 'EXECUTE') as aberto \gset
\if :aberto
  do $$ begin raise exception 'PUBLIC ainda tem EXECUTE em funções do public: aplique antes o papel-copia.sql (revoga) e rode de novo'; end $$;
\endif

select not exists (select 1 from pg_roles where rolname = 'conteudo_robo') as criar \gset
\if :criar
  create role conteudo_robo login;
\endif
alter role conteudo_robo with login nosuperuser nocreatedb nocreaterole noinherit nobypassrls connection limit 2 password :'senha';

grant connect on database :"DBNAME" to conteudo_robo;
grant usage on schema public to conteudo_robo;

-- refaz do zero: reaplicar tira o que saiu deste arquivo
revoke all on all tables in schema public from conteudo_robo;
revoke all on all sequences in schema public from conteudo_robo;

-- `accounts` guarda access_token: só as quatro colunas que o prompt usa, por COLUNA.
grant select (id, name, username, conteudo_usa_portal) on public.accounts to conteudo_robo;
grant select on public.conteudo_blocos, public.conteudo_pecas, public.conteudo_concorrentes,
                public.conteudo_metricas, public.noticias_concorrentes to conteudo_robo;
grant select, insert on public.conteudo_ideias to conteudo_robo;
-- A fila: lê o pedido e fecha o job; não cria nem apaga job (quem enfileira é a API).
grant select (id, tipo, account_id, params, status, created_at, updated_at) on public.conteudo_jobs to conteudo_robo;
grant update (status, resultado, erro, updated_at) on public.conteudo_jobs to conteudo_robo;
-- Custo da rodada (id é uuid com default: não há sequência).
grant insert on public.ia_execucoes to conteudo_robo;
-- Nenhum EXECUTE (regra 15 do LEIA-ME.md): o robô não chama função.
