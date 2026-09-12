-- PROVA DE `2026-09-01-zzz-marcar-gravada-para-de-mentir.sql`
--
--   node coletor/provar-migration.mjs \
--     db/migrations/2026-09-01-zzz-marcar-gravada-para-de-mentir.sql \
--     docs/provar-marcar-gravada.sql
--
-- Transação que SE DESFAZ. Nada fica no banco, e nenhuma peça real é tocada:
-- o lote da prova é criado aqui dentro.
--
-- ⚠️ NÃO DESARMA O PORTÃO. `auth.uid()` é nulo numa conexão de admin, então
-- `is_vessel_admin()` daria falso e TUDO responderia `sem_permissao` — as
-- asserções voltariam falsas em bloco e pareceria defeito da migration.
-- Empresta-se a chave a uma conta que já existe, dentro da transação.

begin;

create temp table resultado(ordem int, o_que_prova text, esperado text, obtido text, passou boolean)
  on commit drop;

do $$
declare
  v_pessoa   uuid;
  v_lote     uuid;
  v_codigo   text := 'PROVAMARC1';
  v_r        json;
begin
  perform set_config('request.jwt.claims', '', true);
  select id into v_pessoa from public.profiles order by id limit 1;
  update public.profiles set features = array['autenticidade'], is_superadmin = false where id = v_pessoa;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pessoa)::text, true);

  insert into public.vessel_lotes (modelo, quantidade, fabricado_em)
  values ('LOTE DA PROVA', 1, current_date) returning id into v_lote;
  insert into public.vessel_pecas (codigo, lote_id, numero_na_serie)
  values (v_codigo, v_lote, 1);

  -- ── 1. O CAMINHO FELIZ continua funcionando ──────────────────────────
  v_r := public.vessel_marcar_gravada(v_codigo);
  insert into resultado values (1, 'marca a peça e responde ok',
    'true', (v_r->>'ok'), (v_r->>'ok') = 'true');
  insert into resultado values (2, 'e diz que NÃO estava gravada antes',
    'false', (v_r->>'ja_estava'), (v_r->>'ja_estava') = 'false');
  insert into resultado values (3, 'a peça ficou realmente gravada',
    'true',
    (select (gravada_em is not null)::text from public.vessel_pecas where codigo = v_codigo),
    (select gravada_em is not null from public.vessel_pecas where codigo = v_codigo));

  -- ── 2. MARCAR DE NOVO não é erro ─────────────────────────────────────
  -- Quem grava em série toca duas vezes por dúvida. Falhar aqui ensinaria a
  -- pessoa a ignorar o aviso — e aí o aviso de verdade também some.
  v_r := public.vessel_marcar_gravada(v_codigo);
  insert into resultado values (10, 'marcar de novo NÃO é erro',
    'true', (v_r->>'ok'), (v_r->>'ok') = 'true');
  insert into resultado values (11, 'mas avisa que JÁ ESTAVA gravada',
    'true', (v_r->>'ja_estava'), (v_r->>'ja_estava') = 'true');

  -- ── 3. O BURACO QUE ISTO FECHA ───────────────────────────────────────
  -- ANTES desta migration, esta chamada devolvia `ok: true`. A tela dizia
  -- "gravada" para um código que não existe — e numa gravação em série isso
  -- vira etiqueta na bolsa sem registro nenhum, indistinguível por fora.
  v_r := public.vessel_marcar_gravada('NAOEXISTE9');
  insert into resultado values (20, 'código que NÃO existe agora é recusado (antes dizia ok)',
    'false', (v_r->>'ok'), (v_r->>'ok') = 'false');
  insert into resultado values (21, 'e o motivo é o CERTO, não um genérico',
    'peca_nao_existe', coalesce(v_r->>'motivo','(nenhum)'), (v_r->>'motivo') = 'peca_nao_existe');

  -- ── 4. SEM A CHAVE, continua recusando pelo motivo certo ─────────────
  perform set_config('request.jwt.claims', '', true);
  update public.profiles set features = array[]::text[] where id = v_pessoa;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pessoa)::text, true);
  v_r := public.vessel_marcar_gravada(v_codigo);
  insert into resultado values (30, 'sem a chave da ferramenta, recusa',
    'false', (v_r->>'ok'), (v_r->>'ok') = 'false');
  insert into resultado values (31, 'com o motivo de permissão, não o de peça inexistente',
    'sem_permissao', coalesce(v_r->>'motivo','(nenhum)'), (v_r->>'motivo') = 'sem_permissao');

  -- ── 5. QUEM PODE CHAMAR ──────────────────────────────────────────────
  insert into resultado values (40, 'anon NÃO executa',
    'false', has_function_privilege('anon','public.vessel_marcar_gravada(text)','execute')::text,
    has_function_privilege('anon','public.vessel_marcar_gravada(text)','execute') = false);
  insert into resultado values (41, 'authenticated executa (a tela chama; a trava é o portão)',
    'true', has_function_privilege('authenticated','public.vessel_marcar_gravada(text)','execute')::text,
    has_function_privilege('authenticated','public.vessel_marcar_gravada(text)','execute') = true);
end $$;

select * from resultado order by ordem;

select 999 as ordem, 'VEREDITO — asserções que passaram / total' as o_que_prova,
       count(*)::text as esperado,
       count(*) filter (where passou)::text as obtido,
       count(*) = count(*) filter (where passou) as passou
  from resultado;

rollback;
