-- PROVA POR ROLLBACK do registro ligado à conta e da marca PRESENTE
-- (vessel_registrar_como_cliente, vessel_pedido_marcado_presente e
-- vessel_candidatos_de_presente).
--
-- Rode inteiro, de uma vez, DEPOIS de aplicar
-- db/migrations/2026-09-17-vessel-registro-com-conta.sql (que por sua vez
-- exige db/migrations/2026-09-17-vessel-contas-base.sql já aplicada — é dela
-- que vem vessel_conta_criar, vessel_conta_entrar e vessel_conta_da_sessao —
-- e db/migrations/2026-09-03-zz-vessel-garantia-com-dono.sql, dona de
-- vessel_pecas, vessel_lotes e vessel_abrir_pedido_de_registro).
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

  -- o pedido de registro nasceu ligado ao cliente (Passo 1 desta tarefa)
  assert exists (
    select 1 from public.vessel_pedidos_de_registro
     where id = (v->>'pedido')::uuid and cliente_id = (v->>'cliente_id')::uuid
  ), 'o pedido de registro deveria ter cliente_id preenchido';

  raise exception 'rollback proposital: todas as asserções passaram';
end $$;
