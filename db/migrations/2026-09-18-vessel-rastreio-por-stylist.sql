-- O RASTREIO POR STYLIST (T07 do Growth Plan)
--
-- A stylist já nasce com um código (STY-0001, da T06). Esta migration é o que
-- transforma esse código em MEDIDA: um endereço só dela (/s/STY-0001), a
-- contagem de quem abriu, e a garantia de que o código que chega num pedido de
-- atendimento é de uma stylist que EXISTE.
--
-- O critério de aceite do plano — "100% dos stylists ativos com ID próprio" —
-- já vinha do código gerado na inscrição. O que faltava era a outra metade da
-- tarefa, que está escrita ao lado: "medir tráfego, appointments,
-- comparecimento e venda".

-- ── 1. quem abriu o link de uma stylist ────────────────────────────────────
create table if not exists public.vessel_stylist_aberturas (
  id         bigserial primary key,
  momento    timestamptz not null default now(),
  codigo     text not null,
  via        text,                      -- qr | texto
  ip_hash    text
);

create index if not exists vessel_stylist_aberturas_codigo_idx
  on public.vessel_stylist_aberturas (codigo, momento);

alter table public.vessel_stylist_aberturas enable row level security;

comment on table public.vessel_stylist_aberturas is
  'Cada abertura de https://vesselbrasil.com.br/s/STY-0001. '
  '⚠️ SEM pessoa_id, pela mesma razao de vessel_convite_aberturas: um QR '
  'escaneado NAO e um contato identificado (modulo 10). A ligacao com a '
  'cliente so existe quando ela manda o formulario — e ai ela mora em '
  'vessel_origens.stylist_id. RLS ligada e SEM politica.';

-- A Central lê; a página pública, não.
drop policy if exists vessel_stylist_aberturas_le_central on public.vessel_stylist_aberturas;
create policy vessel_stylist_aberturas_le_central on public.vessel_stylist_aberturas
  for select to authenticated using (public.is_vessel_atendimentos());

-- ── 2. o código de uma stylist que existe de verdade ───────────────────────
/**
 * ⚠️ FORMATO CERTO NÃO É STYLIST EXISTENTE — a mesma lição da Beauty Session.
 * `STY-9999` tem a cara exata de um código bom. Sem esta conferência, qualquer
 * um escreveria uma origem inventada e ela apareceria no painel de atribuição
 * como uma stylist de verdade, com tráfego e pedidos que ninguém trouxe.
 *
 * Devolve o código em maiúsculas quando existe, e NULL quando não.
 */
create or replace function public.vessel_stylist_do_codigo(p_codigo text)
returns text
language sql
stable
security definer
set search_path to 'public'
as $function$
  select s.codigo from public.vessel_stylists s
   where s.codigo = upper(nullif(trim(coalesce(p_codigo, '')), ''))
   limit 1;
$function$;

-- ⚠️ Fechada para a página pública: ela responde "esta stylist existe?", e uma
-- porta dessas aberta vira sonda para varrer a lista inteira (STY-0001,
-- STY-0002, ...) e descobrir quantas stylists a marca tem.
revoke all on function public.vessel_stylist_do_codigo(text) from public, anon, authenticated;

-- ── 3. a porta da página: alguém abriu o link ──────────────────────────────
create or replace function public.vessel_visita_do_stylist(
  p_codigo text,
  p_via    text default 'qr'
) returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ip       text := public.vessel_hash_de_origem();
  v_codigo   text := public.vessel_stylist_do_codigo(p_codigo);
  v_recentes int;
begin
  -- ⚠️ RESPOSTA IGUAL PARA CÓDIGO BOM E CÓDIGO INVENTADO. Dizer "não existe"
  -- entregaria de graça quantas stylists a marca tem: bastaria pedir de
  -- STY-0001 até parar de achar.
  if v_codigo is null then
    return json_build_object('ok', true);
  end if;

  select count(*) into v_recentes from public.vessel_stylist_aberturas
   where ip_hash = v_ip and momento > now() - interval '1 hour';
  if v_recentes >= 30 then
    return json_build_object('ok', true);
  end if;

  insert into public.vessel_stylist_aberturas (codigo, via, ip_hash)
  values (v_codigo, case when p_via in ('qr', 'texto') then p_via else 'qr' end, v_ip);

  return json_build_object('ok', true);
end;
$function$;

revoke all on function public.vessel_visita_do_stylist(text, text)
  from public, anon, authenticated;
grant execute on function public.vessel_visita_do_stylist(text, text) to anon;

-- ── 4. o pedido de atendimento passa a CONFERIR a stylist ──────────────────
/**
 * A mesma porta da LP Private Appointment, com uma diferença: o `stylist_id`
 * que chega na origem agora é conferido contra a tabela, e o canal passa a ser
 * decidido AQUI quando ele é real.
 *
 * ⚠️ CÓDIGO INVENTADO NÃO DERRUBA O PEDIDO, só perde a etiqueta. A cliente não
 * tem culpa de um link errado colado num story — e recusar o formulário por
 * causa disso trocaria um lead por uma atribuição. O lead vale mais.
 *
 * ⚠️ E AS UTMs SÃO DERIVADAS DO CÓDIGO, nunca aceitas prontas — a lição do QR
 * da Beauty Session: lista escrita à mão envelhece, e um erro de digitação vira
 * campanha órfã que ninguém descobre até a conta não fechar.
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

    insert into public.vessel_origens
      (pessoa_id, canal, campanha_id, evento_id, parceiro_id, stylist_id, criativo_id,
       utm_source, utm_medium, utm_campaign, utm_content, utm_term,
       clique_meta, navegador_meta)
    values (v_pessoa,
      -- ⚠️ 'stylist' É UM CANAL RESERVADO: só o servidor escreve, e só depois de
      -- achar o código na tabela. Sem esta linha bastaria a página mandar
      -- `canal: "stylist"` com um código inventado para nascer uma stylist
      -- fantasma no painel de atribuição, com tráfego que ninguém trouxe.
      case when v_stylist is not null then 'stylist'
           when lower(coalesce(trim(p_origem ->> 'canal'), '')) in ('stylist', '')
             then 'lp-private-appointment'
           else trim(p_origem ->> 'canal') end,
      nullif(trim(p_origem ->> 'campanha_id'), ''), nullif(trim(p_origem ->> 'evento_id'), ''),
      nullif(trim(p_origem ->> 'parceiro_id'), ''),
      v_stylist,
      nullif(trim(p_origem ->> 'criativo_id'), ''),
      -- Mesma reserva na UTM: um link com `utm_source=stylist` colado à mão
      -- contaria como indicação sem indicação nenhuma.
      case when v_stylist is not null then 'stylist'
           when lower(coalesce(trim(p_origem ->> 'utm_source'), '')) = 'stylist' then null
           else nullif(trim(p_origem ->> 'utm_source'), '') end,
      case when v_stylist is not null then 'referral'
           else nullif(trim(p_origem ->> 'utm_medium'), '') end,
      case when v_stylist is not null then replace(lower(v_stylist), '-', '_')
           else nullif(trim(p_origem ->> 'utm_campaign'), '') end,
      nullif(trim(p_origem ->> 'utm_content'), ''), nullif(trim(p_origem ->> 'utm_term'), ''),
      -- O clique do Meta continua guardado: ele é de OUTRA conta (o retorno de
      -- evento), e não disputa a atribuição com a stylist.
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
            case when v_stylist is not null then 'stylist' else 'lp-private-appointment' end,
            v_ip, p_teste,
            nullif(trim(coalesce(p_momento, '')), ''),
            nullif(trim(coalesce(p_periodo, '')), ''), v_recado)
    returning id into v_id;
  end if;

  -- ⚠️ QA05: a permissão de atendimento é sempre gravada; a de marketing, só
  -- se ela marcou.
  insert into public.vessel_consentimentos (pessoa_id, finalidade, canal, versao, fonte, teste)
  values (v_pessoa, 'atendimento', 'whatsapp', nullif(trim(coalesce(p_aceite_versao, '')), ''),
          coalesce(v_stylist, 'lp-private-appointment'), p_teste);

  if coalesce(p_aceite_marketing, false) then
    insert into public.vessel_consentimentos (pessoa_id, finalidade, canal, versao, fonte, teste)
    values (v_pessoa, 'marketing', 'whatsapp', nullif(trim(coalesce(p_aceite_versao, '')), ''),
            coalesce(v_stylist, 'lp-private-appointment'), p_teste);
  end if;

  return json_build_object('ok', true, 'situacao', 'solicitado');
end;
$function$;

revoke all on function public.vessel_solicitar_atendimento(
  text, text, text, text, text, text, boolean, text, jsonb, text, boolean)
  from public, anon, authenticated;
grant execute on function public.vessel_solicitar_atendimento(
  text, text, text, text, text, text, boolean, text, jsonb, text, boolean) to anon;

-- ── 5. a conta por stylist ─────────────────────────────────────────────────
/**
 * Tráfego → pedidos → comparecimento → venda, por stylist.
 *
 * ⚠️ A CONTA É POR PESSOA, NÃO POR LINHA DE ORIGEM. `vessel_origens` só
 * acrescenta (é o first touch, não pode ser sobrescrito), então a mesma cliente
 * mandando o formulário duas vezes deixa DUAS linhas lá. Somar linhas daria à
 * stylist o dobro do que ela trouxe.
 *
 * ⚠️ A JANELA DA VENDA É UMA ESCOLHA E PRECISA APARECER NA TELA: a compra conta
 * do dia da visita até `p_dias` depois, a mesma régua da Central
 * (`comprasDaVisita`). Não existe no dado nenhum campo dizendo "esta compra
 * veio por aquela stylist" — o que existe é a mesma cliente comprando perto da
 * visita que ela trouxe. Chamar isso de conversão sem dizer a régua é inventar
 * precisão, e por isso a régua viaja dentro da própria resposta.
 *
 * ⚠️ E `receita_liquida`, nunca `total_do_bling`: o segundo sai ~6% maior
 * porque não desconta o desconto do item, e inflaria toda stylist.
 */
create or replace function public.vessel_rastreio_dos_stylists(p_dias int default 7)
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
  -- ⚠️ A CONFERÊNCIA DE PERMISSÃO MORA AQUI DENTRO, não no grant: `security
  -- definer` roda como dono, e `authenticated` é TODO mundo que fez login no
  -- iamundi. Sem esta linha, qualquer conta do sistema leria a lista inteira de
  -- stylists da marca — nome, cidade e quanto cada uma vendeu.
  if not public.is_vessel_atendimentos() then
    raise exception 'sem permissao' using errcode = '42501';
  end if;

  select coalesce(json_agg(linha order by linha ->> 'codigo'), '[]'::json)
    into v_saida
    from (
      select json_build_object(
        'codigo', s.codigo,
        'nome', s.nome,
        'cidade', s.cidade,
        'estagio', s.estagio,
        'praca_preview', s.praca_preview,
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
        -- ⚠️ CADA PEDIDO CONTA UMA VEZ SÓ, mesmo que a cliente tenha duas
        -- visitas realizadas cuja janela pega a mesma compra.
        'receita', (select coalesce(sum(coalesce(p.receita_liquida, p.total_corrigido, 0)), 0)
                      from public.vessel_pedidos p
                     where exists (select 1 from public.vessel_origens o
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
      where not coalesce(s.teste, false)
    ) as linhas;

  return v_saida;
end;
$function$;

revoke all on function public.vessel_rastreio_dos_stylists(int)
  from public, anon, authenticated;
grant execute on function public.vessel_rastreio_dos_stylists(int) to authenticated;

comment on function public.vessel_rastreio_dos_stylists(int) is
  'Trafego, pedidos, comparecimento e venda por stylist (T07). ⚠️ A permissao e '
  'conferida DENTRO da funcao (is_vessel_atendimentos): o grant a authenticated '
  'e so a porta, nao a tranca. A janela da venda e a mesma regua da Central e '
  'viaja na propria resposta.';
