-- A PARCEIRA DO STYLIST CIRCLE PODE ENTRAR SÓ COM O INSTAGRAM.
--
-- Pedido do dono em 24/09/2026, ao mandar subir a planilha de mapeamento de
-- stylists (Campinas, Limeira e Piracicaba): "as que não tem whatsapp vc coloca
-- o instagram". Metade da planilha não tem telefone publicado — só o perfil.
--
-- ── O QUE MUDA ──────────────────────────────────────────────────────────────
--
--   1. `vessel_stylists.whatsapp` deixa de ser obrigatório, e no lugar entra a
--      regra de verdade: WHATSAPP OU INSTAGRAM, pelo menos um (CHECK na tabela,
--      não só na função — a trava tem de valer para qualquer porta).
--   2. `vessel_stylists.observacoes`: texto livre, opcional. É onde mora o que
--      a pessoa sabe dela e não tem campo (e-mail, site, o que a pesquisa
--      achou). Até 2000 caracteres.
--   3. `vessel_stylist_criar` e `vessel_stylist_editar` aceitam só o
--      Instagram, recusam Instagram repetido e recebem `p_observacoes`.
--   4. `vessel_rastreio_dos_stylists` devolve `observacoes` para a tela.
--
-- ── O QUE NÃO MUDA, E POR QUÊ ───────────────────────────────────────────────
--
-- ⚠️ A PORTA PÚBLICA (`vessel_pedido_do_stylist`) CONTINUA EXIGINDO WHATSAPP.
-- Quem se inscreve sozinha pela landing está pedindo contato — sem telefone não
-- há como responder. O "só Instagram" é da Central, para quem a operação foi
-- atrás.
--
-- ⚠️ O ÍNDICE ÚNICO DE `whatsapp` FICA. No Postgres, nulos não colidem num
-- índice único: vinte parceiras sem telefone convivem, duas com o MESMO
-- telefone continuam impossíveis.
--
-- ⚠️ INSTAGRAM REPETIDO É RECUSADO NA FUNÇÃO, NÃO POR ÍNDICE ÚNICO. Um índice
-- derrubaria a porta pública: o `insert` dela só trata conflito de `whatsapp`
-- (`on conflict (whatsapp) do nothing`), e um conflito de Instagram estouraria
-- como erro cru na cara de quem está se inscrevendo. Na Central, onde a pessoa
-- que digita pode corrigir, a recusa volta com o código de quem já tem o perfil.
--
-- ⚠️ "NULO = NÃO MEXE" em `editar` continua valendo para WhatsApp e Instagram:
-- não há como APAGAR os dois pela tela, então a regra do CHECK não tem como ser
-- quebrada por uma correção. `observacoes` segue a irmã
-- `vessel_private_edit_situacao`: nula não mexe, string vazia apaga.

-- ── 1. a tabela ─────────────────────────────────────────────────────────────
alter table public.vessel_stylists alter column whatsapp drop not null;

alter table public.vessel_stylists
  add column if not exists observacoes text;

alter table public.vessel_stylists drop constraint if exists vessel_stylists_tem_contato;
alter table public.vessel_stylists add constraint vessel_stylists_tem_contato
  check (whatsapp is not null or nullif(btrim(coalesce(instagram, '')), '') is not null);

alter table public.vessel_stylists drop constraint if exists vessel_stylists_observacoes_curta;
alter table public.vessel_stylists add constraint vessel_stylists_observacoes_curta
  check (observacoes is null or length(observacoes) <= 2000);

comment on column public.vessel_stylists.whatsapp is
  'Canonico (55 + DDD + numero) pela vessel_telefone_canonico. Opcional desde '
  '24/09/2026: a parceira precisa ter WhatsApp OU Instagram (vessel_stylists_tem_contato).';
comment on column public.vessel_stylists.observacoes is
  'Texto livre da operacao: o que se sabe dela e nao tem campo (e-mail, site, '
  'o que a pesquisa de mapeamento achou). Ate 2000.';

-- ── 2. o Instagram, numa forma só para comparar ─────────────────────────────
-- '@Fulana', 'fulana', 'instagram.com/fulana/' e 'https://www.instagram.com/fulana?igsh=x'
-- são a MESMA pessoa. Devolve o perfil em minúsculas, sem @, ou nulo quando o
-- texto não é um perfil que dá para usar. ⚠️ SÓ PARA COMPARAR: o que se guarda
-- continua sendo o que a pessoa escreveu (a forma da casa, ver
-- `2026-09-23-beauty-session-pergunta-o-instagram.sql`).
create or replace function public.vessel_instagram_canonico(p_bruto text)
returns text
language sql
immutable
set search_path to 'public'
as $function$
  select case when h ~ '^[a-z0-9._]{1,30}$' then h end
    from (select regexp_replace(
                   regexp_replace(
                     regexp_replace(lower(btrim(coalesce(p_bruto, ''))),
                                    '^(https?://)?(www\.)?instagram\.com/', ''),
                     '[/?#].*$', ''),
                   '^@', '') as h) x
$function$;

revoke all on function public.vessel_instagram_canonico(text) from public, anon, authenticated;

-- ── 3. cadastrar ────────────────────────────────────────────────────────────
-- ⚠️ `drop` + `create`: a lista de parâmetros muda (entra `p_observacoes` no
-- fim), e `create or replace` criaria uma SEGUNDA função com o mesmo nome — o
-- PostgREST responderia "function is not unique" para a tela.
drop function if exists public.vessel_stylist_criar(text, text, text, text, text, text, text, text, text, date, text, date);

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
  p_observacoes    text default null
)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_fone   text;
  v_insta  text := nullif(trim(coalesce(p_instagram, '')), '');
  v_perfil text := public.vessel_instagram_canonico(p_instagram);
  v_obs    text := nullif(trim(coalesce(p_observacoes, '')), '');
  v_praca  text := upper(nullif(trim(coalesce(p_praca, '')), ''));
  v_loja   text := lower(nullif(trim(coalesce(p_loja, '')), ''));
  v_origem text := lower(nullif(trim(coalesce(p_origem_contato, '')), ''));
  v_hoje   date := (now() at time zone 'America/Sao_Paulo')::date;
  v_codigo text;
  v_n      int;
  v_volta  int;
  v_indice text;
  v_outra  text;
begin
  -- ⚠️ A TRAVA DE MEXER, NAO A DE VER (ver `2026-09-19-vessel-stylist-mexer.sql`).
  if not public.is_vessel_atendimentos_editar() then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;

  if nullif(trim(coalesce(p_nome, '')), '') is null then
    return json_build_object('ok', false, 'situacao', 'sem_nome');
  end if;

  -- ⚠️ WHATSAPP OU INSTAGRAM (24/09/2026). Telefone ESCRITO e inválido continua
  -- sendo recusado — jogá-lo fora calado e seguir só com o Instagram faria a
  -- parceira nascer sem o número que a pessoa achou que tinha gravado.
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
  -- Só com o Instagram, ele tem de ser um perfil de verdade: é o único jeito
  -- de chegar nela.
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
  -- ⚠️ NA CENTRAL A ORIGEM É OBRIGATÓRIA: quem cadastra à mão sabe como chegou
  -- nela. Cair em `inbound` por omissão contaria como "veio sozinha" quem foi
  -- indicada — e é exatamente a pergunta que o campo existe para responder.
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

  -- ⚠️ A TRAVA DE FILA E O CINTO, copiados da versão de 22/09 sem mudança: o
  -- código é sequencial (a porta pública numera igual), e duas chamadas ao
  -- mesmo tempo colidiriam no índice único sem a trava.
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
         observacoes)
      values
        (v_codigo, trim(p_nome), v_fone,
         nullif(trim(coalesce(p_cidade, '')), ''),
         v_insta,
         nullif(trim(coalesce(p_atuacao, '')), ''),
         v_praca, v_loja, v_origem,
         nullif(trim(coalesce(p_responsavel, '')), ''),
         coalesce(p_prospectado_em, v_hoje),
         nullif(trim(coalesce(p_proxima_acao, '')), ''),
         p_proxima_acao_em,
         v_obs);

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
drop function if exists public.vessel_stylist_editar(text, text, text, text, text, text, text, text, text, text, text, date, text, date, boolean);

create function public.vessel_stylist_editar(
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
  -- ⚠️ "NULO = NÃO MEXE" deixa sem jeito de APAGAR a próxima ação depois que
  -- ela foi feita. Este é o jeito, explícito.
  p_sem_proxima_acao boolean default false,
  -- ⚠️ A MESMA REGRA DA IRMÃ `vessel_private_edit_situacao`: nula não mexe,
  -- string vazia apaga.
  p_observacoes     text default null
)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  -- ⚠️ O CODIGO NORMALIZA UMA VEZ SO, igual às irmãs.
  v_codigo  text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
  v_fone    text;
  v_insta   text := nullif(trim(coalesce(p_instagram, '')), '');
  v_perfil  text := public.vessel_instagram_canonico(p_instagram);
  v_praca   text := upper(nullif(trim(coalesce(p_praca, '')), ''));
  v_loja    text := lower(nullif(trim(coalesce(p_loja, '')), ''));
  v_origem  text := lower(nullif(trim(coalesce(p_origem_contato, '')), ''));
  v_estagio text := lower(nullif(trim(coalesce(p_estagio, '')), ''));
  v_ativada timestamptz;
  v_fone_atual text;
begin
  if not public.is_vessel_atendimentos_editar() then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;

  select s.ativada_em, s.whatsapp into v_ativada, v_fone_atual
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
    -- Quem fica só com o Instagram precisa de um perfil que dá para usar.
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
  if p_prospectado_em is not null
     and p_prospectado_em > (now() at time zone 'America/Sao_Paulo')::date then
    return json_build_object('ok', false, 'situacao', 'prospeccao_no_futuro');
  end if;

  if v_estagio is not null then
    -- ⚠️ OS TRÊS DEGRAUS DO MEIO NÃO SE ESCOLHEM: saem dos encontros.
    if v_estagio in ('ativado', 'evento_realizado', 'recorrente') then
      return json_build_object('ok', false, 'situacao', 'estagio_automatico');
    end if;
    if v_estagio not in ('prospectado', 'contatado', 'interessado', 'em_negociacao',
                         'sem_retorno', 'nao_interessado', 'pausado', 'inativo') then
      return json_build_object('ok', false, 'situacao', 'estagio_invalido');
    end if;
    -- ⚠️ E QUEM JÁ TEVE ENCONTRO NÃO VOLTA PARA ANTES DELE.
    if v_ativada is not null and v_estagio in ('prospectado', 'contatado', 'interessado',
                                               'em_negociacao') then
      return json_build_object('ok', false, 'situacao', 'estagio_contradiz_encontro');
    end if;
  end if;

  update public.vessel_stylists s
     set nome            = coalesce(nullif(trim(coalesce(p_nome, '')), ''), s.nome),
         whatsapp        = coalesce(v_fone, s.whatsapp),
         cidade          = coalesce(nullif(trim(coalesce(p_cidade, '')), ''), s.cidade),
         instagram       = coalesce(v_insta, s.instagram),
         atuacao         = coalesce(nullif(trim(coalesce(p_atuacao, '')), ''), s.atuacao),
         estagio         = coalesce(v_estagio, s.estagio),
         praca_preview   = coalesce(v_praca, s.praca_preview),
         loja            = coalesce(v_loja, s.loja),
         origem_contato  = coalesce(v_origem, s.origem_contato),
         responsavel     = coalesce(nullif(trim(coalesce(p_responsavel, '')), ''), s.responsavel),
         prospectado_em  = coalesce(p_prospectado_em, s.prospectado_em),
         proxima_acao    = case when coalesce(p_sem_proxima_acao, false) then null
                                else coalesce(nullif(trim(coalesce(p_proxima_acao, '')), ''),
                                              s.proxima_acao) end,
         proxima_acao_em = case when coalesce(p_sem_proxima_acao, false) then null
                                else coalesce(p_proxima_acao_em, s.proxima_acao_em) end,
         observacoes     = case when p_observacoes is null then s.observacoes
                                else nullif(trim(p_observacoes), '') end,
         atualizado_em   = now()
   where s.codigo = v_codigo;

  -- ⚠️ SAIR DE "PAUSADO" DEVOLVE O FUNIL AO FATO: se ela tem encontros, o
  -- estágio certo é o que eles dizem, não o que a pessoa escolheu.
  perform public.vessel_stylist_seguir_os_encontros(
    (select s.id from public.vessel_stylists s where s.codigo = v_codigo));

  return json_build_object('ok', true, 'situacao', 'ok', 'codigo', v_codigo);
end;
$function$;

-- ── 5. a lista da tela devolve as observações ───────────────────────────────
-- ⚠️ `create or replace` COM A MESMA ASSINATURA: o texto é o que está no banco
-- (medido com `pg_get_functiondef` em 24/09/2026), com UMA chave a mais.
create or replace function public.vessel_rastreio_dos_stylists(p_dias integer default 7, p_incluir_desativadas boolean default false)
 returns json
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
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
        'estagio', s.estagio,
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
        'ativada_em', s.ativada_em,
        'encontros_realizados', ee.realizados,
        'ultima_private_edit', ee.ultima,
        -- ⚠️ "ÚLTIMO EVENTO + 45 DIAS", do documento. É aviso para quem agenda,
        -- não trava: o banco não recusa um encontro antes disso.
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
        -- ⚠️ A RECEITA PELO LINK: compra de quem a stylist trouxe, perto de
        -- qualquer visita. T11 acrescenta `situacao_id = 9` — só pedido
        -- atendido no Bling, a mesma régua do resto.
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
    'public.vessel_stylist_criar(text, text, text, text, text, text, text, text, text, date, text, date, text)',
    'public.vessel_stylist_editar(text, text, text, text, text, text, text, text, text, text, text, date, text, date, boolean, text)',
    'public.vessel_rastreio_dos_stylists(integer, boolean)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
