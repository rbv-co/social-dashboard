<template>
  <div class="esc-pessoa">
    <div class="esc-pessoa-linha">
      <select class="esc-pessoa-campo" :value="modelValue"
              :aria-label="rotulo" @change="$emit('update:modelValue', $event.target.value)">
        <option value="">{{ textoVazio }}</option>
        <!-- ANTES dos nomes: a opção que não é uma pessoa e precisa ficar ao
             alcance da vista, como o "Tirar o dono (ninguém)" da mudança em
             massa do Patrimônio. Com um `<slot />` só, ela caía depois dos ~24
             nomes — a pessoa tinha de rolar a lista inteira para achar o que
             antes era o segundo item. -->
        <slot name="antes" />
        <option v-for="p in pessoas" :key="p.id" :value="p.id">{{ p.nome }}</option>
        <!-- A Frota põe aqui a opção "de fora da empresa": quem não é da casa
             continua tendo por onde entrar, sem virar cadastro. -->
        <slot />
      </select>
      <button v-if="podeCriar" type="button" class="esc-pessoa-mais"
              :title="'Cadastrar um colaborador novo'" aria-label="Cadastrar um colaborador novo"
              @click="abrirCaixinha">+</button>
    </div>

    <!-- ESTE aviso vive FORA da caixinha de propósito, e o caso que ele atende é
         o do nome repetido: a caixinha fecha e a escolha do campo muda sozinha,
         e é ele quem explica por quê. Dentro da caixinha ele nunca chegava a
         aparecer — o Vue tira a caixinha e o parágrafo no MESMO passo de
         renderização — e a pessoa via a escolha trocar sem explicação nenhuma.
         Aqui fora ele fica colado no campo que mudou, que é onde o olho está
         depois do clique (mesma regra do painel-peca.vue), e o `aria-live`
         anuncia pra quem usa leitor de tela: necessário aqui porque o botão que
         estava com o foco sumiu junto com a caixinha.
         Os recados de quem está com a caixinha ABERTA continuam DENTRO dela,
         colados nos botões que os provocam — é o parágrafo gêmeo lá embaixo.
         Os dois nunca aparecem juntos: um exige a caixinha fechada, o outro só
         existe enquanto ela está aberta. -->
    <p v-if="avisoDeFora" class="esc-pessoa-recado esc-pessoa-recado-fora"
       role="status" aria-live="polite">{{ avisoDeFora }}</p>

    <!-- A caixinha nasce e morre aqui: some ao criar, ao cancelar e ao trocar de
         ficha, pra nunca ficar aberta numa pergunta que já foi respondida. -->
    <div v-if="aberta" class="esc-pessoa-caixa">
      <p class="esc-pessoa-titulo">Cadastrar quem ainda não está na lista</p>

      <label class="esc-pessoa-rotulo">
        Nome completo
        <input v-model="novo.nome" ref="campoNome" type="text" class="esc-pessoa-entrada"
               placeholder="Ex.: Maria Souza"
               @keyup.enter="confirmar" @keyup.esc.stop="cancelar">
      </label>

      <label class="esc-pessoa-rotulo">
        Cargo <em class="esc-pessoa-opcional">(opcional)</em>
        <input v-model="novo.cargo" type="text" class="esc-pessoa-entrada"
               :list="idDaListaDeCargos" placeholder="Ex.: Modelista"
               @keyup.enter="confirmar" @keyup.esc.stop="cancelar">
      </label>
      <!-- Sugestão, não trava: digitar um cargo que não existe continua valendo. -->
      <datalist :id="idDaListaDeCargos">
        <option v-for="c in cargos" :key="c" :value="c"></option>
      </datalist>

      <label class="esc-pessoa-rotulo">
        Marca <em class="esc-pessoa-opcional">(opcional)</em>
        <span class="esc-pessoa-linha">
          <select v-model="novo.marcaId" class="esc-pessoa-campo">
            <option value="">—</option>
            <option v-for="m in marcas" :key="m.id" :value="m.id">{{ m.nome }}</option>
          </select>
          <button type="button" class="esc-pessoa-mais" title="Cadastrar uma marca nova"
                  aria-label="Cadastrar uma marca nova" @click="abrirSub('marca')">+</button>
        </span>
      </label>

      <label class="esc-pessoa-rotulo">
        Setor <em class="esc-pessoa-opcional">(opcional)</em>
        <span class="esc-pessoa-linha">
          <select v-model="novo.setorId" class="esc-pessoa-campo">
            <option value="">—</option>
            <option v-for="s in setores" :key="s.id" :value="s.id">{{ s.nome }}</option>
          </select>
          <button type="button" class="esc-pessoa-mais" title="Cadastrar um setor novo"
                  aria-label="Cadastrar um setor novo" @click="abrirSub('setor')">+</button>
        </span>
      </label>

      <!-- A caixinha de dentro: criar a marca ou o setor que falta, sem fechar a
           de fora e sem perder o nome já digitado. -->
      <div v-if="sub" class="esc-pessoa-sub">
        <input v-model="subNome" ref="campoSub" type="text" class="esc-pessoa-entrada"
               :placeholder="sub === 'marca' ? 'Nome da marca nova…' : 'Nome do setor novo…'"
               @keyup.enter.stop="confirmarSub" @keyup.esc.stop="cancelarSub">
        <div class="esc-pessoa-botoes">
          <button type="button" class="btn btn-principal" :disabled="criando" @click="confirmarSub">
            {{ criando ? 'Criando…' : 'Criar' }}
          </button>
          <button type="button" class="btn" @click="cancelarSub">Cancelar</button>
        </div>
      </div>

      <p v-if="recado" class="esc-pessoa-recado">{{ recado }}</p>
      <p v-if="recadoDeErro" class="esc-pessoa-recado esc-pessoa-recado-erro">{{ recadoDeErro }}</p>

      <!-- Já existe alguém parecido. Só aparece quando há o que dizer, e nunca
           tranca: uma das saídas é seguir e criar assim mesmo. -->
      <div v-if="sugestoes.length" class="esc-pessoa-recado esc-pessoa-recado-erro esc-pessoa-parecido">
        <p class="esc-pessoa-parecido-frase">{{ fraseDoParecido(sugestoes) }}</p>
        <div class="esc-pessoa-botoes">
          <!-- Principal só quando há UM candidato: com dois, nenhum é "a" ação
               que a tela quer, e duas principais competindo é o mesmo que
               nenhuma (PADRAO-DA-CENTRAL, item 7). -->
          <button v-for="s in sugestoes" :key="s.pessoa.id" type="button"
                  :class="sugestoes.length === 1 ? 'btn btn-principal' : 'btn'"
                  @click="usarSugestao(s.pessoa)">
            É {{ s.pessoa.nome }}
          </button>
        </div>
      </div>

      <div class="esc-pessoa-botoes">
        <button v-if="sugestoes.length" type="button" class="btn" :disabled="criando" @click="criarMesmoAssim">
          {{ criando ? 'Criando…' : 'Não, criar mesmo assim' }}
        </button>
        <button v-else type="button" class="btn btn-principal" :disabled="criando" @click="confirmar">
          {{ criando ? 'Criando…' : 'Criar e usar' }}
        </button>
        <button type="button" class="btn" @click="cancelar">Cancelar</button>
      </div>

      <p class="esc-pessoa-nota">
        Isto cria só a ficha da pessoa, para o bem ou o carro sair no nome certo. E-mail,
        telefone e acesso ao aplicativo continuam sendo cadastrados em Colaboradores e Acessos.
      </p>
    </div>
  </div>
</template>

<script setup>
/* ESCOLHER A PESSOA — E CADASTRAR NA HORA A QUE FALTAR.
 *
 * Pedido do dono em 13/08/2026: "quando vou cadastrar um patrimônio ou veículo
 * em um colaborador não cadastrado, quero que permita eu cadastrar de forma
 * rápida ali na hora só para sair no nome da pessoa correta" — e, logo depois,
 * "campos como marca, setor, cargo, também com possibilidade de adicionar novos".
 *
 * É a regra do "+" (que já vale para marca, local, ambiente e tipo desde
 * 07/08/2026) chegando ao campo de pessoa. A exceção escrita naquela época
 * ("pessoa vem de outro cadastro, criar gente aqui seria errado") foi derrubada
 * pelo dono depois de ver que ela trava quem está cadastrando.
 *
 * MESMO CONTRATO do escolha-de-local-e-ambiente.vue, de propósito: o componente
 * NÃO toca no banco. Ele avisa "criar isto" e espera o nome aparecer nas props.
 * Quem sabe de tabela e de permissão é a tela. Se a gravação falhar, a caixinha
 * fica aberta com o que foi digitado, em vez de sumir fingindo que criou. */
import { ref, reactive, computed, watch, nextTick, getCurrentInstance } from 'vue'
import { resolverNovaOpcao, normalizarNome } from './nova-opcao.js'
import { cargosConhecidos, dadosDaPessoaRapida } from './pessoas-para-escolher.js'
// A desconfiança de nome repetido. O `resolverNovaOpcao` acima já pega o nome
// IDÊNTICO (apara e minúsculas); este pega o que escapa dele — acento, espaço
// duplo, ordem trocada e uma letra errada. Foi por uma dessas frestas que o
// Douglas Pereira ganhou duas fichas.
import { parecidos, fraseDoParecido } from './ja-existe-alguem-parecido.js'

const props = defineProps({
  modelValue: { type: String, default: '' },
  // Já vem pronta da tela: mesclada e só com as ativas.
  pessoas: { type: Array, default: () => [] },   // { id, nome, status, cargo }
  // A lista COMPLETA, incluindo quem foi desligada. Serve só para conferir nome
  // repetido: o banco procura em todo mundo, então sem isto a tela deixa a
  // pessoa tentar criar um nome que o banco vai recusar como já existente — e
  // ela fica clicando "Criar" para sempre, sem nada acontecer.
  //
  // OBRIGATÓRIA de propósito (13/08/2026): com `default: () => []`, uma tela
  // nova que esquecesse de passar `todas` caía de volta EXATAMENTE nesse beco
  // sem saída — nome de gente desligada parece inédito, o banco recusa como
  // repetida, "Criar" não faz nada, para sempre, sem mensagem. `required`
  // faz o Vue reclamar alto no console em desenvolvimento quando faltar, em
  // vez de deixar a tela nascer muda sobre o próprio defeito.
  todas: { type: Array, required: true },        // { id, nome, status, cargo }
  marcas: { type: Array, default: () => [] },    // { id, nome }
  setores: { type: Array, default: () => [] },   // { id, nome }

  // Quem não pode cadastrar não vê o "+", mas continua escolhendo da lista.
  podeCriar: { type: Boolean, default: false },
  // A tela avisa que está gravando, pro botão dizer "Criando…" e não aceitar
  // dois toques.
  criando: { type: Boolean, default: false },
  // O erro da gravação, em português, vindo da tela.
  recadoDeErro: { type: String, default: '' },
  // Recado do PAI sobre a criação (ex.: "«Fulano» já estava cadastrada — deixei
  // essa selecionada."), pra mostrar no parágrafo de FORA da caixinha (junto do
  // aviso próprio do componente). Existe porque a tela só sabe como a gravação
  // terminou DEPOIS de recarregar a lista — e a essa altura a caixinha já
  // fechou sozinha (o watch de `pessoas` abaixo detecta o nome novo e chama
  // `cancelar()`), então um recado escrito dentro dela nunca chegaria a
  // aparecer. Ver item D do fix de 13/08/2026: a Frota escrevia esse recado e
  // ele nunca era visto, porque o parágrafo que o mostraria vivia dentro da
  // caixinha já fechada.
  aviso: { type: String, default: '' },

  rotulo: { type: String, default: 'Pessoa' },
  textoVazio: { type: String, default: '— ninguém —' },
})

const emit = defineEmits(['update:modelValue', 'criar', 'criar-setor', 'criar-marca', 'abrir'])

// Um id por instância: há mais de um campo de pessoa na mesma tela, e datalist
// com id repetido faz a sugestão de um campo aparecer no outro. O uid da
// instância do Vue já é único; um contador em `<script setup>` NÃO serve,
// porque esse bloco roda de novo a cada instância e sempre daria 1.
const idDaListaDeCargos = `esc-pessoa-cargos-${getCurrentInstance()?.uid ?? 0}`

const cargos = computed(() => cargosConhecidos(props.pessoas))

const aberta = ref(false)
const novo = reactive({ nome: '', cargo: '', marcaId: '', setorId: '' })
const recado = ref('')
const campoNome = ref(null)
// O nome que foi mandado criar e ainda não voltou nas props.
const esperando = ref(null)

// Quem se parece com o nome digitado. Vazio = nada a dizer, e aí o aviso não
// aparece: aviso que aparece sempre vira paisagem.
const sugestoes = ref([])
// O nome para o qual quem cadastra JÁ disse "criar mesmo assim". Guardo o nome,
// e não um booleano, porque trocar o texto do campo tem de fazer a pergunta de
// novo — com booleano, liberar "Douglas Pereyra" liberaria calado o "Douglas
// Pereira" digitado logo depois.
const parecidosLiberadosPara = ref('')

// A escolha que o aviso de fora explica: o id que ESTE componente selecionou
// sozinho ao topar com um nome já cadastrado. Guardar o ID (e não um "mostre o
// aviso") é o que impede o aviso de acompanhar a pessoa pra outro lugar — no
// instante em que a escolha deixa de ser esta (outro nome no campo, outra
// ficha), a conta abaixo dá falso e o aviso sai sozinho, sem depender de ordem
// de execução nenhuma.
const idQueOAvisoExplica = ref('')

// O aviso de fora só existe com a caixinha FECHADA — com ela aberta quem mostra
// o recado é o parágrafo de dentro — e só enquanto a escolha for a que ele
// explica. Dois avisos podem disputar este parágrafo (o próprio, de nome
// repetido resolvido aqui mesmo; e o do pai, prop `aviso`, sobre uma criação
// que só ele sabe como terminou) — nunca um terceiro lugar de mensagem: quando
// os dois têm algo a dizer, o do componente ganha, porque é sobre o que a
// pessoa acabou de digitar agora.
const avisoDeFora = computed(() => {
  if (aberta.value) return ''
  const aindaEhAEscolhaQueEuFiz = !!idQueOAvisoExplica.value
    && props.modelValue === idQueOAvisoExplica.value
  if (aindaEhAEscolhaQueEuFiz) return recado.value
  return props.aviso
})

async function abrirCaixinha() {
  aberta.value = true
  novo.nome = ''
  novo.cargo = ''
  novo.marcaId = ''
  novo.setorId = ''
  recado.value = ''
  idQueOAvisoExplica.value = ''
  esperando.value = null
  // Abrir também começa limpo: uma caixinha que nasce carregando uma criação
  // pendente de OUTRA ficha é o mesmo defeito do outro lado — ela ia aparecer
  // (e gravar sozinha) na ficha errada quando a marca/setor antiga voltasse.
  sub.value = ''
  subNome.value = ''
  esperandoSub.value = null
  await nextTick()
  if (campoNome.value && campoNome.value.focus) campoNome.value.focus()
  // Avisa o pai que a caixinha abriu. É o momento — e o único — em que faz
  // sentido apagar o recado de erro que ele guarda: o erro é de uma tentativa
  // anterior, e o componente não pode limpar uma prop sozinho. Sem isto, uma
  // criação que falhou deixa o aviso colado na próxima abertura, inclusive em
  // outra ficha.
  emit('abrir')
}

// INVARIANTE: fechar a caixinha — por qualquer caminho — significa não deixar
// NADA pendente. `cancelar()` é o único lugar que fecha de verdade; todo
// outro ponto do componente que precisa fechar (cancelar, trocar de ficha, a
// pessoa nova ter aparecido nas props) chama esta função, nunca mexe direto
// em `aberta`. Se abrir uma exceção aqui — zerar só `aberta` sem passar por
// `cancelar()` — uma criação de marca/setor (ou de pessoa) que ainda não
// voltou fica viva e, quando voltar, grava na ficha ERRADA: a que estiver
// aberta na hora, não a que pediu. Já aconteceu duas vezes (rodadas 2 e 3
// desta tarefa) por fechar a caixinha "na mão" em vez de por aqui.
function cancelar() {
  aberta.value = false
  sub.value = ''
  subNome.value = ''
  recado.value = ''
  esperando.value = null
  esperandoSub.value = null
  idQueOAvisoExplica.value = ''
  sugestoes.value = []
  parecidosLiberadosPara.value = ''
}

// Mexeu no nome, a pergunta é outra: o aviso antigo sai e a liberação some
// junto. Sem isto, o aviso ficaria na tela falando de um nome que não está mais
// escrito — e "criar mesmo assim" valeria para um texto que ninguém aprovou.
watch(() => novo.nome, () => {
  if (sugestoes.value.length) sugestoes.value = []
  if (parecidosLiberadosPara.value && parecidosLiberadosPara.value !== String(novo.nome || '').trim()) {
    parecidosLiberadosPara.value = ''
  }
})

function confirmar() {
  // Mesma trava do botão: o Enter no campo de nome não pode ser um jeito de
  // burlar o "Criando…" e disparar duas gravações.
  if (props.criando) return
  const dados = dadosDaPessoaRapida({
    nome: novo.nome, cargo: novo.cargo, marcaId: novo.marcaId, setorId: novo.setorId,
  })
  if (!dados.ok) { recado.value = dados.mensagem; return }

  // Nome repetido não cria a segunda pessoa: aponta pra que já está lá. O banco
  // faz a mesma checagem — aqui é só pra pessoa saber na hora, sem ida e volta.
  //
  // A conferência é contra `todas` — a lista COMPLETA — e não contra o que o
  // campo mostra, porque é em todo mundo que o banco procura. Contra as ativas
  // só, o nome de quem foi DESLIGADA passava por inédito, a tela mandava criar,
  // o banco respondia "já existia" sem gravar nada, e a pessoa desligada nunca
  // aparecia na lista das ativas pro componente fechar a caixinha: ela ficava
  // aberta, com o nome digitado, sem nada selecionado e SEM recado nenhum.
  // Clicar de novo repetia isso pra sempre — o mesmo beco sem saída que este
  // "+" existe pra acabar. Sem `todas` (chamador antigo), cai nas ativas e o
  // componente continua funcionando como antes.
  const universo = (props.todas && props.todas.length) ? props.todas : props.pessoas
  const r = resolverNovaOpcao(novo.nome, universo)
  if (r.ok && r.jaExistia && !(props.pessoas || []).some((p) => p && p.id === r.item.id)) {
    // Ela existe, mas não está entre as que o campo oferece: saiu da empresa.
    // Não dá pra selecionar (não está lá) e não adianta mandar criar (o banco
    // recusa como repetida). Dizer isso é o único caminho honesto — e o que foi
    // digitado fica na tela pra ser corrigido.
    recado.value = `“${r.item.nome}” já está cadastrada, mas está marcada como desligada. `
      + 'Peça a quem administra para reativá-la — ou use outro nome.'
    return
  }
  if (r.ok && r.jaExistia) {
    emit('update:modelValue', r.item.id)
    // Fecha pelo `cancelar()` — não zera `aberta` na mão — porque este também
    // é um caminho de fechar: se houvesse uma criação de marca/setor pendente
    // (`esperandoSub`), zerar só `aberta` deixaria ela viva pra vazar na
    // próxima ficha, o mesmo defeito do resto deste arquivo.
    cancelar()
    // As duas linhas vêm DEPOIS do `cancelar()` de propósito: é ele que limpa o
    // recado e o id, então escrever antes seria escrever no vazio. Guardar o id
    // aqui é o que mantém o aviso na tela — fora da caixinha, que acabou de
    // sumir — enquanto esta escolha valer.
    recado.value = `“${r.item.nome}” já estava cadastrada — deixei essa selecionada.`
    idQueOAvisoExplica.value = r.item.id
    return
  }

  // ── "JÁ EXISTE ALGUÉM PARECIDO?" (27/08/2026) ─────────────────────────────
  //
  // O `resolverNovaOpcao` acima já barrou o nome idêntico. O que sobra aqui é o
  // que ele não vê: acento, espaço duplo, ordem trocada e uma letra errada. O
  // Douglas Pereira ganhou duas fichas por uma dessas frestas.
  //
  // Compara contra `universo` — a lista COMPLETA, a mesma do teste acima — e
  // não contra o que o campo mostra: quem foi desligada continua sendo uma
  // ficha que já existe, e criar outra para a mesma pessoa perde o histórico.
  //
  // NÃO TRAVA. Homônimo de verdade existe (a base tem duas Clara e dois
  // Gabriel), e barrar o cadastro deixaria quem cadastra sem saída.
  const parecidas = parecidos(dados.dados.p_nome, universo)
  if (parecidas.length && parecidosLiberadosPara.value !== dados.dados.p_nome) {
    sugestoes.value = parecidas
    return
  }

  esperando.value = normalizarNome(dados.dados.p_nome)
  emit('criar', {
    nome: dados.dados.p_nome, cargo: dados.dados.p_cargo,
    marcaId: dados.dados.p_marca_id, setorId: dados.dados.p_setor_id,
  })
}

// "É essa pessoa" — usa a que já existe em vez de criar a segunda. É o clique
// que faltou em 21/08.
function usarSugestao(pessoa) {
  emit('update:modelValue', pessoa.id)
  // Fecha pelo `cancelar()`, como o caminho do nome idêntico logo acima: ele é
  // quem limpa a criação de marca/setor que possa estar pendente.
  cancelar()
  recado.value = `“${pessoa.nome}” já estava cadastrada — deixei essa selecionada.`
  idQueOAvisoExplica.value = pessoa.id
}

// "Não, criar mesmo assim" — libera SÓ o nome que está no campo agora, e
// refaz o caminho inteiro, para não duplicar aqui as validações do `confirmar`.
function criarMesmoAssim() {
  parecidosLiberadosPara.value = String(novo.nome || '').trim()
  sugestoes.value = []
  confirmar()
}

// A caixinha fecha quando a pessoa nova APARECE NAS PROPS — ou seja, quando a
// tela gravou e recarregou de verdade.
watch(() => props.pessoas, () => {
  if (!esperando.value) return
  const achada = (props.pessoas || []).find((p) => normalizarNome(p?.nome) === esperando.value)
  if (!achada) return
  // O emit vem ANTES do fechar: a tela precisa do id primeiro. O
  // `watch(() => props.modelValue, …)` que este emit dispara acha `aberta`
  // já falsa (fechada abaixo) e não faz nada — a ordem importa.
  emit('update:modelValue', achada.id)
  cancelar()
})

// ── O "+" de dentro: marca e setor ──────────────────────────────────────────
const sub = ref('')          // '' | 'marca' | 'setor'
const subNome = ref('')
const campoSub = ref(null)
const esperandoSub = ref(null)

async function abrirSub(qual) {
  sub.value = qual
  subNome.value = ''
  recado.value = ''
  esperandoSub.value = null
  await nextTick()
  if (campoSub.value && campoSub.value.focus) campoSub.value.focus()
}

function cancelarSub() {
  sub.value = ''
  subNome.value = ''
  esperandoSub.value = null
}

function confirmarSub() {
  // Mesma trava do botão: o Enter no campo da marca/setor não pode ser um
  // jeito de burlar o "Criando…" e disparar duas gravações.
  if (props.criando) return
  const lista = sub.value === 'marca' ? props.marcas : props.setores
  const r = resolverNovaOpcao(subNome.value, lista)
  if (!r.ok) { recado.value = r.mensagem; return }

  if (r.jaExistia) {
    if (sub.value === 'marca') novo.marcaId = r.item.id
    else novo.setorId = r.item.id
    recado.value = `“${r.item.nome}” já existia — deixei essa selecionada.`
    cancelarSub()
    return
  }

  esperandoSub.value = { qual: sub.value, chave: normalizarNome(r.nome) }
  emit(sub.value === 'marca' ? 'criar-marca' : 'criar-setor', { nome: r.nome })
}

watch(() => [props.marcas, props.setores], () => {
  const alvo = esperandoSub.value
  if (!alvo) return
  const lista = alvo.qual === 'marca' ? props.marcas : props.setores
  const achado = (lista || []).find((x) => normalizarNome(x?.nome) === alvo.chave)
  if (!achado) return
  if (alvo.qual === 'marca') novo.marcaId = achado.id
  else novo.setorId = achado.id
  recado.value = `“${achado.nome}” criado.`
  cancelarSub()
})

// Mudar a escolha tem dois efeitos, conforme a caixinha esteja aberta ou não.
//
// ABERTA: trocar de ficha (outro bem, outro carro) tem de fechar a caixinha —
// deixar aberta uma pergunta que já foi respondida é o mesmo defeito que o
// Patrimônio corrigiu no `fecharFicha`. O `esperando` protege o caso em que a
// escolha mudou porque a pessoa ACABOU de ser criada por aqui.
//
// FECHADA: o que pode estar na tela é o aviso de fora. Ele sobrevive ao ECO do
// próprio emit que o causou (mesmo id) — qualquer OUTRA mudança é assunto novo,
// inclusive a tela abrir outra ficha, e aí o texto sai de vez. Sem apagar o
// texto aqui ele ficaria guardado e voltaria a aparecer se uma ficha seguinte
// caísse na mesma pessoa: aviso ressuscitando no registro errado.
watch(() => props.modelValue, () => {
  if (aberta.value) { if (!esperando.value) cancelar(); return }
  if (props.modelValue === idQueOAvisoExplica.value) return
  recado.value = ''
  idQueOAvisoExplica.value = ''
})
</script>

<style scoped>
/* Nomes prefixados com esc-pessoa- de propósito: o estilos-globais.css tem
   classes genéricas e já houve colisão entre global e scoped neste projeto.
   Toda cor sai de token — este componente vive em ficha dentro de modal, no
   tema claro e no escuro. */
.esc-pessoa{ display:flex; flex-direction:column; gap:var(--sp-2); min-width:0; }

.esc-pessoa-linha{ display:flex; gap:var(--sp-2); align-items:stretch; min-width:0; }

/* 16px não é estética: abaixo disso o iOS dá zoom ao focar e a tela salta. */
.esc-pessoa-campo{
  flex:1; min-width:0; min-height:44px;
  padding:0 var(--sp-3);
  font-family:inherit; font-size:max(16px, calc(16px * var(--escala-texto, 1))); color:var(--text);
  background:var(--surface); border:1px solid var(--border); border-radius:var(--radius-md);
}
.esc-pessoa-campo:focus{ outline:2px solid var(--accent); outline-offset:-1px; }

/* Mesmo "+" da escolha de local: um jeito só de cadastrar o que falta em toda a
   Central. 44px de alvo porque o dedo erra. */
.esc-pessoa-mais{
  flex-shrink:0; width:44px; min-height:44px;
  border:1px solid var(--border); border-radius:var(--radius-md);
  background:var(--surface); color:var(--accent);
  font-family:inherit; font-size:max(16px, calc(20px * var(--escala-texto, 1))); line-height:1;
  cursor:pointer; touch-action:manipulation;
}
.esc-pessoa-mais:hover:not(:disabled){ border-color:var(--accent); }
.esc-pessoa-mais:disabled{ opacity:.4; cursor:not-allowed; }

.esc-pessoa-caixa{
  display:flex; flex-direction:column; gap:var(--sp-2);
  padding:var(--sp-3);
  border:1px solid var(--accent-mid); border-radius:var(--radius-lg);
  background:var(--surface2);
}
.esc-pessoa-titulo{
  margin:0; font-size:max(9px, calc(13px * var(--escala-texto, 1))); font-weight:600;
  color:var(--text); line-height:1.4; overflow-wrap:anywhere;
}
.esc-pessoa-rotulo{
  display:flex; flex-direction:column; gap:var(--sp-1);
  font-size:max(9px, calc(12px * var(--escala-texto, 1))); color:var(--muted); line-height:1.4;
}
.esc-pessoa-opcional{ font-style:italic; }
.esc-pessoa-entrada{
  min-height:44px; padding:0 var(--sp-3); min-width:0;
  font-family:inherit; font-size:max(16px, calc(16px * var(--escala-texto, 1))); color:var(--text);
  background:var(--surface); border:1px solid var(--border); border-radius:var(--radius-md);
}
.esc-pessoa-entrada:focus{ outline:2px solid var(--accent); outline-offset:-1px; }

.esc-pessoa-sub{
  display:flex; flex-direction:column; gap:var(--sp-2);
  padding:var(--sp-2); background:var(--surface); border-radius:var(--radius-md);
}
/* Quebra de linha permitida: dois botões lado a lado não cabem em 375px com o
   texto inteiro, e texto cortado é o defeito que o padrão da casa proíbe. */
.esc-pessoa-botoes{ display:flex; flex-wrap:wrap; gap:var(--sp-2); }
.esc-pessoa-recado{
  margin:0; font-size:max(9px, calc(12px * var(--escala-texto, 1))); line-height:1.5;
  color:var(--muted); overflow-wrap:anywhere;
}
/* Fora da caixinha o recado perde a moldura que o segurava, e texto cinza solto
   embaixo de um campo não se lê como recado. Ganha o mesmo realce sutil que o
   `.esc-local-nota` do escolha-de-local-e-ambiente.vue dá ao recado dele, que
   também vive solto no componente: fundo de realce e respiro. Mesmo par de
   cores que este parágrafo já tem DENTRO da caixinha (--muted sobre
   --surface2), então o contraste não muda em nenhum dos dois temas. */
.esc-pessoa-recado-fora{
  padding:var(--sp-2) var(--sp-3);
  background:var(--surface2); border-radius:var(--radius-md);
}
/* O texto usa --text e não --orange: laranja sobre esta superfície fica em 4,14
   de contraste, abaixo do mínimo de 4,5. */
.esc-pessoa-recado-erro{
  padding:var(--sp-2); border-radius:var(--radius-md); color:var(--text);
  background:color-mix(in srgb, var(--orange) 12%, var(--surface));
  border:1px solid color-mix(in srgb, var(--orange) 38%, var(--surface));
}
.esc-pessoa-parecido{
  display:flex; flex-direction:column; gap:var(--sp-2);
}
.esc-pessoa-parecido-frase{
  /* `anywhere` e não reticências: nome comprido quebra em duas linhas. Cortar
     "Maria Eduarda C…" tira justamente o que faz distinguir duas pessoas — e
     distinguir duas pessoas é a única coisa que este aviso faz. */
  margin:0; overflow-wrap:anywhere;
}
.esc-pessoa-nota{
  margin:0; font-size:max(9px, calc(11px * var(--escala-texto, 1))); line-height:1.5;
  color:var(--muted); overflow-wrap:anywhere;
}
</style>
