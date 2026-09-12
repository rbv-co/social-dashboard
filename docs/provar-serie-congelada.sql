-- PROVA DE `2026-09-03-vessel-serie-congela-na-gravacao.sql`
--
--   node coletor/provar-migration.mjs \
--     db/migrations/2026-09-03-vessel-serie-congela-na-gravacao.sql \
--     docs/provar-serie-congelada.sql
--
-- Transação que SE DESFAZ. Nada fica no banco e nenhuma peça real é tocada: os
-- lotes da prova nascem aqui dentro.
--
-- ⚠️ NÃO DESARMA O PORTÃO. `auth.uid()` é nulo numa conexão de admin, então
-- `is_vessel_admin()` daria falso e `vessel_renumerar_lote` levantaria
-- `sem_permissao` em bloco — pareceria defeito da migration. Empresta-se a
-- chave a uma conta que já existe, DENTRO da transação.

begin;

create temp table resultado(ordem int, o_que_prova text, esperado text, obtido text, passou boolean)
  on commit drop;

do $$
declare
  v_pessoa uuid;
  v_lote   uuid;
  v_obtido text;
  v_n      int;
begin
  perform set_config('request.jwt.claims', '', true);
  select id into v_pessoa from public.profiles order by id limit 1;
  update public.profiles set features = array['autenticidade'], is_superadmin = false where id = v_pessoa;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pessoa)::text, true);

  -- ════════════════════════════════════════════════════════════════════════
  -- CENÁRIO 1 — O CAMINHO EXATO DO DEFEITO
  -- Peças 1 a 10; a 6 e a 7 GRAVADAS e com a cliente; some a 5, que está livre.
  -- ANTES desta migration a 6 virava 5 e a 7 virava 6 — e o número de série
  -- impresso no certificado de duas clientes mudava calado.
  -- ════════════════════════════════════════════════════════════════════════
  insert into public.vessel_lotes (modelo, quantidade, fabricado_em)
  values ('PROVA CONGELA 1', 10, current_date) returning id into v_lote;
  insert into public.vessel_pecas (codigo, lote_id, numero_na_serie)
  select 'PRV1' || lpad(n::text, 6, '0'), v_lote, n from generate_series(1, 10) n;
  update public.vessel_pecas set gravada_em = now()
   where lote_id = v_lote and numero_na_serie in (6, 7);

  -- a peça 5 sai pelo caminho de verdade, não por `delete` à mão
  perform public.vessel_excluir_peca('PRV1' || lpad('5', 6, '0'));

  select string_agg(numero_na_serie::text, ',' order by numero_na_serie)
    into v_obtido
    from public.vessel_pecas where lote_id = v_lote and gravada_em is not null;
  insert into resultado values (1,
    'peça GRAVADA não muda de número quando some a peça do lado (antes virava 5,6)',
    '6,7', coalesce(v_obtido, '(nenhuma)'), coalesce(v_obtido, '') = '6,7');

  select string_agg(numero_na_serie::text, ',' order by numero_na_serie)
    into v_obtido from public.vessel_pecas where lote_id = v_lote;
  insert into resultado values (2,
    'e as LIVRES se acomodam em volta, sem furo além do necessário',
    '1,2,3,4,5,6,7,8,9', coalesce(v_obtido, '(nenhuma)'), coalesce(v_obtido, '') = '1,2,3,4,5,6,7,8,9');

  insert into resultado values (3,
    'nenhum número repetido no lote',
    '9', (select count(distinct numero_na_serie)::text from public.vessel_pecas where lote_id = v_lote),
    (select count(distinct numero_na_serie) from public.vessel_pecas where lote_id = v_lote) = 9);

  -- ════════════════════════════════════════════════════════════════════════
  -- CENÁRIO 2 — GARANTIA PRENDE IGUAL À GRAVAÇÃO
  -- Peça NÃO gravada, mas com a cliente já registrada. Ela viu o número no
  -- certificado do mesmo jeito.
  -- ════════════════════════════════════════════════════════════════════════
  insert into public.vessel_lotes (modelo, quantidade, fabricado_em)
  values ('PROVA CONGELA 2', 5, current_date) returning id into v_lote;
  insert into public.vessel_pecas (codigo, lote_id, numero_na_serie)
  select 'PRV2' || lpad(n::text, 6, '0'), v_lote, n from generate_series(1, 5) n;
  insert into public.vessel_registros (codigo, nome, whatsapp, garantia_ate)
  values ('PRV2' || lpad('4', 6, '0'), 'Cliente da prova', '11999999999', current_date + 365);

  delete from public.vessel_pecas
   where lote_id = v_lote and numero_na_serie = 2;   -- some uma livre do meio
  perform public.vessel_renumerar_lote(v_lote);

  insert into resultado values (10,
    'peça COM GARANTIA (sem gravação) também não muda de número',
    '4',
    (select numero_na_serie::text from public.vessel_pecas
      where codigo = 'PRV2' || lpad('4', 6, '0')),
    (select numero_na_serie from public.vessel_pecas
      where codigo = 'PRV2' || lpad('4', 6, '0')) = 4);

  select string_agg(numero_na_serie::text, ',' order by numero_na_serie)
    into v_obtido from public.vessel_pecas where lote_id = v_lote;
  insert into resultado values (11,
    'e as livres fecham em volta dela',
    '1,2,3,4', coalesce(v_obtido, '(nenhuma)'), coalesce(v_obtido, '') = '1,2,3,4');

  -- ════════════════════════════════════════════════════════════════════════
  -- CENÁRIO 3 — SEM NENHUMA PRESA, O COMPORTAMENTO ANTIGO CONTINUA
  -- Esta migration não pode ter transformado "fechar buraco" em "nunca mexer".
  -- ════════════════════════════════════════════════════════════════════════
  insert into public.vessel_lotes (modelo, quantidade, fabricado_em)
  values ('PROVA CONGELA 3', 6, current_date) returning id into v_lote;
  insert into public.vessel_pecas (codigo, lote_id, numero_na_serie)
  select 'PRV3' || lpad(n::text, 6, '0'), v_lote, n from generate_series(1, 6) n;
  delete from public.vessel_pecas where lote_id = v_lote and numero_na_serie in (2, 5);
  perform public.vessel_renumerar_lote(v_lote);

  select string_agg(numero_na_serie::text, ',' order by numero_na_serie)
    into v_obtido from public.vessel_pecas where lote_id = v_lote;
  insert into resultado values (20,
    'lote SEM peça presa continua fechando o buraco, 1 a N',
    '1,2,3,4', coalesce(v_obtido, '(nenhuma)'), coalesce(v_obtido, '') = '1,2,3,4');

  -- ════════════════════════════════════════════════════════════════════════
  -- CENÁRIO 4 — A FOLGA DO `generate_series`
  -- Peça presa com número MAIOR que o total do lote. Ela não consome vaga de
  -- dentro da faixa; sem a folga `+ presas`, faltaria vaga, o `join` perderia
  -- linhas e NENHUMA peça seria renumerada — em silêncio, sem erro nenhum.
  -- ════════════════════════════════════════════════════════════════════════
  insert into public.vessel_lotes (modelo, quantidade, fabricado_em)
  values ('PROVA CONGELA 4', 3, current_date) returning id into v_lote;
  insert into public.vessel_pecas (codigo, lote_id, numero_na_serie) values
    ('PRV4000050', v_lote, 50),   -- presa, número muito acima do total
    ('PRV4000007', v_lote, 7),
    ('PRV4000009', v_lote, 9);
  update public.vessel_pecas set gravada_em = now() where codigo = 'PRV4000050';
  v_n := public.vessel_renumerar_lote(v_lote);

  insert into resultado values (30,
    'presa com número acima do total FICA onde está',
    '50', (select numero_na_serie::text from public.vessel_pecas where codigo = 'PRV4000050'),
    (select numero_na_serie from public.vessel_pecas where codigo = 'PRV4000050') = 50);
  select string_agg(numero_na_serie::text, ',' order by numero_na_serie)
    into v_obtido from public.vessel_pecas
   where lote_id = v_lote and codigo <> 'PRV4000050';
  insert into resultado values (31,
    'e as livres SÃO renumeradas mesmo assim (sem a folga, nada acontecia calado)',
    '1,2', coalesce(v_obtido, '(nenhuma)'), coalesce(v_obtido, '') = '1,2');
  insert into resultado values (32,
    'a função relata as duas linhas que mexeu',
    '2', v_n::text, v_n = 2);

  -- ════════════════════════════════════════════════════════════════════════
  -- CENÁRIO 5 — LOTE 100% PRESO NÃO MEXE EM NADA
  -- ════════════════════════════════════════════════════════════════════════
  insert into public.vessel_lotes (modelo, quantidade, fabricado_em)
  values ('PROVA CONGELA 5', 3, current_date) returning id into v_lote;
  insert into public.vessel_pecas (codigo, lote_id, numero_na_serie, gravada_em)
  select 'PRV5' || lpad(n::text, 6, '0'), v_lote, n * 10, now() from generate_series(1, 3) n;
  v_n := public.vessel_renumerar_lote(v_lote);
  insert into resultado values (40,
    'lote inteiro preso: nenhuma linha mexida',
    '0', v_n::text, v_n = 0);
  select string_agg(numero_na_serie::text, ',' order by numero_na_serie)
    into v_obtido from public.vessel_pecas where lote_id = v_lote;
  insert into resultado values (41,
    'e os números seguem exatamente como estavam',
    '10,20,30', coalesce(v_obtido, '(nenhuma)'), coalesce(v_obtido, '') = '10,20,30');

  -- ════════════════════════════════════════════════════════════════════════
  -- CENÁRIO 6 — A TRAVA IRMÃ, que já existia, continua de pé
  -- ════════════════════════════════════════════════════════════════════════
  insert into public.vessel_lotes (modelo, quantidade, fabricado_em)
  values ('PROVA CONGELA 6', 2, current_date) returning id into v_lote;
  insert into public.vessel_pecas (codigo, lote_id, numero_na_serie, gravada_em)
  values ('PRV6000001', v_lote, 1, now());
  insert into public.vessel_pecas (codigo, lote_id, numero_na_serie)
  values ('PRV6000002', v_lote, 2);

  v_obtido := coalesce(public.vessel_excluir_peca('PRV6000001')->>'motivo', '(deixou passar!)');
  insert into resultado values (50,
    'excluir peça JÁ GRAVADA continua recusado',
    'esta_gravada', v_obtido, v_obtido = 'esta_gravada');

  insert into public.vessel_registros (codigo, nome, whatsapp, garantia_ate)
  values ('PRV6000002', 'Cliente da prova', '11999999999', current_date + 365);
  v_obtido := coalesce(public.vessel_excluir_peca('PRV6000002')->>'motivo', '(deixou passar!)');
  insert into resultado values (51,
    'excluir peça COM GARANTIA continua recusado',
    'tem_garantia', v_obtido, v_obtido = 'tem_garantia');

  -- ════════════════════════════════════════════════════════════════════════
  -- CENÁRIO 7 — O PORTÃO
  -- ════════════════════════════════════════════════════════════════════════
  perform set_config('request.jwt.claims', '', true);
  update public.profiles set features = array[]::text[] where id = v_pessoa;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pessoa)::text, true);
  begin
    perform public.vessel_renumerar_lote(v_lote);
    insert into resultado values (60, 'sem a chave da ferramenta, recusa',
      'sem_permissao', '(deixou passar!)', false);
  exception when others then
    insert into resultado values (60, 'sem a chave da ferramenta, recusa',
      'sem_permissao', sqlerrm, sqlerrm = 'sem_permissao');
  end;
end $$;

-- O grant NÃO depende da transação acima: é estado do banco.
insert into resultado values (70, 'anon NÃO executa o ajudante',
  'false', has_function_privilege('anon','public.vessel_renumerar_lote(uuid)','execute')::text,
  has_function_privilege('anon','public.vessel_renumerar_lote(uuid)','execute') = false);
insert into resultado values (71,
  'authenticated NÃO executa o ajudante (quem chama é a função de cima)',
  'false', has_function_privilege('authenticated','public.vessel_renumerar_lote(uuid)','execute')::text,
  has_function_privilege('authenticated','public.vessel_renumerar_lote(uuid)','execute') = false);

select * from resultado order by ordem;

select 999 as ordem, 'VEREDITO — asserções que passaram / total' as o_que_prova,
       count(*)::text as esperado,
       count(*) filter (where passou)::text as obtido,
       count(*) = count(*) filter (where passou) as passou
  from resultado;

rollback;
