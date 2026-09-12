/* Duas áreas dentro da Frota: Motorista e Gestão.
 *
 * Quem dirige e quem administra querem coisas diferentes. O motorista está de
 * pé no estacionamento resolvendo uma coisa só — cada dado a mais na tela é um
 * obstáculo. Quem administra quer a frota inteira, com valor e contrato.
 *
 * A separação é de ATENÇÃO, não de sigilo: um motorista que precise do Renavam
 * pra uma ocorrência pede a quem administra. O que a área Motorista faz é não
 * empurrar isso na cara de quem só quer pegar o carro e sair. */

export const AREAS = [
  { chave: 'motorista', rotulo: 'Motorista' },
  { chave: 'gestao', rotulo: 'Gestão' },
  { chave: 'revisoes', rotulo: 'Revisões' },
  { chave: 'plano', rotulo: 'Plano' },
  { chave: 'relatorios', rotulo: 'Relatórios' },
];

/**
 * Quais áreas esta pessoa vê.
 * Todo mundo com acesso vê Motorista. Gestão só para quem pode cadastrar ou
 * excluir veículo — quem tem apenas 'ver' e 'editar' dirige, não administra.
 *
 * `podeRelatorios` vem SEPARADO de propósito: Relatórios tem chave de permissão
 * própria (`frota.relatorios`), porque quem cadastra veículo não é
 * necessariamente quem pode tirar a frota inteira em planilha. Ele também não
 * é atalho: sem ser da Gestão, a aba não aparece nem com a permissão — ela
 * mostra a frota toda, com contrato e valor.
 */
export function areasVisiveis(pode, podeRelatorios = false) {
  const p = typeof pode === 'function' ? pode : () => false;
  const areas = ['motorista'];
  // Revisões e Plano andam junto com Gestão: quem cadastra veículo é quem
  // decide de quantos em quantos quilômetros cada item se troca, e é o mesmo
  // gestor que mantém a lista do checklist e os dias em que ele cai — o
  // checklist mora dentro da aba Plano (D10), não numa aba própria.
  if (p('criar') || p('excluir')) {
    areas.push('gestao', 'revisoes', 'plano');
    if (podeRelatorios) areas.push('relatorios');
  }
  return areas;
}

/** A área que abre por padrão: Gestão para quem administra, senão Motorista. */
export function areaInicial(pode) {
  const vis = areasVisiveis(pode);
  return vis.includes('gestao') ? 'gestao' : 'motorista';
}

/**
 * O que a área Motorista mostra, para uma pessoa.
 *
 * `comigo` vem primeiro porque é o que ela provavelmente veio fazer: devolver.
 * `livres` são os que ela pode pegar. `comOutros` existe só para ela não achar
 * que o carro sumiu — sem botão, e sem os dados de quem administra.
 */
export function painelDoMotorista(estados, pessoaId) {
  const lista = estados || [];
  const meu = (e) => !!(pessoaId && e.usoAbertoPessoaId && e.usoAbertoPessoaId === pessoaId);
  return {
    comigo: lista.filter((e) => e.naRua && meu(e)),
    // `disponivelParaMim`, e não `disponivel`: o carro que ESTA pessoa reservou
    // continua na lista dela, senão a reserva aprovada esconde o carro de quem
    // tem direito a ele justamente na hora de pegar (20/08/2026).
    livres: lista.filter((e) => e.disponivelParaMim),
    comOutros: lista.filter((e) => e.naRua && !meu(e)),
    // Carro na oficina ou fora da frota não aparece pro motorista: não há nada
    // que ele possa fazer, e ocupa a tela.
  };
}

/** Quantos carros a pessoa consegue pegar agora — a resposta que ela veio buscar. */
export function resumoDoMotorista(painel) {
  const p = painel || {};
  const comigo = (p.comigo || []).length;
  const livres = (p.livres || []).length;
  if (comigo) {
    return comigo === 1
      ? `Você está com ${p.comigo[0].veiculo.nome}.`
      : `Você está com ${comigo} veículos.`;
  }
  if (!livres) return 'Nenhum carro livre agora.';
  return livres === 1 ? '1 carro livre.' : `${livres} carros livres.`;
}
