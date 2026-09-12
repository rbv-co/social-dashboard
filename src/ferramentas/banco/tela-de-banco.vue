<template>
  <!-- Porte fiel de #banco-screen (legacy/index.html L12152). Os handlers estáticos
       (voltar, busca, abrir seletor) usam bindings Vue; as linhas de arquivo são
       geradas via createElement em renderArquivos() e estilizadas com :deep(). -->
  <div class="tela-banco">
    <barra-de-topo voltar="Central" titulo="Banco de Arquivos" @voltar="voltar" />
    <div class="banco-body">
      <!-- A ÁREA DE ENVIO SÓ EXISTE PARA QUEM PODE CRIAR (B1c, 13/08/2026).
           Antes ela aparecia para todo mundo que abrisse a ferramenta, e
           funcionava: quem tinha "Só ver" arrastava um arquivo e ele subia.
           Esconder não é a tranca — a tranca é o `if` do onMounted, que não
           liga os eventos. Isto aqui é para a tela não oferecer o que a
           pessoa não pode fazer. -->
      <div v-if="podeEnviar" class="banco-upload-zone" id="banco-drop-zone">
        <div class="banco-upload-icon">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/></svg>
        </div>
        <div class="banco-upload-text">Arraste arquivos aqui ou <em @click="abrirSeletor">clique para selecionar</em></div>
        <div class="banco-upload-limit">Máx. 50 MB por arquivo</div>
        <div class="banco-progress-wrap" id="banco-progress-wrap">
          <div class="banco-progress-lbl" id="banco-progress-lbl"></div>
          <div class="banco-progress-bar"><div class="banco-progress-fill" id="banco-progress-fill" style="width:0%"></div></div>
        </div>
        <input type="file" id="banco-file-input" multiple style="display:none">
      </div>
      <div class="banco-toolbar">
        <input type="text" class="banco-search" id="banco-search" placeholder="Buscar arquivo…" @input="renderArquivos">
        <span class="banco-stats-lbl" id="banco-stats-lbl"></span>
      </div>
      <div class="banco-file-list" id="banco-file-list"></div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted } from 'vue'
import BarraDeTopo from '../../compartilhado/barra-de-topo.vue'
import { useRouter } from 'vue-router'
import { sbClient } from '../../compartilhado/conectar-no-banco-de-dados.js'
import { hasPermission } from '../../compartilhado/controle-de-login-e-usuario.js'
import { adminToast } from '../../compartilhado/avisos.js'

const router = useRouter()
function voltar(){ router.push({ name: 'inicio' }) }
function abrirSeletor(){
  // Cinto além do v-if: o seletor não abre sem a permissão, mesmo se alguém
  // chamar a função pelo console.
  if(!podeEnviar.value) return
  document.getElementById('banco-file-input').click()
}

// ── A ESCADA DESTA FERRAMENTA PASSOU A VALER (B1c, 13/08/2026) ──────────────
//
// Até aqui os três degraus do Banco de Arquivos não mandavam em nada:
//   - ENVIAR não conferia coisa alguma. Quem tinha "Só ver" subia arquivo.
//   - EXCLUIR olhava `estado.role === 'admin'`, que é OUTRO campo. Dar "Tudo"
//     no Banco NÃO dava o poder de apagar, e quem era admin apagava mesmo sem
//     "Tudo". A permissão dizia uma coisa e o botão obedecia a outra.
//
// Agora os dois saem da MESMA fonte que o editor de permissões desenha, então
// a frase que o admin lê ao conceder é a que acontece na tela.
const podeEnviar = computed(() => hasPermission('banco', 'criar'))
const podeExcluir = computed(() => hasPermission('banco', 'excluir'))

// ── JS portado verbatim de legacy/index.html (state L9635; funções L11632-11738) ──
let _bancoFiles=[];
const _SVG_DL='<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
const _SVG_DEL='<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>';
const _SVG_FOLDER='<svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';

async function loadArquivos(){
  const listEl=document.getElementById('banco-file-list');
  _bancoBuildEmpty(listEl,'Carregando…','');
  const{data,error}=await sbClient.storage.from('arquivos').list('',{limit:500,sortBy:{column:'name',order:'asc'}});
  if(error){_bancoBuildEmpty(listEl,'Erro ao carregar arquivos',error.message);return;}
  _bancoFiles=(data||[]).filter(f=>f.name&&f.name!=='.emptyFolderPlaceholder');
  renderArquivos();
}
function renderArquivos(){
  const q=(document.getElementById('banco-search')?.value||'').toLowerCase().trim();
  const files=q?_bancoFiles.filter(f=>f.name.toLowerCase().includes(q)):_bancoFiles;
  const statsEl=document.getElementById('banco-stats-lbl');
  if(statsEl){
    const total=_bancoFiles.reduce((s,f)=>s+(f.metadata?.size||0),0);
    statsEl.textContent=_bancoFiles.length+' arquivo'+((_bancoFiles.length!==1)?'s':'')+' · '+_fmtBytes(total);
  }
  const listEl=document.getElementById('banco-file-list');
  listEl.textContent='';
  if(!files.length){
    _bancoBuildEmpty(listEl,q?'Nenhum resultado para "'+q+'"':'Nenhum arquivo ainda',
      q?'Tente outro termo'
       :(podeEnviar.value?'Faça upload usando a área acima'
                         :'Quem envia arquivo aqui é quem tem permissão para isso. Peça a um administrador.'));
    return;
  }
  const podeApagar=podeExcluir.value;
  files.forEach(f=>{
    const{cls,lbl}=_bancoIconInfo(f.name);
    const size=_fmtBytes(f.metadata?.size||0);
    const date=f.updated_at?new Date(f.updated_at).toLocaleDateString('pt-BR',{day:'2-digit',month:'short',year:'numeric'}).replace(/ de /g,'/').replace('.',''):'—';
    const row=document.createElement('div');
    row.className='banco-file-row';
    row.dataset.fname=f.name;
    const ico=document.createElement('div');
    ico.className='banco-file-icon '+cls;
    ico.textContent=lbl;
    const meta=document.createElement('div');
    meta.className='banco-file-meta';
    const nm=document.createElement('div');nm.className='banco-file-name';nm.textContent=f.name;nm.title=f.name;
    const dt=document.createElement('div');dt.className='banco-file-details';dt.textContent=lbl+' · '+size+' · '+date;
    meta.appendChild(nm);meta.appendChild(dt);
    const acts=document.createElement('div');acts.className='banco-file-acts';
    // O LINK NASCE NO CLIQUE, E VALE 60 SEGUNDOS.
    //
    // Antes era `/object/public/arquivos/...`: endereço fixo, sem login, que
    // funcionava para QUALQUER pessoa que o tivesse — e a ferramenta se chama
    // "banco de arquivos da Central", nome que faz todo mundo achar que é
    // interno. Um endereço desses, uma vez copiado num grupo de mensagens,
    // nunca mais é recolhido.
    //
    // `createSignedUrl` pede o arquivo em nome de QUEM ESTÁ LOGADO, então a
    // permissão é conferida no servidor a cada clique. Nada de endereço eterno.
    const dlA=document.createElement('button');
    dlA.type='button';
    dlA.className='banco-dl-btn';
    dlA.addEventListener('click',()=>_bancoBaixar(f.name));
    dlA.innerHTML=_SVG_DL;
    const dlSp=document.createElement('span');dlSp.textContent='Baixar';dlA.appendChild(dlSp);
    acts.appendChild(dlA);
    if(podeApagar){
      const delB=document.createElement('button');
      delB.className='banco-del-btn';delB.title='Excluir';
      delB.innerHTML=_SVG_DEL;
      delB.addEventListener('click',()=>deletarArquivo(row.dataset.fname));
      acts.appendChild(delB);
    }
    row.appendChild(ico);row.appendChild(meta);row.appendChild(acts);
    listEl.appendChild(row);
  });
}
function _bancoBuildEmpty(container,title,sub){
  container.textContent='';
  const wrap=document.createElement('div');wrap.className='banco-empty';
  wrap.innerHTML=_SVG_FOLDER;
  const t=document.createElement('div');t.className='banco-empty-text';t.textContent=title;
  const s=document.createElement('div');s.className='banco-empty-sub';s.textContent=sub;
  wrap.appendChild(t);if(sub)wrap.appendChild(s);
  container.appendChild(wrap);
}
function _bancoIconInfo(name){
  const ext=(name.split('.').pop()||'').toLowerCase();
  if(['jpg','jpeg','png','gif','webp','svg'].includes(ext))return{cls:'bfi-img',lbl:ext.toUpperCase()};
  if(ext==='pdf')return{cls:'bfi-pdf',lbl:'PDF'};
  if(['mp4','mov','avi','mkv','webm'].includes(ext))return{cls:'bfi-vid',lbl:'VID'};
  if(['zip','rar','7z'].includes(ext))return{cls:'bfi-zip',lbl:'ZIP'};
  if(['doc','docx','xls','xlsx','csv','txt'].includes(ext))return{cls:'bfi-doc',lbl:ext.toUpperCase().slice(0,4)};
  return{cls:'bfi-oth',lbl:(ext||'FILE').toUpperCase().slice(0,4)};
}
function _fmtBytes(b){if(!b)return'0 B';const k=1024,u=['B','KB','MB','GB'],i=Math.floor(Math.log(b)/Math.log(k));return(b/Math.pow(k,i)).toFixed(i?1:0)+' '+u[i];}
async function deletarArquivo(name){
  if(!podeExcluir.value){ adminToast('Você não tem permissão para excluir arquivos.',false); return }
  if(!confirm('Excluir "'+name+'"?'))return;
  const{error}=await sbClient.storage.from('arquivos').remove([name]);
  if(error){alert('Erro ao excluir: '+error.message);return;}
  loadArquivos();
}
let _bancoUploadReady=false;
function setupBancoUpload(){
  if(_bancoUploadReady)return;
  _bancoUploadReady=true;
  const zone=document.getElementById('banco-drop-zone');
  const inp=document.getElementById('banco-file-input');
  zone.addEventListener('click',e=>{if(e.target.tagName!=='EM')inp.click();});
  inp.addEventListener('change',e=>{Array.from(e.target.files).forEach(f=>_bancoUpload(f));inp.value='';});
  zone.addEventListener('dragover',e=>{e.preventDefault();zone.classList.add('drag-over');});
  zone.addEventListener('dragleave',()=>zone.classList.remove('drag-over'));
  zone.addEventListener('drop',e=>{e.preventDefault();zone.classList.remove('drag-over');Array.from(e.dataTransfer.files).forEach(f=>_bancoUpload(f));});
}
function _sanitizeStorageKey(name){
  return name.normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-zA-Z0-9._\-]/g,'_');
}
// Pede um link temporário e baixa. Falha em conferir é falha em BAIXAR: sem o
// link, não se abre nada — nunca cair num endereço público como plano B.
async function _bancoBaixar(nome){
  const{data,error}=await sbClient.storage.from('arquivos').createSignedUrl(nome,60,{download:nome});
  if(error||!data?.signedUrl){
    adminToast('Não consegui liberar o download de "'+nome+'". Recarregue a página e tente de novo.',false);
    return;
  }
  const a=document.createElement('a');
  a.href=data.signedUrl;a.download=nome;a.rel='noopener';
  document.body.appendChild(a);a.click();a.remove();
}

// A MENSAGEM CRUA DO SERVIDOR NÃO EXPLICA NADA a quem está com o arquivo na
// mão. "mime type application/x-msdownload is not supported" fez o dono achar
// que a ferramenta estava quebrada — e o que faltava era só o tipo na lista.
function _fraseDaFalha(erro,file){
  const m=String(erro?.message||'').toLowerCase()
  if(m.includes('mime')||m.includes('not supported')||m.includes('invalid_mime'))
    return 'O banco não aceita este tipo de arquivo ("'+(file.type||'tipo desconhecido')+'"). '
         + 'Se ele deveria ser aceito, avise — a lista de tipos é ajustável.'
  if(m.includes('exceeded')||m.includes('too large')||m.includes('maximum'))
    return 'Arquivo grande demais: o limite é 50 MB por arquivo.'
  if(m.includes('row-level security')||m.includes('unauthorized')||m.includes('403'))
    return 'Você não tem permissão para enviar arquivo aqui. Fale com um administrador.'
  if(m.includes('failed to fetch')||m.includes('network'))
    return 'A internet caiu no meio do envio. Tente de novo.'
  return 'Não consegui enviar: '+(erro?.message||'motivo desconhecido')
}

async function _bancoUpload(file){
  const wrap=document.getElementById('banco-progress-wrap');
  const fill=document.getElementById('banco-progress-fill');
  const lbl=document.getElementById('banco-progress-lbl');
  const storageKey=_sanitizeStorageKey(file.name);
  wrap.style.display='block';lbl.textContent='Enviando '+file.name+'…';fill.style.width='20%';
  const{error}=await sbClient.storage.from('arquivos').upload(storageKey,file,{cacheControl:'3600',upsert:true});
  fill.style.width='100%';
  if(error){
    const frase=_fraseDaFalha(error,file);
    lbl.textContent=frase;
    adminToast(frase,false);
    // 3,5s some antes de a pessoa terminar de ler uma frase de duas linhas
    setTimeout(()=>{wrap.style.display='none';fill.style.width='0%';},9000);
    return;
  }
  lbl.textContent=file.name+' enviado!';
  setTimeout(()=>{wrap.style.display='none';fill.style.width='0%';loadArquivos();},1200);
}

onMounted(()=>{
  if(!hasPermission('banco')){ adminToast('Sem acesso',false); router.push({ name: 'inicio' }); return }
  // Sem 'criar', os eventos de arrastar e de escolher arquivo NÃO são ligados.
  // É aqui que mora a tranca: o `v-if` do template só some com a área, e sumir
  // da tela nunca impediu ninguém que saiba usar o console.
  if(podeEnviar.value) setupBancoUpload();
  loadArquivos();
});

const logoClaroUrl = '/midia/LOGOTIPOBRENOPRETO.png'
const logoEscuroUrl = '/midia/LOGOTIPOBRENOBRANCO.png'
</script>

<style scoped>
/* Porte das regras .banco- e #banco-screen (legacy L2479). #banco-screen vira .tela-banco
   (sem display:none — a visibilidade é do router). Descendentes usam :deep() porque as
   linhas de arquivo e o estado vazio são criados via createElement (fora do template). */
/* Fundo TRANSPARENTE: o #bg-shapes (degradê + ícones) fica fixo atrás de tudo
   pra aparecer, e o body já pinta a cor base nos DOIS temas. Pintar cor sólida
   aqui tapava a decoração e ainda deixava uma faixa visível onde a tela
   terminava. */
.tela-banco{min-height:100vh;display:flex;flex-direction:column;background:transparent;}
.tela-banco :deep(.banco-topbar .rbv-logo){height:24px;width:auto;}
.tela-banco :deep(.banco-topbar){display:flex;align-items:center;justify-content:space-between;padding:7px 28px;border-bottom:1px solid var(--border);background:var(--surface);position:sticky;top:0;z-index:10;}
.tela-banco :deep(.banco-back){display:flex;align-items:center;gap:4px;font-family:var(--fonte-principal);font-size:max(9px, calc(10px * var(--escala-texto, 1)));font-weight:600;color:var(--accent);cursor:pointer;background:none;border:none;padding:0;letter-spacing:.3px;text-transform:uppercase;}
.tela-banco :deep(.banco-topbar-title){font-family:var(--fonte-principal);font-size:max(9px, calc(15px * var(--escala-texto, 1)));font-weight:500;letter-spacing:2.5px;text-transform:uppercase;color:var(--text);}
.tela-banco :deep(.banco-body){max-width:none;width:100%;padding:32px var(--gutter);box-sizing:border-box;}
.tela-banco :deep(.banco-upload-zone){border:2px dashed var(--accent-mid);border-radius:var(--radius-lg);background:var(--accent-light);padding:28px 24px 22px;text-align:center;cursor:pointer;transition:all .2s;margin-bottom:28px;}
.tela-banco :deep(.banco-upload-zone.drag-over){border-color:var(--accent);background:rgba(29,78,216,.14);transform:scale(1.01);}
.tela-banco :deep(.banco-upload-zone:hover){border-color:var(--accent);}
.tela-banco :deep(.banco-upload-icon){color:var(--accent);opacity:.65;margin-bottom:8px;}
.tela-banco :deep(.banco-upload-text){font-family:var(--fonte-principal);font-size:max(9px, calc(13px * var(--escala-texto, 1)));color:var(--muted);line-height:1.7;}
.tela-banco :deep(.banco-upload-text em){color:var(--accent);font-style:normal;font-weight:600;cursor:pointer;}
.tela-banco :deep(.banco-upload-text em:hover){text-decoration:underline;}
.tela-banco :deep(.banco-upload-limit){font-family:var(--fonte-principal);font-size:max(9px, calc(10px * var(--escala-texto, 1)));color:var(--muted);letter-spacing:.5px;margin-top:4px;}
.tela-banco :deep(.banco-progress-wrap){margin-top:14px;text-align:left;display:none;}
.tela-banco :deep(.banco-progress-lbl){font-family:var(--fonte-principal);font-size:max(9px, calc(11px * var(--escala-texto, 1)));color:var(--muted);margin-bottom:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.tela-banco :deep(.banco-progress-bar){height:3px;background:var(--border);border-radius:2px;overflow:hidden;}
.tela-banco :deep(.banco-progress-fill){height:100%;background:var(--accent);border-radius:2px;transition:width .25s ease;}
.tela-banco :deep(.banco-toolbar){display:flex;align-items:center;gap:10px;margin-bottom:14px;}
.tela-banco :deep(.banco-search){flex:1;padding:9px 13px;border-radius:var(--radius-md);border:1.5px solid var(--border);background:var(--surface);font-family:var(--fonte-principal);font-size:max(9px, calc(13px * var(--escala-texto, 1)));color:var(--text);outline:none;transition:border-color .18s;}
.tela-banco :deep(.banco-search:focus){border-color:var(--accent);}
/* 16px no celular: abaixo disso o iOS da zoom sozinho ao focar. No
   computador o tamanho miudo continua, que la nao ha esse efeito. */
@media(max-width:640px){.tela-banco :deep(.banco-search){font-size:max(16px, calc(16px * var(--escala-texto, 1)));}}
.tela-banco :deep(.banco-stats-lbl){font-family:var(--fonte-principal);font-size:max(9px, calc(11px * var(--escala-texto, 1)));color:var(--muted);white-space:nowrap;flex-shrink:0;}
.tela-banco :deep(.banco-file-list){display:flex;flex-direction:column;gap:4px;}
.tela-banco :deep(.banco-file-row){display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border);transition:border-color .15s,box-shadow .15s;}
.tela-banco :deep(.banco-file-row:hover){border-color:var(--accent);box-shadow:var(--shadow-sm);}
.tela-banco :deep(.banco-file-icon){width:34px;height:34px;border-radius:7px;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-family:var(--fonte-principal);font-size:max(9px, calc(8.5px * var(--escala-texto, 1)));font-weight:700;letter-spacing:.3px;}
.tela-banco :deep(.bfi-img){background:rgba(29,78,216,.1);color:var(--accent);}
.tela-banco :deep(.bfi-pdf){background:rgba(176,30,58,.1);color:var(--red);}
.tela-banco :deep(.bfi-vid){background:rgba(0,0,0,.07);color:var(--text);}
.tela-banco :deep(.bfi-zip){background:rgba(138,98,0,.1);color:var(--yellow);}
.tela-banco :deep(.bfi-doc){background:rgba(26,110,69,.1);color:var(--green);}
.tela-banco :deep(.bfi-oth){background:var(--surface2);color:var(--muted);}
.tela-banco :deep(.banco-file-meta){flex:1;min-width:0;}
.tela-banco :deep(.banco-file-name){font-family:var(--fonte-principal);font-size:max(9px, calc(13px * var(--escala-texto, 1)));font-weight:500;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.tela-banco :deep(.banco-file-details){font-family:var(--fonte-principal);font-size:max(9px, calc(11px * var(--escala-texto, 1)));color:var(--muted);margin-top:1px;}
.tela-banco :deep(.banco-file-acts){display:flex;gap:5px;flex-shrink:0;}
.tela-banco :deep(.banco-dl-btn){display:flex;align-items:center;gap:5px;padding:6px 12px;border-radius:var(--radius-sm);border:1px solid var(--border);background:transparent;color:var(--text);font-family:var(--fonte-principal);font-size:max(9px, calc(11px * var(--escala-texto, 1)));font-weight:500;cursor:pointer;transition:all .15s;text-decoration:none;white-space:nowrap;}
.tela-banco :deep(.banco-dl-btn:hover){border-color:var(--accent-forte);color:var(--accent-forte);background:var(--accent-light);}
.tela-banco :deep(.banco-del-btn){display:flex;align-items:center;padding:6px 8px;border-radius:var(--radius-sm);border:1px solid var(--border);background:none;color:var(--muted);cursor:pointer;transition:all .15s;}
.tela-banco :deep(.banco-del-btn:hover){border-color:var(--red);color:var(--red);background:rgba(176,30,58,.06);}
.tela-banco :deep(.banco-empty){text-align:center;padding:64px 24px;color:var(--muted);}
.tela-banco :deep(.banco-empty svg){margin:0 auto 14px;display:block;opacity:.2;}
.tela-banco :deep(.banco-empty-text){font-family:var(--fonte-principal);font-size:max(9px, calc(14px * var(--escala-texto, 1)));color:var(--text);margin-bottom:5px;}
.tela-banco :deep(.banco-empty-sub){font-family:var(--fonte-principal);font-size:max(9px, calc(12px * var(--escala-texto, 1)));color:var(--muted);}
@media(max-width:600px){
  .tela-banco :deep(.banco-body){padding:16px 12px;}
  .tela-banco :deep(.banco-file-details){display:none;}
  .tela-banco :deep(.banco-dl-btn span){display:none;}
  .tela-banco :deep(.banco-topbar){padding:7px 14px;}
}
</style>
