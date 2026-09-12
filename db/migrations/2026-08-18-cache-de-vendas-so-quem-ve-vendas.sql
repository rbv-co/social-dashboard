-- B9 · AS ESCRITAS SOLTAS: FECHAR O CACHE DE VENDAS.
--
-- O item B9 acusava TRÊS tabelas. Medido em 18/08/2026, e só DUAS estavam
-- abertas — `campaign_filters` já estava protegida nas duas pontas pela política
-- RESTRITIVA `so_contas_permitidas` (a de 31/07). Política restritiva soma com
-- "E", não com "OU": foi por isso que a leitura E a escrita dela já eram
-- barradas. Provado antes de mexer, com `rollback`, simulando um logado.
--
-- O QUE ESTAVA ABERTO, e este arquivo fecha: `bling_vendedores` e
-- `bling_pedido_vendedor`. Provado do mesmo jeito: uma identidade logada **sem
-- ficha nenhuma** (`sub` que não existe em `profiles`) gravou nas duas.
--
-- POR QUE NÃO FECHAR PARA TODO MUNDO NO NAVEGADOR: as duas são cache com
-- auto-cura, preenchido pelo NAVEGADOR quando alguém abre a Gestão à Vista ou a
-- Análise de Vendas. Fechar só para robô quebraria a auto-cura e passaria a
-- depender de um robô que não existe. Decisão do dono em 18/08: "quem pode ver
-- vendas".
--
-- A LEITURA NÃO MUDA. As duas são cache global (vendedor e pedido), não têm
-- recorte por conta, e mexer nisso seria alargar o item sem pedido.

-- Segue o molde de `pode_aprovar_frota()`: STABLE + SECURITY DEFINER, lendo a
-- própria ficha. Superadmin e admin entram sempre — é a regra dos dois modelos de
-- permissão que este projeto usa.
create or replace function public.pode_ver_vendas()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(
    (select p.role = 'admin' or p.is_superadmin or 'sales' = any(p.features)
       from public.profiles p where p.id = auth.uid()),
    false);
$function$;

comment on function public.pode_ver_vendas() is
  'Quem pode mexer no cache de vendas: admin, superadmin ou a chave sales.';

revoke execute on function public.pode_ver_vendas() from public, anon;
grant  execute on function public.pode_ver_vendas() to authenticated;

-- ── bling_vendedores ────────────────────────────────────────────────────────
drop policy if exists "authenticated can upsert vendedores" on public.bling_vendedores;
drop policy if exists "authenticated can update vendedores" on public.bling_vendedores;

create policy "quem ve vendas grava vendedores" on public.bling_vendedores
  for insert to authenticated
  with check (public.pode_ver_vendas());

create policy "quem ve vendas atualiza vendedores" on public.bling_vendedores
  for update to authenticated
  using (public.pode_ver_vendas())
  with check (public.pode_ver_vendas());

-- ── bling_pedido_vendedor ───────────────────────────────────────────────────
drop policy if exists "authenticated can upsert pedido_vendedor" on public.bling_pedido_vendedor;
drop policy if exists "authenticated can update pedido_vendedor" on public.bling_pedido_vendedor;

create policy "quem ve vendas grava pedido_vendedor" on public.bling_pedido_vendedor
  for insert to authenticated
  with check (public.pode_ver_vendas());

create policy "quem ve vendas atualiza pedido_vendedor" on public.bling_pedido_vendedor
  for update to authenticated
  using (public.pode_ver_vendas())
  with check (public.pode_ver_vendas());
