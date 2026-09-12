-- LIGAR O enviar-relatorio-hora: cron de hora em hora.
--
-- Pedido do dono (12/09/2026): "você vai começar a enviar os relatórios
-- horários lá naquele grupo toda vez agora". Aplicar só depois de confirmar
-- manualmente que a função responde certo — ligar o cron é decisão, não
-- efeito colateral de deploy. Mesmo espírito de
-- db/migrations/2026-09-11-meta-ads-hora-cron.sql.
--
-- Minuto 10, não o mesmo minuto de coletar-dados-hora (minuto 5): dá folga
-- pro dado da hora já estar gravado quando esta função ler.
select cron.schedule(
  'enviar-relatorio-hora',
  '10 * * * *',
  $$ select public.disparar_robo(
       'enviar-relatorio-hora', 'enviar-relatorio-hora', 'enviar-relatorio-hora',
       '{}'::jsonb, 30000
     ) $$
);

insert into public.robos_esperados (robo, horas_sem_sucesso_ate, critico, porque) values
  ('enviar-relatorio-hora', 4, false,
   'Manda os relatórios do Relatório por Hora (Meta Ads) no grupo de '
   'WhatsApp via Z-API. Roda a cada hora; parado = grupo para de receber, '
   'não afeta o resto do painel.')
on conflict (robo) do update set
  horas_sem_sucesso_ate = excluded.horas_sem_sucesso_ate,
  critico = excluded.critico,
  porque = excluded.porque;

-- Para desligar sem apagar nada:  select cron.unschedule('enviar-relatorio-hora');
