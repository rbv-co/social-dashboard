-- QUANDO A CANDIDATA ENTROU NA PLANILHA DO RH (25/09/2026).
--
-- ⚠️ O ROBÔ NÃO REESCREVE A PLANILHA, ACRESCENTA. Pedido do dono: o que o RH
-- editar tem de ficar. O robô relê o arquivo do Zoho, mantém as linhas como o RH
-- deixou e só põe as candidatas novas no topo.
--
-- Esta coluna é o que separa "candidata nova" de "o RH apagou a linha dela":
-- as duas não estão no arquivo, mas só a nova tem `na_planilha_em` vazio. Sem
-- ela, toda linha apagada pelo RH voltaria na volta seguinte do robô.
alter table public.vessel_candidaturas
  add column if not exists na_planilha_em timestamptz;

comment on column public.vessel_candidaturas.na_planilha_em is
  'Quando o robô triagem-tivoli-no-zoho entregou esta candidatura à planilha. '
  'Preenchida e fora do arquivo = o RH apagou a linha; o robô não a devolve.';
