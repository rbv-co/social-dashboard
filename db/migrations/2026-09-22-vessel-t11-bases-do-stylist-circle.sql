-- T11 DO GROWTH PLAN — AS BASES DE CONTROLE DO STYLIST CIRCLE
--
-- Especificação: `VESSEL_Especificacao_Bases_Controle_Stylist_Circle.docx`
-- (22/09/2026), guardada no pacote do plano como
-- `materiais/18_Stylist_Circle_Bases_de_Controle_T11.docx`.
--
-- ⚠️ AS TRÊS BASES QUE O DOCUMENTO PEDE JÁ EXISTIAM, COM OUTRO NOME. Esta
-- migration COMPLETA — não cria tabela nova:
--   · Base de Stylists   → `vessel_stylists`
--   · Base de Eventos    → `vessel_private_edits`
--   · Base de Convidadas → `vessel_atendimentos` com `evento_codigo`
--     (Guest ID = `vessel_atendimentos.id`; CRM Client ID = `pessoa_id`, a
--     ficha de `vessel_pessoas`, que o robô dos pedidos liga ao Bling pelo
--     telefone toda madrugada — `coletor/trazer-pedidos-do-bling.mjs`).
--
-- ⚠️ AS QUATRO DECISÕES DO DONO (22/09/2026), que o documento deixava abertas:
--   1. vale o FUNIL DO DOCUMENTO, não o do módulo 10;
--   2. a venda de quem foi a dois encontros conta para o PRIMEIRO;
--   3. "CRM" é o cadastro de clientes do iamundi;
--   4. capacidade planejada de 7 a 10 convidadas.
--
-- ⚠️ MEDIDO ANTES: `vessel_stylists` e `vessel_private_edits` têm ZERO linhas.
-- Por isso as listas fechadas entram sem migrar dado de ninguém.

-- ── 1. A BASE DE STYLISTS ───────────────────────────────────────────────────

-- ⚠️ O FUNIL VIRA LISTA FECHADA. Antes era texto livre (a tela sugeria
-- "pedido/convidada/ativa/pausada" num datalist), e o documento manda "listas
-- de status com validação para evitar textos livres divergentes".
--
-- Os três degraus do meio — `ativado`, `evento_realizado` e `recorrente` —
-- NÃO SE DIGITAM: quem os escreve é o gatilho do bloco 5, a partir dos
-- encontros. O documento proíbe digitar indicador, e "recorrente" é um.
update public.vessel_stylists
   set estagio = 'prospectado'
 where estagio not in ('prospectado', 'contatado', 'interessado', 'em_negociacao',
                       'ativado', 'evento_realizado', 'recorrente',
                       'sem_retorno', 'nao_interessado', 'pausado', 'inativo');

alter table public.vessel_stylists alter column estagio set default 'prospectado';

alter table public.vessel_stylists drop constraint if exists vessel_stylists_estagio_valido;
alter table public.vessel_stylists add constraint vessel_stylists_estagio_valido
  check (estagio in ('prospectado', 'contatado', 'interessado', 'em_negociacao',
                     'ativado', 'evento_realizado', 'recorrente',
                     'sem_retorno', 'nao_interessado', 'pausado', 'inativo'));

alter table public.vessel_stylists
  add column if not exists loja            text,
  -- ⚠️ `inbound` É O PADRÃO porque a porta pública (`vessel_pedido_do_stylist`)
  -- não passa este campo — e quem entra por ela chegou sozinha. Quem é
  -- cadastrada na Central escolhe na tela (a função exige).
  add column if not exists origem_contato  text not null default 'inbound',
  add column if not exists responsavel     text,
  add column if not exists prospectado_em  date not null
    default (now() at time zone 'America/Sao_Paulo')::date,
  add column if not exists proxima_acao    text,
  add column if not exists proxima_acao_em date,
  -- ⚠️ CONGELA NA PRIMEIRA VEZ. "Ativado" é o dia em que o primeiro encontro
  -- foi agendado; cancelar aquele encontro depois não desfaz a ativação — ela
  -- aconteceu, e a taxa de ativação do período em que ela aconteceu não pode
  -- mudar de valor no mês seguinte.
  add column if not exists ativada_em      timestamptz;

alter table public.vessel_stylists drop constraint if exists vessel_stylists_loja_valida;
alter table public.vessel_stylists add constraint vessel_stylists_loja_valida
  check (loja is null or loja in ('iguatemi', 'tivoli', 'parkshopping'));
alter table public.vessel_stylists drop constraint if exists vessel_stylists_origem_contato_valida;
alter table public.vessel_stylists add constraint vessel_stylists_origem_contato_valida
  check (origem_contato in ('indicacao', 'pesquisa', 'evento', 'inbound'));

comment on column public.vessel_stylists.origem_contato is
  'Como a operacao chegou nela (T11): indicacao | pesquisa | evento | inbound. '
  'NAO e a origem de campanha (`origem_canal`, primeiro toque): esta e da Ionara.';
comment on column public.vessel_stylists.ativada_em is
  'Quando o PRIMEIRO encontro dela foi agendado. Escrita pelo gatilho de '
  '`vessel_private_edits`, uma vez so, e nunca desfeita.';

-- ── 2. A BASE DE EVENTOS ────────────────────────────────────────────────────

alter table public.vessel_private_edits
  add column if not exists status       text not null default 'agendado',
  add column if not exists realizado_em date,
  add column if not exists motivo       text,
  add column if not exists observacoes  text;

alter table public.vessel_private_edits drop constraint if exists vessel_private_edits_status_valido;
alter table public.vessel_private_edits add constraint vessel_private_edits_status_valido
  check (status in ('em_planejamento', 'agendado', 'confirmado', 'realizado',
                    'reagendado', 'cancelado', 'nao_realizado'));
-- ⚠️ AS DUAS REGRAS DO DOCUMENTO MORAM NA TABELA, não só na função: "motivo
-- obrigatório quando cancelado" e "data efetiva quando realizado". Uma função
-- nova que escrevesse `status` por outro caminho não conseguiria esquecê-las.
alter table public.vessel_private_edits drop constraint if exists vessel_private_edits_motivo_quando_cai;
alter table public.vessel_private_edits add constraint vessel_private_edits_motivo_quando_cai
  check (status not in ('cancelado', 'nao_realizado') or nullif(trim(coalesce(motivo, '')), '') is not null);
alter table public.vessel_private_edits drop constraint if exists vessel_private_edits_realizado_tem_data;
alter table public.vessel_private_edits add constraint vessel_private_edits_realizado_tem_data
  check (status <> 'realizado' or realizado_em is not null);

comment on column public.vessel_private_edits.status is
  'T11: em_planejamento | agendado | confirmado | realizado | reagendado | '
  'cancelado | nao_realizado. NAO e `ativa` (convite aceitando resposta) nem '
  '`arquivada` (sai das contas).';

-- ── 3. A BASE DE CONVIDADAS ─────────────────────────────────────────────────

-- ⚠️ SÓ DUAS DATAS NOVAS. A situação do convite (Convidada → Convite enviado →
-- Confirmada → Presente…) NÃO vira coluna: ela já está escrita em `rsvp` e em
-- `status`, e uma terceira coluna dizendo a mesma coisa seria duas verdades
-- que um dia discordam. Quem a calcula é `vessel_situacao_do_convite`, abaixo,
-- e é a MESMA para a tela e para o placar.
alter table public.vessel_atendimentos
  add column if not exists convidada_em       timestamptz,
  add column if not exists convite_enviado_em timestamptz;

comment on column public.vessel_atendimentos.convidada_em is
  'Quando a equipe incluiu esta convidada no encontro (T11). Nulo = ela chegou '
  'sozinha, pelo link do convite.';

create or replace function public.vessel_situacao_do_convite(
  p_status text, p_rsvp text, p_enviado_em timestamptz,
  p_evento_quando timestamptz, p_evento_status text)
returns text
language sql
-- ⚠️ `stable`, NÃO `immutable`: "não respondeu" depende de o encontro já ter
-- passado, e isso lê `now()`. Marcada imutável, o Postgres poderia guardar a
-- resposta de ontem.
stable
as $$
  -- ⚠️ A ORDEM É A REGRA. Presença vence tudo (quem veio, veio); depois a
  -- falta; depois a recusa; depois a confirmação. "Não respondeu" só existe
  -- quando o encontro já passou — antes disso ela ainda pode responder.
  select case
    when p_status = 'realizado' then 'presente'
    when p_status = 'no_show'   then 'nao_compareceu'
    when p_status = 'cancelado' or p_rsvp = 'nao' then 'recusou'
    when p_status = 'confirmado' or p_rsvp = 'sim' then 'confirmada'
    when p_evento_status in ('realizado', 'nao_realizado', 'cancelado')
      or p_evento_quando < now() then 'nao_respondeu'
    when p_enviado_em is not null or p_rsvp is not null then 'convite_enviado'
    else 'convidada'
  end
$$;

-- ── 4. A VENDA DE CADA ENCONTRO — o miolo que as três contas usam ───────────

-- ⚠️ DECISÃO 2 DO DONO: A VENDA VAI PARA O PRIMEIRO ENCONTRO. Uma cliente que
-- foi a dois encontros com menos de 14 dias entre eles tem a compra dentro das
-- duas janelas; antes, a receita dos dois somava a mesma venda. Aqui cada
-- pedido aparece UMA vez, no encontro mais antigo cuja janela o contém.
--
-- ⚠️ SÓ PEDIDO ATENDIDO NO BLING (`situacao_id = 9`). É a mesma régua que o
-- resto do sistema passou a usar em 21/09 (`2026-09-21-pedido-conferido-no-
-- bling.sql`): 12 é cancelado, nulo é pedido que sumiu. As contas do Private
-- Edit somavam os dois.
--
-- ⚠️ UM MIOLO SÓ, PARA TRÊS LEITORES: a receita do encontro, a coluna
-- "Comprou" da lista de convidadas e o placar. Três cópias da mesma regra são
-- três telas que um dia discordam.
create or replace function public.vessel_vendas_dos_encontros(p_dias int default 14)
returns table (pedido_id bigint, evento_codigo text, stylist_id bigint, pessoa_id bigint,
               receita numeric, pecas numeric, quando_do_encontro timestamptz)
language sql
stable
security definer
set search_path to 'public'
as $$
  select distinct on (p.id)
         p.id, e.codigo, e.stylist_id, p.pessoa_id,
         coalesce(p.receita_liquida, p.total_corrigido, 0),
         coalesce((select sum(i.quantidade) from public.vessel_pedido_itens i
                    where i.pedido_id = p.id), 0),
         e.quando
    from public.vessel_pedidos p
    join public.vessel_atendimentos t
      on t.pessoa_id = p.pessoa_id
     and t.evento_codigo is not null
     and t.status = 'realizado'
     and not coalesce(t.teste, false)
    join public.vessel_private_edits e
      on e.codigo = t.evento_codigo
     and not coalesce(e.teste, false)
     and not coalesce(e.arquivada, false)
   where p.situacao_id = 9
     and p.data_do_pedido
           between (e.quando at time zone 'America/Sao_Paulo')::date
               and (e.quando at time zone 'America/Sao_Paulo')::date
                   + greatest(coalesce(p_dias, 14), 0)
   order by p.id, e.quando, e.id
$$;

-- ⚠️ É MIOLO, NÃO PORTA: devolve pessoa e receita sem conferir permissão
-- nenhuma. Só as funções de conta (que conferem) chamam.
revoke all on function public.vessel_vendas_dos_encontros(int) from public, anon, authenticated;
revoke all on function public.vessel_situacao_do_convite(text, text, timestamptz, timestamptz, text)
  from public, anon;

-- ── 5. O FUNIL ANDA SOZINHO PELOS ENCONTROS ─────────────────────────────────

-- ⚠️ GATILHO, E NÃO UMA LINHA EM CADA FUNÇÃO. Encontro nasce por
-- `vessel_criar_private_edit`, muda de anfitriã por `_editar`, muda de
-- situação por `_situacao` e some por `_apagar` — quatro portas. Uma chamada
-- esquecida em qualquer uma deixaria o funil parado, calado.
create or replace function public.vessel_stylist_seguir_os_encontros(p_stylist bigint)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_realizados int;
  v_marcados   int;
  v_fase       text;
begin
  if p_stylist is null then return; end if;

  select count(*) filter (where e.status = 'realizado'),
         count(*) filter (where e.status in ('agendado', 'confirmado', 'reagendado',
                                             'realizado', 'nao_realizado', 'cancelado'))
    into v_realizados, v_marcados
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
  -- Os outros estágios são o funil andando, e aí manda o fato.
  update public.vessel_stylists s
     set estagio = coalesce(v_fase,
                            case when s.estagio in ('ativado', 'evento_realizado', 'recorrente')
                                 then 'ativado' else s.estagio end),
         atualizado_em = now()
   where s.id = p_stylist
     and s.estagio not in ('pausado', 'inativo')
     and s.estagio is distinct from coalesce(v_fase,
           case when s.estagio in ('ativado', 'evento_realizado', 'recorrente')
                then 'ativado' else s.estagio end);
end;
$$;

create or replace function public.vessel_private_edits_mexe_no_funil()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- ⚠️ `if` ANINHADO, E NÃO UM `or` NUMA LINHA SÓ: o Postgres não promete
  -- avaliar o `or` da esquerda para a direita, e ler `old` num INSERT é erro.
  if tg_op = 'INSERT' then
    perform public.vessel_stylist_seguir_os_encontros(new.stylist_id);
  elsif tg_op = 'DELETE' then
    perform public.vessel_stylist_seguir_os_encontros(old.stylist_id);
  elsif new.stylist_id is distinct from old.stylist_id
        or new.status is distinct from old.status
        or new.arquivada is distinct from old.arquivada then
    -- Trocar a anfitriã mexe no funil das DUAS.
    perform public.vessel_stylist_seguir_os_encontros(old.stylist_id);
    if new.stylist_id is distinct from old.stylist_id then
      perform public.vessel_stylist_seguir_os_encontros(new.stylist_id);
    end if;
  end if;
  return null;
end;
$$;

drop trigger if exists vessel_private_edits_funil on public.vessel_private_edits;
create trigger vessel_private_edits_funil
  after insert or update or delete on public.vessel_private_edits
  for each row execute function public.vessel_private_edits_mexe_no_funil();

revoke all on function public.vessel_stylist_seguir_os_encontros(bigint) from public, anon, authenticated;
revoke all on function public.vessel_private_edits_mexe_no_funil() from public, anon, authenticated;

-- ── 6. CADASTRAR E CORRIGIR A STYLIST, com os campos da T11 ─────────────────

-- ⚠️ `drop` + `create`, NÃO `create or replace`: a lista de parâmetros muda, e
-- `create or replace` criaria uma SEGUNDA função com o mesmo nome — o
-- PostgREST responderia "function is not unique" para a tela.
drop function if exists public.vessel_stylist_criar(text, text, text, text, text, text);

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
  p_proxima_acao_em date default null
)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_fone   text;
  v_praca  text := upper(nullif(trim(coalesce(p_praca, '')), ''));
  v_loja   text := lower(nullif(trim(coalesce(p_loja, '')), ''));
  v_origem text := lower(nullif(trim(coalesce(p_origem_contato, '')), ''));
  v_hoje   date := (now() at time zone 'America/Sao_Paulo')::date;
  v_codigo text;
  v_n      int;
  v_volta  int;
  v_indice text;
begin
  -- ⚠️ A TRAVA DE MEXER, NAO A DE VER (ver `2026-09-19-vessel-stylist-mexer.sql`).
  if not public.is_vessel_atendimentos_editar() then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;

  if nullif(trim(coalesce(p_nome, '')), '') is null then
    return json_build_object('ok', false, 'situacao', 'sem_nome');
  end if;

  v_fone := public.vessel_telefone_canonico(p_whatsapp);
  if v_fone is null then
    return json_build_object('ok', false, 'situacao', 'whatsapp_invalido');
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

  if exists (select 1 from public.vessel_stylists where whatsapp = v_fone) then
    return json_build_object('ok', false, 'situacao', 'whatsapp_repetido',
      'codigo', (select s.codigo from public.vessel_stylists s where s.whatsapp = v_fone));
  end if;

  -- ⚠️ A TRAVA DE FILA E O CINTO, copiados da versão de 19/09 sem mudança: o
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
         loja, origem_contato, responsavel, prospectado_em, proxima_acao, proxima_acao_em)
      values
        (v_codigo, trim(p_nome), v_fone,
         nullif(trim(coalesce(p_cidade, '')), ''),
         nullif(trim(coalesce(p_instagram, '')), ''),
         nullif(trim(coalesce(p_atuacao, '')), ''),
         v_praca, v_loja, v_origem,
         nullif(trim(coalesce(p_responsavel, '')), ''),
         coalesce(p_prospectado_em, v_hoje),
         nullif(trim(coalesce(p_proxima_acao, '')), ''),
         p_proxima_acao_em);

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

drop function if exists public.vessel_stylist_editar(text, text, text, text, text, text, text, text);

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
  -- ela foi feita. Este é o jeito, explícito — nunca uma string vazia que
  -- significa uma coisa num campo e outra no vizinho.
  p_sem_proxima_acao boolean default false
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
  v_praca   text := upper(nullif(trim(coalesce(p_praca, '')), ''));
  v_loja    text := lower(nullif(trim(coalesce(p_loja, '')), ''));
  v_origem  text := lower(nullif(trim(coalesce(p_origem_contato, '')), ''));
  v_estagio text := lower(nullif(trim(coalesce(p_estagio, '')), ''));
  v_ativada timestamptz;
begin
  if not public.is_vessel_atendimentos_editar() then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;

  select s.ativada_em into v_ativada from public.vessel_stylists s where s.codigo = v_codigo;
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
    -- ⚠️ E QUEM JÁ TEVE ENCONTRO NÃO VOLTA PARA ANTES DELE. "Contatado" para
    -- uma parceira que já hospedou um Private Edit contradiz o fato, e a taxa
    -- de ativação passaria a mentir.
    if v_ativada is not null and v_estagio in ('prospectado', 'contatado', 'interessado',
                                               'em_negociacao') then
      return json_build_object('ok', false, 'situacao', 'estagio_contradiz_encontro');
    end if;
  end if;

  update public.vessel_stylists s
     set nome            = coalesce(nullif(trim(coalesce(p_nome, '')), ''), s.nome),
         whatsapp        = coalesce(v_fone, s.whatsapp),
         cidade          = coalesce(nullif(trim(coalesce(p_cidade, '')), ''), s.cidade),
         instagram       = coalesce(nullif(trim(coalesce(p_instagram, '')), ''), s.instagram),
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
         atualizado_em   = now()
   where s.codigo = v_codigo;

  -- ⚠️ SAIR DE "PAUSADO" DEVOLVE O FUNIL AO FATO: se ela tem encontros, o
  -- estágio certo é o que eles dizem, não o que a pessoa escolheu.
  perform public.vessel_stylist_seguir_os_encontros(
    (select s.id from public.vessel_stylists s where s.codigo = v_codigo));

  return json_build_object('ok', true, 'situacao', 'ok', 'codigo', v_codigo);
end;
$function$;

-- ── 7. O ENCONTRO: capacidade de 7 a 10, e a situação dele ──────────────────

-- ⚠️ `create or replace` COM A MESMA ASSINATURA: só a conferência de vagas
-- muda (decisão 4 do dono). O resto é o texto que está no banco, sem mudança.
create or replace function public.vessel_criar_private_edit(
  p_stylist text, p_quando timestamptz, p_local text default null,
  p_praca text default null, p_loja text default null,
  p_vagas integer default 8, p_teste boolean default false)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_alfabeto text := 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
  v_tam      int  := length(v_alfabeto);          -- 30
  -- O maior múltiplo de 30 que cabe em 256: 240. Byte de 240 para cima é
  -- descartado, e é isso que tira o viés.
  v_teto     int  := 256 - (256 % v_tam);
  v_stylist  bigint;
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

create or replace function public.vessel_private_edit_editar(
  p_codigo text, p_quando timestamptz default null, p_local text default null,
  p_praca text default null, p_loja text default null, p_vagas integer default null,
  p_stylist text default null)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  -- ⚠️ MESMA EXPRESSAO E MESMA ORDEM da irma `vessel_private_edit_encerrar`.
  v_codigo  text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
  v_stylist bigint;
begin
  if not public.is_vessel_atendimentos_editar() then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;

  if not exists (select 1 from public.vessel_private_edits where codigo = v_codigo) then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;

  if p_stylist is not null then
    select id into v_stylist from public.vessel_stylists where codigo = p_stylist;
    if v_stylist is null then
      return json_build_object('ok', false, 'situacao', 'stylist_nao_achei');
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

create or replace function public.vessel_private_edit_situacao(
  p_codigo       text,
  p_status       text,
  p_realizado_em date default null,
  p_motivo       text default null,
  p_observacoes  text default null
)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_codigo text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
  v_status text := lower(nullif(trim(coalesce(p_status, '')), ''));
  v_motivo text := nullif(trim(coalesce(p_motivo, '')), '');
  v_hoje   date := (now() at time zone 'America/Sao_Paulo')::date;
  v_e      public.vessel_private_edits%rowtype;
  v_data   date;
begin
  -- ⚠️ TRAVA DE MEXER: quem confirma a realização é a gerente, e ela mexe.
  if not public.is_vessel_atendimentos_editar() then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;

  select * into v_e from public.vessel_private_edits where codigo = v_codigo;
  if v_e.id is null then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;

  if v_status is null or v_status not in ('em_planejamento', 'agendado', 'confirmado',
       'realizado', 'reagendado', 'cancelado', 'nao_realizado') then
    return json_build_object('ok', false, 'situacao', 'status_invalido');
  end if;

  if v_status in ('cancelado', 'nao_realizado') and v_motivo is null then
    return json_build_object('ok', false, 'situacao', 'sem_motivo');
  end if;

  if v_status = 'realizado' then
    -- Sem data escrita, vale o dia marcado — é o caso comum.
    v_data := coalesce(p_realizado_em, v_e.realizado_em,
                       (v_e.quando at time zone 'America/Sao_Paulo')::date);
    if v_data > v_hoje then
      return json_build_object('ok', false, 'situacao', 'realizado_no_futuro');
    end if;
  end if;

  update public.vessel_private_edits
     set status       = v_status,
         realizado_em = case when v_status = 'realizado' then v_data end,
         motivo       = case when v_status in ('cancelado', 'nao_realizado') then v_motivo end,
         -- `observacoes` nula não mexe; string vazia apaga.
         observacoes  = case when p_observacoes is null then observacoes
                             else nullif(trim(p_observacoes), '') end,
         -- ⚠️ ENCONTRO QUE ACABOU PARA DE ACEITAR RESPOSTA NO CONVITE. O
         -- contrário não: reabrir o convite continua sendo um gesto à parte
         -- (`vessel_private_edit_encerrar`), e voltar para "agendado" não
         -- pode reabrir sozinho um convite que alguém fechou de propósito.
         ativa        = case when v_status in ('realizado', 'cancelado', 'nao_realizado')
                             then false else ativa end
   where id = v_e.id;

  return json_build_object('ok', true, 'situacao', 'ok', 'codigo', v_codigo,
                           'status', v_status, 'antes', v_e.status);
end;
$function$;

-- ── 8. A CONVIDADA ENTRA PELA MÃO DA EQUIPE ─────────────────────────────────

create or replace function public.vessel_convidar_para_encontro(
  p_codigo   text,
  p_nome     text,
  p_whatsapp text,
  p_email    text default null
)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_codigo text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
  v_email  text := lower(nullif(trim(coalesce(p_email, '')), ''));
  v_e      record;
  v_pessoa bigint;
  v_ja     bigint;
  v_id     bigint;
begin
  if not public.is_vessel_atendimentos_editar() then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;

  select e.codigo, e.quando, e.loja, e.status, coalesce(e.arquivada, false) as arquivada,
         s.codigo as stylist
    into v_e
    from public.vessel_private_edits e
    join public.vessel_stylists s on s.id = e.stylist_id
   where e.codigo = v_codigo;
  if not found then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;
  if v_e.arquivada or v_e.status = 'cancelado' then
    return json_build_object('ok', false, 'situacao', 'encontro_fechado');
  end if;

  if nullif(trim(coalesce(p_nome, '')), '') is null then
    return json_build_object('ok', false, 'situacao', 'sem_nome');
  end if;
  -- ⚠️ O MESMO TELEFONE CANÔNICO DE TODA A VESSEL (55 + DDD + número). É ele
  -- que faz a mesma cliente não virar duas, e é por ele que o robô dos pedidos
  -- a reconhece na compra do Bling.
  if public.vessel_telefone_canonico(p_whatsapp) is null then
    return json_build_object('ok', false, 'situacao', 'whatsapp_invalido');
  end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return json_build_object('ok', false, 'situacao', 'email_invalido');
  end if;

  -- ⚠️ A FICHA DE CLIENTE NASCE AQUI, ANTES DE ELA COMPRAR — é o "cadastro
  -- antes de existir no CRM" do documento. Se ela já existe (o mesmo
  -- telefone), é a mesma ficha, e o que faltava é completado.
  v_pessoa := public.vessel_pessoa_por_telefone(p_nome, p_whatsapp, v_email);

  -- ⚠️ UMA CONVIDADA, UMA CADEIRA — a mesma regra do RSVP. Convidar de novo
  -- quem já está no encontro devolve a cadeira dela, sem criar outra.
  select id into v_ja from public.vessel_atendimentos
   where pessoa_id = v_pessoa and evento_codigo = v_e.codigo
   order by id limit 1;
  if v_ja is not null then
    return json_build_object('ok', true, 'situacao', 'ja_estava', 'id', v_ja);
  end if;

  insert into public.vessel_origens
    (pessoa_id, canal, evento_id, stylist_id, utm_source, utm_medium, utm_campaign)
  values (v_pessoa, 'private_edit', v_e.codigo, v_e.stylist,
          'private_edit', 'convite', replace(lower(v_e.codigo), '-', '_'));

  insert into public.vessel_atendimentos
    (pessoa_id, loja, quando, status, origem_registro, evento_codigo, convidada_em, chave_convite)
  values (v_pessoa, v_e.loja, v_e.quando, 'solicitado', 'private-edit-convite',
          v_e.codigo, now(), public.vessel_sortear_chave_de_convidada())
  returning id into v_id;

  return json_build_object('ok', true, 'situacao', 'ok', 'id', v_id, 'pessoa_id', v_pessoa);
end;
$function$;

create or replace function public.vessel_convite_marcar(p_id bigint, p_marca text)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_marca text := lower(nullif(trim(coalesce(p_marca, '')), ''));
begin
  -- ⚠️ A MESMA TRAVA DE `vessel_situacao_do_atendimento`, que é por onde a
  -- presença é marcada: marcar "convite enviado" e marcar "veio" são o mesmo
  -- tipo de gesto, feitos pela mesma pessoa, no mesmo cartão.
  if not public.is_vessel_atendimentos() then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  if v_marca is null or v_marca not in ('enviado', 'sim', 'nao', 'sem_resposta') then
    return json_build_object('ok', false, 'situacao', 'marca_invalida');
  end if;
  -- ⚠️ SÓ CONVIDADA DE ENCONTRO. Uma visita comum não tem convite, e esta
  -- função não pode virar um jeito de reescrever `rsvp` de qualquer linha.
  if not exists (select 1 from public.vessel_atendimentos
                  where id = p_id and evento_codigo is not null) then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;

  update public.vessel_atendimentos
     set convite_enviado_em = case when v_marca = 'enviado'
                                   then coalesce(convite_enviado_em, now())
                                   else convite_enviado_em end,
         rsvp = case v_marca when 'sim' then 'sim' when 'nao' then 'nao'
                             when 'sem_resposta' then null else rsvp end,
         atualizado_em = now()
   where id = p_id;

  return json_build_object('ok', true, 'situacao', 'ok');
end;
$function$;

-- ── 9. AS CONTAS DO ENCONTRO, lendo o miolo novo ────────────────────────────

create or replace function public.vessel_conta_das_private_edits(
  p_dias integer default 14, p_incluir_arquivadas boolean default false)
returns json
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_dias int := greatest(coalesce(p_dias, 14), 0);
  v_incluir boolean := coalesce(p_incluir_arquivadas, false);
  v_saida json;
begin
  if not public.is_vessel_atendimentos() then
    raise exception 'sem permissao' using errcode = '42501';
  end if;

  with vendas as (select * from public.vessel_vendas_dos_encontros(v_dias)),
  convite as (
    select t.evento_codigo, t.status, t.rsvp,
           public.vessel_situacao_do_convite(t.status, t.rsvp, t.convite_enviado_em,
                                             e.quando, e.status) as situacao
      from public.vessel_atendimentos t
      join public.vessel_private_edits e on e.codigo = t.evento_codigo
     where not coalesce(t.teste, false)
  )
  select coalesce(json_agg(linha order by linha ->> 'quando' desc), '[]'::json)
    into v_saida
    from (
      select json_build_object(
        'codigo', e.codigo,
        'chave', e.chave,
        'quando', e.quando,
        'anfitria', s.nome,
        'stylist', s.codigo,
        'local', e.local,
        'praca', e.praca,
        'loja', e.loja,
        'vagas', e.vagas,
        'ativa', coalesce(e.ativa, true),
        'arquivada', coalesce(e.arquivada, false),
        -- T11: a situação do encontro e o que vem com ela.
        'status', e.status,
        'realizado_em', e.realizado_em,
        'motivo', e.motivo,
        'observacoes', e.observacoes,
        'convidadas', (select count(*)::int from convite c where c.evento_codigo = e.codigo),
        -- ⚠️ "RESPONDERAM" DEIXOU DE SER "TODA LINHA". Até a T11 toda convidada
        -- nascia do RSVP, então contar linhas era contar respostas. Agora a
        -- equipe inclui convidadas antes de elas responderem, e contar linha
        -- diria que responderam quem ainda nem recebeu o convite.
        'responderam', (select count(*)::int from convite c where c.evento_codigo = e.codigo
                          and (c.rsvp is not null or c.status <> 'solicitado')),
        'disseram_sim', (select count(*)::int from convite c where c.evento_codigo = e.codigo
                           and c.rsvp = 'sim'),
        -- ⚠️ CONFIRMADAS = quem confirmou, inclusive quem depois veio ou faltou.
        -- Sem quem faltou no denominador, o comparecimento daria perto de 100%
        -- sempre.
        'confirmadas', (select count(*)::int from convite c where c.evento_codigo = e.codigo
                          and c.situacao in ('confirmada', 'presente', 'nao_compareceu')),
        'compareceram', (select count(*)::int from convite c where c.evento_codigo = e.codigo
                           and c.status = 'realizado'),
        'receita', (select coalesce(sum(v.receita), 0) from vendas v where v.evento_codigo = e.codigo),
        'vendas', (select count(*)::int from vendas v where v.evento_codigo = e.codigo),
        'janela_de_venda_em_dias', v_dias
      ) as linha
      from public.vessel_private_edits e
      join public.vessel_stylists s on s.id = e.stylist_id
      where not coalesce(e.teste, false)
        and (v_incluir or not coalesce(e.arquivada, false))
    ) as linhas;

  return v_saida;
end;
$function$;

create or replace function public.vessel_convidadas_do_encontro(p_codigo text, p_dias integer default 14)
returns json
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_codigo   text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
  v_dias     int := greatest(coalesce(p_dias, 14), 0);
  v_e        public.vessel_private_edits%rowtype;
  v_resposta json;
begin
  -- ⚠️ DADO PESSOAL, atrás do portão de ver; lista vazia em vez de erro (ver
  -- `2026-09-19-vessel-convidadas-do-encontro.sql`).
  if not public.is_vessel_atendimentos() then
    return '[]'::json;
  end if;

  select * into v_e from public.vessel_private_edits e where e.codigo = v_codigo;
  if v_e.id is null then
    return '[]'::json;
  end if;

  select coalesce(json_agg(linha order by ordem), '[]'::json)
    into v_resposta
    from (
      select json_build_object(
        -- ⚠️ O GUEST ID DO DOCUMENTO É ESTE: nasce no convite, nunca muda, e
        -- não é o mesmo número da ficha de cliente (`pessoa_id`).
        'id',          t.id,
        'pessoa_id',   t.pessoa_id,
        'nome',        pe.nome,
        'telefone',    pe.telefone,
        'email',       pe.email,
        'rsvp',        t.rsvp,
        'status',      t.status,
        'convidada_em', t.convidada_em,
        'convite_enviado_em', t.convite_enviado_em,
        'chave_convite', t.chave_convite, 'convite_aberto_em', t.convite_aberto_em,
        'convite_aberturas', t.convite_aberturas,
        'respondeu_em', case when t.rsvp is not null then t.criado_em end,
        'presenca_em', t.presenca_em,
        'situacao',    public.vessel_situacao_do_convite(t.status, t.rsvp, t.convite_enviado_em,
                                                         v_e.quando, v_e.status),
        -- ⚠️ "COMPROU" É A MESMA REGRA DA RECEITA DO TOPO, pelo mesmo miolo:
        -- venda atribuída a ESTE encontro. Quem já tinha ido a um encontro
        -- anterior tem a compra lá (decisão 2 do dono), e aqui fica "—".
        'comprou', exists (select 1 from public.vessel_vendas_dos_encontros(v_dias) v
                            where v.evento_codigo = v_e.codigo and v.pessoa_id = t.pessoa_id)
      ) as linha,
      t.id as ordem
      from public.vessel_atendimentos t
      join public.vessel_pessoas pe on pe.id = t.pessoa_id
     where t.evento_codigo = v_codigo
       and not coalesce(t.teste, false)
    ) as linhas;

  return v_resposta;
end;
$function$;

-- ── 10. O RASTREIO DAS STYLISTS, com os campos e as contas da T11 ───────────

create or replace function public.vessel_rastreio_dos_stylists(
  p_dias integer default 7, p_incluir_desativadas boolean default false)
returns json
language plpgsql
stable
security definer
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

-- ── 11. O PLACAR DA T11 ─────────────────────────────────────────────────────

-- ⚠️ NENHUM NÚMERO DAQUI SE DIGITA: tudo sai das três bases e dos pedidos.
-- ⚠️ E NENHUMA TAXA SAI PRONTA. A função devolve o numerador e o denominador
-- de cada uma; quem divide é a tela, pelas mesmas funções de `estatistica.js`
-- que já escrevem "3 de 8" e a faixa quando a base é pequena.
--
-- O PERÍODO: cada número usa a sua data, e ela está escrita ao lado dele —
--   · prospectadas → `prospectado_em`; ativadas → `ativada_em`;
--   · taxa de ativação → DA MESMA TURMA: das prospectadas no período, quantas
--     já ativaram (a qualquer tempo até o fim dele). ⚠️ Dividir "ativadas no
--     período" por "prospectadas no período" misturava turmas: 2 ativadas que
--     vinham de meses antes sobre 1 prospectada imprimia 200%.
--   · show rate → presentes ÷ confirmadas, AS DUAS SÓ DOS ENCONTROS QUE
--     ACONTECERAM (a presença marcada antes de fechar o encontro não conta).
--     ⚠️ Confirmada de encontro cancelado nunca pôde comparecer; contá-la no
--     denominador puxava a taxa para baixo a cada cancelamento.
--   · encontros, convidadas e vendas → o DIA DO ENCONTRO;
--   · recorrentes → o dia do SEGUNDO encontro realizado dela;
--   · taxa de repetição → acumulada até o fim do período (recorrentes ÷
--     ativadas, as duas contadas desde o início), porque ninguém fica
--     recorrente dentro de um mês só.
create or replace function public.vessel_placar_do_stylist_circle(
  p_de date default null, p_ate date default null, p_dias integer default 14)
returns json
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_de   date := coalesce(p_de, date '2000-01-01');
  -- ⚠️ SEM FIM ESCOLHIDO, O FIM É NENHUM — e não "hoje". "Desde o início"
  -- cortado em hoje escondia os encontros já agendados para a semana que vem,
  -- que é justamente o que quem agenda quer ver na conta de agendados.
  v_ate  date := coalesce(p_ate, 'infinity'::date);
  v_dias int  := greatest(coalesce(p_dias, 14), 0);
  v_saida json;
begin
  if not public.is_vessel_atendimentos() then
    raise exception 'sem permissao' using errcode = '42501';
  end if;

  with
  sty as (select * from public.vessel_stylists s where not coalesce(s.teste, false)),
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
  -- Cada encontro realizado, com o número de ordem dele na vida da stylist.
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
    -- O numerador da taxa de ativação: a mesma turma das `prospectadas`.
    'prospectadas_ja_ativadas', (select count(*)::int from sty
                  where prospectado_em between v_de and v_ate
                    and (ativada_em at time zone 'America/Sao_Paulo')::date <= v_ate),
    -- ⚠️ "AGENDADO OU POSTERIOR" INCLUI O QUE FOI CANCELADO DEPOIS: ele chegou a
    -- ter data. Tirar os cancelados do denominador faria a taxa de realização
    -- subir justamente quando a operação cancela.
    'encontros_agendados', (select count(*)::int from ev_p where status <> 'em_planejamento'),
    'encontros_realizados', (select count(*)::int from ev_p where status = 'realizado'),
    'encontros_cancelados', (select count(*)::int from ev_p
                              where status in ('cancelado', 'nao_realizado')),
    'convidadas', (select count(*)::int from conv),
    'confirmadas', (select count(*)::int from conv
                     where situacao in ('confirmada', 'presente', 'nao_compareceu')),
    -- O denominador do show rate: as mesmas confirmadas, só onde o encontro
    -- aconteceu.
    'confirmadas_em_realizados', (select count(*)::int from conv
                     where situacao in ('confirmada', 'presente', 'nao_compareceu')
                       and status_do_encontro = 'realizado'),
    'presentes', (select count(*)::int from conv where status = 'realizado'),
    -- O numerador do show rate: as presentes com o MESMO filtro do denominador.
    -- ⚠️ A equipe marca "Veio" ANTES de fechar o encontro como realizado; contar
    -- em cima a presença de encontro ainda agendado passava de 100%.
    -- `presentes` (sem o filtro) segue sendo a base da conversão e da receita
    -- por convidada.
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
    -- Contatos registrados ANTES do primeiro encontro, entre as ativadas no
    -- período. Razão, não proporção.
    'contatos_ate_ativar', (select round(avg(n)::numeric, 1) from (
        select (select count(*) from public.vessel_stylist_contatos c
                 where c.stylist_id = s.id and c.criado_em < s.ativada_em) as n
          from sty s where (s.ativada_em at time zone 'America/Sao_Paulo')::date between v_de and v_ate) x),
    'stylists_com_contatos_ate_ativar', (select count(*)::int from sty s
        where (s.ativada_em at time zone 'America/Sao_Paulo')::date between v_de and v_ate),
    -- ── integrados com a venda (D0 a D+14) ──
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

-- ── 13. O CRM DA STYLIST: o histórico de contatos ───────────────────────────

-- ⚠️ UMA LINHA POR CONTATO, E NUNCA SE EDITA NEM APAGA: é o registro do que
-- aconteceu. Errou a nota? Registra outro contato corrigindo.
create table if not exists public.vessel_stylist_contatos (
  id              bigserial primary key,
  stylist_id      bigint not null references public.vessel_stylists(id) on delete cascade,
  canal           text not null,
  resultado       text not null,
  nota            text,
  criado_em       timestamptz not null default now(),
  criado_por      uuid,
  criado_por_nome text,
  teste           boolean not null default false,
  constraint vessel_stylist_contatos_canal_valido
    check (canal in ('whatsapp', 'ligacao', 'instagram', 'email', 'presencial')),
  constraint vessel_stylist_contatos_resultado_valido
    check (resultado in ('sem_resposta', 'conversou', 'interesse', 'proposta', 'marcou_encontro', 'recusou')),
  constraint vessel_stylist_contatos_nota_curta check (nota is null or length(nota) <= 500)
);
create index if not exists vessel_stylist_contatos_stylist_idx
  on public.vessel_stylist_contatos (stylist_id, criado_em desc);
alter table public.vessel_stylist_contatos enable row level security;
revoke all on table public.vessel_stylist_contatos from anon, authenticated;

-- ⚠️ A MESMA TABELA DE `sugestaoDeEtapa` (crm-da-stylist-regras.js); o teste
-- de lá lê este corpo.
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
        when array_position(array['prospectado','contatado','interessado','em_negociacao',
                                  'ativado','evento_realizado','recorrente'], a)
           > coalesce(array_position(array['prospectado','contatado','interessado','em_negociacao',
                                  'ativado','evento_realizado','recorrente'], p_estagio), 99)
          then a
      end from alvo)
  end
$$;
revoke all on function public.vessel_stylist_sugestao_de_etapa(text, text, timestamptz) from public, anon;

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

  return json_build_object('ok', true, 'situacao', 'ok', 'id', v_id,
    'sugestao', public.vessel_stylist_sugestao_de_etapa(v_res, v_s.estagio, v_s.ativada_em));
end;
$function$;

create or replace function public.vessel_stylist_contatos(p_codigo text)
returns json
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare v_saida json;
begin
  -- Lista vazia, não erro: é um bloco dentro de uma ficha já aberta.
  if not public.is_vessel_atendimentos() then return '[]'::json; end if;
  select coalesce(json_agg(json_build_object(
           'id', c.id, 'canal', c.canal, 'resultado', c.resultado, 'nota', c.nota,
           'criado_em', c.criado_em, 'criado_por_nome', c.criado_por_nome)
         order by c.criado_em desc, c.id desc), '[]'::json)
    into v_saida
    from public.vessel_stylist_contatos c
    join public.vessel_stylists s on s.id = c.stylist_id
   where s.codigo = upper(nullif(trim(coalesce(p_codigo, '')), ''));
  return v_saida;
end;
$function$;

-- ── 14. O CONVITE DE CADA CONVIDADA: o link só dela e o rastreio ────────────

alter table public.vessel_atendimentos
  add column if not exists chave_convite      text,
  add column if not exists convite_aberto_em  timestamptz,
  add column if not exists convite_aberturas  int not null default 0;
create unique index if not exists vessel_atendimentos_chave_convite_idx
  on public.vessel_atendimentos (chave_convite) where chave_convite is not null;

-- ⚠️ O MESMO SORTEIO DA CHAVE DO ENCONTRO (`vessel_criar_private_edit`): 8
-- letras, sem O/0/I/1, e byte acima de 240 descartado para não viciar.
create or replace function public.vessel_sortear_chave_de_convidada()
returns text
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare
  v_alfabeto text := 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
  v_teto int := 240;
  v_chave text;
  v_byte int;
begin
  loop
    v_chave := '';
    while length(v_chave) < 8 loop
      v_byte := get_byte(extensions.gen_random_bytes(1), 0);
      continue when v_byte >= v_teto;
      v_chave := v_chave || substr(v_alfabeto, 1 + (v_byte % 30), 1);
    end loop;
    exit when not exists (select 1 from public.vessel_atendimentos where chave_convite = v_chave);
  end loop;
  return v_chave;
end;
$$;
revoke all on function public.vessel_sortear_chave_de_convidada() from public, anon, authenticated;

create or replace function public.vessel_chave_da_convidada(p_id bigint)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_t record;
  v_chave text;
begin
  if not public.is_vessel_atendimentos() then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  select t.id, t.chave_convite, e.chave as chave_encontro into v_t
    from public.vessel_atendimentos t
    join public.vessel_private_edits e on e.codigo = t.evento_codigo
   where t.id = p_id;
  if not found then return json_build_object('ok', false, 'situacao', 'nao_achei'); end if;
  v_chave := v_t.chave_convite;
  if v_chave is null then
    v_chave := public.vessel_sortear_chave_de_convidada();
    update public.vessel_atendimentos set chave_convite = v_chave where id = v_t.id and chave_convite is null;
    select chave_convite into v_chave from public.vessel_atendimentos where id = v_t.id;
  end if;
  return json_build_object('ok', true, 'situacao', 'ok', 'chave', v_chave, 'chave_encontro', v_t.chave_encontro);
end;
$function$;

-- ⚠️ A PÁGINA PÚBLICA. Chave de convidada errada ou de outro encontro devolve
-- EXATAMENTE o convite geral — a mesma resposta de uma chave que não existe,
-- para não dar a ninguém um jeito de descobrir chaves válidas.
-- ⚠️ SÓ O PRIMEIRO NOME: o link pode ser repassado.
-- ⚠️ ENCONTRO FECHADO NÃO CUMPRIMENTA NINGUÉM. Arquivado, cancelado, não
-- realizado ou realizado: o link individual devolve EXATAMENTE o "não
-- encontrado" do convite geral (o mesmo `json_build_object` de
-- `vessel_convite_da_private_edit`), sem contar abertura. Antes, um encontro
-- arquivado com `ativa` ainda ligada dizia "Olá, Ana" e a resposta dela
-- quebrava em seguida com `convite_invalido` — a mesma trava de
-- `vessel_rsvp_da_convidada`, que aqui passa a valer ANTES. E a conferência
-- olha só a chave do ENCONTRO: não depende da chave da convidada, para não
-- virar um jeito de testar chaves.
create or replace function public.vessel_convite_da_convidada(p_chave text, p_convidada text)
returns json
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  -- ⚠️ `json`, NÃO `jsonb`, ENQUANTO NADA MUDA: `jsonb` reordena as chaves (não
  -- guarda a ordem de inserção), e quem compara a resposta pelo texto (a
  -- página, ou a prova) veria uma diferença que não existe. Só vira `jsonb`
  -- no ponto em que de fato se mescla, mais abaixo.
  v_geral json;
  v_t record;
begin
  if exists (select 1 from public.vessel_private_edits e
              where e.chave = upper(nullif(trim(coalesce(p_chave, '')), ''))
                and (coalesce(e.arquivada, false)
                     or e.status in ('cancelado', 'nao_realizado', 'realizado'))) then
    return json_build_object('ok', false, 'situacao', 'nao_encontrado');
  end if;
  v_geral := public.vessel_convite_da_private_edit(p_chave);
  if coalesce((v_geral ->> 'ok')::boolean, false) is not true then return v_geral; end if;
  select t.id, t.rsvp, pe.nome into v_t
    from public.vessel_atendimentos t
    join public.vessel_private_edits e on e.codigo = t.evento_codigo
    join public.vessel_pessoas pe on pe.id = t.pessoa_id
   where e.chave = upper(nullif(trim(coalesce(p_chave, '')), ''))
     and t.chave_convite = upper(nullif(trim(coalesce(p_convidada, '')), ''));
  if not found then return v_geral; end if;
  update public.vessel_atendimentos
     set convite_aberto_em = coalesce(convite_aberto_em, now()),
         convite_aberturas = convite_aberturas + 1
   where id = v_t.id;
  return (v_geral::jsonb || jsonb_build_object(
    'primeiro_nome', split_part(trim(v_t.nome), ' ', 1),
    'resposta', v_t.rsvp))::json;
end;
$function$;

create or replace function public.vessel_rsvp_da_convidada(
  p_chave text, p_convidada text, p_resposta text, p_aceite_marketing boolean default false,
  p_aceite_versao text default null, p_armadilha text default null)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_t record;
begin
  if coalesce(trim(p_armadilha), '') <> '' then
    return json_build_object('ok', true, 'situacao', 'recebido');
  end if;
  if p_resposta is null or p_resposta not in ('sim', 'falar-com-equipe') then
    return json_build_object('ok', false, 'situacao', 'resposta_invalida');
  end if;
  select t.id, t.pessoa_id, t.teste into v_t
    from public.vessel_atendimentos t
    join public.vessel_private_edits e on e.codigo = t.evento_codigo
   where e.chave = upper(nullif(trim(coalesce(p_chave, '')), ''))
     and t.chave_convite = upper(nullif(trim(coalesce(p_convidada, '')), ''))
     and e.ativa and not coalesce(e.arquivada, false)
     and e.status not in ('cancelado', 'nao_realizado', 'realizado');
  if not found then return json_build_object('ok', false, 'situacao', 'convite_invalido'); end if;

  update public.vessel_atendimentos set rsvp = p_resposta, atualizado_em = now() where id = v_t.id;

  -- A permissão de atendimento, como no RSVP geral — uma por hora no máximo,
  -- para quem aperta o botão três vezes não virar três aceites.
  -- ⚠️ `momento`, NÃO `criado_em`: `vessel_consentimentos` não tem
  -- `criado_em` (conferido no banco antes de escrever esta linha).
  if not exists (select 1 from public.vessel_consentimentos
                  where pessoa_id = v_t.pessoa_id and finalidade = 'atendimento'
                    and fonte = 'private-edit' and momento > now() - interval '1 hour') then
    insert into public.vessel_consentimentos (pessoa_id, finalidade, canal, versao, fonte, teste)
    values (v_t.pessoa_id, 'atendimento', 'whatsapp', nullif(trim(coalesce(p_aceite_versao, '')), ''),
            'private-edit', v_t.teste);
  end if;
  if coalesce(p_aceite_marketing, false) then
    insert into public.vessel_consentimentos (pessoa_id, finalidade, canal, versao, fonte, teste)
    values (v_t.pessoa_id, 'marketing', 'whatsapp', nullif(trim(coalesce(p_aceite_versao, '')), ''),
            'private-edit', v_t.teste);
  end if;
  return json_build_object('ok', true, 'situacao', 'recebido');
end;
$function$;

create or replace function public.vessel_stylists_para_escolher()
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
  -- T11: `whatsapp` para o "Mandar para a stylist" do cartão da convidada. É o
  -- mesmo dado que o rastreio já devolve, atrás do mesmo portão.
  -- ⚠️ A migration de 19/09 (`2026-09-19-vessel-stylist-mexer.sql`) tinha um
  -- aviso dizendo que esta função "NAO PODE GANHAR UMA QUARTA" chave — a de
  -- lá fica como está (é histórico, não se edita). A T11 GANHA a quarta
  -- chave DE PROPÓSITO, e as duas provas que conferiam a lista fechada de três
  -- chaves foram atualizadas para quatro:
  -- `coletor/aplicar-vessel-private-edit-pela-tela.mjs` e
  -- `coletor/aplicar-vessel-stylist-mexer.mjs` (a asserção e a mensagem).
  select coalesce(json_agg(json_build_object('codigo', s.codigo, 'nome', s.nome,
                                             'cidade', s.cidade, 'whatsapp', s.whatsapp)
                           order by s.codigo), '[]'::json)
    into v_saida
    from public.vessel_stylists s
   where not coalesce(s.teste, false)
     and coalesce(s.ativa, true);
  return v_saida;
end;
$function$;

-- ── 12. AS PORTAS ───────────────────────────────────────────────────────────

-- ⚠️ `revoke ... from public` NÃO FECHA `anon`, e função nova em `public` nasce
-- executável por `public` — ou seja, pela página pública. As duas linhas de
-- cada função são obrigatórias, inclusive nas recriadas por `drop` + `create`.
do $$
declare f text;
begin
  foreach f in array array[
    'public.vessel_stylist_criar(text, text, text, text, text, text, text, text, text, date, text, date)',
    'public.vessel_stylist_editar(text, text, text, text, text, text, text, text, text, text, text, date, text, date, boolean)',
    'public.vessel_criar_private_edit(text, timestamptz, text, text, text, integer, boolean)',
    'public.vessel_private_edit_editar(text, timestamptz, text, text, text, integer, text)',
    'public.vessel_private_edit_situacao(text, text, date, text, text)',
    'public.vessel_convidar_para_encontro(text, text, text, text)',
    'public.vessel_convite_marcar(bigint, text)',
    'public.vessel_conta_das_private_edits(integer, boolean)',
    'public.vessel_convidadas_do_encontro(text, integer)',
    'public.vessel_rastreio_dos_stylists(integer, boolean)',
    'public.vessel_placar_do_stylist_circle(date, date, integer)',
    'public.vessel_stylist_registrar_contato(text, text, text, text, text, date)',
    'public.vessel_stylist_contatos(text)',
    'public.vessel_chave_da_convidada(bigint)',
    'public.vessel_stylists_para_escolher()'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ⚠️ AS DUAS PORTAS PÚBLICAS DO CONVITE INDIVIDUAL: ao contrário das de cima,
-- estas são para a página do convite (sem sessão), não para a Central.
revoke all on function public.vessel_convite_da_convidada(text, text) from public;
revoke all on function public.vessel_rsvp_da_convidada(text, text, text, boolean, text, text) from public;
grant execute on function public.vessel_convite_da_convidada(text, text) to anon, authenticated;
grant execute on function public.vessel_rsvp_da_convidada(text, text, text, boolean, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
