-- A CONTA ÓRFÃ: desfazer de "o perfil foi criado, mas o e-mail com a senha
-- não saiu".
--
-- A edge `vessel-conta` (ação "criar") cria o perfil primeiro e manda o
-- e-mail com a senha depois — a senha só existe ali, gerada, e vai por
-- e-mail e só (ver a nota no topo de index.ts). Se o envio falhar, a
-- cliente ficaria com perfil cadastrado e nenhuma senha para entrar: uma
-- conta travada, sem jeito de recuperar sozinha (o "esqueci a senha" também
-- manda por e-mail, que é o canal que já provou não funcionar). O jeito mais
-- simples de desempacar é apagar o perfil recém-criado e deixar a cliente
-- tentar de novo o cadastro.
--
-- ⚠️ SÓ APAGA PERFIL RECÉM-CRIADO E SEM NADA: é o desfazer de "o e-mail não
-- saiu". Perfil com sessão, peça ou mais de 10 minutos NÃO é apagado — do
-- contrário esta função viraria um jeito de apagar conta de cliente de
-- verdade, bastando saber o id.
--
-- ⚠️ NÃO APLICADA por este commit. Migrations desta fase entram à mão pelo
-- MCP da Supabase (`apply_migration`), depois de o teste estático passar —
-- ver `restricoes-globais.md`. Quem aplica é o dono.
create or replace function public.vessel_conta_apagar_recem_criada(p_cliente_id uuid)
returns json language plpgsql security definer set search_path to 'public' as $$
begin
  delete from public.vessel_clientes c
   where c.id = p_cliente_id
     and c.criado_em > now() - interval '10 minutes'
     and not exists (select 1 from public.vessel_sessoes s where s.cliente_id = c.id);
  return json_build_object('ok', true);
end;
$$;

-- ⚠️ `revoke from public` NÃO fecha `anon`/`authenticated` (cada papel herda
-- direito próprio) — revogar dos três, um a um, e conceder só a
-- `service_role`, que é quem a edge usa. Mesma trava das seis funções de
-- 2026-09-17-vessel-contas-base.sql.
revoke all on function public.vessel_conta_apagar_recem_criada(uuid) from public, anon, authenticated;
grant execute on function public.vessel_conta_apagar_recem_criada(uuid) to service_role;
