-- Reverte a ETAPA 2: recria o ESQUEMA VAZIO das 3 tabelas (colunas, chaves, índice, FK, comentários e GRANTs da etapa 1
-- já revogados NÃO voltam aqui: rode depois 1-revogar-reverter.sql se quiser os GRANTs antigos). Os DADOS voltam do backup:
--   docker exec -i api-db pg_restore --data-only --single-transaction -U "$POSTGRES_USER" -d "$POSTGRES_DB" < plano05-C-3-tabelas-<data>.dump
-- (o dump é `pg_dump -Fc` só das 3 tabelas; o --data-only também reposiciona as sequences).
-- Esquema copiado de `pg_dump -s` do api-db em 20/10/2026. `copia` precisa de SELECT para a cópia diária continuar completa.
begin;
set local lock_timeout = '5s';
create table public.bling_tokens (
    id integer not null,
    access_token text not null,
    refresh_token text not null,
    expires_at timestamp with time zone not null,
    client_id text not null,
    client_secret text not null,
    created_at timestamp with time zone default now(),
    updated_at timestamp with time zone default now()
);
create sequence public.bling_tokens_id_seq as integer start with 1 increment by 1 no minvalue no maxvalue cache 1;
alter sequence public.bling_tokens_id_seq owned by public.bling_tokens.id;
alter table only public.bling_tokens alter column id set default nextval('public.bling_tokens_id_seq'::regclass);
alter table only public.bling_tokens add constraint bling_tokens_pkey primary key (id);

create table public.estoque_do_site_estado (
    chave text not null,
    valor jsonb not null,
    atualizado_em timestamp with time zone default now() not null
);
comment on table public.estoque_do_site_estado is 'Estado da edge estoque-do-site: token do Shopify e mapa SKU->id do Bling. RLS sem policies: so o service role le.';
alter table only public.estoque_do_site_estado add constraint estoque_do_site_estado_pkey primary key (chave);

create table public.vessel_envios_ao_meta (
    id bigint not null,
    pedido_id bigint not null,
    evento text not null,
    event_id text not null,
    enviado_em timestamp with time zone default now() not null,
    resposta text
);
comment on table public.vessel_envios_ao_meta is 'O que ja foi contado ao Meta, para nao contar duas vezes. A trava e o indice unico por (event_id, evento) — e o event_id e o numero do pedido do Bling, que nunca muda. Ainda nao ha robo escrevendo aqui; a T08 escreve.';
create sequence public.vessel_envios_ao_meta_id_seq start with 1 increment by 1 no minvalue no maxvalue cache 1;
alter sequence public.vessel_envios_ao_meta_id_seq owned by public.vessel_envios_ao_meta.id;
alter table only public.vessel_envios_ao_meta alter column id set default nextval('public.vessel_envios_ao_meta_id_seq'::regclass);
alter table only public.vessel_envios_ao_meta add constraint vessel_envios_ao_meta_pkey primary key (id);
create unique index vessel_envios_ao_meta_idx on public.vessel_envios_ao_meta using btree (event_id, evento);
alter table only public.vessel_envios_ao_meta
    add constraint vessel_envios_ao_meta_pedido_id_fkey foreign key (pedido_id) references public.vessel_pedidos(id) on delete cascade;

-- dono original (api_app) e o acesso da cópia diária
alter table public.bling_tokens owner to api_app;
alter table public.estoque_do_site_estado owner to api_app;
alter table public.vessel_envios_ao_meta owner to api_app;
alter sequence public.bling_tokens_id_seq owner to api_app;
alter sequence public.vessel_envios_ao_meta_id_seq owner to api_app;
grant select on public.bling_tokens, public.estoque_do_site_estado, public.vessel_envios_ao_meta to copia;
commit;
