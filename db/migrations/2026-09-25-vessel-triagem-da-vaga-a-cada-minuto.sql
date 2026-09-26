-- A TRIAGEM DA VAGA DO TIVOLI, A CADA MINUTO (25/09/2026).
--
-- Pedido do dono: "robô de minuto em minuto sempre". Quem faz é a edge
-- `vessel-triagem-da-vaga`. Ela nasceu no GitHub Actions (de 2 em 2 horas) e
-- mudou para cá no mesmo dia: o Actions não dispara abaixo de 5 minutos e,
-- neste repositório, atrasa horas.
--
-- A rodada comum custa UMA consulta ao banco (tem candidata que ainda não foi
-- para a planilha?). Sem nenhuma, a edge para ali e não toca no Zoho.

insert into public.segredos_de_cron (nome, segredo)
values ('vessel-triagem-da-vaga', encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (nome) do nothing;

select cron.schedule('vessel-triagem-da-vaga', '* * * * *', $cron$
  select public.disparar_robo('vessel-triagem-da-vaga', 'vessel-triagem-da-vaga',
    'vessel-triagem-da-vaga', '{"origem":"cron"}'::jsonb, 55000);
$cron$);

-- Teto de 1 hora: 60 rodadas seguidas falhando. Não crítico — parado, a
-- candidata continua gravada no banco e entra na planilha quando ele voltar.
insert into public.robos_esperados (robo, horas_sem_sucesso_ate, critico, porque) values
  ('vessel-triagem-da-vaga', 1, false,
   'Leva as candidaturas da página /vaga-tivoli para a planilha do RH '
   '(Triagem Tivoli Vendedora.xlsx) e os currículos para o Zoho. Roda a cada minuto.')
on conflict (robo) do update
  set horas_sem_sucesso_ate = excluded.horas_sem_sucesso_ate,
      critico = excluded.critico,
      porque = excluded.porque;
