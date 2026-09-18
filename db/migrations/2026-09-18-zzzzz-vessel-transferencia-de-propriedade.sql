-- A PEÇA TROCA DE DONA PELO CÓDIGO DE 6 DÍGITOS (Registered Pieces)
--
-- Desenho: docs/superpowers/specs/2026-09-18-transferencia-de-propriedade-design.md
-- (decidido pelo dono em 18/09/2026).
--
-- A dona atual pede um código de 6 dígitos, passa esse código para quem vai
-- ficar com a peça, e quem recebe digita o código na página da peça. A peça
-- passa para o nome dela na hora, COM A GARANTIA ORIGINAL — quem compra uma
-- peça usada não ganha garantia nova, e quem vende não tira a que já existia.
--
-- ⚠️ O NOME TEM "zzzzz-" DE PROPÓSITO. No mesmo dia existe
-- 2026-09-18-zzzz-vessel-registro-nao-toma-peca-com-dona.sql, e o hífen é
-- menor que a letra: "zzzz-" ordena ANTES de "zzzzz". Assim este arquivo roda
-- por último e nunca desfaz a trava da dona.
--
-- ⚠️ NADA AQUI SE PASSA POR ADMIN. `is_vessel_admin()` não é chamado nem
-- desarmado: esta é a porta da CLIENTE, e a cliente nunca é `authenticated`
-- neste banco (ver o cabeçalho de 2026-09-17-vessel-contas-base.sql). Quem diz
-- quem ela é é o token de sessão, conferido por `vessel_conta_da_sessao`.
--
-- ⚠️ pgcrypto mora no schema `extensions`: todo `crypt`, `gen_salt` e
-- `gen_random_bytes` vem qualificado. Sem isso, quebra com search_path=public.
--
-- ══════════════════════════════════════════════════════════════════════════
-- A DECISÃO QUE O DESENHO DEIXOU EM ABERTO: usar `vessel_trocar_dono` ou
-- gravar direto? → GRAVAR DIRETO. Três medições, no banco, em 18/09/2026
-- (`pg_get_functiondef(public.vessel_trocar_dono)`):
--
--   1. Ela começa com `if not public.is_vessel_admin() then ... sem_permissao`.
--      A cliente NÃO tem login do Supabase: `auth.uid()` é nulo para ela, e a
--      função devolveria `sem_permissao` sempre. Usá-la exigiria desarmar esse
--      portão — que é justamente o que não se pode fazer.
--   2. Ela grava `bling_contato_id = null, bling_pedido = null, pedido_id =
--      null`, de propósito ("o vinculo com o Bling era do dono ANTIGO"). São
--      TRÊS dos cinco campos que este desenho manda preservar. Aqui o elo com
--      a compra original é o que SUSTENTA a garantia herdada: zerá-lo apagaria
--      a prova de quando a peça foi comprada.
--   3. Ela não conhece `cliente_id` (coluna que só nasceu em
--      2026-09-17-vessel-registro-com-conta.sql). A peça trocaria de nome e
--      continuaria sumida de "Minhas peças" da nova dona — e aparecendo na da
--      antiga, que é pior.
--
-- Mexer nela para atender os três pontos mudaria a função que o painel
-- Autenticidade usa hoje, para consertar um caminho que o painel não usa —
-- exatamente o conserto que quebra o outro lado sem avisar (a mesma decisão
-- registrada em 2026-09-17-vessel-registro-com-conta.sql, achado C1).
-- ══════════════════════════════════════════════════════════════════════════


-- ── o convite ────────────────────────────────────────────────────────────────

create table if not exists public.vessel_transferencias (
  id           uuid primary key default gen_random_uuid(),
  peca_codigo  text not null,
  cliente_de   uuid not null references public.vessel_clientes(id),
  -- ⚠️ SÓ O HASH. O código de 6 dígitos não é guardado em lugar nenhum: ele
  -- aparece UMA vez, na resposta da geração, e depois só existe na mão da
  -- dona. Quem tiver o banco na frente não consegue transferir a peça de
  -- ninguém — mesma regra da senha (bcrypt, custo 10).
  codigo_hash  text not null,
  criado_em    timestamptz not null default now(),
  vale_ate     timestamptz not null,
  usado_em     timestamptz,
  cliente_para uuid references public.vessel_clientes(id),
  cancelado_em timestamptz,

  -- O prazo nasce para a frente. Convite que já nasce vencido seria um convite
  -- que nunca funciona, e a tela não teria como explicar por quê.
  constraint vessel_transferencias_prazo_check
    check (vale_ate > criado_em),
  -- Usado e "para quem" são a MESMA informação: um sem o outro é uma linha que
  -- ninguém sabe ler depois — ou uma transferência sem destino, ou um destino
  -- sem transferência.
  constraint vessel_transferencias_uso_check
    check ((usado_em is null) = (cliente_para is null)),
  -- Um convite acaba de UM jeito só. Usado e cancelado ao mesmo tempo seria a
  -- trilha dizendo duas coisas contrárias sobre o mesmo papel.
  constraint vessel_transferencias_fim_unico_check
    check (usado_em is null or cancelado_em is null),
  -- ⚠️ O CÓDIGO DA PEÇA TEM DE ESTAR NORMALIZADO, e isto não é capricho: o
  -- índice único de "um convite aberto por peça" é sobre esta coluna. Um
  -- "tbnwxas28a" e um "TBNWXAS-28A" gravados crus seriam DUAS peças para o
  -- índice e UMA peça para a cliente — dois convites abertos para a mesma
  -- bolsa, que é o que o índice existe para impedir. É a mesma normalização
  -- de todas as irmãs do selo.
  constraint vessel_transferencias_codigo_normalizado_check
    check (peca_codigo = upper(regexp_replace(peca_codigo, '[\s.\-_]', '', 'g'))),
  -- Ninguém transfere para si mesma. A recusa acontece antes, na função
  -- (`sua_ja`); isto é a trava de baixo, para o caso de alguém um dia gravar
  -- nesta tabela por outro caminho.
  constraint vessel_transferencias_nao_para_si_check
    check (cliente_para is null or cliente_para <> cliente_de)
);

-- ⚠️ UM CONVITE ABERTO POR PEÇA, e a trava é do BANCO. Sem ela, dois toques
-- seguidos em "Transferir esta peça" (duplo clique, duas abas) deixariam DOIS
-- códigos válidos circulando para a mesma bolsa — e a dona só saberia do
-- último. Índice PARCIAL: convite usado ou cancelado sai do caminho e não
-- atrapalha o próximo.
create unique index if not exists vessel_transferencias_um_aberto_idx
  on public.vessel_transferencias (peca_codigo)
  where usado_em is null and cancelado_em is null;

create index if not exists vessel_transferencias_peca_idx
  on public.vessel_transferencias (peca_codigo, criado_em desc);

comment on table public.vessel_transferencias is
  'Convite de transferencia de propriedade da peca (Registered Pieces). O '
  'codigo de 6 digitos so existe em hash; a resposta da geracao e a unica vez '
  'que ele aparece. Desenho de 18/09/2026.';

-- ── as tentativas ────────────────────────────────────────────────────────────
-- ⚠️ MESMO PADRÃO DE `vessel_tentativas_de_presente`
-- (2026-09-17-vessel-registro-com-conta.sql, achado C3): a trava mora no
-- BANCO, não na edge. Uma Edge Function não guarda estado entre chamadas — um
-- contador em variável JavaScript não seguraria nada.
--
-- Sem teto, seis dígitos são 1.000.000 de chutes de graça: um laço pela edge
-- acha o código de qualquer convite aberto em minutos, e a bolsa vai embora.
-- Com 5 por dia, são 200 anos por peça.
create table if not exists public.vessel_tentativas_de_transferencia (
  codigo text not null,
  quando timestamptz not null default now()
);
create index if not exists vessel_tentativas_transferencia_idx
  on public.vessel_tentativas_de_transferencia (codigo, quando desc);

-- ── a trava de linha ─────────────────────────────────────────────────────────
-- ⚠️ CONFERIDO CONTRA AS IRMÃS (vessel_sessoes, vessel_tentativas_de_login,
-- vessel_tentativas_de_presente): RLS ligada e NENHUMA política. Nem o painel
-- precisa ler isto em tela, e um convite aberto que vazasse para qualquer
-- logado diria qual peça está prestes a trocar de dona. Escrita, zero: só
-- pelas funções security definer abaixo.
alter table public.vessel_transferencias             enable row level security;
alter table public.vessel_tentativas_de_transferencia enable row level security;

-- ── a trilha ganha a ação nova ───────────────────────────────────────────────
-- ⚠️ A LISTA DE `vessel_edicoes.acao` É FECHADA POR CHECK, e ação nova fora
-- dela derruba a TRANSAÇÃO INTEIRA — a transferência seria desfeita e a tela
-- diria só "não consegui". Foi assim que `baixar_garantia` nasceu sem nunca
-- funcionar (2026-09-05-vessel-edicoes-aceita-baixar-garantia.sql). Função que
-- escreve na trilha e ação nova na lista são UMA COISA SÓ, no mesmo arquivo.
--
-- A lista abaixo é a que está NO BANCO hoje (medida com pg_get_constraintdef
-- em 18/09/2026: onze ações), mais uma.
--
-- ⚠️ POR QUE UMA AÇÃO NOVA, E NÃO `dono_trocado`: `dono_trocado` é a troca
-- feita À MÃO por alguém da equipe, com motivo escrito e confirmação do código
-- (`vessel_trocar_dono`). Esta aqui é a cliente sozinha, com um código de 6
-- dígitos. Misturar as duas apagaria, na trilha, a diferença entre "a equipe
-- decidiu" e "a dona liberou" — que é exatamente o que a trilha existe para
-- contar.
alter table public.vessel_edicoes
  drop constraint if exists vessel_edicoes_acao_check;
alter table public.vessel_edicoes
  add constraint vessel_edicoes_acao_check
  check (acao = any (array[
    'desmarcar_gravada','sobrescrever_para_fila','sobrescrever_para_baixa',
    'registro_aprovado','registro_recusado','dono_trocado','baixar_garantia',
    'lote_excluido','peca_excluida','etiqueta_adotada','numero_trocado',
    'transferida_pela_dona'
  ]));

-- ══════════════════════════════════════════════════════════════════════════
-- 1. O TETO DE TENTATIVAS
-- ══════════════════════════════════════════════════════════════════════════
-- Cópia fiel de `vessel_tentativa_de_presente`, com teto 5 em vez de 3: insere
-- a tentativa, conta a janela de 24h INCLUINDO ela, e devolve se pode
-- continuar. Assim a 6ª errada do dia é a primeira a ser barrada — e não a 7ª.
create or replace function public.vessel_tentativa_de_transferencia(p_codigo text)
returns json language plpgsql security definer set search_path to 'public' as $$
declare
  v_codigo text := upper(regexp_replace(coalesce(p_codigo, ''), '[\s.\-_]', '', 'g'));
  v_n int;
begin
  insert into public.vessel_tentativas_de_transferencia (codigo) values (v_codigo);

  select count(*) into v_n from public.vessel_tentativas_de_transferencia
   where codigo = v_codigo and quando > now() - interval '24 hours';

  return json_build_object('ok', true, 'permitido', v_n <= 5, 'tentativas', v_n);
end;
$$;

-- ══════════════════════════════════════════════════════════════════════════
-- 2. GERAR O CÓDIGO
-- ══════════════════════════════════════════════════════════════════════════
-- Só a dona ATUAL da peça. Cancela o convite aberto anterior e abre um novo.
-- A resposta é a ÚNICA vez que o código de 6 dígitos aparece.
create or replace function public.vessel_transferencia_gerar(p_token text, p_codigo text)
returns json language plpgsql security definer set search_path to 'public' as $$
declare
  v_sessao   json;
  v_cliente  uuid;
  v_codigo   text := upper(regexp_replace(coalesce(p_codigo, ''), '[\s.\-_]', '', 'g'));
  v_reg      record;
  -- ⚠️ SORTEIO CRIPTOGRÁFICO, COM REJEIÇÃO. `random()` do Postgres é semeado
  -- por sessão: quem vê alguns códigos continua a sequência (a mesma lição de
  -- 2026-09-18-vessel-chave-do-convite-sorteada-a-serio.sql). E `byte % 10`
  -- sozinho não serve: 256 não é múltiplo de 10, então 0..5 sairiam mais que
  -- 6..9. O maior múltiplo de 10 que cabe em 256 é 250; byte de 250 para cima
  -- é descartado, e o sorteio fica justo. Custa um byte a cada 128.
  v_teto     int := 256 - (256 % 10);
  v_byte     int;
  v_sorteado text := '';
  v_vale_ate timestamptz := now() + interval '7 days';
begin
  v_sessao := public.vessel_conta_da_sessao(p_token);
  if not (v_sessao ->> 'ok')::boolean then
    return json_build_object('ok', false, 'motivo', 'sem_sessao');
  end if;
  v_cliente := (v_sessao ->> 'cliente_id')::uuid;

  -- ⚠️ FASE DE ENSAIO: só peça de lote marcado `teste`, exatamente como
  -- `vessel_registrar_como_cliente`. A trava é INCONDICIONAL e mora aqui, não
  -- na tela: "o padrão tem de ser SEGURO por si só, nunca depender de a
  -- chamadora lembrar de pedir a trava"
  -- (2026-09-17-vessel-registro-com-conta.sql, achado N2). A edge é chamada
  -- com a chave pública que está no HTML — qualquer um chama direto, sem
  -- passar pela página. Quando o dono aprovar o ensaio, esta conferência sai
  -- numa migration de uma linha.
  if not exists (
    select 1 from public.vessel_pecas p
      join public.vessel_lotes l on l.id = p.lote_id
     where p.codigo = v_codigo and l.teste
  ) then
    return json_build_object('ok', false, 'motivo', 'fora_do_teste');
  end if;

  -- ⚠️ TRAVA A LINHA DA PEÇA antes de olhar quem é a dona. Sem isto, gerar e
  -- aceitar ao mesmo tempo passariam os dois pela conferência antes de
  -- qualquer um gravar.
  select * into v_reg from public.vessel_registros
   where codigo = v_codigo for no key update;
  if not found or v_reg.cliente_id is null or v_reg.cliente_id <> v_cliente then
    return json_build_object('ok', false, 'motivo', 'nao_e_sua');
  end if;

  -- ⚠️ CANCELA O ANTERIOR ANTES DE ABRIR O NOVO. Sem isto o índice único
  -- recusa o segundo convite com erro cru do Postgres, e "gerar de novo"
  -- simplesmente trava a tela. O desenho manda: gerar um novo cancela o
  -- anterior.
  update public.vessel_transferencias
     set cancelado_em = now()
   where peca_codigo = v_codigo and usado_em is null and cancelado_em is null;

  while length(v_sorteado) < 6 loop
    v_byte := get_byte(extensions.gen_random_bytes(1), 0);
    continue when v_byte >= v_teto;      -- descarta e sorteia outro
    v_sorteado := v_sorteado || (v_byte % 10)::text;
  end loop;

  insert into public.vessel_transferencias
    (peca_codigo, cliente_de, codigo_hash, vale_ate)
  values (v_codigo, v_cliente,
          extensions.crypt(v_sorteado, extensions.gen_salt('bf', 10)), v_vale_ate);

  return json_build_object('ok', true, 'codigo_transferencia', v_sorteado,
                           'vale_ate', v_vale_ate);
end;
$$;

-- ══════════════════════════════════════════════════════════════════════════
-- 3. TEM CONVITE ABERTO?
-- ══════════════════════════════════════════════════════════════════════════
-- Para a tela da dona voltar a mostrar a folha do convite depois de fechar a
-- página. NÃO devolve o código: ele aparece uma vez só, na geração. Quem
-- perdeu o papel gera outro.
create or replace function public.vessel_transferencia_aberta(p_token text, p_codigo text)
returns json language plpgsql security definer set search_path to 'public' as $$
declare
  v_sessao  json;
  v_cliente uuid;
  v_codigo  text := upper(regexp_replace(coalesce(p_codigo, ''), '[\s.\-_]', '', 'g'));
  v_reg     record;
  v_conv    record;
begin
  v_sessao := public.vessel_conta_da_sessao(p_token);
  if not (v_sessao ->> 'ok')::boolean then
    return json_build_object('ok', false, 'motivo', 'sem_sessao');
  end if;
  v_cliente := (v_sessao ->> 'cliente_id')::uuid;

  select * into v_reg from public.vessel_registros where codigo = v_codigo;
  if not found or v_reg.cliente_id is null or v_reg.cliente_id <> v_cliente then
    return json_build_object('ok', false, 'motivo', 'nao_e_sua');
  end if;

  select * into v_conv from public.vessel_transferencias
   where peca_codigo = v_codigo and usado_em is null and cancelado_em is null
     and vale_ate > now();

  return json_build_object('ok', true, 'tem', found,
                           'vale_ate', v_conv.vale_ate);
end;
$$;

-- ══════════════════════════════════════════════════════════════════════════
-- 4. CANCELAR
-- ══════════════════════════════════════════════════════════════════════════
-- Responde `{ok:true}` mesmo se não havia nada aberto: para a dona, "cancelado"
-- e "já não havia" são a mesma coisa, e distinguir só serviria para alguém de
-- fora descobrir se existe convite.
create or replace function public.vessel_transferencia_cancelar(p_token text, p_codigo text)
returns json language plpgsql security definer set search_path to 'public' as $$
declare
  v_sessao  json;
  v_cliente uuid;
  v_codigo  text := upper(regexp_replace(coalesce(p_codigo, ''), '[\s.\-_]', '', 'g'));
  v_reg     record;
begin
  v_sessao := public.vessel_conta_da_sessao(p_token);
  if not (v_sessao ->> 'ok')::boolean then
    return json_build_object('ok', false, 'motivo', 'sem_sessao');
  end if;
  v_cliente := (v_sessao ->> 'cliente_id')::uuid;

  select * into v_reg from public.vessel_registros
   where codigo = v_codigo for no key update;
  if not found or v_reg.cliente_id is null or v_reg.cliente_id <> v_cliente then
    return json_build_object('ok', false, 'motivo', 'nao_e_sua');
  end if;

  update public.vessel_transferencias
     set cancelado_em = now()
   where peca_codigo = v_codigo and usado_em is null and cancelado_em is null;

  return json_build_object('ok', true);
end;
$$;

-- ══════════════════════════════════════════════════════════════════════════
-- 5. ACEITAR — a peça troca de dona
-- ══════════════════════════════════════════════════════════════════════════
-- ⚠️ A ORDEM DAS CONFERÊNCIAS É A PRÓPRIA SEGURANÇA:
--   1. sessão      — sem saber quem é, não há o que decidir;
--   2. TETO        — ANTES de olhar convite, prazo ou hash. Se o teto for
--                    conferido depois, cada chute ainda custa uma consulta e,
--                    pior, o TEMPO da resposta separa "não existe convite"
--                    (rápido) de "existe, mas o código errou" (bcrypt de
--                    verdade, lento) — e só isso já entrega que a peça está à
--                    venda. Estourado o teto, nada mais é lido;
--   3. convite aberto, no prazo, não usado, não cancelado;
--   4. a dona atual ainda é quem gerou (o desenho: troca por outro caminho
--      invalida o convite);
--   5. quem aceita não é a própria dona (`sua_ja`);
--   6. o hash.
-- Tudo que falha de 3 a 6, menos o `sua_ja`, responde a MESMA palavra:
-- `codigo_invalido`. Nunca "existe convite", nunca o nome de ninguém.
create or replace function public.vessel_transferencia_aceitar(
  p_token text, p_codigo text, p_codigo_transferencia text
) returns json language plpgsql security definer set search_path to 'public' as $$
declare
  v_sessao   json;
  v_novo     record;
  v_codigo   text := upper(regexp_replace(coalesce(p_codigo, ''), '[\s.\-_]', '', 'g'));
  v_digitado text := regexp_replace(coalesce(p_codigo_transferencia, ''), '\D', '', 'g');
  v_teto     json;
  v_reg      record;
  v_conv     record;
  v_dona     record;
  v_zap      text;
begin
  v_sessao := public.vessel_conta_da_sessao(p_token);
  if not (v_sessao ->> 'ok')::boolean then
    return json_build_object('ok', false, 'motivo', 'sem_sessao');
  end if;
  select * into v_novo from public.vessel_clientes
   where id = (v_sessao ->> 'cliente_id')::uuid;

  -- 2. O TETO, ANTES DE QUALQUER CONFERÊNCIA. Ver o cabeçalho desta função.
  v_teto := public.vessel_tentativa_de_transferencia(v_codigo);
  if not (v_teto ->> 'permitido')::boolean then
    return json_build_object('ok', false, 'motivo', 'muitas_tentativas');
  end if;

  -- Trava a linha da peça: duas aceitações ao mesmo tempo viram fila, e a
  -- segunda já enxerga o convite marcado como usado pela primeira.
  select * into v_reg from public.vessel_registros
   where codigo = v_codigo for no key update;
  if not found then
    return json_build_object('ok', false, 'motivo', 'codigo_invalido');
  end if;

  -- 3. convite aberto, no prazo. `for update` põe em fila quem chegar junto.
  select * into v_conv from public.vessel_transferencias
   where peca_codigo = v_codigo and usado_em is null and cancelado_em is null
     and vale_ate > now()
     for update;
  if not found then
    return json_build_object('ok', false, 'motivo', 'codigo_invalido');
  end if;

  -- 4. ⚠️ A DONA ATUAL AINDA TEM DE SER QUEM GEROU. Se a peça trocou de dona
  -- por outro caminho (o painel, por `vessel_trocar_dono` ou por uma aprovação
  -- na mão), o convite que ficou aberto perde a validade — senão o código
  -- velho da dona ANTIGA continuaria valendo contra a peça da dona NOVA.
  -- Confere pelos DOIS lados porque a função do painel troca nome e CPF e NÃO
  -- mexe em `cliente_id` (medido em 18/09/2026): olhar só o `cliente_id`
  -- deixaria passar a troca feita pelo painel.
  select * into v_dona from public.vessel_clientes where id = v_conv.cliente_de;
  if v_reg.cliente_id is distinct from v_conv.cliente_de
     or regexp_replace(coalesce(v_reg.cpf, ''), '\D', '', 'g')
        is distinct from regexp_replace(coalesce(v_dona.cpf, ''), '\D', '', 'g') then
    return json_build_object('ok', false, 'motivo', 'codigo_invalido');
  end if;

  -- 5. A dona não transfere para si mesma. Só ELA pode ver esta resposta (é a
  -- própria `cliente_de`), então não conta nada a ninguém de fora.
  if v_novo.id = v_conv.cliente_de then
    return json_build_object('ok', false, 'motivo', 'sua_ja');
  end if;

  -- 6. o hash, por último.
  if length(v_digitado) <> 6
     or v_conv.codigo_hash <> extensions.crypt(v_digitado, v_conv.codigo_hash) then
    return json_build_object('ok', false, 'motivo', 'codigo_invalido');
  end if;

  -- ── A TROCA ──────────────────────────────────────────────────────────────
  -- ⚠️ O QUE NÃO APARECE AQUI É O QUE IMPORTA. `garantia_ate`, `comprado_em`,
  -- `pedido_id`, `bling_pedido`, `bling_contato_id`, `onde_comprou` e
  -- `registrado_em` NÃO são tocados: a garantia é a da compra original, e o
  -- elo com aquela compra é a prova dela. Ver, no cabeçalho deste arquivo, por
  -- que isso impede reaproveitar `vessel_trocar_dono` (ela zera três desses).
  --
  -- ⚠️ O WHATSAPP DA DONA ANTIGA NUNCA ATRAVESSA. Se a conta nova não tem
  -- telefone, o campo fica vazio — a coluna é `not null`, mas aceita string
  -- vazia. Carregar o telefone de quem vendeu para a ficha de quem comprou
  -- seria vazar o contato de uma cliente para dentro do registro de outra.
  --
  -- ⚠️ `bling_atualizado_em = now()` TIRA A LINHA DA FILA DO ROBÔ, e é o
  -- contrário do que `vessel_decidir_pedido_de_registro` faz (ela zera).
  -- Medido em supabase/functions/vessel-espelhar-lista/index.ts: o robô pega
  -- as linhas com `bling_atualizado_em` nulo e escreve celular e nascimento no
  -- contato de `bling_contato_id`. Aqui `bling_contato_id` é, de propósito, o
  -- contato de QUEM COMPROU — a dona antiga. Deixar a linha na fila faria o
  -- robô gravar os dados da dona NOVA por cima do cadastro da ANTIGA no Bling,
  -- calado. A transferência entre clientes não é uma venda do Bling: não há o
  -- que completar lá. (O próprio robô usa `now()` com esse sentido quando não
  -- há mudança a fazer.)
  update public.vessel_registros
     set nome = v_novo.nome,
         cpf = v_novo.cpf,
         whatsapp = coalesce(nullif(regexp_replace(coalesce(v_novo.whatsapp, ''), '\D', '', 'g'), ''), ''),
         nascimento = v_novo.nascimento,
         cliente_id = v_novo.id,
         bling_atualizado_em = now()
   where codigo = v_codigo;

  update public.vessel_transferencias
     set usado_em = now(), cliente_para = v_novo.id
   where id = v_conv.id;

  -- ⚠️ A TRILHA NUNCA LEVA O CÓDIGO DE 6 DÍGITOS. `vessel_edicoes` é lida pelo
  -- painel; o código é o que vale por uma bolsa. Vai o id do convite, que
  -- amarra a linha ao papel sem revelá-lo.
  --
  -- ⚠️ `feito_por` FICA NULO, e é a verdade: ninguém da Central fez isto. As
  -- outras ações gravam `auth.uid()`, que aqui seria nulo de qualquer jeito —
  -- a cliente não tem login do Supabase. Quem fez está em `detalhes`.
  insert into public.vessel_edicoes (codigo, acao, motivo, detalhes, feito_por)
  values (v_codigo, 'transferida_pela_dona',
          'a dona liberou a transferencia com o codigo de 6 digitos',
          jsonb_build_object(
            'transferencia', v_conv.id,
            'de',   jsonb_build_object('cliente_id', v_conv.cliente_de,
                                       'nome', v_reg.nome,
                                       'cpf', public.vessel_cpf_mascarado(v_reg.cpf)),
            'para', jsonb_build_object('cliente_id', v_novo.id,
                                       'nome', v_novo.nome,
                                       'cpf', public.vessel_cpf_mascarado(v_novo.cpf)),
            'garantia_ate', v_reg.garantia_ate), null);

  -- A garantia devolvida é a MESMA que já estava no registro — não é
  -- recalculada. É esse número que a tela mostra para quem acabou de receber.
  return json_build_object('ok', true, 'garantia_ate', v_reg.garantia_ate);
end;
$$;

-- ── o portão ─────────────────────────────────────────────────────────────────
-- ⚠️ `revoke from public` NÃO fecha `anon`/`authenticated`: os papéis herdam
-- direito próprio ("Grant não é o portão", 2026-09-17-vessel-contas-base.sql).
-- Revogar dos três, um a um, e conceder só a `service_role` — que é quem a
-- edge usa. A chave pública que mora dentro do HTML de vesselbrasil.com.br não
-- alcança nenhuma destas cinco funções.
do $$
declare f text;
begin
  foreach f in array array[
    'vessel_tentativa_de_transferencia(text)',
    'vessel_transferencia_gerar(text,text)',
    'vessel_transferencia_aberta(text,text)',
    'vessel_transferencia_cancelar(text,text)',
    'vessel_transferencia_aceitar(text,text,text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
