// LER QUALQUER ETIQUETA — a leitura que não sabe de antemão o que vai achar.
//
// A aba Gravar já sabe ler, mas sempre CONFERINDO contra uma peça escolhida
// antes (`conferirLeitura` em `nfc-fila.js`). Aqui é o contrário: encosta-se a
// etiqueta sem escolher nada, e é ela quem diz quem é.
//
// Contas puras — sem DOM, sem rede, sem NDEFReader. É aqui que mora a ordem do
// reset, e essa ordem precisa ser provável sem chip na mão.
import { codigoDoEndereco } from './nfc-fila.js'

// ── O QUE A ETIQUETA É ─────────────────────────────────────────────────────
// 'vazia'        → chip em branco, pronto para gravar
// 'nao-e-vessel' → tem alguma coisa escrita, mas não é endereço do selo
// 'desconhecida' → é endereço nosso, com código que este sistema não conhece
// 'conhecida'    → é nossa e sabemos de quem
export function classificarLeitura(lidoDaTag, acharPecaPeloCodigo) {
  const texto = String(lidoDaTag ?? '').trim()
  if (!texto) return { tipo: 'vazia' }

  const codigo = codigoDoEndereco(texto)
  if (!codigo) return { tipo: 'nao-e-vessel' }

  const peca = typeof acharPecaPeloCodigo === 'function' ? acharPecaPeloCodigo(codigo) : null
  return peca ? { tipo: 'conhecida', codigo, peca } : { tipo: 'desconhecida', codigo }
}

// ── O QUE A TELA PODE OFERECER ─────────────────────────────────────────────
// ⚠️ ETIQUETA VIRGEM E ETIQUETA DE TERCEIRO NÃO GANHAM AÇÃO NENHUMA. Oferecer
// "resetar" num chip em branco é oferecer o que já está feito; oferecer apagar
// um chip que não é nosso é dar poder de estragar coisa alheia por engano.
export function acoesDaLeitura(leitura, { podeMexer = false } = {}) {
  if (!podeMexer) return []
  if (leitura?.tipo === 'conhecida') return ['regravar', 'resetar']
  if (leitura?.tipo === 'desconhecida') return ['apagar-chip']
  return []
}

export function precisaConfirmarGarantia(leitura) {
  return leitura?.tipo === 'conhecida' && Boolean(leitura.peca?.tem_garantia)
}

// ── O RESET, E POR QUE O CHIP VEM PRIMEIRO ─────────────────────────────────
//
// A Gravar manda o banco decidir ANTES de escrever no chip. Aqui a ordem se
// inverte, e é a MESMA regra por trás das duas: nunca deixar um chip apontando
// para algo que o sistema não sustenta.
//
//   Soltando no banco primeiro, se o apagamento falhar sobra ETIQUETA ÓRFÃ —
//   um chip vivo apontando para um código que o sistema já não reconhece. Quem
//   encostar o celular vê página de erro, e ninguém aqui dentro fica sabendo.
//
//   Apagando o chip primeiro, o pior caso é o sistema achar que a peça está
//   gravada com o chip já em branco. Ninguém de fora vê, e a própria tela diz
//   o que fazer. Erro para dentro é sempre melhor que erro para fora.
export async function resetar({ leitura, apagarOChip, desmarcarNoBanco } = {}) {
  if (leitura?.tipo !== 'conhecida') {
    return { ok: false, estado: 'nao-da', frase: 'Só dá para resetar uma etiqueta que o sistema conhece.' }
  }

  try {
    await apagarOChip()
  } catch (e) {
    return {
      ok: false,
      estado: 'chip-intacto',
      frase: `Não consegui apagar a etiqueta: ${e?.message ?? e}. `
        + 'Nada foi alterado no sistema — a peça continua gravada e a etiqueta continua válida.',
    }
  }

  try {
    await desmarcarNoBanco(leitura.codigo)
  } catch (e) {
    return {
      ok: false,
      estado: 'pela-metade',
      frase: `A etiqueta foi apagada, mas o sistema ainda acha que esta peça está gravada `
        + `(${e?.message ?? e}). Aperte Resetar de novo para acertar o cadastro — `
        + 'a etiqueta já está em branco e apagar de novo não faz mal.',
    }
  }

  return { ok: true, estado: 'pronto', frase: 'Etiqueta apagada e peça solta no sistema.' }
}

// ── REGRAVAR: ESCREVE O MESMO CÓDIGO DE NOVO ───────────────────────────────
// Não toca no banco — a peça já é dona desta etiqueta. Serve para gravação que
// saiu pela metade. A LEITURA DE VOLTA É A PROVA: sem ela, "gravou" é só o que
// o programa acha que aconteceu.
export async function regravar({ leitura, gravarNoChip, lerDeVolta } = {}) {
  if (leitura?.tipo !== 'conhecida') {
    return { ok: false, frase: 'Só dá para regravar uma etiqueta que o sistema conhece.' }
  }

  try {
    await gravarNoChip(leitura.codigo)
  } catch (e) {
    return { ok: false, frase: `Não consegui gravar: ${e?.message ?? e}. A etiqueta ficou como estava.` }
  }

  let devolta
  try {
    devolta = await lerDeVolta()
  } catch (e) {
    return { ok: false, frase: `Gravei, mas não consegui reler para conferir: ${e?.message ?? e}. Encoste de novo.` }
  }

  const conferiu = codigoDoEndereco(devolta) === leitura.codigo
  return conferiu
    ? { ok: true, frase: 'Regravada e conferida: a etiqueta devolveu o mesmo código.' }
    : { ok: false, frase: 'Gravei, mas ao reler a etiqueta devolveu outra coisa. NÃO use esta bolsa antes de resolver.' }
}
