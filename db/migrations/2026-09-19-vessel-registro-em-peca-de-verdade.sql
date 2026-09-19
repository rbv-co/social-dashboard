-- FASE 2 DO REGISTERED PIECES — A PEÇA DE VERDADE PASSA A VALER
--
-- Plano: docs/superpowers/plans/2026-09-18-fase-2-registered-pieces.md,
-- Tarefa 1 (decidido pelo dono em 18/09/2026).
--
-- Duas coisas, e só estas duas:
--
--   1. CAI A TRAVA DE LOTE DE TESTE do registro estando logada e da geração
--      do convite de transferência. Qualquer peça gravada passa a aceitar as
--      duas coisas.
--   2. QUEM JÁ REGISTROU ANTES DAS CONTAS ENTRA PELO CPF. Ao criar a conta,
--      os registros e os pedidos de registro daquele MESMO CPF que ainda não
--      têm conta dona passam a apontar para a conta que acabou de nascer — e
--      a peça aparece em "Minhas peças".
--
-- ⚠️ O NOME TEM A DATA 19/09 DE PROPÓSITO. Em 18/09 existem
-- 2026-09-18-zzzz-vessel-registro-nao-toma-peca-com-dona.sql (a trava da
-- dona) e 2026-09-18-zzzzz-vessel-transferencia-de-propriedade.sql (a
-- transferência). Este arquivo redefine funções dos dois; rodar antes deles
-- desfaria o trabalho deles em silêncio. Data maior ordena depois de
-- qualquer sufixo "z" do dia anterior.
--
-- ⚠️ POR QUE ISTO É SEGURO AGORA (medido no banco em 18/09/2026, com o
-- módulo `pg` do node, em transação desfeita):
--   · `select count(*) filter (where teste) from public.vessel_lotes` → 0 de
--     139 lotes. A limpeza dos testes apagou o único lote marcado `teste`.
--     HOJE, portanto, NENHUMA peça registra com conta e NENHUMA transfere:
--     as duas funções respondem `fora_do_teste` para as 212 peças, sempre.
--     A trava não está protegendo nada — está desligando a ferramenta
--     inteira.
--   · `select count(*) from public.vessel_clientes` → 0. Nenhuma conta de
--     cliente existe ainda, então nada do que está no ar depende do
--     comportamento antigo.
--   · `select count(*) from public.vessel_registros` → 1 (PX9FWMYJET, CPF do
--     dono), feita pelo caminho ANTIGO (sem conta): `cliente_id` nulo.
--
-- ⚠️ O QUE NÃO SAI, e é o ponto do arquivo inteiro. Nenhuma outra trava é
-- tocada:
--   · a trava da dona (`ja_tem_dona`, `ja_era_sua`, `pedido_ja_usado`) mora
--     em `vessel_decidir_pedido_de_registro`, que NÃO é redefinida aqui;
--   · o portão do `'bling'` (só chave de serviço ou dono do banco) mora na
--     mesma função, e também não é tocado;
--   · o teto de 5 tentativas de transferência por peça a cada 24h
--     (`vessel_tentativa_de_transferencia`) continua igual;
--   · o prazo de 7 dias do convite e "um convite aberto por peça" (o índice
--     único parcial) continuam iguais;
--   · `vessel_registrar_como_cliente` continua com a MESMA assinatura de 6
--     parâmetros. `create or replace` com assinatura diferente criaria
--     SOBRECARGA (as duas conviveriam, e a antiga continuaria chamável, com a
--     trava dentro) — por isso a assinatura não muda uma vírgula. O parâmetro
--     `p_so_teste` fica onde está, sem efeito, para não quebrar a edge
--     `vessel-registrar-garantia`, que o manda em duas chamadas.
--
-- ⚠️ `vessel_transferencia_aceitar` NÃO APARECE NESTE ARQUIVO, de propósito.
-- O plano manda tirar a conferência de lote dela também; MEDIDO com
-- `pg_get_functiondef` em 18/09/2026: ela nunca teve essa conferência. Quem
-- aceita só entra se existir um convite aberto, e convite só nasce em
-- `vessel_transferencia_gerar` — que é onde a trava estava. Redefinir uma
-- função em produção para não mudar nada dentro dela é risco de graça.
--
-- ⚠️ NADA AQUI SE PASSA POR ADMIN. `is_vessel_admin()` não é chamado nem
-- desarmado: estas são as portas da CLIENTE, e a cliente nunca é
-- `authenticated` neste banco.
--
-- ⚠️ pgcrypto mora no schema `extensions`: todo `crypt` e `gen_salt` vem
-- qualificado, senão quebra com search_path=public.


-- ══════════════════════════════════════════════════════════════════════════
-- 1. A TRILHA GANHA A AÇÃO NOVA — no MESMO arquivo da função que a escreve
-- ══════════════════════════════════════════════════════════════════════════
-- ⚠️ A LISTA DE `vessel_edicoes.acao` É FECHADA POR CHECK, e ação nova fora
-- dela derruba a TRANSAÇÃO INTEIRA: a conta não nasceria, e a tela diria só
-- "não consegui". Foi assim que `baixar_garantia` nasceu sem nunca funcionar
-- (2026-09-05-vessel-edicoes-aceita-baixar-garantia.sql). Função que escreve
-- na trilha e ação nova na lista são UMA COISA SÓ, no mesmo arquivo.
--
-- A lista abaixo é a que está NO BANCO hoje (medida com `pg_get_constraintdef`
-- em 18/09/2026: doze ações), mais uma.
--
-- ⚠️ POR QUE UMA AÇÃO NOVA, E NÃO `dono_trocado` NEM `transferida_pela_dona`:
-- aqui NINGUÉM troca de dona. A peça continua da mesma pessoa, com o mesmo
-- CPF, a mesma garantia e a mesma compra; o que nasce é o elo entre aquele
-- registro e um PERFIL no site. Usar uma das ações de troca faria a trilha
-- contar, para sempre, uma troca de dona que não aconteceu.
alter table public.vessel_edicoes
  drop constraint if exists vessel_edicoes_acao_check;
alter table public.vessel_edicoes
  add constraint vessel_edicoes_acao_check
  check (acao = any (array[
    'desmarcar_gravada','sobrescrever_para_fila','sobrescrever_para_baixa',
    'registro_aprovado','registro_recusado','dono_trocado','baixar_garantia',
    'lote_excluido','peca_excluida','etiqueta_adotada','numero_trocado',
    'transferida_pela_dona','conta_ligada_pelo_cpf',
    -- ⚠️ ACRESCENTADA EM 19/09/2026, DEPOIS DE APLICAR. A entrega do material do
    -- lote andou ao mesmo tempo que esta e criou `material_do_lote`; como as duas
    -- reescreviam a lista inteira, quem aplicasse por último apagava a ação da
    -- outra. O banco já foi consertado por
    -- `2026-09-19-zz-vessel-trilha-a-lista-inteira.sql`; a ação entra aqui para
    -- este arquivo nunca mais devolver uma lista MENOR do que a que já existia.
    'material_do_lote'
  ]));


-- ══════════════════════════════════════════════════════════════════════════
-- 2. REGISTRAR ESTANDO LOGADA — vale para peça de verdade
-- ══════════════════════════════════════════════════════════════════════════
-- Corpo IDÊNTICO ao que está no banco hoje
-- (2026-09-17-vessel-registro-com-conta.sql, conferido com
-- `pg_get_functiondef` em 18/09/2026), MENOS o bloco de seis linhas que
-- conferia `l.teste` e respondia `fora_do_teste`. Nada mais muda: nem a
-- assinatura, nem o `security definer`, nem o `search_path`, nem a resposta.
create or replace function public.vessel_registrar_como_cliente(
  p_token text, p_codigo text, p_onde text default null, p_comprado_em date default null,
  p_so_teste boolean default false, p_presente_de_nome text default null
) returns json language plpgsql security definer set search_path to 'public' as $$
declare
  v_sessao json; v_c record; v_aberto json;
  v_codigo text := upper(regexp_replace(coalesce(p_codigo, ''), '[\s.\-_]', '', 'g'));
begin
  v_sessao := public.vessel_conta_da_sessao(p_token);
  if not (v_sessao ->> 'ok')::boolean then
    return json_build_object('ok', false, 'motivo', 'sem_sessao');
  end if;
  select * into v_c from public.vessel_clientes where id = (v_sessao ->> 'cliente_id')::uuid;

  -- ⚠️ AQUI MORAVA A TRAVA DE LOTE DE TESTE (`fora_do_teste`). Ela saiu por
  -- decisão do dono, com a Fase 2 (plano de 18/09/2026). O que continua
  -- segurando a peça de outra pessoa NÃO é esta função e nunca foi: é a
  -- trava da dona dentro de `vessel_decidir_pedido_de_registro` — abrir um
  -- pedido de registro nunca deu a peça a ninguém, só põe a linha na fila.
  -- Peça com dona de CPF diferente cai em `ja_tem_dona` e vai para a fila do
  -- painel, onde uma pessoa decide. Isso não mudou uma linha.
  --
  -- ⚠️ `p_so_teste` FICA, SEM EFEITO. Removê-lo mudaria a assinatura, e
  -- `create or replace` com assinatura diferente deixa as DUAS versões no ar
  -- (sobrecarga). A edge `vessel-registrar-garantia` manda esse campo em duas
  -- chamadas; tirar o parâmetro quebraria as duas com `function does not
  -- exist`.
  v_aberto := public.vessel_abrir_pedido_de_registro(
    p_codigo, v_c.nome, v_c.cpf, v_c.whatsapp, p_onde, p_comprado_em, v_c.nascimento);
  if not (v_aberto ->> 'ok')::boolean then return v_aberto; end if;

  update public.vessel_pedidos_de_registro
     set cliente_id = v_c.id,
         presente_de_nome = coalesce(nullif(trim(coalesce(p_presente_de_nome, '')), ''),
                                      presente_de_nome)
   where id = (v_aberto ->> 'pedido')::uuid;

  -- `ja_tem_dono` e `dono_curto` atravessam de `vessel_abrir_pedido_de_registro`
  -- sem alteração: é a peça já ter dona OU NÃO, e a edge (e a tela) precisam
  -- disso para explicar a situação à cliente.
  return json_build_object('ok', true, 'pedido', v_aberto ->> 'pedido',
                           'sku', v_aberto ->> 'sku', 'cliente_id', v_c.id,
                           'ja_tem_dono', (v_aberto ->> 'ja_tem_dono')::boolean,
                           'dono_curto', v_aberto ->> 'dono_curto');
end;
$$;


-- ══════════════════════════════════════════════════════════════════════════
-- 3. GERAR O CONVITE DE TRANSFERÊNCIA — vale para peça de verdade
-- ══════════════════════════════════════════════════════════════════════════
-- Corpo IDÊNTICO ao de 2026-09-18-zzzzz-vessel-transferencia-de-propriedade.sql
-- (conferido com `pg_get_functiondef` em 18/09/2026), MENOS o bloco que
-- conferia `l.teste`. Continuam aqui, palavra por palavra: a trava da linha da
-- peça (`for no key update`), a conferência de que a peça é de quem pede
-- (`nao_e_sua`), o cancelamento do convite anterior antes de abrir o novo (o
-- índice único de "um convite aberto por peça"), o sorteio criptográfico com
-- rejeição e o prazo de 7 dias.
create or replace function public.vessel_transferencia_gerar(p_token text, p_codigo text)
returns json language plpgsql security definer set search_path to 'public' as $$
declare
  v_sessao   json;
  v_cliente  uuid;
  v_codigo   text := upper(regexp_replace(coalesce(p_codigo, ''), '[\s.\-_]', '', 'g'));
  v_reg      record;
  -- ⚠️ SORTEIO CRIPTOGRÁFICO, COM REJEIÇÃO. `random()` do Postgres é semeado
  -- por sessão: quem vê alguns códigos continua a sequência. E `byte % 10`
  -- sozinho não serve: 256 não é múltiplo de 10, então 0..5 sairiam mais que
  -- 6..9. O maior múltiplo de 10 que cabe em 256 é 250; byte de 250 para cima
  -- é descartado, e o sorteio fica justo.
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

  -- ⚠️ AQUI MORAVA A TRAVA DE LOTE DE TESTE (`fora_do_teste`). Saiu com a
  -- Fase 2. O que segura a peça continua sendo o `nao_e_sua` logo abaixo:
  -- convite só nasce para quem JÁ é a dona registrada da peça. Sem registro,
  -- ou com registro de outra conta, não sai convite nenhum — e é por isso
  -- que `vessel_transferencia_aceitar` nunca precisou de trava de lote.

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
  -- simplesmente trava a tela.
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
-- 4. CRIAR A CONTA — e recolher, pelo CPF, o que já era dela
-- ══════════════════════════════════════════════════════════════════════════
-- O caso real: 190 peças gravadas e 1 registro feito ANTES de existirem
-- contas (PX9FWMYJET). Quem registrou assim tem nome, CPF e garantia na
-- tabela, mas nenhuma conta — e "Minhas peças" lê `cliente_id`. Sem este
-- bloco, a mesma pessoa criaria a conta e veria a tela VAZIA, com a peça
-- dela do lado de fora.
--
-- A regra, inteira:
--   · casa por CPF NORMALIZADO (só dígitos) dos dois lados. A conta já grava
--     o CPF com `vessel_cpf_digitos`; os registros antigos não têm essa
--     garantia — há CPF gravado com ponto e traço no caminho antigo.
--   · só liga o que está SEM DONA DE CONTA (`cliente_id is null`). Registro
--     que já é de alguma conta não é tocado NUNCA: ele é a dona de verdade, e
--     sobrescrever por coincidência de CPF seria dar a bolsa para a conta
--     nova. (Dois perfis com o mesmo CPF não existem — a coluna é única —,
--     mas a trava fica escrita mesmo assim, porque é ela que garante que este
--     bloco só ACRESCENTA.)
--   · vale para os pedidos de registro também: enquanto o pedido está
--     pendente é ele que faz a peça aparecer como "em conferência" em
--     "Minhas peças".
--
-- ⚠️ POR QUE OS PEDIDOS JÁ DECIDIDOS TAMBÉM ENTRAM: o plano fala em "pedidos
-- pendentes", e são mesmo os pendentes os únicos que mudam alguma tela
-- (`vessel_minhas_pecas` só lê `estado = 'pendente'`). Mas deixar os
-- aprovados e recusados do MESMO CPF sem conta criaria, na mesma tabela, duas
-- verdades sobre a mesma pessoa — e a próxima tela que olhar o histórico dela
-- (a Fase 2 não tem, uma Fase 3 pode ter) mostraria o histórico pela metade,
-- sem ninguém entender por quê. Ligar é `cliente_id`, não é decidir nada: o
-- estado do pedido, a data, o motivo e a conferência ficam exatamente como
-- estavam.
--
-- ⚠️ ISTO NÃO PODE VIRAR UM JEITO DE DESCOBRIR SE UM CPF TEM PEÇA. A resposta
-- de criar conta é a MESMA de antes, campo por campo: `{ok, cliente_id,
-- email}`. Não ganha "peças ligadas", não ganha contagem, não ganha nada. Se
-- ganhasse, qualquer um digitaria CPFs de gente conhecida no cadastro e leria,
-- na resposta, quem é cliente da marca — e quem tem bolsa de luxo em casa. A
-- pessoa que criou a conta descobre o que é dela do único jeito certo:
-- entrando e abrindo "Minhas peças", já autenticada.
--
-- ⚠️ E NEM PELO TEMPO DA RESPOSTA. O custo desta ligação é um `update` por
-- índice; o custo da função é dominado pelo bcrypt de custo 10 da senha
-- (ordem de 100 ms), que roda ANTES, sempre, para todo mundo. A diferença
-- entre "ligou 1 peça" e "não ligou nada" fica embaixo do ruído da rede.
--
-- ⚠️ A TRILHA LEVA O CPF MASCARADO, nunca o CPF inteiro — mesma regra de
-- `vessel_transferencia_aceitar`. `vessel_edicoes` é lida no painel.
-- `feito_por` fica NULO e é a verdade: ninguém da Central fez isto; quem fez
-- foi a própria cliente, e ela não tem login do Supabase.
create or replace function public.vessel_conta_criar(
  p_nome text, p_cpf text, p_email text, p_whatsapp text,
  p_nascimento date, p_senha text
) returns json language plpgsql security definer set search_path to 'public' as $$
declare
  v_cpf   text := public.vessel_cpf_digitos(p_cpf);
  v_email text := lower(trim(coalesce(p_email, '')));
  v_id    uuid;
  v_linha record;
begin
  -- ⚠️ C6 (revisão final, 17/09/2026): antes, só a CONTAGEM de dígitos era
  -- conferida aqui — "11111111111" e qualquer sequência de 11 dígitos
  -- passavam, mesmo sem o dígito verificador bater. Sem esta conferência a
  -- cliente criava perfil com CPF errado, entrava, e ao tocar em "Registrar"
  -- recebia "Confira o CPF..." para sempre, sem NENHUM formulário na tela da
  -- peça para consertar: conta morta, sem saída pela tela.
  if v_cpf is null or not public.vessel_cpf_valido(v_cpf) then
    return json_build_object('ok', false, 'motivo', 'cpf_invalido');
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return json_build_object('ok', false, 'motivo', 'email_invalido');
  end if;
  if coalesce(trim(p_nome), '') = '' then
    return json_build_object('ok', false, 'motivo', 'nome_vazio');
  end if;
  -- ⚠️ NASCIMENTO É OBRIGATÓRIO, e não é burocracia: na venda a loja quase
  -- nunca consegue tirar todos os dados, e o registro é o momento em que a
  -- própria cliente completa o cadastro (decisão do dono, 06/09 e 17/09/2026).
  if p_nascimento is null
     or p_nascimento > current_date
     or p_nascimento < current_date - interval '120 years' then
    return json_build_object('ok', false, 'motivo', 'nascimento_invalido');
  end if;
  if exists (select 1 from public.vessel_clientes
              where cpf = v_cpf or email = v_email) then
    return json_build_object('ok', false, 'motivo', 'ja_existe');
  end if;

  -- ⚠️ CORRIDA ENTRE O EXISTS() E O INSERT: duplo clique, ou duas abas abertas
  -- ao mesmo tempo, passam pelo exists() acima antes de qualquer um dos dois
  -- ter inserido — e o segundo insert bate na unique de cpf/email como erro
  -- cru do Postgres (`unique_violation`), não como o {ok:false} que a edge
  -- espera. Este bloco pega esse erro e devolve a MESMA resposta do exists().
  begin
    insert into public.vessel_clientes (nome, cpf, email, whatsapp, nascimento, senha_hash)
    values (trim(p_nome), v_cpf, v_email, p_whatsapp, p_nascimento,
            extensions.crypt(p_senha, extensions.gen_salt('bf', 10)))
    returning id into v_id;
  exception
    when unique_violation then
      return json_build_object('ok', false, 'motivo', 'ja_existe');
  end;

  -- ── o que já era dela, pelo CPF ────────────────────────────────────────
  -- ⚠️ `returning` + laço, em vez de um `update` mudo: é o `returning` que
  -- diz QUAIS linhas mudaram, e é isso que a trilha precisa contar. Contar
  -- depois, com um `select`, pegaria também o que já estava ligado antes.
  for v_linha in
    update public.vessel_registros r
       set cliente_id = v_id
     where r.cliente_id is null
       and regexp_replace(coalesce(r.cpf, ''), '\D', '', 'g') = v_cpf
    returning r.codigo, r.cpf
  loop
    insert into public.vessel_edicoes (codigo, acao, motivo, detalhes, feito_por)
    values (v_linha.codigo, 'conta_ligada_pelo_cpf',
            'a peca ja registrada neste CPF passou a ter perfil no site',
            jsonb_build_object(
              'cliente_id', v_id,
              'onde', 'vessel_registros',
              'cpf', public.vessel_cpf_mascarado(v_linha.cpf)), null);
  end loop;

  for v_linha in
    update public.vessel_pedidos_de_registro pr
       set cliente_id = v_id
     where pr.cliente_id is null
       and regexp_replace(coalesce(pr.cpf, ''), '\D', '', 'g') = v_cpf
    returning pr.codigo, pr.cpf, pr.estado
  loop
    insert into public.vessel_edicoes (codigo, acao, motivo, detalhes, feito_por)
    values (v_linha.codigo, 'conta_ligada_pelo_cpf',
            'o pedido de registro deste CPF passou a ter perfil no site',
            jsonb_build_object(
              'cliente_id', v_id,
              'onde', 'vessel_pedidos_de_registro',
              'estado', v_linha.estado,
              'cpf', public.vessel_cpf_mascarado(v_linha.cpf)), null);
  end loop;

  -- ⚠️ A RESPOSTA É A MESMA DE ANTES, CAMPO POR CAMPO. Ver o cabeçalho desta
  -- função: contar aqui quantas peças foram ligadas transformaria o cadastro
  -- num consultor de "este CPF tem bolsa?".
  return json_build_object('ok', true, 'cliente_id', v_id, 'email', v_email);
end;
$$;


-- ── o portão ─────────────────────────────────────────────────────────────────
-- ⚠️ `create or replace` NÃO mexe em permissão — quem já tinha continua tendo.
-- O bloco abaixo não é para CONCEDER nada, é para GARANTIR que nada vazou:
-- `revoke from public` sozinho NÃO fecha `anon`/`authenticated`, porque os
-- dois têm direito próprio ("Grant não é o portão",
-- 2026-09-17-vessel-contas-base.sql). Revogar dos três, um a um, e conceder
-- só a `service_role` — que é quem as edges usam. A chave publicável que mora
-- dentro do HTML de vesselbrasil.com.br não alcança nenhuma das três.
do $$
declare f text;
begin
  foreach f in array array[
    'vessel_registrar_como_cliente(text,text,text,date,boolean,text)',
    'vessel_transferencia_gerar(text,text)',
    'vessel_conta_criar(text,text,text,text,date,text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
