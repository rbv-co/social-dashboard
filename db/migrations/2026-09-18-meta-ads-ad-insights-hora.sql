-- GASTO E CLIQUES NO LINK, por ANÚNCIO, por hora.
--
-- Mesmo desenho de campaign_insights_hora: grava o acumulado do dia, o robô
-- (coletar-dados-hora) já calcula o delta, a tela NUNCA recalcula. Só cobre
-- anúncios de campanha "outro" (tipoDaCampanha) com link classificável —
-- ver classificarLinkAnuncio() e a spec de 18/09/2026.
create table public.ad_insights_hora (
  ad_id              text        not null,
  campaign_id        text        not null,
  account_id         uuid        not null,
  dia                date        not null,
  hora               smallint    not null check (hora between 0 and 23),
  gasto_acumulado    numeric     not null default 0,
  gasto_hora         numeric     not null default 0,
  cliques_acumulados integer     not null default 0,
  cliques_hora       integer     not null default 0,
  coletado_em        timestamptz not null default now(),
  unique (ad_id, account_id, dia, hora)
);

comment on table public.ad_insights_hora is
  'Gasto e cliques no link (link_click) por ANÚNCIO, por hora, com delta '
  'já calculado. Só cobre anúncios de campanhas "outro" (tipoDaCampanha) '
  '— ver classificarLinkAnuncio() pra Sales/Leads. Alimentada pela Edge '
  'Function coletar-dados-hora.';

alter table public.ad_insights_hora enable row level security;

-- As DUAS políticas NA MESMA migration — campaign_insights_hora e
-- perfil_visitas_hora precisaram de uma segunda migration corretiva cada
-- (11/09 e 12/09/2026) porque a RESTRICTIVE sozinha nega tudo sem NENHUMA
-- permissiva. Não repetir o erro.
create policy so_contas_permitidas on public.ad_insights_hora
  as restrictive for select to authenticated
  using (public.pode_ver_conta(account_id::text));

create policy ad_insights_hora_leitura on public.ad_insights_hora
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
       where p.id = auth.uid()
         and (p.role = 'admin' or p.is_superadmin or p.permissions ? 'meta.hora')
    )
  );

revoke all on table public.ad_insights_hora from public, anon, authenticated;
grant  select on table public.ad_insights_hora to authenticated;
