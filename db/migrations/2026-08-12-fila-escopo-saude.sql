-- A fila passa a tratar TRÊS perguntas sobre a mesma campanha
--
-- A coluna `escopo` nasceu com dois valores (2026-07-29) porque pausar criativos
-- não responde se o orçamento deve subir. Faltou o terceiro: o ALERTA DE SAÚDE,
-- que vira item próprio na fila quando o robô não trouxe sugestão de verba
-- (campanha com frequência alta e veredito 'manter', por exemplo).
--
-- MEDIDO EM 12/08/2026, rodando os módulos reais da fila. Sem este valor, a
-- dispensa de um alerta de saúde caía no default 'orcamento' e fazia as DUAS
-- coisas erradas ao mesmo tempo:
--
--   1. NÃO dispensava o alerta. `mesclarSaude` roda depois de `montarFila` e só
--      pulava campanha que já estivesse na fila de orçamento; uma campanha só
--      com alerta não estava em lugar nenhum e ressuscitava no carregamento
--      seguinte. Clicar em "Recusar" não fazia nada visível.
--   2. CALAVA por 7 dias a sugestão de ORÇAMENTO da mesma campanha. É o item 2
--      da lista do dono: "qualquer ação tomada finaliza a sugestão".
--
-- É só afrouxar o CHECK: nenhuma linha existente muda de valor (hoje são 36
-- 'orcamento' e 7 'criativos', nenhuma nula).

alter table public.gt_fila_decisoes
  drop constraint if exists gt_fila_decisoes_escopo_check;

alter table public.gt_fila_decisoes
  add constraint gt_fila_decisoes_escopo_check
  check (escopo in ('orcamento', 'criativos', 'saude'));

comment on column public.gt_fila_decisoes.escopo is
  'SOBRE O QUE foi a decisao. "orcamento" responde a sugestao de verba da campanha; "criativos" responde aos anuncios fracos dela; "saude" responde ao alerta de saude (frequencia, custo sem resultado) que virou item proprio.';
