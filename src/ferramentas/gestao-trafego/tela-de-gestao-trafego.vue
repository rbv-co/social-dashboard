<template>
  <!-- Porte fiel de #gestao-trafego-screen (legacy/index.html L12078-12128) +
       os dois modais que pertencem a esta tela (editor de métricas por
       objetivo, L12131-12143, e "ver criativo", L12145-12149), VERBATIM.
       Mesmo padrão da Gestão à Vista / Análise de Campanhas: root vira
       .tela-gestao-trafego (sem display:none — quem controla a visibilidade
       agora é o vue-router), IDs mantidos (usados por getElementById no JS
       imperativo abaixo). Único onclick trocado por binding Vue: o botão
       "Meta Ads" (Voltar) — closeGestaoTrafego vira @click, e a função por
       trás dele agora também limpa os timers e navega pelo router. Os demais
       onclick="setGtPeriod(this)"/"loadGtData()"/"_gtOpenEditor()"/
       "toggleGtAccPicker()"/"event.stopPropagation()"/"_gtCloseEditor()"/
       "_gtSaveEditor()"/"_gtCloseCriativo()" ficam como STRING literal (igual
       ao legado) — são atributos HTML nativos, avaliados no escopo global;
       por isso o cluster de funções que eles chamam é exposto em window mais
       abaixo. Os dois modais (que no legado são <div> irmãos soltos no body,
       fora de #gestao-trafego-screen) foram colocados DENTRO da raiz deste
       componente — são posicionados via position:fixed, então o lugar deles
       na árvore do DOM não muda o layout visual, e ficar dentro da árvore do
       componente é o que permite ao CSS :deep() (scoped) alcançá-los. -->
  <div class="tela-gestao-trafego">
    <!-- O SUBTITULO E CONTEUDO: diz de quem sao os numeros desta tela.
         Foi trocar isso por um titulo unico que fez a primeira versao
         desta barra ser revertida. -->
    <barra-de-topo voltar="Meta Ads" titulo="Gestão de Tráfego" subtitulo="Meta Ads · Inteligência RBV" @voltar="closeGestaoTrafego">
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
      <div class="gv-period-btns" id="gt-period-btns">
        <button class="gv-pbtn" data-preset="today" onclick="setGtPeriod(this)"><span style="display:inline-block;width:5px;height:5px;border-radius:50%;background:var(--green);margin-right:5px;animation:pulse 2s infinite;vertical-align:middle;flex-shrink:0;"></span>HOJE</button>
        <button class="gv-pbtn" data-preset="1d" onclick="setGtPeriod(this)">1D</button>
        <button class="gv-pbtn" data-preset="7d" onclick="setGtPeriod(this)">7D</button>
        <button class="gv-pbtn" data-preset="14d" onclick="setGtPeriod(this)">14D</button>
        <button class="gv-pbtn" data-preset="30d" onclick="setGtPeriod(this)">30D</button>
        <button class="gv-pbtn" data-preset="monthfull" onclick="setGtPeriod(this)">MÊS</button>
        <button class="gv-pbtn" data-preset="lastmonth" onclick="setGtPeriod(this)">MÊS PASS.</button>
        <button class="gv-pbtn active" data-preset="sofar" onclick="setGtPeriod(this)">ATÉ AGORA</button>
        <button class="gv-pbtn" onclick="loadGtData()" style="border-color:var(--accent);color:var(--accent)">↻</button>
      </div>
      <!-- Funil e KPIs dividem UMA linha no celular. Sozinho, cada um comia uma
           faixa inteira de ~35px, e são dois botões curtos — a conta não fechava
           numa tela de 390px, onde o topo chegava a 206px antes do conteúdo.
           No computador o agrupador não muda nada: a barra já os põe lado a lado.
           Quando o KPIs está escondido (ele depende de permissão), o Funil ocupa
           a linha sozinho, como sempre ocupou. -->
      <div class="gt-dupla">
      <button class="gt-auto-btn" id="gt-funil-btn" onclick="_gtAbrirFunil()" title="Ver o funil das campanhas que estão no ar">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
        <span>Funil</span>
      </button>
      <button class="gt-auto-btn" id="gt-cfg-btn" style="display:none" onclick="_gtOpenEditor()" title="Configurar métricas por objetivo">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        <span>KPIs</span>
      </button>
      </div>
      <div id="gt-account-picker" onclick="event.stopPropagation()" style="position:relative;display:flex;flex-direction:column;align-items:flex-end;gap:3px;flex-shrink:0;">
        <button class="btn" id="gt-acc-trigger" onclick="event.stopPropagation();toggleGtAccPicker()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;opacity:.6"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
          <span id="gt-acc-name" style="font-weight:500;max-width:200px;overflow-wrap:anywhere;">—</span>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <div id="gt-acc-dropdown" style="display:none;position:absolute;top:calc(100% + 6px);right:0;min-width:270px;background:var(--surface);border:1px solid var(--border);border-radius:8px;box-shadow:0 8px 28px rgba(0,0,0,.18);z-index:999;overflow:hidden;max-height:340px;overflow-y:auto;" onclick="event.stopPropagation()"></div>
      </div>
      <div class="gv-clock-wrap" onclick="event.stopPropagation()">
        <span class="live-dot" style="margin-bottom:4px">Tempo Real</span>
        <div class="gv-clock-time" id="gt-clock">--:--:--</div>
        <div class="gv-clock-date" id="gt-date"></div>
        <div class="gv-update-status" id="gt-update-status">—</div>
      </div>
    
    </div>
    </template>
    </barra-de-topo>

    <!-- Casca de abas: só mostra/esconde painel via _gtTrocarAba, nunca
         remonta a lista de campanhas (remontar chamaria a Meta de novo). -->
    <div class="pnd-abas" role="tablist">
      <button class="pnd-aba ativa" id="pnd-aba-campanhas" role="tab" onclick="_gtTrocarAba('campanhas')">Campanhas</button>
      <button class="pnd-aba" id="pnd-aba-fila" role="tab" onclick="_gtTrocarAba('fila')">Fila<span class="pnd-aba-n" id="pnd-fila-n" hidden></span></button>
      <button class="pnd-aba" id="pnd-aba-regua" role="tab" onclick="_gtTrocarAba('regua')">A régua</button>
      <!-- Criar campanha do zero. Fica na barra de abas por ser a única ação da
           tela que NÃO é sobre uma campanha que já existe — pendurá-la num card
           seria dizer que ela depende de um. Só aparece para quem pode editar;
           quem só olha não vê botão que não pode usar. -->
      <button class="pnd-aba-acao" id="gt-btn-nova" role="button" hidden onclick="_gtNovoAbrir()">+ Nova campanha</button>
      <!-- O HISTÓRICO fica colado no "+ Nova campanha" porque é a mesma
           conversa: o que foi começado aqui. Mesmo gate (`hidden` some junto),
           porque quem não pode criar não tem o que ver nesta lista. -->
      <button class="pnd-aba-acao" id="gt-btn-hist" role="button" hidden onclick="_gtHistAbrir()">Histórico</button>
    </div>

    <!-- #gt-painel-campanhas é "display:contents" (ver <style> abaixo): ele só
         existe pra o toggle de aba (_gtTrocarAba liga/desliga com style.display),
         mas NÃO pode virar uma caixa de verdade no layout — .gt-body é quem é o
         item flex real (flex:1 + overflow-y:auto) dentro de .tela-gestao-trafego.
         Um <div> comum aqui quebraria essa conta (flex:1 de .gt-body deixaria de
         valer, e a lista de campanhas perderia o scroll contido). -->
    <div id="gt-painel-campanhas">
      <div class="gt-body">
        <div id="gt-camp-col">
          <div class="gt-camp-card"><div class="gt-empty">Carregando…</div></div>
        </div>
      </div>

      <!-- ── EDITOR DE MÉTRICAS POR OBJETIVO (ADMIN) ── -->
      <div id="gt-cfg-overlay" onclick="_gtCloseEditor()"></div>
      <div id="gt-cfg-modal">
        <div class="gt-cfg-head">
          <span class="gt-cfg-title">⚙️ Métricas por Objetivo</span>
          <button class="gt-cfg-close" onclick="_gtCloseEditor()">✕</button>
        </div>
        <div class="gt-cfg-body" id="gt-cfg-body"></div>
        <div class="gt-cfg-footer">
          <button class="btn" onclick="_gtCloseEditor()">Cancelar</button>
          <button class="btn btn-principal" id="gt-cfg-save-btn" onclick="_gtSaveEditor()">Salvar</button>
        </div>
      </div>

    </div>

    <!-- O MODAL DE CRIATIVO / GASTOS MORA AQUI, FORA DAS ABAS.
         Ele nasceu dentro de #gt-painel-campanhas, e funcionava — porque só era
         aberto pela lista de anúncios, que vive nessa aba. Quando a Fila passou
         a abri-lo (lupa do criativo e botão de gastos), ele parou de aparecer:
         o painel de Campanhas está com display:none enquanto outra aba está
         ativa, e ancestral escondido esconde o filho por mais que se mande
         display:flex nele. O clique rodava, a função rodava, e nada acontecia —
         sem erro nenhum no console.
         Modal é conteúdo de tela inteira: o lugar dele é fora de qualquer aba. -->
    <!-- O ASSISTENTE DE NOVA CAMPANHA, também FORA de qualquer aba. Mesma razão
         do modal de criativo logo abaixo: a troca de aba põe #gt-painel-campanhas
         em display:none, e ancestral escondido esconde o filho por mais que se
         mande display:flex nele. -->
    <div id="gt-novo-ov" onclick="_gtNovoFechar()"></div>
    <div id="gt-novo-modal">
      <div class="gt-cfg-head"><span class="gt-cfg-title" id="gt-novo-titulo">Nova campanha</span><button class="gt-cfg-close" onclick="_gtNovoFechar()">✕</button></div>
      <div id="gt-novo-corpo"></div>
      <div id="gt-novo-rodape"></div>
    </div>

    <div id="gt-cr-overlay" onclick="_gtCloseCriativo()"></div>
    <div id="gt-cr-modal">
      <div class="gt-cfg-head"><span class="gt-cfg-title" id="gt-cr-title">Criativo do anúncio</span><button class="gt-cfg-close" onclick="_gtCloseCriativo()">✕</button></div>
      <div class="gt-cr-body" id="gt-cr-body"></div>
    </div>

    <div id="gt-modal-funil" style="display:none"></div>
    <div id="gt-painel-fila" style="display:none"></div>
<div id="gt-painel-regua" style="display:none"></div>
  </div>
</template>

<script setup>
import { onMounted, onUnmounted } from 'vue'
import BarraDeTopo from '../../compartilhado/barra-de-topo.vue'
import { useRouter } from 'vue-router'
import { sbClient, SUPABASE_URL, SUPABASE_ANON_KEY } from '../../compartilhado/conectar-no-banco-de-dados.js'
import { estado, hasPermission } from '../../compartilhado/controle-de-login-e-usuario.js'
import { adminToast } from '../../compartilhado/avisos.js'
import { sb } from '../../compartilhado/buscar-e-salvar-dados.js'
// Traduz 401/42501 para uma frase que o dono entende. Ver seção 9 do
// PADRAO-DA-CENTRAL: "a tela nunca mente" — e não fala em código de erro.
import { classificarErro } from '../../compartilhado/classificar-erro.js'
import { hojeLocal, diasAtras, primeiroDiaDoMes, ultimoDiaDoMes } from '../../compartilhado/datas.js'
// Decisão "o orçamento é da campanha (CBO) ou dos conjuntos (ABO)?" e o
// agrupamento campanha → conjuntos → anúncios moram num módulo puro, testado
// em orcamento-hierarquia.test.mjs. Aqui só se desenha o resultado.
import { orcamentoDe, detectarNivelOrcamento, podeEditarOrcamentoDaCampanha, podeEditarOrcamentoDoConjunto, montarHierarquia } from './orcamento-hierarquia.js'
import { planoDeCopia, executarPlano, comEspera, retomar, SUFIXO_PADRAO } from './duplicar.js'
import { lerPublico, montarTargeting, resumoDasMudancas, avisosDe } from './publico-alvo.js'
// Os públicos salvos DE VERDADE (`saved_audiences`), que trazem cidade, idade,
// gênero, interesses e comportamentos prontos. Ver publicos-salvos.js para a
// confusão que isto conserta.
import { lerSalvos } from './publicos-salvos.js'
// Sugerir público a partir do que JÁ ACONTECEU nesta conta. A evidência (idade
// por custo, cidades e interesses dos conjuntos que performam) mora em
// sugerir-publico.js, puro e testado com os números reais da conta.
import { lerFaixasDeIdade, lerConjuntos, montarSugestao, escolherAcao, contadorDe, recomendarIdade } from './sugerir-publico.js'
// A leitura das publicações do perfil (tipo, engajamento, miniatura) — puro.
import { lerPublicacoes } from './conteudo-existente.js'
// Os textos que já rodaram, agrupados e com a armadilha das vagas separada —
// ver sugerir-texto.js para o achado que fez esse módulo existir.
import { agruparPorTexto, montarSugestaoDeTexto } from './sugerir-texto.js'
// Rascunho que sobrevive a fechar a aba, e o histórico do que foi criado ou
// recusado. As regras (o que vale salvar, quando mudou, como cada linha é dita)
// moram em rascunhos.js; aqui fica só o que precisa de banco.
import { valeSalvar, mudou as rascunhoMudou, linhaParaSalvar, montarHistorico, rascunhoParaRetomar } from './rascunhos.js'
import { montarSecaoPosicionamentos } from './posicionamentos.js'
import { montarFaixaDeSugestoes } from './sugestoes-de-interesse.js'
// Aba "A régua" (métrica ponderada): painel puro + os módulos que leem/normalizam
// a régua vinda do banco (ver painel-regua.js, ponderada.js, regua.js).
import { montarPainelRegua } from './painel-regua.js'
// A FILA: o que o robô propôs e ainda espera decisão. As regras (o que entra, o
// silêncio de 7 dias, a repartição por conjunto) moram em fila.js, puro e
// testado; painel-fila.js só monta a tela.
import { montarPainelFila } from './painel-fila.js'
import { resumoDoRobo, fraseDaFilaVazia } from './fila.js'
import { limparPersona, resumoPersona, fraseDaPersona, MAXIMO as PERSONA_MAXIMO } from './persona-da-marca.js'
import { tipoDoArquivo, textoDoDocx, pareceTexto } from './ler-arquivo-de-texto.js'
import { montarMapa } from './painel-do-mapa.js'
// ESCOLHER LUGAR (13/08/2026): o painel é compartilhado com o "Subir para a
// Meta" da Fábrica — uma peça só, para o dono escolher lugar do mesmo jeito nos
// dois lugares.
import { montarPainelDeLugares } from '../../compartilhado/painel-de-lugares.js'
import { deListas, paraListas } from '../../compartilhado/lugares-do-anuncio.js'
import { enderecoDeOndeCaiu } from '../../compartilhado/busca-de-lugar.js'
import { agruparProblemas, anunciosComProblema, fraseDosProblemas, linhasParaGuardar } from './problemas-do-anuncio.js'
import { montarLeituraDePublico, publicoDaReceita } from './leitura-de-publico.js'
import { PUBLICO_VAZIO } from './publico-alvo.js'
// A LISTA do histórico de campanhas começadas por aqui. As regras de leitura
// moram em rascunhos.js; este só desenha (e escapa tudo que vem de fora).
import { montarPainelHistorico, marcarQuemPodeApagar } from './painel-historico.js'
// COMO a sugestão é dita: manchete, comparação e prosa em planos diferentes.
// O que ela é continua saindo de sugerir-publico.js.
import { manchete, comparacao, repetidos, paragrafosDaLeitura } from './apresentar-sugestao.js'
import { montarAssistente, textoDaConfirmacao } from './assistente-campanha.js'
import { estadoInicial, imagemServe, payloadsDoAssistente, numerosJaUsados, criativaDoAssistente, PASSOS } from './criar-campanha.js'
// O CATÁLOGO DE SUB-OBJETIVOS: a Meta tem dois níveis (objetivo da campanha e
// meta de otimização do conjunto) e a tela tratava como um só. Ver subobjetivos.js.
import { CATALOGO, marcarUsados, acharSubobjetivo, usaPublicacao } from './subobjetivos.js'
import { carregarMarcasELojas } from '../../../coletor/lib/config-lojas.mjs'
import { lerGastos, linhasDoModal, usoDoOrcamento } from './gastos-da-fila.js'
// O funil das campanhas NO AR, um bloco por objetivo. Nem todo objetivo tem
// funil de verdade — ver funil.js.
import { montarPainelFunil } from './painel-funil.js'
import { LEITURA } from './funil.js'
import { montarFila, distribuirEntreConjuntos, mesclarSaude, anexarCriativos, DIAS_DE_SILENCIO } from './fila.js'
// A leitura de SAÚDE (fadiga de audiência, criativo que não conecta) — volta a
// ter lugar, agora dentro da Fila e grudada na sugestão do robô. Ver saude.js.
import { lerSaude, categoriaDoObjetivo, contradiz } from './saude.js'
// "Está rodando?" NÃO é effective_status === 'ACTIVE': a Meta mantém ACTIVE em
// campanha que já chegou ao fim do período. Ver veiculacao.js.
import { emVeiculacao } from './veiculacao.js'
import { orcamentoEfetivoDaCampanha } from './orcamento-hierarquia.js'
// Objetivo -> balde e "e de WhatsApp?" moram num modulo so porque o ROBO precisa
// da mesma resposta que a tela (ver baldes.js).
import { baldeDoObjetivo, ehDeWhatsapp, baldeEfetivo } from './baldes.js'
import { normalizarRegua, metaDoBalde, reguaDaConta, mesclarMetasDaConta } from './regua.js'
import { quantidadesDoInsight, calcularPonderada } from './ponderada.js'
// Alvo de cada tipo de campanha (custo por lead/conversa/venda/visita/mil
// pessoas, ou por ponto no caso de engajamento) — ver alvos.js.
import { alvoDoBalde, avaliarAlvo } from './alvos.js'
// Fase 3 — objetivo por interação: o dono DECLARA, campanha a campanha (ou
// anúncio a anúncio) de engajamento, qual interação aquilo está comprando
// (curtida/comentário/salvamento/compartilhamento). Sem declarar, nada muda —
// continua no ponto ponderado, exatamente como hoje. Ver interacoes.js.
import { INTERACOES, custoDaInteracao, interacaoValida } from './interacoes.js'
// Glossário da ferramenta (botões "?" de ajuda contextual) — ver ajuda.js pro
// porquê disto existir. PURO: só dicionário titulo/texto, sem tela nem rede.
import { ajudaDe } from './ajuda.js'

const router = useRouter()

const logoClaroUrl = '/midia/LOGOTIPOBRENOPRETO.png'
const logoEscuroUrl = '/midia/LOGOTIPOBRENOBRANCO.png'

// ==========================================================================
// PORTE VERBATIM da Gestão de Tráfego (legacy/index.html — funções e estado
// espalhados entre L7768-8594), menos openGestaoTrafego/closeGestaoTrafego,
// que viraram onMounted/closeGestaoTrafego(cleanup+router) abaixo, e o
// listener de fechar o dropdown de contas (documento inteiro), que virou
// addEventListener/removeEventListener em onMounted/onUnmounted em vez de
// rodar sempre solto no escopo global do monólito.
//
// ATENÇÃO — esta tela EXECUTA AÇÕES REAIS em campanhas/anúncios ao vivo na
// Meta (pausar, reativar, mudar orçamento) através de _gtApplyAction/metaPost.
// Toda ação passa por _gtConfirm(...) antes de chamar metaPost — esse gate
// foi preservado intacto, idêntico ao legado (ver auditoria no fim deste
// bloco de comentário, e o relatório em .superpowers/sdd/gt-port-report.md).
//
// Dependências externas resolvidas:
//   - sbClient, SUPABASE_URL, SUPABASE_ANON_KEY → import (conectar-no-banco-de-dados.js)
//   - hasPermission                              → import (controle-de-login-e-usuario.js)
//   - adminToast                                 → import (avisos.js)
//   - sb                                         → import (buscar-e-salvar-dados.js) — helper
//     de leitura REST já extraído para o miolo compartilhado (idêntico ao sb()
//     do legado, legacy L3356, só troca currentSession por estado.currentSession);
//     reaproveitado aqui em vez de copiado de novo (usado por
//     _gtLoadConfig).
//   - estado.currentSession                      → substitui a global solta `currentSession`
//     do legado, usada dentro de adTok()/metaFetch()/metaPost() (legacy L3358/8508/8570).
//   - metaFetch, metaFetchAll, metaPost, adFetch, adTok, _maCleanAccId,
//     _maFmtR, _maFmt, _maFmtPct, _maObjLabel → COPIADOS abaixo (helpers do
//     legado que este módulo usa e que ainda não têm um lugar compartilhado no
//     Vue; ver legacy L8569, L8584, L8507, L4376, L8920, L8943, L8953-8955,
//     L507-510 do porte de Análise de Campanhas). escHtml e fmtR (legacy
//     L4851/L3394) foram conferidos por grep no bloco inteiro (L7768-8594) e
//     NÃO são usados pela Gestão de Tráfego (ela usa só _gtEsc/_maFmtR) —
//     por isso não foram copiados (evitar código morto).
//   - _maAccounts/_maCurAcc (globais da Análise de Campanhas, outro módulo,
//     inexistentes aqui) → SUBSTITUÍDOS por uma lista própria da Gestão de
//     Tráfego, _gtAccounts (_gtCurAcc já existia no legado). _buildGtDropdown
//     e _initGestaoTrafego foram ajustados para usar _gtAccounts em vez de
//     _maAccounts — a linha `_maCurAcc=_maCurAcc||_gtCurAcc` (sincronismo
//     entre os dois módulos dentro do monólito) foi removida: não existe mais
//     "o outro módulo" para sincronizar, cada tela Vue é independente.
//
// Nada foi reescrito para template reativo — o board de campanhas (#gt-camp-col)
// e os dois modais seguem montados via getElementById/createElement/innerHTML,
// exatamente como a produção atual. Por isso todo o cluster de funções GT
// usadas em onclick="..." (no <template> acima) é exposto em window no fim
// deste bloco. Conferido por grep: dentro do HTML gerado em runtime
// (_renderGtCampaigns/_renderGtAds/_buildGtDropdown/_gtConfirm)
// NENHUMA função é chamada por onclick="..." literal — todas usam
// addEventListener ou atribuição direta a .onclick (closures em escopo de
// módulo), então não precisam ser expostas em window.
// ==========================================================================

/* ── Helpers copiados do legado (self-contidos) ── */
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
async function metaPost(path,params,accountId){
  const{data:{session}}=await sbClient.auth.getSession();
  // Nem chegou a sair do navegador — mesma certeza de um pedido barrado no
  // proxy: nada foi gravado. Ver a classificação logo abaixo.
  if(!session){const semSessao=new Error('Não autenticado');semSessao.naoChegouNaMeta=true;throw semSessao;}
  const r=await fetch(SUPABASE_URL+'/functions/v1/meta-proxy',{
    method:'POST',
    headers:{'Authorization':'Bearer '+session.access_token,'apikey':SUPABASE_ANON_KEY,'Content-Type':'application/json'},
    body:JSON.stringify({accountId,path,params,method:'POST'})
  });
  const d=await r.json();
  if(d&&d.error){
    // A EXPLICAÇÃO DA META VAI JUNTO NA MENSAGEM, e não só o `message`.
    //
    // `message` costuma ser genérico ("Invalid parameter", "(#200) Permissions
    // error"). Quem diz o que houve é `error_user_title`/`error_user_msg`, em
    // português e já escrito para quem lê. Jogar os dois fora fazia a tela
    // mostrar "A Meta recusou: Invalid parameter" — verdadeiro e inútil.
    //
    // Vai na MENSAGEM (não numa propriedade) porque quem trata a falha em
    // duplicar.js guarda `String(e.message || e)`: propriedade extra se perderia
    // no caminho.
    const eMeta=d.error||{};
    const partes=[(eMeta.message)||d.error||'Meta API error'];
    if(eMeta.error_user_title)partes.push('— '+eMeta.error_user_title);
    if(eMeta.error_user_msg)partes.push(': '+eMeta.error_user_msg);
    const err=new Error(partes.join(' '));
    // TRÊS COISAS BEM DIFERENTES chegam por aqui, e duas delas provam que nada
    // foi gravado. Quem chama precisa saber qual é antes de prometer alguma
    // coisa ao dono numa conta ao vivo:
    //
    //  1. A META RESPONDEU RECUSANDO → o corpo é o pacote de erro do Graph, um
    //     OBJETO com message/code. A gravação não aconteceu, ponto.
    //  2. O PEDIDO NEM SAIU DO PROXY → o meta-proxy barra antes de falar com a
    //     Meta (sem sessão, sem permissão, conta sem token, pedido incompleto)
    //     e devolve o motivo como STRING, com status abaixo de 500. Também não
    //     foi gravado nada — e aqui dá pra dizer isso com certeza.
    //  3. O PROXY DESISTIU NO MEIO → ele aborta a chamada à Meta em 15s (ou
    //     estoura por outro motivo) e devolve STRING com status 500. Esse é o
    //     único caso incerto: a Meta pode muito bem ter processado o pedido, e
    //     afirmar "nada foi alterado" seria mentir.
    const corpoDeErroDaMeta=!!(d.error&&typeof d.error==='object'&&(d.error.message!=null||d.error.code!=null));
    err.metaRecusou=corpoDeErroDaMeta;
    err.naoChegouNaMeta=!corpoDeErroDaMeta&&r.status<500;
    throw err;
  }
  return d;
}
function _maCleanAccId(id){return String(id||'').replace(/^act_/,'');}
function _maFmtR(v){if(!v&&v!==0)return'—';const n=parseFloat(v);if(n>=1000)return'R$'+n.toLocaleString('pt-BR',{minimumFractionDigits:0,maximumFractionDigits:0});return'R$'+n.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});}
function _maFmt(v,dec=0){if(!v&&v!==0)return'—';return parseFloat(v).toLocaleString('pt-BR',{minimumFractionDigits:dec,maximumFractionDigits:dec});}
function _maFmtPct(v){return parseFloat(v||0).toFixed(2)+'%';}
function _maObjLabel(obj){
  const m={OUTCOME_TRAFFIC:'Tráfego',OUTCOME_ENGAGEMENT:'Engajamento',OUTCOME_LEADS:'Leads',OUTCOME_SALES:'Vendas',OUTCOME_AWARENESS:'Reconhecimento',LINK_CLICKS:'Cliques',PAGE_LIKES:'Curtidas',VIDEO_VIEWS:'Vídeo'};
  return m[obj]||(obj||'—');
}

/* ── GESTÃO DE TRÁFEGO — estado do módulo (legacy L7768-7776, verbatim,
   exceto _gtAccounts, que substitui a global _maAccounts do legado — ver
   nota de dependências acima) ── */
let _gtPreset='sofar';
// Filtro por OBJETIVO na lista de campanhas. Vazio = todos. Cada conta roda um
// conjunto diferente de objetivos, então os botões são montados a partir do que
// a conta REALMENTE tem — não de uma lista fixa que mostraria "Vendas 0" nas
// cinco contas.
let _gtFiltroObjetivo='';
let _gtCurAcc=null;
let _gtAccounts=[];
let _gtLastLoadTime=null;
let _gtStatusTimer=null;
let _gtClockTimer=null;
let _gtPickerOpen=false;
let _gtCampaigns=[];
let _gtInsights=[];
let _gtAdInsights=[];
let _gtAdsets=[];        // conjuntos de anúncios da conta (Graph /adsets), com o orçamento de cada um
let _gtRecolhido=false;  // botão "recolher/expandir tudo": estado padrão dos painéis ao (re)desenhar
let _gtStatusFilter='all';
let _gtAbaAtiva='campanhas';
// Seleção múltipla para PAUSAR EM MASSA. Mora FORA do render de propósito: a
// lista é redesenhada a cada busca/filtro/recolher, e uma seleção guardada
// dentro do render sumiria sozinha no meio do trabalho.
// Chave 'campaign:<id>' | 'ad:<id>' -> { kind, id, nome }.
// Só entra aqui o que está ATIVO: a ação em massa só FREIA (decisão do dono,
// 2026-07-27) — reativar continua sendo um a um, com confirmação individual.
let _gtSelecao=new Map();
// Objetivo por interação (Fase 3): mapa alvo_id (campanha OU anúncio) ->
// interação declarada ('curtidas'|'comentarios'|'salvamentos'|'compartilhamentos').
// Sem entrada = não declarou = continua no ponto ponderado. Carregado uma vez
// por loadGtData() (ver _gtCarregarObjetivos), igual à régua e ao Opus IA.
let _gtObjetivoInteracao={};
// Fail-CLOSED (M3 do review, 2026-07-28), mesmo padrão de _gtReguaCarregada:
// só fica true depois de uma leitura que REALMENTE deu certo. Enquanto for
// false, um alvo AUSENTE do mapa não pode virar "Objetivo: ponderado" com
// confiança — pode ser que exista uma declaração real no banco que esta
// leitura, ao falhar, não trouxe. Ver _gtCarregarObjetivos e _gtSeloObjetivoEl.
let _gtObjetivoInteracaoCarregada=false;

/* ── Zoom de fonte (legacy L7789-7805, verbatim) ── */
function _gtFontScale(){
  const screen=document.querySelector('.tela-gestao-trafego');if(!screen)return;
  const K='rbv-gtfs';
  let z=parseFloat(localStorage.getItem(K));if(!(z>=0.9&&z<=2.5))z=1.3;
  let ctl=screen.querySelector(':scope > .zoomctl');
  const apply=()=>{screen.style.setProperty('--gt-fs',String(z));document.documentElement.style.setProperty('--gt-fs',String(z));try{localStorage.setItem(K,String(z));}catch(e){}const v=ctl&&ctl.querySelector('.zoomctl-val');if(v)v.textContent=Math.round(z*100)+'%';};
  if(!ctl){
    ctl=document.createElement('div');ctl.className='zoomctl';
    const mk=(t,title,fn)=>{const b=document.createElement('button');b.type='button';b.textContent=t;b.title=title;b.onclick=fn;return b;};
    ctl.appendChild(mk('A−','Diminuir fonte',()=>{z=Math.max(0.9,Math.round((z-0.1)*10)/10);apply();}));
    const val=document.createElement('span');val.className='zoomctl-val';val.title='Restaurar padrão (130%)';val.onclick=()=>{z=1.3;apply();};
    ctl.appendChild(val);
    ctl.appendChild(mk('A+','Aumentar fonte',()=>{z=Math.min(2.5,Math.round((z+0.1)*10)/10);apply();}));
    screen.appendChild(ctl);
  }
  apply();
}

/* ── Relógio / status de atualização (legacy L7814-7832, verbatim) ── */
function startGtClock(){
  const tEl=document.getElementById('gt-clock'),dEl=document.getElementById('gt-date');
  if(!tEl)return;
  const tick=()=>{
    const now=new Date();
    tEl.textContent=String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0')+':'+String(now.getSeconds()).padStart(2,'0');
    if(dEl){const ds=now.toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'long'});dEl.textContent=ds.toUpperCase();}
  };
  tick();if(_gtClockTimer)clearInterval(_gtClockTimer);
  _gtClockTimer=setInterval(tick,1000);
}
function updateGtUpdateStatus(){
  const el=document.getElementById('gt-update-status');if(!el)return;
  if(!_gtLastLoadTime){el.textContent='—';return;}
  const pad=n=>String(n).padStart(2,'0');
  const fmt=d=>`${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const next=new Date(_gtLastLoadTime.getTime()+5*60*1000);
  el.textContent=`ULT. ${fmt(_gtLastLoadTime)} · PRÓX. ${fmt(next)}`;
}

/* ── Período / seletor de conta (legacy L7833-7858, verbatim, exceto
   _buildGtDropdown, que usa _gtAccounts em vez de _maAccounts) ── */
function setGtPeriod(btn){
  document.querySelectorAll('#gt-period-btns .gv-pbtn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  _gtPreset=btn.dataset.preset;
  loadGtData();
}
function toggleGtAccPicker(){
  _gtPickerOpen=!_gtPickerOpen;
  const d=document.getElementById('gt-acc-dropdown');if(d)d.style.display=_gtPickerOpen?'block':'none';
}
// No legado este listener era registrado uma vez, solto, no carregamento do
// script inteiro (document.addEventListener('click',()=>{...}), legacy L7843).
// Aqui vira uma função nomeada, amarrada ao ciclo de vida do componente
// (addEventListener/removeEventListener em onMounted/onUnmounted mais abaixo)
// — mesmo padrão já usado no porte da Análise de Campanhas (_maDocClick).
function _gtDocClick(){
  _gtPickerOpen=false;
  const d=document.getElementById('gt-acc-dropdown');if(d)d.style.display='none';
}
function _buildGtDropdown(){
  const drop=document.getElementById('gt-acc-dropdown');if(!drop)return;
  drop.innerHTML='';
  _gtAccounts.forEach((a,idx)=>{
    const bal=a.balance;
    // Pré-pago: mostra o saldo (verde=folgado, âmbar=apertando, vermelho=baixo). Sem pré-pago
    // (cartão): mostra a nota, não um número.
    const balTxt=bal!=null?_maFmtR(bal):(a.notaSaldo||'—');
    const balColor=bal==null?'var(--muted)':bal>=1000?'var(--green)':bal>=500?'var(--orange)':'var(--red)';
    const item=document.createElement('div');
    item.style.cssText='padding:10px 14px;cursor:pointer;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px;transition:background .12s;';
    item.addEventListener('mouseenter',()=>item.style.background='var(--surface2)');
    item.addEventListener('mouseleave',()=>item.style.background='');
    item.innerHTML=`<span style="font-family:var(--fonte-principal);font-size:calc(11px*var(--gt-fs,1.3));color:var(--muted);min-width:18px;">${idx+1}</span><div style="flex:1;min-width:0;"><div style="font-family:var(--fonte-principal);font-size:calc(12px*var(--gt-fs,1.3));font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${a.display_name||a.name||'Conta '+idx}</div><div style="font-family:var(--fonte-principal);font-size:calc(10px*var(--gt-fs,1.3));color:var(--muted);">${_maFmt(a.monthSpend||0,0)} gastos / mês</div></div><div style="font-family:var(--fonte-principal);font-size:calc(13px*var(--gt-fs,1.3));font-weight:700;color:${balColor};flex-shrink:0;">${balTxt}</div>`;
    item.addEventListener('click',e=>{e.stopPropagation();_gtCurAcc=a;const nm=document.getElementById('gt-acc-name');if(nm)nm.textContent=a.display_name||a.name||'—';_gtPickerOpen=false;const d=document.getElementById('gt-acc-dropdown');if(d)d.style.display='none';loadGtData();});
    drop.appendChild(item);
  });
}
async function _initGestaoTrafego(){
  const col=document.getElementById('gt-camp-col');
  const setLbl=t=>{if(col)col.innerHTML=`<div class="gv-loading-screen"><div class="gv-spinner"></div><span class="gv-loading-lbl">${t}</span></div>`;};
  setLbl('Carregando contas…');
  try{
    // Antes aqui era `adFetch(...)` seguido de `await res.json()` SEM olhar o
    // status. Quando o banco recusava a leitura, o corpo da resposta era um
    // OBJETO de erro (`{code:'42501',...}`), não uma lista — e o `for...of`
    // logo abaixo estourava com "g is not iterable" (o "g" é o nome desta
    // variável depois de minificada). O dono via jargão de programador no lugar
    // do motivo. Aconteceu de verdade em 13/08: a coluna `persona` tinha sido
    // criada sem GRANT de leitura, e UMA coluna sem permissão derruba a linha
    // inteira no PostgREST.
    //
    // Duas trocas, e cada uma conserta uma metade:
    //  - `sbClient` no lugar do adFetch: o adFetch monta o token na mão a partir
    //    de `estado.currentSession`, que é uma FOTO tirada no login; o sbClient
    //    renova o token sozinho. Também é o que manda a seção 9 do
    //    PADRAO-DA-CENTRAL — e de propósito não é o `sb()` desta base, que cai
    //    na chave anônima e devolve lista vazia calada.
    //  - o erro passa por `classificarErro`: a tela diz "sua sessão expirou" ou
    //    "você não tem permissão", nunca "42501". O detalhe técnico vai pro
    //    console, que é de quem conserta.
    const {data:socialAccs,error:erroContas,status:statusContas}=await sbClient
      .from('accounts')
      .select('id,name,ad_account_id,profile_picture_url,picture_url,persona')
      .order('name');
    if(erroContas){
      console.error('[GT] o banco recusou a lista de contas:',erroContas);
      throw new Error(classificarErro(statusContas,erroContas).mensagem);
    }
    // Cinto de segurança: o que não for lista não entra no `for...of` abaixo.
    if(!Array.isArray(socialAccs))throw new Error('O banco não devolveu a lista de contas.');
    const seen=new Set();
    const accs=[];
    // Step 1 — accounts with ad_account_id explicitly in Supabase
    for(const acc of socialAccs){
      if(!acc.ad_account_id)continue;
      const cid=_maCleanAccId(acc.ad_account_id);
      if(seen.has(cid))continue;seen.add(cid);
      accs.push({...acc,ad_account_id:cid,display_name:acc.name,monthSpend:0,balance:null});
    }
    // Step 2 — discover remaining ad accounts via /me/adaccounts (token lives in meta-proxy).
    // Any account row works as proxy carrier: meta-proxy resolves the shared token from accounts.id.
    const carrierId=socialAccs.find(a=>a.id)?.id||null;
    if(carrierId){
      const adAccPhotoMap={};
      socialAccs.forEach(a=>{if(a.ad_account_id&&(a.profile_picture_url||a.picture_url))adAccPhotoMap[_maCleanAccId(a.ad_account_id)]=a.profile_picture_url||a.picture_url;});
      try{
        const d=await metaFetch('/me/adaccounts',{fields:'id,name,account_status,currency'},carrierId);
        for(const adAcc of(d?.data||[])){
          const cid=_maCleanAccId(adAcc.id);
          if(seen.has(cid))continue;seen.add(cid);
          accs.push({id:carrierId,name:adAcc.name,ad_account_id:cid,display_name:adAcc.name,currency:adAcc.currency,account_status:adAcc.account_status,profile_picture_url:adAccPhotoMap[cid]||'',picture_url:'',monthSpend:0,balance:null});
        }
      }catch(e){console.warn('[GT] /me/adaccounts discovery failed:',e.message);}
    }
    if(!accs.length){
      if(col)col.innerHTML='<div class="gt-camp-card"><div class="gt-empty">Nenhuma conta de anúncios encontrada.</div></div>';
      return;
    }
    setLbl(`Calculando gastos de ${accs.length} conta${accs.length!==1?'s':''}…`);
    await Promise.all(accs.map(async a=>{
      try{
        const [d,sp]=await Promise.all([
          metaFetch(`/act_${a.ad_account_id}`,{fields:'name,currency,funding_source_details{type,display_string}'},a.id),
          metaFetch(`/act_${a.ad_account_id}/insights`,{fields:'spend',date_preset:'this_month'},a.id).catch(()=>null),
        ]);
        if(d?.name)a.display_name=d.name;
        // SALDO = quanto de dinheiro a conta ainda TEM pra gastar. O número real vem do
        // "Saldo disponível" do meio de pagamento (funding_source_details.display_string),
        // ex.: "Saldo disponível (R$6.345,70 BRL)". NÃO é o campo `balance` (esse é gasto não
        // faturado, dava R$550 enganoso) nem limite−gasto (dava aproximado errado).
        // Só contas PRÉ-PAGAS têm saldo. Cartão de crédito (pós-pago) não tem — mostra a forma
        // de pagamento em vez de um número.
        const fsd=d?.funding_source_details||{};
        const ds=fsd.display_string||'';
        const m=ds.match(/R\$\s*([\d.]+,\d{2})/); // formato BR: 6.345,70
        if(m){ a.balance=parseFloat(m[1].replace(/\./g,'').replace(',','.')); a.notaSaldo=null; }
        else { a.balance=null; a.notaSaldo=ds?('via '+ds):'sem saldo pré-pago'; } // cartão/sem pré-pago
        if(d?.currency)a.currency=d.currency;
        a.monthSpend=parseFloat(sp?.data?.[0]?.spend||0);
      }catch(e){a.monthSpend=0;}
    }));
    accs.sort((a,b)=>(b.monthSpend||0)-(a.monthSpend||0));
    _gtAccounts.length=0;
    _gtAccounts.push(...accs);
    _gtCurAcc=_gtAccounts[0];
    const nm=document.getElementById('gt-acc-name');
    if(nm)nm.textContent=_gtCurAcc?.display_name||_gtCurAcc?.name||'—';
    _buildGtDropdown();
    // A fila dispara AQUI, assim que as contas existem — não depois do
    // `await loadGtData()` abaixo, que ainda vai buscar campanhas, anúncios e
    // insights da conta selecionada. Ela varre as cinco contas por conta
    // própria e não precisa esperar nada disso; deixá-la pra depois só atrasaria
    // o contador da aba. Sem `await` de propósito: uma falha nela não pode
    // derrubar o carregamento da tela.
    _gtCarregarFila();
    await loadGtData();
  }catch(e){
    if(col)col.innerHTML=`<div class="gt-camp-card"><div class="gt-empty">Erro ao carregar contas:<br>${e.message}</div></div>`;
  }
}

/* ── GT: CATÁLOGO DE MÉTRICAS POR OBJETIVO (legacy L7920-7966, verbatim) ── */
function _gtNum(x){ const n=Number(x); return isFinite(n)?n:null; }
function _gtActionVal(row, tipos){
  const arr=row&&row.actions; if(!Array.isArray(arr))return null;
  for(const t of tipos){ const a=arr.find(x=>x.action_type===t); if(a)return _gtNum(a.value); }
  return null;
}
function _gtActionValue(row, tipos){
  const arr=row&&row.action_values; if(!Array.isArray(arr))return null;
  for(const t of tipos){ const a=arr.find(x=>x.action_type===t); if(a)return _gtNum(a.value); }
  return null;
}
const _GT_PURCHASE=['purchase','omni_purchase','offsite_conversion.fb_pixel_purchase'];
const _GT_LEAD=['lead','onsite_conversion.lead_grouped','offsite_conversion.fb_pixel_lead'];
const _GT_VISIT=['landing_page_view','link_click'];
// Mensagens (WhatsApp/Direct): action_types REAIS conferidos na API (La Vessel I, 2026-07).
// "Conversas iniciadas" é o messaging_conversation_started_7d — o resultado principal das
// campanhas de mensagem (WhatsApp). Os outros são etapas mais fundas da conversa.
const _GT_MSG=['onsite_conversion.messaging_conversation_started_7d','onsite_conversion.messaging_conversation_started'];
const _GT_MSG_CONN=['onsite_conversion.total_messaging_connection'];
const _GT_MSG_REPLY=['onsite_conversion.messaging_first_reply'];
const _GT_ATC=['add_to_cart','omni_add_to_cart','offsite_conversion.fb_pixel_add_to_cart'];
const _GT_IC=['initiate_checkout','omni_initiated_checkout','offsite_conversion.fb_pixel_initiate_checkout'];
const _GT_VIDEO=['video_view'];
const _GT_POSTENG=['post_engagement'];
const _GT_LPV=['landing_page_view'];
const _gtPerGasto=(r,tipos)=>{ const n=_gtActionVal(r,tipos),s=_gtNum(r.spend); return n?s/n:null; };
const GT_METRIC_CATALOG={
  alcance:{label:'Alcance',fmt:'int',compute:r=>_gtNum(r.reach)},
  impressoes:{label:'Impressões',fmt:'int',compute:r=>_gtNum(r.impressions)},
  frequencia:{label:'Frequência',fmt:'dec',compute:r=>_gtNum(r.frequency)},
  ctr:{label:'CTR',fmt:'pct',compute:r=>_gtNum(r.ctr)},
  cpc:{label:'CPC',fmt:'money',compute:r=>_gtNum(r.cpc)},
  cpm:{label:'CPM',fmt:'money',compute:r=>{const i=_gtNum(r.impressions),s=_gtNum(r.spend);return i?s/i*1000:null;}},
  cliques:{label:'Cliques',fmt:'int',compute:r=>_gtNum(r.clicks)},
  visitas:{label:'Visitas',fmt:'int',compute:r=>_gtActionVal(r,_GT_VISIT)},
  custo_visita:{label:'Custo/Visita',fmt:'money',compute:r=>_gtPerGasto(r,_GT_VISIT)},
  lpv:{label:'Visualizações da página',fmt:'int',compute:r=>_gtActionVal(r,_GT_LPV)},
  compras:{label:'Compras',fmt:'int',compute:r=>_gtActionVal(r,_GT_PURCHASE)},
  valor_conversao:{label:'Valor de conversão',fmt:'money',compute:r=>_gtActionValue(r,_GT_PURCHASE)},
  roas:{label:'ROAS',fmt:'x',compute:r=>{const pr=r.purchase_roas&&r.purchase_roas[0]&&_gtNum(r.purchase_roas[0].value);if(pr!=null)return pr;const v=_gtActionValue(r,_GT_PURCHASE),s=_gtNum(r.spend);return (v!=null&&s)?v/s:null;}},
  cac:{label:'CAC',fmt:'money',compute:r=>{const c=_gtActionVal(r,_GT_PURCHASE),s=_gtNum(r.spend);return c?s/c:null;}},
  add_carrinho:{label:'Add. ao carrinho',fmt:'int',compute:r=>_gtActionVal(r,_GT_ATC)},
  checkout:{label:'Checkout iniciado',fmt:'int',compute:r=>_gtActionVal(r,_GT_IC)},
  gasto:{label:'Gasto',fmt:'money',compute:r=>_gtNum(r.spend)},
  leads:{label:'Leads',fmt:'int',compute:r=>_gtActionVal(r,_GT_LEAD)},
  custo_lead:{label:'Custo/Lead',fmt:'money',compute:r=>{const l=_gtActionVal(r,_GT_LEAD),s=_gtNum(r.spend);return l?s/l:null;}},
  // --- Mensagens (WhatsApp/Direct) ---
  conversas:{label:'Conversas iniciadas',fmt:'int',compute:r=>_gtActionVal(r,_GT_MSG)},
  custo_conversa:{label:'Custo/Conversa',fmt:'money',compute:r=>_gtPerGasto(r,_GT_MSG)},
  conexoes_msg:{label:'Conexões de mensagem',fmt:'int',compute:r=>_gtActionVal(r,_GT_MSG_CONN)},
  primeira_resposta:{label:'1ª resposta',fmt:'int',compute:r=>_gtActionVal(r,_GT_MSG_REPLY)},
  // --- Vídeo e engajamento ---
  video_views:{label:'Views de vídeo',fmt:'int',compute:r=>_gtActionVal(r,_GT_VIDEO)},
  engaj_pub:{label:'Engajamento da publicação',fmt:'int',compute:r=>_gtActionVal(r,_GT_POSTENG)},
};
const GT_BALDE_PADRAO={
  // custo_visita é a métrica que DECIDE o veredito deste balde (ver alvos.js
  // ALVOS.trafego) — precisa aparecer no cartão, senão o dono vê o selo mudar
  // sem enxergar o número que o explica (I6 do review final, 2026-07-28).
  trafego:['ctr','cpc','visitas','custo_visita','cpm'],
  vendas:['roas','cac','valor_conversao','compras'],
  reconhecimento:['alcance','cpm','frequencia','impressoes'],
  // Conversas iniciadas primeiro: é o resultado principal das campanhas de WhatsApp (La Vessel I).
  // Em campanha de engajamento sem mensagem, "conversas" aparece como "—" (sem ação de mensagem).
  engajamento:['conversas','custo_conversa','ctr','gasto'],
  mensagens:['conversas','custo_conversa','conexoes_msg','gasto'],
  leads:['leads','custo_lead','ctr','gasto'],
  padrao:['ctr','cpc','gasto','alcance'],
};
function _gtBalde(objective){ return baldeDoObjetivo(objective); }
function _gtMetricValue(key,row){ const m=GT_METRIC_CATALOG[key]; return m?m.compute(row):null; }
let _gtConfig={};
let _gtConfigLoaded=false;
async function _gtLoadConfig(){
  try{
    const rows=await sb('gt_config_metricas?select=balde,metricas');
    _gtConfig={};
    (rows||[]).forEach(r=>{ if(Array.isArray(r.metricas)) _gtConfig[r.balde]=r.metricas; });
  }catch(e){ _gtConfig={}; }
}
// Declarações de objetivo por interação (Fase 3). sb() NUNCA lança — devolve
// [] com .erro em qualquer falha (rede, sessão, RLS); aqui basta checar
// linhas.erro antes de usar (mesmo padrão de _gtCarregarRegua/_gtLoadConfig).
async function _gtCarregarObjetivos(){
  const linhas=await sb('gt_objetivo_interacao?select=alvo_id,interacao');
  const ok=!linhas.erro;
  if(ok){
    _gtObjetivoInteracao={};
    for(const l of linhas) _gtObjetivoInteracao[String(l.alvo_id)]=l.interacao;
  }else{
    // NUNCA apagar o mapa em silêncio (M3 do review, 2026-07-28): se a leitura
    // falhar, o mapa anterior (as declarações que já sabíamos ser verdade)
    // fica exatamente como estava — é o que impede uma campanha DECLARADA de
    // voltar sozinha a ser julgada pelo ponto ponderado só porque um recarregar
    // deu erro de rede/sessão. O detalhe técnico vai pro console; o selo (ver
    // _gtSeloObjetivoEl) trata a incerteza pra quem só usa esta variável.
    console.error('[GT] falha ao carregar as declarações de objetivo por interação:', linhas.erro);
  }
  _gtObjetivoInteracaoCarregada=ok;
}
// Grava (ou apaga, se interacao=null/undefined) a declaração de UMA campanha ou
// UM anúncio. Escrita autenticada por sbClient (RLS: admin OU feature
// 'meta.gestor', igual à régua) — nunca por sb(), que é só leitura.
async function _gtSalvarObjetivo(alvoId,nivel,interacao){
  const resp=interacao
    ?await sbClient.from('gt_objetivo_interacao').upsert({
        alvo_id:String(alvoId),nivel,interacao,
        conta_id:_gtCurAcc?.id||null,updated_by:estado.userId||null,
        updated_at:new Date().toISOString(),
      },{onConflict:'alvo_id'}).select()
    :await sbClient.from('gt_objetivo_interacao').delete().eq('alvo_id',String(alvoId)).select();
  const{data,error}=resp;
  if(error){
    // H2(a) do review: mesmo com o selo gated por permissão, uma sessão que
    // perdeu o acesso NO MEIO do uso ainda pode tentar salvar — aí o Postgres
    // recusa por RLS, e o dono não pode ver o jargão técnico cru (42501/"row-
    // level security"). _gtEhErroDePermissao já existe pra isso (mesmo helper
    // usado por _gtSalvarRegua).
    adminToast(_gtEhErroDePermissao(error)
      ? 'Você não tem permissão para editar esta ferramenta, então não deu para declarar o objetivo.'
      : 'Não consegui salvar o objetivo: '+error.message, false);
    return;
  }
  // H2(b) do review: o PostgREST devolve 200/204 com ZERO linhas e SEM `error`
  // quando a RLS filtra a linha da resposta — pra ele é indistinguível de "deu
  // certo". Sem checar isto, um apagar ("Voltar ao ponderado") sem permissão
  // real parecia ter funcionado: a tela apagava a declaração local, não avisava
  // nada, e ela reaparecia sozinha no próximo loadGtData() (porque no banco
  // continuava lá). `.select()` acima é o que permite enxergar essa diferença.
  if(!data||!data.length){
    // B1 do review (2026-07-28): zero linhas SEM erro no APAGAR também acontece
    // quando a linha já não existia — o menu sempre oferece "Voltar ao
    // ponderado", inclusive pra um alvo sem declaração nenhuma, e apagar o que
    // não existe devolve zero linhas do mesmo jeito, sem erro nenhum. Como
    // gt_objetivo_interacao está vazia hoje, TODO clique em "Voltar ao
    // ponderado" caía aqui e mentia "sem permissão" pro dono — inclusive num
    // segundo clique logo depois de um reverter normal. Só o apagar é ambíguo
    // assim: um upsert bem-sucedido sempre devolve a linha, e uma negação de
    // upsert já caiu no `error` 42501 lá em cima — por isso só desambiguamos
    // quando `interacao` for o apagar (falsy).
    if(!interacao){
      const confirma=await sb(`gt_objetivo_interacao?select=alvo_id&alvo_id=eq.${String(alvoId)}`);
      if(confirma.erro){
        // sb() nunca lança — devolve [] com .erro em qualquer falha (rede,
        // sessão, 5xx). Sem saber se a linha ainda existe, o caminho cauteloso
        // é não afirmar nem sucesso nem "sem permissão": nenhum dos dois está
        // confirmado.
        adminToast('Não consegui confirmar se deu certo. Tente de novo em instantes.',false);
        return;
      }
      if(confirma.length){
        // a linha continua lá de verdade: aí sim foi negação de permissão.
        adminToast('Você não tem permissão para editar esta ferramenta, então não deu para salvar o objetivo.',false);
        return;
      }
      // a linha já não existia antes do clique: não era negação, era não ter
      // nada pra desfazer. Cai pro bloco de sucesso abaixo.
    } else {
      adminToast('Você não tem permissão para editar esta ferramenta, então não deu para salvar o objetivo.',false);
      return;
    }
  }
  // B2 do review: sem um aviso explícito, o re-render abaixo recolhe os painéis
  // expandidos e o clique fica sem NENHUM sinal de que algo aconteceu — o toast
  // (adminToast) é a confirmação visível de que o objetivo mudou de verdade.
  if(interacao){
    _gtObjetivoInteracao[String(alvoId)]=interacao;
    adminToast('Objetivo definido: '+(INTERACOES[interacao]?.rotulo||interacao)+'.');
  }else{
    delete _gtObjetivoInteracao[String(alvoId)];
    adminToast('Objetivo voltou a ser o ponto ponderado.');
  }
  // M6 do review: nada mudou do lado da Meta — a declaração é estado local
  // (banco próprio, gt_objetivo_interacao). Recarregar a conta inteira via
  // loadGtData() custaria 5 chamadas à Graph API por CLIQUE (e perderia
  // scroll/expansão), só pra redesenhar um selo. Redesenha com os dados que
  // já estão em memória.
  const col=document.getElementById('gt-camp-col');
  if(col)_renderGtCampaigns(col,_gtCampaigns,_gtInsights,_gtAdInsights,_gtAdsets);
}
function _gtMetricasDoBalde(balde){
  const c=_gtConfig[balde];
  return (Array.isArray(c)&&c.length) ? c : (GT_BALDE_PADRAO[balde]||GT_BALDE_PADRAO.padrao);
}
function _gtFmt(v, fmt){
  if(v==null||!isFinite(v))return '—';
  if(fmt==='money')return 'R$ '+v.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
  if(fmt==='pct')return v.toLocaleString('pt-BR',{maximumFractionDigits:2})+'%';
  if(fmt==='x')return v.toLocaleString('pt-BR',{maximumFractionDigits:2})+'×';
  if(fmt==='dec')return v.toLocaleString('pt-BR',{maximumFractionDigits:2});
  return Math.round(v).toLocaleString('pt-BR'); // int
}
function _gtKpisHtml(row){
  const balde=_gtBalde(row.objective);
  const keys=_gtMetricasDoBalde(balde);
  // Só 4 métricas do catálogo têm entrada em ajuda.js (custo_conversa, custo_lead,
  // cpm, custo_visita) — a chave da métrica já É a chave da ajuda, sem mapa
  // separado. _gtAjudaBtn devolve '' pras demais, então elas ficam sem botão.
  return keys.map(k=>{ const m=GT_METRIC_CATALOG[k]; if(!m)return ''; const val=_gtFmt(m.compute(row), m.fmt);
    return `<div class="gt-kpi"><span class="gt-kpi-lbl">${m.label}${_gtAjudaBtn(k)}</span><span class="gt-kpi-val">${val}</span></div>`;
  }).join('');
}
async function _gtSaveConfig(balde,metricas){
  // escrita autenticada via sbClient (JWT do usuário) — gated no banco por RLS
  // (profiles.role='admin'), mesmo padrão de adminSaveSetting()/platform_settings
  // e sr-btn de accounts.accent_color (ver db/migrations/006_accounts_update_policy.sql).
  const{error}=await sbClient.from('gt_config_metricas').upsert({balde,metricas,updated_at:new Date().toISOString()},{onConflict:'balde'});
  if(error) throw error;
  _gtConfig[balde]=metricas;
}

// ── A régua (métrica ponderada): pesos, metas de custo por balde e limiares
// do veredito. Lida por qualquer usuário logado (RLS aberta pra leitura);
// escrita gated no banco a quem tem ACESSO À FERRAMENTA (admin OU a feature
// 'meta.gestor' — decisão do dono, 2026-07-28: editar a régua é uma ação da
// ferramenta, não um privilégio de admin) — a tela usa esse MESMO critério
// (hasPermission('meta.gestor', 'editar')) pra decidir se mostra os campos
// editáveis, senão o dono via campo editável que não consegue mesmo salvar
// (ver painel-regua.js e o call site em _gtTrocarAba).
let _gtRegua = normalizarRegua(null);   // começa no padrão; o banco sobrescreve
// Só fica true quando a leitura do banco realmente funcionou. Enquanto for false,
// a aba "A régua" NÃO pode deixar salvar: _gtRegua ainda é o padrão de fábrica
// (ou o valor de uma leitura anterior), nunca a meta real das cinco contas — e
// salvar isso sobrescreveria a linha única de verdade. Ver _gtTrocarAba e C3 do
// review final (2026-07-28).
let _gtReguaCarregada = false;

// A régua COMO ELA VALE pra conta que está na tela agora. `_gtRegua` é o bruto
// do banco (que guarda a meta das cinco contas juntas); esta é a que decide cor
// e veredito. Sempre use ESTA no cálculo — usar `_gtRegua` direto julgaria a
// conta aberta pela meta de outro cliente.
//
// Sem conta selecionada devolve metas vazias, e vazio faz o cálculo dizer
// 'sem-dados' em vez de chutar. Ver reguaDaConta em regua.js.
function _gtReguaAtiva() {
  return reguaDaConta(_gtRegua, _gtCurAcc && _gtCurAcc.id);
}

// ── FILA DE APROVAÇÃO ───────────────────────────────────────────────────────
// Lista única das cinco contas: o robô propõe, o dono decide, e é o ÚNICO
// caminho que mexe em orçamento a partir de uma sugestão. O cartão da campanha
// virou só leitura de propósito — com dois caminhos, um deles escaparia do
// registro (decisão do dono, 2026-07-29).
let _gtFila = { pendentes: [], vencidas: [], silenciadas: [], respondidas: [] };
// Data de N dias atrás em AAAA-MM-DD, para o filtro do PostgREST.
const _gtDiasAtras = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
let _gtGastosPorCampanha = new Map();
let _gtFilaCarregando = false;
// Só vira true quando a leitura terminou de verdade. Enquanto for false, a aba
// diz "carregando", nunca "não há nada" — ver a guarda em _gtCarregarFila.
let _gtFilaCarregou = false;
// As analises COMO O ROBO GRAVOU, sem o filtro de `pedeAcao`. A fila vazia
// precisa delas pra dizer "analisei 2 e nas duas o conselho foi manter" —
// 'manter' e exatamente o que montarFila descarta.
let _gtAnalisesCruas = [];
// A leitura de publico da conta ABERTA (90 dias). Fora da lista de decisoes:
// aparece mesmo quando o veredito e 'manter', e o contador da aba conta DECISOES.
let _gtLeituraPublico = null;
// O que a Meta reclama, agrupado por PROBLEMA (nao por anuncio).
let _gtProblemasDaMeta = [];

// GUARDA NO BANCO O QUE A META RECLAMA, uma chamada por conta.
//
// POR QUE EXISTE (17/08/2026): o `issues_info` do Graph SOME quando o anúncio é
// excluído ou o problema é resolvido. Não há histórico em lugar nenhum — foi por
// isso que não deu para achar a campanha barrada da semana de 11/08. A tabela
// `gt_problemas_meta` é a memória que a Meta não tem.
//
// NÃO ESPERA e NÃO DERRUBA: guardar histórico é bom, ver a fila é o que a pessoa
// veio fazer. Se o banco recusar (sem permissão, rede caindo), a fila aparece do
// mesmo jeito e o erro fica no console — em vez de uma tela em branco por causa
// de uma gravação de bastidor.
async function _gtGuardarProblemas(porConta) {
  for (const [conta, linhas] of porConta) {
    try {
      // A lista vai inteira, inclusive vazia: é ela que fecha o que sumiu.
      const { error } = await sbClient.rpc('gt_registrar_problemas', { p_conta: conta, p_itens: linhas });
      if (error) console.warn('[problemas] não consegui guardar em', conta, error.message);
    } catch (e) {
      console.warn('[problemas] não consegui guardar em', conta, (e && e.message) || e);
    }
  }
}

// Busca as campanhas e os conjuntos SÓ das contas que têm pendência. Sem este
// recorte seriam duas chamadas por conta em toda abertura da aba, quatro delas
// para descobrir que não havia nada a decidir ali.
// ATENÇÃO ao `account_id` de gt_budget_analises: ele é o id do REGISTRO QUE
// GUARDA O TOKEN, e um mesmo registro atende as cinco contas de anúncios (o robô
// varre /me/adaccounts a partir dele). Ou seja, ele NÃO diz de qual conta do
// painel a campanha é — todas as análises vêm com o mesmo valor. Quem responde
// isso é onde a campanha foi encontrada, e por isso a busca varre as contas do
// painel em vez de tentar adivinhar pelo campo gravado.
async function _gtFilaBuscarNomes() {
  const mapa = new Map();
  await Promise.all((_gtAccounts || []).filter((c) => c && c.ad_account_id).map(async (conta) => {
    const acc = _maCleanAccId(conta.ad_account_id);
    const [camps, sets, ins, anuncios] = await Promise.all([
      metaFetchAll(`/act_${acc}/campaigns`, { fields: 'id,name,effective_status,objective,daily_budget,lifetime_budget,stop_time' }, conta.id).catch(() => []),
      // destination_type/optimization_goal: o que a Meta AFIRMA sobre ser WhatsApp
      // (ver ehDeWhatsapp). Sem eles a saúde mede lead numa campanha que compra
      // conversa e acusa "nenhum resultado" onde houve mil.
      metaFetchAll(`/act_${acc}/adsets`, { fields: 'id,name,campaign_id,daily_budget,lifetime_budget,effective_status,destination_type,optimization_goal' }, conta.id).catch(() => []),
      // 30 dias: é a janela em que fadiga de audiência aparece. Mais curto não
      // acumula frequência; mais longo mistura público já renovado.
      metaFetchAll(`/act_${acc}/insights`, { level: 'campaign', fields: 'campaign_id,spend,impressions,ctr,frequency,clicks,cpc,reach,actions,video_play_actions', date_preset: 'last_30d' }, conta.id).catch(() => []),
      // Anúncios: o robô diz quais criativos não engatam (gt_ad_analises) e a
      // fila mostra a lista dentro da campanha. Só os ATIVOS interessam.
      // `issues_info` e o que a Meta reclama do anuncio -- e o MESMO campo onde
      // uma recusa por politica apareceria (item 3 da lista do dono).
      metaFetchAll(`/act_${acc}/ads`, { fields: 'id,name,campaign_id,effective_status,issues_info' }, conta.id).catch(() => []),
    ]);
    const insPorCamp = {};
    for (const i of ins || []) insPorCamp[String(i.campaign_id)] = i;
    const adsPorCamp = {};
    // TODOS os anúncios, sem filtro de status — ver `anunciosTodos` abaixo.
    const adsTodosPorCamp = {};
    for (const a of anuncios || []) {
      (adsTodosPorCamp[String(a.campaign_id)] = adsTodosPorCamp[String(a.campaign_id)] || []).push(a);
      if (String(a.effective_status || '').toUpperCase() !== 'ACTIVE') continue;
      (adsPorCamp[String(a.campaign_id)] = adsPorCamp[String(a.campaign_id)] || []).push(a);
    }
    for (const c of camps || []) {
      const meus = (sets || []).filter((x) => String(x.campaign_id) === String(c.id));
      mapa.set(String(c.id), {
        campanha: c, conjuntos: meus, conta, insight: insPorCamp[String(c.id)] || null,
        // SÓ OS ATIVOS: é o que o robô usa para falar de criativo sem tração —
        // criativo parado não tem tração para julgar.
        anuncios: adsPorCamp[String(c.id)] || [],
        // TODOS: é o que o painel de problemas usa. Um anúncio com problema
        // GRAVE está fora do ar por definição, então exigir que ele esteja
        // ativo para aparecer é pedir a contradição — e foi assim que 13 de 13
        // problemas ficaram invisíveis por cinco dias (17/08/2026).
        anunciosTodos: adsTodosPorCamp[String(c.id)] || [],
      });
    }
  }));
  return mapa;
}

async function _gtCarregarFila() {
  if (_gtFilaCarregando) return;
  // Sem a lista de contas não dá pra saber quais campanhas existem — e uma fila
  // zerada por falta de dado é indistinguível de uma fila realmente vazia. Fica
  // como "ainda carregando" e tenta de novo quando as contas chegarem, em vez de
  // afirmar que não há nada a decidir. Mesmo princípio do fail-closed da régua.
  if (!(_gtAccounts && _gtAccounts.length)) {
    _gtFilaCarregou = false;
    if (_gtAbaAtiva === 'fila') _gtTrocarAba('fila');
    return;
  }
  _gtFilaCarregando = true;
  try {
    // sb() nunca lança: devolve [] com .erro (ver buscar-e-salvar-dados.js).
    const [analises, decisoes, gastos] = await Promise.all([
      sb('gt_budget_analises?select=campaign_id,account_id,veredito,justificativa,impacto_estimado,impactos,budget_atual_centavos,budget_sugerido_centavos,gerado_em,valida_ate'),
      sb('gt_fila_decisoes?select=campaign_id,decisao,decidido_em,silenciar_ate&order=decidido_em.desc'),
      // O GASTO de verdade, do coletor — sem chamada nova à Meta. Só as capturas
      // dos últimos dias: `lerGastos` fica com a mais nova de cada campanha, e
      // trazer meses de histórico para descartar seria peso de rede à toa.
      sb(`campaign_insights?select=campaign_id,captured_at,period_days,spend&captured_at=gte.${_gtDiasAtras(3)}`),
    ]);
    if (analises.erro) { console.error('[GT] falha ao ler as análises da fila:', analises.erro); }
    // Guarda as análises CRUAS: a fila vazia precisa contar quantas o robô olhou
    // e quantas vieram 'manter', e 'manter' é justamente o que montarFila filtra.
    _gtAnalisesCruas = analises || [];
    _gtFila = montarFila(analises || [], decisoes || [], new Date().toISOString());
    // O gasto entra DEPOIS de montar a fila, por campanha. Agrupar aqui em vez
    // de dentro de montarFila mantém aquele módulo puro sem saber de insights.
    _gtGastosPorCampanha = new Map();
    for (const g of (gastos || [])) {
      if (!g || g.campaign_id == null) continue;
      const k = String(g.campaign_id);
      if (!_gtGastosPorCampanha.has(k)) _gtGastosPorCampanha.set(k, []);
      _gtGastosPorCampanha.get(k).push(g);
    }

    // Busca SEMPRE, mesmo com a fila vazia: a leitura de saúde precisa varrer as
    // campanhas ativas, e uma delas pode ter alerta sem o robô ter proposto nada
    // (foi o caso da "[Leads] Para WhatsApp" da Motoeasy, frequência 4,2× com o
    // robô dizendo 'manter').
    const mapa = await _gtFilaBuscarNomes();
    // SÓ CAMPANHA VIVA fica na fila. O robô guarda a análise mesmo depois de a
    // campanha parar, e o `effective_status` gravado é o do dia da análise —
    // envelhece. Sem cruzar com a Meta agora, a fila pedia decisão sobre
    // campanha encerrada: das 26 análises vencidas em 29/07, 12 eram assim.
    // Campanha que sumiu da conta também cai aqui (não está no mapa).
    const agoraMs = Date.now();
    const viva = (i) => {
      const info = mapa.get(String(i.campaign_id));
      // emVeiculacao olha TAMBÉM o stop_time. Só o effective_status deixava
      // passar campanha encerrada: a "Vamos Brasillll" terminou em 05/07 e
      // continuava na fila pedindo mudança de orçamento (achado do dono,
      // 2026-07-29). Decidir verba de campanha que acabou não muda nada.
      return !!info && emVeiculacao(info.campanha, agoraMs);
    };
    _gtFila.pendentes = _gtFila.pendentes.filter(viva);
    _gtFila.vencidas = _gtFila.vencidas.filter(viva);
    for (const i of _gtFila.pendentes.concat(_gtFila.vencidas)) {
      const info = mapa.get(String(i.campaign_id));
      if (!info) continue;
      i.campaign_name = info.campanha.name || '';
      i.conta_nome = info.conta.display_name || info.conta.name || '';
      // A conta de verdade é esta, não a que veio gravada (ver o comentário em
      // _gtFilaBuscarNomes). Sem isto o filtro por conta contava zero em todas.
      i.account_id = info.conta.id;
      const orc = orcamentoEfetivoDaCampanha(info.campanha, info.conjuntos);
      i.nivel = orc.sigla;
      // Só campanha ABO ganha quebra por conjunto; em CBO o valor vai direto na
      // campanha e uma lista de conjuntos ali só confundiria.
      i.conjuntos = orc.sigla === 'ABO'
        ? info.conjuntos
            .filter((c) => String(c.effective_status || '').toUpperCase() === 'ACTIVE' && (c.daily_budget || c.lifetime_budget))
            .map((c) => ({ id: c.id, nome: c.name, deCentavos: Number(c.daily_budget || c.lifetime_budget) }))
        : [];
    }
    // SAÚDE de cada campanha viva, e o cruzamento com o que o robô propôs.
    const saudes = [];
    for (const [id, info] of mapa) {
      if (!emVeiculacao(info.campanha, agoraMs)) continue;
      if (!info.insight) continue;
      const i = info.insight;
      const wa = ehDeWhatsapp(info.conjuntos);
      const acao = (tipos) => {
        for (const t of tipos) {
          const a = (i.actions || []).find((x) => x && x.action_type === t);
          if (a) return Number(a.value) || 0;
        }
        return 0;
      };
      const saude = lerSaude({
        categoria: categoriaDoObjetivo(info.campanha.objective, wa),
        gasto: parseFloat(i.spend || 0), impressoes: parseInt(i.impressions || 0, 10),
        ctr: parseFloat(i.ctr || 0), frequencia: parseFloat(i.frequency || 0),
        cliques: parseInt(i.clicks || 0, 10), cpc: parseFloat(i.cpc || 0),
        alcance: parseInt(i.reach || 0, 10),
        // Campanha de WhatsApp compra CONVERSA — medir 'lead' aqui acusaria
        // "nenhum resultado" numa campanha com mil conversas.
        resultados: wa ? acao(['onsite_conversion.messaging_conversation_started_7d', 'onsite_conversion.messaging_conversation_started'])
                       : acao(['lead', 'onsite_conversion.lead_grouped', 'purchase']),
        engajamentos: acao(['post_engagement', 'page_engagement']),
        plays: parseInt((i.video_play_actions && i.video_play_actions[0] && i.video_play_actions[0].value) || 0, 10),
      });
      if (saude.nivel !== 'alerta' && saude.nivel !== 'atencao') continue;
      const orc = orcamentoEfetivoDaCampanha(info.campanha, info.conjuntos);
      saudes.push({
        campaign_id: id, account_id: info.conta.id,
        campaign_name: info.campanha.name || '',
        conta_nome: info.conta.display_name || info.conta.name || '',
        saude, budget_atual_centavos: orc.centavos,
        medido_em: new Date().toISOString(),
        conjuntos: orc.sigla === 'ABO'
          ? info.conjuntos.filter((c) => String(c.effective_status || '').toUpperCase() === 'ACTIVE' && (c.daily_budget || c.lifetime_budget))
              .map((c) => ({ id: c.id, nome: c.name, deCentavos: Number(c.daily_budget || c.lifetime_budget) }))
          : [],
      });
    }
    // As decisões de saúde vão junto: sem elas o alerta dispensado ressuscitava a
    // cada carregamento (`mesclarSaude` roda depois de `montarFila` e só pulava
    // campanha que já estivesse na fila de orçamento).
    const decisoesSaude = await sb('gt_fila_decisoes?select=campaign_id,decisao,decidido_em,silenciar_ate,escopo&escopo=eq.saude&order=decidido_em.desc');
    _gtFila = mesclarSaude(_gtFila, saudes, decisoesSaude || [], agoraMs);

    // CRIATIVOS SEM TRAÇÃO: o robô analisa anúncio a anúncio e marca 'pausar'
    // nos que não engatam. Eles aparecem AGRUPADOS na linha da campanha —
    // dezesseis anúncios da mesma campanha não são dezesseis decisões, são uma
    // ("esta campanha precisa de criativo novo").
    const [adAnalises, decisoesCr] = await Promise.all([
      sb('gt_ad_analises?select=ad_id,veredito,justificativa,gerado_em&veredito=eq.pausar'),
      sb('gt_fila_decisoes?select=campaign_id,decisao,decidido_em,escopo&escopo=eq.criativos&order=decidido_em.desc'),
    ]);
    const porAd = {};
    for (const a of adAnalises || []) if (a && a.ad_id) porAd[String(a.ad_id)] = a;

    // O QUE A META RECLAMA. Varre TODAS as campanhas, nao so as que estao na
    // fila: um conjunto que a Meta pausou sozinha nao aparece em lugar nenhum
    // -- foi o caso dos 5 da Raissa, medidos em 12/08/2026.
    const comProblema = [];
    // As mesmas reclamações, agora agrupadas POR CONTA, para guardar no banco.
    const paraGuardar = new Map();
    for (const [, info] of mapa) {
      const contexto = {
        conta_nome: info.conta.display_name || info.conta.name || '',
        campanha_nome: info.campanha.name || '',
        campaign_id: info.campanha.id || null,
      };
      // `anunciosTodos`, e NÃO `anuncios`: a segunda lista só tem os ativos, e
      // anúncio com problema quase nunca está ativo. Medido em 17/08/2026: dos
      // 13 com `issues_info` nas 5 contas, ZERO estavam ACTIVE.
      comProblema.push(...anunciosComProblema(info.anunciosTodos, contexto));
      const conta = String(info.conta.id || '');
      if (!conta) continue;
      if (!paraGuardar.has(conta)) paraGuardar.set(conta, []);
      paraGuardar.get(conta).push(...linhasParaGuardar(info.anunciosTodos, contexto));
    }
    // GUARDAR O MOTIVO. A Meta APAGA o `issues_info` quando o anúncio é excluído
    // ou o problema é resolvido — foi por isso que a campanha barrada da semana
    // de 11/08 não deixou rastro nenhum. Aqui a Central passa a ter a memória
    // que a Meta não tem.
    //
    // Roda para TODA conta do mapa, inclusive as sem problema nenhum: é a lista
    // vazia que fecha o que sumiu. Mandar só as contas com problema deixaria um
    // problema resolvido parecendo aberto para sempre.
    //
    // Falha aqui NÃO pode derrubar a fila: guardar histórico é bom, mas ver a
    // fila é o que a pessoa veio fazer.
    _gtGuardarProblemas(paraGuardar);
    _gtProblemasDaMeta = agruparProblemas(comProblema);
    const criativos = [];
    for (const [id, info] of mapa) {
      if (!emVeiculacao(info.campanha, agoraMs)) continue;
      const orcC = orcamentoEfetivoDaCampanha(info.campanha, info.conjuntos);
      for (const ad of info.anuncios || []) {
        const a = porAd[String(ad.id)];
        if (!a) continue;
        criativos.push({
          campaign_id: id, ad_id: String(ad.id), nome: ad.name || '',
          account_id: info.conta.id,
          campaign_name: info.campanha.name || '',
          conta_nome: info.conta.display_name || info.conta.name || '',
          budget_atual_centavos: orcC.centavos,
          porque: a.justificativa || '',
          analisado_em: a.gerado_em || null,
        });
      }
    }
    _gtFila = anexarCriativos(_gtFila, criativos, decisoesCr || []);
    // Marca o conflito: robô manda escalar numa campanha que está queimando a
    // audiência. É o motivo de as duas leituras andarem juntas.
    for (const item of _gtFila.pendentes) item.conflito = contradiz(item.saude, item.veredito);
    // A leitura de publico vem depois da fila e NAO a bloqueia: e acessorio.
    await _gtCarregarLeituraPublico();
    _gtFilaCarregou = true;
  } finally {
    _gtFilaCarregando = false;
  }
  _gtPintarContadorFila();
  if (_gtAbaAtiva === 'fila') _gtTrocarAba('fila');
}

// O número na aba é o que faz a fila ser lembrada: sem ele o dono só descobre
// que há decisão pendente se abrir a aba por conta própria.
function _gtPintarContadorFila() {
  const el = document.getElementById('pnd-fila-n');
  if (!el) return;
  const n = _gtFila.pendentes.length;
  el.textContent = String(n);
  // Enquanto não carregou, esconde: um "0" ali afirmaria que não há pendência.
  el.hidden = n === 0 || !_gtFilaCarregou;
}

// A LEITURA DE PUBLICO DA CONTA ABERTA (90 dias, por faixa de idade).
//
// UMA chamada por conta, e so da conta que esta na tela -- a fila ja faz quatro
// por conta, e varrer as cinco aqui triplicaria isso pra mostrar uma leitura so.
//
// A JANELA E DIFERENTE do resto da fila (90 dias contra 30) porque faixa de idade
// e dado ralo: medido em 12/08/2026, com 30 dias a maioria das faixas nao chega
// aos 10 resultados que a recomendacao exige. A tela DIZ a janela, senao os
// numeros pareceriam brigar com os do cartao da campanha.
async function _gtCarregarLeituraPublico() {
  _gtLeituraPublico = null;
  const conta = _gtCurAcc;
  if (!conta || !conta.ad_account_id) return;
  try {
    const acc = _maCleanAccId(conta.ad_account_id);
    const ate = new Date();
    const de = new Date(Date.now() - 90 * 86400000);
    const iso = (d) => d.toISOString().slice(0, 10);
    const linhas = await metaFetchAll(`/act_${acc}/insights`, {
      level: 'account', fields: 'spend,actions', breakdowns: 'age',
      time_range: JSON.stringify({ since: iso(de), until: iso(ate) }),
    }, conta.id);
    const rotulo = escolherAcao(linhas || []);
    const faixas = lerFaixasDeIdade(linhas || [], contadorDe(rotulo));
    _gtLeituraPublico = montarLeituraDePublico({
      faixas, recomendacao: recomendarIdade(faixas), contando: rotulo,
    });
  } catch (e) {
    // Leitura e acessorio: se a Meta recusar, a fila continua funcionando. Mas o
    // erro vai pro console -- sumir com ele faria a leitura "nunca aparecer" sem
    // ninguem saber por que.
    console.warn('[GT] não consegui ler o público da conta:', e);
    _gtLeituraPublico = null;
  }
}

// O FAROL: leva a receita pro editor de publico de uma campanha NOVA.
// Nao escreve na Meta -- abre o passo "Para quem" ja preenchido, e quem publica
// continua sendo o dono, pelo caminho normal.
async function _gtUsarPublicoDaLeitura() {
  const L = _gtLeituraPublico;
  if (!L || !L.receita) return;
  // Abre o fluxo normal de campanha nova e SEMEIA o passo "Para quem". Deixar
  // `_gtNovoAbrir` fazer o trabalho evita uma segunda porta de entrada pro mesmo
  // formulario -- duas portas divergem, e uma delas some do teste.
  await _gtNovoAbrir();
  if (!_gtNovo) return;   // sem conta selecionada, _gtNovoAbrir ja avisou
  _gtNovo.publico = publicoDaReceita(L.receita, PUBLICO_VAZIO);
  // Vai direto pro passo do publico pra pessoa VER o que foi preenchido, em vez
  // de descobrir tres telas adiante.
  const iPublico = PASSOS.findIndex((x) => x.chave === 'publico');
  if (iPublico >= 0) _gtNovoPasso = iPublico;
  _gtNovoRedesenhar();
}

// LE UM ARQUIVO SOLTO NO CAMPO DA PERSONA e devolve o texto.
//
// DOIS CAMINHOS, e a diferenca importa: .docx/.txt/.md sao lidos AQUI, no
// navegador, sem dependencia e sem custo. O .pdf vai pra IA no servidor, porque
// extrair texto de PDF exige lidar com a codificacao de fonte de cada arquivo --
// a extracao ingenua devolveu tabela de fonte no PDF real da curadoria da Vessel,
// e um extrator que acerta as vezes enche o campo de lixo em silencio.
//
// Devolve TEXTO. Nao grava nada: quem grava e o botao Salvar, depois de a pessoa
// conferir o que entrou no campo.
async function _gtLerArquivoDePersona(arquivo) {
  const tipo = tipoDoArquivo(arquivo.name);
  if (tipo === 'nao-suportado') throw new Error(`Nao sei ler "${arquivo.name}". Use .docx, .pdf, .txt ou .md.`);
  if (tipo === 'doc-antigo') throw new Error('O .doc antigo nao abre aqui. Abra no Word e salve como .docx (ou como PDF).');

  if (tipo === 'texto') {
    const t = await arquivo.text();
    if (!pareceTexto(t)) throw new Error('Este arquivo nao parece ter texto legivel.');
    return t;
  }

  if (tipo === 'docx') {
    const t = await textoDoDocx(await arquivo.arrayBuffer());
    if (!pareceTexto(t)) throw new Error('Nao consegui achar texto neste .docx.');
    return t;
  }

  // PDF: vai pra IA. Custa alguns centavos por arquivo -- e acao rara, mas a tela
  // avisa que demora, senao parece travada.
  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  let bin = '';
  // Em pedacos: `String.fromCharCode(...arr)` com um arquivo inteiro estoura a
  // pilha de argumentos e quebra num PDF grande.
  for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
  const base64 = btoa(bin);

  const { data: { session } } = await sbClient.auth.getSession();
  if (!session) throw new Error('Sessao expirada. Recarregue a pagina.');
  const r = await fetch(SUPABASE_URL + '/functions/v1/ler-documento', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + session.access_token, apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ base64, limite: PERSONA_MAXIMO }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.ok) throw new Error(d.detalhe || d.error || `Nao consegui ler o PDF (HTTP ${r.status}).`);
  if (!pareceTexto(d.texto)) throw new Error('A leitura do PDF nao devolveu texto legivel.');
  return d.texto;
}

// Grava a PERSONA da conta aberta.
//
// EXIGE A LINHA DE VOLTA antes de dizer que gravou. Um PATCH barrado pela RLS
// volta 204 com ZERO linhas e `.ok` true — a tela anunciaria sucesso sem ter
// gravado nada, que e exatamente o defeito que ja apareceu no PATCH de
// permissoes. `return=representation` faz o banco devolver o que ficou gravado.
async function _gtSalvarPersona(texto, botao) {
  const conta = _gtCurAcc && _gtCurAcc.id;
  if (!conta) return;
  const orig = botao ? botao.textContent : '';
  if (botao) { botao.disabled = true; botao.textContent = 'Salvando…'; }
  try {
    const r = await adFetch(`accounts?id=eq.${encodeURIComponent(conta)}&select=id,persona`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ persona: texto || null }),
    });
    const corpo = await r.json().catch(() => null);
    if (!r.ok) throw new Error((corpo && (corpo.message || corpo.hint)) || ('HTTP ' + r.status));
    if (!Array.isArray(corpo) || !corpo.length) {
      throw new Error('o banco não devolveu a linha — a gravação foi barrada por permissão');
    }
    // O que ficou NO BANCO vira o que a tela mostra e o que a IA recebe: se o
    // banco normalizou algo, a tela nao pode seguir exibindo o texto antigo.
    _gtCurAcc.persona = corpo[0].persona || '';
    const naLista = (_gtAccounts || []).find((c) => String(c.id) === String(conta));
    if (naLista) naLista.persona = _gtCurAcc.persona;
    adminToast('Persona salva. A IA vai usar isto na próxima sugestão de público.');
    if (botao) botao.textContent = '✓ Salva';
  } catch (e) {
    console.error('[GT] falha ao salvar a persona:', e);
    adminToast('Não consegui salvar a persona: ' + String((e && e.message) || e), false);
    if (botao) { botao.disabled = false; botao.textContent = orig; }
  }
}

// Grava a decisão. Append-only: cada decisão é uma linha nova (ver a migration
// 2026-07-29-fila-decisoes.sql) — corrigir é decidir de novo, não reescrever.
async function _gtFilaGravarDecisao(item, decisao, aplicado, erro, escopo) {
  const linha = {
    // 'orcamento' ou 'criativos': são perguntas independentes na MESMA campanha,
    // e sem separar uma calaria a outra (ver a migration do escopo).
    escopo: escopo || 'orcamento',
    campaign_id: String(item.campaign_id),
    account_id: item.account_id ? String(item.account_id) : null,
    veredito: item.veredito,
    budget_atual_centavos: item.budget_atual_centavos ?? null,
    budget_sugerido_centavos: item.budget_sugerido_centavos ?? null,
    analise_gerada_em: item.gerado_em || null,
    decisao,
    decidido_por: estado.userId,
    // Recusar cala a campanha por 7 dias, inclusive contra análise nova — o robô
    // regrava todo dia, então sem isto a recusa duraria algumas horas.
    silenciar_ate: decisao === 'recusada'
      ? new Date(Date.now() + DIAS_DE_SILENCIO * 86400000).toISOString()
      : null,
    aplicado: aplicado || [],
    erro: erro || null,
  };
  const { error } = await sbClient.from('gt_fila_decisoes').insert(linha);
  return error || null;
}

async function _gtFilaRecusar(item, botao) {
  const ok = await _gtConfirm('Recusar esta sugestão?',
    `"${_gtEsc(item.campaign_name || item.campaign_id)}" sai da fila e só volta a aparecer daqui a ${DIAS_DE_SILENCIO} dias, se a situação continuar. Nada muda na Meta.`);
  if (!ok) return;
  const orig = botao.textContent;
  botao.disabled = true; botao.textContent = '…';
  // O ESCOPO É O DA PERGUNTA QUE ESTÁ SENDO RECUSADA. Item vindo da saúde não é
  // pergunta de verba: gravá-lo como 'orcamento' (o default) calava por 7 dias a
  // sugestão de orçamento da MESMA campanha — e ainda por cima não calava o
  // alerta de saúde, que voltava no carregamento seguinte. Medido em 12/08/2026.
  const erro = await _gtFilaGravarDecisao(item, 'recusada', [], null,
    item.origem === 'saude' ? 'saude' : item.origem === 'criativos' ? 'criativos' : 'orcamento');
  if (erro) {
    console.error('[GT] falha ao gravar a recusa:', erro);
    adminToast(_gtEhErroDePermissao(erro) ? 'Você não tem permissão para decidir na fila.' : 'Não consegui registrar a recusa. Tente de novo.', false);
    botao.disabled = false; botao.textContent = orig;
    return;
  }
  adminToast('Recusada. Volta em ' + DIAS_DE_SILENCIO + ' dias se continuar assim.');
  await _gtCarregarFila();
}

async function _gtFilaAprovar(item, botao, opcao) {
  // QUAL DAS TRÊS FOI CLICADA. `opcao` vem do painel com o valor JÁ CALCULADO —
  // o mesmo que estava escrito no botão. Recalcular aqui abriria a porta para
  // aplicar um número diferente do que a pessoa leu antes de clicar.
  const ehPausa = (opcao && opcao.chave === 'pausar') || (!opcao && item.veredito === 'pausar');
  const alvoCentavos = (opcao && opcao.alvoCentavos != null)
    ? opcao.alvoCentavos
    : item.budget_sugerido_centavos;
  // O que vai ser escrito na Meta, item a item. Em ABO uma aprovação vira
  // VÁRIAS escritas (uma por conjunto) — por isso a confirmação mostra a quebra
  // inteira antes, e não só o total.
  // Trava de segurança: sem número e sem pausa não há o que aplicar. O painel já
  // esconde o botão nesse caso; isto existe porque quem aplica na Meta não pode
  // depender de a tela ter escondido o botão certo.
  if (!ehPausa && alvoCentavos == null) {
    adminToast('Este aviso não tem valor sugerido — ajuste o orçamento na aba Campanhas.', false);
    return;
  }
  const alvos = ehPausa
    ? [{ id: item.campaign_id, tipo: 'pausar', nome: item.campaign_name }]
    : (item.conjuntos && item.conjuntos.length)
      ? distribuirEntreConjuntos(item.conjuntos, alvoCentavos)
          .map((p) => ({ id: p.id, tipo: 'budget', budget: p.paraCentavos, de: p.deCentavos, nome: p.nome }))
      : [{ id: item.campaign_id, tipo: 'budget', budget: alvoCentavos, de: item.budget_atual_centavos, nome: item.campaign_name }];

  const detalhe = ehPausa
    ? `"${_gtEsc(item.campaign_name || item.campaign_id)}" será PAUSADA na Meta agora.`
    : alvos.length > 1
      ? `Vou aplicar em ${alvos.length} conjuntos de "${_gtEsc(item.campaign_name || '')}":<br>`
        + alvos.map((a) => `• ${_gtEsc(a.nome || a.id)}: ${_maFmtR((a.de || 0) / 100)} → <b>${_maFmtR(a.budget / 100)}</b>/dia`).join('<br>')
      : `"${_gtEsc(item.campaign_name || item.campaign_id)}": ${_maFmtR((item.budget_atual_centavos || 0) / 100)}/dia → <b>${_maFmtR(alvoCentavos / 100)}/dia</b>.`;

  const ok = await _gtConfirm('Aplicar na Meta?', detalhe, { danger: ehPausa });
  if (!ok) return;

  const orig = botao.textContent;
  botao.disabled = true; botao.textContent = '…';
  const feitos = [];
  let falha = null;
  for (const alvo of alvos) {
    try {
      // A conta é a DO ITEM, não a selecionada na tela: a fila junta as cinco
      // contas, e usar _gtCurAcc mandaria a escrita pelo token errado.
      if (alvo.tipo === 'pausar') await metaPost('/' + alvo.id, { status: 'PAUSED' }, item.account_id);
      else await metaPost('/' + alvo.id, { daily_budget: String(alvo.budget) }, item.account_id);
      feitos.push({ id: alvo.id, nome: alvo.nome || null, de: alvo.de ?? null, para: alvo.budget ?? null, tipo: alvo.tipo });
    } catch (e) {
      falha = String((e && e.message) || e || 'erro desconhecido');
      break;   // não insiste: metade aplicada já é o suficiente pra registrar e avisar
    }
  }

  // Grava SEMPRE, mesmo com falha no meio: `aplicado` guarda o que realmente
  // saiu e `erro` diz onde parou. Sem isto, uma aprovação parcial não deixaria
  // rastro nenhum e a auditoria não bateria com a Meta.
  const erroGravar = await _gtFilaGravarDecisao(item, 'aprovada', feitos, falha);
  if (erroGravar) console.error('[GT] apliquei na Meta mas não consegui gravar a decisão:', erroGravar);

  if (falha) {
    adminToast(feitos.length
      ? `Apliquei ${feitos.length} de ${alvos.length} e parei: ${falha}`
      : `Não consegui aplicar: ${falha}`, false);
    botao.disabled = false; botao.textContent = orig;
  } else {
    botao.textContent = '✓ Aplicado';
    adminToast(alvos.length > 1 ? `Aplicado nos ${alvos.length} conjuntos.` : 'Aplicado na Meta.');
  }
  await _gtCarregarFila();
}

// Pausa os criativos fracos de uma campanha, de uma vez. É uma decisão só — o
// robô marcou dezesseis anúncios da mesma campanha, e perguntar dezesseis vezes
// seria transformar a fila em lista de tarefas.
async function _gtFilaPausarCriativos(item, botao) {
  const lista = item.criativos || [];
  if (!lista.length) return;
  const nomes = lista.slice(0, 6).map((c) => `• ${_gtEsc(c.nome || c.ad_id)}`).join('<br>');
  const resto = lista.length > 6 ? `<br>… e mais ${lista.length - 6}` : '';
  const ok = await _gtConfirm(
    lista.length > 1 ? `Pausar ${lista.length} criativos?` : 'Pausar este criativo?',
    `De "${_gtEsc(item.campaign_name || '')}":<br>${nomes}${resto}<br><br>A campanha continua rodando — só os anúncios param.`,
    { danger: true },
  );
  if (!ok) return;
  const orig = botao.textContent;
  botao.disabled = true; botao.textContent = '…';
  const feitos = [];
  let falha = null;
  for (const c of lista) {
    try {
      // A conta é a DO ITEM: a fila junta as cinco.
      await metaPost('/' + c.ad_id, { status: 'PAUSED' }, item.account_id);
      feitos.push({ id: c.ad_id, nome: c.nome || null, tipo: 'pausar_anuncio' });
    } catch (e) { falha = String((e && e.message) || e || 'erro desconhecido'); break; }
  }
  // Grava mesmo com falha no meio: `aplicado` diz o que saiu de verdade.
  await _gtFilaGravarDecisao(item, 'aprovada', feitos, falha, 'criativos');
  if (falha) {
    adminToast(feitos.length ? `Pausei ${feitos.length} de ${lista.length} e parei: ${falha}` : `Não consegui pausar: ${falha}`, false);
    botao.disabled = false; botao.textContent = orig;
  } else {
    adminToast(lista.length > 1 ? `${lista.length} criativos pausados.` : 'Criativo pausado.');
  }
  await _gtCarregarFila();
}

// Nome do objetivo em português, pro botão de filtro. Vem de LEITURA (funil.js),
// a mesma fonte que o modal do funil usa — dois nomes diferentes pra mesma coisa
// na mesma tela seria confuso.
function _gtRotuloObjetivo(balde){
  return (LEITURA[balde]&&LEITURA[balde].rotulo)||balde;
}

// Como o período está escrito no botão ativo — o funil precisa DIZER de que
// janela ele fala, senão "288 conversas" pode ser de hoje ou de 30 dias.
function _gtPeriodoRotulo() {
  const b = document.querySelector('#gt-period-btns .gv-pbtn.active');
  return b ? (b.textContent || '').trim().toLowerCase() : '';
}

// ── FUNIL (modal da aba Campanhas) ──────────────────────────────────────────
// Só as campanhas EM VEICULAÇÃO entram: o funil responde "como está indo o que
// está no ar", e campanha encerrada só faria a média mentir.
function _gtAbrirFunil() {
  const alvo = document.getElementById('gt-modal-funil');
  if (!alvo) return;
  const agoraMs = Date.now();
  const campanhas = [];
  for (const ins of _gtInsights || []) {
    const camp = (_gtCampaigns || []).find((c) => String(c.id) === String(ins.campaign_id));
    if (!camp || !emVeiculacao(camp, agoraMs)) continue;
    const conjuntos = (_gtAdsets || []).filter((sx) => String(sx.campaign_id) === String(camp.id));
    campanhas.push({ balde: baldeEfetivo(camp.objective || ins.objective || '', conjuntos), insight: ins });
  }
  montarPainelFunil(alvo, {
    campanhas,
    contaNome: (_gtCurAcc && (_gtCurAcc.display_name || _gtCurAcc.name)) || '',
    periodoRotulo: _gtPeriodoRotulo(),
    aoFechar: _gtFecharFunil,
    ajudaBtn: _gtAjudaBtn,
  });
  alvo.style.display = '';
  document.addEventListener('keydown', _gtFunilEsc);
}
function _gtFecharFunil() {
  const alvo = document.getElementById('gt-modal-funil');
  if (alvo) { alvo.style.display = 'none'; alvo.innerHTML = ''; }
  document.removeEventListener('keydown', _gtFunilEsc);
}
function _gtFunilEsc(e) { if (e && e.key === 'Escape') _gtFecharFunil(); }

async function _gtCarregarRegua() {
  // sb() NUNCA lança — ver src/compartilhado/buscar-e-salvar-dados.js. Falha de
  // rede, sessão expirada (401), falta de GRANT (42501) e erro do servidor (5xx)
  // voltam como array vazio com .erro anexado (comErro); uma negação de RLS
  // devolve 200 com lista vazia, SEM .erro — pro PostgREST é indistinguível de
  // "a tabela realmente não tem nada". Um try/catch aqui era código morto: o
  // catch nunca rodava, e a flag de "carregou" ficava true mesmo numa leitura
  // que falhou silenciosamente. C3 do review final (2026-07-28).
  const linhas = await sb('gt_ponderada_config?select=pesos,metas,limiares,limiares_resultado,metas_por_conta&id=eq.1');
  const ok = !linhas.erro && linhas.length > 0;
  if (ok) {
    _gtRegua = normalizarRegua(linhas[0]);
  } else {
    // NUNCA engolir em silêncio: sem isso, a aba abre com o padrão de fábrica e
    // parece a régua real. O detalhe técnico vai pro console; o dono só precisa
    // saber, na tela, que o campo pode não estar confiável (ver montarPainelRegua).
    console.error('[GT] falha ao carregar a régua da métrica ponderada:', linhas.erro || 'a leitura voltou sem nenhuma linha');
    _gtRegua = normalizarRegua(null);
  }
  _gtReguaCarregada = ok;
  // Se a aba "A régua" já estiver aberta (ex.: o dono deixou a aba aberta e a
  // sessão renovou depois), remonta o painel com o resultado fresco. Sem isto,
  // uma leitura que só dá certo DEPOIS do primeiro paint deixaria o botão
  // "Salvar" preso em desabilitado até o dono trocar de aba e voltar.
  if (_gtAbaAtiva === 'regua') _gtTrocarAba('regua');
}

// Reconhece uma rejeição de permissão/RLS do Postgres (código 42501 ou texto
// "row-level security"/"permission denied") pra nunca mostrar esse jargão
// técnico pro dono — ele só precisa saber que faltou permissão de editar
// esta ferramenta.
function _gtEhErroDePermissao(e) {
  const codigo = e && e.code;
  const msg = String((e && e.message) || '').toLowerCase();
  return codigo === '42501' || msg.includes('row-level security') || msg.includes('permission denied');
}

async function _gtSalvarRegua(nova, botao) {
  const orig = botao ? botao.textContent : '';
  if (botao) { botao.disabled = true; botao.textContent = 'Salvando...'; }
  try {
    const antes = _gtRegua;
    const contaId = _gtCurAcc && _gtCurAcc.id;
    // Sem conta escolhida não dá pra salvar: as metas da tela pertencem a UMA
    // conta, e sem saber qual elas não teriam onde morar. Gravar só os pesos e
    // deixar as metas caírem no vácuo seria pior — o dono digitaria os valores,
    // veria "Régua salva" e voltaria depois com os campos vazios.
    if (!contaId) {
      adminToast('Escolha primeiro a conta de anúncios: as metas são dela.', false);
      return;
    }
    // As metas são DA CONTA; pesos e limiares seguem gerais (peso é quanto uma
    // interação vale, não quanto custa — isso não muda de cliente pra cliente).
    // mesclarMetasDaConta devolve o mapa inteiro com só esta conta trocada: sem
    // isso, salvar a régua da Vessel apagaria as metas das outras quatro, que
    // moram no mesmo campo do banco.
    const metasPorConta = mesclarMetasDaConta(_gtRegua, contaId, nova.metas);
    // QUEM mexeu: estado.userId é o mesmo id já usado no resto da tela (ver
    // _setGubAvatar em tela-de-admin.vue) — sem isto, updated_by/mudou_quem
    // ficavam sempre nulos e o histórico não dizia quem alterou.
    const { error } = await sbClient.from('gt_ponderada_config')
      .update({ pesos: nova.pesos, limiares: nova.limiares, limiares_resultado: nova.limiares_resultado, metas_por_conta: metasPorConta, updated_at: new Date().toISOString(), updated_by: estado.userId })
      .eq('id', 1);
    if (error) throw error;
    _gtRegua = normalizarRegua({ ...nova, metas: _gtRegua.metas, metas_por_conta: metasPorConta });
    // histórico: guarda o antes e o depois inteiros. Uma falha AQUI não desfaz o
    // save (a régua já está salva) — mas o dono precisa saber que o histórico
    // dessa alteração não ficou registrado, senão a auditoria fica com buraco
    // em silêncio.
    const { error: erroHistorico } = await sbClient.from('gt_ponderada_config_log').insert({ antes, depois: nova, mudou_quem: estado.userId });
    if (erroHistorico) {
      console.error('[GT] falha ao gravar o histórico da régua:', erroHistorico);
      adminToast('Régua salva, mas não consegui gravar o histórico dessa alteração.', false);
    } else {
      adminToast('Régua salva');
    }
    await loadGtData();           // a lista inteira recalcula com os pesos novos (e a régua é relida do banco)
    // Remonta a aba com o estado fresco pós-salvar. Sem isto, limpar um campo e
    // salvar de novo cairia no valor de ANTES do primeiro save (o `regua` que o
    // painel guardava em memória), não no valor que está no banco agora.
    _gtTrocarAba('regua');
  } catch (e) {
    if (_gtEhErroDePermissao(e)) {
      adminToast('Você não tem permissão para editar esta ferramenta, então não deu para alterar a régua.', false);
    } else {
      console.error('[GT] erro ao salvar a régua:', e);
      adminToast('Não foi possível salvar a régua agora. Tente de novo.', false);
    }
  } finally {
    if (botao) { botao.disabled = false; botao.textContent = orig; }
  }
}

// Campanha de maior gasto na tela, usada como exemplo vivo da aba da régua.
// Precisa escolher o MESMO alvo que o cartão da campanha escolheria (ver bloco
// "ALVO DO OBJETIVO" acima) — inclusive o desvio de campanha-de-mensagem —
// senão o exemplo vivo ensina a conta errada pro dono (C1 do review final,
// 2026-07-28: nesta conta, a campanha de maior gasto é de WhatsApp).
// UM exemplo por OBJETIVO que a conta realmente roda — não só a campanha de maior
// gasto. O dono pediu isso depois de olhar a régua: ele precisa ver como cada tipo
// de campanha será julgado, não só o tipo da campanha mais cara. De cada balde vai
// a campanha de MAIOR GASTO, que é a mais representativa do dinheiro dele.
function _gtExemplosParaRegua() {
  const porBalde = {};
  const porInteracao = {};
  for (const linha of _gtInsights) {
    const baldeBruto = _gtBalde(linha.objective);
    // Mesmo criterio do cartao: quem diz se e WhatsApp e o CONJUNTO, nao a acao.
    const conjuntosDaLinha = (_gtAdsets||[]).filter(x => String(x.campaign_id||'') === String(linha.campaign_id||''));
    // Destino WhatsApp vale pra QUALQUER objetivo (ver baldeEfetivo em baldes.js):
    // campanha de 'leads' que compra conversa e medida por conversa.
    const temMensagem = ehDeWhatsapp(conjuntosDaLinha);
    const balde = temMensagem ? 'mensagens' : baldeBruto;
    if (alvoDoBalde(balde)) {
      const atual = porBalde[balde];
      if (!atual || Number(linha.spend || 0) > Number(atual.spend || 0)) porBalde[balde] = linha;
    }
    // Exemplo POR INTERAÇÃO: a régua tem meta por curtida/comentário/salvamento/
    // compartilhamento, então cada uma dessas metas também precisa do seu "como
    // fica na prática" — senão o dono digita um número sem ver o efeito.
    // Escolhe a campanha com MAIS daquela interação (a mais representativa dela),
    // e só entre campanhas de engajamento, que é onde a declaração vale.
    if (balde === 'engajamento') {
      const q = quantidadesDoInsight(linha);
      for (const chave of Object.keys(INTERACOES)) {
        if (!(q[chave] > 0)) continue;                       // zero não vira exemplo
        const atual = porInteracao[chave];
        if (!atual || q[chave] > atual.qtd) porInteracao[chave] = { linha, qtd: q[chave], q };
      }
    }
  }
  const exemplos = [];
  for (const [balde, linha] of Object.entries(porBalde)) {
    const alvo = alvoDoBalde(balde);
    exemplos.push({
      tipo: 'objetivo',
      chave: balde,
      rotulo: alvo.rotulo,
      nome: linha.campaign_name || 'sua campanha',
      balde,
      quantidades: quantidadesDoInsight(linha),
      // Custo pronto p/ todo balde que NÃO é a ponderada — o painel recalcula ao
      // vivo só o caso 'ponderada' (engajamento), a partir de `quantidades`.
      custo: alvo.metrica !== 'ponderada' ? _gtMetricValue(alvo.metrica, linha) : null,
      detalhe: alvo.resultado
        ? [{ rotulo: GT_METRIC_CATALOG[alvo.resultado]?.label || alvo.resultado,
             valor: _gtMetricValue(alvo.resultado, linha) }]
        : null,
    });
  }
  for (const [chave, { linha, qtd, q }] of Object.entries(porInteracao)) {
    exemplos.push({
      tipo: 'interacao',
      chave,
      rotulo: INTERACOES[chave].rotuloCusto,
      titulo: INTERACOES[chave].rotulo,
      nome: linha.campaign_name || 'sua campanha',
      balde: 'engajamento',
      quantidades: q,
      custo: custoDaInteracao(q, chave),
      detalhe: [{ rotulo: INTERACOES[chave].rotulo, valor: qtd }],
    });
  }
  // Ordem de leitura: primeiro os objetivos de resultado (onde há mais dinheiro),
  // depois as interações — é a mesma ordem dos cartões da régua ao lado.
  exemplos.sort((a, b) => {
    if (a.tipo !== b.tipo) return a.tipo === 'objetivo' ? -1 : 1;
    return Number(b.quantidades.gasto || 0) - Number(a.quantidades.gasto || 0);
  });
  return exemplos;
}

function _gtCloseEditor(){
  const ov=document.getElementById('gt-cfg-overlay'),md=document.getElementById('gt-cfg-modal');
  if(ov)ov.style.display='none';
  if(md)md.style.display='none';
}
async function _gtOpenEditor(){
  if(!hasPermission('module:meta:gestor'))return; // gate = acesso à ferramenta; escrita protegida por RLS (admin OU meta.gestor)
  await _gtLoadConfig();
  const baldes=Object.keys(GT_BALDE_PADRAO);
  const catalogo=Object.entries(GT_METRIC_CATALOG).map(([k,m])=>({k,label:m.label}));
  const body=baldes.map(b=>{
    const sel=_gtMetricasDoBalde(b);
    const chks=catalogo.map(c=>`<label class="gt-cfg-chk"><input type="checkbox" data-balde="${_gtEsc(b)}" value="${_gtEsc(c.k)}" ${sel.includes(c.k)?'checked':''}> ${_gtEsc(c.label)}</label>`).join('');
    return `<div class="gt-cfg-sec"><div class="gt-cfg-obj">${_gtEsc(b)}</div><div class="gt-cfg-grid">${chks}</div></div>`;
  }).join('');
  const bodyEl=document.getElementById('gt-cfg-body');
  if(bodyEl)bodyEl.innerHTML=body;
  const ov=document.getElementById('gt-cfg-overlay'),md=document.getElementById('gt-cfg-modal');
  if(ov)ov.style.display='block';
  if(md)md.style.display='flex';
}
async function _gtSaveEditor(){
  const btn=document.getElementById('gt-cfg-save-btn');
  const orig=btn?btn.textContent:'';
  if(btn){btn.disabled=true;btn.textContent='Salvando...';}
  try{
    const baldes=Object.keys(GT_BALDE_PADRAO);
    const catalogOrder=Object.keys(GT_METRIC_CATALOG);
    for(const b of baldes){
      const checked=Array.from(document.querySelectorAll('#gt-cfg-body input[type=checkbox][data-balde="'+b+'"]:checked')).map(i=>i.value);
      const keys=catalogOrder.filter(k=>checked.includes(k));
      await _gtSaveConfig(b,keys);
    }
    _gtCloseEditor();
    adminToast('Configuração de métricas salva');
    await loadGtData();
  }catch(e){
    adminToast('Erro ao salvar: '+String((e&&e.message)||e||'erro desconhecido'),false);
  }finally{
    if(btn){btn.disabled=false;btn.textContent=orig;}
  }
}
async function loadGtData(){
  const col=document.getElementById('gt-camp-col');
  if(!col)return;
  // Zera a seleção de "pausar em massa" a cada recarga. É de segurança: recarregar
  // acontece ao TROCAR DE CONTA de anúncios, e uma seleção sobrevivente carregaria
  // ids da conta anterior pra dentro da conta nova. Não atrapalha o uso normal —
  // não existe recarga automática por tempo aqui (o timer só repinta o "atualizado
  // há X"), então a lista só se refaz quando o próprio usuário pede.
  _gtLimparSelecao();
  if(!_gtCurAcc){col.innerHTML='<div class="gt-camp-card"><div class="gt-empty">Nenhuma conta selecionada.</div></div>';return;}
  col.innerHTML='<div class="gv-loading-screen"><div class="gv-spinner"></div><span class="gv-loading-lbl">Carregando campanhas</span></div>';
  // Reset AI suggestions
  const sugs=document.getElementById('gt-suggestions');
  if(sugs)sugs.innerHTML='';
  try{
    if(!_gtConfigLoaded){ await _gtLoadConfig(); _gtConfigLoaded=true; }
    await _gtCarregarRegua();
    await _gtCarregarObjetivos();
    const acc=_gtCurAcc;
    const tok=acc.id;
    const adAccId=acc.ad_account_id;
    // Janela de datas — sempre em BRT (ver src/compartilhado/datas.js).
    // Antes usava toISOString() (UTC): das 21h à meia-noite "HOJE" pedia a data de
    // amanhã e o board vinha vazio, como se ninguém tivesse gasto nada.
    let since,until;
    const _gt=hojeLocal();
    if(_gtPreset==='today'){since=_gt;until=_gt;}
    else if(_gtPreset==='1d'){since=until=diasAtras(1);}
    else if(_gtPreset==='lastmonth'){since=primeiroDiaDoMes(-1);until=ultimoDiaDoMes(-1);}
    else if(_gtPreset==='monthfull'||_gtPreset==='sofar'){since=primeiroDiaDoMes();until=_gt;}
    else{const n=parseInt(_gtPreset)||30;since=diasAtras(n);until=_gt;}
    const fields='campaign_id,campaign_name,impressions,clicks,spend,ctr,cpc,reach,frequency,actions,action_values,purchase_roas,objective,video_play_actions';
    const adFields='campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,impressions,clicks,spend,ctr,cpc,reach,frequency,actions,objective';
    const campFields='id,name,effective_status,objective,daily_budget,lifetime_budget,start_time,stop_time,bid_strategy';
    // Conjuntos de anúncios (ad sets): é aqui que mora o orçamento quando a
    // campanha é ABO. Sem isto não dá pra saber se é ABO ou CBO nem editar o
    // orçamento no nível certo.
    // destination_type/optimization_goal sao o que a META AFIRMA sobre o destino da
    // campanha. Sem eles so dava pra INFERIR pelo resultado, e inferir estava errado
    // (ver _gtEhDeWhatsapp).
    const setFields='id,name,effective_status,daily_budget,lifetime_budget,campaign_id,destination_type,optimization_goal';
    const timeRange={since,until};
    const [insights,campaigns,adInsights,adObjs,adsets]=await Promise.all([
      metaFetchAll(`/act_${_maCleanAccId(adAccId)}/insights`,{level:'campaign',fields,filtering:JSON.stringify([{field:'spend',operator:'GREATER_THAN',value:'0'}]),time_range:timeRange},tok).catch(()=>[]),
      metaFetchAll(`/act_${_maCleanAccId(adAccId)}/campaigns`,{fields:campFields,effective_status:JSON.stringify(['ACTIVE','PAUSED','ARCHIVED'])},tok).catch(()=>[]),
      metaFetchAll(`/act_${_maCleanAccId(adAccId)}/insights`,{level:'ad',fields:adFields,filtering:JSON.stringify([{field:'spend',operator:'GREATER_THAN',value:'0'}]),time_range:timeRange},tok).catch(()=>[]),
      metaFetchAll(`/act_${_maCleanAccId(adAccId)}/ads`,{fields:'id,effective_status'},tok).catch(()=>[]),
      metaFetchAll(`/act_${_maCleanAccId(adAccId)}/adsets`,{fields:setFields,effective_status:JSON.stringify(['ACTIVE','PAUSED','ARCHIVED'])},tok).catch(()=>[]),
    ]);
    // Attach real effective_status to each ad insight (insights endpoint doesn't return status)
    const adStatusMap={};adObjs.forEach(a=>{adStatusMap[a.id]=a.effective_status||'';});
    adInsights.forEach(a=>{a.effective_status=adStatusMap[a.ad_id]||'';});
    _gtCampaigns=campaigns;_gtInsights=insights;_gtAdInsights=adInsights;_gtAdsets=adsets;
    _gtLastLoadTime=new Date();updateGtUpdateStatus();
    if(_gtStatusTimer)clearInterval(_gtStatusTimer);
    _gtStatusTimer=setInterval(updateGtUpdateStatus,60000);
    _renderGtCampaigns(col,campaigns,insights,adInsights,adsets);
    // A aba da régua vive de campanhas reais no exemplo. Sem isto, trocar de conta
    // de anúncios (ou abrir a régua antes de os dados chegarem) deixava o exemplo
    // velho ou vazio, e o dono precisava passar pela aba Campanhas primeiro.
    if(_gtAbaAtiva==='regua') _gtTrocarAba('regua');
    // A FILA também segue a conta selecionada — repinta sem rebuscar nada (os
    // itens já estão em memória; só o recorte muda).
    if(_gtAbaAtiva==='fila') _gtTrocarAba('fila');
    // Reset AI analyze button
    const btn=document.getElementById('gt-analyze-btn');
    if(btn){btn.disabled=false;btn.innerHTML='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>Analisar com Agente IA';}
  }catch(e){
    col.innerHTML=`<div class="gt-camp-card"><div class="gt-empty">Erro ao carregar dados:<br>${e.message}</div></div>`;
  }
}
// Botão manual de pausar/reativar SEMPRE disponível, independente do veredito.
// kind='campaign'|'ad'. Retorna o <button> ou null (para status sem toggle).
function _gtManualToggleBtn(kind,id,status,nome){
  const nm=_gtEsc(nome||(kind==='ad'?'o anúncio':'a campanha'));
  let action=null;
  if(status==='ACTIVE'){
    action=kind==='ad'
      ?{type:'pause_ad',id,_t:'Pausar anúncio?',_d:`"${nm}" será PAUSADO na Meta agora.`}
      :{type:'pause_campaign',id,_t:'Pausar campanha?',_d:`"${nm}" será PAUSADA na Meta agora.`};
  }else if(status==='PAUSED'){
    action=kind==='ad'
      ?{type:'activate_ad',id,_t:'Ativar anúncio?',_d:`"${nm}" voltará a ATIVO e a gastar na Meta.`}
      :{type:'activate_campaign',id,_t:'Reativar campanha?',_d:`"${nm}" voltará a ATIVA e a gastar na Meta.`};
  }
  if(!action)return null; // ARCHIVED/encerrada: sem toggle
  const b=document.createElement('button');
  b.className='gt-act-btn '+(status==='ACTIVE'?'':'success');
  b.textContent=status==='ACTIVE'?'⏸ Pausar':'▶ Reativar';
  b.style.opacity='.9';
  b.addEventListener('click',e=>{e.stopPropagation();_gtApplyAction(action,b,null);});
  return b;
}
// ── Pausar em massa ────────────────────────────────────────────────────────
// Caixa de seleção da campanha/anúncio. Devolve null quando o item NÃO pode ser
// selecionado (só ATIVO entra — pausar o que já está pausado não faz nada).
function _gtSelCaixa(kind,id,nome,podeSelecionar){
  if(!podeSelecionar)return null;
  const chave=kind+':'+id;
  const cb=document.createElement('input');
  cb.type='checkbox';cb.className='gt-sel-cb';
  cb.checked=_gtSelecao.has(chave);
  cb.title='Marcar para pausar junto com os outros';
  // O clique na linha da campanha ABRE/FECHA os anúncios; sem isto, marcar a
  // caixa também expandia o painel.
  cb.addEventListener('click',e=>e.stopPropagation());
  cb.addEventListener('change',()=>{
    if(cb.checked)_gtSelecao.set(chave,{kind,id,nome:nome||(kind==='ad'?'anúncio sem nome':'campanha sem nome')});
    else _gtSelecao.delete(chave);
    _gtPintarBarraSelecao();
  });
  return cb;
}
// Barra flutuante que aparece só quando há algo marcado. Vai pendurada na RAIZ
// da tela (não no body) por dois motivos: o CSS daqui é scoped, e assim ela some
// sozinha quando o usuário troca de tela.
function _gtPintarBarraSelecao(){
  const raiz=document.querySelector('.tela-gestao-trafego');
  let bar=document.getElementById('gt-massa-bar');
  if(!_gtSelecao.size||!raiz){if(bar)bar.remove();return;}
  if(!bar){bar=document.createElement('div');bar.id='gt-massa-bar';bar.className='gt-massa-bar';raiz.appendChild(bar);}
  const itens=[..._gtSelecao.values()];
  const nc=itens.filter(x=>x.kind==='campaign').length,na=itens.length-nc;
  const partes=[];
  if(nc)partes.push(nc+(nc===1?' campanha':' campanhas'));
  if(na)partes.push(na+(na===1?' anúncio':' anúncios'));
  bar.innerHTML='';
  const txt=document.createElement('div');txt.className='gt-massa-txt';
  txt.textContent='Selecionado: '+partes.join(' e ');
  const bPausar=document.createElement('button');
  bPausar.className='gt-massa-btn danger';bPausar.textContent='⏸ Pausar selecionados';
  bPausar.addEventListener('click',()=>_gtPausarSelecionados(bPausar));
  const bLimpar=document.createElement('button');
  bLimpar.className='gt-massa-btn';bLimpar.textContent='Limpar';
  bLimpar.addEventListener('click',()=>_gtLimparSelecao());
  bar.appendChild(txt);bar.appendChild(bLimpar);bar.appendChild(bPausar);
}
function _gtLimparSelecao(){
  _gtSelecao.clear();
  document.querySelectorAll('.gt-sel-cb').forEach(c=>{c.checked=false;});
  _gtPintarBarraSelecao();
}
// AÇÃO REAL EM MASSA. Mesma regra do resto da tela: confirmação ANTES de
// qualquer mutação, e aqui a confirmação LISTA nome por nome o que vai parar.
// As chamadas vão UMA DE CADA VEZ de propósito — disparar tudo junto já tomou
// rate-limit da Meta neste projeto.
async function _gtPausarSelecionados(btn){
  const tok=_gtCurAcc?.id;
  if(!tok){await _gtConfirm('Sem conta selecionada','Escolha uma conta de anúncios antes de pausar.',{okOnly:true});return;}
  const itens=[..._gtSelecao.values()];
  if(!itens.length)return;
  const lista=itens.map(it=>'<li>'+(it.kind==='campaign'?'Campanha':'Anúncio')+': <b>'+_gtEsc(it.nome)+'</b></li>').join('');
  const ok=await _gtConfirm(
    'Pausar '+itens.length+(itens.length===1?' item?':' itens de uma vez?'),
    'Vai ser PAUSADO na Meta agora:<ul style="margin:8px 0 0 18px;padding:0;">'+lista+'</ul>'
      +'<div style="margin-top:10px;">Pausar não apaga nada: para de gastar e dá pra reativar depois, um a um.</div>',
    {danger:true,okLabel:'Pausar tudo'});
  if(!ok)return;
  btn.disabled=true;
  const falhas=[];let feitos=0;
  for(const it of itens){
    btn.textContent='Pausando… '+(feitos+falhas.length+1)+'/'+itens.length;
    try{await metaPost('/'+it.id,{status:'PAUSED'},tok);feitos++;}
    catch(e){falhas.push({nome:it.nome,msg:String((e&&e.message)||e||'').slice(0,140)});}
  }
  _gtLimparSelecao();
  if(falhas.length){
    await _gtConfirm(
      'Pausados '+feitos+' de '+itens.length,
      'Não deu certo em '+falhas.length+':<ul style="margin:8px 0 0 18px;padding:0;">'
        +falhas.map(f=>'<li><b>'+_gtEsc(f.nome)+'</b> — '+_gtEsc(f.msg)+'</li>').join('')+'</ul>',
      {okOnly:true});
  }
  loadGtData();
}
// A campanha é DE WHATSAPP? Pergunta pra Meta, não pro resultado.
//
// O teste anterior era "tem alguma ação de mensagem?" — e UMA conversa avulsa
// bastava. Isso quebrou feio na conta que mais gasta: a "[TRÁFEGO] VIAGENS |
// PERFIL" da Raíssa (R$ 5.706, 4.601 curtidas e 18 conversas de tabela) era
// julgada a R$ 317 por conversa contra uma meta de R$ 15 — vermelho gritante numa
// campanha que nem é de conversa. Ao todo, R$ 47 mil daquela conta estavam sendo
// medidos no mercado errado.
//
// O sinal certo vem do CONJUNTO: campanha de WhatsApp de verdade tem
// destination_type WHATSAPP (e optimization_goal CONVERSATIONS). Conferido ao vivo:
// Vessel e Motoeasy usam CONVERSATIONS/WHATSAPP; as da Raíssa que pegavam conversa
// de tabela são VISIT_INSTAGRAM_PROFILE, PROFILE_VISIT ou POST_ENGAGEMENT.
// Campanha "encerrada": ACTIVE no Meta mas com stop_time já no passado.
function _gtEncerrada(camp,nowMs){
  if(!camp||camp.effective_status!=='ACTIVE'||!camp.stop_time)return false;
  const t=Date.parse(camp.stop_time);
  return !Number.isNaN(t)&&t<nowMs;
}
const GT_CRIT={
  minSpend:20,minImpr:1000, freqSat:4,freqAtt:3.5,
  lead:{pausSpend:80,pausImpr:4000,escCTR:2.0,escCPLf:0.85,monCTR:1.5,monSpend:50},
  traffic:{pausCTR:0.5,pausSpend:40,pausImpr:2000,escCTR:2.0,escCPC:2.0,monCTR:1.0,monSpend:40},
  engagement:{pausSpend:60,pausEng:10,pausImpr:2000,escEng:100,escCTR:1.0,monCTR:0.5,monSpend:30},
  video:{monSpend:50,monViews:100,escViews:500,escCTR:0.8},
};
// Controle de edição manual de orçamento — serve tanto pra CAMPANHA (CBO)
// quanto pra CONJUNTO de anúncios (ABO). Quem decide se é editável é o módulo
// puro (podeEditarOrcamentoDa*); aqui só se desenha o veredito dele.
// perm: {editavel,motivo}; orc: orcamentoDe(entidade) ou null.
function _gtBudgetEditHtml(perm,orc){
  const valor=orc
    ?(orc.tipo==='diario'?`<b>${_maFmtR(orc.reais)}/dia</b>`:`<b>${_maFmtR(orc.reais)}</b> no total`)
    :null;
  if(perm&&perm.editavel){
    return `<div class="gt-budget-edit">
      <span class="gt-be-cur">Orçamento: ${valor}</span>
      <button data-gt-edit-toggle="1" class="gt-be-link">✎ editar</button>
      <span data-gt-edit-box="1" class="gt-be-box" hidden>
        <input data-gt-manual="1" type="number" min="1" step="1" placeholder="R$/dia">
        <button data-gt-manual-ok="1" class="gt-act-btn primary" style="font-size:calc(10px*var(--gt-fs,1.3));">Aplicar</button>
      </span>
    </div>`;
  }
  const nota=perm&&perm.motivo?`<span class="gt-be-nota">${_gtEsc(perm.motivo)}</span>`:'';
  if(!valor&&!nota)return '';
  return `<div class="gt-budget-edit">${valor?`<span class="gt-be-cur">Orçamento: ${valor}</span>`:''}${nota}</div>`;
}
// Liga o par "✎ editar" + "Aplicar" dentro de `el`. Vale pra campanha e pra
// conjunto — muda só o id do alvo e o texto da confirmação.
// alvo: {id, nome, atualReais, nivelLbl:'da campanha'|'do conjunto', nivelNome:'Campanha'|'Conjunto'}
function _gtWireBudgetManual(el,alvo){
  if(!el||!alvo)return;
  const tgl=el.querySelector('[data-gt-edit-toggle]'),box=el.querySelector('[data-gt-edit-box]');
  if(tgl&&box)tgl.addEventListener('click',ev=>{ev.stopPropagation();box.hidden=!box.hidden;if(!box.hidden){const i=box.querySelector('[data-gt-manual]');if(i)i.focus();}});
  const inp=el.querySelector('[data-gt-manual]'),bMan=el.querySelector('[data-gt-manual-ok]');
  if(!bMan||!inp)return;
  bMan.addEventListener('click',ev=>{ev.stopPropagation();
    const v=parseFloat(inp.value);
    if(!Number.isFinite(v)||v<=0){inp.style.borderColor='var(--red)';return;}
    inp.style.borderColor='';
    const cent=Math.round(v*100);
    const antes=alvo.atualReais!=null?_maFmtR(alvo.atualReais)+'/dia':'orçamento atual';
    // ANTES → DEPOIS explícito: é dinheiro real saindo da conta do dono.
    _gtApplyAction({type:'update_budget',id:alvo.id,budget:cent,
      _t:`Aplicar orçamento ${alvo.nivelLbl}?`,
      _d:`${alvo.nivelNome} "${_gtEsc(alvo.nome)}":<br><b>${antes}</b> → <b>${_maFmtR(v)}/dia</b>`},bMan,el);
  });
}
// Público de UM conjunto, buscado na hora. O Gestor não traz targeting na
// carga da tela de propósito: pedir isso de todos os conjuntos em toda carga
// deixaria a tela lenta pra um dado que quase nunca é olhado.
async function _gtBuscarPublico(adsetId){
  const tok=_gtCurAcc?.id;
  if(!tok)return null;
  const r=await metaFetch('/'+adsetId,{fields:'targeting,effective_status'},tok);
  return r||null;
}

// Públicos personalizados da conta (remarketing e semelhantes). Buscados UMA
// vez por conta e reaproveitados: a lista muda pouco e a chamada é cara.
let _gtPublicosSalvos=null;      // {conta, lista} | null
// OS PÚBLICOS SALVOS DE VERDADE. `customaudiences` (a função abaixo) são LISTAS
// DE PESSOAS; público salvo é uma SEGMENTAÇÃO guardada, e mora noutro endereço.
// A tela chamava as listas de "públicos salvos" — daí a reclamação do dono de
// que o público já tinha localização e ela pedia a cidade de novo.
let _gtPubSalvosDeVerdade=null;   // null = não carregou; [] = a conta não tem
// Qual público salvo está valendo, e o filtro da lista. Ficam AQUI e não no
// `_gtPub`: são estado de tela (o que está marcado, o que está sendo buscado),
// e não parte do público que vai para a Meta — misturar faria os dois viajarem
// juntos para o rascunho e para o targeting.
let _gtPubSalvoEscolhido='';
let _gtPubSalvoBusca='';
// Busca sem acento e sem caixa: quem procura "gastronomia" tem que achar
// "Gastronomia SP", e quem digita "publico" tem que achar "PúblicoQuente".
const _gtSemAcento=(x)=>String(x||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
let _gtPubSugestaoDados=null;     // a sugestão vinda dos números da conta
let _gtPubSugerindo=false;
async function _gtListarPublicosDeVerdade(){
  const tok=_gtCurAcc?.id, accId=_gtCurAcc?.ad_account_id;
  if(!tok||!accId)return null;
  try{
    const r=await metaFetch(`/act_${_maCleanAccId(accId)}/saved_audiences`,
      {fields:'id,name,targeting',limit:100},tok);
    return lerSalvos((r&&r.data)||[]);
  }catch(e){ return null; }
}

async function _gtListarPublicosSalvos(){
  const tok=_gtCurAcc?.id;
  const accId=_gtCurAcc?.ad_account_id;
  // null = "não consegui carregar", e é isso mesmo que acontece sem conta: []
  // faria a tela afirmar "esta conta não tem público salvo", que é outra coisa
  // e não é verdade.
  if(!tok||!accId)return null;
  // Chave do cache é o AD ACCOUNT (ad_account_id), não o carrier do proxy
  // (_gtCurAcc.id): o mesmo carrier pode servir várias contas de anúncio
  // (descoberta via /me/adaccounts), então cachear por carrier vazaria a
  // lista de públicos de uma conta pra dentro de outra.
  if(_gtPublicosSalvos&&_gtPublicosSalvos.conta===accId)return _gtPublicosSalvos.lista;
  // Falha aqui NÃO derruba o editor: lista opcional que não carrega não pode
  // impedir o dono de trocar uma cidade.
  const r=await metaFetchAll(`/act_${_maCleanAccId(accId)}/customaudiences`,
    {fields:'id,name,subtype',limit:200},tok).catch(()=>null);
  if(r===null)return null;       // null = "não consegui carregar", [] = "não tem nenhum"
  _gtPublicosSalvos={conta:accId,lista:r};
  return r;
}

// Públicos prontos montados no Estúdio (tabela fabrica_publicos, leitura
// liberada para autenticados). Escolher um PREENCHE o editor; não salva.
async function _gtListarPresets(){
  const{data,error}=await sbClient.from('fabrica_publicos')
    .select('id,nome,geo,idade_min,idade_max,generos,interesses,custom_audiences')
    .eq('ativo',true).order('created_at',{ascending:false});
  return error?null:(data||[]);
}
// Botão "⧉ Duplicar". Só existe para quem tem permissão de EDITAR nesta
// ferramenta — mesmo critério do orçamento. Duplicar cria objeto novo na
// conta, então fica no portão mais rígido que a tela já usa.
function _gtBotaoDuplicar(alvo){
  if(!hasPermission('meta.gestor','editar'))return null;
  const b=document.createElement('button');
  b.className='gt-btn-dup';b.textContent='⧉ Duplicar';b.title='Criar uma cópia pausada';
  b.addEventListener('click',ev=>{ev.stopPropagation();_gtAbrirDuplicar(alvo);});
  return b;
}
// Só a edição MANUAL do orçamento. Os botões "Aplicar R$ X/dia" e "Pausar
// campanha" da faixa de recomendação saíram junto com a faixa (2026-07-29): com
// a fila existindo, eles eram um segundo caminho pra verba que não deixava
// registro de decisão. O que sobra aqui é o dono agindo por conta própria.
function _gtWireBudgetControls(el,ins,camp,permCamp){
  if(!el)return;
  const daily=camp?.daily_budget?parseFloat(camp.daily_budget)/100:null;
  _gtWireBudgetManual(el,{id:ins.campaign_id,nome:ins.campaign_name||camp?.name||'a campanha',atualReais:daily,nivelLbl:'da campanha',nivelNome:'Campanha'});
}
// ── Selo de OBJETIVO POR INTERAÇÃO (Fase 3) ─────────────────────────────────
// Só aparece em campanha/anúncio de engajamento que NÃO seja de mensagem (o
// mesmo recorte do custo por ponto: WhatsApp já tem o resultado dele — conversa
// — e não faz sentido perguntar qual interação ele compra). Sem declaração,
// selo neutro "Objetivo: ponderado"; declarado, mostra o rótulo da interação.
// Clicar abre um menu com as quatro interações + "Voltar ao ponderado" — mesma
// linguagem visual do chip CBO/ABO (gt-nivel-chip), só que clicável.
let _gtMenuObjAberto=null;
let _gtMenuObjFechar=null; // limpeza dos listeners (clicar fora/Esc/rolar) do menu aberto agora
function _gtFecharMenuObjetivo(){
  if(_gtMenuObjFechar){_gtMenuObjFechar();_gtMenuObjFechar=null;}
  if(_gtMenuObjAberto){_gtMenuObjAberto.remove();_gtMenuObjAberto=null;}
}
// Posiciona o menu FLUTUANTE (position:fixed) em relação ao próprio selo,
// abrindo pra cima quando não sobra espaço embaixo (ver M5 do review abaixo).
function _gtPosicionarMenuObjetivo(menu,chip){
  const r=chip.getBoundingClientRect();
  const altura=menu.offsetHeight||170; // estimativa antes do 1º layout medido
  const largura=menu.offsetWidth||170; // idem, mesmo raciocínio (min-width:170px no CSS)
  const margem=8; // respiro mínimo até a borda da tela
  // B3 do review (2026-07-28): sem clamp, perto da borda direita de um celular
  // o menu nascia com left = chip.left e boa parte da largura vazava pra fora
  // da viewport — inclusive "Voltar ao ponderado", a única forma de desfazer.
  // Clampa o left pra sempre caber inteiro na tela, com uma margem mínima; o
  // flip pra cima quando não sobra espaço embaixo (abaixo) continua igual.
  const maxLeft=window.innerWidth-largura-margem;
  menu.style.left=Math.round(Math.max(margem,Math.min(r.left,maxLeft)))+'px';
  if(r.bottom+6+altura<=window.innerHeight){
    menu.style.top=Math.round(r.bottom+6)+'px';menu.style.bottom='';
  }else{
    menu.style.top='';menu.style.bottom=Math.round(window.innerHeight-r.top+6)+'px';
  }
}
function _gtAbrirMenuObjetivo(chip,alvoId,nivel){
  const mesmoChip=_gtMenuObjAberto&&_gtMenuObjAberto.__gtChip===chip;
  _gtFecharMenuObjetivo();
  if(mesmoChip)return; // clicar de novo no mesmo selo fecha o menu
  // M5 do review (2026-07-28): o menu NÃO pode morar dentro do selo. Os
  // ancestrais (.gt-camp-row, .gt-camp-row-ads) têm overflow:hidden pra conter
  // o scroll da lista, e um menu position:absolute ali dentro fica CORTADO —
  // tanto numa linha de campanha recolhida quanto no ÚLTIMO anúncio de cada
  // campanha, exatamente onde mora "Voltar ao ponderado" (a opção de baixo).
  // A saída é pendurar na RAIZ da tela (mesmo truque já usado pela barra de
  // seleção em massa, ver _gtPintarBarraSelecao) com position:fixed e
  // coordenadas calculadas do próprio selo — assim nenhum overflow:hidden de
  // ancestral alcança o menu.
  const raiz=document.querySelector('.tela-gestao-trafego');
  if(!raiz)return;
  const menu=document.createElement('div');menu.className='pnd-obj-menu';menu.__gtChip=chip;
  menu.addEventListener('click',e=>e.stopPropagation());
  const linhas=Object.keys(INTERACOES).map(k=>
    `<button type="button" class="pnd-obj-opt" data-int="${_gtEsc(k)}">${_gtEsc(INTERACOES[k].rotulo)}</button>`).join('');
  menu.innerHTML=linhas+`<button type="button" class="pnd-obj-opt pnd-obj-limpar" data-int="">Voltar ao ponderado</button>`;
  menu.querySelectorAll('.pnd-obj-opt').forEach(btn=>{
    btn.addEventListener('click',e=>{
      e.stopPropagation();
      _gtFecharMenuObjetivo();
      _gtSalvarObjetivo(alvoId,nivel,btn.dataset.int||null);
    });
  });
  raiz.appendChild(menu);
  _gtMenuObjAberto=menu;
  _gtPosicionarMenuObjetivo(menu,chip);
  // Fecha ao clicar fora, apertar Esc ou rolar qualquer parte da tela. O
  // setTimeout(...,0) é o mesmo truque de sempre (ver dropdown de contas,
  // _gtDocClick): sem ele, o PRÓPRIO clique que abriu o menu já chegaria no
  // document e fecharia na mesma hora.
  setTimeout(()=>{
    const aoClicarFora=e=>{ if(!menu.contains(e.target)) _gtFecharMenuObjetivo(); };
    const aoTeclar=e=>{ if(e.key==='Escape') _gtFecharMenuObjetivo(); };
    const aoRolar=()=>_gtFecharMenuObjetivo();
    document.addEventListener('click',aoClicarFora);
    document.addEventListener('keydown',aoTeclar);
    window.addEventListener('scroll',aoRolar,true);
    _gtMenuObjFechar=()=>{
      document.removeEventListener('click',aoClicarFora);
      document.removeEventListener('keydown',aoTeclar);
      window.removeEventListener('scroll',aoRolar,true);
    };
  },0);
}
// Devolve o <span> do selo, ou null quando este balde não é elegível (não é
// engajamento, ou é engajamento mas de mensagem). `alvoId` é o id da campanha
// OU do anúncio na Meta; `nivel` é 'campanha'|'anuncio' (grava em
// gt_objetivo_interacao.nivel).
function _gtSeloObjetivoEl(alvoId,nivel,elegivel){
  if(!elegivel)return null;
  const decl=_gtObjetivoInteracao[String(alvoId)];
  // M3 do review (2026-07-28): se a ÚLTIMA leitura de _gtCarregarObjetivos
  // falhou E este alvo não está no mapa (nunca vimos declaração dele em
  // memória), não dá pra afirmar "ponderado" — pode existir uma declaração
  // real no banco que a leitura falhou em trazer. Mostrar "ponderado" seria
  // uma mentira que o dono não tem como perceber, igual ao defeito já
  // corrigido na régua (fail-closed / _gtReguaCarregada). Escolhido um rótulo
  // neutro ("indisponível") em vez de, por ex., esconder o selo inteiro ou
  // escurecer o cartão todo — é a mudança visual MÍNIMA que ainda avisa sem
  // alarmar, e o selo continua clicável (declarar de novo não depende desta
  // leitura ter dado certo).
  const desconhecido=!decl&&!_gtObjetivoInteracaoCarregada;
  // H2(a) do review: gate de permissão igual ao resto da tela — mesmo
  // critério da RLS de escrita (admin OU feature 'meta.gestor', ver migration
  // 20260728_objetivo_por_interacao.sql). Sem isto, um usuário só-leitura
  // clicava, a escrita batia na RLS, e o toast mostrava o erro cru do
  // Postgres em vez de uma frase em português.
  const podeEditar=hasPermission('meta.gestor','editar');
  const chip=document.createElement('span');
  chip.className='pnd-obj-chip'+(decl?' declarado':'')+(podeEditar?'':' readonly');
  chip.textContent=decl
    ?('Objetivo: '+(INTERACOES[decl]?.rotulo||decl))
    :desconhecido?'Objetivo: indisponível':'Objetivo: ponderado';
  if(desconhecido){
    chip.title='Não consegui confirmar as declarações agora — recarregue antes de decidir por este selo.';
  }else if(podeEditar){
    chip.title='Declarar qual interação '+(nivel==='campanha'?'esta campanha':'este anúncio')+' está comprando';
  }else{
    chip.title='Você não tem permissão para editar esta ferramenta.';
  }
  if(podeEditar)chip.addEventListener('click',e=>{e.stopPropagation();_gtAbrirMenuObjetivo(chip,alvoId,nivel);});
  return chip;
}
function _renderGtCampaigns(col,campaigns,insights,adInsights,adsets){
  const campMap={};campaigns.forEach(c=>campMap[c.id]=c);
  const adByCamp={};adInsights.forEach(a=>{if(!adByCamp[a.campaign_id])adByCamp[a.campaign_id]=[];adByCamp[a.campaign_id].push(a);});
  // Conjuntos por campanha — é o que permite saber se o orçamento é da
  // campanha (CBO) ou dos conjuntos (ABO) e mostrar a camada do meio.
  const setsByCamp={};(adsets||[]).forEach(s=>{const k=String(s.campaign_id||'');if(!setsByCamp[k])setsByCamp[k]=[];setsByCamp[k].push(s);});
  // Quantas campanhas cada objetivo tem NESTA conta — o número no botão evita
  // clicar num filtro pra descobrir que ele está vazio.
  const contagem={};
  for(const ins of insights){
    const c=campMap[ins.campaign_id];
    const b=baldeEfetivo((c&&c.objective)||ins.objective||'', setsByCamp[String(ins.campaign_id)]||[]);
    contagem[b]=(contagem[b]||0)+1;
  }
  // Filtro que aponta pra um objetivo que sumiu (troca de conta, mudança de
  // período) se desfaz sozinho — senão a lista fica vazia sem explicação.
  if(_gtFiltroObjetivo&&!contagem[_gtFiltroObjetivo])_gtFiltroObjetivo='';
  const todas=[...insights].sort((a,b)=>parseFloat(b.spend||0)-parseFloat(a.spend||0));
  const sorted=_gtFiltroObjetivo
    ? todas.filter(ins=>{const c=campMap[ins.campaign_id];
        return baldeEfetivo((c&&c.objective)||ins.objective||'', setsByCamp[String(ins.campaign_id)]||[])===_gtFiltroObjetivo;})
    : todas;
  const card=document.createElement('div');card.className='gt-camp-card';
  const hdr=document.createElement('div');hdr.className='gt-camp-hdr';
  const ttlWrap=document.createElement('div');ttlWrap.style.cssText='display:flex;align-items:center;gap:10px;';
  const ttl=document.createElement('div');ttl.style.cssText='font-family:var(--fonte-principal);font-size:calc(12px*var(--gt-fs,1.3));font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:var(--text);';
  ttl.textContent=sorted.length+' Campanhas';
  const aiTag=document.createElement('div');
  aiTag.style.cssText='font-family:var(--fonte-principal);font-size:calc(9px*var(--gt-fs,1.3));font-weight:700;letter-spacing:.5px;padding:2px 7px;border-radius:20px;background:var(--accent-light);color:var(--accent-forte);text-transform:uppercase;';
  aiTag.textContent='✦ IA em tempo real';
  ttlWrap.appendChild(ttl);ttlWrap.appendChild(aiTag);
  const searchInp=document.createElement('input');
  searchInp.type='text';searchInp.placeholder='Buscar campanha…';
  searchInp.style.cssText='padding:6px 10px;border:1px solid var(--border);border-radius:7px;background:var(--surface2);color:var(--text);font-family:var(--fonte-principal);font-size:calc(11px*var(--gt-fs,1.3));outline:none;width:180px;transition:border-color .15s;';
  searchInp.addEventListener('focus',()=>searchInp.style.borderColor='var(--accent)');
  searchInp.addEventListener('blur',()=>searchInp.style.borderColor='var(--border)');
  // Status filter buttons
  const filterWrap=document.createElement('div');filterWrap.style.cssText='display:flex;gap:4px;flex-shrink:0;';
  const filterDefs=[{v:'all',l:'Todas'},{v:'active',l:'Ativas'},{v:'inactive',l:'Inativas'}];
  const filterBtns={};
  filterDefs.forEach(fd=>{
    const fb=document.createElement('button');
    fb.textContent=fd.l;
    const isActive=_gtStatusFilter===fd.v;
    fb.style.cssText=`font-family:var(--fonte-principal);font-size:calc(10px*var(--gt-fs,1.3));font-weight:600;padding:4px 10px;border-radius:5px;cursor:pointer;transition:all .15s;letter-spacing:.3px;border:1px solid ${isActive?'var(--accent)':'var(--border)'};background:${isActive?'var(--accent-light)':'none'};color:${isActive?'var(--accent)':'var(--muted)'};`;
    fb.addEventListener('click',()=>{
      _gtStatusFilter=fd.v;
      Object.entries(filterBtns).forEach(([k,b])=>{
        const on=k===fd.v;
        b.style.borderColor=on?'var(--accent)':'var(--border)';
        b.style.background=on?'var(--accent-light)':'none';
        b.style.color=on?'var(--accent)':'var(--muted)';
      });
      renderList(searchInp.value);
    });
    filterBtns[fd.v]=fb;filterWrap.appendChild(fb);
  });
  // Recolher/expandir TUDO (conjuntos e anúncios de todas as campanhas).
  // _gtRecolhido é lembrado entre redesenhos: quem recolheu tudo não vê
  // tudo abrir de novo a cada ↻ ou troca de filtro.
  const collapseBtn=document.createElement('button');
  collapseBtn.className='gt-collapse-all';
  collapseBtn.type='button';
  const pintaCollapse=()=>{
    collapseBtn.textContent=_gtRecolhido?'⊞ Expandir tudo':'⊟ Recolher tudo';
    collapseBtn.title=_gtRecolhido
      ?'Abrir os conjuntos de anúncios e os anúncios de todas as campanhas'
      :'Fechar os conjuntos de anúncios e os anúncios de todas as campanhas';
  };
  pintaCollapse();
  collapseBtn.addEventListener('click',()=>{
    _gtRecolhido=!_gtRecolhido;
    pintaCollapse();
    // Aplica no que já está na tela, sem refazer as chamadas à Meta.
    card.querySelectorAll('.gt-camp-row-ads,.gt-set-pane').forEach(p=>{
      p.classList.toggle('open',!_gtRecolhido);
      if(!_gtRecolhido&&!p.dataset.loaded&&p.__gtRender){p.dataset.loaded='1';p.__gtRender();}
    });
    card.querySelectorAll('.gt-chevron,.gt-set-chevron').forEach(c=>c.classList.toggle('open',!_gtRecolhido));
  });
  const hdrRight=document.createElement('div');hdrRight.style.cssText='display:flex;align-items:center;gap:8px;flex-wrap:wrap;';
  hdrRight.appendChild(collapseBtn);hdrRight.appendChild(filterWrap);hdrRight.appendChild(searchInp);
  hdr.appendChild(ttlWrap);hdr.appendChild(hdrRight);
  card.appendChild(hdr);
  // Barra de objetivos: só aparece quando há mais de um na conta — com um só,
  // filtrar não separa nada.
  const objs=Object.keys(contagem).sort((a,b)=>contagem[b]-contagem[a]);
  if(objs.length>1){
    const barra=document.createElement('div');barra.className='gt-obj-filtros';
    const faz=(chave,rot,n)=>{
      const b=document.createElement('button');
      b.className='gt-obj-filtro'+(_gtFiltroObjetivo===chave?' ativo':'');
      b.innerHTML=`${_gtEsc(rot)}<span class="gt-obj-n">${n}</span>`;
      b.addEventListener('click',ev=>{ev.stopPropagation();_gtFiltroObjetivo=chave;_renderGtCampaigns(col,campaigns,insights,adInsights,adsets);});
      return b;
    };
    barra.appendChild(faz('','Todos',todas.length));
    // _gtRotuloObjetivo lê de LEITURA (funil.js) — a MESMA fonte que o modal do
    // funil usa. A versão anterior tentava `ALVOS[o].rotuloCurto`: ALVOS não
    // estava importado e `rotuloCurto` não existe em alvos.js, dois erros na
    // mesma linha que só apareciam quando a lista era montada.
    for(const o of objs) barra.appendChild(faz(o,_gtRotuloObjetivo(o),contagem[o]));
    card.appendChild(barra);
  }
  const list=document.createElement('div');list.className='gt-camp-list';card.appendChild(list);
  const tok=_gtCurAcc?.id;
  function renderList(q){
    list.innerHTML='';
    const filtered=sorted.filter(ins=>{
      if(q&&!(ins.campaign_name||'').toLowerCase().includes(q.toLowerCase()))return false;
      const st=campMap[ins.campaign_id]?.effective_status||'';
      if(_gtStatusFilter==='active')return st==='ACTIVE';
      if(_gtStatusFilter==='inactive')return st==='PAUSED'||st==='ARCHIVED';
      return true;
    });
    if(!filtered.length){list.innerHTML='<div class="gt-empty">Nenhuma campanha encontrada</div>';return;}
    filtered.forEach((ins,i)=>{
      const camp=campMap[ins.campaign_id];
      const status=camp?.effective_status||'';
      const encerrada=_gtEncerrada(camp,Date.now());
      const statusColor=status==='ACTIVE'?'var(--green)':status==='PAUSED'?'var(--orange)':'var(--muted)';
      const spend=parseFloat(ins.spend||0);
      const daily=camp?.daily_budget?parseFloat(camp.daily_budget)/100:null;
      const ads=adByCamp[ins.campaign_id]||[];
      // Onde mora o orçamento desta campanha? (módulo puro, testado)
      const conjuntos=setsByCamp[String(ins.campaign_id)]||[];
      const nivelOrc=detectarNivelOrcamento(camp,conjuntos);
      const hier=montarHierarquia(conjuntos,ads);
      const kpiObjective=ins.objective||camp?.objective||'';
      const row=document.createElement('div');row.className='gt-camp-row';
      const inner=document.createElement('div');inner.className='gt-camp-inner';
      // Top line
      const top=document.createElement('div');top.className='gt-camp-top';
      // Status badge
      const badge=document.createElement('div');
      const badgeCls=encerrada?'inactive':(status==='ACTIVE'?'active':status==='PAUSED'?'paused':'inactive');
      const badgeLbl=encerrada?'Concluído':(status==='ACTIVE'?'Ativo':status==='PAUSED'?'Pausado':status==='ARCHIVED'?'Arquivado':'Inativo');
      badge.className=`gt-status-badge ${badgeCls}`;badge.textContent=badgeLbl;
      const nm=document.createElement('div');nm.className='gt-name';nm.title=ins.campaign_name||'';nm.textContent=ins.campaign_name||'—';
      const chips=document.createElement('div');chips.style.cssText='display:flex;align-items:center;gap:8px;flex-shrink:0;';
      // Selo de ONDE fica o orçamento — em português, com a sigla entre parênteses.
      const selo=nivelOrc.sigla
        ?`<span class="gt-nivel-chip ${nivelOrc.sigla==='CBO'?'cbo':'abo'}" title="${_gtEsc(nivelOrc.explicacao)}">${nivelOrc.sigla==='CBO'?'Orçamento na campanha (CBO)':'Orçamento nos conjuntos (ABO)'}</span>`
        :'';
      chips.innerHTML=`<span class="ma-obj-chip" style="font-size:calc(9px*var(--gt-fs,1.3));">${_maObjLabel(ins.objective)}</span>${selo}${daily?`<span style="font-family:var(--fonte-principal);font-size:calc(10px*var(--gt-fs,1.3));font-weight:600;color:var(--muted);">${_maFmtR(daily)}/dia</span>`:''}`;
      // KPIs por objetivo (balde da campanha — ver GT_METRIC_CATALOG/_gtBalde)
      const metrics=document.createElement('div');metrics.className='gt-metrics';
      metrics.innerHTML=_gtKpisHtml(Object.assign({},ins,{objective:kpiObjective}));
      const spendEl=document.createElement('div');spendEl.className='gt-spend';spendEl.textContent=_maFmtR(spend);
      const adCount=ads.length;
      const setCount=hier.length;
      const hint=document.createElement('span');hint.className='gt-expand-hint';
      // Agora a expansão mostra CONJUNTOS → anúncios, então o rótulo conta os dois.
      hint.textContent=setCount>0
        ?`${setCount} conjunto${setCount!==1?'s':''} · ${adCount} anúncio${adCount!==1?'s':''}  ▾`
        :'sem conjuntos';
      const chev=document.createElement('svg');chev.setAttribute('class','gt-chevron');chev.setAttribute('width','12');chev.setAttribute('height','12');chev.setAttribute('viewBox','0 0 24 24');chev.setAttribute('fill','none');chev.setAttribute('stroke','currentColor');chev.setAttribute('stroke-width','2.5');chev.setAttribute('stroke-linecap','round');chev.setAttribute('stroke-linejoin','round');chev.innerHTML='<polyline points="9 18 15 12 9 6"/>';
      const l1=document.createElement('div');l1.className='gt-camp-l1';
      const numEl=document.createElement('div');numEl.className='gt-camp-num';numEl.textContent=String(i+1).padStart(2,'0');
      // Caixa de "pausar em massa": só para campanha ATIVA e não encerrada — é
      // exatamente o mesmo critério do botão ⏸ Pausar individual.
      const selCb=_gtSelCaixa('campaign',ins.campaign_id,ins.campaign_name||camp?.name,status==='ACTIVE'&&!encerrada);
      if(selCb)l1.appendChild(selCb);
      l1.appendChild(numEl);l1.appendChild(badge);l1.appendChild(nm);l1.appendChild(spendEl);
      const l2=document.createElement('div');l2.className='gt-camp-l2';
      const exp=document.createElement('div');exp.className='gt-camp-exp';exp.appendChild(hint);exp.appendChild(chev);
      l2.appendChild(chips);l2.appendChild(metrics);l2.appendChild(exp);
      top.appendChild(l1);top.appendChild(l2);
      // PONDERADA: pontos e custo por ponto desta campanha, com a régua do dono.
      const qtdsPnd = quantidadesDoInsight(ins);
      const baldeCamp = _gtBalde(kpiObjective);
      // Campanha de MENSAGEM (WhatsApp/Direct) nunca pode ter o veredito decidido
      // pela ponderada, mesmo caindo no balde 'engajamento': no setup moderno da
      // Meta, WhatsApp chega como objetivo OUTCOME_ENGAGEMENT (ver GT_OBJETIVO_BALDE),
      // então herdaria a meta de engajamento — mas o que essa campanha VENDE é
      // conversa, não curtida/comentário/salvamento. Medindo campanhas reais, o
      // custo por ponto delas ficou entre R$ 2,97 e R$ 7,21 — pintaria de vermelho
      // campanhas que estão indo bem no que de fato prometem, só porque engajamento
      // não é o que compram. Mesma classe de defeito já corrigida pra vendas/leads
      // (ver comentário na migration 20260728_ponderada_config.sql): a correção
      // aqui é tratar como "sem meta" (meta=0) qualquer campanha de ENGAJAMENTO
      // com ação de mensagem — calcularPonderada devolve faixa 'sem-dados' e
      // o julgamento cai pra saúde/objetivo, sem mexer em
      // no formato dos campos. O custo por ponto continua calculado e aparecendo
      // no cartão (custoPorPonto não depende da meta) — só o VEREDITO deixa de
      // ser guiado por ele.
      // O `&& baldeCamp==='engajamento'` é o que restringe este desvio ao caso
      // real (WhatsApp chegando como engajamento): uma campanha de LEAD ou de
      // TRÁFEGO que também dispara uma ação de mensagem (ex.: roteia pro
      // WhatsApp) já tem o alvo certo do seu PRÓPRIO balde — sem essa restrição,
      // esse desvio sequestrava um alvo correto que o dono acabou de ganhar
      // (I5 do review final, 2026-07-28).
      // A campanha e de WhatsApp? Vem do CONJUNTO (o que a Meta afirma), nao do
      // resultado. Inferir por "tem acao de mensagem" classificava no mercado
      // errado toda campanha que pegava uma conversa de tabela — ver _gtEhDeWhatsapp.
      // Mesma regra do robô: quem manda é o que a Meta afirma no conjunto, e vale
      // pra qualquer objetivo (ver baldeEfetivo em baldes.js).
      const temMensagem = ehDeWhatsapp(conjuntos);
      // Selo de objetivo por interação (Fase 3): só campanha de engajamento que
      // NÃO seja de mensagem pode declarar qual interação está comprando —
      // mesmo recorte do custo por ponto logo abaixo.
      const elegivelSeloObj = baldeCamp === 'engajamento' && !temMensagem;
      const seloObjEl = _gtSeloObjetivoEl(ins.campaign_id, 'campanha', elegivelSeloObj);
      if (seloObjEl) {
        chips.appendChild(seloObjEl);
        const objHelpWrap = document.createElement('span');
        objHelpWrap.innerHTML = _gtAjudaBtn('objetivo_declarado');
        if (objHelpWrap.firstElementChild) chips.appendChild(objHelpWrap.firstElementChild);
      }
      // O índice "custo por ponto" só existe pra engajamento — é o único balde
      // cujo resultado É o ponto da ponderada. Fora dele, dividir R$/ponto por
      // uma meta de outra unidade (R$/visita, R$/lead...) seria comparar
      // maçã com laranja: o chip pintava verde/vermelho contradizendo o
      // veredito do mesmo cartão (C2 do review final, 2026-07-28). meta=0 aqui
      // faz calcularPonderada devolver faixa 'sem-dados' (cor neutra), mas o
      // custo por ponto em si continua calculado e aparecendo — é informação,
      // não veredito.
      // A régua DA CONTA aberta, nunca a linha crua do banco: as cinco contas
      // moram no mesmo registro e cada uma tem sua meta (ver _gtReguaAtiva).
      const reguaAtiva = _gtReguaAtiva();
      const metaPnd = (baldeCamp === 'engajamento' && !temMensagem) ? metaDoBalde(reguaAtiva, 'engajamento') : 0;
      const pnd = calcularPonderada(qtdsPnd, { pesos: reguaAtiva.pesos, limiares: reguaAtiva.limiares, meta: metaPnd });

      // ALVO DO OBJETIVO: cada tipo de campanha é medido pelo resultado que ele
      // compra (lead, conversa, venda, visita, mil impressões) — e engajamento
      // pelo ponto da ponderada. A conta de cada um já existe no catálogo
      // (GT_METRIC_CATALOG). Campanha com resultado de mensagem entra como
      // 'mensagens' mesmo chegando com objetivo de engajamento — mesma correção
      // de sempre (ver comentário de temMensagem acima), só que agora em vez de
      // simplesmente cair fora da conta, ela ganha o alvo certo: custo por conversa.
      const alvo = temMensagem ? alvoDoBalde('mensagens') : alvoDoBalde(baldeCamp);
      let metaAlvo = metaDoBalde(reguaAtiva, temMensagem ? 'mensagens' : baldeCamp);
      let custoAlvo = !alvo ? null
        : alvo.metrica === 'ponderada' ? pnd.custoPorPonto
        : _gtMetricValue(alvo.metrica, ins);
      let rotuloAlvo = alvo;
      // OBJETIVO DECLARADO (Fase 3, Task 4): se o dono declarou, NESTA
      // campanha, qual interação ela compra, o veredito passa a julgar por
      // ESSE mercado — custo da interação declarada (custoDaInteracao, que
      // NUNCA inventa número: quantidade zero devolve null, não R$ 0,00)
      // contra a meta DAQUELA interação (metaDoBalde) — em vez do ponto
      // ponderado, que é 83% curtida em volume. Sem declaração
      // (_gtObjetivoInteracao vazio para este id), objDeclarado é null e nada
      // muda: segue com o alvo/meta/custo de sempre, calculados acima.
      const objDeclaradoBruto = elegivelSeloObj ? _gtObjetivoInteracao[String(ins.campaign_id)] : null;
      // Guarda (L7 do review, 2026-07-28): o CHECK constraint da tabela é a
      // única coisa que impede um valor fora das 4 interações de chegar aqui —
      // mas se algum dia escapar (linha antiga, edição direta no banco), indexar
      // INTERACOES[valor] sem checar antes derruba o forEach INTEIRO da lista de
      // campanhas. O caminho do anúncio (mais abaixo) já tinha esse cuidado.
      const objDeclarado = interacaoValida(objDeclaradoBruto) ? objDeclaradoBruto : null;
      if (objDeclarado) {
        custoAlvo = custoDaInteracao(qtdsPnd, objDeclarado);
        metaAlvo = metaDoBalde(reguaAtiva, objDeclarado);
        rotuloAlvo = { rotulo: INTERACOES[objDeclarado].rotuloCusto };
      }
      // QUAL CONJUNTO DE LIMIAR decide a cor: bucket engajamento (ponderada,
      // sem declaração) e qualquer interação declarada são "mundo do ponto" —
      // usam `limiares` (Seção 1 da régua). Todo o resto (reconhecimento,
      // tráfego, mensagens — inclusive por desvio de WhatsApp — leads,
      // vendas) é "mundo do resultado" — usa `limiares_resultado` (Seção 2).
      // Regra da régua (dois conjuntos, 2026-07-28): quem é dono da META é
      // dono do LIMIAR.
      const usaLimiaresDeEngajamento = (alvo && alvo.metrica === 'ponderada') || !!objDeclarado;
      const aval = avaliarAlvo({ custo: custoAlvo, meta: metaAlvo, limiares: usaLimiaresDeEngajamento ? reguaAtiva.limiares : reguaAtiva.limiares_resultado });

      // A PENDÊNCIA DA SAÚDE FECHOU (2026-08-03). Ela mora na Fila: `mesclarSaude`
      // gruda o alerta na linha que o robô propôs, marca quando os dois se
      // contradizem, e cria linha própria para campanha com alerta que o robô
      // não trouxe. Só nível 'alerta' vira linha; 'atenção' só aparece anexada —
      // é o que impede a fila de virar lista de tarefas.
      // Com o destino decidido, `_gtRegraCampanha`, `_gtVerdict`, `_gtObjCategory`
      // e `veredito.js` foram apagados: eram o julgamento do tempo em que ele
      // morava no cartão, e ninguém os chamava havia semanas.

      // O VEREDITO SAIU DAQUI. Quem decide o que fazer com a campanha é a aba
      // Fila, que junta saúde, robô e régua num lugar só e registra a decisão.
      // O cartão ficou com o que ele sabe dizer sem julgar: os números.
      // A leitura de saúde (saude.js) e a análise do robô continuam existindo —
      // a fila é que as consome agora.
      // Custo por ponto aparece SEMPRE, independente de quem deu o veredito:
      // é informação, não decisão.
      if (pnd.custoPorPonto != null) {
        // M4 do review (2026-07-28): campanha DECLARADA não pode mais ser
        // pintada pelo ranking do ponto — é exatamente o ranking que esta fase
        // considera errado pra ela. Sem isto, o cartão podia mostrar "Dentro da
        // meta" no veredito (julgado pela interação declarada) com este chip
        // do lado pintado de VERMELHO pelo ponto — uma contradição visual do
        // mesmo tipo já rejeitada num review anterior (C2). O chip continua
        // visível como referência (ainda é informação real), só deixa de
        // afirmar um julgamento que o cartão não segue mais.
        const cor = objDeclarado ? 'var(--muted)'
          : pnd.faixa === 'escalar-forte' || pnd.faixa === 'dentro-da-meta' ? 'var(--green)'
          : pnd.faixa === 'manter' ? 'var(--orange)' : pnd.faixa === 'otimizar' ? 'var(--red)' : 'var(--muted)';
        const extra = document.createElement('div');
        extra.className = 'gt-metric';
        extra.title = objDeclarado
          ? `${_maFmt(pnd.pontos, 0)} pontos · cada interação vale ${_maFmt(pnd.qualidade, 1)} · cor neutra porque esta campanha foi declarada e é julgada por ${INTERACOES[objDeclarado].rotulo.toLowerCase()}, não por ponto`
          : `${_maFmt(pnd.pontos, 0)} pontos · cada interação vale ${_maFmt(pnd.qualidade, 1)}`;
        extra.innerHTML = `Custo/ponto${_gtAjudaBtn('custo_por_ponto')} <span style="color:${cor}">${_maFmtR(pnd.custoPorPonto)}</span>`;
        metrics.appendChild(extra);
        // "Qualidade" só existia até aqui escondida dentro do title (tooltip) do
        // chip acima — nunca virava um número que o dono via sem passar o mouse.
        // Vira seu próprio chip, mesmo padrão, só pra dar rosto a essa métrica e
        // ao botão que a explica (ajuda.js: qualidade).
        if (pnd.qualidade != null) {
          const qualEl = document.createElement('div');
          qualEl.className = 'gt-metric';
          qualEl.innerHTML = `Qualidade${_gtAjudaBtn('qualidade')} <span>${_maFmt(pnd.qualidade, 1)}</span>`;
          metrics.appendChild(qualEl);
        }
      }
      // 1) TODO JULGAMENTO MORA NA FILA (decisão do dono, 2026-07-29). O cartão
      // aqui é a leitura da campanha: números e orçamento. Antes tinha uma faixa
      // de recomendação com botões "Aplicar R$ X/dia" e "Pausar campanha" que
      // mexiam na Meta na hora — com a fila existindo, isso virava um SEGUNDO
      // caminho pra verba, e o que passa por ele não vira registro de decisão.
      // Uma aprovação que dá pra contornar não é aprovação.
      // Cabeçalho de apoio (clicável p/ expandir anúncios).
      inner.appendChild(top);
      // 3) Orçamento da campanha. Só oferece edição quando o orçamento é MESMO
      // da campanha (CBO). Sendo ABO, mostra por que não dá e manda pro
      // conjunto — antes a tela oferecia o campo, o Meta recusava e o dono
      // ficava sem saber onde mexer.
      const permCamp=podeEditarOrcamentoDaCampanha(camp,conjuntos);
      if(!encerrada){
        const beWrap=document.createElement('div');
        beWrap.innerHTML=_gtBudgetEditHtml(permCamp,orcamentoDe(camp));
        if(beWrap.firstElementChild)inner.appendChild(beWrap.firstElementChild);
      }
      // Rodapé: pausar/reativar na MÃO. Continua aqui de propósito — é o dono
      // agindo por conta própria, não uma sugestão sendo aprovada, mesma razão
      // pela qual o "✎ editar" do orçamento ficou. A fila existe pra filtrar o
      // que o robô propõe. (Não há mais faixa pra duplicar o botão de pausar.)
      if(!encerrada){
        const tgl=_gtManualToggleBtn('campaign',ins.campaign_id,status,ins.campaign_name||camp?.name);
        if(tgl){const actBar=document.createElement('div');actBar.className='gt-action-row';actBar.appendChild(tgl);inner.appendChild(actBar);}
      }
      // 4b) Duplicar a campanha inteira.
      //
      // O QUE VAI SER COPIADO SAI DE `hier`, NÃO das listas cruas.
      // `conjuntos` vem da chamada /adsets, que tem `.catch(()=>[])`, corta em
      // 2000 linhas e filtra por status: quando ela falha, ela volta VAZIA e
      // ninguém percebe. A tela sobrevive porque montarHierarquia reconstrói o
      // conjunto a partir do próprio anúncio ("Anúncio cujo conjunto não veio
      // na lista NÃO some") — mas planoDeCopia joga fora o anúncio cujo
      // adset_id não está na lista de conjuntos. Montando o alvo com as listas
      // cruas, o pior desfecho possível acontecia calado: a janela dizia
      // "com 12 anúncios", o plano tinha 1 passo, nascia uma campanha vazia e
      // pausada e o relatório dizia "Pronto".
      // `hier` é EXATAMENTE o que o cartão conta e desenha — copiar o que está
      // na tela é a única leitura que nunca contradiz o que o dono está vendo.
      // De quebra, resolve os conjuntos ARQUIVADOS: `hier` já derruba
      // arquivado sem gasto e sem anúncio (filtro `vivo`), então eles não são
      // mais contados nem ressuscitados como cópia nova.
      const gruposDup=hier.filter(g=>g.id!=='_sem_conjunto');
      const bDupCamp=_gtBotaoDuplicar({
        nivel:'campanha',
        campanha:{id:ins.campaign_id,name:ins.campaign_name||camp?.name||''},
        conjuntos:gruposDup.map(g=>({id:g.id,name:g.nome})),
        anuncios:gruposDup.flatMap(g=>(g.anuncios||[]).map(a=>({id:a.ad_id,name:a.ad_name,adset_id:g.id}))),
      });
      if(bDupCamp){
        // Reaproveita a linha de ações do pausar, se ela existir; senão cria.
        let barraDup=inner.querySelector('.gt-action-row');
        if(!barraDup){barraDup=document.createElement('div');barraDup.className='gt-action-row';inner.appendChild(barraDup);}
        barraDup.appendChild(bDupCamp);
      }
      // 5) Liga os controles (aplicar sugerido, pausar da faixa, editar manual).
      _gtWireBudgetControls(inner,ins,camp,permCamp);
      // Painel dos CONJUNTOS (que por sua vez trazem os anúncios dentro).
      const adsPane=document.createElement('div');adsPane.className='gt-camp-row-ads';
      // H1 do review (2026-07-28): `temMensagem` desce até o anúncio em vez de
      // ser recalculado lá. A Meta OMITE um action_type inteiro quando a
      // contagem é zero — um anúncio de uma campanha de WhatsApp que gastou mas
      // não puxou conversa NA JANELA fica com `actions` idêntico ao de um
      // anúncio de engajamento puro. Calculado por anúncio, esse anúncio virava
      // "elegível" pro selo de interação, e o dono podia declarar "Salvamento"
      // nele — comparando, no mesmo mercado de salvamento, um anúncio cujo
      // produto real é conversa. A CAMPANHA é a unidade certa pra essa decisão.
      // O BALDE DESCE PRONTO, e é o MESMO que a régua usa duas telas acima
      // (`temMensagem ? 'mensagens' : baldeCamp`) — não um cálculo novo. Um
      // segundo jeito de decidir o balde acabaria discordando do primeiro, que
      // é exatamente o defeito que baldes.js foi criado pra impedir.
      // `baldeCamp` (lá em cima) já sai de kpiObjective, que tem o valor de
      // reserva do insight quando camp.objective vem vazio.
      const baldeDaCampanha=temMensagem?'mensagens':baldeCamp;
      adsPane.__gtRender=()=>_renderGtConjuntos(adsPane,hier,camp,conjuntos,nivelOrc,i+1,temMensagem,baldeDaCampanha);
      top.addEventListener('click',()=>{
        const isOpen=adsPane.classList.toggle('open');
        chev.classList.toggle('open',isOpen);
        if(isOpen&&!adsPane.dataset.loaded){
          adsPane.dataset.loaded='1';
          adsPane.__gtRender();
        }
      });
      row.appendChild(inner);row.appendChild(adsPane);
      // Aberto por padrão (como já era), a menos que o dono tenha recolhido tudo.
      if(hier.length&&!_gtRecolhido){ adsPane.classList.add('open'); chev.classList.add('open'); adsPane.dataset.loaded='1'; adsPane.__gtRender(); }
      list.appendChild(row);
    });
  }
  searchInp.addEventListener('input',()=>renderList(searchInp.value));
  renderList('');
  col.innerHTML='';col.appendChild(card);
}
function _gtCrEsc(e){if(e.key==='Escape')_gtCloseCriativo();}
function _gtCloseCriativo(){const ov=document.getElementById('gt-cr-overlay'),md=document.getElementById('gt-cr-modal'),bd=document.getElementById('gt-cr-body');if(ov)ov.style.display='none';if(md)md.style.display='none';if(bd)bd.innerHTML='';document.removeEventListener('keydown',_gtCrEsc);}
// Troca de aba: só mostra/esconde painel. NÃO remonta a lista de campanhas —
// remontar dispararia chamadas à Meta de novo e pode custar rate-limit.
function _gtTrocarAba(nome) {
  _gtAbaAtiva = nome;
  for (const n of ['campanhas', 'fila', 'regua']) {
    const painel = document.getElementById('gt-painel-' + n);
    const aba = document.getElementById('pnd-aba-' + n);
    if (painel) painel.style.display = (n === nome) ? '' : 'none';
    if (aba) aba.classList.toggle('ativa', n === nome);
  }
  if (nome === 'fila') {
    const alvo = document.getElementById('gt-painel-fila');
    // O gasto vive fora da fila (vem do coletor, não do robô), então entra aqui,
    // grudado no item — assim o painel puro recebe tudo pronto.
    for (const grupo of ['pendentes', 'vencidas', 'silenciadas']) {
      for (const it of ((_gtFila && _gtFila[grupo]) || [])) {
        it.gastos = lerGastos(_gtGastosPorCampanha.get(String(it.campaign_id)) || []);
      }
    }
    if (alvo) montarPainelFila(alvo, {
      pendentes: _gtFila.pendentes,
      vencidas: _gtFila.vencidas,
      silenciadas: _gtFila.silenciadas,
      contas: _gtAccounts,
      // Quem filtra é o SELETOR DA TOPBAR: a fila mostra a conta que está
      // aberta, como o resto da tela. Antes ela tinha botões próprios de conta,
      // duplicando um seletor que já existe logo acima e que ainda mostra saldo
      // e gasto de cada uma (pedido do dono, 2026-07-29).
      contaFiltro: (_gtCurAcc && _gtCurAcc.id) || '',
      contaNome: (_gtCurAcc && (_gtCurAcc.display_name || _gtCurAcc.name)) || '',
      agora: new Date().toISOString(),
      carregou: _gtFilaCarregou,
      leituraPublico: _gtLeituraPublico,
      problemas: _gtProblemasDaMeta,
      fraseProblemas: fraseDosProblemas(_gtProblemasDaMeta),
      aoUsarPublico: _gtUsarPublicoDaLeitura,
      // A fila vazia se explica: o que o robo fez NESTA conta.
      explicacaoVazia: fraseDaFilaVazia(resumoDoRobo(_gtAnalisesCruas, (_gtCurAcc && _gtCurAcc.id) || null)),
      // Mesmo critério da régua e do RLS da tabela: decidir na fila é ação de
      // quem pode EDITAR nesta ferramenta.
      editavel: hasPermission('meta.gestor', 'editar'),
      aoAprovar: _gtFilaAprovar,
      // A LUPA da fila reusa o MESMO modal da lista de anúncios — prévia real da
      // Meta, já validada ao vivo. Ligar o que existe, em vez de escrever outra.
      aoVerCriativo: (item, adId, nome) => _gtVerCriativo(adId, item.account_id || (_gtCurAcc && _gtCurAcc.id), nome),
      aoVerGastos: (item) => _gtVerGastos(item),
      aoRecusar: _gtFilaRecusar,
      aoPausarCriativos: _gtFilaPausarCriativos,
      ajudaBtn: _gtAjudaBtn,
    });
  }
  if (nome === 'regua') {
    const alvo = document.getElementById('gt-painel-regua');
    if (alvo) montarPainelRegua(alvo, {
      // A régua DA CONTA aberta — é o que o dono edita. Passar `_gtRegua` cru
      // mostraria a meta antiga, única, que não governa mais nada.
      regua: _gtReguaAtiva(),
      // De QUEM são estas metas. Sem o nome na tela, o dono editaria a régua da
      // Raíssa achando que estava mexendo na de todo mundo — e os números são
      // muito diferentes entre as contas (28× no custo por ponto).
      nomeConta: (_gtCurAcc && (_gtCurAcc.display_name || _gtCurAcc.name)) || '',
      // Mesmo critério do RLS (admin OU feature 'meta.gestor' — ver migration
      // 20260728_ponderada_config.sql): editar a régua é uma ação de quem tem
      // permissão de EDITAR nesta ferramenta, não um privilégio exclusivo de
      // admin. Usar outro critério aqui faria os campos aparecerem editáveis
      // pra quem não consegue salvar de fato (ou o oposto: escondidos de quem
      // pode).
      editavel: hasPermission('meta.gestor', 'editar'),
      // Só true quando _gtCarregarRegua() leu o banco com sucesso. Se ainda não
      // (ou se falhou), o painel mostra os campos mas trava o "Salvar" — nunca
      // deixa gravar um valor que pode não ser o real (ver C3 do review final).
      carregouOk: _gtReguaCarregada,
      exemplos: _gtExemplosParaRegua(),
      // PERSONA DA MARCA: quem esta conta atende. A IA de sugestao de publico le
      // isto antes dos numeros -- sem ela, a idade sugerida saia de quem CLICOU.
      contaId: (_gtCurAcc && _gtCurAcc.id) || '',
      persona: (_gtCurAcc && _gtCurAcc.persona) || '',
      // A RLS de `accounts` so deixa profiles.role='admin' gravar. Usar aqui o
      // criterio do Gestor ('meta.gestor','editar') faria o campo aparecer
      // editavel pra quem o banco recusa -- o mesmo erro que o comentario da
      // regua logo acima ja avisa pra nao cometer.
      personaEditavel: estado.role === 'admin',
      aoSalvarPersona: _gtSalvarPersona,
      aoLerArquivo: _gtLerArquivoDePersona,
      // O card de abertura é longo e explica a aba inteira. Quem já leu não quer
      // rolar por ele toda vez — mas o painel remonta a cada troca de conta e a
      // cada save, então a escolha precisa morar fora dele. Mesmo lugar onde o
      // zoom da tela já mora. Ausente = aberto: na primeira visita a explicação
      // aparece, e só depois de lida é que o dono decide escondê-la.
      introAberta: localStorage.getItem('gt.regua.intro') !== 'fechada',
      aoAlternarIntro: (aberta) => {
        // localStorage estoura em aba anônima e com cota cheia; a preferência
        // não vale derrubar a tela.
        try { localStorage.setItem('gt.regua.intro', aberta ? 'aberta' : 'fechada'); } catch (e) { /* preferência é opcional */ }
      },
      aoSalvar: _gtSalvarRegua,
      // painel-regua.js é módulo puro (só innerHTML, sem tocar em `window`) —
      // por isso o botão "?" entra por injeção, não por import cruzado do
      // .vue. A função em si (_gtAjuda) segue registrada em window porque o
      // onclick="..." do HTML gerado por este painel só existe depois de
      // virar string no DOM, e ali só um global alcança.
      ajudaBtn: _gtAjudaBtn,
    });
  }
}
// O DETALHAMENTO DE GASTO, no mesmo modal do criativo — janela genérica que já
// existe (título + corpo + ESC + clique fora). Escrever outra seria manter duas.
function _gtVerGastos(item){
  const ov=document.getElementById('gt-cr-overlay'),md=document.getElementById('gt-cr-modal'),bd=document.getElementById('gt-cr-body');
  if(!ov||!md||!bd)return;
  ov.style.display='block';md.style.display='flex';
  const tt=document.getElementById('gt-cr-title');
  if(tt)tt.textContent='Gastos · '+(item.campaign_name||item.campaign_id||'');
  document.addEventListener('keydown',_gtCrEsc);

  const linhas=linhasDoModal(item.gastos);
  if(!linhas.length){
    bd.innerHTML='<div class="gt-gasto-vazio">Ainda não tenho gasto registrado desta campanha.<br>O coletor grava uma vez por dia.</div>';
    return;
  }
  const uso=usoDoOrcamento(item.gastos,item.budget_atual_centavos);
  const teto=item.budget_atual_centavos!=null
    ? '<div class="gt-gasto-teto">Teto de orçamento: <b>'+_maFmtR(item.budget_atual_centavos/100)+'</b> por dia</div>' : '';
  bd.innerHTML='<div class="gt-gasto-box">'+teto
    +'<table class="gt-gasto-tab">'+linhas.map(l=>
      '<tr'+(l.parcial?' class="parcial"':'')+'><th>'+_gtEsc(l.rotulo)+'</th>'
      +'<td class="v">'+_gtEsc(l.valor)+'</td><td class="n">'+_gtEsc(l.nota||'')+'</td></tr>').join('')
    +'</table>'
    +(uso&&uso.aperta?'<p class="gt-gasto-aviso">'+_gtEsc(uso.texto)+'</p>':'')
    +'<p class="gt-gasto-fonte">Números do coletor, capturados em '
    +_gtEsc((item.gastos&&item.gastos.capturadoEm)||'—')+'. Não é fatura da Meta.</p></div>';
}

async function _gtVerCriativo(adId,accId,nome){
  const ov=document.getElementById('gt-cr-overlay'),md=document.getElementById('gt-cr-modal'),bd=document.getElementById('gt-cr-body');
  if(!ov||!md||!bd)return;
  ov.style.display='block';md.style.display='flex';
  const tt=document.getElementById('gt-cr-title');if(tt)tt.textContent=nome?('Criativo · '+nome):'Criativo do anúncio';
  document.addEventListener('keydown',_gtCrEsc);
  bd.innerHTML='<div style="padding:40px 20px;text-align:center;color:var(--muted);font-family:var(--fonte-principal);font-size:calc(12px*var(--gt-fs,1.3));">Carregando o criativo…</div>';
  // Ordem de formatos confirmada na validação ao vivo (mais provável primeiro).
  const formats=['INSTAGRAM_STANDARD','INSTAGRAM_REELS','INSTAGRAM_STORY','MOBILE_FEED_STANDARD','FACEBOOK_STORY_MOBILE'];
  for(const fmt of formats){
    try{
      const r=await metaFetch('/'+adId+'/previews',{ad_format:fmt},accId);
      const body=r&&r.data&&r.data[0]&&r.data[0].body;
      if(body&&/<iframe/i.test(body)){ bd.innerHTML='<div class="gt-cr-frame">'+body+'</div>'; return; }
    }catch(e){}
  }
  bd.innerHTML='<div style="padding:30px 20px;text-align:center;color:var(--muted);font-family:var(--fonte-principal);font-size:calc(12px*var(--gt-fs,1.3));line-height:1.6;">Não consegui carregar o preview deste anúncio agora.<br>Pode ser um formato sem preview disponível.</div>';
}
// Camada do meio: campanha → CONJUNTOS DE ANÚNCIOS → anúncios.
// É aqui que se edita o orçamento quando a campanha é ABO (orçamento no
// conjunto). hier vem do módulo puro (montarHierarquia).
function _renderGtConjuntos(pane,hier,camp,conjuntos,nivelOrc,campNum,temMensagemCampanha,baldeDaCampanha){
  const lbl=document.createElement('div');lbl.className='gt-ads-section-lbl';
  lbl.textContent=`Conjuntos de anúncios (${hier.length})`;
  pane.appendChild(lbl);
  if(!hier.length){
    const empty=document.createElement('div');empty.className='gt-set-empty';
    empty.textContent='Nenhum conjunto de anúncios com gasto neste período';
    pane.appendChild(empty);return;
  }
  // Explica por que os conjuntos não têm campo de orçamento (CBO ou
  // desconhecido). Sendo ABO cada conjunto já mostra o seu, e o cabeçalho da
  // campanha já apontou pra cá — a nota aqui seria repetição.
  if(nivelOrc.nivel!=='conjunto'){
    const nota=document.createElement('div');nota.className='gt-set-nivel-nota';
    nota.textContent=nivelOrc.explicacao;
    pane.appendChild(nota);
  }
  hier.forEach((g,si)=>{
    const num=(campNum!=null?campNum+'.':'')+(si+1);
    const cj=g.conjunto;
    const status=(cj&&cj.effective_status)||'';
    const card=document.createElement('div');card.className='gt-set-card';
    const top=document.createElement('div');top.className='gt-set-top';
    const numEl=document.createElement('div');numEl.className='gt-set-num';numEl.textContent=num;
    const badge=document.createElement('div');
    const cls=status==='ACTIVE'?'active':status==='PAUSED'?'paused':'inactive';
    const bl=status==='ACTIVE'?'Ativo':status==='PAUSED'?'Pausado':status==='ARCHIVED'?'Arquivado':'—';
    badge.className='gt-status-badge '+cls;badge.textContent=bl;
    const nmEl=document.createElement('div');nmEl.className='gt-set-nm';
    nmEl.textContent=g.nome||'—';nmEl.title=g.nome||'';
    const gastoEl=document.createElement('div');gastoEl.className='gt-set-spend';gastoEl.textContent=_maFmtR(g.gasto);
    const qtd=document.createElement('span');qtd.className='gt-expand-hint';
    qtd.textContent=g.anuncios.length?`${g.anuncios.length} anúncio${g.anuncios.length!==1?'s':''}  ▾`:'sem anúncios';
    const chev=document.createElement('svg');chev.setAttribute('class','gt-set-chevron');chev.setAttribute('width','11');chev.setAttribute('height','11');chev.setAttribute('viewBox','0 0 24 24');chev.setAttribute('fill','none');chev.setAttribute('stroke','currentColor');chev.setAttribute('stroke-width','2.5');chev.setAttribute('stroke-linecap','round');chev.setAttribute('stroke-linejoin','round');chev.innerHTML='<polyline points="9 18 15 12 9 6"/>';
    const exp=document.createElement('div');exp.className='gt-set-exp';exp.appendChild(qtd);exp.appendChild(chev);
    top.appendChild(numEl);top.appendChild(badge);top.appendChild(nmEl);top.appendChild(gastoEl);top.appendChild(exp);
    card.appendChild(top);
    // Orçamento DO CONJUNTO — editável só quando é ABO (o módulo puro decide).
    // Só desenha a linha se este conjunto TEM orçamento próprio. Sendo CBO,
    // nenhum conjunto tem, e a nota do painel já explicou que o orçamento é
    // da campanha — repetir isso em cada conjunto seria só barulho.
    const orc=cj?orcamentoDe(cj):null;
    if(orc){
      const perm=podeEditarOrcamentoDoConjunto(camp,cj,conjuntos);
      const beWrap=document.createElement('div');
      beWrap.innerHTML=_gtBudgetEditHtml(perm,orc);
      if(beWrap.firstElementChild){
        const be=beWrap.firstElementChild;
        card.appendChild(be);
        if(perm.editavel)_gtWireBudgetManual(be,{id:g.id,nome:g.nome,atualReais:perm.atualReais,nivelLbl:'do conjunto',nivelNome:'Conjunto'});
      }
    }
    // `g` vem de montarHierarquia: g.id, g.nome e g.anuncios (os anúncios do
    // conjunto, já vindos dos insights — daí ad_id/ad_name).
    // O grupo '_sem_conjunto' é INVENTADO por montarHierarquia para não sumir
    // com anúncio que chegou sem adset_id: não existe na Meta, e o botão ali
    // mandaria POST /_sem_conjunto/copies. Sem botão nesse grupo.
    const bDupCj=g.id==='_sem_conjunto'?null:_gtBotaoDuplicar({
      nivel:'conjunto',
      conjuntos:[{id:g.id,name:g.nome}],
      anuncios:(g.anuncios||[]).map(a=>({id:a.ad_id,name:a.ad_name,adset_id:g.id})),
    });
    // Botão "Público": mesmo gate do orçamento e do duplicar (editar muda uma
    // conta ao vivo). Some no mesmo grupo inventado '_sem_conjunto', pelo
    // mesmo motivo do duplicar — não existe conjunto de verdade pra editar.
    const bPub=(g.id==='_sem_conjunto'||!hasPermission('meta.gestor','editar'))?null:(()=>{
      const b=document.createElement('button');
      b.className='gt-btn-dup';b.textContent='👥 Público';b.title='Ver e mudar quem vê estes anúncios';
      b.addEventListener('click',ev=>{ev.stopPropagation();
        // O balde EFETIVO (baldes.js) traduz o objetivo da Meta para o mesmo
        // vocabulário do robô de sugestões ('vendas', 'mensagens'...) — e já
        // trata a campanha com destino WhatsApp, que a Meta declara como
        // engajamento mas se mede por conversa.
        _gtAbrirPublico({id:g.id,nome:g.nome,objetivo:baldeDaCampanha});});
      return b;
    })();
    if(bDupCj||bPub){
      const barraCj=document.createElement('div');barraCj.className='gt-action-row';
      if(bDupCj)barraCj.appendChild(bDupCj);
      if(bPub)barraCj.appendChild(bPub);
      card.appendChild(barraCj);
    }
    // Anúncios do conjunto.
    const adsPane=document.createElement('div');adsPane.className='gt-set-pane';
    adsPane.__gtRender=()=>_renderGtAds(adsPane,g.anuncios,null,null,num,temMensagemCampanha);
    top.addEventListener('click',e=>{
      e.stopPropagation(); // não deixa fechar a campanha inteira ao clicar no conjunto
      const isOpen=adsPane.classList.toggle('open');
      chev.classList.toggle('open',isOpen);
      if(isOpen&&!adsPane.dataset.loaded){adsPane.dataset.loaded='1';adsPane.__gtRender();}
    });
    card.appendChild(adsPane);
    if(g.anuncios.length&&!_gtRecolhido){adsPane.classList.add('open');chev.classList.add('open');adsPane.dataset.loaded='1';adsPane.__gtRender();}
    pane.appendChild(card);
  });
}
function _renderGtAds(pane,ads,allInsights,allAdInsights,campNum,temMensagemCampanha){
  const lbl=document.createElement('div');lbl.className='gt-ads-section-lbl';lbl.textContent=`Anúncios (${ads.length})`;pane.appendChild(lbl);
  if(!ads.length){const empty=document.createElement('div');empty.style.cssText='font-family:var(--fonte-principal);font-size:calc(11px*var(--gt-fs,1.3));color:var(--muted);padding:6px 0 6px 20px;';empty.textContent='Nenhum anúncio com gasto neste período';pane.appendChild(empty);return;}
  const sorted=[...ads].sort((a,b)=>parseFloat(b.spend||0)-parseFloat(a.spend||0));
  sorted.forEach((ad,ai)=>{
    const ctr=parseFloat(ad.ctr||0);
    const spend=parseFloat(ad.spend||0);
    const adStatus=ad.effective_status||'';
    const ctrColor=ctr>=2?'var(--green)':ctr<0.8?'var(--red)':'var(--orange)';
    const card=document.createElement('div');card.className='gt-ad-card';
    const top=document.createElement('div');top.className='gt-ad-top';
    // O SELO "Manter"/"Pausar" DA IA saiu daqui (decisão do dono, 2026-07-29):
    // assim como o veredito da campanha, o que é JULGAMENTO mora na Fila — lá os
    // criativos fracos aparecem agrupados na campanha deles, com o motivo e uma
    // ação só pra todos. Um selo aqui seria a mesma decisão em dois lugares, e o
    // daqui não deixaria registro.
    // O badge de STATUS fica: "Ativo"/"Pausado" não é opinião sobre o criativo,
    // é o estado dele na Meta — e antes só aparecia quando NÃO havia análise da
    // IA, o que escondia o status justamente nos anúncios mais relevantes.
    const seal=document.createElement('div');
    const cls=adStatus==='ACTIVE'?'active':adStatus==='PAUSED'?'paused':'inactive';
    const lb=adStatus==='ACTIVE'?'Ativo':adStatus==='PAUSED'?'Pausado':adStatus==='ARCHIVED'?'Arquivado':'Inativo';
    seal.className='gt-status-badge '+cls;seal.textContent=lb;
    const nameWrap=document.createElement('div');nameWrap.className='gt-ad-name';
    nameWrap.innerHTML=`<div class="gt-ad-nm">${_gtEsc(ad.ad_name||ad.adset_name||'—')}</div>${ad.adset_name&&ad.ad_name?`<div class="gt-ad-sub">${_gtEsc(ad.adset_name)}</div>`:''}`;
    // Selo de objetivo por interação: só anúncio de engajamento que NÃO seja de
    // mensagem pode declarar. "É de mensagem?" vem PRONTO da campanha — a Meta
    // omite o action_type inteiro quando a contagem é zero, e um anúncio de
    // WhatsApp sem conversa nesta janela ficaria idêntico a um de engajamento
    // puro, abrindo o selo pra declarar "Salvamento" onde o produto é conversa.
    const baldeAd = _gtBalde(ad.objective || '');
    const seloObjAd = _gtSeloObjetivoEl(ad.ad_id, 'anuncio', baldeAd === 'engajamento' && !temMensagemCampanha);
    if (seloObjAd) nameWrap.appendChild(seloObjAd);
    const metrics=document.createElement('div');metrics.className='gt-metrics';
    metrics.innerHTML=`<div class="gt-metric">CTR <span style="color:${ctrColor}">${_maFmtPct(ctr)}</span></div><div class="gt-metric" style="font-family:var(--fonte-principal);font-size:calc(13px*var(--gt-fs,1.3));font-weight:700;"><span>${_maFmtR(spend)}</span></div>`;
    // Declarada a interação no anúncio, o custo dela aparece aqui com a cor da
    // faixa — senão declarar no anúncio não faria nada visível.
    const declAd=_gtObjetivoInteracao[String(ad.ad_id)];
    if(interacaoValida(declAd)){
      const qAd=quantidadesDoInsight(ad);
      const custoAd=custoDaInteracao(qAd,declAd);
      const reguaAd=_gtReguaAtiva();
      const metaAd=metaDoBalde(reguaAd,declAd);
      const avalAd=avaliarAlvo({custo:custoAd,meta:metaAd,limiares:reguaAd.limiares});
      const corAd=avalAd.faixa==='escalar-forte'||avalAd.faixa==='dentro-da-meta'?'var(--green)'
        :avalAd.faixa==='manter'?'var(--orange)':avalAd.faixa==='otimizar'?'var(--red)':'var(--muted)';
      const el=document.createElement('div');
      el.className='gt-metric';
      el.title=`${INTERACOES[declAd].rotuloCusto} · sua meta é ${metaAd>0?_maFmtR(metaAd):'—'}`;
      el.innerHTML=`${_gtEsc(INTERACOES[declAd].rotulo)} <span style="color:${corAd}">${custoAd==null?'—':_maFmtR(custoAd)}</span>`;
      metrics.appendChild(el);
    }
    const adNum=document.createElement('div');adNum.className='gt-ad-num';adNum.textContent=(campNum!=null?campNum+'.':'')+(ai+1);
    const adSelCb=_gtSelCaixa('ad',ad.ad_id,ad.ad_name||ad.adset_name,adStatus==='ACTIVE');
    if(adSelCb)top.appendChild(adSelCb);
    top.appendChild(adNum);top.appendChild(seal);top.appendChild(nameWrap);top.appendChild(metrics);
    card.appendChild(top);
    // Ações do anúncio: ver criativo + pausar/reativar manual.
    const actBar=document.createElement('div');actBar.className='gt-action-row';
    const crBtn=document.createElement('button');crBtn.className='gt-act-btn';crBtn.textContent='👁 Ver criativo';
    crBtn.addEventListener('click',e=>{e.stopPropagation();_gtVerCriativo(ad.ad_id,_gtCurAcc&&_gtCurAcc.id,ad.ad_name||ad.adset_name);});
    actBar.appendChild(crBtn);
    const adTgl=_gtManualToggleBtn('ad',ad.ad_id,adStatus,ad.ad_name||ad.adset_name);
    if(adTgl)actBar.appendChild(adTgl);
    const bDupAd=_gtBotaoDuplicar({nivel:'anuncio',anuncios:[{id:ad.ad_id,name:ad.ad_name||ad.adset_name||''}]});
    if(bDupAd)actBar.appendChild(bDupAd);
    card.appendChild(actBar);
    pane.appendChild(card);
  });
}
// escapa texto vindo da Meta (nome de campanha/anúncio, mensagem de erro) antes de ir p/ innerHTML
function _gtEsc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
// Ajuda contextual (glossário em ajuda.js): abre o MESMO modal _gtConfirm já
// usado pra confirmar ações, só que sem botão Cancelar (okOnly). Nunca abre
// modal vazio — chave desconhecida não faz nada (mesma regra de ajudaDe).
// Exposta em window (ver Object.assign(window,{...}) abaixo) porque é chamada
// a partir de onclick="..." em HTML gerado (innerHTML), tanto pelo cartão de
// campanha aqui quanto pelo painel puro painel-regua.js (que recebe esta
// função — ver _gtAjudaBtn — via opção `ajudaBtn`, e não pode ler `window`
// direto num módulo que se pretende puro/testável fora do navegador).
function _gtAjuda(chave){
  const entrada=ajudaDe(chave);
  if(!entrada)return;
  _gtConfirm(entrada.titulo,entrada.texto,{okOnly:true});
}
// Botão "?" redondo (mesmo padrão visual de .ma-kpi-q em análise de campanhas
// — ver .pnd-ajuda-btn no <style> abaixo). Devolve '' pra chave sem entrada:
// nunca deve existir um botão que abre um modal vazio. O texto de ajuda.js já
// é HTML de propósito (constante do módulo, não dado do usuário/Meta) — por
// isso NÃO passa por _gtEsc aqui; só o titulo/atributos usam _gtEsc porque
// vão para atributo HTML.
function _gtAjudaBtn(chave){
  const entrada=ajudaDe(chave);
  if(!entrada)return'';
  const titulo=_gtEsc(entrada.titulo);
  return `<button type="button" class="pnd-ajuda-btn" onclick="_gtAjuda('${String(chave).replace(/'/g,"\\'")}')" title="${titulo}" aria-label="${titulo}">?</button>`;
}
// Modal de confirmação/aviso. opts:{danger,okOnly,okLabel}. Resolve true (confirmar) / false (cancelar).
// ESTE É O GATE que precede TODA ação de mutação real (_gtApplyAction) — pausar/
// reativar campanha ou anúncio, e mudar orçamento. Preservado intacto/verbatim.
function _gtConfirm(title,detailHtml,opts){
  opts=opts||{};
  return new Promise(resolve=>{
    let ov=document.getElementById('gt-confirm-ov');
    if(!ov){ov=document.createElement('div');ov.id='gt-confirm-ov';ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;padding-top:max(16px,env(safe-area-inset-top));padding-bottom:max(16px,env(safe-area-inset-bottom));padding-left:max(12px,env(safe-area-inset-left));padding-right:max(12px,env(safe-area-inset-right));touch-action:none;overscroll-behavior:contain;';document.body.appendChild(ov);}
    ov.innerHTML='';ov.style.display='flex';
    const box=document.createElement('div');
    box.style.cssText='background:var(--surface,#fff);color:var(--text,#111);border-radius:14px;max-width:400px;width:100%;padding:24px;box-shadow:0 24px 60px rgba(0,0,0,.45);font-family:var(--fonte-principal);';
    box.innerHTML='<div style="font-size:calc(16px*var(--gt-fs,1.3));font-weight:800;margin-bottom:9px;">'+title+'</div><div style="font-size:calc(13px*var(--gt-fs,1.3));color:var(--muted,#666);line-height:1.55;margin-bottom:20px;">'+detailHtml+'</div>';
    const bar=document.createElement('div');bar.style.cssText='display:flex;gap:10px;justify-content:flex-end;';
    const close=v=>{ov.style.display='none';resolve(v);};
    if(!opts.okOnly){const c=document.createElement('button');c.textContent='Cancelar';c.style.cssText='padding:9px 16px;border-radius:8px;border:1px solid var(--border,#ddd);background:none;color:var(--text,#111);font-weight:600;font-size:calc(13px*var(--gt-fs,1.3));cursor:pointer;';c.onclick=()=>close(false);bar.appendChild(c);}
    const ok=document.createElement('button');ok.textContent=opts.okLabel||(opts.okOnly?'Entendi':'Confirmar');ok.style.cssText='padding:9px 18px;border-radius:8px;border:none;background:'+(opts.danger?'var(--red)':'var(--accent)')+';color:var(--sobre-cor);font-weight:700;font-size:calc(13px*var(--gt-fs,1.3));cursor:pointer;';ok.onclick=()=>close(true);bar.appendChild(ok);
    box.appendChild(bar);ov.appendChild(box);
    ov.onclick=e=>{if(e.target===ov)close(false);};
  });
}
// Janela do DUPLICAR. Não usa _gtConfirm porque aquele modal só devolve
// sim/não — aqui precisamos de quantas cópias e do sufixo do nome. Mesmo
// visual, função separada, para não mexer no portão compartilhado de todas
// as outras ações.
function _gtDuplicarModal(resumo){
  return new Promise(resolve=>{
    let ov=document.getElementById('gt-dup-ov');
    if(!ov){ov=document.createElement('div');ov.id='gt-dup-ov';ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;touch-action:none;overscroll-behavior:contain;';document.body.appendChild(ov);}
    ov.innerHTML='';ov.style.display='flex';
    const box=document.createElement('div');
    box.style.cssText='background:var(--surface,#fff);color:var(--text,#111);border-radius:14px;max-width:440px;width:100%;padding:24px;box-shadow:0 24px 60px rgba(0,0,0,.45);font-family:var(--fonte-principal);';
    box.innerHTML=
      '<div style="font-size:calc(16px*var(--gt-fs,1.3));font-weight:800;margin-bottom:9px;">Duplicar</div>'+
      '<div style="font-size:calc(13px*var(--gt-fs,1.3));color:var(--muted,#666);line-height:1.55;margin-bottom:16px;">'+resumo+'</div>'+
      '<label style="display:block;font-size:calc(12px*var(--gt-fs,1.3));font-weight:700;margin-bottom:5px;">Quantas cópias</label>'+
      '<select data-dup-qtd style="width:100%;padding:9px;border-radius:8px;border:1px solid var(--border,#ddd);background:var(--surface,#fff);color:var(--text,#111);font-size:calc(13px*var(--gt-fs,1.3));margin-bottom:14px;">'+
        [1,2,3,4,5].map(n=>'<option value="'+n+'">'+n+(n===1?' cópia':' cópias')+'</option>').join('')+
      '</select>'+
      '<label style="display:block;font-size:calc(12px*var(--gt-fs,1.3));font-weight:700;margin-bottom:5px;">O que acrescentar no nome</label>'+
      '<input data-dup-sufixo value="'+_gtEsc(SUFIXO_PADRAO)+'" style="width:100%;padding:9px;border-radius:8px;border:1px solid var(--border,#ddd);background:var(--surface,#fff);color:var(--text,#111);font-size:calc(13px*var(--gt-fs,1.3));margin-bottom:16px;">'+
      '<div style="background:rgba(22,163,74,.12);border:1px solid rgba(22,163,74,.35);border-radius:8px;padding:11px 13px;font-size:calc(12px*var(--gt-fs,1.3));line-height:1.5;margin-bottom:18px;"><b>A cópia nasce PAUSADA.</b> Nada vai gastar até você ativar.</div>';
    const bar=document.createElement('div');bar.style.cssText='display:flex;gap:10px;justify-content:flex-end;';
    const close=v=>{ov.style.display='none';resolve(v);};
    const c=document.createElement('button');c.textContent='Cancelar';
    c.style.cssText='padding:9px 16px;border-radius:8px;border:1px solid var(--border,#ddd);background:none;color:var(--text,#111);font-weight:600;font-size:calc(13px*var(--gt-fs,1.3));cursor:pointer;';
    c.onclick=()=>close(null);bar.appendChild(c);
    const ok=document.createElement('button');ok.textContent='Duplicar';
    ok.style.cssText='padding:9px 18px;border-radius:8px;border:none;background:var(--accent,#6366f1);color:#fff;font-weight:700;font-size:calc(13px*var(--gt-fs,1.3));cursor:pointer;';
    ok.onclick=()=>close({
      quantidade:parseInt(box.querySelector('[data-dup-qtd]').value,10)||1,
      sufixo:box.querySelector('[data-dup-sufixo]').value,
    });
    bar.appendChild(ok);
    box.appendChild(bar);ov.appendChild(box);
    ov.onclick=e=>{if(e.target===ov)close(null);};
  });
}

// Caixa de progresso/resultado da cópia. Reusa o visual do _gtConfirm.
function _gtDupStatus(html,acoes){
  let ov=document.getElementById('gt-dup-ov');
  if(!ov)return;
  ov.innerHTML='';ov.style.display='flex';
  // Corta o handler de fechar-clicando-no-fundo que _gtDuplicarModal deixou
  // preso no overlay. Sem isso, um clique no fundo durante a cascata de
  // chamadas na Meta (que pode levar segundos, mais ainda com o backoff de
  // comEspera) esconde a janela enquanto as chamadas de verdade continuam
  // rodando — a tela parece ociosa/cancelada com campanhas sendo criadas por
  // trás. Daqui em diante só sai por botão, nunca clicando fora.
  ov.onclick=null;
  const box=document.createElement('div');
  box.style.cssText='background:var(--surface,#fff);color:var(--text,#111);border-radius:14px;max-width:440px;width:100%;padding:24px;box-shadow:0 24px 60px rgba(0,0,0,.45);font-family:var(--fonte-principal);font-size:calc(13px*var(--gt-fs,1.3));line-height:1.6;';
  box.innerHTML=html;
  if(acoes&&acoes.length){
    const bar=document.createElement('div');bar.style.cssText='display:flex;gap:10px;justify-content:flex-end;margin-top:18px;';
    for(const a of acoes){
      const b=document.createElement('button');b.textContent=a.texto;
      b.style.cssText='padding:9px 16px;border-radius:8px;border:'+(a.primario?'none':'1px solid var(--border,#ddd)')+';background:'+(a.primario?'var(--accent,#6366f1)':'none')+';color:'+(a.primario?'#fff':'var(--text,#111)')+';font-weight:700;font-size:calc(13px*var(--gt-fs,1.3));cursor:pointer;';
      b.onclick=a.aoClicar;bar.appendChild(b);
    }
    box.appendChild(bar);
  }
  ov.appendChild(box);
}
function _gtDupFechar(){const ov=document.getElementById('gt-dup-ov');if(ov)ov.style.display='none';}

// SAÍDA DE EMERGÊNCIA. As caixas de "Copiando…"/"Continuando…" não têm botão
// nenhum e o _gtDupStatus corta o fechar-clicando-no-fundo — se algo estourar
// ali (um erro fora da conversa com a Meta, por exemplo ao desenhar o
// progresso), o dono ficava preso atrás de uma cortina em cima da tela
// inteira, sem outra saída além de recarregar a página no meio de uma
// escrita numa conta ao vivo. Toda saída inesperada passa por aqui e sempre
// entrega um botão "Fechar".
function _gtDupErroInesperado(e){
  _gtDupBusy=false;
  const detalhe=_gtEsc(String((e&&e.message)||e||'').slice(0,180));
  _gtDupStatus(
    '<b>Deu um problema inesperado aqui na tela.</b><br>'+
    'Parte das cópias pode ter sido criada antes disso. <b>Nada foi apagado</b>, e '+
    'tudo que eu crio nasce <b>pausado</b> — então nada está gastando.<br>'+
    'Feche, confira a lista e, se faltar alguma coisa, duplique de novo só o que faltou.'+
    (detalhe?'<br><br><span style="color:var(--muted,#666);font-size:calc(11px*var(--gt-fs,1.3));">'+detalhe+'</span>':''),
    [{texto:'Fechar',primario:true,aoClicar:()=>{_gtDupFechar();loadGtData();}}]);
}

const _GT_DUP_ROTULO={campanha:'campanha',conjunto:'conjunto de anúncios',anuncio:'anúncio'};

// Guard de "só uma cópia em cascata por vez". O overlay #gt-dup-ov é
// compartilhado por toda a jornada (modal + progresso + relatório +
// "tentar continuar"), então duas cópias ao mesmo tempo bagunçariam a
// mesma janela e poderiam disparar chamadas concorrentes na Meta.
let _gtDupBusy=false;

// AÇÃO REAL na Meta: cria cópias. Sempre PAUSADAS, sempre após confirmação.
async function _gtAbrirDuplicar(alvo){
  const tok=_gtCurAcc?.id;
  if(!tok){await _gtConfirm('Sem conta selecionada','Escolha uma conta de anúncios antes de duplicar.',{okOnly:true});return;}
  if(_gtDupBusy){await _gtConfirm('Já tem uma cópia em andamento','Espere a cópia atual terminar antes de começar outra.',{okOnly:true});return;}

  const nome=alvo.nivel==='campanha'?alvo.campanha?.name
    :alvo.nivel==='conjunto'?alvo.conjuntos?.[0]?.name
    :alvo.anuncios?.[0]?.name;

  // A CONTA DA JANELA SAI DO PLANO, não das listas que entraram.
  // Antes o resumo contava `alvo.conjuntos`/`alvo.anuncios` e o plano era
  // montado depois, por outro caminho: qualquer item que planoDeCopia
  // descartasse (anúncio sem conjunto correspondente, por exemplo) continuava
  // sendo prometido na frase. Contando os PASSOS que de fato vão rodar, a
  // frase que o dono lê não tem como discordar do que vai acontecer.
  // A prévia usa quantidade 1 só pra contar UMA cópia; a quantidade escolhida
  // multiplica isso depois, e nenhuma das regras de "plano vazio" depende dela.
  const previa=planoDeCopia(alvo,{quantidade:1});
  if(!previa.length){
    await _gtConfirm('Não há o que copiar',
      'Abra a campanha para carregar os conjuntos e anúncios antes de duplicar.',{okOnly:true});
    return;
  }
  // Só os FILHOS (passos que entram dentro de outro) — o passo raiz é o próprio
  // item que o dono mandou copiar e já está nomeado na frase.
  const contaPassos=nivel=>previa.filter(p=>p.nivel===nivel&&p.paiPasso).length;
  const nCj=contaPassos('conjunto');
  const nAd=contaPassos('anuncio');
  const filhos=[nCj?nCj+(nCj===1?' conjunto':' conjuntos'):'',nAd?nAd+(nAd===1?' anúncio':' anúncios'):'']
    .filter(Boolean).join(' e ');
  // AVISO NECESSÁRIO: a lista de anúncios da tela vem dos insights do período
  // escolhido — anúncio sem gasto no período NÃO está nela e portanto NÃO
  // será copiado. Copiar de menos calado seria o pior desfecho possível aqui,
  // então isso vai escrito na janela, não num comentário de código.
  const resumo='Vai copiar '+(_GT_DUP_ROTULO[alvo.nivel]||'item')+' <b>«'+_gtEsc(nome||'sem nome')+'»</b>'
    +(filhos?', com '+filhos+'.':'.')
    +(nAd?'<br><span style="color:var(--orange,#d97706)">Só entram os anúncios com gasto no período que está selecionado.</span>':'');

  const escolha=await _gtDuplicarModal(resumo);
  if(!escolha)return;

  const plano=planoDeCopia(alvo,escolha);
  if(!plano.length){
    _gtDupStatus('<b>Não há o que copiar.</b><br>Abra a campanha para carregar os conjuntos e anúncios antes de duplicar.',
      [{texto:'Entendi',primario:true,aoClicar:_gtDupFechar}]);
    return;
  }

  _gtDupBusy=true;
  // Ownership da liberação do guard passa pro _gtDupRelatar assim que ele é
  // chamado (ele libera no sucesso e em "Deixar assim", e mantém preso
  // durante "Tentar continuar"). O catch aqui é a rede de segurança caso algo
  // estoure fora da conversa com a Meta: libera o guard E devolve uma janela
  // com botão de fechar — a caixa "Copiando…" não tem botão nenhum, então sem
  // isto o dono ficava preso atrás dela.
  try{
    // comEspera: se a Meta pedir calma no meio da cascata, ela mesma espera e
    // repete, sem devolver o problema pro dono.
    const enviar=comEspera((caminho,params)=>metaPost(caminho,params,tok));
    const passoTxt=p=>_GT_DUP_ROTULO[p.passo.nivel]+' «'+_gtEsc(p.passo.origemNome)+'»';
    const aoProgredir=p=>_gtDupStatus('<b>Copiando…</b><br>'+p.feitos+' de '+p.total+' — '+passoTxt(p));

    _gtDupStatus('<b>Copiando…</b><br>0 de '+plano.length);
    const rel=await executarPlano(plano,{enviar,aoProgredir});
    _gtDupRelatar(plano,rel,enviar);
  }catch(e){
    _gtDupErroInesperado(e);
  }
}

// Mostra o desfecho. Falhou no meio: NADA é desfeito — o que ficou está
// pausado, e o dono escolhe continuar ou deixar assim.
function _gtDupRelatar(plano,rel,enviar){
  if(!rel.falhou){
    // Terminou: nenhuma outra chamada na Meta vai acontecer por essa
    // jornada, então o guard de "uma cópia por vez" já pode ser liberado.
    _gtDupBusy=false;
    _gtDupStatus('<b>Pronto.</b><br>'+rel.concluidos.length+' '+(rel.concluidos.length===1?'item copiado':'itens copiados')+
      ', tudo <b>pausado</b>. Ative quando quiser, e ajuste o orçamento no botão «✎ editar».',
      [{texto:'Fechar',primario:true,aoClicar:()=>{_gtDupFechar();loadGtData();}}]);
    return;
  }
  const motivo=_gtDupTraduzir(rel.falhou.motivo);
  const feitos=rel.concluidos.length;
  const cabecalho='<b>Parei no meio.</b><br>'+motivo+
    '<br><br>Copiei '+feitos+' de '+plano.length+' '+(plano.length===1?'item':'itens')+'. '+
    (feitos?'O que já foi criado está <b>pausado</b> e não vai gastar. Não apaguei nada.':'Nada foi criado.');
  // "Deixar assim" é o desfecho final: libera o guard aqui.
  const deixarAssim={texto:'Deixar assim',aoClicar:()=>{_gtDupBusy=false;_gtDupFechar();loadGtData();}};

  // CASO EM QUE CONTINUAR É PERIGOSO: a Meta aceitou o pedido mas não devolveu
  // o número da cópia. Como não veio número, o passo NÃO entra na lista do que
  // foi criado — e "Tentar continuar" mandaria o mesmo pedido de novo. Se a
  // cópia tiver sido criada de verdade (e só a Meta sabe), o dono acaba com
  // DUAS. Aqui a saída honesta é parar e mandar conferir, não oferecer um
  // botão que pode duplicar em dobro.
  if(/não devolveu/i.test(String(rel.falhou.motivo||''))){
    _gtDupBusy=false;
    _gtDupStatus(
      cabecalho+
      '<br><br>Como a Meta não informou o número, <b>não sei dizer se essa cópia foi criada ou não</b> — '+
      'e mandar de novo poderia criar uma segunda cópia do mesmo item. '+
      'Confira no Gerenciador de Anúncios da Meta e, se faltar, duplique só o que faltou.',
      [{texto:'Fechar',primario:true,aoClicar:()=>{_gtDupFechar();loadGtData();}}]);
    return;
  }

  _gtDupStatus(cabecalho,
    [
      deixarAssim,
      // "Tentar continuar" NÃO libera o guard — ele mesmo dispara mais
      // chamadas na Meta (via retomar) e chama _gtDupRelatar de novo, que
      // decide o desfecho seguinte. Só assim o guard cobre a jornada inteira,
      // sem travar pra sempre (todo caminho volta a passar por aqui).
      {texto:'Tentar continuar',primario:true,aoClicar:async()=>{
        _gtDupStatus('<b>Continuando…</b>');
        try{
          const novo=await retomar(plano,rel,{enviar,
            aoProgredir:p=>_gtDupStatus('<b>Continuando…</b><br>'+p.feitos+' de '+p.total)});
          _gtDupRelatar(plano,novo,enviar);
        }catch(e){
          // Rede de segurança: retomar não deveria lançar (executarPlano já
          // captura os erros da Meta). Se lançar mesmo assim, a caixa
          // "Continuando…" na tela não tem botão nenhum — relançar o erro
          // deixaria o dono trancado atrás dela. _gtDupErroInesperado libera o
          // guard e devolve o botão de fechar.
          _gtDupErroInesperado(e);
        }
      }},
    ]);
}

// Traduz o erro da Meta. Mesmo espírito do tradutor de _gtApplyAction: o dono
// não precisa ver jargão técnico, precisa saber o que fazer.
function _gtDupTraduzir(msg){
  const m=String(msg||'');
  if(/#17|rate|limit|too many|reduce the amount/i.test(m))
    return 'A Meta pediu para <b>diminuir o ritmo</b> (limite de chamadas). Espere alguns minutos e tente continuar.';
  if(/não devolveu/i.test(m))
    return 'A Meta aceitou o pedido mas <b>não informou o número da cópia</b>, então parei para não criar item solto.';
  // JANELA DE ATRIBUIÇÃO (subcode 1885423) — medido em 2026-08-03: é a causa de
  // 4 em cada 5 falhas de cópia de conjunto nesta conta. A campanha foi criada
  // com uma janela que a Meta NÃO ACEITA MAIS para aquele objetivo; ela tolera
  // no que já existe, e revalida na cópia. Não é permissão, e chamar de
  // permissão mandava o dono procurar no lugar errado.
  if(/1885423|janela de atribui/i.test(m))
    return 'A Meta recusou a cópia por causa da <b>janela de atribuição</b> deste conjunto. '
      + 'Ela foi criada com uma janela que a Meta não aceita mais para este objetivo — '
      + 'tolera no conjunto que já existe, mas barra na cópia. '
      + 'O caminho é criar o conjunto novo pelo Gerenciador (ou pela Fábrica) em vez de copiar este.';
  // O (#200) SECO. Não afirmamos mais falta de permissão: a sonda de 2026-08-03
  // mostrou o token COM ads_management, ads_read e business_management, e o
  // usuário como MANAGE na conta. Dizer "não tem permissão" mandava procurar um
  // problema que não existe — e foi o que atrasou este diagnóstico.
  if(/#200|permissions error/i.test(m) && !/error_user_msg|explica/i.test(m))
    return 'A Meta recusou a cópia <b>sem dizer o motivo</b> (erro 200). '
      + 'Não é falta de permissão do acesso — isso foi conferido. '
      + 'Costuma ser alguma regra nova da Meta que o conjunto antigo não cumpre; '
      + 'criar o conjunto novo em vez de copiar resolve.';
  if(/permiss|#10\b|#272|OAuth|token|management/i.test(m))
    return 'O acesso desta conta <b>não tem permissão de gerenciar anúncios</b>. Verifique na Meta.';
  // SEM TRUNCAR. Cortar em 180 caracteres apagava justamente o fim, que é onde
  // a Meta explica — foi o que segurou o diagnóstico deste bug por dias.
  return '<b>A Meta recusou:</b> '+_gtEsc(m);
}

/* ── EDITOR DE PÚBLICO DO CONJUNTO ──────────────────────────────────────────
   Estado de trabalho no módulo, não passado de função em função: os controles
   são muitos e todos mexem no MESMO objeto. Redesenhar é sempre pelo
   _gtPubRedesenha, para o botão de salvar reavaliar os avisos bloqueantes. */
let _gtPub=null;            // Publico em edição (forma do publico-alvo.js)
// Sugestões da IA para o objetivo DESTA campanha (interesses_sugeridos), e o
// balde que as escolhe. `null` = não carregou; `[]` = carregou e não tem.
// A diferença importa: a faixa some nos dois casos, mas só o primeiro é falha.
let _gtPubSugeridos=null;
let _gtPubObjetivo='';
let _gtPubSugeridoEm=null;   // quando o robô gerou — vai na frase de procedência
let _gtPubAntes=null;       // como estava quando abriu — base do resumo
let _gtPubSalvos=null;      // públicos personalizados da conta (null = não carregou)
let _gtPubPresets=null;     // públicos prontos do Estúdio (null = não carregou)
let _gtPubAtivo=false;      // o conjunto está rodando?
let _gtPubBusy=false;       // trava: um editor por vez
// true só entre o "Fechar" de emergência (dono já saiu da caixa) e o pedido
// de verdade terminar na Meta: _gtPubBusy continua preso os dois casos, mas
// "tem editor aberto, termine antes de abrir outro" e "já fechou, só falta a
// Meta responder" são avisos diferentes — o segundo não tem nada pra o dono
// terminar, então merece frase própria (ver _gtAbrirPublico).
let _gtPubFechadoEmVoo=false;
// Começa e termina como função vazia, NUNCA null: os controles do editor
// chamam isto direto, e se algo lançar com a janela aberta um `null` aqui
// viraria erro em cima de erro, deixando o dono com a tela travada.
let _gtPubRedesenha=()=>{};

function _gtPubOverlay(){
  let ov=document.getElementById('gt-pub-ov');
  if(!ov){ov=document.createElement('div');ov.id='gt-pub-ov';ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;touch-action:none;overscroll-behavior:contain;';document.body.appendChild(ov);}
  return ov;
}
function _gtPubFechar(){const ov=document.getElementById('gt-pub-ov');if(ov)ov.style.display='none';}

// Caixa de estado (carregando / resultado / erro). SEMPRE zera o ov.onclick:
// durante a gravação não pode fechar clicando fora, e toda saída é por botão —
// lição que o duplicar já pagou (cópia seguia rodando com a tela parecendo parada).
function _gtPubStatus(html,acoes){
  const ov=_gtPubOverlay();ov.innerHTML='';ov.style.display='flex';ov.onclick=null;
  const box=document.createElement('div');
  box.style.cssText='background:var(--surface,#fff);color:var(--text,#111);border-radius:14px;max-width:460px;width:100%;padding:24px;box-shadow:0 24px 60px rgba(0,0,0,.45);font-family:var(--fonte-principal);font-size:calc(13px*var(--gt-fs,1.3));line-height:1.6;';
  box.innerHTML=html;
  if(acoes&&acoes.length){
    const bar=document.createElement('div');bar.style.cssText='display:flex;gap:10px;justify-content:flex-end;margin-top:18px;flex-wrap:wrap;';
    for(const a of acoes){
      const b=document.createElement('button');b.textContent=a.texto;b.disabled=!!a.desabilitado;
      b.style.cssText='padding:9px 16px;border-radius:8px;border:'+(a.primario?'none':'1px solid var(--border,#ddd)')+';background:'+(a.primario?'var(--accent,#6366f1)':'none')+';color:'+(a.primario?'#fff':'var(--text,#111)')+';font-weight:700;font-size:calc(13px*var(--gt-fs,1.3));cursor:'+(a.desabilitado?'not-allowed':'pointer')+';opacity:'+(a.desabilitado?'.5':'1')+';';
      if(!a.desabilitado)b.onclick=a.aoClicar;
      bar.appendChild(b);
    }
    box.appendChild(bar);
  }
  ov.appendChild(box);
}

// Tijolos do editor. Nomes curtos porque aparecem muitas vezes abaixo.
function _gtPubTitulo(txt){const d=document.createElement('div');d.style.cssText='font-size:calc(12px*var(--gt-fs,1.3));font-weight:800;margin:16px 0 6px;';d.textContent=txt;return d;}
function _gtPubAjuda(txt){const d=document.createElement('div');d.style.cssText='font-size:calc(11px*var(--gt-fs,1.3));color:var(--muted,#666);margin:-3px 0 7px;line-height:1.45;';d.textContent=txt;return d;}
function _gtPubLinha(){const d=document.createElement('div');d.style.cssText='display:flex;gap:6px;flex-wrap:wrap;align-items:center;';return d;}
function _gtPubInput(valor,ph,largura){const i=document.createElement('input');i.value=valor==null?'':valor;i.placeholder=ph||'';i.style.cssText='padding:7px 9px;border-radius:7px;border:1px solid var(--border,#ddd);background:var(--surface,#fff);color:var(--text,#111);font-size:calc(12px*var(--gt-fs,1.3));'+(largura?'width:'+largura+';':'flex:1;min-width:120px;');return i;}

// Etiqueta de item escolhido, com o × pra tirar. `extra` entra antes do ×
// (é onde o raio da cidade aparece).
function _gtPubChip(texto,aoRemover,extra){
  const c=document.createElement('span');
  c.style.cssText='display:inline-flex;align-items:center;gap:5px;padding:4px 8px;border-radius:20px;border:1px solid var(--border,#ddd);font-size:calc(11px*var(--gt-fs,1.3));background:var(--surface2,rgba(0,0,0,.03));';
  const t=document.createElement('span');t.textContent=texto;c.appendChild(t);
  if(extra)c.appendChild(extra);
  const x=document.createElement('button');x.textContent='×';x.title='Tirar';
  x.style.cssText='border:none;background:none;color:var(--muted,#666);cursor:pointer;font-size:calc(14px*var(--gt-fs,1.3));line-height:1;padding:0 2px;';
  x.onclick=ev=>{ev.stopPropagation();aoRemover();};
  c.appendChild(x);
  return c;
}

// Campo de busca + resultados. `aoBuscar(termo)` devolve lista ou lança.
// Erro NUNCA é engolido: busca que falha calada vira "não acha nada" e o dono
// não entende por quê (o Estúdio já apanhou exatamente disso).
function _gtPubBusca(ph,aoBuscar,aoEscolher,rotuloDe){
  const cx=document.createElement('div');
  const linha=_gtPubLinha();
  const inp=_gtPubInput('',ph);
  const bt=document.createElement('button');bt.textContent='Buscar';bt.className='gt-btn-dup';
  const res=document.createElement('div');res.style.cssText='display:flex;flex-direction:column;gap:2px;margin-top:6px;';
  const erro=document.createElement('div');erro.style.cssText='font-size:calc(11px*var(--gt-fs,1.3));color:var(--red,#dc2626);margin-top:5px;';
  async function buscar(){
    const termo=inp.value.trim();if(!termo)return;
    res.innerHTML='';erro.textContent='';bt.disabled=true;bt.textContent='…';
    try{
      const achados=await aoBuscar(termo);
      if(!achados.length){erro.textContent='Nada encontrado para essa busca.';return;}
      for(const item of achados){
        const b=document.createElement('button');b.textContent=rotuloDe(item);
        b.style.cssText='text-align:left;padding:6px 9px;border-radius:6px;border:1px solid var(--border,#ddd);background:none;color:var(--text,#111);font-size:calc(11px*var(--gt-fs,1.3));cursor:pointer;';
        b.onclick=ev=>{ev.stopPropagation();aoEscolher(item);inp.value='';res.innerHTML='';_gtPubRedesenha&&_gtPubRedesenha();};
        res.appendChild(b);
      }
    }catch(e){
      erro.textContent='Não consegui buscar agora: '+String((e&&e.message)||e).slice(0,120);
    }finally{bt.disabled=false;bt.textContent='Buscar';}
  }
  bt.onclick=ev=>{ev.stopPropagation();buscar();};
  inp.onkeydown=ev=>{if(ev.key==='Enter'){ev.preventDefault();buscar();}};
  linha.appendChild(inp);linha.appendChild(bt);
  cx.appendChild(linha);cx.appendChild(res);cx.appendChild(erro);
  return cx;
}

// As duas buscas da Meta, nos mesmos caminhos que o Estúdio já provou ao vivo.
async function _gtPubBuscarCidades(termo){
  const tok=_gtCurAcc?.id;
  const r=await metaFetch('/search',{type:'adgeolocation',location_types:JSON.stringify(['city']),q:termo,limit:15},tok);
  return (r&&r.data)||[];
}
async function _gtPubBuscarInteresses(termo){
  const tok=_gtCurAcc?.id;
  const r=await metaFetch('/search',{type:'adinterest',q:termo,limit:10},tok);
  return (r&&r.data)||[];
}

// Onde o anúncio é mostrado: cidades com raio, e lugares a excluir.
// A LEITURA DA IA, em cima da evidência que já está na tela.
//
// Ela NÃO recalcula nada: os números vão prontos e o prompt manda não inventar
// outros. O que a IA acrescenta é o julgamento — o que fazer, por quê, e qual o
// risco de seguir. É a régua que o dono deu: "senão conta de porcentagem eu
// mesmo fazia".
async function _gtPubLeituraDaIA(sugestao,rotulo){
  try{
    _gtPubSugestaoDados={..._gtPubSugestaoDados,pensando:true};_gtPubRedesenha();
    const {data:{session}}=await sbClient.auth.getSession();
    if(!session)return;
    const sub=_gtNovo?_gtNovoObjetivos.find(o=>o.id===_gtNovo.objetivo):null;
    const r=await fetch(SUPABASE_URL+'/functions/v1/sugerir-publico-ia',{
      method:'POST',
      headers:{'Authorization':'Bearer '+session.access_token,'apikey':SUPABASE_ANON_KEY,'Content-Type':'application/json'},
      body:JSON.stringify({
        evidencia:{contando:rotulo,idade:sugestao.idade,cidades:sugestao.cidades,interesses:sugestao.interesses,porque:sugestao.porqueDosConjuntos},
        marca:(_gtCurAcc&&(_gtCurAcc.display_name||_gtCurAcc.name))||'',
        // QUEM a marca atende. Sem isto a IA tira a idade dos numeros da conta,
        // que dizem quem CLICOU -- nao para quem a marca quer vender.
        persona:limparPersona((_gtCurAcc&&_gtCurAcc.persona)||''),
        objetivo:(sub&&sub.rotulo)||'',
      }),
    });
    const d=await r.json().catch(()=>({}));
    if(!r.ok||!d.ok){
      // O MOTIVO VAI PARA A TELA, inclusive o "rode o robô da chave". Erro
      // genérico aqui faria parecer que a IA não existe.
      _gtPubSugestaoDados={..._gtPubSugestaoDados,pensando:false,
        erroIA:(d&&(d.comoResolver||d.detalhe||d.error))||('a função respondeu '+r.status)};
      return;
    }
    _gtPubSugestaoDados={..._gtPubSugestaoDados,pensando:false,
      leitura:d.leitura||'',cuidado:d.cuidado||'',interessesIA:d.interesses||[]};
  }catch(e){
    _gtPubSugestaoDados={..._gtPubSugestaoDados,pensando:false,erroIA:String((e&&e.message)||e)};
  }finally{ _gtPubRedesenha(); }
}

// SUGERIR PELO QUE JÁ ACONTECEU NESTA CONTA.
//
// Não é palpite: sai do custo por resultado de cada faixa de idade e dos
// conjuntos que de fato performam. A evidência vem junto de cada sugestão —
// o dono já disse que conta de porcentagem ele mesmo faz.
function _gtPubSecaoSugestao(){
  const bloco=document.createElement('div');
  bloco.appendChild(_gtPubTitulo('Sugerir pelo que já aconteceu aqui'));
  bloco.appendChild(_gtPubAjuda('Olha os últimos 90 dias desta conta e mostra o que saiu mais barato — com o número ao lado.'));

  if(_gtPubSugerindo){
    bloco.appendChild(_gtPubCaixa('Olhando os números da conta…'));
    return bloco;
  }
  if(!_gtPubSugestaoDados){
    const b=document.createElement('button');
    b.type='button';
    b.textContent='Ver o que os números dizem';
    b.style.cssText='padding:8px 14px;border-radius:8px;cursor:pointer;border:1px solid var(--accent,#6366f1);'
      +'background:transparent;color:var(--accent,#6366f1);font-weight:700;'
      +'font-family:var(--fonte-principal);font-size:calc(11px*var(--gt-fs,1.3));';
    b.onclick=_gtPubBuscarSugestao;
    bloco.appendChild(b);
    return bloco;
  }

  const s=_gtPubSugestaoDados;
  if(!s.temAlgo){
    bloco.appendChild(_gtPubCaixa(s.motivoVazio));
    return bloco;
  }
  // TRÊS PLANOS, e a ordem é a mensagem: o achado com o número, a comparação
  // que o sustenta, e só depois a explicação por extenso. Antes era um
  // parágrafo cinza de cinco linhas onde "2,5× mais barato" tinha o mesmo peso
  // que a ressalva sobre amostra — o dono viu e disse que dava para melhorar.
  const caixa=_gtPubCaixa('');
  const mc=manchete(s);
  if(mc){
    const topo=document.createElement('div');
    topo.style.cssText='display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;margin-bottom:2px;';
    const t1=document.createElement('div');
    t1.style.cssText='font-weight:800;color:var(--text,#111);font-size:calc(13px*var(--gt-fs,1.3));';
    t1.textContent=mc.titulo;
    const t2=document.createElement('div');
    // O NÚMERO É A MANCHETE. Verde porque é economia, e grande porque é o único
    // pedaço que precisa ser lido de longe.
    t2.style.cssText='font-weight:800;color:var(--green,#16a34a);font-family:var(--fonte-dados);'
      +'font-size:calc(13px*var(--gt-fs,1.3));';
    t2.textContent=mc.numero;
    topo.appendChild(t1);topo.appendChild(t2);
    caixa.appendChild(topo);
    if(mc.custou)caixa.appendChild(_gtPubLinhaTexto(mc.custou,true));
  }

  // A COMPARAÇÃO em duas linhas alinhadas. Alinhar os valores à direita é o que
  // deixa a diferença visível sem ninguém precisar fazer a conta.
  const comp=comparacao(s);
  if(comp.length){
    const tab=document.createElement('div');
    tab.style.cssText='margin:8px 0 2px;';
    for(const l of comp){
      const linha=document.createElement('div');
      linha.style.cssText='display:flex;justify-content:space-between;gap:12px;padding:5px 0;'
        +'border-bottom:1px solid var(--border,#e5e5e5);';
      const e=document.createElement('span');
      e.style.cssText='color:var(--muted,#666);';
      e.textContent=(l.tom==='bom'?'mais barato · ':'mais caro · ')+l.rotulo+' anos';
      const d=document.createElement('span');
      d.style.cssText='font-family:var(--fonte-dados);font-weight:700;color:'
        +(l.tom==='bom'?'var(--green,#16a34a)':'var(--orange,#d97706)')+';';
      d.textContent=l.valor+' por resultado';
      linha.appendChild(e);linha.appendChild(d);
      tab.appendChild(linha);
    }
    caixa.appendChild(tab);
  }

  // De onde saiu a conta, pequeno. Vira rodapé porque é procedência, não achado.
  if(s.contando)caixa.appendChild(_gtPubLinhaTexto('Contando '+s.contando+', nos últimos 90 dias.',true));

  // O QUE SE REPETE nos melhores conjuntos, em lista. Oito interesses separados
  // por vírgula é uma frase que ninguém termina de ler.
  for(const r of repetidos(s)){
    const t=document.createElement('div');
    t.style.cssText='margin-top:9px;font-weight:700;color:var(--text,#111);';
    t.textContent=r.titulo;
    caixa.appendChild(t);
    const chips=document.createElement('div');
    chips.style.cssText='display:flex;flex-wrap:wrap;gap:5px;margin-top:5px;';
    for(const nome of r.itens){
      const c=document.createElement('span');
      c.style.cssText='padding:3px 9px;border-radius:999px;background:var(--surface,#fff);'
        +'border:1px solid var(--border,#e5e5e5);color:var(--text,#111);'
        +'font-size:calc(10px*var(--gt-fs,1.3));';
      c.textContent=nome;
      chips.appendChild(c);
    }
    caixa.appendChild(chips);
  }
  if(s.porqueDosConjuntos)caixa.appendChild(_gtPubLinhaTexto(s.porqueDosConjuntos,true));

  // A FRASE LONGA não some — vira o segundo plano, que é o lugar dela. Fechada,
  // porque quem quis o resumo já o teve nas duas primeiras linhas.
  if(s.idade&&s.idade.porque){
    const det=document.createElement('details');
    det.style.cssText='margin-top:9px;';
    const sum=document.createElement('summary');
    sum.style.cssText='cursor:pointer;color:var(--muted,#666);font-size:calc(10.5px*var(--gt-fs,1.3));';
    sum.textContent='como cheguei nisso';
    det.appendChild(sum);
    det.appendChild(_gtPubLinhaTexto(s.idade.porque));
    caixa.appendChild(det);
  }
  bloco.appendChild(caixa);

  // A LEITURA DA IA vem numa caixa PRÓPRIA, e marcada. Misturar com os números
  // faria parecer que a opinião dela também foi medida.
  if(s.pensando||s.leitura||s.erroIA){
    const cx=_gtPubCaixa('');
    cx.style.marginTop='7px';
    cx.style.borderLeft='3px solid var(--accent,#6366f1)';
    cx.appendChild(_gtPubLinhaTexto('Leitura da IA',true));
    if(s.pensando)cx.appendChild(_gtPubLinhaTexto('Lendo os números…'));
    else if(s.erroIA)cx.appendChild(_gtPubLinhaTexto('Não consegui a leitura: '+s.erroIA,true));
    else{
      // EM PARÁGRAFOS. O modelo devolve um bloco corrido de cinco linhas; duas
      // frases por bloco dá respiro sem picotar o raciocínio.
      for(const p of paragrafosDaLeitura(s.leitura)){
        const d=_gtPubLinhaTexto(p);
        d.style.marginTop='5px';
        cx.appendChild(d);
      }
      if(s.cuidado){
        const c=_gtPubLinhaTexto('Cuidado: '+s.cuidado,true);
        c.style.marginTop='7px';
        cx.appendChild(c);
      }
    }
    bloco.appendChild(cx);
  }

  // APLICAR É UMA ESCOLHA, e não o que acontece por padrão: a sugestão é
  // evidência, e quem decide o público continua sendo quem paga por ele.
  const fila=_gtPubLinha();
  fila.style.marginTop='8px';
  if(s.idade)fila.appendChild(_gtPubBotaoAplicar(`Usar idade ${s.idade.idadeMin}–${s.idade.idadeMax}`,()=>{
    _gtPub.idadeMin=s.idade.idadeMin;_gtPub.idadeMax=s.idade.idadeMax;_gtPubRedesenha();
  }));
  if((s.interessesIA||[]).length)fila.appendChild(_gtPubBotaoAplicar('Somar os interesses que a IA escolheu',()=>{
    const jaTem=new Set((_gtPub.interesses||[]).map(i=>String(i.id)));
    for(const i of s.interessesIA)if(!jaTem.has(String(i.id)))_gtPub.interesses.push({id:String(i.id),name:i.nome});
    _gtPubRedesenha();
  }));
  if(s.interesses.length)fila.appendChild(_gtPubBotaoAplicar('Somar todos os interesses',()=>{
    const jaTem=new Set((_gtPub.interesses||[]).map(i=>String(i.id)));
    for(const i of s.interesses)if(!jaTem.has(String(i.key)))_gtPub.interesses.push({id:String(i.key),name:i.nome});
    _gtPubRedesenha();
  }));
  if(fila.childNodes.length)bloco.appendChild(fila);
  return bloco;
}

function _gtPubCaixa(txt){
  const d=document.createElement('div');
  d.style.cssText='background:var(--surface2,#f2ede4);border-radius:8px;padding:11px 13px;'
    +'font-size:calc(11px*var(--gt-fs,1.3));line-height:1.6;color:var(--text,#111);';
  if(txt)d.textContent=txt;
  return d;
}
function _gtPubLinhaTexto(txt,fraco){
  const d=document.createElement('div');
  d.style.cssText='margin-bottom:4px;'+(fraco?'color:var(--muted,#666);font-size:calc(10px*var(--gt-fs,1.3));':'');
  d.textContent=txt;
  return d;
}
function _gtPubBotaoAplicar(rotulo,aoClicar){
  const b=document.createElement('button');
  b.type='button';b.textContent=rotulo;
  b.style.cssText='padding:7px 12px;border-radius:999px;cursor:pointer;border:1px solid var(--accent,#6366f1);'
    +'background:var(--accent,#6366f1);color:#fff;font-weight:700;'
    +'font-family:var(--fonte-principal);font-size:calc(10.5px*var(--gt-fs,1.3));';
  b.onclick=(e)=>{if(e&&e.preventDefault)e.preventDefault();aoClicar();};
  return b;
}

// AS TRÊS CHAMADAS que sustentam a sugestão. Falhar aqui não derruba o editor:
// sugestão é ajuda, e ajuda que quebra a tela é atrapalho.
async function _gtPubBuscarSugestao(){
  if(_gtPubSugerindo)return;
  _gtPubSugerindo=true;_gtPubRedesenha();
  try{
    const act='act_'+_maCleanAccId(_gtCurAcc.ad_account_id), conta=_gtCurAcc.id;
    const base={date_preset:'last_90d',fields:'spend,actions'};
    const [porIdade,conjuntos,insConjuntos]=await Promise.all([
      metaFetch('/'+act+'/insights',{...base,level:'account',breakdowns:'age'},conta).catch(()=>null),
      metaFetch('/'+act+'/adsets',{fields:'id,name,targeting',limit:200},conta).catch(()=>null),
      // `adset_id` PEDIDO EXPLICITAMENTE: sem ele a resposta não diz de qual
      // conjunto cada linha é, e o cruzamento com o targeting não fecha —
      // as cidades e os interesses simplesmente não apareciam.
      metaFetch('/'+act+'/insights',{...base,fields:'spend,actions,adset_id',level:'adset',limit:300},conta).catch(()=>null),
    ]);
    const linhasIdade=(porIdade&&porIdade.data)||[];
    const linhasConj=(insConjuntos&&insConjuntos.data)||[];
    // QUAL RESULTADO CONTAR sai do que a conta mais produz, e o nome disso
    // aparece na tela: contar errado inverteria a recomendação inteira.
    const rotulo=escolherAcao([...linhasIdade,...linhasConj]);
    const contar=contadorDe(rotulo);
    const porConjunto={};
    for(const l of linhasConj)if(l&&l.adset_id)porConjunto[String(l.adset_id)]=l;
    const s=montarSugestao({
      faixasDeIdade:lerFaixasDeIdade(linhasIdade,contar),
      conjuntos:lerConjuntos((conjuntos&&conjuntos.data)||[],porConjunto,contar),
    });
    _gtPubSugestaoDados={...s,contando:rotulo};
    _gtPubRedesenha();
    // A EVIDÊNCIA JÁ ESTÁ NA TELA antes da IA responder. Se ela demorar ou
    // falhar, os números continuam ali — a leitura é um acréscimo, não a
    // condição para a tela servir.
    if(s.temAlgo)await _gtPubLeituraDaIA(s,rotulo);
  }catch(e){
    _gtPubSugestaoDados={temAlgo:false,motivoVazio:'Não consegui olhar os números: '+String((e&&e.message)||e)};
  }finally{
    _gtPubSugerindo=false;_gtPubRedesenha();
  }
}

// COMEÇAR DE UM PÚBLICO SALVO — a primeira coisa do editor, porque é a que
// evita refazer à mão o que já está pronto.
//
// Clicar SUBSTITUI o editor inteiro: cidade, idade, gênero, interesses e
// comportamentos. Era isto que faltava — o dono escolhia um público que já
// trazia as cidades e a tela continuava pedindo a cidade.
function _gtPubSecaoPublicosSalvos(){
  const bloco=document.createElement('div');
  const lista=_gtPubSalvosDeVerdade;
  // Não carregou é diferente de não existir: a seção some quando não há o que
  // mostrar, em vez de afirmar que a conta não tem público salvo.
  if(!lista||!lista.length)return bloco;

  bloco.appendChild(_gtPubTitulo('Começar de um público salvo'));
  bloco.appendChild(_gtPubAjuda('Traz tudo pronto: onde, idade, gênero, interesses e comportamentos. Depois você ajusta o que quiser.'));

  // BUSCA quando a lista é longa. Doze caixas iguais empilhadas não é lista, é
  // parede — e achar "Gastronomia SP" no meio delas é rolar até dar sorte.
  if(lista.length>6){
    const busca=_gtPubInput(_gtPubSalvoBusca,'Buscar público salvo…','100%');
    busca.oninput=()=>{_gtPubSalvoBusca=busca.value;_gtPubRedesenha();};
    busca.style.marginBottom='7px';
    bloco.appendChild(busca);
  }
  const alvo=_gtSemAcento(_gtPubSalvoBusca);
  const visiveis=alvo?lista.filter(sa=>_gtSemAcento(sa.nome+' '+sa.resumo).includes(alvo)):lista;

  const fila=_gtPubLinha();
  fila.style.flexDirection='column';
  fila.style.alignItems='stretch';
  if(!visiveis.length){
    fila.appendChild(_gtPubLinhaTexto('Nenhum público salvo com esse nome.',true));
  }
  for(const sa of visiveis){
    // QUAL ESTÁ VALENDO. Sem isto a pessoa clicava, o editor mudava lá embaixo
    // e a lista continuava com as doze caixas idênticas — nada dizia qual foi.
    const escolhido=_gtPubSalvoEscolhido===sa.id;
    const b=document.createElement('button');
    b.type='button';
    b.style.cssText='display:block;width:100%;text-align:left;padding:9px 11px;margin-bottom:5px;'
      +'border-radius:10px;cursor:pointer;font-family:var(--fonte-principal);'
      +'font-size:calc(11px*var(--gt-fs,1.3));color:var(--text,#111);transition:border-color .12s,background .12s;'
      +(escolhido
        ? 'border:2px solid var(--accent,#6366f1);background:color-mix(in srgb,var(--accent,#6366f1) 10%,transparent);'
        : 'border:1px solid var(--border,#ddd);background:var(--surface2,#f2ede4);');
    b.dataset.gtpubSalvo=String(sa.id);
    const topo=document.createElement('div');
    topo.style.cssText='display:flex;gap:8px;align-items:center;justify-content:space-between;';
    const nome=document.createElement('div');
    nome.style.cssText='font-weight:700;';
    nome.textContent=sa.nome;
    topo.appendChild(nome);
    if(escolhido){
      const selo=document.createElement('span');
      selo.style.cssText='flex:none;padding:2px 9px;border-radius:999px;background:var(--accent,#6366f1);'
        +'color:#fff;font-weight:700;font-size:calc(9px*var(--gt-fs,1.3));';
      selo.textContent='✓ aplicado';
      topo.appendChild(selo);
    }
    const res=document.createElement('div');
    res.style.cssText='font-size:calc(10px*var(--gt-fs,1.3));color:var(--muted,#666);margin-top:2px;';
    res.textContent=sa.resumo;
    b.appendChild(topo);b.appendChild(res);
    // AS CIDADES QUE ELE TRAZ, na própria linha do escolhido. O dono pediu
    // exatamente isto: ver as cidades sem ter que rolar até "Onde mostrar" e
    // conferir uma a uma se foram mesmo.
    if(escolhido&&sa.cidades.length){
      const onde=document.createElement('div');
      onde.style.cssText='margin-top:6px;font-size:calc(10px*var(--gt-fs,1.3));color:var(--text,#111);';
      onde.textContent='Onde: '+sa.cidades.join(' · ');
      b.appendChild(onde);
    }
    b.onclick=()=>{
      // GUARDA A BASE. `montarTargeting` preserva o que o editor não gerencia
      // (comportamentos, posicionamentos, tudo) copiando do original — e o
      // original, a partir daqui, é o público salvo.
      _gtPubAntes=lerPublico(sa.targeting);
      _gtPub=_gtPubClonar(_gtPubAntes);
      if(_gtNovo)_gtNovo._targetingBase=sa.targeting;
      _gtPubSalvoEscolhido=sa.id;
      // SEM MODAL EM CIMA DE MODAL. O aviso de "público aplicado" obrigava um
      // clique a mais para dizer o que a própria lista agora mostra — e tapava
      // justamente o editor que a pessoa ia conferir.
      _gtPubRedesenha();
      // O redesenho recria os elementos: procurar o marcado DEPOIS é o único
      // jeito de achar o que está na tela agora. Centralizar evita que a linha
      // recém-marcada nasça atrás da barra de botões.
      // `document` e não `corpo`: esta função desenha uma SEÇÃO, e não conhece
      // a caixa do modal. O atributo é único o bastante para achar sozinho.
      const marcado=document.querySelector('[data-gtpub-salvo="'+String(sa.id).replace(/"/g,'')+'"]');
      if(marcado&&marcado.scrollIntoView)marcado.scrollIntoView({block:'center',behavior:'smooth'});
    };
    fila.appendChild(b);
  }
  bloco.appendChild(fila);
  return bloco;
}

// ONDE O ANUNCIO APARECE — Brasil, Estado, Cidade ou Local.
//
// PEDIDO DO DONO (13/08/2026): "eu preciso selecionar entre Brasil, Estado,
// Cidade e Local (estabelecimento, comercio, negocio) e aparece o pin automatico
// no mapa e vice versa, colocar o pin aleatorio mostra onde caiu de fato".
//
// O painel e o mapa sao os MESMOS do "Subir para a Meta" da Fabrica.
function _gtPubSecaoLugar(){
  const cx=document.createElement('div');
  cx.appendChild(_gtPubTitulo('Onde mostrar'));
  cx.appendChild(_gtPubAjuda('Escolha Brasil, Estado, Cidade ou Local. Cada um pode valer como a área inteira ou como um ponto com raio — e o mapa mostra onde cada escolha caiu. Clique no mapa para pôr um ponto: ele descobre sozinho em que rua caiu.'));

  // A LISTA DE LUGARES É UMA SÓ, e o painel e o mapa mexem NELA. As quatro
  // listas que a Meta entende (`paises`, `estados`, `cidades`, `pins`) são
  // refeitas a cada mudança — assim `montarTargeting` continua sendo a única
  // dona da tradução, e a tela nunca escreve na Meta por conta própria.
  const lugares = deListas(_gtPub);
  const gravar = () => Object.assign(_gtPub, paraListas(lugares));

  const caixaPainel = document.createElement('div');
  cx.appendChild(caixaPainel);

  const caixaMapa = document.createElement('div');
  cx.appendChild(caixaMapa);

  let mapa = null;
  const painel = montarPainelDeLugares(caixaPainel, {
    lugares,
    buscarNaMeta: (params) => metaFetch('/search', params, _gtCurAcc?.id),
    buscarNoMapa: async (termo) => {
      const { data, error } = await sbClient.functions.invoke('buscar-lugar', { body: { acao: 'buscar', termo } });
      // O MOTIVO VAI PRA TELA. Engolir o erro aqui devolveria lista vazia, e
      // "nada encontrado" quando na verdade a busca falhou é a mentira que o
      // padrão da casa proíbe.
      if (error || data?.error) throw new Error(data?.error || error?.message || 'a recepção do mapa não respondeu');
      return data;
    },
    aoMudar: () => { gravar(); if (mapa) mapa.desenhar(); },
  });

  // Desenha DEPOIS de estar na tela: o mapa mede a propria largura pra decidir
  // quantos quadradinhos busca, e fora do documento ela e zero.
  setTimeout(() => {
    try {
      mapa = montarMapa(caixaMapa, {
        lugares,
        editavel: true,
        // Nao redesenha o painel inteiro do publico: isso remontaria o mapa e
        // jogaria a vista de volta pro enquadre, tirando o dono do lugar onde
        // ele estava.
        aoMudar: () => { gravar(); painel.redesenhar(); },
        // O PONTO SE APRESENTA. Ele ja nasceu no mapa; o nome chega depois, e
        // quando chega o rotulo deixa de ser um par de numeros.
        aoPorPonto: async (ponto) => {
          try {
            const { data, error } = await sbClient.functions.invoke('buscar-lugar', { body: { acao: 'ondeCaiu', lat: ponto.lat, lng: ponto.lng } });
            if (error || data?.error) throw new Error(data?.error || error?.message || 'sem resposta');
            const achado = enderecoDeOndeCaiu(data);
            ponto.nome = achado.nome; ponto.endereco = achado.endereco;
          } catch (e) {
            // Sem nome, fica a coordenada — que e feia e verdadeira. E a tela
            // DIZ que nao conseguiu, em vez de deixar o dono achando que o
            // endereco em branco e o endereco.
            painel.dizer('Pus o ponto, mas não consegui o endereço dele: ' + String((e && e.message) || e).slice(0, 120), true);
          } finally {
            ponto.procurandoNome = false;
            gravar(); painel.redesenhar(); if (mapa) mapa.desenhar();
          }
        },
      });
    } catch (e) { console.warn('[GT] mapa nao abriu:', e); caixaMapa.textContent = 'Nao consegui abrir o mapa.'; }
  }, 0);

  // Aviso calmo (nao bloqueante): ha localidades que este editor nao gerencia
  // (CEP, bairro, regiao metropolitana...) e que serao preservadas intactas ao
  // salvar. O dono precisa saber disso AQUI, no corpo, antes de chegar na
  // confirmacao. Reusa o texto que avisosDe ja traduz para o mesmo caso.
  if((_gtPub.outrasLocalizacoes||[]).length){
    const notaLocal=avisosDe(_gtPub,_gtPub,{}).find(x=>x.tipo==='outras-localizacoes');
    if(notaLocal){
      const nota=document.createElement('div');
      nota.style.cssText='font-size:calc(11px*var(--gt-fs,1.3));color:var(--muted,#666);margin:2px 0 7px;line-height:1.45;';
      nota.innerHTML=notaLocal.texto;
      cx.appendChild(nota);
    }
  }

  cx.appendChild(_gtPubTitulo('Onde NÃO mostrar'));
  const fora=_gtPubLinha();
  // O raio da cidade excluída vem da Meta e é preservado ao salvar; aparece
  // aqui (sem campo pra editar) porque excluir 25 km em volta de uma cidade é
  // muito diferente de excluir só a cidade — o dono precisa ver isso.
  for(const e of _gtPub.excluidas){
    const raio=Number(e.raio)||0;
    const volta=raio>0?' — '+raio+' '+(e.unidade==='mile'?'mi':'km')+' em volta':'';
    fora.appendChild(_gtPubChip((e.nome||e.key)+(e.tipo==='regiao'?' (região)':'')+volta,()=>{_gtPub.excluidas=_gtPub.excluidas.filter(x=>x.key!==e.key);_gtPubRedesenha();}));
  }
  if(!_gtPub.excluidas.length)fora.appendChild(_gtPubAjuda('Nenhum lugar excluído.'));
  cx.appendChild(fora);
  cx.appendChild(_gtPubBusca('Excluir uma cidade…',_gtPubBuscarCidades,
    c=>{if(!_gtPub.excluidas.some(x=>x.key===String(c.key)))_gtPub.excluidas.push({key:String(c.key),nome:c.name,tipo:'cidade'});},
    c=>c.name+(c.region?' · '+c.region:'')));
  return cx;
}

// Idade, gênero e interesses — os três que brigam com o Advantage+.
function _gtPubSecaoPessoas(){
  const cx=document.createElement('div');
  cx.appendChild(_gtPubTitulo('Idade'));
  const li=_gtPubLinha();
  const de=_gtPubInput(_gtPub.idadeMin,'de','80px');de.type='number';de.min='13';de.max='65';de.dataset.gtpubId='idade-min';
  const ate=_gtPubInput(_gtPub.idadeMax,'até','80px');ate.type='number';ate.min='13';ate.max='65';ate.dataset.gtpubId='idade-max';
  // Idade ENTRA em temRestricaoManual (publico-alvo.js) — ao contrário do raio,
  // uma mudança aqui pode abrir ou fechar o conflito com Advantage+. Por isso
  // redesenha (onchange só dispara no blur/commit, não por tecla — não é o
  // problema de foco que tira a redesenha do raio). Sem isso o dono só
  // descobriria o conflito na confirmação, com Cancelar como único botão
  // vivo — perdendo a edição inteira.
  // Também nunca deixa mínimo > máximo passar pro objeto: a Meta devolveria
  // um erro cru (sem tradução em _gtPubTraduzir) em vez do editor prevenir
  // aqui — o valor recém-digitado é ajustado pra igualar o outro lado, e o
  // próprio campo mostra a correção ao redesenhar.
  // O min/max do campo é só sugestão do navegador: digitar 200 e sair do campo
  // passa direto. A Meta só aceita de 13 a 65, então a trava de verdade é
  // esta — o valor é preso na faixa antes de encostar no objeto, e o campo
  // mostra a correção ao redesenhar.
  const naFaixa=(n)=>Math.min(65,Math.max(13,n));
  de.onchange=()=>{
    _gtPub.idadeMin=naFaixa(Number(de.value)||18);
    if(_gtPub.idadeMin>_gtPub.idadeMax)_gtPub.idadeMin=_gtPub.idadeMax;
    _gtPubRedesenha();
  };
  ate.onchange=()=>{
    _gtPub.idadeMax=naFaixa(Number(ate.value)||65);
    if(_gtPub.idadeMax<_gtPub.idadeMin)_gtPub.idadeMax=_gtPub.idadeMin;
    _gtPubRedesenha();
  };
  li.appendChild(de);const t=document.createElement('span');t.textContent='até';li.appendChild(t);li.appendChild(ate);
  cx.appendChild(li);

  cx.appendChild(_gtPubTitulo('Gênero'));
  const lg=_gtPubLinha();
  const opcoes=[{v:[],r:'Todos'},{v:[1],r:'Homens'},{v:[2],r:'Mulheres'}];
  const atual=JSON.stringify(_gtPub.generos);
  for(const o of opcoes){
    const b=document.createElement('button');b.textContent=o.r;b.className='gt-btn-dup';
    if(JSON.stringify(o.v)===atual)b.style.borderColor='var(--accent,#6366f1)',b.style.color='var(--accent,#6366f1)';
    b.onclick=ev=>{ev.stopPropagation();_gtPub.generos=[...o.v];_gtPubRedesenha();};
    lg.appendChild(b);
  }
  cx.appendChild(lg);

  cx.appendChild(_gtPubTitulo('Interesses'));
  const ci=_gtPubLinha();
  for(const i of _gtPub.interesses)
    ci.appendChild(_gtPubChip(i.name||i.id,()=>{_gtPub.interesses=_gtPub.interesses.filter(x=>x.id!==i.id);_gtPubRedesenha();}));
  if(!_gtPub.interesses.length)ci.appendChild(_gtPubAjuda('Nenhum interesse — a Meta escolhe sozinha.'));
  cx.appendChild(ci);
  cx.appendChild(_gtPubBusca('Buscar interesse…',_gtPubBuscarInteresses,
    i=>{if(!_gtPub.interesses.some(x=>x.id===String(i.id)))_gtPub.interesses.push({id:String(i.id),name:i.name});},
    i=>i.name));

  // A FAIXA DE SUGESTÕES DA IA — depois da busca, de propósito.
  //
  // O robô semanal já escolhe interesses bons para cada objetivo, mas eles só
  // apareciam na Fábrica, na hora de CRIAR campanha. Aqui, onde se mexe em
  // campanha que já está rodando, a pessoa ficava digitando de memória.
  //
  // VEM DEPOIS da busca porque é atalho, não caminho principal: quem já sabe o
  // que quer digita; quem não sabe olha o que a IA achou. Antes da busca, a
  // faixa empurraria o campo pra baixo em toda abertura do editor.
  const sug=_gtPubFaixaSugestoes();
  if(sug)cx.appendChild(sug);
  return cx;
}

// A faixa de sugestões. O MIOLO mora em sugestoes-de-interesse.js — aqui só se
// entrega o `document`, os ajudantes de desenho desta janela e o que fazer no
// clique.
//
// POR QUE NÃO MORA AQUI: este arquivo é `<script setup>`, então nada declarado
// nele é importável, e a faixa não teria como ser testada nem aberta num
// navegador sozinha. Conferir exigiria subir a tela, logar e achar uma campanha
// — na prática, ninguém confere.
function _gtPubFaixaSugestoes(){
  return montarFaixaDeSugestoes({
    doc:document,
    sugeridos:_gtPubSugeridos,
    objetivo:_gtPubObjetivo,
    jaEscolhidos:_gtPub.interesses,
    quando:_gtPubSugeridoEm,
    ajuda:_gtPubAjuda,
    linha:_gtPubLinha,
    tamanho:_gtPubTamanho,
    // Mesma forma que a busca da Meta grava ({id,name}) — se divergir, o
    // salvamento monta o targeting com um objeto que a Meta não entende.
    aoEscolher:(i)=>{
      if(!_gtPub.interesses.some(x=>x.id===i.id))_gtPub.interesses.push({id:i.id,name:i.nome});
      _gtPubRedesenha();
    },
  });
}

// Tamanho de público em português. É a MESMA regra do robô (tamanhoLegivel em
// coletor/lib/interesses.mjs) e da Fábrica (formatarPublico em painel-subir.vue),
// repetida porque nenhum dos dois é importável daqui. Se um dia divergirem, o
// mesmo interesse mostraria número diferente em duas telas.
function _gtPubTamanho(n){
  if(typeof n!=='number'||!Number.isFinite(n))return '';
  if(n>=999_500_000)return (n/1_000_000_000).toLocaleString('pt-BR',{maximumFractionDigits:2})+' bi';
  if(n>=999_500)return (n/1_000_000).toLocaleString('pt-BR',{maximumFractionDigits:1})+' mi';
  if(n>=1_000)return Math.round(n/1000).toLocaleString('pt-BR')+' mil';
  return n.toLocaleString('pt-BR');
}

// Públicos personalizados (remarketing e semelhantes), incluindo e excluindo.
// Lista que não carrega NÃO derruba o editor: avisa só nesta seção.
//
// O QUE JÁ ESTÁ NO CONJUNTO APARECE SEMPRE, mesmo sem a lista da conta. Antes
// os quadradinhos saíam só de percorrer a lista da conta: se ela não
// carregasse, o dono não via que existe uma inclusão ou uma exclusão de
// público valendo — e ela ia junto no salvamento assim mesmo.
function _gtPubSecaoPublicos(){
  const cx=document.createElement('div');
  cx.appendChild(_gtPubTitulo('Públicos salvos na conta'));

  const nomeDoSalvo=(id)=>{
    const achado=(_gtPubSalvos||[]).find(x=>String(x.id)===id);
    return (achado&&achado.name)||null;
  };
  const emUso=_gtPubLinha();
  const chipEmUso=(item,marca,tirar)=>{
    const id=String(item.id);
    return _gtPubChip(marca+' '+(item.name||nomeDoSalvo(id)||('público salvo ('+id+')')),()=>{tirar(id);_gtPubRedesenha();});
  };
  for(const a of (_gtPub.incluir||[]))
    emUso.appendChild(chipEmUso(a,'✓',id=>{_gtPub.incluir=_gtPub.incluir.filter(x=>String(x.id)!==id);}));
  for(const a of (_gtPub.excluir||[]))
    emUso.appendChild(chipEmUso(a,'∅',id=>{_gtPub.excluir=_gtPub.excluir.filter(x=>String(x.id)!==id);}));
  if(emUso.childNodes.length){
    cx.appendChild(_gtPubAjuda('Valendo neste conjunto agora — ✓ é quem VÊ, ∅ é quem NÃO vê. Clique no × para tirar.'));
    cx.appendChild(emUso);
  }

  if(_gtPubSalvos===null){
    cx.appendChild(_gtPubAjuda('Não consegui carregar a lista de públicos salvos desta conta, então não dá para acrescentar nenhum agora. O resto do editor funciona normalmente'+(emUso.childNodes.length?' — e o que já está valendo aparece aí em cima.':'.')));
    return cx;
  }
  if(!_gtPubSalvos.length){
    cx.appendChild(_gtPubAjuda('Esta conta não tem público salvo. Crie no Gerenciador da Meta — criar por aqui está bloqueado pela Meta nesta conta.'));
    return cx;
  }
  cx.appendChild(_gtPubAjuda('Clique uma vez para INCLUIR (verde), duas para EXCLUIR (vermelho), três para tirar.'));
  const lp=_gtPubLinha();
  for(const a of _gtPubSalvos){
    const incluido=_gtPub.incluir.some(x=>x.id===String(a.id));
    const excluido=_gtPub.excluir.some(x=>x.id===String(a.id));
    const b=document.createElement('button');b.textContent=a.name;b.className='gt-btn-dup';
    if(incluido)b.style.borderColor='var(--green)',b.style.color='var(--green)';
    if(excluido)b.style.borderColor='var(--red)',b.style.color='var(--red)',b.textContent='∅ '+a.name;
    b.onclick=ev=>{
      ev.stopPropagation();
      const id=String(a.id),nome=a.name;
      _gtPub.incluir=_gtPub.incluir.filter(x=>x.id!==id);
      _gtPub.excluir=_gtPub.excluir.filter(x=>x.id!==id);
      if(!incluido&&!excluido)_gtPub.incluir.push({id,name:nome});
      else if(incluido)_gtPub.excluir.push({id,name:nome});
      _gtPubRedesenha();
    };
    lp.appendChild(b);
  }
  cx.appendChild(lp);
  return cx;
}

// Advantage+ e "usar um público pronto do Estúdio".
function _gtPubSecaoExtras(){
  const cx=document.createElement('div');
  cx.appendChild(_gtPubTitulo('Advantage+'));
  cx.appendChild(_gtPubAjuda('Ligado, a Meta escolhe o público sozinha. Ligado NÃO convive com idade, gênero e interesses definidos à mão — a Meta recusa a combinação.'));
  const lb=document.createElement('label');
  lb.style.cssText='display:flex;align-items:center;gap:8px;font-size:calc(12px*var(--gt-fs,1.3));cursor:pointer;';
  const ck=document.createElement('input');ck.type='checkbox';ck.checked=!!_gtPub.advantagePlus;
  ck.onchange=()=>{_gtPub.advantagePlus=ck.checked;_gtPubRedesenha();};
  lb.appendChild(ck);const s=document.createElement('span');s.textContent='Deixar a Meta escolher o público (Advantage+)';lb.appendChild(s);
  cx.appendChild(lb);

  if(_gtPubPresets===null){
    cx.appendChild(_gtPubTitulo('Usar um público pronto'));
    cx.appendChild(_gtPubAjuda('Não consegui carregar os públicos montados no Estúdio.'));
    return cx;
  }
  if(!_gtPubPresets.length)return cx;
  cx.appendChild(_gtPubTitulo('Usar um público pronto do Estúdio'));
  cx.appendChild(_gtPubAjuda('Escolher um preenche o editor inteiro. Você ainda vê o que mudou e confirma antes de salvar.'));
  const sel=document.createElement('select');
  sel.style.cssText='width:100%;padding:8px;border-radius:7px;border:1px solid var(--border,#ddd);background:var(--surface,#fff);color:var(--text,#111);font-size:calc(12px*var(--gt-fs,1.3));';
  sel.innerHTML='<option value="">— escolher —</option>'+_gtPubPresets.map(p=>'<option value="'+_gtEsc(p.id)+'">'+_gtEsc(p.nome)+'</option>').join('');
  sel.onchange=()=>{
    const p=_gtPubPresets.find(x=>String(x.id)===sel.value);
    if(!p)return;
    // Preenche, NÃO salva. O preset guarda a mesma forma que o Estúdio usa.
    _gtPub.cidades=((p.geo&&p.geo.cities)||[]).map(c=>({key:String(c.key),nome:c.nome||String(c.key),raio:Number(c.radius)||0,unidade:c.distance_unit||'kilometer'}));
    _gtPub.excluidas=((p.geo&&p.geo.excluded)||[]).map(e=>({key:String(e.key),nome:e.nome||String(e.key),tipo:e.type==='region'?'regiao':'cidade'}));
    _gtPub.idadeMin=p.idade_min==null?18:Number(p.idade_min);
    _gtPub.idadeMax=p.idade_max==null?65:Number(p.idade_max);
    _gtPub.generos=(p.generos||[]).map(Number);
    _gtPub.interesses=(p.interesses||[]).map(i=>({id:String(i.id),name:i.name}));
    _gtPub.incluir=(p.custom_audiences||[]).map(a=>({id:String(a.id),name:a.name}));
    // O preset preenche o editor INTEIRO, como a ajuda acima promete. Deixar
    // uma exclusão de público do conjunto antigo sobrando estreitaria em
    // silêncio o público pronto que o dono acabou de escolher.
    _gtPub.excluir=[];
    // Público definido à mão não convive com Advantage+ — mesma regra do publico.mjs.
    _gtPub.advantagePlus=false;
    _gtPubRedesenha();
  };
  cx.appendChild(sel);
  return cx;
}

// A janela. Resolve com o Publico editado, ou null se cancelou.
// NÃO estende o _gtConfirm: aquele é o portão sim/não de TODAS as ações da
// tela, marcado no código como preservado verbatim, e não tem formulário.
// `rotuloDoBotao` existe porque o MESMO editor serve a dois momentos: ajustar o
// público de um conjunto que já roda (aí "Ver o que mudou" é exato) e escolher o
// público de uma campanha que ainda não existe — onde nada mudou, porque não
// havia nada antes. Visto ao vivo em 03/08/2026.
function _gtPublicoModal(nomeConjunto,rotuloDoBotao){
  return new Promise(resolve=>{
    const ov=_gtPubOverlay();ov.onclick=null;
    const box=document.createElement('div');
    box.style.cssText='background:var(--surface,#fff);color:var(--text,#111);border-radius:14px;max-width:560px;width:100%;max-height:86vh;overflow-y:auto;padding:24px;box-shadow:0 24px 60px rgba(0,0,0,.45);font-family:var(--fonte-principal);';
    const corpo=document.createElement('div');
    // ESPAÇO PARA A BARRA. Ela é `sticky` — o conteúdo passa POR BAIXO dela, e
    // sem esta folga a última linha da tela fica escondida atrás dos botões.
    // Visto ao vivo em 04/08/2026: a linha "Onde: Americana · Campinas · …" do
    // público escolhido nascia cortada pela metade.
    corpo.style.paddingBottom='18px';
    const barra=document.createElement('div');
    // A borda em cima é o que faz a barra parecer barra. Sem ela, os botões
    // flutuam sobre o texto que passa por baixo e o encontro fica sujo.
    barra.style.cssText='display:flex;gap:10px;justify-content:flex-end;margin-top:20px;position:sticky;bottom:0;'
      +'background:var(--surface,#fff);padding:12px 0 2px;border-top:1px solid var(--border,#e5e5e5);';
    const bCancelar=document.createElement('button');bCancelar.textContent='Cancelar';
    bCancelar.style.cssText='padding:9px 16px;border-radius:8px;border:1px solid var(--border,#ddd);background:none;color:var(--text,#111);font-weight:600;font-size:calc(13px*var(--gt-fs,1.3));cursor:pointer;';
    bCancelar.onclick=()=>{_gtPubFechar();resolve(null);};
    const bSalvar=document.createElement('button');bSalvar.textContent=rotuloDoBotao||'Ver o que mudou';
    bSalvar.onclick=()=>{_gtPubFechar();resolve(_gtPub);};
    barra.appendChild(bCancelar);barra.appendChild(bSalvar);

    // Redesenha o corpo e reavalia os avisos. É aqui que o botão de continuar
    // é liberado ou travado — sem isso, o dono só descobriria o conflito de
    // Advantage+ tomando erro da Meta.
    _gtPubRedesenha=()=>{
      // O redesenho troca TODO o conteúdo de `corpo` — sem isso, o dono
      // digitando a idade (por exemplo) via cada onchange perdia o foco do
      // campo e a caixa voltava pro topo, porque `box` (que rola, não `corpo`)
      // ficava intacta mas seu conteúdo era substituído por elementos novos.
      // Guarda posição da rolagem e QUAL controle estava focado (pelo
      // data-gtpub-id que os campos relevantes carregam) para devolver os
      // dois depois de montar tudo de novo.
      const scrollAntes=box.scrollTop;
      const focoAntes=document.activeElement;
      const focoId=(focoAntes&&corpo.contains(focoAntes)&&focoAntes.dataset)?focoAntes.dataset.gtpubId:null;
      const cursorAntes=(focoId&&typeof focoAntes.selectionStart==='number')?focoAntes.selectionStart:null;
      corpo.innerHTML='';
      const tit=document.createElement('div');
      tit.style.cssText='font-size:calc(16px*var(--gt-fs,1.3));font-weight:800;margin-bottom:3px;';
      tit.textContent='Quem vê estes anúncios';
      const sub=document.createElement('div');
      sub.style.cssText='font-size:calc(12px*var(--gt-fs,1.3));color:var(--muted,#666);margin-bottom:6px;';
      sub.textContent='Conjunto: '+nomeConjunto;
      corpo.appendChild(tit);corpo.appendChild(sub);
      corpo.appendChild(_gtPubSecaoPublicosSalvos());
      corpo.appendChild(_gtPubSecaoSugestao());
      corpo.appendChild(_gtPubSecaoLugar());
      corpo.appendChild(_gtPubSecaoPessoas());
      corpo.appendChild(_gtPubSecaoPublicos());
      // ONDE O ANÚNCIO APARECE. Depois de quem vê e antes do Advantage+: é a
      // pergunta "onde", que só faz sentido depois de "quem". O miolo mora em
      // posicionamentos.js — aqui só entra o document, os ajudantes de desenho
      // e o que fazer quando muda.
      const secPos=montarSecaoPosicionamentos({
        doc:document,
        pos:_gtPub.posicionamentos,
        titulo:_gtPubTitulo,
        ajuda:_gtPubAjuda,
        linha:_gtPubLinha,
        aoMudar:(novo)=>{_gtPub.posicionamentos=novo;_gtPubRedesenha();},
      });
      if(secPos)corpo.appendChild(secPos);
      corpo.appendChild(_gtPubSecaoExtras());

      const { ajustes }=montarTargeting(_gtPub,{});
      const avisos=avisosDe(_gtPubAntes,_gtPub,{ativo:_gtPubAtivo,ajustes});
      const trava=avisos.find(a=>a.bloqueia);
      for(const a of avisos.filter(x=>x.bloqueia)){
        const d=document.createElement('div');
        d.style.cssText='margin-top:14px;background:rgba(220,38,38,.10);border:1px solid rgba(220,38,38,.35);border-radius:8px;padding:11px 13px;font-size:calc(12px*var(--gt-fs,1.3));line-height:1.5;';
        d.innerHTML=a.texto;
        corpo.appendChild(d);
      }
      bSalvar.disabled=!!trava;
      bSalvar.style.cssText='padding:9px 18px;border-radius:8px;border:none;background:var(--accent,#6366f1);color:#fff;font-weight:700;font-size:calc(13px*var(--gt-fs,1.3));cursor:'+(trava?'not-allowed':'pointer')+';opacity:'+(trava?'.5':'1')+';';

      // Devolve a rolagem e o foco depois do corpo inteiro estar montado —
      // nunca antes: focar/setar scrollTop num controle que ainda não existe
      // no DOM novo não faz nada.
      box.scrollTop=scrollAntes;
      if(focoId){
        const novo=corpo.querySelector('[data-gtpub-id="'+focoId+'"]');
        if(novo){
          novo.focus();
          if(cursorAntes!=null&&typeof novo.setSelectionRange==='function'){
            try{novo.setSelectionRange(cursorAntes,cursorAntes);}catch(_){/* tipo do input não suporta seleção (ex.: number em alguns navegadores) — sem problema, o foco já voltou */}
          }
        }
      }
    };

    ov.innerHTML='';ov.style.display='flex';
    box.appendChild(corpo);box.appendChild(barra);ov.appendChild(box);
    _gtPubRedesenha();
  });
}

// AS SUGESTÕES DA MARCA DESTA CONTA.
//
// O laço é `fabrica_marcas.account_id` = a conta selecionada no Gestor
// (_gtCurAcc.id) — a mesma chave que a Fábrica usa. Conta sem marca cadastrada
// simplesmente não tem sugestão, e isso é normal: a Vessel tem, as outras não.
//
// NUNCA DERRUBA O EDITOR: quem chama trata a falha como "não carregou". Mudar
// uma cidade não pode depender de uma faixa de sugestão ter vindo.
async function _gtListarSugestoes(){
  const conta=_gtCurAcc&&_gtCurAcc.id;
  if(!conta)return null;
  const linhas=await sb('interesses_sugeridos?select=objetivo,itens,gerado_em,'
    +'fabrica_marcas!inner(account_id)&fabrica_marcas.account_id=eq.'+encodeURIComponent(conta));
  return Array.isArray(linhas)?linhas:null;
}


/* ═══ ASSISTENTE DE NOVA CAMPANHA (C3) ══════════════════════════════════════
   Cria campanha + conjunto + criativo + anúncio, tudo PAUSED.

   O DESENHO das quatro telas mora em assistente-campanha.js e as REGRAS em
   criar-campanha.js — aqui fica só o que precisa de rede e de estado da tela.
   O payload sai do MESMO montador que a Fábrica usa em produção; escrever um
   segundo fez a Meta recusar quatro vezes seguidas.

   Cada passo desta cadeia foi provado ao vivo antes desta tela existir
   (validar-criar-no-gestor.mjs: 24/24 nos quatro objetivos, e
   validar-envio-de-imagem.mjs: 4/4 no caminho da imagem). */
let _gtNovo=null;            // estado do formulário (forma de criar-campanha.js)
let _gtNovoPasso=0;
let _gtNovoObjetivos=[];     // linhas de fabrica_objetivos (a receita, vale p/ toda conta)
let _gtNovoPaginas=[];       // páginas do Facebook que o token pode usar, com o IG de cada
let _gtNovoNumerosWa=[];     // números de WhatsApp que a Meta JÁ aceitou nesta conta
let _gtNovoPublicacoes=[];   // publicações do perfil, para impulsionar
let _gtNovoCarregandoPubs=false;
let _gtNovoPubsDoPerfil='';  // de qual perfil a lista carregada é (trocar de página troca isto)
let _gtNovoErroPubs='';      // por que a lista não veio — a tela MOSTRA isto
let _gtNovoStories=[];       // stories ATIVOS: vivem 24h e somem
let _gtNovoBusca='';let _gtNovoTipoPub='todos';let _gtNovoOrdemPub='recentes';
let _gtNovoTextos=null;      // a evidência dos textos + a leitura da IA
// O <details> de "Mais opções" é lembrado AQUI e não no DOM: cada redesenho
// monta um <details> novo, e sem guardar isso ele fecharia sozinho no meio de
// quem estava escrevendo a saudação.
let _gtNovoMaisCampos=false;
let _gtNovoBuscandoTextos=false;
// ── RASCUNHO ────────────────────────────────────────────────────────────────
let _gtNovoRascunhoId=null;  // a linha em gt_campanhas_rascunho desta tentativa
let _gtNovoUltimoSalvo=null; // o estado como ele foi gravado da última vez
let _gtNovoTimerSalvar=null;
let _gtNovoHistorico=[];
let _gtNovoImagens=[];
let _gtNovoVideos=[];        // os vídeos que a conta já tem, com capa
let _gtNovoEnviando=false, _gtNovoCriando=false, _gtNovoFaltas=false;

function _gtNovoFechar(){
  // O HISTÓRICO USA A MESMA MOLDURA. Sem esta saída, fechar a lista gravaria um
  // rascunho de uma campanha que ninguém começou — e o histórico encheria de
  // linhas vazias criadas por quem só foi olhar.
  if(_gtHistAberto){_gtHistFechar();return;}
  // FECHAR SALVA NA HORA, sem esperar o atraso: fechar a janela é exatamente o
  // momento em que o trabalho se perderia.
  if(_gtNovoTimerSalvar){clearTimeout(_gtNovoTimerSalvar);_gtNovoTimerSalvar=null;}
  _gtNovoSalvarRascunho();
  const ov=document.getElementById('gt-novo-ov'),md=document.getElementById('gt-novo-modal');
  if(ov)ov.style.display='none';
  if(md)md.style.display='none';
  document.removeEventListener('keydown',_gtNovoEsc);
  _gtNovoCriando=false;
}
function _gtNovoEsc(e){
  // Enquanto está criando, ESC não fecha: sair no meio deixaria a pessoa sem
  // saber o que já foi criado na conta.
  if(e.key==='Escape'&&!_gtNovoCriando)_gtNovoFechar();
}

// `op.retomar` é a linha escolhida NO HISTÓRICO. Vindo de lá, não se pergunta
// "quer continuar?": a pessoa já respondeu essa pergunta ao clicar em Continuar.
async function _gtNovoAbrir(op){
  if(!_gtCurAcc){await _gtConfirm('Sem conta selecionada','Escolha uma conta de anúncios primeiro.',{okOnly:true});return;}
  _gtNovo=estadoInicial();_gtNovoPasso=0;_gtNovoFaltas=false;_gtNovoCriando=false;_gtNovoEnviando=false;
  _gtNovoRascunhoId=null;_gtNovoUltimoSalvo=null;
  _gtNovoBusca='';_gtNovoTipoPub='todos';_gtNovoOrdemPub='recentes';_gtNovoStories=[];
  _gtNovoTextos=null;_gtNovoBuscandoTextos=false;_gtNovoMaisCampos=false;
  _gtNovoHistorico=await _gtNovoLerHistorico();

  // RETOMAR DE ONDE PAROU. Perguntar só quando há o que retomar: oferecer
  // sempre viraria um clique a mais em toda campanha nova.
  const escolhido=op&&op.retomar;
  if(escolhido){
    _gtNovo=Object.assign(estadoInicial(),escolhido.estado||{});
    _gtNovoPasso=Number(escolhido.passo)||0;
    _gtNovoRascunhoId=escolhido.id;
    _gtNovoUltimoSalvo=JSON.parse(JSON.stringify(_gtNovo));
  }
  const retomar=escolhido?null:rascunhoParaRetomar(_gtNovoHistorico,new Date());
  if(retomar){
    const l=montarHistorico([retomar],new Date())[0];
    const continuar=await _gtConfirm('Você tem uma campanha começada',
      '<b>'+_gtEsc(l.nome)+'</b>'+(l.tipo?' — '+_gtEsc(l.tipo):'')+'<br>'
      +_gtEsc(l.quando)+', '+_gtEsc(l.ondeParou)+'.<br><br>'
      +'Quer continuar de onde parou? Se preferir começar do zero, o rascunho continua guardado no histórico.',
      {okLabel:'Continuar'});
    if(continuar){
      _gtNovo=Object.assign(estadoInicial(),retomar.estado||{});
      _gtNovoPasso=Number(retomar.passo)||0;
      _gtNovoRascunhoId=retomar.id;
      _gtNovoUltimoSalvo=JSON.parse(JSON.stringify(_gtNovo));
    }
  }
  const ov=document.getElementById('gt-novo-ov'),md=document.getElementById('gt-novo-modal');
  if(!ov||!md)return;
  ov.style.display='block';md.style.display='flex';
  document.addEventListener('keydown',_gtNovoEsc);
  const tt=document.getElementById('gt-novo-titulo');
  if(tt)tt.textContent='Nova campanha · '+((_gtCurAcc&&(_gtCurAcc.display_name||_gtCurAcc.name))||'');
  _gtNovoRedesenhar('<div class="gt-novo-carregando">Carregando os objetivos e as imagens da conta…</div>');

  // ZERA ANTES DE CARREGAR: uma falha de rede não pode deixar de pé a lista da
  // ABERTURA ANTERIOR, que pode ser de outra conta.
  _gtNovoObjetivos=[];_gtNovoImagens=[];_gtNovoVideos=[];_gtNovoPaginas=[];_gtNovoNumerosWa=[];
  // OS CONJUNTOS QUE JÁ EXISTEM servem a DUAS perguntas de uma vez: quais
  // combinações esta conta já rodou (o selo "já usado aqui") e quais números de
  // WhatsApp a Meta já aceitou. Uma chamada, dois usos.
  const [pags,imgs,vids,sugerido,conjuntos]=await Promise.all([
    _gtNovoBuscarPaginas(),
    _gtNovoBuscarImagens(),
    _gtNovoBuscarVideos(),
    _gtNovoSugerirIdentidade(),
    _gtNovoBuscarConjuntos(),
  ]);
  _gtNovoPaginas=pags;_gtNovoImagens=imgs;_gtNovoVideos=vids;
  _gtNovoNumerosWa=numerosJaUsados(conjuntos);
  // O CATÁLOGO É FIXO (mora no código, não no banco): a lista do que a conta já
  // usou nunca ensina nada novo, e conta nova começaria vazia. O que ela já
  // rodou entra como MARCA, que é a informação que de fato ajuda a escolher.
  _gtNovoObjetivos=marcarUsados(CATALOGO,conjuntos);

  // SUGERE, MAS NÃO IMPÕE. Se esta conta tem marca cadastrada na Fábrica, a
  // página, o Instagram e o WhatsApp dela já vêm preenchidos — é o caso comum e
  // poupa três escolhas. Tudo continua trocável na tela: foi exatamente amarrar
  // isto ao cadastro que quebrou o botão em conta sem loja registrada.
  // A SUGESTÃO DO CADASTRO só entra em campanha começando do zero. Num rascunho
  // retomado ela sobrescreveria a página que a pessoa já tinha escolhido.
  if(sugerido&&!_gtNovoRascunhoId)Object.assign(_gtNovo,sugerido);
  _gtNovoRedesenhar();
}

// AS PÁGINAS QUE O TOKEN PODE USAR, com o Instagram de cada uma.
//
// `/me/accounts` devolve os dois na MESMA resposta (medido em 03/08/2026: 10
// páginas, todas com CREATE_CONTENT). Por isso escolher a página já resolve o
// perfil, e ninguém precisa saber de cor o número de 17 dígitos do Instagram.
//
// `tasks` diz o que o token pode fazer NA PÁGINA. Sem CREATE_CONTENT ali, o
// anúncio não sai nem com a permissão do app aprovada — então essas não entram
// na lista, em vez de aparecerem e falharem no fim.
async function _gtNovoBuscarPaginas(){
  try{
    const r=await metaFetch('/me/accounts',{
      fields:'id,name,tasks,instagram_business_account{id,username}',limit:100,
    },_gtCurAcc.id);
    return ((r&&r.data)||[])
      .filter(p=>p&&p.id&&(p.tasks||[]).includes('CREATE_CONTENT'))
      .map(p=>({
        id:String(p.id),nome:p.name||String(p.id),
        igId:(p.instagram_business_account&&String(p.instagram_business_account.id))||'',
        igNome:(p.instagram_business_account&&p.instagram_business_account.username)||'',
      }))
      .sort((a,b)=>String(a.nome).localeCompare(String(b.nome),'pt-BR'));
  }catch(e){ return []; }
}

// ── SALVAR O RASCUNHO ───────────────────────────────────────────────────────
//
// Sozinho, atrasado, e só quando mudou. Atrasado (1,2 s) porque digitar o nome
// dispara uma mudança por letra; só quando mudou porque redesenhar a tela não é
// motivo para escrever no banco.
//
// FALHAR AQUI NÃO ATRAPALHA NADA. Rascunho é rede de segurança, não parte do
// caminho: se o banco recusar, a pessoa continua criando a campanha do mesmo
// jeito e no máximo perde a proteção contra fechar a aba.
function _gtNovoAgendarSalvar(){
  if(_gtNovoTimerSalvar)clearTimeout(_gtNovoTimerSalvar);
  _gtNovoTimerSalvar=setTimeout(()=>{_gtNovoSalvarRascunho();},1200);
}

async function _gtNovoSalvarRascunho(){
  try{
    if(!_gtNovo||!_gtCurAcc)return;
    if(!valeSalvar(_gtNovo))return;
    if(!rascunhoMudou(_gtNovoUltimoSalvo,_gtNovo))return;
    const sub=_gtNovoObjetivos.find(o=>o.id===_gtNovo.objetivo);
    const linha=linhaParaSalvar({
      estado:_gtNovo,passo:_gtNovoPasso,contaId:_gtCurAcc.id,
      tipoRotulo:(sub&&sub.rotulo)||'',
    });
    if(_gtNovoRascunhoId){
      const {error}=await sbClient.from('gt_campanhas_rascunho').update(linha).eq('id',_gtNovoRascunhoId);
      if(error)return;
    }else{
      const {data,error}=await sbClient.from('gt_campanhas_rascunho').insert(linha).select('id').single();
      if(error||!data)return;
      _gtNovoRascunhoId=data.id;
    }
    _gtNovoUltimoSalvo=JSON.parse(JSON.stringify(_gtNovo));
  }catch(e){ /* rede de segurança não pode virar obstáculo */ }
}

// O DESFECHO desta tentativa, guardado para o histórico. É o que responde,
// meses depois, "por que essa campanha não foi?".
async function _gtNovoFecharRascunho(status,resultado){
  try{
    if(!_gtNovoRascunhoId)return;
    await sbClient.from('gt_campanhas_rascunho')
      .update({status,resultado:resultado||null}).eq('id',_gtNovoRascunhoId);
  }catch(e){ /* idem */ }
}

// A TELA DO HISTÓRICO.
//
// Reaproveita a moldura do assistente (`#gt-novo-modal`) em vez de ganhar uma
// própria: é o mesmo assunto, e uma moldura nova seria CSS duplicado para
// parecer igual. A bandeira `_gtHistAberto` é o que separa os dois — sem ela,
// fechar o histórico gravaria um rascunho de uma campanha que ninguém começou.
let _gtHistAberto=false;

async function _gtHistAbrir(){
  const ov=document.getElementById('gt-novo-ov'),md=document.getElementById('gt-novo-modal');
  const corpo=document.getElementById('gt-novo-corpo'),rod=document.getElementById('gt-novo-rodape');
  const tt=document.getElementById('gt-novo-titulo');
  if(!ov||!md||!corpo)return;
  _gtHistAberto=true;
  if(tt)tt.textContent='Histórico · '+((_gtCurAcc&&(_gtCurAcc.display_name||_gtCurAcc.name))||'');
  if(rod)rod.innerHTML='';
  ov.style.display='block';md.style.display='flex';
  document.addEventListener('keydown',_gtNovoEsc);
  montarPainelHistorico(corpo,{carregando:true});
  await _gtHistDesenhar();
}

async function _gtHistDesenhar(){
  const corpo=document.getElementById('gt-novo-corpo');
  if(!corpo)return;
  let cruas=[],erro='';
  try{
    if(!_gtCurAcc)throw new Error('nenhuma conta selecionada');
    const {data,error}=await sbClient.from('gt_campanhas_rascunho')
      .select('id,nome,tipo,status,passo,estado,resultado,updated_at,created_at,criado_por')
      .eq('account_id',String(_gtCurAcc.id))
      .order('updated_at',{ascending:false}).limit(60);
    // O MOTIVO VAI PRA TELA. `catch` mudo aqui já custou meia hora de caça uma
    // vez nesta mesma tela (o buscador de publicações).
    if(error)throw new Error(error.message||'o banco recusou a leitura');
    cruas=data||[];
  }catch(e){ erro=String((e&&e.message)||e); }

  const {data:{user}}=await sbClient.auth.getUser().catch(()=>({data:{}}));
  const linhas=marcarQuemPodeApagar(montarHistorico(cruas,new Date()),cruas,user&&user.id);
  montarPainelHistorico(corpo,{
    linhas, erro,
    aoContinuar:async(id)=>{
      const row=cruas.find(r=>String(r.id)===String(id));
      if(!row)return;
      _gtHistFechar();
      await _gtNovoAbrir({retomar:row});
    },
    aoApagar:async(id)=>{
      const row=cruas.find(r=>String(r.id)===String(id));
      const ok=await _gtConfirm('Apagar do histórico?',
        '<b>'+_gtEsc((row&&row.nome)||'esta linha')+'</b><br><br>'
        +'Isso apaga só o registro aqui. Campanha que já foi criada na Meta CONTINUA lá — '
        +'apagar daqui não desfaz nada lá.',{okLabel:'Apagar'});
      if(!ok)return;
      const {error}=await sbClient.from('gt_campanhas_rascunho').delete().eq('id',id);
      if(error){adminToast('Não consegui apagar: '+(error.message||''),false);return;}
      // Se era o rascunho aberto no assistente, o id guardado ficou órfão —
      // e a próxima gravação recriaria a linha que a pessoa acabou de apagar.
      if(String(_gtNovoRascunhoId)===String(id))_gtNovoRascunhoId=null;
      await _gtHistDesenhar();
    },
  });
}

function _gtHistFechar(){
  _gtHistAberto=false;
  const ov=document.getElementById('gt-novo-ov'),md=document.getElementById('gt-novo-modal');
  if(ov)ov.style.display='none';
  if(md)md.style.display='none';
  document.removeEventListener('keydown',_gtNovoEsc);
}

// O HISTÓRICO DESTA CONTA — rascunhos e enviados, do time inteiro.
async function _gtNovoLerHistorico(){
  try{
    if(!_gtCurAcc)return [];
    const {data,error}=await sbClient.from('gt_campanhas_rascunho')
      .select('id,nome,tipo,status,passo,estado,resultado,updated_at,created_at')
      .eq('account_id',String(_gtCurAcc.id))
      .order('updated_at',{ascending:false}).limit(40);
    if(error)return [];
    return data||[];
  }catch(e){ return []; }
}

// AS PUBLICAÇÕES DO PERFIL, para impulsionar.
//
// Vêm de `/{ig-user-id}/media` — medido em 03/08/2026: devolve id, legenda,
// tipo, miniatura e data. O `id` daqui é EXATAMENTE o
// `source_instagram_media_id` que o criativo pede, então não há tradução.
//
// Carrega uma vez por perfil: trocar de página no passo 2 troca o perfil, e a
// lista velha seria de outra marca.
async function _gtNovoTalvezCarregarPublicacoes(){
  const sub=_gtNovoObjetivos.find(o=>o.id===_gtNovo.objetivo);
  if(!usaPublicacao(sub))return;
  if(_gtNovoPasso!==PASSOS.length-1)return;
  const perfil=String(_gtNovo.igId||'');
  if(!perfil){_gtNovoPublicacoes=[];_gtNovoPubsDoPerfil='';return;}
  if(_gtNovoPubsDoPerfil===perfil||_gtNovoCarregandoPubs)return;

  _gtNovoCarregandoPubs=true;_gtNovoPublicacoes=[];_gtNovoErroPubs='';_gtNovoRedesenhar();
  try{
    // O HISTÓRICO INTEIRO, com o detalhe que a Meta dá de graça na própria
    // lista: tipo, curtidas e comentários. Uma chamada por publicação para
    // buscar isso seria 12 idas para responder o que já veio.
    //
    // STORIES vêm junto, de outro endereço: eles não aparecem em /media.
    // Falhar ali não derruba nada — a lista vazia é o caso normal.
    const [r,st]=await Promise.all([
      metaFetch('/'+perfil+'/media',
        {fields:'id,caption,media_type,media_product_type,thumbnail_url,media_url,permalink,timestamp,like_count,comments_count',limit:50},_gtCurAcc.id),
      metaFetch('/'+perfil+'/stories',
        {fields:'id,media_type,media_product_type,thumbnail_url,media_url,permalink,timestamp'},_gtCurAcc.id).catch(()=>null),
    ]);
    _gtNovoStories=lerPublicacoes((st&&st.data)||[]);
    // Os stories entram NA MESMA grade, com o selo "Story" — são impulsionáveis
    // do mesmo jeito, e separá-los em duas listas faria procurar duas vezes.
    _gtNovoPublicacoes=[..._gtNovoStories,...lerPublicacoes((r&&r.data)||[])];
    _gtNovoPubsDoPerfil=perfil;
  }catch(e){
    // O ERRO VAI PARA A TELA, e não some num catch mudo.
    //
    // Foi assim que eu perdi meia hora: a tela dizia "não consegui carregar as
    // publicações" e eu não tinha como saber por quê — nem eu, nem o dono. Um
    // catch que engole o motivo é a mesma doença de truncar a mensagem da Meta,
    // e eu já sabia disso.
    _gtNovoPublicacoes=[];
    _gtNovoErroPubs=String((e&&e.message)||e);
  }
  finally{ _gtNovoCarregandoPubs=false;_gtNovoRedesenhar(); }
}

// OS TEXTOS QUE JÁ RODARAM NESTA CONTA, com o custo real de cada um.
//
// PAGINADO de propósito, e com `date_preset:'maximum'`: a primeira medição usou
// 90 dias e achou 3 textos com resultado — parecia que não havia dado. Com tudo
// o que a conta já rodou são 81 textos, 19 deles com resultado suficiente. O
// dado estava lá; a janela é que era curta.
//
// (E `time_range` com um ano voltou VAZIO. O atalho `maximum` funciona; o
// intervalo escrito à mão, não. Descoberto medindo.)
async function _gtNovoBuscarTextos(){
  if(_gtNovoBuscandoTextos)return;
  _gtNovoBuscandoTextos=true;_gtNovoRedesenhar();
  try{
    const act=_gtCleanAct(_gtCurAcc.ad_account_id), conta=_gtCurAcc.id;
    const paginar=async(caminho,params,voltas)=>{
      let saida=[],depois=null,v=0;
      do{
        const r=await metaFetch(caminho,{...params,...(depois?{after:depois}:{})},conta);
        saida=saida.concat((r&&r.data)||[]);
        depois=((r&&r.data)||[]).length&&r.paging&&r.paging.cursors?r.paging.cursors.after:null;
      }while(depois&&++v<voltas);
      return saida;
    };
    const [ads,ins]=await Promise.all([
      paginar('/'+act+'/ads',{fields:'id,creative{object_story_spec,body}',limit:200},5),
      paginar('/'+act+'/insights',{level:'ad',fields:'ad_id,spend,actions,campaign_name',date_preset:'maximum',limit:500},5),
    ]);
    const rotulo=escolherAcao(ins);
    const contar=contadorDe(rotulo);
    const porAd={};
    for(const l of ins)if(l&&l.ad_id)porAd[String(l.ad_id)]=l;
    const s=montarSugestaoDeTexto(agruparPorTexto(ads,porAd,contar));
    _gtNovoTextos={...s,contando:rotulo};
    _gtNovoRedesenhar();
    if(s.temAlgo)await _gtNovoLeituraDeTexto(s,rotulo);
  }catch(e){
    _gtNovoTextos={temAlgo:false,motivoVazio:'Não consegui ler os textos: '+String((e&&e.message)||e)};
  }finally{
    _gtNovoBuscandoTextos=false;_gtNovoRedesenhar();
  }
}

// A LEITURA E AS SUGESTÕES DA IA. A evidência já está na tela antes dela — se a
// IA falhar, os textos reais com o custo continuam ali.
async function _gtNovoLeituraDeTexto(evidencia,rotulo){
  try{
    _gtNovoTextos={..._gtNovoTextos,pensando:true};_gtNovoRedesenhar();
    const {data:{session}}=await sbClient.auth.getSession();
    if(!session)return;
    const sub=_gtNovoObjetivos.find(o=>o.id===_gtNovo.objetivo);
    const enxuto=(x)=>({texto:String(x.texto).slice(0,300),custo:Number(x.custo.toFixed(2)),resultados:x.resultados});
    const r=await fetch(SUPABASE_URL+'/functions/v1/sugerir-publico-ia',{
      method:'POST',
      headers:{'Authorization':'Bearer '+session.access_token,'apikey':SUPABASE_ANON_KEY,'Content-Type':'application/json'},
      body:JSON.stringify({
        modo:'texto',
        marca:(_gtCurAcc&&(_gtCurAcc.display_name||_gtCurAcc.name))||'',
        // QUEM a marca atende. Sem isto a IA tira a idade dos numeros da conta,
        // que dizem quem CLICOU -- nao para quem a marca quer vender.
        persona:limparPersona((_gtCurAcc&&_gtCurAcc.persona)||''),
        objetivo:(sub&&sub.rotulo)||'',
        evidencia:{
          contando:rotulo,
          melhores:evidencia.melhores.map(enxuto),
          piores:evidencia.piores.map(enxuto),
          // AS VAGAS VÃO SEPARADAS, e o prompt sabe o que fazer com elas: são o
          // texto mais barato da conta e não servem de modelo para vender.
          vagas:(evidencia.vagas||[]).slice(0,4).map(enxuto),
          diferenca:evidencia.diferenca,
        },
      }),
    });
    const d=await r.json().catch(()=>({}));
    if(!r.ok||!d.ok){
      _gtNovoTextos={..._gtNovoTextos,pensando:false,
        erro:(d&&(d.comoResolver||d.detalhe||d.error))||('a função respondeu '+r.status)};
      return;
    }
    _gtNovoTextos={..._gtNovoTextos,pensando:false,leitura:d.leitura||'',cuidado:d.cuidado||'',sugestoes:d.sugestoes||[]};
  }catch(e){
    _gtNovoTextos={..._gtNovoTextos,pensando:false,erro:String((e&&e.message)||e)};
  }finally{ _gtNovoRedesenhar(); }
}

// OS VÍDEOS QUE A CONTA JÁ TEM.
//
// `picture` é a CAPA que a Meta já gerou — e capa é obrigatória no criativo de
// vídeo (medido num anúncio real: `video_data.image_url`). Vídeo sem capa entra
// na lista assim mesmo, marcado: escondê-lo faria parecer que ele não existe,
// e a tela avisa na hora de escolher.
async function _gtNovoBuscarVideos(){
  try{
    const r=await metaFetch('/'+_gtCleanAct(_gtCurAcc.ad_account_id)+'/advideos',
      {fields:'id,title,picture,created_time',limit:12},_gtCurAcc.id);
    return ((r&&r.data)||[]).filter(v=>v&&v.id).map(v=>({
      id:String(v.id),titulo:v.title||'',capa:v.picture||'',data:v.created_time||'',
    }));
  }catch(e){ return []; }
}

// OS NÚMEROS DE WHATSAPP QUE A META JÁ ACEITOU NESTA CONTA.
//
// Não existe endpoint que liste os números permitidos — descoberto do jeito
// caro, tomando "This WhatsApp phone number is not linked to your account" de
// um número inventado (03/08/2026). O que existe é a prova pelo uso: todo
// conjunto que já roda carrega no `promoted_object` o par página + número que
// a Meta aceitou. Falhar aqui não impede nada: o campo continua livre.
async function _gtNovoBuscarConjuntos(){
  try{
    const r=await metaFetch('/'+_gtCleanAct(_gtCurAcc.ad_account_id)+'/adsets',
      {fields:'promoted_object,optimization_goal,destination_type,campaign{objective}',limit:300},_gtCurAcc.id);
    return (r&&r.data)||[];
  }catch(e){ return []; }
}

// O CADASTRO DA FÁBRICA VIRA SUGESTÃO, e nada mais. Falhar aqui não atrapalha:
// devolve nada e a pessoa escolhe na mão, que é o caminho normal de quem não
// tem cadastro.
async function _gtNovoSugerirIdentidade(){
  try{
    const { lojas }=await carregarMarcasELojas((caminho)=>sb(caminho.replace(/^\//,'')));
    const loja=(lojas||[]).find(l=>l.ativo&&l.marca&&String(l.marca.accountId)===String(_gtCurAcc.id));
    if(!loja||!loja.marca||!loja.marca.pageId)return null;
    return {
      pageId:String(loja.marca.pageId),
      igId:loja.marca.igId?String(loja.marca.igId):'',
      whatsapp:loja.whatsapp||'',
      // As cidades da loja também são só ponto de partida — o editor de público
      // abre com elas e a pessoa tira ou põe o que quiser.
      _cidadesSugeridas:loja.geoCities||[],
    };
  }catch(e){ return null; }
}

// As imagens que a conta que está NA TELA já tem. Falhar aqui NÃO impede de
// criar: dá pra enviar uma nova, e uma lista vazia é melhor que uma janela que
// não abre.
async function _gtNovoBuscarImagens(){
  try{
    const r=await metaFetch('/'+_gtCleanAct(_gtCurAcc.ad_account_id)+'/adimages',{fields:'hash,name,permalink_url',limit:12},_gtCurAcc.id);
    return ((r&&r.data)||[]).filter(i=>i&&i.hash).map(i=>({hash:i.hash,nome:i.name,url:i.permalink_url||''}));
  }catch(e){ return []; }
}
const _gtCleanAct=(a)=>String(a||'').startsWith('act_')?String(a):('act_'+String(a||''));

function _gtNovoRedesenhar(htmlDireto){
  const corpo=document.getElementById('gt-novo-corpo'),rodape=document.getElementById('gt-novo-rodape');
  if(!corpo||!rodape)return;
  corpo.innerHTML='';rodape.innerHTML='';
  if(htmlDireto){corpo.innerHTML=htmlDireto;return;}
  const feito=montarAssistente({
    doc:document,estado:_gtNovo,passo:_gtNovoPasso,
    objetivos:_gtNovoObjetivos,imagens:_gtNovoImagens,videos:_gtNovoVideos,paginas:_gtNovoPaginas,
    // A LINHA DO OBJETIVO vai junto porque o desenho depende dela: é ela que diz
    // se o número de WhatsApp é pedido neste passo.
    objetivoRow:_gtNovoObjetivos.find(o=>o.id===_gtNovo.objetivo)||null,
    numerosWa:_gtNovoNumerosWa,
    // AS PUBLICAÇÕES E O ESTADO DELAS. Sem estas três linhas o desenho recebe
    // `undefined`, cai no ramo de lista vazia e diz que não há publicação —
    // enquanto a lista carregada está aqui do lado, cheia. Foi o que aconteceu.
    publicacoes:_gtNovoPublicacoes,
    carregandoPublicacoes:_gtNovoCarregandoPubs,
    erroPublicacoes:_gtNovoErroPubs,
    stories:_gtNovoStories,mostrarAvisoStories:true,
    textos:_gtNovoTextos,buscandoTextos:_gtNovoBuscandoTextos,aoBuscarTextos:_gtNovoBuscarTextos,
    buscaPublicacao:_gtNovoBusca,tipoPublicacao:_gtNovoTipoPub,ordemPublicacao:_gtNovoOrdemPub,
    // A BUSCA NÃO É ESTADO DA CAMPANHA: ela não vai para o rascunho nem para a
    // Meta. Por isso muda por aqui, e não pelo `aoMudar`, que grava no banco.
    aoMudarBusca:(m)=>{
      if(m.buscaPublicacao!==undefined)_gtNovoBusca=m.buscaPublicacao;
      if(m.tipoPublicacao!==undefined)_gtNovoTipoPub=m.tipoPublicacao;
      if(m.ordemPublicacao!==undefined)_gtNovoOrdemPub=m.ordemPublicacao;
      _gtNovoRedesenhar();
    },
    enviando:_gtNovoEnviando,criando:_gtNovoCriando,mostrarFaltas:_gtNovoFaltas,
    maisCamposAberto:_gtNovoMaisCampos,
    // `semRedesenhar` existe para digitação: redesenhar a cada letra faria o
    // campo perder o foco no meio da palavra.
    aoMudar:(mudanca,op)=>{
      // TROCAR DE PÁGINA TROCA O PERFIL, e a publicação escolhida era de outro:
      // deixá-la de pé mandaria a Meta impulsionar o post de uma marca com a
      // página de outra.
      if(mudanca&&mudanca.pageId!==undefined&&String(mudanca.pageId)!==String(_gtNovo.pageId)){
        _gtNovo.publicacaoId='';_gtNovo.publicacaoResumo='';
        _gtNovoPublicacoes=[];_gtNovoPubsDoPerfil='';
      }
      if(op&&op.maisCamposAberto!==undefined)_gtNovoMaisCampos=!!op.maisCamposAberto;
      Object.assign(_gtNovo,mudanca);
      if(!(op&&op.semRedesenhar))_gtNovoRedesenhar();
      // Mudar o TIPO no passo 1 pode passar a exigir publicação — e mudar de
      // página no passo 2 muda de qual perfil elas vêm.
      if(mudanca&&(mudanca.objetivo!==undefined||mudanca.pageId!==undefined))_gtNovoTalvezCarregarPublicacoes();
      _gtNovoAgendarSalvar();
    },
    aoPasso:(n)=>{
      _gtNovoPasso=n;_gtNovoFaltas=false;_gtNovoRedesenhar();
      // AS PUBLICAÇÕES SÓ CARREGAM AO CHEGAR NO ÚLTIMO PASSO, e só se o tipo
      // escolhido precisar delas. Buscar na abertura seria pagar uma chamada
      // que a maioria dos tipos não usa — e antes do passo 2 nem se sabe de
      // qual perfil elas viriam.
      _gtNovoTalvezCarregarPublicacoes();
      _gtNovoAgendarSalvar();
    },
    aoIrPara:(chave)=>{_gtNovoPasso=Math.max(0,PASSOS.findIndex(p=>p.chave===chave));_gtNovoFaltas=true;_gtNovoRedesenhar();},
    aoMostrarFaltas:()=>{_gtNovoFaltas=true;_gtNovoRedesenhar();},
    aoAbrirPublico:_gtNovoPublico,
    aoEnviarImagem:_gtNovoEnviarImagem,
    aoCriar:_gtNovoCriar,
  });
  if(!feito)return;
  corpo.appendChild(feito.corpo);rodape.appendChild(feito.rodape);
}

// O PASSO 3 REUSA O EDITOR DE PÚBLICO que já existe — ele devolve a escolha e
// NÃO salva sozinho, então serve para campanha que ainda nem foi criada.
// Semeia com as cidades da loja: começar vazio faria a pessoa procurar a própria
// cidade que já está cadastrada.
async function _gtNovoPublico(){
  // A MESMA TRAVA do editor de conjunto: um editor de público por vez. Os dois
  // caminhos escrevem nas MESMAS globais (_gtPub, _gtPubAntes) e disputam o
  // MESMO overlay #gt-pub-ov — abrir o segundo por cima do primeiro faria a
  // escolha de um vazar para o outro, e um deles gravaria na Meta.
  if(_gtPubBusy){
    await _gtConfirm('Já tem um público aberto','Termine o que está aberto antes de abrir outro.',{okOnly:true});
    return;
  }
  _gtPubBusy=true;
  try{ await _gtNovoPublicoMiolo(); }
  finally{ _gtPubBusy=false; }
}
async function _gtNovoPublicoMiolo(){
  // `geo_cities` veio da migration 018 como chave crua, mas o teste de
  // interesses mostra que há linha guardada como {key,nome} — aceita as duas.
  const cruas=((_gtNovo&&_gtNovo._cidadesSugeridas)||[])
    .map(c=>(c&&typeof c==='object')?{key:String(c.key),nome:c.nome||''}:{key:String(c),nome:''})
    .filter(c=>c.key&&c.key!=='undefined');
  const nomes=await _gtNovoNomesDeCidade(cruas.filter(c=>!c.nome).map(c=>c.key));
  const cidades=cruas.map(c=>({key:c.key,nome:c.nome||nomes[c.key]||c.key,raio:0,unidade:'kilometer'}));
  _gtPubAntes=_gtNovo.publico||{...lerPublico({}),cidades};
  _gtPub=_gtPubClonar(_gtPubAntes);
  _gtPubAtivo=false;
  // A MARCAÇÃO É DESTA ABERTURA. Sobrando de uma abertura anterior, a lista
  // diria "✓ aplicado" num público que não está mais valendo — mentira com
  // cara de confirmação.
  _gtPubSalvoEscolhido='';_gtPubSalvoBusca='';
  _gtPubObjetivo='';_gtPubSugeridos=null;_gtPubSugeridoEm=null;
  [_gtPubSalvos,_gtPubPresets,_gtPubSalvosDeVerdade]=await Promise.all([
    _gtListarPublicosSalvos().catch(()=>null),
    _gtListarPresets().catch(()=>null),
    _gtListarPublicosDeVerdade().catch(()=>null),
  ]);
  const escolha=await _gtPublicoModal('nova campanha','Usar este público');
  if(escolha){_gtNovo.publico=escolha;}
  _gtNovoRedesenhar();
}

// CHAVE DE CIDADE → NOME. `fabrica_lojas.geo_cities` guarda chaves cruas
// (267873), não nomes — foi assim que a migration 018 semeou a coluna. No fluxo
// normal o nome vem de graça, porque a Meta devolve `name` dentro do targeting
// do conjunto; aqui não existe conjunto ainda.
//
// É A MESMA CHAMADA que a Fábrica e o robô de interesses já usam
// (`type=adgeolocationmeta`), então não é caminho novo. Falhar não impede nada:
// sem nome a cidade aparece pela chave, feia mas correta — e quem segmenta é a
// chave, não o rótulo.
async function _gtNovoNomesDeCidade(chaves){
  const unicas=[...new Set((chaves||[]).map(k=>String(k)).filter(Boolean))];
  if(!unicas.length)return {};
  try{
    const r=await metaFetch('/search',{type:'adgeolocationmeta',cities:unicas},_gtCurAcc.id);
    const cidades=(r&&r.data&&r.data.cities)||{};
    const mapa={};
    for(const k of Object.keys(cidades))if(cidades[k]&&cidades[k].name)mapa[k]=cidades[k].name;
    return mapa;
  }catch(e){ return {}; }
}

// CRIAR DE VERDADE: campanha → conjunto → criativo → anúncio, nessa ordem,
// porque cada um precisa do id do anterior.
//
// O CRIATIVO SAI DO DESTINO DO CONJUNTO (`payloadCriativa`), e não de um
// criativo achado por aí: foi reusar criativo alheio que fez a Meta recusar
// 1885154 e 1487891 ("criativo de WhatsApp em conjunto que não era de
// WhatsApp"). Montado a partir do destino, ele casa por construção.
//
// SE FALHAR NO MEIO, NÃO APAGA NADA por conta própria — diz exatamente o que já
// existe na conta e deixa a decisão com o dono. Apagar sozinho o que ele acabou
// de mandar criar seria decidir por ele num momento em que já está confuso.
async function _gtNovoCriar(){
  const row=_gtNovoObjetivos.find(o=>o.id===_gtNovo.objetivo);
  if(!row){await _gtConfirm('Tipo não encontrado','Não achei este tipo de campanha no catálogo.',{okOnly:true});return;}
  const payloads=payloadsDoAssistente({estado:_gtNovo,objetivoRow:row,nomeDaConta:(_gtCurAcc.display_name||_gtCurAcc.name||'')});
  if(!payloads){await _gtConfirm('Falta a página','Não consegui montar a campanha: escolha a página do Facebook que assina o anúncio.',{okOnly:true});return;}

  const pg=_gtNovoPaginas.find(x=>String(x.id)===String(_gtNovo.pageId))||{};
  const ok=await _gtConfirm('Confirma criar?',
    textoDaConfirmacao(_gtNovo,row.rotulo,{pagina:pg.nome,instagram:pg.igNome},row),{okLabel:'Criar pausado'});
  if(!ok)return;

  // A CONTA vem da MARCA, e não do seletor da tela: as duas são a mesma (a loja
  // só é aceita se `marca.accountId` bater com a conta escolhida), e é da marca
  // que sai o `adAccount` do caminho. Ler os dois do mesmo lugar é o que garante
  // que o token e a conta de destino nunca se separam.
  // A CONTA É A QUE ESTÁ NA TELA, ponto. Antes vinha do cadastro da marca, o
  // que amarrava a criação à Fábrica e abria a porta para criar na conta errada.
  const act=_gtCleanAct(_gtCurAcc.ad_account_id), conta=_gtCurAcc.id;
  const feito=[];
  let idDaCampanha=null;
  _gtNovoCriando=true;_gtNovoRedesenhar();
  try{
    const c=await metaPost('/'+act+'/campaigns',payloads.campaign,conta);
    if(!c||!c.id)throw new Error('a Meta aceitou mas não devolveu o código da campanha');
    idDaCampanha=c.id;
    feito.push('campanha '+c.id);

    const cj=await metaPost('/'+act+'/adsets',{...payloads.adset,campaign_id:c.id},conta);
    if(!cj||!cj.id)throw new Error('a Meta aceitou mas não devolveu o código do conjunto');
    feito.push('conjunto '+cj.id);

    // O CRIATIVO DEPENDE DO DESTINO, e não só do hash da imagem: WhatsApp sai do
    // montador provado da Fábrica, e os destinos novos (Direct, site,
    // reconhecimento) são montados em criar-campanha.js. Ver criativaDoAssistente.
    const criativo=criativaDoAssistente({
      sub:row,estado:_gtNovo,page:_gtNovo.pageId,ig:_gtNovo.igId||undefined,
    });
    const cr=await metaPost('/'+act+'/adcreatives',{name:(_gtNovo.nome||'anúncio')+' · criativo',...criativo},conta);
    if(!cr||!cr.id)throw new Error('a Meta aceitou mas não devolveu o código do criativo');
    feito.push('criativo '+cr.id);

    const ad=await metaPost('/'+act+'/ads',{
      name:(_gtNovo.nome||'anúncio')+' · anúncio',adset_id:cj.id,
      creative:{creative_id:cr.id},status:'PAUSED',
    },conta);
    if(!ad||!ad.id)throw new Error('a Meta aceitou mas não devolveu o código do anúncio');

    _gtNovoCriando=false;
    await _gtNovoFecharRascunho('criada',{campanha:c.id,conjunto:cj.id,anuncio:ad.id,criativo:cr.id});
    _gtNovoFechar();
    await _gtConfirm('Pronto — está criado e pausado',
      'Campanha <b>'+_gtEsc(_gtNovo.nome)+'</b> criada com 1 conjunto e 1 anúncio.<br><br>'
      +'<b>Nada está rodando ainda.</b> Ela nasce pausada de propósito: dê uma olhada nela na lista '
      +'e ative quando estiver satisfeito.',{okOnly:true});
    loadGtData();
  }catch(e){
    _gtNovoCriando=false;_gtNovoRedesenhar();
    // O QUE JÁ EXISTE vai junto do erro. Sem isso, uma falha no anúncio deixaria
    // campanha e conjunto na conta sem ninguém saber — e o dono tentaria de novo,
    // criando o dobro.
    if(!feito.length){
      await _gtConfirm('A Meta recusou',_gtEsc(String((e&&e.message)||e))
        +'<br><br>Nada chegou a ser criado.',{okOnly:true});
      return;
    }
    // OFERECE DESFAZER, em vez de mandar a pessoa no Gerenciador.
    //
    // Antes esta janela dizia "não apaguei nada por conta própria. Você pode
    // apagar por lá" — verdadeiro e pouco útil: sobrava uma campanha pela
    // metade e o conserto era fora da ferramenta. Continuo NÃO apagando sozinho
    // (a decisão é de quem clicou), mas agora o botão está aqui.
    const apagar=await _gtConfirm('A Meta recusou',
      _gtEsc(String((e&&e.message)||e))
      +'<br><br><b>O que já foi criado, e está pausado:</b><br>'+feito.map(_gtEsc).join('<br>')
      +'<br><br>Nada está gastando. Quer que eu apague o que ficou pela metade?',
      {okLabel:'Apagar o que foi criado',danger:true});
    if(!apagar||!idDaCampanha)return;

    // Apagar a CAMPANHA leva junto conjunto e anúncio — é uma chamada só, e não
    // deixa pedaço para trás se uma das três falhar.
    let ok=false,ultimoErro='';
    for(let t=1;t<=3&&!ok;t++){
      try{ await metaPost('/'+idDaCampanha,{status:'DELETED'},conta); ok=true; }
      catch(err){ ultimoErro=String((err&&err.message)||err); await new Promise(r=>setTimeout(r,1200*t)); }
    }
    await _gtConfirm(ok?'Apagado':'Não consegui apagar',
      ok?'A campanha e o que estava dentro dela foram apagados.'
        :'Tentei três vezes e a Meta recusou: '+_gtEsc(ultimoErro)
         +'<br><br>Apague na mão no Gerenciador: campanha <b>'+_gtEsc(idDaCampanha)+'</b>.',
      {okOnly:true});
    if(ok)loadGtData();
  }
}

// ENVIAR IMAGEM: arquivo → Storage → Meta → hash. O meta-proxy só busca imagem
// do Storage deste projeto (trava anti-SSRF), então o caminho é obrigatório.
// Provado em validar-envio-de-imagem.mjs (4/4).
function _gtNovoEnviarImagem(){
  const inp=document.createElement('input');
  inp.type='file';inp.accept='image/png,image/jpeg,video/mp4,video/quicktime';
  inp.onchange=async()=>{
    const arq=inp.files&&inp.files[0];
    if(!arq)return;
    // VÍDEO SEGUE OUTRO CAMINHO: quem baixa é a Meta, pelo `file_url`, porque um
    // arquivo de dezenas de MB carregado na função do servidor estouraria o
    // limite dela. A trava de origem é a MESMA — só o Storage deste projeto.
    if(/^video\//.test(arq.type||'')){ await _gtNovoEnviarVideo(arq); return; }
    // CONFERE ANTES DE SUBIR. A Meta recusa imagem pequena, e descobrir isso
    // depois de esperar o upload é o pior momento possível.
    const dim=await _gtNovoDimensoes(arq).catch(()=>({}));
    const veredito=imagemServe({bytes:arq.size,largura:dim.largura,altura:dim.altura});
    if(!veredito.ok){
      await _gtConfirm('Esta imagem não serve',veredito.problemas.map(_gtEsc).join('<br>'),{okOnly:true});
      return;
    }
    _gtNovoEnviando=true;_gtNovoRedesenhar();
    try{
      const {data:{session}}=await sbClient.auth.getSession();
      const caminho='gestor-envios/'+Date.now()+'-'+String(arq.name||'imagem').replace(/[^a-zA-Z0-9._-]/g,'_');
      const up=await sbClient.storage.from('fabrica-criativos').upload(caminho,arq,{upsert:true,contentType:arq.type});
      if(up.error)throw new Error(up.error.message);
      const {data:pub}=sbClient.storage.from('fabrica-criativos').getPublicUrl(caminho);
      const r=await fetch(SUPABASE_URL+'/functions/v1/meta-proxy',{
        method:'POST',
        headers:{'Authorization':'Bearer '+session.access_token,'apikey':SUPABASE_ANON_KEY,'Content-Type':'application/json'},
        body:JSON.stringify({accountId:_gtCurAcc.id,path:'/'+_gtCleanAct(_gtCurAcc.ad_account_id)+'/adimages',method:'POST',params:{},imageFromUrl:pub.publicUrl,imageField:'envio'}),
      });
      const d=await r.json().catch(()=>({}));
      const primeira=d&&d.images&&Object.values(d.images)[0];
      if(!primeira||!primeira.hash)throw new Error((d&&d.error&&(d.error.error_user_msg||d.error.message))||'a Meta não devolveu o código da imagem');
      _gtNovoImagens=[{hash:primeira.hash,nome:arq.name,url:pub.publicUrl},..._gtNovoImagens];
      _gtNovo.imagemHash=primeira.hash;_gtNovo.imagemPreview=pub.publicUrl;
    }catch(e){
      await _gtConfirm('Não consegui enviar a imagem',_gtEsc(String((e&&e.message)||e)),{okOnly:true});
    }finally{
      _gtNovoEnviando=false;_gtNovoRedesenhar();
    }
  };
  inp.click();
}

// ENVIAR VÍDEO: arquivo → Storage → Meta (que baixa) → id + capa.
//
// A Meta demora para processar: o vídeo entra e a capa só existe depois. Por
// isso buscamos a capa numa segunda ida, e — se ela ainda não estiver pronta —
// dizemos isso em vez de deixar um vídeo sem capa parecendo escolhível.
async function _gtNovoEnviarVideo(arq){
  _gtNovoEnviando=true;_gtNovoRedesenhar();
  try{
    const {data:{session}}=await sbClient.auth.getSession();
    const caminho='gestor-envios/'+Date.now()+'-'+String(arq.name||'video').replace(/[^a-zA-Z0-9._-]/g,'_');
    const up=await sbClient.storage.from('fabrica-criativos').upload(caminho,arq,{upsert:true,contentType:arq.type});
    if(up.error)throw new Error(up.error.message);
    const {data:pub}=sbClient.storage.from('fabrica-criativos').getPublicUrl(caminho);

    const r=await fetch(SUPABASE_URL+'/functions/v1/meta-proxy',{
      method:'POST',
      headers:{'Authorization':'Bearer '+session.access_token,'apikey':SUPABASE_ANON_KEY,'Content-Type':'application/json'},
      body:JSON.stringify({
        accountId:_gtCurAcc.id,
        path:'/'+_gtCleanAct(_gtCurAcc.ad_account_id)+'/advideos',
        method:'POST',params:{name:String(arq.name||'vídeo')},
        videoFromUrl:pub.publicUrl,
      }),
    });
    const d=await r.json().catch(()=>({}));
    if(!d||!d.id)throw new Error((d&&d.error&&(d.error.error_user_msg||d.error.message))||'a Meta não devolveu o código do vídeo');

    // A CAPA vem numa segunda ida: a Meta ainda está processando quando responde.
    let capa='';
    for(let t=1;t<=6&&!capa;t++){
      await new Promise(r2=>setTimeout(r2,2500));
      try{
        const v=await metaFetch('/'+d.id,{fields:'picture,status'},_gtCurAcc.id);
        capa=(v&&v.picture)||'';
      }catch(e){ /* tenta de novo */ }
    }
    _gtNovoVideos=[{id:String(d.id),titulo:arq.name||'vídeo enviado',capa,data:''},..._gtNovoVideos];
    _gtNovo.videoId=String(d.id);_gtNovo.videoCapa=capa;
    _gtNovo.imagemHash='';_gtNovo.imagemPreview='';
    if(!capa){
      await _gtConfirm('Vídeo enviado, capa ainda não',
        'A Meta recebeu o vídeo, mas ainda está gerando a capa — e ela é obrigatória no anúncio.<br><br>'
        +'Espere um minuto e abra o assistente de novo, ou escolha outro vídeo.',{okOnly:true});
    }
  }catch(e){
    await _gtConfirm('Não consegui enviar o vídeo',_gtEsc(String((e&&e.message)||e)),{okOnly:true});
  }finally{
    _gtNovoEnviando=false;_gtNovoRedesenhar();
  }
}

// Largura e altura sem depender de biblioteca. Falhar aqui não acusa a imagem —
// o que não se sabe não vira acusação (ver imagemServe).
function _gtNovoDimensoes(arq){
  return new Promise((resolve,reject)=>{
    const url=URL.createObjectURL(arq);
    const img=new Image();
    img.onload=()=>{resolve({largura:img.naturalWidth,altura:img.naturalHeight});URL.revokeObjectURL(url);};
    img.onerror=()=>{reject(new Error('não deu para ler'));URL.revokeObjectURL(url);};
    img.src=url;
  });
}

const _gtPubClonar=(p)=>JSON.parse(JSON.stringify(p));

// AÇÃO REAL na Meta: muda quem vê os anúncios de um conjunto ao vivo.
async function _gtAbrirPublico(conjunto){
  const tok=_gtCurAcc?.id;
  if(!tok){await _gtConfirm('Sem conta selecionada','Escolha uma conta de anúncios antes de mexer no público.',{okOnly:true});return;}
  if(_gtPubBusy){
    if(_gtPubFechadoEmVoo)await _gtConfirm('Ainda terminando de salvar','Ainda estou terminando de salvar o público anterior — espere um instante.',{okOnly:true});
    else await _gtConfirm('Já tem um público aberto','Termine o que está aberto antes de abrir outro.',{okOnly:true});
    return;
  }
  _gtPubBusy=true;
  try{
    _gtPubStatus('<b>Carregando o público…</b>');
    let dados=null;
    try{ dados=await _gtBuscarPublico(conjunto.id); }
    catch(e){
      _gtPubStatus('<b>Não consegui carregar o público.</b><br>'+_gtPubTraduzir(String((e&&e.message)||e)),
        [{texto:'Fechar',primario:true,aoClicar:_gtPubFechar}]);
      return;
    }
    if(!dados){_gtPubStatus('<b>Não consegui carregar o público deste conjunto.</b>',[{texto:'Fechar',primario:true,aoClicar:_gtPubFechar}]);return;}

    _gtPubAntes=lerPublico(dados.targeting);
    _gtPub=_gtPubClonar(_gtPubAntes);
    _gtPubAtivo=dados.effective_status==='ACTIVE';
    _gtPubSalvoEscolhido='';_gtPubSalvoBusca='';
    // As duas listas são opcionais: null significa "não carregou", e cada
    // seção avisa por si. Não podem impedir o dono de trocar uma cidade.
    // As três listas são opcionais: null significa "não carregou", e cada seção
    // avisa por si (a faixa de sugestões simplesmente não aparece). Nenhuma
    // delas pode impedir o dono de trocar uma cidade.
    [_gtPubSalvos,_gtPubPresets,_gtPubSugeridos,_gtPubSalvosDeVerdade]=await Promise.all([
      _gtListarPublicosSalvos().catch(()=>null),
      _gtListarPresets().catch(()=>null),
      _gtListarSugestoes().catch(()=>null),
      _gtListarPublicosDeVerdade().catch(()=>null),
    ]);
    _gtPubObjetivo=String((conjunto&&conjunto.objetivo)||'');
    // A data mais recente entre as linhas da marca: é uma rodada só, então
    // qualquer uma serve — mas pegar a maior evita mostrar data velha se um
    // objetivo tiver falhado numa semana e ficado para trás.
    _gtPubSugeridoEm=(_gtPubSugeridos||[]).reduce((maior,l)=>{
      const d=l&&l.gerado_em?new Date(l.gerado_em):null;
      return (d&&!Number.isNaN(d.getTime())&&(!maior||d>maior))?d:maior;
    },null);

    const escolha=await _gtPublicoModal(conjunto.nome||'sem nome');
    if(!escolha)return;

    const {targeting,ajustes}=montarTargeting(escolha,dados.targeting);
    const linhas=resumoDasMudancas(_gtPubAntes,escolha);
    const avisos=avisosDe(_gtPubAntes,escolha,{ativo:_gtPubAtivo,ajustes});
    if(!linhas.length){_gtPubStatus('<b>Nada mudou.</b><br>Não há o que salvar.',[{texto:'Fechar',primario:true,aoClicar:_gtPubFechar}]);return;}

    const html='<b>Confirma estas mudanças?</b><ul style="margin:9px 0 0;padding-left:18px;">'
      +linhas.map(l=>'<li>'+_gtEsc(l)+'</li>').join('')+'</ul>'
      // Todo aviso, EXCETO 'raio', é texto fixo do módulo ou usa o mapa fechado
      // NOMES_LOCALIZACOES — carrega <b> DE PROPÓSITO, então não escapamos
      // (escapar tudo trocaria o negrito por "&lt;b&gt;" visível). O 'raio' é
      // o único que interpola dado vindo da Meta (aj.cidade, publico-alvo.js)
      // sem <b> nenhum — escapar só esse é o único ponto sem perda.
      +avisos.map(a=>'<div style="margin-top:12px;background:'+(a.bloqueia?'rgba(220,38,38,.10)':'rgba(217,119,6,.12)')+';border:1px solid '+(a.bloqueia?'rgba(220,38,38,.35)':'rgba(217,119,6,.35)')+';border-radius:8px;padding:11px 13px;line-height:1.5;">'+(a.tipo==='raio'?_gtEsc(a.texto):a.texto)+'</div>').join('');

    // A gravação de verdade acontece DENTRO do clique de "Salvar na Meta", que
    // o `_gtPubStatus` acima não bloqueia (é só desenho de tela). Sem esperar
    // por ela aqui, o `finally` deste função liberaria _gtPubBusy assim que a
    // caixa de confirmação aparecesse — ANTES do dono decidir salvar — e um
    // segundo editor poderia abrir e tomar o mesmo overlay #gt-pub-ov enquanto
    // a chamada na Meta ainda está em voo, exatamente o risco que o duplicar
    // já pagou (janela parecendo livre com escrita real rodando por trás).
    // Por isso a jornada inteira — confirmar, salvar, ver o resultado — vira
    // uma Promise que esta função espera antes de cair no finally.
    await new Promise(fimDaJornada=>{
      _gtPubStatus(html,[
        {texto:'Cancelar',aoClicar:()=>{_gtPubFechar();fimDaJornada();}},
        {texto:'Salvar na Meta',primario:true,desabilitado:avisos.some(a=>a.bloqueia),aoClicar:async()=>{
          // metaPost (ao contrário de metaFetch) NÃO tem AbortController — um
          // socket travado prenderia o dono atrás de uma caixa sem botão até
          // o navegador desistir sozinho. E comEspera pode ficar mudo por até
          // uns 14s de backoff (2+4+8s) num limite de chamadas da Meta, que lê
          // como tela travada. Duas coisas, então: (1) depois de alguns
          // segundos aparece um Fechar HONESTO — nunca diz que cancelou a
          // gravação, porque não dá pra saber se ela já chegou na Meta; (2)
          // cada espera do backoff pinta uma linha, pra não ficar mudo.
          let podeFechar=false, saiuPelaEscada=false;
          const pintarSalvando=(extra)=>{
            if(saiuPelaEscada)return;   // dono já fechou; resultado tardio vira toast, não reabre a caixa
            _gtPubStatus('<b>Salvando…</b>'+(extra?'<br>'+extra:''),
              podeFechar?[{texto:'Fechar',aoClicar:()=>{saiuPelaEscada=true;_gtPubFechadoEmVoo=true;_gtPubFechar();}}]:undefined);
          };
          const timerFechar=setTimeout(()=>{
            podeFechar=true;
            pintarSalvando('Isso está demorando mais que o esperado. Pode fechar — <b>não dá para saber se a Meta já processou</b>; se já tiver, a lista se atualiza sozinha na próxima vez que você abrir esta tela.');
          },6000);
          try{
            pintarSalvando();
            // targeting vai como OBJETO: o meta-proxy já faz JSON.stringify.
            // Converter aqui converteria duas vezes e a Meta recusaria.
            const enviar=comEspera((caminho,params)=>metaPost(caminho,params,tok),{
              esperar:(ms)=>{pintarSalvando('A Meta pediu para esperar um pouco — tentando de novo em cerca de '+Math.round(ms/1000)+'s…');return new Promise(r=>setTimeout(r,ms));},
            });
            await enviar('/'+conjunto.id,{targeting});
            clearTimeout(timerFechar);
            if(saiuPelaEscada){adminToast('O público deste conjunto foi atualizado.');loadGtData();}
            else _gtPubStatus('<b>Pronto.</b><br>O público deste conjunto foi atualizado.',
              [{texto:'Fechar',primario:true,aoClicar:()=>{_gtPubFechar();loadGtData();fimDaJornada();}}]);
          }catch(e){
            clearTimeout(timerFechar);
            // "Nada foi alterado" só pode ser dito quando a PRÓPRIA META
            // respondeu recusando (err.metaRecusou, ver metaPost). Se o que
            // falhou foi a espera do proxy (15s) ou a internet no meio do
            // caminho, o pedido pode ter chegado lá — e aí vale a mesma frase
            // honesta da escada de emergência, não uma garantia inventada.
            // Quando o pedido nem chegou a sair daqui (sem sessão, sem
            // permissão, conta sem token) a certeza é a mesma de uma recusa da
            // Meta: nada foi gravado. Só o pedido que SAIU e não voltou é que é
            // incerto — a frase de "não dá para saber" existe pra ele.
            const recusaDaMeta=!!(e&&e.metaRecusou);
            const nemSaiuDaqui=!!(e&&e.naoChegouNaMeta);
            const semDuvida=recusaDaMeta||nemSaiuDaqui;
            const titulo=recusaDaMeta?'A Meta não aceitou.'
              :nemSaiuDaqui?'Não deu para enviar.'
              :'Não consegui falar com a Meta.';
            const rodape=semDuvida
              ?'<br><br>Nada foi alterado no conjunto.'
              :'<br><br><b>Não dá para saber se a Meta já processou</b> essa mudança. Abra esta tela de novo daqui a pouco (ou o Gerenciador de Anúncios da Meta) e confira o público do conjunto antes de tentar salvar outra vez.';
            // O tradutor abre com "A Meta recusou:" quando não reconhece a
            // mensagem — o que contradiria o título quando quem falhou não foi
            // a Meta. No caso incerto, então, mostra o texto cru, escapado.
            const detalhe=semDuvida
              ?_gtPubTraduzir(String((e&&e.message)||e))
              :_gtEsc(String((e&&e.message)||e).slice(0,180));
            if(saiuPelaEscada)adminToast(recusaDaMeta?'A Meta não aceitou a mudança de público — nada foi alterado.'
              :nemSaiuDaqui?'Não deu para enviar a mudança de público — nada foi alterado.'
              :'Não consegui falar com a Meta — confira o público deste conjunto antes de tentar de novo.',false);
            else _gtPubStatus('<b>'+titulo+'</b><br>'+detalhe+rodape,
              [{texto:'Fechar',primario:true,aoClicar:()=>{_gtPubFechar();fimDaJornada();}}]);
          }finally{
            // Se o dono já saiu pela escada, a jornada só termina de verdade
            // (e a trava de ocupado só solta) quando o pedido de fato
            // concluiu — nunca no clique do "Fechar" de emergência, que só
            // tira a CAIXA da frente, não o pedido que segue em voo.
            if(saiuPelaEscada)fimDaJornada();
          }
        }},
      ]);
    });
  }catch(e){
    _gtPubStatus('<b>Deu problema inesperado.</b><br>'+_gtEsc(String((e&&e.message)||e).slice(0,180))
      +'<br><br>Se a gravação não chegou a acontecer, nada mudou no conjunto.',
      [{texto:'Fechar',primario:true,aoClicar:_gtPubFechar}]);
  }finally{
    _gtPubBusy=false;
    _gtPubFechadoEmVoo=false;
    _gtPubRedesenha=()=>{};   // função vazia, não null — ver a declaração
  }
}

// Mesmo espírito do _gtDupTraduzir, mais o caso que só existe aqui.
function _gtPubTraduzir(msg){
  const m=String(msg||'');
  // Os três motivos que o meta-proxy devolve quando barra o pedido ANTES de
  // falar com a Meta (supabase/functions/meta-proxy/index.ts). Ficam aqui em
  // cima porque "conta sem token" cairia no tradutor de permissão do duplicar
  // e mandaria o dono conferir na Meta uma coisa que é do sistema daqui.
  if(/n[ãa]o autenticado/i.test(m))
    return 'Sua <b>sessão expirou</b>. Entre no sistema de novo e refaça a alteração — nada foi enviado.';
  if(/sem permiss[ãa]o/i.test(m))
    return 'Você <b>não tem permissão</b> para mexer nesta conta de anúncios. Peça a liberação ao administrador do sistema.';
  if(/conta sem token/i.test(m))
    return 'Esta conta de anúncios está <b>sem o acesso à Meta cadastrado</b> aqui no sistema. Fale com o administrador.';
  if(/1870227|advantage/i.test(m))
    return 'A Meta recusou porque o <b>Advantage+ está ligado</b> neste conjunto. Desligue o Advantage+ no editor para que idade, gênero e interesses valham.';
  if(/1487110|radius/i.test(m))
    return 'A Meta recusou o <b>raio</b> de uma das cidades. O mínimo é 17 km (10 milhas).';
  return _gtDupTraduzir(m);
}

// AÇÃO REAL na Meta (pausar/reativar campanha ou anúncio, mudar orçamento).
// Toda chamada de metaPost() aqui é precedida por await _gtConfirm(...) — o
// usuário SEMPRE confirma antes de qualquer mutação ser aplicada na conta ao vivo.
async function _gtApplyAction(action,btn,rowEl){
  const tok=_gtCurAcc?.id;
  if(!tok){alert('Sem conta selecionada.');return;}
  const danger=action.type==='pause_campaign'||action.type==='pause_ad';
  const ok=await _gtConfirm(action._t||'Confirmar ação?',action._d||'Esta ação será aplicada na Meta agora.',{danger});
  if(!ok)return;
  const orig=btn.textContent;
  btn.disabled=true;btn.textContent='…';
  try{
    if(action.type==='pause_campaign'||action.type==='activate_campaign')
      await metaPost('/'+action.id,{status:action.type==='pause_campaign'?'PAUSED':'ACTIVE'},tok);
    else if(action.type==='pause_ad'||action.type==='activate_ad')
      await metaPost('/'+action.id,{status:action.type==='pause_ad'?'PAUSED':'ACTIVE'},tok);
    else if(action.type==='update_budget')
      await metaPost('/'+action.id,{daily_budget:String(action.budget)},tok);
    btn.textContent='✓ Aplicado';btn.style.background='var(--green)';btn.style.borderColor='var(--green)';btn.style.color='var(--sobre-cor)';
    setTimeout(()=>loadGtData(),1500);
  }catch(e){
    const msg=String((e&&e.message)||e||'');
    // ATENÇÃO ÀS SIGLAS (já foram trocadas aqui uma vez e confundiram o dono):
    // ABO = orçamento NO CONJUNTO de anúncios. CBO = orçamento NA CAMPANHA.
    // "campanha" é testado ANTES: /budget.*level/ casaria com "campaign budget
    // level" e daria a resposta trocada.
    const friendly=/campaign level|campaign budget/i.test(msg)
      ?'O orçamento está na <b>campanha</b> (CBO). Ajuste no nível da campanha, não do conjunto.'
      :/ad ?set|adset|budget.*level|set level/i.test(msg)
      ?'O orçamento está no <b>conjunto de anúncios</b> (ABO). Ajuste no nível do conjunto, não da campanha — abra a campanha e edite no conjunto.'
      :/permiss|#200|#10\b|#272|OAuth|token|management/i.test(msg)
      ?'O token desta conta <b>não tem permissão de gerenciar anúncios</b> (ads_management). Verifique o acesso na Meta.'
      :('<b>Erro da Meta:</b> '+_gtEsc(msg.slice(0,180)));
    btn.disabled=false;btn.textContent=orig;btn.style.color='';btn.style.borderColor='';
    _gtConfirm('Não foi possível aplicar',friendly,{okOnly:true});
  }
}

// Equivalente ao closeGestaoTrafego() do legado (que fazia display:none dos
// dois lados + voltava pro hub). Continua limpando os mesmos timers e o
// listener do dropdown; a troca de tela agora é feita pelo router.
function _gtStopAllTimers(){
  if(_gtClockTimer){clearInterval(_gtClockTimer);_gtClockTimer=null;}
  if(_gtStatusTimer){clearInterval(_gtStatusTimer);_gtStatusTimer=null;}
  _gtLastLoadTime=null;
  _gtSelecao.clear();
  const barra=document.getElementById('gt-massa-bar');if(barra)barra.remove();
  document.removeEventListener('click',_gtDocClick);
  document.removeEventListener('keydown',_gtCrEsc);
  // M5: o menu de objetivo por interação agora mora na raiz da tela (não mais
  // dentro do selo) — sem fechar aqui, sair da tela com o menu aberto deixaria
  // os listeners de clicar-fora/Esc/rolar (document/window) vazando.
  _gtFecharMenuObjetivo();
}
function closeGestaoTrafego(){
  _gtStopAllTimers();
  router.push({ name: 'meta-ads' });
}

// Guarda de acesso (equivalente ao if(!hasPermission('module:meta:gestor'))return;
// do openGestaoTrafego original) + disparo do carregamento inicial (equivalente
// ao resto do openGestaoTrafego original: gate do botão de KPIs, startGtClock,
// _initGestaoTrafego, _gtFontScale).
onMounted(() => {
  if (!hasPermission('module:meta:gestor')) {
    adminToast('Sem acesso', false)
    router.push({ name: 'meta-ads' })
    return
  }
  document.addEventListener('click', _gtDocClick)
  const cfgBtn = document.getElementById('gt-cfg-btn')
  if (cfgBtn) cfgBtn.style.display = hasPermission('meta.gestor', 'editar') ? '' : 'none' // editor de métricas = ação 'editar'
  // Criar campanha é escrita na Meta — mesma ação 'editar' que pausar e mudar
  // orçamento. Nasce `hidden` no template: se a permissão não puder ser lida por
  // qualquer motivo, o botão fica escondido em vez de aparecer por engano.
  const novaBtn = document.getElementById('gt-btn-nova')
  if (novaBtn && hasPermission('meta.gestor', 'editar')) novaBtn.hidden = false
  // O histórico segue o MESMO gate, e de propósito: ele mostra rascunhos e
  // erros de criação: quem não pode criar não tem o que ver nele. Um gate
  // próprio e mais largo seria uma porta lateral para a mesma informação.
  const histBtn = document.getElementById('gt-btn-hist')
  if (histBtn && hasPermission('meta.gestor', 'editar')) histBtn.hidden = false
  startGtClock()
  // A régua (gt_ponderada_config) é UMA linha única, sem relação com qual conta de
  // anúncios está selecionada — por isso carrega aqui, já no mount, e não só dentro
  // de loadGtData() (que devolve cedo sem conta selecionada). Sem isto, a aba "A
  // régua" é clicável desde o primeiro instante mas fica com o padrão de fábrica
  // até uma conta ser escolhida — e "Salvar" ali gravaria esse padrão por cima da
  // régua real das cinco contas (ver C3 do review final, 2026-07-28).
  _gtCarregarRegua()
  // A fila NÃO é chamada aqui: ela depende da lista de contas, que só existe
  // dentro de _initGestaoTrafego — e é lá que ela dispara, assim que as contas
  // chegam. Chamada neste ponto, varria uma lista vazia, não achava campanha
  // nenhuma e anunciava "nada esperando decisão" (bug visto pelo dono,
  // 2026-07-29). A guarda em _gtCarregarFila é a segunda trava do mesmo caso.
  _initGestaoTrafego();
  _gtFontScale()
})
onUnmounted(() => {
  _gtStopAllTimers()
})

// Cluster de funções chamadas via onclick="..." literal no <template> acima.
// Conferido por grep (ver comentário no topo do bloco de script): nenhuma
// outra função _gt*/setGt*/toggleGt* é chamada por onclick="..." dentro do
// HTML gerado em runtime (_renderGtCampaigns/_renderGtAds/
// _buildGtDropdown usam addEventListener ou atribuição direta a .onclick).
Object.assign(window, {
  setGtPeriod,
  _gtAbrirFunil,
  toggleGtAccPicker,
  loadGtData,
  _gtOpenEditor,
  _gtCloseEditor,
  _gtSaveEditor,
  _gtCloseCriativo,
  _gtTrocarAba,
  _gtAjuda,
  _gtNovoAbrir,
  _gtNovoFechar,
  _gtHistAbrir,
})
</script>

<style scoped>
/* Porte das regras #gestao-trafego-screen/.gt-* (Gestão de Tráfego, legacy/
   index.html L2350-2477) + o conjunto "gv-topbar/gv-clock/gv-period-btns"
   compartilhado com Gestão à Vista/Análise de Campanhas (cada tela traz sua
   própria cópia, mesmo padrão já estabelecido) + .ma-obj-chip (usado dentro
   do chip de objetivo renderizado por _renderGtCampaigns) + .zoomctl/
   .zoomctl-val (controle de zoom flutuante A−/A+ que _gtFontScale cria).
   #gestao-trafego-screen vira .tela-gestao-trafego (sem display:none — a
   visibilidade é do router). #gt-camp-col e os dois modais são preenchidos
   via innerHTML/createElement (JS imperativo acima), por isso os seletores
   que miram elementos ali dentro usam :deep(); os IDs do topbar/clock/
   dropdown de conta são literais do <template> (Vue já aplica o escopo
   neles), mas :deep() também funciona e é mantido por consistência com o
   resto do app. */
/* Fundo TRANSPARENTE: o #bg-shapes (degradê + ícones) fica fixo atrás de tudo
   pra aparecer, e o body já pinta a cor base nos DOIS temas. Pintar cor sólida
   aqui tapava a decoração e ainda deixava uma faixa visível onde a tela
   terminava. */
.tela-gestao-trafego{min-height:100vh;display:flex;flex-direction:column;background:transparent;position:relative;z-index:1;--gt-fs:1.3;}

/* ── Topbar (compartilhado com Gestão à Vista/Análise de Campanhas — cada tela traz sua cópia) ── */
.tela-gestao-trafego :deep(.gv-topbar){display:flex;align-items:center;justify-content:space-between;padding:7px 28px;border-bottom:1px solid var(--border);background:var(--surface);position:sticky;top:0;z-index:10;}
.tela-gestao-trafego :deep(.gv-back){display:flex;align-items:center;gap:4px;font-family:var(--fonte-principal);font-size:max(9px, calc(10px * var(--escala-texto, 1)));font-weight:600;color:var(--accent);cursor:pointer;background:none;border:none;padding:0;transition:opacity .15s;letter-spacing:.3px;text-transform:uppercase;}
.tela-gestao-trafego :deep(.gv-back:hover){opacity:.75;}
.tela-gestao-trafego :deep(.gv-brand-tag){font-family:var(--fonte-principal);font-size:max(9px, calc(10px * var(--escala-texto, 1)));font-weight:600;letter-spacing:3px;text-transform:uppercase;color:var(--text);opacity:.6;line-height:1;}
.tela-gestao-trafego :deep(.gv-perf-tag){font-family:var(--fonte-principal);font-size:max(9px, calc(13.5px * var(--escala-texto, 1)));font-weight:700;letter-spacing:6px;text-transform:uppercase;color:var(--text);opacity:1;line-height:1.2;}
.tela-gestao-trafego :deep(.gv-clock-wrap){text-align:right;}
.tela-gestao-trafego :deep(.gv-clock-time){font-family:var(--fonte-dados);font-size:max(16px, calc(28px * var(--escala-texto, 1)));font-weight:400;letter-spacing:3px;color:var(--text);line-height:1;}
.tela-gestao-trafego :deep(.gv-clock-date){font-family:var(--fonte-principal);font-size:max(9px, calc(8px * var(--escala-texto, 1)));letter-spacing:2px;text-transform:uppercase;color:var(--muted);margin-top:3px;}
.tela-gestao-trafego :deep(.gv-update-status){font-family:var(--fonte-principal);font-size:max(9px, calc(8px * var(--escala-texto, 1)));letter-spacing:1.5px;text-transform:uppercase;color:var(--muted);opacity:.45;margin-top:4px;text-align:right;}
.tela-gestao-trafego :deep(.gv-period-btns){display:flex;align-items:center;gap:4px;}
.tela-gestao-trafego :deep(.gv-pbtn){font-family:var(--fonte-principal);font-size:max(9px, calc(10px * var(--escala-texto, 1)));padding:4px 9px;border-radius:5px;border:1px solid var(--border);background:none;color:var(--muted);cursor:pointer;transition:all .15s;}
.tela-gestao-trafego :deep(.gv-pbtn.active){background:var(--accent);color:var(--sobre-cor);border-color:var(--accent);}

/* Abas da ferramenta. Prefixo .pnd- próprio: nomes globais vazam pra dentro de
   telas scoped neste projeto e já causaram bug antes. */
/* Abas: um CONTROLE SEGMENTADO (trilho único com a aba ativa em relevo), não dois
   botões soltos com borda cada. Dois botões contornados lado a lado brigavam com as
   pílulas de período e de status logo acima — o trilho deixa claro que é uma escolha
   entre duas telas, não mais um filtro. */
/* Abas no MESMO padrão da Gestão Comercial (.gc-tabs): sublinhado, maiúsculas,
   sem caixa nem pílula. O dono já aprovou aquele lá; ter dois desenhos de aba na
   mesma casa é o que fazia esta parecer mais um filtro. */
.tela-gestao-trafego :deep(.pnd-abas){display:flex;gap:4px;padding:2px 4px 0;margin-bottom:16px;border-bottom:1px solid var(--border);flex-wrap:wrap;}
.tela-gestao-trafego :deep(.pnd-aba){appearance:none;background:none;border:none;border-bottom:2px solid transparent;margin-bottom:-1px;padding:9px 16px;font-family:var(--fonte-principal);font-size:calc(11px*var(--gt-fs,1.3));font-weight:500;letter-spacing:1.4px;text-transform:uppercase;color:var(--muted);cursor:pointer;transition:color .15s ease,border-color .15s ease;}
.tela-gestao-trafego :deep(.pnd-aba:hover){color:var(--text);}
.tela-gestao-trafego :deep(.pnd-aba.ativa){color:var(--accent);border-bottom-color:var(--accent);}

/* Aba "A régua" (ver painel-regua.js).
   Composição: os cartões de ajuste (três na Seção 1, dois na Seção 2) ocupam a
   área principal e fluem de 1 a 3 colunas conforme a largura; o EXEMPLO VIVO
   fica numa faixa própria à direita e GRUDADO no topo (sticky) — ele é o
   retorno visual de cada tecla digitada, então precisa continuar à vista
   enquanto se rola e se edita. Antes as tabelas ficavam numa coluna e o
   exemplo sozinho na outra, deixando um vazio enorme ao lado. */
.tela-gestao-trafego :deep(.pnd-regua){display:grid;grid-template-columns:minmax(0,1fr) minmax(290px,370px);gap:18px;align-items:start;}
/* As DUAS SEÇÕES da régua (ver painel-regua.js), cada uma com sua PRÓPRIA meta
   e seu PRÓPRIO limiar (2026-07-28 — quem é dono da meta é dono do limiar):
   "Engajamento ponderado" (pesos + custo por objetivo, que são as 4 interações
   MAIS o ponto ponderado + os limiares que multiplicam ESSA meta — coluna
   `limiares`) e "Metas por resultado" (meta por objetivo de resultado +
   os limiares que multiplicam ESSA outra meta — coluna `limiares_resultado`).
   Cada .pnd-grupo é uma das duas; o espaço entre elas precisa ser MAIOR que o
   gap entre cartões da mesma seção, senão as duas leituras leem como uma
   coisa só. */
.tela-gestao-trafego :deep(.pnd-grupo){margin-bottom:22px;}
.tela-gestao-trafego :deep(.pnd-grupo:last-child){margin-bottom:0;}
.tela-gestao-trafego :deep(.pnd-grupo-tit){display:flex;align-items:center;gap:6px;font-family:var(--fonte-principal);font-size:calc(13px*var(--gt-fs,1.3));font-weight:800;color:var(--text);margin:0 0 4px;}
.tela-gestao-trafego :deep(.pnd-tabela td:first-child){min-width:11ch;}
/* ── FILTRO POR OBJETIVO (lista de campanhas) ─────────────────────────────── */
.tela-gestao-trafego :deep(.gt-obj-filtros){display:flex;flex-wrap:wrap;gap:6px;padding:10px 14px;border-bottom:1px solid var(--border);}
.tela-gestao-trafego :deep(.gt-obj-filtro){display:inline-flex;align-items:center;gap:6px;font-family:var(--fonte-principal);font-size:calc(10px*var(--gt-fs,1.3));padding:5px 11px;border-radius:999px;cursor:pointer;background:var(--surface2);border:1px solid var(--border);color:var(--muted);transition:all .12s ease;}
.tela-gestao-trafego :deep(.gt-obj-filtro:hover){color:var(--text);border-color:var(--muted);}
.tela-gestao-trafego :deep(.gt-obj-filtro.ativo){background:var(--accent);color:var(--sobre-cor);border-color:var(--accent);font-weight:600;}
.tela-gestao-trafego :deep(.gt-obj-n){font-family:var(--fonte-dados);font-size:calc(8.5px*var(--gt-fs,1.3));opacity:.65;}

/* ── MODAL DO FUNIL ───────────────────────────────────────────────────────── */
.tela-gestao-trafego :deep(#gt-modal-funil){position:fixed;inset:0;height:100dvh;z-index:1000;display:flex;align-items:center;justify-content:center;padding:24px;}
.tela-gestao-trafego :deep(.gfn-fundo){position:absolute;inset:0;background:rgba(0,0,0,.55);backdrop-filter:blur(2px);}
.tela-gestao-trafego :deep(.gfn-caixa){position:relative;background:var(--bg);border:1px solid var(--border);border-radius:16px;width:min(860px,100%);max-height:86vh;display:flex;flex-direction:column;box-shadow:0 24px 60px rgba(0,0,0,.32);overflow:hidden;}
.tela-gestao-trafego :deep(.gfn-topo){display:flex;justify-content:space-between;align-items:flex-start;gap:16px;padding:20px 24px 14px;border-bottom:1px solid var(--border);}
.tela-gestao-trafego :deep(.gfn-h2){font-family:var(--fonte-principal);font-size:calc(15px*var(--gt-fs,1.3));font-weight:700;color:var(--text);margin:0;}
.tela-gestao-trafego :deep(.gfn-h2-sub){font-family:var(--fonte-principal);font-size:calc(10px*var(--gt-fs,1.3));color:var(--muted);margin:4px 0 0;}
.tela-gestao-trafego :deep(.gfn-x){background:none;border:0;color:var(--muted);font-size:calc(15px*var(--gt-fs,1.3));cursor:pointer;padding:2px 6px;line-height:1;flex-shrink:0;}
.tela-gestao-trafego :deep(.gfn-x:hover){color:var(--text);}
.tela-gestao-trafego :deep(.gfn-corpo){overflow-y:auto;padding:18px 24px 24px;display:flex;flex-direction:column;gap:16px;}
.tela-gestao-trafego :deep(.gfn-bloco){background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:16px 18px;}
.tela-gestao-trafego :deep(.gfn-tit){font-family:var(--fonte-principal);font-size:calc(12.5px*var(--gt-fs,1.3));font-weight:700;color:var(--text);margin:0;}
.tela-gestao-trafego :deep(.gfn-sub){font-family:var(--fonte-principal);font-size:calc(9.5px*var(--gt-fs,1.3));color:var(--muted);}
.tela-gestao-trafego :deep(.gfn-explica){font-family:var(--fonte-principal);font-size:calc(9.5px*var(--gt-fs,1.3));color:var(--muted);margin:6px 0 12px;line-height:1.5;}
.tela-gestao-trafego :deep(.gfn-etapas){display:flex;flex-direction:column;gap:11px;}
.tela-gestao-trafego :deep(.gfn-et-topo){display:flex;justify-content:space-between;align-items:baseline;gap:10px;}
.tela-gestao-trafego :deep(.gfn-et-rot){font-family:var(--fonte-principal);font-size:calc(10px*var(--gt-fs,1.3));color:var(--text);font-weight:600;}
.tela-gestao-trafego :deep(.gfn-et-val){font-family:var(--fonte-dados);font-size:calc(12px*var(--gt-fs,1.3));font-weight:700;color:var(--text);}
/* min-width no preenchimento: barra de 0,3% ainda precisa ser VISTA como barra. */
.tela-gestao-trafego :deep(.gfn-barra){height:8px;background:var(--bg);border-radius:5px;overflow:hidden;margin-top:5px;}
.tela-gestao-trafego :deep(.gfn-barra-in){height:100%;background:var(--accent);border-radius:5px;min-width:3px;}
/* Sem barra: o resultado de uma PROPORCAO nao e degrau da pilha (ver funil.js). */
.tela-gestao-trafego :deep(.gfn-sem-barra){height:8px;margin-top:5px;border-top:1px dashed var(--border);}
.tela-gestao-trafego :deep(.gfn-et-nota){font-family:var(--fonte-principal);font-size:calc(9px*var(--gt-fs,1.3));color:var(--muted);margin-top:4px;}
/* O que as pessoas fizeram: a quebra do engajamento por tipo de interacao. */
.tela-gestao-trafego :deep(.gfn-interacoes){margin-top:14px;padding-top:13px;border-top:1px solid var(--border);}
.tela-gestao-trafego :deep(.gfn-int-tit){font-family:var(--fonte-principal);font-size:calc(9.5px*var(--gt-fs,1.3));font-weight:700;color:var(--text);margin-bottom:9px;}
.tela-gestao-trafego :deep(.gfn-int-lista){list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:7px;}
/* grid: rotulo | barra (cresce) | quantidade | % | peso */
.tela-gestao-trafego :deep(.gfn-int){display:grid;grid-template-columns:minmax(88px,auto) 1fr auto auto auto;align-items:center;gap:9px;}
.tela-gestao-trafego :deep(.gfn-int-rot){font-family:var(--fonte-principal);font-size:calc(9.5px*var(--gt-fs,1.3));color:var(--text);}
.tela-gestao-trafego :deep(.gfn-int-barra){height:6px;background:var(--bg);border-radius:4px;overflow:hidden;}
.tela-gestao-trafego :deep(.gfn-int-barra span){display:block;height:100%;background:var(--accent);border-radius:4px;min-width:3px;}
.tela-gestao-trafego :deep(.gfn-int-qtd){font-family:var(--fonte-dados);font-size:calc(9.5px*var(--gt-fs,1.3));font-weight:700;color:var(--text);white-space:nowrap;}
.tela-gestao-trafego :deep(.gfn-int-pct){font-family:var(--fonte-dados);font-size:calc(8.5px*var(--gt-fs,1.3));color:var(--muted);white-space:nowrap;min-width:38px;text-align:right;}
/* O peso e o elo com a regua: explica por que 200 mil curtidas podem valer
   menos que 500 salvamentos. */
.tela-gestao-trafego :deep(.gfn-int-peso){font-family:var(--fonte-principal);font-size:calc(8px*var(--gt-fs,1.3));color:var(--muted);background:var(--bg);border-radius:999px;padding:2px 7px;white-space:nowrap;}
@media (max-width:640px){
  .tela-gestao-trafego :deep(.gfn-int){grid-template-columns:1fr auto auto;grid-template-areas:'rot qtd pct' 'barra barra peso';gap:4px 8px;}
  .tela-gestao-trafego :deep(.gfn-int-rot){grid-area:rot;}
  .tela-gestao-trafego :deep(.gfn-int-barra){grid-area:barra;}
  .tela-gestao-trafego :deep(.gfn-int-qtd){grid-area:qtd;}
  .tela-gestao-trafego :deep(.gfn-int-pct){grid-area:pct;}
  .tela-gestao-trafego :deep(.gfn-int-peso){grid-area:peso;justify-self:end;}
}
.tela-gestao-trafego :deep(.gfn-tipo){display:inline-block;margin-top:13px;font-family:var(--fonte-principal);font-size:calc(8.5px*var(--gt-fs,1.3));color:var(--muted);font-style:italic;}
.tela-gestao-trafego :deep(.gfn-vazio){display:flex;flex-direction:column;gap:6px;text-align:center;padding:34px 20px;font-family:var(--fonte-principal);font-size:calc(11px*var(--gt-fs,1.3));color:var(--text);}
.tela-gestao-trafego :deep(.gfn-vazio span){font-size:calc(10px*var(--gt-fs,1.3));color:var(--muted);line-height:1.5;}
@media (max-width:640px){
  /* NÃO cola no topo: com padding 0 e height 100vh, o botão de fechar ficava
     debaixo do entalhe/ilha e não dava pra tocar (achado do dono, 2026-07-29). */
  .tela-gestao-trafego :deep(#gt-modal-funil){padding:max(8px,env(safe-area-inset-top)) max(8px,env(safe-area-inset-right)) max(8px,env(safe-area-inset-bottom)) max(8px,env(safe-area-inset-left));}
  .tela-gestao-trafego :deep(.gfn-caixa){max-height:100%;height:auto;border-radius:14px;width:100%;}
  .tela-gestao-trafego :deep(.gfn-corpo){padding:14px;}
  /* Alvo de toque do X: 44x44 é o mínimo que se acerta com o polegar (medido
     antes: 35x31). O `margin` negativo tira o peso visual do quadrado maior sem
     encolher a área que responde ao toque. */
  .tela-gestao-trafego :deep(.gfn-x){min-width:44px;min-height:44px;display:flex;align-items:center;justify-content:center;padding:0;margin:-8px -10px 0 0;}
}

/* ── FILA DE APROVAÇÃO ───────────────────────────────────────────────────── */
/* A fila é irmã de #gt-painel-campanhas no mesmo flex column e precisa rolar
   sozinha — mesma estrutura de #gt-painel-regua. Sem o padding ela nascia colada
   na borda da tela, com a caixa da campanha encostando na lateral (visto pelo
   dono, 2026-07-29). */
.tela-gestao-trafego :deep(#gt-painel-fila){flex:1;overflow-y:auto;padding:20px 28px;}
/* LISTA, nao blocos (pedido do dono, 2026-07-29): uma linha por sugestao, largura
   inteira. Em grade de cartoes, 8 sugestoes viravam 8 caixas altas e a decisao
   ficava espalhada; em lista o olho desce por uma coluna so de "de -> para". */
.tela-gestao-trafego :deep(.pnd-aba-n){display:inline-flex;align-items:center;justify-content:center;min-width:17px;height:17px;padding:0 5px;margin-left:6px;border-radius:9px;background:var(--red);color:var(--sobre-cor);font-family:var(--fonte-dados);font-size:calc(8.5px*var(--gt-fs,1.3));font-weight:700;line-height:1;}
.tela-gestao-trafego :deep(.gtf-cab){display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin:0 0 14px;}
.tela-gestao-trafego :deep(.gtf-tit){font-family:var(--fonte-principal);font-size:calc(15px*var(--gt-fs,1.3));font-weight:700;color:var(--text);margin:0;}
.tela-gestao-trafego :deep(.gtf-sub){font-family:var(--fonte-principal);font-size:calc(10.5px*var(--gt-fs,1.3));color:var(--muted);margin:4px 0 0;line-height:1.5;}
/* Os botões de conta saíram: quem filtra é o seletor da topbar. O que ficou é o
   aviso do que está nas OUTRAS contas — some da lista, não do conhecimento. */
.tela-gestao-trafego :deep(.gtf-outras){margin-top:14px;padding:10px 14px;border-radius:10px;background:var(--surface);border:1px solid var(--border);border-left:3px solid var(--accent);font-family:var(--fonte-principal);font-size:calc(10.5px*var(--gt-fs,1.3));color:var(--muted);line-height:1.5;}
.tela-gestao-trafego :deep(.gtf-outras b){color:var(--text);}
/* Cada campanha é uma CAIXA separada, não uma linha de tabela colada na
   seguinte (pedido do dono, 2026-07-29: "ta tudo muito junto"). Continua sendo
   LISTA — uma por linha, largura inteira —, mas com respiro entre elas: cada
   item traz justificativa, impacto e às vezes a quebra por conjunto, então o
   bloco é alto e sem separação o olho não acha onde uma acaba e a outra começa. */
.tela-gestao-trafego :deep(.gtf-lista){list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:12px;}
.tela-gestao-trafego :deep(.gtf-item){background:var(--surface);padding:15px 18px;border:1px solid var(--border);border-left:3px solid var(--muted);border-radius:12px;}
/* A linha do topo — selo, nome, valores, botões — é a "capa" do item: separada
   do corpo por um filete, ela vira o ponto de corte visual entre campanhas. */
.tela-gestao-trafego :deep(.gtf-item .gtf-linha){padding-bottom:11px;border-bottom:1px solid color-mix(in srgb,var(--border) 60%,transparent);}
/* Sem corpo (item de saúde curto), o filete não separa nada: some. */
.tela-gestao-trafego :deep(.gtf-item .gtf-linha:only-child){padding-bottom:0;border-bottom:0;}
.tela-gestao-trafego :deep(.gtf-item.positivo){border-left-color:var(--green);}
.tela-gestao-trafego :deep(.gtf-item.reduzir){border-left-color:var(--orange);}
.tela-gestao-trafego :deep(.gtf-item.pausar){border-left-color:var(--red);}
/* A linha: selo, identificacao (cresce), valores, acoes. `min-width:0` no meio e
   o que deixa o nome longo truncar em vez de empurrar os botoes pra fora. */
.tela-gestao-trafego :deep(.gtf-linha){display:flex;align-items:center;gap:14px;}
.tela-gestao-trafego :deep(.gtf-selo){flex:0 0 auto;font-family:var(--fonte-principal);font-size:calc(9px*var(--gt-fs,1.3));font-weight:700;padding:4px 10px;border-radius:999px;white-space:nowrap;background:color-mix(in srgb,var(--muted) 16%,transparent);color:var(--text);}
.tela-gestao-trafego :deep(.gtf-item.positivo .gtf-selo){background:color-mix(in srgb,var(--green) 18%,transparent);color:var(--green);}
.tela-gestao-trafego :deep(.gtf-item.reduzir .gtf-selo){background:color-mix(in srgb,var(--orange) 18%,transparent);color:var(--orange);}
.tela-gestao-trafego :deep(.gtf-item.pausar .gtf-selo){background:color-mix(in srgb,var(--red) 18%,transparent);color:var(--red);}
.tela-gestao-trafego :deep(.gtf-ident){flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:2px;}
.tela-gestao-trafego :deep(.gtf-nome){font-family:var(--fonte-principal);font-size:calc(11.5px*var(--gt-fs,1.3));font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.tela-gestao-trafego :deep(.gtf-conta){font-family:var(--fonte-principal);font-size:calc(9px*var(--gt-fs,1.3));color:var(--muted);}
.tela-gestao-trafego :deep(.gtf-valores){flex:0 0 auto;display:flex;align-items:baseline;gap:7px;font-family:var(--fonte-dados);white-space:nowrap;}
.tela-gestao-trafego :deep(.gtf-de){font-size:calc(10.5px*var(--gt-fs,1.3));color:var(--muted);text-decoration:line-through;}
.tela-gestao-trafego :deep(.gtf-seta){color:var(--muted);}
.tela-gestao-trafego :deep(.gtf-para){font-size:calc(14px*var(--gt-fs,1.3));font-weight:700;color:var(--text);}
.tela-gestao-trafego :deep(.gtf-pct){font-size:calc(9.5px*var(--gt-fs,1.3));font-weight:700;color:var(--green);}
.tela-gestao-trafego :deep(.gtf-pct.neg){color:var(--orange);}
.tela-gestao-trafego :deep(.gtf-pausar-nota){font-family:var(--fonte-principal);font-size:calc(10.5px*var(--gt-fs,1.3));color:var(--red);font-weight:600;}
.tela-gestao-trafego :deep(.gtf-acoes){flex:0 0 auto;display:flex;gap:7px;}
/* FUNDO TRANSPARENTE, que é o que o padrão pede pro botão comum.
   O histórico: primeiro era `--bg`, e no tema escuro `--bg` (#0a0a0b) é MAIS
   ESCURO que o cartão (#121214) — o botão virava um bloco preto furado dentro
   dele, o que o dono chamou de "fundo preto com letra branca". A correção da
   época foi `--surface2`, que resolvia o escuro mas deixava o botão CINZA no
   claro — a outra bronca do dono. Transparente resolve os dois de uma vez: o
   botão assume a cor do cartão atrás, em qualquer tema. */
.tela-gestao-trafego :deep(.gtf-btn){font-family:var(--fonte-principal);font-size:calc(10px*var(--gt-fs,1.3));font-weight:600;padding:6px 14px;border-radius:8px;cursor:pointer;border:1px solid var(--border);background:transparent;color:var(--muted);transition:all .12s ease;}
.tela-gestao-trafego :deep(.gtf-btn:hover){color:var(--text);border-color:var(--muted);}
.tela-gestao-trafego :deep(.gtf-btn.aprovar){background:var(--accent);border-color:var(--accent);color:var(--sobre-cor);}
/* O botao carrega a COR da acao: cortar verba e pausar nao sao a mesma decisao
   que escalar, e a cor avisa antes da leitura. */
.tela-gestao-trafego :deep(.gtf-btn.aprovar.reduzir){background:var(--orange);border-color:var(--orange);}
.tela-gestao-trafego :deep(.gtf-btn.aprovar.pausar){background:var(--red);border-color:var(--red);}
.tela-gestao-trafego :deep(.gtf-btn.aprovar:hover){filter:brightness(1.08);}
.tela-gestao-trafego :deep(.gtf-btn:disabled){opacity:.6;cursor:default;}
/* A RECOMENDAÇÃO DA IA EM DESTAQUE, e os caminhos contrários discretos (pedido
   do dono, 2026-08-03). `.alternativa` é botão de contorno: continua a um
   clique, mas não disputa o olho com o conselho. */
.tela-gestao-trafego :deep(.gtf-btn.recomendada){box-shadow:0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent);font-weight:700;}
.tela-gestao-trafego :deep(.gtf-btn.aprovar.reduzir.recomendada){box-shadow:0 0 0 3px color-mix(in srgb, var(--orange) 22%, transparent);}
.tela-gestao-trafego :deep(.gtf-btn.alternativa){background:transparent;border-color:var(--border);color:var(--muted);font-weight:500;opacity:.75;}
.tela-gestao-trafego :deep(.gtf-btn.alternativa:hover){opacity:1;color:var(--text);border-color:var(--muted);}
.tela-gestao-trafego :deep(.gtf-btn.alternativa.reduzir:hover){color:var(--orange);border-color:var(--orange);}
.tela-gestao-trafego :deep(.gtf-estrela){font-size:.9em;opacity:.9;}
/* O bloco de impacto: MENOR que o corpo da linha — é leitura de apoio, não
   manchete. O texto da IA fica no tamanho de leitura; a conta, menor ainda. */
.tela-gestao-trafego :deep(.gtf-impactos){margin-top:9px;font-size:calc(9.5px*var(--gt-fs,1.3));}
.tela-gestao-trafego :deep(.gtf-impactos summary){cursor:pointer;color:var(--muted);font-weight:600;}
.tela-gestao-trafego :deep(.gtf-impactos summary:hover){color:var(--text);}
.tela-gestao-trafego :deep(.gtf-impactos ul){margin:7px 0 0;padding-left:0;list-style:none;display:flex;flex-direction:column;gap:7px;}
.tela-gestao-trafego :deep(.gtf-impactos li){padding-left:9px;border-left:2px solid var(--border);}
.tela-gestao-trafego :deep(.gtf-impactos li.rec){border-left-color:var(--accent);}
.tela-gestao-trafego :deep(.gtf-impactos b){display:block;color:var(--text);}
.tela-gestao-trafego :deep(.gtf-tag-rec){font-size:.85em;color:var(--accent);font-weight:700;}
.tela-gestao-trafego :deep(.gtf-impacto-txt){display:block;color:var(--text);line-height:1.55;margin-top:2px;}
.tela-gestao-trafego :deep(.gtf-conta-simples){display:block;color:var(--muted);font-size:.88em;margin-top:3px;}
.tela-gestao-trafego :deep(.gtf-passo-origem){color:var(--muted);font-size:.88em;margin:8px 0 0;line-height:1.5;}
/* O GASTO ao lado do teto. `sobrando` marca a campanha que não usa o que já
   pode gastar — é a leitura que muda a decisão, então merece cor. */
.tela-gestao-trafego :deep(.gtf-gasto){display:flex;align-items:center;gap:6px;margin-top:3px;flex-wrap:wrap;}
.tela-gestao-trafego :deep(.gtf-gasto-num){font-size:calc(9.5px*var(--gt-fs,1.3));color:var(--muted);white-space:nowrap;}
.tela-gestao-trafego :deep(.gtf-gasto.sobrando .gtf-gasto-num){color:var(--orange);font-weight:700;}
.tela-gestao-trafego :deep(.gtf-gasto-btn){font-size:calc(9px*var(--gt-fs,1.3));padding:3px 9px;border-radius:7px;border:1px solid var(--border);background:transparent;color:var(--muted);cursor:pointer;}
.tela-gestao-trafego :deep(.gtf-gasto-btn:hover){color:var(--text);border-color:var(--muted);}
.tela-gestao-trafego :deep(.gtf-uso){margin:8px 0 0;font-size:calc(9.5px*var(--gt-fs,1.3));color:var(--orange);line-height:1.5;}
/* O modal de gastos, dentro da janela genérica do criativo. */
.tela-gestao-trafego :deep(.gt-gasto-box){padding:16px 18px;font-family:var(--fonte-principal);}
.tela-gestao-trafego :deep(.gt-gasto-teto){font-size:calc(10px*var(--gt-fs,1.3));color:var(--muted);margin-bottom:12px;}
.tela-gestao-trafego :deep(.gt-gasto-tab){width:100%;border-collapse:collapse;font-size:calc(10px*var(--gt-fs,1.3));}
.tela-gestao-trafego :deep(.gt-gasto-tab tr){border-bottom:1px solid var(--border);}
.tela-gestao-trafego :deep(.gt-gasto-tab tr.parcial){opacity:.75;}
.tela-gestao-trafego :deep(.gt-gasto-tab th){text-align:left;padding:8px 0;font-weight:700;color:var(--text);}
.tela-gestao-trafego :deep(.gt-gasto-tab td.v){text-align:right;font-weight:800;color:var(--text);white-space:nowrap;padding-right:10px;}
.tela-gestao-trafego :deep(.gt-gasto-tab td.n){color:var(--muted);font-size:.88em;text-align:right;white-space:nowrap;}
.tela-gestao-trafego :deep(.gt-gasto-aviso){margin:12px 0 0;padding:10px 12px;border-radius:8px;background:rgba(217,119,6,.12);border:1px solid rgba(217,119,6,.35);color:var(--text);font-size:calc(9.5px*var(--gt-fs,1.3));line-height:1.55;}
.tela-gestao-trafego :deep(.gt-gasto-fonte){margin:12px 0 0;color:var(--muted);font-size:calc(8.5px*var(--gt-fs,1.3));line-height:1.5;}
.tela-gestao-trafego :deep(.gt-gasto-vazio){padding:30px 20px;text-align:center;color:var(--muted);font-family:var(--fonte-principal);font-size:calc(10px*var(--gt-fs,1.3));line-height:1.6;}
/* Leitura desce ABAIXO da linha, recuada pra alinhar com o nome da campanha. */
.tela-gestao-trafego :deep(.gtf-just),.tela-gestao-trafego :deep(.gtf-impacto){font-family:var(--fonte-principal);font-size:calc(10px*var(--gt-fs,1.3));color:var(--muted);line-height:1.5;margin:9px 0 0;}
.tela-gestao-trafego :deep(.gtf-conjuntos){margin-top:7px;}
.tela-gestao-trafego :deep(.gtf-conjuntos summary){font-family:var(--fonte-principal);font-size:calc(9.5px*var(--gt-fs,1.3));color:var(--muted);cursor:pointer;}
.tela-gestao-trafego :deep(.gtf-conjuntos summary:hover){color:var(--text);}
/* width:100% + a coluna do nome absorvendo a sobra: sem isso a tabela usa
   largura automatica, o nome mais longo enche a coluna e encosta no valor
   (medido: 0px de folga na linha "MINI VLOG INSPIRA MAIS | PERFIL"). */
.tela-gestao-trafego :deep(.gtf-cj-tabela){margin-top:6px;width:100%;max-width:560px;border-collapse:collapse;font-family:var(--fonte-dados);font-size:calc(9.5px*var(--gt-fs,1.3));table-layout:auto;}
.tela-gestao-trafego :deep(.gtf-cj-tabela td){padding:3px 0;}
.tela-gestao-trafego :deep(.gtf-cj-nome){font-family:var(--fonte-principal);color:var(--text);padding-right:24px;width:100%;overflow-wrap:anywhere;}
.tela-gestao-trafego :deep(.gtf-cj-de){color:var(--muted);text-align:right;white-space:nowrap;}
.tela-gestao-trafego :deep(.gtf-cj-seta){color:var(--muted);padding:0 7px;}
.tela-gestao-trafego :deep(.gtf-cj-para){color:var(--text);font-weight:700;text-align:right;white-space:nowrap;}
/* Saúde grudada na sugestão. O CONFLITO (robô manda escalar numa campanha com a
   audiência queimada) é o caso mais perigoso da tela e ganha destaque de
   verdade — borda e fundo —, não uma nota de rodapé. */
.tela-gestao-trafego :deep(.gtf-item.conflito){border-left-color:var(--orange);}
.tela-gestao-trafego :deep(.gtf-saude){font-family:var(--fonte-principal);font-size:calc(10px*var(--gt-fs,1.3));line-height:1.5;margin:6px 0 0;color:var(--muted);}
.tela-gestao-trafego :deep(.gtf-saude.alerta){color:var(--orange);}
.tela-gestao-trafego :deep(.gtf-saude.conflito){color:var(--text);background:color-mix(in srgb,var(--orange) 12%,transparent);border-left:3px solid var(--orange);border-radius:0 8px 8px 0;padding:8px 12px;margin-top:8px;}
/* Criativos sem tracao, dobrados dentro da campanha. Dezesseis anuncios da
   mesma campanha nao sao dezesseis decisoes — a lista fica fechada e a acao e
   uma so. */
.tela-gestao-trafego :deep(.gtf-criativos){margin-top:8px;}
.tela-gestao-trafego :deep(.gtf-criativos summary){font-family:var(--fonte-principal);font-size:calc(9.5px*var(--gt-fs,1.3));color:var(--orange);cursor:pointer;font-weight:600;}
.tela-gestao-trafego :deep(.gtf-criativos summary:hover){filter:brightness(1.15);}
.tela-gestao-trafego :deep(.gtf-cr-lista){list-style:none;margin:8px 0 0;padding:0;display:flex;flex-direction:column;gap:6px;}
.tela-gestao-trafego :deep(.gtf-cr){display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 10px;padding:6px 10px;background:var(--surface2);border-radius:7px;}
.tela-gestao-trafego :deep(.gtf-cr-nome){font-family:var(--fonte-principal);font-size:calc(9.5px*var(--gt-fs,1.3));color:var(--text);font-weight:600;overflow-wrap:anywhere;}
.tela-gestao-trafego :deep(.gtf-cr-num){font-family:var(--fonte-dados);font-size:calc(9px*var(--gt-fs,1.3));color:var(--muted);white-space:nowrap;}
/* O motivo ocupa a linha toda: e o que justifica pausar, nao pode ficar cortado. */
.tela-gestao-trafego :deep(.gtf-cr-pq){flex:1 1 100%;font-family:var(--fonte-principal);font-size:calc(9px*var(--gt-fs,1.3));color:var(--muted);line-height:1.45;}
.tela-gestao-trafego :deep(.gtf-btn.pausar-criativos){margin-top:9px;background:var(--red);border-color:var(--red);color:var(--sobre-cor);}
.tela-gestao-trafego :deep(.gtf-btn.pausar-criativos:hover){filter:brightness(1.08);}
.tela-gestao-trafego :deep(.gtf-hoje){font-family:var(--fonte-principal);font-size:calc(9px*var(--gt-fs,1.3));color:var(--muted);}
.tela-gestao-trafego :deep(.gtf-sem-numero){font-family:var(--fonte-principal);font-size:calc(9.5px*var(--gt-fs,1.3));color:var(--muted);margin:6px 0 0;font-style:italic;}
.tela-gestao-trafego :deep(.gtf-sem-permissao){font-family:var(--fonte-principal);font-size:calc(9px*var(--gt-fs,1.3));color:var(--muted);}
.tela-gestao-trafego :deep(.gtf-vazio){background:var(--surface);padding:26px;text-align:center;font-family:var(--fonte-principal);font-size:calc(11px*var(--gt-fs,1.3));color:var(--text);display:flex;flex-direction:column;gap:6px;}
.tela-gestao-trafego :deep(.gtf-vazio span){font-size:calc(10px*var(--gt-fs,1.3));color:var(--muted);line-height:1.5;}
.tela-gestao-trafego :deep(.gtf-extra){margin-top:18px;}
.tela-gestao-trafego :deep(.gtf-extra summary){font-family:var(--fonte-principal);font-size:calc(10.5px*var(--gt-fs,1.3));color:var(--muted);cursor:pointer;padding:7px 0;}
.tela-gestao-trafego :deep(.gtf-extra summary:hover){color:var(--text);}
.tela-gestao-trafego :deep(.gtf-extra-nota){font-family:var(--fonte-principal);font-size:calc(10px*var(--gt-fs,1.3));color:var(--muted);line-height:1.55;margin:0 0 11px;}
.tela-gestao-trafego :deep(.gtf-silenciadas){margin-top:14px;font-family:var(--fonte-principal);font-size:calc(10px*var(--gt-fs,1.3));color:var(--muted);}
/* O QUE A META RECLAMA. Vermelho na borda quando IMPEDE de rodar, âmbar quando
   só limita — a cor é a diferença entre "consertar hoje" e "consertar depois". */
.tela-gestao-trafego :deep(.gtf-pb){margin-top:22px;padding:16px 18px;border:1px solid var(--border);border-radius:10px;background:var(--surface);font-family:var(--fonte-principal);}
.tela-gestao-trafego :deep(.gtf-pb-h){margin:0;font-size:calc(12px*var(--gt-fs,1.3));color:var(--text);font-weight:700;}
.tela-gestao-trafego :deep(.gtf-pb-frase){margin:6px 0 0;font-size:calc(10px*var(--gt-fs,1.3));color:var(--muted);line-height:1.55;}
.tela-gestao-trafego :deep(.gtf-pb-lista){list-style:none;margin:12px 0 0;padding:0;display:flex;flex-direction:column;gap:10px;}
.tela-gestao-trafego :deep(.gtf-pb-item){padding:10px 12px;border:1px solid var(--border);border-left:3px solid var(--muted);border-radius:8px;background:var(--surface2);}
.tela-gestao-trafego :deep(.gtf-pb--grave){border-left-color:var(--red);}
.tela-gestao-trafego :deep(.gtf-pb--leve){border-left-color:var(--yellow);}
.tela-gestao-trafego :deep(.gtf-pb-cab){display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 10px;}
.tela-gestao-trafego :deep(.gtf-pb-tit){font-size:calc(10.5px*var(--gt-fs,1.3));color:var(--text);font-weight:600;}
.tela-gestao-trafego :deep(.gtf-pb-selo){font-size:calc(9px*var(--gt-fs,1.3));color:var(--muted);}
.tela-gestao-trafego :deep(.gtf-pb-quantos){margin-left:auto;font-size:calc(9px*var(--gt-fs,1.3));color:var(--muted);white-space:nowrap;}
.tela-gestao-trafego :deep(.gtf-pb-det){margin:6px 0 0;font-size:calc(9.5px*var(--gt-fs,1.3));color:var(--muted);line-height:1.55;}
.tela-gestao-trafego :deep(.gtf-pb-fazer){margin:6px 0 0;font-size:calc(10px*var(--gt-fs,1.3));color:var(--text);line-height:1.55;}
.tela-gestao-trafego :deep(.gtf-pb-onde){margin:6px 0 0;font-size:calc(9px*var(--gt-fs,1.3));color:var(--muted);line-height:1.5;overflow-wrap:anywhere;}
.tela-gestao-trafego :deep(.gtf-pb-nota){margin:12px 0 0;font-size:calc(9px*var(--gt-fs,1.3));color:var(--muted);line-height:1.5;}
/* LEITURA DE PÚBLICO — o farol. Fica DEPOIS da lista e com moldura própria: não
   é uma decisão esperando, é uma leitura da conta. A borda esquerda diz o
   veredito (verde = manter, âmbar = vale ajustar, neutro = sem dados). */
.tela-gestao-trafego :deep(.gtf-lp){margin-top:22px;padding:16px 18px;border:1px solid var(--border);border-left:3px solid var(--muted);border-radius:10px;background:var(--surface);font-family:var(--fonte-principal);}
.tela-gestao-trafego :deep(.gtf-lp--ajustar){border-left-color:var(--yellow);}
.tela-gestao-trafego :deep(.gtf-lp--manter){border-left-color:var(--green);}
.tela-gestao-trafego :deep(.gtf-lp-cab){display:flex;flex-wrap:wrap;align-items:baseline;gap:8px;justify-content:space-between;}
.tela-gestao-trafego :deep(.gtf-lp-tit){margin:0;font-size:calc(12px*var(--gt-fs,1.3));color:var(--text);font-weight:700;}
.tela-gestao-trafego :deep(.gtf-lp-janela){font-size:calc(9px*var(--gt-fs,1.3));color:var(--muted);}
.tela-gestao-trafego :deep(.gtf-lp-titulo2){margin:10px 0 4px;font-size:calc(11px*var(--gt-fs,1.3));color:var(--text);font-weight:600;}
.tela-gestao-trafego :deep(.gtf-lp-frase){margin:0;font-size:calc(10px*var(--gt-fs,1.3));color:var(--muted);line-height:1.55;}
.tela-gestao-trafego :deep(.gtf-lp-dinheiro){margin:8px 0 0;font-size:calc(10.5px*var(--gt-fs,1.3));color:var(--text);font-weight:600;}
.tela-gestao-trafego :deep(.gtf-lp-alerta){margin:10px 0 0;padding:9px 11px;border-radius:6px;background:var(--surface2);border:1px solid var(--border);font-size:calc(10px*var(--gt-fs,1.3));color:var(--text);line-height:1.55;}
.tela-gestao-trafego :deep(.gtf-lp-tabela){width:100%;margin-top:12px;border-collapse:collapse;font-size:calc(9.5px*var(--gt-fs,1.3));}
.tela-gestao-trafego :deep(.gtf-lp-tabela th){text-align:left;padding:5px 8px;color:var(--muted);font-weight:600;border-bottom:1px solid var(--border);}
.tela-gestao-trafego :deep(.gtf-lp-tabela td){padding:5px 8px;color:var(--text);border-bottom:1px solid var(--border);}
/* nowrap: a 375px o "R$" quebrava do número ("R$" numa linha, "1.409,37" na outra). */
.tela-gestao-trafego :deep(.gtf-lp-num){text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;}
.tela-gestao-trafego :deep(.gtf-lp-fraca td){color:var(--muted);}
.tela-gestao-trafego :deep(.gtf-lp-receita){margin-top:14px;padding-top:12px;border-top:1px dashed var(--border);font-size:calc(10px*var(--gt-fs,1.3));color:var(--text);line-height:1.55;}
.tela-gestao-trafego :deep(.gtf-lp-porque){display:block;margin-top:4px;color:var(--muted);}
.tela-gestao-trafego :deep(.gtf-lp-usar){margin-top:10px;min-height:40px;}
.tela-gestao-trafego :deep(.gtf-lp-nota){margin:12px 0 0;font-size:calc(9px*var(--gt-fs,1.3));color:var(--muted);line-height:1.5;}
@media(max-width:640px){
  .tela-gestao-trafego :deep(.gtf-lp){padding:12px 13px;}
  .tela-gestao-trafego :deep(.gtf-lp-tabela){display:block;overflow-x:auto;}
}
/* No celular a linha vira duas: identificacao em cima, valores e botoes embaixo. */
@media (max-width:720px){
  .tela-gestao-trafego :deep(.gtf-linha){flex-wrap:wrap;gap:9px;}
  .tela-gestao-trafego :deep(.gtf-ident){flex:1 1 100%;order:1;}
  .tela-gestao-trafego :deep(.gtf-selo){order:0;}
  .tela-gestao-trafego :deep(.gtf-valores){order:2;flex:1 1 auto;}
  /* Os botoes de decisao ganham a linha inteira e quebram. Antes o bloco era
     `flex:0 0 auto` + `nowrap`: nao encolhia nem quebrava, entao os quatro
     botoes (486px medidos) sangravam 179px pra fora do card numa tela de 375.
     min-width de 46% segura dois por linha em vez de quatro espremidos. */
  .tela-gestao-trafego :deep(.gtf-acoes){order:3;flex:1 1 100%;flex-wrap:wrap;}
  .tela-gestao-trafego :deep(.gtf-btn){flex:1 1 auto;min-width:46%;}
  .tela-gestao-trafego :deep(.gtf-btn){flex:1;}
}
.tela-gestao-trafego :deep(.pnd-conta-tag){font-family:var(--fonte-principal);font-size:calc(11px*var(--gt-fs,1.3));color:var(--txt);line-height:1.5;background:color-mix(in srgb,var(--green) 10%,transparent);border:1px solid color-mix(in srgb,var(--green) 32%,transparent);border-left-width:3px;border-radius:8px;padding:9px 13px;margin:0 0 16px;}
.tela-gestao-trafego :deep(.pnd-conta-tag--vazio){background:color-mix(in srgb,var(--orange) 10%,transparent);border-color:color-mix(in srgb,var(--orange) 32%,transparent);}
.tela-gestao-trafego :deep(.pnd-grupo-sub){font-family:var(--fonte-principal);font-size:calc(10.5px*var(--gt-fs,1.3));color:var(--muted);line-height:1.5;margin:0 0 12px;max-width:70ch;}
.tela-gestao-trafego :deep(.pnd-cards){display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:14px;}
.tela-gestao-trafego :deep(.pnd-bloco){background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:16px 18px;}
.tela-gestao-trafego :deep(.pnd-cab){display:flex;align-items:center;gap:8px;margin-bottom:5px;}
.tela-gestao-trafego :deep(.pnd-cab::before){content:'';width:3px;height:14px;border-radius:2px;background:var(--accent);flex:0 0 auto;}
.tela-gestao-trafego :deep(.pnd-titulo){font-family:var(--fonte-principal);font-size:calc(12px*var(--gt-fs,1.3));font-weight:700;letter-spacing:.2px;color:var(--text);margin:0;}
/* Botão "?" de ajuda contextual — mesmo desenho de .ma-kpi-q (análise de
   campanhas): círculo pequeno e discreto, cor de destaque só no hover. Fica ao
   lado do rótulo que já existe (título de cartão, rótulo de KPI, selo…), nunca
   sozinho anunciando algo (ver _gtAjudaBtn). */
.tela-gestao-trafego :deep(.pnd-ajuda-btn){margin-left:5px;width:14px;height:14px;border-radius:50%;border:1px solid var(--border);background:none;color:var(--muted);font-size:max(9px, calc(9px * var(--escala-texto, 1)));font-weight:700;cursor:pointer;line-height:1;padding:0;vertical-align:middle;flex:0 0 auto;}
.tela-gestao-trafego :deep(.pnd-ajuda-btn:hover){border-color:var(--accent);color:var(--accent);}
.tela-gestao-trafego :deep(.pnd-ajuda){font-family:var(--fonte-principal);font-size:calc(10px*var(--gt-fs,1.3));color:var(--muted);margin:0 0 12px;line-height:1.55;}
.tela-gestao-trafego :deep(.pnd-tabela){width:100%;border-collapse:collapse;}
.tela-gestao-trafego :deep(.pnd-tabela td){padding:8px 0;border-bottom:1px solid var(--border);font-family:var(--fonte-principal);font-size:calc(11px*var(--gt-fs,1.3));color:var(--text);line-height:1.35;}
.tela-gestao-trafego :deep(.pnd-tabela tr:last-child td){border-bottom:none;padding-bottom:0;}
.tela-gestao-trafego :deep(.pnd-tabela td:last-child){text-align:right;white-space:nowrap;width:1%;padding-left:12px;}
.tela-gestao-trafego :deep(.pnd-destaque td){font-weight:800;}
/* Ocupa a lateral inteira (regra da casa: nada de max-width estreito centralizado).
   Em tela larga os parágrafos vão para DUAS COLUNAS — assim usa toda a extensão
   sem virar uma linha de 200 caracteres, que ninguém lê até o fim. */
.tela-gestao-trafego :deep(.pnd-intro){background:var(--surface);border:1px solid var(--border);border-left:3px solid var(--accent);border-radius:14px;padding:16px 20px;margin-bottom:18px;}
.tela-gestao-trafego :deep(.pnd-intro-tit){font-family:var(--fonte-principal);font-size:calc(12px*var(--gt-fs,1.3));font-weight:700;color:var(--text);margin:0 0 8px;cursor:pointer;list-style:none;display:flex;align-items:center;gap:8px;user-select:none;}
.tela-gestao-trafego :deep(.pnd-intro-tit::-webkit-details-marker){display:none;}
/* Seta propria: a do <details> nativo muda de forma entre navegadores e nao
   acompanha o --gt-fs (o zoom da tela), entao ficava minuscula no zoom alto. */
.tela-gestao-trafego :deep(.pnd-intro-tit::before){content:'';width:0;height:0;border-left:5px solid currentColor;border-top:4px solid transparent;border-bottom:4px solid transparent;transition:transform .15s ease;flex:0 0 auto;}
.tela-gestao-trafego :deep(.pnd-intro[open] .pnd-intro-tit::before){transform:rotate(90deg);}
.tela-gestao-trafego :deep(.pnd-intro-tit:hover){color:var(--accent);}
/* Fechado o card vira so o cabecalho: sem a margem de baixo do titulo ele fica
   com respiro estranho dentro da caixa. */
.tela-gestao-trafego :deep(.pnd-intro:not([open]) .pnd-intro-tit){margin-bottom:0;}
.tela-gestao-trafego :deep(.pnd-intro:not([open])){padding-top:13px;padding-bottom:13px;}
/* UMA coluna e largura inteira (pedido do dono, 2026-07-28). Cheguei a usar duas
   colunas pra encurtar a linha, e cheguei a limitar a medida do texto — as duas
   coisas foram desfeitas: em duas colunas virava paredão, e com max-width voltava
   o vazio a direita que ele ja tinha reclamado. */
.tela-gestao-trafego :deep(.pnd-intro p){font-family:var(--fonte-principal);font-size:calc(11px*var(--gt-fs,1.3));color:var(--muted);line-height:1.6;margin:0 0 7px;}
.tela-gestao-trafego :deep(.pnd-intro p:last-child){margin-bottom:0;}
.tela-gestao-trafego :deep(.pnd-alvo-nome){font-weight:600;}
.tela-gestao-trafego :deep(.pnd-alvo-ajuda){font-size:calc(9.5px*var(--gt-fs,1.3));color:var(--muted);line-height:1.45;margin-top:3px;max-width:44ch;}
.tela-gestao-trafego :deep(.pnd-alvo-vazio){font-size:calc(9.5px*var(--gt-fs,1.3));color:var(--orange);line-height:1.45;margin-top:3px;font-style:italic;}
/* Campo: a caixa é que tem a borda, e o prefixo (R$ ou ×) mora DENTRO dela — assim
   dá pra ler "R$ 0,15" como uma coisa só, em vez de um número solto sem unidade. */
.tela-gestao-trafego :deep(.pnd-campo){display:inline-flex;align-items:center;gap:5px;border:1px solid var(--border);border-radius:9px;background:var(--surface2);padding:0 9px;transition:border-color .15s,box-shadow .15s;}
.tela-gestao-trafego :deep(.pnd-campo:focus-within){border-color:var(--accent-forte);box-shadow:0 0 0 3px var(--accent-light);}
.tela-gestao-trafego :deep(.pnd-pre){font-family:var(--fonte-dados);font-size:calc(10px*var(--gt-fs,1.3));color:var(--muted);}
/* Número em fonte de dados (IBM Plex Mono), como no resto da casa: dígito com
   largura fixa faz a coluna de valores alinhar sozinha. */
.tela-gestao-trafego :deep(.pnd-input){width:62px;padding:6px 0;border:none;background:none;color:var(--text);font-family:var(--fonte-dados);font-size:calc(12px*var(--gt-fs,1.3));text-align:right;outline:none;}
.tela-gestao-trafego :deep(.pnd-input::-webkit-outer-spin-button),
.tela-gestao-trafego :deep(.pnd-input::-webkit-inner-spin-button){-webkit-appearance:none;margin:0;}
.tela-gestao-trafego :deep(.pnd-valor){font-family:var(--fonte-dados);font-size:calc(12px*var(--gt-fs,1.3));font-weight:600;}
/* Preview do limiar em reais (ver pintarLimiares em painel-regua.js): fica logo
   abaixo do campo, na mesma célula — é o que torna um multiplicador solto
   ("0,8") legível ("× 0,8 = R$ 0,12"), recalculado a cada tecla. */
.tela-gestao-trafego :deep(.pnd-limiar-prev){margin-top:4px;font-family:var(--fonte-dados);font-size:calc(9.5px*var(--gt-fs,1.3));color:var(--muted);white-space:nowrap;}
/* "Sem meta de propósito" virou UMA nota no rodapé do cartão (ver M do review final,
   2026-07-28). Como linha de tabela, o texto quebrava em quatro e inchava a linha. */
.tela-gestao-trafego :deep(.pnd-nota){margin:12px 0 0;padding-top:11px;border-top:1px dashed var(--border);font-family:var(--fonte-principal);font-size:calc(9.5px*var(--gt-fs,1.3));color:var(--muted);line-height:1.5;}
/* PERSONA DA MARCA — campo de texto longo, na mesma família visual da régua.
   16px no campo não é estética: abaixo disso o iOS dá zoom ao focar e a tela
   salta na cara de quem está digitando (PADRÃO item 6). */
.tela-gestao-trafego :deep(.pnd-persona){margin-top:22px;}
.tela-gestao-trafego :deep(.pnd-persona-campo){width:100%;box-sizing:border-box;min-height:150px;resize:vertical;padding:12px 13px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);font-family:var(--fonte-principal);font-size:max(16px, calc(16px * var(--escala-texto, 1)));line-height:1.6;}
.tela-gestao-trafego :deep(.pnd-persona-campo:focus-visible){outline:2px solid var(--accent);outline-offset:2px;}
.tela-gestao-trafego :deep(.pnd-persona-campo:disabled){opacity:.65;cursor:not-allowed;}
.tela-gestao-trafego :deep(.pnd-persona-conta){margin:6px 0 0;font-family:var(--fonte-principal);font-size:calc(9.5px*var(--gt-fs,1.3));color:var(--muted);}
.tela-gestao-trafego :deep(.pnd-persona-conta--estourou){color:var(--red);font-weight:600;}
/* TRAZER DE UM ARQUIVO. O <label> é o botão de verdade — o <input type=file> fica
   escondido porque o botão nativo não aceita estilo e escreve em inglês. 40px de
   altura é alvo de toque (PADRÃO item 6). */
/* flex-wrap: a 375px o status não cabe ao lado do botão e quebrava no meio da
   frase ("Trouxe 3681 / caracteres."). Assim ele desce inteiro pra própria linha. */
.tela-gestao-trafego :deep(.pnd-persona-arquivo){margin-top:14px;padding-top:12px;border-top:1px dashed var(--border);display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;}
.tela-gestao-trafego :deep(.pnd-persona-arquivo>p){flex:1 1 100%;}
.tela-gestao-trafego :deep(.pnd-persona-botao){display:inline-flex;align-items:center;min-height:40px;padding:0 18px;border:1px solid var(--border);border-radius:22px;background:var(--surface2);color:var(--text);font-family:var(--fonte-principal);font-size:calc(10.5px*var(--gt-fs,1.3));font-weight:600;cursor:pointer;}
.tela-gestao-trafego :deep(.pnd-persona-botao:hover){border-color:var(--accent);color:var(--accent);}
.tela-gestao-trafego :deep(.pnd-persona-status){font-family:var(--fonte-principal);font-size:calc(9.5px*var(--gt-fs,1.3));color:var(--muted);}
/* min-height 40px: MEDIDO em 12/08/2026, o botão saía com 37px — abaixo do alvo
   de toque do PADRÃO (item 6). Era assim antes deste bloco existir, no "Salvar a
   régua"; como a persona soma um segundo botão da mesma classe, o conserto vai na
   classe e pega os dois. Não mexe em largura nem em fonte. */
.tela-gestao-trafego :deep(.pnd-salvar){margin-top:16px;padding:10px 22px;min-height:40px;border-radius:22px;border:none;background:var(--accent);color:var(--sobre-cor);font-family:var(--fonte-principal);font-size:calc(11px*var(--gt-fs,1.3));font-weight:700;cursor:pointer;transition:filter .15s,transform .1s;}
.tela-gestao-trafego :deep(.pnd-salvar:hover:not(:disabled)){filter:brightness(1.08);}
.tela-gestao-trafego :deep(.pnd-salvar:active:not(:disabled)){transform:translateY(1px);}
.tela-gestao-trafego :deep(.pnd-salvar:disabled){opacity:.65;cursor:default;}

/* Exemplo vivo: o resultado vem em manchete, não escondido numa linha de tabela. */
/* Exemplo vivo: UM bloco por objetivo que a conta roda. A faixa gruda no topo e
   rola por dentro quando passa da altura da tela — são até 6 blocos. */
.tela-gestao-trafego :deep(.pnd-exemplo){position:sticky;top:14px;max-height:calc(100vh - 28px);overflow-y:auto;display:flex;flex-direction:column;gap:12px;}
.tela-gestao-trafego :deep(.pnd-ex-cab){padding:0 2px;}
.tela-gestao-trafego :deep(.pnd-ex-cab-tit){font-family:var(--fonte-principal);font-size:calc(11px*var(--gt-fs,1.3));font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:var(--accent);}
.tela-gestao-trafego :deep(.pnd-ex-cab-sub){font-family:var(--fonte-principal);font-size:calc(10px*var(--gt-fs,1.3));color:var(--muted);line-height:1.5;margin-top:4px;}
/* Bloco de INTERAÇÃO usa borda discreta: são exemplos de apoio às metas por
   curtida/comentário/salvamento/compartilhamento, abaixo dos objetivos de
   resultado, que são a leitura principal. */
.tela-gestao-trafego :deep(.pnd-ex-bloco.interacao){border-color:var(--border);}
.tela-gestao-trafego :deep(.pnd-ex-bloco.interacao .pnd-ex-topo){background:var(--surface2);}
.tela-gestao-trafego :deep(.pnd-ex-bloco.interacao .pnd-ex-rot){color:var(--muted);}
.tela-gestao-trafego :deep(.pnd-ex-bloco){background:var(--surface);border:1px solid var(--accent-mid);border-radius:14px;overflow:hidden;flex:0 0 auto;}
.tela-gestao-trafego :deep(.pnd-ex-topo){padding:14px 16px 13px;background:var(--accent-light);border-bottom:1px solid var(--border);}
.tela-gestao-trafego :deep(.pnd-ex-rot){font-family:var(--fonte-principal);font-size:calc(9px*var(--gt-fs,1.3));font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--accent);margin-bottom:6px;}
.tela-gestao-trafego :deep(.pnd-ex-nome){font-family:var(--fonte-principal);font-size:calc(10.5px*var(--gt-fs,1.3));font-weight:600;color:var(--text);line-height:1.4;margin-bottom:10px;}
.tela-gestao-trafego :deep(.pnd-ex-num){font-family:var(--fonte-dados);font-size:calc(26px*var(--gt-fs,1.3));font-weight:600;line-height:1;letter-spacing:-1px;color:var(--text);}
.tela-gestao-trafego :deep(.pnd-ex-leg){font-family:var(--fonte-principal);font-size:calc(9.5px*var(--gt-fs,1.3));color:var(--muted);margin-top:5px;}
.tela-gestao-trafego :deep(.pnd-ex-selo){display:inline-block;margin-top:10px;padding:4px 12px;border-radius:20px;font-family:var(--fonte-principal);font-size:calc(9.5px*var(--gt-fs,1.3));font-weight:700;}
.tela-gestao-trafego :deep(.pnd-ex-selo.bom){background:rgba(22,163,74,.13);color:var(--green);}
.tela-gestao-trafego :deep(.pnd-ex-selo.meio){background:rgba(245,158,11,.15);color:var(--orange);}
.tela-gestao-trafego :deep(.pnd-ex-selo.ruim){background:rgba(220,38,38,.12);color:var(--red);}
.tela-gestao-trafego :deep(.pnd-ex-selo.neutro){background:var(--surface2);color:var(--muted);}
/* "Onde a cor vira" em REAIS: multiplicador (0,8/1,0/1,3) é abstrato; o valor se lê. */
.tela-gestao-trafego :deep(.pnd-ex-regua){margin-top:12px;padding-top:10px;border-top:1px solid var(--border);}
.tela-gestao-trafego :deep(.pnd-ex-corte){display:flex;align-items:center;gap:7px;font-family:var(--fonte-principal);font-size:calc(9.5px*var(--gt-fs,1.3));color:var(--text);line-height:1.85;}
.tela-gestao-trafego :deep(.pnd-ponto){width:7px;height:7px;border-radius:50%;flex:0 0 auto;}
.tela-gestao-trafego :deep(.pnd-ponto.bom){background:var(--green);}
.tela-gestao-trafego :deep(.pnd-ponto.meio){background:var(--orange);}
.tela-gestao-trafego :deep(.pnd-ponto.ruim){background:var(--red);}
.tela-gestao-trafego :deep(.pnd-ex-corpo){padding:12px 16px 14px;}
.tela-gestao-trafego :deep(.pnd-ex-corpo .pnd-tabela td){font-size:calc(10px*var(--gt-fs,1.3));padding:5px 0;color:var(--muted);}
.tela-gestao-trafego :deep(.pnd-ex-corpo .pnd-tabela td:last-child){font-family:var(--fonte-dados);font-weight:600;color:var(--text);}
.tela-gestao-trafego :deep(.pnd-ex-corpo .pnd-tabela tr.forte td){font-weight:700;color:var(--text);}
@media (max-width:900px){
  /* No celular a faixa do exemplo desce pro fim e para de grudar; e as abas ocupam
     a largura toda, como o resto da tela já faz. */
  .tela-gestao-trafego :deep(.pnd-regua){grid-template-columns:1fr;}
  .tela-gestao-trafego :deep(.pnd-exemplo){position:static;}
  .tela-gestao-trafego :deep(.pnd-abas){display:flex;width:calc(100% - 8px);}
  .tela-gestao-trafego :deep(.pnd-aba){flex:1;padding:9px 8px;}
}

/* ── Loading state (compartilhado com Gestão à Vista/Análise de Campanhas — cada tela traz sua cópia) ── */
.tela-gestao-trafego :deep(.gv-loading-screen){grid-column:1/-1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;min-height:60vh;}
@keyframes gtSpin{to{transform:rotate(360deg)}}
.tela-gestao-trafego :deep(.gv-spinner){width:48px;height:48px;border-radius:50%;border:3px solid var(--border);border-top-color:var(--accent);animation:gtSpin .9s linear infinite;}
.tela-gestao-trafego :deep(.gv-loading-lbl){font-family:var(--fonte-principal);font-size:max(9px, calc(10px * var(--escala-texto, 1)));letter-spacing:4px;text-transform:uppercase;color:var(--muted);}

/* ── Chip de objetivo (compartilhado com Análise de Campanhas — cada tela traz sua cópia) ── */
.tela-gestao-trafego :deep(.ma-obj-chip){font-family:var(--fonte-principal);font-size:max(9px, calc(9px * var(--escala-texto, 1)));font-weight:600;letter-spacing:.5px;padding:2px 6px;border-radius:3px;background:var(--surface2);color:var(--muted);text-transform:uppercase;}

/* ── GESTÃO DE TRÁFEGO — CSS próprio (legacy/index.html L2350-2477, íntegro) ── */
/* #gt-painel-campanhas é só o alvo do toggle de aba — "display:contents" tira ele
   da árvore de layout (some como caixa, mas os filhos continuam no DOM), então
   .gt-body é quem vira o item flex de verdade dentro de .tela-gestao-trafego e
   mantém seu flex:1 + overflow-y:auto (ver I3 do review final, 2026-07-28). */
.tela-gestao-trafego :deep(#gt-painel-campanhas){display:contents;}
/* A aba "A régua" é irmã de #gt-painel-campanhas no mesmo flex column, então
   precisa da MESMA mecânica de preencher e rolar sozinha — e do mesmo padding
   lateral que .gt-body usa, senão o conteúdo cola na borda da tela (ver M1). */
.tela-gestao-trafego :deep(#gt-painel-regua){flex:1;overflow-y:auto;padding:20px 28px;}
.tela-gestao-trafego :deep(.gt-body){flex:1;display:flex;flex-direction:column;overflow-y:auto;padding:20px 28px;gap:16px;}
.tela-gestao-trafego :deep(.gt-camp-card){background:none;border:none;border-radius:0;overflow:visible;}
.tela-gestao-trafego :deep(.gt-camp-hdr){padding:2px 4px 14px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;}
.tela-gestao-trafego :deep(.gt-camp-list){display:flex;flex-direction:column;gap:14px;}
.tela-gestao-trafego :deep(.gt-camp-row){background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,.05);}
/* Campaign inner block */
.tela-gestao-trafego :deep(.gt-camp-inner){padding:13px 22px 10px;}
.tela-gestao-trafego :deep(.gt-camp-top){display:flex;flex-direction:column;gap:0;cursor:pointer;user-select:none;border-radius:8px;padding:7px 8px;margin:-5px -8px;transition:background .12s;}
.tela-gestao-trafego :deep(.gt-camp-top:hover){background:var(--surface2);}
.tela-gestao-trafego :deep(.gt-camp-top:hover .gt-name){color:var(--accent);}
.tela-gestao-trafego :deep(.gt-camp-l1){display:flex;align-items:center;gap:10px;}
.tela-gestao-trafego :deep(.gt-camp-l1 .gt-spend){margin-left:auto;}
.tela-gestao-trafego :deep(.gt-camp-num){font-family:var(--fonte-dados);font-size:calc(14px*var(--gt-fs,1.3));font-weight:600;color:var(--accent);min-width:24px;text-align:center;flex-shrink:0;font-variant-numeric:tabular-nums;letter-spacing:.5px;}
.tela-gestao-trafego :deep(.gt-ad-num){font-family:var(--fonte-dados);font-size:calc(11px*var(--gt-fs,1.3));font-weight:600;color:var(--accent);opacity:.85;flex-shrink:0;font-variant-numeric:tabular-nums;letter-spacing:.3px;}
.tela-gestao-trafego :deep(.gt-camp-l2){display:flex;align-items:center;gap:14px;margin-top:7px;flex-wrap:wrap;}
.tela-gestao-trafego :deep(.gt-camp-exp){margin-left:auto;display:flex;align-items:center;gap:6px;flex-shrink:0;}
.tela-gestao-trafego :deep(.gt-camp-row-ads){padding:0 18px 14px 22px;display:none;flex-direction:column;gap:0;background:var(--surface2);border-top:1px solid var(--border);position:relative;overflow:hidden;}
.tela-gestao-trafego :deep(.gt-camp-row-ads.open){display:flex;}
.tela-gestao-trafego :deep(.gt-ads-section-lbl){font-family:var(--fonte-principal);font-size:calc(9px*var(--gt-fs,1.3));font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--muted);padding:10px 0 6px 20px;opacity:.7;}
/* ── Conjuntos de anúncios (camada entre a campanha e os anúncios) ── */
.tela-gestao-trafego :deep(.gt-set-card){border-radius:9px;background:var(--surface);border:1px solid var(--border);padding:10px 12px;display:flex;flex-direction:column;gap:6px;margin-left:8px;margin-bottom:9px;box-shadow:0 2px 10px rgba(0,0,0,.06);}
.tela-gestao-trafego :deep(.gt-set-top){display:flex;align-items:center;gap:9px;cursor:pointer;min-width:0;}
.tela-gestao-trafego :deep(.gt-set-num){font-family:var(--fonte-dados);font-size:calc(11px*var(--gt-fs,1.3));font-weight:600;color:var(--accent);opacity:.85;flex-shrink:0;font-variant-numeric:tabular-nums;letter-spacing:.3px;}
.tela-gestao-trafego :deep(.gt-set-nm){flex:1;min-width:0;font-family:var(--fonte-principal);font-size:calc(11.5px*var(--gt-fs,1.3));font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.tela-gestao-trafego :deep(.gt-set-spend){font-family:var(--fonte-dados);font-size:calc(13px*var(--gt-fs,1.3));font-weight:700;color:var(--text);flex-shrink:0;font-variant-numeric:tabular-nums;}
.tela-gestao-trafego :deep(.gt-set-exp){display:flex;align-items:center;gap:5px;flex-shrink:0;}
.tela-gestao-trafego :deep(.gt-set-top:hover .gt-expand-hint){opacity:1;color:var(--accent);}
.tela-gestao-trafego :deep(.gt-set-chevron){flex-shrink:0;transition:transform .2s;color:var(--muted);opacity:.55;}
.tela-gestao-trafego :deep(.gt-set-chevron.open){transform:rotate(90deg);}
.tela-gestao-trafego :deep(.gt-set-pane){display:none;flex-direction:column;gap:0;margin-top:2px;}
.tela-gestao-trafego :deep(.gt-set-pane.open){display:flex;}
.tela-gestao-trafego :deep(.gt-set-empty),.tela-gestao-trafego :deep(.gt-set-nivel-nota){font-family:var(--fonte-principal);font-size:calc(10.5px*var(--gt-fs,1.3));color:var(--muted);line-height:1.5;}
.tela-gestao-trafego :deep(.gt-set-empty){padding:6px 0 6px 20px;}
.tela-gestao-trafego :deep(.gt-set-nivel-nota){padding:0 0 9px 8px;opacity:.85;}
/* Selo de onde fica o orçamento: campanha (CBO) x conjuntos (ABO) */
.tela-gestao-trafego :deep(.gt-nivel-chip){font-family:var(--fonte-principal);font-size:calc(9px*var(--gt-fs,1.3));font-weight:700;letter-spacing:.3px;padding:2px 8px;border-radius:20px;white-space:nowrap;flex-shrink:0;cursor:help;}
.tela-gestao-trafego :deep(.gt-nivel-chip.cbo){background:color-mix(in srgb,var(--accent) 12%,var(--surface));color:color-mix(in srgb,var(--accent) 75%,var(--text));}
.tela-gestao-trafego :deep(.gt-nivel-chip.abo){background:color-mix(in srgb,var(--orange) 12%,var(--surface));color:color-mix(in srgb,var(--orange) 75%,var(--text));}
/* Selo de OBJETIVO POR INTERAÇÃO (Fase 3): mesma linguagem visual do chip
   CBO/ABO acima, só que clicável (abre o menu de escolha) — position:relative
   pra segurar o menu suspenso ancorado nele. */
.tela-gestao-trafego :deep(.pnd-obj-chip){position:relative;display:inline-block;margin-top:3px;font-family:var(--fonte-principal);font-size:calc(9px*var(--gt-fs,1.3));font-weight:700;letter-spacing:.3px;padding:2px 8px;border-radius:20px;white-space:nowrap;flex-shrink:0;cursor:pointer;background:var(--surface2);color:var(--muted);border:1px solid var(--border);transition:filter .15s;}
.tela-gestao-trafego :deep(.pnd-obj-chip:hover){filter:brightness(1.08);}
.tela-gestao-trafego :deep(.pnd-obj-chip.declarado){background:var(--accent-light);color:var(--accent-forte);border-color:transparent;}
/* H2(a): sem permissão de editar, o selo só informa — sem cursor de clique nem
   destaque de hover (o listener de clique nem é ligado em _gtSeloObjetivoEl). */
.tela-gestao-trafego :deep(.pnd-obj-chip.readonly){cursor:default;}
.tela-gestao-trafego :deep(.pnd-obj-chip.readonly:hover){filter:none;}
/* M5: position:fixed (não mais absolute dentro do selo) — o menu agora é
   filho da RAIZ da tela (.tela-gestao-trafego), pendurado ali por JS
   (_gtAbrirMenuObjetivo) bem no clique, com left/top/bottom calculados de
   chip.getBoundingClientRect(). Isso tira o menu de dentro de qualquer
   ancestral com overflow:hidden (.gt-camp-row, .gt-camp-row-ads) — que antes
   cortava a parte de baixo do menu (incluindo "Voltar ao ponderado") sempre
   que o selo estava perto do fim de uma linha recolhida ou do último anúncio
   de uma campanha. */
.tela-gestao-trafego :deep(.pnd-obj-menu){position:fixed;min-width:170px;background:var(--surface);border:1px solid var(--border);border-radius:9px;box-shadow:0 8px 24px rgba(0,0,0,.18);z-index:1000;overflow:hidden;display:flex;flex-direction:column;cursor:default;}
.tela-gestao-trafego :deep(.pnd-obj-opt){appearance:none;border:none;background:none;text-align:left;padding:8px 12px;font-family:var(--fonte-principal);font-size:calc(10.5px*var(--gt-fs,1.3));font-weight:600;letter-spacing:.2px;color:var(--text);cursor:pointer;white-space:nowrap;}
.tela-gestao-trafego :deep(.pnd-obj-opt:hover){background:var(--surface2);}
.tela-gestao-trafego :deep(.pnd-obj-opt.pnd-obj-limpar){border-top:1px solid var(--border);color:var(--muted);}
/* Botão recolher/expandir tudo */
.tela-gestao-trafego :deep(.gt-collapse-all){font-family:var(--fonte-principal);font-size:calc(10px*var(--gt-fs,1.3));font-weight:600;letter-spacing:.3px;padding:4px 10px;border-radius:5px;border:1px solid var(--border);background:none;color:var(--muted);cursor:pointer;white-space:nowrap;flex-shrink:0;transition:all .15s;}
.tela-gestao-trafego :deep(.gt-collapse-all:hover){border-color:var(--accent);color:var(--accent);}
/* Aviso de "não dá pra editar aqui" (ex.: é ABO, edite no conjunto) */
.tela-gestao-trafego :deep(.gt-be-nota){font-size:calc(10.5px*var(--gt-fs,1.3));color:var(--muted);opacity:.9;line-height:1.5;}
.tela-gestao-trafego :deep(.gt-ad-card){border-radius:8px;background:var(--surface);border:1px solid var(--border);padding:11px 14px;display:flex;flex-direction:column;gap:6px;margin-left:20px;margin-bottom:7px;box-shadow:0 2px 8px rgba(0,0,0,.07);position:relative;}
/* GUIA EM ÁRVORE (o fluxograma azul que liga conjunto → anúncios).
 *
 * A versão antiga desenhava um "L" por anúncio com `top: calc(-130%)` e
 * `height: calc(130% + 7px)` — porcentagem da altura do PRÓPRIO card, tentando
 * alcançar a campanha lá em cima. Funcionava por coincidência, enquanto o anúncio
 * ficava direto embaixo da campanha. Quando os CONJUNTOS entraram no meio da
 * hierarquia, a guia passou a subir 130% da própria altura por cima dos cards de
 * conjunto: o fluxograma virou risco atravessado na tela.
 *
 * Agora são duas peças, sem porcentagem e sem atravessar nível:
 *   1. o trilho vertical vive no CONTAINER dos anúncios (gt-set-pane)
 *   2. cada anúncio tem só um "L" curto, de tamanho fixo, que encosta no trilho
 * Assim a guia liga o anúncio ao SEU conjunto — que é a relação real — e nada
 * depende da altura dos cards.
 */
.tela-gestao-trafego :deep(.gt-set-pane){position:relative;}
.tela-gestao-trafego :deep(.gt-set-pane)::before{content:'';position:absolute;left:12px;top:0;bottom:18px;border-left:2px solid var(--accent);opacity:.28;pointer-events:none;}
.tela-gestao-trafego :deep(.gt-ad-card::before){content:'';position:absolute;left:-8px;top:-9px;width:9px;height:24px;border-left:2px solid var(--accent);border-bottom:2px solid var(--accent);border-bottom-left-radius:9px;opacity:.55;pointer-events:none;}
.tela-gestao-trafego :deep(.gt-ad-top){display:flex;align-items:center;gap:8px;}
/* Status badge — replaces dot */
.tela-gestao-trafego :deep(.gt-status-badge){display:inline-flex;align-items:center;gap:4px;font-family:var(--fonte-principal);font-size:calc(9px*var(--gt-fs,1.3));font-weight:700;letter-spacing:.4px;padding:2px 8px;border-radius:20px;flex-shrink:0;text-transform:uppercase;}
.tela-gestao-trafego :deep(.gt-status-badge.active){background:color-mix(in srgb,var(--green) 12%,var(--surface));color:color-mix(in srgb,var(--green) 75%,var(--text));}
.tela-gestao-trafego :deep(.gt-status-badge.active::before){content:'';display:inline-block;width:5px;height:5px;border-radius:50%;background:var(--green);animation:pulse 2s infinite;flex-shrink:0;}
.tela-gestao-trafego :deep(.gt-status-badge.paused){background:color-mix(in srgb,var(--orange) 12%,var(--surface));color:color-mix(in srgb,var(--orange) 75%,var(--text));}
.tela-gestao-trafego :deep(.gt-status-badge.paused::before){content:'';display:inline-block;width:5px;height:5px;border-radius:50%;background:var(--orange);flex-shrink:0;}
.tela-gestao-trafego :deep(.gt-status-badge.inactive){background:var(--surface2);color:var(--muted);}
.tela-gestao-trafego :deep(.gt-status-badge.inactive::before){content:'';display:inline-block;width:5px;height:5px;border-radius:50%;background:var(--muted);flex-shrink:0;}
.tela-gestao-trafego :deep(.gt-chevron){flex-shrink:0;transition:transform .2s;color:var(--muted);opacity:.55;}
.tela-gestao-trafego :deep(.gt-chevron.open){transform:rotate(90deg);}
.tela-gestao-trafego :deep(.gt-expand-hint){font-family:var(--fonte-principal);font-size:calc(9px*var(--gt-fs,1.3));color:var(--muted);opacity:.7;white-space:nowrap;flex-shrink:0;transition:opacity .12s;}
.tela-gestao-trafego :deep(.gt-camp-top:hover .gt-expand-hint){opacity:1;color:var(--accent);}
.tela-gestao-trafego :deep(.gt-name){flex:1;min-width:0;font-family:var(--fonte-principal);font-size:calc(12px*var(--gt-fs,1.3));font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;transition:color .12s;}
.tela-gestao-trafego :deep(.gt-metrics){display:flex;align-items:center;gap:14px;flex-wrap:wrap;flex-shrink:0;}
.tela-gestao-trafego :deep(.gt-metric){font-family:var(--fonte-principal);font-size:calc(10px*var(--gt-fs,1.3));color:var(--muted);white-space:nowrap;}
.tela-gestao-trafego :deep(.gt-metric span){font-weight:700;color:var(--text);}
.tela-gestao-trafego :deep(.gt-kpi){font-family:var(--fonte-principal);font-size:calc(10px*var(--gt-fs,1.3));color:var(--muted);white-space:nowrap;display:inline-flex;align-items:center;gap:3px;}
.tela-gestao-trafego :deep(.gt-kpi-lbl){color:var(--muted);}
.tela-gestao-trafego :deep(.gt-kpi-val){font-weight:700;color:var(--text);}
.tela-gestao-trafego :deep(.gt-spend){font-family:var(--fonte-dados);font-size:calc(16px*var(--gt-fs,1.3));font-weight:700;color:var(--text);flex-shrink:0;min-width:65px;text-align:right;}
/* Action buttons */
/* Pausar em massa: caixa de seleção + barra flutuante.
   A barra fica pendurada na RAIZ da tela (não no body) — o CSS aqui é scoped e,
   de quebra, ela some sozinha quando a tela é desmontada. */
.tela-gestao-trafego :deep(.gt-sel-cb){width:16px;height:16px;flex:0 0 auto;margin:0;cursor:pointer;accent-color:var(--red);}
.tela-gestao-trafego :deep(.gt-massa-bar){position:fixed;left:50%;transform:translateX(-50%);bottom:calc(16px + env(safe-area-inset-bottom,0px));z-index:9998;display:flex;align-items:center;justify-content:center;gap:12px;flex-wrap:wrap;max-width:calc(100vw - 24px);padding:10px 14px;border-radius:14px;background:var(--surface);border:1px solid var(--border);box-shadow:0 16px 40px rgba(0,0,0,.28);font-family:var(--fonte-principal);}
.tela-gestao-trafego :deep(.gt-massa-txt){font-size:calc(12px*var(--gt-fs,1.3));font-weight:700;color:var(--text);}
.tela-gestao-trafego :deep(.gt-massa-btn){padding:7px 14px;border-radius:20px;font-family:var(--fonte-principal);font-size:calc(11px*var(--gt-fs,1.3));font-weight:700;cursor:pointer;border:1px solid var(--border);background:none;color:var(--text);white-space:nowrap;transition:all .15s;}
.tela-gestao-trafego :deep(.gt-massa-btn:hover){border-color:var(--accent-forte);color:var(--accent-forte);background:var(--accent-light);}
.tela-gestao-trafego :deep(.gt-massa-btn.danger){border-color:var(--red);background:var(--red);color:var(--sobre-cor);}
.tela-gestao-trafego :deep(.gt-massa-btn.danger:hover){background:var(--red);border-color:var(--red);color:var(--sobre-cor);}
.tela-gestao-trafego :deep(.gt-massa-btn:disabled){opacity:.65;cursor:default;}
@media (max-width:640px){
  /* No celular a barra vira faixa de ponta a ponta — não pode estourar a tela. */
  .tela-gestao-trafego :deep(.gt-massa-bar){left:12px;right:12px;transform:none;max-width:none;justify-content:space-between;}
}
.tela-gestao-trafego :deep(.gt-action-row){display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:4px;}
.tela-gestao-trafego :deep(.gt-act-btn){padding:4px 11px;border-radius:20px;font-family:var(--fonte-principal);font-size:calc(10px*var(--gt-fs,1.3));font-weight:600;cursor:pointer;transition:all .15s;border:1px solid var(--border);background:none;color:var(--text);white-space:nowrap;display:flex;align-items:center;gap:4px;}
.tela-gestao-trafego :deep(.gt-act-btn:hover){border-color:var(--accent-forte);color:var(--accent-forte);background:var(--accent-light);}
.tela-gestao-trafego :deep(.gt-act-btn.danger){border-color:color-mix(in srgb,var(--red) 30%,var(--surface));color:var(--red);}
.tela-gestao-trafego :deep(.gt-act-btn.danger:hover){background:color-mix(in srgb,var(--red) 8%,var(--surface));border-color:var(--red);}
.tela-gestao-trafego :deep(.gt-act-btn.success){border-color:color-mix(in srgb,var(--green) 30%,var(--surface));color:var(--green);}
.tela-gestao-trafego :deep(.gt-act-btn.success:hover){background:color-mix(in srgb,var(--green) 8%,var(--surface));border-color:var(--green);}
.tela-gestao-trafego :deep(.gt-act-btn.primary){border-color:var(--accent);color:var(--accent);}
.tela-gestao-trafego :deep(.gt-act-btn.primary:hover){background:var(--accent);color:var(--sobre-cor);}
.tela-gestao-trafego :deep(.gt-act-btn:disabled){opacity:.5;cursor:not-allowed;pointer-events:none;}
.tela-gestao-trafego :deep(.gt-btn-dup){
  padding:6px 11px;border-radius:7px;border:1px solid var(--border,#ddd);
  background:transparent;color:var(--text,#111);font-weight:600;
  font-size:calc(12px*var(--gt-fs,1.3));cursor:pointer;white-space:nowrap;
}
.tela-gestao-trafego :deep(.gt-btn-dup:hover){background:var(--surface-2,rgba(0,0,0,.05));}
/* ===== Redesign direção A ===== */
/* Edição manual de orçamento (sempre disponível) */
.tela-gestao-trafego :deep(.gt-budget-edit){display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:8px;font-family:var(--fonte-principal);font-size:calc(11px*var(--gt-fs,1.3));color:var(--muted);}
.tela-gestao-trafego :deep(.gt-be-cur b){color:var(--text);font-weight:700;}
.tela-gestao-trafego :deep(.gt-be-link){background:none;border:none;color:var(--accent);font-size:calc(11px*var(--gt-fs,1.3));font-weight:600;cursor:pointer;padding:2px 4px;}
.tela-gestao-trafego :deep(.gt-be-link:hover){text-decoration:underline;}
.tela-gestao-trafego :deep(.gt-be-box){display:inline-flex;align-items:center;gap:6px;}
.tela-gestao-trafego :deep(.gt-be-box[hidden]){display:none;}
.tela-gestao-trafego :deep(.gt-be-box input){width:82px;padding:5px 7px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text);font-family:var(--fonte-principal);font-size:calc(11px*var(--gt-fs,1.3));}
/* Pílula de veredito do anúncio + nome/porquê */
.tela-gestao-trafego :deep(.gt-ad-name){flex:1;min-width:0;}
.tela-gestao-trafego :deep(.gt-ad-nm){font-family:var(--fonte-principal);font-size:calc(11px*var(--gt-fs,1.3));font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.tela-gestao-trafego :deep(.gt-ad-sub){font-family:var(--fonte-principal);font-size:calc(10px*var(--gt-fs,1.3));color:var(--muted);}
/* Auto button */
.tela-gestao-trafego :deep(.gt-auto-btn){display:flex;align-items:center;gap:6px;padding:5px 14px;border-radius:7px;font-family:var(--fonte-principal);font-size:calc(11px*var(--gt-fs,1.3));font-weight:700;cursor:pointer;border:1px solid var(--border);background:none;color:var(--muted);letter-spacing:.3px;transition:all .2s;white-space:nowrap;position:relative;}
.tela-gestao-trafego :deep(.gt-auto-btn:hover){border-color:var(--muted);color:var(--text);}
.tela-gestao-trafego :deep(.gt-auto-btn.active){border-color:var(--roxo);background:color-mix(in srgb,var(--roxo) 12%,var(--surface));color:color-mix(in srgb,var(--roxo) 75%,var(--text));}
.tela-gestao-trafego :deep(.gt-auto-btn.active:hover){background:rgba(124,58,237,.2);}
.tela-gestao-trafego :deep(.gt-auto-btn.running){border-color:var(--roxo);background:var(--roxo);color:var(--sobre-cor);animation:pulse 1.5s infinite;}
.tela-gestao-trafego :deep(.gt-auto-btn:disabled){opacity:.5;cursor:not-allowed;}
.tela-gestao-trafego :deep(.gt-empty){text-align:center;padding:32px 16px;font-family:var(--fonte-principal);font-size:calc(12px*var(--gt-fs,1.3));color:var(--muted);line-height:1.7;}
/* Config modal (editor admin — métricas por objetivo) */
.tela-gestao-trafego :deep(#gt-cfg-btn){margin-right:4px;}
/* Funil + KPIs numa linha só. No computador é transparente (a barra já os
   alinhava); no celular é o que devolve ~35px de tela. */
.tela-gestao-trafego :deep(.gt-dupla){display:flex;align-items:center;gap:8px;}
@media(max-width:640px){
  .tela-gestao-trafego :deep(.gt-dupla){width:100%;}
  /* `flex:1 1 0` divide a largura em partes iguais em vez de deixar cada botão
     com o tamanho do próprio texto — "Funil" é bem mais curto que "KPIs" com o
     ícone, e sem isso os dois ficariam desalinhados. */
  .tela-gestao-trafego :deep(.gt-dupla > .gt-auto-btn){flex:1 1 0;justify-content:center;}
}
.tela-gestao-trafego :deep(#gt-cfg-overlay){position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:1300;display:none;backdrop-filter:blur(2px);padding-top:max(16px,env(safe-area-inset-top));padding-bottom:max(16px,env(safe-area-inset-bottom));padding-left:max(12px,env(safe-area-inset-left));padding-right:max(12px,env(safe-area-inset-right));touch-action:none;overscroll-behavior:contain;}
.tela-gestao-trafego :deep(#gt-cfg-overlay) > *{overscroll-behavior:contain;touch-action:pan-y;}
.tela-gestao-trafego :deep(#gt-cfg-modal){position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:1301;background:var(--surface);border:1px solid var(--border);border-radius:12px;width:min(720px,calc(100vw - 28px));max-height:84vh;display:none;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.35);}
.tela-gestao-trafego :deep(.gt-cfg-head){padding:16px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;}
.tela-gestao-trafego :deep(.gt-cfg-title){font-family:var(--fonte-principal);font-size:calc(13px*var(--gt-fs,1.3));font-weight:700;color:var(--text);}
.tela-gestao-trafego :deep(.gt-cfg-close){background:none;border:none;color:var(--muted);cursor:pointer;font-size:calc(16px*var(--gt-fs,1.3));padding:0;line-height:1;}

/* ── O ASSISTENTE, VESTIDO COMO O RESTO DA CASA ───────────────────────────
   O assistente nasceu montado com estilo solto no JavaScript, e por isso
   destoava: botão de um tamanho aqui, de outro ali, número em Sora onde o resto
   do painel usa IBM Plex Mono. Não é uma linguagem visual nova — é a MESMA,
   aplicada a uma tela que ficou de fora dela.

   As três decisões:
   1. NÚMERO É DADO, e dado tem fonte própria nesta casa (--fonte-dados). Preço,
      custo e contagem passam a usá-la — é o sinal que o painel inteiro já dá.
   2. BOTÃO TEM TRÊS PAPÉIS, não sete tamanhos: o que faz a coisa (primário), o
      que oferece uma escolha (secundário) e o que só recua (fantasma).
   3. O PASSO A PASSO DIZ OS NOMES. Cinco pontinhos não informam nada; cinco
      nomes dizem onde se está, o que já passou e o que falta. */

/* A TRILHA. Nomeada, e não pontilhada: "passo 3 de 5" responde quanto falta,
   mas não responde o que vem. */
.tela-gestao-trafego :deep(.gtw-trilha){display:flex;gap:2px;margin:0 0 16px;align-items:stretch;}
.tela-gestao-trafego :deep(.gtw-passo){flex:1;min-width:0;padding:0 0 7px;border-bottom:2px solid var(--border);
  font-family:var(--fonte-principal);font-size:calc(8.5px*var(--gt-fs,1.3));font-weight:600;letter-spacing:.6px;
  text-transform:uppercase;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
  transition:color .18s ease,border-color .18s ease;}
.tela-gestao-trafego :deep(.gtw-passo.feito){color:var(--green);border-bottom-color:color-mix(in srgb,var(--green) 55%,transparent);}
.tela-gestao-trafego :deep(.gtw-passo.agora){color:var(--accent);border-bottom-color:var(--accent);font-weight:800;}
.tela-gestao-trafego :deep(.gtw-passo .n){font-family:var(--fonte-dados);margin-right:5px;opacity:.75;}

/* O CABEÇALHO do passo: pergunta grande, resposta curta embaixo. */
.tela-gestao-trafego :deep(.gtw-titulo){font-family:var(--fonte-principal);font-size:calc(14px*var(--gt-fs,1.3));
  font-weight:800;letter-spacing:-.2px;margin:0 0 4px;color:var(--text);}
.tela-gestao-trafego :deep(.gtw-ajuda){font-size:calc(10.5px*var(--gt-fs,1.3));color:var(--muted);
  margin:0 0 14px;line-height:1.55;max-width:52ch;}

/* OS TRÊS PAPÉIS DE BOTÃO. `focus-visible` e não `focus`: o anel tem que
   aparecer para quem navega no teclado e sumir para quem clica. */
.tela-gestao-trafego :deep(.gtw-b){font-family:var(--fonte-principal);font-size:calc(11px*var(--gt-fs,1.3));
  font-weight:700;padding:9px 17px;border-radius:9px;cursor:pointer;border:1px solid transparent;
  transition:transform .12s ease,box-shadow .18s ease,background .18s ease,border-color .18s ease;}
.tela-gestao-trafego :deep(.gtw-b:focus-visible){outline:2px solid var(--accent);outline-offset:2px;}
.tela-gestao-trafego :deep(.gtw-b:active:not(:disabled)){transform:translateY(1px);}
.tela-gestao-trafego :deep(.gtw-b:disabled){opacity:.5;cursor:default;}
.tela-gestao-trafego :deep(.gtw-b.primario){background:var(--accent);color:var(--sobre-cor);box-shadow:var(--shadow-sm);}
.tela-gestao-trafego :deep(.gtw-b.primario:hover:not(:disabled)){box-shadow:var(--shadow-md);}
.tela-gestao-trafego :deep(.gtw-b.secundario){background:var(--surface2);color:var(--text);border-color:var(--border);}
.tela-gestao-trafego :deep(.gtw-b.secundario:hover:not(:disabled)){border-color:var(--accent);color:var(--accent);}
/* O FANTASMA usava `--muted`, que é a MESMA cor do texto desabilitado. Voltar
   ficava indistinguível de um botão morto — e "Voltar" é a única saída de quem
   errou o passo anterior. Cor de texto normal e uma borda discreta: continua
   sendo o botão secundário da dupla, sem passar por apagado. */
.tela-gestao-trafego :deep(.gtw-b.fantasma){background:none;color:var(--text);
  border-color:var(--border);opacity:.85;}
.tela-gestao-trafego :deep(.gtw-b.fantasma:hover:not(:disabled)){opacity:1;border-color:var(--accent);color:var(--accent);}

/* NÚMERO É DADO. A fonte muda porque o painel inteiro já muda — é o sinal de
   "isto é medida", e o assistente era o único lugar que não dava esse sinal. */
.tela-gestao-trafego :deep(.gtw-num){font-family:var(--fonte-dados);font-feature-settings:'tnum';}

/* A ENTRADA DO PASSO. Um movimento só, curto, no conteúdo — o suficiente para
   a troca ser percebida sem virar espetáculo. Quem pediu menos movimento no
   sistema não recebe nenhum. */
@media (prefers-reduced-motion: no-preference){
  .tela-gestao-trafego :deep(.gtw-entra){animation:gtwEntra .22s ease both;}
}
@keyframes gtwEntra{from{opacity:0;transform:translateY(6px);}to{opacity:1;transform:none;}}

/* ── ASSISTENTE DE NOVA CAMPANHA ──────────────────────────────────────────
   Mesmo desenho do editor de métricas (#gt-cfg-*): é a mesma casa, e inventar
   uma segunda janela faria a tela parecer dois aplicativos. O miolo é montado
   em assistente-campanha.js com estilo inline, então aqui só mora a moldura.

   Botão com fundo TRANSPARENTE (padrão da Central): assume a cor do cartão
   atrás. Já foi `--bg` (virava bloco preto no tema escuro) e depois
   `--surface2` (virava cinza no claro); transparente não tem nenhum dos dois
   problemas. */
.tela-gestao-trafego :deep(.pnd-aba-acao){appearance:none;margin-left:auto;margin-bottom:-1px;padding:7px 15px;align-self:center;border:1px solid var(--border);border-radius:8px;background:var(--surface2,var(--surface));color:var(--accent);font-family:var(--fonte-principal);font-size:calc(11px*var(--gt-fs,1.3));font-weight:700;letter-spacing:1px;text-transform:uppercase;cursor:pointer;transition:border-color .15s ease,color .15s ease;}
/* Os dois botoes de acao andam JUNTOS na direita. Antes cada um tinha o seu
   `margin-left:auto` e o navegador reparte a sobra entre todas as margens
   automaticas: metade antes de "Nova campanha", metade antes de "Historico"
   — os dois soltos no meio da barra. So o primeiro empurra; o segundo cola. */
.tela-gestao-trafego :deep(.pnd-aba-acao + .pnd-aba-acao){margin-left:0;}
.tela-gestao-trafego :deep(.pnd-aba-acao:hover){border-color:var(--accent);}
.tela-gestao-trafego :deep(#gt-novo-ov){position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:1300;display:none;backdrop-filter:blur(2px);touch-action:none;overscroll-behavior:contain;}
.tela-gestao-trafego :deep(#gt-novo-ov) > *{overscroll-behavior:contain;touch-action:pan-y;}
.tela-gestao-trafego :deep(#gt-novo-modal){position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:1301;background:var(--surface);border:1px solid var(--border);border-radius:12px;width:min(620px,94vw);max-height:88vh;display:none;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.35);}
/* O corpo é quem rola, não a janela: com a janela rolando, o rodapé (onde
   ficam "Voltar" e "Criar") saía da tela justo no passo mais longo.
   SEM padding e SEM borda nos dois: quem monta o miolo (assistente-campanha.js)
   já traz o seu, e somar os dois dava margem dobrada no corpo e um rodapé
   encolhido no canto esquerdo, com o "Avançar" longe da borda direita. Estes
   dois seletores são moldura, não desenho. */
/* SOMBRA DE ROLAGEM, só CSS. No passo dos tipos a lista continua abaixo da
   dobra e nada dizia isso — "Cliques para o site" aparecia cortado ao meio,
   parecendo o fim. Os dois primeiros planos ficam presos ao conteúdo
   (`local`) e os dois últimos à moldura (`scroll`): a sombra só aparece do
   lado em que ainda há o que ver. */
.tela-gestao-trafego :deep(#gt-novo-corpo){flex:1;min-height:0;overflow-y:auto;font-family:var(--fonte-principal);color:var(--text);font-size:calc(12px*var(--gt-fs,1.3));
  background:
    linear-gradient(var(--surface) 30%, transparent) top / 100% 24px no-repeat local,
    linear-gradient(transparent, var(--surface) 70%) bottom / 100% 24px no-repeat local,
    radial-gradient(farthest-side at 50% 0, rgba(0,0,0,.16), transparent) top / 100% 10px no-repeat scroll,
    radial-gradient(farthest-side at 50% 100%, rgba(0,0,0,.16), transparent) bottom / 100% 10px no-repeat scroll;}
.tela-gestao-trafego :deep(#gt-novo-rodape){flex:0 0 auto;font-family:var(--fonte-principal);}
.tela-gestao-trafego :deep(#gt-novo-rodape > *){width:100%;box-sizing:border-box;}
/* O ÍCONE DO SELETOR DE DATA é desenhado pelo navegador e nasce PRETO — no tema
   escuro ele vira um borrão invisível no canto do campo, o mesmo tipo de defeito
   que o dono apontou nos botões desta ferramenta. `invert` é o único jeito de
   alcançá-lo; ele não aceita `color`. */
:root[data-theme="dark"] .tela-gestao-trafego :deep(.gt-novo-data)::-webkit-calendar-picker-indicator{filter:invert(1);opacity:.75;cursor:pointer;}
.tela-gestao-trafego :deep(.gt-novo-carregando){padding:26px 4px;text-align:center;color:var(--muted);line-height:1.6;}
@media(max-width:640px){
  /* Centralizado COM MARGEM, nunca colado nas bordas — pedido do dono, o mesmo
     que ele ja tinha feito pro modal do Patrimonio. A versao anterior era
     `100vw x 100dvh`: virava uma tela dentro da tela, sem borda, e nao dava pra
     ver que era uma janela que fecha. 14px de folga de cada lado. */
  .tela-gestao-trafego :deep(#gt-novo-modal){width:calc(100vw - 28px);max-width:none;max-height:calc(100dvh - 56px);border-radius:14px;}
  .tela-gestao-trafego :deep(.pnd-aba-acao){margin-left:0;flex:1 1 100%;margin-top:6px;}
}
.tela-gestao-trafego :deep(.gt-cfg-body){padding:16px 20px;overflow-y:auto;flex:1;}
.tela-gestao-trafego :deep(.gt-cfg-sec){margin-bottom:18px;}
.tela-gestao-trafego :deep(.gt-cfg-sec:last-child){margin-bottom:0;}
.tela-gestao-trafego :deep(.gt-cfg-obj){font-family:var(--fonte-principal);font-size:calc(11px*var(--gt-fs,1.3));font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--accent);margin-bottom:8px;}
.tela-gestao-trafego :deep(.gt-cfg-grid){display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:6px 10px;}
.tela-gestao-trafego :deep(.gt-cfg-chk){display:flex;align-items:center;gap:6px;font-family:var(--fonte-principal);font-size:calc(12px*var(--gt-fs,1.3));color:var(--text);cursor:pointer;user-select:none;}
.tela-gestao-trafego :deep(.gt-cfg-chk input){accent-color:var(--accent);cursor:pointer;}
.tela-gestao-trafego :deep(.gt-cfg-footer){padding:14px 20px;border-top:1px solid var(--border);display:flex;align-items:center;justify-content:flex-end;gap:10px;}
/* Modal "Ver criativo" */
.tela-gestao-trafego :deep(#gt-cr-overlay){position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:1400;display:none;backdrop-filter:blur(2px);padding-top:max(16px,env(safe-area-inset-top));padding-bottom:max(16px,env(safe-area-inset-bottom));padding-left:max(12px,env(safe-area-inset-left));padding-right:max(12px,env(safe-area-inset-right));touch-action:none;overscroll-behavior:contain;}
/* Modal "Ver criativo" */
.tela-gestao-trafego :deep(#gt-cr-overlay) > *{overscroll-behavior:contain;touch-action:pan-y;}
.tela-gestao-trafego :deep(#gt-cr-modal){position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:1401;background:var(--surface);border:1px solid var(--border);border-radius:12px;width:min(420px,calc(100vw - 28px));max-height:88vh;display:none;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.4);overflow:hidden;}
.tela-gestao-trafego :deep(.gt-cr-body){padding:14px;overflow:auto;flex:1;display:flex;justify-content:center;align-items:flex-start;}
.tela-gestao-trafego :deep(.gt-cr-frame){width:100%;display:flex;justify-content:center;}
.tela-gestao-trafego :deep(.gt-cr-frame iframe){max-width:100%;border:none;border-radius:8px;}
@media(max-width:600px){.tela-gestao-trafego :deep(.gt-cfg-grid){grid-template-columns:repeat(auto-fill,minmax(140px,1fr));}}
@media(max-width:768px){
  .tela-gestao-trafego :deep(.gt-body){padding:12px 14px;}
  .tela-gestao-trafego :deep(#gt-painel-regua){padding:12px 14px;}
  /* No celular o respiro é menor, mas nunca zero: o dedo precisa de onde pegar
     pra rolar sem encostar no botão da caixa. */
  .tela-gestao-trafego :deep(#gt-painel-fila){padding:12px 14px;}
  .tela-gestao-trafego :deep(.gt-camp-inner){padding:11px 14px 9px;}
  .tela-gestao-trafego :deep(.gt-camp-row-ads){padding-left:14px;padding-right:14px;}
}

/* ── Zoom de fonte (controle flutuante A−/A+ que _gtFontScale cria — legacy
   L1703-1707 + variante dark L1378-1381; cada tela que usa zoom traz sua
   própria cópia, mesmo padrão de tela-de-noticias.vue) ── */
.tela-gestao-trafego :deep(.zoomctl){position:fixed;right:20px;bottom:calc(env(safe-area-inset-bottom,0px) + 72px);z-index:9997;display:inline-flex;align-items:center;gap:2px;background:#ffffff;border:1px solid rgba(13,13,13,.14);border-radius:999px;box-shadow:0 8px 24px rgba(0,0,0,.18);padding:4px;}
.tela-gestao-trafego :deep(.zoomctl button){width:34px;height:34px;border:none;background:none;border-radius:50%;font-family:var(--fonte-principal);font-size:max(9px, calc(14px * var(--escala-texto, 1)));font-weight:700;color:#1a1a1a;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .15s;}
.tela-gestao-trafego :deep(.zoomctl button:hover){background:#f0ece4;}
.tela-gestao-trafego :deep(.zoomctl-val){font-family:var(--fonte-principal);font-size:max(9px, calc(11px * var(--escala-texto, 1)));font-weight:600;color:#6b6258;min-width:40px;text-align:center;cursor:pointer;user-select:none;font-variant-numeric:tabular-nums;}
/* O tema fica em `safe-area + 20px` com 42px de altura (termina em +62); o zoom
   precisa começar ACIMA disso. Sem a safe-area aqui os dois se encavalavam em
   aparelho com barra de gestos (achado do dono, 2026-07-29). */
@media(max-width:560px){.tela-gestao-trafego :deep(.zoomctl){right:14px;bottom:calc(env(safe-area-inset-bottom,0px) + 70px);}}
[data-theme="dark"] .tela-gestao-trafego :deep(.zoomctl){background:#211d16;border-color:rgba(255,255,255,.2);}
[data-theme="dark"] .tela-gestao-trafego :deep(.zoomctl button){color:#ece7dc;}
[data-theme="dark"] .tela-gestao-trafego :deep(.zoomctl button:hover){background:#2c2719;}
[data-theme="dark"] .tela-gestao-trafego :deep(.zoomctl-val){color:#9a9285;}

/* ── RESPONSIVE: topbar/clock (compartilhado com Gestão à Vista/Análise de
     Campanhas — cada tela traz sua cópia; ver legacy L645-662 e L694-696) ── */
@media(max-width:1024px){
  .tela-gestao-trafego :deep(.gv-topbar){flex-wrap:wrap;padding:8px 14px;gap:6px;}
  .tela-gestao-trafego :deep(.gv-clock-wrap){display:none;}
}
@media(max-width:640px){
  .tela-gestao-trafego{--gt-fs:1 !important;}   /* celular: fonte 100%. !important p/ vencer o inline que _gtFontScale grava. */
  /* Topbar do celular: LINHA 1 = marca (esquerda) + KPIs + conta (direita); LINHA 2 = filtros que rolam. */
  .tela-gestao-trafego :deep(.gv-topbar){flex-wrap:wrap;align-items:center;padding:8px 12px;gap:8px;}
  .tela-gestao-trafego :deep(.gv-topbar-brand){order:0;flex:1 1 auto;min-width:0;gap:8px;}
  .tela-gestao-trafego :deep(.gv-brand-tag){display:none;}
  .tela-gestao-trafego :deep(.gt-auto-btn){order:1;flex-shrink:0;}
  .tela-gestao-trafego :deep(#gt-account-picker){order:2;flex-shrink:0;}
  /* filtros de período: faixa própria (linha 2) que ROLA na horizontal — nunca quebram em 3 linhas */
  .tela-gestao-trafego :deep(.gv-period-btns){order:3;width:100%;flex-wrap:nowrap;overflow-x:auto;-webkit-overflow-scrolling:touch;gap:6px;padding-bottom:2px;}
  .tela-gestao-trafego :deep(.gv-pbtn){font-size:max(9px, calc(10px * var(--escala-texto, 1)));padding:5px 10px;border-radius:6px;flex-shrink:0;white-space:nowrap;}
  .tela-gestao-trafego :deep(.gv-clock-wrap),.tela-gestao-trafego :deep(.gv-update-status){display:none;}
  /* CORPO DOS CARDS no celular: botões QUEBRAM o texto (não estouram) + busca ocupa a largura */
  .tela-gestao-trafego :deep(.gt-act-btn){white-space:normal;max-width:100%;height:auto;text-align:center;}
  .tela-gestao-trafego :deep(.gt-camp-hdr input){width:100% !important;flex:1 1 100%;box-sizing:border-box;}
  .tela-gestao-trafego :deep(.gt-action-row){width:100%;}
  .tela-gestao-trafego :deep(.gt-action-row .gt-act-btn){flex:1 1 auto;}
  /* nada dentro do card pode empurrar a largura pra fora */
  .tela-gestao-trafego :deep(.gt-camp-inner),.tela-gestao-trafego :deep(.gt-camp-row){max-width:100%;overflow-x:clip;}
  /* Conjuntos no celular: cabeçalho quebra em 2 linhas em vez de estourar a tela */
  .tela-gestao-trafego :deep(.gt-camp-row-ads){padding:0 10px 12px 10px;}
  .tela-gestao-trafego :deep(.gt-set-card){margin-left:0;max-width:100%;overflow-x:clip;}
  .tela-gestao-trafego :deep(.gt-set-top){flex-wrap:wrap;gap:6px;}
  .tela-gestao-trafego :deep(.gt-set-nm){flex:1 1 100%;order:3;white-space:normal;}
  .tela-gestao-trafego :deep(.gt-set-exp){order:4;margin-left:auto;}
  .tela-gestao-trafego :deep(.gt-ad-card){margin-left:10px;}
  /* No estreito a árvore não cabe: some com as DUAS peças da guia (o L do anúncio
     e o trilho do conjunto). Esconder só uma deixaria a linha vertical solta. */
  .tela-gestao-trafego :deep(.gt-ad-card::before){display:none;}
  .tela-gestao-trafego :deep(.gt-set-pane)::before{display:none;}
  .tela-gestao-trafego :deep(.gt-collapse-all){flex:1 1 auto;}
  .tela-gestao-trafego :deep(.gt-be-box){flex:1 1 100%;}
  .tela-gestao-trafego :deep(.gt-be-box input){flex:1 1 auto;width:auto;min-width:0;}
}
@media(max-width:480px){
  /* SEM inverter a ordem da marca (o order:1 antigo jogava a marca pro fim = bug) */
  .tela-gestao-trafego :deep(.gv-topbar){padding:8px 12px;gap:8px;}
  .tela-gestao-trafego :deep(.gv-topbar-brand){gap:8px;}
}
/* FAIXA DE CONTROLES — ver o comentario no template. */
.tela-gestao-trafego :deep(.gv-controles){display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap;padding:0;background:transparent;}  /* mora DENTRO da barra: fundo, borda de baixo e respiro lateral sao dela */
@media(max-width:640px){.tela-gestao-trafego :deep(.gv-controles){padding:8px 12px;flex-direction:column;align-items:stretch;gap:8px;}}
</style>
