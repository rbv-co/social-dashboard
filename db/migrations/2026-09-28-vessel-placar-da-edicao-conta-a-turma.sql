-- O PLACAR DA EDIÇÃO CONTA A TURMA, NÃO A JANELA (decisão do dono, 28/09/2026).
--
-- EDIÇÃO = TURMA DE ENTRADA: começa no dia do Preview; termina quando alguém
-- fecha a turma (para de entrar stylist nova) — e o fim NÃO corta nada do que
-- acontece depois. Os Private Edits (e os convites deles) que o placar conta
-- passam a ser os das stylists da turma, em qualquer data e praça.
--
-- Só `vessel_placar_da_edicao` muda; mesma assinatura, `create or replace`
-- guarda os grants. Base: o corpo de 2026-09-25-vessel-praca-e-edicao.sql,
-- conferido igual ao de produção antes de escrever este arquivo.
create or replace function public.vessel_placar_da_edicao(p_edicao_id bigint)
returns json
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
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
  -- ⚠️ O CONGELAMENTO mora AQUI: numa edição ENCERRADA, todas as linhas dela
  -- contam, sem filtrar por `saiu_em` — o placar não zera ao encerrar.
  -- Trocar este `where` por `1=1` é a mutação que o aplicador prova
  -- reprovar — sem ele, Limeira contaria stylist de Campinas.
  --
  -- ⚠️ RODADA 1 DE CONSERTO (CRÍTICO 1): numa edição ainda ABERTA, uma linha
  -- com `saiu_em` preenchido é gente que MUDOU DE PRAÇA (ver
  -- `vessel_stylist_sincronizar_edicao`) — ela não pode continuar contando
  -- na edição de origem enquanto essa segue aberta, senão conta em DUAS
  -- edições abertas ao mesmo tempo. Só em `encerrada` o congelamento vale.
  turma_ids as (
    select distinct n.stylist_id from public.vessel_stylist_na_edicao n
     where n.edicao_id = p_edicao_id
       and (v_ed.situacao = 'encerrada' or n.saiu_em is null)
  ),
  -- ⚠️ RODADA 1 DE CONSERTO (MENOR 1): filtra `teste` igual às irmãs
  -- (`vessel_rastreio_dos_stylists`, `vessel_numeros_do_stylist_circle`) —
  -- sem isto uma stylist de teste entraria no placar e sumiria da lista
  -- embaixo, e o funil não fecharia com a lista.
  sty as (
    select s.*, public.vessel_stylist_ativada_em(s.id) as ativou
      from public.vessel_stylists s
     where s.id in (select stylist_id from turma_ids)
       and not coalesce(s.teste, false)
       -- ⚠️ RODADA 1 DE CONSERTO (IMPORTANTE 5): o mesmo tratamento de
       -- `teste`, agora para `ativa` — sem isto uma stylist desativada conta
       -- no placar e some do quadro/lista, e os dois deixam de fechar.
       and coalesce(s.ativa, true)
  ),
  -- ⚠️ 28/09/2026 — EDIÇÃO = TURMA DE ENTRADA (decisão do dono). Os
  -- encontros são os das STYLISTS DA TURMA (`turma_ids`), em QUALQUER data e
  -- QUALQUER praça: o fim da edição só fecha a entrada de stylist nova, não
  -- corta o que a turma faz depois. Quem segue fazendo Private Edit depois de
  -- encerrada continua contando aqui para sempre. (Até 28/09 eram os
  -- encontros da praça na janela comeca_em..termina_em.)
  ev as (
    select e.*
      from public.vessel_private_edits e
     where not coalesce(e.teste, false) and not coalesce(e.arquivada, false)
       and e.stylist_id in (select stylist_id from turma_ids)
  ),
  -- os convites são os dos encontros da turma (herdam o recorte de `ev`).
  conv as (
    select t.id, t.pessoa_id, t.status, e.codigo, e.status as status_do_encontro,
           public.vessel_situacao_do_convite(t.status, t.rsvp, t.convite_enviado_em,
                                             e.quando, e.status) as situacao
      from public.vessel_atendimentos t
      join ev e on e.codigo = t.evento_codigo
     where not coalesce(t.teste, false)
  ),
  -- os realizados DA TURMA (para as taxas): o 1º e o 2º encontro realizado de
  -- cada stylist desta edição, em qualquer data.
  realizados as (
    select e.stylist_id, e.realizado_em,
           row_number() over (partition by e.stylist_id order by e.realizado_em, e.id) as n,
           -- ⚠️ RODADA 1 DE CONSERTO (IMPORTANTE 4): o `lag()` que faltava —
           -- a MESMA conta de `vessel_numeros_do_stylist_circle`.
           e.realizado_em - lag(e.realizado_em) over (partition by e.stylist_id
                                                      order by e.realizado_em, e.id) as intervalo
      from ev e
     where e.status = 'realizado' and e.stylist_id in (select stylist_id from turma_ids)
  ),
  -- a turma, passo a passo — cada passo DENTRO do anterior: a MESMA turma em
  -- cima e embaixo das taxas de t11-regras.js (taxasDoPlacar).
  turma as (
    select s.id,
           (s.ativou is not null) as ativou,
           exists (select 1 from ev e where e.stylist_id = s.id and e.status <> 'em_planejamento') as agendou,
           exists (select 1 from realizados r where r.stylist_id = s.id and r.n = 1) as realizou
      from sty s
  )
  select json_build_object(
    'edicao', json_build_object(
      'id', v_ed.id, 'praca_id', v_ed.praca_id, 'numero', v_ed.numero, 'nome', v_ed.nome,
      'comeca_em', v_ed.comeca_em, 'termina_em', v_ed.termina_em, 'situacao', v_ed.situacao),
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
    -- ⚠️ RODADA 1 DE CONSERTO (IMPORTANTE 4): os dois números que voltam.
    -- `intervalos`/`intervalo_medio_em_dias` — sobre os realizados da turma
    -- (a mesma regra de `ev`/`conv` acima).
    'intervalos', (select count(*)::int from realizados where intervalo is not null),
    'intervalo_medio_em_dias', (select round(avg(intervalo)::numeric, 1) from realizados
                                 where intervalo is not null),
    -- `contatos_ate_ativar`/`stylists_com_contatos_ate_ativar` — sobre a
    -- turma (`sty`) que já ativou, pela MESMA ativação que o resto desta
    -- função usa (`sty.ativou`, não a coluna crua).
    'contatos_ate_ativar', (select round(avg(n)::numeric, 1) from (
        select (select count(*) from public.vessel_stylist_contatos c
                 where c.stylist_id = s.id and c.criado_em < s.ativou) as n
          from sty s where s.ativou is not null) x),
    'stylists_com_contatos_ate_ativar', (select count(*)::int from sty s where s.ativou is not null)
  ) into v_saida;

  return v_saida;
end;
$function$;
