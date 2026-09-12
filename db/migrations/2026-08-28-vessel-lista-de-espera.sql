-- LISTA DE ESPERA DA VESSEL BRASIL
--
-- A LP em vesselbrasil.com.br coleta nome, e-mail e WhatsApp de quem quer ser
-- avisada do lançamento da marca.
--
-- MESMO DESENHO DE vessel_pecas, E PELO MESMO MOTIVO: a chave anônima está
-- dentro do HTML de uma página pública. Com leitura direta, qualquer pessoa
-- baixaria a lista de nomes, e-mails e telefones de gente real. Por isso:
-- RLS ligada e ZERO política. Tudo passa pela função abaixo, que é a única
-- porta e só responde {"ok": true}.

create table if not exists public.vessel_lista_espera (
  id             bigserial primary key,
  nome           text not null,
  email          text not null,
  whatsapp       text not null,
  origem         text not null default 'lp-vesselbrasil',
  ip_hash        text,
  aceite_em      timestamptz not null default now(),
  aceite_versao  text not null,
  criado_em      timestamptz not null default now(),
  -- estado de cada espelho, preenchido pelo robô (NUNCA pela página)
  bling_id       text,
  bling_em       timestamptz,
  planilha_em    timestamptz,
  ultimo_erro    text
);

-- Quem se cadastrar duas vezes não vira duas linhas.
create unique index if not exists vessel_lista_espera_email_idx
  on public.vessel_lista_espera (lower(email));

-- O robô procura o que ainda não espelhou. Índice parcial: só as pendentes.
create index if not exists vessel_lista_espera_pendente_bling_idx
  on public.vessel_lista_espera (criado_em) where bling_em is null;
create index if not exists vessel_lista_espera_pendente_planilha_idx
  on public.vessel_lista_espera (criado_em) where planilha_em is null;

alter table public.vessel_lista_espera enable row level security;
-- Nenhuma policy, de propósito. Ver o comentário do topo.

comment on table public.vessel_lista_espera is
  'Lista de espera da LP vesselbrasil.com.br. RLS ligada e SEM política: só a '
  'função vessel_entrar_na_lista escreve, e ninguém lê pela API pública.';

create or replace function public.vessel_entrar_na_lista(
  p_nome          text,
  p_email         text,
  p_whatsapp      text,
  p_aceite_versao text,
  p_armadilha     text default null
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cab      json := nullif(current_setting('request.headers', true), '')::json;
  v_ip       text;
  v_recentes int;
begin
  -- O CAMPO-ARMADILHA. Um campo invisível que gente não vê e robô preenche.
  -- Responde sucesso e NÃO grava: o robô não descobre que foi barrado e não
  -- volta com outra estratégia.
  if coalesce(trim(p_armadilha), '') <> '' then
    return json_build_object('ok', true);
  end if;

  if coalesce(trim(p_nome), '') = ''
     or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$'
     or length(regexp_replace(coalesce(p_whatsapp, ''), '\D', '', 'g')) not in (10, 11, 12, 13)
  then
    return json_build_object('ok', false, 'erro', 'Confira os campos e tente de novo.');
  end if;

  -- IP só como hash, NUNCA cru — mesmo padrão de vessel_registrar, e é o que a
  -- LGPD pede. O digest vem QUALIFICADO: pgcrypto mora no schema extensions, e
  -- sem o prefixo a função quebra com search_path = public. Foi o que derrubou
  -- vessel_verificar na primeira vez.
  v_ip := encode(
    extensions.digest(coalesce(v_cab ->> 'x-forwarded-for', 'sem-ip'), 'sha256'),
    'hex');

  select count(*) into v_recentes
    from public.vessel_lista_espera
   where ip_hash = v_ip and criado_em > now() - interval '1 hour';

  -- Teto de 5 por hora por origem. Estourado, responde sucesso e não grava,
  -- pelo mesmo motivo da armadilha.
  if v_recentes >= 5 then
    return json_build_object('ok', true);
  end if;

  insert into public.vessel_lista_espera (nome, email, whatsapp, ip_hash, aceite_versao)
  values (trim(p_nome), lower(trim(p_email)), trim(p_whatsapp), v_ip, p_aceite_versao)
  on conflict (lower(email)) do nothing;
  -- E-mail repetido cai aqui e responde sucesso SEM dizer que já existia.
  -- Dizer transformaria a página num verificador de "fulana está na lista?".

  return json_build_object('ok', true);
end;
$$;

revoke all on function public.vessel_entrar_na_lista(text, text, text, text, text) from public;
grant execute on function public.vessel_entrar_na_lista(text, text, text, text, text) to anon, authenticated;
