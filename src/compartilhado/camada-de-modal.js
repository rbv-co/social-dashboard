/* Quem abre por último fica na frente.
 *
 * O DEFEITO, relatado pelo dono em 12/08/2026: "quando clico em um botão dentro
 * do modal que abre, exemplo 'lançar manutenção', abre um outro modal ATRÁS
 * desse, tudo errado; isso acontece na config também de usuários quando clico no
 * botão permissões e pode estar ocorrendo em outros lugares."
 *
 * Estava ocorrendo mesmo. A causa: cada tela escolheu o número da camada
 * (`z-index`) na mão — 1000 no Gestão de Tráfego, 1100 na Análise, 1200 na
 * Frota, 1300 e 1400 em outros. Enquanto um modal abre sozinho, o número não
 * importa. Quando UM MODAL ABRE OUTRO, o de trás pode ter número maior e cobrir
 * o que acabou de abrir — e a pessoa clica no que vê, fechando o que ela nem
 * sabia que estava aberto.
 *
 * POR QUE NÚMERO FIXO NÃO RESOLVE, e eu tentei antes de escrever isto: pus o
 * lançamento de manutenção ABAIXO da ficha do veículo pra consertar um caso (o
 * editor de item aberto de dentro dele) e quebrei o caminho principal — o
 * lançamento aberto DA ficha do veículo passou a nascer atrás dela. Não existe
 * número fixo certo: a ordem depende de quem abriu quem, e isso só se sabe na
 * hora.
 *
 * A REGRA, então, é de tempo e não de lugar: cada modal pede a sua camada ao
 * abrir, e recebe uma acima de todas as que já estão abertas.
 *
 * Não trata de foco, de tecla Esc nem de travar a rolagem do fundo — a rolagem
 * já tem `v-trava-rolagem`, que é um contador pelo mesmo motivo (dois modais
 * abertos, um só destravar no fim). */

// Começa acima do maior número fixo que existe hoje no aplicativo (1401, no
// Gestão de Tráfego), pra um modal novo nunca nascer atrás de um antigo que
// ainda não migrou. Abaixo dos 9997+ dos avisos globais, que devem cobrir tudo.
export const CAMADA_BASE = 2000;
const PASSO = 10;

let topo = CAMADA_BASE;

/** A próxima camada livre, acima de tudo que está aberto agora. */
export function abrirCamada() {
  topo += PASSO;
  return topo;
}

/**
 * Devolve a camada ao fechar o modal.
 *
 * Só rebaixa o topo quando quem fecha é O ÚLTIMO que abriu — fechar um modal do
 * meio da pilha não pode puxar quem está acima dele pra baixo. Fora esse caso,
 * o número simplesmente para de ser usado; o topo volta ao chão quando o último
 * fechar.
 */
export function fecharCamada(camada) {
  if (camada === topo) topo = Math.max(CAMADA_BASE, topo - PASSO);
}

/** Só pros testes: devolve o balcão ao estado inicial. */
export function reiniciarCamadas() { topo = CAMADA_BASE; }

/** Quanto está aberto agora, em camadas. Serve pra teste e pra depurar. */
export function camadaAtual() { return topo; }
