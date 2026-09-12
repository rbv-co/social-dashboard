/* O que cada aba oferece, dito em botão grande — e o ESTADO embaixo do nome.
 *
 * De onde veio: quem usa esta ferramenta é um policial aposentado com
 * dificuldade de uso, e o pedido dele foi por um lugar óbvio pra começar, em
 * vez de rolar a tela procurando. O estado embaixo é o que separa um menu de
 * uma orientação: "Preciso usar um carro" é um menu; "Preciso usar um carro /
 * 3 carros livres" já respondeu a pergunta antes de a pessoa clicar.
 *
 * REGRA QUE MANDA AQUI: `estado` é `null` quando não se SABE, e a tela não
 * escreve linha nenhuma nesse caso. Escrever "0" ou "—" sobre um dado que não
 * carregou é a tela mentindo — e é o defeito que a Fase A inteira existiu pra
 * consertar. */

/** Nomes de carro como o banco guarda (tudo maiúscula). Tira a marca da frente
 * quando há 3+ palavras. Case-fold quebra um subconjunto diferente a cada nova
 * compra de carro (Xc60, depois Bmw, depois a marca sumia inteira). Não há regra
 * que case-fold que sobrevive — deixa como vem da base. O dono reconhece VOLVO
 * XC60 de pé no estacionamento, reconhece XC60 só na tela da TV (paredão). */
function nomeCurto(nome) {
  const limpo = String(nome || '').trim()
  if (!limpo) return null
  // Tira a marca da frente quando há 3+ palavras, ponto. Não toca em maiúscula/minúscula.
  const partes = limpo.split(/\s+/)
  const semMarca = partes.length > 2 ? partes.slice(1) : partes
  return semMarca.join(' ')
}

const contar = (n, um, muitos) => `${n} ${n === 1 ? um : muitos}`

/**
 * Os botões da aba Motorista.
 * `checklistDeHoje`: 'feito' | 'falta' | null (null = não sei / não tem carro).
 */
export function botoesDoMotorista({ painel, checklistDeHoje, nomeDoMeuCarro } = {}) {
  const p = painel || {}
  const livres = (p.livres || []).length
  const carro = nomeCurto(nomeDoMeuCarro)

  let estadoChecklist = null
  if (!carro) estadoChecklist = 'você não tem carro fixo'
  else if (checklistDeHoje === 'feito') estadoChecklist = `${carro} · feito hoje`
  else if (checklistDeHoje === 'falta') estadoChecklist = `${carro} · falta hoje`

  return [
    {
      chave: 'meu-checklist',
      rotulo: 'Fazer meu checklist',
      estado: estadoChecklist,
      acao: 'meu-checklist',
    },
    {
      chave: 'preciso-carro',
      rotulo: 'Preciso usar um carro',
      // Zero livres NÃO some o botão: sumir faria a pessoa achar que perdeu a
      // função. Ele fica e diz por que não adianta clicar.
      estado: livres ? contar(livres, 'carro livre', 'carros livres') : 'nenhum carro livre agora',
      acao: 'preciso-carro',
    },
  ]
}

/**
 * Os botões da aba Gestão.
 *
 * `podeCriar` e `podeReservar` NÃO são enfeite: os botões que eles guardam
 * substituíram controles que já eram protegidos, e sem eles a permissão
 * sumiria em silêncio. O "+ Acrescentar veículo" que virou botão daqui era
 * `v-if="pode('criar')"`, e o "Reservar" de cada carro é `v-if="podeEditar"`.
 * A aba Gestão inteira aparece pra quem tem `criar` OU `excluir`
 * (`areas-da-frota.js`), então quem tem só `excluir` chega aqui — e chegaria a
 * um botão que não devia ver.
 *
 * Botão sem permissão **não aparece**, em vez de aparecer desligado: é como o
 * resto desta base faz (`v-if`, não `:disabled`), e oferecer o que não se pode
 * fazer é pior que não oferecer, sobretudo pra quem tem dificuldade de uso.
 *
 * Os dois nascem `false`: quem esquecer de passar recebe a tela mais fechada,
 * não a mais aberta.
 */
export function botoesDaGestao({ linhas, cobranca, fila, podeCriar = false, podeReservar = false } = {}) {
  const l = linhas || []
  const livres = l.filter((x) => x && x.disponivel).length
  const naFila = (fila || []).length

  // `cobranca` nulo é "o quadro não carregou" — diferente de "ninguém falta".
  let estadoCobranca = null
  if (Array.isArray(cobranca) && cobranca.length) {
    const faltam = cobranca.filter((c) => c && !c.fez).length
    estadoCobranca = faltam
      ? `faltam ${faltam} de ${cobranca.length} hoje`
      : 'todos conferidos hoje'
  }

  const todos = [
    {
      chave: 'reservar',
      rotulo: 'Reservar um carro',
      estado: naFila ? contar(naFila, 'pedido esperando', 'pedidos esperando') : null,
      acao: 'reservar',
      exige: 'reservar',
    },
    {
      chave: 'conferir-checklists',
      rotulo: 'Conferir checklists',
      estado: estadoCobranca,
      acao: 'conferir-checklists',
      // Só rola a tela até um quadro que quem está na aba já vê. Sem exigência.
      exige: null,
    },
    {
      chave: 'acrescentar',
      rotulo: 'Acrescentar um veículo',
      estado: null,
      acao: 'acrescentar',
      exige: 'criar',
    },
    {
      chave: 'veiculos',
      rotulo: 'Veículos do grupo',
      estado: l.length
        ? `${contar(l.length, 'veículo', 'veículos')} · ${contar(livres, 'livre', 'livres')}`
        : null,
      acao: 'veiculos',
      exige: null,
    },
  ]

  const liberado = { criar: podeCriar, reservar: podeReservar }
  // `exige` sai do que a tela recebe: ele é decisão de dentro deste módulo, e
  // deixá-lo vazar faria a tela achar que precisa conferir permissão de novo.
  return todos
    .filter((b) => !b.exige || liberado[b.exige])
    .map(({ exige, ...b }) => b)
}
