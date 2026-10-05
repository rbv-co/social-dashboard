-- chatwoot_eventos passa a aceitar 'qualified_lead'.
--
-- O Chatwoot deixou de classificar temperatura (quente/morno/frio) em
-- 05/10/2026: a única leitura da IA que ficou são os eventos de conversão da
-- Meta. O evento de CRM 'lead_quente' foi trocado por 'qualified_lead', que
-- dispara uma vez por conversa quando ela ganha o primeiro QualifiedLead
-- (soube o preço e seguiu avaliando a compra).
--
-- A trava (CHECK) criada em 2026-09-24-chatwoot-eventos.sql só aceitava
-- 'lead_novo' e 'lead_quente' — sem esta migration, a Edge Function
-- receber-webhook-chatwoot aceitaria o evento e o banco recusaria a gravação
-- (a função loga e responde 200, então o evento sumiria calado).
--
-- 'lead_quente' continua aceito: as linhas antigas ficam como histórico, com o
-- significado antigo. O OPR conta só 'qualified_lead'.
alter table public.chatwoot_eventos
  drop constraint if exists chatwoot_eventos_tipo_check;

alter table public.chatwoot_eventos
  add constraint chatwoot_eventos_tipo_check
  check (tipo in ('lead_novo', 'lead_quente', 'qualified_lead'));
