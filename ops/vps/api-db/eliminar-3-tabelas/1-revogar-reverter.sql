-- Reverte a ETAPA 1: devolve os GRANTs que o api-db tinha em 20/10/2026 (relacl e attacl lidos em produção).
begin;
set local lock_timeout = '5s';
grant insert, update, delete, truncate on table public.bling_tokens to anon, authenticated, service_role;
grant insert, update, delete, truncate on table public.vessel_envios_ao_meta to anon, authenticated, service_role;
grant insert, update, delete, truncate on table public.estoque_do_site_estado to service_role;
grant select (id, access_token) on public.bling_tokens to robo_selo, robo_pedidos_vessel;
commit;
