# Baldes de campanha na seção 02 · Plano de implementação

> **Para quem executa com agentes:** SUB-SKILL OBRIGATÓRIA: use
> `superpowers:subagent-driven-development` (recomendado) ou
> `superpowers:executing-plans` para executar tarefa a tarefa. Os passos usam
> caixinha (`- [ ]`) para marcação.

**Objetivo:** a seção **02 · Meta Ads** da tela de Redes Sociais ganha uma barra de
baldes (Todos · Seguidores · Contatos · Site e alcance · Vendas); escolher um
balde recorta o dinheiro e troca os indicadores dos quatro cartões.

**Arquitetura:** a classificação nasce num módulo **puro** que lê o sinal que a
Meta afirma no conjunto (`destination_type` / `optimization_goal`), nunca o nome da
campanha. O coletor passa a guardar esse sinal (tabela nova `campaign_adsets`) e
mais quatro contagens que já vinham de graça no `actions`. A edge
`insights-ao-vivo` ganha um parâmetro **opcional** para somar gasto só de certas
campanhas. A tela consome tudo isso e nunca inventa número: sem denominador, o
cartão mostra "—".

**Tecnologias:** Vue 3 + Vite · Supabase (Postgres, PostgREST, Edge Functions em
Deno) · Meta Graph API v22.0 · testes com `node --test` em `*.test.mjs`.

**Desenho:** `docs/superpowers/specs/2026-08-17-baldes-de-campanha-redes-sociais-design.md`
— leia junto com este plano; ele traz os números medidos que justificam cada regra.

## Restrições globais

- **Padrão obrigatório:** `PADRAO-DA-CENTRAL.md`. Cor só de token, nunca hex. Botão
  tem três tipos e só. Texto nunca corta. Toda entrega se mede a **375px num
  navegador de verdade**, não se deduz.
- **Nomes de arquivo em português, kebab-case.** Toda pasta tem `LEIA-ME.txt`
  atualizado.
- **`npm test` roda a suíte inteira.** Servidor de desenvolvimento sempre com porta
  fixa: `npm run dev -- --port 5199 --strictPort` (há mais de uma janela neste
  repositório; nunca matar processo alheio).
- **Falha nunca vira zero.** Sem dado, o cartão mostra `—` com o motivo. Um R$ 0,00
  falso já ficou 17 horas no ar neste projeto.
- **Edge Function não sobe com `git push`.** Deploy na mão pelo MCP
  (`mcp__plugin_supabase_supabase__deploy_edge_function`), com **todas** as
  dependências de `_shared` no mesmo envio, e `verify_jwt: false` onde já é false.
- **Migration nova vai pelo MCP** (`apply_migration`), nunca por `db push`.
- **Nada de escrita em dado real** fora das migrations previstas aqui. Consulta em
  produção é só `SELECT`.
- **Projeto Supabase:** `kounqtdoioootxqegkij`.
- Commits em português, sem emoji, uma linha de assunto curta.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `src/ferramentas/redes-sociais/baldes-do-painel.js` | **criar** — puro: campanha → balde; catálogo dos baldes |
| `src/ferramentas/redes-sociais/baldes-do-painel.test.mjs` | **criar** — testes com as campanhas reais medidas |
| `src/ferramentas/redes-sociais/cartoes-do-balde.js` | **criar** — puro: balde + números → definição dos 4 cartões |
| `src/ferramentas/redes-sociais/cartoes-do-balde.test.mjs` | **criar** |
| `supabase/functions/_shared/acoes-de-campanha.js` | **criar** — puro: `actions` da Meta → conversas/cadastros/compras/visitas |
| `supabase/functions/_shared/acoes-de-campanha.test.mjs` | **criar** |
| `supabase/functions/_shared/gasto-de-campanhas.js` | **criar** — puro: resposta `level=campaign` + ids → soma |
| `supabase/functions/_shared/gasto-de-campanhas.test.mjs` | **criar** |
| `supabase/functions/coletar-dados/index.ts` | **modificar** — coletar conjuntos + as 4 contagens |
| `supabase/functions/insights-ao-vivo/index.ts` | **modificar** — parâmetro opcional `campanhas` |
| `src/ferramentas/redes-sociais/tela-de-redes-sociais.vue` | **modificar** — barra, recorte, cartões, metas |
| `src/ferramentas/redes-sociais/LEIA-ME.txt` | **modificar** — explicar a barra |
| `docs/pendencias.md` | **modificar** — o que ficou de fora |

---

## Task 1: O módulo puro que decide o balde

**Arquivos:**
- Criar: `src/ferramentas/redes-sociais/baldes-do-painel.js`
- Testar: `src/ferramentas/redes-sociais/baldes-do-painel.test.mjs`
- Ler (não modificar): `src/ferramentas/gestao-trafego/baldes.js`

**Interfaces:**
- Consome: `ehDeWhatsapp(conjuntos)` e `baldeDoObjetivo(objective)` de
  `../gestao-trafego/baldes.js`.
- Produz:
  - `BALDES` — array de `{ id, rotulo }` na ordem da barra.
  - `baldeDaCampanha({ objective, conjuntos })` → `'seguidores' | 'contatos' | 'site' | 'vendas'`
  - `rotuloDoBalde(id)` → string
  - `idsDoBalde(campanhas, balde)` → array de `campaign_id` (string), onde
    `campanhas` é `[{ campaign_id, objective, conjuntos }]`. `balde === 'todos'`
    devolve **todos** os ids.

- [ ] **Passo 1: escrever o teste que falha**

Crie `src/ferramentas/redes-sociais/baldes-do-painel.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BALDES, baldeDaCampanha, rotuloDoBalde, idsDoBalde } from './baldes-do-painel.js';

// TODAS as campanhas abaixo são REAIS: nome, objetivo e gasto conferidos no banco
// de produção em 17/08/2026. Os conjuntos são o sinal que a Meta afirma.

test('campanha de engajamento com destino WhatsApp é CONTATOS, não seguidores', () => {
  // Vessel: R$ 2.254 em 30 dias. É 87% do dinheiro "de engajamento" dessa conta.
  const c = { objective: 'OUTCOME_ENGAGEMENT', conjuntos: [{ destination_type: 'WHATSAPP', optimization_goal: 'CONVERSATIONS' }] };
  assert.equal(baldeDaCampanha(c), 'contatos');
});

test('campanha de cadastro é CONTATOS mesmo com objetivo de engajamento', () => {
  // Motoeasy: "[LEADS] NEGATIVADO? | P3 | TESTE OBJ ENGAJAMENTO", R$ 98,22.
  const c = { objective: 'OUTCOME_LEADS', conjuntos: [{ destination_type: null, optimization_goal: 'LEAD_GENERATION' }] };
  assert.equal(baldeDaCampanha(c), 'contatos');
});

test('tráfego com destino PERFIL é SEGUIDORES', () => {
  // Breno Vale: "[TRÁFEGO] GESTÃO EMPRESARIAL | PERFIL", R$ 2.584 — 100% da conta.
  const c = { objective: 'OUTCOME_TRAFFIC', conjuntos: [{ destination_type: 'INSTAGRAM_PROFILE', optimization_goal: 'PROFILE_VISIT' }] };
  assert.equal(baldeDaCampanha(c), 'seguidores');
});

test('engajamento na publicação é SEGUIDORES', () => {
  // Raíssa: "[ENGAJAMENTO] FEED | [P3]", R$ 3.710,64.
  const c = { objective: 'OUTCOME_ENGAGEMENT', conjuntos: [{ destination_type: 'ON_POST', optimization_goal: 'POST_ENGAGEMENT' }] };
  assert.equal(baldeDaCampanha(c), 'seguidores');
});

test('visualização de vídeo é SEGUIDORES', () => {
  const c = { objective: 'OUTCOME_ENGAGEMENT', conjuntos: [{ destination_type: 'ON_VIDEO', optimization_goal: 'THRUPLAY' }] };
  assert.equal(baldeDaCampanha(c), 'seguidores');
});

test('tráfego sem destino declarado é SITE E ALCANCE', () => {
  // Raíssa: "[TRÁFEGO] DIA DA BELEZA | [P3]", R$ 484,31 — vai pra fora do Instagram.
  const c = { objective: 'OUTCOME_TRAFFIC', conjuntos: [{ destination_type: null, optimization_goal: 'LINK_CLICKS' }] };
  assert.equal(baldeDaCampanha(c), 'site');
});

test('venda é VENDAS', () => {
  // Vessel: "[ATACADO - SALE] SUA VITRINE | MANUAL [30/07]", R$ 199,24.
  const c = { objective: 'OUTCOME_SALES', conjuntos: [{ destination_type: null, optimization_goal: 'OFFSITE_CONVERSIONS' }] };
  assert.equal(baldeDaCampanha(c), 'vendas');
});

test('conversa VENCE o objetivo declarado: um conjunto de WhatsApp basta', () => {
  // A regra que corrigiu R$ 15.177 na Gestão de Tráfego (PR #51).
  const c = { objective: 'OUTCOME_SALES', conjuntos: [
    { destination_type: null, optimization_goal: 'OFFSITE_CONVERSIONS' },
    { destination_type: 'WHATSAPP', optimization_goal: 'CONVERSATIONS' },
  ] };
  assert.equal(baldeDaCampanha(c), 'contatos');
});

test('campanha sem conjunto coletado cai pelo objetivo, e NUNCA some', () => {
  assert.equal(baldeDaCampanha({ objective: 'OUTCOME_TRAFFIC', conjuntos: [] }), 'site');
  assert.equal(baldeDaCampanha({ objective: 'OUTCOME_ENGAGEMENT', conjuntos: [] }), 'seguidores');
  assert.equal(baldeDaCampanha({ objective: 'OUTCOME_LEADS', conjuntos: null }), 'contatos');
  assert.equal(baldeDaCampanha({ objective: '', conjuntos: [] }), 'site');
  assert.equal(baldeDaCampanha({}), 'site');
  assert.equal(baldeDaCampanha(null), 'site');
});

test('LINK_CLICKS (objetivo antigo) é SITE E ALCANCE', () => {
  assert.equal(baldeDaCampanha({ objective: 'LINK_CLICKS', conjuntos: [] }), 'site');
});

test('reconhecimento cai em SITE E ALCANCE (não tem balde próprio)', () => {
  assert.equal(baldeDaCampanha({ objective: 'OUTCOME_AWARENESS', conjuntos: [] }), 'site');
});

test('a barra tem cinco baldes, nesta ordem', () => {
  assert.deepEqual(BALDES.map(b => b.id), ['todos', 'seguidores', 'contatos', 'site', 'vendas']);
  assert.equal(rotuloDoBalde('site'), 'Site e alcance');
  assert.equal(rotuloDoBalde('todos'), 'Todos');
});

test('NENHUMA campanha desaparece: a soma dos baldes é o total', () => {
  const campanhas = [
    { campaign_id: '1', objective: 'OUTCOME_ENGAGEMENT', conjuntos: [{ destination_type: 'WHATSAPP' }] },
    { campaign_id: '2', objective: 'OUTCOME_TRAFFIC', conjuntos: [{ destination_type: 'INSTAGRAM_PROFILE' }] },
    { campaign_id: '3', objective: 'OUTCOME_TRAFFIC', conjuntos: [] },
    { campaign_id: '4', objective: 'OUTCOME_SALES', conjuntos: [] },
    { campaign_id: '5', objective: 'BUGIGANGA_NOVA_DA_META', conjuntos: [] },
  ];
  const soma = ['seguidores', 'contatos', 'site', 'vendas']
    .reduce((n, b) => n + idsDoBalde(campanhas, b).length, 0);
  assert.equal(soma, campanhas.length);
  assert.equal(idsDoBalde(campanhas, 'todos').length, campanhas.length);
});

test('idsDoBalde devolve id em texto, do jeito que o PostgREST espera', () => {
  const ids = idsDoBalde([{ campaign_id: 120249301837840342, objective: 'OUTCOME_SALES', conjuntos: [] }], 'vendas');
  assert.deepEqual(ids, ['120249301837840342']);
});
```

- [ ] **Passo 2: rodar o teste e ver falhar**

Rodar: `npm test -- --test-name-pattern="balde"`
Esperado: FALHA com `Cannot find module './baldes-do-painel.js'`.

- [ ] **Passo 3: escrever o módulo**

Crie `src/ferramentas/redes-sociais/baldes-do-painel.js`:

```js
// EM QUE BALDE cada campanha entra, na seção 02 do painel de Redes Sociais.
//
// A decisão sai do sinal que a META AFIRMA no conjunto (destination_type e
// optimization_goal) — NUNCA do nome da campanha. Nomear por convenção
// ("| PERFIL", "[+ SEGUIDORES]") funciona hoje nestas contas e quebra no primeiro
// dia em que alguém nomear diferente.
//
// POR QUE NÃO DÁ PRA USAR SÓ O OBJETIVO (medido em 17/08/2026, produção):
//   - Vessel: R$ 5.699 dos R$ 6.553 com objetivo "Engajamento" são WhatsApp.
//     Somando cru, o custo por seguidor de lá ficaria ~8x mais caro do que é.
//   - Breno Vale: os R$ 2.584 de "Tráfego" vão para o PERFIL — são de seguidor
//     da cabeça aos pés. Um recorte "só engajamento" deixaria a conta zerada.
//
// POR QUE ESTE MÓDULO EXISTE, se a Gestão de Tráfego já tem baldes.js: lá,
// tráfego-para-o-perfil e tráfego-para-o-site caem os dois em 'trafego', e é
// justamente essa divisão que dá sentido ao balde Seguidores. Mexer aqui não
// pode mudar o veredito da régua de lá — por isso o mapa novo mora à parte, e
// só o que é comum vem importado.
// PURO: sem rede, sem tela.
import { ehDeWhatsapp, baldeDoObjetivo } from '../gestao-trafego/baldes.js';

export const BALDES = [
  { id: 'todos', rotulo: 'Todos' },
  { id: 'seguidores', rotulo: 'Seguidores' },
  { id: 'contatos', rotulo: 'Contatos' },
  { id: 'site', rotulo: 'Site e alcance' },
  { id: 'vendas', rotulo: 'Vendas' },
];

export function rotuloDoBalde(id) {
  const b = BALDES.find(x => x.id === id);
  return b ? b.rotulo : 'Todos';
}

const NORM = v => String(v || '').toUpperCase();

// Destinos que são CONVERSA. MESSAGING_* cobre as combinações que a Meta foi
// criando (MESSAGING_INSTAGRAM_DIRECT_MESSENGER_WHATSAPP e parentes).
function ehConversa(conjuntos) {
  if (ehDeWhatsapp(conjuntos)) return true;
  return (conjuntos || []).some((s) => {
    const d = NORM(s && s.destination_type);
    return d === 'INSTAGRAM_DIRECT' || d === 'MESSENGER' || d.startsWith('MESSAGING_');
  });
}

function algumConjunto(conjuntos, teste) {
  return (conjuntos || []).some(s => teste(NORM(s && s.destination_type), NORM(s && s.optimization_goal)));
}

// A ordem aqui É a regra. A primeira que casar vence — ver a tabela do desenho.
export function baldeDaCampanha(campanha) {
  const c = campanha || {};
  const conjuntos = Array.isArray(c.conjuntos) ? c.conjuntos : [];
  const objetivo = baldeDoObjetivo(c.objective);

  if (ehConversa(conjuntos)) return 'contatos';            // 1 — conversa vence tudo
  if (objetivo === 'leads') return 'contatos';             // 2 — cadastro
  if (algumConjunto(conjuntos, (d, o) => d === 'INSTAGRAM_PROFILE' || o === 'PROFILE_VISIT')) return 'seguidores'; // 3
  if (algumConjunto(conjuntos, (d, o) => d === 'ON_POST' || d === 'ON_VIDEO' || o === 'POST_ENGAGEMENT' || o === 'THRUPLAY')) return 'seguidores'; // 4
  if (objetivo === 'vendas') return 'vendas';              // 5
  if (objetivo === 'mensagens') return 'contatos';         // objetivo antigo MESSAGES
  if (objetivo === 'engajamento') return 'seguidores';     // sem conjunto: engajamento é do perfil
  return 'site';                                           // 6 — tráfego, cliques, reconhecimento, desconhecido
}

export function idsDoBalde(campanhas, balde) {
  const lista = campanhas || [];
  if (balde === 'todos' || !balde) return lista.map(c => String(c.campaign_id));
  return lista.filter(c => baldeDaCampanha(c) === balde).map(c => String(c.campaign_id));
}
```

- [ ] **Passo 4: rodar o teste e ver passar**

Rodar: `npm test -- --test-name-pattern="balde"`
Esperado: PASSA, 13 testes.

- [ ] **Passo 5: rodar a suíte inteira**

Rodar: `npm test`
Esperado: passa. **Se o total de testes for MENOR que o conhecido, pare** — total
que encolhe é arquivo sumindo, nunca instabilidade.

- [ ] **Passo 6: commitar**

```bash
git add src/ferramentas/redes-sociais/baldes-do-painel.js src/ferramentas/redes-sociais/baldes-do-painel.test.mjs
git commit -m "O balde de cada campanha sai do que a Meta afirma no conjunto"
```

---

## Task 2: O banco guarda o sinal do conjunto e as quatro contagens

**Arquivos:**
- Migration nova, aplicada pelo MCP (não existe arquivo local a criar; o MCP
  registra em `supabase/migrations/`).

**Interfaces:**
- Produz: tabela `campaign_adsets(adset_id text pk, campaign_id text, account_id
  uuid, destination_type text, optimization_goal text, synced_at date)` e as
  colunas `conversas`, `cadastros`, `compras`, `visitas` (integer) em
  `campaign_insights`.

- [ ] **Passo 1: conferir o estado de hoje, antes de mexer**

Rodar pelo MCP `execute_sql` no projeto `kounqtdoioootxqegkij`:

```sql
select column_name from information_schema.columns
where table_name = 'campaign_insights' order by ordinal_position;
select to_regclass('public.campaign_adsets') as ja_existe;
```

Esperado: 14 colunas em `campaign_insights` (`id` … `saves`), e `ja_existe` nulo.
Se `campaign_adsets` já existir, **pare** e reveja — alguém passou na frente.

- [ ] **Passo 2: aplicar a migration**

Pelo MCP `apply_migration`, nome `baldes_de_campanha_conjuntos_e_contagens`:

```sql
-- O sinal que a META AFIRMA sobre cada conjunto. É o que decide o balde da
-- campanha na seção 02 do painel de Redes Sociais. destination_type é NULO DE
-- VERDADE em campanha de site — nulo aqui é informação, não falha de coleta.
create table if not exists public.campaign_adsets (
  adset_id text primary key,
  campaign_id text not null,
  account_id uuid not null references public.accounts(id) on delete cascade,
  destination_type text,
  optimization_goal text,
  synced_at date not null default current_date
);
create index if not exists campaign_adsets_campanha_idx on public.campaign_adsets (campaign_id);
create index if not exists campaign_adsets_conta_idx on public.campaign_adsets (account_id);

alter table public.campaign_adsets enable row level security;

-- Mesma porta das outras tabelas de leitura do painel: quem está logado lê.
drop policy if exists campaign_adsets_leitura on public.campaign_adsets;
create policy campaign_adsets_leitura on public.campaign_adsets
  for select to authenticated using (true);

-- As quatro contagens vêm do `actions` que o coletor JÁ recebe da Meta — não é
-- chamada nova. Sem default: dia antigo fica NULO, e nulo vira "—" na tela.
-- Zero mentiria dizendo "custou zero" quando o certo é "ainda não sei".
alter table public.campaign_insights add column if not exists conversas integer;
alter table public.campaign_insights add column if not exists cadastros integer;
alter table public.campaign_insights add column if not exists compras integer;
alter table public.campaign_insights add column if not exists visitas integer;
```

- [ ] **Passo 3: conferir que subiu**

Rodar pelo MCP `execute_sql`:

```sql
select count(*) as colunas_novas from information_schema.columns
where table_name = 'campaign_insights'
  and column_name in ('conversas','cadastros','compras','visitas');
select count(*) as politicas from pg_policies
where tablename = 'campaign_adsets';
select count(*) as linhas from public.campaign_adsets;
```

Esperado: `colunas_novas` = 4, `politicas` = 1, `linhas` = 0.

- [ ] **Passo 4: conferir que o painel de hoje não quebrou**

Rodar pelo MCP `execute_sql`:

```sql
select count(*) as linhas, count(conversas) as com_conversa
from public.campaign_insights where period_days = 30;
```

Esperado: `linhas` > 0 e `com_conversa` = 0. Coluna nova nasce vazia; nenhuma
linha antiga pode ter sido tocada.

- [ ] **Passo 5: commitar o registro da migration**

```bash
git add supabase/migrations/
git commit -m "Banco: guardar o destino do conjunto e as contagens de conversa, cadastro, compra e visita"
```

---

## Task 3: O coletor passa a guardar o sinal e as contagens

**Arquivos:**
- Criar: `supabase/functions/_shared/acoes-de-campanha.js`
- Testar: `supabase/functions/_shared/acoes-de-campanha.test.mjs`
- Modificar: `supabase/functions/coletar-dados/index.ts` (função
  `sincronizarCampanhas`, `coletarAdsPorCampanha`, `coletarAdsDia`)

**Interfaces:**
- Produz: `contagensDaCampanha(actions)` → `{ conversas, cadastros, compras, visitas }`
  (inteiros, 0 quando o tipo não aparece).
- Consome: `apiGetAll(caminho, params)` e `todayBR()`, que já existem no
  `index.ts`.

- [ ] **Passo 1: escrever o teste que falha**

Crie `supabase/functions/_shared/acoes-de-campanha.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contagensDaCampanha } from './acoes-de-campanha.js';

// O array `actions` é o que a Meta devolve em act_X/insights. Os nomes de
// action_type mudam conforme o tipo de campanha, e a mesma coisa aparece com
// mais de um nome — por isso cada contagem tenta uma LISTA, na ordem, e para na
// primeira que existir. Somar as duas contaria a mesma conversa duas vezes.

test('conta conversa de WhatsApp', () => {
  const actions = [
    { action_type: 'onsite_conversion.total_messaging_connection', value: '1020' },
    { action_type: 'link_click', value: '55' },
  ];
  assert.equal(contagensDaCampanha(actions).conversas, 1020);
});

test('a conversa não é contada duas vezes quando a Meta manda os dois nomes', () => {
  const actions = [
    { action_type: 'onsite_conversion.total_messaging_connection', value: '100' },
    { action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '97' },
  ];
  assert.equal(contagensDaCampanha(actions).conversas, 100);
});

test('conta cadastro, compra e visita', () => {
  const actions = [
    { action_type: 'lead', value: '2' },
    { action_type: 'purchase', value: '7' },
    { action_type: 'landing_page_view', value: '480' },
    { action_type: 'link_click', value: '900' },
  ];
  const c = contagensDaCampanha(actions);
  assert.equal(c.cadastros, 2);
  assert.equal(c.compras, 7);
  assert.equal(c.visitas, 480, 'visita é landing_page_view; clique NÃO é visita');
});

test('sem o tipo, a contagem é zero — e não quebra', () => {
  const c = contagensDaCampanha([{ action_type: 'post_reaction', value: '10' }]);
  assert.deepEqual(c, { conversas: 0, cadastros: 0, compras: 0, visitas: 0 });
});

test('resposta sem actions não derruba a coleta', () => {
  assert.deepEqual(contagensDaCampanha(undefined), { conversas: 0, cadastros: 0, compras: 0, visitas: 0 });
  assert.deepEqual(contagensDaCampanha(null), { conversas: 0, cadastros: 0, compras: 0, visitas: 0 });
  assert.deepEqual(contagensDaCampanha('nada disso'), { conversas: 0, cadastros: 0, compras: 0, visitas: 0 });
});

test('valor vem como texto e vira número inteiro', () => {
  assert.equal(contagensDaCampanha([{ action_type: 'lead', value: '12' }]).cadastros, 12);
  assert.equal(contagensDaCampanha([{ action_type: 'lead', value: 12 }]).cadastros, 12);
  assert.equal(contagensDaCampanha([{ action_type: 'lead', value: 'xis' }]).cadastros, 0);
});
```

- [ ] **Passo 2: rodar e ver falhar**

Rodar: `npm test -- --test-name-pattern="conversa|cadastro|actions"`
Esperado: FALHA com `Cannot find module './acoes-de-campanha.js'`.

- [ ] **Passo 3: escrever o módulo**

Crie `supabase/functions/_shared/acoes-de-campanha.js`:

```js
// As QUATRO contagens que vêm de graça no `actions` que o coletor já pede à Meta.
//
// Não é chamada nova: `coletarAdsPorCampanha` já manda `fields=...,actions` e
// jogava fora tudo o que não fosse curtida/comentário/compartilhamento/salvamento.
// Conversa, cadastro, compra e visita estavam na mesma resposta.
//
// Cada contagem tenta uma LISTA de nomes, na ordem, e PARA na primeira que
// existir. A Meta manda a mesma conversa com mais de um action_type; somar
// contaria duas vezes a mesma pessoa.
// PURO: sem rede.

export const TIPOS = {
  conversas: ['onsite_conversion.total_messaging_connection', 'onsite_conversion.messaging_conversation_started_7d'],
  cadastros: ['lead', 'onsite_conversion.lead_grouped'],
  compras: ['purchase', 'omni_purchase'],
  // VISITA é landing_page_view, e não link_click: clique não é visita — parte das
  // pessoas sai antes de a página abrir. O rótulo errado inflaria o denominador.
  visitas: ['landing_page_view'],
};

export function contagensDaCampanha(actions) {
  const lista = Array.isArray(actions) ? actions : [];
  const saida = {};
  for (const chave of Object.keys(TIPOS)) {
    saida[chave] = 0;
    for (const tipo of TIPOS[chave]) {
      const achou = lista.find(a => a && a.action_type === tipo);
      if (achou) { const n = parseInt(achou.value, 10); saida[chave] = isFinite(n) ? n : 0; break; }
    }
  }
  return saida;
}
```

- [ ] **Passo 4: rodar e ver passar**

Rodar: `npm test -- --test-name-pattern="conversa|cadastro|actions"`
Esperado: PASSA, 6 testes.

- [ ] **Passo 5: ligar no coletor — os conjuntos**

Em `supabase/functions/coletar-dados/index.ts`, logo **depois** da função
`sincronizarCampanhas`, acrescente:

```ts
// O SINAL DO CONJUNTO — destination_type e optimization_goal — é o que decide o
// balde da campanha no painel de Redes Sociais. Uma chamada por perfil por
// rodada; os mesmos campos que a Gestão de Tráfego já lê ao vivo.
// Falhar aqui NÃO pode derrubar o resto da rodada: sem conjunto, a tela
// classifica pelo objetivo e avisa que é provisório.
async function sincronizarConjuntos(sb: any, accountId: string, adAccountId: string, token: string) {
  try {
    const items = await apiGetAll(`act_${adAccountId}/adsets`, {
      fields: 'id,campaign_id,destination_type,optimization_goal', access_token: token,
    });
    const rows = items.map((s: any) => ({
      adset_id: s.id, campaign_id: s.campaign_id ?? '', account_id: accountId,
      destination_type: s.destination_type ?? null,
      optimization_goal: s.optimization_goal ?? null,
      synced_at: todayBR(),
    })).filter((r: any) => r.campaign_id);
    if (rows.length) await sb.from('campaign_adsets').upsert(rows, { onConflict: 'adset_id' });
    console.log(`  conjuntos: ${rows.length}`);
  } catch { /* sem ads, ou a Meta engasgou — a rodada segue */ }
}
```

E no `processarConta`, **na linha logo após** a chamada de `sincronizarCampanhas`,
acrescente a chamada nova (procure por `sincronizarCampanhas(` e copie o mesmo
formato de argumentos):

```ts
    await sincronizarConjuntos(sb, accountId, adAccountId, token);
```

- [ ] **Passo 6: ligar no coletor — as quatro contagens**

No topo do `index.ts`, junto dos outros imports de `_shared`:

```ts
import { contagensDaCampanha } from '../_shared/acoes-de-campanha.js';
```

Em `coletarAdsPorCampanha`, dentro do `items.map`, logo depois da linha de
`saves:`, acrescente:

```ts
      ...contagensDaCampanha(r.actions),
```

Faça **o mesmo** em `coletarAdsDia`, dentro do seu `items.map`, depois do `saves:`.
São os dois lugares que gravam `campaign_insights`; esquecer um deixa o dia-a-dia
sem os números novos e o gráfico não bate com o cartão.

- [ ] **Passo 7: rodar a suíte**

Rodar: `npm test`
Esperado: passa, com os 6 testes novos somados ao total.

- [ ] **Passo 8: commitar antes de subir**

```bash
git add supabase/functions/_shared/acoes-de-campanha.js supabase/functions/_shared/acoes-de-campanha.test.mjs supabase/functions/coletar-dados/index.ts
git commit -m "Coletor: guardar o destino do conjunto e as quatro contagens que ja vinham de graca"
```

- [ ] **Passo 9: subir a Edge Function pelo MCP**

`git push` **não** sobe Edge Function. Use
`mcp__plugin_supabase_supabase__deploy_edge_function` com
`name: 'coletar-dados'`, `verify_jwt: false` e **todos** os arquivos: o
`index.ts` e **todas** as dependências de `_shared` que ele importa (inclusive
`acoes-de-campanha.js`). Faltar uma dependência derruba o robô inteiro.

- [ ] **Passo 10: disparar uma rodada e conferir no dado real**

Dispare o robô do jeito que o projeto já usa (`disparar_robo()`; `cron.job_run_details`
mente sobre sucesso). Depois, pelo MCP `execute_sql`:

```sql
select a.name perfil, count(*) conjuntos,
       count(*) filter (where s.destination_type is not null) com_destino,
       count(distinct s.destination_type) tipos_de_destino
from campaign_adsets s join accounts a on a.id = s.account_id
group by 1 order by 2 desc;
```

Esperado: as cinco contas com conta de anúncio aparecem; `INSTAGRAM_PROFILE`
aparece entre os tipos (o desenho mediu 57 conjuntos desse tipo). Destino nulo é
normal em campanha de site.

```sql
select a.name perfil, sum(ci.conversas) conversas, sum(ci.cadastros) cadastros
from campaign_insights ci join accounts a on a.id = ci.account_id
where ci.period_days = 30 and ci.captured_at = current_date group by 1;
```

Esperado: **Motoeasy com conversas > 0** — o desenho mediu R$ 5.385 em
`[Leads] Para WhatsApp`. Se vier tudo zero, o `action_type` de conversa tem outro
nome nessa conta: leia a resposta crua de `act_X/insights` antes de mudar código,
e acrescente o nome à lista em `TIPOS`, sem remover os que já estão lá.

---

## Task 4: A edge soma o gasto só das campanhas do balde

**Arquivos:**
- Criar: `supabase/functions/_shared/gasto-de-campanhas.js`
- Testar: `supabase/functions/_shared/gasto-de-campanhas.test.mjs`
- Modificar: `supabase/functions/insights-ao-vivo/index.ts` (função `gasto` e as
  duas chamadas dela dentro do `Promise.all`)

**Interfaces:**
- Produz: `somarGasto(resposta, ids)` → número. `ids` vazio/nulo = soma tudo.
- O corpo aceito pela edge ganha o campo opcional `campanhas: string[]`.

- [ ] **Passo 1: escrever o teste que falha**

Crie `supabase/functions/_shared/gasto-de-campanhas.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { somarGasto } from './gasto-de-campanhas.js';

// Resposta real de act_X/insights com level=campaign: uma linha por campanha,
// `spend` em TEXTO.
const resposta = { data: [
  { campaign_id: '120249301837840342', spend: '461.52' },
  { campaign_id: '120230000000000001', spend: '2254.02' },
  { campaign_id: '120230000000000002', spend: '168.90' },
] };

test('sem ids, soma tudo', () => {
  assert.equal(somarGasto(resposta, null).toFixed(2), '2884.44');
  assert.equal(somarGasto(resposta, []).toFixed(2), '2884.44');
});

test('com ids, soma só as escolhidas', () => {
  assert.equal(somarGasto(resposta, ['120249301837840342', '120230000000000002']).toFixed(2), '630.42');
});

test('id que não veio na resposta não inventa gasto', () => {
  assert.equal(somarGasto(resposta, ['999']), 0);
});

test('id number bate com id text — o PostgREST devolve texto, a Meta também', () => {
  assert.equal(somarGasto(resposta, [120249301837840342]).toFixed(2), '461.52');
});

test('resposta vazia ou quebrada vira zero, nunca erro', () => {
  assert.equal(somarGasto({}, ['1']), 0);
  assert.equal(somarGasto(null, ['1']), 0);
  assert.equal(somarGasto({ data: [] }, null), 0);
  assert.equal(somarGasto({ data: [{ campaign_id: '1', spend: 'xis' }] }, null), 0);
});
```

- [ ] **Passo 2: rodar e ver falhar**

Rodar: `npm test -- --test-name-pattern="gasto"`
Esperado: FALHA com `Cannot find module './gasto-de-campanhas.js'`.

- [ ] **Passo 3: escrever o módulo**

Crie `supabase/functions/_shared/gasto-de-campanhas.js`:

```js
// Soma do gasto de uma resposta act_X/insights com level=campaign.
//
// Existe porque o cartão de investimento do painel passou a obedecer ao balde: ele
// vinha de level=account (a conta inteira, sem filtro nenhum) enquanto os cartões
// de custo já usavam o coletado COM filtro. Na Vessel isso divergia de verdade —
// o painel mostrava R$ 7.802 e dividia R$ 461,52.
// PURO: sem rede.

export function somarGasto(resposta, ids) {
  const linhas = (resposta && Array.isArray(resposta.data)) ? resposta.data : [];
  const querTodas = !ids || ids.length === 0;
  const alvo = querTodas ? null : new Set((ids || []).map(String));
  let total = 0;
  for (const l of linhas) {
    if (alvo && !alvo.has(String(l && l.campaign_id))) continue;
    const v = parseFloat((l && l.spend) ?? '0');
    if (isFinite(v)) total += v;
  }
  return total;
}
```

- [ ] **Passo 4: rodar e ver passar**

Rodar: `npm test -- --test-name-pattern="gasto"`
Esperado: PASSA, 5 testes.

- [ ] **Passo 5: usar na edge**

Em `supabase/functions/insights-ao-vivo/index.ts`, importe no topo, junto dos
outros `_shared`:

```ts
import { somarGasto } from '../_shared/gasto-de-campanhas.js';
```

Troque a função `gasto` inteira por:

```ts
// GASTO do período. Sem `campanhas`, continua exatamente como sempre foi:
// level=account, uma linha, o número exato da conta. COM `campanhas`, desce para
// level=campaign e soma só as escolhidas — é assim que o cartão de investimento
// passa a obedecer ao balde e ao filtro manual.
async function gasto(adAccountId: string, eS: string, eU: string, token: string, campanhas?: string[]) {
  const dstr = (u: number) => new Date(u * 1000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
  const janela = JSON.stringify({ since: dstr(Number(eS)), until: dstr(Number(eU) - 1) })
  if (!campanhas || campanhas.length === 0) {
    const ads = await apiGet(`act_${adAccountId}/insights`, { fields: 'spend', level: 'account', time_range: janela }, token)
    return parseFloat(ads.data?.[0]?.spend ?? '0') || 0
  }
  const ads = await apiGet(`act_${adAccountId}/insights`, { fields: 'campaign_id,spend', level: 'campaign', time_range: janela, limit: '500' }, token)
  return somarGasto(ads, campanhas)
}
```

Onde o corpo da requisição é lido (junto de `account_id`), acrescente:

```ts
    const campanhas: string[] = Array.isArray(body?.campanhas) ? body.campanhas.map(String) : []
```

E nas **duas** chamadas de `gasto` dentro do `Promise.all` (a do período atual e a
do anterior), passe o parâmetro novo:

```ts
      adAcc ? gasto(adAcc, engSince, engUntil, token, campanhas) : Promise.resolve(null),
      ...
      (wantPrev && adAcc) ? gasto(adAcc, prevEngSince, prevEngUntil, token, campanhas) : Promise.resolve(null),
```

- [ ] **Passo 6: rodar a suíte e commitar**

```bash
npm test
git add supabase/functions/_shared/gasto-de-campanhas.js supabase/functions/_shared/gasto-de-campanhas.test.mjs supabase/functions/insights-ao-vivo/index.ts
git commit -m "Edge: o investimento ao vivo pode somar so as campanhas pedidas"
```

- [ ] **Passo 7: subir pelo MCP e provar que o caminho velho não mudou**

Suba com `deploy_edge_function`, `name: 'insights-ao-vivo'`, **`verify_jwt: false`**
(se virar true, o gateway barra o OPTIONS, o CORS quebra e a tela inteira cai no
coletado), com todas as dependências de `_shared`.

Depois, com a tela aberta e logada, confira **antes de qualquer mudança visual**:
o cartão de investimento tem que mostrar o **mesmo** valor de antes em todos os
perfis, porque a tela ainda não manda `campanhas`. Se mudou, o caminho sem
parâmetro foi alterado sem querer.

---

## Task 5: A barra de baldes na tela, recortando o dinheiro

**Arquivos:**
- Modificar: `src/ferramentas/redes-sociais/tela-de-redes-sociais.vue`
  - o HTML da seção 02, logo acima de `<div class="camp-filter-bar">` (perto da
    linha 201)
  - `fetchData`, onde `selectedIds` é montado (perto da linha 1416)
  - `buscarKpisAoVivo` (perto da linha 758)

**Interfaces:**
- Consome: `BALDES`, `rotuloDoBalde`, `idsDoBalde` de `./baldes-do-painel.js`.
- Produz: variável de módulo `_baldeAtual` (string, começa em `'seguidores'`),
  função `setBalde(id)` e `idsParaConsulta(campanhas, balde, selecionadasNoFiltro)`
  → array de ids que vale para as consultas (interseção do balde com o filtro
  manual).

- [ ] **Passo 1: escrever o teste da interseção**

Acrescente ao fim de `src/ferramentas/redes-sociais/baldes-do-painel.test.mjs`:

```js
import { idsParaConsulta } from './baldes-do-painel.js';

const campanhas = [
  { campaign_id: 'a', objective: 'OUTCOME_TRAFFIC', conjuntos: [{ destination_type: 'INSTAGRAM_PROFILE' }] },
  { campaign_id: 'b', objective: 'OUTCOME_ENGAGEMENT', conjuntos: [{ destination_type: 'WHATSAPP' }] },
  { campaign_id: 'c', objective: 'OUTCOME_TRAFFIC', conjuntos: [] },
];

test('o balde recorta o tipo e o filtro manual recorta DENTRO dele', () => {
  assert.deepEqual(idsParaConsulta(campanhas, 'seguidores', null), ['a']);
  assert.deepEqual(idsParaConsulta(campanhas, 'todos', ['a', 'c']), ['a', 'c']);
  assert.deepEqual(idsParaConsulta(campanhas, 'seguidores', ['b', 'c']), []);
  assert.deepEqual(idsParaConsulta(campanhas, 'contatos', ['b', 'c']), ['b']);
});

test('filtro manual vazio (nenhuma marcada) NÃO vira "todas"', () => {
  // [] no banco significa "nenhuma campanha" de propósito; virar "todas" faria a
  // tela mostrar dinheiro que o dono tirou da conta.
  assert.deepEqual(idsParaConsulta(campanhas, 'todos', []), []);
  assert.deepEqual(idsParaConsulta(campanhas, 'seguidores', []), []);
});

test('sem filtro manual (null = todas), o balde manda sozinho', () => {
  assert.deepEqual(idsParaConsulta(campanhas, 'todos', null), ['a', 'b', 'c']);
});
```

- [ ] **Passo 2: rodar e ver falhar**

Rodar: `npm test -- --test-name-pattern="recorta|filtro manual"`
Esperado: FALHA — `idsParaConsulta` não existe.

- [ ] **Passo 3: implementar a função no módulo puro**

Acrescente ao fim de `src/ferramentas/redes-sociais/baldes-do-painel.js`:

```js
// O balde recorta o TIPO; o "⚙ Filtrar campanhas" recorta DENTRO dele. Os dois se
// somam, e a barra escreve em palavras o que está valendo.
//
// `selecionadas` segue a régua que já existe no painel: null = todas as campanhas,
// [] = NENHUMA (escolha do dono, não ausência de escolha).
export function idsParaConsulta(campanhas, balde, selecionadas) {
  const doBalde = idsDoBalde(campanhas, balde);
  if (selecionadas == null) return doBalde;
  const marcadas = new Set(selecionadas.map(String));
  return doBalde.filter(id => marcadas.has(id));
}
```

- [ ] **Passo 4: rodar e ver passar**

Rodar: `npm test -- --test-name-pattern="recorta|filtro manual"`
Esperado: PASSA, 3 testes.

- [ ] **Passo 5: a barra no HTML**

Em `tela-de-redes-sociais.vue`, logo **acima** de `<div class="camp-filter-bar">`:

```html
      <div class="balde-bar" id="balde-bar" role="tablist" aria-label="Tipo de campanha"></div>
```

E no `<style scoped>`, junto dos estilos da seção 02 (só token, nunca hex):

```css
.tela-redes-sociais :deep(.balde-bar){display:flex;gap:6px;overflow-x:auto;-webkit-overflow-scrolling:touch;padding:4px 0 8px;margin-bottom:4px;}
.tela-redes-sociais :deep(.balde-bar .balde-btn){flex:0 0 auto;min-height:40px;padding:8px 14px;border:1px solid var(--borda);border-radius:999px;background:var(--fundo-card);color:var(--muted);font-family:var(--fonte-principal);font-size:max(11px, calc(11px * var(--escala-texto, 1)));font-weight:600;letter-spacing:.4px;cursor:pointer;white-space:nowrap;}
.tela-redes-sociais :deep(.balde-bar .balde-btn[aria-selected="true"]){background:var(--acento);color:var(--fundo-card);border-color:var(--acento);}
.tela-redes-sociais :deep(.balde-bar .balde-btn:disabled){opacity:.45;cursor:not-allowed;}
```

Confira os nomes de token em `src/estilos/estilos-globais.css` antes de colar — se
algum não existir, use o que a seção 03 usa nas abas do Engajamento, e **nunca**
invente um hex.

- [ ] **Passo 6: o estado e o desenho da barra**

No script da tela, perto de onde ficam as outras variáveis de módulo:

```js
import { BALDES, rotuloDoBalde, idsParaConsulta } from './baldes-do-painel.js'

// Balde escolhido, POR PERFIL, só no navegador — é recorte de leitura, não
// configuração de conta. Sessão nova abre em Seguidores: este é o painel de
// redes sociais, e o que ele responde primeiro é quanto custa crescer.
let _baldeAtual = 'seguidores'
const _baldeKey = id => 'ig_balde_' + (id || 'default')
function carregarBalde(accountId) { _baldeAtual = localStorage.getItem(_baldeKey(accountId)) || 'seguidores' }
function setBalde(id) {
  _baldeAtual = id
  try { localStorage.setItem(_baldeKey(currentAccountId), id) } catch (e) {}
  refresh()
}
// `vazios` = ids de balde sem dinheiro no período. Ficam APAGADOS com o motivo —
// nunca somem: sumir faz a pessoa procurar o que não está lá.
function desenharBaldeBar(vazios) {
  const bar = document.getElementById('balde-bar'); if (!bar) return
  bar.innerHTML = ''
  BALDES.forEach(b => {
    const bt = document.createElement('button')
    bt.className = 'balde-btn'; bt.type = 'button'; bt.dataset.balde = b.id
    bt.textContent = b.rotulo
    bt.setAttribute('role', 'tab')
    bt.setAttribute('aria-selected', String(b.id === _baldeAtual))
    if (vazios.includes(b.id)) { bt.disabled = true; bt.title = 'Sem campanha desse tipo neste período' }
    else bt.addEventListener('click', () => setBalde(b.id))
    bar.appendChild(bt)
  })
}
```

- [ ] **Passo 7: usar o balde nas consultas**

Em `fetchData`, o `filterRow` já traz `selected_ids`. Acrescente a busca das
campanhas com seus conjuntos ao mesmo `Promise.all` (mesmo formato dos vizinhos):

```js
    sb(`campaigns?account_id=eq.${accountId}&select=campaign_id,objective`),
    sb(`campaign_adsets?account_id=eq.${accountId}&select=campaign_id,destination_type,optimization_goal`),
```

Depois de `const safeIds = ...`, monte a lista definitiva:

```js
  // Campanha + os conjuntos dela = o que decide o balde. Conjunto ainda não
  // coletado não some: cai pela regra do objetivo (ver baldes-do-painel.js).
  const _porCampanha = {}
  campanhasRows.forEach(c => { _porCampanha[String(c.campaign_id)] = { campaign_id: String(c.campaign_id), objective: c.objective, conjuntos: [] } })
  conjuntosRows.forEach(s => { const c = _porCampanha[String(s.campaign_id)]; if (c) c.conjuntos.push(s) })
  const _campanhas = Object.values(_porCampanha)
  const _selecionadas = Array.isArray(selectedIds) ? safeIds : null
  const idsDoRecorte = idsParaConsulta(_campanhas, _baldeAtual, _selecionadas)
  // O balde nunca é "todas": mesmo em Todos, mandamos a lista explícita, para o
  // ao vivo e o coletado somarem exatamente o MESMO conjunto de campanhas.
  const idFilter = idsDoRecorte.length > 0 ? `&campaign_id=in.(${idsDoRecorte.join(',')})` : ''
  const noneSelected = idsDoRecorte.length === 0
```

Isso **substitui** as linhas que hoje montam `idFilter` e `noneSelected`. Cuidado
com dois detalhes que já custaram caro neste arquivo:

1. O `.erro` do `sb()` mora no array devolvido; `.map()`/`.filter()` criam array
   novo e deixam o `.erro` para trás. Leia o `.erro` **colado no `await`**.
2. `sb()` **nunca lança**: devolve `[]` com `.erro`, e RLS nega com `200 + []` sem
   erro. A guarda certa é `!erro && length > 0`, nunca `try/catch`.

- [ ] **Passo 8: mandar o recorte para o ao vivo**

Em `buscarKpisAoVivo`, acrescente os ids na chave do cache **e** no corpo — sem
isso, trocar de balde devolve o número do balde anterior por até 3 minutos:

```js
async function buscarKpisAoVivo(accountId, period, customStart, customEnd, campanhas) {
  const ids = (campanhas || []).map(String)
  const chave = accountId + '|' + String(period) + '|' + (customStart || '') + '|' + (customEnd || '') + '|' + _baldeAtual + '|' + ids.length
  ...
    const { data, error } = await sbClient.functions.invoke('insights-ao-vivo', { body: { account_id: accountId, ...jan, campanhas: ids } })
```

E, no ponto onde `buscarKpisAoVivo` é chamada dentro de `fetchData`, passe
`idsDoRecorte`. Quando o balde é **Todos e não há filtro manual**, passe `[]` — a
edge volta ao caminho `level=account`, que é o número exato e mais barato.

- [ ] **Passo 9: desenhar a barra com os vazios**

No `update`, antes de mexer nos cartões:

```js
  // Balde sem gasto no período fica apagado, com o motivo. A conta usa o gasto
  // COLETADO por campanha (o ao vivo não sabe separar por tipo).
  desenharBaldeBar(d.baldesVazios || [])
```

E em `fetchData`, junto do resto do retorno, calcule `baldesVazios` somando
`gastoDiarioRows` por balde. Balde sem nenhuma campanha classificada nele **ou**
com soma zero entra na lista. `'todos'` nunca entra.

- [ ] **Passo 10: provar no navegador**

Rodar: `npm run dev -- --port 5199 --strictPort`

Abrir logado e conferir, **medindo, não deduzindo**:
1. a barra aparece com os cinco baldes;
2. **Motoeasy**: "Seguidores" apagado com o motivo, e a tela abrindo em Todos;
3. **Vessel**, balde Contatos: investimento perto de **R$ 5.699** (30D);
4. **Vessel**, balde Seguidores: perto de **R$ 842**;
5. **Breno Vale**, balde Seguidores: os **R$ 2.584** inteiros — se caírem em Site
   e alcance, a regra 3 do módulo não pegou;
6. a **soma dos quatro baldes** bate com Todos, em 7D e 30D, em cada perfil;
7. a 375px a barra rola na horizontal, não quebra linha nem encolhe fonte.

- [ ] **Passo 11: commitar**

```bash
git add src/ferramentas/redes-sociais/
git commit -m "Redes: a barra de baldes recorta o dinheiro da secao 02"
```

---

## Task 6: Os cartões trocam junto com o balde

**Arquivos:**
- Criar: `src/ferramentas/redes-sociais/cartoes-do-balde.js`
- Testar: `src/ferramentas/redes-sociais/cartoes-do-balde.test.mjs`
- Modificar: `tela-de-redes-sociais.vue` (o `update` da seção 02, perto da 1853)

**Interfaces:**
- Produz: `cartoesDoBalde(balde, numeros)` → array de 3 ou 4
  `{ id, rotulo, valor, formato: 'dinheiro'|'inteiro'|'decimal', explicacao, metaKey|null, semaforo|null }`.
  `valor === null` significa **"—"**, nunca zero.
- `numeros` é `{ investimento, seguidores, interacoes, curtidas, conversas, cadastros, compras, visitas, alcance, impressoes, frequencia }`.

- [ ] **Passo 1: escrever o teste que falha**

Crie `src/ferramentas/redes-sociais/cartoes-do-balde.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cartoesDoBalde } from './cartoes-do-balde.js';

// Números REAIS de 30 dias, última captura de 17/08/2026.
const motoeasy = { investimento: 6211.97, alcance: 85367, impressoes: 428132, frequencia: 5.02, conversas: 580, cadastros: 2, seguidores: 0, interacoes: 0, curtidas: 0, compras: 0, visitas: 0 };

test('TODOS mostra os quatro universais', () => {
  const c = cartoesDoBalde('todos', motoeasy);
  assert.deepEqual(c.map(x => x.id), ['investimento', 'cpm', 'alcance', 'frequencia']);
  assert.equal(c[1].valor.toFixed(2), '14.51', 'custo por mil impressões');
  assert.equal(c[2].valor, 85367);
  assert.equal(c[3].valor, 5.02);
});

test('frequência tem semáforo no limiar 4 e NÃO tem meta editável', () => {
  const c = cartoesDoBalde('todos', motoeasy).find(x => x.id === 'frequencia');
  assert.equal(c.metaKey, null);
  assert.equal(c.semaforo(5.02), 'ruim');
  assert.equal(c.semaforo(2.21), 'bom');
});

test('SEGUIDORES mantém os cartões de hoje', () => {
  const c = cartoesDoBalde('seguidores', { investimento: 2584.19, seguidores: 1268, interacoes: 9000, curtidas: 7000 });
  assert.deepEqual(c.map(x => x.id), ['investimento', 'cps', 'cpi', 'cpl']);
  assert.equal(c[1].valor.toFixed(2), '2.04');
});

test('VENDAS mostra TRÊS cartões — inventar um quarto seria fingir informação', () => {
  const c = cartoesDoBalde('vendas', { investimento: 360, compras: 4 });
  assert.equal(c.length, 3);
  assert.deepEqual(c.map(x => x.id), ['investimento', 'custo_venda', 'compras']);
});

test('CONTATOS mede conversa e cadastro', () => {
  const c = cartoesDoBalde('contatos', { investimento: 5803.29, conversas: 580, cadastros: 2 });
  assert.deepEqual(c.map(x => x.id), ['investimento', 'custo_conversa', 'conversas', 'custo_cadastro']);
  assert.equal(c[1].valor.toFixed(2), '10.01');
});

test('SITE E ALCANCE mede visita e mil impressões', () => {
  const c = cartoesDoBalde('site', { investimento: 3049.60, visitas: 10000, impressoes: 600000 });
  assert.deepEqual(c.map(x => x.id), ['investimento', 'custo_visita', 'visitas', 'cpm']);
});

test('denominador zero vira "—", NUNCA R$ 0,00', () => {
  // Um 500 da API já virou R$ 0,00 no ar por 17 horas neste projeto.
  const c = cartoesDoBalde('contatos', { investimento: 500, conversas: 0, cadastros: 0 });
  assert.equal(c[1].valor, null);
  assert.equal(c[3].valor, null);
});

test('número que ainda não foi coletado (nulo) também vira "—"', () => {
  const c = cartoesDoBalde('contatos', { investimento: 500, conversas: null, cadastros: null });
  assert.equal(c[1].valor, null);
  assert.equal(c[2].valor, null, 'a QUANTIDADE também: 0 conversas e "não sei" são coisas diferentes');
});

test('balde desconhecido cai em Todos, e não numa tela vazia', () => {
  assert.deepEqual(cartoesDoBalde('bugiganga', motoeasy).map(x => x.id), cartoesDoBalde('todos', motoeasy).map(x => x.id));
});
```

- [ ] **Passo 2: rodar e ver falhar**

Rodar: `npm test -- --test-name-pattern="cartõ|cartoes|TODOS|VENDAS"`
Esperado: FALHA — módulo não existe.

- [ ] **Passo 3: escrever o módulo**

Crie `src/ferramentas/redes-sociais/cartoes-do-balde.js`:

```js
// QUAIS indicadores cada balde mostra.
//
// A régua é a mesma da Gestão de Tráfego: "custo por resultado, MENOR é melhor",
// cada balde na SUA unidade. Comparar entre unidades é sem sentido, por isso cada
// cartão carrega a sua.
//
// TODOS não repete os cartões de hoje de propósito (decisão do dono, 17/08/2026):
// custo por seguidor calculado sobre TODO o dinheiro é sempre meio mentira, porque
// o denominador só vale para uma parte dele — é a distorção da Motoeasy, onde 98%
// do dinheiro é de cadastro. No lugar entram quatro indicadores que valem para
// QUALQUER campanha.
// PURO: sem rede, sem tela.

const div = (a, b) => (a > 0 && b > 0) ? (a / b) : null;   // sem denominador → "—", nunca 0
const qtd = v => (v == null ? null : v);                   // "não sei" ≠ "zero"

// Frequência ≥ 4 = a mesma pessoa vendo demais. O limiar é o que a régua da Gestão
// de Tráfego já usa para mandar reduzir verba — conhecimento do negócio, não
// preferência de conta. Por isso não é meta editável.
const semaforoFrequencia = v => (v == null ? null : (v >= 4 ? 'ruim' : v >= 3 ? 'atencao' : 'bom'));

const investimento = n => ({
  id: 'investimento', rotulo: 'INVESTIMENTO NO PERÍODO', valor: qtd(n.investimento),
  formato: 'dinheiro', metaKey: 'spend', semaforo: null,
  explicacao: 'Quanto foi gasto nas campanhas deste tipo, no período.',
});

const RECEITAS = {
  todos: n => [
    investimento(n),
    { id: 'cpm', rotulo: 'CUSTO POR MIL IMPRESSÕES', valor: div(n.investimento, n.impressoes / 1000), formato: 'dinheiro', metaKey: 'cpm', semaforo: null,
      explicacao: 'O preço do espaço. Vale para qualquer tipo de campanha. Impressão é cada vez que o anúncio apareceu — a mesma pessoa pode ver várias.' },
    { id: 'alcance', rotulo: 'ALCANCE', valor: qtd(n.alcance), formato: 'inteiro', metaKey: null, semaforo: null,
      explicacao: 'Quantas pessoas DIFERENTES viram. Vem do total da conta, já sem repetir gente.' },
    { id: 'frequencia', rotulo: 'FREQUÊNCIA', valor: qtd(n.frequencia), formato: 'decimal', metaKey: null, semaforo: semaforoFrequencia,
      explicacao: 'Quantas vezes cada pessoa viu o anúncio. Acima de 4, a mesma gente está vendo demais.' },
  ],
  seguidores: n => [
    investimento(n),
    { id: 'cps', rotulo: 'CUSTO POR SEGUIDOR', valor: div(n.investimento, n.seguidores), formato: 'dinheiro', metaKey: 'cps', semaforo: null,
      explicacao: 'Investimento ÷ novos seguidores do período.' },
    { id: 'cpi', rotulo: 'CUSTO POR INTERAÇÃO', valor: div(n.investimento, n.interacoes), formato: 'dinheiro', metaKey: 'cpi', semaforo: null,
      explicacao: 'Investimento ÷ interações do anúncio.' },
    { id: 'cpl', rotulo: 'CUSTO POR CURTIDA', valor: div(n.investimento, n.curtidas), formato: 'dinheiro', metaKey: 'cpl', semaforo: null,
      explicacao: 'Investimento ÷ curtidas do anúncio.' },
  ],
  contatos: n => [
    investimento(n),
    { id: 'custo_conversa', rotulo: 'CUSTO POR CONVERSA', valor: div(n.investimento, n.conversas), formato: 'dinheiro', metaKey: 'custo_conversa', semaforo: null,
      explicacao: 'Cada conversa aberta no WhatsApp ou no Direct. É o resultado que essa campanha compra.' },
    { id: 'conversas', rotulo: 'CONVERSAS INICIADAS', valor: qtd(n.conversas), formato: 'inteiro', metaKey: null, semaforo: null,
      explicacao: 'Quantas conversas começaram no período.' },
    { id: 'custo_cadastro', rotulo: 'CUSTO POR CADASTRO', valor: div(n.investimento, n.cadastros), formato: 'dinheiro', metaKey: 'custo_cadastro', semaforo: null,
      explicacao: 'Quanto custou cada ficha preenchida. Campanha que só abre conversa não tem cadastro — aparece "—".' },
  ],
  site: n => [
    investimento(n),
    { id: 'custo_visita', rotulo: 'CUSTO POR VISITA', valor: div(n.investimento, n.visitas), formato: 'dinheiro', metaKey: 'custo_visita', semaforo: null,
      explicacao: 'Quem realmente chegou no destino. Clique não é visita: parte das pessoas sai antes de a página abrir.' },
    { id: 'visitas', rotulo: 'VISITAS', valor: qtd(n.visitas), formato: 'inteiro', metaKey: null, semaforo: null,
      explicacao: 'Quantas pessoas chegaram no destino.' },
    { id: 'cpm', rotulo: 'CUSTO POR MIL IMPRESSÕES', valor: div(n.investimento, n.impressoes / 1000), formato: 'dinheiro', metaKey: 'cpm', semaforo: null,
      explicacao: 'O preço do espaço nas campanhas deste tipo.' },
  ],
  // TRÊS cartões de propósito: não há quarto indicador honesto para venda.
  // Inventar um só para preencher o vão seria fingir informação.
  vendas: n => [
    investimento(n),
    { id: 'custo_venda', rotulo: 'CUSTO POR VENDA', valor: div(n.investimento, n.compras), formato: 'dinheiro', metaKey: 'custo_venda', semaforo: null,
      explicacao: 'Quanto custa trazer uma venda. Usamos custo por venda (e não ROAS) para a régua ser uma só.' },
    { id: 'compras', rotulo: 'VENDAS', valor: qtd(n.compras), formato: 'inteiro', metaKey: null, semaforo: null,
      explicacao: 'Quantas compras a Meta registrou no período.' },
  ],
};

export function cartoesDoBalde(balde, numeros) {
  const receita = RECEITAS[balde] || RECEITAS.todos;
  return receita(numeros || {});
}
```

- [ ] **Passo 4: rodar e ver passar**

Rodar: `npm test -- --test-name-pattern="cartõ|cartoes|TODOS|VENDAS"`
Esperado: PASSA, 9 testes.

- [ ] **Passo 5: desenhar os cartões na tela**

No `update`, no lugar onde hoje cada cartão é preenchido à mão por id
(`ads-spend-val`, `ads-cps-val`, `ads-cpi-val`, `ads-cpl-val`), passe a percorrer
`cartoesDoBalde(_baldeAtual, numeros)` e escrever nos quatro cartões da
`sec2-grid` na ordem devolvida. Regras que **não** podem se perder no caminho:

- `valor === null` escreve `—` e apaga a barrinha de progresso; nunca `R$ 0`.
- O selo **"⏳ consolidando"** do custo por seguidor continua valendo, e só no
  balde Seguidores (é a Meta ainda não tendo publicado quem seguiu).
- Cartão sem `metaKey` não mostra a área de meta editável nem a barrinha.
- Balde com 3 cartões esconde o quarto elemento da grade — a grade se ajusta, o
  vão não fica lá pedindo explicação.
- O texto de `explicacao` vai no `calc-badge` do cartão.

- [ ] **Passo 6: provar no navegador**

Rodar: `npm run dev -- --port 5199 --strictPort` e conferir:
1. **Motoeasy**, Todos: custo por mil impressões **R$ 14,51** e frequência
   **5,02**, ambos com o semáforo aceso. Se saírem cinzas, o limiar não ligou.
2. **Raíssa**, Todos: alcance **1.306.633** (é o número da conta, sem repetir
   gente — se vier ~2,8 milhões, está somando impressão);
3. **Vendas** na Vessel: três cartões, sem vão nem cartão fantasma;
4. **Contatos** na Motoeasy: custo por conversa com número, custo por cadastro
   com número, nada de `R$ 0,00`;
5. a 375px, nenhum título de cartão corta.

- [ ] **Passo 7: commitar**

```bash
git add src/ferramentas/redes-sociais/
git commit -m "Redes: cada balde mostra os indicadores que fazem sentido pra ele"
```

---

## Task 7: As metas passam a ser por balde

**Arquivos:**
- Modificar: `tela-de-redes-sociais.vue` — `GOALS` (553), `RATE_GOALS` (634),
  `goalStorageKey` (633), `_metasUpsert` (836), `metasFetchAll` (841),
  `updateGoalDisplays` (2173)

**Interfaces:**
- Produz: `chaveDeMeta(cartaoId, balde)` → string gravada em
  `social_metas.indicador`.

- [ ] **Passo 1: escrever o teste que falha**

Crie a função no módulo puro e teste junto de `cartoes-do-balde.test.mjs`:

```js
import { chaveDeMeta } from './cartoes-do-balde.js';

test('a meta carrega o balde no nome', () => {
  assert.equal(chaveDeMeta('custo_conversa', 'contatos'), 'contatos.custo_conversa');
  assert.equal(chaveDeMeta('cpm', 'site'), 'site.cpm');
});

test('as metas de hoje continuam valendo, sem prefixo, no balde Seguidores', () => {
  // As linhas cps/cpi/cpl já gravadas foram definidas contra ESTES cartões.
  assert.equal(chaveDeMeta('cps', 'seguidores'), 'cps');
  assert.equal(chaveDeMeta('cpi', 'seguidores'), 'cpi');
  assert.equal(chaveDeMeta('cpl', 'seguidores'), 'cpl');
});

test('o BUDGET de hoje vale para Todos, que é o número contra o qual foi definido', () => {
  assert.equal(chaveDeMeta('spend', 'todos'), 'spend');
});

test('o BUDGET dos demais baldes é PRÓPRIO e nasce sem valor', () => {
  // Uma meta de conta inteira contra o dinheiro de um balde compararia coisas
  // diferentes: a barrinha diria 8% batido no dia em que o dono gastou tudo o que
  // queria em seguidores.
  assert.equal(chaveDeMeta('spend', 'seguidores'), 'seguidores.spend');
  assert.equal(chaveDeMeta('spend', 'contatos'), 'contatos.spend');
});
```

- [ ] **Passo 2: rodar e ver falhar**

Rodar: `npm test -- --test-name-pattern="meta"`
Esperado: FALHA — `chaveDeMeta` não existe.

- [ ] **Passo 3: implementar**

Acrescente a `cartoes-do-balde.js`:

```js
// A chave gravada em social_metas.indicador.
//
// As linhas que já existem no banco (spend, cps, cpi, cpl) continuam valendo, sem
// prefixo, no balde contra o qual foram definidas — migração de LEITURA, sem tocar
// no banco e sem apagar meta de ninguém.
const HERDADAS = { seguidores: ['cps', 'cpi', 'cpl'], todos: ['spend'] };

export function chaveDeMeta(cartaoId, balde) {
  if ((HERDADAS[balde] || []).includes(cartaoId)) return cartaoId;
  return balde + '.' + cartaoId;
}
```

- [ ] **Passo 4: rodar e ver passar**

Rodar: `npm test -- --test-name-pattern="meta"`
Esperado: PASSA, 4 testes.

- [ ] **Passo 5: ligar na tela**

Em `tela-de-redes-sociais.vue`:

1. `goalStorageKey`, `loadGoal`, `saveGoal`, `getGoal` e `updateGoalDisplays`
   passam a receber a chave já resolvida por `chaveDeMeta(cartaoId, _baldeAtual)`.
2. `RATE_GOALS` (as metas que valem igual em todo período) ganha as novas de
   custo: `custo_conversa`, `custo_cadastro`, `custo_visita`, `custo_venda`, `cpm`.
   Custo por resultado não escala com o tamanho do período — só quantidade escala.
3. `GOALS` **não** ganha valor padrão para os baldes novos. **Nascem sem meta**:
   mostram o número sem barrinha até o dono digitar o dele. Herdar meta de outro
   recorte é pior do que não ter.
4. `updateGoalDisplays` percorre os cartões do balde atual, não mais `GOALS`
   inteiro.

- [ ] **Passo 6: provar no navegador que nada foi perdido**

1. Abra em Seguidores e confira que **as metas que já existiam continuam lá**
   (custo por seguidor, por interação, por curtida) — em cada perfil.
2. Vá em Todos e confira que o BUDGET é o mesmo de antes.
3. Vá em Contatos: os cartões aparecem **sem barrinha**, com o número. Digite uma
   meta, clique fora, recarregue a página: tem que voltar.
4. Volte a Seguidores: a meta de lá **não** pode ter mudado.

Depois, pelo MCP `execute_sql` (só leitura):

```sql
select indicador, count(*) from social_metas group by 1 order by 1;
```

Esperado: as chaves antigas continuam existindo, com a mesma contagem de antes, e
as novas aparecem só se você digitou alguma.

- [ ] **Passo 7: commitar**

```bash
git add src/ferramentas/redes-sociais/
git commit -m "Redes: cada balde tem a meta dele, e as metas antigas seguem valendo"
```

---

## Task 8: Fechar — documentar, avisar o provisório e conferir no ar

**Arquivos:**
- Modificar: `src/ferramentas/redes-sociais/LEIA-ME.txt`
- Modificar: `docs/pendencias.md`
- Modificar: `tela-de-redes-sociais.vue` (o aviso de classificação provisória)

- [ ] **Passo 1: o aviso de classificação provisória**

Enquanto `campaign_adsets` estiver vazia para um perfil, **toda** campanha dele cai
pela regra do objetivo — o que significa WhatsApp da Vessel contando como
Seguidores. A tela não pode mostrar isso com cara de número fechado. No `update`,
quando `conjuntosRows.length === 0`:

```js
  // Sem conjunto coletado, a classificação é pelo objetivo — e o objetivo mente
  // em 87% do dinheiro "de engajamento" da Vessel. Avisar é obrigatório.
  mostrarAvisoBalde('Classificação provisória: os tipos de campanha ainda não foram coletados neste perfil. Os valores por balde podem mudar depois da próxima coleta.')
```

Use o mesmo componente de aviso que a tela já usa para "dados desatualizados" — não
crie um estilo novo.

- [ ] **Passo 2: atualizar o LEIA-ME da pasta**

Em `src/ferramentas/redes-sociais/LEIA-ME.txt`, na descrição da seção "02 Meta
Ads", troque o texto por:

```
- "02 Meta Ads": tem uma barra de TIPO DE CAMPANHA em cima (Todos, Seguidores,
  Contatos, Site e alcance, Vendas). Escolher um tipo faz os cartões falarem só
  daquele dinheiro — e os indicadores mudam junto: Seguidores mostra custo por
  seguidor/interação/curtida, Contatos mostra custo por conversa e por cadastro,
  Site e alcance mostra custo por visita, Vendas mostra custo por venda. Em
  "Todos" ficam os quatro que valem pra qualquer campanha: investimento,
  custo por mil impressões, alcance e frequência.
  Quem decide o tipo de cada campanha é o DESTINO que a Meta afirma no conjunto
  (perfil, WhatsApp, site), nunca o nome da campanha — está em
  baldes-do-painel.js, com teste ao lado. A tela abre em "Seguidores", ou em
  "Todos" se o perfil não tiver campanha de seguidor no período.
  O botão "⚙ Filtrar campanhas" continua e vale DENTRO do tipo escolhido.
  Tipo sem gasto no período fica apagado, com o motivo — não some.
```

- [ ] **Passo 3: anotar o que ficou de fora**

Em `docs/pendencias.md`, na parte **B (precisa programar)**, acrescente um item com
o código seguinte da lista:

```
- **B<N> — Backfill dos números novos de campanha.** As colunas conversas,
  cadastros, compras e visitas só existem a partir de 17/08/2026: dia anterior
  mostra "—". Os insights da Meta são re-consultáveis, então dá pra preencher
  para trás com um script que refaça as chamadas por dia. Não entrou na entrega
  dos baldes porque o painel já fica útil sem histórico, e um backfill errado
  gravaria zero por cima de "não sei". Entra quando o dono quiser comparar
  período com período anterior nos baldes novos.
```

- [ ] **Passo 4: rodar tudo antes de dizer que acabou**

```bash
npm test
npm run build
```

Esperado: suíte passa (com os ~30 testes novos) e o build sai sem erro. **Total de
testes menor que o conhecido = arquivo sumindo, não instabilidade — pare e
investigue.**

Confira também que a guarda de imports da pasta continua passando: ela é o que
impede uma função usada e não importada de deixar o painel **em branco** sem nada
no console (já derrubou tela quatro vezes neste projeto).

- [ ] **Passo 5: conferir a trava das janelas**

Abra a tela logada e olhe o console: `verificarTravaJanelas()` roda no
carregamento e não pode reclamar. Esta obra não encosta em `janelasDoPeriodo` — se
a trava disparar, alguma coisa foi mexida sem querer.

- [ ] **Passo 6: commitar e subir**

```bash
git add src/ferramentas/redes-sociais/LEIA-ME.txt docs/pendencias.md src/ferramentas/redes-sociais/tela-de-redes-sociais.vue
git commit -m "Redes: documentar os baldes e avisar quando a classificacao ainda e provisoria"
git push origin <a-branch-desta-tarefa>
```

O push na `main` builda na Vercel. **Confira o deploy pelo caminho**
(home → entrada → chunk), não pelo hash local, que mente. E abra a tela no ar em
dois perfis diferentes antes de considerar entregue.

---

## Revisão do plano contra o desenho

Passei o desenho seção por seção:

| Requisito do desenho | Onde é feito |
|---|---|
| Módulo puro, sinal do conjunto, ordem de precedência | Task 1 |
| Soma dos baldes = Todos | Task 1 (teste) + Task 5 (passo 10, item 6) |
| Campanha sem conjunto cai pelo objetivo | Task 1 (teste) + Task 8 (aviso) |
| Tabela `campaign_adsets` | Task 2 |
| Quatro colunas em `campaign_insights` | Task 2 |
| Coleta dos conjuntos (1 chamada nova) | Task 3 |
| Contagens tiradas do `actions` que já chega | Task 3 |
| Dia antigo mostra "—", nunca R$ 0 | Task 2 (sem default) + Task 6 (teste) |
| Edge com `campanhas` opcional | Task 4 |
| "Todos" segue em `level=account` | Task 4 + Task 5 (passo 8) |
| Conserto da divergência da Vessel | Task 5 (passo 10, itens 3 e 4) |
| Filtro manual vale dentro do balde | Task 5 (`idsParaConsulta`) |
| Barra, balde vazio apagado com motivo | Task 5 |
| Abre em Seguidores, cai em Todos se vazio | Task 5 |
| Cartões trocam por balde | Task 6 |
| Todos com os quatro universais | Task 6 |
| Alcance do nível-conta | Task 6 (passo 6, item 2) |
| Frequência com limiar 4, sem meta | Task 6 (teste) |
| Vendas com três cartões | Task 6 (teste) |
| Metas por balde, antigas preservadas | Task 7 |
| BUDGET por balde, demais nascem sem meta | Task 7 (teste) |
| LEIA-ME e pendências | Task 8 |
| 375px, `npm test`, trava das janelas | Task 8 |

**Sem placeholders:** todo passo de código traz o código. Os únicos pontos em que o
plano descreve em vez de colar são os passos 5 de Task 6 e Task 7, onde a mudança é
dentro de uma função de 240 KB cujo trecho exato depende do que as tasks anteriores
deixaram — ali as **regras** estão listadas item a item, e o teste puro já fixa o
comportamento esperado.

**Nomes conferidos entre tarefas:** `baldeDaCampanha`, `idsDoBalde`,
`idsParaConsulta`, `rotuloDoBalde`, `BALDES` (Task 1 → 5); `contagensDaCampanha`
(Task 3); `somarGasto` (Task 4); `cartoesDoBalde`, `chaveDeMeta` (Task 6 → 7). Os
ids de cartão (`investimento`, `cps`, `cpi`, `cpl`, `cpm`, `alcance`, `frequencia`,
`custo_conversa`, `conversas`, `custo_cadastro`, `custo_visita`, `visitas`,
`custo_venda`, `compras`) são os mesmos em Task 6 e Task 7.

---

## Task 9: Preencher para trás os quatro números novos (backfill)

Acrescentada em 17/08/2026, a pedido do dono, depois que o plano já estava em execução.

**Por que existe:** as colunas `conversas`, `cadastros`, `compras` e `visitas` só
passam a ser gravadas a partir do deploy de hoje. Os cartões funcionam desde a
primeira rodada (o agregado é recoletado inteiro a cada passada), mas a comparação
"vs período anterior" e o gráfico diário leem capturas ANTIGAS, que ficam nulas —
e nulo, corretamente, aparece como "—". Este backfill preenche o passado.

**Arquivos:**
- Criar: `coletor/janelas-de-backfill.mjs` (puro)
- Testar: `coletor/janelas-de-backfill.test.mjs`
- Criar: `coletor/preencher-numeros-de-campanha.mjs` (o script; faz rede e banco)
- Modificar: `.gitignore` (o arquivo de retomada)

**Interfaces:**
- Consome: `contagensDaCampanha(actions)` de
  `supabase/functions/_shared/acoes-de-campanha.js` (Tarefa 3) — a MESMA função do
  coletor, para o número preenchido não poder divergir do número coletado.
- Produz: `janelaDoRecorte(capturedAt, periodDays)` → `{ since, until }` e
  `alvosPendentes(linhas)` → lista ordenada de `{ account_id, captured_at, period_days }`.

### As janelas, tiradas do código que grava cada recorte

Errar isto faz o número novo não bater com o gasto que já está na MESMA linha.
Foram lidas no código, não deduzidas:

| Recorte | Quem grava | Janela |
|---|---|---|
| `0` | `coletarAdsDia` | `since = until = captured_at` |
| `1`, `7`, `14`, `30` | `coletarAdsPorCampanha` | `since = captured_at − period_days`, `until = captured_at` |
| `99` | `coletor/recuperar-curtidas-zeradas.mjs:49` | `since = 1º dia do mês de captured_at`, `until = captured_at` |

Repare que `1`, `7`, `14` e `30` cobrem **N+1 dias** (a subtração é do jeito que o
coletor faz, e o backfill copia o jeito, não o conserta). E `0` NÃO é o mesmo que
`1`: `0` é o dia isolado, `1` são dois dias.

- [ ] **Passo 1: escrever o teste que falha**

Crie `coletor/janelas-de-backfill.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { janelaDoRecorte, alvosPendentes } from './janelas-de-backfill.mjs';

test('recorte 0 é o dia isolado', () => {
  assert.deepEqual(janelaDoRecorte('2026-08-14', 0), { since: '2026-08-14', until: '2026-08-14' });
});

test('recortes de N dias terminam no dia da captura e começam N dias antes', () => {
  // É a conta que coletarAdsPorCampanha faz: d = hoje; d.setDate(d.getDate() - dias).
  assert.deepEqual(janelaDoRecorte('2026-08-14', 7), { since: '2026-08-07', until: '2026-08-14' });
  assert.deepEqual(janelaDoRecorte('2026-08-14', 30), { since: '2026-07-15', until: '2026-08-14' });
  assert.deepEqual(janelaDoRecorte('2026-08-14', 1), { since: '2026-08-13', until: '2026-08-14' });
});

test('recorte 1 NÃO é o mesmo que o recorte 0', () => {
  assert.notDeepEqual(janelaDoRecorte('2026-08-14', 1), janelaDoRecorte('2026-08-14', 0));
});

test('recorte 99 é do primeiro dia do mês até o dia', () => {
  assert.deepEqual(janelaDoRecorte('2026-08-14', 99), { since: '2026-08-01', until: '2026-08-14' });
  assert.deepEqual(janelaDoRecorte('2026-03-03', 99), { since: '2026-03-01', until: '2026-03-03' });
});

test('a virada de mês e de ano não escorrega um dia', () => {
  assert.deepEqual(janelaDoRecorte('2026-03-01', 1), { since: '2026-02-28', until: '2026-03-01' });
  assert.deepEqual(janelaDoRecorte('2026-01-01', 30), { since: '2025-12-02', until: '2026-01-01' });
});

test('recorte desconhecido devolve null em vez de inventar janela', () => {
  assert.equal(janelaDoRecorte('2026-08-14', 3), null);
  assert.equal(janelaDoRecorte('2026-08-14', null), null);
});

test('alvos: uma chamada por conta+data+recorte, sem repetir campanha', () => {
  const linhas = [
    { account_id: 'A', captured_at: '2026-08-01', period_days: 30 },
    { account_id: 'A', captured_at: '2026-08-01', period_days: 30 },
    { account_id: 'A', captured_at: '2026-08-02', period_days: 30 },
    { account_id: 'B', captured_at: '2026-08-01', period_days: 0 },
  ];
  const alvos = alvosPendentes(linhas);
  assert.equal(alvos.length, 3);
});

test('alvos vêm do mais antigo para o mais novo', () => {
  const linhas = [
    { account_id: 'A', captured_at: '2026-08-09', period_days: 7 },
    { account_id: 'A', captured_at: '2026-05-19', period_days: 7 },
  ];
  // O mais antigo primeiro: se o limite da Meta interromper no meio, o que ficou
  // de fora é o mais recente — que é o que a próxima rodada do coletor cobre sozinha.
  assert.equal(alvosPendentes(linhas)[0].captured_at, '2026-05-19');
});

test('alvo de recorte desconhecido é descartado, não vira chamada', () => {
  assert.deepEqual(alvosPendentes([{ account_id: 'A', captured_at: '2026-08-01', period_days: 3 }]), []);
});
```

- [ ] **Passo 2: rodar e ver falhar**

Rodar: `npm test -- --test-name-pattern="recorte|alvos"`
Esperado: FALHA com `Cannot find module './janelas-de-backfill.mjs'`.

- [ ] **Passo 3: escrever o módulo puro**

Crie `coletor/janelas-de-backfill.mjs`:

```js
// A JANELA DE DATAS de cada recorte de campaign_insights.
//
// Cada recorte é gravado por um código diferente, com uma conta de datas
// diferente. O backfill tem de fazer a MESMA pergunta que quem gravou a linha
// fez — senão o número novo não bate com o gasto que já está na mesma linha, e
// duas colunas vizinhas passam a falar de períodos diferentes.
//
// Lido no código em 17/08/2026, não deduzido:
//   0            → coletarAdsDia: time_range {since: dia, until: dia}
//   1, 7, 14, 30 → coletarAdsPorCampanha: until = hoje, since = hoje − dias
//                  (repare: cobre N+1 dias; o backfill COPIA o jeito, não conserta)
//   99           → coletor/recuperar-curtidas-zeradas.mjs: do 1º do mês até o dia
// PURO: sem rede, sem banco.

const RECORTES_DE_N_DIAS = [1, 7, 14, 30];

function menosDias(dia, n) {
  const d = new Date(dia + 'T12:00:00');
  d.setDate(d.getDate() - n);
  return d.toLocaleDateString('en-CA');
}

export function janelaDoRecorte(capturedAt, periodDays) {
  if (!capturedAt) return null;
  if (periodDays === 0) return { since: capturedAt, until: capturedAt };
  if (RECORTES_DE_N_DIAS.includes(periodDays)) return { since: menosDias(capturedAt, periodDays), until: capturedAt };
  if (periodDays === 99) return { since: capturedAt.slice(0, 7) + '-01', until: capturedAt };
  return null; // recorte que ninguém grava hoje: não inventa janela
}

// Uma chamada à Meta cobre TODAS as campanhas de uma conta numa janela. Então o
// alvo é conta + data + recorte, e não a linha (que é por campanha).
// Do mais antigo para o mais novo: se a Meta interromper no meio, o que sobra é o
// pedaço recente, que a própria rodada seguinte do coletor cobre.
export function alvosPendentes(linhas) {
  const vistos = new Set();
  const alvos = [];
  for (const l of (linhas || [])) {
    if (!janelaDoRecorte(l.captured_at, l.period_days)) continue;
    const chave = `${l.account_id}|${l.captured_at}|${l.period_days}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    alvos.push({ account_id: l.account_id, captured_at: l.captured_at, period_days: l.period_days });
  }
  return alvos.sort((a, b) => (a.captured_at < b.captured_at ? -1 : a.captured_at > b.captured_at ? 1 : 0));
}
```

- [ ] **Passo 4: rodar e ver passar**

Rodar: `npm test -- --test-name-pattern="recorte|alvos"`
Esperado: PASSA, 9 testes.

- [ ] **Passo 5: escrever o script**

Crie `coletor/preencher-numeros-de-campanha.mjs`. Ele segue o padrão dos outros
scripts da pasta (lê `coletor/.env`, usa a service key). Regras que são o coração
disto e não podem ser afrouxadas:

```js
// PREENCHER PARA TRÁS conversas, cadastros, compras e visitas em campaign_insights.
//
// Essas quatro colunas só passaram a ser gravadas em 17/08/2026. O que veio antes
// está nulo — e nulo aparece na tela como "—", que é a verdade. Este script
// pergunta à Meta o que já aconteceu e preenche.
//
// AS QUATRO REGRAS QUE NÃO SE NEGOCIAM:
//
// 1. ESCREVE SÓ AS QUATRO COLUNAS. Nunca spend, likes, comments, shares, saves,
//    impressions, clicks ou reach. Uma resposta parcial da Meta já gravou 0 por
//    cima de dado bom neste projeto (232 mil de alcance com 0 curtidas).
// 2. RESPOSTA VAZIA NÃO VIRA ZERO. Se a Meta não devolver nada para aquela
//    janela, o script PULA — deixa nulo. Gravar zero transformaria "não sei" em
//    "custou zero".
// 3. NUNCA usar o Python legado (projetos/central-inteligencia/redes-sociais/
//    coletor/coletar.py). Ele grava a linha INTEIRA e sobrescreveria coluna boa.
// 4. RITMO. As chamadas usam o mesmo token e o mesmo limite da Meta que a tela ao
//    vivo. Em 07/07/2026 uma recoleta martelou a Meta, as chamadas ao vivo
//    tomaram rate limit e o painel caiu no coletado. Pausa entre chamadas, e de
//    madrugada.
//
// Uso:
//   node coletor/preencher-numeros-de-campanha.mjs --dry          (1 alvo, não grava)
//   node coletor/preencher-numeros-de-campanha.mjs                (tudo, grava)
//   node coletor/preencher-numeros-de-campanha.mjs --pausa 3000   (pausa em ms, padrão 2000)
```

O corpo faz, nesta ordem:

1. Lê os alvos: `select account_id, captured_at, period_days from campaign_insights
   where conversas is null` — **só linhas nulas**, o que torna o script idempotente
   e impede que ele passe por cima do que o coletor já gravou bem.
2. `alvosPendentes(linhas)` para virar uma chamada por conta+data+recorte.
3. Lê o arquivo de retomada `coletor/.preencher-numeros-de-campanha.json` (se
   existir) e descarta o que já foi feito.
4. Para cada alvo, em ordem: `janelaDoRecorte(...)`, chama
   `act_{ad_account_id}/insights` com `fields=campaign_id,actions`,
   `level=campaign`, `time_range={since,until}`, paginando; aplica
   `contagensDaCampanha(r.actions)` em cada campanha; e faz **um `update` por
   campanha** com as quatro colunas, filtrando por
   `campaign_id + account_id + captured_at + period_days`.
5. Resposta sem nenhuma linha → **pula**, conta como "vazio", **não** marca como
   feito (pode ser falha da Meta, e a próxima execução tenta de novo).
6. Grava o alvo no arquivo de retomada e dorme a pausa.
7. No fim, imprime: alvos feitos, alvos vazios, linhas atualizadas, e quanto tempo levou.

`--dry` faz **um** alvo (o mais antigo), imprime o que gravaria e **não grava**.
É uma chamada à Meta, e serve para provar o caminho inteiro sem risco.

Acrescente ao `.gitignore`:

```
coletor/.preencher-numeros-de-campanha.json
```

- [ ] **Passo 6: provar o caminho com UMA chamada**

Rodar: `node coletor/preencher-numeros-de-campanha.mjs --dry`

Esperado: imprime o alvo mais antigo (conta, data, recorte), a janela calculada, e
a lista de campanhas com os quatro números que ele gravaria. **Nada é gravado** —
confira com o `select count(conversas) from campaign_insights` antes e depois: o
número não pode mudar.

- [ ] **Passo 7: rodar a suíte e commitar**

```bash
npm test
git add coletor/janelas-de-backfill.mjs coletor/janelas-de-backfill.test.mjs coletor/preencher-numeros-de-campanha.mjs .gitignore
git commit -m "Backfill: preencher para tras conversas, cadastros, compras e visitas"
```

- [ ] **Passo 8: A EXECUÇÃO COMPLETA É DECISÃO DO DONO — não rodar por conta própria**

São ~2.600 chamadas, ~1h30 com pausa de 2s. Só roda em janela de madrugada ou com
o dono acompanhando o painel. Quem executa registra antes e depois:

```sql
select count(*) linhas, count(conversas) preenchidas from campaign_insights;
```

E confere que `count(*)` **não mudou** — o script atualiza, nunca insere.
