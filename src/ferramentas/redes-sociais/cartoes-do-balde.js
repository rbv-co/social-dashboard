// QUAIS indicadores cada balde mostra.
//
// A régua é a mesma da Gestão de Tráfego: "custo por resultado, MENOR é melhor",
// cada balde na SUA unidade. Comparar entre unidades é sem sentido, por isso cada
// cartão carrega a sua.
//
// TODOS não repete os cartões de hoje de propósito (decisão do dono, 17/08/2026):
// custo por seguidor calculado sobre TODO o dinheiro é sempre meio mentira, porque
// o denominador só vale para uma parte dele — é a distorção da Motoeasy, onde 98%
// do dinheiro é de cadastro. No lugar entram quatro indicadores que valem para
// QUALQUER campanha.
// PURO: sem rede, sem tela.
//
// TODO CUSTO DESTE ARQUIVO DIVIDE `numeros.investimento`, e a tela manda para cá
// exatamente o valor que o cartão de investimento está mostrando. Custo que não
// divide o número impresso logo acima dele é custo que ninguém consegue conferir.
import { CRITERIOS } from '../gestao-trafego/saude.js';

// Sem denominador → "—", nunca 0. E sem NUMERADOR também: um recorte sem campanha
// chega aqui com investimento nulo, e "R$ 0,00 por conversa" seria a mesma mentira
// que já ficou 17 horas no ar neste projeto.
const div = (a, b) => (a > 0 && b > 0) ? (a / b) : null;
const qtd = v => (v == null ? null : v);                   // "não sei" ≠ "zero"

// As faixas da frequência são AS MESMAS da saúde da Gestão de Tráfego: 4 é onde
// ela manda reduzir verba, 3,5 é onde ela manda monitorar. Importadas, não
// copiadas — dois juízes discordando sobre a mesma campanha é defeito, e um número
// copiado à mão é um juiz novo esperando para divergir.
//
// É conhecimento do negócio, não preferência de conta: por isso a frequência não
// tem meta editável. Sem número não se acende semáforo nenhum — cinza é "não sei".
const semaforoFrequencia = v => (v == null ? null
  : (v >= CRITERIOS.freqSatura ? 'ruim' : v >= CRITERIOS.freqAtencao ? 'atencao' : 'bom'));

// QUANDO O CARTÃO PODE RECEBER NOTA (barra, porcentagem, borda colorida).
//
// Só com ALVO DE VERDADE. Meta 0 é meta que ninguém pôs, e pintar de vermelho
// contra ela é um veredito sem prova nenhuma atrás. Este app já pagou por isso:
// um alvo chutado igual para cinco contas fazia o semáforo responder "de quem é
// essa conta?" em vez de "essa campanha vai bem?" — 8 de 19 campanhas trocaram de
// cor quando os alvos viraram números medidos.
//
// Cartão sem alvo não é cartão quebrado: mostra o número e a comparação com o
// período anterior, e cala a nota até o dono digitar a meta dele.
export function podeDarVeredito(cartao, meta) {
  if (!cartao || !cartao.metaKey) return false;
  if (!(cartao.valor > 0)) return false;                   // "—" e zero não recebem nota
  return typeof meta === 'number' && isFinite(meta) && meta > 0;
}

const investimento = n => ({
  id: 'investimento', rotulo: 'INVESTIMENTO NO PERÍODO', valor: qtd(n.investimento),
  formato: 'dinheiro', metaKey: 'spend', semaforo: null,
  explicacao: 'Quanto foi gasto nas campanhas deste tipo, no período.',
});

// O texto do alcance e o da frequência param ANTES de dizer de onde o número veio:
// só a tela sabe se ele é o total deduplicado da conta ou a soma campanha a
// campanha (que conta a mesma pessoa mais de uma vez). Quem sabe é quem afirma —
// ver o `_alcanceRepete` da tela-de-redes-sociais.vue.
const RECEITAS = {
  todos: n => [
    investimento(n),
    { id: 'cpm', rotulo: 'CUSTO POR MIL IMPRESSÕES', valor: div(n.investimento, n.impressoes / 1000), formato: 'dinheiro', metaKey: 'cpm', semaforo: null,
      explicacao: 'O preço do espaço. Vale para qualquer tipo de campanha. Impressão é cada vez que o anúncio apareceu — a mesma pessoa pode ver várias.' },
    { id: 'alcance', rotulo: 'ALCANCE', valor: qtd(n.alcance), formato: 'inteiro', metaKey: null, semaforo: null,
      explicacao: 'Quantas pessoas viram o anúncio no período.' },
    { id: 'frequencia', rotulo: 'FREQUÊNCIA', valor: qtd(n.frequencia), formato: 'decimal', metaKey: null, semaforo: semaforoFrequencia,
      explicacao: 'Quantas vezes cada pessoa viu o anúncio. Acima de 4, a mesma gente está vendo demais.' },
  ],
  // DOIS cartões, por decisão do dono (10/09/2026): "no balde seguidores você deixa
  // somente o card de investimento (padrão) e custo por seguidores". Custo por
  // interação e custo por curtida mudaram para o balde de Engajamento, que é onde
  // esse dinheiro passou a morar — mantê-los aqui seria dividir o investimento de
  // seguidor por um resultado que a campanha de seguidor não compra.
  seguidores: n => [
    investimento(n),
    { id: 'cps', rotulo: 'CUSTO POR SEGUIDOR', valor: div(n.investimento, n.seguidores), formato: 'dinheiro', metaKey: 'cps', semaforo: null,
      explicacao: 'Investimento ÷ novos seguidores do período.' },
  ],
  // ⚠️ BALDE NOVO (10/09/2026). Estas campanhas moravam em Seguidores e eram 21%
  // do dinheiro de lá — R$ 9.405,86 na janela de 30 dias medida antes da mudança.
  // O dono: "as campanhas de engajamento são outro objetivo, diferente de
  // seguidores". Curtir um post não é seguir o perfil.
  //
  // As metas deste balde NASCEM VAZIAS, e é o certo: `chaveDeMeta` põe o balde na
  // frente ('engajamento.cpi'), e não havia nenhuma meta de cpi/cpl gravada no
  // banco para herdar — conferido, as 45 linhas de social_metas são cps, spend,
  // followers e interactions.
  engajamento: n => [
    investimento(n),
    { id: 'cpi', rotulo: 'CUSTO POR INTERAÇÃO', valor: div(n.investimento, n.interacoes), formato: 'dinheiro', metaKey: 'cpi', semaforo: null,
      explicacao: 'Investimento ÷ interações do anúncio (curtidas, comentários, salvamentos, compartilhamentos).' },
    { id: 'cpl', rotulo: 'CUSTO POR CURTIDA', valor: div(n.investimento, n.curtidas), formato: 'dinheiro', metaKey: 'cpl', semaforo: null,
      explicacao: 'Investimento ÷ curtidas do anúncio.' },
    { id: 'interacoes', rotulo: 'INTERAÇÕES', valor: qtd(n.interacoes), formato: 'inteiro', metaKey: null, semaforo: null,
      explicacao: 'Quantas interações o anúncio teve no período.' },
  ],
  contatos: n => [
    investimento(n),
    { id: 'custo_conversa', rotulo: 'CUSTO POR CONVERSA', valor: div(n.investimento, n.conversas), formato: 'dinheiro', metaKey: 'custo_conversa', semaforo: null,
      explicacao: 'Cada conversa aberta no WhatsApp ou no Direct. É o resultado que essa campanha compra.' },
    { id: 'conversas', rotulo: 'CONVERSAS INICIADAS', valor: qtd(n.conversas), formato: 'inteiro', metaKey: null, semaforo: null,
      explicacao: 'Quantas conversas começaram no período.' },
    { id: 'custo_cadastro', rotulo: 'CUSTO POR CADASTRO', valor: div(n.investimento, n.cadastros), formato: 'dinheiro', metaKey: 'custo_cadastro', semaforo: null,
      explicacao: 'Quanto custou cada ficha preenchida. Campanha que só abre conversa não tem cadastro — aparece "—".' },
  ],
  site: n => [
    investimento(n),
    { id: 'custo_visita', rotulo: 'CUSTO POR VISITA', valor: div(n.investimento, n.visitas), formato: 'dinheiro', metaKey: 'custo_visita', semaforo: null,
      explicacao: 'Quem realmente chegou no destino. Clique não é visita: parte das pessoas sai antes de a página abrir.' },
    { id: 'visitas', rotulo: 'VISITAS', valor: qtd(n.visitas), formato: 'inteiro', metaKey: null, semaforo: null,
      explicacao: 'Quantas pessoas chegaram no destino.' },
    { id: 'cpm', rotulo: 'CUSTO POR MIL IMPRESSÕES', valor: div(n.investimento, n.impressoes / 1000), formato: 'dinheiro', metaKey: 'cpm', semaforo: null,
      explicacao: 'O preço do espaço nas campanhas deste tipo.' },
  ],
  // TRÊS cartões de propósito: não há quarto indicador honesto para venda.
  // Inventar um só para preencher o vão seria fingir informação.
  vendas: n => [
    investimento(n),
    { id: 'custo_venda', rotulo: 'CUSTO POR VENDA', valor: div(n.investimento, n.compras), formato: 'dinheiro', metaKey: 'custo_venda', semaforo: null,
      explicacao: 'Quanto custa trazer uma venda. Usamos custo por venda (e não ROAS) para a régua ser uma só.' },
    { id: 'compras', rotulo: 'VENDAS', valor: qtd(n.compras), formato: 'inteiro', metaKey: null, semaforo: null,
      explicacao: 'Quantas compras a Meta registrou no período.' },
  ],
};

// A CHAVE gravada em social_metas.indicador (e no localStorage) para o par
// indicador+balde. A meta pertence ao recorte em que foi digitada: o mesmo "custo
// por mil impressões" vale coisas diferentes em Todos e em Site, e uma chave só
// para os dois faria a meta de um virar veredito sobre o outro.
//
// As linhas que JÁ EXISTEM no banco continuam valendo, sem prefixo, no balde
// contra o qual foram definidas — é migração de LEITURA, sem tocar no banco e sem
// abandonar meta de ninguém:
//   • cps, cpi, cpl → foram digitadas nos cartões que hoje moram em SEGUIDORES;
//   • spend        → foi digitada contra o investimento da conta inteira, que é o
//                    que TODOS mostra.
// O BUDGET dos outros baldes é próprio (`seguidores.spend`, `contatos.spend`…) e
// nasce sem valor: comparar a meta da conta inteira com o dinheiro de um recorte
// diria "8% do budget" no dia em que o dono gastou exatamente o que queria ali.
// ⚠️ `cpi`/`cpl` SAÍRAM DAQUI em 10/09/2026, junto com os cartões: eles moram no
// balde de Engajamento agora, e a chave deles é 'engajamento.cpi'/'engajamento.cpl'.
// Nada foi abandonado — não existia nenhuma meta de cpi/cpl gravada no banco.
const HERDADAS = { seguidores: ['cps'], todos: ['spend'] };

export function chaveDeMeta(cartaoId, balde) {
  if ((HERDADAS[balde] || []).includes(cartaoId)) return cartaoId;
  return balde + '.' + cartaoId;
}

// METAS QUE SÃO TAXA (custo por resultado): valem o MESMO em 1, 7, 14 ou 30 dias.
// Só as de VOLUME (budget, seguidores, curtidas…) é que a tela recalcula
// proporcional ao tamanho do período, ao copiar a meta digitada para os outros.
//
// Isto não é um alvo, é o FORMATO do indicador: no dia em que o dono digitar
// R$ 12 por conversa em 7D, os R$ 12 valem também em 30D — não viram R$ 51.
const METAS_DE_TAXA = ['cps', 'cpi', 'cpl', 'cpm', 'custo_conversa', 'custo_cadastro', 'custo_venda', 'custo_visita'];

// A chave chega com o balde na frente ('contatos.custo_conversa', ver
// chaveDeMeta). Quem diz se ela é taxa ou volume é o INDICADOR, nunca o balde:
// sem tirar o prefixo, NENHUMA meta de balde seria reconhecida como taxa e a
// primeira meta de custo digitada num balde novo sairia multiplicada nos outros
// períodos. Número gravado errado, não erro de tela — e o dono só descobriria
// olhando a barra de progresso mentir num período que ele nem editou.
export function ehMetaDeTaxa(chave) {
  const s = String(chave);
  const i = s.lastIndexOf('.');
  return METAS_DE_TAXA.includes(i >= 0 ? s.slice(i + 1) : s);
}

export function cartoesDoBalde(balde, numeros) {
  const receita = RECEITAS[balde] || RECEITAS.todos;
  return receita(numeros || {});
}
