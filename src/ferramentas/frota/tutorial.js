// O tutorial da Frota: o passeio pela tela inteira, o texto fixo que abre
// cada um dos 6 modais, e o passeio pelos campos de cada um deles.
//
// Mesmo desenho do patrimonio/tutorial.js (leia aquele arquivo primeiro — o
// tom e o formato são o padrão da casa): PASSOS aponta pra seletores reais da
// tela; TEXTOS são os parágrafos fixos, usados VERBATIM no topo de cada
// modal; e cada PASSOS_<modal> é o passeio opcional pelos campos DAQUELE
// modal, disparado pelo "?" que fica ao lado do X de fechar.
//
// A memória de "já viu" mora em compartilhado/tutorial-visto.js, dividida com
// o Patrimônio — só o prefixo da chave muda (ver o comentário lá).
import { deveAbrirSozinho as devePorPrefixo, marcarComoVisto as marcarPorPrefixo } from '../../compartilhado/tutorial-visto.js'

// Os textos fixos dos 6 modais, escritos pelo dono e usados sem alteração.
// Ficam num objeto, não espalhados no template, pelo mesmo motivo do
// PASSOS: um texto que ensina tem que poder ser lido de uma vez, revisado
// como texto — não caçado dentro de 2 mil linhas de tela.
//
// `ficha` vira dois textos, não um: o modal de retirar/devolver é o MESMO
// modal nos dois modos, mas a frase certa depende de `ficha.modo` — quem está
// retirando não precisa ler a instrução de devolver, e vice-versa.
export const TEXTOS = {
  veiculoAberto: 'Aqui fica tudo o que se sabe deste carro: documento, contrato, seguro, quem é o '
    + 'responsável e o histórico de manutenção. O que você mudar aqui vale para a Frota '
    + 'inteira. Se o carro também está no Patrimônio, dá para ligar os dois no campo lá '
    + 'embaixo — aí as duas ferramentas passam a falar do mesmo carro.',
  itemEmEdicao: 'De quantos em quantos quilômetros esta peça se troca. É esse número que faz o '
    + 'sistema avisar quando a revisão está chegando. Mude quando o mecânico mandar — o '
    + 'histórico do que já foi trocado não se perde.',
  fichaDetalhe: 'Isto é o que o motorista respondeu hoje, item por item. A ficha não pode mais '
    + 'ser alterada — se algo estiver errado, o certo é registrar uma ficha nova explicando.',
  pedido: 'Peça um carro para uma data. Quem administra a frota aprova ou recusa, e você é '
    + 'avisado. Reservar não tira o carro de ninguém agora — só marca a agenda.',
  decisao: 'Você está decidindo o pedido de outra pessoa. Se recusar, escreva o motivo — é o '
    + 'que ela vai ler, e é a diferença entre entender e ficar sem saber por quê.',
  fichaRetirar: 'você está dizendo que está saindo com o carro. Confira o veículo antes, como '
    + 'manda a norma — o checklist aparece aqui mesmo se ainda não foi feito hoje.',
  fichaDevolver: 'anote a quilometragem do painel. É ela que mantém os avisos de revisão '
    + 'funcionando.',
}

// O passeio da tela inteira. Não existia nenhum antes deste tutorial — cobre,
// na ordem que o dono pediu: as quatro abas, o cartão do checklist do dia, o
// quadro de quem conferiu e quem não, o botão de acrescentar veículo, e o
// plano de manutenção.
export const PASSOS = [
  {
    selector: '.tela-frota .abas',
    titulo: '1. Duas áreas, pra dois tipos de atenção',
    texto: 'Motorista é pra quem pega e devolve carro: o carro fixo, os livres pra pegar, '
      + 'os pedidos feitos. Gestão é pra quem administra a frota inteira — documento, '
      + 'contrato, quem está com cada carro. Revisões mostra o que está vencendo. Plano é '
      + 'onde se ajusta de quantos em quantos km cada peça troca, e os itens do checklist '
      + 'diário. Quem só dirige nem vê essas abas — a tela nasce só com Motorista pra ele.',
  },
  {
    selector: '[data-tour="fr-checklist-hoje"]',
    titulo: '2. O checklist do dia, pra quem tem carro fixo',
    texto: 'Quem tem um carro fixo confere ele por aqui todo dia, antes de sair — pneu, '
      + 'óleo, o que o dono pediu pra olhar. Quem pega um carro de rodízio confere na hora '
      + 'de retirar, não aqui. Já feito hoje? A tela avisa e não pede de novo.',
  },
  {
    // Era `.fr-novo`, o botão solto de "+ Acrescentar veículo". Ele virou um dos
    // botões rápidos do topo da aba (D33), e o passo passou a apontar pra bloco
    // que não existia mais — o passeio quebrava calado. Agora aponta pro bloco
    // dos botões, e o texto fala dos quatro, que é o que a pessoa vê na tela.
    selector: '[data-tour="fr-botoes-gestao"]',
    titulo: '3. Os quatro botões da Gestão',
    texto: 'Cada um abre o que o nome diz, e a linha de baixo já responde antes de você '
      + 'clicar: quantos carros faltam conferir hoje, quantos pedidos esperam decisão. '
      + '"Acrescentar um veículo" abre uma ficha em branco — só nome e placa são '
      + 'obrigatórios, e o carro nasce ativo e sem responsável fixo, de rodízio.',
  },
  {
    selector: '[data-tour="fr-cobranca-quadro"]',
    titulo: '4. Quem já conferiu, e quem falta',
    texto: 'Na aba Gestão, este quadro mostra carro por carro se o checklist de hoje foi '
      + 'feito. Quem falta e tem telefone cadastrado ganha um botão de WhatsApp pronto, já '
      + 'com a cobrança escrita — só falta enviar.',
  },
  {
    selector: '[data-tour="fr-secao-plano"]',
    titulo: '5. O plano que gera os avisos',
    texto: 'Aqui o mecânico diz de quantos em quantos quilômetros cada peça troca — é '
      + 'esse número que faz a aba Revisões avisar quando a troca está chegando. Mais '
      + 'embaixo, na mesma aba, fica a lista do que o motorista confere sozinho todo dia.',
  },
]

/* ── Os 6 modais: passeio pelos campos, disparado pelo "?" ao lado do X ──── */

// A ordem aqui segue a ordem em que os campos aparecem na tela (o passeio usa
// scrollIntoView em cada passo — ver passeio-guiado.vue — e um passo fora de
// ordem rola pra baixo e depois pra cima, o que lê como "perder o lugar").
// Reordenado nesta fase: o reshuffle das seções (D32) moveu Histórico pra
// antes de Contrato no HTML, e o passeio tinha ficado com a ordem antiga —
// visitava Bem (o penúltimo campo) e só depois voltava pra Histórico (o
// sétimo). tutorial.test.mjs agora prova que a ordem daqui bate com a ordem
// do HTML, pra um reshuffle futuro não repetir isso sem ser pego pelo teste.
export const PASSOS_VEICULO = [
  {
    selector: '[data-tour="veic-nome"]',
    titulo: 'Nome e placa',
    texto: 'São por eles que o carro é reconhecido no sistema inteiro, e são os únicos '
      + 'dois obrigatórios. A placa pode ser digitada como você quiser: o sistema arruma '
      + 'sozinho.',
  },
  {
    selector: '[data-tour="veic-responsavel"]',
    titulo: 'Responsável',
    texto: 'Quem responde por este carro no dia a dia. É essa pessoa que vai aparecer '
      + 'cobrada no checklist de hoje, e é pra ela que o aviso da manhã vai.',
  },
  {
    selector: '[data-tour="veic-empresa"]',
    titulo: 'De qual empresa é o carro',
    texto: 'De quem é o carro, e não onde ele fica — são duas perguntas diferentes, e por '
      + 'isso são dois campos. Um carro da RBV Company pode passar a semana guardado na '
      + 'Fábrica Conchal da Vessel sem por isso virar patrimônio da Vessel.',
  },
  {
    selector: '[data-tour="veic-local"]',
    titulo: 'Onde o carro fica',
    texto: 'Aqui você não digita: você escolhe na lista que já existe, a mesma do '
      + 'Patrimônio. Repare que o nome da marca anda junto do local — existem duas '
      + '"Fábrica Conchal", de empresas diferentes, e sem a marca não dá pra saber qual é '
      + 'qual. Se o local que falta não estiver na lista, o + cadastra na hora.',
  },
  {
    selector: '[data-tour="veic-contato"]',
    titulo: 'Contato',
    texto: 'Um telefone de quem resolve as coisas deste carro. Pode ser o próprio '
      + 'responsável ou outra pessoa — se for outra, diga o NOME dela aqui, porque o '
      + 'sistema usa esse número para cobrar o checklist e precisa saber de quem é.',
  },
  {
    selector: '[data-tour="veic-oficina"]',
    titulo: 'Oficina',
    texto: 'Quem faz a manutenção. Aparece como botão de WhatsApp na hora que a revisão '
      + 'vencer, já com a quilometragem escrita na mensagem.',
  },
  {
    selector: '[data-tour="veic-historico"]',
    titulo: 'Histórico de manutenção',
    texto: 'Cada troca feita, com a quilometragem. É daqui que sai o aviso de revisão '
      + 'vencendo — sem registro, o sistema não tem como avisar nada.',
  },
  {
    selector: '[data-tour="veic-contrato"]',
    titulo: 'Contrato e aluguel',
    texto: 'Estes carros são alugados, não são da empresa. É por isso que eles não entram '
      + 'no valor do patrimônio, mesmo aparecendo lá na lista de bens.',
  },
  {
    selector: '[data-tour="veic-bem"]',
    titulo: 'Bem no Patrimônio',
    texto: 'Se este carro também está cadastrado no Patrimônio, ligue os dois aqui. Serve '
      + 'para não ter dois cadastros do mesmo carro sem ninguém perceber.',
  },
]

export const PASSOS_ITEM = [
  {
    selector: '[data-tour="item-nome"]',
    titulo: 'Nome do item',
    texto: 'O que se troca: óleo, correia, pneus. Escreva como o mecânico fala.',
  },
  {
    selector: '[data-tour="item-km"]',
    titulo: 'A cada quantos quilômetros',
    texto: 'O sistema avisa quando faltar 10% para chegar lá. Para o óleo de 7.000 km, '
      + 'isso é um aviso 700 km antes.',
  },
  {
    selector: '[data-tour="item-desativar"]',
    titulo: 'Desativar',
    texto: 'Some dos avisos, mas não apaga nada: o que já foi trocado continua no '
      + 'histórico, e dá para reativar depois.',
  },
]

export const PASSOS_FICHA_DETALHE = [
  {
    selector: '[data-tour="fdet-km"]',
    titulo: 'Quilometragem',
    texto: 'O número que a pessoa leu no painel. É ele que atualiza a quilometragem do '
      + 'carro e faz os avisos de revisão funcionarem.',
  },
  {
    selector: '[data-tour="fdet-resultado"]',
    titulo: 'Resultado',
    texto: 'A conclusão de quem conferiu. Mesmo "não liberado" não tira o carro de '
      + 'ninguém: serve para avisar quem administra.',
  },
  /* Anomalias antes de Cada item: é essa a ordem NA TELA. O passeio estava ao
     contrário e descia até os itens pra depois voltar pra cima — quem está
     seguindo o balão perde o fio quando ele anda pra trás. */
  {
    selector: '[data-tour="fdet-anomalias"]',
    titulo: 'Anomalias',
    texto: 'O que a pessoa escreveu com as próprias palavras. Só aparece quando ela '
      + 'marcou algum problema.',
  },
  {
    selector: '[data-tour="fdet-itens"]',
    titulo: 'Cada item',
    texto: 'OK é o que estava certo, Problema é o que precisa de atenção, Não se aplica é '
      + 'o que aquele carro não tem.',
  },
]

export const PASSOS_PEDIDO = [
  {
    selector: '[data-tour="ped-quando"]',
    titulo: 'Quando',
    texto: 'Dia e hora que você pretende sair. Peça com alguma antecedência para não '
      + 'atropelar viagem de outro setor.',
  },
  {
    selector: '[data-tour="ped-destino"]',
    titulo: 'Destino e finalidade',
    texto: 'Ajuda quem aprova a decidir entre dois pedidos para o mesmo dia.',
  },
  {
    selector: '[data-tour="ped-depois"]',
    titulo: 'O que acontece depois',
    texto: 'O pedido fica esperando. Quando alguém decidir, você vê aqui mesmo, com o '
      + 'motivo, se for recusado.',
  },
]

export const PASSOS_DECISAO = [
  {
    selector: '[data-tour="dec-motivo"]',
    titulo: 'Motivo',
    texto: 'Obrigatório ao recusar. Uma linha basta: "o carro está na oficina nesse dia" '
      + 'já resolve.',
  },
  {
    selector: '[data-tour="dec-depois"]',
    titulo: 'O que acontece depois',
    texto: 'A pessoa vê a decisão na tela dela. Aprovar não entrega o carro: ela ainda '
      + 'precisa registrar a retirada quando for pegar.',
  },
]

export const PASSOS_FICHA = [
  {
    selector: '[data-tour="ficha-checklist"]',
    titulo: 'Checklist',
    texto: 'Só aparece se este carro ainda não foi conferido hoje. Se outra pessoa já '
      + 'conferiu de manhã, não precisa fazer de novo.',
  },
  {
    selector: '[data-tour="ficha-km"]',
    titulo: 'Quilometragem',
    texto: 'O número do painel agora. Se ele for menor que o último registrado, o sistema '
      + 'pergunta — odômetro não anda para trás, e é melhor conferir do que gravar errado.',
  },
  {
    selector: '[data-tour="ficha-combustivel"]',
    titulo: 'Combustível',
    texto: 'Como está o ponteiro. Serve para a próxima pessoa saber se precisa abastecer '
      + 'antes de sair.',
  },
]

const PREFIXO = 'fr-tutorial-visto'
export function deveAbrirSozinho(armazem, usuarioId) { return devePorPrefixo(armazem, usuarioId, PREFIXO) }
export function marcarComoVisto(armazem, usuarioId) { return marcarPorPrefixo(armazem, usuarioId, PREFIXO) }
