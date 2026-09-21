// OS LEMBRETES DO "DEIXAR PARA DEPOIS" — regras puras, sem DOM e sem rede.
//
// ── O QUE É ISTO ───────────────────────────────────────────────────────────
//
// A cliente abre o certificado de uma peça que ainda não tem dona, não quer
// registrar agora e deixa o e-mail. A marca manda DOIS e-mails — um em 7 dias,
// outro em 30 — cada um com o link daquela peça, e cada um com "não quero mais
// receber" em um toque, sem login.
//
// Esta tela é SÓ LEITURA nesta entrega: peça, e-mail, quando pediu, o que já
// foi enviado e o estado. Nenhum botão, nenhuma permissão nova — ela mora
// atrás do mesmo portão da tela de Autenticidade.
//
// A TABELA `vessel_lembretes` já está no ar (migration registrada em
// 21/09/2026, RLS conferida — SELECT para `authenticated` sob
// `is_vessel_admin()`, o mesmo portão de `vessel_pecas` e `vessel_registros`).
// A leitura continua defensiva mesmo assim: `tabelaAindaNaoExiste` separa "a
// tabela não existe" (PostgREST 42P01/PGRST205 — hoje não deveria mais
// acontecer, mas um deploy futuro sem a migration cairia aqui) de "o banco
// está fora do ar" — são coisas diferentes, e confundir as duas faria a tela
// dizer "logo aparece" para uma falha que ninguém está consertando.

// AS COLUNAS QUE A TELA PEDE. Escritas aqui, e não soltas no `select`, porque
// há teste que confere o que sai daqui.
//
// ⚠️ `token_hash` NÃO ESTÁ NA LISTA, e não é esquecimento: é a prova do link de
// cancelar que vai no e-mail. Ele não tem o que fazer no painel, e coluna que
// não se pede é coluna que não vaza.
export const COLUNAS_DO_LEMBRETE =
  'id,peca_codigo,email,criado_em,enviado_7_em,enviado_30_em,cancelado_em,cancelado_por'

// OS TRÊS ESTADOS DO DESENHO, mais o quarto que o desenho não prevê — a linha
// incoerente. Não é "mais um estado normal": é a tela recusando inventar uma
// resposta bonita para um dado que não devia existir.
export const ESTADOS_DO_LEMBRETE = {
  aberto: 'Aberto',
  cancelado_cliente: 'Cancelado pela cliente',
  encerrado_registro: 'Encerrado pelo registro',
  incoerente: 'Estado incoerente',
}

// ⚠️ NULO NÃO É FALSO. `cancelado_em` nulo com `cancelado_por` preenchido não
// existe hoje — a tabela só grava os dois juntos, no mesmo UPDATE — mas se
// aparecer (falha de robô, migration futura, mão na tabela) a tela NÃO pode
// chamar isso de "aberto" em silêncio: a linha está dizendo "foi cancelada"
// sem dizer quando, e "aberto" diria o oposto disso.
export function estadoDoLembrete(lembrete) {
  const l = lembrete || {}
  if (!l.cancelado_em && l.cancelado_por) return 'incoerente'
  if (!l.cancelado_em) return 'aberto'
  return l.cancelado_por === 'registro' ? 'encerrado_registro' : 'cancelado_cliente'
}

export function rotuloDoEstadoDoLembrete(lembrete) {
  return ESTADOS_DO_LEMBRETE[estadoDoLembrete(lembrete)]
}

// A COR DO ESTADO sai das classes prontas da casa (`.selo-*`,
// estilos-globais.css) — estado com cor inventada é o que o PADRAO-DA-CENTRAL
// proíbe no item 2.
//
// ⚠️ NENHUM DOS TRÊS ESTADOS DO DESENHO É ERRO. "Encerrado pelo registro" é o
// FINAL FELIZ: a cliente registrou a peça e o lembrete morreu sozinho, como o
// desenho manda. "Cancelado pela cliente" é ela exercendo o direito dela.
// Pintar qualquer um dos dois de vermelho faria a lista parecer cheia de
// problema. Já "incoerente" É para chamar atenção — por isso leva
// `selo-atencao` (laranja), a única cor de alarme desta lista.
const SELOS = {
  aberto: 'selo-info',
  cancelado_cliente: 'selo-neutro',
  encerrado_registro: 'selo-ok',
  incoerente: 'selo-atencao',
}

export function seloDoEstadoDoLembrete(estado) {
  return SELOS[estado] || 'selo-neutro'
}

// O QUE JÁ FOI ENVIADO, em português. "Só o de 30" não deveria acontecer — e é
// exatamente por isso que aparece escrito: se o robô pular o primeiro, quem
// olha a lista tem de conseguir ver.
export function enviosDoLembrete(lembrete) {
  const l = lembrete || {}
  const sete = Boolean(l.enviado_7_em)
  const trinta = Boolean(l.enviado_30_em)
  const texto = sete && trinta ? 'O de 7 e o de 30 dias'
    : sete ? 'O de 7 dias'
      : trinta ? 'Só o de 30 dias'
        : 'Nenhum ainda'
  return { sete, trinta, texto }
}

// AS LINHAS DA LISTA. Junta o lembrete com o modelo do lote da peça — e não
// inventa modelo para peça que a tela não conhece.
//
// A ordem é do MAIS NOVO para o mais antigo, igual à lista de registros: quem
// abre esta aba quer ver o que aconteceu agora.
export function linhasDeLembretes(lembretes, { pecas = [], lotes = [] } = {}) {
  if (!Array.isArray(lembretes)) return []
  const loteDaPeca = new Map()
  const porId = new Map((Array.isArray(lotes) ? lotes : []).map((l) => [l.id, l]))
  for (const p of Array.isArray(pecas) ? pecas : []) {
    loteDaPeca.set(p.codigo, porId.get(p.lote_id) || null)
  }
  return lembretes
    .slice()
    .sort((a, b) => String(b?.criado_em || '').localeCompare(String(a?.criado_em || '')))
    .map((l) => {
      const lote = loteDaPeca.get(l?.peca_codigo) || null
      return {
        id: l?.id,
        codigo: l?.peca_codigo || '',
        modelo: lote?.modelo || '',
        cor: lote?.cor || '',
        email: l?.email || '',
        criadoEm: l?.criado_em || '',
        envios: enviosDoLembrete(l),
        estado: estadoDoLembrete(l),
        rotuloDoEstado: rotuloDoEstadoDoLembrete(l),
      }
    })
}

// ── A TABELA QUE AINDA NÃO SUBIU ───────────────────────────────────────────
//
// O PostgREST reclama de duas formas: pelo código do Postgres (`42P01`,
// "undefined_table") e pelo cache de esquema dele (`PGRST205`), que responde
// com uma frase e sem o código do Postgres.
export function tabelaAindaNaoExiste(erro) {
  if (!erro) return false
  if (['42P01', 'PGRST205'].includes(erro.code)) return true
  const mensagem = String(erro.message || '')
  return /vessel_lembretes/.test(mensagem)
    && /(does not exist|schema cache|não existe)/i.test(mensagem)
}

// O AVISO DA LISTA. ⚠️ PADRAO-DA-CENTRAL, item 9: falha de leitura NÃO vira
// lista vazia. "Não há lembretes" numa leitura que falhou é a mentira mais cara
// que uma tela conta — então cada falha aparece com a cara dela.
export function avisoDaListaDeLembretes(erro) {
  if (!erro) return { tipo: '', texto: '' }
  if (tabelaAindaNaoExiste(erro)) {
    return {
      tipo: 'aguardando',
      texto: 'Os lembretes ainda não existem no banco. Assim que a parte do banco subir, '
        + 'eles aparecem aqui sozinhos.',
    }
  }
  return {
    tipo: 'erro',
    texto: `Não deu para ler os lembretes agora: ${erro.message || 'o banco não respondeu'}.`,
  }
}
