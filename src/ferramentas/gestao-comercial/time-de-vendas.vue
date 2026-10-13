<template>
  <div class="tv-wrap">
    <div v-if="carregando" class="tv-vazio">Carregando…</div>

    <div v-else-if="erro" class="tv-erro">Não consegui carregar os times: {{ erro }}</div>

    <div v-else-if="!meusTimes.length" class="tv-vazio">
      <p><b>Você não gerencia nenhum time.</b></p>
      <p>Quem administra um time consegue ver e mexer na equipe dele por aqui.
         Se isso está errado, peça para te colocarem como supervisora ou gestora do time.</p>
    </div>

    <div v-else>
      <p class="tv-ajuda">
        É a mesma equipe que aparece em Administração — mexer aqui muda lá, e o contrário também.
        Você vê só os times que administra.
      </p>

      <div v-for="t in meusTimes" :key="t.id" class="tv-time">
        <div class="tv-cab">
          <div>
            <span class="tv-nome">{{ t.nome }}</span>
            <span class="tv-tipo">{{ t.tipo }}</span>
          </div>
          <span class="tv-papel">{{ comoEstouAqui(t.id) }}</span>
        </div>

        <div v-for="m in membrosDe(t.id)" :key="m.id" class="tv-linha">
          <div class="tv-quem">
            <div class="tv-quem-nome">{{ nomeDe(m.profile_id) }}</div>
            <div class="tv-quem-sub">{{ explicacaoDoPapel(m.papel) }}</div>
          </div>
          <div class="tv-acoes">
            <select v-if="papeisQuePosso(t.id).length" :value="m.papel" @change="trocarPapel(m, $event.target.value)">
              <option v-for="p in papeisQuePosso(t.id)" :key="p.id" :value="p.id">{{ p.rotulo }}</option>
            </select>
            <span v-else class="tv-papel-fixo">{{ rotuloDoPapel(m.papel) }}</span>

            <!-- O estoque não vem com o time: ou a pessoa supervisiona, ou
                 alguém liberou. Quem supervisiona não precisa de marcação. -->
            <span v-if="estoqueDe(m).porque === 'pelo papel'" class="tv-estoque-ok" title="Vê o estoque porque supervisiona">estoque ✓</span>
            <label v-else-if="possoLiberar(t.id)" class="tv-check" title="Liberar o estoque desta loja para esta pessoa">
              <input type="checkbox" :checked="estoqueDe(m).ve" @change="trocarEstoque(m, $event.target.checked)"> estoque
            </label>
            <span v-else-if="estoqueDe(m).ve" class="tv-estoque-ok">estoque ✓</span>

            <button v-if="podeTirar(t.id, m).pode" type="button" class="tv-tirar" @click="tirar(m)">Tirar</button>
            <span v-else class="tv-nao" :title="podeTirar(t.id, m).porque">não dá</span>
          </div>
        </div>

        <div v-if="!membrosDe(t.id).length" class="tv-vazio-time">Ninguém neste time ainda.</div>

        <div v-if="papeisQuePosso(t.id).length" class="tv-por">
          <select v-model="escolhida[t.id]">
            <option value="">Escolha quem entra…</option>
            <option v-for="p in foraDoTime(t.id)" :key="p.id" :value="p.id">{{ p.name || p.email }}</option>
          </select>
          <select v-model="papelNovo[t.id]">
            <option v-for="p in papeisQuePosso(t.id)" :key="p.id" :value="p.id">{{ p.rotulo }}</option>
          </select>
          <button type="button" @click="por(t.id)">Colocar no time</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
// A ABA ESPELHO DO TIME DE VENDAS.
//
// PEDIDO DO DONO (04/08/2026): os times "serão espelho e terão como editar
// também no gestor comercial em uma nova aba de time de vendas".
//
// ESPELHO DE VERDADE quer dizer duas coisas, e a segunda é a que costuma
// faltar: mesma TABELA e mesmas REGRAS. Os dados vêm de `equipes`/
// `equipes_membros` — as mesmas da tela de Administração — e as regras vêm de
// `admin/equipes.js`, o mesmo módulo. Reescrever as regras aqui daria duas
// versões que divergem no primeiro ajuste, e a divergência entre duas telas de
// PERMISSÃO é a pior classe de bug: cada uma diz que a pessoa pode uma coisa
// diferente.
//
// A DIFERENÇA entre as duas portas não é o que se pode fazer, é o que se
// ALCANÇA: em Administração o dono vê todos os times; aqui cada um vê os que
// administra. Quem manda nisso é o RLS, não esta tela — ela só evita mostrar
// botão que o banco vai recusar.
import { ref, computed, onMounted } from 'vue'
import { sbClient } from '../../compartilhado/conectar-no-banco-de-dados.js'
// Chave `admin` (Plano 7): times, membros, liberações e perfis pela API (5.1).
import { deOnde } from '../../compartilhado/banco-pela-api.js'
import { estado } from '../../compartilhado/controle-de-login-e-usuario.js'
import { adminToast } from '../../compartilhado/avisos.js'
import {
  PAPEIS, acharPapel, podeAdministrarTime, papeisQuePossoConceder, podeRemover,
  veOEstoque, podeLiberarEstoque, ordenarTimes,
} from '../admin/equipes.js'

const carregando = ref(true)
const erro = ref('')
const times = ref([])
const membros = ref([])
const pessoas = ref([])
const liberacoes = ref([])
const escolhida = ref({})
const papelNovo = ref({})

const eu = computed(() => ({ is_superadmin: !!estado.is_superadmin, id: estado.user?.id }))

function meuPapel(timeId) {
  const m = membros.value.find(x => String(x.equipe_id) === String(timeId) && String(x.profile_id) === String(eu.value.id))
  return m ? m.papel : null
}

// SÓ OS TIMES QUE EU ADMINISTRO OU SUPERVISIONO. Mostrar os outros encheria a
// tela de coisa que o banco não deixa mexer — botão que só serve para dar erro.
const meusTimes = computed(() => ordenarTimes(
  times.value.filter(t => eu.value.is_superadmin || podeLiberarEstoque(eu.value, meuPapel(t.id)) || podeAdministrarTime(eu.value, meuPapel(t.id))),
))

const membrosDe = (id) => membros.value.filter(m => String(m.equipe_id) === String(id))
const papeisQuePosso = (id) => papeisQuePossoConceder(eu.value, meuPapel(id))
const possoLiberar = (id) => podeLiberarEstoque(eu.value, meuPapel(id))
const estoqueDe = (m) => veOEstoque(m, liberacoes.value)
const podeTirar = (id, m) => podeRemover(eu.value, meuPapel(id), m, membrosDe(id))
const rotuloDoPapel = (p) => (acharPapel(p) || {}).rotulo || p || '—'
// O DONO NÃO É MEMBRO de time nenhum, e mesmo assim administra todos. Sem esta
// distinção a linha saía "você é —", que lê como defeito.
function comoEstouAqui(timeId) {
  const p = meuPapel(timeId)
  if (p) return 'você é ' + rotuloDoPapel(p).toLowerCase()
  return eu.value.is_superadmin ? 'você administra todos os times' : ''
}
const explicacaoDoPapel = (p) => (acharPapel(p) || {}).explicacao || ''
function nomeDe(id) {
  const p = pessoas.value.find(x => String(x.id) === String(id))
  return p ? (p.name || p.email) : '(usuário removido)'
}
function foraDoTime(id) {
  const dentro = new Set(membrosDe(id).map(m => String(m.profile_id)))
  return pessoas.value.filter(p => !dentro.has(String(p.id)) && !p.disabled)
}

async function carregar() {
  carregando.value = true; erro.value = ''
  try {
    const [t, m, p, l] = await Promise.all([
      deOnde(sbClient).from('equipes').select('*'),
      deOnde(sbClient).from('equipes_membros').select('*'),
      deOnde(sbClient).from('profiles').select('id,name,email,disabled').order('name'),
      deOnde(sbClient).from('equipes_permissoes').select('*'),
    ])
    // O MOTIVO VAI PRA TELA. `catch` mudo já custou meia hora de caça noutra
    // tela deste mesmo sistema.
    for (const r of [t, m, p, l]) if (r.error) throw new Error(r.error.message)
    times.value = t.data || []; membros.value = m.data || []
    pessoas.value = p.data || []; liberacoes.value = l.data || []
    for (const x of times.value) if (!papelNovo.value[x.id]) papelNovo.value[x.id] = PAPEIS[0].id
  } catch (e) {
    erro.value = String(e && e.message || e)
  } finally {
    carregando.value = false
  }
}

async function trocarPapel(m, papel) {
  const { error } = await deOnde(sbClient).from('equipes_membros').update({ papel }).eq('id', m.id)
  if (error) { adminToast('Não consegui mudar o papel: ' + error.message, false); return }
  await carregar()
}

async function tirar(m) {
  const { error } = await deOnde(sbClient).from('equipes_membros').delete().eq('id', m.id)
  if (error) { adminToast('Não consegui tirar do time: ' + error.message, false); return }
  await carregar()
}

async function por(timeId) {
  const quem = escolhida.value[timeId]
  if (!quem) { adminToast('Escolha quem entra no time.', false); return }
  const { error } = await deOnde(sbClient).from('equipes_membros')
    .insert({ equipe_id: timeId, profile_id: quem, papel: papelNovo.value[timeId] || 'vendedora' })
  if (error) { adminToast('Não consegui colocar no time: ' + error.message, false); return }
  escolhida.value[timeId] = ''
  await carregar()
}

async function trocarEstoque(m, ligado) {
  if (ligado) {
    const { error } = await deOnde(sbClient).from('equipes_permissoes')
      .insert({ equipe_id: m.equipe_id, profile_id: m.profile_id, chave: 'estoque' })
    if (error) { adminToast('Não consegui liberar o estoque: ' + error.message, false); await carregar(); return }
  } else {
    const { error } = await deOnde(sbClient).from('equipes_permissoes').delete()
      .eq('equipe_id', m.equipe_id).eq('profile_id', m.profile_id).eq('chave', 'estoque')
    if (error) { adminToast('Não consegui tirar o acesso ao estoque: ' + error.message, false); await carregar(); return }
  }
  await carregar()
}

onMounted(carregar)
</script>

<style scoped>
.tv-wrap { padding: 18px 22px; font-family: var(--fonte-principal); }
.tv-ajuda { font-size: 12px; color: var(--muted); margin: 0 0 14px; max-width: 60ch; line-height: 1.55; }
.tv-vazio, .tv-erro { font-size: 12.5px; color: var(--muted); padding: 18px 0; line-height: 1.6; max-width: 60ch; }
.tv-erro { color: var(--red, #dc2626); }
.tv-time { border: 1px solid var(--border); border-radius: 12px; padding: 14px 16px; margin-bottom: 12px; background: var(--surface); }
.tv-cab { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; }
.tv-nome { font-weight: 800; font-size: 14px; color: var(--text); }
.tv-tipo { font-size: 10.5px; color: var(--muted); text-transform: uppercase; letter-spacing: 1px; margin-left: 8px; }
.tv-papel { font-size: 11.5px; color: var(--muted); }
.tv-linha { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 7px 0; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
.tv-quem-nome { font-size: 12.5px; font-weight: 600; color: var(--text); }
.tv-quem-sub { font-size: 11px; color: var(--muted); }
.tv-acoes { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.tv-acoes select, .tv-por select { padding: 5px 8px; border-radius: 7px; border: 1px solid var(--border); background: var(--surface2); color: var(--text); font-size: 11.5px; }
.tv-check { display: flex; align-items: center; gap: 5px; font-size: 11px; color: var(--muted); cursor: pointer; }
.tv-estoque-ok { font-size: 11px; color: var(--green, #16a34a); }
.tv-papel-fixo { font-size: 11.5px; color: var(--muted); }
.tv-tirar { border: 1px solid var(--border); background: none; color: var(--red, #dc2626); border-radius: 7px; padding: 5px 10px; font-size: 11.5px; cursor: pointer; }
.tv-nao { font-size: 11px; color: var(--muted); cursor: help; }
.tv-vazio-time { font-size: 12px; color: var(--muted); padding: 8px 0; }
.tv-por { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; align-items: center; }
.tv-por select { flex: 1; min-width: 180px; padding: 7px 10px; font-size: 12px; }
.tv-por button { border: none; background: var(--accent); color: var(--sobre-cor); border-radius: 8px; padding: 7px 14px; font-size: 12px; font-weight: 700; cursor: pointer; }
</style>
