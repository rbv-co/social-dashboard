-- A VESSEL PRIVATE EDIT — "Hosted by [stylist]" (módulo 07)
--
-- Um encontro de 5 a 8 convidadas, com uma stylist anfitriã, seleção preparada,
-- hospitality e atendimento da casa. O checklist do plano manda, em D-10,
-- "convite e link de origem" — é isto.
--
-- ⚠️ ELA É UM ATENDIMENTO COM HORA MARCADA, e por isso a convidada entra em
-- `vessel_atendimentos` com `quando` preenchido: é assim que o encontro ocupa a
-- agenda da loja, aparece na Central no dia certo e entra na conta de
-- comparecimento que o plano cobra ("show rate >= 70%"). Guardar isso numa
-- tabela à parte faria a loja ter duas agendas que não se enxergam.

-- ── 1. o encontro ──────────────────────────────────────────────────────────
create table if not exists public.vessel_private_edits (
  id          bigserial primary key,
  -- O identificador do CRM, do módulo 10: PE-AAAAMMDD-PRACA-SEQ.
  codigo      text not null,
  -- ⚠️ A CHAVE DO LINK É OUTRA COISA, E É SORTEADA. O `codigo` se adivinha
  -- trocando a data e a sequência, e esta página PRECISA dizer o nome da
  -- anfitriã — é o "Hosted by" do convite. As duas juntas entregariam a agenda
  -- de encontros da marca e quais stylists hospedam cada um, que é justamente a
  -- lista que a operação passa semanas montando (SC01).
  -- ⚠️ NÃO É SENHA: quem tem o link entra, e convite repassado funciona. Ela só
  -- impede a VARREDURA.
  chave       text not null,
  stylist_id  bigint not null references public.vessel_stylists(id) on delete restrict,
  quando      timestamptz not null,
  local       text,                      -- "Loja do Iguatemi Campinas"
  praca       text,                      -- CPS | SAO | SBO | BSB
  loja        text,                      -- iguatemi | tivoli | parkshopping
  -- Quantas convidadas o formato prevê. O plano diz 5 a 8; fica no dado para a
  -- conta de ocupação, nunca para barrar alguém na porta da página.
  vagas       int,
  ativa       boolean not null default true,
  criado_em   timestamptz not null default now(),
  teste       boolean not null default false
);

create unique index if not exists vessel_private_edits_codigo_idx
  on public.vessel_private_edits (codigo);
create unique index if not exists vessel_private_edits_chave_idx
  on public.vessel_private_edits (chave);
create index if not exists vessel_private_edits_stylist_idx
  on public.vessel_private_edits (stylist_id, quando desc);

alter table public.vessel_private_edits enable row level security;

comment on table public.vessel_private_edits is
  'Os encontros Private Edit, um por linha. `codigo` e o identificador do CRM '
  '(PE-AAAAMMDD-PRACA-SEQ, modulo 10) e `chave` e o que vai no LINK — sorteada, '
  'porque o codigo se adivinha e a pagina mostra o nome da anfitria. '
  'RLS ligada e SEM politica.';

drop policy if exists vessel_private_edits_le_central on public.vessel_private_edits;
create policy vessel_private_edits_le_central on public.vessel_private_edits
  for select to authenticated using (public.is_vessel_atendimentos());

-- ⚠️ A CONVIDADA FICA LIGADA AO ENCONTRO, e não só à loja. Sem isto, a mesma
-- pessoa respondendo duas vezes viraria duas cadeiras, e "quantas confirmaram
-- para a Private Edit de 15/10" não teria resposta no dado.
alter table public.vessel_atendimentos
  add column if not exists evento_codigo text,
  add column if not exists rsvp          text;

comment on column public.vessel_atendimentos.evento_codigo is
  'O encontro de onde este atendimento veio (PE-... ou BS-...), quando veio de '
  'um. Nulo para visita comum.';
comment on column public.vessel_atendimentos.rsvp is
  'A resposta da convidada no convite: sim | falar-com-equipe. ⚠️ "sim" NAO e '
  'presenca confirmada — a equipe confirma uma a uma (modulo 03).';

create index if not exists vessel_atendimentos_evento_idx
  on public.vessel_atendimentos (evento_codigo) where evento_codigo is not null;

-- ── 2. a data por extenso, em português ────────────────────────────────────
/**
 * ⚠️ A DATA SAI PRONTA DAQUI, EM TEXTO, e a página só imprime.
 *
 * Montar data no navegador é onde `new Date('2026-10-15')` vira 14 de outubro:
 * a data é lida como UTC e o Brasil está três horas atrás. Num convite, um dia
 * de diferença é a convidada chegando no dia errado — e ninguém descobre até
 * ela aparecer na loja fechada.
 *
 * E o mês vem de uma lista escrita aqui porque o servidor não tem garantia de
 * locale em português; confiar no `to_char` com locale devolveria "October".
 */
create or replace function public.vessel_data_por_extenso(p_quando timestamptz)
returns text
language sql
immutable
as $function$
  select extract(day from p_quando at time zone 'America/Sao_Paulo')::int || ' de '
    || (array['janeiro','fevereiro','março','abril','maio','junho','julho',
              'agosto','setembro','outubro','novembro','dezembro'])
       [extract(month from p_quando at time zone 'America/Sao_Paulo')::int];
$function$;

-- ── 3. a porta do convite: o que a página mostra ───────────────────────────
/**
 * ⚠️ O QUE ESTA PORTA NÃO DEVOLVE É O PONTO: nenhuma convidada, nenhum
 * telefone, nenhuma contagem de quem confirmou. O plano proíbe com todas as
 * letras — "sem lista pública de convidadas". Ela devolve o que está impresso
 * no convite e nada além: anfitriã, data, hora e lugar.
 *
 * ⚠️ E NÃO DEVOLVE O `codigo` DO CRM: ele é o que se adivinha, e mandá-lo para
 * o navegador desfaria a chave sorteada.
 */
create or replace function public.vessel_convite_da_private_edit(p_chave text)
returns json
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_ip       text := public.vessel_hash_de_origem();
  v_recentes int;
  v_linha    record;
begin
  -- Teto por IP contra varredura de chaves. Alto o bastante para uma convidada
  -- recarregar a página à vontade.
  select count(*) into v_recentes from public.vessel_atendimentos
   where ip_hash = v_ip and criado_em > now() - interval '1 hour';
  if v_recentes >= 60 then
    return json_build_object('ok', false, 'situacao', 'nao_encontrado');
  end if;

  select e.quando, e.local, e.praca, s.nome as anfitria
    into v_linha
    from public.vessel_private_edits e
    join public.vessel_stylists s on s.id = e.stylist_id
   where e.chave = upper(nullif(trim(coalesce(p_chave, '')), '')) and e.ativa;

  if not found then
    return json_build_object('ok', false, 'situacao', 'nao_encontrado');
  end if;

  return json_build_object(
    'ok', true,
    'anfitria', v_linha.anfitria,
    'data_por_extenso', public.vessel_data_por_extenso(v_linha.quando),
    'horario', trim(trailing ':00' from
                 to_char(v_linha.quando at time zone 'America/Sao_Paulo', 'HH24:MI')) || 'h',
    'local', v_linha.local,
    -- ⚠️ Encontro que já passou não vira erro: a convidada que abre o convite
    -- uma semana depois merece saber que o dia passou, não um "não encontrado"
    -- que parece link quebrado.
    'ja_passou', v_linha.quando < now());
end;
$function$;

revoke all on function public.vessel_convite_da_private_edit(text)
  from public, anon, authenticated;
grant execute on function public.vessel_convite_da_private_edit(text) to anon;

-- ── 4. a porta do RSVP ─────────────────────────────────────────────────────
/**
 * ⚠️ NUNCA CONFIRMA SOZINHA. O módulo 03 permite confirmação automática só
 * "quando a vaga tiver sido bloqueada" por um inventário transacional de
 * verdade — que não existe aqui. Então entra como `solicitado`, e a tela diz
 * "confirmaremos sua participação individualmente". Confirmar sem vaga
 * bloqueada é prometer cadeira que pode não haver, na frente da cliente da
 * stylist.
 */
create or replace function public.vessel_rsvp_da_private_edit(
  p_chave            text,
  p_nome             text,
  p_whatsapp         text,
  p_resposta         text,
  p_aceite_marketing boolean default false,
  p_aceite_versao    text default null,
  p_armadilha        text default null,
  p_teste            boolean default false
) returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ip       text := public.vessel_hash_de_origem();
  v_recentes int;
  v_e        record;
  v_pessoa   bigint;
  v_ja       bigint;
begin
  -- A armadilha continua muda: robô que soubesse que caiu nela tentaria de
  -- outro jeito.
  if coalesce(trim(p_armadilha), '') <> '' then
    return json_build_object('ok', true, 'situacao', 'recebido');
  end if;

  if coalesce(trim(p_nome), '') = ''
     or public.vessel_telefone_canonico(p_whatsapp) is null then
    return json_build_object('ok', false, 'situacao', 'invalido',
      'erro', 'Confira seu nome e o WhatsApp com DDD.');
  end if;
  if p_resposta is null or p_resposta not in ('sim', 'falar-com-equipe') then
    return json_build_object('ok', false, 'situacao', 'resposta_invalida');
  end if;

  select count(*) into v_recentes from public.vessel_atendimentos
   where ip_hash = v_ip and criado_em > now() - interval '1 hour';
  if v_recentes >= 20 then
    return json_build_object('ok', true, 'situacao', 'recebido');
  end if;

  select e.codigo, e.quando, e.loja, s.codigo as stylist
    into v_e
    from public.vessel_private_edits e
    join public.vessel_stylists s on s.id = e.stylist_id
   where e.chave = upper(nullif(trim(coalesce(p_chave, '')), '')) and e.ativa;
  if not found then
    return json_build_object('ok', false, 'situacao', 'convite_invalido');
  end if;

  v_pessoa := public.vessel_pessoa_por_telefone(p_nome, p_whatsapp);
  update public.vessel_pessoas set teste = p_teste where id = v_pessoa;

  -- ⚠️ A ORIGEM SÓ ACRESCENTA (first touch, módulo 10), e o canal e as UTMs são
  -- cravados aqui: quem chegou por este convite veio pela anfitriã, e isso não
  -- se aceita do navegador.
  insert into public.vessel_origens
    (pessoa_id, canal, evento_id, stylist_id, utm_source, utm_medium, utm_campaign)
  values (v_pessoa, 'private_edit', v_e.codigo, v_e.stylist,
          'private_edit', 'convite', replace(lower(v_e.codigo), '-', '_'));

  -- ⚠️ UMA CONVIDADA, UMA CADEIRA. Responder de novo CORRIGE a resposta; não
  -- cria uma segunda presença no mesmo encontro.
  select id into v_ja from public.vessel_atendimentos
   where pessoa_id = v_pessoa and evento_codigo = v_e.codigo
   order by id desc limit 1;

  if v_ja is not null then
    update public.vessel_atendimentos
       set rsvp = p_resposta, atualizado_em = now()
     where id = v_ja;
  else
    insert into public.vessel_atendimentos
      (pessoa_id, loja, quando, status, origem_registro, ip_hash, teste,
       evento_codigo, rsvp)
    values (v_pessoa, v_e.loja, v_e.quando, 'solicitado', 'private-edit', v_ip, p_teste,
            v_e.codigo, p_resposta);
  end if;

  -- A permissão de atendimento é sempre gravada; a de marketing, só se marcou.
  insert into public.vessel_consentimentos (pessoa_id, finalidade, canal, versao, fonte, teste)
  values (v_pessoa, 'atendimento', 'whatsapp',
          nullif(trim(coalesce(p_aceite_versao, '')), ''), 'private-edit', p_teste);
  if coalesce(p_aceite_marketing, false) then
    insert into public.vessel_consentimentos (pessoa_id, finalidade, canal, versao, fonte, teste)
    values (v_pessoa, 'marketing', 'whatsapp',
            nullif(trim(coalesce(p_aceite_versao, '')), ''), 'private-edit', p_teste);
  end if;

  return json_build_object('ok', true, 'situacao', 'recebido');
end;
$function$;

revoke all on function public.vessel_rsvp_da_private_edit(
  text, text, text, text, boolean, text, text, boolean) from public, anon, authenticated;
grant execute on function public.vessel_rsvp_da_private_edit(
  text, text, text, text, boolean, text, text, boolean) to anon;

-- ── 5. a conta por encontro ────────────────────────────────────────────────
/**
 * "Receita por Private Edit e repetição do stylist" — o KPI principal do canal,
 * segundo o módulo 07. Mesma régua de janela de venda da Central.
 */
create or replace function public.vessel_conta_das_private_edits(p_dias int default 14)
returns json
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_dias int := greatest(coalesce(p_dias, 14), 0);
  v_saida json;
begin
  -- ⚠️ A PERMISSÃO É CONFERIDA AQUI DENTRO: `security definer` roda como dono, e
  -- `authenticated` é todo mundo que fez login no sistema.
  if not public.is_vessel_atendimentos() then
    raise exception 'sem permissao' using errcode = '42501';
  end if;

  select coalesce(json_agg(linha order by linha ->> 'quando' desc), '[]'::json)
    into v_saida
    from (
      select json_build_object(
        'codigo', e.codigo,
        'quando', e.quando,
        'anfitria', s.nome,
        'stylist', s.codigo,
        'local', e.local,
        'vagas', e.vagas,
        'responderam', (select count(*)::int from public.vessel_atendimentos t
                         where t.evento_codigo = e.codigo and not coalesce(t.teste, false)),
        'disseram_sim', (select count(*)::int from public.vessel_atendimentos t
                          where t.evento_codigo = e.codigo and not coalesce(t.teste, false)
                            and t.rsvp = 'sim'),
        'confirmadas', (select count(*)::int from public.vessel_atendimentos t
                         where t.evento_codigo = e.codigo and not coalesce(t.teste, false)
                           and t.status in ('confirmado', 'realizado', 'no_show')),
        'compareceram', (select count(*)::int from public.vessel_atendimentos t
                          where t.evento_codigo = e.codigo and not coalesce(t.teste, false)
                            and t.status = 'realizado'),
        -- ⚠️ Cada pedido conta uma vez só, e a janela viaja na resposta: não
        -- existe no dado nenhum campo dizendo "esta compra veio daquele
        -- encontro" — o que existe é a mesma cliente comprando perto dele.
        'receita', (select coalesce(sum(coalesce(p.receita_liquida, p.total_corrigido, 0)), 0)
                      from public.vessel_pedidos p
                     where exists (select 1 from public.vessel_atendimentos t
                                    where t.evento_codigo = e.codigo
                                      and t.pessoa_id = p.pessoa_id
                                      and not coalesce(t.teste, false)
                                      and t.status = 'realizado')
                       and p.data_do_pedido
                             between (e.quando at time zone 'America/Sao_Paulo')::date
                                 and (e.quando at time zone 'America/Sao_Paulo')::date + v_dias),
        'janela_de_venda_em_dias', v_dias
      ) as linha
      from public.vessel_private_edits e
      join public.vessel_stylists s on s.id = e.stylist_id
      where not coalesce(e.teste, false)
    ) as linhas;

  return v_saida;
end;
$function$;

revoke all on function public.vessel_conta_das_private_edits(int)
  from public, anon, authenticated;
grant execute on function public.vessel_conta_das_private_edits(int) to authenticated;

-- ── 6. criar um encontro (uso interno) ─────────────────────────────────────
/**
 * ⚠️ FECHADA PARA A PÁGINA PÚBLICA. Quem cria encontro é a operação, por
 * ferramenta interna. A chave é sorteada aqui, com o mesmo alfabeto do
 * Appointment Card — sem O, sem 0, sem I, sem 1.
 */
create or replace function public.vessel_criar_private_edit(
  p_stylist  text,                        -- STY-0001
  p_quando   timestamptz,
  p_local    text default null,
  p_praca    text default null,
  p_loja     text default null,
  p_vagas    int default 8,
  p_teste    boolean default false
) returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_alfabeto text := 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
  v_stylist  bigint;
  v_praca    text := upper(nullif(trim(coalesce(p_praca, '')), ''));
  v_codigo   text;
  v_chave    text;
  v_seq      int;
  i          int;
begin
  select id into v_stylist from public.vessel_stylists
   where codigo = upper(nullif(trim(coalesce(p_stylist, '')), ''));
  if v_stylist is null then
    return json_build_object('ok', false, 'situacao', 'stylist_nao_encontrada');
  end if;
  if p_quando is null then
    return json_build_object('ok', false, 'situacao', 'sem_data');
  end if;
  if v_praca is null or v_praca not in ('CPS', 'SAO', 'SBO', 'BSB') then
    return json_build_object('ok', false, 'situacao', 'praca_invalida');
  end if;
  if p_loja is not null and p_loja not in ('iguatemi', 'tivoli', 'parkshopping') then
    return json_build_object('ok', false, 'situacao', 'loja_invalida');
  end if;

  -- A sequência é POR DIA E POR PRAÇA, como manda o formato do módulo 10.
  select count(*) + 1 into v_seq from public.vessel_private_edits
   where praca = v_praca
     and (quando at time zone 'America/Sao_Paulo')::date
         = (p_quando at time zone 'America/Sao_Paulo')::date;
  v_codigo := 'PE-'
    || to_char(p_quando at time zone 'America/Sao_Paulo', 'YYYYMMDD')
    || '-' || v_praca || '-' || lpad(v_seq::text, 2, '0');

  loop
    v_chave := '';
    for i in 1..8 loop
      v_chave := v_chave || substr(v_alfabeto, 1 + floor(random() * length(v_alfabeto))::int, 1);
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

revoke all on function public.vessel_criar_private_edit(
  text, timestamptz, text, text, text, int, boolean) from public, anon, authenticated;
