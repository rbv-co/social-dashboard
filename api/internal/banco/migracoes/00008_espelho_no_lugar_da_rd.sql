-- +goose Up
-- Plano 6: a RD Station está desligada (#350) e sai do worker (tarefa vessel-rd-station, RD_STATION_TOKEN): sem esta
-- migração a tela de saúde cobraria para sempre uma tarefa que não existe mais. No lugar entra a ficha da tarefa do
-- espelho da lista de espera (vessel-espelhar-lista), que atende disparos_pendentes e despacha o workflow
-- espelho-da-vessel.yml: roda todo minuto e só trabalha quando há pedido (e no máximo um despacho a cada 5 min).
--
-- Mesmo molde da 00004: robos_esperados vem do dump do Supabase; num banco sem ela (testes, instalação nova) a
-- migração não faz nada. `on conflict do nothing`: ficha que o dono já ajustou vale mais que o padrão daqui.
-- +goose StatementBegin
do $$
begin
  if to_regclass('robos_esperados') is null then
    return;
  end if;
  insert into robos_esperados (robo, horas_sem_sucesso_ate, critico, porque) values
    ('vessel-espelhar-lista', 2, false, 'Acorda o robô da planilha da Vessel quando há cadastro novo, no máximo a cada 5 min.')
  on conflict (robo) do nothing;
  delete from robos_esperados where robo = 'vessel-rd-station';
end
$$;
-- +goose StatementEnd

-- +goose Down
-- Devolve a ficha da RD e tira a do espelho (a tarefa da RD não volta: o código saiu).
-- +goose StatementBegin
do $$
begin
  if to_regclass('robos_esperados') is null then
    return;
  end if;
  insert into robos_esperados (robo, horas_sem_sucesso_ate, critico, porque) values
    ('vessel-rd-station', 2, false, 'Leva os cadastros da Vessel à RD Station, a cada minuto.')
  on conflict (robo) do nothing;
  delete from robos_esperados where robo = 'vessel-espelhar-lista';
end
$$;
-- +goose StatementEnd
