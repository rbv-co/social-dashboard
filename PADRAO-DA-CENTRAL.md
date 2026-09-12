# PADRÃO DA CENTRAL — obrigatório

**Isto não é sugestão.** Vale para toda tela, toda ferramenta nova, todo ajuste
em tela existente. Quem for mexer na Central lê este arquivo ANTES de escrever a
primeira linha.

**Por que existe:** o dono cansou de explicar as mesmas coisas a cada entrega.
Cada regra abaixo está aqui porque um defeito real chegou às mãos dele. A
descrição do estrago fica junto — regra sem motivo é regra que alguém "melhora"
depois.

---

## 1. A regra que resume todas

**Nada de jeitinho.** Se você está escrevendo `style="..."` solto, escolhendo uma
cor no olho, ou inventando um tamanho que "encaixa aqui" — pare. Use o que já
existe. Se não existe, acrescente ao padrão primeiro, e depois use.

Uma tela que segue o padrão é bonita de graça. Uma tela ajustada no olho fica
diferente das outras, e a diferença é o que dá o ar de improviso.

---

## 2. Cor: só token, nunca hex

As cores vivem em `src/estilos/estilos-globais.css`, e mudam sozinhas entre o
tema claro e o escuro.

| Para | Use |
|---|---|
| Fundo da página | `var(--bg)` |
| Fundo de cartão, modal, campo | `var(--surface)` |
| Fundo de realce sutil | `var(--surface2)` |
| Texto | `var(--text)` · secundário `var(--muted)` |
| Linha, borda | `var(--border)` |
| Ação principal | `var(--accent)` |
| Sucesso / atenção / erro | `var(--green)` · `var(--orange)` · `var(--red)` |
| **O robô agindo** (automação) | `var(--roxo)` |

**PROIBIDO:** `#fffbeb`, `#f2f2f2`, `background:#eee`, qualquer hex de fundo ou
texto.

> **O estrago:** `background:#fffbeb` cravado num bloco deixou a seção de
> Usuários **branca no tema escuro**. Foi o dono quem viu, em produção.

**Precisa de um fundo colorido suave** (aviso, destaque)? Misture o token com a
superfície, para o tema cuidar dos dois lados:

```css
background: color-mix(in srgb, var(--orange) 10%, var(--surface));
border-color: color-mix(in srgb, var(--orange) 38%, var(--surface));
color: var(--text);   /* o texto usa --text, não a cor do aviso */
```

> **Por que o texto é `--text`:** o `--orange` do tema claro sobre esse fundo dá
> 4,14 de contraste — abaixo do mínimo de 4,5 para letra pequena. Medido. A cor
> é o sinal; o texto é para ler.

**`--roxo` tem significado, não é enfeite:** ele separa *o que você mandou fazer*
de *o que a automação faz sozinha*. Na Gestão de Tráfego é a diferença entre um
botão que você apertou e uma campanha que o robô está mexendo. Toda ferramenta
com automação usa esta cor — e nada mais usa.

**Etiqueta de estado** (em uso, pausado, atrasado…) usa as classes prontas:
`.selo` mais `.selo-ok` · `.selo-atencao` · `.selo-erro` · `.selo-info` ·
`.selo-robo` · `.selo-neutro`.

**Texto em cima de bloco colorido: `var(--sobre-cor)`, nunca `#fff`.**

```css
.meu-botao { background:var(--accent); color:var(--sobre-cor); }   /* certo  */
.meu-botao { background:var(--accent); color:#fff; }               /* errado */
```

No tema escuro os tokens de cor são CLAROS de propósito — foram feitos pra ser
texto sobre fundo escuro. Branco em cima deles não se lê.

> **O estrago:** 100 lugares da Central pintavam um bloco com o token e escreviam
> branco em cima. No tema escuro, o botão principal ficava em 3,71 e o selo de
> super-admin em 2,72 — abaixo do mínimo de 4,5. Ninguém tinha medido.

**Cor sobre o próprio tom aguado: `var(--accent-forte)`.**

```css
.aba-ativa { background:var(--accent-light); color:var(--accent-forte); }
```

O accent puro sobre `--accent-light` dá 4,42 no tema escuro — reprova por pouco,
e "por pouco" continua sendo reprovado. O par acima já vem medido (5,96 a 7,97).

**Cada módulo PODE ter uma cor de identidade** — mas como token, nunca hex:

```css
/* em estilos-globais.css, junto dos outros tokens */
.tela-minha-ferramenta        { --modulo:#0f766e; }
[data-theme="dark"] .tela-minha-ferramenta { --modulo:#2dd4bf; }
```

Quem não define herda `--accent`, que é o certo para a maioria. Dentro da tela,
use sempre `var(--modulo)` para a cor de ação — nunca o hex.

> **O estrago:** a tela de Acessos usava `#0d9488` cravado, e com texto branco em
> cima isso dá **3,74 de contraste** — abaixo do mínimo. As abas e os botões dela
> já reprovavam, e ninguém tinha percebido porque a cor nunca foi medida.

**A única exceção ao "só token": cor de marca de terceiro.** O verde do Zoho, o
azul da Microsoft, o cinza da Apple — elas identificam o serviço de fora, e
trocar por `--green`/`--accent` faria logotipo virar estado do nosso sistema.
Deixe em hex **com um comentário dizendo que é cor de marca**, senão o próximo
que passar por ali vai "consertar".

**Contraste mínimo 4,5:1** para texto normal. Não é opinião, é o que se lê.

---

## 3. Botão: três tipos, e só

Nunca escreva `style` num botão. Existem três, e cobrem tudo:

| Tipo | Quando | Classe |
|---|---|---|
| **Principal** | a ação que a tela quer que você faça. **Um por bloco.** | `.btn.btn-principal` |
| **Comum** | as outras ações | `.btn` |
| **Perigo** | apaga, desativa, é difícil de desfazer | `.btn.btn-perigo` |

Regras que valem para os três:

- **Altura mínima 40px.** Dedo não acerta menos que isso.
- Fonte 13px, `border-radius: var(--radius-md)`, `var(--fonte-principal)`.
- **Fundo cinza nunca.** Botão comum é borda + fundo transparente, não cinza.
- Botão de perigo **não fica solto na lista**. Ele mora na ficha ou atrás de um
  passo a mais.

> **O estrago:** "Excluir" e "Desativar" em vermelho, sempre visíveis, em cada
> uma das quinze pessoas da lista. No celular cada pessoa ocupava meia tela.

---

## 4. Modal

- **No computador:** largura máxima 420px, centralizado, altura máxima 88vh.
- **No celular (≤640px): ocupa a tela com 12px de margem de cada lado.**
  `max-width:none` e `max-height:calc(100dvh - 24px)`.
- **`dvh`, nunca `vh`**, em qualquer altura de tela cheia.
- Fundo escurecido `rgba(0,0,0,.55)`, e clicar nele fecha.
- Botão de fechar com 40px de alvo, no canto, e cabeçalho que não rola junto.
- Conteúdo rola DENTRO da caixa (`overflow-y:auto`), nunca a página atrás.

### A página atrás fica travada — três peças, e as três são obrigatórias

```js
import { abrirModal, fecharModal } from '@/compartilhado/travar-rolagem-de-fundo.js'
// ao abrir:  abrirModal()
// ao fechar: fecharModal()   ← em TODOS os caminhos: X, clique no fundo, Esc
```

**Modal montado por `v-if`** usa a diretiva `v-trava-rolagem`, sem chamar nada.

**Modal legado montado por JavaScript puro** já é coberto pelo observador
(`src/compartilhado/observar-modais-legados.js`), ligado uma vez na moldura:
basta o seletor dele estar na lista de lá. **Não chame `abrirModal()` num modal
que o observador já cobre** — travaria duas vezes e destravaria uma, prendendo a
página.

```css
.meu-fundo  { touch-action:none; overscroll-behavior:contain; }
.minha-caixa{ overscroll-behavior:contain; touch-action:pan-y; }
```

Sem esse par, o dedo arrasta a tela pros lados por dentro do modal.

> **O estrago:** eu apliquei esse par só na tela que o dono estava olhando.
> Os outros 27 fundos de modal da Central continuaram arrastando por semanas.

### O defeito mais silencioso de todos: a diretiva que ninguém registrou

`v-trava-rolagem` estava escrita em 8 modais e **nenhum deles travava nada.**
Em `<script setup>`, uma diretiva só existe se for importada no componente ou
registrada no `createApp` — e não era nem uma coisa nem outra. O Vue não
quebra nesse caso: escreve `Failed to resolve directive` no console e segue.

Módulo pronto, testes verdes, diretiva exportada e usada — e o comportamento
simplesmente não acontecia.

**Regra que vale para qualquer coisa registrada no app** (diretiva, componente
global, plugin): escrever no template não é ligar. Se o efeito é invisível
quando falha, ele precisa de teste — `diretiva-usada-esta-registrada.test.mjs`
lê o console por você a cada rodada.

O `travar-rolagem-de-fundo.js` usa **contador, não booleano**: dois modais podem se
sobrepor (abrir o editor de permissões de dentro da ficha), e com booleano
fechar o de cima destravaria a página com o de baixo ainda aberto.

> **O estrago:** com o modal aberto, a página atrás continuava rolável. No
> celular, arrastar o dedo em cima do modal **fazia a tela escorregar para os
> lados.** O dono viu no aparelho.

> **O estrago 1:** `max-height:88vh` deixava uma faixa escura embaixo que no
> aparelho lê como **barra preta**, e cortava a última linha do conteúdo.
>
> **O estrago 2:** `vh` é calculado com a barra de endereço escondida. No celular
> a caixa passava do que dá para ver, e o fim ficava atrás da barra do navegador.

### A armadilha que quebrou um modal inteiro

O CSS das telas é **`scoped`**. Um seletor `.tela-x :deep(.meu-modal)` só vale
para elemento que esteja **dentro** do componente.

**Nunca pendure um modal em `document.body`.** Pendure na raiz da tela:

```js
const raiz = document.querySelector('.tela-x')
raiz.appendChild(fundo)
```

> **O estrago:** a ficha da pessoa foi para produção pendurada no `body`. Nenhuma
> regra se aplicou — sem posição, sem fundo, sem camada — e ela **despencava como
> texto cru no fim da página**. O dono viu antes de mim.

---

## 5. Texto nunca corta

- **Proibido `text-overflow: ellipsis`** em nome, título ou rótulo.
- Use **`overflow-wrap: anywhere`**: nome comprido quebra em duas linhas.
- Cabeçalho de seção, nome de pessoa, nome de ferramenta: os três seguem isto.

> **Por quê:** o dono não consegue distinguir duas pessoas se o nome de ambas
> vira "Maria Eduarda C…".

---

## 6. Celular é o primeiro, não o último

A Central é usada no celular. Toda entrega se mede a **375px**, e os quatro
critérios têm de fechar:

| Critério | Valor |
|---|---|
| Rolagem horizontal na página | **0** |
| Alvo de toque (botão, select, link) | **≥ 40px de altura** |
| Fonte de `input`, `select`, `textarea` | **≥ 16px** |
| Elemento com texto cortado | **nenhum** |

**16px nos campos não é estética:** abaixo disso o iOS dá zoom ao focar e a tela
salta na cara de quem está digitando.

**Como medir** (e é obrigatório medir, não deduzir):

```js
await page.setViewportSize({ width: 375, height: 812 })
document.documentElement.scrollWidth - document.documentElement.clientWidth   // = 0
[...document.querySelectorAll('button,select,input')].filter(e => e.getBoundingClientRect().height < 40)
[...document.querySelectorAll('input,select,textarea')].filter(e => parseFloat(getComputedStyle(e).fontSize) < 16)
[...document.querySelectorAll('h1,h2,h3,.titulo,.nome')].filter(e => e.scrollWidth > e.clientWidth + 1)
```

**Ajuste de celular vai em `@media (max-width:640px)`. Nunca mexa na regra do
desktop para consertar o celular.**

### 40px de alvo sem engordar o botão

Aba, chip e ícone não precisam VIRAR 40px — quem precisa de 40px é a área do
dedo. Cresça a área, não o desenho:

```css
@media(max-width:640px){
  .meu-icone       { position:relative; }
  .meu-icone::after{ content:'';position:absolute;left:0;right:0;top:50%;
                     transform:translateY(-50%);height:40px; }
}
```

Sem `pointer-events:none` — o pseudo PRECISA receber o toque, é para isso que
ele existe. Só no celular: no computador o mouse acerta o alvo real.

> **Cuidado obrigatório:** o `::after` de um elemento pode cobrir o vizinho e
> deixá-lo inalcançável. Depois de aplicar, verifique que o centro de cada alvo
> ainda responde a ele mesmo:
> `document.elementFromPoint(cx, cy)` tem de cair no próprio elemento.

---

## 7. Espaço e hierarquia

- Espaçamento só da escala: `--sp-1` (4px) a `--sp-8` (48px). Nada de `13px`.
- Raio: `--radius-sm/md/lg/xl`. Sombra: `--shadow-sm/md/lg`.
- Cartão: `--card-radius` e `--card-pad`.
- **Um assunto por bloco**, com um título de seção em cima
  (`--texto-etiqueta`, maiúsculas, `letter-spacing:1.5px`, `var(--muted)`).
- **Uma ação principal por bloco.** Duas competindo é o mesmo que nenhuma.
- Ordem dentro de uma tela: **o que decide vem antes do que depende.**
  (Na ficha: o vínculo vem antes da lotação, porque sem vínculo não há onde
  gravar a lotação.)
- Tela é **full-bleed**: nada de coluna estreita centralizada.

### Texto: só da escala, nunca um número escolhido no olho

Tamanho de letra é igual a cor: **sai de token**. Quem escreve `font-size:13.5px`
está escolhendo no olho, como quem escreve `background:#f2f2f2`.

São **cinco degraus**, e cinco só (`src/estilos/estilos-globais.css`):

| Degrau | Para | Base |
|---|---|---|
| `--texto-etiqueta` | rótulo em maiúsculas, cabeçalho de coluna, texto de botão | 11px |
| `--texto-corpo` | o texto comum: parágrafo, linha de lista, célula | 13px |
| `--texto-campo` | **campo de formulário** e o que se lê de pé: o nome da coisa, o recado da máquina, o aviso antes de uma ação | 16px |
| `--texto-titulo` | título de caixa, e o dado que se confere letra por letra | 20px |
| `--texto-numero` | o número que se lê de longe, de pé, na bancada | 32px |

**PROIBIDO:** `font-size:13.5px`, `font-size:12px`, `font-size:max(9px, calc(14px * …))`
— qualquer número escrito à mão.

Cada degrau já vem com o `max(piso, calc(Npx * var(--escala-texto, 1)))` dentro:
respeita o zoom de letra do usuário e tem piso para não sumir quando ele reduz.
**`--texto-campo` nunca desce de 16px** — abaixo disso o iOS dá zoom ao focar
(item 6 aqui em cima), e é por isso que ele é um degrau e não uma exceção.

> **O estrago:** a tela de Autenticidade e Garantia tinha **15 tamanhos
> distintos** — doze deles entre 10 e 26px, vários separados por meio pixel. O
> dono reclamou dela três vezes, com estas palavras: *"vários tamanhos de fonte,
> uma bosta, confuso"*. Meio pixel de diferença o olho não lê como hierarquia:
> lê como bagunça. As irmãs estão no mesmo caminho — Frota 12, Patrimônio 16,
> Gestão à Vista 26, Acessos 28.

**As outras telas ainda não foram convertidas.** Elas vão uma a uma; o que não
pode é tela NOVA, ou bloco novo em tela velha, nascer com número solto.

---

## 8. Nunca perder conteúdo ao reorganizar

Ao mover, padronizar ou redesenhar uma tela: **liste o que existia antes e
confira item a item.** Informação exibida, ação, texto explicativo — tudo.

> **O estrago:** ao reorganizar a lista de usuários, sumiram o e-mail, a data de
> cadastro e **todas as ações por pessoa** — inclusive o botão que abria o editor
> de permissões, que ficou inalcançável.

---

## 9. A tela nunca mente

- **Erro de leitura não vira lista vazia.** Mostre a mensagem do erro. "Não há
  usuários" quando a leitura falhou é a mentira mais cara que uma tela conta.
- **Campo que não pode gravar fica travado, com o motivo escrito.** Campo que
  aceita e joga fora é pior que campo travado.
- **Se a gravação falha, o campo volta ao valor anterior.** Campo que parece
  salvo e não salvou é o defeito mais caro de perceber.
- **Aviso que aparece sempre vira paisagem.** Só apareça quando há o que dizer.

> **O estrago:** o helper `sb()` desta base, com a chave anônima, responde **200
> com lista vazia** para tabela que só abre para quem está logado. Um botão
> inteiro pareceu "não ter dados" por um dia. **Use `sbClient`.**

---

## 9½. O padrão se verifica sozinho

Seis destas regras não dependem mais de você lembrar delas — `npm test` reprova:

| Verificado | Onde |
|---|---|
| Cor de estado sai de token | `padrao-da-central.test.mjs` |
| Bloco pintado com token não leva branco cravado | idem |
| Fundo de modal trava o arrasto | idem |
| Botão usa as três classes | idem |
| Botão comum não tem fundo cinza | idem |
| Tamanho de texto sai da escala (tela de Autenticidade) | `escala-de-texto.test.mjs` |
| Diretiva usada está registrada | `diretiva-usada-esta-registrada.test.mjs` |
| Todo `.vue` compila | `todo-vue-compila.test.mjs` |

**Precisa de uma exceção?** Adicione no teste, com o motivo escrito ao lado —
como já estão lá marca de terceiro, identidade de módulo, medalha de ranking e
paleta de gráfico. Nunca contorne calado.

O resto do padrão — hierarquia, "um assunto por bloco", "uma ação principal" —
continua sendo olho, e se mede a 375px num navegador de verdade.

---

## 10. Antes de dizer que acabou

- [ ] `npm test` inteiro passando
- [ ] `npm run build` sem erro
- [ ] **Aberto no navegador, a 375px E a 1440px** — os quatro critérios do item 6
- [ ] Nenhum hex de cor novo
- [ ] Nenhum `style=` solto em botão
- [ ] Tema escuro conferido
- [ ] Nada do que existia antes se perdeu

**Ressalva não substitui olhar.** Dizer "não abri no navegador" e entregar assim
mesmo já colocou defeito grosseiro em produção mais de uma vez. Se não deu para
abrir, a entrega não está pronta — não é uma observação de rodapé.

---

## Onde ficam as coisas

| | |
|---|---|
| Tokens de cor, espaço, fonte | `src/estilos/estilos-globais.css` |
| Base de layout (detalhe) | `docs/base-de-layout.md` |
| Classes de botão | `src/estilos/estilos-globais.css`, seção "Botões" |
