// EM QUE BALDE cada campanha entra, na seção 02 do painel de Redes Sociais.
//
// A decisão sai do sinal que a META AFIRMA no conjunto (destination_type e
// optimization_goal) — NUNCA do nome da campanha. Nomear por convenção
// ("| PERFIL", "[+ SEGUIDORES]") funciona hoje nestas contas e quebra no primeiro
// dia em que alguém nomear diferente.
//
// POR QUE NÃO DÁ PRA USAR SÓ O OBJETIVO (medido em 17/08/2026, produção):
//   - Vessel: R$ 5.699 dos R$ 6.553 com objetivo "Engajamento" são WhatsApp.
//     Somando cru, o custo por seguidor de lá ficaria ~8x mais caro do que é.
//   - Breno Vale: os R$ 2.584 de "Tráfego" vão para o PERFIL — são de seguidor
//     da cabeça aos pés. Um recorte "só engajamento" deixaria a conta zerada.
//
// POR QUE ESTE MÓDULO EXISTE, se a Gestão de Tráfego já tem baldes.js: lá,
// tráfego-para-o-perfil e tráfego-para-o-site caem os dois em 'trafego', e é
// justamente essa divisão que dá sentido ao balde Seguidores. Mexer aqui não
// pode mudar o veredito da régua de lá — por isso o mapa novo mora à parte, e
// só o que é comum vem importado.
// PURO: sem rede, sem tela.
import { ehDeWhatsapp, baldeDoObjetivo } from '../gestao-trafego/baldes.js';

export const BALDES = [
  { id: 'todos', rotulo: 'Todos' },
  { id: 'seguidores', rotulo: 'Seguidores' },
  { id: 'contatos', rotulo: 'Contatos' },
  { id: 'site', rotulo: 'Site e alcance' },
  { id: 'vendas', rotulo: 'Vendas' },
];

export function rotuloDoBalde(id) {
  const b = BALDES.find(x => x.id === id);
  return b ? b.rotulo : 'Todos';
}

const NORM = v => String(v || '').toUpperCase();

// Destinos que são CONVERSA. MESSAGING_* cobre as combinações que a Meta foi
// criando (MESSAGING_INSTAGRAM_DIRECT_MESSENGER_WHATSAPP e parentes).
function ehConversa(conjuntos) {
  if (ehDeWhatsapp(conjuntos)) return true;
  return (conjuntos || []).some((s) => {
    const d = NORM(s && s.destination_type);
    return d === 'INSTAGRAM_DIRECT' || d === 'MESSENGER' || d.startsWith('MESSAGING_');
  });
}

function algumConjunto(conjuntos, teste) {
  return (conjuntos || []).some(s => teste(NORM(s && s.destination_type), NORM(s && s.optimization_goal)));
}

// A ordem aqui É a regra. A primeira que casar vence — ver a tabela do desenho.
//
// OS DESTINOS SÃO OS QUE A META DEVOLVEU DE VERDADE, não os que eu imaginei. A
// coleta de 17/08/2026 (299 conjuntos, 5 contas) trouxe dez: INSTAGRAM_PROFILE,
// INSTAGRAM_PROFILE_AND_FACEBOOK_PAGE, INSTAGRAM_DIRECT,
// MESSAGING_INSTAGRAM_DIRECT_MESSENGER_WHATSAPP, WHATSAPP, ON_POST, ON_VIDEO,
// ON_AD, WEBSITE, WEBSITE_AND_PHONE_CALL — e UNDEFINED.
export function baldeDaCampanha(campanha) {
  const c = campanha || {};
  const conjuntos = Array.isArray(c.conjuntos) ? c.conjuntos : [];
  const objetivo = baldeDoObjetivo(c.objective);

  if (ehConversa(conjuntos)) return 'contatos';            // 1 — conversa vence tudo
  if (objetivo === 'leads') return 'contatos';             // 2 — cadastro
  // 3 — PERFIL. Prefixo, não igualdade: a Meta também devolve
  // INSTAGRAM_PROFILE_AND_FACEBOOK_PAGE, e com `===` essa campanha caía no
  // objetivo e terminava em 'site' — o erro exato que este módulo elimina.
  // Vem DEPOIS da regra 1 de propósito: INSTAGRAM_DIRECT não é perfil, é conversa.
  if (algumConjunto(conjuntos, (d, o) => d.startsWith('INSTAGRAM_PROFILE') || o === 'PROFILE_VISIT')) return 'seguidores';
  // 4 — engajamento na peça. ON_AD é o terceiro lugar onde a Meta põe isso.
  if (algumConjunto(conjuntos, (d, o) => d === 'ON_POST' || d === 'ON_VIDEO' || d === 'ON_AD' || o === 'POST_ENGAGEMENT' || o === 'THRUPLAY')) return 'seguidores';
  if (objetivo === 'vendas') return 'vendas';              // 5
  if (objetivo === 'mensagens') return 'contatos';         // objetivo antigo MESSAGES
  // 6 — SITE declarado no conjunto. Mandar gente para FORA do Instagram não é
  // campanha de seguidor, mesmo com objetivo de engajamento.
  //
  // Entra aqui, e não antes da regra 5, porque quase toda campanha de VENDA
  // aponta para o site: subir esta regra esvaziaria o balde de Vendas.
  if (algumConjunto(conjuntos, (d) => d === 'WEBSITE' || d === 'WEBSITE_AND_PHONE_CALL')) return 'site';
  if (objetivo === 'engajamento') return 'seguidores';     // sem conjunto: engajamento é do perfil
  // 7 — tráfego, cliques, reconhecimento, desconhecido. UNDEFINED cai aqui de
  // propósito: é a Meta dizendo que não sabe, e inventar um balde a partir disso
  // seria responder errado com confiança.
  return 'site';
}

export function idsDoBalde(campanhas, balde) {
  const lista = campanhas || [];
  if (balde === 'todos' || !balde) return lista.map(c => String(c.campaign_id));
  return lista.filter(c => baldeDaCampanha(c) === balde).map(c => String(c.campaign_id));
}

// O balde recorta o TIPO; o "⚙ Filtrar campanhas" recorta DENTRO dele. Os dois se
// somam.
//
// `selecionadas` segue a régua que já existe no painel: null = todas as campanhas,
// [] = NENHUMA (escolha do dono, não ausência de escolha).
export function idsParaConsulta(campanhas, balde, selecionadas) {
  const doBalde = idsDoBalde(campanhas, balde);
  if (selecionadas == null) return doBalde;
  const marcadas = new Set(selecionadas.map(String));
  return doBalde.filter(id => marcadas.has(id));
}

// SÓ A ÚLTIMA COLETA DE CONJUNTOS VOTA.
//
// campaign_adsets nunca encolhe: o coletor grava o que a Meta devolve e não apaga
// o que sumiu de lá. Sem esta peneira, um conjunto de WhatsApp desligado há meses
// continuaria classificando a campanha como Contatos para sempre — e o dinheiro
// dela nunca mais voltaria ao balde certo.
//
// A régua é o MAIOR `synced_at` que está DENTRO do próprio dado, nunca a data de
// hoje: se a coleta falhar por alguns dias, o maior é simplesmente a última rodada
// boa e nada se perde. Linha sem `synced_at` cai fora — ela não tem como provar
// que é a mais recente. Se TODAS caírem, a tela usa o mesmo caminho de quando a
// tabela está vazia: cada campanha classificada pelo objetivo. Ninguém some.
//
// Comparação por texto de propósito: `synced_at` chega do PostgREST como data ISO
// ('2026-08-17'), e ISO ordena igual em texto e no calendário.
export function conjuntosMaisRecentes(linhas) {
  const lista = Array.isArray(linhas) ? linhas.filter(l => l && l.synced_at) : [];
  if (lista.length === 0) return [];
  const maior = lista.reduce((m, l) => (String(l.synced_at) > m ? String(l.synced_at) : m), '');
  return lista.filter(l => String(l.synced_at) === maior);
}

// QUAIS BALDES NÃO TÊM DINHEIRO na janela — os que a barra apaga.
//
// `idsPorBalde` = { seguidores: [ids], contatos: [ids], … } já com o filtro
// manual aplicado. `linhasDeGasto` = o gasto DIÁRIO por campanha da janela.
//
// SÉRIE DIÁRIA VAZIA NÃO É "NINGUÉM GASTOU". A conta sai do gasto por dia
// (period_days=0), mas os cartões leem o agregado de 7/30 dias, e as duas fatias
// não têm o mesmo frescor: em 17/08/2026 o último dia solto do Breno Vale e da
// Raíssa era 09/08, fora da janela padrão de 7D (10/08..16/08). Sem esta guarda a
// barra apagava os quatro botões e afirmava que ninguém tinha gastado, enquanto
// essas contas gastaram R$ 80,41 e R$ 297,21 exatamente ali. Sem medida, não se
// afirma nada: devolve lista vazia e todos os botões continuam clicáveis.
export function baldesSemGasto(idsPorBalde, linhasDeGasto) {
  const mapa = idsPorBalde || {};
  const linhas = Array.isArray(linhasDeGasto) ? linhasDeGasto : [];
  if (linhas.length === 0) return [];
  const baldeDoId = {};
  const gasto = {};
  Object.keys(mapa).forEach((b) => {
    gasto[b] = 0;
    (mapa[b] || []).forEach((id) => { baldeDoId[String(id)] = b; });
  });
  linhas.forEach((l) => {
    const b = baldeDoId[String(l && l.campaign_id)];
    if (b) gasto[b] += (parseFloat(l && l.spend) || 0);
  });
  return Object.keys(mapa).filter(b => !(gasto[b] > 0));
}

// EM QUE BALDE A TELA REALMENTE ENTRA. O escolhido pode não existir neste perfil
// (a Motoeasy não tem campanha de seguidores) ou não ter rodado neste período;
// nesse caso a tela cai em Todos, em vez de mostrar R$ 0 como se fosse resposta.
//
// Repare que ele NÃO devolve uma escolha nova para gravar: quem escolheu continua
// tendo escolhido. Voltar a um perfil que tem aquele balde devolve a pessoa onde
// ela estava — é isso que segura o modo vitrine, que troca de perfil sozinho.
export function baldeEfetivo(escolhido, vazios) {
  if (!escolhido) return 'todos';
  return (vazios || []).includes(escolhido) ? 'todos' : escolhido;
}

// "PROVISÓRIO" SÓ PODE SIGNIFICAR "A LEITURA FUNCIONOU E VEIO VAZIA" — nunca "a
// leitura falhou". sb() (buscar-e-salvar-dados.js) devolve [] tanto para "este
// perfil não tem conjunto nenhum" quanto para erro de rede/sessão/permissão, e
// distingue os dois pendurando um .erro (não-enumerável) no próprio array. Achou
// [] sem checar .erro já quebrou uma vez aqui: a tela dizia "classificação
// provisória" num caso que podia ser "a leitura falhou" — quem tinha de falar
// ali era o banner de erro geral, não este aviso.
//
// LIMITE CONHECIDO, e não corrigido por esta função porque não tem como: negação
// por RLS chega como sucesso HTTP (200 + []) SEM nenhum .erro — pra quem só vê o
// array, é idêntico a "genuinamente vazio".
//
// ISSO DEIXOU DE SER HIPOTÉTICO EM 17/08/2026: `campaign_adsets` passou a ter
// política por conta, mais estreita que a das outras tabelas que esta tela lê.
// Usuário sem acesso àquela conta recebe 200 + [] e lê "classificação
// provisória" quando a verdade é "sem permissão para ver isto". A frase erra
// pelo lado seguro (ela diz que o número pode mudar, e pode), mas erra: quem
// pode consertar é uma política que devolva erro, não esta função — daqui não dá
// para distinguir os dois casos, e inventar a distinção seria pior.
export function classificacaoEhProvisoria(linhasDeConjunto) {
  const linhas = linhasDeConjunto || [];
  return linhas.length === 0 && !linhas.erro;
}

// QUANTAS CAMPANHAS COM DINHEIRO NA JANELA AINDA NÃO TÊM CONJUNTO COLETADO.
//
// A tabela cheia não quer dizer classificação fechada. O aviso do perfil inteiro
// (classificacaoEhProvisoria) só dispara quando NENHUM conjunto foi coletado, e
// os cinco perfis ativos já têm os seus — então ele nunca mais fala. O risco de
// verdade é POR CAMPANHA: na Vessel, `TESTE CHAT - LIMEIRA` não tem conjunto
// nenhum, cai pelo objetivo e vai parar em Seguidores, enquanto a gêmea
// `TESTE CHAT LIMEIRA 123`, que tem conjunto, vai para Contatos. Campanha criada
// agora fica exatamente nesse estado até a próxima coleta, e nada na tela dizia
// isso.
//
// SÓ ENTRA QUEM GASTOU NA JANELA EXIBIDA, e essa condição é o coração desta
// função — não um detalhe. Medido em produção (17/08/2026): das 38 campanhas sem
// conjunto nas cinco contas, UMA tem gasto nos últimos 30 dias. Contando todas,
// a faixa vermelha do topo ficaria acesa para sempre em três dos cinco perfis
// (Raíssa 27, Vessel 8, Breno Vale 3) falando de campanha que não move um
// centavo em cartão nenhum — e aviso que nunca apaga vira moldura: em uma semana
// ninguém mais o lê, e aí ele fica mudo justamente no dia em que importa.
//
// Campanha sem gasto na janela não tem como distorcer número nenhum da tela: não
// entra no investimento, não entra em denominador nenhum e não decide se um tipo
// está vazio. O caso que o aviso existe para pegar sobrevive inteiro — campanha
// nova que JÁ ESTÁ GASTANDO antes da primeira coleta de conjuntos é, por
// definição, campanha com gasto e sem conjunto, e continua acendendo a faixa.
//
// `idsComGastoNaJanela` sai da própria captura que os cartões somaram, então é
// exatamente o dinheiro que está impresso na tela — não uma segunda medição.
export function campanhasSemTipoConfirmado(campanhas, idsComGastoNaJanela) {
  const lista = Array.isArray(campanhas) ? campanhas : [];
  const comGasto = new Set((idsComGastoNaJanela || []).map(String));
  return lista.filter(c => comGasto.has(String(c && c.campaign_id))
    && !(Array.isArray(c && c.conjuntos) && c.conjuntos.length > 0)).length;
}

// A FRASE DEBAIXO DA BARRA — "Campanhas consideradas no cálculo: …".
//
// Ela afirma o que está valendo, e por isso tem de saber do TIPO de campanha: na
// primeira pintura desta obra a tela dizia "Todas as campanhas (126)" logo acima
// de quatro cartões que falavam de 9 delas. A frase e os números discordavam na
// mesma tela, e quem lê acredita na frase.
//
// `doBalde` = quantas campanhas o tipo escolhido tem, ANTES do filtro manual.
// Pode chegar null: a pintura que acontece na troca de perfil, antes dos dados,
// não sabe esse número. Nesse caso a frase diz o tipo e CALA a contagem — em vez
// de inventar uma.
export function fraseDoRecorte(balde, contagens, opcoes) {
  const c = contagens || {};
  // ⚠️ "SEM CAMPANHA NO PERÍODO" NÃO É "NINGUÉM SELECIONADO". A primeira é do
  // período (não houve gasto desse tipo nesses dias); a segunda é escolha de
  // quem desmarcou tudo à mão. Dizer a errada manda a pessoa procurar defeito no
  // filtro quando o problema é o intervalo, e vice-versa. Pedido do dono em
  // 10/09/2026, ao clicar num balde que o período não tinha.
  if (opcoes && opcoes.semGastoNoPeriodo) return 'Sem campanhas para esse período';
  const total = Number(c.total) || 0;
  const noRecorte = Number(c.noRecorte) || 0;
  const doBalde = (c.doBalde == null) ? null : (Number(c.doBalde) || 0);
  const ehTodos = !balde || balde === 'todos';
  const rotulo = rotuloDoBalde(balde);
  // Ordem herdada da frase de hoje: "nenhuma" vem antes de tudo, inclusive de
  // "a conta não tem campanha" — o dono que desmarca todas tem de ler isso.
  if (noRecorte === 0 && c.noRecorte != null) return 'Nenhuma campanha selecionada';
  if (total === 0) return 'Todas as campanhas (0)';
  if (ehTodos) {
    if (noRecorte === total) return 'Todas as campanhas (' + total + ')';
    return noRecorte + ' de ' + total + ' campanhas selecionadas';
  }
  if (doBalde == null) {
    // Sem a contagem do tipo, só dá para afirmar duas coisas: qual é o tipo, e se
    // o dono deixou algum filtro manual ligado por cima dele.
    return noRecorte === total
      ? 'Todas as campanhas de ' + rotulo
      : 'Campanhas selecionadas, dentro de ' + rotulo;
  }
  if (noRecorte === doBalde) return 'Todas as campanhas de ' + rotulo + ' (' + doBalde + ' de ' + total + ')';
  return noRecorte + ' de ' + doBalde + ' campanhas de ' + rotulo + ' selecionadas';
}

/**
 * As campanhas do balde que GASTARAM no período — é o que o clique no botão traz.
 *
 * Pedido do dono (10/09/2026): "quando clico nos botões é para trazer o filtro de
 * campanhas automático já, inclusive campanhas pausadas mas que tiveram gasto no
 * intervalo selecionado".
 *
 * ⚠️ PAUSADA COM GASTO ENTRA, e é o ponto do pedido. O que decide é ter gastado
 * NAQUELES DIAS, não o estado de hoje: campanha pausada ontem moveu dinheiro de
 * verdade nos dias anteriores, e deixá-la fora faria o investimento do período sair
 * menor do que foi. Por isso esta função NÃO olha `status`.
 *
 * ⚠️ E ATIVA SEM GASTO FICA DE FORA: ela só encheria a lista com nome que não move
 * número nenhum naquele intervalo.
 *
 * `linhasDeGasto` = uma linha por campanha por dia ({ campaign_id, spend }).
 * A ordem do balde é preservada — lista que se reordena a cada carga faz a pessoa
 * achar que o conteúdo mudou.
 */
export function idsComGastoNoPeriodo(idsDoBalde, linhasDeGasto) {
  const ids = Array.isArray(idsDoBalde) ? idsDoBalde.map(String) : [];
  const soma = {};
  for (const l of (Array.isArray(linhasDeGasto) ? linhasDeGasto : [])) {
    const id = String(l && l.campaign_id);
    const v = parseFloat(l && l.spend);
    if (Number.isFinite(v)) soma[id] = (soma[id] || 0) + v;
  }
  return ids.filter((id) => (soma[id] || 0) > 0);
}
