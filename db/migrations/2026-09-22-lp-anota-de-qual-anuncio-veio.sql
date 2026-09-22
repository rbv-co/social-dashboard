-- A LP PASSA A ANOTAR DE QUAL ANÚNCIO A PESSOA VEIO.
--
-- O BURACO (medido em 21/09/2026, quando o dono pediu um log do Meta Ads "lead
-- a lead"): a tabela desenhada para isso, `vessel_origens`, está com ZERO
-- linhas. E não é falta de tráfego — são as PORTAS:
--
--   vessel_solicitar_atendimento  (pedir horário)   grava utm e clique  ✅
--   vessel_entrar_na_lista        (a LP, 153 leads) não recebe nada     ❌
--
-- Ou seja: a porta por onde entra quase todo mundo não anota de onde a pessoa
-- veio. Sem isto, um log "lead a lead com a campanha" sai vazio para sempre.
--
-- ⚠️ POR QUE AS COLUNAS FICAM EM `vessel_lista_espera`, E NÃO EM `vessel_origens`.
-- `vessel_origens.pessoa_id` é NOT NULL e aponta para `vessel_pessoas` — e quem
-- se cadastra na LP vira linha em `vessel_lista_espera`, que é outra tabela.
-- Encaixar a LP ali exigiria afrouxar aquela chave ou criar uma pessoa a cada
-- cadastro, e as duas coisas mexem no painel de atribuição inteiro, que hoje
-- funciona. Guardar na própria linha do cadastro é aditivo e reversível. Quando
-- a captação amadurecer e o cadastro virar pessoa, os dados estão aqui para
-- serem copiados.
--
-- ⚠️ O QUE A PÁGINA MANDA É INFORMAÇÃO, NÃO VERDADE. Qualquer um pode chamar
-- esta função pública com a campanha que quiser. Por isso:
--   • nada aqui vira "canal" nem etiqueta de parceiro — só texto guardado;
--   • quem confere é a PLANILHA, comparando o `utm_campaign` com as campanhas
--     que a Meta nos devolve de verdade (`campaign_insights`, `ads`);
--   • tudo vem aparado no tamanho, para ninguém usar o campo como depósito.
-- É a mesma regra do stylist: conferir contra a TABELA, não contra o formato.

alter table public.vessel_lista_espera
  add column if not exists utm_source   text,
  add column if not exists utm_medium   text,
  add column if not exists utm_campaign text,
  add column if not exists utm_content  text,
  add column if not exists utm_term     text,
  add column if not exists clique_meta  text;

comment on column public.vessel_lista_espera.clique_meta is
  'O `fbclid` que veio na URL do anuncio. E identificador de PUBLICIDADE ligado '
  'a uma pessoa: serve para o retorno ao Meta e NUNCA vai para planilha que '
  'circula — a planilha mostra so sim/nao.';

-- ── a função, com uma porta a mais e nenhuma a menos ────────────────────────
-- ⚠️ DROP E CREATE, e não `create or replace`: mudar a lista de parâmetros cria
-- uma SEGUNDA função com o mesmo nome, e aí o PostgREST não sabe qual chamar.
-- Vai tudo na mesma transação, então não existe instante sem a função.
drop function if exists public.vessel_entrar_na_lista(text, text, text, text, text, text);

create or replace function public.vessel_entrar_na_lista(
  p_nome text, p_email text, p_whatsapp text, p_aceite_versao text,
  p_armadilha text default null, p_origem text default null,
  -- ⚠️ UM SÓ PARÂMETRO, em jsonb: seis parâmetros novos seriam seis chances de
  -- a página e o banco discordarem na ordem. E ele tem DEFAULT, então as duas
  -- páginas que já chamam a função continuam funcionando sem mudar uma linha —
  -- o banco pode subir antes do site, que é a ordem segura.
  p_rastreio jsonb default null)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_cab      json := nullif(current_setting('request.headers', true), '')::json;
  v_ip       text;
  v_recentes int;
  v_origem   text := coalesce(nullif(trim(p_origem), ''), 'lp-vesselbrasil');
  v_prevenda boolean := v_origem = 'pre-venda';
  v_email    text := lower(trim(p_email));
  v_atual    public.vessel_lista_espera%rowtype;
  v_feitos   int;
  v_total    constant int := 10;
  v_id       bigint;
  v_senha    uuid := gen_random_uuid();
  -- O rastreio, aparado. `nullif(trim(...), '')` para campo em branco não virar
  -- string vazia, que depois parece "veio sem campanha" e não é a mesma coisa.
  v_src      text := nullif(trim(left(p_rastreio ->> 'utm_source',   200)), '');
  v_med      text := nullif(trim(left(p_rastreio ->> 'utm_medium',   200)), '');
  v_cmp      text := nullif(trim(left(p_rastreio ->> 'utm_campaign', 200)), '');
  v_cnt      text := nullif(trim(left(p_rastreio ->> 'utm_content',  200)), '');
  v_trm      text := nullif(trim(left(p_rastreio ->> 'utm_term',     200)), '');
  v_fbc      text := nullif(trim(left(p_rastreio ->> 'clique_meta',  500)), '');
begin
  -- A ARMADILHA CONTINUA MUDA. Robo que soubesse que caiu nela tentaria de
  -- outro jeito; ele tem de sair achando que deu certo.
  if coalesce(trim(p_armadilha), '') <> '' then
    return json_build_object('ok', true, 'situacao', 'reservado',
                             'senha', v_senha::text);
  end if;

  if coalesce(trim(p_nome), '') = ''
     or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$'
     or length(regexp_replace(coalesce(p_whatsapp, ''), '\D', '', 'g')) not in (10, 11, 12, 13)
  then
    return json_build_object('ok', false, 'situacao', 'invalido',
                             'erro', 'Confira os campos e tente de novo.',
                             'senha', v_senha::text);
  end if;

  v_ip := encode(extensions.digest(coalesce(v_cab ->> 'x-forwarded-for', 'sem-ip'), 'sha256'), 'hex');

  select count(*) into v_recentes
    from public.vessel_lista_espera
   where ip_hash = v_ip and criado_em > now() - interval '1 hour';

  -- O TETO POR IP FALA DIFERENTE NAS DUAS PORTAS, e isso e decisao.
  if v_recentes >= 5 then
    if v_prevenda then
      return json_build_object('ok', false, 'situacao', 'muitas_tentativas',
        'erro', 'Recebemos varios envios desta conexao. Aguarde alguns minutos e tente de novo.',
        'senha', v_senha::text);
    end if;
    return json_build_object('ok', true, 'situacao', 'reservado',
                             'senha', v_senha::text);
  end if;

  if v_prevenda then
    perform pg_advisory_xact_lock(hashtext('vessel_pre_venda'));
  end if;

  select * into v_atual from public.vessel_lista_espera where lower(email) = v_email;
  select count(*) into v_feitos from public.vessel_lista_espera where origem = 'pre-venda';

  -- A PERGUNTA E `v_atual.id is not null`, NAO `found`.
  if v_atual.id is not null then
    -- ⚠️ QUEM JÁ ESTÁ NA LISTA SÓ TEM O QUE ESTIVER VAZIO PREENCHIDO. `coalesce`
    -- na ordem (antigo, novo) é o first touch: a campanha que trouxe a pessoa
    -- pela PRIMEIRA vez é a que vale, e a segunda visita não reescreve a
    -- história. Preencher o que está nulo não é sobrescrever — é completar.
    if not v_prevenda then
      update public.vessel_lista_espera
         set senha_hash = encode(extensions.digest(v_senha::text, 'sha256'), 'hex'),
             senha_em   = now(),
             utm_source = coalesce(utm_source, v_src),
             utm_medium = coalesce(utm_medium, v_med),
             utm_campaign = coalesce(utm_campaign, v_cmp),
             utm_content = coalesce(utm_content, v_cnt),
             utm_term = coalesce(utm_term, v_trm),
             clique_meta = coalesce(clique_meta, v_fbc)
       where id = v_atual.id;
      return json_build_object('ok', true, 'situacao', 'ja_na_lista',
                               'senha', v_senha::text);
    end if;
    if v_atual.origem = 'pre-venda' then
      update public.vessel_lista_espera
         set senha_hash = encode(extensions.digest(v_senha::text, 'sha256'), 'hex'),
             senha_em   = now(),
             utm_source = coalesce(utm_source, v_src),
             utm_medium = coalesce(utm_medium, v_med),
             utm_campaign = coalesce(utm_campaign, v_cmp),
             utm_content = coalesce(utm_content, v_cnt),
             utm_term = coalesce(utm_term, v_trm),
             clique_meta = coalesce(clique_meta, v_fbc)
       where id = v_atual.id;
      return json_build_object('ok', true, 'situacao', 'ja_reservado',
                               'restam', greatest(0, v_total - v_feitos),
                               'senha', v_senha::text);
    end if;
    if v_feitos >= v_total then
      return json_build_object('ok', false, 'situacao', 'esgotou', 'restam', 0,
        'erro', 'As 10 pecas da pre-venda acabaram.',
        'senha', v_senha::text);
    end if;
    update public.vessel_lista_espera
       set origem = 'pre-venda', nome = trim(p_nome), whatsapp = trim(p_whatsapp),
           aceite_versao = p_aceite_versao, aceite_em = now(),
           bling_em = null, planilha_em = null,
           senha_hash = encode(extensions.digest(v_senha::text, 'sha256'), 'hex'),
           senha_em   = now(),
           utm_source = coalesce(utm_source, v_src),
           utm_medium = coalesce(utm_medium, v_med),
           utm_campaign = coalesce(utm_campaign, v_cmp),
           utm_content = coalesce(utm_content, v_cnt),
           utm_term = coalesce(utm_term, v_trm),
           clique_meta = coalesce(clique_meta, v_fbc)
     where id = v_atual.id;
    return json_build_object('ok', true, 'situacao', 'reservado',
                             'restam', greatest(0, v_total - (v_feitos + 1)),
                             'senha', v_senha::text);
  end if;

  if v_prevenda and v_feitos >= v_total then
    return json_build_object('ok', false, 'situacao', 'esgotou', 'restam', 0,
      'erro', 'As 10 pecas da pre-venda acabaram.',
      'senha', v_senha::text);
  end if;

  insert into public.vessel_lista_espera
    (nome, email, whatsapp, ip_hash, aceite_versao, origem, senha_hash, senha_em,
     utm_source, utm_medium, utm_campaign, utm_content, utm_term, clique_meta)
  values
    (trim(p_nome), v_email, trim(p_whatsapp), v_ip, p_aceite_versao, v_origem,
     encode(extensions.digest(v_senha::text, 'sha256'), 'hex'), now(),
     v_src, v_med, v_cmp, v_cnt, v_trm, v_fbc)
  returning id into v_id;

  return json_build_object('ok', true,
    'situacao', case when v_prevenda then 'reservado' else 'na_lista' end,
    'restam', case when v_prevenda then greatest(0, v_total - (v_feitos + 1)) else null end,
    'senha', v_senha::text);
end;
$function$;

-- ⚠️ A PORTA TEM DE SER REFEITA À MÃO. `drop` levou junto as permissões, e função
-- nova no schema public nasce executável por `public` — que inclui `anon`, cuja
-- chave está no bundle do site. O `revoke from public` NÃO tira concessão
-- explícita de `authenticated`: as duas linhas são necessárias, nesta ordem.
revoke execute on function public.vessel_entrar_na_lista(text,text,text,text,text,text,jsonb) from public;
revoke execute on function public.vessel_entrar_na_lista(text,text,text,text,text,text,jsonb) from authenticated;
grant  execute on function public.vessel_entrar_na_lista(text,text,text,text,text,text,jsonb) to anon;
grant  execute on function public.vessel_entrar_na_lista(text,text,text,text,text,text,jsonb) to service_role;
