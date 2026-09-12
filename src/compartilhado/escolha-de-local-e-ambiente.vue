<template>
  <div class="esc-local">
    <!-- 1. O QUE ESTÁ VALENDO AGORA. Fica no topo porque é a pergunta que a
         pessoa faz primeiro: "o que está escrito aqui hoje?" -->
    <div class="esc-local-atual" :class="'esc-local-atual-' + estado.tipo">
      <div class="esc-local-atual-txt">
        <span class="esc-local-etiqueta">{{ rotulo }}</span>
        <strong v-if="estado.tipo === 'escolhido'" class="esc-local-caminho">{{ estado.caminho.rotulo }}</strong>
        <span v-else-if="estado.tipo === 'texto-livre'" class="esc-local-caminho esc-local-caminho-fraco">{{ estado.texto }}</span>
        <span v-else-if="estado.tipo === 'local-sumiu'" class="esc-local-caminho esc-local-caminho-fraco">local que não está mais na lista</span>
        <span v-else class="esc-local-caminho esc-local-caminho-fraco">ainda não escolhido</span>
      </div>
      <button v-if="estado.tipo === 'escolhido'" type="button" class="btn esc-local-acao" @click="limparEscolha">
        Limpar
      </button>
    </div>

    <!-- 2. O TEXTO ANTIGO NUNCA SOME. Nem quando ainda não aponta pra nada
         (Barracão), nem quando já foi substituído (aí vira lembrete). -->
    <div v-if="estado.tipo === 'texto-livre'" class="esc-local-aviso">
      <p class="esc-local-aviso-txt">
        Está escrito <strong>“{{ estado.texto }}”</strong>, mas isso é só texto: não aponta
        pra nenhum local do cadastro. Escolha o local certo abaixo — nada é apagado sozinho.
      </p>
      <div v-if="estado.sugestoes.length" class="esc-local-sugestoes">
        <span class="esc-local-sugestoes-titulo">Pode ser um destes. Confira a marca antes:</span>
        <button v-for="s in estado.sugestoes" :key="s.id" type="button"
                class="esc-local-sugestao" @click="escolherLocal(s)">
          {{ s.empresaNome }} › {{ s.nome }}
        </button>
      </div>
      <p v-else class="esc-local-aviso-txt">
        Não há nada parecido no cadastro. Escolha um local da lista, ou use o
        <strong>+</strong> pra criar o que falta.
      </p>
    </div>

    <div v-else-if="estado.tipo === 'local-sumiu'" class="esc-local-aviso">
      <p class="esc-local-aviso-txt">
        Este campo aponta pra um local que não aparece mais na lista — pode ter sido
        apagado, ou você pode não ter acesso a ele. Não mexi em nada. Escolha um local
        abaixo pra corrigir.
      </p>
    </div>

    <p v-else-if="estado.tipo === 'escolhido' && estado.textoAntigo" class="esc-local-nota">
      Antes estava escrito “{{ estado.textoAntigo }}”. Ao salvar, o local escolhido passa a valer.
    </p>

    <!-- 3. BUSCA: digitar PENEIRA o que já existe, nunca cria às cegas. É o
         defeito que este componente veio resolver. -->
    <div class="esc-local-busca">
      <input v-model="busca" type="search" class="esc-local-busca-campo"
             :placeholder="'Filtrar entre ' + totalLocais + ' locais…'"
             @keyup.esc.stop="busca = ''">
      <button v-if="podeCriar" type="button" class="esc-local-mais" title="Cadastrar uma marca nova"
              :aria-label="'Cadastrar uma marca nova'" @click="abrirNovo('marca', null)">+</button>
    </div>

    <!-- Caixinha do "+": nasce e morre no nível que a abriu. -->
    <div v-if="novoNivel === 'marca'" class="esc-local-novo">
      <input v-model="novoNome" ref="campoNovo" type="text" class="esc-local-novo-campo"
             placeholder="Nome da marca nova…"
             @keyup.enter="confirmarNovo" @keyup.esc.stop="cancelarNovo">
      <button type="button" class="btn btn-principal esc-local-acao" :disabled="criando" @click="confirmarNovo">
        {{ criando ? 'Criando…' : 'Criar' }}
      </button>
      <button type="button" class="btn esc-local-acao" @click="cancelarNovo">Cancelar</button>
    </div>
    <p v-if="recado" class="esc-local-nota">{{ recado }}</p>

    <!-- 4. A ÁRVORE. Marca › Local › Ambiente, tudo à vista por padrão. -->
    <!-- Sem role="tree": ARIA de árvore pela metade (sem treeitem em cada nível,
         sem navegação por seta do teclado) atrapalha mais que ajuda o leitor de
         tela. O que carrega o sentido aqui é `aria-expanded` e `aria-pressed`,
         que são verdade. -->
    <div class="esc-local-arvore" :aria-label="rotulo">
      <p v-if="!arvoreVisivel.length" class="esc-local-vazio">
        <template v-if="busca">Nada com “{{ busca }}”. Limpe o filtro, ou use o <strong>+</strong> pra cadastrar.</template>
        <template v-else>Nenhum local cadastrado ainda.</template>
      </p>

      <div v-for="marca in arvoreVisivel" :key="marca.id" class="esc-local-marca">
        <div class="esc-local-linha esc-local-linha-marca">
          <button type="button" class="esc-local-no esc-local-no-marca"
                  :aria-expanded="String(marcaAberta(marca.id))" @click="alternarMarca(marca.id)">
            <span class="esc-local-seta" aria-hidden="true">{{ marcaAberta(marca.id) ? '▾' : '▸' }}</span>
            <span class="esc-local-nome">{{ marca.nome }}</span>
            <span class="esc-local-conta">{{ marca.locais.length }}</span>
          </button>
          <button v-if="podeCriar && !marca.ehSemValor" type="button" class="esc-local-mais"
                  :title="'Cadastrar um local novo em ' + marca.nome"
                  :aria-label="'Cadastrar um local novo em ' + marca.nome"
                  @click="abrirNovo('local', marca)">+</button>
        </div>

        <div v-if="novoNivel === 'local' && novoPai.id === marca.id" class="esc-local-novo esc-local-novo-fundo">
          <input v-model="novoNome" ref="campoNovo" type="text" class="esc-local-novo-campo"
                 :placeholder="'Nome do local novo em ' + marca.nome + '…'"
                 @keyup.enter="confirmarNovo" @keyup.esc.stop="cancelarNovo">
          <button type="button" class="btn btn-principal esc-local-acao" :disabled="criando" @click="confirmarNovo">
            {{ criando ? 'Criando…' : 'Criar' }}
          </button>
          <button type="button" class="btn esc-local-acao" @click="cancelarNovo">Cancelar</button>
        </div>

        <div v-if="marcaAberta(marca.id)" class="esc-local-filhos">
          <div v-for="local in marca.locais" :key="local.id" class="esc-local-item">
            <div class="esc-local-linha">
              <button type="button" class="esc-local-no esc-local-no-local"
                      :class="{ 'esc-local-no-marcado': local.id === localId, 'esc-local-no-travado': !local.selecionavel }"
                      :disabled="!local.selecionavel"
                      :aria-pressed="String(local.id === localId)"
                      @click="escolherLocal(local)">
                <span v-if="comAmbiente && local.comodos.length" class="esc-local-seta" aria-hidden="true">
                  {{ localAberto(local.id) ? '▾' : '▸' }}
                </span>
                <span class="esc-local-nome">
                  {{ local.nome }}<small class="esc-local-marca-do-local">{{ local.empresaNome }}</small>
                </span>
                <span v-if="local.nomeRepetido" class="esc-local-selo" title="Existe outro local com este mesmo nome em outra marca">
                  nome repetido
                </span>
                <span v-if="comAmbiente && local.comodos.length" class="esc-local-conta">{{ local.comodos.length }}</span>
              </button>
              <!-- O "+" de ambiente aparece no local que está ABERTO, não em
                   todos: uma coluna de "+" repetida em 18 linhas vira ruído, e
                   ambiente só se cadastra quando se está olhando pro local. -->
              <button v-if="podeCriar && comAmbiente && local.selecionavel && localEmFoco(local.id)"
                      type="button" class="esc-local-mais"
                      :title="'Cadastrar um ambiente novo em ' + local.nome"
                      :aria-label="'Cadastrar um ambiente novo em ' + local.nome"
                      @click="abrirNovo('ambiente', local)">+</button>
            </div>

            <div v-if="novoNivel === 'ambiente' && novoPai.id === local.id" class="esc-local-novo esc-local-novo-fundo">
              <input v-model="novoNome" ref="campoNovo" type="text" class="esc-local-novo-campo"
                     :placeholder="'Nome do ambiente novo em ' + local.nome + '…'"
                     @keyup.enter="confirmarNovo" @keyup.esc.stop="cancelarNovo">
              <button type="button" class="btn btn-principal esc-local-acao" :disabled="criando" @click="confirmarNovo">
                {{ criando ? 'Criando…' : 'Criar' }}
              </button>
              <button type="button" class="btn esc-local-acao" @click="cancelarNovo">Cancelar</button>
            </div>

            <div v-if="comAmbiente && localAberto(local.id)" class="esc-local-filhos">
              <button v-for="amb in local.comodos" :key="amb.id" type="button"
                      class="esc-local-no esc-local-no-ambiente"
                      :class="{ 'esc-local-no-marcado': amb.id === comodoId, 'esc-local-no-travado': !local.selecionavel }"
                      :disabled="!local.selecionavel"
                      :aria-pressed="String(amb.id === comodoId)"
                      @click="escolherAmbiente(local, amb)">
                <span class="esc-local-nome">{{ amb.nome }}</span>
              </button>
              <p v-if="!local.comodos.length" class="esc-local-vazio">
                Sem ambiente cadastrado neste local.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
/* ESCOLHER LOCAL (e, quando o caso pedir, o AMBIENTE) VENDO O QUE JÁ EXISTE.
 *
 * A queixa que originou isto, nas palavras do dono: "campos que puxam marca,
 * local, ambiente, precisam ser universais também, mostrar lista em árvores...
 * fui editar a ficha de carro BMW, aí tem lá campo local, eu digito ao invés de
 * já mostrar tudo o que já temos em banco".
 *
 * A árvore Marca → Local → Ambiente já existe no banco (5 marcas, 18 locais, 55
 * ambientes) e o Patrimônio já a usa. A Frota não: `frota_veiculos.local_texto`
 * é texto livre, e quem edita a ficha digita às cegas. Este componente é a
 * mesma escolha, com a mesma cara, em qualquer ferramenta.
 *
 * TRÊS COISAS QUE NÃO SÃO ENFEITE:
 *
 * 1. A MARCA APARECE SEMPRE ao lado do local. Existem DUAS "Fábrica Conchal"
 *    (Vessel e RB Builders) e DUAS "Sede Limeira" (RBV Company e Vessel) —
 *    mesmo endereço, empresas diferentes. Não são duplicatas; juntar embolaria
 *    o patrimônio de duas empresas. Uma lista que mostra "Fábrica Conchal" duas
 *    vezes sem dizer de quem é não dá a quem escolhe como acertar.
 *
 * 2. DIGITAR FILTRA, NÃO CRIA. O campo de busca peneira a árvore. Criar é o
 *    "+", que é explícito.
 *
 * 3. O TEXTO LIVRE ANTIGO NÃO SOME E NÃO É ADIVINHADO. "Conchal" parece
 *    "Fábrica Conchal", mas parecer não é ser — e como há duas Fábrica Conchal,
 *    chutar erraria metade das vezes no melhor caso. O componente mostra o
 *    texto, oferece as candidatas, e deixa a pessoa apontar.
 *
 * COMO O PAI USA (o componente não toca no banco de propósito: quem sabe de
 * permissão e de tabela é a tela):
 *
 *   <escolha-de-local-e-ambiente
 *     :empresas="empresas" :locais="locais" :comodos="comodos"
 *     v-model:localId="form.local_id"
 *     v-model:comodoId="form.comodo_id"     <!-- só se com-ambiente -->
 *     :texto-livre="form.local_texto"
 *     com-ambiente :pode-criar="podeEditar" :criando="salvandoNovaOpcao"
 *     @criar="criarOpcao" />
 *
 * `@criar` recebe { nivel: 'marca'|'local'|'ambiente', nome, empresaId, localId }.
 * O pai insere na tabela e RECARREGA as listas — a caixinha do "+" se fecha
 * sozinha quando o nome novo aparece nas props (e, se a gravação falhar, ela
 * fica aberta com o que foi digitado, em vez de fingir que criou).
 *
 * O `texto-livre` também é do pai: quando ele salvar o local escolhido, é ele
 * que decide o que fazer com a coluna de texto antiga. Aqui ela só é MOSTRADA. */
import { ref, reactive, computed, watch, nextTick } from 'vue'
import { montarArvore, filtrarArvore, listarLocais, estadoDaEscolha } from './arvore-de-locais.js'
// De propósito reaproveitando a regra do "+" compartilhada — a mesma que o
// Patrimônio e a escolha de pessoa usam —, em vez de escrever uma segunda: ela
// decide se o nome digitado vira cadastro novo ou se
// já existe e é só selecionar (comparando sem caixa e sem espaço nas pontas —
// senão a lista vira "Volvo", "VOLVO" e "volvo" convivendo, que é o estado real
// de Marcas hoje).
import { resolverNovaOpcao, normalizarNome } from './nova-opcao.js'

const props = defineProps({
  // As três listas cruas do banco, do jeito que a tela de Patrimônio já busca.
  empresas: { type: Array, default: () => [] },   // { id, nome }
  locais: { type: Array, default: () => [] },     // { id, nome, empresa_id }
  comodos: { type: Array, default: () => [] },    // { id, nome, local_id }

  localId: { type: String, default: '' },
  comodoId: { type: String, default: '' },

  // O que estava escrito à mão antes de existir esta escolha (na Frota, o
  // `local_texto`). Só é mostrado — nunca apagado por aqui.
  textoLivre: { type: String, default: '' },

  // O Patrimônio precisa do ambiente; o carro, provavelmente só do local. É uma
  // propriedade e não dois componentes justamente pra não virar duas telas
  // parecidas que divergem com o tempo.
  comAmbiente: { type: Boolean, default: false },

  // Quem não pode cadastrar não vê o "+" — mas continua vendo a árvore inteira.
  podeCriar: { type: Boolean, default: false },

  // O pai avisa que está gravando, pra o botão dizer "Criando…" e não aceitar
  // dois toques.
  criando: { type: Boolean, default: false },

  rotulo: { type: String, default: 'Local' },
})

const emit = defineEmits(['update:localId', 'update:comodoId', 'criar'])

const arvore = computed(() => montarArvore({
  empresas: props.empresas, locais: props.locais, comodos: props.comodos,
}))
const totalLocais = computed(() => listarLocais(arvore.value).length)

const busca = ref('')
const arvoreVisivel = computed(() => filtrarArvore(arvore.value, busca.value))

const estado = computed(() => estadoDaEscolha({
  arvore: arvore.value,
  localId: props.localId,
  comodoId: props.comodoId,
  textoLivre: props.textoLivre,
}))

// ── Abrir e fechar ──────────────────────────────────────────────────────────
// Nasce TUDO aberto: o pedido é justamente ver de cara o que já existe. O que
// se guarda é o que a pessoa FECHOU — assim uma marca nova já nasce visível.
const marcasFechadas = reactive(new Set())
const locaisAbertos = reactive(new Set())

// Filtrando, o resultado aparece aberto: esconder atrás de um toque o que a
// pessoa acabou de procurar seria o mesmo defeito de digitar às cegas.
const marcaAberta = (id) => !!busca.value || !marcasFechadas.has(id)
// "Em foco" = a pessoa abriu este local, ou é o que está escolhido. Diferente de
// `localAberto`, que também vale enquanto se está filtrando — filtrar mostra
// tudo o que casou, mas não é hora de oferecer "+" em cada linha da lista.
const localEmFoco = (id) => locaisAbertos.has(id) || ehLocalDaEscolha(id)
const localAberto = (id) => !!busca.value || localEmFoco(id)

function ehLocalDaEscolha(id) {
  return !!props.localId && props.localId === id
}
function alternarMarca(id) {
  if (marcasFechadas.has(id)) marcasFechadas.delete(id)
  else marcasFechadas.add(id)
}

// ── Escolher ────────────────────────────────────────────────────────────────
function escolherLocal(local) {
  if (!local.selecionavel) return

  // Tocar de novo no local já escolhido abre/fecha os ambientes dele, em vez de
  // não fazer nada.
  if (local.id === props.localId && props.comAmbiente && local.comodos.length) {
    if (locaisAbertos.has(local.id)) locaisAbertos.delete(local.id)
    else locaisAbertos.add(local.id)
    return
  }

  emit('update:localId', local.id)
  // Ambiente do local ANTERIOR não pode sobreviver à troca de local: ficaria um
  // comodo_id que não pertence ao local_id gravado.
  if (props.comodoId) emit('update:comodoId', '')
  if (props.comAmbiente) locaisAbertos.add(local.id)
  recado.value = ''
}

function escolherAmbiente(local, ambiente) {
  if (!local.selecionavel) return
  if (props.localId !== local.id) emit('update:localId', local.id)
  emit('update:comodoId', ambiente.id === props.comodoId ? '' : ambiente.id)
  recado.value = ''
}

function limparEscolha() {
  emit('update:localId', '')
  if (props.comodoId) emit('update:comodoId', '')
}

// ── O "+" em cada nível ─────────────────────────────────────────────────────
// Mesma ideia do Patrimônio: sem o "+", quem só edita a ficha TRAVA quando a
// opção que precisa ainda não está cadastrada — e o jeito de destravar era
// digitar texto livre, que é o defeito que este componente veio matar.
const novoNivel = ref('')          // '' | 'marca' | 'local' | 'ambiente'
const novoPai = ref({ id: null })  // a marca (pra 'local') ou o local (pra 'ambiente')
const novoNome = ref('')
const campoNovo = ref(null)
const recado = ref('')
// O nome que foi mandado criar e ainda não voltou nas props.
const esperando = ref(null)

async function abrirNovo(nivel, pai) {
  novoNivel.value = nivel
  novoPai.value = pai || { id: null }
  novoNome.value = ''
  recado.value = ''
  esperando.value = null
  await nextTick()
  const campo = Array.isArray(campoNovo.value) ? campoNovo.value[0] : campoNovo.value
  if (campo && campo.focus) campo.focus()
}

function cancelarNovo() {
  novoNivel.value = ''
  novoPai.value = { id: null }
  novoNome.value = ''
  esperando.value = null
}

// Os irmãos do que está sendo criado — é dentro DESTE escopo que "já existe" faz
// sentido. Duas "Fábrica Conchal" em marcas diferentes são legítimas; duas
// dentro da MESMA marca é que seriam repetição.
function irmaosDoNovo() {
  if (novoNivel.value === 'marca') return props.empresas || []
  if (novoNivel.value === 'local') return (props.locais || []).filter((l) => l.empresa_id === novoPai.value.id)
  return (props.comodos || []).filter((c) => c.local_id === novoPai.value.id)
}

function confirmarNovo() {
  const r = resolverNovaOpcao(novoNome.value, irmaosDoNovo())
  if (!r.ok) { recado.value = r.mensagem; return }

  if (r.jaExistia) {
    // Não cria de novo: aponta pro que já está lá. Vale principalmente pro caso
    // de duas pessoas cadastrando a mesma coisa ao mesmo tempo.
    aplicarCriado(r.item)
    recado.value = `“${r.item.nome}” já existia — deixei essa selecionada.`
    cancelarNovo()
    return
  }

  esperando.value = { nivel: novoNivel.value, chave: normalizarNome(r.nome), paiId: novoPai.value.id }
  emit('criar', {
    nivel: novoNivel.value,
    nome: r.nome,
    empresaId: novoNivel.value === 'local' ? novoPai.value.id : null,
    localId: novoNivel.value === 'ambiente' ? novoPai.value.id : null,
  })
}

// Já criado (ou já existente): aponta a escolha pra ele quando for local ou
// ambiente. Marca nova não vira escolha — não é ela que se guarda na ficha.
function aplicarCriado(item) {
  if (!item) return
  if (novoNivel.value === 'local' || esperando.value?.nivel === 'local') {
    emit('update:localId', item.id)
    if (props.comodoId) emit('update:comodoId', '')
  } else if (novoNivel.value === 'ambiente' || esperando.value?.nivel === 'ambiente') {
    if (props.localId !== novoPai.value.id && novoPai.value.id) emit('update:localId', novoPai.value.id)
    emit('update:comodoId', item.id)
  }
}

// A caixinha do "+" fecha quando o nome novo APARECE NAS PROPS — ou seja,
// quando o pai gravou e recarregou de verdade. Se a gravação falhar, ela fica
// aberta com o que foi digitado, em vez de sumir fingindo que criou.
watch(() => [props.empresas, props.locais, props.comodos], () => {
  const alvo = esperando.value
  if (!alvo) return

  const lista = alvo.nivel === 'marca' ? props.empresas
    : alvo.nivel === 'local' ? (props.locais || []).filter((l) => l.empresa_id === alvo.paiId)
      : (props.comodos || []).filter((c) => c.local_id === alvo.paiId)

  const achado = (lista || []).find((item) => normalizarNome(item?.nome) === alvo.chave)
  if (!achado) return

  aplicarCriado(achado)
  recado.value = `“${achado.nome}” criado.`
  cancelarNovo()
})

// Trocar de ficha (outro carro, outro bem) tem de zerar o filtro e a caixinha:
// deixar aberta uma pergunta que já foi respondida é o mesmo defeito que o
// Patrimônio corrigiu no `fecharFicha`.
watch(() => props.localId, () => { if (novoNivel.value && !esperando.value) cancelarNovo() })
</script>

<style scoped>
/* Nomes prefixados com esc-local- de propósito: o estilos-globais.css tem
   classes genéricas (.card, .chip) e já houve colisão entre global e scoped
   neste projeto.

   Toda cor sai de token — este componente vive em modal e em página, no tema
   claro e no escuro, e hex cravado já deixou bloco branco no tema escuro em
   produção.

   A medida é por CONTAINER e não por viewport: a mesma peça aparece numa ficha
   estreita dentro de modal e numa coluna larga de página, e é a largura DELA
   que decide o desenho, não a do aparelho. */
.esc-local{
  container-type:inline-size;
  display:flex; flex-direction:column; gap:var(--sp-2);
  font-family:var(--fonte-principal); color:var(--text);
  min-width:0;
}

/* ── o que está valendo ──────────────────────────────────────────────────── */
.esc-local-atual{
  display:flex; align-items:center; gap:var(--sp-2);
  padding:var(--sp-2) var(--sp-3);
  border:1px solid var(--border); border-radius:var(--radius-lg);
  background:var(--surface2);
}
.esc-local-atual-escolhido{
  border-color:color-mix(in srgb, var(--accent) 40%, var(--surface));
  background:var(--accent-light);
}
.esc-local-atual-txt{ flex:1; min-width:0; display:flex; flex-direction:column; gap:2px; }
.esc-local-etiqueta{
  font-size:max(9px, calc(10px * var(--escala-texto, 1))); text-transform:uppercase; letter-spacing:1.5px; color:var(--muted);
}
/* Texto NUNCA corta: o dono não distingue dois locais que viram "Fábrica C…". */
.esc-local-caminho{ font-size:max(9px, calc(14px * var(--escala-texto, 1))); line-height:1.35; overflow-wrap:anywhere; }
.esc-local-caminho-fraco{ color:var(--muted); font-weight:400; }
.esc-local-acao{ flex-shrink:0; }

/* ── avisos ──────────────────────────────────────────────────────────────── */
/* Fundo colorido suave misturando o token com a superfície, pros dois temas
   virem de graça; o TEXTO usa --text porque --orange sobre este fundo dá 4,14
   de contraste, abaixo do mínimo de 4,5. */
.esc-local-aviso{
  display:flex; flex-direction:column; gap:var(--sp-2);
  padding:var(--sp-3);
  border:1px solid color-mix(in srgb, var(--orange) 38%, var(--surface));
  border-radius:var(--radius-lg);
  background:color-mix(in srgb, var(--orange) 10%, var(--surface));
  color:var(--text);
}
.esc-local-aviso-txt{ margin:0; font-size:max(9px, calc(13px * var(--escala-texto, 1))); line-height:1.6; overflow-wrap:anywhere; }
.esc-local-sugestoes{ display:flex; flex-direction:column; gap:var(--sp-1); }
.esc-local-sugestoes-titulo{ font-size:max(9px, calc(12px * var(--escala-texto, 1))); color:var(--muted); }
.esc-local-sugestao{
  min-height:40px; padding:var(--sp-2) var(--sp-3); text-align:left;
  border:1px solid var(--border); border-radius:var(--radius-md);
  background:var(--surface); color:var(--text);
  font-family:inherit; font-size:max(9px, calc(13px * var(--escala-texto, 1))); line-height:1.4;
  cursor:pointer; overflow-wrap:anywhere; touch-action:manipulation;
}
.esc-local-sugestao:hover{ border-color:var(--accent); }
.esc-local-nota{
  margin:0; padding:var(--sp-2) var(--sp-3);
  font-size:max(9px, calc(12px * var(--escala-texto, 1))); line-height:1.6; color:var(--muted);
  background:var(--surface2); border-radius:var(--radius-md);
  overflow-wrap:anywhere;
}

/* ── busca ───────────────────────────────────────────────────────────────── */
.esc-local-busca{ display:flex; gap:var(--sp-2); align-items:stretch; }
/* 16px não é estética: abaixo disso o iOS dá zoom ao focar e a tela salta. */
.esc-local-busca-campo{
  flex:1; min-width:0; min-height:44px;
  padding:0 var(--sp-3);
  font-family:inherit; font-size:max(16px, calc(16px * var(--escala-texto, 1))); color:var(--text);
  background:var(--surface); border:1px solid var(--border); border-radius:var(--radius-md);
}
.esc-local-busca-campo:focus{ outline:2px solid var(--accent); outline-offset:-1px; }

/* O "+" segue o do Patrimônio (borda, fundo de superfície, sinal na cor de
   ação) — um jeito só de cadastrar o que falta em toda a Central. Aqui ele
   ganha 44px de alvo porque vive numa lista, onde o dedo erra mais. */
.esc-local-mais{
  flex-shrink:0; width:44px; min-height:44px;
  border:1px solid var(--border); border-radius:var(--radius-md);
  background:var(--surface); color:var(--accent);
  font-family:inherit; font-size:max(16px, calc(20px * var(--escala-texto, 1))); line-height:1;
  cursor:pointer; touch-action:manipulation;
}
.esc-local-mais:hover:not(:disabled){ border-color:var(--accent); }
.esc-local-mais:disabled{ opacity:.4; cursor:not-allowed; }

.esc-local-novo{ display:flex; flex-wrap:wrap; gap:var(--sp-2); align-items:stretch; }
.esc-local-novo-fundo{ padding:var(--sp-2); background:var(--surface2); border-radius:var(--radius-md); }
.esc-local-novo-campo{
  flex:1 1 180px; min-width:0; min-height:44px;
  padding:0 var(--sp-3);
  font-family:inherit; font-size:max(16px, calc(16px * var(--escala-texto, 1))); color:var(--text);
  background:var(--surface); border:1px solid var(--accent-mid); border-radius:var(--radius-md);
}
.esc-local-novo-campo:focus{ outline:2px solid var(--accent); outline-offset:-1px; }

/* ── a árvore ────────────────────────────────────────────────────────────── */
.esc-local-arvore{
  border:1px solid var(--border); border-radius:var(--radius-lg);
  background:var(--surface);
  /* Rola DENTRO da caixa: a lista inteira empurrando a ficha faria o botão de
     salvar fugir da tela no celular. 18 locais e 55 ambientes cabem sem
     paginação nenhuma. */
  max-height:min(46dvh, 400px); overflow-y:auto; overscroll-behavior:contain;
  padding:var(--sp-1);
}
/* Coluna, e não bloco solto: sem isto cada ambiente vira um botão do tamanho do
   próprio texto, e o realce do que está escolhido aparece como uma etiqueta
   torta no meio da lista em vez de uma linha. */
.esc-local-filhos{ display:flex; flex-direction:column; padding-left:var(--sp-3); }
.esc-local-linha{ display:flex; gap:var(--sp-1); align-items:stretch; }
.esc-local-linha-marca{ margin-top:2px; }

/* Linha da árvore é linha, não botão de ação — por isso não usa .btn (que é
   pra ação, e tem uma por bloco). O alvo continua com 44px. */
.esc-local-no{
  flex:1; min-width:0;
  display:flex; align-items:center; gap:var(--sp-2);
  min-height:44px; padding:var(--sp-1) var(--sp-2);
  text-align:left; font-family:inherit; font-size:max(9px, calc(14px * var(--escala-texto, 1))); color:var(--text);
  background:transparent; border:1px solid transparent; border-radius:var(--radius-md);
  cursor:pointer; touch-action:manipulation;
}
/* O `:not(.esc-local-no-marcado)` não é preciosismo: `.esc-local-no:hover` tem
   especificidade maior que `.esc-local-no-marcado`, então o cinza do passar-o-
   mouse apagava o realce do que está escolhido — justo quando o ponteiro está
   em cima e a pessoa quer conferir se acertou. */
.esc-local-no:hover:not(:disabled):not(.esc-local-no-marcado){ background:var(--surface2); }
.esc-local-no:focus-visible{ outline:2px solid var(--accent); outline-offset:-2px; }
.esc-local-no-marca{ font-weight:600; text-transform:uppercase; letter-spacing:1px; font-size:max(9px, calc(11px * var(--escala-texto, 1))); color:var(--muted); }
.esc-local-no-ambiente{ font-size:max(9px, calc(13px * var(--escala-texto, 1))); }
.esc-local-no-marcado{
  background:var(--accent-light);
  border-color:color-mix(in srgb, var(--accent) 45%, var(--surface));
  font-weight:600;
}
.esc-local-no-travado{ opacity:.55; cursor:not-allowed; }

/* Tamanho próprio, e não o da linha: no cabeçalho da marca a linha é 11px, e a
   seta some virando um ponto — o que esconde que o grupo abre e fecha. */
.esc-local-seta{ flex-shrink:0; width:16px; font-size:max(9px, calc(13px * var(--escala-texto, 1))); line-height:1; color:var(--muted); }
/* Nome quebra em duas linhas em vez de virar reticências. */
.esc-local-nome{ flex:1; min-width:0; overflow-wrap:anywhere; line-height:1.35; }

/* A MARCA DO LOCAL, sempre. Não é enfeite: sem ela, "Fábrica Conchal" aparece
   duas vezes (Vessel e RB Builders) sem meio de saber qual é qual — e o mesmo
   vale para "Sede Limeira".

   Ela vai INLINE, não em segunda linha: em bloco, cada um dos 18 locais virava
   duas linhas e a lista dobrava de altura repetindo "Vessel" oito vezes debaixo
   do cabeçalho que já diz VESSEL. Inline, ela é legenda — só desce de linha
   quando o nome é comprido de verdade. */
.esc-local-marca-do-local{
  font-size:max(9px, calc(11px * var(--escala-texto, 1))); line-height:1.3; color:var(--muted); font-weight:400;
  white-space:nowrap;
}
.esc-local-marca-do-local::before{ content:' · '; }
.esc-local-selo{
  flex-shrink:0; padding:2px 7px; border-radius:999px;
  font-size:max(9px, calc(10px * var(--escala-texto, 1))); line-height:1.5; white-space:nowrap;
  color:var(--text);
  background:color-mix(in srgb, var(--orange) 16%, var(--surface));
  border:1px solid color-mix(in srgb, var(--orange) 38%, var(--surface));
}
.esc-local-conta{
  flex-shrink:0; min-width:22px; text-align:center;
  padding:1px 6px; border-radius:999px;
  font-family:var(--fonte-dados); font-size:max(9px, calc(11px * var(--escala-texto, 1)));
  color:var(--muted); background:var(--surface2);
}
.esc-local-vazio{
  margin:0; padding:var(--sp-3);
  font-size:max(9px, calc(13px * var(--escala-texto, 1))); line-height:1.6; color:var(--muted); overflow-wrap:anywhere;
}

/* Container estreito (ficha dentro de modal no celular): o selo de nome
   repetido some da linha e vira só o texto da marca embaixo do nome, pra a
   linha não estourar a largura. O estouro seria cortado em silêncio — o
   estilos-globais.css tem overflow-x:clip. */
@container (max-width:380px){
  .esc-local-selo{ display:none; }
  .esc-local-atual{ flex-wrap:wrap; }
  .esc-local-acao{ width:100%; }
  .esc-local-filhos{ padding-left:var(--sp-2); }
}
</style>
