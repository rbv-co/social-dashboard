-- campaign_adsets nasceu só com a política PERMISSIVA (campaign_adsets_leitura,
-- using (true)), sem a RESTRITIVA por conta que toda tabela irmã carrega
-- (campaigns, campaign_insights, account_insights, daily_snapshots). Nesse
-- projeto quem realmente restringe o acesso é a política RESTRICTIVE — ela
-- entra em AND com todo o resto, enquanto políticas PERMISSIVE só entram em OR
-- entre si. Sem essa política, qualquer autenticado lia o adset de QUALQUER
-- conta. Espelha exatamente a política so_contas_permitidas das quatro
-- tabelas irmãs, só trocando o nome da tabela. NÃO mexe na permissiva
-- existente — ela é a outra metade do par, igual nas irmãs.
create policy so_contas_permitidas on public.campaign_adsets
  as restrictive
  for select to authenticated using (pode_ver_conta((account_id)::text));
