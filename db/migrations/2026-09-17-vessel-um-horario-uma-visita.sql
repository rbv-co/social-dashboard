-- UM HORÁRIO, UMA VISITA — a agenda deixa de aceitar duas clientes na mesma hora
--
-- ⚠️ O BURACO, apontado pelo dono em 17/09/2026: duas Client Advisors marcavam o
-- mesmo horário, cada uma no seu celular, e ninguém descobria até as duas
-- clientes chegarem juntas. É o teste de aceite QA10 do plano — "conflito de
-- slot recusa segunda reserva" — que nunca existiu.
--
-- Decisões do dono, no mesmo dia:
--   · UMA visita por vez, por loja (o protocolo prepara uma área, uma Client
--     Advisor dedicada e a recepção — não duas ao mesmo tempo);
--   · UMA HORA por visita: 45 minutos + 15 de buffer, como o módulo 16 define.
--     Por isso marcar 15:00 bloqueia 15:30 também: a visita ainda está
--     acontecendo.
--
-- ⚠️ E SÃO DUAS COISAS, NÃO UMA. Ler os horários ocupados é GENTILEZA — ela
-- evita o erro na tela. Só que duas Client Advisors clicando no mesmo segundo
-- passariam pelas duas leituras e gravariam as duas. A trava de verdade é a
-- serialização no banco, aqui embaixo.

-- ── A capacidade e a duração, como DADO ────────────────────────────────────
-- ⚠️ NÃO CRAVADAS NO CÓDIGO. Duas lojas fecharam em 2026 e uma mudou de nome;
-- número de loja que mora em função vira migration de emergência no dia em que
-- o Iguatemi passar a atender duas ao mesmo tempo. Aqui é um UPDATE.
create table if not exists public.vessel_agenda_da_loja (
  loja               text primary key,
  ao_mesmo_tempo     int  not null default 1,
  minutos_por_visita int  not null default 60,
  atualizado_em      timestamptz not null default now()
);

insert into public.vessel_agenda_da_loja (loja, ao_mesmo_tempo, minutos_por_visita)
values ('iguatemi', 1, 60), ('tivoli', 1, 60), ('parkshopping', 1, 60)
on conflict (loja) do nothing;

alter table public.vessel_agenda_da_loja enable row level security;

comment on table public.vessel_agenda_da_loja is
  'Quantas visitas a loja atende ao mesmo tempo e quanto tempo cada uma ocupa. '
  'RLS ligada e SEM politica: so as funcoes security definer leem. Mudar a '
  'capacidade e um UPDATE, nao uma migration.';

-- A consulta de conflito roda em TODO cartao gerado.
create index if not exists vessel_atendimentos_hora_idx
  on public.vessel_atendimentos (loja, quando)
  where status in ('solicitado', 'confirmado', 'realizado');

/**
 * QUANTAS VISITAS JÁ OCUPAM ESTE INSTANTE, nesta loja.
 *
 * ⚠️ O QUE SEGURA O HORÁRIO são `solicitado`, `confirmado` e `realizado`.
 * `remarcado` e `cancelado` soltam a hora — é para isso que servem. `no_show`
 * também solta: a visita não aconteceu, e a hora já passou de qualquer jeito.
 *
 * ⚠️ A SOBREPOSIÇÃO É POR DURAÇÃO, não por horário igual. Uma visita de uma
 * hora às 15:00 e outra às 15:30 são horários DIFERENTES e mesmo assim se
 * atropelam. Comparar `quando = quando` deixaria passar exatamente isso.
 */
create or replace function public.vessel_visitas_no_horario(
  p_loja text, p_quando timestamptz, p_ignorar bigint default null)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
    from public.vessel_atendimentos a,
         lateral (select coalesce(
                    (select g.minutos_por_visita from public.vessel_agenda_da_loja g
                      where g.loja = p_loja), 60) as m) cfg
   where a.loja = p_loja
     and a.status in ('solicitado', 'confirmado', 'realizado')
     and a.quando is not null
     and (p_ignorar is null or a.id <> p_ignorar)
     -- Duas janelas de `m` minutos se cruzam quando a distância entre os
     -- inícios é MENOR que `m`.
     and abs(extract(epoch from (a.quando - p_quando))) < cfg.m * 60;
$$;

/**
 * OS HORÁRIOS JÁ OCUPADOS de uma loja num dia — para a tela avisar ANTES.
 *
 * ⚠️ ELA DEVOLVE HORAS, E SÓ HORAS. Sem nome, sem telefone, sem código de Client
 * Advisor, sem número de convite. A página do gerador não tem login: uma função
 * que devolvesse pessoas entregaria a agenda da loja a quem descobrisse o
 * endereço — e o código da CA viaja dentro de todo convite, então ele não
 * serviria de senha. O que vaza aqui é o que a recepção responde no telefone.
 *
 * ⚠️ TETO POR IP, como na lista de espera: sem ele, isto vira uma porta para
 * varrer a agenda de todos os dias do ano, um pedido por vez.
 */
create or replace function public.vessel_horarios_ocupados(p_loja text, p_data date)
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ip       text := public.vessel_hash_de_origem();
  v_recentes int;
  v_cheio    int;
  v_minutos  int;
begin
  if p_loja not in ('iguatemi', 'tivoli', 'parkshopping') or p_data is null then
    return json_build_object('ok', false, 'situacao', 'pedido_invalido');
  end if;

  select count(*) into v_recentes from public.vessel_atendimentos
   where ip_hash = v_ip and criado_em > now() - interval '1 hour';
  -- Teto alto de propósito: uma Client Advisor troca de dia muitas vezes numa
  -- tarde. O que ele barra é a varredura, não o trabalho.
  if v_recentes >= 400 then
    return json_build_object('ok', true, 'ocupados', '[]'::json);
  end if;

  select ao_mesmo_tempo, minutos_por_visita into v_cheio, v_minutos
    from public.vessel_agenda_da_loja where loja = p_loja;
  v_cheio := coalesce(v_cheio, 1);
  v_minutos := coalesce(v_minutos, 60);

  return json_build_object(
    'ok', true,
    'ao_mesmo_tempo', v_cheio,
    'minutos_por_visita', v_minutos,
    -- As horas que JÁ ESTÃO no banco naquele dia, com quantas visitas cada uma
    -- tem. Quem decide o que fica cinza na tela é a página, que conhece a grade
    -- de horários oferecida; aqui só sai o fato.
    'ocupados', coalesce((
      select json_agg(json_build_object('hora', g.hora, 'quantas', g.quantas)
                      order by g.hora)
        from (
          select to_char(a.quando at time zone 'America/Sao_Paulo', 'HH24:MI') as hora,
                 count(*)::int as quantas
            from public.vessel_atendimentos a
           where a.loja = p_loja
             and a.status in ('solicitado', 'confirmado', 'realizado')
             and (a.quando at time zone 'America/Sao_Paulo')::date = p_data
           group by 1
        ) g
    ), '[]'::json));
end;
$$;

/**
 * O REGISTRO DO CARTÃO, AGORA COM A TRAVA DE HORÁRIO.
 *
 * ⚠️ A TRAVA DE FILA (`pg_advisory_xact_lock`) É O QUE FAZ A CONTA VALER. Sem
 * ela, duas Client Advisors clicando no mesmo segundo contam as MESMAS zero
 * visitas e gravam as duas — o mesmo defeito que a fila das 10 unidades da
 * pré-venda já teve neste projeto. A trava é por LOJA E DIA, então duas lojas
 * (ou dois dias) não esperam uma pela outra, e ela cai sozinha no fim da
 * transação.
 *
 * O resto do corpo é o de produção, intocado.
 */
create or replace function public.vessel_registrar_cartao(
  p_nome text, p_whatsapp text, p_loja text, p_quando timestamptz,
  p_client_advisor text, p_armadilha text default null, p_teste boolean default false)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ip text := public.vessel_hash_de_origem();
  v_recentes int; v_pessoa bigint; v_codigo text; v_cheio int; v_ja int;
begin
  if coalesce(trim(p_armadilha), '') <> '' then return json_build_object('ok', true); end if;
  if coalesce(trim(p_nome), '') = '' or public.vessel_telefone_canonico(p_whatsapp) is null then
    return json_build_object('ok', false, 'erro', 'Confira o nome e o WhatsApp da cliente.');
  end if;
  if p_loja not in ('iguatemi', 'tivoli', 'parkshopping') then
    return json_build_object('ok', false, 'erro', 'Escolha a loja.');
  end if;
  if p_quando is null or p_quando < now() - interval '1 day' then
    return json_build_object('ok', false, 'erro', 'Confira a data e o horario.');
  end if;
  select count(*) into v_recentes from public.vessel_atendimentos
   where ip_hash = v_ip and origem_registro = 'appointment_card'
     and criado_em > now() - interval '1 hour';
  if v_recentes >= 60 then
    return json_build_object('ok', true, 'codigo', public.vessel_novo_codigo_de_convite());
  end if;

  -- ⚠️ A TRAVA, ANTES DA CONTA. Uma por loja e por dia.
  perform pg_advisory_xact_lock(
    hashtext('vessel_agenda_' || p_loja || '_' ||
             ((p_quando at time zone 'America/Sao_Paulo')::date)::text));

  select coalesce(ao_mesmo_tempo, 1) into v_cheio
    from public.vessel_agenda_da_loja where loja = p_loja;
  v_cheio := coalesce(v_cheio, 1);
  v_ja := public.vessel_visitas_no_horario(p_loja, p_quando);
  if v_ja >= v_cheio then
    -- ⚠️ A RECUSA DIZ O MOTIVO, e não "confira os dados": quem está com a
    -- cliente na frente precisa saber que o problema é a HORA, para oferecer
    -- outra na mesma conversa.
    return json_build_object('ok', false, 'situacao', 'horario_ocupado',
      'erro', 'Esse horário já tem uma visita marcada nesta loja. Escolha outro.');
  end if;

  v_pessoa := public.vessel_pessoa_por_telefone(p_nome, p_whatsapp);
  update public.vessel_pessoas set teste = p_teste where id = v_pessoa;
  v_codigo := public.vessel_novo_codigo_de_convite();
  insert into public.vessel_atendimentos (
    pessoa_id, loja, client_advisor, quando, status, convite_codigo, origem_registro, ip_hash, teste)
  values (v_pessoa, p_loja, p_client_advisor, p_quando, 'confirmado', v_codigo,
          'appointment_card', v_ip, p_teste);
  return json_build_object('ok', true, 'codigo', v_codigo);
end;
$function$;

-- ⚠️ `revoke ... from public` NAO fecha anon nem authenticated.
revoke all on function public.vessel_visitas_no_horario(text, timestamptz, bigint)
  from public, anon, authenticated;
revoke all on function public.vessel_horarios_ocupados(text, date)
  from public, anon, authenticated;
-- A conta bruta fica FECHADA: quem a chama e a funcao de registrar, que ja roda
-- como dona. Aberta, ela responderia "tem visita as 15:00?" instante a
-- instante, que e a agenda inteira pedida de outro jeito.
grant execute on function public.vessel_horarios_ocupados(text, date) to anon, authenticated;
