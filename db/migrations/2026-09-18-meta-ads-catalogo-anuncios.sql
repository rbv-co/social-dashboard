-- CATÁLOGO DE ANÚNCIOS — nome, status e link de destino do criativo.
--
-- Pedido do dono (18/09/2026): campanhas "outro" (sem prefixo — AXIOM e
-- afins) precisam ser classificadas em Sales/Leads pelo LINK DE DESTINO do
-- anúncio, não pela campanha — confirmado com dado real que a mesma
-- campanha/conjunto mistura anúncios com destinos diferentes. Este catálogo
-- é o equivalente de `campaigns` (nome/status), um nível abaixo: por
-- ANÚNCIO, não por campanha. Sincronizado pelo `coletar-dados` (roda menos
-- vezes ao dia, nome/link não mudam de hora em hora).
--
-- `categoria` (sales/leads) NÃO é coluna aqui — sempre recalculada por
-- classificarLinkAnuncio(destino_link) em JS (src/ferramentas/meta-ads/
-- relatorio-por-hora.js), nunca guardada: se a regra de classificação mudar
-- (domínio novo, por exemplo), o histórico já gravado se reclassifica
-- sozinho, sem precisar reprocessar nada.
create table public.ads (
  ad_id        text primary key,
  campaign_id  text not null,
  account_id   uuid not null,
  name         text not null default '',
  status       text not null default '',
  destino_link text,
  synced_at    date not null default current_date
);

comment on table public.ads is
  'Catálogo de anúncios (nome, status, link de destino do criativo) — '
  'sincronizado pelo coletar-dados, junto com campaigns. Gasto/clique por '
  'hora fica em ad_insights_hora, à parte.';

alter table public.ads enable row level security;

-- MESMO padrão de public.campaigns: uma PERMISSIVE ampla (authenticated lê
-- geral) + uma RESTRICTIVE que já estreita pra só conta liberada. As duas
-- juntas: só authenticated, só conta que pode_ver_conta() autoriza.
create policy auth_read_ads on public.ads
  for select to authenticated
  using (auth.role() = 'authenticated');

create policy so_contas_permitidas on public.ads
  as restrictive for select to authenticated
  using (public.pode_ver_conta(account_id::text));

revoke all on table public.ads from public, anon, authenticated;
grant  select on table public.ads to authenticated;
