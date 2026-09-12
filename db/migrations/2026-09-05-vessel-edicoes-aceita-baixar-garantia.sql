-- A trilha `vessel_edicoes` tem uma LISTA FECHADA de ações. Ela é proposital:
-- impede que uma ação escrita errado entre na trilha e vire uma linha que
-- ninguém sabe ler depois. Mas ao criar `vessel_baixar_garantia` eu escrevi na
-- trilha uma ação nova SEM adicioná-la aqui — então toda baixa de garantia
-- morria neste CHECK, a transação inteira voltava atrás e a tela dizia apenas
-- "Não consegui encerrar agora". Nada era alterado, de fato: nunca funcionou.
--
-- ⚠️ LIÇÃO: função que escreve na trilha e ação nova na lista são UMA COISA SÓ.
-- Quem criar a próxima ação tem que mexer nos dois lugares na mesma migration.
alter table public.vessel_edicoes
  drop constraint vessel_edicoes_acao_check;

alter table public.vessel_edicoes
  add constraint vessel_edicoes_acao_check
  check (acao = any (array[
    'desmarcar_gravada',
    'sobrescrever_para_fila',
    'sobrescrever_para_baixa',
    'registro_aprovado',
    'registro_recusado',
    'dono_trocado',
    'baixar_garantia'
  ]));
