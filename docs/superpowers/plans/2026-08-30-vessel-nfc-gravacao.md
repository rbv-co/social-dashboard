# Gravação das etiquetas NFC do Selo Vessel — plano de implementação

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA: use
> `superpowers:subagent-driven-development` (recomendado) ou
> `superpowers:executing-plans` para implementar tarefa por tarefa. Os passos
> usam caixinha (`- [ ]`) para marcar o andamento.

**Objetivo:** gravar o endereço do selo dentro da etiqueta NFC costurada no
forro da bolsa, peça por peça, sem gravar a mesma duas vezes e sem pular nenhuma.

**Arquitetura:** a lógica pura fica em `nfc-fila.js` (contas, sem navegador);
`gravador-nfc.js` é a **única** porta para o `NDEFReader` do navegador, com a
implementação injetável para o teste poder fingir cada falha; a aba "Gravar" da
tela existente só chama os dois. Essa separação é o que torna a coisa testável
— `node --test` não abre navegador e não tem `NDEFReader`.

**Tecnologia:** Vue 3 (Composition API), Supabase JS, `node:test`, Web NFC
(`NDEFReader`, só Chrome no Android).

**Spec:** `docs/superpowers/specs/2026-08-30-vessel-nfc-gravacao-design.md`

## Restrições que valem para TODAS as tarefas

- **Ler `PADRAO-DA-CENTRAL.md` antes da primeira linha.** É obrigatório neste
  repositório e cada regra existe porque um defeito real chegou ao dono.
- **Nunca marcar `gravada_em` sem uma leitura de volta que confere.** Gravação
  ter "dado certo" não é o navegador não reclamar — é a etiqueta devolver o que
  se pôs nela.
- **Antes de gravar, ler.** Se a etiqueta já carrega um endereço Vessel de OUTRA
  peça, parar e avisar. Nunca sobrescrever.
- O endereço é `https://vesselbrasil.com.br/verify/<CÓDIGO>` e sai de
  `enderecoDaTag()` em `lotes.js`. **Nunca escrever o domínio de novo em lugar
  nenhum** — um domínio em dois lugares é um domínio errado esperando acontecer.
- A trava (`makeReadOnly`) é escrita e testada, mas nasce **desligada** na tela.
- Texto em português, sem jargão, para quem está de pé na fábrica com o celular.
- Toda tela se mede **a 375px num navegador de verdade**, nunca se deduz do CSS.
- `npm run dev -- --port 5199 --strictPort` — há mais de uma janela neste
  repositório; porta fixa evita colisão.
- Trabalhar em worktree isolado, nunca na `main` do checkout principal.

---

## Estrutura de arquivos

| arquivo | responsabilidade |
|---|---|
| `src/ferramentas/autenticidade/nfc-fila.js` *(novo)* | contas puras: ler o código de um endereço, decidir se a leitura confere, montar a lista do gravador de mesa e entender o retorno dele |
| `src/ferramentas/autenticidade/nfc-fila.test.mjs` *(novo)* | teste do acima |
| `src/ferramentas/autenticidade/gravador-nfc.js` *(novo)* | a **única** porta para o `NDEFReader`, com implementação injetável e tradução das falhas para português |
| `src/ferramentas/autenticidade/gravador-nfc.test.mjs` *(novo)* | teste do acima, contra um `NDEFReader` de mentira |
| `src/ferramentas/autenticidade/tela-de-autenticidade.vue` *(alterar)* | a aba "Gravar" ganha o modo NFC, mantendo o modo de hoje como queda |
| `src/ferramentas/autenticidade/LEIA-ME.txt` *(alterar)* | documenta as duas amarras com o iamundi, para a mudança de repositório |

`lotes.js` já tem `enderecoDaTag()`, `progressoDoLote()` e `proximaPorGravar()`.
São reaproveitadas, **não reescritas**.

---

### Tarefa 1: Ler o código de um endereço e decidir se a leitura confere

**Arquivos:**
- Criar: `src/ferramentas/autenticidade/nfc-fila.js`
- Criar: `src/ferramentas/autenticidade/nfc-fila.test.mjs`

**Interfaces:**
- Consome: `enderecoDaTag(codigo)` de `./lotes.js` — devolve
  `https://vesselbrasil.com.br/verify/<CÓDIGO>`.
- Produz:
  - `codigoDoEndereco(url: string): string | null`
  - `conferirLeitura(lidoDaTag: string, codigoEsperado: string): 'confere' | 'vazia' | 'outra-peca' | 'nao-e-vessel'`

- [ ] **Passo 1: escrever o teste que falha**

Criar `src/ferramentas/autenticidade/nfc-fila.test.mjs`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { codigoDoEndereco, conferirLeitura } from './nfc-fila.js'

test('codigoDoEndereco: tira o codigo de um endereco do selo', () => {
  assert.equal(
    codigoDoEndereco('https://vesselbrasil.com.br/verify/K7M4X9QP2R'),
    'K7M4X9QP2R',
  )
})

test('codigoDoEndereco: aceita minusculo e devolve MAIUSCULO', () => {
  // o app de NFC de terceiros pode devolver o endereco em caixa baixa
  assert.equal(
    codigoDoEndereco('https://vesselbrasil.com.br/verify/k7m4x9qp2r'),
    'K7M4X9QP2R',
  )
})

test('codigoDoEndereco: ignora barra, interrogacao e cerquilha no fim', () => {
  const esperado = 'K7M4X9QP2R'
  assert.equal(codigoDoEndereco('https://vesselbrasil.com.br/verify/K7M4X9QP2R/'), esperado)
  assert.equal(codigoDoEndereco('https://vesselbrasil.com.br/verify/K7M4X9QP2R?x=1'), esperado)
  assert.equal(codigoDoEndereco('https://vesselbrasil.com.br/verify/K7M4X9QP2R#a'), esperado)
})

test('codigoDoEndereco: endereco de OUTRO site nao vale', () => {
  assert.equal(codigoDoEndereco('https://exemplo.com/verify/K7M4X9QP2R'), null)
})

test('codigoDoEndereco: vazio, nulo e lixo devolvem nulo', () => {
  assert.equal(codigoDoEndereco(''), null)
  assert.equal(codigoDoEndereco(null), null)
  assert.equal(codigoDoEndereco('qualquer coisa'), null)
})

test('conferirLeitura: a etiqueta devolveu exatamente esta peca', () => {
  assert.equal(
    conferirLeitura('https://vesselbrasil.com.br/verify/K7M4X9QP2R', 'K7M4X9QP2R'),
    'confere',
  )
})

test('conferirLeitura: etiqueta em branco', () => {
  assert.equal(conferirLeitura('', 'K7M4X9QP2R'), 'vazia')
  assert.equal(conferirLeitura(null, 'K7M4X9QP2R'), 'vazia')
})

test('conferirLeitura: etiqueta com OUTRA peca — e o caso que salva duas bolsas', () => {
  assert.equal(
    conferirLeitura('https://vesselbrasil.com.br/verify/T3H8ZC5WVN', 'K7M4X9QP2R'),
    'outra-peca',
  )
})

test('conferirLeitura: etiqueta com coisa que nao e do selo', () => {
  assert.equal(conferirLeitura('https://google.com', 'K7M4X9QP2R'), 'nao-e-vessel')
})
```

- [ ] **Passo 2: rodar e ver falhar**

Rodar: `node --test src/ferramentas/autenticidade/nfc-fila.test.mjs`
Esperado: FALHA com "Cannot find module './nfc-fila.js'".

- [ ] **Passo 3: escrever a implementação mínima**

Criar `src/ferramentas/autenticidade/nfc-fila.js`:

```js
// A fila de gravação das etiquetas NFC. Contas puras — sem DOM, sem rede, sem
// NDEFReader — porque é aqui que mora a decisão de marcar ou não uma peça como
// gravada, e essa decisão precisa ser testável sem abrir navegador.
import { enderecoDaTag } from './lotes.js'

// O prefixo NASCE de enderecoDaTag, nunca escrito de novo. Domínio em dois
// lugares é domínio errado esperando acontecer — e este aqui vai gravado dentro
// de um chip costurado numa bolsa, onde não se corrige.
const PREFIXO = enderecoDaTag('')

export function codigoDoEndereco(url) {
  const texto = String(url ?? '').trim()
  if (!texto.toLowerCase().startsWith(PREFIXO.toLowerCase())) return null
  // corta em barra, interrogação ou cerquilha: app de NFC de terceiros costuma
  // devolver o endereço com sobras
  const resto = texto.slice(PREFIXO.length).split(/[?#/]/)[0].toUpperCase()
  return /^[A-Z0-9]{6,32}$/.test(resto) ? resto : null
}

// É ESTA FUNÇÃO QUE DECIDE SE MARCA OU NÃO.
// 'confere'      → a etiqueta devolveu esta peça; pode marcar
// 'vazia'        → etiqueta em branco; pode gravar
// 'outra-peca'   → etiqueta JÁ TEM outra peça do selo; PARAR, não sobrescrever
// 'nao-e-vessel' → tem alguma coisa que não é do selo
export function conferirLeitura(lidoDaTag, codigoEsperado) {
  const texto = String(lidoDaTag ?? '').trim()
  if (!texto) return 'vazia'
  const codigo = codigoDoEndereco(texto)
  if (!codigo) return 'nao-e-vessel'
  return codigo === String(codigoEsperado ?? '').trim().toUpperCase()
    ? 'confere'
    : 'outra-peca'
}
```

- [ ] **Passo 4: rodar e ver passar**

Rodar: `node --test src/ferramentas/autenticidade/nfc-fila.test.mjs`
Esperado: PASSA, 9 testes.

- [ ] **Passo 5: commitar**

```bash
git add src/ferramentas/autenticidade/nfc-fila.js src/ferramentas/autenticidade/nfc-fila.test.mjs
git commit -m "autenticidade: a decisao de marcar uma etiqueta como gravada, em funcao pura

conferirLeitura devolve 'confere', 'vazia', 'outra-peca' ou 'nao-e-vessel'.
O caso que importa e 'outra-peca': encostar na etiqueta errada sobrescreveria
uma peca boa e mandaria duas bolsas para o lixo.

O prefixo do endereco NASCE de enderecoDaTag, nunca escrito de novo — ele vai
gravado dentro de um chip costurado numa bolsa, onde nao se corrige."
```

---

### Tarefa 2: A lista para o gravador de mesa, e o retorno dele

**Arquivos:**
- Modificar: `src/ferramentas/autenticidade/nfc-fila.js`
- Modificar: `src/ferramentas/autenticidade/nfc-fila.test.mjs`

**Interfaces:**
- Consome: `enderecoDaTag(codigo)` de `./lotes.js`.
- Produz:
  - `listaParaGravadorDeMesa(pecas: Array<{codigo, numero_na_serie, gravada_em}>): string`
  - `codigosNoTextoDoGravador(texto: string, pecasDoLote: Array<{codigo}>): { reconhecidos: string[], ignorados: string[] }`

- [ ] **Passo 1: escrever o teste que falha**

Acrescentar ao fim de `src/ferramentas/autenticidade/nfc-fila.test.mjs` (e somar
os dois nomes novos ao `import` do topo):

```js
test('listaParaGravadorDeMesa: uma URL por linha, so as que faltam, em ordem', () => {
  const pecas = [
    { codigo: 'CCC111', numero_na_serie: 3, gravada_em: null },
    { codigo: 'AAA111', numero_na_serie: 1, gravada_em: '2026-08-05T10:00:00Z' },
    { codigo: 'BBB111', numero_na_serie: 2, gravada_em: null },
  ]
  assert.equal(
    listaParaGravadorDeMesa(pecas),
    'https://vesselbrasil.com.br/verify/BBB111\nhttps://vesselbrasil.com.br/verify/CCC111',
  )
})

test('listaParaGravadorDeMesa: lote todo gravado devolve vazio', () => {
  assert.equal(listaParaGravadorDeMesa([{ codigo: 'A', gravada_em: 'x' }]), '')
})

test('codigosNoTextoDoGravador: acha os codigos em QUALQUER formato', () => {
  // o gravador de mesa ainda nao foi comprado; o retorno dele pode vir em
  // CSV com virgula, com ponto-e-virgula, ou num log solto. Por isso o
  // reconhecimento e por padrao, nao por formato.
  const pecas = [{ codigo: 'AAA111' }, { codigo: 'BBB111' }, { codigo: 'CCC111' }]
  const texto = `linha;status
https://vesselbrasil.com.br/verify/AAA111;ok
BBB111,gravada
"algum log solto" CCC111 -> OK`
  const r = codigosNoTextoDoGravador(texto, pecas)
  assert.deepEqual(r.reconhecidos.sort(), ['AAA111', 'BBB111', 'CCC111'])
  assert.deepEqual(r.ignorados, [])
})

test('codigosNoTextoDoGravador: codigo do selo que NAO e deste lote vira aviso', () => {
  const r = codigosNoTextoDoGravador(
    'https://vesselbrasil.com.br/verify/ZZZ999', [{ codigo: 'AAA111' }])
  assert.deepEqual(r.reconhecidos, [])
  assert.deepEqual(r.ignorados, ['ZZZ999'])
})

test('codigosNoTextoDoGravador: texto sem nada devolve as duas listas vazias', () => {
  const r = codigosNoTextoDoGravador('nada aqui', [{ codigo: 'AAA111' }])
  assert.deepEqual(r, { reconhecidos: [], ignorados: [] })
})

test('codigosNoTextoDoGravador: nao repete codigo que aparece duas vezes', () => {
  const r = codigosNoTextoDoGravador('AAA111 e de novo AAA111', [{ codigo: 'AAA111' }])
  assert.deepEqual(r.reconhecidos, ['AAA111'])
})
```

- [ ] **Passo 2: rodar e ver falhar**

Rodar: `node --test src/ferramentas/autenticidade/nfc-fila.test.mjs`
Esperado: FALHA com "listaParaGravadorDeMesa is not defined".

- [ ] **Passo 3: escrever a implementação mínima**

Acrescentar a `src/ferramentas/autenticidade/nfc-fila.js`:

```js
// ── O GRAVADOR DE MESA ─────────────────────────────────────────────────────
// Celular e gravador de mesa gravam a MESMA fila. O que impede gravar duas
// vezes a mesma peça é os dois beberem daqui.

// UMA URL POR LINHA, coluna única, sem separador. O gravador ainda não foi
// comprado — apostar num formato de CSV agora é apostar às cegas. Lista simples
// qualquer programa lê.
export function listaParaGravadorDeMesa(pecas) {
  return (Array.isArray(pecas) ? pecas : [])
    .filter((p) => !p.gravada_em)
    .sort((a, b) => (a.numero_na_serie || 0) - (b.numero_na_serie || 0))
    .map((p) => enderecoDaTag(p.codigo))
    .join('\n')
}

// O RETORNO DO GRAVADOR VEM EM QUALQUER FORMATO, pela mesma razão: pode ser CSV
// com vírgula, com ponto-e-vírgula, ou um log solto. Então não se lê o formato:
// procura-se por padrão e confere-se contra o lote. Só entra o que É do lote,
// então lixo no texto não vira marcação errada.
export function codigosNoTextoDoGravador(texto, pecasDoLote) {
  const bruto = String(texto ?? '')
  const doLote = new Set(
    (Array.isArray(pecasDoLote) ? pecasDoLote : [])
      .map((p) => String(p.codigo ?? '').trim().toUpperCase())
      .filter(Boolean),
  )
  const reconhecidos = new Set()
  for (const achado of bruto.toUpperCase().matchAll(/[A-Z0-9]{6,32}/g)) {
    if (doLote.has(achado[0])) reconhecidos.add(achado[0])
  }
  // Código com cara de selo que NÃO é deste lote merece aviso: normalmente é o
  // arquivo do lote errado, e marcar em silêncio esconderia isso.
  const ignorados = new Set()
  for (const achado of bruto.matchAll(/\/verify\/([A-Za-z0-9]{6,32})/g)) {
    const codigo = achado[1].toUpperCase()
    if (!doLote.has(codigo)) ignorados.add(codigo)
  }
  return { reconhecidos: [...reconhecidos], ignorados: [...ignorados] }
}
```

- [ ] **Passo 4: rodar e ver passar**

Rodar: `node --test src/ferramentas/autenticidade/nfc-fila.test.mjs`
Esperado: PASSA, 15 testes.

- [ ] **Passo 5: commitar**

```bash
git add src/ferramentas/autenticidade/nfc-fila.js src/ferramentas/autenticidade/nfc-fila.test.mjs
git commit -m "autenticidade: a fila do gravador de mesa, de ida e de volta

Uma URL por linha na ida; na volta, reconhecimento por PADRAO e nao por
formato. O gravador ainda nao foi comprado — apostar num formato de CSV agora
seria apostar as cegas, e o retorno pode vir em CSV, em log ou em qualquer
coisa. So entra codigo que E do lote, entao lixo no texto nao vira marcacao
errada; codigo do selo de OUTRO lote vira aviso em vez de silencio."
```

---

### Tarefa 3: A única porta para o NFC do navegador

**Arquivos:**
- Criar: `src/ferramentas/autenticidade/gravador-nfc.js`
- Criar: `src/ferramentas/autenticidade/gravador-nfc.test.mjs`

**Interfaces:**
- Consome: nada do projeto.
- Produz:
  - `temSuporte(janela?: object): boolean`
  - `urlDaMensagem(mensagem: { records?: Array }): string`
  - `traduzirFalha(erro: Error): string`
  - `criarGravador(opcoes?: { janela?: object }): { lerUmaVez, gravar, travar } | null`

- [ ] **Passo 1: escrever o teste que falha**

Criar `src/ferramentas/autenticidade/gravador-nfc.test.mjs`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { temSuporte, urlDaMensagem, traduzirFalha, criarGravador } from './gravador-nfc.js'

// ── um NDEFReader de mentira ────────────────────────────────────────────────
// node --test nao abre navegador e nao tem NDEFReader. E por isso que ele entra
// por injecao: sem isso, nada aqui seria testavel.
function janelaDeMentira({ aoLer, aoGravar, aoTravar } = {}) {
  class NDEFReaderFalso {
    async scan() {
      if (typeof aoLer === 'function') return aoLer(this)
    }
    async write(dado) {
      if (typeof aoGravar === 'function') return aoGravar(dado)
    }
    async makeReadOnly() {
      if (typeof aoTravar === 'function') return aoTravar()
    }
    addEventListener(nome, ouvinte) { (this.ouvintes ||= {})[nome] = ouvinte }
  }
  return { NDEFReader: NDEFReaderFalso }
}

const mensagemComUrl = (url) => ({
  records: [{ recordType: 'url', encoding: 'utf-8', data: new TextEncoder().encode(url) }],
})

test('temSuporte: falso quando o navegador nao tem NDEFReader', () => {
  assert.equal(temSuporte({}), false)
})

test('temSuporte: verdadeiro quando tem', () => {
  assert.equal(temSuporte(janelaDeMentira()), true)
})

test('urlDaMensagem: tira o endereco do registro de url', () => {
  assert.equal(
    urlDaMensagem(mensagemComUrl('https://vesselbrasil.com.br/verify/AAA111')),
    'https://vesselbrasil.com.br/verify/AAA111',
  )
})

test('urlDaMensagem: etiqueta em branco devolve vazio', () => {
  assert.equal(urlDaMensagem({ records: [] }), '')
  assert.equal(urlDaMensagem(null), '')
})

test('urlDaMensagem: ignora registro que nao e endereco', () => {
  const so_texto = { records: [{ recordType: 'text', data: new TextEncoder().encode('oi') }] }
  assert.equal(urlDaMensagem(so_texto), '')
})

test('traduzirFalha: etiqueta pequena demais', () => {
  const e = new Error('x'); e.name = 'NotSupportedError'
  assert.match(traduzirFalha(e), /espaço/i)
})

test('traduzirFalha: NFC desligado', () => {
  const e = new Error('x'); e.name = 'NotReadableError'
  assert.match(traduzirFalha(e), /ligue o nfc/i)
})

test('traduzirFalha: etiqueta saiu de perto', () => {
  const e = new Error('x'); e.name = 'NetworkError'
  assert.match(traduzirFalha(e), /encoste de novo/i)
})

test('traduzirFalha: permissao negada', () => {
  const e = new Error('x'); e.name = 'NotAllowedError'
  assert.match(traduzirFalha(e), /permiss/i)
})

test('traduzirFalha: falha desconhecida nao vira mensagem vazia', () => {
  const e = new Error('coisa estranha'); e.name = 'CoisaEstranha'
  const frase = traduzirFalha(e)
  assert.ok(frase.length > 10, 'a frase precisa dizer alguma coisa')
})

test('criarGravador: devolve nulo quando o navegador nao grava NFC', () => {
  assert.equal(criarGravador({ janela: {} }), null)
})

test('criarGravador: gravar passa o endereco adiante', async () => {
  let recebido = null
  const g = criarGravador({ janela: janelaDeMentira({ aoGravar: (d) => { recebido = d } }) })
  await g.gravar('https://vesselbrasil.com.br/verify/AAA111')
  assert.equal(recebido, 'https://vesselbrasil.com.br/verify/AAA111')
})

test('criarGravador: travar chama makeReadOnly', async () => {
  let travou = false
  const g = criarGravador({ janela: janelaDeMentira({ aoTravar: () => { travou = true } }) })
  await g.travar()
  assert.equal(travou, true)
})

test('criarGravador: lerUmaVez devolve o endereco que veio na etiqueta', async () => {
  const janela = janelaDeMentira({
    aoLer: (leitor) => { setTimeout(() => leitor.ouvintes.reading({ message: mensagemComUrl('https://vesselbrasil.com.br/verify/AAA111') }), 0) },
  })
  const g = criarGravador({ janela })
  assert.equal(await g.lerUmaVez({ milissegundos: 500 }),
    'https://vesselbrasil.com.br/verify/AAA111')
})

test('criarGravador: lerUmaVez desiste quando ninguem encosta a etiqueta', async () => {
  // A recusa carrega o NOME do erro, nao a frase em portugues: traduzir e
  // trabalho de traduzirFalha, e so dele. Conferir a frase aqui amarraria dois
  // trabalhos no mesmo teste.
  const g = criarGravador({ janela: janelaDeMentira({ aoLer: () => {} }) })
  await assert.rejects(
    () => g.lerUmaVez({ milissegundos: 30 }),
    (erro) => erro.name === 'AbortError',
  )
})
```

- [ ] **Passo 2: rodar e ver falhar**

Rodar: `node --test src/ferramentas/autenticidade/gravador-nfc.test.mjs`
Esperado: FALHA com "Cannot find module './gravador-nfc.js'".

- [ ] **Passo 3: escrever a implementação mínima**

Criar `src/ferramentas/autenticidade/gravador-nfc.js`:

```js
// A ÚNICA PORTA PARA O NFC DO NAVEGADOR.
//
// Todo o resto do painel é conta pura e se testa com `node --test`. Isto aqui
// não: `NDEFReader` só existe no Chrome do Android. Por isso ele entra por
// INJEÇÃO — o teste passa um de mentira e consegue simular etiqueta pequena
// demais, NFC desligado e etiqueta que saiu de perto no meio.
// Se este arquivo crescer para além de "falar com o chip", ele está errado.

export function temSuporte(janela = globalThis) {
  return typeof janela?.NDEFReader === 'function'
}

// Uma mensagem NFC tem vários registros; o nosso é o de endereço.
export function urlDaMensagem(mensagem) {
  for (const registro of mensagem?.records || []) {
    if (registro.recordType !== 'url' && registro.recordType !== 'absolute-url') continue
    try {
      return new TextDecoder(registro.encoding || 'utf-8').decode(registro.data)
    } catch { return '' }
  }
  return ''
}

// O navegador fala em nome de erro; quem grava está de pé na fábrica.
const FRASES = {
  NotSupportedError: 'Esta etiqueta não tem espaço para o endereço, ou não aceita gravação. Troque a etiqueta.',
  NotReadableError: 'Não consegui falar com a etiqueta. Ligue o NFC nos ajustes do celular e tente de novo.',
  NetworkError: 'A etiqueta saiu de perto no meio. Encoste de novo e segure parado.',
  AbortError: 'Passou do tempo. Encoste de novo e segure parado.',
  NotAllowedError: 'O navegador não deu permissão de NFC. Recarregue a página e aceite quando ele perguntar.',
}

export function traduzirFalha(erro) {
  const nome = erro?.name || ''
  return FRASES[nome]
    || `Não consegui gravar (${nome || 'motivo desconhecido'}). Encoste de novo; se repetir, troque a etiqueta.`
}

export function criarGravador({ janela = globalThis } = {}) {
  if (!temSuporte(janela)) return null
  const leitor = new janela.NDEFReader()

  return {
    // Lê UMA etiqueta e para. O tempo existe porque, sem ele, a tela ficaria
    // esperando para sempre alguém que já foi embora.
    async lerUmaVez({ milissegundos = 8000 } = {}) {
      return new Promise((resolver, recusar) => {
        const relogio = setTimeout(() => {
          recusar(Object.assign(new Error('sem etiqueta'), { name: 'AbortError' }))
        }, milissegundos)
        leitor.addEventListener('reading', (evento) => {
          clearTimeout(relogio)
          resolver(urlDaMensagem(evento?.message))
        })
        leitor.addEventListener('readingerror', () => {
          clearTimeout(relogio)
          recusar(Object.assign(new Error('leitura falhou'), { name: 'NotReadableError' }))
        })
        Promise.resolve(leitor.scan()).catch((e) => { clearTimeout(relogio); recusar(e) })
      })
    },

    async gravar(endereco) {
      await leitor.write(endereco)
    },

    // ⚠️ PERMANENTE. Etiqueta travada nunca mais se regrava. A tela só chama
    // isto com o interruptor ligado, e o interruptor nasce desligado.
    // O primeiro teste com etiqueta de verdade tem de ser numa descartável.
    async travar() {
      await leitor.makeReadOnly()
    },
  }
}
```

- [ ] **Passo 4: rodar e ver passar**

Rodar: `node --test src/ferramentas/autenticidade/gravador-nfc.test.mjs`
Esperado: PASSA, 15 testes.

- [ ] **Passo 5: commitar**

```bash
git add src/ferramentas/autenticidade/gravador-nfc.js src/ferramentas/autenticidade/gravador-nfc.test.mjs
git commit -m "autenticidade: a unica porta para o NFC do navegador

NDEFReader so existe no Chrome do Android, entao ele entra por INJECAO: o
teste passa um de mentira e consegue simular etiqueta pequena demais, NFC
desligado, permissao negada e etiqueta que saiu de perto no meio.

Sem essa separacao nada disso seria testavel — node --test nao abre navegador.

As frases sao para quem esta de pe na fabrica com o celular, nao para quem le
nome de erro de navegador."
```

---

### Tarefa 4: A aba "Gravar" ganha o modo NFC

**Arquivos:**
- Modificar: `src/ferramentas/autenticidade/tela-de-autenticidade.vue` (a aba
  `gravar`, hoje nas linhas 41–78 do template, e o `<script setup>` a partir da
  linha 200)

**Interfaces:**
- Consome: `conferirLeitura`, `listaParaGravadorDeMesa`, `codigosNoTextoDoGravador`
  de `./nfc-fila.js`; `temSuporte`, `traduzirFalha`, `criarGravador` de
  `./gravador-nfc.js`; `enderecoDaTag`, `progressoDoLote`, `proximaPorGravar` de
  `./lotes.js` (já importadas).
- Produz: nada para outras tarefas.

- [ ] **Passo 1: somar os imports**

⚠️ **Chamar uma função de um vizinho e esquecer de importá-la NÃO quebra o
build** — o Vite supõe que é global do navegador, e a tela fica EM BRANCO quando
alguém clica. Já derrubou tela quatro vezes neste repositório.
`imports.test.mjs` desta pasta pega isso.

Acrescentar ao `<script setup>`:

```js
import { conferirLeitura, listaParaGravadorDeMesa, codigosNoTextoDoGravador } from './nfc-fila.js'
import { temSuporte, traduzirFalha, criarGravador } from './gravador-nfc.js'
```

- [ ] **Passo 2: rodar o guarda de imports e a suíte**

Rodar: `node --test src/ferramentas/autenticidade/`
Esperado: PASSA (os imports novos ainda não são usados; o guarda cobra o
contrário — usar sem importar).

- [ ] **Passo 3: o estado e a função de gravar**

Acrescentar ao `<script setup>`:

```js
const gravaPorNfc = ref(temSuporte())      // Chrome no Android sim; iPhone não
const travarDepois = ref(false)            // ⚠️ PERMANENTE — nasce desligado
const gravando = ref(false)
const recadoNfc = ref('')

// A REGRA INTEIRA ESTÁ AQUI: lê antes, grava, lê depois, e só então marca.
// Marcar porque o `write` não deu erro é marcar no escuro — e no escuro a peça
// entra como pronta com a etiqueta em branco costurada dentro da bolsa.
async function gravarNaEtiqueta() {
  const peca = proxima.value
  if (!peca || gravando.value) return
  const gravador = criarGravador()
  if (!gravador) { gravaPorNfc.value = false; return }

  gravando.value = true
  recadoNfc.value = 'Encoste a etiqueta no celular e segure parado…'
  try {
    // 1. LER ANTES: etiqueta com outra peça não pode ser sobrescrita
    const antes = await gravador.lerUmaVez()
    const situacao = conferirLeitura(antes, peca.codigo)
    if (situacao === 'outra-peca') {
      recadoNfc.value = 'PARE: esta etiqueta já tem OUTRA peça gravada. '
        + 'Separe ela e pegue uma etiqueta em branco.'
      return
    }
    if (situacao === 'confere') {
      // já estava gravada com esta peça: marca sem regravar
      await marcarGravada()
      recadoNfc.value = 'Esta etiqueta já estava certa. Marquei e passei para a próxima.'
      return
    }

    // 2. GRAVAR
    recadoNfc.value = 'Gravando… não tire o celular.'
    await gravador.gravar(enderecoDaTag(peca.codigo))

    // 3. LER DEPOIS: a prova de que gravou é a etiqueta devolver
    const depois = await gravador.lerUmaVez()
    if (conferirLeitura(depois, peca.codigo) !== 'confere') {
      recadoNfc.value = 'Gravei, mas a etiqueta não devolveu o endereço certo. '
        + 'Não marquei a peça. Encoste de novo.'
      return
    }

    if (travarDepois.value) await gravador.travar()
    await marcarGravada()
    recadoNfc.value = `Peça ${peca.numero_na_serie} pronta. Pegue a próxima etiqueta.`
  } catch (erro) {
    recadoNfc.value = traduzirFalha(erro)
  } finally {
    gravando.value = false
  }
}
```

- [ ] **Passo 4: os dois caminhos do gravador de mesa**

Acrescentar ao `<script setup>`:

```js
const textoDoGravador = ref('')

function baixarListaDoGravador() {
  const lista = listaParaGravadorDeMesa(pecasDoLote(loteEscolhido.value))
  if (!lista) { adminToast('Não falta nenhuma etiqueta neste lote', false); return }
  const url = URL.createObjectURL(new Blob([lista], { type: 'text/plain;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `etiquetas-${loteAtual.value?.modelo || 'lote'}.txt`
  a.click()
  URL.revokeObjectURL(url)
}

async function marcarPeloGravador() {
  const { reconhecidos, ignorados } = codigosNoTextoDoGravador(
    textoDoGravador.value, pecasDoLote(loteEscolhido.value))
  if (!reconhecidos.length) {
    adminToast('Não achei nenhum código deste lote no texto colado', false)
    return
  }
  for (const codigo of reconhecidos) {
    await sbClient.rpc('vessel_marcar_gravada', { p_codigo: codigo })
  }
  // Aqui recarregar É certo: veio um bloco inteiro de uma vez. No caminho de
  // uma etiqueta por vez, `marcarGravada` atualiza SÓ a peça de propósito —
  // recarga inteira a cada etiqueta trava o ritmo de quem está gravando em
  // sequência.
  await carregar()
  textoDoGravador.value = ''
  adminToast(ignorados.length
    ? `${reconhecidos.length} marcadas. ${ignorados.length} código(s) de OUTRO lote foram ignorados — confira se o arquivo é deste lote.`
    : `${reconhecidos.length} etiqueta(s) marcadas como gravadas.`)
}
```

Os nomes acima já existem na tela e foram conferidos no arquivo: `loteAtual`
(232), `podeEditar` (229), `carregar` (265), `adminToast` (importado na 199) e
`pecasDoLote`. **O cliente do banco chama-se `sbClient`** (importado na 197 de
`conectar-no-banco-de-dados.js`) — não `supabase`.

- [ ] **Passo 5: o template da aba**

Substituir o bloco `<div v-else class="au-gravacao">` por um que mostre os dois
modos. O de hoje (endereço + copiar + "Gravei essa") continua **inteiro** — é a
queda para iPhone e computador, e a fábrica não pode ficar refém do aparelho.

```html
<div v-else class="au-gravacao">
  <p class="au-passo">
    Peça {{ proxima.numero_na_serie }} de {{ loteAtual?.quantidade }} ·
    {{ progressoDoLote(pecasDoLote(loteEscolhido)).texto }} prontas
  </p>

  <p class="au-instrucao">
    A etiqueta vai costurada no forro interno, longe de fecho, rebite e corrente:
    NFC não funciona encostado em metal.
  </p>

  <!-- MODO NFC: só existe onde o navegador grava (Chrome no Android) -->
  <template v-if="gravaPorNfc">
    <div class="au-endereco">{{ enderecoDaTag(proxima.codigo) }}</div>
    <p v-if="recadoNfc" class="au-recado-nfc">{{ recadoNfc }}</p>
    <div class="au-acoes">
      <button class="au-botao" type="button" :disabled="gravando || !podeEditar"
              @click="gravarNaEtiqueta">
        {{ gravando ? 'Encoste a etiqueta…' : 'Gravar nesta etiqueta' }}
      </button>
      <button class="au-botao secundario" type="button" @click="gravaPorNfc = false">
        Gravar pelo aplicativo
      </button>
    </div>
    <label class="au-trava">
      <input type="checkbox" v-model="travarDepois">
      Travar a etiqueta depois de gravar — <strong>não tem volta</strong>
    </label>
  </template>

  <!-- MODO DE HOJE: iPhone, computador, ou quem preferir o aplicativo -->
  <template v-else>
    <p class="au-instrucao">
      Copie o endereço abaixo e grave na etiqueta pelo aplicativo do celular.
      Depois toque em “Gravei essa” — é isso que impede de perder a conta no meio
      de {{ loteAtual?.quantidade }} etiquetas iguais.
    </p>
    <div class="au-endereco">{{ enderecoDaTag(proxima.codigo) }}</div>
    <div class="au-acoes">
      <button class="au-botao secundario" type="button" @click="copiar">{{ textoCopiar }}</button>
      <button class="au-botao" type="button" v-if="podeEditar" @click="marcarGravada">✓ Gravei essa</button>
      <button v-if="temSuporte()" class="au-botao secundario" type="button" @click="gravaPorNfc = true">
        Gravar encostando o celular
      </button>
    </div>
  </template>

  <!-- GRAVADOR DE MESA -->
  <details class="au-mesa">
    <summary>Gravador de mesa</summary>
    <button class="au-botao secundario" type="button" @click="baixarListaDoGravador">
      Baixar a lista das que faltam
    </button>
    <textarea v-model="textoDoGravador" class="au-colar"
              placeholder="Cole aqui o que o gravador devolveu"></textarea>
    <button class="au-botao" type="button" v-if="podeEditar" @click="marcarPeloGravador">
      Marcar as gravadas
    </button>
  </details>
</div>
```

- [ ] **Passo 6: o CSS das peças novas**

Acrescentar ao `<style scoped>`, seguindo os tokens do projeto (⚠️ cor sai de
token, nunca escrita à mão — ver `PADRAO-DA-CENTRAL.md`):

```css
/* O recado da gravação é o que a pessoa lê de pé, com o celular numa mão e a
   etiqueta na outra: corpo grande e contraste alto nos DOIS temas. */
.au-recado-nfc{
  margin:12px 0 0; padding:10px 12px; border-radius:8px;
  background:var(--cor-superficie-2); color:var(--cor-texto);
  font-size:15px; line-height:1.45;
}
.au-trava{display:flex; gap:8px; align-items:flex-start; margin-top:14px; font-size:13px}
.au-mesa{margin-top:22px}
.au-mesa summary{cursor:pointer; font-size:13px}
.au-colar{width:100%; min-height:90px; margin:10px 0; font-family:inherit}
```

- [ ] **Passo 7: rodar a suíte inteira**

Rodar: `npm test`
Esperado: PASSA, zero falhas. ⚠️ Se o total for MENOR que 3716, é arquivo
sumindo — investigar, nunca aceitar como instabilidade.

- [ ] **Passo 8: medir a tela num navegador de verdade, a 375px**

```bash
npm run dev -- --port 5199 --strictPort
```

Abrir `/autenticidade` a 375px de largura e conferir, com os olhos:
1. o botão "Gravar nesta etiqueta" cabe sem estourar a largura;
2. o recado de gravação não corta texto (a caixa cresce, não esconde);
3. o endereço não vaza para fora do cartão;
4. contraste legível nos **dois temas**, claro e escuro;
5. o modo de queda aparece quando `gravaPorNfc` é falso.

⚠️ Teste verde não é tela que abre: `node --test` não compila `.vue`.

- [ ] **Passo 9: commitar**

```bash
git add src/ferramentas/autenticidade/tela-de-autenticidade.vue
git commit -m "autenticidade: gravar a etiqueta encostando o celular

A aba Gravar ganha o modo NFC quando o navegador grava (Chrome no Android). O
modo de hoje — endereco, copiar, 'Gravei essa' — continua INTEIRO, porque e a
queda para iPhone e computador e a fabrica nao pode ficar refem do aparelho.

A regra inteira: le antes (etiqueta com outra peca faz PARAR, nunca
sobrescreve), grava, le depois, e so entao marca. Marcar porque o write nao deu
erro seria marcar no escuro — e no escuro a peca entra como pronta com a
etiqueta em branco costurada dentro da bolsa.

O interruptor da trava nasce desligado, e diz que nao tem volta."
```

---

### Tarefa 5: Documentar as duas amarras, para a mudança de repositório

**Arquivos:**
- Modificar: `src/ferramentas/autenticidade/LEIA-ME.txt`

**Interfaces:** nenhuma.

- [ ] **Passo 1: escrever**

Acrescentar ao fim de `src/ferramentas/autenticidade/LEIA-ME.txt`:

```
GRAVAR ENCOSTANDO O CELULAR
===========================

A aba Gravar tem dois modos. Onde o navegador grava NFC (Chrome no Android),
voce encosta a etiqueta e ela grava sozinha. Onde nao grava (iPhone,
computador), ela continua como sempre foi: endereco grande, copiar, "Gravei
essa". A fabrica nao pode ficar refem do aparelho.

A REGRA: LER ANTES E LER DEPOIS.
Antes, porque etiqueta que ja tem OUTRA peca nao pode ser sobrescrita — isso
mandaria duas bolsas para o lixo de uma vez.
Depois, porque a prova de que gravou nao e o navegador nao reclamar: e a
etiqueta devolver o que se pos nela. Sem essa leitura, uma peca entraria como
pronta com a etiqueta EM BRANCO ja costurada dentro da bolsa.

A TRAVA e permanente e nasce DESLIGADA. Quando for ligar, o primeiro teste tem
de ser numa etiqueta descartavel — etiqueta travada nunca mais se regrava.

A ETIQUETA vai costurada no forro interno, longe de fecho, rebite e corrente:
NFC nao funciona encostado em metal.

QUANDO ESTA PASTA MUDAR DE REPOSITORIO
======================================

Ela foi escrita para sair daqui e ir para o repositorio que tiver o modulo de
producao. Sao DUAS amarras com o iamundi, e as duas moram so no .vue:

  1. o login e a permissao 'autenticidade'
  2. o cliente `supabase` e o `adminToast`

nfc-fila.js, gravador-nfc.js e lotes.js nao importam NADA do projeto — sao
contas puras mais uma porta para o navegador. Mudar de casa e copiar a pasta e
trocar essas duas amarras.

O QUE NAO PODE MUDAR NUNCA
==========================

O endereco gravado na etiqueta: https://vesselbrasil.com.br/verify/<CODIGO>.
Etiqueta costurada dentro de bolsa vendida nao se regrava. A partir da primeira
etiqueta gravada, renovar vesselbrasil.com.br deixa de ser opcional — e o
caminho /verify/ e o formato do codigo congelam junto.
O dominio sai de enderecoDaTag() em lotes.js e de nenhum outro lugar.
```

- [ ] **Passo 2: conferir que a suíte continua verde**

Rodar: `npm test`
Esperado: PASSA, zero falhas.

- [ ] **Passo 3: commitar**

```bash
git add src/ferramentas/autenticidade/LEIA-ME.txt
git commit -m "autenticidade: o LEIA-ME diz como esta pasta sai daqui

Sao duas amarras com o iamundi e as duas moram no .vue: o login e o supabase.
O resto e conta pura. Mudar de casa e copiar a pasta e trocar essas duas.

E registra o que NAO pode mudar nunca: o endereco gravado na etiqueta."
```

---

## Depois de tudo

Anunciar: "Vou usar a skill finishing-a-development-branch para fechar este
trabalho." **SUB-SKILL OBRIGATÓRIA:** `superpowers:finishing-a-development-branch`.

## O que este plano NÃO faz

O layout de varejo do `/verify`, a Ordem de Produção, o PDV e o espelho CSV dos
registros. São os projetos 2 a 5 da spec.

## Pendências do dono, que nenhum código resolve

1. Comprar as etiquetas — NTAG213 comum serve, porque vão costuradas no forro,
   longe da ferragem.
2. Um aparelho Android para gravar pelo celular; o gravador de mesa é opcional.
3. A partir da primeira etiqueta gravada, `vesselbrasil.com.br` vira compromisso
   permanente.
