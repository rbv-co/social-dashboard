<template>
  <div class="moldura">
    <!-- Fundo animado global (orbs/anéis/ícones flutuantes). CSS em estilos-globais.css (#bg-shapes).
         Escondido em telas densas (ex.: admin) onde atrapalha a leitura. -->
    <div id="bg-shapes" aria-hidden="true" v-show="mostrarFundo">
      <div class="orb o1"></div>
      <div class="orb o2"></div>
      <div class="orb o3"></div>
      <div class="ring r1"></div>
      <div class="ring r2"></div>
      <div class="ring r3"></div>
      <div class="ico i1"><svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg></div>
      <div class="ico i2"><svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></div>
      <div class="ico i3"><svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg></div>
      <div class="ico i4"><svg width="70" height="70" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg></div>
      <div class="ico i5"><svg width="70" height="70" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8" fill="currentColor" opacity=".25" stroke="none"/></svg></div>
      <div class="ico i6"><svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg></div>
      <div class="ico i7"><svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg></div>
    </div>

    <!-- Perfil (avatar + menu) — canto superior direito, global, só quando logado.
         Restaura o badge de usuário do legado (setGlobalUserBtn): trocar senha e sair. -->
    <!-- O avatar fica SÓ na Central. Dentro de uma ferramenta ele disputava o canto
         superior direito com o que a tela punha ali, e cada tentativa de reservar
         espaço pra ele custava caro: uma quebrou 10 topbars, outra apertou barras
         que já estavam no limite. Quem quer trocar senha ou sair volta pra
         Central — um toque, e as barras ficam livres pro que é da ferramenta. -->
    <div v-if="estado.user && naTelaInicio" class="perfil-menu">
      <button class="perfil-avatar" type="button" @click="menuAberto = !menuAberto" :title="estado.user.email" aria-label="Menu do perfil">
        <img v-if="estado.avatarUrl" :src="estado.avatarUrl" alt="Perfil">
        <span v-else class="perfil-avatar-ph">{{ iniciais }}</span>
      </button>
      <template v-if="menuAberto">
        <div class="perfil-backdrop" @click="menuAberto = false"></div>
        <div class="perfil-dropdown">
          <div class="perfil-dropdown-email">{{ estado.user.email }}</div>
          <div class="perfil-dropdown-role" v-if="estado.role === 'admin'">Administrador</div>
          <div class="perfil-dropdown-sep"></div>
          <!-- Ativar notificações: só aparece enquanto NÃO ativou. Ativação é só
               de ida — depois de ativar, o item some (sem opção de desativar). -->
          <button v-if="pushSuportado() && !pushAtivo" class="perfil-dropdown-item" type="button" @click="ativarPush">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
            Ativar notificações
          </button>
          <button class="perfil-dropdown-item" type="button" @click="abrirTrocarSenha">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            Trocar senha
          </button>
          <button class="perfil-dropdown-item perfil-dropdown-sair" type="button" @click="sair">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            Sair
          </button>
        </div>
      </template>
    </div>

    <!-- Modal Trocar senha (o próprio usuário digita a nova senha) -->
    <!-- Os modais da MOLDURA também travam a rolagem do fundo. Eles ficaram de
         fora da primeira rodada, que cobriu as 9 telas — mas são os que mais
         aparecem, porque estão em cima de qualquer tela. -->
    <div v-if="trocarSenhaAberto" class="perfil-modal-overlay" v-trava-rolagem @click.self="fecharTrocarSenha">
      <div class="perfil-modal">
        <div class="perfil-modal-titulo">Trocar senha</div>
        <input class="perfil-modal-input" type="password" v-model="novaSenha" placeholder="Nova senha (mín. 6 caracteres)" autocomplete="new-password">
        <input class="perfil-modal-input" type="password" v-model="confirmaSenha" placeholder="Confirmar nova senha" autocomplete="new-password" @keyup.enter="salvarSenha">
        <div v-if="msgSenha" class="perfil-modal-msg" :class="{ erro: msgErro }">{{ msgSenha }}</div>
        <div class="perfil-modal-acoes">
          <button class="perfil-modal-btn" type="button" @click="fecharTrocarSenha" :disabled="salvando">Cancelar</button>
          <button class="perfil-modal-btn primario" type="button" @click="salvarSenha" :disabled="salvando">{{ salvando ? 'Salvando…' : 'Salvar' }}</button>
        </div>
      </div>
    </div>

    <!-- Ajustes de leitura: UM botão só, no canto, abrindo tema e zoom.
         Antes eram dois botões flutuantes disputando o mesmo canto da tela do
         celular. O zoom vale para a Central INTEIRA (aplicado no conteúdo da
         rota), então cada ferramenta não precisa mais do seu próprio.
         Ícone = sol/lua, não engrenagem: engrenagem virou "configurar cadastro"
         dentro das ferramentas (as Listas do Patrimônio), e duas engrenagens
         com significados diferentes na mesma tela confundem. Aqui é APARÊNCIA. -->
    <button class="btn-ajustes" type="button" @click="ajustesAbertos = !ajustesAbertos"
            title="Tema e tamanho da letra" aria-label="Tema e tamanho da letra">
      <svg v-if="temaEscuro" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
      <svg v-else width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
    </button>

    <div class="ajustes-fundo" v-if="ajustesAbertos" v-trava-rolagem @click.self="ajustesAbertos = false">
      <div class="ajustes-caixa">
        <div class="ajustes-linha">
          <span class="ajustes-rot">Tema</span>
          <div class="ajustes-grupo">
            <button :class="{ ativo: !temaEscuro }" @click="aplicarTema(false)">Claro</button>
            <button :class="{ ativo: temaEscuro }" @click="aplicarTema(true)">Escuro</button>
          </div>
        </div>
        <div class="ajustes-linha">
          <span class="ajustes-rot">Tamanho</span>
          <div class="ajustes-grupo">
            <button @click="mudarZoom(-0.1)" aria-label="Diminuir">−</button>
            <span class="ajustes-val" @click="aplicarZoom(1)" title="Voltar a 100%">{{ Math.round(zoom * 100) }}%</span>
            <button @click="mudarZoom(0.1)" aria-label="Aumentar">+</button>
          </div>
        </div>
        <button class="ajustes-pronto" @click="ajustesAbertos = false">Pronto</button>
      </div>
    </div>

    <!-- Modal insistente de opt-in (só botão Ativar agora; some ao ativar/negar).
         O controle permanente de ativar fica no menu do avatar, só enquanto não
         ativou — ativação é só de ida (sem desativar). -->
    <div v-if="mostrarModalPush" class="np-modal-fundo" v-trava-rolagem>
      <div class="np-modal">
        <div class="np-modal-emoji">🔔</div>
        <h3>Ativar notificações</h3>
        <p>Receba avisos importantes da Central direto no seu celular.</p>
        <button class="np-modal-ativar" type="button" @click="ativarPush" :disabled="ativandoPush">
          {{ ativandoPush ? 'Ativando…' : 'Ativar agora' }}
        </button>
        <!-- O RECADO DO QUE DEU ERRADO fica AQUI, no convite, e não num aviso
             que some sozinho: é uma instrução para seguir, não um alerta. -->
        <p v-if="recadoPush" class="np-modal-recado">{{ recadoPush }}</p>
        <!-- Sem esta saída, o convite voltava em TODA abertura: quem fechava o
             prompt do navegador passava da parede, mas a permissão continuava
             'default' e no dia seguinte a parede estava lá. Quem dispensa não
             perde nada — o botão de ativar fica no menu do avatar. -->
        <button class="np-modal-depois" type="button" @click="dispensarPush">Agora não</button>
      </div>
    </div>

    <!-- O zoom NÃO mora mais aqui. Ele era aplicado neste `div`, e por isso
         alcançava só o conteúdo da rota: modal e barra de topo são
         `position:fixed`, saem deste elemento e o navegador os desenhava em
         tamanho cheio. O dono relatou em 12/08/2026: "no meu celular estou
         usando zoom 60% e ainda continua tudo muito grande" — e estava mesmo,
         porque MODAL é onde ele passa a maior parte do tempo e o modal ficava
         em 100%. Agora o zoom vai na raiz do documento (ver `aplicarZoom`),
         onde alcança a Central inteira, como o nome sempre prometeu. -->
    <div class="conteudo-da-rota">
      <router-view />
    </div>

    <!-- Avisa quando sai versão nova. Fica na MOLDURA, não numa ferramenta:
         o app fica aberto por dias e o deploy tem que alcançar quem estiver em
         qualquer tela. Ele se teletransporta pro <body>, então o `zoom` acima
         não o desloca. -->
    <aviso-de-atualizacao />

    <!-- TROCA OBRIGATÓRIA DA SENHA INICIAL.
         Contas criadas em lote (as vendedoras) nascem com uma senha que outra
         pessoa digitou e entregou. Enquanto ela não for trocada, quem entregou
         consegue entrar. Marcar isso no cadastro sem cobrar seria promessa não
         cumprida — então a cobrança fica AQUI, na moldura, que está em toda
         rota. Sem botão de fechar de propósito: sair só trocando ou saindo. -->
    <!-- Este é o mais importante dos três: a troca obrigatória de senha não tem
         como ser dispensada, então deixar o fundo rolar convida a pessoa a
         tentar usar o app por trás de uma parede. -->
    <div v-if="estado.precisa_trocar_senha" class="ts-fundo" v-trava-rolagem>
      <div class="ts-caixa">
        <h2>Escolha uma senha sua</h2>
        <p>Esta conta foi criada com uma senha provisória, que alguém digitou e te entregou.
           Enquanto ela valer, essa pessoa também consegue entrar. Escolha uma senha que só você saiba.</p>
        <input v-model="senha1" type="password" placeholder="Nova senha (mínimo 8 letras/números)" autocomplete="new-password">
        <input v-model="senha2" type="password" placeholder="Repita a nova senha" autocomplete="new-password">
        <p v-if="erroSenha" class="ts-erro">{{ erroSenha }}</p>
        <div class="ts-acoes">
          <button type="button" class="ts-ok" :disabled="salvandoSenha" @click="trocarSenhaAgora">
            {{ salvandoSenha ? 'Salvando…' : 'Salvar e continuar' }}
          </button>
          <button type="button" class="ts-sair" @click="sairDaConta">Sair</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import AvisoDeAtualizacao from './compartilhado/aviso-de-atualizacao.vue'
import { useRouter, useRoute } from 'vue-router'
import { estado } from './compartilhado/controle-de-login-e-usuario.js'
import { sbClient } from './compartilhado/conectar-no-banco-de-dados.js'
import { inscrever, jaInscrito, permissaoAtual, pushSuportado, registrarSW, devePedirPush, deveInscreverEmSilencio, observarPermissao } from './compartilhado/notificacoes-push.js'
import { recadoDoPush, deuCerto } from './compartilhado/recado-do-push.js'
// O recado do push tambem sai por aqui quando o convite nao esta aberto (o
// caminho do menu do avatar). Sem este import era ReferenceError no clique.
import { adminToast } from './compartilhado/avisos.js'
// Trava a rolagem do fundo enquanto um modal legado (JavaScript puro, sem
// v-if) estiver aberto — Acessos, Admin, Redes Sociais, Gestão Comercial e
// Gestão de Tráfego. Fica na MOLDURA, e não em cada tela, pelo mesmo motivo
// do aviso de versão nova: um observador só, ligado uma vez, vale pra todas.
import { observarModaisLegados, fecharTodosOsModaisLegadosAoTrocarDeRota } from './compartilhado/observar-modais-legados.js'
// Mantém a aba ATIVA dentro da vista na barra global `.abas`, que desde
// 02/09/2026 rola por dentro no celular em vez de quebrar em duas linhas. Fica
// aqui pelo mesmo motivo do observador acima: um só, ligado uma vez, vale para
// as quatro telas que usam a classe — e para a quinta que vier.
import { observarAbaAtiva } from './compartilhado/aba-ativa-a-vista.js'

const router = useRouter()

// ── A troca obrigatória da senha inicial ────────────────────────────────────
const senha1 = ref('')
const senha2 = ref('')
const erroSenha = ref('')
const salvandoSenha = ref(false)

async function trocarSenhaAgora() {
  erroSenha.value = ''
  // OITO, e não seis. Seis é o mínimo que o Supabase aceita; numa conta que vê
  // faturamento, o mínimo do servidor não é o mínimo razoável.
  if ((senha1.value || '').length < 8) { erroSenha.value = 'A senha precisa de pelo menos 8 letras ou números.'; return }
  if (senha1.value !== senha2.value) { erroSenha.value = 'As duas senhas estão diferentes.'; return }
  salvandoSenha.value = true
  try {
    const { error } = await sbClient.auth.updateUser({ password: senha1.value })
    if (error) throw new Error(error.message)
    // A MARCA SÓ CAI DEPOIS que a senha trocou de verdade. Na ordem inversa,
    // uma falha na troca deixaria a conta com a senha provisória e sem cobrança.
    //
    // POR RPC, E NÃO POR UPDATE DIRETO: `profiles` só aceita UPDATE de quem é
    // admin (política admin_update_profiles). Para todo mundo mais, o update
    // casava com ZERO linhas — e o PostgREST devolve SUCESSO SEM ERRO nesse
    // caso. A marca ficava no banco e a pessoa era cobrada de novo no login
    // seguinte, todos os dias. Duas pessoas do time de vendas viveram isso.
    const { data: marcou, error: e2 } = await sbClient.rpc('marcar_senha_trocada')
    if (e2) throw new Error(e2.message)
    // E conferir o RETORNO, não só a ausência de erro: é a diferença entre
    // "gravou" e "não deu erro", que aqui custou dias de incômodo.
    if (marcou !== true) throw new Error('a senha foi trocada, mas não consegui registrar isso. Recarregue e tente de novo.')
    estado.precisa_trocar_senha = false
    senha1.value = ''; senha2.value = ''
  } catch (e) {
    erroSenha.value = 'Não consegui salvar: ' + String(e && e.message || e)
  } finally {
    salvandoSenha.value = false
  }
}

async function sairDaConta() {
  try { await sbClient.auth.signOut() } catch (e) {}
  window.location.href = '/'
}
const route = useRoute()

/* ── Perfil ── */
const menuAberto = ref(false)
const naTelaLogin = computed(() => route.name === 'login')
const naTelaInicio = computed(() => route.name === 'inicio')
// Fundo animado some em telas densas onde vira ruído visual (admin).
/* O fundo animado (7 ícones, 3 orbes, 3 anéis) só existe onde alguém OLHA a
 * tela: a Gestão à Vista, que fica na TV, e a página de entrada. Nas telas de
 * trabalho ele sai.
 *
 * A LISTA VIROU DO AVESSO em 12/08/2026, a pedido do dono: "os elementos de
 * fundo podem sair né? deixar somente no gestão à vista, porque tá atrapalhando
 * a visualização principalmente no celular". Antes era uma lista de EXCEÇÕES —
 * o fundo aparecia em 27 das 29 telas e saía só em duas —, e cada tela nova
 * nascia com ele por acidente. Agora é o contrário: quem quiser fundo entra
 * nesta lista de propósito.
 *
 * O raciocínio já existia e só não tinha sido levado a sério: o Admin já tinha
 * sido tirado justamente por ser "tela densa onde atrapalha a leitura". Toda
 * tela de trabalho é densa. */
const COM_FUNDO = ['inicio', 'gestao-vista']
const mostrarFundo = computed(() => COM_FUNDO.includes(route.name))
const iniciais = computed(() => {
  const email = estado.user?.email || ''
  return (email.trim()[0] || '?').toUpperCase()
})

async function sair() {
  menuAberto.value = false
  try { await sbClient.auth.signOut() } catch (e) { /* segue para o login de qualquer forma */ }
  router.push({ name: 'login' })
}

/* ── Trocar senha (o usuário digita a própria senha nova) ── */
const trocarSenhaAberto = ref(false)
const novaSenha = ref('')
const confirmaSenha = ref('')
const msgSenha = ref('')
const msgErro = ref(false)
const salvando = ref(false)

function abrirTrocarSenha() {
  menuAberto.value = false
  novaSenha.value = ''
  confirmaSenha.value = ''
  msgSenha.value = ''
  msgErro.value = false
  trocarSenhaAberto.value = true
}
function fecharTrocarSenha() {
  if (salvando.value) return
  trocarSenhaAberto.value = false
}
async function salvarSenha() {
  msgErro.value = false
  if (novaSenha.value.length < 6) { msgErro.value = true; msgSenha.value = 'A senha precisa de pelo menos 6 caracteres.'; return }
  if (novaSenha.value !== confirmaSenha.value) { msgErro.value = true; msgSenha.value = 'As senhas não coincidem.'; return }
  salvando.value = true
  msgSenha.value = ''
  try {
    const { error } = await sbClient.auth.updateUser({ password: novaSenha.value })
    if (error) { msgErro.value = true; msgSenha.value = 'Não deu pra trocar: ' + error.message }
    else {
      msgSenha.value = 'Senha alterada com sucesso!'
      setTimeout(() => { trocarSenhaAberto.value = false }, 1200)
    }
  } catch (e) {
    msgErro.value = true; msgSenha.value = 'Erro inesperado ao trocar a senha.'
  } finally {
    salvando.value = false
  }
}

/* ── Notificações de vendas (Web Push) ── */
const mostrarModalPush = ref(false)
// A tela precisa dizer que está trabalhando e o que deu errado. Sem estes
// dois, o botão ficava mudo enquanto a inscrição rodava — o "fica travado"
// que o dono relatou — e sumia sem explicação quando falhava.
const ativandoPush = ref(false)
const recadoPush = ref('')
const pushAtivo = ref(false)

// Lembrado POR APARELHO: "não quero ser perguntado neste navegador". Fica no
// localStorage e não no perfil de propósito — a pessoa pode querer o aviso no
// celular e não no computador da loja, e são navegadores diferentes.
const DISPENSOU_PUSH = 'push-dispensado-v1'
const dispensouPush = () => { try { return localStorage.getItem(DISPENSOU_PUSH) === '1' } catch { return false } }

async function avaliarPush() {
  if (!estado.user || !pushSuportado()) return
  pushAtivo.value = await jaInscrito()
  const situacao = {
    suportado: pushSuportado(),
    permissao: permissaoAtual(),
    inscrito: pushAtivo.value,
    dispensou: dispensouPush(),
  }
  // Aparelho já autorizou mas perdeu a inscrição (limpou dados, trocou de
  // navegador, assinatura expirada): reinscreve CALADO. Com a permissão já
  // concedida o navegador não abre prompt nenhum — pedir de novo seria pedir
  // o que já foi dado, que é justamente a reclamação do dono.
  if (deveInscreverEmSilencio(situacao)) {
    // `inscrever` passou a devolver { ok, motivo } — ler como booleano daria
    // sempre verdadeiro, porque objeto é verdadeiro. Aqui o silêncio é de
    // propósito: com a permissão já dada, não há nada a perguntar nem a avisar.
    const ok = deuCerto(await inscrever(estado.user?.id))
    pushAtivo.value = ok
    situacao.inscrito = ok
  }
  mostrarModalPush.value = devePedirPush(situacao)
  observarPermissaoDoNavegador()
}

async function ativarPush() {
  if (ativandoPush.value) return // clique duplo não dispara duas inscrições
  menuAberto.value = false // fecha o menu do avatar se veio de lá
  ativandoPush.value = true
  recadoPush.value = ''
  try {
    const r = await inscrever(estado.user?.id)
    const ok = deuCerto(r)
    pushAtivo.value = ok
    if (ok) {
      // Ativou de verdade: a dispensa de antes não faz mais sentido.
      try { localStorage.removeItem(DISPENSOU_PUSH) } catch {}
      mostrarModalPush.value = false
      return
    }
    // NÃO fecha o convite quando falha. Fechar calado foi o defeito: a pessoa
    // ficava sem saber se ativou, e o único caminho que sobrava era adivinhar.
    recadoPush.value = recadoDoPush(r && r.motivo)
    if (!mostrarModalPush.value) adminToast(recadoPush.value, false)
  } finally {
    ativandoPush.value = false
  }
}

// AUTORIZAR PELO NAVEGADOR passa a valer NA HORA.
//
// É o caminho que o dono achou sozinho: clicar no ícone ao lado do endereço e
// escolher Permitir. Até aqui a Central só percebia isso na próxima abertura —
// a pessoa autorizava e continuava sem aviso nenhum, sem entender por quê.
// Agora, quando a permissão vira 'granted' por fora, a inscrição acontece
// sozinha e o convite se fecha.
let _pararDeObservarPermissao = null
async function observarPermissaoDoNavegador() {
  if (_pararDeObservarPermissao) return
  _pararDeObservarPermissao = await observarPermissao(async (estadoDaPermissao) => {
    if (estadoDaPermissao !== 'granted' || !estado.user) return
    const ok = deuCerto(await inscrever(estado.user?.id))
    pushAtivo.value = ok
    if (ok) {
      recadoPush.value = ''
      mostrarModalPush.value = false
      try { localStorage.removeItem(DISPENSOU_PUSH) } catch {}
    }
  })
}

function dispensarPush() {
  try { localStorage.setItem(DISPENSOU_PUSH, '1') } catch {}
  mostrarModalPush.value = false
}

/* ── Tema claro/escuro (global, persiste) ── */
const temaEscuro = ref(false)
function aplicarTema(escuro) {
  temaEscuro.value = escuro
  document.documentElement.dataset.theme = escuro ? 'dark' : 'light'
  localStorage.setItem('tema', escuro ? 'dark' : 'light')
}
/* ── Ajustes de leitura: tema + zoom, num painel só ── */
const ajustesAbertos = ref(false)

// Zoom da Central inteira. Fica aqui, e não em cada ferramenta, porque era isso
// que enchia o canto da tela do celular de botões flutuantes repetidos.
// 60%–200%: abaixo disso o texto some, acima cabe uma linha por tela.
const zoom = ref(1)
function aplicarZoom(z) {
  zoom.value = Math.min(2, Math.max(0.6, Math.round(z * 10) / 10))
  // NA RAIZ, e é isto que faz o zoom valer "na Central toda": modal, barra de
  // topo e qualquer coisa `position:fixed` vivem fora do `div` do conteúdo, e
  // antes ficavam sempre em 100%. `zoom` no elemento raiz cria um sistema de
  // coordenadas novo, então o que é fixo escala junto — o que `transform:scale`
  // não faria (ele deslocaria os fixos em vez de redimensioná-los, que é a
  // armadilha registrada no comentário antigo do template).
  // O CONTROLE MEXE SÓ NA LETRA (pedido do dono, 12/08/2026: "o zoom vale pra
  // texto somente; o quadrado, os blocos, ficam do mesmo jeito"). Antes ele era
  // `zoom` de CSS, que encolhe a caixa junto — o modal virava um quadradinho.
  // Agora é uma escala que multiplica cada `font-size` do aplicativo, via
  // `--escala-texto`: a caixa fica onde está, a margem fica, e só o texto muda.
  //
  // As 1.571 declarações de tamanho viraram `calc(Npx * var(--escala-texto))`.
  // As de 16px pra cima ganharam piso de 16px — é o tamanho dos campos de
  // digitar, e abaixo disso o iPhone dá zoom sozinho ao tocar e a tela inteira
  // pula, que é pior que letra grande.
  //
  // A barra de topo não precisa de compensação: o texto dela também é `font-size`
  // e escalaria junto, então ela entra na lista de exceção em estilos-globais.css
  // ("a barra de topo você pode deixar de fora, ficou perfeita").
  try {
    document.documentElement.style.setProperty('--escala-texto', String(zoom.value))
  } catch (e) { /* sem DOM: nada a fazer */ }
  try { localStorage.setItem('zoom-central', String(zoom.value)) } catch (e) { /* modo privado */ }
}
function mudarZoom(passo) { aplicarZoom(zoom.value + passo) }

onMounted(() => {
  aplicarTema(localStorage.getItem('tema') === 'dark')
  aplicarZoom(Number(localStorage.getItem('zoom-central')) || 1)
  // Registra o SW de push já no boot (não depende de opt-in) pra a entrega
  // funcionar de cara pra quem já ativou noutra sessão.
  if (pushSuportado()) registrarSW().catch(() => {})
  avaliarPush()
  observarModaisLegados()
  observarAbaAtiva()
})
// estado.user pode chegar depois do boot (sessão assíncrona) -> reavaliar.
watch(() => estado.user?.id, avaliarPush)

// Ao trocar de rota, força o fechamento de qualquer modal legado que tenha
// ficado aberto — a tela que o abriu já foi embora, então ninguém mais vai
// clicar no "✕" dele. Sem isto a rolagem ficaria travada na tela NOVA, sem
// modal nenhum visível nela (ver o porquê completo em observar-modais-legados.js).
router.afterEach(() => fecharTodosOsModaisLegadosAoTrocarDeRota())
</script>

<style scoped>
/* ── Perfil ── */
/* top respeita a área segura do iOS (notch / Dynamic Island) — senão o avatar
   fica embaixo do entalhe no iPhone com o app na Tela de Início. */
.perfil-menu { position: fixed; top: calc(env(safe-area-inset-top, 0px) + 14px); right: 18px; z-index: 9999; }
.perfil-avatar {
  width: 40px; height: 40px; border-radius: 50%; padding: 0; overflow: hidden;
  border: 2px solid var(--border); background: var(--surface2); cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  box-shadow: var(--shadow-sm); transition: border-color .15s ease, transform .15s ease;
}
.perfil-avatar:hover { border-color: var(--accent); transform: translateY(-1px); }
.perfil-avatar:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.perfil-avatar img { width: 100%; height: 100%; object-fit: cover; }
.perfil-avatar-ph {
  font-family: var(--fonte-principal); font-size: 17px; font-weight: 600;
  color: var(--sobre-cor); background: var(--accent); width: 100%; height: 100%;
  display: flex; align-items: center; justify-content: center;
}
.perfil-backdrop { position: fixed; inset: 0; z-index: 9998; }
.perfil-dropdown {
  position: absolute; top: 48px; right: 0; z-index: 9999; min-width: 210px;
  background: var(--surface); border: 1px solid var(--border); border-radius: 12px;
  box-shadow: var(--shadow-lg); padding: 8px; font-family: var(--fonte-principal);
}
.perfil-dropdown-email { font-size: 12.5px; color: var(--text); font-weight: 600; padding: 6px 8px 2px; word-break: break-all; }
.perfil-dropdown-role { font-size: 10.5px; color: var(--accent); text-transform: uppercase; letter-spacing: .6px; padding: 0 8px 4px; }
.perfil-dropdown-sep { height: 1px; background: var(--border); margin: 6px 4px; }
.perfil-dropdown-item {
  display: flex; align-items: center; gap: 9px; width: 100%; text-align: left;
  background: none; border: none; cursor: pointer; padding: 9px 8px; border-radius: 8px;
  font-size: 13px; color: var(--text); transition: background .12s ease;
}
.perfil-dropdown-item:hover { background: var(--accent-light); }
.perfil-dropdown-item svg { color: var(--muted); flex-shrink: 0; }
.perfil-dropdown-sair { color: var(--red); }
.perfil-dropdown-sair svg { color: var(--red); }

/* ── Modal Trocar senha ── */
.perfil-modal-overlay {
  position: fixed; inset: 0; z-index: 10000; background: rgba(0,0,0,.45);
  display: flex; align-items: center; justify-content: center; padding: 20px;padding-top:max(16px,env(safe-area-inset-top));padding-bottom:max(16px,env(safe-area-inset-bottom));padding-left:max(12px,env(safe-area-inset-left));padding-right:max(12px,env(safe-area-inset-right));touch-action:none;overscroll-behavior:contain;}
/* ── Modal Trocar senha ── */
.perfil-modal-overlay > *{overscroll-behavior:contain;touch-action:pan-y;}
.perfil-modal {
  background: var(--surface); border: 1px solid var(--border); border-radius: 14px;
  box-shadow: var(--shadow-lg); padding: 22px; width: 100%; max-width: 340px;
  font-family: var(--fonte-principal); display: flex; flex-direction: column; gap: 12px;
}
.perfil-modal-titulo { font-size: 16px; font-weight: 700; color: var(--text); }
.perfil-modal-input {
  width: 100%; box-sizing: border-box; padding: 11px 12px; border-radius: 8px;
  border: 1px solid var(--border); background: var(--surface2); color: var(--text);
  font-size: 13.5px; font-family: inherit;
}
.perfil-modal-input:focus { outline: none; border-color: var(--accent); }
.perfil-modal-msg { font-size: 12.5px; color: var(--green); }
.perfil-modal-msg.erro { color: var(--red); }
.perfil-modal-acoes { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
.perfil-modal-btn {
  padding: 9px 16px; border-radius: 8px; border: 1px solid var(--border);
  background: transparent; color: var(--text); font-size: 13px; cursor: pointer;
  font-family: inherit; transition: all .14s ease;
}
.perfil-modal-btn:hover:not(:disabled) { border-color: var(--accent); }
.perfil-modal-btn.primario { background: var(--accent); border-color: var(--accent); color: var(--sobre-cor); }
.perfil-modal-btn:disabled { opacity: .6; cursor: default; }

/* ── Ajustes de leitura (tema + zoom): UM botão, menor que os dois de antes ── */
.btn-ajustes {
  position: fixed; bottom: calc(env(safe-area-inset-bottom, 0px) + 16px); right: 16px; z-index: 9998;
  width: 34px; height: 34px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: var(--surface); color: var(--muted); border: 1px solid var(--border);
  box-shadow: var(--shadow-md); cursor: pointer; opacity: .82;
  transition: opacity .15s ease, color .15s ease, transform .15s ease;
}
.btn-ajustes:hover { opacity: 1; color: var(--accent); transform: translateY(-1px); }
.btn-ajustes:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; opacity: 1; }

.ajustes-fundo { position: fixed; inset: 0; z-index: 9999; display: flex; align-items: flex-end; justify-content: flex-end; padding: 16px; background: rgba(0,0,0,.28);touch-action:none;overscroll-behavior:contain;}
.ajustes-fundo > *{overscroll-behavior:contain;touch-action:pan-y;}
.ajustes-caixa { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; box-shadow: var(--shadow-lg); padding: 14px; width: 100%; max-width: 280px; display: flex; flex-direction: column; gap: 12px; font-family: var(--fonte-principal); }
.ajustes-linha { display: flex; align-items: center; gap: 10px; }
.ajustes-rot { flex: 1; font-size: 11px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: var(--muted); }
.ajustes-grupo { display: flex; align-items: center; gap: 4px; border: 1px solid var(--border); border-radius: 9px; padding: 3px; }
.ajustes-grupo button { min-width: 32px; height: 30px; padding: 0 9px; border: none; background: none; border-radius: 7px; font-family: var(--fonte-principal); font-size: 12px; font-weight: 600; color: var(--text); cursor: pointer; touch-action: manipulation; }
.ajustes-grupo button.ativo { background: var(--accent); color: var(--sobre-cor); }
.ajustes-val { min-width: 44px; text-align: center; font-size: 11px; font-weight: 600; color: var(--muted); cursor: pointer; user-select: none; font-variant-numeric: tabular-nums; }
.ajustes-pronto { width: 100%; height: 36px; border: none; border-radius: 9px; background: var(--accent); color: var(--sobre-cor); font-family: var(--fonte-principal); font-size: 13px; font-weight: 600; cursor: pointer; touch-action: manipulation; }


/* ── Modal de notificações (Web Push) — prefixo np- único (evita colisão CSS global) ── */
.np-modal-fundo {
  position: fixed; inset: 0; background: rgba(0,0,0,.6); z-index: 10001;
  display: flex; align-items: center; justify-content: center; padding: 20px;padding-top:max(16px,env(safe-area-inset-top));padding-bottom:max(16px,env(safe-area-inset-bottom));padding-left:max(12px,env(safe-area-inset-left));padding-right:max(12px,env(safe-area-inset-right));touch-action:none;overscroll-behavior:contain;}
/* ── Modal de notificações (Web Push) — prefixo np- único (evita colisão CSS global) ── */
.np-modal-fundo > *{overscroll-behavior:contain;touch-action:pan-y;}
.np-modal {
  background: var(--surface); color: var(--text); border: 1px solid var(--border);
  border-radius: 16px; box-shadow: var(--shadow-lg); padding: 28px 24px;
  max-width: 340px; width: 100%; text-align: center; font-family: var(--fonte-principal);
}
.np-modal-emoji { font-size: 40px; line-height: 1; }
.np-modal h3 { margin: 10px 0 6px; font-size: 17px; color: var(--text); }
.np-modal p { opacity: .8; font-size: 13.5px; line-height: 1.45; margin: 0; }
.np-modal-ativar {
  margin-top: 18px; width: 100%; padding: 12px; border: 0; border-radius: 10px;
  background: var(--accent); color: var(--sobre-cor); font-weight: 700; font-size: 14px;
  cursor: pointer; font-family: inherit; min-height: 40px;
}
.np-modal-ativar[disabled] { opacity: .65; cursor: progress; }
/* O RECADO DE QUANDO NÃO DEU CERTO. Laranja de aviso, e não vermelho de erro:
   na maioria dos casos não quebrou nada — falta um passo, e o texto diz qual.
   Alinhado à esquerda de propósito: é instrução para seguir, não anúncio. */
.np-modal-recado {
  margin-top: 12px; text-align: left; font-size: 12.5px; line-height: 1.5;
  color: color-mix(in srgb, var(--orange) 78%, var(--text));
  background: color-mix(in srgb, var(--orange) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--orange) 35%, transparent);
  border-radius: 8px; padding: 10px 12px;
}
/* Saída do convite. Botão comum: borda + fundo transparente, nunca cinza
   (padrão da Central, item 3). 40px de alvo porque dedo não acerta menos. */
.np-modal-depois {
  margin-top: 8px; width: 100%; padding: 12px; min-height: 40px;
  border: 1px solid var(--border); border-radius: 10px; background: transparent;
  color: var(--muted); font-size: 13px; cursor: pointer; font-family: inherit;
}
</style>

<style scoped>
.ts-fundo { position: fixed; inset: 0; z-index: 99998; background: rgba(0,0,0,.72);
  display: flex; align-items: center; justify-content: center; padding: 20px;touch-action:none;overscroll-behavior:contain;}
.ts-fundo > *{overscroll-behavior:contain;touch-action:pan-y;}
.ts-caixa { background: var(--surface, #fff); color: var(--text, #111); border-radius: 14px;
  max-width: 420px; width: 100%; padding: 26px; box-shadow: 0 24px 60px rgba(0,0,0,.45);
  font-family: var(--fonte-principal); }
.ts-caixa h2 { font-size: 17px; font-weight: 800; margin: 0 0 8px; }
.ts-caixa p { font-size: 13px; color: var(--muted, #666); line-height: 1.55; margin: 0 0 16px; }
.ts-caixa input { width: 100%; padding: 10px 12px; border-radius: 9px; border: 1px solid var(--border, #ddd);
  background: var(--surface2, #f7f7f7); color: var(--text, #111); font-size: 13px; margin-bottom: 10px; }
.ts-erro { color: var(--red, #dc2626); font-size: 12.5px; margin: 0 0 10px !important; }
.ts-acoes { display: flex; gap: 10px; justify-content: flex-end; }
.ts-ok { border: none; background: var(--accent, #4f7cff); color: #fff; border-radius: 9px;
  padding: 10px 18px; font-size: 13px; font-weight: 700; cursor: pointer; }
.ts-ok:disabled { opacity: .6; cursor: default; }
.ts-sair { border: 1px solid var(--border, #ddd); background: none; color: var(--text, #111);
  border-radius: 9px; padding: 10px 14px; font-size: 13px; cursor: pointer; }
</style>
