-- VERBATIM de levantamento/02-funções.csv (gerado por fatia59.mjs, Plano 5.9 Task 1): conteudo_guarda_aprovacao
-- (:367-407), conteudo_aprovar_e_agendar (:178-223), conteudo_casar_na_mao (:224-289), conteudo_decidir (:290-321),
-- conteudo_decidir_casamento (:322-366), conteudo_ideia_virar_peca (:408-448), conteudo_reavisar (:449-474).
-- O gatilho de 03-triggers.csv:5 com a orientação da migration 2026-07-29-conteudo-01-fundacao.sql:164-167
-- (BEFORE UPDATE … FOR EACH ROW, sem OF nem WHEN). `create or replace trigger`: se o gerador também o emitir
-- em 02-gatilhos.sql (que carrega antes), a recriação aqui é a mesma (Rulings 5.7-1 e 5.9-1).
CREATE OR REPLACE FUNCTION public.conteudo_guarda_aprovacao()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  new.updated_at := now();

  -- Sem usuario (service_role, cron, robo) a guarda nao se aplica: quem chega
  -- por ali ja passou por outra porta.
  if auth.uid() is null then
    return new;
  end if;

  -- A guarda cobre TRES entradas, nao duas:
  --   aprovada / reprovada  — a decisao em si;
  --   agendada VINDO DE em_aprovacao — que e aprovar sem dizer que aprovou.
  --
  -- A terceira faltava. A anon key esta no bundle publico, entao qualquer
  -- pessoa com acesso a ferramenta podia mandar um PATCH direto levando a peca
  -- de 'em_aprovacao' para 'agendada' e pular a aprovacao inteira — sem erro,
  -- sem trilha, sem ninguem ler o conteudo.
  --
  -- Agendar vindo de 'aprovada' continua livre: ali a aprovacao ja aconteceu.
  if (
    (new.status in ('aprovada', 'reprovada') and old.status is distinct from new.status)
    or (new.status = 'agendada' and old.status = 'em_aprovacao')
  ) then
    if not exists (
      select 1 from public.profiles p
       where p.id = auth.uid()
         and (p.role = 'admin' or p.is_superadmin or 'conteudo.aprovar' = any (p.features))
    ) then
      raise exception 'Sem permissao para aprovar pecas de conteudo.';
    end if;
  end if;

  return new;
end $function$;

create or replace trigger conteudo_pecas_guarda BEFORE UPDATE on public.conteudo_pecas
  for each row EXECUTE FUNCTION conteudo_guarda_aprovacao();

CREATE OR REPLACE FUNCTION public.conteudo_aprovar_e_agendar(p_peca uuid)
 RETURNS conteudo_pecas
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row public.conteudo_pecas;
begin
  if not exists (
    select 1 from public.profiles p
     where p.id = auth.uid()
       and (p.role = 'admin' or p.is_superadmin or 'conteudo.aprovar' = any (p.features))
  ) then
    raise exception 'Sem permissao para aprovar pecas de conteudo.';
  end if;

  if not exists (
    select 1 from public.conteudo_pecas
     where id = p_peca and publicar_em is not null
  ) then
    raise exception 'Esta peca nao tem data marcada. Escolha quando publicar antes de agendar.';
  end if;

  update public.conteudo_pecas
     set status = 'agendada',
         aprovado_por = auth.uid(),
         aprovado_em = now(),
         motivo_reprovacao = null,
         avisado_em = null
   where id = p_peca
     and status = 'em_aprovacao'
   returning * into v_row;

  if v_row.id is null then
    raise exception 'Esta peca nao esta esperando aprovacao (alguem ja decidiu?).';
  end if;

  insert into public.conteudo_eventos (peca_id, de, para, acao, detalhe, quem)
  values
    (p_peca, 'em_aprovacao', 'aprovada', 'aprovou', 'Aprovada ja agendando.', auth.uid()),
    (p_peca, 'aprovada', 'agendada', 'mudou_status', null, auth.uid());

  return v_row;
end $function$;

CREATE OR REPLACE FUNCTION public.conteudo_casar_na_mao(p_peca uuid, p_media text)
 RETURNS conteudo_pecas
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_peca    public.conteudo_pecas;
  v_media   text;
  v_antes   text;
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (p.role = 'admin' or p.is_superadmin or 'conteudo' = any (p.features))
  ) then
    raise exception 'Voce nao tem acesso a Central de Conteudo.';
  end if;

  v_media := trim(coalesce(p_media, ''));
  if v_media = '' then
    raise exception 'Informe o link ou o codigo do post.';
  end if;

  if v_media ~ 'instagram\.com/(p|reel|reels|tv)/' then
    v_media := substring(v_media from 'instagram\.com/(?:p|reel|reels|tv)/([A-Za-z0-9_-]+)');
  end if;

  if v_media is null or v_media = '' then
    raise exception 'Nao reconheci esse link. Cole o endereco do post no Instagram.';
  end if;

  select * into v_peca from public.conteudo_pecas where id = p_peca;
  if not found then
    raise exception 'Peca nao encontrada.';
  end if;
  v_antes := v_peca.status;

  if exists (
    select 1 from public.conteudo_pecas
    where ig_media_id = v_media and id <> p_peca
  ) then
    raise exception 'Esse post ja esta ligado a outra peca.';
  end if;

  update public.conteudo_pecas
  set ig_media_id  = v_media,
      status       = 'publicada',
      publicado_em = coalesce(publicado_em, now())
  where id = p_peca
  returning * into v_peca;

  insert into public.conteudo_casamentos
    (peca_id, ig_media_id, pontuacao, motivo, situacao, decidido_por, decidido_em)
  values
    (p_peca, v_media, 1, 'Ligado a mao por quem cuida da peca.', 'confirmado', auth.uid(), now())
  on conflict (peca_id, ig_media_id) do update
    set situacao = 'confirmado', decidido_por = auth.uid(), decidido_em = now();

  insert into public.conteudo_eventos (peca_id, de, para, acao, detalhe, quem)
  values (p_peca, v_antes, 'publicada', 'casou_na_mao', v_media, auth.uid());

  return v_peca;
end;
$function$;

CREATE OR REPLACE FUNCTION public.conteudo_decidir(p_peca uuid, p_decisao text, p_motivo text DEFAULT NULL::text)
 RETURNS conteudo_pecas
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_row public.conteudo_pecas;
begin
  if p_decisao not in ('aprovada', 'reprovada') then
    raise exception 'Decisao invalida: %. Use aprovada ou reprovada.', p_decisao;
  end if;
  if not exists (
    select 1 from public.profiles p
     where p.id = auth.uid()
       and (p.role = 'admin' or p.is_superadmin or 'conteudo.aprovar' = any (p.features))
  ) then
    raise exception 'Sem permissao para aprovar ou reprovar pecas de conteudo.';
  end if;
  update public.conteudo_pecas
     set status = p_decisao, aprovado_por = auth.uid(), aprovado_em = now(),
         motivo_reprovacao = case when p_decisao = 'reprovada' then p_motivo else null end
   where id = p_peca and status = 'em_aprovacao'
   returning * into v_row;
  if v_row.id is null then
    raise exception 'Esta peca nao esta esperando aprovacao (alguem ja decidiu?).';
  end if;
  insert into public.conteudo_eventos (peca_id, de, para, acao, detalhe, quem)
  values (p_peca, 'em_aprovacao', p_decisao,
          case when p_decisao = 'aprovada' then 'aprovou' else 'reprovou' end, p_motivo, auth.uid());
  return v_row;
end $function$;

CREATE OR REPLACE FUNCTION public.conteudo_decidir_casamento(p_casamento uuid, p_confirma boolean)
 RETURNS conteudo_casamentos
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_row public.conteudo_casamentos;
begin
  if not exists (
    select 1 from public.profiles p
     where p.id = auth.uid()
       and (p.role = 'admin' or p.is_superadmin or 'conteudo' = any (p.features))
  ) then
    raise exception 'Sem permissao na Central de Conteudo.';
  end if;

  update public.conteudo_casamentos
     set situacao = case when p_confirma then 'confirmado' else 'recusado' end,
         decidido_por = auth.uid(), decidido_em = now()
   where id = p_casamento and situacao = 'sugerido'
   returning * into v_row;

  if v_row.id is null then
    raise exception 'Esta sugestao ja foi decidida.';
  end if;

  if p_confirma then
    update public.conteudo_pecas
       set ig_media_id = v_row.ig_media_id,
           ig_permalink = v_row.ig_permalink,
           status = 'publicada',
           publicado_em = coalesce(publicado_em, v_row.ig_timestamp, now())
     where id = v_row.peca_id;
  end if;

  insert into public.conteudo_eventos (peca_id, acao, detalhe, quem)
  values (v_row.peca_id,
    case when p_confirma then 'casou' else 'recusou_casamento' end,
    case when p_confirma then 'Confirmou que este e o post no Instagram.'
         else 'Disse que este post nao e desta peca.' end,
    auth.uid());

  return v_row;
end $function$;

CREATE OR REPLACE FUNCTION public.conteudo_ideia_virar_peca(p_ideia uuid, p_account uuid, p_publicar_em timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS conteudo_pecas
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ideia public.conteudo_ideias;
  v_peca  public.conteudo_pecas;
begin
  if not exists (
    select 1 from public.profiles p
     where p.id = auth.uid()
       and (p.role = 'admin' or p.is_superadmin or 'conteudo' = any (p.features))
  ) then
    raise exception 'Sem permissao na Central de Conteudo.';
  end if;

  select * into v_ideia from public.conteudo_ideias where id = p_ideia;
  if v_ideia.id is null then raise exception 'Ideia nao encontrada.'; end if;
  if v_ideia.situacao = 'usada' then raise exception 'Esta ideia ja virou peca.'; end if;

  insert into public.conteudo_pecas (
    account_id, titulo, formato, status, legenda, hashtags, observacoes, publicar_em, criado_por
  ) values (
    p_account, v_ideia.titulo, coalesce(v_ideia.formato, 'feed'), 'rascunho',
    coalesce(v_ideia.legenda_sugerida, ''), coalesce(v_ideia.hashtags_sugeridas, ''),
    v_ideia.por_que_agora, p_publicar_em, auth.uid()
  ) returning * into v_peca;

  update public.conteudo_ideias set situacao = 'usada', peca_id = v_peca.id where id = p_ideia;

  insert into public.conteudo_eventos (peca_id, para, acao, detalhe, quem)
  values (v_peca.id, 'rascunho', 'criou',
          case when v_ideia.origem = 'ia' then 'Nasceu de uma ideia sugerida pela IA.'
               else 'Nasceu de uma ideia do banco de pautas.' end,
          auth.uid());

  return v_peca;
end $function$;

CREATE OR REPLACE FUNCTION public.conteudo_reavisar(p_peca uuid)
 RETURNS conteudo_pecas
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_row public.conteudo_pecas;
begin
  if not exists (
    select 1 from public.profiles p
     where p.id = auth.uid()
       and (p.role = 'admin' or p.is_superadmin or 'conteudo' = any (p.features))
  ) then
    raise exception 'Sem permissao na Central de Conteudo.';
  end if;
  update public.conteudo_pecas set avisado_em = null
   where id = p_peca and status = 'agendada'
   returning * into v_row;
  if v_row.id is null then
    raise exception 'So da para reavisar uma peca que esta agendada.';
  end if;
  insert into public.conteudo_eventos (peca_id, acao, detalhe, quem)
  values (p_peca, 'reavisar', 'Pediu o aviso de novo.', auth.uid());
  return v_row;
end $function$;
