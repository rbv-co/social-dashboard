/* Ponte entre um bem do Patrimônio e um veículo novo da Frota (F9).
 *
 * Separada da tela por ser regra pura, testável sem montar componente — é
 * exatamente o tipo de conta (que bem entra no seletor, o que herda pra
 * dentro do formulário) que costuma esconder bug até alguém repetir um bem já
 * usado. */

/**
 * Os bens da categoria Veículos que AINDA NÃO têm nenhum carro da frota
 * apontando pra eles — os únicos que fazem sentido virar um carro novo.
 * Oferecer um bem que já está ligado duplicaria o carro: o mesmo veículo em
 * duas linhas, uma pela Frota de sempre e outra criada por cima do bem que já
 * tinha dono.
 */
export function bensLivresParaFrota(bens, veiculos, categoriaVeiculoId) {
  if (!categoriaVeiculoId) return [];
  const usados = new Set((veiculos || []).map((v) => v.bem_id).filter(Boolean));
  return (bens || []).filter((b) => b.categoria_id === categoriaVeiculoId && !usados.has(b.id));
}

/**
 * O que herdar do bem escolhido pra dentro da ficha do carro novo. Só o que o
 * bem realmente guarda — patrimonio_bens não tem placa, chassi nem Renavam,
 * esses continuam por conta de quem cadastra. Cada campo só entra se a ficha
 * ainda estiver vazia nele: o bem SUGERE, nunca apaga o que a pessoa já tinha
 * digitado antes de escolher.
 *
 * NÃO sugere `codigo_patrimonial`, e isso é conserto de 20/08/2026: até então
 * ele virava seis dígitos ("000042"), formato que não batia com os "RBB-00X"
 * dos carros antigos, nem com o número puro que os novos usam, nem com
 * nenhuma tela. O nº de patrimônio tem campo próprio agora — ver
 * etiqueta-do-veiculo.js.
 */
export function patchDoBem(vForm, bem) {
  const patch = {};
  if (!vForm.nome && bem.nome) patch.nome = bem.nome;
  if (!vForm.marca && bem.marca) patch.marca = bem.marca;
  if (!vForm.fipe && bem.valor_centavos != null) patch.fipe = (bem.valor_centavos / 100).toString();
  return patch;
}
