<template>
  <div class="tela-pe">
    <barra-de-topo :voltar="ROTULO_DO_PAI[paiDaTela('private-edit')]"
                   titulo="Vessel — Private Edit"
                   :subtitulo="subtitulo" @voltar="voltar" />

    <div class="cv-largo cv-body">
      <faixa-de-erro :erro="erro" @tentar-de-novo="carregar" />

      <!-- ── CRIAR ──────────────────────────────────────────────────────── -->
      <section class="cv-bloco">
        <h2 class="cv-etiqueta">Marcar um encontro</h2>
        <div class="cv-form">
          <label class="cv-campo cv-campo-largo" for="pe-stylist"><span>Anfitriã</span>
            <select id="pe-stylist" v-model="novo.stylist">
              <option value="">Escolha a stylist…</option>
              <option v-for="s in stylists" :key="s.codigo" :value="s.codigo">
                {{ s.codigo }} — {{ s.nome }}<span v-if="s.cidade"> · {{ s.cidade }}</span>
              </option>
            </select></label>
          <label class="cv-campo" for="pe-quando"><span>Dia e hora</span>
            <input id="pe-quando" type="datetime-local" v-model="novo.quando"></label>
          <label class="cv-campo" for="pe-praca"><span>Praça</span>
            <select id="pe-praca" v-model="novo.praca">
              <option value="">Escolha…</option>
              <option v-for="(nome, sigla) in PRACAS" :key="sigla" :value="sigla">{{ nome }}</option>
            </select></label>
          <label class="cv-campo" for="pe-vagas"><span>Vagas</span>
            <input id="pe-vagas" type="number" min="1" max="60" v-model.number="novo.vagas"></label>
          <label class="cv-campo cv-campo-largo" for="pe-local"><span>Lugar</span>
            <input id="pe-local" type="text" maxlength="90" v-model="novo.local"
                   placeholder="Onde o encontro acontece"></label>
        </div>

        <p class="cv-nota">
          <b>Vagas</b> é o denominador da taxa de resposta desta tela — é sobre ele
          que "quantas responderam" é calculado. O plano fala em 5 a 8 convidadas.
        </p>
        <ul v-if="problemas.length" class="cv-problemas">
          <li v-for="p in problemas" :key="p">{{ p }}</li>
        </ul>
        <p v-if="erroAoCriar" class="cv-nota cv-nota-erro">{{ erroAoCriar }}</p>
        <p v-if="criado" class="cv-nota cv-nota-ok">
          Encontro <b>{{ criado.codigo }}</b> criado. O convite está na lista abaixo.
        </p>

        <div class="cv-acoes">
          <button class="btn btn-principal" :disabled="problemas.length > 0 || criando"
                  @click="criar">{{ criando ? 'Criando…' : 'Criar encontro' }}</button>
        </div>
      </section>

      <!-- ── BUSCAR, FILTRAR, PERÍODO E ORDENAR ────────────────────────────
           ⚠️ A BARRA NUNCA VAI SOZINHA AO BANCO, salvo o caso de baixo
           (`precisaDoBanco`). Busca, situação (fora arquivada/todas), loja e
           ordem acontecem sobre o que já está em memória — ver filtros.js. -->
      <barra-de-lista v-model="filtro" :lojas="LOJAS"
                      :mostrar="['busca', 'periodo', 'situacao', 'loja', 'ordem']"
                      placeholder-busca="código ou anfitriã" />

      <!-- ── COMO LER ───────────────────────────────────────────────────── -->
      <section v-if="!carregando && !erro && encontros.length" class="cv-bloco cv-bloco-leitura">
        <h2 class="cv-etiqueta">Como ler os números</h2>
        <p class="cv-nota cv-nota-primeira">
          Toda taxa aqui vem com <b>de quantos</b> ela saiu. Um encontro tem 5 a 8
          convidadas: <b>“67%” sobre 3 pessoas é uma pessoa</b>, não uma tendência —
          quando a base é pequena demais para separar um cenário do outro, a tela
          escreve a faixa em que a taxa real pode estar.
        </p>
        <p class="cv-nota">
          <b>Receita</b> é a compra das convidadas na janela declarada ao lado do
          valor. Não existe no dado nenhum campo dizendo “esta compra veio deste
          encontro” — o que existe é a mesma pessoa comprando perto da visita.
        </p>
        <p class="cv-nota">
          <b>Encerrada</b> e <b>arquivada</b> são coisas diferentes. Encerrada
          aconteceu e continua contando na receita e nos números. Arquivada é o
          que não devia ter ficado ali — duplicata, engano — e por isso sai das
          contas e da lista por padrão; o filtro "Situação" traz de volta quem
          precisar olhar para ela.
        </p>
      </section>

      <div v-if="carregando" class="cv-carregando">Carregando…</div>

      <template v-else-if="!erro">
        <!-- ── O CONJUNTO ───────────────────────────────────────────────── -->
        <section v-if="encontros.length" class="cv-bloco">
          <h2 class="cv-etiqueta">Todos os encontros juntos</h2>
          <!-- ⚠️ O CONJUNTO É SOBRE O QUE ESTÁ NA TELA, NÃO SOBRE O QUE VEIO
               DO BANCO: se a pessoa filtrou por loja ou período, o total tem
               de acompanhar — reusar o total de antes do filtro é a tela
               mentindo com número certo. -->
          <p class="cv-nota cv-nota-primeira">
            {{ encontrosNaTela.length }} de {{ encontros.length }} encontros
            (o filtro de cima decide quais).
          </p>
          <div class="cv-numeros">
            <div class="cv-numero">
              <span class="cv-numero-valor">{{ encontrosNaTela.length }}</span>
              <span class="cv-numero-rotulo">Encontros</span>
            </div>
            <div class="cv-numero">
              <span class="cv-numero-valor">{{ totalVagas }}</span>
              <span class="cv-numero-rotulo">Vagas somadas</span>
            </div>
            <div class="cv-numero">
              <span class="cv-numero-valor">{{ emPorcento(conjuntoResposta.valor) }}</span>
              <span class="cv-numero-rotulo">Responderam</span>
              <span class="cv-numero-base">{{ taxaEscrita(conjuntoResposta) }}</span>
            </div>
            <div class="cv-numero">
              <span class="cv-numero-valor">{{ emPorcento(conjuntoPresenca.valor) }}</span>
              <span class="cv-numero-rotulo">Foram, de quem disse sim</span>
              <span class="cv-numero-base">{{ taxaEscrita(conjuntoPresenca) }}</span>
            </div>
          </div>
          <!-- ⚠️ A taxa do conjunto é a SOMA dos numeradores sobre a SOMA dos
               denominadores, nunca a média das taxas: um encontro de 2 vagas
               pesaria igual a um de 8. -->
          <p class="cv-nota">
            As taxas do conjunto somam numeradores e denominadores — não é a média
            das taxas de cada encontro, que daria a um encontro pequeno o mesmo
            peso de um cheio.
          </p>
        </section>

        <!-- ── CADA ENCONTRO ────────────────────────────────────────────── -->
        <section v-for="e in encontrosNaTela" :key="e.codigo" class="cv-bloco">
          <div class="cv-cabeca">
            <div class="cv-cabeca-texto">
              <h2 class="cv-titulo">{{ dataHoraLegivel(e.quando) }}</h2>
              <p class="cv-sub">
                <span class="cv-codigo">{{ e.codigo }}</span>
                <span v-if="e.anfitria || e.stylist"> · {{ e.anfitria || e.stylist }}</span>
                <span v-if="e.local"> · {{ e.local }}</span>
              </p>
            </div>
            <span class="cv-selo" :class="seloDoEncontro(e).classe">{{ seloDoEncontro(e).texto }}</span>
          </div>

          <div class="cv-numeros">
            <div class="cv-numero">
              <span class="cv-numero-valor">{{ e.vagas }}</span>
              <span class="cv-numero-rotulo">Vagas</span>
            </div>
            <div class="cv-numero">
              <span class="cv-numero-valor">{{ e.responderam }}</span>
              <span class="cv-numero-rotulo">Responderam</span>
              <span class="cv-numero-base">{{ taxaEscrita(taxaResposta(e)) }}</span>
              <span v-if="margemEscrita(taxaResposta(e))" class="cv-numero-margem">
                {{ margemEscrita(taxaResposta(e)) }}</span>
            </div>
            <div class="cv-numero">
              <span class="cv-numero-valor">{{ e.disseram_sim }}</span>
              <span class="cv-numero-rotulo">Disseram sim</span>
              <span class="cv-numero-base">{{ taxaEscrita(taxaSim(e)) }} de quem respondeu</span>
            </div>
            <div class="cv-numero">
              <span class="cv-numero-valor">{{ e.compareceram }}</span>
              <span class="cv-numero-rotulo">Foram</span>
              <span class="cv-numero-base">{{ taxaEscrita(taxaPresenca(e)) }} de quem disse sim</span>
              <span v-if="margemEscrita(taxaPresenca(e))" class="cv-numero-margem">
                {{ margemEscrita(taxaPresenca(e)) }}</span>
            </div>
            <div class="cv-numero">
              <span class="cv-numero-valor">{{ emReais(e.receita) }}</span>
              <span class="cv-numero-rotulo">Receita</span>
              <span class="cv-numero-base">{{ janelaEscrita(e.janela_de_venda_em_dias) }}</span>
            </div>
          </div>

          <h3 class="cv-etiqueta cv-etiqueta-interna">O convite</h3>
          <div class="cv-link">
            <div class="cv-link-texto">
              <span class="cv-link-nome">O que a anfitriã manda para as convidadas</span>
              <code class="cv-link-url">{{ enderecoDoConvite(e.chave) || '(sem chave)' }}</code>
            </div>
            <button v-if="enderecoDoConvite(e.chave)" class="btn"
                    @click="copiar(enderecoDoConvite(e.chave), e.codigo)">
              {{ copiado === e.codigo ? 'Copiado' : 'Copiar' }}</button>
          </div>
          <p class="cv-nota">
            O endereço vai pela <b>chave sorteada</b>, e não pelo código do encontro:
            o código é adivinhável, e quem recebesse um convite listaria os outros
            trocando a data.
          </p>

          <!-- ── EDITAR (inline, sem modal) ──────────────────────────────── -->
          <template v-if="podeEditar && editando === e.codigo">
            <h3 class="cv-etiqueta cv-etiqueta-interna">Editar</h3>
            <div class="cv-form">
              <label class="cv-campo cv-campo-largo" :for="`ed-stylist-${e.codigo}`"><span>Anfitriã</span>
                <select :id="`ed-stylist-${e.codigo}`" v-model="rascunho.stylist">
                  <option v-for="s in stylists" :key="s.codigo" :value="s.codigo">
                    {{ s.codigo }} — {{ s.nome }}</option>
                </select></label>
              <label class="cv-campo" :for="`ed-quando-${e.codigo}`"><span>Dia e hora</span>
                <input :id="`ed-quando-${e.codigo}`" type="datetime-local" v-model="rascunho.quando"></label>
              <label class="cv-campo" :for="`ed-praca-${e.codigo}`"><span>Praça</span>
                <select :id="`ed-praca-${e.codigo}`" v-model="rascunho.praca">
                  <option value="">Escolha…</option>
                  <option v-for="(nome, sigla) in PRACAS" :key="sigla" :value="sigla">{{ nome }}</option>
                </select></label>
              <label class="cv-campo" :for="`ed-loja-${e.codigo}`"><span>Loja</span>
                <select :id="`ed-loja-${e.codigo}`" v-model="rascunho.loja">
                  <option value="">Escolha…</option>
                  <option v-for="(nome, chave) in LOJAS" :key="chave" :value="chave">{{ nome }}</option>
                </select></label>
              <label class="cv-campo" :for="`ed-vagas-${e.codigo}`"><span>Vagas</span>
                <input :id="`ed-vagas-${e.codigo}`" type="number" min="1" max="60" v-model.number="rascunho.vagas"></label>
              <label class="cv-campo cv-campo-largo" :for="`ed-local-${e.codigo}`"><span>Lugar</span>
                <input :id="`ed-local-${e.codigo}`" type="text" maxlength="90" v-model="rascunho.local"></label>
            </div>
            <p class="cv-nota">
              <b>Código e chave nunca mudam</b>: a chave já está dentro de um
              convite que pode já ter sido mandado.
            </p>
            <p v-if="erroDeEditar === e.codigo" class="cv-nota cv-nota-erro">{{ mensagemEditar }}</p>
            <div class="cv-acoes">
              <button class="btn" :disabled="salvandoEdicao === e.codigo" @click="fecharEditar">Cancelar</button>
              <button class="btn btn-principal" :disabled="salvandoEdicao === e.codigo"
                      @click="salvarEdicao(e)">{{ salvandoEdicao === e.codigo ? 'Salvando…' : 'Salvar' }}</button>
            </div>
          </template>

          <!-- ── APAGAR: tem_gente vira explicação, nunca erro vermelho ──── -->
          <template v-else-if="podeEditar && bloqueioDeApagar[e.codigo]">
            <p class="cv-nota cv-nota-aviso">{{ bloqueioDeApagar[e.codigo] }}</p>
          </template>

          <div class="cv-acoes">
            <template v-if="e.ativa !== false">
              <button v-if="confirmando !== e.codigo" class="btn"
                      @click="confirmando = e.codigo">Encerrar…</button>
              <template v-else>
                <span class="cv-confirma">Encerrar faz o convite parar de aceitar
                  resposta. Os números ficam.</span>
                <button class="btn" @click="confirmando = null">Deixar como está</button>
                <button class="btn btn-perigo" :disabled="mexendo === e.codigo"
                        @click="encerrar(e, false)">Encerrar</button>
              </template>
            </template>
            <button v-else class="btn" :disabled="mexendo === e.codigo"
                    @click="encerrar(e, true)">Reabrir</button>

            <template v-if="podeEditar">
              <button v-if="editando !== e.codigo" class="btn" @click="abrirEditar(e)">Editar…</button>

              <button class="btn" :disabled="arquivando === e.codigo"
                      @click="alternarArquivar(e)">
                {{ arquivando === e.codigo ? 'Gravando…' : rotuloDeArquivar(e.arquivada) }}
              </button>

              <template v-if="!bloqueioDeApagar[e.codigo]">
                <button v-if="apagando !== e.codigo" class="btn btn-perigo"
                        @click="apagando = e.codigo">Apagar…</button>
                <template v-else>
                  <span class="cv-confirma">Apagar não pode ser desfeito.</span>
                  <button class="btn" @click="apagando = null">Deixar como está</button>
                  <button class="btn btn-perigo" :disabled="mexendoApagar === e.codigo"
                          @click="apagar(e)">Apagar de vez</button>
                </template>
              </template>
            </template>

            <button class="btn" :disabled="carregandoConvidadas === e.codigo"
                    @click="verQuemFoi(e)">
              {{ carregandoConvidadas === e.codigo ? 'Buscando…' : 'Ver quem foi' }}
            </button>
          </div>
          <p v-if="erroAoMexer === e.codigo" class="cv-nota cv-nota-erro">
            Não consegui gravar agora. Tente de novo em um instante.
          </p>
          <p v-if="erroDeArquivar === e.codigo" class="cv-nota cv-nota-erro">{{ mensagemArquivar }}</p>
          <p v-if="erroDeApagar === e.codigo" class="cv-nota cv-nota-erro">{{ mensagemApagar }}</p>

          <!-- ── QUEM FOI ─────────────────────────────────────────────────
               ⚠️ A TABELA VAI DENTRO DE `overflow-x: auto` — é a única coisa
               que pode passar da largura no celular; a página em si nunca
               pode rolar de lado. -->
          <template v-if="convidadasAbertas === e.codigo">
            <h3 class="cv-etiqueta cv-etiqueta-interna">Quem foi</h3>
            <div v-if="convidadasErro[e.codigo]" class="cv-nota cv-nota-erro">
              Deu erro ao buscar as convidadas. Tente de novo em um instante.
            </div>
            <p v-else-if="convidadasVazias[e.codigo]" class="cv-vazio">
              Ninguém respondeu a este convite ainda.
            </p>
            <div v-else-if="convidadas[e.codigo]" class="cv-tabela-caixa">
              <table class="cv-tabela">
                <thead><tr><th>Convidada</th><th>Respondeu</th><th>Confirmou</th><th>Compareceu</th><th>Comprou</th></tr></thead>
                <tbody>
                  <tr v-for="c in convidadas[e.codigo]" :key="c.telefone">
                    <td>{{ c.nome }}</td>
                    <td>{{ rsvpLegivel(c.rsvp) }}</td>
                    <td>{{ confirmouLegivel(c.status) }}</td>
                    <td>{{ compareceuLegivel(c.status) }}</td>
                    <td>{{ comprouLegivel(c.comprou) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </template>
        </section>

        <p v-if="!encontrosNaTela.length && encontros.length" class="cv-vazio">
          Nenhum encontro passa neste filtro. Experimente "Todas, inclusive
          arquivadas" ou um período maior.
        </p>
        <p v-if="!encontros.length" class="cv-vazio">
          Nenhum encontro marcado ainda. Marque o primeiro no bloco de cima.
        </p>
      </template>
    </div>
  </div>
</template>

<script setup>
/* VESSEL — PRIVATE EDIT: marcar o encontro, acompanhar, editar, arquivar,
 * apagar e ver quem foi.
 *
 * ⚠️ LÊ COM O TOKEN DA SESSÃO, NUNCA COM A CHAVE ANÔNIMA: as funções conferem
 * `is_vessel_atendimentos()` por dentro, e com a chave anônima o PostgREST
 * responde 200 com lista VAZIA — a tela diria "nenhum encontro" para uma agenda
 * cheia (item 9 do PADRAO-DA-CENTRAL).
 *
 * ⚠️ TODA TAXA AQUI SAI COM O DENOMINADOR E, QUANDO A BASE É PEQUENA, COM A
 * FAIXA. Um encontro tem 5 a 8 convidadas: sem isso, "67%" sobre 3 pessoas
 * viraria uma tendência na cabeça de quem lê, e é uma pessoa.
 *
 * ⚠️ O PERÍODO DA BARRA RECORTA A LISTA, NÃO O BANCO. As duas chamadas
 * (`vessel_conta_das_private_edits` e `vessel_convidadas_do_encontro`) usam a
 * MESMA régua de `p_dias` (14, o padrão das duas) só para a janela de
 * atribuição de venda — nunca para decidir quais linhas aparecem. Quem decide
 * isso é `filtrar()`, sobre o que já voltou. Ver `filtros.js`.
 *
 * ⚠️ ARQUIVADA PRECISA DE RE-FETCH, NÃO DE FILTRO: a função de conta já chega
 * SEM as arquivadas (`p_incluir_arquivadas` nasce `false`). Só quando a
 * situação escolhida é "Só arquivadas" ou "Todas, inclusive arquivadas" a
 * tela volta ao banco pedindo `p_incluir_arquivadas: true` — ver
 * `precisaDoBanco` em `filtros.js`.
 */
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import BarraDeTopo from '../../compartilhado/barra-de-topo.vue'
import FaixaDeErro from '../../compartilhado/faixa-de-erro.vue'
import BarraDeLista from './barra-de-lista.vue'
import { estado, hasPermission } from '../../compartilhado/controle-de-login-e-usuario.js'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../compartilhado/conectar-no-banco-de-dados.js'
import { classificarErro } from '../../compartilhado/classificar-erro.js'
import { enderecoDoConvite, dataHoraLegivel, problemasDoEncontro } from './enderecos-publicos.js'
import {
  proporcao, proporcaoDoConjunto, taxaEscrita, margemEscrita, emPorcento,
  emReais, janelaEscrita,
} from './estatistica.js'
import { filtrar, FILTRO_VAZIO, precisaDoBanco } from './filtros.js'
import {
  mensagemDeEditar, mensagemDeArquivar, mensagemDeTemGente, mensagemDeApagar,
  seloDoEncontro, rotuloDeArquivar, rsvpLegivel, confirmouLegivel,
  compareceuLegivel, comprouLegivel, paraCampoDatetimeLocal,
} from './private-edit-regras.js'
import { paiDaTela, ROTULO_DO_PAI } from './navegacao.js'

const router = useRouter()
function voltar() { router.push({ name: paiDaTela('private-edit') }) }

const PRACAS = { CPS: 'Campinas', SAO: 'São Paulo', SBO: 'Santa Bárbara', BSB: 'Brasília' }
const LOJAS = { iguatemi: 'Iguatemi', tivoli: 'Tivoli', parkshopping: 'ParkShopping' }

// ⚠️ A MESMA JANELA PARA AS DUAS CHAMADAS (R14): a receita do topo e a coluna
// "Comprou" da lista de convidadas medem com a MESMA régua. Um número
// diferente em cada uma faria as duas se contradizerem na mesma tela.
const P_DIAS = 14

const podeEditar = computed(() => hasPermission('atendimentos', 'editar'))

const encontros = ref([])
const stylists = ref([])
const carregando = ref(true)
const erro = ref(null)
const criando = ref(false)
const criado = ref(null)
const erroAoCriar = ref('')
const mexendo = ref(null)
const erroAoMexer = ref(null)
const confirmando = ref(null)
const copiado = ref(null)

const filtro = ref({ ...FILTRO_VAZIO })

const novo = reactive({ stylist: '', quando: '', praca: '', loja: '', vagas: 8, local: '' })

const problemas = computed(() => problemasDoEncontro(novo))
const subtitulo = computed(() => {
  if (carregando.value || erro.value) return ''
  return `${encontros.value.length} encontro(s) · ${totalVagas.value} vagas somadas`
})

// ⚠️ O FILTRO E O TOTAL AGEM SOBRE O QUE ESTÁ NA TELA (R do bloco "Todos os
// encontros juntos"): busca por código/anfitriã, situação, loja e ordem — tudo
// client-side, sobre `encontros`, que só volta ao banco quando a situação
// exige arquivada (ver o watch abaixo).
const encontrosNaTela = computed(() =>
  filtrar(encontros.value, filtro.value, { busca: ['codigo', 'anfitria', 'stylist'], loja: 'loja' }))

const totalVagas = computed(() =>
  encontros.value.reduce((s, e) => s + (Number(e.vagas) || 0), 0))

/* ⚠️ AS TAXAS DO CONJUNTO SOMAM NUMERADORES E DENOMINADORES, e sobre o que
 * está NA TELA — não sobre `encontros` inteiro, que ignoraria o filtro. */
const conjuntoResposta = computed(() =>
  proporcaoDoConjunto(encontrosNaTela.value, 'responderam', 'vagas'))
const conjuntoPresenca = computed(() =>
  proporcaoDoConjunto(encontrosNaTela.value, 'compareceram', 'disseram_sim'))

/* Cada uma é uma proporção de verdade: cada convidada responde ou não, diz sim
 * ou não, vai ou não. Por isso o intervalo de Wilson se aplica. */
const taxaResposta = (e) => proporcao(e.responderam, e.vagas)
const taxaSim = (e) => proporcao(e.disseram_sim, e.responderam)
const taxaPresenca = (e) => proporcao(e.compareceram, e.disseram_sim)

function cabecalho() {
  const token = estado.currentSession?.access_token
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${token || SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
  }
}

async function chamar(funcao, corpo) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${funcao}`, {
    method: 'POST', headers: cabecalho(), body: JSON.stringify(corpo || {}),
  })
  if (!r.ok) throw new Error(`o banco respondeu ${r.status}`)
  return r.json()
}

async function carregar() {
  carregando.value = true
  erro.value = null
  try {
    if (!estado.currentSession?.access_token) {
      erro.value = { tipo: 'sem-sessao', acao: null,
        mensagem: 'Sua sessão expirou. Recarregue a página e entre de novo.' }
      return
    }
    // ⚠️ SÓ PEDE AS ARQUIVADAS QUANDO A SITUAÇÃO PRECISA (R1): a função de
    // conta chega sem elas por padrão, e um array que nunca as recebeu não
    // passa a tê-las só porque o filtro de tela mudou — ver `filtros.js`.
    const incluirArquivadas = precisaDoBanco(filtro.value.situacao)
    const [lista, quem] = await Promise.all([
      chamar('vessel_conta_das_private_edits',
        { p_dias: P_DIAS, p_incluir_arquivadas: incluirArquivadas }),
      chamar('vessel_stylists_para_escolher', {}),
    ])
    encontros.value = lista || []
    stylists.value = quem || []
  } catch (e) {
    erro.value = classificarErro(e)
  } finally {
    carregando.value = false
  }
}

// ⚠️ O ÚNICO GATILHO DE VOLTAR AO BANCO É A SITUAÇÃO PEDIR ARQUIVADA — nunca
// busca, loja, ordem ou período: essas quatro filtram o que já está em
// memória. Recarregar a cada letra digitada seria uma chamada ao banco por
// tecla (ver o cabeçalho de `filtros.js`).
watch(() => precisaDoBanco(filtro.value.situacao), (precisaAgora, precisavaAntes) => {
  if (precisaAgora !== precisavaAntes) carregar()
})

async function criar() {
  if (problemas.value.length) return
  criando.value = true
  erroAoCriar.value = ''
  criado.value = null
  try {
    // ⚠️ O campo datetime-local devolve hora LOCAL sem fuso. Mandar a string
    // crua faria o banco ler como UTC e o encontro nasceria 3 horas adiantado.
    const quandoISO = new Date(novo.quando).toISOString()
    const r = await chamar('vessel_criar_private_edit', {
      p_stylist: novo.stylist, p_quando: quandoISO,
      p_local: novo.local || null, p_praca: novo.praca,
      p_loja: novo.loja || null, p_vagas: novo.vagas, p_teste: false,
    })
    // A mensagem do banco vem para a tela: ela já explica em português qual
    // conferência falhou.
    if (!r?.ok) { erroAoCriar.value = r?.erro || 'Não consegui criar agora.'; return }
    criado.value = r
    novo.local = ''
    await carregar()
  } catch {
    erroAoCriar.value = 'Não consegui falar com o banco agora. Tente de novo em um instante.'
  } finally {
    criando.value = false
  }
}

async function encerrar(encontro, ativa) {
  mexendo.value = encontro.codigo
  erroAoMexer.value = null
  try {
    const r = await chamar('vessel_private_edit_encerrar',
      { p_codigo: encontro.codigo, p_ativa: ativa })
    // ⚠️ Se a gravação falha, o selo NÃO muda: tela que parece salva e não
    // salvou é o defeito mais caro de perceber.
    if (!r?.ok) { erroAoMexer.value = encontro.codigo; return }
    confirmando.value = null
    await carregar()
  } catch {
    erroAoMexer.value = encontro.codigo
  } finally {
    mexendo.value = null
  }
}

// ── editar (inline) ─────────────────────────────────────────────────────────
const editando = ref(null)
const rascunho = reactive({ stylist: '', quando: '', local: '', praca: '', loja: '', vagas: 8 })
const salvandoEdicao = ref(null)
const erroDeEditar = ref(null)
const mensagemEditar = ref('')

function abrirEditar(e) {
  editando.value = e.codigo
  erroDeEditar.value = null
  apagando.value = null
  Object.assign(rascunho, {
    stylist: e.stylist || '',
    quando: paraCampoDatetimeLocal(e.quando),
    local: e.local || '',
    praca: e.praca || '',
    loja: e.loja || '',
    vagas: e.vagas,
  })
}

function fecharEditar() {
  editando.value = null
  erroDeEditar.value = null
}

async function salvarEdicao(e) {
  salvandoEdicao.value = e.codigo
  erroDeEditar.value = null
  try {
    const quandoISO = rascunho.quando ? new Date(rascunho.quando).toISOString() : null
    const r = await chamar('vessel_private_edit_editar', {
      p_codigo: e.codigo,
      p_quando: quandoISO,
      p_local: rascunho.local || null,
      p_praca: rascunho.praca || null,
      p_loja: rascunho.loja || null,
      p_vagas: rascunho.vagas || null,
      p_stylist: rascunho.stylist || null,
    })
    if (!r?.ok) {
      erroDeEditar.value = e.codigo
      mensagemEditar.value = mensagemDeEditar(r?.situacao)
      return
    }
    editando.value = null
    await carregar()
  } catch {
    erroDeEditar.value = e.codigo
    mensagemEditar.value = mensagemDeEditar('erro_de_rede')
  } finally {
    salvandoEdicao.value = null
  }
}

// ── arquivar / desarquivar ───────────────────────────────────────────────────
const arquivando = ref(null)
const erroDeArquivar = ref(null)
const mensagemArquivar = ref('')

async function alternarArquivar(e) {
  arquivando.value = e.codigo
  erroDeArquivar.value = null
  try {
    const r = await chamar('vessel_private_edit_arquivar',
      { p_codigo: e.codigo, p_arquivada: !e.arquivada })
    if (!r?.ok) {
      erroDeArquivar.value = e.codigo
      mensagemArquivar.value = mensagemDeArquivar(r?.situacao)
      return
    }
    await carregar()
  } catch {
    erroDeArquivar.value = e.codigo
    mensagemArquivar.value = mensagemDeArquivar('erro_de_rede')
  } finally {
    arquivando.value = null
  }
}

// ── apagar ───────────────────────────────────────────────────────────────────
const apagando = ref(null)
const mexendoApagar = ref(null)
const erroDeApagar = ref(null)
const mensagemApagar = ref('')
// codigo -> frase (quando a resposta foi `tem_gente`; NÃO é um erro).
const bloqueioDeApagar = reactive({})

async function apagar(e) {
  mexendoApagar.value = e.codigo
  erroDeApagar.value = null
  try {
    const r = await chamar('vessel_private_edit_apagar', { p_codigo: e.codigo })
    if (r?.ok) {
      apagando.value = null
      await carregar()
      return
    }
    if (r?.situacao === 'tem_gente') {
      // ⚠️ NÃO é erro vermelho: é a explicação de por que apagar está fora de
      // questão, com as duas saídas de verdade — ver private-edit-regras.js.
      bloqueioDeApagar[e.codigo] = mensagemDeTemGente(e.responderam)
      apagando.value = null
      return
    }
    erroDeApagar.value = e.codigo
    mensagemApagar.value = mensagemDeApagar(r?.situacao)
  } catch {
    erroDeApagar.value = e.codigo
    mensagemApagar.value = mensagemDeApagar('erro_de_rede')
  } finally {
    mexendoApagar.value = null
  }
}

// ── ver quem foi ─────────────────────────────────────────────────────────────
const convidadasAbertas = ref(null)
const carregandoConvidadas = ref(null)
const convidadas = reactive({})
const convidadasVazias = reactive({})
const convidadasErro = reactive({})

async function verQuemFoi(e) {
  // Um segundo clique no mesmo encontro fecha o bloco, sem ir ao banco de novo.
  if (convidadasAbertas.value === e.codigo) { convidadasAbertas.value = null; return }
  convidadasAbertas.value = e.codigo
  if (convidadas[e.codigo] || convidadasVazias[e.codigo]) return // já tem, não busca de novo
  carregandoConvidadas.value = e.codigo
  convidadasErro[e.codigo] = false
  try {
    // ⚠️ MESMA JANELA (P_DIAS) da conta do topo — R14: a régua da receita e a
    // régua da coluna "Comprou" têm de ser a mesma, na mesma tela.
    const lista = await chamar('vessel_convidadas_do_encontro',
      { p_codigo: e.codigo, p_dias: P_DIAS })
    if (Array.isArray(lista) && lista.length) {
      convidadas[e.codigo] = lista
      convidadasVazias[e.codigo] = false
    } else {
      // ⚠️ LISTA VAZIA NÃO É ERRO — é "ninguém respondeu ainda", diferente de
      // "deu erro ao buscar". As duas precisam de telas diferentes.
      convidadas[e.codigo] = null
      convidadasVazias[e.codigo] = true
    }
  } catch {
    convidadasErro[e.codigo] = true
  } finally {
    carregandoConvidadas.value = null
  }
}

async function copiar(texto, marca) {
  try {
    await navigator.clipboard.writeText(texto)
    copiado.value = marca
    setTimeout(() => { if (copiado.value === marca) copiado.value = null }, 2000)
  } catch { /* o endereço segue na tela para ser selecionado à mão */ }
}

onMounted(carregar)
</script>

<style scoped>
@import './estilo-comercial.css';
</style>
