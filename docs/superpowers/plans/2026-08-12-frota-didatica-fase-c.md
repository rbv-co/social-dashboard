# Frota didática — Fase C: registrar manutenção deixa de ser um a um

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA: use `superpowers:subagent-driven-development`
> (recomendado) ou `superpowers:executing-plans` pra executar tarefa a tarefa.

**Objetivo:** um lançamento só — o KM, a oficina, o valor da nota, e as caixas do
que foi trocado. Mais criar item de mecânica novo na hora, e o KM do lançamento
passando a contar como quilometragem do carro.

**Desenho:** `docs/superpowers/specs/2026-08-12-frota-didatica-design.md` — D27,
D28, D29.

## A dor, medida

**Hoje, pra registrar 3 trocas num carro** (o formulário mora na seção Oficina da
ficha do veículo): escolher o item, digitar o KM, a data, a oficina e o custo →
gravar → **repetir tudo outra vez** → e outra. São **15 campos pra 3 trocas**, e
o KM, a data e a oficina são os mesmos nas três — redigitados a cada volta.

O dono disse: *"o registrar histórico de manutenção é difícil por ter que fazer
um a um"*. E o número que confirma: **a frota inteira tem 2 trocas registradas**,
em 10 carros, desde 04/08. Ninguém usa porque dói usar.

**Depois:** 4 campos compartilhados + uma caixa por item = **7 toques pras
mesmas 3 trocas**, com o valor de cada peça opcional.

**E o efeito colateral que importa mais que o conforto:** 8 dos 10 carros não
têm quilometragem conhecida nenhuma, então a aba Revisões não tem o que calcular
e responde "ainda não sei a quilometragem deste carro" em 8 carros × 8 itens.
Registrar a troca de óleo com 92.000 km é o que acorda a aba — por isso D29 está
nesta fase e não numa próxima.

**Arquitetura:** peças novas em arquivo próprio (D35). A lição da Fase A e da D
vale: **componente com `<style scoped>` NÃO herda as classes `fr-` da tela
grande** — o componente novo traz o próprio bloco, prefixado, só com tokens.

## Restrições que valem para TODAS as tarefas

- **`PADRAO-DA-CENTRAL.md` é obrigatório.** Cor só por token `var(--…)`, **nunca
  hex — nem como valor de reserva dentro de `var()`**. Botão tem três tipos e só.
  Texto nunca corta. Alvo de toque de 40px.
- **A tela nunca mente.** Nada de "gravado" sem conferir; nada de número
  inventado sobre dado que não carregou. **Duas gravações com só a primeira
  conferida apareceu 4× neste módulo** — e a tela sempre dizia que deu certo.
- **`node --test` NÃO compila `.vue`.** `npm run build` é obrigatório em todo
  commit que mexa em `.vue`. Baseline: **2552 passam, 2 falham** (as duas do
  `coletor/`, credencial ausente em worktree novo — documentadas no `CLAUDE.md`,
  não são suas, não conserte).
- **Nunca escrever em dado real de produção pra testar.** A migration é DDL e é
  autorizada; INSERT de teste em `frota_manutencoes` de produção, não.
- **Commits só nos arquivos da tarefa** — `git add <arquivo>`, nunca `git add <pasta>`.
- **Sem emoji como ícone.** SVG próprio.
- Match o estilo de ponto-e-vírgula do arquivo que você edita: `revisoes.js` usa;
  `botoes-rapidos.js` e `onde-o-carro-fica.js` não. **Leia antes** — suposição
  errada sobre isso já foi achada duas vezes nesta ferramenta.
- Nomes e comentários em português literal; comentário explica **por quê** e
  carrega os números medidos.

---

### Tarefa 1: A migration 041

**Arquivos:**
- Criar: `db/migrations/acessos/041_frota_manutencao.sql`

⚠️ **Conferir o número antes de escrever**: `ls db/migrations/acessos/ | tail -3`.
A 039 foi pra perfis de acesso e a 040 pro gatilho de aprovação — este número já
mudou duas vezes porque há mais de uma frente no repositório.

- [ ] **Passo 1: escrever a migration**

```sql
-- Frota F5/D27: um lançamento de manutenção é UM SERVIÇO com VÁRIAS trocas.
--
-- POR QUE UMA TABELA DE CABEÇALHO, e não só mais colunas em frota_revisoes:
-- hoje só existe "uma troca de um item". O lançamento do dono é a nota da
-- oficina: um KM, uma data, uma oficina, UM VALOR TOTAL e várias peças. Sem
-- cabeçalho, o total de R$ 1.240 teria de ser (a) rateado entre os itens,
-- mentindo sobre o preço de cada peça, ou (b) repetido em cada linha, e aí
-- somar o ano daria o triplo. Com ele, o lançamento também pode ser REABERTO e
-- CORRIGIDO — o que o dono não tem hoje: hoje só dá pra apagar linha por linha.
--
-- A MEDIDA QUE JUSTIFICA: a frota tem 10 carros e 2 trocas registradas em
-- frota_revisoes (medido 12/08/2026). Ninguém usa porque são 15 campos pra 3
-- trocas, com KM/data/oficina redigitados a cada volta.
create table if not exists public.frota_manutencoes(
  id uuid primary key default gen_random_uuid(),
  veiculo_id uuid not null references public.frota_veiculos(id) on delete cascade,
  -- KM é NOT NULL de propósito (D27): revisão gravada sem KM é invisível pro
  -- alerta (ultimaRevisao() só considera km inteiro), então o item continuaria
  -- "vencido" pra sempre depois de trocado. Deixar nulo aqui seria deixar o
  -- dono registrar trabalho que não conserta o alerta que o incomodou.
  km int not null check (km >= 0),
  feita_em date,
  oficina text,
  -- O valor da NOTA, não a soma das peças. Os dois convivem: se os unitários
  -- não somarem o total, a diferença é mão de obra ou desconto — e a tela DIZ
  -- a diferença em vez de escolher um lado calado.
  total_centavos bigint,
  observacao text,
  criada_em timestamptz not null default now(),
  criada_por uuid references auth.users(id) on delete set null
);
create index if not exists idx_frota_manut_veiculo
  on public.frota_manutencoes(veiculo_id, km desc);

-- O elo. `on delete cascade`: apagar o lançamento apaga as trocas dele — é um
-- serviço só, e meia nota no histórico é pior que nota nenhuma.
-- Nulo é permitido e NÃO é sobra: as 2 linhas já gravadas em frota_revisoes
-- vieram do formulário de uma troca por vez e continuam válidas sem cabeçalho.
alter table public.frota_revisoes
  add column if not exists manutencao_id uuid
  references public.frota_manutencoes(id) on delete cascade;
create index if not exists idx_frota_rev_manutencao
  on public.frota_revisoes(manutencao_id);

alter table public.frota_manutencoes enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='frota_manutencoes' and policyname='frota_manut_ler') then
    create policy frota_manut_ler on public.frota_manutencoes for select using (public.is_frota_admin());
  end if;
  -- Mesma regra de frota_revisoes (migration 024): registrar manutenção é
  -- trabalho de quem administra, não de quem dirige.
  if not exists (select 1 from pg_policies where tablename='frota_manutencoes' and policyname='frota_manut_escrever') then
    create policy frota_manut_escrever on public.frota_manutencoes for all
      using (public.is_frota_admin()) with check (public.is_frota_admin());
  end if;
end $$;
```

- [ ] **Passo 2: NÃO aplicar. Parar e reportar.**

A migration é DDL em produção. **Quem aplica é o controlador, com autorização do
dono** — o dono já autorizou uma migration nesta jornada, e cada uma é uma
autorização própria. Reporte que o arquivo está escrito e pare.

- [ ] **Passo 3: commitar só o arquivo**

```bash
git add db/migrations/acessos/041_frota_manutencao.sql
git commit -m "Migration 041: um lançamento de manutenção com várias trocas (D27)"
```

---

### Tarefa 2: A conta do lançamento

**Arquivos:**
- Criar: `src/ferramentas/frota/lancamento-de-manutencao.js`
- Criar: `src/ferramentas/frota/lancamento-de-manutencao.test.mjs`

**Interfaces:**
- Produz:
  - `problemasDoLancamento({ km, itens, kmConhecido }) → [{ bloqueia, texto }]`
  - `diferencaDeValores({ totalCentavos, itens }) → { soma, diferenca, texto } | null`
  - `linhasParaGravar({ manutencaoId, veiculoId, km, feitaEm, oficina, itens }) → [linha de frota_revisoes]`

- [ ] **Passo 1: escrever o teste que falha**

```js
// src/ferramentas/frota/lancamento-de-manutencao.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  problemasDoLancamento, diferencaDeValores, linhasParaGravar,
} from './lancamento-de-manutencao.js'

const bloqueia = (p) => p.filter((x) => x.bloqueia)

/* Os números são reais, medidos em 12/08/2026: a Bravo Blackmotion tem 188.000
 * km conhecidos (do único checklist), e a frota inteira tem 2 trocas
 * registradas em 10 carros. */

// ── O KM ────────────────────────────────────────────────────────────────────

test('sem KM não grava, e a tela DIZ por que', () => {
  // Não é implicância: revisão sem KM é invisível pro alerta, e o item
  // continuaria "vencido" pra sempre depois de trocado.
  const p = problemasDoLancamento({ km: null, itens: [{ item: 'Troca de óleo' }] })
  const b = bloqueia(p)
  assert.equal(b.length, 1)
  assert.match(b[0].texto, /alerta|avisar/i, 'tem de explicar a consequência, não só pedir o campo')
})

test('KM zero é ACEITO — carro zero km existe', () => {
  const p = problemasDoLancamento({ km: 0, itens: [{ item: 'Troca de óleo' }] })
  assert.equal(bloqueia(p).length, 0)
})

test('KM negativo não existe', () => {
  assert.equal(bloqueia(problemasDoLancamento({ km: -5, itens: [{ item: 'X' }] })).length, 1)
})

test('KM menor que o conhecido AVISA e deixa gravar', () => {
  // Painel trocado na oficina zera odômetro de verdade. Mesmo tratamento do
  // hodometro_justificativa do checklist.
  const p = problemasDoLancamento({ km: 150000, itens: [{ item: 'Troca de óleo' }], kmConhecido: 188000 })
  assert.equal(bloqueia(p).length, 0, 'não bloqueia')
  assert.equal(p.length, 1, 'mas avisa')
  assert.match(p[0].texto, /188\.000/, 'diz o número que ele já conhece')
})

test('KM igual ao conhecido não gera aviso nenhum', () => {
  const p = problemasDoLancamento({ km: 188000, itens: [{ item: 'X' }], kmConhecido: 188000 })
  assert.equal(p.length, 0)
})

test('salto absurdo de KM avisa, sem bloquear', () => {
  const p = problemasDoLancamento({ km: 900000, itens: [{ item: 'X' }], kmConhecido: 188000 })
  assert.equal(bloqueia(p).length, 0)
  assert.ok(p.some((x) => /confir/i.test(x.texto)))
})

// ── Os itens ────────────────────────────────────────────────────────────────

test('nenhum item marcado não grava', () => {
  const b = bloqueia(problemasDoLancamento({ km: 100, itens: [] }))
  assert.equal(b.length, 1)
  assert.match(b[0].texto, /marque|o que foi trocado/i)
})

test('item repetido no mesmo lançamento não grava', () => {
  // Duas linhas do mesmo item no mesmo serviço dariam dois alertas pra mesma
  // troca — o mesmo motivo que problemasDoItem() barra nome repetido no plano.
  const b = bloqueia(problemasDoLancamento({
    km: 100, itens: [{ item: 'Troca de óleo' }, { item: 'Troca de óleo' }],
  }))
  assert.equal(b.length, 1)
  assert.match(b[0].texto, /repetid|duas vezes|mesma/i)
})

// ── Total × unitários ───────────────────────────────────────────────────────

test('unitários que não somam o total: DIZ a diferença, não escolhe um lado', () => {
  const d = diferencaDeValores({
    totalCentavos: 124000,
    itens: [{ item: 'Óleo', valorCentavos: 18000 }, { item: 'Pneus', valorCentavos: 89000 }],
  })
  assert.equal(d.soma, 107000)
  assert.equal(d.diferenca, 17000)
  assert.match(d.texto, /170,00/, 'a diferença em reais, escrita')
  assert.match(d.texto, /mão de obra/i, 'e o que ela provavelmente é')
})

test('unitários que passam do total também são ditos', () => {
  const d = diferencaDeValores({
    totalCentavos: 10000, itens: [{ item: 'Óleo', valorCentavos: 18000 }],
  })
  assert.equal(d.diferenca, -8000)
  assert.match(d.texto, /80,00/)
})

test('soma exata não vira aviso', () => {
  const d = diferencaDeValores({
    totalCentavos: 18000, itens: [{ item: 'Óleo', valorCentavos: 18000 }],
  })
  assert.equal(d, null)
})

test('sem total, ou sem unitário nenhum, não há divergência pra dizer', () => {
  assert.equal(diferencaDeValores({ totalCentavos: null, itens: [{ item: 'X', valorCentavos: 1 }] }), null)
  assert.equal(diferencaDeValores({ totalCentavos: 5000, itens: [{ item: 'X' }] }), null)
})

// ── As linhas gravadas ──────────────────────────────────────────────────────

test('cada item marcado vira uma linha de frota_revisoes, com o elo', () => {
  const l = linhasParaGravar({
    manutencaoId: 'm-1', veiculoId: 'v-1', km: 192400, feitaEm: '2026-08-12',
    oficina: 'JHM Auto Center',
    itens: [{ item: 'Troca de óleo', valorCentavos: 18000 }, { item: 'Pneus' }],
  })
  assert.equal(l.length, 2)
  assert.deepEqual(l[0], {
    manutencao_id: 'm-1', veiculo_id: 'v-1', item: 'Troca de óleo',
    km: 192400, feita_em: '2026-08-12', oficina: 'JHM Auto Center',
    custo_centavos: 18000,
  })
  assert.equal(l[1].custo_centavos, null, 'item sem valor grava nulo, não zero')
})

test('o KM e a oficina do cabeçalho vão em TODAS as linhas', () => {
  // frota_revisoes.km é o que ultimaRevisao() lê pra calcular o alerta: linha
  // sem km não alerta nunca. Repetir aqui não é redundância, é o que faz o
  // alerta funcionar por item.
  const l = linhasParaGravar({
    manutencaoId: 'm-1', veiculoId: 'v-1', km: 500, itens: [{ item: 'A' }, { item: 'B' }, { item: 'C' }],
  })
  for (const x of l) { assert.equal(x.km, 500); assert.equal(x.veiculo_id, 'v-1') }
})

test('data em branco grava nulo, não a data de hoje', () => {
  // Inventar a data de hoje seria a tela mentindo sobre quando o serviço foi.
  const l = linhasParaGravar({ manutencaoId: 'm', veiculoId: 'v', km: 1, feitaEm: '', itens: [{ item: 'A' }] })
  assert.equal(l[0].feita_em, null)
})
```

- [ ] **Passo 2: rodar e ver falhar**

`node --test src/ferramentas/frota/lancamento-de-manutencao.test.mjs`
Esperado: FALHA com módulo não encontrado.

- [ ] **Passo 3: implementar**

Escreva `lancamento-de-manutencao.js` para satisfazer os 15 testes. O cabeçalho
do arquivo deve dizer **por que** o módulo existe (a dor medida: 15 campos pra 3
trocas, 2 trocas registradas em 10 carros) e **por que o KM é obrigatório**.

Reaproveite o que existe em vez de reinventar:
- `centavosDe()` já existe em `tela-de-frota.vue` para ler "1.240,00" — se você
  precisar da conversão aqui, procure onde ela mora e **importe**, não copie.
- `Intl`/`toLocaleString('pt-BR')` para escrever reais, no mesmo molde de
  `revisoes.js`.

⚠️ Se um teste discordar da implementação, **a implementação é que muda**. Se
você achar que um TESTE está errado, pare e pergunte.

- [ ] **Passo 4: rodar e commitar**

```bash
node --test src/ferramentas/frota/lancamento-de-manutencao.test.mjs
npm test
git add src/ferramentas/frota/lancamento-de-manutencao.js src/ferramentas/frota/lancamento-de-manutencao.test.mjs
git commit -m "A conta do lançamento de manutenção (D27)"
```

---

### Tarefa 3: O KM da manutenção conta como quilometragem do carro (D29)

Sem isto, a Fase C grava manutenção e a aba Revisões continua dizendo "ainda não
sei a quilometragem" nos mesmos 8 carros: o dono registraria a troca e nada
mudaria na tela.

**Arquivos:**
- Modificar: `src/ferramentas/frota/estado-do-veiculo.js` — a lista de fontes de KM
- Modificar: `src/ferramentas/frota/estado-do-veiculo.test.mjs`
- Modificar: `src/ferramentas/frota/tela-de-frota.vue` — passar as revisões

**Interfaces:**
- `estadoDoVeiculo(veiculo, usos, fichas, revisoes)` — quarto parâmetro
  **opcional**, no mesmo molde do `pessoas` opcional de `quemEstaComOCarro`.
  Sem ele, o comportamento é o de hoje.

- [ ] **Passo 1: escrever o teste que falha**

```js
// acrescentar em src/ferramentas/frota/estado-do-veiculo.test.mjs
test('o KM de uma manutenção conta como quilometragem conhecida do carro', () => {
  // Medido em 12/08: 8 dos 10 carros não tinham KM nenhum, e a aba Revisões
  // não tinha o que calcular. Registrar a troca com 92.000 km é o que a acorda.
  const v = { id: 'v1', situacao: 'ativo' }
  const revisoes = [{ veiculo_id: 'v1', item: 'Troca de óleo', km: 92000 }]
  assert.equal(estadoDoVeiculo(v, [], [], revisoes).km, 92000)
})

test('entre as fontes de KM vence o MAIOR, nunca o mais recente por data', () => {
  // Mesma regra de ultimaRevisao(): data digitada errada acontece o tempo todo,
  // odômetro só anda pra frente.
  const v = { id: 'v1', situacao: 'ativo' }
  const fichas = [{ veiculo_id: 'v1', hodometro: 188000 }]
  const revisoes = [{ veiculo_id: 'v1', item: 'Óleo', km: 92000 }]
  assert.equal(estadoDoVeiculo(v, [], fichas, revisoes).km, 188000)
})

test('revisão de OUTRO carro não vaza pra este', () => {
  const v = { id: 'v1', situacao: 'ativo' }
  const revisoes = [{ veiculo_id: 'v2', item: 'Óleo', km: 500000 }]
  assert.equal(estadoDoVeiculo(v, [], [], revisoes).km, null)
})

test('revisão com km nulo não zera nem quebra', () => {
  const v = { id: 'v1', situacao: 'ativo' }
  const revisoes = [{ veiculo_id: 'v1', item: 'Óleo', km: null }]
  assert.equal(estadoDoVeiculo(v, [], [], revisoes).km, null)
})

test('sem o quarto parâmetro nada muda — quem chama com três continua igual', () => {
  const v = { id: 'v1', situacao: 'ativo' }
  const fichas = [{ veiculo_id: 'v1', hodometro: 54000 }]
  assert.equal(estadoDoVeiculo(v, [], fichas).km, 54000)
})
```

- [ ] **Passo 2: rodar, ver falhar, implementar**

Em `estado-do-veiculo.js`, a lista `kms` ganha a quarta fonte. O comentário que
já está lá enumera as três — **atualize-o para quatro**, dizendo por que a nova
entrou (senão a aba Revisões não acorda). Escreva uma função irmã de
`ultimoHodometro`, no mesmo molde, para o maior KM de revisão do carro.

Em `tela-de-frota.vue`, o computed `linhas` passa `revisoes.value` como quarto
argumento — ele já está carregado.

- [ ] **Passo 3: rodar tudo e commitar**

```bash
npm test && npm run build
git add src/ferramentas/frota/estado-do-veiculo.js src/ferramentas/frota/estado-do-veiculo.test.mjs src/ferramentas/frota/tela-de-frota.vue
git commit -m "O KM da manutenção acorda a aba Revisões (D29)"
```

---

### Tarefa 4: A ficha do lançamento

**Arquivos:**
- Criar: `src/ferramentas/frota/lancamento-de-manutencao.vue`

A ficha, como o dono aprovou:

```
LANÇAR MANUTENÇÃO — FIAT BRAVO BLACKMOTION            [ ? ]  [ ✕ ]

Quando foi        [ 12/08/2026 ]
KM do painel      [ 192.400          ]
                  O último que a ferramenta conhece é 188.000.
Oficina           [ JHM Auto Center  ]
Valor total (R$)  [ 1.240,00         ]  o que veio na nota

O QUE FOI TROCADO                          valor da peça (se souber)
 [x] Troca de óleo ..........................  [ 180,00 ]
 [x] Limpeza de bico ........................  [        ]
 [x] Pneus ..................................  [ 890,00 ]
 [ ] Velas
 ...
 [ + Acrescentar item de mecânica ]

 Os itens somam R$ 1.070,00 e o total é R$ 1.240,00 —
 sobram R$ 170,00, que devem ser mão de obra. Pode gravar assim.

Observação        [                                        ]

                              [ Cancelar ]  [ Gravar 3 trocas ]
```

**O que o componente faz e o que NÃO faz:** ele monta a ficha, chama
`problemasDoLancamento` e `diferencaDeValores` a cada mudança, e **emite** o que
gravar. **Ele não fala com o banco** — quem grava é a tela, na Tarefa 5, porque
a ordem de gravação tem uma armadilha que precisa de teste (ver lá).

**Propriedades:** `veiculo`, `plano` (os itens ativos), `kmConhecido`.
**Emite:** `gravar` com `{ km, feitaEm, oficina, totalCentavos, observacao, itens }`,
e `fechar`.

Detalhes que não são enfeite:
- **O botão diz quantas trocas vai gravar** ("Gravar 3 trocas") — é a confirmação
  de que as caixas marcadas são as que a pessoa quer.
- **O valor da peça só aparece quando o item está marcado.** Campo de valor de
  item desmarcado é campo que não faz nada.
- **A frase da divergência aparece sozinha**, sem cor de erro: ela não é um erro.
- **Estilo próprio, prefixado, só tokens.** Não alcança as classes `fr-`.
- Campos de número com `inputmode` certo (`numeric` pro KM, `decimal` pro valor);
  fonte de 16px, senão o iPhone dá zoom ao tocar.

- [ ] **Passo 1: escrever o componente**
- [ ] **Passo 2: `npm test && npm run build`** — `todo-vue-compila.test.mjs` e
      `estilo-alcanca-o-runtime.test.mjs` pegam arquivo novo sozinhos, sem registro.
- [ ] **Passo 3: commitar**

---

### Tarefa 5: Gravar, e o item novo (D28)

**Arquivos:**
- Modificar: `src/ferramentas/frota/tela-de-frota.vue`

⚠️ **A ARMADILHA, e ela já custou caro nesta ferramenta.** Gravar o cabeçalho e
depois as trocas são **duas gravações**, e "duas gravações com só a primeira
conferida" apareceu **4 vezes** nesta fase do checklist — a tela sempre dizia que
tinha dado certo. Aqui:

1. Grava `frota_manutencoes` e **confere que voltou linha com id**. Se falhar:
   não grava troca nenhuma, a ficha **não fecha**, e a mensagem diz que nada foi
   gravado.
2. Grava as linhas de `frota_revisoes` com o `manutencao_id`. Se falhar: **apaga
   o cabeçalho** (senão sobra um lançamento sem troca nenhuma, que aparece no
   histórico dizendo que algo foi feito e não diz o quê), a ficha não fecha, e a
   mensagem diz exatamente isso.
3. Só então fecha e recarrega.

- [ ] **Passo 1: o gravar, com os dois passos conferidos um a um**
- [ ] **Passo 2: o "+ Acrescentar item de mecânica" (D28)**

Pergunta o nome e **de quantos em quantos quilômetros se troca**, e grava em
`frota_plano_revisao` — a partir daí o item avisa sozinho em toda a frota, que é
o que o dono quis dizer com "vira parâmetro no banco". Validação por
`problemasDoItem()` de `revisoes.js`, **que já existe** e já barra nome curto,
nome repetido e intervalo fora de 500–500.000.

- [ ] **Passo 3: os dois caminhos de abrir a ficha**
  - o botão **"Lançar manutenção"** dentro da sanfona de Revisões (D30 previu e
    a Fase A deixou pra cá — a sanfona hoje só mostra);
  - na ficha do veículo, **substituindo** o formulário de uma troca por vez que
    mora na seção Oficina. O **histórico continua lá**, e cada linha dele passa a
    poder ser aberta pra correção.

⚠️ **O que NÃO apagar:** `apagarRevisao` e o histórico existente. As 2 trocas já
gravadas não têm `manutencao_id` e têm de continuar aparecendo e sendo
apagáveis.

- [ ] **Passo 4: `npm test && npm run build`, e commitar**

---

### Tarefa 6: Conferir antes de dizer que acabou

- [ ] **Passo 1: suíte e build**
- [ ] **Passo 2: a 375px, num navegador de verdade**

| Onde | O que tem de ser verdade |
|---|---|
| Revisões | cada carro aberto tem "Lançar manutenção" |
| A ficha | marcar 3 itens e gravar registra as 3, numa passada |
| A ficha | KM em branco não grava, e explica por quê |
| A ficha | KM menor que o conhecido avisa e deixa gravar |
| A ficha | total ≠ soma dos unitários mostra a diferença em reais |
| A ficha | item novo pergunta o intervalo, e passa a avisar |
| Revisões | depois de gravar, o carro **sai** de "sem quilometragem" |
| Ficha do veículo | o histórico antigo continua lá, e apagável |

- [ ] **Passo 3: o que a medição achar de errado, ANOTAR** numa seção
      "O QUE ESTE PLANO ERROU" no fim deste arquivo. Não fechar a fase sem isso.

## Fora do escopo desta fase

- **D25, D26** (nome esporádico do Felipe, encerrar posse de qualquer um) → Fase B.
- **D34 / D-2** (cadastrar quem falta e convidar login pelo card do checklist).
- **F3 multas e F5 custo por km** continuam travadas pelo mesmo motivo de sempre:
  ninguém registra quem estava com o carro no dia. O que destrava é o checklist
  diário, que depende de o dono ligar o aviso — não de código.
