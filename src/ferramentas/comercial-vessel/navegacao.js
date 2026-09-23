/* ONDE CADA TELA MORA — o "voltar" página a página.
 *
 * Pedido do dono em 19/09/2026: "umas voltam direto pra central, outras voltam
 * pras ferramentas do comercial, sendo que é pra voltar página a página".
 *
 * ⚠️ É O PAI, NÃO O HISTÓRICO. Quem abre por link salvo cai direto na tela sem
 * passar pelo menu. Voltar ao lugar onde a tela MORA é o certo; voltar ao
 * histórico levaria a pessoa a uma Central que ela nunca viu nesta sessão.
 *
 * ⚠️ NENHUM ENDEREÇO MUDA. Isto é só para onde o botão aponta.
 */
export const PAI_DA_TELA = {
  'atendimentos': 'comercial-vessel',
  'beauty-sessions': 'comercial-vessel',
  'private-edit': 'comercial-vessel',
  'stylist-circle': 'comercial-vessel',
  'material-grafico': 'comercial-vessel',
  'funil-carrinho': 'comercial-vessel',
  'comercial-vessel': 'inicio',
}

export const ROTULO_DO_PAI = {
  'comercial-vessel': 'Comercial Vessel',
  'inicio': 'Central',
}

// Tela fora do mapa volta para a Central: é o fundo do poço, sempre existe.
export function paiDaTela(nome) {
  return PAI_DA_TELA[nome] || 'inicio'
}
