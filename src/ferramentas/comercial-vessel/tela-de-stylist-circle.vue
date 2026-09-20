<template>
  <div class="tela-sty">
    <barra-de-topo :voltar="ROTULO_DO_PAI[paiDaTela('stylist-circle')]"
                   titulo="Vessel — Stylist Circle"
                   :subtitulo="subtitulo" @voltar="voltar" />

    <div class="cv-largo cv-body">
      <faixa-de-erro :erro="erro" @tentar-de-novo="carregar" />

      <!-- ── A PORTA DO PROGRAMA ────────────────────────────────────────── -->
      <section class="cv-bloco">
        <h2 class="cv-etiqueta">A porta de entrada</h2>
        <div class="cv-link">
          <div class="cv-link-texto">
            <span class="cv-link-nome">Onde a stylist se inscreve sozinha — uma vez, na vida</span>
            <code class="cv-link-url">{{ ENDERECO_DO_CIRCLE }}</code>
          </div>
          <button class="btn" @click="copiar(ENDERECO_DO_CIRCLE, 'circle')">
            {{ copiado === 'circle' ? 'Copiado' : 'Copiar' }}</button>
        </div>
        <p class="cv-nota">
          A maioria entra por aqui, e o código dela nasce sozinho. O bloco
          abaixo é para quem chega por outro caminho — telefone, indicação,
          balcão — e precisa ser cadastrada à mão.
        </p>
      </section>

      <!-- ── CADASTRAR ──────────────────────────────────────────────────── -->
      <section v-if="podeExecutarAcao('criar', podeEditar)" class="cv-bloco">
        <h2 class="cv-etiqueta">Cadastrar parceira</h2>
        <div class="cv-form">
          <label class="cv-campo" for="sty-nome"><span>Nome</span>
            <input id="sty-nome" type="text" maxlength="120" v-model="novo.nome"></label>
          <label class="cv-campo" for="sty-whatsapp"><span>WhatsApp</span>
            <input id="sty-whatsapp" type="text" maxlength="20" v-model="novo.whatsapp"
                   placeholder="(19) 99999-9999"></label>
          <label class="cv-campo" for="sty-cidade"><span>Cidade</span>
            <input id="sty-cidade" type="text" maxlength="80" v-model="novo.cidade"></label>
          <label class="cv-campo" for="sty-instagram"><span>Instagram</span>
            <input id="sty-instagram" type="text" maxlength="60" v-model="novo.instagram"
                   placeholder="@perfil"></label>
          <label class="cv-campo" for="sty-atuacao"><span>Atuação</span>
            <input id="sty-atuacao" type="text" maxlength="60" v-model="novo.atuacao"
                   placeholder="stylist, personal shopper…"></label>
          <label class="cv-campo" for="sty-praca"><span>Praça</span>
            <select id="sty-praca" v-model="novo.praca">
              <option value="">Escolha…</option>
              <option v-for="(nome, sigla) in PRACAS" :key="sigla" :value="sigla">{{ nome }}</option>
            </select></label>
        </div>

        <!-- ⚠️ O CÓDIGO NÃO EXISTE COMO CAMPO: quem gera é o banco, no formato
             STY-0000, e a resposta abaixo mostra o que ele criou. -->
        <ul v-if="problemas.length" class="cv-problemas">
          <li v-for="p in problemas" :key="p">{{ p }}</li>
        </ul>
        <p v-if="erroAoCriar" class="cv-nota cv-nota-erro">{{ erroAoCriar }}</p>
        <p v-if="criado" class="cv-nota cv-nota-ok">
          Parceira <b>{{ criado.codigo }}</b> cadastrada. O link dela está logo abaixo.
        </p>
        <div v-if="criado" class="cv-link">
          <div class="cv-link-texto">
            <span class="cv-link-nome">O link dela — story, bio, conversa</span>
            <code class="cv-link-url">{{ enderecoDaStylist(criado.codigo) }}</code>
          </div>
          <button class="btn" @click="copiar(enderecoDaStylist(criado.codigo), 'novo')">
            {{ copiado === 'novo' ? 'Copiado' : 'Copiar' }}</button>
        </div>

        <div class="cv-acoes">
          <button class="btn btn-principal" :disabled="problemas.length > 0 || criando"
                  @click="criar">{{ criando ? 'Cadastrando…' : 'Cadastrar parceira' }}</button>
        </div>
      </section>

      <!-- ── BUSCAR, FILTRAR E ORDENAR ──────────────────────────────────────
           ⚠️ SEM PERÍODO E SEM LOJA: esta é uma lista de PARCEIRAS, não de
           eventos numa loja — ligar um "Período" da barra a algo aqui não
           faria sentido nenhum e não tem para onde apontar no banco.
           ⚠️ SEM "Mais nova primeiro" TAMBÉM, DE PROPÓSITO:
           `vessel_rastreio_dos_stylists` não devolve data de criação nenhuma
           (nem `criado_em`, nem `quando`) — `filtrar()` (`filtros.js`)
           ordenaria por uma data que não existe, e o resultado seria a MESMA
           ordem de sempre, sem avisar ninguém. Uma opção que a pessoa escolhe
           e que não muda nada na tela é a mesma família de mentira que os
           campos que o banco escondia: oferecer o que a tela não consegue
           entregar. Quando a função devolver uma data de cadastro de
           verdade, esta opção volta. -->
      <barra-de-lista v-model="filtro" :estagios="ESTAGIOS"
                      :mostrar="['busca', 'situacao', 'estagio', 'ordem']"
                      placeholder-busca="nome, cidade ou código"
                      :situacoes="[
                        { valor: 'abertas', rotulo: 'Só ativas' },
                        { valor: 'encerradas', rotulo: 'Só desativadas' },
                        { valor: 'todas', rotulo: 'Todas' },
                      ]"
                      :ordens="[
                        { valor: 'nome', rotulo: 'Nome' },
                        { valor: 'aberturas', rotulo: 'Quem traz mais tráfego' },
                      ]" />

      <!-- ── COMO LER ───────────────────────────────────────────────────── -->
      <section v-if="!carregando && !erro && stylists.length" class="cv-bloco cv-bloco-leitura">
        <h2 class="cv-etiqueta">Como ler os números</h2>
        <p class="cv-nota cv-nota-primeira">
          <b>Aberturas</b> é leitura do link, não pessoa: a mesma cliente abrindo
          duas vezes conta duas. <b>Clientes</b> é gente com nome e WhatsApp.
          A conta entre as duas é aproximada justamente por isso — e por isso ela
          vem sempre com o número de quem a compõe.
        </p>
        <p class="cv-nota">
          <b>Pedidos por cliente</b> não é percentual, e é de propósito: a mesma
          cliente pode pedir visita duas vezes, então o número pode passar de 1.
          Mostrar isso como “taxa de 140%” faria quem lê desconfiar da tela — com
          razão.
        </p>
        <p class="cv-nota">
          <b>Receita</b> é a compra das clientes da stylist na janela declarada ao
          lado do valor. Não existe no dado nenhum campo dizendo “esta compra veio
          desta stylist”: o que existe é a mesma pessoa comprando perto da visita
          que ela trouxe.
        </p>
        <p class="cv-nota">
          <b>Desativada</b> não é apagada: ela sai da lista de escolher (quem
          marca um encontro não vê mais o código dela) e do topo desta tela, mas
          as aberturas e os atendimentos que ela já trouxe continuam contando no
          histórico. O filtro "Situação" traz ela de volta para quem precisar
          olhar.
        </p>
      </section>

      <div v-if="carregando" class="cv-carregando">Carregando…</div>

      <template v-else-if="!erro">
        <!-- ── O CONJUNTO ───────────────────────────────────────────────── -->
        <section v-if="stylists.length" class="cv-bloco">
          <h2 class="cv-etiqueta">Todas as stylists juntas</h2>
          <!-- ⚠️ O CONJUNTO É SOBRE O QUE ESTÁ NA TELA, NÃO SOBRE O QUE VEIO
               DO BANCO: se a pessoa filtrou por situação ou estágio, o total
               tem de acompanhar — reusar o total de antes do filtro é a tela
               mentindo com número certo. `calcularConjunto` só soma o que
               RECEBE (stylist-circle-regras.js), e aqui ela sempre recebe
               `stylistsNaTela`, nunca `stylists`. -->
          <p class="cv-nota cv-nota-primeira">
            {{ stylistsNaTela.length }} de {{ stylists.length }} stylists
            (o filtro de cima decide quais).
          </p>
          <div class="cv-numeros">
            <div class="cv-numero">
              <span class="cv-numero-valor">{{ conjunto.totalStylists }}</span>
              <span class="cv-numero-rotulo">Stylists</span>
            </div>
            <div class="cv-numero">
              <span class="cv-numero-valor">{{ conjunto.totalAberturas }}</span>
              <span class="cv-numero-rotulo">Aberturas de link</span>
            </div>
            <div class="cv-numero">
              <span class="cv-numero-valor">{{ emPorcento(conjunto.conjuntoClientes.valor) }}</span>
              <span class="cv-numero-rotulo">Viraram cliente</span>
              <span class="cv-numero-base">{{ taxaEscrita(conjunto.conjuntoClientes) }}</span>
            </div>
            <div class="cv-numero">
              <span class="cv-numero-valor">{{ emReais(conjunto.totalReceita) }}</span>
              <span class="cv-numero-rotulo">Receita somada</span>
              <span class="cv-numero-base">{{ janelaEscrita(conjunto.janela) }}</span>
            </div>
          </div>
          <p class="cv-nota">
            As taxas do conjunto somam numeradores e denominadores — não é a média
            das taxas de cada stylist, que daria a quem teve 2 aberturas o mesmo
            peso de quem teve 200.
          </p>
        </section>

        <!-- ── CADA STYLIST ─────────────────────────────────────────────── -->
        <section v-for="s in stylistsNaTela" :key="s.codigo" class="cv-bloco">
          <div class="cv-cabeca">
            <div class="cv-cabeca-texto">
              <h2 class="cv-titulo">{{ s.nome || s.codigo }}</h2>
              <p class="cv-sub">
                <span class="cv-codigo">{{ s.codigo }}</span>
                <span v-if="s.cidade"> · {{ s.cidade }}</span>
                <span v-if="s.praca_preview"> · preview em {{ s.praca_preview }}</span>
              </p>
            </div>
            <!-- ⚠️ `estagio` é texto livre, sem validação no banco (comentário
                 acima confirma) — então nada impede alguém de digitar
                 "ativa" como ESTÁGIO no funil, que é uma coisa (onde ela está
                 na jornada) totalmente diferente de "ativa" como SITUAÇÃO da
                 parceria (ela continua com a gente). Quando as duas
                 coincidem, as regras antigas imprimiam "Ativa" duas vezes
                 empilhado — lido na tela, parece bug de renderização
                 duplicada, não duas informações. A situação só é digna de um
                 selo à parte quando é a exceção: "Desativada". Continuar
                 ativa é o normal, não precisa de selo — só o estágio aparece
                 sozinho nesse caso, sem duplicar a palavra. -->
            <div class="cv-selos">
              <span v-if="s.ativa === false" class="cv-selo cv-selo-fim">Desativada</span>
              <span class="cv-selo" :class="s.estagio === 'ativa' ? 'cv-selo-viva' : 'cv-selo-fim'">
                {{ ESTAGIOS[s.estagio] || s.estagio || 'sem estágio' }}</span>
            </div>
          </div>

          <div class="cv-numeros">
            <div class="cv-numero">
              <span class="cv-numero-valor">{{ s.aberturas }}</span>
              <span class="cv-numero-rotulo">Abriram o link</span>
              <span class="cv-numero-base">leituras, não pessoas</span>
            </div>
            <div class="cv-numero">
              <span class="cv-numero-valor">{{ s.clientes }}</span>
              <span class="cv-numero-rotulo">Viraram cliente</span>
              <span class="cv-numero-base">{{ taxaEscrita(taxaCliente(s)) }}</span>
              <span v-if="margemEscrita(taxaCliente(s))" class="cv-numero-margem">
                {{ margemEscrita(taxaCliente(s)) }}</span>
            </div>
            <div class="cv-numero">
              <span class="cv-numero-valor">{{ s.pedidos }}</span>
              <span class="cv-numero-rotulo">Pedidos de visita</span>
              <!-- ⚠️ RAZÃO, não taxa: a mesma cliente pode pedir duas vezes. -->
              <span class="cv-numero-base">{{ razaoEscrita(pedidosPorCliente(s), 'por cliente') }}</span>
            </div>
            <div class="cv-numero">
              <span class="cv-numero-valor">{{ s.compareceram }}</span>
              <span class="cv-numero-rotulo">Foram à loja</span>
              <span class="cv-numero-base">{{ taxaEscrita(taxaPresenca(s)) }} dos pedidos</span>
              <span v-if="margemEscrita(taxaPresenca(s))" class="cv-numero-margem">
                {{ margemEscrita(taxaPresenca(s)) }}</span>
            </div>
            <div class="cv-numero">
              <span class="cv-numero-valor">{{ emReais(s.receita) }}</span>
              <span class="cv-numero-rotulo">Receita</span>
              <span class="cv-numero-base">{{ janelaEscrita(s.janela_de_venda_em_dias) }}</span>
            </div>
          </div>

          <h3 class="cv-etiqueta cv-etiqueta-interna">O link dela</h3>
          <div class="cv-link">
            <div class="cv-link-texto">
              <span class="cv-link-nome">O permanente — story, bio, conversa</span>
              <code class="cv-link-url">{{ enderecoDaStylist(s.codigo) }}</code>
            </div>
            <button class="btn" @click="copiar(enderecoDaStylist(s.codigo), s.codigo)">
              {{ copiado === s.codigo ? 'Copiado' : 'Copiar' }}</button>
          </div>
          <p class="cv-nota">
            <b>Código nunca muda</b>: ele está dentro deste link, já colado em
            stories e conversas antigas — trocá-lo mataria os links em
            circulação e a atribuição das aberturas já contadas.
          </p>

          <!-- ── CORRIGIR (inline, sem modal) ─────────────────────────────
               ⚠️ ORIGEM NÃO ENTRA AQUI, DE PROPÓSITO: `origem_canal`,
               `origem_campanha` e `origem_utm` nem existem como parâmetro de
               `vessel_stylist_editar` — primeiro toque é primeiro toque, e
               reescrever faria a atribuição contar o mesmo canal duas vezes. -->
          <template v-if="podeExecutarAcao('editar', podeEditar) && editando === s.codigo">
            <h3 class="cv-etiqueta cv-etiqueta-interna">Corrigir</h3>
            <div class="cv-form">
              <label class="cv-campo" :for="`ed-nome-${s.codigo}`"><span>Nome</span>
                <input :id="`ed-nome-${s.codigo}`" type="text" maxlength="120" v-model="rascunho.nome"></label>
              <label class="cv-campo" :for="`ed-whatsapp-${s.codigo}`"><span>WhatsApp</span>
                <input :id="`ed-whatsapp-${s.codigo}`" type="text" maxlength="20" v-model="rascunho.whatsapp"></label>
              <label class="cv-campo" :for="`ed-cidade-${s.codigo}`"><span>Cidade</span>
                <input :id="`ed-cidade-${s.codigo}`" type="text" maxlength="80" v-model="rascunho.cidade"></label>
              <label class="cv-campo" :for="`ed-instagram-${s.codigo}`"><span>Instagram</span>
                <input :id="`ed-instagram-${s.codigo}`" type="text" maxlength="60" v-model="rascunho.instagram"></label>
              <label class="cv-campo" :for="`ed-atuacao-${s.codigo}`"><span>Atuação</span>
                <input :id="`ed-atuacao-${s.codigo}`" type="text" maxlength="60" v-model="rascunho.atuacao"></label>
              <label class="cv-campo" :for="`ed-estagio-${s.codigo}`"><span>Estágio</span>
                <input :id="`ed-estagio-${s.codigo}`" type="text" maxlength="40" v-model="rascunho.estagio"
                       list="sty-estagios-sugeridos"></label>
              <label class="cv-campo" :for="`ed-praca-${s.codigo}`"><span>Praça</span>
                <select :id="`ed-praca-${s.codigo}`" v-model="rascunho.praca">
                  <option value="">Escolha…</option>
                  <option v-for="(nome, sigla) in PRACAS" :key="sigla" :value="sigla">{{ nome }}</option>
                </select></label>
            </div>
            <p class="cv-nota">
              <b>Código nunca muda</b> — está dentro do link já colado por aí.
              <b>Origem não se corrige</b>: primeiro toque é primeiro toque.
            </p>
            <p v-if="erroDeEditar === s.codigo" class="cv-nota cv-nota-erro">{{ mensagemEditar }}</p>
            <div class="cv-acoes">
              <button class="btn" :disabled="salvandoEdicao === s.codigo" @click="fecharEditar">Cancelar</button>
              <button class="btn btn-principal" :disabled="salvandoEdicao === s.codigo"
                      @click="salvarEdicao(s)">{{ salvandoEdicao === s.codigo ? 'Salvando…' : 'Salvar' }}</button>
            </div>
          </template>

          <div class="cv-acoes">
            <template v-if="podeExecutarAcao('editar', podeEditar)">
              <button v-if="editando !== s.codigo" class="btn" @click="abrirEditar(s)">Corrigir…</button>
            </template>

            <!-- ⚠️ R13: Desativar E Reativar são o MESMO botão (a mesma
                 chamada, com `p_ativa` trocado) atrás do MESMO gate de
                 editar — as duas telas irmãs (Private Edit, Beauty Session)
                 levaram Critical exatamente por deixar o `v-else` desta
                 dupla fora do `v-if` que já protegia a outra metade. A regra
                 mora em `podeExecutarAcao` (stylist-circle-regras.js),
                 testada — não reescrita aqui como um `v-if` solto de novo. -->
            <template v-if="podeExecutarAcao('desativar', podeEditar)">
              <template v-if="s.ativa !== false">
                <button v-if="confirmando !== s.codigo" class="btn"
                        @click="confirmando = s.codigo">Desativar…</button>
                <template v-else>
                  <span class="cv-confirma">Ela sai da lista de escolher. As
                    aberturas e os atendimentos que ela trouxe continuam
                    contando no histórico.</span>
                  <button class="btn" @click="confirmando = null">Deixar como está</button>
                  <button class="btn" :disabled="mexendo === s.codigo"
                          @click="desativar(s, false)">Desativar</button>
                </template>
              </template>
              <button v-else class="btn" :disabled="mexendo === s.codigo"
                      @click="desativar(s, true)">Reativar</button>
            </template>
          </div>
          <p v-if="erroAoMexer === s.codigo" class="cv-nota cv-nota-erro">{{ mensagemMexer }}</p>
        </section>

        <p v-if="!stylistsNaTela.length && stylists.length" class="cv-vazio">
          Nenhuma stylist passa neste filtro. Experimente "Todas" ou outra busca.
        </p>
        <p v-if="!stylists.length" class="cv-vazio">
          Nenhuma stylist inscrita ainda. Ela entra pela porta de cima, ou
          cadastre a primeira no bloco acima.
        </p>
      </template>
    </div>

    <datalist id="sty-estagios-sugeridos">
      <option v-for="(rotulo, chave) in ESTAGIOS" :key="chave" :value="chave">{{ rotulo }}</option>
    </datalist>
  </div>
</template>

<script setup>
/* VESSEL — STYLIST CIRCLE: o que cada stylist trouxe, e agora também
 * cadastrar, corrigir e desativar uma parceira.
 *
 * ⚠️ A INSCRIÇÃO PELA PORTA PÚBLICA CONTINUA SENDO O CAMINHO PRINCIPAL — o
 * bloco "Cadastrar parceira" é para quem chega por outro canal (telefone,
 * indicação, balcão) e não passou pela LP. As duas portas geram o MESMO
 * formato de código (`vessel_stylist_criar` gera do mesmo jeito que
 * `vessel_stylist_entrar`), e a diferença fica só em `origem_canal`: quem
 * entra pela LP carrega canal/campanha/UTM; quem é cadastrada aqui nasce com
 * origem nula, de propósito (ninguém "adquiriu" essa parceira por campanha
 * nenhuma) — ver o comentário de `vessel_stylist_criar` na migration.
 *
 * ⚠️ LÊ COM O TOKEN DA SESSÃO, NUNCA COM A CHAVE ANÔNIMA: a função confere
 * `is_vessel_atendimentos()` por dentro, e com a chave anônima o PostgREST
 * responde 200 com lista VAZIA — "nenhuma stylist" para um programa cheio.
 *
 * ⚠️ SEM PERÍODO NENHUM NESTA BARRA (R do controlador): esta tela é uma lista
 * de PARCEIRAS, não de eventos numa loja/data. `p_dias` (7, cravado abaixo)
 * só decide a janela de atribuição de venda que já vem dentro de cada linha
 * (`janela_de_venda_em_dias`) — nunca filtra quem aparece. Por isso não existe
 * aqui nenhum observador sobre o campo de dias do filtro.
 *
 * ⚠️ DESATIVADA PRECISA DE RE-FETCH, NÃO DE FILTRO CLIENT-SIDE (o mesmo R1 das
 * irmãs, com outro nome): `vessel_rastreio_dos_stylists` já chega SEM quem
 * está desativada (`p_incluir_desativadas boolean default false`). Só quando
 * a situação escolhida é "Só desativadas" ou "Todas" a tela volta ao banco
 * pedindo `p_incluir_desativadas: true` — ver `precisaDasDesativadas` em
 * `stylist-circle-regras.js` (NÃO é `precisaDoBanco` de `filtros.js`: aquela
 * fala de "arquivada", que esta tela não tem).
 *
 * ⚠️ E "PEDIDOS ÷ CLIENTES" NÃO É TAXA. A mesma cliente pode pedir visita duas
 * vezes, então o número passa de 1 — mostrar "140%" num campo rotulado como
 * taxa faz quem lê desconfiar da tela inteira, com razão. Vai como razão.
 */
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import BarraDeTopo from '../../compartilhado/barra-de-topo.vue'
import FaixaDeErro from '../../compartilhado/faixa-de-erro.vue'
import BarraDeLista from './barra-de-lista.vue'
import { estado, hasPermission } from '../../compartilhado/controle-de-login-e-usuario.js'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../compartilhado/conectar-no-banco-de-dados.js'
import { classificarErro } from '../../compartilhado/classificar-erro.js'
import { enderecoDaStylist, ENDERECO_DO_CIRCLE, ESTAGIOS } from './enderecos-publicos.js'
import {
  proporcao, razao, razaoEscrita, taxaEscrita, margemEscrita,
  emPorcento, emReais, janelaEscrita,
} from './estatistica.js'
import { filtrar, FILTRO_VAZIO } from './filtros.js'
import {
  podeExecutarAcao, calcularConjunto, precisaDasDesativadas, problemasDaParceira,
  mensagemDeCriar, mensagemDeEditar, mensagemDeDesativar,
} from './stylist-circle-regras.js'
import { paiDaTela, ROTULO_DO_PAI } from './navegacao.js'

const router = useRouter()
function voltar() { router.push({ name: paiDaTela('stylist-circle') }) }

const PRACAS = { CPS: 'Campinas', SAO: 'São Paulo', SBO: 'Santa Bárbara', BSB: 'Brasília' }

// ⚠️ A JANELA DE ATRIBUIÇÃO DE VENDA — não é o período da barra (que nem
// existe nesta tela). Mantida no valor de sempre desta tela.
const P_DIAS = 7

const podeEditar = computed(() => hasPermission('atendimentos', 'editar'))

const stylists = ref([])
const carregando = ref(true)
const erro = ref(null)
const copiado = ref(null)

// ⚠️ `ordem: 'nome'` SOBRESCREVE O PADRÃO DE `FILTRO_VAZIO` ('data-nova'): essa
// opção não existe na barra desta tela (ver o comentário no template) — um
// valor inicial que não é nenhuma das opções mostradas deixaria o <select>
// sem nada selecionado visualmente.
const filtro = ref({ ...FILTRO_VAZIO, situacao: 'abertas', ordem: 'nome' })

// ⚠️ O FILTRO E O TOTAL AGEM SOBRE O QUE ESTÁ NA TELA: busca por
// nome/cidade/código, estágio e ordem — tudo client-side, sobre `stylists`,
// que só volta ao banco quando a situação exige desativada (ver o watch
// abaixo). Sem período, sem loja: não existem nesta tela.
const stylistsNaTela = computed(() =>
  filtrar(stylists.value, filtro.value, { busca: ['nome', 'cidade', 'codigo'], estagio: 'estagio' }))

// ⚠️ MESMO CUIDADO DAS DUAS IRMÃS (Critical da rodada anterior nelas): o
// conjunto tem de somar SEMPRE a lista filtrada, nunca a cheia.
// `calcularConjunto` (stylist-circle-regras.js, testada) só soma o que
// RECEBE — aqui ela sempre recebe `stylistsNaTela`.
const conjunto = computed(() => calcularConjunto(stylistsNaTela.value))

const subtitulo = computed(() => {
  if (carregando.value || erro.value) return ''
  return `${conjunto.value.totalStylists} de ${stylists.value.length} stylist(s) na tela · `
    + `${conjunto.value.totalAberturas} abertura(s)`
})

/* Proporções de verdade: cada pedido aconteceu ou não. */
const taxaCliente = (s) => proporcao(s.clientes, s.aberturas)
const taxaPresenca = (s) => proporcao(s.compareceram, s.pedidos)
/* ⚠️ RAZÃO, não proporção — pode passar de 1. Ver o cabeçalho. */
const pedidosPorCliente = (s) => razao(s.pedidos, s.clientes)

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
    // ⚠️ SÓ PEDE AS DESATIVADAS QUANDO A SITUAÇÃO PRECISA: a função de
    // rastreio já chega sem elas por padrão — ver `precisaDasDesativadas`.
    const incluirDesativadas = precisaDasDesativadas(filtro.value.situacao)
    const r = await chamar('vessel_rastreio_dos_stylists',
      { p_dias: P_DIAS, p_incluir_desativadas: incluirDesativadas })
    stylists.value = r || []
  } catch (e) {
    erro.value = classificarErro(e)
  } finally {
    carregando.value = false
  }
}

// ⚠️ O ÚNICO GATILHO DE VOLTAR AO BANCO É A SITUAÇÃO PEDIR DESATIVADA — nunca
// busca, estágio ou ordem: esses três filtram o que já está em memória.
watch(() => precisaDasDesativadas(filtro.value.situacao), (precisaAgora, precisavaAntes) => {
  if (precisaAgora !== precisavaAntes) carregar()
})

// ── cadastrar ────────────────────────────────────────────────────────────────
const novo = reactive({ nome: '', whatsapp: '', cidade: '', instagram: '', atuacao: '', praca: '' })
const problemas = computed(() => problemasDaParceira(novo))
const criando = ref(false)
const criado = ref(null)
const erroAoCriar = ref('')

async function criar() {
  if (problemas.value.length) return
  criando.value = true
  erroAoCriar.value = ''
  criado.value = null
  try {
    const r = await chamar('vessel_stylist_criar', {
      p_nome: novo.nome,
      p_whatsapp: novo.whatsapp,
      p_cidade: novo.cidade || null,
      p_instagram: novo.instagram || null,
      p_atuacao: novo.atuacao || null,
      p_praca: novo.praca || null,
    })
    if (!r?.ok) {
      erroAoCriar.value = mensagemDeCriar(r?.situacao)
        + (r?.situacao === 'whatsapp_repetido' && r?.codigo ? ` (${r.codigo})` : '')
      return
    }
    criado.value = r
    Object.assign(novo, { nome: '', whatsapp: '', cidade: '', instagram: '', atuacao: '', praca: '' })
    await carregar()
  } catch {
    erroAoCriar.value = 'Não consegui falar com o banco agora. Tente de novo em um instante.'
  } finally {
    criando.value = false
  }
}

// ── corrigir (inline) ────────────────────────────────────────────────────────
const editando = ref(null)
const rascunho = reactive({ nome: '', whatsapp: '', cidade: '', instagram: '', atuacao: '', estagio: '', praca: '' })
const salvandoEdicao = ref(null)
const erroDeEditar = ref(null)
const mensagemEditar = ref('')

function abrirEditar(s) {
  editando.value = s.codigo
  erroDeEditar.value = null
  confirmando.value = null
  Object.assign(rascunho, {
    nome: s.nome || '',
    whatsapp: s.whatsapp || '',
    cidade: s.cidade || '',
    instagram: s.instagram || '',
    atuacao: s.atuacao || '',
    estagio: s.estagio || '',
    praca: s.praca_preview || '',
  })
}

function fecharEditar() {
  editando.value = null
  erroDeEditar.value = null
}

async function salvarEdicao(s) {
  salvandoEdicao.value = s.codigo
  erroDeEditar.value = null
  try {
    const r = await chamar('vessel_stylist_editar', {
      p_codigo: s.codigo,
      p_nome: rascunho.nome || null,
      p_whatsapp: rascunho.whatsapp || null,
      p_cidade: rascunho.cidade || null,
      p_instagram: rascunho.instagram || null,
      p_atuacao: rascunho.atuacao || null,
      p_estagio: rascunho.estagio || null,
      p_praca: rascunho.praca || null,
    })
    if (!r?.ok) {
      erroDeEditar.value = s.codigo
      mensagemEditar.value = mensagemDeEditar(r?.situacao)
      return
    }
    editando.value = null
    await carregar()
  } catch {
    erroDeEditar.value = s.codigo
    mensagemEditar.value = mensagemDeEditar('erro_de_rede')
  } finally {
    salvandoEdicao.value = null
  }
}

// ── desativar / reativar ─────────────────────────────────────────────────────
const confirmando = ref(null)
const mexendo = ref(null)
const erroAoMexer = ref(null)
const mensagemMexer = ref('')

async function desativar(s, ativa) {
  mexendo.value = s.codigo
  erroAoMexer.value = null
  try {
    const r = await chamar('vessel_stylist_desativar', { p_codigo: s.codigo, p_ativa: ativa })
    if (!r?.ok) {
      erroAoMexer.value = s.codigo
      mensagemMexer.value = mensagemDeDesativar(r?.situacao)
      return
    }
    confirmando.value = null
    await carregar()
  } catch {
    erroAoMexer.value = s.codigo
    mensagemMexer.value = mensagemDeDesativar('erro_de_rede')
  } finally {
    mexendo.value = null
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

/* ⚠️ DUAS SELOS NO MESMO CARD (situação da parceira + estágio do funil) SÃO
   DUAS COISAS DIFERENTES: "ativa/desativada" é a parceria em si; "estágio" é
   onde ela está no funil. Empilhados aqui para contarem como UM item de
   flexbox ao lado de `cv-cabeca-texto` — soltos, o `justify-content:
   space-between` de `.cv-cabeca` os espalharia pela largura toda. */
.cv-selos {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: var(--sp-2);
}
</style>
