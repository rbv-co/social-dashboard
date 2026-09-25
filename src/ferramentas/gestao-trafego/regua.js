// Filtro entre o banco e a conta. A tela NUNCA pode quebrar porque a linha da régua
// sumiu, veio pela metade ou com texto no lugar de número — aqui tudo vira número
// válido, caindo no padrão campo a campo. PURO: sem rede, sem tela.
import { PESOS_PADRAO, LIMIARES_PADRAO } from './ponderada.js';
import { ALVOS } from './alvos.js';

// Número positivo e finito; qualquer outra coisa devolve o padrão daquele campo.
function positivoOu(valor, padrao) {
  const n = Number(valor);
  return (Number.isFinite(n) && n > 0) ? n : padrao;
}

function completar(vindo, padrao) {
  const saida = {};
  for (const chave of Object.keys(padrao)) saida[chave] = positivoOu(vindo && vindo[chave], padrao[chave]);
  return saida;
}

// DOIS conjuntos de limiar, um por seção da régua (decisão do dono, 2026-07-28):
// `limiares` governa a Seção 1 (custo por ponto e por interação declarada);
// `limiares_resultado` governa a Seção 2 (custo por lead/conversa/venda/visita/
// mil impressões). A REGRA a lembrar: quem é DONO da meta é quem é DONO do
// limiar — cada seção tem sua própria meta (custo por ponto de um lado, custo
// por resultado do outro), então cada uma precisa poder "escalar forte" num
// multiplicador diferente (ex.: 0,8× pra engajamento, 0,9× pra vendas) sem que
// mexer numa mexa na outra. Os dois nascem com os MESMOS valores de fábrica
// (LIMIARES_PADRAO) porque é o mesmo ponto de partida — só divergem quando o
// dono ajustar um dos dois na tela.
// Só sobrevive número positivo e finito. Serve pras metas, onde um campo ausente
// tem que SUMIR do objeto (e não virar 0), porque "sem meta" e "meta zero" são
// coisas diferentes: a primeira não julga, a segunda dividiria por zero.
function metasValidas(vindo) {
  const metas = {};
  for (const [chave, valor] of Object.entries(vindo || {})) {
    const n = Number(valor);
    if (Number.isFinite(n) && n > 0) metas[chave] = n;
  }
  return metas;
}

export function normalizarRegua(linha) {
  const l = linha || {};
  // `metas_por_conta` é um mapa id-da-conta → metas daquela conta. Cada conta de
  // anúncios pratica um custo MUITO diferente: medido em 90 dias reais, o ponto
  // de engajamento custa R$ 0,013 na Vessel e R$ 0,372 na Breno Vale — 28× de
  // diferença. Com uma meta só pras cinco, o veredito parava de depender da
  // campanha ir bem e passava a depender de qual conta ela era: a Vessel ficava
  // verde mesmo piorando, a Breno Vale vermelha mesmo melhorando. A régua
  // carimbava em vez de julgar.
  const porConta = {};
  for (const [contaId, metasDaConta] of Object.entries(l.metas_por_conta || {})) {
    if (contaId) porConta[contaId] = metasValidas(metasDaConta);
  }
  return {
    pesos: completar(l.pesos, PESOS_PADRAO),
    limiares: completar(l.limiares, LIMIARES_PADRAO),
    limiares_resultado: completar(l.limiares_resultado, LIMIARES_PADRAO),
    // LEGADO: a meta única que valia pras cinco contas. Continua sendo lida e
    // guardada pra não perder o histórico, mas NÃO governa mais nenhum veredito
    // — quem governa é `metas_por_conta`, resolvido por `reguaDaConta`. Não
    // volte a usar este campo direto: ele é a meta de outra conta.
    metas: metasValidas(l.metas),
    metas_por_conta: porConta,
  };
}

// A régua COMO ELA VALE para uma conta: os pesos e os limiares são gerais (peso
// é quanto uma interação VALE, não quanto custa — isso não muda de cliente pra
// cliente), e as metas são as daquela conta.
//
// Conta sem metas salvas fica com `metas: {}` — em BRANCO, de propósito, sem
// herdar padrão nenhum (decisão do dono, 2026-07-29). É o caso da Mantova, que
// não tem histórico: sem meta o cálculo devolve 'sem-dados', e "não sei julgar"
// é uma resposta honesta. Herdar a meta de outra conta seria pior que o silêncio
// — julgaria a Mantova pelo preço que a Raíssa paga.
//
// Sem conta selecionada, mesma coisa: em branco. PURO.
export function reguaDaConta(regua, contaId) {
  const r = regua || {};
  const porConta = r.metas_por_conta || {};
  return {
    pesos: r.pesos,
    limiares: r.limiares,
    limiares_resultado: r.limiares_resultado,
    metas: (contaId && porConta[contaId]) ? porConta[contaId] : {},
    metas_por_conta: porConta,
  };
}

// Devolve o mapa INTEIRO com as metas de UMA conta trocadas. As outras contas
// passam intactas — sem isto, salvar a régua da Vessel apagaria as metas da
// Raíssa e da Breno Vale, que estão no mesmo campo do banco. PURO.
export function mesclarMetasDaConta(regua, contaId, metas) {
  const atual = (regua && regua.metas_por_conta) || {};
  if (!contaId) return { ...atual };
  return { ...atual, [contaId]: metasValidas(metas) };
}

// Meta do balde; sem meta salva PARA ESTE BALDE, devolve 0 — e 0 faz o cálculo
// devolver "sem-dados", que é melhor que inventar uma meta.
// NÃO existe mais reserva em 'padrao': desde a generalização de metas por
// objetivo (2026-07-28, ver alvos.js), cada balde tem sua PRÓPRIA unidade —
// R$ por ponto, R$ por lead, R$ por venda, R$ por visita, R$ por mil pessoas,
// R$ por conversa. Aplicar a meta de um balde a outro por "reserva" misturaria
// unidades diferentes como se fossem a mesma régua (I4 do review final,
// 2026-07-28). Se 'padrao' ainda aparecer salvo no banco (versão antiga ou
// restore), ele é ignorado de propósito aqui.
// SEMPRE devolve um número: texto é coercido, valores inválidos devolvem 0.
export function metaDoBalde(regua, balde) {
  const m = (regua && regua.metas) || {};
  // A CHAVE da meta nem sempre é o nome do balde: engajamento guarda a meta nova
  // (R$ por engajamento) em `engajamento_bruto`, para a antiga (R$ por ponto)
  // continuar existindo em `engajamento` sem ser sobrescrita — é o que permite
  // religar a ponderada sem ter perdido o número que o dono calibrou.
  const alvo = ALVOS[balde];
  const chave = (alvo && alvo.chaveMeta) || balde;
  if (m[chave] > 0) return Number(m[chave]);
  return 0;
}
