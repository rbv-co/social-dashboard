-- PROVA DO CANAL PAI E DA SUPERVISORA DE GRUPO — 21/08/2026 (Tarefa 2)
--
-- Cada cenário roda no seu próprio `begin; ... rollback;`, com a trava de RLS
-- ARMADA (`set local role authenticated` + `request.jwt.claims`) — desarmar a
-- trava para o teste passar seria testar outra coisa. `rollback` desfaz TUDO,
-- inclusive os vínculos de teste inseridos como `postgres`: nenhuma conta real
-- é tocada. Rodar bloco por bloco pelo `execute_sql` do MCP (ou psql).
--
-- ⚠️ ESTE ARQUIVO NÃO FOI RODADO NESTA TAREFA. Por decisão de quem encomendou
-- a Tarefa 2, nenhuma ferramenta de banco foi acionada durante a implementação
-- — nem para aplicar a migration, nem para provar. Rodar cada bloco abaixo e
-- conferir cada "ESPERADO" contra o que vier é o próximo passo, de quem for
-- aplicar `db/migrations/2026-08-21-canal-pai-regras.sql`.
--
-- Pessoas e ids usados aqui são os medidos em produção em 21/08/2026 (ver
-- `.superpowers/sdd/2026-08-21-canal-pai-e-supervisora-de-grupo/identificadores-reais.md`).
-- Douglas Pereira é usado nos cenários que precisam de vínculo novo porque hoje
-- ele não tem NENHUM — o "antes" dele já é zero, o que torna a prova legível.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- OS DOIS PONTOS QUE ESTE ARQUIVO EXISTE PARA TRAVAR
--
-- 1. `pode_ver_canal` tem DOIS caminhos para o alcance de grupo. Se o pai
--    valesse só "pelas lojas de baixo" (times do Varejo), a supervisora
--    perderia os 6 canais do Varejo que não têm time nenhum (Amazon Seller,
--    Hortolândia, Shopify, Mercado Livre, Tik Tok, Varejo Fábrica) — canais
--    que ela já vê HOJE pela regra de 20/08. O Cenário 1 mede os 8, não só os
--    2 com time.
--
-- 2. Uma pessoa pode ter DOIS vínculos com o MESMO time (gestora da loja e
--    supervisora do grupo que contém aquela loja). `meu_papel_na_equipe`
--    devolve UM papel só; se `sou_gestor_da_equipe` comparasse com esse papel
--    único, a gestora perderia, calada, o poder de administrar o próprio time
--    no dia em que também virasse supervisora. O Cenário 3 é esse vínculo
--    duplo, e é o mais importante deste arquivo.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- RESUMO DO QUE CADA CENÁRIO ESPERA
--
--   1. supervisora do Varejo (Douglas)              → 8 canais · estoque e
--      patrimônio de Dom Pedro e Tivoli · sou_gestor = false
--   2. gestora da loja Dom Pedro (Douglas)           → só 1 canal · sou_gestor = true
--   3. a MESMA pessoa, gestora do Dom Pedro E        → vê os 8 do Varejo E
--      supervisora do Varejo (Douglas, vínculo duplo)   sou_gestor(Dom Pedro) continua true
--   4. vendedora do Dom Pedro (Héllen, já é hoje)     → só 1 canal · estoque = false
--   5. escopo ligado e sem vínculo nenhum (Douglas)   → 0 canais
--   6. loja nova no Varejo, criada DENTRO do rollback → entra sozinha: 8 → 9

-- ═══════════════════════════════════════════════════════════════════════════
-- CENÁRIO 1 — supervisora do Varejo vê os 8 canais, inclusive os 6 sem time
-- ═══════════════════════════════════════════════════════════════════════════
begin;
  set local role postgres;
  insert into public.canais_grupos_membros (grupo_id, profile_id)
  values (
    (select id from public.canais_grupos where lower(btrim(nome)) = 'varejo'),
    'c7ec03ab-8fad-4f46-bcd9-0ee002bfee0a'  -- Douglas Pereira
  );

  set local role authenticated;
  set local request.jwt.claims to '{"sub":"c7ec03ab-8fad-4f46-bcd9-0ee002bfee0a","role":"authenticated"}';

  -- ESPERADO: 8. Os 2 com time (Loja Dom Pedro, Loja Santa Bárbara d'Oeste) MAIS
  -- os 6 sem time nenhum (Amazon Seller, Loja Hortolândia, Loja Shopify, Seller
  -- Mercado Livre, Tik Tok Shop - La Vessel, Varejo Fábrica).
  select count(*) as canais_varejo_esperado_8
    from public.bling_lojas bl where public.pode_ver_canal(bl.loja_id);

  -- ESPERADO: exatamente os 8 nomes acima, nada do Atacado nem dos 4 sem grupo.
  select bl.nome from public.bling_lojas bl
   where public.pode_ver_canal(bl.loja_id) order by bl.nome;

  -- ESPERADO: true nos dois — estoque de Dom Pedro (depósito 14888617206) e de
  -- Tivoli (depósito 14888726315), os dois times do grupo dela.
  select public.pode_ver_estoque(14888617206) as estoque_dom_pedro_esperado_true;
  select public.pode_ver_estoque(14888726315) as estoque_tivoli_esperado_true;

  -- ESPERADO: false — o depósito do Atacado Nuvem Shop não é do grupo dela.
  select public.pode_ver_estoque(14888248253) as estoque_atacado_esperado_false;

  -- ESPERADO: true — o local de patrimônio do time Dom Pedro está no Varejo.
  select public.pode_ver_bem(
    (select local_id from public.equipes where nome = 'Dom Pedro'), null::uuid
  ) as patrimonio_dom_pedro_esperado_true;

  -- ESPERADO: false — ela supervisiona LEITURA, nunca PODER: não administra
  -- time nenhum só por supervisionar o grupo.
  select public.sou_gestor_da_equipe(
    (select id from public.equipes where nome = 'Dom Pedro')
  ) as sou_gestor_esperado_false;
rollback;

-- ═══════════════════════════════════════════════════════════════════════════
-- CENÁRIO 2 — gestora da loja Dom Pedro vê só a própria loja e administra o time
-- ═══════════════════════════════════════════════════════════════════════════
begin;
  set local role postgres;
  insert into public.equipes_membros (equipe_id, profile_id, papel)
  values (
    (select id from public.equipes where nome = 'Dom Pedro'),
    'c7ec03ab-8fad-4f46-bcd9-0ee002bfee0a',  -- Douglas Pereira
    'gestor'
  );

  set local role authenticated;
  set local request.jwt.claims to '{"sub":"c7ec03ab-8fad-4f46-bcd9-0ee002bfee0a","role":"authenticated"}';

  -- ESPERADO: só "Loja Dom Pedro". Gestora não sobe pro grupo — nível loja.
  select bl.nome from public.bling_lojas bl
   where public.pode_ver_canal(bl.loja_id) order by bl.nome;

  -- ESPERADO: true — ela administra o próprio time.
  select public.sou_gestor_da_equipe(
    (select id from public.equipes where nome = 'Dom Pedro')
  ) as sou_gestor_dom_pedro_esperado_true;
rollback;

-- ═══════════════════════════════════════════════════════════════════════════
-- CENÁRIO 3 — O VÍNCULO DUPLO: gestora do Dom Pedro E supervisora do Varejo
--
-- Este é o cenário que a função tenho_papel_na_equipe existe para acertar. Se
-- sou_gestor_da_equipe comparasse com meu_papel_na_equipe(...) = 'gestor', o
-- resultado abaixo daria FALSE (meu_papel_na_equipe devolve 'supervisora',
-- por prioridade de frase) e a gestora perderia, calada, o poder de
-- administrar o time que ela mesma gerencia.
-- ═══════════════════════════════════════════════════════════════════════════
begin;
  set local role postgres;
  insert into public.equipes_membros (equipe_id, profile_id, papel)
  values (
    (select id from public.equipes where nome = 'Dom Pedro'),
    'c7ec03ab-8fad-4f46-bcd9-0ee002bfee0a',  -- Douglas Pereira
    'gestor'
  );
  insert into public.canais_grupos_membros (grupo_id, profile_id)
  values (
    (select id from public.canais_grupos where lower(btrim(nome)) = 'varejo'),
    'c7ec03ab-8fad-4f46-bcd9-0ee002bfee0a'
  );

  set local role authenticated;
  set local request.jwt.claims to '{"sub":"c7ec03ab-8fad-4f46-bcd9-0ee002bfee0a","role":"authenticated"}';

  -- ESPERADO: 'supervisora' — é SÓ frase de tela (a ordem do case prioriza
  -- supervisora > gestor). NENHUMA decisão de acesso deve passar por aqui.
  select public.meu_papel_na_equipe(
    (select id from public.equipes where nome = 'Dom Pedro')
  ) as papel_devolvido_esperado_supervisora;

  -- ESPERADO: true, MESMO o papel devolvido acima sendo 'supervisora'. Este é
  -- o teste que prova que tenho_papel_na_equipe pergunta "algum destes é meu?"
  -- em vez de "qual é o único" — se voltasse false aqui, a gestora teria
  -- perdido o próprio time ao virar supervisora do grupo.
  select public.sou_gestor_da_equipe(
    (select id from public.equipes where nome = 'Dom Pedro')
  ) as sou_gestor_esperado_true_apesar_do_vinculo_duplo;

  -- ESPERADO: 8 — o alcance de leitura do Varejo continua valendo para ela.
  select count(*) as canais_varejo_esperado_8
    from public.bling_lojas bl where public.pode_ver_canal(bl.loja_id);
rollback;

-- ═══════════════════════════════════════════════════════════════════════════
-- CENÁRIO 4 — vendedora do Dom Pedro (Héllen, vínculo de hoje, sem inserir nada)
-- ═══════════════════════════════════════════════════════════════════════════
begin;
  set local role authenticated;
  set local request.jwt.claims to '{"sub":"454b55dd-0871-4136-92ec-27d002b1ac99","role":"authenticated"}';  -- Héllen Cardoso

  -- ESPERADO: só "Loja Dom Pedro".
  select bl.nome from public.bling_lojas bl
   where public.pode_ver_canal(bl.loja_id) order by bl.nome;

  -- ESPERADO: false — vendedora não vê estoque, nem do próprio time.
  select public.pode_ver_estoque(14888617206) as estoque_esperado_false;
rollback;

-- ═══════════════════════════════════════════════════════════════════════════
-- CENÁRIO 5 — escopo ligado e sem vínculo nenhum (Douglas, sem inserir nada)
-- ═══════════════════════════════════════════════════════════════════════════
begin;
  set local role authenticated;
  set local request.jwt.claims to '{"sub":"c7ec03ab-8fad-4f46-bcd9-0ee002bfee0a","role":"authenticated"}';  -- Douglas Pereira

  -- ESPERADO: 0 — Douglas está sob escopo_por_equipe=true e hoje não tem
  -- vínculo nenhum, nem direto nem por grupo. É ele quem vê tela vazia hoje.
  select count(*) as canais_esperado_0
    from public.bling_lojas bl where public.pode_ver_canal(bl.loja_id);
rollback;

-- ═══════════════════════════════════════════════════════════════════════════
-- CENÁRIO 6 — loja nova no Varejo, criada DENTRO do rollback, entra sozinha
--
-- É a propriedade que faz "loja nova entra sozinha" ser verdade: ninguém
-- cadastra vínculo nenhum para a loja nova, e mesmo assim ela some no alcance
-- de quem já supervisiona o grupo — porque o caminho 4 de pode_ver_canal olha
-- o grupo da loja na hora, não uma lista guardada.
-- ═══════════════════════════════════════════════════════════════════════════
begin;
  set local role postgres;
  insert into public.canais_grupos_membros (grupo_id, profile_id)
  values (
    (select id from public.canais_grupos where lower(btrim(nome)) = 'varejo'),
    'c7ec03ab-8fad-4f46-bcd9-0ee002bfee0a'  -- Douglas Pereira
  );

  set local role authenticated;
  set local request.jwt.claims to '{"sub":"c7ec03ab-8fad-4f46-bcd9-0ee002bfee0a","role":"authenticated"}';
  -- ESPERADO: 8 — a loja nova ainda não existe.
  select count(*) as antes_esperado_8
    from public.bling_lojas bl where public.pode_ver_canal(bl.loja_id);

  set local role postgres;
  -- ⚠️ Se `bling_lojas` tiver alguma outra coluna NOT NULL sem default, este
  -- insert falha e precisa ganhar essa coluna antes de rodar — não foi
  -- conferido contra o banco nesta tarefa (decisão de não tocar no banco).
  -- `loja_id`, `nome` e `grupo_id` são as três colunas que os arquivos
  -- vizinhos deste repositório (provar-grupo-do-canal.sql, a migration da
  -- Tarefa 1) usam para o mesmo fim.
  insert into public.bling_lojas (loja_id, nome, grupo_id)
  values (
    999999999, 'PROVA Canal Novo do Varejo',
    (select id from public.canais_grupos where lower(btrim(nome)) = 'varejo')
  );

  set local role authenticated;
  set local request.jwt.claims to '{"sub":"c7ec03ab-8fad-4f46-bcd9-0ee002bfee0a","role":"authenticated"}';
  -- ESPERADO: 9 — a loja nova entrou sozinha, sem vínculo cadastrado para ela.
  select count(*) as depois_esperado_9
    from public.bling_lojas bl where public.pode_ver_canal(bl.loja_id);

  -- ESPERADO: true.
  select public.pode_ver_canal(999999999) as loja_nova_esperado_true;
rollback;

-- ─────────────────────────────────────────────────────────────────────────────
-- DEPOIS DE RODAR TUDO, conferir que nada sobrou (todos os blocos terminam em
-- rollback, então isto deve estar idêntico a antes de abrir este arquivo):
--   select
--     (select count(*) from public.canais_grupos_membros) as supervisoras_de_grupo,
--     (select count(*) from public.equipes_membros where profile_id = 'c7ec03ab-8fad-4f46-bcd9-0ee002bfee0a') as vinculos_do_douglas,
--     (select count(*) from public.bling_lojas where loja_id = 999999999) as loja_de_prova_sobrando;
-- Esperado: supervisoras_de_grupo = 0, vinculos_do_douglas = 0, loja_de_prova_sobrando = 0.
