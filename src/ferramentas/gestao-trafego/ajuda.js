// GLOSSÁRIO da ferramenta: o texto de cada botão "?" .
//
// Por que existe: o dono pediu explicitamente "preciso de muita explicação dentro
// dessa ferramenta". A métrica ponderada é um conceito inventado aqui — ninguém
// nasce sabendo o que é um "ponto" — e sem explicação ao lado do número, a tela
// vira um painel de fé.
//
// Regras de escrita (valem para toda entrada nova):
//  - português literal, sem jargão: quem lê é o dono do negócio, não um programador;
//  - explicar POR QUE, não só o que — o "por quê" é o que faz a pessoa decidir;
//  - usar número de verdade sempre que ajudar (os daqui vieram das contas dele,
//    medidos em 90 dias, e ensinam mais que qualquer definição);
//  - dizer também PARA QUE NÃO SERVE quando houver risco de leitura errada.
//
// PURO: só texto. Sem rede, sem tela.

export const AJUDA = {
  ponto: {
    titulo: 'O que é "ponto"',
    texto: `<p><b>Ponto é uma moeda que inventamos para comparar interações diferentes.</b></p>
      <p>Uma curtida vale 1 ponto. Um comentário vale 10. Um salvamento vale 30, um compartilhamento vale 20 — porque quem salva pretende voltar naquilo, e quem compartilha leva sua marca para a rede dele.</p>
      <p>Somando tudo, você sabe quantos pontos a campanha comprou. É a forma de dizer "esta campanha trouxe 100 curtidas" e "aquela trouxe 3 salvamentos" na mesma unidade.</p>`,
  },

  custo_por_ponto: {
    titulo: 'Custo por ponto',
    texto: `<p><b>Quanto você paga por uma "curtida-equivalente" de engajamento.</b></p>
      <p>Exemplo real seu — a campanha Topo Funil, com R$ 1.403,85 gastos:</p>
      <p>883 curtidas (883 pontos) + 11 comentários (110) + 75 salvamentos (2.250) + 88 compartilhamentos (1.760) = <b>5.003 pontos</b>.<br>
      R$ 1.403,85 ÷ 5.003 = <b>R$ 0,28 por ponto</b>.</p>
      <p><b>Para que NÃO serve:</b> como curtida costuma ser a grande maioria do volume, este número acaba parecido com "custo por curtida". Ele compara campanhas de engajamento entre si; ele não diz se a campanha entregou aquilo que você queria dela. Para isso, declare o objetivo dela no cartão.</p>`,
  },

  qualidade: {
    titulo: 'Qualidade da interação',
    texto: `<p><b>Quanto vale, em média, uma interação daquela campanha.</b> É os pontos divididos pelas interações.</p>
      <p>Qualidade 1,2 quer dizer "quase tudo curtida". Qualidade 2,8 quer dizer que cada interação vale quase 3 curtidas — a campanha está trazendo salvamento e compartilhamento, não só curtida.</p>
      <p>Nas suas campanhas, as mais <b>baratas</b> por ponto são justamente as de qualidade 1,2, e as mais <b>caras</b> são as de qualidade 2,3 a 2,8. Ou seja: engajamento profundo custa mais. Nem sempre o mais barato é o que você quer.</p>`,
  },

  pesos: {
    titulo: 'Quanto vale cada interação',
    texto: `<p>Aqui você diz <b>o quanto cada interação vale para você</b>. É o que transforma interações diferentes em pontos comparáveis.</p>
      <p>Se salvar vale 30, é como afirmar: "um salvamento me interessa tanto quanto 30 curtidas".</p>
      <p><b>Atenção — peso não é preço.</b> Você diz que um salvamento vale 30 curtidas; o mercado cobra cerca de <b>400</b> por ele (R$ 48 contra R$ 0,12). Por isso existe também a meta por interação: peso é o quanto vale para você, preço é o que a Meta cobra.</p>`,
  },

  meta_resultado: {
    titulo: 'Quanto você aceita pagar por resultado',
    texto: `<p><b>É o número que faz o cartão acender verde, amarelo ou vermelho.</b></p>
      <p>Cada tipo de campanha é medido pelo resultado que ele realmente compra: campanha de lead pelo custo por lead, de WhatsApp pelo custo por conversa, de venda pelo custo por venda. Engajamento é a exceção — não compra uma ação só, então é medido por ponto.</p>
      <p>Todas as metas são "menor é melhor". Usamos custo por venda em vez de ROAS de propósito: ROAS é o contrário (maior é melhor) e obrigaria você a manter duas réguas na cabeça.</p>
      <p><b>Campo vazio é de propósito:</b> se sua conta ainda não produz aquele resultado, meta ali seria número inventado. Sem meta, a campanha é julgada pelas regras de saúde do objetivo dela.</p>`,
  },

  meta_interacao: {
    titulo: 'Quanto você aceita pagar por cada interação',
    texto: `<p>Cada interação é um <b>mercado com preço próprio</b>. Medido nas suas campanhas, em 90 dias:</p>
      <p>curtida <b>R$ 0,12</b> · compartilhamento <b>R$ 13 a 21</b> · salvamento <b>R$ 48 a 51</b> · comentário <b>R$ 128 a 172</b>.</p>
      <p>Um salvamento custa cerca de 400 curtidas. Um comentário, 1.300.</p>
      <p>Estas metas só valem para campanha de engajamento em que você <b>declarar, no cartão dela</b>, qual interação ela está comprando. Sem declarar, ela continua sendo medida pelo ponto.</p>`,
  },

  cores: {
    titulo: 'Onde a cor vira',
    texto: `<p>O semáforo compara o que você <b>pagou</b> com o que você <b>aceita pagar</b>.</p>
      <p>Até 80% da meta é verde forte — sobra espaço para escalar. Até a meta, verde. Até 30% acima, amarelo: observar. Acima disso, vermelho.</p>
      <p>Os valores em reais que aparecem ao lado já são a sua meta multiplicada por esses limites, para você não precisar fazer a conta.</p>
      <p><b>Se estiver quase tudo vermelho</b>, provavelmente a meta está ambiciosa demais. Uma régua que só mostra vermelho para de ser lida — e aí ela não separa mais a campanha ruim da péssima.</p>`,
  },

  funil: {
    titulo: 'O que o funil mostra',
    texto: `<p>O caminho que as pessoas fazem nas campanhas que estão <b>no ar agora</b>: quantas viram, quantas clicaram e quantas chegaram no resultado. Um bloco para cada tipo de campanha que esta conta roda.</p>
      <p><b>Nem todo tipo tem funil de verdade.</b> Em campanha de mensagem, de cadastro ou de venda, o resultado acontece <i>depois</i> do clique — aí faz sentido ver quanto se perde em cada degrau.</p>
      <p>Já em engajamento, curtir ou salvar acontece <i>no lugar</i> do clique, não depois. Por isso ali o número aparece como proporção — quanto rendeu por pessoa alcançada — em vez de fingir que é um degrau. Se fosse empilhado, apareceria algo como "11.000% de quem clicou", que não quer dizer nada.</p>
      <p>A frequência ao lado das pessoas alcançadas diz quantas vezes o anúncio apareceu para cada uma. Acima de 3 ou 4, o mesmo público está vendo demais.</p>`,
  },
  fila: {
    titulo: 'O que é a fila',
    texto: `<p>Todo dia de madrugada o robô olha suas campanhas e propõe mexer no orçamento de algumas. <b>Essas propostas param aqui</b> e não acontecem sozinhas — nada muda na Meta sem você aprovar.</p>
      <p>Você tem duas respostas: <b>Aprovar</b>, e aí o valor é aplicado na Meta na hora; ou <b>Recusar</b>, e aquela campanha fica quieta por uma semana. Passada a semana, se a situação continuar igual, ela volta a perguntar — porque aí já é outro momento.</p>
      <p>Quando o orçamento da campanha está espalhado entre vários conjuntos, a fila mostra <b>quanto vai para cada um</b> antes de você decidir, mantendo a proporção que você já escolheu entre eles.</p>
      <p>Só aparece aqui o que pede uma decisão. Quando o robô diz para não mexer, não há o que aprovar, então ele não ocupa espaço.</p>`,
  },
  veredito: {
    titulo: 'Como a recomendação é decidida',
    texto: `<p>Existe <b>um veredito por cartão</b>, nunca dois selos disputando. Ele é decidido nesta ordem:</p>
      <p><b>1.</b> A saúde manda pausar ou reduzir → vale a saúde, por mais barata que a campanha esteja. Frequência alta queima a audiência, e preço baixo não conserta isso.<br>
      <b>2.</b> Saúde ok e existe análise do robô semanal → vale o robô.<br>
      <b>3.</b> Saúde ok e sem robô → vale a sua meta.<br>
      <b>4.</b> Sem dado suficiente para a meta → volta para a leitura de saúde.</p>
      <p>A frase embaixo do selo diz sempre <b>por que</b> aquela cor apareceu, com os números que sustentam.</p>`,
  },

  orcamento_sugerido: {
    titulo: 'Por que às vezes não há orçamento sugerido',
    texto: `<p>O botão de aplicar um valor só aparece quando <b>quem decidiu o veredito também tem um número para propor</b> — hoje, só o robô semanal.</p>
      <p>Quando quem decide é a sua meta ou a leitura de saúde, não existe número confiável para sugerir, e <b>preferimos não inventar um</b>. Você continua podendo editar o orçamento à mão no próprio cartão.</p>
      <p>Isso evita o pior caso: o cartão dizer "escalar" e o botão, na prática, cortar a verba.</p>`,
  },

  // CORREÇÃO (revisão final da Onda B, 25/09/2026): esta entrada dizia "em vez
  // do ponto misturado" e "continua no ponto ponderado" — falso desde
  // 24/09/2026. Sem declaração, a campanha é julgada pelo custo por
  // engajamento (bruto), não pelo ponto ponderado (em pausa — ver
  // ALVOS.engajamento em alvos.js). O exemplo numérico também trocou: usava
  // meta em R$/ponto, que não é mais o padrão sem declaração.
  objetivo_declarado: {
    titulo: 'Declarar o que a campanha está comprando',
    texto: `<p>A Meta não diz qual interação você quer. O mesmo anúncio pode ter sido feito para colecionar salvamento ou para puxar comentário — só você sabe.</p>
      <p>Declarando aqui, a campanha passa a ser julgada pelo <b>custo daquela interação</b>, contra a meta dela, em vez do engajamento bruto (todas as interações somadas e valendo o mesmo).</p>
      <p>Faz diferença real. Sua campanha Topo Funil aparece <b>vermelha</b> pelo engajamento (R$ 0,28 contra meta de R$ 0,15) e ficaria <b>verde</b> pelo salvamento (R$ 18,72 contra meta de R$ 45). É a mesma campanha; muda só a régua.</p>
      <p>Não declarar não muda nada — continua julgada pelo custo por engajamento (bruto).</p>`,
  },

  // A CHAVE continua `custo_conversa` (é a chave da métrica no catálogo,
  // GT_METRIC_CATALOG — ver metricas.js), mas o TÍTULO mudou: o dono chama de
  // LEAD a conversa iniciada (decisão de 24/09/2026, ver alvos.js —
  // ALVOS.mensagens.rotulo já é 'Custo por lead'). Título desatualizado
  // ('Custo por conversa') corrigido na revisão final da Onda B, 25/09/2026.
  custo_conversa: {
    titulo: 'Custo por lead',
    texto: `<p>Quanto custou cada conversa de WhatsApp iniciada: o gasto da campanha dividido pelas conversas. Aqui você chama de LEAD a conversa iniciada (quem abre conversa no WhatsApp já é lead) — é por isso que a tela mostra "Custo por lead".</p>
      <p>É o resultado que essa campanha compra — por isso ela é julgada por aqui, e não por curtida.</p>
      <p>Referência sua: R$ 26,95 por conversa na média das contas, com R$ 95.745 investidos em 90 dias. É de longe seu maior gasto.</p>`,
  },

  custo_lead: {
    titulo: 'Custo por lead',
    texto: `<p>O gasto dividido pelos cadastros que a Meta registrou como lead.</p>
      <p><b>Atenção:</b> se o cadastro acontece no WhatsApp, a Meta conta como <b>conversa</b>, não como lead — e aí este número fica vazio mesmo com a campanha funcionando. Em 90 dias sua conta não registrou nenhum lead por esse caminho.</p>`,
  },

  cpm: {
    titulo: 'Custo por mil impressões (CPM)',
    texto: `<p>Quanto custa aparecer mil vezes. É <b>impressão</b>, não pessoa: a mesma pessoa pode ver o anúncio várias vezes, e cada vez conta.</p>
      <p>Serve para campanha de reconhecimento, cujo objetivo é justamente aparecer.</p>`,
  },

  custo_visita: {
    titulo: 'Custo por visita',
    texto: `<p>Quanto custou cada pessoa que realmente chegou ao destino — não cada clique.</p>
      <p>Alguém pode clicar e desistir antes de a página abrir. Por isso medimos a chegada, que é o que interessa.</p>`,
  },
};

// Devolve o texto da chave, ou null quando não existe — quem chama decide se
// mostra o botão. Nunca inventa conteúdo para uma chave desconhecida.
export function ajudaDe(chave) {
  return (chave && Object.prototype.hasOwnProperty.call(AJUDA, chave)) ? AJUDA[chave] : null;
}
