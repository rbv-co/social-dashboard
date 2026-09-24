-- A AGENDA DO PRIVATE EDIT, E O AVISO DE ENCONTRO SOBREPOSTO.
--
-- Pedido do dono (24/09/2026): "na ferramenta Private Edit, seria legal ter uma
-- visão de agenda/calendário, para bater agenda, cruzar edits, e ver se não tem
-- nenhum sobrepondo (apesar de saber que deve ter um aviso caso marcar edit em
-- mesma data e horário)". Até aqui NÃO havia aviso nenhum: dois encontros na
-- mesma loja, na mesma hora, eram gravados calados.
--
-- ── AS DECISÕES DO DONO ─────────────────────────────────────────────────────
--   · UM PRIVATE EDIT DURA 4 HORAS a partir do `quando`. A tabela guarda só o
--     início; a duração é uma constante, escrita num lugar só daqui
--     (`vessel_private_edit_duracao()`) e num lugar só da tela
--     (`DURACAO_DO_PRIVATE_EDIT_EM_HORAS`, em `agenda-regras.js` — um teste
--     confere que os dois dizem o mesmo número). Não é coluna nova.
--   · SOBREPOSTO = MESMO LUGAR e intervalos [quando, quando + 4h) que se
--     cruzam. Um que TERMINA exatamente quando o outro começa NÃO sobrepõe.
--     Lojas diferentes nunca se cruzam.
--   · O LUGAR (`vessel_lugar_do_encontro`): a LOJA, quando o encontro tem uma;
--     sem loja, a PRAÇA + o LUGAR escrito (sem diferença de maiúscula nem de
--     espaço). ⚠️ No banco de hoje a tela de criar NEM TINHA o campo loja, então
--     os encontros novos nasciam sem ela — daí a reserva. Um encontro com loja
--     e outro sem, na mesma praça, são lugares DIFERENTES (não dá para saber).
--   · NÃO CONTAM: cancelado, não realizado, arquivado e os de teste.
--   · AVISA E DEIXA CONFIRMAR (não trava). As Beauty Sessions e os Private
--     Appointments da mesma loja na mesma janela aparecem só como NOTA, nunca
--     como conflito.
--
-- ── O QUE MUDA NAS PORTAS DE GRAVAR ─────────────────────────────────────────
-- `vessel_criar_private_edit` e `vessel_private_edit_editar` ganham, no FIM,
-- `p_confirmar_sobreposicao boolean DEFAULT NULL`:
--   · NULL (o padrão — é o que a Central que está no ar manda, porque não
--     conhece o parâmetro): COMPORTAMENTO DE ANTES, sem conferência nenhuma.
--     ⚠️ Foi escolhido NULL, e não FALSE, de propósito: com FALSE como padrão a
--     Central de hoje passaria a ter encontros RECUSADOS com uma `situacao`
--     que ela não sabe mostrar ("não consegui criar"), antes da tela nova
--     chegar. Quem quer a conferência, pede.
--   · FALSE: confere; se houver sobreposição, NÃO grava e devolve
--     `{ ok:false, situacao:'sobrepoe', sobrepoe:[...], contexto:[...] }`.
--   · TRUE: grava mesmo assim (a pessoa já viu o aviso e confirmou), e a
--     resposta leva `sobrepoe` com a lista, para constar.
--   Na edição a conferência só acontece quando o DIA/HORA, a LOJA, a PRAÇA ou o
--   LUGAR mudam: mexer só nas vagas de um encontro que já se sobrepõe não pede
--   confirmação de novo. E o encontro editado nunca conflita consigo mesmo.
-- ⚠️ ACRESCENTAR UM PARÂMETRO CRIA UMA SEGUNDA FUNÇÃO com o mesmo nome (o
-- Postgres não troca a assinatura no lugar), e o PostgREST ficaria com duas
-- candidatas para o mesmo pedido. Por isso a antiga é APAGADA e a nova nasce no
-- lugar, na mesma transação — o pedido de 7 parâmetros da Central de hoje cai
-- na nova (o 8º tem padrão).
-- ⚠️ O CORPO DE PARTIDA É O DO BANCO (conferido no aplicador por impressão do
-- `prosrc`): `vessel_criar_private_edit` de `2026-09-24-vessel-codigo-do-
-- encontro-sem-repetir.sql` e `vessel_private_edit_editar` de `2026-09-24-
-- vessel-private-edit-so-com-stylist-liberada.sql`. Nada do que elas conferiam
-- saiu; a conferência nova entra DEPOIS de todas as outras.
--
-- ── AS LEITURAS NOVAS ───────────────────────────────────────────────────────
--   · `vessel_agenda_das_lojas(p_de date, p_ate date, p_loja text)`: os três
--     tipos de compromisso do período, cada um com `tipo` ('private_edit',
--     'beauty_session', 'private_appointment') e TODOS COM AS MESMAS CHAVES
--     (nulas quando não se aplicam). O DIA e a HORA vêm prontos, no fuso de
--     São Paulo (`dia` 'AAAA-MM-DD', `hora` 'HH:MM') — a tela agrupa por `dia`
--     e nunca recalcula o dia pelo relógio do navegador. `inicio`/`fim` vêm em
--     ISO com fuso. Cada Private Edit traz `sobrepoe`: os CÓDIGOS dos encontros
--     que ele cruza (conferidos contra TODOS, não só os do período — um das
--     22h do último dia cruza um da 0h30 do dia seguinte).
--   · `vessel_private_edit_sobreposicoes(p_quando, p_loja, p_ignorar_codigo,
--     p_praca, p_local)`: o que a tela pergunta ANTES de gravar, para abrir o
--     aviso. ⚠️ O encontro a ignorar vai pelo CÓDIGO, e não pelo id: é o código
--     que a lista da tela conhece (`vessel_conta_das_private_edits` não devolve
--     id).
--   · As duas conferem `is_vessel_atendimentos()` — a MESMA trava das outras
--     leituras do Private Edit (`vessel_conta_das_private_edits`). ⚠️ É a trava
--     da FAMÍLIA, não a chave `atendimentos.private-edit` da tela: é o B13 de
--     `docs/pendencias.md`, que muda todas as funções juntas numa rodada só.
--   · Privacidade: o Private Appointment aparece com hora, loja, situação e a
--     Client Advisor — sem o nome nem o telefone da cliente. Quem abre o
--     Private Edit não precisa saber quem é a cliente da visita ao lado.

-- ── 1. a duração (o único lugar do banco) ──────────────────────────────────
create or replace function public.vessel_private_edit_duracao()
returns interval
language sql
immutable
set search_path to 'public'
as $function$
  select interval '4 hours'
$function$;

-- ── 2. o lugar do encontro ─────────────────────────────────────────────────
create or replace function public.vessel_lugar_do_encontro(p_loja text, p_praca text, p_local text)
returns text
language sql
immutable
set search_path to 'public'
as $function$
  select coalesce(
    nullif(lower(trim(coalesce(p_loja, ''))), ''),
    'praca:' || upper(trim(coalesce(p_praca, ''))) || '|'
             || lower(regexp_replace(trim(coalesce(p_local, '')), '\s+', ' ', 'g')))
$function$;

-- ── 3. quem se cruza com um intervalo (o miolo; nenhuma porta pública) ─────
create or replace function public.vessel_encontros_que_sobrepoem(
  p_quando timestamptz, p_lugar text, p_ignorar_codigo text)
returns json
language sql
stable
set search_path to 'public'
as $function$
  select coalesce(json_agg(json_build_object(
           'codigo', e.codigo,
           'stylist', s.codigo,
           'anfitria', s.nome,
           'inicio', e.quando,
           'fim', e.quando + public.vessel_private_edit_duracao(),
           'dia', to_char(e.quando at time zone 'America/Sao_Paulo', 'YYYY-MM-DD'),
           'hora', to_char(e.quando at time zone 'America/Sao_Paulo', 'HH24:MI'),
           'hora_fim', to_char((e.quando + public.vessel_private_edit_duracao()) at time zone 'America/Sao_Paulo', 'HH24:MI'),
           'loja', e.loja, 'praca', e.praca, 'local', e.local, 'status', e.status)
         order by e.quando, e.codigo), '[]'::json)
    from public.vessel_private_edits e
    left join public.vessel_stylists s on s.id = e.stylist_id
   where p_quando is not null
     and not coalesce(e.teste, false)
     and not coalesce(e.arquivada, false)
     and coalesce(e.status, 'agendado') not in ('cancelado', 'nao_realizado')
     and e.codigo is distinct from upper(nullif(trim(coalesce(p_ignorar_codigo, '')), ''))
     and public.vessel_lugar_do_encontro(e.loja, e.praca, e.local) = p_lugar
     -- [a, a+4h) cruza [b, b+4h) ⇔ a < b+4h e b < a+4h (o "encosta" não cruza)
     and e.quando < p_quando + public.vessel_private_edit_duracao()
     and p_quando < e.quando + public.vessel_private_edit_duracao()
$function$;

-- ── 4. o que mais ocupa a loja na janela (só nota, nunca conflito) ─────────
-- Beauty Session: o mesmo DIA (ela não tem hora) e a mesma loja. Private
-- Appointment: começa dentro da janela do encontro, na mesma loja. Sem loja no
-- encontro, não há como dizer — a lista vem vazia.
create or replace function public.vessel_contexto_da_loja(p_quando timestamptz, p_loja text)
returns json
language sql
stable
set search_path to 'public'
as $function$
  select coalesce(json_agg(x order by x ->> 'dia', x ->> 'hora' nulls first, x ->> 'tipo'), '[]'::json)
    from (
      select json_build_object('tipo', 'beauty_session', 'codigo', b.codigo,
               'dia', to_char(b.quando, 'YYYY-MM-DD'), 'hora', null, 'loja', b.loja, 'praca', b.praca,
               'parceiro', b.parceiro, 'client_advisor', null, 'status', null) as x
        from public.vessel_beauty_sessions b
       where p_quando is not null and p_loja is not null
         and not coalesce(b.arquivada, false)
         and b.loja = lower(trim(p_loja))
         and b.quando = (p_quando at time zone 'America/Sao_Paulo')::date
      union all
      select json_build_object('tipo', 'private_appointment', 'codigo', null,
               'dia', to_char(t.quando at time zone 'America/Sao_Paulo', 'YYYY-MM-DD'),
               'hora', to_char(t.quando at time zone 'America/Sao_Paulo', 'HH24:MI'),
               'loja', t.loja, 'praca', null, 'parceiro', null, 'client_advisor', t.client_advisor,
               'status', t.status)
        from public.vessel_atendimentos t
       where p_quando is not null and p_loja is not null
         and t.quando is not null
         and not coalesce(t.teste, false)
         and coalesce(t.evento_codigo, '') not like 'PE-%'   -- a convidada do encontro É o encontro
         and t.status not in ('cancelado', 'remarcado')
         and t.loja = lower(trim(p_loja))
         and t.quando >= p_quando
         and t.quando < p_quando + public.vessel_private_edit_duracao()
    ) as c
$function$;

revoke all on function public.vessel_private_edit_duracao() from public, anon, authenticated;
revoke all on function public.vessel_lugar_do_encontro(text, text, text) from public, anon, authenticated;
revoke all on function public.vessel_encontros_que_sobrepoem(timestamptz, text, text) from public, anon, authenticated;
revoke all on function public.vessel_contexto_da_loja(timestamptz, text) from public, anon, authenticated;

-- ── 5. a pergunta da tela antes de gravar ──────────────────────────────────
create or replace function public.vessel_private_edit_sobreposicoes(
  p_quando timestamptz, p_loja text, p_ignorar_codigo text default null,
  p_praca text default null, p_local text default null)
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
  return json_build_object(
    'ok', true,
    'duracao_em_horas', extract(epoch from public.vessel_private_edit_duracao())::int / 3600,
    'sobrepoe', public.vessel_encontros_que_sobrepoem(
                  p_quando, public.vessel_lugar_do_encontro(p_loja, p_praca, p_local), p_ignorar_codigo),
    'contexto', public.vessel_contexto_da_loja(p_quando, nullif(trim(coalesce(p_loja, '')), '')));
end;
$function$;

-- ── 6. a agenda das lojas ──────────────────────────────────────────────────
create or replace function public.vessel_agenda_das_lojas(p_de date, p_ate date, p_loja text default null)
returns json
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_de   date := coalesce(p_de, (now() at time zone 'America/Sao_Paulo')::date);
  v_ate  date := coalesce(p_ate, coalesce(p_de, (now() at time zone 'America/Sao_Paulo')::date) + 41);
  v_loja text := nullif(lower(trim(coalesce(p_loja, ''))), '');
  v_dur  interval := public.vessel_private_edit_duracao();
  v_saida json;
begin
  if not public.is_vessel_atendimentos() then
    raise exception 'sem permissao' using errcode = '42501';
  end if;
  if v_ate < v_de then
    raise exception 'o fim vem antes do começo' using errcode = '22023';
  end if;
  -- Uma tela mostra no máximo um mês e as bordas; seis meses é folga de sobra
  -- e impede que um pedido de "todos os anos" segure o banco.
  if v_ate - v_de > 190 then
    raise exception 'periodo longo demais (maximo 190 dias)' using errcode = '22023';
  end if;

  select coalesce(json_agg(x order by x ->> 'dia', x ->> 'hora' nulls first, x ->> 'tipo', x ->> 'codigo'), '[]'::json)
    into v_saida
    from (
      -- Private Edit (o que a tela destaca)
      select json_build_object(
               'tipo', 'private_edit', 'id', e.id, 'codigo', e.codigo,
               'dia', to_char(e.quando at time zone 'America/Sao_Paulo', 'YYYY-MM-DD'),
               'hora', to_char(e.quando at time zone 'America/Sao_Paulo', 'HH24:MI'),
               'hora_fim', to_char((e.quando + v_dur) at time zone 'America/Sao_Paulo', 'HH24:MI'),
               'inicio', e.quando, 'fim', e.quando + v_dur,
               'loja', e.loja, 'praca', e.praca, 'local', e.local,
               'lugar', public.vessel_lugar_do_encontro(e.loja, e.praca, e.local),
               'stylist', s.codigo, 'anfitria', s.nome, 'parceiro', null, 'client_advisor', null,
               'status', e.status,
               'sobrepoe', (select coalesce(json_agg(o ->> 'codigo'), '[]'::json)
                              from json_array_elements(public.vessel_encontros_que_sobrepoem(
                                     e.quando, public.vessel_lugar_do_encontro(e.loja, e.praca, e.local), e.codigo)) o)
             ) as x
        from public.vessel_private_edits e
        left join public.vessel_stylists s on s.id = e.stylist_id
       where not coalesce(e.teste, false)
         and not coalesce(e.arquivada, false)
         and coalesce(e.status, 'agendado') not in ('cancelado', 'nao_realizado')
         and (e.quando at time zone 'America/Sao_Paulo')::date between v_de and v_ate
         and (v_loja is null or e.loja = v_loja)
      union all
      -- Beauty Session (o dia inteiro; acontece no salão parceiro, a loja é a
      -- que recebe o interesse)
      select json_build_object(
               'tipo', 'beauty_session', 'id', null, 'codigo', b.codigo,
               'dia', to_char(b.quando, 'YYYY-MM-DD'), 'hora', null, 'hora_fim', null,
               'inicio', null, 'fim', null,
               'loja', b.loja, 'praca', b.praca, 'local', null, 'lugar', b.loja,
               'stylist', null, 'anfitria', null, 'parceiro', b.parceiro, 'client_advisor', null,
               'status', case when coalesce(b.ativa, true) then 'aberta' else 'encerrada' end,
               'sobrepoe', null)
        from public.vessel_beauty_sessions b
       where not coalesce(b.arquivada, false)
         and b.quando between v_de and v_ate
         and (v_loja is null or b.loja = v_loja)
      union all
      -- Private Appointment (a visita marcada; sem o nome da cliente)
      select json_build_object(
               'tipo', 'private_appointment', 'id', t.id, 'codigo', null,
               'dia', to_char(t.quando at time zone 'America/Sao_Paulo', 'YYYY-MM-DD'),
               'hora', to_char(t.quando at time zone 'America/Sao_Paulo', 'HH24:MI'), 'hora_fim', null,
               'inicio', t.quando, 'fim', null,
               'loja', t.loja, 'praca', null, 'local', null, 'lugar', t.loja,
               'stylist', null, 'anfitria', null, 'parceiro', null, 'client_advisor', t.client_advisor,
               'status', t.status, 'sobrepoe', null)
        from public.vessel_atendimentos t
       where t.quando is not null
         and not coalesce(t.teste, false)
         and coalesce(t.evento_codigo, '') not like 'PE-%'
         and t.status not in ('cancelado', 'remarcado')
         and (t.quando at time zone 'America/Sao_Paulo')::date between v_de and v_ate
         and (v_loja is null or t.loja = v_loja)
    ) as itens;

  return v_saida;
end;
$function$;

-- ── 7. criar: o corpo de hoje + a conferência (só quando pedida) ───────────
drop function if exists public.vessel_criar_private_edit(text, timestamptz, text, text, text, integer, boolean);
create function public.vessel_criar_private_edit(
  p_stylist text, p_quando timestamp with time zone, p_local text DEFAULT NULL::text,
  p_praca text DEFAULT NULL::text, p_loja text DEFAULT NULL::text, p_vagas integer DEFAULT 8,
  p_teste boolean DEFAULT false, p_confirmar_sobreposicao boolean DEFAULT NULL::boolean)
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
  v_prefixo  text;
  v_volta    int;
  v_indice   text;
  v_sobrepoe json;
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

  -- ⚠️ 24/09/2026 (o código sem repetir): o número do dia NÃO é mais só
  -- "quantos há + 1". Um encontro que mudou de dia deixava o número dele livre
  -- no dia de origem, e o próximo criado lá repetia o código (erro de chave
  -- duplicada). Agora: a FILA (trava por dia e praça, até o fim da transação —
  -- duas criações ao mesmo tempo esperam uma pela outra) e, a partir do número
  -- de sempre, o PRÓXIMO LIVRE — livre em todo lugar onde um código de encontro
  -- aparece (`vessel_codigo_de_evento_usado`), inclusive de encontro apagado
  -- que deixou rastro. O cinto: `unique_violation` na inserção avança e tenta
  -- de novo. Códigos que já existem não mudam.
  v_prefixo := 'PE-' || to_char(p_quando at time zone 'America/Sao_Paulo', 'YYYYMMDD') || '-' || v_praca || '-';
  perform pg_advisory_xact_lock(hashtext('vessel.codigo_do_encontro:' || v_prefixo)::bigint);

  -- ⚠️ 25/09/2026: O ENCONTRO SOBREPOSTO. Depois da fila (duas criações no
  -- mesmo dia e praça já esperam uma pela outra, e a segunda enxerga a
  -- primeira), e só quando a tela PEDE (`p_confirmar_sobreposicao` não nulo).
  -- NULL = a Central de antes: nada muda para ela.
  if p_confirmar_sobreposicao is not null then
    v_sobrepoe := public.vessel_encontros_que_sobrepoem(
                    p_quando, public.vessel_lugar_do_encontro(p_loja, v_praca, p_local), null);
    if not p_confirmar_sobreposicao and json_array_length(v_sobrepoe) > 0 then
      return json_build_object('ok', false, 'situacao', 'sobrepoe',
        'sobrepoe', v_sobrepoe, 'contexto', public.vessel_contexto_da_loja(p_quando, p_loja),
        'erro', 'Já há Private Edit neste lugar neste horário. Confira e confirme para marcar mesmo assim.');
    end if;
  end if;

  select count(*) + 1 into v_seq from public.vessel_private_edits
   where praca = v_praca
     and (quando at time zone 'America/Sao_Paulo')::date
         = (p_quando at time zone 'America/Sao_Paulo')::date;

  for v_volta in 1..5 loop
    loop
      v_codigo := v_prefixo || lpad(v_seq::text, 2, '0');
      exit when not public.vessel_codigo_de_evento_usado(v_codigo);
      v_seq := v_seq + 1;
    end loop;

    loop
      v_chave := '';
      while length(v_chave) < 8 loop
        v_byte := get_byte(extensions.gen_random_bytes(1), 0);
        continue when v_byte >= v_teto;      -- descarta e sorteia outro
        v_chave := v_chave || substr(v_alfabeto, 1 + (v_byte % v_tam), 1);
      end loop;
      exit when not exists (select 1 from public.vessel_private_edits where chave = v_chave);
    end loop;

    begin
      insert into public.vessel_private_edits
        (codigo, chave, stylist_id, quando, local, praca, loja, vagas, teste)
      values (v_codigo, v_chave, v_stylist, p_quando,
              nullif(trim(coalesce(p_local, '')), ''), v_praca, p_loja, p_vagas, p_teste);
      if p_confirmar_sobreposicao and json_array_length(v_sobrepoe) > 0 then
        return json_build_object('ok', true, 'codigo', v_codigo, 'chave', v_chave, 'sobrepoe', v_sobrepoe);
      end if;
      return json_build_object('ok', true, 'codigo', v_codigo, 'chave', v_chave);
    exception when unique_violation then
      get stacked diagnostics v_indice = constraint_name;
      if v_indice = 'vessel_private_edits_codigo_idx' then
        v_seq := v_seq + 1;                  -- alguém pegou este número: o próximo
      elsif v_indice is distinct from 'vessel_private_edits_chave_idx' then
        raise;                               -- outra coisa: não é para engolir
      end if;                                -- a chave: sorteia outra na volta
    end;
  end loop;

  return json_build_object('ok', false, 'situacao', 'codigo_em_disputa',
    'erro', 'Não consegui dar um código ao encontro agora. Tente de novo em um instante.');
end;
$function$;

-- ── 8. editar: o corpo de hoje + a conferência (só quando pedida) ──────────
drop function if exists public.vessel_private_edit_editar(text, timestamptz, text, text, text, integer, text);
create function public.vessel_private_edit_editar(
  p_codigo text, p_quando timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_local text DEFAULT NULL::text, p_praca text DEFAULT NULL::text, p_loja text DEFAULT NULL::text,
  p_vagas integer DEFAULT NULL::integer, p_stylist text DEFAULT NULL::text,
  p_confirmar_sobreposicao boolean DEFAULT NULL::boolean)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  -- ⚠️ MESMA EXPRESSAO E MESMA ORDEM da irma `vessel_private_edit_encerrar`.
  v_codigo  text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
  v_stylist bigint;
  v_atual   public.vessel_private_edits%rowtype;
  v_sobrepoe json;
begin
  if not public.is_vessel_atendimentos_editar() then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;

  select * into v_atual from public.vessel_private_edits where codigo = v_codigo;
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
    if v_stylist is distinct from v_atual.stylist_id and not exists (
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

  -- ⚠️ 25/09/2026: O ENCONTRO SOBREPOSTO — só quando a tela pede, e só quando o
  -- dia/hora ou o lugar MUDAM (mexer nas vagas não pede confirmação de novo).
  -- O próprio encontro nunca conflita consigo mesmo.
  if p_confirmar_sobreposicao is not null
     and (coalesce(p_quando, v_atual.quando) is distinct from v_atual.quando
          or public.vessel_lugar_do_encontro(coalesce(p_loja, v_atual.loja), coalesce(p_praca, v_atual.praca),
                                             coalesce(p_local, v_atual.local))
             is distinct from public.vessel_lugar_do_encontro(v_atual.loja, v_atual.praca, v_atual.local)) then
    v_sobrepoe := public.vessel_encontros_que_sobrepoem(
                    coalesce(p_quando, v_atual.quando),
                    public.vessel_lugar_do_encontro(coalesce(p_loja, v_atual.loja), coalesce(p_praca, v_atual.praca),
                                                    coalesce(p_local, v_atual.local)),
                    v_codigo);
    if not p_confirmar_sobreposicao and json_array_length(v_sobrepoe) > 0 then
      return json_build_object('ok', false, 'situacao', 'sobrepoe', 'codigo', v_codigo,
        'sobrepoe', v_sobrepoe,
        'contexto', public.vessel_contexto_da_loja(coalesce(p_quando, v_atual.quando), coalesce(p_loja, v_atual.loja)));
    end if;
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

  if p_confirmar_sobreposicao and json_array_length(v_sobrepoe) > 0 then
    return json_build_object('ok', true, 'situacao', 'ok', 'codigo', v_codigo, 'sobrepoe', v_sobrepoe);
  end if;
  return json_build_object('ok', true, 'situacao', 'ok', 'codigo', v_codigo);
end;
$function$;

-- ── 9. as portas ───────────────────────────────────────────────────────────
-- ⚠️ `revoke ... from public` NÃO FECHA `anon`, e função nova em `public` nasce
-- executável por `public`. As duas linhas de cada uma são obrigatórias.
do $$
declare f text;
begin
  foreach f in array array[
    'public.vessel_agenda_das_lojas(date, date, text)',
    'public.vessel_private_edit_sobreposicoes(timestamptz, text, text, text, text)',
    'public.vessel_criar_private_edit(text, timestamptz, text, text, text, integer, boolean, boolean)',
    'public.vessel_private_edit_editar(text, timestamptz, text, text, text, integer, text, boolean)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
