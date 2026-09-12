# Gravação das etiquetas NFC do Selo Vessel — desenho

**Data:** 30/08/2026
**Projeto 1 de 5** (a divisão está no fim deste documento)

## O objetivo em uma frase

Gravar o endereço do selo dentro da etiqueta NFC que vai costurada no forro da
bolsa, peça por peça, sem gravar a mesma duas vezes e sem pular nenhuma.

## O que JÁ existe (medido em 30/08/2026, não suposto)

| | estado |
|---|---|
| Página da cliente | **no ar** em `vesselbrasil.com.br/verify/<código>` (200 com e sem `www`) |
| Painel Autenticidade e Garantia | no ar no iamundi, `/autenticidade`, quatro abas |
| Banco | `vessel_lotes` 1 · `vessel_pecas` 5 · `vessel_registros` 2 · `vessel_leituras` 115 |
| **Etiquetas gravadas** | **zero** |
| `vessel_marcar_gravada(codigo)` | existe e concedida a `authenticated` — **nenhuma migration é necessária** |
| Gravação de NFC no código | **não existe.** `NDEFReader` não aparece em lugar nenhum |

A aba "Gravar" hoje mostra o endereço em letra grande, um botão de copiar e
"Gravei essa". A gravação em si é feita à mão, num app externo.

**Zero etiquetas gravadas é o fato que abre esta janela.** O endereço dentro do
chip é porta de mão única: etiqueta costurada dentro de bolsa vendida não se
regrava. Enquanto o número for zero, tudo ainda é reversível.

## As decisões, e o porquê de cada uma

**O endereço fica `https://vesselbrasil.com.br/verify/<CÓDIGO>`.** Já é o que
`enderecoDaTag()` produz. Cabe folgado numa NTAG213 e é legível para digitar à
mão se a etiqueta falhar.
**O que isso passa a significar:** renovar `vesselbrasil.com.br` deixa de ser
opcional e vira obrigação permanente — hoje ele vale até 10/02/2028. O caminho
`/verify/` e o formato do código de 10 caracteres congelam junto.
O que continua livre: o repositório, o host, o visual, o texto e o banco.

**A trava nasce desligada, mas nasce.** Decisão do dono: por enquanto não
travar. Etiqueta NFC pode ser travada de forma permanente, e sem trava qualquer
pessoa com um celular regrava a etiqueta de uma bolsa original — inclusive
apontando para um site falso. O código de travar vai escrito e testado desde já,
atrás de um interruptor desligado: ligar depois é clicar, não reescrever.

**A etiqueta vai costurada no forro interno, longe da ferragem.** NFC não
atravessa metal. Isso não é código — é instrução na tela de quem grava.

**Volume: dezenas por lote (10 a 50).** A fila conduz peça a peça sem busca nem
paginação, mas nasce ordenada e retomável, para não precisar reescrever quando
crescer.

**Onde mora:** Gestão Interna da Central RBV, na aba "Gravar" que já existe —
onde o login, a permissão `autenticidade` e os dados já estão. Desenhada para
sair inteira depois, rumo ao repositório que tiver o módulo de produção.

## O desenho

### A regra que sustenta tudo: ler antes e ler depois

**Antes de gravar**, a tela lê a etiqueta. Se ela já carregar um endereço Vessel
de OUTRA peça, a gravação para e avisa. Sem isso, encostar na etiqueta errada
sobrescreve uma peça boa e manda duas para o lixo.

**Depois de gravar**, a tela lê de novo e compara com o endereço esperado. Só
então chama `vessel_marcar_gravada`. A gravação ter "dado certo" não é o
navegador não ter reclamado — é a etiqueta devolver o que se pôs nela. Se ela
sair de perto no meio, a peça continua na fila e a tela pede para encostar de
novo. **Nunca marca no escuro.**

### Os arquivos

| arquivo | responsabilidade | encosta em |
|---|---|---|
| `nfc-fila.js` (novo) | a fila, a comparação do que foi lido, a lista para o gravador de mesa e a leitura do retorno dele | nada — contas puras |
| `gravador-nfc.js` (novo) | **o único** que toca o `NDEFReader` do navegador | o navegador, por implementação injetável |
| `tela-de-autenticidade.vue` (existente) | a aba "Gravar" chama os dois acima | Vue, Supabase |

`lotes.js` já tem `enderecoDaTag()`, `progressoDoLote()` e `proximaPorGravar()`
— são reaproveitadas, não reescritas.

### `nfc-fila.js` — o que ele sabe fazer

- `conferirLeitura(lidoDaTag, esperado)` → `'confere'` | `'vazia'` |
  `'outra-peca'` | `'nao-e-vessel'`. É esta função que decide se marca ou não;
  ela é pura, então a decisão é testável sem navegador.
- `codigoDoEndereco(url)` → extrai o código de uma URL do selo, ou `null`.
- `listaParaGravadorDeMesa(pecas)` → **uma URL por linha, coluna única.**
  Nada de separador: assim funciona com qualquer gravador que for comprado, em
  vez de apostar num formato de CSV antes de ter o aparelho na mão.
- `codigosNoTextoDoGravador(texto, pecasDoLote)` → recebe o retorno do gravador
  em QUALQUER formato e extrai os códigos por padrão, devolvendo o que bate com
  o lote e o que ficou de fora. Formato-agnóstico de propósito, pela mesma razão.

### `gravador-nfc.js` — a única porta para o navegador

Envolve `NDEFReader` numa função só, com a implementação injetável para o teste
poder fingir cada falha. Ele expõe:

- `temSuporte()` → o navegador grava NFC? (Chrome no Android sim; iPhone não)
- `lerUmaVez({ sinal })` → o que está na etiqueta agora
- `gravar(endereco)` → escreve
- `travar()` → existe, e a tela só chama com o interruptor ligado

⚠️ **Um limite honesto da trava:** o código dela pode ser testado contra o
`NDEFReader` de mentira, mas **não contra uma etiqueta de verdade sem queimar
uma etiqueta de verdade** — travar é permanente. No dia de ligar o interruptor,
o primeiro teste tem de ser numa etiqueta descartável, nunca numa peça de lote.

### O fluxo na tela

1. Escolhe o lote → a fila mostra progresso e a peça da vez.
2. "Começar a gravar" → a tela pede para encostar a etiqueta.
3. Lê. Se já tiver outra peça → **para** e avisa.
4. Grava. Lê de volta. Compara.
5. Bateu → marca no banco e pula para a próxima sozinha.
   Não bateu → a peça fica na fila, com o motivo em português.
6. Sem Web NFC (iPhone, computador) → a tela continua como hoje: endereço
   grande, copiar, "Gravei essa". A fábrica não pode ficar refém do aparelho.

### As duas mãos, uma fila só

Celular e gravador de mesa bebem da mesma fila e marcam a mesma peça. A tela
exporta a lista de quem falta e importa de volta o que o gravador fez, marcando
em bloco — e dizendo quantos códigos reconheceu e quantos ignorou.

### O que pode dar errado, e o que a tela diz

| situação | o que acontece |
|---|---|
| Navegador sem Web NFC | cai no modo de hoje, sem erro |
| NFC desligado no aparelho | "Ligue o NFC nos ajustes do celular" |
| Etiqueta pequena demais | "Esta etiqueta não tem espaço para o endereço" — peça fica na fila |
| Etiqueta saiu de perto no meio | "Não deu tempo — encoste de novo e segure" — peça fica na fila |
| Etiqueta já gravada com OUTRA peça | **para**, mostra qual peça está lá, não sobrescreve |
| Etiqueta já gravada com ESTA peça | marca como gravada, sem regravar |
| Leitura de volta não bate | não marca, mostra o que veio e o que era esperado |

## Como se prova

- `nfc-fila.js` e `gravador-nfc.js` com teste ao lado (`*.test.mjs`), no padrão
  do projeto. O gravador roda contra um `NDEFReader` de mentira que simula cada
  linha da tabela acima.
- **O teste que importa:** nenhum caminho chama `vessel_marcar_gravada` sem uma
  leitura de volta que confere. É a regra inteira num teste só.
- A tela medida a 375px num navegador de verdade — quem grava está de pé na
  fábrica com o celular na mão.
- ⚠️ `node --test` não abre navegador e não tem `NDEFReader`. Por isso a única
  porta para o navegador é `gravador-nfc.js`: sem essa separação, nada disso
  seria testável.

## Como isso sai daqui depois

As únicas amarras com o iamundi são o **login** e o **`supabase`**, os dois
usados só dentro do `.vue`. `nfc-fila.js` e `gravador-nfc.js` não importam nada
do projeto. Mudar de repositório é copiar a pasta e trocar essas duas — anotado
no `LEIA-ME.txt` da pasta.

## O que NÃO entra neste projeto

O layout de varejo do `/verify`, a Ordem de Produção, o PDV e o espelho CSV dos
registros. São os projetos 2 a 5.

## A divisão dos cinco projetos

| | projeto | onde | depende de |
|---|---|---|---|
| **1** | **Gravar as etiquetas + fila de gravação** ← este documento | Central RBV | nada |
| 2 | `/verify` vira varejo: layout, texto, e a garantia que só começa quando a cliente valida | vessel-brasil | nada |
| 3 | Ordem de Produção gera as etiquetas + data de fabricação | repo de produção | 1 |
| 4 | PDV: passa a etiqueta e registra a venda | repo de produção | 1 e 2 |
| 5 | Espelho CSV dos registros, igual à lista de espera | qualquer um | 2 |

**A regra de negócio que atravessa 2, 3 e 4, e precisa ficar registrada agora:**
a garantia **só começa a contar quando a cliente valida**, não na fabricação nem
na venda para o lojista. No atacado, o lojista compra para revender — a data de
venda só existe quando a cliente final lê a etiqueta e valida.

## Pendências do dono

1. Comprar as etiquetas. Costuradas no forro, longe da ferragem — então NTAG213
   comum serve, sem precisar de etiqueta "on-metal" (mais cara e mais grossa).
2. Um aparelho Android para gravar pelo celular, e o gravador de mesa.
3. `vesselbrasil.com.br` passa a ser compromisso permanente a partir da primeira
   etiqueta gravada.
