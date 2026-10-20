-- +goose Up
-- Plano 07 (INTEGRACAO-CORE-2026-10): o robô `vessel-contatos-no-bling` (coletor/, VPS, cron de 1 min) leva cada linha da lista de espera
-- ao Bling como contato (era a edge `vessel-espelhar-lista`, congelada). Ficha na tela de saúde: dá um batimento a cada 30 min mesmo
-- ocioso, então 2 h sem sucesso é parado de verdade. Não é crítico: o cadastro da pessoa nunca espera por ele.
-- Mesmo molde da 00008: num banco sem a tabela (testes, instalação nova) não faz nada; `on conflict do nothing` preserva ficha ajustada.
-- +goose StatementBegin
do $$
begin
  if to_regclass('robos_esperados') is null then
    return;
  end if;
  insert into robos_esperados (robo, horas_sem_sucesso_ate, critico, porque) values
    ('vessel-contatos-no-bling', 2, false, 'Cria no Bling o contato de cada pessoa que entra na lista de espera (e do pop-up da loja), pelo proxy do Core. Roda a cada minuto; parado, a pessoa fica sem bling_id (o cadastro em si não se perde).')
  on conflict (robo) do nothing;
end
$$;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
do $$
begin
  if to_regclass('robos_esperados') is null then
    return;
  end if;
  delete from robos_esperados where robo = 'vessel-contatos-no-bling';
end
$$;
-- +goose StatementEnd
