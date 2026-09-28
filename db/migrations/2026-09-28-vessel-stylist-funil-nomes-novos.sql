-- O FUNIL DO STYLIST CIRCLE GANHA OS NOMES NOVOS (decisão do dono, 28/09/2026).
--
-- Só RENOMEIA — nenhuma etapa nasce, sai ou muda de lugar, e nenhuma stylist
-- muda de etapa (elas apontam por `etapa_id`, que não muda):
--   Identificado    → Stylist levantado
--   Classificação   → Validado
--   Prospectado     → Conversa   (continua a que conta como prospectada)
--   Convidado       → fica igual, entre Conversa e Confirmado (opção C do dono)
--   Confirmou Ida   → Confirmado
--   Esteve Presente → Presença
--   Ativada e Desclassificado → iguais
--
-- Idempotente: cada troca só acontece se a etapa ainda tem o nome antigo. A
-- trilha (`vessel_stylist_etapas_trilha`) ganha uma linha 'renomear' por troca,
-- como a tela "Etapas do funil" faria.
with trocas(antigo, novo) as (values
  ('Identificado', 'Stylist levantado'),
  ('Classificação', 'Validado'),
  ('Prospectado', 'Conversa'),
  ('Confirmou Ida', 'Confirmado'),
  ('Esteve Presente', 'Presença')
), mudou as (
  update public.vessel_stylist_etapas e
     set nome = t.novo, alterado_por = null,
         alterado_por_nome = 'migration 2026-09-28', alterado_em = now()
    from trocas t
   where e.nome = t.antigo and e.ativa
  returning e.id, t.antigo, t.novo
)
insert into public.vessel_stylist_etapas_trilha (etapa_id, acao, antes, depois, por, por_nome)
select id, 'renomear', jsonb_build_object('nome', antigo), jsonb_build_object('nome', novo),
       null, 'migration 2026-09-28'
  from mudou;
