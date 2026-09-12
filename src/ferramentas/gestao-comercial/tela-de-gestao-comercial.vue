<template>
  <!-- Template = HTML de #gestao-comercial-screen do legado (legacy/index.html
       L12213-12224), VERBATIM. class="tela-gestao-comercial" no lugar do id, pro CSS
       com escopo (o id="gestao-comercial-screen" some — nada faz getElementById nele).
       Mantidos os ids usados por getElementById no JS imperativo abaixo: "gc-select"
       (loadGestao popula as opções e lê o valor) e "gc-body" (onde o relatório é
       renderizado via innerHTML). Botão "Voltar": onclick="closeGestao()" virou
       @click="voltar". O <select onchange="_gcRenderIdx(this.value)"> virou
       @change="onSelectEdicao" (chama _gcRenderIdx(e.target.value) — a função em si
       segue existindo e é exposta em window mais abaixo, pois nada mais a chama por
       onclick/onchange dentro do HTML gerado em runtime). -->
  <div class="tela-gestao-comercial">
    <barra-de-topo voltar="Central" titulo="Gestão Comercial" subtitulo="Briefing do gestor · IA" @voltar="voltar">
      <template #acoes>
        <select id="gc-select" class="bt-acao" v-show="abaGc==='briefing'" aria-label="Edição" @change="onSelectEdicao"></select>
      </template>
    </barra-de-topo>
    <div class="gc-tabs" v-if="podeRelatorios" role="tablist">
      <button type="button" role="tab" :class="{ on: abaGc==='briefing' }" @click="irPara('briefing')">Briefing Semanal</button>
      <button type="button" role="tab" :class="{ on: abaGc==='relatorios' }" @click="irPara('relatorios')">Relatórios</button>
      <!-- ESPELHO do time de venda. Só aparece para quem administra algum: a
           própria aba se esconde de quem não teria o que fazer nela. -->
      <button v-if="podeTime" type="button" role="tab" :class="{ on: abaGc==='time' }" @click="irPara('time')">Time de vendas</button>
    </div>
    <div class="gc-body" id="gc-body" v-show="abaGc==='briefing'"></div>
    <RelatoriosComerciais v-if="relMontada" v-show="abaGc==='relatorios'" />
    <TimeDeVendas v-if="timeMontado" v-show="abaGc==='time'" />
  </div>
</template>

<script setup>
import { onMounted, ref, computed } from 'vue'
import BarraDeTopo from '../../compartilhado/barra-de-topo.vue'
import { useRouter } from 'vue-router'
import { sbClient } from '../../compartilhado/conectar-no-banco-de-dados.js'
import { listaDaResposta, detalheDaResposta } from './resposta-do-bling.js'
import { hasPermission, estado } from '../../compartilhado/controle-de-login-e-usuario.js'
import { adminToast } from '../../compartilhado/avisos.js'
import RelatoriosComerciais from './relatorios-comerciais.vue'
import TimeDeVendas from './time-de-vendas.vue'

const router = useRouter()

const logoClaroUrl = '/midia/LOGOTIPOBRENOPRETO.png'
const logoEscuroUrl = '/midia/LOGOTIPOBRENOBRANCO.png'

// Abas: 'briefing' (o painel de IA) | 'relatorios' (o módulo novo, gateado).
const abaGc = ref('briefing')
const relMontada = ref(false)   // monta o filho só quando a aba abre pela 1ª vez
const podeRelatorios = computed(() => hasPermission('gestor.relatorios', 'ver'))
const timeMontado = ref(false)

// QUEM VÊ A ABA: o dono, ou quem administra/supervisiona algum time.
//
// Sem chave de permissão nova, e de propósito: aqui o direito vem do DADO — é
// gestora de um time ou não é. Uma chave à parte poderia dizer "sim" para quem
// o banco vai recusar, e aí a tela promete o que não entrega.
const podeTime = ref(false)
async function conferirSeGerencioAlgumTime() {
  if (estado.is_superadmin) { podeTime.value = true; return }
  try {
    const { data } = await sbClient.from('equipes_membros')
      .select('papel').eq('profile_id', estado.user?.id).in('papel', ['gestor', 'supervisora']).limit(1)
    podeTime.value = !!(data && data.length)
  } catch (e) { podeTime.value = false }
}
function irPara(aba) {
  abaGc.value = aba
  if (aba === 'relatorios') relMontada.value = true
  // Só monta quando a pessoa entra: a aba faz quatro consultas ao banco, e
  // quem nunca a abre não deve pagar por elas.
  if (aba === 'time') timeMontado.value = true
}

// ==========================================================================
// PORTE VERBATIM da Gestão Comercial (legacy/index.html — estado e funções
// espalhadas entre L9675 (_gcFontScale) e L11436-11631 (cluster _gc*/gc*),
// menos openGestao/closeGestao, que viraram onMounted/voltar() abaixo.
//
// Dependências externas resolvidas:
//   - sbClient          → import (conectar-no-banco-de-dados.js) — usado em
//     .from('gestao_comercial_briefings') (loadGestao) e em
//     .functions.invoke('bling-proxy', ...) (_gcBlingList/_gcBlingDetalhe).
//   - hasPermission      → import (controle-de-login-e-usuario.js) — guarda
//     de acesso ('gestor', chave já presente em PERMISSION_TREE).
//   - adminToast         → import (avisos.js) — usado só na guarda.
//   - _npEsc, escHtml, fmtR → NÃO usados por este cluster (checado por grep;
//     o cluster GC usa sua própria função de escape local, ver _gcEsc abaixo,
//     que é uma cópia self-contida do _npEsc do legado (L11395) já que o
//     cluster GC chama "_npEsc" e não há um _npEsc compartilhado no Vue ainda).
//
//   - openGestao()/closeGestao() do legado faziam o toggle de tela via
//     display:none/flex + sessionStorage.setItem('rbv-screen',...); isso foi
//     OMITIDO — quem mostra/esconde a tela agora é o vue-router.
//
// Nada foi reescrito para template reativo — o corpo do relatório (#gc-body)
// e os dois modais (item do Bling / explicação) seguem montados via
// getElementById/createElement/innerHTML, exatamente como a produção atual.
// Por isso o cluster de funções GC usadas em onclick="..." dentro do HTML
// gerado em runtime (gcAbrirItem, gcInfo) é exposto em window no fim deste
// bloco, junto com _gcRenderIdx (chamada pelo @change do <select> acima).
// ==========================================================================

/* ── Helper de escape copiado do legado (self-contido) — legacy L11395 (_npEsc) ── */
function _npEsc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

/* ── Zoom de fonte (legado L9675-9691, verbatim) ── */
function _gcFontScale(){
  const screen=document.querySelector('.tela-gestao-comercial');if(!screen)return;
  const K='rbv-gcfs';
  let z=parseFloat(localStorage.getItem(K));if(!(z>=0.7&&z<=2))z=1;
  let ctl=screen.querySelector(':scope > .zoomctl');
  const apply=()=>{screen.style.setProperty('--gc-fs',String(z));document.documentElement.style.setProperty('--gc-fs',String(z));try{localStorage.setItem(K,String(z));}catch(e){}const v=ctl&&ctl.querySelector('.zoomctl-val');if(v)v.textContent=Math.round(z*100)+'%';};
  if(!ctl){
    ctl=document.createElement('div');ctl.className='zoomctl';
    const mk=(t,title,fn)=>{const b=document.createElement('button');b.type='button';b.textContent=t;b.title=title;b.onclick=fn;return b;};
    ctl.appendChild(mk('A−','Diminuir texto',()=>{z=Math.max(0.7,Math.round((z-0.1)*10)/10);apply();}));
    const val=document.createElement('span');val.className='zoomctl-val';val.title='Restaurar 100%';val.onclick=()=>{z=1;apply();};
    ctl.appendChild(val);
    ctl.appendChild(mk('A+','Aumentar texto',()=>{z=Math.min(2,Math.round((z+0.1)*10)/10);apply();}));
    screen.appendChild(ctl);
  }
  apply();
}

/* ── Estado do módulo + cluster de funções (legacy L11436-11631, verbatim) ── */
let _gcData=[];
function _gcInline(s){return _gcLupa(_npEsc(s).replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>'));}
function _gcFmtR(v){return 'R$ '+Math.round(Number(v)||0).toLocaleString('pt-BR');}
// lupa → abre modal com a imagem do Bling
function _gcLupaBtn(sku){return '<button class="gc-lupa" type="button" title="Ver item" data-sku="'+_npEsc(String(sku).trim())+'" onclick="gcAbrirItem(this.dataset.sku)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="20" y1="20" x2="16.65" y2="16.65"/></svg></button>';}
// SKUs em parênteses no texto corrido (ex.: (LV102), (Lv1027-Caramelo), (LV108-Wara Palha))
function _gcLupa(s){return String(s).replace(/\(([A-Za-z]{1,5}\d{2,4}[\p{L}\d .\/\-]*?)\)/gu,(m,sku)=>'('+sku+')'+_gcLupaBtn(sku));}
// badge de matriz BCG quando a célula é a classificação
function _gcBcgBadge(t){const s=String(t).normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^\p{L}\s]/gu,'').trim().toLowerCase();
  if(s==='estrela')return '<span class="gc-bcg estrela">Estrela</span>';
  if(s==='vaca leiteira'||s==='vaca')return '<span class="gc-bcg vaca">Vaca leiteira</span>';
  if(s==='interrogacao'||s==='ponto de interrogacao'||s==='duvida')return '<span class="gc-bcg interrogacao">Interrogação</span>';
  if(s==='abacaxi')return '<span class="gc-bcg abacaxi">Abacaxi</span>';
  return '';}
function _gcCell(c){
  const b=_gcBcgBadge(c);if(b)return b;
  const t=String(c).trim();
  if(/^[A-Za-z]{1,5}\d{2,4}[\p{L}\d .\/\-]*$/u.test(t))return _npEsc(t)+_gcLupaBtn(t);  // célula de SKU (aceita espaço/acento: LV1167-CG Palha, LV5027-CaféM)
  return _gcInline(c);
}
// Botões de ajuda "?" → modal explicativo
function _gcInfoBtn(key){return '<button class="gc-info" type="button" title="Entenda" onclick="gcInfo(\''+key+'\')">?</button>';}
const GC_INFO={
  bcg:{titulo:'Como classifico a Matriz BCG',html:`<p>A BCG real cruza <b>participação de mercado × crescimento</b>. Como não temos dado de mercado, uso dois <b>proxies do seu Bling</b>:</p>
<h4>Eixo 1 — Participação (sell-through)</h4><p><code>sell-through = vendas no mês ÷ (vendas no mês + estoque NA LOJA)</code><br>De tudo que o item teve disponível na loja, que fração já vendeu. <small>O estoque do pulmão/atacado não entra aqui, pra não jogar em Abacaxi um item que vende bem na loja.</small></p>
<h4>Eixo 2 — Crescimento / vida</h4><p>Vendeu alguma unidade no mês <b>e/ou</b> teve venda nos <b>últimos 21 dias</b>.</p>
<h4>As 4 regras (nessa ordem)</h4><table><thead><tr><th>Quadrante</th><th>Critério</th></tr></thead><tbody>
<tr><td>⭐ <b>Estrela</b></td><td>vendeu <b>e</b> sell-through ≥ 50% — vende rápido, sobra pouco</td></tr>
<tr><td>🐮 <b>Vaca leiteira</b></td><td>vendeu <b>e</b> sell-through 25–50% — vende firme, ainda tem estoque</td></tr>
<tr><td>❓ <b>Interrogação</b></td><td>não bateu acima, mas vendeu algo <b>ou</b> teve venda nos últimos 21 dias</td></tr>
<tr><td>🍍 <b>Abacaxi</b></td><td>giro 0 <b>e</b> parado há mais de 21 dias — não gira</td></tr></tbody></table>
<div class="ex"><b>Exemplos reais:</b> Tote Paris Preto vendeu 2 com pouco estoque → ~50% → <b>Estrela</b>. Ombro Cambridge 2 vendas / estoque 4 → ~33% → <b>Vaca</b>. Ombro Perugia 1 venda / estoque 4 → ~20% mas girou → <b>Interrogação</b>. Ombro Viena giro 0, parado 90+ dias → <b>Abacaxi</b>.</div>
<p><small>É uma BCG aproximada (proxy), não a acadêmica. Os cortes (50% / 25% / 21 dias) são ajustáveis.</small></p>`},
  projecao:{titulo:'Como calculo a Projeção de fechamento',html:`<p>Pego seu <b>ritmo médio diário</b> até hoje e estendo até o fim do mês.</p>
<h4>A conta</h4><p><code>ritmo diário = realizado ÷ dias já corridos</code><br><code>projeção = ritmo diário × dias do mês</code></p>
<div class="ex"><b>Exemplo:</b> faturou R$ 12.000 em 23 dias → ritmo ~R$ 522/dia. Mês de 30 dias → projeção ≈ <b>R$ 15.660</b>.</div>
<h4>Adiantado × atrasado</h4><p>Comparo o <b>realizado</b> com o <b>esperado até hoje</b> (a soma das metas diárias do mês, ou a meta dividida igual pelos dias). Acima = adiantado; abaixo = atrasado.</p>
<p><small>A projeção assume ritmo constante — uma promoção, data comemorativa ou virada de coleção pode acelerar e mudar o número.</small></p>`},
  publico:{titulo:'Amplo × Base e a escada de desconto',html:`<p>A vitrine serve os <b>dois públicos ao mesmo tempo</b>, com a escada de desconto <b>15 / 20 / 25 / 30 / 35 / 40%</b>.</p>
<h4>Como o desconto é definido</h4><p>Pelo <b>desejo do item</b>: a campeã (Estrela) leva o <b>menor</b> desconto (15% — ela vende sozinha) e o mais parado (Abacaxi) leva o <b>maior</b> (40% — pra queimar). Os níveis do meio seguem a escada.</p>
<h4>Como divido os públicos</h4><p>A cada <b>par de itens do mesmo nível</b>, um vai pro <b>Amplo</b> e um pra <b>Base</b> — então os dois recebem um pouco de cada quadrante, <b>inclusive uma Estrela cada</b>, e ambos pegam a escada inteira.</p>
<ul><li>🛍️ <b>Amplo</b> = fluxo do shopping (clientes novos que passam na porta)</li><li>💜 <b>Base</b> = quem já comprou (recompra / fidelidade)</li></ul>
<p><small>O <b>BCG</b> decide QUAIS itens entram (mix 2/3/4/3); o desconto segue o desejo; o Público distribui pra QUEM.</small></p>`}
};
function gcInfo(key){
  const info=GC_INFO[key]; if(!info) return;
  let ov=document.getElementById('gc-info-modal');
  if(!ov){ov=document.createElement('div');ov.id='gc-info-modal';ov.className='gc-infomodal';ov.onclick=e=>{if(e.target===ov)ov.classList.remove('open');};document.body.appendChild(ov);}
  ov.innerHTML='<div class="gc-infomodal-card"><button class="gc-im-x" type="button" onclick="document.getElementById(\'gc-info-modal\').classList.remove(\'open\')">✕</button><div class="gc-infomodal-body"><h3 class="gc-infomodal-h">'+_npEsc(info.titulo)+'</h3>'+info.html+'</div></div>';
  ov.classList.add('open');
}
// A FALHA SOBE, e é o `try/catch` da gcAbrirItem que a mostra.
//
// Antes as duas engoliam: `catch → return []` e, pior, `|| []` — porque
// `functions.invoke` não joga erro, devolve `{ data: null, error }`. Bling fora
// do ar virava lista vazia, o catch de cima nunca disparava, e o usuário lia
// "Item não encontrado no Bling" em vez de "não consegui consultar agora".
// A regra de leitura mora em resposta-do-bling.js, com teste.
async function _gcBlingList(params){
  return listaDaResposta(await sbClient.functions.invoke('bling-proxy',{body:{endpoint:'produtos',params}}));
}
async function _gcBlingDetalhe(id){
  return detalheDaResposta(await sbClient.functions.invoke('bling-proxy',{body:{endpoint:'produtos/'+id}}));
}
async function gcAbrirItem(sku){
  sku=String(sku||'').trim();
  let ov=document.getElementById('gc-item-modal');
  if(!ov){ov=document.createElement('div');ov.id='gc-item-modal';ov.className='gc-im';ov.onclick=e=>{if(e.target===ov)ov.classList.remove('open');};document.body.appendChild(ov);}
  ov.innerHTML='<div class="gc-im-card"><button class="gc-im-x" type="button" onclick="document.getElementById(\'gc-item-modal\').classList.remove(\'open\')">✕</button><div class="gc-im-body"><div class="gc-im-ph">Buscando <b>'+_npEsc(sku)+'</b> no Bling…</div></div></div>';
  ov.classList.add('open');
  try{
    const base=sku.split('-')[0].trim();
    let list=await _gcBlingList({codigo:sku,limite:3});
    if(!list.length&&base!==sku)list=await _gcBlingList({codigo:base,limite:6});
    if(!list.length)list=await _gcBlingList({pesquisa:sku,limite:8});
    if(!list.length&&base!==sku)list=await _gcBlingList({pesquisa:base,limite:8});
    if(!list.length){_gcItemRender(ov,sku,null);return;}
    const prod=list.find(p=>String(p.codigo||'').toLowerCase().startsWith(base.toLowerCase()))||list[0];
    let full=(await _gcBlingDetalhe(prod.id))||prod;
    if(!_gcItemImg(full)&&base!==sku){            // sem imagem na variação → tenta o produto-pai pelo código base
      const pl=await _gcBlingList({codigo:base,limite:6});
      const pp=pl.find(p=>String(p.codigo||'').toLowerCase()===base.toLowerCase())||pl[0];
      if(pp){const pd=await _gcBlingDetalhe(pp.id);if(pd&&_gcItemImg(pd))full=pd;}
    }
    _gcItemRender(ov,sku,full);
  }catch(e){_gcItemRender(ov,sku,'erro');}
}
function _gcItemImg(p){
  if(!p||typeof p!=='object')return '';
  if(p.imagemURL&&/^https?:/.test(p.imagemURL))return p.imagemURL;
  const mi=p.midia&&p.midia.imagens;
  if(mi){const e=mi.externas&&mi.externas[0]&&mi.externas[0].link;const i=mi.internas&&mi.internas[0]&&mi.internas[0].link;if(e||i)return e||i;}
  try{const m=JSON.stringify(p).match(/https?:\/\/[^"'\\]+\.(?:jpg|jpeg|png|webp)/i);if(m)return m[0];}catch(e){}
  return '';
}
function _gcItemRender(ov,sku,p){
  let inner;
  if(p===null)inner='<div class="gc-im-ph">Item <b>'+_npEsc(sku)+'</b> não encontrado no Bling.</div>';
  else if(p==='erro')inner='<div class="gc-im-ph">Não consegui consultar o Bling agora. Tente de novo.</div>';
  else{const img=_gcItemImg(p);const nome=p.nome||sku;const preco=(p.preco!=null&&p.preco!=='')?_gcFmtR(p.preco):'';
    inner='<div class="gc-im-img">'+(img?'<img src="'+_npEsc(img)+'" alt="" onerror="this.parentNode.innerHTML=&#39;<span>sem imagem</span>&#39;">':'<span>sem imagem</span>')+'</div>'
      +'<div class="gc-im-info"><div class="gc-im-sku">SKU '+_npEsc(p.codigo||sku)+'</div><div class="gc-im-nome">'+_npEsc(nome)+'</div>'+(preco?'<div class="gc-im-preco">'+preco+'</div>':'')+'</div>';}
  const body=ov.querySelector('.gc-im-body');if(body)body.innerHTML=inner;
}
// Registro das tabelas (planilhas) do briefing renderizado, pra exportar em XLS.
let _gcTabelas=[];
// Texto cru pra exportação: tira marcações de markdown (negrito/itálico/código).
function _gcPlain(c){return String(c==null?'':c).replace(/\*\*/g,'').replace(/[*`]/g,'').replace(/<[^>]+>/g,'').trim();}
// Exporta a tabela `idx` do briefing atual em .xlsx (SheetJS global XLSX, igual ao admin).
function exportarTabelaGc(idx){
  const t=_gcTabelas[idx];if(!t||!window.XLSX)return;
  const aoa=[t.head,...t.rows];
  const ws=XLSX.utils.aoa_to_sheet(aoa);
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'Planilha');
  const base=String((t.head&&t.head[0])||'tabela').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,30)||'tabela';
  XLSX.writeFile(wb,'gestor-comercial-'+base+'.xlsx');
}
function _gcMarkdown(md){
  const lines=String(md||'').replace(/\r/g,'').split('\n');let html='',i=0;_gcTabelas=[];
  while(i<lines.length){
    const ln=lines[i];
    if(/^RESUMO:/.test(ln)){i++;continue;}
    if(/^###\s+/.test(ln)){html+='<h3>'+_gcInline(ln.replace(/^###\s+/,''))+'</h3>';i++;continue;}
    if(/^##\s+/.test(ln)){html+='<h2>'+_gcInline(ln.replace(/^##\s+/,''))+'</h2>';i++;continue;}
    if(/^#\s+/.test(ln)){html+='<h1>'+_gcInline(ln.replace(/^#\s+/,''))+'</h1>';i++;continue;}
    if(/^::bcgmix\s/.test(ln)){
      const get=k=>{const mm=ln.match(new RegExp(k+':(\\d+)/(\\d+)'));return mm?[+mm[1],+mm[2]]:[0,0];};
      const defs=[['Estrela','estrela','e'],['Vaca leiteira','vaca','v'],['Interrogação','interrogacao','i'],['Abacaxi','abacaxi','a']];
      let chips='';for(const[lbl,cls,k]of defs){const a=get(k),off=a[0]!==a[1];chips+='<div class="gc-mix-chip '+cls+(off?' off':'')+'"><span class="gc-mix-l">'+lbl+'</span><span class="gc-mix-n"><b>'+a[0]+'</b><i>/'+a[1]+'</i></span></div>';}
      html+='<div class="gc-mix"><div class="gc-mix-h">Composição ideal da vitrine <span>· entrou / alvo</span>'+_gcInfoBtn('bcg')+'</div><div class="gc-mix-row">'+chips+'</div></div>';
      i++;continue;
    }
    if(/^\s*\|.*\|\s*$/.test(ln)&&i+1<lines.length&&/^\s*\|[\s:|-]+\|\s*$/.test(lines[i+1])){
      const cells=r=>r.trim().replace(/^\||\|$/g,'').split('|').map(c=>c.trim());
      const head=cells(ln);i+=2;let body='';const rawRows=[];
      while(i<lines.length&&/^\s*\|.*\|\s*$/.test(lines[i])){const cs=cells(lines[i]);rawRows.push(cs.map(_gcPlain));body+='<tr>'+cs.map(c=>'<td>'+_gcCell(c)+'</td>').join('')+'</tr>';i++;}
      const idxTab=_gcTabelas.length;_gcTabelas.push({head:head.map(_gcPlain),rows:rawRows});
      html+='<div class="gc-tw"><div class="gc-tw-bar"><button type="button" class="gc-xls-btn" onclick="exportarTabelaGc('+idxTab+')" title="Exportar esta planilha em Excel (.xlsx)"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Exportar XLS</button></div><div class="gc-tw-scroll"><table><thead><tr>'+head.map(h=>{const ht=String(h).trim();const ex=ht==='BCG'?_gcInfoBtn('bcg'):(ht==='Público'?_gcInfoBtn('publico'):'');return '<th>'+_gcInline(h)+ex+'</th>';}).join('')+'</tr></thead><tbody>'+body+'</tbody></table></div></div>';continue;
    }
    if(/^\s*[-*]\s+/.test(ln)){let it='';while(i<lines.length&&/^\s*[-*]\s+/.test(lines[i])){it+='<li>'+_gcInline(lines[i].replace(/^\s*[-*]\s+/,''))+'</li>';i++;}html+='<ul>'+it+'</ul>';continue;}
    if(/^\s*\d+\.\s+/.test(ln)){let it='';while(i<lines.length&&/^\s*\d+\.\s+/.test(lines[i])){it+='<li>'+_gcInline(lines[i].replace(/^\s*\d+\.\s+/,''))+'</li>';i++;}html+='<ol>'+it+'</ol>';continue;}
    if(ln.trim()===''){i++;continue;}
    html+='<p>'+_gcInline(ln)+'</p>';i++;
  }
  return html;
}
async function loadGestao(){
  const body=document.getElementById('gc-body');
  body.innerHTML='<div class="gc-empty"><h3>Carregando…</h3></div>';
  const{data,error}=await sbClient.from('gestao_comercial_briefings')
    .select('rodada,periodo,resumo,conteudo,dados_json,created_at')
    .order('created_at',{ascending:false}).limit(20);
  if(error){body.innerHTML='<div class="gc-empty"><h3>Erro ao carregar</h3><p>'+_npEsc(error.message)+'</p></div>';return;}
  _gcData=data||[];
  const sel=document.getElementById('gc-select');sel.textContent='';
  if(!_gcData.length){body.innerHTML='<div class="gc-empty"><h3>Nenhum briefing ainda</h3><p>O gestor comercial publica toda segunda-feira.</p></div>';return;}
  _gcData.forEach((b,idx)=>{const o=document.createElement('option');o.value=idx;o.textContent=(b.rodada||'').slice(0,10);sel.appendChild(o);});
  _gcRenderIdx(0);
}
function _gcRenderIdx(idx){const b=_gcData[idx];if(b)_gcRender(b);}
function _gcRender(b){
  const dj=b.dados_json||{};const canais=dj.canaisFoco||[];
  const diaPct=(dj.diaDoMes&&dj.diasNoMes)?Math.round(dj.diaDoMes/dj.diasNoMes*100):null;
  const heroRing=diaPct!=null?_gcRing(96,42,diaPct,'gc-hero-ring',(dj.diaDoMes+'/'+dj.diasNoMes),'dias do mês'):'';
  const sub=[(dj.diaDoMes?('Dia '+dj.diaDoMes+' de '+dj.diasNoMes):''),(dj.totalPedidosMes!=null?(dj.totalPedidosMes+' pedidos no mês'):'')].filter(Boolean).join('  ·  ');
  let html='<div class="gc-hero"><div class="gc-hero-l">'
    +'<div class="gc-hero-over">Briefing do Gestor Comercial · IA</div>'
    +'<div class="gc-hero-title">'+_npEsc(b.periodo||'')+'</div>'
    +(sub?'<div class="gc-hero-sub">'+_npEsc(sub)+'</div>':'')+'</div>'+heroRing+'</div>';
  if(b.resumo)html+='<div class="gc-resumo"><b>Resumo da semana</b>'+_gcInline(b.resumo)+'</div>';
  if(canais.length)html+='<div class="gc-kpis">'+canais.map(c=>{
    const st=c.status==='adiantado'?'adiantado':'atrasado';
    const ring=_gcRing(84,37,c.percentMeta||0,'gck-ring',(c.percentMeta||0)+'%','da meta');
    return '<div class="gck '+st+'"><div class="gck-top"><span class="gck-canal">'+_npEsc(c.canal)+'</span><span class="gck-pill">'+st+'</span></div>'
      +'<div class="gck-mid">'+ring
      +'<div class="gck-proj"><div class="gck-proj-l">Projeção de fechamento'+_gcInfoBtn('projecao')+'</div><div class="gck-proj-v">'+_gcFmtR(c.projecaoFechamento)+'</div></div></div>'
      +'<div class="gck-rows"><div class="gck-row"><span>Realizado</span><b>'+_gcFmtR(c.realizado)+'</b></div>'
      +'<div class="gck-row"><span>Meta do mês</span><b>'+_gcFmtR(c.metaValor)+'</b></div></div></div>';
  }).join('')+'</div>';
  html+='<div class="gc-report">'+_gcReportCards(b.conteudo||'')+'</div>';
  document.getElementById('gc-body').innerHTML=html;
}
// Quebra o markdown do relatório em CARDS por seção (## ), cada um full-width com cabeçalho numerado.
function _gcReportCards(md){
  const lines=String(md||'').replace(/\r/g,'').split('\n');
  const secs=[]; let cur=null;
  for(const ln of lines){
    const h2=ln.match(/^##\s+(?!#)(.+)/);
    if(h2){ cur={title:h2[1].trim(),body:[]}; secs.push(cur); continue; }
    if(/^#\s+/.test(ln)||/^RESUMO:/.test(ln)) continue;
    if(!cur){ cur={title:null,body:[]}; secs.push(cur); }
    cur.body.push(ln);
  }
  let n=0;
  const html=secs.map(s=>{
    const body=_gcMarkdown(s.body.join('\n'));
    if(!s.title && !body.replace(/<[^>]+>/g,'').trim()) return '';
    let head='';
    if(s.title){ n++; head='<div class="gc-sec-h"><span class="gc-sec-n">'+String(n).padStart(2,'0')+'</span><h2>'+_gcInline(s.title)+'</h2></div>'; }
    return '<section class="gc-sec">'+head+'<div class="gc-sec-b">'+body+'</div></section>';
  }).join('');
  return html||_gcMarkdown(md);
}
function _gcRing(size,r,pct,cls,big,lbl){
  const c=2*Math.PI*r;const off=c*(1-Math.max(0,Math.min(100,Number(pct)||0))/100);
  return '<div class="'+cls+'"><svg viewBox="0 0 '+size+' '+size+'">'
    +'<circle class="trk" cx="'+(size/2)+'" cy="'+(size/2)+'" r="'+r+'"/>'
    +'<circle class="prg" cx="'+(size/2)+'" cy="'+(size/2)+'" r="'+r+'" style="stroke-dasharray:'+c.toFixed(1)+';stroke-dashoffset:'+off.toFixed(1)+'"/></svg>'
    +'<div class="'+cls+'-c"><b>'+_npEsc(big)+'</b><span>'+_npEsc(lbl)+'</span></div></div>';
}

// Equivalente ao onchange="_gcRenderIdx(this.value)" do <select> do legado.
function onSelectEdicao(e){ _gcRenderIdx(e.target.value) }

function voltar(){ router.push({ name: 'inicio' }) }

// Cluster de funções chamadas via onclick="..." dentro do HTML gerado em runtime
// (innerHTML de #gc-body e dos dois modais criados por createElement). Conferido
// por grep no legado (nenhuma outra função _gc*/gc* é referenciada por
// onclick="..."/onchange="..." além destas). Os fechamentos de modal usam
// document.getElementById(...).classList.remove('open') diretamente no atributo
// onclick — não chamam nenhuma função, então não precisam de exposição.
Object.assign(window, {
  gcAbrirItem,
  gcInfo,
  _gcRenderIdx,
  exportarTabelaGc,
})

// Equivalente ao openGestao() do legado, menos o toggle de tela por display
// (o router faz) e o sessionStorage.setItem('rbv-screen',...) (idem).
onMounted(() => {
  if (!hasPermission('gestor')) {
    adminToast('Sem acesso', false)
    router.push({ name: 'inicio' })
    return
  }
  loadGestao()
  _gcFontScale()
  conferirSeGerencioAlgumTime()
})
</script>

<style scoped>
/* Porte das regras .gc- e .gck- (todas as classes) e #gestao-comercial-screen
   (legacy/index.html L1554-1701), verbatim. #gestao-comercial-screen vira .tela-gestao-comercial
   (sem display:none — a visibilidade é do router; mantida a var --gc-fs usada
   pelos calc(px*var(--gc-fs,1)) do zoom de fonte). Praticamente todo o corpo
   (.gc-body pra baixo) é preenchido via innerHTML (loadGestao/_gcRender/
   _gcReportCards/_gcMarkdown) ou createElement (os 2 modais: gc-info-modal via
   gcInfo(), gc-item-modal via gcAbrirItem()), por isso os seletores usam
   :deep(). NÃO inclui .zoomctl/.zoomctl-val — já são globais em
   estilos-globais.css (o toggle de fonte só anexa a div, o CSS já existe). */
/* Fundo TRANSPARENTE: o #bg-shapes (degradê + ícones) fica fixo atrás de tudo
   pra aparecer, e o body já pinta a cor base nos DOIS temas. Pintar cor sólida
   aqui tapava a decoração e ainda deixava uma faixa visível onde a tela
   terminava. */
.tela-gestao-comercial{display:flex;flex-direction:column;min-height:100vh;background:transparent;--gc-fs:1;}
.tela-gestao-comercial :deep(.gc-topbar){display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 26px;border-bottom:1px solid var(--border);background:var(--surface);position:sticky;top:0;z-index:20;}
.tela-gestao-comercial :deep(.gc-back){display:inline-flex;align-items:center;gap:7px;background:none;border:none;color:var(--muted);font-family:var(--fonte-principal);font-size:calc(11px*var(--gc-fs,1));font-weight:600;cursor:pointer;text-transform:uppercase;letter-spacing:1.5px;}
.tela-gestao-comercial :deep(.gc-back:hover){color:var(--text);}
.tela-gestao-comercial :deep(.gc-title){font-family:var(--fonte-principal);font-size:calc(15px*var(--gc-fs,1));font-weight:500;letter-spacing:3px;text-transform:uppercase;color:var(--text);}
.tela-gestao-comercial :deep(.gc-edicao){display:flex;align-items:center;gap:8px;}
.tela-gestao-comercial :deep(.gc-edicao-lbl){font-size:calc(10px*var(--gc-fs,1));color:var(--muted);text-transform:uppercase;letter-spacing:1px;}
.tela-gestao-comercial :deep(.gc-edicao select){font-family:var(--fonte-principal);font-size:calc(11px*var(--gc-fs,1));color:var(--text);border:1px solid var(--border);border-radius:7px;padding:5px 9px;background:var(--surface);cursor:pointer;}
/* Abas Briefing / Relatórios */
.tela-gestao-comercial .gc-tabs{display:flex;gap:4px;width:100%;max-width:none;box-sizing:border-box;padding:14px clamp(20px,2.8vw,46px) 0;}
.tela-gestao-comercial .gc-tabs button{appearance:none;background:none;border:none;border-bottom:2px solid transparent;padding:9px 16px;font-family:var(--fonte-principal);font-size:calc(13px*var(--gc-fs,1));font-weight:500;letter-spacing:1.4px;text-transform:uppercase;color:var(--muted);cursor:pointer;transition:color .15s ease,border-color .15s ease;}
.tela-gestao-comercial .gc-tabs button:hover{color:var(--text);}
.tela-gestao-comercial .gc-tabs button.on{color:var(--accent);border-bottom-color:var(--accent);}
/* Sem teto de largura: a tela usa o aparelho inteiro. O `max-width:1860px`
   que estava aqui deixava 792px vazios num monitor de 2560 e 1672px — meia
   tela — num ultrawide. O respiro das laterais vem do padding, que ja cresce
   junto com a tela. */
.tela-gestao-comercial :deep(.gc-body){flex:1;width:100%;max-width:none;box-sizing:border-box;padding:clamp(22px,2vw,34px) clamp(20px,2.8vw,46px) 96px;}
/* Hero com gradiente + anel de progresso do mês */
.tela-gestao-comercial :deep(.gc-hero){position:relative;overflow:hidden;border-radius:var(--radius-xl);padding:28px 34px;margin-bottom:26px;background:linear-gradient(135deg,#0f172a 0%,#1e3a5f 100%);color:#fff;display:flex;align-items:center;justify-content:space-between;gap:24px;box-shadow:var(--shadow-md);}
.tela-gestao-comercial :deep(.gc-hero::after){content:'';position:absolute;right:-70px;top:-70px;width:260px;height:260px;border-radius:50%;background:radial-gradient(circle,rgba(79,124,255,.35),transparent 70%);pointer-events:none;}
.tela-gestao-comercial :deep(.gc-hero-l){position:relative;z-index:1;}
.tela-gestao-comercial :deep(.gc-hero-over){font-family:var(--fonte-principal);font-size:calc(10px*var(--gc-fs,1));font-weight:700;letter-spacing:3px;text-transform:uppercase;color:rgba(255,255,255,.62);}
.tela-gestao-comercial :deep(.gc-hero-title){font-family:var(--fonte-principal);font-weight:800;font-size:calc(clamp(26px,3.6vw,42px)*var(--gc-fs,1));line-height:1.04;margin:8px 0 7px;}
.tela-gestao-comercial :deep(.gc-hero-sub){font-size:calc(13px*var(--gc-fs,1));color:rgba(255,255,255,.80);font-variant-numeric:tabular-nums;}
.tela-gestao-comercial :deep(.gc-hero-ring){position:relative;z-index:1;flex-shrink:0;width:96px;height:96px;}
.tela-gestao-comercial :deep(.gc-hero-ring svg){width:96px;height:96px;transform:rotate(-90deg);}
.tela-gestao-comercial :deep(.gc-hero-ring .trk){fill:none;stroke:rgba(255,255,255,.16);stroke-width:9;}
.tela-gestao-comercial :deep(.gc-hero-ring .prg){fill:none;stroke:#5b8cff;stroke-width:9;stroke-linecap:round;}
.tela-gestao-comercial :deep(.gc-hero-ring-c){position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;}
.tela-gestao-comercial :deep(.gc-hero-ring-c b){font-family:var(--fonte-dados);font-size:calc(23px*var(--gc-fs,1));font-weight:600;line-height:1;}
.tela-gestao-comercial :deep(.gc-hero-ring-c span){font-size:calc(8px*var(--gc-fs,1));letter-spacing:1px;text-transform:uppercase;color:rgba(255,255,255,.6);margin-top:3px;}
/* Resumo executivo */
.tela-gestao-comercial :deep(.gc-resumo){position:relative;background:linear-gradient(135deg,var(--accent-light),transparent 72%);border:1px solid var(--accent-mid);border-radius:var(--radius-xl);padding:20px 24px;margin-bottom:28px;font-size:calc(16px*var(--gc-fs,1));line-height:1.62;color:var(--text);}
.tela-gestao-comercial :deep(.gc-resumo b){color:var(--accent);text-transform:uppercase;font-size:calc(10px*var(--gc-fs,1));font-weight:700;letter-spacing:1.8px;display:block;margin-bottom:8px;}
/* Cards de canal com anel de progresso */
.tela-gestao-comercial :deep(.gc-kpis){display:grid;grid-template-columns:repeat(auto-fit,minmax(252px,1fr));gap:16px;margin-bottom:30px;}
.tela-gestao-comercial :deep(.gck){position:relative;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-xl);padding:20px 20px 16px;box-shadow:var(--shadow-sm);transition:transform .18s ease,box-shadow .18s ease,border-color .18s ease;overflow:hidden;}
.tela-gestao-comercial :deep(.gck::before){content:'';position:absolute;left:0;top:0;bottom:0;width:4px;background:var(--muted);}
.tela-gestao-comercial :deep(.gck.adiantado::before){background:linear-gradient(180deg,var(--green),var(--green));}
.tela-gestao-comercial :deep(.gck.atrasado::before){background:linear-gradient(180deg,var(--red),#e11d48);}
.tela-gestao-comercial :deep(.gck:hover){transform:translateY(-4px);box-shadow:var(--shadow-lg);border-color:var(--accent-mid);}
.tela-gestao-comercial :deep(.gck-top){display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:10px;}
.tela-gestao-comercial :deep(.gck-canal){font-family:var(--fonte-principal);font-size:calc(13.5px*var(--gc-fs,1));font-weight:500;letter-spacing:.8px;text-transform:uppercase;color:var(--text);line-height:1.25;}
.tela-gestao-comercial :deep(.gck-pill){flex-shrink:0;font-size:calc(9px*var(--gc-fs,1));font-weight:700;letter-spacing:.5px;text-transform:uppercase;padding:3px 9px;border-radius:20px;background:var(--surface2);color:var(--muted);}
.tela-gestao-comercial :deep(.gck.atrasado .gck-pill){background:rgba(244,63,94,.12);color:var(--red);}
.tela-gestao-comercial :deep(.gck.adiantado .gck-pill){background:rgba(34,197,94,.14);color:var(--green);}
.tela-gestao-comercial :deep(.gck-mid){display:flex;align-items:center;gap:16px;margin-bottom:14px;}
.tela-gestao-comercial :deep(.gck-ring){position:relative;width:84px;height:84px;flex-shrink:0;}
.tela-gestao-comercial :deep(.gck-ring svg){width:84px;height:84px;transform:rotate(-90deg);}
.tela-gestao-comercial :deep(.gck-ring .trk){fill:none;stroke:var(--surface2);stroke-width:9;}
.tela-gestao-comercial :deep(.gck-ring .prg){fill:none;stroke-width:9;stroke-linecap:round;}
.tela-gestao-comercial :deep(.gck.adiantado .gck-ring .prg){stroke:var(--green);}
.tela-gestao-comercial :deep(.gck.atrasado .gck-ring .prg){stroke:var(--red);}
.tela-gestao-comercial :deep(.gck-ring-c){position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;}
.tela-gestao-comercial :deep(.gck-ring-c b){font-family:var(--fonte-dados);font-size:calc(21px*var(--gc-fs,1));font-weight:600;line-height:1;color:var(--text);font-variant-numeric:tabular-nums;}
.tela-gestao-comercial :deep(.gck-ring-c span){font-size:calc(7.5px*var(--gc-fs,1));letter-spacing:.5px;text-transform:uppercase;color:var(--muted);margin-top:2px;}
.tela-gestao-comercial :deep(.gck-proj){flex:1;min-width:0;}
.tela-gestao-comercial :deep(.gck-proj-l){font-size:calc(9px*var(--gc-fs,1));letter-spacing:1px;text-transform:uppercase;color:var(--muted);line-height:1.3;}
.tela-gestao-comercial :deep(.gck-proj-v){font-family:var(--fonte-dados);font-size:calc(20px*var(--gc-fs,1));font-weight:600;color:var(--text);font-variant-numeric:tabular-nums;line-height:1.1;margin-top:3px;}
.tela-gestao-comercial :deep(.gck-rows){border-top:1px solid var(--border);padding-top:11px;}
.tela-gestao-comercial :deep(.gck-row){display:flex;justify-content:space-between;align-items:center;font-size:calc(12px*var(--gc-fs,1));color:var(--muted);margin-top:6px;}
.tela-gestao-comercial :deep(.gck-row:first-child){margin-top:0;}
.tela-gestao-comercial :deep(.gck-row b){color:var(--text);font-weight:600;font-variant-numeric:tabular-nums;}
/* Relatório = pilha de cards de seção (full-width, lateralizado) */
.tela-gestao-comercial :deep(.gc-report){display:flex;flex-direction:column;gap:18px;}
.tela-gestao-comercial :deep(.gc-sec){background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-xl);padding:clamp(22px,2vw,32px) clamp(24px,2.6vw,44px) clamp(22px,2vw,34px);box-shadow:var(--shadow-sm);transition:box-shadow .18s ease,border-color .18s ease;}
.tela-gestao-comercial :deep(.gc-sec:hover){box-shadow:var(--shadow-md);border-color:var(--accent-mid);}
.tela-gestao-comercial :deep(.gc-sec-h){display:flex;align-items:center;gap:14px;margin-bottom:18px;padding-bottom:15px;border-bottom:1px solid var(--border);}
.tela-gestao-comercial :deep(.gc-sec-n){font-family:var(--fonte-dados);font-size:calc(14px*var(--gc-fs,1));font-weight:600;color:var(--sobre-cor);background:linear-gradient(135deg,var(--accent),var(--accent));min-width:32px;height:32px;border-radius:9px;display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 3px 10px var(--accent-mid);}
.tela-gestao-comercial :deep(.gc-report .gc-sec-h h2){font-family:var(--fonte-principal);font-size:calc(clamp(16px,1.7vw,20px)*var(--gc-fs,1));font-weight:600;letter-spacing:.6px;text-transform:uppercase;color:var(--text);margin:0;border:none;padding:0;display:block;}
.tela-gestao-comercial :deep(.gc-sec-b>*:first-child){margin-top:0;}
.tela-gestao-comercial :deep(.gc-sec-b>*:last-child){margin-bottom:0;}
.tela-gestao-comercial :deep(.gc-report h1){display:none;}
.tela-gestao-comercial :deep(.gc-report h2){font-family:var(--fonte-principal);font-size:calc(19px*var(--gc-fs,1));font-weight:600;letter-spacing:.5px;text-transform:uppercase;color:var(--text);margin:32px 0 14px;padding-bottom:8px;border-bottom:2px solid var(--accent);display:inline-block;}
.tela-gestao-comercial :deep(.gc-report h2:first-child){margin-top:0;}
.tela-gestao-comercial :deep(.gc-report h3){font-family:var(--fonte-principal);font-size:calc(15.5px*var(--gc-fs,1));font-weight:700;color:var(--text);margin:20px 0 7px;}
.tela-gestao-comercial :deep(.gc-report p){font-size:calc(15px*var(--gc-fs,1));line-height:1.72;color:var(--text);margin:11px 0;}
.tela-gestao-comercial :deep(.gc-report ul),.tela-gestao-comercial :deep(.gc-report ol){margin:10px 0 14px 2px;padding-left:22px;}
.tela-gestao-comercial :deep(.gc-report li){font-size:calc(15px*var(--gc-fs,1));line-height:1.68;color:var(--text);margin:7px 0;}
.tela-gestao-comercial :deep(.gc-report li::marker){color:var(--accent);}
.tela-gestao-comercial :deep(.gc-report strong){color:var(--text);font-weight:700;}
.tela-gestao-comercial :deep(.gc-tw){margin:18px 0;border:1px solid var(--border);border-radius:14px;overflow:hidden;box-shadow:var(--shadow-sm);}
.tela-gestao-comercial :deep(.gc-tw-bar){display:flex;justify-content:flex-end;padding:8px 10px;background:var(--surface2);border-bottom:1px solid var(--border);}
.tela-gestao-comercial :deep(.gc-xls-btn){display:inline-flex;align-items:center;gap:6px;font-family:var(--fonte-principal);font-size:max(9px, calc(11.5px * var(--escala-texto, 1)));font-weight:600;color:var(--green);background:rgba(34,197,94,.10);border:1px solid rgba(34,197,94,.35);border-radius:8px;padding:6px 12px;cursor:pointer;transition:all .15s ease;letter-spacing:.2px;}
.tela-gestao-comercial :deep(.gc-xls-btn:hover){background:rgba(34,197,94,.18);border-color:rgba(34,197,94,.55);transform:translateY(-1px);}
.tela-gestao-comercial :deep(.gc-xls-btn svg){flex-shrink:0;}
.tela-gestao-comercial :deep(.gc-tw-scroll){overflow-x:auto;-webkit-overflow-scrolling:touch;}
.tela-gestao-comercial :deep(.gc-report table){width:100%;border-collapse:collapse;margin:0;font-size:calc(13.5px*var(--gc-fs,1));display:table;}
.tela-gestao-comercial :deep(.gc-report thead th){background:linear-gradient(180deg,var(--accent-light),transparent);text-align:left;padding:14px 18px;font-family:var(--fonte-principal);font-size:calc(10.5px*var(--gc-fs,1));font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:var(--accent-forte);border-bottom:2px solid var(--accent-mid);white-space:nowrap;}
.tela-gestao-comercial :deep(.gc-report tbody td){padding:13px 18px;border-bottom:1px solid var(--border);color:var(--text);font-variant-numeric:tabular-nums;vertical-align:middle;line-height:1.45;white-space:nowrap;}
.tela-gestao-comercial :deep(.gc-report tbody tr){transition:background .14s ease;}
.tela-gestao-comercial :deep(.gc-report tbody tr:nth-child(even)){background:rgba(125,125,135,.045);}
.tela-gestao-comercial :deep(.gc-report tbody tr:hover){background:var(--accent-light);}
.tela-gestao-comercial :deep(.gc-report tbody tr:last-child td){border-bottom:none;}
.tela-gestao-comercial :deep(.gc-report tbody td:first-child){font-weight:600;}
.tela-gestao-comercial :deep(.gc-bcg){display:inline-flex;align-items:center;gap:5px;font-family:var(--fonte-principal);font-size:calc(10px*var(--gc-fs,1));font-weight:700;letter-spacing:.3px;text-transform:uppercase;padding:3px 9px 3px 7px;border-radius:20px;white-space:nowrap;}
.tela-gestao-comercial :deep(.gc-bcg::before){content:'';width:7px;height:7px;border-radius:50%;background:currentColor;}
.tela-gestao-comercial :deep(.gc-bcg.estrela){color:#b8860b;background:rgba(212,160,23,.14);}
.tela-gestao-comercial :deep(.gc-bcg.vaca){color:var(--green);background:rgba(34,197,94,.13);}
.tela-gestao-comercial :deep(.gc-bcg.interrogacao){color:var(--accent-forte);background:var(--accent-light);}
.tela-gestao-comercial :deep(.gc-bcg.abacaxi){color:var(--red);background:rgba(244,63,94,.12);}
.tela-gestao-comercial :deep(.gc-lupa){display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--accent);cursor:pointer;margin-left:6px;vertical-align:middle;padding:0;transition:background .15s,transform .15s;flex-shrink:0;}
.tela-gestao-comercial :deep(.gc-lupa:hover){background:var(--accent-light);transform:scale(1.08);}
.tela-gestao-comercial :deep(.gc-lupa svg){width:13px;height:13px;}
.tela-gestao-comercial :deep(.gc-im){position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:10000;display:none;align-items:center;justify-content:center;padding:20px;animation:npfade .15s ease;padding-top:max(16px,env(safe-area-inset-top));padding-bottom:max(16px,env(safe-area-inset-bottom));padding-left:max(12px,env(safe-area-inset-left));padding-right:max(12px,env(safe-area-inset-right));touch-action:none;overscroll-behavior:contain;}
.tela-gestao-comercial :deep(.gc-im) > *{overscroll-behavior:contain;touch-action:pan-y;}
.tela-gestao-comercial :deep(.gc-im.open){display:flex;}
.tela-gestao-comercial :deep(.gc-im-card){position:relative;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-xl);box-shadow:var(--shadow-lg);width:min(440px,94vw);overflow:hidden;}
.tela-gestao-comercial :deep(.gc-im-x){position:absolute;top:10px;right:10px;width:30px;height:30px;border-radius:50%;border:none;background:rgba(0,0,0,.45);color:#fff;cursor:pointer;font-size:calc(13px*var(--gc-fs,1));z-index:2;display:flex;align-items:center;justify-content:center;}
.tela-gestao-comercial :deep(.gc-im-img){width:100%;height:320px;background:var(--surface2);display:flex;align-items:center;justify-content:center;}
.tela-gestao-comercial :deep(.gc-im-img img){width:100%;height:100%;object-fit:contain;}
.tela-gestao-comercial :deep(.gc-im-img span){color:var(--muted);font-size:calc(11px*var(--gc-fs,1));text-transform:uppercase;letter-spacing:1.5px;}
.tela-gestao-comercial :deep(.gc-im-info){padding:18px 22px 24px;}
.tela-gestao-comercial :deep(.gc-im-sku){font-family:var(--fonte-principal);font-size:calc(10px*var(--gc-fs,1));letter-spacing:1.5px;text-transform:uppercase;color:var(--accent);font-weight:700;}
.tela-gestao-comercial :deep(.gc-im-nome){font-family:var(--fonte-principal);font-size:calc(21px*var(--gc-fs,1));font-weight:700;color:var(--text);margin:6px 0;line-height:1.2;}
.tela-gestao-comercial :deep(.gc-im-preco){font-family:var(--fonte-dados);font-size:calc(23px*var(--gc-fs,1));font-weight:600;color:var(--text);font-variant-numeric:tabular-nums;}
.tela-gestao-comercial :deep(.gc-im-ph){padding:54px 24px;text-align:center;color:var(--muted);font-size:calc(14px*var(--gc-fs,1));line-height:1.5;}
.tela-gestao-comercial :deep(.gc-mix){background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:14px 16px;margin:4px 0 18px;box-shadow:var(--shadow-sm);}
.tela-gestao-comercial :deep(.gc-mix-h){font-family:var(--fonte-principal);font-size:calc(10px*var(--gc-fs,1));font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--text);margin-bottom:11px;}
.tela-gestao-comercial :deep(.gc-mix-h span){color:var(--muted);font-weight:600;letter-spacing:.5px;}
.tela-gestao-comercial :deep(.gc-mix-row){display:grid;grid-template-columns:repeat(auto-fit,minmax(132px,1fr));gap:10px;}
.tela-gestao-comercial :deep(.gc-mix-chip){display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 13px 10px 15px;border-radius:11px;border:1px solid var(--border);background:var(--surface2);position:relative;overflow:hidden;}
.tela-gestao-comercial :deep(.gc-mix-chip::before){content:'';position:absolute;left:0;top:0;bottom:0;width:4px;background:currentColor;}
.tela-gestao-comercial :deep(.gc-mix-chip.estrela){color:#b8860b;}
.tela-gestao-comercial :deep(.gc-mix-chip.vaca){color:var(--green);}
.tela-gestao-comercial :deep(.gc-mix-chip.interrogacao){color:var(--accent);}
.tela-gestao-comercial :deep(.gc-mix-chip.abacaxi){color:var(--red);}
.tela-gestao-comercial :deep(.gc-mix-l){font-family:var(--fonte-principal);font-size:calc(11px*var(--gc-fs,1));font-weight:700;text-transform:uppercase;letter-spacing:.3px;color:var(--text);}
.tela-gestao-comercial :deep(.gc-mix-n){font-family:var(--fonte-dados);font-variant-numeric:tabular-nums;color:currentColor;white-space:nowrap;}
.tela-gestao-comercial :deep(.gc-mix-n b){font-size:calc(19px*var(--gc-fs,1));font-weight:600;}
.tela-gestao-comercial :deep(.gc-mix-n i){font-style:normal;color:var(--muted);font-size:calc(13px*var(--gc-fs,1));}
.tela-gestao-comercial :deep(.gc-mix-chip.off){box-shadow:inset 0 0 0 1px currentColor;}
.tela-gestao-comercial :deep(.gc-mix-chip.off .gc-mix-l::after){content:' ⚠';}
.tela-gestao-comercial :deep(.gc-info){display:inline-flex;align-items:center;justify-content:center;width:17px;height:17px;border-radius:50%;border:none;background:var(--accent-light);color:var(--accent-forte);font-family:var(--fonte-principal);font-size:calc(11px*var(--gc-fs,1));font-weight:800;cursor:pointer;margin-left:6px;vertical-align:middle;padding:0;line-height:1;transition:background .15s,transform .15s;flex-shrink:0;}
.tela-gestao-comercial :deep(.gc-info:hover){background:var(--accent);color:var(--sobre-cor);transform:scale(1.12);}
.tela-gestao-comercial :deep(.gc-infomodal){position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:10001;display:none;align-items:center;justify-content:center;padding:20px;animation:npfade .15s ease;padding-top:max(16px,env(safe-area-inset-top));padding-bottom:max(16px,env(safe-area-inset-bottom));padding-left:max(12px,env(safe-area-inset-left));padding-right:max(12px,env(safe-area-inset-right));touch-action:none;overscroll-behavior:contain;}
.tela-gestao-comercial :deep(.gc-infomodal) > *{overscroll-behavior:contain;touch-action:pan-y;}
.tela-gestao-comercial :deep(.gc-infomodal.open){display:flex;}
.tela-gestao-comercial :deep(.gc-infomodal-card){position:relative;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-xl);box-shadow:var(--shadow-lg);width:min(620px,96vw);max-height:88vh;overflow:auto;}
.tela-gestao-comercial :deep(.gc-infomodal-body){padding:26px 30px 30px;}
.tela-gestao-comercial :deep(.gc-infomodal-h){font-family:var(--fonte-principal);font-size:calc(23px*var(--gc-fs,1));font-weight:800;color:var(--text);margin:0 0 14px;line-height:1.15;padding-right:30px;}
.tela-gestao-comercial :deep(.gc-infomodal-body h4){font-family:var(--fonte-principal);font-size:calc(12px*var(--gc-fs,1));font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:var(--accent);margin:18px 0 7px;}
.tela-gestao-comercial :deep(.gc-infomodal-body p){font-size:calc(14px*var(--gc-fs,1));line-height:1.62;color:var(--text);margin:9px 0;}
.tela-gestao-comercial :deep(.gc-infomodal-body ul){margin:8px 0;padding-left:20px;}
.tela-gestao-comercial :deep(.gc-infomodal-body li){font-size:calc(14px*var(--gc-fs,1));line-height:1.55;color:var(--text);margin:5px 0;}
.tela-gestao-comercial :deep(.gc-infomodal-body code){background:var(--surface2);padding:2px 6px;border-radius:5px;font-size:calc(12.5px*var(--gc-fs,1));font-family:ui-monospace,SFMono-Regular,Menlo,monospace;}
.tela-gestao-comercial :deep(.gc-infomodal-body table){width:100%;border-collapse:collapse;margin:12px 0;font-size:calc(13px*var(--gc-fs,1));}
.tela-gestao-comercial :deep(.gc-infomodal-body th){text-align:left;padding:8px 10px;background:var(--surface2);border-bottom:2px solid var(--border);font-size:calc(11px*var(--gc-fs,1));text-transform:uppercase;letter-spacing:.5px;color:var(--muted);}
.tela-gestao-comercial :deep(.gc-infomodal-body td){padding:8px 10px;border-bottom:1px solid var(--border);color:var(--text);vertical-align:top;}
.tela-gestao-comercial :deep(.gc-infomodal-body .ex){background:var(--accent-light);border-left:3px solid var(--accent);border-radius:8px;padding:11px 14px;font-size:calc(13px*var(--gc-fs,1));margin:13px 0;color:var(--text);line-height:1.55;}
.tela-gestao-comercial :deep(.gc-infomodal-body small){color:var(--muted);font-size:calc(12px*var(--gc-fs,1));}
.tela-gestao-comercial :deep(.gc-empty){text-align:center;padding:60px 20px;color:var(--muted);font-family:var(--fonte-principal);}
.tela-gestao-comercial :deep(.gc-empty h3){font-family:var(--fonte-principal);font-weight:500;letter-spacing:1px;color:var(--text);margin:0 0 6px;}
@media(max-width:920px){.tela-gestao-comercial :deep(.gc-kpis){grid-template-columns:repeat(2,1fr);}}
@media(max-width:560px){
  .tela-gestao-comercial :deep(.gc-kpis){grid-template-columns:1fr;}
  .tela-gestao-comercial :deep(.gc-body){padding:18px 12px 50px;}
  .tela-gestao-comercial :deep(.gc-topbar){padding:12px 14px;}
  .tela-gestao-comercial :deep(.gc-sec){padding:18px 14px;}
  .tela-gestao-comercial :deep(.gc-report table){font-size:calc(11px*var(--gc-fs,1));}
  .tela-gestao-comercial :deep(.gc-report thead th){padding:8px 9px;font-size:calc(9px*var(--gc-fs,1));letter-spacing:.3px;}
  .tela-gestao-comercial :deep(.gc-report tbody td){padding:7px 9px;}
  .tela-gestao-comercial :deep(.gc-tw){border-radius:10px;}

  /* A topbar era UMA linha de tres itens sem quebra. No celular o terceiro —
     o seletor de "Edicao", que escolhe QUAL semana voce esta lendo — ficava
     fora da tela: borda direita em 471px num aparelho de 375. Medido, nao
     suposto. Agora ela quebra: em cima voltar+logo+titulo, embaixo o seletor
     ocupando a largura toda, que e onde o polegar alcanca. */
  .tela-gestao-comercial :deep(.gc-topbar){flex-wrap:wrap;row-gap:10px;}
  .tela-gestao-comercial :deep(.gc-tb-left){flex:0 0 auto;}
  .tela-gestao-comercial :deep(.gc-title){flex:1 1 auto;min-width:0;text-align:right;font-size:calc(12px*var(--gc-fs,1));letter-spacing:1.5px;}
  .tela-gestao-comercial :deep(.gc-edicao){flex:1 0 100%;gap:10px;}
  /* 16px no seletor: abaixo disso o iPhone da zoom sozinho ao tocar, e a tela
     fica torta ate a pessoa pinçar de volta. */
  .tela-gestao-comercial :deep(.gc-edicao select){flex:1;min-width:0;font-size:max(16px, calc(16px * var(--escala-texto, 1)));padding:9px 10px;}

  /* O heroi mantinha o anel de 96px na mesma linha do titulo: sobravam 156px
     de texto num aparelho de 375, e o bloco esticava pra 220px de altura. */
  .tela-gestao-comercial :deep(.gc-hero){padding:20px 18px;gap:14px;margin-bottom:18px;}
  .tela-gestao-comercial :deep(.gc-hero-ring),
  .tela-gestao-comercial :deep(.gc-hero-ring svg){width:70px;height:70px;}
  .tela-gestao-comercial :deep(.gc-hero-ring-c b){font-size:calc(16px*var(--gc-fs,1));}
  .tela-gestao-comercial :deep(.gc-hero-ring-c span){font-size:calc(7px*var(--gc-fs,1));}
  .tela-gestao-comercial :deep(.gc-resumo){padding:16px;font-size:calc(14.5px*var(--gc-fs,1));margin-bottom:20px;}
}
</style>
