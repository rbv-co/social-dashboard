// A LINHA DE CONTATO DO CARD DE UMA PESSOA: e-mail · desde quando.
//
// POR QUE VIROU MÓDULO PRÓPRIO (13/08/2026): a regra morava dentro de
// `tela-de-admin.vue`, sem teste, e estava errada havia meses — o e-mail sumia
// de quem não tem cadastro de colaborador ligado. O dono achou olhando os
// cards das pessoas dos times de venda.
//
// A intenção sempre foi **não repetir o e-mail quando o nome exibido já É o
// e-mail** (o nome vem de `cadastro?.nome || profiles.name || profiles.email`,
// então para quem não tem nem cadastro nem nome, o "nome" do card é o e-mail).
// O que estava escrito era outra coisa: exigia cadastro ligado. As duas coisas
// só coincidem quando o perfil não tem `name` preenchido — e as duas pessoas
// dos times de venda têm nome e não têm cadastro. Resultado: o e-mail delas não
// aparecia em canto nenhum do card.
//
// PURO de propósito: é a linha que responde "quem é essa pessoa afinal?", e
// errar aqui não dá erro nenhum — só some informação, calado.

// As duas informações SEPARADAS, porque o card as põe em lugares diferentes
// desde o redesenho de 13/08: o e-mail é identidade e fica logo abaixo do nome;
// o "desde" é contexto e desce para a última linha, junto da lotação.
//
// `p` é a linha já montada por `loadAdminUsers`: { nome, email, bruto }.
// Cada campo volta como string vazia quando não há o que mostrar — o card
// simplesmente não desenha o elemento, em vez de desenhar um vazio.
export function partesDeContato(p) {
  const email = (p && p.email) || ''
  // O eco: o nome exibido é o próprio e-mail. Repetir seria ocupar uma linha
  // do card para dizer duas vezes a mesma coisa.
  const semEco = email && p.nome !== email ? email : ''
  let desde = ''
  const cru = p && p.bruto && p.bruto.created_at
  if (cru) {
    const d = new Date(cru)
    if (!isNaN(d)) desde = 'desde ' + d.toLocaleDateString('pt-BR')
  }
  return { email: semEco, desde }
}

// As duas juntas, para quem quiser a linha única (é o formato que a ficha usa).
export function linhaDeContato(p) {
  const { email, desde } = partesDeContato(p)
  return [email, desde].filter(Boolean).join(' · ')
}
