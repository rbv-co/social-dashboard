# Praça e Edição no Comercial Vessel — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar praça de verdade (cadastro, com cidades e loja de destino) e edição por praça ao Comercial Vessel, trocando o placar mensal do Stylist Circle pelo placar da edição, e mostrar tudo na DEMO antes de qualquer coisa ir ao ar.

**Architecture:** Uma migration acrescenta quatro tabelas (`vessel_pracas`, `vessel_praca_cidades`, `vessel_stylist_circle_edicoes`, `vessel_stylist_na_edicao`), duas colunas de ligação e as funções `security definer` que as telas chamam. No front, duas telas pequenas de cadastro, um componente de barra `Praça · Edição` usado pelas duas telas grandes, e o placar extraído da `tela-de-stylist-circle.vue` para arquivo próprio. O banco de mentira da demo aprende as mesmas funções, e a demo é publicada por pasta — a Central não muda até o dono aprovar.

**Tech Stack:** Vue 3 `<script setup>` + Vite; Postgres/Supabase (funções `security definer`, RLS por `is_vessel_atendimentos*`); testes `node --test` em `*.test.mjs`; aplicador `coletor/aplicar-*.mjs` com `pg`; demo publicada por `npm run publicar:demonstracao`.

**Spec:** `docs/superpowers/specs/2026-09-25-comercial-vessel-praca-e-edicao-design.md`

## Global Constraints

- **`PADRAO-DA-CENTRAL.md` é obrigatório** e vale para toda linha deste plano. Cor só de token (`var(--...)`), nenhum hex novo; botão só `.btn`, `.btn.btn-principal`, `.btn.btn-perigo`; tamanho de letra só dos cinco degraus (`--texto-etiqueta/corpo/campo/titulo/numero`); texto nunca corta (`overflow-wrap:anywhere`, nunca `ellipsis`); modal segue o item 4; toda entrega medida a **375px e 1440px** num navegador de verdade.
- **A DEMO É O PORTÃO.** Nenhuma migration é aplicada em produção e **nada vai para a `main`** até o dono aprovar na demo. Trabalho todo na branch `comercial/praca-e-edicao`.
- **Receita e "comprou" SAEM dos painéis 1 e 2** enquanto o panorama estiver congelado (0 de 481 `vessel_pedidos` ligados a pessoa).
- **Nome proibido: `vessel_edicoes`** — já existe e é o log de alterações (229 linhas). A tabela nova é `vessel_stylist_circle_edicoes`.
- **Sem movimento automático de etapa** (decisão de 24/09): etapa só muda quando alguém move.
- **Praça nasce como cadastro**: CPS (loja `iguatemi`), SAO, SBO, BSB, **LIM (Limeira)** e **PIR (Piracicaba)** — as duas últimas com `loja_destino` **nula**, à vista como pendência na tela.
- **`npm test` inteiro verde e `npm run build` sem erro** ao fim de cada tarefa.
- Ferramenta/sub-tela nova entra **primeiro** em `src/compartilhado/catalogo-de-ferramentas.js`, com chave própria e pré-concessão aditiva por migration.

---

### Task 1: As regras puras da praça

**Files:**
- Create: `src/ferramentas/comercial-vessel/praca-regras.js`
- Test: `src/ferramentas/comercial-vessel/praca-regras.test.mjs`

**Interfaces:**
- Consumes: nada (primeira tarefa).
- Produces:
  - `achatarCidade(texto) → string` (sem acento, minúscula, espaços colapsados)
  - `pracaDaCidade(cidade, mapa) → { praca_id, sigla, nome, loja_destino } | null`, onde `mapa` é `[{ cidade_chave, praca_id, sigla, nome, loja_destino }]`
  - `pendenciasDePraca(stylists, mapa) → { semPraca: [...stylists], cidadesSemPraca: [string] }`
  - `rotuloDaPraca(praca) → string` — `"Limeira · loja a definir"` quando `loja_destino` é nula

- [ ] **Step 1: Escrever o teste que falha**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { achatarCidade, pracaDaCidade, pendenciasDePraca, rotuloDaPraca } from './praca-regras.js'

const MAPA = [
  { cidade_chave: 'campinas',   praca_id: 1, sigla: 'CPS', nome: 'Campinas',   loja_destino: 'iguatemi' },
  { cidade_chave: 'limeira',    praca_id: 2, sigla: 'LIM', nome: 'Limeira',    loja_destino: null },
  { cidade_chave: 'piracicaba', praca_id: 3, sigla: 'PIR', nome: 'Piracicaba', loja_destino: null },
]

test('achata acento, caixa e espaço sobrando', () => {
  assert.equal(achatarCidade('  SÃO Paulo '), 'sao paulo')
  assert.equal(achatarCidade('Limeira'), 'limeira')
  assert.equal(achatarCidade(null), '')
})

test('acha a praça pela cidade, não importa como foi digitada', () => {
  assert.equal(pracaDaCidade('PIRACICABA', MAPA).sigla, 'PIR')
  assert.equal(pracaDaCidade('  limeira', MAPA).praca_id, 2)
})

test('cidade que não casa devolve nulo — nunca a primeira da lista', () => {
  assert.equal(pracaDaCidade('Limeira / Piracicaba', MAPA), null)
  assert.equal(pracaDaCidade('', MAPA), null)
})

test('pendência lista quem ficou sem praça E as cidades órfãs, sem repetir', () => {
  const stylists = [
    { codigo: 'STY-0001', cidade: 'Campinas',             praca_id: 1 },
    { codigo: 'STY-0002', cidade: 'Limeira / Piracicaba', praca_id: null },
    { codigo: 'STY-0003', cidade: 'Limeira / Piracicaba', praca_id: null },
    { codigo: 'STY-0004', cidade: 'Indaiatuba',           praca_id: null },
  ]
  const p = pendenciasDePraca(stylists, MAPA)
  assert.deepEqual(p.semPraca.map((s) => s.codigo), ['STY-0002', 'STY-0003', 'STY-0004'])
  assert.deepEqual(p.cidadesSemPraca, ['Indaiatuba', 'Limeira / Piracicaba'])
})

test('a loja que falta aparece escrita, nunca vazia', () => {
  assert.equal(rotuloDaPraca(MAPA[0]), 'Campinas · iguatemi')
  assert.equal(rotuloDaPraca(MAPA[1]), 'Limeira · loja a definir')
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd ~/iamundi && node --test src/ferramentas/comercial-vessel/praca-regras.test.mjs`
Expected: FAIL — `Cannot find module './praca-regras.js'`

- [ ] **Step 3: Escrever o mínimo que faz passar**

```js
/* AS REGRAS DA PRAÇA — cidade → praça → loja de destino.
 *
 * ⚠️ POR QUE ISTO NÃO MORA NO `.vue`: a mesma conta é usada pela tela do
 * Stylist Circle, pela do Private Edit e pelo cadastro. Três cópias viram três
 * respostas diferentes no dia em que alguém ajusta uma.
 *
 * ⚠️ CIDADE QUE NÃO CASA DEVOLVE NULO. Chutar a praça "mais provável" manda
 * stylist para a loja errada sem ninguém ver — o dono pediu pendência à vista.
 */
export const achatarCidade = (t) => String(t ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().trim().replace(/\s+/g, ' ')

export function pracaDaCidade(cidade, mapa) {
  const chave = achatarCidade(cidade)
  if (!chave) return null
  const achou = (Array.isArray(mapa) ? mapa : []).find((m) => m.cidade_chave === chave)
  return achou ? { praca_id: achou.praca_id, sigla: achou.sigla, nome: achou.nome, loja_destino: achou.loja_destino ?? null } : null
}

export function pendenciasDePraca(stylists, mapa) {
  const lista = Array.isArray(stylists) ? stylists : []
  const semPraca = lista.filter((s) => !s?.praca_id)
  const cidades = new Set()
  for (const s of semPraca) {
    const nome = String(s?.cidade ?? '').trim()
    if (nome && !pracaDaCidade(nome, mapa)) cidades.add(nome)
  }
  return { semPraca, cidadesSemPraca: [...cidades].sort((a, b) => a.localeCompare(b, 'pt-BR')) }
}

export const rotuloDaPraca = (p) => `${p?.nome ?? ''} · ${p?.loja_destino || 'loja a definir'}`
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test src/ferramentas/comercial-vessel/praca-regras.test.mjs`
Expected: PASS (5 testes)

- [ ] **Step 5: Commitar**

```bash
git add src/ferramentas/comercial-vessel/praca-regras.js src/ferramentas/comercial-vessel/praca-regras.test.mjs
git commit -m "feat(comercial-vessel): regras da praca (cidade -> praca -> loja)"
```

---

### Task 2: As regras puras da edição

**Files:**
- Create: `src/ferramentas/comercial-vessel/edicao-regras.js`
- Test: `src/ferramentas/comercial-vessel/edicao-regras.test.mjs`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `rotuloDaEdicao(e) → string` — `"Limeira · Edição 1"`
  - `edicaoDoEncontro(encontro, edicoes) → edicao | null` — `encontro` é `{ quando, praca_id }` — a edição **daquela praça** cuja janela contém o dia
  - `placarPorEtapa(etapas, stylists) → [{ id, nome, ordem, tipo, stylists }]` — na ordem do funil, **etapa vazia aparece com 0**
  - `SITUACOES_DA_EDICAO = { planejada, aberta, encerrada }`

- [ ] **Step 1: Escrever o teste que falha**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rotuloDaEdicao, edicaoDoEncontro, placarPorEtapa } from './edicao-regras.js'

const EDICOES = [
  { id: 10, praca_id: 2, praca_nome: 'Limeira', numero: 1, comeca_em: '2026-09-01', termina_em: '2026-09-30', situacao: 'encerrada' },
  { id: 11, praca_id: 2, praca_nome: 'Limeira', numero: 2, comeca_em: '2026-10-01', termina_em: null,         situacao: 'aberta' },
  { id: 12, praca_id: 1, praca_nome: 'Campinas', numero: 1, comeca_em: '2026-09-01', termina_em: null,        situacao: 'aberta' },
]

test('o rótulo diz praça e número', () => {
  assert.equal(rotuloDaEdicao(EDICOES[0]), 'Limeira · Edição 1')
})

test('o encontro cai na edição DA PRAÇA DELE cuja janela contém o dia', () => {
  assert.equal(edicaoDoEncontro({ quando: '2026-09-15T19:00:00Z', praca_id: 2 }, EDICOES).id, 10)
  assert.equal(edicaoDoEncontro({ quando: '2026-10-20T19:00:00Z', praca_id: 2 }, EDICOES).id, 11)
  // mesma data, outra praça: nunca pega a edição da vizinha
  assert.equal(edicaoDoEncontro({ quando: '2026-09-15T19:00:00Z', praca_id: 1 }, EDICOES).id, 12)
})

test('edição sem fim vale daí em diante, e fora de tudo é nulo (nunca escondido)', () => {
  assert.equal(edicaoDoEncontro({ quando: '2027-01-01T12:00:00Z', praca_id: 2 }, EDICOES).id, 11)
  assert.equal(edicaoDoEncontro({ quando: '2026-08-01T12:00:00Z', praca_id: 2 }, EDICOES), null)
  assert.equal(edicaoDoEncontro({ quando: null, praca_id: 2 }, EDICOES), null)
})

test('o placar traz TODAS as etapas na ordem, inclusive as de zero', () => {
  const etapas = [
    { id: 1, nome: 'Identificado', ordem: 1, tipo: 'funil' },
    { id: 2, nome: 'Conversado',   ordem: 2, tipo: 'funil' },
    { id: 3, nome: 'Prospectado',  ordem: 3, tipo: 'funil' },
    { id: 9, nome: 'Ativada',      ordem: 9, tipo: 'saida' },
  ]
  const stylists = [{ etapa_id: 1 }, { etapa_id: 1 }, { etapa_id: 3 }, { etapa_id: null }]
  assert.deepEqual(placarPorEtapa(etapas, stylists), [
    { id: 1, nome: 'Identificado', ordem: 1, tipo: 'funil', stylists: 2 },
    { id: 2, nome: 'Conversado',   ordem: 2, tipo: 'funil', stylists: 0 },
    { id: 3, nome: 'Prospectado',  ordem: 3, tipo: 'funil', stylists: 1 },
    { id: 9, nome: 'Ativada',      ordem: 9, tipo: 'saida', stylists: 0 },
  ])
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test src/ferramentas/comercial-vessel/edicao-regras.test.mjs`
Expected: FAIL — módulo não existe

- [ ] **Step 3: Escrever o mínimo que faz passar**

```js
/* AS REGRAS DA EDIÇÃO — a rodada do Stylist Circle, POR PRAÇA.
 *
 * Decisão do dono (25/09/2026): o placar não é mensal, é da edição. Limeira
 * pode estar na edição 2 com Campinas na 1 — por isso a edição pertence a uma
 * praça, e nunca ao calendário.
 *
 * ⚠️ O ENCONTRO NÃO GUARDA EDIÇÃO: ele pertence à edição da praça dele cuja
 * janela contém o dia. Guardar a edição no encontro faria a mesma data virar
 * duas edições diferentes se alguém corrigisse a janela depois.
 * ⚠️ Encontro fora de qualquer janela devolve NULO e a tela escreve "fora de
 * edição". Sumir com ele seria a tela mentindo.
 */
export const SITUACOES_DA_EDICAO = { planejada: 'Planejada', aberta: 'Aberta', encerrada: 'Encerrada' }

export const rotuloDaEdicao = (e) => `${e?.praca_nome ?? ''} · Edição ${e?.numero ?? '?'}`

const dia = (q) => (q ? String(q).slice(0, 10) : '')

export function edicaoDoEncontro(encontro, edicoes) {
  const d = dia(encontro?.quando)
  if (!d) return null
  return (Array.isArray(edicoes) ? edicoes : []).find((e) => e.praca_id === encontro?.praca_id
    && dia(e.comeca_em) <= d
    && (!e.termina_em || d <= dia(e.termina_em))) || null
}

export function placarPorEtapa(etapas, stylists) {
  const lista = Array.isArray(stylists) ? stylists : []
  return [...(Array.isArray(etapas) ? etapas : [])]
    .sort((a, b) => a.ordem - b.ordem)
    .map((e) => ({ id: e.id, nome: e.nome, ordem: e.ordem, tipo: e.tipo,
      stylists: lista.filter((s) => s?.etapa_id === e.id).length }))
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test src/ferramentas/comercial-vessel/edicao-regras.test.mjs`
Expected: PASS (4 testes)

- [ ] **Step 5: Commitar**

```bash
git add src/ferramentas/comercial-vessel/edicao-regras.js src/ferramentas/comercial-vessel/edicao-regras.test.mjs
git commit -m "feat(comercial-vessel): regras da edicao por praca"
```

---

### Task 3: Migration — as quatro tabelas e a migração dos dados

**Files:**
- Create: `db/migrations/2026-09-25-vessel-praca-e-edicao.sql`
- Create: `coletor/aplicar-vessel-praca-e-edicao.mjs`

**Interfaces:**
- Consumes: nada do front.
- Produces (tabelas, usadas pelas Tasks 4, 5 e 9):
  - `vessel_pracas(id bigserial pk, sigla text unique, nome text, loja_destino text null, ordem int, ativa boolean default true, criado_em timestamptz default now())`
  - `vessel_praca_cidades(id bigserial pk, praca_id bigint fk, cidade text, cidade_chave text unique, criado_em)`
  - `vessel_stylist_circle_edicoes(id bigserial pk, praca_id bigint fk, numero int, nome text, comeca_em date, termina_em date null, situacao text check in ('planejada','aberta','encerrada') default 'planejada', criado_em, unique(praca_id, numero))`
  - `vessel_stylist_na_edicao(id bigserial pk, stylist_id bigint fk, edicao_id bigint fk, entrou_em timestamptz default now(), saiu_em timestamptz null, etapa_ao_sair bigint null, unique(stylist_id, edicao_id))`
  - Colunas: `vessel_stylists.praca_id bigint null`, `vessel_private_edits.praca_id bigint null`

- [ ] **Step 1: Escrever o cabeçalho e as tabelas da migration**

Cabeçalho no padrão da casa (o porquê antes do quê), depois:

```sql
-- ── 1. as praças ────────────────────────────────────────────────────────────
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

create table if not exists public.vessel_praca_cidades (
  id           bigserial primary key,
  praca_id     bigint not null references public.vessel_pracas(id) on delete cascade,
  cidade       text not null,
  cidade_chave text not null unique,       -- sem acento, minúscula: a mesma conta do front
  criado_em    timestamptz not null default now()
);
alter table public.vessel_praca_cidades enable row level security;
revoke all on table public.vessel_praca_cidades from anon, authenticated;

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

alter table public.vessel_stylists      add column if not exists praca_id bigint references public.vessel_pracas(id);
alter table public.vessel_private_edits add column if not exists praca_id bigint references public.vessel_pracas(id);
```

- [ ] **Step 2: Escrever a carga inicial e a migração dos dados**

⚠️ Medido em 25/09: 27 Campinas, 18 Limeira, 17 Piracicaba, 1 "Limeira / Piracicaba". A última fica **sem praça de propósito**.

```sql
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

-- a praça de cada stylist sai da CIDADE dela; quem não casa fica nula e vira
-- pendência na tela (a "Limeira / Piracicaba" é exatamente este caso)
-- ⚠️ `unaccent` NÃO EXISTE nesta base (medido em 25/09/2026: nenhuma linha em
-- `pg_extension`). Nada de instalar extensão por conta própria — a conta é
-- feita com `translate`, e é ESTA a mesma conta do `achatarCidade` do front.
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
```

- [ ] **Step 3: Escrever o aplicador, espelhando `coletor/aplicar-vessel-stylist-funil-configuravel.mjs`**

Obrigatório, no mesmo molde: tudo numa transação só; aplicar → registrar → provar → `commit` conferido por `.command === 'COMMIT'`; provas em **savepoints desfeitos**; impressão das tabelas reais conferida antes, depois do desfazer e, quando grava, numa conexão nova. Duas portas: sem argumento = ensaio que desfaz; `--gravar` = grava.

⚠️ **Nenhuma conta ou stylist de prova pode sobrar** — as provas nascem e morrem dentro do savepoint, com `finally`.

- [ ] **Step 4: Rodar o ENSAIO (não grava nada)**

Run: `cd ~/iamundi && node coletor/aplicar-vessel-praca-e-edicao.mjs`
Expected: todas as provas passam e a saída termina dizendo que **desfez**; `select count(*) from vessel_pracas` pelo MCP continua dando erro de tabela inexistente.

- [ ] **Step 5: Commitar**

```bash
git add db/migrations/2026-09-25-vessel-praca-e-edicao.sql coletor/aplicar-vessel-praca-e-edicao.mjs
git commit -m "feat(db): tabelas de praca e edicao do stylist circle (ensaio verde, nao gravado)"
```

---

### Task 4: Migration — as funções de cadastro

**Files:**
- Modify: `db/migrations/2026-09-25-vessel-praca-e-edicao.sql`
- Modify: `coletor/aplicar-vessel-praca-e-edicao.mjs`

**Interfaces:**
- Consumes: as tabelas da Task 3.
- Produces (as portas que o front chama nas Tasks 6, 7, 8 e que o banco de mentira imita na Task 9):
  - `vessel_pracas_listar() → json` — `[{ id, sigla, nome, loja_destino, ativa, cidades: [{id, cidade}], stylists: int }]`
  - `vessel_praca_criar(p_sigla text, p_nome text, p_loja_destino text) → json {ok, situacao, id}`
  - `vessel_praca_editar(p_id bigint, p_nome text, p_loja_destino text, p_ativa boolean) → json {ok, situacao}`
  - `vessel_praca_cidade_vincular(p_praca_id bigint, p_cidade text) → json {ok, situacao, id}`
  - `vessel_praca_cidade_desvincular(p_id bigint) → json {ok, situacao}`
  - `vessel_stylist_definir_praca(p_codigo text, p_praca_id bigint) → json {ok, situacao}`
  - `vessel_edicoes_listar(p_praca_id bigint) → json` — `[{ id, praca_id, praca_nome, numero, nome, comeca_em, termina_em, situacao, stylists: int }]`
  - `vessel_edicao_criar(p_praca_id bigint, p_nome text, p_comeca_em date, p_termina_em date) → json {ok, situacao, id, numero}` — `numero` = maior da praça + 1
  - `vessel_edicao_abrir(p_id bigint) → json {ok, situacao}` — só uma aberta por praça
  - `vessel_edicao_encerrar(p_id bigint, p_levar_para bigint) → json {ok, situacao, levadas: int}`
  - `vessel_edicao_incluir_stylist(p_codigo text, p_edicao_id bigint) → json {ok, situacao}`

- [ ] **Step 1: Escrever as funções**

Todas `language plpgsql`, `security definer`, `set search_path to 'public'`. Leitura pede `is_vessel_atendimentos()`, escrita pede `is_vessel_atendimentos_editar()` e devolve `{"ok":false,"situacao":"sem_permissao"}` — **nunca** `raise` numa função de escrita (a tela precisa do motivo escrito).

Regras que precisam estar no banco, não só na tela:
- `vessel_praca_criar`: sigla em maiúscula, 3 letras, única → `situacao: 'sigla_repetida'`.
- `vessel_praca_cidade_vincular`: grava `cidade_chave` com `public.vessel_achatar_cidade(p_cidade)` — **a mesma conta do front** (`achatarCidade`), e há teste provando que as duas dão o mesmo resultado para 'São Paulo', 'LIMEIRA ' e 'Limeira / Piracicaba'; já vinculada a outra praça → `situacao: 'cidade_em_outra_praca'` com o nome da praça junto.
- `vessel_edicao_abrir`: se já houver `aberta` naquela praça → `situacao: 'ja_tem_aberta'`.
- `vessel_edicao_encerrar(p_id, p_levar_para)`: marca `situacao='encerrada'`, fecha (`saiu_em = now()`, `etapa_ao_sair = etapa atual`) **os vínculos de quem NÃO ativou** e, se `p_levar_para` não for nulo, abre vínculo novo delas na edição de destino. Quem ativou fica com o vínculo fechado e **não** é levada.
- `vessel_edicao_incluir_stylist`: recusa com `situacao: 'edicao_encerrada'` se a edição já encerrou (⚠️ é isso que impede o passado de mudar).

- [ ] **Step 2: Grants — a lista do fim da migration**

⚠️ `grant` não é o portão (o portão é o `is_vessel_*` dentro da função), mas **sem ele a tela toma 404 do PostgREST**. As duas linhas de cada função são obrigatórias:

```sql
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
```

- [ ] **Step 3: Provas no aplicador — a trava tem de DEIXAR PASSAR e tem de BARRAR**

Dentro de savepoints desfeitos, falando como gente de verdade (perfil de mentira + `request.jwt.claims`):

1. quem tem `atendimentos.editar` cria praça, vincula cidade, cria edição e inclui stylist — **tem de funcionar** (prova que a trava deixa passar; trava que só barra passa no teste e quebra o programa);
2. quem só tem `ver` toma `sem_permissao` em cada uma das seis funções de escrita;
3. cidade já vinculada devolve `cidade_em_outra_praca`, e **nada** foi gravado;
4. abrir a segunda edição da mesma praça devolve `ja_tem_aberta`;
5. incluir stylist em edição encerrada devolve `edicao_encerrada`.

- [ ] **Step 4: Rodar o ensaio inteiro**

Run: `node coletor/aplicar-vessel-praca-e-edicao.mjs`
Expected: todas as provas passam, desfaz ao fim, e a impressão das tabelas reais é idêntica antes e depois.

- [ ] **Step 5: Commitar**

```bash
git add db/migrations/2026-09-25-vessel-praca-e-edicao.sql coletor/aplicar-vessel-praca-e-edicao.mjs
git commit -m "feat(db): funcoes de cadastro de praca e edicao, com provas nos dois sentidos"
```

---

### Task 5: Migration — o placar da edição e a lista recortada

**Files:**
- Modify: `db/migrations/2026-09-25-vessel-praca-e-edicao.sql`
- Modify: `coletor/aplicar-vessel-praca-e-edicao.mjs`

**Interfaces:**
- Consumes: Tasks 3 e 4.
- Produces:
  - `vessel_placar_da_edicao(p_edicao_id bigint) → json` com:
    `{ edicao: {...}, etapas: [{ id, nome, ordem, tipo, stylists }], prospectadas, prospectadas_ja_ativadas, ativadas, com_private_edit_agendado, com_private_edit_realizado, recorrentes_no_periodo, encontros_agendados, encontros_realizados, encontros_cancelados, convidadas, confirmadas, presentes, confirmadas_em_realizados, presentes_em_realizados }`
    ⚠️ **Sem `receita`, sem `vendas`, sem `compradoras`, sem `ticket`** — o panorama está congelado, e zero na tela mente.
  - `vessel_rastreio_dos_stylists(p_dias integer, p_incluir_desativadas boolean, p_praca_id bigint, p_edicao_id bigint)` — a de hoje ganha dois filtros e passa a devolver também `praca_id`, `praca_sigla`, `praca_nome`, `loja_destino`, `edicao_id`.

- [ ] **Step 1: Trocar a assinatura da lista — com cuidado**

⚠️ `create or replace` **não acrescenta parâmetro**: ele cria uma SEGUNDA função com outra assinatura, e o PostgREST passa a ter duas. A ordem certa é:

```sql
create or replace function public.vessel_rastreio_dos_stylists(
  p_dias integer default 7, p_incluir_desativadas boolean default false,
  p_praca_id bigint default null, p_edicao_id bigint default null)
returns json language plpgsql stable security definer set search_path to 'public'
as $function$ /* … corpo … */ $function$;

drop function if exists public.vessel_rastreio_dos_stylists(integer, boolean);
revoke all on function public.vessel_rastreio_dos_stylists(integer, boolean, bigint, bigint) from public, anon;
grant execute on function public.vessel_rastreio_dos_stylists(integer, boolean, bigint, bigint) to authenticated;
```

⚠️ A Central **que está no ar hoje** chama a versão de 2 parâmetros. Como nada disto vai para a `main` antes do aval, a troca é segura — mas o `drop` tem de estar na MESMA migration do `create`, senão sobra fantasma.

- [ ] **Step 2: Escrever `vessel_placar_da_edicao`**

Conta sobre **as stylists ligadas àquela edição** por `vessel_stylist_na_edicao` (não por data de calendário):
- `etapas`: **todas** as etapas ativas, na ordem, com a contagem de quem está nela hoje — etapa de zero aparece.
- as taxas continuam sendo da turma, como já são em `t11-regras.js`: a mesma turma em cima e embaixo.
- os encontros contam os `vessel_private_edits` **da praça da edição** cujo `quando` cai na janela dela.

- [ ] **Step 3: A prova que importa — mutação do recorte**

No aplicador, montar duas praças com duas edições e stylists nas duas, e provar:

1. o placar da edição de Limeira **não** conta stylist de Campinas (mutação: trocar o `where` por `1=1` tem de REPROVAR a prova);
2. mover uma stylist para a edição 2 e conferir que o placar da **edição 1 encerrada não mudou** — o número de antes é guardado e comparado;
3. um encontro fora de qualquer janela **aparece** como fora de edição, não some;
4. a resposta **não traz** nenhuma chave de receita (`assert` explícito na lista de chaves).

- [ ] **Step 4: Rodar o ensaio inteiro**

Run: `node coletor/aplicar-vessel-praca-e-edicao.mjs`
Expected: verde e desfeito.

- [ ] **Step 5: Commitar**

```bash
git add db/migrations/2026-09-25-vessel-praca-e-edicao.sql coletor/aplicar-vessel-praca-e-edicao.mjs
git commit -m "feat(db): placar da edicao e lista recortada por praca"
```

---

### Task 6: Catálogo de permissões e as duas telas de cadastro

**Files:**
- Modify: `src/compartilhado/catalogo-de-ferramentas.js`
- Modify: `db/migrations/2026-09-25-vessel-praca-e-edicao.sql` (pré-concessão aditiva)
- Create: `src/ferramentas/comercial-vessel/tela-de-pracas.vue`
- Create: `src/ferramentas/comercial-vessel/tela-de-edicoes.vue`
- Modify: `src/ferramentas/comercial-vessel/tela-de-menu-comercial-vessel.vue`
- Modify: `src/mapa-de-enderecos.js`

**Interfaces:**
- Consumes: `vessel_pracas_listar`, `vessel_praca_*`, `vessel_edicoes_listar`, `vessel_edicao_*` (Task 4); `rotuloDaPraca` (Task 1); `rotuloDaEdicao`, `SITUACOES_DA_EDICAO` (Task 2).
- Produces: rotas `pracas` e `edicoes`, chaves `atendimentos.pracas` e `atendimentos.edicoes`.

- [ ] **Step 1: Escrever o teste do catálogo**

O `catalogo-de-ferramentas.test.mjs` já reprova rota/cartão/chave fora do catálogo — acrescentar as duas rotas e rodar:

Run: `node --test src/compartilhado/catalogo-de-ferramentas.test.mjs`
Expected: FAIL enquanto as chaves não existirem

- [ ] **Step 2: Acrescentar ao catálogo**

```js
{ key: 'atendimentos.pracas',  label: 'Praças',  acoes: ['ver', 'editar'], grupo: 'atendimentos', rotas: ['pracas'] },
{ key: 'atendimentos.edicoes', label: 'Edições', acoes: ['ver', 'editar'], grupo: 'atendimentos', rotas: ['edicoes'] },
```

E na migration, a pré-concessão **aditiva**: quem já tem `atendimentos.stylist-circle` (ver/editar) ganha as duas novas na mesma ação. ⚠️ Nunca dar de graça a quem não tinha a mãe.

- [ ] **Step 3: Escrever as duas telas**

`tela-de-pracas.vue`: lista das praças com sigla, nome, **loja de destino ou "loja a definir"** em `.selo.selo-atencao`, as cidades de cada uma (acrescentar/remover) e quantas stylists estão nela. Botão principal um só por bloco. Cartão, não tabela, a partir de 640px para baixo.

`tela-de-edicoes.vue`: escolhe a praça, lista as edições dela (número, nome, janela, situação em `.selo`), cria, abre e encerra. Ao encerrar, pergunta **para qual edição levar quem não ativou** — e diz quantas serão levadas antes de confirmar.

⚠️ Erro de leitura vira **mensagem do erro**, nunca lista vazia. ⚠️ `sbClient`, nunca `sb()`.

- [ ] **Step 4: Rodar a suíte e o build**

Run: `npm test && npm run build`
Expected: PASS e build sem erro

- [ ] **Step 5: Commitar**

```bash
git add src/compartilhado/catalogo-de-ferramentas.js src/ferramentas/comercial-vessel/tela-de-pracas.vue src/ferramentas/comercial-vessel/tela-de-edicoes.vue src/ferramentas/comercial-vessel/tela-de-menu-comercial-vessel.vue src/mapa-de-enderecos.js db/migrations/2026-09-25-vessel-praca-e-edicao.sql
git commit -m "feat(comercial-vessel): cadastros de praca e edicao"
```

---

### Task 7: O Stylist Circle — barra Praça · Edição e o placar da edição

**Files:**
- Create: `src/ferramentas/comercial-vessel/barra-de-praca-e-edicao.vue`
- Create: `src/ferramentas/comercial-vessel/placar-do-stylist-circle.vue`
- Modify: `src/ferramentas/comercial-vessel/tela-de-stylist-circle.vue`
- Modify: `src/ferramentas/comercial-vessel/t11-regras.js`
- Test: `src/ferramentas/comercial-vessel/t11-regras.test.mjs`

**Interfaces:**
- Consumes: `vessel_placar_da_edicao`, `vessel_rastreio_dos_stylists(p_dias, p_incluir_desativadas, p_praca_id, p_edicao_id)`, `placarPorEtapa`, `rotuloDaEdicao`, `pendenciasDePraca`.
- Produces: `<barra-de-praca-e-edicao v-model:praca="..." v-model:edicao="..." :pracas :edicoes />` (usada também na Task 8) e `<placar-do-stylist-circle :placar />`.

- [ ] **Step 1: Teste — o placar da edição não tem receita e mantém as taxas**

Acrescentar a `t11-regras.test.mjs`: `taxasDoPlacar` de uma resposta **sem** chaves de receita não pode devolver `ticket`/`receitaPorConvidada`/`receitaPorEncontro`; `sequenciaDoPlacar` continua nos cinco passos com as mesmas taxas da turma.

Run: `node --test src/ferramentas/comercial-vessel/t11-regras.test.mjs`
Expected: FAIL

- [ ] **Step 2: Ajustar `t11-regras.js`**

Tirar as razões de receita do placar (ficam mortas com o panorama congelado) e trocar `PERIODOS_DO_PLACAR`/`periodoDoPlacar` por uso da edição. ⚠️ `periodoDoPlacar` **continua existindo** para as listas — só sai do placar.

- [ ] **Step 3: Extrair o placar e pôr a barra**

O bloco do placar sai da `tela-de-stylist-circle.vue` (66 KB) para `placar-do-stylist-circle.vue`: em cima, **uma caixa por etapa do funil, na ordem, com o número grande**; embaixo, num bloco menor, as taxas da turma. A barra fica acima de tudo e recorta placar, quadro e lista. Sem praça escolhida: mostra todas, com o aviso `"N stylists sem praça"` em `.selo.selo-atencao` que **abre a tela de Praças**.

⚠️ Item 8 do padrão: **listar o que existia antes e conferir item a item** — nada do placar de hoje pode sumir na mudança de casa, exceto a receita, que sai por decisão registrada.

- [ ] **Step 4: Rodar tudo e medir a 375px**

Run: `npm test && npm run build`
Depois: `npm run dev -- --port 5199 --strictPort`, abrir a tela e medir os quatro critérios do item 6 do padrão (rolagem horizontal 0, alvo ≥40px, fonte de campo ≥16px, nada cortado), a 375px **e** a 1440px, nos dois temas.

- [ ] **Step 5: Commitar**

```bash
git add src/ferramentas/comercial-vessel/
git commit -m "feat(stylist-circle): barra praca+edicao e placar da edicao por etapa"
```

---

### Task 8: O Private Edit — a mesma barra, a praça do cadastro, a receita fora

**Files:**
- Modify: `src/ferramentas/comercial-vessel/tela-de-private-edit.vue`
- Modify: `src/ferramentas/comercial-vessel/agenda-regras.js`
- Test: `src/ferramentas/comercial-vessel/agenda-regras.test.mjs`

**Interfaces:**
- Consumes: `barra-de-praca-e-edicao.vue` (Task 7), `edicaoDoEncontro` (Task 2), `vessel_pracas_listar` (Task 4).
- Produces: nada novo.

- [ ] **Step 1: Teste — a lista `PRACAS` cravada morre**

Acrescentar a `agenda-regras.test.mjs` um teste que prova que `lugarDoItem` escreve o nome da praça **vinda do cadastro** (recebido por parâmetro), e que praça desconhecida aparece pela sigla, nunca em branco.

Run: `node --test src/ferramentas/comercial-vessel/agenda-regras.test.mjs`
Expected: FAIL

- [ ] **Step 2: Tirar as três cópias da constante**

Apagar `PRACAS` de `agenda-regras.js:34`, `tela-de-stylist-circle.vue:764` e `tela-de-private-edit.vue:527`; as três passam a ler o cadastro. ⚠️ Conferir com `grep -rn "PRACAS" src/` que não sobrou nenhuma.

- [ ] **Step 3: Barra e saída da receita**

A barra no topo; o encontro mostra a edição dele (`edicaoDoEncontro`) ou **"fora de edição"**; a coluna/линha de receita sai do cartão do encontro e do bloco "Todos os encontros juntos", com o restante intacto (item 8 do padrão: conferir item a item).

- [ ] **Step 4: Rodar tudo e medir**

Run: `npm test && npm run build` e a medição a 375px/1440px nos dois temas.

- [ ] **Step 5: Commitar**

```bash
git add src/ferramentas/comercial-vessel/
git commit -m "feat(private-edit): praca do cadastro, barra da edicao e receita fora"
```

---

### Task 9: A demo aprende praça e edição

**Files:**
- Modify: `src/demonstracao/banco-de-mentira.js`
- Modify: `src/demonstracao/dados-iniciais.js`
- Modify: `src/demonstracao/roteiro.js`
- Test: `src/demonstracao/banco-de-mentira.test.mjs`, `src/demonstracao/roteiro.test.mjs`

**Interfaces:**
- Consumes: as onze funções da Task 4 e as duas da Task 5 — **os mesmos nomes e os mesmos corpos de resposta**.
- Produces: demo com o cenário de verdade.

- [ ] **Step 1: Teste — função que a tela chama existe no banco de mentira**

Escrever o teste que percorre as chamadas `rpc('vessel_…')` dos `.vue` do Comercial Vessel e exige que cada nome exista no banco de mentira. ⚠️ Função desconhecida na demo vira faixa de erro — certo, mas não é o que vamos mostrar ao dono.

Run: `node --test src/demonstracao/banco-de-mentira.test.mjs`
Expected: FAIL nomeando as funções que faltam

- [ ] **Step 2: Implementar as funções no banco de mentira**

Mesmas recusas do banco de verdade (`sem_permissao`, `cidade_em_outra_praca`, `ja_tem_aberta`, `edicao_encerrada`) — demo que aceita o que o banco recusa ensina errado.

- [ ] **Step 3: O cenário de verdade em `dados-iniciais.js`**

63 stylists nas quatro cidades (27 Campinas, 18 Limeira, 17 Piracicaba, 1 "Limeira / Piracicaba" **sem praça**, para a pendência aparecer), praças CPS/SAO/SBO/BSB/LIM/PIR com LIM e PIR sem loja, **Limeira com a Edição 1 aberta** e alguns encontros dentro e um fora da janela.

- [ ] **Step 4: Rodar tudo**

Run: `npm test && npm run build:demonstracao`
Expected: PASS e build da demo sem erro

- [ ] **Step 5: Commitar**

```bash
git add src/demonstracao/
git commit -m "feat(demo): praca e edicao no banco de mentira, com o cenario de verdade"
```

---

### Task 10: Publicar a demo e conferir no ar

**Files:**
- Modify: `docs/pendencias.md` (a pendência da loja de LIM e PIR, e o panorama congelado)

**Interfaces:**
- Consumes: tudo acima.
- Produces: o endereço para o dono olhar.

- [ ] **Step 1: Publicar**

Run: `cd ~/iamundi && npm run publicar:demonstracao`
⚠️ **Nunca** `vercel switch` nem `gh auth switch` (derruba a outra janela). O login por pasta é o `--global-config ~/.vercel-iamundi`, já no script.

- [ ] **Step 2: Passear pelas ferramentas (conferência obrigatória de toda publicação)**

Run: `DEMO=https://vessel-demonstracao.vercel.app PLAYWRIGHT=<playwright-core> node src/demonstracao/passeio-pelas-ferramentas.mjs`
Expected: nenhuma tela branca, nenhuma faixa de erro

- [ ] **Step 3: Fotografar a 375px e a 1440px**

Stylist Circle e Private Edit, com praça escolhida, sem praça escolhida e com a pendência à vista; os dois temas. As fotos vão para a pasta de entregas com data e hora no nome.

- [ ] **Step 4: Registrar as pendências**

Em `docs/pendencias.md`: (a) **loja de destino de Limeira e Piracicaba — resposta do Breno**; (b) **panorama congelado: destrava quando a venda casar com a pessoa (0 de 481 pedidos)**.

- [ ] **Step 5: Commitar e PARAR**

```bash
git add docs/pendencias.md
git commit -m "docs: pendencias de praca e o que destrava o panorama"
```

⚠️ **O PORTÃO É AQUI.** Não fazer merge na `main`, não aplicar a migration em produção, não publicar a Central. O dono mostra a demo ao Breno; só com o "pode" dele é que vêm, nesta ordem: `node coletor/aplicar-vessel-praca-e-edicao.mjs --gravar` → PR → merge → fotos no ar.
