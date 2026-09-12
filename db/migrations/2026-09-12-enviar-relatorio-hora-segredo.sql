-- O SEGREDO DA FUNÇÃO enviar-relatorio-hora.
--
-- Separado do agendamento (próxima migration) de propósito: dá pra ter a
-- função no ar e testável à mão antes de deixá-la disparando sozinha de hora
-- em hora. Mesmo padrão de 2026-09-11-meta-ads-hora-segredo.sql.
--
-- exigirSegredoDeCron() é fail-closed: sem esta linha, a função nega tudo
-- com 401 — o que é seguro, mas silencioso se o cron for ligado antes dela.
insert into public.segredos_de_cron (nome, segredo)
values ('enviar-relatorio-hora', encode(gen_random_bytes(32), 'hex'))
on conflict (nome) do nothing;
