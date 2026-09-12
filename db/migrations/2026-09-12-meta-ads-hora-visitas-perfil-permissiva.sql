-- CORRIGE perfil_visitas_hora: faltava a política PERMISSIVE.
--
-- MESMO DEFEITO já documentado em 2026-09-11-meta-ads-hora-permissiva.sql
-- (campaign_insights_hora): a migration que criou a tabela
-- (2026-09-12-meta-ads-hora-visitas-perfil-da-conta.sql) copiou só a
-- RESTRICTIVE so_contas_permitidas — sem NENHUMA permissiva, o Postgres nega
-- tudo. A tela lia 200 + [] pra sempre (mesmo estrago de PADRAO-DA-CENTRAL.md
-- §9) — foi assim que a "Visitas ao perfil da conta" sumiu da mensagem/tela
-- mesmo com dado gravado no banco (conferido: hora 13 tinha visitas_hora=129
-- pra Vessel, a tela mostrava nada).
create policy perfil_visitas_hora_leitura on public.perfil_visitas_hora
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
       where p.id = auth.uid()
         and (p.role = 'admin' or p.is_superadmin or p.permissions ? 'meta.hora')
    )
  );

-- Mesmo reforço de GRANT do fix anterior: tabela nova nasce com
-- INSERT/UPDATE/DELETE pra authenticated/anon pela concessão padrão.
revoke all on table public.perfil_visitas_hora from public, anon, authenticated;
grant  select on table public.perfil_visitas_hora to authenticated;
