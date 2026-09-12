-- PROVA DE `2026-09-01-zz-portao-de-duas-funcoes-sem-trava.sql`
--
-- Roda dentro de uma transação que SE DESFAZ. Nada fica no banco.
--   node coletor/provar-migration.mjs docs/provar-portao-das-duas-funcoes.sql
--
-- ⚠️ NÃO DESARMA O PORTÃO PARA PROVAR. `auth.uid()` é nulo numa conexão de
-- admin, então `is_patrimonio_admin()` dá falso e TUDO responderia "sem
-- permissão" — as asserções voltariam falsas em bloco e pareceria defeito.
-- O jeito certo, já usado nas provas irmãs: criar a situação DENTRO da
-- transação e definir `request.jwt.claims` para falar como cada pessoa.
--
-- ⚠️ E CADA RECUSA É PROVADA PELO MOTIVO CERTO, não só "falhou". Já escrevi
-- prova que passava batendo num erro anterior ao que ela dizia medir.

begin;

create temp table resultado(ordem int, o_que_prova text, esperado text, obtido text, passou boolean)
  on commit drop;

do $$
declare
  v_com_patrimonio uuid;
  v_sem_nada       uuid;
  v_com_frota      uuid;
  v_numero         integer;
  v_resposta       jsonb;
  v_linhas         int;
begin
  -- ── TRÊS CONTAS QUE JÁ EXISTEM, com a permissão EMPRESTADA aqui dentro ──
  --
  -- Não dá para inventar pessoa: `profiles.id` aponta para o cadastro de
  -- autenticação, e inventar lá seria mexer em dado real. Então pegam-se três
  -- contas quaisquer e troca-se a chave delas DENTRO da transação — o
  -- `rollback` no fim devolve tudo. Nenhuma escrita sobrevive a esta prova.
  --
  -- ⚠️ Os `update` vão com `request.jwt.claims` VAZIA porque existe um gatilho
  -- que impede promoção de conta; falando como ninguém, ele não dispara.
  perform set_config('request.jwt.claims', '', true);

  select id into v_com_patrimonio from public.profiles order by id limit 1;
  select id into v_sem_nada       from public.profiles order by id offset 1 limit 1;
  select id into v_com_frota      from public.profiles order by id offset 2 limit 1;

  update public.profiles set features = array['patrimonio'], is_superadmin = false, role = 'viewer' where id = v_com_patrimonio;
  update public.profiles set features = array[]::text[],     is_superadmin = false, role = 'viewer' where id = v_sem_nada;
  update public.profiles set features = array['frota'],      is_superadmin = false, role = 'viewer' where id = v_com_frota;

  -- Um bem de mentira, com número que não colide com os reais.
  select coalesce(max(numero), 0) + 99001 into v_numero from public.patrimonio_bens;
  insert into public.patrimonio_bens (numero, nome) values (v_numero, 'BEM DA PROVA');

  -- ══ 1. `etiqueta_quem_e` ══════════════════════════════════════════════

  -- Quem TEM patrimônio continua enxergando: o conserto não pode quebrar quem
  -- já usava. Esta asserção é tão importante quanto as de recusa.
  perform set_config('request.jwt.claims', json_build_object('sub', v_com_patrimonio)::text, true);
  v_resposta := public.etiqueta_quem_e(v_numero);
  insert into resultado values (1, 'com a chave de patrimônio, ACHA o bem',
    'true', (v_resposta->>'existe'), (v_resposta->>'existe') = 'true');
  insert into resultado values (2, 'e devolve o nome certo',
    'BEM DA PROVA', coalesce(v_resposta->>'nome','(nulo)'), (v_resposta->>'nome') = 'BEM DA PROVA');

  -- Quem NÃO tem a chave recebe a MESMA resposta de número inexistente.
  perform set_config('request.jwt.claims', json_build_object('sub', v_sem_nada)::text, true);
  v_resposta := public.etiqueta_quem_e(v_numero);
  insert into resultado values (3, 'SEM a chave, o bem some (era o inventário inteiro vazando)',
    'false', (v_resposta->>'existe'), (v_resposta->>'existe') = 'false');
  insert into resultado values (4, 'e NÃO devolve o nome do bem',
    '(nada)', coalesce(v_resposta->>'nome','(nada)'), (v_resposta->>'nome') is null);
  insert into resultado values (5, 'nem a placa',
    '(nada)', coalesce(v_resposta->>'placa_ligada','(nada)'), (v_resposta->>'placa_ligada') is null);

  v_resposta := public.etiqueta_quem_e(v_numero + 12345);
  insert into resultado values (6, 'recusa tem a MESMA forma de número que não existe',
    'false', (v_resposta->>'existe'), (v_resposta->>'existe') = 'false');

  -- ══ 2. `frota_pdf_aceite_pegar_da_fila` ═══════════════════════════════

  perform set_config('request.jwt.claims', json_build_object('sub', v_sem_nada)::text, true);
  select count(*) into v_linhas from public.frota_pdf_aceite_pegar_da_fila(5);
  insert into resultado values (10, 'SEM a chave da Frota, não pega trabalho nenhum da fila',
    '0', v_linhas::text, v_linhas = 0);

  insert into resultado values (11, 'e não marcou nada como "enviando" nas costas',
    '0',
    (select count(*)::text from public.frota_uso_pdf where situacao = 'enviando' and tentado_em > now() - interval '1 minute'),
    (select count(*) from public.frota_uso_pdf where situacao = 'enviando' and tentado_em > now() - interval '1 minute') = 0);

  perform set_config('request.jwt.claims', json_build_object('sub', v_com_frota)::text, true);
  begin
    select count(*) into v_linhas from public.frota_pdf_aceite_pegar_da_fila(5);
    insert into resultado values (12, 'COM a chave da Frota, a função roda (0 linhas é resposta válida)',
      'sem erro', 'sem erro', true);
  exception when others then
    insert into resultado values (12, 'COM a chave da Frota, a função roda', 'sem erro', sqlerrm, false);
  end;

  -- ══ 3. QUEM PODE CHAMAR — a asserção que nenhuma das de cima faz ══════
  insert into resultado values (20, 'anon NÃO executa etiqueta_quem_e',
    'false', has_function_privilege('anon','public.etiqueta_quem_e(integer)','execute')::text,
    has_function_privilege('anon','public.etiqueta_quem_e(integer)','execute') = false);
  insert into resultado values (21, 'anon NÃO executa a fila de PDF',
    'false', has_function_privilege('anon','public.frota_pdf_aceite_pegar_da_fila(integer)','execute')::text,
    has_function_privilege('anon','public.frota_pdf_aceite_pegar_da_fila(integer)','execute') = false);
  insert into resultado values (22, 'authenticated executa (a tela chama; a trava é o portão)',
    'true', has_function_privilege('authenticated','public.etiqueta_quem_e(integer)','execute')::text,
    has_function_privilege('authenticated','public.etiqueta_quem_e(integer)','execute') = true);
end $$;

select * from resultado order by ordem;

select 999 as ordem, 'VEREDITO — asserções que passaram / total' as o_que_prova,
       count(*)::text as esperado,
       count(*) filter (where passou)::text as obtido,
       count(*) = count(*) filter (where passou) as passou
  from resultado;

rollback;
