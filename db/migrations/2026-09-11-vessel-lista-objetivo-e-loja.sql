-- O QUE A PESSOA QUER, DEPOIS DE JÁ ESTAR NO BANCO.
--
-- A LP nova cadastra primeiro e pergunta depois (decisão do dono, 11/09/2026):
-- se a escolha viesse antes, quem desistisse no meio sumiria sem deixar
-- contato. Isso torna a escolha uma SEGUNDA escrita.
--
-- ⚠️ E a segunda escrita é o risco. Se a página pudesse dizer "grave visita na
-- linha 412", qualquer visitante diria isso sobre a linha de qualquer cliente.
-- Por isso `vessel_entrar_na_lista` passa a devolver uma SENHA DE USO ÚNICO,
-- guardada aqui só como impressão digital, e `vessel_marcar_objetivo` só aceita
-- quem a tiver na mão.

alter table public.vessel_lista_espera
  add column if not exists objetivo   text,
  add column if not exists loja       text,
  add column if not exists senha_hash text,
  add column if not exists senha_em   timestamptz;

comment on column public.vessel_lista_espera.objetivo is
  'O que a pessoa escolheu na LP: visita, ecommerce, ou nulo (cadastrou e não escolheu).';

-- ⚠️ NASCE ACEITANDO AS DUAS LOJAS ABERTAS (Tivoli Santa Bárbara e Iguatemi
-- Campinas). A tela de hoje grava só `iguatemi`, porque foi o que o dono pediu
-- em 11/09 — o seletor é trabalho de tela depois, SEM migration nova.
-- Não cravar loja no código da tela: duas lojas fecharam em 2026.
comment on column public.vessel_lista_espera.loja is
  'Qual loja, quando o objetivo é visita: tivoli | iguatemi.';

comment on column public.vessel_lista_espera.senha_hash is
  'sha256 da senha de uso único devolvida no cadastro. Zerada assim que usada.';

-- ⚠️ SEM LISTA FECHADA (CHECK) NO OBJETIVO. Já aconteceu neste projeto de um
-- CHECK derrubar a transação INTEIRA quando chegou um valor que ninguém previu.
-- A trava está na FUNÇÃO, que recusa o valor devolvendo erro tratado, em vez de
-- abortar tudo. Valor novo (por exemplo um terceiro caminho) passa a ser uma
-- linha na função, não uma migration de emergência.

create index if not exists vessel_lista_espera_senha_hash_idx
  on public.vessel_lista_espera (senha_hash)
  where senha_hash is not null;

-- `vessel_entrar_na_lista` passa a devolver a senha de uso único.
--
-- ⚠️ TODO caminho de saída devolve 'senha' no json — inclusive os falsos.
-- O que decide se a senha é gravada não é a posição do `return`, é se AQUELA
-- saída tem LINHA DE VERDADE no banco e responde `ok:true`. Quatro têm:
-- `ja_na_lista`, `ja_reservado`, a promoção lista→pré-venda e o cadastro
-- novo — nessas quatro a senha é gravada como impressão digital (via
-- `digest`). As outras seis (armadilha, teto por IP mudo, `invalido`,
-- `muitas_tentativas` e os dois `esgotou`) não têm linha, ou são disfarce
-- anti-robô: devolvem uma senha GERADA NA HORA e NUNCA GRAVADA, porque se a
-- ausência da senha virasse o sinal de que a tentativa falhou, a armadilha
-- deixaria de enganar o robô, e o teto por IP pararia de ser mudo.
--
-- O resto do corpo é o de produção, intocado: a trava de fila, o teto por IP
-- que fala diferente na lista de espera e na pré-venda, e o
-- `v_atual.id is not null` que não pode virar `found` (comentário original
-- abaixo explica o motivo).
create or replace function public.vessel_entrar_na_lista(p_nome text, p_email text, p_whatsapp text, p_aceite_versao text, p_armadilha text default null::text, p_origem text default null::text)
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
begin
  -- A ARMADILHA CONTINUA MUDA. Robo que soubesse que caiu nela tentaria de
  -- outro jeito; ele tem de sair achando que deu certo.
  -- ⚠️ SENHA FALSA, e de propósito: não é gravada em lugar nenhum. Robô que
  -- recebesse sucesso SEM senha saberia que caiu na armadilha e tentaria de
  -- outro jeito. Aqui ele sai achando que deu certo, e a senha não abre porta.
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
  -- Na lista de espera ele segue MUDO (anti-robo: quem apanha nao pode saber).
  -- Na pre-venda ele PRECISA falar: sao 10 pecas e 12 horas, e uma pessoa de
  -- verdade num escritorio atras do mesmo IP nao pode sair achando que reservou.
  if v_recentes >= 5 then
    if v_prevenda then
      return json_build_object('ok', false, 'situacao', 'muitas_tentativas',
        'erro', 'Recebemos varios envios desta conexao. Aguarde alguns minutos e tente de novo.',
        'senha', v_senha::text);
    end if;
    return json_build_object('ok', true, 'situacao', 'reservado',
                             'senha', v_senha::text);
  end if;

  -- TRAVA DE FILA para as 10 unidades: sem ela, dois envios no mesmo segundo
  -- contam os mesmos 9 e viram a 11a peca. Cai sozinha no fim da transacao.
  if v_prevenda then
    perform pg_advisory_xact_lock(hashtext('vessel_pre_venda'));
  end if;

  select * into v_atual from public.vessel_lista_espera where lower(email) = v_email;
  select count(*) into v_feitos from public.vessel_lista_espera where origem = 'pre-venda';

  -- A PERGUNTA E `v_atual.id is not null`, NAO `found`: o `found` guarda o
  -- resultado do ULTIMO comando, que aqui e o count(*) - e count sempre acha
  -- uma linha. Com `found`, toda pessoa NOVA seria tratada como repetida.
  if v_atual.id is not null then
    if not v_prevenda then
      update public.vessel_lista_espera
         set senha_hash = encode(extensions.digest(v_senha::text, 'sha256'), 'hex'),
             senha_em   = now()
       where id = v_atual.id;
      return json_build_object('ok', true, 'situacao', 'ja_na_lista',
                               'senha', v_senha::text);
    end if;
    if v_atual.origem = 'pre-venda' then
      update public.vessel_lista_espera
         set senha_hash = encode(extensions.digest(v_senha::text, 'sha256'), 'hex'),
             senha_em   = now()
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
           senha_em   = now()
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
    (nome, email, whatsapp, ip_hash, aceite_versao, origem, senha_hash, senha_em)
  values
    (trim(p_nome), v_email, trim(p_whatsapp), v_ip, p_aceite_versao, v_origem,
     encode(extensions.digest(v_senha::text, 'sha256'), 'hex'), now())
  returning id into v_id;

  return json_build_object('ok', true,
    'situacao', case when v_prevenda then 'reservado' else 'na_lista' end,
    'restam', case when v_prevenda then greatest(0, v_total - (v_feitos + 1)) else null end,
    'senha', v_senha::text);
end;
$function$;

-- A SEGUNDA ESCRITA. Só passa quem tem a senha devolvida pelo cadastro.
create or replace function public.vessel_marcar_objetivo(
  p_senha    text,
  p_objetivo text,
  p_loja     text default null
) returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_hash text := encode(extensions.digest(coalesce(p_senha, ''), 'sha256'), 'hex');
  v_id   bigint;
begin
  -- ⚠️ A TRAVA MORA AQUI, e não num CHECK da coluna. CHECK derruba a transação
  -- inteira quando chega um valor novo; aqui o valor novo é uma linha a mais.
  if p_objetivo not in ('visita', 'ecommerce') then
    return json_build_object('ok', false, 'situacao', 'objetivo_invalido');
  end if;

  -- A senha vale por 2 horas. Sem prazo, uma senha vazada abriria a linha para
  -- sempre; com prazo, a janela é a da própria visita à página.
  update public.vessel_lista_espera
     set objetivo   = p_objetivo,
         loja       = case when p_objetivo = 'visita'
                           then coalesce(nullif(trim(p_loja), ''), 'iguatemi')
                           else null end,
         -- USO ÚNICO: some assim que usada.
         senha_hash = null,
         -- O espelho precisa rodar de novo para levar o objetivo adiante.
         planilha_em = null
   where senha_hash = v_hash
     and senha_em > now() - interval '2 hours'
  returning id into v_id;

  -- ⚠️ UPDATE QUE NÃO ACHA LINHA NÃO DÁ ERRO: devolve zero linhas, calado. Sem
  -- esta checagem, senha errada ou vencida responderia "deu certo".
  if v_id is null then
    return json_build_object('ok', false, 'situacao', 'senha_invalida');
  end if;

  return json_build_object('ok', true, 'situacao', 'registrado');
end;
$function$;

-- ⚠️ REVOKE/GRANT segue o padrão da migration irmã (2026-08-28), que faz
-- `revoke all ... from public` em vez de `revoke execute`, e é quem definiu o
-- padrão desta família (conferido na Task 1). Mas esta função é a mais
-- sensível do plano — o único portão entre "qualquer visitante" e "escrever
-- na linha de outra pessoa" — então ela NÃO segue a irmã até o fim: a irmã
-- também concede a `authenticated`, e aqui isso fica de fora, com um revoke
-- explícito e separado. `revoke ... from public` NÃO fecha `authenticated`
-- (são revogações distintas — o Supabase concede execute a `authenticated`
-- em toda função nova do schema `public` por padrão); sem o revoke próprio,
-- qualquer sessão autenticada teria a mesma porta que o site público usa,
-- sem necessidade nenhuma para isso.
revoke all on function public.vessel_marcar_objetivo(text, text, text) from public;
revoke all on function public.vessel_marcar_objetivo(text, text, text) from authenticated;
grant  execute on function public.vessel_marcar_objetivo(text, text, text) to anon;
