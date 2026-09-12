<template>
  <!-- Porte fiel de #meta-ads-campanha-screen (legacy/index.html L12031-12076),
       VERBATIM. Mesmo padrão da Gestão à Vista: root vira .tela-analise-campanhas
       (sem display:none — quem controla a visibilidade agora é o vue-router),
       IDs mantidos (usados por getElementById no JS imperativo abaixo).
       Único onclick trocado por binding Vue: o botão "Voltar" (closeMetaCampanha
       vira @click, e a função por trás dele agora também limpa os timers e navega
       pelo router). Os demais onclick="setMaPeriod(this)"/"toggleMaCustomRange()"/
       "loadMaData()"/"toggleMaAccPicker()"/"event.stopPropagation()" ficam como
       STRING literal (igual ao legado) — são atributos HTML nativos, avaliados no
       escopo global; por isso o cluster de funções que eles chamam é exposto em
       window mais abaixo. -->
  <div class="tela-analise-campanhas">
    <!-- O SUBTITULO E CONTEUDO: diz de quem sao os numeros desta tela.
         Foi trocar isso por um titulo unico que fez a primeira versao
         desta barra ser revertida. -->
    <barra-de-topo voltar="Meta Ads" titulo="Análise de Campanhas" subtitulo="Meta Ads · Inteligência RBV" @voltar="closeMetaCampanha">
    <!-- FAIXA DE CONTROLES DENTRO DA BARRA (2026-08-06, pedido do dono).
         Antes era irma da barra, numa faixa propria — e no computador isso
         gastava ~80px de altura a toa. Agora entra pelo encaixe de acoes, que
         ja resolve os dois tamanhos sozinho: fica na linha 1 quando cabe
         (computador) e desce em largura cheia quando nao cabe (celular). -->
    <template #acoes>

    <!-- FAIXA DE CONTROLES: periodo e filtros. Nao sao acoes pequenas —
         sao uma tira larga que dentro da barra disputava espaco com o
         titulo. Aqui tem a linha propria. -->
    <div class="gv-controles">
      <div class="gv-period-btns" id="ma-period-btns">
        <button class="gv-pbtn" data-preset="today" onclick="setMaPeriod(this)"><span style="display:inline-block;width:5px;height:5px;border-radius:50%;background:var(--green);margin-right:5px;animation:pulse 2s infinite;vertical-align:middle;flex-shrink:0;"></span>HOJE</button>
        <button class="gv-pbtn" data-preset="1d" onclick="setMaPeriod(this)">1D</button>
        <button class="gv-pbtn" data-preset="7d" onclick="setMaPeriod(this)">7D</button>
        <button class="gv-pbtn" data-preset="14d" onclick="setMaPeriod(this)">14D</button>
        <button class="gv-pbtn" data-preset="30d" onclick="setMaPeriod(this)">30D</button>
        <button class="gv-pbtn" data-preset="monthfull" onclick="setMaPeriod(this)">MÊS</button>
        <button class="gv-pbtn" data-preset="lastmonth" onclick="setMaPeriod(this)">MÊS PASS.</button>
        <button class="gv-pbtn active" data-preset="sofar" onclick="setMaPeriod(this)">ATÉ AGORA</button>
        <button class="custom-range-btn" id="ma-custom-range-btn" onclick="toggleMaCustomRange()">📅</button>
        <button class="gv-pbtn" id="ma-refresh-btn" onclick="loadMaData()" style="border-color:var(--accent);color:var(--accent)">↻</button>
      </div>
      <div id="ma-account-picker" onclick="event.stopPropagation()" style="position:relative;display:flex;flex-direction:column;align-items:flex-end;gap:3px;flex-shrink:0;">
        <button class="btn" id="ma-acc-trigger" onclick="event.stopPropagation();toggleMaAccPicker()">
          <img id="ma-acc-img" style="width:22px;height:22px;border-radius:50%;object-fit:cover;display:none;flex-shrink:0;" alt="">
          <span id="ma-acc-av" style="width:22px;height:22px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;font-family:var(--fonte-principal);font-size:max(9px, calc(11px * var(--escala-texto, 1)));font-weight:700;color:var(--sobre-cor);flex-shrink:0;"></span>
          <span id="ma-acc-name" style="font-weight:500;max-width:200px;overflow-wrap:anywhere;">—</span>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <div id="ma-acc-dropdown" style="display:none;position:absolute;top:calc(100% + 6px);right:0;min-width:260px;background:var(--surface);border:1px solid var(--border);border-radius:8px;box-shadow:0 8px 28px rgba(0,0,0,.18);z-index:999;overflow:hidden;" onclick="event.stopPropagation()"></div>
      </div>
      <div class="gv-clock-wrap" onclick="event.stopPropagation()">
        <span class="live-dot" style="margin-bottom:4px">Tempo Real</span>
        <div class="gv-clock-time" id="ma-clock">--:--:--</div>
        <div class="gv-clock-date" id="ma-date"></div>
        <div class="gv-update-status" id="ma-update-status">—</div>
      </div>
    
    </div>
    </template>
    </barra-de-topo>
    <div class="ma-body" id="ma-content-wrap">
      <div id="ma-content"></div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, onUnmounted } from 'vue'
import BarraDeTopo from '../../compartilhado/barra-de-topo.vue'
import { useRouter } from 'vue-router'
import { sbClient, SUPABASE_URL, SUPABASE_ANON_KEY } from '../../compartilhado/conectar-no-banco-de-dados.js'
import { estado, hasPermission } from '../../compartilhado/controle-de-login-e-usuario.js'
import { adminToast } from '../../compartilhado/avisos.js'
// Traduz 401/42501 para uma frase que o dono entende. Ver seção 9 do
// PADRAO-DA-CENTRAL: "a tela nunca mente" — e não fala em código de erro.
import { classificarErro } from '../../compartilhado/classificar-erro.js'

const router = useRouter()

const logoClaroUrl = '/midia/LOGOTIPOBRENOPRETO.png'
const logoEscuroUrl = '/midia/LOGOTIPOBRENOBRANCO.png'

// ==========================================================================
// PORTE VERBATIM da Análise de Campanhas do Meta Ads (legacy/index.html —
// funções espalhados entre L7162-7184 e L8607-9638), menos openMetaCampanha/
// closeMetaCampanha, que viraram onMounted/closeMetaCampanha(cleanup+router)
// abaixo, e o listener de fechar o dropdown de contas (documento inteiro),
// que virou addEventListener/removeEventListener em onMounted/onUnmounted em
// vez de rodar sempre solto no escopo global do monólito.
//
// Dependências externas resolvidas:
//   - sbClient, SUPABASE_URL, SUPABASE_ANON_KEY → import (conectar-no-banco-de-dados.js)
//   - hasPermission                              → import (controle-de-login-e-usuario.js)
//   - adminToast                                 → import (avisos.js) — usado só na guarda
//   - estado.currentSession                      → substitui a global solta `currentSession`
//     do legado, usada dentro de adTok()/adFetch() (legacy L4377/4378).
//   - metaFetch, metaFetchAll, adFetch, escHtml, adTok → COPIADOS abaixo (helpers
//     do legado que este módulo usa e que ainda não têm um lugar compartilhado
//     no Vue; ver legacy L8569, L8584, L4378, L4851). _gtEsc (legacy L8520,
//     helper de escape da Gestão de Tráfego, ainda não portada) foi substituído
//     pelo escHtml equivalente nos dois pontos onde era chamado dentro deste
//     módulo (_buildMaCampaignSection/_buildMaAdSection) — são idênticos
//     caractere a caractere.
//   - fmtR/fmtR0/perfColor (legacy L3394-3396) NÃO foram copiados: o módulo de
//     Análise de Campanhas usa só as variantes próprias _maFmtR/_maFmt/_maFmtPct,
//     nunca essas — conferido por grep no bloco inteiro antes de portar.
//   - _gtConfirm (modal de ajuda da Gestão de Tráfego, ainda não portada) não
//     existe aqui: _maKpiHelp/_maTableHelp/_maFunnelHelp mantêm o mesmo guard
//     `typeof _gtConfirm==='function'` do legado — sem ela, os botões "?" ficam
//     mudos (comportamento idêntico ao monólito antes da GT existir).
//
// Nada foi reescrito para template reativo — o conteúdo de #ma-content segue
// montado via getElementById/createElement/innerHTML, exatamente como a
// produção atual. Por isso todo o cluster de funções MA usadas em onclick="..."
// (no <template> acima e dentro do HTML gerado em runtime) é exposto em window
// no fim deste bloco.
// ==========================================================================

/* ── Helpers copiados do legado (self-contidos) ── */
function escHtml(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function adTok(){return estado.currentSession?.access_token||SUPABASE_ANON_KEY;}
function adFetch(path,opts={}){return fetch(`${SUPABASE_URL}/rest/v1/${path}`,{...opts,headers:{apikey:SUPABASE_ANON_KEY,Authorization:`Bearer ${adTok()}`,'Content-Type':'application/json',...(opts.headers||{})}});}
async function metaFetch(path,params,accountId){
  const{data:{session}}=await sbClient.auth.getSession();
  if(!session)throw new Error('Não autenticado');
  const ctrl=new AbortController();const timer=setTimeout(()=>ctrl.abort(),15000);
  try{
    const r=await fetch(SUPABASE_URL+'/functions/v1/meta-proxy',{
      method:'POST',signal:ctrl.signal,
      headers:{'Authorization':'Bearer '+session.access_token,'apikey':SUPABASE_ANON_KEY,'Content-Type':'application/json'},
      body:JSON.stringify({accountId,path,params})
    });
    const d=await r.json();
    if(d&&d.error)throw new Error((d.error&&d.error.message)||d.error||'Meta API error');
    return d;
  }finally{clearTimeout(timer);}
}
async function metaFetchAll(path,params,accountId){
  let results=[];const p={...params,limit:500};
  let data=await metaFetch(path,p,accountId);
  results=results.concat(data.data||[]);
  while(data.paging?.cursors?.after&&results.length<2000){
    const np={...p,after:data.paging.cursors.after};
    data=await metaFetch(path,np,accountId);
    results=results.concat(data.data||[]);
  }
  return results;
}

/* ── META ADS CLOCK (mesma dinâmica do GV — legacy L7162-7184) ── */
function startMaClock(){
  const tEl=document.getElementById('ma-clock'),dEl=document.getElementById('ma-date');
  if(!tEl)return;
  const tick=()=>{
    const now=new Date();
    tEl.textContent=String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0')+':'+String(now.getSeconds()).padStart(2,'0');
    if(dEl){const ds=now.toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'long'});dEl.textContent=ds.toUpperCase();}
  };
  tick();if(window._maClockTimer)clearInterval(window._maClockTimer);
  window._maClockTimer=setInterval(tick,1000);
}
let _maLastLoadTime=null;
let _maStatusTimer=null;
function updateMaUpdateStatus(){
  const el=document.getElementById('ma-update-status');
  if(!el)return;
  if(!_maLastLoadTime){el.textContent='—';return;}
  const pad=n=>String(n).padStart(2,'0');
  const fmt=d=>`${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const next=new Date(_maLastLoadTime.getTime()+5*60*1000);
  el.textContent=`ULT. ${fmt(_maLastLoadTime)} · PRÓX. ${fmt(next)}`;
}

/* ── Estado do módulo (legacy L7762-7765, verbatim) ── */
const META_GRAPH='https://graph.facebook.com/v22.0'; // mantido por fidelidade, não referenciado diretamente neste arquivo
let _maAccounts=[];
let _maCurAcc=null;
let _maPreset='sofar';
let _maCharts={};

/* ── Dropdown de contas (legacy L8635-8637): no monólito o listener de
   fechar-ao-clicar-fora era registrado uma vez, solto, no carregamento do
   script inteiro. Aqui vira addEventListener/removeEventListener amarrado ao
   ciclo de vida do componente (onMounted/onUnmounted mais abaixo). ── */
let _maPickerOpen=false;
function _maDocClick(){
  _maPickerOpen=false;
  const d=document.getElementById('ma-acc-dropdown');
  if(d)d.style.display='none';
}
function toggleMaAccPicker(){_maPickerOpen=!_maPickerOpen;document.getElementById('ma-acc-dropdown').style.display=_maPickerOpen?'block':'none';}

function _setMaCurAccUI(acc){
  const img=document.getElementById('ma-acc-img');
  const av=document.getElementById('ma-acc-av');
  const nm=document.getElementById('ma-acc-name');
  const pic=acc.profile_picture_url||acc.picture_url||'';
  const label=acc.display_name||acc.name||'—';
  if(pic){img.src=pic;img.style.display='block';av.style.display='none';}
  else{img.style.display='none';av.style.display='flex';av.textContent=label.charAt(0).toUpperCase();}
  if(nm)nm.textContent=label;
}

let _maInitInFlight=false;
async function _initMetaAds(){
  if(_maInitInFlight)return;
  _maInitInFlight=true;
  const drop=document.getElementById('ma-acc-dropdown');
  const nm=document.getElementById('ma-acc-name');
  const content=document.getElementById('ma-content');
  if(nm)nm.textContent='Carregando…';
  try{
    // Fetch all social accounts from Supabase
    const res=await adFetch('accounts?select=id,name,instagram_id,ad_account_id,profile_picture_url,picture_url&order=name.asc');
    // As DUAS guardas abaixo são o que salvou esta tela em 13/08, quando a irmã
    // (Gestor de Tráfego) caiu com "g is not iterable": sem elas, um corpo de
    // erro do PostgREST desce como objeto e estoura no `for...of` mais abaixo.
    // Não remover.
    const corpoContas=await res.json().catch(()=>null);
    // O status vira frase de gente: a regra do projeto é o dono ler "sua sessão
    // expirou", não "Supabase 401" (ver classificar-erro.js e seção 9 do
    // PADRAO-DA-CENTRAL). O código cru fica no console, pra quem conserta.
    if(!res.ok){
      console.error('[MetaAds] o banco recusou a lista de contas:',res.status,corpoContas);
      throw new Error(classificarErro(res.status,corpoContas).mensagem);
    }
    const socialAccs=corpoContas;
    if(!Array.isArray(socialAccs))throw new Error('O banco não devolveu a lista de contas.');

    const seen=new Set();
    _maAccounts=[];

    // STEP 1 — accounts with ad_account_id explicitly linked in Supabase (best: correct photo)
    for(const acc of socialAccs){
      if(!acc.ad_account_id)continue;
      const cleanId=_maCleanAccId(acc.ad_account_id);
      if(seen.has(cleanId))continue;
      seen.add(cleanId);
      _maAccounts.push({...acc,ad_account_id:cleanId,display_name:acc.name,balance:null,_fromSupabase:true});
    }

    // STEP 2 — discover remaining ad accounts via /me/adaccounts (token lives in meta-proxy).
    // All Supabase accounts share the same Meta token, so any account row works as the proxy
    // carrier: meta-proxy resolves the token from accounts.id, and that token owns every ad account.
    const carrierId=socialAccs.find(a=>a.id)?.id||null;
    if(carrierId){
      // Map cleanAdAccountId → photo for accounts explicitly linked in Supabase (avoids sharing token-owner's photo)
      const adAccPhotoMap={};
      socialAccs.forEach(a=>{if(a.ad_account_id&&(a.profile_picture_url||a.picture_url))adAccPhotoMap[_maCleanAccId(a.ad_account_id)]=a.profile_picture_url||a.picture_url;});
      try{
        const d=await metaFetch('/me/adaccounts',{fields:'id,name,account_status,currency'},carrierId);
        for(const adAcc of(d?.data||[])){
          const cleanId=_maCleanAccId(adAcc.id);
          if(seen.has(cleanId))continue;
          seen.add(cleanId);
          _maAccounts.push({
            id:carrierId,name:adAcc.name,instagram_id:null,
            ad_account_id:cleanId,display_name:adAcc.name,
            currency:adAcc.currency,account_status:adAcc.account_status,
            profile_picture_url:adAccPhotoMap[cleanId]||'',picture_url:'',balance:null,
            _fromSupabase:false,
          });
        }
      }catch(e){console.warn('[MetaAds] /me/adaccounts discovery failed:',e.message);}
    }

    if(!_maAccounts.length){
      if(nm)nm.textContent='Sem contas';
      if(drop)drop.innerHTML='<div style="padding:14px;font-size:max(9px, calc(12px * var(--escala-texto, 1)));color:var(--muted);text-align:center">Nenhuma conta de anúncios encontrada</div>';
      if(content)content.innerHTML='<div class="gv-loading-screen"><span class="gv-loading-lbl" style="text-align:center">Nenhuma conta de anúncios encontrada.<br><span style="font-size:max(9px, calc(9px * var(--escala-texto, 1)));opacity:.6">Verifique se há contas com ad_account_id cadastradas no Supabase.</span></span></div>';
      return;
    }

    // STEP 3 — enrich each account: fetch name + balance + this-month spend from Meta
    await Promise.all(_maAccounts.map(async a=>{
      try{
        const[d,spData]=await Promise.all([
          metaFetch(`/act_${a.ad_account_id}`,{fields:'name,balance,currency'},a.id),
          metaFetch(`/act_${a.ad_account_id}/insights`,{fields:'spend',date_preset:'this_month'},a.id).catch(()=>null),
        ]);
        if(d?.name)a.display_name=d.name;
        if(d?.balance!==undefined)a.balance=parseFloat(d.balance)/100;
        if(d?.currency)a.currency=d.currency;
        a.monthSpend=parseFloat(spData?.data?.[0]?.spend||0);
      }catch(e){a.monthSpend=0;}
    }));
    // Sort by this-month spend descending so highest spenders appear first
    _maAccounts.sort((a,b)=>(b.monthSpend||0)-(a.monthSpend||0));

    _buildMaDropdown(drop);
    _maCurAcc=_maAccounts[0];_setMaCurAccUI(_maAccounts[0]);loadMaData();
  }catch(e){
    console.error('[MetaAds] _initMetaAds error:',e);
    if(nm)nm.textContent='Erro';
    if(content)content.innerHTML=`<div class="gv-loading-screen"><span class="gv-loading-lbl" style="color:var(--red)">Erro: ${e.message}</span></div>`;
  }finally{
    _maInitInFlight=false;
  }
}

function _buildMaDropdown(drop){
  drop.innerHTML='';
  _maAccounts.forEach((a,idx)=>{
    const row=document.createElement('div');
    row.style.cssText='display:flex;align-items:center;gap:12px;padding:10px 14px;cursor:pointer;transition:background .13s;';
    row.addEventListener('mouseenter',()=>row.style.background='var(--surface2)');
    row.addEventListener('mouseleave',()=>row.style.background='');
    const lbl=a.display_name||a.name||'—';
    const bal=a.balance;
    const balColor=bal==null?'var(--muted)':bal>=1000?'var(--green)':bal>=500?'var(--orange)':'var(--red)';
    const balStr=bal!=null?_maFmtR(bal):'—';
    const spendTxt=a.monthSpend>0?`R$ ${a.monthSpend.toLocaleString('pt-BR',{minimumFractionDigits:0,maximumFractionDigits:0})} este mês`:'';
    row.innerHTML=`
      <div style="width:20px;flex-shrink:0;font-family:var(--fonte-principal);font-size:max(9px, calc(11px * var(--escala-texto, 1)));font-weight:700;color:var(--muted);text-align:right;">${idx+1}</div>
      <div style="flex:1;min-width:0;">
        <div style="font-family:var(--fonte-principal);font-size:max(9px, calc(13px * var(--escala-texto, 1)));font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${lbl}</div>
        ${spendTxt?`<div style="font-family:var(--fonte-principal);font-size:max(9px, calc(10px * var(--escala-texto, 1)));color:var(--muted);margin-top:1px;">${spendTxt} gasto</div>`:''}
      </div>
      <div style="text-align:right;flex-shrink:0;">
        <div style="font-family:var(--fonte-dados);font-size:max(16px, calc(16px * var(--escala-texto, 1)));font-weight:700;color:${balColor};line-height:1;">${balStr}</div>
        <div style="font-family:var(--fonte-principal);font-size:max(9px, calc(9px * var(--escala-texto, 1)));color:var(--muted);margin-top:2px;letter-spacing:.3px;text-transform:uppercase;">saldo</div>
      </div>
    `;
    row.addEventListener('click',()=>{_maCurAcc=a;_setMaCurAccUI(a);toggleMaAccPicker();loadMaData();});
    drop.appendChild(row);
  });
}

let _maCustomSince=null,_maCustomUntil=null;

function setMaPeriod(btn){
  document.querySelectorAll('#ma-period-btns .gv-pbtn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  _maPreset=btn.dataset.preset;
  _maCustomSince=null;_maCustomUntil=null;
  document.getElementById('ma-custom-modal-bd')?.remove();
  document.getElementById('ma-custom-modal')?.remove();
  document.getElementById('ma-custom-range-btn')?.classList.remove('active');
  loadMaData();
}

function toggleMaCustomRange(){
  document.getElementById('ma-custom-modal')?.remove();
  document.getElementById('ma-custom-modal-bd')?.remove();

  const rangeBtn=document.getElementById('ma-custom-range-btn');

  // Pre-fill with existing custom range or leave empty
  const startVal=_maCustomSince||'';
  const endVal=_maCustomUntil||'';

  const bd=document.createElement('div');
  bd.id='ma-custom-modal-bd';
  bd.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:1100;display:flex;align-items:center;justify-content:center;padding-top:max(16px,env(safe-area-inset-top));padding-bottom:max(16px,env(safe-area-inset-bottom));padding-left:max(12px,env(safe-area-inset-left));padding-right:max(12px,env(safe-area-inset-right));touch-action:none;overscroll-behavior:contain;';

  const modal=document.createElement('div');
  modal.id='ma-custom-modal';
  modal.style.cssText='background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:28px 28px 22px;box-shadow:0 16px 48px rgba(0,0,0,.28);width:320px;max-width:92vw;display:flex;flex-direction:column;gap:20px;position:relative;z-index:1101;';
  modal.onclick=e=>e.stopPropagation();

  modal.innerHTML=`
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">
      <div>
        <div style="font-family:var(--fonte-principal);font-size:max(9px, calc(10px * var(--escala-texto, 1)));font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--muted);margin-bottom:4px;">Período Personalizado</div>
        <div style="font-family:var(--fonte-principal);font-size:max(16px, calc(20px * var(--escala-texto, 1)));font-weight:700;color:var(--text);line-height:1;">Selecionar Datas</div>
      </div>
      <button id="ma-modal-close" style="background:none;border:1px solid var(--border);border-radius:7px;width:32px;height:32px;cursor:pointer;color:var(--muted);font-size:max(16px, calc(16px * var(--escala-texto, 1)));display:flex;align-items:center;justify-content:center;flex-shrink:0;">✕</button>
    </div>
    <div style="display:flex;flex-direction:column;gap:12px;">
      <div style="display:flex;flex-direction:column;gap:5px;">
        <label style="font-family:var(--fonte-principal);font-size:max(9px, calc(10px * var(--escala-texto, 1)));font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--muted);">Início</label>
        <input type="date" id="ma-custom-start" value="${startVal}" class="custom-date-input" style="width:100%;box-sizing:border-box;font-size:max(9px, calc(13px * var(--escala-texto, 1)));padding:8px 12px;">
      </div>
      <div style="display:flex;flex-direction:column;gap:5px;">
        <label style="font-family:var(--fonte-principal);font-size:max(9px, calc(10px * var(--escala-texto, 1)));font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--muted);">Fim</label>
        <input type="date" id="ma-custom-end" value="${endVal}" class="custom-date-input" style="width:100%;box-sizing:border-box;font-size:max(9px, calc(13px * var(--escala-texto, 1)));padding:8px 12px;">
      </div>
    </div>
    <div style="display:flex;gap:8px;">
      <button class="btn" id="ma-modal-clear" style="flex:1">Limpar</button>
      <button class="btn btn-principal" id="ma-modal-apply" style="flex:2">Aplicar</button>
    </div>
  `;

  const close=()=>{bd.remove();rangeBtn.classList.remove('active');};
  bd.addEventListener('click',close);
  modal.querySelector('#ma-modal-close').addEventListener('click',close);

  modal.querySelector('#ma-modal-clear').addEventListener('click',()=>{
    _maCustomSince=null;_maCustomUntil=null;
    close();
    const def=document.querySelector('#ma-period-btns .gv-pbtn[data-preset="sofar"]');
    if(def){def.classList.add('active');_maPreset='sofar';}
    loadMaData();
  });

  modal.querySelector('#ma-modal-apply').addEventListener('click',()=>{
    const s=modal.querySelector('#ma-custom-start').value;
    const e=modal.querySelector('#ma-custom-end').value;
    if(!s||!e){modal.querySelector('#ma-custom-start').style.borderColor=s?'var(--border)':'var(--red)';modal.querySelector('#ma-custom-end').style.borderColor=e?'var(--border)':'var(--red)';return;}
    if(s>e){modal.querySelector('#ma-custom-end').style.borderColor='var(--red)';return;}
    _maCustomSince=s;_maCustomUntil=e;
    document.querySelectorAll('#ma-period-btns .gv-pbtn').forEach(b=>b.classList.remove('active'));
    rangeBtn.classList.add('active');
    close();
    loadMaData();
  });

  bd.appendChild(modal);
  document.body.appendChild(bd);
  rangeBtn.classList.add('active');
  // Focus first empty input
  setTimeout(()=>{
    const inp=modal.querySelector(startVal?'#ma-custom-end':'#ma-custom-start');
    inp?.focus();
  },50);
}

function applyMaCustomRange(){} // kept for legacy refs, logic now in modal
function clearMaCustomRange(){
  _maCustomSince=null;_maCustomUntil=null;
  document.getElementById('ma-custom-range-btn')?.classList.remove('active');
  const def=document.querySelector('#ma-period-btns .gv-pbtn[data-preset="sofar"]');
  if(def){def.classList.add('active');_maPreset='sofar';}
  loadMaData();
}

// GV-style date range from preset — same logic as loadGestaoVistaData
function _maDateRange(preset){
  const now=new Date();
  const iso=d=>{const yy=d.getFullYear(),mm=String(d.getMonth()+1).padStart(2,'0'),dd=String(d.getDate()).padStart(2,'0');return`${yy}-${mm}-${dd}`;};
  const add=n=>iso(new Date(now.getFullYear(),now.getMonth(),now.getDate()+n));
  const today=iso(now);
  const y=now.getFullYear(),m=now.getMonth()+1;
  const firstOfMonth=`${y}-${String(m).padStart(2,'0')}-01`;
  const pmEnd=new Date(y,m-1,0),pmStart=new Date(y,m-2,1);   // mês passado (anterior)
  const ppEnd=new Date(y,m-2,0),ppStart=new Date(y,m-3,1);   // mês retrasado (p/ comparação do mês passado)
  if(preset==='today')return{since:today,until:today,prevSince:add(-1),prevUntil:add(-1)};
  if(preset==='1d'){const d=add(-1);return{since:d,until:d,prevSince:add(-2),prevUntil:add(-2)};}
  if(preset==='7d')return{since:add(-7),until:today,prevSince:add(-14),prevUntil:add(-8)};
  if(preset==='14d')return{since:add(-14),until:today,prevSince:add(-28),prevUntil:add(-15)};
  if(preset==='30d')return{since:add(-30),until:today,prevSince:add(-60),prevUntil:add(-31)};
  if(preset==='lastmonth')return{since:iso(pmStart),until:iso(pmEnd),prevSince:iso(ppStart),prevUntil:iso(ppEnd)};
  // 'monthfull' (MÊS) e 'sofar' (ATÉ AGORA): mês corrente até hoje (Ads não têm dado futuro,
  // então o realizado é o mesmo); anterior = mês passado inteiro.
  return{since:firstOfMonth,until:today,prevSince:iso(pmStart),prevUntil:iso(pmEnd)};
}

async function loadMaData(){
  if(!_maCurAcc)return;
  const content=document.getElementById('ma-content');
  content.innerHTML='<div class="gv-loading-screen"><div class="gv-spinner"></div><span class="gv-loading-lbl">Carregando campanhas</span></div>';
  Object.values(_maCharts).forEach(c=>{try{c.destroy();}catch(e){}});_maCharts={};

  let since,until,prevSince,prevUntil;
  if(_maCustomSince&&_maCustomUntil){
    since=_maCustomSince;until=_maCustomUntil;
    // prev range = same length immediately before since
    const days=Math.round((new Date(until)-new Date(since))/86400000);
    const iso=d=>{const dd=new Date(d);return dd.toISOString().slice(0,10);};
    const shift=n=>{const d=new Date(since+'T12:00:00');d.setDate(d.getDate()+n);return iso(d);};
    prevUntil=shift(-1);prevSince=shift(-days-1);
  }else{
    ({since,until,prevSince,prevUntil}=_maDateRange(_maPreset));
  }
  try{
    const[insights,campaigns,prevInsights,daily,prevDaily,adInsights,acctReach]=await Promise.all([
      _fetchInsights(_maCurAcc.ad_account_id,_maCurAcc.id,{time_range:{since,until}}),
      _fetchCampaigns(_maCurAcc.ad_account_id,_maCurAcc.id),
      _fetchInsights(_maCurAcc.ad_account_id,_maCurAcc.id,{time_range:{since:prevSince,until:prevUntil}}).catch(()=>[]),
      _fetchDaily(_maCurAcc.ad_account_id,_maCurAcc.id,since,until),
      _fetchDaily(_maCurAcc.ad_account_id,_maCurAcc.id,prevSince,prevUntil).catch(()=>[]),
      _fetchAdInsights(_maCurAcc.ad_account_id,_maCurAcc.id,since,until).catch(()=>[]),
      _fetchAccountReach(_maCurAcc.ad_account_id,_maCurAcc.id,since,until).catch(()=>null),
    ]);
    _renderMaCampanha(content,{insights,campaigns,prevInsights,daily,prevDaily,adInsights,acctReach});
    _maLastLoadTime=new Date();
    updateMaUpdateStatus();
    if(!_maStatusTimer)_maStatusTimer=setInterval(updateMaUpdateStatus,60000);
  }catch(e){
    content.innerHTML=`<div class="gv-loading-screen"><span class="gv-loading-lbl" style="color:var(--red)">Erro: ${e.message}</span></div>`;
  }
}

function _maCleanAccId(id){return String(id||'').replace(/^act_/,'');}
async function _fetchInsights(adAccId,accountId,params){
  const fields='campaign_id,campaign_name,objective,spend,impressions,clicks,reach,ctr,cpc,cpm,frequency,actions,cost_per_action_type';
  return metaFetchAll(`/act_${_maCleanAccId(adAccId)}/insights`,{level:'campaign',fields,filtering:JSON.stringify([{field:'spend',operator:'GREATER_THAN',value:'0'}]),...params},accountId);
}
async function _fetchCampaigns(adAccId,accountId){
  const fields='id,name,objective,status,effective_status,daily_budget,lifetime_budget';
  try{return await metaFetchAll(`/act_${_maCleanAccId(adAccId)}/campaigns`,{fields,effective_status:JSON.stringify(['ACTIVE','PAUSED','ARCHIVED'])},accountId);}catch(e){return[];}
}
async function _fetchDaily(adAccId,accountId,since,until){
  const fields='spend,impressions,clicks,reach,date_start';
  try{return await metaFetchAll(`/act_${_maCleanAccId(adAccId)}/insights`,{level:'account',fields,time_increment:1,time_range:{since,until}},accountId);}catch(e){return[];}
}
async function _fetchAdInsights(adAccId,accountId,since,until){
  const fields='ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,objective,spend,impressions,clicks,ctr,cpc,cpm,reach,frequency,actions';
  try{return await metaFetchAll(`/act_${_maCleanAccId(adAccId)}/insights`,{level:'ad',fields,filtering:JSON.stringify([{field:'spend',operator:'GREATER_THAN',value:'0'}]),time_range:{since,until}},accountId);}catch(e){return[];}
}
// Reach REAL do período: nível conta, SEM time_increment → a Meta deduplica.
// Somar reach por campanha (ou por dia) conta a mesma pessoa várias vezes.
async function _fetchAccountReach(adAccId,accountId,since,until){
  try{const r=await metaFetchAll(`/act_${_maCleanAccId(adAccId)}/insights`,{level:'account',fields:'reach,frequency',time_range:{since,until}},accountId);return r&&r[0]?r[0]:null;}catch(e){return null;}
}

function _getActions(ins,type){
  const a=(ins.actions||[]).find(x=>x.action_type===type);
  return a?parseFloat(a.value||0):0;
}
function _getCpa(ins,type){
  const a=(ins.cost_per_action_type||[]).find(x=>x.action_type===type);
  return a?parseFloat(a.value||0):0;
}


function _maFmtR(v){if(!v&&v!==0)return'—';const n=parseFloat(v);if(n>=1000)return'R$'+n.toLocaleString('pt-BR',{minimumFractionDigits:0,maximumFractionDigits:0});return'R$'+n.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});}
function _maFmt(v,dec=0){if(!v&&v!==0)return'—';return parseFloat(v).toLocaleString('pt-BR',{minimumFractionDigits:dec,maximumFractionDigits:dec});}
function _maFmtPct(v){return parseFloat(v||0).toFixed(2)+'%';}
function _maDelta(cur,prev){
  if(!prev||prev===0)return{pct:null,cls:'ma-delta-neu',sym:'—'};
  const pct=((cur-prev)/prev*100);
  if(pct>0)return{pct,cls:'ma-delta-up',sym:'▲ +'+pct.toFixed(1)+'%'};
  if(pct<0)return{pct,cls:'ma-delta-down',sym:'▼ '+pct.toFixed(1)+'%'};
  return{pct:0,cls:'ma-delta-neu',sym:'— 0%'};
}
function _maObjLabel(obj){
  const m={OUTCOME_TRAFFIC:'Tráfego',OUTCOME_ENGAGEMENT:'Engajamento',OUTCOME_LEADS:'Leads',OUTCOME_SALES:'Vendas',OUTCOME_AWARENESS:'Reconhecimento',LINK_CLICKS:'Cliques',PAGE_LIKES:'Curtidas',VIDEO_VIEWS:'Vídeo'};
  return m[obj]||(obj||'—');
}
function _maScore(ctr){if(ctr>=2)return'good';if(ctr>=0.8)return'mid';return'bad';}

// Funil config por objetivo
const MA_FUNNEL_DEF={
  OUTCOME_TRAFFIC:{label:'Tráfego',steps:[
    {key:'impressions',label:'Impressões',icon:'👁',color:'#1877F2',cost:(s,v)=>v>0?s/v*1000:0,costLabel:'CPM'},
    {key:'reach',label:'Alcance',icon:'📡',color:'#1565C0',cost:(s,v)=>v>0?s/v*1000:0,costLabel:'Custo/mil alc.'},
    {key:'clicks',label:'Cliques',icon:'🖱',color:'#0062E0',cost:(s,v)=>v>0?s/v:0,costLabel:'CPC'},
    {key:'link_clicks',label:'Cliques no Link',icon:'🔗',color:'#0D47A1',cost:(s,v)=>v>0?s/v:0,costLabel:'Cost/link click'},
  ]},
  OUTCOME_LEADS:{label:'Leads',steps:[
    {key:'impressions',label:'Impressões',icon:'👁',color:'var(--roxo)',cost:(s,v)=>v>0?s/v*1000:0,costLabel:'CPM'},
    {key:'reach',label:'Alcance',icon:'📡',color:'var(--roxo)',cost:(s,v)=>v>0?s/v*1000:0,costLabel:'Custo/mil alc.'},
    {key:'clicks',label:'Cliques',icon:'🖱',color:'#5B21B6',cost:(s,v)=>v>0?s/v:0,costLabel:'CPC'},
    {key:'lead',label:'Leads',icon:'📋',color:'#4C1D95',cost:(s,v)=>v>0?s/v:0,costLabel:'CPL',action:true},
  ]},
  OUTCOME_ENGAGEMENT:{label:'Engajamento',steps:[
    {key:'impressions',label:'Impressões',icon:'👁',color:'var(--orange)',cost:(s,v)=>v>0?s/v*1000:0,costLabel:'CPM'},
    {key:'reach',label:'Alcance',icon:'📡',color:'var(--orange)',cost:(s,v)=>v>0?s/v*1000:0,costLabel:'Custo/mil alc.'},
    {key:'post_engagement',label:'Engajamentos',icon:'❤️',color:'#92400E',cost:(s,v)=>v>0?s/v:0,costLabel:'Custo/eng.',action:true},
    {key:'video_view',label:'Visualiz. Vídeo',icon:'▶️',color:'#78350F',cost:(s,v)=>v>0?s/v:0,costLabel:'Custo/view',action:true,optional:true},
  ]},
  OUTCOME_SALES:{label:'Vendas',steps:[
    {key:'impressions',label:'Impressões',icon:'👁',color:'#059669',cost:(s,v)=>v>0?s/v*1000:0,costLabel:'CPM'},
    {key:'reach',label:'Alcance',icon:'📡',color:'#047857',cost:(s,v)=>v>0?s/v*1000:0,costLabel:'Custo/mil alc.'},
    {key:'clicks',label:'Cliques',icon:'🖱',color:'#065F46',cost:(s,v)=>v>0?s/v:0,costLabel:'CPC'},
    {key:'add_to_cart',label:'Carrinhos',icon:'🛒',color:'#064E3B',cost:(s,v)=>v>0?s/v:0,costLabel:'Custo/carrinho',action:true},
    {key:'purchase',label:'Compras',icon:'💳',color:'#022C22',cost:(s,v)=>v>0?s/v:0,costLabel:'CPA',action:true},
  ]},
  OUTCOME_AWARENESS:{label:'Reconhecimento',steps:[
    {key:'impressions',label:'Impressões',icon:'👁',color:'#0891B2',cost:(s,v)=>v>0?s/v*1000:0,costLabel:'CPM'},
    {key:'reach',label:'Alcance',icon:'📡',color:'#0E7490',cost:(s,v)=>v>0?s/v*1000:0,costLabel:'Custo/mil alc.'},
  ]},
  LINK_CLICKS:{label:'Cliques',steps:[
    {key:'impressions',label:'Impressões',icon:'👁',color:'#1877F2',cost:(s,v)=>v>0?s/v*1000:0,costLabel:'CPM'},
    {key:'clicks',label:'Cliques',icon:'🖱',color:'#0062E0',cost:(s,v)=>v>0?s/v:0,costLabel:'CPC'},
  ]},
};

let _maSelectedCampaigns=null; // null = all

function _getStepValue(insArr,step){
  if(step.action){
    return insArr.reduce((s,x)=>s+_getActions(x,step.key),0);
  }
  return insArr.reduce((s,x)=>s+parseFloat(x[step.key]||0),0);
}

function _renderFunnel(el,insArr,objective){
  const def=MA_FUNNEL_DEF[objective];
  if(!def){el.innerHTML='<div style="color:var(--muted);font-size:max(9px, calc(12px * var(--escala-texto, 1)));text-align:center;padding:20px">Funil não disponível para este objetivo</div>';return;}
  const spend=insArr.reduce((s,x)=>s+parseFloat(x.spend||0),0);
  const steps=def.steps.filter(st=>!st.optional||_getStepValue(insArr,st)>0);
  const maxVal=_getStepValue(insArr,steps[0])||1;
  el.innerHTML='';
  const wrap=document.createElement('div');
  wrap.style.cssText='display:flex;flex-direction:column;align-items:stretch;gap:0;width:100%;padding:4px 0;';
  steps.forEach((step,i)=>{
    const val=_getStepValue(insArr,step);
    const cost=step.cost(spend,val);
    const pct=maxVal>0?Math.max(14,val/maxVal*100):14;
    const prevVal=i>0?_getStepValue(insArr,steps[i-1]):null;
    const convRate=prevVal>0?val/prevVal*100:null;
    const valFmt=val>=1e6?_maFmt(val/1e6,1)+'M':val>=1000?_maFmt(val):val.toLocaleString('pt-BR');
    // connector between steps
    if(i>0){
      const conn=document.createElement('div');
      conn.style.cssText='display:flex;flex-direction:column;align-items:center;gap:0;padding:3px 0;width:100%;';
      conn.innerHTML=`<div style="width:2px;height:8px;background:var(--border);"></div><div style="font-family:var(--fonte-principal);font-size:max(9px, calc(9px * var(--escala-texto, 1)));color:var(--muted);padding:2px 10px;border:1px solid var(--border);border-radius:10px;background:var(--surface2);white-space:nowrap;">↓ ${convRate!==null?convRate.toFixed(1)+'%':'—'} chegam aqui</div><div style="width:2px;height:8px;background:var(--border);"></div>`;
      wrap.appendChild(conn);
    }
    // step wrapper
    const stepDiv=document.createElement('div');
    stepDiv.style.cssText='display:flex;flex-direction:column;align-items:stretch;gap:0;width:100%;';
    // colored bar — pure visual, tapered, no text inside
    const barRow=document.createElement('div');
    barRow.className='ma-funnel-bar-row';
    const bar=document.createElement('div');
    bar.className='ma-funnel-bar';
    bar.style.cssText=`width:${pct.toFixed(1)}%;height:38px;background:${step.color};border-radius:8px;transition:width .6s ease;`;
    barRow.appendChild(bar);
    stepDiv.appendChild(barRow);
    // info row — always full width, always readable
    const info=document.createElement('div');
    info.className='ma-funnel-info';
    info.innerHTML=`<div style="display:flex;align-items:center;gap:8px;"><span style="font-size:max(16px, calc(18px * var(--escala-texto, 1)));">${step.icon}</span><div><div style="font-family:var(--fonte-principal);font-size:max(9px, calc(9px * var(--escala-texto, 1)));font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--muted);">${step.label}</div><div style="font-family:var(--fonte-dados);font-size:max(16px, calc(22px * var(--escala-texto, 1)));font-weight:700;color:var(--text);line-height:1.1;">${valFmt}</div></div></div><div style="text-align:right;"><div style="font-family:var(--fonte-principal);font-size:max(9px, calc(9px * var(--escala-texto, 1)));color:var(--muted);text-transform:uppercase;letter-spacing:.8px;">${step.costLabel}</div><div style="font-family:var(--fonte-dados);font-size:max(16px, calc(18px * var(--escala-texto, 1)));font-weight:700;color:${step.color};">${cost>0?_maFmtR(cost):'—'}</div></div>`;
    stepDiv.appendChild(info);
    wrap.appendChild(stepDiv);
  });
  el.appendChild(wrap);
}

function _openCampanhaFilter(insights,campaigns,onApply){
  document.getElementById('ma-filter-drawer')?.remove();
  document.getElementById('ma-filter-bd')?.remove();
  const campMap={};campaigns.forEach(c=>campMap[c.id]=c);
  const byObj={};
  insights.forEach(ins=>{const obj=ins.objective||'OTHER';if(!byObj[obj])byObj[obj]=[];byObj[obj].push(ins);});
  const selected=new Set(insights.map(i=>i.campaign_id));

  const drawer=document.createElement('div');drawer.id='ma-filter-drawer';drawer.className='ma-filter-drawer';
  // Header
  const hdr=document.createElement('div');
  hdr.style.cssText='padding:20px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;flex-shrink:0;';
  hdr.innerHTML=`<div><div style="font-family:var(--fonte-principal);font-size:max(9px, calc(10px * var(--escala-texto, 1)));font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--muted);">Filtrar Campanhas</div><div style="font-family:var(--fonte-dados);font-size:max(16px, calc(20px * var(--escala-texto, 1)));font-weight:700;color:var(--text);margin-top:2px;">${insights.length} campanhas</div></div><button onclick="document.getElementById('ma-filter-drawer')?.remove();document.getElementById('ma-filter-bd')?.remove();" style="background:none;border:1px solid var(--border);border-radius:7px;width:32px;height:32px;cursor:pointer;color:var(--muted);font-size:max(16px, calc(16px * var(--escala-texto, 1)));display:flex;align-items:center;justify-content:center;flex-shrink:0;">✕</button>`;
  drawer.appendChild(hdr);

  // Body
  const body=document.createElement('div');body.style.cssText='flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px;';
  Object.entries(byObj).forEach(([obj,camps])=>{
    const def=MA_FUNNEL_DEF[obj];
    const label=def?.label||obj;
    const totalSpend=camps.reduce((s,c)=>s+parseFloat(c.spend||0),0);
    const grp=document.createElement('div');grp.style.cssText='border:1px solid var(--border);border-radius:10px;overflow:hidden;';
    // Group header: "select all" checkbox + label + spend + collapse toggle
    const ghdr=document.createElement('div');
    ghdr.style.cssText='padding:10px 14px;background:var(--surface2);display:flex;align-items:center;gap:10px;user-select:none;';
    const grpChkWrap=document.createElement('label');grpChkWrap.style.cssText='display:flex;align-items:center;cursor:pointer;flex-shrink:0;';
    const grpChk=document.createElement('input');grpChk.type='checkbox';grpChk.style.cssText='width:16px;height:16px;cursor:pointer;accent-color:var(--accent);flex-shrink:0;';
    const allChecked=camps.every(c=>selected.has(c.campaign_id));
    grpChk.checked=allChecked;grpChk.indeterminate=!allChecked&&camps.some(c=>selected.has(c.campaign_id));
    grpChkWrap.appendChild(grpChk);
    ghdr.appendChild(grpChkWrap);
    const grpInfo=document.createElement('div');grpInfo.style.cssText='flex:1;min-width:0;cursor:pointer;';
    grpInfo.innerHTML=`<div style="display:flex;align-items:center;gap:6px;"><span style="font-family:var(--fonte-principal);font-size:max(9px, calc(10px * var(--escala-texto, 1)));font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--text);">${label}</span><span style="font-family:var(--fonte-principal);font-size:max(9px, calc(10px * var(--escala-texto, 1)));color:var(--muted);">${camps.length} camp.</span></div>`;
    ghdr.appendChild(grpInfo);
    const ghdrRight=document.createElement('div');ghdrRight.style.cssText='display:flex;align-items:center;gap:8px;flex-shrink:0;';
    ghdrRight.innerHTML=`<span style="font-family:var(--fonte-principal);font-size:max(9px, calc(12px * var(--escala-texto, 1)));color:var(--text);font-weight:600;">${_maFmtR(totalSpend)}</span><span id="garw_${obj}" style="font-size:max(9px, calc(10px * var(--escala-texto, 1)));color:var(--muted);transition:transform .2s;display:inline-block;">▼</span>`;
    ghdr.appendChild(ghdrRight);

    const gbody=document.createElement('div');gbody.style.cssText='display:flex;flex-direction:column;';
    let grpOpen=true;
    const arwEl=ghdrRight.querySelector(`#garw_${obj}`);
    grpInfo.addEventListener('click',()=>{grpOpen=!grpOpen;gbody.style.display=grpOpen?'':'none';if(arwEl)arwEl.style.transform=grpOpen?'':'rotate(-90deg)';});
    ghdrRight.querySelector('span:last-child')?.addEventListener('click',()=>{grpOpen=!grpOpen;gbody.style.display=grpOpen?'':'none';if(arwEl)arwEl.style.transform=grpOpen?'':'rotate(-90deg)';});

    const rowChks=[];
    function updateGrpChk(){
      const allC=rowChks.every(c=>c.checked);
      const anyC=rowChks.some(c=>c.checked);
      grpChk.checked=allC;grpChk.indeterminate=!allC&&anyC;
    }
    grpChk.addEventListener('change',()=>{
      rowChks.forEach(c=>{c.checked=grpChk.checked;if(grpChk.checked)selected.add(c.value);else selected.delete(c.value);});
    });

    camps.forEach(ins=>{
      const camp=campMap[ins.campaign_id];
      const status=camp?.effective_status||'—';
      const db=camp?.daily_budget?'R$'+(parseFloat(camp.daily_budget)/100).toFixed(0)+'/dia':camp?.lifetime_budget?'R$'+(parseFloat(camp.lifetime_budget)/100).toFixed(0)+' total':'—';
      const ctr=parseFloat(ins.ctr||0);
      const statusColor=status==='ACTIVE'?'var(--green)':status==='PAUSED'?'var(--orange)':'var(--muted)';
      const row=document.createElement('label');
      row.style.cssText='display:flex;align-items:center;gap:12px;padding:10px 14px;border-top:1px solid var(--border);cursor:pointer;transition:background .12s;';
      row.addEventListener('mouseenter',()=>row.style.background='var(--surface2)');
      row.addEventListener('mouseleave',()=>row.style.background='');
      const chk=document.createElement('input');chk.type='checkbox';chk.value=ins.campaign_id;chk.checked=selected.has(ins.campaign_id);
      chk.style.cssText='width:16px;height:16px;cursor:pointer;accent-color:var(--accent);flex-shrink:0;';
      chk.addEventListener('change',()=>{if(chk.checked)selected.add(ins.campaign_id);else selected.delete(ins.campaign_id);updateGrpChk();});
      rowChks.push(chk);
      const info=document.createElement('div');info.style.cssText='flex:1;min-width:0;';
      info.innerHTML=`<div style="font-family:var(--fonte-principal);font-size:max(9px, calc(12px * var(--escala-texto, 1)));font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${(ins.campaign_name||'').replace(/"/g,'&quot;')}">${ins.campaign_name||'—'}</div><div style="display:flex;gap:8px;margin-top:3px;flex-wrap:wrap;align-items:center;"><span style="font-size:max(9px, calc(10px * var(--escala-texto, 1)));color:${statusColor};font-family:var(--fonte-principal);font-weight:600;">● ${status==='ACTIVE'?'Ativa':status==='PAUSED'?'Pausada':status}</span><span style="font-size:max(9px, calc(10px * var(--escala-texto, 1)));color:var(--muted);font-family:var(--fonte-principal);">${_maFmtR(ins.spend)}</span><span style="font-size:max(9px, calc(10px * var(--escala-texto, 1)));color:var(--muted);font-family:var(--fonte-principal);">CTR ${ctr.toFixed(2)}%</span><span style="font-size:max(9px, calc(10px * var(--escala-texto, 1)));color:var(--muted);font-family:var(--fonte-principal);">${db}</span></div>`;
      row.appendChild(chk);row.appendChild(info);gbody.appendChild(row);
    });
    grp.appendChild(ghdr);grp.appendChild(gbody);body.appendChild(grp);
  });
  drawer.appendChild(body);

  // Footer
  const ftr=document.createElement('div');ftr.style.cssText='padding:16px;border-top:1px solid var(--border);display:flex;gap:8px;flex-shrink:0;';
  const verBtn=document.createElement('button');
  verBtn.style.cssText='flex:1;padding:10px;border:1px solid var(--border);border-radius:8px;font-family:var(--fonte-principal);font-size:max(9px, calc(11px * var(--escala-texto, 1)));font-weight:700;color:var(--muted);background:none;cursor:pointer;';
  verBtn.textContent='Ver Tudo';
  verBtn.addEventListener('click',()=>{onApply(insights,null);drawer.remove();document.getElementById('ma-filter-bd')?.remove();});
  const applyBtn=document.createElement('button');
  applyBtn.style.cssText='flex:2;padding:10px;border:none;border-radius:8px;font-family:var(--fonte-principal);font-size:max(9px, calc(11px * var(--escala-texto, 1)));font-weight:700;color:var(--sobre-cor);background:var(--accent);cursor:pointer;';
  applyBtn.textContent='Aplicar Filtro';
  applyBtn.addEventListener('click',()=>{
    const filtered=insights.filter(i=>selected.has(i.campaign_id));
    const objCount={};filtered.forEach(i=>{const o=i.objective||'OTHER';objCount[o]=(objCount[o]||0)+1;});
    const domObj=Object.entries(objCount).sort((a,b)=>b[1]-a[1])[0]?.[0]||null;
    onApply(filtered,domObj);
    drawer.remove();document.getElementById('ma-filter-bd')?.remove();
  });
  ftr.appendChild(verBtn);ftr.appendChild(applyBtn);drawer.appendChild(ftr);

  const bd=document.createElement('div');bd.id='ma-filter-bd';bd.className='ma-filter-bd';
  bd.addEventListener('click',()=>{drawer.remove();bd.remove();});
  document.body.appendChild(bd);
  document.body.appendChild(drawer);
}

const MA_KPI_HELP={
 'CTR':'<b>CTR — taxa de cliques</b> = cliques ÷ impressões. Mede o quanto o criativo e a segmentação atraem. Referência: <b>≥ 2%</b> ótimo · 0,8–2% ok · <b>&lt; 0,8%</b> fraco.',
 'CPC':'<b>CPC — custo por clique</b> = gasto ÷ cliques. Quanto você paga por cada clique. Quanto menor, mais eficiente o tráfego.',
 'CPM':'<b>CPM — custo por mil impressões</b> = gasto ÷ impressões × 1000. Quanto custa aparecer mil vezes. Sobe quando o leilão/público está caro ou saturado.',
 'Custo por Lead':'<b>CPL — custo por lead</b> = gasto ÷ leads (conversões). Quanto custa cada resultado. Compare com a <b>média da conta</b> e com a margem do produto.',
 'Gasto Total':'Total investido nas campanhas do <b>período selecionado</b>.',
 'Impressões':'Quantas vezes os anúncios foram exibidos. Uma mesma pessoa pode contar várias vezes (≠ alcance, que é gente única).',
 'Cliques':'Total de cliques nos anúncios no período.',
 'Saldo Atual':'Saldo disponível na conta de anúncios na Meta (independe do período).',
};
function _maKpiHelp(l){const h=MA_KPI_HELP[l];if(h&&typeof _gtConfirm==='function')_gtConfirm(l,h,{okOnly:true});}
function _maKpiQ(l){return MA_KPI_HELP[l]?`<button class="ma-kpi-q" onclick="_maKpiHelp('${String(l).replace(/'/g,"\\'")}')" title="O que é ${l}">?</button>`:'';}
function _maTableHelp(){
  if(typeof _gtConfirm!=='function')return;
  const h=`<div style="text-align:left;font-size:max(9px, calc(12px * var(--escala-texto, 1)));line-height:1.65;">
  <p style="margin:0 0 9px"><b>● bolinha</b> = qualidade do CTR da campanha: <span style="color:var(--green)">verde</span> (CTR ≥ 2%, ótimo) · <span style="color:var(--orange)">amarelo</span> (0,8–2%, ok) · <span style="color:var(--red)">vermelho</span> (&lt; 0,8%, fraco).</p>
  <p style="margin:0 0 9px"><b>Selo de status</b> = Ativa / Pausada / Arquivada na Meta.</p>
  <p style="margin:0 0 9px"><b>Setinha ▲▼</b> ao lado de Gasto e CTR = variação vs. o <b>período anterior</b> de mesma duração (verde = subiu, vermelho = caiu).</p>
  <p style="margin:0 0 9px"><b>Colunas:</b> Gasto · CTR (cliques÷impressões) · CPC (custo/clique) · Impr. (impressões) · Cliques · Leads (quando o objetivo é conversão).</p>
  <p style="margin:0;color:var(--muted)"><b>Clique no cabeçalho</b> de qualquer coluna de número para <b>ordenar</b> (clique de novo para inverter).</p>
  </div>`;
  _gtConfirm('Como ler a tabela',h,{okOnly:true});
}
function _maFunnelHelp(){
  if(typeof _gtConfirm!=='function')return;
  const h=`<div style="text-align:left;font-size:max(9px, calc(12px * var(--escala-texto, 1)));line-height:1.65;">
  <p style="margin:0 0 9px">O funil mostra a <b>jornada do anúncio até o resultado</b>, etapa por etapa, de cima (mais gente) para baixo (menos gente).</p>
  <p style="margin:0 0 9px"><b>Cada barra</b> é uma etapa; o <b>número</b> é o volume daquela etapa (ex.: impressões → cliques → resultados). A largura é proporcional ao volume.</p>
  <p style="margin:0 0 9px">O <b>"↓ X% chegam aqui"</b> entre as barras é a <b>taxa de passagem</b>: de cada 100 da etapa de cima, quantos avançaram para a de baixo.</p>
  <p style="margin:0 0 9px">À direita de cada etapa, o <b>custo</b> daquele resultado (ex.: custo por clique, custo por lead).</p>
  <p style="margin:0;color:var(--muted)">Quando há mais de um objetivo ativo, use os botões <b>"Objetivo da campanha"</b> para ver o funil de cada um.</p>
  </div>`;
  _gtConfirm('Como ler o funil',h,{okOnly:true});
}
function _renderMaCampanha(el,{insights,campaigns,prevInsights,daily,prevDaily,adInsights,acctReach}){
  el.innerHTML='';
  let _activeInsights=insights;
  let _activeObj=null;
  prevDaily=prevDaily||[];
  adInsights=adInsights||[];

  const sum=(arr,field)=>arr.reduce((s,x)=>s+parseFloat(x[field]||0),0);
  const ps=sum(prevInsights,'spend');
  const pi=sum(prevInsights,'impressions');
  const pc=sum(prevInsights,'clicks');
  const pctr=pi>0?pc/pi*100:0;
  const pcpc=pc>0?ps/pc:0;
  const pcpm=pi>0?ps/pi*1000:0;
  // Per-campaign prev lookup
  const prevCampMap={};prevInsights.forEach(i=>prevCampMap[i.campaign_id]=i);

  // Single column layout
  const col=document.createElement('div');col.style.cssText='display:flex;flex-direction:column;gap:16px;';
  el.appendChild(col);

  // Funnel card — always present, auto-selects if single objective
  function _buildFunnelCard(insArr, activeObj){
    const sec=document.createElement('div');sec.className='ma-section';sec.style.padding='18px 20px';

    // Derive unique objectives with spend > 0, sorted desc by spend
    const objSpend={};
    insArr.forEach(i=>{const o=i.objective;if(o){objSpend[o]=(objSpend[o]||0)+parseFloat(i.spend||0);}});
    const uniqueObjs=Object.entries(objSpend).filter(([,s])=>s>0).sort((a,b)=>b[1]-a[1]).map(([o])=>o);

    // Resolve which objective to show
    const resolvedObj=activeObj||(uniqueObjs.length===1?uniqueObjs[0]:null);

    // Header row
    const hdr=document.createElement('div');
    hdr.style.cssText='display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;gap:12px;';
    const ttlW=document.createElement('div');ttlW.style.cssText='display:flex;align-items:center;gap:7px;';
    const ttl=document.createElement('div');ttl.className='ma-section-title';ttl.style.marginBottom='0';ttl.textContent='Funil de Conversão';
    const fq=document.createElement('button');fq.className='ma-kpi-q';fq.textContent='?';fq.title='Como ler o funil';fq.onclick=()=>_maFunnelHelp();
    ttlW.appendChild(ttl);ttlW.appendChild(fq);
    hdr.appendChild(ttlW);
    if(uniqueObjs.length===1){
      const autoLbl=document.createElement('div');
      autoLbl.style.cssText='font-family:var(--fonte-principal);font-size:max(9px, calc(10px * var(--escala-texto, 1)));color:var(--muted);';
      autoLbl.textContent=(MA_FUNNEL_DEF[uniqueObjs[0]]?.label||uniqueObjs[0])+' · único objetivo ativo';
      hdr.appendChild(autoLbl);
    }
    sec.appendChild(hdr);

    // Objective selector — always visible when multiple objectives exist
    if(uniqueObjs.length>1){
      const selectorBar=document.createElement('div');
      selectorBar.style.cssText='display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:16px;padding:10px 14px;border-radius:8px;background:var(--surface2);border:1px solid var(--border);';
      const lbl=document.createElement('span');
      lbl.style.cssText='font-family:var(--fonte-principal);font-size:max(9px, calc(10px * var(--escala-texto, 1)));font-weight:600;letter-spacing:.6px;color:var(--muted);text-transform:uppercase;margin-right:6px;white-space:nowrap;flex-shrink:0;';
      lbl.textContent='Objetivo da campanha:';
      selectorBar.appendChild(lbl);
      uniqueObjs.forEach(o=>{
        const btn=document.createElement('button');
        const isActive=o===resolvedObj;
        btn.style.cssText=`padding:7px 18px;border-radius:20px;font-family:var(--fonte-principal);font-size:max(9px, calc(12px * var(--escala-texto, 1)));font-weight:600;letter-spacing:.3px;cursor:pointer;transition:all .15s;border:1px solid ${isActive?'var(--accent)':'var(--border)'};background:${isActive?'var(--accent)':'none'};color:${isActive?'#fff':'var(--text)'};white-space:nowrap;`;
        btn.textContent=MA_FUNNEL_DEF[o]?.label||o;
        btn.addEventListener('mouseenter',()=>{if(o!==resolvedObj){btn.style.background='var(--accent)';btn.style.borderColor='var(--accent)';btn.style.color='var(--sobre-cor)';}});
        btn.addEventListener('mouseleave',()=>{if(o!==resolvedObj){btn.style.background='none';btn.style.borderColor='var(--border)';btn.style.color='var(--text)';}});
        btn.addEventListener('click',()=>_drawContent(insArr,o));
        selectorBar.appendChild(btn);
      });
      sec.appendChild(selectorBar);
    }

    const body=document.createElement('div');
    sec.appendChild(body);
    if(resolvedObj){
      _renderFunnel(body,insArr,resolvedObj);
    }else{
      // Prompt — no objective selected yet
      const prompt=document.createElement('div');
      prompt.style.cssText='display:flex;flex-direction:column;align-items:center;gap:10px;padding:20px 0;';
      const icon=document.createElement('div');
      icon.innerHTML=`<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:.4"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`;
      const msg=document.createElement('div');
      msg.style.cssText='font-family:var(--fonte-principal);font-size:max(9px, calc(12px * var(--escala-texto, 1)));color:var(--muted);text-align:center;';
      msg.textContent='Selecione um objetivo acima para visualizar o funil';
      prompt.appendChild(icon);prompt.appendChild(msg);
      body.appendChild(prompt);
    }
    return sec;
  }

  function _applyFilter(filtered,obj){
    _activeInsights=filtered;_activeObj=obj;
    _drawContent(filtered,obj);
  }

  function _drawContent(insArr,obj){
    col.innerHTML='';
    Object.values(_maCharts).forEach(c=>{try{c.destroy();}catch(e){}});_maCharts={};

    const s_=sum(insArr,'spend');
    const imp_=sum(insArr,'impressions');
    const clk_=sum(insArr,'clicks');
    // Reach deduplicado do período (nível conta). Fallback p/ soma só se a consulta falhar.
    const rch_=(acctReach&&acctReach.reach!=null)?parseInt(acctReach.reach):sum(insArr,'reach');
    const ctr_=imp_>0?clk_/imp_*100:0;
    const cpc_=clk_>0?s_/clk_:0;
    const cpm_=imp_>0?s_/imp_*1000:0;
    const freq_=rch_>0?imp_/rch_:0;
    const leads_=insArr.reduce((s,x)=>s+_getActions(x,'lead'),0);
    const cpl_=leads_>0?s_/leads_:0;

    // ── Top bar: period info + filter button
    const topBar=document.createElement('div');
    topBar.style.cssText='display:flex;align-items:center;justify-content:space-between;gap:12px;';
    const topInfo=document.createElement('div');
    topInfo.style.cssText='font-family:var(--fonte-principal);font-size:max(9px, calc(11px * var(--escala-texto, 1)));color:var(--muted);';
    const activeCount=insArr.length;
    const totalCount=insights.length;
    topInfo.textContent=activeCount===totalCount?`${totalCount} campanhas`:`${activeCount} de ${totalCount} campanhas`+(obj?` · ${MA_FUNNEL_DEF[obj]?.label||obj}`:'');
    const filterBtn=document.createElement('button');
    filterBtn.className='ma-filter-btn';
    filterBtn.innerHTML=`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="4" y1="6" x2="20" y2="6"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="11" y1="18" x2="13" y2="18"/></svg>Filtrar Campanhas`;
    filterBtn.addEventListener('click',()=>_openCampanhaFilter(insights,campaigns,_applyFilter));
    topBar.appendChild(topInfo);topBar.appendChild(filterBtn);
    col.appendChild(topBar);

    // ── KPI grid 1
    const kpi1=document.createElement('div');kpi1.className='ma-kpi-row';
    [{l:'Gasto Total',v:_maFmtR(s_),d:_maDelta(s_,ps),sub:ps>0?`Ant.: ${_maFmtR(ps)}`:''},
     {l:'Impressões',v:_maFmt(imp_),d:_maDelta(imp_,pi),sub:`Alcance: ${_maFmt(rch_)}`},
     {l:'Cliques',v:_maFmt(clk_),d:_maDelta(clk_,pc),sub:leads_>0?`Leads: ${_maFmt(leads_)}`:`Freq.: ${_maFmt(freq_,2)}×`},
     {l:'Saldo Atual',v:_maCurAcc?.balance!=null?_maFmtR(_maCurAcc.balance):'—',d:{pct:null,cls:'',sym:''},sub:'disponível na conta'},
    ].forEach(({l,v,d,sub})=>{
      const k=document.createElement('div');k.className='ma-kpi';
      k.innerHTML=`<div class="ma-kpi-label">${l}${_maKpiQ(l)}</div><div class="ma-kpi-val">${v}</div>${d.pct!==null?`<div class="ma-kpi-delta ${d.cls}">${d.sym}</div>`:''}<div class="ma-kpi-sub">${sub}</div>`;
      kpi1.appendChild(k);
    });
    col.appendChild(kpi1);

    // ── KPI grid 2
    const kpi2=document.createElement('div');kpi2.className='ma-kpi-row';
    [{l:'CTR',v:_maFmtPct(ctr_),d:_maDelta(ctr_,pctr),sub:'cliques / impressões',good:ctr_>=2,bad:ctr_<0.8},
     {l:'CPC',v:_maFmtR(cpc_),d:_maDelta(cpc_,pcpc),sub:'custo por clique'},
     {l:'CPM',v:_maFmtR(cpm_),d:_maDelta(cpm_,pcpm),sub:'custo por mil impr.'},
     leads_>0?{l:'Custo por Lead',v:_maFmtR(cpl_),d:{pct:null,cls:'',sym:''},sub:`${_maFmt(leads_)} leads`}
             :{l:'Campanhas',v:String(insArr.length),d:{pct:null,cls:'',sym:''},sub:campaigns.filter(c=>c.effective_status==='ACTIVE').length+' ativas'},
    ].forEach(({l,v,d,sub,good,bad})=>{
      const k=document.createElement('div');k.className='ma-kpi';
      if(good)k.style.borderColor='rgba(22,163,74,.3)';
      if(bad)k.style.borderColor='rgba(220,38,38,.2)';
      k.innerHTML=`<div class="ma-kpi-label">${l}${_maKpiQ(l)}</div><div class="ma-kpi-val" style="${good?'color:var(--green)':bad?'color:var(--red)':''}">${v}</div>${d.pct!==null?`<div class="ma-kpi-delta ${d.cls}">${d.sym}</div>`:''}<div class="ma-kpi-sub">${sub}</div>`;
      kpi2.appendChild(k);
    });
    col.appendChild(kpi2);

    // ── Funnel card — always visible, auto-selects single objective
    col.appendChild(_buildFunnelCard(insArr,obj));

    // ── Tabbed card: Campanhas | Anúncios
    col.appendChild(_buildMaTabCard(insArr,campaigns,prevCampMap,adInsights));
  } // end _drawContent

  _drawContent(insights,null);
}

function _buildMaTable(insights,campaigns){
  const campMap={};campaigns.forEach(c=>campMap[c.id]=c);
  const sorted=[...insights].sort((a,b)=>parseFloat(b.spend||0)-parseFloat(a.spend||0));

  const wrap=document.createElement('div');wrap.style.cssText='overflow-x:auto;';
  const tbl=document.createElement('table');tbl.className='ma-table';
  tbl.innerHTML=`<thead><tr>
    <th style="width:30px"></th>
    <th>Campanha</th>
    <th>Objetivo</th>
    <th>Status</th>
    <th style="text-align:right">Gasto</th>
    <th style="text-align:right">Impr.</th>
    <th style="text-align:right">Cliques</th>
    <th style="text-align:right">CTR</th>
    <th style="text-align:right">CPC</th>
    <th style="text-align:right">CPM</th>
    <th style="text-align:right">Freq.</th>
  </tr></thead>`;
  const tbody=document.createElement('tbody');
  sorted.forEach(ins=>{
    const camp=campMap[ins.campaign_id];
    const status=camp?.effective_status||camp?.status||'—';
    const ctr=parseFloat(ins.ctr||0);
    const scoreKey=_maScore(ctr);
    const tr=document.createElement('tr');
    tr.innerHTML=`
      <td><span class="ma-score ma-score-${scoreKey}"></span></td>
      <td><div class="ma-camp-name" title="${ins.campaign_name||''}">${ins.campaign_name||'—'}</div></td>
      <td><span class="ma-obj-chip">${_maObjLabel(ins.objective)}</span></td>
      <td><span class="ma-badge ma-badge-${(status).toLowerCase()}">${status==='ACTIVE'?'Ativa':status==='PAUSED'?'Pausada':status==='ARCHIVED'?'Arquiv.':status}</span></td>
      <td style="text-align:right;font-weight:600">${_maFmtR(ins.spend)}</td>
      <td style="text-align:right">${_maFmt(ins.impressions)}</td>
      <td style="text-align:right">${_maFmt(ins.clicks)}</td>
      <td style="text-align:right;font-weight:600;color:${ctr>=2?'var(--green)':ctr<0.8?'var(--red)':'var(--text)'}">${_maFmtPct(ctr)}</td>
      <td style="text-align:right">${_maFmtR(ins.cpc)}</td>
      <td style="text-align:right">${_maFmtR(ins.cpm)}</td>
      <td style="text-align:right">${_maFmt(parseFloat(ins.frequency||0),2)}</td>
    `;
    tbody.appendChild(tr);
  });
  tbl.appendChild(tbody);wrap.appendChild(tbl);
  return wrap;
}

function _buildMaTabCard(insArr,campaigns,prevCampMap,adInsights){
  const wrap=document.createElement('div');wrap.className='ma-section';wrap.style.padding='0';wrap.style.overflow='hidden';

  // Tab bar
  const tabBar=document.createElement('div');
  tabBar.style.cssText='display:flex;align-items:center;gap:0;border-bottom:1px solid var(--border);background:var(--surface2);';

  const tabs=[
    {id:'campanhas',label:'Campanhas',badge:insArr.length},
    {id:'anuncios',label:'Anúncios',badge:(adInsights||[]).length},
  ];

  const panes={};
  let activeTab='campanhas';

  function switchTab(id){
    activeTab=id;
    tabBtns.forEach((btn,i)=>{
      const isActive=tabs[i].id===id;
      btn.style.borderBottom=isActive?'2px solid var(--accent)':'2px solid transparent';
      btn.style.color=isActive?'var(--accent)':'var(--muted)';
      btn.style.fontWeight=isActive?'700':'500';
    });
    Object.entries(panes).forEach(([k,p])=>{p.style.display=k===id?'':'none';});
  }

  const tabBtns=tabs.map(t=>{
    const btn=document.createElement('button');
    btn.style.cssText='display:flex;align-items:center;gap:6px;padding:9px 16px;background:none;border:none;border-bottom:2px solid transparent;font-family:var(--fonte-principal);font-size:max(9px, calc(11px * var(--escala-texto, 1)));cursor:pointer;transition:all .15s;color:var(--muted);font-weight:500;white-space:nowrap;';
    const badgeEl=document.createElement('span');
    badgeEl.style.cssText='display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:var(--border);color:var(--text);font-size:max(9px, calc(9px * var(--escala-texto, 1)));font-weight:700;';
    badgeEl.textContent=t.badge;
    btn.textContent=t.label;
    btn.appendChild(badgeEl);
    btn.addEventListener('click',()=>switchTab(t.id));
    tabBar.appendChild(btn);
    return btn;
  });
  wrap.appendChild(tabBar);

  // Build pane content — remove duplicate section titles since tabs already label each pane
  const campPane=document.createElement('div');campPane.style.cssText='padding:14px 28px 24px;';
  const campSec=_buildMaCampaignSection(insArr,campaigns,prevCampMap);
  campSec.style.padding='0';campSec.style.background='none';campSec.style.borderRadius='0';
  const campTitle=campSec.querySelector('.ma-section-title');if(campTitle)campTitle.remove();
  campPane.appendChild(campSec);
  panes['campanhas']=campPane;
  wrap.appendChild(campPane);

  const adPane=document.createElement('div');adPane.style.cssText='padding:14px 28px 24px;display:none;';
  const adSec=_buildMaAdSection(adInsights||[],insArr);
  adSec.style.padding='0';adSec.style.background='none';adSec.style.borderRadius='0';
  const adTitle=adSec.querySelector('.ma-section-title');if(adTitle)adTitle.remove();
  adPane.appendChild(adSec);
  panes['anuncios']=adPane;
  wrap.appendChild(adPane);

  switchTab('campanhas');
  return wrap;
}

function _buildMaCampaignSection(insights,campaigns,prevCampMap){
  const campMap={};campaigns.forEach(c=>campMap[c.id]=c);
  prevCampMap=prevCampMap||{};
  const allSorted=[...insights].sort((a,b)=>parseFloat(b.spend||0)-parseFloat(a.spend||0));

  // Wrapper section
  const sec=document.createElement('div');sec.className='ma-section';sec.style.padding='18px 20px';

  // Header: title + count
  const hdr=document.createElement('div');hdr.style.cssText='display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;gap:12px;flex-wrap:wrap;';
  const ttlWrap=document.createElement('div');ttlWrap.style.cssText='display:flex;align-items:center;gap:7px;';
  const ttl=document.createElement('div');ttl.className='ma-section-title';ttl.style.marginBottom='0';ttl.textContent='Campanhas';
  const qb=document.createElement('button');qb.className='ma-kpi-q';qb.textContent='?';qb.title='Como ler a tabela';qb.onclick=()=>_maTableHelp();
  ttlWrap.appendChild(ttl);ttlWrap.appendChild(qb);
  const cntLbl=document.createElement('div');cntLbl.style.cssText='font-family:var(--fonte-principal);font-size:max(9px, calc(11px * var(--escala-texto, 1)));color:var(--muted);';
  cntLbl.textContent=allSorted.length+' campanhas';
  hdr.appendChild(ttlWrap);hdr.appendChild(cntLbl);sec.appendChild(hdr);

  // Sub-filter bar
  const filterBar=document.createElement('div');
  filterBar.style.cssText='display:flex;align-items:center;gap:8px;margin-bottom:14px;flex-wrap:wrap;';

  const searchWrap=document.createElement('div');
  searchWrap.style.cssText='flex:1;min-width:160px;position:relative;';
  const searchIcon=`<svg style="position:absolute;left:9px;top:50%;transform:translateY(-50%);pointer-events:none;color:var(--muted)" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`;
  searchWrap.innerHTML=searchIcon;
  const searchInp=document.createElement('input');
  searchInp.type='text';searchInp.placeholder='Buscar campanha…';
  searchInp.style.cssText='width:100%;padding:7px 10px 7px 30px;border:1px solid var(--border);border-radius:7px;background:var(--surface2);color:var(--text);font-family:var(--fonte-principal);font-size:max(9px, calc(11px * var(--escala-texto, 1)));outline:none;transition:border-color .15s;';
  searchInp.addEventListener('focus',()=>searchInp.style.borderColor='var(--accent)');
  searchInp.addEventListener('blur',()=>searchInp.style.borderColor='var(--border)');
  searchWrap.appendChild(searchInp);filterBar.appendChild(searchWrap);

  // Status chips
  const statuses=[['todos','Todos'],['active','Ativas'],['paused','Pausadas']];
  let activeStatus='todos';
  const chips=statuses.map(([val,lbl])=>{
    const chip=document.createElement('button');
    chip.style.cssText='padding:5px 11px;border-radius:20px;font-family:var(--fonte-principal);font-size:max(9px, calc(10px * var(--escala-texto, 1)));font-weight:600;letter-spacing:.4px;cursor:pointer;transition:all .15s;border:1px solid var(--border);background:none;color:var(--muted);white-space:nowrap;';
    chip.textContent=lbl;
    if(val==='todos'){chip.style.background='var(--accent)';chip.style.color='var(--sobre-cor)';chip.style.borderColor='var(--accent)';}
    chip.addEventListener('click',()=>{
      activeStatus=val;
      chips.forEach((c,i)=>{c.style.background=statuses[i][0]===val?'var(--accent)':'none';c.style.color=statuses[i][0]===val?'#fff':'var(--muted)';c.style.borderColor=statuses[i][0]===val?'var(--accent)':'var(--border)';});
      render();
    });
    filterBar.appendChild(chip);
    return chip;
  });
  sec.appendChild(filterBar);

  // List container
  const listDiv=document.createElement('div');listDiv.style.cssText='display:flex;flex-direction:column;gap:0;';
  sec.appendChild(listDiv);

  const hasLeads=allSorted.some(i=>_getActions(i,'lead')>0);
  let sortKey='spend',sortDir=-1;
  const _v=(ins,k)=>k==='ctr'?parseFloat(ins.ctr||0):k==='cpc'?parseFloat(ins.cpc||0):k==='impressions'?parseInt(ins.impressions||0):k==='clicks'?parseInt(ins.clicks||0):k==='leads'?_getActions(ins,'lead'):parseFloat(ins.spend||0);
  function render(){
    const q=(searchInp.value||'').toLowerCase().trim();
    const filtered=allSorted.filter(ins=>{
      const statusMatch=activeStatus==='todos'||(activeStatus==='active'&&(campMap[ins.campaign_id]?.effective_status||'')==='ACTIVE')||(activeStatus==='paused'&&(campMap[ins.campaign_id]?.effective_status||'')==='PAUSED');
      const nameMatch=!q||(ins.campaign_name||'').toLowerCase().includes(q);
      return statusMatch&&nameMatch;
    });
    cntLbl.textContent=(filtered.length===allSorted.length?allSorted.length:(filtered.length+' de '+allSorted.length))+' campanhas';
    if(!filtered.length){listDiv.innerHTML='<div style="text-align:center;padding:28px;font-family:var(--fonte-principal);font-size:max(9px, calc(12px * var(--escala-texto, 1)));color:var(--muted);">Nenhuma campanha encontrada</div>';return;}
    const rows=filtered.slice().sort((a,b)=>(_v(a,sortKey)-_v(b,sortKey))*sortDir);
    const arrow=k=>sortKey===k?(sortDir<0?' ▾':' ▴'):'';
    const numCols=[['spend','Gasto'],['ctr','CTR'],['cpc','CPC'],['impressions','Impr.'],['clicks','Cliques']];
    if(hasLeads)numCols.push(['leads','Leads']);
    const thead='<thead><tr><th style="width:18px"></th><th>Campanha</th><th>Objetivo</th>'+numCols.map(([k,l])=>`<th class="num sortable" data-k="${k}">${l}${arrow(k)}</th>`).join('')+'</tr></thead>';
    const body=rows.map(ins=>{
      const camp=campMap[ins.campaign_id];const status=camp?.effective_status||'—';
      const ctr=parseFloat(ins.ctr||0),spend=parseFloat(ins.spend||0),impressions=parseInt(ins.impressions||0),clicks=parseInt(ins.clicks||0),cpc=parseFloat(ins.cpc||0),leads=_getActions(ins,'lead');
      const ctrColor=ctr>=2?'var(--green)':ctr<0.8?'var(--red)':'var(--orange)';
      const scoreCls=ctr>=2?'good':ctr>=0.8?'mid':'bad';
      const badgeCls=status==='ACTIVE'?'active':status==='PAUSED'?'paused':'archived';
      const statusLabel=status==='ACTIVE'?'Ativa':status==='PAUSED'?'Pausada':status==='ARCHIVED'?'Arq.':status;
      const prev=prevCampMap[ins.campaign_id];const prevImp=parseFloat(prev?.impressions||0);
      const dSpend=_maDelta(spend,parseFloat(prev?.spend||0));
      const dCtr=_maDelta(ctr,prevImp>0?parseFloat(prev?.clicks||0)/prevImp*100:0);
      const budget=camp?.daily_budget?'R$'+(parseFloat(camp.daily_budget)/100).toFixed(0)+'/dia':camp?.lifetime_budget?'R$'+(parseFloat(camp.lifetime_budget)/100).toFixed(0)+' total':'';
      const nm=escHtml(ins.campaign_name||'—');
      return `<tr>
        <td><span class="ma-score ma-score-${scoreCls}"></span></td>
        <td><div class="ma-camp-name" title="${nm}">${nm}</div><div style="margin-top:3px;display:flex;align-items:center;gap:6px;"><span class="ma-badge ma-badge-${badgeCls}">${statusLabel}</span>${budget?`<span style="font-size:max(9px, calc(9px * var(--escala-texto, 1)));color:var(--muted)">${budget}</span>`:''}</div></td>
        <td><span class="ma-obj-chip">${_maObjLabel(ins.objective)}</span></td>
        <td class="num"><b>${_maFmtR(spend)}</b>${dSpend.pct!==null?` <span class="${dSpend.cls}" style="font-size:max(9px, calc(9px * var(--escala-texto, 1)))">${dSpend.sym}</span>`:''}</td>
        <td class="num" style="color:${ctrColor};font-weight:700">${_maFmtPct(ctr)}${dCtr.pct!==null?` <span class="${dCtr.cls}" style="font-size:max(9px, calc(9px * var(--escala-texto, 1)))">${dCtr.sym}</span>`:''}</td>
        <td class="num">${_maFmtR(cpc)}</td>
        <td class="num">${_maFmt(impressions)}</td>
        <td class="num">${_maFmt(clicks)}</td>
        ${hasLeads?`<td class="num">${leads>0?_maFmt(leads):'—'}</td>`:''}
      </tr>`;
    }).join('');
    listDiv.innerHTML='<div style="overflow-x:auto;"><table class="ma-table">'+thead+'<tbody>'+body+'</tbody></table></div>';
    listDiv.querySelectorAll('th[data-k]').forEach(th=>th.onclick=()=>{const k=th.dataset.k;if(sortKey===k)sortDir*=-1;else{sortKey=k;sortDir=-1;}render();});
  }

  searchInp.addEventListener('input',render);
  render();
  return sec;
}

function _buildMaAdSection(adInsights,campInsights){
  // Group ads by campaign
  const byCamp={};
  adInsights.forEach(ad=>{
    const cid=ad.campaign_id||'other';
    if(!byCamp[cid])byCamp[cid]={name:ad.campaign_name||'—',ads:[]};
    byCamp[cid].ads.push(ad);
  });
  // Sort groups by total spend desc
  const groups=Object.values(byCamp).sort((a,b)=>{
    const sa=a.ads.reduce((s,x)=>s+parseFloat(x.spend||0),0);
    const sb=b.ads.reduce((s,x)=>s+parseFloat(x.spend||0),0);
    return sb-sa;
  });

  const sec=document.createElement('div');sec.className='ma-section';sec.style.padding='18px 20px';
  const hdr=document.createElement('div');hdr.style.cssText='display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;';
  const ttl=document.createElement('div');ttl.className='ma-section-title';ttl.style.marginBottom='0';ttl.textContent='Anúncios';
  const cnt=document.createElement('div');cnt.style.cssText='font-family:var(--fonte-principal);font-size:max(9px, calc(11px * var(--escala-texto, 1)));color:var(--muted);';cnt.textContent=adInsights.length+' anúncios';
  hdr.appendChild(ttl);hdr.appendChild(cnt);sec.appendChild(hdr);

  groups.forEach(grp=>{
    const grpDiv=document.createElement('div');grpDiv.style.cssText='margin-bottom:8px;border:1px solid var(--border);border-radius:8px;overflow:hidden;';
    const grpSpend=grp.ads.reduce((s,x)=>s+parseFloat(x.spend||0),0);
    const adsSorted=[...grp.ads].sort((a,b)=>parseFloat(b.spend||0)-parseFloat(a.spend||0));

    // Group header (collapsible)
    const grpHdr=document.createElement('div');
    grpHdr.style.cssText='display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--surface2);cursor:pointer;user-select:none;';
    const grpTitleWrap=document.createElement('div');grpTitleWrap.style.cssText='display:flex;align-items:center;gap:8px;min-width:0;flex:1;';
    const grpArrow=document.createElement('span');grpArrow.style.cssText='font-size:max(9px, calc(10px * var(--escala-texto, 1)));color:var(--muted);transition:transform .2s;display:inline-block;';grpArrow.textContent='▼';
    const grpName=document.createElement('div');grpName.style.cssText='font-family:var(--fonte-principal);font-size:max(9px, calc(11px * var(--escala-texto, 1)));font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';grpName.textContent=grp.name;
    const grpCnt=document.createElement('span');grpCnt.style.cssText='font-family:var(--fonte-principal);font-size:max(9px, calc(9px * var(--escala-texto, 1)));color:var(--muted);flex-shrink:0;';grpCnt.textContent=grp.ads.length+' anúncios';
    grpTitleWrap.appendChild(grpArrow);grpTitleWrap.appendChild(grpName);grpTitleWrap.appendChild(grpCnt);
    const grpSpendLbl=document.createElement('div');grpSpendLbl.style.cssText='font-family:var(--fonte-dados);font-size:max(9px, calc(14px * var(--escala-texto, 1)));font-weight:700;color:var(--text);flex-shrink:0;margin-left:12px;';grpSpendLbl.textContent=_maFmtR(grpSpend);
    grpHdr.appendChild(grpTitleWrap);grpHdr.appendChild(grpSpendLbl);

    const grpBody=document.createElement('div');grpBody.style.cssText='display:flex;flex-direction:column;';
    let open=true;
    grpHdr.addEventListener('click',()=>{
      open=!open;grpBody.style.display=open?'':'none';grpArrow.style.transform=open?'':'rotate(-90deg)';
    });

    const adRows=adsSorted.map(ad=>{
      const ctr=parseFloat(ad.ctr||0),spend=parseFloat(ad.spend||0),impressions=parseInt(ad.impressions||0),clicks=parseInt(ad.clicks||0),cpc=parseFloat(ad.cpc||0),cpm=parseFloat(ad.cpm||0);
      const ctrColor=ctr>=2?'var(--green)':ctr<0.8?'var(--red)':'var(--orange)';
      const scoreCls=ctr>=2?'good':ctr>=0.8?'mid':'bad';
      const nm=escHtml(ad.ad_name||'—'),adset=escHtml(ad.adset_name||'');
      return `<tr>
        <td><span class="ma-score ma-score-${scoreCls}"></span></td>
        <td><div class="ma-camp-name" title="${nm}">${nm}</div>${adset?`<div style="font-size:max(9px, calc(9px * var(--escala-texto, 1)));color:var(--muted);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:240px">${adset}</div>`:''}</td>
        <td class="num"><b>${_maFmtR(spend)}</b></td>
        <td class="num" style="color:${ctrColor};font-weight:700">${_maFmtPct(ctr)}</td>
        <td class="num">${_maFmtR(cpc)}</td>
        <td class="num">${_maFmtR(cpm)}</td>
        <td class="num">${_maFmt(impressions)}</td>
        <td class="num">${_maFmt(clicks)}</td>
      </tr>`;
    }).join('');
    grpBody.innerHTML='<div style="overflow-x:auto;"><table class="ma-table"><thead><tr><th style="width:18px"></th><th>Anúncio</th><th class="num">Gasto</th><th class="num">CTR</th><th class="num">CPC</th><th class="num">CPM</th><th class="num">Impr.</th><th class="num">Cliques</th></tr></thead><tbody>'+adRows+'</tbody></table></div>';

    grpDiv.appendChild(grpHdr);grpDiv.appendChild(grpBody);
    sec.appendChild(grpDiv);
  });
  return sec;
}

// Equivalente ao closeMetaCampanha() do legado (que fazia display:none dos
// dois lados + voltava pro hub). Continua limpando os mesmos timers e o
// listener do dropdown; a troca de tela agora é feita pelo router.
function _maStopAllTimers(){
  if(window._maClockTimer){clearInterval(window._maClockTimer);window._maClockTimer=null;}
  if(_maStatusTimer){clearInterval(_maStatusTimer);_maStatusTimer=null;}
  _maLastLoadTime=null;
  document.removeEventListener('click',_maDocClick);
}
function closeMetaCampanha(){
  _maStopAllTimers();
  router.push({ name: 'meta-ads' });
}

// Guarda de acesso (equivalente ao if(!hasPermission('module:meta:campanha'))return;
// do openMetaCampanha original) + disparo do carregamento inicial (equivalente
// ao resto do openMetaCampanha original: spinner em #ma-content, startMaClock,
// _initMetaAds).
onMounted(() => {
  if (!hasPermission('module:meta:campanha')) {
    adminToast('Sem acesso', false)
    router.push({ name: 'meta-ads' })
    return
  }
  document.addEventListener('click', _maDocClick)
  const c = document.getElementById('ma-content')
  if (c) c.innerHTML = '<div class="gv-loading-screen"><div class="gv-spinner"></div><span class="gv-loading-lbl">Iniciando</span></div>'
  startMaClock()
  _initMetaAds()
})
onUnmounted(() => {
  _maStopAllTimers()
})

// Cluster de funções chamadas via onclick="..." literal no <template> acima
// e dentro do HTML gerado em runtime (_maKpiQ, dentro de _renderMaCampanha).
Object.assign(window, {
  setMaPeriod,
  toggleMaCustomRange,
  loadMaData,
  toggleMaAccPicker,
  _maKpiHelp,
})
</script>

<style scoped>
/* Porte das regras #meta-ads-campanha-screen, .ma- (Meta Ads), .gv- (Gestão à
   Vista) e .custom-range-btn (legacy/index.html — hoje ainda em
   src/estilos/estilos-globais.css, de onde
   foram REMOVIDAS ao portar esta tela, seguindo o mesmo padrão da Gestão à
   Vista: "gv-pbtn/gv-period-btns compartilhadas — telas ainda não migradas
   que também usam essas classes devem trazer sua própria cópia quando forem
   portadas"). #meta-ads-campanha-screen vira .tela-analise-campanhas (sem
   display:none — a visibilidade é do router). #ma-content é preenchido via
   innerHTML/createElement (JS imperativo acima), por isso os seletores que
   miram elementos ali dentro usam :deep(); os IDs do topbar/clock/dropdown
   de conta são literais do <template> (Vue já aplica o escopo neles), mas
   :deep() também funciona e é mantido por consistência com o resto do app. */
/* Fundo TRANSPARENTE: o #bg-shapes (degradê + ícones) fica fixo atrás de tudo
   pra aparecer, e o body já pinta a cor base nos DOIS temas. Pintar cor sólida
   aqui tapava a decoração e ainda deixava uma faixa visível onde a tela
   terminava. */
.tela-analise-campanhas{min-height:100vh;display:flex;flex-direction:column;background:transparent;position:relative;z-index:1;}

/* ── Topbar (compartilhado com Gestão à Vista — cada tela traz sua cópia) ── */
.tela-analise-campanhas :deep(.gv-topbar){display:flex;align-items:center;justify-content:space-between;padding:7px 28px;border-bottom:1px solid var(--border);background:var(--surface);position:sticky;top:0;z-index:10;}
.tela-analise-campanhas :deep(.gv-back){display:flex;align-items:center;gap:4px;font-family:var(--fonte-principal);font-size:max(9px, calc(10px * var(--escala-texto, 1)));font-weight:600;color:var(--accent);cursor:pointer;background:none;border:none;padding:0;transition:opacity .15s;letter-spacing:.3px;text-transform:uppercase;}
.tela-analise-campanhas :deep(.gv-back:hover){opacity:.75;}
.tela-analise-campanhas :deep(.gv-brand-tag){font-family:var(--fonte-principal);font-size:max(9px, calc(10px * var(--escala-texto, 1)));font-weight:600;letter-spacing:3px;text-transform:uppercase;color:var(--text);opacity:.6;line-height:1;}
.tela-analise-campanhas :deep(.gv-perf-tag){font-family:var(--fonte-principal);font-size:max(9px, calc(13.5px * var(--escala-texto, 1)));font-weight:700;letter-spacing:6px;text-transform:uppercase;color:var(--text);opacity:1;line-height:1.2;}
.tela-analise-campanhas :deep(.gv-clock-wrap){text-align:right;}
.tela-analise-campanhas :deep(.gv-clock-time){font-family:var(--fonte-dados);font-size:max(16px, calc(28px * var(--escala-texto, 1)));font-weight:400;letter-spacing:3px;color:var(--text);line-height:1;}
.tela-analise-campanhas :deep(.gv-clock-date){font-family:var(--fonte-principal);font-size:max(9px, calc(8px * var(--escala-texto, 1)));letter-spacing:2px;text-transform:uppercase;color:var(--muted);margin-top:3px;}
.tela-analise-campanhas :deep(.gv-update-status){font-family:var(--fonte-principal);font-size:max(9px, calc(8px * var(--escala-texto, 1)));letter-spacing:1.5px;text-transform:uppercase;color:var(--muted);opacity:.45;margin-top:4px;text-align:right;}
/* min-width:0 + overflow-x:auto desde SEMPRE, não só no celular: com o
   `.bt-dir` da barra encolhendo (20/08/2026), uma régua que não encolhe não
   fica menor — ela VAZA para fora da barra. A 768px eram três botões pendurados
   17px além da borda. A Gestão à Vista já tinha esse par; aqui faltava. */
.tela-analise-campanhas :deep(.gv-period-btns){display:flex;align-items:center;gap:4px;min-width:0;overflow-x:auto;scrollbar-width:none;}
.tela-analise-campanhas :deep(.gv-period-btns)::-webkit-scrollbar{display:none;}
.tela-analise-campanhas :deep(.gv-controles){min-width:0;}
.tela-analise-campanhas :deep(.gv-pbtn){font-family:var(--fonte-principal);font-size:max(9px, calc(10px * var(--escala-texto, 1)));padding:4px 9px;border-radius:5px;border:1px solid var(--border);background:none;color:var(--muted);cursor:pointer;transition:all .15s;}
.tela-analise-campanhas :deep(.gv-pbtn.active){background:var(--accent);color:var(--sobre-cor);border-color:var(--accent);}
.tela-analise-campanhas :deep(.custom-range-btn){font-family:var(--fonte-principal);font-weight:500;font-size:max(9px, calc(11px * var(--escala-texto, 1)));padding:5px 14px;border-radius:3px;background:transparent;border:1px solid var(--border);color:var(--muted);cursor:pointer;transition:all .18s;white-space:nowrap;}
.tela-analise-campanhas :deep(.custom-range-btn:hover),.tela-analise-campanhas :deep(.custom-range-btn.active){border-color:var(--accent);color:var(--accent);}

/* ── Loading state (compartilhado com Gestão à Vista — cada tela traz sua cópia) ── */
.tela-analise-campanhas :deep(.gv-loading-full){grid-column:1/-1;display:flex;align-items:center;justify-content:center;font-family:var(--fonte-principal);font-size:max(9px, calc(14px * var(--escala-texto, 1)));letter-spacing:4px;text-transform:uppercase;color:var(--muted);opacity:.4;}
@keyframes maSpin{to{transform:rotate(360deg)}}
.tela-analise-campanhas :deep(.gv-loading-screen){grid-column:1/-1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;min-height:60vh;}
.tela-analise-campanhas :deep(.gv-spinner){width:48px;height:48px;border-radius:50%;border:3px solid var(--border);border-top-color:var(--accent);animation:maSpin .9s linear infinite;}
.tela-analise-campanhas :deep(.gv-loading-lbl){font-family:var(--fonte-principal);font-size:max(9px, calc(10px * var(--escala-texto, 1)));letter-spacing:4px;text-transform:uppercase;color:var(--muted);}

/* ── Meta Ads — Análise de Campanhas (legacy/estilos-globais.css, bloco
     "── META ADS ──"; movido para cá na íntegra. Vários seletores abaixo,
     entre eles ma-topbar, ma-period-btn, ma-refresh-btn, ma-module-tab,
     ma-two-col, ma-chart-wrap, ma-setup, ma-adacc, ma-loading, ma-funnel-v2,
     ma-funnel-arrow, ma-obj-group, ma-camp-chk-row e ma-apply-btn, são
     resíduo de uma versão anterior da tela — não batem com nenhum elemento
     do HTML/JS atual (conferido por grep) — mantidos por fidelidade ao
     legado, sem risco: simplesmente não casam com nada. ── */
.tela-analise-campanhas :deep(.ma-topbar){display:flex;align-items:center;justify-content:space-between;padding:10px 24px;border-bottom:1px solid var(--border);background:var(--surface);position:sticky;top:0;z-index:10;gap:12px;flex-wrap:wrap;}
.tela-analise-campanhas :deep(.ma-topbar-left){display:flex;align-items:center;gap:12px;}
.tela-analise-campanhas :deep(.ma-back){display:flex;align-items:center;gap:5px;font-family:var(--fonte-principal);font-size:max(9px, calc(11px * var(--escala-texto, 1)));font-weight:600;color:var(--accent);cursor:pointer;background:none;border:none;padding:0;letter-spacing:.5px;text-transform:uppercase;}
.tela-analise-campanhas :deep(.ma-topbar-title){font-family:var(--fonte-principal);font-size:max(9px, calc(15px * var(--escala-texto, 1)));font-weight:500;letter-spacing:2.5px;text-transform:uppercase;color:var(--text);}
.tela-analise-campanhas :deep(.ma-topbar-sep){width:1px;height:18px;background:var(--border);}
.tela-analise-campanhas :deep(.ma-account-sel){font-family:var(--fonte-principal);font-size:max(9px, calc(12px * var(--escala-texto, 1)));border:1px solid var(--border);border-radius:6px;padding:5px 10px;background:var(--surface2);color:var(--text);cursor:pointer;outline:none;}
.tela-analise-campanhas :deep(.ma-period-row){display:flex;align-items:center;gap:4px;}
.tela-analise-campanhas :deep(.ma-period-btn){font-family:var(--fonte-principal);font-size:max(9px, calc(11px * var(--escala-texto, 1)));font-weight:500;padding:4px 10px;border-radius:5px;border:1px solid var(--border);background:none;color:var(--muted);cursor:pointer;transition:all .15s;letter-spacing:.3px;}
.tela-analise-campanhas :deep(.ma-period-btn.active){background:var(--accent);color:var(--sobre-cor);border-color:var(--accent);}
.tela-analise-campanhas :deep(.ma-refresh-btn){display:flex;align-items:center;gap:5px;font-family:var(--fonte-principal);font-size:max(9px, calc(11px * var(--escala-texto, 1)));border:1px solid var(--border);border-radius:5px;padding:4px 10px;background:none;color:var(--muted);cursor:pointer;transition:all .15s;}
.tela-analise-campanhas :deep(.ma-refresh-btn:hover){border-color:var(--accent);color:var(--accent);}
.tela-analise-campanhas :deep(.ma-body){padding:24px;display:flex;flex-direction:column;gap:20px;max-width:1400px;margin:0 auto;width:100%;}
.tela-analise-campanhas :deep(.ma-module-tabs){display:flex;gap:6px;border-bottom:2px solid var(--border);padding-bottom:0;}
.tela-analise-campanhas :deep(.ma-module-tab){font-family:var(--fonte-principal);font-size:max(9px, calc(12px * var(--escala-texto, 1)));font-weight:500;letter-spacing:1.5px;text-transform:uppercase;padding:8px 16px;border:none;background:none;color:var(--muted);cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-2px;transition:all .15s;}
.tela-analise-campanhas :deep(.ma-module-tab.active){color:var(--accent);border-bottom-color:var(--accent);}
.tela-analise-campanhas :deep(.ma-module-tab:disabled){opacity:.35;cursor:not-allowed;}
.tela-analise-campanhas :deep(.ma-kpi-row){display:grid;grid-template-columns:repeat(4,1fr);gap:10px;}
.tela-analise-campanhas :deep(.ma-kpi){background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);padding:14px 16px;display:flex;flex-direction:column;gap:4px;}
.tela-analise-campanhas :deep(.ma-kpi-label){font-family:var(--fonte-principal);font-size:max(9px, calc(10px * var(--escala-texto, 1)));font-weight:600;text-transform:uppercase;letter-spacing:1.5px;color:var(--muted);}
.tela-analise-campanhas :deep(.ma-kpi-q){margin-left:5px;width:14px;height:14px;border-radius:50%;border:1px solid var(--border);background:none;color:var(--muted);font-size:max(9px, calc(9px * var(--escala-texto, 1)));font-weight:700;cursor:pointer;line-height:1;padding:0;vertical-align:middle;}
.tela-analise-campanhas :deep(.ma-kpi-q:hover){border-color:var(--accent);color:var(--accent);}
.tela-analise-campanhas :deep(.ma-kpi-val){font-family:var(--fonte-dados);font-size:max(16px, calc(26px * var(--escala-texto, 1)));font-weight:700;color:var(--text);line-height:1.1;}
.tela-analise-campanhas :deep(.ma-kpi-delta){font-family:var(--fonte-principal);font-size:max(9px, calc(11px * var(--escala-texto, 1)));font-weight:500;display:flex;align-items:center;gap:4px;margin-top:2px;}
.tela-analise-campanhas :deep(.ma-delta-up){color:var(--green);}
.tela-analise-campanhas :deep(.ma-delta-down){color:var(--red);}
.tela-analise-campanhas :deep(.ma-delta-neu){color:var(--muted);}
.tela-analise-campanhas :deep(.ma-kpi-sub){font-family:var(--fonte-principal);font-size:max(9px, calc(10px * var(--escala-texto, 1)));color:var(--muted);margin-top:1px;}
.tela-analise-campanhas :deep(.ma-section){background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);padding:18px 20px;}
.tela-analise-campanhas :deep(.ma-section-title){font-family:var(--fonte-principal);font-size:max(9px, calc(10px * var(--escala-texto, 1)));font-weight:700;text-transform:uppercase;letter-spacing:2px;color:var(--muted);margin-bottom:14px;}
.tela-analise-campanhas :deep(.ma-two-col){display:grid;grid-template-columns:1fr 1fr;gap:16px;}
.tela-analise-campanhas :deep(.ma-chart-wrap){position:relative;}
.tela-analise-campanhas :deep(.ma-table){width:100%;border-collapse:collapse;font-family:var(--fonte-principal);font-size:max(9px, calc(12px * var(--escala-texto, 1)));}
.tela-analise-campanhas :deep(.ma-table th){font-size:max(9px, calc(10px * var(--escala-texto, 1)));font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--muted);padding:6px 10px;text-align:left;border-bottom:1px solid var(--border);cursor:pointer;user-select:none;white-space:nowrap;}
.tela-analise-campanhas :deep(.ma-table th:hover){color:var(--accent);}
.tela-analise-campanhas :deep(.ma-table td){padding:8px 10px;border-bottom:1px solid var(--border);vertical-align:middle;color:var(--text);}
.tela-analise-campanhas :deep(.ma-table tr:last-child td){border-bottom:none;}
.tela-analise-campanhas :deep(.ma-table tr:hover td){background:var(--surface2);}
.tela-analise-campanhas :deep(.ma-table .ma-camp-name){max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;}
.tela-analise-campanhas :deep(.ma-table th.num),.tela-analise-campanhas :deep(.ma-table td.num){text-align:right;white-space:nowrap;}
.tela-analise-campanhas :deep(.ma-table th:not(.sortable)){cursor:default;}
.tela-analise-campanhas :deep(.ma-table th:not(.sortable):hover){color:var(--muted);}
.tela-analise-campanhas :deep(.ma-badge){display:inline-flex;align-items:center;font-size:max(9px, calc(9px * var(--escala-texto, 1)));font-weight:700;letter-spacing:1px;text-transform:uppercase;padding:2px 7px;border-radius:3px;}
.tela-analise-campanhas :deep(.ma-badge-active){background:color-mix(in srgb,var(--green) 12%,var(--surface));color:var(--green);}
.tela-analise-campanhas :deep(.ma-badge-paused){background:color-mix(in srgb,var(--orange) 12%,var(--surface));color:var(--orange);}
.tela-analise-campanhas :deep(.ma-badge-archived){background:color-mix(in srgb,var(--muted) 12%,var(--surface));color:var(--muted);}
.tela-analise-campanhas :deep(.ma-score){display:inline-block;width:8px;height:8px;border-radius:50%;flex-shrink:0;}
.tela-analise-campanhas :deep(.ma-score-good){background:var(--green);}
.tela-analise-campanhas :deep(.ma-score-mid){background:var(--orange);}
.tela-analise-campanhas :deep(.ma-score-bad){background:var(--red);}
.tela-analise-campanhas :deep(.ma-obj-chip){font-family:var(--fonte-principal);font-size:max(9px, calc(9px * var(--escala-texto, 1)));font-weight:600;letter-spacing:.5px;padding:2px 6px;border-radius:3px;background:var(--surface2);color:var(--muted);text-transform:uppercase;}
.tela-analise-campanhas :deep(.ma-setup){display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:320px;gap:14px;text-align:center;}
.tela-analise-campanhas :deep(.ma-setup-icon){width:56px;height:56px;border-radius:14px;background:linear-gradient(135deg,#1877F2,#0062E0);display:flex;align-items:center;justify-content:center;}
.tela-analise-campanhas :deep(.ma-setup-title){font-family:var(--fonte-principal);font-size:max(16px, calc(18px * var(--escala-texto, 1)));font-weight:500;letter-spacing:1.5px;color:var(--text);}
.tela-analise-campanhas :deep(.ma-setup-sub){font-family:var(--fonte-principal);font-size:max(9px, calc(12px * var(--escala-texto, 1)));color:var(--muted);max-width:320px;line-height:1.6;}
.tela-analise-campanhas :deep(.ma-setup-btn){background:linear-gradient(135deg,#1877F2,#0062E0);color:#fff;border:none;border-radius:7px;padding:10px 22px;font-family:var(--fonte-principal);font-size:max(9px, calc(12px * var(--escala-texto, 1)));font-weight:600;cursor:pointer;letter-spacing:.3px;}
.tela-analise-campanhas :deep(.ma-adacc-list){display:flex;flex-direction:column;gap:6px;margin-top:8px;max-height:260px;overflow-y:auto;}
.tela-analise-campanhas :deep(.ma-adacc-row){display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border:1px solid var(--border);border-radius:7px;cursor:pointer;transition:all .15s;background:var(--surface2);}
.tela-analise-campanhas :deep(.ma-adacc-row:hover){border-color:var(--accent-forte);background:var(--accent-light);}
.tela-analise-campanhas :deep(.ma-adacc-name){font-family:var(--fonte-principal);font-size:max(9px, calc(13px * var(--escala-texto, 1)));font-weight:500;color:var(--text);}
.tela-analise-campanhas :deep(.ma-adacc-id){font-family:var(--fonte-principal);font-size:max(9px, calc(10px * var(--escala-texto, 1)));color:var(--muted);}
.tela-analise-campanhas :deep(.ma-loading){display:flex;align-items:center;justify-content:center;min-height:280px;gap:10px;font-family:var(--fonte-principal);font-size:max(9px, calc(13px * var(--escala-texto, 1)));color:var(--muted);}
.tela-analise-campanhas :deep(.ma-spinner){width:20px;height:20px;border:2px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:maSpin .7s linear infinite;}
.tela-analise-campanhas :deep(.ma-funnel-v2){display:flex;flex-direction:column;align-items:center;gap:0;padding:4px 0;width:100%;}
.tela-analise-campanhas :deep(.ma-funnel-v2-bar){border-radius:7px;padding:10px 14px;display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:52px;transition:width .5s ease;}
.tela-analise-campanhas :deep(.ma-funnel-v2-conn){display:flex;flex-direction:column;align-items:center;gap:0;padding:2px 0;width:100%;}
.tela-analise-campanhas :deep(.ma-funnel-v2-conn-line){width:2px;height:9px;background:var(--border);}
.tela-analise-campanhas :deep(.ma-funnel-v2-conn-tag){font-family:var(--fonte-principal);font-size:max(9px, calc(9px * var(--escala-texto, 1)));color:var(--muted);padding:1px 8px;background:var(--surface2);border:1px solid var(--border);border-radius:10px;white-space:nowrap;letter-spacing:.2px;}
.tela-analise-campanhas :deep(.ma-funnel-arrow){color:var(--muted);font-size:max(9px, calc(14px * var(--escala-texto, 1)));text-align:center;line-height:1;}
.tela-analise-campanhas :deep(.ma-obj-group){border:1px solid var(--border);border-radius:8px;overflow:hidden;margin-bottom:8px;}
.tela-analise-campanhas :deep(.ma-obj-group-hdr){display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--surface2);cursor:pointer;user-select:none;}
.tela-analise-campanhas :deep(.ma-obj-group-title){font-family:var(--fonte-principal);font-size:max(9px, calc(12px * var(--escala-texto, 1)));font-weight:500;letter-spacing:1.5px;text-transform:uppercase;color:var(--text);}
.tela-analise-campanhas :deep(.ma-obj-group-body){padding:10px 14px;display:flex;flex-direction:column;gap:6px;border-top:1px solid var(--border);}
.tela-analise-campanhas :deep(.ma-camp-chk-row){display:flex;align-items:center;gap:8px;font-family:var(--fonte-principal);font-size:max(9px, calc(12px * var(--escala-texto, 1)));color:var(--text);cursor:pointer;}
.tela-analise-campanhas :deep(.ma-camp-chk-row input[type=checkbox]){accent-color:var(--accent);}
.tela-analise-campanhas :deep(.ma-apply-btn){width:100%;padding:9px;background:var(--accent);color:var(--sobre-cor);border:none;border-radius:6px;font-family:var(--fonte-principal);font-size:max(9px, calc(12px * var(--escala-texto, 1)));font-weight:600;cursor:pointer;margin-top:8px;letter-spacing:.3px;}
@media(max-width:900px){
  .tela-analise-campanhas :deep(.ma-kpi-row){grid-template-columns:repeat(2,1fr);}
  .tela-analise-campanhas :deep(.ma-two-col){grid-template-columns:1fr;}
}
@media(max-width:600px){
  .tela-analise-campanhas :deep(.ma-kpi-row){grid-template-columns:1fr 1fr;}
  .tela-analise-campanhas :deep(.ma-kpi-val){font-size:max(16px, calc(20px * var(--escala-texto, 1)));}
  .tela-analise-campanhas :deep(.ma-topbar){padding:8px 14px;}
}
.tela-analise-campanhas :deep(.ma-filter-btn){display:flex;align-items:center;gap:7px;padding:8px 16px;border:1px solid var(--accent);border-radius:8px;font-family:var(--fonte-principal);font-size:max(9px, calc(11px * var(--escala-texto, 1)));font-weight:700;letter-spacing:.5px;color:var(--accent-forte);background:var(--accent-light);cursor:pointer;transition:background .15s;}
.tela-analise-campanhas :deep(.ma-filter-btn:hover){background:rgba(24,119,242,.15);}
.tela-analise-campanhas :deep(.ma-funnel-bar-row){display:flex;justify-content:center;width:100%;}
.tela-analise-campanhas :deep(.ma-funnel-bar){border-radius:8px;transition:width .5s ease;}
.tela-analise-campanhas :deep(.ma-funnel-info){display:flex;align-items:center;justify-content:space-between;padding:6px 4px 2px;width:100%;}

/* ── RESPONSIVE: topbar/clock (compartilhado com Gestão à Vista — cada tela
     traz sua cópia; ver legacy L645-662 e L694-696, hoje só em
     tela-gestao-a-vista.vue) ── */
@media(max-width:1024px){
  .tela-analise-campanhas :deep(.gv-topbar){flex-wrap:wrap;padding:8px 14px;gap:6px;}
  .tela-analise-campanhas :deep(.gv-clock-wrap){display:none;}
}
@media(max-width:640px){
  .tela-analise-campanhas :deep(.gv-topbar){padding:6px 10px;}
  .tela-analise-campanhas :deep(.gv-brand-tag){display:none;}
  /* Mesma correção da Análise de Vendas: era a outra tela que ainda quebrava a
     régua em duas fileiras e encolhia o botão para 9px — herança do monólito.
     Uma linha que rola, botão de 10px, como a Gestão de Tráfego. */
  .tela-analise-campanhas :deep(.gv-period-btns){flex-wrap:nowrap;overflow-x:auto;-webkit-overflow-scrolling:touch;gap:6px;padding-bottom:2px;}
  .tela-analise-campanhas :deep(.gv-pbtn){font-size:max(9px, calc(10px * var(--escala-texto, 1)));padding:5px 10px;border-radius:6px;flex-shrink:0;white-space:nowrap;}
  .tela-analise-campanhas :deep(.gv-update-status){display:none;}
}
@media(max-width:480px){
  .tela-analise-campanhas :deep(.gv-topbar){flex-wrap:wrap;padding:0;gap:0;border-bottom:1px solid var(--border);flex-shrink:0;position:sticky;top:0;z-index:10;background:var(--surface);}
  .tela-analise-campanhas :deep(.gv-topbar-brand){order:1;display:flex;align-items:center;gap:10px;padding:10px 16px;}
}
/* FAIXA DE CONTROLES — ver o comentario no template. */
.tela-analise-campanhas :deep(.gv-controles){display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap;padding:0;background:transparent;}  /* mora DENTRO da barra: fundo, borda de baixo e respiro lateral sao dela */
@media(max-width:640px){.tela-analise-campanhas :deep(.gv-controles){padding:8px 12px;flex-direction:column;align-items:stretch;gap:8px;}}
</style>

<style>
/* Segundo bloco, SEM "scoped": .ma-filter-drawer/.ma-filter-bd (criados por
   _openCampanhaFilter) e .custom-date-input (usado dentro do modal de
   período personalizado criado por toggleMaCustomRange) são anexados
   diretamente a document.body via document.createElement/appendChild —
   ficam FORA da árvore do componente no DOM, então o atributo de escopo do
   Vue (data-v-*) nunca chega até eles e nenhum :deep() no bloco acima
   alcança esses elementos. Precisam de CSS global de verdade. */
.custom-date-input{font-family:var(--fonte-principal);font-weight:400;font-size:max(16px, calc(16px * var(--escala-texto, 1)));padding:5px 10px;border-radius:3px;border:1.5px solid var(--border);background:var(--surface);color:var(--text);outline:none;cursor:pointer;}
.custom-date-input:focus{border-color:var(--accent);}
@keyframes slideInRight{from{transform:translateX(100%);opacity:0;}to{transform:translateX(0);opacity:1;}}
@keyframes fadeInBd{from{opacity:0;}to{opacity:1;}}
.ma-filter-drawer{position:fixed;top:0;right:0;width:400px;max-width:95vw;height:100vh;background:var(--surface);border-left:1px solid var(--border);z-index:9999;display:flex;flex-direction:column;animation:slideInRight .22s ease;box-shadow:-6px 0 32px rgba(0,0,0,.22);}
.ma-filter-bd{position:fixed;inset:0;z-index:9998;background:rgba(0,0,0,.32);animation:fadeInBd .22s ease;padding-top:max(16px,env(safe-area-inset-top));padding-bottom:max(16px,env(safe-area-inset-bottom));padding-left:max(12px,env(safe-area-inset-left));padding-right:max(12px,env(safe-area-inset-right));touch-action:none;overscroll-behavior:contain;}
.ma-filter-bd > *{overscroll-behavior:contain;touch-action:pan-y;}
</style>
