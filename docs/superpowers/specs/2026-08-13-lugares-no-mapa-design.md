# Escolher lugar: Brasil, Estado, Cidade e Local — com o mapa dos dois lados

Data: 13/08/2026 · Branch: `lugares-no-mapa` · Worktree: `~/iamundi-lugares-mapa`

## De onde veio

O dono, com estas palavras:

> "Corrigir mapa, eu preciso selecionar entre Brasil, Estado, Cidade e Local
> (estabelecimento, comércio, negócio.) e aparece o pin automático no mapa e
> vice versa, colocar o pin aleatório mostra onde caiu de fato."

São dois pedidos numa frase, e eles puxam para lados opostos:

1. **De cima para baixo** — escolho um lugar pelo nome e o mapa me mostra onde é.
2. **De baixo para cima** — largo um ponto no mapa e o app me diz que lugar é
   aquele.

O mapa de 12/08 (`project_iamundi_mapa_de_pins`) resolveu só metade da metade:
ele põe ponto e mostra ponto, mas o ponto nasce sem nome — um par de números que
não diz nada — e o editor não sabe escolher estado nem país.

## O que foi medido antes de desenhar (13/08/2026)

Tudo abaixo é chamada real, feita na conta do dono, não suposição.

### A Meta não devolve coordenada. Em lugar nenhum.

`GET /search?type=adgeolocation&location_types=["city"]&q=Uberlandia`:

```json
{"key":"273173","name":"Uberlândia","type":"city","country_code":"BR",
 "country_name":"Brasil","region":"Minas Gerais","region_id":449,
 "supports_region":true,"supports_city":true}
```

Chave, nome, estado. **Nem latitude nem longitude.** O mesmo para estado
(`{"key":"449","name":"Minas Gerais","type":"region"}`) e o mesmo na consulta por
chave (`type=adgeolocationmeta`), que devolve o mesmo punhado de campos.

**Consequência que decide o desenho:** "escolhi Uberlândia e caiu um pin no
mapa" **não sai da Meta**. A coordenada tem de vir de outro lugar.

### A Meta não tem busca de estabelecimento.

`GET /search?type=adgeolocation&location_types=["place"]&q=Shopping` →
`{"data":[]}`. O catálogo dela vai até bairro; comércio, loja e ponto comercial
não existem lá.

O que existe é `custom_locations`: coordenada + raio. Ou seja — **"Local" não é
um quinto tipo de chave da Meta; é o ponto no mapa que o editor já grava.**

### De brinde: a busca de cidade devolve bairro sem ser pedida.

Procurando "Uberlandia" com `location_types:["city"]` vieram, junto da cidade,
`Centro` e `Martins` como `type:"neighborhood"`. O filtro não é respeitado. Se
a tela não disser o tipo em cada linha do resultado, o dono acrescenta um bairro
achando que acrescentou uma cidade.

### O OpenStreetMap responde os dois lados. Testado.

Buscar `Shopping Uberlandia`:

```json
{"name":"Center Shopping Uberlândia","lat":"-18.9101557","lon":"-48.2605331",
 "display_name":"Center Shopping Uberlândia, Rua Argentina, Tibery, Setor Leste,
 Uberlândia, Minas Gerais, 38405-174, Brasil","category":"shop","type":"mall"}
```

E o contrário, largando um ponto numa coordenada escolhida no chute
(`-18.9186, -48.2772`):

```json
{"name":"Pernambucanas","display_name":"Pernambucanas, Avenida Afonso Pena,
 Centro, Setor Central, Uberlândia, Minas Gerais, 38400-112, Brasil"}
```

É exatamente o "mostra onde caiu de fato". E é o **mesmo** OpenStreetMap que já
desenha os quadradinhos do mapa desde 12/08 — não é fornecedor novo na casa.

### Não há CSP no caminho

Nem `vercel.json` nem o `index.html` declaram `Content-Security-Policy`, então
nada bloqueia a chamada nova. (Conferido para não descobrir isso só no deploy.)

## As decisões do dono

Perguntadas uma a uma, respondidas por ele:

| Pergunta | Resposta |
|---|---|
| "Estado: Minas Gerais" mira o estado inteiro ou um ponto com raio? | **Os dois — eu escolho na hora** |
| O ponto largado no mapa mostra o quê? | **O endereço por extenso**, e o nome do comércio quando cair em cima de um |
| Entra em que telas? | **Nas duas**: Gestão de Tráfego e "Subir para a Meta" da Fábrica |
| Quem liga para o serviço de mapa? | **A Central liga** (função própria no meio), não o navegador |
| Bairro entra? | **Não** — fora de escopo, ele não pediu |

## O desenho

### A linha de acrescentar lugar

```
[ Brasil ▾ · Estado · Cidade · Local ]   [ digite o nome… ]   [Buscar]
```

- **Brasil / Estado / Cidade** → busca no catálogo da Meta. É ela quem manda em
  quem é "Uberlândia" para fins de anúncio, e a chave dela é o que segmenta.
  Cada linha do resultado **mostra o tipo** (`cidade`, `bairro`, `estado`) —
  por causa do bairro que vem sem ser chamado.
- **Local** → busca no mapa: shopping, loja, esquina, endereço.

### Cada lugar escolhido vira uma linha

```
Uberlândia · MG      [a área inteira ▾]                    remover
Center Shopping…     [ponto com raio: 2 km]                remover
```

**"A área inteira"** e **"ponto com raio"** não são enfeite: são dois mecanismos
diferentes da Meta, e a tradução é esta —

| Escolha | O que vai para a Meta |
|---|---|
| Brasil · área inteira | `geo_locations.countries: ["BR"]` |
| Estado · área inteira | `geo_locations.regions: [{key:"449"}]` |
| Cidade · área inteira | `geo_locations.cities: [{key:"273173"}]`, com o campo de raio que já existe hoje (0 = a cidade inteira) |
| Cidade ou Estado · ponto com raio | `geo_locations.custom_locations: [{latitude, longitude, radius, distance_unit}]` |
| Local | `custom_locations`, com `name` e `address_string` |

**Duas coisas que a tabela decide e é melhor deixar escrito:**

- **Cidade "área inteira" não perde o raio de hoje.** O campo de raio da cidade
  continua onde está e do jeito que está (0 = a cidade inteira; qualquer valor
  acima entra no mínimo de 17 km da Meta). "Ponto com raio" é uma alternativa a
  ele, não um substituto — conjunto que já vem da Meta com raio de cidade
  continua igual.
- **Brasil só tem "área inteira".** Um ponto com raio no centro geográfico do
  Brasil não mira nada que alguém queira; o botão nem aparece para país.

Um efeito colateral que vale ouro e não estava no pedido: **a Meta exige raio
mínimo de 17 km em cidade, mas aceita 1 km em ponto** (medido nos conjuntos da
Mantova). "Cidade · ponto com raio" é o único jeito de mirar 5 km em volta do
centro de uma cidade — hoje impossível no editor.

Trocar de "área inteira" para "ponto com raio" precisa da coordenada do lugar,
que vem do mapa (a Meta não tem). Se essa busca falhar, **o botão fica travado
com o motivo escrito** em vez de gravar um ponto no lugar errado.

### O mapa, dos dois lados

- **Área inteira** aparece como uma **marca chapada, sem círculo em volta** —
  porque raio não existe ali. Um alfinete com círculo diria uma mentira sobre o
  que a Meta vai fazer.
- **Ponto com raio** aparece como o alfinete de hoje, com o círculo.
- O mapa se **enquadra sozinho** no que acabou de ser acrescentado (`enquadrar`
  já existe e já faz isso).
- Área é removida pela linha, não pelo mapa. Clicar no alfinete continua tirando
  o ponto, como hoje.

### O caminho de volta: o ponto que se apresenta

Clicou no mapa → o alfinete cai na hora, com o rótulo `-18.918, -48.277`. Em
seguida, a Central pergunta que lugar é aquele e o rótulo vira
**"Pernambucanas · Av. Afonso Pena · Centro · Uberlândia · MG"**.

Três regras que não são detalhe:

1. **O ponto nasce antes da resposta.** Esperar o nome para desenhar o alfinete
   faria o mapa parecer travado no clique.
2. **Falha não vira silêncio.** Sem resposta, fica a coordenada e a linha diz
   "não consegui o nome deste ponto". Nunca um rótulo vazio, nunca um nome
   inventado — é a lição do 500 que virou R$ 0,00 por 17 horas.
3. **Uma pergunta por vez, na fila.** O serviço é comunitário e pede no máximo
   uma ligação por segundo. Clicar sete vezes seguidas enfileira sete perguntas,
   não dispara sete de uma vez.

### A recepção: a função `buscar-lugar`

Mesmo papel do `meta-proxy`. Ela existe por três motivos, nesta ordem:

1. **Se identifica.** A regra de uso do serviço pede que quem chama diga quem é;
   o navegador não deixa. Sem isso, o dia em que apertarem, a busca morre calada.
2. **Guarda o que já perguntou.** Perguntar "Center Shopping Uberlândia" duas
   vezes não custa duas ligações.
3. **É o único lugar a mexer** se um dia trocarmos de serviço de mapa (Google,
   Mapbox) — decisão que o dono deixou para depois, quando a busca por nome de
   loja tiver errado o bastante na prática para justificar a fatura.

Duas operações só: `buscar(termo)` e `ondeCaiu(lat, lng)`.

**Custo assumido:** Edge Function **não sobe com o push**
(`project_iamundi_edge_deploy`). Publicar na mão faz parte do plano, não é
detalhe de última hora.

## A parte delicada — e a cicatriz que ela repete

`publico-alvo.js` mantém `CHAVES_DE_LOCALIZACAO`: a lista do "eu preservo, mas
não encosto". `countries` e `regions` estão lá dentro hoje. Este trabalho tira os
dois de lá.

O próprio arquivo tem a regra escrita, de sangue:

> Tirar chave daquela lista exige dar a ela um lugar próprio no editor **E**
> fazê-la contar no bloqueio de "sem localização".

Foi o que aconteceu em 12/08 quando `custom_locations` saiu da lista: um conjunto
mirado **só** por ponto passou a contar como "sem localização nenhuma" e o Salvar
morreu — sem o dono ter mudado nada, e sem outra saída a não ser acrescentar uma
cidade que ele nunca quis. O teste que percorre TODO tipo de lugar da lista pegou
na hora.

Portanto, obrigatoriamente:

- `lerPublico` passa a ler `countries` (que são **strings**, `["BR"]`, e não
  objetos com `key` — a forma é diferente das outras e é armadilha) e `regions`.
- `montarTargeting` grava as duas com o mesmo cuidado das cidades: some com a
  chave quando fica vazia, em vez de mandar `[]` (a Meta trata os dois
  diferente).
- `avisosDe` conta país e estado como localização no bloqueio de "sem lugar".
- O teste de "TODO tipo de lugar" cobre os dois casos novos: conjunto mirado só
  por país, e conjunto mirado só por estado.

## As peças

**Novas**

| Arquivo | O que é |
|---|---|
| `src/compartilhado/busca-de-lugar.js` | Puro e testado: monta as perguntas (Meta e mapa) e traduz as duas respostas num formato só. Recebe o `fetch` de fora, para o teste não tocar rede. |
| `src/compartilhado/painel-de-lugares.js` | A linha de acrescentar + a lista. Imperativo e montado num elemento, igual ao `painel-do-mapa.js` — é o que permite a MESMA peça nas duas telas, uma delas Vue e a outra DOM na mão. |
| `supabase/functions/buscar-lugar/` | A recepção. |

**Mexidas**

| Arquivo | O que muda |
|---|---|
| `src/ferramentas/gestao-trafego/publico-alvo.js` | País e estado passam a ser gerenciados (ler, gravar, contar no bloqueio). |
| `src/ferramentas/gestao-trafego/painel-do-mapa.js` | Marca de área (sem círculo) + rótulo que chega depois da resposta. |
| `src/ferramentas/gestao-trafego/tela-de-gestao-trafego.vue` | `_gtPubSecaoLugar` passa a usar o painel novo. |
| `src/ferramentas/meta-ads/painel-subir.vue` | Ganha o painel e o mapa no lugar da busca de cidade solta. |

O mapa (`mapa-de-pins.js`) **não muda**: a aritmética já serve, e marca de área é
só mais um ponto a desenhar.

## O que fica de fora, de propósito

- **Contorno pintado do estado/cidade** (a mancha no mapa). Pesa muito e ajuda
  pouco: a marca com o nome já responde "é aqui mesmo?".
- **Bairro** como quinto tipo. A Meta tem, o dono não pediu, e cada tipo a mais é
  uma decisão a mais em cada lugar acrescentado.
- **Cache do que já foi perguntado ficar no banco.** A função guarda em memória
  primeiro; tabela só se o uso mostrar que precisa.

## Riscos, e o que só se prova ao vivo

**1 · Nome de ponto indo para a Meta — caminho nunca exercitado.**
`pinParaMeta` já manda `name` e `address_string` quando o ponto tem nome, mas
até hoje todo ponto criado pelo mapa nasceu **sem** nome. Ou seja: esse ramo do
código nunca rodou de verdade contra a Meta. Precisa de uma aplicação real, uma
vez, com o dono junto.

**2 · Conferir no Gerenciador.** O mapa de 12/08 está anotado até hoje como "não
provado ao vivo" exatamente aqui. Aplicar num conjunto que está rodando e ver, no
Gerenciador da Meta, que o estado e o ponto ficaram onde deviam.

**3 · O serviço comunitário pode apertar a regra.** A recepção reduz o risco (se
identifica, guarda o que já perguntou) mas não o elimina. Se acontecer, a tela
diz que não conseguiu — não inventa.

## Como se prova

- **Testes automáticos** nos módulos puros — é o que este projeto sabe travar:
  a tradução dos dois sentidos em `busca-de-lugar.js`, e em `publico-alvo.js` o
  ida-e-volta de país e estado mais o "TODO tipo de lugar" já existente.
- **Build limpo** e a guarda de imports por pasta (`imports.test.mjs`), porque
  import esquecido não quebra o build neste projeto.
- **A 375px num navegador de verdade**, que é a régua do `PADRAO-DA-CENTRAL.md`:
  a linha de acrescentar tem quatro tipos, um campo e um botão, e é justamente o
  tipo de linha que estoura no celular.
- **Ao vivo, com o dono**, os dois itens de risco acima.
