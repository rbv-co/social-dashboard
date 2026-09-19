-- O LEMBRETE PARA REGISTRAR DEPOIS ("Register Later", Registered Pieces)
--
-- Desenho: docs/superpowers/specs/2026-09-19-register-later-design.md
-- (decidido pelo dono em 19/09/2026).
--
-- A cliente abre a página da peça, não quer registrar agora, deixa o e-mail e
-- marca "pode me lembrar por e-mail sobre esta peça". Em 7 e em 30 dias um
-- robô manda um e-mail com o link do certificado daquela peça. O lembrete
-- morre sozinho quando a peça for registrada, por quem for, e todo e-mail tem
-- "não quero mais receber" em um toque, sem login.
--
-- ⚠️ O NOME TEM "zzz-" DE PROPÓSITO. No mesmo dia existe
-- 2026-09-19-zz-vessel-trilha-a-lista-inteira.sql, que devolve a lista fechada
-- de `vessel_edicoes.acao` com as 14 ações. "zz-" < "zzz" porque o hífen é menor
-- que a letra: assim este arquivo roda DEPOIS do conserto da lista, e nunca
-- atropela nenhuma das cinco migrations do mesmo dia.
--
-- ⚠️ NADA AQUI SE PASSA POR ADMIN. `is_vessel_admin()` só aparece na política
-- de LEITURA do painel. A cliente nunca é `authenticated` neste banco (ver o
-- cabeçalho de 2026-09-17-vessel-contas-base.sql) — e aqui ela nem precisa ter
-- conta: o lembrete é para quem AINDA NÃO registrou.
--
-- ⚠️ pgcrypto mora no schema `extensions`: todo `digest` e `gen_random_bytes`
-- vem qualificado. Sem isso, quebra com search_path=public (mesma armadilha de
-- 2026-09-16-vessel-pessoas-e-atendimentos.sql).
--
-- ⚠️ ESTE ARQUIVO NÃO ENCOSTA NA LISTA FECHADA DE `vessel_edicoes.acao`.
-- Medida no banco em 19/09/2026, ela tem 14 ações, e redigitá-la por cima
-- apaga a ação de outra entrega — foi o que aconteceu no dia anterior. O
-- lembrete não precisa de ação nova: a trilha dele é a própria tabela abaixo,
-- que o painel lê inteira (peça, e-mail, quando pediu, o que já saiu, estado).
--
-- ══════════════════════════════════════════════════════════════════════════
-- A DECISÃO QUE O DESENHO DEIXOU EM ABERTO: gatilho ou dentro da função que
-- já grava o registro? → GATILHO. Três medições, no banco, em 19/09/2026:
--
--   1. QUEM GRAVA EM `vessel_registros` (varredura de `pg_get_functiondef`
--      sobre todo o schema public):
--        INSERT  vessel_decidir_pedido_de_registro(uuid,text,text,jsonb,text)
--        UPDATE  vessel_trocar_dono, vessel_conta_criar,
--                vessel_lote_material_recalcula_garantia,
--                vessel_transferencia_aceitar
--      Ou seja: UMA função faz a peça GANHAR dona; as outras quatro só mexem
--      em linha que já existe — peça que já tem dona nunca teve lembrete
--      aberto, porque criar lembrete em peça registrada é recusado.
--
--   2. `vessel_registros` tem RLS ligada e UMA política, só de SELECT, para
--      `authenticated` gateada por `is_vessel_admin()`. Não há escrita por
--      PostgREST: toda gravação passa por função `security definer`. O
--      gatilho, portanto, vê TODOS os caminhos — os de hoje e os de amanhã.
--
--   3. `vessel_decidir_pedido_de_registro` é a função mais remexida do módulo
--      (a "trava da dona" entrou nela em 18/09, e o corpo que está NO BANCO
--      tem trechos que não vieram desta pasta). `create or replace` reescreve
--      a função INTEIRA: para acrescentar duas linhas eu teria de redigitar
--      todo o corpo dela, que é exatamente o conserto em massa que já quebrou
--      coisa neste projeto. O desenho manda "sem mexer no que a função já
--      faz" — e o único jeito de garantir isso é não tocar nela.
--
-- O gatilho abaixo é AFTER INSERT: o momento exato em que uma peça ganha dona.
-- ══════════════════════════════════════════════════════════════════════════


-- ── a tabela ─────────────────────────────────────────────────────────────────

create table if not exists public.vessel_lembretes (
  id               uuid primary key default gen_random_uuid(),
  peca_codigo      text not null,
  email            text not null,
  -- A conta, QUANDO HOUVER. O lembrete é justamente para quem ainda não
  -- registrou, e registrar não exige conta — então este campo é opcional por
  -- desenho, não por descuido.
  cliente_id       uuid references public.vessel_clientes(id),
  -- ⚠️ `not null`: um lembrete só existe se ela marcou o consentimento. A
  -- LGPD não se prova com uma linha que "provavelmente" teve permissão.
  consentimento_em timestamptz not null,
  criado_em        timestamptz not null default now(),
  enviado_7_em     timestamptz,
  enviado_30_em    timestamptz,
  cancelado_em     timestamptz,
  cancelado_por    text,
  -- ⚠️ SÓ O HASH. O token do link de "não quero mais receber" é sorteado na
  -- hora de mandar o e-mail (`vessel_lembretes_a_enviar`), vai DENTRO do
  -- e-mail e some daqui: quem tiver o banco na frente não consegue cancelar o
  -- lembrete de ninguém, e um vazamento desta tabela não vira uma lista de
  -- links clicáveis. Mesma regra do código de 6 dígitos da transferência.
  token_hash       text,

  -- ⚠️ O CÓDIGO DA PEÇA TEM DE ESTAR NORMALIZADO, e isto não é capricho: o
  -- índice único de "um lembrete aberto por peça" é sobre esta coluna. Um
  -- "tbnwxas28a" e um "TBNWXAS-28A" gravados crus seriam DUAS peças para o
  -- índice e UMA peça para a cliente — dois lembretes abertos para a mesma
  -- bolsa, que é o que o índice existe para impedir. É a mesma normalização
  -- de todas as irmãs do selo.
  constraint vessel_lembretes_codigo_normalizado_check
    check (peca_codigo = upper(regexp_replace(peca_codigo, '[\s.\-_]', '', 'g'))),
  -- ⚠️ O E-MAIL TAMBÉM, e pelo mesmo motivo mais um: " Ana@Gmail.com " e
  -- "ana@gmail.com" são a MESMA caixa de entrada. Gravados crus, o painel
  -- mostraria duas pessoas onde há uma, e o teto de 24h contaria errado.
  constraint vessel_lembretes_email_normalizado_check
    check (email = lower(btrim(email)) and email <> ''),
  -- Cancelado e "por quem" são a MESMA informação: um sem o outro é uma linha
  -- que ninguém sabe ler depois.
  constraint vessel_lembretes_cancelamento_check
    check ((cancelado_em is null) = (cancelado_por is null)),
  -- Um lembrete acaba de dois jeitos, e só: a cliente clicou no link do
  -- e-mail, ou a peça ganhou registro. Qualquer outra palavra aqui seria uma
  -- trilha que o painel não sabe traduzir.
  constraint vessel_lembretes_cancelado_por_check
    check (cancelado_por is null or cancelado_por in ('cliente', 'registro'))
);

-- ⚠️ UM LEMBRETE ABERTO POR PEÇA, e a trava é do BANCO. Sem ela, dois toques
-- seguidos em "Deixar para depois" (duplo clique, duas abas) deixariam DOIS
-- lembretes vivos para a mesma bolsa — e a cliente receberia quatro e-mails.
-- Índice PARCIAL: lembrete cancelado ou já esgotado (o de 30 dias saiu) sai do
-- caminho e não atrapalha o próximo, que é o que permite pedir de novo meses
-- depois.
create unique index if not exists vessel_lembretes_um_aberto_idx
  on public.vessel_lembretes (peca_codigo)
  where cancelado_em is null and enviado_30_em is null;

-- A fila do robô e o teto de 24h leem por peça e por data.
create index if not exists vessel_lembretes_peca_idx
  on public.vessel_lembretes (peca_codigo, criado_em desc);

-- O link do e-mail chega pelo hash do token.
create index if not exists vessel_lembretes_token_idx
  on public.vessel_lembretes (token_hash)
  where token_hash is not null;

comment on table public.vessel_lembretes is
  'Lembrete de "registrar depois" da peca (Registered Pieces). Dois e-mails, '
  'em 7 e 30 dias, com o link do certificado. Morre quando a peca ganha '
  'registro. O token do link de parar so existe em hash. Desenho de 19/09/2026.';

comment on column public.vessel_lembretes.token_hash is
  'Hash sha256 do token do link "nao quero mais receber". Sorteado a cada '
  'envio por vessel_lembretes_a_enviar e nunca guardado em claro.';

-- ── a trava de linha ─────────────────────────────────────────────────────────
-- ⚠️ CONFERIDO CONTRA AS IRMÃS. `vessel_clientes` e `vessel_registros` têm RLS
-- ligada e UMA política, só de SELECT, para `authenticated`, gateada por
-- `is_vessel_admin()` — é o que deixa o painel Autenticidade ler. Esta tabela
-- segue essa linha porque o desenho pede a lista de lembretes NA TELA de
-- Autenticidade. `vessel_transferencias` fica sem política nenhuma, mas ali o
-- painel não precisa de nada; aqui precisa.
--
-- ⚠️ E O `token_hash` NA LEITURA NÃO É BURACO: é um hash sha256, e cancelar
-- compara o hash do token DIGITADO com esta coluna. Quem lê a coluna não
-- consegue voltar ao token, então não consegue cancelar o lembrete de
-- ninguém. Escrita, zero: só pelas funções security definer abaixo.
alter table public.vessel_lembretes enable row level security;

drop policy if exists vessel_lembretes_read on public.vessel_lembretes;
create policy vessel_lembretes_read on public.vessel_lembretes
  for select to authenticated using (public.is_vessel_admin());


-- ══════════════════════════════════════════════════════════════════════════
-- 1. CRIAR O LEMBRETE
-- ══════════════════════════════════════════════════════════════════════════
-- ⚠️ A RESPOSTA É A MESMA EM QUALQUER SITUAÇÃO DA PEÇA — e essa é a regra mais
-- importante deste arquivo. Esta função é chamada de uma página ABERTA, sem
-- login, com um código de peça digitado. Se "peça já registrada" respondesse
-- diferente de "lembrete criado", qualquer pessoa com uma lista de códigos
-- descobriria, em minutos, quais bolsas já têm dona — e o desenho diz, com
-- todas as letras, que a cliente nunca fica sabendo se a peça já tem lembrete
-- de outra pessoa.
--
-- Então:
--   · o que a PRÓPRIA pessoa digitou errado vira recusa com motivo
--     (`sem_consentimento`, `email_invalido`): ela precisa saber para
--     corrigir, e nenhum dos dois fala da peça;
--   · tudo que é ESTADO DA PEÇA — não existe, já registrada, já tem lembrete
--     aberto, já foi pedida nas últimas 24h — responde `{ok:true}`, igualzinho
--     ao sucesso, e simplesmente não grava nada. A tela agradece do mesmo
--     jeito, e ninguém do lado de fora aprende nada.
--
-- ⚠️ O TETO DE 1 PEDIDO POR PEÇA A CADA 24H é contado sobre `criado_em` desta
-- tabela, e não sobre uma tabela de tentativas como nas irmãs. Motivo medido:
-- pedido recusado aqui NÃO GRAVA e NÃO MANDA e-mail, então ele não incomoda
-- ninguém — o que incomoda é lembrete que NASCE. Sem este teto, bastaria
-- cancelar e pedir de novo em laço para inundar a caixa de entrada da dona de
-- uma peça, que é exatamente o que o desenho quer impedir. E uma tabela de
-- tentativas, aqui, seria ela própria um oráculo: o painel leria "fulano
-- tentou nesta peça", que é o dado que esta função existe para não contar.
--
-- ⚠️ A PEÇA TEM DE EXISTIR. Sem isto, qualquer laço criaria uma linha por
-- código inventado a cada 24h — tabela crescendo para sempre, e o robô
-- mandando e-mail com link de certificado que dá 404. "Não existe" cai no
-- mesmo `{ok:true}` das outras: código inventado não conta nada sobre peça
-- nenhuma.
create or replace function public.vessel_lembrete_criar(
  p_codigo text, p_email text, p_token_opcional text, p_consentimento boolean
) returns json language plpgsql security definer set search_path to 'public' as $$
declare
  v_codigo  text := upper(regexp_replace(coalesce(p_codigo, ''), '[\s.\-_]', '', 'g'));
  v_email   text := lower(btrim(coalesce(p_email, '')));
  v_sessao  json;
  v_cliente uuid;
begin
  -- 1. o consentimento, antes de tudo: sem ele não há o que guardar.
  if coalesce(p_consentimento, false) is not true then
    return json_build_object('ok', false, 'motivo', 'sem_consentimento');
  end if;

  -- 2. o e-mail, conferido de forma simples — a MESMA regra de
  -- `vessel_conta_criar`. Validar e-mail "de verdade" é impossível sem mandar
  -- um; o que esta linha pega é o erro de digitação óbvio.
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return json_build_object('ok', false, 'motivo', 'email_invalido');
  end if;

  -- 3. a conta, quando houver. Token inválido ou vencido NÃO é erro: o
  -- lembrete continua valendo, só fica sem dona. Quem não tem conta passa
  -- `null` aqui e segue igual.
  if coalesce(p_token_opcional, '') <> '' then
    v_sessao := public.vessel_conta_da_sessao(p_token_opcional);
    if coalesce((v_sessao ->> 'ok')::boolean, false) then
      v_cliente := (v_sessao ->> 'cliente_id')::uuid;
    end if;
  end if;

  -- ⚠️ TRAVA A PEÇA antes de olhar qualquer coisa. Duplo clique e duas abas
  -- passariam os dois pelas conferências abaixo antes de qualquer um gravar, e
  -- o segundo bateria no índice único como erro CRU do Postgres — que a edge
  -- devolveria como "falhou", contando, pelo próprio erro, que já havia um
  -- lembrete ali. Com a trava, o segundo espera e enxerga o do primeiro.
  perform pg_advisory_xact_lock(hashtext('vessel_lembrete:' || v_codigo));

  -- 4. a peça existe? (ver o cabeçalho desta função)
  if not exists (select 1 from public.vessel_pecas where codigo = v_codigo) then
    return json_build_object('ok', true);
  end if;

  -- 5. peça já registrada não aceita lembrete: ela já tem dona, e o lembrete
  -- existe para quem AINDA NÃO registrou.
  if exists (select 1 from public.vessel_registros where codigo = v_codigo) then
    return json_build_object('ok', true);
  end if;

  -- 6. teto de 1 pedido por peça a cada 24h (conta o que NASCEU, ver acima).
  if exists (
    select 1 from public.vessel_lembretes
     where peca_codigo = v_codigo and criado_em > now() - interval '24 hours'
  ) then
    return json_build_object('ok', true);
  end if;

  -- 7. já existe um aberto (de mais de 24h atrás): um por peça, e pronto.
  if exists (
    select 1 from public.vessel_lembretes
     where peca_codigo = v_codigo and cancelado_em is null and enviado_30_em is null
  ) then
    return json_build_object('ok', true);
  end if;

  -- ⚠️ E AINDA ASSIM, O `exception`: a trava acima é por transação, e um
  -- caminho futuro que grave nesta tabela sem passar por aqui bateria no
  -- índice único como erro cru. O erro vira a MESMA resposta das outras — a
  -- regra da resposta única não pode depender de nenhuma conferência
  -- lembrar de existir.
  begin
    insert into public.vessel_lembretes
      (peca_codigo, email, cliente_id, consentimento_em)
    values (v_codigo, v_email, v_cliente, now());
  exception
    when unique_violation then
      return json_build_object('ok', true);
  end;

  return json_build_object('ok', true);
end;
$$;


-- ══════════════════════════════════════════════════════════════════════════
-- 2. PARAR DE RECEBER — o link do e-mail
-- ══════════════════════════════════════════════════════════════════════════
-- ⚠️ RESPONDE `{ok:true}` SEMPRE, com token certo, errado, vazio ou já usado.
-- Três razões, e as três valem sozinhas:
--   1. um "não achei" transformaria este endereço, que é público e sem login,
--      num testador de tokens;
--   2. para quem clicou, "cancelado" e "já não havia" são a mesma coisa — ela
--      quer ler "você não vai mais receber", e isso é VERDADE nos dois casos;
--   3. o token é sorteado de novo a cada envio (ver `vessel_lembretes_a_enviar`
--      e o porquê lá), então o link do e-mail de 7 dias deixa de valer quando o
--      de 30 dias sai. Clicar no link velho não pode devolver uma tela de erro
--      para quem só quer ser deixada em paz — e, àquela altura, ela realmente
--      não vai mais receber nada.
-- É a mesma decisão já registrada em `vessel_transferencia_cancelar`.
--
-- ⚠️ CANCELA MESMO SE O DE 30 DIAS JÁ SAIU. A linha sai do índice parcial de
-- qualquer jeito; o que muda é a trilha dizer que foi ELA quem pediu para
-- parar — e é isso que o painel precisa mostrar.
create or replace function public.vessel_lembrete_cancelar_por_token(p_token text)
returns json language plpgsql security definer set search_path to 'public' as $$
begin
  if coalesce(p_token, '') <> '' then
    update public.vessel_lembretes
       set cancelado_em = now(), cancelado_por = 'cliente'
     where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
       and cancelado_em is null;
  end if;
  return json_build_object('ok', true);
end;
$$;


-- ══════════════════════════════════════════════════════════════════════════
-- 3. A FILA DO ROBÔ
-- ══════════════════════════════════════════════════════════════════════════
-- Devolve as linhas vencidas (7 ou 30 dias) cuja peça continua sem registro,
-- cada uma com o token EM CLARO do link de parar de receber.
--
-- ⚠️ O TOKEN É SORTEADO AQUI, E NÃO NA CRIAÇÃO. Não é escolha de estilo: o
-- desenho manda guardar o token só em hash, e um hash não volta a ser token.
-- Se ele fosse sorteado na criação, o robô — que só entra em cena 7 dias
-- depois — não teria como pôr o link no e-mail. Sortear no momento do envio é
-- o único jeito de ter as duas coisas: link vivo no e-mail e nada em claro no
-- banco.
--
-- ⚠️ CONSEQUÊNCIA ACEITA, E ESCRITA: o envio de 30 dias sorteia um token novo,
-- então o link do e-mail de 7 dias para de valer nesse dia. Ele vale os 23
-- dias que importam, e clicar no velho depois não dá erro nenhum (ver
-- `vessel_lembrete_cancelar_por_token`).
--
-- ⚠️ `not exists (... vessel_registros ...)` MESMO TENDO O GATILHO. O gatilho
-- é a regra; esta linha é o cinto. Se um dia alguém gravar registro por um
-- caminho que desarme o gatilho, o pior que acontece é o lembrete continuar
-- aberto — e este `not exists` garante que, mesmo assim, nenhum e-mail sai
-- para uma peça que já tem dona.
--
-- ⚠️ UM ENVIO POR RODADA POR LINHA: quem ainda não recebeu o de 7 recebe o de
-- 7, mesmo que a linha já tenha 40 dias. O de 30 sai na rodada seguinte. É o
-- que evita dois e-mails na mesma hora depois de uma semana de falha.
create or replace function public.vessel_lembretes_a_enviar()
returns json language plpgsql security definer set search_path to 'public' as $$
declare
  v_linhas json[] := '{}';
  v_l      record;
  v_token  text;
begin
  for v_l in
    select l.id, l.peca_codigo, l.email,
           case when l.enviado_7_em is null then 7 else 30 end as qual
      from public.vessel_lembretes l
     where l.cancelado_em is null
       and l.enviado_30_em is null
       and ((l.enviado_7_em is null     and l.criado_em <= now() - interval '7 days')
         or (l.enviado_7_em is not null and l.criado_em <= now() - interval '30 days'))
       and not exists (select 1 from public.vessel_registros r
                        where r.codigo = l.peca_codigo)
     order by l.criado_em
  loop
    -- ⚠️ SORTEIO CRIPTOGRÁFICO. `random()` do Postgres é semeado por sessão:
    -- quem vê alguns tokens continua a sequência e cancela o lembrete dos
    -- outros (a mesma lição de
    -- 2026-09-18-vessel-chave-do-convite-sorteada-a-serio.sql).
    v_token := encode(extensions.gen_random_bytes(32), 'hex');
    update public.vessel_lembretes
       set token_hash = encode(extensions.digest(v_token, 'sha256'), 'hex')
     where id = v_l.id;

    v_linhas := v_linhas || json_build_object(
      'id', v_l.id, 'peca_codigo', v_l.peca_codigo, 'email', v_l.email,
      'qual', v_l.qual, 'token', v_token);
  end loop;

  return json_build_object('ok', true, 'linhas', array_to_json(v_linhas));
end;
$$;


-- ══════════════════════════════════════════════════════════════════════════
-- 4. MARCAR O ENVIO
-- ══════════════════════════════════════════════════════════════════════════
-- ⚠️ SÓ MARCA O QUE AINDA NÃO ESTAVA MARCADO (`and enviado_X_em is null`).
-- Sem isso, uma chamada repetida — retentativa do robô, duas rodadas que se
-- cruzam — empurraria a data para a frente e o e-mail de 30 dias sairia 30
-- dias depois do 7 REMARCADO, não da criação. `marcado` diz se esta chamada
-- foi a que marcou; é o que o robô escreve no log.
--
-- ⚠️ E-MAIL QUE FALHA NÃO É MARCADO. O robô só chama esta função depois que o
-- ZeptoMail aceitou; o que falhou fica na fila e volta na próxima rodada.
create or replace function public.vessel_lembrete_marcar_enviado(p_id uuid, p_qual integer)
returns json language plpgsql security definer set search_path to 'public' as $$
begin
  if p_qual not in (7, 30) then
    return json_build_object('ok', false, 'motivo', 'qual_invalido');
  end if;

  if p_qual = 7 then
    update public.vessel_lembretes
       set enviado_7_em = now()
     where id = p_id and enviado_7_em is null;
  else
    update public.vessel_lembretes
       set enviado_30_em = now()
     where id = p_id and enviado_30_em is null;
  end if;

  return json_build_object('ok', true, 'marcado', found);
end;
$$;


-- ══════════════════════════════════════════════════════════════════════════
-- 5. O LEMBRETE MORRE QUANDO A PEÇA GANHA REGISTRO
-- ══════════════════════════════════════════════════════════════════════════
-- Ver, no cabeçalho deste arquivo, as três medições que escolheram o gatilho
-- em vez de mexer em `vessel_decidir_pedido_de_registro`.
--
-- ⚠️ `and cancelado_em is null`: se ela já tinha clicado em "não quero mais
-- receber", quem cancelou foi ELA. Reescrever para 'registro' apagaria, no
-- painel, a diferença entre "a cliente pediu para parar" e "a peça foi
-- registrada" — que é justamente o que o desenho manda mostrar.
create or replace function public.vessel_lembretes_morre_com_o_registro()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  update public.vessel_lembretes
     set cancelado_em = now(), cancelado_por = 'registro'
   where peca_codigo = upper(regexp_replace(coalesce(new.codigo, ''), '[\s.\-_]', '', 'g'))
     and cancelado_em is null;
  return null;
end;
$$;

drop trigger if exists vessel_registros_mata_o_lembrete on public.vessel_registros;
create trigger vessel_registros_mata_o_lembrete
  after insert on public.vessel_registros
  for each row execute function public.vessel_lembretes_morre_com_o_registro();


-- ── o portão ─────────────────────────────────────────────────────────────────
-- ⚠️ `revoke from public` NÃO fecha `anon`/`authenticated`: os papéis herdam
-- direito próprio ("Grant não é o portão", 2026-09-17-vessel-contas-base.sql).
-- Revogar dos três, um a um, e conceder só a `service_role` — que é quem a
-- edge usa. A chave pública que mora dentro do HTML de vesselbrasil.com.br não
-- alcança nenhuma destas quatro funções.
--
-- ⚠️ `vessel_lembretes_morre_com_o_registro()` fica FORA do grant de propósito:
-- ela é função de gatilho, roda dentro do próprio gatilho e não precisa de
-- EXECUTE para ninguém. Só o revoke, para não nascer aberta.
do $$
declare f text;
begin
  foreach f in array array[
    'vessel_lembrete_criar(text,text,text,boolean)',
    'vessel_lembrete_cancelar_por_token(text)',
    'vessel_lembretes_a_enviar()',
    'vessel_lembrete_marcar_enviado(uuid,integer)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  execute 'revoke all on function public.vessel_lembretes_morre_com_o_registro()'
       || ' from public, anon, authenticated';
end $$;
