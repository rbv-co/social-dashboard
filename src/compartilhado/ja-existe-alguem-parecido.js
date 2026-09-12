// JÁ EXISTE ALGUÉM COM ESSE NOME? — a desconfiança, sem a tela.
//
// POR QUE EXISTE (medido em 27/08/2026): o Douglas Pereira tinha DUAS fichas.
// A de 19/08 nasceu pelo `+` rápido da Frota/Patrimônio — só nome, cargo e
// setor, SEM e-mail. A de 21/08 nasceu na lista de logins, onde ele aparecia
// como "Sem cadastro" e alguém clicou em "Criar cadastro".
//
// A raiz: `vinculo-de-cadastro.js` casa login com ficha SÓ por e-mail, e ficha
// sem e-mail não tem por onde casar. O nome era idêntico e ninguém olhou.
//
// O estrago: os pertences dele ficaram partidos entre as duas fichas — o carro,
// o Macbook e o bem do Punto numa; o celular na outra. A tela que mostra "meus
// bens" lê por `pessoa_id`, então ele abria o app e via UM item de três.
//
// ─────────────────────────────────────────────────────────────────────────────
// POR QUE O RIGOR É ESTE, E NÃO MAIS FROUXO
//
// Medido na base real: SETE pares de pessoas dividem uma palavra do nome — três
// Vieira, duas Clara, dois Gabriel, dois Franco, dois Rodrigues — e NENHUM é a
// mesma pessoa. Uma regra de "dividiu sobrenome, avisa" daria sete alarmes
// falsos e zero certos numa base de 34.
//
// E aviso que aparece à toa vira paisagem: a pessoa aprende a clicar em "criar
// mesmo assim" sem ler, e aí ele não protege mais nada. Por isso só três casos
// contam, e todos são sobre o nome INTEIRO.
//
// ESTE MÓDULO NÃO DECIDE NADA. Ele devolve de quem suspeitar; quem escolhe é
// sempre quem está cadastrando. Homônimo de verdade existe, e travar o cadastro
// deixaria a pessoa sem saída.
//
// PURO de propósito, como os vizinhos desta pasta: dentro de um `.vue` esta
// regra não teria como quebrar teste nenhum.

// Abaixo disto, uma letra de diferença não conta. "Breno" tem 5 letras: com uma
// letra de folga, "Brena" e "Bruno" virariam a mesma pessoa. Nome curto tem
// pouca margem para ser parecido por acaso — e muita para ser outra pessoa.
const LETRAS_PARA_VALER_UMA_TROCA = 8

// Sem acento, sem caixa, sem pontuação, sem espaço repetido.
//
// A pontuação sai para "Pereira, Douglas" poder ser reconhecido como as mesmas
// duas palavras. O acento sai porque quem digita com pressa não acentua, e
// "Mariá" e "Maria" não podem virar duas pessoas por causa de um til.
//
// ⚠️ NÃO É o `normalizarNome` de `nova-opcao.js`, e o nome diferente é de
// propósito. Aquele apara e minúsculas, nada mais, e serve às listas da Central
// inteira (marca, tipo, local, categoria) — onde ele DECIDE se cria ou
// seleciona. Este aqui é mais agressivo e só levanta suspeita sobre nome de
// GENTE. Se os dois se chamassem igual, um dia alguém "unificaria" e a decisão
// de criar marca passaria a ignorar acento sem ninguém ter pedido.
export function nomeComparavel(nome) {
  return String(nome == null ? '' : nome)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// As palavras em ordem alfabética, para "Pereira Douglas" e "Douglas Pereira"
// darem a mesma coisa. Uma palavra só não conta: seria o mesmo que o caso IGUAL,
// e marcar como "ordem trocada" mentiria sobre o motivo.
function palavrasOrdenadas(normalizado) {
  const palavras = normalizado.split(' ').filter(Boolean)
  return palavras.length > 1 ? palavras.slice().sort().join(' ') : null
}

// Vale por "uma letra de diferença": trocada, faltando ou sobrando.
//
// Não é a distância inteira — só a pergunta "é no máximo 1?". Isso deixa o corte
// por tamanho resolver quase tudo antes de olhar letra por letra, e mantém a
// função curta o bastante para se conferir de cabeça.
function ateUmaLetraDeDiferenca(a, b) {
  if (a === b) return true
  const diferencaDeTamanho = a.length - b.length
  if (diferencaDeTamanho > 1 || diferencaDeTamanho < -1) return false

  // O mais longo primeiro, para o caso "faltando/sobrando" ter um único formato.
  const maior = a.length >= b.length ? a : b
  const menor = a.length >= b.length ? b : a

  let i = 0
  let j = 0
  let jaErrouUma = false
  while (i < maior.length && j < menor.length) {
    if (maior[i] === menor[j]) { i++; j++; continue }
    if (jaErrouUma) return false
    jaErrouUma = true
    // Tamanhos iguais: foi troca, os dois andam. Tamanhos diferentes: sobrou uma
    // letra no maior, só ele anda.
    if (maior.length === menor.length) { i++; j++ } else { i++ }
  }
  // Sobrou letra no fim do maior? Só cabe se ainda não se errou nenhuma.
  return !(jaErrouUma && i < maior.length)
}

// De quem suspeitar, do mais parecido para o menos.
//
// `pessoas` é a lista que a tela já tem carregada — nenhuma consulta nova. Basta
// cada item ter `nome`; `id`, `cargo` e `status` são usados pela tela quando
// existem.
//
// `ignorarId` tira a própria pessoa da comparação: sem isso, abrir a ficha do
// Douglas e salvar diria "já existe o Douglas".
//
// Devolve `[{ pessoa, motivo }]`, com `motivo` em 'igual' | 'ordem-trocada' |
// 'quase-igual'. O motivo sobe junto porque a frase da tela muda com ele — "já
// existe" e "parece com" não são a mesma afirmação.
export function parecidos(nomeDigitado, pessoas, { ignorarId = null } = {}) {
  const alvo = nomeComparavel(nomeDigitado)
  if (!alvo) return []

  const alvoOrdenado = palavrasOrdenadas(alvo)
  const lista = Array.isArray(pessoas) ? pessoas.filter(Boolean) : []
  const achados = []

  for (const pessoa of lista) {
    if (ignorarId != null && pessoa.id != null && String(pessoa.id) === String(ignorarId)) continue
    const dela = nomeComparavel(pessoa.nome)
    if (!dela) continue

    if (dela === alvo) { achados.push({ pessoa, motivo: 'igual' }); continue }

    const delaOrdenada = palavrasOrdenadas(dela)
    if (alvoOrdenado && delaOrdenada && alvoOrdenado === delaOrdenada) {
      achados.push({ pessoa, motivo: 'ordem-trocada' }); continue
    }

    // O corte por tamanho vale pelos DOIS: comparar um nome curto com um longo
    // por "uma letra" seria frouxo do lado curto.
    if (alvo.length >= LETRAS_PARA_VALER_UMA_TROCA && dela.length >= LETRAS_PARA_VALER_UMA_TROCA
        && ateUmaLetraDeDiferenca(alvo, dela)) {
      achados.push({ pessoa, motivo: 'quase-igual' })
    }
  }

  // O igual primeiro: quando há um nome idêntico, é dele que se está falando, e
  // ele não pode aparecer embaixo de um palpite.
  const peso = { igual: 0, 'ordem-trocada': 1, 'quase-igual': 2 }
  return achados.sort((a, b) => peso[a.motivo] - peso[b.motivo])
}

// A frase da tela, para as três portas contarem a MESMA história. Escrita aqui
// porque repetida em três lugares ela divergiria — e "já existe" dito de três
// jeitos diferentes parece três avisos diferentes.
export function fraseDoParecido(achados) {
  if (!achados || !achados.length) return ''
  const nomes = achados.map((a) => {
    const p = a.pessoa
    const detalhe = [p.cargo, p.status === 'desligado' ? 'desligado' : null].filter(Boolean).join(', ')
    return detalhe ? `${p.nome} (${detalhe})` : p.nome
  })
  const temIgual = achados.some((a) => a.motivo === 'igual')
  const abre = temIgual
    ? 'Já existe alguém com esse nome'
    : 'Já existe alguém com o nome parecido'
  return nomes.length === 1
    ? `${abre} — seria ${nomes[0]}?`
    : `${abre} — seria ${nomes.slice(0, -1).join(', ')} ou ${nomes[nomes.length - 1]}?`
}
