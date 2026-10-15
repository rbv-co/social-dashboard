-- Papel `pdv_leitura`: o que o PDV (pdv-backend, src/catalogo/pecas-origem.service.ts, no contêiner `pdv2-api-api-1`) usa
-- depois do corte para ler o NÚMERO DE SÉRIE das peças (E4 do roteiro da virada). SÓ LEITURA, só das colunas que a
-- consulta do PDV usa: nenhuma outra tabela, nenhuma função, nenhuma escrita.
--
-- O papel de mesmo nome no Supabase tinha SELECT nas 181 tabelas do `public` (regra de default privileges) e BYPASSRLS:
-- aqui o caminho é o contrário, e quem precisar de coluna nova pede GRANT novo (o PDV falha alto: `permission denied`).
-- No `api-db` não há RLS (o `limpar-dump.mjs` a tira): o GRANT é a única tranca.
--
-- Rodar como o dono do banco, depois da carga e de `api migrar` (só com ok do dono). A senha entra pelo AMBIENTE
-- (\getenv), nunca na linha de comando:
--   SENHA_PDV="$(cat /root/secrets/pdv.senha)" docker exec -i -e SENHA_PDV api-db psql -U api -d api < /root/api-db/papel-pdv.sql
-- Reaplicar é seguro: a senha é trocada e os GRANTs são refeitos. Prova: papel-pdv.teste.sh.
--
-- O PDV só chega aqui com o contêiner na rede `api_net` (o `api-db` não publica porta) e a URL
--   SUPABASE_DATABASE_URL=postgres://pdv_leitura:<SENHA_PDV>@api-db:5432/api?sslmode=disable
-- (o servidor não fala TLS; o pdv-backend lê `sslmode=disable` em tls-da-origem.ts).
\set ON_ERROR_STOP on
\getenv senha SENHA_PDV
\if :{?senha}
\else
  do $$ begin raise exception 'falta SENHA_PDV no ambiente'; end $$;
\endif

select not exists (select 1 from pg_roles where rolname = 'pdv_leitura') as criar \gset
\if :criar
  create role pdv_leitura login;
\endif
alter role pdv_leitura with login nosuperuser nocreatedb nocreaterole noinherit nobypassrls connection limit 4 password :'senha';

grant connect on database :"DBNAME" to pdv_leitura;
grant usage on schema public to pdv_leitura;

-- A consulta do PDV: select p.codigo, l.sku, p.numero_na_serie, p.criado_em
--                    from vessel_pecas p join vessel_lotes l on l.id = p.lote_id where l.sku is not null [and p.codigo = $1]
revoke all on public.vessel_pecas, public.vessel_lotes from pdv_leitura;
grant select (codigo, lote_id, numero_na_serie, criado_em) on public.vessel_pecas to pdv_leitura;
grant select (id, sku) on public.vessel_lotes to pdv_leitura;
-- Nenhum EXECUTE (regra 15 do LEIA-ME.md): o PDV não chama função.
