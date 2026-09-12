-- LIGAR O coletar-dados-hora: cron de hora em hora.
--
-- Aplicar só depois de confirmar manualmente (Task 4, Step 4) que a função
-- responde certo — ligar o cron é decisão, não efeito colateral de deploy.
-- Mesmo espírito de db/migrations/2026-07-30-conteudo-06-cron-hora-h.sql.
--
-- Minuto 5, não em cima da hora: dá folga pra Meta consolidar o minuto
-- anterior antes de perguntar "quanto gastou hoje até agora".
--
-- ⚠️ O PRIMEIRO ARGUMENTO DE disparar_robo NÃO PODE começar com
-- 'coletar-dados': robos_saude junta por PREFIXO
-- (`u.robo like x.robo || '%'`), e 'coletar-dados' já é o robô crítico que
-- renova o token da Meta. Um robô novo com esse prefixo se esconderia atrás
-- do sucesso do outro — o alarme do coletor diário pararia de disparar sem
-- ninguém perceber. Por isso o rótulo aqui é 'meta-hora' — a Edge Function e
-- o segredo continuam se chamando coletar-dados-hora, só o rótulo de robô
-- (1º argumento) muda.
select cron.schedule(
  'coletar-dados-hora',
  '5 * * * *',
  $$ select public.disparar_robo(
       'meta-hora', 'coletar-dados-hora', 'coletar-dados-hora',
       '{}'::jsonb, 60000
     ) $$
);

-- Registra o robô em robos_esperados, senão ele não aparece em robos_saude
-- (a view parte de robos_esperados, left join nas execuções).
insert into public.robos_esperados (robo, horas_sem_sucesso_ate, critico, porque) values
  ('meta-hora', 4, false,
   'Relatório por Hora do Meta Ads. Roda a cada hora; parado = buracos no '
   'acordeão, não afeta o resto do painel.')
on conflict (robo) do update set
  horas_sem_sucesso_ate = excluded.horas_sem_sucesso_ate,
  critico = excluded.critico,
  porque = excluded.porque;

-- Para desligar sem apagar nada:  select cron.unschedule('coletar-dados-hora');
