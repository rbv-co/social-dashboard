-- PRIVATE EDIT SÓ COM STYLIST LIBERADA, E OS MOTIVOS DAS SAÍDAS.
--
-- Pedidos do dono em 24/09/2026:
--   1. "só de eu jogar a stylist no banco você já permitiu agendar private edit
--      com ela, tá errado, somente quando ela vai para a saída 'ativada' que aí
--      é permitido criar private edit com ela."
--   2. "o Desclassificado pode ter alguns motivos, como 'desinteresse', 'não
--      conecta' e mais alguns que julgar necessários".
--   3. "quando arrasto ela para Desclassificado mostra um pop-up para seleção
--      do motivo, e quando movo para Ativada ela entra na nossa base do Private
--      Edit" (o arrastar é da tela; aqui mora a trava do motivo e a da base).
--
-- ── 1. QUEM PODE TER PRIVATE EDIT ───────────────────────────────────────────
--
-- Cada etapa ganha `libera_private_edit` (padrão: não). A regra é da ETAPA EM
-- QUE A STYLIST ESTÁ HOJE: só quem está numa etapa marcada pode ser anfitriã de
-- um encontro NOVO. Pode haver várias etapas marcadas, ou nenhuma (aí ninguém
-- recebe encontro novo, e a tela do Private Edit diz isso).
--   · Semeia a saída "Ativada" (antes do Desclassificado), já marcada. Se já
--     existir uma etapa chamada "Ativada" (sem diferença de maiúscula), ela é
--     reusada e só ganha a marca.
--   · `vessel_criar_private_edit` recusa com `stylist_nao_liberada`.
--   · `vessel_private_edit_editar` recusa com `stylist_nao_liberada` só quando
--     TROCA a anfitriã por uma não liberada. Editar sem trocar continua
--     passando, seja qual for a etapa dela hoje.
--   · ⚠️ OS ENCONTROS QUE JÁ EXISTEM NÃO SÃO TOCADOS: se ela sai da Ativada
--     depois, os encontros dela ficam como estão; só os NOVOS são recusados.
--   · A "base do Private Edit" (o seletor de "Marcar um encontro") é
--     `vessel_stylists_para_escolher`, que passa a dizer a etapa de cada uma e
--     se ela está liberada. A lista continua trazendo TODAS: o cartão da
--     convidada usa o WhatsApp da anfitriã de encontros antigos, e a edição
--     precisa mostrar a anfitriã atual mesmo que ela não esteja mais liberada.
--     Quem filtra "só as liberadas" para o encontro novo é a tela.
--
-- ── 2. OS MOTIVOS DAS SAÍDAS ────────────────────────────────────────────────
--
-- `vessel_stylist_motivos_de_saida`: a lista de motivos de cada SAÍDA,
-- configurável pela tela "Etapas do funil" (adicionar, renomear, reordenar,
-- desativar/reativar, pedir nota). ⚠️ MOTIVO NÃO SE APAGA — o histórico aponta
-- para ele; o que sai de uso se DESATIVA (some da escolha, fica no histórico).
--   · O Desclassificado nasce com nove motivos; "Outro" exige nota. A Ativada
--     nasce sem motivos, e saída sem motivo ativo não pede nenhum.
--   · Mover para uma saída com motivos ativos EXIGE o motivo (e a nota quando o
--     motivo pede). Vale para `vessel_stylist_mover_de_etapa` e para a exclusão
--     de etapa com destino (`vessel_stylist_etapa_excluir`), e o gatilho da
--     tabela é o cinto: um `update` direto sem motivo levanta erro.
--   · O motivo e a nota vão para o HISTÓRICO DE ETAPAS (colunas novas
--     `motivo_id` e `nota`; a tabela continua só-acrescenta). O motivo ATUAL de
--     uma stylist é o da última linha do histórico dela — não existe uma
--     segunda cópia na `vessel_stylists` para as duas discordarem.
--
-- ── A CENTRAL QUE ESTÁ NO AR (a de antes desta migration) ───────────────────
--
-- ⚠️ `vessel_stylist_mover_de_etapa` e `vessel_stylist_etapa_excluir` ganham
-- dois parâmetros NO FIM, com padrão nulo: o corpo antigo (só código e etapa)
-- continua sendo aceito pelo PostgREST. Mas, com o banco novo e a tela antiga:
--   · mover para o Desclassificado (ou excluir etapa mandando gente para ele)
--     é RECUSADO com `motivo_obrigatorio` — a tela antiga não sabe pedir motivo
--     e mostra a frase genérica "Não consegui gravar agora";
--   · criar encontro com stylist fora da Ativada é recusado; a tela antiga
--     mostra a frase do banco (o campo `erro`, em português).
-- As leituras só GANHAM chaves; nenhuma some.
--
-- ── 3. "ATIVADA" PASSA A SER UM FATO DO FUNIL (regra do dono: "manter o
-- sentido no placar e no scorecard, para não perder nenhuma informação nem
-- cruzamento de dados") ────────────────────────────────────────────────────
--
-- A data de ativação é a PRIMEIRA vez que a stylist chegou numa etapa que
-- libera Private Edit, lida do histórico de etapas (a coluna nova
-- `liberava_private_edit` é a foto da marca NA HORA da chegada: marcar ou
-- desmarcar uma etapa depois não reescreve a data de ninguém). Quem tem
-- encontro mas nunca passou por uma etapa liberadora (os encontros de antes
-- desta regra) ativa na data do primeiro encontro agendado, para a turma antiga
-- não sumir da taxa. UMA função só: `vessel_stylist_ativada_em(stylist)`, usada
-- pelo placar (e pelo scorecard, que é o placar recortado), pela lista da tela e
-- pela régua de Confiabilidade (que sai do scorecard).
--   · O número de antes ("ativada" = primeiro encontro agendado, `ativada_em`)
--     NÃO SOME: vira "com Private Edit agendado". E o placar ganha "com Private
--     Edit realizado", e a turma da prospecção passa pelas cinco etapas
--     (prospectadas → ativadas → com PE agendado → com PE realizado →
--     recorrentes), cada uma dentro da anterior.
--   · Encontros, convidadas e venda NÃO dependem da etapa: nada deles muda.
--   · `vessel_stylists.ativada_em` continua sendo gravada pelo gatilho dos
--     encontros; o nome ficou, o sentido é "primeiro Private Edit agendado".

-- ── 0. o funil configurável tem de estar no banco ──────────────────────────
do $$
begin
  if to_regclass('public.vessel_stylist_etapas') is null
     or to_regclass('public.vessel_stylist_etapas_historico') is null then
    raise exception 'falta 2026-09-24-vessel-stylist-funil-configuravel.sql antes desta';
  end if;
end $$;

-- ── 1. a etapa que libera Private Edit ──────────────────────────────────────
alter table public.vessel_stylist_etapas
  add column libera_private_edit boolean not null default false;
comment on column public.vessel_stylist_etapas.libera_private_edit is
  'Quem esta nesta etapa pode ser anfitria de um Private Edit NOVO. Varias podem ter; nenhuma e permitido.';

-- ⚠️ A LISTA FECHADA DA TRILHA ganha as ações novas (sem isto, a primeira
-- gravação da tela derrubaria a transação inteira no CHECK).
alter table public.vessel_stylist_etapas_trilha drop constraint vessel_stylist_etapas_trilha_acao_valida;
alter table public.vessel_stylist_etapas_trilha add constraint vessel_stylist_etapas_trilha_acao_valida check (acao in
  ('criar', 'renomear', 'reordenar', 'tipo', 'marcar_prospectada', 'excluir',
   'libera_private_edit',
   'motivo_criar', 'motivo_renomear', 'motivo_reordenar', 'motivo_ativar', 'motivo_exige_nota'));

-- ── 2. os motivos das saídas ────────────────────────────────────────────────
create table public.vessel_stylist_motivos_de_saida (
  id                bigserial primary key,
  etapa_id          bigint not null references public.vessel_stylist_etapas(id),
  nome              text not null,
  ordem             int  not null,
  exige_nota        boolean not null default false,
  -- ⚠️ DESATIVAR, NUNCA APAGAR: o histórico de etapas aponta para a linha.
  ativo             boolean not null default true,
  criado_por        uuid,
  criado_por_nome   text,
  criado_em         timestamptz not null default now(),
  alterado_por      uuid,
  alterado_por_nome text,
  alterado_em       timestamptz not null default now(),
  constraint vessel_stylist_motivos_de_saida_nome_curto check (length(btrim(nome)) between 1 and 80)
);
-- Nome único entre os ativos DA MESMA saída, sem diferença de maiúscula.
create unique index vessel_stylist_motivos_de_saida_nome_idx
  on public.vessel_stylist_motivos_de_saida (etapa_id, lower(btrim(nome))) where ativo;
create index vessel_stylist_motivos_de_saida_etapa_idx
  on public.vessel_stylist_motivos_de_saida (etapa_id, ordem);

alter table public.vessel_stylist_motivos_de_saida enable row level security;
revoke all on table public.vessel_stylist_motivos_de_saida from anon, authenticated;
comment on table public.vessel_stylist_motivos_de_saida is
  'Os motivos de cada etapa de SAIDA do funil da stylist. RLS ligada e SEM politica: so as funcoes '
  'security definer leem e escrevem. Nao se apaga: desativa (`ativo = false`).';

create or replace function public.vessel_motivo_de_saida_nao_se_apaga()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  raise exception 'motivo de saida nao se apaga: desative (o historico aponta para ele)'
    using errcode = '42501';
end;
$function$;
revoke all on function public.vessel_motivo_de_saida_nao_se_apaga() from public, anon, authenticated;
create trigger vessel_stylist_motivos_de_saida_nao_se_apaga
  before delete on public.vessel_stylist_motivos_de_saida
  for each row execute function public.vessel_motivo_de_saida_nao_se_apaga();

-- O histórico de etapas guarda o motivo e a nota de cada chegada numa saída.
-- ⚠️ `add column` sem padrão não reescreve linha nenhuma: o gatilho
-- só-acrescenta (que barra `update`) não é acionado.
alter table public.vessel_stylist_etapas_historico
  add column motivo_id bigint references public.vessel_stylist_motivos_de_saida(id),
  add column nota text,
  -- ⚠️ A FOTO DA MARCA NA HORA DA CHEGADA: a ativação lê ESTA coluna, e não a
  -- marca de hoje da etapa — desmarcar ou marcar uma etapa amanhã não reescreve
  -- a data de ativação de ninguém (a mesma regra da data da prospecção).
  -- `not null default false` num Postgres 11+ não reescreve linha nenhuma.
  add column liberava_private_edit boolean not null default false,
  add constraint vessel_stylist_etapas_historico_nota_curta check (nota is null or length(nota) <= 500);
comment on column public.vessel_stylist_etapas_historico.motivo_id is
  'O motivo de saida escolhido ao chegar numa saida (nulo nas etapas de funil e nas saidas sem motivo).';

-- ── 3. as sementes: a Ativada e os motivos do Desclassificado ──────────────
do $$
declare
  v_ativada bigint;
  v_des     bigint;
  v_pos     int;
  v_antes   boolean;
  v_quem    text := 'migration 2026-09-24 (private edit so com stylist liberada)';
begin
  select id, libera_private_edit into v_ativada, v_antes
    from public.vessel_stylist_etapas where ativa and lower(btrim(nome)) = 'ativada';
  if v_ativada is null then
    -- Entra ANTES da primeira saída (a ordem é uma só para funil e saídas).
    select min(ordem) into v_pos from public.vessel_stylist_etapas where ativa and tipo = 'saida';
    v_pos := coalesce(v_pos, (select coalesce(max(ordem), 0) + 1 from public.vessel_stylist_etapas where ativa));
    update public.vessel_stylist_etapas set ordem = ordem + 1 where ativa and ordem >= v_pos;
    insert into public.vessel_stylist_etapas (nome, ordem, tipo, libera_private_edit, criado_por_nome, alterado_por_nome)
    values ('Ativada', v_pos, 'saida', true, v_quem, v_quem)
    returning id into v_ativada;
    perform public.vessel_stylist_etapas_renumerar();
    insert into public.vessel_stylist_etapas_trilha (etapa_id, acao, antes, depois, por_nome)
    values (v_ativada, 'criar', null, jsonb_build_object('nome', 'Ativada', 'ordem', v_pos, 'tipo', 'saida'), v_quem);
    v_antes := false;
  else
    update public.vessel_stylist_etapas
       set libera_private_edit = true, alterado_por = null, alterado_por_nome = v_quem, alterado_em = now()
     where id = v_ativada;
  end if;
  if not v_antes then
    insert into public.vessel_stylist_etapas_trilha (etapa_id, acao, antes, depois, por_nome)
    values (v_ativada, 'libera_private_edit', jsonb_build_object('libera_private_edit', false),
            jsonb_build_object('libera_private_edit', true), v_quem);
  end if;

  select id into v_des from public.vessel_stylist_etapas
   where ativa and tipo = 'saida' and lower(btrim(nome)) = 'desclassificado';
  if v_des is not null and not exists (select 1 from public.vessel_stylist_motivos_de_saida where etapa_id = v_des) then
    insert into public.vessel_stylist_motivos_de_saida (etapa_id, nome, ordem, exige_nota, criado_por_nome, alterado_por_nome)
    select v_des, m.nome, m.n::int, m.nome = 'Outro', v_quem, v_quem
      from unnest(array[
        'Desinteresse',
        'Não conecta com a marca',
        'Não retornou os contatos',
        'Carteira fora do perfil',
        'Portfólio / estética não alinhados',
        'Fora da praça (logística)',
        'Não aceitou as condições (Professional Fee)',
        'Exclusividade com outra marca',
        'Outro'
      ]) with ordinality as m(nome, n);
  end if;
end $$;

-- ── 4. o motivo ATUAL de uma stylist: o da última linha do histórico ───────
create or replace function public.vessel_stylist_saida_atual(p_stylist bigint)
returns table (motivo_id bigint, nota text)
language sql
stable
set search_path to 'public'
as $function$
  select h.motivo_id, h.nota
    from public.vessel_stylist_etapas_historico h
   where h.stylist_id = p_stylist
   order by h.id desc
   limit 1
$function$;
revoke all on function public.vessel_stylist_saida_atual(bigint) from public, anon, authenticated;

-- ── 5. os gatilhos da etapa: o cinto do motivo, e o histórico com o motivo ─
-- ⚠️ QUEM MOVE AVISA O MOTIVO por duas variáveis DA TRANSAÇÃO
-- (`vessel.motivo_de_saida` e `vessel.nota_de_saida`), o mesmo jeito que a
-- exclusão de etapa já avisa o `motivo_da_etapa`. As funções que movem limpam
-- as duas logo depois do `update`.
create or replace function public.vessel_stylists_etapa_antes()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_motivo bigint;
  v_nota   text;
  v_m      public.vessel_stylist_motivos_de_saida%rowtype;
begin
  -- Cadastro novo entra na PRIMEIRA etapa de funil, pela ordem.
  if new.etapa_id is null then
    select e.id into new.etapa_id from public.vessel_stylist_etapas e
     where e.ativa and e.tipo = 'funil' order by e.ordem, e.id limit 1;
  end if;
  if not exists (select 1 from public.vessel_stylist_etapas e where e.id = new.etapa_id and e.ativa) then
    raise exception 'etapa % nao existe ou foi excluida', new.etapa_id using errcode = '23503';
  end if;
  -- ⚠️ O CINTO DO MOTIVO (24/09/2026): chegar numa saída com motivos ativos
  -- exige um motivo DELA, ativo, e a nota quando o motivo pede.
  if (tg_op = 'INSERT' or new.etapa_id is distinct from old.etapa_id)
     and exists (select 1 from public.vessel_stylist_etapas e
                  where e.id = new.etapa_id and e.tipo = 'saida')
     and exists (select 1 from public.vessel_stylist_motivos_de_saida m
                  where m.etapa_id = new.etapa_id and m.ativo) then
    v_motivo := nullif(current_setting('vessel.motivo_de_saida', true), '')::bigint;
    v_nota   := nullif(btrim(coalesce(current_setting('vessel.nota_de_saida', true), '')), '');
    select * into v_m from public.vessel_stylist_motivos_de_saida m
     where m.id = v_motivo and m.etapa_id = new.etapa_id and m.ativo;
    if v_m.id is null then
      raise exception 'a saida % exige um motivo ativo dela', new.etapa_id using errcode = '23514';
    end if;
    if v_m.exige_nota and v_nota is null then
      raise exception 'o motivo % exige nota', v_m.id using errcode = '23514';
    end if;
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
declare
  v_saida  boolean;
  v_motivo bigint;
  v_nota   text;
begin
  if tg_op = 'INSERT' or new.etapa_id is distinct from old.etapa_id then
    select e.tipo = 'saida' into v_saida from public.vessel_stylist_etapas e where e.id = new.etapa_id;
    -- O motivo e a nota só valem para a chegada numa SAÍDA; o motivo, só se
    -- for desta saída (o cinto de antes já recusou o resto).
    if coalesce(v_saida, false) then
      select m.id into v_motivo from public.vessel_stylist_motivos_de_saida m
       where m.id = nullif(current_setting('vessel.motivo_de_saida', true), '')::bigint
         and m.etapa_id = new.etapa_id;
      v_nota := nullif(btrim(coalesce(current_setting('vessel.nota_de_saida', true), '')), '');
    end if;
    insert into public.vessel_stylist_etapas_historico
      (stylist_id, de_etapa_id, para_etapa_id, motivo, por, por_nome, teste, motivo_id, nota, liberava_private_edit)
    values (new.id,
            case when tg_op = 'INSERT' then null else old.etapa_id end,
            new.etapa_id,
            case when tg_op = 'INSERT' then 'cadastro'
                 -- quem muda por exclusão de etapa avisa por esta variável da transação
                 when current_setting('vessel.motivo_da_etapa', true) = 'etapa_excluida' then 'etapa_excluida'
                 else 'mudanca' end,
            auth.uid(),
            (select coalesce(nullif(trim(p.name), ''), p.email) from public.profiles p where p.id = auth.uid()),
            new.teste,
            v_motivo,
            v_nota,
            coalesce((select e.libera_private_edit from public.vessel_stylist_etapas e where e.id = new.etapa_id), false));
  end if;
  return null;
end;
$function$;
revoke all on function public.vessel_stylists_etapa_depois() from public, anon, authenticated;

-- A conferência do motivo, igual para mover e para excluir com destino.
-- Devolve nulo quando está tudo certo, ou a situação da recusa.
create or replace function public.vessel_stylist_conferir_motivo(p_etapa bigint, p_motivo bigint, p_nota text)
returns text
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  v_e    public.vessel_stylist_etapas%rowtype;
  v_m    public.vessel_stylist_motivos_de_saida%rowtype;
  v_nota text := nullif(btrim(coalesce(p_nota, '')), '');
begin
  select * into v_e from public.vessel_stylist_etapas where id = p_etapa and ativa;
  if v_e.id is null then return 'etapa_invalida'; end if;
  if v_nota is not null and length(v_nota) > 500 then return 'nota_longa'; end if;
  if v_e.tipo <> 'saida' then return null; end if;   -- funil: motivo não se aplica
  if not exists (select 1 from public.vessel_stylist_motivos_de_saida m where m.etapa_id = p_etapa and m.ativo) then
    if p_motivo is not null then return 'motivo_invalido'; end if;
    return null;                                      -- saída sem motivos: não pede
  end if;
  if p_motivo is null then return 'motivo_obrigatorio'; end if;
  select * into v_m from public.vessel_stylist_motivos_de_saida m
   where m.id = p_motivo and m.etapa_id = p_etapa and m.ativo;
  if v_m.id is null then return 'motivo_invalido'; end if;
  if v_m.exige_nota and v_nota is null then return 'nota_obrigatoria'; end if;
  return null;
end;
$function$;
revoke all on function public.vessel_stylist_conferir_motivo(bigint, bigint, text) from public, anon, authenticated;

-- ── 6. mover a stylist de etapa (com o motivo) ─────────────────────────────
-- ⚠️ DOIS PARÂMETROS NOVOS NO FIM, com padrão: o corpo da tela antiga ainda
-- casa com esta assinatura (e com nenhuma outra: a velha sai).
drop function if exists public.vessel_stylist_mover_de_etapa(text, bigint);
create function public.vessel_stylist_mover_de_etapa(
  p_codigo text, p_etapa_id bigint, p_motivo_id bigint default null, p_nota text default null)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_codigo text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
  v_s      public.vessel_stylists%rowtype;
  v_e      public.vessel_stylist_etapas%rowtype;
  v_recusa text;
  v_saida  boolean;
begin
  if not public.is_vessel_atendimentos_editar() then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  select * into v_s from public.vessel_stylists where codigo = v_codigo;
  if v_s.id is null then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;
  select * into v_e from public.vessel_stylist_etapas e where e.id = p_etapa_id and e.ativa;
  if v_e.id is null then
    return json_build_object('ok', false, 'situacao', 'etapa_invalida');
  end if;
  if v_s.etapa_id = p_etapa_id then
    return json_build_object('ok', true, 'situacao', 'sem_mudanca', 'codigo', v_codigo);
  end if;
  v_recusa := public.vessel_stylist_conferir_motivo(p_etapa_id, p_motivo_id, p_nota);
  if v_recusa is not null then
    return json_build_object('ok', false, 'situacao', v_recusa, 'etapa', v_e.nome);
  end if;
  v_saida := v_e.tipo = 'saida';
  perform set_config('vessel.motivo_de_saida', case when v_saida then coalesce(p_motivo_id::text, '') else '' end, true);
  perform set_config('vessel.nota_de_saida', case when v_saida then coalesce(btrim(p_nota), '') else '' end, true);
  update public.vessel_stylists set etapa_id = p_etapa_id, atualizado_em = now() where id = v_s.id;
  perform set_config('vessel.motivo_de_saida', '', true);
  perform set_config('vessel.nota_de_saida', '', true);
  return json_build_object('ok', true, 'situacao', 'ok', 'codigo', v_codigo,
    'etapa', v_e.nome, 'libera_private_edit', v_e.libera_private_edit,
    'prospectado_em', (select prospectado_em from public.vessel_stylists where id = v_s.id));
end;
$function$;

-- ── 7. excluir uma etapa (o destino pode ser uma saída com motivos) ─────────
drop function if exists public.vessel_stylist_etapa_excluir(bigint, bigint);
create function public.vessel_stylist_etapa_excluir(
  p_id bigint, p_destino bigint default null, p_motivo_id bigint default null, p_nota text default null)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_e      public.vessel_stylist_etapas%rowtype;
  v_n      int;
  v_recusa text;
  v_saida  boolean;
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
    v_recusa := public.vessel_stylist_conferir_motivo(p_destino, p_motivo_id, p_nota);
    if v_recusa is not null then
      return json_build_object('ok', false, 'situacao', v_recusa, 'stylists', v_n);
    end if;
    v_saida := (select tipo = 'saida' from public.vessel_stylist_etapas where id = p_destino);
    -- ⚠️ O HISTÓRICO DIZ POR QUE ELAS MUDARAM (o gatilho lê estas variáveis).
    perform set_config('vessel.motivo_da_etapa', 'etapa_excluida', true);
    perform set_config('vessel.motivo_de_saida', case when v_saida then coalesce(p_motivo_id::text, '') else '' end, true);
    perform set_config('vessel.nota_de_saida', case when v_saida then coalesce(btrim(p_nota), '') else '' end, true);
    update public.vessel_stylists set etapa_id = p_destino, atualizado_em = now() where etapa_id = p_id;
    perform set_config('vessel.motivo_da_etapa', '', true);
    perform set_config('vessel.motivo_de_saida', '', true);
    perform set_config('vessel.nota_de_saida', '', true);
  end if;
  update public.vessel_stylist_etapas set ativa = false, excluida_em = now() where id = p_id;
  perform public.vessel_stylist_etapas_renumerar();
  perform public.vessel_stylist_etapas_anotar(p_id, 'excluir',
    jsonb_build_object('nome', v_e.nome, 'ordem', v_e.ordem, 'tipo', v_e.tipo),
    jsonb_build_object('destino', p_destino, 'stylists_movidas', v_n, 'motivo_id', p_motivo_id));
  return json_build_object('ok', true, 'situacao', 'ok', 'id', p_id, 'movidas', v_n);
end;
$function$;

-- ── 8. marcar a etapa que libera Private Edit ───────────────────────────────
create or replace function public.vessel_stylist_etapa_liberar_private_edit(p_id bigint, p_libera boolean)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_e public.vessel_stylist_etapas%rowtype;
begin
  if not public.is_vessel_atendimentos_editar() then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  if p_libera is null then return json_build_object('ok', false, 'situacao', 'sem_escolha'); end if;
  perform pg_advisory_xact_lock(hashtext('public.vessel_stylist_etapas')::bigint);
  select * into v_e from public.vessel_stylist_etapas where id = p_id and ativa;
  if v_e.id is null then return json_build_object('ok', false, 'situacao', 'nao_achei'); end if;
  if v_e.libera_private_edit = p_libera then
    return json_build_object('ok', true, 'situacao', 'sem_mudanca', 'id', p_id);
  end if;
  update public.vessel_stylist_etapas set libera_private_edit = p_libera where id = p_id;
  perform public.vessel_stylist_etapas_anotar(p_id, 'libera_private_edit',
    jsonb_build_object('libera_private_edit', v_e.libera_private_edit), jsonb_build_object('libera_private_edit', p_libera));
  return json_build_object('ok', true, 'situacao', 'ok', 'id', p_id);
end;
$function$;

-- ── 9. mexer nos motivos ────────────────────────────────────────────────────
-- Renumera os ATIVOS de uma saída 1..n pela ordem de agora (os desativados
-- ficam com a ordem que tinham; ao voltar, vão para o fim).
create or replace function public.vessel_stylist_motivos_renumerar(p_etapa bigint)
returns void
language sql
security definer
set search_path to 'public'
as $function$
  update public.vessel_stylist_motivos_de_saida m set ordem = x.n
    from (select id, row_number() over (order by ordem, id)::int as n
            from public.vessel_stylist_motivos_de_saida where etapa_id = p_etapa and ativo) x
   where m.id = x.id and m.ordem is distinct from x.n;
$function$;
revoke all on function public.vessel_stylist_motivos_renumerar(bigint) from public, anon, authenticated;

-- Quem mexeu por último no motivo.
create or replace function public.vessel_stylist_motivo_anotar(p_id bigint, p_acao text, p_antes jsonb, p_depois jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_etapa bigint;
begin
  update public.vessel_stylist_motivos_de_saida
     set alterado_por = auth.uid(),
         alterado_por_nome = (select coalesce(nullif(trim(p.name), ''), p.email) from public.profiles p where p.id = auth.uid()),
         alterado_em = now()
   where id = p_id
  returning etapa_id into v_etapa;
  perform public.vessel_stylist_etapas_anotar(v_etapa, p_acao,
    coalesce(p_antes, '{}'::jsonb) || jsonb_build_object('motivo_id', p_id),
    coalesce(p_depois, '{}'::jsonb) || jsonb_build_object('motivo_id', p_id));
end;
$function$;
revoke all on function public.vessel_stylist_motivo_anotar(bigint, text, jsonb, jsonb) from public, anon, authenticated;

create or replace function public.vessel_stylist_motivo_criar(
  p_etapa_id bigint, p_nome text, p_exige_nota boolean default false)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_nome text := btrim(coalesce(p_nome, ''));
  v_e    public.vessel_stylist_etapas%rowtype;
  v_id   bigint;
begin
  if not public.is_vessel_atendimentos_editar() then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  if v_nome = '' then return json_build_object('ok', false, 'situacao', 'sem_nome'); end if;
  if length(v_nome) > 80 then return json_build_object('ok', false, 'situacao', 'motivo_longo'); end if;
  perform pg_advisory_xact_lock(hashtext('public.vessel_stylist_etapas')::bigint);
  select * into v_e from public.vessel_stylist_etapas where id = p_etapa_id and ativa;
  if v_e.id is null then return json_build_object('ok', false, 'situacao', 'nao_achei'); end if;
  if v_e.tipo <> 'saida' then return json_build_object('ok', false, 'situacao', 'so_saida'); end if;
  if exists (select 1 from public.vessel_stylist_motivos_de_saida
              where etapa_id = p_etapa_id and ativo and lower(btrim(nome)) = lower(v_nome)) then
    return json_build_object('ok', false, 'situacao', 'nome_repetido');
  end if;
  insert into public.vessel_stylist_motivos_de_saida
    (etapa_id, nome, ordem, exige_nota, criado_por, criado_por_nome, alterado_por, alterado_por_nome)
  values (p_etapa_id, v_nome,
          (select coalesce(max(ordem), 0) + 1 from public.vessel_stylist_motivos_de_saida where etapa_id = p_etapa_id and ativo),
          coalesce(p_exige_nota, false), auth.uid(),
          (select coalesce(nullif(trim(p.name), ''), p.email) from public.profiles p where p.id = auth.uid()),
          auth.uid(),
          (select coalesce(nullif(trim(p.name), ''), p.email) from public.profiles p where p.id = auth.uid()))
  returning id into v_id;
  perform public.vessel_stylist_motivo_anotar(v_id, 'motivo_criar', null,
    jsonb_build_object('nome', v_nome, 'exige_nota', coalesce(p_exige_nota, false)));
  return json_build_object('ok', true, 'situacao', 'ok', 'id', v_id);
end;
$function$;

create or replace function public.vessel_stylist_motivo_renomear(p_id bigint, p_nome text)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_nome text := btrim(coalesce(p_nome, ''));
  v_m    public.vessel_stylist_motivos_de_saida%rowtype;
begin
  if not public.is_vessel_atendimentos_editar() then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  if v_nome = '' then return json_build_object('ok', false, 'situacao', 'sem_nome'); end if;
  if length(v_nome) > 80 then return json_build_object('ok', false, 'situacao', 'motivo_longo'); end if;
  perform pg_advisory_xact_lock(hashtext('public.vessel_stylist_etapas')::bigint);
  select * into v_m from public.vessel_stylist_motivos_de_saida where id = p_id;
  if v_m.id is null then return json_build_object('ok', false, 'situacao', 'nao_achei'); end if;
  if exists (select 1 from public.vessel_stylist_motivos_de_saida
              where etapa_id = v_m.etapa_id and ativo and id <> p_id and lower(btrim(nome)) = lower(v_nome)) then
    return json_build_object('ok', false, 'situacao', 'nome_repetido');
  end if;
  update public.vessel_stylist_motivos_de_saida set nome = v_nome where id = p_id;
  perform public.vessel_stylist_motivo_anotar(p_id, 'motivo_renomear',
    jsonb_build_object('nome', v_m.nome), jsonb_build_object('nome', v_nome));
  return json_build_object('ok', true, 'situacao', 'ok', 'id', p_id);
end;
$function$;

create or replace function public.vessel_stylist_motivo_mover(p_id bigint, p_direcao text)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_m      public.vessel_stylist_motivos_de_saida%rowtype;
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
  select * into v_m from public.vessel_stylist_motivos_de_saida where id = p_id and ativo;
  if v_m.id is null then return json_build_object('ok', false, 'situacao', 'nao_achei'); end if;
  perform public.vessel_stylist_motivos_renumerar(v_m.etapa_id);
  select * into v_m from public.vessel_stylist_motivos_de_saida where id = p_id;
  select id, ordem into v_viz, v_ordviz from public.vessel_stylist_motivos_de_saida
   where etapa_id = v_m.etapa_id and ativo
     and ordem = v_m.ordem + case when p_direcao = 'subir' then -1 else 1 end;
  if v_viz is null then return json_build_object('ok', false, 'situacao', 'no_limite'); end if;
  update public.vessel_stylist_motivos_de_saida set ordem = v_ordviz where id = p_id;
  update public.vessel_stylist_motivos_de_saida set ordem = v_m.ordem where id = v_viz;
  perform public.vessel_stylist_motivo_anotar(p_id, 'motivo_reordenar',
    jsonb_build_object('ordem', v_m.ordem), jsonb_build_object('ordem', v_ordviz));
  return json_build_object('ok', true, 'situacao', 'ok', 'id', p_id);
end;
$function$;

-- Desativar (some da escolha, fica no histórico) ou reativar (volta no fim).
create or replace function public.vessel_stylist_motivo_ativar(p_id bigint, p_ativo boolean)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_m public.vessel_stylist_motivos_de_saida%rowtype;
begin
  if not public.is_vessel_atendimentos_editar() then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  if p_ativo is null then return json_build_object('ok', false, 'situacao', 'sem_escolha'); end if;
  perform pg_advisory_xact_lock(hashtext('public.vessel_stylist_etapas')::bigint);
  select * into v_m from public.vessel_stylist_motivos_de_saida where id = p_id;
  if v_m.id is null then return json_build_object('ok', false, 'situacao', 'nao_achei'); end if;
  if v_m.ativo = p_ativo then return json_build_object('ok', true, 'situacao', 'sem_mudanca', 'id', p_id); end if;
  if p_ativo and exists (select 1 from public.vessel_stylist_motivos_de_saida
                          where etapa_id = v_m.etapa_id and ativo and lower(btrim(nome)) = lower(btrim(v_m.nome))) then
    return json_build_object('ok', false, 'situacao', 'nome_repetido');
  end if;
  update public.vessel_stylist_motivos_de_saida
     set ativo = p_ativo,
         ordem = case when p_ativo then (select coalesce(max(ordem), 0) + 1 from public.vessel_stylist_motivos_de_saida
                                          where etapa_id = v_m.etapa_id and ativo) else ordem end
   where id = p_id;
  perform public.vessel_stylist_motivos_renumerar(v_m.etapa_id);
  perform public.vessel_stylist_motivo_anotar(p_id, 'motivo_ativar',
    jsonb_build_object('ativo', v_m.ativo), jsonb_build_object('ativo', p_ativo));
  return json_build_object('ok', true, 'situacao', 'ok', 'id', p_id);
end;
$function$;

create or replace function public.vessel_stylist_motivo_exigir_nota(p_id bigint, p_exige boolean)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_m public.vessel_stylist_motivos_de_saida%rowtype;
begin
  if not public.is_vessel_atendimentos_editar() then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  if p_exige is null then return json_build_object('ok', false, 'situacao', 'sem_escolha'); end if;
  select * into v_m from public.vessel_stylist_motivos_de_saida where id = p_id;
  if v_m.id is null then return json_build_object('ok', false, 'situacao', 'nao_achei'); end if;
  if v_m.exige_nota = p_exige then return json_build_object('ok', true, 'situacao', 'sem_mudanca', 'id', p_id); end if;
  update public.vessel_stylist_motivos_de_saida set exige_nota = p_exige where id = p_id;
  perform public.vessel_stylist_motivo_anotar(p_id, 'motivo_exige_nota',
    jsonb_build_object('exige_nota', v_m.exige_nota), jsonb_build_object('exige_nota', p_exige));
  return json_build_object('ok', true, 'situacao', 'ok', 'id', p_id);
end;
$function$;

-- ── 10. as leituras ganham chaves (nenhuma some) ────────────────────────────
-- As etapas: + `libera_private_edit`, + `motivos` (todos, os ativos primeiro,
-- cada um com quantas stylists estão HOJE nesta saída por ele) e
-- `stylists_sem_motivo` (quem está na saída sem motivo gravado).
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
             'libera_private_edit', e.libera_private_edit,
             'stylists', (select count(*)::int from public.vessel_stylists s
                           where s.etapa_id = e.id and not coalesce(s.teste, false)),
             'motivos', coalesce((
               select json_agg(json_build_object(
                        'id', m.id, 'nome', m.nome, 'ordem', m.ordem, 'ativo', m.ativo,
                        'exige_nota', m.exige_nota,
                        'stylists', (select count(*)::int from public.vessel_stylists s
                                      cross join lateral public.vessel_stylist_saida_atual(s.id) a
                                      where s.etapa_id = e.id and not coalesce(s.teste, false)
                                        and a.motivo_id = m.id))
                      order by (not m.ativo), m.ordem, m.id)
                 from public.vessel_stylist_motivos_de_saida m where m.etapa_id = e.id), '[]'::json),
             'stylists_sem_motivo', case when e.tipo = 'saida' then
               (select count(*)::int from public.vessel_stylists s
                  left join lateral public.vessel_stylist_saida_atual(s.id) a on true
                 where s.etapa_id = e.id and not coalesce(s.teste, false) and a.motivo_id is null) end,
             'alterado_em', e.alterado_em, 'alterado_por_nome', e.alterado_por_nome)
           order by e.ordem, e.id)
      from public.vessel_stylist_etapas e where e.ativa), '[]'::json);
end;
$function$;

-- O histórico de etapas: + o motivo de saída e a nota.
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
             'motivo_de_saida_id', h.motivo_id, 'motivo_de_saida', m.nome, 'nota', h.nota,
             'por_nome', h.por_nome, 'em', h.em) order by h.em desc, h.id desc)
      from public.vessel_stylist_etapas_historico h
      left join public.vessel_stylist_etapas de on de.id = h.de_etapa_id
      join public.vessel_stylist_etapas para on para.id = h.para_etapa_id
      left join public.vessel_stylist_motivos_de_saida m on m.id = h.motivo_id
     where h.stylist_id = v_id), '[]'::json);
end;
$function$;

-- A base do Private Edit: + a etapa de cada uma e se ela está liberada.
create or replace function public.vessel_stylists_para_escolher()
 returns json
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare v_saida json;
begin
  if not public.is_vessel_atendimentos() then
    raise exception 'sem permissao' using errcode = '42501';
  end if;
  -- ⚠️ 24/09/2026: + `etapa` e `libera_private_edit`. A lista continua com
  -- TODAS as ativas (o cartão da convidada lê o WhatsApp da anfitriã de
  -- encontros antigos); "só as liberadas" para o encontro novo é a tela.
  select coalesce(json_agg(json_build_object('codigo', s.codigo, 'nome', s.nome,
                                             'cidade', s.cidade, 'whatsapp', s.whatsapp,
                                             'etapa', e.nome,
                                             'libera_private_edit', coalesce(e.libera_private_edit, false))
                           order by s.codigo), '[]'::json)
    into v_saida
    from public.vessel_stylists s
    left join public.vessel_stylist_etapas e on e.id = s.etapa_id
   where not coalesce(s.teste, false)
     and coalesce(s.ativa, true);
  return v_saida;
end;
$function$;

-- A lista da tela: + se a etapa libera Private Edit e o motivo de saída atual.
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

-- ── 11. o encontro: só com stylist liberada ─────────────────────────────────
-- As etapas que liberam hoje, por extenso ("Ativada", "Ativada e Recorrente"),
-- para a frase da recusa.
create or replace function public.vessel_etapas_que_liberam_private_edit()
returns text
language sql
stable
set search_path to 'public'
as $function$
  select string_agg(e.nome, ', ' order by e.ordem, e.id)
    from public.vessel_stylist_etapas e where e.ativa and e.libera_private_edit
$function$;
revoke all on function public.vessel_etapas_que_liberam_private_edit() from public, anon, authenticated;

-- ⚠️ MESMA ASSINATURA E O MESMO CORPO de antes (conferidos contra o banco em
-- 24/09/2026), com UMA conferência nova logo depois de achar a stylist.
create or replace function public.vessel_criar_private_edit(p_stylist text, p_quando timestamp with time zone, p_local text DEFAULT NULL::text, p_praca text DEFAULT NULL::text, p_loja text DEFAULT NULL::text, p_vagas integer DEFAULT 8, p_teste boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_alfabeto text := 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
  v_tam      int  := length(v_alfabeto);          -- 30
  -- O maior múltiplo de 30 que cabe em 256: 240. Byte de 240 para cima é
  -- descartado, e é isso que tira o viés.
  v_teto     int  := 256 - (256 % v_tam);
  v_stylist  bigint;
  v_etapa    public.vessel_stylist_etapas%rowtype;
  v_liberam  text;
  v_praca    text := upper(nullif(trim(coalesce(p_praca, '')), ''));
  v_codigo   text;
  v_chave    text;
  v_seq      int;
  v_byte     int;
begin
  if not public.is_vessel_atendimentos_editar() then
    return json_build_object('ok', false, 'situacao', 'sem_permissao',
      'erro', 'Você não tem a permissão de Atendimentos para criar um encontro.');
  end if;

  select id into v_stylist from public.vessel_stylists
   where codigo = upper(nullif(trim(coalesce(p_stylist, '')), ''));
  if v_stylist is null then
    return json_build_object('ok', false, 'situacao', 'stylist_nao_encontrada',
      'erro', 'Não achei esta stylist. O código é o STY-0000 dela.');
  end if;
  -- ⚠️ 24/09/2026: SÓ QUEM ESTÁ NUMA ETAPA QUE LIBERA PRIVATE EDIT (a Ativada).
  select e.* into v_etapa from public.vessel_stylists s
    join public.vessel_stylist_etapas e on e.id = s.etapa_id
   where s.id = v_stylist;
  if not coalesce(v_etapa.libera_private_edit, false) then
    v_liberam := public.vessel_etapas_que_liberam_private_edit();
    return json_build_object('ok', false, 'situacao', 'stylist_nao_liberada',
      'etapa', v_etapa.nome, 'etapas_que_liberam', v_liberam,
      'erro', 'Esta parceira ainda não pode receber um Private Edit: ela está em "'
              || coalesce(v_etapa.nome, 'sem etapa') || '". '
              || case when v_liberam is null
                      then 'Hoje nenhuma etapa libera Private Edit — marque uma em "Etapas do funil".'
                      else 'Mova-a para ' || v_liberam || ' no Stylist Circle antes de marcar o encontro.' end);
  end if;
  if p_quando is null then
    return json_build_object('ok', false, 'situacao', 'sem_data',
      'erro', 'Escolha o dia e a hora do encontro.');
  end if;
  if p_quando < now() - interval '1 day' then
    return json_build_object('ok', false, 'situacao', 'data_no_passado',
      'erro', 'Esta data já passou. O convite nasceria vencido.');
  end if;
  if v_praca is null or v_praca not in ('CPS', 'SAO', 'SBO', 'BSB') then
    return json_build_object('ok', false, 'situacao', 'praca_invalida',
      'erro', 'A praça precisa ser CPS, SAO, SBO ou BSB.');
  end if;
  if p_loja is not null and p_loja not in ('iguatemi', 'tivoli', 'parkshopping') then
    return json_build_object('ok', false, 'situacao', 'loja_invalida',
      'erro', 'Escolha uma loja válida.');
  end if;
  -- ⚠️ T11: CAPACIDADE PLANEJADA DE 7 A 10 (decisão 4 do dono). É a cadeira
  -- que a loja prepara, e não trava ninguém na porta do convite.
  if p_vagas is null or p_vagas < 7 or p_vagas > 10 then
    return json_build_object('ok', false, 'situacao', 'vagas_invalidas',
      'erro', 'A capacidade planejada é de 7 a 10 convidadas.');
  end if;

  select count(*) + 1 into v_seq from public.vessel_private_edits
   where praca = v_praca
     and (quando at time zone 'America/Sao_Paulo')::date
         = (p_quando at time zone 'America/Sao_Paulo')::date;
  v_codigo := 'PE-'
    || to_char(p_quando at time zone 'America/Sao_Paulo', 'YYYYMMDD')
    || '-' || v_praca || '-' || lpad(v_seq::text, 2, '0');

  loop
    v_chave := '';
    while length(v_chave) < 8 loop
      v_byte := get_byte(extensions.gen_random_bytes(1), 0);
      continue when v_byte >= v_teto;      -- descarta e sorteia outro
      v_chave := v_chave || substr(v_alfabeto, 1 + (v_byte % v_tam), 1);
    end loop;
    exit when not exists (select 1 from public.vessel_private_edits where chave = v_chave);
  end loop;

  insert into public.vessel_private_edits
    (codigo, chave, stylist_id, quando, local, praca, loja, vagas, teste)
  values (v_codigo, v_chave, v_stylist, p_quando,
          nullif(trim(coalesce(p_local, '')), ''), v_praca, p_loja, p_vagas, p_teste);

  return json_build_object('ok', true, 'codigo', v_codigo, 'chave', v_chave);
end;
$function$;

-- ⚠️ MESMA ASSINATURA E O MESMO CORPO de antes, com a conferência nova só
-- quando a anfitriã TROCA.
create or replace function public.vessel_private_edit_editar(p_codigo text, p_quando timestamp with time zone DEFAULT NULL::timestamp with time zone, p_local text DEFAULT NULL::text, p_praca text DEFAULT NULL::text, p_loja text DEFAULT NULL::text, p_vagas integer DEFAULT NULL::integer, p_stylist text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  -- ⚠️ MESMA EXPRESSAO E MESMA ORDEM da irma `vessel_private_edit_encerrar`.
  v_codigo  text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
  v_stylist bigint;
  v_atual   bigint;
begin
  if not public.is_vessel_atendimentos_editar() then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;

  select stylist_id into v_atual from public.vessel_private_edits where codigo = v_codigo;
  if not found then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;

  if p_stylist is not null then
    select id into v_stylist from public.vessel_stylists where codigo = p_stylist;
    if v_stylist is null then
      return json_build_object('ok', false, 'situacao', 'stylist_nao_achei');
    end if;
    -- ⚠️ 24/09/2026: TROCAR a anfitriã só por uma liberada. Manter a de hoje
    -- passa sempre — o encontro que já existe não é invalidado.
    if v_stylist is distinct from v_atual and not exists (
         select 1 from public.vessel_stylists s join public.vessel_stylist_etapas e on e.id = s.etapa_id
          where s.id = v_stylist and e.libera_private_edit) then
      return json_build_object('ok', false, 'situacao', 'stylist_nao_liberada',
        'etapas_que_liberam', public.vessel_etapas_que_liberam_private_edit());
    end if;
  end if;

  -- ⚠️ T11: a mesma régua de capacidade do criar. Antes daqui, editar não
  -- conferia vagas nenhuma — dava para gravar zero, e zero é o denominador da
  -- taxa de resposta na tela.
  if p_vagas is not null and (p_vagas < 7 or p_vagas > 10) then
    return json_build_object('ok', false, 'situacao', 'vagas_invalidas');
  end if;

  -- Campo nulo = "nao mexe neste", nunca "apaga o que estava la".
  update public.vessel_private_edits
     set quando     = coalesce(p_quando, quando),
         local      = coalesce(p_local, local),
         praca      = coalesce(p_praca, praca),
         loja       = coalesce(p_loja, loja),
         vagas      = coalesce(p_vagas, vagas),
         stylist_id = coalesce(v_stylist, stylist_id)
   where codigo = v_codigo;

  return json_build_object('ok', true, 'situacao', 'ok', 'codigo', v_codigo);
end;
$function$;

-- ── 11½. a ATIVAÇÃO: uma função só ──────────────────────────────────────────
-- A primeira chegada numa etapa que liberava Private Edit NAQUELA HORA; sem
-- nenhuma, o primeiro Private Edit agendado (`ativada_em`, a turma de antes
-- desta regra); sem os dois, nula.
create or replace function public.vessel_stylist_ativada_em(p_stylist bigint)
returns timestamptz
language sql
stable
set search_path to 'public'
as $function$
  select coalesce(
    (select min(h.em) from public.vessel_stylist_etapas_historico h
      where h.stylist_id = p_stylist and h.liberava_private_edit),
    (select s.ativada_em from public.vessel_stylists s where s.id = p_stylist))
$function$;
revoke all on function public.vessel_stylist_ativada_em(bigint) from public, anon, authenticated;
comment on function public.vessel_stylist_ativada_em(bigint) is
  'A data de ativacao da stylist: a primeira chegada numa etapa que liberava Private Edit (historico); '
  'sem ela, o primeiro Private Edit agendado (vessel_stylists.ativada_em). A UNICA definicao: placar, '
  'scorecard, lista e reguas da qualificacao leem esta.';
comment on column public.vessel_stylists.ativada_em is
  'Dia do PRIMEIRO Private Edit agendado (congela; o gatilho dos encontros grava). Desde 24/09/2026 NAO e '
  'a ativacao: a ativacao e vessel_stylist_ativada_em() (a etapa que libera Private Edit), e esta data e '
  'o "com Private Edit agendado" do placar.';

-- O corpo do placar e do scorecard. ⚠️ O MESMO CORPO de antes (conferido contra
-- o banco em 24/09/2026); muda só quem é "ativada", e entram os números novos.
-- Nada dos encontros, das convidadas nem da venda muda: nenhum deles olha etapa.
create or replace function public.vessel_numeros_do_stylist_circle(p_de date, p_ate date, p_dias integer, p_stylist bigint)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_de   date := coalesce(p_de, date '2000-01-01');
  -- ⚠️ SEM FIM ESCOLHIDO, O FIM É NENHUM — e não "hoje" (T11).
  v_ate  date := coalesce(p_ate, 'infinity'::date);
  v_dias int  := greatest(coalesce(p_dias, 14), 0);
  v_saida json;
begin
  with
  sty0 as (select s.*, public.vessel_stylist_ativada_em(s.id) as ativou
             from public.vessel_stylists s
            where not coalesce(s.teste, false)
              and (p_stylist is null or s.id = p_stylist)),
  -- ⚠️ 24/09/2026: `dia_ativou` é a ATIVAÇÃO (a etapa que libera Private
  -- Edit); `dia_agendou` é o primeiro Private Edit agendado (o "ativada" de
  -- antes). `por_encontro_antigo`: ativou pelo encontro, sem nunca ter passado
  -- por uma etapa liberadora (a turma de antes da regra).
  sty as (select s.*,
                 (s.ativou at time zone 'America/Sao_Paulo')::date as dia_ativou,
                 (s.ativada_em at time zone 'America/Sao_Paulo')::date as dia_agendou,
                 not exists (select 1 from public.vessel_stylist_etapas_historico h
                              where h.stylist_id = s.id and h.liberava_private_edit)
                   and s.ativada_em is not null as por_encontro_antigo
            from sty0 s),
  ev as (
    select e.*, (e.quando at time zone 'America/Sao_Paulo')::date as dia
      from public.vessel_private_edits e
     where not coalesce(e.teste, false) and not coalesce(e.arquivada, false)
       and e.stylist_id in (select id from sty)
  ),
  ev_p as (select * from ev where dia between v_de and v_ate),
  conv as (
    select t.id, t.pessoa_id, t.status, e.codigo, e.status as status_do_encontro,
           public.vessel_situacao_do_convite(t.status, t.rsvp, t.convite_enviado_em,
                                             e.quando, e.status) as situacao
      from public.vessel_atendimentos t
      join ev_p e on e.codigo = t.evento_codigo
     where not coalesce(t.teste, false)
  ),
  vendas as (
    select v.* from public.vessel_vendas_dos_encontros(v_dias) v
     where v.evento_codigo in (select codigo from ev_p)
  ),
  realizados as (
    select e.stylist_id, e.realizado_em,
           row_number() over (partition by e.stylist_id order by e.realizado_em, e.id) as n,
           e.realizado_em - lag(e.realizado_em) over (partition by e.stylist_id
                                                      order by e.realizado_em, e.id) as intervalo
      from ev e where e.status = 'realizado'
  ),
  -- A TURMA da prospecção, passo a passo, cada passo DENTRO do anterior (as
  -- taxas nunca passam de 100%): prospectada no período → ativou até o fim →
  -- teve Private Edit agendado até o fim → realizado → recorrente.
  turma as (
    select s.id,
           s.dia_ativou <= v_ate as ativou,
           s.dia_ativou <= v_ate and s.dia_agendou <= v_ate as agendou,
           s.dia_ativou <= v_ate and s.dia_agendou <= v_ate
             and exists (select 1 from realizados r where r.stylist_id = s.id and r.n = 1 and r.realizado_em <= v_ate) as realizou,
           s.dia_ativou <= v_ate and s.dia_agendou <= v_ate
             and exists (select 1 from realizados r where r.stylist_id = s.id and r.n = 2 and r.realizado_em <= v_ate) as repetiu
      from sty s where s.prospectado_em between v_de and v_ate
  )
  select json_build_object(
    'de', p_de, 'ate', p_ate, 'janela_de_venda_em_dias', v_dias,
    'prospectadas', (select count(*)::int from sty where prospectado_em between v_de and v_ate),
    'ativadas', (select count(*)::int from sty where dia_ativou between v_de and v_ate),
    'prospectadas_ja_ativadas', (select count(*)::int from turma where coalesce(ativou, false)),
    -- ⚠️ 24/09/2026: os números de antes, com o nome do que eles contam.
    'com_private_edit_agendado', (select count(*)::int from sty where dia_agendou between v_de and v_ate),
    'com_private_edit_realizado', (select count(distinct stylist_id)::int from realizados
                                    where n = 1 and realizado_em between v_de and v_ate),
    'prospectadas_com_private_edit_agendado', (select count(*)::int from turma where coalesce(agendou, false)),
    'prospectadas_com_private_edit_realizado', (select count(*)::int from turma where coalesce(realizou, false)),
    'prospectadas_recorrentes', (select count(*)::int from turma where coalesce(repetiu, false)),
    'ativadas_por_encontro_antigo', (select count(*)::int from sty
                                      where por_encontro_antigo and dia_ativou between v_de and v_ate),
    'encontros_agendados', (select count(*)::int from ev_p where status <> 'em_planejamento'),
    'encontros_realizados', (select count(*)::int from ev_p where status = 'realizado'),
    'encontros_cancelados', (select count(*)::int from ev_p
                              where status in ('cancelado', 'nao_realizado')),
    'convidadas', (select count(*)::int from conv),
    'confirmadas', (select count(*)::int from conv
                     where situacao in ('confirmada', 'presente', 'nao_compareceu')),
    'confirmadas_em_realizados', (select count(*)::int from conv
                     where situacao in ('confirmada', 'presente', 'nao_compareceu')
                       and status_do_encontro = 'realizado'),
    'presentes', (select count(*)::int from conv where status = 'realizado'),
    'presentes_em_realizados', (select count(*)::int from conv
                     where status = 'realizado' and status_do_encontro = 'realizado'),
    'recorrentes_no_periodo', (select count(*)::int from realizados
                                where n = 2 and realizado_em between v_de and v_ate),
    'recorrentes_ate_o_fim', (select count(distinct stylist_id)::int from realizados
                               where n = 2 and realizado_em <= v_ate),
    'ativadas_ate_o_fim', (select count(*)::int from sty where dia_ativou <= v_ate),
    'intervalos', (select count(*)::int from realizados
                    where intervalo is not null and realizado_em between v_de and v_ate),
    'intervalo_medio_em_dias', (select round(avg(intervalo)::numeric, 1) from realizados
                                 where intervalo is not null and realizado_em between v_de and v_ate),
    'contatos_ate_ativar', (select round(avg(n)::numeric, 1) from (
        select (select count(*) from public.vessel_stylist_contatos c
                 where c.stylist_id = s.id and c.criado_em < s.ativou) as n
          from sty s where s.dia_ativou between v_de and v_ate) x),
    'stylists_com_contatos_ate_ativar', (select count(*)::int from sty s
        where s.dia_ativou between v_de and v_ate),
    'compradoras', (select count(distinct v.pessoa_id)::int from vendas v),
    'vendas', (select count(*)::int from vendas),
    'pecas', (select coalesce(sum(pecas), 0) from vendas),
    'receita', (select coalesce(sum(receita), 0) from vendas),
    'por_stylist', (
      select coalesce(json_agg(json_build_object(
               'codigo', s.codigo, 'nome', s.nome,
               'encontros_realizados', (select count(*)::int from ev_p e
                                         where e.stylist_id = s.id and e.status = 'realizado'),
               'vendas', (select count(*)::int from vendas v where v.stylist_id = s.id),
               'receita', (select coalesce(sum(v.receita), 0) from vendas v where v.stylist_id = s.id))
             order by s.codigo), '[]'::json)
        from sty s
       where exists (select 1 from ev_p e where e.stylist_id = s.id))
  ) into v_saida;

  return v_saida;
end;
$function$;

-- O scorecard: a ativação é a MESMA função; o primeiro encontro agendado
-- continua na ficha, com o nome dele.
create or replace function public.vessel_scorecard_da_stylist(p_codigo text, p_de date DEFAULT NULL::date, p_ate date DEFAULT NULL::date, p_dias integer DEFAULT 14)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_codigo text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
  v_ate    date := coalesce(p_ate, 'infinity'::date);
  v_hoje   date := (now() at time zone 'America/Sao_Paulo')::date;
  v_s      public.vessel_stylists%rowtype;
  v_num    jsonb;
  v_ult    date;
  v_real   int;
  v_prox_codigo text;
  v_prox_quando timestamptz;
  v_ativou  timestamptz;
begin
  if not public.is_vessel_atendimentos() then
    raise exception 'sem permissao' using errcode = '42501';
  end if;

  select * into v_s from public.vessel_stylists s
   where s.codigo = v_codigo and not coalesce(s.teste, false);
  if v_s.id is null then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;

  v_num := public.vessel_numeros_do_stylist_circle(p_de, p_ate, p_dias, v_s.id)::jsonb;

  -- ⚠️ 24/09/2026: A ATIVAÇÃO É `vessel_stylist_ativada_em` — a mesma do
  -- placar (a etapa que libera Private Edit; sem ela, o primeiro encontro).
  v_ativou := public.vessel_stylist_ativada_em(v_s.id);

  -- ⚠️ "RECORRENTE" E "DIAS DESDE O ÚLTIMO" NÃO SÃO DO PERÍODO: são o estado
  -- dela até o fim dele. Quem fez dois encontros em agosto continua
  -- recorrente quando se olha setembro.
  select count(*)::int, max(e.realizado_em) into v_real, v_ult
    from public.vessel_private_edits e
   where e.stylist_id = v_s.id and e.status = 'realizado'
     and not coalesce(e.teste, false) and not coalesce(e.arquivada, false)
     and e.realizado_em <= v_ate;

  -- O próximo encontro MARCADO (não o planejado, não o que caiu).
  select e.codigo, e.quando into v_prox_codigo, v_prox_quando
    from public.vessel_private_edits e
   where e.stylist_id = v_s.id and e.status in ('agendado', 'confirmado', 'reagendado')
     and not coalesce(e.teste, false) and not coalesce(e.arquivada, false)
     and e.quando >= now()
   order by e.quando, e.id
   limit 1;

  return ((v_num - 'por_stylist') || jsonb_build_object(
    'ok', true, 'situacao', 'ok',
    'codigo', v_s.codigo, 'nome', v_s.nome, 'ativada_em', v_ativou,
    'private_edit_agendado_em', v_s.ativada_em,
    'ativada_por_encontro_antigo', v_s.ativada_em is not null and not exists (
      select 1 from public.vessel_stylist_etapas_historico h where h.stylist_id = v_s.id and h.liberava_private_edit),
    'realizados_desde_o_inicio', v_real,
    'recorrente', v_real >= 2,
    'ultimo_realizado_em', v_ult,
    'dias_desde_o_ultimo', case when v_ult is null then null else v_hoje - v_ult end,
    'proximo_encontro_em', v_prox_quando,
    'proximo_encontro_codigo', v_prox_codigo,
    'contatos', (select count(*)::int from public.vessel_stylist_contatos c where c.stylist_id = v_s.id),
    -- A mesma régua de `contatos_ate_ativar` do placar, só que dela: os
    -- contatos registrados ANTES da ativação.
    'contatos_antes_de_ativar', case when v_ativou is null then null else
      (select count(*)::int from public.vessel_stylist_contatos c
        where c.stylist_id = v_s.id and c.criado_em < v_ativou) end,
    -- Para a sugestão de Confiabilidade: parceira que já ativou e some.
    'contatos_sem_resposta_depois_de_ativar', case when v_ativou is null then null else
      (select count(*)::int from public.vessel_stylist_contatos c
        where c.stylist_id = v_s.id and c.resultado = 'sem_resposta'
          and c.criado_em >= v_ativou) end
  ))::json;
end;
$function$;

-- ── 12. as portas ───────────────────────────────────────────────────────────
-- ⚠️ `revoke ... from public` NÃO FECHA `anon`, e função nova em `public` nasce
-- executável por `public`. As duas linhas de cada uma são obrigatórias.
do $$
declare f text;
begin
  foreach f in array array[
    'public.vessel_stylist_mover_de_etapa(text, bigint, bigint, text)',
    'public.vessel_stylist_etapa_excluir(bigint, bigint, bigint, text)',
    'public.vessel_stylist_etapa_liberar_private_edit(bigint, boolean)',
    'public.vessel_stylist_motivo_criar(bigint, text, boolean)',
    'public.vessel_stylist_motivo_renomear(bigint, text)',
    'public.vessel_stylist_motivo_mover(bigint, text)',
    'public.vessel_stylist_motivo_ativar(bigint, boolean)',
    'public.vessel_stylist_motivo_exigir_nota(bigint, boolean)',
    'public.vessel_stylist_etapas()',
    'public.vessel_stylist_historico_de_etapas(text)',
    'public.vessel_stylists_para_escolher()',
    'public.vessel_rastreio_dos_stylists(integer, boolean)',
    'public.vessel_criar_private_edit(text, timestamptz, text, text, text, integer, boolean)',
    'public.vessel_private_edit_editar(text, timestamptz, text, text, text, integer, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
