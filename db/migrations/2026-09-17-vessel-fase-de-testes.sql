-- A MARCA DE TESTE — para apagar o ensaio sem apagar o que for de verdade
--
-- O gerador vai ser liberado para algumas pessoas usarem antes da aprovação.
-- Tudo que elas fizerem é ensaio e some depois. O problema: se nada distinguir
-- ensaio de real, apagar significa "apagar tudo" — e no dia em que o primeiro
-- atendimento de verdade entrar no meio, ele vai junto.
--
-- Então cada linha nasce marcada. Aprovado o teste, o padrão vira `false` numa
-- migration de uma linha, e o que ficou marcado se apaga com uma consulta só.
--
-- ⚠️ O PADRÃO É `true`, E É DE PROPÓSITO. Esquecer de marcar um registro de
-- teste o deixaria parecendo real para sempre; esquecer de desmarcar um real,
-- na pior das hipóteses, o faz sumir numa limpeza — e isso se percebe. O padrão
-- erra para o lado que dá para consertar.

alter table public.vessel_pessoas
  add column if not exists teste boolean not null default true;
alter table public.vessel_atendimentos
  add column if not exists teste boolean not null default true;
alter table public.vessel_convite_aberturas
  add column if not exists teste boolean not null default true;
alter table public.vessel_client_advisors
  add column if not exists teste boolean not null default true;

comment on column public.vessel_pessoas.teste is
  'Fase de testes (setembro/2026): linha de ensaio, some na limpeza. Aprovado o '
  'teste, o padrao vira false. ⚠️ O padrao e TRUE de proposito: errar marcando '
  'demais se conserta; errar marcando de menos deixa lixo parecendo real.';

create index if not exists vessel_pessoas_teste_idx
  on public.vessel_pessoas (teste) where teste;
create index if not exists vessel_atendimentos_teste_idx
  on public.vessel_atendimentos (teste) where teste;

-- As portas passam a carimbar. O padrao do parametro segue o da coluna.
create or replace function public.vessel_registrar_cartao(
  p_nome            text,
  p_whatsapp        text,
  p_loja            text,
  p_quando          timestamptz,
  p_client_advisor  text,
  p_armadilha       text default null,
  p_teste           boolean default true
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ip       text := public.vessel_hash_de_origem();
  v_recentes int;
  v_pessoa   bigint;
  v_codigo   text;
begin
  if coalesce(trim(p_armadilha), '') <> '' then
    return json_build_object('ok', true);
  end if;
  if coalesce(trim(p_nome), '') = '' or public.vessel_telefone_canonico(p_whatsapp) is null then
    return json_build_object('ok', false, 'erro', 'Confira o nome e o WhatsApp da cliente.');
  end if;
  if p_loja not in ('iguatemi', 'tivoli', 'parkshopping') then
    return json_build_object('ok', false, 'erro', 'Escolha a loja.');
  end if;
  if p_quando is null or p_quando < now() - interval '1 day' then
    return json_build_object('ok', false, 'erro', 'Confira a data e o horario.');
  end if;

  select count(*) into v_recentes
    from public.vessel_atendimentos
   where ip_hash = v_ip and origem_registro = 'appointment_card'
     and criado_em > now() - interval '1 hour';
  if v_recentes >= 60 then
    return json_build_object('ok', true, 'codigo', public.vessel_novo_codigo_de_convite());
  end if;

  v_pessoa := public.vessel_pessoa_por_telefone(p_nome, p_whatsapp);
  update public.vessel_pessoas set teste = p_teste where id = v_pessoa;
  v_codigo := public.vessel_novo_codigo_de_convite();

  insert into public.vessel_atendimentos (
    pessoa_id, loja, client_advisor, quando, status, convite_codigo, origem_registro,
    ip_hash, teste)
  values (v_pessoa, p_loja, p_client_advisor, p_quando, 'confirmado', v_codigo,
          'appointment_card', v_ip, p_teste);

  return json_build_object('ok', true, 'codigo', v_codigo, 'teste', p_teste);
end;
$$;

create or replace function public.vessel_abrir_convite(
  p_codigo          text,
  p_praca           text default null,
  p_client_advisor  text default null,
  p_via             text default 'qr',
  p_teste           boolean default true
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ip       text := public.vessel_hash_de_origem();
  v_recentes int;
begin
  select count(*) into v_recentes
    from public.vessel_convite_aberturas
   where ip_hash = v_ip and momento > now() - interval '1 hour';
  if v_recentes >= 30 then
    return json_build_object('ok', true);
  end if;

  insert into public.vessel_convite_aberturas
    (convite_codigo, praca, client_advisor, via, ip_hash, teste)
  values (nullif(trim(p_codigo), ''), upper(nullif(trim(p_praca), '')),
          nullif(trim(p_client_advisor), ''),
          case when p_via in ('qr', 'texto') then p_via else 'qr' end, v_ip, p_teste);

  return json_build_object('ok', true);
end;
$$;

create or replace function public.vessel_identificar_client_advisor(
  p_nome text, p_loja text default null, p_teste boolean default true)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_chave  text := public.vessel_chave_do_nome(p_nome);
  v_codigo text;
  v_n      int;
begin
  if length(v_chave) < 2 then
    return json_build_object('ok', false, 'erro', 'Escreva o seu nome.');
  end if;
  select codigo into v_codigo from public.vessel_client_advisors where chave = v_chave;
  if v_codigo is not null then
    update public.vessel_client_advisors
       set loja = coalesce(nullif(trim(p_loja), ''), loja)
     where chave = v_chave;
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

-- As assinaturas mudaram: fecha as novas e reabre só as portas.
revoke all on function public.vessel_registrar_cartao(text, text, text, timestamptz, text, text, boolean) from public, anon, authenticated;
revoke all on function public.vessel_abrir_convite(text, text, text, text, boolean) from public, anon, authenticated;
revoke all on function public.vessel_identificar_client_advisor(text, text, boolean) from public, anon, authenticated;
grant execute on function public.vessel_registrar_cartao(text, text, text, timestamptz, text, text, boolean) to anon, authenticated;
grant execute on function public.vessel_abrir_convite(text, text, text, text, boolean) to anon, authenticated;
grant execute on function public.vessel_identificar_client_advisor(text, text, boolean) to anon, authenticated;

-- ⚠️ As versoes ANTIGAS, sem `p_teste`, ficam para tras e continuam chamaveis —
-- e elas gravariam sem marca nenhuma. Somem aqui.
drop function if exists public.vessel_registrar_cartao(text, text, text, timestamptz, text, text);
drop function if exists public.vessel_abrir_convite(text, text, text, text);
drop function if exists public.vessel_identificar_client_advisor(text, text);
