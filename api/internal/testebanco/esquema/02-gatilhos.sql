-- GERADO por gerar-gatilhos.mjs a partir do levantamento de produção (02-funções.csv, 03-triggers.csv).
-- NÃO EDITE À MÃO: rode o script de novo. Corpos verbatim de produção; orientação dos gatilhos das migrations.
-- Tabelas: access_requests, account_insights, accounts, acessos_conexoes, acessos_config, acessos_dispositivos, acessos_drive_marcas, acessos_drive_overrides, acessos_drive_setores, acessos_log, acessos_organizacoes, acessos_patrimonio_historico, acessos_perfis, acessos_pessoas, acessos_recursos, acessos_setores, acessos_termos, acessos_vinculos, ad_insights_hora, ads, audit_log, bling_lojas, campaign_adsets, campaign_filters, campaign_insights, campaign_insights_hora, campaigns, canais_grupos, canais_grupos_membros, content_snapshots, daily_snapshots, data_integrity_checks, engagement_snapshots, equipes, equipes_membros, equipes_permissoes, fabrica_marcas, followers_leituras, frota_uso, frota_veiculos, gt_ad_analises, gt_budget_analises, gt_campanhas_rascunho, gt_config_metricas, gt_fila_decisoes, gt_objetivo_interacao, gt_ponderada_config, gt_ponderada_config_log, gt_problemas_meta, ia_execucoes, interesses_sugeridos, patrimonio_bens, patrimonio_categorias, patrimonio_comodos, patrimonio_config, patrimonio_empresas, patrimonio_locais, patrimonio_log, patrimonio_posse, patrimonio_tipos, perfil_visitas_hora, profiles, push_preferencias, push_subs, social_metas, visitas_perfil_dia
-- Funções (27): bem_de_veiculo_segue_a_frota, conta_ativa, criar_pessoa_rapida, criar_setor_rapido, equipes_toca_atualizado, espelhar_grupo_do_canal, espelhar_rename_do_grupo, frota_aceite_imutavel, frota_espelha_responsavel_no_bem, frota_espelha_situacao_no_bem, frota_fechar_posse_orfa, frota_uso_enfileirar_pdf, gt_rascunho_toca_updated_at, guard_profiles, impedir_autopromocao, is_acessos_admin, is_frota_admin, is_patrimonio_admin, is_superadmin, patrimonio_espelha_responsavel_no_veiculo, patrimonio_espelha_situacao_no_veiculo, patrimonio_traduz_situacao_para_frota, pessoas_para_escolher, pode_cadastrar_pessoa_rapida, setores_para_escolher, sincronizar_carro_e_bem, situacao_do_bem_pelo_veiculo
set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.bem_de_veiculo_segue_a_frota()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_situacao_do_carro text;
  v_alvo text;
begin
  if new.situacao is not distinct from old.situacao then return new; end if;

  select v.situacao into v_situacao_do_carro
    from public.frota_veiculos v where v.bem_id = new.id;

  if v_situacao_do_carro is null then return new; end if;

  v_alvo := public.situacao_do_bem_pelo_veiculo(v_situacao_do_carro);
  if v_alvo is null then return new; end if;

  new.situacao := v_alvo;
  return new;
end;
$function$;

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

CREATE OR REPLACE FUNCTION public.criar_pessoa_rapida(p_nome text, p_cargo text DEFAULT NULL::text, p_marca_id uuid DEFAULT NULL::uuid, p_setor_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, nome text, status text, cargo text, profile_id uuid, ja_existia boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_nome   text := btrim(coalesce(p_nome, ''));
  v_cargo  text := nullif(btrim(coalesce(p_cargo, '')), '');
  v_achada public.acessos_pessoas%rowtype;
begin
  if not public.pode_cadastrar_pessoa_rapida() then
    raise exception 'Sem acesso para cadastrar colaborador' using errcode = '42501';
  end if;
  if v_nome = '' then
    raise exception 'Digite o nome antes de criar.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('pessoa-rapida:' || lower(v_nome)));

  select * into v_achada
    from public.acessos_pessoas p
   where lower(btrim(p.nome)) = lower(v_nome)
   limit 1;

  if found then
    return query select v_achada.id, v_achada.nome, v_achada.status,
                        v_achada.cargo, v_achada.profile_id, true;
    return;
  end if;

  return query
    insert into public.acessos_pessoas (nome, cargo, marca_id, setor_id)
    values (v_nome, v_cargo, p_marca_id, p_setor_id)
    returning acessos_pessoas.id, acessos_pessoas.nome, acessos_pessoas.status,
              acessos_pessoas.cargo, acessos_pessoas.profile_id, false;
end;
$function$;

CREATE OR REPLACE FUNCTION public.criar_setor_rapido(p_nome text)
 RETURNS TABLE(id uuid, nome text, ja_existia boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_nome   text := btrim(coalesce(p_nome, ''));
  v_achado public.acessos_setores%rowtype;
begin
  if not public.pode_cadastrar_pessoa_rapida() then
    raise exception 'Sem acesso para cadastrar setor' using errcode = '42501';
  end if;
  if v_nome = '' then
    raise exception 'Digite o nome antes de criar.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('setor-rapido:' || lower(v_nome)));

  select * into v_achado
    from public.acessos_setores s
   where lower(btrim(s.nome)) = lower(v_nome)
   limit 1;

  if found then
    return query select v_achado.id, v_achado.nome, true;
    return;
  end if;

  return query
    insert into public.acessos_setores (nome, ordem)
    values (v_nome, coalesce((select max(ordem) from public.acessos_setores), 0) + 1)
    returning acessos_setores.id, acessos_setores.nome, false;
end;
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

CREATE OR REPLACE FUNCTION public.frota_aceite_imutavel()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  nascendo boolean := (tg_op = 'INSERT') or (old.aceite_em is null);
begin
  if tg_op = 'UPDATE' and old.aceite_em is not null and (
       new.aceite_em             is distinct from old.aceite_em
    or new.aceite_por            is distinct from old.aceite_por
    or new.aceite_nome           is distinct from old.aceite_nome
    or new.aceite_rabisco        is distinct from old.aceite_rabisco
    or new.aceite_checklist_id   is distinct from old.aceite_checklist_id
    or new.aceite_checklist_hash is distinct from old.aceite_checklist_hash) then
    raise exception 'O aceite de retirada já foi assinado e não pode ser alterado.'
      using errcode = 'check_violation';
  end if;

  if new.aceite_em is not null and nascendo then
    if auth.uid() is null then
      raise exception 'Para assinar o aceite de retirada é preciso estar logado.'
        using errcode = 'check_violation';
    end if;
    new.aceite_por := auth.uid();
    new.aceite_em := now();
  end if;

  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.frota_espelha_responsavel_no_bem()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.bem_id is null or new.pessoa_id is not distinct from old.pessoa_id then
    return new;
  end if;
  update public.patrimonio_bens
     set pessoa_id = new.pessoa_id
   where id = new.bem_id
     and pessoa_id is distinct from new.pessoa_id;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.frota_espelha_situacao_no_bem()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_alvo text;
begin
  if new.bem_id is null then return new; end if;

  if tg_op = 'UPDATE'
     and new.situacao is not distinct from old.situacao
     and new.bem_id  is not distinct from old.bem_id then
    return new;
  end if;

  v_alvo := public.situacao_do_bem_pelo_veiculo(new.situacao);
  if v_alvo is null then return new; end if;

  update public.patrimonio_bens
     set situacao = v_alvo, atualizado_em = now()
   where id = new.bem_id
     and situacao is distinct from v_alvo;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.frota_fechar_posse_orfa()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- Dispara só quando pessoa_id acabou de virar nulo (a condição do gatilho,
  -- abaixo). Fecha qualquer posse aberta deste veículo — não há o que reabrir
  -- aqui, só evitar a combinação proibida (sem dono fixo + posse aberta).
  update public.frota_uso
     set volta_em = now()
   where veiculo_id = new.id
     and tipo = 'posse'
     and volta_em is null;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.frota_uso_enfileirar_pdf()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.aceite_em is null then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.aceite_em is not null then
    return null;
  end if;

  begin
    insert into public.frota_uso_pdf(uso_id) values (new.id)
    on conflict (uso_id) do nothing;
  exception when others then
    raise warning 'Frota: nao consegui por o aceite % na fila do PDF (%). O aceite foi gravado assim mesmo.',
      new.id, sqlerrm;
  end;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.gt_rascunho_toca_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end $function$;

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

CREATE OR REPLACE FUNCTION public.patrimonio_espelha_responsavel_no_veiculo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.pessoa_id is not distinct from old.pessoa_id then return new; end if;
  update public.frota_veiculos
     set pessoa_id = new.pessoa_id
   where bem_id = new.id
     and pessoa_id is distinct from new.pessoa_id;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.patrimonio_espelha_situacao_no_veiculo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  equivalente text;
begin
  if new.situacao is not distinct from old.situacao then return new; end if;
  equivalente := public.patrimonio_traduz_situacao_para_frota(new.situacao);
  if equivalente is null then return new; end if;
  update public.frota_veiculos
     set situacao = equivalente
   where bem_id = new.id
     and situacao is distinct from equivalente;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.patrimonio_traduz_situacao_para_frota(s text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case s
    when 'em_uso'        then 'ativo'
    when 'em_estoque'    then 'inativo'
    when 'em_manutencao' then 'em_manutencao'
    when 'baixado'       then 'alienado'
    else null
  end;
$function$;

CREATE OR REPLACE FUNCTION public.pessoas_para_escolher()
 RETURNS TABLE(id uuid, nome text, status text, cargo text, profile_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.pode_cadastrar_pessoa_rapida() then
    raise exception 'Sem acesso à lista de colaboradores' using errcode = '42501';
  end if;
  return query
    select p.id, p.nome, p.status, p.cargo, p.profile_id
      from public.acessos_pessoas p
     order by p.nome;
end;
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

CREATE OR REPLACE FUNCTION public.setores_para_escolher()
 RETURNS TABLE(id uuid, nome text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.pode_cadastrar_pessoa_rapida() then
    raise exception 'Sem acesso à lista de setores' using errcode = '42501';
  end if;
  return query
    select s.id, s.nome from public.acessos_setores s order by s.ordem, s.nome;
end;
$function$;

CREATE OR REPLACE FUNCTION public.sincronizar_carro_e_bem(p_carro_id uuid DEFAULT NULL::uuid, p_bem_id uuid DEFAULT NULL::uuid, p_placa text DEFAULT NULL::text, p_etiqueta integer DEFAULT NULL::integer, p_nome text DEFAULT NULL::text, p_marca text DEFAULT NULL::text, p_valor_centavos bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_carro       public.frota_veiculos%rowtype;
  v_bem         public.patrimonio_bens%rowtype;
  v_cat         uuid;
  v_placa       text;
  v_outro       uuid;
  v_criou_carro boolean := false;
  v_criou_bem   boolean := false;
  v_fez         text;
begin
  if not (public.is_frota_admin() or public.is_patrimonio_admin()) then
    raise exception 'Você não pode cadastrar veículo nem item. Peça a quem administra.'
      using errcode = 'check_violation';
  end if;

  select id into v_cat from public.patrimonio_categorias
   where nome ilike '%ve%cul%' order by nome limit 1;

  v_placa := nullif(upper(regexp_replace(coalesce(p_placa, ''), '[^A-Za-z0-9]', '', 'g')), '');

  if p_carro_id is not null then
    select * into v_carro from public.frota_veiculos where id = p_carro_id;
    if not found then
      raise exception 'O veículo informado não existe mais. Recarregue a tela.'
        using errcode = 'check_violation';
    end if;
  elsif v_placa is not null then
    select * into v_carro from public.frota_veiculos where placa = v_placa;
    if not found then
      if coalesce(btrim(p_nome), '') = '' then
        raise exception 'Pra criar o veículo eu preciso do nome dele.'
          using errcode = 'check_violation';
      end if;
      insert into public.frota_veiculos (placa, nome, marca, fipe_centavos, situacao)
      values (v_placa, btrim(p_nome),
              nullif(btrim(coalesce(p_marca, '')), ''),
              p_valor_centavos, 'ativo')
      returning * into v_carro;
      v_criou_carro := true;
    end if;
  else
    raise exception 'Preciso da placa pra achar ou criar o veículo.'
      using errcode = 'check_violation';
  end if;

  if p_bem_id is not null then
    select * into v_bem from public.patrimonio_bens where id = p_bem_id;
    if not found then
      raise exception 'O item informado não existe mais. Recarregue a tela.'
        using errcode = 'check_violation';
    end if;
  elsif p_etiqueta is not null then
    select * into v_bem from public.patrimonio_bens where numero = p_etiqueta;
    if not found then
      if v_cat is null then
        raise exception 'Não achei a categoria "Veículos" no Patrimônio. Crie a categoria antes.'
          using errcode = 'check_violation';
      end if;
      insert into public.patrimonio_bens (nome, numero, marca, valor_centavos, categoria_id)
      values (coalesce(nullif(btrim(coalesce(p_nome, '')), ''), v_carro.nome),
              p_etiqueta,
              nullif(btrim(coalesce(p_marca, '')), ''),
              p_valor_centavos, v_cat)
      returning * into v_bem;
      v_criou_bem := true;
    end if;
  else
    raise exception 'Preciso do nº de patrimônio pra achar ou criar o item.'
      using errcode = 'check_violation';
  end if;

  -- A TRAVA DE CATEGORIA (050). So para bem ACHADO: o criado ja nasceu certo.
  if not v_criou_bem and v_bem.categoria_id is distinct from v_cat then
    raise exception
      'O nº de patrimônio % é "%", que não é um veículo. Confira o número do adesivo.',
      v_bem.numero, v_bem.nome using errcode = 'check_violation';
  end if;

  if v_carro.bem_id is not null and v_carro.bem_id <> v_bem.id then
    raise exception
      'O veículo % já está ligado a outro item do Patrimônio. Desfaça a ligação antiga primeiro.',
      v_carro.placa using errcode = 'check_violation';
  end if;

  select id into v_outro from public.frota_veiculos
   where bem_id = v_bem.id and id <> v_carro.id limit 1;
  if v_outro is not null then
    raise exception
      'O nº de patrimônio % já pertence a outro veículo da Frota. Desfaça a ligação antiga primeiro.',
      v_bem.numero using errcode = 'check_violation';
  end if;

  if v_carro.bem_id is null then
    update public.frota_veiculos
       set bem_id = v_bem.id, atualizado_em = now()
     where id = v_carro.id;
    v_fez := 'ligou';
  else
    v_fez := 'ja_ligados';
  end if;

  if v_criou_carro and v_criou_bem then v_fez := 'criou_os_dois';
  elsif v_criou_carro then v_fez := 'criou_carro';
  elsif v_criou_bem then v_fez := 'criou_bem';
  end if;

  return jsonb_build_object(
    'carro_id', v_carro.id,
    'bem_id',   v_bem.id,
    'placa',    v_carro.placa,
    'etiqueta', v_bem.numero,
    'fez',      v_fez);
end;
$function$;

CREATE OR REPLACE FUNCTION public.situacao_do_bem_pelo_veiculo(p_situacao text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select case p_situacao
    when 'ativo'         then 'em_uso'
    when 'inativo'       then 'em_estoque'
    when 'em_manutencao' then 'em_manutencao'
    when 'alienado'      then 'baixado'
    else null
  end;
$function$;

create trigger trg_espelhar_grupo_do_canal BEFORE UPDATE OF grupo_id, grupo or INSERT on public.bling_lojas for each row EXECUTE FUNCTION espelhar_grupo_do_canal();
create trigger trg_espelhar_rename_do_grupo AFTER UPDATE on public.canais_grupos for each row EXECUTE FUNCTION espelhar_rename_do_grupo();
create trigger equipes_atualizado BEFORE UPDATE on public.equipes for each row EXECUTE FUNCTION equipes_toca_atualizado();
create trigger trg_frota_aceite_imutavel BEFORE INSERT or UPDATE on public.frota_uso for each row EXECUTE FUNCTION frota_aceite_imutavel();
create trigger trg_frota_uso_enfileirar_pdf AFTER UPDATE OF aceite_em or INSERT on public.frota_uso for each row EXECUTE FUNCTION frota_uso_enfileirar_pdf();
create trigger trg_frota_espelha_responsavel AFTER UPDATE OF pessoa_id on public.frota_veiculos for each row EXECUTE FUNCTION frota_espelha_responsavel_no_bem();
create trigger trg_frota_espelha_situacao AFTER UPDATE OF situacao on public.frota_veiculos for each row EXECUTE FUNCTION frota_espelha_situacao_no_bem();
create trigger trg_frota_espelha_situacao_no_bem AFTER INSERT or UPDATE on public.frota_veiculos for each row EXECUTE FUNCTION frota_espelha_situacao_no_bem();
create trigger trg_frota_fechar_posse_orfa AFTER UPDATE OF pessoa_id on public.frota_veiculos for each row when (new.pessoa_id is null) EXECUTE FUNCTION frota_fechar_posse_orfa();
create trigger gt_rascunho_updated_at BEFORE UPDATE on public.gt_campanhas_rascunho for each row EXECUTE FUNCTION gt_rascunho_toca_updated_at();
create trigger trg_bem_de_veiculo_segue_a_frota BEFORE UPDATE on public.patrimonio_bens for each row EXECUTE FUNCTION bem_de_veiculo_segue_a_frota();
create trigger trg_patrimonio_espelha_responsavel AFTER UPDATE OF pessoa_id on public.patrimonio_bens for each row EXECUTE FUNCTION patrimonio_espelha_responsavel_no_veiculo();
create trigger trg_patrimonio_espelha_situacao AFTER UPDATE OF situacao on public.patrimonio_bens for each row EXECUTE FUNCTION patrimonio_espelha_situacao_no_veiculo();
create trigger trg_guard_profiles BEFORE UPDATE on public.profiles for each row EXECUTE FUNCTION guard_profiles();
create trigger trg_impedir_autopromocao BEFORE UPDATE on public.profiles for each row EXECUTE FUNCTION impedir_autopromocao();
