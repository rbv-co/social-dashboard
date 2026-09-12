# Aviso do Bling — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quando o Bling não responder, as telas de venda avisam de que hora é o número que estão mostrando — em vez de mostrar R$ 0,00 como se não tivesse havido venda.

**Architecture:** Um módulo compartilhado (`src/compartilhado/chamada-do-bling.js`) passa a ser o único lugar que fala com a Edge `bling-proxy`: ele confere o status HTTP, classifica a falha em quatro causas e LANÇA. As duas telas (Gestão à Vista e Análise de Vendas) perdem suas cópias de `blingCall`/`blingPages`, ganham uma faixa de aviso e, na falha, **mantêm** o último número bom em tela.

**Tech Stack:** Vue 3 + Vite (telas em `.vue` com JS imperativo dentro), módulos ES em `src/compartilhado/`, testes com `node --test` (`*.test.mjs`), Supabase JS via `window.supabase` (global do navegador).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-13-aviso-do-bling-design.md`. Branch `aviso-do-bling`, worktree `~/iamundi-aviso-bling`.
- **Quatro causas, com estes nomes exatos:** `bling-recusou-token`, `bling-fora`, `sem-acesso-a-vendas`, `sem-resposta`.
- **Nada de emoji como ícone.** O triângulo de aviso é SVG inline. (Regra do dono.)
- **Português literal, sem jargão** no texto que não é de admin.
- **O carimbo de hora só avança em busca que deu certo.** `_gvLastLoadTime` e `window._saLastUpdateTime` não podem ser tocados numa tentativa que falhou.
- **Lista vazia NÃO é falha.** `200` com `data: []` é fim de lista e continua sendo tratado como hoje.
- `node --test` **não compila `.vue`** — todo commit que encosta em tela roda também `npm run build`.
- Teste que importa módulo de `src/compartilhado/` precisa fingir o `window` ANTES do import (padrão de `notificacoes-push.test.mjs:9`), porque `conectar-no-banco-de-dados.js` chama `window.supabase.createClient()` ao carregar.
- Um commit por tarefa. Nunca `git add <pasta>` — sempre arquivo por arquivo (outras janelas editam este repo).

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `src/compartilhado/chamada-do-bling.js` (**criar**) | Falar com o `bling-proxy`, classificar a falha, montar o texto do aviso. Único lugar que decide isso. |
| `src/compartilhado/chamada-do-bling.test.mjs` (**criar**) | Provar a classificação e os textos, um caso por formato real de falha. |
| `src/ferramentas/gestao-a-vista/tela-de-gestao-a-vista.vue` (**modificar**) | Perde `blingCall`/`blingPages` próprios (`:184-215`), ganha a faixa `#gv-aviso` e o caminho de erro que segura o painel. |
| `src/ferramentas/analise-vendas/tela-de-analise-vendas.vue` (**modificar**) | Idem, e para de apagar `#sa-body` antes de saber se conseguiu. |
| `public/lab-aviso-do-bling.html` (**criar, não versionado**) | Ver a faixa nos quatro casos sem login. `public/lab-*` já está no `.gitignore`. |

As duas guardas de import (`gestao-a-vista/imports.test.mjs` e `analise-vendas/imports.test.mjs`) **já varrem `src/compartilhado/`** — o módulo novo entra na cobertura delas sem alterar nada.

---

### Task 1: O módulo que classifica a falha e escreve o aviso

**Files:**
- Create: `src/compartilhado/chamada-do-bling.js`
- Test: `src/compartilhado/chamada-do-bling.test.mjs`

**Interfaces:**
- Consumes: `SUPABASE_URL`, `SUPABASE_ANON_KEY` de `./conectar-no-banco-de-dados.js`.
- Produces:
  - `class ErroDoBling extends Error` com `.causa` (string) e `.tecnica` (string).
  - `classificarFalhaDoBling(status, corpo) -> 'bling-recusou-token'|'bling-fora'|'sem-acesso-a-vendas'|'sem-resposta'` — `status` é número ou `null` (`null` = a chamada nem voltou).
  - `textoDoAviso(causa, { ehAdmin, horaDoDado, tecnica }) -> { titulo, detalhe }` — `detalhe` pode ser `''`.
  - `chamarBling(sbClient, endpoint, params) -> Promise<objeto>` (lança `ErroDoBling`).
  - `paginasDoBling(sbClient, endpoint, params) -> Promise<Array>` (lança `ErroDoBling`).

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/compartilhado/chamada-do-bling.test.mjs`:

```javascript
import { test } from 'node:test'
import assert from 'node:assert/strict'

// conectar-no-banco-de-dados.js chama window.supabase.createClient() ao carregar
// (no navegador existe, aqui não). Mesmo truque de notificacoes-push.test.mjs.
globalThis.window = { supabase: { createClient: () => ({}) } }
const { classificarFalhaDoBling, textoDoAviso, ErroDoBling } = await import('./chamada-do-bling.js')

test('500 com "Token refresh failed" é o Bling recusando o iamundi', () => {
  const corpo = { error: 'Error: Token refresh failed: {"error":{"type":"FORBIDDEN","message":"Usuário não autorizado"}}' }
  assert.equal(classificarFalhaDoBling(500, corpo), 'bling-recusou-token')
})

test('403 insufficient_scope também é o Bling recusando, não a pessoa', () => {
  const corpo = { error: { type: 'insufficient_scope', description: 'higher privileges' } }
  assert.equal(classificarFalhaDoBling(403, corpo), 'bling-recusou-token')
})

test('403 "sem permissao" do nosso proxy é a PESSOA sem acesso a Vendas', () => {
  assert.equal(classificarFalhaDoBling(403, { error: 'sem permissao' }), 'sem-acesso-a-vendas')
})

test('401 do nosso proxy é a pessoa sem sessão válida', () => {
  assert.equal(classificarFalhaDoBling(401, { error: 'nao autenticado' }), 'sem-acesso-a-vendas')
})

test('500 sem pista de token é o Bling fora', () => {
  assert.equal(classificarFalhaDoBling(500, { error: 'Error: boom' }), 'bling-fora')
})

test('sem status é sem resposta', () => {
  assert.equal(classificarFalhaDoBling(null, null), 'sem-resposta')
})

test('corpo em texto puro não quebra a classificação', () => {
  assert.equal(classificarFalhaDoBling(502, 'Bad Gateway'), 'bling-fora')
})

test('admin lê a causa e o que fazer', () => {
  const { titulo, detalhe } = textoDoAviso('bling-recusou-token', { ehAdmin: true, horaDoDado: '08:15', tecnica: 'Token refresh failed: FORBIDDEN' })
  assert.match(titulo, /Bling recusou o acesso do iamundi/)
  assert.match(detalhe, /reautorizar no Bling/)
  assert.match(detalhe, /08:15/)
  assert.match(detalhe, /Token refresh failed/)
})

test('quem não é admin lê só que o número está velho, sem jargão', () => {
  const { titulo, detalhe } = textoDoAviso('bling-recusou-token', { ehAdmin: false, horaDoDado: '08:15', tecnica: 'Token refresh failed' })
  assert.equal(titulo, 'Números de 08:15 — aguardando o Bling.')
  assert.equal(detalhe, '')
  assert.doesNotMatch(titulo, /token|escopo|permiss/i)
})

test('sem número anterior, o aviso não inventa hora', () => {
  const { titulo } = textoDoAviso('bling-fora', { ehAdmin: false, horaDoDado: null })
  assert.equal(titulo, 'Não foi possível buscar as vendas agora.')
  assert.doesNotMatch(titulo, /\d\d:\d\d/)
})

test('sem conexão fala de conexão, não do Bling', () => {
  const { titulo } = textoDoAviso('sem-resposta', { ehAdmin: false, horaDoDado: '08:15' })
  assert.equal(titulo, 'Números de 08:15 — sem conexão.')
})

test('pessoa sem acesso a Vendas não ouve falar do Bling nem de hora', () => {
  const a = textoDoAviso('sem-acesso-a-vendas', { ehAdmin: false, horaDoDado: '08:15' })
  assert.equal(a.titulo, 'Você não tem acesso a Vendas — fale com quem administra.')
  assert.doesNotMatch(a.titulo, /Bling|08:15/)
  const b = textoDoAviso('sem-acesso-a-vendas', { ehAdmin: true, horaDoDado: '08:15' })
  assert.match(b.titulo, /Este login não tem acesso a Vendas/)
})

test('ErroDoBling carrega causa e detalhe técnico', () => {
  const e = new ErroDoBling('bling-fora', 'boom')
  assert.equal(e.causa, 'bling-fora')
  assert.equal(e.tecnica, 'boom')
  assert.ok(e instanceof Error)
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd ~/iamundi-aviso-bling && node --test src/compartilhado/chamada-do-bling.test.mjs`
Expected: FAIL — `Cannot find module './chamada-do-bling.js'`

- [ ] **Step 3: Escrever o módulo (só o que os testes pedem)**

Criar `src/compartilhado/chamada-do-bling.js`:

```javascript
// A ÚNICA porta do navegador para o Bling — e o único lugar que decide o que
// fazer quando ele não responde.
//
// POR QUE ISTO EXISTE: em 12/08/2026 o Bling passou a recusar o token do iamundi
// (permissão de escopo) e as telas ficaram 17 HORAS mostrando R$ 0,00, sem
// avisar ninguém. O motivo estava numa linha: `blingCall` devolvia `r.json()`
// SEM olhar o status HTTP, e quem chamava lia "sem dado" como "sem venda". Erro
// de rede virava número de dinheiro. E a linha existia DUAS vezes, uma em cada
// tela — consertar uma e esquecer a outra era o resultado mais provável.
//
// Número zero e número ausente são coisas diferentes. Numa tela de dinheiro,
// confundir os dois é pior que quebrar: a tela mente com cara de certeza, e
// manda quem for consertar para o lugar errado.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './conectar-no-banco-de-dados.js'

export class ErroDoBling extends Error {
  constructor(causa, tecnica) {
    super(tecnica || causa)
    this.name = 'ErroDoBling'
    this.causa = causa
    this.tecnica = tecnica || ''
  }
}

// ── Quem barrou: o Bling ou o crachá de quem está olhando? ────────────────
// São dois "sem permissão" bem diferentes, e trocá-los manda a pessoa resolver
// a coisa errada:
//   - 500 "Token refresh failed" → o BLING recusou o iamundi (escopo/token).
//   - 403 insufficient_scope     → idem, dito pelo próprio Bling.
//   - 403 "sem permissao"        → é o nosso proxy dizendo que a PESSOA não tem
//                                  a chave `sales`/`gestor`.
//   - 401 "nao autenticado"      → sessão do navegador não vale.
// `status === null` significa que a chamada não voltou (internet, Supabase).
export function classificarFalhaDoBling(status, corpo) {
  if (status == null) return 'sem-resposta'
  const txt = (typeof corpo === 'string' ? corpo : JSON.stringify(corpo ?? '')).toLowerCase()
  if (txt.includes('token refresh failed')) return 'bling-recusou-token'
  if (txt.includes('insufficient_scope')) return 'bling-recusou-token'
  if (status === 401 || status === 403) return 'sem-acesso-a-vendas'
  return 'bling-fora'
}

// ── O que aparece na faixa ────────────────────────────────────────────────
// Admin lê a causa e o que fazer. Todos os outros — e a TV da loja — leem só
// que o número está velho: sem jargão na frente de cliente, e sem esconder do
// dono o que ele precisa para consertar.
const HORA = (h) => (h ? ` Números de ${h}.` : '')

export function textoDoAviso(causa, { ehAdmin = false, horaDoDado = null, tecnica = '' } = {}) {
  if (causa === 'sem-acesso-a-vendas') {
    // Aqui não se segura número nem se fala do Bling: o problema é o crachá.
    return ehAdmin
      ? { titulo: 'Este login não tem acesso a Vendas.', detalhe: 'Falta a chave `sales` ou `gestor` no perfil.' }
      : { titulo: 'Você não tem acesso a Vendas — fale com quem administra.', detalhe: '' }
  }
  if (!ehAdmin) {
    if (!horaDoDado) return { titulo: 'Não foi possível buscar as vendas agora.', detalhe: '' }
    const fim = causa === 'sem-resposta' ? 'sem conexão' : 'aguardando o Bling'
    return { titulo: `Números de ${horaDoDado} — ${fim}.`, detalhe: '' }
  }
  const curto = String(tecnica || '').slice(0, 120)
  if (causa === 'bling-recusou-token') {
    return {
      titulo: 'O Bling recusou o acesso do iamundi.',
      detalhe: `Token vencido ou escopo sem permissão — precisa reautorizar no Bling.${HORA(horaDoDado)}${curto ? ' · ' + curto : ''}`,
    }
  }
  if (causa === 'sem-resposta') {
    return { titulo: 'Sem resposta.', detalhe: `Pode ser a internet ou o Supabase.${HORA(horaDoDado)}` }
  }
  return { titulo: 'O Bling não respondeu.', detalhe: `Erro no servidor do Bling.${HORA(horaDoDado)}${curto ? ' · ' + curto : ''}` }
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test src/compartilhado/chamada-do-bling.test.mjs`
Expected: PASS — 13 testes.

- [ ] **Step 5: Commitar**

```bash
git add src/compartilhado/chamada-do-bling.js src/compartilhado/chamada-do-bling.test.mjs
git commit -m "Vendas: um lugar so decide o que fazer quando o Bling nao responde"
```

---

### Task 2: A chamada que confere o status (e a paginação que não engole erro)

**Files:**
- Modify: `src/compartilhado/chamada-do-bling.js` (acrescentar ao fim)
- Test: `src/compartilhado/chamada-do-bling.test.mjs` (acrescentar ao fim)

**Interfaces:**
- Consumes: `classificarFalhaDoBling`, `ErroDoBling` (Task 1).
- Produces: `chamarBling(sbClient, endpoint, params)`, `paginasDoBling(sbClient, endpoint, params)`.

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar em `src/compartilhado/chamada-do-bling.test.mjs` (e trocar a linha do import para incluir os dois nomes novos):

```javascript
// ── chamarBling / paginasDoBling ──────────────────────────────────────────
// Um sbClient de mentira (só precisa devolver uma sessão) e um fetch de mentira.
const sbFalso = { auth: { getSession: async () => ({ data: { session: { access_token: 'tk' } } }) } }
const comFetch = async (respostas, fn) => {
  const original = globalThis.fetch
  let i = 0
  globalThis.fetch = async () => {
    const r = respostas[Math.min(i++, respostas.length - 1)]
    if (r instanceof Error) throw r
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.corpo }
  }
  try { return await fn() } finally { globalThis.fetch = original }
}

test('chamarBling devolve o corpo quando dá certo', async () => {
  const r = await comFetch([{ status: 200, corpo: { data: [{ id: 1 }] } }],
    () => chamarBling(sbFalso, 'pedidos/vendas', {}))
  assert.deepEqual(r.data, [{ id: 1 }])
})

test('chamarBling LANÇA em 500, em vez de devolver corpo sem data', async () => {
  await assert.rejects(
    () => comFetch([{ status: 500, corpo: { error: 'Error: Token refresh failed: x' } }],
      () => chamarBling(sbFalso, 'pedidos/vendas', {})),
    (e) => e instanceof ErroDoBling && e.causa === 'bling-recusou-token')
})

test('chamarBling classifica como sem-resposta quando o fetch nem volta', async () => {
  await assert.rejects(
    () => comFetch([new TypeError('Failed to fetch')],
      () => chamarBling(sbFalso, 'pedidos/vendas', {})),
    (e) => e instanceof ErroDoBling && e.causa === 'sem-resposta')
})

test('sem sessão no navegador, é sem-acesso-a-vendas e nem chama o Bling', async () => {
  const semSessao = { auth: { getSession: async () => ({ data: { session: null } }) } }
  await assert.rejects(
    () => chamarBling(semSessao, 'pedidos/vendas', {}),
    (e) => e instanceof ErroDoBling && e.causa === 'sem-acesso-a-vendas')
})

test('paginasDoBling junta as páginas e para na página curta', async () => {
  const cheia = { status: 200, corpo: { data: Array.from({ length: 100 }, (_, k) => ({ id: k })) } }
  const curta = { status: 200, corpo: { data: [{ id: 999 }] } }
  const todos = await comFetch([cheia, curta], () => paginasDoBling(sbFalso, 'pedidos/vendas', {}))
  assert.equal(todos.length, 101)
})

test('lista vazia NÃO é falha — é fim de lista', async () => {
  const todos = await comFetch([{ status: 200, corpo: { data: [] } }],
    () => paginasDoBling(sbFalso, 'pedidos/vendas', {}))
  assert.deepEqual(todos, [])
})

test('paginasDoBling propaga a falha em vez de devolver lista vazia', async () => {
  await assert.rejects(
    () => comFetch([{ status: 500, corpo: { error: 'boom' } }],
      () => paginasDoBling(sbFalso, 'pedidos/vendas', {})),
    (e) => e instanceof ErroDoBling && e.causa === 'bling-fora')
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test src/compartilhado/chamada-do-bling.test.mjs`
Expected: FAIL — `chamarBling is not defined` / `paginasDoBling is not defined`

- [ ] **Step 3: Implementar**

Acrescentar ao fim de `src/compartilhado/chamada-do-bling.js`:

```javascript
// ── A chamada ─────────────────────────────────────────────────────────────
// A diferença que importa em relação ao código antigo é UMA linha: conferir
// `r.ok` antes de interpretar o corpo. O resto é o mesmo.
export async function chamarBling(sbClient, endpoint, params) {
  const { data: { session } } = await sbClient.auth.getSession()
  if (!session) throw new ErroDoBling('sem-acesso-a-vendas', 'sem sessão no navegador')
  let r
  try {
    r = await fetch(SUPABASE_URL + '/functions/v1/bling-proxy', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + session.access_token,
        'apikey': SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ endpoint, params }),
    })
  } catch (e) {
    throw new ErroDoBling('sem-resposta', e?.message || 'fetch falhou')
  }
  let corpo = null
  try { corpo = await r.json() } catch { corpo = null }
  if (!r.ok) {
    const causa = classificarFalhaDoBling(r.status, corpo)
    const tecnica = typeof corpo?.error === 'string' ? corpo.error : JSON.stringify(corpo?.error ?? corpo ?? '')
    throw new ErroDoBling(causa, `${r.status} ${tecnica}`)
  }
  return corpo ?? {}
}

// ── A paginação ───────────────────────────────────────────────────────────
// Página vazia continua sendo "fim da lista" — isso é legítimo e é o caso do
// dia sem venda. O que mudou: a FALHA não passa mais por vazio, ela sobe.
// (O código antigo tentava 3 vezes por página e desistia devolvendo [], o que
// transformava um Bling fora do ar em "não vendeu nada".)
export async function paginasDoBling(sbClient, endpoint, params) {
  const todos = []
  for (let pagina = 1; pagina <= 10; pagina++) {
    const resp = await chamarBling(sbClient, endpoint, { ...params, pagina, limite: 100 })
    const itens = Array.isArray(resp?.data) ? resp.data : []
    if (!itens.length) break
    todos.push(...itens)
    if (itens.length < 100) break
  }
  return todos
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test src/compartilhado/chamada-do-bling.test.mjs`
Expected: PASS — 20 testes.

- [ ] **Step 5: Commitar**

```bash
git add src/compartilhado/chamada-do-bling.js src/compartilhado/chamada-do-bling.test.mjs
git commit -m "Vendas: a chamada ao Bling confere o status antes de acreditar no corpo"
```

---

### Task 3: Gestão à Vista — a faixa, e o painel que não é apagado

**Files:**
- Modify: `src/ferramentas/gestao-a-vista/tela-de-gestao-a-vista.vue`
  - Import junto dos outros (perto de `:69` no bloco de imports)
  - Trocar `blingCall`/`blingPages` (`:184-215`)
  - Template: acrescentar a faixa antes de `#gv-board`
  - `loadGestaoVistaData` (`:589-724`): caminho de erro + rearmar o timer
  - CSS: classe `.gv-aviso`
- Test: `src/ferramentas/gestao-a-vista/imports.test.mjs` (já existe, só rodar)

**Interfaces:**
- Consumes: `chamarBling`, `paginasDoBling`, `ErroDoBling`, `textoDoAviso` (Tasks 1–2); `estado` de `controle-de-login-e-usuario.js` (já importado na tela — tem `role` e `is_superadmin`).
- Produces: nada para tarefas seguintes.

- [ ] **Step 1: Trocar as duas funções locais por atalhos para o módulo**

Substituir o corpo inteiro de `blingCall` e `blingPages` (`:184-215`) por:

```javascript
// A chamada e a paginação moram em src/compartilhado/chamada-do-bling.js — o
// mesmo módulo que a Análise de Vendas usa. Aqui ficam só atalhos com o
// sbClient já preso, para as ~6 chamadas desta tela não repetirem o argumento.
const blingCall=(endpoint,params)=>chamarBling(sbClient,endpoint,params);
const blingPages=(endpoint,params)=>paginasDoBling(sbClient,endpoint,params);
```

E acrescentar ao bloco de imports:

```javascript
import { chamarBling, paginasDoBling, ErroDoBling, textoDoAviso } from '../../compartilhado/chamada-do-bling.js'
```

- [ ] **Step 2: Acrescentar a faixa no template, antes de `#gv-board`**

```html
<div id="gv-aviso" class="gv-aviso" hidden>
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <path d="M12 3 2 20h20L12 3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
    <path d="M12 9v5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <circle cx="12" cy="17.2" r="1.1" fill="currentColor"/>
  </svg>
  <div><strong id="gv-aviso-titulo"></strong><span id="gv-aviso-detalhe"></span></div>
</div>
```

(SVG, não emoji — regra do dono.)

- [ ] **Step 3: Acrescentar as duas funções da faixa, logo antes de `loadGestaoVistaData`**

```javascript
// ── A faixa de aviso ──────────────────────────────────────────────────────
// Ela NÃO apaga o painel: o telão fica numa TV, e tela em branco é pior que
// número de cinco minutos atrás — desde que esteja rotulado com a hora.
function ehAdminGv(){ return estado.role==='admin'||estado.is_superadmin===true; }
function horaDoDadoGv(){
  if(!_gvLastLoadTime)return null;
  const p=n=>String(n).padStart(2,'0');
  return `${p(_gvLastLoadTime.getHours())}:${p(_gvLastLoadTime.getMinutes())}`;
}
function mostrarAvisoGv(causa,tecnica){
  const el=document.getElementById('gv-aviso');
  if(!el)return;
  const {titulo,detalhe}=textoDoAviso(causa,{ehAdmin:ehAdminGv(),horaDoDado:horaDoDadoGv(),tecnica});
  document.getElementById('gv-aviso-titulo').textContent=titulo;
  document.getElementById('gv-aviso-detalhe').textContent=detalhe?' '+detalhe:'';
  el.hidden=false;
}
function esconderAvisoGv(){
  const el=document.getElementById('gv-aviso');
  if(el)el.hidden=true;
}
```

- [ ] **Step 4: Ligar no caminho de erro, e rearmar a recarga**

No começo do `try` de `loadGestaoVistaData` (antes da primeira chamada ao Bling), acrescentar `esconderAvisoGv();`.

Trocar o `catch` (`:721-724`) por:

```javascript
  }catch(e){
    if(myLoad!==_gvLoadId)return;
    const causa=e instanceof ErroDoBling?e.causa:'bling-fora';
    mostrarAvisoGv(causa,e?.tecnica||e?.message||'');
    // Painel com número bom: fica como está, só rotulado pela faixa. Sem
    // número anterior (primeira carga), o recado ocupa o lugar — nunca R$ 0,00.
    if(!_gvLastLoadTime){
      board.innerHTML=`<div class="gv-loading-full">${escHtml(document.getElementById('gv-aviso-titulo')?.textContent||'Não foi possível buscar as vendas agora.')}</div>`;
    }
    // A recarga de 5 min é armada dentro do try, então uma falha na PRIMEIRA
    // carga deixava o telão sem tentar de novo para sempre. Arma aqui também.
    if(!window._gvTimer)window._gvTimer=setInterval(()=>loadGestaoVistaData(_gvCurrentPeriod),5*60*1000);
  }
```

- [ ] **Step 5: CSS da faixa, junto das outras regras `.tela-gestao-a-vista`**

```css
.tela-gestao-a-vista :deep(.gv-aviso){grid-column:1/-1;display:flex;align-items:center;gap:10px;padding:10px 14px;margin-bottom:10px;border:1px solid #b4541f;border-left-width:4px;border-radius:6px;background:rgba(180,84,31,.12);color:var(--text);font-family:var(--fonte-principal);font-size:max(11px, calc(13px * var(--escala-texto, 1)));line-height:1.35;}
.tela-gestao-a-vista :deep(.gv-aviso[hidden]){display:none;}
.tela-gestao-a-vista :deep(.gv-aviso strong){letter-spacing:.5px;}
.tela-gestao-a-vista :deep(.gv-aviso span){color:var(--muted);}
```

- [ ] **Step 6: Rodar a guarda de import e o build**

Run: `node --test src/ferramentas/gestao-a-vista/imports.test.mjs && npm run build`
Expected: PASS na guarda e build sem erro. (A guarda pega justamente o caso de usar `textoDoAviso` sem importar — o defeito que já derrubou quatro telas neste repo.)

- [ ] **Step 7: Provar que a guarda está viva**

Remover de propósito `textoDoAviso` da linha de import, rodar `node --test src/ferramentas/gestao-a-vista/imports.test.mjs`, confirmar que **FALHA**, e devolver o import.

- [ ] **Step 8: Commitar**

```bash
git add src/ferramentas/gestao-a-vista/tela-de-gestao-a-vista.vue
git commit -m "Gestao a Vista: faixa de aviso quando o Bling nao responde, sem apagar o painel"
```

---

### Task 4: Análise de Vendas — só apaga quando o dado chega

**Files:**
- Modify: `src/ferramentas/analise-vendas/tela-de-analise-vendas.vue`
  - Import (bloco perto de `:69`)
  - Trocar `blingCall`/`blingPages` (`:144-175`)
  - Template: faixa antes de `#sa-body`
  - `loadSalesAnalysisData`: abertura (`:300-308`) e `catch` (`:466-469`)
  - CSS: `.sa-aviso`
- Test: `src/ferramentas/analise-vendas/imports.test.mjs` (já existe)

**Interfaces:**
- Consumes: `chamarBling`, `paginasDoBling`, `ErroDoBling`, `textoDoAviso` (Tasks 1–2); `window._saRawData` (a tela já usa como "o que está renderizado", `:440`); `window._saLastUpdateTime` (`:441`).
- Produces: nada.

- [ ] **Step 1: Trocar as duas funções locais**

Substituir `blingCall` e `blingPages` (`:144-175`) por:

```javascript
// Mesma porta da Gestão à Vista: src/compartilhado/chamada-do-bling.js.
const blingCall=(endpoint,params)=>chamarBling(sbClient,endpoint,params);
const blingPages=(endpoint,params)=>paginasDoBling(sbClient,endpoint,params);
```

E no bloco de imports:

```javascript
import { chamarBling, paginasDoBling, ErroDoBling, textoDoAviso } from '../../compartilhado/chamada-do-bling.js'
```

- [ ] **Step 2: Faixa no template, antes de `#sa-body`**

```html
<div id="sa-aviso" class="sa-aviso" hidden>
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <path d="M12 3 2 20h20L12 3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
    <path d="M12 9v5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <circle cx="12" cy="17.2" r="1.1" fill="currentColor"/>
  </svg>
  <div><strong id="sa-aviso-titulo"></strong><span id="sa-aviso-detalhe"></span></div>
</div>
```

- [ ] **Step 3: As funções da faixa, antes de `loadSalesAnalysisData`**

```javascript
function ehAdminSa(){ return estado.role==='admin'||estado.is_superadmin===true; }
function horaDoDadoSa(){
  const l=window._saLastUpdateTime;
  if(!l)return null;
  const p=n=>String(n).padStart(2,'0');
  return `${p(l.getHours())}:${p(l.getMinutes())}`;
}
function mostrarAvisoSa(causa,tecnica){
  const el=document.getElementById('sa-aviso');
  if(!el)return;
  const {titulo,detalhe}=textoDoAviso(causa,{ehAdmin:ehAdminSa(),horaDoDado:horaDoDadoSa(),tecnica});
  document.getElementById('sa-aviso-titulo').textContent=titulo;
  document.getElementById('sa-aviso-detalhe').textContent=detalhe?' '+detalhe:'';
  el.hidden=false;
}
function esconderAvisoSa(){
  const el=document.getElementById('sa-aviso');
  if(el)el.hidden=true;
}
```

- [ ] **Step 4: Parar de apagar o corpo antes de saber se conseguiu**

Trocar a abertura de `loadSalesAnalysisData` (`:301-308`) por:

```javascript
  const body=document.getElementById('sa-body');
  esconderAvisoSa();
  // A cada 5 minutos esta tela se recarrega. Antes ela zerava o corpo aqui, no
  // começo — então uma falha deixava a tela vazia, sem nada para voltar. Agora
  // o conteúdo antigo fica até o dado novo chegar; quem limpa é o render.
  const jaTemConteudo=!!window._saRawData;
  if(!jaTemConteudo){
    body.textContent='';
    const loading=document.createElement('div');loading.className='sa-loading';
    const spin=document.createElement('div');spin.className='gv-spinner';
    const lbl=document.createElement('span');lbl.className='sa-loading-lbl';lbl.textContent='Carregando dados';
    loading.appendChild(spin);loading.appendChild(lbl);
    body.appendChild(loading);
  }
```

- [ ] **Step 5: Caminho de erro que segura o que estava, e rearma a recarga**

Trocar o `catch` (`:466-469`) por:

```javascript
  }catch(e){
    const causa=e instanceof ErroDoBling?e.causa:'bling-fora';
    mostrarAvisoSa(causa,e?.tecnica||e?.message||'');
    // Com conteúdo renderizado, ele fica — a faixa diz de que hora é. Sem nada
    // (primeira carga), o recado ocupa o lugar, nunca um gráfico zerado.
    if(!window._saRawData){
      body.textContent='';
      const err=document.createElement('div');err.className='sa-loading';
      err.textContent=document.getElementById('sa-aviso-titulo')?.textContent||'Não foi possível buscar as vendas agora.';
      body.appendChild(err);
    }
    // A recarga de 5 min é armada dentro do try: sem isto, falhar na primeira
    // carga deixava a tela sem tentar de novo.
    if(!window._saRefreshTimer)window._saRefreshTimer=setInterval(()=>loadSalesAnalysisData(window._saCurrentPeriod||'sofar'),5*60*1000);
  }
```

- [ ] **Step 6: Conferir que o render limpa o corpo**

Ler `renderSalesAnalysis` e confirmar que ela zera `#sa-body` antes de montar. Se **não** zerar, acrescentar `body.textContent='';` imediatamente antes da chamada `renderSalesAnalysis(window._saRawData,initialIds);` (`:461`) — senão o conteúdo novo se acumula embaixo do antigo.

- [ ] **Step 7: CSS da faixa**

```css
.tela-analise-vendas :deep(.sa-aviso){display:flex;align-items:center;gap:10px;padding:10px 14px;margin:0 0 10px;border:1px solid #b4541f;border-left-width:4px;border-radius:6px;background:rgba(180,84,31,.12);color:var(--text);font-family:var(--fonte-principal);font-size:max(11px, calc(13px * var(--escala-texto, 1)));line-height:1.35;}
.tela-analise-vendas :deep(.sa-aviso[hidden]){display:none;}
.tela-analise-vendas :deep(.sa-aviso span){color:var(--muted);}
```

- [ ] **Step 8: Rodar guarda, testes e build**

Run: `node --test src/ferramentas/analise-vendas/imports.test.mjs && npm run build`
Expected: PASS e build limpo.

- [ ] **Step 9: Commitar**

```bash
git add src/ferramentas/analise-vendas/tela-de-analise-vendas.vue
git commit -m "Analise de Vendas: segura o grafico anterior e avisa quando o Bling nao responde"
```

---

### Task 5: Ver a faixa nos quatro casos, sem login

**Files:**
- Create: `public/lab-aviso-do-bling.html` (não versionado — `public/lab-*` está no `.gitignore`)

**Interfaces:**
- Consumes: `textoDoAviso` (Task 1), copiado por `<script type="module">` a partir do arquivo real via import relativo.
- Produces: prints para o dono aprovar.

- [ ] **Step 1: Criar o laboratório**

`public/lab-aviso-do-bling.html` — importa o módulo real (sem tocar em Supabase, porque `textoDoAviso` é função pura) e desenha a faixa nos quatro casos, nas duas versões (admin e não-admin):

```html
<meta charset="utf-8"><title>Faixa de aviso do Bling</title>
<style>
  body{background:#12100e;color:#efe9e2;font:14px/1.4 system-ui;padding:24px}
  h2{font-size:13px;letter-spacing:2px;text-transform:uppercase;color:#9c918a;margin:22px 0 8px}
  .gv-aviso{display:flex;align-items:center;gap:10px;padding:10px 14px;margin-bottom:10px;border:1px solid #b4541f;border-left-width:4px;border-radius:6px;background:rgba(180,84,31,.12)}
  .gv-aviso span{color:#9c918a}
</style>
<div id="alvo"></div>
<script type="module">
  import { textoDoAviso } from '/src/compartilhado/chamada-do-bling.js'
  const CAUSAS=['bling-recusou-token','bling-fora','sem-resposta','sem-acesso-a-vendas']
  const SVG='<svg viewBox="0 0 24 24" width="18" height="18"><path d="M12 3 2 20h20L12 3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M12 9v5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="17.2" r="1.1" fill="currentColor"/></svg>'
  const alvo=document.getElementById('alvo')
  for(const ehAdmin of [true,false]){
    alvo.insertAdjacentHTML('beforeend',`<h2>${ehAdmin?'Quem é admin':'Vendedora e TV da loja'}</h2>`)
    for(const causa of CAUSAS){
      const {titulo,detalhe}=textoDoAviso(causa,{ehAdmin,horaDoDado:'08:15',tecnica:'500 Error: Token refresh failed: {"type":"FORBIDDEN"}'})
      alvo.insertAdjacentHTML('beforeend',`<div class="gv-aviso">${SVG}<div><strong>${titulo}</strong><span> ${detalhe}</span></div></div>`)
    }
    alvo.insertAdjacentHTML('beforeend',`<h2>${ehAdmin?'Admin':'Outros'} — primeira carga (sem número anterior)</h2>`)
    const {titulo}=textoDoAviso('bling-recusou-token',{ehAdmin,horaDoDado:null,tecnica:'500 boom'})
    alvo.insertAdjacentHTML('beforeend',`<div class="gv-aviso">${SVG}<div><strong>${titulo}</strong></div></div>`)
  }
</script>
```

- [ ] **Step 2: Subir o dev server numa porta própria**

Run: `npm run dev -- --port 5199 --strictPort`
(Porta própria e `--strictPort`: outras janelas podem estar com dev server no ar, e nunca matar processo alheio.)

- [ ] **Step 3: Olhar e mandar o print**

Abrir `http://localhost:5199/lab-aviso-do-bling.html`, tirar print e mandar para o dono. Conferir na leitura: nenhum emoji, nenhum jargão na versão de vendedora, hora aparecendo, e a versão de admin dizendo o que fazer.

- [ ] **Step 4: Rodar a bateria toda antes de encerrar**

Run: `node --test src/**/*.test.mjs coletor/**/*.test.mjs && npm run build`
Expected: tudo verde e build limpo. Nenhum teste que existia antes pode ter mudado de resultado.

- [ ] **Step 5: Derrubar o dev server**

Encerrar apenas o processo da porta 5199, o que esta sessão subiu.

---

## Auto-revisão do plano

**Cobertura da spec.** D1 → Tasks 1–2 (módulo único, quatro causas, paginação que não engole erro). D2 → Task 3 Step 4 e Task 4 Step 5 (segura o número; primeira carga mostra recado). D3 → Task 4 Step 4. D4 → Task 1 Step 3 (`textoDoAviso`, dois textos) + os testes de "sem jargão". D5 → não tocar em `_gvLastLoadTime`/`_saLastUpdateTime` no caminho de erro (Task 3 Step 4, Task 4 Step 5 — os dois só leem). B1 → Task 2 (`r.ok`). B2 → Tasks 3 e 4 apagam as cópias. B3 → Task 4 Step 4. Provas → Task 5. **Sem lacuna.**

**Achado durante o plano, que a spec não previa:** a recarga automática de 5 minutos é armada **dentro** do `try` nas duas telas (`gestao-a-vista:715`, `analise-vendas:446`). Uma falha na primeira carga deixava a tela sem nunca tentar de novo — exatamente o que aconteceria com alguém que abrisse o telão durante o apagão de ontem. Consertado em Task 3 Step 4 e Task 4 Step 5.

**Nomes conferidos entre tarefas:** `ErroDoBling.causa` / `.tecnica`, `classificarFalhaDoBling(status, corpo)`, `textoDoAviso(causa, {ehAdmin, horaDoDado, tecnica})`, `chamarBling(sbClient, endpoint, params)`, `paginasDoBling(sbClient, endpoint, params)` — usados com a mesma assinatura em todas as tarefas e no laboratório.

**Fora do escopo, confirmado:** Edge `bling-proxy`, robôs, push, e o filtro de canais de `b638920`.
