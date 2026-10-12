-- RD Station DESLIGADA (12/10/2026, plano 09 da revisão pós-Core): nenhum dado de cadastro vai mais para a RD.
-- Já aplicado em produção à mão em 12/10 (backup do estado anterior: /root/backups/revisao-core/20261012-09-supabase-rd-station.json).
-- Este arquivo existe para que reaplicar as migrações de 28/09 NÃO religue o envio: rode-o sempre depois delas.
-- Mantidos (só desligados): vessel_rd_envios, vessel_rd_payload, vessel_rd_enviar e o segredo 'rd-station-token-publico'.
-- A API em Go NÃO porta o robô vessel-rd-station (combinado com a sessão Supabase-Go-e-Postgress).
-- Idempotente.
do $$
begin
  perform cron.unschedule('vessel-rd-station')
    where exists (select 1 from cron.job where jobname = 'vessel-rd-station');
end $$;

alter table public.vessel_origens disable trigger vessel_rd_na_fila;
