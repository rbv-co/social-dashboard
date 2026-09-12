-- Frota D27: um lançamento de manutenção é UM SERVIÇO com VÁRIAS trocas.
--
-- POR QUE UMA TABELA DE CABEÇALHO, e não só mais colunas em frota_revisoes:
-- hoje só existe "uma troca de um item". O lançamento que o dono pediu é a nota
-- da oficina: um KM, uma data, uma oficina, UM VALOR TOTAL e várias peças. Sem
-- cabeçalho, o total de R$ 1.240 teria de ser (a) rateado entre os itens,
-- mentindo sobre o preço de cada peça, ou (b) repetido em cada linha, e aí somar
-- o ano daria o triplo. Com ele, o lançamento também pode ser REABERTO e
-- CORRIGIDO — o que o dono não tem hoje: hoje só dá pra apagar linha por linha.
--
-- A MEDIDA QUE JUSTIFICA (12/08/2026): a frota tem 10 carros e **2 trocas
-- registradas** em frota_revisoes. Ninguém usa porque são 15 campos pra 3
-- trocas, com KM/data/oficina redigitados a cada volta. O dono: "o registrar
-- histórico de manutenção é difícil por ter que fazer um a um".
create table if not exists public.frota_manutencoes(
  id uuid primary key default gen_random_uuid(),
  veiculo_id uuid not null references public.frota_veiculos(id) on delete cascade,
  -- KM é NOT NULL de propósito (D27): revisão gravada sem KM é invisível pro
  -- alerta (ultimaRevisao() só considera km inteiro), então o item continuaria
  -- "vencido" pra sempre depois de trocado. Deixar nulo aqui seria deixar o dono
  -- registrar trabalho que não conserta o alerta que o incomodou.
  km int not null check (km >= 0),
  feita_em date,
  oficina text,
  -- O valor da NOTA, não a soma das peças. Os dois convivem: se os unitários não
  -- somarem o total, a diferença é mão de obra ou desconto — e a tela DIZ a
  -- diferença em vez de escolher um lado calado.
  total_centavos bigint,
  observacao text,
  criada_em timestamptz not null default now(),
  criada_por uuid references auth.users(id) on delete set null
);
create index if not exists idx_frota_manut_veiculo
  on public.frota_manutencoes(veiculo_id, km desc);

-- O elo. `on delete cascade`: apagar o lançamento apaga as trocas dele — é um
-- serviço só, e meia nota no histórico é pior que nota nenhuma.
-- Nulo é permitido e NÃO é sobra: as 2 linhas já gravadas em frota_revisoes
-- vieram do formulário de uma troca por vez e continuam válidas sem cabeçalho.
alter table public.frota_revisoes
  add column if not exists manutencao_id uuid
  references public.frota_manutencoes(id) on delete cascade;
create index if not exists idx_frota_rev_manutencao
  on public.frota_revisoes(manutencao_id);

alter table public.frota_manutencoes enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='frota_manutencoes' and policyname='frota_manut_ler') then
    create policy frota_manut_ler on public.frota_manutencoes for select using (public.is_frota_admin());
  end if;
  -- Mesma regra de frota_revisoes (migration 024): registrar manutenção é
  -- trabalho de quem administra, não de quem dirige.
  if not exists (select 1 from pg_policies where tablename='frota_manutencoes' and policyname='frota_manut_escrever') then
    create policy frota_manut_escrever on public.frota_manutencoes for all
      using (public.is_frota_admin()) with check (public.is_frota_admin());
  end if;
end $$;
