# Pendências do iamundi

Última revisão: **21/09/2026** — saiu o **B10** (resolvido) e o **B1** foi
corrigido (a previsão de erro crescente não se confirmou — medido de novo).
**Há uma pendência aberta: o B9, na Parte B.**

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
| B1 · o robô da vitrine da Shopify (era B26) | **Não vai ter robô.** Decisão do dono em 15/09 *(depois de ele mesmo ter destravado o desenho em 14/09: etiqueta `nao-mexer`)*. A vitrine segue atualizada **à mão, quando alguém lembrar**. ⚠️ **Consequência aceita — a previsão em 15/09 era que ela cresceria sozinha:** a última sincronização foi em **11/09, na mão**. Em 15/09 já eram **3 saldos errados** de 55 produtos do Iguatemi (Lenço Brasil Colorido 9→10, Linear Medium Caramelo 5→6, Alba Big Bordô 3→2). *Cada dia sem sincronizar acrescenta erro*, nos dois sentidos: peça que chegou não aparece, peça que acabou continua à venda — era o raciocínio razoável na hora. ✔️ **Medido de novo em 21/09, seis dias depois: NÃO se confirmou.** São os MESMOS três saldos, sem mudar nem crescer nem sumir: Lenço Brasil Colorido 9→10, HandBag Linear Medium Caramelo 5→6, HandBag Alba Big Bordô 3→2. *(Uma quarta linha, `SS0001EW.B2` East West Astrea Big Caramelo aparecendo como RASCUNHO na Shopify, não é discrepância de saldo — é a decisão do dono registrada no A2, de propósito.)* Ou seja: não é alarme que cresce, são três números parados — não precisa tratar como urgência crescente. Para refazer a conta a qualquer momento: `vessel-brasil/ferramentas/bling-x-shopify.mjs`. ⚠️ A Shopify espelha o **depósito do Iguatemi**, não o total do Bling — comparar com o total inventa erro. |
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

## O que saiu da lista em 21/09/2026

### B10 · `vessel_criar_private_edit` e `vessel_beauty_session_criar` ainda pedem só "ver", não "editar" ✅ *RESOLVIDO em 21/09/2026*

**Feito.** As duas funções passaram a exigir `is_vessel_atendimentos_editar()`
em vez de `is_vessel_atendimentos()` — a mesma troca de uma linha já aplicada
às funções de encerrar em 19/09
(`db/migrations/2026-09-21-vessel-criar-exige-editar.sql`). O resto de cada
função — geração de código, validação, o JSON de volta — ficou byte a byte
igual: conferido linha a linha contra a definição que já estava no banco antes
da troca, não contra o arquivo que a criou (a ordem dos arquivos mente aqui,
como o B9 já registra).

✔️ **Medido antes de aplicar, e a medida bateu com o previsto:** dos 24 perfis
do sistema, ZERO tinha `atendimentos` em `features` e ZERO tinha `editar` em
`permissions.atendimentos`. Só os 3 superadmins passavam por qualquer uma das
duas travas — e superadmin passa pelas duas. **Ninguém perdeu acesso**: é a
mesma conclusão do B9 desta lista, medida de novo na hora de aplicar, como
manda a régua deste projeto.

✔️ **Provado com sessão fabricada de verdade** (`set_config` +
`request.jwt.claims`, nunca um portão trocado por `select true`): um perfil só
com "ver" criava um encontro e uma sessão antes da troca — a linha realmente
gravada, lida de volta da tabela — e é recusado, sem escrever nada, depois.
Dois mutantes (cada função devolvida à trava de ver) foram testados e os dois
foram rejeitados pela prova, dentro de savepoints desfeitos.

**Dado real intocado:** as vendas de `vessel_pedidos`/`vessel_pedido_itens`
(459 pedidos, medido em 21/09 — a migration não toca nessas tabelas, então
qualquer diferença com uma medição de outro dia é venda nova, não efeito
desta troca), as 3 Beauty Sessions com QR impresso (conferidas campo a campo
antes e depois) e as tabelas de Stylist Circle, Private Edit e Atendimentos —
todas zeradas antes — continuaram zeradas.

⚠️ **Efeito colateral achado no caminho:** `aplicar-vessel-chave-sorteada-a-serio.mjs`
recriava `vessel_criar_private_edit` sem trava nenhuma e não tinha a
conferência que os outros programas de instalação já usam. Ganhou a mesma
trava — ver o B9, que agora conta **oito** programas na mesma situação, não
mais nove.

---

## Parte A — Só o dono resolve (clique, sem código)

**Vazia desde 18/09/2026.** O último item daqui foi o A1 — está logo acima, com o
motivo da saída.

## Parte B — Precisa programar

*(Esteve vazia de 18 para 19/09/2026. O item anterior daqui foi o B4 — está mais
acima, com o motivo da saída.)*

### B9 · Nove programas de instalação que, se rodarem de novo, desfazem trabalho mais novo · *entrou em 19/09/2026*

**O que é.** Cada mudança no banco do iamundi vem com um programinha que a
instala — são os arquivos `coletor/aplicar-*.mjs`. São **31**, dos quais **29**
dizem qual mudança instalam; medi esses 29 um por um e descobri que **11 deles,
se alguém rodar hoje, desfazem coisa que foi feita depois** — sem dar erro nenhum
e imprimindo a mesma linha de sucesso de sempre.

**A causa, numa frase:** cada um desses programas carrega uma *fotografia* da
função do dia em que foi escrito, e instalar de novo significa regravar aquela
fotografia por cima — apagando qualquer coisa mais nova que tenha entrado no
lugar.

**Como eu medi** (não é leitura de código, é o banco respondendo): para cada
programa, abri uma transação, pedi ao banco a versão atual de cada função que ele
instala, rodei o programa, pedi de novo e comparei letra por letra — e desfiz a
transação. O que mudou nessa comparação é, literalmente, o que mudaria de
verdade.

⚠️ **Dois já foram travados em 19/09, e não fazem mais parte da dívida** —
porque mexiam em coisa desta mesma entrega:

- `aplicar-vessel-private-edit-pela-tela.mjs` — voltaria a deixar quem só pode
  **olhar** encerrar um encontro, e traria as parceiras desativadas de volta para
  a lista de escolher;
- `aplicar-vessel-beauty-sessions-com-tela.mjs` — voltaria a deixar quem só pode
  **olhar** encerrar uma Beauty Session (e as três que existem hoje têm QR
  impresso, na mão de cliente).

Os dois agora **se recusam a rodar** e explicam na tela o que aconteceria. A
recusa não é cravada: eles perguntam ao banco se a mudança mais nova já foi
instalada — num banco novo, onde ela não foi, eles rodam normalmente.

⚠️ **E um terceiro foi travado em 21/09, pelo B10** (que saiu da lista nesta
mesma revisão): `aplicar-vessel-chave-sorteada-a-serio.mjs` desfaria
`vessel_criar_private_edit` de volta para uma versão sem trava de permissão
nenhuma. Ganhou a mesma trava, no mesmo formato. Ele saiu da tabela abaixo por
isso — o resto da dívida (**oito** programas, não mais nove) continua exatamente
como estava.

⚠️ **E aqui está o que faz isso ser difícil de enxergar: a ordem dos NOMES dos
arquivos não é a ordem em que eles foram instalados.** O arquivo
`2026-09-19-vessel-encerrar-exige-editar.sql` vem **antes** de
`2026-09-19-vessel-private-edit-pela-tela.sql` quando se lê a pasta em ordem
alfabética — e foi instalado **23 horas depois** dele. Quem decidir "qual é a
mais nova" olhando o nome do arquivo chega à resposta errada. Foi o que
aconteceu comigo na primeira varredura, e é um engano fácil de repetir. **A única
fonte honesta é a coluna `applied_at` da tabela `schema_migrations`** — é o
relógio, não o nome.

**Os oito que faltam.** Quatro deles são menos perigosos, e está dito por quê:

| Programa | O que ele faria |
|---|---|
| `aplicar-vessel-pessoas.mjs` | Criaria **cópia duplicada** de `vessel_abrir_convite` e `vessel_registrar_cartao` |
| `aplicar-vessel-contar-as-beauty-sessions.mjs` | Desfaria `vessel_sessao_do_codigo`; **duplicaria** `vessel_conta_das_beauty_sessions` |
| `aplicar-vessel-private-edit.mjs` | Desfaria `vessel_criar_private_edit`; **duplicaria** `vessel_conta_das_private_edits` |
| `aplicar-vessel-rastreio-por-stylist.mjs` | Desfaria `vessel_rastreio_dos_stylists` (traria as parceiras desativadas de volta ao relatório) e `vessel_solicitar_atendimento` |
| `aplicar-vessel-beauty-sessions.mjs` | Desfaria `vessel_interesse_da_beauty_session` e `vessel_solicitar_atendimento` |
| `aplicar-vessel-pedido-de-atendimento.mjs` | Desfaria `vessel_solicitar_atendimento` |
| `aplicar-vessel-personal-atelier.mjs` | Desfaria `vessel_pedido_de_personal_atelier` |
| `aplicar-vessel-preferencias-da-visita.mjs` | Desfaria `vessel_detalhar_visita` |

⚠️ **As quatro funções marcadas como "duplicada" são as MENOS perigosas** —
`vessel_abrir_convite`, `vessel_registrar_cartao`,
`vessel_conta_das_beauty_sessions` e `vessel_conta_das_private_edits`. Nesses
casos o banco não troca uma pela outra: fica com **duas**, e a tela que chamar
morre na hora com o erro `function is not unique`. É chato, mas **aparece** — e
o que aparece não é o problema desta lista. O problema é o resto, que é **calado**.

**Por que importa.** Nenhum desses programas é rodado no dia a dia — eles rodam
uma vez, quando a mudança vai para o banco. O risco é alguém rodar um deles
achando que está reinstalando algo inofensivo, ou por engano ao copiar uma linha
de comando de uma conversa antiga. Aí o sistema volta atrás sozinho, sem uma
palavra.

**Onde se resolve.** Duas saídas, e a segunda é melhor:

1. Escrever a mesma trava nos nove, um a um. Funciona, mas são nove listas
   digitadas à mão, e cada uma envelhece sozinha na próxima mudança.
2. **Uma conferência só, em `coletor/lib/`, que todo programa de instalação chama
   no começo:** ela pergunta ao banco como estão as funções, instala num ponto de
   retorno, compara, desfaz — e só deixa seguir se nada regrediu. Aí a trava é
   **medida**, não digitada, e vale para os programas que ainda nem foram
   escritos.

**Não tem pressa e não cresce por conta própria** — a dívida tem tamanho fixo,
nesses oito. Mas ela reaparece a cada mudança nova, porque o molde de programa de
instalação que o projeto usa é justamente o que cria o problema. É por isso que a
saída 2 vale mais do que a 1.

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
