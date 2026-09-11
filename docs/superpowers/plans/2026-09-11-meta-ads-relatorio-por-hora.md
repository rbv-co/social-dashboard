# Meta Ads — Relatório por Hora Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar o módulo "Relatório por Hora" do Meta Ads: coleta nova de hora
em hora (gasto e conversas iniciadas por campanha, com delta calculado), e uma
tela que mostra isso agrupado por dia (expansível) e por hora.

**Architecture:** Uma tabela nova (`campaign_insights_hora`) alimentada por um
robô novo (`coletar-dados-hora`, Edge Function) agendado de hora em hora via
`pg_cron`/`disparar_robo` — mesmo mecanismo já usado por `coletar-dados` e
`conteudo-hora-h`. A tela lê essa tabela via `sb()` (REST/PostgREST) e usa um
módulo `.js` puro para agrupar dia → hora → campanha e calcular custo por
lead. Permissão nova (`meta.hora`) no catálogo `RECURSOS` já existente.

**Tech Stack:** Vue 3 `<script setup>`, Supabase (Postgres + Edge Functions em
Deno), `node --test` para os módulos puros, `pg_cron` para o agendamento.

**Spec:** `docs/superpowers/specs/2026-09-11-meta-ads-relatorio-por-hora-design.md`

## Global Constraints

- Cor só de token (`var(--accent)`, etc.) — nenhum hex novo. Botão só nas 3
  classes (`.btn`, `.btn.btn-principal`, `.btn.btn-perigo`), altura mínima
  40px. (PADRAO-DA-CENTRAL.md §2-3)
- Texto nunca corta: `overflow-wrap: anywhere`, nunca `text-overflow: ellipsis`
  em nome/título. (§5)
- A tela final precisa ser medida a 375px de verdade num navegador: 0 rolagem
  horizontal, alvo de toque ≥40px, fonte de campo ≥16px, nenhum texto cortado.
  (§6, item 10 do padrão)
- Leitura que falha mostra o erro (via `faixa-de-erro.vue`), nunca vira lista
  vazia silenciosa. Campanha sem conversa mostra "—", nunca "R$ 0,00" de
  custo por lead. (§9 do padrão; §5 da spec)
- Sem Excel/PDF, sem backfill de dias anteriores, sem filtro por
  conta/campanha nesta primeira entrega (YAGNI — spec §8).
- Robô novo autentica com segredo próprio em `segredos_de_cron`
  (`exigirSegredoDeCron`) — nunca a anon key. (spec §4)
- Toda pasta `.js` tocada leva `.test.mjs` ao lado; `meta-ads/` ganha
  `imports.test.mjs` (ainda não existe — Task 10).

---

### Task 1: Tabela `campaign_insights_hora` + RLS

**Files:**
- Create: `db/migrations/2026-09-11-meta-ads-hora-tabela.sql`

**Interfaces:**
- Produces: tabela `public.campaign_insights_hora` com colunas
  `campaign_id text`, `account_id uuid`, `dia date`, `hora smallint`,
  `gasto_acumulado numeric(12,2)`, `conversas_acumuladas integer`,
  `gasto_hora numeric(12,2)`, `conversas_hora integer`,
  `coletado_em timestamptz`. Chave única
  `(campaign_id, account_id, dia, hora)`. Usada pelas Tasks 4 e 9.

- [ ] **Step 1: Escrever a migration**

```sql
-- CAMPANHA POR HORA: gasto e conversas iniciadas, de hora em hora, com delta
-- já calculado (não recorte nativo da Meta — ver
-- docs/superpowers/specs/2026-09-11-meta-ads-relatorio-por-hora-design.md).
--
-- Nome espelha `campaign_insights` de propósito: mesma entidade (campanha x
-- dia), com uma dimensão a mais (hora) e as colunas de conversa que
-- `campaign_insights` não tem.
create table public.campaign_insights_hora (
  campaign_id          text        not null,
  -- Sem FK para accounts/campaigns de propósito — mesmo desenho solto que
  -- `campaign_insights` já usa (spec §3). Ambas são sincronizadas por
  -- convenção, não por integridade referencial.
  account_id           uuid        not null,
  dia                  date        not null,
  hora                 smallint    not null check (hora between 0 and 23),
  -- Cru: o que a Meta respondeu para "o dia até agora", no momento da rodada.
  -- Fica gravado para auditoria — se o delta parecer errado, dá pra conferir
  -- contra a fonte sem precisar disparar a Meta de novo.
  gasto_acumulado      numeric(12,2) not null default 0,
  conversas_acumuladas integer     not null default 0,
  -- O que a tela lê: a diferença já calculada pelo robô contra a última
  -- leitura gravada naquele dia (não necessariamente hora-1 — uma rodada
  -- perdida não pode fazer a próxima parecer negativa ou duplicada).
  gasto_hora           numeric(12,2) not null default 0,
  conversas_hora       integer     not null default 0,
  coletado_em          timestamptz not null default now(),
  unique (campaign_id, account_id, dia, hora)
);

comment on table public.campaign_insights_hora is
  'Gasto e conversas iniciadas por campanha, de hora em hora, com delta já '
  'calculado. Alimentada pela Edge Function coletar-dados-hora.';

alter table public.campaign_insights_hora enable row level security;

-- Mesma trava das outras 19 tabelas com account_id
-- (db/migrations/2026-07-31-allowed-accounts-no-banco.sql). Entra aqui em vez
-- de alterar aquela migration, que já rodou.
create policy so_contas_permitidas on public.campaign_insights_hora
  as restrictive for select to authenticated
  using (public.pode_ver_conta(account_id::text));
```

- [ ] **Step 2: Aplicar a migration**

Run: `cd coletor && node run-migrations.mjs --dry` (confere que ela aparece na
lista do que vai rodar) e depois `node run-migrations.mjs` (aplica de
verdade). Idempotente — rodar de novo não re-aplica.

- [ ] **Step 3: Conferir no banco**

Run (via `psql`/Supabase SQL editor, ou `node run-migrations.mjs --dry` de
novo — se não aparecer mais como pendente, aplicou):
```sql
select column_name, data_type from information_schema.columns
 where table_name = 'campaign_insights_hora' order by ordinal_position;
select policyname from pg_policies where tablename = 'campaign_insights_hora';
```
Expected: as 9 colunas da Step 1, e a policy `so_contas_permitidas` listada.

- [ ] **Step 4: Commit**

```bash
git add db/migrations/2026-09-11-meta-ads-hora-tabela.sql
git commit -m "feat(db): tabela campaign_insights_hora com RLS por conta"
```

---

### Task 2: Segredo de cron para `coletar-dados-hora`

**Files:**
- Create: `db/migrations/2026-09-11-meta-ads-hora-segredo.sql`

**Interfaces:**
- Consumes: tabela `segredos_de_cron` (já existe).
- Produces: linha `('coletar-dados-hora', <hex aleatório>)` — a Task 4
  (`exigirSegredoDeCron`) e a Task 5 (`disparar_robo`) leem por esse nome.

- [ ] **Step 1: Escrever a migration**

```sql
-- O SEGREDO DA FUNÇÃO coletar-dados-hora.
--
-- Separado do agendamento (migration da Task 5) de propósito: dá pra ter a
-- função no ar e testável à mão (Task 4) antes de deixá-la disparando
-- sozinha de hora em hora. Mesmo padrão de
-- db/migrations/2026-07-30-conteudo-05-segredo-hora-h.sql.
--
-- exigirSegredoDeCron() é fail-closed: sem esta linha, a função nega tudo
-- com 401 — o que é seguro, mas silencioso se o cron for ligado antes dela.
insert into public.segredos_de_cron (nome, segredo)
values ('coletar-dados-hora', encode(gen_random_bytes(32), 'hex'))
on conflict (nome) do nothing;
```

- [ ] **Step 2: Aplicar**

Run: `cd coletor && node run-migrations.mjs`

- [ ] **Step 3: Conferir**

```sql
select nome, coletado_em is not null as tem_segredo
from public.segredos_de_cron where nome = 'coletar-dados-hora';
-- Não rode `select segredo` num lugar que vá parar em log/commit.
```
Expected: 1 linha.

- [ ] **Step 4: Commit**

```bash
git add db/migrations/2026-09-11-meta-ads-hora-segredo.sql
git commit -m "feat(db): segredo de cron para coletar-dados-hora"
```

---

### Task 3: Lógica pura do delta (`_shared/delta-de-hora.js`)

**Files:**
- Create: `supabase/functions/_shared/delta-de-hora.js`
- Test: `supabase/functions/_shared/delta-de-hora.test.mjs`

**Interfaces:**
- Produces: `conversasIniciadas(actions: any[]): number` e
  `calcularDeltaHora(gastoAcumulado: number, conversasAcumuladas: number,
  anterior: {gasto_acumulado, conversas_acumuladas} | null): {gasto_hora:
  number, conversas_hora: number}`. Consumidas pela Task 4
  (`coletar-dados-hora/index.ts`).

- [ ] **Step 1: Escrever o teste (falhando)**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conversasIniciadas, calcularDeltaHora } from './delta-de-hora.js';

test('conversasIniciadas acha messaging_conversation_started_7d', () => {
  const actions = [
    { action_type: 'link_click', value: '10' },
    { action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '4' },
  ];
  assert.equal(conversasIniciadas(actions), 4);
});

test('conversasIniciadas aceita a variante sem _7d quando é a que existe', () => {
  const actions = [{ action_type: 'onsite_conversion.messaging_conversation_started', value: '2' }];
  assert.equal(conversasIniciadas(actions), 2);
});

test('conversasIniciadas devolve 0 sem actions ou sem o tipo certo', () => {
  assert.equal(conversasIniciadas(null), 0);
  assert.equal(conversasIniciadas([]), 0);
  assert.equal(conversasIniciadas([{ action_type: 'lead', value: '9' }]), 0);
});

test('calcularDeltaHora: primeira leitura do dia (sem anterior) = o próprio acumulado', () => {
  assert.deepEqual(calcularDeltaHora(120.5, 6, null), { gasto_hora: 120.5, conversas_hora: 6 });
});

test('calcularDeltaHora: subtrai contra a última linha gravada', () => {
  const anterior = { gasto_acumulado: 100, conversas_acumuladas: 4 };
  assert.deepEqual(calcularDeltaHora(135, 7, anterior), { gasto_hora: 35, conversas_hora: 3 });
});

test('calcularDeltaHora: nunca devolve negativo (Meta pode corrigir pra baixo)', () => {
  const anterior = { gasto_acumulado: 100, conversas_acumuladas: 10 };
  assert.deepEqual(calcularDeltaHora(90, 8, anterior), { gasto_hora: 0, conversas_hora: 0 });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test supabase/functions/_shared/delta-de-hora.test.mjs`
Expected: FAIL — `Cannot find module './delta-de-hora.js'`.

- [ ] **Step 3: Implementar**

```js
// Delta de hora para o Relatório por Hora do Meta Ads: dado o acumulado do
// dia até agora e a última leitura já gravada, devolve o quanto mudou nesta
// hora. Pura, sem I/O — testável sem Deno e sem falar com a Meta.
//
// Ver docs/superpowers/specs/2026-09-11-meta-ads-relatorio-por-hora-design.md.

const TIPOS_CONVERSA = [
  'onsite_conversion.messaging_conversation_started_7d',
  'onsite_conversion.messaging_conversation_started',
];

// Primeiro tipo encontrado ganha — mesmo critério de `actVal()` em
// coletar-dados/index.ts, pra não inventar uma segunda regra de leitura do
// array `actions` da Meta neste projeto.
export function conversasIniciadas(actions) {
  if (!Array.isArray(actions)) return 0;
  for (const tipo of TIPOS_CONVERSA) {
    const achado = actions.find((a) => a && a.action_type === tipo);
    if (achado) return parseInt(achado.value ?? '0', 10) || 0;
  }
  return 0;
}

// `anterior` é a última linha já gravada HOJE para esta campanha, ou null se
// for a primeira leitura do dia. Sem anterior, o delta é o próprio acumulado.
// Nunca negativo: a Meta pode reclassificar uma ação e corrigir o acumulado
// pra baixo, e um delta negativo não tem leitura sensata numa tela de
// "quanto se gastou nesta hora".
export function calcularDeltaHora(gastoAcumulado, conversasAcumuladas, anterior) {
  const gastoAnterior = anterior ? Number(anterior.gasto_acumulado) : 0;
  const conversasAnterior = anterior ? Number(anterior.conversas_acumuladas) : 0;
  return {
    gasto_hora: Math.max(0, gastoAcumulado - gastoAnterior),
    conversas_hora: Math.max(0, conversasAcumuladas - conversasAnterior),
  };
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test supabase/functions/_shared/delta-de-hora.test.mjs`
Expected: PASS, 6 testes.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/delta-de-hora.js supabase/functions/_shared/delta-de-hora.test.mjs
git commit -m "feat(coletor): lógica pura do delta de hora (gasto e conversas)"
```

---

### Task 4: Edge Function `coletar-dados-hora`

**Files:**
- Create: `supabase/functions/coletar-dados-hora/index.ts`
- Create: `supabase/functions/coletar-dados-hora/LEIA-ME.txt`

**Interfaces:**
- Consumes: `conversasIniciadas`/`calcularDeltaHora` (Task 3),
  `exigirSegredoDeCron` (`../_shared/segredo-de-cron.ts`, já existe), tabela
  `campaign_insights_hora` (Task 1), tabela `accounts` (já existe:
  `id, name, ad_account_id, access_token`).
- Produces: endpoint `POST /functions/v1/coletar-dados-hora` — consumido pela
  Task 5 (`disparar_robo`).

- [ ] **Step 1: Escrever o LEIA-ME**

```
Edge Function que roda de hora em hora e grava, por campanha, quanto foi
gasto e quantas conversas do WhatsApp começaram NESSA hora — não o
acumulado do dia, o delta contra a última leitura.

Alimenta o módulo "Relatório por Hora" do Meta Ads
(src/ferramentas/meta-ads/tela-de-relatorio-por-hora.vue).

Por quê é uma função separada do coletar-dados: aquele já teve que virar
"uma conta por vez" porque fazia dezenas de chamadas à Meta por conta. Esta
faz 1 chamada por conta, então roda todas de uma vez sem risco de estourar
o teto de 150s da plataforma.

Ver docs/superpowers/specs/2026-09-11-meta-ads-relatorio-por-hora-design.md.
```

- [ ] **Step 2: Escrever a função**

```ts
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { exigirSegredoDeCron } from '../_shared/segredo-de-cron.ts';
import { conversasIniciadas, calcularDeltaHora } from '../_shared/delta-de-hora.js';

const GRAPH = 'https://graph.facebook.com/v22.0';

function todayBR(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

// Hora de parede em São Paulo (0-23), não UTC — é a hora que a pessoa vai
// ler na tela. Ver "a hora gravada é a hora da rodada" na spec, §4.
function horaBR(): number {
  return Number(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false }));
}

async function apiGetAll(path: string, params: Record<string, string>): Promise<any[]> {
  const url = new URL(`${GRAPH}/${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const out: any[] = [];
  let next: string | null = url.toString();
  while (next) {
    const r = await fetch(next);
    if (!r.ok) throw new Error(`Meta API ${path}: ${r.status} ${await r.text()}`);
    const d = await r.json();
    out.push(...(d.data ?? []));
    next = d.paging?.next ?? null;
  }
  return out;
}

// Uma conta: busca o insight do dia (acumulado até agora), calcula o delta
// contra a última linha já gravada hoje, e grava. Erro nesta conta (sem
// token, Meta fora do ar) não derruba as outras — mesmo espírito do
// `try/catch` por conta em coletar-dados/index.ts.
async function coletarConta(sb: any, acc: any, dia: string, hora: number): Promise<number> {
  const { id: accountId, ad_account_id: adAccountId, access_token: token, name } = acc;
  if (!adAccountId || !token) return 0;
  try {
    const items = await apiGetAll(`act_${adAccountId}/insights`, {
      fields: 'campaign_id,spend,actions',
      time_range: JSON.stringify({ since: dia, until: dia }),
      level: 'campaign',
      access_token: token,
    });

    for (const r of items) {
      const campaignId = r.campaign_id;
      const gastoAcumulado = parseFloat(r.spend ?? '0');
      const conversasAcumuladas = conversasIniciadas(r.actions);

      const { data: anteriorRows } = await sb
        .from('campaign_insights_hora')
        .select('gasto_acumulado,conversas_acumuladas')
        .eq('campaign_id', campaignId).eq('account_id', accountId).eq('dia', dia)
        .order('hora', { ascending: false }).limit(1);
      const anterior = anteriorRows?.[0] ?? null;

      const { gasto_hora, conversas_hora } = calcularDeltaHora(gastoAcumulado, conversasAcumuladas, anterior);

      await sb.from('campaign_insights_hora').upsert(
        {
          campaign_id: campaignId, account_id: accountId, dia, hora,
          gasto_acumulado: gastoAcumulado, conversas_acumuladas: conversasAcumuladas,
          gasto_hora, conversas_hora,
        },
        { onConflict: 'campaign_id,account_id,dia,hora' },
      );
    }
    console.log(`✓ ${name}: ${items.length} campanhas`);
    return items.length;
  } catch (e) {
    console.error(`✗ ${name}:`, e);
    return 0;
  }
}

Deno.serve(async (req: Request) => {
  const negado = await exigirSegredoDeCron(req, 'coletar-dados-hora');
  if (negado) return negado;

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const dia = todayBR();
  const hora = horaBR();

  const { data: contas } = await sb
    .from('accounts')
    .select('id,name,ad_account_id,access_token')
    .not('ad_account_id', 'is', null);

  let campanhas = 0;
  for (const acc of contas ?? []) campanhas += await coletarConta(sb, acc, dia, hora);

  return new Response(JSON.stringify({ ok: true, dia, hora, contas: (contas ?? []).length, campanhas }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
```

- [ ] **Step 3: Deploy**

Run: `npx supabase functions deploy coletar-dados-hora --project-ref kounqtdoioootxqegkij`

Se o CLI não estiver autenticado nesta máquina, peça para o dono rodar este
comando — ele já tem acesso ao projeto (mesmo fluxo usado para
`coletar-dados`/`auditar-dados`).

- [ ] **Step 4: Testar manualmente**

Buscar o segredo (Supabase SQL editor ou `psql`):
```sql
select segredo from public.segredos_de_cron where nome = 'coletar-dados-hora';
```
Chamar a função com ele:
```bash
curl -s -X POST https://kounqtdoioootxqegkij.supabase.co/functions/v1/coletar-dados-hora \
  -H "Authorization: Bearer <segredo copiado acima>" -H "Content-Type: application/json" -d '{}'
```
Expected: JSON `{"ok":true,"dia":"...","hora":...,"contas":N,"campanhas":M}`
com `contas`/`campanhas` > 0. Depois, conferir no banco:
```sql
select * from public.campaign_insights_hora order by coletado_em desc limit 10;
```
Expected: linhas novas, com `dia`/`hora` de agora e `gasto_hora`/
`conversas_hora` **iguais** a `gasto_acumulado`/`conversas_acumuladas`
(primeira leitura do dia para essas campanhas). Chamar de novo alguns
minutos depois e conferir que uma segunda chamada no mesmo `dia`+`hora`
faz **upsert** (mesma linha, não duplica) — `select count(*) from
campaign_insights_hora where dia = current_date` não deve dobrar.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/coletar-dados-hora/
git commit -m "feat(coletor): Edge Function coletar-dados-hora"
```

---

### Task 5: Ligar o cron de hora em hora

**Files:**
- Create: `db/migrations/2026-09-11-meta-ads-hora-cron.sql`

**Interfaces:**
- Consumes: `disparar_robo(p_robo text, p_funcao text, p_segredo text, p_body
  jsonb, p_timeout int)` (já existe, `db/migrations/2026-07-31-saude-dos-robos.sql`).

- [ ] **Step 1: Escrever a migration**

```sql
-- LIGAR O coletar-dados-hora: cron de hora em hora.
--
-- Aplicar só depois de confirmar manualmente (Task 4, Step 4) que a função
-- responde certo — ligar o cron é decisão, não efeito colateral de deploy.
-- Mesmo espírito de db/migrations/2026-07-30-conteudo-06-cron-hora-h.sql.
--
-- Minuto 5, não em cima da hora: dá folga pra Meta consolidar o minuto
-- anterior antes de perguntar "quanto gastou hoje até agora". `disparar_robo`
-- já registra em robos_execucoes, então falha aparece em robos_saude como os
-- outros robôs.
select cron.schedule(
  'coletar-dados-hora',
  '5 * * * *',
  $$ select public.disparar_robo(
       'coletar-dados-hora', 'coletar-dados-hora', 'coletar-dados-hora',
       '{}'::jsonb, 60000
     ) $$
);

-- Para desligar sem apagar nada:  select cron.unschedule('coletar-dados-hora');
```

- [ ] **Step 2: Aplicar**

Run: `cd coletor && node run-migrations.mjs`

- [ ] **Step 3: Conferir que o job existe e conferir a próxima rodada**

```sql
select jobname, schedule, active from cron.job where jobname = 'coletar-dados-hora';
-- depois de passar do minuto 5 da hora:
select robo, disparado_em, ok from public.robos_execucoes
 where robo = 'coletar-dados-hora' order by disparado_em desc limit 3;
```
Expected: job `active = true`; depois de uma rodada real, `ok = true` (pode
levar até 5 min para `conferir_robos()` preencher — se `ok` ainda estiver
null, é normal, só espera a próxima varredura).

- [ ] **Step 4: Commit**

```bash
git add db/migrations/2026-09-11-meta-ads-hora-cron.sql
git commit -m "feat(db): agenda coletar-dados-hora de hora em hora"
```

---

### Task 6: Agrupamento e custo por lead (`relatorio-por-hora.js`)

**Files:**
- Create: `src/ferramentas/meta-ads/relatorio-por-hora.js`
- Test: `src/ferramentas/meta-ads/relatorio-por-hora.test.mjs`

**Interfaces:**
- Produces: `custoPorLead(gastoHora: number, conversasHora: number): number |
  null` e `agruparPorDiaEHora(linhas: Array<{dia, hora, campaign_id,
  gasto_hora, conversas_hora}>, nomesPorCampanha?: Record<string,string>):
  Array<{dia: string, gastoTotal: number, conversasTotal: number, horas:
  Array<{hora: number, gastoTotal: number, conversasTotal: number,
  campanhas: Array<{campaignId, nome, gastoHora, conversasHora,
  custoPorLead}>}>}>`, ordenado dia decrescente / hora crescente / campanha
  por gasto decrescente. Consumida pela Task 9 (`tela-de-relatorio-por-hora.vue`).

- [ ] **Step 1: Escrever o teste (falhando)**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { custoPorLead, agruparPorDiaEHora } from './relatorio-por-hora.js';

test('custoPorLead divide gasto por conversas', () => {
  assert.equal(custoPorLead(40, 2), 20);
});

test('custoPorLead é null sem conversa — nunca 0,00 enganoso', () => {
  assert.equal(custoPorLead(50, 0), null);
});

test('agruparPorDiaEHora: dias em ordem decrescente, horas em ordem crescente', () => {
  const linhas = [
    { dia: '2026-09-10', hora: 9, campaign_id: 'c1', gasto_hora: 10, conversas_hora: 1 },
    { dia: '2026-09-11', hora: 8, campaign_id: 'c1', gasto_hora: 20, conversas_hora: 2 },
    { dia: '2026-09-11', hora: 9, campaign_id: 'c1', gasto_hora: 5, conversas_hora: 0 },
  ];
  const out = agruparPorDiaEHora(linhas, { c1: 'Campanha A' });
  assert.deepEqual(out.map((d) => d.dia), ['2026-09-11', '2026-09-10']);
  assert.deepEqual(out[0].horas.map((h) => h.hora), [8, 9]);
});

test('agruparPorDiaEHora: campanha sem nome cai pro próprio id, e sem conversa vira custo null', () => {
  const linhas = [{ dia: '2026-09-11', hora: 8, campaign_id: 'c9', gasto_hora: 30, conversas_hora: 0 }];
  const out = agruparPorDiaEHora(linhas);
  const c = out[0].horas[0].campanhas[0];
  assert.equal(c.nome, 'c9');
  assert.equal(c.custoPorLead, null);
});

test('agruparPorDiaEHora: subtotal de hora e de dia somam as campanhas', () => {
  const linhas = [
    { dia: '2026-09-11', hora: 8, campaign_id: 'c1', gasto_hora: 20, conversas_hora: 2 },
    { dia: '2026-09-11', hora: 8, campaign_id: 'c2', gasto_hora: 10, conversas_hora: 1 },
  ];
  const out = agruparPorDiaEHora(linhas);
  assert.equal(out[0].horas[0].gastoTotal, 30);
  assert.equal(out[0].horas[0].conversasTotal, 3);
  assert.equal(out[0].gastoTotal, 30);
});

test('agruparPorDiaEHora: campanhas de uma hora vêm ordenadas por gasto decrescente', () => {
  const linhas = [
    { dia: '2026-09-11', hora: 8, campaign_id: 'barata', gasto_hora: 5, conversas_hora: 0 },
    { dia: '2026-09-11', hora: 8, campaign_id: 'cara', gasto_hora: 50, conversas_hora: 1 },
  ];
  const out = agruparPorDiaEHora(linhas);
  assert.deepEqual(out[0].horas[0].campanhas.map((c) => c.campaignId), ['cara', 'barata']);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test src/ferramentas/meta-ads/relatorio-por-hora.test.mjs`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

```js
// Agrupa campaign_insights_hora em dias > horas > campanhas, para o
// acordeão do Relatório por Hora. Pura, sem I/O — recebe os dados já
// buscados do Supabase (ver tela-de-relatorio-por-hora.vue).

// null (não 0) quando não há conversa: custar em cima de zero lead seria
// inventar um número — regra "a tela nunca mente" do padrão do projeto.
export function custoPorLead(gastoHora, conversasHora) {
  if (!conversasHora) return null;
  return gastoHora / conversasHora;
}

export function agruparPorDiaEHora(linhas, nomesPorCampanha = {}) {
  const porDia = new Map();
  for (const l of linhas) {
    if (!porDia.has(l.dia)) porDia.set(l.dia, new Map());
    const porHora = porDia.get(l.dia);
    if (!porHora.has(l.hora)) porHora.set(l.hora, []);
    const gastoHora = Number(l.gasto_hora) || 0;
    const conversasHora = Number(l.conversas_hora) || 0;
    porHora.get(l.hora).push({
      campaignId: l.campaign_id,
      nome: nomesPorCampanha[l.campaign_id] || l.campaign_id,
      gastoHora,
      conversasHora,
      custoPorLead: custoPorLead(gastoHora, conversasHora),
    });
  }

  return [...porDia.keys()].sort().reverse().map((dia) => {
    const porHora = porDia.get(dia);
    const horas = [...porHora.keys()].sort((a, b) => a - b).map((hora) => {
      const campanhas = [...porHora.get(hora)].sort((a, b) => b.gastoHora - a.gastoHora);
      return {
        hora,
        gastoTotal: campanhas.reduce((s, c) => s + c.gastoHora, 0),
        conversasTotal: campanhas.reduce((s, c) => s + c.conversasHora, 0),
        campanhas,
      };
    });
    return {
      dia,
      gastoTotal: horas.reduce((s, h) => s + h.gastoTotal, 0),
      conversasTotal: horas.reduce((s, h) => s + h.conversasTotal, 0),
      horas,
    };
  });
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test src/ferramentas/meta-ads/relatorio-por-hora.test.mjs`
Expected: PASS, 6 testes.

- [ ] **Step 5: Commit**

```bash
git add src/ferramentas/meta-ads/relatorio-por-hora.js src/ferramentas/meta-ads/relatorio-por-hora.test.mjs
git commit -m "feat(meta-ads): agrupamento dia/hora/campanha e custo por lead"
```

---

### Task 7: Permissão `meta.hora`

**Files:**
- Modify: `src/compartilhado/controle-de-login-e-usuario.js:93` (RECURSOS),
  `:129` (hasPermission), `:150` (PERMISSION_TREE)
- Modify: `src/ferramentas/admin/niveis-de-permissao.test.mjs:21` (cópia do
  catálogo)

**Interfaces:**
- Produces: `hasPermission('meta.hora')` passa a existir e a contar para o
  grupo `hasPermission('meta')`/`hasPermission('tool:meta')`. Consumida
  pela Task 8 (card + rota) e pela Task 9 (guarda dentro da tela, se
  necessário).

- [ ] **Step 1: `RECURSOS` — nova entrada, tela inteira sem sub-ação**

Em `src/compartilhado/controle-de-login-e-usuario.js`, logo após a linha de
`meta.fabrica`:

```js
  { key: 'meta.campanha', label: 'Análise de Campanhas', acoes: ['ver', 'exportar'] },
  { key: 'meta.gestor', label: 'Gestão de Tráfego', acoes: ['ver', 'editar'] },
  { key: 'meta.fabrica', label: 'Fábrica de Anúncios', acoes: ['ver', 'editar'] },
  { key: 'meta.hora', label: 'Relatório por Hora', acoes: ['ver'] },
```

- [ ] **Step 2: `hasPermission` — incluir no grupo `meta`**

```js
  if (key === 'meta') return ['meta.campanha', 'meta.gestor', 'meta.fabrica', 'meta.hora'].some(k => (estado.permissions[k] || []).includes('ver'))
```

Sem entrada nova em `_legado`: este card nasce chamando `hasPermission
('meta.hora')` direto (decisão registrada na spec, §7.4) — a ponte
`module:meta:*` é só retrocompatibilidade dos call-sites antigos.

- [ ] **Step 3: `PERMISSION_TREE` — nó filho para aparecer no Admin**

```js
  { key: 'meta', label: 'Meta Ads', children: [
    { key: 'meta.campanha', label: 'Análise de Campanhas' },
    { key: 'meta.gestor', label: 'Gestão de Tráfego' },
    { key: 'meta.fabrica', label: 'Fábrica de Anúncios' },
    { key: 'meta.hora', label: 'Relatório por Hora' },
  ] },
```

- [ ] **Step 4: Espelhar em `niveis-de-permissao.test.mjs`**

Em `src/ferramentas/admin/niveis-de-permissao.test.mjs`, mesma posição
relativa (logo após `meta.fabrica`, linha 21):

```js
  { key: 'meta.campanha', label: 'Análise de Campanhas', acoes: ['ver', 'exportar'] },
  { key: 'meta.gestor', label: 'Gestão de Tráfego', acoes: ['ver', 'editar'] },
  { key: 'meta.fabrica', label: 'Fábrica de Anúncios', acoes: ['ver', 'editar'] },
  { key: 'meta.hora', label: 'Relatório por Hora', acoes: ['ver'] },
```

Não mexer em `CONJUNTOS_EM_USO`: essa lista reflete o que já está gravado em
produção, e `meta.hora` nasce desmarcada para todo mundo — não existe ainda.

- [ ] **Step 5: Rodar os testes de permissão**

Run: `node --test src/ferramentas/admin/niveis-de-permissao.test.mjs`
Expected: PASS (inclui o teste "a cópia deste teste ainda bate com o
catálogo real" — falha se as duas listas divergirem em conteúdo ou ordem).

- [ ] **Step 6: Commit**

```bash
git add src/compartilhado/controle-de-login-e-usuario.js src/ferramentas/admin/niveis-de-permissao.test.mjs
git commit -m "feat(permissoes): meta.hora (Relatório por Hora)"
```

---

### Task 8: Rota e card no hub do Meta Ads

**Files:**
- Modify: `src/mapa-de-enderecos.js:19` (nova rota)
- Modify: `src/ferramentas/meta-ads/tela-de-menu-meta-ads.vue` (novo card)

**Interfaces:**
- Consumes: `hasPermission('meta.hora')` (Task 7).
- Produces: rota nomeada `meta-relatorio-hora`, consumida pela função `ir()`
  já existente na tela do hub e pelo componente da Task 9.

- [ ] **Step 1: Registrar a rota**

Em `src/mapa-de-enderecos.js`, logo após a linha de `gestao-trafego`:

```js
  { path: '/gestao-trafego', name: 'gestao-trafego', component: () => import('./ferramentas/gestao-trafego/tela-de-gestao-trafego.vue') },
  { path: '/meta-relatorio-hora', name: 'meta-relatorio-hora', component: () => import('./ferramentas/meta-ads/tela-de-relatorio-por-hora.vue'), meta: { recurso: 'meta.hora' } },
```

- [ ] **Step 2: Adicionar o card no hub**

Em `src/ferramentas/meta-ads/tela-de-menu-meta-ads.vue`, dentro de
`.smenu-cards`, logo após o card "Estúdio de Criativos":

```html
        <div class="smenu-card" v-if="hasPermission('meta.hora')" @click="ir('meta-relatorio-hora')">
          <div class="smenu-card-icon" style="background:linear-gradient(135deg,#f59e0b,#d97706)">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          </div>
          <div class="smenu-card-title">Relatório por Hora</div>
          <div class="smenu-card-desc">Gasto, conversas iniciadas e custo por lead de cada campanha, hora a hora.</div>
          <span class="smenu-card-enter">→</span>
        </div>
```

(A tela já importa `hasPermission` de
`../../compartilhado/controle-de-login-e-usuario.js` — nada novo a
importar aqui.)

- [ ] **Step 3: Conferir manualmente**

Run: `npm run dev -- --port 5199 --strictPort`

Abrir `/meta-ads` logado como super-admin (ou com `meta.hora` liberada) e
conferir que o card aparece e que clicar nele navega para
`/meta-relatorio-hora` (vai dar tela em branco/erro até a Task 9 — esperado
nesta etapa).

- [ ] **Step 4: Commit**

```bash
git add src/mapa-de-enderecos.js src/ferramentas/meta-ads/tela-de-menu-meta-ads.vue
git commit -m "feat(meta-ads): rota e card do Relatório por Hora no hub"
```

---

### Task 9: Tela `tela-de-relatorio-por-hora.vue`

**Files:**
- Create: `src/ferramentas/meta-ads/tela-de-relatorio-por-hora.vue`

**Interfaces:**
- Consumes: `agruparPorDiaEHora` (Task 6), `sb()` e `comErro`/`.erro`
  (`../../compartilhado/buscar-e-salvar-dados.js`, já existe),
  `faixa-de-erro.vue` (`../../compartilhado/faixa-de-erro.vue`, já existe),
  `barra-de-topo.vue` (já usada no hub), rota `meta-relatorio-hora` (Task 8).

- [ ] **Step 1: Escrever a tela**

```vue
<template>
  <div class="tela-relatorio-hora">
    <barra-de-topo voltar="Meta Ads" titulo="Relatório por Hora" @voltar="voltar" />
    <div class="rph-body">
      <faixa-de-erro :erro="erro" @tentar-de-novo="carregar" />

      <p v-if="!erro && !carregando && dias.length === 0" class="rph-vazio">
        Ainda não há leitura por hora. O robô roda de hora em hora — volte daqui a pouco.
      </p>

      <div v-for="d in dias" :key="d.dia" class="rph-dia">
        <button class="rph-dia-cabecalho" @click="alternar(d.dia)">
          <span class="rph-dia-seta" :class="{ aberto: expandido(d.dia) }">▸</span>
          <span class="rph-dia-data">{{ formatarDia(d.dia) }}</span>
          <span class="rph-dia-totais">{{ formatarReais(d.gastoTotal) }} · {{ d.conversasTotal }} conversas</span>
        </button>

        <div v-if="expandido(d.dia)" class="rph-horas">
          <div v-for="h in d.horas" :key="h.hora" class="rph-hora">
            <div class="rph-hora-cabecalho">
              <span class="rph-hora-rotulo">{{ String(h.hora).padStart(2, '0') }}h</span>
              <span class="rph-hora-totais">{{ formatarReais(h.gastoTotal) }} · {{ h.conversasTotal }} conversas</span>
            </div>
            <table class="rph-tabela">
              <thead>
                <tr><th>Campanha</th><th>Investido</th><th>Conversas</th><th>Custo/lead</th></tr>
              </thead>
              <tbody>
                <tr v-for="c in h.campanhas" :key="c.campaignId">
                  <td class="rph-campanha">{{ c.nome }}</td>
                  <td>{{ formatarReais(c.gastoHora) }}</td>
                  <td>{{ c.conversasHora }}</td>
                  <td>{{ c.custoPorLead === null ? '—' : formatarReais(c.custoPorLead) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import BarraDeTopo from '../../compartilhado/barra-de-topo.vue'
import FaixaDeErro from '../../compartilhado/faixa-de-erro.vue'
import { sb } from '../../compartilhado/buscar-e-salvar-dados.js'
import { agruparPorDiaEHora } from './relatorio-por-hora.js'

const router = useRouter()
function voltar() {
  router.push({ name: 'meta-ads' })
}

// Últimos 14 dias bastam pra um relatório que só olha "hoje" e "essa
// semana" — sem filtro de período nesta primeira entrega (spec §8, YAGNI).
const JANELA_DIAS = 14

const carregando = ref(true)
const erro = ref(null)
const dias = ref([])
const expandidos = ref(new Set())

function expandido(dia) {
  return expandidos.value.has(dia)
}
function alternar(dia) {
  const s = new Set(expandidos.value)
  if (s.has(dia)) s.delete(dia)
  else s.add(dia)
  expandidos.value = s
}

function formatarDia(iso) {
  const [ano, mes, dia] = iso.split('-')
  return `${dia}/${mes}/${ano}`
}
function formatarReais(v) {
  return (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

async function carregar() {
  carregando.value = true
  erro.value = null

  const desde = new Date()
  desde.setDate(desde.getDate() - JANELA_DIAS)
  const desdeISO = desde.toISOString().slice(0, 10)

  const [linhas, campanhas] = await Promise.all([
    sb(`campaign_insights_hora?select=dia,hora,campaign_id,gasto_hora,conversas_hora&dia=gte.${desdeISO}&order=dia.desc,hora.asc`),
    sb('campaigns?select=campaign_id,name'),
  ])

  if (linhas.erro) { erro.value = linhas.erro; carregando.value = false; return }
  if (campanhas.erro) { erro.value = campanhas.erro; carregando.value = false; return }

  const nomesPorCampanha = Object.fromEntries(campanhas.map((c) => [c.campaign_id, c.name]))
  dias.value = agruparPorDiaEHora(linhas, nomesPorCampanha)

  // Hoje nasce expandido; dias passados nascem fechados — "visão simples"
  // pedida: quem abre a tela já vê o dia de hoje sem precisar clicar.
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
  if (dias.value.some((d) => d.dia === hoje)) expandidos.value = new Set([hoje])

  carregando.value = false
}

onMounted(carregar)
</script>

<style scoped>
.tela-relatorio-hora { min-height: 100vh; display: flex; flex-direction: column; background: var(--bg); }
.rph-body { flex: 1; padding: var(--sp-6) var(--sp-6); display: flex; flex-direction: column; gap: var(--sp-4); }
.rph-vazio { color: var(--muted); font-size: 13px; }

.rph-dia { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); overflow: hidden; }
.rph-dia-cabecalho { width: 100%; min-height: 48px; display: flex; align-items: center; gap: var(--sp-3); padding: var(--sp-3) var(--sp-4); background: none; border: none; cursor: pointer; text-align: left; font-family: var(--fonte-principal); color: var(--text); }
.rph-dia-seta { color: var(--muted); transition: transform .15s; flex-shrink: 0; }
.rph-dia-seta.aberto { transform: rotate(90deg); }
.rph-dia-data { font-weight: 600; font-size: 14px; overflow-wrap: anywhere; }
.rph-dia-totais { margin-left: auto; color: var(--muted); font-size: 12px; white-space: nowrap; }

.rph-horas { border-top: 1px solid var(--border); display: flex; flex-direction: column; }
.rph-hora { padding: var(--sp-3) var(--sp-4); border-bottom: 1px solid var(--border); }
.rph-hora:last-child { border-bottom: none; }
.rph-hora-cabecalho { display: flex; align-items: baseline; gap: var(--sp-3); margin-bottom: var(--sp-2); }
.rph-hora-rotulo { font-weight: 600; font-size: 13px; }
.rph-hora-totais { color: var(--muted); font-size: 12px; }

.rph-tabela { width: 100%; border-collapse: collapse; font-size: 12px; }
.rph-tabela th { text-align: left; color: var(--muted); font-weight: 600; padding: var(--sp-1) var(--sp-2); border-bottom: 1px solid var(--border); }
.rph-tabela td { padding: var(--sp-1) var(--sp-2); border-bottom: 1px solid var(--border); }
.rph-tabela tr:last-child td { border-bottom: none; }
.rph-campanha { overflow-wrap: anywhere; }

@media (max-width: 640px) {
  .rph-body { padding: var(--sp-4) var(--sp-3); }
  .rph-tabela { display: block; overflow-x: auto; }
  .rph-dia-totais { font-size: 11px; }
}
</style>
```

- [ ] **Step 2: Abrir no navegador e conferir**

Run: `npm run dev -- --port 5199 --strictPort`

Abrir `/meta-relatorio-hora` (via o card do hub). Conferir:
- Sem dado ainda: mensagem "Ainda não há leitura por hora...", não tela em
  branco nem erro.
- Com dado (depois que o cron da Task 5 rodar pelo menos uma vez): dia de
  hoje aparece expandido, horas em ordem crescente, campanhas ordenadas por
  gasto, custo por lead como "—" quando não há conversa.
- Forçar um erro de leitura (ex.: deslogar e recarregar) e conferir que a
  `faixa-de-erro` aparece em vez de uma lista vazia.
- **A 375px** (DevTools ou `page.setViewportSize`): 0 rolagem horizontal, o
  botão de expandir tem ≥40px de altura, nenhum texto cortado. Repetir no
  tema escuro.

- [ ] **Step 3: Commit**

```bash
git add src/ferramentas/meta-ads/tela-de-relatorio-por-hora.vue
git commit -m "feat(meta-ads): tela do Relatório por Hora (acordeão dia/hora)"
```

---

### Task 10: Guarda de import para a pasta `meta-ads/`

**Files:**
- Create: `src/ferramentas/meta-ads/imports.test.mjs`

**Interfaces:**
- Nenhuma — teste estático, não importado por ninguém.

- [ ] **Step 1: Criar o guarda (mesmo mecanismo de `frota`/`gestao-trafego`, genérico por pasta)**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// NOME DE MÓDULO USADO NA TELA PRECISA ESTAR IMPORTADO.
//
// Mesmo guarda já criado em frota/, gestao-trafego/, patrimonio/ e admin/,
// depois de três telas quebrarem em produção por função de módulo chamada
// sem import (`npm run build` passa — o Vite não resolve identificador
// livre, o erro só nasce em runtime). meta-ads/ ganhou uma tela nova
// (tela-de-relatorio-por-hora.vue, que importa de relatorio-por-hora.js) e
// ainda não tinha o guarda.

const AQUI = dirname(fileURLToPath(import.meta.url))

function nomesExportados() {
  const mapa = new Map()
  for (const arq of readdirSync(AQUI).filter((f) => f.endsWith('.js') && !f.includes('.test.'))) {
    const src = readFileSync(join(AQUI, arq), 'utf8')
    for (const m of src.matchAll(/export (?:function|const|let) (\w+)/g)) mapa.set(m[1], arq)
  }
  return mapa
}

function semComentarios(codigo) {
  return codigo
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''")
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""')
}

function nomesImportados(script) {
  const s = new Set()
  for (const m of script.matchAll(/import \{([^}]+)\} from/g)) {
    for (const n of m[1].split(',')) s.add(n.trim().split(/\s+as\s+/).pop())
  }
  return s
}

function nomesDeclarados(script) {
  const s = new Set()
  for (const m of script.matchAll(/(?:^|\n)\s*(?:export\s+)?(?:function|const|let|var)\s+(\w+)/g)) s.add(m[1])
  return s
}

const TELAS = readdirSync(AQUI).filter((f) => f.endsWith('.vue'))

for (const tela of TELAS) {
  test(`${tela} não usa função de módulo sem importar`, () => {
    const bruto = readFileSync(join(AQUI, tela), 'utf8')
    const script = semComentarios(bruto.slice(bruto.indexOf('<script'), bruto.indexOf('</script>')))
    const importados = nomesImportados(script)
    const declarados = nomesDeclarados(script)
    const faltando = []
    for (const [nome, arq] of nomesExportados()) {
      if (importados.has(nome) || declarados.has(nome)) continue
      const usado = new RegExp(`(^|[^\\w.$'"\`])${nome}\\s*[([.,);\\]}]`, 'm')
      if (usado.test(script)) faltando.push(`${nome} (exportado por ${arq})`)
    }
    assert.deepEqual(faltando, [], `${tela} usa estes nomes e não os importa — quebra ao clicar, e o build NÃO pega`)
  })
}

test('o guarda olha TODAS as telas da pasta, e não só a principal', () => {
  assert.ok(TELAS.includes('tela-de-menu-meta-ads.vue'))
  assert.ok(TELAS.length >= 2, 'a pasta tem mais de uma tela; o guarda precisa ver todas')
})

test('o proprio teste enxerga um import faltando', () => {
  const script = 'import { alfa } from "./x.js"\n beta(1)'
  const importados = nomesImportados(script)
  assert.ok(importados.has('alfa'))
  assert.ok(!importados.has('beta'))
})
```

- [ ] **Step 2: Rodar**

Run: `node --test src/ferramentas/meta-ads/imports.test.mjs`
Expected: PASS — inclusive para `tela-de-relatorio-por-hora.vue`
(`agruparPorDiaEHora` está importada corretamente na Task 9).

- [ ] **Step 3: Commit**

```bash
git add src/ferramentas/meta-ads/imports.test.mjs
git commit -m "test(meta-ads): guarda de import esquecido na pasta"
```

---

## Depois de tudo

- [ ] `npm test` inteiro passando (suíte completa, não só os arquivos novos).
- [ ] `npm run build` sem erro.
- [ ] Deixar o cron rodar por 2-3 horas reais e voltar na tela: mais de uma
  hora precisa aparecer dentro do dia de hoje.
- [ ] Abrir `/meta-relatorio-hora` a 375px e a 1440px, tema claro e escuro —
  os 4 critérios do item 6 do `PADRAO-DA-CENTRAL.md`.
- [ ] Conferir que ninguém sem `meta.hora` vê o card nem consegue abrir a
  rota direto pela URL.
