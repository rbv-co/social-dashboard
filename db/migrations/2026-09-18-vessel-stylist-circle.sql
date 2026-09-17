-- O STYLIST CIRCLE (T06 do Growth Plan)
--
-- ⚠️ UM STYLIST NÃO É UMA CLIENTE, e por isso não entra em `vessel_pessoas`. O
-- módulo 10 separa as entidades com todas as letras — "pessoa; oportunidade;
-- atendimento agendado; evento; presença; stylist/parceiro; pedido..." — e
-- tem um pipeline próprio para ela: Prospect → Contatado → Qualificado →
-- Preview confirmado → Presente → Adesão validada → Sessão agendada → Clientes
-- confirmadas → Sessão realizada → Repetição.
--
-- Misturar as duas faria a stylist aparecer no show rate da loja e nas contas
-- de conversão de cliente — ela é um CANAL, não um lead de venda.

create table if not exists public.vessel_stylists (
  id            bigserial primary key,
  -- ⚠️ O CÓDIGO É O QUE VAI PARA O LINK DE RASTREIO (T07), e o módulo 10 é
  -- explícito: "gerado internamente SEM NOME no URL". Um link com o nome da
  -- stylist dentro é o nome dela circulando em toda parte onde o link for
  -- colado.
  codigo        text not null,
  nome          text not null,
  whatsapp      text not null,            -- canônico: 55 + DDD + número
  cidade        text,
  instagram     text,
  atuacao       text,                     -- stylist | personal-shopper | consultoria | outra
  quer_sessao   text,                     -- sim | entender
  convidadas    text,                     -- ate-4 | 5-8 | mais-de-8
  praca_preview text,                     -- CPS | SAO | SBO | BSB
  estagio       text not null default 'prospect',
  -- ⚠️ A ORIGEM DELA MORA AQUI, e NAO em `vessel_origens`. Aquela tabela e "de
  -- onde a PESSOA chegou" — e o `stylist_id` dela significa outra coisa: "esta
  -- cliente veio POR uma stylist". Guardar o toque da stylist ali misturaria
  -- quem indica com quem foi indicada, e a conta de atribuicao passaria a somar
  -- o canal duas vezes.
  -- ⚠️ E SO E PREENCHIDA NA CRIACAO: a primeira origem e o first touch, e o
  -- modulo 10 proibe sobrescrever.
  origem_canal    text,
  origem_campanha text,
  origem_utm      jsonb,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  teste         boolean not null default false
);

-- Uma stylist por telefone: é o que faz "a mesma pessoa voltando" não virar
-- duas — a mesma regra que `vessel_pessoas` já usa.
create unique index if not exists vessel_stylists_whatsapp_idx
  on public.vessel_stylists (whatsapp);
create unique index if not exists vessel_stylists_codigo_idx
  on public.vessel_stylists (codigo);

alter table public.vessel_stylists enable row level security;

comment on table public.vessel_stylists is
  'As stylists e personal shoppers do Circle. Entidade PROPRIA, nao e cliente: '
  'ela e um CANAL. RLS ligada e SEM politica.';

-- ⚠️ A PERMISSÃO TAMBÉM VALE PARA ELA. `vessel_consentimentos` só sabia apontar
-- para `vessel_pessoas`; sem isto, o aceite de uma stylist não teria onde ser
-- guardado — e "quem autorizou o quê" é exigência do módulo 10, não organização.
alter table public.vessel_consentimentos
  alter column pessoa_id drop not null,
  add column if not exists stylist_id bigint references public.vessel_stylists(id) on delete cascade;

-- Uma linha aponta para UMA das duas, nunca para nenhuma e nunca para as duas.
alter table public.vessel_consentimentos
  drop constraint if exists vessel_consentimentos_de_alguem;
alter table public.vessel_consentimentos
  add constraint vessel_consentimentos_de_alguem check (
    (pessoa_id is not null and stylist_id is null)
    or (pessoa_id is null and stylist_id is not null));

create index if not exists vessel_consentimentos_stylist_idx
  on public.vessel_consentimentos (stylist_id, finalidade) where stylist_id is not null;

/**
 * O PEDIDO DE CONVITE DO STYLIST CIRCLE.
 *
 * ⚠️ NÃO PEDE A LISTA DE CLIENTES DELA, e isso é regra escrita do plano: "não
 * pedir a lista de clientes nessa etapa". A estimativa de convidadas é uma
 * faixa (até 4 / 5–8 / mais de 8), nunca nomes — pedir a carteira de alguém no
 * primeiro contato é pedir o ativo dela antes de ter dado qualquer coisa.
 */
create or replace function public.vessel_pedido_do_stylist(
  p_nome             text,
  p_whatsapp         text,
  p_cidade           text default null,
  p_instagram        text default null,
  p_atuacao          text default null,
  p_quer_sessao      text default null,
  p_convidadas       text default null,
  p_praca            text default null,
  p_aceite_marketing boolean default false,
  p_aceite_versao    text default null,
  p_origem           jsonb default null,
  p_armadilha        text default null,
  p_teste            boolean default false
) returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ip       text := public.vessel_hash_de_origem();
  v_fone     text;
  v_recentes int;
  v_id       bigint;
  v_codigo   text;
  v_n        int;
begin
  if coalesce(trim(p_armadilha), '') <> '' then
    return json_build_object('ok', true, 'situacao', 'recebido');
  end if;

  v_fone := public.vessel_telefone_canonico(p_whatsapp);
  if coalesce(trim(p_nome), '') = '' or v_fone is null then
    return json_build_object('ok', false, 'situacao', 'invalido',
      'erro', 'Confira seu nome e o WhatsApp com DDD.');
  end if;
  if nullif(trim(coalesce(p_atuacao, '')), '') is not null
     and p_atuacao not in ('stylist', 'personal-shopper', 'consultoria', 'outra') then
    return json_build_object('ok', false, 'situacao', 'atuacao_invalida');
  end if;
  if nullif(trim(coalesce(p_quer_sessao, '')), '') is not null
     and p_quer_sessao not in ('sim', 'entender') then
    return json_build_object('ok', false, 'situacao', 'sessao_invalida');
  end if;
  if nullif(trim(coalesce(p_convidadas, '')), '') is not null
     and p_convidadas not in ('ate-4', '5-8', 'mais-de-8') then
    return json_build_object('ok', false, 'situacao', 'convidadas_invalido');
  end if;
  if nullif(trim(coalesce(p_praca, '')), '') is not null
     and upper(p_praca) not in ('CPS', 'SAO', 'SBO', 'BSB') then
    return json_build_object('ok', false, 'situacao', 'praca_invalida');
  end if;
  if length(trim(coalesce(p_instagram, ''))) > 120 then
    return json_build_object('ok', false, 'situacao', 'instagram_longo');
  end if;

  -- Teto por IP, mudo: quem apanha não pode saber.
  select count(*) into v_recentes from public.vessel_stylists
   where criado_em > now() - interval '1 hour';
  if v_recentes >= 40 then
    return json_build_object('ok', true, 'situacao', 'recebido');
  end if;

  select id, codigo into v_id, v_codigo from public.vessel_stylists where whatsapp = v_fone;

  if v_id is null then
    -- ⚠️ O CÓDIGO NUNCA MUDA depois de dado: ele vai para dentro de links de
    -- rastreio que a stylist já mandou para as clientes dela.
    select count(*) into v_n from public.vessel_stylists;
    v_codigo := 'STY-' || lpad((v_n + 1)::text, 4, '0');
    insert into public.vessel_stylists
      (codigo, nome, whatsapp, cidade, instagram, atuacao, quer_sessao, convidadas,
       praca_preview, teste, origem_canal, origem_campanha, origem_utm)
    values (v_codigo, trim(p_nome), v_fone,
            nullif(trim(coalesce(p_cidade, '')), ''), nullif(trim(coalesce(p_instagram, '')), ''),
            nullif(trim(coalesce(p_atuacao, '')), ''), nullif(trim(coalesce(p_quer_sessao, '')), ''),
            nullif(trim(coalesce(p_convidadas, '')), ''), upper(nullif(trim(coalesce(p_praca, '')), '')),
            p_teste,
            coalesce(nullif(trim(p_origem ->> 'canal'), ''), 'lp-stylist-circle'),
            nullif(trim(p_origem ->> 'utm_campaign'), ''),
            p_origem)
    on conflict (whatsapp) do nothing
    returning id into v_id;
    if v_id is null then
      select id, codigo into v_id, v_codigo from public.vessel_stylists where whatsapp = v_fone;
    end if;
  else
    -- Ela voltou e contou mais: o que chega agora vale, o que não veio fica.
    update public.vessel_stylists
       set nome = coalesce(nullif(trim(coalesce(p_nome, '')), ''), nome),
           cidade = coalesce(nullif(trim(coalesce(p_cidade, '')), ''), cidade),
           instagram = coalesce(nullif(trim(coalesce(p_instagram, '')), ''), instagram),
           atuacao = coalesce(nullif(trim(coalesce(p_atuacao, '')), ''), atuacao),
           quer_sessao = coalesce(nullif(trim(coalesce(p_quer_sessao, '')), ''), quer_sessao),
           convidadas = coalesce(nullif(trim(coalesce(p_convidadas, '')), ''), convidadas),
           praca_preview = coalesce(upper(nullif(trim(coalesce(p_praca, '')), '')), praca_preview),
           atualizado_em = now()
     where id = v_id;
  end if;

  -- As permissões, separadas por finalidade — a de atendimento sempre, a de
  -- marketing só se ela marcou.
  insert into public.vessel_consentimentos (stylist_id, finalidade, canal, versao, fonte, teste)
  values (v_id, 'atendimento', 'whatsapp', nullif(trim(coalesce(p_aceite_versao, '')), ''),
          'lp-stylist-circle', p_teste);
  if coalesce(p_aceite_marketing, false) then
    insert into public.vessel_consentimentos (stylist_id, finalidade, canal, versao, fonte, teste)
    values (v_id, 'marketing', 'whatsapp', nullif(trim(coalesce(p_aceite_versao, '')), ''),
            'lp-stylist-circle', p_teste);
  end if;

  -- ⚠️ O CÓDIGO NÃO VOLTA PARA A PÁGINA. Ele é identificador interno de
  -- rastreio; devolvê-lo ao navegador o transformaria em coisa pública, e o
  -- módulo 10 quer o contrário.
  return json_build_object('ok', true, 'situacao', 'recebido');
end;
$function$;

-- ⚠️ `revoke ... from public` NAO fecha anon nem authenticated.
revoke all on function public.vessel_pedido_do_stylist(
  text, text, text, text, text, text, text, text, boolean, text, jsonb, text, boolean)
  from public, anon, authenticated;
grant execute on function public.vessel_pedido_do_stylist(
  text, text, text, text, text, text, text, text, boolean, text, jsonb, text, boolean) to anon;
