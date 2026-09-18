-- PROVA POR ROLLBACK do registro ligado à conta e da marca PRESENTE
-- (vessel_registrar_como_cliente, vessel_pedido_marcado_presente,
-- vessel_candidatos_de_presente, vessel_tentativa_de_presente e o gatilho
-- vessel_registros_preencher_cliente_id).
--
-- ⚠️ ATUALIZADA NA ONDA FINAL DE CORREÇÃO (17/09/2026, achados C1/C2/C3/I1 da
-- revisão da branch inteira): vessel_registrar_como_cliente ganhou
-- `p_so_teste` e `p_presente_de_nome`; vessel_registros ganhou um gatilho que
-- preenche `cliente_id` sozinho; e "É presente?" ganhou teto de tentativas.
--
-- Rode inteiro, de uma vez, DEPOIS de aplicar
-- db/migrations/2026-09-17-vessel-registro-com-conta.sql (que por sua vez
-- exige db/migrations/2026-09-17-vessel-contas-base.sql já aplicada — é dela
-- que vem vessel_conta_criar, vessel_conta_entrar e vessel_conta_da_sessao —,
-- db/migrations/2026-09-03-zz-vessel-garantia-com-dono.sql, dona de
-- vessel_pecas, vessel_lotes e vessel_abrir_pedido_de_registro (de 6
-- parâmetros; a versão de 7 é
-- db/migrations/2026-09-16-zz-vessel-abrir-pedido-com-nascimento.sql), e
-- db/migrations/2026-09-17-vessel-lote-de-teste.sql, dona da coluna
-- `vessel_lotes.teste` que a prova do C2 usa abaixo.
--
-- ⚠️ TERMINA EM ERRO DE PROPÓSITO, no mesmo desenho da prova irmã
-- (db/provas/2026-09-17-contas-base.prova.sql): a última linha do bloco é um
-- `raise exception` disparado só depois de todas as asserções passarem — é o
-- que devolve o banco ao estado de antes, sem precisar de `begin`/`rollback`
-- em volta (o `do $$ ... end $$` inteiro é uma única instrução: se ela levanta
-- exceção, a transação implícita que a envolve desfaz sozinha tudo que foi
-- inserido lá dentro). A mensagem esperada no fim é exatamente
-- "rollback proposital: todas as asserções passaram" — qualquer outra
-- mensagem de erro é defeito de verdade, não o fim combinado da prova.
--
-- Depois de rodar, confira que nada sobrou:
--   select count(*) from public.vessel_clientes where email = 'presente-teste@exemplo.com.br';
--   select count(*) from public.vessel_pecas where codigo = 'PRESENTETESTE01';
-- Esperado: 0 nos dois.
--
-- Nenhum dado real é usado: o CPF abaixo ('111.444.777-35') é CPF de teste,
-- matematicamente válido, que não pertence a ninguém; o lote e a peça são
-- criados dentro do próprio bloco, só para esta prova.

do $$
declare
  v json; v_token text; v_lote uuid; v_codigo text := 'PRESENTETESTE01';
  v_marcado boolean;
  v_pedido_id uuid; v_cliente_id uuid; v_decidido json;
  v_lote_fora uuid; v_codigo_fora text := 'FORADOTESTE01';
  v_lote_dentro uuid; v_codigo_dentro text := 'DENTRODOTESTE1';
  v_tentativa json;
begin
  -- ── a marca PRESENTE: tolerante a acento e maiúscula, e não inventa marca ──
  v_marcado := public.vessel_pedido_marcado_presente('Entrega para PRESENTE de aniversário');
  assert v_marcado, 'deveria reconhecer PRESENTE maiúsculo';

  v_marcado := public.vessel_pedido_marcado_presente('é um présente pra ela, com carinho');
  assert v_marcado, 'deveria reconhecer présente com acento e minúsculo';

  v_marcado := public.vessel_pedido_marcado_presente('pedido normal, sem observação nenhuma');
  assert not v_marcado, 'não deveria reconhecer marca onde não há';

  v_marcado := public.vessel_pedido_marcado_presente(null);
  assert not v_marcado, 'texto nulo não é marca';

  -- ── vessel_registrar_como_cliente RECUSA sem sessão ──────────────────────
  v := public.vessel_registrar_como_cliente('token-que-nao-existe', v_codigo, null, null);
  assert (v->>'motivo') = 'sem_sessao',
    'sem sessão válida deveria devolver sem_sessao, devolveu: ' || v::text;

  -- ── agora COM sessão: a peça precisa existir para vessel_abrir_pedido_de_
  -- registro achar o SKU (join com vessel_lotes) ───────────────────────────
  insert into public.vessel_lotes (modelo, cor, sku, quantidade, fabricado_em)
  values ('Modelo de Teste', 'Teste', 'SKU-TESTE-PRESENTE', 1, current_date)
  returning id into v_lote;
  insert into public.vessel_pecas (codigo, lote_id, numero_na_serie)
  values (v_codigo, v_lote, 1);

  v := public.vessel_conta_criar('Presenteada Teste', '111.444.777-35',
        'presente-teste@exemplo.com.br', '(19) 99999-0001', '1990-01-01', 'senha-de-teste');
  assert (v->>'ok')::boolean, 'criar conta falhou: ' || v::text;

  v := public.vessel_conta_entrar('presente-teste@exemplo.com.br', 'senha-de-teste', false, null, null);
  assert (v->>'ok')::boolean, 'entrar falhou: ' || v::text;
  v_token := v->>'token';

  v := public.vessel_registrar_como_cliente(v_token, v_codigo, 'Loja Teste', current_date);
  assert (v->>'ok')::boolean, 'registrar como cliente falhou: ' || v::text;
  assert (v->>'sku') = 'SKU-TESTE-PRESENTE', 'sku devolvido deveria ser o do lote, veio: ' || (v->>'sku');

  -- ── ja_tem_dono e dono_curto atravessam de vessel_abrir_pedido_de_registro
  -- (Rodada de correção 2 da Tarefa 7: eles se perdiam no json_build_object
  -- de vessel_registrar_como_cliente, e uma peça já registrada responderia
  -- como se estivesse livre). Esta peça é NOVA (nasceu agora, nesta prova,
  -- sem ninguém em vessel_registros) — o par certo é ja_tem_dono=false e
  -- dono_curto nulo.
  assert (v->>'ja_tem_dono')::boolean = false,
    'peça nova não deveria já ter dono, veio: ' || coalesce(v->>'ja_tem_dono', '(ausente)');
  assert (v->>'dono_curto') is null,
    'peça sem dono não deveria ter dono_curto, veio: ' || coalesce(v->>'dono_curto', '(null)');

  -- o pedido de registro nasceu ligado ao cliente (Passo 1 desta tarefa)
  assert exists (
    select 1 from public.vessel_pedidos_de_registro
     where id = (v->>'pedido')::uuid and cliente_id = (v->>'cliente_id')::uuid
  ), 'o pedido de registro deveria ter cliente_id preenchido';

  v_pedido_id := (v->>'pedido')::uuid;
  v_cliente_id := (v->>'cliente_id')::uuid;

  -- ── C1: aprovado o pedido, o GATILHO preenche vessel_registros.cliente_id
  -- sozinho — sem isto a peça aprovada some de "Minhas peças" (achado C1 da
  -- revisão final). Quem aprova é vessel_decidir_pedido_de_registro, a
  -- função ANTIGA e compartilhada com o painel — não mexemos nela.
  v_decidido := public.vessel_decidir_pedido_de_registro(
    v_pedido_id, 'aprovado', 'bling', jsonb_build_object('pedido', 'BLING-TESTE-1'), null);
  assert (v_decidido->>'ok')::boolean, 'decidir o pedido falhou: ' || v_decidido::text;

  assert exists (
    select 1 from public.vessel_registros
     where codigo = v_codigo and cliente_id = v_cliente_id
  ), 'C1: vessel_registros.cliente_id deveria ter sido preenchido pelo gatilho — é ele que faz a peça aparecer em "Minhas peças"';

  -- ── C2: p_so_teste recusa peça fora do lote de teste ─────────────────────
  insert into public.vessel_lotes (modelo, cor, sku, quantidade, fabricado_em)
  values ('Modelo de Teste', 'Teste', 'SKU-TESTE-FORA', 1, current_date)
  returning id into v_lote_fora;
  insert into public.vessel_pecas (codigo, lote_id, numero_na_serie)
  values (v_codigo_fora, v_lote_fora, 1);

  v := public.vessel_registrar_como_cliente(v_token, v_codigo_fora, null, null, true);
  assert (v->>'motivo') = 'fora_do_teste',
    'C2: peça de lote NÃO marcado teste tem de ser recusada com so_teste=true, devolveu: ' || v::text;

  -- a mesma chamada, sem so_teste (a página de verdade nunca manda isto),
  -- continua funcionando normalmente — a trava não pode vazar para quem não
  -- pediu ensaio.
  v := public.vessel_registrar_como_cliente(v_token, v_codigo_fora, null, null);
  assert (v->>'ok')::boolean,
    'C2: sem so_teste, o comportamento de sempre não pode mudar, devolveu: ' || v::text;

  insert into public.vessel_lotes (modelo, cor, sku, quantidade, fabricado_em, teste)
  values ('Modelo de Teste', 'Teste', 'TESTE-SKU-OK', 1, current_date, true)
  returning id into v_lote_dentro;
  insert into public.vessel_pecas (codigo, lote_id, numero_na_serie)
  values (v_codigo_dentro, v_lote_dentro, 1);

  v := public.vessel_registrar_como_cliente(v_token, v_codigo_dentro, null, null, true);
  assert (v->>'ok')::boolean,
    'C2: peça de lote MARCADO teste tem de passar com so_teste=true, devolveu: ' || v::text;

  -- ── I1: presente_de_nome é gravado ────────────────────────────────────────
  v := public.vessel_registrar_como_cliente(v_token, v_codigo_dentro, null, null, true, 'Fulana de Tal');
  assert exists (
    select 1 from public.vessel_pedidos_de_registro
     where id = (v->>'pedido')::uuid and presente_de_nome = 'Fulana de Tal'
  ), 'I1: presente_de_nome deveria ter sido gravado com o nome informado';

  -- ── C3: teto de 3 tentativas de "É presente?" por peça a cada 24h ────────
  v_tentativa := public.vessel_tentativa_de_presente(v_codigo_dentro);
  assert (v_tentativa->>'permitido')::boolean, '1ª tentativa deveria estar dentro do teto';
  v_tentativa := public.vessel_tentativa_de_presente(v_codigo_dentro);
  assert (v_tentativa->>'permitido')::boolean, '2ª tentativa deveria estar dentro do teto';
  v_tentativa := public.vessel_tentativa_de_presente(v_codigo_dentro);
  assert (v_tentativa->>'permitido')::boolean, '3ª tentativa deveria estar dentro do teto';
  v_tentativa := public.vessel_tentativa_de_presente(v_codigo_dentro);
  assert not (v_tentativa->>'permitido')::boolean,
    '4ª tentativa em 24h tem de estourar o teto, devolveu: ' || v_tentativa::text;

  -- a mesma peça, código escrito diferente (minúsculo, com espaço), tem de
  -- cair na MESMA contagem — a normalização é a mesma de vessel_verificar.
  v_tentativa := public.vessel_tentativa_de_presente(lower(v_codigo_dentro));
  assert not (v_tentativa->>'permitido')::boolean,
    'a contagem tem de ser pelo código NORMALIZADO, não pela grafia exata';

  -- outra peça, teto independente.
  v_tentativa := public.vessel_tentativa_de_presente(v_codigo_fora);
  assert (v_tentativa->>'permitido')::boolean, 'o teto é POR PEÇA — outro código não pode estar contaminado';

  raise exception 'rollback proposital: todas as asserções passaram';
end $$;
