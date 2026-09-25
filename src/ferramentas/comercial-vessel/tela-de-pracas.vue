<template>
  <div class="tela-pracas id-ferramenta">
    <barra-de-topo :voltar="ROTULO_DO_PAI[paiDaTela('pracas')]"
                   titulo="Vessel — Praças"
                   :subtitulo="subtitulo" @voltar="voltar" />

    <div class="cv-largo cv-body">
      <faixa-de-erro :erro="erro" @tentar-de-novo="carregar" />

      <section class="cv-bloco">
        <h2 class="cv-etiqueta id-titulo"><icone-do-bloco nome="etiqueta" />Praças cadastradas</h2>
        <p class="cv-nota cv-nota-primeira">
          Cada praça tem uma sigla (3 letras), a loja que atende — que pode
          ser de outra cidade — e a lista de cidades dela. Sem loja definida,
          a praça fica com "loja a definir": é pendência de propósito, não erro.
        </p>
        <p v-if="!podeEditar" class="cv-nota">Você pode ver as praças. Para mexer, precisa da permissão de editar.</p>

        <div v-if="carregando" class="cv-carregando">Carregando…</div>
        <p v-else-if="!erro && !pracas.length" class="cv-vazio">Nenhuma praça cadastrada ainda.</p>

        <ul v-else-if="!erro" class="pr-lista">
          <li v-for="p in pracas" :key="p.id" class="cv-bloco pr-praca">
            <div class="cv-cabeca">
              <div class="cv-cabeca-texto">
                <span class="cv-codigo pr-sigla">{{ p.sigla }}</span>
                <h3 class="pr-nome">{{ p.nome }}</h3>
                <p class="cv-sub">
                  {{ quantasStylists(p.stylists) }}
                  <span v-if="p.ativa === false"> · </span>
                  <span v-if="p.ativa === false" class="selo selo-neutro">inativa</span>
                </p>
              </div>
              <span v-if="p.loja_destino" class="selo selo-info">{{ p.loja_destino }}</span>
              <span v-else class="selo selo-atencao">loja a definir</span>
            </div>

            <p v-if="erroDaPraca(p.id)" class="cv-nota cv-nota-erro">{{ erroDaPraca(p.id) }}</p>
            <!-- ⚠️ REVISÃO FINAL (IMPORTANTE 6): vincular uma cidade ADOTA as
                 stylists daquela cidade que estavam sem praça. Movimento em
                 dado de gente nunca é calado: o número aparece aqui, e o zero
                 também (senão "não fez nada" e "não tinha ninguém" viram a
                 mesma tela muda). -->
            <p v-if="avisoDaPraca(p.id)" class="cv-nota cv-nota-ok">{{ avisoDaPraca(p.id) }}</p>

            <!-- ── editar a praça (nome, loja, ativa) ─────────────────────── -->
            <template v-if="podeEditar && editando === p.id">
              <div class="cv-form">
                <label class="cv-campo" :for="`praca-nome-${p.id}`"><span>Nome</span>
                  <input :id="`praca-nome-${p.id}`" type="text" maxlength="80" v-model="formEdit.nome"></label>
                <label class="cv-campo" :for="`praca-loja-${p.id}`"><span>Loja de destino</span>
                  <input :id="`praca-loja-${p.id}`" type="text" maxlength="80" v-model="formEdit.loja"
                         placeholder="deixe em branco para 'loja a definir'"></label>
                <label class="cv-marcar" :for="`praca-ativa-${p.id}`">
                  <input :id="`praca-ativa-${p.id}`" type="checkbox" v-model="formEdit.ativa"> Praça ativa</label>
              </div>
              <div class="cv-acoes">
                <button type="button" class="btn" :disabled="gravando" @click="editando = null">Cancelar</button>
                <button type="button" class="btn id-btn-principal btn-principal" :disabled="gravando || !formEdit.nome.trim()"
                        @click="salvarEdicaoDaPraca(p)"><icone-do-bloco nome="editar" />{{ gravando ? 'Gravando…' : 'Salvar' }}</button>
              </div>
            </template>
            <div v-else-if="podeEditar" class="cv-acoes">
              <button type="button" class="btn id-btn-editar" :disabled="gravando" @click="abrirEditar(p)">
                <icone-do-bloco nome="editar" />Editar</button>
            </div>

            <!-- ── as cidades da praça ─────────────────────────────────────── -->
            <div class="id-grupo pr-cidades-grupo">
              <h4 class="cv-etiqueta cv-etiqueta-interna id-subtitulo"><icone-do-bloco nome="conjunto" />Cidades</h4>
              <p v-if="!p.cidades.length" class="cv-sub">Nenhuma cidade vinculada ainda.</p>
              <ul v-else class="pr-cidades">
                <li v-for="c in p.cidades" :key="c.id" class="pr-cidade">
                  <span>{{ c.cidade }}</span>
                  <button v-if="podeEditar" type="button" class="pr-cidade-remover" :disabled="gravando"
                          :aria-label="`Remover ${c.cidade} de ${p.nome}`" @click="removerCidade(p, c)">×</button>
                </li>
              </ul>
              <div v-if="podeEditar" class="pr-add-cidade">
                <label class="cv-campo" :for="`praca-cidade-${p.id}`"><span>Vincular cidade</span>
                  <input :id="`praca-cidade-${p.id}`" type="text" maxlength="80"
                         v-model="novaCidade[p.id]" placeholder="nome da cidade"
                         @keydown.enter.prevent="vincularCidade(p)"></label>
                <button type="button" class="btn id-btn-editar" :disabled="gravando || !(novaCidade[p.id] || '').trim()"
                        @click="vincularCidade(p)"><icone-do-bloco nome="novo" />Vincular</button>
              </div>
            </div>
          </li>
        </ul>
      </section>

      <!-- ── cadastrar praça nova ────────────────────────────────────────── -->
      <section v-if="podeEditar" class="cv-bloco id-caixa-form">
        <h2 class="cv-etiqueta id-titulo"><icone-do-bloco nome="novo" />Nova praça</h2>
        <div class="cv-form">
          <label class="cv-campo" for="praca-nova-sigla"><span>Sigla (3 letras)</span>
            <input id="praca-nova-sigla" type="text" maxlength="3" v-model="novaPraca.sigla" placeholder="LIM"></label>
          <label class="cv-campo" for="praca-nova-nome"><span>Nome</span>
            <input id="praca-nova-nome" type="text" maxlength="80" v-model="novaPraca.nome"></label>
          <label class="cv-campo" for="praca-nova-loja"><span>Loja de destino</span>
            <input id="praca-nova-loja" type="text" maxlength="80" v-model="novaPraca.loja"
                   placeholder="deixe em branco para 'loja a definir'"></label>
        </div>
        <ul v-if="(novaPraca.sigla || novaPraca.nome) && problemasNovaPraca.length" class="cv-problemas">
          <li v-for="p in problemasNovaPraca" :key="p">{{ p }}</li>
        </ul>
        <p v-if="erroNova" class="cv-nota cv-nota-erro">{{ erroNova }}</p>
        <div class="cv-acoes">
          <button type="button" class="btn id-btn-principal btn-principal"
                  :disabled="gravando || problemasNovaPraca.length > 0" @click="criarPraca">
            <icone-do-bloco nome="novo" />{{ gravando ? 'Gravando…' : 'Criar praça' }}</button>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup>
/* VESSEL — PRAÇAS: o cadastro de praça (sigla, nome, loja de destino) e das
 * cidades vinculadas a cada uma (25/09/2026, Task 6).
 *
 * ⚠️ "LOJA A DEFINIR" É PENDÊNCIA DE PROPÓSITO. Limeira e Piracicaba nascem
 * sem loja (praca-e-edicao migration, seção 7 da carga inicial) — a tela
 * mostra isso num `.selo.selo-atencao`, nunca em branco (o dono pediu ver a
 * pendência, não escondê-la).
 *
 * ⚠️ `sbClient`, NUNCA `sb()` — o helper `sb()` responde 200 com lista vazia
 * numa tabela/RPC que só abre para quem está logado, e a tela mentiria "sem
 * praças" para quem só perdeu a sessão (PADRAO-DA-CENTRAL.md, item 9).
 *
 * ⚠️ `ok:true` com `situacao` `sem_mudanca`/`ja_vinculada` é SUCESSO — as
 * funções do banco documentam isso, e esta tela nunca mostra erro nesses dois
 * casos (ver `gravar`, abaixo: só entra no ramo de erro quando `r.ok` é falso).
 */
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import BarraDeTopo from '../../compartilhado/barra-de-topo.vue'
import FaixaDeErro from '../../compartilhado/faixa-de-erro.vue'
import IconeDoBloco from '../../compartilhado/icone-do-bloco.vue'
import { sbClient } from '../../compartilhado/conectar-no-banco-de-dados.js'
import { classificarErro } from '../../compartilhado/classificar-erro.js'
import { hasPermission } from '../../compartilhado/controle-de-login-e-usuario.js'
import { paiDaTela, ROTULO_DO_PAI } from './navegacao.js'

const router = useRouter()
function voltar() { router.push({ name: paiDaTela('pracas') }) }

const podeEditar = computed(() => hasPermission('atendimentos.pracas', 'editar'))

const pracas = ref([])
const carregando = ref(true)
const erro = ref(null)
const gravando = ref(false)

const subtitulo = computed(() => (carregando.value || erro.value ? '' : `${pracas.value.length} praça(s)`))
const quantasStylists = (n) => (n === 1 ? '1 stylist' : `${n || 0} stylists`)

async function carregar() {
  carregando.value = true
  erro.value = null
  try {
    const { data, error } = await sbClient.rpc('vessel_pracas_listar')
    if (error) throw error
    pracas.value = data || []
  } catch (e) {
    pracas.value = []
    erro.value = classificarErro(e?.status, e)
  } finally {
    carregando.value = false
  }
}
onMounted(carregar)

// ── as mensagens de recusa, com o motivo escrito (nunca um erro cru) ───────
function mensagemPraca(r) {
  const s = r?.situacao
  if (s === 'sem_permissao') return 'Você não tem permissão para mexer nas Praças.'
  if (s === 'sem_nome') return 'Escreva o nome da praça.'
  if (s === 'sigla_invalida') return 'A sigla precisa ter exatamente 3 letras (A a Z).'
  if (s === 'sigla_repetida') return 'Já existe uma praça com essa sigla.'
  if (s === 'nao_achei') return 'Não achei essa praça — pode ter sido removida por outra pessoa.'
  if (s === 'praca_invalida') return 'Praça inválida.'
  if (s === 'sem_cidade') return 'Escreva o nome da cidade.'
  if (s === 'cidade_em_outra_praca') return `Essa cidade já pertence à praça ${r?.praca_nome || '—'}.`
  return 'Não consegui gravar agora. Tente de novo em um instante.'
}

// erro por cartão de praça, para o defeito de uma não atrapalhar as outras
const errosPorPraca = reactive({})
const erroDaPraca = (id) => errosPorPraca[id] || ''
const avisosPorPraca = reactive({})
const avisoDaPraca = (id) => avisosPorPraca[id] || ''

async function chamar(funcao, corpo) {
  const { data, error } = await sbClient.rpc(funcao, corpo || {})
  if (error) throw error
  return data
}

// ── editar a praça ──────────────────────────────────────────────────────────
const editando = ref(null)
const formEdit = reactive({ nome: '', loja: '', ativa: true })
function abrirEditar(p) {
  editando.value = p.id
  formEdit.nome = p.nome
  formEdit.loja = p.loja_destino || ''
  formEdit.ativa = p.ativa !== false
  errosPorPraca[p.id] = ''
}
async function salvarEdicaoDaPraca(p) {
  if (gravando.value) return
  gravando.value = true
  errosPorPraca[p.id] = ''
  try {
    const r = await chamar('vessel_praca_editar', {
      p_id: p.id, p_nome: formEdit.nome, p_loja_destino: formEdit.loja || null, p_ativa: formEdit.ativa,
    })
    if (!r?.ok) { errosPorPraca[p.id] = mensagemPraca(r); return }
    editando.value = null
    await carregar()
  } catch {
    errosPorPraca[p.id] = 'Não consegui falar com o banco agora. Tente de novo em um instante.'
  } finally {
    gravando.value = false
  }
}

// ── cidades ──────────────────────────────────────────────────────────────
// ⚠️ REVISÃO FINAL (IMPORTANTE 6): o banco devolve `adotadas` — quantas
// stylists daquela cidade estavam SEM PRAÇA e passaram a ser desta. A frase
// diz o número, inclusive quando é zero: o dono precisa saber se a pendência
// "N sem praça" andou ou não.
function fraseDaAdocao(cidade, adotadas) {
  const n = Number(adotadas) || 0
  if (!n) return `Cidade ${cidade} vinculada. Nenhuma stylist sem praça nessa cidade para adotar.`
  return n === 1
    ? `Cidade ${cidade} vinculada. 1 stylist que estava sem praça passou a ser desta praça.`
    : `Cidade ${cidade} vinculada. ${n} stylists que estavam sem praça passaram a ser desta praça.`
}
const novaCidade = reactive({})
async function vincularCidade(p) {
  const cidade = (novaCidade[p.id] || '').trim()
  if (!cidade || gravando.value) return
  gravando.value = true
  errosPorPraca[p.id] = ''
  try {
    const r = await chamar('vessel_praca_cidade_vincular', { p_praca_id: p.id, p_cidade: cidade })
    // ⚠️ `ja_vinculada` é SUCESSO (a cidade já estava nesta MESMA praça) —
    // só `cidade_em_outra_praca` e as demais são recusa de verdade.
    if (!r?.ok) { errosPorPraca[p.id] = mensagemPraca(r); return }
    avisosPorPraca[p.id] = fraseDaAdocao(cidade, r?.adotadas)
    novaCidade[p.id] = ''
    await carregar()
  } catch {
    errosPorPraca[p.id] = 'Não consegui falar com o banco agora. Tente de novo em um instante.'
  } finally {
    gravando.value = false
  }
}
async function removerCidade(p, c) {
  if (gravando.value) return
  gravando.value = true
  errosPorPraca[p.id] = ''
  try {
    const r = await chamar('vessel_praca_cidade_desvincular', { p_id: c.id })
    if (!r?.ok) { errosPorPraca[p.id] = mensagemPraca(r); return }
    await carregar()
  } catch {
    errosPorPraca[p.id] = 'Não consegui falar com o banco agora. Tente de novo em um instante.'
  } finally {
    gravando.value = false
  }
}

// ── criar praça ──────────────────────────────────────────────────────────
const novaPraca = reactive({ sigla: '', nome: '', loja: '' })
const erroNova = ref('')
const problemasNovaPraca = computed(() => {
  const probs = []
  if (!novaPraca.nome.trim()) probs.push('Escreva o nome da praça.')
  if (!/^[A-Za-z]{3}$/.test(novaPraca.sigla.trim())) probs.push('A sigla tem exatamente 3 letras (ex.: LIM).')
  return probs
})
async function criarPraca() {
  if (gravando.value || problemasNovaPraca.value.length) return
  gravando.value = true
  erroNova.value = ''
  try {
    const r = await chamar('vessel_praca_criar', {
      p_sigla: novaPraca.sigla, p_nome: novaPraca.nome, p_loja_destino: novaPraca.loja || null,
    })
    if (!r?.ok) { erroNova.value = mensagemPraca(r); return }
    Object.assign(novaPraca, { sigla: '', nome: '', loja: '' })
    await carregar()
  } catch {
    erroNova.value = 'Não consegui falar com o banco agora. Tente de novo em um instante.'
  } finally {
    gravando.value = false
  }
}
</script>

<style scoped>
@import './estilo-comercial.css';
@import '../../estilos/identidade-da-ferramenta.css';

.pr-lista { list-style: none; margin: var(--sp-3) 0 0; padding: 0; display: flex; flex-direction: column; gap: var(--sp-3); }
.pr-praca { margin-top: 0; }
.pr-sigla { font-weight: 700; color: var(--modulo); }
.pr-nome {
  font-family: var(--fonte-principal); font-size: var(--texto-campo); color: var(--text);
  margin: var(--sp-1) 0 0; overflow-wrap: anywhere;
}

.pr-cidades-grupo { margin-top: var(--sp-4); }
.pr-cidades { list-style: none; margin: var(--sp-2) 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: var(--sp-2); }
/* ⚠️ RODADA 1 DE CONSERTO (medida refeita, item 6 do PADRAO): o alvo de 40px
   do botão de remover (abaixo) é mais alto que o chip em si — com `gap:
   var(--sp-2)` (8px) entre as DUAS linhas quando as cidades quebram, a folga
   real entre os alvos vizinhos de linhas diferentes media só ~2px (medido com
   `getBoundingClientRect` nos dois cantos, elementFromPoint). Só a linha
   (`row-gap`) precisa crescer — o espaço ENTRE chips da MESMA linha
   (`column-gap`) já tem folga de sobra e não muda. */
@media (max-width: 640px) {
  .pr-cidades { row-gap: var(--sp-6); }
}
.pr-cidade {
  /* ⚠️ RODADA 1 DE CONSERTO (MENOR 5): espaçamento só da escala (PADRAO, item
     7) — nada de `6px`/`4px 6px 4px 12px` digitado à mão. */
  display: inline-flex; align-items: center; gap: var(--sp-1);
  background: var(--surface2); border: 1px solid var(--border); border-radius: 999px;
  padding: var(--sp-1) var(--sp-2) var(--sp-1) var(--sp-3); font-family: var(--fonte-principal); font-size: var(--texto-corpo); color: var(--text);
  max-width: 100%; overflow-wrap: anywhere;
}
/* ⚠️ ALVO DE 40px SEM ENGORDAR O CHIP (PADRAO, item 6): a área do dedo cresce
   pelo ::after, o desenho (o "×" pequeno) fica do mesmo tamanho. */
.pr-cidade-remover {
  position: relative; border: 0; background: none; color: var(--muted); cursor: pointer;
  font-size: var(--texto-campo); line-height: 1; padding: var(--sp-1); border-radius: 50%;
}
.pr-cidade-remover:hover { color: var(--red); }
@media (max-width: 640px) {
  .pr-cidade-remover::after {
    content: ''; position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
    width: 40px; height: 40px;
  }
}

.pr-add-cidade { display: flex; flex-wrap: wrap; align-items: flex-end; gap: var(--sp-2); margin-top: var(--sp-3); }
.pr-add-cidade .cv-campo { flex: 1 1 14rem; min-width: 0; margin: 0; }

.cv-marcar {
  display: flex; align-items: center; gap: var(--sp-2); min-height: 40px;
  font-family: var(--fonte-principal); font-size: var(--texto-corpo); color: var(--text);
  grid-column: 1 / -1;
}
.cv-marcar input { width: 20px; height: 20px; margin: 0; flex: 0 0 20px; }
</style>
