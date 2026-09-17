-- A LISTA DE CLIENT ADVISORS, QUE SE MONTA SOZINHA
--
-- Antes: a Client Advisor escolhia um número de CA-01 a CA-20 num menu. Duas
-- podiam escolher o mesmo, e ninguém saberia — o número deixaria de identificar
-- uma pessoa.
--
-- Agora: ela diz só o nome, e o código sai daqui. Nome novo ganha código novo;
-- nome que já veio antes recebe o mesmo de sempre. A lista real vai existindo
-- conforme a loja usa, sem ninguém ter de cadastrar nada antes.
--
-- ⚠️ O NOME É COMPARADO SEM ACENTO E SEM MAIÚSCULA. "Ana Carolina",
-- "ana carolina" e "Ana Carolína" são a mesma pessoa; tratar como três daria
-- três códigos para uma pessoa só, e o show rate dela ficaria repartido em três.

create table if not exists public.vessel_client_advisors (
  id         bigserial primary key,
  codigo     text not null,
  nome       text not null,
  chave      text not null,           -- o nome sem acento e sem maiúscula
  loja       text,
  criado_em  timestamptz not null default now()
);

create unique index if not exists vessel_client_advisors_codigo_idx
  on public.vessel_client_advisors (codigo);
create unique index if not exists vessel_client_advisors_chave_idx
  on public.vessel_client_advisors (chave);

alter table public.vessel_client_advisors enable row level security;

comment on table public.vessel_client_advisors is
  'Quem atende, com o codigo que vai no convite. A lista se monta sozinha: nome '
  'novo no gerador de cartao ganha codigo novo. RLS ligada e SEM politica.';

-- `unaccent` é uma extensão que pode não estar ligada. Em vez de depender dela,
-- a troca é explícita — são poucas letras e não muda nunca.
create or replace function public.unaccent_simples(p text)
returns text
language sql
immutable
as $$
  select translate(coalesce(p, ''),
                   'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
                   'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC');
$$;

/** O nome reduzido ao que importa para comparar: sem acento, sem maiuscula. */
create or replace function public.vessel_chave_do_nome(p_nome text)
returns text
language sql
immutable
as $$
  select regexp_replace(
           lower(trim(unaccent_simples(coalesce(p_nome, '')))),
           '\s+', ' ', 'g');
$$;

/**
 * O código desta Client Advisor. Cria na primeira vez que o nome aparece.
 *
 * ⚠️ O código NUNCA muda depois de dado: ele já foi para dentro de convites que
 * estão no WhatsApp de clientes. Trocar faria os cartões antigos apontarem para
 * uma pessoa que não existe.
 */
create or replace function public.vessel_identificar_client_advisor(
  p_nome text, p_loja text default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_chave  text := public.vessel_chave_do_nome(p_nome);
  v_codigo text;
  v_n      int;
begin
  if length(v_chave) < 2 then
    return json_build_object('ok', false, 'erro', 'Escreva o seu nome.');
  end if;

  select codigo into v_codigo from public.vessel_client_advisors where chave = v_chave;
  if v_codigo is not null then
    -- A loja pode mudar (alguém cobrindo outra unidade); o código, não.
    update public.vessel_client_advisors
       set loja = coalesce(nullif(trim(p_loja), ''), loja)
     where chave = v_chave;
    return json_build_object('ok', true, 'codigo', v_codigo);
  end if;

  -- Teto de gente: sem ele, um robô que descubra o endereço criaria
  -- Client Advisors sem fim.
  select count(*) into v_n from public.vessel_client_advisors;
  if v_n >= 200 then
    return json_build_object('ok', false, 'erro', 'Fale com quem cuida do sistema.');
  end if;

  v_codigo := 'CA-' || lpad((v_n + 1)::text, 2, '0');
  insert into public.vessel_client_advisors (codigo, nome, chave, loja)
  values (v_codigo, trim(p_nome), v_chave, nullif(trim(p_loja), ''))
  on conflict (chave) do nothing;

  select codigo into v_codigo from public.vessel_client_advisors where chave = v_chave;
  return json_build_object('ok', true, 'codigo', v_codigo);
end;
$$;

-- ⚠️ `revoke from public` NAO FECHA anon: no Supabase os papeis anon e
-- authenticated recebem execute por privilegio padrao do schema, que e outra
-- concessao. Ja custou um buraco aqui em 16/09.
revoke all on function public.vessel_chave_do_nome(text) from public, anon, authenticated;
revoke all on function public.unaccent_simples(text) from public, anon, authenticated;
revoke all on function public.vessel_identificar_client_advisor(text, text) from public, anon, authenticated;
grant execute on function public.vessel_identificar_client_advisor(text, text) to anon, authenticated;
