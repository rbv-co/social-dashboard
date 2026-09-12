// A FRASE DE UMA LINHA DA LISTA DE PESSOAS (D5 do desenho de 11/08/2026).
//
// A primeira versão deste resumo foi proposta DENTRO da ficha da pessoa,
// escondendo o detalhe — e o dono recusou: ele quer ver as 24 ferramentas.
// O resumo não estava errado, estava no lugar errado. Aqui ele responde "quem
// é essa pessoa aqui dentro" sem precisar abrir.
//
// A frase cita o que a pessoa MEXE, não o que ela lê: 7 dos recursos são
// vistos por 80-93% das pessoas (medido em 11/08/2026), então citá-los não
// diferencia ninguém.
import { mexeEmDinheiro } from './consequencia-do-recurso.js'

// Como se chama, em uma palavra, o assunto de cada ferramenta que dá poder.
// A ORDEM AQUI é a ordem em que os assuntos aparecem na frase — determinística,
// e não a ordem em que a pessoa (ou o banco) listou as chaves de permissions.
//
// FICARAM DE FORA de propósito, e não por esquecimento: `meta.campanha`,
// `frota.aprovar` e `conteudo.aprovar` só têm 'ver'/'exportar' no catálogo
// (ver RECURSOS em controle-de-login-e-usuario.js) — nunca ganham
// criar/editar/excluir, logo `podeMexer` nunca é true pra elas e nunca
// entrariam na frase mesmo mapeadas. Mapeá-las aqui é código morto que
// engana quem lê. Se um dia ganharem ação de mexer, o teste de
// "toda ferramenta que dá poder tem assunto" abaixo vai acusar.
const ASSUNTO = {
  'meta.gestor': 'Anúncios', 'meta.fabrica': 'Anúncios',
  frota: 'Frota',
  patrimonio: 'Patrimônio',
  acessos: 'Colaboradores',
  conteudo: 'Conteúdo',
  autenticidade: 'Autenticidade',
  banco: 'Arquivos',
}

// Exportado para o teste de guarda: toda ferramenta do catálogo que dá poder
// (tem ação de criar/editar/excluir) precisa estar aqui, senão ela aparece
// na frase como se fosse só leitura — foi o que aconteceu com `autenticidade`.
export const ASSUNTOS_CONHECIDOS = new Set(Object.keys(ASSUNTO))

const MEXE = ['criar', 'editar', 'excluir']
const podeMexer = (acoes) => (acoes || []).some((a) => MEXE.includes(a))

// permissions -> {frase, quantos, comDinheiro}. Puro: não conhece RECURSOS,
// nem quantos existem no catálogo — isso é conta de quem exibe.
export function resumoDoAcesso(permissions) {
  const p = permissions || {}
  const chaves = Object.keys(p).filter((k) => (p[k] || []).length)

  // Só conta quem pode GASTAR, não quem só vê o painel de anúncios — senão
  // o selo e a frase se contradizem (frase diz "só leitura", selo acende).
  const comDinheiro = chaves.filter((k) => mexeEmDinheiro(k) && podeMexer(p[k])).length

  // Percorre a ordem de ASSUNTO (fixa), não a ordem das chaves da pessoa —
  // senão a mesma pessoa sai com frases diferentes conforme o objeto foi
  // montado.
  const assuntos = []
  for (const [chave, assunto] of Object.entries(ASSUNTO)) {
    if (assuntos.includes(assunto)) continue
    if (podeMexer(p[chave])) assuntos.push(assunto)
  }

  let frase
  if (!chaves.length) frase = 'Sem acesso a ferramenta nenhuma.'
  else if (!assuntos.length) frase = 'Só painéis de leitura.'
  else if (assuntos.length === 1) frase = assuntos[0]
  else frase = assuntos.slice(0, -1).join(', ') + ' e ' + assuntos.at(-1)

  return { frase, quantos: chaves.length, comDinheiro }
}
