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
-- ⚠️ RODADA 1 DE CONSERTO (MENOR 3): faltava — `ev`, no placar da edição
-- (seção 11), filtra `vessel_private_edits` por `praca_id`.
create index if not exists vessel_private_edits_praca_idx on public.vessel_private_edits (praca_id);

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
-- lista fechada de `vessel_pode` e no catálogo com `ver`+`editar`).
-- ⚠️ REVISÃO FINAL (MENOR 2): este bloco prometia que "uma tarefa futura
-- recorta chaves próprias" — A SEÇÃO 14 DESTE MESMO ARQUIVO JÁ RECORTOU
-- (`atendimentos.pracas` e `atendimentos.edicoes`, com a pré-concessão
-- aditiva para quem já tinha a mãe). O que vale no fim da migration é a
-- seção 14; estas definições aqui são a Task 4 preservada ÍNTEGRA, para que
-- a ÚNICA diferença entre as duas cópias seja a linha do `vessel_pode` — o
-- invariante que o aplicador confere por diff.
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
  -- ⚠️ REVISÃO FINAL (IMPORTANTE 6): a ADOÇÃO — ver o bloco no fim.
  v_situacao text;
  v_stylist  bigint;
  v_adotadas int := 0;
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
    v_id := v_dono.id;
    v_situacao := 'ja_vinculada';
  else
    insert into public.vessel_praca_cidades (praca_id, cidade, cidade_chave)
    values (p_praca_id, v_cidade, v_chave)
    returning id into v_id;
    v_situacao := 'ok';
  end if;

  -- ⚠️ REVISÃO FINAL (IMPORTANTE 6): A ADOÇÃO. Até aqui vincular a cidade
  -- criava SÓ a linha do cadastro e não movia ninguém — a pendência "N
  -- stylists sem praça", que a barra mostra nas duas telas grandes, NÃO SE
  -- RESOLVIA pelo cadastro de Praças. O backfill da seção 8 roda uma vez só,
  -- e `vessel_stylist_definir_praca` não tem chamador em tela nenhuma: quem
  -- estava sem praça ficava sem praça para sempre, e a única saída era abrir
  -- a ficha de uma em uma.
  --
  -- O critério é O MAIS ESTREITO QUE RESOLVE: só quem está SEM PRAÇA
  -- (`praca_id is null`) e cuja cidade casa com A CIDADE QUE ACABOU DE SER
  -- VINCULADA, pela MESMA chave achatada (`vessel_achatar_cidade`) do resto
  -- do arquivo. Ninguém TROCA de praça por aqui — vincular "Campinas" à
  -- praça X não arrasta quem já está em CPS. Stylist de teste fica de fora,
  -- pelo critério único da casa.
  --
  -- Rodar de novo com a cidade JÁ vinculada (`ja_vinculada`) também adota —
  -- é de propósito: é o botão que o dono aperta quando a pendência reaparece,
  -- e uma ação que "não faz nada da segunda vez" seria uma pegadinha.
  --
  -- ⚠️ `adotadas` VOLTA NA RESPOSTA: número que a tela escreve ("3 stylists
  -- de Limeira passaram a ser desta praça"). Movimento calado em dado de
  -- gente é o que esta migration inteira existe para acabar.
  for v_stylist in
    select s.id from public.vessel_stylists s
     where s.praca_id is null
       and not coalesce(s.teste, false)
       and public.vessel_achatar_cidade(s.cidade) = v_chave
  loop
    update public.vessel_stylists set praca_id = p_praca_id, atualizado_em = now() where id = v_stylist;
    -- e entra na edição ABERTA da praça, pela MESMA função das outras portas.
    -- `p_fechar_antigo` fica `false`: quem estava SEM praça não tem vínculo
    -- "da praça antiga" para fechar — e uma inclusão feita à mão numa edição
    -- qualquer não pode ser desfeita por um cadastro de cidade.
    perform public.vessel_stylist_sincronizar_edicao(v_stylist, p_praca_id, false);
    v_adotadas := v_adotadas + 1;
  end loop;

  return json_build_object('ok', true, 'situacao', v_situacao, 'id', v_id, 'adotadas', v_adotadas);
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

  -- ⚠️ TASK 11 RODADA 1 DE CONSERTO (CRÍTICO 1): `p_fechar_antigo => true` —
  -- se ela já estava numa edição ABERTA de outra praça, fecha esse vínculo
  -- antes de abrir o novo (senão contaria em duas edições abertas ao mesmo
  -- tempo). Tirar a praça (`p_praca_id` nulo) continua NÃO desfazendo
  -- vínculo nenhum — `vessel_stylist_sincronizar_edicao` nem chega a olhar
  -- vínculo com `p_praca_id` nulo.
  perform public.vessel_stylist_sincronizar_edicao(v_id, p_praca_id, true);

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
             -- ⚠️ REVISÃO FINAL (IMPORTANTE 1): O MESMO CRITÉRIO DO PLACAR,
             -- letra por letra — `turma_ids` + `sty` de `vessel_placar_da_
             -- edicao`. Os DOIS números aparecem JUNTOS na tela (o bloco
             -- "praças com edição aberta" de `placar-do-stylist-circle.vue`
             -- mostra `edicao.stylists` ao lado do placar da mesma edição):
             -- dois jeitos de contar a MESMA edição é o defeito clássico de
             -- "dois lugares para a mesma verdade".
             --
             --   edição ABERTA/planejada → quem está dentro AGORA
             --                              (`saiu_em is null`);
             --   edição ENCERRADA        → a turma CONGELADA (todas as
             --                              linhas, que o encerramento fechou
             --                              no mesmo instante).
             --
             -- ⚠️ O COMENTÁRIO ANTIGO AQUI MENTIA: dizia "enquanto a edição
             -- está planejada/aberta ninguém tem `saiu_em` ainda". Deixou de
             -- ser verdade quando `vessel_stylist_sincronizar_edicao` passou
             -- a FECHAR o vínculo de quem muda de praça com a edição de
             -- origem ainda aberta — a partir daí esta conta inchava com
             -- quem já tinha saído, e o placar ao lado (que filtra) dizia
             -- outro número.
             -- ⚠️ TASK 6 RODADA 1 DE CONSERTO (IMPORTANTE 3): `teste` — e a
             -- REVISÃO FINAL acrescentou `ativa`, pelo mesmo motivo: o placar
             -- filtra os dois (`sty`), e quem está lado a lado tem de contar
             -- igual.
             'stylists', (select count(*)::int from public.vessel_stylist_na_edicao n
                           join public.vessel_stylists s on s.id = n.stylist_id
                           where n.edicao_id = e.id and not coalesce(s.teste, false)
                             and coalesce(s.ativa, true)
                             and (e.situacao = 'encerrada' or n.saiu_em is null)),
             -- ⚠️ TASK 6 RODADA 1 DE CONSERTO (IMPORTANTE 3): quantas SERIAM
             -- levadas se a edição fosse encerrada agora — o MESMO critério
             -- de `vessel_edicao_encerrar` (vínculo ainda ativo, `saiu_em is
             -- null`, da stylist que ainda não ativou). Numa edição já
             -- encerrada dá sempre 0 (o congelamento já fechou todos os
             -- vínculos) — não é um teto, é o número real. A tela usa este
             -- campo para dizer "N serão levadas" ANTES de confirmar, em vez
             -- de "até N" (o total da edição, que mentia numa edição madura
             -- onde quase todas já ativaram).
             -- ⚠️ REVISÃO FINAL (MENOR 3): "ativada" passa a ser
             -- `vessel_stylist_ativada_em()` — A DEFINIÇÃO CANÔNICA da casa
             -- (a primeira chegada numa etapa que liberava Private Edit;
             -- sem ela, o primeiro Private Edit agendado). Convivião até
             -- aqui com a coluna CRUA `vessel_stylists.ativada_em`, que
             -- desde 24/09/2026 NEM é mais a ativação (é "Private Edit
             -- agendado"): a tela de Edições dizia "N não ativaram" por uma
             -- conta e o placar ao lado dizia "ativadas" por outra. Um
             -- critério só, e é o mesmo de `vessel_edicao_encerrar` — as
             -- duas contas têm de andar juntas para a tela não prometer N e
             -- o banco levar outro número.
             'nao_ativadas', (select count(*)::int from public.vessel_stylist_na_edicao n
                           join public.vessel_stylists s on s.id = n.stylist_id
                           where n.edicao_id = e.id and n.saiu_em is null
                             and public.vessel_stylist_ativada_em(s.id) is null
                             and not coalesce(s.teste, false)))
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
  v_ed        public.vessel_stylist_circle_edicoes%rowtype;
  v_incluidas int := 0;
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
    return json_build_object('ok', true, 'situacao', 'sem_mudanca', 'incluidas', 0);
  end if;
  if exists (select 1 from public.vessel_stylist_circle_edicoes
              where praca_id = v_ed.praca_id and situacao = 'aberta' and id <> p_id) then
    return json_build_object('ok', false, 'situacao', 'ja_tem_aberta');
  end if;
  update public.vessel_stylist_circle_edicoes set situacao = 'aberta' where id = p_id;

  -- ⚠️ TASK 11: "edição = a rodada daquela praça" (decisão do dono) — o
  -- vínculo é AUTOMÁTICO, não uma escolha manual um a um. Ao abrir, toda
  -- stylist ATIVA e NÃO-teste da praça que ainda não tem NENHUMA linha com
  -- esta edição entra nela — sem isto o placar por edição nascia zerado para
  -- sempre (nenhuma tela chamava `vessel_edicao_incluir_stylist`), calado.
  -- `not exists` na CHAVE INTEIRA (não só `saiu_em is null`): uma stylist
  -- incluída à mão (`vessel_edicao_incluir_stylist`) ANTES de abrir a edição
  -- (a 'planejada' aceita incluir) não pode virar linha duplicada aqui.
  insert into public.vessel_stylist_na_edicao (stylist_id, edicao_id)
  select s.id, p_id
    from public.vessel_stylists s
   where s.praca_id = v_ed.praca_id
     and coalesce(s.ativa, true)
     and not coalesce(s.teste, false)
     and not exists (select 1 from public.vessel_stylist_na_edicao n
                       where n.stylist_id = s.id and n.edicao_id = p_id)
  on conflict (stylist_id, edicao_id) do nothing;
  get diagnostics v_incluidas = row_count;

  return json_build_object('ok', true, 'situacao', 'ok', 'incluidas', v_incluidas);
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
  -- ⚠️ TASK 6 RODADA 2 DE CONSERTO (I3 incompleto): `and not coalesce(s.teste,
  -- false)` — o MESMO critério de `nao_ativadas` (vessel_edicoes_listar,
  -- seção 14.2). Sem isto, uma stylist de teste não-ativada na edição contava
  -- como "não vai" para `nao_ativadas` (que já filtrava) mas era LEVADA de
  -- verdade aqui (que não filtrava) — a tela prometia N e o banco levava N+1,
  -- calado. Critério único, o de fora: stylist de teste não conta e não é
  -- levada — nem no congelamento, nem na inclusão no destino.
  -- ⚠️ EFEITO COLATERAL ACEITO (decisão do dono, Rodada 3): o vínculo de uma
  -- stylist de teste que estava na edição na hora do encerramento fica com
  -- `saiu_em` nulo PARA SEMPRE — a função simplesmente não a toca, nem para
  -- fechar nem para levar. Não aparece em nenhuma conta da tela (`stylists`/
  -- `nao_ativadas` já filtram teste) — é o preço do critério único "stylist
  -- de teste não conta e não é levada".
  -- ⚠️ REVISÃO FINAL (MENOR 3): quem "não ativou" é quem
  -- `vessel_stylist_ativada_em()` diz que não ativou — A DEFINIÇÃO
  -- CANÔNICA (a mesma de `vessel_placar_da_edicao` e de `nao_ativadas` em
  -- `vessel_edicoes_listar`), nunca mais a coluna crua `s.ativada_em`, que
  -- desde 24/09/2026 quer dizer outra coisa ("primeiro Private Edit
  -- agendado"). A canônica é um `coalesce` que JÁ INCLUI a coluna crua como
  -- último recurso, então o conjunto de quem é levada só pode DIMINUIR:
  -- ninguém que a conta antiga deixava ficar passa a ser levada.
  with fechados as (
    update public.vessel_stylist_na_edicao n
       set saiu_em = now(), etapa_ao_sair = s.etapa_id
      from public.vessel_stylists s
     where n.stylist_id = s.id and n.edicao_id = p_id and n.saiu_em is null
       and not coalesce(s.teste, false)
    returning n.stylist_id, public.vessel_stylist_ativada_em(s.id) as ativou, s.teste
  )
  -- ⚠️ RODADA 1 DE CONSERTO (CRÍTICO 2): `on conflict ... do nothing` — a
  -- stylist pode já ter um vínculo (fechado ou não) na edição de destino
  -- (ex.: foi incluída nas duas edições antes de a primeira ser encerrada).
  -- Sem isto, a unique `(stylist_id, edicao_id)` estourava 23505 CRU (a tela
  -- recebe erro sem motivo escrito) e — pior — como um erro dentro do bloco
  -- aborta a transação INTEIRA nesta base, o encerramento nem chegava a
  -- congelar ninguém. `get diagnostics` conta só quem foi REALMENTE inserida
  -- (a que deu conflito não entra em `levadas`).
  -- ⚠️ TASK 6 RODADA 2 DE CONSERTO: `not coalesce(f.teste, false)` de novo
  -- aqui — `fechados` já filtra teste (acima), então esta linha nunca
  -- deveria ter nada a barrar; é defesa em profundidade (o pedido explícito
  -- da revisão), não decoração: se um dia o filtro de `fechados` for
  -- afrouxado sem querer, este é quem segura.
  insert into public.vessel_stylist_na_edicao (stylist_id, edicao_id)
  select f.stylist_id, p_levar_para from fechados f
   where f.ativou is null and p_levar_para is not null and not coalesce(f.teste, false)
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
  -- ⚠️ REVISÃO FINAL (CRÍTICO 1, irmão do `do update` de
  -- `vessel_stylist_sincronizar_edicao`): a conferência acima só olha
  -- `saiu_em is null`, então incluir quem JÁ SAIU desta edição (mudou de
  -- praça, ou foi levada para a seguinte e voltou) chegava aqui e estourava
  -- `23505` CRU na unique `(stylist_id, edicao_id)` — e nesta base um erro
  -- assim derruba a transação INTEIRA (a mesma lição do Crítico 2 em
  -- `vessel_edicao_encerrar`). Reabrir a linha é exatamente o que a tela
  -- pediu ("inclua esta stylist"), e a edição encerrada já foi barrada lá
  -- em cima — nada de congelado é reaberto por aqui.
  insert into public.vessel_stylist_na_edicao (stylist_id, edicao_id) values (v_stylist_id, p_edicao_id)
  on conflict (stylist_id, edicao_id) do update set saiu_em = null, etapa_ao_sair = null;
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
        -- ⚠️ RODADA 1 DE CONSERTO (MENOR 4): `edicao_atual_id`, não
        -- `edicao_id` — ao lado de um PARÂMETRO `p_edicao_id` que quer dizer
        -- outra coisa (o recorte do filtro), o nome igual seria lido errado
        -- por quem construir a tela. É a edição em que ela está ATIVA agora
        -- (saiu_em is null) — nula se não estiver em nenhuma edição
        -- aberta/planejada no momento.
        'edicao_atual_id', ed_atual.edicao_id,
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
-- ⚠️ ESTA FUNÇÃO É DEFINIDA UMA VEZ SÓ, AQUI (REVISÃO FINAL, MENOR 1). Até a
-- revisão ela nascia duas vezes no mesmo arquivo — aqui e numa "seção 15" no
-- fim —, com o corpo IDÊNTICO letra por letra. Cópia que só existe para
-- divergir depois: já divergiu uma vez (os números do IMPORTANTE 4 entraram
-- numa e não na outra). O que aquela seção explicava está incorporado abaixo.
--
-- ⚠️ CONTA SOBRE AS STYLISTS LIGADAS À EDIÇÃO por `vessel_stylist_na_edicao`,
-- pelo MESMO critério de `vessel_edicoes_listar.stylists` (seções 9 e 14.2):
-- edição ABERTA conta quem está dentro AGORA (`saiu_em is null`); edição
-- ENCERRADA conta a turma CONGELADA (todas as linhas, que o encerramento
-- fechou no mesmo instante). A tarefa anterior já teve um defeito Crítico
-- exatamente aqui (a conta da tela zerava a edição encerrada) — o aplicador
-- prova que este placar não repete o erro, e que o `where` desta CTE não é
-- decoração (mutação: trocar por `1=1` faz Limeira contar stylist de Campinas).
--
-- ⚠️ OS DOIS NÚMEROS DAS TAXAS (intervalo médio entre encontros e contatos até
-- ativar) são os mesmos do placar MENSAL (`vessel_numeros_do_stylist_circle`):
-- a edição TEM janela (`comeca_em` … `coalesce(termina_em, 'infinity')`), então
-- a CTE `realizados` traz `row_number()` E `lag()`. "Contatos até ativar" usa
-- `sty.ativou` (a MESMA `vessel_stylist_ativada_em()` de "ativadas") — NUNCA a
-- coluna crua `vessel_stylists.ativada_em`, senão dois números do MESMO placar
-- falariam de duas "ativações" diferentes.
--
-- ⚠️ `sty` filtra `teste` E `ativa`: uma stylist desativada que está na edição
-- não pode contar aqui e sumir do quadro e da lista (`vessel_rastreio_dos_
-- stylists` filtra `ativa` por padrão) — o placar é exatamente o que se compara
-- coluna a coluna com o quadro, e os dois têm de fechar.
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
  -- ⚠️ O CONGELAMENTO mora AQUI: numa edição ENCERRADA, todas as linhas dela
  -- contam, sem filtrar por `saiu_em` — o placar não zera ao encerrar.
  -- Trocar este `where` por `1=1` é a mutação que o aplicador prova
  -- reprovar — sem ele, Limeira contaria stylist de Campinas.
  --
  -- ⚠️ RODADA 1 DE CONSERTO (CRÍTICO 1): numa edição ainda ABERTA, uma linha
  -- com `saiu_em` preenchido é gente que MUDOU DE PRAÇA (ver
  -- `vessel_stylist_sincronizar_edicao`) — ela não pode continuar contando
  -- na edição de origem enquanto essa segue aberta, senão conta em DUAS
  -- edições abertas ao mesmo tempo. Só em `encerrada` o congelamento vale.
  turma_ids as (
    select distinct n.stylist_id from public.vessel_stylist_na_edicao n
     where n.edicao_id = p_edicao_id
       and (v_ed.situacao = 'encerrada' or n.saiu_em is null)
  ),
  -- ⚠️ RODADA 1 DE CONSERTO (MENOR 1): filtra `teste` igual às irmãs
  -- (`vessel_rastreio_dos_stylists`, `vessel_numeros_do_stylist_circle`) —
  -- sem isto uma stylist de teste entraria no placar e sumiria da lista
  -- embaixo, e o funil não fecharia com a lista.
  sty as (
    select s.*, public.vessel_stylist_ativada_em(s.id) as ativou
      from public.vessel_stylists s
     where s.id in (select stylist_id from turma_ids)
       and not coalesce(s.teste, false)
       -- ⚠️ RODADA 1 DE CONSERTO (IMPORTANTE 5): o mesmo tratamento de
       -- `teste`, agora para `ativa` — sem isto uma stylist desativada conta
       -- no placar e some do quadro/lista, e os dois deixam de fechar.
       and coalesce(s.ativa, true)
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
           row_number() over (partition by e.stylist_id order by e.realizado_em, e.id) as n,
           -- ⚠️ RODADA 1 DE CONSERTO (IMPORTANTE 4): o `lag()` que faltava —
           -- a MESMA conta de `vessel_numeros_do_stylist_circle`.
           e.realizado_em - lag(e.realizado_em) over (partition by e.stylist_id
                                                      order by e.realizado_em, e.id) as intervalo
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
                     where status = 'realizado' and status_do_encontro = 'realizado'),
    -- ⚠️ RODADA 1 DE CONSERTO (IMPORTANTE 4): os dois números que voltam.
    -- `intervalos`/`intervalo_medio_em_dias` — sobre TODOS os realizados da
    -- praça na janela da edição (não filtra pela turma congelada: um
    -- encontro é da praça e da data, a mesma regra de `ev`/`conv` acima).
    'intervalos', (select count(*)::int from realizados where intervalo is not null),
    'intervalo_medio_em_dias', (select round(avg(intervalo)::numeric, 1) from realizados
                                 where intervalo is not null),
    -- `contatos_ate_ativar`/`stylists_com_contatos_ate_ativar` — sobre a
    -- turma (`sty`) que já ativou, pela MESMA ativação que o resto desta
    -- função usa (`sty.ativou`, não a coluna crua).
    'contatos_ate_ativar', (select round(avg(n)::numeric, 1) from (
        select (select count(*) from public.vessel_stylist_contatos c
                 where c.stylist_id = s.id and c.criado_em < s.ativou) as n
          from sty s where s.ativou is not null) x),
    'stylists_com_contatos_ate_ativar', (select count(*)::int from sty s where s.ativou is not null)
  ) into v_saida;

  return v_saida;
end;
$function$;

-- ── 12. RODADA 1 DE CONSERTO: a praça deixa de ser lista fechada no código ───
-- A revisão achou (e a medição em `pg_proc` confirmou) que QUATRO portas
-- ainda cravavam `('CPS','SAO','SBO','BSB')` no código:
-- `vessel_criar_private_edit`, `vessel_stylist_criar`, `vessel_stylist_editar`
-- e `vessel_pedido_do_stylist`. Consequência prática: pela tela, ninguém
-- consegue cadastrar uma stylist nem marcar um encontro em Limeira ou
-- Piracicaba — as 36 stylists de lá entraram por migration, não pela tela; e
-- são exatamente o exemplo deste trabalho inteiro. Pior: `vessel_criar_
-- private_edit` nunca gravava `praca_id` — só o texto —, então todo Private
-- Edit novo nascia fora do `ev` do placar da edição (seção 11): os números de
-- encontro ficavam zerados para sempre, sem erro nenhum aparecendo.
--
-- O CONSERTO, nas quatro: a validação vira uma CONSULTA ao cadastro
-- (`vessel_pracas`, sigla + `ativa`) — nunca mais uma lista escrita no
-- código, que é justamente o que este trabalho existe para matar. Recusa com
-- `situacao => 'praca_invalida'` (NUNCA `CHECK`: constraint estourando
-- derruba a transação INTEIRA nesta base — a mesma lição da seção 9). E, onde
-- a tabela tem a coluna, grava `praca_id` JUNTO com o texto — o texto
-- continua sendo gravado para a Central que está no ar não quebrar.
create or replace function public.vessel_praca_id_ativa(p_sigla text)
returns bigint
language sql
stable
set search_path to 'public'
as $$
  select id from public.vessel_pracas
   where sigla = upper(nullif(trim(coalesce(p_sigla, '')), '')) and ativa;
$$;
-- ⚠️ SEM GRANT A `authenticated`: só é chamada de DENTRO de outra função
-- `security definer` (o mesmo padrão de `vessel_codigo_de_evento_usado`, na
-- migration do código do encontro) — não é porta própria.
revoke all on function public.vessel_praca_id_ativa(text) from public, anon, authenticated;

-- ⚠️ REVISÃO FINAL (IMPORTANTE 4): A PRAÇA SAI DA CIDADE quando ninguém
-- escolheu a praça. A seção 8 faz EXATAMENTE esta conta uma vez, no backfill
-- — mas só uma vez, e só para quem já existia. Quem se inscrevia pela landing
-- page sem praça (o formulário público não pergunta) nascia com `praca_id`
-- nulo: fora de toda edição, fora de todo placar, sem erro nenhum aparecendo.
-- Hoje isso ainda não morde (nenhuma das 63 veio da LP, medido em
-- 25/09/2026), e é exatamente por isso que se conserta agora: é para o
-- programa crescer.
--
-- A conta é A MESMA da seção 8 e a MESMA do front (`vessel_achatar_cidade` ⇔
-- `achatarCidade`): a chave achatada da cidade contra `vessel_praca_cidades`.
-- Cidade que NÃO CASA continua devolvendo NULO — pendência à vista na tela,
-- nunca um chute de qual praça seria ("Limeira / Piracicaba" é esse caso, de
-- propósito). Praça DESATIVADA também não serve, pelo mesmo critério de
-- `vessel_praca_id_ativa`.
create or replace function public.vessel_praca_id_da_cidade(p_cidade text)
returns bigint
language sql
stable
set search_path to 'public'
as $$
  select c.praca_id
    from public.vessel_praca_cidades c
    join public.vessel_pracas p on p.id = c.praca_id
   where p.ativa
     and c.cidade_chave = public.vessel_achatar_cidade(p_cidade)
     and public.vessel_achatar_cidade(p_cidade) <> '';
$$;
-- ⚠️ SEM GRANT A `authenticated`: mesmo padrão de `vessel_praca_id_ativa`.
revoke all on function public.vessel_praca_id_da_cidade(text) from public, anon, authenticated;

-- ⚠️ TASK 11 RODADA 1 DE CONSERTO — MENOR (b): as QUATRO portas que gravam a
-- praça de uma stylist (`vessel_stylist_criar`, `vessel_stylist_definir_praca`,
-- `vessel_stylist_editar`, `vessel_pedido_do_stylist`) tinham o MESMO critério
-- de "vincular à edição aberta" escrito em 3 formatos diferentes — e uma
-- delas (`vessel_pedido_do_stylist`, a porta PÚBLICA) nem tinha o bloco
-- (IMPORTANTE 2). Uma função só, chamada pelas quatro.
--
-- ⚠️ CRÍTICO 1: quando a stylist JÁ estava numa edição ABERTA de OUTRA praça
-- (mudou de cidade, por exemplo) e `p_fechar_antigo` é `true`, fecha esse
-- vínculo (`saiu_em = now()`) ANTES de abrir o novo — sem isto ela contava
-- na MESMA hora em DUAS edições abertas (o placar de uma E o de outra, os
-- dois "de verdade"), e a soma das praças passava a dar mais gente do que
-- existe. Edição ENCERRADA nunca é tocada aqui: o histórico é quem congela
-- (`vessel_edicao_encerrar`), não esta sincronização — só existe algo a
-- "fechar por mudança de praça" numa edição que ainda está aberta; a
-- encerrada já fechou tudo sozinha na hora de encerrar.
-- `p_fechar_antigo` é `false` por padrão (quem está NASCENDO —
-- `vessel_stylist_criar`, e o ramo de inscrição nova de
-- `vessel_pedido_do_stylist` — não tem vínculo antigo nenhum para fechar).
create or replace function public.vessel_stylist_sincronizar_edicao(
  p_stylist_id bigint, p_praca_id bigint, p_fechar_antigo boolean default false)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_praca_id is null then
    return;
  end if;

  if p_fechar_antigo then
    update public.vessel_stylist_na_edicao n
       set saiu_em = now(), etapa_ao_sair = s.etapa_id
      from public.vessel_stylist_circle_edicoes ed, public.vessel_stylists s
     where n.edicao_id = ed.id and n.stylist_id = s.id
       and n.stylist_id = p_stylist_id and n.saiu_em is null
       and ed.situacao = 'aberta' and ed.praca_id <> p_praca_id;
  end if;

  -- vincula à edição ABERTA da praça nova, se houver — sempre com o MESMO
  -- critério de elegibilidade (ativa, não-teste), mesmo quando quem chama
  -- (`vessel_stylist_criar`) sabe que a stylist recém-criada já satisfaz os
  -- dois por construção: um critério só, nunca reescrito.
  --
  -- ⚠️ REVISÃO FINAL (CRÍTICO 1) — `do update`, NUNCA `do nothing`: o caso do
  -- RETORNO. Dois cliques na ficha: a stylist está em LIM·Ed1 (aberta) →
  -- troca para CPS (o vínculo de LIM fecha com `saiu_em`, abre um em CPS) →
  -- percebe o engano e VOLTA para LIM. O insert de LIM colide com a linha
  -- FECHADA, e com `do nothing` era DESCARTADO: ela ficava com
  -- `praca_id = LIM` e NENHUM vínculo aberto — o placar não a contava e a
  -- lista embaixo continuava mostrando, calado. Reabrir a linha (`saiu_em`/
  -- `etapa_ao_sair` de volta a nulo) é o conserto: o `select` acima só
  -- alcança edição `aberta`, então nada de encerrado é reaberto por aqui.
  -- Quem já tinha o vínculo ABERTO não muda de nada (os dois campos já são
  -- nulos) e continua sem duplicar.
  insert into public.vessel_stylist_na_edicao (stylist_id, edicao_id)
  select p_stylist_id, ed.id
    from public.vessel_stylist_circle_edicoes ed
   where ed.praca_id = p_praca_id and ed.situacao = 'aberta'
     and exists (select 1 from public.vessel_stylists s
                  where s.id = p_stylist_id and coalesce(s.ativa, true) and not coalesce(s.teste, false))
   limit 1
  on conflict (stylist_id, edicao_id) do update set saiu_em = null, etapa_ao_sair = null;
end;
$$;
-- ⚠️ SEM GRANT A `authenticated`: mesmo padrão de `vessel_praca_id_ativa`,
-- acima — só é chamada de DENTRO de outra função `security definer`.
revoke all on function public.vessel_stylist_sincronizar_edicao(bigint, bigint, boolean) from public, anon, authenticated;

-- vessel_criar_private_edit — o corpo é o de hoje (pg_get_functiondef,
-- 25/09/2026, pós-B13), só trocando a lista fechada pela consulta ao
-- cadastro e gravando `praca_id` no insert. `create or replace` guarda os
-- grants de hoje (mesma assinatura, 8 parâmetros).
create or replace function public.vessel_criar_private_edit(p_stylist text, p_quando timestamp with time zone, p_local text DEFAULT NULL::text, p_praca text DEFAULT NULL::text, p_loja text DEFAULT NULL::text, p_vagas integer DEFAULT 8, p_teste boolean DEFAULT false, p_confirmar_sobreposicao boolean DEFAULT NULL::boolean)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_alfabeto text := 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
  v_tam      int  := length(v_alfabeto);          -- 30
  -- O maior múltiplo de 30 que cabe em 256: 240. Byte de 240 para cima é
  -- descartado, e é isso que tira o viés.
  v_teto     int  := 256 - (256 % v_tam);
  v_stylist  bigint;
  v_etapa    public.vessel_stylist_etapas%rowtype;
  v_liberam  text;
  v_praca    text := upper(nullif(trim(coalesce(p_praca, '')), ''));
  v_praca_id bigint;
  v_codigo   text;
  v_chave    text;
  v_seq      int;
  v_byte     int;
  v_prefixo  text;
  v_volta    int;
  v_indice   text;
  v_sobrepoe json;
begin
  if not public.vessel_pode('atendimentos.private-edit', 'editar') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao',
      'erro', 'Você não tem a permissão de Atendimentos para criar um encontro.');
  end if;

  select id into v_stylist from public.vessel_stylists
   where codigo = upper(nullif(trim(coalesce(p_stylist, '')), ''));
  if v_stylist is null then
    return json_build_object('ok', false, 'situacao', 'stylist_nao_encontrada',
      'erro', 'Não achei esta stylist. O código é o STY-0000 dela.');
  end if;
  -- ⚠️ 24/09/2026: SÓ QUEM ESTÁ NUMA ETAPA QUE LIBERA PRIVATE EDIT (a Ativada).
  select e.* into v_etapa from public.vessel_stylists s
    join public.vessel_stylist_etapas e on e.id = s.etapa_id
   where s.id = v_stylist;
  if not coalesce(v_etapa.libera_private_edit, false) then
    v_liberam := public.vessel_etapas_que_liberam_private_edit();
    return json_build_object('ok', false, 'situacao', 'stylist_nao_liberada',
      'etapa', v_etapa.nome, 'etapas_que_liberam', v_liberam,
      'erro', 'Esta parceira ainda não pode receber um Private Edit: ela está em "'
              || coalesce(v_etapa.nome, 'sem etapa') || '". '
              || case when v_liberam is null
                      then 'Hoje nenhuma etapa libera Private Edit — marque uma em "Etapas do funil".'
                      else 'Mova-a para ' || v_liberam || ' no Stylist Circle antes de marcar o encontro.' end);
  end if;
  if p_quando is null then
    return json_build_object('ok', false, 'situacao', 'sem_data',
      'erro', 'Escolha o dia e a hora do encontro.');
  end if;
  if p_quando < now() - interval '1 day' then
    return json_build_object('ok', false, 'situacao', 'data_no_passado',
      'erro', 'Esta data já passou. O convite nasceria vencido.');
  end if;
  -- ⚠️ RODADA 1 DE CONSERTO (CRÍTICO): a lista fechada `('CPS','SAO','SBO',
  -- 'BSB')` virou consulta a `vessel_pracas` — sigla existe e está `ativa`.
  -- Sem isto, ninguém marcava encontro em Limeira nem em Piracicaba pela tela.
  if v_praca is null then
    return json_build_object('ok', false, 'situacao', 'praca_invalida',
      'erro', 'Escolha uma praça.');
  end if;
  v_praca_id := public.vessel_praca_id_ativa(v_praca);
  if v_praca_id is null then
    return json_build_object('ok', false, 'situacao', 'praca_invalida',
      'erro', 'Esta praça não existe ou está desativada no cadastro.');
  end if;
  if p_loja is not null and p_loja not in ('iguatemi', 'tivoli', 'parkshopping') then
    return json_build_object('ok', false, 'situacao', 'loja_invalida',
      'erro', 'Escolha uma loja válida.');
  end if;
  -- ⚠️ T11: CAPACIDADE PLANEJADA DE 7 A 10 (decisão 4 do dono). É a cadeira
  -- que a loja prepara, e não trava ninguém na porta do convite.
  if p_vagas is null or p_vagas < 7 or p_vagas > 10 then
    return json_build_object('ok', false, 'situacao', 'vagas_invalidas',
      'erro', 'A capacidade planejada é de 7 a 10 convidadas.');
  end if;

  -- ⚠️ 24/09/2026 (o código sem repetir): o número do dia NÃO é mais só
  -- "quantos há + 1". Um encontro que mudou de dia deixava o número dele livre
  -- no dia de origem, e o próximo criado lá repetia o código (erro de chave
  -- duplicada). Agora: a FILA (trava por dia e praça, até o fim da transação —
  -- duas criações ao mesmo tempo esperam uma pela outra) e, a partir do número
  -- de sempre, o PRÓXIMO LIVRE — livre em todo lugar onde um código de encontro
  -- aparece (`vessel_codigo_de_evento_usado`), inclusive de encontro apagado
  -- que deixou rastro. O cinto: `unique_violation` na inserção avança e tenta
  -- de novo. Códigos que já existem não mudam.
  v_prefixo := 'PE-' || to_char(p_quando at time zone 'America/Sao_Paulo', 'YYYYMMDD') || '-' || v_praca || '-';
  perform pg_advisory_xact_lock(hashtext('vessel.codigo_do_encontro:' || v_prefixo)::bigint);

  -- ⚠️ 25/09/2026: O ENCONTRO SOBREPOSTO. Depois da fila (duas criações no
  -- mesmo dia e praça já esperam uma pela outra, e a segunda enxerga a
  -- primeira), e só quando a tela PEDE (`p_confirmar_sobreposicao` não nulo).
  -- NULL = a Central de antes: nada muda para ela.
  if p_confirmar_sobreposicao is not null then
    v_sobrepoe := public.vessel_encontros_que_sobrepoem(
                    p_quando, public.vessel_lugar_do_encontro(p_loja, v_praca, p_local), null);
    if not p_confirmar_sobreposicao and json_array_length(v_sobrepoe) > 0 then
      return json_build_object('ok', false, 'situacao', 'sobrepoe',
        'sobrepoe', v_sobrepoe, 'contexto', public.vessel_contexto_da_loja(p_quando, p_loja),
        'erro', 'Já há Private Edit neste lugar neste horário. Confira e confirme para marcar mesmo assim.');
    end if;
  end if;

  select count(*) + 1 into v_seq from public.vessel_private_edits
   where praca = v_praca
     and (quando at time zone 'America/Sao_Paulo')::date
         = (p_quando at time zone 'America/Sao_Paulo')::date;

  for v_volta in 1..5 loop
    loop
      v_codigo := v_prefixo || lpad(v_seq::text, 2, '0');
      exit when not public.vessel_codigo_de_evento_usado(v_codigo);
      v_seq := v_seq + 1;
    end loop;

    loop
      v_chave := '';
      while length(v_chave) < 8 loop
        v_byte := get_byte(extensions.gen_random_bytes(1), 0);
        continue when v_byte >= v_teto;      -- descarta e sorteia outro
        v_chave := v_chave || substr(v_alfabeto, 1 + (v_byte % v_tam), 1);
      end loop;
      exit when not exists (select 1 from public.vessel_private_edits where chave = v_chave);
    end loop;

    begin
      -- ⚠️ RODADA 1 DE CONSERTO: `praca_id` grava JUNTO com `praca` (o texto
      -- continua para a Central de hoje não quebrar) — é este dado que faltava
      -- para `ev`, no placar da edição, enxergar o encontro.
      insert into public.vessel_private_edits
        (codigo, chave, stylist_id, quando, local, praca, praca_id, loja, vagas, teste)
      values (v_codigo, v_chave, v_stylist, p_quando,
              nullif(trim(coalesce(p_local, '')), ''), v_praca, v_praca_id, p_loja, p_vagas, p_teste);
      if p_confirmar_sobreposicao and json_array_length(v_sobrepoe) > 0 then
        return json_build_object('ok', true, 'codigo', v_codigo, 'chave', v_chave, 'sobrepoe', v_sobrepoe);
      end if;
      return json_build_object('ok', true, 'codigo', v_codigo, 'chave', v_chave);
    exception when unique_violation then
      get stacked diagnostics v_indice = constraint_name;
      if v_indice = 'vessel_private_edits_codigo_idx' then
        v_seq := v_seq + 1;                  -- alguém pegou este número: o próximo
      elsif v_indice is distinct from 'vessel_private_edits_chave_idx' then
        raise;                               -- outra coisa: não é para engolir
      end if;                                -- a chave: sorteia outra na volta
    end;
  end loop;

  return json_build_object('ok', false, 'situacao', 'codigo_em_disputa',
    'erro', 'Não consegui dar um código ao encontro agora. Tente de novo em um instante.');
end;
$function$;

-- vessel_stylist_criar — mesma troca: lista fechada -> consulta ao cadastro,
-- e `praca_id` grava junto com `praca_preview`. Aqui a praça é OPCIONAL (like
-- hoje): nula não é erro, só some do cadastro.
create or replace function public.vessel_stylist_criar(p_nome text, p_whatsapp text, p_cidade text DEFAULT NULL::text, p_instagram text DEFAULT NULL::text, p_atuacao text DEFAULT NULL::text, p_praca text DEFAULT NULL::text, p_loja text DEFAULT NULL::text, p_origem_contato text DEFAULT NULL::text, p_responsavel text DEFAULT NULL::text, p_prospectado_em date DEFAULT NULL::date, p_proxima_acao text DEFAULT NULL::text, p_proxima_acao_em date DEFAULT NULL::date, p_observacoes text DEFAULT NULL::text, p_sem_contato boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_fone    text;
  v_insta   text := nullif(trim(coalesce(p_instagram, '')), '');
  v_perfil  text := public.vessel_instagram_canonico(p_instagram);
  v_obs     text := nullif(trim(coalesce(p_observacoes, '')), '');
  v_praca   text := upper(nullif(trim(coalesce(p_praca, '')), ''));
  v_praca_id bigint;
  v_loja    text := lower(nullif(trim(coalesce(p_loja, '')), ''));
  v_origem  text := lower(nullif(trim(coalesce(p_origem_contato, '')), ''));
  v_codigo  text;
  v_id      bigint;
  v_n       int;
  v_volta   int;
  v_indice  text;
  v_outra   text;
  -- ⚠️ SEM CONTATO AINDA: só vale quando não veio NENHUM contato.
  v_sem     boolean := coalesce(p_sem_contato, false);
begin
  if not public.vessel_pode('atendimentos.stylist-circle', 'editar') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;

  if nullif(trim(coalesce(p_nome, '')), '') is null then
    return json_build_object('ok', false, 'situacao', 'sem_nome');
  end if;

  -- ⚠️ WHATSAPP OU INSTAGRAM (ver `2026-09-24-vessel-stylist-whatsapp-ou-instagram.sql`).
  if nullif(trim(coalesce(p_whatsapp, '')), '') is not null then
    v_fone := public.vessel_telefone_canonico(p_whatsapp);
    if v_fone is null then
      return json_build_object('ok', false, 'situacao', 'whatsapp_invalido');
    end if;
  end if;
  if length(coalesce(v_insta, '')) > 120 then
    return json_build_object('ok', false, 'situacao', 'instagram_longo');
  end if;
  -- ⚠️ SEM CONTATO AINDA: só quem MARCOU a caixa entra sem os dois. A Central
  -- antiga não manda `p_sem_contato` (padrão false) e continua recusando igual.
  if v_fone is null and v_insta is null and not v_sem then
    return json_build_object('ok', false, 'situacao', 'sem_contato');
  end if;
  -- Instagram ESCRITO sem WhatsApp continua tendo de ser um perfil de verdade.
  if v_fone is null and v_insta is not null and v_perfil is null then
    return json_build_object('ok', false, 'situacao', 'instagram_invalido');
  end if;
  if v_obs is not null and length(v_obs) > 2000 then
    return json_build_object('ok', false, 'situacao', 'observacoes_longas');
  end if;

  -- ⚠️ RODADA 1 DE CONSERTO (CRÍTICO): consulta ao cadastro, não lista
  -- fechada — sem isto, ninguém cadastrava stylist de Limeira nem de
  -- Piracicaba pela tela.
  --
  -- ⚠️ REVISÃO FINAL (IMPORTANTE 4): sem praça escolhida, a praça SAI DA
  -- CIDADE (`vessel_praca_id_da_cidade`, seção 12) — a MESMA conta do
  -- backfill da seção 8. Cidade que não casa continua sem praça: pendência à
  -- vista, nunca chute. `praca_preview` NÃO é inventado a partir disso — ele
  -- guarda o que a pessoa escreveu, e quem manda de verdade é `praca_id`.
  if v_praca is not null then
    v_praca_id := public.vessel_praca_id_ativa(v_praca);
    if v_praca_id is null then
      return json_build_object('ok', false, 'situacao', 'praca_invalida');
    end if;
  else
    v_praca_id := public.vessel_praca_id_da_cidade(p_cidade);
  end if;
  if v_loja is not null and v_loja not in ('iguatemi', 'tivoli', 'parkshopping') then
    return json_build_object('ok', false, 'situacao', 'loja_invalida');
  end if;
  if v_origem is null or v_origem not in ('indicacao', 'pesquisa', 'evento', 'inbound') then
    return json_build_object('ok', false, 'situacao', 'origem_invalida');
  end if;

  if v_fone is not null and exists (select 1 from public.vessel_stylists where whatsapp = v_fone) then
    return json_build_object('ok', false, 'situacao', 'whatsapp_repetido',
      'codigo', (select s.codigo from public.vessel_stylists s where s.whatsapp = v_fone));
  end if;
  if v_perfil is not null then
    select s.codigo into v_outra from public.vessel_stylists s
     where public.vessel_instagram_canonico(s.instagram) = v_perfil
     order by s.id limit 1;
    if v_outra is not null then
      return json_build_object('ok', false, 'situacao', 'instagram_repetido', 'codigo', v_outra);
    end if;
  end if;

  -- ⚠️ A TRAVA DE FILA E O CINTO, sem mudança desde 19/09.
  perform pg_advisory_xact_lock(hashtext('public.vessel_stylists.codigo')::bigint);

  for v_volta in 1..3 loop
    select coalesce(max((substring(s.codigo from '^STY-([0-9]{4})$'))::int), 0)
      into v_n
      from public.vessel_stylists s
     where s.codigo ~ '^STY-[0-9]{4}$';

    v_codigo := null;
    for i in 1..10000 loop
      v_n := v_n + 1;
      if v_n > 9999 then
        v_n := 0;
      end if;
      v_codigo := 'STY-' || lpad(v_n::text, 4, '0');
      exit when not exists (select 1 from public.vessel_stylists s where s.codigo = v_codigo);
      v_codigo := null;
    end loop;

    if v_codigo is null then
      return json_build_object('ok', false, 'situacao', 'sem_codigo_livre');
    end if;

    begin
      -- ⚠️ SEM `etapa_id` E SEM `prospectado_em`: o gatilho põe a primeira
      -- etapa de funil e a data segue a regra da etapa marcada.
      -- ⚠️ RODADA 1 DE CONSERTO: `praca_id` grava junto com `praca_preview`.
      insert into public.vessel_stylists
        (codigo, nome, whatsapp, cidade, instagram, atuacao, praca_preview, praca_id,
         loja, origem_contato, responsavel, proxima_acao, proxima_acao_em, observacoes,
         sem_contato)
      values
        (v_codigo, trim(p_nome), v_fone,
         nullif(trim(coalesce(p_cidade, '')), ''),
         v_insta,
         nullif(trim(coalesce(p_atuacao, '')), ''),
         v_praca, v_praca_id, v_loja, v_origem,
         nullif(trim(coalesce(p_responsavel, '')), ''),
         nullif(trim(coalesce(p_proxima_acao, '')), ''),
         p_proxima_acao_em,
         v_obs,
         v_sem and v_fone is null and v_insta is null)
      returning id into v_id;

      -- ⚠️ TASK 11 RODADA 1 DE CONSERTO (MENOR b): nasce vinculada à edição
      -- ABERTA da praça, se houver — pela MESMA função que as outras três
      -- portas usam (`vessel_stylist_sincronizar_edicao`), um critério só.
      -- `p_fechar_antigo` fica `false` (o padrão): quem está NASCENDO não
      -- tem vínculo antigo para fechar. Sem edição aberta (ou sem praça),
      -- nasce sem vínculo — e isso não é erro.
      perform public.vessel_stylist_sincronizar_edicao(v_id, v_praca_id);

      return json_build_object('ok', true, 'situacao', 'ok', 'codigo', v_codigo);

    exception when unique_violation then
      get stacked diagnostics v_indice = constraint_name;

      if v_indice = 'vessel_stylists_whatsapp_idx' then
        return json_build_object('ok', false, 'situacao', 'whatsapp_repetido');
      end if;

      if v_indice is distinct from 'vessel_stylists_codigo_idx' then
        return json_build_object('ok', false, 'situacao', 'conflito_no_cadastro',
                                 'onde', v_indice);
      end if;
    end;
  end loop;

  return json_build_object('ok', false, 'situacao', 'codigo_em_disputa');
end;
$function$;

-- vessel_stylist_editar — mesma troca; `praca_id` só muda quando `p_praca`
-- veio (o mesmo NULO-não-mexe de sempre, igual `praca_preview`).
create or replace function public.vessel_stylist_editar(p_codigo text, p_nome text DEFAULT NULL::text, p_whatsapp text DEFAULT NULL::text, p_cidade text DEFAULT NULL::text, p_instagram text DEFAULT NULL::text, p_atuacao text DEFAULT NULL::text, p_estagio text DEFAULT NULL::text, p_praca text DEFAULT NULL::text, p_loja text DEFAULT NULL::text, p_origem_contato text DEFAULT NULL::text, p_responsavel text DEFAULT NULL::text, p_prospectado_em date DEFAULT NULL::date, p_proxima_acao text DEFAULT NULL::text, p_proxima_acao_em date DEFAULT NULL::date, p_sem_proxima_acao boolean DEFAULT false, p_observacoes text DEFAULT NULL::text, p_sem_contato boolean DEFAULT NULL::boolean)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_codigo  text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
  v_id      bigint;
  v_fone    text;
  v_insta   text := nullif(trim(coalesce(p_instagram, '')), '');
  v_perfil  text := public.vessel_instagram_canonico(p_instagram);
  v_praca   text := upper(nullif(trim(coalesce(p_praca, '')), ''));
  v_praca_id bigint;
  v_loja    text := lower(nullif(trim(coalesce(p_loja, '')), ''));
  v_origem  text := lower(nullif(trim(coalesce(p_origem_contato, '')), ''));
  v_fone_atual text;
  v_insta_atual text;
  v_com_contato boolean;
begin
  if not public.vessel_pode('atendimentos.stylist-circle', 'editar') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;

  select s.id, s.whatsapp, nullif(btrim(coalesce(s.instagram, '')), '') into v_id, v_fone_atual, v_insta_atual
    from public.vessel_stylists s where s.codigo = v_codigo;
  if not found then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;

  if nullif(trim(coalesce(p_estagio, '')), '') is not null then
    return json_build_object('ok', false, 'situacao', 'etapa_pela_ficha');
  end if;

  if nullif(trim(coalesce(p_whatsapp, '')), '') is not null then
    v_fone := public.vessel_telefone_canonico(p_whatsapp);
    if v_fone is null then
      return json_build_object('ok', false, 'situacao', 'whatsapp_invalido');
    end if;
    if exists (select 1 from public.vessel_stylists s
                where s.whatsapp = v_fone and s.codigo <> v_codigo) then
      return json_build_object('ok', false, 'situacao', 'whatsapp_repetido');
    end if;
  end if;

  if v_insta is not null then
    if length(v_insta) > 120 then
      return json_build_object('ok', false, 'situacao', 'instagram_longo');
    end if;
    if coalesce(v_fone, v_fone_atual) is null and v_perfil is null then
      return json_build_object('ok', false, 'situacao', 'instagram_invalido');
    end if;
    if v_perfil is not null and exists (
         select 1 from public.vessel_stylists s
          where public.vessel_instagram_canonico(s.instagram) = v_perfil
            and s.codigo <> v_codigo) then
      return json_build_object('ok', false, 'situacao', 'instagram_repetido');
    end if;
  end if;

  -- ⚠️ SEM CONTATO AINDA. NULO = NÃO MEXE (a Central antiga não manda).
  -- Desmarcar sem dar um contato é recusado: a parceira ficaria sem WhatsApp,
  -- sem Instagram e sem a marca — o que a tabela não aceita. Ganhar um
  -- contato DESLIGA a marca sozinho (aqui e no gatilho da tabela).
  v_com_contato := coalesce(v_fone, v_fone_atual) is not null or coalesce(v_insta, v_insta_atual) is not null;
  if p_sem_contato is not null and not p_sem_contato and not v_com_contato then
    return json_build_object('ok', false, 'situacao', 'sem_contato');
  end if;

  if p_observacoes is not null and length(trim(p_observacoes)) > 2000 then
    return json_build_object('ok', false, 'situacao', 'observacoes_longas');
  end if;

  -- ⚠️ RODADA 1 DE CONSERTO (CRÍTICO): consulta ao cadastro, não lista
  -- fechada — sem isto, ninguém movia stylist para Limeira nem Piracicaba
  -- pela tela depois de cadastrada.
  if v_praca is not null then
    v_praca_id := public.vessel_praca_id_ativa(v_praca);
    if v_praca_id is null then
      return json_build_object('ok', false, 'situacao', 'praca_invalida');
    end if;
  end if;
  if v_loja is not null and v_loja not in ('iguatemi', 'tivoli', 'parkshopping') then
    return json_build_object('ok', false, 'situacao', 'loja_invalida');
  end if;
  if v_origem is not null and v_origem not in ('indicacao', 'pesquisa', 'evento', 'inbound') then
    return json_build_object('ok', false, 'situacao', 'origem_invalida');
  end if;

  update public.vessel_stylists s
     set nome            = coalesce(nullif(trim(coalesce(p_nome, '')), ''), s.nome),
         whatsapp        = coalesce(v_fone, s.whatsapp),
         cidade          = coalesce(nullif(trim(coalesce(p_cidade, '')), ''), s.cidade),
         instagram       = coalesce(v_insta, s.instagram),
         atuacao         = coalesce(nullif(trim(coalesce(p_atuacao, '')), ''), s.atuacao),
         praca_preview   = coalesce(v_praca, s.praca_preview),
         -- ⚠️ RODADA 1 DE CONSERTO: `praca_id` junto — só muda quando `p_praca`
         -- veio (o mesmo NULO-não-mexe de `praca_preview`, acima).
         praca_id        = coalesce(v_praca_id, s.praca_id),
         loja            = coalesce(v_loja, s.loja),
         origem_contato  = coalesce(v_origem, s.origem_contato),
         responsavel     = coalesce(nullif(trim(coalesce(p_responsavel, '')), ''), s.responsavel),
         proxima_acao    = case when coalesce(p_sem_proxima_acao, false) then null
                                else coalesce(nullif(trim(coalesce(p_proxima_acao, '')), ''),
                                              s.proxima_acao) end,
         proxima_acao_em = case when coalesce(p_sem_proxima_acao, false) then null
                                else coalesce(p_proxima_acao_em, s.proxima_acao_em) end,
         observacoes     = case when p_observacoes is null then s.observacoes
                                else nullif(trim(p_observacoes), '') end,
         sem_contato     = case when v_com_contato then false
                                else coalesce(p_sem_contato, s.sem_contato) end,
         atualizado_em   = now()
   where s.codigo = v_codigo;

  -- ⚠️ TASK 11 RODADA 1 DE CONSERTO (CRÍTICO 1): quando a praça MUDA
  -- (`p_praca` veio e resolveu uma `v_praca_id`), `p_fechar_antigo => true`
  -- fecha o vínculo ABERTO que ela tinha numa edição ABERTA de outra praça
  -- ANTES de abrir o novo — sem isto ela contaria em duas edições abertas ao
  -- mesmo tempo. Edição ENCERRADA nunca é tocada (o histórico é quem
  -- congela). `vessel_stylist_sincronizar_edicao` cuida do resto (mesmo
  -- critério de elegibilidade das outras portas, `on conflict do nothing`).
  perform public.vessel_stylist_sincronizar_edicao(v_id, v_praca_id, true);

  return json_build_object('ok', true, 'situacao', 'ok', 'codigo', v_codigo);
end;
$function$;

-- vessel_pedido_do_stylist — a inscrição PÚBLICA da página do Stylist Circle
-- (porta de `anon`, sem `vessel_pode`, de propósito — é o formulário
-- público). Mesma troca: lista fechada -> consulta ao cadastro; `praca_id`
-- grava junto com `praca_preview`, no insert E no update.
create or replace function public.vessel_pedido_do_stylist(p_nome text, p_whatsapp text, p_cidade text DEFAULT NULL::text, p_instagram text DEFAULT NULL::text, p_atuacao text DEFAULT NULL::text, p_quer_sessao text DEFAULT NULL::text, p_convidadas text DEFAULT NULL::text, p_praca text DEFAULT NULL::text, p_aceite_marketing boolean DEFAULT false, p_aceite_versao text DEFAULT NULL::text, p_origem jsonb DEFAULT NULL::jsonb, p_armadilha text DEFAULT NULL::text, p_teste boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ip       text := public.vessel_hash_de_origem();
  v_fone     text;
  v_recentes int;
  v_id       bigint;
  v_codigo   text;
  v_n        int;
  v_volta    int;
  v_indice   text;
  v_praca_id bigint;
  -- ⚠️ REVISÃO FINAL (IMPORTANTE 4): a praça DEDUZIDA da cidade, separada da
  -- escolhida de propósito — a deduzida só PREENCHE buraco, nunca troca a
  -- praça de quem já tem uma (ver o `coalesce` de três pernas no update).
  v_praca_da_cidade bigint;
  v_era_nova boolean;
begin
  if coalesce(trim(p_armadilha), '') <> '' then
    return json_build_object('ok', true, 'situacao', 'recebido');
  end if;

  v_fone := public.vessel_telefone_canonico(p_whatsapp);
  if coalesce(trim(p_nome), '') = '' or v_fone is null then
    return json_build_object('ok', false, 'situacao', 'invalido',
      'erro', 'Confira seu nome e o WhatsApp com DDD.');
  end if;
  if nullif(trim(coalesce(p_atuacao, '')), '') is not null
     and p_atuacao not in ('stylist', 'personal-shopper', 'consultoria', 'outra') then
    return json_build_object('ok', false, 'situacao', 'atuacao_invalida');
  end if;
  if nullif(trim(coalesce(p_quer_sessao, '')), '') is not null
     and p_quer_sessao not in ('sim', 'entender') then
    return json_build_object('ok', false, 'situacao', 'sessao_invalida');
  end if;
  if nullif(trim(coalesce(p_convidadas, '')), '') is not null
     and p_convidadas not in ('ate-4', '5-8', 'mais-de-8') then
    return json_build_object('ok', false, 'situacao', 'convidadas_invalido');
  end if;
  -- ⚠️ RODADA 1 DE CONSERTO (CRÍTICO): consulta ao cadastro, não lista
  -- fechada — sem isto, uma stylist de Limeira/Piracicaba não conseguia se
  -- inscrever pela landing page com a própria praça.
  --
  -- ⚠️ REVISÃO FINAL (IMPORTANTE 4): o formulário PÚBLICO não pergunta a
  -- praça — pergunta a CIDADE. Sem derivar, toda inscrição pela landing page
  -- nascia com `praca_id` nulo: fora de toda edição, fora de todo placar,
  -- calada. `v_praca_da_cidade` é a MESMA conta do backfill da seção 8.
  if nullif(trim(coalesce(p_praca, '')), '') is not null then
    v_praca_id := public.vessel_praca_id_ativa(p_praca);
    if v_praca_id is null then
      return json_build_object('ok', false, 'situacao', 'praca_invalida');
    end if;
  else
    v_praca_da_cidade := public.vessel_praca_id_da_cidade(p_cidade);
  end if;
  if length(trim(coalesce(p_instagram, ''))) > 120 then
    return json_build_object('ok', false, 'situacao', 'instagram_longo');
  end if;

  -- Teto por IP, mudo: quem apanha não pode saber.
  select count(*) into v_recentes from public.vessel_stylists
   where criado_em > now() - interval '1 hour';
  if v_recentes >= 40 then
    return json_build_object('ok', true, 'situacao', 'recebido');
  end if;

  select id, codigo into v_id, v_codigo from public.vessel_stylists where whatsapp = v_fone;
  v_era_nova := v_id is null;

  if v_id is null then
    -- ⚠️ O CÓDIGO NUNCA MUDA depois de dado: ele vai para dentro de links de
    -- rastreio que a stylist já mandou para as clientes dela.
    --
    -- ⚠️ 25/09/2026 (o código sem repetir): era "quantas stylists há + 1". Uma
    -- stylist apagada deixa a conta menor que o maior número dado, e a próxima
    -- inscrição recebia um STY que JÁ EXISTE — a inscrição da página quebrava
    -- com chave duplicada (`vessel_stylists_codigo_idx`). Agora é a MESMA regra
    -- de `vessel_stylist_criar` (a do cadastro pela equipe, desde 19/09): a
    -- FILA com a MESMA trava (as duas portas esperam uma pela outra), o MAIOR
    -- número já dado + 1, pulando o que já existir, e o CINTO (`unique_violation`
    -- no código avança e tenta de novo). Códigos que já existem não mudam.
    perform pg_advisory_xact_lock(hashtext('public.vessel_stylists.codigo')::bigint);
    for v_volta in 1..3 loop
      select coalesce(max((substring(s.codigo from '^STY-([0-9]{4})$'))::int), 0)
        into v_n
        from public.vessel_stylists s
       where s.codigo ~ '^STY-[0-9]{4}$';

      v_codigo := null;
      for i in 1..10000 loop
        v_n := v_n + 1;
        if v_n > 9999 then
          v_n := 0;
        end if;
        v_codigo := 'STY-' || lpad(v_n::text, 4, '0');
        exit when not exists (select 1 from public.vessel_stylists s where s.codigo = v_codigo);
        v_codigo := null;
      end loop;
      if v_codigo is null then
        -- Sem número livre: a pessoa não pode ver erro nem saber por quê.
        return json_build_object('ok', true, 'situacao', 'recebido');
      end if;

      begin
        -- ⚠️ RODADA 1 DE CONSERTO: `praca_id` grava junto com `praca_preview`.
        insert into public.vessel_stylists
          (codigo, nome, whatsapp, cidade, instagram, atuacao, quer_sessao, convidadas,
           praca_preview, praca_id, teste, origem_canal, origem_campanha, origem_utm)
        values (v_codigo, trim(p_nome), v_fone,
                nullif(trim(coalesce(p_cidade, '')), ''), nullif(trim(coalesce(p_instagram, '')), ''),
                nullif(trim(coalesce(p_atuacao, '')), ''), nullif(trim(coalesce(p_quer_sessao, '')), ''),
                nullif(trim(coalesce(p_convidadas, '')), ''), upper(nullif(trim(coalesce(p_praca, '')), '')),
                -- ⚠️ REVISÃO FINAL (IMPORTANTE 4): quem NASCE aqui não tem
                -- praça nenhuma, então a deduzida da cidade entra direto.
                coalesce(v_praca_id, v_praca_da_cidade),
                p_teste,
                coalesce(nullif(trim(p_origem ->> 'canal'), ''), 'lp-stylist-circle'),
                nullif(trim(p_origem ->> 'utm_campaign'), ''),
                p_origem)
        on conflict (whatsapp) do nothing
        returning id into v_id;
        exit;
      exception when unique_violation then
        get stacked diagnostics v_indice = constraint_name;
        if v_indice is distinct from 'vessel_stylists_codigo_idx' then
          raise;                               -- outra coisa: não é para engolir
        end if;                                -- o código: conta de novo na volta
        v_id := null;
      end;
    end loop;
    if v_id is null then
      select id, codigo into v_id, v_codigo from public.vessel_stylists where whatsapp = v_fone;
    end if;
    if v_id is null then
      -- as três voltas perderam a disputa do código: responde calmo, sem gravar
      return json_build_object('ok', true, 'situacao', 'recebido');
    end if;
  else
    -- Ela voltou e contou mais: o que chega agora vale, o que não veio fica.
    update public.vessel_stylists
       set nome = coalesce(nullif(trim(coalesce(p_nome, '')), ''), nome),
           cidade = coalesce(nullif(trim(coalesce(p_cidade, '')), ''), cidade),
           instagram = coalesce(nullif(trim(coalesce(p_instagram, '')), ''), instagram),
           atuacao = coalesce(nullif(trim(coalesce(p_atuacao, '')), ''), atuacao),
           quer_sessao = coalesce(nullif(trim(coalesce(p_quer_sessao, '')), ''), quer_sessao),
           convidadas = coalesce(nullif(trim(coalesce(p_convidadas, '')), ''), convidadas),
           praca_preview = coalesce(upper(nullif(trim(coalesce(p_praca, '')), '')), praca_preview),
           -- ⚠️ RODADA 1 DE CONSERTO: `praca_id` junto — só muda quando `p_praca` veio.
           -- ⚠️ REVISÃO FINAL (IMPORTANTE 4): a praça DEDUZIDA da cidade é a
           -- ÚLTIMA perna do `coalesce` — ela só PREENCHE quem está sem praça,
           -- nunca MOVE quem já tem uma. Mover alguém de praça por um campo de
           -- formulário público (a pessoa corrige a grafia da cidade e troca
           -- de loja de destino sem ninguém ver) seria justamente o tipo de
           -- mudança calada que este trabalho existe para matar.
           praca_id = coalesce(v_praca_id, praca_id, v_praca_da_cidade),
           atualizado_em = now()
     where id = v_id;
  end if;

  -- ⚠️ TASK 11 RODADA 1 DE CONSERTO (IMPORTANTE 2) — a porta PÚBLICA (a
  -- landing page do Stylist Circle) não vinculava à edição aberta: quem se
  -- inscrevia no meio de uma rodada ficava fora do placar dela, calado, até
  -- alguém abrir a próxima edição. `p_fechar_antigo => not v_era_nova`: quem
  -- está se inscrevendo PELA PRIMEIRA VEZ não tem vínculo antigo para fechar
  -- (mesma regra de `vessel_stylist_criar`); quem VOLTOU e mudou de praça
  -- (o ramo `else`, acima) passa pela mesma trava do CRÍTICO 1 — fecha o
  -- vínculo aberto da praça antiga antes de abrir o da nova.
  -- ⚠️ REVISÃO FINAL (IMPORTANTE 4): a praça EFETIVA é a que FICOU GRAVADA
  -- na linha — lida de volta, nunca deduzida de novo aqui. Com a praça vindo
  -- da cidade, `v_praca_id` sozinho seria nulo e a sincronização não faria
  -- nada: a inscrição continuaria fora da edição aberta, que é o defeito que
  -- o IMPORTANTE 2 (rodada anterior) fechou por outra porta.
  select s.praca_id into v_praca_id from public.vessel_stylists s where s.id = v_id;
  perform public.vessel_stylist_sincronizar_edicao(v_id, v_praca_id, not v_era_nova);

  -- As permissões, separadas por finalidade — a de atendimento sempre, a de
  -- marketing só se ela marcou.
  insert into public.vessel_consentimentos (stylist_id, finalidade, canal, versao, fonte, teste)
  values (v_id, 'atendimento', 'whatsapp', nullif(trim(coalesce(p_aceite_versao, '')), ''),
          'lp-stylist-circle', p_teste);
  if coalesce(p_aceite_marketing, false) then
    insert into public.vessel_consentimentos (stylist_id, finalidade, canal, versao, fonte, teste)
    values (v_id, 'marketing', 'whatsapp', nullif(trim(coalesce(p_aceite_versao, '')), ''),
            'lp-stylist-circle', p_teste);
  end if;

  -- ⚠️ O CÓDIGO NÃO VOLTA PARA A PÁGINA. Ele é identificador interno de
  -- rastreio; devolvê-lo ao navegador o transformaria em coisa pública, e o
  -- módulo 10 quer o contrário.
  return json_build_object('ok', true, 'situacao', 'recebido');
end;
$function$;

-- ── 13. as portas ────────────────────────────────────────────────────────────
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

-- ── 14. RECORTE DE CHAVE: atendimentos.pracas / atendimentos.edicoes (Task 6) ──
--
-- Decisão do dono (task-6-brief.md, 25/09/2026): Praça e Edição ganham chave
-- PRÓPRIA no catálogo (src/compartilhado/catalogo-de-ferramentas.js) — até
-- aqui as 11 funções de cadastro (seção 9) conferiam 'atendimentos.stylist-
-- circle', decisão PROVISÓRIA da Task 4, documentada e assumida no relatório
-- dela ("se uma tarefa futura recortar essas chaves, ela precisa lembrar da
-- pré-concessão aditiva"). PADRAO-DA-CENTRAL.md, item 9¾: "Chave que é pedaço
-- de uma que já existe vem com pré-concessão ADITIVA (migration + coletor/
-- aplicar-*.mjs) para quem já tem a mãe" e "Nunca dar de graça a quem não
-- tinha a mãe" — só quem já tinha 'atendimentos.stylist-circle' recebe as
-- duas chaves novas, no MESMO nível (ver, ou ver+editar).
--
-- Os corpos abaixo são os de hoje (Task 4/5, com as rodadas de conserto,
-- íntegros — `create or replace` guarda os grants, mesma assinatura de
-- sempre), trocando SÓ a expressão `vessel_pode(...)` de cada função — nada
-- mais muda:
--
--   vessel_pracas_listar / vessel_edicoes_listar → 'ver' em QUALQUER de
--     atendimentos.pracas, atendimentos.edicoes, atendimentos.stylist-circle,
--     atendimentos.private-edit — as duas telas GRANDES (Stylist Circle e
--     Private Edit) continuam precisando da lista para os seletores delas.
--   vessel_praca_criar / _editar / _cidade_vincular / _cidade_desvincular →
--     'editar' em atendimentos.pracas.
--   vessel_edicao_criar / _abrir / _encerrar → 'editar' em atendimentos.edicoes.
--   vessel_edicao_incluir_stylist → 'editar' em atendimentos.edicoes OU
--     atendimentos.stylist-circle (o quadro do Stylist Circle inclui direto).
--   vessel_stylist_definir_praca e vessel_placar_da_edicao NÃO mudam: seguem
--     em atendimentos.stylist-circle — pedido explícito do brief desta tarefa.
--     ⚠️ REVISÃO FINAL (MENOR 1): "não mudam" quer dizer que elas NÃO SÃO
--     RECRIADAS — cada uma nasce UMA vez só no arquivo, na seção 9 e na
--     seção 11. Até a revisão o arquivo desmentia isso: havia uma "seção 15"
--     no fim recriando `vessel_placar_da_edicao` com o corpo IDÊNTICO ao da
--     seção 11. A cópia foi apagada e o que ela explicava foi para o
--     cabeçalho da seção 11.
--
-- ⚠️ O INVARIANTE DO ARQUIVO: cada uma das 10 funções abaixo é cópia LETRA
-- POR LETRA da irmã dela na seção 9, diferindo SÓ na linha do `vessel_pode`.
-- O aplicador confere isso por diff de verdade (extrai as duas definições e
-- compara), e é por isso que qualquer conserto aqui vale para AS DUAS cópias.

-- ── 14.1 a lista fechada de vessel_pode ganha as duas chaves ────────────────
create or replace function public.vessel_pode(p_ferramenta text, p_nivel text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- A LISTA FECHADA: as chaves do Comercial Vessel no catálogo que têm tela
  -- chamando o banco, e os dois níveis que o catálogo oferece a elas.
  if p_ferramenta is null or p_ferramenta not in (
       'atendimentos', 'atendimentos.beauty-sessions', 'atendimentos.private-edit',
       'atendimentos.stylist-circle', 'atendimentos.material-grafico',
       'atendimentos.pracas', 'atendimentos.edicoes') then
    raise exception 'vessel_pode: ferramenta desconhecida (%)', p_ferramenta using errcode = '22023';
  end if;
  if p_nivel is null or p_nivel not in ('ver', 'editar') then
    raise exception 'vessel_pode: nivel desconhecido (%)', p_nivel using errcode = '22023';
  end if;
  if p_ferramenta = 'atendimentos.material-grafico' and p_nivel <> 'ver' then
    raise exception 'vessel_pode: o Material Grafico so tem ver' using errcode = '22023';
  end if;
  -- ⚠️ A ARMADILHA DO NULO: o `coalesce` envolve a subconsulta INTEIRA.
  return public.conta_ativa() and coalesce(
    (select coalesce(p.is_superadmin, false)
         or (jsonb_typeof(p.permissions) = 'object'
             and jsonb_typeof(p.permissions -> p_ferramenta) = 'array'
             and (p.permissions -> p_ferramenta) ? 'ver'
             and (p_nivel = 'ver' or (p.permissions -> p_ferramenta) ? p_nivel))
       from public.profiles p where p.id = auth.uid()),
    false);
end;
$$;

comment on function public.vessel_pode(text, text) is
  'B13 + Task 6 (25/09/2026): quem pode VER/EDITAR uma tela do Comercial Vessel — permissions[ferramenta] (o mesmo campo que a Central le), super-admin sempre, conta desativada nunca. Toda funcao nova de UMA tela confere a chave dela por aqui (PADRAO-DA-CENTRAL.md).';

-- ── 14.2 as 10 funções de cadastro: a trava aprende a chave recortada ───────

-- listar as praças — ver em QUALQUER das quatro telas que precisam da lista
create or replace function public.vessel_pracas_listar()
returns json
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if not (public.vessel_pode('atendimentos.pracas', 'ver')
       or public.vessel_pode('atendimentos.edicoes', 'ver')
       or public.vessel_pode('atendimentos.stylist-circle', 'ver')
       or public.vessel_pode('atendimentos.private-edit', 'ver')) then
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
  if not public.vessel_pode('atendimentos.pracas', 'editar') then
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
  if not public.vessel_pode('atendimentos.pracas', 'editar') then
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
  -- ⚠️ REVISÃO FINAL (IMPORTANTE 6): a ADOÇÃO — ver o bloco no fim.
  v_situacao text;
  v_stylist  bigint;
  v_adotadas int := 0;
begin
  if not public.vessel_pode('atendimentos.pracas', 'editar') then
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
    v_id := v_dono.id;
    v_situacao := 'ja_vinculada';
  else
    insert into public.vessel_praca_cidades (praca_id, cidade, cidade_chave)
    values (p_praca_id, v_cidade, v_chave)
    returning id into v_id;
    v_situacao := 'ok';
  end if;

  -- ⚠️ REVISÃO FINAL (IMPORTANTE 6): A ADOÇÃO. Até aqui vincular a cidade
  -- criava SÓ a linha do cadastro e não movia ninguém — a pendência "N
  -- stylists sem praça", que a barra mostra nas duas telas grandes, NÃO SE
  -- RESOLVIA pelo cadastro de Praças. O backfill da seção 8 roda uma vez só,
  -- e `vessel_stylist_definir_praca` não tem chamador em tela nenhuma: quem
  -- estava sem praça ficava sem praça para sempre, e a única saída era abrir
  -- a ficha de uma em uma.
  --
  -- O critério é O MAIS ESTREITO QUE RESOLVE: só quem está SEM PRAÇA
  -- (`praca_id is null`) e cuja cidade casa com A CIDADE QUE ACABOU DE SER
  -- VINCULADA, pela MESMA chave achatada (`vessel_achatar_cidade`) do resto
  -- do arquivo. Ninguém TROCA de praça por aqui — vincular "Campinas" à
  -- praça X não arrasta quem já está em CPS. Stylist de teste fica de fora,
  -- pelo critério único da casa.
  --
  -- Rodar de novo com a cidade JÁ vinculada (`ja_vinculada`) também adota —
  -- é de propósito: é o botão que o dono aperta quando a pendência reaparece,
  -- e uma ação que "não faz nada da segunda vez" seria uma pegadinha.
  --
  -- ⚠️ `adotadas` VOLTA NA RESPOSTA: número que a tela escreve ("3 stylists
  -- de Limeira passaram a ser desta praça"). Movimento calado em dado de
  -- gente é o que esta migration inteira existe para acabar.
  for v_stylist in
    select s.id from public.vessel_stylists s
     where s.praca_id is null
       and not coalesce(s.teste, false)
       and public.vessel_achatar_cidade(s.cidade) = v_chave
  loop
    update public.vessel_stylists set praca_id = p_praca_id, atualizado_em = now() where id = v_stylist;
    -- e entra na edição ABERTA da praça, pela MESMA função das outras portas.
    -- `p_fechar_antigo` fica `false`: quem estava SEM praça não tem vínculo
    -- "da praça antiga" para fechar — e uma inclusão feita à mão numa edição
    -- qualquer não pode ser desfeita por um cadastro de cidade.
    perform public.vessel_stylist_sincronizar_edicao(v_stylist, p_praca_id, false);
    v_adotadas := v_adotadas + 1;
  end loop;

  return json_build_object('ok', true, 'situacao', v_situacao, 'id', v_id, 'adotadas', v_adotadas);
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
  if not public.vessel_pode('atendimentos.pracas', 'editar') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  if not exists (select 1 from public.vessel_praca_cidades where id = p_id) then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;
  delete from public.vessel_praca_cidades where id = p_id;
  return json_build_object('ok', true, 'situacao', 'ok');
end;
$$;

-- as edições de uma praça (ou de todas, com p_praca_id nulo) — ver em
-- QUALQUER das quatro telas que precisam da lista (mesma regra de
-- vessel_pracas_listar, acima)
create or replace function public.vessel_edicoes_listar(p_praca_id bigint)
returns json
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if not (public.vessel_pode('atendimentos.pracas', 'ver')
       or public.vessel_pode('atendimentos.edicoes', 'ver')
       or public.vessel_pode('atendimentos.stylist-circle', 'ver')
       or public.vessel_pode('atendimentos.private-edit', 'ver')) then
    raise exception 'sem permissao' using errcode = '42501';
  end if;
  return coalesce((
    select json_agg(json_build_object(
             'id', e.id, 'praca_id', e.praca_id, 'praca_nome', p.nome, 'numero', e.numero,
             'nome', e.nome, 'comeca_em', e.comeca_em, 'termina_em', e.termina_em, 'situacao', e.situacao,
             -- ⚠️ REVISÃO FINAL (IMPORTANTE 1): O MESMO CRITÉRIO DO PLACAR,
             -- letra por letra — `turma_ids` + `sty` de `vessel_placar_da_
             -- edicao`. Os DOIS números aparecem JUNTOS na tela (o bloco
             -- "praças com edição aberta" de `placar-do-stylist-circle.vue`
             -- mostra `edicao.stylists` ao lado do placar da mesma edição):
             -- dois jeitos de contar a MESMA edição é o defeito clássico de
             -- "dois lugares para a mesma verdade".
             --
             --   edição ABERTA/planejada → quem está dentro AGORA
             --                              (`saiu_em is null`);
             --   edição ENCERRADA        → a turma CONGELADA (todas as
             --                              linhas, que o encerramento fechou
             --                              no mesmo instante).
             --
             -- ⚠️ O COMENTÁRIO ANTIGO AQUI MENTIA: dizia "enquanto a edição
             -- está planejada/aberta ninguém tem `saiu_em` ainda". Deixou de
             -- ser verdade quando `vessel_stylist_sincronizar_edicao` passou
             -- a FECHAR o vínculo de quem muda de praça com a edição de
             -- origem ainda aberta — a partir daí esta conta inchava com
             -- quem já tinha saído, e o placar ao lado (que filtra) dizia
             -- outro número.
             -- ⚠️ TASK 6 RODADA 1 DE CONSERTO (IMPORTANTE 3): `teste` — e a
             -- REVISÃO FINAL acrescentou `ativa`, pelo mesmo motivo: o placar
             -- filtra os dois (`sty`), e quem está lado a lado tem de contar
             -- igual.
             'stylists', (select count(*)::int from public.vessel_stylist_na_edicao n
                           join public.vessel_stylists s on s.id = n.stylist_id
                           where n.edicao_id = e.id and not coalesce(s.teste, false)
                             and coalesce(s.ativa, true)
                             and (e.situacao = 'encerrada' or n.saiu_em is null)),
             -- ⚠️ TASK 6 RODADA 1 DE CONSERTO (IMPORTANTE 3): quantas SERIAM
             -- levadas se a edição fosse encerrada agora — o MESMO critério
             -- de `vessel_edicao_encerrar` (vínculo ainda ativo, `saiu_em is
             -- null`, da stylist que ainda não ativou). Numa edição já
             -- encerrada dá sempre 0 (o congelamento já fechou todos os
             -- vínculos) — não é um teto, é o número real. A tela usa este
             -- campo para dizer "N serão levadas" ANTES de confirmar, em vez
             -- de "até N" (o total da edição, que mentia numa edição madura
             -- onde quase todas já ativaram).
             -- ⚠️ REVISÃO FINAL (MENOR 3): "ativada" passa a ser
             -- `vessel_stylist_ativada_em()` — A DEFINIÇÃO CANÔNICA da casa
             -- (a primeira chegada numa etapa que liberava Private Edit;
             -- sem ela, o primeiro Private Edit agendado). Convivião até
             -- aqui com a coluna CRUA `vessel_stylists.ativada_em`, que
             -- desde 24/09/2026 NEM é mais a ativação (é "Private Edit
             -- agendado"): a tela de Edições dizia "N não ativaram" por uma
             -- conta e o placar ao lado dizia "ativadas" por outra. Um
             -- critério só, e é o mesmo de `vessel_edicao_encerrar` — as
             -- duas contas têm de andar juntas para a tela não prometer N e
             -- o banco levar outro número.
             'nao_ativadas', (select count(*)::int from public.vessel_stylist_na_edicao n
                           join public.vessel_stylists s on s.id = n.stylist_id
                           where n.edicao_id = e.id and n.saiu_em is null
                             and public.vessel_stylist_ativada_em(s.id) is null
                             and not coalesce(s.teste, false)))
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
  if not public.vessel_pode('atendimentos.edicoes', 'editar') then
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
  v_ed        public.vessel_stylist_circle_edicoes%rowtype;
  v_incluidas int := 0;
begin
  if not public.vessel_pode('atendimentos.edicoes', 'editar') then
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
    return json_build_object('ok', true, 'situacao', 'sem_mudanca', 'incluidas', 0);
  end if;
  if exists (select 1 from public.vessel_stylist_circle_edicoes
              where praca_id = v_ed.praca_id and situacao = 'aberta' and id <> p_id) then
    return json_build_object('ok', false, 'situacao', 'ja_tem_aberta');
  end if;
  update public.vessel_stylist_circle_edicoes set situacao = 'aberta' where id = p_id;

  -- ⚠️ TASK 11: "edição = a rodada daquela praça" (decisão do dono) — o
  -- vínculo é AUTOMÁTICO, não uma escolha manual um a um. Ao abrir, toda
  -- stylist ATIVA e NÃO-teste da praça que ainda não tem NENHUMA linha com
  -- esta edição entra nela — sem isto o placar por edição nascia zerado para
  -- sempre (nenhuma tela chamava `vessel_edicao_incluir_stylist`), calado.
  -- `not exists` na CHAVE INTEIRA (não só `saiu_em is null`): uma stylist
  -- incluída à mão (`vessel_edicao_incluir_stylist`) ANTES de abrir a edição
  -- (a 'planejada' aceita incluir) não pode virar linha duplicada aqui.
  insert into public.vessel_stylist_na_edicao (stylist_id, edicao_id)
  select s.id, p_id
    from public.vessel_stylists s
   where s.praca_id = v_ed.praca_id
     and coalesce(s.ativa, true)
     and not coalesce(s.teste, false)
     and not exists (select 1 from public.vessel_stylist_na_edicao n
                       where n.stylist_id = s.id and n.edicao_id = p_id)
  on conflict (stylist_id, edicao_id) do nothing;
  get diagnostics v_incluidas = row_count;

  return json_build_object('ok', true, 'situacao', 'ok', 'incluidas', v_incluidas);
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
  if not public.vessel_pode('atendimentos.edicoes', 'editar') then
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
  -- ⚠️ TASK 6 RODADA 2 DE CONSERTO (I3 incompleto): `and not coalesce(s.teste,
  -- false)` — o MESMO critério de `nao_ativadas` (vessel_edicoes_listar,
  -- seção 14.2). Sem isto, uma stylist de teste não-ativada na edição contava
  -- como "não vai" para `nao_ativadas` (que já filtrava) mas era LEVADA de
  -- verdade aqui (que não filtrava) — a tela prometia N e o banco levava N+1,
  -- calado. Critério único, o de fora: stylist de teste não conta e não é
  -- levada — nem no congelamento, nem na inclusão no destino.
  -- ⚠️ EFEITO COLATERAL ACEITO (decisão do dono, Rodada 3): o vínculo de uma
  -- stylist de teste que estava na edição na hora do encerramento fica com
  -- `saiu_em` nulo PARA SEMPRE — a função simplesmente não a toca, nem para
  -- fechar nem para levar. Não aparece em nenhuma conta da tela (`stylists`/
  -- `nao_ativadas` já filtram teste) — é o preço do critério único "stylist
  -- de teste não conta e não é levada".
  -- ⚠️ REVISÃO FINAL (MENOR 3): quem "não ativou" é quem
  -- `vessel_stylist_ativada_em()` diz que não ativou — A DEFINIÇÃO
  -- CANÔNICA (a mesma de `vessel_placar_da_edicao` e de `nao_ativadas` em
  -- `vessel_edicoes_listar`), nunca mais a coluna crua `s.ativada_em`, que
  -- desde 24/09/2026 quer dizer outra coisa ("primeiro Private Edit
  -- agendado"). A canônica é um `coalesce` que JÁ INCLUI a coluna crua como
  -- último recurso, então o conjunto de quem é levada só pode DIMINUIR:
  -- ninguém que a conta antiga deixava ficar passa a ser levada.
  with fechados as (
    update public.vessel_stylist_na_edicao n
       set saiu_em = now(), etapa_ao_sair = s.etapa_id
      from public.vessel_stylists s
     where n.stylist_id = s.id and n.edicao_id = p_id and n.saiu_em is null
       and not coalesce(s.teste, false)
    returning n.stylist_id, public.vessel_stylist_ativada_em(s.id) as ativou, s.teste
  )
  -- ⚠️ RODADA 1 DE CONSERTO (CRÍTICO 2): `on conflict ... do nothing` — a
  -- stylist pode já ter um vínculo (fechado ou não) na edição de destino
  -- (ex.: foi incluída nas duas edições antes de a primeira ser encerrada).
  -- Sem isto, a unique `(stylist_id, edicao_id)` estourava 23505 CRU (a tela
  -- recebe erro sem motivo escrito) e — pior — como um erro dentro do bloco
  -- aborta a transação INTEIRA nesta base, o encerramento nem chegava a
  -- congelar ninguém. `get diagnostics` conta só quem foi REALMENTE inserida
  -- (a que deu conflito não entra em `levadas`).
  -- ⚠️ TASK 6 RODADA 2 DE CONSERTO: `not coalesce(f.teste, false)` de novo
  -- aqui — `fechados` já filtra teste (acima), então esta linha nunca
  -- deveria ter nada a barrar; é defesa em profundidade (o pedido explícito
  -- da revisão), não decoração: se um dia o filtro de `fechados` for
  -- afrouxado sem querer, este é quem segura.
  insert into public.vessel_stylist_na_edicao (stylist_id, edicao_id)
  select f.stylist_id, p_levar_para from fechados f
   where f.ativou is null and p_levar_para is not null and not coalesce(f.teste, false)
  on conflict (stylist_id, edicao_id) do nothing;
  get diagnostics v_levadas = row_count;

  return json_build_object('ok', true, 'situacao', 'ok', 'levadas', v_levadas);
end;
$$;

-- incluir uma stylist na edição — recusa se a edição já encerrou. 'editar' em
-- atendimentos.edicoes OU atendimentos.stylist-circle (o quadro do Stylist
-- Circle inclui direto).
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
  if not (public.vessel_pode('atendimentos.edicoes', 'editar')
       or public.vessel_pode('atendimentos.stylist-circle', 'editar')) then
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
  -- ⚠️ REVISÃO FINAL (CRÍTICO 1, irmão do `do update` de
  -- `vessel_stylist_sincronizar_edicao`): a conferência acima só olha
  -- `saiu_em is null`, então incluir quem JÁ SAIU desta edição (mudou de
  -- praça, ou foi levada para a seguinte e voltou) chegava aqui e estourava
  -- `23505` CRU na unique `(stylist_id, edicao_id)` — e nesta base um erro
  -- assim derruba a transação INTEIRA (a mesma lição do Crítico 2 em
  -- `vessel_edicao_encerrar`). Reabrir a linha é exatamente o que a tela
  -- pediu ("inclua esta stylist"), e a edição encerrada já foi barrada lá
  -- em cima — nada de congelado é reaberto por aqui.
  insert into public.vessel_stylist_na_edicao (stylist_id, edicao_id) values (v_stylist_id, p_edicao_id)
  on conflict (stylist_id, edicao_id) do update set saiu_em = null, etapa_ao_sair = null;
  return json_build_object('ok', true, 'situacao', 'ok');
end;
$$;

-- ── 14.3 pré-concessão aditiva ───────────────────────────────────────────────
-- `oferece` = as ações que cada chave nova tem no catálogo. A pessoa recebe a
-- interseção com o que ela já tem em 'atendimentos.stylist-circle' — nunca de
-- graça a quem não tinha a mãe.
create temporary table if not exists _chaves_novas_praca_edicao (chave text primary key, oferece text[]) on commit drop;
insert into _chaves_novas_praca_edicao values
  ('atendimentos.pracas',  array['ver', 'editar']),
  ('atendimentos.edicoes', array['ver', 'editar'])
on conflict (chave) do nothing;

-- O que dar a partir de um mapa de permissões: só as chaves que ele AINDA não
-- tem, com as ações de 'atendimentos.stylist-circle' que cada uma oferece.
-- Vazio se o mapa não tem 'atendimentos.stylist-circle' com 'ver'.
create or replace function pg_temp.o_que_acrescentar_praca_edicao(p jsonb)
returns jsonb
language sql
as $$
  select coalesce(jsonb_object_agg(n.chave, (
           select jsonb_agg(a order by array_position(n.oferece, a))
             from jsonb_array_elements_text(p -> 'atendimentos.stylist-circle') a
            where a = any(n.oferece))), '{}'::jsonb)
    from _chaves_novas_praca_edicao n
   where jsonb_typeof(p) = 'object'
     and jsonb_typeof(p -> 'atendimentos.stylist-circle') = 'array'
     and (p -> 'atendimentos.stylist-circle') ? 'ver'
     and not (p ? n.chave);
$$;

-- 14.3a. As pessoas.
-- ⚠️ TASK 6 RODADA 1 DE CONSERTO (MENOR 1): `features` acompanha, igual ao
-- precedente de 24/09/2026 (2026-09-24-permissoes-das-ferramentas-do-
-- comercial-vessel.sql, passo 2a) — sem isto, `derivar-features.js` (as Edge
-- Functions que leem `features[]`) nunca saberia da chave nova, mesmo com
-- `permissions{}` correto.
update public.profiles p
   set permissions = p.permissions || pg_temp.o_que_acrescentar_praca_edicao(p.permissions),
       features = coalesce(p.features, '{}'::text[]) || array(
         select k from jsonb_object_keys(pg_temp.o_que_acrescentar_praca_edicao(p.permissions)) k
          where not (k = any(coalesce(p.features, '{}'::text[])))
          order by k)
 where not coalesce(p.is_superadmin, false)
   and not coalesce(p.disabled, false)
   and pg_temp.o_que_acrescentar_praca_edicao(p.permissions) <> '{}'::jsonb;

-- 14.3b. Quem tem 'atendimentos.stylist-circle' por EXCEÇÃO ao perfil: a
-- exceção leva junto, senão a próxima regravação do perfil tiraria as chaves
-- novas.
update public.profiles p
   set permissions_excecao = p.permissions_excecao || pg_temp.o_que_acrescentar_praca_edicao(p.permissions_excecao)
 where not coalesce(p.is_superadmin, false)
   and not coalesce(p.disabled, false)
   and pg_temp.o_que_acrescentar_praca_edicao(p.permissions_excecao) <> '{}'::jsonb;

-- 14.3c. Os perfis de acesso que dão 'atendimentos.stylist-circle'.
update public.acessos_perfis ap
   set permissions = ap.permissions || pg_temp.o_que_acrescentar_praca_edicao(ap.permissions)
 where pg_temp.o_que_acrescentar_praca_edicao(ap.permissions) <> '{}'::jsonb;

notify pgrst, 'reload schema';
