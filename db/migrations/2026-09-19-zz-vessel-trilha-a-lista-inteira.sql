-- ══════════════════════════════════════════════════════════════════════════
-- A LISTA DE AÇÕES DA TRILHA, INTEIRA — conserto de 19/09/2026
-- ══════════════════════════════════════════════════════════════════════════
-- Duas entregas da Fase 2 andaram ao mesmo tempo, cada uma acrescentando UMA
-- ação à lista fechada de `vessel_edicoes.acao`, e cada uma reescrevendo a
-- lista a partir do que via quando começou:
--
--   • `2026-09-19-vessel-registro-em-peca-de-verdade.sql` → 'conta_ligada_pelo_cpf'
--   • `2026-09-19-vessel-material-do-lote-pelo-painel.sql' → 'material_do_lote'
--
-- Aplicadas em sequência, a segunda APAGOU a ação da primeira: o `drop
-- constraint` + `add constraint` não junta, substitui. Medido no banco logo
-- depois de aplicar: 13 ações na lista, sem `conta_ligada_pelo_cpf`.
--
-- ⚠️ O ESTRAGO QUE ISSO CAUSARIA: `vessel_conta_criar` grava essa ação quando
-- liga pelo CPF as peças que a cliente já tinha registrado. Com a ação fora da
-- lista, o CHECK derruba a TRANSAÇÃO INTEIRA — e a cliente não consegue criar
-- conta, sem ninguém entender por quê. Quem já tinha peça registrada seria
-- justamente quem não conseguiria entrar.
--
-- Esta migration devolve a lista COMPLETA, com as 14 ações. Ela não muda mais
-- nada.
--
-- LIÇÃO, para a próxima vez: lista fechada que duas entregas mexem ao mesmo
-- tempo tem de ser escrita como ACRÉSCIMO do que está no banco na hora, e não
-- como uma lista digitada de novo.

alter table public.vessel_edicoes
  drop constraint if exists vessel_edicoes_acao_check;
alter table public.vessel_edicoes
  add constraint vessel_edicoes_acao_check
  check (acao = any (array[
    'desmarcar_gravada','sobrescrever_para_fila','sobrescrever_para_baixa',
    'registro_aprovado','registro_recusado','dono_trocado','baixar_garantia',
    'lote_excluido','peca_excluida','etiqueta_adotada','numero_trocado',
    'transferida_pela_dona','material_do_lote','conta_ligada_pelo_cpf'
  ]));
