// AS REGRAS DA FILA DE GARANTIAS — puras, sem DOM e sem rede.
//
// ── POR QUE EXISTE UMA FILA ────────────────────────────────────────────────
//
// A tag NFC nao tem senha: quem encosta o celular na bolsa abre a pagina. Ate
// 03/09/2026, registrar a garantia era "quem chegar primeiro leva" — qualquer
// pessoa que segurasse a bolsa punha o nome dela, e a dona de verdade lia "ja
// registrada" e ficava sem garantia.
//
// A prova de que a bolsa e sua nao e TER A BOLSA NA MAO — o ladrao tambem tem.
// E ter COMPRADO. Entao o sistema procura a compra no Bling: bateu, a garantia
// entra na hora; nao bateu, o pedido cai NESTA fila e uma pessoa decide.
//
// ⚠️ "NAO BATEU" NAO QUER DIZER "MENTIU". Quem comprou em feira, ganhou de
// presente, comprou de revenda, ou teve o pedido lancado sem CPF cai aqui — e e
// a maioria dos casos honestos. A tela toda e escrita partindo disso: a fila e
// para CONFERIR, nao para acusar.

export const ESTADOS = {
  pendente: 'Esperando você',
  aprovado: 'Aprovado',
  recusado: 'Recusado',
}

export const naFilaDeGarantia = (p) => (p || {}).estado === 'pendente'

// A fila do dono: so o que espera decisao, do mais ANTIGO para o mais novo.
// ⚠️ A ORDEM E DE PROPOSITO O CONTRARIO DA LISTA DE REGISTROS. Ali o mais novo
// em cima responde "o que aconteceu agora"; aqui em cima fica quem espera ha
// mais tempo, que e quem esta sem a garantia dela ha mais tempo.
export function filaDeGarantia(pedidos) {
  return (Array.isArray(pedidos) ? pedidos : [])
    .filter(naFilaDeGarantia)
    .sort((a, b) => String(a.criado_em || '').localeCompare(String(b.criado_em || '')))
}

// O QUE A CONFERENCIA DISSE, em portugues.
//
// ⚠️ O PEDIDO PENDENTE NAO DIZ "NAO ENCONTRAMOS A COMPRA" e sim o que se sabe:
// que ninguem casou ainda. "Nao encontramos" soa a acusacao, e quem le isso
// vinte vezes por semana comeca a recusar por reflexo.
export function fraseDaConferencia(pedido) {
  const p = pedido || {}
  const nota = p.conferencia || {}
  if (p.decidido_por_que === 'bling' && nota.pedido) {
    return `Compra conferida: pedido ${nota.pedido} no Bling.`
  }
  if (p.decidido_por_que === 'na_mao') {
    return p.estado === 'recusado' ? 'Recusado por uma pessoa.' : 'Aprovado por uma pessoa.'
  }
  if (p.estado === 'pendente') {
    return 'Não achamos a compra pelo CPF — pode ser feira, presente, revenda, '
      + 'ou pedido lançado sem CPF. Confira antes de decidir.'
  }
  return ''
}

// O CAMINHO DE CONFERIR NA MAO, quando o automatico nao achou. Nao e enfeite:
// sem ele, "confira antes de decidir" e um conselho sem lugar para ir.
export function comoConferir(pedido, lote) {
  const p = pedido || {}
  const l = lote || {}
  return [
    p.whatsapp ? `Chame no WhatsApp ${p.whatsapp} e pergunte onde comprou.` : null,
    // "informou" e nao "escreveu": desde 05/09/2026 ela ESCOLHE numa lista de
    // lojas na maioria dos casos, e so escreve quando marca "outro lugar".
    p.onde_comprou ? `Ela informou que comprou em: ${p.onde_comprou}.` : null,
    l.modelo ? `Procure no Bling uma venda de ${l.modelo} para este CPF.` : null,
    p.comprado_em ? `Ela informou a compra em ${p.comprado_em}.` : null,
  ].filter(Boolean)
}

// AS RECUSAS DO BANCO, em frases. Sem isto a pessoa le a chave tecnica.
//
// ⚠️ ESTA LISTA ACOMPANHA os `return json_build_object('ok', false, ...)` de
// `vessel_decidir_pedido_de_registro` e `vessel_trocar_dono`. Motivo novo la
// sem frase aqui cai no `default`, e a pessoa le "Não foi possível" sem saber o
// que fazer. Ha teste que varre os dois arquivos e reprova quem esquecer.
export function fraseDaRecusaDeGarantia(motivo, extra = {}) {
  switch (motivo) {
    case 'sem_permissao':
      return 'Você não tem permissão para decidir garantias. Fale com o administrador.'
    case 'ja_decidido':
      return `Este pedido já foi ${extra.estado === 'recusado' ? 'recusado' : 'aprovado'}. `
        + 'Atualize a lista para ver como ele está agora.'
    case 'pedido_nao_existe':
      return 'Este pedido não existe mais. Atualize a lista.'
    case 'motivo_obrigatorio':
      return 'Escreva o motivo. Ele fica no histórico da peça, e é o que explica a decisão depois.'
    case 'confirmacao_nao_bate':
      return 'O código digitado não é o desta etiqueta. Confira e digite de novo.'
    case 'cpf_invalido':
      return 'Confira o CPF — parece que faltou ou sobrou um número.'
    case 'dados_invalidos':
      return 'Confira o nome e o WhatsApp (com DDD, só números).'
    case 'nao_tem_dono':
      return 'Esta peça ainda não tem dono registrado, então não há de quem trocar.'
    case 'estado_invalido':
    case 'origem_invalida':
    case 'conferencia_sem_pedido':
      return 'A tela mandou um pedido que o banco não entendeu. Avise quem cuida do sistema.'
    default:
      return 'Não foi possível concluir. Tente de novo.'
  }
}

// ── O CPF, DO LADO DO PAINEL ───────────────────────────────────────────────
// ⚠️ ESTA CONTA MORA EM TRES LUGARES: aqui, em `vessel_cpf_valido` (banco) e em
// `vessel-brasil/verify/regras.js` (pagina da cliente). Quem manda e o banco —
// as outras duas existem para avisar o erro de digitacao ANTES da viagem ate o
// servidor. Divergindo, a tela aceita o que o banco recusa, e a pessoa fica
// olhando um erro que ela nao consegue explicar.
export function cpfLimpo(texto) {
  return String(texto ?? '').replace(/\D/g, '')
}

export function cpfValido(texto) {
  const v = cpfLimpo(texto)
  if (v.length !== 11) return false
  // os onze digitos repetidos PASSAM na conta — sao o CPF falso de sempre
  if (/^(\d)\1{10}$/.test(v)) return false
  const digito = (ate) => {
    let s = 0
    for (let i = 0; i < ate; i++) s += Number(v[i]) * (ate + 1 - i)
    const d = 11 - (s % 11)
    return d >= 10 ? 0 : d
  }
  return digito(9) === Number(v[9]) && digito(10) === Number(v[10])
}

export function cpfComMascara(texto) {
  const v = cpfLimpo(texto).slice(0, 11)
  if (v.length <= 3) return v
  if (v.length <= 6) return `${v.slice(0, 3)}.${v.slice(3)}`
  if (v.length <= 9) return `${v.slice(0, 3)}.${v.slice(3, 6)}.${v.slice(6)}`
  return `${v.slice(0, 3)}.${v.slice(3, 6)}.${v.slice(6, 9)}-${v.slice(9)}`
}

// TROCAR O DONO SO SAI COM AS TRES COISAS. A tela desabilita o botao com isto,
// e o banco recusa de novo — as duas travas, porque a de tela e conforto e a do
// banco e a que vale.
export function podeTrocarDono(campos, codigoDaPeca) {
  const c = campos || {}
  return String(c.nome || '').trim().length >= 2
    && cpfValido(c.cpf)
    && [10, 11].includes(cpfLimpo(c.whatsapp).length)
    && String(c.motivo || '').trim().length > 0
    && String(c.confirmacao || '').trim().toUpperCase() === String(codigoDaPeca || '').toUpperCase()
}
