# Comercial Vessel completo — plano de execução

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tirar as cinco ferramentas do Comercial Vessel da pobreza — voltar página a página, largura da tela toda, editar/apagar/arquivar, filtros, cadastro de stylists, lista de convidadas e a porta do Appointment Card.

**Architecture:** O banco ganha uma trava de *editar* que hoje não existe, e depois as funções de mexer, cada uma com trava e grant na mesma migration. A tela ganha dois módulos puros e testáveis (`navegacao.js` e `filtros.js`) e um componente de barra usado pelas três telas. As telas são a última camada, porque elas só amarram o que já foi provado embaixo.

**Tech Stack:** Vue 3 + vue-router, Vite, Supabase/PostgREST, `node --test` (`npm test`), `pg` nos aplicadores de migration.

**Spec:** `docs/superpowers/specs/2026-09-19-comercial-vessel-completo-design.md`

## Global Constraints

- **Nenhuma chave de permissão nova.** Tudo continua atrás de `atendimentos` e `carrinho`. Uma chave nova nasceria desmarcada e tiraria o acesso de quem já trabalha com isso no dia da entrega.
- **Ver usa `is_vessel_atendimentos()`; mexer usa `is_vessel_atendimentos_editar()`** (criada na Tarefa 3). Nunca o contrário, nunca só um.
- **Toda função nova de banco sai com a trava E o grant na MESMA migration:** `security definer`, `set search_path to 'public'`, a trava conferida por dentro, e depois `revoke all ... from public, anon, authenticated;` seguido de `grant execute ... to authenticated;`. ⚠️ `revoke ... from public` **não** fecha `authenticated` — as duas linhas são obrigatórias.
- **Toda migration tem um aplicador `coletor/aplicar-<nome>.mjs`** que aplica, registra em `schema_migrations` e prova, tudo numa transação, com `savepoint`/`rollback to savepoint` para desfazer o dado de prova. Molde: `coletor/aplicar-vessel-private-edit-pela-tela.mjs`.
- **NUNCA mandar o runner aplicar as migrations pendentes.** As migrations deste repositório não estão todas registradas; aplicar "as pendentes" rodaria coisa antiga. Cada migration é aplicada pelo seu próprio aplicador, e só por ele.
- **Só token de cor, nunca hex.** As cores mudam sozinhas entre o tema claro e o escuro.
- **Toda taxa viaja com o denominador**, base zero não é 0%, margem por Wilson, taxa de conjunto soma numeradores e denominadores. As funções de `estatistica.js` já fazem isso — usar, não reescrever.
- **Provas de tela a 375px e 1920px, claro e escuro**, com foto. ⚠️ **ZERO escrita saindo para a produção** nas provas de tela.
- `npm test` verde antes de cada commit.

## O molde do aplicador de migration

As Tarefas 3 a 8 criam, cada uma, um `coletor/aplicar-<nome>.mjs`. **Todas usam
este esqueleto**, trocando só `ARQUIVO` e o miolo das provas. Ele está aqui, uma
vez, para nenhuma tarefa depender de ler outra:

```js
// APLICA, REGISTRA e PROVA <o que é>.
// ⚠️ As provas escrevem dado de verdade e sao desfeitas antes do commit.
import './lib/carregar-env.mjs'
import { readFileSync } from 'node:fs'
import pg from 'pg'

const ARQUIVO = '<o nome do .sql>'

const sql = readFileSync(new URL(`../db/migrations/${ARQUIVO}`, import.meta.url), 'utf8')
const cli = new pg.Client({ connectionString: process.env.DATABASE_URL })
await cli.connect()
await cli.query('begin')
try {
  await cli.query(sql)
  await cli.query(
    `insert into public.schema_migrations (name, observacao) values ($1,$2)
     on conflict (name) do nothing`,
    [ARQUIVO, `Aplicada e registrada na mesma transacao por coletor/aplicar-<nome>.mjs`])

  const uma = async (s, a = []) => (await cli.query(s, a)).rows[0]
  const porta = async (f) => (await cli.query(
    `select has_function_privilege('anon',$1,'EXECUTE') as anon,
            has_function_privilege('authenticated',$1,'EXECUTE') as autenticado,
            has_function_privilege('public',$1,'EXECUTE') as qualquer_um`, [f])).rows[0]

  // ——— AS PROVAS DESTA MIGRATION ENTRAM AQUI ———

  await cli.query('commit')
  console.log('✅ aplicada, registrada e provada:', ARQUIVO)
} catch (e) {
  await cli.query('rollback')
  console.error('❌ nao aplicada:', e.message)
  process.exitCode = 1
} finally { await cli.end() }
```

⚠️ **Prova que escreve dado vai entre `savepoint prova` e `rollback to savepoint
prova`**, antes do `commit`. O que fica gravado é a migration, nunca o dado de
teste.

⚠️ **Se o console disser "aplicada" e nada tiver entrado, conferir o `.command`
do resultado**: um `COMMIT` depois de erro vira `ROLLBACK` calado, e o script
anuncia sucesso.

⚠️ **NUNCA rodar o runner de migrations pendentes.** Cada migration é aplicada
pelo seu próprio aplicador, e só por ele.

---

### Task 1: O voltar, página a página

**Files:**
- Create: `src/ferramentas/comercial-vessel/navegacao.js`
- Create: `src/ferramentas/comercial-vessel/navegacao.test.mjs`
- Modify: `src/ferramentas/atendimentos/tela-de-atendimentos.vue:3-4,179`
- Modify: `src/ferramentas/beauty-sessions/tela-de-beauty-sessions.vue:3-4,216`
- Modify: `src/ferramentas/funil-carrinho/*.vue:4,107`

**Interfaces:**
- Produces: `PAI_DA_TELA` (objeto `nome da rota → nome da rota do pai`), `paiDaTela(nome)` (devolve string), `ROTULO_DO_PAI` (objeto `nome da rota do pai → rótulo`).

- [ ] **Step 1: Write the failing test**

Criar `src/ferramentas/comercial-vessel/navegacao.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PAI_DA_TELA, paiDaTela, ROTULO_DO_PAI } from './navegacao.js'

test('as cinco telas da familia voltam para o menu do Comercial Vessel', () => {
  for (const tela of ['atendimentos', 'beauty-sessions', 'private-edit',
                      'stylist-circle', 'funil-carrinho']) {
    assert.equal(paiDaTela(tela), 'comercial-vessel', `${tela} volta para o lugar errado`)
  }
})

test('o menu da familia volta para a Central', () => {
  assert.equal(paiDaTela('comercial-vessel'), 'inicio')
})

test('tela que nao esta no mapa volta para a Central', () => {
  assert.equal(paiDaTela('nao-existe'), 'inicio')
})

test('todo pai tem rotulo escrito', () => {
  for (const pai of new Set(Object.values(PAI_DA_TELA))) {
    assert.ok(ROTULO_DO_PAI[pai], `falta o rotulo de ${pai}`)
  }
})

// ⚠️ A GUARDA: o defeito nao era o mapa, era a tela chamando `inicio` na mao.
// Um mapa certo com as telas ignorando ele nao conserta nada.
const TELAS = [
  'src/ferramentas/atendimentos/tela-de-atendimentos.vue',
  'src/ferramentas/beauty-sessions/tela-de-beauty-sessions.vue',
  'src/ferramentas/comercial-vessel/tela-de-private-edit.vue',
  'src/ferramentas/comercial-vessel/tela-de-stylist-circle.vue',
]

test('nenhuma tela da familia empurra para inicio na mao', () => {
  for (const caminho of TELAS) {
    const fonte = readFileSync(new URL(`../../../${caminho}`, import.meta.url), 'utf8')
    assert.ok(!/router\.push\(\s*\{\s*name:\s*'inicio'\s*\}\s*\)/.test(fonte),
      `${caminho} ainda empurra para inicio na mao`)
  }
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/ferramentas/comercial-vessel/navegacao.test.mjs`
Expected: FAIL — `Cannot find module './navegacao.js'`

- [ ] **Step 3: Write minimal implementation**

Criar `src/ferramentas/comercial-vessel/navegacao.js`:

```js
/* ONDE CADA TELA MORA — o "voltar" página a página.
 *
 * Pedido do dono em 19/09/2026: "umas voltam direto pra central, outras voltam
 * pras ferramentas do comercial, sendo que é pra voltar página a página".
 *
 * ⚠️ É O PAI, NÃO O HISTÓRICO. Quem abre por link salvo cai direto na tela sem
 * passar pelo menu. Voltar ao lugar onde a tela MORA é o certo; voltar ao
 * histórico levaria a pessoa a uma Central que ela nunca viu nesta sessão.
 *
 * ⚠️ NENHUM ENDEREÇO MUDA. Isto é só para onde o botão aponta.
 */
export const PAI_DA_TELA = {
  'atendimentos': 'comercial-vessel',
  'beauty-sessions': 'comercial-vessel',
  'private-edit': 'comercial-vessel',
  'stylist-circle': 'comercial-vessel',
  'funil-carrinho': 'comercial-vessel',
  'comercial-vessel': 'inicio',
}

export const ROTULO_DO_PAI = {
  'comercial-vessel': 'Comercial Vessel',
  'inicio': 'Central',
}

// Tela fora do mapa volta para a Central: é o fundo do poço, sempre existe.
export function paiDaTela(nome) {
  return PAI_DA_TELA[nome] || 'inicio'
}
```

- [ ] **Step 4: Run test to verify the mapa passes and the guarda still fails**

Run: `node --test src/ferramentas/comercial-vessel/navegacao.test.mjs`
Expected: os quatro primeiros PASS; "nenhuma tela da familia empurra para inicio na mao" FAIL (as telas ainda não foram mexidas).

- [ ] **Step 5: Point the three old screens at the parent**

Em `src/ferramentas/atendimentos/tela-de-atendimentos.vue`, trocar a linha 3 e a função `voltar` (linha 179):

```vue
    <barra-de-topo :voltar="ROTULO_DO_PAI[paiDaTela('atendimentos')]"
                   titulo="Vessel — Private Appointment"
                   :subtitulo="subtitulo" @voltar="voltar" />
```

```js
import { paiDaTela, ROTULO_DO_PAI } from '../comercial-vessel/navegacao.js'
function voltar() { router.push({ name: paiDaTela('atendimentos') }) }
```

Repetir, com o nome da própria rota em cada uma:
- `src/ferramentas/beauty-sessions/tela-de-beauty-sessions.vue` → `paiDaTela('beauty-sessions')`, título `Vessel — Beauty Sessions`
- `src/ferramentas/funil-carrinho/<a tela>.vue` → `paiDaTela('funil-carrinho')`, título `Funil de Carrinho`
- `src/ferramentas/comercial-vessel/tela-de-private-edit.vue` → `paiDaTela('private-edit')`
- `src/ferramentas/comercial-vessel/tela-de-stylist-circle.vue` → `paiDaTela('stylist-circle')`
- `src/ferramentas/comercial-vessel/tela-de-menu-comercial-vessel.vue` → `paiDaTela('comercial-vessel')`

⚠️ O funil de carrinho tem `const voltar = () => ...` (arrow), não `function voltar()`. Manter a forma que já está no arquivo.

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: PASS, inclusive a guarda.

- [ ] **Step 7: Prove it in the browser**

Subir com `npm run dev`, entrar logado, e para cada uma das seis telas: abrir **pelo endereço direto** (sem passar pelo menu), clicar o voltar e conferir onde cai. As cinco ferramentas caem no menu Comercial Vessel; o menu cai na Central.

- [ ] **Step 8: Commit**

```bash
git add src/ferramentas/comercial-vessel/navegacao.js \
        src/ferramentas/comercial-vessel/navegacao.test.mjs \
        src/ferramentas/atendimentos/tela-de-atendimentos.vue \
        src/ferramentas/beauty-sessions/tela-de-beauty-sessions.vue \
        src/ferramentas/funil-carrinho/ \
        src/ferramentas/comercial-vessel/tela-de-private-edit.vue \
        src/ferramentas/comercial-vessel/tela-de-stylist-circle.vue \
        src/ferramentas/comercial-vessel/tela-de-menu-comercial-vessel.vue
git commit -m "Comercial Vessel: o voltar leva ao lugar onde a tela mora"
```

---

### Task 2: A largura, nas seis telas da família

**Files:**
- Modify: `src/ferramentas/comercial-vessel/estilo-comercial.css` (acrescentar `.cv-largo`)
- Modify: `src/ferramentas/comercial-vessel/tela-de-menu-comercial-vessel.vue:97` (tirar o `max-width: 62rem`)
- Modify: as seis telas (trocar `container-app` por `cv-largo`)
- Create: `src/ferramentas/comercial-vessel/largura.test.mjs`

**Interfaces:**
- Consumes: nada.
- Produces: a classe CSS `.cv-largo`, usada pelas seis telas.

- [ ] **Step 1: Write the failing test**

Criar `src/ferramentas/comercial-vessel/largura.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const raiz = new URL('../../../', import.meta.url)
const ler = (c) => readFileSync(new URL(c, raiz), 'utf8')

const TELAS = [
  'src/ferramentas/comercial-vessel/tela-de-menu-comercial-vessel.vue',
  'src/ferramentas/comercial-vessel/tela-de-private-edit.vue',
  'src/ferramentas/comercial-vessel/tela-de-stylist-circle.vue',
  'src/ferramentas/atendimentos/tela-de-atendimentos.vue',
  'src/ferramentas/beauty-sessions/tela-de-beauty-sessions.vue',
]

test('nenhuma tela da familia usa o container estreito', () => {
  for (const c of TELAS) {
    assert.ok(!ler(c).includes('container-app'),
      `${c} ainda usa .container-app, que trava em 1280px`)
  }
})

test('o menu nao prende os cards em 62rem', () => {
  const fonte = ler('src/ferramentas/comercial-vessel/tela-de-menu-comercial-vessel.vue')
  assert.ok(!/max-width:\s*62rem/.test(fonte), 'o menu ainda tem a trava de 62rem')
})

test('a folha da familia define .cv-largo com respiro que cresce', () => {
  const css = ler('src/ferramentas/comercial-vessel/estilo-comercial.css')
  assert.ok(css.includes('.cv-largo'), 'falta a classe .cv-largo')
  assert.ok(/padding-inline:\s*clamp\(/.test(css),
    'o respiro lateral tem de crescer com a tela, com clamp')
  assert.ok(/clamp\(\s*16px/.test(css),
    'no celular o respiro tem de descer a 16px, que e o --gutter de hoje')
})

// ⚠️ SO TOKEN, NUNCA HEX — item 2 do PADRAO-DA-CENTRAL.
test('a folha da familia nao ganhou hex novo', () => {
  const css = ler('src/ferramentas/comercial-vessel/estilo-comercial.css')
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(css), 'entrou hex na folha do Comercial Vessel')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/ferramentas/comercial-vessel/largura.test.mjs`
Expected: FAIL — "ainda usa .container-app" e "falta a classe .cv-largo".

- [ ] **Step 3: Add the wide container to the family stylesheet**

No fim de `src/ferramentas/comercial-vessel/estilo-comercial.css`:

```css
/* A LARGURA DA FAMÍLIA — pedido do dono em 19/09/2026: "entrando nas
 * ferramentas de comercial vessel elas n pegam a lateral toda da tela".
 *
 * ⚠️ NÃO É `--container-max`. Aquele é global e mudá-lo reflete em TODA a
 * Central no mesmo instante. A largura do resto da Central é a entrega 2,
 * com varredura tela por tela a 1920px.
 *
 * ⚠️ O CELULAR NÃO MUDA: o clamp desce a 16px, que é o --gutter de hoje.
 */
.cv-largo {
  width: 100%;
  padding-inline: clamp(16px, 2.4vw, 40px);
}
```

- [ ] **Step 4: Swap the container in the six screens**

Em cada uma das seis telas, trocar `class="container-app ..."` por `class="cv-largo ..."`.

⚠️ Private Appointment e Beauty Sessions **não importam** `estilo-comercial.css` hoje. Acrescentar dentro do `<style scoped>` de cada uma:

```css
@import '../comercial-vessel/estilo-comercial.css';
```

No menu (`tela-de-menu-comercial-vessel.vue`), trocar o bloco `.cvmenu-body` e a grade:

```css
.cvmenu-body {
  width: 100%;
  padding: var(--sp-5) clamp(16px, 2.4vw, 40px) var(--sp-6);
}

.cvmenu-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: var(--sp-3);
}
```

⚠️ Tirar o `max-width: 62rem` e o `margin: 0 auto`. ⚠️ Conferir se sobrou a regra `@media` que faz os cards virarem uma coluna no celular — `auto-fill` com `minmax(280px, 1fr)` já faz isso sozinho abaixo de ~312px de área útil, mas a regra antiga, se ficar, ganha da grade nova.

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Prove it with photos**

⚠️ **Chrome headless trava nesta máquina.** Usar o módulo `playwright` por node, com `channel: 'chrome'`.

Fotografar as seis telas a **375px** e **1920px**, em **claro** e **escuro** — 24 fotos. Conferir em cada uma: nada cortado, sem rolagem lateral, o conteúdo chegando perto das duas bordas a 1920px, e o respiro de 16px no celular.

⚠️ **ZERO escrita saindo para a produção.** Só abrir e olhar.

- [ ] **Step 7: Commit**

```bash
git add src/ferramentas/comercial-vessel/ src/ferramentas/atendimentos/ src/ferramentas/beauty-sessions/ src/ferramentas/funil-carrinho/
git commit -m "Comercial Vessel: as seis telas usam a lateral toda do aparelho"
```

---

### Task 3: A trava que o banco não tem — `is_vessel_atendimentos_editar()`

**Files:**
- Create: `db/migrations/2026-09-19-vessel-trava-de-editar.sql`
- Create: `coletor/aplicar-vessel-trava-de-editar.mjs`

**Interfaces:**
- Produces: `public.is_vessel_atendimentos_editar()` → boolean. Toda função de mexer das Tarefas 5 a 8 chama esta.

- [ ] **Step 1: Write the proof first (it is the test)**

Criar `coletor/aplicar-vessel-trava-de-editar.mjs`:

```js
// APLICA, REGISTRA e PROVA a trava de editar do Comercial Vessel.
// ⚠️ As provas escrevem dado de verdade e sao desfeitas antes do commit.
import './lib/carregar-env.mjs'
import { readFileSync } from 'node:fs'
import pg from 'pg'

const ARQUIVO = '2026-09-19-vessel-trava-de-editar.sql'
const TRAVA = 'public.is_vessel_atendimentos_editar()'

const sql = readFileSync(new URL(`../db/migrations/${ARQUIVO}`, import.meta.url), 'utf8')
const cli = new pg.Client({ connectionString: process.env.DATABASE_URL })
await cli.connect()
await cli.query('begin')
try {
  await cli.query(sql)
  await cli.query(
    `insert into public.schema_migrations (name, observacao) values ($1,$2)
     on conflict (name) do nothing`,
    [ARQUIVO, 'Aplicada e registrada na mesma transacao por coletor/aplicar-vessel-trava-de-editar.mjs'])

  const uma = async (s, a = []) => (await cli.query(s, a)).rows[0]

  // 1. A PORTA: a Central usa, a pagina publica nao.
  const p = await uma(
    `select has_function_privilege('anon',$1,'EXECUTE') as anon,
            has_function_privilege('authenticated',$1,'EXECUTE') as autenticado,
            has_function_privilege('public',$1,'EXECUTE') as qualquer_um`, [TRAVA])
  if (!p.autenticado) throw new Error('a Central nao consegue usar a trava')
  if (p.anon || p.qualquer_um) throw new Error('porta aberta para a pagina publica')

  // 2. SEM SESSAO, NAO. auth.uid() e nulo aqui.
  const semSessao = await uma(`select public.is_vessel_atendimentos_editar() as r`)
  if (semSessao.r !== false) throw new Error('sem sessao a trava deixou passar')

  // 3. A PROVA DE VERDADE, com perfis de mentira e rollback.
  await cli.query('savepoint prova')

  const perfil = async (features, permissions, superadmin = false) => {
    const { id } = await uma(
      `insert into public.profiles (id, features, permissions, is_superadmin)
       values (gen_random_uuid(), $1, $2::jsonb, $3) returning id`,
      [features, JSON.stringify(permissions), superadmin])
    return id
  }
  // Roda a trava como se fosse aquele perfil, sem depender de auth.uid().
  const comoSe = async (id) => (await uma(
    `select coalesce((select p.is_superadmin
                        or (p.permissions -> 'atendimentos') ? 'editar'
                      from public.profiles p where p.id = $1), false)
         and coalesce((select 'atendimentos' = any(p.features) or p.is_superadmin
                      from public.profiles p where p.id = $1), false) as r`, [id])).r

  const so_ve  = await perfil(['atendimentos'], { atendimentos: ['ver'] })
  const mexe   = await perfil(['atendimentos'], { atendimentos: ['ver', 'editar'] })
  const solto  = await perfil([], { atendimentos: ['ver', 'editar'] })
  const chefe  = await perfil([], {}, true)

  if (await comoSe(so_ve)) throw new Error('quem so ve passou pela trava de editar')
  if (!(await comoSe(mexe))) throw new Error('quem pode editar foi barrado')
  if (await comoSe(solto)) throw new Error('editar ficou MAIS FROUXO que ver')
  if (!(await comoSe(chefe))) throw new Error('o superadmin foi barrado')

  await cli.query('rollback to savepoint prova')
  await cli.query('commit')
  console.log('✅ aplicada, registrada e provada:', ARQUIVO)
} catch (e) {
  await cli.query('rollback')
  console.error('❌ nao aplicada:', e.message)
  process.exitCode = 1
} finally { await cli.end() }
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node coletor/aplicar-vessel-trava-de-editar.mjs`
Expected: `❌ nao aplicada: ENOENT` — o `.sql` ainda não existe.

- [ ] **Step 3: Write the migration**

Criar `db/migrations/2026-09-19-vessel-trava-de-editar.sql`:

```sql
-- A TRAVA DE EDITAR DO COMERCIAL VESSEL.
--
-- ⚠️ EXISTEM DOIS MODELOS DE PERMISSAO NESTE SISTEMA, E ELES NAO CONVERSAM.
--   · `profiles.features` — lista de CHAVES, sem acao. E o que
--     `is_vessel_atendimentos()` le hoje: ela responde igual para quem so ve e
--     para quem mexe.
--   · `profiles.permissions` — jsonb `recurso -> [acoes]`. E o que a TELA le.
--
-- Sem esta funcao, esconder o botao de apagar na tela seria SO ESCONDER: a
-- funcao aceitaria a chamada de qualquer um com `atendimentos`, por fora da
-- tela.
--
-- ⚠️ E AS DUAS COISAS JUNTAS, comecando pelo portao de hoje: assim editar nunca
-- fica MAIS FROUXO que ver, mesmo quando os dois modelos discordam entre si.
create or replace function public.is_vessel_atendimentos_editar()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_vessel_atendimentos()
     and coalesce(
       (select p.is_superadmin or (p.permissions -> 'atendimentos') ? 'editar'
          from public.profiles p where p.id = auth.uid()),
       false);
$$;

comment on function public.is_vessel_atendimentos_editar() is
  'Quem pode MEXER no Comercial Vessel. Exige o portao de ver (features) E a acao editar (permissions). Nunca mais frouxa que is_vessel_atendimentos().';

-- ⚠️ AS DUAS LINHAS SAO OBRIGATORIAS: `revoke ... from public` NAO fecha
-- `authenticated`.
revoke all on function public.is_vessel_atendimentos_editar() from public, anon, authenticated;
grant execute on function public.is_vessel_atendimentos_editar() to authenticated;
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node coletor/aplicar-vessel-trava-de-editar.mjs`
Expected: `✅ aplicada, registrada e provada: 2026-09-19-vessel-trava-de-editar.sql`

⚠️ Se aparecer "aplicada" mas nada tiver entrado, conferir o `.command` do resultado: **um COMMIT depois de erro vira ROLLBACK calado**.

- [ ] **Step 5: Commit**

```bash
git add db/migrations/2026-09-19-vessel-trava-de-editar.sql coletor/aplicar-vessel-trava-de-editar.mjs
git commit -m "Comercial Vessel: o banco passa a saber o que e editar"
```

---

### Task 4: `arquivada` — a coluna, e as contas que a respeitam

**Files:**
- Create: `db/migrations/2026-09-19-vessel-arquivar.sql`
- Create: `coletor/aplicar-vessel-arquivar.mjs`

**Interfaces:**
- Produces: coluna `arquivada boolean not null default false` em `vessel_private_edits` e `vessel_beauty_sessions`; `vessel_conta_das_private_edits(int)` e `vessel_conta_das_beauty_sessions(int)` passam a ignorar arquivadas.

- [ ] **Step 1: Write the proof first**

Criar `coletor/aplicar-vessel-arquivar.mjs` no molde da Tarefa 3 (mesmo cabeçalho, mesma transação, mesmo registro em `schema_migrations`), com estas provas dentro do `savepoint`:

```js
  await cli.query('savepoint prova')

  // Um encontro de mentira, contado normalmente.
  const { id: sty } = await uma(
    `insert into public.vessel_stylists (codigo, nome, whatsapp)
     values ('STY-9999','Prova','5519999999999') returning id`)
  await uma(
    `insert into public.vessel_private_edits (codigo, chave, stylist_id, quando, praca, loja, vagas)
     values ('PE-20260919-CPS-Z9','ZZZZZZZZ',$1, now() + interval '3 days','CPS','iguatemi',8)`, [sty])

  const conta = async () => (await uma(`select public.vessel_conta_das_private_edits(30) as r`)).r
  const achar = (lista) => (lista || []).find((l) => l.codigo === 'PE-20260919-CPS-Z9')

  if (!achar(await conta())) throw new Error('o encontro novo nao apareceu na conta')

  // ⚠️ ARQUIVADA SAI DAS CONTAS. Se continuasse contando, arquivar uma
  // duplicata deixaria a receita somada DUAS VEZES — que e o que arquivar
  // existe para resolver.
  await uma(`update public.vessel_private_edits set arquivada = true where codigo = 'PE-20260919-CPS-Z9'`)
  if (achar(await conta())) throw new Error('a arquivada continuou contando')

  // ⚠️ ENCERRADA NAO E ARQUIVADA: encerrada CONTINUA contando.
  await uma(`update public.vessel_private_edits set arquivada = false, ativa = false where codigo = 'PE-20260919-CPS-Z9'`)
  if (!achar(await conta())) throw new Error('encerrar sumiu com o encontro do historico')

  // O padrao: ninguem nasce arquivado.
  const { arquivada } = await uma(`select arquivada from public.vessel_private_edits where codigo = 'PE-20260919-CPS-Z9'`)
  if (arquivada !== false) throw new Error('o padrao da coluna nao e false')

  await cli.query('rollback to savepoint prova')
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node coletor/aplicar-vessel-arquivar.mjs`
Expected: `❌ nao aplicada: ENOENT`

- [ ] **Step 3: Write the migration**

Criar `db/migrations/2026-09-19-vessel-arquivar.sql`:

```sql
-- ARQUIVAR NAO E ENCERRAR, E A DIFERENCA E NAS CONTAS.
--   · encerrada  (ativa = false) = acabou como devia. CONTINUA contando.
--   · arquivada  (arquivada = true) = nao devia estar ali: duplicata, engano
--     com gente ja dentro. SAI das contas e sai da lista. O dado FICA no banco.
--
-- ⚠️ Sem essa diferenca, arquivar uma duplicata deixaria a receita contada duas
-- vezes — que e justamente o que arquivar existe para resolver.
--
-- ⚠️ O FILTRO ENTRA PELO MESMO CAMINHO QUE `teste` JA USA nas funcoes de conta.
-- Nao se inventa um segundo jeito de esconder linha.
alter table public.vessel_private_edits
  add column if not exists arquivada boolean not null default false;
alter table public.vessel_beauty_sessions
  add column if not exists arquivada boolean not null default false;

comment on column public.vessel_private_edits.arquivada is
  'Fora das contas e fora da lista. Diferente de ativa=false (encerrada), que continua contando.';
comment on column public.vessel_beauty_sessions.arquivada is
  'Fora das contas e fora da lista. Diferente de ativa=false (encerrada), que continua contando.';
```

E, no mesmo arquivo, **recriar** `vessel_conta_das_private_edits` e `vessel_conta_das_beauty_sessions` idênticas às de hoje, acrescentando só uma linha no `where` de cada:

```sql
      and not coalesce(e.arquivada, false)
```

⚠️ **Copiar o corpo atual de cada função verbatim** de `db/migrations/2026-09-18-vessel-private-edit.sql` (linha 269 em diante) e `db/migrations/2026-09-18-vessel-contar-as-beauty-sessions.sql`, e só acrescentar a linha. Reescrever de memória perde as contas do funil, a janela de venda e o filtro de `teste`.

⚠️ Repetir, no fim, o par `revoke`/`grant` de cada função recriada — `create or replace` **não** preserva os grants de quem foi revogado antes.

- [ ] **Step 4: Run it to verify it passes**

Run: `node coletor/aplicar-vessel-arquivar.mjs`
Expected: `✅ aplicada, registrada e provada: 2026-09-19-vessel-arquivar.sql`

- [ ] **Step 5: Commit**

```bash
git add db/migrations/2026-09-19-vessel-arquivar.sql coletor/aplicar-vessel-arquivar.mjs
git commit -m "Comercial Vessel: arquivar sai das contas, encerrar continua contando"
```

---

### Task 5: Private Edit — editar, apagar e arquivar (banco)

**Files:**
- Create: `db/migrations/2026-09-19-vessel-private-edit-mexer.sql`
- Create: `coletor/aplicar-vessel-private-edit-mexer.mjs`
- Create: `docs/provar-private-edit-mexer.sql`

**Interfaces:**
- Consumes: `is_vessel_atendimentos_editar()` (Tarefa 3), coluna `arquivada` (Tarefa 4).
- Produces:
  - `vessel_private_edit_editar(p_codigo text, p_quando timestamptz, p_local text, p_praca text, p_loja text, p_vagas int, p_stylist text)` → json `{ok, situacao}`
  - `vessel_private_edit_apagar(p_codigo text)` → json `{ok, situacao}` — `situacao` ∈ `ok | sem_permissao | nao_achei | tem_gente`
  - `vessel_private_edit_arquivar(p_codigo text, p_arquivada boolean)` → json `{ok, situacao, arquivada}`

- [ ] **Step 1: Write the proof first**

Criar `coletor/aplicar-vessel-private-edit-mexer.mjs` no molde das anteriores, com estas provas dentro do `savepoint`:

```js
  // 1. A PORTA das tres funcoes novas.
  for (const [nome, f] of [
    ['editar',   'public.vessel_private_edit_editar(text, timestamptz, text, text, text, integer, text)'],
    ['apagar',   'public.vessel_private_edit_apagar(text)'],
    ['arquivar', 'public.vessel_private_edit_arquivar(text, boolean)'],
  ]) {
    const p = await porta(f)
    if (!p.autenticado) throw new Error(`a Central nao consegue usar ${nome}`)
    if (p.anon || p.qualquer_um) throw new Error(`${nome}: porta aberta para a pagina publica`)
  }

  await cli.query('savepoint prova')

  // 2. SEM A PERMISSAO, NADA. auth.uid() e nulo aqui.
  for (const [nome, chamada] of [
    ['editar',   `select public.vessel_private_edit_editar('PE-X', now(), null, null, null, null, null) as r`],
    ['apagar',   `select public.vessel_private_edit_apagar('PE-X') as r`],
    ['arquivar', `select public.vessel_private_edit_arquivar('PE-X', true) as r`],
  ]) {
    const { r } = await uma(chamada)
    if (r.ok) throw new Error(`${nome} deixou passar quem nao tem permissao`)
    if (r.situacao !== 'sem_permissao') throw new Error(`${nome} recusou por outro motivo: ${JSON.stringify(r)}`)
  }

  // 3. APAGAR SO QUANDO NAO TEM NINGUEM PENDURADO.
  //    Provado por dentro, chamando a regra sem passar pela trava de sessao.
  const { id: sty } = await uma(
    `insert into public.vessel_stylists (codigo, nome, whatsapp)
     values ('STY-9998','Prova','5519988888888') returning id`)
  await uma(
    `insert into public.vessel_private_edits (codigo, chave, stylist_id, quando, praca, loja, vagas)
     values ('PE-20260919-CPS-Y8','YYYYYYYY',$1, now() + interval '5 days','CPS','iguatemi',8)`, [sty])

  const temGente = async (cod) => (await uma(
    `select exists (select 1 from public.vessel_atendimentos where evento_codigo = $1) as r`, [cod])).r

  if (await temGente('PE-20260919-CPS-Y8')) throw new Error('o encontro de prova ja nasceu com gente')

  // Pendura uma convidada.
  const { id: pes } = await uma(
    `insert into public.vessel_pessoas (nome, telefone) values ('Convidada de prova','5519977777777') returning id`)
  await uma(
    `insert into public.vessel_atendimentos (pessoa_id, loja, origem_registro, evento_codigo, rsvp)
     values ($1,'iguatemi','private-edit','PE-20260919-CPS-Y8','sim')`, [pes])

  if (!(await temGente('PE-20260919-CPS-Y8'))) throw new Error('a convidada nao pendurou')

  // ⚠️ E A LINHA DA CONVIDADA TEM DE CONTINUAR LA depois da tentativa de apagar.
  const antes = (await uma(`select count(*)::int as n from public.vessel_atendimentos where evento_codigo = 'PE-20260919-CPS-Y8'`)).n
  await uma(`select public.vessel_private_edit_apagar('PE-20260919-CPS-Y8') as r`)
  const depois = (await uma(`select count(*)::int as n from public.vessel_atendimentos where evento_codigo = 'PE-20260919-CPS-Y8'`)).n
  if (antes !== depois) throw new Error('a tentativa de apagar mexeu nas convidadas')

  await cli.query('rollback to savepoint prova')
```

⚠️ A prova de `tem_gente` com a resposta `ok:true` exige sessão de verdade. Ela mora em `docs/provar-private-edit-mexer.sql`, rodado logado — molde: `docs/provar-portao-das-duas-funcoes.sql`.

- [ ] **Step 2: Run it to verify it fails**

Run: `node coletor/aplicar-vessel-private-edit-mexer.mjs`
Expected: `❌ nao aplicada: ENOENT`

- [ ] **Step 3: Write the migration**

Criar `db/migrations/2026-09-19-vessel-private-edit-mexer.sql`:

```sql
-- MEXER NO ENCONTRO: editar, apagar e arquivar.
--
-- ⚠️ AS TRES USAM `is_vessel_atendimentos_editar()`, nao a trava de ver. Quem so
-- ve continua so vendo, inclusive por fora da tela.
--
-- ⚠️ `codigo` e `chave` NUNCA se editam. O `codigo` e o identificador do CRM e a
-- `chave` esta dentro de todo convite JA ENVIADO. Trocar qualquer um dos dois
-- mata links que ja estao circulando.

create or replace function public.vessel_private_edit_editar(
  p_codigo  text,
  p_quando  timestamptz default null,
  p_local   text default null,
  p_praca   text default null,
  p_loja    text default null,
  p_vagas   int default null,
  p_stylist text default null            -- o CODIGO da stylist, nao o id
)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_stylist bigint;
begin
  if not public.is_vessel_atendimentos_editar() then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;

  if not exists (select 1 from public.vessel_private_edits where codigo = p_codigo) then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;

  if p_stylist is not null then
    select id into v_stylist from public.vessel_stylists where codigo = p_stylist;
    if v_stylist is null then
      return json_build_object('ok', false, 'situacao', 'stylist_nao_achei');
    end if;
  end if;

  -- Campo nulo = "nao mexe neste", nunca "apaga o que estava la".
  update public.vessel_private_edits
     set quando     = coalesce(p_quando, quando),
         local      = coalesce(p_local, local),
         praca      = coalesce(p_praca, praca),
         loja       = coalesce(p_loja, loja),
         vagas      = coalesce(p_vagas, vagas),
         stylist_id = coalesce(v_stylist, stylist_id)
   where codigo = p_codigo;

  return json_build_object('ok', true, 'situacao', 'ok', 'codigo', p_codigo);
end;
$function$;

create or replace function public.vessel_private_edit_apagar(p_codigo text)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_vessel_atendimentos_editar() then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;

  if not exists (select 1 from public.vessel_private_edits where codigo = p_codigo) then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;

  -- ⚠️ APAGAR COM GENTE PENDURADA DEIXARIA LINHAS ORFAS em vessel_atendimentos,
  -- e a receita passaria a somar sobre um encontro que nao existe mais. Para
  -- esses, a tela oferece encerrar e arquivar.
  if exists (select 1 from public.vessel_atendimentos where evento_codigo = p_codigo) then
    return json_build_object('ok', false, 'situacao', 'tem_gente');
  end if;

  delete from public.vessel_private_edits where codigo = p_codigo;
  return json_build_object('ok', true, 'situacao', 'ok', 'codigo', p_codigo);
end;
$function$;

create or replace function public.vessel_private_edit_arquivar(
  p_codigo text,
  p_arquivada boolean default true
)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_vessel_atendimentos_editar() then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;

  if not exists (select 1 from public.vessel_private_edits where codigo = p_codigo) then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;

  update public.vessel_private_edits
     set arquivada = coalesce(p_arquivada, true)
   where codigo = p_codigo;

  return json_build_object('ok', true, 'situacao', 'ok',
                           'codigo', p_codigo, 'arquivada', coalesce(p_arquivada, true));
end;
$function$;

-- ⚠️ AS DUAS LINHAS, PARA CADA UMA: `revoke ... from public` NAO fecha
-- `authenticated`.
revoke all on function public.vessel_private_edit_editar(text, timestamptz, text, text, text, integer, text) from public, anon, authenticated;
grant execute on function public.vessel_private_edit_editar(text, timestamptz, text, text, text, integer, text) to authenticated;
revoke all on function public.vessel_private_edit_apagar(text) from public, anon, authenticated;
grant execute on function public.vessel_private_edit_apagar(text) to authenticated;
revoke all on function public.vessel_private_edit_arquivar(text, boolean) from public, anon, authenticated;
grant execute on function public.vessel_private_edit_arquivar(text, boolean) to authenticated;
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node coletor/aplicar-vessel-private-edit-mexer.mjs`
Expected: `✅ aplicada, registrada e provada: 2026-09-19-vessel-private-edit-mexer.sql`

- [ ] **Step 5: Write the logged-in proof**

Criar `docs/provar-private-edit-mexer.sql` no molde de `docs/provar-portao-das-duas-funcoes.sql`, provando com sessão de verdade: quem tem só `ver` recebe `sem_permissao` nas três; quem tem `editar` edita, arquiva, desarquiva; apagar encontro sem gente devolve `ok`; apagar encontro com gente devolve `tem_gente` e a convidada continua lá.

- [ ] **Step 6: Commit**

```bash
git add db/migrations/2026-09-19-vessel-private-edit-mexer.sql \
        coletor/aplicar-vessel-private-edit-mexer.mjs \
        docs/provar-private-edit-mexer.sql
git commit -m "Private Edit: editar, arquivar, e apagar so o que nao tem gente"
```

---

### Task 6: Beauty Sessions — editar, apagar e arquivar (banco)

**Files:**
- Create: `db/migrations/2026-09-19-vessel-beauty-session-mexer.sql`
- Create: `coletor/aplicar-vessel-beauty-session-mexer.mjs`
- Create: `docs/provar-beauty-session-mexer.sql`

**Interfaces:**
- Consumes: `is_vessel_atendimentos_editar()` (Tarefa 3), coluna `arquivada` (Tarefa 4).
- Produces:
  - `vessel_beauty_session_editar(p_codigo text, p_quando timestamptz, p_loja text)` → json `{ok, situacao}`
  - `vessel_beauty_session_apagar(p_codigo text)` → json `{ok, situacao}` — `situacao` ∈ `ok | sem_permissao | nao_achei | tem_gente`
  - `vessel_beauty_session_arquivar(p_codigo text, p_arquivada boolean)` → json `{ok, situacao, arquivada}`

- [ ] **Step 1: Write the proof first**

Criar `coletor/aplicar-vessel-beauty-session-mexer.mjs` no mesmo molde da Tarefa 5, trocando:
- a lista de portas pelas três assinaturas novas;
- o encontro de prova por uma sessão em `vessel_beauty_sessions`;
- **o que é "ter gente"**: na Beauty Session não é convidada, é **leitura do QR**. Antes de escrever, conferir qual tabela guarda a leitura:

```bash
grep -rn "sessao_aberturas\|vessel_leituras" db/migrations/2026-09-18-vessel-beauty-sessions.sql | head
```

e usar a tabela que a função de conta já usa para contar leitura, **a mesma**, nunca uma parecida.

- [ ] **Step 2: Run it to verify it fails**

Run: `node coletor/aplicar-vessel-beauty-session-mexer.mjs`
Expected: `❌ nao aplicada: ENOENT`

- [ ] **Step 3: Write the migration**

Criar `db/migrations/2026-09-19-vessel-beauty-session-mexer.sql`:

```sql
-- MEXER NA SESSAO: editar, apagar e arquivar.
--
-- ⚠️ AS TRES USAM `is_vessel_atendimentos_editar()`, nao a trava de ver.
--
-- ⚠️ `codigo` NUNCA se edita: ele esta nos DOIS links ja copiados desta sessao,
-- o da mesa e o do cartao.

create or replace function public.vessel_beauty_session_editar(
  p_codigo text,
  p_quando timestamptz default null,
  p_loja   text default null
)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_vessel_atendimentos_editar() then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;

  if not exists (select 1 from public.vessel_beauty_sessions where codigo = p_codigo) then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;

  -- Campo nulo = "nao mexe neste", nunca "apaga o que estava la".
  update public.vessel_beauty_sessions
     set quando = coalesce(p_quando, quando),
         loja   = coalesce(p_loja, loja)
   where codigo = p_codigo;

  return json_build_object('ok', true, 'situacao', 'ok', 'codigo', p_codigo);
end;
$function$;

create or replace function public.vessel_beauty_session_apagar(p_codigo text)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_vessel_atendimentos_editar() then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;

  if not exists (select 1 from public.vessel_beauty_sessions where codigo = p_codigo) then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;

  -- ⚠️ APAGAR COM LEITURA PENDURADA deixaria as leituras sem sessao, e a conta
  -- passaria a somar sobre uma sessao que nao existe mais. Para essas, a tela
  -- oferece encerrar e arquivar.
  -- ⚠️ A TABELA AQUI E A MESMA QUE A FUNCAO DE CONTA JA USA para contar leitura
  -- (conferida no Step 1), nunca uma parecida.
  if exists (select 1 from public.vessel_sessao_aberturas where sessao_codigo = p_codigo) then
    return json_build_object('ok', false, 'situacao', 'tem_gente');
  end if;

  delete from public.vessel_beauty_sessions where codigo = p_codigo;
  return json_build_object('ok', true, 'situacao', 'ok', 'codigo', p_codigo);
end;
$function$;

create or replace function public.vessel_beauty_session_arquivar(
  p_codigo text,
  p_arquivada boolean default true
)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_vessel_atendimentos_editar() then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;

  if not exists (select 1 from public.vessel_beauty_sessions where codigo = p_codigo) then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;

  update public.vessel_beauty_sessions
     set arquivada = coalesce(p_arquivada, true)
   where codigo = p_codigo;

  return json_build_object('ok', true, 'situacao', 'ok',
                           'codigo', p_codigo, 'arquivada', coalesce(p_arquivada, true));
end;
$function$;

-- ⚠️ AS DUAS LINHAS, PARA CADA UMA: `revoke ... from public` NAO fecha
-- `authenticated`.
revoke all on function public.vessel_beauty_session_editar(text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.vessel_beauty_session_editar(text, timestamptz, text) to authenticated;
revoke all on function public.vessel_beauty_session_apagar(text) from public, anon, authenticated;
grant execute on function public.vessel_beauty_session_apagar(text) to authenticated;
revoke all on function public.vessel_beauty_session_arquivar(text, boolean) from public, anon, authenticated;
grant execute on function public.vessel_beauty_session_arquivar(text, boolean) to authenticated;
```

⚠️ **`vessel_sessao_aberturas` e `sessao_codigo` são a aposta do Step 1 — confirmar.** Se a função de conta das Beauty Sessions ligar a leitura por outro nome de tabela ou de coluna, usar **exatamente** o que ela usa. Uma tabela parecida conta outra coisa.

⚠️ A sessão **não tem anfitriã nem vagas** — por isso `editar` só recebe `quando` e `loja`.

- [ ] **Step 4: Run it to verify it passes**

Run: `node coletor/aplicar-vessel-beauty-session-mexer.mjs`
Expected: `✅ aplicada, registrada e provada: 2026-09-19-vessel-beauty-session-mexer.sql`

- [ ] **Step 5: Write the logged-in proof**

Criar `docs/provar-beauty-session-mexer.sql`, no molde da Tarefa 5: sem permissão recusa; com permissão edita/arquiva; apagar sessão sem leitura devolve `ok`; com leitura devolve `tem_gente` e a leitura continua lá.

- [ ] **Step 6: Commit**

```bash
git add db/migrations/2026-09-19-vessel-beauty-session-mexer.sql \
        coletor/aplicar-vessel-beauty-session-mexer.mjs \
        docs/provar-beauty-session-mexer.sql
git commit -m "Beauty Sessions: editar, arquivar, e apagar so o que nao teve leitura"
```

---

### Task 7: Quem foi — as convidadas de cada Private Edit (banco)

**Files:**
- Create: `db/migrations/2026-09-19-vessel-convidadas-do-encontro.sql`
- Create: `coletor/aplicar-vessel-convidadas-do-encontro.mjs`

**Interfaces:**
- Consumes: `is_vessel_atendimentos()` (a de VER — isto é leitura).
- Produces: `vessel_convidadas_do_encontro(p_codigo text)` → json array. Cada item: `{nome, telefone, rsvp, status, respondeu_em, presenca_em, comprou}`.

- [ ] **Step 1: Write the proof first**

Criar `coletor/aplicar-vessel-convidadas-do-encontro.mjs` no molde das anteriores, com estas provas dentro do `savepoint`:

```js
  // A porta: leitura, entao e a trava de VER.
  const p = await porta('public.vessel_convidadas_do_encontro(text)')
  if (!p.autenticado) throw new Error('a Central nao consegue ler as convidadas')
  if (p.anon || p.qualquer_um) throw new Error('as convidadas vazaram para a pagina publica')

  await cli.query('savepoint prova')

  const { id: sty } = await uma(
    `insert into public.vessel_stylists (codigo, nome, whatsapp)
     values ('STY-9997','Prova','5519966666666') returning id`)
  await uma(
    `insert into public.vessel_private_edits (codigo, chave, stylist_id, quando, praca, loja, vagas)
     values ('PE-20260919-CPS-X7','XXXXXXXX',$1, now() + interval '2 days','CPS','iguatemi',8)`, [sty])

  const pessoa = async (nome, fone) => (await uma(
    `insert into public.vessel_pessoas (nome, telefone) values ($1,$2) returning id`, [nome, fone])).id

  const real = await pessoa('Convidada de verdade', '5519955555555')
  const fake = await pessoa('Convidada de teste',   '5519944444444')

  await uma(`insert into public.vessel_atendimentos
             (pessoa_id, loja, origem_registro, evento_codigo, rsvp, status, teste)
             values ($1,'iguatemi','private-edit','PE-20260919-CPS-X7','sim','realizado',false)`, [real])
  await uma(`insert into public.vessel_atendimentos
             (pessoa_id, loja, origem_registro, evento_codigo, rsvp, status, teste)
             values ($1,'iguatemi','private-edit','PE-20260919-CPS-X7','sim','realizado',true)`, [fake])

  const lista = (await uma(`select public.vessel_convidadas_do_encontro('PE-20260919-CPS-X7') as r`)).r

  // ⚠️ SO QUEM NAO E `teste` — mesmo filtro das contas. Senao o numero do topo e
  // a lista de baixo discordam NA MESMA TELA.
  if (lista.length !== 1) throw new Error('a lista trouxe ' + lista.length + ', esperava 1 (a de teste tem de ficar de fora)')
  if (lista[0].nome !== 'Convidada de verdade') throw new Error('veio a convidada errada')

  // ⚠️ O NUMERO DO TOPO E A LISTA DE BAIXO TEM DE BATER.
  const conta = (await uma(`select public.vessel_conta_das_private_edits(30) as r`)).r
  const linha = (conta || []).find((l) => l.codigo === 'PE-20260919-CPS-X7')
  if (!linha) throw new Error('o encontro nao apareceu na conta')
  if (linha.compareceram !== lista.filter((c) => c.status === 'realizado').length)
    throw new Error('o topo diz ' + linha.compareceram + ' e a lista mostra outra coisa')

  await cli.query('rollback to savepoint prova')
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node coletor/aplicar-vessel-convidadas-do-encontro.mjs`
Expected: `❌ nao aplicada: ENOENT`

- [ ] **Step 3: Write the migration**

Criar `db/migrations/2026-09-19-vessel-convidadas-do-encontro.sql`:

```sql
-- QUEM FOI, no Private Edit.
--
-- O dado JA EXISTE: `vessel_conta_das_private_edits` ja le
-- `vessel_atendimentos` por `evento_codigo` para contar respondeu / disse sim /
-- confirmou / compareceu. Esta funcao devolve as LINHAS em vez do numero.
--
-- ⚠️ SO QUEM NAO E `teste` — o MESMO filtro das contas. Senao o numero do topo e
-- a lista de baixo discordam na mesma tela.
--
-- ⚠️ E DADO PESSOAL (nome e telefone). Fica atras de `is_vessel_atendimentos()`,
-- a mesma permissao que ja protege as contas deste encontro.
create or replace function public.vessel_convidadas_do_encontro(p_codigo text)
returns json
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_resposta json;
begin
  if not public.is_vessel_atendimentos() then
    return '[]'::json;
  end if;

  select coalesce(json_agg(linha order by linha ->> 'criado_em'), '[]'::json)
    into v_resposta
    from (
      select json_build_object(
        'nome',        pe.nome,
        'telefone',    pe.telefone,
        'rsvp',        t.rsvp,
        'status',      t.status,
        'presenca_em', t.presenca_em,
        'criado_em',   t.criado_em,
        -- A mesma regra da receita: nao existe campo dizendo "esta compra veio
        -- daqui"; o que existe e a mesma cliente comprando perto do encontro.
        'comprou', exists (
          select 1 from public.vessel_pedidos p
           where p.pessoa_id = t.pessoa_id)
      ) as linha
      from public.vessel_atendimentos t
      join public.vessel_pessoas pe on pe.id = t.pessoa_id
     where t.evento_codigo = p_codigo
       and not coalesce(t.teste, false)
    ) as linhas;

  return v_resposta;
end;
$function$;

revoke all on function public.vessel_convidadas_do_encontro(text) from public, anon, authenticated;
grant execute on function public.vessel_convidadas_do_encontro(text) to authenticated;
```

⚠️ Antes de rodar, conferir que `vessel_pedidos` tem mesmo `pessoa_id`:

```bash
grep -rn "create table if not exists public.vessel_pedidos" -A20 db/migrations/*.sql | grep -n "pessoa_id"
```

Se o nome for outro, usar o que a função de receita de `2026-09-18-vessel-private-edit.sql:310` já usa — **a mesma ligação**, nunca uma parecida.

- [ ] **Step 4: Run it to verify it passes**

Run: `node coletor/aplicar-vessel-convidadas-do-encontro.mjs`
Expected: `✅ aplicada, registrada e provada: 2026-09-19-vessel-convidadas-do-encontro.sql`

- [ ] **Step 5: Commit**

```bash
git add db/migrations/2026-09-19-vessel-convidadas-do-encontro.sql \
        coletor/aplicar-vessel-convidadas-do-encontro.mjs
git commit -m "Private Edit: as convidadas, uma a uma, com o mesmo filtro das contas"
```

---

### Task 8: Stylists — cadastrar, editar e desativar (banco)

**Files:**
- Create: `db/migrations/2026-09-19-vessel-stylist-mexer.sql`
- Create: `coletor/aplicar-vessel-stylist-mexer.mjs`

**Interfaces:**
- Consumes: `is_vessel_atendimentos_editar()` (Tarefa 3).
- Produces:
  - `vessel_stylist_criar(p_nome text, p_whatsapp text, p_cidade text, p_instagram text, p_atuacao text, p_praca text)` → json `{ok, situacao, codigo}` — o `codigo` é gerado por dentro
  - `vessel_stylist_editar(p_codigo text, p_nome text, p_whatsapp text, p_cidade text, p_instagram text, p_atuacao text, p_estagio text)` → json `{ok, situacao}`
  - `vessel_stylist_desativar(p_codigo text, p_ativa boolean)` → json `{ok, situacao, ativa}`

- [ ] **Step 1: Check what the table already has**

```bash
grep -rn "create table if not exists public.vessel_stylists" -A30 db/migrations/*.sql | grep -E "ativa|estagio|codigo"
```

Se **não** existir coluna `ativa`, a migration acrescenta `ativa boolean not null default true`, e `vessel_rastreio_dos_stylists` ganha o filtro de desativadas do mesmo jeito que `arquivada` entrou na Tarefa 4 — copiando o corpo atual verbatim e acrescentando uma linha.

- [ ] **Step 2: Write the proof first**

Criar `coletor/aplicar-vessel-stylist-mexer.mjs` no molde das anteriores, com estas provas no `savepoint`:

```js
  // Sem permissao, nenhuma das tres.
  for (const [nome, chamada] of [
    ['criar',     `select public.vessel_stylist_criar('Nome','5519933333333',null,null,null,null) as r`],
    ['editar',    `select public.vessel_stylist_editar('STY-0001','Outro',null,null,null,null,null) as r`],
    ['desativar', `select public.vessel_stylist_desativar('STY-0001', false) as r`],
  ]) {
    const { r } = await uma(chamada)
    if (r.ok) throw new Error(`${nome} deixou passar quem nao tem permissao`)
    if (r.situacao !== 'sem_permissao') throw new Error(`${nome} recusou por outro motivo: ${JSON.stringify(r)}`)
  }

  // ⚠️ O CODIGO E A ORIGEM NAO SE EDITAM. O codigo esta dentro de todo link de
  // rastreio ja colado por ai, e a origem e PRIMEIRO TOQUE — reescrever faz a
  // atribuicao somar o canal duas vezes.
  const args = (await uma(
    `select pg_get_function_arguments(oid) as a from pg_proc
      where proname = 'vessel_stylist_editar' and pronamespace = 'public'::regnamespace`)).a
  for (const proibido of ['p_codigo_novo', 'p_origem_canal', 'p_origem_campanha', 'p_origem_utm']) {
    if (args.includes(proibido)) throw new Error(`vessel_stylist_editar aceita ${proibido}, que nao pode existir`)
  }

  // E a prova de verdade: mesmo chamando o UPDATE por dentro, a origem fica.
  await cli.query('savepoint prova')
  const { id } = await uma(
    `insert into public.vessel_stylists (codigo, nome, whatsapp, origem_canal)
     values ('STY-9996','Prova','5519922222222','instagram') returning id`)
  await uma(`select public.vessel_stylist_editar('STY-9996','Nome Novo',null,null,null,null,null) as r`)
  const { origem_canal, codigo } = await uma(`select origem_canal, codigo from public.vessel_stylists where id = $1`, [id])
  if (origem_canal !== 'instagram') throw new Error('a origem foi sobrescrita')
  if (codigo !== 'STY-9996') throw new Error('o codigo mudou e os links ja colados morreram')
  await cli.query('rollback to savepoint prova')
```

- [ ] **Step 3: Run it to verify it fails**

Run: `node coletor/aplicar-vessel-stylist-mexer.mjs`
Expected: `❌ nao aplicada: ENOENT`

- [ ] **Step 4: Write the migration**

Criar `db/migrations/2026-09-19-vessel-stylist-mexer.sql`:

```sql
-- MEXER NA PARCEIRA: cadastrar, corrigir e desativar.
--
-- ⚠️ DUAS COISAS NAO SE EDITAM, E ESTA ESCRITO NA PROPRIA TABELA POR QUE:
--   · `codigo` — e ele que vai dentro de TODO link de rastreio ja colado por
--     ai. Mudar quebra os links em circulacao e a atribuicao das aberturas
--     antigas.
--   · `origem_canal` / `origem_campanha` / `origem_utm` — primeiro toque e
--     primeiro toque. Reescrever faz a atribuicao somar o canal duas vezes.
-- Por isso elas nao existem como parametro: uma funcao que nao recebe o campo
-- nao tem como grava-lo por engano.

alter table public.vessel_stylists
  add column if not exists ativa boolean not null default true;

comment on column public.vessel_stylists.ativa is
  'Desativada sai da lista de escolher e do topo da tela. NAO apaga: as aberturas e os atendimentos que ela trouxe continuam contando no historico.';

create or replace function public.vessel_stylist_criar(
  p_nome      text,
  p_whatsapp  text,
  p_cidade    text default null,
  p_instagram text default null,
  p_atuacao   text default null,
  p_praca     text default null
)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_codigo text;
  v_tenta  int := 0;
begin
  if not public.is_vessel_atendimentos_editar() then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;

  if nullif(trim(coalesce(p_nome, '')), '') is null then
    return json_build_object('ok', false, 'situacao', 'sem_nome');
  end if;
  if nullif(trim(coalesce(p_whatsapp, '')), '') is null then
    return json_build_object('ok', false, 'situacao', 'sem_whatsapp');
  end if;

  -- ⚠️ O CODIGO E GERADO AQUI DENTRO, no formato STY-0000 que `FORMATO_STYLIST`
  -- exige em `enderecos-publicos.js`. Mesmo laco de `vessel_criar_private_edit`
  -- (2026-09-18-vessel-private-edit.sql:379): repete ate nao colidir.
  loop
    v_tenta := v_tenta + 1;
    v_codigo := 'STY-' || lpad((floor(random() * 10000))::int::text, 4, '0');
    exit when not exists (select 1 from public.vessel_stylists where codigo = v_codigo);
    if v_tenta > 50 then
      return json_build_object('ok', false, 'situacao', 'sem_codigo_livre');
    end if;
  end loop;

  insert into public.vessel_stylists
    (codigo, nome, whatsapp, cidade, instagram, atuacao, praca_preview)
  values
    (v_codigo, trim(p_nome), trim(p_whatsapp),
     nullif(trim(coalesce(p_cidade, '')), ''),
     nullif(trim(coalesce(p_instagram, '')), ''),
     nullif(trim(coalesce(p_atuacao, '')), ''),
     nullif(trim(coalesce(p_praca, '')), ''));

  return json_build_object('ok', true, 'situacao', 'ok', 'codigo', v_codigo);
end;
$function$;

create or replace function public.vessel_stylist_editar(
  p_codigo    text,
  p_nome      text default null,
  p_whatsapp  text default null,
  p_cidade    text default null,
  p_instagram text default null,
  p_atuacao   text default null,
  p_estagio   text default null
)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_vessel_atendimentos_editar() then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;

  if not exists (select 1 from public.vessel_stylists where codigo = p_codigo) then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;

  -- Campo nulo = "nao mexe neste", nunca "apaga o que estava la".
  -- ⚠️ `codigo` e os campos de origem NAO aparecem aqui, de proposito.
  update public.vessel_stylists
     set nome      = coalesce(nullif(trim(coalesce(p_nome, '')), ''), nome),
         whatsapp  = coalesce(nullif(trim(coalesce(p_whatsapp, '')), ''), whatsapp),
         cidade    = coalesce(nullif(trim(coalesce(p_cidade, '')), ''), cidade),
         instagram = coalesce(nullif(trim(coalesce(p_instagram, '')), ''), instagram),
         atuacao   = coalesce(nullif(trim(coalesce(p_atuacao, '')), ''), atuacao),
         estagio   = coalesce(nullif(trim(coalesce(p_estagio, '')), ''), estagio)
   where codigo = p_codigo;

  return json_build_object('ok', true, 'situacao', 'ok', 'codigo', p_codigo);
end;
$function$;

create or replace function public.vessel_stylist_desativar(
  p_codigo text,
  p_ativa  boolean default false
)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_vessel_atendimentos_editar() then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;

  if not exists (select 1 from public.vessel_stylists where codigo = p_codigo) then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;

  -- ⚠️ DESATIVAR NAO APAGA. Nada de `delete` aqui: as aberturas e os
  -- atendimentos que ela trouxe continuam contando no historico.
  update public.vessel_stylists
     set ativa = coalesce(p_ativa, false)
   where codigo = p_codigo;

  return json_build_object('ok', true, 'situacao', 'ok',
                           'codigo', p_codigo, 'ativa', coalesce(p_ativa, false));
end;
$function$;

revoke all on function public.vessel_stylist_criar(text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.vessel_stylist_criar(text, text, text, text, text, text) to authenticated;
revoke all on function public.vessel_stylist_editar(text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.vessel_stylist_editar(text, text, text, text, text, text, text) to authenticated;
revoke all on function public.vessel_stylist_desativar(text, boolean) from public, anon, authenticated;
grant execute on function public.vessel_stylist_desativar(text, boolean) to authenticated;
```

E, **no mesmo arquivo**, recriar `vessel_rastreio_dos_stylists` e `vessel_stylists_para_escolher` acrescentando ao `where` de cada uma:

```sql
      and coalesce(s.ativa, true)
```

⚠️ **Copiar o corpo atual de cada uma verbatim** de `db/migrations/2026-09-18-vessel-rastreio-por-stylist.sql` e `2026-09-18-vessel-private-edit.sql`, e só acrescentar a linha. Reescrever de memória perde as contas de abertura e a janela de venda.

⚠️ E repetir o par `revoke`/`grant` das duas recriadas: `create or replace` **não** preserva os grants de quem foi revogado antes.

⚠️ `vessel_stylists_para_escolher` devolve hoje **exatamente** `cidade,codigo,nome` — há prova que quebra se vier mais campo. Não acrescentar `ativa` na resposta; só usá-la no filtro.

- [ ] **Step 5: Run it to verify it passes**

Run: `node coletor/aplicar-vessel-stylist-mexer.mjs`
Expected: `✅ aplicada, registrada e provada: 2026-09-19-vessel-stylist-mexer.sql`

- [ ] **Step 6: Commit**

```bash
git add db/migrations/2026-09-19-vessel-stylist-mexer.sql coletor/aplicar-vessel-stylist-mexer.mjs
git commit -m "Stylist Circle: cadastrar, corrigir e desativar — sem tocar codigo nem origem"
```

---

### Task 9: As regras da barra de lista, e a barra

**Files:**
- Create: `src/ferramentas/comercial-vessel/filtros.js`
- Create: `src/ferramentas/comercial-vessel/filtros.test.mjs`
- Create: `src/ferramentas/comercial-vessel/barra-de-lista.vue`
- Modify: `src/ferramentas/comercial-vessel/estilo-comercial.css` (o visual da barra)

**Interfaces:**
- Consumes: `proporcaoDoConjunto` de `estatistica.js`.
- Produces:
  - `PERIODOS` = `[{dias: 7, rotulo: '7 dias'}, {dias: 30, …}, {dias: 90, …}, {dias: null, rotulo: 'Tudo'}]`
  - `filtrar(lista, {busca, situacao, loja, estagio, ordem}, campos)` → array filtrado e ordenado
  - `<barra-de-lista>` com props `{modelValue, mostrar, lojas, estagios}` e evento `update:modelValue`

- [ ] **Step 1: Write the failing test**

Criar `src/ferramentas/comercial-vessel/filtros.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { filtrar, PERIODOS, FILTRO_VAZIO } from './filtros.js'
import { proporcaoDoConjunto } from './estatistica.js'

const CAMPOS = { busca: ['codigo', 'nome'], situacao: 'situacao', loja: 'loja' }

const LISTA = [
  { codigo: 'PE-1', nome: 'Ana',   loja: 'iguatemi', ativa: true,  arquivada: false, quando: '2026-09-10T18:00:00Z', responderam: 4, disseram_sim: 2 },
  { codigo: 'PE-2', nome: 'Bruna', loja: 'tivoli',   ativa: false, arquivada: false, quando: '2026-09-12T18:00:00Z', responderam: 6, disseram_sim: 3 },
  { codigo: 'PE-3', nome: 'Carla', loja: 'iguatemi', ativa: true,  arquivada: true,  quando: '2026-09-14T18:00:00Z', responderam: 9, disseram_sim: 9 },
]

test('sem filtro nenhum, a lista volta inteira menos as arquivadas', () => {
  const r = filtrar(LISTA, FILTRO_VAZIO, CAMPOS)
  assert.deepEqual(r.map((l) => l.codigo), ['PE-2', 'PE-1'])
})

test('a arquivada so aparece quando alguem pede por ela', () => {
  const r = filtrar(LISTA, { ...FILTRO_VAZIO, situacao: 'arquivadas' }, CAMPOS)
  assert.deepEqual(r.map((l) => l.codigo), ['PE-3'])
})

test('encerrada e diferente de arquivada', () => {
  const r = filtrar(LISTA, { ...FILTRO_VAZIO, situacao: 'encerradas' }, CAMPOS)
  assert.deepEqual(r.map((l) => l.codigo), ['PE-2'])
})

test('a busca nao liga para maiuscula nem para acento', () => {
  assert.deepEqual(filtrar(LISTA, { ...FILTRO_VAZIO, busca: 'ANA' }, CAMPOS).map((l) => l.codigo), ['PE-1'])
  assert.deepEqual(filtrar(LISTA, { ...FILTRO_VAZIO, busca: 'pe-2' }, CAMPOS).map((l) => l.codigo), ['PE-2'])
})

test('o filtro de loja recorta', () => {
  assert.deepEqual(filtrar(LISTA, { ...FILTRO_VAZIO, loja: 'tivoli' }, CAMPOS).map((l) => l.codigo), ['PE-2'])
})

test('a ordem mais nova primeiro e o padrao', () => {
  const r = filtrar(LISTA, { ...FILTRO_VAZIO, situacao: 'todas' }, CAMPOS)
  assert.deepEqual(r.map((l) => l.codigo), ['PE-3', 'PE-2', 'PE-1'])
})

test('da para pedir a mais antiga primeiro', () => {
  const r = filtrar(LISTA, { ...FILTRO_VAZIO, situacao: 'todas', ordem: 'data-antiga' }, CAMPOS)
  assert.deepEqual(r.map((l) => l.codigo), ['PE-1', 'PE-2', 'PE-3'])
})

// ⚠️ O TOTAL DO CONJUNTO ANDA JUNTO COM O FILTRO. Um total que nao acompanha o
// filtro e a tela mentindo com numero certo.
test('o total do conjunto muda quando o filtro muda', () => {
  // ⚠️ A FORMA REAL DA RESPOSTA: proporcao() devolve {temBase, n, x, valor,
  // intervalo, largura, confiavel} — nao {total, proporcao}.
  const todas  = proporcaoDoConjunto(filtrar(LISTA, { ...FILTRO_VAZIO, situacao: 'todas' }, CAMPOS), 'disseram_sim', 'responderam')
  const so_igu = proporcaoDoConjunto(filtrar(LISTA, { ...FILTRO_VAZIO, situacao: 'todas', loja: 'iguatemi' }, CAMPOS), 'disseram_sim', 'responderam')
  assert.equal(todas.n, 19)    // 4 + 6 + 9
  assert.equal(todas.x, 14)    // 2 + 3 + 9
  assert.equal(so_igu.n, 13)   // 4 + 9
  assert.equal(so_igu.x, 11)   // 2 + 9
  assert.notEqual(todas.valor, so_igu.valor)
})

// ⚠️ BASE ZERO NAO E 0%. Sem ninguem no denominador nao ha taxa — "0%" faz um
// filtro que nao achou nada parecer um fracasso, e so o segundo pede decisao.
test('filtro que nao acha nada nao vira 0%', () => {
  const nada = proporcaoDoConjunto(filtrar(LISTA, { ...FILTRO_VAZIO, busca: 'ninguem' }, CAMPOS), 'disseram_sim', 'responderam')
  assert.equal(nada.temBase, false)
  assert.equal(nada.n, 0)
  assert.equal(nada.valor, null)
})

test('os periodos oferecidos incluem "tudo"', () => {
  assert.ok(PERIODOS.some((p) => p.dias === null))
  assert.deepEqual(PERIODOS.map((p) => p.dias), [7, 30, 90, null])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/ferramentas/comercial-vessel/filtros.test.mjs`
Expected: FAIL — `Cannot find module './filtros.js'`

- [ ] **Step 3: Write the implementation**

Criar `src/ferramentas/comercial-vessel/filtros.js`:

```js
/* AS REGRAS DA BARRA DE LISTA — buscar, filtrar e ordenar.
 *
 * Escritas uma vez e usadas pelas três telas. Duas cópias do mesmo controle
 * viram dois controles diferentes no dia em que alguém ajusta um.
 *
 * ⚠️ O PERÍODO NÃO MORA AQUI: ele é parâmetro das funções de conta do banco
 * (`p_dias`). Aqui só acontece o que dá para decidir com a lista na mão.
 *
 * ⚠️ QUEM CHAMA RECALCULA O TOTAL sobre o que voltou daqui, com
 * `proporcaoDoConjunto`. Reaproveitar o total que veio do banco depois de
 * filtrar é a tela mentindo com número certo.
 */
export const PERIODOS = [
  { dias: 7,    rotulo: '7 dias' },
  { dias: 30,   rotulo: '30 dias' },
  { dias: 90,   rotulo: '90 dias' },
  { dias: null, rotulo: 'Tudo' },
]

export const FILTRO_VAZIO = {
  // ⚠️ `dias` mora aqui porque a barra o emite, mas `filtrar()` NÃO o usa: o
  // período é parâmetro da função de conta do banco (`p_dias`). Filtrar por
  // data na tela sobre o que o banco já recortou responderia o pedaço errado.
  dias: 30,
  busca: '',
  situacao: 'abertas_e_encerradas',
  loja: '',
  estagio: '',
  ordem: 'data-nova',
}

// Sem acento e sem maiúscula: quem busca "ana" tem de achar "Ana" e "Âna".
const achatar = (t) => String(t ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

function passaNaSituacao(linha, situacao) {
  const arquivada = !!linha.arquivada
  // `ativa` pode não existir (Stylist Circle usa a mesma coluna com outro nome
  // de tela); nesse caso a linha conta como aberta.
  const aberta = linha.ativa !== false
  switch (situacao) {
    case 'arquivadas': return arquivada
    case 'abertas':    return !arquivada && aberta
    case 'encerradas': return !arquivada && !aberta
    case 'todas':      return true
    // ⚠️ O PADRÃO ESCONDE A ARQUIVADA, e só ela. Encerrada continua à vista:
    // ela aconteceu e continua contando.
    default:           return !arquivada
  }
}

export function filtrar(lista, filtro, campos = {}) {
  const f = { ...FILTRO_VAZIO, ...(filtro || {}) }
  const busca = achatar(f.busca)
  const camposDeBusca = campos.busca || ['codigo']

  const recortada = (lista || []).filter((linha) => {
    if (!passaNaSituacao(linha, f.situacao)) return false
    if (f.loja && linha[campos.loja || 'loja'] !== f.loja) return false
    if (f.estagio && linha[campos.estagio || 'estagio'] !== f.estagio) return false
    if (busca && !camposDeBusca.some((c) => achatar(linha[c]).includes(busca))) return false
    return true
  })

  const quando = (l) => new Date(l.quando || l.criado_em || 0).getTime()
  const ordens = {
    'data-nova':   (a, b) => quando(b) - quando(a),
    'data-antiga': (a, b) => quando(a) - quando(b),
    'nome':        (a, b) => achatar(a.nome).localeCompare(achatar(b.nome)),
    'aberturas':   (a, b) => (b.aberturas || 0) - (a.aberturas || 0),
  }
  return recortada.sort(ordens[f.ordem] || ordens['data-nova'])
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/ferramentas/comercial-vessel/filtros.test.mjs`
Expected: PASS (10 testes)

- [ ] **Step 5: Build the bar component**

Criar `src/ferramentas/comercial-vessel/barra-de-lista.vue`, que desenha só os controles pedidos em `mostrar`:

```vue
<template>
  <div class="cv-barra">
    <label v-if="mostrar.includes('busca')" class="cv-barra-campo">
      <span class="cv-etiqueta">Buscar</span>
      <input type="search" :value="modelValue.busca" :placeholder="placeholderBusca"
             @input="mudar('busca', $event.target.value)" />
    </label>

    <label v-if="mostrar.includes('periodo')" class="cv-barra-campo">
      <span class="cv-etiqueta">Período</span>
      <select :value="String(modelValue.dias)" @change="mudarPeriodo($event.target.value)">
        <option v-for="p in PERIODOS" :key="String(p.dias)" :value="String(p.dias)">{{ p.rotulo }}</option>
      </select>
    </label>

    <label v-if="mostrar.includes('situacao')" class="cv-barra-campo">
      <span class="cv-etiqueta">Situação</span>
      <select :value="modelValue.situacao" @change="mudar('situacao', $event.target.value)">
        <option v-for="s in situacoes" :key="s.valor" :value="s.valor">{{ s.rotulo }}</option>
      </select>
    </label>

    <label v-if="mostrar.includes('loja')" class="cv-barra-campo">
      <span class="cv-etiqueta">Loja</span>
      <select :value="modelValue.loja" @change="mudar('loja', $event.target.value)">
        <option value="">Todas</option>
        <option v-for="(rotulo, chave) in lojas" :key="chave" :value="chave">{{ rotulo }}</option>
      </select>
    </label>

    <label v-if="mostrar.includes('estagio')" class="cv-barra-campo">
      <span class="cv-etiqueta">Estágio</span>
      <select :value="modelValue.estagio" @change="mudar('estagio', $event.target.value)">
        <option value="">Todos</option>
        <option v-for="(rotulo, chave) in estagios" :key="chave" :value="chave">{{ rotulo }}</option>
      </select>
    </label>

    <label v-if="mostrar.includes('ordem')" class="cv-barra-campo">
      <span class="cv-etiqueta">Ordem</span>
      <select :value="modelValue.ordem" @change="mudar('ordem', $event.target.value)">
        <option v-for="o in ordens" :key="o.valor" :value="o.valor">{{ o.rotulo }}</option>
      </select>
    </label>
  </div>
</template>

<script setup>
/* A BARRA DE LISTA do Comercial Vessel — uma só, usada pelas três telas.
 *
 * ⚠️ MONTA SÓ O QUE FAZ SENTIDO EM CADA TELA, pela prop `mostrar`: não existe
 * filtro de loja numa lista de parceiras, nem período numa lista de gente.
 */
import { PERIODOS } from './filtros.js'

const props = defineProps({
  modelValue: { type: Object, required: true },
  mostrar: { type: Array, default: () => ['busca', 'situacao', 'ordem'] },
  lojas: { type: Object, default: () => ({}) },
  estagios: { type: Object, default: () => ({}) },
  placeholderBusca: { type: String, default: 'nome ou código' },
  situacoes: { type: Array, default: () => ([
    { valor: 'abertas_e_encerradas', rotulo: 'Abertas e encerradas' },
    { valor: 'abertas', rotulo: 'Só abertas' },
    { valor: 'encerradas', rotulo: 'Só encerradas' },
    { valor: 'arquivadas', rotulo: 'Só arquivadas' },
    { valor: 'todas', rotulo: 'Todas, inclusive arquivadas' },
  ]) },
  ordens: { type: Array, default: () => ([
    { valor: 'data-nova', rotulo: 'Mais nova primeiro' },
    { valor: 'data-antiga', rotulo: 'Mais antiga primeiro' },
  ]) },
})
const emit = defineEmits(['update:modelValue'])

function mudar(campo, valor) {
  emit('update:modelValue', { ...props.modelValue, [campo]: valor })
}
function mudarPeriodo(valor) {
  // "null" vem como texto do <select>; o banco espera número ou nulo.
  mudar('dias', valor === 'null' ? null : Number(valor))
}
</script>

<style scoped>
@import './estilo-comercial.css';
</style>
```

E acrescentar o visual em `estilo-comercial.css` (só token, nunca hex):

```css
/* A BARRA DE LISTA. Enrola no celular em vez de estourar a tela. */
.cv-barra {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-3);
  align-items: flex-end;
  margin-top: var(--sp-3);
  padding: var(--sp-3);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}
.cv-barra-campo { display: flex; flex-direction: column; gap: 4px; flex: 1 1 12rem; min-width: 0; }
.cv-barra-campo input, .cv-barra-campo select {
  width: 100%;
  font-family: var(--fonte-principal);
  font-size: var(--texto-corpo);
  color: var(--text);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
}
```

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/ferramentas/comercial-vessel/filtros.js \
        src/ferramentas/comercial-vessel/filtros.test.mjs \
        src/ferramentas/comercial-vessel/barra-de-lista.vue \
        src/ferramentas/comercial-vessel/estilo-comercial.css
git commit -m "Comercial Vessel: uma barra de buscar, filtrar e ordenar para as tres telas"
```

---

### Task 10: A tela do Private Edit ganha tudo

**Files:**
- Modify: `src/ferramentas/comercial-vessel/tela-de-private-edit.vue`

**Interfaces:**
- Consumes: `filtrar`, `FILTRO_VAZIO`, `PERIODOS` (Tarefa 9); `<barra-de-lista>` (Tarefa 9); `vessel_private_edit_editar`, `_apagar`, `_arquivar` (Tarefa 5); `vessel_convidadas_do_encontro` (Tarefa 7); `proporcaoDoConjunto` de `estatistica.js`.

- [ ] **Step 1: Wire the bar and make the period come from it**

Trocar o `p_dias: 7` cravado (linha 287) por `p_dias: filtro.value.dias`, com `const filtro = ref({ ...FILTRO_VAZIO, dias: 30 })`. Recarregar do banco quando **só** `dias` mudar:

```js
watch(() => filtro.value.dias, () => carregar())
```

⚠️ **Só `dias` recarrega.** Busca, situação, loja e ordem acontecem sobre o que já veio — recarregar a cada letra digitada é uma chamada ao banco por tecla.

Pôr a barra logo abaixo do bloco de criar:

```vue
<barra-de-lista v-model="filtro" :lojas="LOJAS"
                :mostrar="['busca','periodo','situacao','loja','ordem']"
                placeholder-busca="código ou anfitriã" />
```

- [ ] **Step 2: Make the list and the totals follow the filter**

```js
const encontrosNaTela = computed(() =>
  filtrar(encontros.value, filtro.value, { busca: ['codigo', 'stylist_nome'], loja: 'loja' }))
```

Trocar `v-for="e in encontros"` por `v-for="e in encontrosNaTela"`, **e também** o bloco "Todos os encontros juntos", que passa a somar sobre `encontrosNaTela`.

⚠️ O bloco do conjunto tem de dizer sobre quantos está falando: `{{ encontrosNaTela.length }} de {{ encontros.length }} encontros`.

- [ ] **Step 3: Add editar / apagar / arquivar**

Em cada bloco de encontro, ao lado do encerrar que já existe, com `v-if="podeEditar"` (`hasPermission('atendimentos','editar')`):

- **Editar** abre os campos do próprio bloco (sem modal novo), e grava com `chamar('vessel_private_edit_editar', {...})`.
- **Apagar** pede confirmação no mesmo padrão do encerrar que já está ali (`confirmando === e.codigo`), chama `vessel_private_edit_apagar` e, se a resposta vier `situacao === 'tem_gente'`, **não mostra erro vermelho**: troca o botão pela frase e pelas duas saídas de verdade —

  > "Este encontro já tem **{{ e.responderam }}** convidada(s). Apagar deixaria elas sem encontro e a receita somando sobre algo que não existe mais. Dá para **encerrar** (continua no histórico) ou **arquivar** (sai das contas e da lista)."

- **Arquivar / Desarquivar** chama `vessel_private_edit_arquivar` com `p_arquivada` invertido.

⚠️ Depois de qualquer uma das três, `await carregar()` — o dado em memória não é a tela.

- [ ] **Step 4: Add the guest list**

Um botão "Ver quem foi" por encontro, que chama `vessel_convidadas_do_encontro` e abre a lista dentro do próprio bloco:

```vue
<table v-if="convidadas[e.codigo]" class="cv-tabela">
  <thead><tr><th>Convidada</th><th>Respondeu</th><th>Confirmou</th><th>Compareceu</th><th>Comprou</th></tr></thead>
  <tbody>
    <tr v-for="c in convidadas[e.codigo]" :key="c.telefone">
      <td>{{ c.nome }}</td>
      <td>{{ c.rsvp === 'sim' ? 'Sim' : c.rsvp === 'nao' ? 'Não' : '—' }}</td>
      <td>{{ ['confirmado','realizado','no_show'].includes(c.status) ? 'Sim' : '—' }}</td>
      <td>{{ c.status === 'realizado' ? 'Sim' : c.status === 'no_show' ? 'Não veio' : '—' }}</td>
      <td>{{ c.comprou ? 'Sim' : '—' }}</td>
    </tr>
  </tbody>
</table>
<p v-else-if="convidadasVazias[e.codigo]" class="cv-vazio">
  Ninguém respondeu a este convite ainda.
</p>
```

⚠️ **Lista vazia não é erro.** "Ninguém respondeu ainda" e "deu erro ao buscar" são coisas diferentes na tela.

⚠️ A tabela vai dentro de um `<div>` com `overflow-x: auto` — é a única coisa que pode passar da largura no celular.

- [ ] **Step 5: Run the suite and prove it in the browser**

Run: `npm test` → PASS

No navegador, logado: criar um encontro de teste, editar o dia, arquivar, desarquivar, tentar apagar com convidada (tem de aparecer a frase, não o erro), apagar um sem convidada. Fotografar a 375px e 1920px, claro e escuro.

⚠️ Marcar o encontro de prova com `teste = true` e apagá-lo no fim. **ZERO escrita que fique na produção.**

- [ ] **Step 6: Commit**

```bash
git add src/ferramentas/comercial-vessel/tela-de-private-edit.vue
git commit -m "Private Edit: filtrar, editar, arquivar, e ver quem foi"
```

---

### Task 11: A tela das Beauty Sessions ganha tudo

**Files:**
- Modify: `src/ferramentas/beauty-sessions/tela-de-beauty-sessions.vue`

**Interfaces:**
- Consumes: `filtrar`, `FILTRO_VAZIO` (Tarefa 9); `<barra-de-lista>` (Tarefa 9); `vessel_beauty_session_editar`, `_apagar`, `_arquivar` (Tarefa 6).

- [ ] **Step 1: Wire the bar**

Trocar o `p_dias` cravado por `p_dias: filtro.value.dias`, com
`const filtro = ref({ ...FILTRO_VAZIO, dias: 30 })`, e recarregar do banco
quando **só** `dias` mudar:

```js
watch(() => filtro.value.dias, () => carregar())
```

⚠️ **Só `dias` recarrega.** Busca, situação, loja e ordem acontecem sobre o que
já veio — recarregar a cada letra digitada é uma chamada ao banco por tecla.

Pôr a barra logo abaixo do bloco de criar:

```vue
<barra-de-lista v-model="filtro" :lojas="LOJAS"
                :mostrar="['busca','periodo','situacao','loja','ordem']"
                placeholder-busca="código ou loja" />
```

- [ ] **Step 2: Make the list and totals follow the filter**

```js
const sessoesNaTela = computed(() =>
  filtrar(sessoes.value, filtro.value, { busca: ['codigo', 'loja'], loja: 'loja' }))
```

Trocar o `v-for="s in sessoes"` e o bloco do conjunto, que passa a somar sobre `sessoesNaTela` e a dizer sobre quantas está falando.

- [ ] **Step 3: Add editar / apagar / arquivar**

Em cada bloco de sessão, ao lado do encerrar que já existe, com
`v-if="podeEditar"` (`hasPermission('atendimentos','editar')`):

- **Editar** abre os campos do próprio bloco (sem modal novo) — **dia e hora, e
  loja; só esses dois** — e grava com `chamar('vessel_beauty_session_editar', {...})`.
- **Arquivar / Desarquivar** chama `vessel_beauty_session_arquivar` com
  `p_arquivada` invertido.
- **Apagar** pede confirmação no mesmo padrão do encerrar que já está ali
  (`confirmando === s.codigo`) e chama `vessel_beauty_session_apagar`. Se a
  resposta vier `situacao === 'tem_gente'`, **não mostra erro vermelho**: troca o
  botão pela frase e pelas duas saídas de verdade —

> "Esta sessão já teve **{{ s.leituras }}** leitura(s) do QR. Apagar deixaria essas leituras sem sessão. Dá para **encerrar** (continua no histórico) ou **arquivar** (sai das contas e da lista)."

⚠️ Depois de qualquer uma das três, `await carregar()` — o dado em memória não
é a tela.

⚠️ O `codigo` não entra no editável: ele está nos **dois** links já copiados (o da mesa e o do cartão).

- [ ] **Step 4: Run the suite and prove it in the browser**

Run: `npm test` → PASS. Depois o mesmo roteiro de navegador da Tarefa 10, com sessão marcada como teste e apagada no fim.

- [ ] **Step 5: Commit**

```bash
git add src/ferramentas/beauty-sessions/tela-de-beauty-sessions.vue
git commit -m "Beauty Sessions: filtrar, editar, arquivar"
```

---

### Task 12: O Stylist Circle vira tela de verdade

**Files:**
- Modify: `src/ferramentas/comercial-vessel/tela-de-stylist-circle.vue`

**Interfaces:**
- Consumes: `filtrar`, `FILTRO_VAZIO` (Tarefa 9); `<barra-de-lista>` (Tarefa 9); `vessel_stylist_criar`, `_editar`, `_desativar` (Tarefa 8); `ESTAGIOS` de `enderecos-publicos.js`.

- [ ] **Step 1: Add the "cadastrar parceira" block**

Um bloco no topo, no mesmo formato do "Marcar um encontro" do Private Edit: nome, whatsapp, cidade, instagram, atuação, praça. Grava com `chamar('vessel_stylist_criar', {...})` e mostra o **código gerado** na resposta, com botão de copiar o link dela.

⚠️ O campo **código não existe no formulário** — quem gera é o banco.

- [ ] **Step 2: Wire the bar**

```vue
<barra-de-lista v-model="filtro" :estagios="ESTAGIOS"
                :mostrar="['busca','situacao','estagio','ordem']"
                placeholder-busca="nome, cidade ou código"
                :situacoes="[
                  { valor: 'abertas', rotulo: 'Só ativas' },
                  { valor: 'encerradas', rotulo: 'Só desativadas' },
                  { valor: 'todas', rotulo: 'Todas' },
                ]"
                :ordens="[
                  { valor: 'nome', rotulo: 'Nome' },
                  { valor: 'aberturas', rotulo: 'Quem traz mais tráfego' },
                  { valor: 'data-nova', rotulo: 'Mais nova primeiro' },
                ]" />
```

⚠️ **Sem período e sem loja**: a lista é de parceiras, não de eventos numa loja.

```js
const stylistsNaTela = computed(() =>
  filtrar(stylists.value, filtro.value, { busca: ['nome', 'cidade', 'codigo'], estagio: 'estagio' }))
```

Trocar o `v-for="s in stylists"` e o bloco "Todas as stylists juntas", que passa a somar sobre `stylistsNaTela` e a dizer sobre quantas está falando.

- [ ] **Step 3: Add editar / desativar**

Em cada bloco, com `v-if="podeEditar"`:
- **Corrigir** abre os campos (nome, whatsapp, cidade, instagram, atuação, estágio) e grava com `vessel_stylist_editar`.
- **Desativar / Reativar** chama `vessel_stylist_desativar`.

⚠️ **O código aparece, mas não se edita** — é ele que está dentro de todo link já colado por aí. Mostrar como texto, ao lado do botão de copiar o link, nunca como campo.

⚠️ **A origem não aparece como campo editável.** Primeiro toque é primeiro toque.

⚠️ Ao lado do botão de desativar, a frase: "Ela sai da lista de escolher. As aberturas e os atendimentos que ela trouxe continuam contando no histórico."

- [ ] **Step 4: Run the suite and prove it in the browser**

Run: `npm test` → PASS. No navegador: cadastrar uma parceira de teste, corrigir o nome, desativar, reativar, conferir que o código não mudou, e apagar a parceira de teste pelo banco no fim.

- [ ] **Step 5: Commit**

```bash
git add src/ferramentas/comercial-vessel/tela-de-stylist-circle.vue
git commit -m "Stylist Circle: cadastrar, corrigir e desativar parceira"
```

---

### Task 13: A porta do Appointment Card, e o rótulo da permissão

**Files:**
- Modify: `src/ferramentas/comercial-vessel/enderecos-publicos.js`
- Modify: `src/ferramentas/comercial-vessel/enderecos-publicos.test.mjs`
- Modify: `src/ferramentas/comercial-vessel/tela-de-menu-comercial-vessel.vue`
- Modify: `src/compartilhado/controle-de-login-e-usuario.js:145`

**Interfaces:**
- Produces: `ENDERECO_DO_GERADOR_DE_CARTAO`.

- [ ] **Step 1: Write the failing test**

Acrescentar em `src/ferramentas/comercial-vessel/enderecos-publicos.test.mjs`:

```js
import { ENDERECO_DO_GERADOR_DE_CARTAO, SITE } from './enderecos-publicos.js'

test('o gerador do Appointment Card mora no site da Vessel', () => {
  assert.equal(ENDERECO_DO_GERADOR_DE_CARTAO, `${SITE}/geradorappointmentcard/`)
})

// ⚠️ O GERADOR ABRE VAZIO. Decisao do dono em 19/09: ele nao le nada da barra de
// endereco hoje, e ensina-lo a ler exige mexer e publicar o OUTRO repositorio.
test('a porta nao promete preenchimento que o gerador nao sabe ler', () => {
  assert.ok(!ENDERECO_DO_GERADOR_DE_CARTAO.includes('?'),
    'a porta do cartao nao leva parametro: o gerador ignora e a pessoa acha que preencheu')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/ferramentas/comercial-vessel/enderecos-publicos.test.mjs`
Expected: FAIL — `ENDERECO_DO_GERADOR_DE_CARTAO` é `undefined`.

- [ ] **Step 3: Write the implementation**

Em `enderecos-publicos.js`, ao lado de `ENDERECO_DO_CIRCLE`:

```js
/* O GERADOR DO APPOINTMENT CARD.
 *
 * ⚠️ MORA NO OUTRO REPOSITÓRIO (`rbv-co/vessel-brasil`), que o .gitignore deste
 * exclui de propósito. Isto é uma PORTA, não uma cópia: copiar o gerador para cá
 * seriam 831 linhas de tela, o fundo de 377 KB, três fontes e o codificador de
 * QR duplicados — junto com três contas delicadas que passariam a existir em
 * dose dupla: a arte que é 1,35x a especificação, o QR que tem de caber em 43
 * caracteres, e a fonte Versatile que tem ':' e ';' trocados no arquivo.
 *
 * ⚠️ E NÃO DÁ PARA EMBUTIR EM MOLDURA: a Vercel manda `frame-ancestors` e o
 * quadro sai branco, com o erro só no console.
 *
 * ⚠️ ABRE VAZIO. O gerador não lê nada da barra de endereço, e mandar
 * parâmetro faria a Client Advisor achar que preencheu quando não preencheu.
 */
export const ENDERECO_DO_GERADOR_DE_CARTAO = `${SITE}/geradorappointmentcard/`
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/ferramentas/comercial-vessel/enderecos-publicos.test.mjs`
Expected: PASS

- [ ] **Step 5: Add the sixth card to the menu**

Em `tela-de-menu-comercial-vessel.vue`, depois do card do Funil de Carrinho:

```vue
<a class="cvmenu-card" v-if="podeAtendimentos"
   :href="ENDERECO_DO_GERADOR_DE_CARTAO" target="_blank" rel="noopener noreferrer">
  <div class="cvmenu-card-icon" style="background:linear-gradient(135deg,#8a6a3a 0%,#d4b483 100%)">
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/><path d="M6 15h4"/></svg>
  </div>
  <div class="cvmenu-card-title">Appointment Card</div>
  <div class="cvmenu-card-desc">Desenha o cartão do agendamento no celular da Client Advisor. Abre o gerador no site da Vessel.</div>
  <span class="cvmenu-card-enter">↗</span>
</a>
```

⚠️ É `<a>`, não `<div>` com `@click`: sai do sistema, e a pessoa tem de poder abrir noutra aba, copiar o link e ver para onde vai antes de clicar. `rel="noopener noreferrer"` é obrigatório com `target="_blank"`.

⚠️ A seta é `↗` (sai daqui), não `→` (vai para outra tela da Central).

⚠️ Conferir que `.cvmenu-card` como `<a>` não ganhou sublinhado nem cor de link: acrescentar `text-decoration: none; color: inherit;` na classe.

- [ ] **Step 6: Fix the permission label**

Em `src/compartilhado/controle-de-login-e-usuario.js:145`:

```js
  { key: 'atendimentos', label: 'Vessel — Private Appointment', acoes: ['ver', 'editar'] },
```

⚠️ **Só o rótulo.** A `key` continua `atendimentos` — trocá-la tiraria o acesso de todo mundo de uma vez.

- [ ] **Step 7: Run the suite and prove it**

Run: `npm test` → PASS

No navegador: abrir o menu, conferir os seis cards, clicar no Appointment Card e ver o gerador abrir em aba nova. Abrir a tela de permissões e conferir o rótulo novo com as duas ações. Fotografar o menu a 375px e 1920px, claro e escuro.

⚠️ Conferir com um usuário que tenha **só `carrinho`**: o card do Appointment Card **não** pode aparecer para ele, e o do Funil **tem** de aparecer.

- [ ] **Step 8: Commit**

```bash
git add src/ferramentas/comercial-vessel/enderecos-publicos.js \
        src/ferramentas/comercial-vessel/enderecos-publicos.test.mjs \
        src/ferramentas/comercial-vessel/tela-de-menu-comercial-vessel.vue \
        src/compartilhado/controle-de-login-e-usuario.js
git commit -m "Comercial Vessel: a porta do Appointment Card, e o modulo com o nome certo"
```

---

## Fecho da entrega

- [ ] `npm test` verde, e o total de testes **maior** que o de antes. ⚠️ Uma suíte que encolhe em silêncio é teste que sumiu, não teste que passou.
- [ ] As seis telas fotografadas a 375px e 1920px, claro e escuro.
- [ ] O voltar conferido nas seis, abrindo cada uma pelo endereço direto.
- [ ] Os seis aplicadores de migration rodados, cada um com `✅ aplicada, registrada e provada`.
- [ ] `docs/pendencias.md` atualizado: a entrega 2 (a largura no resto da Central) entra como pendência, com o número medido — 45 arquivos com trava própria, ~20 de página, os quatro menus de família presos em 1160px, e o molde pronto na Gestão Comercial.
