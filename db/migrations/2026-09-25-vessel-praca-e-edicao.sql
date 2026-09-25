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
-- A CARGA INICIAL (seção 7) usa a MESMA função (`vessel_achatar_cidade`) para
-- gerar a chave — nada de digitar a chave à mão duas vezes: um erro de dedo
-- de um lado só, e a chave nunca bateria com o que a função devolve depois.
--
-- ⚠️ `unaccent` NÃO EXISTE nesta base (medido em 25/09/2026: nenhuma linha em
-- `pg_extension`) — não se instala extensão por conta própria para isso. A
-- conta sai de `public.vessel_achatar_cidade` (seção 6), e é A MESMA conta que
-- o `achatarCidade` do front já faz
-- (`src/ferramentas/comercial-vessel/praca-regras.js`) — combinar as duas
-- depois seria um defeito silencioso (uma bate, a outra não).
--
-- ⚠️ RODADA 1 DE CONSERTO (revisão de 25/09/2026): a conta original só cobria
-- acento PRECOMPOSTO (o "ã" já pronto, uma letra) via `translate`. Duas fontes
-- de texto sujo escapavam dela: (1) acento em forma DECOMPOSTA — "a" + marca
-- combinante "~" separada, o que o macOS produz ao colar texto (NFD); e (2)
-- espaço que não é espaço nas pontas — tab, quebra de linha, NBSP —, que o
-- `trim()` do Postgres não tira (só tira o caractere espaço comum). O
-- conserto: depois do `translate`, tira TODA marca combinante que sobrar
-- (faixa Unicode U+0300–U+036F, que cobre til, agudo, crase, circunflexo,
-- trema, cedilha) e SÓ DEPOIS colapsa qualquer sequência de espaço/tab/quebra
-- de linha/NBSP num espaço só — colapsar antes de aparar garante que a ponta
-- vira um espaço comum, que o `trim()` final tira de verdade.
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
create index if not exists vessel_praca_cidades_praca_idx on public.vessel_praca_cidades (praca_id);

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
-- ⚠️ o `on delete cascade` de `edicao_id` varre esta tabela toda sem índice.
create index if not exists vessel_stylist_na_edicao_edicao_idx on public.vessel_stylist_na_edicao (edicao_id);

-- ── 5. a stylist e o private edit apontam para a praça ───────────────────────
alter table public.vessel_stylists      add column if not exists praca_id bigint references public.vessel_pracas(id);
alter table public.vessel_private_edits add column if not exists praca_id bigint references public.vessel_pracas(id);
create index if not exists vessel_stylists_praca_idx on public.vessel_stylists (praca_id);

-- ── 6. achatar cidade (mesma conta do front) ─────────────────────────────────
-- a praça de cada stylist sai da CIDADE dela; quem não casa fica nula e vira
-- pendência na tela (a "Limeira / Piracicaba" é exatamente este caso)
-- ⚠️ `unaccent` NÃO EXISTE nesta base (medido em 25/09/2026: nenhuma linha em
-- `pg_extension`). Nada de instalar extensão por conta própria — a conta é
-- feita com `translate`, e é ESTA a mesma conta do `achatarCidade` do front.
--
-- ⚠️ DUAS PASSADAS, NA ORDEM CERTA (rodada 1 de conserto — ver o cabeçalho):
--   1) `translate` troca o acento PRECOMPOSTO (ã, é, ç… uma letra só);
--   2) o que sobrar de marca combinante (o acento DECOMPOSTO — "a" + til
--      separado, do jeito que o macOS produz) sai pela faixa U+0300–U+036F;
--   3) SÓ DEPOIS colapsa espaço/tab/quebra de linha/NBSP num espaço só — nas
--      pontas isso vira um espaço comum, que o `btrim` final tira de verdade
--      (o `trim()` do Postgres sozinho só tira o caractere espaço comum).
-- `immutable` e sem leitura de dado nenhum: não precisa de portão.
create or replace function public.vessel_achatar_cidade(p_texto text)
returns text language sql immutable set search_path to 'public' as $$
  select btrim(
           regexp_replace(
             regexp_replace(
               lower(translate(coalesce(p_texto, ''),
                 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ',
                 'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn')),
               '[̀-ͯ]', '', 'g'),
             '[\t\n\r  ]+', ' ', 'g'));
$$;

-- ── 7. a carga inicial: as praças de hoje e as cidades delas ────────────────
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

-- ⚠️ `cidade_chave` sai de `vessel_achatar_cidade(cidade)` — NUNCA digitada à
-- mão: é a mesma função que casa a stylist com a praça logo abaixo, então as
-- duas pontas nascem da MESMA conta e não podem divergir uma da outra.
insert into public.vessel_praca_cidades (praca_id, cidade, cidade_chave)
select p.id, c.cidade, public.vessel_achatar_cidade(c.cidade) from public.vessel_pracas p
join (values ('CPS','Campinas'), ('SAO','São Paulo'), ('SBO','Santa Bárbara'),
             ('BSB','Brasília'), ('LIM','Limeira'), ('PIR','Piracicaba')
     ) as c(sigla, cidade) on c.sigla = p.sigla
on conflict (cidade_chave) do nothing;

-- ── 8. migrar quem já casa, pela cidade e pela sigla ─────────────────────────
update public.vessel_stylists s set praca_id = c.praca_id
from public.vessel_praca_cidades c
where s.praca_id is null
  and c.cidade_chave = public.vessel_achatar_cidade(s.cidade);

update public.vessel_private_edits e set praca_id = p.id
from public.vessel_pracas p where e.praca_id is null and upper(trim(coalesce(e.praca, ''))) = p.sigla;

-- ── 9. as funções de negócio (Task 4) ────────────────────────────────────────
-- O cadastro de praça e cidade, e o ciclo da edição do Stylist Circle
-- (criar → abrir → encerrar, com o congelamento de quem não ativou).
--
-- ⚠️ TRAVA POR TELA, NÃO A DA FAMÍLIA (PADRAO-DA-CENTRAL.md, 9¾ — B13,
-- 25/09/2026): toda função nova do Comercial Vessel confere
-- `public.vessel_pode('<chave da tela>', 'ver'|'editar')`, nunca
-- `is_vessel_atendimentos()` / `_editar()` (a trava da família aceita
-- QUALQUER tela — é exatamente o buraco que o B13 fechou). Praça e Edição
-- hoje são parte da tela Stylist Circle (`atendimentos.stylist-circle`, já na
-- lista fechada de `vessel_pode` e no catálogo com `ver`+`editar`); uma tarefa
-- futura recorta chaves próprias (`atendimentos.pracas`, `atendimentos.
-- edicoes`) com pré-concessão para quem já tem esta — até lá, quem tem
-- Stylist Circle tem isto também, de propósito.
--
-- ⚠️ Escrita NUNCA `raise`: devolve sempre `{"ok":false,"situacao":"..."}`
-- (a tela precisa do motivo escrito). Leitura pode `raise exception` — quem
-- chama já filtra a tela pela permissão antes de pedir a lista.

-- as praças, com as cidades e quantas stylists (não-teste) cada uma tem
create or replace function public.vessel_pracas_listar()
returns json
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if not public.vessel_pode('atendimentos.stylist-circle', 'ver') then
    raise exception 'sem permissao' using errcode = '42501';
  end if;
  return coalesce((
    select json_agg(json_build_object(
             'id', p.id, 'sigla', p.sigla, 'nome', p.nome, 'loja_destino', p.loja_destino,
             'ativa', p.ativa,
             'cidades', coalesce((select json_agg(json_build_object('id', c.id, 'cidade', c.cidade) order by c.cidade)
                          from public.vessel_praca_cidades c where c.praca_id = p.id), '[]'::json),
             'stylists', (select count(*)::int from public.vessel_stylists s
                           where s.praca_id = p.id and not coalesce(s.teste, false)))
           order by p.ordem, p.id)
      from public.vessel_pracas p), '[]'::json);
end;
$$;

-- cadastrar uma praça nova: sigla maiúscula de 3 letras, única
create or replace function public.vessel_praca_criar(p_sigla text, p_nome text, p_loja_destino text)
returns json
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_sigla text := upper(nullif(trim(coalesce(p_sigla, '')), ''));
  v_nome  text := nullif(trim(coalesce(p_nome, '')), '');
  v_loja  text := nullif(trim(coalesce(p_loja_destino, '')), '');
  v_ordem int;
  v_id    bigint;
begin
  if not public.vessel_pode('atendimentos.stylist-circle', 'editar') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  if v_nome is null then
    return json_build_object('ok', false, 'situacao', 'sem_nome');
  end if;
  if v_sigla is null or v_sigla !~ '^[A-Z]{3}$' then
    return json_build_object('ok', false, 'situacao', 'sigla_invalida');
  end if;
  -- ⚠️ É ESTA CONFERÊNCIA QUE PROTEGE A `unique` DA TABELA: sem ela o defeito
  -- apareceria como erro cru de banco (23505), não como `situacao` na tela.
  if exists (select 1 from public.vessel_pracas where sigla = v_sigla) then
    return json_build_object('ok', false, 'situacao', 'sigla_repetida');
  end if;
  select coalesce(max(ordem), 0) + 1 into v_ordem from public.vessel_pracas;
  insert into public.vessel_pracas (sigla, nome, loja_destino, ordem)
  values (v_sigla, v_nome, v_loja, v_ordem)
  returning id into v_id;
  return json_build_object('ok', true, 'situacao', 'ok', 'id', v_id);
end;
$$;

-- editar nome, loja de destino e ativa — sigla é imutável (não entra aqui)
create or replace function public.vessel_praca_editar(p_id bigint, p_nome text, p_loja_destino text, p_ativa boolean)
returns json
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_nome text := nullif(trim(coalesce(p_nome, '')), '');
  v_loja text := nullif(trim(coalesce(p_loja_destino, '')), '');
begin
  if not public.vessel_pode('atendimentos.stylist-circle', 'editar') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  if not exists (select 1 from public.vessel_pracas where id = p_id) then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;
  if v_nome is null then
    return json_build_object('ok', false, 'situacao', 'sem_nome');
  end if;
  -- ⚠️ RODADA 1 DE CONSERTO: `loja_destino` e `ativa` usam a MESMA semântica de
  -- nulo — PRESERVA o que já estava (a tela manda um salvamento parcial e não
  -- pode apagar a loja de tabela sem querer). Limpar a loja é outra ação, que
  -- ainda não existe.
  update public.vessel_pracas
     set nome = v_nome, loja_destino = coalesce(v_loja, loja_destino), ativa = coalesce(p_ativa, ativa)
   where id = p_id;
  return json_build_object('ok', true, 'situacao', 'ok');
end;
$$;

-- vincular uma cidade a uma praça — a chave SEMPRE por vessel_achatar_cidade
create or replace function public.vessel_praca_cidade_vincular(p_praca_id bigint, p_cidade text)
returns json
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_cidade text := nullif(trim(coalesce(p_cidade, '')), '');
  v_chave  text;
  v_dono   record;
  v_id     bigint;
begin
  if not public.vessel_pode('atendimentos.stylist-circle', 'editar') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  if not exists (select 1 from public.vessel_pracas where id = p_praca_id) then
    return json_build_object('ok', false, 'situacao', 'praca_invalida');
  end if;
  if v_cidade is null then
    return json_build_object('ok', false, 'situacao', 'sem_cidade');
  end if;
  -- ⚠️ A MESMA CONTA DO FRONT (achatarCidade em praca-regras.js) — nunca a
  -- chave digitada à mão (ver o cabeçalho desta migration).
  v_chave := public.vessel_achatar_cidade(v_cidade);
  if v_chave = '' then
    return json_build_object('ok', false, 'situacao', 'sem_cidade');
  end if;

  select c.id, c.praca_id, p.nome as praca_nome
    into v_dono
    from public.vessel_praca_cidades c join public.vessel_pracas p on p.id = c.praca_id
   where c.cidade_chave = v_chave;

  if v_dono.id is not null and v_dono.praca_id <> p_praca_id then
    return json_build_object('ok', false, 'situacao', 'cidade_em_outra_praca',
      'praca_id', v_dono.praca_id, 'praca_nome', v_dono.praca_nome);
  end if;
  if v_dono.id is not null then
    return json_build_object('ok', true, 'situacao', 'ja_vinculada', 'id', v_dono.id);
  end if;

  insert into public.vessel_praca_cidades (praca_id, cidade, cidade_chave)
  values (p_praca_id, v_cidade, v_chave)
  returning id into v_id;
  return json_build_object('ok', true, 'situacao', 'ok', 'id', v_id);
end;
$$;

-- desvincular uma cidade
create or replace function public.vessel_praca_cidade_desvincular(p_id bigint)
returns json
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.vessel_pode('atendimentos.stylist-circle', 'editar') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  if not exists (select 1 from public.vessel_praca_cidades where id = p_id) then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;
  delete from public.vessel_praca_cidades where id = p_id;
  return json_build_object('ok', true, 'situacao', 'ok');
end;
$$;

-- definir (ou tirar, com praca_id nulo) a praça de uma stylist na mão
create or replace function public.vessel_stylist_definir_praca(p_codigo text, p_praca_id bigint)
returns json
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_codigo text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
  v_id     bigint;
begin
  if not public.vessel_pode('atendimentos.stylist-circle', 'editar') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  select id into v_id from public.vessel_stylists where codigo = v_codigo;
  if v_id is null then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;
  if p_praca_id is not null and not exists (select 1 from public.vessel_pracas where id = p_praca_id) then
    return json_build_object('ok', false, 'situacao', 'praca_invalida');
  end if;
  update public.vessel_stylists set praca_id = p_praca_id, atualizado_em = now() where id = v_id;
  return json_build_object('ok', true, 'situacao', 'ok', 'codigo', v_codigo);
end;
$$;

-- as edições de uma praça (ou de todas, com p_praca_id nulo)
create or replace function public.vessel_edicoes_listar(p_praca_id bigint)
returns json
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if not public.vessel_pode('atendimentos.stylist-circle', 'ver') then
    raise exception 'sem permissao' using errcode = '42501';
  end if;
  return coalesce((
    select json_agg(json_build_object(
             'id', e.id, 'praca_id', e.praca_id, 'praca_nome', p.nome, 'numero', e.numero,
             'nome', e.nome, 'comeca_em', e.comeca_em, 'termina_em', e.termina_em, 'situacao', e.situacao,
             -- ⚠️ RODADA 1 DE CONSERTO (CRÍTICO 1): SEM filtrar por `saiu_em`.
             -- `vessel_edicao_encerrar` fecha (`saiu_em`) TODOS os vínculos da
             -- edição no mesmo instante em que ela vira 'encerrada' — nenhum
             -- membro é acrescentado ou removido depois disso (o congelamento
             -- é exatamente esse: quem esteve, esteve). Filtrar por
             -- `saiu_em is null` aqui faria toda edição encerrada aparecer
             -- com zero stylists, para sempre — o oposto do que o cabeçalho
             -- desta migration promete ("o placar da edição encerrada
             -- continua contando a linha antiga"). Enquanto a edição está
             -- planejada/aberta ninguém tem `saiu_em` ainda, então a conta
             -- coincide com "quem está nela agora"; depois de encerrada, ela
             -- vira "quem esteve nela" — o mesmo número, para sempre.
             'stylists', (select count(*)::int from public.vessel_stylist_na_edicao n
                           where n.edicao_id = e.id))
           order by p.ordem, e.numero desc)
      from public.vessel_stylist_circle_edicoes e join public.vessel_pracas p on p.id = e.praca_id
     where p_praca_id is null or e.praca_id = p_praca_id), '[]'::json);
end;
$$;

-- criar a próxima edição da praça — numero = maior da praça + 1
create or replace function public.vessel_edicao_criar(p_praca_id bigint, p_nome text, p_comeca_em date, p_termina_em date)
returns json
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_nome   text := nullif(trim(coalesce(p_nome, '')), '');
  v_numero int;
  v_id     bigint;
begin
  if not public.vessel_pode('atendimentos.stylist-circle', 'editar') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  if not exists (select 1 from public.vessel_pracas where id = p_praca_id) then
    return json_build_object('ok', false, 'situacao', 'praca_invalida');
  end if;
  if p_comeca_em is null then
    return json_build_object('ok', false, 'situacao', 'sem_data');
  end if;
  if p_termina_em is not null and p_termina_em < p_comeca_em then
    return json_build_object('ok', false, 'situacao', 'data_invalida');
  end if;

  -- ⚠️ FILA POR PRAÇA: sem o advisory lock, duas chamadas ao mesmo tempo
  -- calculariam o mesmo "maior + 1" e colidiriam no `unique (praca_id, numero)`.
  perform pg_advisory_xact_lock(hashtext('vessel_stylist_circle_edicoes:' || p_praca_id::text));
  select coalesce(max(numero), 0) + 1 into v_numero
    from public.vessel_stylist_circle_edicoes where praca_id = p_praca_id;

  insert into public.vessel_stylist_circle_edicoes (praca_id, numero, nome, comeca_em, termina_em)
  values (p_praca_id, v_numero, v_nome, p_comeca_em, p_termina_em)
  returning id into v_id;

  return json_build_object('ok', true, 'situacao', 'ok', 'id', v_id, 'numero', v_numero);
end;
$$;

-- abrir uma edição — só uma aberta por praça, e encerrada não reabre
create or replace function public.vessel_edicao_abrir(p_id bigint)
returns json
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_ed public.vessel_stylist_circle_edicoes%rowtype;
begin
  if not public.vessel_pode('atendimentos.stylist-circle', 'editar') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  select * into v_ed from public.vessel_stylist_circle_edicoes where id = p_id;
  if v_ed.id is null then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;
  if v_ed.situacao = 'encerrada' then
    return json_build_object('ok', false, 'situacao', 'edicao_encerrada');
  end if;
  if v_ed.situacao = 'aberta' then
    return json_build_object('ok', true, 'situacao', 'sem_mudanca');
  end if;
  if exists (select 1 from public.vessel_stylist_circle_edicoes
              where praca_id = v_ed.praca_id and situacao = 'aberta' and id <> p_id) then
    return json_build_object('ok', false, 'situacao', 'ja_tem_aberta');
  end if;
  update public.vessel_stylist_circle_edicoes set situacao = 'aberta' where id = p_id;
  return json_build_object('ok', true, 'situacao', 'ok');
end;
$$;

-- encerrar uma edição: congela quem estava nela; quem NÃO ativou pode ir para
-- uma edição de destino — quem ativou fica com o vínculo fechado e não vai.
create or replace function public.vessel_edicao_encerrar(p_id bigint, p_levar_para bigint)
returns json
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_ed      public.vessel_stylist_circle_edicoes%rowtype;
  v_destino public.vessel_stylist_circle_edicoes%rowtype;
  v_levadas int := 0;
begin
  if not public.vessel_pode('atendimentos.stylist-circle', 'editar') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  select * into v_ed from public.vessel_stylist_circle_edicoes where id = p_id;
  if v_ed.id is null then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;
  if v_ed.situacao = 'encerrada' then
    return json_build_object('ok', false, 'situacao', 'edicao_encerrada');
  end if;

  if p_levar_para is not null then
    select * into v_destino from public.vessel_stylist_circle_edicoes where id = p_levar_para;
    if v_destino.id is null then
      return json_build_object('ok', false, 'situacao', 'destino_invalido');
    end if;
    -- ⚠️ NÃO SE LEVA PARA UM DESTINO CONGELADO — a mesma trava de
    -- `vessel_edicao_incluir_stylist`, só que aplicada aqui de propósito.
    if v_destino.situacao = 'encerrada' then
      return json_build_object('ok', false, 'situacao', 'edicao_encerrada');
    end if;
    -- ⚠️ RODADA 1 DE CONSERTO (MENOR 6): NÃO SE LEVA PARA OUTRA PRAÇA — praça
    -- é o assunto desta tarefa; sem esta trava daria para levar quem não
    -- ativou em Limeira para uma edição de Campinas.
    if v_destino.praca_id <> v_ed.praca_id then
      return json_build_object('ok', false, 'situacao', 'destino_de_outra_praca');
    end if;
  end if;

  update public.vessel_stylist_circle_edicoes set situacao = 'encerrada' where id = p_id;

  -- ⚠️ O CONGELAMENTO: fecha (`saiu_em`/`etapa_ao_sair`) TODOS os vínculos
  -- ativos desta edição — depois disto nada muda o que ela conta (ver o
  -- cabeçalho da migration). Quem NÃO ativou (`ativada_em is null`) e tem
  -- destino abre um vínculo novo lá; quem ativou fica com o vínculo fechado
  -- e NÃO é levada.
  with fechados as (
    update public.vessel_stylist_na_edicao n
       set saiu_em = now(), etapa_ao_sair = s.etapa_id
      from public.vessel_stylists s
     where n.stylist_id = s.id and n.edicao_id = p_id and n.saiu_em is null
    returning n.stylist_id, s.ativada_em
  )
  -- ⚠️ RODADA 1 DE CONSERTO (CRÍTICO 2): `on conflict ... do nothing` — a
  -- stylist pode já ter um vínculo (fechado ou não) na edição de destino
  -- (ex.: foi incluída nas duas edições antes de a primeira ser encerrada).
  -- Sem isto, a unique `(stylist_id, edicao_id)` estourava 23505 CRU (a tela
  -- recebe erro sem motivo escrito) e — pior — como um erro dentro do bloco
  -- aborta a transação INTEIRA nesta base, o encerramento nem chegava a
  -- congelar ninguém. `get diagnostics` conta só quem foi REALMENTE inserida
  -- (a que deu conflito não entra em `levadas`).
  insert into public.vessel_stylist_na_edicao (stylist_id, edicao_id)
  select f.stylist_id, p_levar_para from fechados f
   where f.ativada_em is null and p_levar_para is not null
  on conflict (stylist_id, edicao_id) do nothing;
  get diagnostics v_levadas = row_count;

  return json_build_object('ok', true, 'situacao', 'ok', 'levadas', v_levadas);
end;
$$;

-- incluir uma stylist na edição — recusa se a edição já encerrou
create or replace function public.vessel_edicao_incluir_stylist(p_codigo text, p_edicao_id bigint)
returns json
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_codigo     text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
  v_stylist_id bigint;
  v_ed         public.vessel_stylist_circle_edicoes%rowtype;
begin
  if not public.vessel_pode('atendimentos.stylist-circle', 'editar') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  select id into v_stylist_id from public.vessel_stylists where codigo = v_codigo;
  if v_stylist_id is null then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;
  select * into v_ed from public.vessel_stylist_circle_edicoes where id = p_edicao_id;
  if v_ed.id is null then
    return json_build_object('ok', false, 'situacao', 'edicao_invalida');
  end if;
  -- ⚠️ É ESTA TRAVA QUE IMPEDE O PASSADO DE MUDAR: edição encerrada está
  -- congelada, nada entra nela depois (ver o cabeçalho da migration).
  if v_ed.situacao = 'encerrada' then
    return json_build_object('ok', false, 'situacao', 'edicao_encerrada');
  end if;
  if exists (select 1 from public.vessel_stylist_na_edicao
              where stylist_id = v_stylist_id and edicao_id = p_edicao_id and saiu_em is null) then
    return json_build_object('ok', true, 'situacao', 'sem_mudanca');
  end if;
  insert into public.vessel_stylist_na_edicao (stylist_id, edicao_id) values (v_stylist_id, p_edicao_id);
  return json_build_object('ok', true, 'situacao', 'ok');
end;
$$;

-- ── 10. as portas ────────────────────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'public.vessel_pracas_listar()',
    'public.vessel_praca_criar(text, text, text)',
    'public.vessel_praca_editar(bigint, text, text, boolean)',
    'public.vessel_praca_cidade_vincular(bigint, text)',
    'public.vessel_praca_cidade_desvincular(bigint)',
    'public.vessel_stylist_definir_praca(text, bigint)',
    'public.vessel_edicoes_listar(bigint)',
    'public.vessel_edicao_criar(bigint, text, date, date)',
    'public.vessel_edicao_abrir(bigint)',
    'public.vessel_edicao_encerrar(bigint, bigint)',
    'public.vessel_edicao_incluir_stylist(text, bigint)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
