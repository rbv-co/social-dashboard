# Manual detalhado — as seis maiores ferramentas

> **Procurando só o que cada ferramenta faz?** Está em `manual-da-central.md`,
> nesta mesma pasta, e cobre as 20. **Este aqui é o detalhe fundo de seis delas** —
> abra quando o resumo não bastar.

**O que é este arquivo:** uma ferramenta por capítulo, e dentro de cada capítulo o
que cada tela mostra, o que cada botão faz, o que a ferramenta decide sozinha e o
que ela **não** faz.

Não é documentação técnica. Não tem nome de arquivo, nem de tabela, nem de
função. Se você quer mexer no código, o lugar é o `LEIA-ME.txt` de cada pasta e o
`PADRAO-DA-CENTRAL.md`.

**Última revisão: 17/08/2026.**

---

## Como este manual foi escrito

Cada capítulo foi conferido **contra a tela de verdade**, não contra a memória nem
contra o que estava escrito antes. Onde o texto antigo de uma ferramenta dizia uma
coisa e a tela hoje faz outra, vale a tela — e o capítulo avisa onde isso
aconteceu.

Cada ferramenta tem sempre as mesmas seis partes:

| Parte | Responde |
|---|---|
| **Em uma frase** | Para que ela serve |
| **Quem entra** | Que permissão é preciso ter |
| **Onde fica** | O caminho de cliques desde a Central |
| **A tela, parte por parte** | Cada aba, cada seção, cada botão |
| **As regras que surpreendem** | O que ela decide sozinha e por quê |
| **O que ela não faz** | O limite, escrito, para ninguém esperar demais |

---

## As seis que estão aqui

**Gestão de Tráfego · Frota · Central de Conteúdo · Redes Sociais · Patrimônio ·
Administração.**

São as seis maiores da Central — juntas somam a maior parte do sistema. As outras
catorze estão descritas em `manual-da-central.md`, que cobre as 20.

---
---

# 1. Gestão de Tráfego

## Em uma frase

É a única ferramenta da Central que **mexe nas campanhas pagas de verdade** — ela
pausa, reativa, muda orçamento, duplica campanha, troca o público e cria campanha
nova direto na conta da Meta.

> **Atenção, e não é força de expressão.** Toda ação desta tela acontece na conta
> real, com dinheiro real. Nada é aplicado sozinho: cada ação abre uma janela de
> confirmação antes. Se você não tem certeza do que vai acontecer, **cancele** —
> cancelar nunca muda nada.

## Quem entra

Precisa da permissão de **Gestão de Tráfego**, ou ser administrador. Dentro dela
há dois níveis:

- **Quem só vê:** lê tudo — campanhas, números, veredito, funil.
- **Quem pode editar:** ganha os botões de mexer — orçamento, duplicar, público,
  criar campanha, e editar a régua.

Quem só vê não enxerga botão que não pode usar. Botão escondido não é decoração:
é para ninguém clicar em algo que a tela vai recusar depois.

## Onde fica

**Central → Meta Ads → Gestão de Tráfego.**

## A tela, parte por parte

### A barra de cima

- **Voltar ("Meta Ads")** — sai da tela e desliga os relógios dela.
- **Período: HOJE · 1D · 7D · 14D · 30D · MÊS · MÊS PASS. · ATÉ AGORA.** Troca a
  janela de datas de tudo que está abaixo. Abre em "ATÉ AGORA".
- **↻** — recarrega na hora, sem esperar o relógio.
- **Funil** — abre o funil das campanhas que estão no ar (explicado adiante).
- **KPIs** — só para quem tem permissão. Abre o editor de **quais números
  aparecem em cada tipo de campanha** (tráfego, vendas, leads…). O que você
  escolher ali vale para todo mundo que abrir a tela.
- **Escolher a conta de anúncios** — o botão com o nome da conta. Esta tela
  descobre sozinha a lista de contas; ela não depende da Análise de Campanhas.
- **Tempo Real** — o relógio e o horário da última atualização.
- **A− / A+** (canto inferior direito) — aumenta ou diminui o texto da tela
  inteira, e lembra a escolha no seu aparelho.

### As três abas

**Campanhas · Fila · A régua** — mais dois botões de ação: **+ Nova campanha** e
**Histórico**, os dois só para quem pode editar.

---

### Aba **Campanhas**

A lista da conta, em três níveis que abrem e fecham:

**campanha → conjuntos de anúncios → anúncios**

O botão **"Recolher tudo / Expandir tudo"**, no cabeçalho da lista, fecha ou abre
todos de uma vez.

**Em cada campanha você vê:**

- **A faixa de veredito** (a estrela) — manter, escalar, reduzir ou pausar, com o
  porquê. De onde ela sai está explicado em "As regras que surpreendem".
- **O orçamento diário**, com o botão **"editar"** — mas só no nível certo. Leia o
  bloco sobre orçamento adiante; é a regra que mais confundiu nesta tela.
- **"Duplicar"** — copia a campanha inteira.
- **"Objetivo: ponderado"** — só em campanha de engajamento. Clicando, você declara
  **o que aquela campanha está de fato comprando**: curtida, comentário,
  salvamento ou compartilhamento.
- **Pausar / Reativar.**

**Em cada conjunto de anúncios:**

- O orçamento, quando ele mora ali.
- **"Duplicar"**.
- **"Público"** — abre a janela de quem a Meta está mirando hoje, e deixa mudar.

**Em cada anúncio:**

- **"Ver criativo"** — mostra a prévia do anúncio como ele aparece.
- **Pausar / Reativar.**
- O mesmo selo de objetivo por interação da campanha, valendo só para ele.

---

### Aba **Fila**

**O robô propõe, você decide.** Uma vez por semana um robô analisa as campanhas e
escreve uma sugestão. Ela não é aplicada: ela entra nesta fila esperando você.

- Cada linha oferece **três escolhas, sempre**: subir, baixar, manter. Se o robô
  sugeriu subir 25%, o botão de baixar oferece 25% para baixo — o tamanho do
  passo vem do julgamento dele sobre aquela campanha.
- A linha mostra o **gasto de verdade** ao lado do orçamento. São números
  diferentes, e a diferença é informação: campanha com teto de R$ 230 que gastou
  R$ 104 ontem não vai gastar mais só porque o teto subiu.
- **Recusar cala aquela campanha por 7 dias**, não para sempre. A situação muda; o
  que não pode é a fila repetir amanhã o que você já respondeu hoje.
- Sugestão de "manter" **não entra na fila**. Não há o que aprovar num conselho de
  não mexer.
- Quando o total aprovado é repartido entre vários conjuntos, os centavos do
  arredondamento são acertados para que a soma bata exatamente com o que você
  aprovou. Aprovar R$ 280 e aplicar R$ 279,98 seria uma promessa quebrada em
  silêncio.

---

### Aba **A régua**

É onde você diz **quanto aceita pagar por cada resultado**. É ela que acende o
semáforo verde, amarelo ou vermelho de cada campanha.

**A regra que amarra tudo: toda meta aqui é "custo por resultado, menor é
melhor".** É por isso que campanha de venda é medida pelo **custo por venda** e
não por retorno sobre investimento — retorno é ao contrário (maior é melhor) e
exigiria um segundo semáforo invertido na sua cabeça.

**Cada tipo de campanha tem a sua unidade:**

| Tipo de campanha | Medida por |
|---|---|
| Lead | Custo por lead |
| WhatsApp / mensagens | Custo por conversa |
| Vendas | Custo por venda |
| Tráfego | Custo por visita |
| Reconhecimento | Custo por mil impressões |
| Engajamento | Custo por **ponto** (ver abaixo) |

**Os pontos do engajamento.** Engajamento não compra uma ação só, então cada
interação vale um tanto: **curtir vale 1 ponto, salvar vale 30**. Quem salva um
post demonstra muito mais interesse do que quem curte, e a conta precisa refletir
isso. Com os pontos sai o **custo por ponto**, comparado com a meta.

**As metas que existem hoje** (medidas em 90 dias de campanha de verdade):

- Engajamento: **R$ 0,15 por ponto**
- Tráfego: **R$ 0,25 por visita**
- Mensagens: **R$ 20,00 por conversa**

**Leads, Vendas e Reconhecimento estão em branco de propósito.** Em 90 dias não
houve um lead registrado, uma compra, nem uma campanha de reconhecimento na
conta. Dar meta a um resultado que não existe é número inventado. Sem meta, o
semáforo cai na leitura de saúde daquele tipo — você vê o que a Meta pensa, em vez
de uma cor que alguém escolheu no chute. Quando começar a rodar esse tipo de
campanha, a régua já está lá esperando ser preenchida.

**Esses três números não são sagrados.** São o que você já paga hoje, um pouco
abaixo da média, para a régua dizer "melhor que agora". Ajuste sempre que achar
que seu custo real mudou.

**A aba tem duas seções, cada uma com sua meta e seu próprio limiar:**

1. **Engajamento ponderado** — os pesos de cada interação, quanto você aceita
   pagar por cada uma das quatro, e os limiares que decidem a cor a partir dessas
   metas.
2. **Metas por resultado** — reconhecimento, tráfego, mensagens, leads e vendas, e
   os limiares que decidem a cor a partir *dessas* metas.

**Quem é dono da meta é dono do limiar.** São dois conjuntos de limiar e não um só
porque você pode querer "escalar forte" em 0,8× para engajamento e 0,9× para
vendas, sem que mexer num mexa no outro. Cada campo tem uma prévia ao lado que
converte o multiplicador em reais na hora.

**O exemplo vivo.** Abra a aba Campanhas primeiro e a régua passa a usar **uma
campanha sua de verdade** para mostrar como cada ajuste muda o semáforo. Sem
passar pela aba Campanhas, a régua fica no escuro.

**Todo ajuste fica gravado em histórico**, com o antes e o depois completos. Se o
histórico não conseguir gravar (queda de internet, por exemplo), a tela avisa —
mas o ajuste **não é desfeito**. Se o histórico falhar sempre, avise quem
administra.

---

### Botão **+ Nova campanha**

Um assistente de quatro passos, uma pergunta por tela, que cria a campanha direto
na Meta.

- **O catálogo de objetivos é o de verdade, não um resumo.** Antes o assistente
  oferecia quatro opções; medindo o que as contas realmente rodam apareceram
  **vinte e oito combinações** — e a mais usada de todo o negócio (visita ao
  perfil do Instagram) não estava entre as quatro.
- **Sugestão de público com IA:** a partir do que já aconteceu na conta —
  interesses, localização e idade, com o porquê ao lado de cada recomendação.
- **Sugestão de texto:** os textos que já funcionaram nesta conta, para ninguém
  começar numa caixa vazia.
- **A persona da marca** entra junto no pedido. Sem ela, a IA tirava a faixa
  etária dos números da própria conta — e número de conta diz **quem clicou**, não
  **para quem a marca quer vender**.
- **Escolher uma publicação que já existe** para impulsionar, com legenda, data,
  tipo, miniatura, curtidas e comentários na lista. Story aparece à parte, com o
  aviso de que ele vive 24 horas — lista de story vazia é o normal, não defeito.
- **Campos do anúncio:** título, descrição, botão e, no caso de WhatsApp, a
  **mensagem de saudação** que a pessoa recebe pronta.
- **Rascunho e histórico:** fechou a aba sem querer, o que você tinha montado está
  lá. Só salva depois que existe algo a perder — abrir, olhar e fechar não vira
  rascunho.

### Botão **Histórico**

A lista do que foi começado por aqui: rascunho, enviado, criado. Mesmo cadeado do
"+ Nova campanha" — quem não pode criar não tem o que ver nesta lista.

### Botão **Funil**

Mostra a queda entre as etapas das campanhas no ar. **Nem todo objetivo tem
funil**, e a tela sabe disso:

- **Funil de verdade** — mensagens, leads, vendas. O resultado vem depois do
  clique, e a queda entre viu → clicou → conversou é a informação.
- **Proporção** — engajamento, tráfego, reconhecimento. Aqui o resultado é uma
  razão, não uma etapa. Empilhar as etapas em engajamento devolvia "11.262% de
  quem clicou", porque a curtida não vem *depois* do clique: ela acontece **no
  lugar** dele.

Forçar o mesmo desenho nos dois casos produz um número sem sentido — e um número
sem sentido ao lado de números certos contamina os certos.

## As regras que surpreendem

### Onde fica o orçamento: no conjunto ou na campanha

Uma campanha da Meta guarda o orçamento em **um** dos dois lugares, nunca nos
dois — e só dá para editar no lugar certo:

- **Orçamento na campanha:** você põe um valor só e a Meta reparte entre os
  conjuntos. **O conjunto não aceita edição de orçamento.**
- **Orçamento no conjunto:** cada conjunto tem o seu. **A campanha não aceita
  edição de orçamento.**

A tela descobre qual é sozinha. Quando ela **não consegue** descobrir (nenhum dos
dois casos, ou os conjuntos não carregaram), ela **não oferece edição nenhuma** —
em vez de prometer algo que a Meta vai recusar.

### Quem decide o veredito de cada campanha

Existe **um veredito só**, decidido nesta ordem — não há dois selos disputando:

1. **A leitura de saúde manda pausar ou reduzir → vale a saúde**, por mais barata
   que a campanha esteja. Frequência alta quer dizer audiência saturada, e preço
   baixo não conserta isso.
2. **Saúde ok e existe a análise semanal do robô → vale o robô.**
3. **Saúde ok e sem análise do robô → vale a régua** (o custo por ponto ou por
   resultado).
4. **A régua sem dado aproveitável, mas a saúde com algo a dizer → vale a saúde.**
   É o caso da campanha de gasto baixo.

Fora dessas quatro situações, o cartão fica sem dados — e diz isso.

**O custo por resultado aparece sempre**, independente de quem deu o veredito: ele
é informação, não decisão.

**O botão "Aplicar R$ X/dia" só aparece quando quem decidiu foi o robô semanal** —
só ele tem um número próprio para sugerir. Em todos os outros casos você edita o
orçamento na mão, porque inventar um número ali seria pior do que não sugerir
nada.

### Peso e preço são coisas diferentes

**Peso** é quanto uma interação **vale** (curtida 1, salvamento 30). **Preço** é
quanto ela **custa** de verdade. As duas não andam juntas — medido nas suas
campanhas reais:

| Interação | Custo medido (13 campanhas, 90 dias) |
|---|---|
| Curtida | R$ 0,12 |
| Compartilhamento | R$ 13 a R$ 21 |
| Salvamento | R$ 48 a R$ 51 |
| Comentário | R$ 128 a R$ 172 (poucos comentários — dado mais fraco) |

Um salvamento vale 30 vezes mais que uma curtida, mas custa umas **400 vezes**
mais. Por isso cada interação tem a sua própria meta de custo: comparar tudo pelo
ponto ponderado é, na prática, sempre premiar quem compra curtida — curtida é 83%
do volume.

**Declarar muda o julgamento; não declarar não muda nada.** Sem declarar, a
campanha continua julgada pelo ponto ponderado. Declarando "Salvamento", ela passa
a ser julgada pelo custo por salvamento contra a meta de salvamento. O custo por
ponto continua aparecendo, mas **em cor neutra** — ele já não é quem decide aquele
cartão, e continuar pintando de vermelho seria uma contradição visual.

### Métrica líquida vence a bruta

Quando a Meta oferece a versão que já desconta quem descurtiu ou dessalvou, é ela
que vale. **Líquida valendo zero é zero mesmo** — não cai de volta para a bruta.

### "Ativa" na Meta não quer dizer "no ar"

Campanha que chegou ao fim do período programado **continua marcada como ativa na
Meta para sempre**. Foi medido: campanhas que pararam em 05/07 e 01/06 seguiam
"ativas" com os anúncios "ativos" dentro. Quem responde de verdade é a data de
parada — e é por isso que ela não pode ser esquecida: sugerir mexer no orçamento
de uma campanha encerrada é pedir uma decisão que não muda nada.

### Duplicar: o que acontece de verdade

- **A cópia sempre nasce pausada.** Isso vai escrito em toda chamada, não é
  confiança no padrão da Meta. Nada gasta até você ativar na mão.
- **A cópia é feita em cascata** — primeiro a campanha vazia, depois cada conjunto,
  depois cada anúncio. É de propósito: o jeito "copie tudo de uma vez" da Meta
  trava em 3 anúncios por chamada, justamente na campanha grande que você mais
  quer duplicar. Em cascata não tem teto e você vê o progresso.
- **Se parar no meio, nada é apagado.** O que foi criado fica lá, pausado, e a tela
  oferece "Tentar continuar" (refaz só o que faltou) ou "Deixar assim". A
  ferramenta nunca apaga sozinha para "limpar" — um engano apagaria o item errado.
- **Tem um caso em que "Tentar continuar" não aparece:** quando a Meta aceita o
  pedido mas não informa o número da cópia. Aí ninguém sabe se ela foi criada, e
  mandar de novo poderia criar **duas**. A tela diz isso com todas as letras e pede
  para você conferir no Gerenciador de Anúncios antes de repetir.
- **Só entram os anúncios que gastaram no período selecionado.** A tela só conhece
  o que a Meta devolveu para o período escolhido lá em cima. Anúncio que não
  gastou não aparece e **não é copiado**. Se você quer levar todos, escolha um
  período maior **antes** de duplicar.

### Público: o que muda quando você mexe

- **Mudar o público de um conjunto rodando reinicia o aprendizado da Meta.** Ela
  esquece o que tinha aprendido e recomeça do zero. Na prática o custo costuma
  piorar por alguns dias. Não é motivo para nunca editar — é motivo para não fazer
  isso toda semana sem necessidade. A tela avisa na hora de confirmar.
- **Advantage+ e restrição manual não convivem.** Se a Meta está escolhendo o
  público sozinha e você também define idade, gênero ou interesse à mão, ela
  recusa a combinação. A tela obriga a escolher um dos dois **antes** de deixar
  salvar, em vez de você descobrir o erro depois. Mas isso só trava o conflito que
  **você acabou de criar**: se o conjunto já chegou assim da Meta e você só quer
  trocar uma cidade, o Salvar continua liberado.
- **O raio mínimo por cidade é 17 km.** A Meta não aceita menos. Se você puser um
  valor menor, a tela ajusta sozinha para o mínimo **e avisa que ajustou** — nunca
  troca o número calada.
- **Escolher o lugar: Brasil, estado, cidade ou local.** Cada um vale de duas
  formas, e o botão da linha alterna: **a área inteira** (sem raio) ou **ponto com
  raio** (um círculo em volta de uma coordenada). Ponto com raio é o único jeito de
  mirar menos de 17 km — o mínimo vale para cidade, não para ponto. Brasil só
  existe como área inteira. **"Local"** (shopping, loja, esquina, endereço) não
  existe no catálogo da Meta: ele vem do mapa e é sempre ponto com raio.
- **O mapa funciona nos dois sentidos.** O que você escolhe aparece nele sozinho;
  e clicando no mapa o ponto cai na hora, descobrindo em que rua caiu. Se o
  endereço não vier, fica a coordenada e a tela **diz** que não conseguiu — ela
  nunca inventa endereço.
- **Procurando cidade, a Meta devolve bairro junto.** Procure "Uberlândia" e vêm
  Centro e Martins. Por isso cada linha do resultado diz o tipo dela — sem isso é
  fácil acrescentar um bairro achando que acrescentou a cidade.
- **O que este editor não gerencia fica como estava.** Grupo de países, região
  metropolitana, bairro, CEP, área do mapa: tudo isso é preservado ao salvar, e a
  tela avisa antes de confirmar quando existe algum. Um conjunto mirado por CEP
  pode ser editado aqui normalmente sem perder o CEP.
- **Interesse combinado com "E" continua combinado com "E".** "Gosta de Moda **E**
  de Luxo" é muito diferente de "gosta de Moda **ou** de Luxo" — o segundo alcança
  muito mais gente. O editor mexe só na lista dentro dos grupos que já existiam,
  sem nunca juntar nem separar grupo.
- **Aplicar um público já montado no Estúdio só preenche o editor**, nunca salva
  sozinho. Você ainda vê o resumo do que vai mudar e confirma.

### O que a Meta reclama dos seus anúncios

Existe um painel que mostra os problemas reais que a Meta aponta, traduzidos e com
o que fazer. Vale a medição que o gerou (12/08/2026, 517 anúncios em 7 contas):
**nenhum anúncio estava recusado por política**. O que existia eram 13 problemas
operacionais, e nenhum deles aparecia em lugar nenhum da tela — conjuntos pausados
pela Meta porque o público personalizado sumiu, vídeos abaixo de 500px que não
rodam no Instagram, anúncios que simplesmente não estavam sendo veiculados.

**Este painel filtrava só campanhas ativas e por isso nunca aparecia.** Já foi
corrigido, mas fica registrado: um painel de problemas que só olha o que está
ativo esconde exatamente o que quebrou.

## O que ela não faz

- **Não duplica para outra conta de anúncios.** A Meta não oferece isso em nível
  nenhum. Levar uma campanha para outra loja exige recriar do zero na conta de
  destino, inclusive re-subir as imagens (na Meta a imagem pertence à conta).
- **Não troca criativo, público ou posicionamento na hora de duplicar.** Isso é
  edição, e a cópia não faz.
- **Não muda o orçamento na cópia** — a Meta não aceita. Duplique e ajuste depois
  no "editar" do orçamento.
- **Editar o público não mexe em onde o anúncio aparece.** Feed, Story, Reels e os
  outros posicionamentos são configuração separada, e este editor não toca nela.
- **Duplicar e editar público nunca foram testados numa conta real** — os testes
  usam uma Meta de mentira. O primeiro uso de verdade é também o teste.

---
---

# 2. Frota

## Em uma frase

Onde está cada carro, quem pegou, quem devolveu, o que foi conferido antes de sair
e quando cada revisão vence.

## Quem entra

Precisa da permissão de **Frota**. Dentro dela, o que você vê muda:

- **Só "ver" ou "editar":** você dirige. Enxerga a área **Motorista**.
- **Pode "criar" ou "excluir":** você administra. Ganha **Gestão, Revisões e
  Plano**.
- **Permissão separada de relatórios:** ganha a aba **Relatórios**. É uma chave
  própria porque quem cadastra veículo não é necessariamente quem pode tirar a
  frota inteira em planilha — a aba mostra tudo, com contrato e valor. E ela não
  é atalho: sem administrar a Frota, a aba não aparece nem com a permissão.

**A separação é de atenção, não de sigilo.** Um motorista que precise do Renavam
para uma ocorrência pede a quem administra. O que a área Motorista faz é não
empurrar isso na cara de quem só quer pegar o carro e sair.

## Onde fica

**Central → Gestão Interna → Frota.**

## A tela, parte por parte

Cinco abas: **Motorista · Gestão · Revisões · Plano · Relatórios.** Abre em Gestão
para quem administra, em Motorista para quem dirige.

No topo de cada aba há **botões grandes** com o estado embaixo do nome — "Preciso
usar um carro / 3 carros livres". Cada um abre uma ficha que já existe ou rola até
uma seção mais abaixo; nenhum cria tela nova. Quando o número **não é sabido**, a
tela **não escreve linha nenhuma** — escrever "0" sobre um dado que não carregou é
a tela mentindo.

---

### Aba **Motorista**

O que a pessoa veio fazer, em ordem:

1. **Com você agora** — o carro que está com você. É provavelmente o que ela veio
   devolver.
2. **Seus pedidos** — as reservas que ela pediu.
3. **Livres para pegar** — o que ela pode pegar agora.
4. **Na rua com outras pessoas** — só para ela não achar que o carro sumiu. **Sem
   botão**, e sem os dados de quem administra.

**Carro na oficina ou fora da frota não aparece aqui.** Não há nada que o
motorista possa fazer com ele, e ocuparia a tela.

**O ciclo de retirada e devolução:**

- Ao retirar, a pessoa informa o **KM do painel** e o **nível de combustível**
  (Reserva, 1/4, 2/4, 3/4, Cheio). Tanque em 1/4 ou menos pede combustível antes
  da próxima saída, e a tela diz "abastecer".
- Ao devolver, a mesma coisa. **É da devolução que sai o KM atual do carro** — e
  isso é a diferença que muda tudo em relação à planilha, onde o KM era digitado à
  mão e por isso a aba de alertas nasceu vazia e nunca avisou nada.
- **Aceite de retirada:** quem pega o carro assina. Antes disso, das 5 retiradas
  reais que existiam no sistema, **nenhuma** tinha a assinatura de quem pegou.

---

### Aba **Gestão**

Seis **gavetas** — seções que abrem e fecham:

| Gaveta | O que tem dentro |
|---|---|
| **Aguardando sua decisão** | Os pedidos de reserva esperando aprovação |
| **Reservas e retiradas** | A linha do tempo de tudo, com a prova de cada uma |
| **Checklist de hoje** | Quem já fez, quem falta, com o telefone à mão |
| **Problemas em aberto hoje** | O que alguém marcou como problema no checklist |
| **Cópia das fichas no Zoho** | Quais fichas assinadas viraram PDF, e quais falharam |
| **Veículos do grupo** | A lista dos carros, para abrir a ficha de cada um |

**Duas regras mandam nas gavetas, e elas existem por um motivo específico:** quem
usa esta ferramenta tem dificuldade de uso, e gaveta fechada é informação que
sumiu.

1. **Abre sozinha a gaveta que tem algo esperando você.** Fica fechada a que é só
   consulta. E quando ela abre por urgência, **não dá para fechar** — deixar
   fechar o que está gritando devolveria o esconderijo.
2. **O título fechado já responde** — "faltam 8 de 10 hoje", "2 pedidos". A
   resposta chega antes do clique.
3. **O que você decidir vence.** Abriu ou fechou com a mão, é assim que você volta
   a encontrar — a memória é por pessoa, não por navegador.
4. **Gaveta vazia some** em vez de virar um título que abre para o nada. Mas
   atenção: **"não carregou" não é "vazio"**. Sumir com a gaveta porque a consulta
   falhou seria a tela dizendo que está tudo bem sobre o que ela não conseguiu ler.

**Sobre reservas:**

- Duas reservas do mesmo carro que se cruzam são conflito. **Encostar não é
  conflito** — quem devolve às 12h e quem pega às 12h passam a chave na mão.
- Reserva sem hora de volta é tratada como **o dia inteiro**: quem não sabe quando
  volta está ocupando o carro até o fim do dia, não por um instante.
- Situações: Aguardando aprovação · Aprovada · Recusada · Cancelada · Já usada.
- Quem administra pode **editar, cancelar e revogar** o que já foi decidido — com
  trava no banco, não só na tela.

**Pessoa de fora da empresa pode usar o carro.** O nome é escrito na hora, sem
cadastro. Isso existe por um caso real: em 11/08/2026 o Felipe, modelista
contratado, ia usar um carro por duas semanas, e não havia onde escrever o nome
dele — a saída na época foi pôr o próprio dono como motorista e escrever a verdade
no campo de finalidade.

**"Dar acesso a &lt;nome&gt;"** — no card do checklist de cada carro. Cria o login
do dono do carro, sorteia uma senha inicial (sem letras que se confundem: nada de
O/0 nem l/1), obriga a trocar no primeiro acesso e mostra um recado pronto para
mandar no WhatsApp. Só aparece se a pessoa tiver e-mail na ficha.

---

### A ficha do carro

Aberta a partir da lista, ela tem sete blocos:

1. **Identificação** — placa, nome, marca/modelo, ano, cor, chassi.
2. **De quem é, onde fica e com quem falar** — empresa, local, ambiente, dono fixo,
   departamento e o contato.
3. **Oficina** — situação atual.
4. **Histórico de manutenção** — o que já foi trocado.
5. **Contrato e valores** — contrato, aluguel por mês, valor FIPE.
6. **Seguro** — apólice e valor.
7. **Equipamentos e patrimônio** — o vínculo com o bem no Patrimônio, se houver.
8. **Checklists assinados** — as fichas assinadas daquele carro, com a conferência.

**O telefone do contato do carro não é o telefone de quem dirige.** Num carro de
rodízio o contato pode ser a supervisora de lojas — puxar esse telefone cego
mandaria "seu checklist está atrasado" para quem nunca pegou aquele carro. A
ferramenta sabe a diferença e não confunde as duas coisas.

---

### Aba **Revisões**

**Chegando a hora** e **Todos os carros, item por item.**

A conta é simples: **KM da última troca + o intervalo do plano = o KM alvo.** O
que faz isso funcionar aqui e não funcionar na planilha é de onde vem o "KM atual":
lá era digitado à mão, aqui cai sozinho de cada devolução.

**O aviso sai quando falta 10% do intervalo** — 700 km para um óleo de 7.000, uns
6.000 km para uma correia de 60.000. Proporcional, porque avisar 500 km antes da
correia seria tarde e 500 km antes do óleo seria cedo demais.

**Lançar manutenção:** um serviço com várias trocas de uma vez. KM, data e oficina
digitados **uma vez só**, virando várias linhas. Antes era preencher o formulário
inteiro por troca — 15 campos para 3 trocas. O resultado medido em 12/08/2026: a
frota inteira tinha **2 trocas registradas em 10 carros**.

**O KM do carro é o maior hodômetro já registrado**, não o da data mais recente.
Data digitada errada acontece o tempo todo; o odômetro só anda para frente.

---

### Aba **Plano**

Duas coisas, e é aqui que quem administra define as regras:

1. **Plano de manutenção** — o que a oficina troca, de quantos em quantos
   quilômetros.
2. **Checklist** — o que o motorista confere sozinho, e em que dia cai cada
   conferência.

**Por que o checklist é repartido em diário, semanal e mensal:** o documento
original tem 21 itens numa lista só, "antes de cada utilização". Um checklist de 21
itens toda manhã produz, em duas semanas, alguém marcando tudo OK sem olhar — e
**checklist que mente é pior do que checklist nenhum**.

---

### Aba **Relatórios**

Quatro relatórios, todos exportáveis:

| Relatório | O que traz |
|---|---|
| **Ficha dos veículos** | Placa, veículo, marca, ano, cor, empresa, local, ambiente, dono fixo, situação, contrato, código, aluguel, FIPE, observação |
| **Checklists assinados** | Data, placa, veículo, quem fez, hodômetro, resultado, o que apontou |
| **Revisões e manutenção** | Placa, veículo, item, situação, detalhe, trocar aos (km), última troca, km da última, oficina, custo |
| **Quem esteve com cada carro** | O histórico de quem dirigiu o quê |

## As regras que surpreendem

### A assinatura do checklist

Gravar um checklist assinado são **três escritas** — a ficha, as respostas e a
assinatura. Já aconteceu quatro vezes o mesmo defeito: duas gravações, só a
primeira conferida, e a tela dizendo "salvo" em cima da que falhou. Hoje a frase
que você lê no meio disso é a única coisa que impede você de achar que está tudo
certo, e ela é conferida a cada mudança.

### A conferência da assinatura tem quatro estados, não dois

O mais importante: **"alguma coisa mudou depois de assinada"** é uma **acusação**,
e só aparece nesse caso. Os outros três estados dizem outras coisas — assinada e
íntegra, assinada num formato antigo, e não assinada. Confundi-los transformaria
"ainda não assinou" em "adulterou", que é grave e falso.

### Quem administra pode preencher o checklist por qualquer carro

É uma saída de emergência que virou o normal, e o motivo está registrado: **três
donos de carro não têm login** — sem login não recebem o aviso das 7h30, não
assinam nada, e o único canal que sobra é o WhatsApp. O botão "Dar acesso" existe
justamente para tirar essa muleta.

### O robô das 7h30

Roda todo dia e avisa quem tem checklist pendente. **Ele nasce desligado.**

> **Esta é a pendência que trava mais coisa.** Medido em 11/08/2026: a ferramenta
> estava no ar desde 06/08 e existiam **2 checklists no total**, 1 assinado, o mais
> recente de 07/08. Fizeram o teste e parou. Sem o aviso, ninguém lembra. E sem
> checklist diário não nasce o registro de quem estava com o carro — que é
> exatamente o que falta para cobrar as multas e calcular o custo por km.
>
> Liga-se em **Administração → Usuários**.

### As cópias em PDF no Zoho

Cada ficha assinada vira um PDF arquivado. A gaveta mostra quem subiu, quem falhou
e o que fazer. Ela existe porque a fila já guardava tudo isso e **nada aparecia em
lugar nenhum** — e uma fila que ninguém enxerga é exatamente como um papel sumir
sem ninguém notar.

## O que ela não faz

- **Não cobra multa nem calcula custo por km ainda.** Depende do registro diário de
  quem estava com o carro, que depende do aviso das 7h30 estar ligado. Há
  R$ 1.301,60 em multas sem condutor identificado esperando isso.
- **Dois carros não têm dono nenhum** (um Fiat Bravo e um Fiat Doblo). Sem dono
  fixo não há de quem cobrar o checklist, e eles nunca entram no quadro nem no
  aviso.
- **O valor do seguro está vazio nos 10 carros.** Enquanto estiver, qualquer conta
  de custo do carro sai por baixo — falta uma das três parcelas fixas (aluguel,
  FIPE, seguro).
- **Não existe o caminho provado de ponta a ponta do convite:** clicar, a pessoa
  entrar, ser obrigada a trocar a senha e chegar no checklist. Provar isso exigiria
  criar um login de verdade numa conta real. **O primeiro convite é também o
  teste.**

---
---

# 3. Central de Conteúdo

## Em uma frase

Onde o post **orgânico** (post normal, não anúncio pago) de cada marca é planejado
do começo ao fim: alguém monta a peça, ela passa por aprovação, fica agendada com
data e hora, e na hora marcada chega um aviso no celular com a arte e a legenda
prontas para publicar.

**Não confundir:**
- **Redes Sociais** *mede* o que já aconteceu.
- **Estúdio de Criativos** sobe *anúncio pago*.
- **Esta aqui** é a única que trata de post orgânico.

## Quem entra

**São duas permissões separadas:**

- **Conteúdo** — entra na ferramenta, cria e edita peça.
- **Conteúdo · aprovar** — decide (aprova ou reprova) a peça dos outros.

São duas chaves porque a matriz de permissões tem colunas fixas (ver, criar,
editar, excluir, exportar) e não dava para inventar uma coluna "aprovar" só para
esta ferramenta.

> **O cadeado de aprovar não está no botão — está no banco.** O motivo é simples:
> a chave de acesso está no programa que qualquer pessoa baixa, então esconder o
> botão não protegeria nada. O botão escondido é só cortesia; quem realmente
> impede é a trava do banco.

## Onde fica

**Central → Redes Sociais → Central de Conteúdo.**

## A tela, parte por parte

No topo: **o seletor de marca** (qual perfil do Instagram) e **uma busca só**, que
atravessa as abas junto com você.

Quatro abas, agrupadas **pelo que a pessoa está fazendo** — não pelo tipo de
visualização. Eram seis, e três delas eram formas de olhar a mesma coisa.

---

### Aba **Home**

O **mês** e **como o perfil vai ficar**, lado a lado.

- **O calendário do mês**, em quadros, com as peças no dia delas.
- **A prévia do feed** — a grade de 3 colunas do Instagram, mostrando como o perfil
  vai ficar quando tudo for publicado.

---

### Aba **Programação**

O trabalho em andamento, em duas formas na mesma aba:

- **Quadro** — as peças em colunas por etapa. Funciona **arrastando** e também com
  um botão **"Mover para"**, porque arrastar não existe em tela de toque.
- **Lista** — a tabela, com filtro por situação e ordenação.

**As sete etapas de uma peça:**

| Etapa | O que é |
|---|---|
| Rascunho | Está sendo montada |
| Em aprovação | Esperando alguém decidir |
| Aprovada | Pode ser agendada |
| Agendada | Tem data e hora marcadas |
| Publicada | Saiu |
| Reprovada | Voltou com um motivo escrito |
| Arquivada | Saiu do fluxo |

**Só as passagens abaixo acontecem** — qualquer outra é recusada:

- Rascunho → em aprovação, ou arquivada
- Em aprovação → aprovada, reprovada, ou **de volta para rascunho**
- Aprovada → agendada, rascunho, ou arquivada
- Reprovada → rascunho ou arquivada
- Agendada → publicada, aprovada, ou arquivada
- Publicada → arquivada
- Arquivada → rascunho

**Voltar para rascunho é desistir do pedido, não decidir sobre ele** — por isso
não exige permissão de aprovar: quem enviou pode se arrepender.

**As duas únicas passagens que exigem aprovador** são aprovar e reprovar.

**Os quatro formatos e as regras de arquivo:**

| Formato | Arquivos |
|---|---|
| Post do feed | exatamente 1 |
| Carrossel | de 2 a 20 |
| Reels | 1, e só vídeo |
| Story | 1 |

**O painel da peça** tem: os arquivos, a legenda (com contagem e tratamento de
hashtag), a data e hora, quem vai publicar, observações da equipe, e os botões de
mover de etapa.

---

### Aba **Ideias**

O banco de pautas — o que ainda não virou peça.

**"Gerar ideias com IA"** enfileira um pedido e dispara o robô. Leva de 1 a 3
minutos e a tela acompanha sozinha. Cada ideia vem como **roteiro**, não como
tópico: a ideia em uma linha, o pilar, o porquê agora, os 3 primeiros segundos, as
falas e a chamada do fim. Dá para **ler o que a IA fez** e **escrever um à mão**.

**"Virar peça"** transforma a ideia numa peça em rascunho.

**O que faz a IA valer é o contexto, não o modelo.** Qualquer IA escreve "poste um
bastidor da loja". O que ela não adivinha, e que vai no pedido:

- os posts desta marca que **mais** renderam e os que **menos** renderam
- o que já está na agenda, para não repetir
- como a marca escreve
- **contra quem ela disputa** — os concorrentes **dela**
- o mês e as datas comerciais do varejo

**Custo:** cada rodada aparece sozinha no Painel de Status do Claude, com tokens e
valor em reais.

---

### Aba **Voz da marca**

Onde se preenche o que a IA não tem como adivinhar:

- **Como esta marca fala** — o tom de voz, em blocos de texto.
- **Contra quem esta marca disputa** — os concorrentes.
- **Usar o Portal de Notícias no briefing** — uma caixinha, que **nasce
  desmarcada**.

O painel mostra também **o que o sistema já junta sozinho**. Sem isso, quem recebe
uma pauta fraca não sabe se faltou cadastro ou faltou histórico.

> **Concorrente é da marca, nunca do sistema.** O robô puxava a lista do Portal de
> Notícias sem filtro, e aquela lista é 100% moda e calçado. Resultado: a primeira
> pauta real de uma marca pessoal citou @Isla e @Santa Lolla como concorrentes
> dela. Hoje cada conta tem a sua lista.
>
> **Junto vai a regra de discrição:** a IA **nunca** cita o nome nem o @ de um
> concorrente em texto que vá ao ar. Ela fica no pedido mesmo sem concorrente
> cadastrado — o modelo pode citar uma marca de memória.

## As regras que surpreendem

### Por que ela não publica sozinha

O aplicativo da Meta da empresa **ainda não tem a permissão de publicar**, que
depende de uma análise da própria Meta. Até lá, na hora marcada o sistema
**avisa** em vez de publicar.

Isso é provisório de propósito. O programa **já sabe publicar** — os dois passos da
conversa com a Meta, carrossel, reels e stories, com 25 testes. O interruptor está
desligado à espera da permissão. Quando ela sair, liga-se **conta por conta,
começando por uma marca**, e nenhuma peça já cadastrada precisa ser refeita.

Medido em 03/08/2026: falta **só** a permissão de publicar; as outras sete que o
sistema usa já funcionam.

### Os dois robôs

- **Hora H** — de 5 em 5 minutos. Avisa no celular quando chega a hora de
  publicar. Ele **reserva a peça antes** de mandar o aviso, senão duas execuções
  cruzadas avisariam duas vezes.
- **Espelho** — de 30 em 30 minutos. Procura no Instagram o post que saiu e traz
  curtidas e alcance de volta. Mede todo dia na primeira semana, depois semanal, e
  para aos 30 dias.

**Os dois nascem desligados**, e ligar é decisão do dono — o Hora H dispara
notificação em celular de verdade.

### Como o espelho decide que achou o post

Nota = **70% semelhança da legenda + 30% proximidade do horário**. Só casa sozinho
com nota de 0,85 para cima **e** sem nenhum outro candidato perto. Qualquer dúvida
vira a pergunta **"É este o post no Instagram?"** na tela.

**É conservador de propósito.** Vincular a peça errada mostraria o desempenho de um
post no card de outro, e o número pareceria plausível — ninguém perceberia.

### Story é diferente

A Meta não devolve story de forma confiável (ele some em 24h). **Story só vira
"publicado" pelo botão "Já publiquei", e não tem métrica coletada.** Está assim
porque fingir que funciona seria pior.

### O fuso

Todo horário que você vê e digita é **de Brasília**. Por baixo fica em horário
universal, e a conversão dos dois lados é conferida por teste de ida e volta.

## O que ela não faz

- **Não publica sozinha** — falta a permissão da Meta (acima).
- **Os dois robôs ainda não estão ligados.** É clique, não código.
- **Story não é medido.**

---
---

# 4. Redes Sociais

## Em uma frase

O painel que **mede o que já aconteceu** no Instagram de cada marca: seguidores,
quanto foi investido em anúncio e a que custo, engajamento e quanto conteúdo foi
publicado — tudo comparado com uma meta e com o período anterior.

É a maior tela do aplicativo.

## Quem entra

Quem tem acesso às **Redes Sociais**. Ela é feita para ficar aberta — inclusive
numa TV.

## Onde fica

**Central → Redes Sociais → Dashboard.**

## A tela, parte por parte

### O topo

- **Período: HOJE · 1D · 7D · 14D · 30D · MÊS · MÊS PASS. · ATÉ AGORA**, mais um
  **seletor de datas personalizado** (o botão de calendário).
- **Os perfis (marcas)**, logo abaixo da barra. Clique num perfil para trocar de
  conta.
- **AUTO** — um interruptor que fica **passeando sozinho entre os perfis** quando
  ninguém mexe no mouse por alguns segundos. É para deixar numa TV girando as
  marcas.
- **Exportar** — CSV ou Excel.
- **Se o coletor parar, aparece um aviso vermelho no topo** dizendo que os dados
  estão desatualizados.

---

### 01 · Seguidores

- **Total de seguidores.**
- **Quantos entraram no período**, com um selo: **"confirmado pelo Instagram"** ou
  **"em consolidação"**. O botão de ajuda ao lado explica a diferença.
- **Gráfico de seguidores ganhos e perdidos por dia.** Passando o mouse sobre um
  dia, abre um balão com **Seguiram**, **Deixaram**, o **Líquido** daquele dia, e
  a comparação com o mesmo dia do mês anterior, com seta para cima ou para baixo.

---

### 02 · Meta Ads

Tem uma **barra de tipo de campanha** em cima: **Todos · Seguidores · Contatos ·
Site e alcance · Vendas.** Escolher um tipo faz os cartões falarem só daquele
dinheiro — e os indicadores mudam junto:

| Tipo | O que ele mostra |
|---|---|
| **Todos** | Investimento, custo por mil impressões, alcance e frequência — os quatro que valem para qualquer campanha |
| **Seguidores** | Custo por seguidor, por interação e por curtida |
| **Contatos** | Custo por conversa e por cadastro |
| **Site e alcance** | Custo por visita |
| **Vendas** | Custo por venda |

**Quem decide o tipo de cada campanha é o destino que a Meta afirma no conjunto**
(perfil, WhatsApp, site) — **nunca o nome da campanha**. A tela abre em
"Seguidores", ou em "Todos" se o perfil não tiver campanha de seguidor no período.

**"Filtrar campanhas"** continua existindo e vale **dentro** do tipo escolhido.

**Tipo sem gasto no período fica apagado, com o motivo — não some.**

---

### 03 · Engajamento

Curtidas, comentários, salvamentos, compartilhamentos, interações totais, visitas
ao perfil e visualizações — de posts, reels e stories.

**Cada cartão de interação abre em três linhas:** **Orgânico** (o que veio
sozinho), **Anúncios** (o que o dinheiro comprou) e o **Total**. É a separação que
responde "isso foi o conteúdo ou foi a verba".

O cartão de curtidas traz um aviso escrito: **o número dos anúncios vem direto da
Meta e não tem relatório para conferir contra**. Fica dito na tela porque esse foi
exatamente o caminho por onde as curtidas apareceram zeradas — a Meta responde
pela metade e ninguém percebe.

---

### 04 · Conteúdos criados/postados

Quantos stories, posts e reels saíram no período.

---

### A meta de cada cartão

Cada card tem uma **META editável**: clique no número, digite o novo valor e clique
fora (ou aperte Enter). A barrinha de progresso atualiza sozinha.

**A meta é salva por conta + período**, tanto no seu navegador quanto no banco —
ou seja, ela é **compartilhada** com quem mais usar o painel.

## As regras que surpreendem

### "—" não é "R$ 0,00"

Onde não dá para calcular, o cartão mostra **"—"** e nunca R$ 0,00. **Número que
ainda não foi coletado e número que é zero de verdade são coisas diferentes**, e
já custou caro: uma falha virou "R$ 0,00" na tela e ficou assim por 17 horas sem
ninguém saber que era falha.

### A frequência não tem meta editável

Ela acende vermelho **a partir de 4**, que é o mesmo limite que a Gestão de
Tráfego usa para mandar reduzir verba. As duas telas usam a mesma régua de
propósito.

### O aviso de tipo não confirmado

**Perfil recém-adicionado**, antes da primeira coleta dos conjuntos: a tela avisa
em vermelho que a classificação por tipo ainda é **provisória** — o destino de cada
campanha ainda não foi confirmado, então ela cai pelo objetivo, que às vezes
engana. O aviso some sozinho assim que o coletor passar por aquele perfil.

O mesmo aviso aparece **com a contagem** quando só algumas campanhas estão nesse
estado ("3 campanhas ainda sem tipo confirmado") — é o caso de campanha criada
agora.

### Dois tipos aparecem apagados, e isso não é defeito

**"Vendas" fica apagado de propósito e vai continuar assim.** As campanhas que
vendem nestas contas vendem **pelo WhatsApp**, e campanha de WhatsApp conta em
"Contatos" — medida por custo por conversa, que é o número que interessa ali. Faz
tempo que não roda campanha de venda. Se um dia rodar uma que venda direto no site
ou no catálogo, ela aparece em Vendas sozinha, sem ninguém mexer em nada.

**"Site e alcance" aparece apagado na maior parte dos perfis hoje.** Ele tem
dinheiro no histórico, mas não nas coletas recentes. Botão apagado quer dizer **"não
teve dinheiro desse tipo neste período"**, nunca "quebrou". Trocar o período para
uma janela maior costuma reacendê-lo.

### MÊS e ATÉ AGORA ainda não mostram os números novos

Nesses dois períodos, **custo por conversa, por cadastro, por venda e por visita
ficam em "—"**, mesmo que apareçam normalmente em 7D e 30D.

O motivo: esse recorte é gravado por um robô antigo que ainda não pede essas
contagens à Meta. Os números de sempre — investimento, impressões, cliques,
alcance — continuam normais nesses dois períodos.

**Está registrado com o conserto exato no item B17 da lista de pendências.**

### De onde vêm os dados

De um **coletor automático que roda 4 vezes por dia**. A tela nunca chama a Meta
direto para os números do painel; ela lê o que o coletor gravou.

### Ela é 100% independente das outras telas

Não compartilha estado com Gestão de Tráfego, Gestão à Vista nem Análise de
Campanhas. Cada uma tem sua própria cópia dos pedacinhos de visual que se parecem
— **de propósito**, para não quebrar uma mexendo na outra.

## O que ela não faz

- **Não mexe em campanha.** Ela só lê. Quem mexe é a Gestão de Tráfego.
- **Existe um painel de administração embutido nesta tela** (convidar por e-mail,
  listar usuários) que **nenhum botão do painel abre hoje**. Isso já vinha assim do
  site antigo; não foi quebrado. Para administrar usuários, use a Administração.
- **Este capítulo descreve a tela como ela está em 17/08/2026.** A seção 02 recebeu
  mudanças recentes e há trabalho em andamento nos gráficos para celular.

---
---

# 5. Patrimônio

## Em uma frase

O inventário de bens da empresa: o que a empresa tem, onde está, quanto vale e com
quem está. São algumas centenas de bens cadastrados — o número exato está na aba
**Resumo**, que é quem manda; qualquer número escrito aqui envelheceria.

## Quem entra

Precisa da permissão de **Patrimônio**. A aba **Relatórios** tem chave própria.

## Onde fica

**Central → Gestão Interna → Patrimônio.**

## A tela, parte por parte

> **Esta tela é usada principalmente no celular**, e isso decidiu o desenho:
> cartão, nunca tabela larga, no telefone. Filtro numa faixa que rola, nunca
> quebrando em várias linhas.

Cinco abas: **Navegar · Planilha · Resumo · Etiquetas · Relatórios.**

---

### Aba **Navegar**

A lista dos bens, em cartões, com:

- **Busca por texto.**
- **Filtros:** categoria, situação, local, com quem está.
- **"Limpar filtros"** e **"Limpar seleção"**.
- **O total** dos bens que passaram pelo filtro — o patrimônio daquele recorte.

**A ficha de cada bem** tem:

| Campo | Observação |
|---|---|
| Nome do bem | |
| Categoria | O que o bem **é**. Não depende de onde ele está |
| Tipo | |
| Marca / modelo | |
| Empresa | De qual marca do grupo é o bem |
| Local e Ambiente | Onde ele está |
| **Com quem está** | **Opcional, de propósito** — veja abaixo |
| Situação | Em uso, em estoque, em manutenção… |
| Nº da etiqueta | |
| IMEI / nº de série | Desde 13/08/2026 |
| Data da compra | |
| Valor de compra | |
| Observação | |
| **Situação na Frota** | Se for um veículo — veja abaixo |

Mais o **histórico de posse**: quem esteve com o bem, e quando.

**O botão "+" está em todo campo de escolha.** Se a pessoa, o local ou a categoria
que você precisa não está na lista, você cadastra ali, sem sair da tela. Sem essa
opção a pessoa **trava**.

---

### Aba **Planilha**

A mesma informação em tabela larga, para quem está no computador. Colunas: Nº,
IMEI/nº de série, item, categoria, tipo, marca/modelo, marca (empresa), local,
ambiente, com quem, situação, etiquetado, compra, valor, observação.

**"Exportar Excel"** baixa isso.

---

### Aba **Resumo**

**Onde está o dinheiro.** É a aba dinâmica da planilha antiga, viva: quantidade e
valor total por categoria, por local, por situação.

---

### Aba **Etiquetas**

O controle da numeração física das etiquetas.

- **Próximo livre** — qual número usar agora.
- **Fora da numeração atual** — bens com número que não bate com a faixa.
- **"Ler a etiqueta com a câmera"** — aponta a câmera do celular para a etiqueta e
  ela acha o bem.
- **A numeração tem um teto**, e quando ele acaba a própria tela oferece ampliar.

**Quando a câmera não abre, a tela diz exatamente por quê** — e são seis motivos
diferentes, cada um com o seu conserto: o endereço não permite câmera, o navegador
não abre câmera, a câmera está bloqueada para este site, não há câmera no
aparelho, a câmera está ocupada por outro programa, ou deu um problema
desconhecido. Um "não consegui" genérico deixaria a pessoa sem saída.

---

### Aba **Relatórios**

Dois relatórios: **Bens** e **Com quem está cada bem**.

## As regras que surpreendem

### O bem pode não estar com ninguém

**Dono é opcional, de propósito.** No inventário real, **88% dos bens não estão com
uma pessoa** — estão em estoque ou em manutenção. Exigir um dono obrigaria a
inventar um.

### A ligação com a Frota se mexe dos dois lados

Um bem de categoria **Veículos** pode estar ligado a um carro da Frota. Da ficha
do bem você pode:

- **Ligar a um carro que já existe.**
- **Criar um carro a partir do bem.**
- **Desfazer a ligação.**

**Mas isso grava na ficha do carro**, então exige a mesma permissão da Frota. Ter
Patrimônio não basta.

### A ficha mostra bens e carros da pessoa

Na ficha do colaborador aparece o que ele tem em mãos — só leitura. Registrado
porque já falhou: a caixa lia uma lista morta e dizia "nenhum" para 27 pessoas que
tinham bens.

## O que ela não faz

- **Não faz baixa contábil nem depreciação.** Ela guarda o valor de compra, não o
  valor atual.
- **Não imprime a etiqueta sozinha** — a geração da etiqueta (código de barras) é
  parte da ferramenta, mas a impressão é feita fora.
- **Não escreve na Frota sem permissão de Frota** (acima).

---
---

# 6. Administração

## Em uma frase

Quem entra na plataforma, o que cada pessoa vê, quais perfis do Instagram estão
conectados, as metas de venda do mês e a saúde da coleta de dados.

> ## ⚠ Leia isto antes de clicar em qualquer coisa nesta tela
>
> **Esta tela cria e exclui contas de usuário de verdade, e muda permissões reais.**
>
> - **"Enviar convite" / "Criar com senha"** cria acesso de verdade à plataforma.
> - **"Excluir"** apaga a conta e o perfil da pessoa **para sempre**. Sempre pede
>   confirmação; se você não tem certeza, cancele.
> - **"Permissões"** muda o que aquela pessoa consegue ver e fazer. Errar aqui pode
>   dar acesso a algo sensível, ou tirar acesso de quem precisa.
> - **A caixinha "só os canais dos times dela", desmarcada, faz a pessoa enxergar o
>   faturamento de TODAS as lojas e canais.** É a mudança de maior alcance desta
>   tela depois de excluir usuário.
> - **Trocar a senha pela ficha** troca a senha de verdade: a antiga para de
>   funcionar na hora.
> - **Aprovar ou negar uma solicitação** é uma decisão real sobre quem entra.
> - **"Salvar como perfil", dentro de Permissões:** se você digitar o nome de um
>   perfil **que já existe**, ele **regrava aquele perfil** e muda o acesso de
>   **todo mundo que está nele** de uma vez — não só da pessoa cuja ficha está
>   aberta.
>
> Antes de gravar, a tela mostra uma janela com o nome de cada pessoa afetada e o
> que ela **perde**, ganha ou tem trocado de nível. Leia até o fim. **Cancelar
> nunca muda nada.**

## Quem entra

**Só quem tem o papel de administrador.** Qualquer outra pessoa é redirecionada de
volta para a Central automaticamente.

## Onde fica

**Central → Administração.**

## A tela, parte por parte

A barra da esquerda tem **cinco itens em três grupos**:

**Gestão:** Usuários · Contas · Solicitações
**Vendas:** Metas
**Plataforma:** Dados

> **Nota de revisão (17/08/2026).** O texto interno desta ferramenta ainda cita as
> abas **Aparência**, **Sistema** e **Saúde dos dados** como itens da barra. **Elas
> não existem mais como item da barra.** Aparência e Sistema foram removidas;
> Saúde dos dados virou uma faixa de aviso dentro de **Dados** (explicado adiante).
> Este manual descreve a tela como ela está hoje.

---

### **Usuários** (abre por padrão)

Duas partes na mesma tela.

**1. Times de venda** — lojas, canais e setores, e quem trabalha em cada um.

Três tipos:
- **Loja** — ponto físico que vende.
- **Canal** — vende sem loja física.
- **Setor** — não vende.

**As pessoas do time aparecem dentro do card da loja delas**, e é **o mesmo
cartão** da lista de baixo — não um parecido. Por isso foto, papel, Permissões,
desativar e excluir são iguais nos dois lugares, e tocar no nome abre a mesma
ficha.

Colada embaixo do cartão vem uma faixa curta com **o que é do time e não existe no
cartão**, e só isso:

- **O papel dela no time** — Vendedora, Supervisora ou Gestor.
- **"estoque"** — estar no time mostra as **vendas**; o estoque é liberado à parte.
  Quando o direito já vem do papel (supervisora, gestora), a caixinha aparece
  **marcada e travada** — porque desmarcá-la não faria nada, e caixinha que não
  obedece ensina a não confiar na tela.
- **"Tirar do time".**

**2. A lista "Sem time de venda"** — todo mundo que não está num time.

**Quem está num time não aparece na lista de baixo.** A pessoa mora num lugar só;
repetir a mesma pessoa em duas listas é como duas telas começam a divergir.

**Cada cartão de pessoa tem:** foto, nome editável, papel (visualizador ou
administrador), **Permissões**, desativar e excluir. Tocando no nome abre a ficha,
que é onde fica a **troca de senha** (só super-administrador).

**"Convidar novo usuário"** — enviar convite por e-mail ou criar direto com senha.

**"Puxar as vendedoras das vendas"** — lê quem vendeu no Bling, junta cadastros
repetidos, sugere loja e e-mail, e cria as contas que você marcar. **"Todas começam
com o acesso de"** aplica um perfil salvo às contas criadas; **o padrão é "sem
nada", porque permissão nasce desmarcada.**

---

### **Contas**

Os perfis do Instagram conectados à plataforma: nome, usuário e cor de destaque.

---

### **Solicitações**

Pedidos de acesso de gente de fora, para **aprovar** ou **negar**.

---

### **Metas**

Importa uma planilha (.xlsx, .xls ou .csv) com as metas de vendas do mês **por
canal/loja e por vendedora**. Tem botão para **baixar o template pronto**.

---

### **Dados**

- **Contadores gerais do banco.**
- **Última coleta por conta.**
- **Ações de manutenção:** "Atualizar fotos de perfil" e "Rodar coletor de dados".
  **Nenhuma das duas executa nada sozinha** — as duas só mostram o comando de
  terminal para você copiar.
- **A faixa de Saúde dos dados** (veja abaixo).

**Saúde dos dados** é uma verificação automática que roda **todo dia às 23:30** e
confere frescor, consistência e anomalias das métricas de todos os perfis.
Clicando na faixa, abre o detalhamento por perfil, com o que está ok, com aviso ou
com problema, e um botão para **rodar e corrigir na hora**.

> **Por que a faixa continua existindo depois de a aba sair.** A aba foi removida a
> pedido do dono, mas ela estava **certa**: as 13 falhas por dia que ela acusava
> eram o defeito das curtidas zeradas, e ela era **o único lugar que avisava**.
> Apagar o aviso junto com a tela repetiria o silêncio que deixou o defeito
> invisível por semanas. **A faixa some sozinha quando não há falha** — aviso que
> fica sempre aceso vira paisagem.

## As regras que surpreendem

### Onde mora cada tipo de permissão

- **"Só os canais dos times dela"** mora no editor de **Permissões**, no bloco
  Canais de Venda — **não** no card da loja. Ela é da **pessoa** e vale no sistema
  inteiro dela; numa caixinha dentro do card de uma loja, mentiria por omissão. É
  ela que faz a Gestão à Vista e a Análise de Vendas mostrarem só a loja dela ou
  tudo. **Só super-administrador muda**, e desligar abre **todos** os canais —
  inclusive os de times que quem clica não administra.
- **A troca de senha** mora na ficha (toque no nome).
- **O canal de venda não tem lista própria por pessoa, de propósito.** Canal é o
  time, e quem decide é a trava do banco. Uma segunda lista seria uma segunda
  verdade sobre a mesma pergunta.

### A confirmação só aparece quando o valor muda de verdade

Ao salvar, a tela pergunta e diz o tamanho do estrago — mas **só pergunta quando o
valor mudou**. Perguntar sempre ensinaria a clicar em "sim" sem ler.

### Permissão nasce desmarcada

Sempre. Chave nova, módulo novo, conta nova: ninguém ganha acesso por padrão.
Módulo novo tem permissão própria; ele não pega carona na permissão do módulo pai.

### O aviso do checklist da Frota liga aqui

A pendência mais travante da Frota — o robô das 7h30 que avisa quem tem checklist
pendente — **se liga nesta tela, em Usuários**. Ela nasce desligada, e enquanto
estiver desligada o robô roda, não manda nada, e ninguém sabe que não mandou.

## O que ela não faz

- **Não executa o coletor nem a atualização de fotos** — só mostra o comando para
  copiar.
- **Não configura mais a aparência da plataforma** (nome, frase de rodapé, cor de
  destaque). Essa seção não existe mais nesta tela.
- **Não mostra mais as informações de infraestrutura** (banco, hospedagem, validade
  dos tokens da Meta). Essa seção também saiu.

---
---

# Os outros dois arquivos desta pasta

- **`manual-da-central.md`** — o que **cada uma das 20** ferramentas faz, em
  resumo. É por onde começar; este aqui é o aprofundamento de seis delas.
- **`pendencias.md`** — o que está **em aberto**: o que falta, por que importa e
  onde se resolve.

Os dois manuais descrevem o que **existe**. O `pendencias.md` descreve o que
**falta**.
