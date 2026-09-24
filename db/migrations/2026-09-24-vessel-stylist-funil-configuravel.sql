-- O FUNIL DA STYLIST PASSA A SER CONFIGURÁVEL.
--
-- Decisão do dono em 24/09/2026. As etapas deixam de ser uma lista fechada no
-- código e viram LINHAS de uma tabela, que a operação mexe pela tela "Etapas do
-- funil" (adicionar, renomear, reordenar, marcar saída, excluir movendo quem
-- está nela). As etapas iniciais, nesta ordem:
--   Identificado → Classificação → Prospectado → Convidado → Confirmado →
--   Presença Confirmada; e Desclassificado como SAÍDA.
-- Convidado, Confirmado e Presença Confirmada falam do Private Edit da stylist.
--
-- ── O QUE SAI ───────────────────────────────────────────────────────────────
--
--   · a coluna `vessel_stylists.estagio` e a CHECK de lista fechada dela (os
--     doze estágios antigos: identificada … inativo);
--   · TODO movimento automático de etapa: o gatilho dos encontros não mexe
--     mais na etapa (nem "ativado", nem "evento realizado", nem "recorrente");
--     ele só congela `ativada_em`, que o placar usa;
--   · a sugestão de etapa depois de um contato (`vessel_stylist_sugestao_de_etapa`).
--     O histórico de contatos continua igual.
--
-- ⚠️ SÓ RODA COM A BASE VAZIA: não há de-para dos estágios antigos para as
-- etapas novas (a decisão do dono foi recomeçar), então a migration aborta se
-- existir uma stylist sequer. Medido em 24/09/2026: 0.
--
-- ── A DATA DA PROSPECÇÃO (o "prospectadas" do placar) ───────────────────────
--
-- Uma etapa, e só uma, fica marcada "daqui em diante conta como prospectada"
-- (começa em Prospectado). `prospectado_em` é preenchida, SE ESTIVER VAZIA, no
-- dia em que a stylist chega pela primeira vez na etapa marcada ou numa etapa
-- de funil POSTERIOR a ela (pela ordem). Quem faz isso é um gatilho da tabela,
-- não cada função: qualquer porta que mude a etapa (a ficha, o quadro, a
-- exclusão de uma etapa) segue a mesma regra.
-- ⚠️ Se a marca mudar de etapa depois, as datas já gravadas NÃO mudam — a taxa
-- do mês passado não pode mudar de valor porque alguém reorganizou o funil
-- hoje. `vessel_placar_do_stylist_circle` NÃO muda: ele já conta prospectadas
-- por `prospectado_em`.
--
-- ── O HISTÓRICO DE ETAPAS ───────────────────────────────────────────────────
--
-- `vessel_stylist_etapas_historico`: uma linha por mudança de etapa (a entrada
-- inicial inclusive, e as mudanças feitas pela exclusão de uma etapa), com quem
-- e quando. SÓ ACRESCENTA: `update` e `delete` levantam erro. A mesma coisa
-- para `vessel_stylist_etapas_trilha`, que guarda quem mudou o quê no funil.
--
-- ── A CENTRAL QUE ESTÁ NO AR (a de antes desta migration) ───────────────────
--
-- ⚠️ `vessel_stylist_criar` e `vessel_stylist_editar` continuam aceitando os
-- corpos da tela antiga, para o intervalo até a Central nova subir:
--   · `p_prospectado_em` continua existindo nas duas e é IGNORADO (a data agora
--     é da regra acima). A tela antiga manda "hoje" por padrão.
--   · `p_estagio` continua existindo em `editar`: nulo passa, qualquer valor é
--     recusado com `etapa_pela_ficha` (mudar de etapa agora é
--     `vessel_stylist_mover_de_etapa`). O "Avançar" do quadro antigo recusa.
-- A lista (`vessel_rastreio_dos_stylists`) deixa de devolver `estagio`; a tela
-- antiga mostra "Sem estágio" e junta todo mundo numa coluna.

-- ── 0. a base tem de estar vazia ────────────────────────────────────────────
do $$
begin
  if (select count(*) from public.vessel_stylists) > 0 then
    raise exception 'vessel_stylists nao esta vazia (% linhas): esta migration nao tem de-para dos estagios antigos',
      (select count(*) from public.vessel_stylists);
  end if;
end $$;

-- ── 1. o "só acrescenta" ────────────────────────────────────────────────────
create or replace function public.vessel_so_acrescenta()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  raise exception '% e so-acrescenta: % nao e permitido', tg_table_name, lower(tg_op)
    using errcode = '42501';
end;
$function$;
revoke all on function public.vessel_so_acrescenta() from public, anon, authenticated;

-- ── 2. as etapas ────────────────────────────────────────────────────────────
create table public.vessel_stylist_etapas (
  id                     bigserial primary key,
  nome                   text not null,
  ordem                  int  not null,
  tipo                   text not null default 'funil',
  conta_como_prospectada boolean not null default false,
  -- ⚠️ EXCLUIR NÃO APAGA A LINHA: o histórico de etapas aponta para ela. A
  -- etapa excluída sai da tela e das listas, e o nome volta a ficar livre.
  ativa                  boolean not null default true,
  criado_por             uuid,
  criado_por_nome        text,
  criado_em              timestamptz not null default now(),
  alterado_por           uuid,
  alterado_por_nome      text,
  alterado_em            timestamptz not null default now(),
  excluida_em            timestamptz,
  constraint vessel_stylist_etapas_tipo_valido check (tipo in ('funil', 'saida')),
  constraint vessel_stylist_etapas_nome_curto check (length(btrim(nome)) between 1 and 60),
  constraint vessel_stylist_etapas_marca_no_funil check (not conta_como_prospectada or (tipo = 'funil' and ativa))
);

-- Nome único entre as ativas, sem diferença de maiúscula.
create unique index vessel_stylist_etapas_nome_idx
  on public.vessel_stylist_etapas (lower(btrim(nome))) where ativa;
-- Uma, e só uma, marcada como "conta como prospectada".
create unique index vessel_stylist_etapas_uma_prospectada_idx
  on public.vessel_stylist_etapas (conta_como_prospectada) where conta_como_prospectada;

alter table public.vessel_stylist_etapas enable row level security;
revoke all on table public.vessel_stylist_etapas from anon, authenticated;

comment on table public.vessel_stylist_etapas is
  'As etapas do funil da stylist (configuraveis pela tela "Etapas do funil"). RLS ligada e SEM '
  'politica: so as funcoes security definer leem e escrevem. Excluir e `ativa = false`.';

insert into public.vessel_stylist_etapas (nome, ordem, tipo, conta_como_prospectada, criado_por_nome, alterado_por_nome)
values ('Identificado', 1, 'funil', false, 'migration 2026-09-24', 'migration 2026-09-24'),
       ('Classificação', 2, 'funil', false, 'migration 2026-09-24', 'migration 2026-09-24'),
       ('Prospectado', 3, 'funil', true, 'migration 2026-09-24', 'migration 2026-09-24'),
       ('Convidado', 4, 'funil', false, 'migration 2026-09-24', 'migration 2026-09-24'),
       ('Confirmado', 5, 'funil', false, 'migration 2026-09-24', 'migration 2026-09-24'),
       ('Presença Confirmada', 6, 'funil', false, 'migration 2026-09-24', 'migration 2026-09-24'),
       ('Desclassificado', 7, 'saida', false, 'migration 2026-09-24', 'migration 2026-09-24');

-- Quem mudou o quê no funil, e quando.
create table public.vessel_stylist_etapas_trilha (
  id        bigserial primary key,
  etapa_id  bigint not null references public.vessel_stylist_etapas(id),
  acao      text not null,
  antes     jsonb,
  depois    jsonb,
  por       uuid,
  por_nome  text,
  em        timestamptz not null default now(),
  constraint vessel_stylist_etapas_trilha_acao_valida check (acao in
    ('criar', 'renomear', 'reordenar', 'tipo', 'marcar_prospectada', 'excluir'))
);
alter table public.vessel_stylist_etapas_trilha enable row level security;
revoke all on table public.vessel_stylist_etapas_trilha from anon, authenticated;
create trigger vessel_stylist_etapas_trilha_so_acrescenta
  before update or delete on public.vessel_stylist_etapas_trilha
  for each row execute function public.vessel_so_acrescenta();

-- ── 3. a stylist aponta para a etapa ────────────────────────────────────────
alter table public.vessel_stylists drop constraint if exists vessel_stylists_estagio_valido;
alter table public.vessel_stylists drop constraint if exists vessel_stylists_identificada_sem_prospeccao;
alter table public.vessel_stylists drop column estagio;
-- ⚠️ A data agora é da regra (gatilho abaixo), não do dia do cadastro.
alter table public.vessel_stylists alter column prospectado_em drop default;
-- ⚠️ `not null` sem default numa tabela com linhas quebraria; a tabela está
-- vazia (conferido no passo 0) e quem preenche na inserção é o gatilho.
alter table public.vessel_stylists
  add column etapa_id bigint not null references public.vessel_stylist_etapas(id);
create index vessel_stylists_etapa_idx on public.vessel_stylists (etapa_id);

comment on column public.vessel_stylists.etapa_id is
  'A etapa do funil (vessel_stylist_etapas). Nasce na primeira etapa de funil pela ordem.';
comment on column public.vessel_stylists.prospectado_em is
  'Dia em que ela chegou pela primeira vez na etapa marcada "conta como prospectada" ou numa '
  'etapa de funil posterior. Preenchida uma vez so, pelo gatilho; o placar conta prospectadas por ela.';

-- O histórico de etapas.
create table public.vessel_stylist_etapas_historico (
  id            bigserial primary key,
  stylist_id    bigint not null references public.vessel_stylists(id),
  de_etapa_id   bigint references public.vessel_stylist_etapas(id),
  para_etapa_id bigint not null references public.vessel_stylist_etapas(id),
  motivo        text not null,
  por           uuid,
  por_nome      text,
  em            timestamptz not null default now(),
  teste         boolean not null default false,
  constraint vessel_stylist_etapas_historico_motivo_valido check (motivo in ('cadastro', 'mudanca', 'etapa_excluida'))
);
create index vessel_stylist_etapas_historico_stylist_idx
  on public.vessel_stylist_etapas_historico (stylist_id, em);
alter table public.vessel_stylist_etapas_historico enable row level security;
revoke all on table public.vessel_stylist_etapas_historico from anon, authenticated;
create trigger vessel_stylist_etapas_historico_so_acrescenta
  before update or delete on public.vessel_stylist_etapas_historico
  for each row execute function public.vessel_so_acrescenta();

-- ── 4. os gatilhos da etapa ─────────────────────────────────────────────────
-- "Esta etapa, para esta regra, já conta como prospectada?": é a marcada, ou
-- uma de funil depois dela pela ordem.
create or replace function public.vessel_etapa_conta_como_prospectada(p_etapa bigint)
returns boolean
language sql
stable
set search_path to 'public'
as $function$
  select coalesce((
    select e.tipo = 'funil' and e.ordem >= m.ordem
      from public.vessel_stylist_etapas e
      cross join (select ordem from public.vessel_stylist_etapas
                   where conta_como_prospectada and ativa limit 1) m
     where e.id = p_etapa), false)
$function$;
revoke all on function public.vessel_etapa_conta_como_prospectada(bigint) from public, anon, authenticated;

create or replace function public.vessel_stylists_etapa_antes()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- Cadastro novo entra na PRIMEIRA etapa de funil, pela ordem.
  if new.etapa_id is null then
    select e.id into new.etapa_id from public.vessel_stylist_etapas e
     where e.ativa and e.tipo = 'funil' order by e.ordem, e.id limit 1;
  end if;
  if not exists (select 1 from public.vessel_stylist_etapas e where e.id = new.etapa_id and e.ativa) then
    raise exception 'etapa % nao existe ou foi excluida', new.etapa_id using errcode = '23503';
  end if;
  -- ⚠️ A DATA DA PROSPECÇÃO: uma vez só, na primeira chegada.
  if new.prospectado_em is null and public.vessel_etapa_conta_como_prospectada(new.etapa_id) then
    new.prospectado_em := (now() at time zone 'America/Sao_Paulo')::date;
  end if;
  return new;
end;
$function$;
revoke all on function public.vessel_stylists_etapa_antes() from public, anon, authenticated;

create or replace function public.vessel_stylists_etapa_depois()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if tg_op = 'INSERT' or new.etapa_id is distinct from old.etapa_id then
    insert into public.vessel_stylist_etapas_historico
      (stylist_id, de_etapa_id, para_etapa_id, motivo, por, por_nome, teste)
    values (new.id,
            case when tg_op = 'INSERT' then null else old.etapa_id end,
            new.etapa_id,
            case when tg_op = 'INSERT' then 'cadastro'
                 -- quem muda por exclusão de etapa avisa por esta variável da transação
                 when current_setting('vessel.motivo_da_etapa', true) = 'etapa_excluida' then 'etapa_excluida'
                 else 'mudanca' end,
            auth.uid(),
            (select coalesce(nullif(trim(p.name), ''), p.email) from public.profiles p where p.id = auth.uid()),
            new.teste);
  end if;
  return null;
end;
$function$;
revoke all on function public.vessel_stylists_etapa_depois() from public, anon, authenticated;

create trigger vessel_stylists_etapa_antes
  before insert or update of etapa_id on public.vessel_stylists
  for each row execute function public.vessel_stylists_etapa_antes();
create trigger vessel_stylists_etapa_depois
  after insert or update of etapa_id on public.vessel_stylists
  for each row execute function public.vessel_stylists_etapa_depois();

-- ── 5. o gatilho dos encontros: SEM mexer na etapa ──────────────────────────
-- ⚠️ MESMA ASSINATURA (o gatilho `vessel_private_edits_mexe_no_funil` chama
-- esta). Só sobra a ativação, que congela na primeira vez e o placar usa.
create or replace function public.vessel_stylist_seguir_os_encontros(p_stylist bigint)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if p_stylist is null then return; end if;
  if exists (select 1 from public.vessel_private_edits e
              where e.stylist_id = p_stylist and not coalesce(e.arquivada, false)
                and e.status in ('agendado', 'confirmado', 'reagendado',
                                 'realizado', 'nao_realizado', 'cancelado')) then
    update public.vessel_stylists set ativada_em = now()
     where id = p_stylist and ativada_em is null;
  end if;
end;
$function$;
revoke all on function public.vessel_stylist_seguir_os_encontros(bigint) from public, anon, authenticated;

-- ── 6. sem sugestão de etapa ────────────────────────────────────────────────
create or replace function public.vessel_stylist_registrar_contato(
  p_codigo text, p_canal text, p_resultado text, p_nota text default null,
  p_proxima_acao text default null, p_proxima_acao_em date default null)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_codigo text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
  v_canal  text := lower(nullif(trim(coalesce(p_canal, '')), ''));
  v_res    text := lower(nullif(trim(coalesce(p_resultado, '')), ''));
  v_nota   text := nullif(trim(coalesce(p_nota, '')), '');
  v_s      public.vessel_stylists%rowtype;
  v_id     bigint;
begin
  if not public.is_vessel_atendimentos_editar() then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  select * into v_s from public.vessel_stylists where codigo = v_codigo;
  if v_s.id is null then return json_build_object('ok', false, 'situacao', 'nao_achei'); end if;
  if v_canal is null or v_canal not in ('whatsapp', 'ligacao', 'instagram', 'email', 'presencial') then
    return json_build_object('ok', false, 'situacao', 'canal_invalido');
  end if;
  if v_res is null or v_res not in ('sem_resposta', 'conversou', 'interesse', 'proposta', 'marcou_encontro', 'recusou') then
    return json_build_object('ok', false, 'situacao', 'resultado_invalido');
  end if;
  if v_nota is not null and length(v_nota) > 500 then
    return json_build_object('ok', false, 'situacao', 'nota_longa');
  end if;

  insert into public.vessel_stylist_contatos
    (stylist_id, canal, resultado, nota, criado_por, criado_por_nome, teste)
  values (v_s.id, v_canal, v_res, v_nota, auth.uid(),
          (select coalesce(nullif(trim(p.name), ''), p.email) from public.profiles p where p.id = auth.uid()),
          v_s.teste)
  returning id into v_id;

  -- A próxima ação escrita aqui SUBSTITUI a de hoje; vazia, a de hoje fica.
  if nullif(trim(coalesce(p_proxima_acao, '')), '') is not null then
    update public.vessel_stylists
       set proxima_acao = trim(p_proxima_acao), proxima_acao_em = p_proxima_acao_em, atualizado_em = now()
     where id = v_s.id;
  end if;

  -- ⚠️ SEM `sugestao` (24/09/2026): nenhum movimento de etapa sai de um contato.
  return json_build_object('ok', true, 'situacao', 'ok', 'id', v_id);
end;
$function$;

drop function if exists public.vessel_stylist_sugestao_de_etapa(text, text, timestamptz);

-- ── 7. cadastrar ────────────────────────────────────────────────────────────
drop function if exists public.vessel_stylist_criar(text, text, text, text, text, text, text, text, text, date, text, date, text, text);

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
  -- ⚠️ LEGADO, IGNORADO: a Central antiga manda "hoje". A data agora é da regra
  -- da etapa marcada (ver o cabeçalho). Sai quando a Central nova estiver no ar.
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
         loja, origem_contato, responsavel, proxima_acao, proxima_acao_em, observacoes)
      values
        (v_codigo, trim(p_nome), v_fone,
         nullif(trim(coalesce(p_cidade, '')), ''),
         v_insta,
         nullif(trim(coalesce(p_atuacao, '')), ''),
         v_praca, v_loja, v_origem,
         nullif(trim(coalesce(p_responsavel, '')), ''),
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

-- ── 8. corrigir (MESMA assinatura; etapa não muda por aqui) ─────────────────
create or replace function public.vessel_stylist_editar(
  p_codigo          text,
  p_nome            text default null,
  p_whatsapp        text default null,
  p_cidade          text default null,
  p_instagram       text default null,
  p_atuacao         text default null,
  -- ⚠️ LEGADO: nulo passa; qualquer valor é recusado (`etapa_pela_ficha`).
  p_estagio         text default null,
  p_praca           text default null,
  p_loja            text default null,
  p_origem_contato  text default null,
  p_responsavel     text default null,
  -- ⚠️ LEGADO, IGNORADO: a data da prospecção é da regra da etapa marcada.
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
  v_fone_atual text;
begin
  if not public.is_vessel_atendimentos_editar() then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;

  select s.whatsapp into v_fone_atual from public.vessel_stylists s where s.codigo = v_codigo;
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
         atualizado_em   = now()
   where s.codigo = v_codigo;

  return json_build_object('ok', true, 'situacao', 'ok', 'codigo', v_codigo);
end;
$function$;

-- ── 9. mover a stylist de etapa ─────────────────────────────────────────────
create or replace function public.vessel_stylist_mover_de_etapa(p_codigo text, p_etapa_id bigint)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_codigo text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
  v_s      public.vessel_stylists%rowtype;
begin
  if not public.is_vessel_atendimentos_editar() then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  select * into v_s from public.vessel_stylists where codigo = v_codigo;
  if v_s.id is null then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;
  if not exists (select 1 from public.vessel_stylist_etapas e where e.id = p_etapa_id and e.ativa) then
    return json_build_object('ok', false, 'situacao', 'etapa_invalida');
  end if;
  if v_s.etapa_id = p_etapa_id then
    return json_build_object('ok', true, 'situacao', 'sem_mudanca', 'codigo', v_codigo);
  end if;
  update public.vessel_stylists set etapa_id = p_etapa_id, atualizado_em = now() where id = v_s.id;
  return json_build_object('ok', true, 'situacao', 'ok', 'codigo', v_codigo,
    'prospectado_em', (select prospectado_em from public.vessel_stylists where id = v_s.id));
end;
$function$;

-- O histórico de etapas de uma stylist, do mais novo para o mais velho.
create or replace function public.vessel_stylist_historico_de_etapas(p_codigo text)
returns json
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_id bigint;
begin
  if not public.is_vessel_atendimentos() then
    raise exception 'sem permissao' using errcode = '42501';
  end if;
  select id into v_id from public.vessel_stylists where codigo = upper(trim(coalesce(p_codigo, '')));
  return coalesce((
    select json_agg(json_build_object(
             'id', h.id, 'de', de.nome, 'para', para.nome, 'motivo', h.motivo,
             'por_nome', h.por_nome, 'em', h.em) order by h.em desc, h.id desc)
      from public.vessel_stylist_etapas_historico h
      left join public.vessel_stylist_etapas de on de.id = h.de_etapa_id
      join public.vessel_stylist_etapas para on para.id = h.para_etapa_id
     where h.stylist_id = v_id), '[]'::json);
end;
$function$;

-- ── 10. as etapas: ler e mexer ──────────────────────────────────────────────
create or replace function public.vessel_stylist_etapas()
returns json
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_vessel_atendimentos() then
    raise exception 'sem permissao' using errcode = '42501';
  end if;
  return coalesce((
    select json_agg(json_build_object(
             'id', e.id, 'nome', e.nome, 'ordem', e.ordem, 'tipo', e.tipo,
             'conta_como_prospectada', e.conta_como_prospectada,
             'stylists', (select count(*)::int from public.vessel_stylists s
                           where s.etapa_id = e.id and not coalesce(s.teste, false)),
             'alterado_em', e.alterado_em, 'alterado_por_nome', e.alterado_por_nome)
           order by e.ordem, e.id)
      from public.vessel_stylist_etapas e where e.ativa), '[]'::json);
end;
$function$;

-- O miolo das escritas no funil: a fila, quem é, e a trilha.
create or replace function public.vessel_stylist_etapas_anotar(
  p_etapa bigint, p_acao text, p_antes jsonb, p_depois jsonb)
returns void
language sql
security definer
set search_path to 'public'
as $function$
  insert into public.vessel_stylist_etapas_trilha (etapa_id, acao, antes, depois, por, por_nome)
  values (p_etapa, p_acao, p_antes, p_depois, auth.uid(),
          (select coalesce(nullif(trim(p.name), ''), p.email) from public.profiles p where p.id = auth.uid()));
  update public.vessel_stylist_etapas
     set alterado_por = auth.uid(),
         alterado_por_nome = (select coalesce(nullif(trim(p.name), ''), p.email) from public.profiles p where p.id = auth.uid()),
         alterado_em = now()
   where id = p_etapa;
$function$;
revoke all on function public.vessel_stylist_etapas_anotar(bigint, text, jsonb, jsonb) from public, anon, authenticated;

-- Renumera as ativas 1..n pela ordem de agora.
create or replace function public.vessel_stylist_etapas_renumerar()
returns void
language sql
security definer
set search_path to 'public'
as $function$
  update public.vessel_stylist_etapas e set ordem = x.n
    from (select id, row_number() over (order by ordem, id)::int as n
            from public.vessel_stylist_etapas where ativa) x
   where e.id = x.id and e.ordem is distinct from x.n;
$function$;
revoke all on function public.vessel_stylist_etapas_renumerar() from public, anon, authenticated;

create or replace function public.vessel_stylist_etapa_criar(
  p_nome text, p_posicao integer default null, p_tipo text default 'funil')
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_nome text := btrim(coalesce(p_nome, ''));
  v_tipo text := lower(btrim(coalesce(p_tipo, 'funil')));
  v_n    int;
  v_pos  int;
  v_id   bigint;
begin
  if not public.is_vessel_atendimentos_editar() then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  if v_nome = '' then return json_build_object('ok', false, 'situacao', 'sem_nome'); end if;
  if length(v_nome) > 60 then return json_build_object('ok', false, 'situacao', 'nome_longo'); end if;
  if v_tipo not in ('funil', 'saida') then return json_build_object('ok', false, 'situacao', 'tipo_invalido'); end if;

  perform pg_advisory_xact_lock(hashtext('public.vessel_stylist_etapas')::bigint);
  if exists (select 1 from public.vessel_stylist_etapas where ativa and lower(btrim(nome)) = lower(v_nome)) then
    return json_build_object('ok', false, 'situacao', 'nome_repetido');
  end if;
  select count(*)::int into v_n from public.vessel_stylist_etapas where ativa;
  v_pos := least(greatest(coalesce(p_posicao, v_n + 1), 1), v_n + 1);
  update public.vessel_stylist_etapas set ordem = ordem + 1 where ativa and ordem >= v_pos;
  insert into public.vessel_stylist_etapas (nome, ordem, tipo, criado_por, criado_por_nome)
  values (v_nome, v_pos, v_tipo, auth.uid(),
          (select coalesce(nullif(trim(p.name), ''), p.email) from public.profiles p where p.id = auth.uid()))
  returning id into v_id;
  perform public.vessel_stylist_etapas_renumerar();
  perform public.vessel_stylist_etapas_anotar(v_id, 'criar', null,
    jsonb_build_object('nome', v_nome, 'ordem', v_pos, 'tipo', v_tipo));
  return json_build_object('ok', true, 'situacao', 'ok', 'id', v_id);
end;
$function$;

create or replace function public.vessel_stylist_etapa_renomear(p_id bigint, p_nome text)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_nome  text := btrim(coalesce(p_nome, ''));
  v_antes text;
begin
  if not public.is_vessel_atendimentos_editar() then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  if v_nome = '' then return json_build_object('ok', false, 'situacao', 'sem_nome'); end if;
  if length(v_nome) > 60 then return json_build_object('ok', false, 'situacao', 'nome_longo'); end if;
  perform pg_advisory_xact_lock(hashtext('public.vessel_stylist_etapas')::bigint);
  select nome into v_antes from public.vessel_stylist_etapas where id = p_id and ativa;
  if v_antes is null then return json_build_object('ok', false, 'situacao', 'nao_achei'); end if;
  if exists (select 1 from public.vessel_stylist_etapas
              where ativa and id <> p_id and lower(btrim(nome)) = lower(v_nome)) then
    return json_build_object('ok', false, 'situacao', 'nome_repetido');
  end if;
  update public.vessel_stylist_etapas set nome = v_nome where id = p_id;
  perform public.vessel_stylist_etapas_anotar(p_id, 'renomear',
    jsonb_build_object('nome', v_antes), jsonb_build_object('nome', v_nome));
  return json_build_object('ok', true, 'situacao', 'ok', 'id', p_id);
end;
$function$;

-- Subir ou descer uma posição (troca com a vizinha, entre as ativas).
create or replace function public.vessel_stylist_etapa_mover(p_id bigint, p_direcao text)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ordem  int;
  v_viz    bigint;
  v_ordviz int;
begin
  if not public.is_vessel_atendimentos_editar() then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  if p_direcao not in ('subir', 'descer') then
    return json_build_object('ok', false, 'situacao', 'direcao_invalida');
  end if;
  perform pg_advisory_xact_lock(hashtext('public.vessel_stylist_etapas')::bigint);
  perform public.vessel_stylist_etapas_renumerar();
  select ordem into v_ordem from public.vessel_stylist_etapas where id = p_id and ativa;
  if v_ordem is null then return json_build_object('ok', false, 'situacao', 'nao_achei'); end if;
  select id, ordem into v_viz, v_ordviz from public.vessel_stylist_etapas
   where ativa and ordem = v_ordem + case when p_direcao = 'subir' then -1 else 1 end;
  if v_viz is null then return json_build_object('ok', false, 'situacao', 'no_limite'); end if;
  update public.vessel_stylist_etapas set ordem = v_ordviz where id = p_id;
  update public.vessel_stylist_etapas set ordem = v_ordem where id = v_viz;
  perform public.vessel_stylist_etapas_anotar(p_id, 'reordenar',
    jsonb_build_object('ordem', v_ordem), jsonb_build_object('ordem', v_ordviz));
  return json_build_object('ok', true, 'situacao', 'ok', 'id', p_id);
end;
$function$;

-- Funil ↔ saída.
create or replace function public.vessel_stylist_etapa_tipo(p_id bigint, p_tipo text)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tipo  text := lower(btrim(coalesce(p_tipo, '')));
  v_e     public.vessel_stylist_etapas%rowtype;
begin
  if not public.is_vessel_atendimentos_editar() then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  if v_tipo not in ('funil', 'saida') then return json_build_object('ok', false, 'situacao', 'tipo_invalido'); end if;
  perform pg_advisory_xact_lock(hashtext('public.vessel_stylist_etapas')::bigint);
  select * into v_e from public.vessel_stylist_etapas where id = p_id and ativa;
  if v_e.id is null then return json_build_object('ok', false, 'situacao', 'nao_achei'); end if;
  if v_e.tipo = v_tipo then return json_build_object('ok', true, 'situacao', 'sem_mudanca', 'id', p_id); end if;
  if v_tipo = 'saida' then
    if v_e.conta_como_prospectada then
      return json_build_object('ok', false, 'situacao', 'etapa_marcada');
    end if;
    if (select count(*) from public.vessel_stylist_etapas where ativa and tipo = 'funil') <= 1 then
      return json_build_object('ok', false, 'situacao', 'ultima_do_funil');
    end if;
  end if;
  update public.vessel_stylist_etapas set tipo = v_tipo where id = p_id;
  perform public.vessel_stylist_etapas_anotar(p_id, 'tipo',
    jsonb_build_object('tipo', v_e.tipo), jsonb_build_object('tipo', v_tipo));
  return json_build_object('ok', true, 'situacao', 'ok', 'id', p_id);
end;
$function$;

-- Qual etapa marca "daqui em diante conta como prospectada".
-- ⚠️ AS DATAS JÁ GRAVADAS NÃO MUDAM: a marca só vale para quem chegar depois.
create or replace function public.vessel_stylist_etapa_marcar_prospectada(p_id bigint)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_e     public.vessel_stylist_etapas%rowtype;
  v_antes bigint;
begin
  if not public.is_vessel_atendimentos_editar() then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  perform pg_advisory_xact_lock(hashtext('public.vessel_stylist_etapas')::bigint);
  select * into v_e from public.vessel_stylist_etapas where id = p_id and ativa;
  if v_e.id is null then return json_build_object('ok', false, 'situacao', 'nao_achei'); end if;
  if v_e.tipo <> 'funil' then return json_build_object('ok', false, 'situacao', 'saida_nao_conta'); end if;
  if v_e.conta_como_prospectada then return json_build_object('ok', true, 'situacao', 'sem_mudanca', 'id', p_id); end if;
  select id into v_antes from public.vessel_stylist_etapas where conta_como_prospectada;
  -- Primeiro desmarca, depois marca: o índice único não aceita duas ao mesmo tempo.
  update public.vessel_stylist_etapas set conta_como_prospectada = false where conta_como_prospectada;
  update public.vessel_stylist_etapas set conta_como_prospectada = true where id = p_id;
  perform public.vessel_stylist_etapas_anotar(p_id, 'marcar_prospectada',
    jsonb_build_object('etapa_marcada', v_antes), jsonb_build_object('etapa_marcada', p_id));
  return json_build_object('ok', true, 'situacao', 'ok', 'id', p_id);
end;
$function$;

-- Excluir. Quem está nela vai para o destino, TUDO numa transação só.
create or replace function public.vessel_stylist_etapa_excluir(p_id bigint, p_destino bigint default null)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_e      public.vessel_stylist_etapas%rowtype;
  v_n      int;
begin
  if not public.is_vessel_atendimentos_editar() then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  perform pg_advisory_xact_lock(hashtext('public.vessel_stylist_etapas')::bigint);
  select * into v_e from public.vessel_stylist_etapas where id = p_id and ativa;
  if v_e.id is null then return json_build_object('ok', false, 'situacao', 'nao_achei'); end if;
  if v_e.tipo = 'funil' and (select count(*) from public.vessel_stylist_etapas where ativa and tipo = 'funil') <= 1 then
    return json_build_object('ok', false, 'situacao', 'ultima_do_funil');
  end if;
  if v_e.conta_como_prospectada then
    return json_build_object('ok', false, 'situacao', 'etapa_marcada');
  end if;
  select count(*)::int into v_n from public.vessel_stylists where etapa_id = p_id;
  if v_n > 0 then
    if p_destino is null then
      return json_build_object('ok', false, 'situacao', 'precisa_destino', 'stylists', v_n);
    end if;
    if p_destino = p_id or not exists (select 1 from public.vessel_stylist_etapas where id = p_destino and ativa) then
      return json_build_object('ok', false, 'situacao', 'destino_invalido');
    end if;
    -- ⚠️ O HISTÓRICO DIZ POR QUE ELAS MUDARAM (o gatilho lê esta variável).
    perform set_config('vessel.motivo_da_etapa', 'etapa_excluida', true);
    update public.vessel_stylists set etapa_id = p_destino, atualizado_em = now() where etapa_id = p_id;
    perform set_config('vessel.motivo_da_etapa', '', true);
  end if;
  update public.vessel_stylist_etapas set ativa = false, excluida_em = now() where id = p_id;
  perform public.vessel_stylist_etapas_renumerar();
  perform public.vessel_stylist_etapas_anotar(p_id, 'excluir',
    jsonb_build_object('nome', v_e.nome, 'ordem', v_e.ordem, 'tipo', v_e.tipo),
    jsonb_build_object('destino', p_destino, 'stylists_movidas', v_n));
  return json_build_object('ok', true, 'situacao', 'ok', 'id', p_id, 'movidas', v_n);
end;
$function$;

-- ── 11. a lista da tela (texto do banco + a etapa no lugar do estágio) ──────
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
        -- ⚠️ 24/09/2026: a etapa é uma linha de `vessel_stylist_etapas`.
        'etapa_id', s.etapa_id,
        'etapa', et.nome,
        'etapa_tipo', et.tipo,
        'etapa_ordem', et.ordem,
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

-- ── 12. as portas ───────────────────────────────────────────────────────────
-- ⚠️ `revoke ... from public` NÃO FECHA `anon`, e função nova em `public` nasce
-- executável por `public`. As duas linhas de cada uma são obrigatórias.
do $$
declare f text;
begin
  foreach f in array array[
    'public.vessel_stylist_criar(text, text, text, text, text, text, text, text, text, date, text, date, text)',
    'public.vessel_stylist_editar(text, text, text, text, text, text, text, text, text, text, text, date, text, date, boolean, text)',
    'public.vessel_stylist_registrar_contato(text, text, text, text, text, date)',
    'public.vessel_rastreio_dos_stylists(integer, boolean)',
    'public.vessel_stylist_mover_de_etapa(text, bigint)',
    'public.vessel_stylist_historico_de_etapas(text)',
    'public.vessel_stylist_etapas()',
    'public.vessel_stylist_etapa_criar(text, integer, text)',
    'public.vessel_stylist_etapa_renomear(bigint, text)',
    'public.vessel_stylist_etapa_mover(bigint, text)',
    'public.vessel_stylist_etapa_tipo(bigint, text)',
    'public.vessel_stylist_etapa_marcar_prospectada(bigint)',
    'public.vessel_stylist_etapa_excluir(bigint, bigint)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
