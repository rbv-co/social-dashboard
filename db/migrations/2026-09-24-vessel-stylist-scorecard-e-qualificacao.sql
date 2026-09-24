-- STYLIST CIRCLE — O SCORECARD DE CADA STYLIST E A NOTA DE QUALIFICAÇÃO
--
-- Decisões do dono (24/09/2026), no brief
-- `.superpowers/sdd/scorecard/brief.md`:
--   1. cada stylist ganha um scorecard AUTOMÁTICO, com as MESMAS regras do
--      placar (janela D0..D+14, venda de quem foi a dois encontros conta no
--      PRIMEIRO, comparecimento = presentes ÷ confirmadas, as duas só dos
--      encontros realizados);
--   2. uma nota de qualificação 0–100 com faixa A/B/C, que UMA PESSOA dá — o
--      sistema só sugere, nunca muda sozinho;
--   3. metas fixas no placar e no scorecard (moram na tela, em
--      `src/ferramentas/comercial-vessel/qualificacao-regras.js`).
--
-- ⚠️ É IDEMPOTENTE: rodar duas vezes deixa o banco igual. Tabela e índice com
-- `if not exists`, funções com `create or replace`, gatilho com `drop … if
-- exists` antes.

-- ── 1. UMA CONTA SÓ PARA O PLACAR E PARA O SCORECARD ───────────────────────

-- ⚠️ O MIOLO É O CORPO DO PLACAR DA T11, LINHA POR LINHA, com UMA mudança: o
-- recorte `p_stylist`. Nulo = todas as stylists (o placar de sempre); um id =
-- só ela (o scorecard). Duas cópias da regra seriam duas telas que um dia
-- discordam — e a primeira discordância seria "a soma das fichas não bate com
-- o placar", que é exatamente a prova que o dono pediu.
--
-- ⚠️ A VENDA CONTINUA NO PRIMEIRO ENCONTRO MESMO RECORTADA: `vessel_vendas_
-- dos_encontros` decide a dona de cada pedido olhando TODOS os encontros, e só
-- depois o recorte fica com os pedidos dos encontros DELA. Uma cliente que foi
-- primeiro ao encontro da Marina e depois ao da Paula tem a compra na ficha da
-- Marina, e só nela.
--
-- ⚠️ É MIOLO, NÃO PORTA: não confere permissão nenhuma (quem confere são as
-- duas funções de baixo) e fica fechado para todo mundo.
create or replace function public.vessel_numeros_do_stylist_circle(
  p_de date, p_ate date, p_dias integer, p_stylist bigint)
returns json
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_de   date := coalesce(p_de, date '2000-01-01');
  -- ⚠️ SEM FIM ESCOLHIDO, O FIM É NENHUM — e não "hoje" (T11).
  v_ate  date := coalesce(p_ate, 'infinity'::date);
  v_dias int  := greatest(coalesce(p_dias, 14), 0);
  v_saida json;
begin
  with
  sty as (select * from public.vessel_stylists s
           where not coalesce(s.teste, false)
             and (p_stylist is null or s.id = p_stylist)),
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
  )
  select json_build_object(
    'de', p_de, 'ate', p_ate, 'janela_de_venda_em_dias', v_dias,
    'prospectadas', (select count(*)::int from sty where prospectado_em between v_de and v_ate),
    'ativadas', (select count(*)::int from sty
                  where (ativada_em at time zone 'America/Sao_Paulo')::date between v_de and v_ate),
    'prospectadas_ja_ativadas', (select count(*)::int from sty
                  where prospectado_em between v_de and v_ate
                    and (ativada_em at time zone 'America/Sao_Paulo')::date <= v_ate),
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
    'ativadas_ate_o_fim', (select count(*)::int from sty
                            where (ativada_em at time zone 'America/Sao_Paulo')::date <= v_ate),
    'intervalos', (select count(*)::int from realizados
                    where intervalo is not null and realizado_em between v_de and v_ate),
    'intervalo_medio_em_dias', (select round(avg(intervalo)::numeric, 1) from realizados
                                 where intervalo is not null and realizado_em between v_de and v_ate),
    'contatos_ate_ativar', (select round(avg(n)::numeric, 1) from (
        select (select count(*) from public.vessel_stylist_contatos c
                 where c.stylist_id = s.id and c.criado_em < s.ativada_em) as n
          from sty s where (s.ativada_em at time zone 'America/Sao_Paulo')::date between v_de and v_ate) x),
    'stylists_com_contatos_ate_ativar', (select count(*)::int from sty s
        where (s.ativada_em at time zone 'America/Sao_Paulo')::date between v_de and v_ate),
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

revoke all on function public.vessel_numeros_do_stylist_circle(date, date, integer, bigint)
  from public, anon, authenticated;

-- ⚠️ O PLACAR PASSA A SER PORTÃO + MIOLO. A assinatura, os padrões e o
-- formato da resposta são os de 22/09 — o aplicador compara a resposta de
-- antes e a de depois, na mesma transação, com os mesmos dados, e reprova se
-- um número sequer mudar.
create or replace function public.vessel_placar_do_stylist_circle(
  p_de date default null, p_ate date default null, p_dias integer default 14)
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
  return public.vessel_numeros_do_stylist_circle(p_de, p_ate, p_dias, null);
end;
$function$;

-- ── 2. O SCORECARD DE UMA STYLIST ───────────────────────────────────────────

-- Os números do placar recortados nela, mais o que só faz sentido para UMA
-- pessoa: o próximo encontro marcado, os dias desde o último, se ela já é
-- recorrente e quantos contatos levou até ativar.
--
-- ⚠️ STYLIST SEM ENCONTRO DEVOLVE ZEROS, NÃO ERRO: zero encontros é um fato
-- sobre ela. Só "não achei o código" é outra resposta (`nao_achei`).
create or replace function public.vessel_scorecard_da_stylist(
  p_codigo text, p_de date default null, p_ate date default null, p_dias integer default 14)
returns json
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
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
    'codigo', v_s.codigo, 'nome', v_s.nome, 'ativada_em', v_s.ativada_em,
    'realizados_desde_o_inicio', v_real,
    'recorrente', v_real >= 2,
    'ultimo_realizado_em', v_ult,
    'dias_desde_o_ultimo', case when v_ult is null then null else v_hoje - v_ult end,
    'proximo_encontro_em', v_prox_quando,
    'proximo_encontro_codigo', v_prox_codigo,
    'contatos', (select count(*)::int from public.vessel_stylist_contatos c where c.stylist_id = v_s.id),
    -- A mesma régua de `contatos_ate_ativar` do placar, só que dela: os
    -- contatos registrados ANTES do primeiro encontro agendado.
    'contatos_antes_de_ativar', case when v_s.ativada_em is null then null else
      (select count(*)::int from public.vessel_stylist_contatos c
        where c.stylist_id = v_s.id and c.criado_em < v_s.ativada_em) end,
    -- Para a sugestão de Confiabilidade: parceira que já ativou e some.
    'contatos_sem_resposta_depois_de_ativar', case when v_s.ativada_em is null then null else
      (select count(*)::int from public.vessel_stylist_contatos c
        where c.stylist_id = v_s.id and c.resultado = 'sem_resposta'
          and c.criado_em >= v_s.ativada_em) end
  ))::json;
end;
$function$;

-- ── 3. A NOTA DE QUALIFICAÇÃO ───────────────────────────────────────────────

-- ⚠️ A FONTE: `materiais/06_Stylist_Circle_Proposta_e_Onboarding.txt`,
-- "Qualificação do stylist". Pesos 30/25/20/15/10; A ≥ 75, B 55–74, C < 55.
-- Pontos do critério = peso × nível ÷ 5 — como os pesos são múltiplos de 5,
-- dá sempre inteiro: 6·carteira + 5·portfólio + 4·mobilização + 3·acesso +
-- 2·confiabilidade. Nota mínima possível 20 (tudo nível 1), máxima 100.
-- ⚠️ A MESMA CONTA MORA EM `qualificacao-regras.js`; o teste de lá lê esta.
create or replace function public.vessel_faixa_da_nota(p_nota integer)
returns text
language sql
immutable
as $$
  select case
    when p_nota is null then null
    when p_nota >= 75 then 'A'
    when p_nota >= 55 then 'B'
    else 'C'
  end
$$;
revoke all on function public.vessel_faixa_da_nota(integer) from public, anon, authenticated;

-- ⚠️ SÓ ACRESCENTA. Reavaliar é uma linha nova; a vigente é a mais recente, e
-- o histórico ("B em 25/09 → A em 20/10") é a tabela inteira. Nada se edita
-- nem se apaga — o gatilho abaixo recusa, e nenhuma função escreve update.
-- ⚠️ `on delete restrict`, como `vessel_private_edits`: uma stylist com
-- história não some. (Os contatos são `cascade`; a nota não, porque apagar
-- a stylist por baixo apagaria o registro de quem avaliou.)
create table if not exists public.vessel_stylist_qualificacoes (
  id                bigserial primary key,
  stylist_id        bigint not null references public.vessel_stylists(id) on delete restrict,
  carteira          smallint not null,
  portfolio         smallint not null,
  mobilizacao       smallint not null,
  acesso            smallint not null,
  confiabilidade    smallint not null,
  nota              smallint generated always as
                      (6 * carteira + 5 * portfolio + 4 * mobilizacao + 3 * acesso + 2 * confiabilidade) stored,
  faixa             text generated always as
                      (public.vessel_faixa_da_nota(6 * carteira + 5 * portfolio + 4 * mobilizacao
                                                   + 3 * acesso + 2 * confiabilidade)) stored,
  observacao        text,
  avaliado_em       timestamptz not null default now(),
  avaliado_por      uuid,
  avaliado_por_nome text,
  teste             boolean not null default false,
  constraint vessel_stylist_qualificacoes_niveis check (
    carteira between 1 and 5 and portfolio between 1 and 5 and mobilizacao between 1 and 5
    and acesso between 1 and 5 and confiabilidade between 1 and 5),
  constraint vessel_stylist_qualificacoes_observacao_curta
    check (observacao is null or length(observacao) <= 280)
);
create index if not exists vessel_stylist_qualificacoes_stylist_idx
  on public.vessel_stylist_qualificacoes (stylist_id, avaliado_em desc, id desc);

-- ⚠️ AS MESMAS TRÊS LINHAS DA IRMÃ `vessel_stylist_contatos`: trava ligada,
-- nenhuma política e nada concedido. Só as funções abaixo (security definer)
-- leem e escrevem — e cada uma confere o portão por dentro.
alter table public.vessel_stylist_qualificacoes enable row level security;
revoke all on table public.vessel_stylist_qualificacoes from anon, authenticated;
revoke all on sequence public.vessel_stylist_qualificacoes_id_seq from anon, authenticated;

comment on table public.vessel_stylist_qualificacoes is
  'Nota de qualificacao da stylist (0-100, faixa A/B/C), dada por uma pessoa. '
  'So acrescenta: a vigente e a mais recente. Nao trava etapa nenhuma do funil.';

create or replace function public.vessel_stylist_qualificacoes_so_acrescenta()
returns trigger
language plpgsql
as $$
begin
  raise exception 'avaliacao de stylist nao se edita nem se apaga: registre uma nova'
    using errcode = '42501';
end;
$$;
revoke all on function public.vessel_stylist_qualificacoes_so_acrescenta() from public, anon, authenticated;

drop trigger if exists vessel_stylist_qualificacoes_so_acrescenta on public.vessel_stylist_qualificacoes;
create trigger vessel_stylist_qualificacoes_so_acrescenta
  before update or delete on public.vessel_stylist_qualificacoes
  for each row execute function public.vessel_stylist_qualificacoes_so_acrescenta();
drop trigger if exists vessel_stylist_qualificacoes_sem_truncate on public.vessel_stylist_qualificacoes;
create trigger vessel_stylist_qualificacoes_sem_truncate
  before truncate on public.vessel_stylist_qualificacoes
  for each statement execute function public.vessel_stylist_qualificacoes_so_acrescenta();

-- ⚠️ A TRAVA DE MEXER, NÃO A DE VER: a mesma `is_vessel_atendimentos_editar()`
-- que o CRM da stylist usa para registrar contato e mudar etapa. Nível fora de
-- 1..5 (ou faltando) é recusado aqui ANTES do `CHECK` da tabela — que também
-- recusaria, mas derrubando a transação com um erro cru em vez de uma
-- `situacao` que a tela sabe dizer.
create or replace function public.vessel_stylist_avaliar(
  p_codigo text,
  p_carteira integer, p_portfolio integer, p_mobilizacao integer,
  p_acesso integer, p_confiabilidade integer,
  p_observacao text default null)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_codigo text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
  v_obs    text := nullif(trim(coalesce(p_observacao, '')), '');
  v_s      public.vessel_stylists%rowtype;
  v_q      public.vessel_stylist_qualificacoes%rowtype;
begin
  if not public.is_vessel_atendimentos_editar() then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  select * into v_s from public.vessel_stylists where codigo = v_codigo;
  if v_s.id is null then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;
  if p_carteira is null or p_portfolio is null or p_mobilizacao is null
     or p_acesso is null or p_confiabilidade is null
     or p_carteira not between 1 and 5 or p_portfolio not between 1 and 5
     or p_mobilizacao not between 1 and 5 or p_acesso not between 1 and 5
     or p_confiabilidade not between 1 and 5 then
    return json_build_object('ok', false, 'situacao', 'nivel_invalido');
  end if;
  if v_obs is not null and length(v_obs) > 280 then
    return json_build_object('ok', false, 'situacao', 'observacao_longa');
  end if;

  insert into public.vessel_stylist_qualificacoes
    (stylist_id, carteira, portfolio, mobilizacao, acesso, confiabilidade, observacao,
     avaliado_por, avaliado_por_nome, teste)
  values (v_s.id, p_carteira, p_portfolio, p_mobilizacao, p_acesso, p_confiabilidade, v_obs,
          auth.uid(),
          (select coalesce(nullif(trim(p.name), ''), p.email) from public.profiles p where p.id = auth.uid()),
          coalesce(v_s.teste, false))
  returning * into v_q;

  return json_build_object('ok', true, 'situacao', 'ok', 'id', v_q.id,
    'nota', v_q.nota, 'faixa', v_q.faixa, 'avaliado_em', v_q.avaliado_em);
end;
$function$;

-- O histórico de UMA stylist, da mais recente para a mais antiga (a primeira
-- é a vigente). Lista vazia, não erro, para quem não vê: é um bloco dentro de
-- uma ficha já aberta — a mesma regra de `vessel_stylist_contatos`.
create or replace function public.vessel_stylist_qualificacoes(p_codigo text)
returns json
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare v_saida json;
begin
  if not public.is_vessel_atendimentos() then return '[]'::json; end if;
  select coalesce(json_agg(json_build_object(
           'id', q.id, 'carteira', q.carteira, 'portfolio', q.portfolio,
           'mobilizacao', q.mobilizacao, 'acesso', q.acesso, 'confiabilidade', q.confiabilidade,
           'nota', q.nota, 'faixa', q.faixa, 'observacao', q.observacao,
           'avaliado_em', q.avaliado_em, 'avaliado_por_nome', q.avaliado_por_nome)
         order by q.avaliado_em desc, q.id desc), '[]'::json)
    into v_saida
    from public.vessel_stylist_qualificacoes q
    join public.vessel_stylists s on s.id = q.stylist_id
   where s.codigo = upper(nullif(trim(coalesce(p_codigo, '')), ''));
  return v_saida;
end;
$function$;

-- A nota VIGENTE de cada stylist, para o selo do quadro e da lista. Quem não
-- tem nota não aparece aqui — a tela escreve "Sem nota".
-- ⚠️ ERRO, NÃO LISTA VAZIA, PARA QUEM NÃO VÊ: vazio aqui pintaria "Sem nota"
-- em todo mundo, que é uma afirmação falsa. Mesma regra do rastreio.
create or replace function public.vessel_qualificacoes_vigentes()
returns json
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare v_saida json;
begin
  if not public.is_vessel_atendimentos() then
    raise exception 'sem permissao' using errcode = '42501';
  end if;
  select coalesce(json_agg(json_build_object(
           'codigo', x.codigo, 'nota', x.nota, 'faixa', x.faixa, 'avaliado_em', x.avaliado_em)
         order by x.codigo), '[]'::json)
    into v_saida
    from (select distinct on (q.stylist_id) s.codigo, q.nota, q.faixa, q.avaliado_em
            from public.vessel_stylist_qualificacoes q
            join public.vessel_stylists s on s.id = q.stylist_id
           where not coalesce(s.teste, false)
           order by q.stylist_id, q.avaliado_em desc, q.id desc) x;
  return v_saida;
end;
$function$;

-- ── 4. AS PORTAS ────────────────────────────────────────────────────────────

-- ⚠️ `revoke ... from public` NÃO FECHA `anon` NEM `authenticated`: as duas
-- linhas de cada porta são obrigatórias. E o portão de verdade está DENTRO de
-- cada uma — o `grant` só deixa a Central bater à porta.
do $$
declare f text;
begin
  foreach f in array array[
    'public.vessel_placar_do_stylist_circle(date, date, integer)',
    'public.vessel_scorecard_da_stylist(text, date, date, integer)',
    'public.vessel_stylist_avaliar(text, integer, integer, integer, integer, integer, text)',
    'public.vessel_stylist_qualificacoes(text)',
    'public.vessel_qualificacoes_vigentes()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
