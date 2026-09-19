# Pendências do iamundi

Última revisão: **19/09/2026** — entrou **um** item: o **B9**, as telas do
"Register Later". A lista estava vazia desde 18/09.

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
E esses três saíram depois, em 16 e 18/09 — o motivo de cada um está na seção
seguinte —, então hoje a lista está vazia. A sequência ficou cheia de buracos, e
é assim mesmo: buraco é o preço de o código ser estável. A tabela abaixo continua
valendo para ler conversa antiga.

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

## O que saiu da lista em 16 e 18/09/2026

Saíram os **três últimos** itens: um resolvido e dois por decisão do dono. Com
eles, **a lista ficou vazia**. O motivo de cada saída fica escrito aqui, porque
item que desaparece sem explicação é o que faz alguém reabrir o assunto daqui a
um mês achando que é defeito novo.

### B7 · Fotos Vessel, as fotos de detalhe ✅ *RESOLVIDO em 16/09/2026*

**O desfecho não foi o que o item previa.** Ele nasceu como "retocar as alças
tortas antes de publicar" e terminou como **"tirar as fotos de detalhe da
vitrine"**. O dono reprovou o retoque depois de 21 versões, e a varredura mostrou
por quê: a **alça torta é posicionamento do ENSAIO, não defeito da peça** — a
mesma bolsa em outra cor saiu reta. Retocar era consertar o sintoma.

**Como foi provado:** o dono marcou **42 fotos em 9 famílias** numa página de
seleção, com a regra "se uma da família está ruim, sai a família inteira". Elas
saíram por `productDeleteMedia` e a loja foi relida depois: de **479 para 437
imagens**, nenhum produto ficou sem foto, a contagem de cada um caiu exatamente
1, e a vitrine pública abre sem imagem quebrada.

⚠️ **Consequência aceita:** 42 produtos ficam sem a foto de detalhe da ferragem.
A galeria já não era padronizada (a Oriane Mostarda vive com 1 foto de detalhe
só). **As fotos continuam no acervo e no Bling** — saíram da vitrine, não do
arquivo.

**O que fica guardado, caso o assunto volte:**

- cópia de segurança das 350 imagens em
  `entregas/COPIAS DE SEGURANCA/shopify-fotos-antes-de-remover-detalhes_2026-09-16/`;
- o programa de endireitar alça **existe, funciona e não usa IA** —
  `entregas/EM USO (nao apagar)/fotos-vessel_alca-reta-no-original_2026-09-15_1942_v1/`
  (grão do remendo **12,07** contra **12,07** do couro ao lado, **0 px** de
  ferragem alterados). Ele deixou de ser o caminho recomendado, não de funcionar;
- se houver **ensaio novo**, as cores irmãs são a referência de como posicionar a
  alça — é no ensaio que o defeito nasce.

### B4 · Cartões EAN, o robô da fila e os 27 a refazer · *sai em 18/09/2026*

**Decisão do dono em 18/09/2026: o trabalho vai ser feito, só não fica mais
nesta lista** — o acompanhamento passa a ser por fora. Não é cancelamento, e não
há consequência aceita.

Como ele vai ser feito, o que já está pronto fica anotado aqui para **não ser
reconstruído**:

- **desenhar e exportar** — `cartao/exportar.mjs`, que roda fora do Mac. Provado
  em 8 produtos: mesmo tamanho 2042×1300, desenho no mesmo lugar (1 px =
  0,04 mm), código de barras lido da imagem;
- **subir no Zoho** — `coletor/lib/zoho-workdrive.mjs` (`acharOuCriarPasta` +
  `uploadArquivo`), que a Fábrica de Anúncios já usa do GitHub Actions com os
  segredos configurados;
- **pegar e devolver** — `vessel_cartao_pegar_da_fila()` e
  `vessel_cartao_pedido_terminou()`, já no banco, só para `service_role`.

Faltava amarrar os três num workflow e criar o gatilho que acorda o robô quando o
pedido entra — o molde é `vessel_lote_novo_pede_foto`, que já faz isso para as
fotos, com o segredo em `segredos_de_cron`.

⚠️ **Dois cuidados que já custaram caro:**

1. `cartao_gerado_em` é marcado **só nas peças que o robô confirma**. Marcar o
   pedido inteiro deixa a marca mentindo nas que falharam no meio — e é ela que
   **prende o número de série**.
2. **"Tem pasta de cartão" NÃO é "tem cartão bom".** Foi assim que 5 cartões sem
   código de barras passaram batidos por três semanas. Quem medir, meça com
   `vessel-brasil/ferramentas/o-que-falta-de-cartao.mjs`, que abre cada arquivo e
   lê o código como o leitor da loja lê — é o único teste que não dá para
   substituir por olhar.

**O retrato de 15/09, para quem retomar:** dos 86 do catálogo, **35 prontos**,
**27 a refazer por meia resolução** (saíram a 300 dpi em vez de 600: a barra fica
com 3,1 px, e a 300 dpi o código de barras não perdoa arredondamento), **1 sem
código de barras** e **23 sem foto, fora do alvo**. O alvo são os **63 com foto
tratada** — "produto sem foto" é caso normal e relatado, não erro. A fila
`vessel_cartao_pedidos` seguia com **zero linhas**: ninguém chegou a usar a aba.

### A1 · os 9 carros antigos sem etiqueta de patrimônio · *sai em 18/09/2026*

**Decisão do dono em 18/09/2026: fica assim.**

✔️ **Medido no banco em 18/09/2026, antes de tirar:** o Patrimônio está com
**377 bens, 368 com número**, e os **9 sem número continuam sendo exatamente os
9 carros antigos**, todos com `etiquetado = false`. Isto é, o adesivo não foi
colado e o número não foi digitado — a saída é **decisão, não conclusão**.

Os 9: VOLVO XC60, FIAT DOBLO, FIAT BRAVO ESSENCE, FIAT BRAVO BLACKMOTION, HONDA
FIT, FORD FIESTA SEDAN, VOLVO XC90, PORSCHE CAYENNE PHEV, BMW X1. *(O FIAT PUNTO
escapou: já tem o nº 14.)*

⚠️ **Consequências aceitas:**

1. **O leitor de código não acha carro nenhum** — nenhum dos 9 tem número que um
   leitor leia.
2. O código `RBB-00X`, que é só da Frota e nenhum leitor lê, **continua sendo a
   única identificação desses carros** — e por isso **não pode ser aposentado**.

Isto não cresce: carro novo já nasce com número de etiqueta pelos dois caminhos
desde 20/08, então a dívida tem tamanho fixo, nesses 9. Se um dia for feito, o
campo é "Nº de patrimônio", na ficha do veículo.

---

## Parte A — Só o dono resolve (clique, sem código)

**Vazia desde 18/09/2026.** O último item daqui foi o A1 — está logo acima, com o
motivo da saída.

## Parte B — Precisa programar

### B9 · Register Later, as telas — *aberto em 19/09/2026*

**O banco e o robô estão prontos; o que falta é tela.** O desenho aprovado pelo
dono em 19/09 está em
`docs/superpowers/specs/2026-09-19-register-later-design.md`: na peça ainda não
registrada, um botão discreto **"Deixar para depois"**, a cliente deixa o e-mail
e marca o consentimento, e a marca manda **dois e-mails, em 7 e em 30 dias**,
com o link do certificado daquela peça.

**Por que importa:** hoje quem abre a etiqueta e não quer registrar na hora
simplesmente vai embora, e a marca não tem como voltar a falar com ela sobre
aquela peça. É a última peça da lista da Fase 2.

**O que já existe (e está provado, mas AINDA NÃO APLICADO nem publicado):**

- a migration `db/migrations/2026-09-19-zzz-vessel-lembretes-register-later.sql`
  — tabela `vessel_lembretes`, um lembrete aberto por peça, dois tetos (1 por
  peça a cada 24h e 3 por e-mail a cada 24h), e o gatilho que mata o lembrete
  quando a peça ganha registro;
- o robô `supabase/functions/vessel-lembretes/` (cron diário) e as ações
  `lembrete-criar` e `lembrete-parar` na edge `vessel-conta`;
- a prova por rollback em `coletor/provar-lembretes.mjs`.

**O que falta, e é onde se resolve:**

1. **`/verify`** (repositório `vessel-brasil`): o botão "Deixar para depois", a
   folha com e-mail e consentimento, e o agradecimento — que é o MESMO
   agradecimento em qualquer caso. ⚠️ **Não inventar mensagem diferente:** a
   função do banco responde `{ok:true}` igualzinho quando a peça já tem dona,
   já tem lembrete ou o teto estourou, de propósito — traduzir isso na tela
   desfaria a única trava que impede descobrir, por fora, quais bolsas já têm
   dona.
2. **`/verify/parar-lembrete`**: a tela que o link do e-mail abre, **sem
   login** — o token é a prova. Ela sempre diz "você não vai mais receber",
   inclusive com link velho: é verdade, e responder outra coisa transformaria
   o endereço num testador de tokens.
3. **Painel Autenticidade**: a lista de lembretes (peça, e-mail, quando pediu,
   o que já foi enviado e o estado). Só leitura nesta entrega. O e-mail aparece
   **inteiro**, por decisão do dono — é dele que a equipe precisa para socorrer
   a cliente.

⚠️ **E antes de qualquer tela, três passos de operação, nesta ordem:** aplicar a
migration → gravar o segredo `vessel-lembretes` em `segredos_de_cron` → publicar
as duas edges → **só então** agendar o cron. O passo a passo exato está em
`supabase/functions/vessel-lembretes/LEIA-ME.txt`. Agendar antes da migration faz
o robô errar todo dia, calado.

## Como manter esta lista

- Item que fecha **sai** daqui (a história fica no commit e nos planos de
  `docs/superpowers/`). Não deixar item morto ocupando espaço.
- Item que o dono **adia** fica, com a data e o motivo.
- Item novo entra com **o porquê**, não só o quê. "Falta X" sem o motivo vira
  item que ninguém entende em duas semanas.
- Ao encostar num assunto, reler **antes** o que está escrito aqui — inclusive
  na seção do que saiu. Vários guardam um cuidado que já custou caro (o
  `cartao_gerado_em` que prende o número de série, no B4; "tem pasta de cartão"
  não é "tem cartão bom").
- **O teste para ficar na lista:** *alguém ainda tem que FAZER alguma coisa?* Se
  a resposta é não — está certo assim, é história, ou ninguém pediu — o item sai.
  Foi esse filtro que tirou sete de uma vez em 14/09.
