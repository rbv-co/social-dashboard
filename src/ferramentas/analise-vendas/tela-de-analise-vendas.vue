<template>
  <!-- Porte fiel de #sales-analysis-screen (legacy/index.html L11854-11893),
       VERBATIM. Mesmo padrão da Gestão à Vista / Gestão de Tráfego: root vira
       .tela-analise-vendas (sem display:none — quem controla a visibilidade
       agora é o vue-router). Reaproveita o topbar .gv-topbar/.gv-clock/
       .gv-period-btns (mesma classe da Gestão à Vista/Gestão de Tráfego — cada
       tela traz sua própria cópia do CSS, mesmo padrão já estabelecido). Único
       onclick trocado por binding Vue: o botão "Marcas" (Voltar) —
       closeSalesAnalysis vira @click, e a função por trás dele agora também
       limpa os timers/gráficos e navega pelo router. Os demais
       onclick="saSelectPeriod('...')"/"saToggleAuto()"/"saToggleCanalDrop(event)"/
       "event.stopPropagation()" ficam como STRING literal (igual ao legado) —
       são atributos HTML nativos, avaliados no escopo global; por isso o
       cluster de funções que eles chamam é exposto em window mais abaixo.
       #sa-body é 100% montado via innerHTML/createElement pelo JS abaixo
       (renderSalesAnalysis e as sub-renderSA*). -->
  <div class="tela-analise-vendas">
    <!-- O SUBTITULO E CONTEUDO: diz de quem sao os numeros desta tela.
         Foi trocar isso por um titulo unico que fez a primeira versao
         desta barra ser revertida. -->
    <barra-de-topo voltar="Vendas" titulo="Análise de Vendas" subtitulo="Inteligência RBV" @voltar="closeSalesAnalysis">
    <!-- FAIXA DE CONTROLES DENTRO DA BARRA (2026-08-06, pedido do dono).
         Antes era irmã da barra, numa faixa própria — e no computador isso
         gastava ~80px de altura à toa. Agora entra pelo encaixe de ações, que
         já resolve os dois tamanhos de tela sozinho: fica na linha 1 quando
         cabe (computador) e desce em largura cheia quando não cabe (celular).
         É a mesma faixa, no mesmo lugar visual do celular — muda só o desktop. -->
    <template #acoes>
    <div class="gv-controles">
      <div class="gv-period-btns">
        <button class="gv-pbtn" data-period="today" onclick="saSelectPeriod('today')"><span style="display:inline-block;width:5px;height:5px;border-radius:50%;background:var(--green);margin-right:5px;animation:pulse 2s infinite;vertical-align:middle;flex-shrink:0;"></span>HOJE</button>
        <button class="gv-pbtn" data-period="1d" onclick="saSelectPeriod('1d')">1D</button>
        <button class="gv-pbtn" data-period="7d" onclick="saSelectPeriod('7d')">7D</button>
        <button class="gv-pbtn" data-period="14d" onclick="saSelectPeriod('14d')">14D</button>
        <button class="gv-pbtn" data-period="30d" onclick="saSelectPeriod('30d')">30D</button>
        <button class="gv-pbtn" data-period="monthfull" onclick="saSelectPeriod('monthfull')">MÊS</button>
        <button class="gv-pbtn" data-period="lastmonth" onclick="saSelectPeriod('lastmonth')">MÊS PASS.</button>
        <button class="gv-pbtn active" data-period="sofar" onclick="saSelectPeriod('sofar')">ATÉ AGORA</button>
        <button class="vs-ac-toggle" id="sa-ac-toggle" onclick="saToggleAuto()" title="Auto-ciclo de períodos">▶ AUTO</button>
      </div>
      <div style="position:relative;flex-shrink:0;" onclick="event.stopPropagation()">
        <div class="sa-canal-wrap" id="sa-canal-wrap">
          <button class="sa-canal-trigger" id="sa-canal-trigger" onclick="saToggleCanalDrop(event)">Canais ▾</button>
          <div class="sa-canal-drop" id="sa-canal-drop"></div>
        </div>
      </div>
      <div class="gv-clock-wrap" onclick="event.stopPropagation()">
        <span class="live-dot" style="margin-bottom:4px">Tempo Real</span>
        <div class="gv-clock-time" id="sa-clock">--:--:--</div>
        <div class="gv-clock-date" id="sa-clock-date"></div>
        <div class="gv-update-status" id="sa-update-status">—</div>
      </div>

    </div>
    </template>
    </barra-de-topo>

    <!-- A FAIXA DO RECORTE. Só aparece para quem é de time de venda. Um total
         menor sem explicação parece dado errado — e é assim que nasce chamado. -->
    <div id="sa-recorte" class="sa-recorte" style="display:none"></div>
    <!-- A FAIXA DO BLING FORA DO AR. Aparece só quando a busca falha; o gráfico
         anterior fica, com a hora dele escrita aqui. -->
    <div id="sa-aviso" class="sa-aviso" hidden>
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path d="M12 3 2 20h20L12 3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
        <path d="M12 9v5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        <circle cx="12" cy="17.2" r="1.1" fill="currentColor"/>
      </svg>
      <div><strong id="sa-aviso-titulo"></strong><span id="sa-aviso-detalhe"></span></div>
    </div>
    <div id="sa-body"></div>
  </div>
</template>

<script setup>
import { onMounted, onUnmounted } from 'vue'
import BarraDeTopo from '../../compartilhado/barra-de-topo.vue'
import { useRouter } from 'vue-router'
import { sbClient } from '../../compartilhado/conectar-no-banco-de-dados.js'
import { hasPermission, estado } from '../../compartilhado/controle-de-login-e-usuario.js'
// Quando a recarga de 5 minutos deve acontecer — e quando é só desperdício.
import { decidirNoTique, decidirAoVoltar } from '../../compartilhado/recarga-automatica.js'
// QUEM É DE TIME DE VENDA VÊ SÓ A LOJA DELA (pedido do dono, 12/08/2026).
// A regra mora num módulo só, compartilhado com a Gestão à Vista: duas telas
// de venda recortando por conta própria divergiriam no primeiro ajuste.
// ⚠️ Isto é recorte de TELA. A edge `bling-proxy` continua devolvendo todos os
// canais — ela confere permissão, não canal. Ver o cabeçalho do módulo.
import {
  canaisDoEscopo, estaLimitada, filtrarPedidos, filtrarMapaDeCanais, fraseDoRecorte,
} from '../../compartilhado/canais-de-venda-permitidos.js'
import { adminToast } from '../../compartilhado/avisos.js'
import { hojeLocal, diasAtras } from '../../compartilhado/datas.js'
import { aplicarDataDaVenda } from '../../compartilhado/data-da-venda.js'
import { buscarAjustesDeValor, aplicarValorCorrigido } from '../../compartilhado/valor-corrigido.js'
// A PORTA DO BLING E O QUE FAZER QUANDO ELE NÃO RESPONDE — mesmo módulo da
// Gestão à Vista, para as duas telas de venda nunca discordarem sobre isso.
import { chamarBling, paginasDoBling, ErroDoBling, textoDoAviso } from '../../compartilhado/chamada-do-bling.js'
// Quando mostrar "Carregando" e quando escrever o recado de erro. Mora fora da
// tela para poder ser provado sem navegador — ver o comentario do arquivo.
import { corpoEstaVazio, deveMostrarCarregando, deveEscreverRecado } from './carregamento-da-tela.js'
import { agruparCanais, estadoDoGrupo, alternarGrupo } from '../../compartilhado/grupo-do-canal.js'
import { ocultosNoPeriodo } from '../../compartilhado/canal-fechado.js'

// O grupo de cada canal, lido de bling_lojas junto com o nome (Peça 2).
let _saGrupoDoCanal={}
// As linhas cruas de bling_lojas: o escopo da supervisora precisa da LISTA para
// ampliar para o grupo inteiro. Sem ela a regra não amplia (lado seguro).
let _saCanaisBrutos=[]

const router = useRouter()

const logoClaroUrl = '/midia/LOGOTIPOBRENOPRETO.png'
const logoEscuroUrl = '/midia/LOGOTIPOBRENOBRANCO.png'

// ==========================================================================
// PORTE VERBATIM da Análise de Vendas (legacy/index.html L5755-7141, cluster
// de funções sa*/_sa*/renderSA* — esse trecho do monólito está INTERCALADO
// com funções da Gestão à Vista, GV_QUOTES etc.; as funções _gv*/gv* que
// aparecem no meio (L5804-6112 do legado) foram EXCLUÍDAS daqui de propósito,
// pois já são portadas verbatim em tela-de-gestao-a-vista.vue), menos
// openSalesAnalysis/closeSalesAnalysis, que viraram onMounted/closeSalesAnalysis
// (cleanup+router) abaixo, e o listener de fechar o dropdown de canais
// (documento inteiro), que virou addEventListener/removeEventListener em
// onMounted/onUnmounted em vez de rodar sempre solto no escopo global do
// monólito (mesmo padrão de _gtDocClick em tela-de-gestao-trafego.vue).
//
// Dependências externas resolvidas:
//   - sbClient                                  → import (conectar-no-banco-de-dados.js)
//   - chamarBling, paginasDoBling, textoDoAviso  → import (chamada-do-bling.js)
//     (a URL e a chave anônima do Supabase moram lá dentro agora)
//   - hasPermission                              → import (controle-de-login-e-usuario.js)
//   - adminToast                                 → import (avisos.js) — usado só na guarda
//   - fmtR, fmtR0, blingCall, blingPages          → COPIADOS abaixo (idênticos aos
//     já copiados em tela-de-gestao-a-vista.vue; ver legacy L3394/6294/6261/6275).
//     escHtml (legacy L4851) NÃO foi copiado: conferido por grep no bloco inteiro
//     (L5755-7141) — as 2 únicas chamadas a escHtml() pertencem a funções da
//     Gestão à Vista (_gvBuildSkuSlide/_gvUpdateVendRanking), que foram excluídas
//     daqui; nenhuma função renderSA*/sa* usa escHtml (evitar código morto).
//   - Chart / ChartDataLabels (globais)          → CDN já presente em index.html
//     da raiz do projeto (chart.js@4.4.4 + chartjs-plugin-datalabels@2.2.0),
//     mesmas versões usadas pelo legado — nenhuma tag nova precisou ser
//     adicionada.
//   - setHomeBgTheme('sales') / sessionStorage.setItem('rbv-screen',...) / o
//     toggle de tela via getElementById+display do openSalesAnalysis/
//     closeSalesAnalysis originais foram OMITIDOS: são do fundo animado global
//     (#bg-shapes) e da troca de "telas" por display:none do monólito, que não
//     existem mais — quem mostra/esconde a tela agora é o vue-router (mesmo
//     racional de tela-de-gestao-a-vista.vue).
//   - O trecho de openSalesAnalysis que copiava a foto do card da Vessel
//     (#sbrand-vessel-img, da OUTRA tela) para #sa-brand-av também foi OMITIDO:
//     já era mort@ no legado (o id="sa-brand-av" não existe mais no HTML atual
//     de #sales-analysis-screen — só sobrou a leitura no JS), e no Vue as duas
//     telas nunca coexistem no DOM ao mesmo tempo (troca por rota), então essa
//     ponte entre telas deixaria de fazer sentido de qualquer forma.
//
// AJUSTE MÍNIMO DE COMPORTAMENTO (não é refatoração, é correção de escopo):
// no legado, `window._saFsz = n => Math.round(n*(window._saTvF||1))` era lido
// em todo lugar como `_saFsz(...)` (SEM o prefixo "window."), o que só
// funciona porque o monólito é um <script> clássico não-modular, onde
// `window.x = ...` também cria uma variável global "x" enxergada por escopo
// léxico. Dentro de um <script setup> (módulo ES), isso não acontece — por
// isso aqui `_saFsz` é uma variável de módulo (`let _saFsz`) de verdade,
// atribuída sem o prefixo "window." (mesma função, mesmo comportamento em
// runtime), e todas as ~16 chamadas `_saFsz(...)` continuam idênticas ao
// legado. `window._saLabelColor`/`window._saTvF`/os demais `window._sa*` NÃO
// precisaram desse ajuste, pois são sempre lidos com o prefixo "window."
// explícito no código original.
// ==========================================================================

/* ── Helpers copiados do legado (self-contidos, idênticos aos de tela-de-gestao-a-vista.vue) ── */
function fmtR(v){const p=v.toFixed(2).split('.');return 'R$ '+p[0].replace(/\B(?=(\d{3})+(?!\d))/g,'.')+','+p[1];}
function fmtR0(v){return 'R$ '+Math.round(Number(v)).toLocaleString('pt-BR');}
// Mesma porta da Gestão à Vista: src/compartilhado/chamada-do-bling.js. Aqui só
// atalhos com o sbClient já preso.
const blingCall=(endpoint,params)=>chamarBling(sbClient,endpoint,params);
const blingPages=(endpoint,params)=>paginasDoBling(sbClient,endpoint,params);

/* ── Relógio (legacy L5768-5779, verbatim) ── */
function startSAClock(){
  const tEl=document.getElementById('sa-clock'),dEl=document.getElementById('sa-clock-date');
  if(!tEl)return;
  const tick=()=>{
    const now=new Date();
    tEl.textContent=String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0')+':'+String(now.getSeconds()).padStart(2,'0');
    if(dEl){const ds=now.toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'long'});dEl.textContent=ds.toUpperCase();}
  };
  tick();if(window._saClockTimer)clearInterval(window._saClockTimer);
  window._saClockTimer=setInterval(tick,1000);
}

/* ── Período / auto-ciclo (legacy L6113-6139, verbatim) ── */
function saSelectPeriod(p){
  document.querySelectorAll('#sales-analysis-screen .gv-pbtn, .tela-analise-vendas .gv-pbtn').forEach(b=>b.classList.toggle('active',b.dataset.period===p));
  loadSalesAnalysisData(p);
}
const SA_AC_PERIODS=['sofar','today','1d','7d','14d','30d','monthfull'];
const SA_AC_DURATION=60; // segundos por período
let _saAcIdx=0,_saAcTimer=null;
function saAutoStart(){
  if(_saAcTimer)return;
  const btn=document.getElementById('sa-ac-toggle');
  if(btn)btn.classList.add('running');
  const scheduleNext=()=>{
    _saAcTimer=setTimeout(async()=>{
      if(!_saAcTimer)return;
      _saAcIdx=(_saAcIdx+1)%SA_AC_PERIODS.length;
      await loadSalesAnalysisData(SA_AC_PERIODS[_saAcIdx]);
      if(_saAcTimer)scheduleNext();
    },SA_AC_DURATION*1000);
  };
  scheduleNext();
}
function saAutoStop(){
  clearTimeout(_saAcTimer);_saAcTimer=null;
  const btn=document.getElementById('sa-ac-toggle');
  if(btn)btn.classList.remove('running');
}
function saToggleAuto(){if(_saAcTimer)saAutoStop();else saAutoStart();}

/* ── Fundo animado (canvas, legacy L6141-6187, verbatim) ── */
function _saStartBgAnim(){
  const screen=document.querySelector('.tela-analise-vendas');
  if(!screen)return;
  let cv=document.getElementById('sa-bg-canvas');
  if(cv)cv.remove();
  cv=document.createElement('canvas');cv.id='sa-bg-canvas';
  screen.insertBefore(cv,screen.firstChild);
  const isDark=document.documentElement.getAttribute('data-theme')==='dark';
  const col=isDark?'rgba(79,124,255,':'rgba(29,78,216,';
  // 3 slow trend lines with different phases and amplitudes
  const LINES=[
    {phase:0,      speed:0.00018,amp:0.13,center:0.38,drift:0.000008},
    {phase:2.1,    speed:0.00012,amp:0.09,center:0.60,drift:-0.000005},
    {phase:4.4,    speed:0.00022,amp:0.07,center:0.75,drift:0.000003}
  ];
  let t=0;
  const resize=()=>{cv.width=screen.offsetWidth||800;cv.height=screen.offsetHeight||600;};
  resize();
  window._saAnimRO=new ResizeObserver(resize);window._saAnimRO.observe(screen);
  const draw=()=>{
    window._saAnimRAF=requestAnimationFrame(draw);
    t++;
    const W=cv.width,H=cv.height;
    if(!W||!H)return;
    const ctx=cv.getContext('2d');
    ctx.clearRect(0,0,W,H);
    LINES.forEach((ln,li)=>{
      ln.center=Math.max(0.2,Math.min(0.8,ln.center+ln.drift*(Math.sin(t*0.001+li)*0.5+0.5-0.5)));
      ctx.beginPath();
      const pts=80;
      for(let i=0;i<=pts;i++){
        const x=W*i/pts;
        const tOff=t*ln.speed+ln.phase;
        const y=H*(ln.center+ln.amp*Math.sin(tOff+i*0.09)+ln.amp*0.4*Math.sin(tOff*1.7+i*0.05));
        i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
      }
      const opacity=[0.18,0.13,0.10][li];
      ctx.strokeStyle=col+opacity+')';
      ctx.lineWidth=1.5-li*0.3;
      ctx.stroke();
    });
  };
  draw();
  cv.style.opacity='1';
}
function _saStopBgAnim(){
  if(window._saAnimRAF){cancelAnimationFrame(window._saAnimRAF);window._saAnimRAF=null;}
  if(window._saAnimRO){try{window._saAnimRO.disconnect();}catch(e){}}
  const cv=document.getElementById('sa-bg-canvas');if(cv)cv.remove();
}

/* ── Dropdown de canais (legacy L6191-6205, verbatim, exceto o listener de
   fechar-ao-clicar-fora, que virou a função nomeada _saDocClick, amarrada ao
   ciclo de vida do componente — addEventListener/removeEventListener em
   onMounted/onUnmounted mais abaixo, mesmo padrão de _gtDocClick em
   tela-de-gestao-trafego.vue) ── */
function saToggleCanalDrop(e){
  e.stopPropagation();
  document.getElementById('sa-canal-drop')?.classList.toggle('open');
}
function _saDocClick(e){
  const wrap=document.getElementById('sa-canal-wrap');
  if(wrap&&!wrap.contains(e.target))document.getElementById('sa-canal-drop')?.classList.remove('open');
}
function saSelectCanal(){
  if(!window._saRawData)return;
  const boxes=[...document.querySelectorAll('.sa-canal-chk')];
  const active=boxes.filter(cb=>cb.checked).map(cb=>cb.value);
  const trigger=document.getElementById('sa-canal-trigger');
  if(trigger)trigger.textContent=active.length===boxes.length?'Todos os canais ▾':active.length===0?'Nenhum canal ▾':`${active.length} canal(is) ▾`;
  renderSalesAnalysis(window._saRawData,active);
}

/* ── Carregamento dos dados (legacy L6297-6421, verbatim, exceto o ajuste de
   escopo de _saFsz descrito no comentário do topo) ── */
window._saCharts={};
window._saRawData=null;
let _saFsz=n=>n; // fallback antes da 1ª carga; reatribuída abaixo a cada loadSalesAnalysisData

// ── A faixa de aviso do Bling ─────────────────────────────────────────────
// Mesma regra da Gestão à Vista: admin lê a causa, os outros leem só que o
// número está velho. A hora vem de window._saLastUpdateTime, que só é gravada
// depois de uma busca que deu certo.
function ehAdminSa(){ return estado.role==='admin'||estado.is_superadmin===true; }
function horaDoDadoSa(){
  const l=window._saLastUpdateTime;
  if(!l)return null;
  const p=n=>String(n).padStart(2,'0');
  return `${p(l.getHours())}:${p(l.getMinutes())}`;
}
function mostrarAvisoSa(causa,tecnica){
  const el=document.getElementById('sa-aviso');
  if(!el)return;
  const {titulo,detalhe}=textoDoAviso(causa,{ehAdmin:ehAdminSa(),horaDoDado:horaDoDadoSa(),tecnica});
  document.getElementById('sa-aviso-titulo').textContent=titulo;
  document.getElementById('sa-aviso-detalhe').textContent=detalhe?' '+detalhe:'';
  el.hidden=false;
}
function esconderAvisoSa(){
  const el=document.getElementById('sa-aviso');
  if(el)el.hidden=true;
}

async function loadSalesAnalysisData(period,opcoes){
  // `automatica` = veio do relógio de 5 minutos, não de um clique. Só a recarga
  // automática segura o conteúdo sem piscar; quem PEDIU merece ver "Carregando".
  const automatica=!!(opcoes&&opcoes.automatica);
  document.querySelectorAll('#sales-analysis-screen .gv-pbtn, .tela-analise-vendas .gv-pbtn').forEach(b=>b.classList.toggle('active',b.dataset.period===period));
  const body=document.getElementById('sa-body');
  esconderAvisoSa();
  // A cada 5 minutos esta tela se recarrega. Antes ela zerava o corpo AQUI, no
  // começo — então uma busca que falhasse deixava a tela vazia, sem nada para
  // voltar. Agora o conteúdo antigo fica até o dado novo chegar; quem limpa é o
  // renderSalesAnalysis, que já zera o corpo antes de montar.
  //
  // O critério é O CORPO, não `window._saRawData`: a variável recebe valor ANTES
  // do render, então ela diz "tem conteúdo" enquanto a tela ainda está vazia.
  // Ver carregamento-da-tela.js.
  if(deveMostrarCarregando({corpoVazio:corpoEstaVazio(body),automatica})){
    body.textContent='';
    const loading=document.createElement('div');loading.className='sa-loading';
    const spin=document.createElement('div');spin.className='gv-spinner';
    const lbl=document.createElement('span');lbl.className='sa-loading-lbl';lbl.textContent='Carregando dados';
    loading.appendChild(spin);loading.appendChild(lbl);
    body.appendChild(loading);
  }
  try{
    if(typeof ChartDataLabels!=='undefined')Chart.register(ChartDataLabels);
    Chart.defaults.font.family="var(--fonte-principal)";
    Chart.defaults.font.size=11;
    Chart.defaults.animation.duration=800;
    Chart.defaults.animation.easing='easeOutQuart';
    try{Chart.defaults.transitions.active.animation.duration=200;}catch(e){}
    window._saLabelColor=()=>getComputedStyle(document.documentElement).getPropertyValue('--text').trim()||'#333';
    Chart.defaults.color=window._saLabelColor();
    _saFsz=n=>Math.round(n*(window._saTvF||1));
  }catch(e){}


  const now=new Date(new Date().toLocaleString('en-US',{timeZone:'America/Sao_Paulo'}));
  const y=now.getFullYear(),m=now.getMonth()+1;
  const pad=n=>String(n).padStart(2,'0');
  // Use getDate() component (= Brazil local date), never toISOString() which returns UTC
  const brtToday=`${y}-${pad(m)}-${pad(now.getDate())}`;
  const brtAdd=days=>{const d=new Date(now);d.setDate(d.getDate()+days);return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;};
  let di,df;
  let effY=y,effM=m,effNow=now;
  if(period==='sofar'){di=`${y}-${pad(m)}-01`;df=brtToday;}
  else if(period==='today'){di=df=brtToday;}
  else if(period==='1d'){di=df=brtAdd(-1);}
  else if(period==='7d'){di=brtAdd(-7);df=brtToday;}
  else if(period==='14d'){di=brtAdd(-14);df=brtToday;}
  else if(period==='30d'){di=brtAdd(-30);df=brtToday;}
  else if(period==='monthfull'){const e=new Date(y,m,0);di=`${y}-${pad(m)}-01`;df=`${e.getFullYear()}-${pad(e.getMonth()+1)}-${pad(e.getDate())}`;}
  else if(period==='lastmonth'){const s=new Date(y,m-2,1),e=new Date(y,m-1,0);di=`${s.getFullYear()}-${pad(s.getMonth()+1)}-${pad(s.getDate())}`;df=`${e.getFullYear()}-${pad(e.getMonth()+1)}-${pad(e.getDate())}`;effY=e.getFullYear();effM=e.getMonth()+1;effNow=e;}
  else{di=`${y}-${pad(m)}-01`;df=brtToday;}

  const isoD=d=>d.toISOString().slice(0,10);
  const spanMs=new Date(df+'T00:00:00')-new Date(di+'T00:00:00');
  const diPrev=isoD(new Date(new Date(di+'T00:00:00')-spanMs-864e5));
  const dfPrev=isoD(new Date(new Date(di+'T00:00:00')-864e5));

  const di15=brtAdd(-14);
  const df15=brtToday;

  try{
    const[pedidosBrutos,pedidosPrevBrutos,lojaMapCheio,metasArr,vendedoresArr,pedidos15Brutos,meusTimes]=await Promise.all([
      blingPages('pedidos/vendas',{dataInicial:di,dataFinal:df,'idsSituacoes[]':9}),
      blingPages('pedidos/vendas',{dataInicial:diPrev,dataFinal:dfPrev,'idsSituacoes[]':9}).catch(()=>[]),
      // O GRUPO vem junto do nome (Peça 2, 20/08/2026): é ele que separa o
      // menu de canais em Atacado / Varejo / Outros.
      sbClient.from('bling_lojas').select('loja_id,nome,grupo,grupo_id,fechado_em').order('loja_id').then(r=>{const mp={};_saGrupoDoCanal={};_saCanaisBrutos=r.data||[];_saCanaisBrutos.forEach(l=>{mp[l.loja_id]=l.nome;_saGrupoDoCanal[l.loja_id]=l.grupo||null;});return mp;}),
      sbClient.from('bling_metas').select('loja_id,meta_valor,daily_goals').eq('year',effY).eq('month',effM).then(r=>r.data||[]),
      sbClient.from('bling_vendedores').select('vendor_id,nome').then(r=>r.data||[]),
      blingPages('pedidos/vendas',{dataInicial:di15,dataFinal:df15,'idsSituacoes[]':9}).catch(()=>[]),
      // Os times e quem está neles. Falhar aqui devolve listas vazias — e com
      // elas `canaisDoEscopo` responde `[]` para quem é de time, ou seja, tela
      // vazia com o motivo escrito. É o lado seguro: o outro seria mostrar o
      // faturamento da empresa inteira para quem não pode ver.
      Promise.all([
        sbClient.from('equipes').select('id,nome,canal_loja_id').then(r=>r.data||[]),
        // `papel` entrou em 20/08: sem ele a supervisora vira vendedora.
        sbClient.from('equipes_membros').select('equipe_id,profile_id,papel').then(r=>r.data||[]),
        // A supervisora que mora no GRUPO (27/08/2026). O banco já reconhece
        // este vínculo desde 21/08; sem ler aqui, o banco liberaria e esta tela
        // mostraria zero, sem erro nenhum.
        sbClient.from('canais_grupos_membros').select('grupo_id,profile_id,papel').then(r=>r.data||[]),
      ]).then(([t,m,g])=>({times:t,membros:m,membrosDeGrupo:g}))
        .catch(()=>({times:[],membros:[],membrosDeGrupo:[]}))
    ]);

    // O RECORTE POR TIME. `null` = vê tudo, e é o caminho de 15 dos 17 perfis
    // de hoje: nada muda para eles, que foi exatamente o pedido do dono.
    const meusCanais=canaisDoEscopo({
      isSuperadmin:estado.is_superadmin,
      escopoPorEquipe:estado.escopo_por_equipe,
      meuId:estado.userId,
      times:meusTimes.times,membros:meusTimes.membros,
      // A lista de canais com grupo: é ela que deixa a supervisora ver o grupo
      // inteiro dos times onde supervisiona (Peça 3).
      canais:_saCanaisBrutos,
      membrosDeGrupo:meusTimes.membrosDeGrupo,
    });
    const lojaMap=filtrarMapaDeCanais(lojaMapCheio,meusCanais);
    // A META TAMBÉM. Sem isto a tela mediria a venda de UMA loja contra a meta
    // de TODAS — a vendedora apareceria eternamente a 8% do alvo.
    const metas=estaLimitada(meusCanais)
      ? (metasArr||[]).filter(m=>meusCanais.map(String).includes(String(m.loja_id)))
      : metasArr;

    const faixa=document.getElementById('sa-recorte');
    if(faixa){
      const frase=fraseDoRecorte(meusCanais,lojaMapCheio);
      faixa.textContent=frase;
      faixa.style.display=frase?'block':'none';
      faixa.classList.toggle('sa-recorte-vazio',estaLimitada(meusCanais)&&!meusCanais.length);
    }

    // A VENDA CONTA NO DIA DA NOTA, não no dia do pedido. As TRÊS janelas
    // recebem o mesmo tratamento — a atual, a anterior (senão o comparativo
    // mistura duas réguas) e a de 15 dias do gráfico.
    // Ver src/compartilhado/data-da-venda.js.
    // E O VALOR QUE O BLING CONGELOU ERRADO: nota autorizada tranca o pedido, e
    // o total certo passa a morar em `bling_pedido_ajuste_valor`. Uma consulta
    // só, aplicada nas TRÊS janelas pelo mesmo motivo do recorte abaixo — e
    // depois do data-da-venda, que é por onde passam também os pedidos trazidos
    // de outro dia. Ver src/compartilhado/valor-corrigido.js.
    const[aj,ajPrev,aj15,ajustesDeValor]=await Promise.all([
      aplicarDataDaVenda(sbClient,pedidosBrutos,di,df),
      aplicarDataDaVenda(sbClient,pedidosPrevBrutos,diPrev,dfPrev),
      aplicarDataDaVenda(sbClient,pedidos15Brutos,di15,df15),
      buscarAjustesDeValor(sbClient),
    ]);
    aj.pedidos=aplicarValorCorrigido(aj.pedidos,ajustesDeValor).pedidos;
    ajPrev.pedidos=aplicarValorCorrigido(ajPrev.pedidos,ajustesDeValor).pedidos;
    aj15.pedidos=aplicarValorCorrigido(aj15.pedidos,ajustesDeValor).pedidos;
    // AS TRÊS JANELAS RECEBEM O MESMO RECORTE. Recortar só a atual faria o
    // comparativo ("vs período anterior") medir a loja dela contra a empresa
    // inteira — um número errado com cara de verdade.
    const pedidos=filtrarPedidos(aj.pedidos,meusCanais);
    const pedidosPrev=filtrarPedidos(ajPrev.pedidos,meusCanais);
    const pedidos15=filtrarPedidos(aj15.pedidos,meusCanais);

    const allIds=[...new Set([...pedidos,...pedidosPrev,...pedidos15].map(p=>parseInt(p.id)))];
    let pvMap={};let pvQtdMap={};
    if(allIds.length){
      let pvArr=[];
      const r1=await sbClient.from('bling_pedido_vendedor').select('pedido_id,vendor_id,qtd_itens').in('pedido_id',allIds.slice(0,500));
      if(!r1.error&&r1.data){pvArr=r1.data;}
      else{const r2=await sbClient.from('bling_pedido_vendedor').select('pedido_id,vendor_id').in('pedido_id',allIds.slice(0,500));pvArr=r2.data||[];}
      pvArr.forEach(r=>{pvMap[r.pedido_id]=r.vendor_id;pvQtdMap[r.pedido_id]=r.qtd_itens||1;});
    }

    // ⚠️ LOJA QUE FECHOU SAI DO MENU quando o período começa depois do
    // fechamento, e VOLTA quando o período alcança os dias em que ela operava.
    // `lojaMap` continua cheio de propósito: é dele que sai o NOME, e nome que
    // some deixa o histórico com "Canal #7609". Ver
    // `src/compartilhado/canal-fechado.js`.
    const _saOcultos=ocultosNoPeriodo(_saCanaisBrutos,di);
    const lojas=Object.entries(lojaMap).map(([id,nome])=>({id:parseInt(id),nome,grupo:_saGrupoDoCanal[id]||null}))
      .filter(l=>!_saOcultos.has(l.id)).sort((a,b)=>a.id-b.id);
    const lojasComVenda=new Set(pedidos.map(p=>String(p.loja?.id)).filter(Boolean));
    const initialIds=lojas.filter(l=>lojasComVenda.has(String(l.id))).map(l=>String(l.id));
    const canalDrop=document.getElementById('sa-canal-drop');
    const canalTrigger=document.getElementById('sa-canal-trigger');
    if(canalDrop){
      canalDrop.textContent='';
      // ── O MENU AGRUPADO (Peça 2) ────────────────────────────────────────
      // Um bloco por grupo do canal, com marcar/desmarcar todos em cada um.
      // Canal sem grupo NÃO some: cai no bloco "Outros", no fim. Enquanto
      // ninguém marcar grupo na Config de Admin, existe só esse bloco — e o
      // menu fica idêntico ao que sempre foi, sem cabeçalho nenhum.
      const baldes=agruparCanais(lojas.map(l=>({loja_id:l.id,nome:l.nome,grupo:l.grupo})));
      const temGrupo=baldes.some(b=>b.grupo!==null);
      const marcados=()=>new Set([...document.querySelectorAll('.sa-canal-chk')].filter(cb=>cb.checked).map(cb=>cb.value));
      baldes.forEach(b=>{
        if(temGrupo){
          const cab=document.createElement('div');cab.className='sa-canal-grupo';
          const nome=document.createElement('span');nome.className='sa-canal-grupo-nome';nome.textContent=b.grupo||'Outros';
          const bt=document.createElement('button');bt.type='button';bt.className='sa-canal-grupo-todos';
          const pintar=()=>{bt.textContent=estadoDoGrupo(b.canais,marcados())==='todos'?'desmarcar todos':'marcar todos';};
          bt.addEventListener('click',()=>{
            const novo=alternarGrupo(b.canais,marcados());
            const querido=new Set([...novo].map(String));
            b.canais.forEach(c=>{
              const cb=document.querySelector('.sa-canal-chk[value="'+String(c.loja_id)+'"]');
              if(cb)cb.checked=querido.has(String(c.loja_id));
            });
            canalDrop.querySelectorAll('.sa-canal-grupo-todos').forEach(o=>o.dispatchEvent(new Event('repintar')));
            saSelectCanal();
          });
          bt.addEventListener('repintar',pintar);
          cab.appendChild(nome);cab.appendChild(bt);canalDrop.appendChild(cab);
          // pintado depois que as caixas do bloco existirem
          setTimeout(pintar,0);
        }
        b.canais.forEach(c=>{
          const l=lojas.find(x=>String(x.id)===String(c.loja_id));
          const lbl=document.createElement('label');lbl.className='sa-canal-check';
          const cb=document.createElement('input');cb.type='checkbox';cb.className='sa-canal-chk';cb.value=String(c.loja_id);
          cb.checked=lojasComVenda.has(String(c.loja_id));
          cb.addEventListener('change',()=>{
            canalDrop.querySelectorAll('.sa-canal-grupo-todos').forEach(o=>o.dispatchEvent(new Event('repintar')));
            saSelectCanal();
          });
          const nm=document.createElement('span');nm.textContent=(l&&l.nome)||c.nome;
          lbl.appendChild(cb);lbl.appendChild(nm);
          canalDrop.appendChild(lbl);
        });
      });
      const foot=document.createElement('div');foot.className='sa-canal-drop-foot';
      const btnTodos=document.createElement('button');btnTodos.textContent='Todos';
      btnTodos.addEventListener('click',()=>{document.querySelectorAll('.sa-canal-chk').forEach(cb=>cb.checked=true);canalDrop.querySelectorAll('.sa-canal-grupo-todos').forEach(o=>o.dispatchEvent(new Event('repintar')));saSelectCanal();});
      const btnNenhum=document.createElement('button');btnNenhum.textContent='Nenhum';
      btnNenhum.addEventListener('click',()=>{document.querySelectorAll('.sa-canal-chk').forEach(cb=>cb.checked=false);canalDrop.querySelectorAll('.sa-canal-grupo-todos').forEach(o=>o.dispatchEvent(new Event('repintar')));saSelectCanal();});
      foot.appendChild(btnTodos);foot.appendChild(btnNenhum);
      canalDrop.appendChild(foot);
    }
    if(canalTrigger)canalTrigger.textContent=initialIds.length===lojas.length?'Todos os canais ▾':`${initialIds.length} canal(is) ▾`;

    window._saRawData={pedidos,pedidosPrev,lojaMap,lojas,metasArr:metas,vendedoresArr,pvMap,pvQtdMap,pedidos15,period,di,df,diPrev,dfPrev,di15,df15,now:effNow,y:effY,m:effM};
    window._saCurrentPeriod=period;
    window._saLastUpdateTime=new Date(new Date().toLocaleString('en-US',{timeZone:'America/Sao_Paulo'}));
    // ⚠️ CARIMBO SEPARADO, e ele precisa existir: a linha acima é hora de PAREDE
    // em Brasília lida como hora local — boa para escrever "ÚLT. 14:32" na tela,
    // e ERRADA para fazer conta. Em navegador fora do fuso de Brasília o
    // `.getTime()` dela erra por horas, e "quanto tempo passou desde a última
    // busca" passaria a responder sempre a mesma coisa.
    window._saUltimaBuscaMs=Date.now();
    window._saNextRefreshAt=new Date(window._saLastUpdateTime.getTime()+5*60*1000);

    clearInterval(window._saRefreshTimer);
    window._saRefreshTimer=setInterval(()=>_saTiqueDaRecarga(),5*60*1000);

    clearInterval(window._saCountdownTimer);
    const _tickStatus=()=>{
      const el=document.getElementById('sa-update-status');
      if(!el)return;
      const l=window._saLastUpdateTime;
      const tz=new Date(new Date().toLocaleString('en-US',{timeZone:'America/Sao_Paulo'}));
      const diff=Math.max(0,window._saNextRefreshAt-tz);
      const mm=Math.floor(diff/60000);const ss=Math.floor((diff%60000)/1000);
      el.textContent=`Últ.: ${String(l.getHours()).padStart(2,'0')}:${String(l.getMinutes()).padStart(2,'0')} · Próx.: ${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
    };
    _tickStatus();
    window._saCountdownTimer=setInterval(_tickStatus,1000);

    renderSalesAnalysis(window._saRawData,initialIds);
    // Se pvQtdMap não tem nenhum valor > 1, GV nunca rodou — busca em background
    const _hasRealQtd=Object.values(pvQtdMap).some(v=>v>1);
    if(!_hasRealQtd)_saPopulateItemCounts([...pedidos,...pedidosPrev],pvQtdMap,pvMap);
    _saPopulateDescontos(pedidos);
  }catch(e){
    // Erro que NAO veio do Bling e defeito nosso, e o texto tem de dizer isso —
    // senao a tela manda consertar o fornecedor por bug da Central.
    const causa=e instanceof ErroDoBling?e.causa:'erro-na-tela';
    mostrarAvisoSa(causa,e?.tecnica||e?.message||'');
    // Com gráfico na tela, ele FICA — a faixa diz de que hora é. Sem nada, o
    // recado ocupa o lugar, nunca um gráfico zerado.
    //
    // DE NOVO O CORPO, e não `window._saRawData`: o render limpa a tela e SÓ
    // DEPOIS monta. Se ele explodir no meio, `_saRawData` já tem valor mas a
    // tela está vazia — e perguntar à variável fazia a tela ficar EM BRANCO,
    // sem nem a mensagem de erro. Era o "às vezes não carrega".
    if(deveEscreverRecado({corpoVazio:corpoEstaVazio(body)})){
      body.textContent='';
      const err=document.createElement('div');err.className='sa-loading';
      err.textContent=document.getElementById('sa-aviso-titulo')?.textContent||'Não foi possível buscar as vendas agora.';
      body.appendChild(err);
    }
    // A recarga de 5 min é armada dentro do try: sem isto, falhar na primeira
    // carga deixava a tela sem nunca tentar de novo.
    if(!window._saRefreshTimer)window._saRefreshTimer=setInterval(()=>_saTiqueDaRecarga(),5*60*1000);
  }
}

/* ── Enriquecimento em background (legacy L6426-6506, verbatim) ── */
window._saItemFetchV=0;
async function _saPopulateItemCounts(pedidos,pvQtdMap,pvMap){
  const myV=++window._saItemFetchV;
  const upsert=[];
  for(let i=0;i<Math.min(pedidos.length,200);i++){
    if(window._saItemFetchV!==myV)return;
    const p=pedidos[i];
    if(pvQtdMap[parseInt(p.id)]>1)continue;
    try{
      const resp=await blingCall(`pedidos/vendas/${p.id}`,{});
      const n=resp.data?.itens?.length||1;
      const vid=resp.data?.vendedor?.id;
      pvQtdMap[parseInt(p.id)]=n;
      if(vid)pvMap[parseInt(p.id)]=vid;
      const row={pedido_id:parseInt(p.id),qtd_itens:n};
      if(vid)row.vendor_id=vid;
      // A LOJA VAI JUNTO — ver a mesma nota na Gestão à Vista. É o que permite
      // dizer de qual loja é cada vendedora.
      const lj=resp.data?.loja?.id??p.loja?.id??null;
      if(lj)row.loja_id=lj;
      upsert.push(row);
    }catch(e){}
    if((i+1)%10===0)await new Promise(r=>setTimeout(r,250));
  }
  if(window._saItemFetchV!==myV||!upsert.length)return;
  sbClient.from('bling_pedido_vendedor').upsert(upsert,{onConflict:'pedido_id'}).then(null,()=>{});
  const scr=document.querySelector('.tela-analise-vendas');
  if(scr&&window._saRawData){
    const boxes=[...document.querySelectorAll('.sa-canal-chk')];
    const active=boxes.filter(cb=>cb.checked).map(cb=>cb.value);
    renderSalesAnalysis(window._saRawData,active);
  }
}

const _SA_DISC_CACHE_KEY='rbv_sa_disc';
function _saGetDiscCache(){try{return JSON.parse(sessionStorage.getItem(_SA_DISC_CACHE_KEY)||'{}');}catch{return {};}}
function _saSaveDiscCache(id,val){try{const c=_saGetDiscCache();c[String(id)]=val;sessionStorage.setItem(_SA_DISC_CACHE_KEY,JSON.stringify(c));}catch{}}

window._saDescFetchV=0;
async function _saPopulateDescontos(pedidos){
  const myV=++window._saDescFetchV;
  const cache=_saGetDiscCache();

  const _rerender=()=>{
    if(window._saDescFetchV!==myV)return;
    const scr=document.querySelector('.tela-analise-vendas');
    if(scr&&window._saRawData){
      const boxes=[...document.querySelectorAll('.sa-canal-chk')];
      const active=boxes.filter(cb=>cb.checked).map(cb=>cb.value);
      renderSalesAnalysis(window._saRawData,active);
    }
  };

  // Apply cached values immediately and re-render
  let hadCache=false;
  pedidos.forEach(p=>{
    if(p._desconto===undefined&&cache[String(p.id)]!==undefined){
      p._desconto={valor:cache[String(p.id)],unidade:'REAL'};
      hadCache=true;
    }
  });
  if(hadCache)_rerender();

  // Fetch uncached orders in parallel batches of 5, single re-render at the end
  const toFetch=pedidos.filter(p=>p._desconto===undefined).slice(0,400);
  const BATCH=5;
  for(let i=0;i<toFetch.length;i+=BATCH){
    if(window._saDescFetchV!==myV)return;
    await Promise.all(toFetch.slice(i,i+BATCH).map(async p=>{
      try{
        const resp=await blingCall(`pedidos/vendas/${p.id}`,{});
        const itens=resp?.data?.itens||[];
        const desconto=itens.reduce((s,it)=>{
          const pct=parseFloat(it.desconto)||0;
          if(!pct)return s;
          return s+parseFloat(it.valor||0)*parseFloat(it.quantidade||1)*pct/100;
        },0);
        p._desconto={valor:desconto,unidade:'REAL'};
        _saSaveDiscCache(p.id,desconto);
      }catch(e){p._desconto={valor:0,unidade:'REAL'};}
    }));
    if(i+BATCH<toFetch.length)await new Promise(r=>setTimeout(r,150));
  }
  _rerender();
}

/* ── Render principal + sub-seções (legacy L6508-7141, verbatim) ── */
function renderSalesAnalysis(raw,lojaFilter){
  const{pedidos:allPedidos,pedidosPrev:allPrev,lojaMap,lojas,metasArr,vendedoresArr,pvMap,pvQtdMap,pedidos15,period,di,df,diPrev,dfPrev,di15,df15,now,y,m}=raw;
  const filterIds=Array.isArray(lojaFilter)?lojaFilter:(lojaFilter?[String(lojaFilter)]:[]);
  const pedidos=allPedidos.filter(p=>filterIds.includes(String(p.loja?.id)));
  const pedidosPrev=allPrev.filter(p=>filterIds.includes(String(p.loja?.id)));
  const lojasFiltradas=lojas.filter(l=>filterIds.includes(String(l.id)));

  if(window._saCharts){Object.values(window._saCharts).forEach(c=>{try{c.destroy();}catch(e){}});window._saCharts={};}
  window._saTvF=document.body.classList.contains('dev-tv')?1.6:1;
  if(window._saLabelColor)Chart.defaults.color=window._saLabelColor();

  const body=document.getElementById('sa-body');
  body.textContent='';

  const diasMes=new Date(y,m,0).getDate();
  const dInicio=new Date(di+'T00:00:00');
  const dFim=new Date(df+'T00:00:00');
  const diasTot=Math.ceil((dFim-dInicio)/864e5)+1;
  const diasDec=Math.min(Math.ceil((now-dInicio)/864e5)+1,diasTot);

  const metasMap={};const dailyGoalsMap={};
  metasArr.forEach(r=>{
    if(!filterIds.length||filterIds.includes(String(r.loja_id))||r.loja_id===0){
      metasMap[r.loja_id]=parseFloat(r.meta_valor||0);
      if(r.daily_goals)dailyGoalsMap[r.loja_id]=r.daily_goals;
    }
  });
  const metaTotal=filterIds.length===1
    ?(metasMap[parseInt(filterIds[0])]||0)
    :(metasMap[0]>0?metasMap[0]:Object.entries(metasMap).filter(([k])=>k!=='0').reduce((s,[,v])=>s+v,0))||0;

  const calcMetaPeriodo=(lojaId)=>{
    let dg=lojaId===0?null:dailyGoalsMap[lojaId];
    if(lojaId===0){const mg={};Object.values(dailyGoalsMap).forEach(g=>{if(g)Object.entries(g).forEach(([d,v])=>mg[d]=(mg[d]||0)+Number(v||0));});if(Object.keys(mg).length)dg=mg;}
    if(dg&&di.slice(0,7)===df.slice(0,7)){const d1=parseInt(di.slice(8)),d2=parseInt(df.slice(8));let s=0;for(let d=d1;d<=d2;d++)s+=Number(dg[String(d)]||0);if(s>0)return s;}
    return lojaId===0?metaTotal/diasMes*diasTot:(metasMap[lojaId]||0)/diasMes*diasTot;
  };

  const metaPeriodo=calcMetaPeriodo(0);

  body.appendChild(renderSAKpis({pedidos,pedidosPrev,metaPeriodo,diasMes,diasTot,diasDec,now,y,m,dailyGoalsMap,metasMap,period,pvQtdMap}));
  body.appendChild(renderSACanal({pedidos,pedidosPrev,lojas:lojasFiltradas,lojaMap,metasMap,dailyGoalsMap,di,df,diasMes,diasTot}));
  body.appendChild(renderSADiario({pedidos,di,df,diasTot,dailyGoalsMap,metaTotal,diasMes}));
  body.appendChild(renderSATicket({pedidos,pedidosPrev,lojas:lojasFiltradas,lojaMap}));
  body.appendChild(renderSADesconto({pedidos,lojas:lojasFiltradas,lojaMap,di,df}));
  body.appendChild(renderSAVendedoras({pedidos,pedidosPrev,vendedoresArr,pvMap,pvQtdMap,lojaMap}));
  lojasFiltradas.forEach(loja=>{
    body.appendChild(renderSALojaSection({loja,pedidos:allPedidos,pedidosPrev:allPrev,vendedoresArr,pvMap,metasArr,now,y,m,pedidos15,di15,df15,diasTot,diasMes}));
  });
}

function renderSAKpis({pedidos,pedidosPrev,metaPeriodo,diasMes,diasTot,diasDec,now,y,m,dailyGoalsMap,metasMap,period,pvQtdMap}){
  const total=pedidos.reduce((s,p)=>s+parseFloat(p.total||0),0);
  const totalPrev=pedidosPrev.reduce((s,p)=>s+parseFloat(p.total||0),0);
  const n=pedidos.length;
  const qtd=pvQtdMap||{};
  const getQtd=p=>{const n=p.itens?.length;if(n>0)return n;const sv=qtd[parseInt(p.id)];return(sv&&sv>1)?sv:1;};
  const totalItens=pedidos.reduce((s,p)=>s+getQtd(p),0);
  const multiItem=pedidos.filter(p=>getQtd(p)>=2).length;
  const pct=metaPeriodo>0?total/metaPeriodo*100:null;
  const proj=diasDec>0?(total/diasDec)*diasTot:0;
  const hojeDayNum=now.getDate();
  const pad2=n=>String(n).padStart(2,'0');
  const hoje=`${y}-${pad2(m)}-${pad2(hojeDayNum)}`;
  let metaHoje=0;let hasDaily=false;
  Object.values(dailyGoalsMap).forEach(dg=>{if(dg&&dg[String(hojeDayNum)]!=null){metaHoje+=Number(dg[String(hojeDayNum)]||0);hasDaily=true;}});
  if(!hasDaily&&metaPeriodo>0)metaHoje=metaPeriodo/diasTot;
  const vendidoHoje=pedidos.filter(p=>p.data?.slice(0,10)===hoje).reduce((s,p)=>s+parseFloat(p.total||0),0);
  const faltanteHoje=metaHoje-vendidoHoje;

  const pctCls=pct===null?'':(pct>=100?'good':pct>=85?'warn':'bad');
  const desvioMeta=metaPeriodo>0?total-metaPeriodo:null;
  const deltaTotal=totalPrev>0?(total-totalPrev)/totalPrev*100:null;
  const pctPrev=metaPeriodo>0&&totalPrev>0?totalPrev/metaPeriodo*100:null;
  const mediaItens=n>0?totalItens/n:0;
  const mediaItensPrev=pedidosPrev.length>0?pedidosPrev.reduce((s,p)=>s+getQtd(p),0)/pedidosPrev.length:0;
  const multiPct=n>0?multiItem/n*100:0;
  const multiPrev=pedidosPrev.length>0?pedidosPrev.filter(p=>getQtd(p)>=2).length/pedidosPrev.length*100:0;

  const sec=document.createElement('div');sec.className='sa-kpis';

  const kpis=[
    {
      label:'Venda Realizada',val:fmtR(total),
      sub:desvioMeta!=null?`Meta: ${desvioMeta>=0?'+':''}${fmtR(desvioMeta)}`:null,subCls:desvioMeta!=null?(desvioMeta>=0?'good':'bad'):null,
      delta:deltaTotal!=null?`${deltaTotal>=0?'+':''}${deltaTotal.toFixed(1)}% vs ant. (${fmtR(total-totalPrev)})`:null,cls:deltaTotal!=null?(deltaTotal>=0?'good':'bad'):null
    },
    {
      label:'Meta Período',val:metaPeriodo>0?fmtR(metaPeriodo):'—',
      sub:metaPeriodo>0?`Realiz.: ${pct!=null?pct.toFixed(1)+'%':'—'}`:null,subCls:pctCls,
      delta:desvioMeta!=null?(desvioMeta>=0?`↑ Superado em ${fmtR(desvioMeta)}`:`↓ Faltam ${fmtR(Math.abs(desvioMeta))}`):null,cls:desvioMeta!=null?(desvioMeta>=0?'good':'bad'):null
    },
    {
      label:'% Atingido',val:pct!=null?pct.toFixed(1)+'%':'—',
      sub:pctPrev!=null?`Ant.: ${pctPrev.toFixed(1)}%`:null,subCls:null,
      delta:pct!=null&&pctPrev!=null?`${(pct-pctPrev)>=0?'+':''}${(pct-pctPrev).toFixed(1)}pp vs ant.`:null,cls:pctCls
    },
    {
      label:'Projeção Mês',val:fmtR(proj),
      sub:metaPeriodo>0?`Meta: ${fmtR(metaPeriodo)}`:null,subCls:null,
      delta:metaPeriodo>0?`${proj>=metaPeriodo?'+':''}${((proj/metaPeriodo-1)*100).toFixed(1)}% vs meta (${fmtR(proj-metaPeriodo)})`:null,cls:metaPeriodo>0?(proj>=metaPeriodo?'good':'bad'):null
    },
    {
      label:'Meta Hoje',val:fmtR(metaHoje),
      sub:`Vendido: ${fmtR(vendidoHoje)}`,subCls:faltanteHoje<=0?'good':'bad',
      delta:metaHoje>0?(faltanteHoje<=0?`✓ Atingido (+${fmtR(Math.abs(faltanteHoje))})`:`Faltam ${fmtR(faltanteHoje)}`):null,cls:faltanteHoje<=0?'good':'bad'
    },
    {
      label:'Média Itens/Venda',val:mediaItens.toFixed(2)+' itens',
      sub:mediaItensPrev>0?`Ant.: ${mediaItensPrev.toFixed(2)} itens`:null,subCls:null,
      delta:mediaItensPrev>0?`${(mediaItens-mediaItensPrev)>=0?'+':''}${((mediaItens-mediaItensPrev)/mediaItensPrev*100).toFixed(1)}% vs ant.`:null,cls:mediaItensPrev>0?(mediaItens>=mediaItensPrev?'good':'bad'):null
    },
    {
      label:'Vendas +1 Item',val:multiPct.toFixed(1)+'%',
      sub:multiPrev>0?`Ant.: ${multiPrev.toFixed(1)}%`:null,subCls:null,
      delta:multiPrev>0?`${(multiPct-multiPrev)>=0?'+':''}${(multiPct-multiPrev).toFixed(1)}pp vs ant.`:null,cls:multiPrev>0?(multiPct>=multiPrev?'good':'bad'):null
    }
  ];

  kpis.forEach(k=>{
    const card=document.createElement('div');card.className='sa-kpi';
    const borderColor=k.cls==='good'?'var(--green)':k.cls==='warn'?'var(--orange)':k.cls==='bad'?'var(--red)':'var(--border)';
    card.style.borderLeft=`3px solid ${borderColor}`;
    const lbl=document.createElement('div');lbl.className='sa-kpi-label';lbl.textContent=k.label;
    const val=document.createElement('div');val.className='sa-kpi-val';val.textContent=k.val;
    card.appendChild(lbl);card.appendChild(val);
    if(k.sub){const s=document.createElement('div');s.className=k.subCls?'sa-kpi-delta '+k.subCls:'sa-kpi-sub';s.textContent=k.sub;card.appendChild(s);}
    if(k.delta){const d=document.createElement('div');d.className='sa-kpi-delta'+(k.cls?' '+k.cls:'');d.textContent=k.delta;card.appendChild(d);}
    sec.appendChild(card);
  });
  return sec;
}

function renderSACanal({pedidos,pedidosPrev,lojas,lojaMap,metasMap,dailyGoalsMap,di,df,diasMes,diasTot}){
  const sec=document.createElement('div');sec.className='sa-section';
  const title=document.createElement('div');title.className='sa-section-title';title.textContent='Desdobramento por Canal';
  const wrap=document.createElement('div');wrap.className='sa-chart-wrap';
  const canvas=document.createElement('canvas');wrap.appendChild(canvas);
  sec.appendChild(title);sec.appendChild(wrap);

  const labels=lojas.map(l=>l.nome);
  const realizado=lojas.map(l=>pedidos.filter(p=>String(p.loja?.id)===String(l.id)).reduce((s,p)=>s+parseFloat(p.total||0),0));
  const anterior=lojas.map(l=>pedidosPrev.filter(p=>String(p.loja?.id)===String(l.id)).reduce((s,p)=>s+parseFloat(p.total||0),0));
  const meta=lojas.map(l=>{
    const dg=dailyGoalsMap[l.id];
    if(dg&&di.slice(0,7)===df.slice(0,7)){const d1=parseInt(di.slice(8)),d2=parseInt(df.slice(8));let s=0;for(let d=d1;d<=d2;d++)s+=Number(dg[String(d)]||0);if(s>0)return s;}
    return(metasMap[l.id]||0)/diasMes*diasTot;
  });

  const desvio=realizado.map((r,i)=>Math.max(0,meta[i]-r));
  const clrReal='rgba(79,124,255,0.9)';
  const clrMeta='rgba(249,115,22,0.88)';
  const clrDesvio='rgba(249,115,22,0.22)';
  const tc=window._saLabelColor?.()||'#333';

  window._saCharts=window._saCharts||{};
  window._saCharts.canal=new Chart(canvas,{
    type:'bar',
    data:{
      labels,
      datasets:[
        {label:'Meta',data:meta,backgroundColor:clrMeta,hoverBackgroundColor:'rgba(249,115,22,1)',borderRadius:6,borderSkipped:false,stack:'meta'},
        {label:'Realizado',data:realizado,backgroundColor:clrReal,hoverBackgroundColor:'rgba(79,124,255,1)',borderRadius:{topLeft:0,topRight:0,bottomLeft:6,bottomRight:6},borderSkipped:false,stack:'prog'},
        {label:'Desvio',data:desvio,backgroundColor:clrDesvio,borderColor:'rgba(249,115,22,0.5)',borderWidth:1,borderRadius:{topLeft:6,topRight:6,bottomLeft:0,bottomRight:0},borderSkipped:false,stack:'prog'}
      ]
    },
    options:{
      responsive:true,maintainAspectRatio:false,
      animation:{delay:ctx=>ctx.dataIndex*60},
      plugins:{
        legend:{position:'bottom',labels:{boxWidth:10,usePointStyle:true,pointStyle:'circle',font:{size:_saFsz(11)},padding:16,color:tc}},
        tooltip:{mode:'index',intersect:false,backgroundColor:'rgba(10,10,20,0.92)',titleColor:'#fff',bodyColor:'rgba(255,255,255,0.85)',titleFont:{size:_saFsz(12),weight:'700'},bodyFont:{size:_saFsz(11)},padding:12,cornerRadius:8,borderWidth:1,callbacks:{
          title:ctx=>labels[ctx[0].dataIndex],
          label:ctx=>{
            const i=ctx.dataIndex;const r=realizado[i],mt=meta[i],ant=anterior[i];
            if(ctx.datasetIndex===0)return` Meta: ${fmtR(mt)}`;
            if(ctx.datasetIndex===1){const dev=r-mt;const pct=mt>0?((r/mt-1)*100).toFixed(1)+'%':'—';return[` Realizado: ${fmtR(r)}`,` vs Meta: ${dev>=0?'▲ +':'▼ '}${fmtR(Math.abs(dev))} (${pct})`,` vs Anterior: ${r>=ant?'▲ +':'▼ '}${fmtR(Math.abs(r-ant))} (${ant>0?((r/ant-1)*100).toFixed(1)+'%':'—'})`];}
            if(ctx.datasetIndex===2)return desvio[i]>0?` A completar: ${fmtR(desvio[i])}`:` ✓ Meta atingida`;
            return null;
          },
          labelTextColor:ctx=>{
            const i=ctx.dataIndex;const r=realizado[i],mt=meta[i];
            if(ctx.datasetIndex===1)return r>=mt?'#4ade80':'rgba(255,255,255,0.85)';
            if(ctx.datasetIndex===2)return desvio[i]>0?'#fca5a5':'#4ade80';
            return 'rgba(255,255,255,0.85)';
          },
        }},
        datalabels:{
          display:ctx=>ctx.dataset.data[ctx.dataIndex]>0,
          anchor:'center',align:'center',
          formatter:v=>fmtR0(v),
          font:{size:_saFsz(9),weight:'700'},
          color:ctx=>ctx.datasetIndex===2?tc:'#fff',
          padding:2
        }
      },
      scales:{
        y:{stacked:true,ticks:{callback:v=>fmtR0(v),font:{size:_saFsz(10)},color:tc},grid:{color:'rgba(128,128,128,0.07)'},border:{dash:[4,4]}},
        x:{stacked:true,grid:{display:false},ticks:{font:{size:_saFsz(11)},color:tc}}
      },
      barPercentage:0.88,categoryPercentage:0.65
    }
  });
  return sec;
}

function renderSADiario({pedidos,di,df,diasTot,dailyGoalsMap,metaTotal,diasMes}){
  const sec=document.createElement('div');sec.className='sa-section';
  const title=document.createElement('div');title.className='sa-section-title';title.textContent='Visão Diária';
  const wrap=document.createElement('div');wrap.className='sa-chart-wrap';
  const canvas=document.createElement('canvas');wrap.appendChild(canvas);
  sec.appendChild(title);sec.appendChild(wrap);

  const dates=[];const d=new Date(di+'T00:00:00');const end=new Date(df+'T00:00:00');
  while(d<=end){dates.push(d.toISOString().slice(0,10));d.setDate(d.getDate()+1);}

  const vendido=dates.map(dt=>pedidos.filter(p=>p.data?.slice(0,10)===dt).reduce((s,p)=>s+parseFloat(p.total||0),0));
  const metaDia=dates.map(dt=>{
    const dayNum=parseInt(dt.slice(8));
    let s=0;let has=false;
    Object.values(dailyGoalsMap).forEach(dg=>{if(dg&&dg[String(dayNum)]!=null){s+=Number(dg[String(dayNum)]||0);has=true;}});
    return has?s:(metaTotal>0?metaTotal/diasMes:null);
  });

  const labels=dates.map(dt=>dt.slice(8)+'/'+dt.slice(5,7));
  const tc=window._saLabelColor?.()||'#333';
  window._saCharts=window._saCharts||{};
  window._saCharts.diario=new Chart(canvas,{
    type:'line',
    data:{
      labels,
      datasets:[
        {label:'Vendido',data:vendido,borderColor:'rgba(99,102,241,1)',borderWidth:2.5,backgroundColor:'rgba(99,102,241,0.12)',fill:true,tension:0.4,pointRadius:4,pointHoverRadius:7,pointBackgroundColor:'rgba(99,102,241,1)',pointHoverBackgroundColor:'#fff',pointHoverBorderColor:'rgba(99,102,241,1)',pointHoverBorderWidth:2.5},
        {label:'Meta',data:metaDia,borderColor:'rgba(160,160,180,0.55)',borderDash:[6,4],borderWidth:1.5,fill:false,tension:0.4,pointRadius:0,pointHoverRadius:4}
      ]
    },
    options:{
      responsive:true,maintainAspectRatio:false,
      animation:{duration:900,easing:'easeOutCubic'},
      plugins:{legend:{position:'bottom',labels:{boxWidth:10,usePointStyle:true,pointStyle:'circle',font:{size:_saFsz(11)},padding:16,color:tc}},tooltip:{mode:'index',intersect:false,backgroundColor:'rgba(10,10,20,0.88)',titleColor:'#fff',bodyColor:'rgba(255,255,255,0.85)',titleFont:{size:_saFsz(12),weight:'700'},bodyFont:{size:_saFsz(11)},padding:12,cornerRadius:8,callbacks:{label:ctx=>{const i=ctx.dataIndex;const v=vendido[i],mt=metaDia[i];if(ctx.datasetIndex===0){const dev=mt!=null?v-mt:null;const pct=mt!=null&&mt>0?((v/mt-1)*100).toFixed(1)+'%':'—';return[` Vendido: ${fmtR(v)}`,dev!=null?` vs Meta: ${dev>=0?'+':''}${fmtR(dev)} (${pct})`:''];}if(ctx.datasetIndex===1)return mt!=null?` Meta: ${fmtR(mt)}`:'Meta: —';return null;},labelTextColor:ctx=>{const i=ctx.dataIndex;const v=vendido[i],mt=metaDia[i];if(ctx.datasetIndex===0)return(mt==null||v>=mt)?'#4ade80':'#fca5a5';return 'rgba(255,255,255,0.85)';}}},datalabels:{display:ctx=>ctx.datasetIndex===0&&ctx.dataset.data[ctx.dataIndex]>0,anchor:'end',align:'top',formatter:v=>fmtR0(v),font:{size:_saFsz(10),weight:'700'},color:tc,padding:{bottom:2}}},
      scales:{y:{ticks:{callback:v=>fmtR0(v),font:{size:_saFsz(10)},color:tc},grid:{color:'rgba(128,128,128,0.07)'},border:{dash:[4,4]}},x:{grid:{display:false},ticks:{maxRotation:45,font:{size:_saFsz(10)},color:tc}}}
    }
  });
  return sec;
}

function renderSATicket({pedidos,pedidosPrev,lojas,lojaMap}){
  const sec=document.createElement('div');sec.className='sa-section';
  const title=document.createElement('div');title.className='sa-section-title';title.textContent='Comparativo de Ticket Médio';
  const wrap=document.createElement('div');wrap.className='sa-chart-wrap';
  const canvas=document.createElement('canvas');wrap.appendChild(canvas);
  sec.appendChild(title);sec.appendChild(wrap);

  const labels=lojas.map(l=>l.nome);
  const ticketAtual=lojas.map(l=>{const pp=pedidos.filter(p=>String(p.loja?.id)===String(l.id));return pp.length>0?pp.reduce((s,p)=>s+parseFloat(p.total||0),0)/pp.length:0;});
  const ticketAnt=lojas.map(l=>{const pp=pedidosPrev.filter(p=>String(p.loja?.id)===String(l.id));return pp.length>0?pp.reduce((s,p)=>s+parseFloat(p.total||0),0)/pp.length:0;});
  const tc=window._saLabelColor?.()||'#333';

  window._saCharts=window._saCharts||{};
  window._saCharts.ticket=new Chart(canvas,{
    type:'bar',
    data:{labels,datasets:[
      {label:'Atual',data:ticketAtual,backgroundColor:'rgba(99,102,241,0.85)',hoverBackgroundColor:'rgba(99,102,241,1)',borderRadius:7,borderSkipped:false},
      {label:'Anterior',data:ticketAnt,backgroundColor:'rgba(99,102,241,0.22)',hoverBackgroundColor:'rgba(99,102,241,0.4)',borderRadius:7,borderSkipped:false}
    ]},
    options:{
      responsive:true,maintainAspectRatio:false,
      animation:{delay:ctx=>ctx.dataIndex*60},
      plugins:{legend:{position:'bottom',labels:{boxWidth:10,usePointStyle:true,pointStyle:'circle',font:{size:_saFsz(11)},padding:16,color:tc}},tooltip:{mode:'index',intersect:false,backgroundColor:'rgba(10,10,20,0.88)',titleColor:'#fff',bodyColor:'rgba(255,255,255,0.85)',titleFont:{size:_saFsz(12),weight:'700'},bodyFont:{size:_saFsz(11)},padding:12,cornerRadius:8,callbacks:{label:ctx=>{const i=ctx.dataIndex;const ta=ticketAtual[i],tb=ticketAnt[i];if(ctx.datasetIndex===0){const d=ta-tb;const p=tb>0?((ta/tb-1)*100).toFixed(1)+'%':'—';return[` Ticket atual: ${fmtR(ta)}`,` vs Anterior: ${d>=0?'+':''}${fmtR(d)} (${p})`];}if(ctx.datasetIndex===1)return` Anterior: ${fmtR(tb)}`;return null;},labelTextColor:ctx=>{const i=ctx.dataIndex;if(ctx.datasetIndex===0)return ticketAtual[i]>=ticketAnt[i]?'#4ade80':'#fca5a5';return 'rgba(255,255,255,0.85)';}}},datalabels:{display:ctx=>ctx.dataset.data[ctx.dataIndex]>0,anchor:'end',align:'end',formatter:v=>fmtR0(v),font:{size:_saFsz(10),weight:'700'},color:ctx=>ctx.datasetIndex===0?tc:'rgba(128,128,128,0.7)',padding:{bottom:2}}},
      scales:{y:{ticks:{callback:v=>fmtR0(v),font:{size:_saFsz(10)},color:tc},grid:{color:'rgba(128,128,128,0.07)'},border:{dash:[4,4]}},x:{grid:{display:false},ticks:{color:tc}}},
      barPercentage:0.7,categoryPercentage:0.8
    }
  });
  return sec;
}

function renderSADesconto({pedidos,lojas,lojaMap,di,df}){
  const sec=document.createElement('div');sec.className='sa-section';
  const title=document.createElement('div');title.className='sa-section-title';title.textContent='Vendas com vs Sem Desconto';
  sec.appendChild(title);

  const tc=window._saLabelColor?.()||'#333';
  const getDescVal=p=>{const d=p._desconto;if(d&&typeof d==='object')return parseFloat(d.valor||0);return 0;};
  const calcDescPedido=p=>getDescVal(p);
  const comDesc=pedidos.filter(p=>getDescVal(p)>0);
  const semDesc=pedidos.filter(p=>getDescVal(p)<=0);
  const totalCom=comDesc.reduce((s,p)=>s+parseFloat(p.total||0),0);
  const totalSem=semDesc.reduce((s,p)=>s+parseFloat(p.total||0),0);
  const totalDescCom=comDesc.reduce((s,p)=>s+calcDescPedido(p),0);
  const tot=pedidos.length;
  const pctCom=tot>0?(comDesc.length/tot*100).toFixed(1):'0';
  const pctSem=tot>0?(semDesc.length/tot*100).toFixed(1):'0';

  // Stat boxes — always visible at a glance
  const stats=document.createElement('div');
  stats.style.cssText='display:flex;gap:10px;margin-bottom:12px;flex-wrap:wrap';
  const mkStat=(label,val1,val2,color)=>{
    const b=document.createElement('div');
    b.style.cssText=`flex:1;min-width:150px;background:var(--card);border:1px solid var(--border);border-left:3px solid ${color};border-radius:8px;padding:10px 14px`;
    b.innerHTML=`<div style="font-size:max(9px, calc(9px * var(--escala-texto, 1)));letter-spacing:1.5px;text-transform:uppercase;color:var(--muted);margin-bottom:4px">${label}</div><div style="font-size:max(16px, calc(18px * var(--escala-texto, 1)));font-weight:700;font-family:var(--fonte-dados);color:var(--text);letter-spacing:1px">${val1}</div>${val2?`<div style="font-size:max(9px, calc(10px * var(--escala-texto, 1)));color:var(--muted);margin-top:2px">${val2}</div>`:''}`;
    return b;
  };
  stats.appendChild(mkStat('Com Desconto',fmtR(totalCom),`${comDesc.length} pedidos · ${pctCom}%`,'rgba(239,68,68,0.8)'));
  stats.appendChild(mkStat('Sem Desconto',fmtR(totalSem),`${semDesc.length} pedidos · ${pctSem}%`,'rgba(34,197,94,0.8)'));
  stats.appendChild(mkStat('Total Descontos Aplicados',fmtR(totalDescCom),`Média: ${comDesc.length>0?fmtR(totalDescCom/comDesc.length):fmtR(0)} por pedido`,'rgba(251,191,36,0.8)'));
  sec.appendChild(stats);

  const row=document.createElement('div');row.className='sa-chart-row';
  row.style.cssText='display:flex;gap:12px;align-items:stretch';
  const _tvH=Math.round(200*(window._saTvF||1));
  const wrapD=document.createElement('div');wrapD.className='sa-chart-wrap';wrapD.style.cssText=`flex:0 0 30%;min-width:${Math.round(160*(window._saTvF||1))}px;height:${_tvH}px`;
  const canvasD=document.createElement('canvas');wrapD.appendChild(canvasD);
  const wrapB=document.createElement('div');wrapB.className='sa-chart-wrap';wrapB.style.cssText=`flex:1 1 0;height:${_tvH}px`;
  const canvasB=document.createElement('canvas');wrapB.appendChild(canvasB);
  row.appendChild(wrapD);row.appendChild(wrapB);
  sec.appendChild(row);

  window._saCharts=window._saCharts||{};
  window._saCharts.descontoDonut=new Chart(canvasD,{
    type:'doughnut',
    data:{labels:['Com Desconto','Sem Desconto'],datasets:[{data:[comDesc.length,semDesc.length],backgroundColor:['rgba(239,68,68,0.85)','rgba(34,197,94,0.85)'],hoverBackgroundColor:['rgba(239,68,68,1)','rgba(34,197,94,1)'],hoverOffset:6,borderWidth:0}]},
    options:{responsive:true,maintainAspectRatio:false,cutout:'62%',animation:{animateRotate:true,animateScale:true,duration:900,easing:'easeOutQuart'},plugins:{legend:{position:'bottom',labels:{boxWidth:10,usePointStyle:true,pointStyle:'circle',font:{size:_saFsz(11)},padding:16,color:tc}},tooltip:{backgroundColor:'rgba(10,10,20,0.88)',titleColor:'#fff',bodyColor:'rgba(255,255,255,0.85)',titleFont:{size:_saFsz(12),weight:'700'},bodyFont:{size:_saFsz(11)},padding:12,cornerRadius:8,callbacks:{label:ctx=>{const n=ctx.raw;const tot=pedidos.length;const val=ctx.dataIndex===0?totalCom:totalSem;const pct=tot>0?(n/tot*100).toFixed(1):'0';const lines=[` ${n} pedidos — ${pct}% dos cupons`,` Faturamento: ${fmtR(val)}`];if(ctx.dataIndex===0&&totalDescCom>0)lines.push(` Desconto aplicado: ${fmtR(totalDescCom)}`);return lines;}}},datalabels:{display:ctx=>ctx.dataset.data[ctx.dataIndex]>0,formatter:(v,ctx)=>{const data=ctx.chart.data.datasets[0].data;const tot=data.reduce((a,b)=>a+b,0);return tot>0?(v/tot*100).toFixed(1)+'%':'';},color:tc,font:{size:_saFsz(12),weight:'700',family:"'Sora',sans-serif"}}}}
  });

  const dias=[];{const d=new Date(di+'T00:00:00');const end=new Date(df+'T00:00:00');while(d<=end){dias.push(d.toISOString().slice(0,10));d.setDate(d.getDate()+1);}}
  const labelsB=dias.map(dt=>{const d=new Date(dt+'T12:00:00');return String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0');});
  const comB=dias.map(dt=>pedidos.filter(p=>p.data?.slice(0,10)===dt&&getDescVal(p)>0).reduce((s,p)=>s+parseFloat(p.total||0),0));
  const semB=dias.map(dt=>pedidos.filter(p=>p.data?.slice(0,10)===dt&&getDescVal(p)<=0).reduce((s,p)=>s+parseFloat(p.total||0),0));
  const descValorB=dias.map(dt=>pedidos.filter(p=>p.data?.slice(0,10)===dt).reduce((s,p)=>s+calcDescPedido(p),0));

  const _descBarPlugin={
    id:'sa-desc-callout',
    afterDatasetsDraw(chart){
      const ctx=chart.ctx;
      const meta=chart.getDatasetMeta(1);
      ctx.save();
      ctx.textAlign='center';
      ctx.textBaseline='bottom';
      ctx.font=`700 ${_saFsz(9)}px 'Sora',sans-serif`;
      meta.data.forEach((bar,i)=>{
        const tot=comB[i]+semB[i];
        if(!tot)return;
        const x=bar.x;
        const barTop=Math.min(bar.y,chart.chartArea.bottom);
        const isHigh=i%2===1;
        const textY=isHigh?barTop-30:barTop-7;
        if(isHigh){
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(x,barTop-3);
          ctx.lineTo(x,textY+3);
          ctx.strokeStyle=tc;
          ctx.globalAlpha=0.45;
          ctx.lineWidth=1;
          ctx.setLineDash([2,3]);
          ctx.stroke();
          ctx.restore();
        }
        ctx.fillStyle=tc;
        ctx.fillText(fmtR0(tot),x,textY);
      });
      ctx.restore();
    }
  };
  window._saCharts.descontoBar=new Chart(canvasB,{
    type:'bar',
    plugins:[_descBarPlugin],
    data:{labels:labelsB,datasets:[
      {label:'Com Desconto',data:comB,backgroundColor:'rgba(239,68,68,0.8)',hoverBackgroundColor:'rgba(239,68,68,1)',borderRadius:{topLeft:0,topRight:0,bottomLeft:4,bottomRight:4},borderSkipped:false},
      {label:'Sem Desconto',data:semB,backgroundColor:'rgba(34,197,94,0.8)',hoverBackgroundColor:'rgba(34,197,94,1)',borderRadius:{topLeft:4,topRight:4,bottomLeft:0,bottomRight:0},borderSkipped:false}
    ]},
    options:{
      responsive:true,maintainAspectRatio:false,
      layout:{padding:{top:42}},
      animation:{delay:ctx=>ctx.dataIndex*30},
      plugins:{legend:{position:'bottom',labels:{boxWidth:10,usePointStyle:true,pointStyle:'circle',font:{size:_saFsz(11)},padding:16,color:tc}},tooltip:{mode:'index',intersect:false,backgroundColor:'rgba(10,10,20,0.88)',titleColor:'#fff',bodyColor:'rgba(255,255,255,0.85)',titleFont:{size:_saFsz(12),weight:'700'},bodyFont:{size:_saFsz(11)},padding:12,cornerRadius:8,callbacks:{title:ctx=>labelsB[ctx[0].dataIndex],label:ctx=>{const i=ctx.dataIndex;const tot=comB[i]+semB[i];if(ctx.datasetIndex===0){const lines=[` Com desconto: ${fmtR(comB[i])}`,` (${tot>0?(comB[i]/tot*100).toFixed(1):'0'}% do dia)`];if(descValorB[i]>0)lines.push(` Desconto aplicado: ${fmtR(descValorB[i])}`);return lines;}if(ctx.datasetIndex===1)return[` Sem desconto: ${fmtR(semB[i])}`,` Total dia: ${fmtR(tot)}`];return null;}}},datalabels:{display:false}},
      scales:{x:{stacked:true,grid:{display:false},ticks:{font:{size:_saFsz(10)},maxRotation:0,color:tc}},y:{stacked:true,ticks:{callback:v=>fmtR0(v),font:{size:_saFsz(10)},color:tc},grid:{color:'rgba(128,128,128,0.07)'},border:{dash:[4,4]}}},
      barPercentage:0.85
    }
  });
  return sec;
}

function renderSAVendedoras({pedidos,pedidosPrev,vendedoresArr,pvMap,pvQtdMap,lojaMap}){
  const sec=document.createElement('div');sec.className='sa-section';
  const title=document.createElement('div');title.className='sa-section-title';title.textContent='Vendedoras';
  sec.appendChild(title);

  const tabs=['Vendas (R$)','Qtd Cupons','Ticket Médio','% 2+ Itens','% Desconto'];
  const tabRow=document.createElement('div');tabRow.className='sa-tab-row';
  const wrap=document.createElement('div');wrap.className='sa-chart-wrap';wrap.style.height='260px';
  const canvas=document.createElement('canvas');wrap.appendChild(canvas);
  sec.appendChild(tabRow);sec.appendChild(wrap);

  const stats={};
  vendedoresArr.forEach(v=>{stats[v.vendor_id]={nome:v.nome,vendas:0,cupons:0,itens:0,desc:0};});
  pedidos.forEach(p=>{
    const vid=pvMap[parseInt(p.id)];if(!vid)return;
    if(!stats[vid])stats[vid]={nome:'ID '+vid,vendas:0,cupons:0,itens:0,desc:0};
    const s=stats[vid];
    s.vendas+=parseFloat(p.total||0);
    s.cupons++;
    s.itens+=(()=>{const n=p.itens?.length;if(n>0)return n;const sv=pvQtdMap?.[parseInt(p.id)];return(sv&&sv>1)?sv:1;})();
    if(parseFloat(p._desconto?.valor||0)>0)s.desc++;
  });

  const vends=Object.entries(stats).filter(([,s])=>s.cupons>0).sort((a,b)=>b[1].vendas-a[1].vendas).map(([id,s])=>({
    id,nome:s.nome,vendas:s.vendas,cupons:s.cupons,
    ticket:s.cupons>0?s.vendas/s.cupons:0,
    multi:s.cupons>0?pedidos.filter(p=>pvMap[parseInt(p.id)]==id&&(()=>{const n=p.itens?.length;if(n>0)return n;const sv=pvQtdMap?.[parseInt(p.id)];return(sv&&sv>1)?sv:1;})()>=2).length/s.cupons*100:0,
    desc:s.cupons>0?s.desc/s.cupons*100:0
  }));

  const metrics=[
    vends.map(v=>v.vendas),
    vends.map(v=>v.cupons),
    vends.map(v=>v.ticket),
    vends.map(v=>parseFloat(v.multi.toFixed(1))),
    vends.map(v=>parseFloat(v.desc.toFixed(1)))
  ];

  let activeTab=0;
  let chart=null;

  const buildChart=()=>{
    if(chart){try{chart.destroy();}catch(e){}}
    const tc=window._saLabelColor?.()||'#333';
    const sorted=[...vends].sort((a,b)=>metrics[activeTab][vends.indexOf(b)]-metrics[activeTab][vends.indexOf(a)]);
    const sortedData=sorted.map(v=>metrics[activeTab][vends.indexOf(v)]);
    chart=new Chart(canvas,{
      type:'bar',
      data:{labels:sorted.map(v=>v.nome),datasets:[{label:tabs[activeTab],data:sortedData,backgroundColor:'rgba(99,102,241,0.85)',hoverBackgroundColor:'rgba(99,102,241,1)',borderRadius:6,borderSkipped:false}]},
      options:{
        indexAxis:'y',responsive:true,maintainAspectRatio:false,
        animation:{duration:700,easing:'easeOutQuart',delay:ctx=>ctx.dataIndex*40},
        plugins:{
          legend:{display:false},
          tooltip:{mode:'nearest',intersect:false,backgroundColor:'rgba(10,10,20,0.88)',titleColor:'#fff',bodyColor:'rgba(255,255,255,0.85)',titleFont:{size:_saFsz(12),weight:'700'},bodyFont:{size:_saFsz(11)},padding:12,cornerRadius:8,callbacks:{label:ctx=>{const i=ctx.dataIndex;const v=sorted[i];const rankIdx=i+1;return[` #${rankIdx} — ${v.nome}`,` Vendas: ${fmtR(v.vendas)}`,` Cupons: ${v.cupons} | Ticket: ${fmtR(v.ticket)}`,` 2+ itens: ${v.multi.toFixed(1)}% | Desconto: ${v.desc.toFixed(1)}%`];},title:()=>''}},
          datalabels:{display:ctx=>ctx.dataset.data[ctx.dataIndex]>0,anchor:'end',align:'end',formatter:(v)=>activeTab===0||activeTab===2?fmtR0(v):activeTab>=3?v.toFixed(1)+'%':String(Math.round(v)),font:{size:_saFsz(10),weight:'700'},color:tc,padding:{left:4}}
        },
        scales:{x:{ticks:{callback:(val)=>activeTab===0||activeTab===2?fmtR0(val):activeTab>=3?val+'%':String(val),font:{size:_saFsz(10)},color:tc},grid:{color:'rgba(128,128,128,0.07)'},border:{dash:[4,4]}},y:{grid:{display:false},ticks:{font:{size:_saFsz(11)},color:tc}}},
        barPercentage:0.65
      }
    });
    window._saCharts=window._saCharts||{};
    window._saCharts.vendedoras=chart;
  };

  tabs.forEach((t,i)=>{
    const btn=document.createElement('button');btn.className='sa-tab'+(i===0?' active':'');btn.textContent=t;
    btn.addEventListener('click',()=>{activeTab=i;tabRow.querySelectorAll('.sa-tab').forEach((b,j)=>b.classList.toggle('active',j===i));buildChart();});
    tabRow.appendChild(btn);
  });

  buildChart();

  const totalVendas=vends.reduce((s,v)=>s+v.vendas,0);
  const totalCupons=vends.reduce((s,v)=>s+v.cupons,0);
  const ticketGeral=totalCupons>0?totalVendas/totalCupons:0;
  const hasDesc2=p=>parseFloat(p._desconto?.valor||0)>0;
  const getQtd2=p=>{const n=p.itens?.length;if(n>0)return n;const sv=pvQtdMap?.[parseInt(p.id)];return(sv&&sv>1)?sv:1;};
  const pctMulti=pedidos.length>0?pedidos.filter(p=>getQtd2(p)>=2).length/pedidos.length*100:0;
  const pctDesc=pedidos.length>0?pedidos.filter(hasDesc2).length/pedidos.length*100:0;

  const totalVendasPrev=(pedidosPrev||[]).reduce((s,p)=>s+parseFloat(p.total||0),0);
  const totalCuponsPrev=(pedidosPrev||[]).length;
  const ticketGeralPrev=totalCuponsPrev>0?totalVendasPrev/totalCuponsPrev:0;
  const pctMultiPrev=(pedidosPrev||[]).length>0?(pedidosPrev||[]).filter(p=>getQtd2(p)>=2).length/(pedidosPrev||[]).length*100:0;
  const pctDescPrev=(pedidosPrev||[]).length>0?(pedidosPrev||[]).filter(hasDesc2).length/(pedidosPrev||[]).length*100:0;
  const deltaVendas=totalVendasPrev>0?(totalVendas-totalVendasPrev)/totalVendasPrev*100:null;
  const deltaCupons=totalCuponsPrev>0?(totalCupons-totalCuponsPrev)/totalCuponsPrev*100:null;
  const deltaTicket=ticketGeralPrev>0?(ticketGeral-ticketGeralPrev)/ticketGeralPrev*100:null;
  const deltaMulti=pctMultiPrev>0?pctMulti-pctMultiPrev:null;
  const deltaDesc=pctDescPrev>0?pctDesc-pctDescPrev:null;

  const sumCard=document.createElement('div');sumCard.className='sa-summary-card';
  const addSumItem=(lbl,val,delta,isPp)=>{
    const wrap=document.createElement('span');
    const l=document.createElement('span');l.style.fontWeight='400';l.style.color='var(--muted)';l.textContent=lbl+': ';
    const v=document.createElement('span');v.textContent=val;
    wrap.appendChild(l);wrap.appendChild(v);
    if(delta!=null){
      const d=document.createElement('span');
      d.textContent=' ('+(delta>=0?'+':'')+delta.toFixed(1)+(isPp?'pp':'%')+')';
      d.style.color='color-mix(in srgb,'+(delta>=0?'var(--green)':'var(--red)')+' 75%,var(--text))';d.style.fontSize='10px';
      wrap.appendChild(d);
    }
    sumCard.appendChild(wrap);
  };
  addSumItem('Total vendido',fmtR(totalVendas),deltaVendas,false);
  addSumItem('Cupons',String(totalCupons),deltaCupons,false);
  addSumItem('Ticket médio',fmtR(ticketGeral),deltaTicket,false);
  addSumItem('2+ itens',pctMulti.toFixed(1)+'%',deltaMulti,true);
  addSumItem('Com desconto',pctDesc.toFixed(1)+'%',deltaDesc,true);
  sec.appendChild(sumCard);
  return sec;
}

function renderSALojaSection({loja,pedidos,pedidosPrev,vendedoresArr,pvMap,metasArr,now,y,m,pedidos15,di15,df15,diasTot,diasMes}){
  const sec=document.createElement('div');sec.className='sa-section sa-loja-section';
  const t=document.createElement('div');t.className='sa-section-title sa-loja-title';t.textContent=loja.nome;
  sec.appendChild(t);

  const lojaPeds=pedidos.filter(p=>String(p.loja?.id)===String(loja.id));
  const lojaPrevPeds=(pedidosPrev||[]).filter(p=>String(p.loja?.id)===String(loja.id));
  const lojaTotal=lojaPeds.reduce((s,p)=>s+parseFloat(p.total||0),0);
  const lojaTotalPrev=lojaPrevPeds.reduce((s,p)=>s+parseFloat(p.total||0),0);
  const metaLoja=metasArr.find(r=>r.loja_id===loja.id)||null;
  const metaVal=parseFloat(metaLoja?.meta_valor||0);
  const lojaMeta=(diasMes>0&&diasTot>0)?metaVal/diasMes*diasTot:0;
  const lojaDesvioMeta=lojaMeta>0?lojaTotal-lojaMeta:null;
  const lojaDeltaPrev=lojaTotalPrev>0?(lojaTotal-lojaTotalPrev)/lojaTotalPrev*100:null;
  const lojaTicket=lojaPeds.length>0?lojaTotal/lojaPeds.length:0;
  const lojaTicketPrev=lojaPrevPeds.length>0?lojaTotalPrev/lojaPrevPeds.length:0;
  const deltaTicket=lojaTicketPrev>0?(lojaTicket-lojaTicketPrev)/lojaTicketPrev*100:null;

  const strip=document.createElement('div');strip.className='sa-loja-summary';
  const addStripItem=(lbl,val,color)=>{
    const item=document.createElement('div');item.className='sa-loja-summary-item';
    const l=document.createElement('span');l.className='sa-loja-summary-label';l.textContent=lbl;
    const v=document.createElement('span');v.className='sa-loja-summary-val';v.textContent=val;
    if(color)v.style.color='color-mix(in srgb,'+color+' 75%,var(--text))';
    item.appendChild(l);item.appendChild(v);strip.appendChild(item);
  };
  addStripItem('Realizado',fmtR(lojaTotal),null);
  if(lojaMeta>0)addStripItem('Meta Período',fmtR(lojaMeta),null);
  if(lojaDesvioMeta!=null){const clr=lojaDesvioMeta>=0?'var(--green)':'var(--red)';addStripItem('Desvio Meta',(lojaDesvioMeta>=0?'+':'')+fmtR(lojaDesvioMeta)+' ('+(lojaDesvioMeta/lojaMeta*100).toFixed(1)+'%)',clr);}
  if(lojaDeltaPrev!=null){const clr=lojaDeltaPrev>=0?'var(--green)':'var(--red)';addStripItem('vs Anterior',(lojaDeltaPrev>=0?'+':'')+lojaDeltaPrev.toFixed(1)+'% ('+fmtR(lojaTotal-lojaTotalPrev)+')',clr);}
  addStripItem('Cupons',String(lojaPeds.length),null);
  if(lojaTicket>0)addStripItem('Ticket Médio',fmtR(lojaTicket)+(deltaTicket!=null?' ('+(deltaTicket>=0?'+':'')+deltaTicket.toFixed(1)+'%)':''),deltaTicket!=null?(deltaTicket>=0?'var(--green)':'var(--red)'):null);
  sec.appendChild(strip);

  sec.appendChild(renderSALojaTable({loja,pedidos,vendedoresArr,pvMap,metasArr,now,y,m}));
  sec.appendChild(renderSAPositivacao({loja,pedidos15,vendedoresArr,pvMap,di15,df15,now}));
  return sec;
}

function renderSALojaTable({loja,pedidos,vendedoresArr,pvMap,metasArr,now,y,m}){
  // BRT explícito: o toISOString() daqui reconvertia para UTC e somava 3h, então às
  // 22h a coluna "Hoje" zerava para todas as vendedoras e "Ontem" mostrava hoje.
  // (O comentário da linha 307 deste mesmo arquivo já avisava contra isso.)
  const hoje=hojeLocal();
  const ontem=diasAtras(1);
  const diaSem=diasAtras(6);

  const metaLoja=metasArr.find(r=>r.loja_id===loja.id)||null;
  const dg=metaLoja?.daily_goals||null;
  const diasMes=new Date(y,m,0).getDate();
  const metaVal=parseFloat(metaLoja?.meta_valor||0);

  const getMetaDia=(dt)=>{const dn=parseInt(dt.slice(8));return dg&&dg[String(dn)]!=null?Number(dg[String(dn)]):metaVal/diasMes;};
  const getMetaWeek=()=>{if(!dg)return metaVal/diasMes*7;let s=0;for(let i=0;i<7;i++){const d=new Date(now-i*864e5);s+=Number(dg[String(d.getDate())]||metaVal/diasMes);}return s;};
  const metaMes=metaVal;

  const lojaPedidos=pedidos.filter(p=>String(p.loja?.id)===String(loja.id));
  const vendStats=vendedoresArr.map(v=>{
    const vid=v.vendor_id;
    const mine=lojaPedidos.filter(p=>pvMap[parseInt(p.id)]===vid);
    const mHoje=mine.filter(p=>p.data?.slice(0,10)===hoje).reduce((s,p)=>s+parseFloat(p.total||0),0);
    const mOntem=mine.filter(p=>p.data?.slice(0,10)===ontem).reduce((s,p)=>s+parseFloat(p.total||0),0);
    const mSem=mine.filter(p=>p.data?.slice(0,10)>=diaSem).reduce((s,p)=>s+parseFloat(p.total||0),0);
    const mMes=mine.reduce((s,p)=>s+parseFloat(p.total||0),0);
    return{nome:v.nome,mHoje,mOntem,mSem,mMes};
  }).filter(v=>v.mMes>0).sort((a,b)=>b.mMes-a.mMes);

  const metaH=getMetaDia(hoje);
  const metaO=getMetaDia(ontem);
  const metaW=getMetaWeek();
  const nVends=vendStats.length||1;

  // O embrulho ganha CLASSE (era só `style.overflowX`): é por ela que o CSS
  // do celular prende a coluna do nome enquanto o resto rola de lado.
  const wrap=document.createElement('div');wrap.className='sa-loja-tbl-wrap';
  const tbl=document.createElement('table');tbl.className='sa-loja-table';

  const thead=document.createElement('thead');
  const hr=document.createElement('tr');
  ['Vendedora','Hoje Vend.','Hoje Meta','Hoje Falt.','Ontem Vend.','Ontem Meta','Ontem Falt.','Sem. Vend.','Sem. Meta','Sem. Falt.','Mês Vend.','Mês Meta','Mês Falt.'].forEach(h=>{
    const th=document.createElement('th');th.textContent=h;hr.appendChild(th);
  });
  thead.appendChild(hr);tbl.appendChild(thead);

  const tbody=document.createElement('tbody');
  vendStats.forEach(v=>{
    const tr=document.createElement('tr');
    const addCell=(val,diff)=>{
      const td=document.createElement('td');
      td.textContent=fmtR(val);
      if(diff!=null)td.style.color=diff>=0?'var(--green)':'var(--red)';
      tr.appendChild(td);
    };
    const nm=document.createElement('td');nm.textContent=v.nome;tr.appendChild(nm);
    addCell(v.mHoje);addCell(metaH/nVends);addCell(v.mHoje-metaH/nVends,v.mHoje-metaH/nVends);
    addCell(v.mOntem);addCell(metaO/nVends);addCell(v.mOntem-metaO/nVends,v.mOntem-metaO/nVends);
    addCell(v.mSem);addCell(metaW/nVends);addCell(v.mSem-metaW/nVends,v.mSem-metaW/nVends);
    addCell(v.mMes);addCell(metaMes/nVends);addCell(v.mMes-metaMes/nVends,v.mMes-metaMes/nVends);
    tbody.appendChild(tr);
  });
  tbl.appendChild(tbody);
  wrap.appendChild(tbl);
  return wrap;
}

function renderSAPositivacao({loja,pedidos15,vendedoresArr,pvMap,di15,df15,now}){
  const dias=[];const d=new Date(di15+'T00:00:00');const end=new Date(df15+'T00:00:00');
  while(d<=end){dias.push(d.toISOString().slice(0,10));d.setDate(d.getDate()+1);}

  const lojaPed=pedidos15.filter(p=>String(p.loja?.id)===String(loja.id));
  const vendCom=vendedoresArr.filter(v=>lojaPed.some(p=>pvMap[parseInt(p.id)]===v.vendor_id));

  const wrap=document.createElement('div');
  const posTitle=document.createElement('div');posTitle.className='sa-section-title';posTitle.style.marginBottom='8px';posTitle.textContent='Frequência de Positivação — 15 dias';
  wrap.appendChild(posTitle);

  if(!vendCom.length){
    const empty=document.createElement('div');empty.style.cssText='color:var(--muted);font-size:max(9px, calc(12px * var(--escala-texto, 1)))';empty.textContent='Sem vendas nos últimos 15 dias.';
    wrap.appendChild(empty);return wrap;
  }

  const WEEK_NAMES=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  // A CLASSE ESTAVA MORTA: este grid nascia só com estilo inline, e o
  // `.sa-pos-grid` do <style> não pegava em nada — inclusive as regras de
  // celular. Só as colunas continuam inline, porque a quantidade de dias é
  // dinâmica; o resto (rolagem, espaçamento) volta para o CSS.
  const grid=document.createElement('div');
  grid.className='sa-pos-grid';
  grid.style.gridTemplateColumns='auto repeat('+dias.length+',minmax(52px,1fr))';

  const emptyHdr=document.createElement('div');grid.appendChild(emptyHdr);
  dias.forEach(dt=>{
    const hd=document.createElement('div');hd.className='sa-pos-cell header';
    const dd=new Date(dt+'T12:00:00');
    hd.textContent=WEEK_NAMES[dd.getDay()]+' '+dd.getDate();
    grid.appendChild(hd);
  });

  vendCom.forEach(v=>{
    const nm=document.createElement('div');nm.className='sa-pos-name';nm.textContent=v.nome.split(' ')[0];grid.appendChild(nm);
    dias.forEach(dt=>{
      const dayPed=lojaPed.filter(p=>p.data?.slice(0,10)===dt&&pvMap[parseInt(p.id)]===v.vendor_id);
      const cell=document.createElement('div');cell.className='sa-pos-cell '+(dayPed.length>0?'green':'red');
      cell.textContent=dayPed.length>0?fmtR0(dayPed.reduce((s,p)=>s+parseFloat(p.total||0),0)):'—';
      grid.appendChild(cell);
    });
  });

  wrap.appendChild(grid);
  return wrap;
}

/* ── Fechamento/limpeza (equivalente ao closeSalesAnalysis do legado, que
   fazia display:none + voltava pro brand picker). Continua limpando os mesmos
   timers/gráficos/animação/listener; a troca de tela agora é feita pelo
   router. Também roda no onUnmounted (sem o router.push de novo), para
   garantir que nada fique rodando em segundo plano se o componente for
   destruído por outro caminho que não seja este botão (mesmo padrão de
   _gvStopAllTimers/_gtStopAllTimers). ── */
// ── A RECARGA DE 5 MINUTOS SÓ COM A ABA VISÍVEL (27/08/2026) ─────────────
// Mesma regra da Gestão à Vista, e pelo mesmo motivo medido: aba esquecida
// recarregando a noite inteira comia ~24% da cota do Bling. A decisão tem
// teste em `recarga-automatica.js`; aqui só se obedece.
function _saTiqueDaRecarga(){
  if(decidirNoTique({visivel:!document.hidden})!=='recarregar')return;
  loadSalesAnalysisData(window._saCurrentPeriod||'sofar',{automatica:true});
}
// Voltou para a aba com dado passado dos 5 minutos: busca AGORA. Economizar
// chamada nunca pode virar dinheiro velho na tela (padrão, item 9).
function _saAoVoltarParaAAba(){
  if(document.hidden)return;
  const ms=window._saUltimaBuscaMs?Date.now()-window._saUltimaBuscaMs:null;
  if(decidirAoVoltar({msDesdeAUltimaRecarga:ms,intervaloMs:5*60*1000})==='recarregar'){
    loadSalesAnalysisData(window._saCurrentPeriod||'sofar',{automatica:true});
  }
}

function _saStopAllTimers(){
  clearInterval(window._saRefreshTimer);window._saRefreshTimer=null;
  clearInterval(window._saCountdownTimer);window._saCountdownTimer=null;
  clearInterval(window._saClockTimer);window._saClockTimer=null;
  saAutoStop();
  _saStopBgAnim();
  if(window._saCharts){Object.values(window._saCharts).forEach(c=>{try{c.destroy();}catch(e){}});window._saCharts={};}
  document.removeEventListener('click',_saDocClick);
}
function closeSalesAnalysis(){
  _saStopAllTimers();
  router.push({ name: 'analise-vendas-marca' });
}

// Cluster de funções chamadas via onclick="..." literal no <template> acima
// (período, auto-ciclo, dropdown de canais, botão Voltar). Conferido por grep
// no bloco inteiro do legado (L5755-7141): nenhuma outra função sa*/_sa*/
// renderSA* é chamada por onclick="..." dentro do HTML gerado em runtime —
// todas usam addEventListener (saSelectCanal nas checkboxes/botões Todos-
// Nenhum, os botões de aba de Vendedoras, etc.), então não precisam ir para
// window.
Object.assign(window, {
  saSelectPeriod,
  saToggleAuto,
  saToggleCanalDrop,
  closeSalesAnalysis,
})

// Equivalente ao openSalesAnalysis() do legado, menos o toggle de tela por
// display (o router faz), o setHomeBgTheme('sales') e a cópia de foto entre
// telas (ambos descritos no comentário grande do topo).
onMounted(() => {
  if (!hasPermission('module:sales:analise-vendas')) {
    adminToast('Sem acesso', false)
    router.push({ name: 'analise-vendas-marca' })
    return
  }
  window._saCharts = {}
  window._saRawData = null
  document.addEventListener('click', _saDocClick)
  document.addEventListener('visibilitychange', _saAoVoltarParaAAba)
  _saStartBgAnim()
  startSAClock()
  loadSalesAnalysisData('sofar')
})

// CRÍTICO: limpa TODOS os timers/intervals/gráficos/animação que a Análise de
// Vendas inicia, para não deixar nada rodando em segundo plano depois que o
// usuário sai da tela (o closeSalesAnalysis() cobre o caminho do botão
// "Voltar"; isto cobre qualquer outra forma de sair da rota).
onUnmounted(() => {
  document.removeEventListener('visibilitychange', _saAoVoltarParaAAba)
  _saStopAllTimers()
})
</script>

<style scoped>
/* CSS "peeled" de src/estilos/estilos-globais.css — as regras .sa-* (legacy
   L1835-1911), os overrides de TV (body.dev-tv #sales-analysis-screen, legacy
   L1953-1991) e o responsivo (legacy L619-621) foram removidos de lá e
   movidos para cá, mesmo padrão de tela-de-gestao-a-vista.vue.
   #sales-analysis-screen vira .tela-analise-vendas (sem display:none).

   CSS COMPARTILHADO duplicado aqui (não removido do legado, apenas copiado —
   mesmo padrão de tela-de-gestao-trafego.vue): .gv-topbar/.gv-back/
   .gv-perf-tag/.gv-brand-tag/.gv-clock-wrap/.gv-clock-time/.gv-clock-date/
   .gv-update-status/.gv-period-btns/.gv-pbtn/.gv-loading-screen/.gv-spinner/
   .gv-loading-lbl (de tela-de-gestao-a-vista.vue) e .vs-ac-toggle (idem).

   CSS DELIBERADAMENTE NÃO PORTADO (código morto no legado — nenhum elemento
   do HTML atual de #sales-analysis-screen usa essas classes; a topbar real
   usa .gv-topbar/.gv-perf-tag/.gv-clock-time/.gv-clock-date, não as classes
   abaixo, que sobraram de uma versão anterior da tela):
   .sa-topbar, .sa-back, .sa-topbar-center, .sa-brand-av, .sa-brand-nm (como
   CLASSE — o id="sa-brand-nm" no template usa a classe .gv-perf-tag),
   .sa-filters, .sa-status/.sa-status-live/.sa-status-times/.sa-status-time,
   .sa-clock-wrap, .sa-clock-time, .sa-clock-date (como CLASSE — o id
   "sa-clock-date" no template usa .gv-clock-date), .sa-period-btns, .sa-pbtn
   (os botões reais usam .gv-pbtn), .sa-delta (não referenciada por nenhum
   renderSA*), e os overrides de TV/responsivo que miravam essas mesmas
   classes mortas (legacy L1953-1961, L1967, L614-620). */
/* Fundo TRANSPARENTE: o #bg-shapes (degradê + ícones) fica fixo atrás de tudo
   pra aparecer, e o body já pinta a cor base nos DOIS temas. Pintar cor sólida
   aqui tapava a decoração e ainda deixava uma faixa visível onde a tela
   terminava. */
.tela-analise-vendas{min-height:100vh;display:flex;flex-direction:column;height:100%;overflow:hidden;background:transparent;position:relative;z-index:1;}

/* ── Topbar (compartilhado com Gestão à Vista/Gestão de Tráfego — cada tela traz sua cópia) ── */
.tela-analise-vendas :deep(.gv-topbar){display:flex;align-items:center;justify-content:space-between;padding:7px 28px;border-bottom:1px solid var(--border);background:var(--surface);position:sticky;top:0;z-index:10;}
.tela-analise-vendas :deep(.gv-back){display:flex;align-items:center;gap:4px;font-family:var(--fonte-principal);font-size:max(9px, calc(10px * var(--escala-texto, 1)));font-weight:600;color:var(--accent);cursor:pointer;background:none;border:none;padding:0;transition:opacity .15s;letter-spacing:.3px;text-transform:uppercase;}
.tela-analise-vendas :deep(.gv-back:hover){opacity:.75;}
.tela-analise-vendas :deep(.gv-brand-tag){font-family:var(--fonte-principal);font-size:max(9px, calc(10px * var(--escala-texto, 1)));font-weight:600;letter-spacing:3px;text-transform:uppercase;color:var(--text);opacity:.6;line-height:1;}
.tela-analise-vendas :deep(.gv-perf-tag){font-family:var(--fonte-principal);font-size:max(9px, calc(13.5px * var(--escala-texto, 1)));font-weight:700;letter-spacing:6px;text-transform:uppercase;color:var(--text);opacity:1;line-height:1.2;}
.tela-analise-vendas :deep(.gv-clock-wrap){text-align:right;}
.tela-analise-vendas :deep(.gv-clock-time){font-family:var(--fonte-dados);font-size:max(16px, calc(28px * var(--escala-texto, 1)));font-weight:400;letter-spacing:3px;color:var(--text);line-height:1;}
.tela-analise-vendas :deep(.gv-clock-date){font-family:var(--fonte-principal);font-size:max(9px, calc(8px * var(--escala-texto, 1)));letter-spacing:2px;text-transform:uppercase;color:var(--muted);margin-top:3px;}
.tela-analise-vendas :deep(.gv-update-status){font-family:var(--fonte-principal);font-size:max(9px, calc(8px * var(--escala-texto, 1)));letter-spacing:1.5px;text-transform:uppercase;color:var(--muted);opacity:.45;margin-top:4px;text-align:right;}
.tela-analise-vendas :deep(.gv-period-btns){display:flex;align-items:center;gap:4px;}
.tela-analise-vendas :deep(.gv-pbtn){font-family:var(--fonte-principal);font-size:max(9px, calc(10px * var(--escala-texto, 1)));padding:4px 9px;border-radius:5px;border:1px solid var(--border);background:none;color:var(--muted);cursor:pointer;transition:all .15s;}
.tela-analise-vendas :deep(.gv-pbtn.active){background:var(--accent);color:var(--sobre-cor);border-color:var(--accent);}
.tela-analise-vendas :deep(.vs-ac-toggle){font-family:var(--fonte-principal);font-size:max(9px, calc(10px * var(--escala-texto, 1)));letter-spacing:.8px;text-transform:uppercase;padding:4px 8px;border-radius:6px;border:1px solid var(--border);background:none;color:var(--muted);cursor:pointer;transition:all .15s;margin-left:6px;}
.tela-analise-vendas :deep(.vs-ac-toggle.running){border-color:var(--green);color:var(--green);}

/* ── Loading (compartilhado com Gestão à Vista/Gestão de Tráfego — cada tela traz sua cópia) ── */
.tela-analise-vendas :deep(.gv-loading-screen){grid-column:1/-1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;min-height:60vh;}
@keyframes saSpin{to{transform:rotate(360deg)}}
.tela-analise-vendas :deep(.gv-spinner){width:48px;height:48px;border-radius:50%;border:3px solid var(--border);border-top-color:var(--accent);animation:saSpin .9s linear infinite;}
.tela-analise-vendas :deep(.gv-loading-lbl){font-family:var(--fonte-principal);font-size:max(9px, calc(10px * var(--escala-texto, 1)));letter-spacing:4px;text-transform:uppercase;color:var(--muted);}

/* ── Dropdown de canais (legacy L1855-1861, próprio desta tela) ── */
.tela-analise-vendas :deep(.sa-recorte){margin:0 0 10px;padding:9px 12px;border:1px solid var(--border);border-left:3px solid var(--accent);border-radius:8px;background:var(--surface2);color:var(--muted);font-family:var(--fonte-principal);font-size:max(9px, calc(12px * var(--escala-texto, 1)));line-height:1.45;}
.tela-analise-vendas :deep(.sa-recorte-vazio){border-left-color:var(--orange,#d97706);color:var(--orange,#d97706);}
.tela-analise-vendas :deep(.sa-canal-wrap){position:relative;}
.tela-analise-vendas :deep(.sa-canal-trigger){background:none;border:1px solid var(--border);color:var(--muted);border-radius:var(--radius-sm);padding:5px 16px;font-size:max(9px, calc(12px * var(--escala-texto, 1)));font-weight:600;letter-spacing:1px;text-transform:uppercase;font-family:var(--fonte-principal);cursor:pointer;white-space:nowrap;transition:background .2s,color .15s,border-color .15s;}
.tela-analise-vendas :deep(.sa-canal-trigger:hover){border-color:var(--accent);color:var(--accent);}
.tela-analise-vendas :deep(.sa-canal-drop){position:absolute;top:calc(100% + 6px);right:0;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:8px 6px;min-width:190px;max-height:min(60vh,360px);overflow-y:auto;z-index:9999;display:none;flex-direction:column;gap:2px;box-shadow:var(--shadow-lg);}
/* ── CABEÇALHO DE GRUPO NO MENU DE CANAIS (Peça 2, 20/08/2026) ──────────────
   Só aparece quando existe ao menos um canal com grupo. */
.tela-analise-vendas :deep(.sa-canal-grupo){display:flex;align-items:center;justify-content:space-between;gap:var(--sp-2);padding:var(--sp-2) var(--sp-1) var(--sp-1);margin-top:var(--sp-1);border-top:1px solid var(--border);}
.tela-analise-vendas :deep(.sa-canal-grupo:first-child){border-top:none;margin-top:0;}
.tela-analise-vendas :deep(.sa-canal-grupo-nome){font-family:var(--fonte-principal);font-size:max(9px, calc(10px * var(--escala-texto, 1)));font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--muted);overflow-wrap:anywhere;}
.tela-analise-vendas :deep(.sa-canal-grupo-todos){flex:0 0 auto;font-family:var(--fonte-principal);font-size:max(9px, calc(10px * var(--escala-texto, 1)));font-weight:600;color:var(--accent);background:none;border:1px solid var(--border);border-radius:var(--radius-md);padding:var(--sp-1) var(--sp-2);cursor:pointer;white-space:nowrap;transition:border-color .12s ease;}
.tela-analise-vendas :deep(.sa-canal-grupo-todos:hover){border-color:var(--accent);}
@media(max-width:640px){
  .tela-analise-vendas :deep(.sa-canal-grupo-todos){position:relative;}
  .tela-analise-vendas :deep(.sa-canal-grupo-todos)::after{content:'';position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);height:40px;}
}
.tela-analise-vendas :deep(.sa-canal-drop.open){display:flex;}
.tela-analise-vendas :deep(.sa-canal-check){display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:5px;cursor:pointer;font-size:max(9px, calc(12px * var(--escala-texto, 1)));color:var(--text);user-select:none;}
.tela-analise-vendas :deep(.sa-canal-check:hover){background:var(--accent-light);}
.tela-analise-vendas :deep(.sa-canal-check input[type=checkbox]){accent-color:var(--accent);width:14px;height:14px;cursor:pointer;flex-shrink:0;}
.tela-analise-vendas :deep(.sa-canal-drop-foot){display:flex;gap:6px;margin-top:4px;padding-top:6px;border-top:1px solid var(--border);}
.tela-analise-vendas :deep(.sa-canal-drop-foot button){flex:1;background:none;border:1px solid var(--border);color:var(--muted);border-radius:5px;padding:4px 0;font-size:max(9px, calc(11px * var(--escala-texto, 1)));cursor:pointer;}
.tela-analise-vendas :deep(.sa-canal-drop-foot button:hover){background:var(--accent-light);color:var(--accent-forte);}

/* ── Corpo (#sa-body, montado via innerHTML/createElement — legacy L1866-1911) ── */
.tela-analise-vendas :deep(#sa-body){flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:16px;position:relative;z-index:1;}
.tela-analise-vendas :deep(.sa-loading){display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;min-height:60vh;}
/* Faixa do Bling fora do ar. Fundo por color-mix com --orange e TEXTO em
   --text: o laranja do tema claro sobre esse fundo dá 4,14 de contraste,
   abaixo do mínimo de 4,5. A cor é o sinal; o texto é para ler. */
.tela-analise-vendas :deep(.sa-aviso){display:flex;align-items:center;gap:var(--sp-2);margin:0 0 10px;padding:9px 12px;border:1px solid color-mix(in srgb, var(--orange) 38%, var(--surface));border-left:3px solid var(--orange);border-radius:var(--radius-md);background:color-mix(in srgb, var(--orange) 10%, var(--surface));color:var(--text);font-family:var(--fonte-principal);font-size:max(11px, calc(12px * var(--escala-texto, 1)));line-height:1.45;overflow-wrap:anywhere;}
.tela-analise-vendas :deep(.sa-aviso[hidden]){display:none;}
.tela-analise-vendas :deep(.sa-aviso svg){flex:0 0 auto;color:var(--orange);}
.tela-analise-vendas :deep(.sa-aviso span){color:var(--muted);}
.tela-analise-vendas :deep(.sa-loading-lbl){font-family:var(--fonte-principal);font-size:max(9px, calc(10px * var(--escala-texto, 1)));letter-spacing:4px;text-transform:uppercase;color:var(--muted);}
.tela-analise-vendas :deep(#sa-bg-canvas){position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:0;}
.tela-analise-vendas :deep(.sa-kpis){display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;}
.tela-analise-vendas :deep(.sa-kpi){background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 14px;display:flex;flex-direction:column;gap:4px;}
.tela-analise-vendas :deep(.sa-kpi-label){font-family:var(--fonte-principal);font-size:max(9px, calc(10px * var(--escala-texto, 1)));font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:2px;}
.tela-analise-vendas :deep(.sa-kpi-val){font-size:max(16px, calc(18px * var(--escala-texto, 1)));font-weight:800;color:var(--text);}
.tela-analise-vendas :deep(.sa-kpi-sub){font-size:max(9px, calc(11px * var(--escala-texto, 1)));font-weight:500;color:var(--muted);}
.tela-analise-vendas :deep(.sa-kpi-delta){font-size:max(9px, calc(11px * var(--escala-texto, 1)));font-weight:700;}
.tela-analise-vendas :deep(.sa-kpi-delta.good){color:var(--green);}
.tela-analise-vendas :deep(.sa-kpi-delta.warn){color:var(--orange);}
.tela-analise-vendas :deep(.sa-kpi-delta.bad){color:var(--red);}
.tela-analise-vendas :deep(.sa-section){background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:16px;}
.tela-analise-vendas :deep(.sa-section-title){font-family:var(--fonte-principal);font-size:max(9px, calc(11px * var(--escala-texto, 1)));font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:2px;margin-bottom:12px;}
.tela-analise-vendas :deep(.sa-chart-wrap){position:relative;width:100%;height:220px;}
.tela-analise-vendas :deep(.sa-chart-row){display:grid;grid-template-columns:1fr 1fr;gap:12px;}
.tela-analise-vendas :deep(.sa-chart-row .sa-chart-wrap){height:200px;}
.tela-analise-vendas :deep(.sa-tab-row){display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap;}
.tela-analise-vendas :deep(.sa-tab){background:none;border:1px solid var(--border);color:var(--muted);border-radius:var(--radius-sm);padding:5px 16px;font-size:max(9px, calc(12px * var(--escala-texto, 1)));font-weight:600;letter-spacing:1px;text-transform:uppercase;font-family:var(--fonte-principal);cursor:pointer;transition:background .2s cubic-bezier(.4,0,.2,1),color .15s ease,border-color .15s ease,box-shadow .2s ease;}
.tela-analise-vendas :deep(.sa-tab.active){background:var(--accent);color:var(--sobre-cor);border-color:var(--accent);box-shadow:0 2px 8px rgba(29,78,216,.25);}
.tela-analise-vendas :deep(.sa-summary-card){background:var(--accent-light);border-radius:8px;padding:10px 14px;font-size:max(9px, calc(12px * var(--escala-texto, 1)));color:var(--muted);margin-top:10px;display:flex;flex-wrap:wrap;gap:12px;}
.tela-analise-vendas :deep(.sa-summary-card span){color:var(--text);font-weight:600;}
.tela-analise-vendas :deep(.sa-loja-section){display:flex;flex-direction:column;gap:12px;}
.tela-analise-vendas :deep(.sa-loja-title){font-size:max(9px, calc(13px * var(--escala-texto, 1)));font-weight:700;color:var(--text);}
.tela-analise-vendas :deep(.sa-loja-summary){display:flex;flex-wrap:wrap;gap:8px;padding:8px 0;}
.tela-analise-vendas :deep(.sa-loja-summary-item){background:var(--surface2);border-radius:6px;padding:6px 12px;display:flex;flex-direction:column;gap:2px;min-width:100px;}
.tela-analise-vendas :deep(.sa-loja-summary-label){font-family:var(--fonte-principal);font-size:max(9px, calc(9px * var(--escala-texto, 1)));font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1.5px;}
.tela-analise-vendas :deep(.sa-loja-summary-val){font-family:var(--fonte-principal);font-size:max(9px, calc(13px * var(--escala-texto, 1)));font-weight:800;color:var(--text);}
.tela-analise-vendas :deep(.sa-loja-tbl-wrap){overflow-x:auto;-webkit-overflow-scrolling:touch;}
.tela-analise-vendas :deep(.sa-loja-table){width:100%;border-collapse:collapse;font-size:max(9px, calc(12px * var(--escala-texto, 1)));}
.tela-analise-vendas :deep(.sa-loja-table th){color:var(--muted);font-weight:700;text-align:left;padding:6px 8px;border-bottom:1px solid var(--border);}
.tela-analise-vendas :deep(.sa-loja-table td){padding:6px 8px;border-bottom:1px solid var(--border);vertical-align:top;font-weight:500;}
.tela-analise-vendas :deep(.sa-loja-table tr:last-child td){border-bottom:none;}
.tela-analise-vendas :deep(.sa-pos-grid){display:grid;gap:3px;overflow-x:auto;-webkit-overflow-scrolling:touch;}
.tela-analise-vendas :deep(.sa-pos-row){display:contents;}
.tela-analise-vendas :deep(.sa-pos-cell){padding:4px 6px;border-radius:4px;font-size:max(9px, calc(10px * var(--escala-texto, 1)));text-align:center;white-space:nowrap;min-width:52px;}
.tela-analise-vendas :deep(.sa-pos-cell.green){background:color-mix(in srgb,var(--green) 13%,var(--surface));color:var(--green);}
.tela-analise-vendas :deep(.sa-pos-cell.red){background:color-mix(in srgb,var(--red) 13%,var(--surface));color:var(--red);}
.tela-analise-vendas :deep(.sa-pos-cell.header){background:none;color:var(--muted);font-weight:600;}
.tela-analise-vendas :deep(.sa-pos-name){font-size:max(9px, calc(11px * var(--escala-texto, 1)));color:var(--text);font-weight:600;padding:4px 8px;white-space:nowrap;}

/* ── RESPONSIVE (compartilhado — legacy L645-662/694-696) ── */
@media(max-width:1024px){
  .tela-analise-vendas :deep(.gv-topbar){flex-wrap:wrap;padding:8px 14px;gap:6px;}
  /* O relógio foi REMOVIDO do celular no app inteiro (estilos-globais.css): o
     aparelho já mostra hora e data na barra de status. Esta tela forçava o
     contrário com !important — era a única. */
}
@media(max-width:640px){
  .tela-analise-vendas :deep(.gv-topbar){padding:6px 10px;}
  .tela-analise-vendas :deep(.gv-brand-tag){display:none;}
  /* ── A RÉGUA DE PERÍODOS NO CELULAR ───────────────────────────────────────
     Herdado do monólito: os 9 períodos QUEBRAVAM em duas fileiras e os botões
     encolhiam para 9px de fonte e 19px de altura — metade do alvo que um dedo
     precisa (~44px), em duas linhas desalinhadas. Era o "pequeno demais" que o
     dono apontou.
     Agora é uma linha só que rola de lado, com botões de 10px — exatamente o
     que a Gestão de Tráfego e a Redes Sociais já faziam, e que ele aprovou. */
  .tela-analise-vendas :deep(.gv-period-btns){flex-wrap:nowrap;overflow-x:auto;-webkit-overflow-scrolling:touch;gap:6px;padding-bottom:2px;}
  .tela-analise-vendas :deep(.gv-pbtn){font-size:max(9px, calc(10px * var(--escala-texto, 1)));padding:5px 10px;border-radius:6px;flex-shrink:0;white-space:nowrap;}

  /* ── OS CARTÕES DE NÚMERO NO CELULAR ──────────────────────────────────────
     Três defeitos medidos em 390px, que juntos davam o aspecto quebrado:

     1. As linhas da grade tinham altura livre — 96, 65, 113 e 100px. Cada
        dupla se alinhava entre si, mas o conjunto ficava irregular, com
        cartões curtos esticados ao lado de cartões longos.
        `grid-auto-rows:1fr` deixa todas as linhas com a mesma altura.

     2. A linha de comparação ("-20.8% vs ant. (R$ -3.511,95)") tem 29
        caracteres e cabiam ~28 num cartão de 174px a 11px. Faltava UM
        caractere, e ela quebrava no meio do parêntese. A 10px cabe inteira —
        e 10px é o mesmo tamanho do rótulo do cartão, que já era assim.

     3. São SETE cartões em duas colunas: o último ficava sozinho numa linha
        pela metade, parecendo esquecido. Agora ele ocupa a linha inteira,
        o que lê como decisão em vez de sobra. */
  .tela-analise-vendas :deep(.sa-kpis){grid-auto-rows:1fr;}
  /* Medido: a 10px o texto pede 144px e o cartão oferecia 142. Faltavam DOIS
     pixels. Em vez de encolher mais a letra, os 4px vêm do espaço interno
     lateral (14px -> 12px), que ninguém percebe faltar. */
  .tela-analise-vendas :deep(.sa-kpi){padding:12px 12px;}
  .tela-analise-vendas :deep(.sa-kpi-delta){font-size:max(9px, calc(10px * var(--escala-texto, 1)));line-height:1.35;}
  .tela-analise-vendas :deep(.sa-kpi:last-child:nth-child(odd)){grid-column:1 / -1;}

  /* ── O RESTO DA TELA NO CELULAR (12/08/2026) ──────────────────────────────
     Os cartões de número já tinham sido acertados; abaixo deles a tela
     continuava desenhada para computador. Medido a 375px:

     1. OS DOIS GRÁFICOS LADO A LADO. `.sa-chart-row` era `1fr 1fr` em
        QUALQUER largura: num aparelho de 375px cada gráfico ficava com ~170px
        de largura por 200px de altura, com rótulo de eixo por cima do outro.
        Era o pior item da tela. Vira uma coluna só, e aí cada gráfico tem a
        largura inteira.

     2. A TABELA DE METAS POR VENDEDORA TEM TREZE COLUNAS (Vendedora + 4
        períodos × 3 números). Ela já rolava de lado, mas o nome rolava JUNTO:
        três dedos para a direita e não dava mais para saber de quem era a
        linha que se está lendo. A primeira coluna passa a ficar presa.

     3. O MAPA DE POSITIVAÇÃO tem 16 colunas (nome + 15 dias). Mesmo problema,
        mesma solução: o nome fica preso e os dias rolam por baixo dele.

     Nada aqui vale acima de 640px — o computador continua exatamente como
     estava, que é a regra desta base para mexida de responsivo. */

  /* 1) UM GRÁFICO POR VEZ. */
  .tela-analise-vendas :deep(.sa-chart-row){grid-template-columns:1fr;}
  .tela-analise-vendas :deep(.sa-chart-row .sa-chart-wrap){height:200px;}

  /* Respiro: 16px de cada lado em 375px é 8,5% da tela só de margem. */
  .tela-analise-vendas :deep(#sa-body){padding:12px;gap:12px;}
  .tela-analise-vendas :deep(.sa-section){padding:12px;}

  /* 2) e 3) A PRIMEIRA COLUNA FICA PRESA enquanto o resto rola.
     `background` explícito é obrigatório: sem ele a coluna presa fica
     transparente e as outras passam POR BAIXO dela, virando um borrão
     ilegível — o defeito parece pior que o problema original. */
  .tela-analise-vendas :deep(.sa-loja-table th:first-child),
  .tela-analise-vendas :deep(.sa-loja-table td:first-child){position:sticky;left:0;z-index:2;background:var(--surface);max-width:112px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .tela-analise-vendas :deep(.sa-loja-table th),
  .tela-analise-vendas :deep(.sa-loja-table td){padding:6px;white-space:nowrap;}
  .tela-analise-vendas :deep(.sa-pos-name){position:sticky;left:0;z-index:2;background:var(--surface);}

  /* Os cartõezinhos de resumo da loja em duas colunas certas, em vez de uma
     fileira irregular que deixa um item sozinho e esticado. */
  .tela-analise-vendas :deep(.sa-loja-summary){gap:6px;}
  .tela-analise-vendas :deep(.sa-loja-summary-item){flex:1 1 calc(50% - 3px);min-width:0;}

  /* As abas viram uma fileira que rola, igual à régua de períodos logo acima:
     quebrar em duas linhas desalinha e come altura. */
  .tela-analise-vendas :deep(.sa-tab-row){flex-wrap:nowrap;overflow-x:auto;-webkit-overflow-scrolling:touch;padding-bottom:2px;}
  .tela-analise-vendas :deep(.sa-tab){flex-shrink:0;white-space:nowrap;padding:6px 12px;}
}
/* ── RESPONSIVE: Análise de Vendas (legacy L619-621 — só a regra viva; as
   demais deste bloco miravam .sa-brand-nm/.sa-pbtn, classes mortas) ── */
@media(max-width:480px){
  .tela-analise-vendas :deep(.sa-canal-trigger){padding:4px 10px;font-size:max(9px, calc(10px * var(--escala-texto, 1)));letter-spacing:.5px;}
}

/* ── TV OVERRIDES (≥1920px) — ativadas por body.dev-tv, um toggle ainda não
   exposto na UI Vue (existia no menu de administração do legado); legacy
   L1953-1991, só as regras que miram classes REALMENTE usadas por esta tela
   (as que miravam .sa-topbar/.sa-back/.sa-brand-av/.sa-brand-nm/.sa-status-
   (todas) /.sa-clock-time/.sa-clock-date/.sa-pbtn eram código morto — ver
   nota no topo deste bloco de estilo) ── */
body.dev-tv .tela-analise-vendas :deep(.sa-canal-trigger){font-size:max(16px, calc(19px * var(--escala-texto, 1)));padding:8px 26px;}
body.dev-tv .tela-analise-vendas :deep(.sa-canal-drop){min-width:304px;}
body.dev-tv .tela-analise-vendas :deep(.sa-canal-check){font-size:max(16px, calc(19px * var(--escala-texto, 1)));padding:8px 13px;}
body.dev-tv .tela-analise-vendas :deep(.sa-canal-check input[type=checkbox]){width:22px;height:22px;}
body.dev-tv .tela-analise-vendas :deep(.sa-canal-drop-foot button){font-size:max(16px, calc(18px * var(--escala-texto, 1)));}
body.dev-tv .tela-analise-vendas :deep(#sa-body){padding:26px;gap:26px;}
body.dev-tv .tela-analise-vendas :deep(.sa-kpis){gap:16px;grid-template-columns:repeat(auto-fit,minmax(224px,1fr));}
body.dev-tv .tela-analise-vendas :deep(.sa-kpi){padding:19px 22px;}
body.dev-tv .tela-analise-vendas :deep(.sa-kpi-label){font-size:max(16px, calc(16px * var(--escala-texto, 1)));}
body.dev-tv .tela-analise-vendas :deep(.sa-kpi-val){font-size:max(16px, calc(29px * var(--escala-texto, 1)));}
body.dev-tv .tela-analise-vendas :deep(.sa-kpi-sub){font-size:max(16px, calc(18px * var(--escala-texto, 1)));}
body.dev-tv .tela-analise-vendas :deep(.sa-kpi-delta){font-size:max(16px, calc(18px * var(--escala-texto, 1)));}
body.dev-tv .tela-analise-vendas :deep(.sa-section){padding:26px;}
body.dev-tv .tela-analise-vendas :deep(.sa-section-title){font-size:max(16px, calc(18px * var(--escala-texto, 1)));}
body.dev-tv .tela-analise-vendas :deep(.sa-chart-wrap){height:352px;}
body.dev-tv .tela-analise-vendas :deep(.sa-chart-row .sa-chart-wrap){height:320px;}
body.dev-tv .tela-analise-vendas :deep(.sa-tab){font-size:max(16px, calc(19px * var(--escala-texto, 1)));padding:8px 26px;}
body.dev-tv .tela-analise-vendas :deep(.sa-summary-card){font-size:max(16px, calc(19px * var(--escala-texto, 1)));padding:16px 22px;}
body.dev-tv .tela-analise-vendas :deep(.sa-loja-title){font-size:max(16px, calc(21px * var(--escala-texto, 1)));}
body.dev-tv .tela-analise-vendas :deep(.sa-loja-summary-item){padding:10px 19px;}
body.dev-tv .tela-analise-vendas :deep(.sa-loja-summary-label){font-size:max(9px, calc(14px * var(--escala-texto, 1)));}
body.dev-tv .tela-analise-vendas :deep(.sa-loja-summary-val){font-size:max(16px, calc(21px * var(--escala-texto, 1)));}
body.dev-tv .tela-analise-vendas :deep(.sa-loja-table){font-size:max(16px, calc(19px * var(--escala-texto, 1)));}
body.dev-tv .tela-analise-vendas :deep(.sa-loja-table th){padding:10px 13px;}
body.dev-tv .tela-analise-vendas :deep(.sa-loja-table td){padding:10px 13px;}
body.dev-tv .tela-analise-vendas :deep(.sa-pos-grid){gap:3px;}
body.dev-tv .tela-analise-vendas :deep(.sa-pos-cell){font-size:max(16px, calc(16px * var(--escala-texto, 1)));padding:6px 10px;min-width:83px;}
body.dev-tv .tela-analise-vendas :deep(.sa-pos-name){font-size:max(16px, calc(18px * var(--escala-texto, 1)));padding:6px 13px;}
body.dev-tv .tela-analise-vendas :deep(.sa-loading-lbl){font-size:max(16px, calc(16px * var(--escala-texto, 1)));}
/* FAIXA DE CONTROLES — ver o comentario no template. */
/* A faixa agora mora DENTRO da barra. Quem dá fundo, borda de baixo e respiro
   lateral é a barra — repetir aqui desenharia moldura dentro de moldura. */
.tela-analise-vendas :deep(.gv-controles){display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap;padding:0;background:transparent;}
/* No celular ela desce em largura cheia (é o .bt-dir que decide isso) e aí sim
   precisa do respiro próprio: era a margem que faltava nesta tela. */
@media(max-width:640px){.tela-analise-vendas :deep(.gv-controles){padding:8px 12px;flex-direction:column;align-items:stretch;gap:8px;}}
</style>
