# Register Later — as três telas (pendência B9)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar à cliente um jeito de pedir "me lembra depois" na peça não registrada, um jeito de sair do lembrete em um toque, e à equipe uma lista para socorrer quem pedir ajuda.

**Architecture:** O banco, o robô e as duas ações da edge **já estão no ar e provados** — esta entrega é só tela. Duas páginas no site da Vessel (repositório `vessel-brasil`, publicado por GitHub Actions) e uma lista no painel da Central (repositório `iamundi`, publicado pela Vercel no push). Cada tela põe o que dá para testar num módulo `.js` puro, com teste, e a fiação do template fica guardada por teste que lê o fonte.

**Tech Stack:** HTML + JavaScript de módulo no site da Vessel; Vue 3 na Central; `node --test` nos dois.

**Spec:** `docs/superpowers/specs/2026-09-19-register-later-design.md` (aprovado pelo dono em 19/09/2026)

## Global Constraints

- ⚠️ **O AGRADECIMENTO É O MESMO EM QUALQUER CASO.** `vessel_lembrete_criar` responde `{ok:true}` igual quando a peça já tem dona, quando já existe lembrete e quando o teto de 24h estourou — **de propósito**. Traduzir `motivo` em mensagem diferente transformaria a página num jeito de descobrir, por fora, quais bolsas já têm dona. A tela lê `ok` e nada mais.
- ⚠️ **O CAMPO É `token_lembrete`, NUNCA `token`.** Em todas as outras ações da edge `vessel-conta`, `token` é o token de SESSÃO da cliente. Mandar a sessão para uma porta que a trata como token de e-mail é o defeito que o nome existe para evitar. Já há teste em `porta.test.mjs` guardando isso.
- ⚠️ **`/verify/parar-lembrete` sempre diz que a pessoa não vai mais receber** — com token certo, errado, velho ou vazio. É verdade em todos os casos, e responder outra coisa transformaria o endereço num testador de tokens. Quem decide isso é o banco; a tela só repassa.
- ⚠️ **Nada de sessão em `parar-lembrete`.** Quem clica veio de um e-mail, não está logada, e muitas vezes nem tem conta — o lembrete existe justamente para quem ainda não registrou.
- **O e-mail aparece inteiro no painel**, por decisão do dono: é dele que a equipe precisa para socorrer a cliente. O painel é **só leitura** nesta entrega.
- Comentários e textos de tela em português do Brasil, no estilo generoso com "⚠️" que explica POR QUÊ.
- Regra que importa mora em módulo `.js` com teste, **E** com guarda que lê o fonte da tela afirmando que ela chama a regra certa com o argumento certo. Teste de função pura não enxerga o que o template fez.
- Prova de guarda é **mutação de verdade** no arquivo: quebrar, rodar, colar a falha, restaurar, conferir com `git diff`. Apagar um export e ver erro de importação **não** é prova.
- ⚠️ Nenhuma escrita em produção nas provas de tela. A rede vai interceptada.

## O que já está de pé (medido em 21/09/2026, não suposto)

| Peça | Estado |
|---|---|
| Tabela `vessel_lembretes` | existe, RLS ligada, política `SELECT` para `authenticated` com `is_vessel_admin()` — o mesmo portão de `vessel_pecas` e `vessel_registros` |
| As 5 funções | no ar, corpo idêntico ao arquivo, `security definer`, `search_path=public` |
| Edge `vessel-lembretes` | publicada, v1, `verify_jwt` **desligado** |
| Edge `vessel-conta` | publicada, v8, com as ações `lembrete-criar` e `lembrete-parar` |
| Segredo `vessel-lembretes` | gravado em `segredos_de_cron` |
| Cron | ativo, `0 12 * * *`, rodou 20 e 21/09 com sucesso |
| Lembretes na tabela | **0** — porque ainda não existe tela para criar um |

**O contrato da edge, como está escrito hoje:**

```
POST /functions/v1/vessel-conta
  { acao: 'lembrete-criar', codigo, email, token?, consentimento: true }
     -> { ok: true }            (SEMPRE que deu certo OU foi recusado por regra)
     -> { ok: false, motivo }   (só quando a chamada em si falhou)

  { acao: 'lembrete-parar', token_lembrete }
     -> { ok: true }            (SEMPRE)
```

---

### Task 1: O botão "Deixar para depois" e a folha (site da Vessel)

**Files:**
- Modify: `vessel-brasil/verify/index.html` (o botão ao lado de "Registrar no meu nome", linha ~473; a folha; o agradecimento)
- Modify: `vessel-brasil/verify/regras.js` (as regras novas)
- Modify: `vessel-brasil/verify/regras.test.mjs` (os testes)

**Interfaces:**
- Produces: `problemasDoLembrete({ email, consentimento })` → array de frases em português; `corpoDoLembrete({ codigo, email, token, })` → o objeto exato que a edge espera.

- [ ] **Step 1: Escrever o teste que falha**

Em `verify/regras.test.mjs`:

```js
import { problemasDoLembrete, corpoDoLembrete } from './regras.js'

test('sem consentimento nao deixa pedir', () => {
  const p = problemasDoLembrete({ email: 'a@b.com', consentimento: false })
  assert.equal(p.length, 1)
  assert.match(p[0], /lembrar/i)
})

test('e-mail vazio ou torto e barrado ANTES de chamar a edge', () => {
  for (const e of ['', '   ', 'sem-arroba', 'a@', '@b.com', 'a b@c.com']) {
    const p = problemasDoLembrete({ email: e, consentimento: true })
    assert.ok(p.length >= 1, `deixou passar: ${JSON.stringify(e)}`)
  }
})

test('e-mail bom com consentimento nao tem problema', () => {
  assert.deepEqual(problemasDoLembrete({ email: ' Ana@Exemplo.COM ', consentimento: true }), [])
})

// ⚠️ O CAMPO E `token`, o de SESSAO, so quando a cliente esta logada — a edge
// usa isso para amarrar o lembrete a conta dela. Nao confundir com
// `token_lembrete`, que e outro campo, de outra acao.
test('o corpo leva exatamente o que a edge espera', () => {
  const c = corpoDoLembrete({ codigo: 'K7M4X9QP2R', email: ' Ana@Exemplo.COM ', token: 'sess-123' })
  assert.deepEqual(Object.keys(c).sort(),
    ['acao', 'codigo', 'consentimento', 'email', 'token'])
  assert.equal(c.acao, 'lembrete-criar')
  assert.equal(c.consentimento, true)
  assert.equal(c.email, 'ana@exemplo.com')   // limpo e em minusculas
})

test('sem sessao, o corpo NAO leva token', () => {
  const c = corpoDoLembrete({ codigo: 'K7M4X9QP2R', email: 'a@b.com', token: null })
  assert.ok(!('token' in c), 'mandou token nulo; a edge espera o campo ausente')
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd vessel-brasil && node --test verify/regras.test.mjs`
Expected: FAIL — `problemasDoLembrete` não existe.

- [ ] **Step 3: Escrever as regras**

Em `verify/regras.js`, reaproveitando o que já existe no arquivo (há `whatsappValido`, `cpfValido` etc. — seguir a mesma forma). ⚠️ Não inventar validação de e-mail elaborada: o banco recusa e-mail inválido de qualquer jeito, e a validação da tela existe só para a pessoa não perder o clique.

- [ ] **Step 4: Rodar e ver passar**

- [ ] **Step 5: A tela**

O botão discreto ao lado de "Registrar no meu nome" (`verify/index.html:473`), **só quando a peça não tem dona** — a mesma condição que já decide mostrar o botão de registrar. A folha com o campo de e-mail (preenchido com o da conta quando houver sessão) e a marcação de consentimento com o texto do desenho: *"pode me lembrar por e-mail sobre esta peça"*.

⚠️ Confirmando, a tela **agradece e para de oferecer o registro naquela visita** — é o que o desenho pede. E o agradecimento é o mesmo texto para `ok:true`, seja qual for o motivo por trás.

- [ ] **Step 6: A guarda de fiação**

Teste que lê `verify/index.html` como texto e afirma: que a chamada usa `acao: 'lembrete-criar'`; que o corpo vem de `corpoDoLembrete(`; e que **não existe** no arquivo nenhuma tradução de `motivo` em mensagem para a cliente (procurar por `motivo` perto de texto de tela). Provar por mutação de verdade.

- [ ] **Step 7: Commit**

---

### Task 2: A tela de parar o lembrete (site da Vessel)

**Files:**
- Create: `vessel-brasil/verify/parar-lembrete/index.html`
- Modify: `vessel-brasil/vercel.json` (a rota, se o padrão do site exigir)
- Modify: `vessel-brasil/verify/regras.js` e `regras.test.mjs`

**Interfaces:**
- Consumes: nada da Task 1.
- Produces: `corpoDeParar(token)` → `{ acao: 'lembrete-parar', token_lembrete }`.

- [ ] **Step 1: Escrever o teste que falha**

```js
import { corpoDeParar } from './regras.js'

// ⚠️ `token_lembrete`, NUNCA `token`. Em todas as outras acoes desta edge,
// `token` e o token de SESSAO da cliente; mandar a sessao para uma porta que a
// trata como token de e-mail e o defeito que este nome existe para evitar.
test('o corpo usa token_lembrete, e nao token', () => {
  const c = corpoDeParar('abc123')
  assert.deepEqual(Object.keys(c).sort(), ['acao', 'token_lembrete'])
  assert.equal(c.acao, 'lembrete-parar')
  assert.equal(c.token_lembrete, 'abc123')
  assert.ok(!('token' in c))
})

test('token ausente vira nulo, e a chamada acontece do mesmo jeito', () => {
  assert.equal(corpoDeParar(null).token_lembrete, null)
  assert.equal(corpoDeParar(undefined).token_lembrete, null)
})
```

- [ ] **Step 2: Rodar e ver falhar**
- [ ] **Step 3: Escrever `corpoDeParar`**
- [ ] **Step 4: Rodar e ver passar**

- [ ] **Step 5: A página**

Sem login, sem pedir nada. Lê o token do endereço, chama a edge e diz **sempre** que a pessoa não vai mais receber.

⚠️ **Uma frase só, um caminho só.** Não existe tela de erro aqui: token certo, errado, velho ou ausente terminam na mesma mensagem. Não é gentileza — é o que impede o endereço de virar um testador de tokens.
⚠️ Se a chamada em si falhar (rede fora), aí sim dizer que não deu para completar agora e oferecer tentar de novo. Isso é diferente de "o token não serviu", que a tela **nunca** informa.

- [ ] **Step 6: A guarda de fiação**

Teste lendo o fonte: usa `corpoDeParar(`, contém `token_lembrete`, e **não** contém nenhum ramo que mostre mensagem diferente conforme a resposta do banco. Provar por mutação.

- [ ] **Step 7: Commit**

---

### Task 3: A lista no painel de Autenticidade (Central)

**Files:**
- Modify: `src/ferramentas/autenticidade/tela-de-autenticidade.vue`
- Create: `src/ferramentas/autenticidade/lembretes-regras.js` e `.test.mjs`

**Interfaces:**
- Consumes: a tabela `vessel_lembretes` por PostgREST, com a sessão da pessoa (RLS já libera `SELECT` para `authenticated` sob `is_vessel_admin()`).
- Produces: `estadoDoLembrete(linha)` → `'aberto' | 'cancelado pela cliente' | 'encerrado pelo registro'`; `oQueJaFoiEnviado(linha)` → texto.

- [ ] **Step 1: Escrever o teste que falha**

```js
import { estadoDoLembrete, oQueJaFoiEnviado } from './lembretes-regras.js'

test('o estado sai das colunas, e cada um tem nome proprio', () => {
  assert.equal(estadoDoLembrete({ cancelado_em: null, cancelado_por: null }), 'aberto')
  assert.equal(estadoDoLembrete({ cancelado_em: '2026-09-20', cancelado_por: 'cliente' }),
    'cancelado pela cliente')
  assert.equal(estadoDoLembrete({ cancelado_em: '2026-09-20', cancelado_por: 'registro' }),
    'encerrado pelo registro')
})

// ⚠️ NULO NAO E FALSO. `cancelado_em` nulo com `cancelado_por` preenchido nao
// existe hoje, mas se existir a tela nao pode chamar de "aberto" em silencio.
test('estado incoerente nao vira "aberto" calado', () => {
  const r = estadoDoLembrete({ cancelado_em: null, cancelado_por: 'cliente' })
  assert.notEqual(r, 'aberto')
})

test('o que ja foi enviado conta os dois, e diz quando nao foi nenhum', () => {
  assert.match(oQueJaFoiEnviado({ enviado_7_em: null, enviado_30_em: null }), /nenhum|ainda/i)
  assert.match(oQueJaFoiEnviado({ enviado_7_em: '2026-09-20', enviado_30_em: null }), /7/)
  assert.match(oQueJaFoiEnviado({ enviado_7_em: '2026-09-20', enviado_30_em: '2026-10-13' }), /30/)
})
```

- [ ] **Step 2: Rodar e ver falhar**
- [ ] **Step 3: Escrever as regras**
- [ ] **Step 4: Rodar e ver passar**

- [ ] **Step 5: A lista na tela**

Colunas: peça, e-mail (inteiro), quando pediu, o que já foi enviado, estado. **Só leitura** — nenhum botão que mexa.

⚠️ Lista vazia **não é erro**: hoje a tabela tem zero linhas e vai ter, até a Task 1 estar no ar. "Ninguém pediu lembrete ainda" e "não consegui buscar" são coisas diferentes e têm de parecer diferentes.
⚠️ A tabela vai dentro da própria caixa de rolagem (`overflow-x: auto`); a página não rola de lado.
⚠️ Só token de cor, nunca hex.

- [ ] **Step 6: A guarda de fiação**

No padrão de `src/ferramentas/comercial-vessel/guardas-da-tela.test.mjs`: afirmar que a tela usa `estadoDoLembrete(` e não reimplementa a decisão no template. Provar por mutação.

- [ ] **Step 7: `npm test` e commit**

---

## Fecho da entrega

- [ ] `npm test` verde na Central, com total MAIOR que antes. Suíte que encolhe é teste que sumiu.
- [ ] `node --test verify/regras.test.mjs` verde no site.
- [ ] As duas páginas do site fotografadas a 375px e 1920px, claro e escuro, com a rede interceptada — **zero escritas saindo**.
- [ ] A lista do painel fotografada nos mesmos tamanhos, inclusive **vazia**, que é o estado real de hoje.
- [ ] ⚠️ **A prova de ponta a ponta, e ela é a que importa:** com a rede interceptada, pedir um lembrete e conferir que o corpo que sairia é exatamente `{acao:'lembrete-criar', codigo, email, consentimento:true}`. Não criar lembrete de verdade em produção.
- [ ] Publicar: o site por push no repositório `vessel-brasil` (GitHub Actions o publica); a Central por push em `main` (a Vercel builda). Conferir cada um no ar pelo conteúdo servido, não pelo "deu certo".
- [ ] `docs/pendencias.md`: o B9 sai da lista, com o que foi feito e como se provou.
