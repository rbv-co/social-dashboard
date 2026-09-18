# Sales / Leads por link de anúncio — Plano de Implementação

> **Para quem for executar:** use superpowers:subagent-driven-development
> (recomendado) ou superpowers:executing-plans para rodar este plano
> tarefa por tarefa. Os passos usam checkbox (`- [ ]`) para acompanhar.

**Objetivo:** classificar anúncios de campanhas "outro" (sem prefixo
`[CAMPANHA WPP]`/`[+ SEGUIDORES]`/`[+ ENGAJAMENTO]`) em Sales/Leads pelo
DESTINO DO LINK do criativo — nível de anúncio, não campanha — e expor o
resultado no Relatório por Hora e no OPR diário.

**Arquitetura:** duas tabelas novas (`ads`: catálogo nome/link, sincronizado
pelo `coletar-dados`; `ad_insights_hora`: gasto/clique por hora, alimentada
pelo `coletar-dados-hora`), uma função pura de classificação por domínio, e
os mesmos padrões de agregação/exibição já usados em `campaign_insights_hora`.

**Tech Stack:** Postgres (Supabase), Deno Edge Functions, Vue 3
`<script setup>`, Node ESM puro pro `coletor/`.

**Spec:** `docs/superpowers/specs/2026-09-18-sales-leads-por-link-de-anuncio-design.md`

## Global Constraints

- Conta única nesta entrega: `b6883e82-07cb-4f21-9fd7-ea7626786174` (Vessel)
  — mesma constante `CONTA_VESSEL` já usada em todo o módulo meta-ads.
- Nunca inventa número: divisão por zero/contagem ausente vira `null`
  (função `custoPorLead`, já existe, reaproveitada — nunca reescrever essa
  regra em outro lugar).
- RLS de tabela nova SEMPRE nasce com pelo menos uma política PERMISSIVE —
  uma só RESTRICTIVE nega tudo (bug real, já ocorrido duas vezes neste
  projeto: `campaign_insights_hora` em 11/09/2026 e `perfil_visitas_hora`
  em 12/09/2026, cada uma exigindo uma segunda migration corretiva). As
  duas políticas nascem na MESMA migration desta vez.
- Tabela nova de métrica (números de gasto/clique) segue o padrão de
  `ad_insights_hora`: `revoke all ... from public, anon, authenticated;
  grant select ... to authenticated;` — nunca deixa a concessão padrão
  (INSERT/UPDATE/DELETE pra anon/authenticated) de pé.
- `classificarLinkAnuncio` verifica o padrão de LEADS (`universovessel` +
  `narrativa` na URL) ANTES do domínio de SALES — o link real observado
  (`vesselbrasil.com.br/universovessel#narrativa`) tem o domínio de Sales
  E o caminho de Leads ao mesmo tempo; checar domínio primeiro classificaria
  errado.
- Nenhuma mensagem de WhatsApp nova nesta entrega (fora de escopo, spec §11).
- Nenhum layout de imagem do OPR nesta entrega (fora de escopo, spec §11).

---

## Task 1: Migrations — catálogo `ads` e métricas `ad_insights_hora`

**Files:**
- Create: `db/migrations/2026-09-18-meta-ads-catalogo-anuncios.sql`
- Create: `db/migrations/2026-09-18-meta-ads-ad-insights-hora.sql`

**Interfaces:**
- Produces: tabela `public.ads` (`ad_id` PK text, `campaign_id` text,
  `account_id` uuid, `name` text, `status` text, `destino_link` text
  nullable, `synced_at` date) e tabela `public.ad_insights_hora`
  (`ad_id`/`campaign_id`/`account_id`/`dia`/`hora` chave via `unique`,
  `gasto_acumulado`/`gasto_hora` numeric, `cliques_acumulados`/
  `cliques_hora` integer, `coletado_em` timestamptz).

- [ ] **Passo 1: Escrever a migration do catálogo**

`db/migrations/2026-09-18-meta-ads-catalogo-anuncios.sql`:

```sql
-- CATÁLOGO DE ANÚNCIOS — nome, status e link de destino do criativo.
--
-- Pedido do dono (18/09/2026): campanhas "outro" (sem prefixo — AXIOM e
-- afins) precisam ser classificadas em Sales/Leads pelo LINK DE DESTINO do
-- anúncio, não pela campanha — confirmado com dado real que a mesma
-- campanha/conjunto mistura anúncios com destinos diferentes. Este catálogo
-- é o equivalente de `campaigns` (nome/status), um nível abaixo: por
-- ANÚNCIO, não por campanha. Sincronizado pelo `coletar-dados` (roda menos
-- vezes ao dia, nome/link não mudam de hora em hora).
--
-- `categoria` (sales/leads) NÃO é coluna aqui — sempre recalculada por
-- classificarLinkAnuncio(destino_link) em JS (src/ferramentas/meta-ads/
-- relatorio-por-hora.js), nunca guardada: se a regra de classificação mudar
-- (domínio novo, por exemplo), o histórico já gravado se reclassifica
-- sozinho, sem precisar reprocessar nada.
create table public.ads (
  ad_id        text primary key,
  campaign_id  text not null,
  account_id   uuid not null,
  name         text not null default '',
  status       text not null default '',
  destino_link text,
  synced_at    date not null default current_date
);

comment on table public.ads is
  'Catálogo de anúncios (nome, status, link de destino do criativo) — '
  'sincronizado pelo coletar-dados, junto com campaigns. Gasto/clique por '
  'hora fica em ad_insights_hora, à parte.';

alter table public.ads enable row level security;

-- MESMO padrão de public.campaigns: uma PERMISSIVE ampla (authenticated lê
-- geral) + uma RESTRICTIVE que já estreita pra só conta liberada. As duas
-- juntas: só authenticated, só conta que pode_ver_conta() autoriza.
create policy auth_read_ads on public.ads
  for select to authenticated
  using (auth.role() = 'authenticated');

create policy so_contas_permitidas on public.ads
  as restrictive for select to authenticated
  using (public.pode_ver_conta(account_id::text));

revoke all on table public.ads from public, anon, authenticated;
grant  select on table public.ads to authenticated;
```

- [ ] **Passo 2: Escrever a migration de métricas por hora**

`db/migrations/2026-09-18-meta-ads-ad-insights-hora.sql`:

```sql
-- GASTO E CLIQUES NO LINK, por ANÚNCIO, por hora.
--
-- Mesmo desenho de campaign_insights_hora: grava o acumulado do dia, o robô
-- (coletar-dados-hora) já calcula o delta, a tela NUNCA recalcula. Só cobre
-- anúncios de campanha "outro" (tipoDaCampanha) com link classificável —
-- ver classificarLinkAnuncio() e a spec de 18/09/2026.
create table public.ad_insights_hora (
  ad_id              text        not null,
  campaign_id        text        not null,
  account_id         uuid        not null,
  dia                date        not null,
  hora               smallint    not null check (hora between 0 and 23),
  gasto_acumulado    numeric     not null default 0,
  gasto_hora         numeric     not null default 0,
  cliques_acumulados integer     not null default 0,
  cliques_hora       integer     not null default 0,
  coletado_em        timestamptz not null default now(),
  unique (ad_id, account_id, dia, hora)
);

comment on table public.ad_insights_hora is
  'Gasto e cliques no link (link_click) por ANÚNCIO, por hora, com delta '
  'já calculado. Só cobre anúncios de campanhas "outro" (tipoDaCampanha) '
  '— ver classificarLinkAnuncio() pra Sales/Leads. Alimentada pela Edge '
  'Function coletar-dados-hora.';

alter table public.ad_insights_hora enable row level security;

-- As DUAS políticas NA MESMA migration — campaign_insights_hora e
-- perfil_visitas_hora precisaram de uma segunda migration corretiva cada
-- (11/09 e 12/09/2026) porque a RESTRICTIVE sozinha nega tudo sem NENHUMA
-- permissiva. Não repetir o erro.
create policy so_contas_permitidas on public.ad_insights_hora
  as restrictive for select to authenticated
  using (public.pode_ver_conta(account_id::text));

create policy ad_insights_hora_leitura on public.ad_insights_hora
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
       where p.id = auth.uid()
         and (p.role = 'admin' or p.is_superadmin or p.permissions ? 'meta.hora')
    )
  );

revoke all on table public.ad_insights_hora from public, anon, authenticated;
grant  select on table public.ad_insights_hora to authenticated;
```

- [ ] **Passo 3: Conferir pendências antes de aplicar**

```bash
node coletor/run-migrations.mjs --dry
```

Se a lista de pendentes tiver SÓ os dois arquivos deste passo, siga pro
Passo 4. Se aparecer qualquer outro arquivo pendente que não seja seu
(outra sessão trabalhando no mesmo repositório em paralelo — já aconteceu
nesta mesma conta/projeto), NÃO rode o runner geral: aplique só os dois
arquivos novos, um script avulso (mesmo padrão já usado antes neste
projeto: BEGIN, aplica o SQL do arquivo, INSERT em `schema_migrations`,
COMMIT — ver `coletor/run-acessos-sql.mjs` como referência de conexão).

- [ ] **Passo 4: Aplicar**

```bash
node coletor/run-migrations.mjs
```

- [ ] **Passo 5: Confirmar que as tabelas existem e têm as duas políticas cada**

Rode uma consulta rápida (script Node temporário com `pg`, mesmo padrão já
usado nesta sessão pra inspecionar schema — apagar o script depois):

```sql
select tablename, policyname, permissive from pg_policies
 where tablename in ('ads', 'ad_insights_hora') order by tablename, permissive;
```

Esperado: 2 linhas pra `ads` (1 PERMISSIVE, 1 RESTRICTIVE), 2 linhas pra
`ad_insights_hora` (1 PERMISSIVE, 1 RESTRICTIVE).

- [ ] **Passo 6: Commit**

```bash
git add db/migrations/2026-09-18-meta-ads-catalogo-anuncios.sql db/migrations/2026-09-18-meta-ads-ad-insights-hora.sql
git commit -m "feat(meta-ads): tabelas ads e ad_insights_hora, RLS completa desde o início"
```

---

## Task 2: `classificarLinkAnuncio` — classificação por domínio

**Files:**
- Modify: `src/ferramentas/meta-ads/relatorio-por-hora.js`
- Test: `src/ferramentas/meta-ads/relatorio-por-hora.test.mjs`

**Interfaces:**
- Produces: `classificarLinkAnuncio(url: string|null): 'sales'|'leads'|null`

- [ ] **Passo 1: Escrever os testes (falhando)**

Adicionar ao fim de `src/ferramentas/meta-ads/relatorio-por-hora.test.mjs`
(ajustar o import do topo do arquivo para incluir `classificarLinkAnuncio`):

```js
test('classificarLinkAnuncio: domínios de Sales, com e sem www', () => {
  assert.equal(classificarLinkAnuncio('https://vesselbrasil.com.br/?utm_source=meta'), 'sales');
  assert.equal(classificarLinkAnuncio('https://loja.vesselbrasil.com.br/'), 'sales');
  assert.equal(classificarLinkAnuncio('https://www.lavessel.com.br/'), 'sales');
  assert.equal(classificarLinkAnuncio('https://lavessel.com.br/'), 'sales');
});

test('classificarLinkAnuncio: caminho /universovessel#narrativa é Leads', () => {
  assert.equal(classificarLinkAnuncio('https://vesselbrasil.com.br/universovessel#narrativa'), 'leads');
});

test('classificarLinkAnuncio: mesmo domínio de Sales, caminho de Leads GANHA de Sales', () => {
  // Link real observado (18/09/2026): mesmo host de vesselbrasil.com.br,
  // mas o CAMINHO é o de narrativa — tem que sair "leads", não "sales".
  assert.equal(classificarLinkAnuncio('https://vesselbrasil.com.br/universovessel#narrativa?utm_content=x'), 'leads');
});

test('classificarLinkAnuncio: domínio desconhecido e ausência de link viram null', () => {
  assert.equal(classificarLinkAnuncio('https://outraloja.com.br/'), null);
  assert.equal(classificarLinkAnuncio(null), null);
  assert.equal(classificarLinkAnuncio(undefined), null);
  assert.equal(classificarLinkAnuncio(''), null);
});

test('classificarLinkAnuncio: URL malformada não quebra, vira null', () => {
  assert.equal(classificarLinkAnuncio('não é url'), null);
});
```

- [ ] **Passo 2: Rodar e confirmar que falha**

```bash
node --test src/ferramentas/meta-ads/relatorio-por-hora.test.mjs
```

Esperado: FAIL, `classificarLinkAnuncio is not defined` (ou `not a function`).

- [ ] **Passo 3: Implementar**

Adicionar em `src/ferramentas/meta-ads/relatorio-por-hora.js`, depois de
`tipoDaCampanha` (mesma vizinhança — mesma responsabilidade: classificar
algo do Meta Ads por um sinal textual):

```js
// Classifica um ANÚNCIO (não campanha) pelo destino do link do criativo —
// pedido do dono (18/09/2026): campanhas "outro" (sem prefixo, ex. AXIOM)
// misturam anúncio Sales e anúncio Leads na MESMA campanha/conjunto,
// confirmado com dado real; por isso o recorte é por anúncio, e nunca por
// campanha.
//
// ORDEM IMPORTA: checa o caminho de Leads ANTES do domínio de Sales — o
// link real observado (vesselbrasil.com.br/universovessel#narrativa) tem o
// MESMO domínio da lista de Sales só que com esse caminho, e o dono
// classificou como Leads. Checar domínio primeiro classificaria errado.
export function classificarLinkAnuncio(url) {
  if (!url) return null;
  if (url.includes('universovessel') && url.includes('narrativa')) return 'leads';
  let host;
  try {
    host = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
  if (host === 'vesselbrasil.com.br' || host === 'loja.vesselbrasil.com.br' || host === 'lavessel.com.br') {
    return 'sales';
  }
  return null;
}
```

- [ ] **Passo 4: Rodar e confirmar que passa**

```bash
node --test src/ferramentas/meta-ads/relatorio-por-hora.test.mjs
```

Esperado: PASS, todos os testes.

- [ ] **Passo 5: Commit**

```bash
git add src/ferramentas/meta-ads/relatorio-por-hora.js src/ferramentas/meta-ads/relatorio-por-hora.test.mjs
git commit -m "feat(meta-ads): classificarLinkAnuncio — Sales/Leads pelo destino do link"
```

---

## Task 3: `linkDoCriativo` e `linkClicks` — extração e leitura da Graph API

**Files:**
- Modify: `supabase/functions/_shared/delta-de-hora.js`
- Test: `supabase/functions/_shared/delta-de-hora.test.mjs`

**Interfaces:**
- Consumes: nenhuma interface de outra tarefa.
- Produces: `linkDoCriativo(creative: object|null): string|null`,
  `linkClicks(actions: array|null): number`.

- [ ] **Passo 1: Escrever os testes (falhando)**

Adicionar ao fim de `supabase/functions/_shared/delta-de-hora.test.mjs`
(ajustar o import do topo pra incluir `linkDoCriativo, linkClicks`):

```js
test('linkDoCriativo: object_story_spec.link_data.link é o formato mais comum', () => {
  const creative = { object_story_spec: { link_data: { link: 'https://vesselbrasil.com.br/?utm=x' } } };
  assert.equal(linkDoCriativo(creative), 'https://vesselbrasil.com.br/?utm=x');
});

test('linkDoCriativo: video_data com call_to_action.value.link', () => {
  const creative = { object_story_spec: { video_data: { call_to_action: { value: { link: 'https://vesselbrasil.com.br/universovessel#narrativa' } } } } };
  assert.equal(linkDoCriativo(creative), 'https://vesselbrasil.com.br/universovessel#narrativa');
});

test('linkDoCriativo: asset_feed_spec.link_urls (criativo dinâmico), junta se tiver mais de um', () => {
  const creative = { asset_feed_spec: { link_urls: [{ website_url: 'https://vesselbrasil.com.br/a' }, { website_url: 'https://vesselbrasil.com.br/b' }] } };
  assert.equal(linkDoCriativo(creative), 'https://vesselbrasil.com.br/a | https://vesselbrasil.com.br/b');
});

test('linkDoCriativo: object_url como último recurso', () => {
  assert.equal(linkDoCriativo({ object_url: 'https://vesselbrasil.com.br/x' }), 'https://vesselbrasil.com.br/x');
});

test('linkDoCriativo: sem creative ou sem nenhum campo conhecido vira null (ex.: anúncio clique-pro-WhatsApp)', () => {
  assert.equal(linkDoCriativo(null), null);
  assert.equal(linkDoCriativo(undefined), null);
  assert.equal(linkDoCriativo({ object_story_spec: {} }), null);
  assert.equal(linkDoCriativo({ asset_feed_spec: { message_extensions: [{ type: 'whatsapp' }] } }), null);
});

test('linkClicks: acha link_click, e 0 sem actions ou sem o tipo', () => {
  assert.equal(linkClicks([{ action_type: 'link_click', value: '42' }]), 42);
  assert.equal(linkClicks(null), 0);
  assert.equal(linkClicks([]), 0);
  assert.equal(linkClicks([{ action_type: 'post_reaction', value: '9' }]), 0);
});
```

- [ ] **Passo 2: Rodar e confirmar que falha**

```bash
node --test supabase/functions/_shared/delta-de-hora.test.mjs
```

Esperado: FAIL, `linkDoCriativo`/`linkClicks` não definidos.

- [ ] **Passo 3: Implementar**

Adicionar em `supabase/functions/_shared/delta-de-hora.js`, ao final do
arquivo:

```js
// Extrai o link de destino de um criativo de anúncio — testado ao vivo na
// Graph API (18/09/2026) contra os 4 formatos reais encontrados nas
// campanhas AXIOM. `null` quando nenhum campo bate (ex.: anúncio de
// clique-para-WhatsApp, que não tem link de site nenhum — `message_extensions`
// com `type: whatsapp` no lugar de link).
export function linkDoCriativo(creative) {
  if (!creative) return null;
  const osp = creative.object_story_spec;
  if (osp?.link_data?.link) return osp.link_data.link;
  if (osp?.video_data?.call_to_action?.value?.link) return osp.video_data.call_to_action.value.link;
  const afs = creative.asset_feed_spec;
  if (afs?.link_urls?.length) return afs.link_urls.map((l) => l.website_url).join(' | ');
  if (creative.object_url) return creative.object_url;
  return null;
}

// Cliques no link (link_click) — mesmo formato de conversasIniciadas, tipo
// de ação diferente. Usado pra Sales/Leads por link de anúncio (18/09/2026).
export function linkClicks(actions) {
  if (!Array.isArray(actions)) return 0;
  const achado = actions.find((a) => a && a.action_type === 'link_click');
  return achado ? parseInt(achado.value ?? '0', 10) || 0 : 0;
}
```

- [ ] **Passo 4: Rodar e confirmar que passa**

```bash
node --test supabase/functions/_shared/delta-de-hora.test.mjs
```

- [ ] **Passo 5: Commit**

```bash
git add supabase/functions/_shared/delta-de-hora.js supabase/functions/_shared/delta-de-hora.test.mjs
git commit -m "feat(meta-ads): linkDoCriativo e linkClicks — extração de link e clique da Graph API"
```

---

## Task 4: `coletar-dados` sincroniza o catálogo `ads`

**Files:**
- Modify: `supabase/functions/coletar-dados/index.ts`

**Interfaces:**
- Consumes: `linkDoCriativo` (Task 3, `_shared/delta-de-hora.js`), tabela
  `public.ads` (Task 1).
- Produces: `public.ads` populada, uma linha por anúncio de cada conta com
  `ad_account_id`.

Sem teste automatizado aqui — igual a `sincronizarCampanhas`, que também
não tem `.test.mjs` (é I/O direto contra a Meta e o Supabase, verificado
por execução real, não por unidade). Verificação no Passo 3.

- [ ] **Passo 1: Importar `linkDoCriativo`**

No topo de `supabase/functions/coletar-dados/index.ts`, junto dos outros
imports de `_shared`:

```ts
import { linkDoCriativo } from '../_shared/delta-de-hora.js';
```

- [ ] **Passo 2: Adicionar `sincronizarAnuncios`**

Logo depois de `sincronizarCampanhas` (mesmo arquivo, ~linha 398):

```ts
// Catálogo de anúncios (nome, status, link de destino) — pedido do dono
// (18/09/2026), pra classificar Sales/Leads por link. Busca TODOS os
// anúncios da conta, não só os de campanha "outro": mais simples sincronizar
// tudo aqui e filtrar por tipoDaCampanha na hora de LER (coletar-dados-hora),
// assim uma campanha que muda de "outro" pra um prefixo conhecido não deixa
// lixo travado no catálogo.
async function sincronizarAnuncios(sb: any, accountId: string, adAccountId: string, token: string) {
  try {
    const items = await apiGetAll(`act_${adAccountId}/ads`, {
      fields: 'id,name,campaign_id,status,creative{object_story_spec,asset_feed_spec,object_url}',
      access_token: token,
    });
    const rows = items.map((a: any) => ({
      ad_id: a.id, campaign_id: a.campaign_id, account_id: accountId,
      name: a.name ?? '', status: a.status ?? '',
      destino_link: linkDoCriativo(a.creative), synced_at: todayBR(),
    }));
    if (rows.length) await sb.from('ads').upsert(rows, { onConflict: 'ad_id' });
  } catch { /* sem ads */ }
}
```

- [ ] **Passo 3: Chamar no loop de contas**

No bloco `if (adAccountId) { ... }` (~linha 565), adicionar a chamada logo
depois de `sincronizarCampanhas`:

```ts
  if (adAccountId) {
    await sincronizarCampanhas(sb, accountId, adAccountId, token);
    await sincronizarAnuncios(sb, accountId, adAccountId, token);
    await sincronizarConjuntos(sb, accountId, adAccountId, token);
    for (const dias of PERIODS) await coletarAdsPorCampanha(sb, adAccountId, accountId, token, dias, hoje);
    for (let dd = 1; dd <= 7; dd++) await coletarAdsDia(sb, adAccountId, accountId, token, brDateMinus(dd));
  }
```

- [ ] **Passo 4: Deploy e verificação real**

Seguir a regra de `CLAUDE.md` §"ANTES DE PUBLICAR EDGE FUNCTION" — `git
fetch`, publicar só o que já está na `main`, comparar com o que está no ar
antes de sobrescrever. Depois de publicar:

```bash
npx supabase functions deploy coletar-dados --project-ref kounqtdoioootxqegkij --no-verify-jwt
```

Disparar manualmente (mesmo segredo de cron que as outras funções já
usam) e checar:

```sql
select count(*), count(destino_link) from public.ads where account_id = 'b6883e82-07cb-4f21-9fd7-ea7626786174';
```

Esperado: linhas > 0, e `count(destino_link)` bem menor que `count(*)`
(nem todo anúncio tem link — ex. os de clique-pro-WhatsApp).

- [ ] **Passo 5: Commit**

```bash
git add supabase/functions/coletar-dados/index.ts
git commit -m "feat(meta-ads): coletar-dados sincroniza catálogo de anúncios (nome/link)"
```

---

## Task 5: `coletar-dados-hora` grava gasto/clique por anúncio "outro"

**Files:**
- Modify: `supabase/functions/coletar-dados-hora/index.ts`

**Interfaces:**
- Consumes: `linkClicks` (Task 3), `deltaSimples` (já importado nesse
  arquivo), `tipoDaCampanha` de `../_shared/relatorio-por-hora.js` (já
  existe — mirror manual de `src/ferramentas/meta-ads/relatorio-por-hora.js`,
  usado hoje só por `enviar-relatorio-hora`), tabelas `public.campaigns`,
  `public.ads` (Task 4 já populou), `public.ad_insights_hora` (Task 1).
- Produces: `public.ad_insights_hora` populada de hora em hora.

**Depende de**: Task 4 já ter rodado pelo menos uma vez em produção (senão
`ads`/`campaigns` estão vazias e esta tarefa não grava nada — não quebra,
só não tem o que gravar ainda).

Sem teste automatizado — mesmo motivo de `coletarConta`/
`coletarVisitasPerfilDaConta`, que também não têm `.test.mjs` (I/O direto,
verificado por execução real). A lógica pura (delta) já está coberta pelos
testes de `deltaSimples`/`linkClicks` (Tasks 2 e 3).

- [ ] **Passo 1: Importar `tipoDaCampanha` e `linkClicks`**

No topo de `supabase/functions/coletar-dados-hora/index.ts`:

```ts
import {
  conversasIniciadas, calcularDeltaHora, visitasNoPerfil, deltaSimples, linkClicks,
} from '../_shared/delta-de-hora.js';
import { tipoDaCampanha } from '../_shared/relatorio-por-hora.js';
```

- [ ] **Passo 2: Adicionar `coletarAnunciosOutroPorHora`**

Ao lado de `coletarVisitasPerfilDaConta`:

```ts
// Gasto e clique no link, por ANÚNCIO, só pra campanhas "outro" (sem
// prefixo conhecido — AXIOM e afins) — pedido do dono (18/09/2026):
// classificar Sales/Leads pelo destino do link do anúncio, confirmado que
// precisa ser por ANÚNCIO porque a mesma campanha/conjunto mistura
// destinos. `campaigns`/`ads` já estão sincronizadas pelo coletar-dados
// (nome/link não mudam de hora em hora, não vale perguntar de novo aqui).
async function coletarAnunciosOutroPorHora(sb: any, acc: any, dia: string, hora: number, degraded: string[]): Promise<void> {
  const { id: accountId, ad_account_id: adAccountId, access_token: token, name } = acc;
  if (!adAccountId || !token) return;
  try {
    const { data: campanhasRows, error: erroCampanhas } = await sb
      .from('campaigns').select('campaign_id,name').eq('account_id', accountId);
    if (erroCampanhas) { degraded.push(`${name}: falha ao ler campanhas p/ ads (${erroCampanhas.message})`); return; }
    const campanhasOutro = new Set(
      (campanhasRows ?? []).filter((c: any) => tipoDaCampanha(c.name ?? '') === 'outro').map((c: any) => c.campaign_id),
    );
    if (!campanhasOutro.size) return;

    const { data: adsRows, error: erroAds } = await sb
      .from('ads').select('ad_id,campaign_id,destino_link')
      .eq('account_id', accountId).not('destino_link', 'is', null);
    if (erroAds) { degraded.push(`${name}: falha ao ler catálogo de ads (${erroAds.message})`); return; }
    const adsNoEscopo = new Set(
      (adsRows ?? []).filter((a: any) => campanhasOutro.has(a.campaign_id)).map((a: any) => a.ad_id),
    );
    if (!adsNoEscopo.size) return;

    const items = await apiGetAll(`act_${adAccountId}/insights`, {
      fields: 'ad_id,campaign_id,spend,actions',
      time_range: JSON.stringify({ since: dia, until: dia }),
      level: 'ad',
      access_token: token,
    });
    const itemsNoEscopo = items.filter((r: any) => adsNoEscopo.has(r.ad_id));
    if (!itemsNoEscopo.length) return;

    const { data: anterioresRows, error: erroAnteriores } = await sb
      .from('ad_insights_hora')
      .select('ad_id,gasto_acumulado,cliques_acumulados,hora')
      .eq('account_id', accountId).eq('dia', dia).lt('hora', hora)
      .order('hora', { ascending: false });
    if (erroAnteriores) { degraded.push(`${name}: falha ao ler ad_insights_hora anterior (${erroAnteriores.message})`); return; }
    const anteriorPorAnuncio = new Map<string, any>();
    for (const row of anterioresRows ?? []) {
      if (!anteriorPorAnuncio.has(row.ad_id)) anteriorPorAnuncio.set(row.ad_id, row);
    }

    const linhas = itemsNoEscopo.map((r: any) => {
      const adId = r.ad_id;
      const gastoAcumulado = parseFloat(r.spend ?? '0');
      const cliquesAcumulados = linkClicks(r.actions);
      const anterior = anteriorPorAnuncio.get(adId) ?? null;
      return {
        ad_id: adId, campaign_id: r.campaign_id, account_id: accountId, dia, hora,
        gasto_acumulado: gastoAcumulado, cliques_acumulados: cliquesAcumulados,
        gasto_hora: deltaSimples(gastoAcumulado, anterior?.gasto_acumulado),
        cliques_hora: deltaSimples(cliquesAcumulados, anterior?.cliques_acumulados),
      };
    });

    const { error: erroUpsert } = await sb
      .from('ad_insights_hora').upsert(linhas, { onConflict: 'ad_id,account_id,dia,hora' });
    if (erroUpsert) { degraded.push(`${name}: falha ao gravar ad_insights_hora (${erroUpsert.message})`); return; }

    console.log(`✓ ${name}: ${linhas.length} anúncios (sales/leads por link)`);
  } catch (e) {
    degraded.push(`${name}: ads outro (${e instanceof Error ? e.message : String(e)})`);
  }
}
```

- [ ] **Passo 3: Chamar no loop de contas**

No `Deno.serve`, dentro do `Promise.all` que já chama
`coletarSeguidoresDaConta`/`coletarVisitasPerfilDaConta`:

```ts
    await Promise.all([
      coletarSeguidoresDaConta(sb, acc, degraded),
      coletarVisitasPerfilDaConta(sb, acc, dia, hora, degraded),
      coletarAnunciosOutroPorHora(sb, acc, dia, hora, degraded),
    ]);
```

- [ ] **Passo 4: Deploy e verificação real**

Mesma regra do `CLAUDE.md` (fetch/main atualizada/comparar antes de
sobrescrever):

```bash
npx supabase functions deploy coletar-dados-hora --project-ref kounqtdoioootxqegkij --no-verify-jwt
```

Checar `verify_jwt` desligado e testar com `Authorization: Bearer errado`
→ espera `401 {"error":"nao_autorizado"}` (regra do CLAUDE.md, item 6).

Depois de uma rodada real (ou disparo manual), conferir:

```sql
select count(*) from public.ad_insights_hora where account_id = 'b6883e82-07cb-4f21-9fd7-ea7626786174';
```

- [ ] **Passo 5: Commit**

```bash
git add supabase/functions/coletar-dados-hora/index.ts
git commit -m "feat(meta-ads): coletar-dados-hora grava gasto/clique por anúncio outro (sales/leads por link)"
```

---

## Task 6: Agrupamento e recorte de anúncios — lógica pura de leitura

**Files:**
- Modify: `src/ferramentas/meta-ads/relatorio-por-hora.js`
- Test: `src/ferramentas/meta-ads/relatorio-por-hora.test.mjs`

**Interfaces:**
- Consumes: `classificarLinkAnuncio` (Task 2), `custoPorLead` (já existe).
- Produces: `agruparAnunciosPorDiaEHora(linhas, nomesPorAnuncio,
  linksPorAnuncio): [{dia, gastoTotal, horas: [{hora, gastoTotal,
  cliquesTotal, anuncios: [{adId, campaignId, nome, destinoLink,
  gastoHora, cliquesHora, custoPorClique}]}]}]`,
  `anunciosPorCategoria(anuncios, categoria): anuncios filtrados`.

- [ ] **Passo 1: Escrever os testes (falhando)**

Adicionar ao fim de `relatorio-por-hora.test.mjs` (ajustar import do
topo):

```js
test('agruparAnunciosPorDiaEHora: agrupa por dia/hora, granularidade é ad_id (não campaign_id)', () => {
  const linhas = [
    { dia: '2026-09-18', hora: 9, ad_id: 'a1', campaign_id: 'c1', gasto_hora: 10, cliques_hora: 2 },
    { dia: '2026-09-18', hora: 9, ad_id: 'a2', campaign_id: 'c1', gasto_hora: 5, cliques_hora: 0 },
  ];
  const out = agruparAnunciosPorDiaEHora(linhas, { a1: 'Anúncio A', a2: 'Anúncio B' }, { a1: 'https://vesselbrasil.com.br/', a2: 'https://vesselbrasil.com.br/universovessel#narrativa' });
  assert.equal(out.length, 1);
  assert.equal(out[0].horas[0].anuncios.length, 2, 'dois anúncios da MESMA campanha não se misturam numa linha só');
  assert.deepEqual(out[0].horas[0].anuncios.map((a) => a.adId).sort(), ['a1', 'a2']);
  assert.equal(out[0].horas[0].gastoTotal, 15);
  assert.equal(out[0].horas[0].cliquesTotal, 2);
});

test('agruparAnunciosPorDiaEHora: custoPorClique null sem clique, nome cai pro próprio ad_id sem mapa', () => {
  const linhas = [{ dia: '2026-09-18', hora: 9, ad_id: 'a9', campaign_id: 'c1', gasto_hora: 30, cliques_hora: 0 }];
  const out = agruparAnunciosPorDiaEHora(linhas);
  const a = out[0].horas[0].anuncios[0];
  assert.equal(a.nome, 'a9');
  assert.equal(a.custoPorClique, null);
  assert.equal(a.destinoLink, null);
});

test('agruparAnunciosPorDiaEHora: zero linhas não quebra, devolve array vazio', () => {
  assert.deepEqual(agruparAnunciosPorDiaEHora([]), []);
});

test('anunciosPorCategoria: recorta certo por sales/leads, link não classificável não entra em nenhuma', () => {
  const linhas = [
    { dia: '2026-09-18', hora: 9, ad_id: 'a1', campaign_id: 'c1', gasto_hora: 10, cliques_hora: 2 },
    { dia: '2026-09-18', hora: 9, ad_id: 'a2', campaign_id: 'c1', gasto_hora: 5, cliques_hora: 1 },
    { dia: '2026-09-18', hora: 9, ad_id: 'a3', campaign_id: 'c1', gasto_hora: 3, cliques_hora: 0 },
  ];
  const links = { a1: 'https://vesselbrasil.com.br/', a2: 'https://vesselbrasil.com.br/universovessel#narrativa', a3: 'https://outraloja.com.br/' };
  const anuncios = agruparAnunciosPorDiaEHora(linhas, {}, links)[0].horas[0].anuncios;
  assert.deepEqual(anunciosPorCategoria(anuncios, 'sales').map((a) => a.adId), ['a1']);
  assert.deepEqual(anunciosPorCategoria(anuncios, 'leads').map((a) => a.adId), ['a2']);
});
```

- [ ] **Passo 2: Rodar e confirmar que falha**

```bash
node --test src/ferramentas/meta-ads/relatorio-por-hora.test.mjs
```

- [ ] **Passo 3: Implementar**

Adicionar em `relatorio-por-hora.js`, depois de `classificarLinkAnuncio`:

```js
// Mesmo espírito de agruparPorDiaEHora, mas pra ANÚNCIO (ad_id), não
// campanha — função IRMÃ, não uma extensão da existente (evita
// `if (ehAnuncio)` espalhado numa função que já está grande). Pedido do
// dono (18/09/2026): Sales/Leads por link precisa de granularidade de
// anúncio, confirmado que campanha/conjunto misturam destinos diferentes.
export function agruparAnunciosPorDiaEHora(linhas, nomesPorAnuncio = {}, linksPorAnuncio = {}) {
  const porDia = new Map();
  for (const l of linhas) {
    if (!porDia.has(l.dia)) porDia.set(l.dia, new Map());
    const porHora = porDia.get(l.dia);
    if (!porHora.has(l.hora)) porHora.set(l.hora, []);
    const gastoHora = Number(l.gasto_hora) || 0;
    const cliquesHora = Number(l.cliques_hora) || 0;
    const nome = nomesPorAnuncio[l.ad_id] || l.ad_id;
    const destinoLink = linksPorAnuncio[l.ad_id] ?? null;
    porHora.get(l.hora).push({
      adId: l.ad_id,
      campaignId: l.campaign_id,
      nome,
      destinoLink,
      gastoHora,
      cliquesHora,
      custoPorClique: custoPorLead(gastoHora, cliquesHora),
    });
  }

  return [...porDia.keys()].sort().reverse().map((dia) => {
    const porHora = porDia.get(dia);
    const horas = [...porHora.keys()].sort((a, b) => a - b).map((hora) => {
      const anuncios = [...porHora.get(hora)].sort((a, b) => b.gastoHora - a.gastoHora);
      return {
        hora,
        gastoTotal: anuncios.reduce((s, a) => s + a.gastoHora, 0),
        cliquesTotal: anuncios.reduce((s, a) => s + a.cliquesHora, 0),
        anuncios,
      };
    });
    return {
      dia,
      gastoTotal: horas.reduce((s, h) => s + h.gastoTotal, 0),
      horas,
    };
  });
}

// Recorte por categoria (sales/leads) dentro de uma lista de anúncios já
// agrupada — mesma ideia de comResultado/deSeguidores, um nível abaixo.
export function anunciosPorCategoria(anuncios, categoria) {
  return anuncios.filter((a) => classificarLinkAnuncio(a.destinoLink) === categoria);
}
```

- [ ] **Passo 4: Rodar e confirmar que passa**

```bash
node --test src/ferramentas/meta-ads/relatorio-por-hora.test.mjs
```

- [ ] **Passo 5: Commit**

```bash
git add src/ferramentas/meta-ads/relatorio-por-hora.js src/ferramentas/meta-ads/relatorio-por-hora.test.mjs
git commit -m "feat(meta-ads): agruparAnunciosPorDiaEHora e anunciosPorCategoria"
```

---

## Task 7: Tela — seções "Sales" e "Leads (Link)" no Relatório por Hora

**Files:**
- Modify: `src/ferramentas/meta-ads/tela-de-relatorio-por-hora.vue`

**Interfaces:**
- Consumes: `agruparAnunciosPorDiaEHora`, `anunciosPorCategoria` (Task 6),
  tabelas `public.ads`/`public.ad_insights_hora` (Task 1) via `sb()`.

Sem teste automatizado aqui — é montagem de template Vue, verificado por
navegador real (Passo 3), igual às demais telas do módulo.

- [ ] **Passo 1: Buscar os dados novos em `carregar()`**

Em `src/ferramentas/meta-ads/tela-de-relatorio-por-hora.vue`, no
`<script setup>`:

Import (adicionar ao que já existe, linha ~117):
```js
import {
  agruparPorDiaEHora, comResultado, montarMensagemWpp, leadsWppNoDia, gastoWppNoDia, montarMensagemSeguidores, formatarReais,
  deltaDeSeguidoresPorHora, seguidoresNaHora, seguidoresTotalNaHora, seguidoresNoDia, visitasPerfilNaHora,
  gastoSeguidoresNoDia, visitasPerfilNoDia, agruparAnunciosPorDiaEHora, anunciosPorCategoria,
} from './relatorio-por-hora.js'
```

Novo estado (perto de `const visitasPerfil = ref([])`, linha ~140):
```js
const diasAnuncios = ref([])
```

Em `carregar()`, adicionar ao `Promise.all` (linha ~272):
```js
  const [linhas, campanhas, leiturasSeguidores, visitas, anuncios, linhasAnuncios] = await Promise.all([
    sb(`campaign_insights_hora?select=dia,hora,campaign_id,gasto_hora,gasto_acumulado,conversas_hora&dia=gte.${desdeISO}&account_id=eq.${CONTA_VESSEL}&order=dia.desc,hora.asc`),
    sb('campaigns?select=campaign_id,name'),
    sb(`followers_leituras?select=followers_count,lido_em,origem&account_id=eq.${CONTA_VESSEL}&lido_em=gte.${desde.toISOString()}&order=lido_em.asc`),
    sb(`perfil_visitas_hora?select=dia,hora,visitas_hora&dia=gte.${desdeISO}&account_id=eq.${CONTA_VESSEL}&order=dia.desc,hora.asc`),
    sb(`ads?select=ad_id,name,destino_link&account_id=eq.${CONTA_VESSEL}`),
    sb(`ad_insights_hora?select=dia,hora,ad_id,campaign_id,gasto_hora,cliques_hora&dia=gte.${desdeISO}&account_id=eq.${CONTA_VESSEL}&order=dia.desc,hora.asc`),
  ])
```

Tratamento de erro (junto dos já existentes, logo abaixo):
```js
  if (anuncios.erro) { erro.value = anuncios.erro; carregando.value = false; return }
  if (linhasAnuncios.erro) { erro.value = linhasAnuncios.erro; carregando.value = false; return }
```

Montagem (junto de `dias.value = agruparPorDiaEHora(...)`, linha ~285):
```js
  const nomesPorAnuncio = Object.fromEntries(anuncios.map((a) => [a.ad_id, a.name]))
  const linksPorAnuncio = Object.fromEntries(anuncios.map((a) => [a.ad_id, a.destino_link]))
  diasAnuncios.value = agruparAnunciosPorDiaEHora(linhasAnuncios, nomesPorAnuncio, linksPorAnuncio)
```

- [ ] **Passo 2: Achar os anúncios da hora certa e desenhar os dois blocos novos**

Função auxiliar (perto de `gastoSeguidores(h)`, linha ~172):
```js
// Acha os anúncios (Sales/Leads-por-link) da mesma dia/hora que a hora de
// campanha `h` já está mostrando — diasAnuncios é uma árvore PARALELA a
// `dias` (chave própria, granularidade de anúncio), não plugada dentro de
// `h` porque agruparAnunciosPorDiaEHora é uma função IRMÃ de
// agruparPorDiaEHora, não uma extensão.
function anunciosDaHora(dia, hora) {
  const d = diasAnuncios.value.find((x) => x.dia === dia)
  const h = d?.horas.find((x) => x.hora === hora)
  return h?.anuncios ?? []
}
```

Template — dois blocos novos, logo depois do bloco "Seguidores" (depois da
linha 78, antes do bloco "Mensagens do grupo"):

```html
              <div v-if="anunciosPorCategoria(anunciosDaHora(d.dia, h.hora), 'sales').length" class="rph-bloco">
                <span class="section-label">Sales</span>
                <table class="rph-tabela">
                  <thead><tr><th>Anúncio</th><th>Investido</th><th>Cliques</th><th>Custo/clique</th></tr></thead>
                  <tbody>
                    <tr v-for="a in anunciosPorCategoria(anunciosDaHora(d.dia, h.hora), 'sales')" :key="a.adId">
                      <td class="rph-campanha">{{ a.nome }}</td>
                      <td class="rph-num">{{ formatarReais(a.gastoHora) }}</td>
                      <td class="rph-num">{{ a.cliquesHora }}</td>
                      <td class="rph-num">{{ a.custoPorClique === null ? '—' : formatarReais(a.custoPorClique) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div v-if="anunciosPorCategoria(anunciosDaHora(d.dia, h.hora), 'leads').length" class="rph-bloco">
                <span class="section-label">Leads (Link)</span>
                <table class="rph-tabela">
                  <thead><tr><th>Anúncio</th><th>Investido</th><th>Cliques</th><th>Custo/clique</th></tr></thead>
                  <tbody>
                    <tr v-for="a in anunciosPorCategoria(anunciosDaHora(d.dia, h.hora), 'leads')" :key="a.adId">
                      <td class="rph-campanha">{{ a.nome }}</td>
                      <td class="rph-num">{{ formatarReais(a.gastoHora) }}</td>
                      <td class="rph-num">{{ a.cliquesHora }}</td>
                      <td class="rph-num">{{ a.custoPorClique === null ? '—' : formatarReais(a.custoPorClique) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
```

Nenhuma classe CSS nova precisa — `.rph-bloco`/`.rph-tabela`/`.rph-num`/
`.rph-campanha`/`section-label` já existem e cobrem tudo.

- [ ] **Passo 3: Rodar suíte, build e verificar em navegador real (375px)**

```bash
npm test
npm run build
```

Seguir o padrão já usado nesta sessão pra inspecionar telas sem
credencial própria (ver memória `inspecionar-telas-sem-credencial` — sessão
sintética + profile interceptado, ou o padrão de concessão temporária de
`meta.hora` já usado antes: conceder → Playwright real → reverter). Abrir
uma hora com anúncio "outro" com link classificado, confirmar que "Sales"
e/ou "Leads (Link)" aparecem só quando há anúncio da categoria, texto não
corta em 375px, tema claro/escuro ambos legíveis.

- [ ] **Passo 4: Commit**

```bash
git add src/ferramentas/meta-ads/tela-de-relatorio-por-hora.vue
git commit -m "feat(meta-ads): seções Sales e Leads (Link) no Relatório por Hora"
```

---

## Task 8: OPR — `salesLink`/`leadsLink` no cálculo diário

**Files:**
- Modify: `src/ferramentas/meta-ads/relatorio-diario-opr.js`
- Test: `src/ferramentas/meta-ads/relatorio-diario-opr.test.mjs`

**Interfaces:**
- Consumes: `classificarLinkAnuncio` (Task 2), `custoPorLead` (já
  importado neste arquivo).
- Produces: `agruparAnunciosDoDia(linhas, linksPorAnuncio): [{adId, gasto,
  cliques, categoria}]`; `calcularDadosOpr`/`montarDadosOpr` ganham um 4º
  parâmetro opcional `anunciosDoDia = []` e o retorno ganha `salesLink`/
  `leadsLink` (cada um `{investimento, cliques, custoPorClique}`).

**Global Constraint desta tarefa**: NÃO tocar em `sales.leads`/
`sales.vendas`/`sales.leadsQuentes` — esses campos já existem e estão
documentados no código como reservados pro Chatwoot (comentário em
`relatorio-diario-opr.js`, linha ~168). `salesLink`/`leadsLink` são objetos
NOVOS, sem relação com `sales`.

- [ ] **Passo 1: Escrever os testes (falhando)**

Adicionar ao fim de `relatorio-diario-opr.test.mjs` (ajustar import do
topo pra incluir `agruparAnunciosDoDia`):

```js
test('agruparAnunciosDoDia: soma gasto/clique por anúncio ao longo das horas do dia, classifica pelo link', () => {
  const linhas = [
    { ad_id: 'a1', gasto_hora: 10, cliques_hora: 2 },
    { ad_id: 'a1', gasto_hora: 5, cliques_hora: 1 }, // segunda hora do mesmo anúncio
    { ad_id: 'a2', gasto_hora: 8, cliques_hora: 3 },
  ];
  const links = { a1: 'https://vesselbrasil.com.br/', a2: 'https://vesselbrasil.com.br/universovessel#narrativa' };
  const out = agruparAnunciosDoDia(linhas, links);
  assert.equal(out.length, 2);
  const a1 = out.find((a) => a.adId === 'a1');
  assert.equal(a1.gasto, 15);
  assert.equal(a1.cliques, 3);
  assert.equal(a1.categoria, 'sales');
  assert.equal(out.find((a) => a.adId === 'a2').categoria, 'leads');
});

test('agruparAnunciosDoDia: sem link classificável vira categoria null, campo ausente vira 0', () => {
  const out = agruparAnunciosDoDia([{ ad_id: 'a9' }], {});
  assert.equal(out[0].categoria, null);
  assert.equal(out[0].gasto, 0);
  assert.equal(out[0].cliques, 0);
});

test('calcularDadosOpr: salesLink/leadsLink somam certo, sem misturar com sales.leads (wpp)', () => {
  const campanhas = agruparCampanhasDoDia(
    [{ campaign_id: 'c1', spend: 100, conversas: 5 }],
    { c1: '[CAMPANHA WPP] X' },
  );
  const anunciosDoDia = [
    { adId: 'a1', gasto: 50, cliques: 10, categoria: 'sales' },
    { adId: 'a2', gasto: 20, cliques: 4, categoria: 'leads' },
    { adId: 'a3', gasto: 999, cliques: 999, categoria: null },
  ];
  const dados = calcularDadosOpr(campanhas, 0, 0, anunciosDoDia);
  assert.equal(dados.salesLink.investimento, 50);
  assert.equal(dados.salesLink.cliques, 10);
  assert.equal(dados.salesLink.custoPorClique, 5);
  assert.equal(dados.leadsLink.investimento, 20);
  assert.equal(dados.leadsLink.cliques, 4);
  assert.equal(dados.leadsLink.custoPorClique, 5);
  assert.equal(dados.sales.leads, 5, 'sales.leads continua sendo só WPP, não mistura com leadsLink');
});

test('calcularDadosOpr: sem anúncio nenhum, salesLink/leadsLink saem zerados com custo null (nunca undefined)', () => {
  const dados = calcularDadosOpr([], null, 0);
  assert.deepEqual(dados.salesLink, { investimento: 0, cliques: 0, custoPorClique: null });
  assert.deepEqual(dados.leadsLink, { investimento: 0, cliques: 0, custoPorClique: null });
});

test('montarDadosOpr: salesLink/leadsLink ficam null (rollout não confirmado ainda) mesmo com número calculado certo', () => {
  const anunciosDoDia = [{ adId: 'a1', gasto: 50, cliques: 10, categoria: 'sales' }];
  const dados = montarDadosOpr([], null, 0, anunciosDoDia);
  assert.deepEqual(dados.salesLink, { investimento: null, cliques: null, custoPorClique: null });
});
```

- [ ] **Passo 2: Rodar e confirmar que falha**

```bash
node --test src/ferramentas/meta-ads/relatorio-diario-opr.test.mjs
```

- [ ] **Passo 3: Implementar**

Import no topo de `relatorio-diario-opr.js` (linha 7):
```js
import { tipoDaCampanha, custoPorLead, classificarLinkAnuncio } from './relatorio-por-hora.js';
```

Nova função, depois de `agruparCampanhasDoDia`:
```js
// Soma gasto/clique de um anúncio ao longo de TODAS as horas do dia
// (linhas = ad_insights_hora do dia inteiro, uma por hora) e classifica
// pelo link — pedido do dono (18/09/2026). Mesmo espírito de
// agruparCampanhasDoDia, um nível abaixo (anúncio, não campanha).
export function agruparAnunciosDoDia(linhas, linksPorAnuncio = {}) {
  const porAnuncio = new Map();
  for (const l of linhas) {
    const destinoLink = linksPorAnuncio[l.ad_id] ?? null;
    const atual = porAnuncio.get(l.ad_id) ?? {
      adId: l.ad_id, gasto: 0, cliques: 0, categoria: classificarLinkAnuncio(destinoLink),
    };
    atual.gasto += Number(l.gasto_hora) || 0;
    atual.cliques += Number(l.cliques_hora) || 0;
    porAnuncio.set(l.ad_id, atual);
  }
  return [...porAnuncio.values()];
}
```

`calcularDadosOpr` ganha o 4º parâmetro (assinatura na linha 126) — trocar
a linha da assinatura e adicionar o bloco antes do `return`:
```js
export function calcularDadosOpr(campanhasDoDia, seguidoresDoDia, visitasPerfilDoDia, anunciosDoDia = []) {
```
… (corpo existente sem mudança até o fim) …
```js
  // Sales/Leads por LINK do anúncio (18/09/2026) — eixo totalmente
  // separado de `sales` acima: `sales.leads` é conversa WPP, isto aqui é
  // anúncio "outro" classificado pelo destino do link. NUNCA somar os
  // dois juntos (pedido do dono: "campanhas wpp desconsidera").
  const salesAnuncios = anunciosDoDia.filter((a) => a.categoria === 'sales');
  const leadsLinkAnuncios = anunciosDoDia.filter((a) => a.categoria === 'leads');
  const investimentoSalesLink = somar(salesAnuncios, 'gasto');
  const cliquesSalesLink = somar(salesAnuncios, 'cliques');
  const investimentoLeadsLink = somar(leadsLinkAnuncios, 'gasto');
  const cliquesLeadsLink = somar(leadsLinkAnuncios, 'cliques');

  const salesLink = {
    investimento: investimentoSalesLink,
    cliques: cliquesSalesLink,
    custoPorClique: investimentoSalesLink > 0 && cliquesSalesLink > 0
      ? custoPorLead(investimentoSalesLink, cliquesSalesLink) : null,
  };
  const leadsLink = {
    investimento: investimentoLeadsLink,
    cliques: cliquesLeadsLink,
    custoPorClique: investimentoLeadsLink > 0 && cliquesLeadsLink > 0
      ? custoPorLead(investimentoLeadsLink, cliquesLeadsLink) : null,
  };

  return { header, growth, engagement, sales, salesLink, leadsLink, mix };
}
```
(Isto SUBSTITUI o `return { header, growth, engagement, sales, mix };`
existente — conferir que não sobra um `return` duplicado.)

`montarDadosOpr` (linha ~210) — trocar assinatura e o objeto de retorno:
```js
export function montarDadosOpr(campanhasDoDia, seguidoresDoDia, visitasPerfilDoDia, anunciosDoDia = []) {
  const dados = calcularDadosOpr(campanhasDoDia, seguidoresDoDia, visitasPerfilDoDia, anunciosDoDia);
  return {
    header: aplicarRollout('header', dados.header),
    growth: aplicarRollout('growth', dados.growth),
    engagement: aplicarRollout('engagement', dados.engagement),
    sales: aplicarRollout('sales', dados.sales),
    salesLink: aplicarRollout('salesLink', dados.salesLink),
    leadsLink: aplicarRollout('leadsLink', dados.leadsLink),
    mix: aplicarRollout('mix', dados.mix),
  };
}
```

NÃO adicionar `salesLink.*`/`leadsLink.*` em `CAMPOS_CONFIRMADOS` — ficam
gated (`null`) até alguém bater o número contra a Meta com dado real,
mesma disciplina do resto do arquivo (ver comentário acima de
`CAMPOS_CONFIRMADOS`, linha ~38).

- [ ] **Passo 4: Rodar e confirmar que passa**

```bash
node --test src/ferramentas/meta-ads/relatorio-diario-opr.test.mjs
```

- [ ] **Passo 5: Commit**

```bash
git add src/ferramentas/meta-ads/relatorio-diario-opr.js src/ferramentas/meta-ads/relatorio-diario-opr.test.mjs
git commit -m "feat(meta-ads): OPR calcula salesLink/leadsLink (gated, sem confirmar ainda)"
```

---

## Task 9: `gerar-opr-diario.mjs` busca e passa os anúncios do dia

**Files:**
- Modify: `coletor/gerar-opr-diario.mjs`

**Interfaces:**
- Consumes: `agruparAnunciosDoDia` (Task 8), `montarDadosOpr` (assinatura
  estendida na Task 8), tabelas `public.ads`/`public.ad_insights_hora`
  (Task 1).

Sem teste automatizado — mesmo motivo das outras tarefas de I/O deste
plano (a lógica pura já está coberta pelos testes de `agruparAnunciosDoDia`
na Task 8). Verificação real no Passo 3 (`--dry`).

- [ ] **Passo 1: Import**

No topo de `coletor/gerar-opr-diario.mjs` (linha 18):
```js
import { agruparCampanhasDoDia, agruparAnunciosDoDia, montarDadosOpr } from '../src/ferramentas/meta-ads/relatorio-diario-opr.js';
```

- [ ] **Passo 2: Buscar `ads`/`ad_insights_hora` do dia e passar pro cálculo**

No `Promise.all` de `main()` (linha ~110), adicionar duas buscas:
```js
    const [campanhas, insights, leituras, contas, ads, adInsights] = await Promise.all([
      sbGet('/campaigns?select=campaign_id,name'),
      sbGet(`/campaign_insights?select=campaign_id,spend,likes,comments,shares,saves,conversas,post_engagement&account_id=eq.${CONTA_VESSEL}&captured_at=eq.${dia}&period_days=eq.0`),
      sbGet(`/followers_leituras?select=followers_count,lido_em,origem&account_id=eq.${CONTA_VESSEL}&lido_em=gte.${new Date(Date.now() - 48 * 3600 * 1000).toISOString()}&order=lido_em.asc`),
      sbGet(`/accounts?select=instagram_id,access_token&id=eq.${CONTA_VESSEL}`),
      sbGet(`/ads?select=ad_id,destino_link&account_id=eq.${CONTA_VESSEL}`),
      sbGet(`/ad_insights_hora?select=ad_id,gasto_hora,cliques_hora&account_id=eq.${CONTA_VESSEL}&dia=eq.${dia}`),
    ]);
```

Logo depois de `const campanhasDoDia = agruparCampanhasDoDia(...)`:
```js
    const linksPorAnuncio = Object.fromEntries(ads.map((a) => [a.ad_id, a.destino_link]));
    const anunciosDoDia = agruparAnunciosDoDia(adInsights, linksPorAnuncio);
```

Trocar a chamada de `montarDadosOpr` (linha ~135) pra passar o novo
parâmetro:
```js
    dados = montarDadosOpr(campanhasDoDia, seguidoresDoDia, visitasPerfilDoDia, anunciosDoDia);
```

- [ ] **Passo 3: Rodar em modo `--dry` e conferir**

```bash
node coletor/gerar-opr-diario.mjs --dry
```

Esperado: roda sem erro (mesmo sem nenhum dado de `ad_insights_hora`
ainda, `anunciosDoDia` vem `[]`, `salesLink`/`leadsLink` saem `null` no
JSON impresso — comportamento correto do gate, não é bug). Confirmar no
JSON impresso que `salesLink`/`leadsLink` aparecem como chaves (mesmo que
`null`), sem `undefined` nem erro de execução.

- [ ] **Passo 4: Commit**

```bash
git add coletor/gerar-opr-diario.mjs
git commit -m "feat(meta-ads): gerar-opr-diario busca anúncios do dia e alimenta salesLink/leadsLink"
```

---

## Depois de todas as tarefas

- Rodar a suíte inteira (`npm test`) e o build (`npm run build`) uma
  última vez.
- Confirmar que `sales.leads`/`sales.vendas`/`sales.leadsQuentes` (OPR)
  continuam com o mesmo comportamento de antes (nenhum teste existente
  quebrou — checar especificamente
  `relatorio-diario-opr.test.mjs`).
- Deploy das duas Edge Functions (Tasks 4 e 5) segue a regra do
  `CLAUDE.md` — comparar com o que está no ar, nunca publicar de branch
  atrasada.
- Confirmar com o dono, depois de alguns dias de dado real acumulado, se
  os números de `salesLink`/`leadsLink` batem com a Graph API — só então
  eles entram em `CAMPOS_CONFIRMADOS` (mesmo processo documentado no
  histórico de `relatorio-diario-opr.js` pros outros campos).
