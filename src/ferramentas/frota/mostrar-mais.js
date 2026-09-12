/* O "ver mais" das listas longas da Frota.
 *
 * POR QUE ISTO EXISTE COMO REGRA, e não como um `if` solto na tela: o botão só
 * pode aparecer quando há mesmo o que mostrar. Medido em 21/08/2026, a base
 * inteira tinha 6 checklists, 3 reservas e 1 retirada — um "ampliar para 50"
 * fixo nasceria como botão morto, e controle que não faz nada ensina a ignorar
 * controle.
 *
 * Os degraus são do dono: 10, 20, 50 e então tudo. */
export const DEGRAUS = [10, 20, 50];

/** O primeiro degrau — quanto a lista mostra antes de alguém pedir mais. */
export const PRIMEIRO_DEGRAU = DEGRAUS[0];

/** Ainda há linha escondida? É o que decide se o botão aparece. */
export function temMais(total, limite) {
  return Number.isFinite(total) && Number.isFinite(limite) && total > limite;
}

/**
 * O próximo degrau depois deste. Passa por 10 → 20 → 50 e termina em TUDO
 * (`Infinity`), nunca num degrau maior que a lista: pular de 10 pra 50 numa
 * lista de 12 mostraria "ver mais 50" pra revelar duas linhas.
 */
export function proximoLimite(limite, total) {
  const maior = DEGRAUS.find((d) => d > limite && d < total);
  return maior ?? Infinity;
}

/** O que o botão diz. Ele promete o número certo, nunca "mais 50" pra mostrar 2. */
export function rotuloDeVerMais(limite, total) {
  const proximo = proximoLimite(limite, total);
  const quantas = (proximo === Infinity ? total : proximo) - limite;
  if (quantas <= 0) return null;
  return proximo === Infinity && total - limite > 0
    ? (total - limite === 1 ? 'Ver a última' : `Ver as ${total - limite} restantes`)
    : `Ver mais ${quantas}`;
}
