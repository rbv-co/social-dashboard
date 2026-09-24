<template>
  <div class="tela-material-grafico id-ferramenta">
    <barra-de-topo :voltar="ROTULO_DO_PAI[paiDaTela('material-grafico')]"
                   titulo="Vessel — Material Gráfico"
                   :subtitulo="subtitulo" @voltar="voltar" />

    <div class="cv-largo mg-body">
      <!-- ── COMO USAR ─────────────────────────────────────────────────── -->
      <section class="cv-bloco id-bloco-leitura">
        <h2 class="cv-etiqueta id-titulo"><icone-do-bloco nome="leitura" />Como usar estes QR</h2>
        <p class="cv-nota cv-nota-primeira">
          Cada QR sai <b>sem fundo</b> (o quadriculado da prévia é o transparente)
          e na tinta da marca. O <b>PNG</b> tem 2048 px de lado, para Canva e
          Photoshop; o <b>SVG</b> é vetor, para a gráfica ampliar sem perder nitidez.
          O nome do arquivo já segue a regra do plano:
          <code class="cv-codigo">VESSEL_programa_praça_data_qr_v01</code>.
        </p>
        <p class="cv-nota">
          Os QR são lidos de volta por um leitor de QR antes de cada entrega do
          sistema — mesmo assim, <b>leia com o celular a prova impressa</b> antes
          de mandar rodar a tiragem.
        </p>
      </section>

      <!-- ── BUSCAR E FILTRAR ──────────────────────────────────────────────
           ⚠️ A busca é sobre o que já voltou do banco. Só o filtro de
           encerrados volta ao banco: as funções de conta chegam SEM as
           arquivadas/desativadas, e filtrar na tela não as faria aparecer. -->
      <div class="mg-barra">
        <label class="mg-campo" for="mg-busca">
          <span class="cv-etiqueta id-subtitulo">Buscar</span>
          <input id="mg-busca" type="search" v-model="busca"
                 placeholder="nome, código, salão, anfitriã, cidade">
        </label>
        <label class="mg-marcar" for="mg-todos">
          <input id="mg-todos" type="checkbox" v-model="mostrarEncerrados">
          <span>Mostrar também encerrados e desativadas</span>
        </label>
      </div>

      <!-- ── UM BLOCO POR AÇÃO, NA COR DELA ─────────────────────────────── -->
      <section v-for="a in ACOES" :key="a.chave" class="cv-bloco mg-acao id-grupo"
               :class="`mg-acao-${a.chave}`" :aria-labelledby="`mg-titulo-${a.chave}`">
        <h2 :id="`mg-titulo-${a.chave}`" class="mg-acao-titulo id-titulo">
          <icone-do-bloco :nome="a.icone" />{{ a.titulo }}
          <span v-if="!grupos[a.chave].carregando && !grupos[a.chave].erro" class="mg-contagem">
            {{ naTela[a.chave].length }}</span>
        </h2>
        <p class="cv-nota cv-nota-primeira">{{ a.porItem }}.</p>

        <!-- ⚠️ ERRO NÃO VIRA LISTA VAZIA (item 9 do padrão): cada ação tem a
             própria leitura, e a falha de uma não apaga as outras duas. -->
        <faixa-de-erro :erro="grupos[a.chave].erro" @tentar-de-novo="carregarAcao(a.chave)" />
        <p v-if="grupos[a.chave].carregando" class="mg-vazio">Carregando…</p>
        <p v-else-if="!grupos[a.chave].erro && !naTela[a.chave].length" class="mg-vazio">
          {{ fraseDoVazio(a.chave, { total: grupos[a.chave].itens.length, busca, mostrarEncerrados }) }}
        </p>

        <ul v-else-if="!grupos[a.chave].erro" class="mg-itens">
          <li v-for="item in naTela[a.chave]" :key="item.chave" class="mg-item id-cartao">
            <div class="cv-cabeca">
              <div class="cv-cabeca-texto">
                <span class="mg-item-acao">{{ a.titulo }}</span>
                <h3 class="mg-item-titulo">{{ item.titulo }}</h3>
                <p class="cv-sub">
                  <span v-for="l in item.linhas" :key="l">{{ l }} · </span>
                  <span class="cv-codigo">{{ item.codigo }}</span>
                </p>
              </div>
              <span class="cv-selo id-selo" :class="`id-tom-${item.situacao.tom}`">{{ item.situacao.texto }}</span>
            </div>
            <qr-para-baixar class="mg-qr" :endereco="item.endereco" :legenda="item.legenda"
                            :arquivo="item.arquivo" :motivo-sem-endereco="item.motivoSemQr" />
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>

<script setup>
/* VESSEL — MATERIAL GRÁFICO: os QR Codes de cada ação do Growth Plan, sem fundo,
 * em PNG e SVG, prontos para a gráfica (pedido do dono, 23/09/2026).
 *
 * ⚠️ SÓ LEITURA. As três leituras são as MESMAS funções de conta que as telas
 * irmãs usam, com o token da sessão (nunca a chave anônima: o PostgREST
 * responderia 200 com lista VAZIA, e a tela diria "nenhuma sessão" para uma
 * agenda cheia). Nenhuma escrita sai daqui.
 *
 * ⚠️ O QR NASCE NO NAVEGADOR, pelo codificador portado do site
 * (`src/compartilhado/qr.js`), e a leitura dele de volta está provada em
 * `qr.test.mjs` com um leitor independente (zxing). As regras de cada item
 * (título, arquivo, ativo) moram em `material-grafico-regras.js`, testadas. */
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import BarraDeTopo from '../../compartilhado/barra-de-topo.vue'
import FaixaDeErro from '../../compartilhado/faixa-de-erro.vue'
import IconeDoBloco from '../../compartilhado/icone-do-bloco.vue'
import QrParaBaixar from './qr-para-baixar.vue'
import { estado } from '../../compartilhado/controle-de-login-e-usuario.js'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../compartilhado/conectar-no-banco-de-dados.js'
import { classificarErro, ERRO_DE_REDE } from '../../compartilhado/classificar-erro.js'
import { ACOES, itensDaAcao, filtrarItens, fraseDoVazio } from './material-grafico-regras.js'
import { paiDaTela, ROTULO_DO_PAI } from './navegacao.js'

const router = useRouter()
const route = useRoute()
function voltar() { router.push({ name: paiDaTela('material-grafico') }) }

// A janela de atribuição de venda das funções de conta — aqui não mostramos
// venda nenhuma, mas a função pede; é o mesmo valor das telas irmãs.
const P_DIAS = 7

// ⚠️ Vindo da Beauty Sessions ("ver no Material Gráfico"), a busca já chega
// com o código da sessão.
const busca = ref(typeof route.query.busca === 'string' ? route.query.busca : '')
const mostrarEncerrados = ref(route.query.todos === '1')

/* Cada ação lê sozinha: { carregando, erro, itens }. */
/* ⚠️ `pedido` conta as leituras: marcar e desmarcar o filtro depressa dispara
 * duas, e a resposta VELHA pode chegar depois da nova — só a última escreve. */
const grupos = reactive(Object.fromEntries(ACOES.map((a) => [a.chave, { carregando: true, erro: null, itens: [], pedido: 0 }])))

const naTela = computed(() => Object.fromEntries(ACOES.map((a) => [a.chave,
  filtrarItens(grupos[a.chave].itens, { busca: busca.value, mostrarEncerrados: mostrarEncerrados.value })])))

const subtitulo = computed(() => {
  if (ACOES.some((a) => grupos[a.chave].carregando)) return ''
  const n = ACOES.reduce((s, a) => s + naTela.value[a.chave].length, 0)
  return `${n} QR na tela`
})

function cabecalho() {
  const token = estado.currentSession?.access_token
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${token || SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
  }
}

async function chamar(funcao, corpo) {
  let r
  try {
    r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${funcao}`, {
      method: 'POST', headers: cabecalho(), body: JSON.stringify(corpo || {}),
    })
  } catch {
    throw { classificado: ERRO_DE_REDE }
  }
  if (!r.ok) {
    const corpoDoErro = await r.json().catch(() => null)
    throw { classificado: classificarErro(r.status, corpoDoErro) }
  }
  return r.json()
}

/* A função de cada ação e o que ela recebe. ⚠️ Arquivada/desativada só vem
 * quando pedida — as três nascem com `false`. */
function pedidoDa(chave) {
  const todos = mostrarEncerrados.value
  if (chave === 'beauty-session') {
    return ['vessel_conta_das_beauty_sessions', { p_dias: P_DIAS, p_incluir_arquivadas: todos }]
  }
  if (chave === 'private-edit') {
    return ['vessel_conta_das_private_edits', { p_dias: P_DIAS, p_incluir_arquivadas: todos }]
  }
  return ['vessel_rastreio_dos_stylists', { p_dias: P_DIAS, p_incluir_desativadas: todos }]
}

async function carregarAcao(chave) {
  const g = grupos[chave]
  const n = ++g.pedido
  g.carregando = true
  g.erro = null
  try {
    // ⚠️ SEM SESSÃO NÃO SE TENTA LER: a resposta seria 200 com lista vazia.
    if (!estado.currentSession?.access_token) {
      g.erro = { tipo: 'sem-sessao', acao: null, mensagem: 'Sua sessão expirou. Recarregue a página e entre de novo.' }
      g.itens = []
      return
    }
    const [funcao, corpo] = pedidoDa(chave)
    const linhas = await chamar(funcao, corpo)
    if (n !== g.pedido) return            // chegou uma leitura mais nova: esta é descartada
    g.itens = itensDaAcao(chave, linhas)
  } catch (e) {
    if (n !== g.pedido) return
    g.itens = []
    g.erro = e?.classificado || { tipo: 'servidor', mensagem: 'Não consegui ler agora. Tente de novo.', acao: 'tentar' }
  } finally {
    if (n === g.pedido) g.carregando = false
  }
}

function carregarTudo() { for (const a of ACOES) carregarAcao(a.chave) }

// ⚠️ O ÚNICO GATILHO DE VOLTAR AO BANCO é o filtro de encerrados — a busca
// filtra o que já está em memória (uma chamada por tecla seria desperdício).
watch(mostrarEncerrados, carregarTudo)

onMounted(carregarTudo)
// ⚠️ VOLTOU PARA A ABA, LÊ DE NOVO (25/09/2026): o dono apagou sessões na tela
// Beauty Sessions, voltou para cá e ainda via os QR delas — a lista era a do
// momento em que esta tela abriu. Agora, ao voltar a ficar visível, recarrega.
function aoVoltar() { if (document.visibilityState === 'visible') carregarTudo() }
onMounted(() => document.addEventListener('visibilitychange', aoVoltar))
onBeforeUnmount(() => document.removeEventListener('visibilitychange', aoVoltar))
</script>

<style scoped>
@import './estilo-comercial.css';
@import '../../estilos/identidade-da-ferramenta.css';
.mg-body { padding-bottom: var(--sp-6); }

/* ── a barra ───────────────────────────────────────────────────────────── */
.mg-barra {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-3);
  align-items: flex-end;
  margin-top: var(--sp-3);
  padding: var(--sp-3);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}
.mg-campo { display: flex; flex-direction: column; gap: 4px; flex: 1 1 16rem; min-width: 0; }
.mg-campo input {
  width: 100%;
  font-family: var(--fonte-principal);
  font-size: var(--texto-campo);
  color: var(--text);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  min-height: 40px;
}
.mg-marcar {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-height: 40px;
  font-family: var(--fonte-principal);
  font-size: var(--texto-corpo);
  color: var(--text);
  cursor: pointer;
}
.mg-marcar input { width: 20px; height: 20px; flex: 0 0 20px; accent-color: var(--modulo); }

/* ── as três ações: a cor DE CADA UMA no filete, no ícone e no título ───── */
.mg-acao-beauty-session { --tom: var(--cor-beauty-sessions); --cor-da-acao: var(--cor-beauty-sessions); }
.mg-acao-private-edit { --tom: var(--cor-private-edit); --cor-da-acao: var(--cor-private-edit); }
.mg-acao-stylist-circle { --tom: var(--cor-stylist-circle); --cor-da-acao: var(--cor-stylist-circle); }
.mg-acao { margin-top: var(--sp-4); }
.mg-acao-titulo {
  font-family: var(--fonte-principal);
  font-size: var(--texto-titulo);
  margin: 0 0 var(--sp-2);
  overflow-wrap: anywhere;
}
.mg-acao-titulo .id-icone { width: 20px; height: 20px; flex-basis: 20px; }
.mg-contagem {
  font-family: var(--fonte-dados);
  font-size: var(--texto-corpo);
  color: var(--muted);
  font-weight: 400;
}

.mg-itens {
  list-style: none;
  margin: var(--sp-3) 0 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 34rem), 1fr));
  gap: var(--sp-3);
}
/* O filete do cartão é a cor da AÇÃO (herdada do grupo), não da situação:
   é ele que diz de relance "este QR é da Beauty". A situação é o selo. */
.mg-item {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: var(--sp-4);
  min-width: 0;
}
.mg-item-acao {
  font-family: var(--fonte-principal);
  font-size: var(--texto-etiqueta);
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--tom);
  font-weight: 600;
}
.mg-item-titulo {
  font-family: var(--fonte-principal);
  font-size: var(--texto-campo);
  color: var(--text);
  margin: 2px 0 0;
  overflow-wrap: anywhere;
}
.mg-qr { margin-top: var(--sp-3); }
/* o código é lido e ditado inteiro: não parte no meio */
.mg-item .cv-codigo { white-space: nowrap; }

.mg-vazio {
  font-family: var(--fonte-principal);
  font-size: var(--texto-corpo);
  color: var(--muted);
  padding: var(--sp-4) 0 var(--sp-2);
}
</style>
