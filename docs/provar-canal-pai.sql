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
-- `bling_lojas` tem 5 colunas: `loja_id` e `nome` obrigatórias, `updated_at`
-- com default, `grupo` e `grupo_id`. O insert do Cenário 6 usa só as três que
-- importam para este teste e roda sem ajuste.
--
-- Pessoas e ids usados aqui são os medidos em produção em 21/08/2026 (ver
-- `.superpowers/sdd/2026-08-21-canal-pai-e-supervisora-de-grupo/identificadores-reais.md`).
-- Douglas Pereira é usado nos cenários que precisam de vínculo novo porque hoje
-- ele não tem NENHUM — o "antes" dele já é zero, o que torna a prova legível.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- OS QUATRO PONTOS QUE ESTE ARQUIVO EXISTE PARA TRAVAR
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
-- 3. O vínculo de grupo de UMA pessoa não pode vazar para OUTRA. Todo cenário
--    que insere em `canais_grupos_membros` insere para a própria pessoa
--    personificada — então um teste que só medisse essa mesma pessoa passaria
--    verde mesmo se `gm.profile_id = auth.uid()` fosse apagado de
--    `meus_vinculos()` ou do caminho 4 de `pode_ver_canal`. O Cenário 1 agora
--    também mede a Héllen (vendedora, sem nenhum vínculo de grupo) logo depois
--    de o Douglas ganhar o dele: ela tem de continuar vendo só 1 canal.
--
-- 4. `pode_ver_estoque` tem um ramo de LIBERAÇÃO (`equipes_permissoes`) que
--    exige estar no time — não basta ter sido liberada um dia. O Cenário 7
--    é o que pegaria o defeito em que esse ramo ficasse solto do vínculo:
--    pessoa liberada e SEM vínculo em `equipes_membros` tem de ver `false`.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- RESUMO DO QUE CADA CENÁRIO ESPERA
--
--   1. supervisora do Varejo (Douglas)              → 8 canais · estoque e
--      patrimônio de Dom Pedro e Tivoli · sou_gestor = false · o vínculo de
--      grupo do Douglas NÃO vaza para a Héllen (ela continua vendo só 1)
--   2. gestora da loja Dom Pedro (Douglas)           → só 1 canal · sou_gestor = true
--   3. a MESMA pessoa, gestora do Dom Pedro E        → vê os 8 do Varejo E
--      supervisora do Varejo (Douglas, vínculo duplo)   sou_gestor(Dom Pedro) continua true
--   4. vendedora do Dom Pedro (Héllen, já é hoje)     → só 1 canal · estoque = false
--   5. escopo ligado e sem vínculo nenhum (Douglas)   → 0 canais
--   6. loja nova no Varejo, criada DENTRO do rollback → entra sozinha: 8 → 9
--   7. estoque liberado (Douglas) SEM estar no time   → estoque = false
--   8. escopo_por_equipe = false (Douglas)            → vê os 14 canais

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

  -- A TRAVA CONTRA VAZAMENTO ENTRE PESSOAS: troca para a Héllen (vendedora do
  -- Dom Pedro, sem vínculo de grupo nenhum) enquanto o vínculo do Douglas com
  -- o Varejo ainda está de pé nesta transação. Um teste que só medisse o
  -- Douglas passaria verde mesmo se `gm.profile_id = auth.uid()` tivesse sido
  -- apagado de meus_vinculos()/pode_ver_canal — é este bloco que pegaria isso.
  set local role authenticated;
  set local request.jwt.claims to '{"sub":"454b55dd-0871-4136-92ec-27d002b1ac99","role":"authenticated"}';
  -- ESPERADO: 1 — o vínculo de grupo do Douglas NÃO pode vazar para a Héllen,
  -- que é vendedora do Dom Pedro e tem de continuar vendo só o canal dela.
  select count(*) as helen_esperado_1
    from public.bling_lojas bl where public.pode_ver_canal(bl.loja_id);
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

-- ═══════════════════════════════════════════════════════════════════════════
-- CENÁRIO 7 — estoque liberado, mas SEM estar no time: o ramo da liberação
-- continua exigindo vínculo
--
-- Este é o cenário que teria pego o Crítico da revisão: `pode_ver_estoque`
-- tem um ramo de PAPEL (supervisora/gestor, via tenho_papel_na_equipe) e um
-- ramo de LIBERAÇÃO (equipes_permissoes). A regra de hoje
-- (2026-08-04-escopo-em-vendas-e-estoque.sql) usa UM join com equipes_membros
-- para os dois ramos. Se o ramo da liberação virasse só "existe uma linha em
-- equipes_permissoes com chave='estoque'", sem checar o vínculo, alguém que
-- foi tirada do time (a tela apaga equipes_membros, não equipes_permissoes)
-- continuaria vendo o estoque daquele depósito PARA SEMPRE.
-- ═══════════════════════════════════════════════════════════════════════════
begin;
  set local role postgres;
  -- Douglas ganha o estoque LIBERADO no Dom Pedro, mas nunca entra no time.
  insert into public.equipes_permissoes (equipe_id, profile_id, chave)
  values (
    (select id from public.equipes where nome = 'Dom Pedro'),
    'c7ec03ab-8fad-4f46-bcd9-0ee002bfee0a',  -- Douglas Pereira
    'estoque'
  );

  set local role authenticated;
  set local request.jwt.claims to '{"sub":"c7ec03ab-8fad-4f46-bcd9-0ee002bfee0a","role":"authenticated"}';

  -- ESPERADO: false — liberação sem vínculo em equipes_membros não basta.
  select public.pode_ver_estoque(14888617206) as estoque_liberado_sem_vinculo_esperado_false;
rollback;

-- ═══════════════════════════════════════════════════════════════════════════
-- CENÁRIO 8 — escopo_por_equipe = false continua vendo os 14 canais
--
-- A propriedade que mais importa para não quebrar ninguém: 18 das 23 pessoas
-- de hoje NÃO estão sob escopo por time, e esta migration não pode apertar
-- alcance nenhum para elas. `Falta de dado nunca amplia acesso` é a regra
-- global — mas o inverso vale igual: mexer nos caminhos de quem ESTÁ sob
-- escopo não pode, por acidente, afetar quem não está.
-- ═══════════════════════════════════════════════════════════════════════════
begin;
  set local role postgres;
  update public.profiles set escopo_por_equipe = false
   where id = 'c7ec03ab-8fad-4f46-bcd9-0ee002bfee0a';  -- Douglas Pereira

  set local role authenticated;
  set local request.jwt.claims to '{"sub":"c7ec03ab-8fad-4f46-bcd9-0ee002bfee0a","role":"authenticated"}';

  -- ESPERADO: 14 — os 8 do Varejo + 2 do Atacado + 4 sem grupo, todos os
  -- canais cadastrados, mesmo sem vínculo de time ou de grupo nenhum.
  select count(*) as todos_os_canais_esperado_14
    from public.bling_lojas bl where public.pode_ver_canal(bl.loja_id);
rollback;

-- ─────────────────────────────────────────────────────────────────────────────
-- DEPOIS DE RODAR TUDO, conferir que nada sobrou (todos os blocos terminam em
-- rollback, então isto deve estar idêntico a antes de abrir este arquivo):
--   select
--     (select count(*) from public.canais_grupos_membros) as supervisoras_de_grupo,
--     (select count(*) from public.equipes_membros where profile_id = 'c7ec03ab-8fad-4f46-bcd9-0ee002bfee0a') as vinculos_do_douglas,
--     (select count(*) from public.equipes_permissoes where profile_id = 'c7ec03ab-8fad-4f46-bcd9-0ee002bfee0a') as liberacoes_do_douglas,
--     (select count(*) from public.bling_lojas where loja_id = 999999999) as loja_de_prova_sobrando,
--     (select escopo_por_equipe from public.profiles where id = 'c7ec03ab-8fad-4f46-bcd9-0ee002bfee0a') as escopo_do_douglas;
-- Esperado: supervisoras_de_grupo = 0, vinculos_do_douglas = 0, liberacoes_do_douglas = 0,
-- loja_de_prova_sobrando = 0, escopo_do_douglas = true (o rollback do Cenário 8 desfez o update).
