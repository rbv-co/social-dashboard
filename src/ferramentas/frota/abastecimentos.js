/* O ABASTECIMENTO — a regra, longe da tela.
 *
 * Desenho: docs/superpowers/specs/2026-09-21-frota-abastecimento-design.md
 * D39: número que não fecha AVISA; só o dedo errado barra. Um sistema que
 * recusa o registro do que aconteceu de verdade ensina a não registrar. */

/** O número que a pessoa confere contra o cupom, em reais. Nulo quando não dá
 *  para calcular — nunca zero, que seria um preço. */
export function precoPorLitro(totalCentavos, litros) {
  const t = Number(totalCentavos);
  const l = Number(litros);
  if (!Number.isFinite(t) || !Number.isFinite(l) || t <= 0 || l <= 0) return null;
  return t / 100 / l;
}

const PRECO_MIN = 1;    // R$/litro. Frouxo de propósito: pega o dedo errado,
const PRECO_MAX = 15;   // não a variação de posto pra posto.

export function problemasDoAbastecimento({
  km, kmConhecido, litros, totalCentavos, tanqueDepois,
  abastecidoEm, agoraIso, tanqueDoCarro,
} = {}) {
  const barra = [];
  const avisa = [];
  const n = (v) => {
    if (v === null || v === undefined) return null;
    const num = Number(v);
    if (Number.isFinite(num)) return num;
    return null;
  };

  const kmN = n(km);
  if (kmN === null || kmN <= 0) barra.push('Informe o KM que está no painel.');
  else if (n(kmConhecido) !== null && kmN < n(kmConhecido)) {
    barra.push(`O KM informado (${kmN.toLocaleString('pt-BR')}) é menor que o último `
      + `conhecido deste carro (${n(kmConhecido).toLocaleString('pt-BR')}). Confira o painel.`);
  }

  const litrosN = n(litros);
  if (litrosN === null || litrosN <= 0) barra.push('Informe quantos litros você colocou.');

  const totalN = n(totalCentavos);
  if (totalN === null || totalN <= 0) barra.push('Informe quanto você pagou.');

  const tanqueN = n(tanqueDepois);
  if (tanqueN === null || tanqueN < 0 || tanqueN > 4) {
    barra.push('Diga como ficou o tanque depois de abastecer.');
  }

  const quando = Date.parse(abastecidoEm);
  const agora = Date.parse(agoraIso || new Date().toISOString());
  if (Number.isFinite(quando) && Number.isFinite(agora) && quando > agora) {
    barra.push('A data do abastecimento está no futuro.');
  }

  // Avisos só fazem sentido quando os números existem.
  if (litrosN !== null && n(tanqueDoCarro) !== null && litrosN > n(tanqueDoCarro)) {
    avisa.push(`São ${litrosN.toLocaleString('pt-BR')} litros num tanque de `
      + `${n(tanqueDoCarro).toLocaleString('pt-BR')}. Confirme antes de gravar.`);
  }
  const preco = precoPorLitro(totalN, litrosN);
  if (preco !== null && (preco < PRECO_MIN || preco > PRECO_MAX)) {
    avisa.push(`Isso dá R$ ${preco.toFixed(2).replace('.', ',')} o litro. Confirme os dois números.`);
  }

  return { barra, avisa };
}
