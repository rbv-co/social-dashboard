<template>
  <div class="tela-bs">
    <barra-de-topo :voltar="ROTULO_DO_PAI[paiDaTela('beauty-sessions')]"
                   titulo="Vessel — Beauty Sessions"
                   :subtitulo="subtitulo" @voltar="voltar" />

    <div class="container-app bs-body">
      <faixa-de-erro :erro="erro" @tentar-de-novo="carregar" />

      <!-- ── CRIAR ──────────────────────────────────────────────────────── -->
      <section class="bs-bloco">
        <h2 class="bs-etiqueta">Criar uma sessão</h2>
        <div class="bs-form">
          <label class="bs-campo" for="bs-quando"><span>Quando</span>
            <input id="bs-quando" type="date" v-model="nova.quando" @change="sugerir"></label>
          <label class="bs-campo" for="bs-loja"><span>Loja</span>
            <select id="bs-loja" v-model="nova.loja" @change="sugerir">
              <option value="">Escolha…</option>
              <option v-for="(nome, chave) in LOJAS" :key="chave" :value="chave">{{ nome }}</option>
            </select></label>
          <label class="bs-campo" for="bs-seq"><span>Número ou apelido</span>
            <input id="bs-seq" type="text" maxlength="4" v-model="nova.sequencia"
                   @input="sugerir" placeholder="01"></label>
          <label class="bs-campo bs-campo-largo" for="bs-parceiro"><span>Salão parceiro</span>
            <input id="bs-parceiro" type="text" maxlength="80" v-model="nova.parceiro"
                   placeholder="O nome do salão"></label>
          <label class="bs-campo bs-campo-largo" for="bs-codigo"><span>Código</span>
            <input id="bs-codigo" type="text" maxlength="24" v-model="nova.codigo"></label>
        </div>

        <!-- ⚠️ O aviso do parceiro só aparece quando ele falta. Aviso que
             aparece sempre vira paisagem. -->
        <p v-if="!nova.parceiro.trim()" class="bs-nota bs-nota-atencao">
          Sem o nome do salão, depois do dia não dá mais para saber qual parceiro
          trouxe qual cliente.
        </p>
        <ul v-if="problemas.length" class="bs-problemas">
          <li v-for="p in problemas" :key="p">{{ p }}</li>
        </ul>
        <p v-if="erroAoCriar" class="bs-nota bs-nota-erro">{{ erroAoCriar }}</p>

        <div class="bs-acoes">
          <button class="btn btn-principal" :disabled="problemas.length > 0 || criando"
                  @click="criar">{{ criando ? 'Criando…' : 'Criar sessão' }}</button>
        </div>
      </section>

      <!-- ⚠️ ESTAS DUAS NOTAS FICAM AQUI, UMA VEZ. Elas estavam repetidas dentro
           de cada sessão — com três sessões na tela, o mesmo parágrafo aparecia
           três vezes e virava paisagem, que é exatamente o que o item 9 do
           padrão proíbe. Aviso que aparece sempre ninguém lê. -->
      <section v-if="!carregando && !erro && sessoes.length" class="bs-bloco bs-bloco-leitura">
        <h2 class="bs-etiqueta">Como ler os números</h2>
        <p class="bs-nota bs-nota-primeira">
          <b>Leram</b> é leitura, não pessoa: a mesma cliente abrindo duas vezes
          conta duas. Quem vira gente com nome e WhatsApp é <b>Se identificaram</b>.
          A <b>mesa</b> e o <b>cartão</b> contam separados de propósito — é essa
          diferença que diz qual peça vale imprimir de novo.
        </p>
        <p class="bs-nota">
          O desenho do QR sai por
          <code class="bs-codigo">node ferramentas/qrs-das-beauty-sessions.mjs</code>,
          no repositório do site. Ele é gerado e <b>lido de volta por uma câmera</b>
          antes de sair — material impresso não tem segunda chance, e uma tela não
          consegue fazer essa conferência.
        </p>
      </section>

      <div v-if="carregando" class="bs-carregando">Carregando…</div>

      <template v-else-if="!erro">
        <!-- ── AS SESSÕES ───────────────────────────────────────────────── -->
        <section v-for="s in sessoes" :key="s.codigo" class="bs-bloco bs-sessao">
          <div class="bs-cabeca">
            <div class="bs-cabeca-texto">
              <h2 class="bs-titulo">{{ dataLegivel(s.quando) }} · {{ LOJAS[s.loja] || s.loja }}</h2>
              <p class="bs-sub">
                <span class="bs-codigo">{{ s.codigo }}</span>
                <span v-if="s.parceiro"> · {{ s.parceiro }}</span>
                <span v-else class="bs-sem-parceiro"> · sem salão informado</span>
              </p>
            </div>
            <span class="bs-selo" :class="s.ativa ? 'bs-selo-viva' : 'bs-selo-fim'">
              {{ s.ativa ? 'Aceitando' : 'Encerrada' }}</span>
          </div>

          <div class="bs-numeros">
            <div class="bs-numero">
              <span class="bs-numero-valor">{{ conta(s).mesa }}</span>
              <span class="bs-numero-rotulo">Leram na mesa</span>
            </div>
            <div class="bs-numero">
              <span class="bs-numero-valor">{{ conta(s).cartao }}</span>
              <span class="bs-numero-rotulo">Leram o cartão</span>
            </div>
            <div class="bs-numero">
              <span class="bs-numero-valor">{{ conta(s).pessoas }}</span>
              <span class="bs-numero-rotulo">Se identificaram</span>
            </div>
            <div class="bs-numero">
              <span class="bs-numero-valor">{{ conta(s).compareceram }}</span>
              <span class="bs-numero-rotulo">Foram à loja</span>
            </div>
            <div class="bs-numero bs-numero-destaque">
              <!-- ⚠️ SEM LEITURA NÃO É 0%: "0%" faria uma sessão que ninguém
                   abriu parecer uma que fracassou, e só a segunda pede decisão.
                   ⚠️ E A TAXA NUNCA SAI SOZINHA — vem com de quantos saiu, e com
                   a faixa quando a base é pequena demais para decidir. Uma
                   sessão de salão tem dezenas de leituras: "50%" sobre 4 é duas
                   pessoas, e sem o denominador vira tendência na cabeça de quem
                   lê. -->
              <span v-if="!conversao(s).temBase" class="bs-numero-vazio">sem leitura ainda</span>
              <span v-else class="bs-numero-valor">{{ emPorcento(conversao(s).valor) }}</span>
              <span class="bs-numero-rotulo">Leram → se identificaram</span>
              <span v-if="conversao(s).temBase" class="bs-numero-base">
                {{ taxaEscrita(conversao(s)) }}</span>
              <span v-if="margemEscrita(conversao(s))" class="bs-numero-margem">
                {{ margemEscrita(conversao(s)) }}</span>
            </div>
          </div>

          <!-- ⚠️ A RECEITA SÓ APARECE COM A RÉGUA JUNTO. Não existe no dado
               campo dizendo "esta compra veio desta sessão": o que existe é a
               mesma cliente comprando perto da visita. A janela vem do banco,
               dentro da resposta, para não divergir da conta que a produziu. -->
          <p v-if="janelaEscrita(s.janela_de_venda_em_dias)" class="bs-nota">
            Receita atribuída: <b>{{ emReais(s.receita) }}</b> —
            {{ janelaEscrita(s.janela_de_venda_em_dias) }}.
          </p>

          <!-- ── OS DOIS ENDEREÇOS ──────────────────────────────────────── -->
          <h3 class="bs-etiqueta bs-etiqueta-interna">Os dois QR desta sessão</h3>
          <div class="bs-link">
            <div class="bs-link-texto">
              <span class="bs-link-nome">Mesa — o display do salão</span>
              <code class="bs-link-url">{{ enderecoDaMesa(s.codigo) }}</code>
            </div>
            <button class="btn" @click="copiar(enderecoDaMesa(s.codigo), s.codigo + '-mesa')">
              {{ copiado === s.codigo + '-mesa' ? 'Copiado' : 'Copiar' }}</button>
          </div>
          <div class="bs-link">
            <div class="bs-link-texto">
              <span class="bs-link-nome">Cartão — o que a cliente leva na mão</span>
              <code class="bs-link-url">{{ enderecoDoCartao(s.codigo) }}</code>
            </div>
            <button class="btn" @click="copiar(enderecoDoCartao(s.codigo), s.codigo + '-cartao')">
              {{ copiado === s.codigo + '-cartao' ? 'Copiado' : 'Copiar' }}</button>
          </div>

          <!-- ⚠️ Botão de perigo NÃO fica solto na lista: pede um passo a mais. -->
          <div class="bs-acoes">
            <template v-if="s.ativa">
              <button v-if="confirmando !== s.codigo" class="btn"
                      @click="confirmando = s.codigo">Encerrar…</button>
              <template v-else>
                <span class="bs-confirma">Encerrar faz o QR parar de aceitar contato novo.
                  Os números ficam.</span>
                <button class="btn" @click="confirmando = null">Deixar como está</button>
                <button class="btn btn-perigo" :disabled="mexendo === s.codigo"
                        @click="encerrar(s, false)">Encerrar</button>
              </template>
            </template>
            <button v-else class="btn" :disabled="mexendo === s.codigo"
                    @click="encerrar(s, true)">Reabrir</button>
          </div>
          <p v-if="erroAoMexer === s.codigo" class="bs-nota bs-nota-erro">
            Não consegui gravar agora. Tente de novo em um instante.
          </p>
        </section>

        <p v-if="!sessoes.length" class="bs-vazio">
          Nenhuma Beauty Session criada ainda. Crie a primeira no bloco de cima.
        </p>
      </template>
    </div>
  </div>
</template>

<script setup>
/* VESSEL — BEAUTY SESSIONS: criar, acompanhar e encerrar.
 *
 * POR QUE ESTA TELA EXISTE: em 18/09/2026 o dono disse que sentia "perda de
 * controle" nas gerações de link, cartão e QR. O levantamento deu razão a ele —
 * de cinco famílias de endereço público, três nasciam à mão, por migration, sem
 * tela nenhuma. Criar uma sessão dependia de alguém escrever SQL, ou seja,
 * dependia de alguém estar disponível.
 *
 * ⚠️ LÊ COM O TOKEN DA SESSÃO, NUNCA COM A CHAVE ANÔNIMA. As funções conferem
 * `is_vessel_atendimentos()` por dentro; com a chave anônima o PostgREST
 * responde 200 com lista VAZIA, e a tela diria "nenhuma sessão" para uma agenda
 * cheia. É o estrago do item 9 do PADRAO-DA-CENTRAL.
 *
 * ⚠️ O QR NÃO SAI DAQUI, E É DE PROPÓSITO. O comando que gera os QR no outro
 * repositório LÊ CADA UM DE VOLTA com uma câmera de verdade antes de entregar.
 * Uma tela não faz isso, e QR que a câmera não lê só se descobre com o material
 * já impresso.
 */
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import BarraDeTopo from '../../compartilhado/barra-de-topo.vue'
import FaixaDeErro from '../../compartilhado/faixa-de-erro.vue'
import { estado } from '../../compartilhado/controle-de-login-e-usuario.js'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../compartilhado/conectar-no-banco-de-dados.js'
import { classificarErro } from '../../compartilhado/classificar-erro.js'
import {
  LOJAS, codigoSugerido, problemasDaSessao, enderecoDaMesa, enderecoDoCartao,
  resumoDaSessao, dataLegivel,
} from './contas-das-sessoes.js'
// ⚠️ AS CONTAS DE PROPORÇÃO SÃO AS DA FAMÍLIA, e não uma versão local: as três
// telas do Comercial Vessel mostram taxa sobre base pequena, e a regra de
// quando a base deixa de servir tem de ser a MESMA nas três.
import {
  proporcao, taxaEscrita, margemEscrita, emPorcento, emReais, janelaEscrita,
} from '../comercial-vessel/estatistica.js'
import { paiDaTela, ROTULO_DO_PAI } from '../comercial-vessel/navegacao.js'

const router = useRouter()
function voltar() { router.push({ name: paiDaTela('beauty-sessions') }) }

const sessoes = ref([])
const carregando = ref(true)
const erro = ref(null)
const criando = ref(false)
const erroAoCriar = ref('')
const mexendo = ref(null)
const erroAoMexer = ref(null)
const confirmando = ref(null)
const copiado = ref(null)

const nova = reactive({ quando: '', loja: '', sequencia: '01', parceiro: '', codigo: '' })

const problemas = computed(() => problemasDaSessao(nova))
const subtitulo = computed(() => {
  if (carregando.value || erro.value) return ''
  const vivas = sessoes.value.filter((s) => s.ativa).length
  return `${sessoes.value.length} sessão(ões) · ${vivas} aceitando contato`
})

function conta(s) { return resumoDaSessao(s) }

/* ⚠️ APROXIMADA, E A TELA DIZ ISSO: o denominador são LEITURAS, e a mesma
 * pessoa lendo duas vezes entra duas. O intervalo de Wilson pressupõe uma
 * decisão por unidade, então ele é uma boa aproximação aqui — não uma
 * garantia. É melhor do que mostrar a taxa pelada, que é o que havia antes. */
function conversao(s) {
  const c = resumoDaSessao(s)
  return proporcao(c.pessoas, c.leituras)
}

/* A tela monta o código; a pessoa confere. Digitar à mão é onde nasce o erro
 * que ninguém vê — uma letra trocada vira campanha órfã no painel. */
function sugerir() {
  nova.codigo = codigoSugerido(nova.quando, nova.loja, nova.sequencia)
}

function cabecalho() {
  const token = estado.currentSession?.access_token
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${token || SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
  }
}

async function carregar() {
  carregando.value = true
  erro.value = null
  try {
    // ⚠️ SEM SESSÃO NÃO SE TENTA LER: a resposta seria 200 com lista vazia, e a
    // tela mentiria dizendo que não há sessão nenhuma.
    if (!estado.currentSession?.access_token) {
      erro.value = { tipo: 'sem-sessao', acao: null,
        mensagem: 'Sua sessão expirou. Recarregue a página e entre de novo.' }
      return
    }
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/vessel_conta_das_beauty_sessions`, {
      method: 'POST', headers: cabecalho(), body: JSON.stringify({ p_dias: 7 }),
    })
    if (!r.ok) throw new Error(`o banco respondeu ${r.status}`)
    sessoes.value = (await r.json()) || []
  } catch (e) {
    erro.value = classificarErro(e)
  } finally {
    carregando.value = false
  }
}

async function criar() {
  if (problemas.value.length) return
  criando.value = true
  erroAoCriar.value = ''
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/vessel_beauty_session_criar`, {
      method: 'POST', headers: cabecalho(),
      body: JSON.stringify({
        p_codigo: nova.codigo, p_quando: nova.quando, p_praca: nova.codigo.slice(12, 15),
        p_loja: nova.loja, p_parceiro: nova.parceiro || null,
      }),
    })
    const resposta = r.ok ? await r.json().catch(() => null) : null
    // ⚠️ A MENSAGEM DO BANCO VEM PARA A TELA. Ela já explica em português qual
    // conferência falhou; trocá-la por "não foi possível" esconde o motivo de
    // quem pode consertar.
    if (!resposta?.ok) {
      erroAoCriar.value = resposta?.erro
        || `Não consegui criar agora${r.ok ? '' : ` (o banco respondeu ${r.status})`}.`
      return
    }
    nova.parceiro = ''
    await carregar()
  } catch {
    erroAoCriar.value = 'Não consegui falar com o banco agora. Tente de novo em um instante.'
  } finally {
    criando.value = false
  }
}

async function encerrar(sessao, ativa) {
  mexendo.value = sessao.codigo
  erroAoMexer.value = null
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/vessel_beauty_session_encerrar`, {
      method: 'POST', headers: cabecalho(),
      body: JSON.stringify({ p_codigo: sessao.codigo, p_ativa: ativa }),
    })
    const resposta = r.ok ? await r.json().catch(() => null) : null
    // ⚠️ SE A GRAVAÇÃO FALHA, O SELO NÃO MUDA. Tela que parece salva e não
    // salvou é o defeito mais caro de perceber (item 9 do padrão).
    if (!resposta?.ok) { erroAoMexer.value = sessao.codigo; return }
    sessao.ativa = ativa
    confirmando.value = null
  } catch {
    erroAoMexer.value = sessao.codigo
  } finally {
    mexendo.value = null
  }
}

async function copiar(texto, marca) {
  try {
    await navigator.clipboard.writeText(texto)
    copiado.value = marca
    setTimeout(() => { if (copiado.value === marca) copiado.value = null }, 2000)
  } catch {
    // Sem permissão de área de transferência o endereço continua na tela para
    // ser selecionado à mão — nada se perde.
  }
}

onMounted(carregar)
</script>

<style scoped>
.bs-body { padding-bottom: var(--sp-6); }

.bs-bloco {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: var(--sp-4);
  margin-top: var(--sp-3);
}

.bs-etiqueta {
  font-family: var(--fonte-principal);
  font-size: var(--texto-etiqueta);
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--muted);
  margin: 0 0 var(--sp-3);
}
.bs-etiqueta-interna { margin-top: var(--sp-4); }

/* ── criar ─────────────────────────────────────────────────────────────── */
.bs-form {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--sp-3);
}
.bs-campo { display: flex; flex-direction: column; gap: 6px; }
.bs-campo > span {
  font-family: var(--fonte-principal);
  font-size: var(--texto-etiqueta);
  color: var(--muted);
}
.bs-campo input, .bs-campo select {
  font-family: var(--fonte-principal);
  font-size: var(--texto-campo);
  color: var(--text);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
  min-height: 40px;
  width: 100%;
}

.bs-problemas {
  margin: var(--sp-3) 0 0;
  padding-left: 1.1rem;
  font-family: var(--fonte-principal);
  font-size: var(--texto-corpo);
  color: var(--muted);
}

.bs-acoes {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sp-2);
  margin-top: var(--sp-3);
}

/* ── sessão ────────────────────────────────────────────────────────────── */
.bs-cabeca {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--sp-2);
}
.bs-cabeca-texto { min-width: 0; }
.bs-titulo {
  font-family: var(--fonte-principal);
  font-size: var(--texto-titulo);
  color: var(--text);
  margin: 0;
}
.bs-sub {
  font-family: var(--fonte-principal);
  font-size: var(--texto-corpo);
  color: var(--muted);
  margin: 4px 0 0;
  /* texto nunca corta: quebra em vez de sumir */
  overflow-wrap: anywhere;
}
.bs-sem-parceiro { color: var(--red); }

.bs-codigo {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: var(--texto-corpo);
}

.bs-selo {
  font-family: var(--fonte-principal);
  font-size: var(--texto-etiqueta);
  letter-spacing: .06em;
  text-transform: uppercase;
  border-radius: var(--radius-sm);
  padding: 4px 10px;
  border: 1px solid var(--border);
  white-space: nowrap;
}
.bs-selo-viva { color: var(--green); border-color: var(--green); }
.bs-selo-fim { color: var(--muted); }

.bs-numeros {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
  gap: var(--sp-3);
  margin-top: var(--sp-4);
}
.bs-numero { display: flex; flex-direction: column; gap: 2px; }
.bs-numero-valor {
  font-family: var(--fonte-principal);
  font-size: var(--texto-numero);
  color: var(--text);
  line-height: 1.1;
}
.bs-numero-rotulo {
  font-family: var(--fonte-principal);
  font-size: var(--texto-etiqueta);
  color: var(--muted);
}
/* ⚠️ A BASE FICA COLADA NO NÚMERO, e não numa nota de rodapé: é ela que impede
   a leitura de "50%" como tendência quando são 2 de 4 leituras. */
.bs-numero-base {
  font-family: var(--fonte-principal);
  font-size: var(--texto-etiqueta);
  color: var(--muted);
  overflow-wrap: anywhere;
}
.bs-numero-margem {
  font-family: var(--fonte-principal);
  font-size: var(--texto-etiqueta);
  color: var(--orange, var(--red));
  overflow-wrap: anywhere;
}
.bs-numero-destaque .bs-numero-valor { color: var(--accent); }
.bs-numero-vazio {
  font-family: var(--fonte-principal);
  font-size: var(--texto-corpo);
  color: var(--muted);
  /* ocupa a altura do número para a linha não pular */
  min-height: calc(var(--texto-numero) * 1.1);
  display: flex;
  align-items: center;
}

.bs-nota {
  font-family: var(--fonte-principal);
  font-size: var(--texto-corpo);
  color: var(--muted);
  margin: var(--sp-3) 0 0;
  line-height: 1.5;
}
.bs-nota-primeira { margin-top: 0; }
.bs-bloco-leitura { background: var(--bg); }
.bs-nota-atencao { color: var(--red); }
.bs-nota-erro { color: var(--red); }

.bs-link {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: var(--sp-3);
  margin-top: var(--sp-2);
}
.bs-link-texto { display: flex; flex-direction: column; gap: 4px; min-width: 0; flex: 1 1 14rem; }
.bs-link-nome {
  font-family: var(--fonte-principal);
  font-size: var(--texto-etiqueta);
  color: var(--muted);
}
.bs-link-url {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: var(--texto-corpo);
  color: var(--text);
  /* endereço longo QUEBRA; some é que não pode */
  overflow-wrap: anywhere;
}

.bs-confirma {
  font-family: var(--fonte-principal);
  font-size: var(--texto-corpo);
  color: var(--muted);
  flex: 1 1 14rem;
}

.bs-carregando, .bs-vazio {
  font-family: var(--fonte-principal);
  font-size: var(--texto-corpo);
  color: var(--muted);
  padding: var(--sp-5) 0;
  text-align: center;
}

/* Do celular para cima: os campos ganham colunas quando há espaço. */
@media (min-width: 40rem) {
  .bs-form { grid-template-columns: repeat(3, 1fr); }
  .bs-campo-largo { grid-column: 1 / -1; }
}
</style>
