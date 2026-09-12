<template>
  <div class="tela-login">
    <canvas id="auth-bg-canvas" ref="canvasRef"></canvas>
    <div class="auth-card">
      <div class="auth-logo">
        <img class="rbv-logo rbv-logo-light" :src="logoClaroUrl" alt="RBV" style="margin:0 auto 14px;height:32px;">
        <img class="rbv-logo rbv-logo-dark" :src="logoEscuroUrl" alt="RBV" style="margin:0 auto 14px;height:32px;">
        <h2>Inteligência RBV</h2>
        <p>RBV COMPANY</p>
      </div>

      <!-- Login -->
      <div v-show="view === 'login'">
        <div class="auth-field">
          <label class="auth-label">Email</label>
          <input type="email" v-model="email" class="auth-input" placeholder="seu@email.com" autocomplete="email" @keydown.enter="entrar">
        </div>
        <div class="auth-field">
          <label class="auth-label">Senha</label>
          <input type="password" v-model="senha" class="auth-input" placeholder="••••••••" autocomplete="current-password" @keydown.enter="entrar">
        </div>
        <button class="auth-btn" :disabled="loginCarregando" @click="entrar">{{ loginBtnTexto }}</button>
        <div class="auth-error" v-if="loginErro">{{ loginErro }}</div>
        <div class="auth-link-row">
          <button class="auth-link" @click="view = 'forgot'">Esqueci a senha</button>
          <button class="auth-link" @click="view = 'request'">Solicitar acesso</button>
        </div>
      </div>

      <!-- Set password (invite flow) -->
      <div v-show="view === 'set-pass'">
        <p class="auth-info" style="margin-bottom:20px">{{ textoSetPass }}</p>
        <div class="auth-field">
          <label class="auth-label">Nova senha</label>
          <input type="password" v-model="novaSenha" class="auth-input" placeholder="mínimo 6 caracteres">
        </div>
        <div class="auth-field">
          <label class="auth-label">Confirmar senha</label>
          <input type="password" v-model="confirmarSenha" class="auth-input" placeholder="repita a senha">
        </div>
        <button class="auth-btn" :disabled="setPassCarregando" @click="definirSenha">{{ setPassBtnTexto }}</button>
        <div class="auth-error" v-if="setPassErro">{{ setPassErro }}</div>
      </div>

      <!-- Forgot password -->
      <div v-show="view === 'forgot'">
        <button class="auth-back-link" @click="view = 'login'">← Voltar</button>
        <p class="auth-info" style="margin-bottom:18px;font-size:max(9px, calc(12px * var(--escala-texto, 1)))">Digite seu email e enviaremos um link para redefinir sua senha.</p>
        <div class="auth-field">
          <label class="auth-label">Email</label>
          <input type="email" v-model="forgotEmail" class="auth-input" placeholder="seu@email.com">
        </div>
        <button class="auth-btn" :disabled="forgotCarregando" @click="esqueciSenha">{{ forgotBtnTexto }}</button>
        <div class="auth-error" v-if="forgotMsg" :style="{ color: forgotMsgCor }">{{ forgotMsg }}</div>
      </div>

      <!-- Request access -->
      <div v-show="view === 'request'">
        <button class="auth-back-link" @click="view = 'login'">← Voltar</button>
        <p class="auth-info" style="margin-bottom:18px;font-size:max(9px, calc(12px * var(--escala-texto, 1)))">Preencha os dados abaixo. Sua solicitação será analisada pelo administrador.</p>
        <div class="auth-field">
          <label class="auth-label">Nome</label>
          <input type="text" v-model="reqNome" class="auth-input" placeholder="Seu nome completo">
        </div>
        <div class="auth-field">
          <label class="auth-label">Email</label>
          <input type="email" v-model="reqEmail" class="auth-input" placeholder="seu@email.com">
        </div>
        <div class="auth-field">
          <label class="auth-label">Mensagem (opcional)</label>
          <input type="text" v-model="reqMensagem" class="auth-input" placeholder="Por que precisa de acesso?">
        </div>
        <button class="auth-btn" v-show="!reqEnviado" :disabled="reqCarregando" @click="solicitarAcesso">{{ reqBtnTexto }}</button>
        <div class="auth-error" v-if="reqFeedback" :style="{ color: reqFeedbackCor }">{{ reqFeedback }}</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { sbClient } from '../../compartilhado/conectar-no-banco-de-dados.js'
import { setSession, carregarPerfil } from '../../compartilhado/controle-de-login-e-usuario.js'

const router = useRouter()

// Caminho absoluto: servido em produção via rewrite do Vercel (/midia/:path*),
// igual ao legado. Ligação dinâmica (:src) evita que o Vite tente resolver
// o caminho como módulo em tempo de build.
const logoClaroUrl = '/midia/LOGOTIPOBRENOPRETO.png'
const logoEscuroUrl = '/midia/LOGOTIPOBRENOBRANCO.png'

// Alterna entre login / set-pass (convite) / forgot / request-access —
// equivalente a showAuthView() no legado.
//
// Abre direto no formulário de senha nova quando a pessoa chegou por link de
// recuperação ou convite (o boot detectou e guardou em window.__fluxoDeSenha).
const view = ref(window.__fluxoDeSenha ? 'set-pass' : 'login')

/* ── Login (doLogin) ── */
const email = ref('')
const senha = ref('')
const loginErro = ref('')
const loginCarregando = ref(false)
const loginBtnTexto = computed(() => (loginCarregando.value ? 'Entrando...' : 'Entrar'))

async function entrar() {
  loginErro.value = ''
  loginCarregando.value = true
  const { data, error } = await sbClient.auth.signInWithPassword({
    email: email.value.trim(),
    password: senha.value,
  })
  loginCarregando.value = false
  if (error) {
    loginErro.value = error.message === 'Invalid login credentials'
      ? 'Email ou senha incorretos.'
      : error.message
    return
  }
  // Navega diretamente após sucesso (mesma lógica do legado: evita depender
  // só de onAuthStateChange, que pertence à inicialização geral do app).
  if (data?.session) {
    setSession(data.session)
    await carregarPerfil(data.session)
    router.push({ name: 'inicio' })
  }
}

/* ── Definir senha / convite (doSetPassword) ──
   Aberta automaticamente quando o boot detecta type=recovery/invite na URL
   (ver detectar-fluxo-de-senha.js). */
const textoSetPass = window.__fluxoDeSenha === 'recovery'
  ? 'Crie uma senha nova para voltar a acessar o painel.'
  : 'Você foi convidado! Crie sua senha para acessar o painel.'
const novaSenha = ref('')
const confirmarSenha = ref('')
const setPassErro = ref('')
const setPassCarregando = ref(false)
const setPassBtnTexto = computed(() => (setPassCarregando.value ? 'Salvando...' : 'Definir senha e entrar'))

async function definirSenha() {
  setPassErro.value = ''
  if (novaSenha.value.length < 6) {
    setPassErro.value = 'A senha deve ter ao menos 6 caracteres.'
    return
  }
  if (novaSenha.value !== confirmarSenha.value) {
    setPassErro.value = 'As senhas não coincidem.'
    return
  }
  setPassCarregando.value = true
  const { error } = await sbClient.auth.updateUser({ password: novaSenha.value })
  setPassCarregando.value = false
  if (error) {
    setPassErro.value = error.message
    return
  }
  // Limpa a URL: tira o #access_token e também os parâmetros do link de
  // recuperação/convite. Sem tirar da query, um F5 reabriria este formulário,
  // porque o boot leria type=recovery de novo e remarcaria o fluxo.
  const limpa = new URLSearchParams(location.search)
  limpa.delete('type')
  limpa.delete('code')
  const busca = limpa.toString()
  history.replaceState(null, '', location.pathname + (busca ? '?' + busca : ''))
  // Senha definida: o fluxo acabou, não deve reabrir na próxima navegação.
  window.__fluxoDeSenha = null
  const { data: { session } } = await sbClient.auth.getSession()
  if (session) {
    setSession(session)
    await carregarPerfil(session)
    router.push({ name: 'inicio' })
  }
}

/* ── Esqueci a senha (doForgotPassword) ── */
const forgotEmail = ref('')
const forgotMsg = ref('')
const forgotMsgCor = ref('')
const forgotCarregando = ref(false)
const forgotBtnTexto = computed(() => (forgotCarregando.value ? 'Enviando...' : 'Enviar link'))

async function esqueciSenha() {
  forgotMsg.value = ''
  const alvo = forgotEmail.value.trim()
  if (!alvo) {
    forgotMsgCor.value = 'var(--red)'
    forgotMsg.value = 'Digite seu email.'
    return
  }
  forgotCarregando.value = true
  const { error } = await sbClient.auth.resetPasswordForEmail(alvo, {
    redirectTo: location.origin + location.pathname,
  })
  forgotCarregando.value = false
  if (error) {
    forgotMsgCor.value = 'var(--red)'
    forgotMsg.value = error.message
  } else {
    forgotMsgCor.value = 'var(--green)'
    forgotMsg.value = 'Link enviado! Verifique seu email.'
  }
}

/* ── Solicitar acesso (doRequestAccess) ── */
const reqNome = ref('')
const reqEmail = ref('')
const reqMensagem = ref('')
const reqFeedback = ref('')
const reqFeedbackCor = ref('')
const reqEnviado = ref(false)
const reqCarregando = ref(false)
const reqBtnTexto = computed(() => (reqCarregando.value ? 'Enviando...' : 'Enviar solicitação'))

async function solicitarAcesso() {
  reqFeedback.value = ''
  const nome = reqNome.value.trim()
  const emailReq = reqEmail.value.trim()
  if (!nome || !emailReq) {
    reqFeedbackCor.value = 'var(--red)'
    reqFeedback.value = 'Nome e email são obrigatórios.'
    return
  }
  reqCarregando.value = true
  const { error } = await sbClient.from('access_requests').insert({
    name: nome,
    email: emailReq,
    message: reqMensagem.value.trim(),
  })
  reqCarregando.value = false
  if (error) {
    reqFeedbackCor.value = 'var(--red)'
    reqFeedback.value = 'Erro ao enviar. Tente novamente.'
  } else {
    reqFeedbackCor.value = 'var(--green)'
    reqFeedback.value = 'Solicitação enviada! Aguarde aprovação do administrador.'
    reqEnviado.value = true
  }
}

/* ── Fundo animado (initAuthCanvas) ── */
const canvasRef = ref(null)
let pararCanvas = null

function iniciarCanvasAuth(canvas) {
  const ctx = canvas.getContext('2d')
  let W, H, nodes, animId

  function initNodes() {
    nodes = Array.from({ length: 55 }, () => ({
      x: W / 2 + (Math.random() - 0.5) * W * 0.3,
      y: H / 2 + (Math.random() - 0.5) * H * 0.3,
      vx: (Math.random() - 0.5) * 1.1,
      vy: (Math.random() - 0.5) * 1.1,
      r: Math.random() * 2 + 1.2,
      opacity: Math.random() * 0.6 + 0.2,
    }))
  }
  function resize() {
    W = canvas.width = window.innerWidth
    H = canvas.height = window.innerHeight
    initNodes()
  }
  function draw() {
    ctx.clearRect(0, 0, W, H)
    nodes.forEach((n) => {
      n.x += n.vx
      n.y += n.vy
      if (n.x < 0 || n.x > W) n.vx *= -1
      if (n.y < 0 || n.y > H) n.vy *= -1
    })
    nodes.forEach((a, i) => nodes.slice(i + 1).forEach((b) => {
      const d = Math.hypot(a.x - b.x, a.y - b.y)
      if (d < 160) {
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        const alpha = (1 - d / 160) * 0.18
        ctx.strokeStyle = `rgba(29,78,216,${alpha})`
        ctx.lineWidth = 1
        ctx.stroke()
      }
    }))
    nodes.forEach((n) => {
      ctx.beginPath()
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(29,78,216,${n.opacity})`
      ctx.fill()
    })
    animId = requestAnimationFrame(draw)
  }

  resize()
  window.addEventListener('resize', resize)
  draw()
  return () => {
    cancelAnimationFrame(animId)
    window.removeEventListener('resize', resize)
  }
}

onMounted(() => {
  if (canvasRef.value) pararCanvas = iniciarCanvasAuth(canvasRef.value)
})
onUnmounted(() => {
  if (pararCanvas) pararCanvas()
})
</script>

<style scoped>
.tela-login{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;background:var(--surface2);position:relative;z-index:1;}
.tela-login{background:#07080f;}
</style>
