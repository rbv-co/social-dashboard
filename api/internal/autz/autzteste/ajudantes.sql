-- GERADO por extrair-ajudantes.mjs a partir do levantamento de produção (02-funções.csv).
-- NÃO EDITE À MÃO: rode o script de novo. Corpos verbatim de produção.
-- Funções (25): conta_ativa, get_my_role, is_acessos_admin, is_frota_admin, is_patrimonio_admin, is_superadmin, is_vessel_admin, is_vessel_atendimentos, is_vessel_atendimentos_editar, is_vessel_leads, meus_vinculos, minhas_equipes, pode_aprovar_frota, pode_cadastrar_pessoa_rapida, pode_ver_bem, pode_ver_canal, pode_ver_conta, pode_ver_equipe, pode_ver_estoque, pode_ver_grupo, pode_ver_vendas, sou_gestor_da_equipe, superadmin_pela_ficha, tenho_papel_na_equipe, vessel_pode
set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.conta_ativa()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(
    (select not coalesce(p.disabled, false) from public.profiles p where p.id = auth.uid()),
    true);
$function$;

CREATE OR REPLACE FUNCTION public.get_my_role()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case when public.conta_ativa()
    then (select role from public.profiles where id = auth.uid())
    else null end;
$function$;

CREATE OR REPLACE FUNCTION public.is_acessos_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.conta_ativa() and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (p.role = 'admin' or 'acessos' = any(coalesce(p.features, array[]::text[])))
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_frota_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.conta_ativa() and coalesce(
    (select 'frota' = any(p.features) or p.is_superadmin
       from public.profiles p where p.id = auth.uid()),
    false);
$function$;

CREATE OR REPLACE FUNCTION public.is_patrimonio_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.conta_ativa() and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (p.role = 'admin' or 'patrimonio' = any(coalesce(p.features, array[]::text[])))
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_superadmin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.conta_ativa() and coalesce(
    (select email from public.profiles where id = auth.uid())
      in ('erick@rbvcompany.com','gabriel.gertrudes@rbvcompany.com','breno@rbvcompany.com'),
    false);
$function$;

CREATE OR REPLACE FUNCTION public.is_vessel_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.conta_ativa() and coalesce(
    (select 'autenticidade' = any(p.features) or p.is_superadmin
       from public.profiles p where p.id = auth.uid()),
    false);
$function$;

CREATE OR REPLACE FUNCTION public.is_vessel_atendimentos()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.conta_ativa() and coalesce(
    (select p.is_superadmin
         or exists (select 1 from unnest(coalesce(p.features, '{}'::text[])) f
                     where f = 'atendimentos' or left(f, 13) = 'atendimentos.')
       from public.profiles p where p.id = auth.uid()),
    false);
$function$;

CREATE OR REPLACE FUNCTION public.is_vessel_atendimentos_editar()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.is_vessel_atendimentos()
     and coalesce(
       (select p.is_superadmin
            or exists (
                 select 1
                   from jsonb_each(case when jsonb_typeof(p.permissions) = 'object'
                                        then p.permissions else '{}'::jsonb end) e(k, v)
                  where (e.k = 'atendimentos' or left(e.k, 13) = 'atendimentos.')
                    and jsonb_typeof(e.v) = 'array'
                    and e.v ? 'editar')
          from public.profiles p where p.id = auth.uid()),
       false);
$function$;

CREATE OR REPLACE FUNCTION public.is_vessel_leads()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(
    (select 'meta.leads' = any(p.features) or p.is_superadmin
       from public.profiles p where p.id = auth.uid()),
    false);
$function$;

CREATE OR REPLACE FUNCTION public.meus_vinculos()
 RETURNS TABLE(equipe_id uuid, papel text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select m.equipe_id, m.papel
    from public.equipes_membros m
   where m.profile_id = auth.uid()
  union
  select e.id, 'supervisora'
    from public.canais_grupos_membros gm
    join public.bling_lojas bl on bl.grupo_id = gm.grupo_id
    join public.equipes     e  on e.canal_loja_id = bl.loja_id
   where gm.profile_id = auth.uid()
     and gm.papel = 'supervisora';
$function$;

CREATE OR REPLACE FUNCTION public.minhas_equipes()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select equipe_id from public.meus_vinculos();
$function$;

CREATE OR REPLACE FUNCTION public.pode_aprovar_frota()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.conta_ativa() and coalesce(
    (select 'frota.aprovar' = any(p.features) or p.is_superadmin
       from public.profiles p where p.id = auth.uid()),
    false);
$function$;

CREATE OR REPLACE FUNCTION public.pode_cadastrar_pessoa_rapida()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(public.is_acessos_admin(), false)
      or coalesce(public.is_patrimonio_admin(), false)
      or coalesce(public.is_frota_admin(), false);
$function$;

CREATE OR REPLACE FUNCTION public.pode_ver_bem(p_local uuid, p_pessoa uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.conta_ativa() and (
    coalesce((select is_superadmin from public.profiles where id = auth.uid()), false)
    or coalesce((select not escopo_por_equipe from public.profiles where id = auth.uid()), false)
    or exists (select 1 from public.equipes e
                where e.local_id = p_local
                  and e.id in (select public.minhas_equipes()))
    or exists (select 1 from public.acessos_pessoas ap
                where ap.id = p_pessoa and ap.profile_id = auth.uid()));
$function$;

CREATE OR REPLACE FUNCTION public.pode_ver_canal(p_canal bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.conta_ativa() and (
    coalesce((select is_superadmin from public.profiles where id = auth.uid()), false)
    or coalesce((select not escopo_por_equipe from public.profiles where id = auth.uid()), false)
    or exists (select 1 from public.equipes e
                where e.canal_loja_id = p_canal
                  and e.id in (select public.minhas_equipes()))
    or exists (select 1
                 from public.canais_grupos_membros gm
                 join public.bling_lojas alvo on alvo.grupo_id = gm.grupo_id
                where gm.profile_id = auth.uid()
                  and gm.papel = 'supervisora'
                  and alvo.loja_id = p_canal));
$function$;

CREATE OR REPLACE FUNCTION public.pode_ver_conta(p_conta text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.conta_ativa() and exists (
    select 1 from public.profiles p
     where p.id = auth.uid()
       and (p.role = 'admin' or p.is_superadmin
            or p.allowed_accounts is null
            or p_conta is null
            or p_conta = any (p.allowed_accounts::text[]))
  );
$function$;

CREATE OR REPLACE FUNCTION public.pode_ver_equipe(p_equipe uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.conta_ativa() and (
    coalesce((select is_superadmin from public.profiles where id = auth.uid()), false)
    or coalesce((select not escopo_por_equipe from public.profiles where id = auth.uid()), false)
    or (p_equipe is not null and p_equipe in (select public.minhas_equipes())));
$function$;

CREATE OR REPLACE FUNCTION public.pode_ver_estoque(p_deposito bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.conta_ativa() and (
    coalesce((select is_superadmin from public.profiles where id = auth.uid()), false)
    or coalesce((select not escopo_por_equipe from public.profiles where id = auth.uid()), false)
    or exists (
      select 1 from public.equipes e
       where e.deposito_id = p_deposito
         and (public.tenho_papel_na_equipe(e.id, array['supervisora','gestor'])
              or exists (select 1 from public.equipes_permissoes p
                          where p.equipe_id = e.id and p.profile_id = auth.uid() and p.chave = 'estoque'
                            and exists (select 1 from public.equipes_membros m
                                         where m.equipe_id = e.id and m.profile_id = auth.uid())))));
$function$;

CREATE OR REPLACE FUNCTION public.pode_ver_grupo(p_grupo uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.conta_ativa() and (
    coalesce((select is_superadmin from public.profiles where id = auth.uid()), false)
    or coalesce((select not escopo_por_equipe from public.profiles where id = auth.uid()), false)
    or exists (select 1 from public.canais_grupos_membros gm
                where gm.grupo_id = p_grupo and gm.profile_id = auth.uid()));
$function$;

CREATE OR REPLACE FUNCTION public.pode_ver_vendas()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.conta_ativa() and coalesce(
    (select p.role = 'admin' or p.is_superadmin or 'sales' = any(p.features)
       from public.profiles p where p.id = auth.uid()),
    false);
$function$;

CREATE OR REPLACE FUNCTION public.sou_gestor_da_equipe(p_equipe uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((select is_superadmin from public.profiles where id = auth.uid()), false)
      or public.tenho_papel_na_equipe(p_equipe, array['gestor']);
$function$;

CREATE OR REPLACE FUNCTION public.superadmin_pela_ficha()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((select p.is_superadmin from public.profiles p where p.id = auth.uid()), false);
$function$;

CREATE OR REPLACE FUNCTION public.tenho_papel_na_equipe(p_equipe uuid, p_papeis text[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from public.meus_vinculos() v
                  where v.equipe_id = p_equipe and v.papel = any(p_papeis));
$function$;

CREATE OR REPLACE FUNCTION public.vessel_pode(p_ferramenta text, p_nivel text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- A LISTA FECHADA: as chaves do Comercial Vessel no catálogo que têm tela
  -- chamando o banco, e os dois níveis que o catálogo oferece a elas.
  if p_ferramenta is null or p_ferramenta not in (
       'atendimentos', 'atendimentos.beauty-sessions', 'atendimentos.private-edit',
       'atendimentos.stylist-circle', 'atendimentos.material-grafico',
       'atendimentos.pracas', 'atendimentos.edicoes') then
    raise exception 'vessel_pode: ferramenta desconhecida (%)', p_ferramenta using errcode = '22023';
  end if;
  if p_nivel is null or p_nivel not in ('ver', 'editar') then
    raise exception 'vessel_pode: nivel desconhecido (%)', p_nivel using errcode = '22023';
  end if;
  if p_ferramenta = 'atendimentos.material-grafico' and p_nivel <> 'ver' then
    raise exception 'vessel_pode: o Material Grafico so tem ver' using errcode = '22023';
  end if;
  -- ⚠️ A ARMADILHA DO NULO: o `coalesce` envolve a subconsulta INTEIRA.
  return public.conta_ativa() and coalesce(
    (select coalesce(p.is_superadmin, false)
         or (jsonb_typeof(p.permissions) = 'object'
             and jsonb_typeof(p.permissions -> p_ferramenta) = 'array'
             and (p.permissions -> p_ferramenta) ? 'ver'
             and (p_nivel = 'ver' or (p.permissions -> p_ferramenta) ? p_nivel))
       from public.profiles p where p.id = auth.uid()),
    false);
end;
$function$;
