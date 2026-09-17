-- PROVA POR ROLLBACK de vessel_minhas_pecas: a lista de peças da cliente
-- logada, com a peça em conferência aparecendo com esse estado.
--
-- Rode inteiro, de uma vez, DEPOIS de aplicar (nesta ordem, pelo MCP da
-- Supabase, `apply_migration`):
--   1. db/migrations/2026-09-17-vessel-contas-base.sql
--      (vessel_conta_criar, vessel_conta_entrar, vessel_conta_da_sessao)
--   2. db/migrations/2026-09-03-zz-vessel-garantia-com-dono.sql
--      (vessel_pecas, vessel_lotes, vessel_registros, vessel_pedidos_de_registro,
--      vessel_abrir_pedido_de_registro)
--   3. db/migrations/2026-09-17-vessel-registro-com-conta.sql
--      (cliente_id em vessel_registros e vessel_pedidos_de_registro,
--      vessel_registrar_como_cliente)
--   4. db/migrations/2026-09-17-vessel-minhas-pecas.sql (esta tarefa)
--
-- ⚠️ TERMINA EM ERRO DE PROPÓSITO, no mesmo desenho das provas irmãs
-- (db/provas/2026-09-17-contas-base.prova.sql e
-- db/provas/2026-09-17-registro-com-conta.prova.sql): a última linha do
-- bloco é um `raise exception` disparado só depois de todas as asserções
-- passarem — é o que devolve o banco ao estado de antes, sem precisar de
-- `begin`/`rollback` em volta (o `do $$ ... end $$` inteiro é uma única
-- instrução: se ela levanta exceção, a transação implícita que a envolve
-- desfaz sozinha tudo que foi inserido lá dentro). A mensagem esperada no
-- fim é exatamente "rollback proposital: todas as asserções passaram" —
-- qualquer outra mensagem de erro é defeito de verdade, não o fim combinado
-- da prova.
--
-- Depois de rodar, confira que nada sobrou:
--   select count(*) from public.vessel_clientes where email = 'minhas-pecas-teste@exemplo.com.br';
--   select count(*) from public.vessel_pecas where codigo in ('MINHASPECASREG01','MINHASPECASPEN01');
-- Esperado: 0 nos dois.
--
-- Nenhum dado real é usado: o CPF abaixo ('111.444.777-35') é o mesmo CPF de
-- teste, matematicamente válido, das provas irmãs — não pertence a ninguém.
-- Lote, peças, registro e pedido de registro nascem dentro do próprio bloco,
-- só para esta prova.

do $$
declare
  v json; v_token text; v_cliente_id uuid;
  v_lote uuid; v_codigo_reg text := 'MINHASPECASREG01'; v_codigo_pen text := 'MINHASPECASPEN01';
  v_pecas json; v_qtd int;
begin
  -- ── sem sessão, nem tenta ─────────────────────────────────────────────────
  v := public.vessel_minhas_pecas('token-que-nao-existe');
  assert (v->>'motivo') = 'sem_sessao',
    'token inválido deveria devolver sem_sessao, devolveu: ' || v::text;

  -- ── a cliente e o lote ────────────────────────────────────────────────────
  v := public.vessel_conta_criar('Cliente Minhas Peças', '111.444.777-35',
        'minhas-pecas-teste@exemplo.com.br', '(19) 99999-0002', '1990-01-01', 'senha-de-teste');
  assert (v->>'ok')::boolean, 'criar conta falhou: ' || v::text;
  v_cliente_id := (v->>'cliente_id')::uuid;

  v := public.vessel_conta_entrar('minhas-pecas-teste@exemplo.com.br', 'senha-de-teste', false, null, null);
  assert (v->>'ok')::boolean, 'entrar falhou: ' || v::text;
  v_token := v->>'token';

  insert into public.vessel_lotes (modelo, cor, sku, quantidade, fabricado_em)
  values ('Modelo Minhas Peças', 'Areia', 'SKU-MINHAS-PECAS', 2, current_date)
  returning id into v_lote;

  -- ── peça 1: JÁ REGISTRADA no nome da cliente ─────────────────────────────
  insert into public.vessel_pecas (codigo, lote_id, numero_na_serie)
  values (v_codigo_reg, v_lote, 1);
  insert into public.vessel_registros (codigo, nome, whatsapp, garantia_ate, cliente_id)
  values (v_codigo_reg, 'Cliente Minhas Peças', '19999990002',
          (current_date + interval '2 years')::date, v_cliente_id);

  -- ── peça 2: pedido ABERTO pela cliente, ainda sem Bling batendo sozinho —
  -- fica 'pendente' em vessel_pedidos_de_registro, que é o estado que
  -- vessel_minhas_pecas traduz para "em conferência" ────────────────────────
  insert into public.vessel_pecas (codigo, lote_id, numero_na_serie)
  values (v_codigo_pen, v_lote, 2);
  v := public.vessel_registrar_como_cliente(v_token, v_codigo_pen);
  assert (v->>'ok')::boolean, 'abrir pedido de registro falhou: ' || v::text;
  assert coalesce(v->>'estado', 'pendente') <> 'aprovado',
    'esta prova espera a peça 2 ficar em conferência (pendente), não aprovada de cara: ' || v::text;

  -- ── a lista, pela sessão ──────────────────────────────────────────────────
  v := public.vessel_minhas_pecas(v_token);
  assert (v->>'ok')::boolean, 'vessel_minhas_pecas falhou: ' || v::text;
  v_pecas := v->'pecas';

  select count(*) into v_qtd from json_array_elements(v_pecas);
  assert v_qtd = 2, 'esperava 2 peças (1 registrada + 1 em conferência), veio ' || v_qtd::text;

  assert exists (
    select 1 from json_array_elements(v_pecas) e
     where e->>'codigo' = v_codigo_reg and e->>'estado' = 'registrada'
       and (e->>'garantia_ate') is not null
  ), 'a peça registrada deveria vir com estado "registrada" e garantia_ate preenchida: ' || v_pecas::text;

  assert exists (
    select 1 from json_array_elements(v_pecas) e
     where e->>'codigo' = v_codigo_pen and e->>'estado' = 'em conferência'
       and (e->>'garantia_ate') is null
  ), 'a peça pendente deveria vir com estado "em conferência" e sem garantia_ate: ' || v_pecas::text;

  -- ⚠️ nenhuma palavra que acuse quem espera: nem "atraso", nem "fila", nem
  -- qualquer coisa que aponte demora da equipe — só "em conferência".
  assert v_pecas::text !~* 'atraso|demora|fila|esperando',
    'a lista não pode carregar palavra que acuse quem espera: ' || v_pecas::text;

  raise exception 'rollback proposital: todas as asserções passaram';
end $$;
