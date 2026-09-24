-- A PARCEIRA PODE ENTRAR "SEM CONTATO AINDA".
--
-- Decisão do dono em 24/09/2026: as 12 stylists da planilha de mapeamento que
-- não têm nem WhatsApp nem Instagram entram mesmo assim, na primeira etapa do
-- funil, marcadas "sem contato ainda" — para a Ionara completar.
--
-- ── O QUE MUDA ──────────────────────────────────────────────────────────────
--
--   1. `vessel_stylists.sem_contato boolean not null default false`: a marca
--      EXPLÍCITA. A trava da tabela passa a ser WhatsApp OU Instagram OU a
--      marca ligada (`vessel_stylists_tem_contato`). Continua CHECK na tabela,
--      não só na função — a regra vale para qualquer porta.
--   2. Um gatilho (`vessel_stylists_sem_contato_some`) DESLIGA a marca sozinho
--      quando a parceira ganha WhatsApp ou Instagram, por qualquer porta. A
--      marca nunca fica ligada ao lado de um contato.
--   3. `vessel_stylist_criar` ganha `p_sem_contato boolean default false` NO
--      FIM; `vessel_stylist_editar` ganha `p_sem_contato boolean default null`
--      NO FIM (nulo = não mexe).
--   4. `vessel_rastreio_dos_stylists` devolve `sem_contato`.
--
-- ── A CENTRAL QUE ESTÁ NO AR ────────────────────────────────────────────────
--
-- ⚠️ A tela de hoje não manda `p_sem_contato`. Pelo padrão (false em criar,
-- nulo em editar) ela se comporta EXATAMENTE como antes: criar sem contato
-- continua voltando `sem_contato`, e corrigir não mexe na marca. As chamadas
-- da tela de hoje estão provadas em `coletor/aplicar-vessel-stylist-sem-contato.mjs`.
--
-- ── O QUE NÃO MUDA ──────────────────────────────────────────────────────────
--
-- ⚠️ A PORTA PÚBLICA (`vessel_pedido_do_stylist`) CONTINUA EXIGINDO WHATSAPP e
-- nem conhece a marca (entra com o padrão false).
-- ⚠️ Os textos das três funções partem do que está NO BANCO (medido com
-- `pg_get_functiondef` em 24/09/2026, depois do funil configurável), com só o
-- que está marcado "SEM CONTATO AINDA" a mais.
-- ⚠️ `drop` + `create` em criar/editar: a lista de parâmetros muda, e
-- `create or replace` criaria uma SEGUNDA função com o mesmo nome — o PostgREST
-- responderia "function is not unique" para a tela.

-- ── 1. a tabela ─────────────────────────────────────────────────────────────
alter table public.vessel_stylists
  add column if not exists sem_contato boolean not null default false;

alter table public.vessel_stylists drop constraint if exists vessel_stylists_tem_contato;
alter table public.vessel_stylists add constraint vessel_stylists_tem_contato
  check (whatsapp is not null
         or nullif(btrim(coalesce(instagram, '')), '') is not null
         or sem_contato);

comment on column public.vessel_stylists.sem_contato is
  'Sem contato ainda (24/09/2026): entrou sem WhatsApp e sem Instagram, e alguem '
  'vai completar. Desliga sozinho (gatilho vessel_stylists_sem_contato_some) quando '
  'ela ganha um contato.';

-- ── 2. a marca some quando o contato chega ──────────────────────────────────
create or replace function public.vessel_stylists_sem_contato_some()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.whatsapp is not null or nullif(btrim(coalesce(new.instagram, '')), '') is not null then
    new.sem_contato := false;
  end if;
  return new;
end;
$function$;
revoke all on function public.vessel_stylists_sem_contato_some() from public, anon, authenticated;

drop trigger if exists vessel_stylists_sem_contato_some on public.vessel_stylists;
create trigger vessel_stylists_sem_contato_some
  before insert or update of whatsapp, instagram, sem_contato on public.vessel_stylists
  for each row execute function public.vessel_stylists_sem_contato_some();

-- ── 3. cadastrar ────────────────────────────────────────────────────────────
drop function if exists public.vessel_stylist_criar(text, text, text, text, text, text, text, text, text, date, text, date, text);

CREATE FUNCTION public.vessel_stylist_criar(p_nome text, p_whatsapp text, p_cidade text DEFAULT NULL::text, p_instagram text DEFAULT NULL::text, p_atuacao text DEFAULT NULL::text, p_praca text DEFAULT NULL::text, p_loja text DEFAULT NULL::text, p_origem_contato text DEFAULT NULL::text, p_responsavel text DEFAULT NULL::text, p_prospectado_em date DEFAULT NULL::date, p_proxima_acao text DEFAULT NULL::text, p_proxima_acao_em date DEFAULT NULL::date, p_observacoes text DEFAULT NULL::text, p_sem_contato boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_fone    text;
  v_insta   text := nullif(trim(coalesce(p_instagram, '')), '');
  v_perfil  text := public.vessel_instagram_canonico(p_instagram);
  v_obs     text := nullif(trim(coalesce(p_observacoes, '')), '');
  v_praca   text := upper(nullif(trim(coalesce(p_praca, '')), ''));
  v_loja    text := lower(nullif(trim(coalesce(p_loja, '')), ''));
  v_origem  text := lower(nullif(trim(coalesce(p_origem_contato, '')), ''));
  v_codigo  text;
  v_n       int;
  v_volta   int;
  v_indice  text;
  v_outra   text;
  -- ⚠️ SEM CONTATO AINDA (24/09/2026): só vale quando não veio NENHUM contato.
  v_sem     boolean := coalesce(p_sem_contato, false);
begin
  if not public.is_vessel_atendimentos_editar() then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;

  if nullif(trim(coalesce(p_nome, '')), '') is null then
    return json_build_object('ok', false, 'situacao', 'sem_nome');
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
  -- ⚠️ SEM CONTATO AINDA: só quem MARCOU a caixa entra sem os dois. A Central
  -- antiga não manda `p_sem_contato` (padrão false) e continua recusando igual.
  if v_fone is null and v_insta is null and not v_sem then
    return json_build_object('ok', false, 'situacao', 'sem_contato');
  end if;
  -- Instagram ESCRITO sem WhatsApp continua tendo de ser um perfil de verdade.
  if v_fone is null and v_insta is not null and v_perfil is null then
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
  if v_origem is null or v_origem not in ('indicacao', 'pesquisa', 'evento', 'inbound') then
    return json_build_object('ok', false, 'situacao', 'origem_invalida');
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
      -- ⚠️ SEM `etapa_id` E SEM `prospectado_em`: o gatilho põe a primeira
      -- etapa de funil e a data segue a regra da etapa marcada.
      insert into public.vessel_stylists
        (codigo, nome, whatsapp, cidade, instagram, atuacao, praca_preview,
         loja, origem_contato, responsavel, proxima_acao, proxima_acao_em, observacoes,
         sem_contato)
      values
        (v_codigo, trim(p_nome), v_fone,
         nullif(trim(coalesce(p_cidade, '')), ''),
         v_insta,
         nullif(trim(coalesce(p_atuacao, '')), ''),
         v_praca, v_loja, v_origem,
         nullif(trim(coalesce(p_responsavel, '')), ''),
         nullif(trim(coalesce(p_proxima_acao, '')), ''),
         p_proxima_acao_em,
         v_obs,
         v_sem and v_fone is null and v_insta is null);

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

-- ── 4. corrigir ─────────────────────────────────────────────────────────────
drop function if exists public.vessel_stylist_editar(text, text, text, text, text, text, text, text, text, text, text, date, text, date, boolean, text);

CREATE FUNCTION public.vessel_stylist_editar(p_codigo text, p_nome text DEFAULT NULL::text, p_whatsapp text DEFAULT NULL::text, p_cidade text DEFAULT NULL::text, p_instagram text DEFAULT NULL::text, p_atuacao text DEFAULT NULL::text, p_estagio text DEFAULT NULL::text, p_praca text DEFAULT NULL::text, p_loja text DEFAULT NULL::text, p_origem_contato text DEFAULT NULL::text, p_responsavel text DEFAULT NULL::text, p_prospectado_em date DEFAULT NULL::date, p_proxima_acao text DEFAULT NULL::text, p_proxima_acao_em date DEFAULT NULL::date, p_sem_proxima_acao boolean DEFAULT false, p_observacoes text DEFAULT NULL::text, p_sem_contato boolean DEFAULT NULL::boolean)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_codigo  text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
  v_fone    text;
  v_insta   text := nullif(trim(coalesce(p_instagram, '')), '');
  v_perfil  text := public.vessel_instagram_canonico(p_instagram);
  v_praca   text := upper(nullif(trim(coalesce(p_praca, '')), ''));
  v_loja    text := lower(nullif(trim(coalesce(p_loja, '')), ''));
  v_origem  text := lower(nullif(trim(coalesce(p_origem_contato, '')), ''));
  v_fone_atual text;
  v_insta_atual text;
  v_com_contato boolean;
begin
  if not public.is_vessel_atendimentos_editar() then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;

  select s.whatsapp, nullif(btrim(coalesce(s.instagram, '')), '') into v_fone_atual, v_insta_atual
    from public.vessel_stylists s where s.codigo = v_codigo;
  if not found then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;

  if nullif(trim(coalesce(p_estagio, '')), '') is not null then
    return json_build_object('ok', false, 'situacao', 'etapa_pela_ficha');
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

  -- ⚠️ SEM CONTATO AINDA (24/09/2026). NULO = NÃO MEXE (a Central antiga não
  -- manda). Desmarcar sem dar um contato é recusado: a parceira ficaria sem
  -- WhatsApp, sem Instagram e sem a marca — o que a tabela não aceita.
  -- Ganhar um contato DESLIGA a marca sozinho (aqui e no gatilho da tabela).
  v_com_contato := coalesce(v_fone, v_fone_atual) is not null or coalesce(v_insta, v_insta_atual) is not null;
  if p_sem_contato is not null and not p_sem_contato and not v_com_contato then
    return json_build_object('ok', false, 'situacao', 'sem_contato');
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

  update public.vessel_stylists s
     set nome            = coalesce(nullif(trim(coalesce(p_nome, '')), ''), s.nome),
         whatsapp        = coalesce(v_fone, s.whatsapp),
         cidade          = coalesce(nullif(trim(coalesce(p_cidade, '')), ''), s.cidade),
         instagram       = coalesce(v_insta, s.instagram),
         atuacao         = coalesce(nullif(trim(coalesce(p_atuacao, '')), ''), s.atuacao),
         praca_preview   = coalesce(v_praca, s.praca_preview),
         loja            = coalesce(v_loja, s.loja),
         origem_contato  = coalesce(v_origem, s.origem_contato),
         responsavel     = coalesce(nullif(trim(coalesce(p_responsavel, '')), ''), s.responsavel),
         proxima_acao    = case when coalesce(p_sem_proxima_acao, false) then null
                                else coalesce(nullif(trim(coalesce(p_proxima_acao, '')), ''),
                                              s.proxima_acao) end,
         proxima_acao_em = case when coalesce(p_sem_proxima_acao, false) then null
                                else coalesce(p_proxima_acao_em, s.proxima_acao_em) end,
         observacoes     = case when p_observacoes is null then s.observacoes
                                else nullif(trim(p_observacoes), '') end,
         sem_contato     = case when v_com_contato then false
                                else coalesce(p_sem_contato, s.sem_contato) end,
         atualizado_em   = now()
   where s.codigo = v_codigo;

  return json_build_object('ok', true, 'situacao', 'ok', 'codigo', v_codigo);
end;
$function$;

-- ── 5. a lista da tela devolve a marca ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.vessel_rastreio_dos_stylists(p_dias integer DEFAULT 7, p_incluir_desativadas boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_dias int := greatest(coalesce(p_dias, 7), 0);
  v_saida json;
begin
  if not public.is_vessel_atendimentos() then
    raise exception 'sem permissao' using errcode = '42501';
  end if;

  with vendas as (select * from public.vessel_vendas_dos_encontros(v_dias))
  select coalesce(json_agg(linha order by linha ->> 'codigo'), '[]'::json)
    into v_saida
    from (
      select json_build_object(
        'codigo', s.codigo,
        'nome', s.nome,
        'cidade', s.cidade,
        -- ⚠️ 24/09/2026: a etapa é uma linha de `vessel_stylist_etapas`.
        'etapa_id', s.etapa_id,
        'etapa', et.nome,
        'etapa_tipo', et.tipo,
        'etapa_ordem', et.ordem,
        -- ⚠️ 24/09/2026 (Private Edit só com liberada, e os motivos de saída).
        'etapa_libera_private_edit', et.libera_private_edit,
        'saida_motivo_id', case when et.tipo = 'saida' then sa.motivo_id end,
        'saida_motivo', case when et.tipo = 'saida' then ms.nome end,
        'saida_nota', case when et.tipo = 'saida' then sa.nota end,
        'praca_preview', s.praca_preview,
        'ativa', s.ativa,
        'whatsapp', s.whatsapp,
        'instagram', s.instagram,
        'atuacao', s.atuacao,
        -- T11: a ficha operacional.
        'loja', s.loja,
        'origem_contato', s.origem_contato,
        'responsavel', s.responsavel,
        'prospectado_em', s.prospectado_em,
        'proxima_acao', s.proxima_acao,
        'proxima_acao_em', s.proxima_acao_em,
        'observacoes', s.observacoes,
        -- ⚠️ 24/09/2026: "sem contato ainda" — alguém vai completar.
        'sem_contato', s.sem_contato,
        -- ⚠️ 24/09/2026: a ativação é a da etapa (a mesma função do placar); o
        -- primeiro Private Edit agendado continua, com o nome dele.
        'ativada_em', public.vessel_stylist_ativada_em(s.id),
        'private_edit_agendado_em', s.ativada_em,
        'encontros_realizados', ee.realizados,
        'ultima_private_edit', ee.ultima,
        'proxima_data_permitida', ee.ultima + 45,
        'receita_dos_encontros', (select coalesce(sum(v.receita), 0) from vendas v
                                   where v.stylist_id = s.id),
        'contatos', (select count(*)::int from public.vessel_stylist_contatos c where c.stylist_id = s.id),
        'ultimo_contato_em', (select max(c.criado_em) from public.vessel_stylist_contatos c where c.stylist_id = s.id),
        'aberturas', (select count(*)::int from public.vessel_stylist_aberturas a
                       where a.codigo = s.codigo),
        'clientes', (select count(distinct o.pessoa_id)::int
                       from public.vessel_origens o where o.stylist_id = s.codigo),
        'pedidos', (select count(*)::int from public.vessel_atendimentos t
                     where not coalesce(t.teste, false)
                       and exists (select 1 from public.vessel_origens o
                                    where o.stylist_id = s.codigo
                                      and o.pessoa_id = t.pessoa_id)),
        'confirmados', (select count(*)::int from public.vessel_atendimentos t
                         where not coalesce(t.teste, false)
                           and t.status in ('confirmado', 'realizado', 'no_show')
                           and exists (select 1 from public.vessel_origens o
                                        where o.stylist_id = s.codigo
                                          and o.pessoa_id = t.pessoa_id)),
        'compareceram', (select count(*)::int from public.vessel_atendimentos t
                          where not coalesce(t.teste, false) and t.status = 'realizado'
                            and exists (select 1 from public.vessel_origens o
                                         where o.stylist_id = s.codigo
                                           and o.pessoa_id = t.pessoa_id)),
        'receita', (select coalesce(sum(coalesce(p.receita_liquida, p.total_corrigido, 0)), 0)
                      from public.vessel_pedidos p
                     where p.situacao_id = 9
                       and exists (select 1 from public.vessel_origens o
                                    where o.stylist_id = s.codigo and o.pessoa_id = p.pessoa_id)
                       and exists (select 1 from public.vessel_atendimentos t
                                    where t.pessoa_id = p.pessoa_id
                                      and not coalesce(t.teste, false)
                                      and t.status = 'realizado'
                                      and p.data_do_pedido
                                            between (coalesce(t.quando, t.criado_em)
                                                      at time zone 'America/Sao_Paulo')::date
                                                and (coalesce(t.quando, t.criado_em)
                                                      at time zone 'America/Sao_Paulo')::date
                                                    + v_dias)),
        'janela_de_venda_em_dias', v_dias
      ) as linha
      from public.vessel_stylists s
      join public.vessel_stylist_etapas et on et.id = s.etapa_id
      left join lateral public.vessel_stylist_saida_atual(s.id) sa on true
      left join public.vessel_stylist_motivos_de_saida ms on ms.id = sa.motivo_id
      cross join lateral (
        select count(*) filter (where e.status = 'realizado')::int as realizados,
               max(e.realizado_em) filter (where e.status = 'realizado') as ultima
          from public.vessel_private_edits e
         where e.stylist_id = s.id and not coalesce(e.teste, false)
           and not coalesce(e.arquivada, false)
      ) ee
      where not coalesce(s.teste, false)
        and (coalesce(p_incluir_desativadas, false) or coalesce(s.ativa, true))
    ) as linhas;

  return v_saida;
end;
$function$;

-- ── 6. as portas ────────────────────────────────────────────────────────────
-- ⚠️ `revoke ... from public` NÃO FECHA `anon`, e função recriada por `drop` +
-- `create` nasce executável por `public`. As duas linhas são obrigatórias.
do $$
declare f text;
begin
  foreach f in array array[
    'public.vessel_stylist_criar(text, text, text, text, text, text, text, text, text, date, text, date, text, boolean)',
    'public.vessel_stylist_editar(text, text, text, text, text, text, text, text, text, text, text, date, text, date, boolean, text, boolean)',
    'public.vessel_rastreio_dos_stylists(integer, boolean)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
