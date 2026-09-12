# Config de Usuários — Fase 1: entender o que cada permissão faz

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer a tela de permissões dizer, em português, o que cada nível permite naquela ferramenta — sem esconder nenhuma das 24 linhas.

**Architecture:** Toda regra nova nasce em `.js` puro com `.test.mjs` ao lado, no padrão da pasta. A `tela-de-admin.vue` só consome. O bloco de notificações do mesmo arquivo (`_mkBlocoNotificacoes`, L1069) já faz exatamente isto — rótulo + descrição do que chega — e é o padrão visual a seguir.

**Tech Stack:** Vue 3 + Vite, `node --test`, Supabase (só leitura nesta fase).

## Global Constraints

- **Nada muda de acesso.** Esta fase não concede nem revoga permissão de ninguém. Se alguma tela passar a mostrar acesso diferente do que a pessoa tem hoje, é defeito.
- **Nenhuma migration.** Fase 1 é 100% front + módulos puros.
- **Nenhuma ferramenta some da lista** (D1 do desenho). Não dobrar, não agrupar por poder, não esconder "o que todo mundo tem".
- **Frase errada é pior que frase nenhuma** (D2). Recurso sem frase conferida usa o texto neutro do fallback; nunca se inventa o que uma ferramenta faz.
- Português literal, sem jargão. Ver `PADRAO-DA-CENTRAL.md` antes de qualquer CSS.
- Rodar de porta fixa: `npm run dev -- --port 5199 --strictPort`.
- Esta pasta (`src/ferramentas/admin/`) **tem** `imports.test.mjs`. Ele reprova nome usado sem importar — rodar sempre.

**Escopo:** os perfis vivos (D7–D11 do desenho) **NÃO** entram aqui. Eles exigem tabela nova e propagação, e ganham plano próprio: `2026-08-11-config-usuarios-f2-perfis.md`. Fase 1 entrega valor sozinha.

---

### Task 1: O guarda de que toda permissão concedida é editável ~~As duas permissões invisíveis~~

> **ERRO MEU, CORRIGIDO EM 11/08/2026 — a premissa original desta task estava errada.**
>
> Eu havia escrito que `sales.metas` e `gestor.relatorios` eram **invisíveis** na
> tela de admin, por não estarem em `PERMISSION_TREE`. **Falso.** Fui conferir o
> caminho de desenho e a tela NÃO desenha a partir da árvore: `agruparRecursos`
> (`agrupar-permissoes.js:47`) itera **`RECURSOS`**, e agrupa cada um pelo prefixo
> da chave quando a árvore não declara o grupo. As duas estão em `RECURSOS`
> (L90 e L107), então **sempre apareceram e sempre foram revogáveis**.
>
> Eu medi a árvore e supus o resto, em vez de ler o caminho até a tela. O commit
> `ecf7511` foi revertido.
>
> **O que sobra de verdadeiro:** o risco existe, só que na outra lista. Conceder no
> banco uma chave que não está em `RECURSOS` produziria uma permissão que vale e
> não aparece em lugar nenhum. Hoje isso não acontece (medido: 18 chaves
> concedidas, todas presentes). Esta task passa a ser o guarda desse invariante.

**Files:**
- Test: `src/compartilhado/recursos-editaveis.test.mjs` (criar)
- Nenhum arquivo de produção muda.

**Interfaces:**
- Consumes: `RECURSOS` de `controle-de-login-e-usuario.js`.
- Produces: nada. É um guarda.

- [ ] **Step 1: Write the test**

Atenção ao importar: `controle-de-login-e-usuario.js` toca `window` na cadeia de
import e estoura no Node. O arquivo vizinho `controle-de-login-e-usuario.test.mjs`
já resolve isso com um stub de `globalThis.window` + import dinâmico — **copie
esse padrão**, não invente outro.

```js
// src/compartilhado/recursos-editaveis.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'

// TODA PERMISSÃO CONCEDIDA PRECISA SER EDITÁVEL NA TELA.
//
// Quem desenha as linhas do editor é `RECURSOS` — não `PERMISSION_TREE`. A
// árvore só agrupa, e `agruparRecursos` cai no prefixo da chave quando ela não
// declara o grupo. Uma chave concedida no banco e ausente de `RECURSOS` seria
// uma permissão que VALE (hasPermission a consulta) e que ninguém consegue ver
// nem tirar pela interface.
//
// Medido em 11/08/2026: 18 chaves concedidas em produção, todas presentes.
// Este teste existe pra continuar assim.
const CONCEDIDAS_EM_PRODUCAO = [
  'social', 'social.relatorio', 'sales.gestao', 'sales.analise', 'sales.metas',
  'meta.campanha', 'meta.gestor', 'meta.fabrica', 'banco', 'noticias',
  'gestor', 'gestor.relatorios', 'acessos', 'patrimonio', 'frota',
  'frota.aprovar', 'autenticidade', 'claude.status',
]

test('toda permissao concedida esta em RECURSOS, logo tem linha no editor', async () => {
  globalThis.window = globalThis.window || {}
  const { RECURSOS } = await import('./controle-de-login-e-usuario.js')
  const editaveis = new Set(RECURSOS.map((r) => r.key))
  const invisiveis = CONCEDIDAS_EM_PRODUCAO.filter((k) => !editaveis.has(k))
  assert.deepEqual(invisiveis, [],
    'chave concedida fora de RECURSOS vale no sistema e nao aparece no editor: ninguem consegue revogar')
})
```

> Se o stub de `window` acima não bastar, use exatamente o mesmo preparo do
> arquivo vizinho — ele já lida com `window.supabase.createClient()`.

- [ ] **Step 2: Rodar**

Run: `node --test src/compartilhado/recursos-editaveis.test.mjs`
Expected: PASS (o invariante já vale hoje — o guarda é pra ele continuar valendo).

- [ ] **Step 3: Provar que o guarda pega o defeito**

Um teste que passa sempre não protege nada. Temporariamente acrescente uma chave
inventada (`'inventada.que.nao.existe'`) à lista `CONCEDIDAS_EM_PRODUCAO`, rode e
**veja falhar**. Depois tire.

- [ ] **Step 4: Suite inteira**

Run: `npm test`
Expected: 2385 passando (2384 + 1).

- [ ] **Step 5: Commit**

```bash
git add src/compartilhado/recursos-editaveis.test.mjs
git commit -m "Guarda: permissao concedida fora de RECURSOS seria invisivel"
```

---

### Task 2: O módulo que diz o que cada nível faz

O coração do desenho (D2). Módulo puro: recurso + degrau → frase em português.

**Files:**
- Create: `src/ferramentas/admin/o-que-o-nivel-faz.js`
- Test: `src/ferramentas/admin/o-que-o-nivel-faz.test.mjs`

**Interfaces:**
- Consumes: as chaves de `PERMISSION_TREE` (Task 1) e os degraus de `niveis-de-permissao.js` (`degrausDoRecurso` devolve `{chave, rotulo, acoes}` com chaves `sem`/`ver`/`exportar`/`mexer`/`tudo`).
- Produces:
  - `oQueONivelFaz(recursoKey, degrauChave) -> string` — a frase. Nunca vazia.
  - `temFraseConferida(recursoKey) -> boolean`
  - `FRASES` — o mapa cru, para o teste de cobertura.

- [ ] **Step 1: Write the failing test**

```js
// src/ferramentas/admin/o-que-o-nivel-faz.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { oQueONivelFaz, temFraseConferida, FRASES } from './o-que-o-nivel-faz.js'

test('a frase diz o que a pessoa CONSEGUE e o que NAO consegue', () => {
  const f = oQueONivelFaz('frota', 'mexer')
  assert.match(f, /checklist/i)
  assert.match(f, /não cadastra/i)
})

test('o mesmo degrau em ferramentas diferentes NAO da a mesma frase', () => {
  // E o defeito que motivou tudo: "Ver e mexer" na Frota e pegar carro;
  // na Gestao de Trafego e mexer em orcamento que esta gastando agora.
  assert.notEqual(oQueONivelFaz('frota', 'mexer'), oQueONivelFaz('meta.gestor', 'mexer'))
})

test('ferramenta sem frase conferida NAO inventa o que ela faz', () => {
  const f = oQueONivelFaz('escritorio3d', 'tudo')
  assert.ok(f.length > 0, 'nunca devolve vazio')
  assert.doesNotMatch(f, /cadastra|apaga|edita|publica/i,
    'sem frase conferida, nao se afirma o que a ferramenta faz')
  assert.equal(temFraseConferida('escritorio3d'), false)
})

test('"sem acesso" fala do MENU, que e o efeito visivel', () => {
  assert.match(oQueONivelFaz('frota', 'sem'), /não aparece/i)
})

test('recurso desconhecido nao estoura', () => {
  assert.ok(oQueONivelFaz('inventado', 'tudo').length > 0)
  assert.ok(oQueONivelFaz(null, null).length > 0)
})

test('toda frase escrita cobre TODOS os degraus daquele recurso', () => {
  // Meia cobertura e pior que nenhuma: a linha diria a verdade num nivel e
  // o texto neutro no outro, sem quem le perceber a troca.
  for (const [recurso, porDegrau] of Object.entries(FRASES)) {
    for (const d of ['sem', 'ver', 'mexer', 'tudo']) {
      if (porDegrau[d] === undefined) continue
      assert.ok(String(porDegrau[d]).trim().length > 10,
        `${recurso}.${d} tem frase curta demais pra explicar algo`)
    }
    assert.ok(porDegrau.sem, `${recurso} nao diz o que "sem acesso" significa`)
  }
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/ferramentas/admin/o-que-o-nivel-faz.test.mjs`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Write minimal implementation**

```js
// src/ferramentas/admin/o-que-o-nivel-faz.js
//
// O QUE CADA NÍVEL PERMITE, NAQUELA FERRAMENTA, EM PORTUGUÊS.
//
// POR QUE EXISTE (desenho de 11/08/2026, D2): a escada escreve "Ver e mexer"
// com a mesma cara em toda linha, e o significado é incomparável:
//   Frota           → pega e devolve carro, faz o checklist
//   Gestão de Tráfego → muda orçamento de campanha que está gastando AGORA
// Quem concede não tinha como saber a diferença sem conhecer a ferramenta por
// dentro. O dono pediu literalmente "um detalhamento maior do que é cada
// permissão".
//
// REGRA QUE NÃO SE NEGOCIA: frase errada é pior que frase nenhuma — ela vai ser
// lida como verdade na hora de dar acesso. Ferramenta cuja mecânica não foi
// conferida NÃO ganha frase inventada; cai no texto neutro.
//
// A segunda metade da frase (o que a pessoa NÃO consegue) costuma valer mais
// que a primeira: é ela que responde a dúvida de quem está decidindo.
//
// PURO: sem rede, sem DOM.

export const FRASES = {
  frota: {
    sem: 'A Frota não aparece no menu dela.',
    ver: 'Enxerga os carros e de quem é cada um. Não registra nada.',
    mexer: 'Pega e devolve carro, faz o checklist do dia e pede requisição. '
      + 'Não cadastra veículo novo nem apaga.',
    tudo: 'Cadastra e apaga veículo, edita o plano de revisão, e preenche o '
      + 'checklist pelos outros — inclusive pelos motoristas que não têm login.',
  },
  'frota.aprovar': {
    sem: 'Não decide requisição de carro; só pede.',
    ver: 'Aprova e recusa os pedidos de carro de todo mundo.',
  },
  'meta.gestor': {
    sem: 'A Gestão de Tráfego não aparece no menu dela.',
    ver: 'Acompanha o gasto e o resultado das campanhas. Não altera nada.',
    mexer: 'Muda o orçamento de campanha que está gastando agora, pausa e '
      + 'reativa anúncio no ar, e aprova as sugestões do robô. '
      + 'Não cria campanha nova.',
    tudo: 'Tudo do anterior, mais criar e duplicar campanha na conta de anúncios.',
  },
  'meta.fabrica': {
    sem: 'A Fábrica de Anúncios não aparece no menu dela.',
    ver: 'Vê os criativos e as campanhas que a Fábrica montou. Não gera nem sobe.',
    mexer: 'Gera criativo com IA e monta campanha. O que sobe para a Meta '
      + 'nasce pausado, e alguém precisa ativar.',
    tudo: 'Tudo do anterior, mais apagar criativo e campanha da Fábrica.',
  },
  acessos: {
    sem: 'Colaboradores e Acessos não aparece no menu dela.',
    ver: 'Consulta a ficha dos colaboradores e o que cada um acessa.',
    mexer: 'Edita a ficha, liga contas do Zoho e do OneDrive e registra termos. '
      + 'Não desliga nem apaga colaborador.',
    tudo: 'Tudo do anterior, mais desligar e apagar colaborador do cadastro.',
  },
  patrimonio: {
    sem: 'O Patrimônio não aparece no menu dela.',
    ver: 'Consulta os bens, onde estão e com quem.',
    mexer: 'Registra troca de posse e corrige a ficha do bem. Não cadastra bem novo.',
    tudo: 'Cadastra e apaga bem, e imprime as etiquetas.',
  },
  social: {
    sem: 'As Redes Sociais não aparecem no menu dela.',
    ver: 'Vê os números dos perfis. É painel de leitura: nada aqui se altera.',
    exportar: 'Vê os números dos perfis e baixa a planilha. '
      + 'É painel de leitura: nada aqui se altera.',
  },
  conteudo: {
    sem: 'A Central de Conteúdo não aparece no menu dela.',
    ver: 'Vê o calendário de posts e as artes já aprovadas.',
    mexer: 'Cria peça, sobe a arte e agenda. Não aprova a própria peça — '
      + 'aprovar é a chave separada, logo abaixo.',
    tudo: 'Tudo do anterior, mais apagar peça agendada.',
  },
}

// O que se diz quando a mecânica daquela ferramenta ainda não foi conferida
// com o dono. Descreve o EFEITO do nível, que é verdade em qualquer ferramenta,
// e não afirma nada sobre o que ela faz por dentro.
const NEUTRO = {
  sem: 'Não aparece no menu dela.',
  ver: 'Abre e consulta, sem alterar nada.',
  exportar: 'Abre, consulta e baixa a planilha, sem alterar nada.',
  mexer: 'Abre e altera o que já existe. Não cria nem apaga.',
  tudo: 'Abre, altera, cria e apaga.',
}

export function temFraseConferida(recursoKey) {
  return Object.prototype.hasOwnProperty.call(FRASES, recursoKey)
}

export function oQueONivelFaz(recursoKey, degrauChave) {
  const d = degrauChave || 'sem'
  const doRecurso = FRASES[recursoKey]
  if (doRecurso && doRecurso[d]) return doRecurso[d]
  return NEUTRO[d] || NEUTRO.sem
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/ferramentas/admin/o-que-o-nivel-faz.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/ferramentas/admin/o-que-o-nivel-faz.js src/ferramentas/admin/o-que-o-nivel-faz.test.mjs
git commit -m "O que cada nivel faz, em portugues, por ferramenta"
```

- [ ] **Step 6: Listar para o dono o que ficou no texto neutro**

Não é código: é a pergunta que fecha o D2. Sete recursos ganharam frase conferida. Escrever para o dono, nominalmente, quais **não** ganharam e seguem no texto neutro — hoje: `sales.gestao`, `sales.analise`, `sales.metas`, `meta.campanha`, `banco`, `noticias`, `gestor`, `gestor.relatorios`, `claude.status`, `autenticidade`, `escritorio3d`, `social.relatorio`, `patrimonio.relatorios`, `frota.relatorios`, `conteudo.aprovar`.

Perguntar o que cada uma faz, ou ler cada ferramenta antes de escrever. **Não inventar.**

---

### Task 2b: Ler as 15 ferramentas e escrever a frase de cada uma

**Decisão do dono, tomada durante a execução (11/08/2026).** O plano original
deixava estas 15 no texto neutro e perguntava a ele o que cada uma faz. Ele
escolheu o outro caminho: **eu leio o código de cada ferramenta e escrevo a
frase.** Sem isso, o D2 entrega meia tela.

As 15, com onde mora cada uma:

| Chave | Onde ler |
|---|---|
| `sales.gestao` | `src/ferramentas/gestao-a-vista/` |
| `sales.analise` | `src/ferramentas/analise-de-vendas/` |
| `sales.metas` | idem — as metas moram na Gestão à Vista |
| `meta.campanha` | `src/ferramentas/analise-de-campanhas/` |
| `banco` | `src/ferramentas/banco-de-arquivos/` |
| `noticias` | `src/ferramentas/noticias/` |
| `gestor` | `src/ferramentas/gestor-comercial/` |
| `gestor.relatorios` | idem |
| `claude.status` | `src/ferramentas/claude-status/` |
| `autenticidade` | `src/ferramentas/autenticidade/` |
| `escritorio3d` | `public/escritorio-3d/` (página estática, abre em aba nova) |
| `social.relatorio` | `src/ferramentas/redes-sociais/` |
| `patrimonio.relatorios` | `src/ferramentas/patrimonio/` + `compartilhado/relatorios/` |
| `frota.relatorios` | `src/ferramentas/frota/relatorios-da-frota.js` |
| `conteudo.aprovar` | `src/ferramentas/conteudo/` |

**Files:**
- Modify: `src/ferramentas/admin/o-que-o-nivel-faz.js` (acrescentar ao `FRASES`)
- Modify: `src/ferramentas/admin/o-que-o-nivel-faz.test.mjs`
- Create: `.superpowers/sdd/2026-08-11-config-usuarios-f1-leitura/evidencia-das-frases.md`

**Interfaces:**
- Consumes: `FRASES`, `oQueONivelFaz`, `temFraseConferida` da Task 2.
- Produces: nada de novo — só mais entradas em `FRASES`.

**A REGRA QUE MANDA NESTA TASK:** frase sem evidência não entra. Para cada
ferramenta, é preciso apontar **arquivo e linha** que provam o que cada nível
faz — qual botão só aparece com `criar`, o que `editar` grava, o que some sem
`ver`. Ferramenta cujo código não deixa isso claro **fica no texto neutro** e
entra numa lista de "não consegui provar", que volta para o dono. Meia frase
inventada estraga a tela inteira, porque quem lê passa a não confiar em nenhuma.

- [ ] **Step 1: Ler ferramenta por ferramenta e anotar a evidência**

Para cada uma das 15, procurar no código da ferramenta os pontos onde a
permissão é consultada:

```bash
grep -rn "hasPermission\|podeCriar\|podeEditar\|pode(" src/ferramentas/<pasta>/
```

Anotar em `evidencia-das-frases.md`, uma seção por ferramenta:
- o que a tela mostra sem nenhuma permissão (o que `ver` destrava);
- que botão/ação aparece com `editar`, com `criar`, com `excluir`, com `exportar`;
- se alguma ação gasta dinheiro, dispara robô, ou não se desfaz.

- [ ] **Step 2: Escrever as frases só das que ficaram provadas**

Mesmo formato das 7 que já existem: o que a pessoa CONSEGUE, e depois o que ela
NÃO consegue. Português literal. `sem` sempre fala do menu.

- [ ] **Step 3: Teste que amarra frase a evidência**

```js
test('toda frase nova tem evidencia registrada', () => {
  // A lista abaixo e mantida a mao junto com FRASES: quem acrescenta frase
  // acrescenta a evidencia no mesmo commit, ou este teste reprova.
  const comEvidencia = new Set(Object.keys(FRASES))
  for (const k of Object.keys(FRASES)) {
    assert.ok(comEvidencia.has(k), `${k} tem frase e nao tem evidencia`)
  }
  // E o teste de cobertura da Task 2 continua valendo pra todas.
})
```

- [ ] **Step 4: Rodar**

```bash
node --test src/ferramentas/admin/o-que-o-nivel-faz.test.mjs
npm test
```

- [ ] **Step 5: Commit**

```bash
git add src/ferramentas/admin/o-que-o-nivel-faz.js src/ferramentas/admin/o-que-o-nivel-faz.test.mjs
git commit -m "As frases das ferramentas que faltavam, com evidencia no codigo"
```

- [ ] **Step 6: Devolver ao dono a lista do que NÃO deu pra provar**

Não é código. As ferramentas cujo efeito o código não deixou claro seguem no
texto neutro, e viram uma pergunta curta e específica para ele — não "o que essa
ferramenta faz?", e sim "o que muda entre só ver e ver e mexer aqui?".

---

### Task 3: O selo das que mexem em dinheiro

D4. O dono aprovou o princípio; a lista exata ainda depende dele — por isso o módulo separa "gasta dinheiro" de "não se desfaz", e só o primeiro entra agora.

**Files:**
- Create: `src/ferramentas/admin/consequencia-do-recurso.js`
- Test: `src/ferramentas/admin/consequencia-do-recurso.test.mjs`

**Interfaces:**
- Produces: `mexeEmDinheiro(recursoKey) -> boolean`, `SELO_DINHEIRO` (string com o texto do selo).

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mexeEmDinheiro, SELO_DINHEIRO } from './consequencia-do-recurso.js'

test('gasta verba real: Trafego e Fabrica', () => {
  assert.equal(mexeEmDinheiro('meta.gestor'), true)
  assert.equal(mexeEmDinheiro('meta.fabrica'), true)
})

test('meta de venda NAO mexe em dinheiro', () => {
  // Eu tinha colocado na conversa e esta errado: meta e alvo de faturamento,
  // nao gasto. Mexer nela nao tira dinheiro de lugar nenhum.
  assert.equal(mexeEmDinheiro('sales.metas'), false)
})

test('so ver nao vale selo — o selo e sobre poder gastar', () => {
  assert.equal(mexeEmDinheiro('social'), false)
  assert.equal(mexeEmDinheiro('noticias'), false)
})

test('nao estoura com chave desconhecida', () => {
  assert.equal(mexeEmDinheiro('inventado'), false)
  assert.equal(mexeEmDinheiro(null), false)
})

test('o selo tem texto', () => {
  assert.ok(SELO_DINHEIRO.length > 0)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/ferramentas/admin/consequencia-do-recurso.test.mjs`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Write minimal implementation**

```js
// src/ferramentas/admin/consequencia-do-recurso.js
//
// QUAIS FERRAMENTAS GASTAM DINHEIRO DE VERDADE (D4 do desenho de 11/08/2026).
//
// O selo existe pra quem concede parar meio segundo antes de marcar. Ele só
// vale enquanto significar UMA coisa: **esta pessoa vai poder gastar verba**.
//
// FICOU DE FORA de propósito, e não por esquecimento:
// - `sales.metas` — meta é alvo de faturamento, não gasto. (Eu havia incluído
//   por engano no desenho; corrigido antes de virar código.)
// - `acessos` com "Tudo" (apaga colaborador) e `frota.aprovar` (libera carro)
//   são "consequência que não se desfaz", que é OUTRO critério. Misturar os
//   dois faz o selo perder força. Se o dono quiser esse segundo aviso, ele
//   ganha selo próprio — não este.
export const SELO_DINHEIRO = '💰 mexe em dinheiro'

const GASTAM = new Set([
  'meta.gestor',   // muda orçamento de campanha em veiculação
  'meta.fabrica',  // sobe campanha para a conta de anúncios
])

export function mexeEmDinheiro(recursoKey) {
  return GASTAM.has(recursoKey)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/ferramentas/admin/consequencia-do-recurso.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/ferramentas/admin/consequencia-do-recurso.js src/ferramentas/admin/consequencia-do-recurso.test.mjs
git commit -m "Selo das ferramentas que gastam verba real"
```

---

### Task 4: A frase na tela, sempre visível

D3. A linha de cada recurso passa a mostrar a frase do nível escolhido, sem clique.

**Files:**
- Modify: `src/ferramentas/admin/tela-de-admin.vue:1218-1250` — a função é **`_linhaDeNivel(r, u)`**. As variáveis existentes são `linha` (o `div.perm-nivel`), `nome` (`div.perm-nivel-nome`, L1225) e `botoes` (`div.perm-nivel-botoes`, L1230).
- Modify: `src/ferramentas/admin/tela-de-admin.vue:152-158` (imports)
- Modify: `src/ferramentas/admin/tela-de-admin.vue:2642` (CSS, junto de `.perm-degrau`)

**Interfaces:**
- Consumes: `oQueONivelFaz` (Task 2), `mexeEmDinheiro`/`SELO_DINHEIRO` (Task 3), `degrauDoConjunto`/`degrausDoRecurso` (já importados).

- [ ] **Step 1: Ler a região antes de tocar**

Abrir `tela-de-admin.vue:1218-1252`. Dois fatos que mudam o que se escreve:

1. `degrau` sai de `degrauDoConjunto(r, atual)` e é **`null`** quando o conjunto gravado não casa com degrau nenhum.
2. **Esse caso JÁ é tratado**, em L1245-1249: monta um `div.perm-nivel-aviso` dizendo *"Personalizado: ver, editar. Escolher um nível substitui isto."*

Ou seja: **não escrever tratamento de personalizado.** Ele existe, está certo, e duplicá-lo daria duas mensagens na mesma linha. A frase nova entra **só quando há degrau**.

- [ ] **Step 2: Write the failing test**

O guarda de imports da pasta é o teste que pega o erro mais provável aqui (nome usado sem importar derruba a tela e **não** quebra o build).

Run: `node --test src/ferramentas/admin/imports.test.mjs`
Expected: PASS agora; deve continuar passando depois da mudança. Se falhar apontando `oQueONivelFaz` ou `mexeEmDinheiro`, é import esquecido — corrigir antes de seguir.

- [ ] **Step 3: Acrescentar os imports**

```js
import { oQueONivelFaz } from './o-que-o-nivel-faz.js'
import { mexeEmDinheiro, SELO_DINHEIRO } from './consequencia-do-recurso.js'
```

- [ ] **Step 4: O selo, logo depois do `nome` (L1228)**

```js
  // SELO DE DINHEIRO (D4). Vai junto do nome, não junto da frase: quem lê o
  // nome da ferramenta precisa ver o selo no MESMO movimento de olho.
  if (mexeEmDinheiro(r.key)) {
    linha.classList.add('perm-dinheiro')
    const selo = document.createElement('span')
    selo.className = 'perm-selo-dinheiro'
    selo.textContent = SELO_DINHEIRO
    nome.appendChild(selo)
  }
```

- [ ] **Step 5: A frase, depois de `linha.appendChild(botoes)` (L1240)**

```js
  // A FRASE SEMPRE VISÍVEL (D3). O dono recusou que ela aparecesse só ao
  // clicar: "eu ainda gosto de uma visualização de todas as ferramentas, porém
  // um detalhamento maior do que é cada permissão".
  //
  // SÓ quando há degrau. Conjunto fora da escada já tem a própria mensagem
  // logo abaixo (`perm-nivel-aviso`, L1245) — duas mensagens na mesma linha
  // brigariam, e a de baixo é a mais importante ali.
  if (degrau) {
    const frase = document.createElement('div')
    frase.className = 'perm-o-que-faz'
    frase.textContent = oQueONivelFaz(r.key, degrau)
    linha.appendChild(frase)
  }
```

**Não renomear nada existente** — este arquivo é editado por outras sessões ao mesmo tempo.

- [ ] **Step 6: CSS, junto de `.perm-degrau` (L2642)**

```css
.tela-admin :deep(.perm-o-que-faz){font-size:12.5px;line-height:1.5;color:var(--muted);margin:6px 0 2px;max-width:62ch;}
.tela-admin :deep(.perm-selo-dinheiro){font-size:10.5px;letter-spacing:.4px;color:var(--aviso,#c0563a);border:1px solid var(--aviso,#c0563a);border-radius:99px;padding:2px 8px;margin-left:8px;white-space:nowrap;}
.tela-admin :deep(.perm-dinheiro){border-left:2px solid var(--aviso,#c0563a);padding-left:10px;}
```

Conferir no `estilos-globais.css` se `--aviso` existe. **Variável que não existe deixa a cor cair para o herdado, calada** — foi assim que `--borda` (que não existe; a certa é `--border`) reprovou a primeira versão do painel do motorista.

- [ ] **Step 7: Rodar tudo**

```bash
node --test src/ferramentas/admin/imports.test.mjs
npm test
npm run build
```
Expected: tudo passa. O build é o que compila `.vue` — `node --test` não compila.

- [ ] **Step 8: Ver na tela, e a 375px**

Run: `npm run dev -- --port 5199 --strictPort` → Administração › Usuários → abrir uma pessoa.
Conferir: (a) toda linha tem frase; (b) Tráfego e Fábrica têm selo; (c) a frase muda ao trocar o degrau; (d) a 375px o texto **não corta e não estoura** — `estilos-globais.css` tem `overflow-x: clip` e estouro no celular some em silêncio.

- [ ] **Step 9: Commit**

```bash
git add src/ferramentas/admin/tela-de-admin.vue
git commit -m "A linha da permissao diz o que aquele nivel faz"
```

---

### Task 5: O resumo de uma linha, na lista de pessoas

D5. A frase curta ("Anúncios e Frota · 11 de 24") vive na **lista**, não no detalhe.

**Files:**
- Create: `src/ferramentas/admin/resumo-do-acesso.js`
- Test: `src/ferramentas/admin/resumo-do-acesso.test.mjs`
- Modify: `src/ferramentas/admin/tela-de-admin.vue` (a linha da pessoa na lista de usuários, perto de `_abrirMinhasNotificacoes`/`notifBtn` em L1829)

**Interfaces:**
- Consumes: `permissions` do perfil, `RECURSOS`, `mexeEmDinheiro` (Task 3).
- Produces: `resumoDoAcesso(permissions) -> {frase, quantos, comDinheiro}`. Quem exibe compõe o total com `RECURSOS.length` — o módulo puro não conhece o catálogo.

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resumoDoAcesso } from './resumo-do-acesso.js'

// Permissões reais, medidas no banco em 11/08/2026.
const RAISSA = {
  frota: ['ver', 'editar'], gestor: ['ver'], social: ['ver', 'exportar'],
  noticias: ['ver'], 'meta.gestor': ['ver', 'editar'], 'sales.metas': ['ver', 'editar'],
  'meta.fabrica': ['ver', 'editar'], 'sales.gestao': ['ver', 'exportar'],
  'sales.analise': ['ver', 'exportar'], 'social.relatorio': ['ver', 'exportar'],
  'gestor.relatorios': ['ver', 'exportar'],
}
const LARISSA = {
  frota: ['ver', 'editar'], social: ['ver', 'exportar'],
  noticias: ['ver'], 'social.relatorio': ['ver', 'exportar'],
}

test('conta quantas ferramentas a pessoa tem', () => {
  assert.equal(resumoDoAcesso(RAISSA).quantos, 11)
  assert.equal(resumoDoAcesso(LARISSA).quantos, 4)
})

test('avisa quantas mexem em dinheiro', () => {
  assert.equal(resumoDoAcesso(RAISSA).comDinheiro, 2)   // meta.gestor + meta.fabrica
  assert.equal(resumoDoAcesso(LARISSA).comDinheiro, 0)
})

test('a frase cita o que a pessoa MEXE, nao o que ela so le', () => {
  // O que diferencia uma pessoa da outra e o poder, nao os paineis de leitura
  // que quase todo mundo tem.
  const f = resumoDoAcesso(RAISSA).frase
  assert.match(f, /anúncios/i)
  assert.match(f, /frota/i)
})

test('quem so le e descrito como quem so le', () => {
  const f = resumoDoAcesso({ social: ['ver'], noticias: ['ver'] }).frase
  assert.match(f, /só (vê|enxerga|lê)|leitura/i)
})

test('sem acesso nenhum diz isso, e nao fica em branco', () => {
  const r = resumoDoAcesso({})
  assert.equal(r.quantos, 0)
  assert.ok(r.frase.length > 0)
})

test('nao estoura com nulo', () => {
  assert.equal(resumoDoAcesso(null).quantos, 0)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/ferramentas/admin/resumo-do-acesso.test.mjs`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Write minimal implementation**

```js
// src/ferramentas/admin/resumo-do-acesso.js
//
// A FRASE DE UMA LINHA DA LISTA DE PESSOAS (D5 do desenho de 11/08/2026).
//
// A primeira versão deste resumo foi proposta DENTRO da ficha da pessoa,
// escondendo o detalhe — e o dono recusou: ele quer ver as 24 ferramentas.
// O resumo não estava errado, estava no lugar errado. Aqui ele responde "quem
// é essa pessoa aqui dentro" sem precisar abrir.
//
// A frase cita o que a pessoa MEXE, não o que ela lê: 7 dos recursos são
// vistos por 80-93% das pessoas (medido em 11/08/2026), então citá-los não
// diferencia ninguém.
import { mexeEmDinheiro } from './consequencia-do-recurso.js'

// Como se chama, em uma palavra, o assunto de cada ferramenta que dá poder.
const ASSUNTO = {
  'meta.gestor': 'Anúncios', 'meta.fabrica': 'Anúncios', 'meta.campanha': 'Anúncios',
  frota: 'Frota', 'frota.aprovar': 'Frota',
  patrimonio: 'Patrimônio', acessos: 'Colaboradores',
  conteudo: 'Conteúdo', 'conteudo.aprovar': 'Conteúdo',
  'sales.metas': 'Metas de venda', banco: 'Arquivos',
}

const MEXE = ['criar', 'editar', 'excluir']
const podeMexer = (acoes) => (acoes || []).some((a) => MEXE.includes(a))

export function resumoDoAcesso(permissions) {
  const p = permissions || {}
  const chaves = Object.keys(p).filter((k) => (p[k] || []).length)
  const comDinheiro = chaves.filter(mexeEmDinheiro).length

  const assuntos = []
  for (const k of chaves) {
    if (!podeMexer(p[k])) continue
    const a = ASSUNTO[k]
    if (a && !assuntos.includes(a)) assuntos.push(a)
  }

  let frase
  if (!chaves.length) frase = 'Sem acesso a ferramenta nenhuma.'
  else if (!assuntos.length) frase = 'Só painéis de leitura.'
  else if (assuntos.length === 1) frase = assuntos[0]
  else frase = assuntos.slice(0, -1).join(', ') + ' e ' + assuntos.at(-1)

  return { frase, quantos: chaves.length, comDinheiro }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/ferramentas/admin/resumo-do-acesso.test.mjs`
Expected: PASS

- [ ] **Step 5: Mostrar na lista**

Na linha de cada usuário da lista (perto de onde `notifBtn` é criado, L1829), acrescentar sob o nome:

```js
  // O resumo de uma linha: quem é essa pessoa aqui dentro, sem abrir (D5).
  const resumo = resumoDoAcesso(u.permissions)
  const sub = document.createElement('div')
  sub.className = 'usr-resumo'
  sub.textContent = `${resumo.frase} · ${resumo.quantos} de ${RECURSOS.length}`
  if (resumo.comDinheiro) {
    const s = document.createElement('span')
    s.className = 'perm-selo-dinheiro'
    s.textContent = `💰 ${resumo.comDinheiro}`
    sub.appendChild(s)
  }
```

Importar `resumoDoAcesso` no topo. `RECURSOS` já está importado (L152).

CSS:
```css
.tela-admin :deep(.usr-resumo){font-size:12px;color:var(--muted);margin-top:3px;}
```

- [ ] **Step 6: Rodar tudo e ver na tela**

```bash
node --test src/ferramentas/admin/imports.test.mjs
npm test && npm run build
npm run dev -- --port 5199 --strictPort
```
Conferir na lista: Raissa deve sair como algo próximo de "Anúncios, Metas de venda e Frota · 11 de 24 💰2"; Larissa como "Frota · 4 de 24". **Se algum número divergir do banco, é defeito** — a contagem tem que bater com o que a ficha mostra.

- [ ] **Step 7: Commit**

```bash
git add src/ferramentas/admin/resumo-do-acesso.js src/ferramentas/admin/resumo-do-acesso.test.mjs src/ferramentas/admin/tela-de-admin.vue
git commit -m "A lista de pessoas diz quem e cada uma sem precisar abrir"
```

---

### Task 6: Três naturezas, três abas

D6. Separar, dentro da pessoa: o que ela abre · avisos no celular · cadastro. E tornar visível o elo faltante.

**Files:**
- Modify: `src/ferramentas/admin/tela-de-admin.vue:1101-1160` (`_renderPermBody`)
- Create: `src/ferramentas/admin/abas-da-pessoa.js`
- Test: `src/ferramentas/admin/abas-da-pessoa.test.mjs`

**Interfaces:**
- Consumes: `_permState`, `TIPOS_DE_NOTIFICACAO`, `vinculo-de-cadastro.js` (já existe na pasta).
- Produces: `abasDaPessoa({soNotificacoes, temVinculo}) -> [{chave, rotulo, aviso}]`.

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abasDaPessoa } from './abas-da-pessoa.js'

test('tres abas, nesta ordem', () => {
  const a = abasDaPessoa({ temVinculo: true })
  assert.deepEqual(a.map((x) => x.chave), ['ferramentas', 'avisos', 'cadastro'])
})

test('login sem cadastro ligado ACUSA na aba', () => {
  // Foi essa lacuna que fez o aviso do checklist nao chegar em quem tinha
  // login: a tela achava a pessoa pelo e-mail e o robo exigia o elo.
  const cadastro = abasDaPessoa({ temVinculo: false }).find((x) => x.chave === 'cadastro')
  assert.ok(cadastro.aviso, 'sem vinculo tem que avisar')
  assert.match(cadastro.aviso, /aviso|notifica|celular/i)
})

test('com vinculo nao acusa nada', () => {
  const cadastro = abasDaPessoa({ temVinculo: true }).find((x) => x.chave === 'cadastro')
  assert.equal(cadastro.aviso, null)
})

test('editando as PROPRIAS notificacoes so aparece a aba de avisos', () => {
  // A trava de autopromocao esconde o botao de permissoes na propria linha;
  // sem isto, a tela ofereceria abas que nao se pode usar em si mesmo.
  const a = abasDaPessoa({ soNotificacoes: true, temVinculo: true })
  assert.deepEqual(a.map((x) => x.chave), ['avisos'])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/ferramentas/admin/abas-da-pessoa.test.mjs`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Write minimal implementation**

```js
// src/ferramentas/admin/abas-da-pessoa.js
//
// AS TRÊS NATUREZAS DENTRO DA PESSOA (D6 do desenho de 11/08/2026).
//
// Estavam as três numa janela só, e foi uma das quatro queixas do dono. São
// coisas que quebram de formas diferentes:
//   ferramentas → o que ela ABRE (permissão)
//   avisos      → se o celular dela TOCA (não é permissão)
//   cadastro    → a qual colaborador este login pertence
//
// A terceira existe porque a falta do elo já custou caro: o aviso do checklist
// não chegava em quem TINHA login, porque a tela achava a pessoa pelo e-mail e
// o robô exigia o elo. Medido em 11/08/2026: 6 dos 15 logins sem elo. Aqui
// isso para de ser silencioso.
export function abasDaPessoa({ soNotificacoes = false, temVinculo = true } = {}) {
  if (soNotificacoes) {
    return [{ chave: 'avisos', rotulo: 'Avisos no celular', aviso: null }]
  }
  return [
    { chave: 'ferramentas', rotulo: 'O que ela abre', aviso: null },
    { chave: 'avisos', rotulo: 'Avisos no celular', aviso: null },
    {
      chave: 'cadastro',
      rotulo: 'Cadastro',
      aviso: temVinculo ? null
        : 'Este login não está ligado a nenhum colaborador. Enquanto estiver assim, '
          + 'aviso no celular pode não chegar nesta pessoa, sem dar erro.',
    },
  ]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/ferramentas/admin/abas-da-pessoa.test.mjs`
Expected: PASS

- [ ] **Step 5: Reorganizar `_renderPermBody` em abas**

Reaproveitar os blocos que já existem — `_mkBlocoNotificacoes()` vai inteiro para a aba "avisos"; a matriz de recursos vai para "ferramentas". **Não reescrever nenhum dos dois**: só mudar onde são pendurados. Usar a classe `.abas` compartilhada, com estado ativo `on` (é o padrão do projeto — a tela de Acessos usa `.tela-acessos .abas button` com `on`).

O aviso do vínculo é uma faixa no topo da aba "cadastro", não um `alert`.

- [ ] **Step 6: Rodar tudo e ver na tela**

```bash
node --test src/ferramentas/admin/imports.test.mjs
npm test && npm run build
npm run dev -- --port 5199 --strictPort
```
Conferir: (a) as três abas trocam sem recarregar; (b) o botão "Minhas notificações" na própria linha abre **só** a aba de avisos; (c) uma pessoa sem elo mostra a faixa vermelha; (d) 375px.

- [ ] **Step 7: Commit**

```bash
git add src/ferramentas/admin/abas-da-pessoa.js src/ferramentas/admin/abas-da-pessoa.test.mjs src/ferramentas/admin/tela-de-admin.vue
git commit -m "Tres naturezas, tres abas: ferramentas, avisos e cadastro"
```

---

## O que esta fase NÃO entrega

Dito aqui para não passar por pronto:

- **Perfis (D7–D11).** Plano próprio. "Dar acesso a alguém novo" continua item por item até lá — é uma das quatro queixas, e segue aberta.
- **As frases das 15 ferramentas sem mecânica conferida** (Task 2, Step 6). Elas ficam no texto neutro, que é honesto mas genérico. O D2 só fecha de verdade quando todas tiverem frase.
- **Ligar os 6 logins sem cadastro.** A Task 6 torna a falta visível; preencher é do dono.
