/* O nº de patrimônio na Frota, e o que a sincronia com o Patrimônio fez.
 *
 * Desenho: docs/superpowers/specs/2026-08-20-frota-patrimonio-via-de-mao-dupla-design.md
 *
 * Separado da tela por ser regra pura, testável sem montar componente. E a
 * FRASE mora aqui, não no banco, por um motivo prático: frase em SQL não se
 * testa sem subir Postgres. O banco devolve um código (`fez`), este arquivo
 * vira português, e o português fica travado em teste. */

/** A placa do jeito que o banco guarda: maiúscula, só letra e número.
 *  Era conta inline do `salvarVeiculo`; ganhou dono quando o Patrimônio passou
 *  a precisar da MESMA. Placa é UNIQUE — normalizar diferente nos dois lados
 *  criaria carro duplicado por causa de um hífen. */
export function normalizarPlaca(texto) {
  return String(texto || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/**
 * O nº de patrimônio digitado vira número — ou vira um erro em português.
 *
 * O dono decidiu (20/08/2026) que este campo é OBRIGATÓRIO no cadastro: é ele
 * que faz o item nascer no Patrimônio, e sem ele o carro fica órfão como os
 * três KWIDs ficaram.
 */
export function validarEtiqueta(texto, { obrigatoria = true } = {}) {
  const cru = String(texto ?? '').trim()
  if (!cru) {
    return obrigatoria
      ? { ok: false, numero: null, erro: 'Informe o nº de patrimônio — é ele que cria o item no Patrimônio.' }
      : { ok: true, numero: null, erro: null }
  }
  if (!/^\d+$/.test(cru)) {
    return { ok: false, numero: null, erro: 'O nº de patrimônio é só número. Ex.: 298' }
  }
  const n = parseInt(cru, 10)
  // A numeração começa em 1. "0" digitado por engano viraria um item nº 0, que
  // nenhuma etiqueta impressa carrega.
  if (!(n >= 1)) {
    return { ok: false, numero: null, erro: 'O nº de patrimônio começa em 1.' }
  }
  return { ok: true, numero: n, erro: null }
}

/**
 * O número escondido dentro do `codigo_patrimonial` que já existe na ficha.
 *
 * ESTE CAMPO TEM DUAS ESPÉCIES DE CONTEÚDO, medidas em 20/08/2026: os três
 * KWIDs novos carregam o número da etiqueta em texto ("298", "299", "300"),
 * e os nove carros antigos carregam o código interno da Frota ("RBB-004"),
 * que não é etiqueta de patrimônio nenhuma.
 *
 * Só o que for número puro vira sugestão. "RBB-004" devolve `null` — sugerir
 * o 4 dali seria inventar uma etiqueta que ninguém colou, e o 4 é um Macbook.
 */
export function etiquetaDoCodigo(codigo) {
  const cru = String(codigo ?? '').trim()
  if (!/^\d+$/.test(cru)) return null
  const n = parseInt(cru, 10)
  return n >= 1 ? n : null
}

/* COMO O CARRO FICA. Uma pergunta só, com as quatro respostas que o dono usou
 * ao pedir: "se ele vai ficar livre, parado, com responsável ou em manutenção".
 *
 * Não é coluna nova: são as duas que já existem (`situacao` e `pessoa_id`)
 * apresentadas do jeito que a pessoa pensa. "Livre" e "com responsável" são o
 * MESMO `situacao='ativo'` — o que muda é ter dono fixo ou não. */
export const COMO_FICA = [
  { chave: 'livre', rotulo: 'Livre para quem precisar', situacao: 'ativo', pedePessoa: false },
  { chave: 'responsavel', rotulo: 'Fixo com uma pessoa', situacao: 'ativo', pedePessoa: true },
  { chave: 'parado', rotulo: 'Parado', situacao: 'inativo', pedePessoa: false },
  { chave: 'manutencao', rotulo: 'Em manutenção', situacao: 'em_manutencao', pedePessoa: false },
]

/** A escolha da pessoa vira os dois campos do banco. Escolha desconhecida
 *  devolve `null` — quem chama trata como "não respondeu", nunca chuta 'ativo'
 *  (chutar faria um carro parado nascer disponível pra qualquer um pegar). */
export function comoFicaParaDados(chave, pessoaId) {
  const opcao = COMO_FICA.find((o) => o.chave === chave)
  if (!opcao) return null
  return {
    situacao: opcao.situacao,
    pessoa_id: opcao.pedePessoa ? (pessoaId || null) : null,
  }
}

/**
 * Tudo que o cadastro exige, numa conta só. Devolve a LISTA de erros, e vazia
 * significa "pode gravar".
 *
 * Obrigatórios por decisão do dono (20/08/2026): nome, placa, nº de patrimônio
 * e como o carro fica. E "fixo com uma pessoa" sem a pessoa escolhida é
 * resposta pela metade — deixaria o carro com dono fixo NENHUM, que é
 * exatamente "livre" com outro nome.
 */
export function validarCadastro(form) {
  const f = form || {}
  const erros = []
  if (!String(f.nome || '').trim()) erros.push('Dê um nome ao veículo.')
  if (!normalizarPlaca(f.placa)) erros.push('Informe a placa — é por ela que o carro é reconhecido.')

  const et = validarEtiqueta(f.etiqueta, { obrigatoria: true })
  if (!et.ok) erros.push(et.erro)

  const opcao = COMO_FICA.find((o) => o.chave === f.comoFica)
  if (!opcao) erros.push('Diga como o carro fica: livre, fixo com alguém, parado ou em manutenção.')
  else if (opcao.pedePessoa && !f.pessoa_id) erros.push('Escolha a pessoa que fica com o carro.')

  return erros
}

/* "Item" e não "bem" de propósito: é a palavra que a tela do Patrimônio usa
 * com quem cadastra. */
const FRASES = {
  criou_os_dois: (p, e) => `Criei o veículo ${p} e o item nº ${e} no Patrimônio, já ligados.`,
  criou_bem: (p, e) => `Criei o item nº ${e} no Patrimônio e liguei ao veículo ${p}.`,
  criou_carro: (p, e) => `Criei o veículo ${p} na Frota e liguei ao item nº ${e} do Patrimônio.`,
  ligou: (p, e) => `Liguei o veículo ${p} ao item nº ${e} do Patrimônio.`,
  ja_ligados: (p, e) => `O veículo ${p} e o item nº ${e} já estavam ligados.`,
}

/**
 * O que a pessoa lê depois de salvar. NUNCA um "sincronizado!" genérico: ela
 * precisa saber se nasceu ficha nova ou se só amarrou o que já existia — é a
 * diferença entre "criei um carro" e "achei o carro que você já tinha".
 *
 * Devolve `null` quando a resposta não dá pra afirmar nada (código
 * desconhecido, placa ou número faltando). Tela calada é melhor que tela
 * afirmando o que talvez não tenha acontecido.
 */
export function fraseDaSincronia(resposta) {
  const r = resposta || {}
  const monta = FRASES[r.fez]
  if (!monta) return null
  const placa = String(r.placa || '').trim()
  const etiqueta = r.etiqueta
  if (!placa || !Number.isInteger(etiqueta)) return null
  return monta(placa, etiqueta)
}

/**
 * O aviso sobre o número que a pessoa acabou de digitar, vindo de
 * `etiqueta_quem_e` no banco. É o que substituiu a sugestão de número: em vez
 * de a tela escolher, ela conta a verdade sobre o que foi escolhido.
 *
 * `tom` usa o MESMO vocabulário de `fr-prova-frase`, que já existe nesta tela:
 * 'ruim' barra o caminho, 'atencao' avisa, 'boa' confirma. Reusar as classes de
 * lá em vez de inventar um aviso novo mantém os dois avisos da Frota com a
 * mesma cara — e herda o acerto delas: fundo colorido por `color-mix` com texto
 * em `var(--text)`, porque texto laranja pequeno sobre a superfície reprova no
 * contraste (PADRAO-DA-CENTRAL.md, seção 2).
 *
 * Resposta que não dá pra ler devolve `null` — sem inventar.
 */
export function avisoDaEtiqueta(resposta, placaAtual) {
  const r = resposta || {}
  if (r.existe === false) {
    return { tom: 'boa', texto: 'Número livre. O item vai ser criado no Patrimônio.' }
  }
  if (r.existe !== true || !r.nome) return null

  if (!r.eh_veiculo) {
    return {
      tom: 'ruim',
      texto: `Este número é de "${r.nome}"${r.categoria ? ` (${r.categoria})` : ''}, `
        + 'que não é veículo. Confira o adesivo.',
    }
  }
  const ligada = String(r.placa_ligada || '').trim()
  if (ligada && ligada !== normalizarPlaca(placaAtual)) {
    return { tom: 'ruim', texto: `Este número já é do veículo ${ligada}. Confira o adesivo.` }
  }
  if (ligada) {
    return { tom: 'boa', texto: `Já é este veículo no Patrimônio ("${r.nome}").` }
  }
  return { tom: 'atencao', texto: `Vou ligar ao item "${r.nome}", que já existe no Patrimônio.` }
}
