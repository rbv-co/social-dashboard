# Frota · a aba Gestão para de mentir, e para de ser feia

Desenho de 19/08/2026. Pedido do dono, em seis partes:

1. o **layout está feio**, no celular **e no computador** — dá pra ser mais
   refinado e minimalista;
2. em **Reservas e retiradas**, melhorar o **contexto e os dados**;
3. carro que fica **definitivo com alguém** não pode dizer *"ainda não voltou"* —
   tem que dizer que está **fixo com fulano**;
4. **solicitação recusada** precisa poder sair da tela, pra limpar espaço;
5. o selo **"sem reserva"** está confuso;
6. no quadro do **Checklist de hoje**, quando não há telefone cadastrado, poder
   **digitar ali mesmo** e já salvar no cadastro da pessoa da central toda;
7. uma seção nova em Gestão com o **histórico de checklists feitos**.

Fora do escopo, por decisão do dono nesta sessão: **multas**.

Uma restrição que ele deixou explícita e que o minimalismo **não** encosta:
**o rabisco da assinatura continua grande no celular.**

---

## O que foi medido antes de desenhar

Nada aqui é suposição. Tudo saiu do banco de produção e da tela no ar, em
19/08/2026.

### O estrago principal, em número

`frota_uso` tem **12 linhas**: **11 são `posse`** (carro fixo com o dono dele,
8 delas abertas) e **1 é `viagem`**. E `linhaDoTempo()`
(`historico-de-reservas.js:329`) percorre **todos** os usos **sem olhar o
`tipo`**.

Rodando o módulo de verdade contra os dados de verdade:

| O que a aba mostra hoje | Quanto |
|---|---|
| Cartões na aba | **13** |
| Destes, que são posse fantasiada de retirada | **11** (85%) |
| Cartões dizendo *"ainda não voltou"* | **8** |
| Cartões dizendo *"motorista não informado"* | **7** |
| Filtro "Sem reserva" | **11** |
| Filtro "Sem assinatura" | **12** |

E a frase do topo, conferida **na tela no ar**, diz:

> *"13 movimentos registrados. **12 retiradas ficaram sem assinatura de quem
> pegou o carro.**"*

**Isso é falso.** Houve **uma** viagem. As outras onze são carros parados na mão
do dono fixo deles. O título fechado da gaveta repete o número: *"Reservas e
retiradas — 12 sem assinatura"*.

⚠️ **Esta é a família de defeito que já custou caro aqui: falha virando número.**
É a irmã do 500 que virou R$ 0,00 por 17 horas e do "criar imagem custa R$ 0". O
dono olha "12 sem assinatura" e conclui que as cópias pro Zoho pararam de sair.

⚠️ **A dívida é conhecida desde 13/08.** A spec
`2026-08-13-frota-gestao-reservas-design.md` já media *"12 retiradas, sendo 7
posses antigas importadas e 5 retiradas reais"* — e mesmo assim a linha do tempo
foi escrita sem separar as duas espécies. Não é descoberta nova; é conta que
ficou aberta.

### O telefone

`acessos_pessoas` guarda telefone em `numero_corporativo` e `numero_pessoal`.
**26 das 31 pessoas não têm nenhum dos dois.**

Entre os donos de carro:

| Dono | Carro | Telefone no cadastro | Telefone na ficha do carro |
|---|---|---|---|
| Breno | BMW X1, VOLVO XC90 | **nenhum** | **nenhum** |
| Humberto Mendonça | VOLVO XC60 | **nenhum** | **nenhum** |
| Raissa Herculano | PORSCHE CAYENNE | **nenhum** | **nenhum** |
| Jeremias Vieira | FIAT DOBLO | nenhum | tem, mas é do *Siqueira* — nome ambíguo |
| Barbara, Marcus, Thiago | Fit, Punto, Fiesta | pessoal preenchido | igual |
| Erick Martins | BRAVO BLACKMOTION | os dois | igual |

O botão que existe hoje (`podeCopiarTelefoneDoCarro`) só sabe **copiar** um
telefone que já esteja na ficha do carro. Para Breno, Humberto e Raissa **não há
o que copiar**, então o botão nunca aparece — e é exatamente esse o buraco que o
dono apontou. Para o Jeremias a regra se recusa a copiar, e **está certa**: o
contato é "Siqueira", que casa com o Thiago.

**A permissão existe.** `numero_corporativo` tem `GRANT UPDATE` para
`authenticated`, e o RLS de `acessos_pessoas` é uma política só
(`acessos_pessoas_rw`, `using` e `with check` = `is_acessos_admin()`). Ou seja:
quem é admin de Colaboradores e Acessos escreve; os outros não. É o mesmo portão
que o botão de copiar já usa.

### Os checklists

**3 fichas** no total (07/08, 14/08 e 17/08), **todas assinadas**, resultados
`liberado` e `com_ressalvas`. A tela **já carrega 120 dias** de
`frota_checklist` (`tela-de-frota.vue:915`) — a seção nova **não precisa de
consulta nova**.

### As reservas

**2 no total**: 1 `aprovada`, 1 `recusada` (motivo escrito: "Duplicado"). Zero
pendentes.

### O layout, olhado na tela no ar

**No computador (1440px):** a grade é de 4 colunas e **a altura de cada linha é
travada pelo cartão mais alto dela**. Na primeira linha, o cartão da BRAVO
ESSENCE (que tem reserva, destino, finalidade e rastro) estica os três vizinhos
— que são posses com três linhas de texto. Sobram **buracos de ~250px** de nada.

Outras coisas medidas na tela:

- **Muro de rosa**: a mesma frase *"Não houve checklist deste carro neste dia:
  não ficou prova nenhuma desta retirada"* aparece **10 vezes**, em caixa rosa,
  na mesma tela. Some quase toda sozinha quando a posse sair da lista.
- **Caixa dentro de caixa**: cada cartão tem borda esquerda colorida + moldura +
  caixa interna colorida. Três molduras pro mesmo conteúdo.
- **Rótulo em caixa alta espaçada repetido**: "O QUE ACONTECEU" em todo cartão,
  "QUEM VAI DIRIGIR / RETIRADA PREVISTA / DEVOLUÇÃO PREVISTA" nos de reserva.
- **Três estilos de botão no mesmo cartão**, em "Veículos do grupo": azul cheio
  ("Abrir ficha"), contorno ("Passar, devolver ou recolher") e verde
  ("WhatsApp"). O azul cheio se repete 10 vezes e puxa a atenção toda.

**No celular (390px):** a barra de abas **quebra em duas linhas** (RELATÓRIOS
sozinho embaixo) e os chips de filtro ocupam **três linhas**.

---

## O desenho

### D1 · Posse é uma terceira espécie de linha, não uma retirada

`linhaDoTempo()` passa a olhar `uso.tipo` e a devolver três espécies:

| `tipo` | O que é | Selo |
|---|---|---|
| `reserva` | alguém pediu o carro | a situação da reserva |
| `retirada` | pegou **sem** reservar antes | "Pegou sem reservar" (ver D3) |
| `posse` | **carro fixo com alguém** | "Carro fixo" |

A linha de posse tem texto próprio, e **nunca** diz "ainda não voltou":

- aberta → *"Fixo com **Humberto Mendonça** desde 06/08."*
- fechada → *"Esteve fixo com **Gabriel Alves** de 11/08 a 12/08."*

**De onde sai o nome.** `uso.pessoa_nome` está nulo em 7 das 11 posses (foram
importadas antes do campo existir). Quando estiver nulo, o nome sai do **dono
fixo do veículo** (`frota_veiculos.pessoa_id`), que é justamente o que a posse
representa. É isso que apaga os 7 *"motorista não informado"*.

Quando não houver nem um nem outro — só o `FIAT BRAVO ESSENCE`, que é de
propósito sem dono fixo —, a frase diz *"sem dono fixo registrado"*, com todas as
letras, em vez de inventar um nome.

**A posse não tem bloco de prova.** Ela não é uma retirada, então não se cobra
dela assinatura de quem pegou: o bloco de assinatura/ficha **não é desenhado**
para linha de posse. É isso que apaga o muro de rosa.

**E o mais importante: posse sai das contas.** `filtrar('sem-assinatura')` e
`resumoDoHistorico()` passam a considerar só `reserva` e `retirada`. A frase do
topo passa a dizer a verdade sobre movimento de carro, não sobre carro parado.

### D2 · O filtro novo, e o que a aba abre mostrando

Nasce o filtro **"Carro fixo"**, com a contagem no próprio botão, como os
outros. Ele é o único que **não** entra no "Tudo" por padrão:

- a aba abre em **Reservas e retiradas** — que é o nome dela — mostrando as 2
  reservas (e a única viagem dentro da aprovada, de onde ela saiu);
- "Carro fixo (11)" é um clique, para quem quiser a fotografia de quem está com
  o quê.

**Por que não simplesmente esconder a posse.** Porque a corrente de posses é
história de verdade: a BRAVO BLACKMOTION passou de ninguém → Gabriel Alves →
Erick Martins entre 06 e 12/08, e isso responde "quem estava com o carro no dia
da multa". Sumir com ela seria trocar um defeito por uma perda.

### D3 · "Sem reserva" ganha nome que se entende

Depois do D1, o selo passa a valer só pra viagem de verdade sem pedido atrás.

⚠️ **E aí aparece o número que explica a confusão inteira: hoje isso é ZERO.**
A única viagem que existe (`BRAVO ESSENCE`, 12/08, Erick) **saiu de uma reserva**
— `retiradaDaReserva()` casa as duas, e ela aparece dentro do cartão da reserva
aprovada. Ou seja: **os 11 "Sem reserva" que o dono está vendo hoje são, todos,
posse.** Não existe hoje uma única retirada avulsa de verdade. O selo estava
confuso porque estava sempre errado.

O selo vira **"Pegou sem reservar"** e o cartão ganha uma linha curta embaixo:
*"O carro saiu sem pedido registrado antes."* Ele passa a aparecer só quando
acontecer de verdade.

O filtro acompanha o mesmo nome. "Sem reserva" some do vocabulário da tela.

### D4 · Recusada sai da tela sem sair do banco

Duas colunas novas em `frota_requisicoes`:

```
arquivada_em   timestamptz
arquivada_por  uuid
```

**A trava mora no banco, não na tela.** Um gatilho `before update` recusa
arquivar o que não estiver em `('recusada','cancelada','revogada')`. Arquivar
uma pendente ou uma aprovada é o banco que barra — do mesmo jeito que
`frota_checar_decisao` (023) e `frota_fechar_posse_orfa` (029) fazem. Invariante
que importa não se guarda em `if` de tela.

Na tela: botão **"Arquivar"** no cartão de recusada/cancelada/revogada; filtro
**"Arquivadas (N)"** pra reabrir; botão **"Desarquivar"** dentro dele. Arquivada
não aparece em "Tudo".

⚠️ **Dois cuidados que já morderam este projeto e são obrigatórios aqui:**

1. **Conferir os GRANTs contra as colunas irmãs.** Em `accounts` uma única
   coluna sem `GRANT` derrubou a linha inteira. As duas colunas novas recebem o
   mesmo tratamento que as vizinhas de `frota_requisicoes`, conferido por
   consulta, não por suposição.
2. **Conferir quantas linhas o update devolveu.** O RLS barra em silêncio e o
   PostgREST responde sucesso com zero linha. "Arquivei" com zero linha afetada
   tem que virar erro na tela, não confirmação.

### D5 · O telefone digitado ali mesmo

No card do "Checklist de hoje", quando `contatoParaCobranca()` devolver
`origem: 'nenhum'`, aparece **campo de telefone + botão Salvar**, gravando em
**`acessos_pessoas.numero_corporativo`** (escolha do dono).

Quem vê: só quem pode escrever no cadastro — o mesmo portão do botão de copiar,
que é o que o RLS permite (`is_acessos_admin()`).

Regras:

- só quando a ficha tem `pessoa_id` de verdade (gente de fora não tem cadastro
  pra receber telefone);
- 10 ou 11 dígitos, guardado só com dígitos, como os que já existem
  (`19998086930`);
- **conferir as linhas devolvidas** — RLS barrando em silêncio não pode virar
  "salvo";
- o botão "copiar do carro" que já existe **continua onde está**, sem mudança.

Destrava, medido: **Breno** (X1 e XC90), **Humberto** (XC60) e **Raissa**
(Cayenne).

### D6 · Gaveta nova: histórico de checklists

Por dia, do mais novo pro mais velho. Cada dia é um agrupamento, e dentro dele
uma linha por ficha: carro, quem fez, hodômetro, resultado e assinatura. Clicar
abre o detalhe que **já existe** (`abrirDetalheChecklist`) — não se cria tela
nova.

Filtros: por carro, por pessoa, e "só com ressalva".

Fechada por padrão (é consulta, não é coisa esperando o dono), com o título
fechado já respondendo: *"3 fichas em 3 dias"*.

**Diz o próprio limite.** A consulta que alimenta a tela traz 120 dias. A seção
escreve isso em letras — *"mostrando os últimos 120 dias"* — em vez de deixar
parecer que aquilo é tudo que existe.

### D7 · O layout: refinado e minimalista

**Uma hierarquia só, de três níveis.** Hoje o cartão fala com seis vozes (selo,
placa, rótulo de dado em caixa alta, ajuda, aviso, rastro). Passa a ser: **título
do cartão → o fato → o rastro**, com o rastro em cinza menor.

**Fim da caixa dentro de caixa.** Sai a moldura interna colorida; separação por
linha fina e respiro. A borda esquerda colorida fica — ela é o estado, e é a
única cor que carrega significado.

**A grade para de travar a altura.** No computador, colunas de altura
independente (`masonry` por coluna via `column-count`, ou `align-items: start`
com cartões de altura própria), pra acabar com os buracos de 250px. Largura
máxima de leitura, pra linha de texto não atravessar 1440px.

**Um estilo de botão principal por cartão.** Em "Veículos do grupo", "Abrir
ficha" é o único cheio; os outros viram texto/contorno discreto. Dez botões
azuis cheios na mesma tela é o que faz a tela gritar.

**Caixa alta espaçada só onde separa seção**, nunca como rótulo de campo dentro
do cartão.

**No celular:** a barra de abas cabe em uma linha (rolagem horizontal se
precisar, nunca quebra) e os chips de filtro em no máximo duas.

⚠️ **O rabisco da assinatura não entra na dieta.** Ele continua grande no
celular — é onde a pessoa assina com o dedo, e encolher ali seria trocar beleza
por uma assinatura que não sai.

---

## O que NÃO muda

- A fila "Aguardando sua decisão" continua separada do histórico. Juntar faria a
  decisão pendente se perder no meio do passado.
- A regra de gaveta (abre sozinha a que tem algo esperando, o título fechado já
  responde) continua como está.
- Editar, cancelar e revogar reserva continuam como estão, atrás do modal que
  exige motivo escrito.
- O `pessoa_id` do veículo continua sendo o **dono fixo**. Não nasce campo novo
  de motorista.
- Multas continuam fora.

---

## Como se prova que ficou certo

1. **Rodar `linhaDoTempo` contra os dados reais** (o mesmo ensaio de
   `medir-historico.mjs` desta sessão) e conferir, número a número:
   - **2** cartões no "Tudo" — as duas reservas. A única viagem aparece **dentro**
     da reserva aprovada, que é de onde ela saiu;
   - **11** no "Carro fixo";
   - **0** no "Pegou sem reservar";
   - **0** dizendo "ainda não voltou";
   - **0** dizendo "motorista não informado" — 10 posses passam a nomear o dono, e
     a do `BRAVO ESSENCE` diz *"sem dono fixo registrado"*, que é a verdade dele.
2. **A frase do topo e o título da gaveta** deixam de citar 12. O número passa a
   contar só movimento de carro.
3. **A trava do arquivar, provada nos dois sentidos**: arquivar uma recusada tem
   que funcionar; arquivar uma pendente tem que ser **recusada pelo banco**. E o
   teste tem de usar `rollback`, nunca desarmar o gatilho.
4. **O telefone**: gravar um número num cadastro vazio e conferir que a linha
   voltou; e conferir que quem não é admin de Acessos **não vê o campo**.
5. **O layout**, medido a 390px e a 1280px: nada estourando pro lado, nenhum
   buraco maior que um cartão na grade, e o `innerText` do cartão conferido pra
   provar que **nada sumiu** no enxugamento.
6. **A tela mostrada ao dono ANTES de subir** — pedido explícito dele nesta
   sessão.

---

## Ordem de execução

A ordem não é gosto: D1 é o que apaga 10 dos cartões da tela, e redesenhar o
layout antes disso seria caprichar em cartão que vai deixar de existir.

1. **D1 + D2 + D3** — a linha do tempo passa a distinguir posse. É o conserto do
   número falso, e é o que esvazia a tela.
2. **D4** — migration do arquivar, com a trava e os GRANTs conferidos.
3. **D5** — o telefone digitado.
4. **D6** — a gaveta do histórico de checklists.
5. **D7** — o refino do layout, agora sobre a tela que sobrou.
6. **Mostrar ao dono**, e só então subir.
