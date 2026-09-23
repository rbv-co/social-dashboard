<template>
  <!-- Porta da família "Comercial Vessel". Tela pequena e estática: bindings
       @click do Vue, sem innerHTML e sem expor nada em window. Mesmo padrão de
       tela-de-menu-gestao-interna.vue. -->
  <div class="tela-menu-comercial-vessel id-ferramenta">
    <barra-de-topo :voltar="ROTULO_DO_PAI[paiDaTela('comercial-vessel')]"
                   titulo="Comercial Vessel" @voltar="voltar" />

    <div class="cvmenu-body">
      <div class="cvmenu-headline">
        <h2>Escolha o módulo</h2>
        <p>O atendimento e a ação comercial da Vessel, num lugar só</p>
      </div>

      <div class="cvmenu-cards">
        <div class="cvmenu-card" v-if="podeAtendimentos" @click="ir('atendimentos')">
          <div class="cvmenu-card-icon" style="background:linear-gradient(135deg,#9a6b3f 0%,#c3a36a 100%)">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="m9 16 2 2 4-4"/></svg>
          </div>
          <div class="cvmenu-card-title">Private Appointment</div>
          <div class="cvmenu-card-desc">A visita agendada à loja: quem tem horário, quem veio e quanto comprou depois.</div>
          <span class="cvmenu-card-enter">→</span>
        </div>

        <div class="cvmenu-card" v-if="podeAtendimentos" @click="ir('beauty-sessions')">
          <div class="cvmenu-card-icon" style="background:linear-gradient(135deg,#7a5c8a 0%,#b89ac4 100%)">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM18 18h3v3h-3z"/></svg>
          </div>
          <div class="cvmenu-card-title">Beauty Sessions</div>
          <div class="cvmenu-card-desc">Criar a sessão, ver quem leu o QR e encerrar quando acaba.</div>
          <span class="cvmenu-card-enter">→</span>
        </div>

        <div class="cvmenu-card" v-if="podeAtendimentos" @click="ir('private-edit')">
          <div class="cvmenu-card-icon" style="background:linear-gradient(135deg,#6b4a7a 0%,#9b7bb0 100%)">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2z"/><path d="m2 8 10 6 10-6"/></svg>
          </div>
          <div class="cvmenu-card-title">Private Edit</div>
          <div class="cvmenu-card-desc">O encontro da stylist com as convidadas dela: marcar, convidar e ver quem foi.</div>
          <span class="cvmenu-card-enter">→</span>
        </div>

        <div class="cvmenu-card" v-if="podeAtendimentos" @click="ir('stylist-circle')">
          <div class="cvmenu-card-icon" style="background:linear-gradient(135deg,#1e5f74 0%,#3d9bb5 100%)">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3"/><path d="M5.5 21a6.5 6.5 0 0 1 13 0"/><circle cx="19" cy="6" r="2"/><circle cx="5" cy="6" r="2"/></svg>
          </div>
          <div class="cvmenu-card-title">Stylist Circle</div>
          <div class="cvmenu-card-desc">Quem são as parceiras, quanto tráfego cada uma traz e o que isso virou.</div>
          <span class="cvmenu-card-enter">→</span>
        </div>

        <!-- Os QR das três ações acima, para a gráfica. Mesma chave delas:
             é delas que os QR vêm (ver a rota em mapa-de-enderecos.js). -->
        <div class="cvmenu-card" v-if="podeAtendimentos" @click="ir('material-grafico')">
          <div class="cvmenu-card-icon" style="background:linear-gradient(135deg,#556b2f 0%,#8a9a4b 100%)">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/></svg>
          </div>
          <div class="cvmenu-card-title">Material Gráfico</div>
          <div class="cvmenu-card-desc">Os QR de cada ação do plano, sem fundo, em PNG e SVG, prontos para a gráfica.</div>
          <span class="cvmenu-card-enter">→</span>
        </div>

        <div class="cvmenu-card" v-if="podeCarrinho" @click="ir('funil-carrinho')">
          <div class="cvmenu-card-icon" style="background:linear-gradient(135deg,#ea580c 0%,#c2410c 100%)">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/><path d="M1 1h4l2.7 12.4a2 2 0 0 0 2 1.6h8.6a2 2 0 0 0 2-1.6L23 6H6"/></svg>
          </div>
          <div class="cvmenu-card-title">Funil de Carrinho</div>
          <div class="cvmenu-card-desc">O que entra e sai do carrinho na loja, e quem desistiu antes de pagar.</div>
          <span class="cvmenu-card-enter">→</span>
        </div>

        <!-- ⚠️ PORTA, NÃO TELA: o gerador do Appointment Card mora no OUTRO
             repositório (vesselbrasil.com.br), fora daqui — ver o comentário em
             ENDERECO_DO_GERADOR_DE_CARTAO. Por isso é <a> de verdade, não
             <div @click>: a pessoa sai do sistema, e precisa poder abrir noutra
             aba, copiar o link e ver para onde vai antes de clicar.
             `rel="noopener noreferrer"` é obrigatório junto de target="_blank".
             A seta é ↗ (sai daqui), não → (outra tela da Central). -->
        <a class="cvmenu-card" v-if="podeAtendimentos"
           :href="ENDERECO_DO_GERADOR_DE_CARTAO" target="_blank" rel="noopener noreferrer">
          <div class="cvmenu-card-icon" style="background:linear-gradient(135deg,#8a6a3a 0%,#d4b483 100%)">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/><path d="M6 15h4"/></svg>
          </div>
          <div class="cvmenu-card-title">Appointment Card</div>
          <div class="cvmenu-card-desc">Desenha o cartão do agendamento no celular da Client Advisor. Abre o gerador no site da Vessel.</div>
          <span class="cvmenu-card-enter">↗</span>
        </a>
      </div>
    </div>
  </div>
</template>

<script setup>
/* COMERCIAL VESSEL — a porta única das ferramentas de atendimento e ação
 * comercial da marca. Pedido do dono em 18/09/2026: elas estavam espalhadas em
 * três cartões soltos na Central, e a home crescia um cartão por entrega.
 *
 * ⚠️ AGRUPAR NÃO É MUDAR PERMISSÃO. Cada módulo continua atrás da MESMA chave
 * que tinha antes (`atendimentos` e `carrinho`), e os endereços diretos
 * continuam valendo — quem tinha um link salvo não perde nada. Uma chave nova
 * "comercial" nasceria DESMARCADA para todo mundo e tiraria, no dia da
 * entrega, o acesso de quem já trabalha com isso.
 *
 * ⚠️ O QUE FICOU DE FORA, E POR QUÊ:
 *   · Gestão Comercial — é multi-marca, não é só Vessel.
 *   · Autenticidade e Garantia — é Vessel, mas é produto e garantia, não
 *     atendimento; e já tem casa em Gestão Interna. Mover duas vezes o mesmo
 *     cartão é pior do que deixá-lo onde as pessoas já sabem achar.
 */
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import BarraDeTopo from '../../compartilhado/barra-de-topo.vue'
import { hasPermission } from '../../compartilhado/controle-de-login-e-usuario.js'
import { paiDaTela, ROTULO_DO_PAI } from './navegacao.js'
import { ENDERECO_DO_GERADOR_DE_CARTAO } from './enderecos-publicos.js'

const router = useRouter()

const podeAtendimentos = computed(() => hasPermission('atendimentos', 'ver'))
const podeCarrinho = computed(() => hasPermission('carrinho', 'ver'))

// ⚠️ O menu é o pai da família: aqui SIM o voltar é 'inicio' na mão — é o
// próprio paiDaTela('comercial-vessel') dizendo isso, não um atalho.
function voltar() { router.push({ name: paiDaTela('comercial-vessel') }) }
function ir(nome) { router.push({ name: nome }) }
</script>

<style scoped>
/* Só a BARRA DO TOPO ganha a cor do Comercial Vessel (a do cartão da home):
   filete e tinta sutil. Os cartões já têm o ícone colorido de cada módulo —
   e nada mais daqui usa as classes da folha. */
@import '../../estilos/identidade-da-ferramenta.css';
.cvmenu-body {
  width: 100%;
  padding: var(--sp-5) clamp(16px, 2.4vw, 40px) var(--sp-6);
}

.cvmenu-headline { margin-bottom: var(--sp-5); }
.cvmenu-headline h2 {
  font-family: var(--fonte-principal);
  font-size: var(--texto-titulo);
  color: var(--text);
  margin: 0;
}
.cvmenu-headline p {
  font-family: var(--fonte-principal);
  font-size: var(--texto-corpo);
  color: var(--muted);
  margin: 6px 0 0;
}

.cvmenu-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: var(--sp-3);
}

.cvmenu-card {
  position: relative;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: var(--sp-4);
  cursor: pointer;
  transition: border-color .15s ease, transform .12s ease;
  /* ⚠️ O card do Appointment Card é um <a>, não um <div> — sem isto ele
     nasceria sublinhado e azul, como qualquer link, em vez de igual aos
     outros cinco cards. */
  text-decoration: none;
  color: inherit;
  display: block;
}
.cvmenu-card:hover { border-color: var(--accent); }
.cvmenu-card:active { transform: scale(.995); }

.cvmenu-card-icon {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: var(--sp-3);
}

.cvmenu-card-title {
  font-family: var(--fonte-principal);
  font-size: var(--texto-campo);
  color: var(--text);
}
.cvmenu-card-desc {
  font-family: var(--fonte-principal);
  font-size: var(--texto-corpo);
  color: var(--muted);
  margin-top: 4px;
  /* texto nunca corta: quebra em vez de sumir */
  overflow-wrap: anywhere;
}

.cvmenu-card-enter {
  position: absolute;
  top: var(--sp-4);
  right: var(--sp-4);
  color: var(--muted);
  font-size: var(--texto-corpo);
}

</style>
