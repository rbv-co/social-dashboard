import { reactive } from 'vue'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './conectar-no-banco-de-dados.js'
import { classificarErro, ERRO_DE_REDE, CONTA_DESATIVADA } from './classificar-erro.js'
import { lerPerfil, precisaPerguntarSeDesativou } from './leitura-de-perfil.js'
import { RECURSOS, PERMISSION_TREE, chavesDoGrupo, podeAbrirRota } from './catalogo-de-ferramentas.js'

export const estado = reactive({
  currentSession: null,
  user: null,
  permissoes: null,
  role: 'viewer',
  features: [],
  userId: null,
  avatarUrl: null,
  // Permissões micro-gerenciadas (Fase 1): recurso→ações, perfis de rede permitidos, super-admin.
  permissions: {},
  allowed_accounts: null, // null = todos os perfis
  is_superadmin: false,
  // Limitada aos canais dos times dela? É a chave que as duas dashboards de
  // venda usam para mostrar só a loja da pessoa (canais-de-venda-permitidos.js).
  // `false` é o estado de quem já usava o sistema; conta nova nasce `true`.
  escopo_por_equipe: false,
  // Conta criada em lote (vendedoras): a senha inicial foi entregue por outra
  // pessoa. Enquanto for `true`, a moldura do aplicativo cobra a troca — marca
  // sem cobrança seria promessa não cumprida.
  precisa_trocar_senha: false,
  // Falha ao carregar o perfil (objeto do classificar-erro) ou null quando deu certo.
  // Separa "é viewer mesmo" de "não consegui carregar" — antes os dois eram iguais.
  erroPerfil: null,
})

export function setSession(session) {
  estado.currentSession = session
  estado.user = session?.user ?? null
}

// Zera TUDO. Antes, sair só limpava a sessão e deixava role/permissions/is_superadmin
// do usuário anterior — a aba ficava com o token de um e as flags de outro.
export function limparEstado() {
  estado.currentSession = null
  estado.user = null
  estado.permissoes = null
  estado.role = 'viewer'
  estado.features = []
  estado.userId = null
  estado.avatarUrl = null
  estado.permissions = {}
  estado.allowed_accounts = null
  estado.is_superadmin = false
  estado.escopo_por_equipe = false
  estado.precisa_trocar_senha = false
  estado.erroPerfil = null
}

/* A segunda pergunta: "eu fui desativado?". É a única que a conta desativada
 * ainda responde sobre si mesma (migration 055) — não devolve nome, papel nem
 * a existência de mais ninguém.
 *
 * Falha de rede aqui responde `false` de propósito: na dúvida, segue o caminho
 * de sempre. Acusar desativação por causa de um blip derrubaria gente que não
 * tem nada a ver com isso — é o mesmo cuidado que fez `carregarPerfil` parar de
 * rebaixar o super-admin a viewer quando a rede falha. */
async function contaEstaDesativada(tok) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/minha_conta_esta_desativada`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${tok}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    })
    if (!r.ok) return false
    return (await r.json()) === true
  } catch (e) {
    return false
  }
}

// Carrega o perfil (papel + permissões) da tabela `profiles`.
// Antes engolia qualquer falha e produzia role='viewer', permissions={} — idêntico
// ao caminho de sucesso com perfil vazio. Resultado: o super-admin dava F5 num blip
// de rede e via a Central sem nenhum card, sem mensagem, achando que perdeu acesso.
// Agora "é viewer" e "não consegui carregar" são estados distintos.
// Nunca lança: devolve { ok, erro } e quem chama decide o que mostrar.
export async function carregarPerfil(session) {
  estado.erroPerfil = null
  estado.userId = session?.user?.id || null
  try {
    const tok = session?.access_token || SUPABASE_ANON_KEY
    const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${session.user.id}&select=role,features,avatar_url,permissions,allowed_accounts,is_superadmin,precisa_trocar_senha,escopo_por_equipe`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${tok}` },
    })
    const corpo = await r.json().catch(() => null)
    // Em erro NÃO escrevemos role/permissions/is_superadmin: deixar o valor
    // anterior é melhor que rebaixar. Quem lê decide pelo erroPerfil.
    if (!r.ok || !Array.isArray(corpo)) {
      estado.erroPerfil = classificarErro(r.status, corpo)
      return { ok: false, erro: estado.erroPerfil }
    }
    /* LISTA VAZIA TEM DOIS DONOS (21/09/2026). Desde a migration 054 a conta
     * DESATIVADA não lê nem o próprio perfil — é o que fecha as 46 políticas
     * que consultam `profiles` direto. A resposta chega igualzinha à de quem
     * nunca teve perfil, e esse caso é legítimo: duas contas reais entram
     * assim hoje e recebem o Banco de Arquivos pelo padrão logo abaixo.
     *
     * Quem separa as duas é a pergunta ao banco, feita SÓ quando veio vazio.
     * Sem ela, a Central abriria vazia e calada para quem foi desativado — e
     * "a tela nunca mente" é regra escrita do padrão da casa. */
    const leitura = lerPerfil(corpo,
      precisaPerguntarSeDesativou(corpo) ? await contaEstaDesativada(tok) : false)
    if (leitura.tipo === 'desativada') {
      estado.erroPerfil = CONTA_DESATIVADA
      return { ok: false, erro: CONTA_DESATIVADA }
    }
    const p = leitura.perfil || {}
    estado.role = p.role || 'viewer'
    estado.features = p.features || ['banco']
    estado.permissions = p.permissions || {}
    estado.allowed_accounts = p.allowed_accounts ?? null
    estado.is_superadmin = !!p.is_superadmin
    estado.precisa_trocar_senha = !!p.precisa_trocar_senha
    estado.escopo_por_equipe = !!p.escopo_por_equipe
    estado.avatarUrl = p.avatar_url || null
    return { ok: true, erro: null }
  } catch (e) {
    estado.erroPerfil = ERRO_DE_REDE
    return { ok: false, erro: ERRO_DE_REDE }
  }
}

// Catálogo de recursos → ações válidas. A FONTE MUDOU DE CASA em 24/09/2026:
// mora em `catalogo-de-ferramentas.js`, junto com as rotas e os cartões de
// menu, e daqui só é reexportada (os nomes RECURSOS e PERMISSION_TREE ficam,
// porque meia Central os importa daqui).
//
// REGRA QUE PASSOU A VALER EM 13/08/2026 (itens B1d e B1e da lista): **uma ação
// só entra no catálogo se existir código que a respeite.** Ação sem dono vira
// degrau no editor, o admin concede achando que controlou alguma coisa, e não
// controlou — é uma mentira que o sistema conta com cara de recurso. (Saíram
// nesse dia o 'exportar' de social/sales.gestao/sales.analise/meta.campanha e
// `sales.metas` inteira — o memorial está no histórico do git deste arquivo.)
export { RECURSOS, PERMISSION_TREE }

// Ponte: chaves antigas (call sites legados) → recurso novo. Assim nada quebra durante a migração.
const _legado = {
  'tool:social': 'social', 'tool:sales': 'sales', 'tool:meta': 'meta', 'tool:acessos': 'acessos',
  'module:sales:gestao-vista': 'sales.gestao', 'module:sales:analise-vendas': 'sales.analise',
  'module:meta:campanha': 'meta.campanha', 'module:meta:gestor': 'meta.gestor', 'module:meta:fabrica': 'meta.fabrica',
}
// Exportado só para o teste do catálogo conferir que toda chave usada em
// `hasPermission('...')` existe (direto, por esta ponte ou como grupo).
export const CHAVES_LEGADAS = Object.freeze({ ..._legado })

// Mesma regra de acesso de `hasPermission`, mas sobre um perfil explícito em
// vez do `estado` global. `hasPermission` é só esta função aplicada a `estado`.
export function permissaoDoPerfil(perfil, recurso, acao = 'ver') {
  if (perfil?.is_superadmin) return true
  const key = _legado[recurso] || recurso
  const permissions = perfil?.permissions || {}
  // Pais 'sales'/'meta' (tool:*) = tem acesso se tiver QUALQUER filho do grupo.
  // Os filhos saem do catálogo: a lista à mão que morava aqui não conhecia a
  // próxima ferramenta do grupo.
  if (key === 'sales' || key === 'meta') return chavesDoGrupo(key).some(k => (permissions[k] || []).includes('ver'))
  return (permissions[key] || []).includes(acao)
}

// Libera/bloqueia por recurso E ação. Super-admin vê tudo. Retrocompatível com as chaves antigas.
export function hasPermission(recurso, acao = 'ver') {
  return permissaoDoPerfil(estado, recurso, acao)
}

// O cartão de menu / a rota `nome` abre para quem está logado? A MESMA regra
// da guarda do roteador (ver catalogo-de-ferramentas.js) — todo cartão de menu
// usa esta, e o teste do catálogo reprova cartão que use outra coisa.
export function podeAbrir(nome) {
  return podeAbrirRota(nome, hasPermission, !!estado.is_superadmin)
}

// Perfis de rede que o usuário pode ver (null = todos). Usado p/ filtrar o seletor de perfis.
export function contasPermitidas() {
  return estado.is_superadmin ? null : (estado.allowed_accounts ?? null)
}
