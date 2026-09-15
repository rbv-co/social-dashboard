# Pendências do iamundi

Última revisão: **15/09/2026** — revisão item a item com o dono, tudo medido.
**Restaram 3 pendências.**

O que é este arquivo: a lista viva do que está **em aberto** no projeto. Cada item
diz o que falta, **por que importa** e **onde** se resolve. É a memória escrita —
se não estiver aqui, some.

Como ler:
- **Parte A — Só o dono resolve.** É clique em painel/tela. Não tem código pra fazer.
- **Parte B — Precisa programar.** Alguém tem que mexer no código.

Cada item tem um código fixo (A1, B2...) pra dar pra citar em conversa. Os
códigos **não são renumerados** quando um item sai: assim, A2 é sempre o mesmo
A2 em qualquer conversa antiga.

*(Havia uma Parte C, de ideias guardadas. Ficou vazia no repasse de 14/09 e saiu
— ideia que ninguém pede há dois meses não é pendência.)*

---

## Os códigos foram renumerados em 15/09/2026

A lista tinha códigos de A14 a B33 com buracos no meio (os itens fechados foram
saindo e o número ficava). Ficou difícil de ler. A pedido do dono, foram
renumerados em sequência: **A1 a A5** e **B1 a B8**.

⚠️ **Na mesma revisão, a maioria desses itens saiu** — sobraram **A1, B4 e B7**.
Então a sequência já nasceu com buracos de novo, e é assim mesmo: buraco é o
preço de o código ser estável. A tabela abaixo continua valendo para ler
conversa antiga.

**Se você está lendo uma conversa ou um commit de antes de 15/09, é por aqui:**

| Era | Virou | Assunto |
|---|---|---|
| A14 | **A1** | etiqueta de patrimônio nos 9 carros antigos |
| A19 | **A2** | a Astrea Big Caramelo, 4 peças paradas |
| A21 | **A3** | 23 produtos sem foto tratada |
| A23 | **A4** | decidir o que vai para o GS1 |
| A25 *(era B25)* | **A5** | ligar o aviso de reserva de carro |
| B26 | **B1** | o robô da vitrine da Shopify |
| B27 | **B2** | usar a medida da Cyrène |
| B28 | **B3** | montar foto a partir de outro tamanho |
| B29 | **B4** | o robô da fila do cartão EAN |
| B30 | **B5** | os 280 cartões a refazer — *fundido no B4 em 15/09; o número B5 não se reaproveita* |
| B31 | **B6** | a tela de cadastro do valor corrigido |
| B32 | **B7** | endireitar as alças tortas |
| B33 | **B8** | os 306 retoques — *fundido no B7 em 15/09; o número B8 não se reaproveita* |

⚠️ **Os códigos dos itens que SAÍRAM não foram mexidos** — na tabela do repasse,
logo abaixo, A15, A17, A18, A20, A22, B21, B22 e C2 são os nomes de quando eles
ainda existiam. Eles não vão voltar, então não entram na sequência nova.

⚠️ **E a regra mudou junto:** de agora em diante, item que sai **deixa buraco** e
o número **não é reaproveitado** — o A2 e o A3 saíram em 15/09 e ninguém vai
herdar esses números. Foi
renumerar uma vez, não virar hábito: renumerar toda semana faria toda conversa
antiga apontar para o item errado.

---

## O que saiu da lista em 14 e 15/09/2026

Repassei os itens **um a um, medindo cada um** (banco, Bling, Shopify, código no
ar, disco). **A lista foi de 24 itens para 3.** Fica aqui o motivo de cada saída,
porque "sumiu da lista" sem explicação é o que faz alguém reabrir o assunto daqui
a um mês.

**Quatro estavam RESOLVIDOS:**

| Item | Por que saiu | Como eu provei |
|---|---|---|
| A15 · o KWID 291 sem placa | Ele tem placa `RUJ5B81` e já nasceu na Frota (está como *inativo*). | Consulta no banco cruzando `patrimonio_bens` com `frota_veiculos` pelo `bem_id`. |
| A24 · os originais 2160×2880 não abriam | A pasta do Zoho voltou a abrir para o terminal. | Abri `Alba_Gray_Alca.png`: responde **2160×2880**, com soma de verificação — não é só o nome na lista. |
| B22 · cópia antiga do `tentar-de-novo.js` | Fechou sozinho no deploy seguinte, como estava previsto. | O `bling-proxy` do repositório importa de `_shared/tentar-de-novo.js`, e a função foi republicada (**v23, 04/09**). |
| B25 · Frota, o aviso de reserva | A parte de código ACABOU; o que resta é clique. Virou o **A5**, na Parte A. | A branch `melhoria/frota-retirada-e-tutorial` está na `main`, e a chamada aparece em `origin/main`. |

**Quinze saíram por decisão do dono** — na triagem de 14/09, no pente fino e na
revisão item a item de 15/09. Em quase todas há uma **consequência aceita**: não
é que o problema tenha sumido, é que se decidiu conviver com ele. Está escrito em
cada linha, para ninguém redescobrir daqui a três meses achando que é defeito
novo: O filtro foi
"alguém ainda tem que FAZER alguma coisa?", e estes não passaram:

| Item | Por que saiu |
|---|---|
| A16 · status do veículo volta sozinho | O próprio texto dizia que **não está quebrado e não precisa de conserto**. Era nota, não tarefa. O comportamento segue igual e é intencional: mexer no status de um item com carro ligado salva e o valor volta ao da Frota, sem aviso. |
| A17 · fotos das duas bolsas no Bling | **A tarefa era impossível como estava escrita.** Varri os 1.700 produtos do Bling: `SS1025-Fly Rum` e `SS-1162-Memphis Preto-Fly Olivia` **não existem**. O que existe é a família `LV1025` (Nice: Gergelim, Panacota, Preto) e `LV1162` (Lódz: sete cores). Se um dia se souber qual é o produto certo, o item volta — o robô das 8h05 continua de pé. As duas bolsas do lote Nice já estão gravadas e o certificado abre. |
| A20 · Solenne Mostarda e Blanc | **Nunca entraram no estoque:** 0 nos 7 depósitos e nenhuma venda em 1.000 pedidos de 180 dias. Não é dado errado no sistema — se as peças estão na loja, estão lá fora dele, e isso é assunto de loja. *(Cuidado com o nome: `SS0001SB.B2/B3` são a **Ravelle** Big Jeans e Mostarda, essas com estoque.)* Ficam hoje ATIVAS na Shopify com saldo zero. |
| A22 · cinco produtos fora da Shopify | `SS0001BB.M1`, `SS0002EW.B1` e as três `SS00015HB.B1/B2/B3`. Todos com **zero no Iguatemi** — são cinco anúncios que nunca foram criados, e ninguém compra por eles. |
| B21 · a `custo-openai` nunca vista rodar | **Não era defeito, era uma prova que faltou.** A função está na v6 de 19/08 e o motivo do erro agora fica escrito no registro. Quem quiser fechar, abre o Status da IA e olha o número do topo. |
| C2 · subir campanha por upload | Ideia de 12/07 que **ninguém pediu desde então**. O upload de UM arquivo já funciona; faltava só o em massa e a conversão de formato. A Parte C ficou vazia e saiu junto. |
| B6 · a tela do valor corrigido (era B31) | **Não vai ter tela.** Decisão do dono em 15/09. ⚠️ **O que JÁ FUNCIONA e não pode ser desfeito por engano:** a tabela `bling_pedido_ajuste_valor` guarda o valor real da venda que o Bling congelou errada, e **as duas telas de venda, a mensagem das 22h e os robôs do coletor já leem de lá**, pela mesma regra em `supabase/functions/_shared/valor-corrigido.js`. Isso continua no ar. ⚠️ **Consequências aceitas:** (1) cadastrar um ajuste continua sendo **comando de banco, de super-admin** — conferido em 15/09, hoje há **1 ajuste** cadastrado, então ainda é caso raro; na terceira vez vira lista à mão e alguém edita banco no escuro; (2) **a tela não mostra que o número foi ajustado** — quem olha vê o valor corrigido sem saber que o Bling diz outro. ⚠️ **Risco que segue de pé:** a Edge `enviar-push-vendas` é republicada do Mac do Gabriel (v11 → v14 em 14/09) — a regra sobreviveu daquela vez, mas pode não sobreviver da próxima. |
| B3 · montar foto de outro tamanho (era B28) | **Ficou sem tarefa.** Ele era a varredura das 23 peças sem foto, e o item que as cobrava (o antigo A3) saiu no mesmo dia. Medido em 15/09: as **5 que dariam para montar já estão ATIVAS na Shopify com 3 fotos cada** — a montagem para a vitrine está feita. O que restava era a foto do cartão, que saiu junto. Decisão do dono em 15/09: sai inteiro, sem salvar os cuidados em outro arquivo — eles ficam no histórico do repositório. |
| B2 · usar a medida da Cyrène (era B27) | **Não vai ser usada.** Decisão do dono em 15/09 — no dia seguinte ao número finalmente aparecer. **Guarde o número, que custou a chegar: a família Cyrène/Evening é 24 × 17 × 11 cm** (`SS0002SB.M1` Café, `.M2` Marfim, `.P1` Personalizada), conferido no Bling em 14 e 15/09. ⚠️ **Consequências aceitas:** (1) as duas Evening ficam em 82% de ocupação do quadro, fora da escada de tamanho que vale para as outras 49 capas — a grade mente um pouco sobre elas; (2) a descrição das três segue **sem medida nenhuma**, então quem abre a página não sabe o tamanho da bolsa. ⚠️ Se um dia for fazer: escrever produto no Bling é **PUT, e PUT APAGA as fotos** — repor é pelo campo `imagensURL`, que acrescenta. |
| B1 · o robô da vitrine da Shopify (era B26) | **Não vai ter robô.** Decisão do dono em 15/09 *(depois de ele mesmo ter destravado o desenho em 14/09: etiqueta `nao-mexer`)*. A vitrine segue atualizada **à mão, quando alguém lembrar**. ⚠️ **Consequência aceita, e ela cresce sozinha:** a última sincronização foi em **11/09, na mão**. Em 15/09 já eram **3 saldos errados** de 55 produtos do Iguatemi (Lenço Brasil Colorido 9→10, Linear Medium Caramelo 5→6, Alba Big Bordô 3→2). Cada dia sem sincronizar acrescenta erro, nos dois sentidos: peça que chegou não aparece, peça que acabou continua à venda. Para refazer a conta a qualquer momento: `vessel-brasil/ferramentas/bling-x-shopify.mjs`. ⚠️ A Shopify espelha o **depósito do Iguatemi**, não o total do Bling — comparar com o total inventa erro. |
| A5 · ligar o aviso de reserva (era B25) | **Ninguém vai receber.** Decisão do dono em 15/09, com a lista na mão. ⚠️ **Atenção: o código está TODO no ar** — migration aplicada, Edge `avisar-decisao-de-reserva` publicada e provada, e a tela na `main` desde 14/09. Não foi cancelado: está ligado a zero pessoas, de propósito. Levantado em 15/09: 8 pessoas têm aparelho registrado, e dessas **4 são as que pedem carro** (Cristian Leonel, Humberto Mendonça, Jeremias Vieira, Mariá Pessoa), 1 só aprova (Erick Martins) e 3 não têm acesso à Frota. **Consequência aceita:** quem pede carro continua descobrindo a resposta abrindo o app, e quem decide continua lendo na tela *"Não consegui avisar quem pediu — fale com a pessoa."* Para ligar um dia: Administração › Usuários › "Resposta do pedido de carro". |
| A4 · o que vai para o GS1 (era A23) | **Só o catálogo novo importa.** Decisão do dono em 15/09. Os 86 da Vessel Brasil já têm GTIN, e é o que vende. ⚠️ **Consequência aceita e medida em 15/09:** ficam **98 bolsas ativas, com preço e sem código de barras nenhum** — 86 da LA VESSEL e 12 do catálogo antigo (SS10xx). Elas não serão lidas por leitor em loja nenhuma, e não entram em GS1. A planilha com as 98 já existe, na aba "Sem GTIN" de `entregas/produtos-vessel_para-o-gs1_*_v2.xlsx`, caso um dia mude. *(A pergunta que travava — se a LA VESSEL tem CNPJ próprio, porque prefixo GS1 é por empresa — fica sem precisar de resposta.)* |
| A3 · as 23 fotos do cartão (era A21) | **Não há peça para fotografar, e ninguém pediu as que dariam para montar.** Decisão do dono em 15/09. O levantamento que sustenta: das 18 que precisariam de ensaio, **17 têm ZERO nos sete depósitos do Bling** e a 18ª (Astrea, 4 peças) está na Loja Iguatemi, sem exemplar liberado. As outras **5 dariam para montar sem ensaio** (Linear Big Blanc/Chocolate/Caramelo, Linear Small Branca e Ravelle Small Mostarda, todas já ATIVAS na loja com 3 fotos) — o dono optou por não fazer. ⚠️ **Consequência aceita:** esses 23 produtos **não terão cartão EAN** enquanto isso valer; o robô do B4 trabalha com os 63 que têm foto. |
| A2 · a Astrea Big Caramelo (era A19) | **Não há peça para fotografar.** Decisão do dono em 15/09: as 4 unidades que existem estão na loja do Iguatemi, e não há exemplar disponível para o ensaio. Sem foto, publicar poria no ar uma página sem imagem — então ela fica em rascunho na Shopify **de propósito**. ⚠️ Se um dia vier peça para o estúdio, isto volta: `SS0001EW.B2`, 4 peças, e publicar passa a ser um clique. |
| A18 · descrição escondida na sanfona | **É o desenho do tema, não defeito.** A descrição ESTÁ na página, a um clique, e sai inteira para o Google, para o Open Graph e para quem compartilha o link. Sanfona fechada é como o Prestige foi feito. *(Se um dia virar pedido: Loja online › Temas › Personalizar › bloco Descrição › desmarcar "recolher". Pela API não dá — o token leva `403 read_themes`, reconferido em 15/09.)* |
| Seção "o que o dono decidiu em 18/08" | 82 linhas contando o destino de itens que já não estavam na lista — eram os antigos A1 a A13, **da numeração velha, antes da renumeração de 15/09** (nada a ver com o A1 de hoje). História, não pendência. Está no histórico do repositório. |

**E dois foram FUNDIDOS, não removidos:** o antigo **B5** (os 27 cartões a
refazer) virou parte do **B4**, e o antigo **B8** (as 306 imperfeições) virou
parte do **B7** — nos dois casos porque não tinham tarefa própria. Os números
B5 e B8 ficam vagos.

⚠️ **E um caso que piorou enquanto era discutido:** a vitrine da Shopify (o antigo
B1). Em 11/09 os saldos batiam; em 15/09 já eram três errados. Saiu da lista
mesmo assim, por decisão do dono — o motivo está na linha dele, acima.

---

## Parte A — Só o dono resolve (clique, sem código)

*(Estava vazia em 18/08. Voltou a ter itens em 20/08, com a via de mão dupla
entre Frota e Patrimônio.)*

### A1 · os 9 carros antigos não têm etiqueta de patrimônio
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

✔️ **Reconferido em 15/09/2026, direto no banco:** o Patrimônio está com
**377 bens**, e os **sem número continuam exatamente 9** — os mesmos nove carros,
todos com `etiquetado = false`. Nada mudou desde 20/08.

✔️ **Revisto com o dono em 15/09/2026: FICA na lista**, como está, esperando
alguém colar os adesivos e preencher as fichas.

## Parte B — Precisa programar

### B4 · Cartões EAN › o robô da fila, e os 27 cartões a refazer 🟡 *aberto em 12/09/2026 — o B5 foi fundido aqui em 15/09*

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

✔️ **Reconferido em 15/09/2026:** continua sem nenhum workflow de cartão em
`.github/workflows/` (só o `provar-cartoes-fila-e-trava.mjs`, que é prova, não
robô), e a fila `vessel_cartao_pedidos` segue com **zero linhas** — ninguém
chegou a usar a aba, então ninguém sente a falta hoje.

🔄 **O ALVO MUDOU EM 15/09.** Com a saída do antigo A3 (as 23 fotos), o robô não
mira mais os 86 do catálogo: mira os **63 que têm foto tratada**. Os outros 23
não terão cartão, e isso é decisão tomada, não pendência. Quem for fazer o robô
deve tratar "produto sem foto" como **caso normal e relatado**, não como erro.

---

#### O que o robô vai encontrar quando existir *(era o item B5, fundido aqui em 15/09)*

O B5 não tinha tarefa própria: o próprio texto dizia *"assim que o robô estiver
de pé, isto é marcar as peças na aba e mandar"*. É a mesma tarefa, na etapa
seguinte — então virou esta parte.

**O retrato dos 86, medido em 15/09** abrindo cada cartão e LENDO o código de
barras da imagem:

| Situação | Produtos |
|---|---|
| Pronto | 35 |
| **REFAZER — meia resolução (300 dpi em vez de 600)** | **27** |
| REFAZER — sem código de barras | 1 |
| Sem foto, fora do alvo | 23 |

**Os 27 de meia resolução** leem, mas a barra fica com **3,1 px** — e a 300 dpi o
código de barras não perdoa arredondamento. Alguma rodada saiu com o `DPI=`
trocado, e a pasta do Zoho tem as duas resoluções misturadas. Refazer é marcar
na aba e mandar, assim que o robô existir.

⚠️ **"Tem pasta de cartão" NÃO é "tem cartão bom".** Foi assim que 5 cartões sem
código de barras passaram batidos por três semanas. Quem medir, meça com
`vessel-brasil/ferramentas/o-que-falta-de-cartao.mjs`, que abre cada arquivo e
lê o código como o leitor da loja lê — é o único teste que não dá para
substituir por olhar.

✔️ **Revisto item a item em 15/09/2026: o dono decidiu que FICA na lista**, como
está, esperando ser feito. O antigo **B5 foi fundido aqui** no mesmo dia; o
número B5 fica vago e não será reaproveitado.

### B7 · Fotos Vessel › os retoques antes de publicar 🟡 *aberto em 14/09/2026 — DESTRAVADO em 14/09; o B8 foi fundido aqui em 15/09*

São **duas partes do mesmo trabalho**, no mesmo acervo de 485 fotos, com o mesmo
mapa e o mesmo bloqueio (que caiu em 14/09): **as alças que caem tortas** e as
**306 imperfeições**. Ficaram separadas até 15/09, quando o dono mandou juntar.

#### Parte 1 · as alças que caem tortas (158 fotos)

Pedido do dono: na foto de detalhe lateral a alça tem de **descer reta** embaixo
do mosquetão. Exemplo dele: Oriane Big Blanc, `Detalhe2` (a alça pende ~9° para
a esquerda).

**Onde está o trabalho:** `entregas/fotos-vessel_alcas-tortas_2026-09-14_1956_v1/`
(página com o exemplo antes/depois + as 23 fotos de detalhe do mesmo caso) e
`entregas/fotos-vessel_mapa-de-retoques_2026-09-14_2057_v1/dados/alcas-foto-a-foto_*.json`
(as 485 fotos olhadas; **158 com alça fora de posição**, cada uma com a caixa em
pixels). Programa: `entregas/fotos-vessel_mapa-de-retoques_2026-09-14_2057_v1/programas/endireitar2.py` — ⚠️ o caminho antes escrito aqui (`programas/…`) **não existe**; os programas moram dentro da pasta da entrega. Corrigido em 15/09.

**O método que o dono aprovou:** a alça e a argola são **recortadas da própria
foto e giradas** até ficarem retas — não são redesenhadas. Mandar o gpt-image-2
redesenhar a alça deixa ela **mais estreita e chapada** e chega a mudar o tamanho
da argola. Só o **gpt-image-2** pode ser usado (gpt-image-1 é proibido pelo dono,
em qualquer projeto).

✅ **A RESOLUÇÃO NATIVA VOLTOU.** O bloqueio do `~/Library/CloudStorage` (o
antigo A24) acabou: em 14/09 às 21h a pasta do Zoho abre e os PNG de 2160×2880
são lidos normalmente (conferido lendo `Alba_Gray_Alca.png`, 2160×2880). Não
precisa mais copiar nada pelo Finder.

**O que falta:** o preenchimento do couro que fica descoberto ao girar ainda
aparece. Já corrigidos: fio preto na borda (girar RGB e transparência separados),
degrau de tom (0,62 de 255), contorno justo. Agora dá para refazer no original.

⚠️ A régua de textura que eu usava estava errada (comparava com um anel que
pegava a borda da alça: alvo 26 contra 1,3–2,9 do couro limpo). Referência tem de
ser retalho de couro limpo, longe de borda.

#### Parte 2 · as 306 imperfeições *(era o item B8)*

Mapa entregue em `entregas/fotos-vessel_mapa-de-retoques_2026-09-14_2057_v1/`:
cada foto com **quadrado numerado** em cima de cada defeito (vermelho =
imperfeição, laranja "A" = alça), lista agrupada embaixo, e os dados com a caixa
em pixels em `dados/imperfeicoes-foto-a-foto_*.json`.

**306 imperfeições em 64 bolsas, 33 delas em METAL** (mancha, risco, oxidação,
marca de dedo e reflexo estourado em fivela, mosquetão, placa e rebite). O resto
é poeira, fiapo, cabelo, cola, risco no couro, tinta de borda descascada, linha
solta e fundo sujo. O dono aprovou esse tipo de retoque.

**Prova de que funciona:** fiapo branco em couro liso sai limpo com gpt-image-2
(antes/depois em `entregas/fotos-vessel_como-salvar-sem-refotografar_*/provas-de-retoque/`).
Alça de outra bolsa no fundo sai, mas a borda da bolsa pede acabamento à mão.

**Falta terminar a varredura da linha LINEAR.** Medido em 14/09 às 21h: o
acervo tem **12 pastas Linear** e o mapa cobre **5** — faltam **7**
(`Linear_Big_Blanc`, `Big_Caramelo`, `Big_Chocolate`, `Big_Vermelho`,
`Caramelo M1`, `Caramelo_Pequena S1`, `Chocolate_Pequena S3`). O revisor parou
no **limite de uso da sessão** (429, reabre 00:40 de 15/09). As alças da Linear
já estão no mapa. É rodar o mesmo prompt do lote 3 e regerar a página com
`entregas/fotos-vessel_mapa-de-retoques_2026-09-14_2057_v1/programas/montar_mapa.py` (⚠️ caminho corrigido em 15/09 — não existe pasta `programas/` na raiz).

✅ Fazer o retoque no original já é possível — o bloqueio da pasta da nuvem
acabou em 14/09 (era o A24). Na cópia de 1000 px o remendo aparece; no original
de 2160×2880, não.

---

✔️ **Revisto com o dono em 15/09/2026: FICA na lista.** O antigo **B8 foi fundido
aqui** no mesmo dia — o número B8 fica vago e não será reaproveitado.

## Como manter esta lista

- Item que fecha **sai** daqui (a história fica no commit e nos planos de
  `docs/superpowers/`). Não deixar item morto ocupando espaço.
- Item que o dono **adia** fica, com a data e o motivo.
- Item novo entra com **o porquê**, não só o quê. "Falta X" sem o motivo vira
  item que ninguém entende em duas semanas.
- Ao encostar num assunto, reler o item aqui **antes** — vários guardam um
  cuidado que já custou caro (a resolução nativa no B7; o `cartao_gerado_em` que
  prende o número de série, no B4).
- **O teste para ficar na lista:** *alguém ainda tem que FAZER alguma coisa?* Se
  a resposta é não — está certo assim, é história, ou ninguém pediu — o item sai.
  Foi esse filtro que tirou sete de uma vez em 14/09.
