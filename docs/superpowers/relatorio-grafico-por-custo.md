# Um gráfico diário para cada cartão de custo — relatório

Branch: `grafico-por-custo`
Tela: `/redes-sociais`, seção **02 · Meta Ads**

**O que foi feito:** todo cartão de CUSTO da seção 02 passou a ter o gráfico
diário dele — mas só quando existe alguma coisa de verdade para mostrar. O
mínimo é **2 dias com número**: um ponto sozinho não é uma linha, não mostra
tendência nenhuma e ainda ocupa a altura inteira de um gráfico fingindo que
mostra. Abaixo disso entra uma frase dizendo o porquê, com o nome do indicador.

---

## 1. O que mudou, arquivo por arquivo

### `src/ferramentas/redes-sociais/series-diarias-de-meta-ads.js`

Três exportações novas. Nada do que já existia foi alterado.

- **`somarResultadoPorDia(linhasDeResultado)`** — soma a contagem do dia de todas
  as campanhas, a partir de `{ captured_at, quantidade }`. **Nulo não entra na
  soma.** As colunas `conversas/cadastros/compras/visitas` nasceram sem default
  no banco: linha antiga chega com `null`, que quer dizer "ainda não foi
  coletado", não "não aconteceu". Dia em que NENHUMA linha tem número fica fora
  do mapa — a mesma distinção que `somarGastoPorDia` já fazia entre dia sem
  coleta e dia coletado com zero.

- **`montarSerieDeCustoPorResultado({ inicio, fim, linhasDeGasto,
  linhasDeResultado, meta, divisorDoResultado })`** — **uma função para os sete
  indicadores** (conversa, cadastro, visita, venda, interação, curtida, mil
  impressões). Todos são a mesma conta com denominador diferente; sete cópias
  quase iguais viram sete verdades que divergem no primeiro conserto.
  `divisorDoResultado` existe por um indicador só, o custo por mil impressões
  (denominador = impressões ÷ 1000). Essa divisão ficou DENTRO do módulo de
  propósito: do lado de fora, quem chama teria de dividir um número que pode ser
  nulo — e é exatamente aí que "não sei" costuma virar zero.
  Por dia: sem linha de gasto → `sem-coleta`; resultado nulo ou ≤ 0 →
  `sem-resultado`; gasto 0 com resultado > 0 → custo 0 (é medida, não buraco).
  A meta **não** é dividida pelos dias: é taxa, vale igual em 1 ou 30 dias.

- **`diasComCusto(serie)` e `valeDesenharOGrafico(serie, minimoDeDias = 2)`** — o
  predicado puro do "tem o que mostrar". A tela não tem regra própria sobre isso.

`montarSerieDeCustoPorSeguidor` **não foi tocada** (o denominador dela vem de
outra fonte, e reescrever estava fora do escopo).

### `src/ferramentas/redes-sociais/graficos-de-custo-diario.js` *(novo, puro)*

O catálogo: qual coluna diária alimenta cada cartão de custo e como o indicador
se chama em português.

| cartão | coluna de `campaign_insights` (period_days = 0) | divisor |
|---|---|---|
| `cpi` | `post_engagement` | 1 |
| `cpl` | `likes` | 1 |
| `custo_conversa` | `conversas` | 1 |
| `custo_cadastro` | `cadastros` | 1 |
| `custo_visita` | `visitas` | 1 |
| `custo_venda` | `compras` | 1 |
| `cpm` | `impressions` | **1000** |

`opcoesDoGrafico(cartaoId, { temMeta, diasComCusto })` monta título, rótulos,
legenda e as frases de quando NÃO há gráfico. Duas coisas mandam nas frases:

- **`temMeta`** — sem meta não há linha desenhada, e a legenda não pode prometer
  o que não está lá (mesma regra que o gráfico de investimento já seguia).
- **`diasComCusto`** — **zero dia e um dia recebem frases diferentes.** Dizer
  "nenhum dia" quando houve um dia medido seria a tela mentindo sobre o próprio
  dado:
  - 0 → *"Nenhum dia deste período teve investimento e conversa ao mesmo tempo —
    sem custo por conversa pra mostrar."*
  - 1 → *"Só um dia deste período teve investimento e cadastro ao mesmo tempo —
    um dia sozinho não mostra tendência nenhuma, então não há gráfico."*

O gênero acompanha o indicador ("nenhuma conversa", "nenhum cadastro"), e a
legenda concorda em número ("1 dia sem conversa" / "4 dias sem conversas").

`investimento` e `cps` **não estão** no catálogo: o primeiro não é custo por
resultado, e o denominador do segundo não sai de `campaign_insights`.

### `src/ferramentas/redes-sociais/graficos-de-custo-diario.test.mjs` *(novo)*

14 testes. O que mais importa: **dois testes cruzam o catálogo com
`cartoes-do-balde.js`** — nenhum cartão de custo de nenhum balde pode ficar sem
gráfico, e nenhum gráfico do catálogo pode sobrar sem cartão que o use. É essa
guarda que impede um balde novo de nascer com um cartão mudo.

### `src/ferramentas/redes-sociais/tela-de-redes-sociais.vue`

**Template.** Os dois lugares que ainda não tinham bloco de gráfico ganharam o
deles: `<div class="gmad-bloco" id="gmad-cpi">` e `id="gmad-cpl"`. Os quatro ids
são os de **SLOTS_DOS_CARTOES** (`spend`, `cps`, `cpi`, `cpl`) — os mesmos nomes
que `pct-`, `cmp-`, `prog-` e `diff-` já usavam. **Nenhuma linha de CSS foi
escrita nesta tarefa.**

**`desenharGraficosDosCartoes(cartoes, balde, diario)` (novo).** O bloco é do
**LUGAR**, não do indicador. Amarrá-lo ao indicador repetiria o defeito da
tarefa 6 (o gráfico ficava com o título do cartão anterior depois da troca de
balde): em Contatos, o segundo lugar é o custo por conversa, e um gráfico
"quanto custou cada seguidor novo" embaixo dele falaria de um número que não
está na tela. A função percorre os quatro lugares e, para cada um:

- lugar sem cartão (Vendas esconde o quarto) ou cartão sem gráfico (alcance,
  frequência, contagens) → **o bloco é esvaziado e sai da tela**;
- `investimento` e `cps` → o caminho de sempre, verbatim, com `minimoDeDias`
  no padrão 1;
- os sete custos por resultado → a série única, com `minimoDeDias: 2`.

A meta de cada gráfico é lida pela mesma porta e com a mesma chave do cartão
logo acima (`metaDefinida(chaveDeMeta(cartao.metaKey, balde), …)`), na hora de
desenhar — porque o dono edita o campo direto na tela.

**`desenharGraficoDiario`.** Uma linha trocada: `if (!serie || !serie.temDado)`
virou `if (!valeDesenharOGrafico(serie, opcoes.minimoDeDias || 1))`. Com o padrão
1, os dois gráficos que já existiam ficam **pixel a pixel como estavam**
(`temDado` é exatamente "≥ 1 dia com número"). Mais o trecho de legenda que conta
os dias `sem-resultado`, com a frase que vem pronta do catálogo.

**A consulta diária.** `gastoDiarioRows` selecionava `captured_at,spend`; agora
selecciona também `post_engagement, likes, conversas, cadastros, visitas,
compras, impressions`. **Mesma consulta, mais colunas — nenhuma viagem a mais.**
O `.erro` continua lido na linha logo depois do `await`, antes de qualquer
`.map()`/`.filter()`. As contagens atravessam cruas (nulo continua nulo) até a
série pura, que é quem separa "não coletado" de "aconteceu zero".

> **Desvio do desenho, registrado:** o desenho dizia "adicione as quatro
> contagens e `impressions`" (5 colunas), mas a tabela de mapeamento do próprio
> desenho inclui `cpi → post_engagement` e `cpl → likes`. São **7** colunas, não
> 5. Segui a tabela. As sete já eram lidas pela consulta agregada da mesma
> tabela, então não há coluna nova nem risco de permissão.

---

## 2. Provas do TDD

### VERMELHO — a série nova, teste antes do código

```
$ node --test 'src/ferramentas/redes-sociais/series-diarias-de-meta-ads.test.mjs'
SyntaxError: The requested module './series-diarias-de-meta-ads.js' does not
provide an export named 'diasComCusto'
ℹ tests 1 · pass 0 · fail 1
```

### VERDE

```
$ node --test 'src/ferramentas/redes-sociais/series-diarias-de-meta-ads.test.mjs'
ℹ tests 40 · pass 40 · fail 0
```

(22 que já existiam + 18 novos: 12 do custo por resultado e 6 do predicado.)

### VERMELHO — o catálogo, teste antes do módulo

```
$ node --test 'src/ferramentas/redes-sociais/graficos-de-custo-diario.test.mjs'
Error [ERR_MODULE_NOT_FOUND]: Cannot find module
'.../src/ferramentas/redes-sociais/graficos-de-custo-diario.js'
ℹ tests 1 · pass 0 · fail 1
```

### VERDE

```
$ node --test 'src/ferramentas/redes-sociais/graficos-de-custo-diario.test.mjs'
ℹ tests 14 · pass 14 · fail 0
```

### Suíte inteira e build

```
$ npm test        (base, antes de tudo)   ℹ tests 3287 · pass 3287 · fail 0
$ npm test        (1ª entrega)            ℹ tests 3319 · pass 3319 · fail 0
$ npm test        (com os 4 ajustes)      ℹ tests 3327 · pass 3327 · fail 0
$ npm run build                           ✓ built (sem erro nem aviso)
```

A conta: 3287 + 18 + 14 = 3319, mais 8 dos ajustes da revisão (6 da regra do dia
pago, 1 da frase de "poucos dias", 1 da guarda dos baldes) = **3327**. A suíte
não encolheu em nenhum passo.

---

## 3. Quais indicadores desenhariam gráfico HOJE, por perfil

A regra: o gráfico só é desenhado quando **≥ 2 dias** da janela têm gasto
coletado **e** resultado > 0 no mesmo dia.

Partindo dos totais de 30 dias fornecidos (não remedidos por mim):

| | Vessel | Motoeasy | Dom Pedro | Breno Vale | Raíssa | Mantova |
|---|---|---|---|---|---|---|
| conversas | 658 | 629 | 37 | 16 | 9 | 0 |
| cadastros | 20 | 0 | 7 | 1 | 0 | 0 |
| visitas | 39 | 3 | 0 | 0 | 0 | 0 |
| compras | **2** | 0 | 0 | 0 | 0 | 0 |

O que o total permite **afirmar com certeza**:

| indicador (balde) | Vessel | Motoeasy | Dom Pedro | Breno Vale | Raíssa | Mantova |
|---|---|---|---|---|---|---|
| custo por conversa (Contatos) | desenha | desenha | provável | provável | possível | **não** |
| custo por cadastro (Contatos) | provável | **não** | possível | **não** (1) | **não** | **não** |
| custo por visita (Site) | provável | possível (≤3) | **não** | **não** | **não** | **não** |
| custo por venda (Vendas) | **quase certo que não** (2 compras) | **não** | **não** | **não** | **não** | **não** |

- **Total 0 → nunca desenha.** É aritmética, não estimativa: sem resultado
  nenhum não há dia com resultado. Vale para Mantova em tudo, Motoeasy em
  cadastro e venda, Dom Pedro em visita e venda, Breno Vale e Raíssa em visita e
  venda, Raíssa em cadastro.
- **Total 1 → nunca desenha** (no máximo um dia). É o cadastro do Breno Vale.
- **Total 2 → o custo por venda não desenha hoje em perfil nenhum** — mas o
  motivo que eu tinha escrito estava errado, e a revisão foi ao banco conferir.
  As 2 compras da Vessel **estão em dias diferentes** (31/07 e 01/08), então a
  regra dos 2 dias sozinha não as barraria. O que barra é o **recorte por
  balde**: as duas estão na campanha `TESTE CHAT - LIMEIRA`, objetivo
  `OUTCOME_ENGAGEMENT`, que não cai em Vendas. Conclusão certa, razão errada —
  corrigida aqui.
- **Totais altos (658, 629) → praticamente certo que passam**: ~22 conversas por
  dia em 30 dias.
- **Totais no meio (37, 20, 16, 9, 7, 3)** dependem de como se espalharam pelos
  dias — o total sozinho não decide, e eu não fui ao banco contar dia a dia.
  Marquei "provável"/"possível" e **não afirmo mais do que isso.**

**`cpm` (Todos e Site), `cpi` e `cpl` (Seguidores) não estavam na tabela, mas
foram medidos na revisão:** de **3 a 30 dias com número** nos seis perfis. **Os
três desenham para TODOS os perfis, sempre.** Eu tinha escrito que não havia
medição atrás disso — havia, e a linha foi corrigida.

Ou seja: a seção 02 ganha gráfico novo em todo perfil pelos baldes Todos, Site e
Seguidores; os que dependem de conversão (cadastro, visita, venda) é que ficam
calados na maioria.

**Isso é a regra funcionando.** Na maioria dos perfis a seção 02 ganha poucos
gráficos hoje, e o custo por venda não ganha nenhum. Baixar o mínimo para
preencher o vão seria trocar informação por enchimento.

---

## 4. A altura da seção a 375px — antes e depois

**Como foi medido.** Não consigo entrar na tela (ela manda para `/login` e não
tenho conta). **Não abri o painel logado e não afirmo nada sobre ele.**

Repeti o método da obra anterior de gráficos: uma página estática servida em
`127.0.0.1:8793`, com **o CSS do build**
(`dist/assets/tela-de-redes-sociais-N6zDqq8j.css` + `index-*.css`, com o
`data-v-014b12a4` correspondente — sem ele nenhuma regra pega) e com o HTML da
`.sec2-grid` e as funções de desenho **extraídas verbatim do `.vue`** (as duas
versões: `main` para o ANTES, esta branch para o DEPOIS). Medido com Playwright.

**Isto mede o CSS de verdade e a geometria de verdade; não mede a tela de
verdade.** Os dados diários são sintéticos, em 30 dias, na faixa dos valores do
painel — o que se está medindo é altura e sobreposição, não número.

**Altura da `.sec2-grid`, viewport 375 × 812:**

| Cenário | ANTES | DEPOIS | Δ |
|---|---|---|---|
| **Seguidores**, todo dia com número (pior caso) | 1259px | **1688px** | +429px (+34%) |
| **Contatos**, todo dia com número | 1072px | **1488px** | +416px (+39%) |
| **Contatos**, cenário escasso (cadastro em 1 dia só) | 1072px | **1370px** | +298px (+28%) |
| **Vendas**, cenário escasso (nenhuma venda) | 1072px | **1140px** | +68px (+6%) |

Altura de cada cartão, em Seguidores: `[416, 416, 202, 202]` → `[416, 416, 416,
416]`. Um gráfico completo custa **214px** por cartão; a frase que entra no lugar
dele custa **95px** (Contatos escasso, cartão 4: 312px) ou **27px** quando é a
frase curta de "nenhum dia" (Vendas, cartão 2: 297px vs 229px sem bloco nenhum).

**A seção cresce mesmo — até um terço no pior caso.** É o custo do que foi
pedido, e a regra dos 2 dias é justamente o que impede que ele seja pago sem
contrapartida: em Vendas, hoje, ela cobra 68px em vez de 428px.

**Os outros critérios, medidos nos cinco cenários (dois baldes × dois cenários +
Vendas):**

| | Resultado |
|---|---|
| Rolagem horizontal da página | **0** em todos |
| Pares de rótulo sobrepostos (valores, meta, datas) | **0** em todos |
| Texto cortado dentro dos blocos de gráfico | **0** em todos |
| Título do gráfico ≠ cartão do lugar | **nenhum** (conferidos os quatro títulos por balde) |
| Bloco de lugar sem gráfico | **fora da tela**, não vazio |

### Um defeito encontrado NA MEDIÇÃO e corrigido aqui

`.gmad-bloco` tem borda em cima e respiro próprio. Esvaziado com
`textContent = ''` e ainda exibido, ele vira **um risco solto de 13px no pé do
cartão** — embaixo do cartão de contagem em Contatos e dos dois lugares vazios em
Vendas. Passou a sair da tela (`display:none`), e não só a ficar sem conteúdo.
Isso também consertou o caso que **já existia no `main`**: em Contatos, o
`gmad-cps` esvaziado deixava esse mesmo risco embaixo do segundo cartão.

---

## 5. O que eu verifiquei e o que eu NÃO verifiquei

**Verificado:**
- `npm test` inteiro: 3319 passando, 0 falhando (base 3287, não encolheu).
- `npm run build` limpo.
- Altura, sobreposição de rótulos, texto cortado e rolagem horizontal a 375px,
  com o CSS do build e a geometria verbatim, em 5 cenários.
- Os títulos dos gráficos acompanham o LUGAR, não o indicador (lidos do DOM).
- As frases de "não há gráfico" saem certas para 0 dia e para 1 dia.
- Nenhuma cor nova, nenhum hex: **não escrevi uma linha de CSS.**

**NÃO verificado — e não afirmo:**
- **A tela logada.** Não tenho conta; não abri o painel de verdade em nenhum
  momento.
- **O comportamento com dado real do banco.** Não consultei `campaign_insights`:
  os números do item 3 saem da tabela fornecida e da leitura do código, com os
  limites marcados ("provável", "possível"). `cpm`, `cpi` e `cpl` não têm medição
  nenhuma atrás.
- **O tema escuro e a largura de 1440px** para os gráficos novos. O desenho, o
  CSS e a régua de largura são exatamente os dos gráficos que já estavam no ar —
  mas não medi os novos nessas duas condições.
- **A rolagem horizontal dentro dos gráficos novos** (os 30px por dia): ela é
  herdada de `larguraDoGrafico`, sem nada específico, e apareceu no desenho
  medido, mas não repeti a bateria de rolagem da obra anterior.
- **Qual balde e período o dono realmente usa mais.** Escolhi Seguidores como
  pior caso por ser o balde de quatro cartões com gráfico em todos.

---

## 6. Os quatro ajustes da revisão (17/08/2026)

Revisão sem nenhum Critical. Quatro ajustes pedidos, os quatro feitos, todos com
teste antes do código.

### 1 · A guarda dos baldes copiava a lista, então não guardava nada

`graficos-de-custo-diario.test.mjs` tinha
`const BALDES = ['todos','seguidores','contatos','site','vendas']` **cravado à
mão**, enquanto a lista de verdade é exportada por `baldes-do-painel.js`. Balde
novo entraria lá e o teste continuaria rodando os cinco antigos — verde, sem ter
olhado para o cartão novo. Era exatamente o caso que o comentário da guarda
prometia pegar.

Agora o teste **importa `BALDES`** e itera `BALDES.map(b => b.id)` nos dois
cruzamentos.

**E um teste a mais, pelo buraco que a revisão apontou junto:** `cartoesDoBalde`
cai **calada** na receita de Todos para balde que ela não conhece. Balde novo sem
receita própria mostraria os cartões de Todos com o rótulo dele, e o cruzamento
passaria verde sem ter examinado cartão nenhum do balde novo. O teste novo
reprova qualquer balde cuja lista de cartões seja idêntica à de Todos.

### 2 · O risco de 13px ainda saía no HTML

Eu tinha consertado **na hora de desenhar**, mas os quatro blocos nasciam
**visíveis no template**. Como `.gmad-bloco` tem `border-top`, `margin-top:14px` e
`padding-top:12px`, entre o primeiro pintar e a primeira leitura cada cartão
mostrava o risco solto — agora em **quatro** cartões, não dois. E `refresh()` não
tem `try/catch`: se `fetchData` rejeitasse, ficaria lá para sempre, embaixo de uma
seção já mostrando R$ 0.

Os quatro blocos passaram a nascer com `style="display:none"`. Quem os traz de
volta é `desenharGraficosDosCartoes`, que já punha `display=''` antes de desenhar.

**Medido a 375px, primeiro pintar, sem nenhum desenho:**

| | ANTES (`main`) | DEPOIS |
|---|---|---|
| Blocos na tela | **2** (`gmad-spend`, `gmad-cps`) | **0** |
| Altura de cada bloco vazio | 13px, com `border-top: 1px` | — |
| Cartões | `[229, 229, 202, 202]` | `[202, 202, 202, 202]` |
| Seção | 884px | **830px** |

### 3 · A frase do vazio só estava certa porque o mínimo era 2

`opcoesDoGrafico` decidia com `diasComCusto >= 1`. Subindo o mínimo para 3, dois
dias medidos sairiam como *"Só um dia deste período…"* — a tela mentindo baixinho,
que é o defeito que esta obra inteira existe para evitar. Agora são **três casos
escritos**, e o número sai impresso em vez de deduzido do mínimo:

- 0 → *"Nenhum dia deste período teve investimento e conversa ao mesmo tempo — sem
  custo por conversa pra mostrar."*
- 1 → *"Só um dia deste período teve investimento e cadastro ao mesmo tempo — um
  dia sozinho não mostra tendência nenhuma, então não há gráfico."*
- ≥ 2 (abaixo do mínimo) → *"Só 2 dias deste período tiveram investimento e
  conversas ao mesmo tempo — poucos dias pra mostrar tendência, então não há
  gráfico."*

### 4 · Dia de graça desenha, mas não AUTORIZA

Dia com resultado e **zero investimento** continua virando ponto (`custo 0`) —
é medida, não buraco. O que ele não pode é ser um dos dois dias que **liberam** o
gráfico: senão o gráfico inteiro poderia ser de barras de R$ 0,00, que não dizem
nada sobre custo nenhum. Acontece pouco e acontece: **2 dias assim na Vessel e 1
na Motoeasy** nos últimos 30 dias.

`diasComInvestimentoEResultado(serie)` conta só os dias com `gasto > 0`, e
`valeDesenharOGrafico(serie, minimo, { exigirInvestimento })` liga a regra. Ela
**nasce desligada**: o gráfico de investimento e o de custo por seguidor entram
pela mesma porta com mínimo 1, e mexer no que eles desenham não estava em jogo —
os pontos do investimento nem carregam `gasto` separado, porque o gasto **é** o
valor deles.

De brinde, a frase ficou literalmente verdadeira: o número que ela imprime agora é
o de dias com **investimento E resultado no mesmo dia**, que é o que ela diz.

**Conferido no navegador**, cenário "de graça" (os dois únicos dias com conversa
gastaram R$ 0): o custo por conversa **não desenha** e sai a frase de "nenhum dia".

### Remedição a 375px, com os quatro ajustes

| Cenário | ANTES | DEPOIS | Δ |
|---|---|---|---|
| Primeiro pintar (nada desenhado) | 884px | **830px** | **−54px** |
| Seguidores, todo dia com número | 1259px | **1688px** | +429px |
| Contatos, todo dia com número | 1072px | **1488px** | +416px |
| Contatos, escasso (cadastro em 1 dia) | 1072px | **1370px** | +298px |
| Vendas, escasso (nenhuma venda) | 1072px | **1140px** | +68px |
| Contatos, "de graça" (2 dias sem gastar) | 1072px | **1235px** | +163px |

Nos seis cenários: **0** rolagem horizontal, **0** par de rótulo sobreposto,
**0** texto cortado, SVG com os 136px de altura de projeto.

### Um defeito DA MEDIÇÃO, achado no caminho

A primeira remedição acusou os gráficos **encolhendo** (SVG de 247×37 em vez de
900×136) e a seção caindo para 1343px. Não era o código: o gerador da página de
medida tinha o `data-v-014b12a4` **cravado à mão**, e o hash do escopo do Vue
**muda toda vez que o `.vue` muda**. Com o hash velho, nenhuma regra `:deep()`
pegava e eu estava medindo uma página **sem estilo nenhum**.

O gerador passou a **ler o hash do próprio CSS do build**, e a recusar rodar se
houver mais de um CSS da tela em `dist/` (build antigo sobrando é a mesma
armadilha). Com isso o ANTES voltou a reproduzir os números originais
(1259 / 1072, SVG de 136px), o que é a prova de que a medida é a mesma.

**Fica o registro porque quase virou conclusão:** medida com CSS que não pega
parece defeito no código, e eu ia reportar uma regressão que não existia.
