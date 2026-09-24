-- DE QUAL LEAD VEIO ESTE PEDIDO (23/09/2026)
--
-- Quem se cadastra na LP é LEAD (`vessel_lista_espera`), e não pessoa da base
-- (`vessel_pessoas`) — por isso `pessoa_id` nunca respondeu "quantos leads
-- viraram venda". E o Bling também não responde: medido hoje, dos 130 pedidos
-- desde 28/08 nenhum saiu na ficha que o robô criou para o lead. A loja cria
-- outra ficha, com CPF.
--
-- `coletor/trazer-pedidos-do-bling.mjs` passa a preencher estas duas colunas,
-- pela regra de `coletor/lib/lead-do-pedido.mjs` (ficha → e-mail → telefone,
-- e só pedido do dia do cadastro em diante). A planilha lê daqui.

alter table public.vessel_pedidos
  add column if not exists lead_id bigint
    references public.vessel_lista_espera(id) on delete set null,
  add column if not exists casou_lead_por text;

alter table public.vessel_pedidos
  drop constraint if exists vessel_pedidos_casou_lead_por_valido;
alter table public.vessel_pedidos
  add constraint vessel_pedidos_casou_lead_por_valido check (
    casou_lead_por is null or casou_lead_por in ('ficha', 'email', 'telefone'));

create index if not exists vessel_pedidos_lead_idx
  on public.vessel_pedidos (lead_id) where lead_id is not null;

comment on column public.vessel_pedidos.lead_id is
  'O cadastro da LP (vessel_lista_espera) de quem fez este pedido, se houver. '
  'Só pedido do dia do cadastro em diante. Preenchido por trazer-pedidos-do-bling.mjs.';
comment on column public.vessel_pedidos.casou_lead_por is
  'Como o pedido foi ligado ao lead: ficha (a do próprio lead no Bling), email ou telefone.';
