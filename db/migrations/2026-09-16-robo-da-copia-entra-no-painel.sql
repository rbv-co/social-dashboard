-- O ROBÔ DA CÓPIA DE SEGURANÇA ENTRA NO PAINEL DE SAÚDE.
--
-- ⚠️ BACKUP QUE PARA EM SILÊNCIO É PIOR QUE BACKUP NENHUM: sem backup você
-- sabe que não está coberto; com um que parou há três semanas, você acha que
-- está. Por isso ele entra como CRÍTICO — hoje é a única cópia que existe do
-- banco inteiro, porque a organização está no plano Free da Supabase e lá não
-- há backup automático.
--
-- 30 horas de folga: a cópia roda uma vez por dia, e uma rodada perdida por
-- atraso do GitHub Actions não é motivo de alarme. Duas seguidas são.

insert into public.robos_esperados (robo, horas_sem_sucesso_ate, critico, porque)
values (
  'guardar-copia-do-banco', 30, true,
  'A UNICA copia de seguranca do banco. A organizacao esta no plano Free da '
  'Supabase, onde nao ha backup automatico — a documentacao deles manda o Free '
  'exportar por conta propria. Se este robo parar, nao existe de onde voltar.')
on conflict (robo) do update
   set horas_sem_sucesso_ate = excluded.horas_sem_sucesso_ate,
       critico = excluded.critico,
       porque  = excluded.porque;
