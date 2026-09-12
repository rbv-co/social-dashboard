# Frota · a Gestão passa a enxergar (e a mexer) no que já aconteceu

Desenho de 13/08/2026. Pedido do dono, em quatro partes:

1. os cards e botões no computador estão feios — harmonizar e igualar os tamanhos;
2. a aba Gestão precisa mostrar o **histórico de reservas**, com o admin podendo
   **editar, revogar e cancelar** cada uma;
3. a aba Gestão precisa dar acesso aos **checklists assinados** e às
   **requisições assinadas** — "não sei se está indo tudo pra pasta no Zoho";
4. o **PDF que vai pro Zoho** precisa de cara corporativa, com a marca RBV & Co.

---

## O que foi medido antes de desenhar

Nada aqui é suposição. Tudo saiu de consulta ao banco de produção em 13/08/2026.

| O que | Quanto |
|---|---|
| Reservas (`frota_requisicoes`) | **2**: 1 aprovada, 1 recusada. **Zero pendentes.** |
| Checklists (`frota_checklist`) | **2**, dos quais **1 assinado** |
| Cópias em PDF no Zoho | **1**, situação `enviado` — chegou |
| Retiradas (`frota_uso`) | **12**, sendo 7 posses antigas importadas e **5 retiradas reais** |

Três conclusões que mudaram o desenho:

**1. A fila de aprovação está vazia e as duas reservas que existem não aparecem
em lugar nenhum.** A gaveta "Fila" só lista `pendente`. Com zero pendentes, a
aba Gestão hoje mostra uma fila vazia e nenhuma das reservas decididas. Não há
tela nenhuma que edite, cancele ou revogue uma reserva.

**2. Requisição não tem assinatura, e não vai pro Zoho.** A tabela
`frota_requisicoes` não tem coluna de assinatura nenhuma. Quem assina é só o
checklist do dia. **Decisão do dono, tomada nesta conversa: não criar
assinatura de requisição.** A requisição é um *plano* ("quero o carro dia 20") —
assinar plano não prova nada sobre o carro. A prova que vale é a do momento em
que a chave troca de mão, e ela já existe.

**3. A prova quase nunca acontece — e quando aconteceu, foi da pessoa errada.**
Das 5 retiradas reais, só 1 tem checklist assinado no mesmo dia. E nesse único
caso, quem assinou foi **Erick Martins** e quem pegou o carro foi **Breno**.
Ou seja: **zero das 5 retiradas têm a assinatura de quem pegou o carro.**

A causa está escrita no código, em `precisaDeChecklist`: o checklist é **por
carro e por dia**. Se o dono do carro assinou às 7h30, quem pega o carro às
17h49 não assina nada. As duas frases são diferentes:

- o checklist diz *"o carro estava assim neste dia, e fulano viu"*;
- a retirada diz *"eu, fulano, recebi este carro assim e vou responder por ele"*.

Elas só coincidem quando é a mesma pessoa.

---

## Parte 1 · O visual no computador

### O que está errado, e por quê

Medido no CSS de `tela-de-frota.vue`:

| Defeito | Onde |
|---|---|
| O botão estica pra preencher o card (`flex:1 1 auto`), então card com 1 botão tem um botão de ponta a ponta e card com 3 tem três larguras diferentes | `.fr-btn` |
| A linha de ações não está presa no rodapé, e o card não é coluna — em cada coluna da grade os botões param numa altura diferente | `.fr-card`, `.fr-acoes` |
| Dois selos com medidas diferentes na mesma aba: um usa a escala de texto do app, o outro tem `.8rem` cravado e ignora o ajuste de tamanho de letra | `.fr-selo` × `.fr-cobranca-selo` |
| Cartão com px cravado (padding 14/16, raio 12) em vez da escala de tokens | `.fr-card` |

### O que muda

- `.fr-card` vira coluna (`display:flex;flex-direction:column`) e `.fr-acoes`
  ganha `margin-top:auto`: **a ação fica sempre colada no rodapé**, na mesma
  altura em todos os cards da linha.
- **No computador (≥900px) o botão para de esticar.** Largura pelo conteúdo, com
  `min-width` igual pra todos, e as ações alinhadas à esquerda.
- **No celular nada muda**: o botão continua ocupando a largura toda, que é o que
  o dedo pede. Ajuste de celular vive em `@media(max-width:640px)`, e a regra do
  desktop não é usada pra consertar o celular (padrão, item 6).
- Os dois selos passam a usar a mesma medida, o mesmo raio e a mesma escala.
- Padding e raio do cartão saem de `--card-pad` e `--card-radius`.
- **A tela continua ocupando a largura toda** (escolha do dono entre as duas
  opções apresentadas): nada de coluna estreita centralizada.

Guarda: `botoes-padronizados.test.mjs` ganha os casos novos — o botão não
estica no desktop, e os selos têm a mesma medida.

---

## Parte 2 · O histórico de reservas

### Onde fica

Gaveta nova na aba Gestão, chamada **Reservas**. A **Fila de aprovação continua
onde está**, logo abaixo dos botões: ela é o que pede ação hoje, e o padrão
proíbe perder o que já existia ao reorganizar (item 8).

### O que a lista traz

Uma linha do tempo, mais recente primeiro, com filtro por situação. Como a
maioria das retiradas hoje **não tem reserva** (5 retiradas, 2 reservas), a
lista traz os dois: **reservas** e **retiradas avulsas**. Uma lista que só
mostrasse reserva mostraria menos do que aconteceu — e "a tela nunca mente".

Cada card mostra:

- carro e placa, quem vai dirigir, quando retira e quando devolve;
- destino, finalidade, departamento;
- quem pediu e quando; quem decidiu, quando e com que motivo;
- **o que aconteceu de verdade**: retirada (data, hora, quem, quilometragem) ou
  "ainda não foi retirado".

### As três ações

| Ação | Quando aparece | O que faz |
|---|---|---|
| **Editar** | reserva `pendente` ou `aprovada`, e ainda **sem** `uso_id` | muda carro, motorista, datas, destino, finalidade |
| **Cancelar** | reserva que **ainda não começou** | situação vira `cancelada`, com motivo escrito obrigatório |
| **Revogar** | reserva **em vigor** (a hora de retirada já chegou) ou que já virou viagem | situação vira `revogada`, com motivo obrigatório |

Definição de "cancelar" × "revogar" **escolhida pelo dono**: cancelar desmarca o
que ainda não começou; revogar tira o que já está valendo.

**Revogar libera o carro na hora** — `reservaSegurando` deixa de considerá-la, e
outra pessoa pode reservar. **Revogar NÃO fecha a viagem**: se o carro está
fisicamente com alguém, inventar quilometragem de devolução seria mentira. O
card passa a dizer *"o carro está com fulano sem reserva válida"* até a
devolução acontecer.

**Quando a ação não pode, o card diz por quê** — nunca some com o botão em
silêncio (padrão, item 9).

### O rastro (e um buraco de segurança que estava aberto)

Hoje só existem `decidida_por`/`decidida_em`/`motivo_decisao`, e eles servem a
aprovar/recusar. Editar uma reserva reescreveria o passado sem deixar marca — e
esta ferramenta existe justamente pra ser o rastro que o papel não tinha.

Entra a tabela **`frota_requisicoes_historico`**, escrita **por gatilho**: toda
mudança grava o que mudou (campo, valor de antes, valor de depois), quem mudou,
quando e o motivo. Escrita por gatilho, e não pela tela, porque rastro que
depende do aplicativo lembrar de gravar é rastro que uma tela nova esquece.

**O buraco:** hoje a política de RLS de `frota_requisicoes` permite **UPDATE a
qualquer pessoa com acesso à Frota** — o gatilho só barra a mudança para
`aprovada`/`recusada`. Ou seja, qualquer um pode hoje mudar data, carro e
destino da reserva de outra pessoa. Está assim desde que a tabela nasceu.
Fecha junto: editar, cancelar e revogar passam a exigir `frota.aprovar`,
**no banco**, por gatilho — não na tela.

---

## Parte 3 · A prova junto, e a assinatura de quem pega

### A prova colada em cada linha

Escolha do dono entre "histórico completo com a prova junto" e "dois quadros
separados": **a prova vem junto**. Cada card do histórico mostra, embaixo:

- a ficha de checklist daquele dia e daquele carro, com botão pra **abrir e ler
  o que foi marcado** (a tela desse detalhe já existe — é a mesma do quadro de
  cobrança);
- **quem assinou**, e se foi a mesma pessoa que pegou o carro;
- se a **cópia em PDF chegou na pasta do Zoho**, com a data — ou o motivo de não
  ter chegado, com a frase que o robô escreveu;
- e **quando não houve assinatura nenhuma, a linha diz isso com todas as
  letras**.

Isso responde à pergunta do dono ("não sei se está indo tudo pra pasta no
Zoho") sem ele precisar entrar carro por carro, que é o único caminho de hoje.

### A regra da assinatura muda de dono

**Antes:** `precisaDeChecklist` olha só se aquele carro já tem checklist naquele
dia. Tendo, não pergunta nada a quem pega.

**Depois:** olha também **quem assinou**. Três casos:

| Situação na hora de pegar | O que a ficha pede |
|---|---|
| Ninguém fez o checklist do carro hoje | o checklist inteiro, assinado — **como já é hoje** |
| Quem está pegando é quem já assinou hoje | **nada** — não se confere o mesmo carro duas vezes |
| O checklist de hoje é de **outra pessoa** | o **aceite de retirada**: uma linha curta, assinada, sem repetir a lista |

O aceite mora na própria viagem (`frota_uso`), guarda o rabisco e aponta para o
**hash da ficha do dia**. O documento fica lendo assim: *"Breno recebeu a BMW X1
em 07/08 às 17h49, no estado registrado na ficha assinada por Erick Martins
(código a1b2…)"*.

**Continua sendo uma assinatura por viagem, e nenhum PDF a mais** — que foi
exatamente o que o dono aprovou. O aceite é imutável depois de gravado, pelo
mesmo gatilho que já protege as respostas do checklist.

---

## Parte 4 · O PDF com cara de documento da empresa

### O que existe hoje

`supabase/functions/_shared/pdf-do-checklist.js` monta o PDF à mão, sem
biblioteca — decisão certa e mantida: o arquivo é texto em uma coluna e uma
biblioteca de layout pesa megabytes no tempo de partida de uma Edge Function.
Mas hoje ele é **datilografia**: Helvetica em uma coluna, sem cabeçalho, sem
cor, sem rodapé, sem numeração de página.

### O que a marca é, medido no repositório

Não há um arquivo de manual de marca. O que existe, e que é a marca de fato:

- **logotipo**: "RBV & Co." + um filete + "CONSULTANCY", em **serifada**, preto
  sobre branco (`public/midia/favicon.svg` documenta a proporção do filete);
- **cores**: preto quente `#17150f`, pérola `#faf7f2`, azul de ação `#1D4ED8`,
  vermelho `#b01e3a` (`src/estilos/estilos-globais.css`);
- **fontes de tela**: Sora (texto), IBM Plex Mono (números), Oswald (só a marca).

### O que o PDF passa a ter

Nenhuma fonte é embutida: o PDF ganha as **Times** (Times-Roman e Times-Bold),
que são base do formato como a Helvetica e existem em qualquer leitor desde
1994 — e são serifadas, que é o que o logotipo é. Sem megabyte, sem risco.

- **Cabeçalho**: faixa preta com "RBV & Co." em serifada, o filete na proporção
  do logotipo, e "CONSULTANCY" em versalete espaçado. À direita, "CENTRAL DE
  INTELIGÊNCIA · FROTA".
- **Título do documento** e, embaixo, uma tira com carro, placa e data.
- **Seções** com título em versalete espaçado sobre um fio — a mesma hierarquia
  que o padrão da tela usa.
- **Dados em duas colunas** (rótulo à esquerda, valor à direita), com fio
  finíssimo entre linhas.
- **Resultado como selo colorido**: verde liberado, laranja com ressalvas,
  vermelho não liberado. Item com problema sai em vermelho na lista.
- **Bloco de assinatura emoldurado**, com o rabisco e a linha de assinatura.
- **Códigos de conferência** em caixa cinza, em Courier, como já são.
- **Rodapé em todas as páginas**: marca, "Página X de Y", e o instante de
  geração.

O conteúdo — cada palavra — é **o mesmo de hoje**. A regra que manda naquele
arquivo continua valendo: *o papel não pode discordar do sistema*. Muda a
apresentação, não o que está escrito. Os testes de conteúdo existentes seguem
verdes; entram testes novos só para o que é novo (cabeçalho, rodapé, numeração).

---

## Como se prova que ficou pronto

- `npm test` inteiro verde, com os testes novos por módulo.
- `npm run build` sem erro.
- Aberto no navegador **a 1440px e a 375px**, nos **dois temas**, com os quatro
  critérios do padrão medidos e não deduzidos: rolagem horizontal 0, alvo de
  toque ≥40px, fonte de campo ≥16px, nada cortado.
- Card e botão: altura dos cards igual por linha e largura de botão igual,
  medidas no navegador.
- O PDF novo gerado a partir da ficha real de 07/08 e **aberto** para conferir.
- Migrations aplicadas pelo MCP, uma a uma (o runner não é usado nesta base).
- Edge Function `enviar-pdf-checklist` subida **na mão**, com as dependências de
  `_shared` — ela não sobe com push.

## O que ficou provado, e a única divergência que sobrou

Feito e conferido em 14/08/2026:

- `npm test`: **3043 testes verdes** (eram 2966 antes da merge com a main).
- `npm run build` sem erro.
- Navegador de verdade, **1440px e 375px, tema claro e escuro**, com o CSS do
  build e o `data-v` real: rolagem horizontal **0**, nenhum alvo abaixo de 40px,
  nada de texto cortado. Cartões da mesma linha com **altura idêntica**
  (520/520/520 e 302×4) e a ação a **17px do rodapé em todos** — que é o que o
  dono chamou de feio quando não era assim.
- Migrations 045 e 046 aplicadas pelo MCP, e os gatilhos **provados dentro de
  transação desfeita** (`rollback`), sem tocar em dado real: cancelar sem motivo
  é barrado, cancelar com motivo carimba quem/quando, o histórico nasce sozinho,
  e reserva encerrada não se edita.
- PDF novo gerado a partir da ficha real de 07/08 (BMW X1) e **aberto**.
- Edge Function `enviar-pdf-checklist` na **versão 4**, e um 401 de teste prova
  que ela sobe e importa os seis módulos — o 401 só acontece depois disso.
- Deploy conferido **pelo caminho**, em `socialdashboard.rbvcompany.com`:
  home → `index-6U_hIesq.js` → `tela-de-frota-Ci10MX1e.js`, com o mesmo
  SHA-256 do arquivo construído aqui.

**A divergência:** o deploy da Edge Function é feito enviando o conteúdo dos
arquivos, e o que subiu tem **alguns caracteres de enfeite a menos nos
comentários** (as réguas `──` de algumas seções, e um acento em "papéis"). O
código executável foi comparado **byte a byte com comentários e espaços
removidos: os seis arquivos são idênticos ao repositório.** Não muda
comportamento nenhum, e some no próximo deploy desta função — fica escrito aqui
porque nesta central vale a regra de que só o servidor diz o que está rodando.

## O que fica de fora, de propósito

- **Assinatura de requisição** — decisão do dono, com o motivo registrado acima.
- **PDF do aceite de retirada** — o aceite vale gravado no banco, que é onde a
  prova mora. Se o dono quiser o papel, vira item próprio.
- **Fechar viagem ao revogar** — inventar quilometragem seria mentira.
