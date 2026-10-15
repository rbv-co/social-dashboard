/* Travar a rolagem do fundo enquanto um modal está aberto.
 *
 * O problema, relatado pelo dono: "abro um modal e a tela atrás continua
 * rolando ainda... a gente tá nível multinacional já, não dá pra ter esses
 * erros". Medido: NENHUMA das 9 telas com modal desta central travava o
 * fundo — o defeito é da central inteira, não de uma tela.
 *
 * QUATRO decisões, cada uma por um motivo medido (não estético):
 *
 *  1. CONTADOR, não booleano. Nesta central um modal abre outro por cima
 *     (ex.: confirmar exclusão em cima da ficha aberta). Um booleano
 *     destravaria no fechar do PRIMEIRO, com o segundo ainda na tela. O
 *     contador só destrava quando chega a zero — ver `contarAbertura` /
 *     `contarFechamento`.
 *
 *  2. COMPENSA A LARGURA DA BARRA DE ROLAGEM (`larguraDaBarra`). Esconder a
 *     barra (overflow:hidden) tira a largura que ela ocupava e o conteúdo
 *     "pula" pro lado — um defeito pior que o original, porque agora é
 *     visível mesmo sem interação nenhuma. Mede ANTES de travar e vira
 *     padding-right, então a largura visível do conteúdo não muda.
 *
 *  3. `body{position:fixed}`, não só `overflow:hidden`. No iOS Safari,
 *     overflow:hidden no body NÃO impede o "rubber-band scroll" por trás de
 *     elementos fixos — o fundo continua respondendo ao dedo por dentro do
 *     modal, a manha específica do iOS que o dono pediu pra resolver.
 *     Fixar a posição do body de verdade — e devolver a posição de rolagem
 *     ao destravar, senão a página "salta" pro topo — é o que resolve no
 *     iPhone. No desktop isso não atrapalha em nada (overflow:hidden já
 *     bastaria lá).
 *
 *  4. `documento`/`janela` como PARÂMETRO nas funções de DOM, com valor
 *     padrão pegando o `document`/`window` de verdade. Não porque o app
 *     tenha mais de um documento — é o que permite testar a decisão inteira
 *     sem abrir navegador nenhum, com objetos falsos no lugar do DOM (mesmo
 *     padrão de `versao-do-app.js`, que testa comparação de pacote sem
 *     precisar de rede).
 *
 * O CONTADOR é módulo-singleton DE PROPÓSITO: modal do JavaScript legado
 * (innerHTML/classList, herança do monólito) e modal do Vue (`v-if`) de
 * telas diferentes precisam compartilhar o MESMO contador — senão o fundo
 * destrava com um dos dois ainda aberto na tela.
 *
 * O item "destravar sempre, mesmo se o componente for destruído com o modal
 * aberto" (a pessoa navega pra outra ferramenta pelo menu) não é resolvido
 * aqui: é `vTravaRolagem` (diretiva, telas com `v-if`) e `usarTravaDeModais`
 * (telas legadas sem `v-if`) que garantem isso, mais abaixo. */

let contador = 0;
let scrollGuardado = 0;

/** Abrir soma 1. */
export function contarAbertura(atual) {
  return (atual || 0) + 1;
}

/**
 * Fechar subtrai 1, sem nunca ir a negativo. Um "fechar" a mais do que os
 * "abrir" (imbalanço em algum outro lugar do código) não pode deixar o
 * contador negativo — isso faria o PRÓXIMO abrir real precisar de dois
 * fechamentos pra destravar, um bug silencioso e pior que o atual.
 */
export function contarFechamento(atual) {
  return Math.max(0, (atual || 0) - 1);
}

/**
 * Quanto a barra de rolagem ocupa, em pixels. Em celular (barra sobreposta,
 * sem espaço próprio no layout) a conta dá 0 — e como o padding-right só é
 * aplicado quando há barra pra compensar, no celular nada se mexe: sem
 * salto pra compensar, sem compensação nenhuma.
 */
export function larguraDaBarra(janela, documento) {
  if (!janela || !documento || !documento.documentElement) return 0;
  const largura = (janela.innerWidth || 0) - (documento.documentElement.clientWidth || 0);
  return largura > 0 ? largura : 0;
}

/** Trava o fundo. Só é pra ser chamado na transição 0→1 (ver `abrirModal`). */
export function travar(documento, janela) {
  if (!documento || !documento.body || !documento.documentElement) return;
  scrollGuardado = (janela && (janela.scrollY ?? janela.pageYOffset)) || 0;
  const barra = larguraDaBarra(janela, documento);
  const raiz = documento.documentElement.style;
  const corpo = documento.body.style;
  raiz.overflow = 'hidden';
  documento.body.setAttribute?.('data-modal-aberto', ''); // o CSS esconde o botão flutuante de ajustes (moldura-do-aplicativo.vue)
  if (barra > 0) raiz.paddingRight = `${barra}px`; // item 2: compensa o salto
  // position:fixed no body — item 3, o que resolve o rubber-band do iOS.
  corpo.position = 'fixed';
  corpo.top = `-${scrollGuardado}px`;
  corpo.left = '0';
  corpo.right = '0';
  corpo.width = '100%';
}

/** Destrava o fundo e devolve a posição de rolagem. Só na transição 1→0. */
export function destravar(documento, janela) {
  if (!documento || !documento.body || !documento.documentElement) return;
  const raiz = documento.documentElement.style;
  const corpo = documento.body.style;
  raiz.overflow = '';
  documento.body.removeAttribute?.('data-modal-aberto');
  raiz.paddingRight = '';
  corpo.position = '';
  corpo.top = '';
  corpo.left = '';
  corpo.right = '';
  corpo.width = '';
  // Sem isso a página "voltaria" pro topo: o body ficou fixo lá embaixo
  // enquanto travado, e só o scrollTo devolve a posição de antes.
  if (janela && typeof janela.scrollTo === 'function') janela.scrollTo(0, scrollGuardado);
}

function documentoReal() {
  return typeof document !== 'undefined' ? document : null;
}
function janelaReal() {
  return typeof window !== 'undefined' ? window : null;
}

/**
 * Um modal a mais abriu. Chama de qualquer lugar — Vue reativo (via
 * `vTravaRolagem`) ou JavaScript legado (innerHTML/classList) — sem se
 * preocupar se É o primeiro: o contador decide sozinho quando travar de
 * verdade (item 1).
 */
export function abrirModal(documento = documentoReal(), janela = janelaReal()) {
  contador = contarAbertura(contador);
  if (contador === 1) travar(documento, janela);
}

/** Um modal fechou. Só destrava quando o último também fechar. */
export function fecharModal(documento = documentoReal(), janela = janelaReal()) {
  contador = contarFechamento(contador);
  if (contador === 0) destravar(documento, janela);
}

/** Quantos modais o contador acha que estão abertos agora — depuração/teste. */
export function modaisAbertos() {
  return contador;
}

/** Reinicia o contador. Só para os testes começarem cada caso do zero. */
export function _reiniciarParaTeste() {
  contador = 0;
  scrollGuardado = 0;
}

/* ── Uso no Vue ───────────────────────────────────────────────────────────
 *
 * As telas desta central abrem modal de duas formas bem diferentes (ver
 * investigação no relatório): a maioria usa `v-if` num `ref` (objeto ou
 * booleano); as telas herdadas do monólito (Acessos, Admin, Redes Sociais,
 * Gestão Comercial) montam e escondem o modal com JavaScript puro
 * (innerHTML, classList, style.display) — sem `ref` nenhum por trás. As duas
 * formas abaixo cobrem cada caso; a tela usa UMA das duas, nunca as duas. */

/**
 * Para modal em `v-if`: `<div v-if="veiculoAberto" v-trava-rolagem>`.
 *
 * Cobre sozinho o "destravar sempre" (item 4 do pedido): quando o
 * COMPONENTE inteiro é destruído com o modal ainda aberto — a pessoa navega
 * pra outra ferramenta pelo menu — o Vue desmonta o elemento por baixo dos
 * panos e o `unmounted` abaixo dispara do mesmo jeito que dispararia num
 * fechar comum. Sem isso a rolagem ficaria travada PRA SEMPRE, o pior
 * desfecho possível — pior que nunca ter travado.
 */
export const vTravaRolagem = {
  mounted(el) {
    el.__travaRolagemAberta = true;
    abrirModal();
  },
  unmounted(el) {
    if (el.__travaRolagemAberta) {
      el.__travaRolagemAberta = false;
      fecharModal();
    }
  },
};

// Só nos telas legadas (sem `ref`) o `onUnmounted` do Vue é necessário: por
// isso o import fica isolado aqui, e não no topo do módulo — o resto do
// arquivo é JavaScript puro, testável sem o runtime do Vue carregado.
import { onUnmounted } from 'vue';

/**
 * Para modal SEM `v-if` — as telas legadas que mostram/escondem um `<div>`
 * sempre presente no template via `classList`/`style.display` puro.
 *
 *   const trava = usarTravaDeModais()
 *   function abrirFicha() { ...; trava.abrir() }
 *   function fecharFicha() { ...; trava.fechar() }
 *
 * `abrir()`/`fechar()` chamam o contador global de cima. O `onUnmounted` é
 * a MESMA rede de segurança do item 4, só que manual: sem `v-if` o Vue não
 * desmonta o elemento do modal sozinho ao trocar de tela — nada avisaria o
 * contador —, então esta função guarda quantos ESTA tela abriu e sobrou sem
 * fechar, e força o fechamento de cada um ao ser destruída.
 */
export function usarTravaDeModais() {
  let abertosAqui = 0;
  function abrir() {
    abertosAqui += 1;
    abrirModal();
  }
  function fechar() {
    if (abertosAqui === 0) return;
    abertosAqui -= 1;
    fecharModal();
  }
  onUnmounted(() => {
    while (abertosAqui > 0) fechar();
  });
  return { abrir, fechar };
}
