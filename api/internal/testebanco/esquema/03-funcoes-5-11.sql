-- VERBATIM de levantamento/02-funções.csv (gerado por fatia511.mjs, Plano 5.11): as 62 RPCs de atendimentos da
-- Vessel e o fecho do que elas chamam que as outras fatias ainda não carregam (101 funções).
set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.vessel_achatar_cidade(p_texto text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select btrim(
           regexp_replace(
             regexp_replace(
               lower(translate(coalesce(p_texto, ''),
                 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ',
                 'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn')),
               '[̀-ͯ]', '', 'g'),
             '[\t\n\r  ]+', ' ', 'g'));
$function$;

CREATE OR REPLACE FUNCTION public.vessel_agenda_das_lojas(p_de date, p_ate date, p_loja text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_de   date := coalesce(p_de, (now() at time zone 'America/Sao_Paulo')::date);
  v_ate  date := coalesce(p_ate, coalesce(p_de, (now() at time zone 'America/Sao_Paulo')::date) + 41);
  v_loja text := nullif(lower(trim(coalesce(p_loja, ''))), '');
  v_dur  interval := public.vessel_private_edit_duracao();
  v_saida json;
begin
  if not public.vessel_pode('atendimentos.private-edit', 'ver') then
    raise exception 'sem permissao' using errcode = '42501';
  end if;
  if v_ate < v_de then
    raise exception 'o fim vem antes do começo' using errcode = '22023';
  end if;
  -- Uma tela mostra no máximo um mês e as bordas; seis meses é folga de sobra
  -- e impede que um pedido de "todos os anos" segure o banco.
  if v_ate - v_de > 190 then
    raise exception 'periodo longo demais (maximo 190 dias)' using errcode = '22023';
  end if;

  select coalesce(json_agg(x order by x ->> 'dia', x ->> 'hora' nulls first, x ->> 'tipo', x ->> 'codigo'), '[]'::json)
    into v_saida
    from (
      -- Private Edit (o que a tela destaca)
      select json_build_object(
               'tipo', 'private_edit', 'id', e.id, 'codigo', e.codigo,
               'dia', to_char(e.quando at time zone 'America/Sao_Paulo', 'YYYY-MM-DD'),
               'hora', to_char(e.quando at time zone 'America/Sao_Paulo', 'HH24:MI'),
               'hora_fim', to_char((e.quando + v_dur) at time zone 'America/Sao_Paulo', 'HH24:MI'),
               'inicio', e.quando, 'fim', e.quando + v_dur,
               'loja', e.loja, 'praca', e.praca, 'local', e.local,
               'lugar', public.vessel_lugar_do_encontro(e.loja, e.praca, e.local),
               'stylist', s.codigo, 'anfitria', s.nome, 'parceiro', null, 'client_advisor', null,
               'status', e.status,
               'sobrepoe', (select coalesce(json_agg(o ->> 'codigo'), '[]'::json)
                              from json_array_elements(public.vessel_encontros_que_sobrepoem(
                                     e.quando, public.vessel_lugar_do_encontro(e.loja, e.praca, e.local), e.codigo)) o)
             ) as x
        from public.vessel_private_edits e
        left join public.vessel_stylists s on s.id = e.stylist_id
       where not coalesce(e.teste, false)
         and not coalesce(e.arquivada, false)
         and coalesce(e.status, 'agendado') not in ('cancelado', 'nao_realizado')
         and (e.quando at time zone 'America/Sao_Paulo')::date between v_de and v_ate
         and (v_loja is null or e.loja = v_loja)
      union all
      -- Beauty Session (o dia inteiro; acontece no salão parceiro, a loja é a
      -- que recebe o interesse)
      select json_build_object(
               'tipo', 'beauty_session', 'id', null, 'codigo', b.codigo,
               'dia', to_char(b.quando, 'YYYY-MM-DD'), 'hora', null, 'hora_fim', null,
               'inicio', null, 'fim', null,
               'loja', b.loja, 'praca', b.praca, 'local', null, 'lugar', b.loja,
               'stylist', null, 'anfitria', null, 'parceiro', b.parceiro, 'client_advisor', null,
               'status', case when coalesce(b.ativa, true) then 'aberta' else 'encerrada' end,
               'sobrepoe', null)
        from public.vessel_beauty_sessions b
       where not coalesce(b.arquivada, false)
         and b.quando between v_de and v_ate
         and (v_loja is null or b.loja = v_loja)
      union all
      -- Private Appointment (a visita marcada; sem o nome da cliente)
      select json_build_object(
               'tipo', 'private_appointment', 'id', t.id, 'codigo', null,
               'dia', to_char(t.quando at time zone 'America/Sao_Paulo', 'YYYY-MM-DD'),
               'hora', to_char(t.quando at time zone 'America/Sao_Paulo', 'HH24:MI'), 'hora_fim', null,
               'inicio', t.quando, 'fim', null,
               'loja', t.loja, 'praca', null, 'local', null, 'lugar', t.loja,
               'stylist', null, 'anfitria', null, 'parceiro', null, 'client_advisor', t.client_advisor,
               'status', t.status, 'sobrepoe', null)
        from public.vessel_atendimentos t
       where t.quando is not null
         and not coalesce(t.teste, false)
         and coalesce(t.evento_codigo, '') not like 'PE-%'
         and t.status not in ('cancelado', 'remarcado')
         and (t.quando at time zone 'America/Sao_Paulo')::date between v_de and v_ate
         and (v_loja is null or t.loja = v_loja)
    ) as itens;

  return v_saida;
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_anotar_interesse(p_nome text, p_whatsapp text, p_loja text, p_origem_registro text, p_ip text, p_momento text DEFAULT NULL::text, p_periodo text DEFAULT NULL::text, p_interesse text DEFAULT NULL::text, p_recado text DEFAULT NULL::text, p_aceite_marketing boolean DEFAULT false, p_aceite_versao text DEFAULT NULL::text, p_origem jsonb DEFAULT NULL::jsonb, p_teste boolean DEFAULT false, p_instagram text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_pessoa bigint;
  v_ja     bigint;
  v_id     bigint;
  v_recado text := nullif(trim(coalesce(p_recado, '')), '');
  v_insta  text := nullif(trim(coalesce(p_instagram, '')), '');
begin
  v_pessoa := public.vessel_pessoa_por_telefone(p_nome, p_whatsapp);
  update public.vessel_pessoas set teste = p_teste where id = v_pessoa;

  -- ⚠️ O PERFIL NÃO É APAGADO POR UM ENVIO VAZIO. Ela volta pela LP de visita,
  -- que não pergunta Instagram, e o `null` de lá passaria por cima do que ela
  -- escreveu no salão. É a mesma postura de e-mail e cidade em
  -- `vessel_pessoa_por_telefone`: preenche o que falta, não apaga o que há.
  if v_insta is not null then
    update public.vessel_pessoas set instagram = v_insta where id = v_pessoa;
  end if;

  -- ⚠️ QA03: A ORIGEM SÓ ACRESCENTA, NUNCA ATUALIZA. A primeira linha é o
  -- first touch e não pode ser sobrescrita quando a pessoa volta — o módulo 10
  -- repete: "não sobrescrever o first_touch".
  if p_origem is not null then
    insert into public.vessel_origens
      (pessoa_id, canal, campanha_id, evento_id, parceiro_id, stylist_id, criativo_id,
       utm_source, utm_medium, utm_campaign, utm_content, utm_term,
       clique_meta, navegador_meta)
    values (v_pessoa,
      coalesce(nullif(trim(p_origem ->> 'canal'), ''), p_origem_registro),
      nullif(trim(p_origem ->> 'campanha_id'), ''), nullif(trim(p_origem ->> 'evento_id'), ''),
      nullif(trim(p_origem ->> 'parceiro_id'), ''), nullif(trim(p_origem ->> 'stylist_id'), ''),
      nullif(trim(p_origem ->> 'criativo_id'), ''),
      nullif(trim(p_origem ->> 'utm_source'), ''), nullif(trim(p_origem ->> 'utm_medium'), ''),
      nullif(trim(p_origem ->> 'utm_campaign'), ''), nullif(trim(p_origem ->> 'utm_content'), ''),
      nullif(trim(p_origem ->> 'utm_term'), ''),
      nullif(trim(p_origem ->> 'clique_meta'), ''), nullif(trim(p_origem ->> 'navegador_meta'), ''));
  end if;

  -- ⚠️ QA02: DUPLO CLIQUE NÃO DUPLICA. Mesma pessoa, mesma loja, ainda
  -- `solicitado` e feito há menos de meia hora = é o mesmo pedido chegando de
  -- novo.
  select id into v_ja from public.vessel_atendimentos
   where pessoa_id = v_pessoa and loja = p_loja and status = 'solicitado'
     and criado_em > now() - interval '30 minutes'
   order by id desc limit 1;

  if v_ja is not null then
    v_id := v_ja;
    update public.vessel_atendimentos
       set momento_de_uso = coalesce(nullif(trim(coalesce(p_momento, '')), ''), momento_de_uso),
           periodo_preferido = coalesce(nullif(trim(coalesce(p_periodo, '')), ''), periodo_preferido),
           interesse = coalesce(nullif(trim(coalesce(p_interesse, '')), ''), interesse),
           recado = coalesce(v_recado, recado),
           atualizado_em = now()
     where id = v_id;
  else
    insert into public.vessel_atendimentos
      (pessoa_id, loja, quando, status, origem_registro, ip_hash, teste,
       momento_de_uso, periodo_preferido, interesse, recado)
    values (v_pessoa, p_loja, null, 'solicitado', p_origem_registro, p_ip, p_teste,
            nullif(trim(coalesce(p_momento, '')), ''),
            nullif(trim(coalesce(p_periodo, '')), ''),
            nullif(trim(coalesce(p_interesse, '')), ''), v_recado)
    returning id into v_id;
  end if;

  -- ⚠️ QA05: A PERMISSÃO DE ATENDIMENTO É SEMPRE GRAVADA; a de marketing só se
  -- ela marcou. Recusar propaganda não pode tirar dela o direito de ser
  -- atendida.
  insert into public.vessel_consentimentos (pessoa_id, finalidade, canal, versao, fonte, teste)
  values (v_pessoa, 'atendimento', 'whatsapp', nullif(trim(coalesce(p_aceite_versao, '')), ''),
          p_origem_registro, p_teste);

  if coalesce(p_aceite_marketing, false) then
    insert into public.vessel_consentimentos (pessoa_id, finalidade, canal, versao, fonte, teste)
    values (v_pessoa, 'marketing', 'whatsapp', nullif(trim(coalesce(p_aceite_versao, '')), ''),
            p_origem_registro, p_teste);
  end if;

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_beauty_session_apagar(p_codigo text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  -- ⚠️ MESMA EXPRESSAO E MESMA ORDEM da irma `vessel_beauty_session_encerrar`.
  v_codigo text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
begin
  if not public.vessel_pode('atendimentos.beauty-sessions', 'editar') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;

  if not exists (select 1 from public.vessel_beauty_sessions where codigo = v_codigo) then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;

  -- ⚠️ APAGAR UMA SESSAO JA LIDA deixaria as leituras do QR SEM SESSAO (ver a
  -- migration de 19/09 para o resto deste comentario, que continua valendo).
  if exists (select 1 from public.vessel_sessao_aberturas where codigo = v_codigo) then
    return json_build_object('ok', false, 'situacao', 'tem_gente');
  end if;

  -- ⚠️ 24/09/2026: E SESSAO COM LEAD TAMBEM NAO SE APAGA. Com o cadastro pela
  -- equipe, uma sessao pode ter gente identificada sem NENHUMA leitura do QR.
  -- Apagar deixaria a origem dessas pessoas (`vessel_origens.evento_id`)
  -- apontando para uma sessao que nao existe, e a receita delas sem dono.
  -- Qualquer origem conta, inclusive a de teste: a recusa protege o dado, e o
  -- dado de teste tambem aponta para ca.
  if exists (select 1 from public.vessel_origens where evento_id = v_codigo) then
    return json_build_object('ok', false, 'situacao', 'tem_leads');
  end if;

  delete from public.vessel_beauty_sessions where codigo = v_codigo;
  return json_build_object('ok', true, 'situacao', 'ok', 'codigo', v_codigo);
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_beauty_session_arquivar(p_codigo text, p_arquivada boolean DEFAULT true)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  -- ⚠️ MESMA EXPRESSAO E MESMA ORDEM da irma `vessel_beauty_session_encerrar`.
  v_codigo text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
begin
  if not public.vessel_pode('atendimentos.beauty-sessions', 'editar') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;

  if not exists (select 1 from public.vessel_beauty_sessions where codigo = v_codigo) then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;

  -- ⚠️ ARQUIVAR NAO E ENCERRAR, e `ativa` nao e tocada aqui. Encerrada continua
  -- contando (e historico); arquivada sai das contas e da lista.
  --
  -- ⚠️ `coalesce(p_arquivada, true)`: quando a tela manda so o codigo — ou
  -- quando o PostgREST deixa o segundo parametro de fora e ele chega nulo —
  -- "arquivar" tem de significar ARQUIVAR. Sem o `coalesce`, a coluna e
  -- `not null` e a chamada morreria com erro de banco na cara da pessoa.
  update public.vessel_beauty_sessions
     set arquivada = coalesce(p_arquivada, true)
   where codigo = v_codigo;

  return json_build_object('ok', true, 'situacao', 'ok',
                           'codigo', v_codigo, 'arquivada', coalesce(p_arquivada, true));
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_beauty_session_cadastrar_lead(p_codigo text, p_nome text, p_whatsapp text, p_instagram text DEFAULT NULL::text, p_interesse text DEFAULT NULL::text, p_email text DEFAULT NULL::text)
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
  if not public.vessel_pode('atendimentos.beauty-sessions', 'editar') then
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

CREATE OR REPLACE FUNCTION public.vessel_beauty_session_editar(p_codigo text, p_quando date DEFAULT NULL::date, p_loja text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  -- ⚠️ MESMA EXPRESSAO E MESMA ORDEM da irma `vessel_beauty_session_encerrar`.
  v_codigo text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
begin
  if not public.vessel_pode('atendimentos.beauty-sessions', 'editar') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;

  if not exists (select 1 from public.vessel_beauty_sessions where codigo = v_codigo) then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;

  -- ⚠️ Campo nulo = "nao mexe neste", nunca "apaga o que estava la". No caso de
  -- `loja` o `coalesce` e o que separa uma edicao de dia de um erro de banco na
  -- cara da pessoa: a coluna e `not null`.
  --
  -- ⚠️ A SESSAO NAO TEM ANFITRIA NEM VAGAS — por isso so `quando` e `loja`.
  -- `praca` e `parceiro` ficam de fora de proposito: a praca esta embutida no
  -- proprio codigo impresso (BS-AAAAMMDD-PRACA-SEQ) e mudar uma sem a outra
  -- deixaria a linha discordando do QR.
  update public.vessel_beauty_sessions
     set quando = coalesce(p_quando, quando),
         loja   = coalesce(p_loja, loja)
   where codigo = v_codigo;

  return json_build_object('ok', true, 'situacao', 'ok', 'codigo', v_codigo);
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_beauty_session_encerrar(p_codigo text, p_ativa boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_codigo text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
begin
  if not public.vessel_pode('atendimentos.beauty-sessions', 'editar') then
    return json_build_object('ok', false, 'erro',
      'Você não tem a permissão de Atendimentos para mexer nas sessões.');
  end if;
  update public.vessel_beauty_sessions
     set ativa = coalesce(p_ativa, false)
   where codigo = v_codigo;
  if not found then
    return json_build_object('ok', false, 'erro', 'Não achei esta sessão.');
  end if;
  return json_build_object('ok', true, 'codigo', v_codigo, 'ativa', coalesce(p_ativa, false));
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_chave_da_convidada(p_id bigint)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_t record;
  v_chave text;
begin
  if not public.vessel_pode('atendimentos.private-edit', 'ver') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  select t.id, t.chave_convite, e.chave as chave_encontro into v_t
    from public.vessel_atendimentos t
    join public.vessel_private_edits e on e.codigo = t.evento_codigo
   where t.id = p_id;
  if not found then return json_build_object('ok', false, 'situacao', 'nao_achei'); end if;
  v_chave := v_t.chave_convite;
  if v_chave is null then
    v_chave := public.vessel_sortear_chave_de_convidada();
    update public.vessel_atendimentos set chave_convite = v_chave where id = v_t.id and chave_convite is null;
    select chave_convite into v_chave from public.vessel_atendimentos where id = v_t.id;
  end if;
  return json_build_object('ok', true, 'situacao', 'ok', 'chave', v_chave, 'chave_encontro', v_t.chave_encontro);
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_codigo_de_evento_usado(p_codigo text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from public.vessel_private_edits where codigo = p_codigo)
      or exists (select 1 from public.vessel_beauty_sessions where codigo = p_codigo)
      or exists (select 1 from public.vessel_atendimentos where evento_codigo = p_codigo)
      or exists (select 1 from public.vessel_origens where evento_id = p_codigo)
      or exists (select 1 from public.vessel_sessao_aberturas where codigo = p_codigo)
      or exists (select 1 from public.vessel_beauty_session_cadastros where codigo = p_codigo)
$function$;

CREATE OR REPLACE FUNCTION public.vessel_conta_das_beauty_sessions(p_dias integer DEFAULT 7, p_incluir_arquivadas boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_dias int := greatest(coalesce(p_dias, 7), 0);
  -- ⚠️ Mesmo cuidado da outra: NULL vindo de fora nao cai no default, e um
  -- `where NULL` devolveria lista vazia sem erro nenhum.
  v_incluir boolean := coalesce(p_incluir_arquivadas, false);
  v_saida json;
begin
  -- A permissão mora AQUI DENTRO, não no grant: `security definer` roda como
  -- dono, e `authenticated` é todo mundo que fez login no iamundi.
  if not (public.vessel_pode('atendimentos.beauty-sessions', 'ver') or public.vessel_pode('atendimentos.material-grafico', 'ver')) then
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
        'arquivada', coalesce(s.arquivada, false),
        'leituras_mesa', (select count(*)::int from public.vessel_sessao_aberturas a
                           where a.codigo = s.codigo and a.peca = 'mesa'),
        'leituras_cartao', (select count(*)::int from public.vessel_sessao_aberturas a
                             where a.codigo = s.codigo and a.peca = 'cartao'),
        -- ⚠️ 24/09/2026: SEM A FICHA DE TESTE. Era o único número desta função
        -- que contava o teste — os de baixo já filtravam `t.teste`.
        'pessoas', (select count(distinct o.pessoa_id)::int
                      from public.vessel_origens o
                      join public.vessel_pessoas pe on pe.id = o.pessoa_id
                     where o.evento_id = s.codigo and not coalesce(pe.teste, false)),
        -- ⚠️ AS DUAS PORTAS SOMAM `pessoas`, sempre: quem tem a linha da
        -- equipe é da equipe; o resto se identificou pelo QR.
        'pessoas_qr', (select count(distinct o.pessoa_id)::int
                         from public.vessel_origens o
                         join public.vessel_pessoas pe on pe.id = o.pessoa_id
                        where o.evento_id = s.codigo and not coalesce(pe.teste, false)
                          and not exists (select 1 from public.vessel_beauty_session_cadastros c
                                           where c.codigo = s.codigo and c.pessoa_id = o.pessoa_id)),
        'pessoas_equipe', (select count(distinct o.pessoa_id)::int
                             from public.vessel_origens o
                             join public.vessel_pessoas pe on pe.id = o.pessoa_id
                            where o.evento_id = s.codigo and not coalesce(pe.teste, false)
                              and exists (select 1 from public.vessel_beauty_session_cadastros c
                                           where c.codigo = s.codigo and c.pessoa_id = o.pessoa_id)),
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
      where (v_incluir or not coalesce(s.arquivada, false))
    ) as linhas;

  return v_saida;
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_conta_das_private_edits(p_dias integer DEFAULT 14, p_incluir_arquivadas boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_dias int := greatest(coalesce(p_dias, 14), 0);
  v_incluir boolean := coalesce(p_incluir_arquivadas, false);
  v_saida json;
begin
  if not (public.vessel_pode('atendimentos.private-edit', 'ver') or public.vessel_pode('atendimentos.material-grafico', 'ver')) then
    raise exception 'sem permissao' using errcode = '42501';
  end if;

  with vendas as (select * from public.vessel_vendas_dos_encontros(v_dias)),
  convite as (
    select t.evento_codigo, t.status, t.rsvp,
           public.vessel_situacao_do_convite(t.status, t.rsvp, t.convite_enviado_em,
                                             e.quando, e.status) as situacao
      from public.vessel_atendimentos t
      join public.vessel_private_edits e on e.codigo = t.evento_codigo
     where not coalesce(t.teste, false)
  )
  select coalesce(json_agg(linha order by linha ->> 'quando' desc), '[]'::json)
    into v_saida
    from (
      select json_build_object(
        'codigo', e.codigo,
        'chave', e.chave,
        'quando', e.quando,
        'anfitria', s.nome,
        'stylist', s.codigo,
        'local', e.local,
        'praca', e.praca,
        'loja', e.loja,
        'vagas', e.vagas,
        'ativa', coalesce(e.ativa, true),
        'arquivada', coalesce(e.arquivada, false),
        -- T11: a situação do encontro e o que vem com ela.
        'status', e.status,
        'realizado_em', e.realizado_em,
        'motivo', e.motivo,
        'observacoes', e.observacoes,
        'convidadas', (select count(*)::int from convite c where c.evento_codigo = e.codigo),
        -- ⚠️ "RESPONDERAM" DEIXOU DE SER "TODA LINHA". Até a T11 toda convidada
        -- nascia do RSVP, então contar linhas era contar respostas. Agora a
        -- equipe inclui convidadas antes de elas responderem, e contar linha
        -- diria que responderam quem ainda nem recebeu o convite.
        'responderam', (select count(*)::int from convite c where c.evento_codigo = e.codigo
                          and (c.rsvp is not null or c.status <> 'solicitado')),
        'disseram_sim', (select count(*)::int from convite c where c.evento_codigo = e.codigo
                           and c.rsvp = 'sim'),
        -- ⚠️ CONFIRMADAS = quem confirmou, inclusive quem depois veio ou faltou.
        -- Sem quem faltou no denominador, o comparecimento daria perto de 100%
        -- sempre.
        'confirmadas', (select count(*)::int from convite c where c.evento_codigo = e.codigo
                          and c.situacao in ('confirmada', 'presente', 'nao_compareceu')),
        'compareceram', (select count(*)::int from convite c where c.evento_codigo = e.codigo
                           and c.status = 'realizado'),
        'receita', (select coalesce(sum(v.receita), 0) from vendas v where v.evento_codigo = e.codigo),
        'vendas', (select count(*)::int from vendas v where v.evento_codigo = e.codigo),
        'janela_de_venda_em_dias', v_dias,
        -- 28/09/2026: o QR do Private Edit Card. LEITURAS = linhas (já sem a
        -- releitura de menos de 10 min); LEITORAS = origens distintas — é
        -- este o número que a agenda mostra.
        'leituras_do_card', (select count(*)::int from public.vessel_private_edit_card_leituras l
                               where l.private_edit_id = e.id),
        'leitoras_do_card', (select count(distinct l.ip_hash)::int from public.vessel_private_edit_card_leituras l
                               where l.private_edit_id = e.id)
      ) as linha
      from public.vessel_private_edits e
      join public.vessel_stylists s on s.id = e.stylist_id
      where not coalesce(e.teste, false)
        and (v_incluir or not coalesce(e.arquivada, false))
    ) as linhas;

  return v_saida;
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_contexto_da_loja(p_quando timestamp with time zone, p_loja text)
 RETURNS json
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(json_agg(x order by x ->> 'dia', x ->> 'hora' nulls first, x ->> 'tipo'), '[]'::json)
    from (
      select json_build_object('tipo', 'beauty_session', 'codigo', b.codigo,
               'dia', to_char(b.quando, 'YYYY-MM-DD'), 'hora', null, 'loja', b.loja, 'praca', b.praca,
               'parceiro', b.parceiro, 'client_advisor', null, 'status', null) as x
        from public.vessel_beauty_sessions b
       where p_quando is not null and p_loja is not null
         and not coalesce(b.arquivada, false)
         and b.loja = lower(trim(p_loja))
         and b.quando = (p_quando at time zone 'America/Sao_Paulo')::date
      union all
      select json_build_object('tipo', 'private_appointment', 'codigo', null,
               'dia', to_char(t.quando at time zone 'America/Sao_Paulo', 'YYYY-MM-DD'),
               'hora', to_char(t.quando at time zone 'America/Sao_Paulo', 'HH24:MI'),
               'loja', t.loja, 'praca', null, 'parceiro', null, 'client_advisor', t.client_advisor,
               'status', t.status)
        from public.vessel_atendimentos t
       where p_quando is not null and p_loja is not null
         and t.quando is not null
         and not coalesce(t.teste, false)
         and coalesce(t.evento_codigo, '') not like 'PE-%'   -- a convidada do encontro É o encontro
         and t.status not in ('cancelado', 'remarcado')
         and t.loja = lower(trim(p_loja))
         and t.quando >= p_quando
         and t.quando < p_quando + public.vessel_private_edit_duracao()
    ) as c
$function$;

CREATE OR REPLACE FUNCTION public.vessel_convidadas_do_encontro(p_codigo text, p_dias integer DEFAULT 14)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_codigo   text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
  v_dias     int := greatest(coalesce(p_dias, 14), 0);
  v_e        public.vessel_private_edits%rowtype;
  v_resposta json;
begin
  -- ⚠️ DADO PESSOAL, atrás do portão de ver; lista vazia em vez de erro (ver
  -- `2026-09-19-vessel-convidadas-do-encontro.sql`).
  if not public.vessel_pode('atendimentos.private-edit', 'ver') then
    return '[]'::json;
  end if;

  select * into v_e from public.vessel_private_edits e where e.codigo = v_codigo;
  if v_e.id is null then
    return '[]'::json;
  end if;

  select coalesce(json_agg(linha order by ordem), '[]'::json)
    into v_resposta
    from (
      select json_build_object(
        -- ⚠️ O GUEST ID DO DOCUMENTO É ESTE: nasce no convite, nunca muda, e
        -- não é o mesmo número da ficha de cliente (`pessoa_id`).
        'id',          t.id,
        'pessoa_id',   t.pessoa_id,
        'nome',        pe.nome,
        'telefone',    pe.telefone,
        'email',       pe.email,
        'rsvp',        t.rsvp,
        'status',      t.status,
        'convidada_em', t.convidada_em,
        'convite_enviado_em', t.convite_enviado_em,
        'chave_convite', t.chave_convite, 'convite_aberto_em', t.convite_aberto_em,
        'convite_aberturas', t.convite_aberturas,
        'respondeu_em', case when t.rsvp is not null then t.criado_em end,
        'presenca_em', t.presenca_em,
        'situacao',    public.vessel_situacao_do_convite(t.status, t.rsvp, t.convite_enviado_em,
                                                         v_e.quando, v_e.status),
        -- ⚠️ "COMPROU" É A MESMA REGRA DA RECEITA DO TOPO, pelo mesmo miolo:
        -- venda atribuída a ESTE encontro. Quem já tinha ido a um encontro
        -- anterior tem a compra lá (decisão 2 do dono), e aqui fica "—".
        'comprou', exists (select 1 from public.vessel_vendas_dos_encontros(v_dias) v
                            where v.evento_codigo = v_e.codigo and v.pessoa_id = t.pessoa_id)
      ) as linha,
      t.id as ordem
      from public.vessel_atendimentos t
      join public.vessel_pessoas pe on pe.id = t.pessoa_id
     where t.evento_codigo = v_codigo
       and not coalesce(t.teste, false)
    ) as linhas;

  return v_resposta;
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_convidar_para_encontro(p_codigo text, p_nome text, p_whatsapp text, p_email text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_codigo text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
  v_email  text := lower(nullif(trim(coalesce(p_email, '')), ''));
  v_e      record;
  v_pessoa bigint;
  v_ja     bigint;
  v_id     bigint;
begin
  if not public.vessel_pode('atendimentos.private-edit', 'editar') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;

  select e.codigo, e.quando, e.loja, e.status, coalesce(e.arquivada, false) as arquivada,
         s.codigo as stylist
    into v_e
    from public.vessel_private_edits e
    join public.vessel_stylists s on s.id = e.stylist_id
   where e.codigo = v_codigo;
  if not found then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;
  if v_e.arquivada or v_e.status = 'cancelado' then
    return json_build_object('ok', false, 'situacao', 'encontro_fechado');
  end if;

  if nullif(trim(coalesce(p_nome, '')), '') is null then
    return json_build_object('ok', false, 'situacao', 'sem_nome');
  end if;
  -- ⚠️ O MESMO TELEFONE CANÔNICO DE TODA A VESSEL (55 + DDD + número). É ele
  -- que faz a mesma cliente não virar duas, e é por ele que o robô dos pedidos
  -- a reconhece na compra do Bling.
  if public.vessel_telefone_canonico(p_whatsapp) is null then
    return json_build_object('ok', false, 'situacao', 'whatsapp_invalido');
  end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return json_build_object('ok', false, 'situacao', 'email_invalido');
  end if;

  -- ⚠️ A FICHA DE CLIENTE NASCE AQUI, ANTES DE ELA COMPRAR — é o "cadastro
  -- antes de existir no CRM" do documento. Se ela já existe (o mesmo
  -- telefone), é a mesma ficha, e o que faltava é completado.
  v_pessoa := public.vessel_pessoa_por_telefone(p_nome, p_whatsapp, v_email);

  -- ⚠️ UMA CONVIDADA, UMA CADEIRA — a mesma regra do RSVP. Convidar de novo
  -- quem já está no encontro devolve a cadeira dela, sem criar outra.
  select id into v_ja from public.vessel_atendimentos
   where pessoa_id = v_pessoa and evento_codigo = v_e.codigo
   order by id limit 1;
  if v_ja is not null then
    return json_build_object('ok', true, 'situacao', 'ja_estava', 'id', v_ja);
  end if;

  insert into public.vessel_origens
    (pessoa_id, canal, evento_id, stylist_id, utm_source, utm_medium, utm_campaign)
  values (v_pessoa, 'private_edit', v_e.codigo, v_e.stylist,
          'private_edit', 'convite', replace(lower(v_e.codigo), '-', '_'));

  insert into public.vessel_atendimentos
    (pessoa_id, loja, quando, status, origem_registro, evento_codigo, convidada_em, chave_convite)
  values (v_pessoa, v_e.loja, v_e.quando, 'solicitado', 'private-edit-convite',
          v_e.codigo, now(), public.vessel_sortear_chave_de_convidada())
  returning id into v_id;

  return json_build_object('ok', true, 'situacao', 'ok', 'id', v_id, 'pessoa_id', v_pessoa);
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_convite_marcar(p_id bigint, p_marca text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_marca text := lower(nullif(trim(coalesce(p_marca, '')), ''));
begin
  -- ⚠️ A MESMA TRAVA DE `vessel_situacao_do_atendimento`, que é por onde a
  -- presença é marcada: marcar "convite enviado" e marcar "veio" são o mesmo
  -- tipo de gesto, feitos pela mesma pessoa, no mesmo cartão.
  if not public.vessel_pode('atendimentos.private-edit', 'ver') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  if v_marca is null or v_marca not in ('enviado', 'sim', 'nao', 'sem_resposta') then
    return json_build_object('ok', false, 'situacao', 'marca_invalida');
  end if;
  -- ⚠️ SÓ CONVIDADA DE ENCONTRO. Uma visita comum não tem convite, e esta
  -- função não pode virar um jeito de reescrever `rsvp` de qualquer linha.
  if not exists (select 1 from public.vessel_atendimentos
                  where id = p_id and evento_codigo is not null) then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;

  update public.vessel_atendimentos
     set convite_enviado_em = case when v_marca = 'enviado'
                                   then coalesce(convite_enviado_em, now())
                                   else convite_enviado_em end,
         rsvp = case v_marca when 'sim' then 'sim' when 'nao' then 'nao'
                             when 'sem_resposta' then null else rsvp end,
         atualizado_em = now()
   where id = p_id;

  return json_build_object('ok', true, 'situacao', 'ok');
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_criar_private_edit(p_stylist text, p_quando timestamp with time zone, p_local text DEFAULT NULL::text, p_praca text DEFAULT NULL::text, p_loja text DEFAULT NULL::text, p_vagas integer DEFAULT 8, p_teste boolean DEFAULT false, p_confirmar_sobreposicao boolean DEFAULT NULL::boolean)
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
  v_praca_id bigint;
  v_codigo   text;
  v_chave    text;
  v_seq      int;
  v_byte     int;
  v_prefixo  text;
  v_volta    int;
  v_indice   text;
  v_sobrepoe json;
begin
  if not public.vessel_pode('atendimentos.private-edit', 'editar') then
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
  -- ⚠️ RODADA 1 DE CONSERTO (CRÍTICO): a lista fechada `('CPS','SAO','SBO',
  -- 'BSB')` virou consulta a `vessel_pracas` — sigla existe e está `ativa`.
  -- Sem isto, ninguém marcava encontro em Limeira nem em Piracicaba pela tela.
  if v_praca is null then
    return json_build_object('ok', false, 'situacao', 'praca_invalida',
      'erro', 'Escolha uma praça.');
  end if;
  v_praca_id := public.vessel_praca_id_ativa(v_praca);
  if v_praca_id is null then
    return json_build_object('ok', false, 'situacao', 'praca_invalida',
      'erro', 'Esta praça não existe ou está desativada no cadastro.');
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

  -- ⚠️ 25/09/2026: O ENCONTRO SOBREPOSTO. Depois da fila (duas criações no
  -- mesmo dia e praça já esperam uma pela outra, e a segunda enxerga a
  -- primeira), e só quando a tela PEDE (`p_confirmar_sobreposicao` não nulo).
  -- NULL = a Central de antes: nada muda para ela.
  if p_confirmar_sobreposicao is not null then
    v_sobrepoe := public.vessel_encontros_que_sobrepoem(
                    p_quando, public.vessel_lugar_do_encontro(p_loja, v_praca, p_local), null);
    if not p_confirmar_sobreposicao and json_array_length(v_sobrepoe) > 0 then
      return json_build_object('ok', false, 'situacao', 'sobrepoe',
        'sobrepoe', v_sobrepoe, 'contexto', public.vessel_contexto_da_loja(p_quando, p_loja),
        'erro', 'Já há Private Edit neste lugar neste horário. Confira e confirme para marcar mesmo assim.');
    end if;
  end if;

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
      -- ⚠️ RODADA 1 DE CONSERTO: `praca_id` grava JUNTO com `praca` (o texto
      -- continua para a Central de hoje não quebrar) — é este dado que faltava
      -- para `ev`, no placar da edição, enxergar o encontro.
      insert into public.vessel_private_edits
        (codigo, chave, stylist_id, quando, local, praca, praca_id, loja, vagas, teste)
      values (v_codigo, v_chave, v_stylist, p_quando,
              nullif(trim(coalesce(p_local, '')), ''), v_praca, v_praca_id, p_loja, p_vagas, p_teste);
      if p_confirmar_sobreposicao and json_array_length(v_sobrepoe) > 0 then
        return json_build_object('ok', true, 'codigo', v_codigo, 'chave', v_chave, 'sobrepoe', v_sobrepoe);
      end if;
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

CREATE OR REPLACE FUNCTION public.vessel_edicao_abrir(p_id bigint)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ed       public.vessel_stylist_circle_edicoes%rowtype;
  v_conv     bigint;
  v_voltaram int := 0;
  r          record;
begin
  if not public.vessel_pode('atendimentos.edicoes', 'editar') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  select * into v_ed from public.vessel_stylist_circle_edicoes where id = p_id;
  if v_ed.id is null then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;
  if v_ed.situacao = 'encerrada' then
    return json_build_object('ok', false, 'situacao', 'edicao_encerrada');
  end if;
  if v_ed.situacao = 'aberta' then
    return json_build_object('ok', true, 'situacao', 'sem_mudanca', 'voltaram', 0);
  end if;
  if exists (select 1 from public.vessel_stylist_circle_edicoes
              where praca_id = v_ed.praca_id and situacao = 'aberta' and id <> p_id) then
    return json_build_object('ok', false, 'situacao', 'ja_tem_aberta');
  end if;
  update public.vessel_stylist_circle_edicoes set situacao = 'aberta' where id = p_id;

  select id into v_conv from public.vessel_stylist_etapas
   where ativa and tipo = 'funil' and lower(btrim(nome)) = 'convidado';
  if v_conv is not null then
    for r in
      select s.id,
             coalesce(
               (select format('Edição %s · %s', ed2.numero, p2.nome)
                  from public.vessel_stylist_na_edicao n2
                  join public.vessel_stylist_circle_edicoes ed2 on ed2.id = n2.edicao_id
                  join public.vessel_pracas p2 on p2.id = ed2.praca_id
                 where n2.stylist_id = s.id and n2.indisponivel_em is not null
                 order by n2.indisponivel_em desc, n2.id desc limit 1),
               (select format('Edição %s · %s', ed3.numero, p3.nome)
                  from public.vessel_stylist_circle_edicoes ed3
                  join public.vessel_pracas p3 on p3.id = ed3.praca_id
                 where ed3.praca_id = v_ed.praca_id and ed3.id <> p_id and ed3.numero < v_ed.numero
                 order by ed3.numero desc limit 1)) as onde
        from public.vessel_stylists s
        join public.vessel_stylist_etapas et on et.id = s.etapa_id and et.tipo = 'saida'
        cross join lateral public.vessel_stylist_saida_atual(s.id) sa
        join public.vessel_stylist_motivos_de_saida m
          on m.id = sa.motivo_id and m.etapa_id = s.etapa_id and m.volta_na_proxima_edicao
       where s.praca_id = v_ed.praca_id
         and coalesce(s.ativa, true) and not coalesce(s.teste, false)
       order by s.id
    loop
      perform set_config('vessel.nota_da_volta',
        coalesce('Voltou: indisponível na ' || r.onde, 'Voltou: indisponível na data'), true);
      update public.vessel_stylists set etapa_id = v_conv, atualizado_em = now() where id = r.id;
      perform set_config('vessel.nota_da_volta', '', true);
      perform public.vessel_edicao_marcar_movimento(r.id, v_conv, null);
      v_voltaram := v_voltaram + 1;
    end loop;
  end if;

  return json_build_object('ok', true, 'situacao', 'ok', 'voltaram', v_voltaram);
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_edicao_criar(p_praca_id bigint, p_nome text, p_comeca_em date, p_termina_em date)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_nome   text := nullif(trim(coalesce(p_nome, '')), '');
  v_numero int;
  v_id     bigint;
begin
  if not public.vessel_pode('atendimentos.edicoes', 'editar') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  if not exists (select 1 from public.vessel_pracas where id = p_praca_id) then
    return json_build_object('ok', false, 'situacao', 'praca_invalida');
  end if;
  if p_comeca_em is null then
    return json_build_object('ok', false, 'situacao', 'sem_data');
  end if;

  -- ⚠️ FILA POR PRAÇA: sem o advisory lock, duas chamadas ao mesmo tempo
  -- calculariam o mesmo "maior + 1" e colidiriam no `unique (praca_id, numero)`.
  perform pg_advisory_xact_lock(hashtext('vessel_stylist_circle_edicoes:' || p_praca_id::text));
  select coalesce(max(numero), 0) + 1 into v_numero
    from public.vessel_stylist_circle_edicoes where praca_id = p_praca_id;

  insert into public.vessel_stylist_circle_edicoes (praca_id, numero, nome, comeca_em, termina_em)
  values (p_praca_id, v_numero, v_nome, p_comeca_em, null)
  returning id into v_id;

  return json_build_object('ok', true, 'situacao', 'ok', 'id', v_id, 'numero', v_numero);
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_edicao_encerrar(p_id bigint, p_levar_para bigint)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ed public.vessel_stylist_circle_edicoes%rowtype;
begin
  if not public.vessel_pode('atendimentos.edicoes', 'editar') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  if p_levar_para is not null then
    return json_build_object('ok', false, 'situacao', 'levar_para_nao_existe_mais');
  end if;
  select * into v_ed from public.vessel_stylist_circle_edicoes where id = p_id;
  if v_ed.id is null then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;
  if v_ed.situacao = 'encerrada' then
    return json_build_object('ok', false, 'situacao', 'edicao_encerrada');
  end if;
  update public.vessel_stylist_circle_edicoes set situacao = 'encerrada' where id = p_id;
  return json_build_object('ok', true, 'situacao', 'ok');
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_edicao_incluir_stylist(p_codigo text, p_edicao_id bigint)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_codigo     text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
  v_stylist_id bigint;
  v_ed         public.vessel_stylist_circle_edicoes%rowtype;
begin
  if not (public.vessel_pode('atendimentos.edicoes', 'editar')
       or public.vessel_pode('atendimentos.stylist-circle', 'editar')) then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  select id into v_stylist_id from public.vessel_stylists where codigo = v_codigo;
  if v_stylist_id is null then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;
  select * into v_ed from public.vessel_stylist_circle_edicoes where id = p_edicao_id;
  if v_ed.id is null then
    return json_build_object('ok', false, 'situacao', 'edicao_invalida');
  end if;
  -- edição encerrada não aceita convidada nova
  if v_ed.situacao = 'encerrada' then
    return json_build_object('ok', false, 'situacao', 'edicao_encerrada');
  end if;
  if exists (select 1 from public.vessel_stylist_na_edicao
              where stylist_id = v_stylist_id and edicao_id = p_edicao_id and saiu_em is null) then
    return json_build_object('ok', true, 'situacao', 'sem_mudanca');
  end if;
  -- `do update`: uma linha antiga com `saiu_em` (do tempo da sincronização
  -- por praça) é reaberta em vez de estourar 23505 cru.
  insert into public.vessel_stylist_na_edicao (stylist_id, edicao_id, convidada_em)
  values (v_stylist_id, p_edicao_id, now())
  on conflict (stylist_id, edicao_id) do update
    set saiu_em = null, etapa_ao_sair = null,
        convidada_em = coalesce(public.vessel_stylist_na_edicao.convidada_em, now());
  return json_build_object('ok', true, 'situacao', 'ok');
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_edicao_marcar_movimento(p_stylist_id bigint, p_etapa_id bigint, p_motivo_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_conv int;
  v_conf int;
  v_pres int;
  v_e    public.vessel_stylist_etapas%rowtype;
  v_ed   bigint;
begin
  select max(ordem) filter (where lower(btrim(nome)) = 'convidado'),
         max(ordem) filter (where lower(btrim(nome)) = 'confirmado'),
         max(ordem) filter (where lower(btrim(nome)) = 'presença')
    into v_conv, v_conf, v_pres
    from public.vessel_stylist_etapas where ativa and tipo = 'funil';
  if v_conv is null or v_conf is null or v_pres is null then
    return;
  end if;
  select * into v_e from public.vessel_stylist_etapas where id = p_etapa_id;
  if v_e.id is null then
    return;
  end if;
  select ed.id into v_ed
    from public.vessel_stylist_circle_edicoes ed
    join public.vessel_stylists s on s.praca_id = ed.praca_id
   where s.id = p_stylist_id and ed.situacao = 'aberta'
   order by ed.id limit 1;
  if v_ed is null then
    return;
  end if;

  if v_e.tipo = 'funil' and v_e.ordem >= v_conv then
    -- entra na turma com o MESMO critério de sempre (ativa, não-teste)
    insert into public.vessel_stylist_na_edicao (stylist_id, edicao_id, convidada_em)
    select p_stylist_id, v_ed, now()
     where exists (select 1 from public.vessel_stylists s
                    where s.id = p_stylist_id and coalesce(s.ativa, true) and not coalesce(s.teste, false))
    on conflict (stylist_id, edicao_id) do nothing;
    update public.vessel_stylist_na_edicao n
       set convidada_em = coalesce(n.convidada_em, now()),
           confirmou_em = case when v_e.ordem >= v_conf then coalesce(n.confirmou_em, now()) else n.confirmou_em end,
           presente_em  = case when v_e.ordem >= v_pres then coalesce(n.presente_em, now()) else n.presente_em end
     where n.stylist_id = p_stylist_id and n.edicao_id = v_ed;
  elsif v_e.tipo = 'saida' and exists (select 1 from public.vessel_stylist_motivos_de_saida m
                                        where m.id = p_motivo_id and m.etapa_id = p_etapa_id
                                          and m.volta_na_proxima_edicao) then
    update public.vessel_stylist_na_edicao n
       set indisponivel_em = coalesce(n.indisponivel_em, now())
     where n.stylist_id = p_stylist_id and n.edicao_id = v_ed;
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_edicao_tirar_stylist(p_codigo text, p_edicao_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_codigo     text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
  v_stylist_id bigint;
  v_linha      public.vessel_stylist_na_edicao%rowtype;
begin
  if not (public.vessel_pode('atendimentos.edicoes', 'editar')
       or public.vessel_pode('atendimentos.stylist-circle', 'editar')) then
    return jsonb_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  select id into v_stylist_id from public.vessel_stylists where codigo = v_codigo;
  if v_stylist_id is null then
    return jsonb_build_object('ok', false, 'situacao', 'nao_achei');
  end if;
  if not exists (select 1 from public.vessel_stylist_circle_edicoes where id = p_edicao_id) then
    return jsonb_build_object('ok', false, 'situacao', 'edicao_invalida');
  end if;
  select * into v_linha from public.vessel_stylist_na_edicao
   where stylist_id = v_stylist_id and edicao_id = p_edicao_id;
  if v_linha.id is null then
    return jsonb_build_object('ok', true, 'situacao', 'sem_mudanca');
  end if;
  if v_linha.presente_em is not null then
    return jsonb_build_object('ok', false, 'situacao', 'ja_esteve_presente');
  end if;
  delete from public.vessel_stylist_na_edicao where id = v_linha.id;
  return jsonb_build_object('ok', true, 'situacao', 'ok');
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_edicao_turma(p_edicao_id bigint)
 RETURNS TABLE(stylist_id bigint, codigo text, nome text, etapa_id bigint, convidada_em timestamp with time zone, confirmou_em timestamp with time zone, presente_em timestamp with time zone, indisponivel_em timestamp with time zone, origem bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not (public.vessel_pode('atendimentos.edicoes', 'ver')
       or public.vessel_pode('atendimentos.stylist-circle', 'ver')) then
    raise exception 'sem permissao' using errcode = '42501';
  end if;
  return query
    select s.id, s.codigo::text, s.nome::text, s.etapa_id,
           n.convidada_em, n.confirmou_em, n.presente_em, n.indisponivel_em,
           public.vessel_evento_de_origem(s.id)
      from public.vessel_stylist_na_edicao n
      join public.vessel_stylists s on s.id = n.stylist_id
     where n.edicao_id = p_edicao_id
       and not coalesce(s.teste, false) and coalesce(s.ativa, true)
     order by n.convidada_em nulls last, s.nome;
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_edicoes_listar(p_praca_id bigint)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not (public.vessel_pode('atendimentos.pracas', 'ver')
       or public.vessel_pode('atendimentos.edicoes', 'ver')
       or public.vessel_pode('atendimentos.stylist-circle', 'ver')
       or public.vessel_pode('atendimentos.private-edit', 'ver')) then
    raise exception 'sem permissao' using errcode = '42501';
  end if;
  return coalesce((
    select json_agg(json_build_object(
             'id', e.id, 'praca_id', e.praca_id, 'praca_nome', p.nome, 'numero', e.numero,
             'nome', e.nome, 'comeca_em', e.comeca_em, 'termina_em', e.termina_em, 'situacao', e.situacao,
             'stylists', (select count(*)::int from public.vessel_stylist_na_edicao n
                           join public.vessel_stylists s on s.id = n.stylist_id
                           where n.edicao_id = e.id and not coalesce(s.teste, false)
                             and coalesce(s.ativa, true)),
             'indisponiveis', (select count(*)::int from public.vessel_stylist_na_edicao n
                           join public.vessel_stylists s on s.id = n.stylist_id
                           where n.edicao_id = e.id and not coalesce(s.teste, false)
                             and coalesce(s.ativa, true) and n.indisponivel_em is not null),
             'nao_ativadas', (select count(*)::int from public.vessel_stylist_na_edicao n
                           join public.vessel_stylists s on s.id = n.stylist_id
                           where n.edicao_id = e.id and n.saiu_em is null
                             and public.vessel_stylist_ativada_em(s.id) is null
                             and not coalesce(s.teste, false)))
           order by p.ordem, e.numero desc)
      from public.vessel_stylist_circle_edicoes e join public.vessel_pracas p on p.id = e.praca_id
     where p_praca_id is null or e.praca_id = p_praca_id), '[]'::json);
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_email_canonico(p text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case
    when length(e) between 6 and 254 and e ~ '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$' then e
  end
  from (select lower(trim(coalesce(p, ''))) as e) x
$function$;

CREATE OR REPLACE FUNCTION public.vessel_encontros_que_sobrepoem(p_quando timestamp with time zone, p_lugar text, p_ignorar_codigo text)
 RETURNS json
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(json_agg(json_build_object(
           'codigo', e.codigo,
           'stylist', s.codigo,
           'anfitria', s.nome,
           'inicio', e.quando,
           'fim', e.quando + public.vessel_private_edit_duracao(),
           'dia', to_char(e.quando at time zone 'America/Sao_Paulo', 'YYYY-MM-DD'),
           'hora', to_char(e.quando at time zone 'America/Sao_Paulo', 'HH24:MI'),
           'hora_fim', to_char((e.quando + public.vessel_private_edit_duracao()) at time zone 'America/Sao_Paulo', 'HH24:MI'),
           'loja', e.loja, 'praca', e.praca, 'local', e.local, 'status', e.status)
         order by e.quando, e.codigo), '[]'::json)
    from public.vessel_private_edits e
    left join public.vessel_stylists s on s.id = e.stylist_id
   where p_quando is not null
     and not coalesce(e.teste, false)
     and not coalesce(e.arquivada, false)
     and coalesce(e.status, 'agendado') not in ('cancelado', 'nao_realizado')
     and e.codigo is distinct from upper(nullif(trim(coalesce(p_ignorar_codigo, '')), ''))
     and public.vessel_lugar_do_encontro(e.loja, e.praca, e.local) = p_lugar
     -- [a, a+4h) cruza [b, b+4h) ⇔ a < b+4h e b < a+4h (o "encosta" não cruza)
     and e.quando < p_quando + public.vessel_private_edit_duracao()
     and p_quando < e.quando + public.vessel_private_edit_duracao()
$function$;

CREATE OR REPLACE FUNCTION public.vessel_etapa_conta_como_prospectada(p_etapa bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select coalesce((
    select e.tipo = 'funil' and e.ordem >= m.ordem
      from public.vessel_stylist_etapas e
      cross join (select ordem from public.vessel_stylist_etapas
                   where conta_como_prospectada and ativa limit 1) m
     where e.id = p_etapa), false)
$function$;

CREATE OR REPLACE FUNCTION public.vessel_etapas_que_liberam_private_edit()
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select string_agg(e.nome, ', ' order by e.ordem, e.id)
    from public.vessel_stylist_etapas e where e.ativa and e.libera_private_edit
$function$;

CREATE OR REPLACE FUNCTION public.vessel_evento_de_origem(p_stylist_id bigint)
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select n.edicao_id from public.vessel_stylist_na_edicao n
   where n.stylist_id = p_stylist_id and n.presente_em is not null
   order by n.presente_em, n.edicao_id limit 1
$function$;

CREATE OR REPLACE FUNCTION public.vessel_eventos_de_origem()
 RETURNS TABLE(stylist_id bigint, codigo text, edicao_id bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not (public.vessel_pode('atendimentos.private-edit', 'ver')
       or public.vessel_pode('atendimentos.stylist-circle', 'ver')
       or public.vessel_pode('atendimentos.edicoes', 'ver')) then
    raise exception 'sem permissao' using errcode = '42501';
  end if;
  return query
    select p.sid, s.codigo::text, public.vessel_evento_de_origem(p.sid)
      from (select distinct n.stylist_id as sid from public.vessel_stylist_na_edicao n
             where n.presente_em is not null) p
      join public.vessel_stylists s on s.id = p.sid;
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_instagram_canonico(p_bruto text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select case when h ~ '^[a-z0-9._]{1,30}$' then h end
    from (select regexp_replace(
                   regexp_replace(
                     regexp_replace(lower(btrim(coalesce(p_bruto, ''))),
                                    '^(https?://)?(www\.)?instagram\.com/', ''),
                     '[/?#].*$', ''),
                   '^@', '') as h) x
$function$;

CREATE OR REPLACE FUNCTION public.vessel_leads_da_beauty_session(p_codigo text, p_dias integer DEFAULT 7)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_codigo text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
  v_dias   int := greatest(coalesce(p_dias, 7), 0);
  v_saida  json;
begin
  -- ⚠️ DADO PESSOAL (nome e WhatsApp), atrás da mesma trava de ver da conta.
  -- E RECUSA com erro, não com lista vazia: "ninguém se identificou" e "você
  -- não pode ver" decidem coisas opostas na tela.
  if not public.vessel_pode('atendimentos.beauty-sessions', 'ver') then
    raise exception 'sem permissao' using errcode = '42501';
  end if;

  select coalesce(json_agg(linha order by (linha ->> 'entrou_em') desc, (linha ->> 'pessoa_id')::bigint desc),
                  '[]'::json)
    into v_saida
    from (
      select json_build_object(
        'pessoa_id',  pe.id,
        'nome',       pe.nome,
        'telefone',   pe.telefone,
        'instagram',  pe.instagram,
        -- ⚠️ A PORTA É A LINHA DA EQUIPE, não o `utm_medium` (ver o cabeçalho).
        'porta',      case when c.id is not null then 'equipe' else 'qr' end,
        'entrou_em',  o.primeira,
        'cadastrado_por_nome', c.cadastrado_por_nome,
        -- ⚠️ "FOI À LOJA" E "COMPROU" SÃO AS MESMAS RÉGUAS DOS NÚMEROS DO
        -- CARTÃO (`compareceram` e `receita` de `vessel_conta_das_beauty_sessions`),
        -- para a lista e o número ao lado nunca discordarem.
        'foi_a_loja', exists (select 1 from public.vessel_atendimentos t
                               where t.pessoa_id = pe.id and not coalesce(t.teste, false)
                                 and t.status = 'realizado'),
        'comprou',    exists (select 1 from public.vessel_pedidos p
                               where p.pessoa_id = pe.id
                                 and exists (select 1 from public.vessel_atendimentos t
                                              where t.pessoa_id = p.pessoa_id
                                                and not coalesce(t.teste, false)
                                                and t.status = 'realizado'
                                                and p.data_do_pedido
                                                      between (coalesce(t.quando, t.criado_em)
                                                                at time zone 'America/Sao_Paulo')::date
                                                          and (coalesce(t.quando, t.criado_em)
                                                                at time zone 'America/Sao_Paulo')::date
                                                              + v_dias))
      ) as linha
      from (select o.pessoa_id, min(o.momento) as primeira
              from public.vessel_origens o
             where o.evento_id = v_codigo
             group by o.pessoa_id) o
      join public.vessel_pessoas pe on pe.id = o.pessoa_id
      left join public.vessel_beauty_session_cadastros c
             on c.codigo = v_codigo and c.pessoa_id = pe.id
     where not coalesce(pe.teste, false)
    ) as linhas;

  return v_saida;
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_lugar_do_encontro(p_loja text, p_praca text, p_local text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(
    nullif(lower(trim(coalesce(p_loja, ''))), ''),
    'praca:' || upper(trim(coalesce(p_praca, ''))) || '|'
             || lower(regexp_replace(trim(coalesce(p_local, '')), '\s+', ' ', 'g')))
$function$;

CREATE OR REPLACE FUNCTION public.vessel_motivo_de_saida_nao_se_apaga()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  raise exception 'motivo de saida nao se apaga: desative (o historico aponta para ele)'
    using errcode = '42501';
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_numeros_do_stylist_circle(p_de date, p_ate date, p_dias integer, p_stylist bigint)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_de   date := coalesce(p_de, date '2000-01-01');
  -- ⚠️ SEM FIM ESCOLHIDO, O FIM É NENHUM — e não "hoje" (T11).
  v_ate  date := coalesce(p_ate, 'infinity'::date);
  v_dias int  := greatest(coalesce(p_dias, 14), 0);
  v_saida json;
begin
  with
  sty0 as (select s.*, public.vessel_stylist_ativada_em(s.id) as ativou
             from public.vessel_stylists s
            where not coalesce(s.teste, false)
              and (p_stylist is null or s.id = p_stylist)),
  -- ⚠️ 24/09/2026: `dia_ativou` é a ATIVAÇÃO (a etapa que libera Private
  -- Edit); `dia_agendou` é o primeiro Private Edit agendado (o "ativada" de
  -- antes). `por_encontro_antigo`: ativou pelo encontro, sem nunca ter passado
  -- por uma etapa liberadora (a turma de antes da regra).
  sty as (select s.*,
                 (s.ativou at time zone 'America/Sao_Paulo')::date as dia_ativou,
                 (s.ativada_em at time zone 'America/Sao_Paulo')::date as dia_agendou,
                 not exists (select 1 from public.vessel_stylist_etapas_historico h
                              where h.stylist_id = s.id and h.liberava_private_edit)
                   and s.ativada_em is not null as por_encontro_antigo
            from sty0 s),
  ev as (
    select e.*, (e.quando at time zone 'America/Sao_Paulo')::date as dia
      from public.vessel_private_edits e
     where not coalesce(e.teste, false) and not coalesce(e.arquivada, false)
       and e.stylist_id in (select id from sty)
  ),
  ev_p as (select * from ev where dia between v_de and v_ate),
  conv as (
    select t.id, t.pessoa_id, t.status, e.codigo, e.status as status_do_encontro,
           public.vessel_situacao_do_convite(t.status, t.rsvp, t.convite_enviado_em,
                                             e.quando, e.status) as situacao
      from public.vessel_atendimentos t
      join ev_p e on e.codigo = t.evento_codigo
     where not coalesce(t.teste, false)
  ),
  vendas as (
    select v.* from public.vessel_vendas_dos_encontros(v_dias) v
     where v.evento_codigo in (select codigo from ev_p)
  ),
  realizados as (
    select e.stylist_id, e.realizado_em,
           row_number() over (partition by e.stylist_id order by e.realizado_em, e.id) as n,
           e.realizado_em - lag(e.realizado_em) over (partition by e.stylist_id
                                                      order by e.realizado_em, e.id) as intervalo
      from ev e where e.status = 'realizado'
  ),
  -- A TURMA da prospecção, passo a passo, cada passo DENTRO do anterior (as
  -- taxas nunca passam de 100%): prospectada no período → ativou até o fim →
  -- teve Private Edit agendado até o fim → realizado → recorrente.
  turma as (
    select s.id,
           s.dia_ativou <= v_ate as ativou,
           s.dia_ativou <= v_ate and s.dia_agendou <= v_ate as agendou,
           s.dia_ativou <= v_ate and s.dia_agendou <= v_ate
             and exists (select 1 from realizados r where r.stylist_id = s.id and r.n = 1 and r.realizado_em <= v_ate) as realizou,
           s.dia_ativou <= v_ate and s.dia_agendou <= v_ate
             and exists (select 1 from realizados r where r.stylist_id = s.id and r.n = 2 and r.realizado_em <= v_ate) as repetiu
      from sty s where s.prospectado_em between v_de and v_ate
  )
  select json_build_object(
    'de', p_de, 'ate', p_ate, 'janela_de_venda_em_dias', v_dias,
    'prospectadas', (select count(*)::int from sty where prospectado_em between v_de and v_ate),
    'ativadas', (select count(*)::int from sty where dia_ativou between v_de and v_ate),
    'prospectadas_ja_ativadas', (select count(*)::int from turma where coalesce(ativou, false)),
    -- ⚠️ 24/09/2026: os números de antes, com o nome do que eles contam.
    'com_private_edit_agendado', (select count(*)::int from sty where dia_agendou between v_de and v_ate),
    'com_private_edit_realizado', (select count(distinct stylist_id)::int from realizados
                                    where n = 1 and realizado_em between v_de and v_ate),
    'prospectadas_com_private_edit_agendado', (select count(*)::int from turma where coalesce(agendou, false)),
    'prospectadas_com_private_edit_realizado', (select count(*)::int from turma where coalesce(realizou, false)),
    'prospectadas_recorrentes', (select count(*)::int from turma where coalesce(repetiu, false)),
    'ativadas_por_encontro_antigo', (select count(*)::int from sty
                                      where por_encontro_antigo and dia_ativou between v_de and v_ate),
    'encontros_agendados', (select count(*)::int from ev_p where status <> 'em_planejamento'),
    'encontros_realizados', (select count(*)::int from ev_p where status = 'realizado'),
    'encontros_cancelados', (select count(*)::int from ev_p
                              where status in ('cancelado', 'nao_realizado')),
    'convidadas', (select count(*)::int from conv),
    'confirmadas', (select count(*)::int from conv
                     where situacao in ('confirmada', 'presente', 'nao_compareceu')),
    'confirmadas_em_realizados', (select count(*)::int from conv
                     where situacao in ('confirmada', 'presente', 'nao_compareceu')
                       and status_do_encontro = 'realizado'),
    'presentes', (select count(*)::int from conv where status = 'realizado'),
    'presentes_em_realizados', (select count(*)::int from conv
                     where status = 'realizado' and status_do_encontro = 'realizado'),
    'recorrentes_no_periodo', (select count(*)::int from realizados
                                where n = 2 and realizado_em between v_de and v_ate),
    'recorrentes_ate_o_fim', (select count(distinct stylist_id)::int from realizados
                               where n = 2 and realizado_em <= v_ate),
    'ativadas_ate_o_fim', (select count(*)::int from sty where dia_ativou <= v_ate),
    'intervalos', (select count(*)::int from realizados
                    where intervalo is not null and realizado_em between v_de and v_ate),
    'intervalo_medio_em_dias', (select round(avg(intervalo)::numeric, 1) from realizados
                                 where intervalo is not null and realizado_em between v_de and v_ate),
    'contatos_ate_ativar', (select round(avg(n)::numeric, 1) from (
        select (select count(*) from public.vessel_stylist_contatos c
                 where c.stylist_id = s.id and c.criado_em < s.ativou) as n
          from sty s where s.dia_ativou between v_de and v_ate) x),
    'stylists_com_contatos_ate_ativar', (select count(*)::int from sty s
        where s.dia_ativou between v_de and v_ate),
    'compradoras', (select count(distinct v.pessoa_id)::int from vendas v),
    'vendas', (select count(*)::int from vendas),
    'pecas', (select coalesce(sum(pecas), 0) from vendas),
    'receita', (select coalesce(sum(receita), 0) from vendas),
    'por_stylist', (
      select coalesce(json_agg(json_build_object(
               'codigo', s.codigo, 'nome', s.nome,
               'encontros_realizados', (select count(*)::int from ev_p e
                                         where e.stylist_id = s.id and e.status = 'realizado'),
               'vendas', (select count(*)::int from vendas v where v.stylist_id = s.id),
               'receita', (select coalesce(sum(v.receita), 0) from vendas v where v.stylist_id = s.id))
             order by s.codigo), '[]'::json)
        from sty s
       where exists (select 1 from ev_p e where e.stylist_id = s.id))
  ) into v_saida;

  return v_saida;
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_pessoa_por_telefone(p_nome text, p_telefone text, p_email text DEFAULT NULL::text, p_cidade text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tel text := public.vessel_telefone_canonico(p_telefone);
  v_id  bigint;
begin
  if v_tel is null then
    return null;
  end if;
  select id into v_id from public.vessel_pessoas where telefone = v_tel;
  if v_id is not null then
    -- Completa o que estiver faltando, sem apagar o que ja existe.
    update public.vessel_pessoas
       set email  = coalesce(nullif(trim(p_email), ''), email),
           cidade = coalesce(nullif(trim(p_cidade), ''), cidade)
     where id = v_id;
    return v_id;
  end if;
  insert into public.vessel_pessoas (nome, telefone, email, cidade)
  values (trim(p_nome), v_tel, nullif(lower(trim(p_email)), ''), nullif(trim(p_cidade), ''))
  returning id into v_id;
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_placar_da_edicao(p_edicao_id bigint)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ed    public.vessel_stylist_circle_edicoes%rowtype;
  v_saida json;
begin
  if not public.vessel_pode('atendimentos.stylist-circle', 'ver') then
    raise exception 'sem permissao' using errcode = '42501';
  end if;

  select * into v_ed from public.vessel_stylist_circle_edicoes where id = p_edicao_id;
  if v_ed.id is null then
    raise exception 'edicao nao encontrada' using errcode = 'P0002';
  end if;

  with
  -- a turma do evento: as linhas da edição (o `saiu_em` da sincronização por
  -- praça não recorta mais nada — a turma é de quem foi convidada).
  linhas as (
    select n.stylist_id, n.confirmou_em, n.presente_em, n.indisponivel_em
      from public.vessel_stylist_na_edicao n
     where n.edicao_id = p_edicao_id
  ),
  -- mesmo filtro das irmãs (`teste`, `ativa`) — o placar fecha com a lista.
  sty as (
    select s.*, public.vessel_stylist_ativada_em(s.id) as ativou,
           l.confirmou_em as ev_confirmou_em, l.presente_em as ev_presente_em,
           l.indisponivel_em as ev_indisponivel_em,
           public.vessel_evento_de_origem(s.id) as origem
      from public.vessel_stylists s
      join linhas l on l.stylist_id = s.id
     where not coalesce(s.teste, false)
       and coalesce(s.ativa, true)
  ),
  -- ⚠️ QUEM É DESTE EVENTO: presente aqui E com a origem aqui. É daqui que
  -- saem os Private Edits do placar (em qualquer data e praça).
  daqui as (
    select s.id from sty s where s.ev_presente_em is not null and s.origem = p_edicao_id
  ),
  ev as (
    select e.*
      from public.vessel_private_edits e
     where not coalesce(e.teste, false) and not coalesce(e.arquivada, false)
       and e.stylist_id in (select id from daqui)
  ),
  -- os convites são os dos encontros deste evento (herdam o recorte de `ev`).
  conv as (
    select t.id, t.pessoa_id, t.status, e.codigo, e.status as status_do_encontro,
           public.vessel_situacao_do_convite(t.status, t.rsvp, t.convite_enviado_em,
                                             e.quando, e.status) as situacao
      from public.vessel_atendimentos t
      join ev e on e.codigo = t.evento_codigo
     where not coalesce(t.teste, false)
  ),
  -- o 1º e o 2º encontro realizado de cada stylist deste evento, em qualquer data.
  realizados as (
    select e.stylist_id, e.realizado_em,
           row_number() over (partition by e.stylist_id order by e.realizado_em, e.id) as n,
           e.realizado_em - lag(e.realizado_em) over (partition by e.stylist_id
                                                      order by e.realizado_em, e.id) as intervalo
      from ev e
     where e.status = 'realizado'
  ),
  turma as (
    select s.id,
           (s.ativou is not null) as ativou,
           exists (select 1 from ev e where e.stylist_id = s.id and e.status <> 'em_planejamento') as agendou,
           exists (select 1 from realizados r where r.stylist_id = s.id and r.n = 1) as realizou,
           exists (select 1 from realizados r where r.stylist_id = s.id and r.n = 2) as repetiu
      from sty s
  ),
  -- O FUNIL DO EVENTO — as contas de `funilDoEvento`: cada passo sobre o
  -- anterior (o 1º sem %), % arredondada, nula quando a base é 0.
  contas as (
    select * from (values
      (1, 'convidadas',  'Convidadas',             (select count(*)::int from sty)),
      (2, 'confirmaram', 'Confirmaram',            (select count(*)::int from sty
                                                      where ev_confirmou_em is not null or ev_presente_em is not null)),
      (3, 'presentes',   'Presentes',              (select count(*)::int from sty where ev_presente_em is not null)),
      (4, 'agendaram',   'Agendaram Private Edit', (select count(*)::int from turma where agendou and id in (select id from daqui))),
      (5, 'fizeram',     'Fizeram',                (select count(*)::int from turma where realizou and id in (select id from daqui))),
      (6, 'repetiram',   'Repetiram',              (select count(*)::int from turma where repetiu and id in (select id from daqui)))
    ) v(i, chave, rotulo, n)
  ),
  passos as (
    select i, chave, rotulo, n,
           case when i = 1 then null
                when lag(n) over (order by i) > 0 then round(n * 100.0 / lag(n) over (order by i))::int
           end as pct
      from contas
  ),
  -- a META do Growth Plan: agendaram sobre PRESENTES ≥ 50%; sem presentes, nula ("—").
  meta as (
    select case when p.n > 0 then round(a.n * 100.0 / p.n)::int end as pct
      from contas p, contas a where p.chave = 'presentes' and a.chave = 'agendaram'
  )
  select json_build_object(
    'edicao', json_build_object(
      'id', v_ed.id, 'praca_id', v_ed.praca_id, 'numero', v_ed.numero, 'nome', v_ed.nome,
      'comeca_em', v_ed.comeca_em, 'termina_em', v_ed.termina_em, 'situacao', v_ed.situacao),
    'funil', (select json_agg(json_build_object('chave', chave, 'rotulo', rotulo, 'n', n, 'pct', pct) order by i) from passos),
    'indisponiveis', (select count(*)::int from sty where ev_indisponivel_em is not null),
    'meta', (select json_build_object('pct', pct, 'bateu', case when pct is null then null else pct >= 50 end) from meta),
    'etapas', (select coalesce(json_agg(json_build_object(
                 'id', et.id, 'nome', et.nome, 'ordem', et.ordem, 'tipo', et.tipo,
                 'stylists', (select count(*)::int from sty s where s.etapa_id = et.id))
               order by et.ordem), '[]'::json)
               from public.vessel_stylist_etapas et where et.ativa),
    'prospectadas', (select count(*)::int from sty),
    'prospectadas_ja_ativadas', (select count(*)::int from turma where ativou),
    'ativadas', (select count(*)::int from turma where ativou),
    'com_private_edit_agendado', (select count(*)::int from turma where agendou),
    'com_private_edit_realizado', (select count(*)::int from turma where realizou),
    'recorrentes_no_periodo', (select count(*)::int from realizados where n = 2),
    'encontros_agendados', (select count(*)::int from ev where status <> 'em_planejamento'),
    'encontros_realizados', (select count(*)::int from ev where status = 'realizado'),
    'encontros_cancelados', (select count(*)::int from ev where status in ('cancelado', 'nao_realizado')),
    'convidadas', (select count(*)::int from conv),
    'confirmadas', (select count(*)::int from conv
                     where situacao in ('confirmada', 'presente', 'nao_compareceu')),
    'confirmadas_em_realizados', (select count(*)::int from conv
                     where situacao in ('confirmada', 'presente', 'nao_compareceu')
                       and status_do_encontro = 'realizado'),
    'presentes', (select count(*)::int from conv where status = 'realizado'),
    'presentes_em_realizados', (select count(*)::int from conv
                     where status = 'realizado' and status_do_encontro = 'realizado'),
    'intervalos', (select count(*)::int from realizados where intervalo is not null),
    'intervalo_medio_em_dias', (select round(avg(intervalo)::numeric, 1) from realizados
                                 where intervalo is not null),
    'contatos_ate_ativar', (select round(avg(n)::numeric, 1) from (
        select (select count(*) from public.vessel_stylist_contatos c
                 where c.stylist_id = s.id and c.criado_em < s.ativou) as n
          from sty s where s.ativou is not null) x),
    'stylists_com_contatos_ate_ativar', (select count(*)::int from sty s where s.ativou is not null)
  ) into v_saida;

  return v_saida;
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_pode(p_ferramenta text, p_nivel text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- A LISTA FECHADA: as chaves do Comercial Vessel no catálogo que têm tela
  -- chamando o banco, e os dois níveis que o catálogo oferece a elas.
  if p_ferramenta is null or p_ferramenta not in (
       'atendimentos', 'atendimentos.beauty-sessions', 'atendimentos.private-edit',
       'atendimentos.stylist-circle', 'atendimentos.material-grafico',
       'atendimentos.pracas', 'atendimentos.edicoes') then
    raise exception 'vessel_pode: ferramenta desconhecida (%)', p_ferramenta using errcode = '22023';
  end if;
  if p_nivel is null or p_nivel not in ('ver', 'editar') then
    raise exception 'vessel_pode: nivel desconhecido (%)', p_nivel using errcode = '22023';
  end if;
  if p_ferramenta = 'atendimentos.material-grafico' and p_nivel <> 'ver' then
    raise exception 'vessel_pode: o Material Grafico so tem ver' using errcode = '22023';
  end if;
  -- ⚠️ A ARMADILHA DO NULO: o `coalesce` envolve a subconsulta INTEIRA.
  return public.conta_ativa() and coalesce(
    (select coalesce(p.is_superadmin, false)
         or (jsonb_typeof(p.permissions) = 'object'
             and jsonb_typeof(p.permissions -> p_ferramenta) = 'array'
             and (p.permissions -> p_ferramenta) ? 'ver'
             and (p_nivel = 'ver' or (p.permissions -> p_ferramenta) ? p_nivel))
       from public.profiles p where p.id = auth.uid()),
    false);
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_praca_cidade_desvincular(p_id bigint)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.vessel_pode('atendimentos.pracas', 'editar') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  if not exists (select 1 from public.vessel_praca_cidades where id = p_id) then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;
  delete from public.vessel_praca_cidades where id = p_id;
  return json_build_object('ok', true, 'situacao', 'ok');
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_praca_cidade_vincular(p_praca_id bigint, p_cidade text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_cidade text := nullif(trim(coalesce(p_cidade, '')), '');
  v_chave  text;
  v_dono   record;
  v_id     bigint;
  -- ⚠️ REVISÃO FINAL (IMPORTANTE 6): a ADOÇÃO — ver o bloco no fim.
  v_situacao text;
  v_stylist  bigint;
  v_adotadas int := 0;
begin
  if not public.vessel_pode('atendimentos.pracas', 'editar') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  if not exists (select 1 from public.vessel_pracas where id = p_praca_id) then
    return json_build_object('ok', false, 'situacao', 'praca_invalida');
  end if;
  if v_cidade is null then
    return json_build_object('ok', false, 'situacao', 'sem_cidade');
  end if;
  -- ⚠️ A MESMA CONTA DO FRONT (achatarCidade em praca-regras.js) — nunca a
  -- chave digitada à mão (ver o cabeçalho desta migration).
  v_chave := public.vessel_achatar_cidade(v_cidade);
  if v_chave = '' then
    return json_build_object('ok', false, 'situacao', 'sem_cidade');
  end if;

  select c.id, c.praca_id, p.nome as praca_nome
    into v_dono
    from public.vessel_praca_cidades c join public.vessel_pracas p on p.id = c.praca_id
   where c.cidade_chave = v_chave;

  if v_dono.id is not null and v_dono.praca_id <> p_praca_id then
    return json_build_object('ok', false, 'situacao', 'cidade_em_outra_praca',
      'praca_id', v_dono.praca_id, 'praca_nome', v_dono.praca_nome);
  end if;
  if v_dono.id is not null then
    v_id := v_dono.id;
    v_situacao := 'ja_vinculada';
  else
    insert into public.vessel_praca_cidades (praca_id, cidade, cidade_chave)
    values (p_praca_id, v_cidade, v_chave)
    returning id into v_id;
    v_situacao := 'ok';
  end if;

  -- ⚠️ REVISÃO FINAL (IMPORTANTE 6): A ADOÇÃO. Até aqui vincular a cidade
  -- criava SÓ a linha do cadastro e não movia ninguém — a pendência "N
  -- stylists sem praça", que a barra mostra nas duas telas grandes, NÃO SE
  -- RESOLVIA pelo cadastro de Praças. O backfill da seção 8 roda uma vez só,
  -- e `vessel_stylist_definir_praca` não tem chamador em tela nenhuma: quem
  -- estava sem praça ficava sem praça para sempre, e a única saída era abrir
  -- a ficha de uma em uma.
  --
  -- O critério é O MAIS ESTREITO QUE RESOLVE: só quem está SEM PRAÇA
  -- (`praca_id is null`) e cuja cidade casa com A CIDADE QUE ACABOU DE SER
  -- VINCULADA, pela MESMA chave achatada (`vessel_achatar_cidade`) do resto
  -- do arquivo. Ninguém TROCA de praça por aqui — vincular "Campinas" à
  -- praça X não arrasta quem já está em CPS. Stylist de teste fica de fora,
  -- pelo critério único da casa.
  --
  -- Rodar de novo com a cidade JÁ vinculada (`ja_vinculada`) também adota —
  -- é de propósito: é o botão que o dono aperta quando a pendência reaparece,
  -- e uma ação que "não faz nada da segunda vez" seria uma pegadinha.
  --
  -- ⚠️ `adotadas` VOLTA NA RESPOSTA: número que a tela escreve ("3 stylists
  -- de Limeira passaram a ser desta praça"). Movimento calado em dado de
  -- gente é o que esta migration inteira existe para acabar.
  for v_stylist in
    select s.id from public.vessel_stylists s
     where s.praca_id is null
       and not coalesce(s.teste, false)
       and public.vessel_achatar_cidade(s.cidade) = v_chave
  loop
    update public.vessel_stylists set praca_id = p_praca_id, atualizado_em = now() where id = v_stylist;
    -- e entra na edição ABERTA da praça, pela MESMA função das outras portas.
    -- `p_fechar_antigo` fica `false`: quem estava SEM praça não tem vínculo
    -- "da praça antiga" para fechar — e uma inclusão feita à mão numa edição
    -- qualquer não pode ser desfeita por um cadastro de cidade.
    perform public.vessel_stylist_sincronizar_edicao(v_stylist, p_praca_id, false);
    v_adotadas := v_adotadas + 1;
  end loop;

  return json_build_object('ok', true, 'situacao', v_situacao, 'id', v_id, 'adotadas', v_adotadas);
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_praca_criar(p_sigla text, p_nome text, p_loja_destino text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_sigla text := upper(nullif(trim(coalesce(p_sigla, '')), ''));
  v_nome  text := nullif(trim(coalesce(p_nome, '')), '');
  v_loja  text := nullif(trim(coalesce(p_loja_destino, '')), '');
  v_ordem int;
  v_id    bigint;
begin
  if not public.vessel_pode('atendimentos.pracas', 'editar') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  if v_nome is null then
    return json_build_object('ok', false, 'situacao', 'sem_nome');
  end if;
  if v_sigla is null or v_sigla !~ '^[A-Z]{3}$' then
    return json_build_object('ok', false, 'situacao', 'sigla_invalida');
  end if;
  -- ⚠️ É ESTA CONFERÊNCIA QUE PROTEGE A `unique` DA TABELA: sem ela o defeito
  -- apareceria como erro cru de banco (23505), não como `situacao` na tela.
  if exists (select 1 from public.vessel_pracas where sigla = v_sigla) then
    return json_build_object('ok', false, 'situacao', 'sigla_repetida');
  end if;
  select coalesce(max(ordem), 0) + 1 into v_ordem from public.vessel_pracas;
  insert into public.vessel_pracas (sigla, nome, loja_destino, ordem)
  values (v_sigla, v_nome, v_loja, v_ordem)
  returning id into v_id;
  return json_build_object('ok', true, 'situacao', 'ok', 'id', v_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_praca_editar(p_id bigint, p_nome text, p_loja_destino text, p_ativa boolean)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_nome text := nullif(trim(coalesce(p_nome, '')), '');
  v_loja text := nullif(trim(coalesce(p_loja_destino, '')), '');
begin
  if not public.vessel_pode('atendimentos.pracas', 'editar') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  if not exists (select 1 from public.vessel_pracas where id = p_id) then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;
  if v_nome is null then
    return json_build_object('ok', false, 'situacao', 'sem_nome');
  end if;
  -- ⚠️ RODADA 1 DE CONSERTO: `loja_destino` e `ativa` usam a MESMA semântica de
  -- nulo — PRESERVA o que já estava (a tela manda um salvamento parcial e não
  -- pode apagar a loja de tabela sem querer). Limpar a loja é outra ação, que
  -- ainda não existe.
  update public.vessel_pracas
     set nome = v_nome, loja_destino = coalesce(v_loja, loja_destino), ativa = coalesce(p_ativa, ativa)
   where id = p_id;
  return json_build_object('ok', true, 'situacao', 'ok');
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_praca_id_ativa(p_sigla text)
 RETURNS bigint
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select id from public.vessel_pracas
   where sigla = upper(nullif(trim(coalesce(p_sigla, '')), '')) and ativa;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_praca_id_da_cidade(p_cidade text)
 RETURNS bigint
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select c.praca_id
    from public.vessel_praca_cidades c
    join public.vessel_pracas p on p.id = c.praca_id
   where p.ativa
     and c.cidade_chave = public.vessel_achatar_cidade(p_cidade)
     and public.vessel_achatar_cidade(p_cidade) <> '';
$function$;

CREATE OR REPLACE FUNCTION public.vessel_pracas_listar()
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not (public.vessel_pode('atendimentos.pracas', 'ver')
       or public.vessel_pode('atendimentos.edicoes', 'ver')
       or public.vessel_pode('atendimentos.stylist-circle', 'ver')
       or public.vessel_pode('atendimentos.private-edit', 'ver')) then
    raise exception 'sem permissao' using errcode = '42501';
  end if;
  return coalesce((
    select json_agg(json_build_object(
             'id', p.id, 'sigla', p.sigla, 'nome', p.nome, 'loja_destino', p.loja_destino,
             'ativa', p.ativa,
             'cidades', coalesce((select json_agg(json_build_object('id', c.id, 'cidade', c.cidade) order by c.cidade)
                          from public.vessel_praca_cidades c where c.praca_id = p.id), '[]'::json),
             'stylists', (select count(*)::int from public.vessel_stylists s
                           where s.praca_id = p.id and not coalesce(s.teste, false)))
           order by p.ordem, p.id)
      from public.vessel_pracas p), '[]'::json);
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_private_edit_apagar(p_codigo text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  -- ⚠️ MESMA EXPRESSAO E MESMA ORDEM da irma `vessel_private_edit_encerrar`.
  v_codigo text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
begin
  if not public.vessel_pode('atendimentos.private-edit', 'editar') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;

  if not exists (select 1 from public.vessel_private_edits where codigo = v_codigo) then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;

  -- ⚠️ APAGAR COM GENTE PENDURADA DEIXARIA LINHAS ORFAS em vessel_atendimentos,
  -- e a receita passaria a somar sobre um encontro que nao existe mais. Para
  -- esses, a tela oferece encerrar e arquivar.
  --
  -- ⚠️ E AQUI TAMBEM E `v_codigo`, NAO `p_codigo`. Se esta linha lesse o cru
  -- enquanto o `delete` abaixo le o normalizado, um codigo em minusculas nao
  -- acharia ninguem pendurado e o `delete` apagaria um encontro COM GENTE —
  -- exatamente o estrago que esta conferencia existe para impedir.
  if exists (select 1 from public.vessel_atendimentos where evento_codigo = v_codigo) then
    return json_build_object('ok', false, 'situacao', 'tem_gente');
  end if;

  delete from public.vessel_private_edits where codigo = v_codigo;
  return json_build_object('ok', true, 'situacao', 'ok', 'codigo', v_codigo);
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_private_edit_arquivar(p_codigo text, p_arquivada boolean DEFAULT true)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  -- ⚠️ MESMA EXPRESSAO E MESMA ORDEM da irma `vessel_private_edit_encerrar`.
  v_codigo text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
begin
  if not public.vessel_pode('atendimentos.private-edit', 'editar') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;

  if not exists (select 1 from public.vessel_private_edits where codigo = v_codigo) then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;

  update public.vessel_private_edits
     set arquivada = coalesce(p_arquivada, true)
   where codigo = v_codigo;

  return json_build_object('ok', true, 'situacao', 'ok',
                           'codigo', v_codigo, 'arquivada', coalesce(p_arquivada, true));
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_private_edit_duracao()
 RETURNS interval
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select interval '4 hours'
$function$;

CREATE OR REPLACE FUNCTION public.vessel_private_edit_editar(p_codigo text, p_quando timestamp with time zone DEFAULT NULL::timestamp with time zone, p_local text DEFAULT NULL::text, p_praca text DEFAULT NULL::text, p_loja text DEFAULT NULL::text, p_vagas integer DEFAULT NULL::integer, p_stylist text DEFAULT NULL::text, p_confirmar_sobreposicao boolean DEFAULT NULL::boolean)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  -- ⚠️ MESMA EXPRESSAO E MESMA ORDEM da irma `vessel_private_edit_encerrar`.
  v_codigo  text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
  v_stylist bigint;
  v_atual   public.vessel_private_edits%rowtype;
  v_sobrepoe json;
begin
  if not public.vessel_pode('atendimentos.private-edit', 'editar') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;

  select * into v_atual from public.vessel_private_edits where codigo = v_codigo;
  if not found then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;

  if p_stylist is not null then
    select id into v_stylist from public.vessel_stylists where codigo = p_stylist;
    if v_stylist is null then
      return json_build_object('ok', false, 'situacao', 'stylist_nao_achei');
    end if;
    -- ⚠️ 24/09/2026: TROCAR a anfitriã só por uma liberada. Manter a de hoje
    -- passa sempre — o encontro que já existe não é invalidado.
    if v_stylist is distinct from v_atual.stylist_id and not exists (
         select 1 from public.vessel_stylists s join public.vessel_stylist_etapas e on e.id = s.etapa_id
          where s.id = v_stylist and e.libera_private_edit) then
      return json_build_object('ok', false, 'situacao', 'stylist_nao_liberada',
        'etapas_que_liberam', public.vessel_etapas_que_liberam_private_edit());
    end if;
  end if;

  -- ⚠️ T11: a mesma régua de capacidade do criar. Antes daqui, editar não
  -- conferia vagas nenhuma — dava para gravar zero, e zero é o denominador da
  -- taxa de resposta na tela.
  if p_vagas is not null and (p_vagas < 7 or p_vagas > 10) then
    return json_build_object('ok', false, 'situacao', 'vagas_invalidas');
  end if;

  -- ⚠️ 25/09/2026: O ENCONTRO SOBREPOSTO — só quando a tela pede, e só quando o
  -- dia/hora ou o lugar MUDAM (mexer nas vagas não pede confirmação de novo).
  -- O próprio encontro nunca conflita consigo mesmo.
  if p_confirmar_sobreposicao is not null
     and (coalesce(p_quando, v_atual.quando) is distinct from v_atual.quando
          or public.vessel_lugar_do_encontro(coalesce(p_loja, v_atual.loja), coalesce(p_praca, v_atual.praca),
                                             coalesce(p_local, v_atual.local))
             is distinct from public.vessel_lugar_do_encontro(v_atual.loja, v_atual.praca, v_atual.local)) then
    v_sobrepoe := public.vessel_encontros_que_sobrepoem(
                    coalesce(p_quando, v_atual.quando),
                    public.vessel_lugar_do_encontro(coalesce(p_loja, v_atual.loja), coalesce(p_praca, v_atual.praca),
                                                    coalesce(p_local, v_atual.local)),
                    v_codigo);
    if not p_confirmar_sobreposicao and json_array_length(v_sobrepoe) > 0 then
      return json_build_object('ok', false, 'situacao', 'sobrepoe', 'codigo', v_codigo,
        'sobrepoe', v_sobrepoe,
        'contexto', public.vessel_contexto_da_loja(coalesce(p_quando, v_atual.quando), coalesce(p_loja, v_atual.loja)));
    end if;
  end if;

  -- Campo nulo = "nao mexe neste", nunca "apaga o que estava la".
  update public.vessel_private_edits
     set quando     = coalesce(p_quando, quando),
         local      = coalesce(p_local, local),
         praca      = coalesce(p_praca, praca),
         loja       = coalesce(p_loja, loja),
         vagas      = coalesce(p_vagas, vagas),
         stylist_id = coalesce(v_stylist, stylist_id)
   where codigo = v_codigo;

  if p_confirmar_sobreposicao and json_array_length(v_sobrepoe) > 0 then
    return json_build_object('ok', true, 'situacao', 'ok', 'codigo', v_codigo, 'sobrepoe', v_sobrepoe);
  end if;
  return json_build_object('ok', true, 'situacao', 'ok', 'codigo', v_codigo);
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_private_edit_encerrar(p_codigo text, p_ativa boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_codigo text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
begin
  if not public.vessel_pode('atendimentos.private-edit', 'editar') then
    return json_build_object('ok', false, 'erro',
      'Você não tem a permissão de Atendimentos para mexer nos encontros.');
  end if;
  update public.vessel_private_edits
     set ativa = coalesce(p_ativa, false)
   where codigo = v_codigo;
  if not found then
    return json_build_object('ok', false, 'erro', 'Não achei este encontro.');
  end if;
  return json_build_object('ok', true, 'codigo', v_codigo, 'ativa', coalesce(p_ativa, false));
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_private_edit_situacao(p_codigo text, p_status text, p_realizado_em date DEFAULT NULL::date, p_motivo text DEFAULT NULL::text, p_observacoes text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_codigo text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
  v_status text := lower(nullif(trim(coalesce(p_status, '')), ''));
  v_motivo text := nullif(trim(coalesce(p_motivo, '')), '');
  v_hoje   date := (now() at time zone 'America/Sao_Paulo')::date;
  v_e      public.vessel_private_edits%rowtype;
  v_data   date;
begin
  -- ⚠️ TRAVA DE MEXER: quem confirma a realização é a gerente, e ela mexe.
  if not public.vessel_pode('atendimentos.private-edit', 'editar') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;

  select * into v_e from public.vessel_private_edits where codigo = v_codigo;
  if v_e.id is null then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;

  if v_status is null or v_status not in ('em_planejamento', 'agendado', 'confirmado',
       'realizado', 'reagendado', 'cancelado', 'nao_realizado') then
    return json_build_object('ok', false, 'situacao', 'status_invalido');
  end if;

  if v_status in ('cancelado', 'nao_realizado') and v_motivo is null then
    return json_build_object('ok', false, 'situacao', 'sem_motivo');
  end if;

  if v_status = 'realizado' then
    -- Sem data escrita, vale o dia marcado — é o caso comum.
    v_data := coalesce(p_realizado_em, v_e.realizado_em,
                       (v_e.quando at time zone 'America/Sao_Paulo')::date);
    if v_data > v_hoje then
      return json_build_object('ok', false, 'situacao', 'realizado_no_futuro');
    end if;
  end if;

  update public.vessel_private_edits
     set status       = v_status,
         realizado_em = case when v_status = 'realizado' then v_data end,
         motivo       = case when v_status in ('cancelado', 'nao_realizado') then v_motivo end,
         -- `observacoes` nula não mexe; string vazia apaga.
         observacoes  = case when p_observacoes is null then observacoes
                             else nullif(trim(p_observacoes), '') end,
         -- ⚠️ ENCONTRO QUE ACABOU PARA DE ACEITAR RESPOSTA NO CONVITE. O
         -- contrário não: reabrir o convite continua sendo um gesto à parte
         -- (`vessel_private_edit_encerrar`), e voltar para "agendado" não
         -- pode reabrir sozinho um convite que alguém fechou de propósito.
         ativa        = case when v_status in ('realizado', 'cancelado', 'nao_realizado')
                             then false else ativa end
   where id = v_e.id;

  return json_build_object('ok', true, 'situacao', 'ok', 'codigo', v_codigo,
                           'status', v_status, 'antes', v_e.status);
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_private_edit_sobreposicoes(p_quando timestamp with time zone, p_loja text, p_ignorar_codigo text DEFAULT NULL::text, p_praca text DEFAULT NULL::text, p_local text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.vessel_pode('atendimentos.private-edit', 'ver') then
    raise exception 'sem permissao' using errcode = '42501';
  end if;
  return json_build_object(
    'ok', true,
    'duracao_em_horas', extract(epoch from public.vessel_private_edit_duracao())::int / 3600,
    'sobrepoe', public.vessel_encontros_que_sobrepoem(
                  p_quando, public.vessel_lugar_do_encontro(p_loja, p_praca, p_local), p_ignorar_codigo),
    'contexto', public.vessel_contexto_da_loja(p_quando, nullif(trim(coalesce(p_loja, '')), '')));
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_private_edits_mexe_no_funil()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- ⚠️ `if` ANINHADO, E NÃO UM `or` NUMA LINHA SÓ: o Postgres não promete
  -- avaliar o `or` da esquerda para a direita, e ler `old` num INSERT é erro.
  if tg_op = 'INSERT' then
    perform public.vessel_stylist_seguir_os_encontros(new.stylist_id);
  elsif tg_op = 'DELETE' then
    perform public.vessel_stylist_seguir_os_encontros(old.stylist_id);
  elsif new.stylist_id is distinct from old.stylist_id
        or new.status is distinct from old.status
        or new.arquivada is distinct from old.arquivada then
    -- Trocar a anfitriã mexe no funil das DUAS.
    perform public.vessel_stylist_seguir_os_encontros(old.stylist_id);
    if new.stylist_id is distinct from old.stylist_id then
      perform public.vessel_stylist_seguir_os_encontros(new.stylist_id);
    end if;
  end if;
  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_qualificacoes_vigentes()
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_saida json;
begin
  if not public.vessel_pode('atendimentos.stylist-circle', 'ver') then
    raise exception 'sem permissao' using errcode = '42501';
  end if;
  select coalesce(json_agg(json_build_object(
           'codigo', x.codigo, 'nota', x.nota, 'faixa', x.faixa, 'avaliado_em', x.avaliado_em)
         order by x.codigo), '[]'::json)
    into v_saida
    from (select distinct on (q.stylist_id) s.codigo, q.nota, q.faixa, q.avaliado_em
            from public.vessel_stylist_qualificacoes q
            join public.vessel_stylists s on s.id = q.stylist_id
           where not coalesce(s.teste, false)
           order by q.stylist_id, q.avaliado_em desc, q.id desc) x;
  return v_saida;
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_rastreio_dos_stylists(p_dias integer DEFAULT 7, p_incluir_desativadas boolean DEFAULT false, p_praca_id bigint DEFAULT NULL::bigint, p_edicao_id bigint DEFAULT NULL::bigint)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_dias int := greatest(coalesce(p_dias, 7), 0);
  v_saida json;
begin
  if not (public.vessel_pode('atendimentos.stylist-circle', 'ver') or public.vessel_pode('atendimentos.material-grafico', 'ver')) then
    raise exception 'sem permissao' using errcode = '42501';
  end if;

  with vendas as (select * from public.vessel_vendas_dos_encontros(v_dias))
  select coalesce(json_agg(linha order by linha ->> 'codigo'), '[]'::json)
    into v_saida
    from (
      select json_build_object(
        'codigo', s.codigo,
        'nome', s.nome,
        'cidade', s.cidade,
        -- ⚠️ 24/09/2026: a etapa é uma linha de `vessel_stylist_etapas`.
        'etapa_id', s.etapa_id,
        'etapa', et.nome,
        'etapa_tipo', et.tipo,
        'etapa_ordem', et.ordem,
        -- ⚠️ 24/09/2026 (Private Edit só com liberada, e os motivos de saída).
        'etapa_libera_private_edit', et.libera_private_edit,
        'saida_motivo_id', case when et.tipo = 'saida' then sa.motivo_id end,
        'saida_motivo', case when et.tipo = 'saida' then ms.nome end,
        'saida_nota', case when et.tipo = 'saida' then sa.nota end,
        'praca_preview', s.praca_preview,
        -- ⚠️ TASK 5: a praça de CADASTRO da stylist (não mais o texto solto
        -- de `praca_preview`, que continua só como histórico do que a
        -- stylist escreveu). `loja_destino` é a loja que atende a praça —
        -- pode ser de outra cidade (Piracicaba → Campinas).
        'praca_id', pc.id,
        'praca_sigla', pc.sigla,
        'praca_nome', pc.nome,
        'loja_destino', pc.loja_destino,
        -- ⚠️ RODADA 1 DE CONSERTO (MENOR 4): `edicao_atual_id`, não
        -- `edicao_id` — ao lado de um PARÂMETRO `p_edicao_id` que quer dizer
        -- outra coisa (o recorte do filtro), o nome igual seria lido errado
        -- por quem construir a tela. É a edição em que ela está ATIVA agora
        -- (saiu_em is null) — nula se não estiver em nenhuma edição
        -- aberta/planejada no momento.
        'edicao_atual_id', ed_atual.edicao_id,
        'ativa', s.ativa,
        'whatsapp', s.whatsapp,
        'instagram', s.instagram,
        'atuacao', s.atuacao,
        -- T11: a ficha operacional.
        'loja', s.loja,
        'origem_contato', s.origem_contato,
        'responsavel', s.responsavel,
        'prospectado_em', s.prospectado_em,
        'proxima_acao', s.proxima_acao,
        'proxima_acao_em', s.proxima_acao_em,
        'observacoes', s.observacoes,
        -- ⚠️ 24/09/2026: "sem contato ainda" — alguém vai completar.
        'sem_contato', s.sem_contato,
        -- ⚠️ 24/09/2026: a ativação é a da etapa (a mesma função do placar); o
        -- primeiro Private Edit agendado continua, com o nome dele.
        'ativada_em', public.vessel_stylist_ativada_em(s.id),
        'private_edit_agendado_em', s.ativada_em,
        'encontros_realizados', ee.realizados,
        'ultima_private_edit', ee.ultima,
        'proxima_data_permitida', ee.ultima + 45,
        'receita_dos_encontros', (select coalesce(sum(v.receita), 0) from vendas v
                                   where v.stylist_id = s.id),
        'contatos', (select count(*)::int from public.vessel_stylist_contatos c where c.stylist_id = s.id),
        'ultimo_contato_em', (select max(c.criado_em) from public.vessel_stylist_contatos c where c.stylist_id = s.id),
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
        'receita', (select coalesce(sum(coalesce(p.receita_liquida, p.total_corrigido, 0)), 0)
                      from public.vessel_pedidos p
                     where p.situacao_id = 9
                       and exists (select 1 from public.vessel_origens o
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
      join public.vessel_stylist_etapas et on et.id = s.etapa_id
      left join public.vessel_pracas pc on pc.id = s.praca_id
      left join lateral (
        select n.edicao_id from public.vessel_stylist_na_edicao n
         where n.stylist_id = s.id and n.saiu_em is null
         order by n.entrou_em desc limit 1
      ) ed_atual on true
      left join lateral public.vessel_stylist_saida_atual(s.id) sa on true
      left join public.vessel_stylist_motivos_de_saida ms on ms.id = sa.motivo_id
      cross join lateral (
        select count(*) filter (where e.status = 'realizado')::int as realizados,
               max(e.realizado_em) filter (where e.status = 'realizado') as ultima
          from public.vessel_private_edits e
         where e.stylist_id = s.id and not coalesce(e.teste, false)
           and not coalesce(e.arquivada, false)
      ) ee
      where not coalesce(s.teste, false)
        and (coalesce(p_incluir_desativadas, false) or coalesce(s.ativa, true))
        -- ⚠️ TASK 5: o recorte por praça e por edição — nulo passa tudo
        -- (nenhum recorte é o comportamento de hoje, preservado).
        and (p_praca_id is null or s.praca_id = p_praca_id)
        and (p_edicao_id is null or exists (
              select 1 from public.vessel_stylist_na_edicao n
               where n.stylist_id = s.id and n.edicao_id = p_edicao_id))
    ) as linhas;

  -- ⚠️ QUEM NÃO TEM O STYLIST CIRCLE (hoje: só o Material Gráfico, que é só
  -- leitura e mostra os QR) recebe SÓ o que o QR precisa: código, nome,
  -- cidade, se está ativa e a etapa (nome + a marca de que libera o Private
  -- Edit — é ela que decide se o QR aparece). WhatsApp, Instagram,
  -- observações, responsável, próxima ação e os números NÃO saem daqui para
  -- ele. Lista do que o Material Gráfico lê: itemDaStylist(), em
  -- src/ferramentas/comercial-vessel/material-grafico-regras.js. A ordem é a mesma.
  if not public.vessel_pode('atendimentos.stylist-circle', 'ver') then
    select coalesce(json_agg(json_build_object(
             'codigo', x.l -> 'codigo',
             'nome', x.l -> 'nome',
             'cidade', x.l -> 'cidade',
             'ativa', x.l -> 'ativa',
             'etapa', x.l -> 'etapa',
             'etapa_libera_private_edit', x.l -> 'etapa_libera_private_edit') order by x.n), '[]'::json)
      into v_saida
      from json_array_elements(v_saida) with ordinality as x(l, n);
  end if;

  return v_saida;
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_rd_na_fila()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.canal = 'beauty_session'
     and not coalesce((select p.teste from public.vessel_pessoas p where p.id = new.pessoa_id), false) then
    begin
      insert into public.vessel_rd_envios (origem_id, pessoa_id, codigo)
      values (new.id, new.pessoa_id, new.evento_id)
      on conflict (origem_id) do nothing;
    exception when others then
      raise warning 'vessel_rd_na_fila: % (origem %)', sqlerrm, new.id;
    end;
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.vessel_scorecard_da_stylist(p_codigo text, p_de date DEFAULT NULL::date, p_ate date DEFAULT NULL::date, p_dias integer DEFAULT 14)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_codigo text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
  v_ate    date := coalesce(p_ate, 'infinity'::date);
  v_hoje   date := (now() at time zone 'America/Sao_Paulo')::date;
  v_s      public.vessel_stylists%rowtype;
  v_num    jsonb;
  v_ult    date;
  v_real   int;
  v_prox_codigo text;
  v_prox_quando timestamptz;
  v_ativou  timestamptz;
begin
  if not public.vessel_pode('atendimentos.stylist-circle', 'ver') then
    raise exception 'sem permissao' using errcode = '42501';
  end if;

  select * into v_s from public.vessel_stylists s
   where s.codigo = v_codigo and not coalesce(s.teste, false);
  if v_s.id is null then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;

  v_num := public.vessel_numeros_do_stylist_circle(p_de, p_ate, p_dias, v_s.id)::jsonb;

  -- ⚠️ 24/09/2026: A ATIVAÇÃO É `vessel_stylist_ativada_em` — a mesma do
  -- placar (a etapa que libera Private Edit; sem ela, o primeiro encontro).
  v_ativou := public.vessel_stylist_ativada_em(v_s.id);

  -- ⚠️ "RECORRENTE" E "DIAS DESDE O ÚLTIMO" NÃO SÃO DO PERÍODO: são o estado
  -- dela até o fim dele. Quem fez dois encontros em agosto continua
  -- recorrente quando se olha setembro.
  select count(*)::int, max(e.realizado_em) into v_real, v_ult
    from public.vessel_private_edits e
   where e.stylist_id = v_s.id and e.status = 'realizado'
     and not coalesce(e.teste, false) and not coalesce(e.arquivada, false)
     and e.realizado_em <= v_ate;

  -- O próximo encontro MARCADO (não o planejado, não o que caiu).
  select e.codigo, e.quando into v_prox_codigo, v_prox_quando
    from public.vessel_private_edits e
   where e.stylist_id = v_s.id and e.status in ('agendado', 'confirmado', 'reagendado')
     and not coalesce(e.teste, false) and not coalesce(e.arquivada, false)
     and e.quando >= now()
   order by e.quando, e.id
   limit 1;

  return ((v_num - 'por_stylist') || jsonb_build_object(
    'ok', true, 'situacao', 'ok',
    'codigo', v_s.codigo, 'nome', v_s.nome, 'ativada_em', v_ativou,
    'private_edit_agendado_em', v_s.ativada_em,
    'ativada_por_encontro_antigo', v_s.ativada_em is not null and not exists (
      select 1 from public.vessel_stylist_etapas_historico h where h.stylist_id = v_s.id and h.liberava_private_edit),
    'realizados_desde_o_inicio', v_real,
    'recorrente', v_real >= 2,
    'ultimo_realizado_em', v_ult,
    'dias_desde_o_ultimo', case when v_ult is null then null else v_hoje - v_ult end,
    'proximo_encontro_em', v_prox_quando,
    'proximo_encontro_codigo', v_prox_codigo,
    'contatos', (select count(*)::int from public.vessel_stylist_contatos c where c.stylist_id = v_s.id),
    -- A mesma régua de `contatos_ate_ativar` do placar, só que dela: os
    -- contatos registrados ANTES da ativação.
    'contatos_antes_de_ativar', case when v_ativou is null then null else
      (select count(*)::int from public.vessel_stylist_contatos c
        where c.stylist_id = v_s.id and c.criado_em < v_ativou) end,
    -- Para a sugestão de Confiabilidade: parceira que já ativou e some.
    'contatos_sem_resposta_depois_de_ativar', case when v_ativou is null then null else
      (select count(*)::int from public.vessel_stylist_contatos c
        where c.stylist_id = v_s.id and c.resultado = 'sem_resposta'
          and c.criado_em >= v_ativou) end
  ))::json;
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_situacao_do_atendimento(p_id bigint, p_situacao text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_atual public.vessel_atendimentos%rowtype;
begin
  if not (public.vessel_pode('atendimentos', 'editar') or public.vessel_pode('atendimentos.private-edit', 'editar')) then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;

  -- A lista fechada mora AQUI, e não num CHECK novo: a coluna já tem o seu, e
  -- este recorte é menor de propósito. 'solicitado' não entra — ninguém
  -- "desmarca" uma visita de volta para pedido; e 'cancelado' entra porque
  -- desistir antes da hora é diferente de faltar.
  if p_situacao is null or p_situacao not in
     ('confirmado', 'realizado', 'no_show', 'remarcado', 'cancelado') then
    return json_build_object('ok', false, 'situacao', 'situacao_invalida');
  end if;

  select * into v_atual from public.vessel_atendimentos where id = p_id;
  if v_atual.id is null then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;

  -- ⚠️ QA11 DO PLANO: "no-show não vira presença". Só 'realizado' carimba hora
  -- de chegada; todo o resto APAGA o carimbo. Sem isso, marcar "veio" por
  -- engano e corrigir para "não veio" deixaria a hora de chegada para trás, e o
  -- show rate contaria quem não veio.
  update public.vessel_atendimentos
     set status      = p_situacao,
         presenca_em = case when p_situacao = 'realizado'
                            then coalesce(presenca_em, now()) else null end,
         atualizado_em = now()
   where id = p_id;

  return json_build_object('ok', true, 'situacao', p_situacao,
                           'antes', v_atual.status);
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_situacao_do_convite(p_status text, p_rsvp text, p_enviado_em timestamp with time zone, p_evento_quando timestamp with time zone, p_evento_status text)
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  -- ⚠️ A ORDEM É A REGRA. Presença vence tudo (quem veio, veio); depois a
  -- falta; depois a recusa; depois a confirmação. "Não respondeu" só existe
  -- quando o encontro já passou — antes disso ela ainda pode responder.
  select case
    when p_status = 'realizado' then 'presente'
    when p_status = 'no_show'   then 'nao_compareceu'
    when p_status = 'cancelado' or p_rsvp = 'nao' then 'recusou'
    when p_status = 'confirmado' or p_rsvp = 'sim' then 'confirmada'
    when p_evento_status in ('realizado', 'nao_realizado', 'cancelado')
      or p_evento_quando < now() then 'nao_respondeu'
    when p_enviado_em is not null or p_rsvp is not null then 'convite_enviado'
    else 'convidada'
  end
$function$;

CREATE OR REPLACE FUNCTION public.vessel_so_acrescenta()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  raise exception '% e so-acrescenta: % nao e permitido', tg_table_name, lower(tg_op)
    using errcode = '42501';
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_sortear_chave_de_convidada()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_alfabeto text := 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
  v_teto int := 240;
  v_chave text;
  v_byte int;
begin
  loop
    v_chave := '';
    while length(v_chave) < 8 loop
      v_byte := get_byte(extensions.gen_random_bytes(1), 0);
      continue when v_byte >= v_teto;
      v_chave := v_chave || substr(v_alfabeto, 1 + (v_byte % 30), 1);
    end loop;
    exit when not exists (select 1 from public.vessel_atendimentos where chave_convite = v_chave);
  end loop;
  return v_chave;
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_stylist_ativada_em(p_stylist bigint)
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(
    (select min(h.em) from public.vessel_stylist_etapas_historico h
      where h.stylist_id = p_stylist and h.liberava_private_edit),
    (select s.ativada_em from public.vessel_stylists s where s.id = p_stylist))
$function$;

CREATE OR REPLACE FUNCTION public.vessel_stylist_avaliar(p_codigo text, p_carteira integer, p_portfolio integer, p_mobilizacao integer, p_acesso integer, p_confiabilidade integer, p_observacao text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_codigo text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
  v_obs    text := nullif(trim(coalesce(p_observacao, '')), '');
  v_s      public.vessel_stylists%rowtype;
  v_q      public.vessel_stylist_qualificacoes%rowtype;
begin
  if not public.vessel_pode('atendimentos.stylist-circle', 'editar') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  select * into v_s from public.vessel_stylists where codigo = v_codigo;
  if v_s.id is null then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;
  if p_carteira is null or p_portfolio is null or p_mobilizacao is null
     or p_acesso is null or p_confiabilidade is null
     or p_carteira not between 1 and 5 or p_portfolio not between 1 and 5
     or p_mobilizacao not between 1 and 5 or p_acesso not between 1 and 5
     or p_confiabilidade not between 1 and 5 then
    return json_build_object('ok', false, 'situacao', 'nivel_invalido');
  end if;
  if v_obs is not null and length(v_obs) > 280 then
    return json_build_object('ok', false, 'situacao', 'observacao_longa');
  end if;

  insert into public.vessel_stylist_qualificacoes
    (stylist_id, carteira, portfolio, mobilizacao, acesso, confiabilidade, observacao,
     avaliado_por, avaliado_por_nome, teste)
  values (v_s.id, p_carteira, p_portfolio, p_mobilizacao, p_acesso, p_confiabilidade, v_obs,
          auth.uid(),
          (select coalesce(nullif(trim(p.name), ''), p.email) from public.profiles p where p.id = auth.uid()),
          coalesce(v_s.teste, false))
  returning * into v_q;

  return json_build_object('ok', true, 'situacao', 'ok', 'id', v_q.id,
    'nota', v_q.nota, 'faixa', v_q.faixa, 'avaliado_em', v_q.avaliado_em);
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_stylist_conferir_motivo(p_etapa bigint, p_motivo bigint, p_nota text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  v_e    public.vessel_stylist_etapas%rowtype;
  v_m    public.vessel_stylist_motivos_de_saida%rowtype;
  v_nota text := nullif(btrim(coalesce(p_nota, '')), '');
begin
  select * into v_e from public.vessel_stylist_etapas where id = p_etapa and ativa;
  if v_e.id is null then return 'etapa_invalida'; end if;
  if v_nota is not null and length(v_nota) > 500 then return 'nota_longa'; end if;
  if v_e.tipo <> 'saida' then return null; end if;   -- funil: motivo não se aplica
  if not exists (select 1 from public.vessel_stylist_motivos_de_saida m where m.etapa_id = p_etapa and m.ativo) then
    if p_motivo is not null then return 'motivo_invalido'; end if;
    return null;                                      -- saída sem motivos: não pede
  end if;
  if p_motivo is null then return 'motivo_obrigatorio'; end if;
  select * into v_m from public.vessel_stylist_motivos_de_saida m
   where m.id = p_motivo and m.etapa_id = p_etapa and m.ativo;
  if v_m.id is null then return 'motivo_invalido'; end if;
  if v_m.exige_nota and v_nota is null then return 'nota_obrigatoria'; end if;
  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_stylist_contatos(p_codigo text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_saida json;
begin
  -- Lista vazia, não erro: é um bloco dentro de uma ficha já aberta.
  if not public.vessel_pode('atendimentos.stylist-circle', 'ver') then return '[]'::json; end if;
  select coalesce(json_agg(json_build_object(
           'id', c.id, 'canal', c.canal, 'resultado', c.resultado, 'nota', c.nota,
           'criado_em', c.criado_em, 'criado_por_nome', c.criado_por_nome)
         order by c.criado_em desc, c.id desc), '[]'::json)
    into v_saida
    from public.vessel_stylist_contatos c
    join public.vessel_stylists s on s.id = c.stylist_id
   where s.codigo = upper(nullif(trim(coalesce(p_codigo, '')), ''));
  return v_saida;
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_stylist_criar(p_nome text, p_whatsapp text, p_cidade text DEFAULT NULL::text, p_instagram text DEFAULT NULL::text, p_atuacao text DEFAULT NULL::text, p_praca text DEFAULT NULL::text, p_loja text DEFAULT NULL::text, p_origem_contato text DEFAULT NULL::text, p_responsavel text DEFAULT NULL::text, p_prospectado_em date DEFAULT NULL::date, p_proxima_acao text DEFAULT NULL::text, p_proxima_acao_em date DEFAULT NULL::date, p_observacoes text DEFAULT NULL::text, p_sem_contato boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_fone    text;
  v_insta   text := nullif(trim(coalesce(p_instagram, '')), '');
  v_perfil  text := public.vessel_instagram_canonico(p_instagram);
  v_obs     text := nullif(trim(coalesce(p_observacoes, '')), '');
  v_praca   text := upper(nullif(trim(coalesce(p_praca, '')), ''));
  v_praca_id bigint;
  v_loja    text := lower(nullif(trim(coalesce(p_loja, '')), ''));
  v_origem  text := lower(nullif(trim(coalesce(p_origem_contato, '')), ''));
  v_codigo  text;
  v_id      bigint;
  v_n       int;
  v_volta   int;
  v_indice  text;
  v_outra   text;
  -- ⚠️ SEM CONTATO AINDA: só vale quando não veio NENHUM contato.
  v_sem     boolean := coalesce(p_sem_contato, false);
begin
  if not public.vessel_pode('atendimentos.stylist-circle', 'editar') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;

  if nullif(trim(coalesce(p_nome, '')), '') is null then
    return json_build_object('ok', false, 'situacao', 'sem_nome');
  end if;

  -- ⚠️ WHATSAPP OU INSTAGRAM (ver `2026-09-24-vessel-stylist-whatsapp-ou-instagram.sql`).
  if nullif(trim(coalesce(p_whatsapp, '')), '') is not null then
    v_fone := public.vessel_telefone_canonico(p_whatsapp);
    if v_fone is null then
      return json_build_object('ok', false, 'situacao', 'whatsapp_invalido');
    end if;
  end if;
  if length(coalesce(v_insta, '')) > 120 then
    return json_build_object('ok', false, 'situacao', 'instagram_longo');
  end if;
  -- ⚠️ SEM CONTATO AINDA: só quem MARCOU a caixa entra sem os dois. A Central
  -- antiga não manda `p_sem_contato` (padrão false) e continua recusando igual.
  if v_fone is null and v_insta is null and not v_sem then
    return json_build_object('ok', false, 'situacao', 'sem_contato');
  end if;
  -- Instagram ESCRITO sem WhatsApp continua tendo de ser um perfil de verdade.
  if v_fone is null and v_insta is not null and v_perfil is null then
    return json_build_object('ok', false, 'situacao', 'instagram_invalido');
  end if;
  if v_obs is not null and length(v_obs) > 2000 then
    return json_build_object('ok', false, 'situacao', 'observacoes_longas');
  end if;

  -- ⚠️ RODADA 1 DE CONSERTO (CRÍTICO): consulta ao cadastro, não lista
  -- fechada — sem isto, ninguém cadastrava stylist de Limeira nem de
  -- Piracicaba pela tela.
  --
  -- ⚠️ REVISÃO FINAL (IMPORTANTE 4): sem praça escolhida, a praça SAI DA
  -- CIDADE (`vessel_praca_id_da_cidade`, seção 12) — a MESMA conta do
  -- backfill da seção 8. Cidade que não casa continua sem praça: pendência à
  -- vista, nunca chute. `praca_preview` NÃO é inventado a partir disso — ele
  -- guarda o que a pessoa escreveu, e quem manda de verdade é `praca_id`.
  if v_praca is not null then
    v_praca_id := public.vessel_praca_id_ativa(v_praca);
    if v_praca_id is null then
      return json_build_object('ok', false, 'situacao', 'praca_invalida');
    end if;
  else
    v_praca_id := public.vessel_praca_id_da_cidade(p_cidade);
  end if;
  if v_loja is not null and v_loja not in ('iguatemi', 'tivoli', 'parkshopping') then
    return json_build_object('ok', false, 'situacao', 'loja_invalida');
  end if;
  if v_origem is null or v_origem not in ('indicacao', 'pesquisa', 'evento', 'inbound') then
    return json_build_object('ok', false, 'situacao', 'origem_invalida');
  end if;

  if v_fone is not null and exists (select 1 from public.vessel_stylists where whatsapp = v_fone) then
    return json_build_object('ok', false, 'situacao', 'whatsapp_repetido',
      'codigo', (select s.codigo from public.vessel_stylists s where s.whatsapp = v_fone));
  end if;
  if v_perfil is not null then
    select s.codigo into v_outra from public.vessel_stylists s
     where public.vessel_instagram_canonico(s.instagram) = v_perfil
     order by s.id limit 1;
    if v_outra is not null then
      return json_build_object('ok', false, 'situacao', 'instagram_repetido', 'codigo', v_outra);
    end if;
  end if;

  -- ⚠️ A TRAVA DE FILA E O CINTO, sem mudança desde 19/09.
  perform pg_advisory_xact_lock(hashtext('public.vessel_stylists.codigo')::bigint);

  for v_volta in 1..3 loop
    select coalesce(max((substring(s.codigo from '^STY-([0-9]{4})$'))::int), 0)
      into v_n
      from public.vessel_stylists s
     where s.codigo ~ '^STY-[0-9]{4}$';

    v_codigo := null;
    for i in 1..10000 loop
      v_n := v_n + 1;
      if v_n > 9999 then
        v_n := 0;
      end if;
      v_codigo := 'STY-' || lpad(v_n::text, 4, '0');
      exit when not exists (select 1 from public.vessel_stylists s where s.codigo = v_codigo);
      v_codigo := null;
    end loop;

    if v_codigo is null then
      return json_build_object('ok', false, 'situacao', 'sem_codigo_livre');
    end if;

    begin
      -- ⚠️ SEM `etapa_id` E SEM `prospectado_em`: o gatilho põe a primeira
      -- etapa de funil e a data segue a regra da etapa marcada.
      -- ⚠️ RODADA 1 DE CONSERTO: `praca_id` grava junto com `praca_preview`.
      insert into public.vessel_stylists
        (codigo, nome, whatsapp, cidade, instagram, atuacao, praca_preview, praca_id,
         loja, origem_contato, responsavel, proxima_acao, proxima_acao_em, observacoes,
         sem_contato)
      values
        (v_codigo, trim(p_nome), v_fone,
         nullif(trim(coalesce(p_cidade, '')), ''),
         v_insta,
         nullif(trim(coalesce(p_atuacao, '')), ''),
         v_praca, v_praca_id, v_loja, v_origem,
         nullif(trim(coalesce(p_responsavel, '')), ''),
         nullif(trim(coalesce(p_proxima_acao, '')), ''),
         p_proxima_acao_em,
         v_obs,
         v_sem and v_fone is null and v_insta is null)
      returning id into v_id;

      -- ⚠️ TASK 11 RODADA 1 DE CONSERTO (MENOR b): nasce vinculada à edição
      -- ABERTA da praça, se houver — pela MESMA função que as outras três
      -- portas usam (`vessel_stylist_sincronizar_edicao`), um critério só.
      -- `p_fechar_antigo` fica `false` (o padrão): quem está NASCENDO não
      -- tem vínculo antigo para fechar. Sem edição aberta (ou sem praça),
      -- nasce sem vínculo — e isso não é erro.
      perform public.vessel_stylist_sincronizar_edicao(v_id, v_praca_id);

      return json_build_object('ok', true, 'situacao', 'ok', 'codigo', v_codigo);

    exception when unique_violation then
      get stacked diagnostics v_indice = constraint_name;

      if v_indice = 'vessel_stylists_whatsapp_idx' then
        return json_build_object('ok', false, 'situacao', 'whatsapp_repetido');
      end if;

      if v_indice is distinct from 'vessel_stylists_codigo_idx' then
        return json_build_object('ok', false, 'situacao', 'conflito_no_cadastro',
                                 'onde', v_indice);
      end if;
    end;
  end loop;

  return json_build_object('ok', false, 'situacao', 'codigo_em_disputa');
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_stylist_desativar(p_codigo text, p_ativa boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_codigo text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
  -- ⚠️ `coalesce(p_ativa, false)`: quando a tela manda so o codigo — ou quando
  -- o PostgREST deixa o segundo parametro de fora e ele chega nulo —
  -- "desativar" tem de significar DESATIVAR. A coluna e `not null`, entao sem
  -- o `coalesce` a chamada morreria com erro de banco na cara da pessoa.
  v_ativa  boolean := coalesce(p_ativa, false);
begin
  if not public.vessel_pode('atendimentos.stylist-circle', 'editar') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;

  if not exists (select 1 from public.vessel_stylists s where s.codigo = v_codigo) then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;

  -- ⚠️ DESATIVAR NAO APAGA. Nada de `delete` aqui, nem hoje nem num refactor:
  -- as aberturas de link e os atendimentos que ela trouxe continuam contando
  -- no historico da marca. E por isso tem VOLTA: `p_ativa => true` reativa, e
  -- sem isso o botao de reativar seria codigo morto.
  update public.vessel_stylists s
     set ativa         = v_ativa,
         atualizado_em = now()
   where s.codigo = v_codigo;

  return json_build_object('ok', true, 'situacao', 'ok',
                           'codigo', v_codigo, 'ativa', v_ativa);
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_stylist_editar(p_codigo text, p_nome text DEFAULT NULL::text, p_whatsapp text DEFAULT NULL::text, p_cidade text DEFAULT NULL::text, p_instagram text DEFAULT NULL::text, p_atuacao text DEFAULT NULL::text, p_estagio text DEFAULT NULL::text, p_praca text DEFAULT NULL::text, p_loja text DEFAULT NULL::text, p_origem_contato text DEFAULT NULL::text, p_responsavel text DEFAULT NULL::text, p_prospectado_em date DEFAULT NULL::date, p_proxima_acao text DEFAULT NULL::text, p_proxima_acao_em date DEFAULT NULL::date, p_sem_proxima_acao boolean DEFAULT false, p_observacoes text DEFAULT NULL::text, p_sem_contato boolean DEFAULT NULL::boolean)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_codigo  text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
  v_id      bigint;
  v_fone    text;
  v_insta   text := nullif(trim(coalesce(p_instagram, '')), '');
  v_perfil  text := public.vessel_instagram_canonico(p_instagram);
  v_praca   text := upper(nullif(trim(coalesce(p_praca, '')), ''));
  v_praca_id bigint;
  v_loja    text := lower(nullif(trim(coalesce(p_loja, '')), ''));
  v_origem  text := lower(nullif(trim(coalesce(p_origem_contato, '')), ''));
  v_fone_atual text;
  v_insta_atual text;
  v_com_contato boolean;
begin
  if not public.vessel_pode('atendimentos.stylist-circle', 'editar') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;

  select s.id, s.whatsapp, nullif(btrim(coalesce(s.instagram, '')), '') into v_id, v_fone_atual, v_insta_atual
    from public.vessel_stylists s where s.codigo = v_codigo;
  if not found then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;

  if nullif(trim(coalesce(p_estagio, '')), '') is not null then
    return json_build_object('ok', false, 'situacao', 'etapa_pela_ficha');
  end if;

  if nullif(trim(coalesce(p_whatsapp, '')), '') is not null then
    v_fone := public.vessel_telefone_canonico(p_whatsapp);
    if v_fone is null then
      return json_build_object('ok', false, 'situacao', 'whatsapp_invalido');
    end if;
    if exists (select 1 from public.vessel_stylists s
                where s.whatsapp = v_fone and s.codigo <> v_codigo) then
      return json_build_object('ok', false, 'situacao', 'whatsapp_repetido');
    end if;
  end if;

  if v_insta is not null then
    if length(v_insta) > 120 then
      return json_build_object('ok', false, 'situacao', 'instagram_longo');
    end if;
    if coalesce(v_fone, v_fone_atual) is null and v_perfil is null then
      return json_build_object('ok', false, 'situacao', 'instagram_invalido');
    end if;
    if v_perfil is not null and exists (
         select 1 from public.vessel_stylists s
          where public.vessel_instagram_canonico(s.instagram) = v_perfil
            and s.codigo <> v_codigo) then
      return json_build_object('ok', false, 'situacao', 'instagram_repetido');
    end if;
  end if;

  -- ⚠️ SEM CONTATO AINDA. NULO = NÃO MEXE (a Central antiga não manda).
  -- Desmarcar sem dar um contato é recusado: a parceira ficaria sem WhatsApp,
  -- sem Instagram e sem a marca — o que a tabela não aceita. Ganhar um
  -- contato DESLIGA a marca sozinho (aqui e no gatilho da tabela).
  v_com_contato := coalesce(v_fone, v_fone_atual) is not null or coalesce(v_insta, v_insta_atual) is not null;
  if p_sem_contato is not null and not p_sem_contato and not v_com_contato then
    return json_build_object('ok', false, 'situacao', 'sem_contato');
  end if;

  if p_observacoes is not null and length(trim(p_observacoes)) > 2000 then
    return json_build_object('ok', false, 'situacao', 'observacoes_longas');
  end if;

  -- ⚠️ RODADA 1 DE CONSERTO (CRÍTICO): consulta ao cadastro, não lista
  -- fechada — sem isto, ninguém movia stylist para Limeira nem Piracicaba
  -- pela tela depois de cadastrada.
  if v_praca is not null then
    v_praca_id := public.vessel_praca_id_ativa(v_praca);
    if v_praca_id is null then
      return json_build_object('ok', false, 'situacao', 'praca_invalida');
    end if;
  end if;
  if v_loja is not null and v_loja not in ('iguatemi', 'tivoli', 'parkshopping') then
    return json_build_object('ok', false, 'situacao', 'loja_invalida');
  end if;
  if v_origem is not null and v_origem not in ('indicacao', 'pesquisa', 'evento', 'inbound') then
    return json_build_object('ok', false, 'situacao', 'origem_invalida');
  end if;

  update public.vessel_stylists s
     set nome            = coalesce(nullif(trim(coalesce(p_nome, '')), ''), s.nome),
         whatsapp        = coalesce(v_fone, s.whatsapp),
         cidade          = coalesce(nullif(trim(coalesce(p_cidade, '')), ''), s.cidade),
         instagram       = coalesce(v_insta, s.instagram),
         atuacao         = coalesce(nullif(trim(coalesce(p_atuacao, '')), ''), s.atuacao),
         praca_preview   = coalesce(v_praca, s.praca_preview),
         -- ⚠️ RODADA 1 DE CONSERTO: `praca_id` junto — só muda quando `p_praca`
         -- veio (o mesmo NULO-não-mexe de `praca_preview`, acima).
         praca_id        = coalesce(v_praca_id, s.praca_id),
         loja            = coalesce(v_loja, s.loja),
         origem_contato  = coalesce(v_origem, s.origem_contato),
         responsavel     = coalesce(nullif(trim(coalesce(p_responsavel, '')), ''), s.responsavel),
         proxima_acao    = case when coalesce(p_sem_proxima_acao, false) then null
                                else coalesce(nullif(trim(coalesce(p_proxima_acao, '')), ''),
                                              s.proxima_acao) end,
         proxima_acao_em = case when coalesce(p_sem_proxima_acao, false) then null
                                else coalesce(p_proxima_acao_em, s.proxima_acao_em) end,
         observacoes     = case when p_observacoes is null then s.observacoes
                                else nullif(trim(p_observacoes), '') end,
         sem_contato     = case when v_com_contato then false
                                else coalesce(p_sem_contato, s.sem_contato) end,
         atualizado_em   = now()
   where s.codigo = v_codigo;

  -- ⚠️ TASK 11 RODADA 1 DE CONSERTO (CRÍTICO 1): quando a praça MUDA
  -- (`p_praca` veio e resolveu uma `v_praca_id`), `p_fechar_antigo => true`
  -- fecha o vínculo ABERTO que ela tinha numa edição ABERTA de outra praça
  -- ANTES de abrir o novo — sem isto ela contaria em duas edições abertas ao
  -- mesmo tempo. Edição ENCERRADA nunca é tocada (o histórico é quem
  -- congela). `vessel_stylist_sincronizar_edicao` cuida do resto (mesmo
  -- critério de elegibilidade das outras portas, `on conflict do nothing`).
  perform public.vessel_stylist_sincronizar_edicao(v_id, v_praca_id, true);

  return json_build_object('ok', true, 'situacao', 'ok', 'codigo', v_codigo);
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_stylist_etapa_criar(p_nome text, p_posicao integer DEFAULT NULL::integer, p_tipo text DEFAULT 'funil'::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_nome text := btrim(coalesce(p_nome, ''));
  v_tipo text := lower(btrim(coalesce(p_tipo, 'funil')));
  v_n    int;
  v_pos  int;
  v_id   bigint;
begin
  if not public.vessel_pode('atendimentos.stylist-circle', 'editar') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  if v_nome = '' then return json_build_object('ok', false, 'situacao', 'sem_nome'); end if;
  if length(v_nome) > 60 then return json_build_object('ok', false, 'situacao', 'nome_longo'); end if;
  if v_tipo not in ('funil', 'saida') then return json_build_object('ok', false, 'situacao', 'tipo_invalido'); end if;

  perform pg_advisory_xact_lock(hashtext('public.vessel_stylist_etapas')::bigint);
  if exists (select 1 from public.vessel_stylist_etapas where ativa and lower(btrim(nome)) = lower(v_nome)) then
    return json_build_object('ok', false, 'situacao', 'nome_repetido');
  end if;
  select count(*)::int into v_n from public.vessel_stylist_etapas where ativa;
  v_pos := least(greatest(coalesce(p_posicao, v_n + 1), 1), v_n + 1);
  update public.vessel_stylist_etapas set ordem = ordem + 1 where ativa and ordem >= v_pos;
  insert into public.vessel_stylist_etapas (nome, ordem, tipo, criado_por, criado_por_nome)
  values (v_nome, v_pos, v_tipo, auth.uid(),
          (select coalesce(nullif(trim(p.name), ''), p.email) from public.profiles p where p.id = auth.uid()))
  returning id into v_id;
  perform public.vessel_stylist_etapas_renumerar();
  perform public.vessel_stylist_etapas_anotar(v_id, 'criar', null,
    jsonb_build_object('nome', v_nome, 'ordem', v_pos, 'tipo', v_tipo));
  return json_build_object('ok', true, 'situacao', 'ok', 'id', v_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_stylist_etapa_excluir(p_id bigint, p_destino bigint DEFAULT NULL::bigint, p_motivo_id bigint DEFAULT NULL::bigint, p_nota text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_e      public.vessel_stylist_etapas%rowtype;
  v_n      int;
  v_recusa text;
  v_saida  boolean;
begin
  if not public.vessel_pode('atendimentos.stylist-circle', 'editar') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  perform pg_advisory_xact_lock(hashtext('public.vessel_stylist_etapas')::bigint);
  select * into v_e from public.vessel_stylist_etapas where id = p_id and ativa;
  if v_e.id is null then return json_build_object('ok', false, 'situacao', 'nao_achei'); end if;
  if v_e.tipo = 'funil' and (select count(*) from public.vessel_stylist_etapas where ativa and tipo = 'funil') <= 1 then
    return json_build_object('ok', false, 'situacao', 'ultima_do_funil');
  end if;
  if v_e.conta_como_prospectada then
    return json_build_object('ok', false, 'situacao', 'etapa_marcada');
  end if;
  select count(*)::int into v_n from public.vessel_stylists where etapa_id = p_id;
  if v_n > 0 then
    if p_destino is null then
      return json_build_object('ok', false, 'situacao', 'precisa_destino', 'stylists', v_n);
    end if;
    if p_destino = p_id or not exists (select 1 from public.vessel_stylist_etapas where id = p_destino and ativa) then
      return json_build_object('ok', false, 'situacao', 'destino_invalido');
    end if;
    v_recusa := public.vessel_stylist_conferir_motivo(p_destino, p_motivo_id, p_nota);
    if v_recusa is not null then
      return json_build_object('ok', false, 'situacao', v_recusa, 'stylists', v_n);
    end if;
    v_saida := (select tipo = 'saida' from public.vessel_stylist_etapas where id = p_destino);
    -- ⚠️ O HISTÓRICO DIZ POR QUE ELAS MUDARAM (o gatilho lê estas variáveis).
    perform set_config('vessel.motivo_da_etapa', 'etapa_excluida', true);
    perform set_config('vessel.motivo_de_saida', case when v_saida then coalesce(p_motivo_id::text, '') else '' end, true);
    perform set_config('vessel.nota_de_saida', case when v_saida then coalesce(btrim(p_nota), '') else '' end, true);
    update public.vessel_stylists set etapa_id = p_destino, atualizado_em = now() where etapa_id = p_id;
    perform set_config('vessel.motivo_da_etapa', '', true);
    perform set_config('vessel.motivo_de_saida', '', true);
    perform set_config('vessel.nota_de_saida', '', true);
  end if;
  update public.vessel_stylist_etapas set ativa = false, excluida_em = now() where id = p_id;
  perform public.vessel_stylist_etapas_renumerar();
  perform public.vessel_stylist_etapas_anotar(p_id, 'excluir',
    jsonb_build_object('nome', v_e.nome, 'ordem', v_e.ordem, 'tipo', v_e.tipo),
    jsonb_build_object('destino', p_destino, 'stylists_movidas', v_n, 'motivo_id', p_motivo_id));
  return json_build_object('ok', true, 'situacao', 'ok', 'id', p_id, 'movidas', v_n);
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_stylist_etapa_liberar_private_edit(p_id bigint, p_libera boolean)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_e public.vessel_stylist_etapas%rowtype;
begin
  if not public.vessel_pode('atendimentos.stylist-circle', 'editar') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  if p_libera is null then return json_build_object('ok', false, 'situacao', 'sem_escolha'); end if;
  perform pg_advisory_xact_lock(hashtext('public.vessel_stylist_etapas')::bigint);
  select * into v_e from public.vessel_stylist_etapas where id = p_id and ativa;
  if v_e.id is null then return json_build_object('ok', false, 'situacao', 'nao_achei'); end if;
  if v_e.libera_private_edit = p_libera then
    return json_build_object('ok', true, 'situacao', 'sem_mudanca', 'id', p_id);
  end if;
  update public.vessel_stylist_etapas set libera_private_edit = p_libera where id = p_id;
  perform public.vessel_stylist_etapas_anotar(p_id, 'libera_private_edit',
    jsonb_build_object('libera_private_edit', v_e.libera_private_edit), jsonb_build_object('libera_private_edit', p_libera));
  return json_build_object('ok', true, 'situacao', 'ok', 'id', p_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_stylist_etapa_marcar_prospectada(p_id bigint)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_e     public.vessel_stylist_etapas%rowtype;
  v_antes bigint;
begin
  if not public.vessel_pode('atendimentos.stylist-circle', 'editar') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  perform pg_advisory_xact_lock(hashtext('public.vessel_stylist_etapas')::bigint);
  select * into v_e from public.vessel_stylist_etapas where id = p_id and ativa;
  if v_e.id is null then return json_build_object('ok', false, 'situacao', 'nao_achei'); end if;
  if v_e.tipo <> 'funil' then return json_build_object('ok', false, 'situacao', 'saida_nao_conta'); end if;
  if v_e.conta_como_prospectada then return json_build_object('ok', true, 'situacao', 'sem_mudanca', 'id', p_id); end if;
  select id into v_antes from public.vessel_stylist_etapas where conta_como_prospectada;
  -- Primeiro desmarca, depois marca: o índice único não aceita duas ao mesmo tempo.
  update public.vessel_stylist_etapas set conta_como_prospectada = false where conta_como_prospectada;
  update public.vessel_stylist_etapas set conta_como_prospectada = true where id = p_id;
  perform public.vessel_stylist_etapas_anotar(p_id, 'marcar_prospectada',
    jsonb_build_object('etapa_marcada', v_antes), jsonb_build_object('etapa_marcada', p_id));
  return json_build_object('ok', true, 'situacao', 'ok', 'id', p_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_stylist_etapa_mover(p_id bigint, p_direcao text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ordem  int;
  v_viz    bigint;
  v_ordviz int;
begin
  if not public.vessel_pode('atendimentos.stylist-circle', 'editar') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  if p_direcao not in ('subir', 'descer') then
    return json_build_object('ok', false, 'situacao', 'direcao_invalida');
  end if;
  perform pg_advisory_xact_lock(hashtext('public.vessel_stylist_etapas')::bigint);
  perform public.vessel_stylist_etapas_renumerar();
  select ordem into v_ordem from public.vessel_stylist_etapas where id = p_id and ativa;
  if v_ordem is null then return json_build_object('ok', false, 'situacao', 'nao_achei'); end if;
  select id, ordem into v_viz, v_ordviz from public.vessel_stylist_etapas
   where ativa and ordem = v_ordem + case when p_direcao = 'subir' then -1 else 1 end;
  if v_viz is null then return json_build_object('ok', false, 'situacao', 'no_limite'); end if;
  update public.vessel_stylist_etapas set ordem = v_ordviz where id = p_id;
  update public.vessel_stylist_etapas set ordem = v_ordem where id = v_viz;
  perform public.vessel_stylist_etapas_anotar(p_id, 'reordenar',
    jsonb_build_object('ordem', v_ordem), jsonb_build_object('ordem', v_ordviz));
  return json_build_object('ok', true, 'situacao', 'ok', 'id', p_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_stylist_etapa_renomear(p_id bigint, p_nome text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_nome  text := btrim(coalesce(p_nome, ''));
  v_antes text;
begin
  if not public.vessel_pode('atendimentos.stylist-circle', 'editar') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  if v_nome = '' then return json_build_object('ok', false, 'situacao', 'sem_nome'); end if;
  if length(v_nome) > 60 then return json_build_object('ok', false, 'situacao', 'nome_longo'); end if;
  perform pg_advisory_xact_lock(hashtext('public.vessel_stylist_etapas')::bigint);
  select nome into v_antes from public.vessel_stylist_etapas where id = p_id and ativa;
  if v_antes is null then return json_build_object('ok', false, 'situacao', 'nao_achei'); end if;
  if exists (select 1 from public.vessel_stylist_etapas
              where ativa and id <> p_id and lower(btrim(nome)) = lower(v_nome)) then
    return json_build_object('ok', false, 'situacao', 'nome_repetido');
  end if;
  update public.vessel_stylist_etapas set nome = v_nome where id = p_id;
  perform public.vessel_stylist_etapas_anotar(p_id, 'renomear',
    jsonb_build_object('nome', v_antes), jsonb_build_object('nome', v_nome));
  return json_build_object('ok', true, 'situacao', 'ok', 'id', p_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_stylist_etapa_tipo(p_id bigint, p_tipo text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tipo  text := lower(btrim(coalesce(p_tipo, '')));
  v_e     public.vessel_stylist_etapas%rowtype;
begin
  if not public.vessel_pode('atendimentos.stylist-circle', 'editar') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  if v_tipo not in ('funil', 'saida') then return json_build_object('ok', false, 'situacao', 'tipo_invalido'); end if;
  perform pg_advisory_xact_lock(hashtext('public.vessel_stylist_etapas')::bigint);
  select * into v_e from public.vessel_stylist_etapas where id = p_id and ativa;
  if v_e.id is null then return json_build_object('ok', false, 'situacao', 'nao_achei'); end if;
  if v_e.tipo = v_tipo then return json_build_object('ok', true, 'situacao', 'sem_mudanca', 'id', p_id); end if;
  if v_tipo = 'saida' then
    if v_e.conta_como_prospectada then
      return json_build_object('ok', false, 'situacao', 'etapa_marcada');
    end if;
    if (select count(*) from public.vessel_stylist_etapas where ativa and tipo = 'funil') <= 1 then
      return json_build_object('ok', false, 'situacao', 'ultima_do_funil');
    end if;
  end if;
  update public.vessel_stylist_etapas set tipo = v_tipo where id = p_id;
  perform public.vessel_stylist_etapas_anotar(p_id, 'tipo',
    jsonb_build_object('tipo', v_e.tipo), jsonb_build_object('tipo', v_tipo));
  return json_build_object('ok', true, 'situacao', 'ok', 'id', p_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_stylist_etapas()
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not (public.vessel_pode('atendimentos.stylist-circle', 'ver') or public.vessel_pode('atendimentos.private-edit', 'ver')) then
    raise exception 'sem permissao' using errcode = '42501';
  end if;
  return coalesce((
    select json_agg(json_build_object(
             'id', e.id, 'nome', e.nome, 'ordem', e.ordem, 'tipo', e.tipo,
             'conta_como_prospectada', e.conta_como_prospectada,
             'libera_private_edit', e.libera_private_edit,
             'stylists', (select count(*)::int from public.vessel_stylists s
                           where s.etapa_id = e.id and not coalesce(s.teste, false)),
             'motivos', coalesce((
               select json_agg(json_build_object(
                        'id', m.id, 'nome', m.nome, 'ordem', m.ordem, 'ativo', m.ativo,
                        'exige_nota', m.exige_nota,
                        'stylists', (select count(*)::int from public.vessel_stylists s
                                      cross join lateral public.vessel_stylist_saida_atual(s.id) a
                                      where s.etapa_id = e.id and not coalesce(s.teste, false)
                                        and a.motivo_id = m.id))
                      order by (not m.ativo), m.ordem, m.id)
                 from public.vessel_stylist_motivos_de_saida m where m.etapa_id = e.id), '[]'::json),
             'stylists_sem_motivo', case when e.tipo = 'saida' then
               (select count(*)::int from public.vessel_stylists s
                  left join lateral public.vessel_stylist_saida_atual(s.id) a on true
                 where s.etapa_id = e.id and not coalesce(s.teste, false) and a.motivo_id is null) end,
             'alterado_em', e.alterado_em, 'alterado_por_nome', e.alterado_por_nome)
           order by e.ordem, e.id)
      from public.vessel_stylist_etapas e where e.ativa), '[]'::json);
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_stylist_etapas_anotar(p_etapa bigint, p_acao text, p_antes jsonb, p_depois jsonb)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  insert into public.vessel_stylist_etapas_trilha (etapa_id, acao, antes, depois, por, por_nome)
  values (p_etapa, p_acao, p_antes, p_depois, auth.uid(),
          (select coalesce(nullif(trim(p.name), ''), p.email) from public.profiles p where p.id = auth.uid()));
  update public.vessel_stylist_etapas
     set alterado_por = auth.uid(),
         alterado_por_nome = (select coalesce(nullif(trim(p.name), ''), p.email) from public.profiles p where p.id = auth.uid()),
         alterado_em = now()
   where id = p_etapa;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_stylist_etapas_renumerar()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  update public.vessel_stylist_etapas e set ordem = x.n
    from (select id, row_number() over (order by ordem, id)::int as n
            from public.vessel_stylist_etapas where ativa) x
   where e.id = x.id and e.ordem is distinct from x.n;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_stylist_historico_de_etapas(p_codigo text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id bigint;
begin
  if not public.vessel_pode('atendimentos.stylist-circle', 'ver') then
    raise exception 'sem permissao' using errcode = '42501';
  end if;
  select id into v_id from public.vessel_stylists where codigo = upper(trim(coalesce(p_codigo, '')));
  return coalesce((
    select json_agg(json_build_object(
             'id', h.id, 'de', de.nome, 'para', para.nome, 'motivo', h.motivo,
             'motivo_de_saida_id', h.motivo_id, 'motivo_de_saida', m.nome, 'nota', h.nota,
             'por_nome', h.por_nome, 'em', h.em) order by h.em desc, h.id desc)
      from public.vessel_stylist_etapas_historico h
      left join public.vessel_stylist_etapas de on de.id = h.de_etapa_id
      join public.vessel_stylist_etapas para on para.id = h.para_etapa_id
      left join public.vessel_stylist_motivos_de_saida m on m.id = h.motivo_id
     where h.stylist_id = v_id), '[]'::json);
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_stylist_motivo_anotar(p_id bigint, p_acao text, p_antes jsonb, p_depois jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_etapa bigint;
begin
  update public.vessel_stylist_motivos_de_saida
     set alterado_por = auth.uid(),
         alterado_por_nome = (select coalesce(nullif(trim(p.name), ''), p.email) from public.profiles p where p.id = auth.uid()),
         alterado_em = now()
   where id = p_id
  returning etapa_id into v_etapa;
  perform public.vessel_stylist_etapas_anotar(v_etapa, p_acao,
    coalesce(p_antes, '{}'::jsonb) || jsonb_build_object('motivo_id', p_id),
    coalesce(p_depois, '{}'::jsonb) || jsonb_build_object('motivo_id', p_id));
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_stylist_motivo_ativar(p_id bigint, p_ativo boolean)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_m public.vessel_stylist_motivos_de_saida%rowtype;
begin
  if not public.vessel_pode('atendimentos.stylist-circle', 'editar') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  if p_ativo is null then return json_build_object('ok', false, 'situacao', 'sem_escolha'); end if;
  perform pg_advisory_xact_lock(hashtext('public.vessel_stylist_etapas')::bigint);
  select * into v_m from public.vessel_stylist_motivos_de_saida where id = p_id;
  if v_m.id is null then return json_build_object('ok', false, 'situacao', 'nao_achei'); end if;
  if v_m.ativo = p_ativo then return json_build_object('ok', true, 'situacao', 'sem_mudanca', 'id', p_id); end if;
  if p_ativo and exists (select 1 from public.vessel_stylist_motivos_de_saida
                          where etapa_id = v_m.etapa_id and ativo and lower(btrim(nome)) = lower(btrim(v_m.nome))) then
    return json_build_object('ok', false, 'situacao', 'nome_repetido');
  end if;
  update public.vessel_stylist_motivos_de_saida
     set ativo = p_ativo,
         ordem = case when p_ativo then (select coalesce(max(ordem), 0) + 1 from public.vessel_stylist_motivos_de_saida
                                          where etapa_id = v_m.etapa_id and ativo) else ordem end
   where id = p_id;
  perform public.vessel_stylist_motivos_renumerar(v_m.etapa_id);
  perform public.vessel_stylist_motivo_anotar(p_id, 'motivo_ativar',
    jsonb_build_object('ativo', v_m.ativo), jsonb_build_object('ativo', p_ativo));
  return json_build_object('ok', true, 'situacao', 'ok', 'id', p_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_stylist_motivo_criar(p_etapa_id bigint, p_nome text, p_exige_nota boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_nome text := btrim(coalesce(p_nome, ''));
  v_e    public.vessel_stylist_etapas%rowtype;
  v_id   bigint;
begin
  if not public.vessel_pode('atendimentos.stylist-circle', 'editar') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  if v_nome = '' then return json_build_object('ok', false, 'situacao', 'sem_nome'); end if;
  if length(v_nome) > 80 then return json_build_object('ok', false, 'situacao', 'motivo_longo'); end if;
  perform pg_advisory_xact_lock(hashtext('public.vessel_stylist_etapas')::bigint);
  select * into v_e from public.vessel_stylist_etapas where id = p_etapa_id and ativa;
  if v_e.id is null then return json_build_object('ok', false, 'situacao', 'nao_achei'); end if;
  if v_e.tipo <> 'saida' then return json_build_object('ok', false, 'situacao', 'so_saida'); end if;
  if exists (select 1 from public.vessel_stylist_motivos_de_saida
              where etapa_id = p_etapa_id and ativo and lower(btrim(nome)) = lower(v_nome)) then
    return json_build_object('ok', false, 'situacao', 'nome_repetido');
  end if;
  insert into public.vessel_stylist_motivos_de_saida
    (etapa_id, nome, ordem, exige_nota, criado_por, criado_por_nome, alterado_por, alterado_por_nome)
  values (p_etapa_id, v_nome,
          (select coalesce(max(ordem), 0) + 1 from public.vessel_stylist_motivos_de_saida where etapa_id = p_etapa_id and ativo),
          coalesce(p_exige_nota, false), auth.uid(),
          (select coalesce(nullif(trim(p.name), ''), p.email) from public.profiles p where p.id = auth.uid()),
          auth.uid(),
          (select coalesce(nullif(trim(p.name), ''), p.email) from public.profiles p where p.id = auth.uid()))
  returning id into v_id;
  perform public.vessel_stylist_motivo_anotar(v_id, 'motivo_criar', null,
    jsonb_build_object('nome', v_nome, 'exige_nota', coalesce(p_exige_nota, false)));
  return json_build_object('ok', true, 'situacao', 'ok', 'id', v_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_stylist_motivo_exigir_nota(p_id bigint, p_exige boolean)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_m public.vessel_stylist_motivos_de_saida%rowtype;
begin
  if not public.vessel_pode('atendimentos.stylist-circle', 'editar') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  if p_exige is null then return json_build_object('ok', false, 'situacao', 'sem_escolha'); end if;
  select * into v_m from public.vessel_stylist_motivos_de_saida where id = p_id;
  if v_m.id is null then return json_build_object('ok', false, 'situacao', 'nao_achei'); end if;
  if v_m.exige_nota = p_exige then return json_build_object('ok', true, 'situacao', 'sem_mudanca', 'id', p_id); end if;
  update public.vessel_stylist_motivos_de_saida set exige_nota = p_exige where id = p_id;
  perform public.vessel_stylist_motivo_anotar(p_id, 'motivo_exige_nota',
    jsonb_build_object('exige_nota', v_m.exige_nota), jsonb_build_object('exige_nota', p_exige));
  return json_build_object('ok', true, 'situacao', 'ok', 'id', p_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_stylist_motivo_mover(p_id bigint, p_direcao text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_m      public.vessel_stylist_motivos_de_saida%rowtype;
  v_viz    bigint;
  v_ordviz int;
begin
  if not public.vessel_pode('atendimentos.stylist-circle', 'editar') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  if p_direcao not in ('subir', 'descer') then
    return json_build_object('ok', false, 'situacao', 'direcao_invalida');
  end if;
  perform pg_advisory_xact_lock(hashtext('public.vessel_stylist_etapas')::bigint);
  select * into v_m from public.vessel_stylist_motivos_de_saida where id = p_id and ativo;
  if v_m.id is null then return json_build_object('ok', false, 'situacao', 'nao_achei'); end if;
  perform public.vessel_stylist_motivos_renumerar(v_m.etapa_id);
  select * into v_m from public.vessel_stylist_motivos_de_saida where id = p_id;
  select id, ordem into v_viz, v_ordviz from public.vessel_stylist_motivos_de_saida
   where etapa_id = v_m.etapa_id and ativo
     and ordem = v_m.ordem + case when p_direcao = 'subir' then -1 else 1 end;
  if v_viz is null then return json_build_object('ok', false, 'situacao', 'no_limite'); end if;
  update public.vessel_stylist_motivos_de_saida set ordem = v_ordviz where id = p_id;
  update public.vessel_stylist_motivos_de_saida set ordem = v_m.ordem where id = v_viz;
  perform public.vessel_stylist_motivo_anotar(p_id, 'motivo_reordenar',
    jsonb_build_object('ordem', v_m.ordem), jsonb_build_object('ordem', v_ordviz));
  return json_build_object('ok', true, 'situacao', 'ok', 'id', p_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_stylist_motivo_renomear(p_id bigint, p_nome text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_nome text := btrim(coalesce(p_nome, ''));
  v_m    public.vessel_stylist_motivos_de_saida%rowtype;
begin
  if not public.vessel_pode('atendimentos.stylist-circle', 'editar') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  if v_nome = '' then return json_build_object('ok', false, 'situacao', 'sem_nome'); end if;
  if length(v_nome) > 80 then return json_build_object('ok', false, 'situacao', 'motivo_longo'); end if;
  perform pg_advisory_xact_lock(hashtext('public.vessel_stylist_etapas')::bigint);
  select * into v_m from public.vessel_stylist_motivos_de_saida where id = p_id;
  if v_m.id is null then return json_build_object('ok', false, 'situacao', 'nao_achei'); end if;
  if exists (select 1 from public.vessel_stylist_motivos_de_saida
              where etapa_id = v_m.etapa_id and ativo and id <> p_id and lower(btrim(nome)) = lower(v_nome)) then
    return json_build_object('ok', false, 'situacao', 'nome_repetido');
  end if;
  update public.vessel_stylist_motivos_de_saida set nome = v_nome where id = p_id;
  perform public.vessel_stylist_motivo_anotar(p_id, 'motivo_renomear',
    jsonb_build_object('nome', v_m.nome), jsonb_build_object('nome', v_nome));
  return json_build_object('ok', true, 'situacao', 'ok', 'id', p_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_stylist_motivos_renumerar(p_etapa bigint)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  update public.vessel_stylist_motivos_de_saida m set ordem = x.n
    from (select id, row_number() over (order by ordem, id)::int as n
            from public.vessel_stylist_motivos_de_saida where etapa_id = p_etapa and ativo) x
   where m.id = x.id and m.ordem is distinct from x.n;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_stylist_mover_de_etapa(p_codigo text, p_etapa_id bigint, p_motivo_id bigint DEFAULT NULL::bigint, p_nota text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_codigo text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
  v_s      public.vessel_stylists%rowtype;
  v_e      public.vessel_stylist_etapas%rowtype;
  v_recusa text;
  v_saida  boolean;
begin
  if not public.vessel_pode('atendimentos.stylist-circle', 'editar') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  select * into v_s from public.vessel_stylists where codigo = v_codigo;
  if v_s.id is null then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;
  select * into v_e from public.vessel_stylist_etapas e where e.id = p_etapa_id and e.ativa;
  if v_e.id is null then
    return json_build_object('ok', false, 'situacao', 'etapa_invalida');
  end if;
  if v_s.etapa_id = p_etapa_id then
    return json_build_object('ok', true, 'situacao', 'sem_mudanca', 'codigo', v_codigo);
  end if;
  v_recusa := public.vessel_stylist_conferir_motivo(p_etapa_id, p_motivo_id, p_nota);
  if v_recusa is not null then
    return json_build_object('ok', false, 'situacao', v_recusa, 'etapa', v_e.nome);
  end if;
  v_saida := v_e.tipo = 'saida';
  perform set_config('vessel.motivo_de_saida', case when v_saida then coalesce(p_motivo_id::text, '') else '' end, true);
  perform set_config('vessel.nota_de_saida', case when v_saida then coalesce(btrim(p_nota), '') else '' end, true);
  update public.vessel_stylists set etapa_id = p_etapa_id, atualizado_em = now() where id = v_s.id;
  perform set_config('vessel.motivo_de_saida', '', true);
  perform set_config('vessel.nota_de_saida', '', true);
  -- 28/09: o mesmo movimento marca a turma do evento (seção 3)
  perform public.vessel_edicao_marcar_movimento(v_s.id, p_etapa_id, case when v_saida then p_motivo_id end);
  return json_build_object('ok', true, 'situacao', 'ok', 'codigo', v_codigo,
    'etapa', v_e.nome, 'libera_private_edit', v_e.libera_private_edit,
    'prospectado_em', (select prospectado_em from public.vessel_stylists where id = v_s.id));
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_stylist_qualificacoes(p_codigo text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_saida json;
begin
  if not public.vessel_pode('atendimentos.stylist-circle', 'ver') then return '[]'::json; end if;
  select coalesce(json_agg(json_build_object(
           'id', q.id, 'carteira', q.carteira, 'portfolio', q.portfolio,
           'mobilizacao', q.mobilizacao, 'acesso', q.acesso, 'confiabilidade', q.confiabilidade,
           'nota', q.nota, 'faixa', q.faixa, 'observacao', q.observacao,
           'avaliado_em', q.avaliado_em, 'avaliado_por_nome', q.avaliado_por_nome)
         order by q.avaliado_em desc, q.id desc), '[]'::json)
    into v_saida
    from public.vessel_stylist_qualificacoes q
    join public.vessel_stylists s on s.id = q.stylist_id
   where s.codigo = upper(nullif(trim(coalesce(p_codigo, '')), ''));
  return v_saida;
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_stylist_qualificacoes_so_acrescenta()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  raise exception 'avaliacao de stylist nao se edita nem se apaga: registre uma nova'
    using errcode = '42501';
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_stylist_registrar_contato(p_codigo text, p_canal text, p_resultado text, p_nota text DEFAULT NULL::text, p_proxima_acao text DEFAULT NULL::text, p_proxima_acao_em date DEFAULT NULL::date)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_codigo text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
  v_canal  text := lower(nullif(trim(coalesce(p_canal, '')), ''));
  v_res    text := lower(nullif(trim(coalesce(p_resultado, '')), ''));
  v_nota   text := nullif(trim(coalesce(p_nota, '')), '');
  v_s      public.vessel_stylists%rowtype;
  v_id     bigint;
begin
  if not public.vessel_pode('atendimentos.stylist-circle', 'editar') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  select * into v_s from public.vessel_stylists where codigo = v_codigo;
  if v_s.id is null then return json_build_object('ok', false, 'situacao', 'nao_achei'); end if;
  if v_canal is null or v_canal not in ('whatsapp', 'ligacao', 'instagram', 'email', 'presencial') then
    return json_build_object('ok', false, 'situacao', 'canal_invalido');
  end if;
  if v_res is null or v_res not in ('sem_resposta', 'conversou', 'interesse', 'proposta', 'marcou_encontro', 'recusou') then
    return json_build_object('ok', false, 'situacao', 'resultado_invalido');
  end if;
  if v_nota is not null and length(v_nota) > 500 then
    return json_build_object('ok', false, 'situacao', 'nota_longa');
  end if;

  insert into public.vessel_stylist_contatos
    (stylist_id, canal, resultado, nota, criado_por, criado_por_nome, teste)
  values (v_s.id, v_canal, v_res, v_nota, auth.uid(),
          (select coalesce(nullif(trim(p.name), ''), p.email) from public.profiles p where p.id = auth.uid()),
          v_s.teste)
  returning id into v_id;

  -- A próxima ação escrita aqui SUBSTITUI a de hoje; vazia, a de hoje fica.
  if nullif(trim(coalesce(p_proxima_acao, '')), '') is not null then
    update public.vessel_stylists
       set proxima_acao = trim(p_proxima_acao), proxima_acao_em = p_proxima_acao_em, atualizado_em = now()
     where id = v_s.id;
  end if;

  -- ⚠️ SEM `sugestao` (24/09/2026): nenhum movimento de etapa sai de um contato.
  return json_build_object('ok', true, 'situacao', 'ok', 'id', v_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_stylist_saida_atual(p_stylist bigint)
 RETURNS TABLE(motivo_id bigint, nota text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select h.motivo_id, h.nota
    from public.vessel_stylist_etapas_historico h
   where h.stylist_id = p_stylist
   order by h.id desc
   limit 1
$function$;

CREATE OR REPLACE FUNCTION public.vessel_stylist_seguir_os_encontros(p_stylist bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_stylist is null then return; end if;
  if exists (select 1 from public.vessel_private_edits e
              where e.stylist_id = p_stylist and not coalesce(e.arquivada, false)
                and e.status in ('agendado', 'confirmado', 'reagendado',
                                 'realizado', 'nao_realizado', 'cancelado')) then
    update public.vessel_stylists set ativada_em = now()
     where id = p_stylist and ativada_em is null;
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_stylist_sincronizar_edicao(p_stylist_id bigint, p_praca_id bigint, p_fechar_antigo boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  return;
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_stylists_etapa_antes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_motivo bigint;
  v_nota   text;
  v_m      public.vessel_stylist_motivos_de_saida%rowtype;
begin
  -- Cadastro novo entra na PRIMEIRA etapa de funil, pela ordem.
  if new.etapa_id is null then
    select e.id into new.etapa_id from public.vessel_stylist_etapas e
     where e.ativa and e.tipo = 'funil' order by e.ordem, e.id limit 1;
  end if;
  if not exists (select 1 from public.vessel_stylist_etapas e where e.id = new.etapa_id and e.ativa) then
    raise exception 'etapa % nao existe ou foi excluida', new.etapa_id using errcode = '23503';
  end if;
  -- ⚠️ O CINTO DO MOTIVO (24/09/2026): chegar numa saída com motivos ativos
  -- exige um motivo DELA, ativo, e a nota quando o motivo pede.
  if (tg_op = 'INSERT' or new.etapa_id is distinct from old.etapa_id)
     and exists (select 1 from public.vessel_stylist_etapas e
                  where e.id = new.etapa_id and e.tipo = 'saida')
     and exists (select 1 from public.vessel_stylist_motivos_de_saida m
                  where m.etapa_id = new.etapa_id and m.ativo) then
    v_motivo := nullif(current_setting('vessel.motivo_de_saida', true), '')::bigint;
    v_nota   := nullif(btrim(coalesce(current_setting('vessel.nota_de_saida', true), '')), '');
    select * into v_m from public.vessel_stylist_motivos_de_saida m
     where m.id = v_motivo and m.etapa_id = new.etapa_id and m.ativo;
    if v_m.id is null then
      raise exception 'a saida % exige um motivo ativo dela', new.etapa_id using errcode = '23514';
    end if;
    if v_m.exige_nota and v_nota is null then
      raise exception 'o motivo % exige nota', v_m.id using errcode = '23514';
    end if;
  end if;
  -- ⚠️ A DATA DA PROSPECÇÃO: uma vez só, na primeira chegada.
  if new.prospectado_em is null and public.vessel_etapa_conta_como_prospectada(new.etapa_id) then
    new.prospectado_em := (now() at time zone 'America/Sao_Paulo')::date;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_stylists_etapa_depois()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_saida  boolean;
  v_motivo bigint;
  v_nota   text;
begin
  if tg_op = 'INSERT' or new.etapa_id is distinct from old.etapa_id then
    select e.tipo = 'saida' into v_saida from public.vessel_stylist_etapas e where e.id = new.etapa_id;
    -- O motivo e a nota só valem para a chegada numa SAÍDA; o motivo, só se
    -- for desta saída (o cinto de antes já recusou o resto).
    if coalesce(v_saida, false) then
      select m.id into v_motivo from public.vessel_stylist_motivos_de_saida m
       where m.id = nullif(current_setting('vessel.motivo_de_saida', true), '')::bigint
         and m.etapa_id = new.etapa_id;
      v_nota := nullif(btrim(coalesce(current_setting('vessel.nota_de_saida', true), '')), '');
    else
      -- 28/09: a volta do "indisponível na data" escreve a nota dela aqui
      v_nota := nullif(btrim(coalesce(current_setting('vessel.nota_da_volta', true), '')), '');
    end if;
    insert into public.vessel_stylist_etapas_historico
      (stylist_id, de_etapa_id, para_etapa_id, motivo, por, por_nome, teste, motivo_id, nota, liberava_private_edit)
    values (new.id,
            case when tg_op = 'INSERT' then null else old.etapa_id end,
            new.etapa_id,
            case when tg_op = 'INSERT' then 'cadastro'
                 -- quem muda por exclusão de etapa avisa por esta variável da transação
                 when current_setting('vessel.motivo_da_etapa', true) = 'etapa_excluida' then 'etapa_excluida'
                 else 'mudanca' end,
            auth.uid(),
            (select coalesce(nullif(trim(p.name), ''), p.email) from public.profiles p where p.id = auth.uid()),
            new.teste,
            v_motivo,
            v_nota,
            coalesce((select e.libera_private_edit from public.vessel_stylist_etapas e where e.id = new.etapa_id), false));
  end if;
  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_stylists_para_escolher()
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_saida json;
begin
  if not public.vessel_pode('atendimentos.private-edit', 'ver') then
    raise exception 'sem permissao' using errcode = '42501';
  end if;
  -- ⚠️ 24/09/2026: + `etapa` e `libera_private_edit`. A lista continua com
  -- TODAS as ativas (o cartão da convidada lê o WhatsApp da anfitriã de
  -- encontros antigos); "só as liberadas" para o encontro novo é a tela.
  select coalesce(json_agg(json_build_object('codigo', s.codigo, 'nome', s.nome,
                                             'cidade', s.cidade, 'whatsapp', s.whatsapp,
                                             'etapa', e.nome,
                                             'libera_private_edit', coalesce(e.libera_private_edit, false))
                           order by s.codigo), '[]'::json)
    into v_saida
    from public.vessel_stylists s
    left join public.vessel_stylist_etapas e on e.id = s.etapa_id
   where not coalesce(s.teste, false)
     and coalesce(s.ativa, true);
  return v_saida;
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_stylists_sem_contato_some()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if new.whatsapp is not null or nullif(btrim(coalesce(new.instagram, '')), '') is not null then
    new.sem_contato := false;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_telefone_canonico(p_bruto text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
declare
  d text := regexp_replace(coalesce(p_bruto, ''), '\D', '', 'g');
begin
  -- Sem país: 10 dígitos (fixo com DDD) ou 11 (celular com DDD).
  if length(d) in (10, 11) then
    return '55' || d;
  end if;
  -- Com país já na frente.
  if length(d) in (12, 13) and left(d, 2) = '55' then
    return d;
  end if;
  return null;   -- qualquer outra coisa é telefone que não dá para usar
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_vendas_dos_encontros(p_dias integer DEFAULT 14)
 RETURNS TABLE(pedido_id bigint, evento_codigo text, stylist_id bigint, pessoa_id bigint, receita numeric, pecas numeric, quando_do_encontro timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select distinct on (p.id)
         p.id, e.codigo, e.stylist_id, p.pessoa_id,
         coalesce(p.receita_liquida, p.total_corrigido, 0),
         coalesce((select sum(i.quantidade) from public.vessel_pedido_itens i
                    where i.pedido_id = p.id), 0),
         e.quando
    from public.vessel_pedidos p
    join public.vessel_atendimentos t
      on t.pessoa_id = p.pessoa_id
     and t.evento_codigo is not null
     and t.status = 'realizado'
     and not coalesce(t.teste, false)
    join public.vessel_private_edits e
      on e.codigo = t.evento_codigo
     and not coalesce(e.teste, false)
     and not coalesce(e.arquivada, false)
   where p.situacao_id = 9
     and p.data_do_pedido
           between (e.quando at time zone 'America/Sao_Paulo')::date
               and (e.quando at time zone 'America/Sao_Paulo')::date
                   + greatest(coalesce(p_dias, 14), 0)
   order by p.id, e.quando, e.id
$function$;

-- gatilhos vivos
create or replace trigger vessel_atendimentos_atualizado before update on public.vessel_atendimentos
  for each row execute function public.vessel_toca_atualizado_em();

create or replace trigger vessel_lista_espera_espelhar AFTER INSERT or UPDATE on public.vessel_lista_espera for each row EXECUTE FUNCTION vessel_espelhar_agora();

create or replace trigger vessel_pessoas_atualizado before update on public.vessel_pessoas
  for each row execute function public.vessel_toca_atualizado_em();

create or replace trigger vessel_private_edits_funil
  after insert or update or delete on public.vessel_private_edits
  for each row execute function public.vessel_private_edits_mexe_no_funil();

create or replace trigger vessel_rd_na_fila
  after insert on public.vessel_origens
  for each row execute function public.vessel_rd_na_fila();

create or replace trigger vessel_stylist_etapas_historico_so_acrescenta
  before update or delete on public.vessel_stylist_etapas_historico
  for each row execute function public.vessel_so_acrescenta();

create or replace trigger vessel_stylist_etapas_trilha_so_acrescenta
  before update or delete on public.vessel_stylist_etapas_trilha
  for each row execute function public.vessel_so_acrescenta();

create or replace trigger vessel_stylist_motivos_de_saida_nao_se_apaga
  before delete on public.vessel_stylist_motivos_de_saida
  for each row execute function public.vessel_motivo_de_saida_nao_se_apaga();

create or replace trigger vessel_stylist_qualificacoes_so_acrescenta
  before update or delete on public.vessel_stylist_qualificacoes
  for each row execute function public.vessel_stylist_qualificacoes_so_acrescenta();

create or replace trigger vessel_stylists_etapa_antes
  before insert or update of etapa_id on public.vessel_stylists
  for each row execute function public.vessel_stylists_etapa_antes();

create or replace trigger vessel_stylists_etapa_depois
  after insert or update of etapa_id on public.vessel_stylists
  for each row execute function public.vessel_stylists_etapa_depois();

create or replace trigger vessel_stylists_sem_contato_some
  before insert or update of whatsapp, instagram, sem_contato on public.vessel_stylists
  for each row execute function public.vessel_stylists_sem_contato_some();
