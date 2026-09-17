-- AS PORTAS PASSAM A NASCER "REAL", como as colunas
--
-- ⚠️ O PADRÃO DO PARÂMETRO TINHA FICADO PARA TRÁS. Durante a fase de testes,
-- `p_teste default true` era o certo: quem esquecesse de passar criava uma linha
-- apagável, e errar assim se conserta. Com o gerador ATIVO a conta inverte —
-- uma chamada sem o parâmetro criaria um atendimento REAL marcado como ensaio,
-- e a próxima limpeza o apagaria achando que era lixo.
--
-- Agora as duas pontas concordam: a coluna nasce `false` e o parâmetro também.
--
-- ⚠️ PARA VOLTAR À FASE DE TESTES um dia, são TRÊS lugares, não dois:
--   1. `EM_TESTE = true` na página do gerador;
--   2. o padrão das quatro colunas (`alter column teste set default true`);
--   3. o padrão destes parâmetros, aqui.
-- Mexer em dois e esquecer o terceiro deixa metade dos registros de um jeito.

create or replace function public.vessel_registrar_cartao(
  p_nome            text,
  p_whatsapp        text,
  p_loja            text,
  p_quando          timestamptz,
  p_client_advisor  text,
  p_armadilha       text default null,
  p_teste           boolean default false
) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_ip text := public.vessel_hash_de_origem();
  v_recentes int; v_pessoa bigint; v_codigo text;
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
  v_pessoa := public.vessel_pessoa_por_telefone(p_nome, p_whatsapp);
  update public.vessel_pessoas set teste = p_teste where id = v_pessoa;
  v_codigo := public.vessel_novo_codigo_de_convite();
  insert into public.vessel_atendimentos (
    pessoa_id, loja, client_advisor, quando, status, convite_codigo, origem_registro, ip_hash, teste)
  values (v_pessoa, p_loja, p_client_advisor, p_quando, 'confirmado', v_codigo,
          'appointment_card', v_ip, p_teste);
  return json_build_object('ok', true, 'codigo', v_codigo);
end;
$$;

create or replace function public.vessel_abrir_convite(
  p_codigo text, p_praca text default null, p_client_advisor text default null,
  p_via text default 'qr', p_teste boolean default false
) returns json
language plpgsql security definer set search_path = public as $$
declare v_ip text := public.vessel_hash_de_origem(); v_recentes int;
begin
  select count(*) into v_recentes from public.vessel_convite_aberturas
   where ip_hash = v_ip and momento > now() - interval '1 hour';
  if v_recentes >= 30 then return json_build_object('ok', true); end if;
  insert into public.vessel_convite_aberturas
    (convite_codigo, praca, client_advisor, via, ip_hash, teste)
  values (nullif(trim(p_codigo), ''), upper(nullif(trim(p_praca), '')),
          nullif(trim(p_client_advisor), ''),
          case when p_via in ('qr', 'texto') then p_via else 'qr' end, v_ip, p_teste);
  return json_build_object('ok', true);
end;
$$;

create or replace function public.vessel_identificar_client_advisor(
  p_nome text, p_loja text default null, p_teste boolean default false)
returns json
language plpgsql security definer set search_path = public as $$
declare v_chave text := public.vessel_chave_do_nome(p_nome); v_codigo text; v_n int;
begin
  if length(v_chave) < 2 then
    return json_build_object('ok', false, 'erro', 'Escreva o seu nome.');
  end if;
  select codigo into v_codigo from public.vessel_client_advisors where chave = v_chave;
  if v_codigo is not null then
    update public.vessel_client_advisors
       set loja = coalesce(nullif(trim(p_loja), ''), loja) where chave = v_chave;
    return json_build_object('ok', true, 'codigo', v_codigo);
  end if;
  select count(*) into v_n from public.vessel_client_advisors;
  if v_n >= 200 then
    return json_build_object('ok', false, 'erro', 'Fale com quem cuida do sistema.');
  end if;
  v_codigo := 'CA-' || lpad((v_n + 1)::text, 2, '0');
  insert into public.vessel_client_advisors (codigo, nome, chave, loja, teste)
  values (v_codigo, trim(p_nome), v_chave, nullif(trim(p_loja), ''), p_teste)
  on conflict (chave) do nothing;
  select codigo into v_codigo from public.vessel_client_advisors where chave = v_chave;
  return json_build_object('ok', true, 'codigo', v_codigo);
end;
$$;

create or replace function public.vessel_marcar_presenca(
  p_codigo text, p_veio boolean, p_teste boolean default false
) returns json
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  select id into v_id from public.vessel_atendimentos
   where convite_codigo = upper(trim(coalesce(p_codigo, '')));
  if v_id is null then return json_build_object('ok', true); end if;
  update public.vessel_atendimentos
     set status = case when p_veio then 'realizado' else 'no_show' end,
         presenca_em = case when p_veio then coalesce(presenca_em, now()) else null end,
         teste = p_teste, atualizado_em = now()
   where id = v_id;
  return json_build_object('ok', true, 'situacao', case when p_veio then 'veio' else 'nao_veio' end);
end;
$$;

revoke all on function public.vessel_registrar_cartao(text, text, text, timestamptz, text, text, boolean) from public, anon, authenticated;
revoke all on function public.vessel_abrir_convite(text, text, text, text, boolean) from public, anon, authenticated;
revoke all on function public.vessel_identificar_client_advisor(text, text, boolean) from public, anon, authenticated;
revoke all on function public.vessel_marcar_presenca(text, boolean, boolean) from public, anon, authenticated;
grant execute on function public.vessel_registrar_cartao(text, text, text, timestamptz, text, text, boolean) to anon, authenticated;
grant execute on function public.vessel_abrir_convite(text, text, text, text, boolean) to anon, authenticated;
grant execute on function public.vessel_identificar_client_advisor(text, text, boolean) to anon, authenticated;
grant execute on function public.vessel_marcar_presenca(text, boolean, boolean) to anon, authenticated;
