<template>
  <div class="tela-visao-como">
    <barra-de-topo voltar="Administração" titulo="Visão como" :subtitulo="subtitulo" @voltar="voltar" />
    <div class="container-app vcu-body">
      <faixa-de-erro :erro="erro" @tentar-de-novo="carregar" />

      <div v-if="carregando" class="vcu-carregando">Carregando…</div>

      <template v-else-if="!erro && pessoa">
        <div class="vcu-aviso">
          <span class="selo selo-info">Simulação</span>
          É assim que a tela de Início apareceria para <b>{{ pessoa.name || pessoa.email }}</b>.
          Nenhuma tela real é aberta, e nenhum dado dela é lido aqui — só a
          configuração de acesso que já está gravada no perfil dela.
        </div>

        <div v-if="cartoesVisiveis.length" class="grade-cards vcu-grade">
          <div v-for="c in cartoesVisiveis" :key="c.id" class="card-base vcu-card">
            <h3 class="vcu-card-titulo">{{ c.titulo }}</h3>
            <p v-if="c.frase" class="vcu-card-frase">{{ c.frase }}</p>
            <ul v-if="c.ferramentas" class="vcu-sub-lista">
              <li v-for="f in c.ferramentas" :key="f.label">
                <span class="vcu-sub-label">{{ f.label }}</span>
                <span class="vcu-sub-frase">{{ f.frase }}</span>
              </li>
            </ul>
          </div>
        </div>
        <p v-else class="vcu-vazio">
          Nenhum card apareceria. A tela de Início dela mostraria
          "Você ainda não tem acesso a nenhuma ferramenta."
        </p>

        <div v-if="pessoa" class="vcu-entrar-bloco">
          <button class="btn btn-perigo" type="button" @click="entrarComo" :disabled="entrando">
            {{ entrando ? 'Entrando…' : 'Entrar como (sessão real)' }}
          </button>
          <p class="vcu-entrar-aviso">
            Abre uma aba nova, autenticado de verdade como
            <b>{{ pessoa.name || pessoa.email }}</b> — dado real dela, sem senha
            nenhuma. Fica registrado quem entrou e quando.
          </p>
          <p v-if="erroEntrar" class="vcu-entrar-erro">{{ erroEntrar }}</p>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
// A "VISÃO COMO": não abre telas de verdade nem lê dados da pessoa — só monta,
// a partir do perfil já gravado, a mesma lista de cards que tela-de-inicio.vue
// mostraria (regra e motivo em visao-como-usuario.js). Aberta em nova aba pelo
// botão "Visão como" da linha da pessoa em tela-de-admin.vue.
import { onMounted, ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import BarraDeTopo from '../../compartilhado/barra-de-topo.vue'
import FaixaDeErro from '../../compartilhado/faixa-de-erro.vue'
import { estado } from '../../compartilhado/controle-de-login-e-usuario.js'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../compartilhado/conectar-no-banco-de-dados.js'
import { classificarErro, ERRO_DE_REDE } from '../../compartilhado/classificar-erro.js'
import { visaoComoUsuario } from './visao-como-usuario.js'

const route = useRoute()
const router = useRouter()
function voltar() { router.push({ name: 'admin' }) }

const pessoa = ref(null)
const erro = ref(null)
const carregando = ref(true)
const entrando = ref(false)
const erroEntrar = ref(null)

async function carregar() {
  carregando.value = true
  erro.value = null
  pessoa.value = null
  try {
    const tok = estado.currentSession?.access_token || SUPABASE_ANON_KEY
    const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(route.params.id)}`
      + '&select=id,name,email,role,is_superadmin,permissions,allowed_accounts',
    { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${tok}` } })
    const corpo = await r.json().catch(() => null)
    if (!r.ok || !Array.isArray(corpo)) { erro.value = classificarErro(r.status, corpo); return }
    // PostgREST devolve 200 + [] tanto para "id não existe" quanto para "RLS
    // negou a linha" (mesmo limite documentado em faixa-de-erro.vue) — as duas
    // situações levam à mesma frase honesta, porque não dá para distinguir.
    if (!corpo.length) {
      erro.value = { tipo: 'nao-encontrado', mensagem: 'Não encontrei essa pessoa — ou o link está errado, ou você não tem permissão para vê-la.', acao: null }
      return
    }
    pessoa.value = corpo[0]
  } catch {
    erro.value = ERRO_DE_REDE
  } finally {
    carregando.value = false
  }
}

async function entrarComo() {
  if (!pessoa.value) return
  const nome = pessoa.value.name || pessoa.value.email
  if (!confirm(`Entrar como "${nome}"?\n\nVocê vai abrir a Central autenticado de verdade como ela, numa aba separada. Isto fica registrado.`)) return

  erroEntrar.value = null
  entrando.value = true
  // Reserva a aba ANTES do fetch: depois de um await, o navegador trata
  // window.open como popup e bloqueia.
  const aba = window.open('', '_blank')
  try {
    const tok = estado.currentSession?.access_token || SUPABASE_ANON_KEY
    const r = await fetch(`${SUPABASE_URL}/functions/v1/entrar-como-usuario`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ alvoId: pessoa.value.id }),
    })
    const dados = await r.json().catch(() => null)
    if (!r.ok || !dados || dados.error) throw new Error(dados?.error || 'Não consegui gerar a sessão.')
    const hash = `access_token=${dados.access_token}&refresh_token=${dados.refresh_token}&expires_in=${dados.expires_in}&token_type=bearer&type=magiclink`
    if (aba) aba.location.href = `/?modo=entrar-como#${hash}`
    else erroEntrar.value = 'O navegador bloqueou a aba nova. Permita pop-ups para este site e tente de novo.'
  } catch (e) {
    aba?.close()
    erroEntrar.value = e.message || 'Não consegui entrar como essa pessoa.'
  } finally {
    entrando.value = false
  }
}

onMounted(() => {
  if (!estado.is_superadmin) { router.push({ name: 'inicio' }); return }
  carregar()
})

const subtitulo = computed(() => pessoa.value ? (pessoa.value.name || pessoa.value.email) : '')
const cartoesVisiveis = computed(() => pessoa.value ? visaoComoUsuario(pessoa.value).filter((c) => c.visivel) : [])
</script>

<style scoped>
.tela-visao-como{min-height:100vh;}
.vcu-body{padding-block:var(--sp-5);}
.vcu-carregando{color:var(--muted);font-family:var(--fonte-principal);font-size:var(--texto-corpo);padding:var(--sp-5) 0;}
.vcu-aviso{display:flex;flex-wrap:wrap;align-items:center;gap:var(--sp-2);margin-bottom:var(--sp-5);padding:var(--sp-3) var(--card-pad);border-radius:var(--radius-lg);background:color-mix(in srgb, var(--accent) 8%, var(--surface));border:1px solid color-mix(in srgb, var(--accent) 30%, var(--surface));color:var(--text);font-family:var(--fonte-principal);font-size:var(--texto-corpo);}
.vcu-vazio{color:var(--muted);font-family:var(--fonte-principal);font-size:var(--texto-corpo);}
.vcu-card{display:flex;flex-direction:column;gap:var(--sp-2);}
.vcu-card-titulo{margin:0;font-family:var(--fonte-principal);font-size:var(--texto-titulo);color:var(--text);overflow-wrap:anywhere;}
.vcu-card-frase{margin:0;font-family:var(--fonte-principal);font-size:var(--texto-corpo);color:var(--muted);}
.vcu-sub-lista{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:var(--sp-2);}
.vcu-sub-lista li{display:flex;flex-direction:column;gap:2px;padding-top:var(--sp-2);border-top:1px solid var(--border);}
.vcu-sub-lista li:first-child{padding-top:0;border-top:none;}
.vcu-sub-label{font-family:var(--fonte-principal);font-size:var(--texto-corpo);font-weight:600;color:var(--text);overflow-wrap:anywhere;}
.vcu-sub-frase{font-family:var(--fonte-principal);font-size:var(--texto-corpo);color:var(--muted);overflow-wrap:anywhere;}
.vcu-entrar-bloco{margin-top:var(--sp-5);padding-top:var(--sp-5);border-top:1px solid var(--border);display:flex;flex-direction:column;align-items:flex-start;gap:var(--sp-2);}
.vcu-entrar-aviso{margin:0;font-family:var(--fonte-principal);font-size:var(--texto-corpo);color:var(--muted);max-width:60ch;}
.vcu-entrar-erro{margin:0;font-family:var(--fonte-principal);font-size:var(--texto-corpo);color:var(--red);}
</style>
