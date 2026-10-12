-- GERADO por gerar-gatilhos.mjs a partir do levantamento de produção (02-funções.csv, 03-triggers.csv).
-- NÃO EDITE À MÃO: rode o script de novo. Corpos verbatim de produção.
-- Tabelas: access_requests, acessos_perfis, acessos_pessoas, audit_log, bling_lojas, canais_grupos, canais_grupos_membros, data_integrity_checks, equipes, equipes_membros, equipes_permissoes, ia_execucoes, profiles, push_preferencias, push_subs
-- Funções (7): conta_ativa, equipes_toca_atualizado, espelhar_grupo_do_canal, espelhar_rename_do_grupo, guard_profiles, impedir_autopromocao, is_superadmin
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

CREATE OR REPLACE FUNCTION public.equipes_toca_atualizado()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin new.atualizado_em = now(); return new; end $function$;

CREATE OR REPLACE FUNCTION public.espelhar_grupo_do_canal()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_texto text;
  v_id    uuid;
  v_nome  text;
begin
  -- SENTIDO 1: o apontamento manda no texto (o que já valia desde 21/08).
  if (tg_op = 'INSERT'  and new.grupo_id is not null)
  or (tg_op = 'UPDATE'  and new.grupo_id is distinct from old.grupo_id) then
    new.grupo := (select g.nome from public.canais_grupos g where g.id = new.grupo_id);
    return new;
  end if;

  -- SENTIDO 2: o texto passa a achar (ou criar) o apontamento.
  if (tg_op = 'INSERT' and new.grupo is not null)
  or (tg_op = 'UPDATE' and new.grupo is distinct from old.grupo) then

    v_texto := nullif(btrim(coalesce(new.grupo, '')), '');

    -- Apagar o texto é dizer "este canal não tem grupo". O apontamento vai junto.
    if v_texto is null then
      new.grupo    := null;
      new.grupo_id := null;
      return new;
    end if;

    -- Mesma normalização do índice único e do mesmoGrupo() no JavaScript.
    select g.id, g.nome into v_id, v_nome
      from public.canais_grupos g
     where lower(btrim(g.nome)) = lower(v_texto)
     limit 1;

    -- Grupo que ainda não existe nasce aqui: a tela no ar só sabe escrever texto.
    if v_id is null then
      insert into public.canais_grupos (nome)
      values (v_texto)
      on conflict do nothing
      returning id, nome into v_id, v_nome;

      -- on conflict do nothing não devolve linha quando outra transação ganhou
      -- a corrida; ler de novo evita gravar apontamento nulo.
      if v_id is null then
        select g.id, g.nome into v_id, v_nome
          from public.canais_grupos g
         where lower(btrim(g.nome)) = lower(v_texto)
         limit 1;
      end if;
    end if;

    new.grupo_id := v_id;
    -- O texto volta canônico: quem digitou "varejo" fica com "Varejo".
    new.grupo := coalesce(v_nome, v_texto);
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.espelhar_rename_do_grupo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.nome is distinct from old.nome then
    update public.bling_lojas set grupo = new.nome where grupo_id = new.id;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.guard_profiles()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  mudou jsonb := '{}'::jsonb;
begin
  -- ── 1) O RASTRO ──────────────────────────────────────────────────────────
  -- Vem antes de tudo, inclusive do "contexto de servico: confia": robô que
  -- muda acesso de gente tambem precisa aparecer no registro.
  if new.is_superadmin is distinct from old.is_superadmin then
    mudou := mudou || jsonb_build_object('super_admin',
      jsonb_build_object('de', old.is_superadmin, 'para', new.is_superadmin));
  end if;
  if new.escopo_por_equipe is distinct from old.escopo_por_equipe then
    mudou := mudou || jsonb_build_object('trava_de_loja',
      jsonb_build_object('de', old.escopo_por_equipe, 'para', new.escopo_por_equipe));
  end if;
  if new.permissions is distinct from old.permissions then
    mudou := mudou || jsonb_build_object('permissoes',
      jsonb_build_object('de', old.permissions, 'para', new.permissions));
  end if;
  if new.permissions_excecao is distinct from old.permissions_excecao then
    mudou := mudou || jsonb_build_object('excecao',
      jsonb_build_object('de', old.permissions_excecao, 'para', new.permissions_excecao));
  end if;
  if new.allowed_accounts is distinct from old.allowed_accounts then
    mudou := mudou || jsonb_build_object('contas_de_anuncio',
      jsonb_build_object('de', to_jsonb(old.allowed_accounts), 'para', to_jsonb(new.allowed_accounts)));
  end if;
  if new.perfil_id is distinct from old.perfil_id then
    mudou := mudou || jsonb_build_object('perfil_de_acesso',
      jsonb_build_object('de', old.perfil_id, 'para', new.perfil_id));
  end if;
  if new.features is distinct from old.features then
    mudou := mudou || jsonb_build_object('features',
      jsonb_build_object('de', to_jsonb(old.features), 'para', to_jsonb(new.features)));
  end if;

  if mudou <> '{}'::jsonb then
    insert into public.audit_log(actor_id, actor_email, action, detail)
    values (
      auth.uid(),
      -- Sem login e robô: dizer isso com todas as letras vale mais do que uma
      -- coluna vazia, que se confunde com "nao consegui descobrir".
      coalesce((select email from public.profiles where id = auth.uid()), 'robo/servico'),
      'acesso_change',
      jsonb_build_object('target_id', old.id, 'target_email', old.email, 'mudou', mudou)
    );
  end if;

  -- ── 2) AS TRAVAS, exatamente como estavam ────────────────────────────────
  if auth.uid() is null then return new; end if;  -- contexto servidor/service: confia
  if old.email = 'erick@rbvcompany.com' and not public.is_superadmin() then
    raise exception 'Apenas o superadmin pode alterar o perfil do superadmin';
  end if;
  if new.role is distinct from old.role and not public.is_superadmin() then
    raise exception 'Apenas o superadmin pode alterar o cargo de usuarios';
  end if;
  if new.role is distinct from old.role then
    insert into public.audit_log(actor_id,actor_email,action,detail)
    values (auth.uid(), (select email from public.profiles where id=auth.uid()), 'role_change',
            jsonb_build_object('target_id', old.id, 'target_email', old.email, 'from', old.role, 'to', new.role));
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.impedir_autopromocao()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.id = auth.uid()
     and (new.is_superadmin is distinct from old.is_superadmin
          or new.role is distinct from old.role
          or new.escopo_por_equipe is distinct from old.escopo_por_equipe
          or new.permissions is distinct from old.permissions
          or new.allowed_accounts is distinct from old.allowed_accounts
          or new.perfil_id is distinct from old.perfil_id
          or new.permissions_excecao is distinct from old.permissions_excecao
          or new.features is distinct from old.features)
     and not public.is_superadmin()
  then
    raise exception 'Voce nao pode alterar o seu proprio acesso (permissoes, contas, perfil, cargo, super-admin ou limite de loja). Peca a um super-admin.'
      using errcode = '42501';
  end if;
  return new;
end;
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

create trigger trg_espelhar_grupo_do_canal BEFORE UPDATE or INSERT on public.bling_lojas for each row EXECUTE FUNCTION espelhar_grupo_do_canal();
create trigger trg_espelhar_rename_do_grupo AFTER UPDATE on public.canais_grupos for each row EXECUTE FUNCTION espelhar_rename_do_grupo();
create trigger equipes_atualizado BEFORE UPDATE on public.equipes for each row EXECUTE FUNCTION equipes_toca_atualizado();
create trigger trg_guard_profiles BEFORE UPDATE on public.profiles for each row EXECUTE FUNCTION guard_profiles();
create trigger trg_impedir_autopromocao BEFORE UPDATE on public.profiles for each row EXECUTE FUNCTION impedir_autopromocao();
