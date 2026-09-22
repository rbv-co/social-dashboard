-- 054 — "DESATIVADO" PASSA A DESATIVAR DE VERDADE (21/09/2026)
--
-- A tela de Administração chama `profiles.disabled = true` de
-- **"Desativado: a conta existe mas não entra"** (src/compartilhado/estados-da-pessoa.js).
--
-- ⚠️ MEDIDO EM 21/09/2026, E ERA MENTIRA. Ao desligar o Thiago Siqueira eu
-- marquei a conta como desativada e fui conferir entrando no papel dele:
--
--     set local role authenticated;
--     set local request.jwt.claims = '{"sub":"<o id dele>","role":"authenticated"}';
--     select is_frota_admin(), (select count(*) from frota_veiculos);
--     -- → true, 14
--
-- Ele PASSAVA no portão e enxergava os 14 carros. A busca mostrou o porquê:
--   * NENHUMA das políticas de segurança olhava para a coluna (contado: zero);
--   * as 14 funções de permissão (`is_*_admin`, `pode_*`) liam `profiles` e
--     nunca perguntavam por ela;
--   * `src/guarda-de-rotas.js` diz no próprio comentário que a guarda de telas
--     é "só aparência" e que quem garante o acesso é o RLS.
--
-- O que fechava de verdade era esvaziar `features`/`permissions` à mão. Ou
-- seja: a marca que a tela mostra não tinha efeito nenhum, e quem confiasse
-- nela deixaria a porta aberta achando que tinha fechado.
--
-- ESTA MIGRATION FECHA OS DOIS CAMINHOS:
--
--   1. `conta_ativa()` — a pergunta, num lugar só;
--   2. as 14 funções de permissão passam a começar por ela;
--   3. a política de leitura de `profiles` também, que é o que cobre as **46
--      políticas** que consultam `profiles` direto, sem passar por função
--      nenhuma. Sem este item, fechar as funções deixaria 46 portas abertas.
--
-- IMPACTO MEDIDO ANTES DE APLICAR: exatamente **uma** conta está desativada
-- hoje (o Thiago, desligado). Ninguém mais perde nada.

/* A PERGUNTA, num lugar só.
 *
 * SECURITY DEFINER não é enfeite aqui: esta função é usada DENTRO da política
 * de `profiles`, e uma política que consultasse a própria tabela entraria em
 * recursão infinita. Sendo definer, ela não passa pela política.
 *
 * Conta sem linha em `profiles` responde ATIVA de propósito. Quem não tem
 * perfil já não tem feature nenhuma, e as funções abaixo continuam negando por
 * conta própria — responder "desativada" aqui mudaria o comportamento de quem
 * a migration não deveria tocar. */
create or replace function public.conta_ativa()
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select coalesce(
    (select not coalesce(p.disabled, false) from public.profiles p where p.id = auth.uid()),
    true);
$function$;

comment on function public.conta_ativa() is
  'Falso só para quem está marcado Desativado em Administração. Toda função de permissão começa por ela.';

-- ── As 14 funções de permissão ─────────────────────────────────────────────
-- Cada uma ganha `conta_ativa() and (...)` por fora. A expressão de dentro é a
-- que já existia, sem uma vírgula mudada: assim dá para conferir a mudança
-- lendo só a primeira linha de cada uma.

create or replace function public.is_frota_admin()
returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select public.conta_ativa() and coalesce(
    (select 'frota' = any(p.features) or p.is_superadmin
       from public.profiles p where p.id = auth.uid()),
    false);
$function$;

create or replace function public.pode_aprovar_frota()
returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select public.conta_ativa() and coalesce(
    (select 'frota.aprovar' = any(p.features) or p.is_superadmin
       from public.profiles p where p.id = auth.uid()),
    false);
$function$;

create or replace function public.is_vessel_admin()
returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select public.conta_ativa() and coalesce(
    (select 'autenticidade' = any(p.features) or p.is_superadmin
       from public.profiles p where p.id = auth.uid()),
    false);
$function$;

create or replace function public.pode_ver_vendas()
returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select public.conta_ativa() and coalesce(
    (select p.role = 'admin' or p.is_superadmin or 'sales' = any(p.features)
       from public.profiles p where p.id = auth.uid()),
    false);
$function$;

create or replace function public.is_acessos_admin()
returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select public.conta_ativa() and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (p.role = 'admin' or 'acessos' = any(coalesce(p.features, array[]::text[])))
  );
$function$;

create or replace function public.is_patrimonio_admin()
returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select public.conta_ativa() and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (p.role = 'admin' or 'patrimonio' = any(coalesce(p.features, array[]::text[])))
  );
$function$;

-- SUPERADMIN TAMBÉM. Ele é admin com mais poder, não uma categoria fora das
-- regras — e uma conta de superadmin desativada é justamente a que mais
-- precisa parar de abrir porta.
create or replace function public.is_superadmin()
returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select public.conta_ativa() and coalesce(
    (select email from public.profiles where id = auth.uid())
      in ('erick@rbvcompany.com','gabriel.gertrudes@rbvcompany.com','breno@rbvcompany.com'),
    false);
$function$;

create or replace function public.pode_ver_conta(p_conta text)
returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select public.conta_ativa() and exists (
    select 1 from public.profiles p
     where p.id = auth.uid()
       and (p.role = 'admin' or p.is_superadmin
            or p.allowed_accounts is null
            or p_conta is null
            or p_conta = any (p.allowed_accounts::text[]))
  );
$function$;

create or replace function public.pode_ver_bem(p_local uuid, p_pessoa uuid)
returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select public.conta_ativa() and (
    coalesce((select is_superadmin from public.profiles where id = auth.uid()), false)
    or coalesce((select not escopo_por_equipe from public.profiles where id = auth.uid()), false)
    or exists (select 1 from public.equipes e
                where e.local_id = p_local
                  and e.id in (select public.minhas_equipes()))
    or exists (select 1 from public.acessos_pessoas ap
                where ap.id = p_pessoa and ap.profile_id = auth.uid()));
$function$;

create or replace function public.pode_ver_canal(p_canal bigint)
returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select public.conta_ativa() and (
    coalesce((select is_superadmin from public.profiles where id = auth.uid()), false)
    or coalesce((select not escopo_por_equipe from public.profiles where id = auth.uid()), false)
    or exists (select 1 from public.equipes e
                where e.canal_loja_id = p_canal
                  and e.id in (select public.minhas_equipes()))
    or exists (select 1
                 from public.canais_grupos_membros gm
                 join public.bling_lojas alvo on alvo.grupo_id = gm.grupo_id
                where gm.profile_id = auth.uid()
                  and gm.papel = 'supervisora'
                  and alvo.loja_id = p_canal));
$function$;

create or replace function public.pode_ver_equipe(p_equipe uuid)
returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select public.conta_ativa() and (
    coalesce((select is_superadmin from public.profiles where id = auth.uid()), false)
    or coalesce((select not escopo_por_equipe from public.profiles where id = auth.uid()), false)
    or (p_equipe is not null and p_equipe in (select public.minhas_equipes())));
$function$;

create or replace function public.pode_ver_grupo(p_grupo uuid)
returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select public.conta_ativa() and (
    coalesce((select is_superadmin from public.profiles where id = auth.uid()), false)
    or coalesce((select not escopo_por_equipe from public.profiles where id = auth.uid()), false)
    or exists (select 1 from public.canais_grupos_membros gm
                where gm.grupo_id = p_grupo and gm.profile_id = auth.uid()));
$function$;

create or replace function public.pode_ver_estoque(p_deposito bigint)
returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select public.conta_ativa() and (
    coalesce((select is_superadmin from public.profiles where id = auth.uid()), false)
    or coalesce((select not escopo_por_equipe from public.profiles where id = auth.uid()), false)
    or exists (
      select 1 from public.equipes e
       where e.deposito_id = p_deposito
         and (public.tenho_papel_na_equipe(e.id, array['supervisora','gestor'])
              or exists (select 1 from public.equipes_permissoes p
                          where p.equipe_id = e.id and p.profile_id = auth.uid() and p.chave = 'estoque'
                            and exists (select 1 from public.equipes_membros m
                                         where m.equipe_id = e.id and m.profile_id = auth.uid())))));
$function$;

-- O PAPEL de quem está desativado é NULO, não 'admin'. `get_my_role()` é usada
-- na política que deixa mexer em `profiles`; devolver o papel de sempre faria
-- um admin desativado continuar mudando os outros.
create or replace function public.get_my_role()
returns text language sql stable security definer set search_path to 'public'
as $function$
  select case when public.conta_ativa()
    then (select role from public.profiles where id = auth.uid())
    else null end;
$function$;

-- ── A leitura de `profiles`, que é o que fecha as outras 46 portas ─────────
-- 46 políticas desta base consultam `public.profiles` DIRETO, no formato
-- `exists (select 1 from profiles where id = auth.uid() and ...)`. Elas não
-- passam por função nenhuma, então nada do que está acima as alcança. Fazendo a
-- LEITURA de profiles parar para quem está desativado, todas as 46 passam a
-- responder falso sozinhas — e a conta também deixa de carregar o próprio
-- perfil, que é o que faz a tela dizer que não há acesso.
drop policy if exists auth_read_profiles on public.profiles;
create policy auth_read_profiles on public.profiles
  for select
  using (auth.role() = 'authenticated' and public.conta_ativa());
