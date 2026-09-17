-- Cache de "Visitas ao Perfil" por dia, já FECHADO e certo — pedido do
-- dono, 17/09/2026, depois de achar que a soma por hora de
-- perfil_visitas_hora sempre perde os últimos ~55min do dia (ver migration
-- 2026-09-17-followers-leituras-origem.sql pro problema irmão, de
-- seguidores; este aqui é o mesmo tipo de buraco, mas em visitas).
--
-- Quem escreve: coletor/gerar-opr-diario.mjs, uma vez por dia (fechamento),
-- pedindo pro Instagram o dia INTEIRO já fechado numa chamada só (ver
-- coletor/lib/visitas-perfil-meta.mjs) — sem o buraco da soma por hora.
--
-- Quem lê: a tela do Relatório OPR, pra somar os dias já fechados do
-- período escolhido, só caindo pra soma-por-hora nos dias que ainda não
-- têm linha aqui (normalmente só "hoje", que ainda não fechou).
create table if not exists public.visitas_perfil_dia (
  account_id   uuid not null references public.accounts(id) on delete cascade,
  dia          date not null,
  visitas      integer not null,
  calculado_em timestamptz not null default now(),
  primary key (account_id, dia)
);

alter table public.visitas_perfil_dia enable row level security;

drop policy if exists auth_read_visitas_perfil_dia on public.visitas_perfil_dia;
create policy auth_read_visitas_perfil_dia
  on public.visitas_perfil_dia for select
  to authenticated
  using (true);

comment on table public.visitas_perfil_dia is
  'Cache de "Visitas ao Perfil" (Instagram profile_views) por dia já fechado — calculado pelo fechamento do OPR direto da Meta, sem o buraco de ~55min que a soma por hora tem. Ver coletor/lib/visitas-perfil-meta.mjs.';
