-- A PRAÇA VIRA CADASTRO DE VERDADE, E O STYLIST CIRCLE GANHA EDIÇÃO.
--
-- Decisão do dono em 25/09/2026. Até aqui "praça" era um texto solto
-- (`vessel_stylists.praca_preview`, `vessel_private_edits.praca`): a stylist
-- escrevia a cidade dela e alguém lia por cima. Isso vira CADASTRO — cada
-- praça tem sigla, nome, a loja que atende (que pode ser de OUTRA cidade: a
-- praça Piracicaba é atendida pela loja de Campinas) e a lista de cidades
-- dela. E o "Stylist Circle" ganha EDIÇÃO: cada praça roda o programa em
-- rodadas numeradas (planejada → aberta → encerrada), e é a edição — não mais
-- um campo solto — que decide quem está "dentro" agora.
--
-- Esta migration (Task 3) é só a fundação: as quatro tabelas, as duas colunas
-- novas e a carga inicial dos dados de hoje. NENHUMA função de negócio nasce
-- aqui (cadastrar praça, abrir edição, mover stylist de edição, o placar da
-- edição): isso são as Tasks 4 e 5, que ACRESCENTAM neste mesmo arquivo e no
-- mesmo aplicador — por isso as seções são numeradas e o bloco de portas
-- (grants), no fim, começa vazio mas pronto para crescer.
--
-- ── POR QUE NÃO `vessel_edicoes` ────────────────────────────────────────────
--
-- Esse nome já está ocupado: é o log de alterações do módulo (229 linhas
-- medidas em 25/09/2026), sem nenhuma relação com o Stylist Circle. A tabela
-- nova é `vessel_stylist_circle_edicoes`.
--
-- ── A CIDADE VIRA PRAÇA: A CONTA TEM DE SER A MESMA DO FRONT ────────────────
--
-- `vessel_praca_cidades.cidade_chave` guarda a cidade sem acento e em
-- minúscula, e é por ela que a migração dos dados casa a stylist com a praça.
-- ⚠️ `unaccent` NÃO EXISTE nesta base (medido em 25/09/2026: nenhuma linha em
-- `pg_extension`) — não se instala extensão por conta própria para isso. A
-- conta sai de `public.vessel_achatar_cidade`, com `translate`, e é A MESMA
-- conta que o `achatarCidade` do front já faz — combinar as duas depois seria
-- um defeito silencioso (uma bate, a outra não).
--
-- Medido em 25/09/2026, 63 stylists não-teste: 27 "Campinas", 18 "Limeira",
-- 17 "Piracicaba", 1 "Limeira / Piracicaba". Esta última NÃO CASA com nenhuma
-- cidade cadastrada (é texto composto) e fica SEM PRAÇA de propósito — vira
-- pendência visível na tela, não um chute de qual das duas é a certa.
--
-- ── A LOJA DE DESTINO PODE FICAR EM BRANCO ──────────────────────────────────
--
-- `loja_destino` é nula para São Paulo, Santa Bárbara, Brasília, Limeira e
-- Piracicaba: só Campinas tem loja definida hoje (iguatemi). As outras são
-- pendência do DONO, não desta migration — a tela é que vai escrever isso.
--
-- ── A EDIÇÃO CONGELA O PLACAR DE QUEM SAIU ──────────────────────────────────
--
-- `vessel_stylist_na_edicao` é quem decide "esta stylist está NESTA edição
-- agora". A stylist que não ativou na virada da rodada sai daqui com
-- `saiu_em` preenchido e entra na edição seguinte numa linha NOVA — o placar
-- da edição encerrada continua contando a linha antiga e não muda depois
-- disso (a mesma regra de "data gravada não muda" que já vale para
-- `prospectado_em`, na migration do funil configurável de 24/09/2026).

-- ── 1. as praças ─────────────────────────────────────────────────────────────
create table if not exists public.vessel_pracas (
  id           bigserial primary key,
  sigla        text not null unique,
  nome         text not null,
  loja_destino text,                       -- NULA de propósito: pendência do dono
  ordem        integer not null default 0,
  ativa        boolean not null default true,
  criado_em    timestamptz not null default now()
);
alter table public.vessel_pracas enable row level security;
revoke all on table public.vessel_pracas from anon, authenticated;
comment on column public.vessel_pracas.loja_destino is
  'A loja que atende a praça — pode ser de OUTRA cidade (Piracicaba → Campinas). Nula = a definir, e a tela escreve isso.';

-- ── 2. as cidades de cada praça ──────────────────────────────────────────────
create table if not exists public.vessel_praca_cidades (
  id           bigserial primary key,
  praca_id     bigint not null references public.vessel_pracas(id) on delete cascade,
  cidade       text not null,
  cidade_chave text not null unique,       -- sem acento, minúscula: a mesma conta do front
  criado_em    timestamptz not null default now()
);
alter table public.vessel_praca_cidades enable row level security;
revoke all on table public.vessel_praca_cidades from anon, authenticated;

-- ── 3. a edição: a rodada do programa, por praça ─────────────────────────────
create table if not exists public.vessel_stylist_circle_edicoes (
  id         bigserial primary key,
  praca_id   bigint not null references public.vessel_pracas(id),
  numero     integer not null,
  nome       text,
  comeca_em  date not null,
  termina_em date,
  situacao   text not null default 'planejada'
             check (situacao in ('planejada', 'aberta', 'encerrada')),
  criado_em  timestamptz not null default now(),
  unique (praca_id, numero),
  check (termina_em is null or termina_em >= comeca_em)
);
alter table public.vessel_stylist_circle_edicoes enable row level security;
revoke all on table public.vessel_stylist_circle_edicoes from anon, authenticated;

-- ⚠️ É ESTA TABELA QUE CONGELA A EDIÇÃO ENCERRADA. A stylist que não ativou sai
-- daqui com `saiu_em` e entra na edição seguinte numa linha NOVA — o placar da
-- edição 1 continua contando a linha antiga e não muda depois de encerrada.
-- ── 4. quem está em cada edição ──────────────────────────────────────────────
create table if not exists public.vessel_stylist_na_edicao (
  id            bigserial primary key,
  stylist_id    bigint not null references public.vessel_stylists(id) on delete cascade,
  edicao_id     bigint not null references public.vessel_stylist_circle_edicoes(id) on delete cascade,
  entrou_em     timestamptz not null default now(),
  saiu_em       timestamptz,
  etapa_ao_sair bigint references public.vessel_stylist_etapas(id),
  unique (stylist_id, edicao_id)
);
alter table public.vessel_stylist_na_edicao enable row level security;
revoke all on table public.vessel_stylist_na_edicao from anon, authenticated;

-- ── 5. a stylist e o private edit apontam para a praça ───────────────────────
alter table public.vessel_stylists      add column if not exists praca_id bigint references public.vessel_pracas(id);
alter table public.vessel_private_edits add column if not exists praca_id bigint references public.vessel_pracas(id);

-- ── 6. a carga inicial: as praças de hoje e as cidades delas ─────────────────
-- Medido em 25/09/2026: 27 Campinas, 18 Limeira, 17 Piracicaba, 1
-- "Limeira / Piracicaba" (esta última fica sem praça de propósito — ver o
-- cabeçalho). Só Campinas tem loja de destino definida; as outras são
-- pendência do dono.
insert into public.vessel_pracas (sigla, nome, loja_destino, ordem) values
  ('CPS', 'Campinas',       'iguatemi', 1),
  ('SAO', 'São Paulo',       null,      2),
  ('SBO', 'Santa Bárbara',   null,      3),
  ('BSB', 'Brasília',        null,      4),
  ('LIM', 'Limeira',         null,      5),   -- loja a definir: pendência do dono
  ('PIR', 'Piracicaba',      null,      6)    -- idem
on conflict (sigla) do nothing;

insert into public.vessel_praca_cidades (praca_id, cidade, cidade_chave)
select p.id, c.cidade, c.chave from public.vessel_pracas p
join (values ('CPS','Campinas','campinas'), ('SAO','São Paulo','sao paulo'),
             ('SBO','Santa Bárbara','santa barbara'), ('BSB','Brasília','brasilia'),
             ('LIM','Limeira','limeira'), ('PIR','Piracicaba','piracicaba')
     ) as c(sigla, cidade, chave) on c.sigla = p.sigla
on conflict (cidade_chave) do nothing;

-- ── 7. achatar cidade (mesma conta do front) e migrar quem já casa por ela ───
-- a praça de cada stylist sai da CIDADE dela; quem não casa fica nula e vira
-- pendência na tela (a "Limeira / Piracicaba" é exatamente este caso)
-- ⚠️ `unaccent` NÃO EXISTE nesta base (medido em 25/09/2026: nenhuma linha em
-- `pg_extension`). Nada de instalar extensão por conta própria — a conta é
-- feita com `translate`, e é ESTA a mesma conta do `achatarCidade` do front.
-- `immutable` e sem leitura de dado nenhum: não precisa de portão.
create or replace function public.vessel_achatar_cidade(p_texto text)
returns text language sql immutable set search_path to 'public' as $$
  select regexp_replace(
           lower(trim(translate(coalesce(p_texto, ''),
             'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ',
             'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn'))),
           '\s+', ' ', 'g');
$$;

update public.vessel_stylists s set praca_id = c.praca_id
from public.vessel_praca_cidades c
where s.praca_id is null
  and c.cidade_chave = public.vessel_achatar_cidade(s.cidade);

update public.vessel_private_edits e set praca_id = p.id
from public.vessel_pracas p where e.praca_id is null and upper(trim(coalesce(e.praca, ''))) = p.sigla;

-- ── 8. as portas ─────────────────────────────────────────────────────────────
-- Vazio por enquanto — nenhuma função de negócio nasce nesta migration (Task
-- 3). As Tasks 4 e 5 acrescentam aqui as funções de cadastro (praça, cidade,
-- edição) e o placar da edição, e a lista abaixo cresce com elas.
do $$
declare f text;
begin
  foreach f in array array[]::text[]
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
