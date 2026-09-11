-- LIGAR O coletar-dados-hora: cron de hora em hora.
--
-- Aplicar só depois de confirmar manualmente (Task 4, Step 4) que a função
-- responde certo — ligar o cron é decisão, não efeito colateral de deploy.
-- Mesmo espírito de db/migrations/2026-07-30-conteudo-06-cron-hora-h.sql.
--
-- Minuto 5, não em cima da hora: dá folga pra Meta consolidar o minuto
-- anterior antes de perguntar "quanto gastou hoje até agora". `disparar_robo`
-- já registra em robos_execucoes, então falha aparece em robos_saude como os
-- outros robôs.
select cron.schedule(
  'coletar-dados-hora',
  '5 * * * *',
  $$ select public.disparar_robo(
       'coletar-dados-hora', 'coletar-dados-hora', 'coletar-dados-hora',
       '{}'::jsonb, 60000
     ) $$
);

-- Para desligar sem apagar nada:  select cron.unschedule('coletar-dados-hora');
