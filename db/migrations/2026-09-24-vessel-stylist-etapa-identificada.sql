-- UMA ETAPA NOVA NO COMEÇO DO FUNIL DA STYLIST: "IDENTIFICADA".
--
-- Decisão do dono em 24/09/2026, ao subir a planilha de mapeamento de stylists
-- (63 profissionais de Campinas, Limeira e Piracicaba): "os stylists você vai
-- subir para a primeira etapa, que é 'Identificados'". É a parceira MAPEADA que
-- ninguém abordou ainda. Ela passa para "Prospectado" quando a Ionara decide
-- abordá-la.
--
-- ── A REGRA DA DATA, E POR QUE ELA É O CORAÇÃO DISTO ────────────────────────
--
-- ⚠️ O PLACAR NÃO CONTA IDENTIFICADA COMO PROSPECTADA. "Prospectadas no
-- período" (e a turma da taxa de ativação) é contada por `prospectado_em`.
-- Sessenta nomes de uma lista caindo em "prospectadas" de uma vez derrubariam a
-- taxa de ativação do mês sem que ninguém tivesse abordado ninguém. Por isso:
--   · enquanto IDENTIFICADA, `prospectado_em` fica VAZIA (CHECK na tabela);
--   · ao sair de identificada para o funil, a data da prospecção passa a ser a
--     DATA DESSA MUDANÇA (hoje, no fuso de São Paulo);
--   · se uma identificada ganhar um encontro agendado, o gatilho a leva para
--     `ativado` (como já fazia com qualquer etapa manual) e preenche a data da
--     prospecção com o dia em que o encontro foi CRIADO, se estiver vazia —
--     para ela entrar na turma de prospectadas junto com a ativação.
-- `vessel_placar_do_stylist_circle` NÃO muda: `prospectado_em between ...` já
-- deixa o nulo de fora. O aplicador prova.
--
-- ── O QUE NÃO MUDA ──────────────────────────────────────────────────────────
--
-- ⚠️ O PADRÃO DA COLUNA CONTINUA `prospectado`: quem se inscreve pela landing e
-- quem é cadastrada à mão na Central entra em Prospectado, como hoje. Só entra
-- identificada quem pede (`p_estagio => 'identificada'` em
-- `vessel_stylist_criar` — o importador da planilha).
--
-- ⚠️ NÃO SE VOLTA PARA IDENTIFICADA. Voltar apagaria a data da prospecção (a
-- regra acima), e a taxa do mês em que ela foi prospectada mudaria de valor no
-- mês seguinte. Quem desistiu vai para uma saída.
--
-- ⚠️ `vessel_stylist_editar` MANTÉM A ASSINATURA (`create or replace` puro): a
-- Central no ar hoje chama com os mesmos nomes. `vessel_stylist_criar` ganha
-- `p_estagio` NO FIM e com `default null`, então o corpo de hoje continua
-- casando (o aplicador chama com ele).

-- ── 1. a tabela ─────────────────────────────────────────────────────────────
alter table public.vessel_stylists alter column prospectado_em drop not null;

alter table public.vessel_stylists drop constraint if exists vessel_stylists_estagio_valido;
alter table public.vessel_stylists add constraint vessel_stylists_estagio_valido
  check (estagio in ('identificada', 'prospectado', 'contatado', 'interessado', 'em_negociacao',
                     'ativado', 'evento_realizado', 'recorrente',
                     'sem_retorno', 'nao_interessado', 'pausado', 'inativo'));

alter table public.vessel_stylists drop constraint if exists vessel_stylists_identificada_sem_prospeccao;
alter table public.vessel_stylists add constraint vessel_stylists_identificada_sem_prospeccao
  check (estagio <> 'identificada' or prospectado_em is null);

comment on column public.vessel_stylists.prospectado_em is
  'Dia em que a operacao abordou a parceira. VAZIA enquanto ela esta identificada '
  '(so mapeada); preenchida no dia em que sai de identificada, ou no dia em que o '
  'primeiro encontro dela foi criado. O placar conta prospectadas por esta data.';

-- ── 2. cadastrar ────────────────────────────────────────────────────────────
drop function if exists public.vessel_stylist_criar(text, text, text, text, text, text, text, text, text, date, text, date, text);

create function public.vessel_stylist_criar(
  p_nome           text,
  p_whatsapp       text,
  p_cidade         text default null,
  p_instagram      text default null,
  p_atuacao        text default null,
  p_praca          text default null,
  p_loja           text default null,
  p_origem_contato text default null,
  p_responsavel    text default null,
  p_prospectado_em date default null,
  p_proxima_acao   text default null,
  p_proxima_acao_em date default null,
  p_observacoes    text default null,
  -- ⚠️ SÓ DUAS ETAPAS DE ENTRADA: `prospectado` (o padrão, nulo) ou
  -- `identificada`. Nascer contatada ou em negociação seria pular a data da
  -- prospecção.
  p_estagio        text default null
)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_fone    text;
  v_insta   text := nullif(trim(coalesce(p_instagram, '')), '');
  v_perfil  text := public.vessel_instagram_canonico(p_instagram);
  v_obs     text := nullif(trim(coalesce(p_observacoes, '')), '');
  v_praca   text := upper(nullif(trim(coalesce(p_praca, '')), ''));
  v_loja    text := lower(nullif(trim(coalesce(p_loja, '')), ''));
  v_origem  text := lower(nullif(trim(coalesce(p_origem_contato, '')), ''));
  v_estagio text := coalesce(lower(nullif(trim(coalesce(p_estagio, '')), '')), 'prospectado');
  v_hoje    date := (now() at time zone 'America/Sao_Paulo')::date;
  v_codigo  text;
  v_n       int;
  v_volta   int;
  v_indice  text;
  v_outra   text;
begin
  -- ⚠️ A TRAVA DE MEXER, NAO A DE VER (ver `2026-09-19-vessel-stylist-mexer.sql`).
  if not public.is_vessel_atendimentos_editar() then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;

  if nullif(trim(coalesce(p_nome, '')), '') is null then
    return json_build_object('ok', false, 'situacao', 'sem_nome');
  end if;

  if v_estagio not in ('prospectado', 'identificada') then
    return json_build_object('ok', false, 'situacao', 'estagio_invalido');
  end if;
  -- Identificada não tem data de prospecção: mandar uma é contradição, e
  -- jogá-la fora calado faria a pessoa achar que gravou.
  if v_estagio = 'identificada' and p_prospectado_em is not null then
    return json_build_object('ok', false, 'situacao', 'identificada_sem_prospeccao');
  end if;

  -- ⚠️ WHATSAPP OU INSTAGRAM (ver `2026-09-24-vessel-stylist-whatsapp-ou-instagram.sql`).
  if nullif(trim(coalesce(p_whatsapp, '')), '') is not null then
    v_fone := public.vessel_telefone_canonico(p_whatsapp);
    if v_fone is null then
      return json_build_object('ok', false, 'situacao', 'whatsapp_invalido');
    end if;
  end if;
  if length(coalesce(v_insta, '')) > 120 then
    return json_build_object('ok', false, 'situacao', 'instagram_longo');
  end if;
  if v_fone is null and v_insta is null then
    return json_build_object('ok', false, 'situacao', 'sem_contato');
  end if;
  if v_fone is null and v_perfil is null then
    return json_build_object('ok', false, 'situacao', 'instagram_invalido');
  end if;
  if v_obs is not null and length(v_obs) > 2000 then
    return json_build_object('ok', false, 'situacao', 'observacoes_longas');
  end if;

  if v_praca is not null and v_praca not in ('CPS', 'SAO', 'SBO', 'BSB') then
    return json_build_object('ok', false, 'situacao', 'praca_invalida');
  end if;
  if v_loja is not null and v_loja not in ('iguatemi', 'tivoli', 'parkshopping') then
    return json_build_object('ok', false, 'situacao', 'loja_invalida');
  end if;
  -- ⚠️ NA CENTRAL A ORIGEM É OBRIGATÓRIA.
  if v_origem is null or v_origem not in ('indicacao', 'pesquisa', 'evento', 'inbound') then
    return json_build_object('ok', false, 'situacao', 'origem_invalida');
  end if;
  if p_prospectado_em is not null and p_prospectado_em > v_hoje then
    return json_build_object('ok', false, 'situacao', 'prospeccao_no_futuro');
  end if;

  if v_fone is not null and exists (select 1 from public.vessel_stylists where whatsapp = v_fone) then
    return json_build_object('ok', false, 'situacao', 'whatsapp_repetido',
      'codigo', (select s.codigo from public.vessel_stylists s where s.whatsapp = v_fone));
  end if;
  if v_perfil is not null then
    select s.codigo into v_outra from public.vessel_stylists s
     where public.vessel_instagram_canonico(s.instagram) = v_perfil
     order by s.id limit 1;
    if v_outra is not null then
      return json_build_object('ok', false, 'situacao', 'instagram_repetido', 'codigo', v_outra);
    end if;
  end if;

  -- ⚠️ A TRAVA DE FILA E O CINTO, sem mudança desde 19/09.
  perform pg_advisory_xact_lock(hashtext('public.vessel_stylists.codigo')::bigint);

  for v_volta in 1..3 loop
    select coalesce(max((substring(s.codigo from '^STY-([0-9]{4})$'))::int), 0)
      into v_n
      from public.vessel_stylists s
     where s.codigo ~ '^STY-[0-9]{4}$';

    v_codigo := null;
    for i in 1..10000 loop
      v_n := v_n + 1;
      if v_n > 9999 then
        v_n := 0;
      end if;
      v_codigo := 'STY-' || lpad(v_n::text, 4, '0');
      exit when not exists (select 1 from public.vessel_stylists s where s.codigo = v_codigo);
      v_codigo := null;
    end loop;

    if v_codigo is null then
      return json_build_object('ok', false, 'situacao', 'sem_codigo_livre');
    end if;

    begin
      insert into public.vessel_stylists
        (codigo, nome, whatsapp, cidade, instagram, atuacao, praca_preview,
         loja, origem_contato, responsavel, prospectado_em, proxima_acao, proxima_acao_em,
         observacoes, estagio)
      values
        (v_codigo, trim(p_nome), v_fone,
         nullif(trim(coalesce(p_cidade, '')), ''),
         v_insta,
         nullif(trim(coalesce(p_atuacao, '')), ''),
         v_praca, v_loja, v_origem,
         nullif(trim(coalesce(p_responsavel, '')), ''),
         case when v_estagio = 'identificada' then null else coalesce(p_prospectado_em, v_hoje) end,
         nullif(trim(coalesce(p_proxima_acao, '')), ''),
         p_proxima_acao_em,
         v_obs,
         v_estagio);

      return json_build_object('ok', true, 'situacao', 'ok', 'codigo', v_codigo);

    exception when unique_violation then
      get stacked diagnostics v_indice = constraint_name;

      if v_indice = 'vessel_stylists_whatsapp_idx' then
        return json_build_object('ok', false, 'situacao', 'whatsapp_repetido');
      end if;

      if v_indice is distinct from 'vessel_stylists_codigo_idx' then
        return json_build_object('ok', false, 'situacao', 'conflito_no_cadastro',
                                 'onde', v_indice);
      end if;
    end;
  end loop;

  return json_build_object('ok', false, 'situacao', 'codigo_em_disputa');
end;
$function$;

-- ── 3. corrigir (MESMA assinatura) ──────────────────────────────────────────
create or replace function public.vessel_stylist_editar(
  p_codigo          text,
  p_nome            text default null,
  p_whatsapp        text default null,
  p_cidade          text default null,
  p_instagram       text default null,
  p_atuacao         text default null,
  p_estagio         text default null,
  p_praca           text default null,
  p_loja            text default null,
  p_origem_contato  text default null,
  p_responsavel     text default null,
  p_prospectado_em  date default null,
  p_proxima_acao    text default null,
  p_proxima_acao_em date default null,
  p_sem_proxima_acao boolean default false,
  p_observacoes     text default null
)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_codigo  text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
  v_fone    text;
  v_insta   text := nullif(trim(coalesce(p_instagram, '')), '');
  v_perfil  text := public.vessel_instagram_canonico(p_instagram);
  v_praca   text := upper(nullif(trim(coalesce(p_praca, '')), ''));
  v_loja    text := lower(nullif(trim(coalesce(p_loja, '')), ''));
  v_origem  text := lower(nullif(trim(coalesce(p_origem_contato, '')), ''));
  v_estagio text := lower(nullif(trim(coalesce(p_estagio, '')), ''));
  v_hoje    date := (now() at time zone 'America/Sao_Paulo')::date;
  v_ativada timestamptz;
  v_fone_atual text;
  v_atual   text;
  v_final   text;
begin
  if not public.is_vessel_atendimentos_editar() then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;

  select s.ativada_em, s.whatsapp, s.estagio into v_ativada, v_fone_atual, v_atual
    from public.vessel_stylists s where s.codigo = v_codigo;
  if not found then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;

  if nullif(trim(coalesce(p_whatsapp, '')), '') is not null then
    v_fone := public.vessel_telefone_canonico(p_whatsapp);
    if v_fone is null then
      return json_build_object('ok', false, 'situacao', 'whatsapp_invalido');
    end if;
    if exists (select 1 from public.vessel_stylists s
                where s.whatsapp = v_fone and s.codigo <> v_codigo) then
      return json_build_object('ok', false, 'situacao', 'whatsapp_repetido');
    end if;
  end if;

  if v_insta is not null then
    if length(v_insta) > 120 then
      return json_build_object('ok', false, 'situacao', 'instagram_longo');
    end if;
    if coalesce(v_fone, v_fone_atual) is null and v_perfil is null then
      return json_build_object('ok', false, 'situacao', 'instagram_invalido');
    end if;
    if v_perfil is not null and exists (
         select 1 from public.vessel_stylists s
          where public.vessel_instagram_canonico(s.instagram) = v_perfil
            and s.codigo <> v_codigo) then
      return json_build_object('ok', false, 'situacao', 'instagram_repetido');
    end if;
  end if;

  if p_observacoes is not null and length(trim(p_observacoes)) > 2000 then
    return json_build_object('ok', false, 'situacao', 'observacoes_longas');
  end if;

  if v_praca is not null and v_praca not in ('CPS', 'SAO', 'SBO', 'BSB') then
    return json_build_object('ok', false, 'situacao', 'praca_invalida');
  end if;
  if v_loja is not null and v_loja not in ('iguatemi', 'tivoli', 'parkshopping') then
    return json_build_object('ok', false, 'situacao', 'loja_invalida');
  end if;
  if v_origem is not null and v_origem not in ('indicacao', 'pesquisa', 'evento', 'inbound') then
    return json_build_object('ok', false, 'situacao', 'origem_invalida');
  end if;
  if p_prospectado_em is not null and p_prospectado_em > v_hoje then
    return json_build_object('ok', false, 'situacao', 'prospeccao_no_futuro');
  end if;

  if v_estagio is not null then
    -- ⚠️ OS TRÊS DEGRAUS DO MEIO NÃO SE ESCOLHEM: saem dos encontros.
    if v_estagio in ('ativado', 'evento_realizado', 'recorrente') then
      return json_build_object('ok', false, 'situacao', 'estagio_automatico');
    end if;
    if v_estagio not in ('identificada', 'prospectado', 'contatado', 'interessado', 'em_negociacao',
                         'sem_retorno', 'nao_interessado', 'pausado', 'inativo') then
      return json_build_object('ok', false, 'situacao', 'estagio_invalido');
    end if;
    -- ⚠️ NÃO SE VOLTA PARA IDENTIFICADA: apagaria a data da prospecção.
    if v_estagio = 'identificada' and v_atual <> 'identificada' then
      return json_build_object('ok', false, 'situacao', 'volta_para_identificada');
    end if;
    -- ⚠️ E QUEM JÁ TEVE ENCONTRO NÃO VOLTA PARA ANTES DELE.
    if v_ativada is not null and v_estagio in ('identificada', 'prospectado', 'contatado', 'interessado',
                                               'em_negociacao') then
      return json_build_object('ok', false, 'situacao', 'estagio_contradiz_encontro');
    end if;
  end if;

  v_final := coalesce(v_estagio, v_atual);
  -- Identificada que continua identificada não recebe data de prospecção.
  if v_final = 'identificada' and p_prospectado_em is not null then
    return json_build_object('ok', false, 'situacao', 'identificada_sem_prospeccao');
  end if;

  update public.vessel_stylists s
     set nome            = coalesce(nullif(trim(coalesce(p_nome, '')), ''), s.nome),
         whatsapp        = coalesce(v_fone, s.whatsapp),
         cidade          = coalesce(nullif(trim(coalesce(p_cidade, '')), ''), s.cidade),
         instagram       = coalesce(v_insta, s.instagram),
         atuacao         = coalesce(nullif(trim(coalesce(p_atuacao, '')), ''), s.atuacao),
         estagio         = v_final,
         praca_preview   = coalesce(v_praca, s.praca_preview),
         loja            = coalesce(v_loja, s.loja),
         origem_contato  = coalesce(v_origem, s.origem_contato),
         responsavel     = coalesce(nullif(trim(coalesce(p_responsavel, '')), ''), s.responsavel),
         -- ⚠️ A DATA DA PROSPECÇÃO (ver o cabeçalho): vazia na identificada;
         -- quem entra no funil sem data ganha a de HOJE — o dia da mudança.
         prospectado_em  = case
                             when v_final = 'identificada' then null
                             when v_final in ('prospectado', 'contatado', 'interessado', 'em_negociacao')
                               then coalesce(p_prospectado_em, s.prospectado_em, v_hoje)
                             else coalesce(p_prospectado_em, s.prospectado_em)
                           end,
         proxima_acao    = case when coalesce(p_sem_proxima_acao, false) then null
                                else coalesce(nullif(trim(coalesce(p_proxima_acao, '')), ''),
                                              s.proxima_acao) end,
         proxima_acao_em = case when coalesce(p_sem_proxima_acao, false) then null
                                else coalesce(p_proxima_acao_em, s.proxima_acao_em) end,
         observacoes     = case when p_observacoes is null then s.observacoes
                                else nullif(trim(p_observacoes), '') end,
         atualizado_em   = now()
   where s.codigo = v_codigo;

  -- ⚠️ SAIR DE "PAUSADO" DEVOLVE O FUNIL AO FATO.
  perform public.vessel_stylist_seguir_os_encontros(
    (select s.id from public.vessel_stylists s where s.codigo = v_codigo));

  return json_build_object('ok', true, 'situacao', 'ok', 'codigo', v_codigo);
end;
$function$;

-- ── 4. o gatilho dos encontros ──────────────────────────────────────────────
-- ⚠️ `create or replace` COM A MESMA ASSINATURA: o texto é o do banco (medido
-- em 24/09/2026) mais o último `update`, o da data da prospecção.
create or replace function public.vessel_stylist_seguir_os_encontros(p_stylist bigint)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_realizados int;
  v_marcados   int;
  v_fase       text;
  v_primeiro   date;
begin
  if p_stylist is null then return; end if;

  select count(*) filter (where e.status = 'realizado'),
         count(*) filter (where e.status in ('agendado', 'confirmado', 'reagendado',
                                             'realizado', 'nao_realizado', 'cancelado')),
         min((e.criado_em at time zone 'America/Sao_Paulo')::date)
           filter (where e.status in ('agendado', 'confirmado', 'reagendado',
                                      'realizado', 'nao_realizado', 'cancelado'))
    into v_realizados, v_marcados, v_primeiro
    from public.vessel_private_edits e
   where e.stylist_id = p_stylist and not coalesce(e.arquivada, false);

  v_fase := case when v_realizados >= 2 then 'recorrente'
                 when v_realizados = 1  then 'evento_realizado'
                 when v_marcados >= 1   then 'ativado'
            end;

  -- A ativação congela na primeira vez (ver o comentário da coluna).
  if v_marcados >= 1 then
    update public.vessel_stylists set ativada_em = now()
     where id = p_stylist and ativada_em is null;
  end if;

  -- ⚠️ PAUSADO E INATIVO SÃO DECISÃO DE GENTE, e o gatilho não passa por cima.
  -- Os outros estágios (identificada inclusive) são o funil andando, e aí manda
  -- o fato. ⚠️ A DATA DA PROSPECÇÃO VAI NO MESMO `update` que tira a stylist de
  -- identificada: em dois passos, o primeiro violaria
  -- `vessel_stylists_identificada_sem_prospeccao`.
  update public.vessel_stylists s
     set estagio = coalesce(v_fase,
                            case when s.estagio in ('ativado', 'evento_realizado', 'recorrente')
                                 then 'ativado' else s.estagio end),
         prospectado_em = case when v_fase is not null then coalesce(s.prospectado_em, v_primeiro)
                               else s.prospectado_em end,
         atualizado_em = now()
   where s.id = p_stylist
     and s.estagio not in ('pausado', 'inativo')
     and s.estagio is distinct from coalesce(v_fase,
           case when s.estagio in ('ativado', 'evento_realizado', 'recorrente')
                then 'ativado' else s.estagio end);

  -- Quem já estava no funil (ou pausada) e ainda não tinha data: o dia em que
  -- o primeiro encontro foi criado. Nunca numa identificada (o CHECK).
  if v_marcados >= 1 then
    update public.vessel_stylists s
       set prospectado_em = v_primeiro
     where s.id = p_stylist and s.prospectado_em is null and s.estagio <> 'identificada';
  end if;
end;
$function$;

-- ── 5. a sugestão de etapa ──────────────────────────────────────────────────
-- ⚠️ A MESMA TABELA DE `sugestaoDeEtapa` (crm-da-stylist-regras.js); o teste
-- de lá lê este corpo. `identificada` entra NA FRENTE das duas listas: nenhum
-- resultado sugere "prospectado" nem "identificada", então o que se sugere a
-- uma identificada é exatamente o que se sugeriria a uma prospectada.
create or replace function public.vessel_stylist_sugestao_de_etapa(
  p_resultado text, p_estagio text, p_ativada timestamptz)
returns text
language sql
immutable
as $$
  select case
    when p_estagio in ('pausado', 'inativo') then null
    when p_resultado = 'recusou' then case when p_ativada is null and p_estagio <> 'nao_interessado' then 'nao_interessado' end
    else (
      with alvo as (select case p_resultado
                             when 'conversou' then 'contatado'
                             when 'interesse' then 'interessado'
                             when 'proposta'  then 'em_negociacao' end as a)
      select case
        when a is null then null
        when p_estagio in ('sem_retorno', 'nao_interessado') then case when p_ativada is null then a end
        when array_position(array['identificada','prospectado','contatado','interessado','em_negociacao',
                                  'ativado','evento_realizado','recorrente'], a)
           > coalesce(array_position(array['identificada','prospectado','contatado','interessado','em_negociacao',
                                  'ativado','evento_realizado','recorrente'], p_estagio), 99)
          then a
      end from alvo)
  end
$$;
revoke all on function public.vessel_stylist_sugestao_de_etapa(text, text, timestamptz) from public, anon;

-- ── 6. as portas ────────────────────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'public.vessel_stylist_criar(text, text, text, text, text, text, text, text, text, date, text, date, text, text)',
    'public.vessel_stylist_editar(text, text, text, text, text, text, text, text, text, text, text, date, text, date, boolean, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
revoke all on function public.vessel_stylist_seguir_os_encontros(bigint) from public, anon, authenticated;

notify pgrst, 'reload schema';
