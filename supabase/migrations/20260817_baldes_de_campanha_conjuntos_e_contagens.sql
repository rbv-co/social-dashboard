-- O sinal que a META AFIRMA sobre cada conjunto. É o que decide o balde da
-- campanha na seção 02 do painel de Redes Sociais. destination_type é NULO DE
-- VERDADE em campanha de site — nulo aqui é informação, não falha de coleta.
create table if not exists public.campaign_adsets (
  adset_id text primary key,
  campaign_id text not null,
  account_id uuid not null references public.accounts(id) on delete cascade,
  destination_type text,
  optimization_goal text,
  synced_at date not null default current_date
);
create index if not exists campaign_adsets_campanha_idx on public.campaign_adsets (campaign_id);
create index if not exists campaign_adsets_conta_idx on public.campaign_adsets (account_id);

alter table public.campaign_adsets enable row level security;

-- Mesma porta das outras tabelas de leitura do painel: quem está logado lê.
drop policy if exists campaign_adsets_leitura on public.campaign_adsets;
create policy campaign_adsets_leitura on public.campaign_adsets
  for select to authenticated using (true);

-- As quatro contagens vêm do `actions` que o coletor JÁ recebe da Meta — não é
-- chamada nova. Sem default: dia antigo fica NULO, e nulo vira "—" na tela.
-- Zero mentiria dizendo "custou zero" quando o certo é "ainda não sei".
alter table public.campaign_insights add column if not exists conversas integer;
alter table public.campaign_insights add column if not exists cadastros integer;
alter table public.campaign_insights add column if not exists compras integer;
alter table public.campaign_insights add column if not exists visitas integer;
