-- AS TELAS DO COMERCIAL VESSEL GANHAM CHAVE PRÓPRIA (24/09/2026).
--
-- O dono, pela segunda vez: "as permissões das ferramentas não estão sendo
-- atualizadas conforme vai nascendo novas ferramentas". Beauty Sessions,
-- Private Edit, Stylist Circle, Material Gráfico e o Appointment Card nasceram
-- (18 a 24/09) pegando carona na chave 'atendimentos' — e por isso nenhuma
-- delas aparecia no editor de permissões: dar o Private Appointment dava as
-- cinco, e não havia como dar uma sem as outras.
--
-- A Central passa a pedir, a cada tela, a chave dela:
--   atendimentos.beauty-sessions   [ver, editar]
--   atendimentos.private-edit      [ver, editar]
--   atendimentos.stylist-circle    [ver, editar]
--   atendimentos.material-grafico  [ver]
--   atendimentos.appointment-card  [ver]
-- (a fonte é src/compartilhado/catalogo-de-ferramentas.js).
--
-- Esta migration faz as DUAS coisas que isso exige no banco, e mais nada:
--
-- 1. A TRAVA APRENDE O PREFIXO. As ~40 funções do Comercial Vessel perguntam
--    `is_vessel_atendimentos()` (ver) e `is_vessel_atendimentos_editar()`
--    (mexer). As duas passam a aceitar 'atendimentos' OU 'atendimentos.<tela>'.
--    Sem isto, quem recebesse SÓ o Stylist Circle abriria a tela e o banco
--    recusaria tudo, calado.
--    ⚠️ A trava do banco continua sendo DA FAMÍLIA, não por tela: quem tem
--    qualquer tela do Comercial Vessel passa pelas funções das outras se
--    chamar por fora da Central. É o mesmo alcance de hoje (hoje uma chave dá
--    as cinco); separar por tela no banco é trocar o portão de ~40 funções, e
--    fica como decisão do dono.
--    ⚠️ E as duas passam a começar por `conta_ativa()`, como as outras 14
--    travas desde a 054 (acessos/054_desativado_fecha_de_verdade.sql). Estas
--    duas foram criadas DEPOIS da 054 e nasceram sem ela: uma conta
--    desativada passava no portão do Comercial Vessel.
--
-- 2. PRÉ-CONCESSÃO ADITIVA. Chave nova nasce concedida a NINGUÉM — e aqui isso
--    tiraria, no dia da entrega, as quatro telas e a porta de quem já as usa
--    hoje pela chave 'atendimentos'. Então quem já tem 'atendimentos'
--    (com 'ver') recebe as cinco chaves novas, com as MESMAS ações que já tem
--    (limitadas ao que cada chave oferece). Só ACRESCENTA: chave que a pessoa
--    já tenha não é tocada, e nada é tirado de ninguém. Super-admin não entra
--    (passa por `is_superadmin`); conta desativada também não.
--    Vale nos três lugares onde o acesso mora, para uma regravação de perfil
--    não desfazer: `profiles.permissions` (+ `features`, que é o que a trava
--    de ver lê), `profiles.permissions_excecao` quando 'atendimentos' veio por
--    exceção, e `acessos_perfis.permissions` (o perfil de acesso).

-- ── 1. A trava ─────────────────────────────────────────────────────────────

create or replace function public.is_vessel_atendimentos()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.conta_ativa() and coalesce(
    (select p.is_superadmin
         or exists (select 1 from unnest(coalesce(p.features, '{}'::text[])) f
                     where f = 'atendimentos' or left(f, 13) = 'atendimentos.')
       from public.profiles p where p.id = auth.uid()),
    false);
$$;

comment on function public.is_vessel_atendimentos() is
  'Quem pode VER o Comercial Vessel: features com atendimentos ou atendimentos.<tela>, conta ativa. A chave de cada tela mora em src/compartilhado/catalogo-de-ferramentas.js.';

-- ⚠️ A ARMADILHA DO NULO (ver 2026-09-19-vessel-trava-de-editar.sql): o
-- `coalesce` envolve a SUBCONSULTA INTEIRA, o `or` incluso.
create or replace function public.is_vessel_atendimentos_editar()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_vessel_atendimentos()
     and coalesce(
       (select p.is_superadmin
            or exists (
                 select 1
                   from jsonb_each(case when jsonb_typeof(p.permissions) = 'object'
                                        then p.permissions else '{}'::jsonb end) e(k, v)
                  where (e.k = 'atendimentos' or left(e.k, 13) = 'atendimentos.')
                    and jsonb_typeof(e.v) = 'array'
                    and e.v ? 'editar')
          from public.profiles p where p.id = auth.uid()),
       false);
$$;

comment on function public.is_vessel_atendimentos_editar() is
  'Quem pode MEXER no Comercial Vessel: a trava de ver E a acao editar em permissions[atendimentos ou atendimentos.<tela>]. Nunca mais frouxa que is_vessel_atendimentos().';

-- ⚠️ AS DUAS LINHAS SAO OBRIGATORIAS: `revoke ... from public` NAO fecha
-- `authenticated`.
revoke all on function public.is_vessel_atendimentos() from public, anon, authenticated;
grant execute on function public.is_vessel_atendimentos() to authenticated;
revoke all on function public.is_vessel_atendimentos_editar() from public, anon, authenticated;
grant execute on function public.is_vessel_atendimentos_editar() to authenticated;

-- ── 2. A pré-concessão aditiva ─────────────────────────────────────────────
-- `oferece` = as ações que cada chave nova tem no catálogo. A pessoa recebe a
-- interseção com o que ela já tem em 'atendimentos'.

create temporary table if not exists _chaves_novas (chave text primary key, oferece text[]) on commit drop;
insert into _chaves_novas values
  ('atendimentos.beauty-sessions',  array['ver', 'editar']),
  ('atendimentos.private-edit',     array['ver', 'editar']),
  ('atendimentos.stylist-circle',   array['ver', 'editar']),
  ('atendimentos.material-grafico', array['ver']),
  ('atendimentos.appointment-card', array['ver'])
on conflict (chave) do nothing;

-- O que dar a partir de um mapa de permissões: só as chaves que ele AINDA não
-- tem, com as ações de 'atendimentos' que cada uma oferece. Vazio se o mapa
-- não tem 'atendimentos' com 'ver'.
create or replace function pg_temp.o_que_acrescentar(p jsonb)
returns jsonb
language sql
as $$
  select coalesce(jsonb_object_agg(n.chave, (
           select jsonb_agg(a order by array_position(n.oferece, a))
             from jsonb_array_elements_text(p -> 'atendimentos') a
            where a = any(n.oferece))), '{}'::jsonb)
    from _chaves_novas n
   where jsonb_typeof(p) = 'object'
     and jsonb_typeof(p -> 'atendimentos') = 'array'
     and (p -> 'atendimentos') ? 'ver'
     and not (p ? n.chave);
$$;

-- 2a. As pessoas.
update public.profiles p
   set permissions = p.permissions || pg_temp.o_que_acrescentar(p.permissions),
       features = coalesce(p.features, '{}'::text[]) || array(
         select k from jsonb_object_keys(pg_temp.o_que_acrescentar(p.permissions)) k
          where not (k = any(coalesce(p.features, '{}'::text[])))
          order by k)
 where not coalesce(p.is_superadmin, false)
   and not coalesce(p.disabled, false)
   and pg_temp.o_que_acrescentar(p.permissions) <> '{}'::jsonb;

-- 2b. Quem tem 'atendimentos' por EXCEÇÃO ao perfil: a exceção leva junto,
-- senão a próxima regravação do perfil tiraria as chaves novas.
update public.profiles p
   set permissions_excecao = p.permissions_excecao || pg_temp.o_que_acrescentar(p.permissions_excecao)
 where not coalesce(p.is_superadmin, false)
   and not coalesce(p.disabled, false)
   and pg_temp.o_que_acrescentar(p.permissions_excecao) <> '{}'::jsonb;

-- 2c. Os perfis de acesso que dão 'atendimentos'.
update public.acessos_perfis ap
   set permissions = ap.permissions || pg_temp.o_que_acrescentar(ap.permissions)
 where pg_temp.o_que_acrescentar(ap.permissions) <> '{}'::jsonb;
