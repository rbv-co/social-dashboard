# Gráficos que rolam no celular — relatório

Branch: `graficos-que-rolam-no-celular`
Tela: `/redes-sociais` (seção 01 "Novos seguidores / dia" e seção 02 "Meta Ads")

**O que estava errado, medido antes (não remedido por mim):** a 375px, com 30
dias, o gráfico tem 319px de largura — **~10px por dia**. "R$ 17,34" não cabe em
10px em fonte nenhuma. Os números se sobrepunham em **−5px**, com 3 pares no
gráfico de investimento e 8 no de custo por seguidor.

**A régua aplicada:** cada dia recebe no mínimo **30px**. Cabendo, nada muda.
Não cabendo, o gráfico fica mais largo que o cartão e rola **para o lado dentro
dele** — a página nunca ganha rolagem horizontal.

---

## 1. O que mudou, arquivo por arquivo

### `src/ferramentas/redes-sociais/largura-do-grafico.js` (novo)

Módulo puro. `larguraDoGrafico({ pontos, larguraDisponivel, minimoPorPonto = 30 })`
devolve `{ largura, rola, larguraDaTrilha, espacoPorPonto }`. **Uma regra só, sem
exceção por tipo de tela** — quem manda é a largura que o cartão tem, não o
aparelho que é.

- `largura = max(larguraDisponivel, pontos × 30)` — o `max` é o que impede uma
  semana de virar um toco de 210px num cartão de 1200px.
- `rola` só quando o necessário passa do disponível.
- Contêiner ainda não medido (`clientWidth` 0, negativo, `NaN`) cai em 400px, a
  largura de projeto: zero lido como "não tem espaço" mandaria **todo** gráfico
  rolar, inclusive no computador.
- `ESPACO_ANTES_DO_GRAFICO = 24` e `ESPACO_DEPOIS_DO_GRAFICO = 48`: tiras vazias
  nas beiradas. O rótulo é centrado no ponto, e o primeiro e o último ficam na
  borda — metade deles sobra para fora do desenho, e fora do desenho dentro de
  caixa que rola é lugar **recortado**.
- `FAIXA_QUE_AVISA = 28`: a faixa apagada da direita. A tira da saída é maior que
  ela para a faixa nunca apagar o último dia.
- Nenhuma exceção por aparelho: houve uma (`podeRolar`, para televisão) e ela foi
  retirada por decisão do coordenador — ver o item 5.

Mais duas regras puras, das residuais (item 7):

- `ancoraDoRotulo({ centro, largura, quadro })` → onde ancorar um rótulo para ele
  não sair do quadro. Encosta na borda quem não cabe centrado; **quem já cabe não
  se mexe**.
- `rotulosQueCabem(candidatos, folga = 6)` → quais rótulos ficam. Olha a caixa
  inteira, **nos dois eixos**: dois rótulos vizinhos com alturas bem diferentes
  não se tocam, e derrubar um deles seria perder número à toa. Obrigatórios (o
  último dia, o dia mais alto) passam na frente.

### `src/ferramentas/redes-sociais/largura-do-grafico.test.mjs` (novo)

27 testes. Bordas cobertas: cabe exato não rola · um ponto a mais rola · um ponto
só · zero ponto · contêiner maior nunca encolhe · celular 375 em 7/14/30 dias ·
tela larga que cabe · tela larga que não cabe e rola igual · mínimo ajustável ·
contêiner não medido · quantidade estranha de pontos · largura inteira · tiras
vazias · rótulo do meio não se mexe · rótulo que sairia por cada borda · encostou
por um triz · rótulo maior que o quadro · o par medido cai · alturas diferentes
ficam os dois · obrigatório na frente · dois obrigatórios colados · a folga vale ·
lista vazia.

### `src/ferramentas/redes-sociais/tela-de-redes-sociais.vue`

**Template (seção 01).** Três camadas em volta do gráfico de seguidores:
`.grafico-que-rola` (não rola; segura a faixa apagada) → `.rolagem-de-grafico`
(a que rola) → `.trilho-de-grafico` (a que fica larga, e que contém tanto o SVG
com a camada de números quanto a linha de datas, para os dois rolarem juntos e
alinhados).

**`buildChart` (seção 01).** O `viewBox` continua `0 0 400 110`: como o SVG tem
`preserveAspectRatio="none"`, alargar o elemento estica só na horizontal e a
altura fica presa em 150px pelo CSS. Os rótulos, posicionados em porcentagem
sobre o trilho, acompanham sozinhos.

**`desenharGraficoDiario` (seção 02).** Aqui a largura entra no **viewBox**
(`W` computado), porque este SVG escala uniforme — esticá-lo com viewBox 400
esticaria a altura junto e viraria um paredão. Rolando, o desenho fica 1:1 com a
tela (900×136 em 30 dias). Não rolando, `W` volta a 400 e o SVG volta a
`width:100%` — o que está no ar hoje.

**Rótulos medidos, não estimados (das residuais, item 7).** O SVG passou a entrar
na tela ANTES de ser desenhado, de propósito: texto de SVG só pode ser medido
depois de renderizado. Com a largura real de cada rótulo (`getComputedTextLength`)
o desenho encosta na borda quem sairia do quadro; com a caixa real (`getBBox`)
ele tira quem ainda assim se tocaria. Não dando para medir (cartão escondido, SVG
não renderizado), fica tudo como sempre foi — rótulo a mais é melhor que rótulo
que sumiu por engano.

**As três coisas que vieram junto:**
- Fonte dos valores da seção 02: **9px → 11px**, só quando rola (`.gmad-rola`).
  No computador o espaço é o mesmo de sempre; letra maior ali traria a
  sobreposição de volta.
- Faixa apagada de 28px na direita, sobre a tira vazia, para se descobrir que o
  gráfico continua.
- Rótulo de meta ("Meta máxima" / "Meta N/dia") tirado da direita.

**`showInside` reconciliado, não apagado:** era `n <= 14`, virou
`n <= 14 || medida.rola`. A regra sempre foi de espaço escrita em contagem de
dias; rolando, cada dia tem 30px — mais que os ~22px que 14 dias tinham no
celular. Quem não rola (o computador) continua na conta por dias, igual a hoje.
O `cdl-sm` ficou como está: a 30px por dia, um "+123" em Oswald 14px não caberia.

**CSS.** `.grafico-que-rola` / `.rolagem-de-grafico` / `.trilho-de-grafico` /
`.rolando`, mais `min-width:0` nos cartões das grades 1 e 2. Cores só de token
(`--surface` no degradê da faixa; conferido em `estilos-globais.css`, existe no
claro e no escuro). Nenhum hex novo.

---

## 2. Provas do TDD

### VERMELHO — teste antes do módulo

```
$ node --test 'src/ferramentas/redes-sociais/largura-do-grafico.test.mjs'
  code: 'ERR_MODULE_NOT_FOUND',
  url: '.../src/ferramentas/redes-sociais/largura-do-grafico.js'
✖ src/ferramentas/redes-sociais/largura-do-grafico.test.mjs
ℹ tests 1 · pass 0 · fail 1
```

### VERDE — depois do módulo

```
$ node --test 'src/ferramentas/redes-sociais/largura-do-grafico.test.mjs'
ℹ tests 14 · pass 14 · fail 0
```

### VERMELHO de novo — a trava da televisão, teste antes do código

```
$ node --test 'src/ferramentas/redes-sociais/largura-do-grafico.test.mjs'
✖ sem quem role, o gráfico se aperta em vez de esconder dia
ℹ tests 16 · pass 15 · fail 1
```

### VERDE

```
$ node --test 'src/ferramentas/redes-sociais/largura-do-grafico.test.mjs'
ℹ tests 16 · pass 16 · fail 0
```

(Essa trava foi **retirada depois**, por decisão do coordenador — ver o item 5.
Os dois passos ficam registrados porque foram eles que produziram a medida que
levou à decisão.)

### VERMELHO — as duas regras das residuais, teste antes do código

```
$ node --test 'src/ferramentas/redes-sociais/largura-do-grafico.test.mjs'
SyntaxError: The requested module './largura-do-grafico.js' does not provide
an export named 'ancoraDoRotulo'
ℹ tests 1 · pass 0 · fail 1
```

### VERDE

```
$ node --test 'src/ferramentas/redes-sociais/largura-do-grafico.test.mjs'
ℹ tests 27 · pass 27 · fail 0
```

### Suíte inteira e build

```
$ npm test     (antes de tudo)   ℹ tests 3260 · pass 3260 · fail 0
$ npm test     (agora)           ℹ tests 3287 · pass 3287 · fail 0
$ npm run build                  ✓ built (sem erro nem aviso)
```

A conta: 3260 + 27 do módulo novo = 3287. No caminho passou por 3275 (15 testes,
antes das residuais) e por 3276 (com a trava da televisão, depois retirada).

---

## 3. A largura que o gráfico ganha, por período e por tela

Números da própria `larguraDoGrafico`, com a largura de cartão medida no
navegador (não estimada).

**Celular de 375px** — cartão de 319px nas duas seções:

| Período | Pontos | Largura | Rola? | Espaço por dia |
|---|---|---|---|---|
| 7D | 7 | **319** | não (igual a hoje) | 45,6px |
| 14D | 14 | **420** | **sim** | 30px |
| 30D | 30 | **900** | **sim** | 30px |
| MÊS (31 dias) | 31 | **930** | **sim** | 30px |

**Computador de 1440px** — seção 01 com 1036px de cartão, seção 02 com 632px
(dois cartões na linha):

| Período | Seção 01 | Seção 02 |
|---|---|---|
| 7D | 1036, não rola | 632, não rola |
| 14D | 1036, não rola | 632, não rola |
| 30D | 1036, não rola | **900, ROLA** |
| MÊS (31 dias) | 1036, não rola | **930, ROLA** |

**A seção 02 rola no computador em 30D e MÊS, e isso não estava previsto no
desenho.** O desenho supunha que "o computador fica exatamente como está em
qualquer período"; a conta desmente: o cartão da seção 02 divide a linha com o
vizinho e sobra com 632px, e 30 dias pedem 900. Vale o mesmo para o 14D no
celular, que o desenho dizia que ficaria como está: 14 × 30 = 420 não cabe em 319.

**Decidido (coordenador, com o dono ciente): fica assim.** O coordenador foi
medir o computador em produção, a 1440px, 30 dias, Breno Vale / Seguidores, e
achou **7 sobreposições reais** nos cartões de 632px, na mesma fonte de 9px —
`"R$ 92,86"×"R$ 100,10"`, `"R$ 99,81"×"R$ 105,73"`, `"15/8"×"16/8"`. Ou seja: o
computador tem o mesmo defeito do celular, só que menor. A promessa de "o
computador fica como está" tinha sido feita sobre algo que nunca havia sido
medido — a promessa estava errada, não a régua.

---

## 4. O que eu medi

Não consigo entrar na tela (ela manda para `/login` e eu não tenho conta).
**Não abri o painel logado e não afirmo nada sobre ele.**

O que dá para medir sem login, e foi medido: montei uma página estática servida
em `127.0.0.1:8791` com **o CSS do build** (`dist/assets/tela-de-redes-sociais-*.css`,
com o atributo `data-v-` correspondente, senão nenhuma regra pega) e com a
**geometria de desenho copiada verbatim** das duas funções (`buildChart` e
`desenharGraficoDiario`), alimentada com 30 dias de valores na mesma faixa dos
que foram medidos ("R$ 17,34", "R$ 11,35", "R$ 2,88", meta R$ 3,00). Depois medi
com o Playwright caixa por caixa de texto.

**Isto mede o CSS de verdade e a geometria de verdade; não mede a tela de
verdade.** Se alguma coisa do app mudar o tamanho do cartão (uma barra lateral,
um aviso, `--escala-texto` diferente de 1), a conta muda — e quem tem sessão
precisa refazer a medida original.

Resultados a **375px**, com a suíte de 30 dias, nos dois temas:

| | Antes | Depois |
|---|---|---|
| Rolagem horizontal da página | 0 | **0** (`documentElement` e `body`) |
| Pares sobrepostos · investimento | 3 | **0** |
| Pares sobrepostos · custo por seguidor | 8 | **0** |
| Pares sobrepostos · novos seguidores | 2 | **0** |
| Menor folga entre vizinhos | −5px | **+12,8px** (seguidores) · +49,5px e +52,5px (seção 02) |
| Fonte dos valores da seção 02 | 9px | **11px** |
| Texto recortado (em cima, embaixo, nas beiradas) | — | **nenhum**, em 7/14/30/31 dias |
| Alvos abaixo de 40px | — | **0** |

Também conferido: a rolagem anda (629px de curso em 30 dias); **no fim da
rolagem nenhum rótulo fica debaixo da faixa apagada**; tema escuro com o degradê
saindo em `--surface` do escuro; e o mesmo em 7, 14, 30 e 31 dias.

**Dois defeitos apareceram na medida e foram corrigidos aqui** (os dois teriam
ido para produção sem esta medição):

1. **A página inteira ganhava rolagem para o lado.** Cartão é item de grade e
   nasce com `min-width:auto` ("nunca menor que o conteúdo"). O conteúdo passou a
   ser de propósito maior que a tela, e a coluna foi atrás: o cartão da seção 02
   esticou para **980px** e o `body` para **992px** numa tela de 375px. Recortar
   dentro da caixa que rola não basta — a coluna precisa de `min-width:0`.
2. **O primeiro rótulo era recortado pela esquerda:** "R$ 17,34" aparecia como
   "$ 17,34" e "19/7" como "/7". Daí as duas tiras vazias das beiradas.

**Não verificado:** a tela logada; o comportamento do dedo de verdade num
aparelho de verdade (medi a caixa que rola, não o gesto); períodos com dia sem
dado (`semDado`) em cima da nova largura; e `--escala-texto` diferente de 1.

**Remedido depois de retirar a trava da televisão** (item 5), para garantir que a
retirada não mexeu em nada: a 375px, em 7/14/30/31 dias, continuam 0 sobreposições
nos três gráficos, 0 de rolagem horizontal na página e 0 texto recortado nos dois
temas. Com `body.dev-tv` posto à mão, o resultado é idêntico ao de sem ele.

---

## 5. A televisão (`body.dev-tv`) — medida, travada, e a trava retirada

Foi pedido para confirmar que "numa tela larga os pontos cabem, então a mesma
regra resolve". **Não cabem, e a conta é esta:** a 1920 com `dev-tv`, os dois
cartões da seção 02 dividem a linha e ficam com **836px cada**, e 30 dias pedem
900. Numa televisão ninguém arrasta nada, então os últimos dias sumiriam. Medido,
não deduzido.

Eu tinha posto uma trava (`podeRolar: false` quando `body.dev-tv` estivesse
posto). **O coordenador mandou retirá-la, e está retirada.** O motivo é bom:

- **Nada em `src/` põe a classe `dev-tv`.** Ela só existe no CSS (aqui e em
  `estilos-globais.css`, com um comentário que diz que é aplicada "via JS a partir
  de 1920px") e no `legacy/index.html`. O modo televisão está morto no app
  inteiro — de antes deste trabalho, não por causa dele.
- Trava que não pode disparar é pior que trava nenhuma: parece proteção no
  código e não protege nada.
- E ela nem é obviamente certa se estivesse ligada: não rolar numa televisão
  poria ~30 números sobrepostos numa tela vista de longe — trocaria dado
  escondido por dado ilegível. Ninguém nos disse que essa televisão existe nem
  como ela é usada.

**O que foi retirado:** o parâmetro `podeRolar` e o desvio dele em
`largura-do-grafico.js`; os dois testes que o cobriam (entrou 1 no lugar, "tela
larga que mesmo assim não comporta os dias: rola igual"); e a função
`alguemPodeRolar()` do `.vue`, com as duas chamadas que a consultavam. Sobrou uma
regra só, sem exceção por tipo de tela.

**Conferido depois da retirada:** com `body.dev-tv` posto à mão, o gráfico se
comporta exatamente como sem ele (30 dias → 900px, rola). A exceção não existe
mais em lugar nenhum.

**A frase que entrou no `LEIA-ME.txt` da pasta**, como limite conhecido:

> LIMITE CONHECIDO: a regra é uma só, para toda tela — numa tela bem larga com
> muitos dias o gráfico rola para o lado do mesmo jeito (a 1920, os dois cartões
> da seção 02 dividem a linha e ficam com 836px cada, e 30 dias pedem 900). Numa
> tela em que ninguém encosta — uma TV passeando pelos perfis sozinha — só o
> primeiro trecho de dias ficaria à vista, porque não há quem arraste. Se um dia
> este painel for para uma TV, é isto que precisa ser revisto.

---

## 6. Preocupações

1. ~~**A seção 02 passa a rolar no computador em 30D e MÊS**~~ — **RESOLVIDO por
   decisão.** O coordenador mediu o computador em produção e achou 7
   sobreposições reais lá também; o dono viu a medida e escolheu consertar nos
   dois. Fica como está. Ver o item 3.
2. **14D no celular também passa a rolar** (420 > 319), ao contrário do que o
   desenho antecipava. Mesma decisão do item 1: a régua manda.
3. **O rótulo da meta saiu da linha e foi para o canto de cima.** Só trocá-lo de
   lado não resolvia: medido, ele passou a bater no primeiro dia em vez do
   último, e a tarja é opaca — ela **escondia** o valor. Para resolver por
   construção, a faixa de cima virou dele sozinho, e as barras encurtaram: 14%
   na seção 01 e 12% na seção 02, só quando existe meta. Bar mais curta é preço
   pago; número escondido não é.
4. **Rolando para o fim, o rótulo da meta sai de vista** (ele mora na borda
   esquerda do desenho, não da tela). A linha tracejada continua visível o tempo
   todo. Um rótulo grudado na borda visível resolveria, e não fiz — é mais
   código do que o desenho aprovou.
5. **Não há redesenho ao girar o aparelho.** A rede é o `min-width:100%` do
   trilho: se o cartão crescer depois do desenho, o gráfico acompanha em vez de
   virar um toco. No caso da seção 02, esse acompanhamento estica o desenho
   uniforme e a altura cresce junto até o próximo desenho (de 136 para ~198px no
   pior caso medido). Não é paredão, mas não é o ideal.
6. **Nas telas largas continuam existindo 1 ou 2 sobreposições na seção 02**,
   entre o penúltimo e o último rótulo ("R$ 13,62" × "R$ 15,77", "16/8" × "17/8").
   São da regra antiga de "o último dia é sempre rotulado", que eu não mexi, e
   não envolvem nada do que foi mudado aqui. Fica anotado.
7. **`.chart-svg-wrap` perdeu o `margin-top:auto`**, que passou para a
   `.grafico-que-rola` (é ela que agora é filha direta do cartão em coluna). O
   efeito visual é o mesmo, mas quem for mexer no cartão precisa saber.

---

## 7. As duas residuais da verificação logada

O coordenador conseguiu abrir a tela logada e mediu o resultado desta entrega em
produção (Breno Vale / Seguidores / 30D): **celular 11 → 1 sobreposição,
computador 7 → 1**, fonte 9px → 11px, nenhuma rolagem horizontal na página, e o
gráfico de seguidores com 0 sobreposições e os números de dentro voltando a caber
(84 rótulos no celular contra 32 antes). Sobraram duas coisas, e é delas que
trata este item.

**Aviso sobre o que veio depois:** aquela sessão logada se perdeu (o
credenciamento gira quando é copiado para o servidor de desenvolvimento, e os
dois clientes se invalidaram). Então a conferência abaixo é a minha, no meu
banco de medição — **não voltou a ser conferida na tela logada**. O que isso
sustenta e o que não sustenta está no fim deste item.

### Residual 1 — `"R$ 20,41" × "R$ 26,40"`: era real, e não era um par especial

Reproduzi, e o par só aparece quando **três coisas acontecem juntas**:

1. **Um dia SEM DADO** encurta a lista de dias com número. O passo do rótulo (1 a
   cada 3) é contado sobre essa lista, então ele passa a cair no VIZINHO do
   último dia, não no último.
2. **O último dia é SEMPRE rotulado**, esteja no passo ou não (regra antiga, e
   certa). Resultado: dois rótulos a um dia de distância — 30px —, medindo ~45px
   cada.
3. **Os dois valores têm altura parecida**, porque o dia mais caro do mês puxa a
   escala. Alturas parecidas = rótulos na mesma faixa de altura.

Sem as três, não há sobreposição — foi por isso que a minha primeira tentativa de
reproduzir deu limpa, e é por isso que não é um problema "daqueles dois valores".

**O que mudou:** os rótulos passaram a ser **medidos no navegador depois de
desenhados** (`getComputedTextLength` e `getBBox`, em unidades do desenho), e
quem ainda assim se tocaria sai, pela regra pura `rotulosQueCabem`. A regra olha
os dois eixos de propósito: no mesmo gráfico, `"R$ 22,40"` e `"R$ 58,20"` se
cruzam na horizontal em −14,3 unidades e **continuam os dois na tela**, porque
estão em alturas diferentes e não se tocam. Derrubar por distância horizontal
seria perder número à toa.

Custo: **um rótulo a menos por gráfico** nos casos apertados (10 valores no de
investimento, 11 no de custo por seguidor). Quando dois obrigatórios se tocam
entre si — o dia mais alto colado no último —, sobra o último, que é o dia que o
dono está olhando. A barra mais alta continua sendo visivelmente a mais alta, e o
valor continua no toque longo.

### Residual 2 — `"R$ 92,86"` fora do quadro: era real; a consequência, não

Reproduzi: o rótulo do **primeiro dia** sobrava **12,3px para fora da caixa do
próprio SVG**, e o do último dia sobrava os mesmos 12,3px do outro lado. Nos dois
gráficos da seção 02, não em um só.

**A causa** é o que a estimativa não pega: `"R$ 92,86"` é mais largo que
`"R$ 17,34"` com os mesmos 8 caracteres, porque o "1" é estreito. Eu havia
dimensionado as tiras das beiradas com um valor que continha "1". Por isso agora
a largura é **medida**, nunca estimada.

**Duas correções na sua leitura, e as duas importam:**

- **"não é apenas fora da tela — é inalcançável rolando": não se confirmou.** As
  tiras vazias das beiradas (24px na entrada, 48px na saída) deixavam o rótulo
  fora do SVG mas DENTRO da área que rola. Medido: `inalcancavel: []` nos dois
  gráficos, no início e no fim da rolagem. Estava feio e frágil — 12,3px de sobra
  contra 24px de tira é pouca margem —, mas não estava inalcançável.
- **"o detector acusou sob dois SVGs diferentes, provavelmente escopo vazando":**
  aqui o seu detector estava certo por acaso. Não era o mesmo rótulo contado
  duas vezes: são **dois casos reais do mesmo defeito**, um por gráfico. Medindo
  com escopo fechado por SVG, o de investimento acusa `"R$ 92,86"` e o de custo
  por seguidor acusa o dele, `"R$ 21,05"`.

**O que mudou:** `ancoraDoRotulo` encosta na borda o rótulo que sairia do quadro
(`text-anchor` vira `start` ou `end`), e quem já cabe centrado não se mexe.
Depois disso, nenhum `<text>` sai da caixa do próprio SVG.

### Um defeito falso que era MEU, não do desenho

O meu primeiro detector acusou `"19/7"` como inalcançável no computador. Era
falso: a 1440 o gráfico de seguidores **não rola**, então a caixa não recorta nada
e o rótulo está visível na folga do cartão (`overflow-x: visible`, e
`elementFromPoint` no meio do rótulo devolve o próprio rótulo). Corrigi o
detector, não o código. Fica registrado porque é o mesmo tipo de erro que o seu
harness cometeu: **"fora da caixa" e "escondido" não são a mesma coisa**, e só é
escondido quando alguma caixa recorta.

### O que esta medição sustenta — e o que não sustenta

**Sustenta** (carga limpa a 375px e a 1440px, sem redimensionar página já
desenhada, com o CSS do build e a geometria copiada verbatim das funções, 30 dias
com um dia sem dado, valores na faixa real):

- nenhum `<text>` fora da caixa do próprio SVG, nos dois gráficos da seção 02;
- nenhuma sobreposição em nenhum dos três gráficos;
- nada inalcançável, no início e no fim da rolagem;
- nenhum texto recortado em cima ou embaixo, nos dois temas;
- nenhuma rolagem horizontal na página (`documentElement` e `body`).

**Não sustenta, e continua precisando de alguém com login:**

- que os **dados reais de hoje** caiam nos mesmos casos que eu construí. Eu
  reproduzi o mecanismo com valores na faixa certa e um dia sem dado; não é a
  série do banco;
- **quantos rótulos** o dono vai ver em cada perfil — isso depende da série real,
  e a regra nova tira um rótulo quando dois se tocam;
- o **gesto de arrastar** num aparelho de verdade (medi a caixa que rola, não o
  dedo);
- qualquer coisa fora de 30D com um dia sem dado: outros perfis, outros baldes,
  `MÊS PASS.`, e `--escala-texto` diferente de 1.
