-- PROVA DA LISTA DE ESPERA DA VESSEL BRASIL
--
-- Roda inteiro e DESFAZ: não deixa uma linha para trás. Foi feito assim de
-- propósito — limpar depois com DELETE exigiria desarmar a trava, e teste que
-- precisa desarmar a trava não está provando a trava.
--
-- Rodado em 28/08/2026: os nove passos deram o esperado.

begin;

create temp table prova(passo text, resultado text) on commit drop;

insert into prova
select 'A. trava (RLS) ligada', relrowsecurity::text from pg_class where relname='vessel_lista_espera';
-- esperado: true

insert into prova
select 'B. politicas de leitura (tem de ser 0)', count(*)::text from pg_policies where tablename='vessel_lista_espera';
-- esperado: 0 — é isso que impede baixarem a lista de e-mails

insert into prova
select 'C. cadastro bom responde', public.vessel_entrar_na_lista('Ana Teste','ana@teste.vesselbrasil','19996170272','v1')::text;
-- esperado: {"ok" : true}

insert into prova
select 'D. gravou 1 linha', count(*)::text from public.vessel_lista_espera where email='ana@teste.vesselbrasil';
-- esperado: 1 — a prova tem de MUDAR o valor, não só rodar sem erro

select public.vessel_entrar_na_lista('Ana De Novo','ANA@teste.vesselbrasil','19996170272','v1');
insert into prova
select 'E. e-mail repetido continua 1 linha', count(*)::text from public.vessel_lista_espera where lower(email)='ana@teste.vesselbrasil';
-- esperado: 1 — e repare no ANA@ em maiúscula: prova que não distingue caixa

select public.vessel_entrar_na_lista('Robo','robo@teste.vesselbrasil','19996170272','v1','sou-robo');
insert into prova
select 'F. armadilha NAO gravou (tem de ser 0)', count(*)::text from public.vessel_lista_espera where email='robo@teste.vesselbrasil';
-- esperado: 0 — e a função responde sucesso, pro robô não descobrir

insert into prova
select 'G. ip guardado como hash de 64', (length(ip_hash)=64)::text from public.vessel_lista_espera where email='ana@teste.vesselbrasil';
-- esperado: true — IP cru nunca é gravado

insert into prova
select 'H. campo errado e recusado', public.vessel_entrar_na_lista('','x','1','v1')::text;
-- esperado: {"ok" : false, "erro" : "Confira os campos e tente de novo."}

insert into prova
select 'I. +55 aceito', public.vessel_entrar_na_lista('Bia','bia@teste.vesselbrasil','5519996170272','v1')::text;
-- esperado: {"ok" : true} — o banco tem de aceitar as mesmas formas que a tela

select * from prova order by passo;

rollback;

-- DEPOIS DE RODAR, confira que não sobrou nada:
--   select count(*) from public.vessel_lista_espera;
--
-- E de fora, com a chave pública (a mesma do HTML), a tabela tem de ser cega:
--   curl ".../rest/v1/vessel_lista_espera?select=*" -H "apikey: <anon>" → []
