<template>
  <div class="tela-inicio">
    <div class="home-header">
      <div class="home-header-brand">
        <img class="rbv-logo rbv-logo-light" :src="logoClaroUrl" alt="RBV">
        <img class="rbv-logo rbv-logo-dark" :src="logoEscuroUrl" alt="RBV">
        <h1>Inteligência RBV</h1>
      </div>
      <!-- No legado (#home-header-user) este bloco também nasce com
           display:none e nunca é revelado por script nenhum — o badge de
           usuário exibido de fato é o global (setGlobalUserBtn, fora do
           escopo desta tela). Mantemos a mesma aparência (oculto) aqui;
           o e-mail já fica amarrado ao estado para quando isso mudar. -->
      <div class="home-header-user" style="display:none">
        <span class="user-badge">
          <span id="home-user-email">{{ estado.user?.email }}</span>
          <!-- Papel (admin/viewer) depende do sistema de permissões, que
               ainda não foi portado para o Vue — fica vazio por enquanto. -->
          <span class="user-role-chip" id="home-user-role"></span>
        </span>
      </div>
    </div>
    <div class="home-main">
      <div class="home-toolbar">
        <span class="home-toolbar-label">Ferramentas</span>
        <div class="view-toggle">
          <button class="view-toggle-btn" :class="{ active: visualizacao === 'grid' }" id="vt-grid" @click="definirVisualizacao('grid')" title="Cards">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><rect x="0" y="0" width="6" height="6" rx="1"/><rect x="8" y="0" width="6" height="6" rx="1"/><rect x="0" y="8" width="6" height="6" rx="1"/><rect x="8" y="8" width="6" height="6" rx="1"/></svg>
          </button>
          <button class="view-toggle-btn" :class="{ active: visualizacao === 'list' }" id="vt-list" @click="definirVisualizacao('list')" title="Lista">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><rect x="0" y="1" width="14" height="2.5" rx="1"/><rect x="0" y="5.75" width="14" height="2.5" rx="1"/><rect x="0" y="10.5" width="14" height="2.5" rx="1"/></svg>
          </button>
        </div>
      </div>
      <!-- Estado vazio: nunca deixar a tela em branco. Ver semNenhumaFerramenta.
           Dois motivos MUITO diferentes levam à tela sem cards, e dizer o motivo
           errado é pior que não dizer nada: "você não tem acesso" para quem só teve
           uma falha de rede é mentira, e manda a pessoa cobrar o admin à toa. -->
      <!-- CONTA DESATIVADA não é falha de carregamento (21/09/2026). O título
           "não consegui carregar" manda a pessoa recarregar a página a manhã
           inteira, e o botão "Tentar de novo" promete o que não pode cumprir:
           nada vai mudar até alguém religar a conta em Administração. Por isso
           este caso tem título próprio e NENHUM botão — `acao` é nula, e agora
           a tela respeita isso. -->
      <div v-if="contaDesativada" class="inicio-vazio">
        <div class="inicio-vazio-icone" aria-hidden="true">🔒</div>
        <p class="inicio-vazio-t">Esta conta está desativada.</p>
        <p class="inicio-vazio-d">{{ estado.erroPerfil.mensagem }}</p>
      </div>
      <div v-else-if="falhouAoCarregarPerfil" class="inicio-vazio">
        <div class="inicio-vazio-icone" aria-hidden="true">⚠</div>
        <p class="inicio-vazio-t">Não consegui carregar seus acessos.</p>
        <p class="inicio-vazio-d">{{ estado.erroPerfil.mensagem }}</p>
        <button class="inicio-vazio-btn" v-if="estado.erroPerfil.acao" @click="tentarDeNovo">
          {{ estado.erroPerfil.acao === 'entrar' ? 'Entrar de novo' : 'Tentar de novo' }}
        </button>
      </div>
      <div v-else-if="semNenhumaFerramenta" class="inicio-vazio">
        <div class="inicio-vazio-icone" aria-hidden="true">🔒</div>
        <p class="inicio-vazio-t">Você ainda não tem acesso a nenhuma ferramenta.</p>
        <p class="inicio-vazio-d">Fale com o administrador para liberar o que você precisa usar.</p>
      </div>
      <div class="home-cards" :class="{ 'view-list': visualizacao === 'list' }" id="home-cards">
        <!-- Administração: rota já existe (src/ferramentas/admin/tela-de-admin.vue). -->
        <div class="home-card card-admin" id="home-card-admin" v-show="podeAbrir('admin')" @click="ir('admin')" @mouseenter="definirTemaFundo('admin')" @mouseleave="definirTemaFundo('default')">
          <div class="home-card-icon">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>
          </div>
          <div class="home-card-text">
            <h3>Administração</h3>
            <p>Controle total da Central de Inteligência</p>
          </div>
          <span class="home-card-enter">→</span>
        </div>
        <div class="home-card" id="home-card-social" v-show="podeAbrir('redes')" @click="irRedes" @mouseenter="definirTemaFundo('social')" @mouseleave="definirTemaFundo('default')">
          <div class="home-card-icon">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
          </div>
          <div class="home-card-text">
            <h3>Redes<br>Sociais</h3>
            <p>Métricas do Instagram, relatório e a Central de Conteúdo</p>
          </div>
          <span class="home-card-enter">→</span>
        </div>
        <!-- Dashboard de Vendas: Menu de Vendas + Gestão à Vista já migrados. -->
        <div class="home-card" id="home-card-sales" v-show="podeAbrir('vendas')" @click="ir('vendas')" @mouseenter="definirTemaFundo('sales')" @mouseleave="definirTemaFundo('default')">
          <div class="home-card-icon" style="background:linear-gradient(135deg,color-mix(in srgb,var(--accent) 78%,var(--text)) 0%,var(--accent) 100%)">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
          </div>
          <div class="home-card-text">
            <h3>Dashboard<br>de Vendas</h3>
            <p>Gestão à vista, análise por loja e vendedor</p>
          </div>
          <span class="home-card-enter">→</span>
        </div>
        <!-- Meta Ads: Menu + Análise de Campanhas já migrados. -->
        <div class="home-card" id="home-card-meta" v-show="podeAbrir('meta-ads')" @click="ir('meta-ads')" @mouseenter="definirTemaFundo('meta')" @mouseleave="definirTemaFundo('default')">
          <!-- O ícone do Meta Ads no azul da Gestão de Tráfego (Onda 4a): do token
               claro (#0067c2) ao #1877F2 da marca. Branco sobre a ponta clara: 4,23. -->
          <div class="home-card-icon" style="background:linear-gradient(135deg,#0067c2 0%,#1877F2 100%)">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
          </div>
          <div class="home-card-text">
            <h3>Meta<br>Ads</h3>
            <p>Análise de campanhas e gestão de tráfego pago</p>
          </div>
          <span class="home-card-enter">→</span>
        </div>
        <!-- Banco de Arquivos: rota ainda não existe. -->
        <div class="home-card" id="home-card-banco" v-show="podeAbrir('banco')" @click="ir('banco')">
          <div class="home-card-icon" style="background:linear-gradient(135deg,#0f4c81 0%,var(--accent) 100%)">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="8 17 12 21 16 17"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29"/></svg>
          </div>
          <div class="home-card-text">
            <h3>Banco de<br>Arquivos</h3>
            <p>Downloads e uploads de materiais e recursos visuais</p>
          </div>
          <span class="home-card-enter">→</span>
        </div>
        <!-- Portal de Notícias: única ferramenta já migrada, navega de verdade. -->
        <div class="home-card" id="home-card-noticias" v-show="podeAbrir('noticias')" @click="ir('noticias')" @mouseenter="definirTemaFundo('default')" @mouseleave="definirTemaFundo('default')">
          <div class="home-card-icon" style="background:linear-gradient(135deg,#0f4c81 0%,var(--accent) 100%)">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 22h16a2 2 0 0 0 2-2V4a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v16a2 2 0 0 1-2 2 2 2 0 0 1-2-2V9a1 1 0 0 1 1-1h2"/><path d="M18 14h-8"/><path d="M15 18h-5"/><path d="M10 6h8v4h-8z"/></svg>
          </div>
          <div class="home-card-text">
            <h3>Portal de<br>Notícias</h3>
            <p>Inteligência de concorrentes por marca, atualizada toda semana</p>
          </div>
          <span class="home-card-enter">→</span>
        </div>
        <div class="home-card" id="home-card-gestor" v-show="podeAbrir('gestao-comercial')" @click="ir('gestao-comercial')" @mouseenter="definirTemaFundo('default')" @mouseleave="definirTemaFundo('default')">
          <div class="home-card-icon" style="background:linear-gradient(135deg,#0f4c81 0%,var(--accent) 100%)">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M18.7 8l-5.1 5.2-2.8-2.7L7 14.3"/></svg>
          </div>
          <div class="home-card-text">
            <h3>Gestão<br>Comercial</h3>
            <p>Briefing semanal do gestor de IA: metas, concorrência e estoque</p>
          </div>
          <span class="home-card-enter">→</span>
        </div>
        <!-- Porta da família Gestão Interna: leva ao menu com Colaboradores e
             Acessos, Patrimônio e (futuramente) Frota. Aparece pra quem tem
             qualquer um dos submódulos. -->
        <div class="home-card" id="home-card-gestao-interna" v-show="podeAbrir('gestao-interna')" @click="ir('gestao-interna')">
          <div class="home-card-icon" style="background:linear-gradient(135deg,#0f766e 0%,#0d9488 100%)">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/><path d="M9 21v-6h6v6"/></svg>
          </div>
          <div class="home-card-text">
            <h3>Gestão<br>Interna</h3>
            <p>Colaboradores, acessos, patrimônio e frota</p>
          </div>
          <span class="home-card-enter">→</span>
        </div>
        <!-- COMERCIAL VESSEL: a porta única do atendimento e da ação comercial
             da marca. Antes eram TRÊS cartões soltos aqui (Atendimentos, Beauty
             Sessions e Funil de Carrinho), e a home crescia um por entrega.
             ⚠️ Cada módulo continua atrás da MESMA chave de antes, e os
             endereços diretos seguem valendo — link salvo não quebra. -->
        <div class="home-card" id="home-card-comercial-vessel" v-show="podeAbrir('comercial-vessel')" @click="ir('comercial-vessel')" @mouseenter="definirTemaFundo('default')" @mouseleave="definirTemaFundo('default')">
          <div class="home-card-icon" style="background:linear-gradient(135deg,#7a3f52 0%,#c3708a 100%)">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3h18v4H3z"/><path d="M5 7v13h14V7"/><path d="M9 11h6"/></svg>
          </div>
          <div class="home-card-text">
            <h3>Comercial<br>Vessel</h3>
            <p>Atendimentos, Beauty Sessions e o funil de carrinho da loja</p>
          </div>
          <span class="home-card-enter">→</span>
        </div>
        <div class="home-card" id="home-card-claude-status" v-show="podeAbrir('claude-status')" @click="ir('claude-status')" @mouseenter="definirTemaFundo('default')" @mouseleave="definirTemaFundo('default')">
          <div class="home-card-icon" style="background:linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%)">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
          </div>
          <div class="home-card-text">
            <h3>Status<br>da IA</h3>
            <p>Robôs de IA, quanto cada tarefa custou e o gasto real das contas</p>
          </div>
          <span class="home-card-enter">→</span>
        </div>
        <!-- Escritório 3D dos Agentes: rota ainda não existe. -->
        <div v-if="podeAbrir('escritorio-3d')" class="home-card" id="home-card-hq3d" @click="abrirEscritorio3D" @mouseenter="definirTemaFundo('default')" @mouseleave="definirTemaFundo('default')">
          <div class="home-card-icon" style="background:linear-gradient(135deg,#0d9488 0%,#16a89a 100%)">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/><line x1="9" y1="9" x2="9" y2="9.01"/><line x1="9" y1="13" x2="9" y2="13.01"/><line x1="9" y1="17" x2="9" y2="17.01"/></svg>
          </div>
          <div class="home-card-text">
            <h3>Escritório 3D<br>dos Agentes</h3>
            <p>HQ navegável com os agentes de IA e status ao vivo</p>
          </div>
          <span class="home-card-enter">→</span>
        </div>
      </div>
    </div>
    <footer class="home-footer">
      <div class="home-footer-phrase">Mentalidade Vencedora</div>
    </footer>

    <div class="tela-inicio-aviso" v-if="avisoFerramenta">{{ avisoFerramenta }}</div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { estado, hasPermission, podeAbrir, carregarPerfil, RECURSOS } from '../../compartilhado/controle-de-login-e-usuario.js'

const router = useRouter()

// OS CARTÕES DESTA TELA NÃO TÊM MAIS LISTA PRÓPRIA (24/09/2026). Cada um chama
// `podeAbrir('<rota>')`, que lê o catálogo (compartilhado/catalogo-de-
// ferramentas.js) — a MESMA regra da guarda do roteador. Antes cada cartão
// tinha o seu OU escrito à mão, e eles envelheceram: o do Meta Ads ignorava a
// Fábrica e os dois relatórios; a Gestão Interna esqueceu a Frota (19/08) e a
// Autenticidade (01/09). Uma porta (Gestão Interna, Comercial Vessel, Vendas,
// Meta Ads, Redes) abre para quem vê QUALQUER ferramenta de dentro.
const ehAdmin = computed(() => estado.is_superadmin)

// Nenhuma ferramenta liberada? Sem isto, os cards somem um a um e sobra a barra
// de topo numa página em branco — o usuário lê como "o sistema quebrou" e reporta
// como bug. Aconteceu de verdade: gente sem permissão (e gente cujo perfil falhou
// ao carregar) via a tela vazia e não tinha como saber que o problema era acesso.
//
// ⚠️ SAI DO CATÁLOGO INTEIRO, não de uma lista de cartões: a lista à mão que
// morava aqui esqueceu a Frota e a Autenticidade, cada uma no seu mês. O teste
// do catálogo garante que toda chave tem um caminho de clique a partir daqui.
const semNenhumaFerramenta = computed(() =>
  !ehAdmin.value && !RECURSOS.some((r) => hasPermission(r.key, 'ver'))
)

// O perfil não carregou (rede, sessão expirada, servidor). É DIFERENTE de "não tem
// permissão", e tem precedência: num login a frio com a rede caindo não há valor
// anterior a preservar, então permissions fica {} e a pessoa cairia no aviso errado
// — iria cobrar acesso do admin quando o problema era um blip de rede.
const falhouAoCarregarPerfil = computed(() => !!estado.erroPerfil)
/* Desativada é o único estado em que não há o que tentar: ver o bloco no
 * template. Comparado pelo TIPO e não pela mensagem — texto muda, tipo não. */
const contaDesativada = computed(() => estado.erroPerfil?.tipo === 'conta-desativada')

async function tentarDeNovo() {
  if (estado.erroPerfil?.acao === 'entrar') { router.push({ name: 'login' }); return }
  if (estado.currentSession) await carregarPerfil(estado.currentSession)
}

// Caminho absoluto: servido em produção via rewrite do Vercel (/midia/:path*),
// igual ao legado. Ligação dinâmica (:src) evita que o Vite tente resolver
// o caminho como módulo em tempo de build (mesmo padrão de tela-de-login.vue).
const logoClaroUrl = '/midia/LOGOTIPOBRENOPRETO.png'
const logoEscuroUrl = '/midia/LOGOTIPOBRENOBRANCO.png'

// Navegação real — só existe rota para as ferramentas já migradas.
function ir(nome) {
  router.push({ name: nome })
}

// Redes Sociais: quem tem MAIS DE UMA ferramenta na área vê o submenu; quem tem
// só uma vai direto nela, porque um submenu de um item só é um clique a troco de
// nada.
//
// Antes isto era `ehAdmin ? submenu : dashboard`, o que fazia sentido quando a
// área tinha só Dashboard + Relatório (e o Relatório era de admin). Com a Central
// de Conteúdo aqui dentro, essa regra passou a esconder a ferramenta: quem tinha
// a Central mas não era admin ia parar no Dashboard e não tinha como chegar nela.
// ATENÇÃO: esta contagem tem que espelhar EXATAMENTE os cards que o submenu
// mostra (tela-de-menu-redes.vue). Se divergir, alguém é mandado direto para uma
// ferramenta enquanto teria outras — ou vê um submenu de um item só.
//
// O Relatório Interativo segue a CHAVE `social.relatorio` (a que o editor
// mostra), igual ao cartão dele no submenu — até 24/09/2026 os dois olhavam o
// `role`, e 13 pessoas tinham a chave concedida sem caminho até a tela.
function irRedes() {
  const destinos = ['redes-sociais', 'redes-relatorio', 'conteudo'].filter((r) => podeAbrir(r))

  router.push({ name: destinos.length > 1 ? 'redes' : (destinos[0] || 'inicio') })
}

// Escritório 3D dos Agentes: página estática (three.js) servida em public/escritorio-3d/.
// Abre em nova aba, igual ao openEscritorio3D() do legado.
function abrirEscritorio3D() {
  window.open('/escritorio-3d/index.html', '_blank')
}

// Ferramentas cuja rota ainda não existe na versão Vue (equivalente aos
// antigos openAdmin()/openDashboard()/openMetaAds()/openEscritorio3D() do
// legado — openSalesDashboard()/openBanco()/openAcessos() já viraram rotas
// reais).
// Quando cada uma ganhar sua rota própria em src/mapa-de-enderecos.js,
// troque a chamada do card correspondente por router.push({ name: '...' })
// (igual ao card de Notícias, que já é real).
const avisoFerramenta = ref('')
let avisoTimer = null
function aindaNaoMigrada(nome) {
  avisoFerramenta.value = `A ferramenta "${nome}" ainda será migrada.`
  clearTimeout(avisoTimer)
  avisoTimer = setTimeout(() => { avisoFerramenta.value = '' }, 3200)
}

// Alternância grade/lista (equivalente a setHomeView do legado), com a
// mesma persistência em localStorage.
const visualizacao = ref(localStorage.getItem('home-view') || 'grid')
function definirVisualizacao(v) {
  visualizacao.value = v
  localStorage.setItem('home-view', v)
}

// Tema do fundo animado ao passar o mouse nos cards (equivalente a
// setHomeBgTheme do legado). O fundo em si (#bg-shapes) é uma camada
// global fora do escopo desta tela — ainda não existe como componente
// Vue — então por enquanto só guardamos o tema reativo aqui, pronto para
// ser consumido quando essa camada for portada.
const temaFundo = ref('default')
function definirTemaFundo(tipo) {
  temaFundo.value = tipo
}

onMounted(() => {
  definirVisualizacao(visualizacao.value)
})
</script>

<style scoped>
/* Peeled from legacy #home-screen (estilos-globais.css) — display:none
   removido porque no Vue quem controla a visibilidade é o vue-router
   (o componente só existe no DOM quando a rota está ativa). */
.tela-inicio{min-height:100vh;display:flex;flex-direction:column;background:transparent;position:relative;z-index:1;}

/* Estado vazio — nomes prefixados com inicio-vazio- de propósito: o
   estilos-globais.css tem classes genéricas e este projeto já teve bug de
   colisão entre global e tela scoped (o caso home-card → fab-card). */
.inicio-vazio{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:64px 24px;text-align:center;}
.inicio-vazio-icone{font-size:max(16px, calc(34px * var(--escala-texto, 1)));line-height:1;opacity:.55;margin-bottom:4px;}
.inicio-vazio-t{font-family:'Sora',sans-serif;font-size:max(9px, calc(15px * var(--escala-texto, 1)));font-weight:600;color:var(--text);margin:0;}
.inicio-vazio-d{font-family:var(--fonte-principal);font-size:max(9px, calc(13px * var(--escala-texto, 1)));color:var(--muted);margin:0;max-width:38ch;}
.inicio-vazio-btn{margin-top:14px;padding:8px 18px;border:1px solid var(--border);border-radius:6px;background:transparent;color:var(--text);font-family:var(--fonte-principal);font-size:max(9px, calc(13px * var(--escala-texto, 1)));font-weight:500;cursor:pointer;transition:background .15s;}
.inicio-vazio-btn:hover{background:var(--surface2);}
@media (max-width:640px){
  .inicio-vazio{padding:40px 18px;}
  .inicio-vazio-t{font-size:max(9px, calc(14px * var(--escala-texto, 1)));}
  .inicio-vazio-d{font-size:max(9px, calc(12px * var(--escala-texto, 1)));}
}

.tela-inicio-aviso{position:fixed;bottom:22px;left:50%;transform:translateX(-50%);background:var(--text);color:var(--bg);font-family:var(--fonte-principal);font-size:max(9px, calc(12.5px * var(--escala-texto, 1)));padding:10px 18px;border-radius:8px;box-shadow:var(--shadow-lg);z-index:9999;}
</style>
