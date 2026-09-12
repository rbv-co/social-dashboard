# Pendências do iamundi

Última revisão: **12/09/2026**

O que é este arquivo: a lista viva do que está **em aberto** no projeto. Cada item
diz o que falta, **por que importa** e **onde** se resolve. É a memória escrita —
se não estiver aqui, some.

Como ler:
- **Parte A — Só o dono resolve.** É clique em painel/tela. Não tem código pra fazer.
- **Parte B — Precisa programar.** Alguém tem que mexer no código.
- **Parte C — Ideias guardadas.** Ninguém pediu ainda; está aqui pra não esquecer.

Cada item tem um código fixo (A1, B3...) pra dar pra citar em conversa.

---

## O que o dono decidiu em 18/08 (para não virar dúvida de novo)

Numa triagem item a item, ele **encerrou** dez itens da Parte A. Fica aqui o
motivo, porque "sumiu da lista" sem explicação é o que faz alguém reabrir o
assunto daqui a um mês:

| Item | Por que saiu |
|---|---|
| A2b · carro sem dono | **É de propósito.** O `OLW4I46` não tem dono fixo por decisão. |
| A2c · seguro vazio nos 10 | **É de propósito.** Não vão preencher valor de seguro. |
| A3 · empresa e local | **FEITO em 18/08.** Os 10 carros têm empresa e local — zero vazios. |
| A12 · Status do Claude | **É de propósito.** O `breno@` não vai receber a permissão. |
| A13 · anúncios parados | Encerrado a pedido dele. |
| A1, A4, A5, A6, A7 | Mandou apagar. Eram os que já estavam fora de recomendação. |
| A2 · 3 donos sem login | Mandou apagar (18/08, à noite). **Não estava resolvido** — ver o aviso abaixo. |
| A3c · teste dos Perfis de Acesso | Mandou apagar (18/08, à noite). **Não estava feito** — ver o aviso abaixo. |

**Correção de dado em 18/08 — o KM da Bravo Blackmotion.** A tela mostrava
**188.000 km**; o certo é **185.359** (o último checklist). A causa: uma ficha de
teste de 07/08, **não assinada**, com o hodômetro digitado acima do real — e a
regra da tela (`ultimoHodometro`) pega o **MAIOR** hodômetro de propósito, porque
"odômetro só anda pra frente". A própria ficha assinada de 17/08 registra o erro:
*"O teste foi feito com o km acima do correto."*

⚠️ **O gotcha, para a próxima vez:** `frota_checklist.hodometro` é **obrigatório**,
então não dá para esvaziar um número errado. As únicas saídas são **corrigir** ou
**apagar** a ficha. O dono escolheu apagar (18/08); a ficha não era assinada,
então não havia prova a destruir e a corrente de códigos não foi tocada — ela
continua ligando 14/08 → 17/08. Foram junto as 15 respostas dela. Cópia do que
foi apagado ficou fora do repositório, no scratchpad da sessão.

**Risco aceito em 18/08 — o token da purga da Fábrica.** Ele apareceu na tela
numa sessão de trabalho. O dono escolheu **tirá-lo do texto puro sem trocá-lo**,
porque trocar exige colar o valor novo em `FABRICA_PURGA_SECRET` no painel do
Supabase, e só ele tem esse privilégio. O token continua conhecido. Se um dia
quiser fechar: gerar um hex de 64, atualizar a linha `fabrica-purga` em
`segredos_de_cron` e colar o mesmo valor no painel — nessa ordem.

⚠️ **A2 e A3c saíram ABERTOS, por decisão da noite de 18/08.** Os dois tinham
trabalho pendente medido, e é justamente por isso que ficam escritos aqui:

- **A2** — Barbara Franco, Marcus Vinicius e Thiago Siqueira **continuam sem
  login**. Os três já têm e-mail na ficha, então o botão *"Dar acesso"* aparece no
  card do checklist de cada carro. Enquanto não houver login, **push nenhum chega
  para eles** e o quadro da aba Gestão é o único canal — por isso quem administra
  a Frota pode preencher o checklist por qualquer carro. Se um dia alguém
  perguntar "por que fulano não recebe aviso do carro dele", **é isto.**
- **A3c** — a ferramenta de Perfis de Acesso **está no ar e nunca foi usada**. O
  roteiro de teste (conta descartável → perfil de teste → conferir que Cancelar
  não muda nada no banco) não foi rodado. Então **o primeiro perfil de verdade é
  também o primeiro teste da trava.** Se algo falhar ao criar um perfil com gente
  dentro, é aqui que a investigação começa.

⚠️ **A2c e A12 tinham número medido contra eles** (10 de 10 carros sem seguro; a
permissão faltando de fato). Não saíram por estarem resolvidos — saíram porque o
dono decidiu que é assim que fica. Se um dia alguém estranhar o custo do carro sair
por baixo, ou você não enxergar o Status do Claude, **é isto, e é intencional.**

---

## Parte A — Só o dono resolve (clique, sem código)

*(Estava vazia em 18/08. Voltou a ter itens em 20/08, com a via de mão dupla
entre Frota e Patrimônio.)*

### A14 · os 9 carros antigos não têm etiqueta de patrimônio
Medido em 20/08/2026: o sistema tem **362 itens, 353 com número**, e os **9 sem
número são exatamente os 9 carros antigos** — nenhum outro item da empresa
ficou de fora. Eles carregam o código `RBB-00X`, que é só da Frota e nenhum
leitor de código lê.

Desde 20/08 carro novo já nasce com número de etiqueta pelos dois caminhos.
Falta o passado: **colar o adesivo nesses 9 e escrever o número na ficha do
carro** (campo "Nº de patrimônio", na ficha do veículo).

Enquanto não for feito, o leitor de código não acha carro nenhum, e o `RBB-00X`
continua sendo a única identificação que eles têm — **por isso ele não foi
aposentado.**

Os 9: VOLVO XC60, FIAT DOBLO, FIAT BRAVO ESSENCE, FIAT BRAVO BLACKMOTION, HONDA
FIT, FORD FIESTA SEDAN, VOLVO XC90, PORSCHE CAYENNE PHEV, BMW X1.
*(O FIAT PUNTO escapou: já tem o nº 14.)*

### A15 · o quarto KWID (item nº 291) está sem placa
Decisão do dono em 20/08: são **quatro KWIDs**, e o item **nº 291** fica sem
placa por enquanto, porque o carro dele ainda não foi levantado. Os outros três
já estão na Frota com os números **298, 299 e 300**.

Enquanto o 291 estiver sem placa, ele é um item do Patrimônio **sem carro na
Frota** — não aparece pra reservar, não entra em checklist e não recebe multa.
Para resolver: abrir o item nº 291 no Patrimônio, preencher a **Placa** e
salvar; o carro nasce na Frota sozinho.

⚠️ A obrigatoriedade da placa vale só pro **cadastro novo**, justamente pra que
este item possa ser editado sem inventar placa. Placa inventada é pior que
placa faltando: ela é UNIQUE, ocupa o lugar de uma real e some sem ninguém
notar.

### A16 · o status de item de veículo volta sozinho, sem avisar
Desde 20/08 o status do carro manda no do item (migration 051). O campo de
status na ficha do Patrimônio **continua editável** — decisão do dono, que
preferiu não travar campo.

A consequência aceita: mexer no status de um item que **tem carro ligado** salva
e o valor **volta ao da Frota, sem nenhum aviso na tela**. Funciona como
desenhado, mas é do tipo silencioso — a família de defeito que mais custou caro
neste projeto.

Não está quebrado e não precisa de conserto agora. Fica escrito para quando
alguém estranhar: **é intencional, e o conserto é uma frase no rodapé** dizendo
que o status veio da Frota, não travar o campo.

---

### A17 · Selo Vessel › subir as fotos das duas bolsas no Bling 🟡 *aberto em 03/09*

O robô das fotos (`coletor/fotos-do-selo-do-bling.mjs`, 8h05 todo dia) está no ar
e funcionando — provado com um lote de teste. Mas **o Bling não tem foto destes
dois produtos**, então ele não acha nada até você subir:

| Bolsa | Produto no Bling | Código |
|---|---|---|
| De Ombro Grande Nice | Bolsa De Ombro Grande Nice Caramelo | `SS1025-Fly Rum` |
| De Mão Média Lódz | Bolsa De Mão Média Lódz Memphis Preto | `SS-1162-Memphis Preto-Fly Olivia` |

Até 4 fotos, e a **ordem importa**: a primeira é a que aparece grande no
certificado. Depois de subir, o robô pega na manhã seguinte — ou é só pedir para
eu rodar na hora.

⚠️ Não é urgente para a etiqueta funcionar: as duas bolsas do lote Nice **já
estão gravadas e no mundo**, e o certificado delas abre normalmente com modelo,
cor e número de série. Só falta a foto.

⚠️ E o Bling está quase sem foto no catálogo em geral: **28 de 100 produtos**, e do
catálogo novo (SS) **3 de 9**. Vale saber antes de esperar que o robô encha todos.

### A18 · Vessel › a descrição da loja nasce escondida numa sanfona 🟡 *aberto em 12/09/2026*

**O que acontece.** Todos os 81 produtos da Shopify TÊM descrição — conferido em
11/09, e os textos batem com o Bling. Mas na página do produto o tema (Prestige
11.4.0, cópia "VESSEL BRASIL V1.0 ERICK") põe o texto dentro de uma sanfona que
nasce FECHADA. A cliente vê só a palavra "Descrição" e precisa clicar.

Para o Google e para quem compartilha o link o texto aparece normal — está no
`<title>`, na meta description, no Open Graph e no JSON-LD. Quem perde é quem
está olhando a página.

**Por que só o dono resolve.** O token da API não alcança o tema:
`403 — This action requires merchant approval for read_themes scope`. Os escopos
que ele tem são `read/write_products`, `read/write_inventory` e `read_locations`.

**Como resolver, o caminho curto (sem código):**
Loja online → Temas → **Personalizar** → abrir uma página de produto → clicar no
bloco **Descrição** na coluna da esquerda → procurar a opção de recolher
(*"Collapse content"* / *"Recolher conteúdo"*) e **desmarcar**.

⚠️ Se essa opção não existir, aí é código — mas **cuidado**: o `<details>` NÃO
está no bloco da descrição, está num trecho compartilhado (`snippets/accordion.liquid`
no Prestige). Pôr `open` lá abriria TODAS as sanfonas da loja. O certo é abrir
só quando vier do bloco de descrição.

Alternativa: liberar `read_themes` e `write_themes` no app, que aí dá para fazer
pela API e provar a 375px.

---

### A19 · Iguatemi › a Astrea Big Caramelo está como RASCUNHO na Shopify, com 4 peças na prateleira 🟡 *aberto em 12/09/2026*

`SS0001EW.B2` — East West Astrea Big Caramelo. **4 peças na loja do Iguatemi** e
o produto está como **rascunho** na Shopify: ninguém consegue comprar online.

É um clique (publicar o produto). Está aqui porque foi o ÚNICO furo em 55
produtos conferidos — o resto do estoque do Iguatemi está correto na Shopify.

⚠️ A conferência só vale porque foi medido que **a Shopify espelha o depósito do
Iguatemi, e não o total**: a Marea Big Caramelo tem 7 no Iguatemi e 15 somando o
Pulmão, e a Shopify mostra 7. Quem comparar com o total vai achar 3 erros que não
existem. Ferramenta: `vessel-brasil/ferramentas/bling-x-shopify.mjs`.

### A20 · Solenne Mostarda e Blanc: zero em todo depósito, e nenhuma venda 🟡 *aberto em 12/09/2026*

O dono disse ter visto uma Solenne mostarda na loja do Iguatemi. Medido:

- `SS0009SB.M3` Solenne Medium Mostarda — **0 nos 7 depósitos**, rascunho na Shopify
- `SS0009SB.M4` Solenne Medium Blanc — igual

E **nenhuma venda**: abertos 1.000 dos 1.052 pedidos de todos os canais dos
últimos 180 dias, nenhum levou esses códigos. Não é caso de ter vendido e não
ter baixado — **essas peças nunca entraram no estoque**.

Se elas estão fisicamente na loja, estão lá **fora do sistema**, e isso é
diferente de estoque errado. Quem for conferir: `ferramentas/procurar-produto-nos-pedidos.mjs`
(ele retoma de onde parou; faltam 52 pedidos).

⚠️ E não existe "Solenne jeans com mostarda" no catálogo — a confusão de nome é
provável: `SS0001SB.B2` é a **Ravelle** Big Jeans e `SS0001SB.B3` a **Ravelle**
Big Mostarda, as duas COM estoque no Iguatemi.

### A21 · 23 produtos sem foto tratada travam o cartão EAN 🟡 *aberto em 12/09/2026*

Dos 86 do catálogo novo, **23 não têm foto tratada publicada** — e sem ela o
cartão sairia com um vazio no lugar da bolsa, então não dá para gerar nem
refazer. É a fila que trava todo o resto do trabalho de cartão.

⚠️ **Quatro deles já têm 10 cartões cada em bolsas, SEM código de barras** —
40 peças que a loja não consegue ler, e que não dá para consertar antes da foto:
`SS0001EW.B2`, `SS0001EW.B3`, `SS0001HB.B2`, `SS0001HB.B3`. Eles não tinham GTIN
no dia em que o cartão foi feito; hoje têm.

Paliativo já entregue em 11/09: o código de barras solto, em PNG sem fundo, no
padrão do cartão — `cartao/codigo-de-barras-solto.mjs`. A lista completa está em
`entregas/cartoes-ean_o-que-falta_*.xlsx`.

### A22 · cinco produtos do catálogo não existem na Shopify 🟡 *aberto em 12/09/2026*

`SS0001BB.M1` (BucketBag Baldinho), `SS0002EW.B1` (East West Coloridas) e as três
`SS00015HB.B1/B2/B3` (HandBag Paris). Têm GTIN no Bling e estão fora da loja
online. Todos com zero no Iguatemi, então não é urgente — mas são cinco anúncios
que nunca foram criados.

### A23 · decidir o que vai para o GS1: só o catálogo novo, ou também o antigo e a LA VESSEL 🟡 *aberto em 12/09/2026*

Varrido o catálogo inteiro do Bling, 1.283 itens com código, um a um:

| Linha | Produtos | Sem GTIN | Ativos sem GTIN |
|---|---|---|---|
| Vessel Brasil (catálogo novo) | 86 | 0 | 0 |
| Catálogo antigo (SS10xx) | 12 | 12 | **12** |
| LA VESSEL | 1.022 | 261 | **84** |
| Insumo, matriz, avulso | 163 | 64 | — (não é produto) |

São **96 bolsas ativas, com preço, sem código de barras nenhum**. O dono pediu a
planilha só do catálogo novo (entregue: `entregas/produtos-vessel_para-o-gs1_*_v2.xlsx`,
com a aba "Sem GTIN" listando as 96).

⚠️ **Prefixo do GS1 é POR EMPRESA.** Se a LA VESSEL tem CNPJ próprio, aqueles 84
não entram na mesma planilha que os 86 da Vessel Brasil. Decisão do dono.


## Parte B — Precisa programar

### B20 · Bling › o `bling-proxy` falha em 2% das chamadas ✅ *fechado em 18/08 — prazo próprio e segunda chance*
Este item **substitui o B7**, que dizia que a causa do erro `546
WORKER_RESOURCE_LIMIT` ainda era hipótese. Medido em 18/08, a hipótese
**envelheceu**: o 546 não aparece em **~8.000 disparos** desde 31/07, nem em 24h
do registro da Supabase. E a suspeita de que "a função roda ~120s" está errada —
o `coletar-dados` roda em **21,4s de média**, com **0 erros** em 29 chamadas.

**O que falha de verdade, hoje**, nas últimas 24h de registro:

| Função | Chamadas | Não-200 | Taxa |
|---|---|---|---|
| **bling-proxy** | 721 | **16** | **2,2%** |
| todas as outras (13) | 626 | 0 | 0% |

Os 16 são: **8 tempos esgotados** (504, batendo em ~30s), **5 recusas por excesso**
(429, o Bling limitando) e **3 não encontrado** (404).

**Por que isso importa mais do que parece:** este projeto já teve falha virando
número — 500 virando R$ 0,00 por 17 horas. O caminho compartilhado
(`src/compartilhado/chamada-do-bling.js`) **já foi endurecido** e hoje levanta o
erro em vez de devolver lista vazia; as telas de dinheiro estão cobertas.

✅ **A parte que era nossa foi consertada em 18/08.** As duas chamadas da Gestão
Comercial engoliam a falha, e o mecanismo era pior do que "um catch mal escrito":
`functions.invoke` **não joga erro**, devolve `{ data: null, error }`, então o
`|| []` transformava queda do Bling em lista vazia. A `gcAbrirItem` **já tinha** o
`try/catch` certo, escrevendo "Não consegui consultar o Bling agora" — e ele nunca
disparava. O usuário lia **"Item não encontrado no Bling"**: uma queda anunciada
como "esse produto não existe", com a mensagem certa escrita e inalcançável.

A regra de leitura virou `resposta-do-bling.js`, com 7 testes, fora do `.vue`
(onde não teria como quebrar teste nenhum). Vazio continua sendo vazio — o item
pode não existir mesmo; o que mudou é que **falha agora sobe**.

✅ **A OUTRA METADE TAMBÉM ERA NOSSA, e foi consertada em 18/08.** O item dizia
que o resto "não era nosso". Remedindo hoje (759 chamadas, 15 falhas, 1,98% —
o número se confirmou), a repartição mostrou o contrário: **8 × 504** (a chamada
pendurada até a plataforma matar em ~30s), **5 × 429** (o Bling limitando, e
respondendo em 762ms) e **2 × 404** (item que não existe — isso é resposta, não
falha). O nosso proxy chamava o Bling **sem prazo próprio e sem tentar de novo**:
uma chamada lenta ficava presa até morrer, e quem estava na tela esperava o meio
minuto inteiro para receber um erro.

**O prazo saiu de medição, não de gosto.** Nas 744 chamadas que deram certo:
p50 1,0s · p90 2,0s · p99 3,9s · a mais lenta 12,7s · só 2 acima de 10s. O prazo
ficou em **11s**, muito acima do p99; o preço é cortar ~1 chamada honesta por
dia, e mesmo essa é repetida e volta em ~1s.

A política mora em `supabase/functions/_shared/tentar-de-novo.js` (16 testes), e
não solta dentro do `.ts`. As três regras: **404 e 403 não se repetem** (são a
resposta do Bling); **só se repete GET** — o único POST é o refresh do token, e
repeti-lo queimaria o token da empresa; e **nunca se começa uma tentativa que não
cabe no tempo**, porque ser morto aos 30s devolve NADA, e "nada" na tela vira
"não sei o que aconteceu". Quando desiste, devolve 504 com frase de gente.

**No ar em 18/08** (bling-proxy v11, pelo MCP). Medido depois de subir: 32
chamadas reais, **todas 200**, média 1,35s.

⚠️ **O que ainda não foi visto acontecer:** uma repetição de verdade. Os 429 vêm
em rajada e os 504 são esporádicos — o efeito só se comprova no próximo episódio,
e ele fica registrado (`[bling-proxy] tentativa N: …`) no log da função.

### B8 · Status do Claude › o gasto da OpenAI ✅ *fechado em 18/08 — o valor está na tela*
Pedido do dono em 27/07. Medido em 18/08, e o item era **maior do que dizia**: a
tela não só omitia a OpenAI — ela **afirmava** que "tarefas que criam imagens não
usam a API paga, então custam R$ 0". A Fábrica gera criativo com **gpt-image-2**,
que é API paga da OpenAI.

**A raiz, e ela é da família que já custou caro aqui:** `ia_execucoes.usd` era
**NOT NULL com padrão 0**. "Não sei" era obrigado a virar "zero". E em JavaScript
`Number(null) === 0` é **true**, então bastava um `Number(e.usd) === 0` espalhado
pela tela para a mentira se recompor sozinha.

**Feito em 18/08:**
- A coluna aceita **nulo** = "ainda não se sabe". Zero passou a significar só o
  que significa: não custou mesmo
- As **26 execuções** da Fábrica (473 criativos) foram corrigidas de R$ 0 para
  "não sei", e ganharam o nome do motor. As outras tarefas da Fábrica (subir,
  excluir, preview) continuam zero — essas não chamam IA nenhuma
- `coletor/lib/custo-da-execucao.mjs` (7 testes): motor da Anthropic calcula;
  motor pago de fora, ou **motor novo que ninguém precificou**, devolve nulo
- `src/ferramentas/claude-status/custo-do-extrato.js` (8 testes): as três
  situações, e a segmentação por fornecedor
- A legenda da tela foi reescrita e agora diz a verdade, inclusive que **estava
  errada até 18/08**

**O que a tela mostra agora**, medido no banco: nos últimos 30 dias há
**US$ 24,79 conhecidos** e **23 execuções · 397 imagens sem custo conhecido**,
todas de `gpt-image-2`. Antes, essas 397 apareciam como R$ 0.

💰 **QUANTO ERA, afinal — medido em 18/08 com a chave do dono:**
**US$ 98,71 em 60 dias** (≈ R$ 542,90 ao câmbio de 5,5), em **19 dias com gasto**.
Os picos — 16/07 (US$ 29,29), 21/07 (US$ 24,89), 17/07 (US$ 15,86) — caem
exatamente dentro da janela em que a Fábrica rodou (13/07 a 29/07). **Era isto que
a tela mostrava como R$ 0,00.**

✅ **A chave já está no cofre** (`openai_admin_key`, 133 caracteres, formato
`sk-admin`), guardada em 18/08 e provada contra o relatório de custos (HTTP 200).
Ela nunca passou pela transcrição da sessão: o dono a deixou como **nome de uma
pasta no Downloads**, e ela foi lida do disco direto para o cofre.

✅ **A pasta do Downloads foi apagada em 18/08**, depois de conferir que a chave
já estava no cofre (133 caracteres, formato `sk-admin`). Nome de pasta é texto
puro — aparece em listagem, captura de tela e backup. Não sobrou vestígio no
histórico do terminal nem no Lixo.

✅ **FECHADO em 18/08: o valor está na tela.**
- **Edge Function `custo-openai`** (172 linhas), irmã da `custo-anthropic`:
  mesma segurança (verify_jwt + só admin), lê `openai_admin_key` do cofre.
  **Subiu pelo MCP** — a trava do deploy era da CLI (conta errada, 403), e o MCP
  nunca dependeu dela. Não era preciso esperar o B14.
- **A pegadinha que mudaria o valor em 100×:** na Anthropic o `amount` vem em
  CENTAVOS; na OpenAI, `amount.value` vem em DÓLARES. Medido contra a API antes
  de escrever: 90 dias = **US$ 98,71**, o mesmo número da medição manual.
- **A OpenAI dá o que a Anthropic não dá:** custo REAL por chave de API
  (`group_by=api_key_id`). O "quem gastou" da OpenAI é a conta de verdade, não
  um rateio — e a tela diz essa diferença em letras.
- **Na tela:** o número grande do topo virou **gasto real de IA** (as duas contas
  somadas), com Anthropic e OpenAI discriminadas embaixo; o Extrato ganhou os dois
  cards e mais dois detalhamentos ("para onde o dinheiro foi" e "quem gastou", da
  OpenAI). A legenda que dizia *"falta a chave"* foi reescrita.
- **A soma tem teste** (`somarFornecedores`, 4 casos): fornecedor que falhou
  **não entra como zero** — o total se declara *parcial* e diz quem faltou. Sem
  isso, uma falha de rede viraria um total menor com cara de número exato, que é
  a mesma família de defeito que este item veio consertar.

**O que ainda NÃO se sabe, e continua honesto na tela:** quanto custou **cada
execução** da Fábrica. A OpenAI não dá custo por chamada; só por dia, modelo e
chave. As 23 execuções seguem marcadas como *"custo ainda não conhecido"*.

---

### B21 · Status da IA › o caminho feliz da `custo-openai` v2 não foi visto rodar ⚠️ *aberto em 19/08*
A função subiu com prazo próprio (8s), até 3 tentativas e registro do motivo — o
mesmo remédio do B20. O que **não** deu para provar: a chamada de verdade, com um
admin logado. Ela exige JWT de administrador, e copiar a sessão do dono derruba o
painel dele (o token rotaciona), então a prova parou no 401 de porta fechada.

**Como fechar, em um minuto:** o dono abre o Status da IA e olha o número grande do
topo. Se aparecer "R$ …" com Anthropic e OpenAI embaixo, está fechado. Se aparecer
"Não consegui puxar a conta da OpenAI", agora o motivo fica escrito no registro da
função (`[custo-openai] …`) — e aí dá para saber, pela primeira vez, se é limite de
taxa, queda ou chave vencida.

⚠️ **A causa dos 3 erros em 26 chamadas (11,5%) segue sendo HIPÓTESE.** O suspeito
é limite de taxa em rajada: os 500 vinham em PAR, das duas janelas que a tela pedia
ao mesmo tempo. As duas coisas que atacariam isso já foram feitas (a tela parou de
perguntar quatro vezes por minuto; a função tenta de novo), mas o que confirma é o
próximo episódio no registro.

### B22 · `bling-proxy` no ar está com uma cópia anterior do `tentar-de-novo.js` 🟡 *aberto em 19/08*
Ao reaproveitar a política de repetição para a OpenAI, o arquivo
`_shared/tentar-de-novo.js` ganhou três parâmetros novos (fornecedor, prazo,
orçamento), **todos com o valor antigo como padrão** — os 19 testes provam que
quem não passa nada continua tendo exatamente o comportamento de antes.

O `bling-proxy` v11, que está no ar, subiu com a cópia de 18/08 embutida. O
comportamento dele é idêntico, então **não há defeito** — o que há é código do
repositório diferente do código no ar, e isso é o tipo de coisa que morde daqui a
três meses. Fecha sozinho no próximo deploy da `bling-proxy`; não vale subir só
por isso, porque ela acabou de ser estabilizada.

### B23 · Barra de Topo › o lado das ações não encolhia ✅ *fechado em 20/08*

**O que era.** `.bt-dir` — o lado direito da `barra-de-topo`, onde as ações
moram — era `flex: 0 0 auto`. Ela reservava sempre o *conteúdo máximo* dos
filhos, e o `.bt-meio` (título + subtítulo) ficava com o que sobrasse. Nas telas
de faixa larga o título era esmagado até zerar. Medido a 768px, antes:

| Tela | altura da barra | título |
|---|---|---|
| Gestão à Vista | 732px | 0px, **19 linhas** |
| Análise de Campanhas | 685px | 0px, 18 linhas |
| Gestão de Tráfego | 632px | 0px, 15 linhas |
| Análise de Vendas | 513px | 0px, 15 linhas |

Uma letra por linha, e a barra comendo 600–700px de uma tela de 900px. Não era
um caso extremo: era o estado normal dessas quatro telas em tablet.

**O conserto.** `flex: 0 1 auto; min-width: 0` em `.bt-dir`. As mesmas quatro
telas passam a ter barra de 93 a 108px e título em 2 linhas legíveis.

**Conferido nas 25 telas que usam a barra**, em 7 larguras (1920, 1440, 1280,
1024, 768, 640, 375), comparando antes × depois na mesma página: **6 melhoraram,
19 ficaram idênticas, nenhuma piorou.** O único custo são 26–27px a mais de
barra a 1024px na Análise de Campanhas e na Gestão de Tráfego, onde a faixa de
controles passa a quebrar em duas fileiras em vez de esmagar o título — que é
exatamente o que esta barra promete fazer.

⚠️ **A regra nova para quem puser faixa larga na barra:** o que não encolhe não
fica menor, **vaza para fora da barra**. Uma régua de botões precisa de
`min-width: 0` e `overflow-x: auto`. A Análise de Campanhas não tinha e ficou com
três botões pendurados 17px além da borda; foi corrigida junto.

### B24 · Separação atacado/varejo ✅ *fechada em 20-21/08 — as quatro peças no ar*

Cada canal do Bling tem um **grupo** (`bling_lojas.grupo`), configurável em
**Config de Admin › Canais de venda**. O grupo é do CANAL, não do time: dos 14
canais só 3 têm time, e o time herda pelo `canal_loja_id`.

| Peça | O que entrou |
|---|---|
| 1 | a coluna, a política de escrita e a tela de configuração |
| 2 | o seletor das dashboards com um bloco por grupo e marcar/desmarcar todos |
| 4 | os cards de time da gestão de usuários sob cabeçalho de grupo |
| 3 | **o alcance da supervisora**, nas três camadas |

**A regra da Peça 3:** supervisora vê todos os canais do **grupo** dos times onde
ela é supervisora; **gestor** (a "gerente" da fala do dono) e **vendedora** seguem
vendo só a loja delas. Canal sem grupo **não amplia nada** — e isso jamais pode
virar "vê tudo".

Entrou nos três lugares, porque só na tela não vale (o front é público):
`_shared/canais-de-venda-permitidos.js`, a edge `bling-proxy` e `pode_ver_canal`.
Provado no banco com a trava armada, dentro de `rollback`, nos quatro cenários —
`docs/provar-alcance-da-supervisora.sql`.

⚠️ **Hoje isso não muda nada para ninguém:** os 4 membros de time são todos
`vendedora` e nenhum canal tem grupo. A regra só passa a valer quando o dono
marcar os grupos e promover alguém a supervisora.

**O estoque não entrou.** `pode_ver_estoque` tem regra própria e mais apertada
("estar no time não basta"), escrita de propósito.

⚠️ **Achado de segurança que continua aberto:** existem **dois "superadmin"** —
a coluna `profiles.is_superadmin`, que é o que a tela usa, e a função
`public.is_superadmin()`, que confere o e-mail contra uma **lista de três cravada
no código**. Hoje concordam. Se alguém marcar a coluna para uma quarta pessoa,
divergem, e essa pessoa vê telas onde não consegue salvar. Unificar é decisão do
dono.

### B25 · A `bling-proxy` ficou fora do ar por alguns minutos em 21/08 ✅ *fechado no mesmo dia*

**O que houve.** Ao subir a Peça 3, a edge ganhou uma variável `canais`… e já
havia um `const canais` logo abaixo, com o resultado de `canaisDoEscopo`.
`Identifier 'canais' has already been declared`. A função entrou em BOOT_ERROR —
**503 em toda chamada** — e com ela as duas dashboards de venda, porque é a
`bling-proxy` que busca os pedidos no Bling. Foi por volta de meia-noite (03:00Z),
a janela mais vazia, e durou poucos minutos até o conserto.

**Por que passou.** `npm test` roda os `.js` de regra do `_shared` e `npm run
build` compila o `src/`. **Nenhum dos dois olhava os `index.ts` das edges** — e
elas não sobem com push, vão à mão. Dava para ter suíte verde, build limpo,
subir, e só descobrir no primeiro clique.

**O que fechou o buraco.** `supabase/functions/toda-edge-compila.test.mjs`, irmã
de `todo-vue-compila.test.mjs`: manda cada `.ts`/`.js` das edges pelo esbuild só
para parsear. Foi conferido que ela REPROVA o defeito real — o `canais`
duplicado foi reintroduzido de propósito e ela pegou.

⚠️ **A regra que fica:** depois de subir edge, **chamar a função** e conferir que
volta o erro da PRÓPRIA função (aqui, `401 "nao autenticado"`) e não o `503
BOOT_ERROR` da plataforma. Deploy que não boota só aparece no primeiro clique.

---

### B25 · Frota › o aviso de reserva decidida 🟡 *banco e servidor prontos em 21/08; falta o deploy da tela*

**O que é.** Aprovar ou recusar uma reserva não avisava ninguém — quem pediu só
descobria abrindo o app.

**Já está feito (21/08):**

- ✅ **Migration `052_push_tipo_reserva.sql` aplicada.** O CHECK de
  `push_preferencias.tipo` aceita `frota_reserva`. Provado com `rollback`:
  dentro da transação o insert passou, e o banco ficou com zero linha do tipo.
- ✅ **Edge `avisar-decisao-de-reserva` publicada** (com as três deps de
  `_shared`). Provada rodando: chamada sem crachá é barrada pela porta de fora
  (401), e com o crachá de quem não aprova ela mesma responde
  `{"ok":false,"erro":"sem_permissao"}` — ou seja, o portão do servidor fecha,
  e não só o da tela.

**Falta:**

1. **Subir a tela** (as mudanças estão na branch `melhoria/frota-retirada-e-tutorial`,
   não na main). Enquanto não subir, o interruptor novo não aparece e a tela não
   chama a função — nada muda para ninguém.
2. Depois disso, ligar **"Resposta do pedido de carro"** em Administração ›
   Usuários para quem pede carro — ela nasce desligada, como toda chave nova.

**Não há risco em ficar como está.** Provado na tela nos dois desfechos: com a
função fora do ar, a decisão é gravada do mesmo jeito e quem decidiu lê *"Reserva
aprovada. Não consegui avisar quem pediu — fale com a pessoa."* Já é melhor que
hoje, que é silêncio.

**Alcance medido em 20/08:** das 14 pessoas que podem pedir carro, **8 têm
aparelho registrado** para push. WhatsApp alcançaria 6, e 2 dessas nem ficha de
colaborador têm — o push é o melhor canal único. As 6 restantes continuam
dependendo de alguém avisar, e é por isso que a tela diz isso a quem decide.

### B26 · Vessel › a vitrine da Shopify não se atualiza sozinha 🟡 *aberto em 11/09/2026*

**O que está acontecendo.** Duas coisas, ligadas, e as duas paradas no tempo:

1. **O estoque na Shopify está congelado em 11/09.** A sincronização
   `Estoque Loja Iguatemi` (Bling, depósito `14888726277`) → local
   `Vessel Shopping Iguatemi` (Shopify) foi feita **uma vez, na mão**. Não
   existe nada de Shopify no `coletor/` — nenhum robô repete isso.
2. **13 produtos estão em rascunho só por falta de estoque**, e têm foto certa.
   Quando entrar estoque eles **não voltam a ativo sozinhos** — alguém tem que
   virar a chave, e hoje ninguém vira.

**Por que importa.** Peça que chega na loja não aparece na vitrine, e peça que
acaba continua à venda. Os dois erros custam dinheiro, em direções opostas.

**Onde se resolve.** Um robô de hora em hora, no padrão do
`fotos-do-selo.yml`: espelha o saldo por SKU exato e depois aplica a regra
*tem foto E tem saldo → ativo; sem foto OU sem saldo → rascunho*.

⚠️ **As travas que já custaram caro, para quem for fazer:**
- `catálogo novo = começa com SS e NÃO tem hífen`. A regra mais estreita
  (`SS0004HB.B2`) **descartou os 4 lenços em silêncio** — `SS0003L.1` não tem o
  par letra+dígito no fim. Foram 43 peças fora da sincronia, sem um aviso.
- SKU que não casa dos dois lados é **relatado, nunca adivinhado**.
- `--seco` (mostra sem escrever) é o padrão quando falta o local ou o token.

**⏸️ PARADO A PEDIDO DO DONO em 11/09/2026** — "vamos deixar por enquanto".
A decisão que ficou em aberto, e que trava o desenho: se alguém puser um produto
em rascunho **de propósito** (saindo de linha, segurando um lançamento), o robô
reativaria sozinho quando entrasse estoque. As três saídas discutidas foram:
etiqueta `nao-mexer` que o robô respeita; esconder sozinho mas só *avisar* o que
poderia voltar; ou automático puro.

---

### B27 · Vessel › a família Cyrène/Evening está sem medida no Bling 🟡 *aberto em 12/09/2026*

**O que falta.** Largura e altura, em centímetros, da **Shoulder Cyrène Medium**.
Só o dono tem esse número — não existe de onde ler.

**Por que importa.** Duas coisas travam nisso:

1. **A capa das duas Evening** (`SS0002SB.M1` Café e `SS0002SB.M2` Marfim) ficou
   de fora da escada de tamanho, publicada em 12/09. As outras 49 capas do
   catálogo passaram a ocupar o quadro em proporção ao tamanho real da bolsa;
   essas duas seguem em 82%, o valor antigo.
2. **A descrição das três não traz medida nenhuma** — `.M1`, `.M2` e `.P1`. O
   cliente que abre a página não sabe o tamanho da bolsa.

⚠️ **Não dá para deduzir.** Nas outras cinco peças sem medida eu resolvi lendo as
IRMÃS da mesma família e mesmo tamanho (Oriane Big 26x20, Lunea Medium 21x15).
Na Cyrène **a família inteira está vazia**, então não há irmã para ler.

⚠️ **E "Medium" não resolve.** O dono respondeu "a Evening é medium", mas a
escada é por CENTÍMETRO, não por classe — justamente porque as classes se
sobrepõem (ver B28). Medium sozinho não dá número.

**Onde se resolve.** Com o número na mão, são duas escritas na mesma rodada:
a capa (reenquadrar na ocupação da medida) e a `descricaoCurta` das três,
acrescentando o bloco de dimensões no padrão das outras famílias.

---

### B28 · Vessel › peças sem foto que dariam para montar de outro tamanho 🟡 *aberto em 12/09/2026*

**A técnica já está provada.** Em 12/09 três peças que não tinham foto nenhuma
ganharam catálogo a partir da MESMA COR NOUTRO TAMANHO:

    Linear Big Blanc       <- fotos da Linear Medium Branca
    Linear Big Chocolate   <- fotos da Linear Medium Chocolate
    Linear Big Caramelo    <- fotos da Linear Medium Caramelo
    Ravelle Small Mostarda <- fotos da Ravelle Big Mostarda

Funciona porque a bolsa é a mesma peça em escala, e a ocupação do quadro passou
a ser calculada pela medida real — então a foto montada já entra no tamanho
certo da grade.

**O que falta.** Varrer as peças sem foto e listar quais têm irmã da mesma cor
noutro tamanho. Essas são candidatas a montar sem ensaio novo. As que não têm
irmã continuam dependendo de estúdio.

⚠️ **Cada peça montada merece o olho do dono antes de publicar.** Duas coisas
podem sair erradas, e as duas já apareceram:
- **proporção**: Big e Medium costumam ter proporção parecida, mas a Small pode
  ser outra forma (a Linear Small é 19x15 contra 24x17 da Medium — mais
  quadrada). Montar Small de Medium distorce.
- **diferença de peça**: a Linear Small não tem o bolso das costas que a Medium
  tem. Foi preciso removê-lo com IA, foto a foto.

⚠️ **A ESCADA DE TAMANHO, para quem for mexer nas fotos depois.** A capa de cada
produto ocupa o quadro em proporção ao MAIOR LADO em cm, de 70% (21cm) a 86%
(60cm), pela raiz — o olho compara área, não comprimento. As fotos 2 em diante
ficaram todas em 82%.

⚠️ **NÃO usar Small/Medium/Big para isso.** Medido em 12/09: as classes se
sobrepõem (Small vai a 50cm, Big começa em 23cm). Escalar pelo nome faria a
grade MENTIR — mostraria uma Small de 50cm menor que uma Big de 23cm.

---

### B29 · Cartões EAN › o robô da fila 🟡 *aberto em 12/09/2026*

A aba "Cartões EAN" está no ar e manda pedido; a fila `vessel_cartao_pedidos`
existe no banco. **Falta quem atende.** Hoje o pedido entra e ninguém pega.

O que já está pronto e é para REAPROVEITAR, não reconstruir:

- **desenhar e exportar** — `cartao/exportar.mjs`, que roda fora do Mac. Provado
  em 8 produtos contra o `exportar.sh` (o do Quartz): mesmo tamanho 2042×1300,
  desenho no mesmo lugar (1 px = 0,04 mm), código de barras lido da imagem;
- **subir no Zoho** — `coletor/lib/zoho-workdrive.mjs` (`acharOuCriarPasta` +
  `uploadArquivo`), que a Fábrica de Anúncios já usa do GitHub Actions com os
  segredos configurados;
- **pegar e devolver** — `vessel_cartao_pegar_da_fila()` e
  `vessel_cartao_pedido_terminou()`, já no banco, só para `service_role`.

Falta amarrar os três num workflow e criar o gatilho que acorda o robô quando o
pedido entra (o molde é `vessel_lote_novo_pede_foto`, que já faz isso para as
fotos, com o segredo em `segredos_de_cron`).

⚠️ `cartao_gerado_em` é marcado **só nas peças que o robô confirma**. Marcar o
pedido inteiro deixaria a marca mentindo nas que falharam no meio — e é ela que
PRENDE o número de série.

### B30 · Cartões EAN › 280 cartões a refazer 🟡 *aberto em 12/09/2026 — espera o B29*

Dos 86 produtos: **35 prontos, 27 para refazer (saíram em 300 dpi em vez de 600),
1 sem código de barras, 23 travados sem foto** (ver A21).

Os 27 de meia resolução leem, mas a barra fica com 3,1 px — e a 300 dpi o código
de barras não perdoa arredondamento. Alguma rodada saiu com o `DPI=` trocado; a
pasta do Zoho tem as duas resoluções misturadas.

Assim que o robô do B29 estiver de pé, isto é marcar as peças na aba e mandar.
Medido por `ferramentas/o-que-falta-de-cartao.mjs`, que abre cada cartão e LÊ o
código de barras — "tem pasta de cartão" não é "tem cartão bom", e foi assim que
os 5 sem código passaram batido por três semanas.


## Parte C — Ideias guardadas (ninguém pediu ainda)

### C2 · Gestor de Tráfego › subir campanha por upload 🟡 *metade já está de pé — conferido em 18/08*
Ideia do dono (12/07). **Conferido no código em 18/08, e a premissa mudou: o
upload de UM arquivo já existe e funciona.**

**O que já está no ar** (`_gtNovoEnviarImagem`, na tela da Gestão de Tráfego):
escolher um arquivo → Storage do projeto → Meta → hash. Aceita PNG, JPEG, MP4 e
MOV. Vídeo segue outro caminho de propósito (quem baixa é a Meta, pelo `file_url`,
porque dezenas de MB estourariam o limite da função). Confere o tamanho **antes**
de subir (`imagemServe`), porque descobrir que a Meta recusa depois do upload é o
pior momento. Provado em `validar-envio-de-imagem.mjs` (4/4).

**O que falta, e é o que sobra do C2:**
1. **Em massa.** O seletor não tem `multiple` — é um arquivo por vez.
2. **Normalizar o formato sozinho.** Hoje `imagemServe` só **recusa** o que não
   serve. O pedido era converter: PNG→JPG, achatar transparência e redimensionar
   para Feed 1:1 e Story 9:16. Nada disso existe.

Reaproveitar, não reconstruir: `fabrica_objetivos`, `criarCampanhaNova` e
`coletor/lib/meta-subir.mjs` já fazem a subida.

## Como manter esta lista

- Item que fecha **sai** daqui (a história fica no commit e nos planos de
  `docs/superpowers/`). Não deixar item morto ocupando espaço.
- Item que o dono **adia** fica, com a data e o motivo — como o A7 e o A9.
- Item novo entra com **o porquê**, não só o quê. "Falta X" sem o motivo vira
  item que ninguém entende em duas semanas.
- Ao encostar num assunto, reler o item aqui **antes** — vários guardam um
  cuidado que já custou caro (o "Marca" do A3, o `pages_manage_posts` do A7, o
  `balance` do C1).
