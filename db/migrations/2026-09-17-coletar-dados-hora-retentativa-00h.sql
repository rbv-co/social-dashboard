-- Repescagem da hora 0 do coletar-dados-hora.
--
-- Achado com o dono, 17/09/2026: TODA noite, sem exceção (conferido 14, 15,
-- 16 e 17/09), a rodada das 00:05 (SP) falha pras 6 contas com
-- {"ok":false,"campanhas":0} — não é bug de código, é hora errada: a Meta
-- ainda não processou NENHUM gasto do dia que acabou de começar 5 minutos
-- atrás (`time_range:{since:dia,until:dia}` com `dia` recém-virado), então
-- `items` vem vazio e a função devolve erro de propósito (é o guard-rail
-- de "nada foi coletado", ver coletar-dados-hora/index.ts).
--
-- Efeito: a hora 0 sempre falta em campaign_insights_hora, e qualquer soma
-- "dia inteiro" feita hora a hora (as mensagens de WhatsApp) sai menor que
-- o total de verdade — foi assim que o dono notou (23h mostrava
-- R$451,80 de seguidores; o OPR, que pega o dia inteiro de uma vez direto
-- da Meta via `coletar-dados`, mostrava R$494,11 — a diferença é
-- exatamente o gasto da hora 0 que nunca foi coletado).
--
-- Fix: uma SEGUNDA chamada 25 minutos depois (00:30 SP), ainda dentro da
-- janela da hora 0 (`horaBR()` só vira 1 depois da 01:00) — dá tempo da
-- Meta ter processado alguma coisa do dia novo. Os três gravadores
-- (campaign_insights_hora, followers_leituras, perfil_visitas_hora) usam
-- upsert/priorização por (dia,hora) — uma segunda rodada na mesma hora
-- nunca duplica nem corrompe, só atualiza pra um valor melhor (ou mantém
-- vazio, se a Meta ainda não tiver nada — sem piorar o que já existe).
select cron.schedule(
  'coletar-dados-hora-retentativa-00h',
  '30 3 * * *',
  $$ select public.disparar_robo(
       'meta-hora-retentativa-00h', 'coletar-dados-hora', 'coletar-dados-hora',
       '{}'::jsonb, 60000
     ) $$
);

insert into public.robos_esperados (robo, horas_sem_sucesso_ate, critico, porque) values
  ('meta-hora-retentativa-00h', 24, false,
   'Repescagem da hora 0 do Relatório por Hora (Meta Ads) — a rodada '
   'normal das 00:05 quase sempre chega antes da Meta processar o dia '
   'novo. Parado = a hora 0 volta a faltar todo dia; não afeta o resto '
   'do painel.')
on conflict (robo) do update set
  horas_sem_sucesso_ate = excluded.horas_sem_sucesso_ate,
  critico = excluded.critico,
  porque = excluded.porque;

-- Para desligar sem apagar nada:
--   select cron.unschedule('coletar-dados-hora-retentativa-00h');
