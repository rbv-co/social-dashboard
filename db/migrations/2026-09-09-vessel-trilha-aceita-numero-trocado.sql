-- A TRILHA PASSA A ACEITAR `numero_trocado`.
--
-- ⚠️ POR QUE ISTO VEM ANTES da renumeração, e não junto: `vessel_edicoes` tem
-- uma LISTA FECHADA de ações. Escrever uma ação fora da lista não falha só
-- aquela linha — o CHECK derruba a TRANSAÇÃO INTEIRA, e a renumeração das 71
-- peças voltaria atrás sem nenhuma mensagem útil. Já aconteceu nesta casa em
-- 05/09/2026 com `baixar_garantia`: a função nunca rodou uma vez sequer e a
-- tela só dizia "não consegui".
--
-- A ação registra a correção de 09/09/2026: o número de série passou a ser
-- contado por PRODUTO, e 71 peças mudaram de número. Sem trilha, essa troca
-- seria invisível — e é justamente o tipo de mudança que alguém vai querer
-- reconstituir depois ("por que esta bolsa era a 001 e virou a 003?").
alter table public.vessel_edicoes drop constraint if exists vessel_edicoes_acao_check;
alter table public.vessel_edicoes add constraint vessel_edicoes_acao_check
  check (acao = any (array[
    'desmarcar_gravada','sobrescrever_para_fila','sobrescrever_para_baixa',
    'registro_aprovado','registro_recusado','dono_trocado','baixar_garantia',
    'lote_excluido','peca_excluida','etiqueta_adotada','numero_trocado'
  ]));
