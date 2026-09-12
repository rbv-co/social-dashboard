# Frota didática — Fase D-1: cada aba abre com o que fazer

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA: use `superpowers:subagent-driven-development`
> (recomendado) ou `superpowers:executing-plans` pra executar tarefa a tarefa.

**Objetivo:** cada aba da Frota abre com botões grandes do que se vai fazer ali,
cada um dizendo o estado embaixo do nome; e a fila de "precisa da sua aprovação"
sobe pro lugar onde ela é vista — e passa a ter botão.

**Desenho:** `docs/superpowers/specs/2026-08-12-frota-didatica-design.md` — D33,
e **D24 trazido da Fase B** (ver abaixo). D34 fica pra D-2.

## Por que a Fase D foi partida em duas, e por que D24 vem junto

**A Fase D do desenho tinha duas metades:** os botões rápidos (D33) e os cards do
checklist que deixam cadastrar quem falta e convidar login (D34). Elas são
separadas aqui porque D34 **manda e-mail de verdade pra pessoa de verdade** —
merece sua própria rodada, com a confirmação na tela desenhada com calma. D33 não
manda nada e é o que o dono foi procurar na tela e não achou.

**D24 (aprovar a própria requisição) vem junto, e não é enfeite de escopo.** A
fila `Aguardando sua decisão` **já existe** (`tela-de-frota.vue:2584`) e já lista
todas as pendentes — `filaDeAprovacao` não filtra por quem pode decidir. As duas
requisições pendentes hoje são **do próprio dono**, então subir D33 sem D24
entrega o pedaço mais visível da fase mostrando duas linhas que ele não pode
resolver, com a frase "esta requisição é sua, quem aprova é a outra pessoa". É
uma linha de código a menos de distância, já decidida por ele (aprovar sem selo
diferente), e sem ela o destaque da fase nasce quebrado.

**Arquitetura:** peças novas em arquivo próprio (D35). A lição da Fase A vale
inteira: **componente com `<style scoped>` NÃO herda as classes da tela grande** —
o componente novo traz o próprio bloco de estilo, com prefixo próprio, só com
tokens.

**Tecnologia:** Vue 3 + Vite · testes `node --test` em `*.test.mjs` · nada de banco.

## Restrições que valem para TODAS as tarefas

- **`PADRAO-DA-CENTRAL.md` é obrigatório.** Cor só por token `var(--…)`, **nunca
  hex — nem como valor de reserva dentro de `var()`**; isso foi achado na Fase A.
  Botão tem três tipos e só. Texto nunca corta. Alvo de toque de 40px.
- **Sem emoji como ícone.** SVG próprio, no molde dos que já existem no arquivo.
- **A tela nunca mente.** O estado embaixo do botão é lido do dado real; quando
  não se sabe, ele **não escreve nada** em vez de chutar um número.
- **`node --test` NÃO compila `.vue`.** `npm run build` é obrigatório em todo
  commit que mexa em `.vue`. Baseline: **2524 passam, 2 falham** (as duas do
  `coletor/`, credencial ausente em worktree novo — documentadas no `CLAUDE.md`,
  não são suas, não conserte).
- **Servidor de desenvolvimento:** `npm run dev -- --port 5199 --strictPort`.
  Nunca matar processo alheio.
- **Commits só nos arquivos da tarefa** — `git add <arquivo>`, nunca `git add <pasta>`.
- Nomes e comentários em português literal; comentário explica **por quê**.

---

### Tarefa 1: O que cada botão diz embaixo do nome

**Arquivos:**
- Criar: `src/ferramentas/frota/botoes-rapidos.js`
- Criar: `src/ferramentas/frota/botoes-rapidos.test.mjs`

**Interfaces:**
- Produz:
  - `botoesDoMotorista({ painel, checklistDeHoje, nomeDoMeuCarro }) → [{ chave, rotulo, estado, acao }]`
  - `botoesDaGestao({ linhas, cobranca, fila }) → [{ chave, rotulo, estado, acao }]`
  - `estado` é `string | null`. **Nulo quando não se sabe** — a tela não escreve
    linha nenhuma nesse caso, em vez de escrever "0" ou "—".

- [ ] **Passo 1: escrever o teste que falha**

```js
// src/ferramentas/frota/botoes-rapidos.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { botoesDoMotorista, botoesDaGestao } from './botoes-rapidos.js'

/* Os números são os reais medidos em 12/08/2026: 10 veículos, 2 sem dono,
 * 8 posses abertas, 0 checklists hoje, 2 requisições pendentes. */

const acha = (lista, chave) => lista.find((b) => b.chave === chave)

test('o motorista vê o nome do carro dele e que o checklist falta hoje', () => {
  const b = botoesDoMotorista({
    painel: { comigo: [], livres: [{}, {}, {}], comOutros: [] },
    checklistDeHoje: 'falta',
    nomeDoMeuCarro: 'FIAT BRAVO BLACKMOTION',
  })
  assert.equal(acha(b, 'meu-checklist').rotulo, 'Fazer meu checklist')
  assert.equal(acha(b, 'meu-checklist').estado, 'Bravo Blackmotion · falta hoje')
})

test('checklist já feito hoje diz que está feito — e não some', () => {
  // Sumir o botão faria a pessoa achar que perdeu a função. Ele fica, dizendo.
  const b = botoesDoMotorista({
    painel: { comigo: [], livres: [], comOutros: [] },
    checklistDeHoje: 'feito', nomeDoMeuCarro: 'HONDA FIT',
  })
  assert.equal(acha(b, 'meu-checklist').estado, 'Honda Fit · feito hoje')
})

test('quem não tem carro fixo não recebe uma promessa vazia', () => {
  const b = botoesDoMotorista({
    painel: { comigo: [], livres: [{}], comOutros: [] },
    checklistDeHoje: null, nomeDoMeuCarro: null,
  })
  assert.equal(acha(b, 'meu-checklist').estado, 'você não tem carro fixo')
})

test('"preciso usar um carro" conta os livres, no singular e no plural', () => {
  const um = botoesDoMotorista({ painel: { comigo: [], livres: [{}], comOutros: [] } })
  assert.equal(acha(um, 'preciso-carro').estado, '1 carro livre')
  const tres = botoesDoMotorista({ painel: { comigo: [], livres: [{}, {}, {}], comOutros: [] } })
  assert.equal(acha(tres, 'preciso-carro').estado, '3 carros livres')
})

test('sem carro livre, o botão DIZ isso em vez de sumir', () => {
  const b = botoesDoMotorista({ painel: { comigo: [], livres: [], comOutros: [] } })
  assert.equal(acha(b, 'preciso-carro').estado, 'nenhum carro livre agora')
})

test('a gestão vê quantos faltam conferir hoje', () => {
  // Medido em 12/08: 0 checklists hoje, 10 veículos.
  const b = botoesDaGestao({
    linhas: Array.from({ length: 10 }, () => ({ disponivel: false })),
    cobranca: Array.from({ length: 10 }, (_, i) => ({ fez: i < 2 })),
    fila: [],
  })
  assert.equal(acha(b, 'conferir-checklists').estado, 'faltam 8 de 10 hoje')
})

test('todos conferidos vira uma frase boa, não "faltam 0"', () => {
  const b = botoesDaGestao({
    linhas: [{ disponivel: false }], cobranca: [{ fez: true }], fila: [],
  })
  assert.equal(acha(b, 'conferir-checklists').estado, 'todos conferidos hoje')
})

test('sem quadro de cobrança carregado, o botão fica calado', () => {
  // `null` é "não sei", e não sei não vira número.
  const b = botoesDaGestao({ linhas: [{}], cobranca: null, fila: [] })
  assert.equal(acha(b, 'conferir-checklists').estado, null)
})

test('"veículos do grupo" mostra o total e quantos estão livres', () => {
  const b = botoesDaGestao({
    linhas: [{ disponivel: true }, { disponivel: false }, { disponivel: true }],
    cobranca: [], fila: [],
  })
  assert.equal(acha(b, 'veiculos').estado, '3 veículos · 2 livres')
})

test('reservar avisa quando há pedido esperando decisão', () => {
  const b = botoesDaGestao({ linhas: [], cobranca: [], fila: [{}, {}] })
  assert.equal(acha(b, 'reservar').estado, '2 pedidos esperando')
})

test('sem fila, reservar não inventa aviso', () => {
  const b = botoesDaGestao({ linhas: [], cobranca: [], fila: [] })
  assert.equal(acha(b, 'reservar').estado, null)
})

test('toda tecla e toda ação são únicas — botão repetido é bug de menu', () => {
  for (const lista of [botoesDoMotorista({ painel: {} }), botoesDaGestao({ linhas: [] })]) {
    const chaves = lista.map((b) => b.chave)
    assert.equal(new Set(chaves).size, chaves.length)
    for (const b of lista) assert.ok(b.rotulo && b.acao, 'botão sem rótulo ou sem ação')
  }
})
```

- [ ] **Passo 2: rodar e ver falhar**

`node --test src/ferramentas/frota/botoes-rapidos.test.mjs`
Esperado: FALHA com `Cannot find module './botoes-rapidos.js'`

- [ ] **Passo 3: implementar**

```js
// src/ferramentas/frota/botoes-rapidos.js
/* O que cada aba oferece, dito em botão grande — e o ESTADO embaixo do nome.
 *
 * De onde veio: quem usa esta ferramenta é um policial aposentado com
 * dificuldade de uso, e o pedido dele foi por um lugar óbvio pra começar, em
 * vez de rolar a tela procurando. O estado embaixo é o que separa um menu de
 * uma orientação: "Preciso usar um carro" é um menu; "Preciso usar um carro /
 * 3 carros livres" já respondeu a pergunta antes de a pessoa clicar.
 *
 * REGRA QUE MANDA AQUI: `estado` é `null` quando não se SABE, e a tela não
 * escreve linha nenhuma nesse caso. Escrever "0" ou "—" sobre um dado que não
 * carregou é a tela mentindo — e é o defeito que a Fase A inteira existiu pra
 * consertar. */

/** "FIAT BRAVO BLACKMOTION" é como o banco guarda; ninguém fala assim. */
function nomeCurto(nome) {
  const limpo = String(nome || '').trim()
  if (!limpo) return null
  // Tira a marca da frente quando sobra nome suficiente pra reconhecer o carro.
  const partes = limpo.split(/\s+/)
  const semMarca = partes.length > 2 ? partes.slice(1) : partes
  return semMarca
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join(' ')
}

const contar = (n, um, muitos) => `${n} ${n === 1 ? um : muitos}`

/**
 * Os botões da aba Motorista.
 * `checklistDeHoje`: 'feito' | 'falta' | null (null = não sei / não tem carro).
 */
export function botoesDoMotorista({ painel, checklistDeHoje, nomeDoMeuCarro } = {}) {
  const p = painel || {}
  const livres = (p.livres || []).length
  const carro = nomeCurto(nomeDoMeuCarro)

  let estadoChecklist = null
  if (!carro) estadoChecklist = 'você não tem carro fixo'
  else if (checklistDeHoje === 'feito') estadoChecklist = `${carro} · feito hoje`
  else if (checklistDeHoje === 'falta') estadoChecklist = `${carro} · falta hoje`

  return [
    {
      chave: 'meu-checklist',
      rotulo: 'Fazer meu checklist',
      estado: estadoChecklist,
      acao: 'meu-checklist',
    },
    {
      chave: 'preciso-carro',
      rotulo: 'Preciso usar um carro',
      // Zero livres NÃO some o botão: sumir faria a pessoa achar que perdeu a
      // função. Ele fica e diz por que não adianta clicar.
      estado: livres ? contar(livres, 'carro livre', 'carros livres') : 'nenhum carro livre agora',
      acao: 'preciso-carro',
    },
  ]
}

/** Os botões da aba Gestão. */
export function botoesDaGestao({ linhas, cobranca, fila } = {}) {
  const l = linhas || []
  const livres = l.filter((x) => x && x.disponivel).length
  const naFila = (fila || []).length

  // `cobranca` nulo é "o quadro não carregou" — diferente de "ninguém falta".
  let estadoCobranca = null
  if (Array.isArray(cobranca) && cobranca.length) {
    const faltam = cobranca.filter((c) => c && !c.fez).length
    estadoCobranca = faltam
      ? `faltam ${faltam} de ${cobranca.length} hoje`
      : 'todos conferidos hoje'
  }

  return [
    {
      chave: 'reservar',
      rotulo: 'Reservar um carro',
      estado: naFila ? contar(naFila, 'pedido esperando', 'pedidos esperando') : null,
      acao: 'reservar',
    },
    {
      chave: 'conferir-checklists',
      rotulo: 'Conferir checklists',
      estado: estadoCobranca,
      acao: 'conferir-checklists',
    },
    {
      chave: 'acrescentar',
      rotulo: 'Acrescentar um veículo',
      estado: null,
      acao: 'acrescentar',
    },
    {
      chave: 'veiculos',
      rotulo: 'Veículos do grupo',
      estado: l.length
        ? `${contar(l.length, 'veículo', 'veículos')} · ${livres} ${livres === 1 ? 'livre' : 'livres'}`
        : null,
      acao: 'veiculos',
    },
  ]
}
```

- [ ] **Passo 4: rodar e ver passar**

`node --test src/ferramentas/frota/botoes-rapidos.test.mjs` → PASSA, 12 testes.

⚠️ Se algum teste discordar da implementação, **a implementação é que muda**. Se
você achar que um TESTE está errado, pare e pergunte — não reescreva a asserção.

- [ ] **Passo 5: commitar**

```bash
git add src/ferramentas/frota/botoes-rapidos.js src/ferramentas/frota/botoes-rapidos.test.mjs
git commit -m "O que cada botão rápido diz embaixo do nome (D33)"
```

---

### Tarefa 2: O componente dos botões

**Arquivos:**
- Criar: `src/ferramentas/frota/botoes-rapidos.vue`

**Interfaces:**
- Consome: a lista da Tarefa 1
- Propriedades: `botoes` (Array, obrigatório)
- Emite: `escolher` com a `acao` do botão tocado

- [ ] **Passo 1: escrever o componente**

```vue
<!-- src/ferramentas/frota/botoes-rapidos.vue -->
<script setup>
/* Os botões grandes do topo de cada aba (D33).
 *
 * Grade de dois, não lista: dois por linha cabem no celular com alvo grande, e
 * o dono pediu "uns botões rápidos" — não um menu de texto. O estado vem embaixo
 * do nome, em fonte menor, e SÓ quando existe: `estado` nulo não vira linha
 * vazia nem travessão. */
defineProps({
  botoes: { type: Array, required: true },
})
defineEmits(['escolher'])
</script>

<template>
  <div class="brp-grade">
    <button v-for="b in botoes" :key="b.chave" type="button" class="brp-btn"
            @click="$emit('escolher', b.acao)">
      <span class="brp-nome">{{ b.rotulo }}</span>
      <span class="brp-estado" v-if="b.estado">{{ b.estado }}</span>
    </button>
  </div>
</template>

<style scoped>
/* Estilo PRÓPRIO, com prefixo próprio: componente com `<style scoped>` não
   alcança as classes `fr-` que moram na tela grande — foi o defeito achado na
   Fase A, quando a sanfona quase subiu sem estilo nenhum. Só tokens, nunca hex,
   nem como valor de reserva dentro de `var()`. */
.brp-grade{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:12px 14px 4px;}
/* 64px de altura: o PADRÃO exige 40px de alvo, e estes são os botões que a
   pessoa procura primeiro ao abrir a aba — com duas linhas de texto dentro,
   40px apertaria o estado contra o nome. */
.brp-btn{display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:3px;
  min-height:64px;padding:11px 13px;text-align:left;cursor:pointer;touch-action:manipulation;
  background:var(--surface);border:1px solid var(--border);border-left:3px solid var(--accent);
  border-radius:12px;font-family:var(--fonte-principal);}
.brp-btn:hover{border-color:var(--accent);}
.brp-nome{font-size:13.5px;font-weight:700;color:var(--text);line-height:1.25;overflow-wrap:anywhere;}
/* `overflow-wrap:anywhere` nos dois: o nome do carro vem do banco e pode ser
   comprido, e o padrão da casa é que texto nunca corta. */
.brp-estado{font-size:11.5px;color:var(--muted);line-height:1.3;overflow-wrap:anywhere;}
@media(min-width:900px){
  /* Quatro por linha no computador. `align-items:start` porque um botão com
     estado e outro sem têm alturas diferentes, e a grade estica por padrão. */
  .brp-grade{grid-template-columns:repeat(auto-fit,minmax(200px,1fr));align-items:start;padding:14px 24px 6px;}
}
</style>
```

- [ ] **Passo 2: conferir que o build enxerga o arquivo novo**

```bash
npm test && npm run build
```
`npm test` inclui `todo-vue-compila.test.mjs`, a guarda que existe porque uma
branch chegou à revisão final com 1.895 testes verdes e um template que não
compilava.

- [ ] **Passo 3: commitar**

```bash
git add src/ferramentas/frota/botoes-rapidos.vue
git commit -m "O componente dos botões rápidos, com estilo próprio (D33)"
```

---

### Tarefa 3: Ligar os botões nas duas abas, e subir a fila de aprovação

**Arquivos:**
- Modificar: `src/ferramentas/frota/tela-de-frota.vue`

- [ ] **Passo 1: os dois computeds e o despachante**

No `<script setup>`, junto dos outros computeds:

```js
// Qual é o carro fixo de quem está olhando, e se o checklist dele saiu hoje.
// `aberto` já existe nesta tela: é o cartão do checklist do dia, com `.veiculo`
// e `.meu`.
//
// ⚠️ CONFERIDO NO ARQUIVO, não suposto: `fezChecklistHoje` NÃO EXISTE. Quem
// sabe se a ficha de hoje saiu é `cobranca` — cada item dela é
// `{ veiculo, donoId, dono, fez }` (ver `quemFaltaHoje` em
// `_shared/checklist.js:180`). Usar a fonte que já existe, em vez de inventar
// uma segunda resposta pra mesma pergunta.
const meuCarroNome = computed(() => (aberto.value ? aberto.value.veiculo.nome : null))
const meuChecklistHoje = computed(() => {
  if (!aberto.value) return null
  const linha = cobranca.value.find((c) => c.veiculo.id === aberto.value.veiculo.id)
  if (!linha) return null          // não sei — e não sei não vira "falta"
  return linha.fez ? 'feito' : 'falta'
})

const botoesMotorista = computed(() => botoesDoMotorista({
  painel: painel.value, checklistDeHoje: meuChecklistHoje.value, nomeDoMeuCarro: meuCarroNome.value,
}))
const botoesGestao = computed(() => botoesDaGestao({
  linhas: linhas.value, cobranca: cobranca.value, fila: filaDeAprovacao.value,
}))

/* Um botão rápido NÃO cria tela: ou abre uma ficha que já existe, ou rola até
 * uma seção que já está mais abaixo. É o que o desenho pede (D33) e é o que
 * impede esta fase de virar uma segunda ferramenta por cima da primeira. */
function irPara(acao) {
  if (acao === 'reservar') return abrirPedido('')
  if (acao === 'acrescentar') return abrirVeiculoNovo()
  const ancoras = {
    'meu-checklist': 'fr-ancora-checklist',
    'preciso-carro': 'fr-ancora-livres',
    'conferir-checklists': 'fr-ancora-cobranca',
    veiculos: 'fr-ancora-veiculos',
  }
  const alvo = document.getElementById(ancoras[acao])
  // Sem âncora não faz nada, em silêncio: rolar pro lugar errado é pior que não
  // rolar, e um botão que pula pro topo parece defeito.
  if (alvo) alvo.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
```

**Um comportamento conhecido, pra ninguém tratar como defeito:** `quemFaltaHoje`
devolve lista VAZIA no fim de semana (`_shared/checklist.js:181` — sábado e
domingo não pedem checklist). Com `cobranca` vazia, o botão "Conferir
checklists" fica **sem linha de estado**, e isso está certo: ele não afirma nada
sobre um dia que não tem checklist. Não "consertar" isso escrevendo "0".

E os imports, junto dos outros da pasta:

```js
import BotoesRapidos from './botoes-rapidos.vue'
import { botoesDoMotorista, botoesDaGestao } from './botoes-rapidos.js'
```

- [ ] **Passo 2: as âncoras nas seções que já existem**

Acrescentar `id` — **sem mexer em mais nada dessas linhas**:

| Seção | `id` a acrescentar |
|---|---|
| `<h2 class="fr-secao">Checklist de hoje</h2>` (~1914) | `id="fr-ancora-cobranca"` |
| `<h2 class="fr-secao">{{ painel.livres.length ? 'Livres para pegar' : … }}` (~1841) | `id="fr-ancora-livres"` |
| o cartão do checklist do motorista (o bloco `v-if="aberto"`, ~1706) | envolver com `<div id="fr-ancora-checklist">` |
| a lista de veículos da Gestão | `id="fr-ancora-veiculos"` no `<div class="fr-lista">` que envolve o `v-for="l in linhas"` |

**Conferido no arquivo:** a lista de veículos da Gestão não tem `<h2>` nenhum —
ela é o `<div class="fr-lista">` imediatamente antes do
`<div v-for="l in linhas" …>`. É nesse `div` que a âncora vai. Cuidado: existem
VÁRIOS `div.fr-lista` neste arquivo; o certo é o que envolve `v-for="l in linhas"`.

- [ ] **Passo 3: os botões no topo de cada aba**

Na área Motorista, **como primeira coisa** dentro do `<template v-else-if="area === 'motorista'">`,
antes do `<p class="fr-motorista-resumo">`:

```html
      <BotoesRapidos :botoes="botoesMotorista" @escolher="irPara" />
```

Na área Gestão, como primeira coisa dentro do `<template v-else-if="area === 'gestao'">`,
**antes** do bloco `fr-novo` do "+ Acrescentar veículo":

```html
      <BotoesRapidos :botoes="botoesGestao" @escolher="irPara" />
```

⚠️ **O botão velho "+ Acrescentar veículo" (`div.fr-novo`) sai**: ele virou um
dos botões rápidos, e dois caminhos pro mesmo lugar na mesma tela é o tipo de
coisa que faz alguém com dificuldade parar e perguntar qual é o certo. Apague o
bloco `fr-novo` inteiro, e o CSS dele se ficar órfão.

- [ ] **Passo 4: a fila de aprovação sobe**

Hoje o bloco `<template v-if="area === 'gestao' && podeAprovar && filaDeAprovacao.length">`
(~2584) está **no fim da tela**, depois de tudo. O dono pediu ele logo abaixo dos
botões. Mova o bloco inteiro pra **logo depois do `<BotoesRapidos>` da Gestão** —
recorte e cola, **sem alterar nada de dentro dele**.

- [ ] **Passo 5: build e commit**

```bash
npm test && npm run build
git add src/ferramentas/frota/tela-de-frota.vue
git commit -m "Cada aba abre com o que fazer, e a fila de aprovação sobe (D33)"
```

---

### Tarefa 4: Quem administra aprova a própria requisição (D24)

Sem isto, a fila que acabou de subir mostra pro dono as **2 requisições dele**,
paradas desde 11/08, com a frase "esta requisição é sua" e nenhum botão.

**Arquivos:**
- Modificar: `src/ferramentas/frota/requisicoes.js` — `podeDecidir`
- Modificar: `src/ferramentas/frota/requisicoes.test.mjs`

- [ ] **Passo 1: escrever o teste que falha**

```js
// acrescentar em src/ferramentas/frota/requisicoes.test.mjs
test('quem administra a Frota aprova a própria requisição', () => {
  // Decisão do dono em 12/08, consultado sobre marcar visualmente: aprova como
  // qualquer outra, sem selo diferente. O caso real: as 2 requisições pendentes
  // de OLW4I46 são dele, e ficaram travadas desde 11/08 sem saída nenhuma.
  const req = { situacao: 'pendente', pessoa_id: 'p-erick', criada_por: 'u-erick' }
  const r = podeDecidir({
    requisicao: req, minhaPessoaId: 'p-erick', meuUsuarioId: 'u-erick',
    temPermissaoAprovar: true,
  })
  assert.equal(r.pode, true)
  assert.equal(r.motivo, null)
})

test('sem permissão continua sem decidir, própria ou não', () => {
  const req = { situacao: 'pendente', pessoa_id: 'p-erick', criada_por: 'u-erick' }
  assert.equal(podeDecidir({ requisicao: req, minhaPessoaId: 'p-erick', temPermissaoAprovar: false }).pode, false)
})

test('requisição já decidida continua fechada', () => {
  const req = { situacao: 'aprovada', pessoa_id: 'p-outro', criada_por: 'u-outro' }
  const r = podeDecidir({ requisicao: req, minhaPessoaId: 'p-erick', temPermissaoAprovar: true })
  assert.equal(r.pode, false)
  assert.equal(r.motivo, 'ja-decidida')
})
```

⚠️ **Um teste existente afirma o contrário** — o que cobre o motivo `'propria'`.
Ele guarda a regra ANTIGA, que o dono derrubou. **Apague esse teste** (não o
adapte pra continuar verde por outro caminho) e diga no relatório qual era.

- [ ] **Passo 2: rodar e ver falhar**

`node --test src/ferramentas/frota/requisicoes.test.mjs`

- [ ] **Passo 3: implementar**

Em `requisicoes.js`, `podeDecidir` perde o ramo `'propria'`. O comentário da
função **precisa contar a história**, porque ele hoje argumenta o contrário:

```js
/**
 * Quem pode decidir esta requisição.
 *
 * ATÉ 12/08/2026 o solicitante ficava de fora, pra aprovação ser um segundo par
 * de olhos. O dono derrubou essa regra, ciente do que se perde: com dois
 * aprovadores e a maior parte dos pedidos saindo dele mesmo, a regra não
 * produzia revisão nenhuma — produzia requisição parada. Duas ficaram travadas
 * desde 11/08 sem saída.
 *
 * O que NÃO se perde: `decidida_por` e `decidida_em` continuam gravando quem
 * decidiu. O rastro existe no banco; o que o dono dispensou foi o aviso na tela.
 */
export function podeDecidir({ requisicao, temPermissaoAprovar }) {
  if (!temPermissaoAprovar) return { pode: false, motivo: 'sem-permissao' };
  if (!requisicao || requisicao.situacao !== 'pendente') return { pode: false, motivo: 'ja-decidida' };
  return { pode: true, motivo: null };
}
```

⚠️ `motivoEmPortugues` tem o caso `'propria'`. Ele fica **sem uso** — conferir
quem mais chama e removê-lo só se ninguém mais usar. Diga no relatório.

⚠️ `podeDecidir` era chamada com `minhaPessoaId` e `meuUsuarioId`. Os chamadores
podem continuar passando (parâmetro a mais não quebra), mas **procure e limpe**:
`grep -rn "podeDecidir" src/`. Se algum chamador ficar com variável órfã, limpe.

⚠️ **Confira o estilo do arquivo antes**: `requisicoes.js` usa ponto-e-vírgula?
Leia. Suposição errada sobre isso já foi achado nesta ferramenta.

- [ ] **Passo 4: rodar e commitar**

```bash
node --test src/ferramentas/frota/requisicoes.test.mjs
npm test && npm run build
git add src/ferramentas/frota/requisicoes.js src/ferramentas/frota/requisicoes.test.mjs
git commit -m "Quem administra a Frota aprova a própria requisição (D24)"
```

---

### Tarefa 5: Conferir a fase antes de dizer que acabou

- [ ] **Passo 1: suíte e build**

```bash
npm test && npm run build
```
Baseline: 2524 passam + os novos. As 2 falhas do `coletor/` continuam e não são suas.

- [ ] **Passo 2: a 375px, num navegador de verdade**

`npm run dev -- --port 5199 --strictPort`

| Onde | O que tem de ser verdade |
|---|---|
| Motorista, ao abrir | 2 botões grandes no topo, com o estado embaixo |
| Motorista | "Preciso usar um carro" rola até a lista de livres |
| Gestão, ao abrir | 4 botões, e logo abaixo **"Aguardando sua decisão (2)"** |
| Gestão | cada uma das 2 requisições tem **botão de aprovar** |
| Gestão | "Reservar um carro" abre a ficha de pedido |
| Gestão | "Acrescentar um veículo" abre a ficha vazia — e o botão velho sumiu |
| Gestão | "Conferir checklists" rola até o quadro, dizendo quantos faltam |
| Ambas | nenhum botão estoura a largura; nada corta; alvo confortável |

- [ ] **Passo 3: o que a medição achar de errado, ANOTAR**

Se algum item falhar, **não feche a fase**. Escreva no fim deste arquivo, numa
seção "O QUE ESTE PLANO ERROU", o que não bateu e por quê.

## Fora do escopo desta fase

- **D34** — os cards do checklist deixando cadastrar quem falta e convidar login.
  Fica pra D-2, com a confirmação de envio de e-mail desenhada com calma.
- **D25, D26** (nome esporádico, encerrar posse de qualquer um) → Fase B.
- **D27, D28, D29** (lançamento de manutenção) → Fase C, migration **040**.
