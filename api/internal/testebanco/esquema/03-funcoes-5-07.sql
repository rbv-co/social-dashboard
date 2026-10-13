-- VERBATIM de levantamento/02-funções.csv:1201-1208 e 1210-1286; o gatilho de 03-triggers.csv:26 com a
-- orientação da migration 2026-08-03-gt-rascunhos-de-campanha.sql (BEFORE UPDATE … FOR EACH ROW).
-- `create or replace trigger`: se o gerador um dia também emitir este gatilho em 02-gatilhos.sql
-- (que carrega antes), a recriação aqui é a mesma (Ruling 5.7-1).
CREATE OR REPLACE FUNCTION public.gt_rascunho_toca_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end $function$;

create or replace trigger gt_rascunho_updated_at BEFORE UPDATE on public.gt_campanhas_rascunho
  for each row EXECUTE FUNCTION gt_rascunho_toca_updated_at();

CREATE OR REPLACE FUNCTION public.gt_registrar_problemas(p_conta text, p_itens jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_quantos integer := 0;
  v_papel text := coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    ''
  );
begin
  if v_papel <> 'service_role' and not exists (
    select 1 from public.profiles p
     where p.id = auth.uid()
       and (p.role = 'admin' or 'meta.gestor' = any (p.features))
  ) then
    raise exception 'Sem permissao na Gestao de Trafego.';
  end if;

  if p_conta is null or p_conta = '' then
    raise exception 'Falta dizer de qual conta e a lista.';
  end if;

  with bruto as (
    select
      x.ad_id, x.codigo, x.campaign_id, x.conta_nome, x.campanha_nome,
      x.ad_nome, x.titulo, x.detalhe, x.nivel, coalesce(x.grave, false) as grave,
      row_number() over () as ordem
    from jsonb_to_recordset(coalesce(p_itens, '[]'::jsonb)) as x(
      ad_id text, codigo integer, campaign_id text, conta_nome text,
      campanha_nome text, ad_nome text, titulo text, detalhe text,
      nivel text, grave boolean
    )
    where x.ad_id is not null and x.codigo is not null
  ),
  entrada as (
    select distinct on (ad_id, codigo) *
      from bruto
     order by ad_id, codigo, ordem
  )
  insert into public.gt_problemas_meta as g (
    ad_id, codigo, account_id, campaign_id, conta_nome, campanha_nome,
    ad_nome, titulo, detalhe, nivel, grave, primeira_vez, ultima_vez, resolvido_em
  )
  select
    e.ad_id, e.codigo, p_conta, e.campaign_id, e.conta_nome, e.campanha_nome,
    e.ad_nome, e.titulo, e.detalhe, e.nivel, e.grave, now(), now(), null
  from entrada e
  on conflict (ad_id, codigo) do update set
    ultima_vez    = now(),
    resolvido_em  = null,
    account_id    = excluded.account_id,
    campaign_id   = coalesce(excluded.campaign_id, g.campaign_id),
    conta_nome    = coalesce(nullif(excluded.conta_nome, ''), g.conta_nome),
    campanha_nome = coalesce(nullif(excluded.campanha_nome, ''), g.campanha_nome),
    ad_nome       = coalesce(nullif(excluded.ad_nome, ''), g.ad_nome),
    titulo        = coalesce(nullif(excluded.titulo, ''), g.titulo),
    detalhe       = coalesce(nullif(excluded.detalhe, ''), g.detalhe),
    nivel         = coalesce(nullif(excluded.nivel, ''), g.nivel),
    grave         = excluded.grave;

  get diagnostics v_quantos = row_count;

  update public.gt_problemas_meta g
     set resolvido_em = now()
   where g.account_id = p_conta
     and g.resolvido_em is null
     and not exists (
       select 1
         from jsonb_to_recordset(coalesce(p_itens, '[]'::jsonb)) as x(ad_id text, codigo integer)
        where x.ad_id = g.ad_id and x.codigo = g.codigo
     );

  return v_quantos;
end $function$;
