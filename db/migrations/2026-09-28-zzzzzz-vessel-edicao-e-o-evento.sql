-- A EDIÇÃO DO STYLIST CIRCLE PASSA A SER O EVENTO (decisão do dono, 28/09/2026).
-- Spec: docs/superpowers/specs/2026-09-28-stylist-circle-edicao-e-evento-design.md
--
-- Até aqui a edição era "a rodada da praça": abrir puxava a praça inteira (30
-- stylists em Campinas, 20 nunca contatadas) e o placar contava essa turma.
-- Agora a edição é UM EVENTO (data = `comeca_em`) e a turma é de quem foi
-- CONVIDADA a ele:
--   • entra na turma quem é movida para Convidado (ou além) com a edição da
--     praça dela aberta — o MESMO movimento de etapa que a equipe já faz;
--   • a linha guarda as três marcas do evento (convidada / confirmou /
--     presente) e o "indisponível na data"; marca nunca se apaga;
--   • o Private Edit de uma stylist pertence ao EVENTO DE ORIGEM dela — a 1ª
--     edição em que esteve presente — e a nenhum outro (nada conta duas vezes);
--   • quem sai por "Indisponível na data" volta para Convidado quando a
--     próxima edição da praça abre.
--
-- ⚠️ Corpos de partida (o MAIS RECENTE de cada função):
--   • vessel_stylist_mover_de_etapa e vessel_stylists_etapa_depois — o de
--     PRODUÇÃO (pg_get_functiondef, 28/09): o mover de produção já é o de
--     2026-09-24-vessel-private-edit-so-com-stylist-liberada.sql com a trava
--     `vessel_pode('atendimentos.stylist-circle', 'editar')` que o aplicador
--     de permissão por tela trocou no banco, e é ESSA que fica;
--   • as de edição — 2026-09-25-vessel-praca-e-edicao.sql, seção 14.2
--     (conferidas iguais às de produção em 28/09);
--   • vessel_placar_da_edicao — 2026-09-28-vessel-placar-da-edicao-conta-a-turma.sql.

-- ── 1. as marcas do evento e o motivo que volta ──────────────────────────────
-- Uma linha por stylist por edição (o `unique (stylist_id, edicao_id)` já
-- existe). `saiu_em`/`etapa_ao_sair` ficam, sem uso, para não quebrar leitura
-- antiga.
alter table public.vessel_stylist_na_edicao
  add column if not exists convidada_em    timestamptz,
  add column if not exists confirmou_em    timestamptz,
  add column if not exists presente_em     timestamptz,
  add column if not exists indisponivel_em timestamptz;
-- o evento de origem procura a MENOR presença de cada stylist
create index if not exists vessel_stylist_na_edicao_presente_idx
  on public.vessel_stylist_na_edicao (stylist_id, presente_em) where presente_em is not null;

-- ⚠️ `not null default false` num Postgres 11+ não reescreve linha nenhuma.
alter table public.vessel_stylist_motivos_de_saida
  add column if not exists volta_na_proxima_edicao boolean not null default false;
comment on column public.vessel_stylist_motivos_de_saida.volta_na_proxima_edicao is
  'Quem sai por este motivo volta para Convidado quando a proxima edicao da praca abre (vessel_edicao_abrir).';

-- "Indisponível na data" entra no Desclassificado ANTES de "Outro" (que segue
-- por último, como a equipe já conhece a lista).
do $$
declare
  v_des  bigint;
  v_pos  int;
  v_quem text := 'migration 2026-09-28 (a edicao e o evento)';
begin
  select id into v_des from public.vessel_stylist_etapas
   where ativa and tipo = 'saida' and lower(btrim(nome)) = 'desclassificado';
  if v_des is null then
    raise exception 'etapa Desclassificado nao existe: o motivo "Indisponivel na data" nao tem onde morar';
  end if;
  if not exists (select 1 from public.vessel_stylist_motivos_de_saida
                  where etapa_id = v_des and ativo and lower(btrim(nome)) = lower('Indisponível na data')) then
    select min(ordem) into v_pos from public.vessel_stylist_motivos_de_saida
     where etapa_id = v_des and ativo and lower(btrim(nome)) = 'outro';
    v_pos := coalesce(v_pos, (select coalesce(max(ordem), 0) + 1 from public.vessel_stylist_motivos_de_saida where etapa_id = v_des));
    update public.vessel_stylist_motivos_de_saida set ordem = ordem + 1 where etapa_id = v_des and ordem >= v_pos;
    insert into public.vessel_stylist_motivos_de_saida
      (etapa_id, nome, ordem, exige_nota, volta_na_proxima_edicao, criado_por_nome, alterado_por_nome)
    values (v_des, 'Indisponível na data', v_pos, false, true, v_quem, v_quem);
  end if;
  update public.vessel_stylist_motivos_de_saida set volta_na_proxima_edicao = true
   where etapa_id = v_des and ativo and lower(btrim(nome)) = lower('Indisponível na data');
end $$;

-- ── 2. o evento de origem: A REGRA NUM LUGAR SÓ ──────────────────────────────
-- A edição da 1ª presença (desempate por `edicao_id`). Placar, etiqueta do
-- Private Edit e ficha leem DAQUI — nunca uma cópia da conta.
create or replace function public.vessel_evento_de_origem(p_stylist_id bigint)
returns bigint language sql stable security definer set search_path = public as $$
  select n.edicao_id from public.vessel_stylist_na_edicao n
   where n.stylist_id = p_stylist_id and n.presente_em is not null
   order by n.presente_em, n.edicao_id limit 1
$$;

-- a mesma regra para todas as stylists de uma vez (tela do Private Edit e
-- ficha da stylist). ⚠️ + `codigo` (Task 4): as listas que as telas já leem
-- (os encontros de `vessel_conta_das_private_edits`, as stylists de
-- `vessel_rastreio_dos_stylists`) trazem o CÓDIGO da stylist, nunca o id —
-- sem ele a tela não teria como casar a origem com o encontro.
create or replace function public.vessel_eventos_de_origem()
returns table (stylist_id bigint, codigo text, edicao_id bigint)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if not (public.vessel_pode('atendimentos.private-edit', 'ver')
       or public.vessel_pode('atendimentos.stylist-circle', 'ver')
       or public.vessel_pode('atendimentos.edicoes', 'ver')) then
    raise exception 'sem permissao' using errcode = '42501';
  end if;
  return query
    select p.sid, s.codigo::text, public.vessel_evento_de_origem(p.sid)
      from (select distinct n.stylist_id as sid from public.vessel_stylist_na_edicao n
             where n.presente_em is not null) p
      join public.vessel_stylists s on s.id = p.sid;
end;
$$;

-- ── 3. o movimento de etapa marca a turma ────────────────────────────────────
-- Chamada por quem move (o mover e a volta do "indisponível"). Vale só para a
-- edição ABERTA da praça da stylist; sem ela, nada acontece (nem erro).
--   funil, de Convidado em diante → entra na turma (convidada_em);
--   de Confirmado em diante → confirmou_em; de Presença em diante → presente_em
--   (as anteriores por coalesce: quem pula etapa ganha todas);
--   saída com motivo `volta_na_proxima_edicao` → indisponivel_em.
-- ⚠️ NUNCA APAGA MARCA: voltar de Presença para Confirmado mantém a presença
-- (o aplicador prova que trocar o `else n.presente_em` por nulo reprova).
-- ⚠️ As três etapas são achadas pelo NOME de hoje; se alguma for renomeada
-- ou apagada, a função não marca nada (em vez de marcar errado).
create or replace function public.vessel_edicao_marcar_movimento(p_stylist_id bigint, p_etapa_id bigint, p_motivo_id bigint)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_conv int;
  v_conf int;
  v_pres int;
  v_e    public.vessel_stylist_etapas%rowtype;
  v_ed   bigint;
begin
  select max(ordem) filter (where lower(btrim(nome)) = 'convidado'),
         max(ordem) filter (where lower(btrim(nome)) = 'confirmado'),
         max(ordem) filter (where lower(btrim(nome)) = 'presença')
    into v_conv, v_conf, v_pres
    from public.vessel_stylist_etapas where ativa and tipo = 'funil';
  if v_conv is null or v_conf is null or v_pres is null then
    return;
  end if;
  select * into v_e from public.vessel_stylist_etapas where id = p_etapa_id;
  if v_e.id is null then
    return;
  end if;
  select ed.id into v_ed
    from public.vessel_stylist_circle_edicoes ed
    join public.vessel_stylists s on s.praca_id = ed.praca_id
   where s.id = p_stylist_id and ed.situacao = 'aberta'
   order by ed.id limit 1;
  if v_ed is null then
    return;
  end if;

  if v_e.tipo = 'funil' and v_e.ordem >= v_conv then
    -- entra na turma com o MESMO critério de sempre (ativa, não-teste)
    insert into public.vessel_stylist_na_edicao (stylist_id, edicao_id, convidada_em)
    select p_stylist_id, v_ed, now()
     where exists (select 1 from public.vessel_stylists s
                    where s.id = p_stylist_id and coalesce(s.ativa, true) and not coalesce(s.teste, false))
    on conflict (stylist_id, edicao_id) do nothing;
    update public.vessel_stylist_na_edicao n
       set convidada_em = coalesce(n.convidada_em, now()),
           confirmou_em = case when v_e.ordem >= v_conf then coalesce(n.confirmou_em, now()) else n.confirmou_em end,
           presente_em  = case when v_e.ordem >= v_pres then coalesce(n.presente_em, now()) else n.presente_em end
     where n.stylist_id = p_stylist_id and n.edicao_id = v_ed;
  elsif v_e.tipo = 'saida' and exists (select 1 from public.vessel_stylist_motivos_de_saida m
                                        where m.id = p_motivo_id and m.etapa_id = p_etapa_id
                                          and m.volta_na_proxima_edicao) then
    update public.vessel_stylist_na_edicao n
       set indisponivel_em = coalesce(n.indisponivel_em, now())
     where n.stylist_id = p_stylist_id and n.edicao_id = v_ed;
  end if;
end;
$$;

-- ── 4. mover de etapa: o corpo de produção + a marcação no fim ───────────────
-- Mesma assinatura: `create or replace` guarda os grants de hoje.
create or replace function public.vessel_stylist_mover_de_etapa(
  p_codigo text, p_etapa_id bigint, p_motivo_id bigint default null, p_nota text default null)
returns json
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_codigo text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
  v_s      public.vessel_stylists%rowtype;
  v_e      public.vessel_stylist_etapas%rowtype;
  v_recusa text;
  v_saida  boolean;
begin
  if not public.vessel_pode('atendimentos.stylist-circle', 'editar') then
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
  -- 28/09: o mesmo movimento marca a turma do evento (seção 3)
  perform public.vessel_edicao_marcar_movimento(v_s.id, p_etapa_id, case when v_saida then p_motivo_id end);
  return json_build_object('ok', true, 'situacao', 'ok', 'codigo', v_codigo,
    'etapa', v_e.nome, 'libera_private_edit', v_e.libera_private_edit,
    'prospectado_em', (select prospectado_em from public.vessel_stylists where id = v_s.id));
end;
$$;

-- ── 4.1 o histórico aceita a nota da VOLTA ───────────────────────────────────
-- ⚠️ Quem grava o histórico é o gatilho (não o mover), e o histórico só
-- acrescenta — não dá para escrever a nota depois. A volta do "indisponível"
-- (seção 6) avisa a nota pela variável da transação `vessel.nota_da_volta`,
-- do mesmo jeito que o mover avisa `vessel.nota_de_saida`. Fora isso, o corpo
-- é o de produção, letra por letra.
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
    else
      -- 28/09: a volta do "indisponível na data" escreve a nota dela aqui
      v_nota := nullif(btrim(coalesce(current_setting('vessel.nota_da_volta', true), '')), '');
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

-- ── 5. mudar de praça não mexe mais na turma ─────────────────────────────────
-- A turma é de quem foi convidada ao evento; mudar de praça depois não muda
-- de qual evento ela veio. Só mexia em turma → vira `return;`. Assinatura e
-- chamadas (as quatro portas que gravam praça) ficam como estão.
create or replace function public.vessel_stylist_sincronizar_edicao(
  p_stylist_id bigint, p_praca_id bigint, p_fechar_antigo boolean default false)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  return;
end;
$$;

-- ── 6. abrir: NÃO puxa a praça; traz de volta as "indisponíveis na data" ─────
-- Só muda a situação — a turma se forma pelos convites. E quem está numa
-- saída cujo ÚLTIMO motivo é `volta_na_proxima_edicao` (ativa, não-teste, da
-- praça) volta para Convidado: `update` direto (o mover exige a permissão de
-- quem clica e recusaria sair de uma saída sem motivo), o gatilho grava o
-- histórico com a nota "Voltou: indisponível na Edição N · Praça", e a
-- marcação (seção 3) dá a linha na turma nova com convidada_em = agora.
-- N = a edição em que ela ficou indisponível; sem linha lá (saiu antes de
-- ser convidada), a edição anterior da praça.
create or replace function public.vessel_edicao_abrir(p_id bigint)
returns json
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_ed       public.vessel_stylist_circle_edicoes%rowtype;
  v_conv     bigint;
  v_voltaram int := 0;
  r          record;
begin
  if not public.vessel_pode('atendimentos.edicoes', 'editar') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  select * into v_ed from public.vessel_stylist_circle_edicoes where id = p_id;
  if v_ed.id is null then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;
  if v_ed.situacao = 'encerrada' then
    return json_build_object('ok', false, 'situacao', 'edicao_encerrada');
  end if;
  if v_ed.situacao = 'aberta' then
    return json_build_object('ok', true, 'situacao', 'sem_mudanca', 'voltaram', 0);
  end if;
  if exists (select 1 from public.vessel_stylist_circle_edicoes
              where praca_id = v_ed.praca_id and situacao = 'aberta' and id <> p_id) then
    return json_build_object('ok', false, 'situacao', 'ja_tem_aberta');
  end if;
  update public.vessel_stylist_circle_edicoes set situacao = 'aberta' where id = p_id;

  select id into v_conv from public.vessel_stylist_etapas
   where ativa and tipo = 'funil' and lower(btrim(nome)) = 'convidado';
  if v_conv is not null then
    for r in
      select s.id,
             coalesce(
               (select format('Edição %s · %s', ed2.numero, p2.nome)
                  from public.vessel_stylist_na_edicao n2
                  join public.vessel_stylist_circle_edicoes ed2 on ed2.id = n2.edicao_id
                  join public.vessel_pracas p2 on p2.id = ed2.praca_id
                 where n2.stylist_id = s.id and n2.indisponivel_em is not null
                 order by n2.indisponivel_em desc, n2.id desc limit 1),
               (select format('Edição %s · %s', ed3.numero, p3.nome)
                  from public.vessel_stylist_circle_edicoes ed3
                  join public.vessel_pracas p3 on p3.id = ed3.praca_id
                 where ed3.praca_id = v_ed.praca_id and ed3.id <> p_id and ed3.numero < v_ed.numero
                 order by ed3.numero desc limit 1)) as onde
        from public.vessel_stylists s
        join public.vessel_stylist_etapas et on et.id = s.etapa_id and et.tipo = 'saida'
        cross join lateral public.vessel_stylist_saida_atual(s.id) sa
        join public.vessel_stylist_motivos_de_saida m
          on m.id = sa.motivo_id and m.etapa_id = s.etapa_id and m.volta_na_proxima_edicao
       where s.praca_id = v_ed.praca_id
         and coalesce(s.ativa, true) and not coalesce(s.teste, false)
       order by s.id
    loop
      perform set_config('vessel.nota_da_volta',
        coalesce('Voltou: indisponível na ' || r.onde, 'Voltou: indisponível na data'), true);
      update public.vessel_stylists set etapa_id = v_conv, atualizado_em = now() where id = r.id;
      perform set_config('vessel.nota_da_volta', '', true);
      perform public.vessel_edicao_marcar_movimento(r.id, v_conv, null);
      v_voltaram := v_voltaram + 1;
    end loop;
  end if;

  return json_build_object('ok', true, 'situacao', 'ok', 'voltaram', v_voltaram);
end;
$$;

-- ── 7. o resto das portas da edição ──────────────────────────────────────────
-- encerrar: só para de aceitar convidadas. O placar segue somando para sempre;
-- não há mais "levar para a próxima" (a turma é de quem foi convidada).
create or replace function public.vessel_edicao_encerrar(p_id bigint, p_levar_para bigint)
returns json
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_ed public.vessel_stylist_circle_edicoes%rowtype;
begin
  if not public.vessel_pode('atendimentos.edicoes', 'editar') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  if p_levar_para is not null then
    return json_build_object('ok', false, 'situacao', 'levar_para_nao_existe_mais');
  end if;
  select * into v_ed from public.vessel_stylist_circle_edicoes where id = p_id;
  if v_ed.id is null then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;
  if v_ed.situacao = 'encerrada' then
    return json_build_object('ok', false, 'situacao', 'edicao_encerrada');
  end if;
  update public.vessel_stylist_circle_edicoes set situacao = 'encerrada' where id = p_id;
  return json_build_object('ok', true, 'situacao', 'ok');
end;
$$;

-- criar: a edição é um evento de UM dia — `p_termina_em` fica na assinatura
-- (a tela antiga ainda manda) e é ignorado: grava nulo.
create or replace function public.vessel_edicao_criar(p_praca_id bigint, p_nome text, p_comeca_em date, p_termina_em date)
returns json
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_nome   text := nullif(trim(coalesce(p_nome, '')), '');
  v_numero int;
  v_id     bigint;
begin
  if not public.vessel_pode('atendimentos.edicoes', 'editar') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  if not exists (select 1 from public.vessel_pracas where id = p_praca_id) then
    return json_build_object('ok', false, 'situacao', 'praca_invalida');
  end if;
  if p_comeca_em is null then
    return json_build_object('ok', false, 'situacao', 'sem_data');
  end if;

  -- ⚠️ FILA POR PRAÇA: sem o advisory lock, duas chamadas ao mesmo tempo
  -- calculariam o mesmo "maior + 1" e colidiriam no `unique (praca_id, numero)`.
  perform pg_advisory_xact_lock(hashtext('vessel_stylist_circle_edicoes:' || p_praca_id::text));
  select coalesce(max(numero), 0) + 1 into v_numero
    from public.vessel_stylist_circle_edicoes where praca_id = p_praca_id;

  insert into public.vessel_stylist_circle_edicoes (praca_id, numero, nome, comeca_em, termina_em)
  values (p_praca_id, v_numero, v_nome, p_comeca_em, null)
  returning id into v_id;

  return json_build_object('ok', true, 'situacao', 'ok', 'id', v_id, 'numero', v_numero);
end;
$$;

-- incluir (exceções, botão "Incluir"): igual a antes, e grava convidada_em.
create or replace function public.vessel_edicao_incluir_stylist(p_codigo text, p_edicao_id bigint)
returns json
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_codigo     text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
  v_stylist_id bigint;
  v_ed         public.vessel_stylist_circle_edicoes%rowtype;
begin
  if not (public.vessel_pode('atendimentos.edicoes', 'editar')
       or public.vessel_pode('atendimentos.stylist-circle', 'editar')) then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  select id into v_stylist_id from public.vessel_stylists where codigo = v_codigo;
  if v_stylist_id is null then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;
  select * into v_ed from public.vessel_stylist_circle_edicoes where id = p_edicao_id;
  if v_ed.id is null then
    return json_build_object('ok', false, 'situacao', 'edicao_invalida');
  end if;
  -- edição encerrada não aceita convidada nova
  if v_ed.situacao = 'encerrada' then
    return json_build_object('ok', false, 'situacao', 'edicao_encerrada');
  end if;
  if exists (select 1 from public.vessel_stylist_na_edicao
              where stylist_id = v_stylist_id and edicao_id = p_edicao_id and saiu_em is null) then
    return json_build_object('ok', true, 'situacao', 'sem_mudanca');
  end if;
  -- `do update`: uma linha antiga com `saiu_em` (do tempo da sincronização
  -- por praça) é reaberta em vez de estourar 23505 cru.
  insert into public.vessel_stylist_na_edicao (stylist_id, edicao_id, convidada_em)
  values (v_stylist_id, p_edicao_id, now())
  on conflict (stylist_id, edicao_id) do update
    set saiu_em = null, etapa_ao_sair = null,
        convidada_em = coalesce(public.vessel_stylist_na_edicao.convidada_em, now());
  return json_build_object('ok', true, 'situacao', 'ok');
end;
$$;

-- tirar (botão "Tirar", engano de inclusão): só enquanto ela não esteve
-- presente — presença é fato do evento e não se desfaz.
create or replace function public.vessel_edicao_tirar_stylist(p_codigo text, p_edicao_id bigint)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_codigo     text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
  v_stylist_id bigint;
  v_linha      public.vessel_stylist_na_edicao%rowtype;
begin
  if not (public.vessel_pode('atendimentos.edicoes', 'editar')
       or public.vessel_pode('atendimentos.stylist-circle', 'editar')) then
    return jsonb_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  select id into v_stylist_id from public.vessel_stylists where codigo = v_codigo;
  if v_stylist_id is null then
    return jsonb_build_object('ok', false, 'situacao', 'nao_achei');
  end if;
  if not exists (select 1 from public.vessel_stylist_circle_edicoes where id = p_edicao_id) then
    return jsonb_build_object('ok', false, 'situacao', 'edicao_invalida');
  end if;
  select * into v_linha from public.vessel_stylist_na_edicao
   where stylist_id = v_stylist_id and edicao_id = p_edicao_id;
  if v_linha.id is null then
    return jsonb_build_object('ok', true, 'situacao', 'sem_mudanca');
  end if;
  if v_linha.presente_em is not null then
    return jsonb_build_object('ok', false, 'situacao', 'ja_esteve_presente');
  end if;
  delete from public.vessel_stylist_na_edicao where id = v_linha.id;
  return jsonb_build_object('ok', true, 'situacao', 'ok');
end;
$$;

-- a turma do evento, com as marcas e a origem de cada uma (tela de Edições).
-- Mesmo recorte do placar: sem `teste`, só `ativa`.
create or replace function public.vessel_edicao_turma(p_edicao_id bigint)
returns table (stylist_id bigint, codigo text, nome text, etapa_id bigint,
               convidada_em timestamptz, confirmou_em timestamptz, presente_em timestamptz,
               indisponivel_em timestamptz, origem bigint)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if not (public.vessel_pode('atendimentos.edicoes', 'ver')
       or public.vessel_pode('atendimentos.stylist-circle', 'ver')) then
    raise exception 'sem permissao' using errcode = '42501';
  end if;
  return query
    select s.id, s.codigo::text, s.nome::text, s.etapa_id,
           n.convidada_em, n.confirmou_em, n.presente_em, n.indisponivel_em,
           public.vessel_evento_de_origem(s.id)
      from public.vessel_stylist_na_edicao n
      join public.vessel_stylists s on s.id = n.stylist_id
     where n.edicao_id = p_edicao_id
       and not coalesce(s.teste, false) and coalesce(s.ativa, true)
     order by n.convidada_em nulls last, s.nome;
end;
$$;

-- O PLACAR DO EVENTO. Mesmo formato de hoje + `funil` (os passos de
-- `funilDoEvento`, edicao-regras.js — mesmas chaves, rótulos e contas),
-- `indisponiveis` e `meta`.
--   turma = todas as linhas da edição (sem `teste`, só `ativa`);
--   os Private Edits (e os convites deles) = os das stylists cujo EVENTO DE
--   ORIGEM é esta edição, em qualquer data e praça — nunca os de quem veio
--   de outro evento (nada conta duas vezes). O placar nunca fecha.
create or replace function public.vessel_placar_da_edicao(p_edicao_id bigint)
returns json
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_ed    public.vessel_stylist_circle_edicoes%rowtype;
  v_saida json;
begin
  if not public.vessel_pode('atendimentos.stylist-circle', 'ver') then
    raise exception 'sem permissao' using errcode = '42501';
  end if;

  select * into v_ed from public.vessel_stylist_circle_edicoes where id = p_edicao_id;
  if v_ed.id is null then
    raise exception 'edicao nao encontrada' using errcode = 'P0002';
  end if;

  with
  -- a turma do evento: as linhas da edição (o `saiu_em` da sincronização por
  -- praça não recorta mais nada — a turma é de quem foi convidada).
  linhas as (
    select n.stylist_id, n.confirmou_em, n.presente_em, n.indisponivel_em
      from public.vessel_stylist_na_edicao n
     where n.edicao_id = p_edicao_id
  ),
  -- mesmo filtro das irmãs (`teste`, `ativa`) — o placar fecha com a lista.
  sty as (
    select s.*, public.vessel_stylist_ativada_em(s.id) as ativou,
           l.confirmou_em as ev_confirmou_em, l.presente_em as ev_presente_em,
           l.indisponivel_em as ev_indisponivel_em,
           public.vessel_evento_de_origem(s.id) as origem
      from public.vessel_stylists s
      join linhas l on l.stylist_id = s.id
     where not coalesce(s.teste, false)
       and coalesce(s.ativa, true)
  ),
  -- ⚠️ QUEM É DESTE EVENTO: presente aqui E com a origem aqui. É daqui que
  -- saem os Private Edits do placar (em qualquer data e praça).
  daqui as (
    select s.id from sty s where s.ev_presente_em is not null and s.origem = p_edicao_id
  ),
  ev as (
    select e.*
      from public.vessel_private_edits e
     where not coalesce(e.teste, false) and not coalesce(e.arquivada, false)
       and e.stylist_id in (select id from daqui)
  ),
  -- os convites são os dos encontros deste evento (herdam o recorte de `ev`).
  conv as (
    select t.id, t.pessoa_id, t.status, e.codigo, e.status as status_do_encontro,
           public.vessel_situacao_do_convite(t.status, t.rsvp, t.convite_enviado_em,
                                             e.quando, e.status) as situacao
      from public.vessel_atendimentos t
      join ev e on e.codigo = t.evento_codigo
     where not coalesce(t.teste, false)
  ),
  -- o 1º e o 2º encontro realizado de cada stylist deste evento, em qualquer data.
  realizados as (
    select e.stylist_id, e.realizado_em,
           row_number() over (partition by e.stylist_id order by e.realizado_em, e.id) as n,
           e.realizado_em - lag(e.realizado_em) over (partition by e.stylist_id
                                                      order by e.realizado_em, e.id) as intervalo
      from ev e
     where e.status = 'realizado'
  ),
  turma as (
    select s.id,
           (s.ativou is not null) as ativou,
           exists (select 1 from ev e where e.stylist_id = s.id and e.status <> 'em_planejamento') as agendou,
           exists (select 1 from realizados r where r.stylist_id = s.id and r.n = 1) as realizou,
           exists (select 1 from realizados r where r.stylist_id = s.id and r.n = 2) as repetiu
      from sty s
  ),
  -- O FUNIL DO EVENTO — as contas de `funilDoEvento`: cada passo sobre o
  -- anterior (o 1º sem %), % arredondada, nula quando a base é 0.
  contas as (
    select * from (values
      (1, 'convidadas',  'Convidadas',             (select count(*)::int from sty)),
      (2, 'confirmaram', 'Confirmaram',            (select count(*)::int from sty
                                                      where ev_confirmou_em is not null or ev_presente_em is not null)),
      (3, 'presentes',   'Presentes',              (select count(*)::int from sty where ev_presente_em is not null)),
      (4, 'agendaram',   'Agendaram Private Edit', (select count(*)::int from turma where agendou and id in (select id from daqui))),
      (5, 'fizeram',     'Fizeram',                (select count(*)::int from turma where realizou and id in (select id from daqui))),
      (6, 'repetiram',   'Repetiram',              (select count(*)::int from turma where repetiu and id in (select id from daqui)))
    ) v(i, chave, rotulo, n)
  ),
  passos as (
    select i, chave, rotulo, n,
           case when i = 1 then null
                when lag(n) over (order by i) > 0 then round(n * 100.0 / lag(n) over (order by i))::int
           end as pct
      from contas
  ),
  -- a META do Growth Plan: agendaram sobre PRESENTES ≥ 50%; sem presentes, nula ("—").
  meta as (
    select case when p.n > 0 then round(a.n * 100.0 / p.n)::int end as pct
      from contas p, contas a where p.chave = 'presentes' and a.chave = 'agendaram'
  )
  select json_build_object(
    'edicao', json_build_object(
      'id', v_ed.id, 'praca_id', v_ed.praca_id, 'numero', v_ed.numero, 'nome', v_ed.nome,
      'comeca_em', v_ed.comeca_em, 'termina_em', v_ed.termina_em, 'situacao', v_ed.situacao),
    'funil', (select json_agg(json_build_object('chave', chave, 'rotulo', rotulo, 'n', n, 'pct', pct) order by i) from passos),
    'indisponiveis', (select count(*)::int from sty where ev_indisponivel_em is not null),
    'meta', (select json_build_object('pct', pct, 'bateu', case when pct is null then null else pct >= 50 end) from meta),
    'etapas', (select coalesce(json_agg(json_build_object(
                 'id', et.id, 'nome', et.nome, 'ordem', et.ordem, 'tipo', et.tipo,
                 'stylists', (select count(*)::int from sty s where s.etapa_id = et.id))
               order by et.ordem), '[]'::json)
               from public.vessel_stylist_etapas et where et.ativa),
    'prospectadas', (select count(*)::int from sty),
    'prospectadas_ja_ativadas', (select count(*)::int from turma where ativou),
    'ativadas', (select count(*)::int from turma where ativou),
    'com_private_edit_agendado', (select count(*)::int from turma where agendou),
    'com_private_edit_realizado', (select count(*)::int from turma where realizou),
    'recorrentes_no_periodo', (select count(*)::int from realizados where n = 2),
    'encontros_agendados', (select count(*)::int from ev where status <> 'em_planejamento'),
    'encontros_realizados', (select count(*)::int from ev where status = 'realizado'),
    'encontros_cancelados', (select count(*)::int from ev where status in ('cancelado', 'nao_realizado')),
    'convidadas', (select count(*)::int from conv),
    'confirmadas', (select count(*)::int from conv
                     where situacao in ('confirmada', 'presente', 'nao_compareceu')),
    'confirmadas_em_realizados', (select count(*)::int from conv
                     where situacao in ('confirmada', 'presente', 'nao_compareceu')
                       and status_do_encontro = 'realizado'),
    'presentes', (select count(*)::int from conv where status = 'realizado'),
    'presentes_em_realizados', (select count(*)::int from conv
                     where status = 'realizado' and status_do_encontro = 'realizado'),
    'intervalos', (select count(*)::int from realizados where intervalo is not null),
    'intervalo_medio_em_dias', (select round(avg(intervalo)::numeric, 1) from realizados
                                 where intervalo is not null),
    'contatos_ate_ativar', (select round(avg(n)::numeric, 1) from (
        select (select count(*) from public.vessel_stylist_contatos c
                 where c.stylist_id = s.id and c.criado_em < s.ativou) as n
          from sty s where s.ativou is not null) x),
    'stylists_com_contatos_ate_ativar', (select count(*)::int from sty s where s.ativou is not null)
  ) into v_saida;

  return v_saida;
end;
$$;

-- a lista de edições: `stylists` conta a turma pelo MESMO recorte do placar
-- (todas as linhas, sem `teste`, só `ativa`) e ganha `indisponiveis`.
-- `nao_ativadas` fica (a tela antiga lê), sem uso no encerrar novo.
create or replace function public.vessel_edicoes_listar(p_praca_id bigint)
returns json
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if not (public.vessel_pode('atendimentos.pracas', 'ver')
       or public.vessel_pode('atendimentos.edicoes', 'ver')
       or public.vessel_pode('atendimentos.stylist-circle', 'ver')
       or public.vessel_pode('atendimentos.private-edit', 'ver')) then
    raise exception 'sem permissao' using errcode = '42501';
  end if;
  return coalesce((
    select json_agg(json_build_object(
             'id', e.id, 'praca_id', e.praca_id, 'praca_nome', p.nome, 'numero', e.numero,
             'nome', e.nome, 'comeca_em', e.comeca_em, 'termina_em', e.termina_em, 'situacao', e.situacao,
             'stylists', (select count(*)::int from public.vessel_stylist_na_edicao n
                           join public.vessel_stylists s on s.id = n.stylist_id
                           where n.edicao_id = e.id and not coalesce(s.teste, false)
                             and coalesce(s.ativa, true)),
             'indisponiveis', (select count(*)::int from public.vessel_stylist_na_edicao n
                           join public.vessel_stylists s on s.id = n.stylist_id
                           where n.edicao_id = e.id and not coalesce(s.teste, false)
                             and coalesce(s.ativa, true) and n.indisponivel_em is not null),
             'nao_ativadas', (select count(*)::int from public.vessel_stylist_na_edicao n
                           join public.vessel_stylists s on s.id = n.stylist_id
                           where n.edicao_id = e.id and n.saiu_em is null
                             and public.vessel_stylist_ativada_em(s.id) is null
                             and not coalesce(s.teste, false)))
           order by p.ordem, e.numero desc)
      from public.vessel_stylist_circle_edicoes e join public.vessel_pracas p on p.id = e.praca_id
     where p_praca_id is null or e.praca_id = p_praca_id), '[]'::json);
end;
$$;

-- ── 8. os dados da Edição 1 · Campinas (id 46) ───────────────────────────────
-- Abrir puxou a praça inteira (30). Fica na turma só quem JÁ FOI CONVIDADA:
-- quem chegou (pelo histórico) ou está numa etapa de funil de Convidado em
-- diante. Em 28/09 são 10 — as 20 que saem nunca passaram de Conversa (a
-- maioria foi desclassificada direto de "Stylist levantado"). O recorte é pelo
-- histórico, e não pela etapa de hoje, porque a equipe segue movendo no
-- quadro: quem foi convidada e depois saiu (ex.: Ativada → Desclassificado)
-- continua tendo sido convidada ao evento.
-- convidada_em / confirmou_em = a data REAL da 1ª chegada em Convidado /
-- Confirmado (quem pulou Convidado recebe convidada_em = a chegada em
-- Confirmado). presente_em fica nulo: o evento é em 15/10.
-- ⚠️ NENHUMA STYLIST MUDA DE ETAPA aqui — só a tabela da turma.
do $$
declare
  v_conv   bigint;
  v_conf   bigint;
  v_ordem  int;
begin
  select max(id) filter (where lower(btrim(nome)) = 'convidado'),
         max(id) filter (where lower(btrim(nome)) = 'confirmado'),
         max(ordem) filter (where lower(btrim(nome)) = 'convidado')
    into v_conv, v_conf, v_ordem
    from public.vessel_stylist_etapas where ativa and tipo = 'funil';
  -- sem as etapas, o `not exists` abaixo apagaria a turma inteira
  if v_conv is null or v_conf is null then
    raise exception 'etapas Convidado/Confirmado nao achadas: a turma da Edicao 1 nao e mexida';
  end if;

  delete from public.vessel_stylist_na_edicao n
   where n.edicao_id = 46
     and not exists (select 1 from public.vessel_stylist_etapas_historico h
                       join public.vessel_stylist_etapas e on e.id = h.para_etapa_id
                      where h.stylist_id = n.stylist_id and e.tipo = 'funil' and e.ordem >= v_ordem)
     and not exists (select 1 from public.vessel_stylists s
                       join public.vessel_stylist_etapas e on e.id = s.etapa_id
                      where s.id = n.stylist_id and e.tipo = 'funil' and e.ordem >= v_ordem);

  -- a 1ª chegada NA PRÓPRIA etapa (não "de lá em diante"): o histórico tem
  -- clique errado — em 24/09 uma stylist foi levada a Presença e voltou para
  -- Confirmado 10 minutos depois, três semanas antes do evento. Presença
  -- nenhuma vem do histórico: o evento ainda não aconteceu.
  update public.vessel_stylist_na_edicao n
     set convidada_em = coalesce(n.convidada_em,
           (select min(h.em) from public.vessel_stylist_etapas_historico h
             where h.stylist_id = n.stylist_id and h.para_etapa_id = v_conv),
           (select min(h.em) from public.vessel_stylist_etapas_historico h
             where h.stylist_id = n.stylist_id and h.para_etapa_id = v_conf)),
         confirmou_em = coalesce(n.confirmou_em,
           (select min(h.em) from public.vessel_stylist_etapas_historico h
             where h.stylist_id = n.stylist_id and h.para_etapa_id = v_conf))
   where n.edicao_id = 46;
end $$;

-- ── 9. as portas ─────────────────────────────────────────────────────────────
-- As que já existiam guardam os grants (`create or replace`, mesma
-- assinatura). As novas ganham os das irmãs: authenticated sim, anon não.
do $$
declare f text;
begin
  foreach f in array array[
    'public.vessel_evento_de_origem(bigint)',
    'public.vessel_eventos_de_origem()',
    'public.vessel_edicao_tirar_stylist(text, bigint)',
    'public.vessel_edicao_turma(bigint)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
-- ⚠️ SEM GRANT: só é chamada de DENTRO de outra função `security definer`
-- (o mover e o abrir) — de fora, marcaria presença sem passar pela trava.
revoke all on function public.vessel_edicao_marcar_movimento(bigint, bigint, bigint) from public, anon, authenticated;
