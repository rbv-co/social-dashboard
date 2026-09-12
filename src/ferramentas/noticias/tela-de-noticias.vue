<template>
  <!-- Template = HTML de #noticias-screen do legado (legacy/index.html L11966-11975),
       VERBATIM. Mantidos os id= (noticias-screen, np-meta, np-tabs, np-body) para o
       código imperativo (getElementById/createElement/innerHTML) continuar funcionando.
       Root ganha class="tela-noticias" além do id. Únicas trocas vs. legado:
       - o botão "Central" usava onclick="closeNoticias()" → agora navega pelo router;
       - as logos usavam src="midia/..." relativo → agora :src absoluto /midia/... (mesmo
         padrão de tela-inicial.vue / tela-de-login.vue, p/ o Vite não tentar resolver
         o caminho como asset em build). -->
  <div id="noticias-screen" class="tela-noticias">
    <barra-de-topo voltar="Central" titulo="Observatório" subtitulo="Portal de Notícias" @voltar="voltar">
      <template #acoes><span class="np-meta" id="np-meta">—</span></template>
    </barra-de-topo>
    <div class="np-tabs" id="np-tabs"></div>
    <div class="np-body" id="np-body"></div>
  </div>
</template>

<script setup>
import { onMounted } from 'vue'
import BarraDeTopo from '../../compartilhado/barra-de-topo.vue'
import { useRouter } from 'vue-router'
import { sbClient } from '../../compartilhado/conectar-no-banco-de-dados.js'

const router = useRouter()

// Caminho absoluto das logos (servido em produção via rewrite /midia/:path*),
// igual a tela-inicial.vue. Ligação dinâmica (:src) evita que o Vite tente
// resolver o caminho como módulo em tempo de build.
const logoClaroUrl = '/midia/LOGOTIPOBRENOPRETO.png'
const logoEscuroUrl = '/midia/LOGOTIPOBRENOBRANCO.png'

// Equivalente ao closeNoticias() do legado (que fazia display:none + showHome()).
// No Vue quem controla a visibilidade é o vue-router, então basta navegar de volta.
function voltar() {
  router.push({ name: 'inicio' })
}

// ==========================================================================
// PORTE VERBATIM do Observatório/Portal de Notícias (legacy/index.html).
// Estados + constante NP_ORDER (L9458-9459), controle de zoom reutilizável
// _rbvZoom (L9461-9478, usado pelo openNoticias original), e todo o bloco de
// helpers _np*/constantes NP_* + loadNoticias (L10925-11220). Nada foi
// reescrito p/ template reativo — segue montando HTML via
// getElementById/createElement/innerHTML, exatamente como a produção atual.
// ==========================================================================
let _npData=[], _npTab=null, _npPano=null;
const NP_ORDER=['Santa Lolla','Capodarte','Carmen Steffens','Dumond','Arezzo&Co','Schutz','Victor Hugo','Luiza Barcelos','Isla',"L'Occitane"];
// Controle de zoom reutilizável: aplica CSS zoom (reflow real) no container de conteúdo.
function _rbvZoom(key, contentId){
  const content=document.getElementById(contentId); if(!content) return;
  const screen=content.closest('[id$="-screen"]')||document.body;
  const K='rbv-zoom-'+key;
  let z=parseFloat(localStorage.getItem(K)); if(!(z>=0.7&&z<=2)) z=1;
  let ctl=screen.querySelector(':scope > .zoomctl');
  const apply=()=>{content.style.zoom=String(z);try{localStorage.setItem(K,String(z));}catch(e){}const v=ctl&&ctl.querySelector('.zoomctl-val');if(v)v.textContent=Math.round(z*100)+'%';};
  if(!ctl){
    ctl=document.createElement('div');ctl.className='zoomctl';
    const mk=(t,title,fn)=>{const b=document.createElement('button');b.type='button';b.textContent=t;b.title=title;b.onclick=fn;return b;};
    ctl.appendChild(mk('A−','Diminuir texto',()=>{z=Math.max(0.7,Math.round((z-0.1)*10)/10);apply();}));
    const val=document.createElement('span');val.className='zoomctl-val';val.title='Restaurar 100%';val.textContent='100%';val.onclick=()=>{z=1;apply();};
    ctl.appendChild(val);
    ctl.appendChild(mk('A+','Aumentar texto',()=>{z=Math.min(2,Math.round((z+0.1)*10)/10);apply();}));
    screen.appendChild(ctl);
  }
  apply();
}

let _npRod=null;
const NP_CAT_COLOR={lancamento:'var(--c-lancamento)',campanha:'var(--c-campanha)',precopromo:'var(--c-precopromo)',faturamento:'var(--c-faturamento)',expansao:'var(--c-expansao)',tendencia:'var(--c-tendencia)',estrategia:'var(--c-estrategia)',marketing:'var(--c-marketing)',design:'var(--c-design)',moda:'var(--c-moda)',bestseller:'var(--c-bestseller)',desenvolvimento:'var(--c-desenvolvimento)',instagram:'var(--c-instagram)',topviral:'var(--c-instagram)',ultimosposts:'var(--c-instagram)',reels:'var(--c-instagram)',outro:'var(--c-outro)'};
function _npCatColor(c){const s=String(c||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z]/g,'');return NP_CAT_COLOR[s]||'var(--c-outro)';}
let _npView='comercial';
function _npNorm(c){return String(c||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z]/g,'');}
// categoria → vista. Comercial & Desenvolvimento = SÓ desenvolvimento de bolsa (best-sellers, novidades,
// apostas de modelo/cor/material). Todo o resto (campanha, faturamento, expansão, M&A, IG, colunas) = Marketing.
const NP_COM=['bestseller','lancamento','desenvolvimento','produto','colecao','novidade'];
function _npVista(cat){const s=_npNorm(cat);if(s.startsWith('resumo'))return s.includes('marketing')?'marketing':'comercial';return NP_COM.some(k=>s.includes(k))?'comercial':'marketing';}
function _npIsResumo(cat){return _npNorm(cat).startsWith('resumo');}
// nome chamativo + estrela só nas seções-vitrine
const NP_SEC={bestseller:{nome:'As Mais Desejadas',star:1},lancamento:{nome:'Acabou de Chegar',star:0},instagram:{nome:'Bombou no Instagram',star:1},viral:{nome:'O Que Mais Viralizou',star:1},reels:{nome:'Reels do Momento',star:1},post:{nome:'Últimos Posts',star:0}};
function _npSecMeta(cat){const s=_npNorm(cat);for(const k in NP_SEC){if(s.includes(k))return NP_SEC[k];}return null;}
function _npViewTabsHtml(mktOnly){
  let vs=[['comercial','📊','Comercial & Desenvolvimento','campanhas · lançamentos · best-sellers'],['marketing','🎯','Marketing','conteúdo · IG · o que viraliza']];
  if(mktOnly)vs=vs.filter(v=>v[0]==='marketing').map(v=>[v[0],v[1],v[2],'marca monitorada só em conteúdo']);
  return '<div class="np-views'+(mktOnly?' np-views--solo':'')+'">'+vs.map(([k,ic,lbl,sub])=>'<button class="np-view'+(k===_npView?' active':'')+'" onclick="_npSetView(\''+k+'\')"><span class="np-view-ic">'+ic+'</span><span class="np-view-txt">'+lbl+'<small>'+sub+'</small></span></button>').join('')+'</div>';
}
function _npSetView(v){_npView=v;_npRenderBody();const b=document.getElementById('np-body');if(b)b.scrollIntoView({behavior:'smooth',block:'start'});}
function _npStar(){return '<span class="np-star">★</span>';}
function _npModSumHtml(row){
  const titulo=row.titulo||'Resumo do Módulo';
  const body=(typeof _gcMarkdown==='function')?_gcMarkdown(String(row.resumo||'')):('<p>'+_npEsc(row.resumo||'')+'</p>');
  let tags='';try{const t=_npProds(row);if(t.length&&t[0].nome)tags='<div class="np-modsum-tags">'+t.slice(0,8).map(x=>'<span class="np-modsum-tag">'+_npEsc(x.nome)+'</span>').join('')+'</div>';}catch(e){}
  const over=_npView==='marketing'?'Leitura de Marketing':'Leitura Comercial & Desenvolvimento';
  return '<section class="np-modsum">'
    +'<div class="np-modsum-over">'+_npStar()+over+'</div>'
    +'<h2 class="np-modsum-title">'+_npEsc(titulo)+'</h2>'
    +'<div class="np-modsum-body">'+body+'</div>'+tags+'</section>';
}
const NP_LOGOS={"Santa Lolla":"https://kounqtdoioootxqegkij.supabase.co/storage/v1/object/public/ig-cache/logo/santa_lolla.jpg","Arezzo&Co":"https://kounqtdoioootxqegkij.supabase.co/storage/v1/object/public/ig-cache/logo/arezzo.jpg","Schutz":"https://kounqtdoioootxqegkij.supabase.co/storage/v1/object/public/ig-cache/logo/schutzoficial.jpg","Anacapri":"https://kounqtdoioootxqegkij.supabase.co/storage/v1/object/public/ig-cache/logo/anacaprioficial.jpg","Capodarte":"https://kounqtdoioootxqegkij.supabase.co/storage/v1/object/public/ig-cache/logo/capodarte.jpg","Luz da Lua":"https://kounqtdoioootxqegkij.supabase.co/storage/v1/object/public/ig-cache/logo/luzdalua.jpg","Petite Jolie":"https://kounqtdoioootxqegkij.supabase.co/storage/v1/object/public/ig-cache/logo/petitejolie_.jpg","Jorge Bischoff":"https://kounqtdoioootxqegkij.supabase.co/storage/v1/object/public/ig-cache/logo/jorgebischoff.jpg","Dumond":"https://kounqtdoioootxqegkij.supabase.co/storage/v1/object/public/ig-cache/logo/dumondoficial.jpg","Carmen Steffens":"https://kounqtdoioootxqegkij.supabase.co/storage/v1/object/public/ig-cache/logo/carmensteffens.jpg","Isla":"https://kounqtdoioootxqegkij.supabase.co/storage/v1/object/public/ig-cache/logo/isla_oficial.jpg","Luiza Barcelos":"https://kounqtdoioootxqegkij.supabase.co/storage/v1/object/public/ig-cache/logo/luizabarcelos.jpg","Victor Hugo":"https://kounqtdoioootxqegkij.supabase.co/storage/v1/object/public/ig-cache/logo/victorhugo_oficial.jpg","L'Occitane":"https://kounqtdoioootxqegkij.supabase.co/storage/v1/object/public/ig-cache/logo/loccitane.jpg"};
function _npLogo(m){const u=NP_LOGOS[m];return (u&&/^https:\/\//.test(u))?u:'';}
async function loadNoticias(){
  const body=document.getElementById('np-body');
  body.innerHTML='<div class="np-empty"><h3>Carregando…</h3></div>';
  // a tabela cresce 1 edição/semana — busca só as ~3 rodadas mais recentes (front usa maxRod por marca)
  let recentes=[];
  // consolidado por data: carrega as ~6 edições mais recentes (≈ mês atual + anterior) p/ poder
  // puxar hero/resumo de edições passadas quando a nova vier magra
  try{const rd=await sbClient.from('noticias_concorrentes').select('rodada').order('rodada',{ascending:false}).limit(1200);
    recentes=[...new Set((rd.data||[]).map(r=>r.rodada).filter(Boolean))].slice(0,6);}catch(e){}
  let q=sbClient.from('noticias_concorrentes').select('*').order('rodada',{ascending:false}).order('destaque',{ascending:false}).order('created_at',{ascending:false});
  if(recentes.length)q=q.in('rodada',recentes);
  const{data,error}=await q;
  if(error){body.innerHTML='<div class="np-empty"><h3>Erro ao carregar</h3><p>'+_npEsc(error.message)+'</p></div>';return;}
  _npData=data||[];
  const rodadas=[...new Set(_npData.map(n=>n.rodada))].filter(Boolean).sort().reverse();
  _npRod=rodadas[0]||null;
  document.getElementById('np-meta').textContent=_npRod?('Edição '+_npFmtDate(_npRod)):'Sem dados';
  // resumão escrito do mercado (1 por edição) — pega o mais recente disponível
  try{const pr=await sbClient.from('noticias_panorama').select('rodada,conteudo_md,modelo,created_at').order('rodada',{ascending:false}).limit(1);
    _npPano=(pr.data&&pr.data[0])||null;}catch(e){_npPano=null;}
  _npRenderTabs();
}
function _npRenderTabs(){
  const marcas=[...new Set(_npData.map(n=>n.marca))];
  marcas.sort((a,b)=>{const ia=NP_ORDER.indexOf(a),ib=NP_ORDER.indexOf(b);return(ia<0?99:ia)-(ib<0?99:ib)||a.localeCompare(b);});
  if(!_npTab||(!marcas.includes(_npTab)&&_npTab!=='__pano__'))_npTab='__pano__';
  const tabsEl=document.getElementById('np-tabs');
  tabsEl.textContent='';
  const pano=document.createElement('button');
  pano.className='np-tab np-tab-pano'+(_npTab==='__pano__'?' active':'');
  pano.innerHTML='★ Panorama do Mercado';
  pano.onclick=()=>{_npTab='__pano__';_npRenderTabs();const sc=document.getElementById('noticias-screen');if(sc)sc.scrollIntoView({block:'start'});window.scrollTo({top:0,behavior:'smooth'});};
  tabsEl.appendChild(pano);
  marcas.forEach(m=>{
    const n=_npData.filter(x=>x.marca===m).length;
    const b=document.createElement('button');
    b.className='np-tab'+(m===_npTab?' active':'');
    b.innerHTML=(_npLogo(m)?'<img class="np-tab-logo" src="'+_npLogo(m)+'" alt="" onerror="this.remove()">':'')+_npEsc(m)+'<span class="np-tab-count">'+n+'</span>';
    b.onclick=()=>{_npTab=m;_npRenderTabs();const sc=document.getElementById('noticias-screen');if(sc)sc.scrollIntoView({block:'start'});window.scrollTo({top:0,behavior:'smooth'});};
    tabsEl.appendChild(b);
  });
  // separador visual entre o Panorama (sempre visível) e o seletor de marcas
  const sep=document.createElement('span');sep.className='np-tabsep';sep.textContent='·';
  tabsEl.appendChild(sep);
  // seletor de marca = dropdown (em todas as telas). Em '__pano__' mostra rótulo neutro.
  const onPano=_npTab==='__pano__';
  const sel=document.createElement('button');
  sel.className='np-brandsel';sel.type='button';
  sel.innerHTML=((!onPano&&_npLogo(_npTab))?'<img src="'+_npLogo(_npTab)+'" alt="" onerror="this.remove()">':'')+'<span>'+_npEsc(onPano?'Escolher marca':_npTab)+'</span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
  sel.onclick=()=>_npToggleBrandMenu(marcas);
  tabsEl.appendChild(sel);
  _npRenderBody();
}
function _npToggleBrandMenu(marcas){
  let m=document.getElementById('np-brandmenu');
  if(!m){m=document.createElement('div');m.id='np-brandmenu';m.className='np-brandmenu';
    document.getElementById('noticias-screen').appendChild(m);
    m.addEventListener('click',e=>{if(e.target===m)m.classList.remove('open');});}
  const backBtn='<button class="np-brandmenu-back" data-pano="1"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>★ Resumo do Mercado</button>';
  m.innerHTML='<div class="np-brandmenu-panel">'+backBtn+'<div class="np-brandmenu-h">Marcas · Observatório</div><div class="np-brandmenu-grid">'+marcas.map(mk=>{
    const n=_npData.filter(x=>x.marca===mk).length;
    return '<button class="np-brandmenu-item'+(mk===_npTab?' active':'')+'" data-m="'+_npEsc(mk)+'">'+(_npLogo(mk)?'<img src="'+_npLogo(mk)+'" alt="" onerror="this.style.visibility=&#39;hidden&#39;">':'<span class="np-bm-dot"></span>')+'<span class="np-bm-nome">'+_npEsc(mk)+'</span><b>'+n+'</b></button>';
  }).join('')+'</div></div>';
  const backEl=m.querySelector('.np-brandmenu-back');
  if(backEl)backEl.onclick=()=>{_npTab='__pano__';m.classList.remove('open');_npRenderTabs();window.scrollTo({top:0,behavior:'smooth'});};
  m.querySelectorAll('.np-brandmenu-item').forEach(btn=>btn.onclick=()=>{_npTab=btn.getAttribute('data-m');m.classList.remove('open');_npRenderTabs();window.scrollTo({top:0,behavior:'smooth'});});
  m.classList.toggle('open');
}
function _npGoMarca(m){_npTab=m;_npRenderTabs();const sc=document.getElementById('noticias-screen');if(sc)sc.scrollIntoView({block:'start'});window.scrollTo({top:0,behavior:'smooth'});}
// Inline de markdown LIMPO p/ o Portal (negrito + itálico + escape) — sem lupa de SKU.
function _npMdInline(s){return _npEsc(String(s))
  .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
  .replace(/(^|[^*])\*(?!\s)([^*]+?)\*(?!\*)/g,'$1<em>$2</em>');}
// Renderiza markdown editorial (##/###, listas, parágrafos). Sem tabelas/SKU.
function _npMd(md){
  const lines=String(md||'').replace(/\r/g,'').split('\n');let html='',i=0;
  while(i<lines.length){
    const ln=lines[i];
    if(/^###\s+/.test(ln)){html+='<h4>'+_npMdInline(ln.replace(/^###\s+/,''))+'</h4>';i++;continue;}
    if(/^##\s+/.test(ln)){html+='<h3>'+_npMdInline(ln.replace(/^##\s+/,''))+'</h3>';i++;continue;}
    if(/^#\s+/.test(ln)){html+='<h3>'+_npMdInline(ln.replace(/^#\s+/,''))+'</h3>';i++;continue;}
    if(/^\s*[-*]\s+/.test(ln)){let it='';while(i<lines.length&&/^\s*[-*]\s+/.test(lines[i])){it+='<li>'+_npMdInline(lines[i].replace(/^\s*[-*]\s+/,''))+'</li>';i++;}html+='<ul>'+it+'</ul>';continue;}
    if(/^\s*\d+\.\s+/.test(ln)){let it='';while(i<lines.length&&/^\s*\d+\.\s+/.test(lines[i])){it+='<li>'+_npMdInline(lines[i].replace(/^\s*\d+\.\s+/,''))+'</li>';i++;}html+='<ol>'+it+'</ol>';continue;}
    if(ln.trim()===''){i++;continue;}
    html+='<p>'+_npMdInline(ln)+'</p>';i++;
  }
  return html;
}
// Quebra o resumão em CARDS por seção (## ), igual ao Gestor Comercial, com cabeçalho numerado.
function _npPanoramaCards(md){
  const lines=String(md||'').replace(/\r/g,'').split('\n');
  const secs=[];let cur=null;
  for(const ln of lines){
    const h2=ln.match(/^##\s+(?!#)(.+)/);
    if(h2){cur={title:h2[1].trim(),body:[]};secs.push(cur);continue;}
    if(/^#\s+/.test(ln)||/^RESUMO:/.test(ln))continue;
    if(!cur){cur={title:null,body:[]};secs.push(cur);}
    cur.body.push(ln);
  }
  let n=0;
  const html=secs.map(s=>{
    const body=_npMd(s.body.join('\n'));
    if(!s.title&&!body.replace(/<[^>]+>/g,'').trim())return '';
    let head='';
    if(s.title){n++;head='<div class="np-sec-h"><span class="np-sec-n">'+String(n).padStart(2,'0')+'</span><h2>'+_npMdInline(s.title)+'</h2></div>';}
    return '<section class="np-sec">'+head+'<div class="np-sec-b">'+body+'</div></section>';
  }).join('');
  return html||_npMd(md);
}
function _npRenderPanorama(){
  const body=document.getElementById('np-body');
  const ed=_npData.filter(n=>n.rodada===_npRod&&!_npIsResumo(n.categoria));
  const marcas=[...new Set(ed.map(n=>n.marca))].sort((a,b)=>{const ia=NP_ORDER.indexOf(a),ib=NP_ORDER.indexOf(b);return(ia<0?99:ia)-(ib<0?99:ib)||a.localeCompare(b);});
  const pano=_npPano;
  const panoDate=pano&&pano.rodada?_npFmtDate(pano.rodada):(_npRod?_npFmtDate(_npRod):'');
  let html='<div class="np-pcover"><div class="np-pcover-over">Observatório de Mercado · RBV</div>'
    +'<h1 class="np-pcover-title">Panorama do Mercado</h1>'
    +'<div class="np-pcover-sub">'+marcas.length+' marcas observadas · '+(panoDate?('Edição '+panoDate):'')+'</div>'
    +'<div class="np-pcover-lead">Leitura executiva da semana — campanhas de marketing, campanhas comerciais e ações promocionais do mercado de calçados e moda feminina premium.</div></div>';
  if(pano&&pano.conteudo_md){
    html+='<article class="np-pano">'+_npPanoramaCards(pano.conteudo_md)+'</article>';
    // tira de destaques visuais (heroes com imagem), secundária ao texto
    const dest=ed.filter(n=>n.destaque&&_npImg(n.imagem_url))
      .filter((v,i,a)=>a.findIndex(x=>x.marca===v.marca)===i).slice(0,12);
    if(dest.length){
      html+='<div class="np-prule">Destaques em imagem <small>clique para abrir a marca</small></div><div class="np-pdest">'
        +dest.map(n=>{const img=_npImg(n.imagem_url),col=_npCatColor(n.categoria);
          return '<button class="np-pcard" data-pm="'+_npEsc(n.marca)+'">'
            +'<img class="np-pcard-img" src="'+img+'" alt="" loading="lazy" onerror="this.remove()">'
            +'<span class="np-pcard-body"><span class="np-pcard-tag" style="background:'+col+'">'+_npEsc(n.categoria)+'</span>'
            +'<span class="np-pcard-marca">'+(_npLogo(n.marca)?'<img src="'+_npLogo(n.marca)+'" alt="" onerror="this.remove()">':'')+_npEsc(n.marca)+'</span>'
            +'<span class="np-pcard-title">'+_npEsc(n.titulo)+'</span></span></button>';}).join('')+'</div>';
    }
    html+='<div class="np-pano-meta">Resumão gerado por IA'+(pano.modelo?(' · '+_npEsc(pano.modelo)):'')+(panoDate?(' · edição '+panoDate):'')+'. Baseado somente nas notícias coletadas — confira na aba de cada marca.</div>';
  }else{
    html+='<div class="np-pano-pending"><div class="np-pano-pending-ic"><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg></div>'
      +'<h3>O resumão da edição está sendo preparado</h3>'
      +'<p>Assim que a coleta da semana fecha, a IA escreve a leitura geral do mercado — campanhas, lançamentos e ações promocionais — aqui. Enquanto isso, escolha uma marca abaixo para ver os detalhes.</p></div>';
  }
  html+='<div class="np-prule">Marcas observadas <small>clique para abrir</small></div><div class="np-pmap">'
    +marcas.map(m=>{
      const mine=ed.filter(n=>n.marca===m);const tags=[...new Set(mine.map(n=>n.categoria))];
      return '<button class="np-pmapcard" data-pm="'+_npEsc(m)+'"><span class="np-pmap-h">'+(_npLogo(m)?'<img src="'+_npLogo(m)+'" alt="" onerror="this.remove()">':'')+'<b>'+_npEsc(m)+'</b><i>'+mine.length+'</i></span>'
        +'<span class="np-pmap-tags">'+tags.slice(0,6).map(t=>'<span class="np-pmap-tag" style="--tc:'+_npCatColor(t)+'">'+_npEsc(t)+'</span>').join('')+'</span></button>';}).join('')+'</div>';
  body.innerHTML=html;
  body.querySelectorAll('[data-pm]').forEach(el=>el.addEventListener('click',()=>_npGoMarca(el.getAttribute('data-pm'))));
}
function _npRenderBody(){
  const body=document.getElementById('np-body');
  if(_npTab==='__pano__')return _npRenderPanorama();
  const todas=_npData.filter(n=>n.marca===_npTab);
  if(!todas.length){body.innerHTML='<div class="np-empty"><h3>Nenhuma notícia</h3><p>Esta marca ainda não tem registros.</p></div>';return;}
  // CONSOLIDADO POR DATA: usa TODAS as edições carregadas (não só a mais recente). Cada peça
  // vem da edição mais recente que a tem — se a edição nova não traz hero/resumo, puxa da anterior.
  const maxRod=[...new Set(todas.map(n=>String(n.rodada||'')).filter(Boolean))].sort().reverse()[0]||'';
  const issueDate=maxRod?_npFmtDate(maxRod):(_npRod?_npFmtDate(_npRod):'');
  // marca só-marketing (ex.: L'Occitane): sem conteúdo comercial → esconde a aba e abre em Marketing
  const mktOnly=!todas.some(n=>!_npIsResumo(n.categoria)&&_npVista(n.categoria)==='comercial');
  if(mktOnly&&_npView==='comercial')_npView='marketing';
  // recência = edição (rodada) desc, depois data de publicação desc
  const byRec=(a,b)=>String(b.rodada||'').localeCompare(String(a.rodada||''))||String(b.data_publicacao||'').localeCompare(String(a.data_publicacao||''));
  const vistaItems=todas.filter(n=>!_npIsResumo(n.categoria)&&_npVista(n.categoria)===_npView).sort(byRec);
  // resumo: o mais recente disponível na vista
  const resumo=todas.filter(n=>_npIsResumo(n.categoria)&&_npVista(n.categoria)===_npView).sort(byRec)[0]||null;
  // galerias: a MAIS RECENTE de cada categoria (não repete best-seller/IG semana após semana)
  const galSeen=new Set(),galerias=[];
  vistaItems.filter(n=>_npProds(n).length).forEach(g=>{const k=String(g.categoria||'').toLowerCase();if(galSeen.has(k))return;galSeen.add(k);galerias.push(g);});
  // normais (editorial/hero): dedupe por título, mantém a ocorrência mais recente
  const seenT=new Set(),normais=[];
  vistaItems.filter(n=>!_npProds(n).length).forEach(n=>{const k=(n.titulo||'').trim().toLowerCase();if(k&&seenT.has(k))return;if(k)seenT.add(k);normais.push(n);});
  const items=vistaItems; // p/ a checagem de "vazio" abaixo
  const hero=normais.find(n=>n.destaque)||normais[0]||null;
  const rest=normais.filter(n=>n!==hero);
  const issueMeta=_npView==='marketing'?'Marketing & Conteúdo':'Comercial & Desenvolvimento';
  let html='<div class="np-issue"><div class="np-issue-l">'
    +(_npLogo(_npTab)?'<img class="np-issue-logo" src="'+_npLogo(_npTab)+'" alt="" onerror="this.remove()">':'')
    +'<span class="np-issue-over">Inteligência de Concorrência</span>'
    +'<h1 class="np-issue-title">'+_npEsc(_npTab)+'</h1></div>'
    +'<div class="np-issue-r"><b>Consolidado · até '+issueDate+'</b><br>'+issueMeta+'<br>RBV · Observatório</div></div>';
  html+=_npViewTabsHtml(mktOnly);
  if(!items.length&&!resumo){
    body.innerHTML=html+'<div class="np-empty"><h3>Sem registros nesta vista</h3><p>'+(_npView==='marketing'?'Ainda não coletamos conteúdo de marketing/Instagram desta marca nesta edição.':'Ainda não há análise comercial desta marca nesta edição.')+'</p></div>';
    return;
  }
  if(hero){
    const col=_npCatColor(hero.categoria);
    const hd=hero.data_publicacao?_npFmtDate(hero.data_publicacao):'';
    const hlink=(hero.url&&/^https?:\/\//.test(String(hero.url)))?'<a class="np-link" href="'+_npEsc(hero.url)+'" target="_blank" rel="noopener noreferrer">Ler matéria</a>':'';
    const himg=_npImg(hero.imagem_url);
    html+='<article class="np-hero" style="--hero:'+col+'">'
      +(himg?'<img class="np-hero-img" src="'+himg+'" loading="lazy" alt="" onerror="this.style.display=&#39;none&#39;">':'<div class="np-hero-img"></div>')
      +'<div class="np-hero-text">'
      +'<div class="np-hero-top"><div class="np-hero-kicker">'+_npEsc(hero.categoria||'Destaque')+_npEdChip(hero.rodada)+'</div>'
      +'<h2 class="np-hero-headline">'+_npEsc(hero.titulo)+'</h2></div>'
      +(hero.resumo?'<p class="np-hero-resumo">'+_npEsc(hero.resumo)+'</p>':'')
      +'<div class="np-hero-foot"><span class="np-hero-fonte">Fonte<b>'+_npEsc(hero.fonte||'—')+(hd?' · '+hd:'')+'</b></span>'+hlink+'</div>'
      +'</div></article>';
  }
  galerias.forEach(g=>{ html+=_npGalleryHtml(g); });
  if(rest.length){
    const ruleLbl=_npView==='marketing'?'Campanhas, manchetes & movimentos':'Desenvolvimento de produto';
    html+='<div class="np-sec-rule"><span>'+ruleLbl+' · '+_npEsc(_npTab)+'</span></div><div class="np-grid">';
    let i=2;
    rest.forEach(n=>{
      const col=_npCatColor(n.categoria);i++;
      const date=n.data_publicacao?_npFmtDate(n.data_publicacao):'';
      const link=(n.url&&/^https?:\/\//.test(String(n.url)))?'<a class="np-link" href="'+_npEsc(n.url)+'" target="_blank" rel="noopener noreferrer">Fonte ↗</a>':'';
      const nimg=_npImg(n.imagem_url);
      html+='<article class="np-art" style="--cat:'+col+'">'
        +(nimg?'<img class="np-art-img" src="'+nimg+'" loading="lazy" alt="" onerror="this.style.display=&#39;none&#39;">':'')
        +'<div class="np-art-kicker">'+_npEsc(n.categoria||'—')+_npEdChip(n.rodada)+'</div>'
        +'<h3 class="np-art-headline">'+_npEsc(n.titulo)+'</h3>'
        +(n.resumo?'<p class="np-art-resumo">'+_npEsc(n.resumo)+'</p>':'')
        +'<div class="np-art-foot"><span class="np-art-fonte">'+_npEsc(n.fonte||'')+(date?' · '+date:'')+'</span>'+link+'</div>'
        +'</article>';
    });
    html+='</div>';
  }
  if(resumo){ html+=_npModSumHtml(resumo); }
  body.innerHTML=html;
}
function _npFmtDate(d){try{return new Date(d+'T00:00:00').toLocaleDateString('pt-BR',{day:'2-digit',month:'short',year:'numeric'}).replace(/ de /g,'/').replace('.','');}catch(e){return d;}}
function _npFmtEd(d){try{return new Date(d+'T00:00:00').toLocaleDateString('pt-BR',{day:'2-digit',month:'short'}).replace(/ de /g,'/').replace('.','');}catch(e){return d;}}
// selo de qual EDIÇÃO (rodada) a peça veio — orienta por data no modo consolidado
function _npEdChip(rod){rod=String(rod==null?'':rod);if(!rod)return '';return '<span class="np-edchip" title="Edição de '+_npEsc(_npFmtDate(rod))+'">'+_npEsc(_npFmtEd(rod))+'</span>';}
function _npEsc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function _npImg(u){u=String(u==null?'':u);return /^https?:\/\/[^\s"'<>]+$/.test(u)?u:'';}
function _npProds(n){const p=n&&n.produtos;if(Array.isArray(p))return p;if(typeof p==='string'){try{const a=JSON.parse(p);return Array.isArray(a)?a:[];}catch(e){return[];}}return[];}
function _npMoney(v){v=Number(v);if(!isFinite(v)||v<=0)return '';return 'R$ '+v.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});}
function _npNum(v){v=Number(v);if(!isFinite(v)||v<0)return '0';if(v>=1e6)return (v/1e6).toFixed(1).replace('.',',')+' mi';if(v>=1e3)return (v/1e3).toFixed(1).replace('.',',')+' mil';return String(v);}
function _npGalleryHtml(g){
  const col=_npCatColor(g.categoria);
  const prods=_npProds(g);
  const link=g.url&&/^https?:\/\//.test(g.url)?'<a class="np-link" href="'+_npEsc(g.url)+'" target="_blank" rel="noopener noreferrer">Ver na loja ↗</a>':'';
  const ehIG=String(g.categoria||'').toLowerCase()==='instagram';
  const sec=_npSecMeta(g.categoria);
  const titulo=(sec&&sec.nome)?sec.nome:_npEsc(g.titulo);
  const star=(sec&&sec.star)?_npStar():'';
  let h='<section class="np-gallery'+(ehIG?' np-gallery--ig':'')+'" style="--cat:'+col+'">'
    +'<div class="np-gallery-head"><div><div class="np-gallery-kicker">'+_npEsc(g.categoria||'Best-seller')+_npEdChip(g.rodada)+'</div>'
    +'<h2 class="np-gallery-title">'+star+titulo+'</h2></div>'
    +'<span class="np-gallery-meta">'+prods.length+' '+(prods.length===1?'item':'itens')+' · '+_npEsc(g.fonte||'Loja oficial')+'</span></div>'
    +(g.resumo?'<p class="np-gallery-resumo">'+_npEsc(g.resumo)+'</p>':'')
    +'<div class="np-prod-grid">';
  prods.forEach(p=>{
    const img=_npImg(p.img||p.imagem||'');
    const vid=_npImg(p.video||'');
    const nome=_npEsc(p.nome||p.name||'');
    const preco=_npMoney(p.preco!=null?p.preco:p.price);
    const temEng=(p.curtidas!=null||p.comentarios!=null);
    const eng=temEng?('♥ '+_npNum(p.curtidas)+'  ·  💬 '+_npNum(p.comentarios)):'';
    const href=/^https?:\/\//.test(String(p.url||''))?_npEsc(p.url):'';
    const media=vid
      ?('<video class="np-prod-img" src="'+vid+'"'+(img?' poster="'+img+'"':'')+' controls preload="none" playsinline></video>')
      :(img?'<img class="np-prod-img" src="'+img+'" loading="lazy" alt="" onerror="this.parentNode.style.background=&#39;#eceae4&#39;;this.remove();">':'');
    // O selo sai pelo TIPO do post, não pela existência do arquivo de vídeo.
    // Antes ele dependia do `vid`, e desde que o teto de re-hospedagem caiu pra
    // 8 MB (ver ig-coletor.mjs) o Reels pesado passou a chegar sem vídeo — só
    // com o pôster. Pelo critério antigo ele perdia o selo e virava, na tela,
    // uma foto qualquer: ninguém adivinharia que ali tem vídeo e que o clique
    // abre o Reels no Instagram.
    const ehVideo=vid||p.tipo==='video';
    const imgwrap='<div class="np-prod-imgwrap">'+media+(ehVideo?'<span class="np-prod-badge">▶ Reels</span>':'')+'</div>';
    const mediaBlock=(href&&!vid)?('<a href="'+href+'" target="_blank" rel="noopener noreferrer">'+imgwrap+'</a>'):imgwrap;
    const nomeBlock=nome?(href?('<a class="np-prod-name" href="'+href+'" target="_blank" rel="noopener noreferrer">'+nome+'</a>'):('<div class="np-prod-name">'+nome+'</div>')):'';
    const analise=p.analise?'<div class="np-prod-analise">'+_npEsc(p.analise)+'</div>':'';
    h+='<div class="np-prod">'+mediaBlock+nomeBlock+(eng?'<div class="np-prod-eng">'+eng+'</div>':(preco?'<div class="np-prod-price">'+preco+'</div>':''))+analise+'</div>';
  });
  h+='</div>'+(link?'<div style="margin-top:20px;text-align:right;">'+link+'</div>':'')+'</section>';
  return h;
}

// As matérias são montadas via innerHTML (não pelo template do Vue). Os handlers
// atribuídos por .onclick=... funcionam por serem referências reais de função;
// mas os botões de vista (Comercial/Marketing) são gerados como string
// onclick="_npSetView('...')" dentro do innerHTML — e strings de HTML só
// enxergam o escopo GLOBAL. Como no legado _npSetView era global, expomos aqui
// no window (mesmo nome) para manter o comportamento idêntico.
window._npSetView = _npSetView

// Equivale ao openNoticias() do legado (menos o display:flex, que o router faz):
// carrega as notícias e liga o controle de zoom (A−/A+) sobre o #np-body.
onMounted(() => {
  loadNoticias()
  _rbvZoom('observatorio', 'np-body')
})
</script>

<style scoped>
/* CSS "peeled" (movido, não copiado) de src/estilos/estilos-globais.css —
   as 81 regras prefixadas por #noticias-screen. O root do componente mantém
   id="noticias-screen", então as regras de raiz (#noticias-screen, ::after,
   [data-theme="dark"] #noticias-screen) continuam casando sob o scoped.
   As matérias, porém, são criadas dinamicamente via innerHTML/createElement e
   NÃO recebem o atributo de scope do Vue; por isso os seletores DESCENDENTES
   (#noticias-screen .np-xxx) foram convertidos para #noticias-screen :deep(.np-xxx),
   que aplica o atributo de scope no root e deixa o descendente livre — assim o
   estilo alcança os elementos gerados em runtime, preservando o visual do legado.
   Detalhes: display:none do root virou display:flex (no Vue quem controla a
   visibilidade é o vue-router). As demais regras .np-* SEM o prefixo #noticias-screen
   continuam globais (estilos-globais.css) e seguem valendo normalmente. */
  /* ===== Portal de Notícias ===== */
  /* ── Portal de Notícias — editorial "revista glossy" ── */
#noticias-screen {display:flex;flex-direction:column;min-height:100vh;position:relative;
    --ink:#0d0d0d;--paper:#f6f3ee;--paper2:#efeae1;--np-line:#1a1a1a;--np-muted:#6b6258;--np-rule:rgba(13,13,13,.14);
    --c-lancamento:#d6336c;--c-campanha:#1c5d99;--c-precopromo:var(--red);--c-faturamento:var(--green);
    --c-expansao:var(--orange);--c-tendencia:var(--yellow);--c-estrategia:var(--roxo);
    --c-marketing:#0e7c86;--c-design:#b5179e;--c-moda:#7b1e3b;--c-bestseller:#9c6b1e;--c-desenvolvimento:#0f766e;--c-instagram:#c13584;--c-outro:#1a1a1a;
    background:var(--paper);color:var(--ink);font-family:var(--fonte-principal);}

#noticias-screen::after {content:'';position:fixed;inset:0;pointer-events:none;z-index:5;opacity:.04;mix-blend-mode:multiply;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");}
  /* Tema escuro do Observatório (segue o tema do app) */
[data-theme="dark"] #noticias-screen {--ink:#ece7dc;--paper:#14130e;--paper2:#211d16;--np-line:#ece7dc;--np-muted:#9a9285;--np-rule:rgba(255,255,255,.13);}
  /* ===== Panorama do Mercado ===== */
#noticias-screen :deep(.np-tab-pano) {font-weight:800}
  /* botão do Panorama fica SEMPRE visível (é o "voltar pro resumo") — as abas de marca é que viram dropdown */
#noticias-screen :deep(.np-tabs .np-tab.np-tab-pano) {display:inline-flex;align-items:center;gap:7px;font-size:max(9px, calc(13px * var(--escala-texto, 1)));font-weight:800;letter-spacing:1.2px;text-transform:uppercase;color:var(--np-muted);border-radius:10px;padding:13px 18px;transition:background .15s,color .15s;}
#noticias-screen :deep(.np-tabs .np-tab.np-tab-pano:hover) {background:var(--paper2);color:var(--ink);}
#noticias-screen :deep(.np-tabs .np-tab.np-tab-pano.active) {color:var(--ink);}
#noticias-screen :deep(.np-tabs .np-tab.np-tab-pano.active::after) {content:'';position:absolute;left:14px;right:14px;bottom:-2px;height:3px;background:var(--ink);border-radius:2px;}
#noticias-screen :deep(.np-tabsep) {align-self:center;color:var(--np-rule);font-size:max(16px, calc(16px * var(--escala-texto, 1)));opacity:.6;padding:0 2px;}
  /* item "voltar ao resumo" no topo do dropdown de marcas */
#noticias-screen :deep(.np-brandmenu-back) {display:flex;align-items:center;gap:10px;width:100%;text-align:left;background:var(--paper2);border:1px solid var(--np-rule);border-radius:12px;padding:14px 16px;margin:0 0 14px;cursor:pointer;font-family:var(--fonte-principal);font-weight:800;font-size:max(9px, calc(13px * var(--escala-texto, 1)));letter-spacing:1px;text-transform:uppercase;color:var(--ink);}
#noticias-screen :deep(.np-brandmenu-back:hover) {background:var(--np-rule);}
#noticias-screen :deep(.np-brandmenu-back svg) {flex:0 0 auto}
#noticias-screen :deep(.np-pcover) {position:relative;border:1px solid var(--np-rule);border-radius:4px;padding:36px 24px;text-align:center;background:var(--paper2);margin-bottom:24px}
#noticias-screen :deep(.np-pcover-over) {font-family:var(--fonte-principal);font-size:max(9px, calc(11px * var(--escala-texto, 1)));font-weight:700;letter-spacing:3px;text-transform:uppercase;color:var(--np-muted)}
#noticias-screen :deep(.np-pcover-title) {font-family:var(--fonte-principal);font-weight:900;font-size:clamp(30px,6vw,54px);line-height:1.02;color:var(--ink);margin:6px 0 4px;letter-spacing:-.02em}
#noticias-screen :deep(.np-pcover-sub) {font-family:var(--fonte-principal);font-size:max(9px, calc(13px * var(--escala-texto, 1)));color:var(--np-muted);letter-spacing:.5px}
#noticias-screen :deep(.np-pcover-lead) {font-family:var(--fonte-principal);font-size:max(9px, calc(14px * var(--escala-texto, 1)));line-height:1.6;color:var(--np-muted);max-width:640px;margin:16px auto 0}
  /* selo da edição (data) — modo consolidado */
#noticias-screen :deep(.np-edchip) {display:inline-block;margin-left:8px;padding:2px 8px;border:1px solid var(--np-rule);border-radius:999px;font-family:var(--fonte-principal);font-size:max(9px, calc(10px * var(--escala-texto, 1)));font-weight:700;letter-spacing:.5px;text-transform:none;color:var(--np-muted);vertical-align:middle;white-space:nowrap}
  /* Resumão escrito (texto) — seções em cards numerados, estilo editorial */
#noticias-screen :deep(.np-pano) {margin-top:6px}
#noticias-screen :deep(.np-sec) {border:1px solid var(--np-rule);border-radius:5px;background:var(--paper);padding:22px 26px;margin-bottom:16px}
#noticias-screen :deep(.np-sec-h) {display:flex;align-items:center;gap:14px;margin:0 0 12px;padding-bottom:12px;border-bottom:1px solid var(--np-rule)}
#noticias-screen :deep(.np-sec-n) {font-family:var(--fonte-principal);font-weight:900;font-size:max(16px, calc(30px * var(--escala-texto, 1)));line-height:1;color:var(--np-muted);opacity:.5;min-width:42px}
#noticias-screen :deep(.np-sec-h h2) {font-family:var(--fonte-principal);font-weight:800;font-size:clamp(19px,3vw,26px);line-height:1.1;color:var(--ink);margin:0;letter-spacing:-.01em}
#noticias-screen :deep(.np-sec-b) {font-family:var(--fonte-principal)}
#noticias-screen :deep(.np-sec-b p) {font-size:max(9px, calc(15px * var(--escala-texto, 1)));line-height:1.72;color:var(--ink);margin:0 0 13px}
#noticias-screen :deep(.np-sec-b p:last-child) {margin-bottom:0}
#noticias-screen :deep(.np-sec-b strong) {font-weight:700;color:var(--ink)}
#noticias-screen :deep(.np-sec-b em) {font-style:italic}
#noticias-screen :deep(.np-sec-b h3) {font-family:var(--fonte-principal);font-weight:600;font-size:max(9px, calc(15px * var(--escala-texto, 1)));letter-spacing:1px;text-transform:uppercase;color:var(--ink);margin:20px 0 10px}
#noticias-screen :deep(.np-sec-b h4) {font-family:var(--fonte-principal);font-weight:700;font-size:max(9px, calc(14px * var(--escala-texto, 1)));color:var(--ink);margin:16px 0 8px}
#noticias-screen :deep(.np-sec-b ul), #noticias-screen :deep(.np-sec-b ol) {margin:4px 0 14px;padding-left:22px}
#noticias-screen :deep(.np-sec-b li) {font-size:max(9px, calc(15px * var(--escala-texto, 1)));line-height:1.62;color:var(--ink);margin-bottom:7px}
#noticias-screen :deep(.np-pano-meta) {font-family:var(--fonte-principal);font-size:max(9px, calc(11.5px * var(--escala-texto, 1)));line-height:1.55;color:var(--np-muted);font-style:italic;margin-top:8px;padding:12px 14px;border-left:2px solid var(--np-rule)}
#noticias-screen :deep(.np-pano-pending) {text-align:center;border:1px dashed var(--np-rule);border-radius:6px;background:var(--paper2);padding:40px 28px;margin-bottom:8px}
#noticias-screen :deep(.np-pano-pending-ic) {color:var(--np-muted);opacity:.7;margin-bottom:8px}
#noticias-screen :deep(.np-pano-pending h3) {font-family:var(--fonte-principal);font-weight:800;font-size:max(16px, calc(22px * var(--escala-texto, 1)));color:var(--ink);margin:0 0 8px}
#noticias-screen :deep(.np-pano-pending p) {font-family:var(--fonte-principal);font-size:max(9px, calc(14px * var(--escala-texto, 1)));line-height:1.6;color:var(--np-muted);max-width:520px;margin:0 auto}
#noticias-screen :deep(.np-pstats) {display:flex;flex-wrap:wrap;justify-content:center;gap:10px;margin-top:20px}
#noticias-screen :deep(.np-pstat) {display:flex;flex-direction:column;align-items:center;min-width:82px;padding:10px 14px;border:1px solid var(--np-rule);border-radius:4px;background:var(--paper)}
#noticias-screen :deep(.np-pstat b) {font-family:var(--fonte-principal);font-size:max(16px, calc(24px * var(--escala-texto, 1)));color:var(--ink);line-height:1}
#noticias-screen :deep(.np-pstat span) {font-family:var(--fonte-principal);font-size:max(9px, calc(10px * var(--escala-texto, 1)));text-transform:uppercase;letter-spacing:1px;color:var(--np-muted);margin-top:4px}
#noticias-screen :deep(.np-prule) {font-family:var(--fonte-principal);font-weight:600;font-size:max(9px, calc(14px * var(--escala-texto, 1)));letter-spacing:2px;text-transform:uppercase;color:var(--ink);margin:30px 0 14px;padding-bottom:8px;border-bottom:2px solid var(--ink);display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
#noticias-screen :deep(.np-prule small) {font-family:var(--fonte-principal);font-weight:400;font-size:max(9px, calc(11px * var(--escala-texto, 1)));letter-spacing:.3px;text-transform:none;color:var(--np-muted)}
#noticias-screen :deep(.np-pdest) {display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px}
#noticias-screen :deep(.np-pcard) {display:flex;flex-direction:column;text-align:left;border:1px solid var(--np-rule);border-radius:4px;overflow:hidden;background:var(--paper);cursor:pointer;padding:0;transition:transform .15s ease,box-shadow .15s ease}
#noticias-screen :deep(.np-pcard:hover) {transform:translateY(-3px);box-shadow:0 14px 30px -16px rgba(0,0,0,.5)}
#noticias-screen :deep(.np-pcard-img) {width:100%;height:148px;object-fit:cover;display:block;background:var(--paper2)}
#noticias-screen :deep(.np-pcard-noimg) {background:linear-gradient(135deg,var(--paper2),var(--np-rule));min-height:148px}
#noticias-screen :deep(.np-pcard-body) {padding:12px 14px;display:flex;flex-direction:column;gap:7px}
#noticias-screen :deep(.np-pcard-tag) {align-self:flex-start;color:#fff;font-family:var(--fonte-principal);font-size:max(9px, calc(9px * var(--escala-texto, 1)));font-weight:700;letter-spacing:.6px;text-transform:uppercase;padding:3px 9px;border-radius:999px}
#noticias-screen :deep(.np-pcard-marca) {display:flex;align-items:center;gap:7px;font-family:var(--fonte-principal);font-size:max(9px, calc(11px * var(--escala-texto, 1)));font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:var(--np-muted)}
#noticias-screen :deep(.np-pcard-marca img) {height:15px;width:auto;object-fit:contain}
#noticias-screen :deep(.np-pcard-title) {font-family:var(--fonte-principal);font-size:max(9px, calc(15px * var(--escala-texto, 1)));font-weight:600;color:var(--ink);line-height:1.25}
#noticias-screen :deep(.np-ptrends) {display:flex;flex-wrap:wrap;gap:9px}
#noticias-screen :deep(.np-ptrend) {display:inline-flex;align-items:baseline;gap:7px;padding:7px 13px;border:1px solid var(--np-rule);border-radius:999px;background:var(--paper)}
#noticias-screen :deep(.np-ptrend b) {font-family:var(--fonte-principal);font-size:max(9px, calc(15px * var(--escala-texto, 1)));color:var(--ink);text-transform:capitalize}
#noticias-screen :deep(.np-ptrend i) {font-family:var(--fonte-principal);font-style:normal;font-size:max(9px, calc(10px * var(--escala-texto, 1)));font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:var(--orange)}
#noticias-screen :deep(.np-ptemas) {display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:18px}
#noticias-screen :deep(.np-ptema) {border:1px solid var(--np-rule);border-radius:4px;background:var(--paper);overflow:hidden}
#noticias-screen :deep(.np-ptema-h) {font-family:var(--fonte-principal);font-weight:600;font-size:max(9px, calc(13px * var(--escala-texto, 1)));letter-spacing:1px;text-transform:uppercase;color:var(--ink);padding:12px 14px;border-bottom:1px solid var(--np-rule);display:flex;align-items:center;gap:8px}
#noticias-screen :deep(.np-ptema-h i) {font-family:var(--fonte-principal);font-style:normal;font-weight:400;font-size:max(9px, calc(10px * var(--escala-texto, 1)));letter-spacing:.3px;text-transform:none;color:var(--np-muted);margin-left:auto}
#noticias-screen :deep(.np-ptema-dot) {width:10px;height:10px;border-radius:50%;flex-shrink:0}
#noticias-screen :deep(.np-ptema-list) {max-height:340px;overflow:auto}
#noticias-screen :deep(.np-prow) {display:flex;align-items:center;gap:11px;width:100%;text-align:left;padding:9px 14px;border:none;border-bottom:1px solid var(--np-rule);background:none;cursor:pointer}
#noticias-screen :deep(.np-prow:last-child) {border-bottom:none}
#noticias-screen :deep(.np-prow:hover) {background:var(--paper2)}
#noticias-screen :deep(.np-prow-thumb) {width:46px;height:46px;border-radius:3px;object-fit:cover;flex-shrink:0;background:var(--paper2)}
#noticias-screen :deep(.np-prow-txt) {display:flex;flex-direction:column;gap:2px;min-width:0}
#noticias-screen :deep(.np-prow-txt b) {font-family:var(--fonte-principal);font-size:max(9px, calc(10px * var(--escala-texto, 1)));font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:var(--np-muted)}
#noticias-screen :deep(.np-prow-txt span) {font-family:var(--fonte-principal);font-size:max(9px, calc(13.5px * var(--escala-texto, 1)));color:var(--ink);line-height:1.25;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#noticias-screen :deep(.np-pmap) {display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px}
#noticias-screen :deep(.np-pmapcard) {text-align:left;border:1px solid var(--np-rule);border-radius:4px;background:var(--paper);padding:13px 14px;cursor:pointer;display:flex;flex-direction:column;gap:9px}
#noticias-screen :deep(.np-pmapcard:hover) {border-color:var(--ink)}
#noticias-screen :deep(.np-pmap-h) {display:flex;align-items:center;gap:8px}
#noticias-screen :deep(.np-pmap-h img) {height:18px;width:auto;object-fit:contain}
#noticias-screen :deep(.np-pmap-h b) {font-family:var(--fonte-principal);font-size:max(9px, calc(15px * var(--escala-texto, 1)));color:var(--ink)}
#noticias-screen :deep(.np-pmap-h i) {font-family:var(--fonte-dados);font-style:normal;margin-left:auto;font-size:max(9px, calc(13px * var(--escala-texto, 1)));color:var(--np-muted);font-variant-numeric:tabular-nums}
#noticias-screen :deep(.np-pmap-tags) {display:flex;flex-wrap:wrap;gap:5px}
#noticias-screen :deep(.np-pmap-tag) {font-family:var(--fonte-principal);font-size:max(9px, calc(9px * var(--escala-texto, 1)));font-weight:600;letter-spacing:.4px;text-transform:uppercase;padding:2px 7px;border-radius:999px;color:var(--tc);border:1px solid var(--tc)}
  @media(max-width:640px){#noticias-screen :deep(.np-pdest), #noticias-screen :deep(.np-ptemas), #noticias-screen :deep(.np-pmap){grid-template-columns:1fr}}

@media(max-width:600px){ #noticias-screen{overflow-x:clip;} }
</style>
