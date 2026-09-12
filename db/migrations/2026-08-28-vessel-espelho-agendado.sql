-- Agenda o robô que espelha a lista de espera da VESSEL BRASIL.
--
-- A cada 15 minutos. Não é caro: quando não há o que fazer, a rodada compara o
-- arquivo com o que ele deveria ser e sai.
--
-- E A COMPARAÇÃO É O TRABALHO. Não basta olhar "tem linha nova": se alguém
-- pedir para sair e a linha for apagada, não existe linha nova — e o CSV
-- continuaria com os dados dela no Zoho. A Política de Privacidade promete
-- apagar em até 7 dias, e isso seria promessa quebrada. Comparando, some
-- linha, muda linha, entra linha: tanto faz, o arquivo acompanha.
--
-- Provado em 28/08/2026: apaguei uma das duas linhas de teste, disparei, e ela
-- sumiu do arquivo no WorkDrive.

select cron.unschedule('vessel-espelhar-lista')
 where exists (select 1 from cron.job where jobname = 'vessel-espelhar-lista');

select cron.schedule(
  'vessel-espelhar-lista',
  '*/15 * * * *',
  $$ select public.disparar_robo(
       'vessel-espelhar-lista', 'vessel-espelhar-lista', 'vessel-espelhar-lista',
       '{"origem":"cron"}'::jsonb, 120000) $$
);

-- O segredo de cron desta função nasce aleatório e nunca aparece em lugar
-- nenhum: quem monta o cabeçalho é a disparar_robo(), lendo de segredos_de_cron.
insert into public.segredos_de_cron (nome, segredo)
select 'vessel-espelhar-lista', encode(extensions.gen_random_bytes(32), 'hex')
 where not exists (select 1 from public.segredos_de_cron where nome = 'vessel-espelhar-lista');
