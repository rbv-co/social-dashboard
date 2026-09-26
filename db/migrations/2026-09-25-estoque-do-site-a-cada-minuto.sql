-- ESTOQUE DO SITE = LOJA DO IGUATEMI − 1, A CADA MINUTO.
--
-- Pedido do dono em 25/09/2026: "acabou na loja, esgota no site, o estoque no
-- shopify precisa ser sempre -1 por conta da peça mostruário" — e "a cada
-- minuto". A venda de balcão baixava o Bling e não baixava o Shopify; no dia, 55
-- das 81 variantes do site estavam erradas.
--
-- Quem faz: a edge `estoque-do-site` (regra em _shared/estoque-do-site.js).
-- Ela nasceu como robô local (launchd) no mesmo dia e mudou para cá porque o Mac
-- desligado parava o site.

-- ── o estado da edge ────────────────────────────────────────────────────────
-- Token do Shopify (vence em 24h) e mapa SKU→id do Bling (catálogo leva ~30s).
-- ⚠️ RLS LIGADA E ZERO POLICIES: guarda um token de escrita no Shopify. Só o
-- service role lê — mesmo desenho de `segredos_de_cron`.
create table if not exists public.estoque_do_site_estado (
  chave text primary key,
  valor jsonb not null,
  atualizado_em timestamptz not null default now()
);
alter table public.estoque_do_site_estado enable row level security;
revoke all on public.estoque_do_site_estado from anon, authenticated;

comment on table public.estoque_do_site_estado is
  'Estado da edge estoque-do-site: token do Shopify e mapa SKU->id do Bling. '
  'RLS sem policies: so o service role le.';

-- ── o segredo e o horário ───────────────────────────────────────────────────
insert into public.segredos_de_cron (nome, segredo)
values ('estoque-do-site', encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (nome) do nothing;

-- A cada minuto. A rodada leva poucos segundos (3 chamadas ao Bling, 1 ao
-- Shopify quando nada mudou), longe do limite de 3 req/s do Bling.
select cron.schedule('estoque-do-site', '* * * * *', $cron$
  select public.disparar_robo('estoque-do-site', 'estoque-do-site', 'estoque-do-site',
    '{"origem":"cron"}'::jsonb, 55000);
$cron$);

-- ── e o vigia olha para ele ─────────────────────────────────────────────────
-- Teto de 1 hora: são 60 rodadas seguidas falhando. Crítico, porque parado o site
-- volta a vender peça que a loja já vendeu.
insert into public.robos_esperados (robo, horas_sem_sucesso_ate, critico, porque) values
  ('estoque-do-site', 1, true,
   'Mantem o estoque do site (Shopify) = loja Iguatemi (Bling) - 1 de mostruario. '
   'Roda a cada minuto. Parado, o site vende peca que a loja ja vendeu.')
on conflict (robo) do update
  set horas_sem_sucesso_ate = excluded.horas_sem_sucesso_ate,
      critico = excluded.critico,
      porque = excluded.porque;
