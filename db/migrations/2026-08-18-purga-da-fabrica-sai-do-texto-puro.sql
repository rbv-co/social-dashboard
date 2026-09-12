-- B6 · O TOKEN DO `fabrica-purga` SAI DE DENTRO DO COMANDO DO CRON.
--
-- Era o ÚNICO dos 14 crons com o segredo escrito em texto puro dentro de
-- `cron.job.command` — exatamente o que a tabela `segredos_de_cron` existe para
-- evitar. Os outros 8 robôs já usavam `disparar_robo(...)`, que busca o segredo
-- no cofre E registra a execução em `robos_execucoes`.
--
-- GANHO DE BRINDE: como não passava por `disparar_robo`, a purga não deixava
-- rastro nenhum. "Não rodou" e "rodou e ninguém viu" eram indistinguíveis, e ela
-- não aparecia na Saúde dos Robôs. Agora aparece.
--
-- ⚠️ ESTE ARQUIVO É DE UMA VEZ SÓ, e é honesto sobre isso: ele copia o token de
--    onde ele estava (o próprio comando do cron). Depois de rodar, o comando não
--    tem mais token, e o `where` abaixo deixa de casar — reaplicar não faz nada,
--    em vez de gravar nulo por cima do cofre. Foi de propósito.
--
-- ⚠️ O TOKEN NÃO FOI TROCADO, por decisão do dono em 18/08. Ele apareceu na tela
--    numa sessão de trabalho neste mesmo dia, então continua conhecido. Trocar
--    exige colar o valor novo em `FABRICA_PURGA_SECRET`, no painel do Supabase —
--    coisa que só o dono tem privilégio de fazer. Risco aceito, registrado aqui e
--    no topo de `docs/pendencias.md` para não sumir.

insert into public.segredos_de_cron (nome, segredo)
select 'fabrica-purga', (regexp_match(command, 'Bearer ([0-9a-f]{64})'))[1]
  from cron.job
 where jobname = 'fabrica-purga-diaria'
   and command ~ 'Bearer [0-9a-f]{64}'
on conflict (nome) do update set segredo = excluded.segredo;

-- Mesmo nome de job = o pg_cron substitui, não duplica. Mesmo horário (04h17).
select cron.schedule(
  'fabrica-purga-diaria',
  '17 4 * * *',
  $cmd$select public.disparar_robo('fabrica-purga','fabrica-purga','fabrica-purga','{"origem":"cron"}'::jsonb, 120000)$cmd$
);
