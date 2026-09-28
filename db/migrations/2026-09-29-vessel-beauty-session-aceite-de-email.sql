-- Beauty Sessions: a autorização de marketing POR E-MAIL vira linha própria (28/09/2026, pedido do dono).
--
-- Até aqui `vessel_consentimentos` só tinha canal 'whatsapp', mesmo depois de a
-- caixa (QR) e a frase (equipe) passarem a dizer "pelo WhatsApp e por e-mail".
-- Agora as duas portas do Beauty Session gravam também a linha 'email', e o RD
-- Station (que manda e-mail) só recebe "autorizado" quando existe ESSA linha.
-- `vessel_anotar_interesse` NÃO muda: as outras páginas que o usam falam só
-- de WhatsApp.
-- Corpos = os de produção (`...-zzzz-...` para o QR, `...-zzzzz-...` para a
-- equipe) + as linhas do aceite de e-mail.
-- Idempotente.

-- ── Porta do QR ────────────────────────────────────────────────────────────
drop function if exists public.vessel_interesse_da_beauty_session(text,text,text,text,boolean,text,jsonb,text,boolean,text);
create or replace function public.vessel_interesse_da_beauty_session(
  p_nome text, p_whatsapp text, p_evento text, p_interesse text DEFAULT NULL::text,
  p_aceite_marketing boolean DEFAULT false, p_aceite_versao text DEFAULT NULL::text,
  p_origem jsonb DEFAULT NULL::jsonb, p_armadilha text DEFAULT NULL::text,
  p_teste boolean DEFAULT false, p_instagram text DEFAULT NULL::text,
  p_email text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ip       text := public.vessel_hash_de_origem();
  v_recentes int;
  v_loja     text;
  v_ativa    boolean;
  v_origem   jsonb;
  v_email    text := public.vessel_email_canonico(p_email);
begin
  if coalesce(trim(p_armadilha), '') <> '' then
    return json_build_object('ok', true, 'situacao', 'recebido');
  end if;
  if coalesce(trim(p_nome), '') = ''
     or public.vessel_telefone_canonico(p_whatsapp) is null then
    return json_build_object('ok', false, 'situacao', 'invalido',
      'erro', 'Confira seu nome e o WhatsApp com DDD.');
  end if;

  -- ⚠️ E-MAIL OBRIGATÓRIO (etapa 2): sem ele o RD Station recusa o contato.
  if v_email is null then
    return json_build_object('ok', false, 'situacao', 'email_invalido',
      'erro', 'Confira seu e-mail.');
  end if;

  -- ⚠️ O TETO É O MESMO DO STYLIST CIRCLE (120). Duas portas que guardam o
  -- mesmo dado com limites diferentes é como um perfil entra inteiro por uma e
  -- cortado pela outra.
  if length(trim(coalesce(p_instagram, ''))) > 120 then
    return json_build_object('ok', false, 'situacao', 'instagram_longo',
      'erro', 'Seu perfil ficou longo demais. Use so o @ ou o endereco.');
  end if;

  select loja, ativa into v_loja, v_ativa from public.vessel_beauty_sessions
   where codigo = upper(trim(coalesce(p_evento, '')));
  if v_loja is null then
    return json_build_object('ok', false, 'situacao', 'evento_desconhecido',
      'erro', 'Nao reconhecemos este QR. Fale com a nossa equipe.');
  end if;
  if not coalesce(v_ativa, false) then
    return json_build_object('ok', false, 'situacao', 'evento_encerrado',
      'erro', 'Esta sessao ja foi encerrada. Fale com a nossa equipe que a gente '
           || 'te atende do mesmo jeito.');
  end if;

  if nullif(trim(coalesce(p_interesse, '')), '') is not null
     and p_interesse not in ('conhecer-a-loja', 'rever-uma-peca', 'personal-atelier') then
    return json_build_object('ok', false, 'situacao', 'interesse_invalido');
  end if;

  select count(*) into v_recentes from public.vessel_atendimentos
   where ip_hash = v_ip and criado_em > now() - interval '1 hour';
  if v_recentes >= 20 then
    return json_build_object('ok', true, 'situacao', 'recebido');
  end if;

  -- ⚠️ O EVENTO E O CANAL SÃO CRAVADOS AQUI, por cima do que veio do endereço.
  v_origem := coalesce(p_origem, '{}'::jsonb)
    || jsonb_build_object('canal', 'beauty_session',
                          'evento_id', upper(trim(p_evento)));

  perform public.vessel_anotar_interesse(
    p_nome, p_whatsapp, v_loja, 'beauty-session', v_ip,
    null, null, p_interesse, null, p_aceite_marketing, p_aceite_versao,
    v_origem, p_teste, p_instagram);

  if v_email is not null then
    update public.vessel_pessoas set email = v_email
     where telefone = public.vessel_telefone_canonico(p_whatsapp)
       and nullif(trim(coalesce(email, '')), '') is null;
  end if;

  -- ⚠️ O ACEITE DE E-MAIL É UMA LINHA PRÓPRIA. `vessel_anotar_interesse` grava
  -- o de marketing com canal 'whatsapp'; desde a política v4 a caixa do QR diz
  -- "pelo WhatsApp e por e-mail", então quem marcou nessa versão (ou depois)
  -- ganha também a linha de 'email'. Página velha em cache (v3) não ganha:
  -- ela aceitou um texto que falava só de WhatsApp.
  if coalesce(p_aceite_marketing, false)
     and coalesce(substring(p_aceite_versao from '^privacidade-v(\d+)$')::int, 0) >= 4 then
    insert into public.vessel_consentimentos (pessoa_id, finalidade, canal, versao, fonte, teste)
    select p.id, 'marketing', 'email', p_aceite_versao, 'beauty-session', p_teste
      from public.vessel_pessoas p
     where p.telefone = public.vessel_telefone_canonico(p_whatsapp);
  end if;

  return json_build_object('ok', true, 'situacao', 'recebido');
end;
$function$;
revoke all on function public.vessel_interesse_da_beauty_session(text,text,text,text,boolean,text,jsonb,text,boolean,text,text) from public;
grant execute on function public.vessel_interesse_da_beauty_session(text,text,text,text,boolean,text,jsonb,text,boolean,text,text) to anon, service_role;
revoke execute on function public.vessel_interesse_da_beauty_session(text,text,text,text,boolean,text,jsonb,text,boolean,text,text) from authenticated;

-- ── Porta da equipe ────────────────────────────────────────────────────────
drop function if exists public.vessel_beauty_session_cadastrar_lead(text,text,text,text,text);
create or replace function public.vessel_beauty_session_cadastrar_lead(
  p_codigo text, p_nome text, p_whatsapp text, p_instagram text DEFAULT NULL::text,
  p_interesse text DEFAULT NULL::text, p_email text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  -- ⚠️ MESMA EXPRESSÃO E MESMA ORDEM das irmãs desta tela
  -- (`vessel_beauty_session_encerrar`/`editar`/`arquivar`/`apagar`): um código
  -- que faz uma funcionar e a outra responder `nao_achei` é sistema quebrado
  -- na cara de quem está no salão.
  v_codigo    text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
  -- ⚠️ A MESMA LIMPEZA DO SITE (`nomeLimpo`): espaço a mais some, e o mínimo
  -- de 2 letras é o de `problemasDoInteresse`.
  v_nome      text := regexp_replace(trim(coalesce(p_nome, '')), '\s+', ' ', 'g');
  v_tel       text := public.vessel_telefone_canonico(p_whatsapp);
  v_insta     text := nullif(trim(coalesce(p_instagram, '')), '');
  v_interesse text := nullif(trim(coalesce(p_interesse, '')), '');
  v_email     text := public.vessel_email_canonico(p_email);
  v_s         record;
  v_pessoa    bigint;
  v_na_base   boolean;
  v_atend     bigint;
  v_origem    jsonb;
  v_porta     text;
  v_nome_base text;
begin
  if not public.vessel_pode('atendimentos.beauty-sessions', 'editar') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;

  select s.codigo, s.loja, s.ativa, coalesce(s.arquivada, false) as arquivada
    into v_s
    from public.vessel_beauty_sessions s
   where s.codigo = v_codigo;
  if not found then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;
  -- ⚠️ ENCERRADA ACEITA (decisão do dono): a equipe passa a limpo, depois do
  -- evento, os contatos que anotou no papel. Só ARQUIVADA recusa — arquivada é
  -- "não devia estar ali", e lead nova numa duplicata some das contas.
  if v_s.arquivada then
    return json_build_object('ok', false, 'situacao', 'sessao_arquivada');
  end if;

  if length(v_nome) < 2 then
    return json_build_object('ok', false, 'situacao', 'sem_nome');
  end if;
  -- ⚠️ O MESMO TELEFONE CANÔNICO DE TODA A VESSEL (55 + DDD + número). É ele
  -- que faz a mesma cliente não virar duas, e é por ele que o robô dos pedidos
  -- a reconhece na compra do Bling.
  if v_tel is null then
    return json_build_object('ok', false, 'situacao', 'whatsapp_invalido');
  end if;
  -- ⚠️ E-MAIL OBRIGATÓRIO (etapa 2): sem ele o RD Station recusa o contato.
  if v_email is null then
    return json_build_object('ok', false, 'situacao', 'email_invalido');
  end if;
  -- O mesmo teto da página do QR e do Stylist Circle.
  if v_insta is not null and length(v_insta) > 120 then
    return json_build_object('ok', false, 'situacao', 'instagram_longo');
  end if;
  -- As mesmas três opções da página do QR (mais o vazio).
  if v_interesse is not null
     and v_interesse not in ('conhecer-a-loja', 'rever-uma-peca', 'personal-atelier') then
    return json_build_object('ok', false, 'situacao', 'interesse_invalido');
  end if;

  -- ⚠️ DOIS TOQUES AO MESMO TEMPO NÃO VIRAM DUAS LEADS. A conferência "já está
  -- nesta sessão?" e a gravação precisam acontecer em fila para a MESMA pessoa
  -- na MESMA sessão; sem a fila, duas chamadas simultâneas passariam juntas
  -- pela conferência e gravariam duas origens.
  perform pg_advisory_xact_lock(hashtext('vessel-bs-lead:' || v_codigo || ':' || v_tel));

  select id, nome into v_pessoa, v_nome_base from public.vessel_pessoas where telefone = v_tel;
  v_na_base := v_pessoa is not null;

  -- ⚠️ JÁ SE IDENTIFICOU NESTA SESSÃO (pelo QR ou pela equipe): não duplica.
  -- A resposta diz por onde ela entrou, para a equipe não achar que perdeu.
  -- O e-mail novo, se ela não tinha, entra mesmo assim: é o que a leva ao RD.
  if v_na_base and exists (select 1 from public.vessel_origens o
                            where o.pessoa_id = v_pessoa and o.evento_id = v_s.codigo) then
    if v_email is not null then
      update public.vessel_pessoas set email = v_email
       where id = v_pessoa and nullif(trim(coalesce(email, '')), '') is null;
    end if;
    v_porta := case when exists (select 1 from public.vessel_beauty_session_cadastros c
                                  where c.codigo = v_s.codigo and c.pessoa_id = v_pessoa)
                    then 'equipe' else 'qr' end;
    return json_build_object('ok', false, 'situacao', 'ja_estava', 'porta', v_porta,
                             'pessoa_id', v_pessoa, 'nome', v_nome_base);
  end if;

  -- ⚠️ A ORIGEM É MONTADA AQUI, INTEIRA, e não vem da tela: é a marca que a
  -- planilha lê. Os mesmos campos de `origemDaSessao()` do site, trocando só
  -- `offline_qr` por `offline_equipe`.
  v_origem := jsonb_build_object(
    'canal', 'beauty_session',
    'evento_id', v_s.codigo,
    'utm_source', 'beauty_session',
    'utm_medium', 'offline_equipe',
    'utm_campaign', replace(lower(v_s.codigo), '-', '_'));

  v_atend := public.vessel_anotar_interesse(
    v_nome, v_tel, v_s.loja, 'beauty-session-equipe',
    null,                                    -- ⚠️ o IP vai nulo: ver o cabeçalho
    null, null, v_interesse, null,
    true,                                    -- ⚠️ marketing SEMPRE (decisão do dono)
    'equipe-beauty-session-2026-09-28',     -- ⚠️ v. cabeçalho: agora WhatsApp E e-mail
    v_origem, false, v_insta);

  select id, nome into v_pessoa, v_nome_base from public.vessel_pessoas where telefone = v_tel;

  if v_email is not null then
    update public.vessel_pessoas set email = v_email
     where id = v_pessoa and nullif(trim(coalesce(email, '')), '') is null;
  end if;

  -- ⚠️ O ACEITE DE E-MAIL É UMA LINHA PRÓPRIA (a da equipe é sempre sim, e a
  -- frase que ela confirma com a cliente diz "pelo WhatsApp e por e-mail").
  insert into public.vessel_consentimentos (pessoa_id, finalidade, canal, versao, fonte, teste)
  values (v_pessoa, 'marketing', 'email', 'equipe-beauty-session-2026-09-28', 'beauty-session-equipe', false);

  insert into public.vessel_beauty_session_cadastros
    (codigo, pessoa_id, atendimento_id, cadastrado_por, cadastrado_por_nome)
  values (v_s.codigo, v_pessoa, v_atend, auth.uid(),
          (select coalesce(nullif(trim(p.name), ''), p.email) from public.profiles p where p.id = auth.uid()));

  return json_build_object('ok', true, 'situacao', 'ok', 'pessoa_id', v_pessoa,
                           'atendimento_id', v_atend, 'ja_na_base', v_na_base,
                           'nome', v_nome_base);
end;
$function$;
revoke all on function public.vessel_beauty_session_cadastrar_lead(text,text,text,text,text,text) from public, anon;
grant execute on function public.vessel_beauty_session_cadastrar_lead(text,text,text,text,text,text) to authenticated, service_role;


-- ── RD: a base legal é o aceite de E-MAIL ─────────────────────────────────
create or replace function public.vessel_rd_payload(p_origem_id bigint)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select jsonb_build_object(
    'event_type', 'CONVERSION',
    'event_family', 'CDP',
    'payload', jsonb_strip_nulls(jsonb_build_object(
      'conversion_identifier', 'beauty-session-' || lower(coalesce(o.evento_id, 'sem-codigo')),
      'name', p.nome,
      'email', nullif(trim(p.email), ''),
      'mobile_phone', '+' || p.telefone,
      'personal_phone', '+' || p.telefone,
      'city', nullif(trim(p.cidade), ''),
      'traffic_source', o.utm_source,
      'traffic_medium', o.utm_medium,
      'traffic_campaign', o.utm_campaign,
      'tags', (select jsonb_agg(t) from unnest(array[
                 'beauty-session',
                 lower(o.evento_id),
                 case o.utm_medium when 'offline_equipe' then 'cadastro-pela-equipe'
                                   when 'offline_qr' then 'cadastro-pelo-qr' end,
                 (select 'interesse-' || a.interesse from public.vessel_atendimentos a
                   where a.pessoa_id = o.pessoa_id and a.interesse is not null
                   order by a.criado_em desc limit 1)
               ]) t where t is not null),
      'legal_bases', case when exists (
          select 1 from public.vessel_consentimentos c
           where c.pessoa_id = o.pessoa_id and c.finalidade = 'marketing'
             and c.canal = 'email' and c.revogado_em is null)
        then jsonb_build_array(jsonb_build_object(
          'category', 'communications', 'type', 'consent', 'status', 'granted'))
      end
    ))
  )
  from public.vessel_origens o
  join public.vessel_pessoas p on p.id = o.pessoa_id
  where o.id = p_origem_id
$$;
revoke all on function public.vessel_rd_payload(bigint) from public, anon, authenticated;
