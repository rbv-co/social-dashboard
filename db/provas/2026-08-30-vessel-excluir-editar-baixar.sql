-- PROVA POR ROLLBACK das funções de excluir, editar e baixar do Selo Vessel.
--
-- Rode inteiro, de uma vez. No fim ele desfaz tudo: nenhuma linha fica no banco.
--
-- ── DUAS ARMADILHAS QUE ESTA PROVA JÁ CAIU, e por isso ela é assim ──────────
--
-- 1. O SERVICE ROLE NÃO CONTORNA O PORTÃO. A primeira versão desta prova rodou
--    numa conexão administrativa e as oito asserções voltaram FALSAS de uma vez.
--    Falha em bloco é sinal de causa única, e era esta: `auth.uid()` é NULO numa
--    conexão dessas, então `is_vessel_admin()` dá falso e TODA função devolve
--    'sem_permissao'. A prova estava medindo o portão, não a regra.
--    A saída não é desarmar a trava — teste que precisa desarmar a trava está
--    provando outra coisa. É dar a chave à conta de ROBÔ dentro da transação e
--    fazer a sessão SER ela. O rollback devolve a chave.
--
-- 2. `union all` NÃO GARANTE ORDEM DE AVALIAÇÃO. A asserção do histórico ficou
--    vermelha sozinha porque a contagem rodou antes das baixas existirem.
--    Prova cujos passos dependem um do outro precisa de ordem garantida: por
--    isso os passos vivem num bloco `do $$`, um por vez, gravando numa tabela
--    temporária.
--
-- E o lote real do dono (Mônaco Quartz LV1021) nunca é tocado: a prova cria os
-- próprios lotes, com id fixo e modelo 'PROVA'.

begin;

-- a conta de ROBÔ (claudecode@rbvcompany.com) recebe a chave só aqui dentro
update public.profiles set features = array_append(coalesce(features,'{}'), 'autenticidade')
 where id = '5efc08ed-ca8a-437b-9e43-31542029cea9';
set local request.jwt.claims = '{"sub":"5efc08ed-ca8a-437b-9e43-31542029cea9","role":"authenticated"}';

create temp table resultado (n int, prova text, passou boolean) on commit drop;

do $$
declare v_lote uuid := '11111111-1111-1111-1111-111111111111';
begin
  insert into public.vessel_lotes (id, modelo, quantidade, fabricado_em)
  values (v_lote, 'PROVA', 2, current_date);
  insert into public.vessel_pecas (codigo, lote_id, numero_na_serie, gravada_em) values
    ('PROVAGRAV01', v_lote, 1, now()),
    ('PROVALIVRE1', v_lote, 2, null);

  insert into resultado values (0, 'o portao deixa passar', public.is_vessel_admin());
  insert into resultado values (1, 'motivo invalido recusa',
    (public.vessel_baixar_peca('PROVAGRAV01','qualquer') ->> 'motivo') = 'motivo_invalido');
  insert into resultado values (2, 'baixa funciona',
    (public.vessel_baixar_peca('PROVAGRAV01','extraviada') ->> 'ok')::boolean);
  insert into resultado values (3, 'baixa repetida recusa',
    (public.vessel_baixar_peca('PROVAGRAV01','defeito') ->> 'motivo') = 'ja_baixada');
  insert into resultado values (4, 'desfazer funciona',
    (public.vessel_desfazer_baixa('PROVAGRAV01') ->> 'ok')::boolean);
  insert into resultado values (5, 'desfazer duas vezes recusa',
    (public.vessel_desfazer_baixa('PROVAGRAV01') ->> 'motivo') = 'nao_esta_baixada');
  insert into resultado values (6, 'baixar de novo depois de desfazer',
    (public.vessel_baixar_peca('PROVAGRAV01','devolvida') ->> 'ok')::boolean);
  insert into resultado values (7, 'historico guarda AS DUAS baixas',
    (select count(*) from public.vessel_baixas where codigo = 'PROVAGRAV01') = 2);
  insert into resultado values (8, 'peca inexistente recusa',
    (public.vessel_baixar_peca('NAOEXISTE1','defeito') ->> 'motivo') = 'peca_nao_existe');
  insert into resultado values (9, 'vessel_alertas ainda responde',
    (public.vessel_alertas() ->> 'ok')::boolean);

  -- 10. excluir lote com peça gravada tem de RECUSAR, dizendo quantas
  insert into resultado values (10, 'excluir lote com gravada recusa',
    (public.vessel_excluir_lote(v_lote) ->> 'motivo') = 'tem_gravada');
  insert into resultado values (11, 'e diz quantas estao gravadas',
    (public.vessel_excluir_lote(v_lote) ->> 'gravadas')::int = 1);

  -- 12. excluir peça gravada tem de RECUSAR
  insert into resultado values (12, 'excluir peca gravada recusa',
    (public.vessel_excluir_peca('PROVAGRAV01') ->> 'motivo') = 'esta_gravada');

  -- 13. excluir peça NÃO gravada funciona, e a quantidade do lote acompanha
  insert into resultado values (13, 'excluir peca livre funciona',
    (public.vessel_excluir_peca('PROVALIVRE1') ->> 'ok')::boolean);
  insert into resultado values (14, 'quantidade do lote acompanha',
    (select quantidade from public.vessel_lotes where id = v_lote) = 1);

  -- 15. sem peça gravada, o lote inteiro sai
  insert into public.vessel_lotes (id, modelo, quantidade, fabricado_em)
  values ('22222222-2222-2222-2222-222222222222', 'PROVA LIVRE', 2, current_date);
  insert into public.vessel_pecas (codigo, lote_id, numero_na_serie) values
    ('PROVALIVRE2', '22222222-2222-2222-2222-222222222222', 1),
    ('PROVALIVRE3', '22222222-2222-2222-2222-222222222222', 2);
  insert into resultado values (15, 'excluir lote livre funciona',
    (public.vessel_excluir_lote('22222222-2222-2222-2222-222222222222') ->> 'ok')::boolean);
  insert into resultado values (16, 'e as pecas dele sumiram junto',
    (select count(*) from public.vessel_pecas
      where lote_id = '22222222-2222-2222-2222-222222222222') = 0);

  -- 17. criar lote continua funcionando depois de trocar o miolo pelo ajudante
  insert into resultado values (17, 'gerar lote ainda funciona',
    (public.vessel_gerar_lote('PROVA EDIT', 'Cor', 'SKU1', 3, current_date, null) ->> 'ok')::boolean);

  -- 18. e os 3 codigos sao DIFERENTES entre si e tem 10 caracteres
  insert into resultado values (18, 'os codigos sao distintos e com 10 letras',
    (select count(distinct codigo) = 3 and bool_and(length(codigo) = 10)
       from public.vessel_pecas p
       join public.vessel_lotes l on l.id = p.lote_id
      where l.modelo = 'PROVA EDIT'));

  -- 19. editar nome e data e seguro
  insert into public.vessel_lotes (id, modelo, quantidade, fabricado_em)
  values ('33333333-3333-3333-3333-333333333333', 'ANTES', 2, '2020-01-01');
  insert into public.vessel_pecas (codigo, lote_id, numero_na_serie, gravada_em) values
    ('PROVAED0001', '33333333-3333-3333-3333-333333333333', 1, now()),
    ('PROVAED0002', '33333333-3333-3333-3333-333333333333', 2, null);
  insert into resultado values (19, 'editar nome e data funciona',
    (public.vessel_editar_lote('33333333-3333-3333-3333-333333333333',
     'DEPOIS', 'Nova', 'SKU9', '2026-03-01', 2) ->> 'ok')::boolean);
  insert into resultado values (20, 'a data mudou mesmo',
    (select fabricado_em = '2026-03-01' and modelo = 'DEPOIS'
       from public.vessel_lotes where id = '33333333-3333-3333-3333-333333333333'));

  -- 21. AUMENTAR cria codigos novos continuando a serie
  insert into resultado values (21, 'aumentar cria pecas',
    (public.vessel_editar_lote('33333333-3333-3333-3333-333333333333',
     'DEPOIS', 'Nova', 'SKU9', '2026-03-01', 4) ->> 'quantidade')::int = 4);
  insert into resultado values (22, 'a serie continua, nao repete numero',
    (select count(distinct numero_na_serie) = 4 and max(numero_na_serie) = 4
       from public.vessel_pecas where lote_id = '33333333-3333-3333-3333-333333333333'));

  -- 23. DIMINUIR tira as nao gravadas, e a gravada FICA
  insert into resultado values (23, 'diminuir tira as livres',
    (public.vessel_editar_lote('33333333-3333-3333-3333-333333333333',
     'DEPOIS', 'Nova', 'SKU9', '2026-03-01', 1) ->> 'quantidade')::int = 1);
  insert into resultado values (24, 'a peca gravada sobreviveu',
    (select count(*) = 1 from public.vessel_pecas
      where lote_id = '33333333-3333-3333-3333-333333333333' and codigo = 'PROVAED0001'));

  -- 25 a 27. Diminuir ABAIXO do gravado. Um lote NOVO, com DUAS gravadas.
  --
  -- A primeira versao desta prova pedia quantidade ZERO e aceitava
  -- 'dados_invalidos' OU 'abaixo_do_gravado'. Zero cai sempre no primeiro
  -- (a funcao exige de 1 a 500), entao a recusa que mais importa do plano
  -- NUNCA era testada — a asserçao passava sem provar nada.
  insert into public.vessel_lotes (id, modelo, quantidade, fabricado_em)
  values ('44444444-4444-4444-4444-444444444444', 'DUAS GRAVADAS', 2, current_date);
  insert into public.vessel_pecas (codigo, lote_id, numero_na_serie, gravada_em) values
    ('PROVAED0003', '44444444-4444-4444-4444-444444444444', 1, now()),
    ('PROVAED0004', '44444444-4444-4444-4444-444444444444', 2, now());
  insert into resultado values (25, 'diminuir ABAIXO do gravado recusa',
    (public.vessel_editar_lote('44444444-4444-4444-4444-444444444444',
     'DUAS','x','y',current_date,1) ->> 'motivo') = 'abaixo_do_gravado');
  insert into resultado values (26, 'e diz quantas estao presas',
    (public.vessel_editar_lote('44444444-4444-4444-4444-444444444444',
     'DUAS','x','y',current_date,1) ->> 'gravadas')::int = 2);
  insert into resultado values (27, 'e NAO apagou nenhuma delas',
    (select count(*) = 2 from public.vessel_pecas
      where lote_id = '44444444-4444-4444-4444-444444444444'));

  -- ── A GARANTIA DA CLIENTE PRENDE A PEÇA TANTO QUANTO A GRAVAÇÃO ────────
  -- `gravada_em` não era a única prova de que a peça está no mundo.
  -- `vessel_registrar` NÃO exige gravação: a cliente registra a garantia pelo
  -- CÓDIGO, e o código existe desde que o lote nasceu — conferido no banco, já
  -- havia registro de garantia em peça não gravada. E
  -- `vessel_registros.codigo` referencia `vessel_pecas` com `on delete
  -- cascade`: apagar a peça levava a garantia da cliente junto, calada.
  -- `comprado_em` e `garantia_ate` são obrigatórios na tabela.
  insert into public.vessel_lotes (id, modelo, quantidade, fabricado_em)
  values ('55555555-5555-5555-5555-555555555555', 'SO GARANTIA', 2, current_date);
  insert into public.vessel_pecas (codigo, lote_id, numero_na_serie, gravada_em) values
    ('PROVAGAR001', '55555555-5555-5555-5555-555555555555', 1, null),
    ('PROVAGAR002', '55555555-5555-5555-5555-555555555555', 2, null);
  insert into public.vessel_registros (codigo, nome, whatsapp, comprado_em, garantia_ate)
  values ('PROVAGAR001', 'Cliente da Prova', '11999999999',
          current_date, current_date + 365);

  insert into resultado values (28, 'excluir lote com garantia recusa (nenhuma gravada)',
    (public.vessel_excluir_lote('55555555-5555-5555-5555-555555555555') ->> 'motivo') = 'tem_garantia');
  insert into resultado values (29, 'e diz quantas garantias estao penduradas',
    (public.vessel_excluir_lote('55555555-5555-5555-5555-555555555555') ->> 'garantias')::int = 1);
  insert into resultado values (30, 'excluir a PECA com garantia recusa',
    (public.vessel_excluir_peca('PROVAGAR001') ->> 'motivo') = 'tem_garantia');
  insert into resultado values (31, 'e a garantia da cliente continua no banco',
    (select count(*) = 1 from public.vessel_registros where codigo = 'PROVAGAR001'));

  -- DIMINUIR tem de tirar a SEM garantia, nunca a com. Cada passo num insert
  -- proprio: `a and b` nao garante ordem de avaliacao, e a segunda metade
  -- depende da primeira ter rodado.
  insert into resultado values (32, 'diminuir de 2 para 1 funciona',
    (public.vessel_editar_lote('55555555-5555-5555-5555-555555555555',
     'SO GARANTIA','x','y',current_date,1) ->> 'ok')::boolean);
  insert into resultado values (33, 'e quem saiu foi a SEM garantia',
    (select count(*) = 1 and count(*) filter (where codigo = 'PROVAGAR001') = 1
       from public.vessel_pecas where lote_id = '55555555-5555-5555-5555-555555555555'));

  -- ── SALVAR SEM MUDAR A QUANTIDADE TAMBEM RENUMERA ──────────────────────
  -- A renumeracao vivia dentro do `if`/`elsif` da quantidade: salvar um lote
  -- com buraco na serie SEM mexer no numero nao consertava nada. E buraco na
  -- serie nao e hipotese — o lote real do Monaco tinha quantidade 20 com pecas
  -- numeradas de 7 a 11, e a cliente lia "peca 7 de 20" numa fornada de 5.
  insert into public.vessel_lotes (id, modelo, quantidade, fabricado_em)
  values ('66666666-6666-6666-6666-666666666666', 'BURACO NA SERIE', 3, current_date);
  insert into public.vessel_pecas (codigo, lote_id, numero_na_serie) values
    ('PROVABUR001', '66666666-6666-6666-6666-666666666666', 7),
    ('PROVABUR002', '66666666-6666-6666-6666-666666666666', 9),
    ('PROVABUR003', '66666666-6666-6666-6666-666666666666', 11);
  insert into resultado values (34, 'salvar SEM mudar a quantidade funciona',
    (public.vessel_editar_lote('66666666-6666-6666-6666-666666666666',
     'BURACO NA SERIE','x','y',current_date,3) ->> 'ok')::boolean);
  insert into resultado values (35, 'e a serie fechou em 1,2,3 sem a quantidade ter mudado',
    (select array_agg(numero_na_serie order by numero_na_serie) = array[1,2,3]
       from public.vessel_pecas where lote_id = '66666666-6666-6666-6666-666666666666'));

  -- ── QUEM PODE CHAMAR, e nao so o que a funcao FAZ ───────────────────────
  -- As asserçoes acima medem COMPORTAMENTO. Nenhuma delas pegaria o furo que
  -- foi para producao em 30/08: `vessel_criar_pecas` ficou executavel por
  -- QUALQUER pessoa logada, porque `revoke ... from public, anon` NAO tira a
  -- concessao que o Postgres da por default a `authenticated`. E o ajudante era
  -- security definer SEM portao por dentro — a concessao era a unica porta.
  -- Estas quatro linhas sao a versao permanente daquela liçao.
  insert into resultado values (90, 'ajudante criar_pecas: quem esta logado NAO executa',
    has_function_privilege('authenticated','public.vessel_criar_pecas(uuid,int,int)','execute') = false);
  insert into resultado values (91, 'ajudante renumerar_lote: quem esta logado NAO executa',
    has_function_privilege('authenticated','public.vessel_renumerar_lote(uuid)','execute') = false);
  insert into resultado values (92, 'nenhuma funcao de administracao aberta ao ANONIMO',
    (select bool_and(has_function_privilege('anon', p.oid, 'execute') = false)
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('vessel_gerar_lote','vessel_editar_lote','vessel_excluir_lote',
                          'vessel_excluir_peca','vessel_baixar_peca','vessel_desfazer_baixa',
                          'vessel_marcar_gravada','vessel_alertas',
                          'vessel_criar_pecas','vessel_renumerar_lote')));
  insert into resultado values (93, 'e toda funcao de administracao tem portao POR DENTRO',
    (select bool_and(pg_get_functiondef(p.oid) like '%is_vessel_admin()%')
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('vessel_gerar_lote','vessel_editar_lote','vessel_excluir_lote',
                          'vessel_excluir_peca','vessel_baixar_peca','vessel_desfazer_baixa',
                          'vessel_marcar_gravada','vessel_alertas',
                          'vessel_criar_pecas','vessel_renumerar_lote')));
end $$;

-- TODAS as linhas têm de vir passou = true. Qualquer false ou nulo é defeito.
select * from resultado order by n;

rollback;
