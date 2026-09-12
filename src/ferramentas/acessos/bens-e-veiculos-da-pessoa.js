// Lógica pura da ficha do colaborador para os blocos "Bens" e "Veículos"
// (13/08/2026, pedido do dono: "faz o link no cadastro de colaborador dos bens
// que a pessoa usa... dá pra puxar de frota também"). Antes a ficha lia
// acessos_dispositivos — tabela do módulo antigo, com ZERO linhas desde
// sempre; a caixa "Dispositivos & patrimônio" aparecia vazia pras 27 pessoas,
// sempre. Não era criar link nenhum: era apontar pra fonte de verdade, que
// hoje é patrimonio_bens e frota_veiculos.
//
// Como os outros .js desta pasta: sem banco, sem DOM, só decisão e
// transformação — testável com `node --test` sem subir a tela.

// O gêmeo de temAcessoFrota (../patrimonio/ligacao-com-frota.js) para o
// Patrimônio: mesma forma — super-admin OU a feature do módulo no perfil —
// pro bloco de Bens da ficha decidir SE MOSTRA "sem acesso" antes mesmo de
// olhar o que a consulta trouxe. Sem isso, uma lista vazia por falta de
// acesso pareceria "esta pessoa não tem bem nenhum", que é dado inventado —
// exatamente a família do R$ 0,00 que ficou 17h na tela.
//
// A RLS de patrimonio_bens é BEM mais generosa que este sinalizador: a
// policy de SELECT (`pode_ver_bem`) também libera quem não é
// `escopo_por_equipe` e o dono do próprio cadastro — sem exigir a feature
// "patrimonio". Medido em produção (fix round 1, 13/08/2026): 10 dos 20
// perfis recebem linha de verdade com `temAcessoPatrimonio()===false`, e
// entre eles está `ti@rbvcompany.com` — a conta que o brief mediu.
//
// Por isso este sinalizador NUNCA pode ser consultado sozinho pra decidir
// "sem acesso": ele só entra depois de conferir se a consulta trouxe linha
// (ver `decidirEstadoDaSecao` abaixo). Dado na mão sempre vence a flag —
// a RLS já decidiu o que a consulta podia trazer; a flag só explica o vazio.
export function temAcessoPatrimonio(estado) {
  if (!estado) return false
  if (estado.is_superadmin) return true
  return Array.isArray(estado.features) && estado.features.includes('patrimonio')
}

// Os quatro estados de uma seção da ficha (Bens ou Veículos), NA ORDEM
// CERTA — é regra, e regra escondida em template string não tem teste (foi
// assim que o CRITICAL 1 escapou: a tela consultava a flag de acesso ANTES
// de olhar o dado, e descartava linhas de verdade que a RLS já tinha
// liberado). A ordem importa:
//   1. erro         → a consulta falhou de verdade, sempre vence.
//   2. com-dados     → o banco devolveu linha: ela aparece, MESMO que a flag
//                      de acesso (aproximada, ver temAcessoPatrimonio acima)
//                      diga que não devia. Dado na mão nunca é mentira.
//   3. sem-acesso    → sem linha E sem a flag: aí sim a falta de acesso é a
//                      explicação mais provável do vazio.
//   4. vazio         → sem linha, mas com a flag: vazio de verdade.
export function decidirEstadoDaSecao({ lista, erro, temAcesso }) {
  if (erro) return 'erro'
  const itens = Array.isArray(lista) ? lista : []
  if (itens.length) return 'com-dados'
  if (!temAcesso) return 'sem-acesso'
  return 'vazio'
}

// A pílula de situação do bem usa as classes `.ac-pill` já existentes NESTA
// ferramenta (ok/warn/bad/neutral) — não as `.pat-pill-*` do módulo
// Patrimônio, que são CSS scoped de outro componente e não chegariam aqui.
// Os quatro valores são os mesmos do CHECK de patrimonio_bens.situacao
// (ver também rotulos-do-bem.js, que já tem o rótulo em português).
const PILULA_POR_SITUACAO = {
  em_uso: 'ok',
  em_estoque: 'neutral',
  em_manutencao: 'warn',
  baixado: 'bad',
}
export function pilulaDaSituacaoDoBem(situacao) {
  return PILULA_POR_SITUACAO[situacao] || 'neutral'
}

// Agrupa uma lista (bens ou veículos) pelo pessoa_id de cada item, pra
// Auditoria montar as colunas "Bens" e "Veículos" com UMA consulta só (todas
// as pessoas de uma vez), não uma consulta por pessoa. Item sem pessoa_id
// não entra em mapa nenhum — "sem dono" não é dono de ninguém.
export function agruparPorPessoa(lista) {
  const mapa = {}
  for (const item of Array.isArray(lista) ? lista : []) {
    if (!item || !item.pessoa_id) continue
    ;(mapa[item.pessoa_id] = mapa[item.pessoa_id] || []).push(item)
  }
  return mapa
}
