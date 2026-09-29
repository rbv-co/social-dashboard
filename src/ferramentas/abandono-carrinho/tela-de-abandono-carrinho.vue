<template>
  <div class="ac-tela id-ferramenta">
    <barra-de-topo :voltar="ROTULO_DO_PAI[paiDaTela('abandono-carrinho')]" titulo="Checkouts Abandonados" @voltar="voltar" />

    <div class="ac-body">
      <div class="ac-barra">
        <p class="ac-regra">
          Quem informou e-mail ou telefone no checkout e ficou {{ MINUTOS_ATE_ABANDONO }} minutos sem mexer
          e sem comprar vai para a fila de envio.
        </p>
        <button class="btn" :disabled="carregando" @click="carregar">Atualizar</button>
      </div>

      <p v-if="erro" class="ac-erro" role="alert">Não consegui carregar os dados: {{ erro }}</p>
      <p v-if="cortado" class="ac-aviso">Mostrando só os {{ LIMITE_ABANDONO }} mais recentes; a lista pode estar cortada.</p>

      <div class="ac-grade">
        <section class="ac-cartao card-base">
          <h2 class="ac-titulo-secao id-titulo">
            <icone-do-bloco nome="carrinho-mais" />Aguardando
            <span class="ac-contagem-total">{{ colunas.aguardando.length }}</span>
          </h2>
          <p v-if="carregando" class="ac-carregando">Carregando…</p>
          <p v-else-if="!erro && !colunas.aguardando.length" class="ac-vazio">Nenhum checkout esperando agora.</p>
          <ul v-else class="ac-lista">
            <li v-for="c in colunas.aguardando" :key="c.token" class="ac-item">
              <div class="ac-linha">
                <span class="ac-quem">{{ c.nome || 'Sem nome' }}</span>
                <span class="ac-tempo">{{ formatarContagem(segundosRestantes(c.ultimo_evento_em, agora)) }}</span>
              </div>
              <span class="ac-detalhe">{{ contato(c) }}</span>
              <span class="ac-detalhe">{{ dinheiro(c) }} · último evento {{ hora(c.ultimo_evento_em) }}</span>
              <div class="ac-trilho"><div class="ac-preenchido" :style="{ width: percentualDoPrazo(c.ultimo_evento_em, agora) + '%' }"></div></div>
            </li>
          </ul>
        </section>

        <section class="ac-cartao card-base">
          <h2 class="ac-titulo-secao id-titulo">
            <icone-do-bloco nome="carrinho-mais" />Pagamento pendente
            <span class="ac-contagem-total">{{ colunas.pagamentoPendente.length }}</span>
          </h2>
          <p class="ac-detalhe">Pix ou boleto gerado e ainda não pago. Não recebe mensagem enquanto espera.</p>
          <p v-if="carregando" class="ac-carregando">Carregando…</p>
          <p v-else-if="!erro && !colunas.pagamentoPendente.length" class="ac-vazio">Nenhum pagamento pendente.</p>
          <ul v-else class="ac-lista">
            <li v-for="c in colunas.pagamentoPendente" :key="c.token" class="ac-item">
              <div class="ac-linha">
                <span class="ac-quem">{{ c.nome || 'Sem nome' }}</span>
                <span class="ac-tempo">{{ hora(c.pedido_criado_em) }}</span>
              </div>
              <span class="ac-detalhe">{{ contato(c) }}</span>
              <span class="ac-detalhe">{{ dinheiro(c) }}</span>
              <span class="selo selo-atencao">aguardando pagamento</span>
            </li>
          </ul>
        </section>

        <section class="ac-cartao card-base">
          <h2 class="ac-titulo-secao id-titulo">
            <icone-do-bloco nome="carrinho-mais" />Fila de envio
            <span class="ac-contagem-total">{{ colunas.filaEnvio.length }}</span>
          </h2>
          <p v-if="carregando" class="ac-carregando">Carregando…</p>
          <p v-else-if="!erro && !colunas.filaEnvio.length" class="ac-vazio">Ninguém na fila de envio.</p>
          <ul v-else class="ac-lista">
            <li v-for="c in colunas.filaEnvio" :key="c.token" class="ac-item">
              <div class="ac-linha">
                <span class="ac-quem">{{ c.nome || 'Sem nome' }}</span>
                <span class="ac-tempo">{{ hora(c.fila_envio_em) }}</span>
              </div>
              <span class="ac-detalhe">{{ contato(c) }}</span>
              <span class="ac-detalhe">{{ dinheiro(c) }}</span>
              <span v-if="c.comprou_depois" class="selo selo-atencao">comprou depois</span>
            </li>
          </ul>
        </section>

        <section class="ac-cartao card-base">
          <h2 class="ac-titulo-secao id-titulo">
            <icone-do-bloco nome="carrinho-mais" />Compraram
            <span class="ac-contagem-total">{{ colunas.compraram.length }}</span>
          </h2>
          <p v-if="carregando" class="ac-carregando">Carregando…</p>
          <p v-else-if="!erro && !colunas.compraram.length" class="ac-vazio">Ninguém comprou depois de entrar aqui.</p>
          <ul v-else class="ac-lista">
            <li v-for="c in colunas.compraram" :key="c.token" class="ac-item">
              <div class="ac-linha">
                <span class="ac-quem">{{ c.nome || 'Sem nome' }}</span>
                <span class="ac-tempo">{{ hora(c.comprou_em) }}</span>
              </div>
              <span class="ac-detalhe">{{ contato(c) }}</span>
              <span class="ac-detalhe">{{ dinheiro(c) }}</span>
              <span class="selo selo-ok">{{ c.comprou_depois ? 'comprou depois de ir para a fila' : 'comprou antes do prazo' }}</span>
            </li>
          </ul>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import BarraDeTopo from '../../compartilhado/barra-de-topo.vue'
import IconeDoBloco from '../../compartilhado/icone-do-bloco.vue'
import { sbClient } from '../../compartilhado/conectar-no-banco-de-dados.js'
import { diasAtras } from '../../compartilhado/datas.js'
import { paiDaTela, ROTULO_DO_PAI } from '../comercial-vessel/navegacao.js'
import {
  MINUTOS_ATE_ABANDONO, LIMITE_ABANDONO, segundosRestantes, percentualDoPrazo,
  formatarContagem, separarPorStatus, foiCortado,
} from './regras-do-abandono.js'

const router = useRouter()
const voltar = () => router.push({ name: paiDaTela('abandono-carrinho') })

const vazio = () => ({ aguardando: [], pagamentoPendente: [], filaEnvio: [], compraram: [] })
const carregando = ref(true)
const erro = ref(null)
const cortado = ref(false)
const colunas = ref(vazio())
const agora = ref(Date.now())

const hora = (iso) => (iso
  ? new Date(iso).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' })
  : '—')
const contato = (c) => [c.email, c.telefone].filter(Boolean).join(' · ') || 'Sem contato'
const dinheiro = (c) => (c.total == null
  ? 'Sem valor'
  : Number(c.total).toLocaleString('pt-BR', { style: 'currency', currency: c.moeda || 'BRL' }))

async function carregar() {
  carregando.value = true
  erro.value = null
  const desde = diasAtras(7) + 'T00:00:00-03:00'
  const { data, error } = await sbClient
    .from('checkout_abandono')
    .select('*')
    .gte('iniciado_em', desde)
    .order('ultimo_evento_em', { ascending: false })
    .limit(LIMITE_ABANDONO)
  if (error) {
    // Erro nunca vira lista vazia: a tela diria "ninguém abandonou" quando na verdade não leu.
    erro.value = error.message
    colunas.value = vazio()
    cortado.value = false
  } else {
    colunas.value = separarPorStatus(data)
    cortado.value = foiCortado(data)
  }
  carregando.value = false
}

let relogio = null
let recarga = null
onMounted(() => {
  carregar()
  relogio = setInterval(() => { agora.value = Date.now() }, 1000)  // só a contagem regressiva
  recarga = setInterval(carregar, 15000)                            // o banco é quem move para a fila
})
onBeforeUnmount(() => { clearInterval(relogio); clearInterval(recarga) })
</script>

<style scoped>
@import '../../estilos/identidade-da-ferramenta.css';

.ac-tela { min-height:100vh; background:var(--bg); }
.ac-body { padding:clamp(16px, 2.4vw, 40px); display:flex; flex-direction:column; gap:var(--sp-6); }
.ac-barra { display:flex; align-items:center; justify-content:space-between; gap:var(--sp-4); flex-wrap:wrap; }
.ac-regra { margin:0; color:var(--muted); font-size:var(--texto-corpo); overflow-wrap:anywhere; flex:1 1 280px; }
.ac-grade { display:grid; grid-template-columns:repeat(auto-fit, minmax(240px, 1fr)); gap:var(--sp-6); align-items:start; }
.ac-cartao { display:flex; flex-direction:column; gap:var(--sp-4); }
.ac-titulo-secao { display:flex; align-items:center; gap:var(--sp-2); margin:0; }
.ac-contagem-total { margin-left:auto; color:var(--muted); font-variant-numeric:tabular-nums; }
.ac-lista { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:var(--sp-3); }
.ac-item { display:flex; flex-direction:column; align-items:flex-start; gap:var(--sp-1); padding:var(--sp-3); border:1px solid var(--border); border-radius:var(--radius-md); background:var(--surface); min-width:0; width:100%; }
.ac-linha { display:flex; justify-content:space-between; gap:var(--sp-3); width:100%; }
.ac-quem { font-weight:600; color:var(--text); overflow-wrap:anywhere; }
.ac-tempo { font-variant-numeric:tabular-nums; font-weight:600; color:var(--modulo); white-space:nowrap; }
.ac-detalhe { color:var(--muted); font-size:var(--texto-etiqueta); overflow-wrap:anywhere; }
.ac-trilho { width:100%; height:5px; border-radius:var(--radius-sm); background:var(--border); overflow:hidden; margin-top:var(--sp-1); }
.ac-preenchido { height:100%; background:var(--modulo); }
.ac-carregando, .ac-vazio { margin:0; color:var(--muted); }
.ac-erro { margin:0; padding:var(--sp-3); border-radius:var(--radius-md); color:var(--text); background:color-mix(in srgb, var(--red) 10%, var(--surface)); border:1px solid color-mix(in srgb, var(--red) 38%, var(--surface)); }
.ac-aviso { margin:0; padding:var(--sp-3); border-radius:var(--radius-md); color:var(--text); background:color-mix(in srgb, var(--orange) 10%, var(--surface)); border:1px solid color-mix(in srgb, var(--orange) 38%, var(--surface)); }

@media (max-width:640px) {
  .ac-body { padding:var(--sp-4); }
  .ac-grade { grid-template-columns:1fr; }
}
</style>
