// src/ferramentas/admin/perfis-de-acesso.js
//
// A SOBREPOSIÇÃO PERFIL × EXCEÇÃO (D9 do desenho de 11/08/2026).
//
// O perfil manda no que ELE cobre; o que foi dado à mão àquela pessoa fica por
// cima e sobrevive. Perfil que apaga o que alguém concedeu de propósito faz o
// dono perder trabalho sem aviso — foi a primeira coisa que ele decidiu quando
// escolheu o perfil vivo.
//
// PURO: sem rede, sem DOM. Quem chama busca perfil e pessoa e passa para cá.

// Duas listas de ação são o mesmo acesso mesmo em ordem diferente. Comparar sem
// ordenar criaria exceção fantasma para metade das pessoas, e cada exceção
// fantasma é uma ferramenta que o perfil deixa de governar.
const mesmasAcoes = (a, b) => {
  const x = [...(a || [])].sort()
  const y = [...(b || [])].sort()
  return x.length === y.length && x.every((v, i) => v === y[i])
}

// Lista vazia é "sem acesso", não uma chave concedida. Guardá-la faria a pessoa
// aparecer com uma ferramenta a mais na contagem, sem poder nenhum.
const temAcesso = (acoes) => Array.isArray(acoes) && acoes.length > 0

/** O que gravar em `profiles.permissions` para quem está neste perfil. */
export function acessoEfetivo(perfilPermissions, excecao) {
  const out = {}
  for (const [k, v] of Object.entries(perfilPermissions || {})) {
    if (temAcesso(v)) out[k] = [...v]
  }
  for (const [k, v] of Object.entries(excecao || {})) {
    if (temAcesso(v)) out[k] = [...v]
    else delete out[k]
  }
  return out
}

/**
 * O que, no acesso de hoje desta pessoa, NÃO veio do perfil.
 * Usado ao pôr alguém num perfil: o que ela já tinha e o perfil não dá vira
 * exceção, em vez de ser perdido em silêncio.
 */
export function excecaoDe(perfilPermissions, permissionsAtuais) {
  const perfil = perfilPermissions || {}
  const out = {}
  for (const [k, v] of Object.entries(permissionsAtuais || {})) {
    if (!temAcesso(v)) continue
    if (!mesmasAcoes(perfil[k], v)) out[k] = [...v]
  }
  return out
}

/**
 * D9 NO CAMINHO REAL — o que gravar em `permissions_excecao` quando alguém
 * salva a ficha de uma pessoa no editor de permissões.
 *
 * POR QUE ESTA FUNÇÃO EXISTE (revisão final de 12/08/2026): `excecaoDe` estava
 * escrita, testada e NÃO ERA CHAMADA POR NINGUÉM na aplicação. O único ponto
 * que escrevia `permissions_excecao` era o convite, e escrevia `{}`. Ou seja:
 * dar Frota à Ana à mão entrava só em `permissions`, a exceção continuava
 * vazia, e a primeira regravação do perfil dela apagava a Frota — exatamente a
 * promessa que o dono comprou ao aceitar o perfil vivo, quebrada em silêncio.
 *
 * O CÁLCULO ESTÁ AQUI, e não dentro do `.vue`, porque decisão que só existe num
 * arquivo `.vue` não tem como ser testada — e foi a falta de teste do caminho
 * real que deixou o defeito passar.
 *
 * NÃO RECALCULAR É MELHOR QUE RECALCULAR ERRADO. Sem o mapa do perfil em mãos
 * (cache não carregou, perfil apagado por outra janela), gravar exceção seria
 * chutar o que veio do perfil — e um chute aqui vira acesso concedido ou
 * apagado depois, sem ninguém ver. Nesse caso a resposta é `gravar: false` com
 * um aviso para a tela DIZER, nunca ficar calada.
 *
 * @param {{perfilId: any, perfis: Array<{id: any, permissions: object}>, permissions: object}} arg
 * @returns {{gravar: boolean, excecao?: object, aviso: string|null}}
 */
export function excecaoAoSalvar({ perfilId, perfis, permissions } = {}) {
  // Sem perfil não existe exceção: o acesso dela é o que está em `permissions`,
  // ponto. Gravar `{}` aqui seria inventar um vínculo que não existe.
  if (!perfilId) return { gravar: false, aviso: null }
  const perfil = (perfis || []).find((p) => p && String(p.id) === String(perfilId))
  if (!perfil) {
    return {
      gravar: false,
      aviso: 'Não consegui abrir o perfil desta pessoa, então não registrei o que foi dado à mão. '
        + 'Se alguém regravar esse perfil, o que você marcou aqui pode ser desfeito.',
    }
  }
  return { gravar: true, excecao: excecaoDe(perfil.permissions, permissions), aviso: null }
}

/**
 * Quem muda de acesso se este perfil virar `perfilNovo`, e o que muda para cada.
 *
 * D11: nada de perfil é gravado sem a tela nomear estas pessoas. É o passo que
 * mantém o dono como quem decide, em vez de descobrir depois — e a única
 * proteção que o perfil vivo tem contra dar acesso em massa em silêncio.
 *
 * Quem NÃO muda fica de fora de propósito: lista com gente que não muda vira
 * ruído, e quem lê ruído aprova sem ler.
 *
 * `antes` (= `m.permissions`) é sempre perfil+exceção já mesclados — é o que
 * `acessoEfetivo` grava e o que a Task 6 lê de volta do banco. Não filtramos
 * chave de exceção aqui: se `permissions` estiver divergente da exceção (um
 * admin editou `permissions` direto, sem passar pela exceção), é EXATAMENTE
 * essa divergência que D11 existe para mostrar antes de gravar — escondê-la
 * seria o perfil concedendo acesso calado.
 */
export function impactoDaMudanca(perfilNovo, membros) {
  const afetados = []
  for (const m of membros || []) {
    const antes = m.permissions || {}
    const excecao = m.permissions_excecao || {}
    const depois = acessoEfetivo(perfilNovo, excecao)
    const chaves = new Set([...Object.keys(antes), ...Object.keys(depois)])
    const ganha = []
    const perde = []
    const muda = []
    for (const k of chaves) {
      const a = antes[k]
      const d = depois[k]
      if (mesmasAcoes(a, d)) continue
      const tinha = temAcesso(a)
      const tem = temAcesso(d)
      // Tinha e continua tendo, só que com outro nível: é REBAIXAMENTO ou
      // PROMOÇÃO, não "ganho". Contar isso como ganha faria o dono ler que
      // alguém ganhou algo quando na verdade perdeu ações — é o texto que ele
      // lê antes de aprovar, e o texto tem que dizer a verdade.
      if (tinha && tem) muda.push({ chave: k, de: [...a], para: [...d] })
      else if (tem) ganha.push(k)
      else perde.push(k)
    }
    if (ganha.length || perde.length || muda.length) {
      afetados.push({
        nome: m.nome,
        ganha: ganha.sort(),
        perde: perde.sort(),
        muda: muda.sort((x, y) => (x.chave < y.chave ? -1 : x.chave > y.chave ? 1 : 0)),
      })
    }
  }
  return { afetados, total: afetados.length }
}
