// Sugestão de interesses: a parte PURA.
//
// Monta o que a IA recebe e colhe o que a Meta devolve. Sem rede, sem banco —
// por isso dá pra testar a decisão inteira sem gastar um centavo de IA nem
// tocar numa conta de anúncios.
//
// REGRA QUE ATRAVESSA O ARQUIVO: toda lista que chega aqui vem de fora (banco,
// IA, Meta) e pode ter item nulo, item sem os campos esperados, ou campo do
// tipo errado. Item ruim é PULADO; nunca quebra e nunca vira texto lixo do tipo
// "undefined" no meio do pedido.

import { ALVOS } from '../../src/ferramentas/gestao-trafego/alvos.js';

// As chaves saem da régua, não são redigitadas: uma sétima nomenclatura aqui
// garantiria divergência com o resto da ferramenta.
export const OBJETIVOS = Object.keys(ALVOS);

// O nome do objetivo em português, para o pedido e para a tela.
// NÃO existe no projeto um mapa balde → nome: `alvos.js` guarda o rótulo da
// MÉTRICA de cada balde ('Custo por engajamento'), e `baldes.js` traduz o objetivo da
// Meta para a chave do balde. Este mapa preenche essa lacuna, e há teste
// garantindo que ele cobre exatamente OBJETIVOS — nem a mais, nem a menos.
export const NOME_DO_OBJETIVO = {
  engajamento: 'Engajamento',
  reconhecimento: 'Reconhecimento de marca',
  trafego: 'Tráfego para o site',
  mensagens: 'Conversas no WhatsApp ou Direct',
  leads: 'Cadastros (leads)',
  vendas: 'Vendas',
};

// QUEM PROCURAR em cada objetivo — a linha que faz os seis objetivos pedirem
// coisas DIFERENTES.
//
// Medido: com o pedido só dizendo o nome do objetivo, os seis devolveram
// praticamente a mesma lista. E aí a promessa da ferramenta cai por terra: a
// faixa existe porque o que serve pra vender não é o que serve pra ser
// conhecido. Se as seis listas são iguais, sobrou uma lista só, repetida seis
// vezes e cobrada seis vezes.
//
// Cada linha diz em que MOMENTO da relação com a marca está a pessoa daquele
// objetivo. É isso que muda o termo — não o nome do objetivo.
//
// Mesma regra do mapa acima: chave faltante não vira 'undefined' no pedido, a
// linha simplesmente não entra (ver montarPedido), e há teste garantindo que o
// mapa cobre exatamente OBJETIVOS.
//
// CADA LINHA DIZ *QUEM* PROCURAR — NUNCA "QUÃO ESTREITO" O TERMO TEM DE SER.
// Esta é a única sobrevivente da rodada que zerou, e ela só pode ficar se não
// carregar a pressão que zerou. A linha de vendas dizia "tipos de produto
// ESPECÍFICOS", que é a mesma instrução por outro nome — saiu. Se um dia alguém
// for editar aqui: palavra que empurre pra estreitar o termo ("específico",
// "nicho", "detalhado") reintroduz o defeito sem parecer que reintroduziu.
export const FOCO_DO_OBJETIVO = {
  engajamento: 'Gente que já gosta do assunto e comenta sobre ele: hobbies, comunidades e temas do dia a dia dela.',
  reconhecimento: 'Gente que ainda NÃO conhece a marca: o estilo de vida e os gostos de quem teria a ver com ela.',
  trafego: 'Gente que pesquisa e compara antes de decidir: assuntos de quem está se informando sobre esse tipo de produto.',
  mensagens: 'Gente que tira dúvida antes de comprar: assuntos de quem quer atendimento, medida, encomenda, personalização.',
  leads: 'Gente disposta a deixar contato em troca de algo: assuntos de quem busca novidade, lista de espera, condição especial.',
  vendas: 'Gente em momento de compra: marcas concorrentes e ocasiões que levam a comprar.',
};

const lista = (v) => (Array.isArray(v) ? v : []);
const texto = (v) => (typeof v === 'string' ? v.trim() : '');

// Tira o que poderia quebrar a estrutura do pedido: newlines criam novas seções,
// e um campo gigantesco domina a requisição. Preserva aspas e apóstrofos — legítimos
// em nomes (Casa D'Oro, Loja D'Água, Sant'Ana).
const limpo = (s) => texto(s).replace(/[\n\r\x00-\x1f]/g, ' ').replace(/\s{2,}/g, ' ').trim().substring(0, 200);

// As cidades de uma loja, prontas pra entrar no pedido.
//
// FORMATO REAL DO BANCO: `fabrica_lojas.geo_cities` guarda CHAVES da Meta, não
// nomes — a migration 018 semeou '[267873,241913]' e a Fábrica lê a coluna assim
// (painel-subir.vue trata cada item como chave). Chave pelada NÃO é lixo: é o
// formato de verdade. Só que ela não tem nome pra escrever no pedido.
//
// Quem traduz chave → nome é quem tem rede: o robô pergunta à Meta antes de
// montar o pedido e entrega os itens já no formato { key, nome }. Por isso os
// DOIS formatos entram aqui:
//   { key, nome } → cidade resolvida, o nome vai pro pedido;
//   267873 / '267873' → chave crua (a Meta não respondeu, ou a cidade não voltou):
//     a loja entra no pedido sem geografia, em vez de entrar com "267873" — que
//     não diz nada pra IA e ainda parece um nome de cidade quebrado.
// Lixo de verdade (null, {}, '', tipo errado) também sai, pelo mesmo caminho.
function cidadesDaLoja(loja) {
  const saida = [];
  for (const c of lista(loja && loja.geo_cities)) {
    if (c == null) continue;
    // Chave crua (número ou texto): formato legítimo, mas sem nome pra mostrar.
    if (typeof c !== 'object') continue;
    const nome = limpo(c.nome);
    if (nome) saida.push(nome);
  }
  return saida;
}

// Troca as CHAVES de cidade de uma loja pelos NOMES que a Meta devolveu.
//
// Fica aqui, no arquivo puro, porque é decisão — não é rede: quem fala com a
// Meta é o robô, que passa o mapa { chave: nome } pronto. Assim a regra de "o
// que fazer com a chave que a Meta não reconheceu" tem teste, sem chamada paga.
//
// Chave sem nome fica COMO ESTÁ (crua). Não se inventa nome, e não se apaga a
// entrada: apagar esconderia que a loja tem cidade cadastrada, e inventar
// colocaria um número no lugar de um nome de cidade dentro do pedido.
export function comCidadesResolvidas(loja, nomes) {
  const mapa = (nomes && typeof nomes === 'object') ? nomes : {};
  return {
    ...loja,
    geo_cities: lista(loja && loja.geo_cities).map((c) => {
      if (c == null || typeof c === 'object') return c;   // já resolvida, ou lixo: não mexe
      const nome = limpo(mapa[String(c)]);
      return nome ? { key: String(c), nome } : c;
    }),
  };
}

// A RODADA INTEIRA FALHOU? — a decisão que pinta o Actions de vermelho.
//
// Cada marca × objetivo tem try/catch próprio, e isso está certo: uma marca com
// problema não pode derrubar as outras cinco. Mas quando NADA saiu e tudo foi
// pulado, a causa não é uma marca — é a chave da IA que não existe, a migration
// que não foi aplicada, o token da Meta vencido. Sem esta regra, todos esses
// casos terminavam a rodada em VERDE, e o dono só descobriria semanas depois,
// abrindo a Fábrica e estranhando a falta da faixa.
//
// Fica aqui, e não dentro do run(), pelo mesmo motivo do comCidadesResolvidas:
// `sugerir-interesses.mjs` executa no import, então nada lá dentro tem teste — e
// esta é justamente a regra que decide se um problema aparece ou não aparece.
//
// TRÊS entradas e três respostas:
//   pulou tudo e não produziu nada ....... FALHOU (vermelho)
//   rodada seca que SIMULOU pelo menos uma  não falhou (ela não grava por desenho)
//   não tinha o que fazer (nada pulado) ... não falhou (semana sem marca ativa
//                                           não é defeito; é uma semana vazia)
export function rodadaFalhouInteira({ gravadas, simuladas, puladas, seco } = {}) {
  const conta = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const produzidas = seco ? conta(simuladas) : conta(gravadas);
  return conta(puladas) > 0 && produzidas === 0;
}

function descreverLojas(lojas) {
  const linhas = [];
  for (const loja of lista(lojas)) {
    const nome = limpo(loja && loja.nome);
    if (!nome) continue;                      // loja nula ou sem nome: pulada
    const cidades = cidadesDaLoja(loja);
    linhas.push(cidades.length ? `- ${nome} (atende ${cidades.join(', ')})` : `- ${nome}`);
  }
  return linhas;
}

// O que a IA recebe. SÓ dado do cadastro — não existe campo de texto livre em
// lugar nenhum deste fluxo, e é isso que fecha a porta de injeção de instrução.
export function montarPedido({ marca, lojas, objetivo } = {}) {
  if (!OBJETIVOS.includes(objetivo)) return null;
  const nomeMarca = limpo(marca && marca.nome);
  if (!nomeMarca) return null;

  // O QUE A MARCA VENDE — o fato mais importante do pedido inteiro.
  //
  // Sem isto, a IA recebia só o nome "La Vessel" e tinha de adivinhar o resto.
  // Ela adivinhava "loja de moda feminina" e devolvia "looks do dia", "estilo
  // pessoal", "influencer moda" — genérico, e igual nos seis objetivos. Medido:
  // a maior linha de produto da loja, por quantidade de itens, é CINTO (398),
  // mais que qualquer tipo de bolsa. Nenhum termo da IA jamais citou cinto,
  // porque ninguém nunca contou a ela.
  //
  // Passa pelo mesmo `limpo()` de todo campo de cadastro: é dado da mesma classe
  // que o nome da marca, e recebe o mesmo tratamento — newline vira espaço,
  // texto gigante é capado.
  //
  // VAZIO NÃO QUEBRA NADA: marca cadastrada amanhã sem preencher a coluna cai no
  // comportamento de antes (só o nome) e o pedido sai do mesmo jeito. A linha
  // inteira some — nunca aparece "O que ela vende:" seguido de nada.
  const segmento = limpo(marca && marca.segmento);

  // ATENÇÃO: `ALVOS[x].rotulo` é o rótulo da MÉTRICA, não do objetivo —
  // engajamento tem rotulo 'Custo por engajamento' (era 'Custo por ponto'
  // antes da troca de régua de 24/09/2026 — ver ALVOS.engajamento em
  // alvos.js). Dizer à IA "Objetivo da campanha: Custo por engajamento" seria
  // absurdo do mesmo jeito. Por isso o nome do objetivo vem daqui, e o
  // `ajuda` de ALVOS entra só como contexto extra do que se está medindo.
  // Fallback: se a chave não está no mapa (divergência com ALVOS), usa a chave
  // mesmo. Nunca vira "undefined" no pedido.
  const nomeObjetivo = NOME_DO_OBJETIVO[objetivo] || objetivo;
  const ajuda = limpo((ALVOS[objetivo] || {}).ajuda);
  const linhasLojas = descreverLojas(lojas);

  // A IA NÃO PRECISA CONHECER O CATÁLOGO DA META — e é essa a mudança que este
  // pedido carrega. Antes se pedia o NOME EXATO de cada interesse, do jeito que
  // ele aparece no Gerenciador; medido na conta de verdade, só 15% dos nomes
  // existiam. Não era desleixo do modelo: pedir nome exato é pedir que ele
  // decore uma lista que ele nunca viu.
  //
  // Agora se pede o ASSUNTO. Quem procura o nome é o robô, que busca cada termo
  // na própria Meta (type=adinterest) e colhe o que voltar — os nomes saem do
  // catálogo, nunca da memória do modelo.
  // "CURTO E ABRANGENTE" É DE PROPÓSITO, E JÁ FOI PAGO CARO PRA DESCOBRIR ISSO.
  //
  // Duas rodadas mediram os dois extremos deste mesmo texto:
  //   pedindo o NOME EXATO do interesse ........ 15% dos nomes existiam
  //   pedindo termo "ESPECÍFICO" ............... ZERO resultado em 48 buscas
  //   pedindo termo "curto e abrangente" ....... 49 interesses achados
  //
  // O motivo é o catálogo da Meta, não o modelo: ele é GROSSO. Tem "Moda
  // feminina", "Bolsas", "Roupas femininas" — não tem "bolsa de couro artesanal
  // para trabalho". Termo específico demais não acha nada porque a entrada
  // correspondente não existe lá dentro.
  //
  // ENTÃO NÃO APERTE ESTE TEXTO PRA "MELHORAR A RELEVÂNCIA". Já tentamos, e o
  // resultado foi a faixa inteira vazia nos seis objetivos. O que faltava nunca
  // foi pontaria no pedido — era CONTEXTO: a IA não sabia o que a loja vende. É
  // isso que a linha "O que ela vende" resolve, algumas linhas abaixo.
  // (Filtrar depois pelo `path` também já foi tentado e não serve: ver o
  // comentário de caminhoDoInteresse.)
  const system =
    'Você sugere ASSUNTOS de busca para encontrar interesses de segmentação do Meta Ads para lojas brasileiras. ' +
    'Você NÃO precisa conhecer o catálogo do Meta nem acertar o nome exato de nenhum interesse: ' +
    'cada assunto que você der será buscado na própria Meta, e os nomes de verdade vêm de lá. ' +
    'Responda só com termos curtos em português do Brasil, um assunto por item. Nada de explicação.';

  const foco = limpo(FOCO_DO_OBJETIVO[objetivo]);

  const user = [
    `Marca: ${nomeMarca}`,
    // Logo abaixo do nome, porque é o que muda tudo o que vem depois.
    ...(segmento ? [`O que ela vende: ${segmento}`] : []),
    linhasLojas.length ? `Lojas:\n${linhasLojas.join('\n')}` : 'Lojas: não cadastradas',
    `Objetivo da campanha: ${nomeObjetivo}${ajuda ? ` (medido por: ${ajuda})` : ''}`,
    // A ÚNICA linha que sobrou da tentativa que zerou: ela diz QUEM procurar, não
    // quão estreito o termo tem de ser. Sem foco cadastrado a linha some inteira —
    // nunca vira 'undefined' no pedido.
    ...(foco ? [`Quem procurar neste objetivo: ${foco}`] : []),
    '',
    'Sugira até 8 termos de busca: assuntos que importam para quem compraria desta marca com ESTE objetivo.',
    'Cada termo deve ser curto e abrangente (1 a 3 palavras), do tipo que se digita numa busca.',
    // A REGRA QUE A SONDA DE 2026-07-31 MEDIU, e o motivo de ela estar escrita
    // com exemplos: o catálogo do Meta é uma lista de SUBSTANTIVOS, e a busca
    // casa com o nome da entrada. Qualificador mata a busca — os dois lados do
    // mesmo produto foram sondados na mesma rodada:
    //   "bolsa" → Bolsas (acessórios), 486 mi     "bolsa feminina" → NADA
    //   "cinto" → Cinto, 37 mi                    "cinto de couro" → NADA
    //   "carteira" → Carteira (acessórios), 64 mi "carteira feminina" → NADA
    // Nenhum dos 13 vazios da sonda era substantivo pelado, e nenhum dos 18
    // achados tinha qualificador.
    'REGRA MEDIDA: escreva o SUBSTANTIVO SOZINHO, no singular — "bolsa", "cinto", "carteira", "óculos".',
    'NÃO acrescente qualificador: "bolsa feminina", "cinto de couro" e "carteira feminina" NÃO EXISTEM no catálogo e voltam vazios.',
    // MEDIDO em duas rodadas: palavra abstrata bate em qualquer coisa. `estilo`
    // trouxe `Tai chi chuan estilo Wu`, `Esqui estilo livre` e `Estilo
    // arquitetónico`; `tendência` trouxe `tendência do mercado (setores comercial
    // e financeiro)`. Nenhum dos dois rendeu UM interesse aproveitável em rodada
    // nenhuma — só ocupou vaga e ainda deu trabalho pro filtro de tamanho.
    //
    // Note que isto NÃO pede termo mais estreito (a instrução que zerou tudo em
    // cef4b36): pede COISA em vez de CONCEITO. "óculos" é curto e concreto; os
    // dois convivem.
    'Prefira COISA a CONCEITO: "óculos" e "mochila" acham produto; "estilo", "tendência" e "lifestyle" acham tai chi, esqui e mercado financeiro.',
    'Não tente adivinhar o nome exato de um interesse do Meta — cada termo será buscado no catálogo dele.',
  ].join('\n');

  return { system, user };
}

// ═══ SEGUNDA ETAPA: A IA ESCOLHE ENTRE O QUE EXISTE ═══════════════════════════
//
// POR QUE ELA PRECISOU EXISTIR. A sonda de 2026-07-31 provou que o catálogo da
// Meta é indexado por SUBSTANTIVO PELADO: "bolsa" acha `Bolsas (acessórios)`
// (486 mi), "bolsa feminina" não acha nada. Ótimo — só que substantivo pelado é
// justamente o que traz HOMÔNIMO junto:
//   "bolsa"  → Bolsas (acessórios) ... e 8 BOLSAS DE VALORES (Istambul, Mumbai)
//   "clutch" → Clutch ... e `Hard rock` e `Embraiagem`
//   "luxo"   → Bens de luxo ... e `Egito` e `Luxor Hotel`
// Trocar o vocabulário sem tratar isso seria trocar um lixo por outro.
//
// A SAÍDA QUE SÓ AGORA EXISTE: até aqui a IA era obrigada a ADIVINHAR nomes de
// um catálogo que ela nunca viu — e a lição mais cara desta série é que ela erra
// nisso (pedindo nome exato, 15% existiam). Agora ela não adivinha nada: recebe
// as fichinhas REAIS que a Meta devolveu e só diz quais servem. Julgar "Bolsa de
// Valores de Istambul não é de uma loja de bolsas" é o que um modelo faz bem.
//
// E RESOLVE O OUTRO PROBLEMA DE QUEBRA: os seis objetivos vinham devolvendo a
// mesma lista porque os termos específicos morriam na busca e só os genéricos
// sobreviviam. Como a escolha é feita POR OBJETIVO, sobre a mesma lista bruta, é
// aqui que os seis finalmente podem divergir — sem depender de o catálogo ter
// entrada para cada nuance.
//
// Devolve null quando não há o que escolher (sem itens, marca sem nome, objetivo
// desconhecido) — quem chama pula a etapa e segue com a lista como veio.
export function montarEscolha({ marca, objetivo, itens } = {}) {
  if (!OBJETIVOS.includes(objetivo)) return null;
  const nomeMarca = limpo(marca && marca.nome);
  if (!nomeMarca) return null;
  const segmento = limpo(marca && marca.segmento);
  const nomeObjetivo = NOME_DO_OBJETIVO[objetivo] || objetivo;
  const foco = limpo(FOCO_DO_OBJETIVO[objetivo]);

  const linhas = [];
  for (const i of lista(itens)) {
    if (!i || typeof i !== 'object') continue;
    const nome = limpo(i.nome);
    const id = limpo(i.id);
    if (!nome || !id) continue;
    // O TAMANHO VAI JUNTO porque é informação de decisão, não enfeite: entre dois
    // interesses que servem, o de 3 mil pessoas não vale uma linha da faixa.
    const tam = tamanhoLegivel(i.audience_size);
    linhas.push(`- id ${id} · ${nome}${tam ? ` (${tam} pessoas)` : ''}`);
  }
  if (!linhas.length) return null;

  const system =
    'Você escolhe, dentro de uma lista REAL de interesses de segmentação do Meta Ads, quais servem para uma loja brasileira. ' +
    'A lista veio do próprio Meta: todos os itens existem. ' +
    'Seu trabalho é SÓ separar o que tem a ver com a marca do que caiu ali por coincidência de nome. ' +
    'Responda apenas com os id dos que servem. Nada de explicação, e nunca invente um id que não esteja na lista.';

  const user = [
    `Marca: ${nomeMarca}`,
    ...(segmento ? [`O que ela vende: ${segmento}`] : []),
    `Objetivo da campanha: ${nomeObjetivo}`,
    ...(foco ? [`Quem procurar neste objetivo: ${foco}`] : []),
    '',
    'Interesses encontrados no catálogo do Meta:',
    ...linhas,
    '',
    // O EXEMPLO É O CASO REAL da sonda, não um caso inventado: é exatamente esse
    // o erro que a etapa existe pra evitar.
    'Muitos vieram por coincidência de palavra — buscar "bolsa" traz "Bolsa de Valores de Istambul", que não tem nada a ver com uma loja de bolsas.',
    'Devolva os id dos que fazem sentido para ESTA marca com ESTE objetivo, do mais relevante para o menos.',
    'É melhor devolver poucos e certos do que muitos e duvidosos. Se nenhum servir, devolva lista vazia.',
    // ESTAS TRÊS LINHAS SÃO O CONSERTO DE 2026-08-01, e cada uma paga um erro
    // observado na rodada real:
    //
    // (a) SEM NÚMERO A ATINGIR. Ao soltar o teto de quantidade, a lista oferecida
    //     pulou de 12 para ~50 itens e a IA passou a devolver EXATAMENTE 12 em
    //     todos os seis objetivos — o teto virou meta. Foi assim que entraram
    //     `Bolsa de Valores de Hong Kong` (em "mensagens"!), `Bolsa de estudo`,
    //     `Boémia` e `Moda hip hop`: vaga sobrando sendo preenchida.
    // (b) O TESTE DA FRASE. "Poucos e certos" é abstrato e perde para a vontade
    //     de completar a lista; uma pergunta concreta, que se responde item a
    //     item, resiste melhor.
    // (c) O EXEMPLO DO ERRO DA VEZ. `Bolsa de Valores de Hong Kong` passou mesmo
    //     com o exemplo de Istambul logo acima — o mesmo erro, outra cidade. Fica
    //     explícito que a família inteira está fora, não só o exemplo citado.
    'Não existe número certo de respostas: 4 podem ser mais úteis que 12. Nunca complete a lista só para ela ficar cheia.',
    'Teste cada um antes de incluir: "uma pessoa interessada NISTO compraria desta loja?" Se a resposta for "talvez", deixe fora.',
    'Bolsa de valores, bolsa de estudo e qualquer outro sentido da palavra que não seja o produto da loja estão SEMPRE fora, de qualquer cidade ou país.',
  ].join('\n');

  return { system, user };
}

// OS ESCOLHIDOS QUE EXISTEM DE VERDADE — o portão entre a resposta da IA e a
// tabela.
//
// A REGRA DA CASA, de novo: nome de interesse NUNCA vem da IA, vem da Meta.
// Aqui ela só aponta id; qualquer id que não esteja na lista oferecida é
// descartado sem dó. Um id inventado que passasse viraria linha no banco
// apontando pra um interesse que não existe, e a campanha subiria com
// segmentação fantasma — falha silenciosa, do tipo que este projeto já pagou
// caro pra aprender a evitar.
//
// A ORDEM É A DA IA, não a de tamanho: nesta altura ela é ranking de RELEVÂNCIA,
// e a faixa mostra os primeiros. Ordenar por tamanho aqui jogaria o interesse
// certo pra baixo do genérico grande — que é o defeito que a etapa veio corrigir.
//
// Repetido na resposta entra uma vez só. Lista vazia devolve vazio: "nenhum
// serve" é uma resposta legítima, e quem decide o que fazer com uma rodada
// inteira vazia é `rodadaFalhouInteira`.
export function escolhidosValidos(escolhidos, itens) {
  const porId = new Map();
  for (const i of lista(itens)) {
    if (!i || typeof i !== 'object') continue;
    const id = limpo(i.id);
    if (id) porId.set(id, i);
  }
  const saida = [];
  const vistos = new Set();
  for (const bruto of lista(escolhidos)) {
    // Aceita id como texto ou número: o modelo às vezes devolve 6003 em vez de
    // "6003", e recusar por causa do tipo jogaria fora escolha boa.
    if (typeof bruto !== 'string' && typeof bruto !== 'number') continue;
    const id = limpo(String(bruto));
    if (!id || vistos.has(id)) continue;
    const item = porId.get(id);
    if (!item) continue;      // id que a IA inventou: fora, sem alarde
    vistos.add(id);
    saida.push(item);
  }
  return saida;
}

// A LINHA DO LOG DA ESCOLHA — o que a IA descartou, e por isso ela existe.
//
// Sem ela, a rodada seca mostraria a lista final menor e ninguém saberia se a
// busca achou pouco ou se a escolha cortou muito. É a mesma dívida dos cortes
// por tamanho, um andar acima.
export function linhaDaEscolha(antes, depois) {
  const n = lista(antes).length;
  const m = lista(depois).length;
  if (!n) return '';
  const nomes = [];
  const ficaram = new Set(lista(depois).map((i) => limpo(i && i.id)));
  for (const i of lista(antes)) {
    const nome = limpo(i && i.nome);
    if (nome && !ficaram.has(limpo(i && i.id))) nomes.push(nome);
  }
  if (!nomes.length) return `      a IA olhou os ${n} e ficou com todos`;
  return `      a IA ficou com ${m} de ${n} — fora: ${nomes.join(' · ')}`;
}

// O que a IA devolveu, limpo — hoje são TERMOS DE BUSCA, não nomes de interesse
// (ver montarPedido). A resposta vem de `structured()`, que já garante a forma —
// mas garantir forma não garante conteúdo, então item vazio, item que não é
// texto e repetido saem aqui. Repetido importa mais do que parecia: cada termo
// vira uma ida à Meta, e dois termos iguais são duas chamadas pela mesma resposta.
export function nomesPropostos(resposta) {
  const brutos = lista(resposta && resposta.interesses);
  const vistos = new Set();
  const saida = [];
  for (const b of brutos) {
    const nome = limpo(b);
    if (!nome || vistos.has(nome.toLowerCase())) continue;
    vistos.add(nome.toLowerCase());
    saida.push(nome);
  }
  return saida;
}

// OS TERMOS DOS PRODUTOS DA MARCA — buscados SEMPRE, não sorteados.
//
// POR QUE: na rodada real de 2026-07-31, `Cinto` ficou em ZERO dos seis
// objetivos. Cinto é a MAIOR categoria do estoque (398 peças). Não foi o
// catálogo — `cinto` acha `Cinto` (37 mi), medido pela sonda. Foi a IA não ter
// lembrado de pedir. Numa medição anterior ela pediu em 2 de 6; é sorteio, e o
// produto que a loja mais tem em estoque não pode depender de sorteio.
//
// Vem de `fabrica_marcas.termos_produto`, curado e medido pela sonda — NÃO
// deduzido do texto de `segmento`: deduzir exigiria adivinhar plural em
// português, e a primeira palavra que quebra é nossa ("óculos" no singular é
// "óculos", não "óculo"). Ver a migration 2026-08-01-interesses-termos-de-produto.
//
// Coluna vazia devolve lista vazia e tudo segue como antes — marca nova não
// quebra nada por não ter sido curada ainda.
export const MAXIMO_TERMOS_DE_PRODUTO = 8;

export function termosDaMarca(marca, maximo = MAXIMO_TERMOS_DE_PRODUTO) {
  const saida = [];
  const vistos = new Set();
  for (const bruto of lista(marca && marca.termos_produto)) {
    if (typeof bruto !== 'string') continue;
    const t = limpo(bruto);
    if (!t) continue;
    const chave = t.toLowerCase();
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    saida.push(t);
    if (Number.isFinite(maximo) && saida.length >= maximo) break;
  }
  return saida;
}

// JUNTA os termos fixos da marca com os que a IA propôs.
//
// OS DA MARCA VÊM PRIMEIRO, e isso importa mais do que parece: se um dia o total
// bater no teto, quem fica de fora é o palpite da IA, não o produto que a loja
// vende. A ordem é a garantia, não uma preferência estética.
//
// Repetido entra uma vez só, comparando SEM diferenciar maiúscula: a IA pedir
// "Bolsa" quando a marca já tem "bolsa" gastaria duas buscas idênticas na Meta
// e faria o log parecer que são dois assuntos.
export function juntarTermos(daMarca, daIA, maximo = 16) {
  const saida = [];
  const vistos = new Set();
  for (const bruto of [...lista(daMarca), ...lista(daIA)]) {
    if (typeof bruto !== 'string') continue;
    const t = limpo(bruto);
    if (!t) continue;
    const chave = t.toLowerCase();
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    saida.push(t);
    if (Number.isFinite(maximo) && saida.length >= maximo) break;
  }
  return saida;
}

// Quantos interesses uma linha da tabela pode ter. Um termo largo ("moda")
// devolve dez resultados sozinho; sem teto, um termo desses tomaria a faixa
// inteira e os outros sete termos não apareceriam.
//
// ⚠️ ONDE ESTE TETO SE APLICA MUDOU EM 2026-08-01, E O PORQUÊ IMPORTA.
//
// Ele valia ANTES da IA escolher, cortando **por tamanho de público**. Efeito
// medido: `Cinto` (37 mi) — produto da MAIOR categoria do estoque, 398 peças —
// não entrava em objetivo nenhum. Ele não era recusado pela IA: era eliminado
// antes de chegar a ela, porque não cabia entre os 12 MAIORES. Quem ocupava a
// vaga: `Hard rock` (186 mi, ruído do termo "clutch"), `Bolsa de estudo`
// (88 mi), `black friday` (178 mi).
//
// A prova estava no log e passou batida por um tempo: as seis linhas de escolha
// diziam "a IA ficou com N de **12**" — sempre 12, em todos os objetivos. Era o
// teto, não o tamanho real da colheita.
//
// E era um corte que PIORAVA conforme o robô melhorava: cada termo de produto
// novo trazia mais gente grande, empurrando os produtos pequenos pra fora.
//
// Agora a ordem é: colhe tudo → **a IA escolhe entre tudo** → o teto se aplica
// ao que ela escolheu. O corte deixa de ser por tamanho e passa a ser por
// relevância julgada, que é o único critério que sabe a diferença entre `Cinto`
// e `Hard rock`.
export const MAXIMO_POR_OBJETIVO = 12;

// TETO DE PÚBLICO — acima disto o interesse não é critério de segmentação.
//
// "Compras na internet" tem 1,58 BILHÃO de pessoas. Escolher isso como interesse
// é o mesmo que não escolher interesse nenhum: não separa cliente de
// não-cliente, só dá a impressão de que a campanha está mirando alguém.
//
// ESTE NÚMERO É PROVISÓRIO, e está escrito aqui pra ser mudado.
// Ele saiu de UMA rodada, e a rodada mediu pouco: dos tamanhos que o dono julgou,
// só conhecemos dois que ele recusou (1,58 bi e 178 mi) — e NENHUM dos quatro
// interesses que ele aprovou. Ou seja, não sabemos onde começa o "largo demais",
// só sabemos um lugar onde ele com certeza já passou.
//
// Por isso a linha começa ALTA, em 500 milhões: ela corta o que é indefensável
// e não arrisca derrubar às cegas um interesse bom cujo tamanho ninguém mediu.
// Errar pra cima deixa entrar lixo que o dono vê e reclama; errar pra baixo
// apaga interesse bom sem ninguém nunca saber que ele existiu.
//
// E TEM UM PORÉM QUE IMPEDE DE APERTAR NO CHUTE: o tamanho que a Meta devolve
// parece ser GLOBAL, não do Brasil. Um número grande não é automaticamente
// errado pra cá. Só dá pra baixar esta linha depois de ver, na rodada seca, os
// tamanhos dos interesses que PRESTAM — e é justamente por isso que a prévia
// mostra o tamanho de tudo que fica, e o log lista tudo que foi cortado por
// aqui.
//
// AFROUXADO DE 500 MI PRA 1,2 BI (rodada de 2026-07-31, decisão do dono).
// A rodada seca mostrou o teto cortando `Acessórios de moda` (1,15 bi) nos SEIS
// objetivos — a categoria da própria loja, o descarte mais caro que este robô
// podia estar fazendo. O argumento que sustentava os 500 mi caiu junto: o
// anúncio sempre sai preso na cidade da loja com raio (ver `montarTargeting` em
// publico.mjs), então um interesse global grande NÃO espalha verba pelo Brasil
// — ele só descreve gente demais no mundo, e o recorte de cidade resolve isso.
//
// 1,2 bi é a linha entre os dois únicos tamanhos que já foram julgados de
// verdade: `Acessórios de moda` (1,15 bi, serve) e `Compras na internet`
// (1,58 bi, não serve — "compra pela internet" não separa cliente de
// não-cliente). Continua PROVISÓRIO, e agora os dois erros aparecem no log:
// o que passou do teto e o que não chegou ao piso.
export const TETO_DE_PUBLICO = 1_200_000_000;

// PISO DE PÚBLICO — pequeno demais pra existir na cidade da loja.
//
// A rodada de 2026-07-31 escancarou a falta dele: `VK Moda Feminina Plus Size`
// — uma página de rede social RUSSA com 3 MIL pessoas no mundo inteiro — foi
// parar nos SEIS objetivos, enquanto a categoria da loja era descartada por
// cima. O filtro tinha teto e não tinha chão, então o lixo miúdo passava batido
// e ainda ocupava vaga na faixa.
//
// A conta é de gente, não de gosto: 3 mil pessoas ESPALHADAS PELO MUNDO viram
// aproximadamente zero dentro de um raio de 20 km em Campinas. Um interesse
// assim não segmenta — ele esvazia. A Meta chega a recusar conjunto sem público
// suficiente, e quando não recusa, entrega para quase ninguém.
//
// 500 mil (global) é folgado de propósito, pela mesma lógica do teto: errar pra
// baixo aqui deixa passar miudeza que aparece no log e se corrige; errar pra
// cima apagaria interesse bom de nicho sem ninguém saber que existiu. Continua
// PROVISÓRIO — mexer só com rodada seca na mão.
//
// Tamanho DESCONHECIDO (null) NUNCA é cortado, nem por cima nem por baixo:
// não se joga fora o que não se conseguiu medir.
export const PISO_DE_PUBLICO = 500_000;

// A CATEGORIA do interesse, do jeito que a Meta manda: um caminho de migalhas
// ("Compras e moda" > "Bolsas").
//
// MEDIDO, E NÃO SERVE PRA FILTRAR: a aposta era que ela separasse "Bolsas"
// (Compras e moda) de "Observe and Report" (Entretenimento > Filmes). Na conta
// de verdade, quase tudo volta como "Interesses > Outros interesses > <o próprio
// nome do interesse>" — um lugar-nenhum que só repete o nome. De 36 interesses,
// UM tinha categoria de verdade.
//
// Continua sendo colhida e mostrada no log seco (custa nada e é bom ter à
// vista), mas NÃO escreva regra em cima dela até o Meta passar a preenchê-la:
// uma regra assim não filtraria nada e ninguém desconfiaria, porque não filtrar
// nada e filtrar errado se parecem demais quando não se olha.
//
// E foi por ter COLHIDO ANTES DE FILTRAR que isso apareceu de graça, em vez de
// virar mais uma rodada perdida.
//
// Devolve sempre um ARRAY DE TEXTOS, vazio quando não deu pra saber. Aqui vazio
// e ausente valem a mesma coisa de propósito: os dois querem dizer "não sei a
// categoria", e nenhuma decisão depende de distinguir um do outro (diferente do
// audience_size, onde 0 e desconhecido são fatos distintos e por isso null é
// obrigatório).
//
// Aceita array (filtrando pro que é texto de verdade) e também texto solto, caso
// a Meta mude o formato: numa rodada de diagnóstico, mostrar o que veio vale
// mais que descartar por não ser exatamente a forma esperada. Qualquer outra
// coisa vira vazio.
function caminhoDoInteresse(bruto) {
  if (typeof bruto === 'string') {
    const s = limpo(bruto);
    return s ? [s] : [];
  }
  const saida = [];
  for (const p of lista(bruto)) {
    const s = limpo(p);          // item nulo, número ou objeto no meio: pulado
    if (s) saida.push(s);
  }
  return saida;
}

// OS NOMES VÊM DA META, NÃO DA IA. Aqui se colhe o que as buscas devolveram —
// cada termo da IA virou uma busca `type=adinterest`, e o que volta é catálogo
// de verdade, já com id e tamanho de público. A IA nunca escreve um nome que
// chegue à tabela: ela só escolhe o assunto.
//
// A função que existia antes (`filtrarValidos`) fazia o contrário: recebia os
// nomes que a IA tinha escrito e jogava fora o que a Meta não reconhecia.
// Funcionava, mas jogava fora 85% — daí a inversão.
//
// `respostas` é a lista de respostas acumuladas, UMA POR TERMO buscado, cada uma
// no formato que a Meta devolve ({ data: [...] }). Vem como lista porque uma
// busca pode ter falhado sozinha: o robô segue com as outras, e o que chegou
// aqui é só o que deu certo.
//
// Devolve `{ itens, propostos, validos }` como sempre — tabela, faixa e
// contadores não mudam — mais `largos` e `pequenos`, que são os cortados pelo
// teto e pelo piso de público. Nenhum dos dois vai pro banco: existem pra rodada
// seca poder mostrar no log o que foi jogado fora e por quê. Corte que ninguém
// vê é corte que ninguém consegue corrigir, e as duas linhas nasceram
// provisórias de propósito.
//
// `propostos` são os TERMOS que a IA deu, `validos` os interesses distintos que
// ficaram. Não é taxa de sobrevivência, é quanto rendeu.
export function colherDaBusca(termos, respostas, limite = MAXIMO_POR_OBJETIVO, teto = TETO_DE_PUBLICO, piso = PISO_DE_PUBLICO) {
  const vistos = new Set();
  const itens = [];
  const largos = [];
  const pequenos = [];
  for (const resposta of lista(respostas)) {
    for (const l of lista(resposta && resposta.data)) {
      if (!l || typeof l !== 'object') continue;   // item nulo ou lixo: pulado
      if (l.id == null) continue;                  // sem id não dá pra usar
      // Só aceita id string ou número; qualquer outro tipo é garbage que não pode
      // ser um identificador de verdade (objeto, array, boolean viram identificadores
      // fake como "[object Object]" ou "true" se convertidos a string, e depois quebram
      // na tabela e na conta). NaN é typeof 'number' mas também é garbage: "NaN" string.
      if (typeof l.id !== 'string' && typeof l.id !== 'number') continue;
      if (Number.isNaN(l.id)) continue;
      const id = String(l.id);
      // Repetido sai aqui, e agora ele é ROTINA, não exceção: termos parecidos
      // ("bolsa" e "bolsas") devolvem o mesmo interesse, e cada busca vem numa
      // resposta diferente — a comparação tem de valer entre TODAS elas.
      if (vistos.has(id)) continue;
      const nome = limpo(l.name);
      if (!nome) continue;
      vistos.add(id);
      // Tamanho do público: TRÊS nomes de campo possíveis, na ordem de preferência.
      // A Graph v22 (a versão que o meta-proxy usa) aposentou o `audience_size`
      // pelado nas buscas de segmentação em favor de `audience_size_lower_bound` /
      // `audience_size_upper_bound` — a mesma família de mudança que já mordeu este
      // projeto com `approximate_count` → `approximate_count_upper_bound` (a cicatriz
      // está anotada no painel-subir.vue). Ler só o nome antigo não daria ERRO: daria
      // tamanho nulo em TODO interesse, e a faixa apareceria sem número nenhum, que é
      // justamente o que ela tem de mais útil. Aceitar os três resolve nos dois mundos.
      // Ausente continua virando null (tamanho DESCONHECIDO), nunca 0.
      const bruto = l.audience_size ?? l.audience_size_upper_bound ?? l.audience_size_lower_bound;
      let audience_size = null;
      if (bruto != null) {
        const n = Number(bruto);
        if (Number.isFinite(n)) audience_size = n;
      }
      const item = { id, nome, audience_size, path: caminhoDoInteresse(l.path) };
      // LARGO DEMAIS pra ser critério de segmentação — ver TETO_DE_PUBLICO.
      //
      // Só corta quem TEM tamanho medido e passou do teto. Tamanho DESCONHECIDO
      // (null) NUNCA é cortado aqui: não se joga fora o que não se conseguiu
      // medir. Tratar null como "grande" seria condenar por falta de prova, e
      // tratar como "pequeno" já é o que acontece — ele fica, e vai pro fim da
      // fila na ordenação, que é o lugar honesto de quem não tem número.
      const largoDemais = audience_size != null && Number.isFinite(teto) && audience_size > teto;
      // PEQUENO DEMAIS — ver PISO_DE_PUBLICO. Mesmas duas cautelas do teto:
      // só corta quem TEM tamanho medido, e "no piso" FICA (só sai quem está
      // abaixo). Um interesse não pode ser largo e pequeno ao mesmo tempo, então
      // a ordem entre os dois testes não muda resultado nenhum.
      const pequenoDemais = audience_size != null && Number.isFinite(piso) && audience_size < piso;
      if (largoDemais) largos.push(item);
      else if (pequenoDemais) pequenos.push(item);
      else itens.push(item);
    }
  }

  // MAIOR PÚBLICO PRIMEIRO: é a ordem que serve ao dono, porque a faixa mostra
  // as primeiras e ele quer ver antes o interesse que alcança mais gente.
  // Tamanho DESCONHECIDO (null) vai pro fim, nunca pro começo — ordenar null
  // como se fosse zero já seria ruim; deixá-lo na frente colocaria justamente o
  // que não se sabe medir no lugar de mais destaque.
  const peso = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : -Infinity);
  const porTamanho = (a, b) => peso(b.audience_size) - peso(a.audience_size);
  itens.sort(porTamanho);
  largos.sort(porTamanho);   // o maior primeiro também aqui: o log fica lendo do pior pro menos pior
  // Nos pequenos a leitura útil é a inversa — o MENOR primeiro é o mais absurdo,
  // e é ele que explica o corte (foi um de 3 mil que motivou o piso).
  pequenos.sort((a, b) => peso(a.audience_size) - peso(b.audience_size));

  const cortados = Number.isFinite(limite) && limite >= 0 ? itens.slice(0, limite) : itens;
  // `validos` conta o que FICOU na linha, não o que foi colhido antes do corte:
  // a tabela guarda `itens` e `validos` lado a lado, e um número maior que a
  // lista ao lado dele seria uma contradição visível na própria tela.
  return { itens: cortados, propostos: lista(termos).length, validos: cortados.length, largos, pequenos };
}

// Tamanho de público em português: '2,3 mi', '940 mil', '850'.
//
// É A MESMA REGRA da etiqueta da faixa na Fábrica (painel-subir.vue,
// "formatarPublico"), copiada de propósito — o robô é Node e a outra mora dentro
// de um .vue, então não dá pra importar. Se um dia divergirem, o log do robô e a
// tela mostrariam números diferentes pro MESMO interesse, e quem estivesse
// conferindo um contra o outro ia achar que o robô gravou errado.
//
// O corte do 'mi' é 999.500 e não 1.000.000 porque a faixa de baixo ARREDONDA:
// com corte em 1 milhão, 999.999 caía no 'mil', virava Math.round(999,999) =
// 1.000 e aparecia como '1.000 mil' — que ninguém escreve.
//
// Desconhecido devolve '' (e não '0'): nulo e zero são fatos diferentes, e quem
// chama decide o que escrever no lugar.
export function tamanhoLegivel(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '';
  // 'bi' pelo mesmo motivo do 'mi', um degrau acima: sem ele, 1,58 bilhão sai
  // como '1.580 mi', que ninguém lê como um bilhão e meio. O corte é 999,5 mi
  // pra faixa de baixo não arredondar em '1.000 mi'.
  if (n >= 999_500_000) return (n / 1_000_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + ' bi';
  if (n >= 999_500) return (n / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mi';
  if (n >= 1_000) return Math.round(n / 1000).toLocaleString('pt-BR') + ' mil';
  return n.toLocaleString('pt-BR');
}

// A categoria pronta pro log: 'Compras e moda > Bolsas', ou o aviso de que a
// Meta não mandou nenhuma. Aparece em TUDO que o log mostra (o que fica e o que
// é cortado), porque é justamente o valor que esta rodada foi medir.
function categoriaLegivel(path) {
  const c = lista(path).filter((p) => typeof p === 'string' && p);
  return c.length ? c.join(' > ') : 'sem categoria';
}

// OS TERMOS QUE A IA DEVOLVEU — só na rodada seca, e é o buraco que duas rodadas
// zeradas escancararam: com zero interesse achado, os termos eram a ÚNICA pista
// do que tinha acontecido, e eles eram invisíveis. É a mesma falta que os nomes
// de interesse tinham, um andar acima.
//
// Sai ANTES das buscas, e não depois: numa rodada em que tudo falha ou tudo vem
// vazio, esta linha ainda assim aparece.
export function linhaDosTermos(termos) {
  const limpos = [];
  for (const t of lista(termos)) {
    const s = limpo(t);
    if (s) limpos.push(s);
  }
  if (!limpos.length) return '';
  // Junta com ' · ' e não com vírgula: termo pode ter vírgula dentro, e aí não
  // dava pra saber onde um acaba e o outro começa.
  return `termos da IA: ${limpos.join(' · ')}`;
}

// AS LINHAS DO QUE FOI CORTADO POR SER LARGO DEMAIS — só na rodada seca.
//
// O teto de público é provisório e foi tirado de uma medição só. Um corte que
// não aparece em lugar nenhum é um corte que ninguém consegue conferir: o dono
// veria a faixa menor e não saberia se o robô achou pouco ou se jogou fora
// muito. Mostrando nome, tamanho e categoria de cada descartado, a próxima
// rodada tem com o que ajustar a linha — que é exatamente o que falta hoje.
export function linhasDosLargos(largos, teto = TETO_DE_PUBLICO) {
  const linhas = [];
  for (const i of lista(largos)) {
    if (!i || typeof i !== 'object') continue;
    const nome = limpo(i.nome);
    if (!nome) continue;
    linhas.push(`         · ${nome} — ${tamanhoLegivel(i.audience_size) || 'tamanho desconhecido'}  [${categoriaLegivel(i.path)}]`);
  }
  if (!linhas.length) return [];
  const limite = tamanhoLegivel(teto);
  return [`      descartados por serem largos demais${limite ? ` (acima de ${limite})` : ''}:`, ...linhas];
}

// AS LINHAS DO QUE FOI CORTADO POR SER PEQUENO DEMAIS — irmã da de cima.
//
// Existe pelo mesmo motivo, e por uma dívida concreta: o piso foi criado DEPOIS
// de um interesse de 3 mil pessoas passar em seis objetivos sem ninguém ver.
// Um corte novo que nascesse mudo repetiria exatamente o erro que ele conserta.
export function linhasDosPequenos(pequenos, piso = PISO_DE_PUBLICO) {
  const linhas = [];
  for (const i of lista(pequenos)) {
    if (!i || typeof i !== 'object') continue;
    const nome = limpo(i.nome);
    if (!nome) continue;
    linhas.push(`         · ${nome} — ${tamanhoLegivel(i.audience_size) || 'tamanho desconhecido'}  [${categoriaLegivel(i.path)}]`);
  }
  if (!linhas.length) return [];
  const limite = tamanhoLegivel(piso);
  return [`      descartados por serem pequenos demais${limite ? ` (abaixo de ${limite})` : ''}:`, ...linhas];
}

// O QUE CADA TERMO ACHOU, um termo por linha — só na rodada seca.
//
// A PERGUNTA QUE ISTO RESPONDE: os seis objetivos pedem coisas diferentes e
// voltam com a mesma lista. De quem é a culpa — da IA, que estaria repetindo
// assunto, ou do catálogo da Meta, que é grosso e devolve o mesmo genérico pra
// termos distintos?
//
// A rodada de 2026-07-31 deixou isso empatado: "mensagens" pediu `atendimento
// personalizado`, `WhatsApp compras`, `consultoria moda` — termos claramente
// diferentes dos de "leads" — e as duas listas saíram iguais. Só que o log
// mostrava os termos de um lado e os achados do outro, sem ligar um ao outro,
// então a culpa ficou por indício. Ligando os dois, a resposta fica óbvia de
// ler: termo que volta VAZIO é o catálogo que não tem aquilo; termo que volta
// cheio e sempre com os mesmos nomes é a IA batendo na mesma tecla.
//
// MOSTRA O QUE A META DEVOLVEU, CRU — antes do teto, do piso, do limite por
// objetivo e da retirada de repetidos. É de propósito: aqui se julga a BUSCA,
// não o nosso filtro. Quem julga o filtro são as duas listas de descartados.
//
// `buscas` é a lista de pares { termo, resposta } — pares, e não dois arrays
// lado a lado, porque busca que falha não entra na lista: com dois arrays, um
// termo que falhasse no meio empurraria todos os outros pra linha errada e o
// log passaria a mentir com cara de precisão.
export const MAXIMO_NOMES_POR_TERMO = 6;

export function linhasPorTermo(buscas, maximo = MAXIMO_NOMES_POR_TERMO) {
  const linhas = [];
  for (const b of lista(buscas)) {
    if (!b || typeof b !== 'object') continue;
    const termo = limpo(b.termo);
    if (!termo) continue;
    const nomes = [];
    for (const l of lista(b.resposta && b.resposta.data)) {
      if (!l || typeof l !== 'object') continue;
      const nome = limpo(l.name);
      if (nome) nomes.push(nome);
    }
    // 'nada' por extenso: é o caso mais informativo dos dois, e um traço solto
    // ou uma linha em branco pareceria log truncado em vez de resposta vazia.
    if (!nomes.length) { linhas.push(`         · "${termo}" → nada`); continue; }
    const teto = Number.isFinite(maximo) && maximo > 0 ? maximo : nomes.length;
    const mostrados = nomes.slice(0, teto);
    const sobra = nomes.length - mostrados.length;
    linhas.push(`         · "${termo}" → ${mostrados.join(' · ')}${sobra > 0 ? ` (+${sobra})` : ''}`);
  }
  if (!linhas.length) return [];
  return ['      o que cada termo achou na Meta (cru, antes dos cortes):', ...linhas];
}

// A PRÉVIA DA RODADA SECA: as linhas que mostram O QUE SERIA GRAVADO.
//
// Sem isto, a rodada seca dizia só "56 interesses achados" — e uma prévia que
// não mostra o que seria escrito faz metade do serviço: o número diz se rendeu,
// mas só os NOMES dizem se prestam. Quantidade e qualidade são perguntas
// diferentes, e o dono é quem responde a segunda.
//
// Fica aqui, no arquivo puro, pelo mesmo motivo do resto: `sugerir-interesses.mjs`
// executa no import, então nada lá dentro tem teste.
//
// Ordem preservada: a lista chega de `colherDaBusca` já ordenada por maior
// público, e é NESTA ordem que ela vai pro banco. A prévia mostra exatamente
// isso — reordenar aqui seria mostrar uma coisa e gravar outra.
export function linhasDaPrevia(itens) {
  const saida = [];
  let posicao = 0;
  for (const i of lista(itens)) {
    if (!i || typeof i !== 'object') continue;      // item nulo ou lixo: pulado
    const nome = limpo(i.nome);
    if (!nome) continue;
    posicao += 1;
    const tam = tamanhoLegivel(i.audience_size);
    // 'tamanho desconhecido' por extenso, nunca '0' nem espaço em branco: no log
    // um traço solto pareceria número faltando por defeito do robô.
    // A CATEGORIA entre colchetes no fim: é o dado que esta rodada foi buscar, e
    // é lendo esta coluna que se decide se dá pra filtrar por ela.
    saida.push(`      ${String(posicao).padStart(2, ' ')}. ${nome} — ${tam || 'tamanho desconhecido'}  [${categoriaLegivel(i.path)}]`);
  }
  return saida;
}
