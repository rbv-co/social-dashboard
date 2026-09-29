-- 2026-09-30-zzz-enviar-mensagem-abandono-cron.sql
-- Agenda o robô de mensagens (1/min). Ele nasce DESLIGADO (ENVIO_MODO não definido): o cron
-- chama, a função responde {ok:true, modo:'desligado'} e não faz nada.
insert into public.segredos_de_cron (nome, segredo)
values ('enviar-mensagem-abandono', encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (nome) do nothing;

select cron.schedule('enviar-mensagem-abandono', '* * * * *', $cron$
  select public.disparar_robo('enviar-mensagem-abandono', 'enviar-mensagem-abandono', 'enviar-mensagem-abandono',
    '{"origem":"cron"}'::jsonb, 55000);
$cron$);

insert into public.robos_esperados (robo, horas_sem_sucesso_ate, critico, porque) values
  ('enviar-mensagem-abandono', 2, false,
   'Manda o WhatsApp de recuperacao a quem esta na Fila de mensagens. Parado, ninguem recebe a mensagem; '
   'desligado (ENVIO_MODO) tambem responde ok.')
on conflict (robo) do update
  set horas_sem_sucesso_ate = excluded.horas_sem_sucesso_ate,
      critico = excluded.critico,
      porque = excluded.porque;
