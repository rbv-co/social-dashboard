-- O SEGREDO DA FUNÇÃO coletar-dados-hora.
--
-- Separado do agendamento (migration da Task 5) de propósito: dá pra ter a
-- função no ar e testável à mão (Task 4) antes de deixá-la disparando
-- sozinha de hora em hora. Mesmo padrão de
-- db/migrations/2026-07-30-conteudo-05-segredo-hora-h.sql.
--
-- exigirSegredoDeCron() é fail-closed: sem esta linha, a função nega tudo
-- com 401 — o que é seguro, mas silencioso se o cron for ligado antes dela.
insert into public.segredos_de_cron (nome, segredo)
values ('coletar-dados-hora', encode(gen_random_bytes(32), 'hex'))
on conflict (nome) do nothing;
