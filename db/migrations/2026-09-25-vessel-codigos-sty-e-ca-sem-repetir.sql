-- OS CÓDIGOS STY E CA NUNCA SE REPETEM.
--
-- Pedido do dono (pacote de pequenos consertos, 25/09/2026). Dois geradores de
-- código ainda eram "quantas linhas há + 1" — o mesmo defeito consertado para
-- o código do encontro em `2026-09-24-vessel-codigo-do-encontro-sem-repetir.sql`.
-- Depois de uma exclusão, a conta fica menor que o maior número já dado e o
-- próximo nasce com um código que JÁ EXISTE: erro de chave duplicada.
--
--   · `vessel_pedido_do_stylist` (a inscrição da página do Stylist Circle):
--     passa a usar a MESMA regra e a MESMA trava de `vessel_stylist_criar` (o
--     cadastro pela equipe, que já era "maior + 1" desde 19/09 e foi recriado
--     por `2026-09-24-vessel-stylist-sem-contato.sql` — ela NÃO é tocada aqui).
--     Com a mesma trava, uma inscrição da página e um cadastro da equipe ao
--     mesmo tempo esperam um pelo outro.
--   · `vessel_identificar_client_advisor` (a Client Advisor se identifica na
--     página do cartão): "maior + 1" com trava própria, contando também o CA
--     que só ficou nas visitas e nas aberturas (Client Advisor apagada deixa o
--     código lá — reusá-lo juntaria duas pessoas na mesma linha do painel).
--
-- As duas funções mantêm a MESMA assinatura e a mesma resposta; `create or
-- replace` guarda os grants de hoje (as duas são portas públicas: `anon`).
-- ⚠️ CÓDIGOS QUE JÁ EXISTEM NÃO MUDAM: estão em links de rastreio e cartões já
-- entregues. Nada aqui faz `update` de código.

create or replace function public.vessel_pedido_do_stylist(p_nome text, p_whatsapp text, p_cidade text DEFAULT NULL::text, p_instagram text DEFAULT NULL::text, p_atuacao text DEFAULT NULL::text, p_quer_sessao text DEFAULT NULL::text, p_convidadas text DEFAULT NULL::text, p_praca text DEFAULT NULL::text, p_aceite_marketing boolean DEFAULT false, p_aceite_versao text DEFAULT NULL::text, p_origem jsonb DEFAULT NULL::jsonb, p_armadilha text DEFAULT NULL::text, p_teste boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ip       text := public.vessel_hash_de_origem();
  v_fone     text;
  v_recentes int;
  v_id       bigint;
  v_codigo   text;
  v_n        int;
  v_volta    int;
  v_indice   text;
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
    --
    -- ⚠️ 25/09/2026 (o código sem repetir): era "quantas stylists há + 1". Uma
    -- stylist apagada deixa a conta menor que o maior número dado, e a próxima
    -- inscrição recebia um STY que JÁ EXISTE — a inscrição da página quebrava
    -- com chave duplicada (`vessel_stylists_codigo_idx`). Agora é a MESMA regra
    -- de `vessel_stylist_criar` (a do cadastro pela equipe, desde 19/09): a
    -- FILA com a MESMA trava (as duas portas esperam uma pela outra), o MAIOR
    -- número já dado + 1, pulando o que já existir, e o CINTO (`unique_violation`
    -- no código avança e tenta de novo). Códigos que já existem não mudam.
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
        -- Sem número livre: a pessoa não pode ver erro nem saber por quê.
        return json_build_object('ok', true, 'situacao', 'recebido');
      end if;

      begin
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
        exit;
      exception when unique_violation then
        get stacked diagnostics v_indice = constraint_name;
        if v_indice is distinct from 'vessel_stylists_codigo_idx' then
          raise;                               -- outra coisa: não é para engolir
        end if;                                -- o código: conta de novo na volta
        v_id := null;
      end;
    end loop;
    if v_id is null then
      select id, codigo into v_id, v_codigo from public.vessel_stylists where whatsapp = v_fone;
    end if;
    if v_id is null then
      -- as três voltas perderam a disputa do código: responde calmo, sem gravar
      return json_build_object('ok', true, 'situacao', 'recebido');
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

create or replace function public.vessel_identificar_client_advisor(p_nome text, p_loja text DEFAULT NULL::text, p_teste boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_chave  text := public.vessel_chave_do_nome(p_nome);
  v_ca     public.vessel_client_advisors%rowtype;
  v_codigo text;
  v_n      int;
  v_vend   json;
  v_volta  int;
  v_indice text;
begin
  if length(v_chave) < 2 then
    return json_build_object('ok', false, 'erro', 'Escreva o seu nome.');
  end if;

  select * into v_ca from public.vessel_client_advisors where chave = v_chave;

  if v_ca.id is null then
    -- Teto de gente: sem ele, um robô que descubra o endereço criaria
    -- Client Advisors sem fim.
    select count(*) into v_n from public.vessel_client_advisors;
    if v_n >= 200 then
      return json_build_object('ok', false, 'erro', 'Fale com quem cuida do sistema.');
    end if;

    -- ⚠️ 25/09/2026 (o código sem repetir): era "quantas há + 1". Uma Client
    -- Advisor apagada deixava o número dela livre na conta, e a próxima recebia
    -- um CA que já existe (chave duplicada, a tela dela quebrava) — ou, se o
    -- número era o maior, o CA de alguém que já tem visitas e aberturas no
    -- nome. Agora: a FILA (trava até o fim da transação: duas identificações
    -- ao mesmo tempo esperam uma pela outra), o MAIOR número já dado + 1 —
    -- contando também o CA que só ficou nas visitas (`vessel_atendimentos`) e
    -- nas aberturas do convite (`vessel_convite_aberturas`) — pulando o que já
    -- aparecer em qualquer um dos três lugares, e o CINTO (`unique_violation`
    -- no código avança e tenta de novo). Códigos que já existem não mudam.
    -- O `lpad` só completa até 2 dígitos: `lpad('100', 2)` CORTARIA para '10'.
    perform pg_advisory_xact_lock(hashtext('public.vessel_client_advisors.codigo')::bigint);
    select coalesce(max(n), 0) into v_n from (
      select (substring(codigo from '^CA-([0-9]{1,6})$'))::int as n from public.vessel_client_advisors
      union all
      select (substring(client_advisor from '^CA-([0-9]{1,6})$'))::int from public.vessel_atendimentos
      union all
      select (substring(client_advisor from '^CA-([0-9]{1,6})$'))::int from public.vessel_convite_aberturas
    ) usados;

    for v_volta in 1..5 loop
      loop
        v_n := v_n + 1;
        v_codigo := 'CA-' || lpad(v_n::text, greatest(2, length(v_n::text)), '0');
        exit when not exists (select 1 from public.vessel_client_advisors where codigo = v_codigo)
              and not exists (select 1 from public.vessel_atendimentos where client_advisor = v_codigo)
              and not exists (select 1 from public.vessel_convite_aberturas where client_advisor = v_codigo);
      end loop;
      begin
        insert into public.vessel_client_advisors (codigo, nome, chave, loja, teste)
        values (v_codigo, trim(p_nome), v_chave, nullif(trim(p_loja), ''), coalesce(p_teste, false))
        on conflict (chave) do nothing;
        exit;
      exception when unique_violation then
        get stacked diagnostics v_indice = constraint_name;
        if v_indice is distinct from 'vessel_client_advisors_codigo_idx' then
          raise;
        end if;
      end;
    end loop;
    select * into v_ca from public.vessel_client_advisors where chave = v_chave;
    if v_ca.id is null then
      return json_build_object('ok', false, 'erro', 'Não consegui te identificar agora. Tente de novo em um instante.');
    end if;
  else
    -- A loja pode mudar (alguém cobrindo outra unidade); o código, não.
    update public.vessel_client_advisors
       set loja = coalesce(nullif(trim(p_loja), ''), loja)
     where id = v_ca.id;
  end if;

  -- O bloco do vendedor, que é a novidade.
  if v_ca.bling_vendedor_id is not null then
    select json_build_object('ligado', json_build_object('id', v.bling_vendedor_id, 'nome', v.nome))
      into v_vend
      from public.vessel_vendedores_bling v
     where v.bling_vendedor_id = v_ca.bling_vendedor_id;
    v_vend := coalesce(v_vend, json_build_object('ligado',
      json_build_object('id', v_ca.bling_vendedor_id, 'nome', v_ca.nome)));
  elsif v_ca.vendedor_dispensado_em is not null then
    -- Ela já olhou a lista e não se achou. Não pergunta de novo.
    v_vend := json_build_object('parecidos', '[]'::json);
  else
    v_vend := json_build_object('parecidos', public.vessel_vendedores_parecidos(p_nome));
  end if;

  return json_build_object('ok', true, 'codigo', v_ca.codigo, 'vendedor', v_vend);
end;
$function$;

notify pgrst, 'reload schema';
