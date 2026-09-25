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

-- ── 10. vessel_rastreio_dos_stylists ganha o recorte por praça e edição (Task 5) ──
-- ⚠️ `create or replace` NÃO troca a assinatura: ele cria uma SEGUNDA função, e
-- o PostgREST passa a ter duas com o mesmo nome — a ordem certa é: 1) criar a
-- versão nova (4 parâmetros, os 2 últimos com `default null`, para que quem
-- chama com só os 2 de sempre, POR NOME — exatamente como o PostgREST faz —
-- continue caindo nesta função); 2) `drop` da assinatura antiga (2 parâmetros)
-- NA MESMA migration, senão sobra fantasma e o PostgREST fica em dúvida entre
-- as duas; 3) os grants refeitos na assinatura NOVA (o `drop` já leva os da
-- antiga junto).
-- ⚠️ A CENTRAL QUE ESTÁ NO AR HOJE chama só com `p_dias`/`p_incluir_desativadas`
-- — tanto `tela-de-stylist-circle.vue` quanto `tela-de-material-grafico.vue`.
-- O aplicador prova essa chamada de dois parâmetros continua respondendo
-- depois do drop (senão o Material Gráfico abre vazio e ninguém descobre).
-- O CORPO é o mesmo de sempre (`pg_get_functiondef` de 25/09/2026, depois do
-- B13), só ganhando: os dois parâmetros novos, o `left join` com a praça e a
-- edição atual, e o recorte no `where` — nada do resto muda.
create or replace function public.vessel_rastreio_dos_stylists(
  p_dias integer default 7, p_incluir_desativadas boolean default false,
  p_praca_id bigint default null, p_edicao_id bigint default null)
returns json
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_dias int := greatest(coalesce(p_dias, 7), 0);
  v_saida json;
begin
  if not (public.vessel_pode('atendimentos.stylist-circle', 'ver') or public.vessel_pode('atendimentos.material-grafico', 'ver')) then
    raise exception 'sem permissao' using errcode = '42501';
  end if;

  with vendas as (select * from public.vessel_vendas_dos_encontros(v_dias))
  select coalesce(json_agg(linha order by linha ->> 'codigo'), '[]'::json)
    into v_saida
    from (
      select json_build_object(
        'codigo', s.codigo,
        'nome', s.nome,
        'cidade', s.cidade,
        -- ⚠️ 24/09/2026: a etapa é uma linha de `vessel_stylist_etapas`.
        'etapa_id', s.etapa_id,
        'etapa', et.nome,
        'etapa_tipo', et.tipo,
        'etapa_ordem', et.ordem,
        -- ⚠️ 24/09/2026 (Private Edit só com liberada, e os motivos de saída).
        'etapa_libera_private_edit', et.libera_private_edit,
        'saida_motivo_id', case when et.tipo = 'saida' then sa.motivo_id end,
        'saida_motivo', case when et.tipo = 'saida' then ms.nome end,
        'saida_nota', case when et.tipo = 'saida' then sa.nota end,
        'praca_preview', s.praca_preview,
        -- ⚠️ TASK 5: a praça de CADASTRO da stylist (não mais o texto solto
        -- de `praca_preview`, que continua só como histórico do que a
        -- stylist escreveu). `loja_destino` é a loja que atende a praça —
        -- pode ser de outra cidade (Piracicaba → Campinas).
        'praca_id', pc.id,
        'praca_sigla', pc.sigla,
        'praca_nome', pc.nome,
        'loja_destino', pc.loja_destino,
        -- a edição em que ela está ATIVA agora (saiu_em is null) — nula se
        -- não estiver em nenhuma edição aberta/planejada no momento.
        'edicao_id', ed_atual.edicao_id,
        'ativa', s.ativa,
        'whatsapp', s.whatsapp,
        'instagram', s.instagram,
        'atuacao', s.atuacao,
        -- T11: a ficha operacional.
        'loja', s.loja,
        'origem_contato', s.origem_contato,
        'responsavel', s.responsavel,
        'prospectado_em', s.prospectado_em,
        'proxima_acao', s.proxima_acao,
        'proxima_acao_em', s.proxima_acao_em,
        'observacoes', s.observacoes,
        -- ⚠️ 24/09/2026: "sem contato ainda" — alguém vai completar.
        'sem_contato', s.sem_contato,
        -- ⚠️ 24/09/2026: a ativação é a da etapa (a mesma função do placar); o
        -- primeiro Private Edit agendado continua, com o nome dele.
        'ativada_em', public.vessel_stylist_ativada_em(s.id),
        'private_edit_agendado_em', s.ativada_em,
        'encontros_realizados', ee.realizados,
        'ultima_private_edit', ee.ultima,
        'proxima_data_permitida', ee.ultima + 45,
        'receita_dos_encontros', (select coalesce(sum(v.receita), 0) from vendas v
                                   where v.stylist_id = s.id),
        'contatos', (select count(*)::int from public.vessel_stylist_contatos c where c.stylist_id = s.id),
        'ultimo_contato_em', (select max(c.criado_em) from public.vessel_stylist_contatos c where c.stylist_id = s.id),
        'aberturas', (select count(*)::int from public.vessel_stylist_aberturas a
                       where a.codigo = s.codigo),
        'clientes', (select count(distinct o.pessoa_id)::int
                       from public.vessel_origens o where o.stylist_id = s.codigo),
        'pedidos', (select count(*)::int from public.vessel_atendimentos t
                     where not coalesce(t.teste, false)
                       and exists (select 1 from public.vessel_origens o
                                    where o.stylist_id = s.codigo
                                      and o.pessoa_id = t.pessoa_id)),
        'confirmados', (select count(*)::int from public.vessel_atendimentos t
                         where not coalesce(t.teste, false)
                           and t.status in ('confirmado', 'realizado', 'no_show')
                           and exists (select 1 from public.vessel_origens o
                                        where o.stylist_id = s.codigo
                                          and o.pessoa_id = t.pessoa_id)),
        'compareceram', (select count(*)::int from public.vessel_atendimentos t
                          where not coalesce(t.teste, false) and t.status = 'realizado'
                            and exists (select 1 from public.vessel_origens o
                                         where o.stylist_id = s.codigo
                                           and o.pessoa_id = t.pessoa_id)),
        'receita', (select coalesce(sum(coalesce(p.receita_liquida, p.total_corrigido, 0)), 0)
                      from public.vessel_pedidos p
                     where p.situacao_id = 9
                       and exists (select 1 from public.vessel_origens o
                                    where o.stylist_id = s.codigo and o.pessoa_id = p.pessoa_id)
                       and exists (select 1 from public.vessel_atendimentos t
                                    where t.pessoa_id = p.pessoa_id
                                      and not coalesce(t.teste, false)
                                      and t.status = 'realizado'
                                      and p.data_do_pedido
                                            between (coalesce(t.quando, t.criado_em)
                                                      at time zone 'America/Sao_Paulo')::date
                                                and (coalesce(t.quando, t.criado_em)
                                                      at time zone 'America/Sao_Paulo')::date
                                                    + v_dias)),
        'janela_de_venda_em_dias', v_dias
      ) as linha
      from public.vessel_stylists s
      join public.vessel_stylist_etapas et on et.id = s.etapa_id
      left join public.vessel_pracas pc on pc.id = s.praca_id
      left join lateral (
        select n.edicao_id from public.vessel_stylist_na_edicao n
         where n.stylist_id = s.id and n.saiu_em is null
         order by n.entrou_em desc limit 1
      ) ed_atual on true
      left join lateral public.vessel_stylist_saida_atual(s.id) sa on true
      left join public.vessel_stylist_motivos_de_saida ms on ms.id = sa.motivo_id
      cross join lateral (
        select count(*) filter (where e.status = 'realizado')::int as realizados,
               max(e.realizado_em) filter (where e.status = 'realizado') as ultima
          from public.vessel_private_edits e
         where e.stylist_id = s.id and not coalesce(e.teste, false)
           and not coalesce(e.arquivada, false)
      ) ee
      where not coalesce(s.teste, false)
        and (coalesce(p_incluir_desativadas, false) or coalesce(s.ativa, true))
        -- ⚠️ TASK 5: o recorte por praça e por edição — nulo passa tudo
        -- (nenhum recorte é o comportamento de hoje, preservado).
        and (p_praca_id is null or s.praca_id = p_praca_id)
        and (p_edicao_id is null or exists (
              select 1 from public.vessel_stylist_na_edicao n
               where n.stylist_id = s.id and n.edicao_id = p_edicao_id))
    ) as linhas;

  -- ⚠️ QUEM NÃO TEM O STYLIST CIRCLE (hoje: só o Material Gráfico, que é só
  -- leitura e mostra os QR) recebe SÓ o que o QR precisa: código, nome,
  -- cidade, se está ativa e a etapa (nome + a marca de que libera o Private
  -- Edit — é ela que decide se o QR aparece). WhatsApp, Instagram,
  -- observações, responsável, próxima ação e os números NÃO saem daqui para
  -- ele. Lista do que o Material Gráfico lê: itemDaStylist(), em
  -- src/ferramentas/comercial-vessel/material-grafico-regras.js. A ordem é a mesma.
  if not public.vessel_pode('atendimentos.stylist-circle', 'ver') then
    select coalesce(json_agg(json_build_object(
             'codigo', x.l -> 'codigo',
             'nome', x.l -> 'nome',
             'cidade', x.l -> 'cidade',
             'ativa', x.l -> 'ativa',
             'etapa', x.l -> 'etapa',
             'etapa_libera_private_edit', x.l -> 'etapa_libera_private_edit') order by x.n), '[]'::json)
      into v_saida
      from json_array_elements(v_saida) with ordinality as x(l, n);
  end if;

  return v_saida;
end;
$function$;

-- ⚠️ O DROP TEM DE ESTAR NA MESMA MIGRATION DO CREATE ACIMA — senão o
-- PostgREST fica com duas funções `vessel_rastreio_dos_stylists` (a de 2 e a
-- de 4 parâmetros) e não sabe qual escolher para uma chamada por nome.
drop function if exists public.vessel_rastreio_dos_stylists(integer, boolean);

-- ── 11. o placar da edição (Task 5) ──────────────────────────────────────────
-- ⚠️ CONTA SOBRE AS STYLISTS LIGADAS À EDIÇÃO por `vessel_stylist_na_edicao` —
-- TODAS as linhas, sem filtrar por `saiu_em` (a MESMA regra de
-- `vessel_edicoes_listar`, seção 9): é isso que CONGELA o placar de uma
-- edição encerrada. A tarefa anterior já teve um defeito Crítico exatamente
-- aqui (a conta da tela zerava a edição encerrada) — o aplicador prova que
-- este placar não repete o erro, e que o `where` desta CTE não é decoração
-- (mutação: trocar por `1=1` faz Limeira contar stylist de Campinas).
--
-- As ETAPAS contam a etapa ATUAL da stylist ("quem está nela hoje" — o funil
-- é vivo, mesmo depois da edição encerrar; encerrar uma edição não move
-- ninguém de etapa). TODAS as etapas ativas aparecem, na ordem — inclusive as
-- de zero — porque o número de etapas não é fixo no código (hoje são 8; se
-- alguém cadastrar uma nona, este placar cresce sozinho).
--
-- Os ENCONTROS são os `vessel_private_edits` da PRAÇA da edição cujo `quando`
-- cai na janela dela (`comeca_em` até `termina_em`, ou sem fim enquanto ela
-- não tem data de término) — pela PRAÇA E DATA, não pelos membros da turma:
-- um encontro fora da janela de qualquer edição não some da tabela, só fica
-- fora desta conta.
--
-- ⚠️ SEM RECEITA: nada de `receita`/`vendas`/`compradoras`/`ticket` — o
-- panorama de compras está congelado (decisão do dono: 0 de 481 pedidos
-- ligados a pessoa) e zero na tela mente. O aplicador reprova se qualquer
-- uma dessas chaves aparecer na resposta.
create or replace function public.vessel_placar_da_edicao(p_edicao_id bigint)
returns json
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_ed    public.vessel_stylist_circle_edicoes%rowtype;
  v_ate   date;
  v_saida json;
begin
  if not public.vessel_pode('atendimentos.stylist-circle', 'ver') then
    raise exception 'sem permissao' using errcode = '42501';
  end if;

  select * into v_ed from public.vessel_stylist_circle_edicoes where id = p_edicao_id;
  if v_ed.id is null then
    raise exception 'edicao nao encontrada' using errcode = 'P0002';
  end if;
  -- ⚠️ SEM FIM ESCOLHIDO, A JANELA NÃO TEM FIM — a mesma regra de
  -- `vessel_numeros_do_stylist_circle` para `p_ate` nulo.
  v_ate := coalesce(v_ed.termina_em, 'infinity'::date);

  with
  -- ⚠️ O CONGELAMENTO mora AQUI: todas as linhas desta edição, sem filtrar
  -- por `saiu_em`. Trocar este `where` por `1=1` é a mutação que o aplicador
  -- prova reprovar — sem ele, Limeira contaria stylist de Campinas.
  turma_ids as (
    select distinct n.stylist_id from public.vessel_stylist_na_edicao n
     where n.edicao_id = p_edicao_id
  ),
  sty as (
    select s.*, public.vessel_stylist_ativada_em(s.id) as ativou
      from public.vessel_stylists s
     where s.id in (select stylist_id from turma_ids)
  ),
  -- os encontros são da PRAÇA da edição, na janela dela — não dependem de
  -- quem está na turma (um encontro é da praça e da data, não da stylist).
  ev as (
    select e.*
      from public.vessel_private_edits e
     where not coalesce(e.teste, false) and not coalesce(e.arquivada, false)
       and e.praca_id = v_ed.praca_id
       and (e.quando at time zone 'America/Sao_Paulo')::date between v_ed.comeca_em and v_ate
  ),
  conv as (
    select t.id, t.pessoa_id, t.status, e.codigo, e.status as status_do_encontro,
           public.vessel_situacao_do_convite(t.status, t.rsvp, t.convite_enviado_em,
                                             e.quando, e.status) as situacao
      from public.vessel_atendimentos t
      join ev e on e.codigo = t.evento_codigo
     where not coalesce(t.teste, false)
  ),
  -- os realizados DA TURMA (para as taxas): o 1º e o 2º encontro realizado de
  -- cada stylist desta edição, dentro da janela dela.
  realizados as (
    select e.stylist_id, e.realizado_em,
           row_number() over (partition by e.stylist_id order by e.realizado_em, e.id) as n
      from ev e
     where e.status = 'realizado' and e.stylist_id in (select stylist_id from turma_ids)
  ),
  -- a turma, passo a passo — cada passo DENTRO do anterior: a MESMA turma em
  -- cima e embaixo das taxas de t11-regras.js (taxasDoPlacar).
  turma as (
    select s.id,
           (s.ativou is not null) as ativou,
           exists (select 1 from ev e where e.stylist_id = s.id and e.status <> 'em_planejamento') as agendou,
           exists (select 1 from realizados r where r.stylist_id = s.id and r.n = 1) as realizou
      from sty s
  )
  select json_build_object(
    'edicao', json_build_object(
      'id', v_ed.id, 'praca_id', v_ed.praca_id, 'numero', v_ed.numero, 'nome', v_ed.nome,
      'comeca_em', v_ed.comeca_em, 'termina_em', v_ed.termina_em, 'situacao', v_ed.situacao),
    'etapas', (select coalesce(json_agg(json_build_object(
                 'id', et.id, 'nome', et.nome, 'ordem', et.ordem, 'tipo', et.tipo,
                 'stylists', (select count(*)::int from sty s where s.etapa_id = et.id))
               order by et.ordem), '[]'::json)
               from public.vessel_stylist_etapas et where et.ativa),
    'prospectadas', (select count(*)::int from sty),
    'prospectadas_ja_ativadas', (select count(*)::int from turma where ativou),
    'ativadas', (select count(*)::int from turma where ativou),
    'com_private_edit_agendado', (select count(*)::int from turma where agendou),
    'com_private_edit_realizado', (select count(*)::int from turma where realizou),
    'recorrentes_no_periodo', (select count(*)::int from realizados where n = 2),
    'encontros_agendados', (select count(*)::int from ev where status <> 'em_planejamento'),
    'encontros_realizados', (select count(*)::int from ev where status = 'realizado'),
    'encontros_cancelados', (select count(*)::int from ev where status in ('cancelado', 'nao_realizado')),
    'convidadas', (select count(*)::int from conv),
    'confirmadas', (select count(*)::int from conv
                     where situacao in ('confirmada', 'presente', 'nao_compareceu')),
    'confirmadas_em_realizados', (select count(*)::int from conv
                     where situacao in ('confirmada', 'presente', 'nao_compareceu')
                       and status_do_encontro = 'realizado'),
    'presentes', (select count(*)::int from conv where status = 'realizado'),
    'presentes_em_realizados', (select count(*)::int from conv
                     where status = 'realizado' and status_do_encontro = 'realizado')
  ) into v_saida;

  return v_saida;
end;
$function$;

-- ── 12. as portas ────────────────────────────────────────────────────────────
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
    'public.vessel_edicao_incluir_stylist(text, bigint)',
    'public.vessel_rastreio_dos_stylists(integer, boolean, bigint, bigint)',
    'public.vessel_placar_da_edicao(bigint)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
