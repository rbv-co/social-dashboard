


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;


CREATE TABLE public.bling_tokens (
    id integer NOT NULL,
    access_token text NOT NULL,
    refresh_token text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    client_id text NOT NULL,
    client_secret text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);



CREATE SEQUENCE public.bling_tokens_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.bling_tokens_id_seq OWNED BY public.bling_tokens.id;



CREATE TABLE public.estoque_do_site_estado (
    chave text NOT NULL,
    valor jsonb NOT NULL,
    atualizado_em timestamp with time zone DEFAULT now() NOT NULL
);



COMMENT ON TABLE public.estoque_do_site_estado IS 'Estado da edge estoque-do-site: token do Shopify e mapa SKU->id do Bling. RLS sem policies: so o service role le.';



CREATE TABLE public.vessel_envios_ao_meta (
    id bigint NOT NULL,
    pedido_id bigint NOT NULL,
    evento text NOT NULL,
    event_id text NOT NULL,
    enviado_em timestamp with time zone DEFAULT now() NOT NULL,
    resposta text
);



COMMENT ON TABLE public.vessel_envios_ao_meta IS 'O que ja foi contado ao Meta, para nao contar duas vezes. A trava e o indice unico por (event_id, evento) — e o event_id e o numero do pedido do Bling, que nunca muda. Ainda nao ha robo escrevendo aqui; a T08 escreve.';



CREATE SEQUENCE public.vessel_envios_ao_meta_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.vessel_envios_ao_meta_id_seq OWNED BY public.vessel_envios_ao_meta.id;



ALTER TABLE ONLY public.bling_tokens ALTER COLUMN id SET DEFAULT nextval('public.bling_tokens_id_seq'::regclass);



ALTER TABLE ONLY public.vessel_envios_ao_meta ALTER COLUMN id SET DEFAULT nextval('public.vessel_envios_ao_meta_id_seq'::regclass);



ALTER TABLE ONLY public.bling_tokens
    ADD CONSTRAINT bling_tokens_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.estoque_do_site_estado
    ADD CONSTRAINT estoque_do_site_estado_pkey PRIMARY KEY (chave);



ALTER TABLE ONLY public.vessel_envios_ao_meta
    ADD CONSTRAINT vessel_envios_ao_meta_pkey PRIMARY KEY (id);



CREATE UNIQUE INDEX vessel_envios_ao_meta_idx ON public.vessel_envios_ao_meta USING btree (event_id, evento);



ALTER TABLE ONLY public.vessel_envios_ao_meta
    ADD CONSTRAINT vessel_envios_ao_meta_pedido_id_fkey FOREIGN KEY (pedido_id) REFERENCES public.vessel_pedidos(id) ON DELETE CASCADE;




