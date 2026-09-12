// Busca e filtros da lista de bens. Lógica pura: não toca banco nem DOM.
import { somarCentavos } from './patrimonio-lista.js'

// O estado inicial dos filtros da tela. Tudo vazio = "mostra tudo".
export const FILTRO_VAZIO = {
  busca: '',
  empresaId: '',
  localId: '',
  categoriaId: '',
  situacao: '',
  pessoaId: '',
  semDono: false,
}

// Tira acento e caixa dos dois lados da comparação. Sem isso, quem digita
// "televisao" no celular (sem til) não acha "Televisão".
// A faixa ̀-ͯ é a dos acentos que o normalize('NFD') separa da letra.
// Escrita com \u... de propósito: os caracteres crus são invisíveis no editor e
// somem em copy-paste.
export function normalizar(texto) {
  if (texto === null || texto === undefined) return ''
  return String(texto)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

// A busca livre varre o que está NO bem: nome, número da etiqueta, IMEI/número
// de série, marca/modelo, o nome solto do dono e a observação. O número entra
// porque é assim que se procura um bem com ele na mão: lendo a etiqueta colada
// nele.
//
// `textoExtra` é o que o bem NÃO carrega: o nome do colaborador, do local, do
// ambiente, da categoria. No banco o bem guarda só o identificador dessas
// coisas, então procurar por "erick" não achava nada — o nome dele não está no
// bem, está na tabela de pessoas. Quem chama resolve os nomes e passa aqui.
function casaBusca(bem, termo, textoExtra) {
  // `numero_serie` entra porque é o segundo jeito de identificar um aparelho com
  // ele na mão: quando a etiqueta caiu, sobra o IMEI atrás do celular.
  const partes = [bem.nome, bem.numero, bem.numero_serie, bem.marca, bem.dono_texto, bem.observacao]
  if (typeof textoExtra === 'function') partes.push(textoExtra(bem))
  const alvo = normalizar(partes.filter((v) => v !== null && v !== undefined && v !== '').join(' '))
  return alvo.includes(termo)
}

export function filtrarBens(bens, filtro, textoExtra) {
  const lista = Array.isArray(bens) ? bens : []
  const f = filtro || {}
  const termo = normalizar(f.busca)
  return lista.filter((bem) => {
    if (!bem) return false
    if (termo && !casaBusca(bem, termo, textoExtra)) return false
    if (f.empresaId && bem.empresa_id !== f.empresaId) return false
    if (f.localId && bem.local_id !== f.localId) return false
    if (f.categoriaId && bem.categoria_id !== f.categoriaId) return false
    if (f.situacao && bem.situacao !== f.situacao) return false
    if (f.pessoaId && bem.pessoa_id !== f.pessoaId) return false
    if (f.semDono && bem.pessoa_id) return false
    return true
  })
}

// Quantidade e total do que está na tela AGORA (já filtrado). Bem sem valor não
// entra na soma — "não informado" não é zero.
export function resumoDaLista(bens) {
  const lista = Array.isArray(bens) ? bens : []
  return { quantidade: lista.length, totalCentavos: somarCentavos(lista) }
}
