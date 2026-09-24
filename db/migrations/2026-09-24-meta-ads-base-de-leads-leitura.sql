-- A CENTRAL PASSA A LER, PARA "META ADS › BASE DE LEADS", TRÊS EVENTOS QUE JÁ
-- EXISTIAM CADA UM NO SEU CANTO — sem tabela nova, sem robô novo, sem mexer
-- em nenhum captador (tema Shopify, pop-up "Universo Vessel", landing pages
-- de atendimento): checkout_iniciado (carrinho_eventos), cadastro no pop-up
-- (vessel_lista_espera) e pedido de atendimento/visita (vessel_atendimentos).
--
-- ⚠️ TUDO ADITIVO. Nenhuma política existente é removida ou trocada — cada
-- tabela abaixo GANHA uma política de SELECT a mais, que passa a valer em OU
-- com a que já tinha (quem já lia continua lendo do mesmo jeito). A única
-- exceção é vessel_lista_espera, que tinha ZERO política (RLS ligada, nada
-- lia, nem logado) — ganha a primeira.
--
-- Permissão nova: 'meta.leads' (RECURSOS em catalogo-de-ferramentas.js) — TIME
-- de tráfego pago não precisa ganhar 'atendimentos' nem 'carrinho' só para
-- abrir esta tela, e quem já tem essas duas não ganha nada a mais aqui.

create or replace function public.is_vessel_leads()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select 'meta.leads' = any(p.features) or p.is_superadmin
       from public.profiles p where p.id = auth.uid()),
    false);
$$;

-- ⚠️ MESMO ACHADO DE is_vessel_atendimentos(): `from public` sozinho não fecha
-- anon/authenticated — os dois recebem execute por privilégio padrão do
-- schema, que é concessão separada.
revoke all on function public.is_vessel_leads() from public, anon, authenticated;
grant execute on function public.is_vessel_leads() to authenticated;

comment on function public.is_vessel_leads() is
  'Quem pode LER "Meta Ads › Base de Leads" na Central: tem "meta.leads" em '
  'features[] ou é superadmin. A string "meta.leads" é a MESMA de RECURSOS no '
  'front — renomear num lugar só tira o acesso no outro, em silêncio.';

-- ── checkout iniciado (Shopify) ──────────────────────────────────────────────
drop policy if exists carrinho_eventos_leitura_meta_leads on public.carrinho_eventos;
create policy carrinho_eventos_leitura_meta_leads
  on public.carrinho_eventos for select
  to authenticated
  using (public.is_vessel_leads());

-- ── pop-up "Entre para o Universo Vessel" + pedido de atendimento/visita ────
-- vessel_origens entra aqui: é onde mora a atribuição (utm/fbc/fbp) do pedido
-- de atendimento — hoje nenhuma tela lia esta tabela.
do $$
declare t text;
begin
  foreach t in array array['vessel_lista_espera', 'vessel_atendimentos',
                           'vessel_pessoas', 'vessel_origens']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_leitura_meta_leads', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_vessel_leads())',
      t || '_leitura_meta_leads', t);
  end loop;
end $$;
