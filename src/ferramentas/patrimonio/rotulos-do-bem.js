// Como cada situação do bem aparece na tela, e quem está com ele.
// Lógica pura: não toca banco nem DOM.

// Os quatro valores são os mesmos do CHECK de patrimonio_bens.situacao
// (db/migrations/acessos/019_patrimonio_bens.sql). Mudar aqui exige mudar lá.
//
// `tom` é a cor da situação no filete do cartão (id-tom-<tom>, a mesma régua
// `--situacao-*` da Central inteira — Onda 2a da cor, 23/09/2026). Cada tom é
// o MESMO da pílula que já existia: verde em uso, azul em estoque, laranja em
// manutenção, cinza baixado. Mudar um sem o outro faz o filete e a pílula do
// mesmo cartão discordarem.
export const SITUACOES = [
  { valor: 'em_uso', rotulo: 'Em uso', classe: 'pat-pill-uso', tom: 'viva' },
  { valor: 'em_estoque', rotulo: 'Em estoque', classe: 'pat-pill-estoque', tom: 'andamento' },
  { valor: 'em_manutencao', rotulo: 'Em manutenção', classe: 'pat-pill-manutencao', tom: 'queda' },
  { valor: 'baixado', rotulo: 'Baixado', classe: 'pat-pill-baixado', tom: 'parada' },
]

// Situação que não conhecemos devolve o próprio valor em vez de sumir: se um dia
// alguém inserir um valor novo direto no banco, a tela mostra o que é, não um vazio.
export function rotuloDaSituacao(valor) {
  if (!valor) return '—'
  const achou = SITUACOES.find((s) => s.valor === valor)
  return achou ? achou.rotulo : String(valor)
}

export function classeDaSituacao(valor) {
  const achou = SITUACOES.find((s) => s.valor === valor)
  return achou ? achou.classe : 'pat-pill-neutro'
}

// Situação que não conhecemos fica cinza, como a pílula neutra dela.
export function tomDaSituacao(valor) {
  const achou = SITUACOES.find((s) => s.valor === valor)
  return achou ? achou.tom : 'parada'
}

// Quem está com o bem, nos três casos que o dado real produz:
//  1. colaborador cadastrado  -> o nome do cadastro (fonte de verdade)
//  2. só um nome solto        -> o nome, marcado como não cadastrado (vem da
//     importação da planilha, onde 10 nomes não existem no cadastro)
//  3. ninguém                 -> "Sem dono" (o caso mais comum: 88% dos bens)
//
// `listaFalhou` é o quarto caso, e existe porque a tela não pode mentir: a
// leitura de colaboradores é uma RPC que ESTOURA quando falta acesso, e aí o
// mapa chega vazio. Sem esta trava, todo bem que TEM dono passava a dizer
// "Pessoa removida" — afirmando que alguém saiu do cadastro quando a verdade é
// "não consegui ler a lista". É a mesma família do R$ 0,00 que ficou 17 horas
// na tela: falha de leitura virando fato.
export function textoDoDono(bem, pessoasById, listaFalhou = false) {
  const b = bem || {}
  const mapa = pessoasById || {}
  if (b.pessoa_id) {
    const p = mapa[b.pessoa_id]
    if (p && p.nome) return p.nome
    return listaFalhou ? 'Não consegui ler a lista de colaboradores' : 'Pessoa removida'
  }
  const solto = (b.dono_texto || '').trim()
  if (solto) return `${solto} (não cadastrada)`
  return 'Sem dono'
}

// Categorias em que o bem é de UMA pessoa. O resto (móvel, máquina, televisão)
// serve o LUGAR: a mesa da Produção está em uso e não é de ninguém.
// Esta lista é a mesma que decidiu a situação dos 341 bens na importação —
// mudar aqui sem mudar lá faz a tela discordar do que está gravado.
export const CATEGORIAS_PESSOAIS = [
  'Computadores e Periféricos',
  'Celulares e tablets',
  'Veículos',
]

// Dono é OPCIONAL em toda situação. Antes a tela BLOQUEAVA salvar "em uso" sem
// ninguém — regra que caiu quando o dono apontou que 104 móveis e 78 máquinas
// estavam em uso sem pertencer a pessoa alguma.
// Sobrou um AVISO, e só para aparelho pessoal: notebook "em uso" sem dono
// costuma ser esquecimento, mas quem sabe é quem está com a etiqueta na mão.
// Devolve o texto do aviso, ou null quando não há o que avisar.
export function avisoDeDonoVazio({ situacao, categoria, temDono }) {
  if (temDono) return null
  if (situacao !== 'em_uso') return null
  if (!categoria || !CATEGORIAS_PESSOAIS.includes(categoria)) return null
  return 'Este tipo de bem costuma ficar com uma pessoa, e este está em uso sem ninguém. Confere?'
}
