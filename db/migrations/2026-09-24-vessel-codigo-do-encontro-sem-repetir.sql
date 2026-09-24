-- O CÓDIGO DO ENCONTRO NUNCA SE REPETE.
--
-- Defeito achado na simulação de `2026-09-24-vessel-private-edit-so-com-stylist-
-- liberada.sql` e consertado a pedido do dono (24/09/2026): o código do Private
-- Edit era "PE-dia-praça-(quantos encontros há naquele dia e praça + 1)". Um
-- encontro que MUDA DE DIA deixa o número dele livre na conta do dia de origem,
-- e o próximo criado lá recebia o MESMO código — a criação quebrava com erro de
-- chave duplicada (`vessel_private_edits_codigo_idx`).
--
-- O CONSERTO (`vessel_criar_private_edit`, mesma assinatura):
--   · a FILA: `pg_advisory_xact_lock` por dia e praça, até o fim da transação.
--     Duas criações no mesmo dia e praça ao mesmo tempo esperam uma pela outra,
--     e a segunda enxerga o que a primeira gravou. Foi a escolha em vez de só
--     "tentar de novo": sem a fila, as duas calculam o mesmo número;
--   · o PRÓXIMO LIVRE: a partir do número de sempre (o que já nasceria), avança
--     enquanto o código aparecer em qualquer lugar (`vessel_codigo_de_evento_
--     usado`: encontros, sessões, atendimentos, origens, leituras de QR e
--     cadastros da sessão) — encontro apagado que deixou rastro não é reusado;
--   · o CINTO: `unique_violation` na inserção avança o número e tenta de novo
--     (até 5 voltas; a chave sorteada repetida sorteia outra).
-- ⚠️ CÓDIGOS QUE JÁ EXISTEM NÃO MUDAM: eles estão em links `/pe/...` já
-- enviados, no QR e na planilha. Nada aqui faz `update` de código.
--
-- A IRMÃ — `vessel_beauty_session_criar`: o código da sessão é ESCRITO pela
-- tela (não é contado), então o defeito do dia não existe lá. Mas ela tinha os
-- dois furos vizinhos: só conferia a tabela de sessões (uma sessão apagada
-- deixava as leituras do QR com o código, e reusá-lo juntaria dois eventos) e,
-- com duas criações ao mesmo tempo, a segunda voltava o erro cru da chave
-- primária. Agora usa a mesma conferência e devolve a mesma frase.
-- (Os outros geradores de código — STY da stylist e CA do Client Advisor — não
-- são de evento e ficam como estão; ver a entrega.)

create or replace function public.vessel_codigo_de_evento_usado(p_codigo text)
returns boolean
language sql
stable
set search_path to 'public'
as $function$
  select exists (select 1 from public.vessel_private_edits where codigo = p_codigo)
      or exists (select 1 from public.vessel_beauty_sessions where codigo = p_codigo)
      or exists (select 1 from public.vessel_atendimentos where evento_codigo = p_codigo)
      or exists (select 1 from public.vessel_origens where evento_id = p_codigo)
      or exists (select 1 from public.vessel_sessao_aberturas where codigo = p_codigo)
      or exists (select 1 from public.vessel_beauty_session_cadastros where codigo = p_codigo)
$function$;
revoke all on function public.vessel_codigo_de_evento_usado(text) from public, anon, authenticated;

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
  v_prefixo  text;
  v_volta    int;
  v_indice   text;
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

CREATE OR REPLACE FUNCTION public.vessel_beauty_session_criar(p_codigo text, p_quando date, p_praca text, p_loja text, p_parceiro text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_codigo text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
  v_praca  text := upper(nullif(trim(coalesce(p_praca, '')), ''));
  v_data   text;
begin
  -- A permissão mora AQUI DENTRO, não no grant: `security definer` roda como
  -- dono, e `authenticated` é todo mundo que fez login na Central.
  if not public.is_vessel_atendimentos_editar() then
    return json_build_object('ok', false, 'erro',
      'Você não tem a permissão de Atendimentos para criar uma sessão.');
  end if;

  if v_codigo is null or v_codigo !~ '^BS-\d{8}-[A-Z]{3}-[A-Z0-9]{1,4}$' then
    return json_build_object('ok', false, 'erro',
      'O código precisa ter o formato BS-AAAAMMDD-PRACA-NUMERO, como BS-20260925-CPS-01.');
  end if;
  if p_quando is null then
    return json_build_object('ok', false, 'erro', 'Escolha a data da sessão.');
  end if;

  -- a data escrita DENTRO do código, contra a data da sessão
  v_data := substring(v_codigo from 4 for 8);
  if v_data <> to_char(p_quando, 'YYYYMMDD') then
    return json_build_object('ok', false, 'erro',
      'A data do código (' || v_data || ') não é a data da sessão ('
      || to_char(p_quando, 'YYYYMMDD') || '). Uma das duas está errada.');
  end if;

  if v_praca is null or v_praca !~ '^[A-Z]{3}$' then
    return json_build_object('ok', false, 'erro', 'A praça tem três letras, como CPS.');
  end if;
  if substring(v_codigo from 13 for 3) <> v_praca then
    return json_build_object('ok', false, 'erro',
      'A praça do código não é a praça escolhida.');
  end if;
  if p_loja is null or p_loja not in ('iguatemi', 'tivoli', 'parkshopping') then
    return json_build_object('ok', false, 'erro', 'Escolha a loja.');
  end if;

  -- ⚠️ 24/09/2026: "usado" é em TODO lugar onde um código de evento aparece —
  -- sessão apagada deixa as leituras do QR e as origens com o código dela.
  if public.vessel_codigo_de_evento_usado(v_codigo) then
    return json_build_object('ok', false, 'erro',
      'Já existe uma sessão com este código. Código não se reaproveita: a leitura '
      || 'de dois eventos diferentes cairia na mesma linha do painel.');
  end if;

  -- ⚠️ O CINTO: duas criações com o mesmo código ao mesmo tempo passam as duas
  -- pela conferência de cima; a segunda batia na chave primária e voltava um
  -- erro cru. Agora volta a mesma frase.
  begin
    insert into public.vessel_beauty_sessions (codigo, quando, praca, loja, parceiro, ativa)
    values (v_codigo, p_quando, v_praca,
            p_loja, nullif(trim(coalesce(p_parceiro, '')), ''), true);
  exception when unique_violation then
    return json_build_object('ok', false, 'erro',
      'Já existe uma sessão com este código. Código não se reaproveita: a leitura '
      || 'de dois eventos diferentes cairia na mesma linha do painel.');
  end;

  return json_build_object('ok', true, 'codigo', v_codigo);
end;
$function$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.vessel_criar_private_edit(text, timestamptz, text, text, text, integer, boolean)',
    'public.vessel_beauty_session_criar(text, date, text, text, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
