/* AS CONTAS DA BEAUTY SESSION — lógica pura, testada sem navegador.
 *
 * ⚠️ AS REGRAS DO ENDEREÇO SÃO GÊMEAS DAS DE `vessel-brasil`.
 * Os dois endereços que a tela mostra (o QR da mesa e o do cartão) são montados
 * lá também, em `regras-das-beauty-sessions.mjs`, porque é lá que as páginas
 * públicas vivem. São repositórios separados — a Central não importa arquivo do
 * site, e o site não pode ter a credencial do banco.
 *
 * Isso é a "mesma verdade em dois lugares", que neste projeto já custou caro
 * (a frase do canvas sobreviveu em um arquivo depois de sair de dois). A defesa
 * é um teste ao lado: quando a pasta do site está por perto, ele LÊ o arquivo
 * de lá e cobra que os dois montem o mesmo endereço. Se divergirem, reprova.
 *
 * Se um dia isto divergir e ninguém notar, o estrago é silencioso: a cliente
 * entra em dois baldes de atribuição e a conta da sessão sai pela metade.
 */

export const SITE = 'https://vesselbrasil.com.br'

/** O formato do código, do módulo 10: BS-AAAAMMDD-PRACA-SEQ. */
export const FORMATO = /^BS-\d{8}-[A-Z]{3}-[A-Z0-9]{1,4}$/

export const LOJAS = {
  iguatemi: 'Iguatemi Campinas',
  tivoli: 'Tivoli Santa Bárbara',
  parkshopping: 'ParkShopping Brasília',
}

/** A praça de cada loja — o código carrega a praça, e ela tem de bater. */
export const PRACA_DA_LOJA = { iguatemi: 'CPS', tivoli: 'SBO', parkshopping: 'BSB' }

/**
 * O código sugerido a partir do que a pessoa escolheu.
 *
 * ⚠️ SUGERIR, E NÃO OBRIGAR A DIGITAR. Digitar `BS-20260925-CPS-01` à mão é
 * exatamente onde nasce o erro que ninguém vê: uma letra trocada vira uma
 * campanha órfã no painel, e só aparece quando a conta não fecha. A tela monta,
 * a pessoa confere.
 */
export function codigoSugerido(quando, loja, sequencia = 1) {
  const praca = PRACA_DA_LOJA[loja]
  if (!quando || !praca) return ''
  // ⚠️ NÚMERO VAI COM DOIS DÍGITOS: a primeira sessão é `01`, não `1`. As três
  // que já existem impressas seguem esse formato, e um `BS-...-CPS-1` conviveria
  // com um `BS-...-CPS-01` como se fossem eventos diferentes. Letra (como AME)
  // passa como está — ela não é contagem, é apelido do parceiro.
  let seq = String(sequencia ?? 1).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4)
  if (/^\d+$/.test(seq)) seq = seq.padStart(2, '0')
  return `BS-${String(quando).replaceAll('-', '')}-${praca}-${seq || '01'}`
}

/**
 * O que está errado, em frases que a operação entende.
 *
 * ⚠️ ESPELHA AS CONFERÊNCIAS DO BANCO de propósito. Quem barra de verdade é
 * `vessel_beauty_session_criar` — esta função existe para a pessoa descobrir o
 * erro ANTES de enviar, não para substituir a trava. Tela não é tranca.
 */
export function problemasDaSessao({ codigo, quando, loja } = {}) {
  const problemas = []
  const c = String(codigo || '').trim().toUpperCase()
  if (!FORMATO.test(c)) {
    problemas.push('O código precisa ser assim: BS-20260925-CPS-01.')
  } else {
    if (quando && c.slice(3, 11) !== String(quando).replaceAll('-', '')) {
      problemas.push('A data escrita no código não é a data da sessão.')
    }
    if (loja && PRACA_DA_LOJA[loja] && c.slice(12, 15) !== PRACA_DA_LOJA[loja]) {
      problemas.push(`A praça do código não é a da loja escolhida (${PRACA_DA_LOJA[loja]}).`)
    }
  }
  if (!quando) problemas.push('Escolha a data da sessão.')
  if (!loja || !LOJAS[loja]) problemas.push('Escolha a loja.')
  return problemas
}

/** O QR da MESA: curto de propósito, porque é lido de longe. */
export function enderecoDaMesa(codigo) {
  const c = String(codigo || '').trim().toUpperCase()
  return FORMATO.test(c) ? `${SITE}/bs/${c}` : ''
}

/**
 * O QR do CARTÃO: leva para a página de pedir visita já dizendo de qual sessão
 * a cliente veio. É maior porque carrega a origem inteira — e pode ser, porque
 * o cartão é lido de perto, na mão.
 *
 * ⚠️ OS CINCO CAMPOS, NESTA ORDEM, são os mesmos que o site monta. Divergir de
 * um deles joga a mesma cliente em dois baldes de atribuição.
 */
export function enderecoDoCartao(codigo) {
  const c = String(codigo || '').trim().toUpperCase()
  if (!FORMATO.test(c)) return ''
  const p = new URLSearchParams({
    canal: 'beauty_session',
    event_id: c,
    utm_source: 'beauty_session',
    utm_medium: 'offline_qr',
    utm_campaign: c.toLowerCase().replaceAll('-', '_'),
  })
  return `${SITE}/private-appointment/?${p}`
}

/**
 * Os números de uma sessão, prontos para a tela.
 *
 * ⚠️ "LEITURAS" NÃO É GENTE, e a tela precisa dizer isso: a mesma cliente
 * abrindo duas vezes conta duas. Chamar de "visitantes" seria mentir para quem
 * decide orçamento olhando este número.
 *
 * ⚠️ A TAXA SÓ EXISTE SE HOUVE LEITURA. Dividir por zero e mostrar "0%" faria
 * uma sessão que ninguém abriu parecer uma sessão que fracassou — são coisas
 * diferentes, e a segunda pede uma decisão que a primeira não pede.
 */
export function resumoDaSessao(linha = {}) {
  const mesa = Number(linha.leituras_mesa || 0)
  const cartao = Number(linha.leituras_cartao || 0)
  const leituras = mesa + cartao
  const pessoas = Number(linha.pessoas || 0)
  return {
    mesa,
    cartao,
    leituras,
    pessoas,
    pedidos: Number(linha.pedidos || 0),
    compareceram: Number(linha.compareceram || 0),
    receita: Number(linha.receita || 0),
    // quantas das leituras viraram gente com nome e WhatsApp
    taxa: leituras > 0 ? pessoas / leituras : null,
  }
}

export function taxaEscrita(taxa) {
  if (taxa === null || taxa === undefined) return '—'
  return `${Math.round(taxa * 100)}%`
}

/** dd/mm/aaaa a partir de aaaa-mm-dd, sem passar por Date (fuso não entra). */
export function dataLegivel(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''))
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ''
}

/**
 * Já passou? Serve para a tela oferecer "encerrar" no lugar certo.
 * ⚠️ Compara TEXTO com TEXTO (aaaa-mm-dd), nunca Date: `new Date('2026-09-25')`
 * é meia-noite em UTC, e no nosso fuso vira o dia 24 — a sessão de hoje
 * apareceria como passada.
 */
export function jaPassou(quando, hoje) {
  const a = String(quando || '').slice(0, 10)
  const b = String(hoje || '').slice(0, 10)
  return Boolean(a) && Boolean(b) && a < b
}
