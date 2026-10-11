-- +goose Up
-- Fichas de robos_esperados para as tarefas do worker que nunca tiveram uma (a tela "saúde dos robôs" parte
-- desta tabela: robô sem ficha não é cobrado e, se parar, nada avisa) e adeus à ficha do estoque-do-site
-- (o Core é o único escritor do estoque desde 2026-10-08; a ficha crítica ficaria vermelha para sempre).
--
-- robos_esperados vem do dump do Supabase (DDL em db/migrations/2026-07-31-saude-dos-robos.sql): num banco
-- sem ela (testes, instalação nova) a migration não faz nada, e por isso não cria a tabela. `on conflict do
-- nothing`: ficha que o dono já ajustou no banco restaurado vale mais que o padrão daqui.
-- horas_sem_sucesso_ate: a view robos_saude marca ATRASADO passado esse tempo sem UM sucesso; folgado de propósito.
-- +goose StatementBegin
do $$
begin
  if to_regclass('robos_esperados') is null then
    return;
  end if;
  insert into robos_esperados (robo, horas_sem_sucesso_ate, critico, porque) values
    ('enviar-push-frota', 80, false, 'Push do checklist da frota, dias úteis 07h30 (sexta→segunda = 72 h).'),
    ('fabrica-purga', 30, false, 'Apaga do disco os criativos das campanhas fechadas da Fábrica, 1x por dia.'),
    ('vessel-rd-station', 2, false, 'Leva os cadastros da Vessel à RD Station, a cada minuto.'),
    ('abandono-de-checkout', 2, false, 'Move checkouts abandonados para a Fila de mensagens, a cada minuto.'),
    ('conferir-robos', 1, false, 'Fecha linhas sem conferência e apaga as de 60+ dias, de 5 em 5 min.'),
    ('faxina-da-api', 30, false, 'Sessões vencidas, webhooks (30 d) e livro de envios (45 d), 1x por dia.')
  on conflict (robo) do nothing;
  delete from robos_esperados where robo = 'estoque-do-site';
end
$$;
-- +goose StatementEnd

-- +goose Down
-- Apaga exatamente as seis fichas do Up. A do estoque-do-site não volta (o Core é o único escritor).
-- +goose StatementBegin
do $$
begin
  if to_regclass('robos_esperados') is null then
    return;
  end if;
  delete from robos_esperados where robo in ('enviar-push-frota', 'fabrica-purga', 'vessel-rd-station',
    'abandono-de-checkout', 'conferir-robos', 'faxina-da-api');
end
$$;
-- +goose StatementEnd
