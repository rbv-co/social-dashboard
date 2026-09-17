-- Marca de onde veio cada leitura de followers_leituras (pedido do dono,
-- 17/09/2026, depois de achar o motivo do "23h" ter mostrado +16 seguidores
-- diferente do que a mensagem já tinha mandado pro grupo).
--
-- Causa raiz: duas rotinas gravam nesta tabela — `coletar-dados-hora`
-- (hora em hora, roda no minuto 5) e `coletar-dados-2359` (uma vez por
-- dia, às 23:59 em SP). As duas leituras da hora 23 caem no MESMO balde
-- (dia, hora) que `deltaDeSeguidoresPorHora` usa; o código ficava com a
-- mais recente, então a leitura das 23:59 (do robô diário) sobrescrevia a
-- das 23:05 (do robô horário) DEPOIS que a mensagem das 23h já tinha sido
-- mandada usando o valor de antes — o total do dia ficava certo, mas a
-- hora 23 sozinha virava outra coisa se alguém consultasse depois.
--
-- Com a origem marcada, `deltaDeSeguidoresPorHora` passa a preferir sempre
-- a leitura 'hora' do balde, não importa se veio depois — só cai pra
-- qualquer leitura (ex. 'diario') quando não existe nenhuma 'hora' nesse
-- balde. Linhas antigas (antes desta coluna existir) ficam com `origem`
-- nulo — tratado como não-'hora' pelo código, igual antes.
alter table public.followers_leituras
  add column if not exists origem text;

comment on column public.followers_leituras.origem is
  'De onde veio a leitura: ''hora'' (coletar-dados-hora, 24x/dia) ou '
  '''diario'' (coletar-dados, 4x/dia). Nulo = leitura antiga, de antes '
  'desta coluna existir. deltaDeSeguidoresPorHora prefere sempre ''hora'' '
  'no mesmo balde de (dia,hora), pra uma leitura fora de hora não '
  'sobrescrever a leitura horária depois que a mensagem já foi mandada.';
