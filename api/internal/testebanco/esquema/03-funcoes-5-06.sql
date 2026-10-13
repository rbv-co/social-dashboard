-- pode_ver_conta VERBATIM de levantamento/02-funções.csv:1914-1929 (a regra das 15 restritivas
-- so_contas_permitidas). Depois de 02-gatilhos.sql porque chama conta_ativa(). Se o gerador um dia
-- também a emitir, os dois `create or replace` são idênticos.
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
