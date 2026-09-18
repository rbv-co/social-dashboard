-- CONTAR AS BEAUTY SESSIONS — de quem LEU o QR até a venda (T05 do Growth Plan)
--
-- Até aqui a Beauty Session só sabia de quem PREENCHEU o formulário. Quem
-- apontou a câmera e desistiu era invisível, e por isso não existia a conta que
-- mais importa numa ação de salão: quantas leram para cada uma que respondeu.
--
-- E agora são DUAS peças por sessão (decisão do dono, 18/09/2026):
--
--   MESA    o QR do display — abre /bs/<codigo>, o formulário de 30 segundos.
--   CARTÃO  o QR do cartão que a cliente leva na mão — abre a página de pedir
--           visita, já com a origem da sessão no endereço.
--
-- Medir as duas separadas é o ponto: é o que responde "o cartão na mão funciona
-- melhor que o display na mesa?", e essa resposta muda o que se manda imprimir.

-- ── 1. quem abriu — de qual sessão, e por qual peça ────────────────────────
create table if not exists public.vessel_sessao_aberturas (
  id       bigserial primary key,
  momento  timestamptz not null default now(),
  codigo   text not null,
  peca     text,                       -- mesa | cartao
  via      text,                       -- qr | texto
  ip_hash  text
);

create index if not exists vessel_sessao_aberturas_codigo_idx
  on public.vessel_sessao_aberturas (codigo, momento);

alter table public.vessel_sessao_aberturas enable row level security;

comment on table public.vessel_sessao_aberturas is
  'Cada abertura de uma peca de Beauty Session: o QR da MESA (/bs/<codigo>) e o '
  'QR do CARTAO (a pagina de visita com a origem da sessao). '
  '⚠️ SEM pessoa_id, pela mesma razao de vessel_stylist_aberturas: um QR '
  'escaneado NAO e um contato identificado (modulo 10). A ligacao com a cliente '
  'so existe quando ela manda o formulario — e ai ela mora em '
  'vessel_origens.evento_id. RLS ligada, e a Central le pela politica abaixo.';

-- A Central lê; a página pública, não. (A irmã vessel_stylist_aberturas faz
-- igual — tabela nova se confere contra as irmãs, senão nasce sem a trava.)
drop policy if exists vessel_sessao_aberturas_le_central on public.vessel_sessao_aberturas;
create policy vessel_sessao_aberturas_le_central on public.vessel_sessao_aberturas
  for select to authenticated using (public.is_vessel_atendimentos());

-- ── 2. o código de uma sessão que existe de verdade ────────────────────────
/**
 * ⚠️ FORMATO CERTO NÃO É SESSÃO EXISTENTE — a mesma lição que já custou caro no
 * rastreio por stylist. `BS-20991231-XXX-99` tem a cara exata de um código bom.
 * Sem esta conferência, um endereço montado à mão vira uma Beauty Session
 * fantasma no painel de atribuição, com tráfego e clientes que salão nenhum
 * trouxe.
 *
 * Devolve o código em maiúsculas quando existe, e NULL quando não.
 */
create or replace function public.vessel_sessao_do_codigo(p_codigo text)
returns text
language sql
stable
security definer
set search_path to 'public'
as $function$
  select s.codigo from public.vessel_beauty_sessions s
   where s.codigo = upper(nullif(trim(coalesce(p_codigo, '')), ''))
   limit 1;
$function$;

-- ⚠️ Fechada para a página pública: ela responde "esta sessão existe?", e uma
-- porta dessas aberta vira sonda para varrer a agenda de eventos da marca.
revoke all on function public.vessel_sessao_do_codigo(text) from public, anon, authenticated;

-- ── 3. a porta da página: alguém leu o QR ──────────────────────────────────
create or replace function public.vessel_visita_da_sessao(
  p_codigo text,
  p_peca   text default 'mesa',
  p_via    text default 'qr'
) returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ip       text := public.vessel_hash_de_origem();
  v_codigo   text := public.vessel_sessao_do_codigo(p_codigo);
  v_recentes int;
begin
  -- ⚠️ RESPOSTA IGUAL PARA CÓDIGO BOM E CÓDIGO INVENTADO, como na irmã do
  -- stylist: dizer "não existe" entregaria a agenda de sessões a quem pedisse.
  if v_codigo is null then
    return json_build_object('ok', true);
  end if;

  -- O mesmo teto da irmã: 30 aberturas por hora do mesmo lugar. Numa sessão de
  -- salão o Wi-Fi é compartilhado, e sem teto uma pessoa recarregando a página
  -- vira "tráfego" que não existiu.
  select count(*) into v_recentes from public.vessel_sessao_aberturas
   where ip_hash = v_ip and momento > now() - interval '1 hour';
  if v_recentes >= 30 then
    return json_build_object('ok', true);
  end if;

  insert into public.vessel_sessao_aberturas (codigo, peca, via, ip_hash)
  values (v_codigo,
          case when p_peca in ('mesa', 'cartao') then p_peca else 'mesa' end,
          case when p_via  in ('qr', 'texto')    then p_via  else 'qr'   end,
          v_ip);

  return json_build_object('ok', true);
end;
$function$;

revoke all on function public.vessel_visita_da_sessao(text, text, text)
  from public, anon, authenticated;
grant execute on function public.vessel_visita_da_sessao(text, text, text) to anon;

-- ── 4. 'beauty_session' vira CANAL RESERVADO ───────────────────────────────
/**
 * ⚠️ ESTE PEDAÇO EXISTE POR CAUSA DO QR DO CARTÃO.
 *
 * Antes dele, ninguém chegava na LP Private Appointment dizendo que veio de uma
 * Beauty Session — o formulário da mesa é outra porta, e lá o servidor já crava
 * o evento por dentro (`vessel_interesse_da_beauty_session`).
 *
 * O cartão muda isso: o endereço agora CARREGA `canal=beauty_session` e
 * `event_id=BS-...`, e `vessel_solicitar_atendimento` aceitava os dois como
 * vieram. Ou seja: bastaria colar um código inventado num link para nascer uma
 * sessão fantasma no painel, com clientes que nenhum salão trouxe — exatamente
 * o buraco que a T07 fechou para o stylist, reaberto por outra porta.
 *
 * A regra é a mesma das irmãs: o código é conferido na TABELA, e as UTMs são
 * DERIVADAS dele, nunca aceitas prontas.
 *
 * ⚠️ E CÓDIGO INVENTADO NÃO DERRUBA O PEDIDO, só perde a etiqueta: a cliente
 * não tem culpa de um cartão mal impresso, e trocar um lead por uma atribuição
 * é péssimo negócio. O lead vale mais.
 */
create or replace function public.vessel_solicitar_atendimento(
  p_nome             text,
  p_whatsapp         text,
  p_loja             text,
  p_momento          text default null,
  p_periodo          text default null,
  p_recado           text default null,
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
  v_recentes int;
  v_pessoa   bigint;
  v_ja       bigint;
  v_id       bigint;
  v_recado   text := nullif(trim(coalesce(p_recado, '')), '');
  v_stylist  text;
  v_sessao   text;
begin
  if coalesce(trim(p_armadilha), '') <> '' then
    return json_build_object('ok', true, 'situacao', 'recebido');
  end if;

  if coalesce(trim(p_nome), '') = ''
     or public.vessel_telefone_canonico(p_whatsapp) is null then
    return json_build_object('ok', false, 'situacao', 'invalido',
      'erro', 'Confira seu nome e o WhatsApp com DDD.');
  end if;
  if p_loja is null or p_loja not in ('iguatemi', 'tivoli', 'parkshopping') then
    return json_build_object('ok', false, 'situacao', 'loja_invalida',
      'erro', 'Escolha a loja.');
  end if;
  if nullif(trim(coalesce(p_momento, '')), '') is not null
     and p_momento not in ('dia-a-dia', 'trabalho', 'ocasiao', 'personalizacao', 'conhecer') then
    return json_build_object('ok', false, 'situacao', 'momento_invalido');
  end if;
  if nullif(trim(coalesce(p_periodo, '')), '') is not null
     and p_periodo not in ('manha', 'tarde', 'noite', 'qualquer') then
    return json_build_object('ok', false, 'situacao', 'periodo_invalido');
  end if;
  if length(v_recado) > 300 then
    return json_build_object('ok', false, 'situacao', 'recado_longo',
      'erro', 'Seu recado ficou longo demais. Resuma em ate 300 letras.');
  end if;

  select count(*) into v_recentes from public.vessel_atendimentos
   where ip_hash = v_ip and criado_em > now() - interval '1 hour';
  if v_recentes >= 20 then
    return json_build_object('ok', true, 'situacao', 'recebido');
  end if;

  v_pessoa := public.vessel_pessoa_por_telefone(p_nome, p_whatsapp);
  update public.vessel_pessoas set teste = p_teste where id = v_pessoa;

  -- ⚠️ QA03: A ORIGEM SÓ ACRESCENTA, NUNCA ATUALIZA (first touch).
  if p_origem is not null then
    v_stylist := public.vessel_stylist_do_codigo(p_origem ->> 'stylist_id');
    -- A sessão só vale se o código existir na agenda — e ela perde para a
    -- stylist quando os dois vierem, porque a indicação de uma pessoa é mais
    -- específica do que o evento em que o cartão foi entregue.
    v_sessao := public.vessel_sessao_do_codigo(p_origem ->> 'evento_id');

    insert into public.vessel_origens
      (pessoa_id, canal, campanha_id, evento_id, parceiro_id, stylist_id, criativo_id,
       utm_source, utm_medium, utm_campaign, utm_content, utm_term,
       clique_meta, navegador_meta)
    values (v_pessoa,
      -- ⚠️ 'stylist' E 'beauty_session' SÃO CANAIS RESERVADOS: só o servidor os
      -- escreve, e só depois de achar o código na tabela. Sem estas linhas
      -- bastaria a página mandar o canal com um código inventado para nascer
      -- uma origem fantasma no painel, com tráfego que ninguém trouxe.
      case when v_stylist is not null then 'stylist'
           when v_sessao  is not null then 'beauty_session'
           when lower(coalesce(trim(p_origem ->> 'canal'), ''))
                  in ('stylist', 'beauty_session', '')
             then 'lp-private-appointment'
           else trim(p_origem ->> 'canal') end,
      nullif(trim(p_origem ->> 'campanha_id'), ''),
      -- O evento só entra conferido: código torto vira NULL, e não etiqueta.
      v_sessao,
      nullif(trim(p_origem ->> 'parceiro_id'), ''),
      v_stylist,
      nullif(trim(p_origem ->> 'criativo_id'), ''),
      -- Mesma reserva na UTM: um link com `utm_source=beauty_session` colado à
      -- mão contaria como sessão sem sessão nenhuma.
      case when v_stylist is not null then 'stylist'
           when v_sessao  is not null then 'beauty_session'
           when lower(coalesce(trim(p_origem ->> 'utm_source'), ''))
                  in ('stylist', 'beauty_session') then null
           else nullif(trim(p_origem ->> 'utm_source'), '') end,
      case when v_stylist is not null then 'referral'
           -- ⚠️ O MEIO DO CARTÃO É RESPEITADO quando a sessão é real: é ele que
           -- separa o QR impresso (offline_qr) do link mandado por WhatsApp, e
           -- essa diferença é metade do que a medição do cartão existe para
           -- responder. Só o que NÃO for um meio conhecido cai no padrão.
           when v_sessao is not null then
             case when lower(coalesce(trim(p_origem ->> 'utm_medium'), ''))
                         in ('offline_qr', 'whatsapp', 'referral')
                  then lower(trim(p_origem ->> 'utm_medium'))
                  else 'offline_qr' end
           else nullif(trim(p_origem ->> 'utm_medium'), '') end,
      case when v_stylist is not null then replace(lower(v_stylist), '-', '_')
           when v_sessao  is not null then replace(lower(v_sessao), '-', '_')
           else nullif(trim(p_origem ->> 'utm_campaign'), '') end,
      nullif(trim(p_origem ->> 'utm_content'), ''), nullif(trim(p_origem ->> 'utm_term'), ''),
      nullif(trim(p_origem ->> 'clique_meta'), ''), nullif(trim(p_origem ->> 'navegador_meta'), ''));
  end if;

  -- ⚠️ QA02: DUPLO CLIQUE NÃO DUPLICA.
  select id into v_ja from public.vessel_atendimentos
   where pessoa_id = v_pessoa and loja = p_loja and status = 'solicitado'
     and criado_em > now() - interval '30 minutes'
   order by id desc limit 1;

  if v_ja is not null then
    v_id := v_ja;
    update public.vessel_atendimentos
       set momento_de_uso = coalesce(nullif(trim(coalesce(p_momento, '')), ''), momento_de_uso),
           periodo_preferido = coalesce(nullif(trim(coalesce(p_periodo, '')), ''), periodo_preferido),
           recado = coalesce(v_recado, recado),
           atualizado_em = now()
     where id = v_id;
  else
    insert into public.vessel_atendimentos
      (pessoa_id, loja, quando, status, origem_registro, ip_hash, teste,
       momento_de_uso, periodo_preferido, recado)
    values (v_pessoa, p_loja, null, 'solicitado',
            case when v_stylist is not null then 'stylist'
                 when v_sessao  is not null then 'beauty-session-cartao'
                 else 'lp-private-appointment' end,
            v_ip, p_teste,
            nullif(trim(coalesce(p_momento, '')), ''),
            nullif(trim(coalesce(p_periodo, '')), ''), v_recado)
    returning id into v_id;
  end if;

  -- ⚠️ QA05: a permissão de atendimento é sempre gravada; a de marketing, só
  -- se ela marcou.
  insert into public.vessel_consentimentos (pessoa_id, finalidade, canal, versao, fonte, teste)
  values (v_pessoa, 'atendimento', 'whatsapp', nullif(trim(coalesce(p_aceite_versao, '')), ''),
          coalesce(v_stylist, v_sessao, 'lp-private-appointment'), p_teste);

  if coalesce(p_aceite_marketing, false) then
    insert into public.vessel_consentimentos (pessoa_id, finalidade, canal, versao, fonte, teste)
    values (v_pessoa, 'marketing', 'whatsapp', nullif(trim(coalesce(p_aceite_versao, '')), ''),
            coalesce(v_stylist, v_sessao, 'lp-private-appointment'), p_teste);
  end if;

  return json_build_object('ok', true, 'situacao', 'solicitado');
end;
$function$;

revoke all on function public.vessel_solicitar_atendimento(
  text, text, text, text, text, text, boolean, text, jsonb, text, boolean)
  from public, anon, authenticated;
grant execute on function public.vessel_solicitar_atendimento(
  text, text, text, text, text, text, boolean, text, jsonb, text, boolean) to anon;

-- ── 5. a conta de cada sessão, do QR à venda ───────────────────────────────
/**
 * Leram → preencheram → pediram visita → compareceram → compraram, por sessão,
 * com a MESA e o CARTÃO contados separados.
 *
 * ⚠️ "LERAM" NÃO É GENTE, É LEITURA. A mesma pessoa que abre duas vezes conta
 * duas. Não dá para ser diferente sem escrever no navegador dela, e o módulo 10
 * proíbe — um QR escaneado não é um contato. Por isso a coluna se chama
 * `leituras`, e nunca "visitantes": a tela que chamar isso de pessoa está
 * mentindo, e quem lê decide orçamento com esse número.
 *
 * ⚠️ A CONTA DE PESSOAS É POR pessoa_id, NÃO POR LINHA DE ORIGEM. `vessel_origens`
 * só acrescenta (first touch), então a mesma cliente que preenche a mesa e
 * depois o cartão deixa DUAS linhas lá. Somar linhas daria à sessão o dobro do
 * que ela trouxe.
 *
 * ⚠️ A JANELA DA VENDA É ESCOLHA, e viaja na resposta: não existe no dado
 * nenhum campo dizendo "esta compra veio daquela sessão". O que existe é a
 * mesma cliente comprando perto da visita. Chamar isso de conversão sem dizer a
 * régua é inventar precisão.
 */
create or replace function public.vessel_conta_das_beauty_sessions(p_dias int default 7)
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
  -- A permissão mora AQUI DENTRO, não no grant: `security definer` roda como
  -- dono, e `authenticated` é todo mundo que fez login no iamundi.
  if not public.is_vessel_atendimentos() then
    raise exception 'sem permissao' using errcode = '42501';
  end if;

  select coalesce(json_agg(linha order by linha ->> 'quando' desc), '[]'::json)
    into v_saida
    from (
      select json_build_object(
        'codigo', s.codigo,
        'quando', s.quando,
        'praca', s.praca,
        'loja', s.loja,
        'parceiro', s.parceiro,
        'ativa', s.ativa,
        'leituras_mesa', (select count(*)::int from public.vessel_sessao_aberturas a
                           where a.codigo = s.codigo and a.peca = 'mesa'),
        'leituras_cartao', (select count(*)::int from public.vessel_sessao_aberturas a
                             where a.codigo = s.codigo and a.peca = 'cartao'),
        'pessoas', (select count(distinct o.pessoa_id)::int
                      from public.vessel_origens o where o.evento_id = s.codigo),
        'pedidos', (select count(*)::int from public.vessel_atendimentos t
                     where not coalesce(t.teste, false)
                       and exists (select 1 from public.vessel_origens o
                                    where o.evento_id = s.codigo
                                      and o.pessoa_id = t.pessoa_id)),
        'confirmados', (select count(*)::int from public.vessel_atendimentos t
                         where not coalesce(t.teste, false)
                           and t.status in ('confirmado', 'realizado', 'no_show')
                           and exists (select 1 from public.vessel_origens o
                                        where o.evento_id = s.codigo
                                          and o.pessoa_id = t.pessoa_id)),
        'compareceram', (select count(*)::int from public.vessel_atendimentos t
                          where not coalesce(t.teste, false) and t.status = 'realizado'
                            and exists (select 1 from public.vessel_origens o
                                         where o.evento_id = s.codigo
                                           and o.pessoa_id = t.pessoa_id)),
        -- ⚠️ `receita_liquida`, nunca `total_do_bling`: o segundo sai ~6% maior
        -- porque não desconta o desconto do item, e inflaria toda sessão.
        'receita', (select coalesce(sum(coalesce(p.receita_liquida, p.total_corrigido, 0)), 0)
                      from public.vessel_pedidos p
                     where exists (select 1 from public.vessel_origens o
                                    where o.evento_id = s.codigo and o.pessoa_id = p.pessoa_id)
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
      from public.vessel_beauty_sessions s
    ) as linhas;

  return v_saida;
end;
$function$;

revoke all on function public.vessel_conta_das_beauty_sessions(int)
  from public, anon, authenticated;
grant execute on function public.vessel_conta_das_beauty_sessions(int) to authenticated;

comment on function public.vessel_conta_das_beauty_sessions(int) is
  'Leituras (mesa e cartao separados), pessoas, pedidos, comparecimento e venda '
  'por Beauty Session. ⚠️ "leituras" e LEITURA, nao pessoa: a mesma cliente '
  'abrindo duas vezes conta duas. A permissao e conferida DENTRO da funcao; o '
  'grant a authenticated e so a porta, nao a tranca.';
