// Regras puras do painel de Autenticidade. Sem DOM, sem rede — por isso dá pra
// testar de verdade, sem abrir navegador.

// O endereço do domínio novo, não o do painel: é ISTO que vai gravado dentro da
// etiqueta NFC e é o que a cliente vai ver quando encostar o celular.
const DOMINIO = 'https://vesselbrasil.com.br'

export function enderecoDaTag(codigo) {
  return `${DOMINIO}/verify/${String(codigo || '').trim().toUpperCase()}`
}

// ── O NÚMERO DE SÉRIE ──────────────────────────────────────────────────────
// DECISÃO DO DONO, 02/09/2026: a REFERÊNCIA e a PEÇA viram um número só, e o
// formato é COLADO — os DÍGITOS da referência seguidos da sequência da peça, sem
// separador e sem zeros de enchimento:
//
//     referência H0015S, peça 1   →  00151
//     referência H0015S, peça 12  →  0015012
//     referência C0011S, peça 3   →  0011003
//
// ⚠️ A SEQUÊNCIA TEM LARGURA FIXA, E É ISSO QUE SUSTENTA O FORMATO COLADO.
// Até 04/09/2026 a peça ia sem enchimento, e aí "001512" podia ser a peça 12 da
// referência 0015 OU a peça 2 da referência 00151 — um número que aponta para
// duas bolsas não é número de série. A tela AVISAVA disso (`serieAmbigua`), e o
// aviso deixou de existir junto com o defeito: com 3 casas sempre, as últimas
// três são SEMPRE a peça e o resto é SEMPRE a referência, tenha ela quatro
// dígitos ou cinco.
//
// SEM REFERÊNCIA NÃO HÁ NÚMERO DE SÉRIE. Aí a tela volta a mostrar o que já
// mostrava — `nº 3` —, que é a verdade que se tem, em vez de um traço que não
// diz nada.
//
// ⚠️ ESTA MESMA CONTA MORA DO OUTRO LADO, em `vessel-brasil/verify/regras.js`,
// que é a página que a CLIENTE abre ao encostar o celular na bolsa. As duas são
// a mesma de propósito: o número que a etiqueta manda para a cliente e o número
// que o painel imprime na bancada têm de bater. Mudou uma, muda a outra — não há
// terceira dona da regra. (Em 04/09/2026 as duas mudaram na mesma entrega.)
// ⚠️ TODOS OS DÍGITOS DO SKU, E NÃO SÓ O PRIMEIRO GRUPO. Parece descuido e não é
// — foi decidido em 05/09/2026, com os dois caminhos medidos lado a lado.
//
// `SS0008HB.M5` vira `00085`, e não `0008`: o `5` do sufixo de variação entra.
// Feio de ler, e é justamente o que faz alguém querer "consertar". NÃO CONSERTE.
//
// O MOTIVO: no Bling, CADA PRODUTO TEM SKU PRÓPRIO. `SS0008HB.M5` e
// `SS0008HB.M6` são produtos diferentes — cores diferentes do mesmo molde — e
// precisam de números de série diferentes. Pegando só o primeiro grupo, os dois
// virariam referência `0008`, e a peça 1 de cada um daria `0008001`: duas bolsas
// distintas com o MESMO número de série. É o defeito que a largura fixa da
// sequência acabou de eliminar, voltando por outra porta.
//
// A alternativa que também funcionaria era numerar a sequência POR REFERÊNCIA em
// vez de por lote (0008001..0008003 no lote preto, 0008004..0008006 no areia).
// Foi apresentada e recusada: ela custa mexer na criação e na renumeração das
// peças — a parte mais delicada do selo, cujo número vai gravado dentro de uma
// bolsa — e mataria a frase "nº 3 de 12", porque a série deixaria de terminar no
// lote. O dono escolheu o caminho que não encosta em nada.
// ⚠️ TODO O SKU, LETRAS INCLUÍDAS — e não só os dígitos.
//
// Até 07/09/2026 esta conta jogava fora as letras. `SS0001HB.M1`, `SS0001CB.M1`,
// `SS0001SB.S1` e `SS0001L.1` viravam todos `00011`, porque HB/CB/SB/L são o que
// diz a CATEGORIA — e ela sumia. A peça 1 de cada um dava `00011001`: quatro
// bolsas diferentes com o mesmo número de série.
//
// Não era teoria. Medido no banco em 07/09/2026: 14 números já estavam em uso
// por mais de um produto, entre peças GRAVADAS. `00011001` sozinho estava em
// oito peças de cinco produtos — Maelle, Ravelle, Linear.
//
// Número de série é IDENTIDADE: é o que casa a etiqueta NFC com o certificado
// da cliente. Dois produtos com o mesmo número significa cliente abrindo o
// certificado e vendo outra bolsa.
//
// Fica mais comprido, e é justamente o que faz alguém querer "encurtar".
// NÃO ENCURTE: qualquer pedaço que se tire volta a colar produtos diferentes.
const digitosDaReferencia = (sku) =>
  String(sku ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')

// ⚠️ A SEQUÊNCIA TEM LARGURA FIXA, E É ISSO QUE DESFAZ A AMBIGUIDADE.
//
// Colar dois números de tamanho variável não tem leitura de volta: a referência
// 0015 na peça 12 dava "001512", que é a peça 12 da referência 0015 OU a peça 2
// da referência 00151. Um número que aponta para duas bolsas não é número de
// série. O sistema já AVISAVA disso; agora não acontece mais.
//
// Com a sequência sempre em 3 casas, as últimas 3 são SEMPRE a peça e o resto é
// SEMPRE a referência — não importa se ela tem 4 ou 5 dígitos. A leitura é única.
//
// TRÊS CASAS BASTAM, E ISSO É DEMONSTRÁVEL, não estimado: `vessel_gerar_lote` e
// `vessel_editar_lote` recusam `p_quantidade > 500`. Peça 1000 não existe.
//
// ⚠️ QUEM JÁ ESTÁ CONGELADA NÃO MUDA — peça gravada ou com garantia mantém o
// número que já foi ao mundo. Em 04/09/2026, quando isto entrou, havia UMA peça
// congelada no sistema inteiro: era o momento mais barato que ia existir.
export const DIGITOS_DA_SEQUENCIA = 3

export function numeroDeSerie(sku, numero) {
  const digitos = digitosDaReferencia(sku)
  // ⚠️ `Number(null)` é ZERO, que é finito — uma guarda com `Number.isFinite`
  // deixa passar e o número sai como "0015null" na cara da pessoa. O teste do
  // lado do certificado pegou isso. Aqui se exige INTEIRO MAIOR QUE ZERO.
  const n = (numero === null || numero === undefined || numero === '') ? NaN : Number(numero)
  if (!digitos || !Number.isInteger(n) || n < 1) return ''
  return digitos + String(n).padStart(DIGITOS_DA_SEQUENCIA, '0')
}


// O PREFIXO, SEPARADO DO NÚMERO. Ele existe porque o rótulo precisa sumir em UM
// lugar só: a lista de peças é TABELA no computador, onde a coluna "Nº DE SÉRIE"
// já diz o que o número é — e é a MESMA lista virada em CARTÃO no celular, onde
// o cabeçalho não existe (`display:none` na regra-base) e "00151" encostado em
// "K7M4X001QP" são dois amontoados de caractere sem nada dizendo qual é qual.
//
// Em dois pedaços, o da frente some por CSS só no computador. Numa string só,
// ou ele some nos dois ou fica nos dois.
//
// Sem número de série não há prefixo: o número já sai como "nº 3" sozinho, e
// somar os dois daria "nº de série nº 3".
export function prefixoDaSerie(peca, lote) {
  return numeroDeSerie((lote || {}).sku, (peca || {}).numero_na_serie) ? 'nº de série ' : ''
}

// COMO A TELA CHAMA UMA PEÇA, em qualquer lugar em que ela seja NOMEADA.
// Com referência é o número de série; sem ela, o `nº 3` de sempre. Peça sem
// número nenhum não vira "nº undefined": não sai rótulo.
//
// `curto` é para onde JÁ EXISTE um cabeçalho dizendo o que o número é — a
// coluna "Nº de série" da tabela de peças. Ali "nº de série 001512" embaixo de
// "Nº DE SÉRIE" é a mesma palavra duas vezes, e ela rouba a largura de uma
// coluna que precisa caber "0015500" sem cortar.
//
// ⚠️ O FALLBACK NÃO ENCURTA, de propósito: sem referência, a célula diz `nº 3`
// mesmo embaixo do cabeçalho "Nº de série". É esse `nº` que avisa que ali não
// há número de série nenhum — um "3" pelado embaixo daquele cabeçalho seria a
// tela dizendo que o número de série desta bolsa é 3.
export function rotuloDaSerie(peca, lote, { curto = false } = {}) {
  const p = peca || {}
  const serie = numeroDeSerie((lote || {}).sku, p.numero_na_serie)
  if (serie) return curto ? serie : `nº de série ${serie}`
  return p.numero_na_serie == null ? '' : `nº ${p.numero_na_serie}`
}

// A FRASE GRANDE DA BANCADA — "nº 8 de 20", o maior elemento da tela.
//
// Ela mora aqui, e não na tela, por causa de uma coisa que mudou em 03/09/2026:
// a SÉRIE PASSOU A ACEITAR BURACO. Antes, renumerar sempre deixava as peças em
// 1..N, então o número da peça nunca passava do total do lote e `nº X de N` era
// uma frase sempre verdadeira. Agora peça GRAVADA ou COM GARANTIA fica congelada
// no número dela — porque esse número virou o número de série impresso no
// certificado da cliente, e ele não pode mudar depois que a bolsa saiu daqui.
//
// O preço é o vão: um lote pode ter nove peças com uma delas numerada 10. Aí
// `nº 10 de 9` é uma frase impossível, do tipo que faz quem lê parar e
// desconfiar da ferramenta inteira no meio de uma gravação em série.
//
// Quando o número não cabe no total, o "de N" simplesmente sai. `nº 10` sozinho
// continua respondendo a única pergunta que essa frase faz — qual peça está na
// minha mão —, e o progresso do lote continua na barra logo abaixo, que é de
// quem essa conta sempre foi.
export function fraseDaPecaNaMao(peca, lote) {
  const n = (peca || {}).numero_na_serie
  if (n == null) return ''
  const total = (lote || {}).quantidade
  return Number.isInteger(total) && n <= total ? `nº ${n} de ${total}` : `nº ${n}`
}

// PEÇA BAIXADA SAI DA FILA. Sem isto a tela mandaria alguém gravar a etiqueta
// de uma peça dada como refugo, e a etiqueta iria para dentro de uma bolsa que
// não deveria existir.
//
// EXPORTADA de propósito: `nfc-fila.js` precisa exatamente desta regra para a
// lista do gravador de mesa, e tinha uma CÓPIA à mão (`!p.gravada_em &&
// !p.baixada`). Duas cópias da mesma regra divergem no dia em que a regra muda
// — e a que ficar para trás manda gravar a etiqueta de uma peça baixada.
export const naFila = (p) => !p.baixada

export function progressoDoLote(pecas) {
  // a baixada sai dos DOIS números: se ficasse no total, o lote nunca fecharia
  const lista = (Array.isArray(pecas) ? pecas : []).filter(naFila)
  const gravadas = lista.filter((p) => p.gravada_em).length
  return { gravadas, total: lista.length, texto: `${gravadas} de ${lista.length}` }
}

// A próxima etiqueta a gravar é a primeira SEM gravação, na ordem da série. O
// banco não devolve ordenado sozinho, então a ordem se garante aqui.
export function proximaPorGravar(pecas) {
  const lista = (Array.isArray(pecas) ? pecas : [])
    .filter((p) => naFila(p) && !p.gravada_em)
    .sort((a, b) => (a.numero_na_serie || 0) - (b.numero_na_serie || 0))
  return lista[0] || null
}

// ── OS MOTIVOS DE BAIXA ────────────────────────────────────────────────────
// A chave é o que o banco aceita; o rótulo é o que a pessoa lê.
//
// ⚠️ ESTA LISTA MORA EM TRÊS LUGARES, e os três precisam concordar. Quem
// acrescentar um motivo aqui e esquecer dos outros dois vê a tela oferecer uma
// opção que o banco recusa com `motivo_invalido` — e a pessoa fica achando que
// a ferramenta quebrou:
//
//   1. o `check (motivo in (...))` da coluna `vessel_baixas.motivo`;
//   2. o `if ... not in (...)` de DENTRO de `vessel_baixar_peca` — e o de
//      `vessel_sobrescrever_etiqueta`, que confere o motivo da baixa antes de
//      escrever (a trava mais fechada é a que manda, e é a de dentro da função);
//   3. esta lista, que é o que a tela oferece.
//
// Os 1 e 2 foram acertados em `db/migrations/2026-09-01-vessel-editar-etiquetas.sql`.
// Este arquivo é o 3.
export const MOTIVOS_DE_BAIXA = [
  { chave: 'extraviada', rotulo: 'Extraviada' },
  { chave: 'defeito', rotulo: 'Defeito ou refugo' },
  { chave: 'devolvida', rotulo: 'Devolvida' },
  { chave: 'etiqueta_perdida', rotulo: 'Etiqueta perdida ou danificada' },
  // A peça que foi usada para testar a gravação. Ela nunca vira bolsa, e sem
  // este motivo ela era baixada como 'defeito' — que faria a contagem de
  // refugo da produção mentir.
  { chave: 'teste', rotulo: 'Usada em teste' },
]

// ── POR QUE A GARANTIA FOI ENCERRADA ───────────────────────────────────────
// Lista separada da de baixa de PEÇA de propósito: lá a peça some da produção
// (extravio, refugo); aqui a PEÇA continua existindo e quem sai é a dona. Um
// motivo de uma lista aplicado na outra contaria história errada no histórico.
//
// `outro` é o escape obrigatório: nenhuma lista prevê a vida real, e sem ele a
// pessoa escolheria o motivo "mais ou menos parecido" — que é pior do que texto
// livre, porque parece preciso.
export const MOTIVOS_DE_DEVOLUCAO = [
  { chave: 'devolucao_arrependimento', rotulo: 'Devolução — arrependimento (7 dias)' },
  { chave: 'devolucao_defeito', rotulo: 'Devolução — defeito na peça' },
  { chave: 'troca_por_outra', rotulo: 'Trocada por outra peça' },
  { chave: 'compra_cancelada', rotulo: 'Compra cancelada ou não paga' },
  { chave: 'registro_errado', rotulo: 'Registrada por engano (pessoa ou selo errado)' },
  { chave: 'outro', rotulo: 'Outro motivo (escrever)' },
]

// O TEXTO QUE VAI PARAR NO HISTÓRICO. O banco guarda `motivo` como texto livre,
// então quem traduz a escolha em frase é aqui — e é aqui também que 'outro'
// devolve o que a pessoa escreveu, em vez da palavra "outro", que não explica
// nada para quem ler daqui a três meses.
export function motivoDaDevolucaoEscrito(chave, escrito = '') {
  const limpo = String(escrito || '').trim()
  if (chave === 'outro') return limpo
  const achado = MOTIVOS_DE_DEVOLUCAO.find((m) => m.chave === chave)
  if (!achado) return limpo
  return limpo ? `${achado.rotulo} — ${limpo}` : achado.rotulo
}

// O RÓTULO QUE A PESSOA LÊ, a partir da chave que o banco aceita. Ele MORA AQUI,
// junto da lista, e não na tela: a lista completa do lote (`linhasDaListaDoLote`,
// mais abaixo) escreve o mesmo motivo que a tela mostra, e rótulo escrito em
// dois lugares é rótulo que diverge no dia em que um deles muda.
export function rotuloDoMotivo(chave) {
  return (MOTIVOS_DE_BAIXA.find((m) => m.chave === chave) || {}).rotulo || chave || '—'
}

// ── AS FRASES DE RECUSA ────────────────────────────────────────────────────
// Botão desabilitado calado faz a pessoa achar que a ferramenta está quebrada.
// Cada recusa do banco vira uma frase que diz POR QUE e O QUE FAZER.
export function fraseDaRecusa(motivo, dados = {}) {
  const d = dados || {}
  switch (motivo) {
    case 'tem_gravada':
      return `Não dá para excluir: ${d.gravadas} das ${d.total} etiquetas deste lote `
        + 'já foram gravadas e podem estar dentro de bolsas. Você pode dar baixa nas peças, uma a uma.'
    case 'tem_garantia': {
      // `gravada_em` não era a única prova de que a peça está no mundo: a
      // cliente registra a garantia pelo CÓDIGO, sem a peça precisar estar
      // gravada, e `vessel_registros` cai por `on delete cascade` junto com a
      // peça. Aqui não há conselho a dar — diferente de `esta_gravada`, não há
      // "dê baixa em vez disso": há uma garantia de uma pessoa de verdade
      // pendurada no código, e ninguém do lado de cá pode tirá-la.
      const n = d.garantias ?? 1
      // A mesma recusa serve ao lote (o banco manda `total` junto) e à peça
      // sozinha (manda só `garantias`). Dizer "deste lote" ao excluir UMA peça
      // seria uma mentira pequena, e a tela não mente.
      const onde = d.total == null ? '' : ' deste lote'
      return `Não dá para excluir: ${n} peça(s)${onde} já têm garantia registrada `
        + 'por uma cliente. Apagar tiraria a garantia dela.'
    }
    case 'esta_gravada':
      return 'Esta etiqueta já foi gravada e pode estar dentro de uma bolsa. '
        + 'Em vez de excluir, dê baixa nela com o motivo.'
    case 'abaixo_do_gravado':
      return `Não dá para diminuir tanto: ${d.gravadas} peça(s) já foram gravadas. `
        + `O mínimo é ${d.gravadas}.`
    case 'ja_baixada':
      return 'Esta peça já está baixada. Desfaça a baixa antes de baixar de novo.'
    case 'nao_esta_baixada':
      return 'Esta peça não está baixada.'

    // ── A RECUSA QUE NÃO EXISTIA, PORQUE O BANCO MENTIA ───────────────────
    // `vessel_marcar_gravada` respondia `ok: true` sem olhar se mudou alguma
    // linha — código inexistente, peça já gravada e linha barrada davam todas a
    // MESMA resposta do sucesso. A tela dizia "gravada" e seguia. Numa gravação
    // em série isso vira etiqueta dentro de uma bolsa sem registro nenhum, e as
    // duas peças ficam idênticas por fora: ninguém separa qual foi.
    // Consertado na migration `2026-09-01-zzz-marcar-gravada-para-de-mentir`.
    case 'peca_nao_existe':
      return 'Este código não existe no sistema. Confira o que foi lido da etiqueta: '
        + 'ela pode ser de outro lote, ou a peça pode ter sido excluída.'

    // ── AS RECUSAS DE EDITAR ETIQUETA JÁ GRAVADA ──────────────────────────
    // Elas vêm de `vessel_desmarcar_gravada` e `vessel_sobrescrever_etiqueta`
    // (migration 2026-09-01). Cada uma diz O QUE HOUVE e O QUE FAZER: uma
    // recusa que só devolve o código cru faz a pessoa recarregar a tela às
    // cegas, e do outro lado há uma etiqueta costurada dentro de uma bolsa.
    case 'nao_esta_gravada':
      return 'Esta peça não está marcada como gravada — não há gravação para apagar. '
        + 'Recarregue a tela: alguém pode ter apagado antes de você.'
    case 'motivo_obrigatorio':
      return 'Esta peça tem garantia registrada por uma cliente. Escreva o motivo antes de continuar: '
        + 'sem ele, ninguém consegue explicar em três meses por que a peça voltou para a fila.'
    case 'motivo_invalido':
      return 'Esse motivo de baixa não existe mais. Escolha um da lista e tente de novo.'
    case 'destino_invalido':
      return 'Escolha o que fazer com a peça antiga: voltar para a fila de gravação, ou dar baixa nela.'
    case 'mesma_peca':
      return 'A etiqueta já é desta mesma peça — não há nada a sobrescrever. '
        + 'Se ela ainda não está marcada, use “Gravei essa”.'
    case 'antiga_nao_existe':
      return 'A peça que está DENTRO desta etiqueta não existe mais no sistema. '
        + 'Separe a etiqueta e pegue uma em branco: sobrescrever cegamente apagaria uma identidade '
        + 'que ninguém consegue mais reconstruir.'
    case 'nova_nao_existe':
      return 'A peça que você está gravando não existe mais. Recarregue a tela e escolha o lote de novo.'
    case 'antiga_nao_esta_gravada':
      return 'A peça que estava nesta etiqueta já tinha sido devolvida para a fila. '
        + 'Não há sobrescrita a fazer: grave normalmente, com “Gravar nesta etiqueta”.'
    case 'nova_ja_gravada':
      return 'Esta peça já está marcada como gravada, e portanto já tem uma etiqueta por aí. '
        + 'Marcá-la de novo colocaria o mesmo código em DUAS bolsas. '
        + 'Apague a gravação dela primeiro, na aba Etiquetas.'
    case 'sem_permissao':
      return 'Você não tem permissão para isso. Peça a chave "autenticidade" a um administrador.'
    case 'lote_nao_existe':
    case 'peca_nao_existe':
      return 'Não encontrei esse registro. Recarregue a tela e tente de novo.'
    case 'dados_invalidos':
      return 'Confira os campos: o modelo é obrigatório e a quantidade vai de 1 a 500.'
    default:
      return 'Não consegui fazer isso agora. Recarregue a tela e tente de novo.'
  }
}

// ── A SENHA PEDIDA ANTES DE APAGAR ─────────────────────────────────────────
//
// ⚠️ O QUE ESTA SENHA É, PARA NINGUÉM SE ENGANAR DEPOIS: ela é FRICÇÃO contra
// quem senta num computador destravado e sai clicando — e contra o próprio dono
// apertando "excluir" sem pensar. **Ela NÃO é cofre.** Quem quiser mesmo chamar
// `vessel_excluir_lote` sem passar por aqui abre o console e chama, e é por isso
// que quem manda de verdade é o PORTÃO DO BANCO: `is_vessel_admin()` por dentro
// da função, mais o `revoke`/`grant` de quem pode executá-la. A tela é a porta
// da frente; a tranca é lá dentro.
//
// AS FRASES SÃO PRÓPRIAS, e não as de `frota/assinar-checklist.js`, que responde
// aos MESMOS códigos da edge `conferir-senha`: as de lá terminam em "o checklist
// ainda não foi gravado, você vai precisar preencher outra vez", que numa tela de
// etiqueta é conselho sobre uma coisa que não existe.
export function fraseDaSenha(codigo) {
  switch (codigo) {
    case 'senha_incorreta':
      return 'Senha incorreta. Nada foi apagado. É a mesma senha com que você entra no aplicativo.'
    case 'bloqueado':
      return 'Muitas tentativas com senha errada. Espere dez minutos e tente de novo. Nada foi apagado.'
    case 'sem_senha':
      return 'Digite sua senha para confirmar. É a mesma senha com que você entra no aplicativo.'
    case 'sem_sessao':
      return 'Seu acesso expirou. Saia e entre de novo no aplicativo. Nada foi apagado.'
    default:
      // 'falha_interna', erro de rede, resposta que não deu para ler: todos têm
      // a mesma orientação honesta — não sabemos, e nada foi apagado.
      return 'Não consegui conferir sua senha agora. Confira a conexão e tente de novo. Nada foi apagado.'
  }
}

const COLUNAS = [
  ['codigo', 'codigo'],
  ['nome', 'nome'],
  ['whatsapp', 'whatsapp'],
  ['onde_comprou', 'onde comprou'],
  ['comprado_em', 'comprado em'],
  ['garantia_ate', 'garantia ate'],
]

// Excel em português abre CSV separado por PONTO-E-VÍRGULA. Com vírgula, a
// planilha inteira cai numa coluna só.
function celula(valor) {
  const texto = valor == null ? '' : String(valor)
  if (!/[;"\n]/.test(texto)) return texto
  return `"${texto.replace(/"/g, '""')}"`
}

export function linhasDoCsv(registros) {
  const cabecalho = COLUNAS.map(([, rotulo]) => rotulo).join(';')
  const linhas = (Array.isArray(registros) ? registros : [])
    .map((r) => COLUNAS.map(([campo]) => celula(r[campo])).join(';'))
  return [cabecalho, ...linhas].join('\n')
}

// ── A LISTA INTEIRA DO LOTE ────────────────────────────────────────────────
// Depois de gravar e costurar, ninguém consegue responder "qual link ficou na
// bolsa nº 7". Estas três contas são o que responde.

// AS PEÇAS EM ORDEM DE SÉRIE. O banco não devolve ordenado, e a lista é lida
// procurando um número: fora de ordem, ninguém acha.
// O `slice()` antes do `sort` não é enfeite: `sort` ordena NO LUGAR, e ordenar
// o array que veio da tela mexeria na lista que o Vue está desenhando.
export function pecasEmOrdem(pecas) {
  return (Array.isArray(pecas) ? pecas : []).slice()
    .sort((a, b) => (a.numero_na_serie || 0) - (b.numero_na_serie || 0))
}

// O ESTADO DE UMA PEÇA, numa palavra só. A ORDEM DAS PERGUNTAS IMPORTA: peça
// baixada pode ter sido gravada ANTES da baixa, e mostrá-la como "gravada" faria
// alguém procurar dentro de uma bolsa que foi dada como refugo. A baixa é a
// última coisa que aconteceu com a peça, então é ela que a tela diz.
// O selo sai das classes prontas do PADRAO-DA-CENTRAL, nunca de cor à mão.
export function estadoDaPeca(peca) {
  const p = peca || {}
  if (p.baixada) return { chave: 'baixada', rotulo: 'Baixada', selo: 'selo-atencao' }
  if (p.gravada_em) return { chave: 'gravada', rotulo: 'Gravada', selo: 'selo-ok' }
  return { chave: 'pendente', rotulo: 'Pendente', selo: 'selo-neutro' }
}

// O NÚMERO DE SÉRIE VEM PRIMEIRO, e o número da peça CONTINUA na segunda coluna.
// Ele não é redundância (PADRÃO item 8): o número de série carrega a referência
// INTEIRA colada na sequência, e o número da peça é o que casa com a ordem de
// produção antiga, que foi arquivada antes desta entrega.
const COLUNAS_DO_LOTE = ['numero de serie', 'numero', 'codigo', 'endereco', 'estado',
  'gravada em', 'motivo da baixa']

// A LISTA PARA ARQUIVAR JUNTO DA ORDEM DE PRODUÇÃO.
//
// ELA NÃO É `listaParaGravadorDeMesa` (nfc-fila.js), e as duas existem de
// propósito: aquela é a FILA DO QUE FALTA — alimenta a máquina, e por isso tira
// as gravadas e as baixadas. Esta CONTA A HISTÓRIA — sai com todas as peças, na
// ordem da série, com endereço e estado, porque quem arquiva precisa saber o que
// aconteceu com cada número. Juntar as duas numa só faria a máquina regravar
// etiqueta já gravada.
//
// A DATA ENTRA POR PARÂMETRO: formatar data é conta de fuso, e o fuso da Central
// mora na tela (`dataCurta`, em America/Sao_Paulo). Escrevendo uma segunda aqui,
// o arquivo sairia com a data de um dia e a tela com a de outro.
// A REFERÊNCIA ENTRA POR PARÂMETRO pelo mesmo motivo que a data: ela é do LOTE,
// e esta conta recebe as PEÇAS. Sem ela a coluna do número de série sai vazia —
// que é o certo, e nunca "null": lote sem referência não tem número de série.
export function linhasDaListaDoLote(pecas, {
  formatarData = (v) => (v == null ? '' : String(v)), sku = '',
} = {}) {
  const linhas = pecasEmOrdem(pecas).map((p) => {
    const estado = estadoDaPeca(p)
    return [
      numeroDeSerie(sku, p.numero_na_serie),
      p.numero_na_serie ?? '',
      p.codigo ?? '',
      enderecoDaTag(p.codigo),
      estado.rotulo,
      p.gravada_em ? formatarData(p.gravada_em) : '',
      p.baixada ? rotuloDoMotivo(p.baixa_motivo) : '',
    ].map(celula).join(';')
  })
  return [COLUNAS_DO_LOTE.join(';'), ...linhas].join('\n')
}

// ── TODOS OS NÚMEROS DE SÉRIE JÁ ATIVOS ────────────────────────────────────
//
// Pedido do dono em 07/09/2026, para a aba Etiquetas: uma planilha com os
// números de série que estão NO MUNDO, e não os de um lote só.
//
// ⚠️ "ATIVO" AQUI É O MESMO "ativa" DA ABA, e não uma definição nova: peça
// GRAVADA (a aba só mostra gravadas) e NÃO BAIXADA. Uma peça baixada teve a
// etiqueta desfeita ou a bolsa descartada — o número dela existe no histórico,
// mas não está numa bolsa na rua, e misturar as duas coisas numa lista chamada
// "ativos" faria a contagem mentir. As baixadas continuam saindo na lista do
// LOTE, que conta a história inteira.
//
// ⚠️ A REFERÊNCIA VEM DO LOTE, não da peça: é dela que sai o número de série, e
// sem lote não há número. Peça órfã (lote apagado) entra com número VAZIO em vez
// de sumir da lista — sumir calada esconderia um defeito de dado.
export const COLUNAS_DOS_ATIVOS = ['numero de serie', 'modelo', 'cor', 'referencia',
  'numero da peca', 'codigo', 'endereco', 'gravada em', 'tem garantia']

export function linhasDosNumerosAtivos(pecas, {
  loteDaPeca = () => null,
  comGarantia = new Set(),
  formatarData = (v) => (v == null ? '' : String(v)),
} = {}) {
  const ativas = (Array.isArray(pecas) ? pecas : [])
    .filter((p) => p && p.gravada_em && !p.baixada)
  const linhas = ativas.map((p) => {
    const lote = loteDaPeca(p.lote_id) || {}
    const codigo = String(p.codigo ?? '').trim().toUpperCase()
    return [
      numeroDeSerie(lote.sku, p.numero_na_serie),
      lote.modelo ?? '',
      lote.cor ?? '',
      lote.sku ?? '',
      p.numero_na_serie ?? '',
      p.codigo ?? '',
      enderecoDaTag(p.codigo),
      p.gravada_em ? formatarData(p.gravada_em) : '',
      comGarantia.has(codigo) ? 'sim' : 'nao',
    ]
  })
  // ORDENADO PELO NÚMERO DE SÉRIE, que é por onde se procura: assim as peças do
  // mesmo produto ficam juntas e em sequência, como na ordem de produção.
  linhas.sort((a, b) => String(a[0]).localeCompare(String(b[0]), 'pt-BR'))
  return [COLUNAS_DOS_ATIVOS, ...linhas]
}

// ── EDITAR ETIQUETA JÁ GRAVADA ─────────────────────────────────────────────
// Consertar o que foi gravado errado. Do outro lado de cada uma destas contas
// há uma etiqueta costurada dentro de uma bolsa de couro, que não se descosê.

// OS CÓDIGOS QUE TÊM GARANTIA DE UMA CLIENTE. Sai de `vessel_registros`, que a
// tela já lê para a aba Registros — não é leitura nova.
//
// A COMPARAÇÃO É EM MAIÚSCULAS dos DOIS lados: o banco guarda o código já em
// maiúsculas (`upper(trim(...))` em toda função), mas quem monta o conjunto aqui
// é a tela, e um código em caixa baixa vindo de um registro antigo faria a peça
// de uma cliente aparecer SEM a marca de garantia — e a tela deixaria apagar a
// gravação dela sem pedir motivo.
export function codigosComGarantia(registros) {
  return new Set((Array.isArray(registros) ? registros : [])
    .map((r) => String(r?.codigo ?? '').trim().toUpperCase())
    .filter(Boolean))
}

// AS PEÇAS JÁ GRAVADAS, que são as únicas que a aba Etiquetas pode consertar.
//
// A ORDEM MUDA COM O FILTRO, de propósito:
//  · com um lote escolhido, ordena pela SÉRIE — é assim que se procura a peça
//    nº 7 dentro de um lote de 50;
//  · sem filtro, a mais recente primeiro — quem abre a aba sem filtrar acabou
//    de gravar errado e quer desfazer, e a peça dele é a última da lista.
// A BAIXADA CONTINUA NA LISTA: ela pode ter sido gravada ANTES da baixa, e
// `vessel_desmarcar_gravada` funciona nela. Tirá-la daqui esconderia justamente
// a peça que foi baixada por engano depois de gravada.
export function etiquetasGravadas(pecas, loteId = null) {
  const lista = (Array.isArray(pecas) ? pecas : [])
    .filter((p) => p && p.gravada_em && (!loteId || p.lote_id === loteId))
  if (loteId) return lista.slice().sort((a, b) => (a.numero_na_serie || 0) - (b.numero_na_serie || 0))
  return lista.slice().sort((a, b) => String(b.gravada_em).localeCompare(String(a.gravada_em))
    || (a.numero_na_serie || 0) - (b.numero_na_serie || 0))
}

// ── A ÁRVORE DA ABA ETIQUETAS ──────────────────────────────────────────────
// O lote é a linha principal e as etiquetas dele ficam dentro, para abrir.
// Pedido do dono em 04/09/2026: "mostrar os lotes com opção de expandir as
// etiquetas".
//
// A ORDEM QUE CHEGA É PRESERVADA. `etiquetasGravadas` já ordena por gravação
// mais recente, e o lote herda a posição da sua etiqueta mais nova: reordenar
// aqui faria a lista pular de lugar entre uma busca e outra, e o olho perde a
// peça que estava seguindo.
export function agruparPorLote(etiquetas, { loteDaPeca = () => null, totalDoLote = () => 0 } = {}) {
  const grupos = new Map()
  for (const p of (Array.isArray(etiquetas) ? etiquetas : [])) {
    if (!p) continue
    const lote = loteDaPeca(p.lote_id) || { id: p.lote_id }
    const chave = lote.id ?? p.lote_id ?? '(sem lote)'
    if (!grupos.has(chave)) grupos.set(chave, { chave, lote, etiquetas: [] })
    grupos.get(chave).etiquetas.push(p)
  }
  return [...grupos.values()].map((g) => ({
    ...g,
    gravadas: g.etiquetas.length,
    total: totalDoLote(g.lote?.id) || g.etiquetas.length,
  }))
}

// ⚠️ ÁRVORE FECHADA COM BUSCA ATIVA PARECE QUE NÃO ACHOU NADA — e é o defeito
// mais provável de uma tela assim. Quem digita um código vê uma linha de lote
// fechada e conclui que a busca quebrou, com a peça ali dentro.
//
// Também abre quando há UM lote só: uma árvore de uma linha fechada é uma tela
// escondendo tudo o que tem para mostrar.
export function abrirPorPadrao(grupos, { buscando = false } = {}) {
  const lista = Array.isArray(grupos) ? grupos : []
  if (buscando) return lista.map((g) => g.chave)
  return lista.length === 1 ? [lista[0].chave] : []
}

// "2 de 12 gravadas" — a conta do cabeçalho do lote.
export function contagemDoGrupo(grupo) {
  const g = grupo || {}
  const total = Number(g.total || 0)
  const gravadas = Number(g.gravadas || 0)
  return total > gravadas ? `${gravadas} de ${total} gravadas` : `${gravadas} gravada${gravadas === 1 ? '' : 's'}`
}

// QUANDO O MOTIVO ESCRITO É OBRIGATÓRIO.
//
// A TELA PRECISA SABER ANTES DO BANCO. As duas funções novas recusam com
// `motivo_obrigatorio` quando falta motivo numa peça com garantia — mas deixar o
// banco dar a bronca faz a pessoa apertar o botão, esperar a rede e só então
// descobrir que faltava um campo que estava na tela o tempo todo.
//
// SÃO DOIS CASOS, e o segundo não é sobre garantia nenhuma:
//  1. a peça TEM garantia registrada por uma cliente — desmarcar a gravação de
//     uma bolsa que já está com alguém é decisão, e decisão sem motivo escrito
//     vira mistério em três meses;
//  2. o destino da peça antiga é 'baixa' — aí o motivo não é texto de
//     auditoria: ele vai para `vessel_baixas.motivo`, que tem `check`, e sem
//     ele o banco recusa com `motivo_invalido`.
export function motivoObrigatorio({ temGarantia = false, destino = null } = {}) {
  return Boolean(temGarantia) || destino === 'baixa'
}

// QUAL PEÇA ESTÁ NESTA ETIQUETA, em uma linha que se lê em voz alta na bancada.
//
// O CÓDIGO SOZINHO NÃO SERVE. Quem está com a etiqueta na mão e vai decidir se
// sobrescreve precisa saber QUAL BOLSA está prestes a perder a identidade —
// "K7M4X9QP2R" não é bolsa nenhuma; "Mônaco · Quartz · nº 7" é.
// Cada pedaço que faltar simplesmente não entra, em vez de virar "undefined" ou
// um "—" que a pessoa lê como se fosse o nome do modelo.
export function descricaoDaPeca(peca, lote) {
  const p = peca || {}
  const l = lote || {}
  const partes = []
  if (l.modelo) partes.push(String(l.modelo))
  if (l.cor) partes.push(String(l.cor))
  // O NÚMERO DE SÉRIE quando o lote tem referência; o `nº 7` de sempre quando
  // não tem. Quem está com a etiqueta na mão vai comparar com o número IMPRESSO
  // na bolsa, e o impresso é o de série.
  const serie = rotuloDaSerie(p, l)
  if (serie) partes.push(serie)
  const codigo = String(p.codigo ?? '').trim().toUpperCase()
  if (!partes.length) {
    // peça que a tela não conhece: nunca inventar modelo. Dizer só o código, e
    // dizer que não se sabe de qual lote ele é, é a verdade inteira.
    return codigo ? `código ${codigo} (não achei o lote dele nesta tela)` : 'peça desconhecida'
  }
  return codigo ? `${partes.join(' · ')} — ${codigo}` : partes.join(' · ')
}

export function resumoDeAlertas(alertas) {
  const repetidas = alertas?.repetidas?.length || 0
  const invalidas = alertas?.invalidas?.length || 0
  // A PEÇA BAIXADA QUE FOI LIDA É O ALERTA MAIS IMPORTANTE DESTE PROJETO: a
  // bolsa foi dada como extraviada e alguém encostou o celular nela depois
  // disso. Sem contar aqui, a aba dizia "nada suspeito" com uma bolsa
  // extraviada reaparecendo no mundo — e a tela nunca mente.
  const baixadasLidas = alertas?.baixadas_lidas?.length || 0
  return {
    repetidas,
    invalidas,
    baixadasLidas,
    limpo: repetidas === 0 && invalidas === 0 && baixadasLidas === 0,
  }
}
