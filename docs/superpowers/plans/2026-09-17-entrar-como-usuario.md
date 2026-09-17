# "Entrar como" (sessão real de outra pessoa) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Super-admin consegue abrir a Central autenticado como outra pessoa de verdade (sessão real, dado real, RLS real), sem nunca saber ou definir a senha dela, a partir da tela "Visão como".

**Architecture:** Uma Edge Function (`entrar-como-usuario`, chave de serviço) gera uma sessão real da pessoa-alvo via `auth.admin.generateLink` + `auth.verifyOtp` e grava uma linha de auditoria. O front abre essa sessão numa aba nova cujo `sbClient` usa `sessionStorage` em vez de `localStorage` — isolando-a da sessão real do admin, que vive no `localStorage` compartilhado entre abas. O boot do app já sabe consumir um `#access_token=...` da URL sozinho (mesmo mecanismo do convite/redefinição de senha), então nenhuma tela precisa saber que está "impersonando" — só a moldura, que mostra uma faixa fixa enquanto isso durar.

**Tech Stack:** Vue 3 (`<script setup>`), Supabase JS v2 (cliente único `sbClient`), Deno Edge Functions, Postgres/RLS, `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-17-entrar-como-usuario-design.md`

## Global Constraints

- Nenhuma cor em hex novo; nenhum `style=` solto em botão; botão só `.btn` / `.btn.btn-principal` / `.btn.btn-perigo` (PADRAO-DA-CENTRAL.md, itens 2 e 3).
- Alvo de toque ≥ 40px, fonte de campo ≥ 16px, texto nunca corta, medido a 375px num navegador de verdade (PADRAO-DA-CENTRAL.md, itens 5 e 6).
- Nunca logar `access_token`/`refresh_token` (nem `console.log`, nem no corpo de um erro).
- `expires_in` devolvido pela Edge Function é sempre o valor real que `verifyOtp` devolveu — nunca um número fixo no front.
- Migration e deploy de Edge Function são ações em banco/produção compartilhados por mais de uma pessoa/janela — pare e peça confirmação antes de rodar o comando que aplica de verdade (não o `--dry`).
- `npm test` inteiro e `npm run build` sem erro antes de qualquer commit que feche uma tarefa.

---

## Mapa de arquivos

**Criar:**
- `db/migrations/2026-09-17-log-de-entrar-como.sql` — tabela de auditoria.
- `supabase/functions/_shared/checagem-de-entrar-como.js` — regra pura de quando recusar (testável sem rede).
- `supabase/functions/_shared/checagem-de-entrar-como.test.mjs`
- `supabase/functions/entrar-como-usuario/index.ts` — a Edge Function.
- `src/compartilhado/modo-entrar-como.js` — decide se esta aba está em modo impersonação (puro, testável).
- `src/compartilhado/modo-entrar-como.test.mjs`

**Modificar:**
- `src/compartilhado/conectar-no-banco-de-dados.js` — `sbClient` usa `sessionStorage` quando `modo-entrar-como.js` diz que sim.
- `src/ferramentas/admin/tela-de-visao-como.vue` — botão "Entrar como (sessão real)".
- `src/moldura-do-aplicativo.vue` — faixa fixa + sair do modo.

---

### Task 1: Tabela de auditoria

**Files:**
- Create: `db/migrations/2026-09-17-log-de-entrar-como.sql`

**Interfaces:**
- Produces: tabela `public.entradas_como_outro_usuario(id, admin_id, admin_email, alvo_id, alvo_email, criado_em)`, RLS ligado, SELECT só para `public.superadmin_pela_ficha()` (função já existe, criada em `db/migrations/2026-08-20-grupo-do-canal.sql` — não recriar).

- [ ] **Step 1: Escrever a migration**

```sql
-- REGISTRO DE "ENTRAR COMO" — quem entrou como quem, quando.
--
-- "Entrar como" (docs/superpowers/specs/2026-09-17-entrar-como-usuario-design.md)
-- gera uma sessao REAL de outra pessoa. A partir dai dado real dela e exposto,
-- e isso precisa de trilha -- diferente da "Visao como", que so le
-- configuracao e nunca precisou de auditoria.
--
-- So a Edge Function grava (chave de servico, ignora RLS). So super-admin le.

create table if not exists public.entradas_como_outro_usuario (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references public.profiles(id),
  admin_email text not null,
  alvo_id uuid not null references public.profiles(id),
  alvo_email text not null,
  criado_em timestamptz not null default now()
);

alter table public.entradas_como_outro_usuario enable row level security;

drop policy if exists "superadmin le entradas como outro usuario" on public.entradas_como_outro_usuario;
create policy "superadmin le entradas como outro usuario"
  on public.entradas_como_outro_usuario
  for select
  using (public.superadmin_pela_ficha());
```

- [ ] **Step 2: Conferir em modo seco**

Run: `node coletor/run-migrations.mjs --dry`
Expected: a lista de pendentes inclui `2026-09-17-log-de-entrar-como.sql` e nenhum erro de sintaxe.

- [ ] **Step 3: Aplicar — PARE E CONFIRME COM O USUÁRIO ANTES**

Este comando escreve na tabela `public.entradas_como_outro_usuario` do banco de
produção, que é compartilhado. Só depois de confirmação:

Run: `node coletor/run-migrations.mjs`
Expected: `2026-09-17-log-de-entrar-como.sql` aplicada, sem erro.

- [ ] **Step 4: Commit**

```bash
git add db/migrations/2026-09-17-log-de-entrar-como.sql
git commit -m "feat(admin): tabela de auditoria de \"entrar como outro usuario\""
```

---

### Task 2: Regra pura de recusa

**Files:**
- Create: `supabase/functions/_shared/checagem-de-entrar-como.js`
- Test: `supabase/functions/_shared/checagem-de-entrar-como.test.mjs`

**Interfaces:**
- Produces: `motivoDeRecusa({ chamador, alvoId, alvo })` — `chamador: {id, is_superadmin}`, `alvo: {id, email, disabled} | null`. Devolve `string` (motivo, em português, pronto para virar mensagem de erro) ou `null` (libera). Consumida pela Task 3.

- [ ] **Step 1: Escrever o teste**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { motivoDeRecusa } from './checagem-de-entrar-como.js'

const SUPERADMIN = { id: 'admin-1', is_superadmin: true }
const ADMIN_COMUM = { id: 'admin-2', is_superadmin: false }
const ALVO = { id: 'alvo-1', email: 'helen@rbvcompany.com', disabled: false }

test('admin comum (nao superadmin) e recusado', () => {
  const m = motivoDeRecusa({ chamador: ADMIN_COMUM, alvoId: ALVO.id, alvo: ALVO })
  assert.match(m, /super-admin/i)
})

test('entrar como si mesmo e recusado, mesmo sendo superadmin', () => {
  const m = motivoDeRecusa({ chamador: SUPERADMIN, alvoId: SUPERADMIN.id, alvo: SUPERADMIN })
  assert.match(m, /você já é você/i)
})

test('alvo inexistente e recusado', () => {
  const m = motivoDeRecusa({ chamador: SUPERADMIN, alvoId: 'nao-existe', alvo: null })
  assert.match(m, /não encontrei/i)
})

test('alvo desativado e recusado', () => {
  const m = motivoDeRecusa({ chamador: SUPERADMIN, alvoId: ALVO.id, alvo: { ...ALVO, disabled: true } })
  assert.match(m, /desativada/i)
})

test('superadmin entrando como outra pessoa ativa: libera (null)', () => {
  const m = motivoDeRecusa({ chamador: SUPERADMIN, alvoId: ALVO.id, alvo: ALVO })
  assert.equal(m, null)
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test supabase/functions/_shared/checagem-de-entrar-como.test.mjs`
Expected: FAIL — `Cannot find module './checagem-de-entrar-como.js'`

- [ ] **Step 3: Escrever a implementação**

```js
// QUANDO RECUSAR "ENTRAR COMO OUTRO USUARIO" — uma regra so, pura.
//
// PURO: sem rede, sem cliente Supabase. Quem chama (a Edge Function) ja
// buscou os perfis; aqui so decide, dado o que foi buscado.
//
// A ORDEM IMPORTA: cada recusa devolve a MENSAGEM que a pessoa le, entao a
// primeira que bater e a que ela ve — nao empilha "voce nao e superadmin E
// alem disso essa conta nao existe".
export function motivoDeRecusa({ chamador, alvoId, alvo }) {
  if (!chamador?.is_superadmin) return 'Apenas super-admin pode entrar como outro usuário'
  if (String(chamador.id) === String(alvoId)) return 'Você já é você — não precisa entrar como si mesmo'
  if (!alvo) return 'Não encontrei essa pessoa'
  if (alvo.disabled) return 'Conta desativada — reative antes de entrar como ela'
  return null
}
```

- [ ] **Step 4: Rodar de novo**

Run: `node --test supabase/functions/_shared/checagem-de-entrar-como.test.mjs`
Expected: PASS (5 testes)

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/checagem-de-entrar-como.js supabase/functions/_shared/checagem-de-entrar-como.test.mjs
git commit -m "feat(admin): regra pura de quando recusar \"entrar como\""
```

---

### Task 3: Edge Function `entrar-como-usuario`

**Files:**
- Create: `supabase/functions/entrar-como-usuario/index.ts`

**Interfaces:**
- Consumes: `motivoDeRecusa` (Task 2).
- Produces: endpoint `POST /functions/v1/entrar-como-usuario`, corpo `{ alvoId: string }`, cabeçalho `Authorization: Bearer <token de quem chama>`. Sucesso: `200 { access_token, refresh_token, expires_in }`. Falha: `400 { error: string }`.

- [ ] **Step 1: Escrever a função**

```ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { motivoDeRecusa } from '../_shared/checagem-de-entrar-como.js'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const anonClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    )

    const { data: { user }, error: authErr } = await anonClient.auth.getUser()
    if (authErr || !user) throw new Error('Não autenticado')

    const { data: chamador } = await anonClient
      .from('profiles')
      .select('id, is_superadmin')
      .eq('id', user.id)
      .single()

    const { alvoId } = await req.json()
    if (!alvoId) throw new Error('Faltou alvoId')

    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    const { data: alvo } = await adminClient
      .from('profiles')
      .select('id, email, disabled')
      .eq('id', alvoId)
      .maybeSingle()

    const recusa = motivoDeRecusa({ chamador: { id: user.id, is_superadmin: chamador?.is_superadmin }, alvoId, alvo })
    if (recusa) throw new Error(recusa)

    // Gera o link SEM enviar e-mail — generateLink so cria; quem manda e-mail
    // e outra chamada (inviteUserByEmail), que nao fazemos aqui.
    const { data: linkData, error: linkErr } = await adminClient.auth.admin.generateLink({
      type: 'magiclink',
      email: alvo.email,
    })
    if (linkErr) throw linkErr
    const tokenHash = linkData?.properties?.hashed_token
    if (!tokenHash) throw new Error('O Supabase não devolveu o token do link')

    // Troca o token por uma sessao real da pessoa-alvo. Isto e um endpoint
    // PUBLICO do GoTrue (verifyOtp) -- usa a chave anonima, nao a de servico.
    const verifyClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )
    const { data: sessionData, error: verifyErr } = await verifyClient.auth.verifyOtp({
      token_hash: tokenHash,
      type: 'magiclink',
    })
    if (verifyErr || !sessionData.session) throw verifyErr || new Error('Não consegui gerar a sessão')

    // Auditoria: quem entrou como quem, quando. So depois de ter a sessao —
    // se isto falhar, a entrada ja aconteceu; registramos o erro mas nao
    // desfazemos a sessao ja emitida (nao ha como "desemitir" um token).
    const { error: auditErr } = await adminClient.from('entradas_como_outro_usuario').insert({
      admin_id: user.id,
      admin_email: user.email,
      alvo_id: alvo.id,
      alvo_email: alvo.email,
    })
    if (auditErr) console.error('auditoria de entrar-como falhou:', auditErr.message)

    return new Response(JSON.stringify({
      access_token: sessionData.session.access_token,
      refresh_token: sessionData.session.refresh_token,
      expires_in: sessionData.session.expires_in,
    }), { headers: { ...cors, 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message || String(e) }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
})
```

- [ ] **Step 2: Conferir a sintaxe**

Run: `npm test` (o teste `toda edge function compila` já cobre todo `supabase/functions/**/index.ts`)
Expected: PASS, incluindo a nova função na lista.

- [ ] **Step 3: Deploy — PARE E CONFIRME COM O USUÁRIO ANTES**

Publicar edge function é ação em produção, compartilhada por mais de uma
pessoa (ver `CLAUDE.md`, seção "ANTES DE PUBLICAR EDGE FUNCTION"). Antes de
rodar:
1. `git fetch` e confirmar que está partindo do `origin/main` atualizado.
2. Só publicar o que já está commitado na `main`.

Run: `npx supabase functions deploy entrar-como-usuario --project-ref kounqtdoioootxqegkij`
Expected: deploy sem erro. Função nova, então não há versão anterior para
comparar/perder — o risco de sobrescrever trabalho de outra pessoa (o motivo
do procedimento do CLAUDE.md) não se aplica aqui.

- [ ] **Step 4: Testar manualmente com token errado**

Run: `curl -s -X POST https://kounqtdoioootxqegkij.supabase.co/functions/v1/entrar-como-usuario -H "Authorization: Bearer token-errado" -H "Content-Type: application/json" -d '{"alvoId":"qualquer"}'`
Expected: `400` com `{"error":"Não autenticado"}` (ou mensagem equivalente do GoTrue) — nunca `500`/`BOOT_ERROR`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/entrar-como-usuario/index.ts
git commit -m "feat(admin): Edge Function que gera sessão real de outra pessoa (entrar-como-usuario)"
```

---

### Task 4: Detectar modo "entrar como" (puro)

**Files:**
- Create: `src/compartilhado/modo-entrar-como.js`
- Test: `src/compartilhado/modo-entrar-como.test.mjs`

**Interfaces:**
- Produces: `calcularModoEntrarComo(search)` — `search` é a string de query (`window.location.search`, com ou sem `?` na frente). Devolve `true` quando `modo=entrar-como` está presente. Consumida pela Task 5.

- [ ] **Step 1: Escrever o teste**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calcularModoEntrarComo } from './modo-entrar-como.js'

test('com ?modo=entrar-como, é true', () => {
  assert.equal(calcularModoEntrarComo('?modo=entrar-como'), true)
})

test('sem o parâmetro, é false', () => {
  assert.equal(calcularModoEntrarComo(''), false)
  assert.equal(calcularModoEntrarComo(undefined), false)
})

test('com outro valor de modo, é false', () => {
  assert.equal(calcularModoEntrarComo('?modo=outracoisa'), false)
})

test('funciona sem o "?" na frente também', () => {
  assert.equal(calcularModoEntrarComo('modo=entrar-como'), true)
})

test('ignora outros parâmetros junto', () => {
  assert.equal(calcularModoEntrarComo('?diag=1&modo=entrar-como'), true)
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test src/compartilhado/modo-entrar-como.test.mjs`
Expected: FAIL — `Cannot find module './modo-entrar-como.js'`

- [ ] **Step 3: Escrever a implementação**

```js
// SE ESTA ABA ESTA EM MODO "ENTRAR COMO OUTRO USUARIO" — decisao pura.
//
// Usado por conectar-no-banco-de-dados.js para escolher sessionStorage (esta
// aba) em vez de localStorage (compartilhado entre abas) — ver o motivo
// completo em docs/superpowers/specs/2026-09-17-entrar-como-usuario-design.md.
//
// Sem imports de proposito: puro, testavel no Node sem fingir `window`.
export function calcularModoEntrarComo(search) {
  const q = new URLSearchParams(String(search || '').replace(/^\?/, ''))
  return q.get('modo') === 'entrar-como'
}
```

- [ ] **Step 4: Rodar de novo**

Run: `node --test src/compartilhado/modo-entrar-como.test.mjs`
Expected: PASS (5 testes)

- [ ] **Step 5: Commit**

```bash
git add src/compartilhado/modo-entrar-como.js src/compartilhado/modo-entrar-como.test.mjs
git commit -m "feat(admin): deteccao pura do modo \"entrar como\" (para o storage da sessao)"
```

---

### Task 5: `sbClient` isola a sessão desta aba

**Files:**
- Modify: `src/compartilhado/conectar-no-banco-de-dados.js`

**Interfaces:**
- Consumes: `calcularModoEntrarComo(search)` (Task 4).
- Produces: `export const emModoEntrarComo: boolean` — usado pela Task 7 (faixa na moldura). `sbClient` continua com a mesma assinatura de sempre para quem já o usa.

- [ ] **Step 1: Ler o arquivo atual**

O arquivo hoje é:

```js
export const SUPABASE_URL = 'https://kounqtdoioootxqegkij.supabase.co'
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtvdW5xdGRvaW9vb3R4cWVna2lqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyMDMwMDUsImV4cCI6MjA5NDc3OTAwNX0.MVXa6jngjKXkH3eZ7as_j_k8Eb7lJKcFmO4kCKAnuHM'
export const sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
```

- [ ] **Step 2: Escrever a versão nova**

```js
import { calcularModoEntrarComo } from './modo-entrar-como.js'

export const SUPABASE_URL = 'https://kounqtdoioootxqegkij.supabase.co'
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtvdW5xdGRvaW9vb3R4cWVna2lqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyMDMwMDUsImV4cCI6MjA5NDc3OTAwNX0.MVXa6jngjKXkH3eZ7as_j_k8Eb7lJKcFmO4kCKAnuHM'

// A sessao do Supabase mora no localStorage por padrao -- compartilhado entre
// TODAS as abas da mesma origem. A aba de "Entrar como" (tela-de-visao-como.vue)
// nao pode escrever ali: sobrescreveria a sessao real do admin em qualquer
// outra aba que relesse o localStorage (um F5, por exemplo). Por isso ela usa
// sessionStorage, isolado por aba, que some sozinho quando a aba fecha.
//
// A marca em sessionStorage sobrevive a um F5 desta MESMA aba (a query
// `?modo=entrar-como` some da URL depois da primeira navegacao do router).
//
// try/catch: este arquivo e importado pelo teste de
// controle-de-login-e-usuario.test.mjs com um `window` minimo, sem
// `location`/`sessionStorage` de verdade.
function _storageDestaAba() {
  try {
    const jaMarcada = window.sessionStorage.getItem('modo_entrar_como') === '1'
    const ativo = jaMarcada || calcularModoEntrarComo(window.location.search)
    if (ativo) window.sessionStorage.setItem('modo_entrar_como', '1')
    return ativo ? window.sessionStorage : null
  } catch {
    return null
  }
}

const _storageEspecial = _storageDestaAba()
export const emModoEntrarComo = !!_storageEspecial
export const sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY,
  _storageEspecial ? { auth: { storage: _storageEspecial } } : undefined)
```

- [ ] **Step 3: Confirmar que o teste existente continua passando**

Run: `node --test src/compartilhado/controle-de-login-e-usuario.test.mjs`
Expected: PASS — nenhuma mudança de comportamento para quem não está em modo "entrar como" (o `window` fake do teste não tem `sessionStorage`/`location`, cai no `catch`, `_storageEspecial` é `null`, `sbClient` é criado do mesmo jeito que antes).

- [ ] **Step 4: Rodar a suíte inteira**

Run: `npm test`
Expected: PASS, nenhuma regressão.

- [ ] **Step 5: Commit**

```bash
git add src/compartilhado/conectar-no-banco-de-dados.js
git commit -m "feat(admin): sbClient isola a sessao em sessionStorage na aba de \"entrar como\""
```

---

### Task 6: Botão "Entrar como" na tela "Visão como"

**Files:**
- Modify: `src/ferramentas/admin/tela-de-visao-como.vue`

**Interfaces:**
- Consumes: `estado` e `SUPABASE_URL`/`SUPABASE_ANON_KEY` (já importados na tela); endpoint da Task 3.
- Produces: nada consumido por outra task — é o ponto de entrada do usuário.

- [ ] **Step 1: Adicionar o bloco no template, logo abaixo da faixa de "Simulação"**

```html
<div v-if="pessoa" class="vcu-entrar-bloco">
  <button class="btn btn-perigo" type="button" @click="entrarComo" :disabled="entrando">
    {{ entrando ? 'Entrando…' : 'Entrar como (sessão real)' }}
  </button>
  <p class="vcu-entrar-aviso">
    Abre uma aba nova, autenticado de verdade como
    <b>{{ pessoa.name || pessoa.email }}</b> — dado real dela, sem senha
    nenhuma. Fica registrado quem entrou e quando.
  </p>
  <p v-if="erroEntrar" class="vcu-entrar-erro">{{ erroEntrar }}</p>
</div>
```

(É `.btn-perigo` porque expõe dado real de outra pessoa — a ação mais séria
da tela, igual ao critério do item 3 do PADRAO-DA-CENTRAL: "apaga, desativa,
ou é difícil de desfazer". Aqui não desfaz nada, mas o dado exposto é
irreversível de "desver".)

- [ ] **Step 2: Adicionar o script**

Logo após a declaração de `carregando`/`erro`/`pessoa` já existentes:

```js
const entrando = ref(false)
const erroEntrar = ref(null)

async function entrarComo() {
  if (!pessoa.value) return
  const nome = pessoa.value.name || pessoa.value.email
  if (!confirm(`Entrar como "${nome}"?\n\nVocê vai abrir a Central autenticado de verdade como ela, numa aba separada. Isto fica registrado.`)) return

  erroEntrar.value = null
  entrando.value = true
  // Reserva a aba ANTES do fetch: depois de um await, o navegador trata
  // window.open como popup e bloqueia.
  const aba = window.open('', '_blank')
  try {
    const tok = estado.currentSession?.access_token || SUPABASE_ANON_KEY
    const r = await fetch(`${SUPABASE_URL}/functions/v1/entrar-como-usuario`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ alvoId: pessoa.value.id }),
    })
    const dados = await r.json().catch(() => null)
    if (!r.ok || !dados || dados.error) throw new Error(dados?.error || 'Não consegui gerar a sessão.')
    const hash = `access_token=${dados.access_token}&refresh_token=${dados.refresh_token}&expires_in=${dados.expires_in}&token_type=bearer&type=magiclink`
    if (aba) aba.location.href = `/?modo=entrar-como#${hash}`
    else erroEntrar.value = 'O navegador bloqueou a aba nova. Permita pop-ups para este site e tente de novo.'
  } catch (e) {
    aba?.close()
    erroEntrar.value = e.message || 'Não consegui entrar como essa pessoa.'
  } finally {
    entrando.value = false
  }
}
```

- [ ] **Step 3: Adicionar o CSS (mesma seção `<style scoped>` já existente)**

```css
.vcu-entrar-bloco{margin-top:var(--sp-5);padding-top:var(--sp-5);border-top:1px solid var(--border);display:flex;flex-direction:column;align-items:flex-start;gap:var(--sp-2);}
.vcu-entrar-aviso{margin:0;font-family:var(--fonte-principal);font-size:var(--texto-corpo);color:var(--muted);max-width:60ch;}
.vcu-entrar-erro{margin:0;font-family:var(--fonte-principal);font-size:var(--texto-corpo);color:var(--red);}
```

- [ ] **Step 4: Rodar a suíte e o build**

Run: `npm test && npm run build`
Expected: PASS / build sem erro (o teste `todo-vue-compila` cobre este arquivo).

- [ ] **Step 5: Commit**

```bash
git add src/ferramentas/admin/tela-de-visao-como.vue
git commit -m "feat(admin): botao \"Entrar como (sessao real)\" na tela Visao como"
```

---

### Task 7: Faixa de aviso na moldura + sair do modo

**Files:**
- Modify: `src/moldura-do-aplicativo.vue`

**Interfaces:**
- Consumes: `emModoEntrarComo` (Task 5), `estado.user` (já importado na moldura), `sbClient` (já importado).

- [ ] **Step 1: Importar `emModoEntrarComo`**

Na lista de imports já existente de `conectar-no-banco-de-dados.js` (procurar
o import de `sbClient` na moldura e acrescentar ao mesmo `import { ... }`):

```js
import { sbClient, emModoEntrarComo } from './compartilhado/conectar-no-banco-de-dados.js'
```

- [ ] **Step 2: Adicionar a faixa no template — primeira linha dentro de `.moldura`, antes de `#bg-shapes`**

```html
<div v-if="emModoEntrarComo" class="faixa-entrar-como">
  Você está vendo como <b>{{ estado.user?.email }}</b>
  <button type="button" @click="sairDoModoEntrarComo">Sair</button>
</div>
```

- [ ] **Step 3: Adicionar a função, perto de `sair()` já existente**

```js
async function sairDoModoEntrarComo() {
  try { await sbClient.auth.signOut() } catch (e) { /* segue mesmo assim */ }
  try { sessionStorage.removeItem('modo_entrar_como') } catch (e) {}
  // A aba foi aberta por script (window.open em tela-de-visao-como.vue),
  // entao fecha sem pedir permissao na maioria dos navegadores.
  window.close()
  // Se o navegador recusar fechar (aba que o usuario navegou manualmente
  // depois), cai aqui: mostra o login normal, sem sessao nenhuma.
  setTimeout(() => { window.location.href = '/login' }, 300)
}
```

- [ ] **Step 4: Adicionar o CSS**

```css
.faixa-entrar-como{position:fixed;top:0;left:0;right:0;z-index:10000;display:flex;align-items:center;justify-content:center;gap:var(--sp-3);flex-wrap:wrap;padding:8px var(--gutter);background:var(--roxo);color:var(--sobre-cor);font-family:var(--fonte-principal);font-size:max(9px, calc(12.5px * var(--escala-texto, 1)));text-align:center;}
.faixa-entrar-como button{flex-shrink:0;min-height:32px;padding:4px 14px;border:1px solid var(--sobre-cor);border-radius:var(--radius-md);background:transparent;color:var(--sobre-cor);font-family:inherit;font-size:inherit;font-weight:600;cursor:pointer;}
.faixa-entrar-como button:hover{background:color-mix(in srgb, var(--sobre-cor) 15%, transparent);}
```

(`--roxo` porque a mesma cor já significa "algo automatizado/fora do fluxo
normal está agindo em seu nome" no resto da Central — item 2 do
PADRAO-DA-CENTRAL — e "você está vestindo a sessão de outra pessoa" é
exatamente esse tipo de estado.)

- [ ] **Step 5: Rodar a suíte e o build**

Run: `npm test && npm run build`
Expected: PASS / build sem erro.

- [ ] **Step 6: Commit**

```bash
git add src/moldura-do-aplicativo.vue
git commit -m "feat(admin): faixa fixa \"Você está vendo como...\" + sair do modo entrar como"
```

---

### Task 8: Verificação final (checklist do PADRAO-DA-CENTRAL)

**Files:** nenhum novo — só verificação.

- [ ] **Step 1: Suíte inteira + build**

Run: `npm test && npm run build`
Expected: tudo verde, build sem erro.

- [ ] **Step 2: Abrir no navegador a 375px e 1440px, tema claro e escuro**

Reusar a técnica de sessão sintética (interceptar `**/rest/v1/profiles*`,
injetar `sb-kounqtdoioootxqegkij-auth-token` no `localStorage`) para abrir
`/admin/visao/<qualquer-id>` como super-admin e conferir:
- O botão "Entrar como (sessão real)" aparece, é `.btn-perigo`, ≥40px de
  altura, texto não corta.
- Para simular a faixa da moldura sem depender da Edge Function de verdade:
  em outra aba do mesmo teste, definir
  `sessionStorage.setItem('modo_entrar_como','1')` antes de navegar para `/`,
  e confirmar que a faixa roxa aparece, com o botão "Sair" ≥40px, sem
  rolagem horizontal a 375px.
- Os quatro critérios do item 6 do PADRAO-DA-CENTRAL (rolagem horizontal
  zero, alvo ≥40px, fonte de campo ≥16px, nenhum texto cortado).

- [ ] **Step 3: Teste ponta a ponta de verdade — PARE E CONFIRME COM O USUÁRIO ANTES**

Isto só funciona depois do deploy real da Edge Function (Task 3, Step 3) e da
migration aplicada (Task 1, Step 3). Com uma conta de teste (não a da
Héllen, para não confundir os registros de auditoria dela):
1. Logar como super-admin, abrir "Visão como" daquela conta de teste.
2. Clicar "Entrar como", confirmar.
3. Na aba nova, checar que abriu na Central dela (Início, cards dela) e que
   a faixa roxa aparece com o e-mail certo.
4. Clicar "Sair" na faixa — a aba fecha (ou vai para `/login`).
5. Voltar na aba original do admin — a sessão dele continua intacta (F5 nela
   não vira a conta de teste).
6. Conferir a linha nova em `entradas_como_outro_usuario` (via SQL ou pelo
   editor de tabelas do Supabase): `admin_id`/`alvo_id` corretos.

- [ ] **Step 4: Checklist final do PADRAO-DA-CENTRAL (item 10)**

- [ ] `npm test` inteiro passando
- [ ] `npm run build` sem erro
- [ ] Aberto no navegador a 375px E 1440px
- [ ] Nenhum hex de cor novo
- [ ] Nenhum `style=` solto em botão
- [ ] Tema escuro conferido
- [ ] Nada do que existia antes se perdeu
