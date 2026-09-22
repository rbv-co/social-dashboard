-- 056 — ABASTECIMENTO (21/09/2026)
-- Desenho: docs/superpowers/specs/2026-09-21-frota-abastecimento-design.md
--
-- Primeira fonte de LITRO e DINHEIRO da Frota. Medido no dia: o tanque só era
-- perguntado na devolução, e 18 das 25 viagens voltaram sem resposta.
create table if not exists public.frota_abastecimentos (
  id uuid primary key default gen_random_uuid(),
  veiculo_id uuid not null references public.frota_veiculos(id) on delete cascade,
  -- SET NULL como nas irmãs: o registro do abastecimento não some quando a
  -- pessoa sai da empresa. `pessoa_nome` guarda quem era.
  pessoa_id uuid references public.acessos_pessoas(id) on delete set null,
  pessoa_nome text,
  abastecido_em timestamptz not null default now(),
  km integer not null,
  litros numeric(7,3) not null,
  total_centavos integer not null,
  -- A escala da casa: 0 = Reserva … 4 = Cheio. Ver NIVEIS_TANQUE.
  tanque_depois smallint not null,
  combustivel text not null,
  posto text,
  observacao text,
  criado_em timestamptz not null default now(),
  criado_por uuid,
  -- As travas moram AQUI, não só na tela: tela é lembrete, banco é portão.
  constraint frota_abast_km_positivo check (km > 0),
  constraint frota_abast_litros_positivo check (litros > 0),
  constraint frota_abast_total_positivo check (total_centavos > 0),
  constraint frota_abast_tanque_valido check (tanque_depois between 0 and 4)
);

-- Toda leitura desta tabela é "os abastecimentos deste carro, do mais novo
-- para o mais velho".
create index if not exists idx_frota_abast_veiculo
  on public.frota_abastecimentos (veiculo_id, abastecido_em desc);

alter table public.frota_abastecimentos enable row level security;

-- MESMO PORTÃO DAS IRMÃS, conferido contra frota_checklist e frota_manutencoes
-- antes de escrever: as duas liberam ler e escrever para is_frota_admin(), que
-- é "tem a permissão frota ou é superadmin". A restrição por carro é da TELA —
-- está escrito na spec (D38) para ninguém achar que há tranca aqui.
drop policy if exists frota_abast_ler on public.frota_abastecimentos;
create policy frota_abast_ler on public.frota_abastecimentos
  for select using (public.is_frota_admin());

drop policy if exists frota_abast_escrever on public.frota_abastecimentos;
create policy frota_abast_escrever on public.frota_abastecimentos
  for all using (public.is_frota_admin()) with check (public.is_frota_admin());
