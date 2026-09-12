# Config de Usuários — Fase 2: perfis de acesso vivos

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar acesso a alguém novo copiando quem já está certo, e deixar que mexer num perfil mude todo mundo que está nele — sem que ninguém ganhe acesso sem alguém ver quem foi afetado.

**Architecture:** `profiles.permissions` **continua sendo a verdade efetiva** — nada no resto do app muda de jeito de perguntar. O perfil é uma camada acima: `acessos_perfis` guarda o mapa do perfil, `profiles.perfil_id` diz a quem ele pertence, e `profiles.permissions_excecao` registra o que foi dado à mão. Ao mudar o perfil, recalcula-se `permissions` de cada membro = perfil sobreposto pela exceção. Toda regra de sobreposição mora em `.js` puro com teste ao lado.

**Tech Stack:** Vue 3 + Vite, `node --test`, Supabase/Postgres (migration nova + RLS).

## Global Constraints

- **`profiles.permissions` segue mandando.** `hasPermission` não muda, `RECURSOS` não muda, `PERMISSION_TREE` não muda. Se alguma tela passar a perguntar acesso de outro jeito, o desenho foi violado.
- **Ninguém muda de acesso pela entrega deste plano.** A migration cria estrutura vazia; nenhuma pessoa nasce em perfil nenhum. Qualquer mudança de acesso tem que vir de um clique do dono, com D11 na frente.
- **D10 — ferramenta nova NUNCA entra num perfil sozinha.** O perfil guarda um mapa explícito de chaves. Subir recurso novo em `RECURSOS` não pode alterar perfil nenhum.
- **D11 — toda mudança de perfil mostra quem será afetado, antes de gravar.** Não é opcional: se cair por prazo, **D8 cai junto** (voltar ao perfil-foto, sem propagação).
- **D9 — exceção dada à mão sobrevive** à mudança do perfil.
- Português literal, sem jargão. Comentário explica **por quê**.
- `PADRAO-DA-CENTRAL.md` é obrigatório antes de qualquer CSS. `:deep()` escopado em `.tela-admin`.
- `--aviso` NÃO existe; o token de aviso é `--orange`.
- Nome usado sem importar não quebra o build — o guarda é `src/ferramentas/admin/imports.test.mjs`. `node --test` não compila `.vue`; `npm run build` compila.
- Porta fixa: `npm run dev -- --port 5199 --strictPort`.
- Estado inicial: **2458 testes passando**, build limpo, main em `d80ee1b`.

---

### Task 1: A tabela dos perfis

**Files:**
- Create: `db/migrations/acessos/039_perfis_de_acesso.sql`
- Test: `src/ferramentas/admin/perfis-de-acesso.test.mjs` (criado na Task 2; aqui só a migration)

**Interfaces:**
- Produces: tabela `acessos_perfis(id uuid, nome text, permissions jsonb, criado_em, criado_por)`; colunas `profiles.perfil_id uuid` e `profiles.permissions_excecao jsonb`.

- [ ] **Step 1: Escrever a migration**

```sql
-- PERFIS DE ACESSO (D7-D11 do desenho 2026-08-11).
--
-- POR QUE ISTO EXISTE: 15 pessoas em 12 formatos de acesso distintos, e o dono
-- classificou isso como "foi acontecendo, deveria ter padrão". Dar acesso a
-- alguém novo era marcar item por item.
--
-- POR QUE O PERFIL NÃO SUBSTITUI `profiles.permissions`: essa coluna é
-- consultada por `hasPermission` em toda tela e por RLS no banco. Trocar a fonte
-- da verdade por uma junção tornaria cada checagem de acesso um risco novo. Aqui
-- o perfil é uma CAMADA: ele diz o que gravar em `permissions`, e quem lê
-- continua lendo o mesmo lugar de sempre.
--
-- `permissions_excecao` é o que D9 exige: o que foi dado à mão àquela pessoa,
-- fora do perfil. Ao recalcular, o perfil manda no que ele cobre e a exceção
-- sobrevive por cima. Sem essa coluna não dá para distinguir "veio do perfil" de
-- "alguém deu de propósito", e a primeira mudança de perfil apagaria trabalho.

begin;

create table if not exists public.acessos_perfis (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null unique,
  -- O MESMO formato de `profiles.permissions`: { "chave": ["ver","editar"] }.
  -- Formato diferente entre os dois exigiria conversão em toda leitura, e
  -- conversão é onde acesso se perde em silêncio.
  permissions jsonb not null default '{}'::jsonb,
  criado_em   timestamptz not null default now(),
  criado_por  uuid references auth.users(id)
);

alter table public.profiles
  add column if not exists perfil_id uuid references public.acessos_perfis(id) on delete set null;

-- `on delete set null`: apagar um perfil NÃO pode apagar o acesso de ninguém.
-- Quem estava nele fica com as permissões que já tinha, só deixa de ser
-- propagado. Cascade aqui zeraria gente sem ninguém pedir.

alter table public.profiles
  add column if not exists permissions_excecao jsonb not null default '{}'::jsonb;

alter table public.acessos_perfis enable row level security;

do $$ begin
  -- LER: quem administra usuários precisa ver os perfis pra escolher um.
  if not exists (select 1 from pg_policies
                  where tablename = 'acessos_perfis' and policyname = 'acessos_perfis_ler') then
    create policy acessos_perfis_ler on public.acessos_perfis
      for select to authenticated using (true);
  end if;
  -- ESCREVER: só superadmin. Perfil é uma alavanca que muda várias pessoas de
  -- uma vez — é o mesmo motivo de `guard_user_permissions` existir.
  if not exists (select 1 from pg_policies
                  where tablename = 'acessos_perfis' and policyname = 'acessos_perfis_escrever') then
    create policy acessos_perfis_escrever on public.acessos_perfis
      for all to authenticated
      using (public.is_superadmin()) with check (public.is_superadmin());
  end if;
end $$;

commit;
```

- [ ] **Step 2: Conferir que `is_superadmin()` existe com esse nome**

Run (MCP Supabase, projeto `kounqtdoioootxqegkij`):
```sql
select proname from pg_proc where proname = 'is_superadmin';
```
Expected: uma linha. Se não existir, **pare e reporte** — a policy de escrita ficaria sem guarda, e é o oposto do que este plano promete.

- [ ] **Step 3: Aplicar**

Aplique via MCP `apply_migration` no projeto `kounqtdoioootxqegkij`. **Não** use `node coletor/run-migrations.mjs`: neste repositório ele acusa dezenas de pendentes porque migrations antigas foram aplicadas direto no banco e nunca entraram em `schema_migrations`.

- [ ] **Step 4: Provar que nada mudou de acesso**

```sql
select count(*) as pessoas,
       count(*) filter (where perfil_id is not null)              as em_perfil,
       count(*) filter (where permissions_excecao <> '{}'::jsonb) as com_excecao
from profiles;
```
Expected: `em_perfil = 0` e `com_excecao = 0`. Qualquer outro número significa que a migration mexeu em dado — **pare**.

- [ ] **Step 5: Commit**

```bash
git add db/migrations/acessos/039_perfis_de_acesso.sql
git commit -m "Tabela de perfis de acesso, sem mexer em quem tem o que"
```

---

### Task 2: A regra de sobreposição

O coração do D9. Módulo puro: dado o mapa do perfil e a exceção da pessoa, qual é o acesso efetivo.

**Files:**
- Create: `src/ferramentas/admin/perfis-de-acesso.js`
- Test: `src/ferramentas/admin/perfis-de-acesso.test.mjs`

**Interfaces:**
- Produces:
  - `acessoEfetivo(perfilPermissions, excecao) -> object` — o que gravar em `profiles.permissions`.
  - `excecaoDe(perfilPermissions, permissionsAtuais) -> object` — o que, no acesso de hoje, NÃO veio do perfil.

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { acessoEfetivo, excecaoDe } from './perfis-de-acesso.js'

const PERFIL = { social: ['ver', 'exportar'], 'meta.gestor': ['ver', 'editar'] }

test('sem excecao, o acesso e o do perfil', () => {
  assert.deepEqual(acessoEfetivo(PERFIL, {}), PERFIL)
})

test('a excecao SOBREVIVE — e o D9', () => {
  // A Raissa esta no perfil "Anuncios" e ganhou a Frota so pra ela. Mexer no
  // perfil nao pode apagar a Frota dela.
  const efetivo = acessoEfetivo(PERFIL, { frota: ['ver', 'editar'] })
  assert.deepEqual(efetivo.frota, ['ver', 'editar'])
  assert.deepEqual(efetivo.social, ['ver', 'exportar'])
})

test('excecao na MESMA chave do perfil ganha do perfil', () => {
  // Alguem deu explicitamente um nivel diferente naquela ferramenta: e uma
  // decisao sobre aquela pessoa, e o perfil nao pode desfaze-la calado.
  const efetivo = acessoEfetivo(PERFIL, { 'meta.gestor': ['ver'] })
  assert.deepEqual(efetivo['meta.gestor'], ['ver'])
})

test('chave que saiu do perfil some de quem nao a tinha por excecao', () => {
  // O perfil encolheu: quem estava nele perde o que o perfil deixou de dar.
  // E o proposito do perfil vivo (D8) — e por isso D11 mostra quem perde.
  const menor = { social: ['ver', 'exportar'] }
  assert.equal(acessoEfetivo(menor, {})['meta.gestor'], undefined)
})

test('excecao vazia nao inventa chave', () => {
  const efetivo = acessoEfetivo(PERFIL, { frota: [] })
  assert.equal(efetivo.frota, undefined, 'lista vazia e "sem acesso", nao uma chave concedida')
})

test('nao estoura com nulo', () => {
  assert.deepEqual(acessoEfetivo(null, null), {})
  assert.deepEqual(acessoEfetivo(PERFIL, null), PERFIL)
})

// --- descobrir a excecao a partir do que a pessoa ja tem ---

test('o que a pessoa tem alem do perfil vira excecao', () => {
  const atual = { ...PERFIL, frota: ['ver', 'editar'] }
  assert.deepEqual(excecaoDe(PERFIL, atual), { frota: ['ver', 'editar'] })
})

test('nivel diferente na mesma chave tambem e excecao', () => {
  const atual = { ...PERFIL, 'meta.gestor': ['ver'] }
  assert.deepEqual(excecaoDe(PERFIL, atual), { 'meta.gestor': ['ver'] })
})

test('quem e identico ao perfil nao tem excecao nenhuma', () => {
  assert.deepEqual(excecaoDe(PERFIL, { ...PERFIL }), {})
})

test('ordem das acoes nao inventa excecao', () => {
  // ['editar','ver'] e ['ver','editar'] sao o MESMO acesso. Comparar sem
  // ordenar criaria excecao fantasma pra metade das pessoas.
  const atual = { social: ['exportar', 'ver'], 'meta.gestor': ['editar', 'ver'] }
  assert.deepEqual(excecaoDe(PERFIL, atual), {})
})

test('ida e volta: aplicar a excecao de volta devolve o acesso original', () => {
  const atual = { ...PERFIL, frota: ['ver', 'editar'], 'meta.gestor': ['ver'] }
  const exc = excecaoDe(PERFIL, atual)
  assert.deepEqual(acessoEfetivo(PERFIL, exc), atual)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/ferramentas/admin/perfis-de-acesso.test.mjs`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Write minimal implementation**

```js
// src/ferramentas/admin/perfis-de-acesso.js
//
// A SOBREPOSIÇÃO PERFIL × EXCEÇÃO (D9 do desenho de 11/08/2026).
//
// O perfil manda no que ELE cobre; o que foi dado à mão àquela pessoa fica por
// cima e sobrevive. Perfil que apaga o que alguém concedeu de propósito faz o
// dono perder trabalho sem aviso — foi a primeira coisa que ele decidiu quando
// escolheu o perfil vivo.
//
// PURO: sem rede, sem DOM. Quem chama busca perfil e pessoa e passa para cá.

// Duas listas de ação são o mesmo acesso mesmo em ordem diferente. Comparar sem
// ordenar criaria exceção fantasma para metade das pessoas, e cada exceção
// fantasma é uma ferramenta que o perfil deixa de governar.
const mesmasAcoes = (a, b) => {
  const x = [...(a || [])].sort()
  const y = [...(b || [])].sort()
  return x.length === y.length && x.every((v, i) => v === y[i])
}

// Lista vazia é "sem acesso", não uma chave concedida. Guardá-la faria a pessoa
// aparecer com uma ferramenta a mais na contagem, sem poder nenhum.
const temAcesso = (acoes) => Array.isArray(acoes) && acoes.length > 0

/** O que gravar em `profiles.permissions` para quem está neste perfil. */
export function acessoEfetivo(perfilPermissions, excecao) {
  const out = {}
  for (const [k, v] of Object.entries(perfilPermissions || {})) {
    if (temAcesso(v)) out[k] = [...v]
  }
  for (const [k, v] of Object.entries(excecao || {})) {
    if (temAcesso(v)) out[k] = [...v]
    else delete out[k]
  }
  return out
}

/**
 * O que, no acesso de hoje desta pessoa, NÃO veio do perfil.
 * Usado ao pôr alguém num perfil: o que ela já tinha e o perfil não dá vira
 * exceção, em vez de ser perdido em silêncio.
 */
export function excecaoDe(perfilPermissions, permissionsAtuais) {
  const perfil = perfilPermissions || {}
  const out = {}
  for (const [k, v] of Object.entries(permissionsAtuais || {})) {
    if (!temAcesso(v)) continue
    if (!mesmasAcoes(perfil[k], v)) out[k] = [...v]
  }
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/ferramentas/admin/perfis-de-acesso.test.mjs`
Expected: PASS (11 testes)

- [ ] **Step 5: Commit**

```bash
git add src/ferramentas/admin/perfis-de-acesso.js src/ferramentas/admin/perfis-de-acesso.test.mjs
git commit -m "A regra de sobreposicao: o perfil manda, a excecao sobrevive"
```

---

### Task 3: Quem será afetado, e o que muda para cada um

O D11 — o que torna o perfil vivo seguro. Sem isto, D8 não vai ao ar.

**Files:**
- Modify: `src/ferramentas/admin/perfis-de-acesso.js`
- Modify: `src/ferramentas/admin/perfis-de-acesso.test.mjs`

**Interfaces:**
- Consumes: `acessoEfetivo` (Task 2).
- Produces: `impactoDaMudanca(perfilNovo, membros) -> {afetados: [{nome, ganha: [chave], perde: [chave], muda: [{chave, de: [acoes], para: [acoes]}]}], total}` — `membros` é `[{nome, permissions, permissions_excecao}]`.

> **Três listas, não duas — corrigido em 11/08/2026 durante a execução.** A versão
> original tinha só `ganha`/`perde`, e com ela **quem PERDIA ações aparecia como
> quem ganhou**: alguém que tinha `['ver','exportar','editar']` e passava a ter
> `['ver']` era descrito ao dono como *"Ana: ganha social"*. Isso é literalmente
> o texto que ele lê antes de aprovar. `muda` separa quem trocou de nível, com
> o de-para.
>
> **E outra correção da mesma rodada:** o fixture de teste original tinha
> `permissions: { social }` com `permissions_excecao: { frota }` — estado
> impossível, porque `permissions` é sempre perfil + exceção. Confiar nesse dado
> levou a implementação a pular do cálculo as chaves de exceção, o que **cegava o
> D11**: com dado divergente devolvia `total: 0`, e o Step 2 da Task 6 trata
> `total === 0` como "grava direto, sem confirmar". Concessão silenciosa, no
> ponto exato que o D11 existe pra impedir.
>
> A lição, que vale pra qualquer task deste projeto: **asserção é decisão do dono
> e se mantém verbatim; fixture é dado, e dado errado se conserta.**

- [ ] **Step 1: Write the failing test**

```js
import { impactoDaMudanca } from './perfis-de-acesso.js'

const MEMBROS = [
  { nome: 'Raissa', permissions: { social: ['ver'] }, permissions_excecao: { frota: ['ver', 'editar'] } },
  { nome: 'Gabriel', permissions: { social: ['ver'] }, permissions_excecao: {} },
]

test('diz quem GANHA o que foi acrescentado ao perfil', () => {
  const r = impactoDaMudanca({ social: ['ver'], patrimonio: ['ver', 'editar'] }, MEMBROS)
  assert.equal(r.total, 2)
  assert.deepEqual(r.afetados.map((a) => a.nome).sort(), ['Gabriel', 'Raissa'])
  assert.deepEqual(r.afetados.find((a) => a.nome === 'Raissa').ganha, ['patrimonio'])
})

test('diz quem PERDE o que saiu do perfil', () => {
  const r = impactoDaMudanca({}, MEMBROS)
  assert.deepEqual(r.afetados.find((a) => a.nome === 'Gabriel').perde, ['social'])
})

test('a excecao NAO aparece como perda — ela sobrevive', () => {
  // A Frota da Raissa e excecao. Esvaziar o perfil nao tira a Frota dela, entao
  // ela nao pode aparecer na lista de quem perde a Frota.
  const r = impactoDaMudanca({}, MEMBROS)
  const raissa = r.afetados.find((a) => a.nome === 'Raissa')
  assert.ok(!raissa.perde.includes('frota'))
})

test('quem nao muda nao entra na lista', () => {
  // Mostrar gente que nao muda faz a tela de confirmacao virar ruido, e quem
  // le ruido aprova sem ler.
  const r = impactoDaMudanca({ social: ['ver'] }, MEMBROS)
  assert.equal(r.total, 0)
  assert.deepEqual(r.afetados, [])
})

test('mudar o NIVEL conta como mudanca, nao so ganhar ou perder a chave', () => {
  const r = impactoDaMudanca({ social: ['ver', 'exportar'] }, MEMBROS)
  assert.equal(r.total, 2)
  assert.deepEqual(r.afetados[0].ganha, ['social'])
})

test('perfil sem membro nenhum da impacto zero', () => {
  assert.deepEqual(impactoDaMudanca({ social: ['ver'] }, []), { afetados: [], total: 0 })
})

test('nao estoura com nulo', () => {
  assert.deepEqual(impactoDaMudanca(null, null), { afetados: [], total: 0 })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/ferramentas/admin/perfis-de-acesso.test.mjs`
Expected: FAIL — `impactoDaMudanca` não existe.

- [ ] **Step 3: Write minimal implementation**

Acrescente ao fim de `perfis-de-acesso.js`:

```js
/**
 * Quem muda de acesso se este perfil virar `perfilNovo`, e o que muda para cada.
 *
 * D11: nada de perfil é gravado sem a tela nomear estas pessoas. É o passo que
 * mantém o dono como quem decide, em vez de descobrir depois — e a única
 * proteção que o perfil vivo tem contra dar acesso em massa em silêncio.
 *
 * Quem NÃO muda fica de fora de propósito: lista com gente que não muda vira
 * ruído, e quem lê ruído aprova sem ler.
 */
export function impactoDaMudanca(perfilNovo, membros) {
  const afetados = []
  for (const m of membros || []) {
    const antes = m.permissions || {}
    const depois = acessoEfetivo(perfilNovo, m.permissions_excecao)
    const chaves = new Set([...Object.keys(antes), ...Object.keys(depois)])
    const ganha = []
    const perde = []
    for (const k of chaves) {
      const a = antes[k]
      const d = depois[k]
      if (mesmasAcoes(a, d)) continue
      if (temAcesso(d)) ganha.push(k)
      else perde.push(k)
    }
    if (ganha.length || perde.length) {
      afetados.push({ nome: m.nome, ganha: ganha.sort(), perde: perde.sort() })
    }
  }
  return { afetados, total: afetados.length }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/ferramentas/admin/perfis-de-acesso.test.mjs`
Expected: PASS (18 testes)

- [ ] **Step 5: Provar o D10 — ferramenta nova não entra sozinha**

Acrescente este teste, que é a trava de uma promessa do desenho:

```js
test('ferramenta NOVA no catalogo nao entra em perfil nenhum (D10)', () => {
  // A regra do projeto e que ferramenta nova nasce sem acesso pra ninguem. Com
  // perfil vivo, o risco e ela entrar num perfil sozinha e alcancar 5 pessoas
  // sem ninguem abrir a ficha de ninguem.
  //
  // A garantia e estrutural: o perfil guarda um MAPA EXPLICITO de chaves, e
  // acessoEfetivo so devolve o que esta nele. Nada le RECURSOS aqui.
  const perfil = { social: ['ver'] }
  const efetivo = acessoEfetivo(perfil, {})
  assert.equal(efetivo['ferramenta.novissima'], undefined)
  assert.deepEqual(Object.keys(efetivo), ['social'])
})
```

Run: `node --test src/ferramentas/admin/perfis-de-acesso.test.mjs`
Expected: PASS (19 testes)

- [ ] **Step 6: Commit**

```bash
git add src/ferramentas/admin/perfis-de-acesso.js src/ferramentas/admin/perfis-de-acesso.test.mjs
git commit -m "Quem sera afetado por uma mudanca de perfil, nome a nome"
```

---

### Task 4: Salvar o acesso de alguém como perfil

D7, primeira metade: o perfil nasce de uma pessoa que já está certa.

**Files:**
- Modify: `src/ferramentas/admin/tela-de-admin.vue` — dentro de `_abaDeFerramentas` (a aba "O que ela abre", criada na Fase 1)
- Modify: `src/ferramentas/admin/imports.test.mjs` não precisa de mudança; ele descobre sozinho.

**Interfaces:**
- Consumes: `_permState.permissions`, `adFetch`, `uiPrompt`/modal do projeto.
- Produces: linhas em `acessos_perfis`.

- [ ] **Step 1: Ler antes de tocar**

Abra `tela-de-admin.vue` e localize `_abaDeFerramentas`. Veja como o botão "duplicar acesso de outro usuário" já monta seu controle — o novo botão fica ao lado dele, no mesmo bloco, com o mesmo visual. **Não invente um padrão novo de botão**: o projeto tem três tipos e só (ver `PADRAO-DA-CENTRAL.md`).

- [ ] **Step 2: Acrescentar o botão "Salvar como perfil"**

```js
  // D7: o perfil nasce de alguém que já está certo. Não existe taxonomia de
  // cargo neste banco — 21 das 26 pessoas têm o campo vazio —, então pedir pra
  // classificar todo mundo antes de usar mataria a funcionalidade na primeira
  // semana. Copiar de uma pessoa real é o caminho que funciona no dia 1.
  const btnPerfil = document.createElement('button')
  btnPerfil.type = 'button'
  btnPerfil.className = 'btn'
  btnPerfil.textContent = 'Salvar como perfil'
  btnPerfil.onclick = async () => {
    // ATENÇÃO: `uiPrompt`/`uiConfirm` NÃO EXISTEM neste projeto — são do
    // Acólitos, e eu os citei aqui por engano na primeira versão deste plano.
    // O que existe neste arquivo é `_gtConfirmAdmin(titulo, texto)` (~L638),
    // que embrulha `window.confirm`. Não há helper de pergunta com texto.
    //
    // Como o nome do perfil precisa ser digitado, use `window.prompt` — é
    // coerente com o que o arquivo já faz para confirmar, e `PADRAO-DA-CENTRAL.md`
    // não proíbe diálogo nativo (confirmado por leitura). Se preferir um campo
    // na própria tela em vez do diálogo, é melhoria legítima, mas então NÃO
    // improvise: siga o padrão de formulário que o arquivo já usa.
    const nome = window.prompt('Nome do perfil (ex.: Vendedora)')
    if (!nome || !nome.trim()) return
    const r = await adFetch('acessos_perfis', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ nome: String(nome).trim(), permissions: _permState.permissions }),
    })
    if (!r.ok) { adminToast('Não consegui salvar o perfil'); return }
    adminToast(`Perfil "${nome}" criado`)
  }
```

> `adminToast(msg, ok = true)` existe e vem de `src/compartilhado/avisos.js` — **verificado**. Confira se ele já está importado neste arquivo antes de usar.

- [ ] **Step 3: Conferir o erro de nome repetido**

`nome` é `unique` na tabela. Salvar com nome já existente devolve 409. A mensagem tem que dizer isso, não "não consegui":

```js
    if (r.status === 409) { adminToast(`Já existe um perfil chamado "${nome}"`); return }
```

Ponha essa linha ANTES do `if (!r.ok)`.

- [ ] **Step 4: Rodar**

```bash
node --test src/ferramentas/admin/imports.test.mjs
npm test && npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/ferramentas/admin/tela-de-admin.vue
git commit -m "Salvar o acesso de uma pessoa como perfil"
```

---

### Task 5: Começar com o acesso de alguém

D7, segunda metade: a pessoa nova.

**Files:**
- Modify: `src/ferramentas/admin/tela-de-admin.vue` — no formulário de criar usuário (topo da lista de Usuários)

**Interfaces:**
- Consumes: `acessos_perfis` (Task 1), `excecaoDe` (Task 2).

- [ ] **Step 1: Carregar os perfis ao abrir a tela**

Junto de onde `_usersCache` é preenchido, acrescente:

```js
// Os perfis existentes, pra oferecer "começar com o acesso de…". Falhar aqui
// não pode impedir criar usuário: sem perfil, a pessoa nasce sem nada, que é o
// padrão do projeto (permissão nasce desmarcada).
let _perfisCache = []
try {
  const r = await adFetch('acessos_perfis?select=id,nome,permissions&order=nome')
  _perfisCache = await r.json()
} catch { _perfisCache = [] }
```

- [ ] **Step 2: Oferecer a escolha no formulário**

Um seletor com os perfis mais a opção **"Sem nada"**, que é a primeira e a padrão:

```js
  // "Sem nada" primeiro e selecionado: permissão nasce desmarcada é regra do
  // projeto, e um seletor que já vem com perfil escolhido concederia acesso por
  // omissão — exatamente o que a regra existe pra impedir.
  const sel = document.createElement('select')
  sel.className = 'mock-select'
  const semNada = document.createElement('option')
  semNada.value = ''
  semNada.textContent = 'Sem nada — marco uma a uma'
  sel.appendChild(semNada)
  for (const p of _perfisCache) {
    const o = document.createElement('option')
    o.value = p.id
    o.textContent = `${p.nome} — ${Object.keys(p.permissions || {}).length} ferramentas`
    sel.appendChild(o)
  }
```

- [ ] **Step 3: Gravar o perfil junto do usuário novo**

No ponto onde o usuário é criado, se `sel.value` estiver preenchido:

```js
  const perfil = _perfisCache.find((p) => p.id === sel.value)
  if (perfil) {
    payload.perfil_id = perfil.id
    payload.permissions = { ...perfil.permissions }
    payload.permissions_excecao = {}
    payload.features = derivarFeatures(payload.permissions, { ehSuperadmin: false })
  }
```

`features` é derivado junto porque este projeto tem **dois modelos de permissão** convivendo (`permissions{}` e `features[]`), e gravar um sem o outro deixa a pessoa vendo metade das telas.

- [ ] **Step 4: Rodar**

```bash
node --test src/ferramentas/admin/imports.test.mjs
npm test && npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/ferramentas/admin/tela-de-admin.vue
git commit -m "Pessoa nova comeca com o acesso de um perfil, ou sem nada"
```

---

### Task 6: A tela de confirmação de impacto

D11. É a task que autoriza o D8 a existir.

**Files:**
- Modify: `src/ferramentas/admin/tela-de-admin.vue`

**Interfaces:**
- Consumes: `impactoDaMudanca` e `acessoEfetivo` (Tasks 2 e 3).

- [ ] **Step 1: Buscar os membros do perfil antes de gravar**

```js
// Só quem ESTÁ no perfil entra na conta. Perguntar pelo perfil e listar todo
// mundo faria a tela prometer mudança em gente que não muda.
const r = await adFetch(
  `profiles?select=id,name,email,permissions,permissions_excecao,is_superadmin&perfil_id=eq.${perfilId}`)
// DUAS listas de propósito, e os nomes importam: `membrosCrus` guarda a linha
// inteira (precisa de `id` e `is_superadmin` para o PATCH do Step 3);
// `membros` é a forma reduzida que `impactoDaMudanca` espera.
const membrosCrus = await r.json()
const membros = membrosCrus.map((p) => ({
  nome: p.name || p.email, permissions: p.permissions, permissions_excecao: p.permissions_excecao,
}))
```

- [ ] **Step 2: Mostrar o impacto e exigir confirmação**

```js
  const impacto = impactoDaMudanca(novasPermissions, membros)
  if (impacto.total === 0) {
    // Ninguém muda: gravar direto. Uma confirmação que não tem o que confirmar
    // ensina a pessoa a clicar "Aplicar" sem ler, e aí a confirmação que
    // importa também passa batida.
    await gravarPerfil()
    return
  }
  // Três listas, e a de PERDA em maiúscula: quem lê rápido tem que enxergar a
  // perda antes do ganho. `muda` mostra o de-para porque "mudou de nível" sem
  // dizer para qual não ajuda ninguém a decidir.
  const linhas = impacto.afetados.map((a) => {
    const partes = []
    if (a.ganha.length) partes.push(`ganha ${a.ganha.join(', ')}`)
    if (a.perde.length) partes.push(`PERDE ${a.perde.join(', ')}`)
    for (const m of a.muda || []) {
      partes.push(`${m.chave}: de [${m.de.join(', ')}] para [${m.para.join(', ')}]`)
    }
    return `${a.nome}: ${partes.join(' · ')}`
  })
  // `_gtConfirmAdmin(titulo, texto)` (~L638 deste arquivo) é o que existe aqui —
  // VERIFICADO. Ele recebe dois argumentos, não três, e devolve Promise<boolean>.
  const ok = await _gtConfirmAdmin(
    `${impacto.total} ${impacto.total === 1 ? 'pessoa vai mudar' : 'pessoas vão mudar'} de acesso agora`,
    linhas.join('\n'),
  )
  if (!ok) return
```

> **Correção de um erro meu:** a primeira versão deste plano mandava usar `uiConfirm` e proibia diálogo nativo. As duas coisas vieram do projeto **Acólitos**, não deste. Aqui o helper é `_gtConfirmAdmin`, ele usa `window.confirm` de propósito, e `PADRAO-DA-CENTRAL.md` não tem regra contra isso.
>
> Se a lista de afetados for longa, `window.confirm` fica ruim de ler. Isso é um limite conhecido, não um defeito a consertar por conta própria: **se passar de ~10 pessoas, pare e reporte** em vez de inventar um modal novo.

- [ ] **Step 3: Propagar para cada membro**

```js
  // Um PATCH por pessoa, com o acesso recalculado. `features` vai junto pelo
  // mesmo motivo da Task 5: dois modelos convivem e gravar um só deixa a
  // pessoa vendo metade das telas.
  for (const p of membrosCrus) {
    const efetivo = acessoEfetivo(novasPermissions, p.permissions_excecao)
    await adFetch('profiles?id=eq.' + p.id, {
      method: 'PATCH',
      body: JSON.stringify({
        permissions: efetivo,
        features: derivarFeatures(efetivo, { ehSuperadmin: !!p.is_superadmin }),
      }),
    })
  }
```

- [ ] **Step 4: Rodar**

```bash
node --test src/ferramentas/admin/imports.test.mjs
npm test && npm run build
```

- [ ] **Step 5: Provar num perfil descartável, NÃO em gente real**

Crie um perfil de teste, ponha nele **um usuário descartável** (não use conta de pessoa real — é regra do projeto), mude o perfil, confira que a tela nomeia essa conta e que o acesso dela mudou. Depois apague o perfil e devolva a conta ao estado anterior.

**Se não houver conta descartável disponível, PARE e reporte** — não teste propagação em conta de gente que trabalha aqui.

- [ ] **Step 6: Commit**

```bash
git add src/ferramentas/admin/tela-de-admin.vue
git commit -m "Mudanca de perfil mostra quem sera afetado antes de gravar"
```

---

## O que esta fase NÃO entrega

- **Editar o perfil pela tela.** Esta fase cria, aplica e propaga. Mudar o mapa de um perfil existente acontece hoje salvando de novo a partir de uma pessoa. Um editor próprio de perfil é fase seguinte.
- **Tirar alguém de um perfil.** `perfil_id = null` funciona no banco; não há botão.
- **Conferência visual logada** — nenhuma sessão de agente tem login. Fica com o dono, inclusive a 375px.
