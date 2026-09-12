<script setup>
/* Frota — onde está cada carro, e quem pegou.
 *
 * É a aba "Resumo Geral" da planilha, com uma diferença que muda tudo: aqui o
 * KM não é digitado. Ele sai da última devolução. Na planilha a coluna
 * "KM Atual" é preenchida à mão, e por isso a aba "Alertas" — que depende dela
 * — nasceu vazia e nunca avisou nada.
 *
 * Fase 1: cadastro, "onde está" e o ciclo de retirada/devolução. Requisição
 * com aprovação, multas e plano de revisão vêm nas fases seguintes; o desenho
 * inteiro está em docs/superpowers/specs/2026-08-04-frota-design.md. */
// `watch` faz falta de verdade: sem ele a tela inteira morre com
// "watch is not defined" ao montar, e não mostra NADA — foi o que aconteceu
// entre o commit do passeio guiado (8decfb5) e aqui. Nem o `npm test` nem o
// `npm run build` pegam isso: os dois compilam o arquivo, nenhum dos dois o
// executa num navegador.
import { ref, reactive, computed, onMounted, watch, nextTick } from 'vue'
import BarraDeTopo from '../../compartilhado/barra-de-topo.vue'
import { useRouter } from 'vue-router'
import { sbClient, SUPABASE_URL, SUPABASE_ANON_KEY } from '../../compartilhado/conectar-no-banco-de-dados.js'
import { hasPermission, estado } from '../../compartilhado/controle-de-login-e-usuario.js'
import { estadoDoVeiculo, resumoDoEstado, ordenarEstados, rotuloDoTanque, NIVEIS_TANQUE, problemasDaDevolucao, problemasDoRegistroAvulso, ultimoHodometro } from './estado-do-veiculo.js'
import { nomeDeQuemAgiu } from './nome-de-quem-agiu.js'
import { montarArvore } from '../../compartilhado/arvore-de-locais.js'
import { localCurto } from './onde-o-carro-fica.js'
import { AREAS, areasVisiveis, areaInicial, painelDoMotorista, resumoDoMotorista } from './areas-da-frota.js'
import AbaDeRelatorios from '../../compartilhado/relatorios/aba-de-relatorios.vue'
import { RELATORIOS_DA_FROTA } from './relatorios-da-frota.js'
// Mora em supabase/functions/_shared, não em src/, como checklist.js: a Edge
// Function do robô da manhã (Tarefa 12) roda em Deno e precisa da mesma regra
// de "quem está com o carro" — ela não alcança src/, só o front alcança o
// _shared.
import { passarPara, quemEstaComOCarro, quemDeveConferir, trocarDonoFixo } from '../../../supabase/functions/_shared/posse.js'
// Mesmo motivo, mesma pasta: quem loga por cada colaborador é regra que a tela
// e o robô do aviso PRECISAM responder igual. Ver quem-loga.js.
import { pessoaDoUsuario } from '../../../supabase/functions/_shared/quem-loga.js'
import {
  problemasDaRequisicao, bloqueios, podeDecidir, motivoEmPortugues,
  ordenarFila, quando, reservaParaPegar, reservaSegurando, meusPedidos,
} from './requisicoes.js'
import { revisoesDoVeiculo, resumoDeRevisoes, problemasDoItem, avisoAoDesativar, ordenarCarrosPorUrgencia } from './revisoes.js'
import { linkDoWhatsapp, telefoneLegivel, porQueNaoDaLink } from '../../compartilhado/whatsapp.js'
// Trava a rolagem do fundo enquanto um destes 6 modais estiver aberto (bronca
// do dono: "abro um modal e a tela atrás continua rolando"). `v-trava-rolagem`
// é resolvida automaticamente pelo <script setup> por causa do prefixo `v`.
import { vTravaRolagem } from '../../compartilhado/travar-rolagem-de-fundo.js'
import PainelDeChecklist from './painel-de-checklist.vue'
// O mesmo campo de desenhar do checklist, reaproveitado no aceite de retirada.
// A proporção dele (2:1) é o que faz o rabisco sair no papel do jeito que foi
// feito na tela — ver o comentário do quadro em pdf-do-checklist.js.
import CampoDeRabisco from './campo-de-rabisco.vue'
import EditorDeChecklist from './editor-de-checklist.vue'
import SanfonaDeRevisoes from './sanfona-de-revisoes.vue'
// Os botões grandes do topo das duas abas (D33): estado embaixo do nome, e
// cada um ou abre uma ficha que já existe ou rola até uma seção que já está
// mais abaixo — nunca cria tela nova.
import BotoesRapidos from './botoes-rapidos.vue'
import { botoesDoMotorista, botoesDaGestao } from './botoes-rapidos.js'
// Lançar manutenção (D27): um serviço com várias trocas, em lugar de preencher
// o formulário de uma troca por vez N vezes.
// As gavetas da aba Gestão: seção que abre e fecha, com o estado no título
// fechado. A regra de quando abrir mora em gavetas.js, testada.
// Quem abre por último fica na frente. Sem isto, um modal aberto DE DENTRO de
// outro pode nascer atrás dele — o defeito que o dono relatou em 12/08.
import { abrirCamada, fecharCamada } from '../../compartilhado/camada-de-modal.js'
// O aviso rápido no canto da tela, o mesmo que Admin, Acessos, Redes e
// Gestão de Tráfego já usam. Entra aqui porque gravar sem dizer que gravou
// deixa a pessoa clicando de novo, sem saber se pegou.
import { adminToast } from '../../compartilhado/avisos.js'
// Pessoa de fora da empresa usando o carro (D25): nome escrito na hora, sem
// cadastro. A regra e as sugestões moram em nomes-de-fora.js, testadas.
import {
  nomesDeFora, problemasDoNomeDeFora, motoristaParaGravar, DE_FORA,
} from './nomes-de-fora.js'
// Dar acesso ao dono do carro, do próprio quadro de cobrança (D34/D-2).
import { podeConvidar, senhaInicial, recadoDoConvite } from './convite-do-dono.js'
import Gaveta from './gaveta.vue'
import { gavetasVisiveis, lerPreferencias, gravarPreferencias } from './gavetas.js'
import LancamentoDeManutencao from './lancamento-de-manutencao.vue'
import {
  linhasParaGravar, mensagemDoLancamento, centavos, VALOR_INVALIDO,
} from './lancamento-de-manutencao.js'
import {
  checklistDeHoje, resumoDaCobranca, precisaDeChecklist,
  problemasAbertosHoje, veiculosParaConferir, cadenciasDoDia,
  oQuePedirNaRetirada, porQuePedirOAceite, oQueFaltaNaRetirada,
} from '../../../supabase/functions/_shared/checklist.js'
// O histórico da aba Gestão: a linha do tempo de reservas e retiradas, com a
// prova de cada uma e o que o admin pode fazer com ela.
import {
  linhaDoTempo, filtrar, resumoDoHistorico, FILTROS,
  rotuloDaSituacao, corDaSituacao, resumoCurtoDaLinha, porQueNaoDaEmPortugues, diaEmBrasilia, fraseDaPosse,
} from './historico-de-reservas.js'
import {
  agruparPorDia, filtrarFichas, resumoDasFichas, FILTROS_DE_FICHA,
} from './historico-de-checklists.js'
import { bensLivresParaFrota, patchDoBem } from './bens-para-veiculo.js'
import { PRIMEIRO_DEGRAU, proximoLimite, rotuloDeVerMais } from './mostrar-mais.js'
import {
  normalizarPlaca, validarEtiqueta, etiquetaDoCodigo, COMO_FICA,
  comoFicaParaDados, validarCadastro, fraseDaSincronia, avisoDaEtiqueta,
} from './etiqueta-do-veiculo.js'
import { dadosDoLocal, insertDaArvore } from './local-do-veiculo.js'
import {
  contatoParaCobranca, podeCopiarTelefoneDoCarro,
  podeDigitarTelefone, conferirTelefoneDigitado, porQueOTelefoneNaoServe,
} from './contato-do-motorista.js'
import {
  textoParaAssinar, impressaoDigital, conferirCorrente, tempoDePreenchimento, VERSAO_ATUAL,
} from '../../../supabase/functions/_shared/assinatura.js'
import { normalizarRabisco } from '../../../supabase/functions/_shared/rabisco.js'
import { recusaDaSenha, avisoDoQueGravou, selo } from './assinar-checklist.js'
import {
  textoDaConferencia, resumoDaAssinatura, avisoDeTempo,
} from './conferencia-de-assinaturas.js'
import { resumoDasCopias } from './copias-no-zoho.js'
// O tutorial: o passeio pela tela inteira, os textos fixos dos 6 modais e o
// passeio pelos campos de cada um. PasseioGuiado é o MESMO componente que o
// Patrimônio usa (compartilhado/) — ele já aponta pra dentro de um modal
// aberto sozinho, não precisou de adaptação nenhuma.
import PasseioGuiado from '../../compartilhado/passeio-guiado.vue'
// A MESMA escolha de local que o Patrimônio tem, agora aqui: Marca › Local ›
// Ambiente, mostrando o que já está no banco em vez de deixar digitar às cegas.
// Bronca do dono: "fui editar a ficha de carro BMW, aí tem lá campo local, eu
// digito ao invés de já mostrar tudo o que já temos em banco".
import EscolhaDeLocalEAmbiente from '../../compartilhado/escolha-de-local-e-ambiente.vue'
// A MESMA porta estreita do Patrimônio (13/08/2026): os 4 campos de pessoa
// desta tela — Responsável, Quem vai dirigir, Quem vai usar, Passar para —
// passam a enxergar quem não tem Colaboradores e Acessos, e a cadastrar na
// hora quem falta.
import EscolhaDePessoa from '../../compartilhado/escolha-de-pessoa.vue'
import { mesclarPessoas, apenasAtivas, comSelecionada } from '../../compartilhado/pessoas-para-escolher.js'
import {
  PASSOS, TEXTOS, PASSOS_VEICULO, PASSOS_ITEM, PASSOS_FICHA_DETALHE,
  PASSOS_PEDIDO, PASSOS_DECISAO, PASSOS_FICHA, deveAbrirSozinho, marcarComoVisto,
} from './tutorial.js'

const router = useRouter()
const logoClaroUrl = '/midia/LOGOTIPOBRENOPRETO.png'
const logoEscuroUrl = '/midia/LOGOTIPOBRENOBRANCO.png'

const veiculos = ref([])
const usos = ref([])
const pessoas = ref([])
// As CONTAS DE LOGIN, só id e nome. Existe para o histórico nunca deixar uma
// linha muda: quem agiu e não tem ficha de colaborador ligada é identificado por
// aqui. Ver nome-de-quem-agiu.js.
//
// `email` NÃO vem de propósito. Ele resolveria mais um caso (conta sem nome),
// mas medido em 18/08 os 20 perfis TÊM nome — então o degrau nunca dispararia, e
// trazer e-mail para uma tela nova espalharia dado que já é a pendência aberta
// de `profiles.email`. A escada continua completa na função pura, sem tela nova
// pagando por isso.
const perfisDeLogin = ref([])
const setores = ref([])
const criandoPessoa = ref(false)
const erroDePessoa = ref('')
// Recado sobre como a criação TERMINOU ("já existia"/"cadastrada"), pra
// alimentar a prop `aviso` do EscolhaDePessoa. Existe separado de
// `erroDePessoa` porque este é preenchido DEPOIS do `await carregar()` — a
// essa altura a caixinha já fechou sozinha, e o parágrafo que mostraria
// `erroDePessoa` (dentro dela) nunca chegaria a aparecer. `aviso` vive no
// parágrafo de FORA, que sobrevive ao fechamento (item D do fix de 13/08/2026).
const avisoDeCriacao = ref('')
// Qual campo de pessoa está criando agora ('' = nenhum). O aviso de erro e o
// "Criando…" pertencem ao campo que pediu, não à tela: são quatro campos de
// pessoa nesta tela e o erro de um apareceria nos outros.
const campoDeCriacao = ref('')   // '' | 'responsavel' | 'pedido' | 'retirada' | 'passar'
const pessoasAtivas = computed(() => apenasAtivas(pessoas.value))
// A RPC `pessoas_para_escolher()` ESTOURA (42501) pra quem não é
// is_frota_admin, is_patrimonio_admin nem is_acessos_admin — de propósito
// (migration 2026-08-13, linha ~31: "vazio silencioso é o defeito que já
// mostrou R$ 0,00 na tela do dono por 17 horas"). Isto só é a falha real
// quando a leitura direta de `acessos_pessoas` TAMBÉM não trouxe nada —
// mesmo raciocínio do `falhaArvore` abaixo: lista vazia sozinha não distingue
// "ninguém pra escolher" de "eu não vejo essa lista".
const falhaPessoas = ref(false)
const carregando = ref(true)
const falha = ref('')
const podeEditar = computed(() => hasPermission('frota', 'editar'))

/* A árvore Marca › Local › Ambiente do Patrimônio, lida aqui pra a ficha do
 * carro poder APONTAR um local de verdade em vez de guardar texto solto. São as
 * mesmas três tabelas que o Patrimônio usa — não é uma cópia da lista, é a
 * lista. */
const empresasPat = ref([])
const locaisPat = ref([])
const comodosPat = ref([])
// Falhou a LEITURA da árvore? A lista vazia tem de dizer por quê. Sem isto,
// "não há local cadastrado" e "não consegui ler os locais" ficam iguais na tela
// — e a segunda é mentira (item 9 do padrão).
const falhaArvore = ref(false)
// Duas áreas (D8): Motorista pra quem dirige, Gestão pra quem administra.
// A separação é de ATENÇÃO, não de sigilo — quem só dirige não precisa de FIPE,
// contrato e chassi na frente enquanto pega o carro pra sair.
const pode = (acao) => hasPermission('frota', acao)
// Relatórios tem chave PRÓPRIA (frota.relatorios), e nasce desmarcada para
// todo mundo: quem cadastra veículo não é necessariamente quem pode tirar a
// frota inteira em planilha. Nenhuma migration concede — quem libera é o
// Config de Admin.
const podeRelatorios = computed(() => hasPermission('frota.relatorios', 'ver'))
const podeExportarRelatorio = computed(() => hasPermission('frota.relatorios', 'exportar'))
const abas = computed(() =>
  AREAS.filter((a) => areasVisiveis(pode, podeRelatorios.value).includes(a.chave)))
const area = ref('motorista')
const euId = computed(() => meuId())
const painel = computed(() => painelDoMotorista(linhas.value, euId.value))

// O checklist do dia: os itens que o gestor definiu, a cadência (dia_semanal
// etc.) e as fichas já preenchidas, de onde saem "última semanal" e "última
// mensal" de cada carro.
const itensDeChecklist = ref([])
const configDeChecklist = ref({ dia_semanal: 5, semana_mensal: 1, dia_mensal: 3 })
const fichas = ref([])

// A data de HOJE em BRT, como texto. `toISOString()` puro daria a data em UTC,
// e depois das 21h no Brasil isso já é o dia seguinte — o checklist de hoje
// apareceria como o de amanhã.
const hoje = computed(() =>
  new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10))

// O carro desta pessoa HOJE: é o que ela vai conferir. D9b — a posse aberta
// vence o dono fixo, senão o botão "Passar o carro" gravava uma troca que
// nenhuma tela lia: Marcus continuava vendo "Seu carro" depois de emprestar
// pra Barbara, e ela não via o carro em lugar nenhum. `euId.value` checado
// antes: sem ele os dois lados da comparação virariam `null` e qualquer
// carro de rodízio (sem dono nem posse) passaria como "meu" por acidente.
const meuCarroFixo = computed(() => {
  if (!euId.value) return null
  return veiculos.value.find((v) => quemEstaComOCarro(v, usos.value).pessoaId === euId.value) || null
})

const fichaDeHoje = computed(() => !meuCarroFixo.value ? null
  : fichas.value.find((f) => f.veiculo_id === meuCarroFixo.value.id && f.feita_em === hoje.value) || null)

// Os botões rápidos do topo (D33). Reaproveitam `meuCarroFixo` e `fichaDeHoje`
// — já respondem exatamente "qual é meu carro" e "o checklist dele saiu hoje"
// pro aviso "Checklist de hoje já feito" ali acima. Não existe `fezChecklistHoje()`
// neste arquivo, e ir atrás de `aberto` erraria: `aberto` só lista quem AINDA
// precisa conferir (`veiculosParaConferir` filtra por `precisaDeChecklist`), então
// depois do checklist feito ele vira `null` e o botão perderia o nome do carro
// junto com o estado — pareceria que a pessoa deixou de ter carro fixo.
const meuCarroNome = computed(() => (meuCarroFixo.value ? meuCarroFixo.value.nome : null))
const meuChecklistHoje = computed(() => {
  if (!meuCarroFixo.value) return null
  return fichaDeHoje.value ? 'feito' : 'falta'
})

const botoesMotorista = computed(() => botoesDoMotorista({
  painel: painel.value, checklistDeHoje: meuChecklistHoje.value, nomeDoMeuCarro: meuCarroNome.value,
}))
// As duas permissões vão EXPLÍCITAS: os botões substituíram controles que já
// eram protegidos — o "+ Acrescentar veículo" era `v-if="pode('criar')"`, e o
// "Reservar" de cada carro é `v-if="podeEditar"`. Quem tem só `excluir` chega
// nesta aba (areas-da-frota.js) e não pode ver esses dois.
const botoesGestao = computed(() => botoesDaGestao({
  linhas: linhas.value, cobranca: cobranca.value, fila: filaDeAprovacao.value,
  podeCriar: pode('criar'), podeReservar: podeEditar.value,
}))

/* ── AS GAVETAS DA ABA GESTÃO ────────────────────────────────────────────────
 *
 * Pedido do dono: "as seções você pode minimizar em gavetas pra otimizar
 * informação e espaço". Eram seis blocos empilhados, e chegar na lista de
 * veículos era rolar tudo.
 *
 * A regra (gavetas.js, testada): abre sozinha a que tem algo esperando a
 * pessoa, fica fechada a que é consulta, e o TÍTULO FECHADO já responde. O que
 * a pessoa abrir ou fechar com a mão é lembrado — decisão dela, escolhida entre
 * "lembra do jeito que você deixou" e "sempre começa no padrão".
 *
 * `urgente` aqui é sempre uma MEDIDA, nunca um palpite: pedido esperando
 * decisão, problema marcado hoje, cópia que o robô desistiu de mandar. */
/* A camada de cada modal desta tela. `camadas.algo` recebe um número ao abrir e
 * o devolve ao fechar — quem abriu por último cobre quem já estava. Ver
 * compartilhado/camada-de-modal.js. */
const camadas = reactive({})
function subirCamada(nome) { camadas[nome] = abrirCamada() }
function descerCamada(nome) { fecharCamada(camadas[nome]); camadas[nome] = null }

/* Os nomes de fora já digitados, pra sugerir. Sai das reservas E dos usos —
 * as duas guardam nome sem `pessoa_id` quando é gente de fora. */
const sugestoesDeFora = computed(() => nomesDeFora([...requisicoes.value, ...usos.value]))

/* Quem vai dirigir, do jeito que vai pro banco: colaborador vira id+nome,
 * pessoa de fora vira nome sem id. Ver nomes-de-fora.js. */
const motoristaDoPedido = computed(() => motoristaParaGravar({
  pessoaId: pedidoForm.pessoaId === DE_FORA ? null : pedidoForm.pessoaId,
  nomeDeFora: pedidoForm.pessoaId === DE_FORA ? pedidoForm.nomeDeFora : '',
  nomeDaPessoa,
}))

const prefsDasGavetas = ref({})
/** A gaveta de uma chave, ou `undefined` quando ela não aparece hoje (vazia).
 *  O `v-if` do template usa esse `undefined` pra não desenhar nada. */
const gv = (chave) => gavetasDaGestao.value.find((g) => g.chave === chave)
function alternarGaveta(chave) {
  const atual = gavetasDaGestao.value.find((g) => g.chave === chave)
  if (!atual || atual.travadaAberta) return
  prefsDasGavetas.value = { ...prefsDasGavetas.value, [chave]: !atual.aberta }
  gravarPreferencias(
    typeof localStorage !== 'undefined' ? localStorage : null,
    estado.user?.id, prefsDasGavetas.value,
  )
}

const gavetasDaGestao = computed(() => gavetasVisiveis([
  {
    chave: 'fila',
    titulo: 'Aguardando sua decisão',
    estado: filaDeAprovacao.value.length
      ? `${filaDeAprovacao.value.length} ${filaDeAprovacao.value.length === 1 ? 'pedido' : 'pedidos'}`
      : null,
    // Pedido parado é o caso mais claro de "algo esperando a pessoa".
    urgente: filaDeAprovacao.value.length > 0,
    // Sem fila, a gaveta nem aparece: título que abre pro nada é ruído.
    vazia: !podeAprovar.value || !filaDeAprovacao.value.length,
  },
  {
    chave: 'historico',
    titulo: 'Reservas e retiradas',
    // O título fechado já responde à pergunta que o dono fez ("não sei se está
    // indo tudo pro Zoho"): quantas saídas ficaram sem a assinatura de quem
    // pegou o carro. Um "38 movimentos" não ajudaria ninguém a decidir nada.
    estado: (() => {
      const sem = contagemDosFiltros.value['sem-assinatura'] || 0
      if (!historico.value.length) return 'nada registrado ainda'
      if (!sem) return 'tudo com assinatura'
      return sem === 1 ? '1 sem assinatura' : `${sem} sem assinatura`
    })(),
    // NÃO é urgente, mesmo com saída sem assinatura. Urgente abre a gaveta à
    // força e tira da pessoa o direito de fechá-la — isso se reserva pro que
    // apareceu HOJE e pede providência hoje. O histórico é consulta: ele conta
    // o que já passou, e quase tudo aqui não tem mais conserto.
    padraoAberta: false,
    // "Não tem nada" é diferente de "não carreguei": aqui é medida — sem
    // reserva e sem retirada nenhuma, não há linha do tempo pra mostrar.
    vazia: !historico.value.length,
  },
  {
    chave: 'cobranca',
    titulo: 'Checklist de hoje',
    estado: botoesGestao.value.find((b) => b.chave === 'conferir-checklists')?.estado || null,
    padraoAberta: true,
    // Fim de semana sem retirada nenhuma não pede checklist: a lista vem
    // vazia e a gaveta some, em vez de dizer "faltam 0". Sábado COM retirada
    // continua aparecendo — quem pega carro confere antes de sair.
    vazia: !cobranca.value.length,
  },
  {
    chave: 'problemas',
    titulo: 'Problemas em aberto hoje',
    // `falhaRespostas` NÃO é "sem problema": a gaveta continua, aberta, e o
    // corpo dela explica que não deu pra ler. Sumir aqui seria a tela dizendo
    // que está tudo bem sobre o que ela não conseguiu carregar.
    estado: falhaRespostas.value
      ? 'não consegui conferir'
      : (problemasAbertos.value.length
        ? `${problemasAbertos.value.length} ${problemasAbertos.value.length === 1 ? 'problema' : 'problemas'}`
        : 'nenhum hoje'),
    urgente: falhaRespostas.value || problemasAbertos.value.length > 0,
    vazia: false,
  },
  {
    chave: 'zoho',
    titulo: 'Cópia das fichas no Zoho',
    estado: copias.value.falhaLeitura ? 'não consegui conferir' : (copias.value.frase || null),
    // Só grita quando o robô DESISTIU ou tropeçou — o que ainda está na fila é
    // trabalho dele, não da pessoa.
    urgente: copias.value.falhaLeitura || copias.value.temProblema,
    vazia: !copias.value.falhaLeitura && !copias.value.temProblema && !copias.value.esperando,
  },
  {
    chave: 'veiculos',
    titulo: 'Veículos do grupo',
    estado: botoesGestao.value.find((b) => b.chave === 'veiculos')?.estado || null,
    // Consulta: fica fechada até a pessoa querer. É a maior das seções, e é
    // fechá-la que devolve a tela pra quem só veio ver uma coisa.
    padraoAberta: false,
    vazia: !linhas.value.length,
  },
], prefsDasGavetas.value))

/* Um botão rápido NÃO cria tela: ou abre uma ficha que já existe, ou rola até
 * uma seção que já está mais abaixo. É o que o desenho pede (D33) e é o que
 * impede esta fase de virar uma segunda ferramenta por cima da primeira. */
async function irPara(acao) {
  if (acao === 'reservar') return abrirPedido('')
  if (acao === 'acrescentar') return abrirVeiculoNovo()
  const ancoras = {
    'meu-checklist': 'fr-ancora-checklist',
    'preciso-carro': 'fr-ancora-livres',
    'conferir-checklists': 'fr-ancora-cobranca',
    veiculos: 'fr-ancora-veiculos',
  }
  // ABRE A GAVETA ANTES DE ROLAR. Sem isto, o botão rápido rolaria até um
  // título fechado e a pessoa veria a tela mexer sem entregar o que ela pediu —
  // que é pior que o botão não fazer nada. O `await nextTick()` é o que espera
  // o corpo da gaveta existir no DOM antes de medir onde ele está.
  const daGaveta = { 'conferir-checklists': 'cobranca', veiculos: 'veiculos' }
  const chave = daGaveta[acao]
  if (chave) {
    const g = gavetasDaGestao.value.find((x) => x.chave === chave)
    if (g && !g.aberta) { alternarGaveta(chave); await nextTick() }
  }
  const alvo = document.getElementById(ancoras[acao])
  // Sem âncora não faz nada, em silêncio: rolar pro lugar errado é pior que não
  // rolar, e um botão que pula pro topo parece defeito.
  if (alvo) alvo.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

/* ── QUEM ADMINISTRA PREENCHE POR QUALQUER CARRO (D21b) ───────────────────────
 * Pedido do dono, e é o que destrava o problema dos motoristas SEM LOGIN:
 * Barbara, Marcus e Thiago são donos de carro e não têm conta no aplicativo.
 * Sem isto, o carro deles ficaria sem ficha nenhuma até o RH criar as contas.
 *
 * A FICHA REGISTRA QUEM REALMENTE CONFERIU, não de quem é o carro. Isso não é
 * detalhe: `gravarChecklist` grava `pessoa_id: euId` — quem está com a tela
 * aberta —, e nada aqui muda isso. Gravar a Barbara porque o Punto é dela seria
 * inventar que ela olhou o veículo, que é exatamente a resposta falsa que este
 * desenho inteiro existe pra impedir. E numa multa, inverteria a
 * responsabilidade. */
const ehGestorDaFrota = computed(() => pode('criar') || pode('excluir'))
const paraConferir = computed(() => veiculosParaConferir({
  veiculos: veiculos.value, euId: euId.value,
  ehGestor: ehGestorDaFrota.value, fichas: fichas.value, hoje: hoje.value,
  // D9b: enquanto o carro está emprestado, quem confere é quem está COM ele.
  // Sem isto, o quadro de cobrança (que já olha a posse) cobraria da Barbara
  // uma ficha que o cartão não deixava ela preencher.
  //
  // `quemDeveConferir` e NÃO `quemEstaComOCarro`: a segunda olha só a POSSE, e
  // por isso quem retirava um carro de rodízio não via o cartão do checklist
  // dele — o carro estava com a pessoa por VIAGEM. O dono caiu nisso em
  // 21/08/2026 com a Bravo Blackmotion: pra conferir o carro que estava
  // dirigindo, teve que caçá-lo num seletor que só quem administra enxerga.
  quemEstaCom: (v) => quemDeveConferir(v, usos.value).pessoaId || v.pessoa_id,
  // Quem está com o carro POR VIAGEM: é o desempate do cartão que abre sozinho.
  // Sem isto, quem tem carro fixo e pegou um de rodízio abria o fixo — o
  // desempate era alfabético, e a pessoa estava de pé ao lado do outro.
  emViagem: (v) => {
    const q = quemDeveConferir(v, usos.value)
    return q.porViagem ? q.pessoaId : null
  },
}))
/* Qual carro está aberto pra preencher. Guarda o ID, nunca o objeto: a lista é
 * recalculada a cada leitura, e um objeto guardado ficaria velho — depois de
 * gravar, o carro sai de `paraConferir` e a tela continuaria mostrando o cartão
 * dele, que é o "parece salvo e não salvou" ao contrário. Com o id, some
 * sozinho. */
const conferindoVeiculo = ref(null)
const aberto = computed(() => {
  const escolhido = conferindoVeiculo.value
    && paraConferir.value.find((x) => x.veiculo.id === conferindoVeiculo.value)
  if (escolhido) return escolhido
  // O primeiro abre sozinho SÓ quando é o carro da própria pessoa: quem tem
  // carro fixo não deve ter que escolher nada. Abrir o carro de outro sozinho
  // seria empurrar o gestor a assinar pelo veículo errado.
  return paraConferir.value[0]?.meu ? paraConferir.value[0] : null
})
const outrosParaConferir = computed(() =>
  paraConferir.value.filter((x) => !aberto.value || x.veiculo.id !== aberto.value.veiculo.id))
/* Hoje é dia de checklist? Fim de semana não pede nada (`cadenciasDoDia`
 * devolve vazio), e o cartão se esconde sozinho. Sem esta guarda, a lista
 * "Outros carros" ofereceria no sábado um botão que abre um cartão vazio —
 * botão que não faz nada é a tela mentindo que faz. */
const diaPedeChecklist = computed(() => cadenciasDoDia({
  hoje: hoje.value, config: configDeChecklist.value,
  ultimaSemanal: null, ultimaMensal: null,
}).length > 0)

const ultimaDoTipo = (veiculoId, cadencia) => {
  const l = fichas.value
    .filter((f) => f.veiculo_id === veiculoId && (f.cadencias || []).includes(cadencia))
    .map((f) => f.feita_em)
    .sort()
  return l.length ? l[l.length - 1] : null
}

// O quadro de cobrança da aba Gestão (D16): quem tem carro fixo e ainda não
// conferiu hoje. Só as fichas de HOJE entram na conta — uma de ontem não conta
// como feita, senão o quadro ficaria em dia por engano o dia inteiro.
const fichasDeHoje = computed(() => fichas.value.filter((f) => f.feita_em === hoje.value))
// `usos` entra aqui (D9b): enquanto o carro está emprestado, quem cobra é
// quem está com ele, não o dono no papel — Marcus não é cobrado enquanto a
// Barbara está com o Volvo, ela é.
// `hoje` entra pelo calendário: sábado e domingo não cobram ninguém, do mesmo
// jeito que o robô da manhã já não cobrava.
/* O QUADRO DE HOJE, INTEIRO — o que falta e o que já foi feito, com etiqueta.
 *
 * Era `quemFaltaHoje`, que responde a outra pergunta ("de quem eu cobro?") e
 * por isso só olhava carro com dono fixo. Em 21/08/2026 o dono retirou a Bravo
 * Blackmotion, de rodízio, e o carro não aparecia PARA NINGUÉM neste quadro —
 * nem pendente, nem feito. Retirada sem checklist não era cobrada de pessoa
 * nenhuma. `checklistDeHoje` traz também quem saiu numa retirada de hoje.
 *
 * `dono` e `donoId` seguem com o mesmo nome porque meia dúzia de coisas nesta
 * tela dependem deles (o zap de cobrança, o convite ao dono, o selo). Renomear
 * tudo aqui seria outra tarefa, e não é a que o dono pediu. */
const cobranca = computed(() => checklistDeHoje({
  veiculos: veiculos.value, fichasDeHoje: fichasDeHoje.value, pessoas: pessoas.value,
  usos: usos.value, hoje: hoje.value,
}).map((l) => ({ ...l, dono: l.quem, donoId: l.quemId })))

// O QUE foi marcado nas fichas de hoje (pedido do dono: o quadro dizia QUEM
// fez, mas não deixava ver O QUE). Só de HOJE — decisão dele, sem navegação
// por data passada. `falhaRespostas` distingue "não tinha nenhum item" de
// "não consegui carregar": sem essa distinção uma falha de rede virava,
// silenciosamente, "ficha vazia", que é dado inventado.
const respostasDeHoje = ref([])
const falhaRespostas = ref(false)

// Os "Problema" de todos os carros, juntos — pra não abrir carro por carro.
const problemasAbertos = computed(() => problemasAbertosHoje({
  fichasDeHoje: fichasDeHoje.value, respostas: respostasDeHoje.value, veiculos: veiculos.value }))

/* AS CÓPIAS EM PDF DAS FICHAS ASSINADAS (D23). A tabela `frota_checklist_pdf`
 * guardava isto desde que o robô subiu, e não aparecia em lugar nenhum: se um
 * PDF falhasse, só quem abrisse o banco ficaria sabendo. A regra e as três
 * situações (esperando / tropeçou / desistiu) moram em copias-no-zoho.js,
 * testadas — aqui só ficam os dados. */
const copiasPendentes = ref([])   // as que ainda NÃO estão na pasta do Zoho
const copiasEntregues = ref(0)    // contagem das que já estão lá
const falhaCopias = ref(false)
const copias = computed(() => resumoDasCopias({
  linhas: copiasPendentes.value, entregues: copiasEntregues.value,
  fichas: fichas.value, veiculos: veiculos.value, falhaLeitura: falhaCopias.value }))

// TODAS as linhas de `frota_checklist_pdf`, e não só as que ainda não chegaram.
// O quadro de cópias (D23) só precisa das pendentes — ele existe pra mostrar
// problema. O histórico precisa das entregues também: a pergunta que ele
// responde é "esta ficha chegou no Zoho?", e "não está na lista de pendentes"
// não é resposta, é dedução.
const copiasDetalhadas = ref([])

// O detalhe de uma ficha, aberto ao clicar num carro já feito (quadro de
// cobrança) ou numa linha do histórico.
const fichaDetalhe = ref(null)   // { veiculo, ficha } | null
/* As respostas da ficha ABERTA no detalhe.
 *
 * `respostasDeHoje` cobre só o dia de hoje, e isso bastava quando o detalhe só
 * abria pelo quadro de cobrança. O histórico abre ficha de qualquer dia dos
 * últimos 120 — e ali `respostasDeHoje` estaria vazia, o que faria o modal
 * dizer "nenhum item respondido" sobre uma ficha cheia. Por isso a ficha de
 * outro dia traz as respostas dela junto, buscadas na hora de abrir. */
const respostasDaFichaAberta = ref(null)   // null = usar as de hoje
const falhaRespostasDoDetalhe = ref(false)
const respostasDoDetalhe = computed(() => {
  if (!fichaDetalhe.value) return []
  const base = respostasDaFichaAberta.value ?? respostasDeHoje.value
  return base
    .filter((r) => r.checklist_id === fichaDetalhe.value.ficha.id)
    .slice()
    .sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0))
})
function abrirDetalheChecklist(c) {
  const ficha = fichaDoVeiculoHoje(c.veiculo.id)
  if (!ficha) return  // defensivo: card "feito" sempre tem ficha de hoje por trás
  respostasDaFichaAberta.value = null
  falhaRespostasDoDetalhe.value = false
  fichaDetalhe.value = { veiculo: c.veiculo, ficha }
}

/** O mesmo detalhe, aberto a partir de uma ficha qualquer do histórico. */
async function abrirFichaDoHistorico(ficha) {
  if (!ficha) return
  const veiculo = veiculos.value.find((v) => v.id === ficha.veiculo_id)
    || { id: ficha.veiculo_id, nome: 'carro que saiu do cadastro', placa: '' }
  falhaRespostasDoDetalhe.value = false
  // Ficha de hoje já tem as respostas carregadas: não vale uma ida ao banco.
  respostasDaFichaAberta.value = ficha.feita_em === hoje.value ? null : []
  fichaDetalhe.value = { veiculo, ficha }
  if (ficha.feita_em === hoje.value) return
  const { data, error } = await sbClient.from('frota_checklist_respostas')
    .select('*').eq('checklist_id', ficha.id).order('ordem')
  // Falhar aqui NÃO pode virar "nenhum item respondido": é a mentira que o
  // padrão da central proíbe por escrito. A marca faz o modal dizer que não
  // conseguiu ler.
  falhaRespostasDoDetalhe.value = !!error
  respostasDaFichaAberta.value = error ? [] : (data || [])
}

/* A ficha de HOJE de um carro. Existe como função (e não repetida em três
 * lugares) porque o quadro de cobrança e o detalhe têm de olhar exatamente a
 * mesma ficha — duas buscas parecidas que divergissem fariam o selo dizer uma
 * coisa e o detalhe mostrar outra. */
function fichaDoVeiculoHoje(veiculoId) {
  return fichasDeHoje.value.find((f) => f.veiculo_id === veiculoId) || null
}

/* O SELO DO QUADRO DE COBRANÇA TEM TRÊS ESTADOS, NÃO DOIS (D22).
 * "feito" e "feito e assinado" não são a mesma coisa, e apagar a diferença
 * seria deixar ficha sem assinatura parecer assinada — a mentira mais cara
 * desta fase.
 * O QUE ISTO NÃO É: uma acusação. Três dos donos de carro (Barbara, Marcus e
 * Thiago) não têm login, e sem assinatura é o ÚNICO caminho que existe pra
 * eles — por isso o selo é laranja (dado a saber), nunca vermelho (falta). */
function fichaAssinadaHoje(veiculoId) {
  const f = fichaDoVeiculoHoje(veiculoId)
  return !!(f && f.assinada_em)
}
function seloDaCobranca(c) {
  if (!c.fez) return 'falta'
  return fichaAssinadaHoje(c.veiculo.id) ? 'assinado' : 'feito, sem assinatura'
}

// A assinatura da ficha aberta no detalhe, e o sinal de D20 sobre ela.
const assinaturaDoDetalhe = computed(() =>
  fichaDetalhe.value ? resumoDaAssinatura(fichaDetalhe.value.ficha) : null)
// SÓ O CASO CURTO (D20): tempo curto prova desatenção, tempo longo não prova
// zelo nenhum. Devolve nulo — e some da tela — em todo o resto.
const avisoDeTempoDoDetalhe = computed(() => {
  if (!fichaDetalhe.value) return null
  const f = fichaDetalhe.value.ficha
  return avisoDeTempo(tempoDePreenchimento(f.aberta_em, f.assinada_em))
})
/* Qual das duas marcas de falha vale para a ficha que está aberta. */
const detalheNaoLeu = computed(() => {
  if (!fichaDetalhe.value) return false
  return fichaDetalhe.value.ficha.feita_em === hoje.value
    ? falhaRespostas.value
    : falhaRespostasDoDetalhe.value
})

function fecharDetalheChecklist() {
  fichaDetalhe.value = null
  passeioFichaDetalheAberto.value = false
  respostasDaFichaAberta.value = null
  falhaRespostasDoDetalhe.value = false
}

const ROTULOS_RESULTADO = { liberado: 'Liberado', com_ressalvas: 'Com ressalvas', nao_liberado: 'Não liberado' }
const rotuloResultado = (r) => ROTULOS_RESULTADO[r] || r
const ROTULOS_ESTADO_ITEM = { ok: 'OK', nao_ok: 'Problema', na: 'Não se aplica' }
const rotuloEstadoItem = (e) => ROTULOS_ESTADO_ITEM[e] || e

// A hora de `criada_em` (timestamptz em UTC) no fuso de quem pergunta —
// mesmo cuidado de `hoje`: mostrar a hora crua do servidor confundiria quem
// olha às 20h e vê "23h" na tela.
function horaBR(iso) {
  if (!iso) return null
  return new Date(iso).toLocaleTimeString('pt-BR', {
    hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
}

// De quem é o telefone que vamos usar pra cobrar (Bronca 1 do dono: a ficha
// do carro TEM telefone pra Marcus e pro Thiago Siqueira, e o quadro dizia
// que faltava porque só olhava `acessos_pessoas`). A decisão — inclusive a
// armadilha de o contato do carro nem sempre ser quem dirige — mora em
// contato-do-motorista.js, testada; aqui só monta o link e o texto.
/* ── DAR ACESSO AO DONO, do próprio quadro (D-2) ──────────────────────────
 * Medido em 12/08/2026: Marcus, Thiago e Barbara são donos de carro e não têm
 * login, então não recebem o aviso das 7h30 nem assinam checklist. Os três já
 * têm cadastro completo — falta só a conta. O convite NÃO manda e-mail: cria a
 * conta com senha temporária, que aparece aqui pra quem convida entregar. */
const convidando = ref(null)      // { veiculoId, nome, email } enquanto grava
const conviteFeito = ref(null)    // { veiculoId, nome, email, senha } depois
const erroDoConvite = ref('')
const senhaCopiada = ref(false)

function conviteDaLinha(c) {
  const pessoa = pessoaDoDono(c)
  return podeConvidar({
    pessoa,
    jaTemLogin: !!(pessoa && pessoa.profile_id),
    podeAdministrar: podeEditar.value,
  })
}

async function darAcessoAoDono(c) {
  if (convidando.value) return
  const { pode, email } = conviteDaLinha(c)
  if (!pode) return
  const pessoa = pessoaDoDono(c)
  convidando.value = { veiculoId: c.veiculo.id, nome: pessoa.nome, email }
  erroDoConvite.value = ''
  conviteFeito.value = null

  const senha = senhaInicial(12)
  try {
    // PASSO 1: a conta.
    const r = await fetch(`${SUPABASE_URL}/functions/v1/invite-user`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${(await sbClient.auth.getSession()).data.session?.access_token || ''}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, name: pessoa.nome, role: 'viewer', password: senha }),
    })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) {
      const cru = String(d.error || '')
      // A mensagem crua da Supabase vem em inglês. Traduzir o caso mais comum
      // evita "already been registered" na cara de quem não lê inglês.
      throw new Error(/already.*registered|already exists/i.test(cru)
        ? `Já existe uma conta com o e-mail ${email}. Peça a um super-admin para trocar a senha dela em Administração.`
        : (cru || `a função respondeu ${r.status}`))
    }

    // A SENHA APARECE AGORA, com a conta recém-criada — e não no fim.
    // A revisão pegou o defeito: se qualquer passo seguinte falhasse, a conta
    // já existia e a senha era jogada fora, sem ninguém nunca ver. Ficava uma
    // conta que a pessoa não podia ser avisada, e tentar de novo esbarrava em
    // "e-mail já cadastrado". A partir daqui nada mais apaga a senha da tela:
    // o que der errado vira AVISO ao lado dela.
    conviteFeito.value = { veiculoId: c.veiculo.id, nome: pessoa.nome, email, senha, pendencias: [] }
    senhaCopiada.value = false

    const pendencias = []

    // PASSO 2: achar o perfil. O id vem de CONSULTA, não da resposta — a edge
    // devolve `{success:true}` e mais nada, e ler `d.id` daria nulo em silêncio.
    const { data: perfil } = await sbClient.from('profiles')
      .select('id,permissions,features').eq('email', email).maybeSingle()
    if (!perfil || !perfil.id) {
      pendencias.push('Não achei o cadastro da conta para terminar de configurar. '
        + 'Ela entra com os dados acima, mas falta liberar a Frota e exigir a troca da senha — '
        + 'peça isso em Administração › Usuários.')
      conviteFeito.value = { ...conviteFeito.value, pendencias }
      return
    }

    // PASSO 3: exigir a troca da senha. A edge NÃO faz isso no caminho de
    // criação — conferido no código dela. Sem este passo a senha temporária
    // vira permanente, e quem convidou (e o grupo onde ela foi colada) fica com
    // credencial válida da conta de outra pessoa.
    const { data: marcou } = await sbClient.from('profiles')
      .update({ precisa_trocar_senha: true }).eq('id', perfil.id).select('id')
    if ((marcou || []).length !== 1) {
      pendencias.push('Não consegui exigir a troca da senha no primeiro acesso. '
        + 'Esta senha vale até alguém trocá-la — avise quem administra.')
    }

    // PASSO 4: o acesso à Frota, nos DOIS modelos que esta central usa —
    // `permissions` (que a tela lê) e `features` (que a permissão do banco lê).
    // Conferido num usuário que funciona: o Humberto tem os dois. Gravar só um
    // deixaria a pessoa entrando na tela e esbarrando no banco, ou o contrário.
    // JUNTA com o que já existe, nos dois. Escrever `['frota']` cru apagaria
    // qualquer outro acesso que a conta tivesse — nesta conta recém-criada não
    // há nenhum, mas o botão pode um dia ser usado em alguém que já usa a
    // central, e aí seria um estrago silencioso.
    const permissoes = { ...(perfil.permissions || {}), frota: ['ver'] }
    const recursos = [...new Set([...(perfil.features || []), 'frota'])]
    const { data: liberou } = await sbClient.from('profiles')
      .update({ permissions: permissoes, features: recursos }).eq('id', perfil.id).select('id')
    if ((liberou || []).length !== 1) {
      pendencias.push(`${pessoa.nome} entra no aplicativo, mas AINDA NÃO alcança a Frota. `
        + 'Libere em Administração › Usuários.')
    }

    // PASSO 5: o elo com o cadastro. Sem ele o quadro de cobrança não casa a
    // pessoa com a conta. (O aviso das 7h30 ainda chega: o robô resgata pelo
    // e-mail quando o elo falta — conferido em `_shared/quem-loga.js`.)
    const { data: ligou } = await sbClient.from('acessos_pessoas')
      .update({ profile_id: perfil.id }).eq('id', pessoa.id).select('id')
    if ((ligou || []).length !== 1) {
      pendencias.push('O elo entre a conta e a ficha do colaborador não ficou gravado. '
        + 'O aviso ainda chega pelo e-mail, mas avise quem administra para ligar a ficha.')
    }

    conviteFeito.value = { ...conviteFeito.value, pendencias }
  } catch (e) {
    // Se a conta chegou a ser criada, a senha já está na tela e continua lá —
    // este ramo só fala do que não deu.
    erroDoConvite.value = conviteFeito.value
      ? (e.message || 'Alguma coisa falhou depois de criar a conta.')
      : `${e.message || 'Não consegui criar o acesso.'} Se a conta chegou a ser criada, `
        + 'ela vai aparecer em Administração › Usuários — confira antes de tentar de novo.'
  } finally {
    convidando.value = null
  }
  // FORA do try: se recarregar a lista falhar, a conta está criada e a senha na
  // tela — dizer que deu errado aqui assustaria à toa.
  try { await carregar() } catch (e) { /* a senha continua na tela */ }
}
async function copiarSenha() {
  const c = conviteFeito.value
  if (!c) return
  try {
    await navigator.clipboard.writeText(recadoDoConvite(c))
    senhaCopiada.value = true
  } catch (e) {
    // Sem área de transferência (navegador antigo, permissão negada): a senha
    // continua na tela pra copiar à mão. Dizer que copiou sem ter copiado seria
    // a pessoa fechar a tela e perder a senha.
    erroDoConvite.value = 'Não consegui copiar sozinho — selecione o texto acima e copie à mão.'
  }
}

function pessoaDoDono(c) {
  return pessoas.value.find((p) => p.id === c.donoId) || null
}
function contatoDaLinha(c) {
  // `pessoas` decide a AMBIGUIDADE, e sem ela a proteção não vale: a base tem
  // 3 "Vieira" e 2 "Clara", e um contato escrito só com o sobrenome não
  // identifica ninguém. Sem a lista, a função concluiria "é o próprio
  // motorista" e ESCONDERIA o aviso de que o contato é outra pessoa.
  return contatoParaCobranca({ pessoa: pessoaDoDono(c), veiculo: c.veiculo, pessoas: pessoas.value })
}

// O link de WhatsApp pra cobrar quem ainda não fez o checklist hoje. A
// mensagem muda quando quem atende não é quem dirige (contato do carro é
// outra pessoa, ex.: a supervisora que aparece na ficha de um carro de
// rodízio) — pedir o checklist DELA seria absurdo; o certo é pedir que ela
// avise quem está com o carro.
function zapDeCobranca(c) {
  const contato = contatoDaLinha(c)
  if (!contato.telefone) return null
  const mensagem = contato.origem === 'carro_outra_pessoa'
    ? `Olá${contato.nomeContato ? ', ' + contato.nomeContato : ''}! Você está cadastrado(a) como contato `
      + `do ${c.veiculo.nome} (${c.veiculo.placa}) — o checklist de hoje ainda não foi feito. `
      + 'Consegue avisar quem está com o carro?'
    : `Olá${c.dono ? ', ' + c.dono : ''}! Falta fazer o checklist de hoje do ${c.veiculo.nome} (${c.veiculo.placa}).`
  return linkDoWhatsapp(contato.telefone, mensagem)
}
// O texto do botão avisa DE QUEM é o telefone quando não é do motorista —
// decisão do dono: quem clica precisa saber que não está falando com quem
// dirige, senão a mensagem confunde os dois lados da conversa.
function rotuloZapDeCobranca(c) {
  const contato = contatoDaLinha(c)
  return contato.origem === 'carro_outra_pessoa'
    ? `Falar com ${contato.nomeContato || 'o contato do carro'}`
    : 'Cobrar no WhatsApp'
}
function tituloZapDeCobranca(c) {
  const contato = contatoDaLinha(c)
  return contato.origem === 'carro_outra_pessoa'
    ? `Falar com ${contato.nomeContato || 'o contato do carro'} no WhatsApp — é o contato do carro, não quem dirige`
    : `Cobrar ${c.dono || 'o responsável'} no WhatsApp`
}
// Por que o botão não aparece — nunca some em silêncio (pedido do dono: só
// 1 das 7 pessoas com carro tem telefone cadastrado hoje). Reaproveita
// porQueNaoDaLink() pro caso raro de número mal formatado; escreve a mensagem
// própria só pro caso comum, que é a ausência do telefone em QUALQUER lugar
// (nem cadastro, nem ficha do carro).
function porQueSemZapDeCobranca(c) {
  const contato = contatoDaLinha(c)
  if (contato.telefone) return porQueNaoDaLink(contato.telefone)
  return (c.dono
    ? `${c.dono} não tem telefone cadastrado, e a ficha do ${c.veiculo.nome} também não tem um contato.`
    : 'Não há telefone cadastrado para o responsável, nem um contato na ficha do carro.')
    + ' Sem telefone não dá pra chamar no WhatsApp — complete o cadastro em Colaboradores e Acessos '
    + 'ou na ficha do veículo.'
}

/* ── Devolver o telefone pro cadastro do colaborador (Bronca 1) ──────────────
   Quando o telefone mora só na ficha do carro E é da mesma pessoa (nomes
   batem), oferece copiá-lo pro cadastro em Colaboradores e Acessos — é o
   pedido do dono de fazer o dado fluir entre as ferramentas, não morar num
   canto só. Escreve em `numero_pessoal`: não dá pra saber se é um número
   corporativo, e `numero_pessoal` é o campo mais neutro dos dois. */
const salvandoTelefone = reactive({})   // veiculoId -> boolean
const erroSalvarTelefone = reactive({}) // veiculoId -> string
const telefoneSalvoAgora = reactive({}) // veiculoId -> boolean (confirmação nesta sessão)

function podeCopiarTelefoneNoCadastro(c) {
  // Escrever em acessos_pessoas exige a permissão de Colaboradores e Acessos
  // (é lá que o RLS `is_acessos_admin()` também bate) — sem checar aqui, o
  // botão apareceria pra quem administra só a Frota e a gravação falharia
  // sempre, sem dar pra saber por quê antes de clicar.
  // Mesma razão de contatoDaLinha: sem a base, um sobrenome ambíguo faria a
  // tela oferecer copiar pro cadastro um telefone que talvez seja de OUTRA
  // pessoa com o mesmo sobrenome.
  return hasPermission('acessos', 'editar') && podeCopiarTelefoneDoCarro({ pessoa: pessoaDoDono(c), veiculo: c.veiculo, pessoas: pessoas.value })
}

async function copiarTelefoneParaCadastro(c) {
  const pessoa = pessoaDoDono(c)
  const contato = contatoDaLinha(c)
  if (!pessoa || !contato.telefone || salvandoTelefone[c.veiculo.id]) return
  salvandoTelefone[c.veiculo.id] = true
  erroSalvarTelefone[c.veiculo.id] = ''
  const { error } = await sbClient.from('acessos_pessoas')
    .update({ numero_pessoal: contato.telefone, atualizado_em: new Date().toISOString() })
    .eq('id', pessoa.id)
  salvandoTelefone[c.veiculo.id] = false
  if (error) {
    // A gravação pode falhar (sem permissão, sem rede) e a tela NUNCA pode
    // parecer que deu certo quando não deu — é o defeito mais recorrente
    // deste projeto. Mensagem em português do que fazer, não o erro cru.
    erroSalvarTelefone[c.veiculo.id] = 'Não consegui salvar o telefone no cadastro. Tente de novo; '
      + 'se continuar falhando, confirme se você tem permissão para editar Colaboradores e Acessos.'
    return
  }
  telefoneSalvoAgora[c.veiculo.id] = true
  // Atualiza a lista local na hora: sem isto, o botão continuaria oferecendo
  // "copiar" até um recarregar inteiro da tela, como se nada tivesse gravado.
  const idx = pessoas.value.findIndex((p) => p.id === pessoa.id)
  if (idx !== -1) pessoas.value[idx] = { ...pessoas.value[idx], numero_pessoal: contato.telefone }
}

/* ── DIGITAR O TELEFONE ALI MESMO (D5) ──────────────────────────────────────
 *
 * Pedido do dono: "caso não tenha telefone cadastrado, permitir que eu coloque
 * ali no campo e já salve no cadastro da pessoa da central toda". Medido em
 * 19/08: Breno (X1 e XC90), Humberto (XC60) e Raissa (Cayenne) não têm
 * telefone em lugar nenhum, então o botão de copiar nunca aparecia pra eles —
 * e sem telefone não há como cobrar o checklist.
 *
 * Grava em `numero_corporativo`, escolha do dono nesta sessão. (O botão de
 * COPIAR, mais antigo, grava em `numero_pessoal` — são campos diferentes de
 * propósito: `telefoneDaCobranca` lê o corporativo primeiro.)
 */
const telefoneDigitado = reactive({})   // veiculoId -> texto do campo

function podeDigitarTelefoneNoCadastro(c) {
  // Mesmo portão do botão de copiar, e pela mesma razão: escrever em
  // acessos_pessoas exige a permissão de Colaboradores e Acessos, que é onde o
  // RLS `is_acessos_admin()` também bate. Sem checar aqui, o campo apareceria
  // pra quem só administra a Frota e a gravação falharia sempre.
  return hasPermission('acessos', 'editar')
    && podeDigitarTelefone({ pessoa: pessoaDoDono(c), veiculo: c.veiculo, pessoas: pessoas.value })
}

async function salvarTelefoneDigitado(c) {
  const pessoa = pessoaDoDono(c)
  if (!pessoa || salvandoTelefone[c.veiculo.id]) return

  // CONFERE ANTES DE GRAVAR. Número errado no cadastro não avisa que está
  // errado — ele só faz a cobrança ir pro vazio, e ninguém descobre até alguém
  // perguntar por que fulano nunca respondeu.
  const conferido = conferirTelefoneDigitado(telefoneDigitado[c.veiculo.id])
  if (!conferido.ok) {
    erroSalvarTelefone[c.veiculo.id] = porQueOTelefoneNaoServe(conferido.motivo)
    return
  }

  salvandoTelefone[c.veiculo.id] = true
  erroSalvarTelefone[c.veiculo.id] = ''
  const { data, error } = await sbClient.from('acessos_pessoas')
    .update({ numero_corporativo: conferido.numero, atualizado_em: new Date().toISOString() })
    .eq('id', pessoa.id)
    .select('id')
  salvandoTelefone[c.veiculo.id] = false

  if (error) {
    erroSalvarTelefone[c.veiculo.id] = 'Não consegui salvar o telefone no cadastro. Tente de novo; '
      + 'se continuar falhando, confirme se você tem permissão para editar Colaboradores e Acessos.'
    return
  }
  // ZERO LINHA É FALHA. O RLS barra em silêncio e o PostgREST responde 200 com
  // lista vazia — sem isto a tela diria "salvei" e o campo voltaria vazio no
  // próximo carregamento, parecendo defeito de gravação.
  if (!data || data.length === 0) {
    erroSalvarTelefone[c.veiculo.id] = 'O banco não deixou salvar. Confirme se você tem permissão '
      + 'para editar Colaboradores e Acessos.'
    return
  }

  telefoneSalvoAgora[c.veiculo.id] = true
  telefoneDigitado[c.veiculo.id] = ''
  // Atualiza a lista local na hora: sem isto o campo continuaria oferecendo
  // digitar até um recarregar inteiro, como se nada tivesse gravado.
  const idx = pessoas.value.findIndex((p) => p.id === pessoa.id)
  if (idx !== -1) pessoas.value[idx] = { ...pessoas.value[idx], numero_corporativo: conferido.numero }
}

function voltar() { router.push({ name: 'gestao-interna' }) }

async function carregar() {
  carregando.value = true
  falha.value = ''
  const [v, ua, uh, p, pe, pf, se, q, pl, rv, bn, ci, cc, cf, catv] = await Promise.all([
    sbClient.from('frota_veiculos').select('*').order('nome'),
    // frota_uso vem em DUAS consultas de propósito, e não numa só com limite.
    //
    // Uma posse que nunca troca de mão guarda o `saida_em` do dia em que foi
    // aberta pra sempre — ou seja, ela é das linhas mais ANTIGAS da tabela, a
    // primeira a cair fora de um "as 400 mais recentes". Passando a tabela de
    // 400 linhas, a tela deixava de enxergar as posses abertas antigas e caía
    // no dono fixo, enquanto o robô da manhã (que lê só as abertas, sem limite)
    // continuava vendo a posse — os dois discordando em silêncio sobre quem
    // está com o carro emprestado, que é a divergência que o D9b existe pra
    // não deixar acontecer.
    //
    // ABERTAS: sem limite. São poucas por natureza (no máximo uma por carro) e
    // são elas que decidem quem responde pelo carro hoje. Nenhuma pode faltar.
    // A ordem se mantém da mais recente pra mais antiga como era antes: quem
    // procura "o uso aberto deste carro" sem dizer o tipo espera o mais novo.
    sbClient.from('frota_uso').select('*').is('volta_em', null)
      .order('saida_em', { ascending: false }),
    // FECHADAS: o histórico de viagens, que é o que cresce pra sempre. Aqui o
    // limite faz sentido — só as devoluções recentes interessam pra montar a
    // tela (último KM, último tanque).
    sbClient.from('frota_uso').select('*').not('volta_em', 'is', null)
      .order('saida_em', { ascending: false }).limit(400),
    // numero_corporativo/numero_pessoal entram pelo botão de WhatsApp da
    // cobrança (V2 do quadro D16) — telefoneDaCobranca() escolhe qual dos dois
    // usar. Sem trazer as colunas aqui, a decisão sempre veria "sem telefone",
    // mesmo pra quem tem o número cadastrado.
    // `profile_id` entra porque pessoaDoUsuario() casa por ELE antes do e-mail
    // (ficha ligada ao login mas sem e-mail preenchido não era achada). Sem a
    // coluna aqui, o resgate pelo elo nunca dispararia — é o mesmo erro que já
    // aconteceu com `email_corporativo`: a decisão erra calada.
    sbClient.from('acessos_pessoas')
      .select('id,nome,email_corporativo,profile_id,numero_corporativo,numero_pessoal').order('nome'),
    // PORTA ESTREITA (13/08/2026): a leitura acima devolve VAZIO para quem não
    // tem Colaboradores e Acessos — medido: Gabriel Alves, Guilherme Cardoso e
    // Jeremias Vieira enxergavam ZERO pessoas, e o campo "Responsável" nascia
    // vazio pra eles. Esta função entrega os nomes (e o `profile_id`, que é
    // como pessoaDoUsuario() acha a ficha de quem está logado), sem abrir
    // e-mail nem telefone.
    sbClient.rpc('pessoas_para_escolher'),
    sbClient.from('profiles').select('id,name'),
    sbClient.rpc('setores_para_escolher'),
    // A agenda de reservas: quem vê a Frota vê a agenda inteira. Saber que o
    // carro está reservado é o que evita o conflito de viagens — esconder isso
    // de quem dirige recriaria no app o problema que o papel tem.
    sbClient.from('frota_requisicoes').select('*').order('retirada_prevista'),
    sbClient.from('frota_plano_revisao').select('*').order('ordem'),
    sbClient.from('frota_revisoes').select('*'),
    // Bens do Patrimônio — a lista do seletor de ligação na ficha (qualquer
    // categoria, como já era) e, com os campos extras, a matéria-prima pra
    // "Acrescentar veículo" puxar dados de um bem (F9). Pode falhar sem
    // derrubar nada: quem não tem Patrimônio ainda gere a frota.
    sbClient.from('patrimonio_bens')
      .select('id,nome,numero,categoria_id,marca,valor_centavos').order('nome').limit(500),
    sbClient.from('frota_checklist_itens').select('*').order('ordem'),
    sbClient.from('frota_checklist_config').select('*').limit(1),
    // 120 dias: o bastante pra saber quando foi a última mensal, sem crescer
    // pra sempre.
    sbClient.from('frota_checklist').select('*')
      .gte('feita_em', new Date(Date.now() - 120 * 86400000).toISOString().slice(0, 10))
      .order('feita_em', { ascending: false }),
    // A categoria "Veículos" do Patrimônio, só pra saber QUAL id filtrar em
    // bensLivresParaFrota — sem ela o seletor de "puxar de um bem" fica vazio
    // de propósito, em vez de listar bem de qualquer categoria (cadeira,
    // notebook…) como se fosse candidato a virar carro.
    sbClient.from('patrimonio_categorias').select('id,nome').ilike('nome', '%ve%cul%').limit(1),
  ])
  // As duas metades de frota_uso são igualmente obrigatórias: sem as abertas a
  // tela não sabe quem está com cada carro; sem as fechadas ela não sabe o KM.
  if (v.error || ua.error || uh.error) {
    falha.value = 'Não consegui carregar a frota. Recarregue a página; se continuar, avise.'
    carregando.value = false
    return
  }
  veiculos.value = v.data || []
  usos.value = [...(ua.data || []), ...(uh.data || [])]
  // Nome vem da porta estreita (todo mundo vê); contato vem da leitura direta
  // (só quem tem Colaboradores e Acessos). Quem tem os dois recebe a ficha
  // inteira; quem tem um só recebe o que pode — e nunca uma lista vazia por
  // falta de permissão.
  pessoas.value = mesclarPessoas(pe && !pe.error ? (pe.data || []) : [], p.data || [])
  perfisDeLogin.value = (pf && !pf.error ? (pf.data || []) : [])
  setores.value = se && !se.error ? (se.data || []) : []
  // A RPC falhou E a leitura direta não trouxe ninguém: as duas coisas juntas
  // são o "eu não vejo essa lista" — se só a RPC tivesse falhado mas a leitura
  // direta tivesse pessoas, a lista continuaria certa e não haveria o que
  // avisar.
  falhaPessoas.value = !!(pe && pe.error) && !(p.data && p.data.length)
  // A agenda pode falhar sozinha (permissão nova ainda não concedida) sem
  // derrubar o resto da tela: sem ela a Frota ainda serve pra pegar e devolver.
  requisicoes.value = q && !q.error ? (q.data || []) : []
  plano.value = pl && !pl.error ? (pl.data || []) : []
  revisoes.value = rv && !rv.error ? (rv.data || []) : []
  bensVeiculo.value = bn && !bn.error ? (bn.data || []) : []
  categoriaVeiculoId.value = catv && !catv.error && catv.data && catv.data[0] ? catv.data[0].id : null
  // Mesmo padrão tolerante a falha: sem o checklist a Frota ainda serve pra
  // pegar e devolver carro.
  itensDeChecklist.value = ci && !ci.error ? (ci.data || []) : []
  configDeChecklist.value = cc && !cc.error && cc.data?.[0] ? cc.data[0] : configDeChecklist.value
  fichas.value = cf && !cf.error ? (cf.data || []) : []

  // As respostas das fichas de HOJE, só (pedido do dono: só as de hoje, sem
  // navegação por data passada). Um segundo passo, fora do Promise.all de
  // cima, porque precisa saber quais fichas SÃO de hoje antes de pedir as
  // respostas delas — e isso só se sabe depois de `fichas.value` estar
  // pronto. Sem ficha nenhuma hoje, nem consulta: não há o que buscar.
  const idsDeHoje = fichas.value.filter((f) => f.feita_em === hoje.value).map((f) => f.id)
  if (idsDeHoje.length) {
    const rd = await sbClient.from('frota_checklist_respostas')
      .select('*').in('checklist_id', idsDeHoje).order('ordem')
    // Falhou? A lista fica vazia, mas `falhaRespostas` avisa a tela — sem essa
    // marca, "vazio por falha" e "vazio porque não tinha item" ficam iguais,
    // e a tela mentiria dizendo "nenhum problema" quando na verdade não sabe.
    falhaRespostas.value = !!rd.error
    respostasDeHoje.value = rd.error ? [] : (rd.data || [])
  } else {
    falhaRespostas.value = false
    respostasDeHoje.value = []
  }

  // A árvore de locais não derruba a frota se falhar (mesmo tratamento do
  // Patrimônio nas outras leituras): quem não enxerga as tabelas do Patrimônio
  // continua pegando e devolvendo carro, só não consegue apontar o local.
  await Promise.all([carregarArvoreDeLocais(), carregarCopiasNoZoho()])
  carregando.value = false
}

/* AS CÓPIAS EM PDF: duas leituras, e as duas de propósito.
 *
 * 1) AS QUE FALTAM (`situacao <> 'enviado'`), com tudo: é o punhado de linhas
 *    que tem algo a dizer. Trazer a tabela inteira seria trazer, pra sempre,
 *    ~150 linhas por mês que só dizem "chegou" — e as que chegaram não têm
 *    nada a contar pra quem olha a tela.
 * 2) SÓ A CONTAGEM das que chegaram (`head: true`, nenhuma linha de volta).
 *    Ela existe por UM motivo: separar "nunca teve ficha assinada" de "tudo já
 *    subiu". As duas dão quadro vazio, e um quadro vazio sem explicação parece
 *    defeito — que é justamente o estado que o dono vai ver primeiro, hoje.
 *
 * Falhar aqui não derruba nada, mas TAMBÉM não passa em silêncio: `falhaCopias`
 * faz o quadro dizer que não conseguiu olhar, em vez de dizer "está tudo em
 * dia" sem ter olhado. */
async function carregarCopiasNoZoho() {
  const [pend, ent, todas] = await Promise.all([
    sbClient.from('frota_checklist_pdf')
      .select('checklist_id,situacao,tentativas,ultimo_erro,criado_em')
      .neq('situacao', 'enviado').order('criado_em').limit(200),
    sbClient.from('frota_checklist_pdf')
      .select('checklist_id', { count: 'exact', head: true }).eq('situacao', 'enviado'),
    // A terceira leitura é do HISTÓRICO, não do quadro de problemas: ele
    // precisa saber que uma ficha específica CHEGOU, e "não está na lista de
    // pendentes" não é a mesma coisa que "chegou" — a linha pode nem ter
    // entrado na fila ainda. 300 é a mesma ordem de grandeza das fichas que a
    // tela carrega (120 dias).
    sbClient.from('frota_checklist_pdf')
      .select('checklist_id,situacao,ultimo_erro,enviado_em')
      .order('criado_em', { ascending: false }).limit(300),
  ])
  // Falhar aqui não apaga o histórico: as linhas continuam, só sem a coluna de
  // "chegou no Zoho". Dizer "não chegou" porque a leitura falhou seria pior.
  copiasDetalhadas.value = todas && !todas.error ? (todas.data || []) : []
  // A contagem pode falhar sozinha sem invalidar a lista: nesse caso ela vira
  // zero e a frase cai no texto de "nenhuma ficha assinada ainda". A lista é a
  // que manda — é nela que mora o problema, se houver.
  falhaCopias.value = !!pend.error
  copiasPendentes.value = pend.error ? [] : (pend.data || [])
  copiasEntregues.value = ent && !ent.error ? (ent.count || 0) : 0
}

/* Lê a árvore de locais do Patrimônio. Fora do Promise.all de cima de propósito:
 * ela é recarregada sozinha toda vez que alguém cadastra uma marca, um local ou
 * um ambiente pelo "+" da ficha, e recarregar a frota inteira pra isso seria
 * caro à toa.
 *
 * As TRÊS leituras são conferidas, não só a primeira: uma árvore com marcas e
 * sem locais parece "marca sem local nenhum", que é uma resposta errada com cara
 * de resposta certa. Devolve `true` só quando as três vieram. */
async function carregarArvoreDeLocais() {
  const [emp, loc, com] = await Promise.all([
    sbClient.from('patrimonio_empresas').select('id,nome').order('ordem').order('nome'),
    sbClient.from('patrimonio_locais').select('id,nome,empresa_id').order('ordem').order('nome'),
    sbClient.from('patrimonio_comodos').select('id,nome,local_id').order('ordem').order('nome'),
  ])
  if (emp.error || loc.error || com.error) { falhaArvore.value = true; return false }
  falhaArvore.value = false
  empresasPat.value = emp.data || []
  locaisPat.value = loc.data || []
  comodosPat.value = com.data || []
  return true
}

const nomeDaPessoa = (id) => (pessoas.value.find((x) => x.id === id) || {}).nome || null

/* O nome de quem está por trás de uma CONTA DE LOGIN (`criada_por`,
 * `decidida_por`, `encerrada_por`), que é um id de usuário e não de colaborador.
 *
 * A regra (e o porquê de cada degrau) mora em `nome-de-quem-agiu.js`, com
 * teste. O comentário que estava aqui dizia "nada de uma leitura nova em
 * `profiles` só pra isto" — a leitura passou a existir em 18/08, por decisão do
 * dono ("sempre mostre um nome"), depois de medir que 8 das 20 contas não têm
 * ficha ligada e duas delas são admin. */
const nomeDoUsuario = (userId) => nomeDeQuemAgiu(userId, pessoas.value, perfisDeLogin.value)

// A árvore de locais do Patrimônio, no formato que `localCurto()` entende.
// `carregarArvoreDeLocais()` já roda junto com `carregar()` (linha 514), então
// ela chega antes ou junto dos carros — não é uma segunda viagem ao banco.
const arvoreDeLocais = computed(() => montarArvore({
  empresas: empresasPat.value, locais: locaisPat.value, comodos: comodosPat.value,
}))

// `pessoa_nome` aqui é quem está com o carro DE FATO (D9b), não sempre o
// dono no papel: se há posse aberta (emprestado), o nome é de quem pegou;
// senão cai no dono fixo, do jeito que já era. estadoDoVeiculo() usa este
// campo pra "Com quem" quando não há viagem aberta (posse não conta como
// viagem, de propósito — ver usoAberto() em estado-do-veiculo.js).
//
// `local_bonito` é o mesmo enriquecimento, mas pro local (B1): a árvore vence
// o `local_texto` digitado à mão, e resolver isso aqui — não dentro de
// estadoDoVeiculo() — mantém aquela função pura e livre do Patrimônio.
const linhas = computed(() => ordenarEstados(
  veiculos.value.map((v) => {
    // A reserva aprovada em vigor tira o carro dos livres (12/08/2026): a
    // Bravo Essence estava reservada pro Felipe até 24/08 e a tela continuava
    // oferecendo ela — o app aprovava a reserva e convidava outra pessoa a
    // pegar o mesmo carro.
    const segurando = reservaSegurando({
      requisicoes: requisicoes.value, veiculoId: v.id, agoraIso: new Date().toISOString(),
    })
    const dono = {
      ...v,
      pessoa_nome: nomeDaPessoa(v.pessoa_id),
      local_bonito: localCurto({ arvore: arvoreDeLocais.value, veiculo: v }),
      reservada: !!segurando,
      reservada_por: segurando ? (segurando.pessoa_nome || null) : null,
      // A MINHA reserva não me tranca fora do carro (20/08/2026). Até aqui,
      // da hora marcada em diante o carro saía de "Livres para pegar" pra todo
      // mundo — e o botão "Peguei o carro" mora dentro dessa lista. Quem
      // chegava no horário combinado não achava mais o carro na tela.
      // Só o painel de quem dirige muda: a Gestão lê `disponivel`, que
      // continua dizendo que o carro está reservado.
      reservada_para_mim: !!segurando && !!euId.value && segurando.pessoa_id === euId.value,
    }
    const quem = quemEstaComOCarro(dono, usos.value, pessoas.value)
    // `revisoes` é a QUARTA fonte de KM (D29): sem ela, 8 dos 10 carros ficam
    // sem quilometragem conhecida e a aba Revisões não tem o que calcular.
    const e = estadoDoVeiculo(
      { ...dono, pessoa_nome: quem.pessoaNome }, usos.value, fichas.value, revisoes.value,
    )
    // `porPosse` diz que quem está com o carro está por EMPRÉSTIMO, não por
    // viagem — e é ele que acende os botões de posse na Gestão. O caso real: a
    // Bravo Blackmotion está com Gabriel Alves desde 11/08 porque o dono
    // emprestou e ele esqueceu de devolver, e não havia caminho na tela pra
    // trazer de volta.
    return { ...e, porPosse: quem.porPosse }
  }),
))

/* A CONTAGEM de "na rua" saiu do resumo a pedido do dono, e o motivo importa
 * pra ninguém trazer de volta: `naRua` só conta VIAGEM aberta — posse não
 * conta, e isso está certo (D9: senão o Volvo do Humberto ficaria "na rua com
 * Humberto" pra sempre). Só que ninguém aqui registra viagem: as 9 linhas de
 * `frota_uso` são TODAS de posse, nenhuma de viagem. O número marcava 0
 * permanentemente e sugeria frota parada justamente quando 8 dos 9 carros
 * estão com motorista — pior que não mostrar nada.
 *
 * `l.naRua` CONTINUA em uso no card e no botão Devolver: o campo por veículo
 * responde certo quando alguém de fato registra uma viagem. O que não servia
 * era o TOTAL no topo. */
const livres = computed(() => linhas.value.filter((l) => l.disponivel).length)

/* ── Retirar e devolver ──────────────────────────────────────────────────── */

const ficha = ref(null)          // { modo: 'retirar'|'devolver', linha }
const form = reactive({ pessoaId: '', km: '', tanque: '', destino: '', finalidade: '', observacao: '' })
const problemas = ref([])
const gravando = ref(false)

/* ── O ACEITE DE RETIRADA: a assinatura de QUEM PEGA (13/08/2026) ────────────
 *
 * O que foi medido, e que fez isto existir: das 5 retiradas reais da Frota,
 * NENHUMA tinha a assinatura de quem pegou o carro. No único dia em que houve
 * ficha assinada — 07/08, BMW X1 — quem assinou foi Erick Martins às 7h30 e
 * quem pegou o carro foi Breno às 17h49. Como o carro "já tinha checklist
 * hoje", a tela não pedia nada a ele.
 *
 * A regra passa a ser por PESSOA (oQuePedirNaRetirada, testada em
 * checklist.js). Continua sendo UMA assinatura por viagem e NENHUM PDF a mais:
 * o aceite mora na própria viagem, não numa segunda ficha — `frota_checklist`
 * tem `unique (veiculo_id, feita_em)` de propósito, e ninguém confere o mesmo
 * carro duas vezes no mesmo dia. */
const aceiteDaRetirada = ref(null)   // os traços do rabisco, ou nulo
/* O painel do checklist DENTRO da ficha de retirada. O botão do pé da ficha
 * pede a ele a validação e a carga da gravação — é o que faz as duas coisas
 * virarem um toque só. */
const painelDaRetirada = ref(null)

/* O checklist está aberto DENTRO da ficha de retirada agora? É a mesma
 * condição do `v-if` do painel — e quem pergunta é o campo do hodômetro, que
 * some quando ela é verdadeira, e o `confirmar()`, que aí tira o KM do
 * checklist em vez do formulário. */
const checklistNaFicha = computed(() => {
  const f = ficha.value
  return !!(f && f.modo === 'retirar' && !f.avulsa
    && precisaDeChecklist({ veiculoId: f.linha.veiculo.id, fichas: fichas.value, hoje: hoje.value }))
})

/* O nome do botão do pé da ficha. Ele faz coisas diferentes conforme o que
 * está aberto, e precisa dizer qual delas. */
const rotuloDoBotaoDaFicha = computed(() => {
  const f = ficha.value
  if (!f) return 'Confirmar'
  if (f.jaAvisado) return 'Gravar assim mesmo'
  if (f.avulsa) return 'Registrar retirada'
  if (f.modo === 'retirar'
    && precisaDeChecklist({ veiculoId: f.linha.veiculo.id, fichas: fichas.value, hoje: hoje.value })
    && f.reserva) {
    return podeAssinar.value ? 'Assinar checklist e retirar o carro' : 'Gravar checklist e retirar o carro'
  }
  return 'Confirmar'
})

/** O que a ficha de retirada tem de pedir a quem está com ela aberta agora. */
const pedidoDaRetirada = computed(() => {
  if (!ficha.value || ficha.value.modo !== 'retirar') return { pedir: 'nada' }
  return oQuePedirNaRetirada({
    veiculoId: ficha.value.linha.veiculo.id,
    fichas: fichas.value,
    hoje: hoje.value,
    // Quem está PEGANDO, que nem sempre é quem está com a tela: a Gestão
    // registra retirada por outra pessoa, e nesse caso o aceite é dela.
    pessoaId: form.pessoaId || null,
    pessoaNome: form.pessoaId ? nomeDaPessoa(form.pessoaId) : null,
  })
})

/* O carro tem reserva APROVADA pra esta pessoa, agora? É o que acende o
 * "Peguei o carro" — ver reservaParaPegar() em requisicoes.js, onde a regra
 * mora testada. `usoAberto` impede o botão de continuar aceso depois de ela
 * pegar: com o carro na rua, o que ela precisa é do "Devolver". */
function podePegar(linha) {
  return !!reservaParaPegar({
    requisicoes: requisicoes.value,
    veiculoId: linha.veiculo.id,
    minhaPessoaId: euId.value,
    agoraIso: new Date().toISOString(),
    usoJaAberto: linha.naRua,
  })
}

/* REGISTRAR UMA RETIRADA QUE JÁ ACONTECEU, fora do aplicativo (21/08/2026).
 *
 * Até aqui não havia porta nenhuma: só saía carro pelo "Peguei o carro", que
 * exige reserva aprovada. Quem pegasse o carro no sábado, sem o celular na
 * mão, não tinha como registrar depois — e o carro ficava eternamente "livre"
 * numa tela que jurava que ele estava na garagem.
 *
 * NÃO PEDE CHECKLIST: ninguém confere hoje um carro que saiu sábado. A ficha
 * dessa retirada nasce marcada no histórico como "não ficou prova nenhuma", que
 * é ponta visível — o melhor que se faz com o que já passou. */
function abrirRetiradaAvulsa(linha) {
  subirCamada('ficha')
  ficha.value = { modo: 'retirar', linha, reserva: null, avulsa: true }
  aceiteDaRetirada.value = null
  Object.assign(form, {
    pessoaId: '', km: linha.km == null ? '' : String(linha.km),
    tanque: linha.tanque == null ? '' : String(linha.tanque),
    destino: '', finalidade: '', observacao: '',
    // Agora, arredondado pro minuto: é o que o <input datetime-local> aceita.
    saidaEm: new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16),
  })
  problemas.value = []
}

function abrirRetirada(linha) {
  subirCamada('ficha')
  // A RESERVA VEM JUNTO, e é ela que faz a ficha encolher: quem chegou aqui
  // pelo "Peguei o carro" já disse na reserva quem vai usar, pra onde e pra quê
  // — perguntar de novo na hora de pegar a chave é fazer digitar duas vezes o
  // mesmo (pedido do dono, 12/08/2026). Sem reserva (registro avulso pela
  // Gestão) a ficha continua inteira, porque aí ninguém respondeu nada ainda.
  const reserva = reservaParaPegar({
    requisicoes: requisicoes.value, veiculoId: linha.veiculo.id,
    minhaPessoaId: euId.value, agoraIso: new Date().toISOString(), usoJaAberto: linha.naRua,
  })
  ficha.value = { modo: 'retirar', linha, reserva }
  aceiteDaRetirada.value = null
  Object.assign(form, {
    // Da reserva quando há; do próprio usuário quando é avulso.
    pessoaId: (reserva && reserva.pessoa_id) || meuId() || '',
    saidaEm: '',
    km: linha.km == null ? '' : String(linha.km),
    tanque: linha.tanque == null ? '' : String(linha.tanque),
    destino: (reserva && reserva.destino) || '',
    finalidade: (reserva && reserva.finalidade) || '',
    observacao: '',
  })
  problemas.value = []
}
function abrirDevolucao(linha) {
  subirCamada('ficha')
  const aberto = usos.value.find((u) => u.veiculo_id === linha.veiculo.id && !u.volta_em)
  ficha.value = { modo: 'devolver', linha, uso: aberto }
  Object.assign(form, { pessoaId: '', km: '', tanque: '', destino: '', finalidade: '', observacao: '' })
  problemas.value = []
}
function fecharFicha() {
  descerCamada('ficha'); ficha.value = null; problemas.value = []
  passeioFichaAberto.value = false; aceiteDaRetirada.value = null
}

/* ── Passar o carro (F6b) ─────────────────────────────────────────────────
   Quem tem carro fixo não "retira" e "devolve" — a posse é uma linha aberta
   à parte da viagem (posse.js). Passar o carro fecha a posse de quem estava
   e abre a de quem pegou; devolver sem apontar ninguém fecha a do emprestado
   e REABRE a do dono fixo, no mesmo instante — sem buraco na linha do tempo
   (D9c). Um carro sem dono fixo (rodízio) só fecha mesmo, "livre" é o certo. */
const passando = ref(null)      // o veículo cujo passe está aberto
function abrirPasse(veiculo) {
  passando.value = veiculo; paraQuem.value = ''; nomeDeForaNoPasse.value = ''; erroPasse.value = ''
  subirCamada('passe')
}
function fecharPasse() { descerCamada('passe'); passando.value = null; paraQuem.value = ''; nomeDeForaNoPasse.value = ''; erroPasse.value = '' }
const paraQuem = ref('')        // id da pessoa escolhida, ou DE_FORA
const nomeDeForaNoPasse = ref('')
/* "Recolher pro estoque" não é uma pessoa, então não cabe na lista de gente —
 * mas é a terceira coisa que se faz com um carro emprestado, e o dono pediu.
 * Valor que nenhum identificador real teria, igual ao DE_FORA. */
const PARA_ESTOQUE = '__para_estoque__'
const avisosDoPasse = computed(() =>
  (paraQuem.value === DE_FORA ? problemasDoNomeDeFora(nomeDeForaNoPasse.value) : []))
const erroPasse = ref('')

async function confirmarPasse() {
  if (gravando.value || !passando.value) return
  // Nome de fora em branco não grava: sem nome, a posse ficaria sem ninguém
  // identificado, que é pior que não registrar.
  if (avisosDoPasse.value.some((a) => a.bloqueia)) return
  gravando.value = true
  erroPasse.value = ''
  // RECOLHER PRO ESTOQUE: fecha a posse e NÃO abre outra — nem a do responsável.
  // É o que diferencia de "devolver": devolver põe o carro de volta na mão de
  // quem responde por ele; recolher tira ele de circulação. `paraEstoque` faz
  // `passarPara` receber `donoFixo: null`, e aí ele só fecha.
  const paraEstoque = paraQuem.value === PARA_ESTOQUE

  // Fora isso, três casos: colaborador, pessoa DE FORA (id nulo, nome escrito
  // na hora), ou ninguém — e "ninguém" é o que faz `passarPara` cair no dono
  // fixo. `passarPara` já aceita `{id, nome}`, então a pessoa de fora entra sem
  // nenhuma adaptação lá dentro.
  const alvo = paraEstoque ? null : (paraQuem.value === DE_FORA
    ? { id: null, nome: nomeDeForaNoPasse.value.trim() }
    : (pessoas.value.find((p) => p.id === paraQuem.value) || null))
  const veiculo = passando.value
  const donoFixo = veiculo.pessoa_id ? { id: veiculo.pessoa_id, nome: nomeDaPessoa(veiculo.pessoa_id) } : null
  const { fechar, abrir } = passarPara({
    usos: usos.value, veiculoId: veiculo.id,
    para: alvo, donoFixo: paraEstoque ? null : donoFixo, quando: new Date().toISOString(),
  })

  if (fechar) {
    const { error: erroFechar } = await sbClient.from('frota_uso').update({ volta_em: fechar.volta_em }).eq('id', fechar.id)
    if (erroFechar) {
      // Nada foi aberto ainda — não tenta o segundo passo com o primeiro
      // falho. A tela não recarrega: recarregar aqui faria parecer que deu
      // certo, quando na verdade nada mudou.
      gravando.value = false
      erroPasse.value = 'Não consegui registrar a troca. Tente de novo — nada foi alterado.'
      return
    }
  }
  if (abrir) {
    const { error: erroAbrir } = await sbClient.from('frota_uso').insert(abrir)
    if (erroAbrir) {
      gravando.value = false
      // O MESMO defeito crítico da Tarefa 6, e aqui é pior: se o fechamento
      // gravou e a abertura falhou, o carro fica SEM posse aberta nenhuma —
      // e recarregar a tela mostraria o dono fixo como se estivesse tudo
      // certo, enquanto o carro está fisicamente com outra pessoa e a linha
      // do tempo perdeu esse trecho pra sempre. A pessoa precisa saber e agir
      // agora, não descobrir depois numa multa sem resposta.
      erroPasse.value = fechar
        ? 'A troca fechou o registro de quem estava com o carro, mas não consegui abrir o novo — '
          + 'o carro ficou SEM responsável registrado no sistema. Avise quem administra a Frota '
          + 'agora, e tente de novo em seguida.'
        : 'Não consegui registrar a troca. Tente de novo — nada foi alterado.'
      return
    }
  }
  // A SEGUNDA GRAVAÇÃO: pôr o carro em Parado (= "em estoque" no Patrimônio,
  // pela migration 042). Vem DEPOIS da posse e é conferida sozinha — "duas
  // gravações com só a primeira conferida" apareceu 4× nesta ferramenta, sempre
  // com a tela dizendo que tinha dado certo.
  //
  // Se esta falhar, a posse JÁ foi encerrada e não dá pra desfazer sem inventar
  // um empréstimo que acabou de terminar. Então a tela não finge: diz que o
  // carro está livre mas não foi pro estoque, e o que fazer. Meia verdade dita
  // é melhor que a verdade inteira escondida.
  if (paraEstoque && veiculo.situacao !== 'inativo') {
    const { data: mudou, error: erroEstoque } = await sbClient.from('frota_veiculos')
      .update({ situacao: 'inativo' }).eq('id', veiculo.id).select('id')
    if (erroEstoque || (mudou || []).length !== 1) {
      gravando.value = false
      erroPasse.value = 'Encerrei quem estava com o carro, mas NÃO consegui marcá-lo como '
        + 'parado — ele está livre em vez de em estoque. Abra a ficha do veículo e mude a '
        + 'situação para "Parado" à mão.'
      await carregar()
      return
    }
  }

  gravando.value = false
  fecharPasse()
  await carregar()
}

// Quem está logado, ligado ao colaborador. Serve de sugestão na retirada (o
// campo continua editável — quem pega pode ser outra pessoa) e é o que a área
// Motorista usa pra saber qual carro é "o meu".
//
// A REGRA MORA EM _shared/quem-loga.js, a MESMA que o robô do aviso das 7h30
// usa. Aqui havia uma cópia que só olhava o e-mail corporativo, e o robô tinha
// outra que só olhava o elo `profile_id`: a Raissa era reconhecida por esta
// tela e pulada pelo robô, calado. Duas respostas pra "quem é essa pessoa" é o
// defeito; não mudar isto pra uma comparação local de novo.
//
// A coluna chama `email_corporativo`, não `email` — a primeira versão procurava
// por `p.email`, que não existe, e sem trazer a coluna na consulta. Devolvia
// nulo SEMPRE, calada.
function meuId() {
  const eu = pessoaDoUsuario(estado.user, pessoas.value)
  return eu ? eu.id : null
}

const inteiro = (v) => { const n = parseInt(String(v).replace(/\D/g, ''), 10); return Number.isInteger(n) ? n : null }

async function confirmar() {
  const f = ficha.value
  if (!f || gravando.value) return
  // `let` porque, na retirada com checklist embutido, o KM da saída vem do
  // hodômetro do checklist — o campo do formulário nem existe nesse caso.
  let km = inteiro(form.km)
  const tanque = form.tanque === '' ? null : inteiro(form.tanque)

  if (f.modo === 'devolver') {
    problemas.value = problemasDaDevolucao({ kmSaida: f.uso ? f.uso.km_saida : null, kmVolta: km })
    // Aviso de salto grande é confirmável: a segunda tentativa grava. Bloqueio
    // de KM menor que o da saída não — esse é erro de digitação, sempre.
    const soAviso = problemas.value.length && problemas.value.every((t) => /Confirme/i.test(t))
    if (problemas.value.length && !(soAviso && f.jaAvisado)) {
      if (soAviso) f.jaAvisado = true
      return
    }
  } else {
    const faltaChecklist = precisaDeChecklist({
      veiculoId: f.linha.veiculo.id, fichas: fichas.value, hoje: hoje.value,
    })
    // Sem checklist embutido, o KM é do formulário e é trava aqui.
    if (!checklistNaFicha.value && (!Number.isInteger(km) || km <= 0)) {
      problemas.value = ['Informe o KM que está no painel agora.']
      return
    }

    /* UM TOQUE, DUAS GRAVAÇÕES, NA ORDEM CERTA (21/08/2026).
       Até aqui a ficha tinha dois botões de gravar — o do checklist, dentro
       dela, e este do pé. Quem preenchia o checklist e apertava este tirava o
       carro e perdia tudo que respondeu, sem uma palavra na tela. Aconteceu
       com o dono, com a Bravo Blackmotion.

       QUEM PEGA O PRÓPRIO CARRO RESERVADO NÃO SAI SEM CHECKLIST (decisão do
       dono): faltando item, hodômetro, senha ou assinatura, o painel escreve o
       que falta e NADA é gravado — nem o checklist, nem a viagem.

       O REGISTRO AVULSO DA GESTÃO continua podendo gravar sem checklist, e não
       é exceção de conveniência: é o único caminho para registrar o que
       aconteceu FORA do aplicativo (alguém pegou o carro no sábado, sem o
       celular na mão). Fechar essa porta não faria o checklist existir — faria
       a viagem não existir. O histórico marca essa retirada como "não ficou
       prova nenhuma", que é ponta visível em vez de ponta solta. */
    if (f.avulsa) {
      /* REGISTRO DO QUE JÁ ACONTECEU: não pede checklist, e a regra do que ele
         exige (KM e uma hora de saída que não esteja no futuro) mora em
         estado-do-veiculo.js, testada, ao lado das irmãs da devolução. */
      problemas.value = problemasDoRegistroAvulso({
        km, saidaEm: form.saidaEm, agoraIso: new Date().toISOString(),
      })
      if (problemas.value.length) return
    } else if (faltaChecklist) {
      // O KM AINDA NÃO FOI PEDIDO NESTE CAMINHO: ele vem do checklist, logo
      // abaixo. A trava de "informe o KM" já rodou lá dentro, comparando com o
      // último hodômetro conhecido — coisa que o campo da ficha nunca fez.
      // NOME PRÓPRIO, e não `painel`: já existe um `painel` no módulo (o do
      // motorista), e um const local com o mesmo nome o sombreia dentro desta
      // função inteira — inclusive ANTES desta linha. A guarda
      // `sem-sombra-de-ajudante` reprovou exatamente isso.
      const painelDoChecklist = painelDaRetirada.value
      if (!painelDoChecklist) {
        // Não deve acontecer: o painel é montado pela MESMA condição que o
        // `faltaChecklist`. Se um dia divergirem, o carro NÃO sai caladinho
        // sem checklist — a tela diz que não conseguiu montar a ficha.
        problemas.value = ['Não consegui abrir o checklist deste carro. Recarregue a página '
          + 'e tente de novo; nada foi gravado.']
        return
      }
      // `null` = o painel já escreveu na tela, campo por campo, o que falta.
      const carga = painelDoChecklist.validarEMontar()
      if (!carga) { problemas.value = []; return }
      const gravou = await gravarChecklist(carga)
      // Falhou: `gravarChecklist` já explicou o quê na tela, e nada de viagem —
      // tirar o carro depois de o checklist falhar é o defeito ao contrário.
      if (!gravou) return
      // UM NÚMERO SÓ para as duas gravações. É isto que impede a ficha e a
      // viagem de contarem quilometragens diferentes do mesmo instante.
      km = carga.ficha.hodometro
    }
    problemas.value = []
  }

  gravando.value = true
  let erro = null
  if (f.modo === 'retirar') {
    const p = pedidoDaRetirada.value
    // O ACEITE vai na MESMA gravação da viagem, e isso não é economia de
    // chamada: gravar a viagem e depois o aceite deixaria uma janela em que o
    // carro saiu e a assinatura não existe — que é exatamente o buraco que
    // este aceite veio fechar. O gatilho do banco carimba quem e quando.
    const aceite = (p.pedir === 'aceite' && aceiteDaRetirada.value && podeAssinar.value)
      ? {
        aceite_em: new Date().toISOString(),
        aceite_nome: (form.pessoaId ? nomeDaPessoa(form.pessoaId) : null) || null,
        aceite_rabisco: normalizarRabisco(aceiteDaRetirada.value),
        aceite_checklist_id: p.ficha ? p.ficha.id : null,
        // O código da ficha CONGELADO no instante do aceite: se a ficha for
        // alterada depois, o código dela muda e a divergência fica visível em
        // vez de sumir.
        aceite_checklist_hash: p.ficha ? (p.ficha.assinatura_hash || null) : null,
      }
      : {}
    const r = await sbClient.from('frota_uso').insert({
      veiculo_id: f.linha.veiculo.id,
      // A HORA REAL DA SAÍDA, só no registro avulso. Sem ela o banco carimba
      // `now()`, e uma retirada de sábado entraria como se fosse de segunda —
      // o histórico passaria a contar uma coisa que não aconteceu.
      ...(f.avulsa && form.saidaEm ? { saida_em: new Date(form.saidaEm).toISOString() } : {}),
      pessoa_id: form.pessoaId || null,
      pessoa_nome: form.pessoaId ? nomeDaPessoa(form.pessoaId) : null,
      km_saida: km,
      tanque_quartos: tanque,
      destino: form.destino || null,
      finalidade: form.finalidade || null,
      observacao: form.observacao || null,
      ...aceite,
    }).select('id').single()
    erro = r.error

    /* A RESERVA PASSA A APONTAR PRA VIAGEM. Até 13/08/2026 nada na tela fazia
       isso: `uso_id` e a situação 'usada' existiam na tabela desde o primeiro
       dia e NUNCA eram gravados. O efeito era o histórico não conseguir dizer
       qual viagem saiu de qual reserva, e a reserva ficar "aprovada" para
       sempre depois de já ter sido usada.

       Falhar aqui NÃO desfaz a viagem nem trava a pessoa no estacionamento: o
       carro saiu, e é isso que importa registrar. O elo é conveniência do
       histórico, e o histórico tem o segundo caminho (casar pela janela da
       reserva) justamente para as viagens que nasceram sem ele. */
    if (!erro && f.reserva && r.data && r.data.id) {
      await sbClient.from('frota_requisicoes')
        .update({ uso_id: r.data.id, situacao: 'usada' })
        .eq('id', f.reserva.id)
    }
  } else {
    const r = await sbClient.from('frota_uso')
      .update({ volta_em: new Date().toISOString(), km_volta: km, tanque_quartos: tanque })
      .eq('id', f.uso.id)
    erro = r.error
  }
  gravando.value = false
  if (erro) {
    // O índice único do banco é quem garante que um carro não saia duas vezes.
    // Se dois celulares registrarem ao mesmo tempo, um perde — e tem que saber.
    problemas.value = [/duplicate|unique/i.test(erro.message || '')
      ? 'Alguém registrou a retirada deste carro agora há pouco. Recarregue para ver.'
      : 'Não consegui gravar. Confira a conexão e tente de novo.']
    return
  }
  fecharFicha()
  carregar()
}

/* ── O checklist do dia (F6) ──────────────────────────────────────────────── */

// Erro PRÓPRIO do checklist, não o `falha` de carregamento: `falha` está
// numa cadeia `v-else-if` que troca a tela inteira (Motorista/Gestão) por uma
// linha de texto. Reaproveitá-lo aqui faria uma falha ao GRAVAR o checklist
// esconder a lista de carros inteira — o mesmo tipo de defeito silencioso que
// a guarda de estilo existe pra pegar, só que em comportamento, não em CSS.
const erroChecklist = ref('')
// Erro SÓ da senha, mostrado dentro do cartão, ao lado do campo. Separado de
// `erroChecklist` porque é de outra natureza: senha errada não gravou nada e a
// pessoa resolve ali mesmo, sem sair do cartão nem avisar ninguém.
const erroDaAssinatura = ref('')
// O que a tela diz DEPOIS de gravar. Precisa existir porque "gravado" e
// "gravado e assinado" são coisas diferentes, e a pessoa tem que saber qual
// das duas aconteceu com ela (D22).
const seloDoChecklist = ref('')
// Quem não tem login não assina (D22). `euId` é o id da PESSOA
// (acessos_pessoas); quem assina é o USUÁRIO (auth), e nem toda pessoa tem um —
// Barbara, Marcus e Thiago são donos de carro e não têm conta no app.
const podeAssinar = computed(() => !!estado.userId)

/* Devolve `true` só quando a ficha ficou COMPLETA no banco (respostas e, quando
 * há login, assinatura). O botão da retirada depende desta resposta pra decidir
 * se tira o carro: gravar a viagem depois de o checklist falhar seria o mesmo
 * defeito ao contrário. */
async function gravarChecklist({ ficha, respostas, assinatura }) {
  if (gravando.value) return false
  gravando.value = true
  erroChecklist.value = ''
  erroDaAssinatura.value = ''
  seloDoChecklist.value = ''

  // `estado` não tem campo `perfil` — o nome de quem preenche vem de
  // `pessoas`, do mesmo jeito que a retirada e a requisição já fazem.
  let campos = { ...ficha, pessoa_id: euId.value, pessoa_nome: euId.value ? nomeDaPessoa(euId.value) : null }
  // O que vai virar assinatura no fim. Nulo = ficha sem assinatura (D22).
  let assinar = null

  if (assinatura) {
    /* TUDO O QUE PODE RECUSAR A ASSINATURA ACONTECE ANTES DA PRIMEIRA ESCRITA.
       Senha errada não pode deixar ficha pela metade no banco — e ficha do dia
       gravada errado não dá pra refazer, o índice "um carro, um dia, uma
       ficha" recusa a segunda. */

    // 1) A senha, no SERVIDOR. `signInWithPassword` aqui TROCARIA A SESSÃO
    //    (D19a) — é a razão de a Edge `conferir-senha` existir.
    const { data: conf, error: erroConf } = await sbClient.functions.invoke('conferir-senha', {
      body: { senha: assinatura.senha },
    })
    if (erroConf || !conf?.ok) {
      // A Edge responde 429 (bloqueado), 401 (sem sessão) e 400 (sem senha)
      // FORA do 2xx, e o supabase-js transforma isso em `error` com `data`
      // NULO. Lendo o motivo só do `data`, "bloqueado por dez minutos"
      // apareceria como "senha incorreta" e a pessoa tentaria de novo sem
      // parar. O motivo real está no corpo do erro — mesmo caminho que
      // dados-conteudo.js já usa.
      const detalhe = erroConf ? await erroConf.context?.json?.().catch(() => null) : conf
      gravando.value = false
      erroDaAssinatura.value = recusaDaSenha(detalhe?.erro)
      return false
    }

    // 2) A ficha anterior DESTE carro, pra encadear.
    const { data: anteriores, error: erroAnterior } = await sbClient.from('frota_checklist')
      .select('assinatura_hash').eq('veiculo_id', ficha.veiculo_id)
      .not('assinada_em', 'is', null).order('feita_em', { ascending: false }).limit(1)
    if (erroAnterior) {
      // NÃO segue com hashAnterior nulo: nulo quer dizer "esta é a primeira
      // ficha deste carro". Gravar isso por não ter conseguido LER seria
      // afirmar uma coisa falsa dentro da própria assinatura, e partiria a
      // corrente exatamente onde ela deveria provar continuidade.
      gravando.value = false
      erroDaAssinatura.value = 'Não consegui ler a ficha anterior deste carro para encadear a '
        + 'assinatura. Confira a conexão e tente de novo. Nada foi gravado.'
      return false
    }
    const hashAnterior = anteriores?.[0]?.assinatura_hash || null

    const assinadaEm = new Date().toISOString()
    /* O RABISCO E A VERSÃO ENTRAM AQUI, no MESMO objeto da assinatura.
       Não é arrumação: este UPDATE é UMA gravação só, então ou a ficha fica
       assinada COM o desenho, ou não fica assinada. Gravar o rabisco à parte
       traria de volta o defeito que este módulo já teve quatro vezes — duas
       gravações, só a primeira conferida, e a tela dizendo que deu certo.

       `assinatura_versao: VERSAO_ATUAL` É OBRIGATÓRIO, e nunca o número 2
       escrito na mão. Sem a versão gravada, a ficha é conferida como V1: o
       texto recalculado sai SEM a linha do rabisco, o hash não fecha, e a
       conferência acusa de adulterada a ficha do próprio motorista que acabou
       de assinar. E é o MESMO valor que vai pro texto assinado logo abaixo —
       gravar um e assinar outro daria o mesmo estrago.

       O rabisco é arrumado UMA vez (`normalizarRabisco`) e o resultado serve
       aos dois: ao que é gravado e ao que é assinado. */
    const rabisco = normalizarRabisco(assinatura.rabisco)
    const versao = VERSAO_ATUAL
    assinar = {
      aberta_em: assinatura.aberta_em,
      assinada_em: assinadaEm,
      assinada_por: estado.userId,
      assinatura_hash_anterior: hashAnterior,
      assinatura_versao: versao,
      assinatura_rabisco: rabisco,
      assinatura_hash: await impressaoDigital(textoParaAssinar({
        ficha: {
          ...campos, assinada_em: assinadaEm,
          assinatura_versao: versao, assinatura_rabisco: rabisco,
        },
        respostas, hashAnterior,
      })),
    }
  } else {
    campos = { ...campos, aberta_em: null, sem_assinatura_motivo: 'sem_login' }
  }

  /* GRAVA EM TRÊS PASSOS, E A ORDEM NÃO É ESCOLHA DE ESTILO.
     O gatilho `trg_frota_resposta_imutavel` (migration 033) recusa INSERT de
     resposta em ficha JÁ assinada. Gravar a ficha assinada primeiro — que é o
     caminho óbvio — deixaria uma ficha ASSINADA E VAZIA, que não dá pra apagar
     (gatilho), não dá pra corrigir (gatilho) e não dá pra refazer (índice "um
     carro, um dia, uma ficha"): um carro com o dia perdido pra sempre.
     Provado contra o banco com `begin ... rollback`.
     Por isso: ficha SEM assinatura, respostas, e só então a assinatura por
     UPDATE — permitido porque o gatilho da ficha só dispara quando ela JÁ
     estava assinada (`when (old.assinada_em is not null)`).
     E OS TRÊS PASSOS SE CONFEREM, um a um. */
  const { data, error } = await sbClient.from('frota_checklist')
    .insert(campos).select('id').single()
  if (error) {
    gravando.value = false
    erroChecklist.value = /duplicate|unique/i.test(error.message || '')
      ? 'O checklist deste carro já foi preenchido hoje.'
      : 'Não consegui gravar o checklist. Confira a conexão e tente de novo.'
    return false
  }

  // A ficha já tem `data.id` aqui — as respostas são um segundo insert, e
  // podem falhar sozinhas (rede caiu no meio, permissão faltando). Capturar o
  // erro é OBRIGATÓRIO: sem isso a ficha fica gravada sem nenhuma resposta,
  // e a tela segue como se tivesse dado tudo certo — ninguém percebe até
  // alguém abrir o banco e ver a contagem zerada.
  //
  // `ordem: i` é o que a migration 032 pediu à tela: `id` é uuid ALEATÓRIO e
  // não dá ordem estável, mas a ORDEM DOS ITENS faz parte da impressão digital.
  // Sem gravá-la, a leitura devolveria os itens em outra ordem e a conferência
  // acusaria de adulterada uma ficha intacta.
  const { error: erroRespostas } = await sbClient.from('frota_checklist_respostas')
    .insert(respostas.map((r, i) => ({ ...r, checklist_id: data.id, ordem: i })))
  if (erroRespostas) {
    gravando.value = false
    // NÃO chama carregar(): recarregar acharia a ficha (ela gravou) e trocaria
    // o cartão pela frase "Checklist de hoje já feito" — sensação de sucesso
    // bem no caminho que falhou. A pessoa precisa ver que faltou a parte de
    // dentro, e saber a quem recorrer, porque tentar de novo bate no índice
    // "um carro, um dia, uma ficha" e é recusado como duplicidade.
    erroChecklist.value = avisoDoQueGravou({
      fichaGravada: true, respostasGravadas: false,
      assinaturaGravada: false, queriaAssinar: !!assinar,
    })
    return false
  }

  let assinaturaGravada = false
  if (assinar) {
    const { data: assinada, error: erroAssinar } = await sbClient.from('frota_checklist')
      .update(assinar).eq('id', data.id).select('id')
    // CONFERE O NÚMERO DE LINHAS, não só o `error`: um UPDATE recusado por RLS
    // volta SEM erro e com zero linha. Olhando só o `error`, a tela diria
    // "assinado" sobre uma ficha que continua sem assinatura nenhuma — que é
    // exatamente a mentira que esta fase inteira existe pra impedir.
    assinaturaGravada = !erroAssinar && (assinada?.length || 0) === 1
    if (!assinaturaGravada) {
      gravando.value = false
      erroChecklist.value = avisoDoQueGravou({
        fichaGravada: true, respostasGravadas: true,
        assinaturaGravada: false, queriaAssinar: true,
      })
      // Recarrega: diferente dos dois casos acima, aqui o checklist do dia está
      // COMPLETO e vale. O cartão deve sair da frente; o aviso fica.
      await carregar()
      return false
    }
  }

  gravando.value = false
  seloDoChecklist.value = selo({ queriaAssinar: !!assinar, assinaturaGravada })
  // Limpa a escolha de "conferir por outro carro" (D21b). O `carregar()` já
  // tiraria o carro de `paraConferir`, mas deixar o id apontando pra um carro
  // que saiu da lista faria a próxima escolha depender de ordem de execução —
  // e o cartão de outro carro pode reabrir sozinho no lugar errado.
  conferindoVeiculo.value = null
  await carregar()
  return true
}

/* ── O editor da lista e dos dias (aba Gestão, F8) ────────────────────────────
   A repartição é do GESTOR, não do código: o mecânico muda de opinião, a
   frota muda, e a lista tem que acompanhar sem depender de programador. */
// Erro de cada gravação do editor, separado porque o editor mostra cada um ao
// lado do campo que falhou. Erro engolido aqui era pior do que em outras telas:
// o editor guarda cópia local do que foi escolhido, então a tela continuava
// exibindo os dias novos e o campo do item já limpo — a cara exata de "deu
// certo" em cima de uma gravação que não aconteceu.
const erroDaConfig = ref('')
const erroDoItem = ref('')

async function salvarItemDeChecklist(dados) {
  erroDoItem.value = ''
  const { error } = await sbClient.from('frota_checklist_itens').insert(dados)
  if (error) {
    erroDoItem.value = /duplicate|unique/i.test(error.message || '')
      ? `Já existe um item chamado "${dados.item}". Edite o que existe em vez de criar outro igual.`
      : `Não consegui acrescentar "${dados.item}". Confira a conexão e clique em Acrescentar de novo `
        + '— o que você digitou continua no campo.'
    return
  }
  adminToast(`"${dados.item}" entrou na lista.`)
  carregar()
}
/* Qual item deixa o carro NÃO LIBERADO. É o dono quem decide, e a decisão dele
 * vale na hora — a ficha do motorista lê `impede_uso` direto. */
async function alternarImpedeUso(i) {
  erroDoItem.value = ''
  const novo = !i.impede_uso
  const { data, error } = await sbClient.from('frota_checklist_itens')
    .update({ impede_uso: novo }).eq('id', i.id).select('id')
  // CONTA AS LINHAS, não só o erro: um update recusado pela permissão volta sem
  // erro e sem mudar nada, e a tela diria que gravou.
  if (error || (data || []).length !== 1) {
    erroDoItem.value = `Não consegui mudar "${i.item}". Ele continua como estava.`
    return
  }
  await carregar()
}

async function alternarItemDeChecklist(i) {
  erroDoItem.value = ''
  const { error } = await sbClient.from('frota_checklist_itens')
    .update({ ativo: !i.ativo }).eq('id', i.id)
  if (error) {
    erroDoItem.value = `Não consegui ${i.ativo ? 'desligar' : 'religar'} "${i.item}". `
      + 'Confira a conexão e tente de novo — ele continua como estava.'
    return
  }
  carregar()
}
async function salvarConfigDeChecklist(cfg) {
  erroDaConfig.value = ''
  // frota_checklist_config tem UMA linha só, com chave primária `id` booleana
  // sempre verdadeira — por isso o update filtra por `id = true`, não por um
  // id de registro comum.
  const { error } = await sbClient.from('frota_checklist_config')
    .update({ dia_semanal: cfg.dia_semanal, semana_mensal: cfg.semana_mensal,
      dia_mensal: cfg.dia_mensal }).eq('id', true)
  if (error) {
    erroDaConfig.value = 'Não consegui gravar os dias. Os campos voltaram para o que está valendo '
      + 'hoje — escolha de novo e clique em Salvar os dias; se falhar outra vez, avise quem '
      + 'administra a Frota.'
    return
  }
  // Esta é a que mais precisa do aviso: gravar os dias não muda NADA na tela —
  // os mesmos números continuam nos mesmos campos.
  adminToast('Dias salvos.')
  carregar()
}

/* ── Requisição de uso (F2) ──────────────────────────────────────────────────
   O formulário de papel virando tela. A parte que o papel nunca fez: avisar do
   CONFLITO DE VIAGENS — o manual da planilha diz que os 3 dias de antecedência
   existem justamente pra isso, e cada requisição de papel é uma folha solta que
   ninguém compara com as outras. */
const requisicoes = ref([])
const podeAprovar = computed(() => hasPermission('frota.aprovar', 'ver'))

const pedido = ref(null)   // o formulário aberto, ou nulo
const pedidoForm = reactive({
  veiculoId: '', pessoaId: '', departamento: '', destino: '', finalidade: '',
  retirada: '', devolucao: '', observacao: '',
})
const avisosDoPedido = ref([])
const jaAvisado = ref(false)

// As minhas: pendentes e aprovadas ainda não usadas.
// A regra mora em requisicoes.js, testada. Até 20/08/2026 ela era este filtro
// aqui, com 'pendente' e 'aprovada' só — e a recusa, com o motivo que a tela
// OBRIGA quem recusa a escrever, não chegava em pessoa nenhuma.
const minhasRequisicoes = computed(() => meusPedidos({
  requisicoes: requisicoes.value,
  minhaPessoaId: euId.value,
  meuUsuarioId: estado.user && estado.user.id,
  agoraIso: new Date().toISOString(),
}))

// A fila de quem aprova: tudo que está pendente, de todo mundo.
const filaDeAprovacao = computed(() =>
  ordenarFila(requisicoes.value.filter((r) => r.situacao === 'pendente')))

function abrirPedido(veiculoId) {
  subirCamada('pedido')
  pedido.value = { aberto: true }
  jaAvisado.value = false
  avisosDoPedido.value = []
  Object.assign(pedidoForm, {
    veiculoId: veiculoId || '', pessoaId: euId.value || '', nomeDeFora: '', departamento: '',
    destino: '', finalidade: '', retirada: '', devolucao: '', observacao: '',
  })
}
function fecharPedido() { descerCamada('pedido'); pedido.value = null; avisosDoPedido.value = []; passeioPedidoAberto.value = false }

// <input type="datetime-local"> devolve hora LOCAL sem fuso. Mandar essa string
// crua pro banco gravaria como se fosse UTC — três horas de diferença, que é
// exatamente o tipo de erro que faz duas pessoas pegarem o mesmo carro.
const paraIso = (local) => (local ? new Date(local).toISOString() : null)

const rascunhoDoPedido = computed(() => ({
  id: null,
  veiculo_id: pedidoForm.veiculoId || null,
  // O motorista vem de `motoristaDoPedido`, que já trata o caso "de fora":
  // sem isto, a validação exigiria colaborador e barraria o Felipe.
  ...motoristaDoPedido.value,
  destino: pedidoForm.destino,
  retirada_prevista: paraIso(pedidoForm.retirada),
  devolucao_prevista: paraIso(pedidoForm.devolucao),
}))

function conferirPedido() {
  avisosDoPedido.value = [
    ...problemasDaRequisicao(
      rascunhoDoPedido.value, requisicoes.value, new Date().toISOString()),
    // O empurrão pro sobrenome de quem é de fora entra na MESMA lista que a
    // tela já mostra — um segundo lugar pra ler aviso é um lugar que ninguém lê.
    // Só os avisos que a validação geral NÃO cobre: com "de fora" escolhido e o
    // nome em branco, as duas dariam a mesma bronca em palavras diferentes, e
    // duas mensagens pro mesmo erro é o dobro de leitura pra quem tem
    // dificuldade. A geral já barra; daqui vem só o empurrão pro sobrenome.
    ...(pedidoForm.pessoaId === DE_FORA
      ? problemasDoNomeDeFora(pedidoForm.nomeDeFora).filter((x) => !x.bloqueia)
      : []),
  ]
  return avisosDoPedido.value
}

async function enviarPedido() {
  if (gravando.value) return
  const probs = conferirPedido()
  if (bloqueios(probs).length) return
  // Avisos (conflito, antecedência, data passada) pedem uma segunda confirmação
  // em vez de travar: são combinados entre pessoas, não impossibilidades.
  if (probs.length && !jaAvisado.value) { jaAvisado.value = true; return }

  gravando.value = true
  const { error } = await sbClient.from('frota_requisicoes').insert({
    veiculo_id: pedidoForm.veiculoId,
    ...motoristaDoPedido.value,
    departamento: pedidoForm.departamento || null,
    destino: pedidoForm.destino || null,
    finalidade: pedidoForm.finalidade || null,
    retirada_prevista: paraIso(pedidoForm.retirada),
    devolucao_prevista: paraIso(pedidoForm.devolucao),
    observacao: pedidoForm.observacao || null,
    criada_por: estado.user && estado.user.id,
  })
  gravando.value = false
  if (error) {
    avisosDoPedido.value = [{ bloqueia: true, texto: 'Não consegui enviar o pedido. Confira a conexão e tente de novo.' }]
    return
  }
  fecharPedido()
  carregar()
}

const decisao = ref(null)   // { requisicao, acao: 'aprovada'|'recusada' }
const motivoDaRecusa = ref('')
const erroDaDecisao = ref('')

function abrirDecisao(requisicao, acao) {
  subirCamada('decisao')
  decisao.value = { requisicao, acao }
  motivoDaRecusa.value = ''
  erroDaDecisao.value = ''
}
function fecharDecisao() { descerCamada('decisao'); decisao.value = null; erroDaDecisao.value = ''; passeioDecisaoAberto.value = false }

function porQueNaoDecido(r) {
  // `minhaPessoaId` e `meuUsuarioId` saíram daqui junto com a regra de não
  // aprovar a própria requisição (D24, 12/08/2026): quem decide agora depende
  // só da permissão e de a requisição estar pendente.
  return podeDecidir({ requisicao: r, temPermissaoAprovar: podeAprovar.value })
}

async function confirmarDecisao() {
  const d = decisao.value
  if (!d || gravando.value) return
  if (d.acao === 'recusada' && !motivoDaRecusa.value.trim()) {
    erroDaDecisao.value = 'Diga o motivo. Quem pediu precisa saber o que fazer diferente.'
    return
  }
  gravando.value = true
  const { error } = await sbClient.from('frota_requisicoes')
    .update({ situacao: d.acao, motivo_decisao: motivoDaRecusa.value.trim() || null })
    .eq('id', d.requisicao.id)
  gravando.value = false
  if (error) {
    // O gatilho do banco é quem barra de verdade: sem permissão, ou tentando
    // decidir a própria requisição. A mensagem dele já vem em português.
    erroDaDecisao.value = error.message && /aprovar|sua/i.test(error.message)
      ? error.message
      : 'Não consegui gravar a decisão. Tente de novo.'
    return
  }
  // O AVISO VEM DEPOIS, E NUNCA DESFAZ A DECISÃO. Ela já está gravada aqui; se
  // o push falhar (aparelho não registrado, aviso desligado, função fora do
  // ar), quem decidiu fica sabendo por uma frase e a reserva continua decidida.
  // Amarrar uma coisa na outra faria uma aprovação se perder por causa de um
  // aviso — o contrário do que este aviso existe pra resolver.
  avisarQuemPediu(d.requisicao.id, d.acao)
  fecharDecisao()
  carregar()
}

/* Avisa no celular de quem PEDIU que a reserva foi decidida.
 *
 * Por que uma Edge Function e não um insert daqui: mandar push exige as chaves
 * VAPID, que não podem chegar ao navegador. E o texto do aviso é montado LÁ, a
 * partir do que está gravado — se viesse daqui, qualquer pessoa logada poderia
 * mandar o push que quisesse pro celular de qualquer outra.
 *
 * Silencioso no sucesso: quem aprovou não precisa de um aviso dizendo que um
 * aviso foi mandado. Fala só quando NÃO deu — e aí diz o que fazer. */
async function avisarQuemPediu(requisicaoId, acao) {
  // `acao` é só a palavra do recado na tela ('aprovada', 'recusada',
  // 'cancelada', 'revogada'). O QUE vai no celular da pessoa é montado no
  // servidor, a partir do que está gravado — nunca do que esta tela mandar.
  try {
    const { data: { session } } = await sbClient.auth.getSession()
    const r = await fetch(`${SUPABASE_URL}/functions/v1/avisar-decisao-de-reserva`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session?.access_token || SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ requisicaoId }),
    })
    const res = await r.json().catch(() => null)
    if (!r.ok || !res || res.ok === false) {
      adminToast(`Reserva ${acao}. Não consegui avisar quem pediu — fale com a pessoa.`, false)
      return
    }
    // Decidir o PRÓPRIO pedido não precisa de aviso nenhum — mandar a pessoa
    // avisar a si mesma é o tipo de recado que faz parar de ler recado.
    if (res.motivo === 'decidiu_a_propria') { adminToast(`Reserva ${acao}.`); return }
    // ENVIADOS = 0 NÃO É SUCESSO SILENCIOSO. Sem aparelho registrado, com o
    // aviso desligado ou sem login, a pessoa não vai saber por conta própria —
    // e quem acabou de decidir é a única que pode contar pra ela.
    if (!res.enviados) {
      adminToast(`Reserva ${acao}. Quem pediu não recebe aviso no celular — avise pessoalmente.`, false)
      return
    }
    adminToast(`Reserva ${acao}. Avisei quem pediu.`)
  } catch (e) {
    adminToast(`Reserva ${acao}. Não consegui avisar quem pediu — fale com a pessoa.`, false)
  }
}

/* ── O HISTÓRICO DE RESERVAS E RETIRADAS (aba Gestão) ────────────────────────
 *
 * Desenho: docs/superpowers/specs/2026-08-13-frota-gestao-reservas-design.md
 *
 * POR QUE ISTO NASCEU. Medido no banco em 13/08/2026: 2 reservas — uma aprovada
 * e uma recusada — e NENHUMA pendente. Como a única lista da aba era a fila de
 * aprovação, e a fila só mostra pendentes, a aba Gestão exibia uma fila vazia
 * com as duas reservas invisíveis atrás dela. Não havia caminho nenhum na tela
 * pra editar, cancelar ou revogar o que já tinha sido decidido.
 *
 * A FILA CONTINUA ONDE ESTAVA. Ela é o que pede ação hoje; o histórico é o que
 * responde "o que andou acontecendo". Juntar as duas faria a decisão pendente
 * se perder no meio do passado — e o padrão da casa proíbe perder o que já
 * existia ao reorganizar. */
const filtroDoHistorico = ref('tudo')

const historico = computed(() => linhaDoTempo({
  requisicoes: requisicoes.value,
  usos: usos.value,
  veiculos: veiculos.value,
  // Sem isto, as posses da carga antiga (sem `pessoa_nome`) voltariam a
  // aparecer sem dono — era daí que saíam os 7 "motorista não informado".
  nomeDaPessoa,
  fichas: fichas.value,
  copias: copiasDetalhadas.value,
  temPermissaoAprovar: podeAprovar.value,
  agoraIso: new Date().toISOString(),
}))
/* CADA REGISTRO ABRE SÓ QUANDO ALGUÉM PEDE (21/08/2026, pedido do dono). O
 * fechado mostra o básico — `resumoCurtoDaLinha` —, e os detalhes ficam a um
 * toque. Antes, cada linha vinha inteira e a lista era um paredão.
 *
 * Um Set NOVO a cada troca: mutar o de dentro não acorda a tela. */
const detalhesAbertos = ref(new Set())
function alternarDetalhe(chave) {
  const s = new Set(detalhesAbertos.value)
  if (s.has(chave)) s.delete(chave); else s.add(chave)
  detalhesAbertos.value = s
}

const historicoFiltrado = computed(() => filtrar(historico.value, filtroDoHistorico.value))
/* MESMA ORDEM DA OUTRA LISTA: filtra, DEPOIS corta. Cortar antes faria o filtro
 * valer só sobre o pedaço que coube, e a tela mostraria menos do que existe. */
const limiteDoHistorico = ref(PRIMEIRO_DEGRAU)
const historicoNaTela = computed(() => historicoFiltrado.value.slice(0, limiteDoHistorico.value))
const verMaisHistorico = computed(() => rotuloDeVerMais(limiteDoHistorico.value, historicoFiltrado.value.length))
function mostrarMaisHistorico() {
  limiteDoHistorico.value = proximoLimite(limiteDoHistorico.value, historicoFiltrado.value.length)
}
watch(filtroDoHistorico, () => { limiteDoHistorico.value = PRIMEIRO_DEGRAU })

/* O ATALHO da retirada até o checklist assinado (pedido do dono). Ele abre a
 * MESMA ficha que o histórico de checklists abre — não é uma segunda tela com
 * a mesma coisa dentro. */
function verChecklistDaLinha(l) {
  const f = l && l.prova && l.prova.ficha
  if (f) abrirFichaDoHistorico(f)
}

/* Quantas linhas cada filtro tem — vai no rótulo do próprio botão do filtro.
 * A resposta ANTES do clique, mesma ideia dos botões rápidos que o dono já
 * aprovou: sem isso a pessoa toca em "Sem assinatura" pra descobrir se há algo
 * lá, e o filtro vira adivinhação. */
const contagemDosFiltros = computed(() => {
  const c = {}
  for (const f of FILTROS) c[f.chave] = filtrar(historico.value, f.chave).length
  return c
})

/* ── HISTÓRICO DE CHECKLISTS (D6) ───────────────────────────────────────────
 *
 * Pedido do dono: "quero uma seção também em gestão onde eu possa ver o
 * histórico de checklists feitos". Até aqui a aba só mostrava o de HOJE, e ver
 * o de ontem exigia abrir carro por carro.
 *
 * SEM CONSULTA NOVA: `fichas` já traz 120 dias, carregado em `carregar()`. Isto
 * é uma leitura diferente do que já estava na memória. */
const filtroDeFicha = ref('tudo')
const carroDaFicha = ref('')
const pessoaDaFicha = ref('')

const fichasDoHistorico = computed(() => filtrarFichas(fichas.value, {
  filtro: filtroDeFicha.value,
  veiculoId: carroDaFicha.value || null,
  pessoaNome: pessoaDaFicha.value || null,
}))
/* O HISTÓRICO MORA NO PÉ DO CARD DE HOJE (21/08/2026, pedido do dono): era
 * gaveta própria, e ir de "quem falta hoje" pra "o que foi feito" custava
 * fechar uma seção e abrir outra. Duas perguntas sobre o mesmo assunto, dois
 * lugares.
 *
 * A CONTA É FEITA NESTA ORDEM: filtra, DEPOIS corta. Cortar antes de filtrar
 * mostraria menos linha do que existe — o filtro sobraria só sobre o pedaço que
 * coube, e a tela diria "nenhuma ficha com estes filtros" tendo várias. */
const limiteDeFichas = ref(PRIMEIRO_DEGRAU)
const diasDeFicha = computed(() => agruparPorDia(
  fichasDoHistorico.value.slice(0, limiteDeFichas.value), { veiculos: veiculos.value }))
const verMaisFichas = computed(() => rotuloDeVerMais(limiteDeFichas.value, fichasDoHistorico.value.length))
function mostrarMaisFichas() {
  limiteDeFichas.value = proximoLimite(limiteDeFichas.value, fichasDoHistorico.value.length)
}
// Mexeu no filtro, volta pro primeiro degrau: continuar em 50 depois de trocar
// o recorte mostraria uma lista que a pessoa não pediu.
watch([filtroDeFicha, carroDaFicha, pessoaDaFicha], () => { limiteDeFichas.value = PRIMEIRO_DEGRAU })

/* Quem aparece no seletor de pessoa: só quem REALMENTE fez alguma ficha. Listar
 * os 31 colaboradores faria a pessoa procurar num monte de nome que nunca vai
 * devolver linha nenhuma. */
const quemFezFicha = computed(() => {
  const nomes = new Set((fichas.value || []).map((f) => (f.pessoa_nome || '').trim()).filter(Boolean))
  return [...nomes].sort((a, b) => a.localeCompare(b, 'pt-BR'))
})

/* Idem pros carros: só os que têm ficha. */
const carrosComFicha = computed(() => {
  const ids = new Set((fichas.value || []).map((f) => f.veiculo_id))
  return veiculos.value.filter((v) => ids.has(v.id))
})

/* ── Editar uma reserva ────────────────────────────────────────────────────── */

const edicao = ref(null)   // { requisicao } | null
const edicaoForm = reactive({
  veiculoId: '', pessoaId: '', nomeDeFora: '', departamento: '',
  destino: '', finalidade: '', retirada: '', devolucao: '', observacao: '',
})
const avisosDaEdicao = ref([])
const erroDaEdicao = ref('')
const jaAvisadoNaEdicao = ref(false)

/* O contrário de `paraIso`: o instante gravado virando o texto que o
 * <input type="datetime-local"> entende — que é hora LOCAL, sem fuso.
 * Sem descontar o fuso aqui, uma reserva das 8h da manhã abriria no formulário
 * como 11h, e quem só clicasse em "Salvar" empurraria a viagem três horas. */
const paraLocal = (iso) => {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  return new Date(t - new Date(t).getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

function abrirEdicao(r) {
  subirCamada('edicao')
  edicao.value = { requisicao: r }
  avisosDaEdicao.value = []
  erroDaEdicao.value = ''
  jaAvisadoNaEdicao.value = false
  Object.assign(edicaoForm, {
    veiculoId: r.veiculo_id || '',
    // Reserva de gente de fora não tem `pessoa_id`: o seletor abre em "de fora"
    // com o nome já escrito, senão editar o destino apagaria o motorista.
    pessoaId: r.pessoa_id || (r.pessoa_nome ? DE_FORA : ''),
    nomeDeFora: r.pessoa_id ? '' : (r.pessoa_nome || ''),
    departamento: r.departamento || '',
    destino: r.destino || '',
    finalidade: r.finalidade || '',
    retirada: paraLocal(r.retirada_prevista),
    devolucao: paraLocal(r.devolucao_prevista),
    observacao: r.observacao || '',
  })
}
function fecharEdicao() { descerCamada('edicao'); edicao.value = null; avisosDaEdicao.value = []; erroDaEdicao.value = '' }

const motoristaDaEdicao = computed(() => motoristaParaGravar({
  pessoaId: edicaoForm.pessoaId === DE_FORA ? null : edicaoForm.pessoaId,
  nomeDeFora: edicaoForm.pessoaId === DE_FORA ? edicaoForm.nomeDeFora : '',
  nomeDaPessoa,
}))

/* O rascunho da edição passa pela MESMA validação do pedido novo — inclusive o
 * aviso de conflito de viagens. `id` vai junto de propósito: é ele que faz
 * `conflitosDe` não acusar a reserva de conflitar com ela mesma. */
const rascunhoDaEdicao = computed(() => ({
  id: edicao.value ? edicao.value.requisicao.id : null,
  veiculo_id: edicaoForm.veiculoId || null,
  ...motoristaDaEdicao.value,
  destino: edicaoForm.destino,
  retirada_prevista: paraIso(edicaoForm.retirada),
  devolucao_prevista: paraIso(edicaoForm.devolucao),
}))

async function salvarEdicao() {
  if (!edicao.value || gravando.value) return
  avisosDaEdicao.value = problemasDaRequisicao(
    rascunhoDaEdicao.value, requisicoes.value, new Date().toISOString())
  if (bloqueios(avisosDaEdicao.value).length) return
  // Igual ao pedido novo: aviso pede uma segunda confirmação em vez de travar.
  // São combinados entre pessoas, não impossibilidades.
  if (avisosDaEdicao.value.length && !jaAvisadoNaEdicao.value) { jaAvisadoNaEdicao.value = true; return }

  gravando.value = true
  erroDaEdicao.value = ''
  const { error } = await sbClient.from('frota_requisicoes').update({
    veiculo_id: edicaoForm.veiculoId,
    ...motoristaDaEdicao.value,
    departamento: edicaoForm.departamento || null,
    destino: edicaoForm.destino || null,
    finalidade: edicaoForm.finalidade || null,
    retirada_prevista: paraIso(edicaoForm.retirada),
    devolucao_prevista: paraIso(edicaoForm.devolucao),
    observacao: edicaoForm.observacao || null,
  }).eq('id', edicao.value.requisicao.id)
  gravando.value = false
  if (error) {
    // O gatilho do banco é quem barra de verdade (sem permissão, reserva já
    // encerrada, reserva que já virou viagem) e a mensagem dele já vem escrita
    // em português dizendo o que aconteceu. Trocá-la por um texto genérico
    // jogaria fora justamente a parte que explica.
    erroDaEdicao.value = error.message || 'Não consegui salvar. Confira a conexão e tente de novo.'
    return
  }
  adminToast('Reserva salva.')
  fecharEdicao()
  carregar()
}

/* ── Cancelar e revogar ────────────────────────────────────────────────────── */

const encerramento = ref(null)   // { requisicao, acao: 'cancelada'|'revogada' } | null
const motivoDoEncerramento = ref('')
const erroDoEncerramento = ref('')

function abrirEncerramento(r, acao) {
  subirCamada('encerramento')
  encerramento.value = { requisicao: r, acao }
  motivoDoEncerramento.value = ''
  erroDoEncerramento.value = ''
}
function fecharEncerramento() {
  descerCamada('encerramento'); encerramento.value = null; erroDoEncerramento.value = ''
}

async function confirmarEncerramento() {
  const e = encerramento.value
  if (!e || gravando.value) return
  // O motivo é exigido AQUI e no banco, e os dois de propósito: aqui pra
  // pessoa não descobrir a regra pelo erro, e lá porque a tela não é a única
  // porta da tabela.
  if (!motivoDoEncerramento.value.trim()) {
    erroDoEncerramento.value = e.acao === 'cancelada'
      ? 'Escreva por que está cancelando. Quem pediu o carro precisa saber.'
      : 'Escreva por que está revogando. Quem está com a reserva precisa saber.'
    return
  }
  gravando.value = true
  const { error } = await sbClient.from('frota_requisicoes')
    .update({ situacao: e.acao, encerrada_motivo: motivoDoEncerramento.value.trim() })
    .eq('id', e.requisicao.id)
  gravando.value = false
  if (error) {
    erroDoEncerramento.value = error.message || 'Não consegui gravar. Confira a conexão e tente de novo.'
    return
  }
  // O MESMO AVISO DA DECISÃO. Esta tela exige o motivo escrito com a frase
  // "quem pediu o carro precisa saber" / "quem está com a reserva precisa
  // saber" — e até aqui não havia nada que fizesse esse motivo chegar na
  // pessoa. Revogar é o caso mais grave dos dois: a reserva já valia, e quem
  // não for avisado vai até o estacionamento buscar um carro que não é mais
  // dela.
  avisarQuemPediu(e.requisicao.id, e.acao)
  fecharEncerramento()
  carregar()
}

/* ── ARQUIVAR: sai da lista, não sai do banco (D4) ───────────────────────────
 *
 * Pedido do dono: "solicitações recusadas eu quero poder excluir para limpar
 * espaço". Escolha dele, depois de ver o que se perderia: arquivar em vez de
 * apagar. O motivo escrito da recusa e quem decidiu continuam guardados, e
 * voltam pelo filtro "Arquivadas".
 *
 * A trava está no gatilho (migration 047) — pendente e aprovada o BANCO recusa.
 * Aqui só se evita oferecer o botão. E `arquivada_por` não é gravado por esta
 * função de propósito: quem carimba é o gatilho, que é onde a mudança acontece.
 */
const arquivando = ref(null)     // id da reserva em trânsito
const erroDeArquivar = ref('')

async function mudarArquivamento(reserva, arquivar) {
  if (!reserva || arquivando.value) return
  arquivando.value = reserva.id
  erroDeArquivar.value = ''
  const { data, error } = await sbClient.from('frota_requisicoes')
    .update({ arquivada_em: arquivar ? new Date().toISOString() : null })
    .eq('id', reserva.id)
    .select('id')
  arquivando.value = null

  if (error) {
    erroDeArquivar.value = error.message || 'Não consegui gravar. Confira a conexão e tente de novo.'
    return
  }
  /* ZERO LINHA É FALHA, NÃO SUCESSO. O PostgREST responde 200 com lista vazia
   * quando o RLS barra a escrita — sem esta conferência a tela diria "arquivei"
   * e o cartão voltaria no próximo carregamento, do jeito que estava. Este
   * projeto já pagou por essa lição. */
  if (!data || data.length === 0) {
    erroDeArquivar.value = arquivar
      ? 'Não consegui arquivar: o banco não deixou. Você tem permissão para aprovar reservas?'
      : 'Não consegui desarquivar: o banco não deixou.'
    return
  }
  carregar()
}

/* ── Revisões (F4) ───────────────────────────────────────────────────────────
   O plano diz de quantos em quantos km cada item se troca; o histórico diz
   quando cada um foi trocado em cada carro; e o KM vem sozinho das devoluções.
   Com os três, o alerta se calcula — que é o que a aba "Alertas" da planilha
   nunca conseguiu, porque o KM dela dependia de alguém digitar. */
const plano = ref([])
const revisoes = ref([])

// Só os itens ATIVOS do plano — a mesma condição que revisoesDoVeiculo já usa
// por dentro (revisoes.js). Existe pra a frase "Toque no carro para ver os N
// itens do plano" (mais abaixo, na aba Revisões) e a conta de revisoesDoVeiculo
// partirem da MESMA lista: antes, a frase contava `plano.length` (todos,
// inclusive desligados) enquanto revisoesDoVeiculo já filtrava por dentro —
// desativar um item prometia N itens e entregava N-1.
const planoAtivo = computed(() => plano.value.filter((p) => p.ativo !== false))

// A aba Revisões mostra SÓ O QUE ESTÁ CHEGANDO (correção do dono). Listar
// todos os itens de todos os carros virava uma parede de "em dia" onde o que
// importa se perdia. Item em dia, sem registro ou sem quilometragem não é
// notícia — quem quiser o histórico completo abre a ficha do carro na Gestão.
const revisoesPorVeiculo = computed(() => linhas.value.map((l) => {
  const todos = revisoesDoVeiculo({
    veiculo: l.veiculo, kmAtual: l.km, plano: planoAtivo.value, revisoes: revisoes.value,
  })
  const itens = todos.filter((i) => i.situacao === 'vencida' || i.situacao === 'perto')
  return { linha: l, itens, resumo: resumoDeRevisoes(todos) }
})
  .filter((r) => r.itens.length)
  .sort((a, b) => {
    const ordem = { vencida: 0, perto: 1 }
    return (ordem[a.resumo.nivel] ?? 9) - (ordem[b.resumo.nivel] ?? 9)
  }))

// TODOS os itens de TODOS os carros (D30). A aba Revisões passou a mostrar
// tudo: o dono pediu, e a razão é medida — com 8 dos 10 carros sem
// quilometragem conhecida, filtrar por "vencida ou perto" deixava a aba vazia
// e sugeria frota em dia justamente quando não se sabe nada sobre ela.
//
// Só o `alienado` ("fora da frota") é excluído — carro vendido/devolvido não
// tem mais dono aqui pra revisar. `em_manutencao` e `inativo` continuam:
// ainda são carros da empresa, e é justamente parado que a revisão atrasada
// se resolve, não escondida.
const revisoesDeTodosOsCarros = computed(() => ordenarCarrosPorUrgencia(
  linhas.value.filter((l) => l.veiculo.situacao !== 'alienado').map((l) => {
    const todos = revisoesDoVeiculo({
      veiculo: l.veiculo, kmAtual: l.km, plano: planoAtivo.value, revisoes: revisoes.value,
    })
    return { linha: l, itens: todos, resumo: resumoDeRevisoes(todos) }
  }),
))

// O editor de limiares: o dono acrescenta e ajusta sem depender de programador,
// porque quem muda de opinião é o mecânico.
const itemEmEdicao = ref(null)
const itemForm = reactive({ item: '', aCadaKm: '', observacao: '' })
const errosDoItem = ref([])

function abrirItem(p) {
  subirCamada('item')
  itemEmEdicao.value = p || { novo: true }
  errosDoItem.value = []
  Object.assign(itemForm, {
    item: p ? p.item : '', aCadaKm: p ? String(p.a_cada_km) : '', observacao: (p && p.observacao) || '',
  })
}
function fecharItem() { descerCamada('item'); itemEmEdicao.value = null; errosDoItem.value = []; passeioItemAberto.value = false }

async function salvarItem() {
  if (gravando.value) return
  const km = parseInt(String(itemForm.aCadaKm).replace(/\D/g, ''), 10)
  errosDoItem.value = problemasDoItem({
    item: itemForm.item, aCadaKm: km,
    existentes: plano.value, idAtual: itemEmEdicao.value && itemEmEdicao.value.id,
  })
  if (errosDoItem.value.length) return

  gravando.value = true
  const dados = { item: itemForm.item.trim(), a_cada_km: km, observacao: itemForm.observacao.trim() || null }
  const r = itemEmEdicao.value.novo
    ? await sbClient.from('frota_plano_revisao').insert({ ...dados, ordem: plano.value.length + 1 })
    : await sbClient.from('frota_plano_revisao').update(dados).eq('id', itemEmEdicao.value.id)
  gravando.value = false
  if (r.error) { errosDoItem.value = ['Não consegui gravar. Tente de novo.']; return }
  adminToast(itemEmEdicao.value.novo ? 'Item acrescentado.' : 'Item salvo.')
  fecharItem()
  carregar()
}

async function alternarItem(p) {
  const { error } = await sbClient.from('frota_plano_revisao').update({ ativo: !p.ativo }).eq('id', p.id)
  // A falha era ENGOLIDA: sem `carregar()` o interruptor voltava sozinho para
  // onde estava e a tela não dizia uma palavra — a pessoa clicava de novo
  // achando que tinha errado o dedo.
  if (error) { adminToast(`Não consegui ${p.ativo ? 'desligar' : 'religar'} "${p.item}". Ele continua como estava.`, false); return }
  carregar()
}

// O link de WhatsApp do contato do carro. Já leva o modelo e a placa escritos:
// quem recebe atende sabendo de qual carro se fala, sem precisar perguntar.
function zapDoVeiculo(v) {
  if (!v) return null
  return linkDoWhatsapp(v.contato_telefone, `Olá! É sobre o ${v.nome} (${v.placa}).`)
}

// A OFICINA é um contato à parte (correção do dono): ela se procura quando o
// carro precisa de revisão, e o contato geral quando o problema é outro.
// A mensagem já leva a quilometragem, que é a primeira coisa que o mecânico
// pergunta.
function zapDaOficina(v, km) {
  if (!v) return null
  const quilometragem = Number.isInteger(km) ? ` Está com ${km.toLocaleString('pt-BR')} km.` : ''
  return linkDoWhatsapp(v.oficina_telefone, `Olá! É sobre o ${v.nome} (${v.placa}).${quilometragem}`)
}

/* ── A ficha do veículo (aba Gestão) ─────────────────────────────────────────
   Tudo do carro num lugar só: identificação, contrato, seguro, tag de pedágio,
   rastreador, a ligação com o Patrimônio, quem é o responsável, e o histórico
   de manutenção. Pedido do dono — antes só dava pra ver, não pra mexer. */
const veiculoAberto = ref(null)
const vForm = reactive({})
const errosDoVeiculo = ref([])
const CAMPOS_VEICULO = [
  'nome', 'placa', 'marca', 'ano', 'cor', 'combustivel', 'renavam', 'chassi', 'tipo_oleo',
  'contrato', 'codigo_patrimonial', 'categoria_comercial', 'situacao', 'pessoa_id',
  // `local_texto` CONTINUA na lista, e não é sobra: é o que estava escrito à mão
  // antes da árvore existir ("Casa RB", "Conchal", "Barracão", em 5 dos 9
  // carros). Ele é lido pra ficha e gravado de volta do jeito que estava —
  // apontar o local NÃO o apaga. É a única pista de onde o carro estava, e
  // apagá-la ao gravar o local certo perderia essa pista pra sempre, sem volta.
  'local_texto',
  // De quem é o carro (empresa_id) e onde ele fica (local_id/comodo_id) são
  // perguntas DIFERENTES, e por isso são campos diferentes — decisão do dono:
  // um carro da RBV Company pode passar a semana guardado na Fábrica Conchal da
  // Vessel sem virar patrimônio da Vessel. Nada aqui deduz um do outro.
  'empresa_id', 'local_id', 'comodo_id',
  'seguro_seguradora', 'seguro_apolice', 'seguro_vence_em', 'tag_pedagio', 'rastreador',
  'contato_nome', 'contato_telefone', 'contato_papel',
  'oficina_nome', 'oficina_telefone',
  'bem_id', 'observacao',
]

// Os bens do Patrimônio (qualquer categoria) — a lista do seletor de ligação.
const bensVeiculo = ref([])
// O id da categoria "Veículos", só pra filtrar bensLivres (ver carregar()).
const categoriaVeiculoId = ref(null)

// Os bens que "Acrescentar veículo" pode oferecer pra puxar dados: só
// Veículos, e só os que NENHUM carro da frota já aponta — ver bens-para-
// veiculo.js. Recalcula sozinho quando alguém liga outro bem por aqui, então
// o bem que acabou de ser usado some da lista pro próximo carro.
const bensLivres = computed(() =>
  bensLivresParaFrota(bensVeiculo.value, veiculos.value, categoriaVeiculoId.value))

/* O NÚMERO DE PATRIMÔNIO, e o aviso sobre ele.
 *
 * A tela não sugere número (decisão do dono, 20/08/2026): quem cadastra tem o
 * adesivo na mão. O que ela faz é contar o que o número digitado JÁ É, antes de
 * gravar — e quem responde isso é `etiqueta_quem_e` no BANCO, não uma conta
 * aqui: quem só tem a Frota não lê `patrimonio_bens` de forma confiável (a RLS
 * de leitura é por equipe), então a conta local mentiria em silêncio pra ele. */
const avisoEtiqueta = ref(null)
const conferindoEtiqueta = ref(false)

async function conferirEtiqueta() {
  const et = validarEtiqueta(vForm.etiqueta, { obrigatoria: false })
  if (!et.ok) { avisoEtiqueta.value = { tom: 'ruim', texto: et.erro }; return }
  if (et.numero === null) { avisoEtiqueta.value = null; return }

  conferindoEtiqueta.value = true
  const { data, error } = await sbClient.rpc('etiqueta_quem_e', { p_numero: et.numero })
  conferindoEtiqueta.value = false
  // Falhou a consulta? Fica CALADA. Um "número livre" dito por engano faria a
  // pessoa colar adesivo repetido — e a gravação ainda vai conferir de novo no
  // banco, então não se perde a trava, só o aviso adiantado.
  avisoEtiqueta.value = error ? null : avisoDaEtiqueta(data, vForm.placa)
}

/* O que a sincronia com o Patrimônio fez, em português. Nulo = nada a dizer. */
const seloDaSincronia = ref(null)

function abrirVeiculo(v) {
  subirCamada('veiculo')
  veiculoAberto.value = v
  errosDoVeiculo.value = []
  // A conferência do carro ANTERIOR não pode sobrar na tela do próximo: um
  // "conferem" verde herdado seria dito sobre um carro que ninguém conferiu.
  conferencia.value = null
  for (const c of CAMPOS_VEICULO) vForm[c] = v[c] ?? ''
  // A ETIQUETA NÃO É COLUNA DE `frota_veiculos` — é o número do item do outro
  // lado. Mas o `codigo_patrimonial` que já está na ficha muitas vezes É esse
  // número: medido em 20/08, os três KWIDs novos carregam "298", "299", "300".
  // Os nove antigos carregam "RBB-004", e `etiquetaDoCodigo` devolve nulo pra
  // esses de propósito — sugerir o 4 dali ligaria o carro num Macbook.
  vForm.etiqueta = v.bem_id ? '' : (etiquetaDoCodigo(v.codigo_patrimonial) ?? '')
  vForm.comoFica = ''
  avisoEtiqueta.value = null
  seloDaSincronia.value = null
  vForm.aluguel = v.aluguel_centavos == null ? '' : (v.aluguel_centavos / 100).toString()
  vForm.fipe = v.fipe_centavos == null ? '' : (v.fipe_centavos / 100).toString()
  vForm.seguroValor = v.seguro_valor_centavos == null ? '' : (v.seguro_valor_centavos / 100).toString()
}

// Abre a MESMA ficha, vazia (F9): antes só existia abrirVeiculo() pra editar
// um carro que já tem `id` — não havia caminho nenhum pra cadastrar o
// primeiro. `{ novo: true }` marca o modo pro template (esconde Responsável,
// Situação e Histórico de manutenção, que não fazem sentido pra um carro que
// ainda nem foi gravado) e pra salvarVeiculo() (grava por insert, não update).
function abrirVeiculoNovo() {
  subirCamada('veiculo')
  veiculoAberto.value = { novo: true }
  errosDoVeiculo.value = []
  conferencia.value = null
  for (const c of CAMPOS_VEICULO) vForm[c] = ''
  // COMO O CARRO FICA passou a ser PERGUNTA, não decisão da tela (20/08/2026).
  // Até aqui todo carro nascia 'ativo' e sem dono fixo, e a ficha nem mostrava
  // os campos pra mudar isso; o dono pediu o contrário — que a resposta seja
  // obrigatória na hora. Nasce VAZIA de propósito: um valor pré-escolhido
  // viraria a resposta de quem só apertou Gravar sem ler.
  vForm.comoFica = ''
  vForm.situacao = ''
  vForm.etiqueta = ''
  vForm.aluguel = ''
  vForm.fipe = ''
  vForm.seguroValor = ''
  avisoEtiqueta.value = null
  seloDaSincronia.value = null
}
function fecharVeiculo() { descerCamada('veiculo');
  veiculoAberto.value = null
  errosDoVeiculo.value = []
  passeioVeiculoAberto.value = false
  erroDaArvore.value = ''
  conferencia.value = null
}

/* ── CONFERIR AS ASSINATURAS DESTE CARRO (D21) ────────────────────────────────
 * Sem isto o encadeamento é enfeite: garantia que ninguém verifica não é
 * garantia. Lê a corrente inteira do carro pelo banco e recalcula cada
 * impressão digital com a MESMA função que assinou — duas contas diferentes
 * seriam duas verdades sobre o que foi assinado.
 *
 * MEDIDO CONTRA O BANCO, não deduzido: os dez campos e as respostas voltam
 * idênticos ao que foi gravado; o único que o Postgres reescreve é
 * `assinada_em` (`.000Z` vira `+00:00`), e a canonização do instante em
 * assinatura.js absorve isso. Se algum outro campo passasse a ser reescrito,
 * esta tela acusaria de adulterada uma ficha honesta.
 *
 * O RABISCO (F7c) É JSONB e volta como número, não como texto — as coordenadas
 * são gravadas já arredondadas em 3 casas (rabisco.js), que é a mesma conta que
 * `assinatura.js` faz pra montar o texto assinado. Por isso a ida e a volta dão
 * o mesmo valor, e nada muda de hash no caminho. */
const conferindo = ref(false)
const conferencia = ref(null)

async function conferirAssinaturas(veiculo) {
  if (conferindo.value || !veiculo || veiculo.novo) return
  conferindo.value = true
  conferencia.value = null
  /* AS DUAS LEITURAS SÃO UMA CONFERÊNCIA SÓ, e a segunda não é enfeite.
     A função do banco `frota_corrente_do_veiculo` (migration 032) nasceu antes
     do rabisco e devolve uma lista FIXA de colunas — sem `assinatura_versao` e
     sem `assinatura_rabisco`. Conferindo só com o que ela devolve, toda ficha
     assinada a partir de agora seria lida como V1: o texto sairia sem a linha
     do rabisco, o hash não fecharia, e a tela acusaria de ADULTERADA a ficha de
     quem acabou de assinar direitinho. As duas colunas vêm da tabela, e são
     casadas por `id`. */
  const [{ data, error }, { data: extras, error: erroExtras }] = await Promise.all([
    sbClient.rpc('frota_corrente_do_veiculo', { p_veiculo: veiculo.id }),
    sbClient.from('frota_checklist')
      .select('id, assinatura_versao, assinatura_rabisco').eq('veiculo_id', veiculo.id),
  ])
  conferindo.value = false
  if (error || erroExtras) {
    // Erro de leitura NÃO vira "nada a conferir" nem acusação (item 9 do
    // padrão): a tela diz que não conseguiu ler, e nada mais.
    conferencia.value = textoDaConferencia(null)
    return
  }
  const porId = new Map((extras || []).map((e) => [e.id, e]))
  const fichas = []
  for (const f of data || []) {
    const extra = porId.get(f.id)
    if (!extra) {
      // Ficha na corrente e não na outra leitura: as duas saíram da MESMA
      // tabela na mesma sessão, então isto não deveria acontecer. Se acontecer,
      // conferir assim mesmo seria chutar a versão dela — e chutar errado
      // acusa um inocente. Melhor dizer que não deu pra ler.
      conferencia.value = textoDaConferencia(null)
      return
    }
    fichas.push({
      ...f,
      assinatura_versao: extra.assinatura_versao,
      assinatura_rabisco: extra.assinatura_rabisco,
    })
  }
  /* `respostas` AUSENTE e `[]` não são a mesma coisa pra conferirCorrente:
     array vazio é um fato sobre a ficha, chave ausente é falha de leitura de
     quem chamou. Por isso a chave só entra quando veio mesmo um array — um
     `|| []` aqui transformaria "não consegui ler" em "não tinha item nenhum",
     e a ficha honesta sairia acusada. */
  const porFicha = {}
  for (const f of fichas) if (Array.isArray(f.respostas)) porFicha[f.id] = f.respostas
  conferencia.value = textoDaConferencia(await conferirCorrente(fichas, porFicha))
}

/* O "+" da árvore, dentro da ficha do carro. Mesma ideia do "+" do Patrimônio:
 * sem ele, quem só edita a ficha TRAVA quando o local que precisa ainda não
 * está cadastrado — e o jeito de destravar era digitar texto solto, que é
 * justamente o defeito que esta troca veio matar.
 *
 * Grava numa tabela e RELÊ a árvore. São duas idas ao banco, e as DUAS são
 * conferidas: este projeto já teve quatro defeitos do tipo "gravou, a releitura
 * falhou em silêncio, e a tela disse que deu certo". Se a releitura falhar, o
 * recado diz que o cadastro foi feito mas a lista não voltou — e a caixinha do
 * "+" continua aberta, porque o nome novo não apareceu nas props. */
const criandoNaArvore = ref(false)
const erroDaArvore = ref('')

async function criarNaArvore({ nivel, nome, empresaId, localId }) {
  if (criandoNaArvore.value) return
  criandoNaArvore.value = true
  erroDaArvore.value = ''

  const pedido = insertDaArvore({ nivel, nome, empresaId, localId })
  if (!pedido) {
    criandoNaArvore.value = false
    erroDaArvore.value = 'Não consegui cadastrar: faltou o nome, ou faltou dizer em que '
      + 'marca (ou em que local) essa opção nova entra.'
    return
  }

  const { error } = await sbClient.from(pedido.tabela).insert(pedido.dados)
  if (error) {
    criandoNaArvore.value = false
    erroDaArvore.value = 'Não consegui cadastrar. Tente de novo; se continuar falhando, '
      + 'confirme se você tem permissão para editar as listas do Patrimônio.'
    return
  }

  const releu = await carregarArvoreDeLocais()
  criandoNaArvore.value = false
  if (!releu) {
    erroDaArvore.value = 'Cadastrei, mas não consegui recarregar a lista de locais. '
      + 'Recarregue a página para vê-lo aparecer.'
  }
}

/* CADASTRO RÁPIDO DE COLABORADOR (13/08/2026). Mesmo contrato do "+" da árvore
 * de locais: quem grava é a tela; o componente só avisa e espera o nome
 * aparecer. `criar_pessoa_rapida` devolve `ja_existia` quando o nome já estava
 * lá — a checagem mora no banco porque duas janelas cadastrando ao mesmo tempo
 * é o caso que a tela sozinha não cobre.
 *
 * Quatro campos de pessoa nesta tela — Responsável, Quem vai dirigir, Quem vai
 * usar, Passar para —, então `campo` marca qual deles pediu a criação. O aviso
 * de erro e o "Criando…" pertencem a ELE, não à tela: com um só `erroDePessoa`
 * compartilhado, uma falha num campo apareceria nos outros três.
 *
 * SEM try/catch DE PROPÓSITO, nas três funções abaixo: o supabase-js v2 não
 * rejeita a promessa quando o fetch falha — ele DEVOLVE `{ error }`, que é
 * justamente o que estas funções já tratam. E o `criandoPessoa = false` vem
 * ANTES do `await carregar()`, então nem um erro no recarregamento deixa o
 * botão preso em "Criando…". Um try/catch aqui não pegaria nada e só esconderia
 * o caminho de erro que existe. */
async function criarPessoaRapida({ nome, cargo, marcaId, setorId }, campo) {
  if (criandoPessoa.value) return
  criandoPessoa.value = true
  erroDePessoa.value = ''
  avisoDeCriacao.value = ''
  campoDeCriacao.value = campo

  const { data, error } = await sbClient.rpc('criar_pessoa_rapida', {
    p_nome: nome, p_cargo: cargo, p_marca_id: marcaId, p_setor_id: setorId,
  })
  criandoPessoa.value = false
  if (error) {
    erroDePessoa.value = 'Não consegui cadastrar. Tente de novo; se continuar, confirme '
      + 'com quem administra se você pode cadastrar colaborador.'
    return
  }
  const criada = Array.isArray(data) ? data[0] : data
  await carregar()
  // A linha devolvida é LIDA, e não jogada fora: o Patrimônio faz a mesma
  // chamada e conta o que aconteceu, e as duas telas não podem dizer coisas
  // diferentes sobre a mesma ação. `campoDeCriacao` continua apontando pra
  // este campo (não zera mais aqui) porque é ele quem decide, lá no template,
  // qual EscolhaDePessoa recebe este aviso pela prop `aviso` — e a caixinha já
  // fechou sozinha (watch de `pessoas` no componente) ANTES deste ponto, então
  // um recado escrito dentro dela (como `erroDePessoa` fazia antes) nunca
  // chegava a aparecer. É o item D do fix de 13/08/2026.
  if (criada && criada.ja_existia) {
    avisoDeCriacao.value = `«${criada.nome}» já estava cadastrada — deixei essa selecionada.`
  } else if (criada) {
    avisoDeCriacao.value = `«${criada.nome}» cadastrada`
  }
}

async function criarSetorRapido({ nome }, campo) {
  if (criandoPessoa.value) return
  criandoPessoa.value = true
  erroDePessoa.value = ''
  campoDeCriacao.value = campo
  const { error } = await sbClient.rpc('criar_setor_rapido', { p_nome: nome })
  criandoPessoa.value = false
  if (error) { erroDePessoa.value = 'Não consegui cadastrar o setor. Tente de novo.'; return }
  campoDeCriacao.value = ''
  await carregar()
}

async function criarMarcaRapida({ nome }, campo) {
  if (criandoPessoa.value) return
  criandoPessoa.value = true
  erroDePessoa.value = ''
  campoDeCriacao.value = campo
  const { error } = await sbClient.from('patrimonio_empresas')
    .insert({ nome, ordem: (empresasPat.value || []).length + 1 })
  criandoPessoa.value = false
  if (error) { erroDePessoa.value = 'Não consegui cadastrar a marca. Tente de novo.'; return }
  campoDeCriacao.value = ''
  await carregarArvoreDeLocais()
}

// Abrir a caixinha começa uma tentativa nova: o aviso da tentativa anterior
// não pertence a ela.
function limparAvisoDeCriacao() {
  erroDePessoa.value = ''
  avisoDeCriacao.value = ''
  campoDeCriacao.value = ''
}

// Escolher um bem no seletor de ligação, enquanto cria, também sugere nome,
// marca, FIPE e código patrimonial pra ficha (patchDoBem só preenche o que
// ainda está vazio — nunca apaga o que a pessoa já tinha digitado). Editando
// um carro que já existe, o seletor só liga: reabrir a ficha de um carro
// pronto não deveria reescrever os dados dele.
function aoEscolherBem() {
  if (!veiculoAberto.value || !veiculoAberto.value.novo) return
  const bem = bensLivres.value.find((b) => b.id === vForm.bem_id)
  if (!bem) return
  Object.assign(vForm, patchDoBem(vForm, bem))
}

/* Dinheiro em centavos, sempre — float com centavo vira erro de arredondamento
 * que ninguém acha depois.
 *
 * A CONTA MUDOU em 12/08/2026, e o motivo importa: a versão anterior apagava
 * TODO ponto como separador de milhar antes de olhar a vírgula, então um
 * aluguel digitado `4500.00` virava R$ 450.000,00 — cem vezes o valor, gravado
 * em silêncio, nos campos de aluguel, FIPE e seguro que já estavam no ar. E não
 * era caso raro: o teclado que `inputmode="decimal"` abre no celular oferece
 * PONTO. Agora delega pra `centavos()` (lancamento-de-manutencao.js), que trata
 * o ÚLTIMO separador como a vírgula decimal e tem a tabela de formas reais
 * travada em teste.
 *
 * Aqui, valor ilegível continua virando `null` pra não mudar o comportamento
 * destes três campos numa fase que é sobre manutenção. Na ficha de lançamento,
 * ilegível BARRA — ver `valoresIlegiveis` lá. */
const centavosDe = (v) => {
  const c = centavos(v)
  return c === VALOR_INVALIDO ? null : c
}

async function salvarVeiculo() {
  if (gravando.value) return
  const criando = !!(veiculoAberto.value && veiculoAberto.value.novo)

  // CADASTRO NOVO cobra os quatro obrigatórios de uma vez (decisão do dono,
  // 20/08/2026): nome, placa, nº de patrimônio e como o carro fica. Numa volta
  // só, pra pessoa ver tudo que falta em vez de descobrir um erro por tentativa.
  // A conta mora em etiqueta-do-veiculo.js, testada.
  if (criando) {
    const erros = validarCadastro(vForm)
    if (erros.length) { errosDoVeiculo.value = erros; return }
  } else if (!String(vForm.nome || '').trim() || !String(vForm.placa || '').trim()) {
    errosDoVeiculo.value = ['Nome e placa são obrigatórios — é por eles que o carro é reconhecido.']
    return
  }
  gravando.value = true
  const dados = {}
  for (const c of CAMPOS_VEICULO) dados[c] = vForm[c] === '' ? null : vForm[c]
  dados.placa = normalizarPlaca(vForm.placa)
  dados.ano = vForm.ano ? parseInt(vForm.ano, 10) : null
  dados.aluguel_centavos = centavosDe(vForm.aluguel)
  dados.fipe_centavos = centavosDe(vForm.fipe)
  dados.seguro_valor_centavos = centavosDe(vForm.seguroValor)
  // O "onde fica" vem de uma função testada, e não do laço genérico acima, por
  // uma razão só: é ela que garante que `local_texto` volta INTACTO ao gravar o
  // local escolhido. Escrito solto aqui no meio, um "aproveita e limpa o texto
  // velho" entraria em qualquer revisão futura sem ninguém notar — e o texto é
  // a única pista de onde o carro estava. Ver local-do-veiculo.js.
  Object.assign(dados, dadosDoLocal({
    empresaId: vForm.empresa_id,
    localId: vForm.local_id,
    comodoId: vForm.comodo_id,
    textoAntigo: vForm.local_texto,
  }))
  dados.atualizado_em = new Date().toISOString()

  if (criando) {
    // Decisão do dono, fixada aqui de novo (o template já esconde os campos
    // pra mudar isso): o carro nasce ativo e sem dono fixo. Forçar os dois
    // valores no dado gravado — em vez de confiar só no template escondido —
    // é o que garante a regra mesmo se algum campo escapar por engano.
    //
    // É também o que evita a dança de posse (trocarDonoFixo, abaixo): ela
    // precisa do `id` do veículo pra abrir uma posse nova, e um carro que
    // ainda não foi gravado não tem id. Sem dono na criação, não há posse pra
    // abrir — quem quiser dar dono usa a ficha depois, num carro que já
    // existe, pelo caminho de sempre.
    // COMO O CARRO FICA, respondido no cadastro (20/08/2026). Até aqui o carro
    // nascia sempre 'ativo' e sem dono fixo, e quem quisesse outra coisa tinha
    // que reabrir a ficha. `comoFicaParaDados` traduz a escolha nas duas colunas
    // — e devolve nulo pra escolha desconhecida, que `validarCadastro` acima já
    // barrou. O `||` aqui é cinto de segurança, não regra: 'ativo' chutado num
    // carro parado o deixaria disponível pra qualquer um pegar.
    Object.assign(dados, comoFicaParaDados(vForm.comoFica, vForm.pessoa_id)
      || { situacao: 'ativo', pessoa_id: null })

    const { error } = await sbClient.from('frota_veiculos').insert(dados)
    if (error) {
      gravando.value = false
      // Placa é UNIQUE no banco (migration 022): duas pessoas cadastrando o
      // mesmo carro, ou alguém repetindo sem perceber, batem aqui.
      errosDoVeiculo.value = [/duplicate|unique/i.test(error.message || '')
        ? 'Já existe outro veículo com essa placa.'
        : 'Não consegui gravar. Confira a conexão e tente de novo.']
      return
    }

    // A VIA DE MÃO DUPLA. Só depois do carro existir: a função o acha pela placa
    // gravada. Ela cria o item no Patrimônio se o número não existir lá, liga se
    // existir, e RECUSA número que seja de outra coisa — ver migration 050.
    const et = validarEtiqueta(vForm.etiqueta, { obrigatoria: false })
    const { data: sinc, error: erroSinc } = et.numero === null ? { data: null, error: null }
      : await sbClient.rpc('sincronizar_carro_e_bem', {
        p_placa: dados.placa,
        p_etiqueta: et.numero,
        p_nome: dados.nome,
        p_marca: dados.marca,
        p_valor_centavos: dados.fipe_centavos,
      })
    gravando.value = false

    if (erroSinc) {
      // O CARRO JÁ FOI GRAVADO, e a tela tem que dizer isso. Um "não consegui
      // gravar" aqui faria a pessoa cadastrar de novo e bater na placa UNIQUE —
      // e ela ficaria sem entender por que o carro que "não salvou" já existe.
      // A mensagem do banco já vem em português de leigo (migrations 049/050).
      errosDoVeiculo.value = ['O veículo foi cadastrado, mas não consegui ligá-lo ao '
        + `Patrimônio: ${erroSinc.message} Abra a ficha dele e tente de novo.`]
      fecharVeiculo()
      carregar()
      return
    }

    seloDaSincronia.value = fraseDaSincronia(sinc)
    fecharVeiculo()
    carregar()
    return
  }

  // Trocar o dono fixo NÃO é emprestar (D9c): três casos, cobertos por
  // trocarDonoFixo() em posse.js — carro na mão do dono muda de posse junto;
  // carro emprestado a um terceiro não mexe (mexer diria que o novo dono
  // esteve com o carro num dia em que nunca o viu); e tirar o dono fixo fecha
  // a posse aberta sem abrir outra, pra nunca deixar uma posse órfã — a
  // mesma invariante que o gatilho `trg_frota_fechar_posse_orfa` no banco
  // também garante (migration 029), pra cobrir os caminhos de escrita que não
  // passam por esta tela.
  const { fechar: fecharPosse, abrir: abrirPosse } = trocarDonoFixo({
    usos: usos.value, veiculoId: veiculoAberto.value.id,
    deId: veiculoAberto.value.pessoa_id || null, paraId: dados.pessoa_id || null,
    paraNome: dados.pessoa_id ? nomeDaPessoa(dados.pessoa_id) : null,
    quando: dados.atualizado_em,
  })

  const { error } = await sbClient.from('frota_veiculos').update(dados).eq('id', veiculoAberto.value.id)
  if (error) {
    gravando.value = false
    errosDoVeiculo.value = [/duplicate|unique/i.test(error.message || '')
      ? 'Já existe outro veículo com essa placa.'
      : 'Não consegui gravar. Confira a conexão e tente de novo.']
    return
  }

  // Os dois passos da posse conferidos um a um, com o mesmo critério de
  // confirmarPasse() e gravarChecklist(): erro engolido aqui inventa resposta
  // sobre quem estava com o carro, que é justamente o que o D9c existe pra
  // evitar. Se o fechamento falha e a abertura acontece mesmo assim, o carro
  // fica com DUAS posses abertas; e como a posse vence o dono fixo, a tela e o
  // robô da manhã passam a cobrar quem não está mais com o carro — enquanto o
  // dono novo nunca é chamado e a linha do tempo afirma, pra sempre, que quem
  // saiu continuou com ele.
  if (fecharPosse) {
    const { error: erroFechar } = await sbClient.from('frota_uso')
      .update({ volta_em: fecharPosse.volta_em }).eq('id', fecharPosse.id)
    if (erroFechar) {
      // Nada de abrir a posse nova: o segundo passo com o primeiro falho é o
      // que produziria as duas posses abertas. A ficha NÃO fecha — fechar
      // faria parecer que deu tudo certo.
      gravando.value = false
      errosDoVeiculo.value = ['O veículo foi gravado, mas não consegui encerrar o registro de '
        + 'quem estava com ele — o responsável antigo continua aparecendo como quem está com o '
        + 'carro. Abra o veículo de novo e troque o responsável mais uma vez; se falhar outra '
        + 'vez, avise quem administra a Frota.']
      return
    }
  }
  if (abrirPosse) {
    const { error: erroAbrir } = await sbClient.from('frota_uso').insert(abrirPosse)
    if (erroAbrir) {
      gravando.value = false
      errosDoVeiculo.value = ['O veículo foi gravado, mas não consegui registrar que o carro '
        + 'passou para o responsável novo — ele ficou SEM ninguém registrado como quem está com '
        + 'ele. Avise quem administra a Frota agora, e tente trocar o responsável de novo em '
        + 'seguida.']
      return
    }
  }

  gravando.value = false
  fecharVeiculo()
  carregar()
}

// Histórico de manutenção do carro aberto, do mais recente pro mais antigo.
const historicoDoVeiculo = computed(() => {
  if (!veiculoAberto.value) return []
  return revisoes.value
    .filter((r) => r.veiculo_id === veiculoAberto.value.id)
    .slice()
    .sort((a, b) => (b.km ?? 0) - (a.km ?? 0))
})

/* `gravarRevisao` e `novaRevisao` foram APAGADOS em 12/08/2026, junto com o
 * formulário de uma troca por vez que os usava (D27). Não sobraram "servindo o
 * histórico antigo", como um comentário chegou a dizer: quem serve o histórico
 * é `historicoDoVeiculo` (a lista) e `apagarRevisao` (o ✕ de cada linha), logo
 * abaixo. Deixar código morto com uma explicação falsa é como alguém restaura,
 * meses depois, o formulário que o dono pediu pra tirar. */

async function apagarRevisao(r) {
  const { error } = await sbClient.from('frota_revisoes').delete().eq('id', r.id)
  if (!error) carregar()
}

/* ── LANÇAR MANUTENÇÃO: um serviço, várias trocas (D27) ──────────────────────
 *
 * Substituiu o formulário de uma troca por vez, que foi apagado junto (ver o
 * comentário logo acima). A dor medida em 12/08/2026: 15 campos pra 3 trocas, e
 * a frota inteira com 2 trocas registradas em 10 carros.
 *
 * A ARMADILHA, e ela já custou caro 4 vezes nesta ferramenta: cabeçalho e
 * trocas são DUAS gravações, e "duas gravações com só a primeira conferida"
 * sempre apareceu com a tela dizendo que tinha dado certo. Aqui cada passo é
 * conferido, e o segundo falhando DESFAZ o primeiro — senão sobra um lançamento
 * sem troca nenhuma, que aparece no histórico afirmando que algo foi feito e não
 * diz o quê. */
const lancamento = ref(null)          // { veiculo } ou nulo
const erroDoLancamento = ref('')

function abrirLancamento(veiculo) {
  subirCamada('lancamento')
  lancamento.value = { veiculo }
  erroDoLancamento.value = ''
}
function fecharLancamento() { descerCamada('lancamento'); lancamento.value = null; erroDoLancamento.value = '' }

/** O maior KM que se conhece do carro, pra ficha avisar quando o número for
 *  menor. Sai da mesma linha que a lista já calcula — duas contas diferentes
 *  pro mesmo número dariam duas verdades. */
const kmConhecidoDoLancamento = computed(() => {
  if (!lancamento.value) return null
  const l = linhas.value.find((x) => x.veiculo.id === lancamento.value.veiculo.id)
  return l && Number.isInteger(l.km) ? l.km : null
})

async function gravarLancamento(dados) {
  if (gravando.value || !lancamento.value) return
  gravando.value = true
  erroDoLancamento.value = ''
  const veiculoId = lancamento.value.veiculo.id

  // `try/finally`: sem ele, uma exceção (rede caindo no meio, resposta
  // estranha) deixaria `gravando` ligado pra sempre — e `gravando` é o MESMO
  // sinal usado por salvarVeiculo, salvarItem e o checklist, então um tropeço
  // aqui desabilitaria todos os botões de gravar da Frota, sem explicação, até
  // a pessoa recarregar a página.
  try {
    // PASSO 1: o cabeçalho. `.select()` é obrigatório — sem ele não volta o id,
    // e sem o id não há como ligar as trocas nem como desfazer se o passo 2
    // falhar.
    const { data: cab, error: erroCab } = await sbClient.from('frota_manutencoes')
      .insert({
        veiculo_id: veiculoId,
        km: dados.km,
        feita_em: dados.feitaEm,
        oficina: dados.oficina,
        total_centavos: dados.totalCentavos,
        observacao: dados.observacao,
        // Quem lançou. Sem isto a coluna nasce nula e "quem registrou este
        // serviço" fica sem resposta pra sempre.
        criada_por: estado.user ? estado.user.id : null,
      })
      .select('id')
      .single()

    if (erroCab || !cab || !cab.id) {
      erroDoLancamento.value = mensagemDoLancamento({ erroCab: erroCab || new Error('sem id') })
      return
    }

    // PASSO 2: as trocas, uma linha por item marcado. Insert de várias linhas
    // numa chamada só: o PostgREST envolve numa transação, então não existe o
    // estado "2 das 3 gravadas".
    const { error: erroLinhas } = await sbClient.from('frota_revisoes')
      .insert(linhasParaGravar({
        manutencaoId: cab.id, veiculoId,
        km: dados.km, feitaEm: dados.feitaEm, oficina: dados.oficina,
        itens: dados.itens,
      }))

    if (erroLinhas) {
      // DESFAZ o cabeçalho — senão sobra um lançamento sem troca nenhuma no
      // histórico do carro, dizendo que houve serviço e não dizendo qual.
      //
      // `.select('id')` NO DELETE, e isto é o achado da revisão: um delete
      // recusado pela permissão volta SEM erro e com ZERO linha apagada. Sem
      // contar as linhas, a tela diria "desfiz, pode tentar de novo" com o
      // cabeçalho órfão ainda lá — e o "tente de novo" produziria um SEGUNDO
      // serviço. É a mesma regra que esta tela já aplica na decisão de
      // requisição, 700 linhas acima: conferir a CONTAGEM, não só o erro.
      const { data: apagadas, error: erroDesfazer } = await sbClient
        .from('frota_manutencoes').delete().eq('id', cab.id).select('id')
      erroDoLancamento.value = mensagemDoLancamento({
        erroLinhas,
        cabecalhoApagado: !erroDesfazer && (apagadas || []).length === 1,
      })
      return
    }

    fecharLancamento()
    await carregar()
  } catch (e) {
    // Não se sabe o que foi gravado: a frase manda CONFERIR antes de repetir,
    // em vez de convidar a lançar de novo e arriscar o serviço em dobro.
    erroDoLancamento.value = 'Alguma coisa deu errado no meio da gravação e não sei dizer o '
      + 'que ficou salvo. Confira o histórico deste carro ANTES de lançar de novo — '
      + 'se o serviço já estiver lá, não repita.'
  } finally {
    gravando.value = false
  }
}

/* ── ITEM DE MECÂNICA NOVO, criado de dentro do lançamento (D28) ─────────────
 * Pergunta o nome e DE QUANTOS EM QUANTOS KM se troca, e entra no plano: a
 * partir daí o item avisa sozinho em toda a frota, que é o que o dono quis dizer
 * com "vira parâmetro no banco". A validação é problemasDoItem(), que já existe
 * e já barra nome curto, nome repetido e intervalo fora de 500–500.000. */
function novoItemDoLancamento() {
  // Reaproveita o editor do plano que já existe, em vez de um segundo
  // formulário de item — dois jeitos de criar a mesma coisa divergem com o tempo.
  abrirItem(null)
}

// -------------------------------------------------------------------- tutorial
// O passeio da tela inteira, e um por modal (pelos campos DAQUELE modal). Cada
// um é independente — fechar o da ficha do veículo não fecha o da tela.
const passeioAberto = ref(false)
const passeioVeiculoAberto = ref(false)
const passeioItemAberto = ref(false)
const passeioFichaDetalheAberto = ref(false)
const passeioPedidoAberto = ref(false)
const passeioDecisaoAberto = ref(false)
const passeioFichaAberto = ref(false)

function abrirPasseio() { passeioAberto.value = true }
// Fechou o passeio da tela (concluiu ou pulou): não abre mais sozinho pra
// esta pessoa, nesta ferramenta. Só o passeio DA TELA marca como visto — os
// passeios de dentro dos modais são sempre por pedido (o "?"), nunca abrem
// sozinhos, então não têm o que "marcar como visto".
watch(passeioAberto, (aberto) => {
  if (!aberto) marcarComoVisto(typeof localStorage !== 'undefined' ? localStorage : null, estado.user?.id)
})

onMounted(async () => {
  await carregar()
  // O jeito que a pessoa deixou as gavetas da última vez. Lido no onMounted e
  // não no setup: `estado.user` só existe depois que a sessão resolve.
  prefsDasGavetas.value = lerPreferencias(
    typeof localStorage !== 'undefined' ? localStorage : null, estado.user?.id,
  )
  // Só depois de saber as permissões dá pra escolher a aba de abertura.
  area.value = areaInicial(pode)
  // Só depois dos dados na tela: o passeio aponta pros botões rápidos da
  // Gestão, e eles dependem de `pode('criar')` e de `linhas`/`cobranca` já
  // carregados. Abrir antes mostraria o balão sem realce no passo 4, e ninguém
  // entenderia por quê.
  if (deveAbrirSozinho(typeof localStorage !== 'undefined' ? localStorage : null, estado.user?.id)) {
    passeioAberto.value = true
  }
})
</script>

<template>
  <div class="tela-frota">
    <barra-de-topo voltar="Gestão Interna" titulo="Frota" @voltar="voltar">
      <template #acoes>
        <button class="fr-btn-ajuda" @click="abrirPasseio" title="Como usar esta tela">?</button>
      </template>
    </barra-de-topo>

    <!-- O passeio da tela inteira. Abre sozinho na primeira visita e depois
         só pelo "?" da barra de topo. Componente compartilhado com o
         Patrimônio. -->
    <PasseioGuiado v-model="passeioAberto" :passos="PASSOS" />

    <!-- Duas áreas (D8). Quem só dirige vê uma aba só — e nesse caso a barra
         não aparece: barra de uma aba é enfeite que come altura de tela. -->
    <div class="abas" v-if="abas.length > 1" role="tablist">
      <button v-for="ab in abas" :key="ab.chave" role="tab" type="button"
              :class="{ on: area === ab.chave }" @click="area = ab.chave">{{ ab.rotulo }}</button>
    </div>

    <div class="fr-resumo" v-if="!carregando && !falha && area === 'gestao'">
      <span><strong>{{ livres }}</strong> {{ livres === 1 ? 'livre' : 'livres' }}</span>
      <span class="fr-sep">·</span>
      <span><strong>{{ linhas.length }}</strong> {{ linhas.length === 1 ? 'veículo' : 'veículos' }}</span>
    </div>

    <p v-if="carregando" class="fr-vazio">Carregando…</p>
    <p v-else-if="falha" class="fr-erro">{{ falha }}</p>
    <p v-else-if="!linhas.length" class="fr-vazio">Nenhum veículo cadastrado ainda.</p>

    <!-- ÁREA MOTORISTA: o carro que está comigo (pra devolver) e os livres (pra
         pegar). Sem FIPE, contrato, chassi ou Renavam — quem está de pé no
         estacionamento não precisa disso na frente. -->
    <template v-else-if="area === 'motorista'">
      <BotoesRapidos :botoes="botoesMotorista" @escolher="irPara" />

      <p class="fr-motorista-resumo">{{ resumoDoMotorista(painel) }}</p>

      <p class="fr-aviso" v-if="!euId">
        Não achei você na lista de colaboradores pelo seu e-mail, então não consigo dizer qual
        carro está com você. Dá pra pegar e devolver normalmente, escolhendo o nome na hora.
      </p>

      <!-- O checklist de hoje. Era só do carro fixo da pessoa; agora quem
           administra a Frota preenche por qualquer carro ativo (D21b), que é a
           única saída enquanto três dos donos de carro não têm login. -->
      <div id="fr-ancora-checklist">
      <template v-if="aberto">
        <!-- Quando o gestor preenche por outro, a tela DIZ de quem é o carro: a
             ficha vai registrar o GESTOR como quem conferiu, e ele precisa
             saber disso antes de assinar. -->
        <p class="fr-aviso" v-if="!aberto.meu">
          Você está preenchendo pelo {{ aberto.veiculo.nome }}<template v-if="aberto.donoId && nomeDaPessoa(aberto.donoId)">, que é o carro de {{ nomeDaPessoa(aberto.donoId) }}</template>.
          A ficha vai registrar que <strong>você</strong> conferiu este carro — não o dono dele.
        </p>
        <PainelDeChecklist
          :key="aberto.veiculo.id"
          data-tour="fr-checklist-hoje"
          :veiculo="aberto.veiculo"
          :itens="itensDeChecklist"
          :config="configDeChecklist"
          :ultima-semanal="ultimaDoTipo(aberto.veiculo.id, 'semanal')"
          :ultima-mensal="ultimaDoTipo(aberto.veiculo.id, 'mensal')"
          :ultimo-km="ultimoHodometro(fichas, aberto.veiculo.id)"
          :hoje="hoje"
          :gravando="gravando"
          :pode-assinar="podeAssinar"
          :erro-da-assinatura="erroDaAssinatura"
          @gravar="gravarChecklist" />
      </template>
      </div>
      <!-- `v-if` PRÓPRIO, não `v-else-if` do cartão: as duas frases respondem
           perguntas diferentes agora. Encadeadas, o gestor que abrisse o carro
           de outra pessoa deixaria de ver que o SEU já estava feito. -->
      <p class="fr-aviso" v-if="meuCarroFixo && fichaDeHoje">
        Checklist de hoje já feito, com {{ fichaDeHoje.hodometro.toLocaleString('pt-BR') }} km.
      </p>
      <!-- "Gravado" e "gravado e assinado" são coisas diferentes, e a pessoa
           tem que saber qual das duas aconteceu com ela (D22). Fica AQUI, logo
           abaixo do cartão: depois da lista de outros carros, a resposta do que
           acabou de acontecer nasceria longe demais de onde se apertou o botão. -->
      <p class="fr-aviso" v-if="seloDoChecklist">{{ seloDoChecklist }}</p>
      <p class="fr-erro" v-if="erroChecklist">{{ erroChecklist }}</p>

      <!-- Os outros carros que quem administra pode conferir. Não aparece pra
           quem só dirige: essa pessoa tem um carro e mais nada. -->
      <template v-if="ehGestorDaFrota && diaPedeChecklist && outrosParaConferir.length">
        <h2 class="fr-secao">Outros carros sem checklist hoje</h2>
        <p class="fr-aviso">
          Você administra a Frota, então pode preencher a ficha destes carros. Quem preencher
          fica registrado na ficha — preencha só o que você conferiu de verdade.
        </p>
        <ul class="fr-outros">
          <li v-for="x in outrosParaConferir" :key="x.veiculo.id">
            <div class="fr-outros-ident">
              <span class="fr-card-nome">{{ x.veiculo.nome }}</span>
              <span class="fr-placa">
                {{ x.donoId && nomeDaPessoa(x.donoId) ? nomeDaPessoa(x.donoId) : 'sem responsável fixo' }}
              </span>
            </div>
            <button class="fr-btn" @click="conferindoVeiculo = x.veiculo.id">Conferir este</button>
          </li>
        </ul>
      </template>

      <template v-if="meuCarroFixo">
        <h2 class="fr-secao">Seu carro</h2>
        <!-- DENTRO DA `.fr-lista`, como todos os outros cartões desta tela.
             Ele estava solto, e por isso era o único que ia de ponta a ponta:
             no computador ficava um cartão de 1400px de largura ao lado de um
             checklist de 640px, na mesma tela. A `.fr-lista` já vira grade de
             320px acima de 900px (a mesma da Gestão, de 19/08) — aqui é só
             usar o que existe.

             `no-meio` porque a `.fr-lista` nasceu pra ser a ÚLTIMA da tela e
             carrega 40px de respiro embaixo. Aqui ela tem seções depois, e
             esses 40px empurravam a página 44px pra baixo no celular — medido
             antes e depois, a 375px. -->
        <div class="fr-lista no-meio">
        <div class="fr-card">
          <div class="fr-card-topo">
            <div class="fr-card-ident">
              <span class="fr-card-nome">{{ meuCarroFixo.nome }}</span>
              <span class="fr-placa">{{ meuCarroFixo.placa }}</span>
            </div>
          </div>
          <!-- Quem empresta o carro registra pra quem. É isto que faz a multa ter
               resposta: sem o passe, a multa cai no nome do dono fixo, que pode não
               ter sido quem dirigiu. O formulário virou MODAL (D26) pra servir
               também à aba Gestão, onde quem administra passa ou encerra a posse
               de qualquer carro — não só do seu. -->
          <div class="fr-acoes">
            <button class="fr-btn" v-if="podeEditar" @click="abrirPasse(meuCarroFixo)">
              Passar o carro para outra pessoa
            </button>
          </div>
        </div>
        </div>
      </template>

      <template v-if="painel.comigo.length">
        <h2 class="fr-secao">Com você agora</h2>
        <div class="fr-lista">
          <div v-for="l in painel.comigo" :key="l.veiculo.id" class="fr-card rua">
            <div class="fr-card-topo">
              <div class="fr-card-ident">
                <span class="fr-card-nome">{{ l.veiculo.nome }}</span>
                <span class="fr-placa">{{ l.veiculo.placa }}</span>
              </div>
            </div>
            <div class="fr-dados">
              <div class="fr-dado">
                <span class="fr-dado-lab">Saiu com</span>
                <span class="fr-dado-val">{{ l.km == null ? '—' : l.km.toLocaleString('pt-BR') + ' km' }}</span>
              </div>
              <div class="fr-dado">
                <span class="fr-dado-lab">Combustível</span>
                <span class="fr-dado-val" :class="{ alerta: l.precisaAbastecer }">{{ rotuloDoTanque(l.tanque) }}</span>
              </div>
            </div>
            <div class="fr-acoes">
              <button class="fr-btn primario" v-if="podeEditar" @click="abrirDevolucao(l)">Devolver</button>
              <a v-if="zapDoVeiculo(l.veiculo)" class="fr-btn fr-zap" :href="zapDoVeiculo(l.veiculo)"
               target="_blank" rel="noopener"
               :title="l.veiculo.contato_nome ? ('Falar com ' + l.veiculo.contato_nome + ' no WhatsApp') : 'Falar no WhatsApp'">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17.47 14.38c-.3-.15-1.74-.86-2-.96-.27-.1-.47-.15-.66.15-.2.29-.76.95-.93 1.15-.17.2-.34.22-.63.07-.3-.15-1.25-.46-2.38-1.47-.88-.78-1.47-1.75-1.64-2.05-.17-.29-.02-.45.13-.6.13-.13.3-.34.44-.51.15-.17.2-.29.3-.49.1-.2.05-.37-.02-.51-.08-.15-.66-1.59-.9-2.18-.24-.57-.48-.5-.66-.51h-.57c-.2 0-.51.07-.78.37-.27.29-1.02 1-1.02 2.43s1.05 2.82 1.2 3.02c.15.2 2.06 3.14 4.99 4.4.7.3 1.24.48 1.66.62.7.22 1.33.19 1.83.12.56-.08 1.74-.71 1.98-1.4.24-.68.24-1.27.17-1.39-.07-.12-.27-.2-.56-.34M12 2a10 10 0 0 0-8.6 15.1L2 22l5.05-1.32A10 10 0 1 0 12 2"/></svg>
              WhatsApp
            </a>
            </div>
          </div>
        </div>
      </template>

      <!-- As reservas da pessoa: o que ela pediu e ainda não usou. -->
      <template v-if="minhasRequisicoes.length">
        <h2 class="fr-secao">Seus pedidos</h2>
        <ul class="fr-pedidos">
          <li v-for="r in minhasRequisicoes" :key="r.id" class="fr-pedido">
            <div class="fr-pedido-topo">
              <strong>{{ (veiculos.find((v) => v.id === r.veiculo_id) || {}).nome || 'Veículo' }}</strong>
              <!-- `SITUACOES[r.situacao]` era leitura direta e quebrava com
                   'revogada', que não mora naquela tabela: `undefined.cor`
                   derruba o bloco inteiro. As duas funções nunca devolvem
                   vazio nem cor que não exista no CSS. -->
              <span class="fr-selo" :class="corDaSituacao(r.situacao)">{{ rotuloDaSituacao(r.situacao) }}</span>
            </div>
            <div class="fr-pedido-quando">{{ quando(r.retirada_prevista) }}<span v-if="r.destino"> · {{ r.destino }}</span></div>
            <!-- O MOTIVO, nos dois casos em que existe um. Recusar exige motivo
                 escrito, e revogar também (o gatilho da 045 recusa vazio) — não
                 mostrar aqui era jogar fora a única explicação que a pessoa tem. -->
            <div class="fr-pedido-motivo" v-if="r.situacao === 'recusada' && r.motivo_decisao">{{ r.motivo_decisao }}</div>
            <div class="fr-pedido-motivo" v-else-if="r.situacao === 'revogada' && r.encerrada_motivo">{{ r.encerrada_motivo }}</div>
          </li>
        </ul>
      </template>

      <h2 class="fr-secao" id="fr-ancora-livres">{{ painel.livres.length ? 'Livres para pegar' : 'Nenhum carro livre' }}</h2>
      <p class="fr-aviso" v-if="!painel.livres.length">
        Todos estão na rua ou na oficina. Assim que alguém devolver, aparece aqui.
      </p>
      <div class="fr-lista" v-else>
        <div v-for="l in painel.livres" :key="l.veiculo.id" class="fr-card">
          <div class="fr-card-topo">
            <div class="fr-card-ident">
              <span class="fr-card-nome">{{ l.veiculo.nome }}</span>
              <span class="fr-placa">{{ l.veiculo.placa }}</span>
            </div>
            <!-- Sem este selo, o carro que a pessoa reservou aparece entre os
                 livres sem dizer por quê — e ela não tem como saber que aquele
                 ali é o dela, e não um que sobrou. -->
            <span class="fr-selo espera" v-if="l.reservadaParaMim">Sua reserva</span>
            <span class="fr-selo livre" v-else-if="l.ondeEsta">Em {{ l.ondeEsta }}</span>
          </div>
          <div class="fr-dados">
            <div class="fr-dado">
              <span class="fr-dado-lab">Quilometragem</span>
              <span class="fr-dado-val">{{ l.km == null ? '—' : l.km.toLocaleString('pt-BR') + ' km' }}</span>
            </div>
            <div class="fr-dado">
              <span class="fr-dado-lab">Combustível</span>
              <span class="fr-dado-val" :class="{ alerta: l.precisaAbastecer }">
                {{ rotuloDoTanque(l.tanque) }}<template v-if="l.precisaAbastecer"> · abastecer</template>
              </span>
            </div>
          </div>
          <div class="fr-acoes">
            <!-- O "Vou usar" SAIU daqui em 12/08/2026, a pedido do dono: pegar
                 o carro passa a ser sempre por RESERVA, e reserva depende de
                 aprovação. Com os dois lado a lado, quem quisesse evitar o
                 pedido bastava tocar no outro, e a aprovação virava enfeite.
                 O botão volta SÓ pra quem já foi aprovado — sem isso, aprovar
                 não criaria registro de uso nenhum, o carro nunca ficaria "na
                 rua" e o "Devolver" nunca apareceria. -->
            <button class="fr-btn primario" v-if="podeEditar && podePegar(l)"
                    @click="abrirRetirada(l)">Peguei o carro</button>
            <button class="fr-btn" :class="{ primario: !podePegar(l) }" v-if="podeEditar"
                    @click="abrirPedido(l.veiculo.id)">Reservar</button>
            <a v-if="zapDoVeiculo(l.veiculo)" class="fr-btn fr-zap" :href="zapDoVeiculo(l.veiculo)"
               target="_blank" rel="noopener"
               :title="l.veiculo.contato_nome ? ('Falar com ' + l.veiculo.contato_nome + ' no WhatsApp') : 'Falar no WhatsApp'">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17.47 14.38c-.3-.15-1.74-.86-2-.96-.27-.1-.47-.15-.66.15-.2.29-.76.95-.93 1.15-.17.2-.34.22-.63.07-.3-.15-1.25-.46-2.38-1.47-.88-.78-1.47-1.75-1.64-2.05-.17-.29-.02-.45.13-.6.13-.13.3-.34.44-.51.15-.17.2-.29.3-.49.1-.2.05-.37-.02-.51-.08-.15-.66-1.59-.9-2.18-.24-.57-.48-.5-.66-.51h-.57c-.2 0-.51.07-.78.37-.27.29-1.02 1-1.02 2.43s1.05 2.82 1.2 3.02c.15.2 2.06 3.14 4.99 4.4.7.3 1.24.48 1.66.62.7.22 1.33.19 1.83.12.56-.08 1.74-.71 1.98-1.4.24-.68.24-1.27.17-1.39-.07-.12-.27-.2-.56-.34M12 2a10 10 0 0 0-8.6 15.1L2 22l5.05-1.32A10 10 0 1 0 12 2"/></svg>
              WhatsApp
            </a>
          </div>
        </div>
      </div>

      <!-- Os que estão com outras pessoas: sem botão, só pra ninguém achar que
           o carro sumiu da lista. -->
      <template v-if="painel.comOutros.length">
        <h2 class="fr-secao">Na rua com outras pessoas</h2>
        <ul class="fr-com-outros">
          <li v-for="l in painel.comOutros" :key="l.veiculo.id">
            <strong>{{ l.veiculo.nome }}</strong>
            <span v-if="l.comQuem"> · com {{ l.comQuem }}</span>
          </li>
        </ul>
      </template>
    </template>

    <!-- GESTÃO. `v-else-if` EXPLÍCITO, nunca `v-else` solto: com `v-else` esta
         lista era o fim da corrente que começa lá em cima no "carregando", e
         qualquer aba que não fosse Motorista caía aqui — Revisões e Plano de
         manutenção mostravam a frota inteira em cartões.

         O quadro de cobrança (Tarefa 9) entra AQUI DENTRO, no mesmo elo da
         corrente, e não como um `<template v-if>` à parte antes deste `<div>`.
         Um `v-if` separado quebraria a corrente: o `v-else-if` deste `<div>`
         passaria a se encadear nesse `v-if` novo, e não mais em
         "carregando/falha/sem veículo/motorista" — bastaria estar na aba
         Gestão pra este bloco aparecer, mesmo com a tela ainda carregando. -->
    <template v-else-if="area === 'gestao'">
      <BotoesRapidos data-tour="fr-botoes-gestao" :botoes="botoesGestao" @escolher="irPara" />

      <!-- O QUE A SINCRONIA COM O PATRIMÔNIO FEZ. Fica aqui, no topo da aba,
           porque é onde a pessoa cai depois de fechar a ficha do carro novo.
           Nunca um "pronto!" genérico: a frase diz se nasceu item novo lá ou se
           só amarrou no que já existia — ver fraseDaSincronia. -->
      <p class="fr-prova-frase boa" v-if="seloDaSincronia">{{ seloDaSincronia }}</p>

      <!-- FILA DE APROVAÇÃO, na área de Gestão. Só aparece pra quem aprova.
           Pedido do dono: logo abaixo dos botões, não no fim da tela. -->
      <Gaveta v-if="gv('fila')" :titulo="gv('fila').titulo" :estado="gv('fila').estado"
              :aberta="gv('fila').aberta" :travada-aberta="gv('fila').travadaAberta"
              id="gv-fila" @alternar="alternarGaveta('fila')">

        <div class="fr-lista">
          <div v-for="r in filaDeAprovacao" :key="r.id" class="fr-card espera">
            <div class="fr-card-topo">
              <div class="fr-card-ident">
                <span class="fr-card-nome">{{ (veiculos.find((v) => v.id === r.veiculo_id) || {}).nome || 'Veículo' }}</span>
                <span class="fr-placa">{{ r.pessoa_nome || 'sem motorista informado' }}</span>
              </div>
              <span class="fr-selo espera">{{ quando(r.retirada_prevista) }}</span>
            </div>
            <div class="fr-dados">
              <div class="fr-dado">
                <span class="fr-dado-lab">Destino</span>
                <span class="fr-dado-val">{{ r.destino || '—' }}</span>
              </div>
              <div class="fr-dado" v-if="r.devolucao_prevista">
                <span class="fr-dado-lab">Devolve</span>
                <span class="fr-dado-val">{{ quando(r.devolucao_prevista) }}</span>
              </div>
            </div>
            <p class="fr-pedido-motivo" v-if="r.finalidade">{{ r.finalidade }}</p>

            <div class="fr-acoes" v-if="porQueNaoDecido(r).pode">
              <button class="fr-btn primario" @click="abrirDecisao(r, 'aprovada')">Aprovar</button>
              <button class="fr-btn" @click="abrirDecisao(r, 'recusada')">Recusar</button>
            </div>
            <p class="fr-aviso" v-else>{{ motivoEmPortugues(porQueNaoDecido(r).motivo) }}</p>
          </div>
        </div>
      </Gaveta>

      <!-- RESERVAS E RETIRADAS — o histórico (13/08/2026).
           A fila acima é o que pede decisão HOJE; isto aqui é o que já
           aconteceu. As duas listas são separadas de propósito: juntar faria a
           decisão pendente se perder no meio do passado. -->
      <Gaveta v-if="gv('historico')" :titulo="gv('historico').titulo" :estado="gv('historico').estado"
              :aberta="gv('historico').aberta" :travada-aberta="gv('historico').travadaAberta"
              id="gv-historico" @alternar="alternarGaveta('historico')">

        <p class="fr-aviso">{{ resumoDoHistorico(historico) }}</p>

        <!-- O FILTRO TRAZ A CONTA NO PRÓPRIO BOTÃO. Sem ela a pessoa toca em
             "Sem assinatura" pra descobrir se há algo lá, e o filtro vira
             adivinhação. Filtro com zero linha fica visível e desligado: sumir
             faria a barra mudar de forma a cada carregamento. -->
        <div class="fr-filtros">
          <button v-for="f in FILTROS" :key="f.chave" type="button" class="fr-filtro"
                  :class="{ on: filtroDoHistorico === f.chave }"
                  :disabled="!contagemDosFiltros[f.chave] && f.chave !== 'tudo'"
                  @click="filtroDoHistorico = f.chave">
            {{ f.rotulo }} <span class="fr-filtro-n">{{ contagemDosFiltros[f.chave] }}</span>
          </button>
        </div>

        <p class="fr-aviso" v-if="!historicoFiltrado.length">
          Nenhuma linha com este filtro. Toque em “Tudo” para ver a lista inteira.
        </p>

        <div class="fr-lista" v-else>
          <div v-for="l in historicoNaTela" :key="l.chave" class="fr-card"
               :class="{ espera: l.situacao === 'pendente', ruimzao: ['recusada','cancelada','revogada'].includes(l.situacao), parado: l.tipo === 'retirada', fixo: l.tipo === 'posse', arquivada: l.arquivada }">

            <div class="fr-card-topo">
              <div class="fr-card-ident">
                <span class="fr-card-nome">{{ l.veiculoNome }}</span>
                <span class="fr-placa">{{ l.veiculoPlaca || 'sem placa' }}</span>
              </div>
              <!-- "Sem reserva" virou "Pegou sem reservar" (19/08/2026): a
                   palavra antiga confundia o dono, e com razão — ela estava
                   colada em 11 cartões que eram TODOS carro fixo. Agora o selo
                   da posse vem de `rotuloDaSituacao` ("Carro fixo" / "Foi
                   fixo") e este ramo só pega retirada de verdade. -->
              <span class="fr-selo">{{ l.tipo === 'retirada' ? 'Pegou sem reservar' : rotuloDaSituacao(l.situacao) }}</span>
            </div>

            <!-- O BÁSICO, SEMPRE VISÍVEL: quem, quando e para onde. Linha
                 fechada que não diz nada obriga a abrir uma por uma pra achar
                 a que interessa — pior que o paredão que existia antes. -->
            <p class="fr-hist-resumo">{{ resumoCurtoDaLinha(l, quando) }}</p>
            <div class="fr-hist-abrir">
              <button type="button" class="fr-btn" @click="alternarDetalhe(l.chave)">
                {{ detalhesAbertos.has(l.chave) ? 'Fechar' : 'Abrir' }}
              </button>
              <!-- O ATALHO até o checklist assinado (pedido do dono). Só
                   aparece quando existe ficha daquele dia: botão que abre pro
                   nada é pior que botão nenhum. -->
              <button type="button" class="fr-btn" v-if="l.prova && l.prova.ficha"
                      @click="verChecklistDaLinha(l)">Ver o checklist</button>
            </div>

            <template v-if="detalhesAbertos.has(l.chave)">

            <!-- O QUE FOI PEDIDO. Só existe quando houve reserva: retirada
                 avulsa não tem pedido nenhum atrás, e inventar uma linha
                 "Destino: —" faria parecer que alguém deixou o campo em
                 branco. -->
            <template v-if="l.reserva">
              <div class="fr-dados">
                <div class="fr-dado">
                  <span class="fr-dado-lab">Quem vai dirigir</span>
                  <span class="fr-dado-val">{{ l.reserva.pessoa_nome || 'não informado' }}</span>
                </div>
                <div class="fr-dado">
                  <span class="fr-dado-lab">Retirada prevista</span>
                  <span class="fr-dado-val">{{ quando(l.reserva.retirada_prevista) }}</span>
                </div>
                <div class="fr-dado" v-if="l.reserva.devolucao_prevista">
                  <span class="fr-dado-lab">Devolução prevista</span>
                  <span class="fr-dado-val">{{ quando(l.reserva.devolucao_prevista) }}</span>
                </div>
              </div>
              <p class="fr-hist-linha" v-if="l.reserva.destino">
                <strong>Destino:</strong> {{ l.reserva.destino }}
              </p>
              <p class="fr-hist-linha" v-if="l.reserva.finalidade">
                <strong>Para quê:</strong> {{ l.reserva.finalidade }}
              </p>
              <p class="fr-hist-linha" v-if="l.reserva.departamento">
                <strong>Departamento:</strong> {{ l.reserva.departamento }}
              </p>
            </template>

            <!-- CARRO FIXO (19/08/2026). Bloco PRÓPRIO, e é ele que conserta o
                 pedido do dono: "carro que fica definitivo com alguém não
                 precisa mostrar 'ainda não voltou', só que fica fixo com tal
                 pessoa". A frase inteira sai de `fraseDaPosse`, testada — aqui
                 não se decide nada.

                 E repare no que NÃO tem aqui: bloco de prova. Posse não é
                 retirada, então não há assinatura de quem pegou pra cobrar.
                 Era exatamente esse bloco, desenhado 11 vezes, que enchia a
                 tela de "não ficou prova nenhuma desta retirada". -->
            <p class="fr-hist-linha fr-hist-posse" v-if="l.tipo === 'posse'">{{ fraseDaPosse(l) }}</p>

            <!-- O QUE ACONTECEU DE VERDADE. É a metade que faltava: a reserva
                 diz o que foi combinado, e isto diz o que o carro fez. -->
            <div class="fr-prova" v-if="l.tipo !== 'posse'">
              <p class="fr-hist-titulo">O que aconteceu</p>

              <p class="fr-hist-linha" v-if="l.uso">
                Saiu {{ quando(l.uso.saida_em) }} com
                <strong>{{ l.uso.pessoa_nome || 'motorista não informado' }}</strong><template
                  v-if="l.uso.volta_em">, devolvido {{ quando(l.uso.volta_em) }}</template><template
                  v-else> — <strong>ainda não voltou</strong></template>.
              </p>
              <p class="fr-hist-linha" v-else-if="l.reserva">
                O carro <strong>ainda não foi retirado</strong> com esta reserva.
              </p>

              <!-- A PROVA, e ela NUNCA vira um "✔ assinado" genérico. Foi
                   medindo isto que a entrega nasceu: em 07/08/2026 havia
                   assinatura na ficha do dia, mas ela era do Erick, e quem
                   pegou o carro foi o Breno. Um selo verde ali teria dito uma
                   coisa que não aconteceu. -->
              <p v-if="l.prova" class="fr-prova-frase"
                 :class="{ boa: ['aceite','assinada-por-quem-pegou'].includes(l.prova.estado),
                           atencao: ['assinada-por-outra','ficha-sem-assinatura'].includes(l.prova.estado),
                           ruim: l.prova.estado === 'sem-ficha' }">
                {{ l.prova.frase }}
              </p>

              <p class="fr-hist-linha fr-hist-zoho" v-if="l.zoho && l.zoho.frase">{{ l.zoho.frase }}</p>

              <div class="fr-acoes" v-if="l.prova && l.prova.ficha">
                <button class="fr-btn" @click="abrirFichaDoHistorico(l.prova.ficha)">Ver a ficha assinada</button>
              </div>
            </div>

            <!-- O RASTRO. Quem pediu, quem decidiu, quem encerrou e por quê.
                 Sem o motivo escrito, uma reserva que some da agenda é
                 exatamente o que a pasta de papéis fazia: a folha sumia da
                 gaveta e ninguém sabia dizer por quê. -->
            <template v-if="l.reserva">
              <p class="fr-hist-rastro">
                Pedido em {{ quando(l.reserva.criada_em) }}<template
                  v-if="nomeDoUsuario(l.reserva.criada_por)"> por {{ nomeDoUsuario(l.reserva.criada_por) }}</template>.
              </p>
              <p class="fr-hist-rastro" v-if="l.reserva.decidida_em">
                {{ rotuloDaSituacao(l.reserva.situacao === 'recusada' ? 'recusada' : 'aprovada') }}
                em {{ quando(l.reserva.decidida_em) }}<template
                  v-if="nomeDoUsuario(l.reserva.decidida_por)"> por {{ nomeDoUsuario(l.reserva.decidida_por) }}</template><template
                  v-if="l.reserva.motivo_decisao">: {{ l.reserva.motivo_decisao }}</template>
              </p>
              <p class="fr-hist-rastro" v-if="l.reserva.encerrada_em">
                {{ rotuloDaSituacao(l.reserva.situacao) }} em {{ quando(l.reserva.encerrada_em) }}<template
                  v-if="nomeDoUsuario(l.reserva.encerrada_por)"> por {{ nomeDoUsuario(l.reserva.encerrada_por) }}</template><template
                  v-if="l.reserva.encerrada_motivo">: {{ l.reserva.encerrada_motivo }}</template>
              </p>
            </template>

            <!-- AS AÇÕES. Cancelar e revogar nunca aparecem juntas: uma ação
                 principal por bloco, e só uma das duas cabe em cada momento —
                 o que ainda não começou se cancela, o que já vale se revoga.
                 Quando nada dá, o card DIZ por quê, em vez de sumir com os
                 botões e deixar a pessoa achando que a tela quebrou. -->
            <div class="fr-acoes" v-if="l.acoes && (l.acoes.editar.pode || l.acoes.cancelar.pode
                 || l.acoes.revogar.pode || l.acoes.arquivar.pode || l.acoes.desarquivar.pode)">
              <!-- Botão COMUM, não vermelho, e é regra escrita do padrão:
                   botão de perigo não fica solto na lista — ele mora atrás de
                   um passo a mais. O passo a mais existe: os dois abrem um
                   modal que exige o motivo escrito antes de gravar, e é lá que
                   a confirmação é vermelha. -->
              <button v-if="l.acoes.editar.pode" class="fr-btn" @click="abrirEdicao(l.reserva)">Editar</button>
              <button v-if="l.acoes.cancelar.pode" class="fr-btn"
                      @click="abrirEncerramento(l.reserva, 'cancelada')">Cancelar reserva</button>
              <button v-if="l.acoes.revogar.pode" class="fr-btn"
                      @click="abrirEncerramento(l.reserva, 'revogada')">Revogar reserva</button>
              <!-- ARQUIVAR (D4). Botão COMUM, e não de perigo, porque não é
                   perigoso: nada se perde, e o caminho de volta está no filtro
                   "Arquivadas". Pintá-lo de vermelho ensinaria a coisa errada
                   sobre o que ele faz. Por isso também não pede confirmação. -->
              <button v-if="l.acoes.arquivar.pode" class="fr-btn" :disabled="arquivando === l.reserva.id"
                      @click="mudarArquivamento(l.reserva, true)">
                {{ arquivando === l.reserva.id ? 'Arquivando…' : 'Arquivar' }}
              </button>
              <button v-if="l.acoes.desarquivar.pode" class="fr-btn" :disabled="arquivando === l.reserva.id"
                      @click="mudarArquivamento(l.reserva, false)">
                {{ arquivando === l.reserva.id ? 'Devolvendo…' : 'Devolver para a lista' }}
              </button>
            </div>
            <p class="fr-ajuda" v-else-if="l.acoes">
              {{ porQueNaoDaEmPortugues(l.acoes.editar.motivo, l.situacao) }}
            </p>
            <!-- O erro fica NO cartão que falhou, não numa faixa no topo: com
                 vários cartões na tela, um aviso solto lá em cima não diz de
                 qual reserva ele está falando. -->
            <p class="fr-erro-inline" v-if="erroDeArquivar && arquivando === null
               && l.acoes && (l.acoes.arquivar.pode || l.acoes.desarquivar.pode)">{{ erroDeArquivar }}</p>
            <p class="fr-ajuda" v-if="l.arquivada">
              Arquivada: ela não aparece mais na lista principal. O pedido, o motivo e quem
              decidiu continuam guardados.
            </p>
            </template>
          </div>
        </div>

        <!-- O histórico segue no pé do próprio card, com o "ver mais" que só
             aparece quando há linha escondida (mostrar-mais.js). -->
        <div class="fr-ver-mais" v-if="verMaisHistorico">
          <button type="button" class="fr-btn" @click="mostrarMaisHistorico">{{ verMaisHistorico }}</button>
        </div>
      </Gaveta>

      <Gaveta v-if="gv('cobranca')" :titulo="gv('cobranca').titulo" :estado="gv('cobranca').estado"
              :aberta="gv('cobranca').aberta" :travada-aberta="gv('cobranca').travadaAberta"
              id="gv-cobranca" data-ancora="fr-ancora-cobranca" @alternar="alternarGaveta('cobranca')">
      <p class="fr-aviso">{{ resumoDaCobranca(cobranca, hoje) }}</p>
      <!-- Em cards (pedido do dono), não em lista de linhas. Quem já fez abre
           o detalhe pra ver O QUE foi marcado — o quadro antigo só dizia QUEM
           fez, e o dono apontou que isso não dava pra ler. Quem falta ganha um
           jeito de cobrar na hora. -->
      <div class="fr-lista" data-tour="fr-cobranca-quadro">
        <div v-for="c in cobranca" :key="c.veiculo.id" class="fr-card fr-card-cobranca" :class="{ pendente: !c.fez }">
          <div class="fr-card-topo">
            <div class="fr-card-ident">
              <span class="fr-card-nome">
                {{ c.veiculo.nome }}
                <!-- A TAG diz POR QUE este carro está no quadro hoje:
                     "fixo" é o carro de alguém, cobrado de segunda a sexta;
                     "reserva" é o que saiu numa retirada de hoje, e esse conta
                     em qualquer dia, inclusive sábado. Sem ela, o carro de
                     rodízio aparece no meio dos fixos sem explicação.
                     NÃO se chama "etiqueta": nesta base essa palavra é o número
                     de patrimônio do veículo, e dois sentidos pro mesmo nome é
                     como se lê a coisa errada seis meses depois. -->
                <span class="fr-tag" :class="c.tag">{{ c.tag === 'reserva' ? 'reserva' : 'fixo' }}</span>
              </span>
              <span class="fr-placa">{{ c.dono || (c.tag === 'reserva' ? 'quem pegou não ficou registrado' : 'dono saiu do cadastro') }}</span>
            </div>
            <!-- Três estados, não dois (D22): feito e assinado, feito SEM
                 assinatura, e falta. Laranja no do meio porque é um dado a
                 saber, não uma falta — quem não tem login não podia assinar. -->
            <span class="fr-cobranca-selo"
                  :class="{ pendente: !c.fez, 'sem-assinatura': c.fez && !fichaAssinadaHoje(c.veiculo.id) }">
              {{ seloDaCobranca(c) }}
            </span>
          </div>
          <!-- Feito → abre o detalhe. Falta com telefone → cobra por WhatsApp.
               Falta sem telefone → a tela DIZ isso com todas as letras (nunca
               some em silêncio, senão o dono acha que está tudo certo e nunca
               descobre por que ninguém recebeu a cobrança). `v-else-if`
               explícito nos três, no mesmo padrão que o resto do arquivo usa. -->
          <div class="fr-acoes" v-if="c.fez">
            <button class="fr-btn" @click="abrirDetalheChecklist(c)">Ver o que foi marcado</button>
          </div>
          <div class="fr-acoes" v-else-if="zapDeCobranca(c)">
            <a class="fr-btn fr-zap" :href="zapDeCobranca(c)" target="_blank" rel="noopener"
               :title="tituloZapDeCobranca(c)">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17.47 14.38c-.3-.15-1.74-.86-2-.96-.27-.1-.47-.15-.66.15-.2.29-.76.95-.93 1.15-.17.2-.34.22-.63.07-.3-.15-1.25-.46-2.38-1.47-.88-.78-1.47-1.75-1.64-2.05-.17-.29-.02-.45.13-.6.13-.13.3-.34.44-.51.15-.17.2-.29.3-.49.1-.2.05-.37-.02-.51-.08-.15-.66-1.59-.9-2.18-.24-.57-.48-.5-.66-.51h-.57c-.2 0-.51.07-.78.37-.27.29-1.02 1-1.02 2.43s1.05 2.82 1.2 3.02c.15.2 2.06 3.14 4.99 4.4.7.3 1.24.48 1.66.62.7.22 1.33.19 1.83.12.56-.08 1.74-.71 1.98-1.4.24-.68.24-1.27.17-1.39-.07-.12-.27-.2-.56-.34M12 2a10 10 0 0 0-8.6 15.1L2 22l5.05-1.32A10 10 0 1 0 12 2"/></svg>
              {{ rotuloZapDeCobranca(c) }}
            </a>
          </div>
          <p class="fr-ajuda fr-cobranca-sem-tel" v-else>{{ porQueSemZapDeCobranca(c) }}</p>

          <!-- Devolver o telefone pro cadastro (Bronca 1 do dono: o dado não
               pode morar só na ficha do carro). É um bloco À PARTE da corrente
               de três ramos acima — não é v-else-if dela, é um complemento que
               aparece ou não por conta própria, então não interfere na
               corrente de "feito / cobra / sem telefone". Só aparece quando o
               nome bate (é o telefone da própria pessoa) e quem está vendo
               pode editar Colaboradores e Acessos. -->
          <!-- DAR ACESSO AO DONO (D-2). Medido em 12/08: Marcus, Thiago e
               Barbara são donos de carro e não têm login, então não recebem o
               aviso das 7h30 nem assinam checklist — e é por isso que quem
               administra preenche por eles (D21b), uma saída de emergência que
               virou o normal. O botão fica AQUI, no card que mostra a falta,
               porque é aqui que a pessoa descobre o problema. -->
          <div class="fr-convite" v-if="conviteDaLinha(c).pode">
            <button type="button" class="fr-btn" :disabled="!!convidando"
                    @click="darAcessoAoDono(c)">
              {{ convidando && convidando.veiculoId === c.veiculo.id
                ? 'Criando o acesso…' : `Dar acesso a ${c.dono}` }}
            </button>
            <p class="fr-ajuda">
              Sem acesso, {{ c.dono }} não recebe o aviso das 7h30 nem consegue assinar o
              checklist. Nada é enviado por e-mail: a senha aparece aqui pra você entregar.
            </p>
          </div>
          <!-- Quando NÃO dá, a tela diz o motivo. Botão que some sem explicação
               faz a pessoa achar que a ferramenta está quebrada. -->
          <!-- Pelo CÓDIGO, não pelo texto: a revisão pegou o template
               decidindo por `.includes('já tem acesso')`, e mudar a frase no
               módulo passaria a imprimir o aviso errado em todo card. -->
          <p class="fr-ajuda" v-else-if="!c.fez
             && ['sem-pessoa', 'sem-email'].includes(conviteDaLinha(c).codigo)">
            {{ conviteDaLinha(c).motivo }}
          </p>

          <!-- A SENHA, uma vez só. -->
          <div class="fr-convite-feito" v-if="conviteFeito && conviteFeito.veiculoId === c.veiculo.id">
            <p class="fr-convite-titulo">
              {{ conviteFeito.pendencias.length
                ? `A conta de ${conviteFeito.nome} foi criada — mas falta terminar.`
                : `${conviteFeito.nome} já pode entrar e abrir o checklist dela.` }}
            </p>
            <p class="fr-convite-dados">
              <span>E-mail: <strong>{{ conviteFeito.email }}</strong></span>
              <span>Senha: <strong class="fr-senha">{{ conviteFeito.senha }}</strong></span>
            </p>
            <div class="fr-acoes">
              <button type="button" class="fr-btn primario" @click="copiarSenha">
                {{ senhaCopiada ? 'Copiado' : 'Copiar para entregar' }}
              </button>
            </div>
            <!-- O QUE FICOU PELA METADE, ao lado da senha e nunca no lugar
                 dela. Criar a conta é o passo 1 de 5 (senha a trocar, acesso à
                 Frota nos dois modelos, e o elo com a ficha) — a revisão pegou
                 a tela dizendo "já pode entrar" para uma conta que não abria a
                 Frota. -->
            <ul class="fr-convite-pendencias" v-if="conviteFeito.pendencias.length">
              <li v-for="(pnd, i) in conviteFeito.pendencias" :key="i">{{ pnd }}</li>
            </ul>
            <p class="fr-ajuda">
              No primeiro acesso o aplicativo pede pra ela trocar a senha. Esta senha aparece
              <strong>uma vez só</strong> — copie antes de fechar. Se perder, um super-admin
              troca a senha dela em Administração.
            </p>
          </div>
          <p class="fr-erro-inline" v-if="erroDoConvite && convidando === null
             && (!conviteFeito || conviteFeito.veiculoId === c.veiculo.id)">{{ erroDoConvite }}</p>

          <div class="fr-copiar-tel" v-if="!c.fez && podeCopiarTelefoneNoCadastro(c)">
            <button type="button" class="fr-copiar-tel-btn" :disabled="salvandoTelefone[c.veiculo.id]"
                    @click="copiarTelefoneParaCadastro(c)">
              {{ salvandoTelefone[c.veiculo.id] ? 'Salvando…' : `Salvar este telefone no cadastro de ${c.dono}` }}
            </button>
            <p class="fr-erro-inline" v-if="erroSalvarTelefone[c.veiculo.id]">{{ erroSalvarTelefone[c.veiculo.id] }}</p>
          </div>
          <!-- DIGITAR O TELEFONE (D5). Aparece quando não há telefone em lugar
               nenhum pra copiar — o caso do Breno, do Humberto e da Raissa, que
               hoje não têm como ser cobrados. `v-else-if` da corrente do copiar:
               as duas nunca aparecem juntas, que é o padrão de uma ação por
               bloco. -->
          <div class="fr-digitar-tel" v-else-if="!c.fez && podeDigitarTelefoneNoCadastro(c)">
            <label class="fr-digitar-tel-lab" :for="`tel-${c.veiculo.id}`">
              Telefone de {{ c.dono }}
            </label>
            <div class="fr-digitar-tel-linha">
              <!-- `type=tel` + `inputmode=numeric` abrem o teclado de números no
                   celular. A fonte de 16px é regra do padrão: abaixo disso o
                   iOS dá zoom ao focar e a tela salta na cara de quem digita. -->
              <input :id="`tel-${c.veiculo.id}`" v-model="telefoneDigitado[c.veiculo.id]"
                     type="tel" inputmode="numeric" autocomplete="off"
                     placeholder="(19) 90000-0000"
                     @keyup.enter="salvarTelefoneDigitado(c)">
              <button type="button" class="fr-btn primario" :disabled="salvandoTelefone[c.veiculo.id]"
                      @click="salvarTelefoneDigitado(c)">
                {{ salvandoTelefone[c.veiculo.id] ? 'Salvando…' : 'Salvar' }}
              </button>
            </div>
            <p class="fr-ajuda">
              Fica guardado no cadastro de {{ c.dono }}, valendo para a central toda — não só
              para a Frota.
            </p>
            <p class="fr-erro-inline" v-if="erroSalvarTelefone[c.veiculo.id]">{{ erroSalvarTelefone[c.veiculo.id] }}</p>
          </div>
          <p class="fr-copiado-tel" v-else-if="!c.fez && telefoneSalvoAgora[c.veiculo.id]">
            Telefone salvo no cadastro de {{ c.dono }}.
          </p>
        </div>
      </div>

      
        <!-- ── O HISTÓRICO, NO PÉ DO MESMO CARD (21/08/2026) ──────────────
             Pedido do dono: "o histórico de checklist entra dentro de checklist
             de hoje, no fim do card". Era gaveta própria, e ir de "quem falta
             hoje" para "o que já foi feito" custava fechar uma seção e abrir
             outra — duas perguntas do mesmo assunto, em dois lugares.
             O separador deixa claro onde HOJE acaba e o passado começa. -->
        <div class="fr-historico-no-pe">
          <h3 class="fr-subsecao">Histórico de checklists</h3>
          <p class="fr-ajuda">{{ resumoDasFichas(fichas) }}</p>


        <div class="fr-filtros">
          <button v-for="f in FILTROS_DE_FICHA" :key="f.chave" type="button" class="fr-filtro"
                  :class="{ on: filtroDeFicha === f.chave }" @click="filtroDeFicha = f.chave">
            {{ f.rotulo }}
          </button>
        </div>

        <!-- Os dois seletores listam SÓ quem tem ficha. Oferecer os 31
             colaboradores faria a pessoa procurar num monte de nome que nunca
             devolve linha nenhuma. -->
        <div class="fr-filtros-campo">
          <label class="fr-filtro-campo">
            <span>Carro</span>
            <select v-model="carroDaFicha">
              <option value="">Todos</option>
              <option v-for="v in carrosComFicha" :key="v.id" :value="v.id">{{ v.nome }}</option>
            </select>
          </label>
          <label class="fr-filtro-campo">
            <span>Quem fez</span>
            <select v-model="pessoaDaFicha">
              <option value="">Todas as pessoas</option>
              <option v-for="n in quemFezFicha" :key="n" :value="n">{{ n }}</option>
            </select>
          </label>
        </div>

        <p class="fr-aviso" v-if="!diasDeFicha.length">
          Nenhuma ficha com estes filtros. Toque em “Tudo” e limpe os seletores para ver todas.
        </p>

        <div v-else>
          <div v-for="d in diasDeFicha" :key="d.dia" class="fr-dia-de-ficha">
            <div class="fr-dia-cab">
              <span class="fr-dia-data">{{ d.rotulo }}</span>
              <span class="fr-dia-conta">{{ d.fichas.length === 1 ? '1 ficha' : `${d.fichas.length} fichas` }}</span>
            </div>
            <button v-for="f in d.fichas" :key="f.id" type="button" class="fr-ficha-linha"
                    @click="abrirFichaDoHistorico(f)">
              <span class="fr-ficha-carro">{{ f.veiculoNome }}</span>
              <span class="fr-ficha-km">{{ f.hodometro != null ? `${f.hodometro.toLocaleString('pt-BR')} km` : '—' }}</span>
              <span class="fr-ficha-quem">{{ f.pessoa_nome || 'quem fez não ficou registrado' }}</span>
              <span class="fr-ficha-selos">
                <span class="fr-selo" :class="{ 'com-ressalva': f.resultado === 'com_ressalvas' }">
                  {{ f.resultado === 'com_ressalvas' ? 'Com ressalvas' : 'Liberado' }}
                </span>
                <!-- "Não assinada" é dito com todas as letras: um espaço em
                     branco aqui seria indistinguível de "a tela não sabe". -->
                <span class="fr-selo" :class="{ 'sem-assinatura': !f.assinada }">
                  {{ f.assinada ? 'Assinada' : 'Sem assinatura' }}
                </span>
              </span>
            </button>
          </div>
          <!-- DIZ O PRÓPRIO LIMITE. A consulta traz 120 dias; sem esta frase a
               tela deixaria parecer que isto é tudo que já foi feito. -->
          <p class="fr-ajuda fr-fichas-limite">Mostrando os últimos 120 dias.</p>
        </div>

          <!-- O botão só existe quando há linha escondida. Ver mostrar-mais.js:
               "ver mais 50" numa lista de 12 é promessa que a tela não cumpre. -->
          <div class="fr-ver-mais" v-if="verMaisFichas">
            <button type="button" class="fr-btn" @click="mostrarMaisFichas">{{ verMaisFichas }}</button>
          </div>
        </div>
      </Gaveta>

      <!-- HISTÓRICO DE CHECKLISTS (D6). Por DIA, do mais novo pro mais velho —
           escolha do dono: a pergunta que ele faz é "o que aconteceu essa
           semana", não "me mostra tudo do Cayenne" (pra essa já existe a ficha
           do veículo). Clicar abre o MESMO detalhe que o histórico de reservas
           já usa: não nasce tela nova. -->


      <Gaveta v-if="gv('problemas')" :titulo="gv('problemas').titulo" :estado="gv('problemas').estado"
              :aberta="gv('problemas').aberta" :travada-aberta="gv('problemas').travadaAberta"
              id="gv-problemas" @alternar="alternarGaveta('problemas')">
      <p class="fr-erro" v-if="falhaRespostas">
        Não consegui carregar as respostas de hoje, então não dá pra saber se algum item ficou
        marcado como problema. Recarregue a página; se continuar assim, avise quem administra a Frota.
      </p>
      <p class="fr-aviso" v-else-if="!problemasAbertos.length">
        Nenhum item marcado como problema nas fichas de hoje.
      </p>
      <div class="fr-lista" v-else>
        <div v-for="(pr, i) in problemasAbertos" :key="i" class="fr-card ruimzao">
          <div class="fr-card-topo">
            <div class="fr-card-ident">
              <span class="fr-card-nome">{{ pr.veiculoNome }}</span>
              <span class="fr-placa">{{ pr.item }}</span>
            </div>
          </div>
          <p class="fr-pedido-motivo">{{ pr.observacao || 'Sem observação escrita para este item.' }}</p>
        </div>
      </div>

      <!-- AS CÓPIAS EM PDF NO ZOHO (D23).
           Este `<h2>` não tem `v-if` NENHUM de propósito: ele encerra a corrente
           `v-if/v-else-if/v-else` do bloco de problemas logo acima e começa um
           quadro independente. (A lista de carros que vem depois também não tem
           diretiva, então nada aqui se encadeia com nada — que é o defeito que o
           comentário lá em cima, sobre o `v-else` solto, existe pra evitar.)

           O QUADRO É DISCRETO POR PROJETO: quando está tudo bem ele é UMA frase
           e mais nada. Só ganha caixa quando alguma cópia não chegou. Espera não
           é problema — o robô sobe de 10 em 10 minutos, e uma ficha assinada há
           dois minutos está esperando o relógio, não quebrada. -->
      </Gaveta>

      <Gaveta v-if="gv('zoho')" :titulo="gv('zoho').titulo" :estado="gv('zoho').estado"
              :aberta="gv('zoho').aberta" :travada-aberta="gv('zoho').travadaAberta"
              id="gv-zoho" @alternar="alternarGaveta('zoho')">
      <p class="fr-erro" v-if="copias.falhaLeitura">
        Não consegui olhar se as cópias em PDF chegaram na pasta do Zoho. As fichas assinadas
        continuam gravadas e valendo — o que não deu pra conferir foi o arquivo. Recarregue a
        página; se continuar assim, avise quem cuida da central.
      </p>
      <template v-else>
        <p class="fr-aviso">{{ copias.frase }}</p>
        <div class="fr-copias" v-if="copias.temProblema">
          <div v-for="(g, i) in copias.grupos" :key="i" class="fr-copia-grupo" :class="g.gravidade">
            <p class="fr-copia-titulo">{{ g.titulo }}</p>
            <ul class="fr-copia-carros">
              <li v-for="(nome, j) in g.veiculos" :key="j">{{ nome }}</li>
            </ul>
            <!-- O texto do robô como ele escreveu. Ele já vem em português
                 dizendo o que FAZER; trocar por "erro ao enviar" jogaria fora
                 justamente a parte que resolve. -->
            <p class="fr-copia-motivo">{{ g.mensagem }}</p>
          </div>
          <p class="fr-copia-calma">
            As fichas continuam assinadas e valendo. O que está atrasado é só o arquivo em PDF —
            a prova mora aqui dentro, não no papel.
          </p>
        </div>
      </template>

      </Gaveta>

      <Gaveta v-if="gv('veiculos')" :titulo="gv('veiculos').titulo" :estado="gv('veiculos').estado"
              :aberta="gv('veiculos').aberta" :travada-aberta="gv('veiculos').travadaAberta"
              id="gv-veiculos" @alternar="alternarGaveta('veiculos')">
      <div class="fr-lista" id="fr-ancora-veiculos">
        <div v-for="l in linhas" :key="l.veiculo.id" class="fr-card" :class="{ rua: l.naRua, parado: !l.disponivel && !l.naRua }">
          <div class="fr-card-topo">
            <div class="fr-card-ident">
              <span class="fr-card-nome">{{ l.veiculo.nome }}</span>
              <span class="fr-placa">{{ l.veiculo.placa }}</span>
            </div>
            <span class="fr-selo" :class="{ rua: l.naRua, livre: l.disponivel }">{{ resumoDoEstado(l) }}</span>
          </div>

          <div class="fr-dados">
            <div class="fr-dado">
              <span class="fr-dado-lab">Quilometragem</span>
              <span class="fr-dado-val">{{ l.km == null ? '—' : l.km.toLocaleString('pt-BR') + ' km' }}</span>
            </div>
            <div class="fr-dado">
              <span class="fr-dado-lab">Combustível</span>
              <span class="fr-dado-val" :class="{ alerta: l.precisaAbastecer }">
                {{ rotuloDoTanque(l.tanque) }}<template v-if="l.precisaAbastecer"> · abastecer</template>
              </span>
            </div>
          </div>

          <!-- Sem "Vou usar" aqui (correção do dono): esta aba é para GERIR a
               frota. Pegar carro é na aba Motorista. -->
          <div class="fr-acoes fr-acoes-veiculo">
            <button class="fr-btn primario" v-if="podeEditar" @click="abrirVeiculo(l.veiculo)">Abrir ficha</button>
            <button v-if="podeEditar && l.naRua" class="fr-btn" @click="abrirDevolucao(l)">Devolver</button>
            <!-- REGISTRAR O QUE ACONTECEU FORA DO APLICATIVO (21/08/2026).
                 Antes disto não havia porta nenhuma: carro só saía pelo "Peguei
                 o carro" da aba Motorista, que exige reserva aprovada. Quem
                 pegasse o carro no sábado, sem o celular na mão, não tinha como
                 registrar depois — e o carro ficava eternamente "livre" numa
                 tela que jurava que ele estava na garagem.
                 Só no carro que a tela mostra parado: oferecer isso num carro
                 que já está na rua criaria duas viagens abertas do mesmo
                 veículo. -->
            <button v-if="podeEditar && !l.naRua && l.veiculo.situacao === 'ativo'"
                    class="fr-btn" @click="abrirRetiradaAvulsa(l)">Registrar retirada</button>
            <!-- POSSE (D26): quem administra a Frota passa ou encerra a posse de
                 QUALQUER carro, não só do seu. O caso real: a Bravo Blackmotion
                 está com Gabriel Alves desde 11/08 — o dono emprestou, ele
                 esqueceu de devolver, e não havia caminho na tela pra desfazer.
                 Antes disto, "Passar o carro" só existia na aba Motorista e só
                 pro carro fixo da própria pessoa. -->
            <!-- Aparece em TODO carro ativo. Antes só aparecia com posse
                 aberta, e aí não havia como recolher um carro que ninguém tinha
                 pegado. `passarPara` trata "não havia posse": só abre, ou nem
                 isso.

                 O RÓTULO ERA TRÊS, E VIROU UM (20/08/2026, pedido do dono:
                 "encurta o rótulo"). Ele enumerava as ações — "Passar, devolver
                 ou recolher" / "Encerrar ou recolher" / "Passar ou recolher" —
                 pra dizer o que dava pra fazer com aquele carro ANTES do
                 clique. A intenção era boa e o preço apareceu na medição: com
                 28 caracteres, o botão quebrava em quatro linhas numa coluna de
                 95px e era ele que empurrava a altura de todos os vizinhos.

                 Quem faz esse trabalho agora é o modal, que já se chama "Quem
                 está com o {carro}" e explica tudo dentro. O botão só precisa
                 levar até lá — e continua sendo verbo, como o padrão manda:
                 controle diz o que acontece.

                 "Devolver" e "encerrar" saíram do rótulo, não da tela: devolver
                 é passar de volta pro dono, e encerrar é recolher. As duas
                 continuam no modal, com nome próprio. -->
            <button v-if="podeEditar && l.veiculo.situacao !== 'alienado'" class="fr-btn"
                    @click="abrirPasse(l.veiculo)">Passar ou recolher</button>
            <a v-if="zapDoVeiculo(l.veiculo)" class="fr-btn fr-zap" :href="zapDoVeiculo(l.veiculo)"
                 target="_blank" rel="noopener"
                 :title="l.veiculo.contato_nome ? ('Falar com ' + l.veiculo.contato_nome + ' no WhatsApp') : 'Falar no WhatsApp'">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17.47 14.38c-.3-.15-1.74-.86-2-.96-.27-.1-.47-.15-.66.15-.2.29-.76.95-.93 1.15-.17.2-.34.22-.63.07-.3-.15-1.25-.46-2.38-1.47-.88-.78-1.47-1.75-1.64-2.05-.17-.29-.02-.45.13-.6.13-.13.3-.34.44-.51.15-.17.2-.29.3-.49.1-.2.05-.37-.02-.51-.08-.15-.66-1.59-.9-2.18-.24-.57-.48-.5-.66-.51h-.57c-.2 0-.51.07-.78.37-.27.29-1.02 1-1.02 2.43s1.05 2.82 1.2 3.02c.15.2 2.06 3.14 4.99 4.4.7.3 1.24.48 1.66.62.7.22 1.33.19 1.83.12.56-.08 1.74-.71 1.98-1.4.24-.68.24-1.27.17-1.39-.07-.12-.27-.2-.56-.34M12 2a10 10 0 0 0-8.6 15.1L2 22l5.05-1.32A10 10 0 1 0 12 2"/></svg>
                WhatsApp
              </a>
          </div>
        </div>
      </div>
      </Gaveta>
    </template>

    <!-- ÁREA REVISÕES: o que está vencendo, e o plano que o dono edita. -->
    <template v-if="area === 'revisoes' && !carregando && !falha">
      <h2 class="fr-secao">Chegando a hora</h2>
      <p class="fr-aviso" v-if="!revisoesPorVeiculo.length">
        Nada vencendo agora. Quando algum carro chegar perto de uma troca, ele aparece aqui —
        o histórico completo de cada um fica na ficha dele, na aba Gestão.
      </p>
      <div class="fr-lista" v-else>
        <div v-for="r in revisoesPorVeiculo" :key="r.linha.veiculo.id"
             class="fr-card" :class="{ espera: r.resumo.nivel === 'perto', ruimzao: r.resumo.nivel === 'vencida' }">
          <div class="fr-card-topo">
            <div class="fr-card-ident">
              <span class="fr-card-nome">{{ r.linha.veiculo.nome }}</span>
              <span class="fr-placa">{{ r.linha.km == null ? 'sem quilometragem' : r.linha.km.toLocaleString('pt-BR') + ' km' }}</span>
            </div>
            <span class="fr-selo"
                  :class="{ ruim: r.resumo.nivel === 'vencida', espera: r.resumo.nivel === 'perto', boa: r.resumo.nivel === 'em-dia' }">
              {{ r.resumo.texto }}
            </span>
          </div>
          <ul class="fr-itens">
            <li v-for="i in r.itens" :key="i.item" :class="i.situacao">
              <span class="fr-item-nome">{{ i.item }}</span>
              <span class="fr-item-txt">{{ i.texto }}</span>
            </li>
          </ul>
          <!-- Falar com a mecânica é o passo seguinte a ver "vencida". O botão
               fica aqui pra não obrigar a abrir a ficha só pra achar o número. -->
          <div class="fr-acoes" v-if="zapDaOficina(r.linha.veiculo, r.linha.km)">
            <a class="fr-btn fr-zap" :href="zapDaOficina(r.linha.veiculo, r.linha.km)" target="_blank" rel="noopener"
               :title="'Falar com ' + (r.linha.veiculo.oficina_nome || 'a oficina') + ' no WhatsApp'">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17.47 14.38c-.3-.15-1.74-.86-2-.96-.27-.1-.47-.15-.66.15-.2.29-.76.95-.93 1.15-.17.2-.34.22-.63.07-.3-.15-1.25-.46-2.38-1.47-.88-.78-1.47-1.75-1.64-2.05-.17-.29-.02-.45.13-.6.13-.13.3-.34.44-.51.15-.17.2-.29.3-.49.1-.2.05-.37-.02-.51-.08-.15-.66-1.59-.9-2.18-.24-.57-.48-.5-.66-.51h-.57c-.2 0-.51.07-.78.37-.27.29-1.02 1-1.02 2.43s1.05 2.82 1.2 3.02c.15.2 2.06 3.14 4.99 4.4.7.3 1.24.48 1.66.62.7.22 1.33.19 1.83.12.56-.08 1.74-.71 1.98-1.4.24-.68.24-1.27.17-1.39-.07-.12-.27-.2-.56-.34M12 2a10 10 0 0 0-8.6 15.1L2 22l5.05-1.32A10 10 0 1 0 12 2"/></svg>
              {{ r.linha.veiculo.oficina_nome || 'Oficina' }}
            </a>
          </div>
        </div>
      </div>

      <h2 class="fr-secao">Todos os carros, item por item</h2>
      <p class="fr-aviso" v-if="revisoesDeTodosOsCarros.length">
        Toque no carro para ver os {{ planoAtivo.length }} itens do plano — inclusive os que
        estão longe de vencer.
      </p>
      <SanfonaDeRevisoes :cartoes="revisoesDeTodosOsCarros" :pode-lancar="podeEditar"
                         @lancar="abrirLancamento" />
    </template>

    <!-- FICHA DO VEÍCULO: tudo do carro num lugar só, e editável. -->
    <div class="fr-ficha-fundo" v-if="veiculoAberto" v-trava-rolagem :style="{ zIndex: camadas.veiculo }" @click.self="fecharVeiculo">
      <div class="fr-ficha" role="dialog">
        <div class="fr-ficha-topo">
          <span class="fr-ficha-titulo">
            {{ veiculoAberto.novo ? 'Novo veículo' : (veiculoAberto.nome + ' · ' + veiculoAberto.placa) }}
          </span>
          <button class="fr-btn-ajuda" @click="passeioVeiculoAberto = true" title="Passeio pelos campos">?</button>
          <button class="fr-fechar" @click="fecharVeiculo" aria-label="Fechar">✕</button>
        </div>
        <PasseioGuiado v-model="passeioVeiculoAberto" :passos="PASSOS_VEICULO" />
        <div class="fr-ficha-corpo">
          <p class="fr-tutorial-fixo">{{ TEXTOS.veiculoAberto }}</p>
          <!-- O NÚMERO DE PATRIMÔNIO VEM PRIMEIRO, e destacado (pedido do dono,
               20/08/2026: "destacar mais esse campo, talvez jogar acima"). É ele
               que faz o item nascer no Patrimônio — sem ele o carro fica órfão,
               como os três KWIDs ficaram naquele mesmo dia.

               A tela NÃO sugere número: decisão dele, porque quem cadastra tem o
               adesivo na mão. No lugar da sugestão, `avisoDaEtiqueta` conta o
               que o número digitado JÁ É — inclusive que o 47 é um microfone. -->
          <template v-if="veiculoAberto.novo">
            <h3 class="fr-grupo">O que é obrigatório</h3>
            <div class="fr-patrimonio-destaque" data-tour="veic-patrimonio">
              <label class="fr-campo">
                <span class="fr-lab">Nº de patrimônio</span>
                <input v-model="vForm.etiqueta" type="text" inputmode="numeric"
                       placeholder="o número do adesivo colado no carro"
                       @blur="conferirEtiqueta" @input="avisoEtiqueta = null">
              </label>
              <p class="fr-prova-frase fr-etiqueta-aviso" v-if="avisoEtiqueta" :class="avisoEtiqueta.tom">
                {{ avisoEtiqueta.texto }}
              </p>
              <span class="fr-ajuda" v-else>
                O mesmo número da etiqueta do Patrimônio. Se ainda não existir lá, eu crio
                o item junto ao gravar — você não precisa cadastrar duas vezes.
              </span>
            </div>

            <!-- COMO O CARRO FICA. As quatro respostas são as palavras do dono, e
                 por baixo são as duas colunas que já existiam (`situacao` e
                 `pessoa_id`) — ver COMO_FICA em etiqueta-do-veiculo.js.

                 Até 20/08 estes dois campos ficavam ESCONDIDOS no cadastro e o
                 carro nascia sempre "ativo e sem responsável". Ele pediu o
                 contrário: que a resposta seja obrigatória na hora. -->
            <div class="fr-campo">
              <span class="fr-lab">Como este carro fica?</span>
              <div class="fr-comofica">
                <button v-for="o in COMO_FICA" :key="o.chave" type="button"
                        class="fr-comofica-btn" :class="{ on: vForm.comoFica === o.chave }"
                        @click="vForm.comoFica = o.chave">{{ o.rotulo }}</button>
              </div>
            </div>
          </template>

          <h3 class="fr-grupo">Identificação</h3>
          <div class="fr-dupla">
            <label class="fr-campo" data-tour="veic-nome"><span class="fr-lab">Nome</span><input v-model="vForm.nome" type="text"></label>
            <label class="fr-campo"><span class="fr-lab">Placa</span><input v-model="vForm.placa" type="text"></label>
            <label class="fr-campo"><span class="fr-lab">Marca</span><input v-model="vForm.marca" type="text"></label>
            <label class="fr-campo"><span class="fr-lab">Ano</span><input v-model="vForm.ano" type="text" inputmode="numeric"></label>
            <label class="fr-campo"><span class="fr-lab">Cor</span><input v-model="vForm.cor" type="text"></label>
            <label class="fr-campo"><span class="fr-lab">Combustível</span><input v-model="vForm.combustivel" type="text"></label>
            <label class="fr-campo"><span class="fr-lab">Renavam</span><input v-model="vForm.renavam" type="text"></label>
            <label class="fr-campo"><span class="fr-lab">Chassi</span><input v-model="vForm.chassi" type="text"></label>
            <label class="fr-campo"><span class="fr-lab">Tipo de óleo</span><input v-model="vForm.tipo_oleo" type="text"></label>
            <label class="fr-campo" v-if="!veiculoAberto.novo">
              <span class="fr-lab">Situação</span>
              <select v-model="vForm.situacao">
                <option value="ativo">Ativo</option>
                <option value="em_manutencao">Em manutenção</option>
                <option value="inativo">Parado</option>
                <option value="alienado">Fora da frota</option>
              </select>
            </label>
          </div>

          <!-- DE QUEM É e ONDE ESTÁ são duas perguntas, e por isso dois campos.
               Decisão do dono, e o motivo importa pra ninguém "simplificar" isso
               depois: um carro da RBV Company pode passar a semana guardado na
               Fábrica Conchal da Vessel sem virar patrimônio da Vessel. A
               empresa NÃO é deduzida do local escolhido. -->
          <!-- D32, revisto pelo dono em 12/08: "de quem é o carro" e "com quem
               eu falo" são a MESMA pergunta na cabeça de quem usa, e por isso
               viram uma seção só. Oficina é outra coisa — continua existindo
               logo abaixo, com a mecânica, o telefone dela e o histórico do
               que ela já trocou. -->
          <h3 class="fr-grupo">De quem é, onde fica e com quem falar</h3>
          <div class="fr-dupla">
            <div class="fr-campo" data-tour="veic-responsavel"
                 v-if="!veiculoAberto.novo || vForm.comoFica === 'responsavel'">
              <span class="fr-lab">Responsável — de quem é o carro</span>
              <p class="fr-erro-inline" v-if="falhaPessoas">
                Não consegui carregar a lista de colaboradores. O campo pode estar vazio por
                causa disso, e não porque não haja ninguém cadastrado. Recarregue a página; se
                continuar, peça acesso a Colaboradores e Acessos (ou a Patrimônio/Frota) a quem
                administra.
              </p>
              <EscolhaDePessoa
                v-model="vForm.pessoa_id"
                :pessoas="comSelecionada(pessoasAtivas, pessoas, vForm.pessoa_id)" :todas="pessoas"
                :marcas="empresasPat" :setores="setores"
                :pode-criar="podeEditar" :criando="criandoPessoa && campoDeCriacao === 'responsavel'"
                :recado-de-erro="campoDeCriacao === 'responsavel' ? erroDePessoa : ''"
                :aviso="campoDeCriacao === 'responsavel' ? avisoDeCriacao : ''"
                rotulo="Responsável — de quem é o carro" texto-vazio="— ninguém —"
                @criar="(p) => criarPessoaRapida(p, 'responsavel')" @criar-setor="(p) => criarSetorRapido(p, 'responsavel')"
                @criar-marca="(p) => criarMarcaRapida(p, 'responsavel')" @abrir="limparAvisoDeCriacao" />
              <span class="fr-ajuda">
                Quem responde pelo carro — é este nome que a multa procura quando ninguém
                pegou o carro emprestado. Carro com responsável deixa de aparecer como livre.
                Vale também no Patrimônio: mudar aqui muda lá, e o contrário também.
              </span>
            </div>
            <label class="fr-campo" data-tour="veic-empresa">
              <span class="fr-lab">De qual empresa é este carro</span>
              <select v-model="vForm.empresa_id">
                <option value="">— não informado —</option>
                <option v-for="e in empresasPat" :key="e.id" :value="e.id">{{ e.nome }}</option>
              </select>
              <span class="fr-ajuda">
                De quem é o carro, não onde ele fica. Um carro da RBV pode ficar guardado
                num local da Vessel sem deixar de ser da RBV.
              </span>
            </label>
          </div>

          <!-- LOCAL: era uma caixa de digitar às cegas ("Barracão, Conchal…").
               Agora é a MESMA árvore Marca › Local › Ambiente que o Patrimônio
               usa. O texto que já estava escrito não some: ele continua guardado
               na ficha e aparece aqui até alguém apontar o local certo — e
               continua guardado depois disso também. -->
          <!-- Sem um `fr-lab` por fora: o próprio componente já escreve o rótulo
               dentro da caixa do "o que está valendo agora", e dois rótulos
               iguais um em cima do outro só ocupam altura de celular. -->
          <div class="fr-campo" data-tour="veic-local">
            <p class="fr-erro-inline" v-if="falhaArvore">
              Não consegui ler a lista de locais do Patrimônio. A lista abaixo pode estar
              vazia por causa disso, e não porque não haja local cadastrado. Recarregue a
              página; se continuar, confirme se você tem acesso ao Patrimônio.
            </p>
            <EscolhaDeLocalEAmbiente
              :empresas="empresasPat" :locais="locaisPat" :comodos="comodosPat"
              v-model:localId="vForm.local_id"
              v-model:comodoId="vForm.comodo_id"
              :texto-livre="vForm.local_texto"
              com-ambiente
              rotulo="Onde este carro fica"
              :pode-criar="podeEditar" :criando="criandoNaArvore"
              @criar="criarNaArvore" />
            <p class="fr-erro-inline" v-if="erroDaArvore">{{ erroDaArvore }}</p>
            <span class="fr-ajuda" v-if="vForm.local_texto">
              O que estava escrito à mão continua guardado nesta ficha mesmo depois de você
              apontar o local — nada é apagado.
            </span>
          </div>

          <div class="fr-dupla">
            <label class="fr-campo" data-tour="veic-contato">
              <span class="fr-lab">Contato — a quem perguntar</span>
              <input v-model="vForm.contato_nome" type="text">
              <span class="fr-ajuda">
                O NOME de quem resolve as coisas deste carro. <strong>Não é o mesmo que
                responsável</strong>: pode ser quem tem a chave, quem cuida da manutenção
                ou a supervisora da loja. Ex.: Marcus Vinicius
              </span>
            </label>
            <label class="fr-campo">
              <span class="fr-lab">O que essa pessoa faz</span>
              <input v-model="vForm.contato_papel" type="text">
              <span class="fr-ajuda">Ex.: locadora, seguro, guincho</span>
            </label>
            <label class="fr-campo">
              <span class="fr-lab">Telefone do contato</span>
              <input v-model="vForm.contato_telefone" type="tel" inputmode="tel">
              <!-- Diz POR QUE não dá link, em vez de só não mostrar o botão: sem
                   DDD o app se recusa a montar o link, e a pessoa precisa saber
                   que é isso — não que o WhatsApp "não funciona". -->
              <span class="fr-ajuda" v-if="vForm.contato_telefone && !linkDoWhatsapp(vForm.contato_telefone)">
                {{ porQueNaoDaLink(vForm.contato_telefone) }}
              </span>
              <span class="fr-ajuda" v-else>Ex.: (19) 3033-9837</span>
            </label>
          </div>

          <h3 class="fr-grupo" data-tour="veic-oficina">Oficina</h3>
          <div class="fr-dupla">
            <label class="fr-campo">
              <span class="fr-lab">Mecânica</span>
              <input v-model="vForm.oficina_nome" type="text">
              <span class="fr-ajuda">Ex.: JHM Auto Center</span>
            </label>
            <label class="fr-campo">
              <span class="fr-lab">Telefone da oficina</span>
              <input v-model="vForm.oficina_telefone" type="tel" inputmode="tel">
              <span class="fr-ajuda" v-if="vForm.oficina_telefone && !linkDoWhatsapp(vForm.oficina_telefone)">
                {{ porQueNaoDaLink(vForm.oficina_telefone) }}
              </span>
              <span class="fr-ajuda" v-else>Ex.: (19) 3033-9837</span>
            </label>
          </div>

          <!-- O bloco abaixo depende de um `veiculo_id` que só existe depois
               do carro estar gravado — não faz sentido pra um carro ainda em
               criação (F9). Mora logo abaixo da Oficina (D32, revisto): é o
               registro do que aquela oficina já trocou. -->
          <template v-if="!veiculoAberto.novo">
            <h3 class="fr-grupo" data-tour="veic-historico">Histórico de manutenção</h3>
            <ul class="fr-hist" v-if="historicoDoVeiculo.length">
              <li v-for="h in historicoDoVeiculo" :key="h.id">
                <span class="fr-item-nome">{{ h.item }}</span>
                <span class="fr-item-txt">
                  {{ h.km ? h.km.toLocaleString('pt-BR') + ' km' : 'sem km' }}
                  <template v-if="h.feita_em"> · {{ h.feita_em.split('-').reverse().join('/') }}</template>
                  <template v-if="h.oficina"> · {{ h.oficina }}</template>
                </span>
                <button class="fr-mini" @click="apagarRevisao(h)" title="Apagar este registro">✕</button>
              </li>
            </ul>
            <p class="fr-ajuda" v-else>Nenhuma manutenção registrada neste carro ainda.</p>

            <!-- O formulário de UMA TROCA POR VEZ saiu daqui (D27): registrar 3
                 trocas era preencher 15 campos, redigitando KM, data e oficina a
                 cada rodada, e a frota inteira tinha 2 trocas registradas em 10
                 carros. Agora é uma ficha só, com as caixas do que foi trocado.
                 O histórico logo acima NÃO saiu: as 2 trocas já gravadas não têm
                 cabeçalho de lançamento e seguem aparecendo e sendo apagáveis
                 por `historicoDoVeiculo` e `apagarRevisao`. -->
            <!-- `v-if="podeEditar"`: a mesma trava que a sanfona de Revisões usa
                 no botão irmão, e a mesma regra que a permissão de
                 `frota_manutencoes` aplica no banco (migration 041). Aqui ela é
                 redundante hoje — só se chega nesta ficha por um botão que já
                 exige `podeEditar` —, mas trava dita no lugar do botão é trava
                 que não se perde quando alguém abrir outro caminho até aqui. -->
            <div class="fr-acoes" v-if="podeEditar">
              <button class="fr-btn primario" @click="abrirLancamento(veiculoAberto)">
                + Lançar manutenção
              </button>
            </div>
            <p class="fr-ajuda">
              Uma nota da oficina, mesmo com várias peças trocadas, é um lançamento só.
            </p>
          </template>
          <p class="fr-ajuda" v-else>
            O histórico de manutenção fica disponível depois de gravar o carro pela primeira vez.
          </p>

          <h3 class="fr-grupo" data-tour="veic-contrato">Contrato e valores</h3>
          <div class="fr-dupla">
            <label class="fr-campo">
              <span class="fr-lab">Contrato</span>
              <input v-model="vForm.contrato" type="text">
              <span class="fr-ajuda">Ex.: CTR-007</span>
            </label>
            <label class="fr-campo"><span class="fr-lab">Aluguel por mês (R$)</span><input v-model="vForm.aluguel" type="text" inputmode="decimal"></label>
            <label class="fr-campo"><span class="fr-lab">Valor FIPE (R$)</span><input v-model="vForm.fipe" type="text" inputmode="decimal"></label>
            <label class="fr-campo"><span class="fr-lab">Categoria comercial</span><input v-model="vForm.categoria_comercial" type="text"></label>
          </div>

          <h3 class="fr-grupo">Seguro</h3>
          <div class="fr-dupla">
            <label class="fr-campo"><span class="fr-lab">Seguradora</span><input v-model="vForm.seguro_seguradora" type="text"></label>
            <label class="fr-campo"><span class="fr-lab">Apólice</span><input v-model="vForm.seguro_apolice" type="text"></label>
            <label class="fr-campo"><span class="fr-lab">Vence em</span><input v-model="vForm.seguro_vence_em" type="date"></label>
            <label class="fr-campo"><span class="fr-lab">Valor (R$)</span><input v-model="vForm.seguroValor" type="text" inputmode="decimal"></label>
          </div>

          <h3 class="fr-grupo">Equipamentos e patrimônio</h3>
          <div class="fr-dupla">
            <label class="fr-campo">
              <span class="fr-lab">Tag de pedágio</span>
              <input v-model="vForm.tag_pedagio" type="text">
              <span class="fr-ajuda">Ex.: Sem Parar, número da tag</span>
            </label>
            <label class="fr-campo">
              <span class="fr-lab">Rastreador</span>
              <input v-model="vForm.rastreador" type="text">
              <span class="fr-ajuda">Ex.: empresa, identificador</span>
            </label>
            <label class="fr-campo">
              <span class="fr-lab">Código patrimonial</span>
              <input v-model="vForm.codigo_patrimonial" type="text">
              <span class="fr-ajuda">Ex.: RBB-007</span>
            </label>
            <!-- Ao criar, a lista é bensLivres — só Veículos ainda sem carro
                 ligado (F9). Oferecer um bem já ligado duplicaria o carro.
                 Some o campo inteiro se não sobrar nenhum, em vez de mostrar
                 um seletor vazio sem dizer por quê. -->
            <label class="fr-campo" v-if="!veiculoAberto.novo || bensLivres.length" data-tour="veic-bem">
              <span class="fr-lab">Bem no Patrimônio</span>
              <select v-model="vForm.bem_id" @change="aoEscolherBem">
                <option value="">— não ligado —</option>
                <option v-for="b in (veiculoAberto.novo ? bensLivres : bensVeiculo)" :key="b.id" :value="b.id">
                  {{ b.numero ? String(b.numero).padStart(6, '0') + ' · ' : '' }}{{ b.nome }}
                </option>
              </select>
              <span class="fr-ajuda" v-if="veiculoAberto.novo">
                Escolher um bem já cadastrado traz nome e marca pra ficha, e liga os dois.
              </span>
              <span class="fr-ajuda" v-else>Só para carro próprio. Os alugados não são bens da empresa.</span>
            </label>
          </div>

          <label class="fr-campo">
            <span class="fr-lab">Observação</span>
            <input v-model="vForm.observacao" type="text">
          </label>

          <!-- Checklists assinados depende de um `veiculo_id` que só existe
               depois do carro estar gravado — não faz sentido pra um carro
               ainda em criação (F9). O registro de manutenção saiu daqui e
               mora agora dentro da seção Oficina (D32, revisto); este bloco
               ficou sozinho, então ganhou seu próprio `template v-if`. -->
          <template v-if="!veiculoAberto.novo">
            <!-- CONFERIR AS ASSINATURAS (D21). Fica na ficha do carro porque a
                 pergunta é sobre UM carro: a corrente é por veículo. -->
            <h3 class="fr-grupo">Checklists assinados</h3>
            <p class="fr-ajuda">
              Confere se alguma ficha deste carro foi alterada depois de assinada. Não muda nada —
              só lê e recalcula.
            </p>
            <div class="fr-acoes">
              <button class="fr-btn" :disabled="conferindo" @click="conferirAssinaturas(veiculoAberto)">
                {{ conferindo ? 'Conferindo…' : 'Conferir as assinaturas deste carro' }}
              </button>
            </div>
            <p class="fr-conferencia" v-if="conferencia" :class="conferencia.nivel">{{ conferencia.texto }}</p>
          </template>

          <ul class="fr-problemas" v-if="errosDoVeiculo.length">
            <li v-for="(e, i) in errosDoVeiculo" :key="i">{{ e }}</li>
          </ul>
        </div>
        <div class="fr-ficha-rodape">
          <button class="fr-btn" @click="fecharVeiculo">Fechar</button>
          <button class="fr-btn primario" :disabled="gravando" @click="salvarVeiculo">
            {{ gravando ? 'Gravando…' : (veiculoAberto.novo ? 'Acrescentar' : 'Gravar') }}
          </button>
        </div>
      </div>
    </div>

    <!-- ABA PLANO DE MANUTENÇÃO: as duas metades da mesma manutenção de
         primeiro escalão (D10) — o que a oficina troca por quilometragem, e o
         que o motorista confere sozinho. Eram duas abas porque cada assunto
         foi tratado separado; são o mesmo assunto visto de dois lados, então
         moram juntos aqui, quilometragem primeiro (o que já existia) e
         checklist depois. -->
    <!-- RELATÓRIOS: a mesma casca do Patrimônio. A palavra do primeiro nível
         aqui é "empresa", e NÃO "marca": nesta tela `marca` já quer dizer
         VOLVO, BMW, FIAT — e está preenchida nos 10 veículos, enquanto a
         empresa do grupo está vazia. Dois campos, o mesmo nome. -->
    <template v-if="area === 'relatorios' && !carregando && !falha">
      <aba-de-relatorios
        :relatorios="RELATORIOS_DA_FROTA"
        :contexto="{ sbClient, veiculos, empresas: empresasPat, locais: locaisPat,
                     comodos: comodosPat, pessoas, plano, revisoes, fichas }"
        :empresas="empresasPat"
        :locais="locaisPat"
        :comodos="comodosPat"
        palavra-da-marca="empresa"
        nome-do-arquivo="frota"
        :pode-exportar="podeExportarRelatorio" />
    </template>

    <template v-if="area === 'plano' && !carregando && !falha">
      <h2 class="fr-secao" data-tour="fr-secao-plano">Plano de manutenção — o que a oficina troca, de quantos em quantos quilômetros</h2>
      <p class="fr-aviso">
        Estes números são os que geram os avisos da aba Revisões. Mude quando o mecânico mandar,
        e acrescente o que faltar.
      </p>
      <ul class="fr-pedidos">
        <li v-for="p in plano" :key="p.id" class="fr-pedido" :class="{ desligado: !p.ativo }">
          <div class="fr-pedido-topo">
            <strong>{{ p.item }}</strong>
            <span class="fr-item-km">{{ p.a_cada_km.toLocaleString('pt-BR') }} km</span>
          </div>
          <div class="fr-pedido-quando" v-if="p.observacao">{{ p.observacao }}</div>
          <div class="fr-acoes">
            <button class="fr-btn" @click="abrirItem(p)">Editar</button>
            <!-- O passeio do item ("Desativar") aponta pra ESTE botão, não pra
                 dentro do modal: o modal de editar não tem esse controle, ele
                 mora aqui, na lista. `data-tour` só nasce no item que está
                 sendo editado agora — se apontasse pra todo mundo, o realce
                 pegaria o primeiro item do plano, não o que está aberto. -->
            <button class="fr-btn" @click="alternarItem(p)"
                    :data-tour="(itemEmEdicao && !itemEmEdicao.novo && p.id === itemEmEdicao.id) ? 'item-desativar' : null">
              {{ p.ativo ? 'Desativar' : 'Reativar' }}
            </button>
          </div>
        </li>
      </ul>
      <div class="fr-acoes" style="padding:12px 14px 40px">
        <button class="fr-btn primario" @click="abrirItem(null)">+ Acrescentar item</button>
      </div>

      <h2 class="fr-secao">Checklist — o que o motorista confere sozinho, a cada dia</h2>
      <p class="fr-aviso">
        A lista de itens, e os dias em que o semanal e o mensal caem. Mude do mesmo jeito que
        no plano acima, quando precisar.
      </p>
      <div class="fr-checklist-editor">
        <EditorDeChecklist
          :itens="itensDeChecklist" :config="configDeChecklist" :gravando="gravando"
          :erro-config="erroDaConfig" :erro-item="erroDoItem"
          @salvar-item="salvarItemDeChecklist"
          @alternar-item="alternarItemDeChecklist"
          @alternar-impede="alternarImpedeUso"
          @salvar-config="salvarConfigDeChecklist" />
      </div>
    </template>

    <!-- EDITOR DE UM ITEM DO PLANO -->
    <div class="fr-ficha-fundo" v-if="itemEmEdicao" v-trava-rolagem :style="{ zIndex: camadas.item }" @click.self="fecharItem">
      <div class="fr-ficha" role="dialog">
        <div class="fr-ficha-topo">
          <span class="fr-ficha-titulo">{{ itemEmEdicao.novo ? 'Novo item de revisão' : 'Editar item' }}</span>
          <button class="fr-btn-ajuda" @click="passeioItemAberto = true" title="Passeio pelos campos">?</button>
          <button class="fr-fechar" @click="fecharItem" aria-label="Fechar">✕</button>
        </div>
        <PasseioGuiado v-model="passeioItemAberto" :passos="PASSOS_ITEM" />
        <div class="fr-ficha-corpo">
          <p class="fr-tutorial-fixo">{{ TEXTOS.itemEmEdicao }}</p>
          <label class="fr-campo" data-tour="item-nome">
            <span class="fr-lab">O que se troca</span>
            <input v-model="itemForm.item" type="text">
            <span class="fr-ajuda">Ex.: Filtro de ar, fluido de freio</span>
          </label>
          <label class="fr-campo" data-tour="item-km">
            <span class="fr-lab">A cada quantos quilômetros</span>
            <input v-model="itemForm.aCadaKm" type="text" inputmode="numeric">
            <span class="fr-ajuda">Ex.: 20000 — o aviso começa quando faltarem 10% disso.</span>
          </label>
          <label class="fr-campo">
            <span class="fr-lab">Observação</span>
            <input v-model="itemForm.observacao" type="text" placeholder="opcional">
          </label>
          <p class="fr-ajuda" v-if="itemEmEdicao.ativo === false">{{ avisoAoDesativar(itemEmEdicao.item) }}</p>
          <ul class="fr-problemas" v-if="errosDoItem.length">
            <li v-for="(e, i) in errosDoItem" :key="i">{{ e }}</li>
          </ul>
        </div>
        <div class="fr-ficha-rodape">
          <button class="fr-btn" @click="fecharItem">Cancelar</button>
          <button class="fr-btn primario" :disabled="gravando" @click="salvarItem">
            {{ gravando ? 'Gravando…' : 'Gravar' }}
          </button>
        </div>
      </div>
    </div>

    <!-- O QUE FOI MARCADO — o detalhe de UMA ficha de hoje (pedido do dono).
         Só de hoje: sem navegação por data passada, decisão dele. -->
    <div class="fr-ficha-fundo" v-if="fichaDetalhe" v-trava-rolagem @click.self="fecharDetalheChecklist">
      <div class="fr-ficha" role="dialog">
        <div class="fr-ficha-topo">
          <span class="fr-ficha-titulo">
            Checklist de hoje · {{ fichaDetalhe.veiculo.nome }} · {{ fichaDetalhe.veiculo.placa }}
          </span>
          <button class="fr-btn-ajuda" @click="passeioFichaDetalheAberto = true" title="Passeio pelos campos">?</button>
          <button class="fr-fechar" @click="fecharDetalheChecklist" aria-label="Fechar">✕</button>
        </div>
        <PasseioGuiado v-model="passeioFichaDetalheAberto" :passos="PASSOS_FICHA_DETALHE" />
        <div class="fr-ficha-corpo">
          <p class="fr-tutorial-fixo">{{ TEXTOS.fichaDetalhe }}</p>
          <div class="fr-dados">
            <div class="fr-dado" data-tour="fdet-km">
              <span class="fr-dado-lab">Quilometragem</span>
              <span class="fr-dado-val">{{ fichaDetalhe.ficha.hodometro.toLocaleString('pt-BR') }} km</span>
            </div>
            <div class="fr-dado" data-tour="fdet-resultado">
              <span class="fr-dado-lab">Resultado</span>
              <span class="fr-dado-val" :class="'fr-resultado-' + fichaDetalhe.ficha.resultado">
                {{ rotuloResultado(fichaDetalhe.ficha.resultado) }}
              </span>
            </div>
            <div class="fr-dado">
              <span class="fr-dado-lab">Quem preencheu</span>
              <span class="fr-dado-val">{{ fichaDetalhe.ficha.pessoa_nome || '—' }}</span>
            </div>
            <div class="fr-dado">
              <span class="fr-dado-lab">A que horas</span>
              <span class="fr-dado-val">{{ horaBR(fichaDetalhe.ficha.criada_em) || '—' }}</span>
            </div>
            <!-- D22: ficha sem assinatura NÃO pode parecer assinada. E o
                 contrário também vale — sem assinatura não é acusação, então
                 nem verde nem vermelho: fica na cor normal do texto, com o
                 motivo escrito logo abaixo. -->
            <div class="fr-dado" v-if="assinaturaDoDetalhe">
              <span class="fr-dado-lab">Assinatura</span>
              <span class="fr-dado-val">
                {{ assinaturaDoDetalhe.texto }}<template v-if="assinaturaDoDetalhe.assinada && horaBR(fichaDetalhe.ficha.assinada_em)"> às {{ horaBR(fichaDetalhe.ficha.assinada_em) }}</template>
              </span>
            </div>
          </div>
          <p class="fr-ajuda" v-if="assinaturaDoDetalhe">{{ assinaturaDoDetalhe.ajuda }}</p>
          <!-- D20, e SÓ o caso curto: tempo curto prova desatenção, tempo longo
               não prova zelo. Não existe selo de bem-feito — a linha some
               quando não há o que dizer, em vez de virar paisagem. -->
          <p class="fr-conferencia incompleto" v-if="avisoDeTempoDoDetalhe">{{ avisoDeTempoDoDetalhe }}</p>

          <p class="fr-ajuda" v-if="fichaDetalhe.ficha.hodometro_justificativa">
            Sobre a quilometragem: {{ fichaDetalhe.ficha.hodometro_justificativa }}
          </p>
          <p class="fr-ajuda" v-if="fichaDetalhe.ficha.anomalias" data-tour="fdet-anomalias">
            Anomalias escritas: {{ fichaDetalhe.ficha.anomalias }}
          </p>

          <h3 class="fr-grupo" data-tour="fdet-itens">O que foi conferido</h3>
          <!-- `detalheNaoLeu` escolhe a marca de falha certa: ficha de hoje é
               lida no carregamento da tela, ficha de outro dia é lida na hora
               de abrir. Somar as duas com um "ou" faria uma leitura de hoje que
               falhou acusar erro numa ficha antiga que carregou perfeitamente.
               De um jeito ou de outro, "não consegui carregar" NUNCA pode virar
               "não tinha item nenhum": dado inventado com cara de dado real é a
               mentira mais cara que uma tela conta. -->
          <p class="fr-erro" v-if="detalheNaoLeu">
            Não consegui carregar as respostas deste checklist. Recarregue a página; se continuar
            assim, avise quem administra a Frota.
          </p>
          <p class="fr-ajuda" v-else-if="!respostasDoDetalhe.length">
            Esta ficha não tem nenhum item registrado — isso não deveria acontecer. Avise quem
            administra a Frota.
          </p>
          <ul class="fr-itens" v-else>
            <li v-for="r in respostasDoDetalhe" :key="r.id" :class="'estado-' + r.estado">
              <span class="fr-item-nome">{{ r.item_texto }}</span>
              <span class="fr-item-txt">
                {{ rotuloEstadoItem(r.estado) }}<template v-if="r.observacao"> · {{ r.observacao }}</template>
              </span>
            </li>
          </ul>
        </div>
        <div class="fr-ficha-rodape">
          <button class="fr-btn" @click="fecharDetalheChecklist">Fechar</button>
        </div>
      </div>
    </div>

    <!-- PEDIR O CARRO PARA UMA DATA -->
    <div class="fr-ficha-fundo" v-if="pedido" v-trava-rolagem :style="{ zIndex: camadas.pedido }" @click.self="fecharPedido">
      <div class="fr-ficha" role="dialog">
        <div class="fr-ficha-topo">
          <span class="fr-ficha-titulo">Reservar veículo</span>
          <button class="fr-btn-ajuda" @click="passeioPedidoAberto = true" title="Passeio pelos campos">?</button>
          <button class="fr-fechar" @click="fecharPedido" aria-label="Fechar">✕</button>
        </div>
        <PasseioGuiado v-model="passeioPedidoAberto" :passos="PASSOS_PEDIDO" />
        <div class="fr-ficha-corpo">
          <p class="fr-tutorial-fixo">{{ TEXTOS.pedido }}</p>
          <label class="fr-campo">
            <span class="fr-lab">Veículo</span>
            <select v-model="pedidoForm.veiculoId" @change="conferirPedido">
              <option value="">— escolha —</option>
              <option v-for="v in veiculos.filter((x) => x.situacao === 'ativo')" :key="v.id" :value="v.id">
                {{ v.nome }} · {{ v.placa }}
              </option>
            </select>
          </label>
          <div class="fr-campo">
            <span class="fr-lab">Quem vai dirigir</span>
            <p class="fr-erro-inline" v-if="falhaPessoas">
              Não consegui carregar a lista de colaboradores. O campo pode estar vazio por
              causa disso, e não porque não haja ninguém cadastrado. Recarregue a página; se
              continuar, peça acesso a Colaboradores e Acessos (ou a Patrimônio/Frota) a quem
              administra.
            </p>
            <EscolhaDePessoa
              v-model="pedidoForm.pessoaId"
              :pessoas="comSelecionada(pessoasAtivas, pessoas, pedidoForm.pessoaId)" :todas="pessoas"
              :marcas="empresasPat" :setores="setores"
              :pode-criar="podeEditar" :criando="criandoPessoa && campoDeCriacao === 'pedido'"
              :recado-de-erro="campoDeCriacao === 'pedido' ? erroDePessoa : ''"
              :aviso="campoDeCriacao === 'pedido' ? avisoDeCriacao : ''"
              rotulo="Quem vai dirigir" texto-vazio="— escolha —"
              @update:modelValue="conferirPedido"
              @criar="(p) => criarPessoaRapida(p, 'pedido')" @criar-setor="(p) => criarSetorRapido(p, 'pedido')"
              @criar-marca="(p) => criarMarcaRapida(p, 'pedido')" @abrir="limparAvisoDeCriacao">
              <!-- Se a opção não existe, a pessoa TRAVA. Foi o que aconteceu em
                   11/08: o dono precisou registrar o Felipe, modelista de fora,
                   não achou onde, e acabou pondo a SI MESMO como motorista com
                   a verdade escrita na finalidade — uma multa da quinzena
                   cairia no nome errado. -->
              <option :value="DE_FORA">— outra pessoa, de fora da empresa —</option>
            </EscolhaDePessoa>
          </div>
          <label class="fr-campo" v-if="pedidoForm.pessoaId === DE_FORA">
            <span class="fr-lab">Nome de quem vai dirigir</span>
            <input v-model="pedidoForm.nomeDeFora" type="text" list="fr-nomes-de-fora"
                   @change="conferirPedido">
            <!-- Sugestão, não cadastro: é o que impede "Felipe", "felipe
                 modelista" e "Felipe M." de virarem três pessoas no histórico. -->
            <datalist id="fr-nomes-de-fora">
              <option v-for="n in sugestoesDeFora" :key="n" :value="n"></option>
            </datalist>
            <span class="fr-ajuda">
              Ela não tem cadastro, então não recebe o aviso do checklist — quem cobra é
              quem administra a Frota. Ex.: Felipe modelista
            </span>
          </label>
          <label class="fr-campo" data-tour="ped-quando">
            <span class="fr-lab">Retirada</span>
            <input v-model="pedidoForm.retirada" type="datetime-local" @change="conferirPedido">
          </label>
          <label class="fr-campo">
            <span class="fr-lab">Devolução prevista</span>
            <input v-model="pedidoForm.devolucao" type="datetime-local" @change="conferirPedido">
          </label>
          <label class="fr-campo" data-tour="ped-destino">
            <span class="fr-lab">Destino</span>
            <!-- `@change` aqui também: sem ele o aviso "sem destino, quem aprova
                 não sabe o que está aprovando" continuava na tela DEPOIS de a
                 pessoa escrever o destino, porque a conferência só rodava nos
                 campos de cima. Aviso que não some quando o problema acaba
                 ensina a ignorar aviso. -->
            <input v-model="pedidoForm.destino" type="text" @change="conferirPedido">
            <span class="fr-ajuda">Ex.: Conchal, Campinas</span>
          </label>
          <label class="fr-campo">
            <span class="fr-lab">Para quê</span>
            <input v-model="pedidoForm.finalidade" type="text">
            <span class="fr-ajuda">Ex.: Homologação, buscar pedido</span>
          </label>
          <label class="fr-campo">
            <span class="fr-lab">Departamento</span>
            <input v-model="pedidoForm.departamento" type="text">
            <span class="fr-ajuda">Ex.: Administrativo, Marketing</span>
          </label>

          <ul class="fr-problemas" v-if="avisosDoPedido.length">
            <li v-for="(a, i) in avisosDoPedido" :key="i">{{ a.texto }}</li>
          </ul>
        </div>
        <div class="fr-ficha-rodape" data-tour="ped-depois">
          <button class="fr-btn" @click="fecharPedido">Cancelar</button>
          <button class="fr-btn primario" :disabled="gravando" @click="enviarPedido">
            {{ gravando ? 'Enviando…' : (jaAvisado && avisosDoPedido.length ? 'Pedir assim mesmo' : 'Pedir') }}
          </button>
        </div>
      </div>
    </div>

    <!-- EDITAR UMA RESERVA (13/08/2026).
         Os mesmos campos do pedido, e a MESMA validação — inclusive o aviso de
         conflito de viagens. Uma segunda regra de validação, mais frouxa, aqui,
         permitiria consertar uma reserva pra cima de outra. -->
    <div class="fr-ficha-fundo" v-if="edicao" v-trava-rolagem :style="{ zIndex: camadas.edicao }" @click.self="fecharEdicao">
      <div class="fr-ficha" role="dialog">
        <div class="fr-ficha-topo">
          <span class="fr-ficha-titulo">Editar reserva</span>
          <button class="fr-fechar" @click="fecharEdicao" aria-label="Fechar">✕</button>
        </div>
        <div class="fr-ficha-corpo">
          <p class="fr-tutorial-fixo">
            Toda alteração fica registrada: o que mudou, de quê pra quê, quem mudou e quando.
            Quem já tinha visto a reserva antiga não é avisado — se a mudança atrapalha alguém,
            fale com a pessoa.
          </p>
          <label class="fr-campo">
            <span class="fr-lab">Veículo</span>
            <select v-model="edicaoForm.veiculoId">
              <option value="">— escolha —</option>
              <option v-for="v in veiculos.filter((x) => x.situacao === 'ativo')" :key="v.id" :value="v.id">
                {{ v.nome }} · {{ v.placa }}
              </option>
            </select>
          </label>
          <label class="fr-campo">
            <span class="fr-lab">Quem vai dirigir</span>
            <select v-model="edicaoForm.pessoaId">
              <option value="">— escolha —</option>
              <option v-for="p in pessoas" :key="p.id" :value="p.id">{{ p.nome }}</option>
              <option :value="DE_FORA">— outra pessoa, de fora da empresa —</option>
            </select>
          </label>
          <label class="fr-campo" v-if="edicaoForm.pessoaId === DE_FORA">
            <span class="fr-lab">Nome de quem vai dirigir</span>
            <input v-model="edicaoForm.nomeDeFora" type="text" list="fr-nomes-de-fora">
            <span class="fr-ajuda">Ex.: Felipe modelista</span>
          </label>
          <label class="fr-campo">
            <span class="fr-lab">Retirada</span>
            <input v-model="edicaoForm.retirada" type="datetime-local">
          </label>
          <label class="fr-campo">
            <span class="fr-lab">Devolução prevista</span>
            <input v-model="edicaoForm.devolucao" type="datetime-local">
          </label>
          <label class="fr-campo">
            <span class="fr-lab">Destino</span>
            <input v-model="edicaoForm.destino" type="text">
          </label>
          <label class="fr-campo">
            <span class="fr-lab">Para quê</span>
            <input v-model="edicaoForm.finalidade" type="text">
          </label>
          <label class="fr-campo">
            <span class="fr-lab">Departamento</span>
            <input v-model="edicaoForm.departamento" type="text">
          </label>

          <ul class="fr-problemas" v-if="avisosDaEdicao.length">
            <li v-for="(a, i) in avisosDaEdicao" :key="i">{{ a.texto }}</li>
          </ul>
          <!-- O erro do banco sai como ele veio: o gatilho escreve em português
               dizendo exatamente o que aconteceu ("esta reserva já virou
               viagem"), e trocar isso por "não consegui salvar" jogaria fora a
               parte que explica. -->
          <ul class="fr-problemas" v-if="erroDaEdicao"><li>{{ erroDaEdicao }}</li></ul>
        </div>
        <div class="fr-ficha-rodape">
          <button class="fr-btn" @click="fecharEdicao">Fechar sem salvar</button>
          <button class="fr-btn primario" :disabled="gravando" @click="salvarEdicao">
            {{ gravando ? 'Salvando…' : (jaAvisadoNaEdicao && avisosDaEdicao.length ? 'Salvar assim mesmo' : 'Salvar') }}
          </button>
        </div>
      </div>
    </div>

    <!-- CANCELAR OU REVOGAR.
         É AQUI que a ação é vermelha, e não no card: o padrão manda o botão de
         perigo morar atrás de um passo a mais, e o passo é este — com o motivo
         escrito, que o banco também exige. -->
    <div class="fr-ficha-fundo" v-if="encerramento" v-trava-rolagem :style="{ zIndex: camadas.encerramento }" @click.self="fecharEncerramento">
      <div class="fr-ficha" role="dialog">
        <div class="fr-ficha-topo">
          <span class="fr-ficha-titulo">
            {{ encerramento.acao === 'cancelada' ? 'Cancelar reserva' : 'Revogar reserva' }}
          </span>
          <button class="fr-fechar" @click="fecharEncerramento" aria-label="Fechar">✕</button>
        </div>
        <div class="fr-ficha-corpo">
          <!-- As duas frases são DIFERENTES porque as duas ações são
               diferentes, e a pessoa precisa saber qual está fazendo. -->
          <p class="fr-tutorial-fixo" v-if="encerramento.acao === 'cancelada'">
            Esta reserva ainda não começou. Cancelar desmarca o carro para essa data, e ele volta
            a ficar livre para outra pessoa reservar. A reserva não some do histórico: fica
            registrada como cancelada, com o motivo que você escrever.
          </p>
          <p class="fr-tutorial-fixo" v-else>
            Esta reserva já está valendo. Revogar tira a autorização e libera o carro na hora
            para outra pessoa reservar. <strong>Revogar não devolve o carro:</strong> se ele
            estiver na rua, continua na rua, e a devolução tem de ser registrada por quem está
            com ele.
          </p>
          <p class="fr-recado">
            {{ (veiculos.find((v) => v.id === encerramento.requisicao.veiculo_id) || {}).nome }}
            para {{ encerramento.requisicao.pessoa_nome || 'motorista não informado' }},
            {{ quando(encerramento.requisicao.retirada_prevista) }}<span
              v-if="encerramento.requisicao.destino">, {{ encerramento.requisicao.destino }}</span>.
          </p>
          <label class="fr-campo">
            <span class="fr-lab">Motivo (obrigatório)</span>
            <input v-model="motivoDoEncerramento" type="text"
                   :placeholder="encerramento.acao === 'cancelada' ? 'A viagem foi desmarcada…' : 'O carro foi para a oficina…'">
            <span class="fr-ajuda">
              Quem for ler isto daqui a seis meses precisa da frase, não do carimbo.
            </span>
          </label>
          <ul class="fr-problemas" v-if="erroDoEncerramento"><li>{{ erroDoEncerramento }}</li></ul>
        </div>
        <div class="fr-ficha-rodape">
          <button class="fr-btn" @click="fecharEncerramento">Voltar</button>
          <button class="fr-btn fr-btn-perigo" :disabled="gravando" @click="confirmarEncerramento">
            {{ gravando ? 'Gravando…' : (encerramento.acao === 'cancelada' ? 'Cancelar a reserva' : 'Revogar a reserva') }}
          </button>
        </div>
      </div>
    </div>

    <!-- APROVAR OU RECUSAR -->
    <div class="fr-ficha-fundo" v-if="decisao" v-trava-rolagem :style="{ zIndex: camadas.decisao }" @click.self="fecharDecisao">
      <div class="fr-ficha" role="dialog">
        <div class="fr-ficha-topo">
          <span class="fr-ficha-titulo">{{ decisao.acao === 'aprovada' ? 'Aprovar' : 'Recusar' }} requisição</span>
          <button class="fr-btn-ajuda" @click="passeioDecisaoAberto = true" title="Passeio pelos campos">?</button>
          <button class="fr-fechar" @click="fecharDecisao" aria-label="Fechar">✕</button>
        </div>
        <PasseioGuiado v-model="passeioDecisaoAberto" :passos="PASSOS_DECISAO" />
        <div class="fr-ficha-corpo">
          <p class="fr-tutorial-fixo">{{ TEXTOS.decisao }}</p>
          <p class="fr-recado">
            {{ (veiculos.find((v) => v.id === decisao.requisicao.veiculo_id) || {}).nome }}
            para {{ decisao.requisicao.pessoa_nome || 'motorista não informado' }},
            {{ quando(decisao.requisicao.retirada_prevista) }}<span v-if="decisao.requisicao.destino">, {{ decisao.requisicao.destino }}</span>.
          </p>
          <label class="fr-campo" data-tour="dec-motivo">
            <span class="fr-lab">{{ decisao.acao === 'recusada' ? 'Motivo (obrigatório)' : 'Observação' }}</span>
            <input v-model="motivoDaRecusa" type="text"
                   :placeholder="decisao.acao === 'recusada' ? 'O carro já está reservado nesse dia…' : 'opcional'">
          </label>
          <ul class="fr-problemas" v-if="erroDaDecisao"><li>{{ erroDaDecisao }}</li></ul>
        </div>
        <div class="fr-ficha-rodape" data-tour="dec-depois">
          <button class="fr-btn" @click="fecharDecisao">Cancelar</button>
          <button class="fr-btn primario" :disabled="gravando" @click="confirmarDecisao">
            {{ gravando ? 'Gravando…' : (decisao.acao === 'aprovada' ? 'Aprovar' : 'Recusar') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Ficha de retirada / devolução. Centralizada com margem, como os outros
         modais desta central. -->
    <div class="fr-ficha-fundo" v-if="ficha" v-trava-rolagem :style="{ zIndex: camadas.ficha }" @click.self="fecharFicha">
      <div class="fr-ficha" role="dialog">
        <div class="fr-ficha-topo">
          <span class="fr-ficha-titulo">
            {{ ficha.avulsa ? 'Registrar retirada' : (ficha.modo === 'retirar' ? 'Retirar' : 'Devolver') }} · {{ ficha.linha.veiculo.nome }}
          </span>
          <button class="fr-btn-ajuda" @click="passeioFichaAberto = true" title="Passeio pelos campos">?</button>
          <button class="fr-fechar" @click="fecharFicha" aria-label="Fechar">✕</button>
        </div>
        <PasseioGuiado v-model="passeioFichaAberto" :passos="PASSOS_FICHA" />

        <div class="fr-ficha-corpo">
          <!-- Texto fixo VERBATIM (dono): a frase certa depende do modo —
               quem retira não precisa ler a instrução de devolver. -->
          <p class="fr-tutorial-fixo" v-if="ficha.modo === 'retirar'">
            <strong>Ao retirar:</strong> {{ TEXTOS.fichaRetirar }}
          </p>
          <p class="fr-tutorial-fixo" v-else>
            <strong>Ao devolver:</strong> {{ TEXTOS.fichaDevolver }}
          </p>

          <!-- O checklist do rodízio (F7): quem pega um carro que não é o seu
               fixo confere ANTES DE SAIR, como o papel manda — sábado ou não
               (D6/D9 cobre só o carro fixo, todo dia; este cobre quem pega
               qualquer carro, no momento de pegar). `pegando-agora` avisa o
               componente que isso é uma retirada de verdade, senão ele calcula
               pelo calendário e no fim de semana devolveria zero itens. -->
          <!-- O ACEITE DE RETIRADA (13/08/2026): quando o carro JÁ foi
               conferido hoje, mas por outra pessoa. Aqui não se repete a lista
               — quem conferiu já conferiu. O que falta é a segunda frase:
               "eu recebi este carro assim". Sem isto, quem pega um carro
               conferido às 7h30 pelo dono sai sem assinar nada, que foi o
               achado de 13/08: 5 retiradas reais, zero assinaturas de quem
               pegou. -->
          <div class="fr-aceite" v-if="ficha.modo === 'retirar' && pedidoDaRetirada.pedir === 'aceite'">
            <p class="fr-hist-titulo">Aceite de retirada</p>
            <p class="fr-hist-linha">
              {{ porQuePedirOAceite(pedidoDaRetirada.porque, pedidoDaRetirada.quemConferiu) }}
            </p>
            <p class="fr-ajuda" v-if="form.pessoaId && form.pessoaId !== euId">
              Você está registrando a retirada de {{ nomeDaPessoa(form.pessoaId) }}. A assinatura
              fica no seu nome, e o registro diz que o carro foi entregue a ela.
            </p>
            <template v-if="podeAssinar">
              <CampoDeRabisco v-model="aceiteDaRetirada" :desabilitado="gravando" />
              <!-- Nunca some com o campo nem trava a retirada: assinatura em
                   branco vira "sem aceite", e a linha do histórico DIZ isso.
                   Travar aqui deixaria alguém a pé no estacionamento por causa
                   de um dedo que não pegou na tela. -->
              <p class="fr-ajuda" v-if="!aceiteDaRetirada">
                Sem a assinatura o carro sai do mesmo jeito — mas o histórico vai registrar esta
                retirada como <strong>sem prova de quem pegou</strong>.
              </p>
            </template>
            <p class="fr-ajuda" v-else>
              Para assinar é preciso estar com login próprio no aplicativo. Esta retirada vai ficar
              registrada sem assinatura de quem pegou o carro.
            </p>
          </div>

          <PainelDeChecklist
            v-if="ficha.modo === 'retirar' && !ficha.avulsa && precisaDeChecklist({ veiculoId: ficha.linha.veiculo.id, fichas, hoje })"
            ref="painelDaRetirada"
            :botao-proprio="false"
            data-tour="ficha-checklist"
            :veiculo="ficha.linha.veiculo"
            :itens="itensDeChecklist"
            :config="configDeChecklist"
            :ultima-semanal="ultimaDoTipo(ficha.linha.veiculo.id, 'semanal')"
            :ultima-mensal="ultimaDoTipo(ficha.linha.veiculo.id, 'mensal')"
            :ultimo-km="ultimoHodometro(fichas, ficha.linha.veiculo.id)"
            :hoje="hoje"
            :pegando-agora="true"
            :gravando="gravando"
            :pode-assinar="podeAssinar"
            :erro-da-assinatura="erroDaAssinatura"
            @gravar="gravarChecklist" />
          <!-- O que a reserva já respondeu, MOSTRADO e não perguntado. Sem isto
               a ficha encolheria e a pessoa não saberia com que reserva está
               pegando o carro — economizar campo não pode custar a certeza. -->
          <p class="fr-tutorial-fixo" v-if="ficha.modo === 'retirar' && ficha.reserva">
            Pela sua reserva de {{ quando(ficha.reserva.retirada_prevista) }}<template
              v-if="ficha.reserva.destino">, para {{ ficha.reserva.destino }}</template><template
              v-if="ficha.reserva.finalidade"> ({{ ficha.reserva.finalidade }})</template>.
            <!-- O fim da frase depende do que ESTA ficha ainda pede:
                 prometer checklist na tela em que outra pessoa já conferiu
                 o carro manda a pessoa procurar o que não está lá. -->
            {{ oQueFaltaNaRetirada(pedidoDaRetirada.pedir) }}
          </p>

          <p class="fr-aviso" v-if="ficha.modo === 'retirar' && seloDoChecklist">{{ seloDoChecklist }}</p>
          <p class="fr-erro" v-if="ficha.modo === 'retirar' && erroChecklist">{{ erroChecklist }}</p>

          <!-- O QUE ESTE REGISTRO É, dito antes de qualquer campo. Sem esta
               frase, a ficha parece igual à de pegar o carro agora, e alguém
               registraria uma saída que não aconteceu. -->
          <p class="fr-tutorial-fixo" v-if="ficha.avulsa">
            <strong>Registro do que já aconteceu:</strong> use isto quando o carro saiu fora do
            aplicativo — no fim de semana, ou com o celular no bolso. <strong>Não pede
            checklist</strong>, porque ninguém confere hoje um carro que saiu ontem: o histórico
            vai marcar esta retirada como sem prova nenhuma.
          </p>
          <label class="fr-campo" v-if="ficha.avulsa">
            <span class="fr-lab">Quando o carro saiu</span>
            <input v-model="form.saidaEm" type="datetime-local">
            <span class="fr-ajuda">A hora de verdade, não a de agora — é ela que vai para o histórico.</span>
          </label>

          <!-- Estes três campos SOMEM quando a retirada vem de uma reserva
               aprovada (pedido do dono, 12/08/2026): a reserva já disse quem vai
               usar, pra onde e pra quê, e repetir a pergunta na hora de pegar a
               chave é fazer a pessoa digitar duas vezes o mesmo. Aparecem só no
               registro de uso avulso, feito pela Gestão, que não tem reserva
               atrás. -->
          <div class="fr-campo" v-if="ficha.modo === 'retirar' && !ficha.reserva">
            <span class="fr-lab">Quem vai usar</span>
            <p class="fr-erro-inline" v-if="falhaPessoas">
              Não consegui carregar a lista de colaboradores. O campo pode estar vazio por
              causa disso, e não porque não haja ninguém cadastrado. Recarregue a página; se
              continuar, peça acesso a Colaboradores e Acessos (ou a Patrimônio/Frota) a quem
              administra.
            </p>
            <EscolhaDePessoa
              v-model="form.pessoaId"
              :pessoas="comSelecionada(pessoasAtivas, pessoas, form.pessoaId)" :todas="pessoas"
              :marcas="empresasPat" :setores="setores"
              :pode-criar="podeEditar" :criando="criandoPessoa && campoDeCriacao === 'retirada'"
              :recado-de-erro="campoDeCriacao === 'retirada' ? erroDePessoa : ''"
              :aviso="campoDeCriacao === 'retirada' ? avisoDeCriacao : ''"
              rotulo="Quem vai usar" texto-vazio="— escolha —"
              @criar="(p) => criarPessoaRapida(p, 'retirada')" @criar-setor="(p) => criarSetorRapido(p, 'retirada')"
              @criar-marca="(p) => criarMarcaRapida(p, 'retirada')" @abrir="limparAvisoDeCriacao" />
          </div>

          <!-- O HODÔMETRO SE PERGUNTA UMA VEZ SÓ. Quando o checklist está aberto
               aqui dentro, o número dele é o número da saída — este campo
               sumiu. Medido em 22/08/2026, nas duas primeiras retiradas feitas
               com o botão único: BMW X1 gravou 58.311 no checklist e 58.313 na
               viagem (2 segundos de diferença); a Bravo gravou 185.908 e
               185.900 — o MENOR foi parar na viagem, e é ele que a devolução
               compara depois. Perguntar duas vezes a mesma coisa produz duas
               respostas diferentes; é só uma questão de quantas vezes. -->
          <label class="fr-campo" data-tour="ficha-km" v-if="!checklistNaFicha">
            <span class="fr-lab">
              KM no painel {{ ficha.modo === 'devolver' ? 'agora' : 'ao sair' }}
            </span>
            <input v-model="form.km" type="text" inputmode="numeric">
            <span class="fr-ajuda">Ex.: 145928</span>
            <span class="fr-ajuda" v-if="ficha.modo === 'devolver' && ficha.uso && ficha.uso.km_saida">
              Saiu com {{ ficha.uso.km_saida.toLocaleString('pt-BR') }} km.
            </span>
          </label>

          <label class="fr-campo" data-tour="ficha-combustivel">
            <span class="fr-lab">Combustível no painel</span>
            <select v-model="form.tanque">
              <option value="">— não informar —</option>
              <option v-for="(n, i) in NIVEIS_TANQUE" :key="i" :value="String(i)">{{ n }}</option>
            </select>
          </label>

          <template v-if="ficha.modo === 'retirar' && !ficha.reserva">
            <label class="fr-campo">
              <span class="fr-lab">Destino</span>
              <input v-model="form.destino" type="text">
              <span class="fr-ajuda">Ex.: Conchal, Rio Claro</span>
            </label>
            <label class="fr-campo">
              <span class="fr-lab">Para quê</span>
              <input v-model="form.finalidade" type="text">
              <span class="fr-ajuda">Ex.: Homologação, buscar pedido</span>
            </label>
          </template>

          <label class="fr-campo">
            <span class="fr-lab">Observação</span>
            <input v-model="form.observacao" type="text" placeholder="opcional">
          </label>

          <ul class="fr-problemas" v-if="problemas.length">
            <li v-for="(p, i) in problemas" :key="i">{{ p }}</li>
          </ul>
        </div>

        <div class="fr-ficha-rodape">
          <button class="fr-btn" @click="fecharFicha">Cancelar</button>
          <!-- O BOTÃO DIZ O QUE VAI FAZER. Quando o checklist está aberto aqui
               dentro, este toque assina o checklist E tira o carro — esconder
               uma assinatura definitiva atrás de "Confirmar" é a surpresa que o
               padrão da casa não admite. -->
          <button class="fr-btn primario" :disabled="gravando" @click="confirmar">
            {{ gravando ? 'Gravando…' : rotuloDoBotaoDaFicha }}
          </button>
        </div>
      </div>
    </div>

    <!-- PASSAR / ENCERRAR A POSSE (D26). Modal e não bloco dentro do card,
         porque abre de DOIS lugares: do "Seu carro" na aba Motorista e de
         qualquer veículo na aba Gestão. -->
    <div class="fr-ficha-fundo" v-if="passando" v-trava-rolagem
         :style="{ zIndex: camadas.passe }" @click.self="fecharPasse">
      <div class="fr-ficha" role="dialog">
        <div class="fr-ficha-topo">
          <span class="fr-ficha-titulo">Quem está com o {{ passando.nome }}</span>
          <button class="fr-fechar" aria-label="Fechar" @click="fecharPasse">✕</button>
        </div>
        <div class="fr-ficha-corpo">
          <p class="fr-tutorial-fixo">
            Registrar quem está com o carro é o que faz uma multa ter resposta. Sem isso
            ela cai no nome do responsável fixo, que pode não ter sido quem dirigiu.
          </p>
          <div class="fr-campo">
            <span class="fr-lab">Passar para</span>
            <p class="fr-erro-inline" v-if="falhaPessoas">
              Não consegui carregar a lista de colaboradores. O campo pode estar vazio por
              causa disso, e não porque não haja ninguém cadastrado. Recarregue a página; se
              continuar, peça acesso a Colaboradores e Acessos (ou a Patrimônio/Frota) a quem
              administra.
            </p>
            <!-- Sem dono fixo, "devolver" não tem pra quem: o certo é o carro
                 ficar livre. Com dono fixo, a posse dele reabre no mesmo
                 instante — sem buraco na linha do tempo (D9c). O texto
                 calculado vai pro `texto-vazio`, e um valor vazio continua
                 querendo dizer "devolver / encerrar" — não muda com a troca
                 pro componente. -->
            <EscolhaDePessoa
              v-model="paraQuem"
              :pessoas="comSelecionada(pessoasAtivas, pessoas, paraQuem)" :todas="pessoas"
              :marcas="empresasPat" :setores="setores"
              :pode-criar="podeEditar" :criando="criandoPessoa && campoDeCriacao === 'passar'"
              :recado-de-erro="campoDeCriacao === 'passar' ? erroDePessoa : ''"
              :aviso="campoDeCriacao === 'passar' ? avisoDeCriacao : ''"
              rotulo="Passar para"
              :texto-vazio="passando.pessoa_id
                ? ('Devolver para ' + (nomeDaPessoa(passando.pessoa_id) || 'o responsável fixo'))
                : 'Encerrar a posse — o carro fica livre'"
              @criar="(p) => criarPessoaRapida(p, 'passar')" @criar-setor="(p) => criarSetorRapido(p, 'passar')"
              @criar-marca="(p) => criarMarcaRapida(p, 'passar')" @abrir="limparAvisoDeCriacao">
              <!-- Pessoa de fora TAMBÉM aqui, e este é o lugar que mais importa:
                   é `frota_uso` que responde "quem estava com o carro no dia da
                   multa". Sem isto, a quinzena do Felipe continuaria caindo no
                   nome do responsável fixo, que é o defeito de R$ 1.301,60 que
                   motivou o módulo. -->
              <option :value="DE_FORA">— outra pessoa, de fora da empresa —</option>
              <!-- Recolher pro estoque é diferente de devolver: devolver põe o
                   carro de volta na mão do responsável, recolher tira ele de
                   circulação. Vale no Patrimônio junto — "Parado" aqui é "em
                   estoque" lá (migration 042). -->
              <option :value="PARA_ESTOQUE">— recolher para o estoque —</option>
            </EscolhaDePessoa>
          </div>
          <p class="fr-tutorial-fixo" v-if="paraQuem === PARA_ESTOQUE">
            O carro sai de circulação: para de aparecer como livre e some da cobrança do
            checklist. No Patrimônio ele fica <strong>em estoque</strong>, junto.
            <template v-if="passando.pessoa_id">
              {{ nomeDaPessoa(passando.pessoa_id) }} continua como responsável — recolher não
              é trocar de dono.
            </template>
          </p>
          <label class="fr-campo" v-if="paraQuem === DE_FORA">
            <span class="fr-lab">Nome de quem vai ficar com o carro</span>
            <input v-model="nomeDeForaNoPasse" type="text" list="fr-nomes-de-fora">
            <span class="fr-ajuda">Ex.: Felipe modelista</span>
          </label>
          <p class="fr-aviso" v-for="(a, i) in avisosDoPasse" :key="i">{{ a.texto }}</p>
          <p class="fr-erro" v-if="erroPasse">{{ erroPasse }}</p>
        </div>
        <div class="fr-ficha-rodape">
          <button class="fr-btn" @click="fecharPasse">Cancelar</button>
          <button class="fr-btn primario"
                  :disabled="gravando || avisosDoPasse.some((a) => a.bloqueia)"
                  @click="confirmarPasse">
            {{ gravando ? 'Gravando…' : 'Confirmar' }}
          </button>
        </div>
      </div>
    </div>

    <!-- LANÇAR MANUTENÇÃO (D27). Fica no fim do template, fora das outras
         fichas: ele abre de dois lugares — da sanfona de Revisões e da ficha do
         veículo —, e aninhar dentro de uma delas o faria depender de qual estava
         aberta. -->
    <LancamentoDeManutencao
      v-if="lancamento"
      :camada="camadas.lancamento"
      :veiculo="lancamento.veiculo"
      :plano="planoAtivo"
      :km-conhecido="kmConhecidoDoLancamento"
      :gravando="gravando"
      :erro="erroDoLancamento"
      @gravar="gravarLancamento"
      @fechar="fecharLancamento"
      @novo-item="novoItemDoLancamento" />
  </div>
</template>

<style scoped>
.tela-frota{min-height:100vh;display:flex;flex-direction:column;background:transparent;}
.tela-frota .fr-topbar{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--border);background:var(--surface);position:sticky;top:0;z-index:10;}
.tela-frota .fr-topbar .rbv-logo{height:22px;width:auto;flex-shrink:0;}
.tela-frota .fr-back{display:inline-flex;align-items:center;gap:6px;background:none;border:none;color:var(--muted);font-family:var(--fonte-principal);font-size:max(9px, calc(11px * var(--escala-texto, 1)));font-weight:600;cursor:pointer;text-transform:uppercase;letter-spacing:1.2px;flex-shrink:0;}
.tela-frota .fr-title{font-family:var(--fonte-principal);font-size:max(9px, calc(13px * var(--escala-texto, 1)));font-weight:600;letter-spacing:2px;text-transform:uppercase;color:var(--text);flex:1;min-width:0;text-align:right;}
.tela-frota .fr-motorista-resumo{margin:0;padding:14px 14px 4px;font-family:var(--fonte-principal);font-size:max(9px, calc(15px * var(--escala-texto, 1)));font-weight:600;color:var(--text);}
.tela-frota .fr-secao{margin:16px 0 8px;padding:0 14px;font-family:var(--fonte-principal);font-size:max(9px, calc(10px * var(--escala-texto, 1)));font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:var(--muted);}
.tela-frota .fr-aviso{margin:0;padding:4px 14px 10px;font-family:var(--fonte-principal);font-size:max(9px, calc(12.5px * var(--escala-texto, 1)));line-height:1.55;color:var(--muted);}
/* O quadro de cobrança (D16), em cards (pedido do dono, V2): cada carro é um
   .fr-card do mesmo tipo usado no resto da tela, então herda de graça a
   grade responsiva do `.fr-lista` (uma coluna no celular, várias no
   computador) — nada de CSS novo de layout só pra este quadro. */
.tela-frota .fr-card-cobranca{border-left-color:var(--green,#16a34a);}
.tela-frota .fr-card-cobranca.pendente{border-left-color:var(--red,#c0392b);}
/* Cor pelo token, nunca chumbada: o app tem modo escuro, e verde-claro fixo
   sobre fundo preto é ilegível. Mesmo motivo que fez o painel do motorista
   inteiro precisar ser refeito. */
/* MESMA MEDIDA DO `.fr-selo`, e isso foi bronca do dono (13/08/2026: tamanhos
   divergentes no computador). Os dois selos aparecem na MESMA aba, um embaixo
   do outro, e estavam em medidas diferentes: este tinha `.8rem` cravado e
   `padding:2px`, enquanto o outro usa a escala de texto do app e `padding:4px`.
   Pior que a diferença: `rem` cravado IGNORA o ajuste de tamanho de letra da
   Central (`--escala-texto`) — quem aumenta a letra via ajuste via este selo
   ficar para trás dos outros. */
/* A linha fechada do histórico: o resumo em cima, os dois botões embaixo. */
.tela-frota .fr-hist-resumo{font-family:var(--fonte-principal);
  font-size:max(9px, calc(12px * var(--escala-texto, 1)));color:var(--muted);margin:6px 0 0;}
.tela-frota .fr-hist-abrir{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;}
.tela-frota .fr-hist-abrir .fr-btn{flex:1 1 auto;min-width:44%;}

/* O HISTÓRICO NO PÉ DO CARD: uma linha separa o HOJE do que já passou, e o
   título da subseção é MENOR que o da gaveta que o contém — subtítulo maior que
   o título faz a pessoa achar que entrou noutra seção. Mesma família do
   `gv-titulo` (maiúsculas, espaçado), um degrau abaixo. */
/* SEM margem própria no topo: a lista de cartões acima já termina com 40px de
   respiro, e somar 32 dava um vão de 72px antes da linha — o buraco que o dono
   viu. Medido, não deduzido. Fica 40px acima da linha e 24 abaixo, que é a
   proporção certa pra linha pertencer ao que vem DEPOIS dela. */
.tela-frota .fr-historico-no-pe{padding-top:var(--sp-5);border-top:1px solid var(--border);}
/* O RECUO DE 14px É DE CADA BLOCO, não da gaveta: `fr-aviso`, `fr-filtros` e
   `fr-dia-de-ficha` já se recuam sozinhos, e o corpo da gaveta tem padding
   zero. O título e a frase desta subseção nasceram sem esse recuo e ficaram
   colados na borda — medido a 390px: esquerda=0px, contra 14px de todo o
   resto. Alinhar aqui é o que faz a subseção pertencer ao card. */
.tela-frota .fr-historico-no-pe > .fr-subsecao,
.tela-frota .fr-historico-no-pe > .fr-ajuda{padding-left:14px;padding-right:14px;}
.tela-frota .fr-subsecao{font-family:var(--fonte-principal);
  font-size:max(9px, calc(10px * var(--escala-texto, 1)));font-weight:700;letter-spacing:1.4px;
  text-transform:uppercase;color:var(--muted);margin:0 0 4px;}
.tela-frota .fr-ver-mais{display:flex;justify-content:center;margin-top:var(--sp-4);}
.tela-frota .fr-ver-mais .fr-btn{min-width:60%;}

/* A TAG do quadro de hoje: por que este carro está aqui. Texto pequeno e
   discreto ao lado do nome — não é selo de estado (esse é o `fr-cobranca-selo`,
   à direita), é classificação. Cor vem de token, como manda o padrão. */
.tela-frota .fr-tag{font-family:var(--fonte-principal);font-size:max(8px, calc(9px * var(--escala-texto, 1)));
  font-weight:700;letter-spacing:.6px;text-transform:uppercase;padding:2px 7px;border-radius:999px;
  margin-left:8px;vertical-align:middle;white-space:nowrap;
  background:color-mix(in srgb,var(--muted) 14%,transparent);color:var(--muted);}
/* "reserva" ganha a cor do acento: é o carro que saiu HOJE, e é o que o dono
   não estava enxergando antes de 21/08. */
.tela-frota .fr-tag.reserva{background:color-mix(in srgb,var(--accent) 14%,transparent);color:var(--accent);}

.tela-frota .fr-cobranca-selo{font-family:var(--fonte-principal);font-size:max(9px, calc(10px * var(--escala-texto, 1)));font-weight:700;letter-spacing:.4px;padding:4px 10px;border-radius:999px;background:var(--surface2);color:var(--green);white-space:nowrap;}
.tela-frota .fr-cobranca-selo.pendente{color:var(--red);}
/* "feito, sem assinatura" (D22): laranja, não vermelho. Vermelho é FALTA, e
   sem assinatura não é falta de ninguém — três donos de carro não têm login.

   POR QUE ESTE SELO É FUNDO TINGIDO, e os outros dois são texto colorido:
   `--orange` como TEXTO sobre `--surface2` mede 4,06 de contraste no tema
   claro — medido no navegador, não deduzido —, e o mínimo é 4,5. O verde
   (5,36) e o vermelho (5,82) passam; só o laranja não. Então este usa a
   receita do PADRÃO pra aviso: o token misturado na superfície, e o texto em
   `--text`. A cor continua sendo o sinal; o texto é pra ler.

   `white-space:normal` porque a frase é longa: com o `nowrap` da regra de
   cima o cartão saía pela direita no celular, e `overflow-x:clip` cortaria
   isso em silêncio. */
.tela-frota .fr-cobranca-selo.sem-assinatura{
  background:color-mix(in srgb, var(--orange) 16%, var(--surface));
  color:var(--text);white-space:normal;text-align:right;}

/* AS CÓPIAS EM PDF NA PASTA DO ZOHO (D23).

   ESTE QUADRO NÃO TEM CAIXA QUANDO ESTÁ TUDO BEM. Nada esperando e nada
   falhado = uma frase em `.fr-aviso`, o mesmo cinza discreto do resto da aba.
   O CSS abaixo só entra em cena quando alguma cópia não chegou — quem abre a
   Gestão veio cobrar checklist, não administrar arquivo.

   A COR SEGUE A GRAVIDADE, e a diferença entre as duas é o ponto:
     vermelho  — o robô tentou 8 vezes e parou. Só sai com alguém fazendo algo.
     laranja   — tropeçou, mas o robô continua tentando sozinho.
   Esperando não ganha cor nenhuma: é o relógio, não defeito.

   FUNDO TINGIDO COM O TEXTO EM --text, nunca texto colorido. `--orange` como
   texto mede 4,06 de contraste no tema claro — medido nesta mesma tela, ver o
   comentário do .fr-cobranca-selo —, e o mínimo é 4,5. Tingindo a superfície a
   10%, a cor continua sendo o sinal e o texto passa folgado nos dois temas
   (~16 no claro, ~14 no escuro, medido). */
.tela-frota .fr-copias{padding:0 14px 4px;display:flex;flex-direction:column;gap:10px;}
.tela-frota .fr-copia-grupo{border:1px solid var(--border);border-left:3px solid var(--muted);border-radius:12px;padding:12px 14px;background:var(--surface);}
.tela-frota .fr-copia-grupo.desistiu{border-left-color:var(--red);background:color-mix(in srgb,var(--red) 10%,var(--surface));}
.tela-frota .fr-copia-grupo.tentando{border-left-color:var(--orange);background:color-mix(in srgb,var(--orange) 10%,var(--surface));}
.tela-frota .fr-copia-titulo{margin:0;font-family:var(--fonte-principal);font-size:max(9px, calc(12.5px * var(--escala-texto, 1)));font-weight:700;line-height:1.45;color:var(--text);}
/* A cor fica na BORDA da linha, não no texto do nome do carro — mesma decisão
   do .fr-itens li, pelo mesmo motivo: nome colorido some num dos dois temas. */
.tela-frota .fr-copia-carros{margin:9px 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:5px;}
.tela-frota .fr-copia-carros li{font-family:var(--fonte-principal);font-size:max(9px, calc(12.5px * var(--escala-texto, 1)));line-height:1.45;color:var(--text);padding-left:9px;border-left:2px solid var(--border);overflow-wrap:anywhere;}
/* `overflow-wrap:anywhere` porque a frase do robô pode trazer nome de arquivo
   comprido, e `overflow-x:clip` nos estilos globais cortaria isso em silêncio,
   sem barra de rolagem pra denunciar — no celular, que é onde se olha. */
.tela-frota .fr-copia-motivo{margin:10px 0 0;font-family:var(--fonte-principal);font-size:max(9px, calc(12.5px * var(--escala-texto, 1)));line-height:1.55;color:var(--text);overflow-wrap:anywhere;}
/* A frase que impede a leitura errada, e por isso ela é fixa e não some: papel
   atrasado NÃO invalida ficha. A prova é a assinatura gravada no banco; o PDF
   é cópia de arquivo. */
.tela-frota .fr-copia-calma{margin:0;font-family:var(--fonte-principal);font-size:max(9px, calc(11.5px * var(--escala-texto, 1)));line-height:1.55;color:var(--muted);}

/* O NÚMERO DE PATRIMÔNIO, destacado (pedido do dono, 20/08/2026). A moldura
   existe porque este campo faz uma coisa que nenhum outro da ficha faz: criar
   registro na OUTRA ferramenta. Ele merece parecer diferente dos campos que só
   guardam texto. */
.tela-frota .fr-patrimonio-destaque{margin:0 0 14px;padding:12px 14px;border:1px solid var(--accent);border-radius:var(--radius-md);background:color-mix(in srgb,var(--accent) 6%,var(--surface));}
.tela-frota .fr-patrimonio-destaque .fr-campo{margin:0;}

/* O aviso sobre o número digitado REUSA `fr-prova-frase`, que já existe nesta
   tela com os mesmos três tons. Aqui fica só o espaçamento — inventar cor
   própria daria dois avisos com caras diferentes na mesma ferramenta, e a
   primeira versão deste bloco ainda pintava o TEXTO de laranja, que reprova no
   contraste a 12px (PADRAO-DA-CENTRAL.md, seção 2). */
.tela-frota .fr-etiqueta-aviso{margin-top:8px;}

/* COMO O CARRO FICA: as quatro respostas como botões, não como lista suspensa.
   Lista suspensa esconde as opções atrás de um toque, e esta é uma pergunta que
   a pessoa precisa VER inteira pra responder — ela não sabe de antemão que
   "livre" e "fixo com uma pessoa" são coisas diferentes aqui.
   Grade de largura igual: rótulo comprido não pode fazer um botão virar o dobro
   do vizinho, que foi o defeito dos botões do cartão de veículo em 19/08. */
.tela-frota .fr-comofica{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-top:6px;}
.tela-frota .fr-comofica-btn{font-family:var(--fonte-principal);font-size:max(9px, calc(13.5px * var(--escala-texto, 1)));font-weight:600;min-height:44px;padding:11px 12px;border:1px solid var(--border);border-radius:10px;background:var(--surface);color:var(--text);cursor:pointer;touch-action:manipulation;overflow-wrap:anywhere;}
.tela-frota .fr-comofica-btn.on{background:var(--accent);border-color:var(--accent);color:var(--sobre-cor);}
@media (min-width:640px){
  .tela-frota .fr-comofica{grid-template-columns:repeat(4,1fr);}
}


/* "Outros carros sem checklist hoje" (D21b). Uma linha por carro: nome, de quem
   ele é, e o botão. No celular vira coluna, senão o nome comprido ("FIAT PUNTO
   ESSENCE 1.6") espremeria o botão contra a borda — e `overflow-x:clip` cortaria
   isso em silêncio, sem barra de rolagem pra denunciar.

   ⚠️ `fr-outros` é SÓ desta lista. A de "Na rua com outras pessoas" usava o
   mesmo nome até 20/08/2026, e as duas saíam trocadas — ver o comentário de
   `fr-com-outros`, mais abaixo. Lista nova aqui nasce com nome próprio. */
.tela-frota .fr-outros{list-style:none;margin:0;padding:0 14px;display:flex;flex-direction:column;gap:10px;}
.tela-frota .fr-outros li{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:10px 12px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--surface);}
.tela-frota .fr-outros-ident{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1 1 160px;overflow-wrap:anywhere;}
.tela-frota .fr-outros li .fr-btn{flex:0 0 auto;}
@media (max-width:640px){
  .tela-frota .fr-outros li{align-items:stretch;flex-direction:column;}
  /* O `flex-basis:160px` de cima vira ALTURA quando a linha vira coluna, e
     abria um buraco de 160px entre o nome e o botão — visto na foto, não
     deduzido. Em coluna, a caixa do nome tem a altura do que ela contém. */
  .tela-frota .fr-outros-ident{flex:0 0 auto;}
  .tela-frota .fr-outros li .fr-btn{width:100%;}
}

/* O resultado da conferência. Quatro estados, e a cor é a diferença entre
   acusar e avisar: vermelho SÓ quando alguma coisa mudou depois de assinada. */
.tela-frota .fr-conferencia{margin:8px 0 2px;font-family:var(--fonte-principal);font-size:max(9px, calc(12.5px * var(--escala-texto, 1)));line-height:1.55;color:var(--text);overflow-wrap:anywhere;}
.tela-frota .fr-conferencia.ok{color:var(--green);}
.tela-frota .fr-conferencia.ruim{color:var(--red);}
.tela-frota .fr-conferencia.incompleto{color:var(--orange);}
.tela-frota .fr-conferencia.nada{color:var(--muted);}
/* Por que o botão de WhatsApp não apareceu — nunca em silêncio. Mesma cor de
   atenção que os outros avisos "algo pede providência" desta tela. */
.tela-frota .fr-cobranca-sem-tel{margin-top:14px;padding:0;}
/* Devolver o telefone pro cadastro (Bronca 1): botão discreto de propósito —
   é um extra opcional, não a ação principal do card, que continua sendo
   cobrar no WhatsApp. Mesmo padrão de "botão-link" que .ck-trocar usa no
   painel de checklist: sem fundo nem borda, cor de destaque por token. */
.tela-frota .fr-convite{margin-top:10px;display:flex;flex-direction:column;gap:6px;}
.tela-frota .fr-convite-feito{margin-top:10px;padding:11px 13px;border-radius:10px;display:flex;flex-direction:column;gap:8px;background:color-mix(in srgb,var(--green) 8%,var(--surface));border:1px solid color-mix(in srgb,var(--green) 26%,var(--surface));}
.tela-frota .fr-convite-titulo{margin:0;font-family:var(--fonte-principal);font-size:max(9px, calc(13px * var(--escala-texto, 1)));font-weight:700;color:var(--text);}
.tela-frota .fr-convite-dados{margin:0;display:flex;flex-direction:column;gap:3px;font-family:var(--fonte-principal);font-size:max(9px, calc(12.5px * var(--escala-texto, 1)));color:var(--text);overflow-wrap:anywhere;}
/* Fonte de dados e espaçamento: esta senha vai ser LIDA em voz alta ou digitada
   olhando pra tela, e o alfabeto já evita o que se confunde. */
.tela-frota .fr-convite-pendencias{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:5px;font-family:var(--fonte-principal);font-size:max(9px, calc(12px * var(--escala-texto, 1)));line-height:1.5;color:var(--orange);overflow-wrap:anywhere;}
.tela-frota .fr-senha{font-family:var(--fonte-dados);letter-spacing:1.5px;}
.tela-frota .fr-copiar-tel{margin-top:8px;}
.tela-frota .fr-copiar-tel-btn{background:none;border:0;padding:2px 0;cursor:pointer;font-family:var(--fonte-principal);font-size:max(9px, calc(11.5px * var(--escala-texto, 1)));font-weight:600;color:var(--accent);text-align:left;}
.tela-frota .fr-copiar-tel-btn:hover:not(:disabled){text-decoration:underline;}
.tela-frota .fr-copiar-tel-btn:disabled{opacity:.6;cursor:default;}
.tela-frota .fr-erro-inline{margin:4px 0 0;font-family:var(--fonte-principal);font-size:max(9px, calc(11.5px * var(--escala-texto, 1)));color:var(--red,#c0392b);line-height:1.4;}
.tela-frota .fr-copiado-tel{margin-top:8px;font-family:var(--fonte-principal);font-size:max(9px, calc(11.5px * var(--escala-texto, 1)));color:var(--green,#16a34a);}
/* Os carros de outras pessoas: lista simples, sem cartão e sem botão. Dar
   cartão a eles daria a entender que há algo a fazer, e não há.

   NOME PRÓPRIO desde 20/08/2026, e é ele que faz o comentário acima virar
   verdade. Esta lista se chamava `fr-outros`, o MESMO nome da lista de
   "Outros carros sem checklist hoje" — que é de cartões, com botão. Duas
   listas diferentes, uma classe só, e o resultado saía trocado nas duas:

     - esta ganhava o cartão de lá (`.fr-outros li` põe borda, fundo branco e
       canto arredondado), exatamente o que este comentário mandava não ter;
     - e a de lá ganhava daqui o `gap:7px`, a fonte apagada de 12,5px e um
       `padding-bottom:40px` de espaço morto embaixo dos cartões.

   Medido com o CSS do build: as duas saíam com estilo IDÊNTICO.

   `fr-com-outros` é o nome do dado que a alimenta (`painel.comOutros`). O
   `padding-bottom:40px` fica AQUI porque é esta lista que termina a área do
   Motorista — é respiro do fim da tela, não do cartão. */
.tela-frota .fr-com-outros{margin:0;padding:0 14px 40px;list-style:none;display:flex;flex-direction:column;gap:7px;font-family:var(--fonte-principal);font-size:max(9px, calc(12.5px * var(--escala-texto, 1)));color:var(--muted);}
.tela-frota .fr-com-outros strong{color:var(--text);font-weight:600;}
.tela-frota .fr-pedidos{margin:0;padding:0 14px;list-style:none;display:flex;flex-direction:column;gap:9px;}
.tela-frota .fr-pedido{background:var(--surface);border:1px solid var(--border);border-radius:11px;padding:12px 14px;}
.tela-frota .fr-pedido-topo{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;font-family:var(--fonte-principal);font-size:max(9px, calc(13px * var(--escala-texto, 1)));color:var(--text);}
.tela-frota .fr-pedido-quando{margin-top:4px;font-family:var(--fonte-principal);font-size:max(9px, calc(12px * var(--escala-texto, 1)));color:var(--muted);}
.tela-frota .fr-pedido-motivo{margin:8px 0 0;font-family:var(--fonte-principal);font-size:max(9px, calc(12.5px * var(--escala-texto, 1)));line-height:1.5;color:var(--muted);}
.tela-frota .fr-recado{margin:0 0 4px;font-family:var(--fonte-principal);font-size:max(9px, calc(13.5px * var(--escala-texto, 1)));line-height:1.6;color:var(--text);}
.tela-frota .fr-card.espera{border-left-color:var(--orange,#d97706);}
.tela-frota .fr-card.ruimzao{border-left-color:var(--red,#c0392b);}

/* ── O HISTÓRICO DE RESERVAS E RETIRADAS (13/08/2026) ──────────────────────

   A BARRA DE FILTRO. Cada botão traz a própria conta: a resposta antes do
   clique, mesma ideia dos botões rápidos do topo que o dono já aprovou.
   Filtro com zero linha fica VISÍVEL e desligado, em vez de sumir — barra que
   muda de forma a cada carregamento é barra que a pessoa reaprende toda vez.
   40px de altura porque é alvo de dedo, como tudo o mais nesta ferramenta. */
.tela-frota .fr-filtros{display:flex;flex-wrap:wrap;gap:var(--sp-2);padding:0 14px var(--sp-3);}
.tela-frota .fr-filtro{display:inline-flex;align-items:center;gap:6px;min-height:40px;
  padding:8px 13px;border:1px solid var(--border);border-radius:999px;background:var(--surface);
  color:var(--text);font-family:var(--fonte-principal);
  font-size:max(9px, calc(12.5px * var(--escala-texto, 1)));font-weight:600;
  cursor:pointer;touch-action:manipulation;}
.tela-frota .fr-filtro.on{background:var(--accent-light);border-color:var(--accent-mid);color:var(--accent-forte);}
.tela-frota .fr-filtro:disabled{opacity:.45;cursor:default;}
.tela-frota .fr-filtro-n{font-family:var(--fonte-dados);font-variant-numeric:tabular-nums;
  font-size:max(9px, calc(11px * var(--escala-texto, 1)));color:var(--muted);}
.tela-frota .fr-filtro.on .fr-filtro-n{color:var(--accent-forte);}

/* O bloco "o que aconteceu": separado do que foi PEDIDO por um fio, porque são
   duas coisas diferentes — o combinado e o que o carro realmente fez. */
.tela-frota .fr-prova{margin-top:var(--sp-3);padding-top:var(--sp-3);border-top:1px solid var(--border);
  display:flex;flex-direction:column;gap:6px;}
/* CAIXA ALTA ESPAÇADA SÓ ONDE SEPARA SEÇÃO, nunca como rótulo dentro do
   cartão (D7). Este título aparecia em TODO cartão, em 700 com 1,5px de
   espaçamento, competindo com o nome do carro logo acima. Ele não é um segundo
   título — é uma legenda. Agora tem o peso de uma. */
.tela-frota .fr-hist-titulo{margin:0;font-family:var(--fonte-principal);
  font-size:max(9px, calc(11px * var(--escala-texto, 1)));font-weight:600;letter-spacing:.4px;
  text-transform:none;color:var(--muted);}
.tela-frota .fr-hist-linha{margin:0;font-family:var(--fonte-principal);
  font-size:max(9px, calc(12.5px * var(--escala-texto, 1)));line-height:1.55;color:var(--text);
  overflow-wrap:anywhere;}
.tela-frota .fr-hist-zoho{color:var(--muted);}
/* A frase da posse é a ÚNICA linha de conteúdo do cartão de carro fixo, então
   ela ganha o corpo do texto normal em vez do miúdo do rastro. */
.tela-frota .fr-hist-posse{font-size:max(10px, calc(13.5px * var(--escala-texto, 1)));}
/* O rastro (quem pediu, quem decidiu, quem encerrou) é o miúdo do card: existe
   pra ser consultado, não pra competir com o que aconteceu. */
.tela-frota .fr-hist-rastro{margin:var(--sp-2) 0 0;font-family:var(--fonte-principal);
  font-size:max(9px, calc(11.5px * var(--escala-texto, 1)));line-height:1.5;color:var(--muted);
  overflow-wrap:anywhere;}

/* A FRASE DA PROVA. Fundo tingido com o texto em --text, nunca texto colorido:
   `--orange` como texto sobre a superfície mede 4,06 de contraste no tema
   claro — medido nesta mesma tela, ver o comentário do .fr-cobranca-selo — e o
   mínimo é 4,5. A cor continua sendo o sinal; o texto é pra ler.
   Os três tons dizem coisas diferentes, e a diferença é o ponto:
     verde    — a assinatura é de quem pegou o carro. É a prova completa.
     laranja  — existe assinatura, mas não é de quem pegou. Dado a saber.
     vermelho — não ficou prova nenhuma daquela saída. */
.tela-frota .fr-prova-frase{margin:0;padding:9px 11px;border-radius:10px;
  font-family:var(--fonte-principal);font-size:max(9px, calc(12.5px * var(--escala-texto, 1)));
  line-height:1.55;color:var(--text);overflow-wrap:anywhere;
  background:var(--surface2);border:1px solid var(--border);}
.tela-frota .fr-prova-frase.boa{background:color-mix(in srgb,var(--green) 12%,var(--surface));
  border-color:color-mix(in srgb,var(--green) 34%,var(--surface));}
.tela-frota .fr-prova-frase.atencao{background:color-mix(in srgb,var(--orange) 12%,var(--surface));
  border-color:color-mix(in srgb,var(--orange) 34%,var(--surface));}
.tela-frota .fr-prova-frase.ruim{background:color-mix(in srgb,var(--red) 12%,var(--surface));
  border-color:color-mix(in srgb,var(--red) 34%,var(--surface));}

/* O botão de perigo desta tela. Ele NÃO aparece em lista: mora no rodapé dos
   dois modais que exigem motivo escrito, que é o "passo a mais" que o padrão
   manda. `--sobre-cor`, nunca `#fff`: no tema escuro os tokens de cor são
   claros de propósito, e branco em cima deles não se lê. */
.tela-frota .fr-btn-perigo{background:var(--red);border-color:var(--red);color:var(--sobre-cor);}

/* O ACEITE DE RETIRADA, dentro da ficha. Caixa própria porque ele é uma
   pergunta a mais no meio de um formulário — sem a moldura, o campo de
   desenhar apareceria solto e pareceria parte do campo de cima. */
.tela-frota .fr-aceite{display:flex;flex-direction:column;gap:var(--sp-2);
  padding:12px 13px;border-radius:12px;
  background:color-mix(in srgb,var(--accent) 7%,var(--surface));
  border:1px solid color-mix(in srgb,var(--accent) 26%,var(--surface));}
.tela-frota .fr-itens{margin:12px 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px;}
.tela-frota .fr-itens li{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;font-family:var(--fonte-principal);font-size:max(9px, calc(12.5px * var(--escala-texto, 1)));color:var(--muted);padding-left:10px;border-left:2px solid var(--border);}
/* A cor fica na BORDA, não no texto: item vencido em vermelho sobre fundo
   claro e escuro fica ilegível num dos dois temas. */
.tela-frota .fr-itens li.vencida{border-left-color:var(--red,#c0392b);}
.tela-frota .fr-itens li.perto{border-left-color:var(--orange,#d97706);}
.tela-frota .fr-itens li.em-dia{border-left-color:var(--green,#16a34a);}
/* O mesmo código de cor, agora pras respostas do checklist (detalhe da
   ficha, V2): OK verde, Problema vermelho, Não se aplica neutro. */
.tela-frota .fr-itens li.estado-ok{border-left-color:var(--green,#16a34a);}
.tela-frota .fr-itens li.estado-nao_ok{border-left-color:var(--red,#c0392b);}
.tela-frota .fr-itens li.estado-na{border-left-color:var(--muted);}
/* O resultado da ficha (liberado/com ressalvas/não liberado), mesmo esquema
   de cor do restante da tela. */
.tela-frota .fr-resultado-liberado{color:var(--green,#16a34a);}
.tela-frota .fr-resultado-com_ressalvas{color:var(--orange,#d97706);}
.tela-frota .fr-resultado-nao_liberado{color:var(--red,#c0392b);}
.tela-frota .fr-item-nome{color:var(--text);font-weight:600;}
/* Mora dentro do `.fr-ficha-corpo`, que agora corta no `overflow-x:clip`
   (Tarefa 4/B3) — e este texto vem de `r.observacao`/`h.oficina`, digitado
   por gente, não escrito por quem programa. Sem quebrar em qualquer ponto,
   uma palavra comprida sem espaço sumiria pra sempre na borda direita, sem
   barra de rolagem pra denunciar. Mesmo par clip+anywhere de `.fr-copia-carros
   li`/`.fr-copia-motivo`/`.fr-outros-ident`/`.fr-conferencia` logo abaixo —
   não tire um sem o outro. */
.tela-frota .fr-item-txt{font-variant-numeric:tabular-nums;overflow-wrap:anywhere;}
.tela-frota .fr-item-km{font-family:var(--fonte-dados);font-size:max(9px, calc(12.5px * var(--escala-texto, 1)));font-weight:700;color:var(--accent);font-variant-numeric:tabular-nums;}
.tela-frota .fr-pedido.desligado{opacity:.5;}
.tela-frota .fr-grupo{margin:6px 0 2px;font-family:var(--fonte-principal);font-size:max(9px, calc(10px * var(--escala-texto, 1)));font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:var(--accent);}
.tela-frota .fr-dupla{display:grid;grid-template-columns:1fr;gap:12px;}
@media(min-width:560px){ .tela-frota .fr-dupla{grid-template-columns:1fr 1fr;} }
.tela-frota .fr-hist{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px;}
.tela-frota .fr-hist li{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 10px;background:var(--surface2,var(--surface));border:1px solid var(--border);border-radius:9px;font-family:var(--fonte-principal);font-size:max(9px, calc(12.5px * var(--escala-texto, 1)));color:var(--muted);}
.tela-frota .fr-hist .fr-item-txt{flex:1;min-width:0;}
/* 34px, a mesma medida do "✕" dos modais no computador — e não 28px, que era
   o que ele tinha. Dois motivos: o padrão da casa exige alvo confortável, e
   este botão APAGA um registro do histórico, então errar o toque nele é o
   erro mais caro desta tela. Fica igual aos irmãos, e deixa de ser o botãozinho
   solto de tamanho próprio. */
.tela-frota .fr-mini{appearance:none;border:1px solid var(--border);background:none;color:var(--muted);border-radius:9px;width:34px;height:34px;font-size:max(9px, calc(13px * var(--escala-texto, 1)));cursor:pointer;flex:0 0 auto;touch-action:manipulation;}
.tela-frota .fr-mini:hover{border-color:var(--red,#c0392b);color:var(--red,#c0392b);}
.tela-frota .fr-selo.espera{background:color-mix(in srgb,var(--orange,#d97706) 18%,transparent);color:var(--orange,#d97706);}
.tela-frota .fr-selo.boa{background:color-mix(in srgb,var(--green,#16a34a) 18%,transparent);color:var(--green,#16a34a);}
.tela-frota .fr-selo.ruim{background:color-mix(in srgb,var(--red,#c0392b) 16%,transparent);color:var(--red,#c0392b);}
.tela-frota .fr-selo.neutra{background:color-mix(in srgb,var(--muted) 16%,transparent);color:var(--muted);}
.tela-frota .fr-resumo{display:flex;align-items:center;gap:7px;padding:10px 14px;font-family:var(--fonte-principal);font-size:max(9px, calc(12.5px * var(--escala-texto, 1)));color:var(--muted);}
.tela-frota .fr-resumo strong{color:var(--text);font-variant-numeric:tabular-nums;}
.tela-frota .fr-sep{color:var(--muted);}
.tela-frota .fr-vazio,.tela-frota .fr-erro{padding:40px 20px;text-align:center;font-family:var(--fonte-principal);font-size:max(9px, calc(13px * var(--escala-texto, 1)));color:var(--muted);}
.tela-frota .fr-erro{color:var(--red,#c0392b);}

/* O editor da lista de checklist (F8) só empresta o espaçamento lateral das
   outras áreas — o miolo visual é do próprio componente EditorDeChecklist. */
.tela-frota .fr-checklist-editor{padding:4px 14px 40px;}

.tela-frota .fr-lista{display:flex;flex-direction:column;gap:10px;padding:4px 14px 40px;}
/* A lista que NÃO é a última da tela: os 40px de respiro do fim viram o do
   meio, senão sobra um vão entre ela e a seção seguinte. */
.tela-frota .fr-lista.no-meio{padding-bottom:0;}
/* CARTÃO EM COLUNA, e isso não é preferência de escrita: é o que permite ao
   `.fr-acoes` empurrar-se pro rodapé com `margin-top:auto` lá embaixo. Sem
   `flex-direction:column` aqui, o `auto` não tem eixo pra empurrar e o botão
   fica onde o texto acabar — que é o que deixava, no computador, cada coluna
   da grade com o botão numa altura diferente. (Bronca do dono, 13/08/2026:
   "os cards e botões no computador estão feios".)
   Medida do respiro e do raio pela ESCALA, não no olho: `--card-pad` e
   `--card-radius` são os mesmos que o resto da Central usa. */
.tela-frota .fr-card{background:var(--surface);border:1px solid var(--border);border-left:3px solid var(--green,#16a34a);border-radius:var(--card-radius);padding:var(--card-pad);display:flex;flex-direction:column;}
.tela-frota .fr-card.rua{border-left-color:var(--accent);}
.tela-frota .fr-card.parado{border-left-color:var(--muted);opacity:.72;}
/* CARRO FIXO. Cor do accent porque é um estado NORMAL — o carro está onde
   deveria estar. E SEM o `opacity` do `.parado`: apagar o cartão diria que a
   informação vale menos, quando ela é a resposta de "quem está com o quê". */
.tela-frota .fr-card.fixo{border-left-color:var(--accent-mid, var(--accent));}
/* Arquivada continua legível — só recua. Ela não some da tela por defeito, e
   sim porque alguém a tirou da lista; quem abriu o filtro "Arquivadas" foi
   procurar por ela e precisa conseguir ler o que achou. */
.tela-frota .fr-card.arquivada{border-left-color:var(--border);opacity:.82;}
/* O campo de digitar telefone (D5). Os 16px do input NÃO são estética: abaixo
   disso o iOS dá zoom ao focar e a tela salta na cara de quem está digitando —
   regra 6 do PADRAO-DA-CENTRAL. Os 40px de altura são o alvo mínimo de toque. */
.tela-frota .fr-digitar-tel{margin-top:10px;padding-top:10px;border-top:1px solid var(--border);}
.tela-frota .fr-digitar-tel-lab{display:block;margin:0 0 6px;color:var(--muted);
  font-family:var(--fonte-principal);font-size:max(9px, calc(12.5px * var(--escala-texto, 1)));}
.tela-frota .fr-digitar-tel-linha{display:flex;gap:8px;flex-wrap:wrap;}
.tela-frota .fr-digitar-tel-linha input{flex:1 1 150px;min-width:0;min-height:40px;padding:0 12px;
  font-family:var(--fonte-dados);font-size:16px;color:var(--text);background:var(--surface);
  border:1px solid var(--border);border-radius:var(--radius-md);}
.tela-frota .fr-digitar-tel-linha input:focus-visible{outline:2px solid var(--accent);outline-offset:1px;}

/* ── Histórico de checklists (D6) ─────────────────────────────────────────── */
/* O RECUO LATERAL PADRÃO DA CASA: 14px no celular, 24px no computador — o
   mesmo de `.fr-lista` e `.fr-resumo`. Sem ele estes blocos encostavam na
   borda da tela (visto pelo dono no computador, 19/08). Cada bloco carrega o
   próprio recuo, que é como o resto deste arquivo faz. */
.tela-frota .fr-filtros-campo{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:14px;
  padding:0 14px;}
.tela-frota .fr-filtro-campo{display:flex;flex-direction:column;gap:4px;flex:1 1 170px;min-width:0;}
.tela-frota .fr-filtro-campo span{color:var(--muted);font-family:var(--fonte-principal);
  font-size:max(9px, calc(12px * var(--escala-texto, 1)));}
/* 16px no select pelo mesmo motivo do input: abaixo disso o iOS dá zoom. */
.tela-frota .fr-filtro-campo select{min-height:40px;font-size:16px;padding:0 10px;
  color:var(--text);background:var(--surface);border:1px solid var(--border);
  border-radius:var(--radius-md);font-family:var(--fonte-principal);}
.tela-frota .fr-dia-de-ficha{margin-bottom:16px;padding:0 14px;}
.tela-frota .fr-dia-cab{display:flex;align-items:baseline;justify-content:space-between;gap:10px;
  margin-bottom:6px;padding-bottom:5px;border-bottom:1px solid var(--border);}
.tela-frota .fr-dia-data{font-family:var(--fonte-dados);font-weight:500;
  font-size:max(9px, calc(12.5px * var(--escala-texto, 1)));}
.tela-frota .fr-dia-conta{color:var(--muted);font-family:var(--fonte-principal);
  font-size:max(9px, calc(12px * var(--escala-texto, 1)));}
/* A linha inteira é o alvo de toque — 44px, acima do mínimo de 40. Botão, e não
   div com @click, pra chegar pelo teclado e ser anunciada como acionável. */
.tela-frota .fr-ficha-linha{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2px 12px;
  width:100%;min-height:44px;padding:8px 2px;text-align:left;background:transparent;
  border:0;border-bottom:1px solid var(--border);cursor:pointer;font-family:var(--fonte-principal);}
.tela-frota .fr-ficha-linha:hover{background:var(--surface2);}
.tela-frota .fr-ficha-linha:focus-visible{outline:2px solid var(--accent);outline-offset:-2px;}
.tela-frota .fr-ficha-carro{font-weight:600;color:var(--text);overflow-wrap:anywhere;
  font-size:max(10px, calc(13.5px * var(--escala-texto, 1)));}
.tela-frota .fr-ficha-km{font-family:var(--fonte-dados);font-variant-numeric:tabular-nums;
  text-align:right;color:var(--text);font-size:max(9px, calc(12.5px * var(--escala-texto, 1)));}
.tela-frota .fr-ficha-quem{grid-column:1;color:var(--muted);overflow-wrap:anywhere;
  font-size:max(9px, calc(12.5px * var(--escala-texto, 1)));}
.tela-frota .fr-ficha-selos{grid-column:2;display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap;}
.tela-frota .fr-selo.com-ressalva{background:color-mix(in srgb, var(--orange) 12%, var(--surface));
  border-color:color-mix(in srgb, var(--orange) 36%, var(--surface));}
/* Sem esta regra o selo "Sem assinatura" ficaria IDÊNTICO ao "Assinada": a
   classe que já existia é `.fr-cobranca-selo.sem-assinatura`, de outro bloco.
   Classe escrita no template não é classe que existe no CSS. */
.tela-frota .fr-selo.sem-assinatura{background:color-mix(in srgb, var(--orange) 16%, var(--surface));
  border-color:color-mix(in srgb, var(--orange) 40%, var(--surface));color:var(--text);}
/* A frase do limite ("Mostrando os últimos 120 dias") é irmã dos blocos acima
   e segue o mesmo recuo — `.fr-ajuda` sozinha não tem, porque nasceu pra viver
   DENTRO de cartão, onde o cartão dá o respiro. */
.tela-frota .fr-fichas-limite{padding:0 14px 8px;}
.tela-frota .fr-card-topo{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;}
.tela-frota .fr-card-ident{display:flex;flex-direction:column;gap:2px;min-width:0;}
.tela-frota .fr-card-nome{font-family:var(--fonte-principal);font-size:max(9px, calc(13.5px * var(--escala-texto, 1)));font-weight:700;color:var(--text);}
.tela-frota .fr-placa{font-family:var(--fonte-dados);font-size:max(9px, calc(11px * var(--escala-texto, 1)));letter-spacing:1.5px;color:var(--muted);}
.tela-frota .fr-selo{font-family:var(--fonte-principal);font-size:max(9px, calc(10px * var(--escala-texto, 1)));font-weight:700;letter-spacing:.4px;padding:4px 10px;border-radius:999px;background:color-mix(in srgb,var(--muted) 16%,transparent);color:var(--text);white-space:nowrap;}
.tela-frota .fr-selo.livre{background:color-mix(in srgb,var(--green,#16a34a) 18%,transparent);color:var(--green,#16a34a);}
.tela-frota .fr-selo.rua{background:color-mix(in srgb,var(--accent) 18%,transparent);color:var(--accent);}

.tela-frota .fr-dados{display:flex;gap:26px;margin-top:12px;flex-wrap:wrap;}
.tela-frota .fr-dado{display:flex;flex-direction:column;gap:1px;}
/* Idem: 9,5px em caixa alta com espaçamento é a letra mais difícil de ler do
   cartão, e ela estava carregando o rótulo de CADA campo. Vira minúscula, um
   ponto maior, e sem espaçamento — o contraste com o valor (13px, 600) já
   separa os dois sem precisar de um segundo recurso. */
.tela-frota .fr-dado-lab{font-family:var(--fonte-principal);
  font-size:max(9px, calc(11px * var(--escala-texto, 1)));letter-spacing:0;
  text-transform:none;color:var(--muted);}
.tela-frota .fr-dado-val{font-family:var(--fonte-dados);font-size:max(9px, calc(13px * var(--escala-texto, 1)));font-weight:600;color:var(--text);font-variant-numeric:tabular-nums;}
.tela-frota .fr-dado-val.alerta{color:var(--orange,#d97706);}
/* `flex-wrap` porque um cartão pode ter quatro botões ("Abrir ficha",
   "Devolver", "Passar, devolver ou recolher", "WhatsApp") e sem quebra o
   último sairia pela borda — e `overflow-x:clip` cortaria isso em silêncio. */
.tela-frota .fr-acoes{display:flex;gap:var(--sp-2);margin-top:var(--sp-3);flex-wrap:wrap;}
/* `margin-top:auto` = a ação COLA NO RODAPÉ do cartão. Na grade do computador
   os cartões de uma mesma linha já têm a mesma altura (é o padrão do grid), e
   é isto que faz os botões pararem todos na mesma altura em vez de subirem e
   descerem conforme o texto de cada carro.

   FILHO DIRETO do cartão, de propósito. `.fr-acoes` também aparece DENTRO de
   outros blocos (a caixa da senha do convite, por exemplo), no meio de outros
   parágrafos — ali um `auto` empurraria a linha de botões e tudo o que vem
   depois pro pé da caixa, abrindo um buraco no meio. */
.tela-frota .fr-card > .fr-acoes{margin-top:auto;padding-top:var(--sp-3);}

/* 44px de altura em tudo que se toca: é o alvo que o dedo acerta. Esta
   ferramenta é usada em pé, no estacionamento, com uma mão só. */
.tela-frota .fr-btn{flex:1 1 auto;min-height:44px;font-family:var(--fonte-principal);font-size:max(9px, calc(13.5px * var(--escala-texto, 1)));font-weight:600;padding:11px 16px;border:1px solid var(--border);border-radius:10px;background:var(--surface);color:var(--text);cursor:pointer;touch-action:manipulation;}
/* Verde do WhatsApp, que e como as pessoas reconhecem o botao sem ler. */
.tela-frota .fr-zap{display:inline-flex;align-items:center;justify-content:center;gap:7px;text-decoration:none;border-color:#25d366;color:#128c4a;}
.tela-frota .fr-zap:hover{background:color-mix(in srgb,#25d366 12%,transparent);}
/* ── OS BOTÕES DO CARTÃO DE VEÍCULO (20/08/2026) ────────────────────────────
   Bronca do dono: "os botões na seção de veículos da empresa estão
   bagunçados". Ele tinha razão, e a causa é o `flex:1 1 auto` com quebra: cada
   botão ganhava a largura do próprio texto, e como os rótulos variam muito
   ("Devolver", "WhatsApp", "Passar, devolver ou recolher") o mesmo cartão
   saía com três larguras diferentes e a quebra caía num lugar por carro.

   GRADE, e não flex, porque grade dá COLUNA IGUAL sem depender do texto. É o
   que o dono pediu: no celular dois em cima e um embaixo; no computador todos
   lado a lado.

   Vale SÓ no cartão de veículo (`.fr-acoes-veiculo`). O `.fr-acoes` continua
   como está no resto da tela — reservas, checklist e rodapé de ficha estão no
   ar e não foram reclamados. */
.tela-frota .fr-acoes-veiculo{display:grid;grid-template-columns:1fr 1fr;gap:var(--sp-2);}
/* Botão sozinho na última linha ocupa a linha inteira: meia largura solta lê
   como se faltasse alguma coisa do lado. Pega o caso de 1 botão e o de 3. */
.tela-frota .fr-acoes-veiculo > :last-child:nth-child(odd){grid-column:1 / -1;}
/* Na grade quem manda na largura é a COLUNA. Sem `min-width:0` o conteúdo do
   botão vira o piso da coluna e a grade estoura pro lado. */
.tela-frota .fr-acoes-veiculo > .fr-btn{min-width:0;width:100%;}

.tela-frota .fr-btn.primario{background:var(--accent);border-color:var(--accent);color:var(--sobre-cor);}
.tela-frota .fr-btn:disabled{opacity:.6;cursor:default;}

.tela-frota .fr-ficha-fundo{position:fixed;inset:0;z-index:1200;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:14px;touch-action:none;overscroll-behavior:contain;}
.tela-frota .fr-ficha-fundo > *{overscroll-behavior:contain;touch-action:pan-y;}
/* 720px em TODOS os modais desta tela (pedido do dono, 12/08/2026: "está
   pequeno em algumas abas, pode ser maior igual o modal que abre quando abro a
   ficha dos veículos"). Eram 460px aqui e 720px só na ficha do veículo, e a
   diferença não tinha razão — era a ficha que tinha crescido, e as outras
   ficaram pra trás.
   Igualar não é só estética: modal sempre do mesmo tamanho é uma coisa a menos
   pra estranhar, e quem usa esta ferramenta tem dificuldade com aplicativos.
   No celular nada muda — `width:100%` com o respiro do fundo já mandava lá. */
.tela-frota .fr-ficha{width:100%;max-width:720px;max-height:calc(100dvh - 28px);display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--border);border-radius:16px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.35);}
.tela-frota .fr-ficha-topo{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:13px 15px;border-bottom:1px solid var(--border);}
/* flex:1 pra empurrar o "?" e o "✕" pro canto direito, juntos — sem isso os
   três filhos do topo (título, ajuda, fechar) ficariam espaçados igualmente
   pelo justify-content:space-between de cima, com o "?" preso no meio. */
.tela-frota .fr-ficha-titulo{flex:1;min-width:0;font-family:var(--fonte-principal);font-size:max(9px, calc(12.5px * var(--escala-texto, 1)));font-weight:700;letter-spacing:.6px;color:var(--text);}
/* O ✕ dos 6 modais. 40px na base (celular) porque o PADRÃO manda: "botão de
   fechar com 40px de alvo" e "dedo não acerta menos que isso". Estava em 34px,
   e errar o ✕ num modal que trava a rolagem do fundo é ficar preso na ficha.
   No computador volta pra 34px (bloco min-width:900px) — mesma decisão do
   fr-btn-ajuda logo abaixo, e pelo mesmo motivo: o ✕ divide a linha com o "?"
   com 10px de gap, e engordar os dois no desktop deixaria eles encostados.
   ⚠️ O teste padrao-da-central.test.mjs NÃO enxerga isto: ele lê `style=` no
   HTML, e a medida mora aqui, em classe. Conferido no navegador. */
.tela-frota .fr-fechar{appearance:none;border:1px solid var(--border);background:var(--surface);color:var(--text);border-radius:9px;width:40px;height:40px;font-size:max(9px, calc(15px * var(--escala-texto, 1)));cursor:pointer;flex:0 0 auto;touch-action:manipulation;}
/* O "?" de dentro do modal, que abre o passeio pelos campos DELE — mesmo
   desenho redondo do "?" da barra de topo (pat-btn-ajuda no Patrimônio), só
   que com as classes fr- desta tela. */
/* 40px na base (celular) porque o PADRÃO exige 40px de alvo de toque — "dedo
   não acerta menos que isso" — e o tutorial existe justamente pra quem está
   perdido: errar o botão de ajuda é o pior lugar possível pra errar. No
   desktop volta a 24px (ver o bloco min-width:900px): lá o ponteiro acerta
   24px de sobra, e o "?" fica ao lado do ✕ com só 10px de gap — 40px no
   desktop deixaria os dois quase encostados. */
.tela-frota .fr-btn-ajuda{width:40px;height:40px;flex:0 0 auto;border-radius:50%;border:1px solid var(--border);background:var(--surface);color:var(--muted);font-family:var(--fonte-principal);font-size:max(9px, calc(14px * var(--escala-texto, 1)));font-weight:700;cursor:pointer;touch-action:manipulation;}
.tela-frota .fr-btn-ajuda:hover{color:var(--accent);border-color:var(--accent);}
/* O corpo rola SÓ na vertical. `overflow-y:auto` com o eixo x em `visible` faz
   o x virar `auto` sozinho pela regra do CSS — foi assim que a ficha ficou
   arrastável pros lados sem ninguém pedir, e num modal que trava a rolagem do
   fundo isso é ficar perdido dentro da caixa. `clip` e não `hidden` pra não
   quebrar `position:sticky` de nada que venha a morar aqui — mesma escolha do
   `html,body` nos estilos globais.
   `touch-action:pan-y` REPETIDO aqui de propósito: o que existe em
   `.fr-ficha-fundo > *` pega a moldura da ficha, não este corpo, e é neste que
   o dedo encosta. */
.tela-frota .fr-ficha-corpo{padding:14px 15px;overflow-y:auto;overflow-x:clip;touch-action:pan-y;overscroll-behavior:contain;display:flex;flex-direction:column;gap:13px;}
/* Filho de grade sem `min-width:0` não encolhe abaixo do próprio conteúdo — é
   o que empurra a caixa e cria o estouro que a rolagem horizontal mostrava. */
.tela-frota .fr-dupla > *{min-width:0;}
/* O texto fixo do topo de cada modal (pedido do dono, em todos os 9). Curto
   de propósito — por isso um bloco pequeno com fundo sutil, não uma caixa de
   aviso do tamanho de um parágrafo de aviso de erro. Cor de fundo por
   color-mix (nunca hex): mistura o token com a superfície, então os dois
   temas ficam legíveis sem precisar de uma cor "clara" e uma "escura" à mão. */
.tela-frota .fr-tutorial-fixo{margin:0;padding:10px 12px;font-family:var(--fonte-principal);font-size:max(9px, calc(12.5px * var(--escala-texto, 1)));line-height:1.6;color:var(--text);background:color-mix(in srgb,var(--accent) 8%,var(--surface));border:1px solid color-mix(in srgb,var(--accent) 22%,var(--surface));border-radius:10px;}
.tela-frota .fr-campo{display:flex;flex-direction:column;gap:5px;}
.tela-frota .fr-lab{font-family:var(--fonte-principal);font-size:max(9px, calc(10.5px * var(--escala-texto, 1)));letter-spacing:.8px;text-transform:uppercase;color:var(--muted);}
/* 16px nos campos: abaixo disso o iPhone dá zoom sozinho ao tocar. */
.tela-frota .fr-campo input,.tela-frota .fr-campo select{font-family:var(--fonte-principal);font-size:max(16px, calc(16px * var(--escala-texto, 1)));padding:11px 12px;border:1px solid var(--border);border-radius:10px;background:var(--surface);color:var(--text);width:100%;box-sizing:border-box;}
/* Mesmo motivo do `.fr-item-txt` lá em cima: este span mostra
   `hodometro_justificativa`/`anomalias`, texto digitado por gente dentro de um
   `.fr-ficha-corpo` que corta em `overflow-x:clip` (Tarefa 4/B3). Sem
   `overflow-wrap`, uma palavra comprida sem espaço sumiria na borda sem
   avisar — não tire este `anywhere` sem também tirar o `clip` de cima. */
.tela-frota .fr-ajuda{font-family:var(--fonte-principal);font-size:max(9px, calc(11.5px * var(--escala-texto, 1)));color:var(--muted);overflow-wrap:anywhere;}
.tela-frota .fr-problemas{margin:0;padding:11px 13px 11px 30px;background:color-mix(in srgb,var(--orange,#d97706) 12%,transparent);border:1px solid color-mix(in srgb,var(--orange,#d97706) 34%,transparent);border-radius:10px;font-family:var(--fonte-principal);font-size:max(9px, calc(12.5px * var(--escala-texto, 1)));line-height:1.55;color:var(--text);}
.tela-frota .fr-ficha-rodape{display:flex;gap:9px;padding:13px 15px;border-top:1px solid var(--border);}

@media(min-width:900px){
  .tela-frota .fr-topbar{padding:12px 24px;}
  .tela-frota .fr-resumo{padding:12px 24px;}
    /* `align-items:start` — O CONSERTO DO BURACO DE 250px (D7, 19/08/2026).
     Sem ele a grade nasce com `align-items:stretch`, e TODA a linha fica com a
     altura do cartão mais alto dela. Medido na tela no ar em 19/08: a primeira
     linha tinha um cartão de reserva (com destino, finalidade e rastro) ao lado
     de três posses de três linhas — e os três vizinhos viravam caixas brancas
     com ~250px de nada dentro. Era o que mais fazia a tela parecer montada no
     olho.

     Com `start`, cada cartão tem a altura do que ele diz. O espaço que sobra
     na linha vira FUNDO, não caixa vazia. */
  .tela-frota .fr-lista{padding:4px 24px 40px;display:grid;
    grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px;align-items:start;}

  /* O BOTÃO PARA DE ESTICAR NO COMPUTADOR (bronca do dono, 13/08/2026).
     `.fr-btn` nasce com `flex:1 1 auto` porque no celular o dedo quer a
     largura toda — e ali isso está certo, não se mexe. Mas dentro da grade do
     computador aquilo dava o efeito que ele viu: cartão com UM botão ficava
     com um botão de ponta a ponta, cartão com TRÊS ficava com três larguras
     diferentes, e a lista inteira parecia montada no olho.

     Aqui o botão passa a ter a largura do que ele diz, com um mínimo IGUAL
     pra todos — é o mínimo que dá a harmonia, e o conteúdo é quem cresce
     quando o rótulo é longo ("Passar, devolver ou recolher").

     132px, e não mais: a coluna da grade tem 320px, menos 32px de respiro do
     cartão sobram 288px. Dois botões de 132 com 8 de intervalo dão 272 e
     cabem na mesma linha; a 148 já não caberiam, e dois botões curtos
     quebrariam em duas linhas sem necessidade. Contado, não estimado. */
  .tela-frota .fr-lista .fr-acoes .fr-btn{flex:0 1 auto;min-width:132px;}
  /* No computador os botões do veículo ficam TODOS na mesma linha, com a mesma
     largura — pedido do dono. `grid-auto-flow:column` cria uma coluna por
     botão; `grid-auto-columns:1fr` deixa as colunas iguais.

     O `min-width:132px` da regra acima é de FLEX e não vale aqui, mas o
     `min-width:0` da regra base do veículo precisa continuar valendo: com 4
     botões numa coluna de 400px cada um fica com ~94px, e sem ele a grade
     estouraria pro lado em vez de o texto quebrar em duas linhas. */
  .tela-frota .fr-acoes-veiculo{grid-template-columns:none;
    grid-auto-flow:column;grid-auto-columns:1fr;}
  .tela-frota .fr-acoes-veiculo > :last-child:nth-child(odd){grid-column:auto;}

  /* MAS COM 4 OU MAIS, VOLTA PARA DOIS E DOIS — decisão do dono (20/08/2026),
     depois de ver a medição. Quatro botões lado a lado numa coluna da grade
     ficavam com 69px cada a 1440px, e "Passar, devolver ou recolher" quebrava
     em quatro linhas. Nada cortava e a altura era igual, mas era o caso feio.

     `:has(> :nth-child(4))` = "esta caixa tem um quarto filho". É contagem de
     BOTÃO, e não de largura: com 3 continua lado a lado, que é o que ele pediu.
     Uma regra por largura (`auto-fit`/`minmax`) também mandaria o caso de 3
     para duas linhas, e não é isso.

     `:has()` é suportado desde o Safari 15.4 (2022) — e se um navegador velho
     ignorar, ele cai no lado a lado de cima, que é o comportamento anterior:
     apertado, mas inteiro. Nunca quebrado. */
  .tela-frota .fr-acoes-veiculo:has(> :nth-child(4)){
    grid-auto-flow:row;grid-template-columns:1fr 1fr;}
  .tela-frota .fr-acoes-veiculo:has(> :nth-child(4)) > :last-child:nth-child(odd){
    grid-column:1 / -1;}
  /* ⚠️ ESTE `min-width:0` PRECISA DE 4 CLASSES, e é por isso que ele não fica
     junto da regra base lá em cima. A regra de flex do cartão comum
     (`.tela-frota .fr-lista .fr-acoes .fr-btn{min-width:132px}`) também tem 4
     classes e vem antes — com 3 classes a minha perdia no desempate e o 132px
     voltava a valer. Medido: com 3 botões dava 3×132 + 16 de intervalo = 412px
     numa caixa de 365px, e a grade ESTOURAVA pra fora do cartão. */
  .tela-frota .fr-lista .fr-acoes-veiculo .fr-btn{min-width:0;}
  .tela-frota .fr-checklist-editor{padding:4px 24px 40px;}
  /* A barra de chips ficava em 14px enquanto TODO o resto da tela ia pra 24px
     no computador — 10px de desalinho que já existia e que só aparece quando
     se olha as duas colunas de conteúdo juntas. Medido em 19/08. */
  .tela-frota .fr-filtros{padding:0 24px var(--sp-3);}
  .tela-frota .fr-filtros-campo{padding:0 24px;}
  .tela-frota .fr-dia-de-ficha{padding:0 24px;}
  .tela-frota .fr-fichas-limite{padding:0 24px 8px;}
  /* Ponteiro do mouse acerta 24px sem esforço — ver o comentário no fr-btn-ajuda. */
  /* O "?" e o "✕" dividem a linha do topo do modal, com 10px entre eles: no
     computador os dois encolhem JUNTOS e para o MESMO tamanho. Estavam em 24px
     e 34px lado a lado, e a diferença saltava à vista — foi a bronca do dono
     sobre botões de vários tamanhos. No celular os dois ficam em 40px, que é o
     alvo que o padrão exige. */
  .tela-frota .fr-btn-ajuda{width:34px;height:34px;font-size:max(9px, calc(13px * var(--escala-texto, 1)));}
  /* E o ✕ volta pra 34px aqui pelo mesmo motivo: no computador o ponteiro
     acerta 34px de sobra, e os dois em 40px ficariam quase encostados com só
     10px de gap entre eles. */
  .tela-frota .fr-fechar{width:34px;height:34px;}
}
</style>
