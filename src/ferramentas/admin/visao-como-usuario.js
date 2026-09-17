// A "VISÃO COMO" — o que a tela de Início mostraria para OUTRA pessoa, sem
// nunca buscar um dado real dela.
//
// POR QUE NÃO ABRE AS TELAS DE VERDADE: cada tela consulta o Supabase com a
// sessão de quem está logado — a SUA, não a da pessoa que você quer conferir.
// O RLS do banco filtra pelos SEUS dados. Fingir a permissão dela e abrir a
// tela real mostraria os SEUS números com a cara dos dela: mentira grave (item
// 9 do PADRAO-DA-CENTRAL). Por isso esta tela é só leitura da configuração —
// nunca navega para dentro de uma ferramenta.
//
// OS CARDS AQUI TÊM QUE SER OS MESMOS GATES de tela-de-inicio.vue. Escrever
// uma segunda lista à mão é o defeito que já aconteceu duas vezes com a porta
// da Gestão Interna (Frota em 19/08, Autenticidade em 01/09 — ver
// chaves-da-gestao-interna.js): a lista envelhece e ninguém percebe. Por isso
// a Gestão Interna aqui usa a MESMA função (`podeVerGestaoInterna`) e a MESMA
// lista (`CHAVES_DA_GESTAO_INTERNA`) da porta real, em vez de repetir as
// quatro chaves.
//
// PURO: sem rede, sem DOM. Recebe o perfil (o que já vem de `profiles`) e
// devolve a lista de cards prontos para desenhar.
import { RECURSOS, permissaoDoPerfil } from '../../compartilhado/controle-de-login-e-usuario.js'
import { CHAVES_DA_GESTAO_INTERNA, podeVerGestaoInterna } from '../gestao-interna/chaves-da-gestao-interna.js'
import { degrauDoConjunto } from './niveis-de-permissao.js'
import { oQueONivelFaz } from './o-que-o-nivel-faz.js'

// Cada card = exatamente o mesmo grupo de chaves que decide o `v-show` do
// card em tela-de-inicio.vue. Ordem = ordem dos cards na tela real.
const CARTOES = [
  { id: 'admin', titulo: 'Administração', exigeSuperAdmin: true },
  { id: 'social', titulo: 'Redes Sociais', chaves: ['social', 'social.relatorio', 'conteudo'] },
  { id: 'sales', titulo: 'Dashboard de Vendas', chaves: ['sales.gestao', 'sales.analise'] },
  { id: 'meta', titulo: 'Meta Ads', chaves: ['meta.campanha', 'meta.gestor'] },
  { id: 'banco', titulo: 'Banco de Arquivos', chaves: ['banco'] },
  { id: 'noticias', titulo: 'Portal de Notícias', chaves: ['noticias'] },
  { id: 'gestor', titulo: 'Gestão Comercial', chaves: ['gestor'] },
  { id: 'gestao-interna', titulo: 'Gestão Interna', chaves: CHAVES_DA_GESTAO_INTERNA, ehPorta: true },
  { id: 'claude-status', titulo: 'Status da IA', chaves: ['claude.status'] },
  { id: 'escritorio-3d', titulo: 'Escritório 3D dos Agentes', chaves: ['escritorio3d'] },
]

const rotuloDoRecurso = (chave) => RECURSOS.find((r) => r.key === chave)?.label || chave

// A frase de "o que o nível faz" para UMA chave, a partir do perfil.
function fraseDoRecurso(perfil, chave) {
  const recurso = RECURSOS.find((r) => r.key === chave)
  const temVer = permissaoDoPerfil(perfil, chave, 'ver')
  if (!recurso) return oQueONivelFaz(chave, temVer ? 'ver' : 'sem')

  const acoes = perfil?.is_superadmin ? recurso.acoes.slice() : (perfil?.permissions?.[chave] || [])
  const degrau = degrauDoConjunto(recurso, acoes)
  // Conjunto fora da escada (gravado fora do padrão, por fora desta tela):
  // frase errada é pior que frase nenhuma, então não aproxima — só diz que
  // tem acesso, sem inventar o quê.
  if (!degrau) return temVer ? 'Tem acesso, configurado fora do padrão da escada.' : oQueONivelFaz(chave, 'sem')
  return oQueONivelFaz(chave, degrau)
}

// perfil: { permissions, is_superadmin } — os mesmos campos já lidos da
// tabela `profiles` (ver carregarPerfil, em controle-de-login-e-usuario.js).
export function visaoComoUsuario(perfil) {
  const p = perfil || {}
  const temPermissao = (chave, acao = 'ver') => permissaoDoPerfil(p, chave, acao)

  return CARTOES.map((card) => {
    if (card.exigeSuperAdmin) {
      const visivel = !!p.is_superadmin
      return { id: card.id, titulo: card.titulo, visivel, frase: visivel ? 'Controle total da Central de Inteligência.' : null }
    }

    const visivel = card.ehPorta ? podeVerGestaoInterna(temPermissao) : card.chaves.some((c) => temPermissao(c, 'ver'))
    if (!visivel) return { id: card.id, titulo: card.titulo, visivel: false }

    if (card.ehPorta) {
      const ferramentas = card.chaves
        .filter((c) => temPermissao(c, 'ver'))
        .map((c) => ({ label: rotuloDoRecurso(c), frase: fraseDoRecurso(p, c) }))
      return { id: card.id, titulo: card.titulo, visivel: true, ferramentas }
    }

    const chaveConcedida = card.chaves.find((c) => temPermissao(c, 'ver'))
    return { id: card.id, titulo: card.titulo, visivel: true, frase: fraseDoRecurso(p, chaveConcedida) }
  })
}
