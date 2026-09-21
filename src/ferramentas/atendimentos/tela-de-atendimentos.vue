<template>
  <div class="tela-atendimentos">
    <barra-de-topo :voltar="ROTULO_DO_PAI[paiDaTela('atendimentos')]"
                   titulo="Vessel — Private Appointment"
                   :subtitulo="subtitulo" @voltar="voltar" />

    <div class="cv-largo atd-body">
      <faixa-de-erro :erro="erro" @tentar-de-novo="carregar" />

      <!-- ── O QUE ESTOU OLHANDO ─────────────────────────────────────────── -->
      <section class="atd-bloco">
        <h2 class="atd-etiqueta">O que estou olhando</h2>
        <div class="atd-filtros">
          <label class="atd-campo" for="atd-periodo"><span>Período</span>
            <select id="atd-periodo" v-model="periodo" @change="carregar">
              <option value="hoje">Hoje</option>
              <option value="semana">Esta semana (7 dias para trás e 7 para a frente)</option>
              <option value="proximos">Os próximos 30 dias</option>
              <option value="tudo">Últimos 30 dias e os próximos 30</option>
            </select></label>
          <label class="atd-campo" for="atd-loja"><span>Loja</span>
            <select id="atd-loja" v-model="loja">
              <option value="">Todas</option>
              <option value="iguatemi">Iguatemi Campinas</option>
              <option value="tivoli">Tivoli Santa Bárbara</option>
              <option value="parkshopping">ParkShopping Brasília</option>
            </select></label>
        </div>
      </section>

      <div v-if="carregando" class="atd-carregando">Carregando…</div>

      <template v-else-if="!erro">
        <!-- ── A FAIXA DE CIMA ───────────────────────────────────────────── -->
        <section class="atd-bloco">
          <h2 class="atd-etiqueta">Como está indo</h2>
          <div class="atd-numeros">
            <div class="atd-numero">
              <span class="atd-numero-valor">{{ resumo.naBase }}</span>
              <span class="atd-numero-rotulo">Com horário</span>
            </div>
            <div class="atd-numero">
              <span class="atd-numero-valor">{{ resumo.vieram }}</span>
              <span class="atd-numero-rotulo">Vieram</span>
            </div>
            <div class="atd-numero">
              <span class="atd-numero-valor">{{ resumo.naoVieram }}</span>
              <span class="atd-numero-rotulo">Não vieram</span>
            </div>
            <div class="atd-numero atd-numero-destaque">
              <span class="atd-numero-valor" :class="corDaTaxa">{{ taxaEscrita }}</span>
              <span class="atd-numero-rotulo">Taxa de comparecimento</span>
            </div>
          </div>
          <p class="atd-nota">
            A taxa é <b>quem veio ÷ quem tinha horário</b>. Quem só pediu horário
            e ainda não foi confirmado não entra na conta — pedido de horário não
            é horário reservado. A meta do plano é <b>75%</b>.
          </p>
        </section>

        <!-- ── A LISTA ───────────────────────────────────────────────────── -->
        <section class="atd-bloco">
          <h2 class="atd-etiqueta">Os atendimentos</h2>

          <p v-if="!linhas.length" class="atd-vazio">
            Nenhum atendimento neste período.
            <template v-if="loja">Experimente tirar o filtro de loja.</template>
          </p>

          <div v-for="grupo in grupos" :key="grupo.dia" class="atd-dia">
            <h3 class="atd-dia-titulo">{{ diaPorExtenso(grupo.dia) }}</h3>

            <article v-for="a in grupo.itens" :key="a.id" class="card-base atd-linha">
              <div class="atd-linha-quem">
                <span class="atd-nome">{{ a.pessoa?.nome || 'sem nome' }}</span>
                <a v-if="a.pessoa?.telefone" class="atd-fone"
                   :href="`https://wa.me/${soDigitos(a.pessoa.telefone)}`"
                   target="_blank" rel="noopener">{{ telefoneLegivel(a.pessoa.telefone) }}</a>
              </div>

              <div class="atd-linha-quando">
                <span class="atd-hora">{{ horaCurta(a.quando) || '—' }}</span>
                <span class="atd-detalhe">{{ nomeDaLoja(a.loja) }}</span>
                <span v-if="a.client_advisor" class="atd-detalhe">{{ a.client_advisor }}</span>
                <span v-if="a.teste" class="selo" :class="SELO_DE_ENSAIO">ensaio</span>
              </div>

              <div class="atd-linha-situacao">
                <span class="selo" :class="seloDaSituacao(a.status)">{{ rotuloDaSituacao(a.status) }}</span>
                <span v-if="compraDe(a).total > 0" class="atd-comprou">
                  comprou {{ dinheiro(compraDe(a).total) }}
                </span>
              </div>

              <!-- ⚠️ A LINHA NUNCA OFERECE O QUE ELA JÁ É. Um atendimento
                   marcado "Veio" mostrando um botão "Veio" é ruído; o que sobra
                   ("Não veio", "Remarcou") lê-se naturalmente como corrigir.
                   E não são três barras da largura do cartão: botão repetido em
                   toda linha de uma lista vira parede — foi o estrago do
                   "Excluir" vermelho em cada uma das quinze pessoas. -->
              <div v-if="podeMarcar" class="atd-linha-botoes">
                <template v-if="confirmandoCancelar === a.id">
                  <!-- ⚠️ O PASSO A MAIS. Cancelar tira a linha da taxa de
                       comparecimento — some da conta sem sumir da tela. O padrão
                       da casa proíbe botão de perigo repetido em toda linha de
                       uma lista; ele mora atrás desta pergunta. -->
                  <span class="atd-pergunta">Cancelar este atendimento?</span>
                  <button class="btn btn-perigo" type="button" :disabled="marcando === a.id"
                          @click="marcar(a, 'cancelado')">Sim, cancelar</button>
                  <button class="btn" type="button"
                          @click="confirmandoCancelar = null">Voltar</button>
                </template>
                <template v-else>
                  <button v-for="acao in marcacoesDe(a.status)" :key="acao.situacao"
                          class="btn" type="button" :disabled="marcando === a.id"
                          @click="marcar(a, acao.situacao)">{{ acao.rotulo }}</button>
                  <button v-if="podeCancelar(a.status)" class="atd-cancelar" type="button"
                          @click="confirmandoCancelar = a.id">Cancelar</button>
                </template>
              </div>
            </article>
          </div>

          <p v-if="erroAoMarcar" class="atd-erro-marcar" role="alert">{{ erroAoMarcar }}</p>
        </section>

        <!-- ── O QUE ESTA TELA NÃO RESPONDE ──────────────────────────────── -->
        <!-- ⚠️ ESTE BLOCO É CONTEÚDO, NÃO RODAPÉ. Sem ele, alguém soma a coluna
             "comprou" e chama de faturamento do canal — e a régua some. -->
        <section class="atd-bloco">
          <h2 class="atd-etiqueta">Como ler o "comprou"</h2>
          <p class="atd-nota">
            É o que <b>aquela cliente</b> comprou <b>do dia da visita até 7 dias
            depois</b>, em qualquer loja, pelo valor que <b>entrou no caixa</b>
            (itens já com desconto, menos o desconto do pedido). Não existe no
            sistema nenhum campo dizendo "esta compra veio daquela visita" — o
            que existe é a mesma pessoa comprando perto da data. Compra
            <b>antes</b> da visita nunca entra.
          </p>
          <p class="atd-nota">
            Esta tela <b>não</b> responde de que anúncio a cliente veio, quanto
            custou trazê-la, nem compara canais. Isso é outro trabalho (T09), e
            misturar os dois faria os dois números mentirem.
          </p>
        </section>
      </template>
    </div>
  </div>
</template>

<script setup>
/* VESSEL — ATENDIMENTOS: a lista dos private appointments, atrás de login.
 *
 * É a irmã de mesa da página do celular: o botão "Veio" daqui e o do aparelho
 * da Client Advisor gravam NA MESMA LINHA. O que muda é a porta — o celular
 * não tem login e se identifica pelo código do convite; aqui é gente logada com
 * a permissão `atendimentos`, e a função do banco CHECA essa permissão por
 * dentro (`vessel_situacao_do_atendimento`).
 *
 * ⚠️ LÊ COM O TOKEN DA SESSÃO, NUNCA COM A CHAVE ANÔNIMA. As tabelas têm RLS
 * com política só para `authenticated` — com a chave anônima o PostgREST
 * responde 200 com lista VAZIA, sem erro nenhum, e a tela diria "nenhum
 * atendimento" para uma agenda cheia. É o estrago registrado no item 9 do
 * PADRAO-DA-CENTRAL.
 */
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import BarraDeTopo from '../../compartilhado/barra-de-topo.vue'
import FaixaDeErro from '../../compartilhado/faixa-de-erro.vue'
import { estado, hasPermission } from '../../compartilhado/controle-de-login-e-usuario.js'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../compartilhado/conectar-no-banco-de-dados.js'
import { classificarErro, ERRO_DE_REDE } from '../../compartilhado/classificar-erro.js'
import {
  SITUACOES, SELO_DE_ENSAIO, resumoDosAtendimentos, comprasDaVisita, porDia,
  janelaDoPeriodo, horaCurta, telefoneLegivel, marcacoesDe, podeCancelar,
} from './contas-de-atendimento.js'
import { paiDaTela, ROTULO_DO_PAI } from '../comercial-vessel/navegacao.js'

const router = useRouter()
function voltar() { router.push({ name: paiDaTela('atendimentos') }) }

const LOJAS = {
  iguatemi: 'Iguatemi Campinas',
  tivoli: 'Tivoli Santa Bárbara',
  parkshopping: 'ParkShopping Brasília',
}

const periodo = ref('semana')
const loja = ref('')
const atendimentos = ref([])
const pedidos = ref([])
const carregando = ref(true)
const erro = ref(null)
const marcando = ref(null)
const erroAoMarcar = ref('')
// Qual linha está com a pergunta de cancelar aberta. Uma de cada vez.
const confirmandoCancelar = ref(null)

const podeMarcar = computed(() => hasPermission('atendimentos', 'editar'))

const linhas = computed(() => loja.value
  ? atendimentos.value.filter((a) => a.loja === loja.value)
  : atendimentos.value)
const grupos = computed(() => porDia(linhas.value))
const resumo = computed(() => resumoDosAtendimentos(linhas.value))

const taxaEscrita = computed(() => resumo.value.taxa === null
  // ⚠️ "—" e não "0%": zero por cento é um fato; "ainda não dá para dizer" é
  // outro. Ver o teste em contas-de-atendimento.test.mjs.
  ? '—'
  : `${Math.round(resumo.value.taxa * 100)}%`)
const corDaTaxa = computed(() => {
  if (resumo.value.taxa === null) return 'atd-neutro'
  return resumo.value.taxa >= 0.75 ? 'atd-bom' : 'atd-atencao'
})
const subtitulo = computed(() => {
  const n = linhas.value.length
  if (carregando.value) return ''
  return `${n} ${n === 1 ? 'atendimento' : 'atendimentos'}${loja.value ? ' · ' + LOJAS[loja.value] : ''}`
})

const nomeDaLoja = (k) => LOJAS[k] || k || '—'
const rotuloDaSituacao = (s) => SITUACOES[s]?.rotulo || s
const seloDaSituacao = (s) => SITUACOES[s]?.selo || 'selo-neutro'
const soDigitos = (t) => String(t || '').replace(/\D/g, '')
const dinheiro = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const compraDe = (a) => comprasDaVisita(a, pedidos.value)

function diaPorExtenso(dia) {
  if (!dia || dia === 'sem-data') return 'Sem data marcada'
  const [a, m, d] = dia.split('-').map(Number)
  const data = new Date(a, m - 1, d)
  const hoje = new Date()
  const mesmoDia = (x, y) => x.toDateString() === y.toDateString()
  const amanha = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + 1)
  const prefixo = mesmoDia(data, hoje) ? 'Hoje · ' : (mesmoDia(data, amanha) ? 'Amanhã · ' : '')
  return prefixo + data.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })
}

/** O cabeçalho de toda leitura: a chave pública identifica o projeto, o token
 *  da sessão diz QUEM está perguntando — e é ele que a RLS lê. */
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
  erroAoMarcar.value = ''
  confirmandoCancelar.value = null
  try {
    // ⚠️ SEM SESSÃO NÃO SE TENTA LER. Com a chave anônima a resposta é 200 com
    // lista vazia — a tela diria "nenhum atendimento" em vez de "faça login de
    // novo", que é a verdade.
    if (!estado.currentSession?.access_token) {
      erro.value = { tipo: 'sem-sessao', acao: null,
        mensagem: 'Sua sessão expirou. Recarregue a página e entre de novo.' }
      return
    }

    const { de, ate } = janelaDoPeriodo(periodo.value)
    // A janela é pelo dia marcado; quem ainda não tem dia entra pela data em
    // que o cartão foi feito — senão some da tela quem mais precisa de atenção.
    const filtro = `or=(and(quando.gte.${de}T00:00:00,quando.lte.${ate}T23:59:59),`
      + `and(quando.is.null,criado_em.gte.${de}T00:00:00,criado_em.lte.${ate}T23:59:59))`
    const campos = 'id,pessoa_id,loja,client_advisor,quando,status,convite_codigo,'
      + 'presenca_em,teste,criado_em,pessoa:vessel_pessoas(id,nome,telefone)'

    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/vessel_atendimentos?select=${campos}&${filtro}&order=quando.desc.nullslast&limit=500`,
      { headers: cabecalho() })
    const corpo = await r.json().catch(() => null)
    if (!r.ok || !Array.isArray(corpo)) { erro.value = classificarErro(r.status, corpo); return }
    atendimentos.value = corpo

    await carregarCompras(corpo, de, ate)
  } catch {
    erro.value = ERRO_DE_REDE
  } finally {
    carregando.value = false
  }
}

/** As compras das pessoas que aparecem na lista, na janela + 7 dias. */
async function carregarCompras(lista, de, ate) {
  const ids = [...new Set(lista.map((a) => a.pessoa_id).filter(Boolean))]
  pedidos.value = []
  if (!ids.length) return
  const [a, m, d] = ate.split('-').map(Number)
  const limite = new Date(a, m - 1, d + 7)
  const ateMais = `${limite.getFullYear()}-${String(limite.getMonth() + 1).padStart(2, '0')}-${String(limite.getDate()).padStart(2, '0')}`
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/vessel_pedidos?select=pessoa_id,numero,data_da_venda,data_do_pedido,receita_liquida,total_corrigido`
      + `&pessoa_id=in.(${ids.join(',')})&data_do_pedido=gte.${de}&data_do_pedido=lte.${ateMais}&limit=1000`,
    { headers: cabecalho() })
  // ⚠️ FALHAR AQUI NÃO DERRUBA A LISTA. A agenda é o assunto da tela; o
  // "comprou" é um acréscimo. Mas também não some calado: sem pedidos lidos, a
  // coluna simplesmente não aparece — ela nunca mostra R$ 0 como se fosse fato.
  if (r.ok) {
    const corpo = await r.json().catch(() => null)
    if (Array.isArray(corpo)) pedidos.value = corpo
  }
}

/**
 * Marca a situação. Quem decide se pode é o BANCO — a função checa a permissão
 * por dentro. O `podeMarcar` daqui só esconde um botão que não funcionaria.
 *
 * ⚠️ A LINHA SÓ MUDA NA TELA DEPOIS QUE O BANCO CONFIRMA. Pintar antes e
 * desfazer depois é o defeito mais caro de perceber: a pessoa vê "Veio",
 * fecha a tela, e o dado nunca foi gravado.
 */
async function marcar(atendimento, situacao) {
  marcando.value = atendimento.id
  erroAoMarcar.value = ''
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/vessel_situacao_do_atendimento`, {
      method: 'POST',
      headers: cabecalho(),
      body: JSON.stringify({ p_id: atendimento.id, p_situacao: situacao }),
    })
    const resposta = r.ok ? await r.json().catch(() => null) : null
    if (!resposta?.ok) {
      erroAoMarcar.value = resposta?.situacao === 'sem_permissao'
        ? 'Você não tem permissão para marcar presença. Fale com quem cuida dos acessos.'
        : `Não consegui gravar agora${r.ok ? '' : ` (o banco respondeu ${r.status})`}. Tente de novo em um instante.`
      return
    }
    atendimento.status = situacao
    if (situacao !== 'realizado') atendimento.presenca_em = null
    confirmandoCancelar.value = null
  } catch {
    erroAoMarcar.value = 'Não consegui falar com o servidor. Confira a conexão e tente de novo.'
  } finally {
    marcando.value = null
  }
}

onMounted(() => {
  if (!hasPermission('atendimentos', 'ver')) { router.push({ name: 'inicio' }); return }
  carregar()
})
</script>

<style scoped>
@import '../comercial-vessel/estilo-comercial.css';
.tela-atendimentos{min-height:100vh;}
.atd-body{padding-block:var(--sp-5);display:flex;flex-direction:column;gap:var(--sp-5);}
.atd-carregando{color:var(--muted);font-family:var(--fonte-principal);font-size:var(--texto-corpo);padding:var(--sp-5) 0;}

.atd-bloco{display:flex;flex-direction:column;gap:var(--sp-3);}
.atd-etiqueta{margin:0;font-family:var(--fonte-principal);font-size:var(--texto-etiqueta);
  letter-spacing:1.5px;text-transform:uppercase;color:var(--muted);font-weight:600;}

.atd-filtros{display:flex;flex-wrap:wrap;gap:var(--sp-3);}
.atd-campo{display:flex;flex-direction:column;gap:6px;flex:1 1 240px;min-width:0;}
.atd-campo span{font-family:var(--fonte-principal);font-size:var(--texto-etiqueta);
  letter-spacing:1.5px;text-transform:uppercase;color:var(--muted);}
.atd-campo select{width:100%;min-height:40px;padding:0 var(--sp-2);
  font-family:var(--fonte-principal);font-size:var(--texto-campo);
  color:var(--text);background:var(--surface);border:1px solid var(--border);
  border-radius:var(--radius-md);}

.atd-numeros{display:flex;flex-wrap:wrap;gap:var(--sp-3);}
.atd-numero{flex:1 1 150px;min-width:0;display:flex;flex-direction:column;gap:4px;
  padding:var(--sp-3) var(--card-pad);background:var(--surface);
  border:1px solid var(--border);border-radius:var(--card-radius);}
.atd-numero-destaque{background:var(--surface2);}
.atd-numero-valor{font-family:var(--fonte-principal);font-size:var(--texto-numero);
  font-weight:600;color:var(--text);font-variant-numeric:tabular-nums;line-height:1.1;}
/* ⚠️ `break-word`, NUNCA `anywhere`, num rótulo: medido a 375px, o `anywhere`
   partiu "COMPARECIMENTO" no meio e imprimiu "COMPARECIMENT / O". `anywhere`
   é para NOME de gente, que pode não caber de jeito nenhum; rótulo só quebra
   quando a palavra inteira não cabe. */
.atd-numero-rotulo{font-family:var(--fonte-principal);font-size:var(--texto-etiqueta);
  letter-spacing:1.5px;text-transform:uppercase;color:var(--muted);overflow-wrap:break-word;}
.atd-bom{color:var(--green);}
.atd-atencao{color:var(--orange);}
.atd-neutro{color:var(--muted);}

.atd-nota{margin:0;font-family:var(--fonte-principal);font-size:var(--texto-corpo);
  color:var(--muted);line-height:1.6;}
.atd-vazio{margin:0;font-family:var(--fonte-principal);font-size:var(--texto-campo);color:var(--muted);}

.atd-dia{display:flex;flex-direction:column;gap:var(--sp-2);margin-top:var(--sp-3);}
.atd-dia-titulo{margin:0;font-family:var(--fonte-principal);font-size:var(--texto-corpo);
  font-weight:600;color:var(--text);text-transform:capitalize;overflow-wrap:anywhere;}

.atd-linha{display:flex;flex-wrap:wrap;align-items:center;gap:var(--sp-2) var(--sp-4);}
.atd-linha-quem{display:flex;flex-direction:column;gap:2px;flex:1 1 220px;min-width:0;}
/* ⚠️ `overflow-wrap:anywhere` e NUNCA reticências: o dono não distingue duas
   pessoas se as duas viram "Maria Eduarda C…". */
.atd-nome{font-family:var(--fonte-principal);font-size:var(--texto-campo);
  font-weight:600;color:var(--text);overflow-wrap:anywhere;}
.atd-fone{font-family:var(--fonte-principal);font-size:var(--texto-corpo);
  color:var(--accent);text-decoration:none;overflow-wrap:anywhere;}
.atd-fone:hover{text-decoration:underline;}

.atd-linha-quando{display:flex;flex-wrap:wrap;align-items:center;gap:var(--sp-2);flex:1 1 200px;min-width:0;}
.atd-hora{font-family:var(--fonte-principal);font-size:var(--texto-titulo);
  font-weight:600;color:var(--text);font-variant-numeric:tabular-nums;}
.atd-detalhe{font-family:var(--fonte-principal);font-size:var(--texto-corpo);
  color:var(--muted);overflow-wrap:anywhere;}

.atd-linha-situacao{display:flex;flex-wrap:wrap;align-items:center;gap:var(--sp-2);flex:0 1 auto;}
.atd-comprou{font-family:var(--fonte-principal);font-size:var(--texto-corpo);
  font-weight:600;color:var(--green);font-variant-numeric:tabular-nums;}

.atd-linha-botoes{display:flex;flex-wrap:wrap;gap:var(--sp-2);flex:0 0 auto;margin-left:auto;}
.atd-linha-botoes .btn{flex:0 0 auto;}

/* ⚠️ "Cancelar" NÃO é um quarto botão igual aos três. Ele é texto sublinhado,
   discreto, e abre a pergunta — é o "passo a mais" que o padrão da casa exige
   para ação difícil de desfazer dentro de uma lista. A ÁREA do dedo tem 40px
   sem o desenho engordar. */
.atd-cancelar{display:inline-flex;align-items:center;min-height:40px;padding:0 var(--sp-2);
  background:none;border:none;color:var(--muted);cursor:pointer;
  font-family:var(--fonte-principal);font-size:var(--texto-corpo);text-decoration:underline;
  text-underline-offset:3px;}
.atd-cancelar:hover,.atd-cancelar:focus-visible{color:var(--red);}
.atd-pergunta{display:inline-flex;align-items:center;font-family:var(--fonte-principal);
  font-size:var(--texto-corpo);color:var(--text);font-weight:600;}

.atd-erro-marcar{margin:var(--sp-2) 0 0;font-family:var(--fonte-principal);
  font-size:var(--texto-corpo);color:var(--red);}

@media (max-width:640px){
  .atd-linha{flex-direction:column;align-items:stretch;}
  .atd-linha-quem,.atd-linha-quando,.atd-linha-situacao{flex:1 1 auto;}
  /* ⚠️ 40px DE ALVO PARA O DEDO no link do WhatsApp — medido a 375px, ele
     tinha 18px. Aqui a altura cresce no PRÓPRIO link (inline-flex + min-height)
     e não num `::after` esticado: o pseudo cobriria o nome da cliente, que fica
     logo acima na mesma coluna, e deixaria o nome inalcançável. */
  .atd-fone{display:inline-flex;align-items:center;min-height:40px;}
  /* ⚠️ No computador os botões moram encostados na direita (`margin-left:auto`).
     No celular a linha vira coluna, e ali "encostado na direita" só produziu
     dois botões soltos no canto, com um buraco à esquerda. Aqui eles voltam a
     ocupar a largura do cartão — medido a 375px. */
  .atd-linha-botoes{flex:1 1 100%;margin-left:0;}
  .atd-linha-botoes .btn{flex:1 1 90px;}
  /* A taxa é o número que a loja persegue: no celular ela fica com a linha
     inteira, e o rótulo para de espremer. */
  .atd-numero-destaque{flex:1 1 100%;}
}
</style>
