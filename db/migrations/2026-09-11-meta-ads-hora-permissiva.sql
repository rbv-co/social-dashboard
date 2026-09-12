-- CORRIGE campaign_insights_hora: faltava a política PERMISSIVE.
--
-- A migration 2026-09-11-meta-ads-hora-tabela.sql criou só a RESTRICTIVE
-- so_contas_permitidas, copiando o desenho das 19 tabelas antigas
-- (2026-07-31-allowed-accounts-no-banco.sql) sem perceber que aquelas 19 JÁ
-- tinham uma política PERMISSIVE de antes — a RESTRICTIVE só reduz o que uma
-- permissiva já libera; sem NENHUMA permissiva, o Postgres nega tudo. A tela
-- lia 200 + [] pra sempre — indistinguível de "não tem dado ainda" (o mesmo
-- estrago descrito em PADRAO-DA-CENTRAL.md §9).
--
-- Mesmo padrão de gt_problemas_meta (2026-08-17-guardar-o-motivo-da-meta.sql):
-- permissiva por permissão + restritiva por conta, as duas juntas.
create policy campaign_insights_hora_leitura on public.campaign_insights_hora
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
       where p.id = auth.uid()
         and (p.role = 'admin' or p.is_superadmin or p.permissions ? 'meta.hora')
    )
  );

-- ⚠️ Reforço de GRANT (mesmo padrão de
-- 2026-09-11-vessel-cartoes-fila-e-trava.sql): tabela nova no Supabase nasce
-- com INSERT/UPDATE/DELETE para `authenticated` pela concessão padrão.
-- `revoke all` e só depois `grant select` — não uma lista nominal, que
-- envelhece quando o Postgres inventar a próxima permissão.
revoke all on table public.campaign_insights_hora from public, anon, authenticated;
grant  select on table public.campaign_insights_hora to authenticated;
