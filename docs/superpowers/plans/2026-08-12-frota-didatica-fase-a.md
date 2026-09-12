# Frota didática — Fase A: a tela para de confundir

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA: use `superpowers:subagent-driven-development`
> (recomendado) ou `superpowers:executing-plans` pra executar tarefa a tarefa.
> Os passos usam caixa de marcar (`- [ ]`) pra acompanhar.

**Objetivo:** consertar os três defeitos que fazem a tela mentir (local que
some, carro sem nome, modal que arrasta) e tirar da frente o que confunde
(exemplos dentro do campo, duas seções repetidas, aba Revisões que esconde).

**Desenho:** `docs/superpowers/specs/2026-08-12-frota-didatica-design.md` —
Fase A cobre **B1, B2, B3, D30, D31, D32**. Nada aqui toca no banco.

**Arquitetura:** as peças novas nascem em arquivo próprio com teste ao lado
(D35); `tela-de-frota.vue` (2.976 linhas) só é encostado onde não há saída. A
resolução do local reaproveita `src/compartilhado/arvore-de-locais.js`, que já
sabe montar caminho e já trata "o local sumiu" — nada de árvore nova.

**Tecnologia:** Vue 3 + Vite · testes com `node --test` em `*.test.mjs` ·
Supabase (só leitura nesta fase).

## Restrições que valem para TODAS as tarefas

- **`PADRAO-DA-CENTRAL.md` é obrigatório.** Cor só por token (`var(--…)`), nunca
  hex. Botão tem três tipos e só. Texto nunca corta. Alvo de toque 40px.
- **A tela nunca mente.** Campo sem resposta mostra travessão; nada de valor
  inventado, nada de "deu certo" sem conferir.
- **`node --test` NÃO compila `.vue`.** `npm test` verde não prova que a tela
  abre. `src/compartilhado/todo-vue-compila.test.mjs` é a guarda — ela roda
  dentro de `npm test`, e **`npm run build` também é obrigatório** antes de
  cada commit que mexa em `.vue`.
- **Servidor de desenvolvimento com porta fixa:** `npm run dev -- --port 5199
  --strictPort`. Há mais de uma janela neste repositório; nunca matar processo
  alheio.
- **Nunca escrever no banco de produção.** Esta fase inteira é de leitura. Se
  abrir o app com a sessão real pra conferir, só olhar.
- **Commits só nos arquivos da tarefa** — `git add <arquivo>`, nunca
  `git add <pasta>`: outras sessões editam este repositório junto.
- **Sem emoji como ícone.** SVG próprio.
- **Idioma:** nomes de arquivo e de função em português literal, kebab-case nos
  arquivos. Comentário explica **por quê**, não o quê.

---

### Tarefa 1: Onde o carro fica — a leitura que faltava (B1)

O card lê `local_texto` (o texto digitado à mão) e ignora o `local_id` da
árvore. 9 dos 10 carros têm `local_id`; em 4 deles o texto está vazio e a tela
mostra nada.

**Arquivos:**
- Criar: `src/ferramentas/frota/onde-o-carro-fica.js`
- Criar: `src/ferramentas/frota/onde-o-carro-fica.test.mjs`

**Interfaces:**
- Consome: `montarArvore`, `estadoDaEscolha` de `src/compartilhado/arvore-de-locais.js`
- Produz: `ondeOCarroFica({ arvore, veiculo }) → { curto, completo, tipo }`
  - `curto`: o que cabe no card — `"Casa RB"` ou `"Casa RB › Garagem"` (sem a
    marca na frente; o card é estreito e a empresa do carro é outro campo)
  - `completo`: o caminho inteiro com a marca — `"RB Builders › Casa RB › Garagem"`
  - `tipo`: `'arvore' | 'texto' | 'local-sumiu' | 'vazio'`

- [ ] **Passo 1: escrever o teste que falha**

```js
// src/ferramentas/frota/onde-o-carro-fica.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { montarArvore } from '../../compartilhado/arvore-de-locais.js'
import { ondeOCarroFica } from './onde-o-carro-fica.js'

/* Os dados são os reais medidos em 12/08/2026: 9 dos 10 carros têm `local_id`
 * apontado, e em 4 deles (BDN3A67, ERO3G55, EDC6H82, OLW4I46) o `local_texto`
 * está vazio — são justamente os que a tela mostrava em branco. */

const EMPRESAS = [{ id: 'e-rb', nome: 'RB Builders' }, { id: 'e-vs', nome: 'Vessel' }]
const LOCAIS = [
  { id: 'l-casa', nome: 'Casa RB', empresa_id: 'e-rb' },
  { id: 'l-fab', nome: 'Fábrica Conchal', empresa_id: 'e-vs' },
]
const COMODOS = [{ id: 'c-gar', nome: 'Garagem', local_id: 'l-casa' }]
const arvore = montarArvore({ empresas: EMPRESAS, locais: LOCAIS, comodos: COMODOS })

test('o local apontado na árvore aparece, mesmo sem texto escrito à mão', () => {
  // O caso do Volvo XC60: local apontado em 11/08, local_texto nulo, tela vazia.
  const r = ondeOCarroFica({ arvore, veiculo: { local_id: 'l-casa', local_texto: null } })
  assert.equal(r.tipo, 'arvore')
  assert.equal(r.curto, 'Casa RB')
  assert.equal(r.completo, 'RB Builders › Casa RB')
})

test('o ambiente entra no curto, e a marca só no completo', () => {
  const r = ondeOCarroFica({
    arvore, veiculo: { local_id: 'l-casa', comodo_id: 'c-gar', local_texto: null },
  })
  assert.equal(r.curto, 'Casa RB › Garagem')
  assert.equal(r.completo, 'RB Builders › Casa RB › Garagem')
})

test('a árvore VENCE o texto antigo — é o defeito que este módulo existe pra consertar', () => {
  // O caso da BMW/Porsche/XC90: apontaram a árvore e a tela continuou mostrando
  // "Casa RB" do texto velho, fazendo parecer que a gravação não pegou.
  const r = ondeOCarroFica({
    arvore, veiculo: { local_id: 'l-fab', local_texto: 'Casa RB' },
  })
  assert.equal(r.tipo, 'arvore')
  assert.equal(r.curto, 'Fábrica Conchal', 'mostrar o texto velho é dizer que não salvou')
})

test('sem árvore apontada, o texto escrito à mão continua valendo', () => {
  const r = ondeOCarroFica({ arvore, veiculo: { local_id: null, local_texto: 'Barracão' } })
  assert.equal(r.tipo, 'texto')
  assert.equal(r.curto, 'Barracão')
  assert.equal(r.completo, 'Barracão')
})

test('local que não está na árvore NÃO vira vazio', () => {
  // Campo que esvazia sozinho é a mentira mais cara: o local pode ter sido
  // apagado, ou quem está olhando pode não enxergá-lo.
  const r = ondeOCarroFica({ arvore, veiculo: { local_id: 'l-que-sumiu', local_texto: 'Conchal' } })
  assert.equal(r.tipo, 'local-sumiu')
  assert.equal(r.curto, 'Conchal', 'a única pista que sobrou tem de aparecer')
})

test('sem local nenhum e sem texto, devolve vazio — e não uma string qualquer', () => {
  const r = ondeOCarroFica({ arvore, veiculo: { local_id: null, local_texto: null } })
  assert.equal(r.tipo, 'vazio')
  assert.equal(r.curto, null)
  assert.equal(r.completo, null)
})

test('árvore ainda não carregada não inventa nada, e não quebra', () => {
  // falhaArvore: quem lê o Patrimônio pode falhar sem derrubar a Frota.
  const r = ondeOCarroFica({ arvore: [], veiculo: { local_id: 'l-casa', local_texto: 'Casa RB' } })
  assert.equal(r.tipo, 'local-sumiu')
  assert.equal(r.curto, 'Casa RB')
})
```

- [ ] **Passo 2: rodar e ver falhar**

Rodar: `node --test src/ferramentas/frota/onde-o-carro-fica.test.mjs`
Esperado: FALHA com `Cannot find module './onde-o-carro-fica.js'`

- [ ] **Passo 3: escrever a implementação mínima**

```js
// src/ferramentas/frota/onde-o-carro-fica.js
/* Onde o carro fica, pra MOSTRAR na tela.
 *
 * O defeito que isto conserta: a lista de carros lia `local_texto` — o texto
 * digitado à mão antes da árvore existir — e nunca o `local_id` que a ficha
 * grava desde a migration 034. Medido em 12/08/2026: 9 dos 10 carros têm
 * `local_id`; em 4 deles o texto está vazio, e o dono apontava o local e a tela
 * ficava em branco. Nos outros 5 era pior de entender: mostrava o texto velho,
 * então parecia que não tinha salvado.
 *
 * A regra: a ÁRVORE VENCE o texto antigo. O texto continua guardado no banco e
 * continua sendo a pista quando não há árvore apontada — nunca é apagado. */

import { caminhoDoLocal, estadoDaEscolha } from '../../compartilhado/arvore-de-locais.js'

/**
 * Devolve `{ curto, completo, tipo }`.
 *
 * `curto` é o que entra no card, que é estreito: local, e ambiente quando há.
 * A MARCA fica de fora do curto de propósito — a empresa do carro é outro campo
 * da ficha, e repeti-la em toda linha rouba a largura do que interessa. No
 * `completo` ela vem, porque lá o caminho tem de identificar sozinho.
 *
 * `tipo` diz DE ONDE veio a resposta, pra tela poder tratar cada caso:
 *  - 'arvore'      → apontado na árvore. O caso bom.
 *  - 'texto'       → só o texto escrito à mão. Continua valendo.
 *  - 'local-sumiu' → tem `local_id` que a árvore não conhece (apagado, ou a
 *                    árvore não carregou). NUNCA vira vazio: campo que esvazia
 *                    sozinho é a mentira mais cara.
 *  - 'vazio'       → nunca foi preenchido.
 */
export function ondeOCarroFica({ arvore, veiculo } = {}) {
  const v = veiculo || {}
  const estado = estadoDaEscolha({
    arvore,
    localId: v.local_id || null,
    comodoId: v.comodo_id || null,
    textoLivre: v.local_texto || '',
  })

  if (estado.tipo === 'escolhido') {
    const { local, comodo } = estado.caminho
    return {
      tipo: 'arvore',
      curto: [local?.nome, comodo?.nome].filter(Boolean).join(' › '),
      completo: estado.caminho.rotulo,
    }
  }

  if (estado.tipo === 'local-sumiu') {
    const texto = estado.textoAntigo || null
    return { tipo: 'local-sumiu', curto: texto, completo: texto }
  }

  if (estado.tipo === 'texto-livre') {
    return { tipo: 'texto', curto: estado.texto, completo: estado.texto }
  }

  return { tipo: 'vazio', curto: null, completo: null }
}

/** Só o texto curto, ou nulo. Atalho pra quem só quer preencher uma linha. */
export function localCurto({ arvore, veiculo } = {}) {
  return ondeOCarroFica({ arvore, veiculo }).curto
}

// `caminhoDoLocal` fica importado de propósito: é a peça que `estadoDaEscolha`
// usa por dentro, e deixá-la à vista aqui evita que a próxima pessoa monte um
// segundo jeito de resolver o mesmo caminho.
export { caminhoDoLocal }
```

Conferido em `src/compartilhado/arvore-de-locais.js:253`: o desfecho
`texto-livre` devolve `{ tipo: 'texto-livre', texto, sugestoes }`, então
`estado.texto` é o nome certo. `sugestoes` é ignorado aqui de propósito — ele
serve pra oferecer locais na FICHA, e o card só mostra.

- [ ] **Passo 4: rodar e ver passar**

Rodar: `node --test src/ferramentas/frota/onde-o-carro-fica.test.mjs`
Esperado: PASSA, 7 testes

- [ ] **Passo 5: commitar**

```bash
git add src/ferramentas/frota/onde-o-carro-fica.js src/ferramentas/frota/onde-o-carro-fica.test.mjs
git commit -m "Onde o carro fica: a árvore vence o texto antigo (B1)"
```

---

### Tarefa 2: Ligar o local na lista de carros (B1)

**Arquivos:**
- Modificar: `src/ferramentas/frota/estado-do-veiculo.js:85` (o `ondeEsta`)
- Modificar: `src/ferramentas/frota/estado-do-veiculo.test.mjs` (teste novo)
- Modificar: `src/ferramentas/frota/tela-de-frota.vue` — o computed `linhas`
  (linha ~577) e a leitura de `l.ondeEsta` no card

**Interfaces:**
- Consome: `ondeOCarroFica` da Tarefa 1
- Produz: `estadoDoVeiculo()` passa a preferir `veiculo.local_bonito` e cair em
  `veiculo.local_texto`. A assinatura **não muda** —
  `estadoDoVeiculo(veiculo, usos, fichas)` continua igual, e quem chama enriquece
  o veículo antes, exatamente como já faz com `pessoa_nome` (linha 579).

- [ ] **Passo 1: escrever o teste que falha**

```js
// acrescentar em src/ferramentas/frota/estado-do-veiculo.test.mjs
test('onde o carro está prefere o local da árvore ao texto antigo', () => {
  // Medido em 12/08: BMW, Porsche e XC90 tinham árvore apontada E texto velho.
  // A tela mostrava o texto velho, e o dono achava que não tinha salvado.
  const v = { id: 'v1', situacao: 'ativo', local_texto: 'Casa RB', local_bonito: 'Fábrica Conchal' }
  const e = estadoDoVeiculo(v, [], [])
  assert.equal(e.ondeEsta, 'Fábrica Conchal')
})

test('sem local da árvore, o texto escrito à mão continua aparecendo', () => {
  const v = { id: 'v1', situacao: 'ativo', local_texto: 'Barracão', local_bonito: null }
  assert.equal(estadoDoVeiculo(v, [], []).ondeEsta, 'Barracão')
})

test('carro na rua não mostra local nenhum — está com uma pessoa, não num lugar', () => {
  const v = { id: 'v1', situacao: 'ativo', local_texto: 'Barracão', local_bonito: 'Casa RB' }
  const usos = [{ veiculo_id: 'v1', tipo: 'viagem', volta_em: null, pessoa_nome: 'Gabriel' }]
  assert.equal(estadoDoVeiculo(v, usos, []).ondeEsta, null)
})
```

- [ ] **Passo 2: rodar e ver falhar**

Rodar: `node --test src/ferramentas/frota/estado-do-veiculo.test.mjs`
Esperado: FALHA no primeiro — devolve `'Casa RB'` em vez de `'Fábrica Conchal'`

- [ ] **Passo 3: implementar**

Em `src/ferramentas/frota/estado-do-veiculo.js`, trocar a linha do `ondeEsta`:

```js
    // ONDE ELE ESTÁ: o local apontado na árvore VENCE o texto digitado à mão.
    // O contrário era o defeito B1 — 9 dos 10 carros tinham local apontado e a
    // lista lia só `local_texto`, então o trabalho de apontar não aparecia em
    // lugar nenhum. `local_bonito` é enriquecido por quem chama (mesmo padrão
    // de `pessoa_nome`), porque resolver a árvore aqui obrigaria esta função —
    // que é pura e roda no teste — a conhecer o Patrimônio.
    ondeEsta: aberto ? null : (veiculo.local_bonito || veiculo.local_texto || null),
```

Em `src/ferramentas/frota/tela-de-frota.vue`, no computed `linhas` (~577),
acrescentar o enriquecimento — a árvore já está carregada em `empresasPat`,
`locaisPat` e `comodosPat` (`carregar()` chama `carregarArvoreDeLocais()` na
linha 514, então ela chega junto com os carros):

```js
const arvoreDeLocais = computed(() => montarArvore({
  empresas: empresasPat.value, locais: locaisPat.value, comodos: comodosPat.value,
}))

const linhas = computed(() => ordenarEstados(
  veiculos.value.map((v) => {
    const dono = {
      ...v,
      pessoa_nome: nomeDaPessoa(v.pessoa_id),
      local_bonito: localCurto({ arvore: arvoreDeLocais.value, veiculo: v }),
    }
    const quem = quemEstaComOCarro(dono, usos.value)
    return estadoDoVeiculo({ ...dono, pessoa_nome: quem.pessoaNome }, usos.value, fichas.value)
  }),
))
```

E os `import` no topo do bloco `<script setup>`:

```js
import { montarArvore } from '../../compartilhado/arvore-de-locais.js'
import { localCurto } from './onde-o-carro-fica.js'
```

⚠️ `montarArvore` pode já estar importado (a ficha usa a árvore). Conferir antes
de duplicar o import — import repetido é erro de build.

- [ ] **Passo 4: rodar tudo e conferir**

```bash
node --test src/ferramentas/frota/estado-do-veiculo.test.mjs
npm test
npm run build
```
Esperado: os três verdes. `npm run build` é obrigatório porque `node --test` não
compila `.vue`.

- [ ] **Passo 5: ver na tela**

`npm run dev -- --port 5199 --strictPort`, abrir a Frota, aba Gestão.
Esperado: **Volvo XC60, Ford Fiesta Sedan, Fiat Punto e Fiat Bravo Essence**
deixam de aparecer sem local. Nenhum carro perde o local que já mostrava.

- [ ] **Passo 6: commitar**

```bash
git add src/ferramentas/frota/estado-do-veiculo.js src/ferramentas/frota/estado-do-veiculo.test.mjs src/ferramentas/frota/tela-de-frota.vue
git commit -m "O local apontado na árvore finalmente aparece na lista (B1)"
```

---

### Tarefa 3: O carro volta a dizer com quem está (B2)

`quemEstaComOCarro()` devolve `posse.pessoa_nome || null` e ignora o dono fixo
quando há posse. Em 5 das 8 posses abertas o nome está em branco (abertas em
06/08 gravando só o `pessoa_id`), e 5 carros com dono cadastrado aparecem sem
ninguém.

**Arquivos:**
- Modificar: `supabase/functions/_shared/posse.js` — `quemEstaComOCarro`
- Modificar: `supabase/functions/_shared/posse.test.mjs`
- Modificar: `src/ferramentas/frota/tela-de-frota.vue` — a chamada no `linhas`

**Interfaces:**
- Produz: `quemEstaComOCarro(veiculo, usos, pessoas)` — terceiro parâmetro
  **opcional**, uma lista `[{ id, nome }]`. Sem ele, o comportamento é
  exatamente o de hoje (a Edge continua chamando com dois argumentos e nada
  muda pra ela). É o mesmo padrão do `pessoas` opcional que
  `contatoParaCobranca()` já usa em `contato-do-motorista.js`.

- [ ] **Passo 1: escrever o teste que falha**

```js
// acrescentar em supabase/functions/_shared/posse.test.mjs
test('posse sem nome gravado descobre o nome pelo identificador', () => {
  // O caso real: 5 das 8 posses abertas em 06/08 gravaram só o pessoa_id.
  // Sem isto, XC90, Porsche, Punto, Fiesta e XC60 aparecem sem ninguém.
  const veiculo = { id: 'v1', pessoa_id: 'p-humberto', pessoa_nome: 'Humberto Mendonça' };
  const usos = [{ veiculo_id: 'v1', tipo: 'posse', volta_em: null, pessoa_id: 'p-humberto', pessoa_nome: null }];
  const pessoas = [{ id: 'p-humberto', nome: 'Humberto Mendonça' }];
  const quem = quemEstaComOCarro(veiculo, usos, pessoas);
  assert.equal(quem.pessoaNome, 'Humberto Mendonça');
  assert.equal(quem.porPosse, true);
});

test('o nome GRAVADO na posse continua vencendo a lista de pessoas', () => {
  // A Bravo está com Gabriel por posse, e o dono fixo é o Erick. Deixar a lista
  // sobrescrever diria que o carro está com quem não está com ele.
  const veiculo = { id: 'v1', pessoa_id: 'p-erick', pessoa_nome: 'Erick Martins' };
  const usos = [{ veiculo_id: 'v1', tipo: 'posse', volta_em: null, pessoa_id: 'p-gabriel', pessoa_nome: 'Gabriel Alves' }];
  const pessoas = [{ id: 'p-gabriel', nome: 'Gabriel A. Silva' }];
  assert.equal(quemEstaComOCarro(veiculo, usos, pessoas).pessoaNome, 'Gabriel Alves');
});

test('sem a lista de pessoas, nada muda — a Edge chama com dois argumentos', () => {
  const veiculo = { id: 'v1', pessoa_id: 'p-a', pessoa_nome: 'Fulano' };
  const usos = [{ veiculo_id: 'v1', tipo: 'posse', volta_em: null, pessoa_id: 'p-a', pessoa_nome: null }];
  assert.equal(quemEstaComOCarro(veiculo, usos).pessoaNome, null);
});

test('posse com pessoa_id que não está na lista não inventa nome', () => {
  const veiculo = { id: 'v1', pessoa_id: 'p-a', pessoa_nome: 'Fulano' };
  const usos = [{ veiculo_id: 'v1', tipo: 'posse', volta_em: null, pessoa_id: 'p-sumiu', pessoa_nome: null }];
  assert.equal(quemEstaComOCarro(veiculo, usos, [{ id: 'p-a', nome: 'Fulano' }]).pessoaNome, null);
});
```

- [ ] **Passo 2: rodar e ver falhar**

Rodar: `node --test supabase/functions/_shared/posse.test.mjs`
Esperado: FALHA nos dois primeiros com `null`

- [ ] **Passo 3: implementar**

```js
export function quemEstaComOCarro(veiculo, usos, pessoas) {
  const posse = veiculo ? posseAberta(usos, veiculo.id) : null;
  if (posse) {
    // O nome GRAVADO na posse vence sempre: ele é o que valia no dia em que a
    // posse foi aberta, e histórico que muda quando o cadastro muda deixa de
    // ser histórico. A lista só entra quando o nome está em BRANCO — as 5
    // posses abertas em 06/08 gravaram só o pessoa_id, e sem este resgate 5
    // carros com dono cadastrado aparecem sem ninguém (defeito B2).
    // `pessoas` é opcional de propósito: a Edge chama com dois argumentos e
    // não tem a lista à mão. Sem ela, o comportamento é o de antes.
    const nome = posse.pessoa_nome
      || (posse.pessoa_id && pessoas
        ? ((pessoas.find((p) => p && p.id === posse.pessoa_id) || {}).nome || null)
        : null);
    return { pessoaId: posse.pessoa_id || null, pessoaNome: nome || null, porPosse: true };
  }
  return {
    pessoaId: (veiculo && veiculo.pessoa_id) || null,
    pessoaNome: (veiculo && veiculo.pessoa_nome) || null,
    porPosse: false,
  };
}
```

Em `tela-de-frota.vue`, passar a lista na chamada do `linhas`:

```js
    const quem = quemEstaComOCarro(dono, usos.value, pessoas.value)
```

- [ ] **Passo 4: rodar tudo**

```bash
node --test supabase/functions/_shared/posse.test.mjs
npm test
npm run build
```
Esperado: verdes.

- [ ] **Passo 5: ver na tela**

Frota › Gestão. Esperado: **Volvo XC90, Porsche Cayenne, Fiat Punto, Ford Fiesta
Sedan e Volvo XC60** passam a dizer com quem estão. A **Bravo Blackmotion
continua dizendo "Gabriel Alves"** — o nome gravado na posse não pode mudar.

- [ ] **Passo 6: commitar**

```bash
git add supabase/functions/_shared/posse.js supabase/functions/_shared/posse.test.mjs src/ferramentas/frota/tela-de-frota.vue
git commit -m "Posse sem nome descobre quem está com o carro pelo identificador (B2)"
```

---

### Tarefa 4: O modal para de arrastar pros lados (B3)

`.fr-ficha-corpo` tem `overflow-y:auto`. Pela regra do CSS, um eixo em `auto`
com o outro em `visible` faz o outro virar `auto` também — a rolagem horizontal
veio de brinde. O `touch-action:pan-y` de hoje está em `.fr-ficha-fundo > *`,
que pega a moldura e **não** o corpo que rola.

**Isto é hipótese lida no CSS.** A tarefa começa medindo, não consertando.

**Arquivos:**
- Modificar: `src/ferramentas/frota/tela-de-frota.vue` — o bloco `<style>`,
  `.fr-ficha-corpo` (~linha 2949)

- [ ] **Passo 1: medir o defeito ANTES de mexer**

`npm run dev -- --port 5199 --strictPort`, navegador a **375px de largura**,
abrir a ficha de um veículo e tentar arrastar pro lado.

Anotar: **arrasta?** E **qual elemento está mais largo que a caixa?** (no
inspetor: comparar `scrollWidth` com `clientWidth` do `.fr-ficha-corpo`, e achar
o filho culpado).

Se **não arrastar** a 375px, não inventar conserto: registrar no plano em que
largura e em que ficha ele arrasta, e só então seguir. O dono viu acontecer —
achar onde é parte da tarefa.

- [ ] **Passo 2: consertar**

```css
/* O corpo rola SÓ na vertical. `overflow-y:auto` com o eixo x em `visible` faz
   o x virar `auto` sozinho pela regra do CSS — foi assim que a ficha ficou
   arrastável pros lados sem ninguém pedir, e num modal que trava a rolagem do
   fundo isso é ficar perdido dentro da caixa. `clip` e não `hidden` pra não
   quebrar `position:sticky` de nada que venha a morar aqui — mesma escolha do
   `html,body` nos estilos globais.
   `touch-action:pan-y` REPETIDO aqui de propósito: o que existe em
   `.fr-ficha-fundo > *` pega a moldura da ficha, não este corpo, e é neste que
   o dedo encosta. */
.tela-frota .fr-ficha-corpo{padding:14px 15px;overflow-y:auto;overflow-x:clip;touch-action:pan-y;overscroll-behavior:contain;display:flex;flex-direction:column;gap:13px;}
/* Filho de grade sem `min-width:0` não encolhe abaixo do próprio conteúdo — é
   o que empurra a caixa e cria o estouro que a rolagem horizontal mostrava. */
.tela-frota .fr-dupla > *{min-width:0;}
```

- [ ] **Passo 3: medir de novo, na mesma largura**

Mesma ficha, 375px. Esperado: **não arrasta pros lados**, e **nada foi cortado**
— conferir que nenhum campo, rótulo ou botão sumiu na borda direita.
`overflow-x:clip` corta em silêncio; é justamente por isso que este passo existe.

Conferir também as outras fichas que usam `.fr-ficha`: retirar/devolver,
requisição, decisão, item do plano, detalhe de checklist.

- [ ] **Passo 4: build**

```bash
npm test && npm run build
```

- [ ] **Passo 5: commitar**

```bash
git add src/ferramentas/frota/tela-de-frota.vue
git commit -m "O modal para de arrastar pros lados (B3)"
```

---

### Tarefa 5: O exemplo sai de dentro do campo (D31)

`tela-de-frota.vue` tem 20 `placeholder`. **8 parecem dado preenchido** —
`JHM Auto Center` (2×), `(19) 3033-9837` (2×), `CTR-007`, `RBB-007`, `145928`,
`20000` — e outros 9 são listas de exemplo dentro da caixa. Os 17 saem.

**O que NÃO se mexe:** `placeholder` que é instrução, não valor — `"opcional"`,
e os de `painel-de-checklist.vue` (`"a mesma senha com que você entra"`,
`"Conte o que você viu…"`, `'— — —'`). Ninguém confunde instrução com dado, e o
`'— — —'` do hodômetro já foi decidido assim de propósito.

**Arquivos:**
- Modificar: `src/ferramentas/frota/tela-de-frota.vue`

- [ ] **Passo 1: aplicar o padrão, campo a campo**

O padrão, usando o `<span class="fr-ajuda">` que a tela já tem:

```html
<!-- ANTES -->
<label class="fr-campo"><span class="fr-lab">Contrato</span><input v-model="vForm.contrato" type="text" placeholder="CTR-007"></label>

<!-- DEPOIS -->
<label class="fr-campo">
  <span class="fr-lab">Contrato</span>
  <input v-model="vForm.contrato" type="text">
  <span class="fr-ajuda">Ex.: CTR-007</span>
</label>
```

Os 17, pela linha aproximada (conferir cada uma, o arquivo muda de tamanho a
cada tarefa):

| Campo | Exemplo que sai |
|---|---|
| `contato_nome` (~2163) | JHM Auto Center |
| `contato_papel` (~2164) | Oficina, locadora, seguro, guincho |
| `contato_telefone` (~2167) | (19) 3033-9837 |
| `contrato` (~2179) | CTR-007 |
| `oficina_nome` (~2195) | JHM Auto Center |
| `oficina_telefone` (~2198) | (19) 3033-9837 |
| `tag_pedagio` (~2207) | Sem Parar, número da tag |
| `rastreador` (~2208) | empresa, identificador |
| `codigo_patrimonial` (~2209) | RBB-007 |
| `itemForm.item` (~2381) | Filtro de ar, fluido de freio |
| `itemForm.aCadaKm` (~2385) | 20000 |
| `pedidoForm.destino` (~2560) | Conchal, Campinas |
| `pedidoForm.finalidade` (~2564) | Homologação, buscar pedido |
| `pedidoForm.departamento` (~2568) | Administrativo, Marketing |
| `form.km` (~2675) | 145928 |
| `form.destino` (~2692) | Conchal, Rio Claro |
| `form.finalidade` (~2696) | Homologação, buscar pedido |

⚠️ **Onde já existe um `<span class="fr-ajuda">` no campo** (é o caso de
`contato_telefone` e `oficina_telefone`, que têm o aviso de "sem DDD não dá
link"), **acrescentar o exemplo sem apagar o aviso** — o aviso explica por que o
WhatsApp não monta, e perdê-lo devolve um defeito já consertado.

⚠️ `placeholder` **dinâmico** (~2603, o do motivo da decisão) **não se mexe**:
ele muda de texto conforme aprovar ou recusar, e é instrução, não valor.

- [ ] **Passo 2: conferir que nenhum sobrou nem foi longe demais**

```bash
grep -c 'placeholder=' src/ferramentas/frota/tela-de-frota.vue
```
Esperado: **3** (os dois `"opcional"` e o dinâmico do motivo).

```bash
grep -c 'placeholder=' src/ferramentas/frota/painel-de-checklist.vue
```
Esperado: **4**, igual a antes — esta tela não se mexe.

- [ ] **Passo 3: build e tela**

```bash
npm test && npm run build
```
Depois, a 375px: conferir que a ficha do veículo **não ficou mais alta a ponto
de esconder o botão de gravar**, e que a ajuda não corta.

- [ ] **Passo 4: commitar**

```bash
git add src/ferramentas/frota/tela-de-frota.vue
git commit -m "O exemplo sai de dentro do campo e vira ajuda embaixo (D31)"
```

---

### Tarefa 6 (REVISADA pelo dono em 12/08): Contato entra em "De quem é e onde está"; Oficina fica e recebe o histórico (D32)

> ⚠️ **A primeira versão desta tarefa foi implementada e depois corrigida pelo
> dono.** Ela unia Contato+Oficina. Está errada. A forma certa é a de baixo:
> Contato entra na seção do responsável, Oficina continua existindo com a
> mecânica e o telefone dela, e o **Histórico de manutenção** — que hoje é uma
> seção solta lá embaixo — passa a morar dentro de Oficina.
>
> ```
> DE QUEM É, ONDE FICA E COM QUEM FALAR
>   Responsável · De qual empresa é · Onde fica
>   Contato: quem é · o que faz · telefone
>
> OFICINA
>   Mecânica · Telefone da oficina
>   Histórico de manutenção
> ```
>
> O texto abaixo descreve a versão VELHA e fica só como registro do que foi
> feito antes da correção. As travas dele continuam valendo todas:
> `CAMPOS_VEICULO` intacto, os dois `data-tour` existindo, os avisos de WhatsApp
> preservados e mutuamente exclusivos com o exemplo.

<details>
<summary>Versão anterior (unia Contato+Oficina) — não implementar</summary>


**Nenhuma coluna do banco muda.** `contato_nome`, `contato_papel`,
`contato_telefone`, `oficina_nome` e `oficina_telefone` continuam existindo e
sendo gravados — `CAMPOS_VEICULO` **não se mexe**. O que muda é o agrupamento e
os rótulos.

**Arquivos:**
- Modificar: `src/ferramentas/frota/tela-de-frota.vue` — as duas seções e
  `PASSOS_VEICULO` (o passeio guiado aponta pra `data-tour="veic-contato"` e
  `data-tour="veic-oficina"`)

- [ ] **Passo 1: juntar as duas seções**

Apagar o bloco `<h3 class="fr-grupo">Oficina</h3>` e mover os dois campos dele
pra dentro da seção de contato, que passa a se chamar assim:

```html
<h3 class="fr-grupo" data-tour="veic-contato">Quem cuida deste carro</h3>
<div class="fr-dupla">
  <label class="fr-campo" data-tour="veic-oficina">
    <span class="fr-lab">Oficina</span>
    <input v-model="vForm.oficina_nome" type="text">
    <span class="fr-ajuda">Ex.: JHM Auto Center</span>
  </label>
  <label class="fr-campo">
    <span class="fr-lab">Telefone da oficina</span>
    <input v-model="vForm.oficina_telefone" type="tel" inputmode="tel">
    <span class="fr-ajuda" v-if="vForm.oficina_telefone && !linkDoWhatsapp(vForm.oficina_telefone)">
      {{ porQueNaoDaLink(vForm.oficina_telefone) }}
    </span>
    <span class="fr-ajuda" v-else>Ex.: (19) 3033-9837</span>
  </label>
  <label class="fr-campo">
    <span class="fr-lab">Outro contato</span>
    <input v-model="vForm.contato_nome" type="text">
    <span class="fr-ajuda">Locadora, seguro, guincho — quem mais resolve coisa deste carro.</span>
  </label>
  <label class="fr-campo">
    <span class="fr-lab">Telefone do outro contato</span>
    <input v-model="vForm.contato_telefone" type="tel" inputmode="tel">
    <span class="fr-ajuda" v-if="vForm.contato_telefone && !linkDoWhatsapp(vForm.contato_telefone)">
      {{ porQueNaoDaLink(vForm.contato_telefone) }}
    </span>
    <span class="fr-ajuda" v-else>Ex.: (19) 3033-9837</span>
  </label>
  <label class="fr-campo">
    <span class="fr-lab">O que esse outro contato faz</span>
    <input v-model="vForm.contato_papel" type="text">
    <span class="fr-ajuda">Ex.: locadora, seguro, guincho</span>
  </label>
</div>
```

⚠️ **`data-tour="veic-contato"` e `data-tour="veic-oficina"` têm de continuar
existindo** em algum elemento desta seção. `PASSOS_VEICULO` (em `tutorial.js`)
aponta pra eles, e passo de passeio que aponta pra elemento que não existe
quebra o tutorial em silêncio. Conferir os dois em `tutorial.js` e ajustar o
texto do passo pro nome novo da seção.

⚠️ **`contato_nome` continua sendo lido por `contatoParaCobranca()`** como
telefone de resgate do motorista (`contato-do-motorista.js`). Nada muda no
comportamento — mas o rótulo novo ("Outro contato") tem de continuar batendo com
o que aquele módulo espera: o nome de **quem** é o telefone.

- [ ] **Passo 2: conferir que nada de gravação mudou**

```bash
grep -n "CAMPOS_VEICULO = \[" -A 22 src/ferramentas/frota/tela-de-frota.vue | grep -c "contato_nome\|contato_papel\|contato_telefone\|oficina_nome\|oficina_telefone"
```
Esperado: **5**. Se algum sumiu da lista, o campo deixou de ser gravado — que é
exatamente o "salva e não aparece" que esta fase existe pra matar.

- [ ] **Passo 3: rodar tudo e ver na tela**

```bash
npm test && npm run build
```
A 375px: abrir a ficha de um carro **que já tenha oficina preenchida**, conferir
que o valor aparece no campo novo. Abrir o passeio guiado (o "?") e ir até o fim
sem quebrar.

- [ ] **Passo 4: commitar**

```bash
git add src/ferramentas/frota/tela-de-frota.vue src/ferramentas/frota/tutorial.js
git commit -m "Contato e Oficina viram 'Quem cuida deste carro' (D32)"
```

</details>

#### O que fazer agora — Tarefa 6 corrigida

Parte do que já está no ar (commit `71b2314`), que unia as duas seções erradas.

- [ ] **Passo 1: desfazer a união errada e montar a certa**

A seção do responsável recebe o contato, e passa a se chamar assim:

```html
<!-- D32, revisto pelo dono em 12/08: "de quem é o carro" e "com quem eu falo"
     são a MESMA pergunta na cabeça de quem usa, e por isso viram uma seção só.
     Oficina é outra coisa — continua existindo logo abaixo, com a mecânica, o
     telefone dela e o histórico do que ela já trocou. -->
<h3 class="fr-grupo">De quem é, onde fica e com quem falar</h3>
```

Dentro dela, DEPOIS do campo de local que já existe, entram os três campos de
contato que hoje estão em "Quem cuida deste carro":

```html
<div class="fr-dupla">
  <label class="fr-campo" data-tour="veic-contato">
    <span class="fr-lab">Contato</span>
    <input v-model="vForm.contato_nome" type="text">
    <span class="fr-ajuda">O NOME de quem resolve as coisas deste carro. Ex.: Marcus Vinicius</span>
  </label>
  <label class="fr-campo">
    <span class="fr-lab">O que essa pessoa faz</span>
    <input v-model="vForm.contato_papel" type="text">
    <span class="fr-ajuda">Ex.: locadora, seguro, guincho</span>
  </label>
  <label class="fr-campo">
    <span class="fr-lab">Telefone do contato</span>
    <input v-model="vForm.contato_telefone" type="tel" inputmode="tel">
    <span class="fr-ajuda" v-if="vForm.contato_telefone && !linkDoWhatsapp(vForm.contato_telefone)">
      {{ porQueNaoDaLink(vForm.contato_telefone) }}
    </span>
    <span class="fr-ajuda" v-else>Ex.: (19) 3033-9837</span>
  </label>
</div>
```

⚠️ O rótulo do contato **tem de pedir um NOME de pessoa**, e o texto de ajuda
acima diz isso com todas as letras. `contatoParaCobranca()`
(`contato-do-motorista.js`) casa esse nome contra a lista de colaboradores pra
decidir se o telefone é do motorista ou de um terceiro; um rótulo que convide a
escrever "guincho 24h" enfraquece essa decisão em silêncio. Foi um "minor" da
revisão da versão anterior, e aqui ele se resolve.

- [ ] **Passo 2: Oficina volta a existir, e recebe o histórico**

```html
<h3 class="fr-grupo" data-tour="veic-oficina">Oficina</h3>
<div class="fr-dupla">
  <label class="fr-campo">
    <span class="fr-lab">Mecânica</span>
    <input v-model="vForm.oficina_nome" type="text">
    <span class="fr-ajuda">Ex.: JHM Auto Center</span>
  </label>
  <label class="fr-campo">
    <span class="fr-lab">Telefone da oficina</span>
    <input v-model="vForm.oficina_telefone" type="tel" inputmode="tel">
    <span class="fr-ajuda" v-if="vForm.oficina_telefone && !linkDoWhatsapp(vForm.oficina_telefone)">
      {{ porQueNaoDaLink(vForm.oficina_telefone) }}
    </span>
    <span class="fr-ajuda" v-else>Ex.: (19) 3033-9837</span>
  </label>
</div>
```

E o bloco **"Histórico de manutenção"** (hoje um `<h3 class="fr-grupo"
data-tour="veic-historico">` solto mais abaixo, com a tabela e o formulário de
`novaRevisao`) **move inteiro pra logo depois destes dois campos**, sem nenhuma
alteração no que ele faz. É recorte e cola de um bloco, não reescrita: o
`v-if` que o envolve, os `data-tour`, `historicoDoVeiculo` e `gravarRevisao`
continuam exatamente como estão.

- [ ] **Passo 3: as travas, todas de novo**

```bash
# Os 5 campos continuam sendo gravados. `grep -o`, NÃO `grep -c`: a array
# empacota vários nomes por linha, e -c contaria linhas.
sed -n "$(grep -n 'const CAMPOS_VEICULO' src/ferramentas/frota/tela-de-frota.vue | cut -d: -f1),/^]/p" src/ferramentas/frota/tela-de-frota.vue \
  | grep -o "contato_nome\|contato_papel\|contato_telefone\|oficina_nome\|oficina_telefone" | sort | uniq -c
# Esperado: 1 de cada um dos 5.

# Os três data-tour desta região continuam existindo.
grep -c 'data-tour="veic-contato"\|data-tour="veic-oficina"\|data-tour="veic-historico"' src/ferramentas/frota/tela-de-frota.vue
# Esperado: 3.

# O histórico não foi duplicado nem perdido.
grep -c 'Histórico de manutenção' src/ferramentas/frota/tela-de-frota.vue
# Esperado: 1.
```

`tutorial.js`: os passos `veic-contato`, `veic-oficina` e `veic-historico`
precisam descrever o que está na tela AGORA. O passo de contato foi renomeado
pra "Quem cuida deste carro" na versão anterior — tem de voltar a falar de
responsável e contato juntos.

- [ ] **Passo 4: build e commit**

```bash
npm test && npm run build
git add src/ferramentas/frota/tela-de-frota.vue src/ferramentas/frota/tutorial.js
git commit -m "Contato entra na seção do responsável; Oficina fica com o histórico (D32, revisto)"
```

---

### Tarefa 7: Revisões mostra tudo, em sanfona (D30)

Hoje `revisoesPorVeiculo` (~linha 1136) filtra `vencida` e `perto` e depois
descarta o carro inteiro com `.filter((r) => r.itens.length)`. Com 8 dos 10
carros sem quilometragem conhecida, a aba fica praticamente vazia.

**Arquivos:**
- Modificar: `src/ferramentas/frota/revisoes.js` — nova `ordenarCarrosPorUrgencia`
- Modificar: `src/ferramentas/frota/revisoes.test.mjs`
- Criar: `src/ferramentas/frota/sanfona-de-revisoes.vue`
- Modificar: `src/ferramentas/frota/tela-de-frota.vue` — a área `revisoes`

**Interfaces:**
- Consome: `revisoesDoVeiculo`, `resumoDeRevisoes` (já existem em `revisoes.js`)
- Produz: `ordenarCarrosPorUrgencia(cartoes) → cartoes` ordenado, onde cada
  `cartao` é `{ linha, itens, resumo }` — a mesma forma que `revisoesPorVeiculo`
  já monta hoje.

- [ ] **Passo 1: escrever o teste que falha**

⚠️ **Não escrever um `import` novo.** `revisoes.test.mjs` já importa de
`'./revisoes.js'` no topo — importar o mesmo arquivo duas vezes quebra o build.
Acrescentar `ordenarCarrosPorUrgencia` **na lista que já está lá**:

```js
import {
  ultimaRevisao, estadoDaRevisao, revisoesDoVeiculo, resumoDeRevisoes,
  problemasDoItem, avisoAoDesativar, FATIA_DE_AVISO, ordenarCarrosPorUrgencia,
} from './revisoes.js'
```

E os testes, no fim do arquivo:

```js
const cartao = (nome, nivel) => ({ linha: { veiculo: { id: nome, nome } }, itens: [], resumo: { nivel } })

test('o que dói primeiro vem primeiro, e nada é descartado', () => {
  // A aba antiga jogava fora o carro inteiro que não tivesse item vencendo.
  // Medido em 12/08: isso escondia 8 dos 10 carros.
  const fora = [cartao('BMW', 'em-dia'), cartao('Doblo', 'sem-km'),
    cartao('XC60', 'vencida'), cartao('Porsche', 'perto'), cartao('Fit', 'sem-registro')]
  const dentro = ordenarCarrosPorUrgencia(fora)
  assert.deepEqual(dentro.map((c) => c.linha.veiculo.nome),
    ['XC60', 'Porsche', 'BMW', 'Fit', 'Doblo'])
  assert.equal(dentro.length, 5, 'nenhum carro pode sumir da aba')
})

test('empate de urgência desempata pelo nome, pra a lista não dançar a cada carregada', () => {
  const dentro = ordenarCarrosPorUrgencia([cartao('Volvo', 'vencida'), cartao('Fiat', 'vencida')])
  assert.deepEqual(dentro.map((c) => c.linha.veiculo.nome), ['Fiat', 'Volvo'])
})

test('lista vazia não quebra', () => {
  assert.deepEqual(ordenarCarrosPorUrgencia([]), [])
  assert.deepEqual(ordenarCarrosPorUrgencia(null), [])
})
```

- [ ] **Passo 2: rodar e ver falhar**

Rodar: `node --test src/ferramentas/frota/revisoes.test.mjs`
Esperado: FALHA com `ordenarCarrosPorUrgencia is not a function`

- [ ] **Passo 3: implementar a ordenação**

Em `src/ferramentas/frota/revisoes.js`, no fim do bloco de revisões:

```js
/**
 * A ordem da aba Revisões quando ela mostra TUDO (D30): o que dói primeiro em
 * cima, e nenhum carro descartado.
 *
 * A versão antiga jogava fora o carro que não tivesse item vencendo — e como
 * 8 dos 10 carros não têm quilometragem conhecida, a aba ficava praticamente
 * vazia e parecia que estava tudo em dia. "Sem quilometragem" não é estar em
 * dia: é não se saber nada, e some do alerta justamente quem mais precisa dele.
 *
 * O peso reaproveita SITUACOES_REVISAO, que já ordena os itens dentro do carro
 * — dois critérios diferentes pra mesma urgência dariam duas respostas.
 */
export function ordenarCarrosPorUrgencia(cartoes) {
  const peso = (c) => SITUACOES_REVISAO[c && c.resumo && c.resumo.nivel]?.peso ?? 9
  return (cartoes || []).slice().sort((a, b) =>
    peso(a) - peso(b)
    // Desempate pelo nome: sem ele a lista dança de posição a cada carregada,
    // e quem procura um carro pelo lugar onde ele estava não acha.
    || String(a?.linha?.veiculo?.nome || '').localeCompare(String(b?.linha?.veiculo?.nome || '')))
}
```

- [ ] **Passo 4: rodar e ver passar**

Rodar: `node --test src/ferramentas/frota/revisoes.test.mjs`
Esperado: PASSA

- [ ] **Passo 5: trocar o computed da tela**

Em `tela-de-frota.vue`, substituir `revisoesPorVeiculo` por dois computeds — o
antigo **continua existindo** porque é ele que alimenta "Chegando a hora", que
não sai do lugar:

```js
// TODOS os itens de TODOS os carros (D30). A aba Revisões passou a mostrar
// tudo: o dono pediu, e a razão é medida — com 8 dos 10 carros sem
// quilometragem conhecida, filtrar por "vencida ou perto" deixava a aba vazia
// e sugeria frota em dia justamente quando não se sabe nada sobre ela.
const revisoesDeTodosOsCarros = computed(() => ordenarCarrosPorUrgencia(
  linhas.value.map((l) => {
    const todos = revisoesDoVeiculo({
      veiculo: l.veiculo, kmAtual: l.km, plano: plano.value, revisoes: revisoes.value,
    })
    return { linha: l, itens: todos, resumo: resumoDeRevisoes(todos) }
  }),
))
```

O `revisoesPorVeiculo` de hoje fica como está, alimentando "Chegando a hora".

- [ ] **Passo 6: criar a sanfona**

> ⚠️ **Defeito do plano, achado na execução em 12/08 e corrigido aqui.** O
> componente abaixo usava `fr-card`, `fr-selo`, `fr-itens`, `fr-card-ident`,
> `fr-card-nome`, `fr-placa`, `fr-aviso` e `fr-lista` — classes cujas regras
> moram **dentro do `<style scoped>` de `tela-de-frota.vue`**, atrás de um
> ancestral `.tela-frota` e com o `data-v-` daquele arquivo. Componente com
> estilo próprio NÃO herda isso: a sanfona subiria sem estilo nenhum.
>
> **A correção, que é o padrão que os dois componentes irmãos já seguem**
> (`painel-de-checklist.vue` com `ck-*`, `editor-de-checklist.vue`): a sanfona
> traz o **seu próprio bloco de estilo completo, com prefixo `sr-`**, escrito
> só com tokens (`var(--surface)`, `var(--border)`, `var(--text)`,
> `var(--muted)`, `var(--radius-*)`…), nunca hex.
>
> O resultado tem de ficar **visualmente igual aos cartões que já existem na
> aba** — não é liberdade de desenho. O caminho: ler as regras de `.fr-card`,
> `.fr-selo`, `.fr-itens`, `.fr-card-ident`, `.fr-card-nome`, `.fr-placa`,
> `.fr-lista` e `.fr-aviso` no `<style>` de `tela-de-frota.vue` e espelhá-las
> nas classes `sr-` equivalentes, inclusive os estados `vencida` / `perto` /
> `em-dia` / `sem-km` / `sem-registro`.
>
> O que NÃO fazer: `:deep()` pra alcançar as classes do pai (vaza nos dois
> sentidos), estilo global (é o defeito de colisão que esta base já pagou caro),
> e passar as classes `fr-` por propriedade (o estilo continuaria não chegando).

```vue
<!-- src/ferramentas/frota/sanfona-de-revisoes.vue -->
<script setup>
/* A aba Revisões mostrando TUDO, um carro por vez (D30).
 *
 * Sanfona e não lista corrida: são 10 carros × 8 itens = 80 linhas, e 80 linhas
 * de uma vez num celular é rolagem que ninguém termina. Sanfona e não grade
 * carros × itens: grade só cabe arrastando pro lado no celular, que é
 * exatamente a queixa que o B3 conserta. */
import { ref } from 'vue'

// Só `cartoes`. Nada de `podeEditar` aqui: a sanfona desta fase só MOSTRA, e
// propriedade declarada sem uso é peso morto que a próxima pessoa tenta
// adivinhar. O botão "Lançar manutenção" entra na Fase C, e leva a permissão
// dele junto.
defineProps({
  cartoes: { type: Array, required: true },
})

const aberto = ref(null)
const alternar = (id) => { aberto.value = aberto.value === id ? null : id }
const km = (n) => (n == null ? 'sem quilometragem' : `${n.toLocaleString('pt-BR')} km`)
</script>

<template>
  <div class="fr-lista">
    <div v-for="c in cartoes" :key="c.linha.veiculo.id" class="fr-card"
         :class="{ espera: c.resumo.nivel === 'perto', ruimzao: c.resumo.nivel === 'vencida' }">
      <!-- O cabeçalho inteiro é o botão: alvo grande, que é o que o padrão
           manda e o que quem tem dificuldade acerta. -->
      <button type="button" class="sr-topo" :aria-expanded="aberto === c.linha.veiculo.id"
              @click="alternar(c.linha.veiculo.id)">
        <span class="fr-card-ident">
          <span class="fr-card-nome">{{ c.linha.veiculo.nome }}</span>
          <span class="fr-placa">{{ c.linha.veiculo.placa }} · {{ km(c.linha.km) }}</span>
        </span>
        <span class="fr-selo" :class="{
          ruim: c.resumo.nivel === 'vencida',
          espera: c.resumo.nivel === 'perto',
          boa: c.resumo.nivel === 'em-dia',
        }">{{ c.resumo.texto }}</span>
      </button>

      <ul class="fr-itens" v-if="aberto === c.linha.veiculo.id">
        <li v-for="i in c.itens" :key="i.item" :class="i.situacao">
          <span class="fr-item-nome">{{ i.item }}</span>
          <span class="fr-item-txt">{{ i.texto }}</span>
        </li>
      </ul>
    </div>
    <p class="fr-aviso" v-if="!cartoes.length">
      Nenhum veículo cadastrado ainda.
    </p>
  </div>
</template>

<style scoped>
/* Cabeçalho-botão: sem cara de botão, com alvo de botão. `width:100%` e
   `text-align:left` porque o padrão da casa não tem botão que ocupe a linha
   inteira, e este não é um dos três tipos — é a superfície de tocar do cartão. */
.sr-topo{display:flex;align-items:center;justify-content:space-between;gap:10px;
  width:100%;min-height:44px;padding:0;border:none;background:none;text-align:left;
  cursor:pointer;font:inherit;color:inherit;touch-action:manipulation;}
</style>
```

- [ ] **Passo 7: ligar na área Revisões**

Em `tela-de-frota.vue`, dentro de `<template v-if="area === 'revisoes' …">`,
**depois** do bloco "Chegando a hora" que já existe:

```html
      <h2 class="fr-secao">Todos os carros, item por item</h2>
      <p class="fr-aviso">
        Toque no carro para ver os {{ plano.length }} itens do plano — inclusive os que
        estão longe de vencer.
      </p>
      <SanfonaDeRevisoes :cartoes="revisoesDeTodosOsCarros" />
```

E o import, junto dos outros componentes:

```js
import SanfonaDeRevisoes from './sanfona-de-revisoes.vue'
```

- [ ] **Passo 8: rodar tudo e ver na tela**

```bash
npm test && npm run build
```
`npm test` inclui `todo-vue-compila.test.mjs`, que é a guarda que pegaria texto
de andaime vazado depois do `</style>` — o defeito que deixou 1.895 testes
verdes com a branch sem compilar.

Na tela, a 375px: **os 10 carros aparecem**. Os 8 sem quilometragem dizem "Sem
quilometragem ainda", não "em dia". Abrir e fechar um carro não mexe nos outros.

- [ ] **Passo 9: commitar**

```bash
git add src/ferramentas/frota/revisoes.js src/ferramentas/frota/revisoes.test.mjs src/ferramentas/frota/sanfona-de-revisoes.vue src/ferramentas/frota/tela-de-frota.vue
git commit -m "Revisões mostra todos os carros, item por item, em sanfona (D30)"
```

---

### Tarefa 8: Conferir a fase inteira antes de dizer que acabou

- [ ] **Passo 1: a suíte e o build**

```bash
npm test
npm run build
```
Os dois verdes. **Nenhum dos dois sozinho basta**: `node --test` não compila
`.vue`, e o build não roda teste.

- [ ] **Passo 2: a medição a 375px, num navegador de verdade**

Percorrer, com a largura em 375px:

| Onde | O que tem de ser verdade |
|---|---|
| Gestão · lista | XC60, Fiesta Sedan, Punto e Bravo Essence mostram local |
| Gestão · lista | XC90, Porsche, Punto, Fiesta e XC60 dizem com quem estão |
| Gestão · lista | Bravo Blackmotion continua dizendo "Gabriel Alves" |
| Ficha do veículo | não arrasta pros lados, e nada foi cortado na direita |
| Ficha do veículo | nenhum campo tem exemplo dentro da caixa |
| Ficha do veículo | "Quem cuida deste carro" com os 5 campos, valores preenchidos |
| Ficha do veículo | o passeio guiado ("?") vai até o fim |
| Revisões | os 10 carros aparecem; os sem KM não dizem "em dia" |
| Todas as fichas | ✕ e "?" continuam com 40px de alvo |

- [ ] **Passo 3: conferir que nada de gravação mudou**

Esta fase é de leitura. Abrir a ficha de um carro, **gravar sem mudar nada**, e
conferir que a lista continua igual — nenhum campo esvaziou.

- [ ] **Passo 4: registrar o que a medição achou**

Se algum item da tabela do Passo 2 falhar, **não fechar a fase**. Anotar no fim
deste arquivo, numa seção "O QUE ESTE PLANO ERROU", o que não bateu e por quê —
é o que o plano do checklist fez e é o que impede o erro de ser repetido.

---

## Fora do escopo desta fase

- **D24, D25, D26** (aprovar a própria, nome de fora, encerrar posse) → Fase B
- **D27, D28, D29** (lançamento de manutenção, item novo, KM como fonte) → Fase C
- **D33, D34** (botões rápidos, card que resolve a falta) → Fase D
- **Consertar dado no banco.** As 5 posses sem nome e os `local_texto` antigos
  ficam como estão: o conserto é de leitura, e dado real de produção não se
  reescreve por script.
