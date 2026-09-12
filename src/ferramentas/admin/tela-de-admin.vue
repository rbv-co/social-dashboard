<template>
  <!-- Porte fiel de #admin-screen (legacy/index.html L2776-2923), VERBATIM,
       mesmo padrão de Gestão de Tráfego/Gestão à Vista/Análise de Campanhas/
       Redes Sociais: raiz vira .tela-admin (sem display:none — quem controla
       a visibilidade agora é o vue-router). Único onclick trocado por
       binding Vue: o botão "Central" (Voltar) — closeAdmin vira @click (a
       função por trás dele agora navega pelo router em vez de fazer
       display:none + showHome()). Os demais onclick="loadAdminSection(...)"
       ficam como STRING literal (igual ao legado) — são atributos HTML
       nativos, avaliados no escopo global; por isso o cluster de funções que
       eles chamam é exposto em window mais abaixo.
       O MODAL DE PERMISSÕES (#perm-modal-overlay, legacy L11966-11979) é, no
       legado, um <div> irmão solto no <body>, longe de #admin-screen (fica
       perto do menu do usuário global). Foi trazido para DENTRO da raiz deste
       componente — mesma técnica já usada nos modais da Gestão de Tráfego e
       no tooltip/modal de campanhas da Redes Sociais: é position:fixed, então
       o lugar dele na árvore do DOM não muda o layout visual, e ficar dentro
       da árvore do componente é o que permite ao CSS :deep() (scoped)
       alcançá-lo. -->
  <div class="tela-admin">
    <barra-de-topo voltar="Central" titulo="Administração" @voltar="closeAdmin" />
    <div class="admin-layout">
      <nav class="admin-sidebar">
        <div class="admin-nav-group-label">Gestão</div>
        <div class="admin-nav-item active" data-section="users" onclick="loadAdminSection('users')"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg><span>Usuários</span></div>
        <div class="admin-nav-item" data-section="accounts" onclick="loadAdminSection('accounts')"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg><span>Contas</span></div>
        <div class="admin-nav-item" data-section="requests" onclick="loadAdminSection('requests')"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg><span>Solicitações</span></div>
        <div class="admin-nav-group-label">Vendas</div>
        <div class="admin-nav-item" data-section="metas" onclick="loadAdminSection('metas')"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg><span>Metas</span></div>
        <div class="admin-nav-group-label">Plataforma</div>
        <div class="admin-nav-item" data-section="data" onclick="loadAdminSection('data')"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg><span>Dados</span></div>
      </nav>
      <div class="admin-content">
        <!-- USUÁRIOS -->
        <div class="admin-section active" id="admin-section-users">
          <div class="admin-section-title">Usuários &amp; Acessos</div>
          <div class="admin-section-sub">Gerencie quem tem acesso à Central de Inteligência</div>
          <div id="admin-stats-users" class="admin-stats"></div>
          <span class="sg-label">Convidar novo usuário</span>
          <div class="sg" style="padding:16px 20px;">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px 16px;">
              <div>
                <label class="admin-form-label" for="adm-name">Nome</label>
                <input type="text" id="adm-name" class="admin-form-input" placeholder="Nome completo" style="width:100%;box-sizing:border-box;">
              </div>
              <div>
                <label class="admin-form-label" for="adm-email">Email</label>
                <input type="email" id="adm-email" class="admin-form-input" placeholder="email@exemplo.com" style="width:100%;box-sizing:border-box;">
              </div>
              <div>
                <label class="admin-form-label" for="adm-pass">Senha inicial <span style="font-weight:400">(opcional)</span></label>
                <input type="password" id="adm-pass" class="admin-form-input" placeholder="Deixe vazio p/ enviar convite" style="width:100%;box-sizing:border-box;">
              </div>
              <div>
                <label class="admin-form-label" for="adm-role">Perfil de acesso</label>
                <select id="adm-role" class="admin-form-input" style="width:100%;box-sizing:border-box;cursor:pointer;"><option value="viewer">Visualizador</option><option value="admin">Administrador</option></select>
              </div>
              <!-- Task 5 (D7, segunda metade): a pessoa nova pode começar com o
                   acesso de um perfil já salvo. "Sem nada" é a primeira opção e
                   a padrão — permissão nasce desmarcada é regra do projeto, e um
                   seletor que já viesse com perfil escolhido concederia acesso
                   por omissão, que é exatamente o que a regra existe pra impedir.
                   Opções além da primeira são preenchidas por loadAdminUsers. -->
              <div style="grid-column:1 / -1">
                <label class="admin-form-label" for="adm-perfil">Começar com o acesso de</label>
                <select id="adm-perfil" class="admin-form-input" style="width:100%;box-sizing:border-box;cursor:pointer;">
                  <option value="">Sem nada — marco uma a uma</option>
                </select>
              </div>
            </div>
            <div style="font-family:var(--fonte-principal);font-size:max(9px, calc(11px * var(--escala-texto, 1)));color:var(--muted);margin-top:12px;display:flex;align-items:center;gap:6px;">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;opacity:.6"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              Se a senha for deixada em branco, um link de primeiro acesso será enviado para o email.
            </div>
            <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:14px;padding-top:14px;border-top:1px solid var(--border)">
              <div id="adm-invite-msg" style="font-family:var(--fonte-principal);font-size:max(9px, calc(12px * var(--escala-texto, 1)));color:var(--muted);flex:1"></div>
              <div style="display:flex;gap:8px;flex-shrink:0">
                <button class="btn" onclick="adminInviteUser('invite')">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                  Enviar convite
                </button>
                <button class="btn btn-principal" onclick="adminInviteUser('create')">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
                  Criar com senha
                </button>
              </div>
            </div>
          </div>
          <!-- Times de venda mora aqui dentro de Usuários (Task 5): quem cria
               conta e quem organiza times é a mesma pessoa fazendo a mesma
               tarefa de gestão de acesso, então a ordem virou criar → times →
               pessoas, do jeito que o dono aprovou. -->
          <!-- CANAIS DE VENDA — o grupo (atacado/varejo) mora AQUI, no canal, e
               não na ficha do time: dos 14 canais do Bling só 3 têm time, e os
               11 sem time aparecem no seletor das dashboards do mesmo jeito. O
               time é atacado ou varejo pelo canal a que está amarrado. -->
          <span class="sg-label">Canais de venda</span>
          <div class="admin-section-sub">Cada grupo — <b>Atacado</b>, <b>Varejo</b>, ou outro que você criar — reúne os canais do Bling que são dele. Abra o grupo em <b>Escolher canais</b> e marque quais são; um canal só pode estar em um grupo. É esse grupo que separa o seletor das dashboards de venda e os times na lista de usuários. Canal que não está em grupo nenhum continua aparecendo, no fim.</div>
          <div id="admin-canais-body"><div style="color:var(--muted);font-size:max(9px, calc(12px * var(--escala-texto, 1)))">Carregando...</div></div>

          <span class="sg-label">Times de venda</span>
          <div class="admin-section-sub">Lojas, canais e setores — e quem trabalha em cada um. É por aqui que uma loja nova entra no sistema. Em <b>Quem trabalha aqui</b> você vê e muda, por pessoa, o que ela enxerga de canal de venda e das outras ferramentas, libera o estoque e troca a senha dela.</div>
          <div id="admin-equipes-body"><div style="color:var(--muted);font-size:max(9px, calc(12px * var(--escala-texto, 1)))">Carregando...</div></div>
          <!-- Quem está num time de venda NÃO aparece aqui: a pessoa mora
               dentro do card da loja dela, logo acima. O rótulo diz isso, senão
               procurar a vendedora nesta lista e não achar parece defeito. -->
          <span class="sg-label">Sem time de venda</span>
          <div class="admin-section-sub">Quem está num time aparece dentro do card da loja dele, ali em cima.</div>
          <div id="admin-user-list"></div>
        </div>
        <!-- CONTAS -->
        <div class="admin-section" id="admin-section-accounts">
          <div class="admin-section-title">Contas Conectadas</div>
          <div class="admin-section-sub">Perfis do Instagram vinculados à plataforma</div>
          <div id="admin-accounts-list"></div>
        </div>
        <!-- DADOS -->
        <div class="admin-section" id="admin-section-data">
          <div class="admin-section-title">Dados &amp; Sincronização</div>
          <div class="admin-section-sub">Saúde do banco de dados e coleta de dados</div>
          <div id="admin-data-stats" class="admin-stats"></div>
          <span class="sg-label">Última coleta por conta</span>
          <div class="sg" id="admin-data-sync"></div>
          <span class="sg-label">Ações de manutenção</span>
          <div class="sg">
            <div class="sr clickable" style="justify-content:space-between" onclick="adminShowRefetchInfo()"><div class="sr-main"><div class="sr-label">Atualizar fotos de perfil</div><div class="sr-sub">Rebusca as fotos dos perfis via Meta API</div></div><span style="font-size:max(16px, calc(18px * var(--escala-texto, 1)))">↻</span></div>
            <div class="sr clickable" style="justify-content:space-between" onclick="adminShowColetorInfo()"><div class="sr-main"><div class="sr-label">Rodar coletor de dados</div><div class="sr-sub">Coleta métricas do Instagram para todos os perfis</div></div><span style="font-size:max(16px, calc(18px * var(--escala-texto, 1)))">⚡</span></div>
          </div>
          <div id="admin-action-info" style="display:none;margin-top:12px"></div>
        </div>
        <!-- SAÚDE: saiu da barra (Task 5), mas a tela de detalhe continua aqui —
             a faixa de aviso em Dados abre esta seção por onclick, então
             loadAdminSaude() precisa ter onde desenhar o detalhamento. -->
        <div class="admin-section" id="admin-section-saude">
          <div class="admin-section-title">Saúde dos dados</div>
          <div class="admin-section-sub">Verificação automática diária (23:30) — frescor, consistência e anomalias das métricas de todos os perfis.</div>
          <div id="admin-saude-body"><div style="color:var(--muted);font-size:max(9px, calc(12px * var(--escala-texto, 1)))">Carregando...</div></div>
        </div>
        <div class="admin-section" id="admin-section-metas">
          <div class="admin-section-title">Metas de Vendas</div>
          <div class="admin-section-sub">Configure as metas mensais por canal e loja</div>
          <div id="admin-metas-body"><div style="color:var(--muted);font-size:max(9px, calc(12px * var(--escala-texto, 1)))">Carregando...</div></div>
        </div>
        <!-- SOLICITAÇÕES -->
        <div class="admin-section" id="admin-section-requests">
          <div class="admin-section-title">Solicitações de Acesso</div>
          <div class="admin-section-sub">Usuários que solicitaram acesso à plataforma</div>
          <div id="admin-requests-body"><div style="color:var(--muted);font-size:max(9px, calc(12px * var(--escala-texto, 1)))">Carregando...</div></div>
        </div>
      </div>
    </div>

    <!-- ── PERMISSIONS MODAL (legacy L11966-11979 — irmão solto no body, trazido
         pra dentro da raiz aqui pelo mesmo motivo dos modais de GT/Redes Sociais) ── -->
    <div id="perm-modal-overlay" class="perm-overlay" onclick="if(event.target===this)closePermModal()">
      <div class="perm-modal">
        <div class="perm-modal-hdr">
          <div class="perm-modal-title">Permissões</div>
          <div class="perm-modal-user" id="perm-modal-user"></div>
        </div>
        <div class="perm-modal-body" id="perm-modal-body"></div>
        <div class="perm-modal-ftr">
          <button class="btn" onclick="closePermModal()">Cancelar</button>
          <button class="btn btn-principal" id="perm-save-btn" onclick="savePermissions()">Salvar</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, onUnmounted } from 'vue'
import BarraDeTopo from '../../compartilhado/barra-de-topo.vue'
import { useRouter } from 'vue-router'
import { sbClient, SUPABASE_URL, SUPABASE_ANON_KEY } from '../../compartilhado/conectar-no-banco-de-dados.js'
import { estado, PERMISSION_TREE, RECURSOS } from '../../compartilhado/controle-de-login-e-usuario.js'
import { agruparRecursos, contarAcoes, estadoDaSelecao, marcarTudo } from './agrupar-permissoes.js'
import { derivarFeatures } from '../../compartilhado/derivar-features.js'
// A mensagem de acesso pronta pra colar no WhatsApp. Mora fora da tela
// porque é a MESMA em todo lugar que entrega senha — e porque texto solto
// dentro de uma tela de 3.000 linhas ninguém acha pra corrigir.
import { recadoDeAcesso } from '../../compartilhado/recado-de-acesso.js'
import { linhaDeContato, partesDeContato } from './linha-de-contato.js'
// A sobreposição perfil × exceção (D9) e QUEM MUDA de acesso se um perfil for
// regravado (D11). Puro e testado à parte (perfis-de-acesso.test.mjs): aqui só
// se busca no banco, se mostra e se grava.
// `excecaoAoSalvar` é o que faz o D9 valer no CAMINHO REAL: sem ele, dar uma
// ferramenta à mão a quem está num perfil não ficava registrado em lugar nenhum,
// e a próxima regravação do perfil apagava o que alguém concedeu de propósito.
import { acessoEfetivo, excecaoAoSalvar, impactoDaMudanca } from './perfis-de-acesso.js'
// A escada de niveis (Sem acesso / Ver / Mexer / Tudo) que substitui a matriz
// de caixinhas no editor de permissoes: uma escolha por ferramenta, em vez de
// ate 5 caixinhas por linha das quais mais da metade nunca existiu de verdade.
import { degrausDoRecurso, degrauDoConjunto, acoesDoDegrau } from './niveis-de-permissao.js'
// A frase sempre visível (D3) e o selo de dinheiro (D4) do editor de
// permissões: o que cada nível FAZ naquela ferramenta, e quais ferramentas
// gastam verba de verdade.
import { oQueONivelFaz } from './o-que-o-nivel-faz.js'
import { mexeEmDinheiro, SELO_DINHEIRO, EMOJI_DINHEIRO } from './consequencia-do-recurso.js'
import { resumoDoAcesso } from './resumo-do-acesso.js'
// `agruparTimesPorGrupo` e `normalizarGrupo` continuam vindo daqui: os cards de
// TIME ainda agrupam pelo texto. Trocá-los para `grupo_id` é a fatia seguinte, e
// tem prova própria a fazer — o texto e o apontamento estão de acordo desde que
// o gatilho passou a espelhar nos dois sentidos (27/08).
// `gruposExistentes`, `agruparCanais` e `contarSemGrupo` saíram: a seção Canais
// de venda deixou de deduzir o grupo do texto e passou a ler o cadastro.
import { agruparTimesPorGrupo, timePorCanal, normalizarGrupo } from '../../compartilhado/grupo-do-canal.js'
import { agruparCanaisPorCadastro, podeApagarGrupo, nomeDeGrupoAceito } from '../../compartilhado/cadastro-de-grupos.js'
// Quais notificações existem e qual o padrão de cada uma. A lista mora junto da
// Edge que envia (supabase/functions/_shared) pra não haver duas verdades sobre
// quem recebe o quê — a tela LÊ dela em vez de repetir os nomes.
import { TIPOS_DE_NOTIFICACAO, querReceber } from '../../../supabase/functions/_shared/notificacoes.js'
import { adminToast } from '../../compartilhado/avisos.js'
import { dataDigitadaParaISO, dataISOparaBR } from '../../compartilhado/canal-fechado.js'
import { gerarSenhaForte } from './senha.js'
import { sb } from '../../compartilhado/buscar-e-salvar-dados.js'
// As REGRAS dos times (quem administra, quem concede o quê, o que falta em cada
// um) moram em equipes.js, puro e testado. Aqui só se desenha e se grava.
import {
  PAPEIS, acharPapel, podeAdministrarTime, papeisQuePossoConceder, podeRemover,
  validarTime, canaisLivres, linhaDoTime, ordenarTimes,
  veOEstoque, podeLiberarEstoque,
} from './equipes.js'
// O que cada pessoa do time enxerga de VENDA, em uma frase — e quem pode mexer
// na chave que decide isso (`profiles.escopo_por_equipe`). Puro e testado à
// parte: a frase é o que o dono lê antes de clicar, e frase errada aqui vira
// decisão errada lá.
import {
  oQueVeDeVendas, podeMudarEscopo, avisoDaMudancaDeEscopo,
} from './acesso-do-membro.js'
// Puxar as vendedoras das VENDAS: agrupa duplicadas, separa balcão de pessoa e
// deduz a loja. Regras puras, testadas contra os 22 cadastros reais do Bling.
import {
  agruparVendedores, lojaDaVendedora, comoDizerALoja, viraConta, emailSugerido,
} from './vendedoras.js'
// Separar as pessoas por marca, local ou setor: a gaveta escolhida e o "sem
// ___" que fecha a lista moram aqui, puro e testado — a tela só desenha.
import { agruparPor, DIMENSOES } from './lotacao.js'
import { ESTADOS, contarEstados, aplicarEstados } from '../../compartilhado/estados-da-pessoa.js'
// Decide se um login e um cadastro de colaborador são a mesma pessoa. Puro e
// testado à parte: um casamento errado dá a lotação e o histórico de alguém
// para outra pessoa, ou para uma caixa de e-mail compartilhada.
import { estadoDoVinculo } from './vinculo-de-cadastro.js'
// A desconfiança por NOME. `estadoDoVinculo` decide o vínculo, e decide por
// e-mail — sinal forte. Este aqui só levanta suspeita, e é sinal fraco: ele
// nunca liga nada sozinho, só muda o que a tela oferece primeiro.
import { parecidos, fraseDoParecido } from '../../compartilhado/ja-existe-alguem-parecido.js'
// As três naturezas dentro da pessoa — o que ela abre, se o celular dela toca e
// a qual colaborador o login pertence. A ordem e o texto do aviso do elo
// faltante são puros e testados; a tela só desenha.
import { abasDaPessoa } from './abas-da-pessoa.js'
import { paraIlike } from './escapar-curinga-ilike.js'
// O irmão do de cima, para `coluna=eq.<valor>`: nome de perfil é texto que
// gente digita, e `,` `.` `(` `)` são gramática do filtro do PostgREST.
import { paraEq } from './valor-de-filtro-postgrest.js'
// Trava a rolagem do fundo enquanto a ficha esta aberta. Peca compartilhada,
// que tambem compensa a barra de rolagem e resolve o efeito elastico do iOS.
// O editor de permissoes (#perm-modal-overlay) NAO precisa de chamada aqui: ele
// ja e coberto pelo observador de modais legados, ligado na moldura. Chamar nos
// dois lugares travaria duas vezes e destravaria uma, prendendo a pagina.
import { abrirModal, fecharModal } from '../../compartilhado/travar-rolagem-de-fundo.js'

const router = useRouter()

const logoClaroUrl = '/midia/LOGOTIPOBRENOPRETO.png'
const logoEscuroUrl = '/midia/LOGOTIPOBRENOBRANCO.png'

// ==========================================================================
// PORTE VERBATIM do módulo Admin (legacy/index.html — bloco "/* ── ADMIN
// MODULE ── */" e vizinhos, funções espalhadas entre L4373-5213), menos
// openAdmin/closeAdmin, que viraram onMounted (gate de acesso + primeira
// seção) / closeAdmin (router.push) abaixo.
//
// ATENÇÃO — este é o painel mais sensível da plataforma. Ele CRIA e EXCLUI
// CONTAS DE USUÁRIO DE VERDADE (adminInviteUser → edge function
// "invite-user"; exclusão → mesma edge function com {deleteUserId}, dentro de
// loadAdminUsers) e muda PERMISSÕES REAIS que controlam o que cada pessoa
// pode acessar (savePermissions → PATCH em profiles.permissions + features,
// os dois juntos — ver o comentário em savePermissions; handleRequest
// → aprova/nega solicitação de acesso). Erros aqui têm consequência real
// para pessoas reais. O único confirm() que existia no legado para essas
// ações — o de excluir usuário, dentro de loadAdminUsers — foi preservado
// INTACTO, mesma mensagem, mesmo lugar (ver auditoria de mutações no
// relatório .superpowers/sdd/admin-port-report.md). invite (criar/convidar),
// savePermissions e handleRequest NÃO tinham confirm() no legado — nenhum
// foi adicionado aqui.
//
// Dependências externas resolvidas:
//   - sbClient, SUPABASE_URL, SUPABASE_ANON_KEY → import (conectar-no-banco-de-dados.js)
//   - estado                                     → import (controle-de-login-e-usuario.js) —
//     substitui currentUserRole/currentUserFeatures/currentUserId/currentSession
//     (ver lista de renomeações abaixo).
//   - PERMISSION_TREE                            → import (controle-de-login-e-usuario.js) —
//     já existia lá, portada verbatim (legacy L4525) para dar suporte ao
//     futuro painel de admin; conferida por diff contra o legado — idêntica,
//     mesmas chaves/labels/filhos. NÃO foi redefinida aqui.
//   - adminToast                                 → import (avisos.js) — a
//     versão local do legado (que criava seu próprio toast <div>, legacy
//     L4377-4378) foi DESCARTADA em favor desta, mesmo padrão dos outros
//     portes.
//   - sb                                         → import (buscar-e-salvar-dados.js) —
//     idêntico ao sb() do legado (legacy L3277), usado por loadAdminSaude/
//     loadAdminAccounts/loadAdminAppearance/loadAdminData/updateSaudeBadge.
//
// Copiados localmente (self-contidos, sem lugar compartilhado no Vue ainda —
// mesmo padrão de "cada tela traz sua cópia" já usado nos outros portes):
//   mkEl, adTok (currentSession→estado.currentSession), adFetch, escHtml,
//   fmtN/fmtR (legacy L3393-3394, idênticos aos já copiados em
//   tela-de-redes-sociais.vue), PROFILE_THEMES (legacy L3302, idêntico ao já
//   copiado em tela-de-redes-sociais.vue — cada tela guarda sua própria
//   cópia mutável), SUPERADMIN_EMAILS/SUPERADMIN_EMAIL (legacy L4540-4541 —
//   não há export equivalente em controle-de-login-e-usuario.js), e o trio de
//   upload de avatar _avCb/_avInput/_uploadAvatar (legacy L5473-5482).
//
// Renomeações aplicadas (verbatim fora isso):
//   - currentSession → estado.currentSession (adTok; dentro de loadAdminSaude,
//     no helper `post` que dispara coletar-dados/auditar-dados).
//   - currentUserId → estado.userId (loadAdminUsers, no callback de troca de
//     avatar: `if(u.id===estado.userId)_setGubAvatar(url)`).
//   - currentUserRole/currentUserFeatures: usados apenas dentro de
//     _applySubFeatures (ver SKIP abaixo) e do antigo openAdmin (substituído
//     pelo gate do onMounted) — não sobraram ocorrências para renomear no
//     corpo copiado.
//
// Duas adaptações além das renomeações (exigidas pela arquitetura de SPA por
// rotas, onde só existe UMA tela montada por vez — documentadas aqui em vez
// de escondidas):
//   1. openAdmin() copiava o texto de #home-user-email (outra "tela" do
//      monólito) para #admin-topbar-user via getElementById. Como a tela
//      Início não fica montada ao mesmo tempo que o Admin, isso quebraria
//      (elemento não existe). Trocado por uma leitura direta de
//      estado.user?.email no <template> (mesmo dado, sem depender do DOM de
//      outra tela).
//   2. loadAdminUsers calculava `currentEmail` do mesmo jeito
//      (document.getElementById('home-user-email').textContent.trim()) para
//      decidir isSelf/isSuperAdmin por linha da lista de usuários — isso
//      lançaria TypeError (elemento null) e quebraria a lista inteira.
//      Trocado por `estado.user?.email || ''` — mesmo valor, sem cross-tela.
//
// SKIPS (não copiados, fora de escopo):
//   - _applySubFeatures (legacy L4595-4607): gate visual de cards de OUTRAS
//     telas (submenu de Vendas/Meta Ads), não faz parte de #admin-screen.
//   - _loadAdminPermissions_removed (legacy L5111-5208): função morta, o
//     próprio nome ("_removed") e o fato de nunca ser chamada em lugar
//     nenhum (conferido por grep) confirmam que foi substituída por
//     openPermModal/#perm-modal — depende até de TOOL_REGISTRY, que não
//     existe em lugar nenhum do arquivo.
//   - rpcCall (legacy L4407-4410): definida mas nunca chamada em lugar
//     nenhum do arquivo (conferido por grep) — código morto, não copiado.
//
// CONCERN conhecida e deliberadamente NÃO corrigida (mantida verbatim por
// instrução explícita): dentro de loadAdminUsers, ao trocar o próprio avatar
// (u.id===estado.userId), o código chama `_setGubAvatar(url)` — função do
// "botão global do usuário" (feature ainda não portada para o Vue). Essa
// chamada vai estourar ReferenceError em runtime; como ela roda dentro do
// callback passado a _triggerAvatarUpload, que por sua vez roda dentro do
// try/catch de _avCb, o erro é engolido e reaparece como um toast de ERRO
// ("Erro ao enviar: _setGubAvatar is not defined") mesmo a foto tendo sido
// trocada com sucesso na tela (a troca visual do <img> já aconteceu antes da
// linha que quebra). Ou seja: o upload funciona, mas o usuário vê uma
// mensagem de erro ao trocar a PRÓPRIA foto (trocar a foto de outra pessoa
// não aciona esse caminho). Ver relatório para mais detalhes.
//
// Nada foi reescrito para template reativo — o board inteiro (lista de
// usuários, contas, aparência, dados, sistema, saúde, metas, solicitações,
// modal de permissões) segue montado via getElementById/createElement/
// innerHTML, exatamente como a produção atual. Por isso o cluster de funções
// chamadas por onclick="..."/onchange="..." literal (no <template> acima e
// dentro das strings de innerHTML geradas por loadAdminMetas) é exposto em
// window no fim deste bloco.
// ==========================================================================

/* ── Helpers copiados do legado (self-contidos) ── */
function mkEl(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e }
function adTok() { return estado.currentSession?.access_token || SUPABASE_ANON_KEY }
function adFetch(path, opts = {}) { return fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...opts, headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${adTok()}`, 'Content-Type': 'application/json', ...(opts.headers || {}) } }) }
function escHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') }
function fmtN(n) { n = Number(n) || 0; const a = Math.abs(n); if (a >= 1e6) return (n / 1e6).toFixed(1).replace('.', ',') + ' mi'; if (a >= 1e3) return (n / 1e3).toFixed(1).replace('.', ',') + ' mil'; return String(n) }
function fmtR(v) { const p = v.toFixed(2).split('.'); return 'R$ ' + p[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + p[1] }

/* ── Temas por conta (legacy L3302-3309, idêntico ao já copiado em
   tela-de-redes-sociais.vue — cada tela guarda sua própria cópia) ── */
const PROFILE_THEMES = {
  'Raíssa Herculano': { accent: '#BE185D', light: 'rgba(190,24,93,0.08)', mid: 'rgba(190,24,93,0.30)' },
  'Breno Vale': { accent: 'var(--accent)', light: 'rgba(29,78,216,0.08)', mid: 'rgba(29,78,216,0.30)' },
  'Mantova Móveis': { accent: 'var(--accent)', light: 'rgba(29,78,216,0.08)', mid: 'rgba(29,78,216,0.30)' },
  'Vessel': { accent: 'var(--green)', light: 'rgba(22,101,52,0.08)', mid: 'rgba(22,101,52,0.30)' },
  'Motoeasy': { accent: 'var(--red)', light: 'rgba(155,28,28,0.08)', mid: 'rgba(155,28,28,0.30)' },
}

/* ── Superadmin (legacy L4540-4541 — sem export equivalente ainda) ── */
const SUPERADMIN_EMAILS = ['erick@rbvcompany.com', 'gabriel.gertrudes@rbvcompany.com']
const SUPERADMIN_EMAIL = SUPERADMIN_EMAILS[0]

/* ── AVATAR UPLOAD (legacy L5473-5482, verbatim) ── */
let _avCb = null
const _avInput = (() => { const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/jpeg,image/png,image/webp,image/gif'; i.style.display = 'none'; document.body.appendChild(i); i.addEventListener('change', async () => { const f = i.files?.[0]; if (f && _avCb) _avCb(f); i.value = '' }); return i })()
async function _uploadAvatar(userId, file) {
  const path = userId
  const { error } = await sbClient.storage.from('avatars').upload(path, file, { upsert: true, contentType: file.type })
  if (error) throw error
  const { data: { publicUrl } } = sbClient.storage.from('avatars').getPublicUrl(path)
  await adFetch('profiles?id=eq.' + userId, { method: 'PATCH', body: JSON.stringify({ avatar_url: publicUrl }) })
  return publicUrl
}
function _triggerAvatarUpload(userId, onDone) {
  if (!userId) return
  _avCb = async (file) => {
    try { const url = await _uploadAvatar(userId, file); onDone(url) }
    catch (e) { adminToast('Erro ao enviar: ' + e.message) }
  }
  _avInput.click()
}

/* ── Navegação entre seções (legacy L4390-4405, verbatim) ── */
function loadAdminSection(name) {
  document.querySelectorAll('.admin-nav-item').forEach(el => el.classList.toggle('active', el.dataset.section === name))
  document.querySelectorAll('.admin-section').forEach(el => el.classList.remove('active'))
  const sec = document.getElementById('admin-section-' + name); if (sec) sec.classList.add('active')
  // 'saude' e 'equipes' saíram deste mapa na Task 5: Saúde não tem mais item na
  // barra (vive só na faixa de Dados, aberta pelo onclick montado em
  // updateSaudeBadge) e Times de venda carrega junto com Usuários, dentro de
  // loadAdminUsers.
  const carregadores = { users: loadAdminUsers, accounts: loadAdminAccounts, data: loadAdminData, metas: loadAdminMetas, requests: loadAdminRequests }
  carregadores[name]?.()
  updateSaudeBadge()
}

// O SINAL DA SAÚDE NÃO MORRE COM A ABA.
//
// A aba saiu da barra a pedido do dono, mas ela estava CERTA: as 13 falhas por
// dia que ela acusava eram o bug das curtidas zeradas (commit 9943dda), e ela
// era o único lugar que avisava. Apagar o aviso junto com a tela repetiria o
// silêncio que deixou o bug invisível por semanas.
//
// Some sozinha quando não há falha: aviso que fica sempre aceso vira paisagem.
async function updateSaudeBadge() {
  const alvo = document.getElementById('admin-section-data'); if (!alvo) return
  const anterior = alvo.querySelector('.saude-faixa'); if (anterior) anterior.remove()
  // USE `sbClient`, NÃO o `sb()` desta tela (mesmo motivo do comentário em
  // loadAdminUsers): `sb()` cai pra chave anônima quando `estado.currentSession`
  // ainda não hidratou, e `data_integrity_checks` só abre `to authenticated` —
  // o PostgREST responde 200 com lista vazia, sem erro, e a faixa simplesmente
  // não desenha. É a mesma classe de bug que apagou o aviso das curtidas
  // zeradas por semanas (comentário acima). Erro vai pro console: entre
  // desenhar informação errada e não desenhar nada, aqui vale mais não
  // desenhar — mas silenciar a falha por completo repetiria o bug original.
  const { data: last, error: errLast } = await sbClient.from('data_integrity_checks')
    .select('checked_date').order('checked_date', { ascending: false }).limit(1)
  if (errLast) { console.error('updateSaudeBadge: falha ao ler data_integrity_checks', errLast); return }
  if (!last?.length) return
  const { data: fails, error: errFails } = await sbClient.from('data_integrity_checks')
    .select('id').eq('status', 'fail').eq('checked_date', last[0].checked_date)
  if (errFails) { console.error('updateSaudeBadge: falha ao ler falhas do dia', errFails); return }
  if (!fails?.length) return
  const faixa = document.createElement('div')
  faixa.className = 'saude-faixa'
  faixa.textContent = `A conferência de ${last[0].checked_date} achou ${fails.length} divergência(s) entre o painel e a Meta.`
  // Clicável: a aba de detalhe (#admin-section-saude) continua no template e
  // loadAdminSaude() continua existindo — só não tem mais botão na barra pra
  // chegar nela. A faixa é o novo caminho.
  faixa.style.cursor = 'pointer'
  faixa.title = 'Clique para ver o detalhamento'
  faixa.onclick = () => {
    document.querySelectorAll('.admin-nav-item').forEach(el => el.classList.remove('active'))
    document.querySelectorAll('.admin-section').forEach(el => el.classList.remove('active'))
    document.getElementById('admin-section-saude')?.classList.add('active')
    loadAdminSaude()
  }
  alvo.insertBefore(faixa, alvo.firstChild)
}

/* ── PUXAR AS VENDEDORAS DAS VENDAS ─────────────────────────────────────────
 *
 * PEDIDO DO DONO (04/08/2026): "dá para puxar pelas vendas as vendedoras
 * existentes e jogar no time de vendas e criar usuários".
 *
 * O QUE ESTA TELA NÃO FAZ: decidir sozinha. Ela agrupa, sugere loja e sugere
 * e-mail — e para. Quem confirma é quem conhece a equipe, porque os dois erros
 * possíveis aqui são caros: juntar duas pessoas dá a uma o faturamento da
 * outra, e separar a mesma pessoa em duas parte a comissão dela no meio.
 */
let _vdLista = []
let _vdEscolhas = {}     // nome -> { criar, email, equipe_id }
let _vdSenhas = []       // as senhas geradas, mostradas UMA vez
// Com que acesso as contas puxadas das vendas NASCEM. Vazio é o padrão e é
// regra do projeto: permissão nasce desmarcada, e um seletor que já viesse
// escolhido concederia acesso por omissão — exatamente o que a regra impede.
let _vdPerfilId = ''
let _vdCarregando = false
// POR QUE A BUSCA NÃO DEU EM NADA. Sem isto, um resultado vazio devolvia a tela
// ao botão inicial — indistinguível de "não cliquei". Foi exatamente o que
// aconteceu em 05/08/2026: o botão parecia morto e não havia como saber por
// quê. `sb()` nunca estoura; ele devolve lista vazia com o motivo pendurado, e
// quem não lê esse motivo transforma falha em silêncio.
let _vdMotivoVazio = ''

async function _vdPuxar() {
  const body = document.getElementById('admin-equipes-body'); if (!body) return
  _vdCarregando = true; _vdMotivoVazio = ''; _eqDesenhar()
  try {
    // `sbClient`, e NÃO o `sb()` desta tela.
    //
    // As duas tabelas só abrem para `authenticated`. O `sb()` monta o cabeçalho
    // com `estado.currentSession?.access_token || SUPABASE_ANON_KEY` — e com a
    // chave anônima o PostgREST responde 200 com lista VAZIA, sem erro nenhum.
    // Falha que se disfarça de "não tem nada".
    //
    // O `sbClient` cuida da sessão sozinho (inclusive renovando), e é o mesmo
    // que a aba espelho do Gestor Comercial usa — aquela funcionou em produção
    // no mesmo dia em que esta não funcionou. Escolhi o que tem prova.
    const [rv, rp] = await Promise.all([
      sbClient.from('bling_vendedores').select('vendor_id,nome'),
      sbClient.from('bling_pedido_vendedor').select('vendor_id,loja_id,pedido_data').limit(5000),
    ])
    if (rv.error || rp.error) {
      _vdMotivoVazio = 'A leitura falhou: ' + ((rv.error || rp.error).message || 'motivo desconhecido')
      return
    }
    const vends = rv.data || []
    const pedidos = rp.data || []
    if (!(vends || []).length) {
      _vdMotivoVazio = 'Nenhum vendedor cadastrado no Bling chegou até aqui. '
        + 'Abra a Gestão à Vista uma vez — é ela que traz os vendedores do Bling para cá.'
      return
    }
    const porVendedor = {}
    for (const p of (pedidos || [])) {
      if (!porVendedor[p.vendor_id]) porVendedor[p.vendor_id] = []
      porVendedor[p.vendor_id].push(p)
    }
    const comContagem = (vends || []).map(v => {
      const meus = porVendedor[v.vendor_id] || []
      const datas = meus.map(x => x.pedido_data).filter(Boolean).sort()
      return { ...v, pedidos: meus.length, ultima_venda: datas[datas.length - 1] || null }
    })
    _vdLista = agruparVendedores(comContagem).map(g => {
      // Os pedidos de TODOS os ids do grupo — a Elen tem três.
      const todos = g.ids.flatMap(id => porVendedor[id] || [])
      const loja = lojaDaVendedora(todos)
      const equipe = _eqTimes.find(t => String(t.canal_loja_id) === String(loja.loja_id))
      return { ...g, loja, equipeSugerida: equipe ? equipe.id : '' }
    })
    for (const g of _vdLista) {
      if (!_vdEscolhas[g.nome]) {
        _vdEscolhas[g.nome] = {
          criar: viraConta(g),
          email: viraConta(g) ? emailSugerido(g.nome) : '',
          equipe_id: g.equipeSugerida || '',
        }
      }
    }
  } catch (e) {
    _vdMotivoVazio = String(e && e.message || e)
    adminToast('Não consegui puxar as vendedoras: ' + _vdMotivoVazio, false)
  } finally {
    _vdCarregando = false; _eqDesenhar()
  }
}

function _vdSecao() {
  if (!_vdLista.length && !_vdCarregando && !_vdSenhas.length && !_vdMotivoVazio) {
    return '<div style="border:1px dashed var(--border);border-radius:12px;padding:16px;margin-bottom:14px;">'
      + '<div style="font-weight:700;color:var(--text);margin-bottom:4px;">Puxar as vendedoras das vendas</div>'
      + '<div class="admin-section-sub" style="margin-bottom:10px;">Lê quem já vendeu no Bling, junta os cadastros repetidos e sugere a loja de cada uma. Nada é criado sem você confirmar.</div>'
      + '<button class="btn" data-vd-puxar>Puxar das vendas</button>'
      + '</div>'
  }
  if (_vdCarregando) return '<div style="color:var(--muted);font-size:max(9px, calc(12px * var(--escala-texto, 1)));margin-bottom:14px;">Lendo as vendas…</div>'

  // O MOTIVO NA TELA, e o botão de volta ao lado. Voltar em silêncio ao estado
  // inicial faz o botão parecer quebrado.
  if (_vdMotivoVazio) {
    return '<div style="border:1px solid var(--orange,#d97706);border-radius:12px;padding:16px;margin-bottom:14px;">'
      + '<div style="font-weight:700;color:var(--orange,#d97706);margin-bottom:5px;">Não deu para puxar as vendedoras</div>'
      + '<div class="admin-section-sub" style="margin-bottom:10px;">' + escHtml(_vdMotivoVazio) + '</div>'
      + '<button class="btn" data-vd-puxar>Tentar de novo</button>'
      + '</div>'
  }

  // AS SENHAS APARECEM UMA VEZ SÓ. Guardá-las para reler depois seria guardar
  // senha em texto — e não guardar obriga a anotar agora, que é o certo.
  if (_vdSenhas.length) {
    let h = '<div style="border:1px solid var(--green,#16a34a);border-radius:12px;padding:16px;margin-bottom:14px;">'
    h += '<div style="font-weight:800;color:var(--green,#16a34a);margin-bottom:4px;">Contas criadas — anote as senhas AGORA</div>'
    h += '<div class="admin-section-sub" style="margin-bottom:10px;">Esta lista não volta a aparecer. Cada uma é obrigada a trocar a senha no primeiro acesso.</div>'
    h += '<table style="width:100%;border-collapse:collapse;font-size:max(9px, calc(12px * var(--escala-texto, 1)));">'
    for (const s of _vdSenhas) {
      h += '<tr><td style="padding:5px 8px 5px 0;color:var(--text);">' + escHtml(s.nome) + '</td>'
        + '<td style="padding:5px 8px;color:var(--muted);">' + escHtml(s.email) + '</td>'
        + '<td style="padding:5px 0;font-family:var(--fonte-dados);font-weight:700;color:var(--text);">' + escHtml(s.senha) + '</td></tr>'
    }
    h += '</table>'
    h += '<button class="btn" data-vd-fechar>Já anotei</button>'
    h += '</div>'
    return h
  }

  let h = '<div style="border:1px solid var(--border);border-radius:12px;padding:16px;margin-bottom:14px;">'
  h += '<div style="font-weight:800;color:var(--text);margin-bottom:4px;">Vendedoras encontradas nas vendas</div>'
  h += '<div class="admin-section-sub" style="margin-bottom:12px;">Confira antes de criar. Quem aparece como <b>balcão</b> não é pessoa — a venda dela é real e entra no time, mas não ganha conta de acesso.</div>'
  for (const g of _vdLista) {
    const e = _vdEscolhas[g.nome] || {}
    const nomeDaLoja = (_eqCanais.find(c => String(c.loja_id) === String(g.loja.loja_id)) || {}).nome
    h += '<div style="border-bottom:1px solid var(--border);padding:9px 0;">'
    h += '<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:baseline;">'
    h += '<div><span style="font-weight:700;color:var(--text);">' + escHtml(g.nome) + '</span>'
    if (g.balcao) h += '<span style="margin-left:7px;font-size:max(9px, calc(10px * var(--escala-texto, 1)));font-weight:700;color:var(--orange,#d97706);border:1px solid var(--orange,#d97706);border-radius:999px;padding:1px 7px;">balcão</span>'
    if (g.ids.length > 1) h += '<span style="margin-left:7px;font-size:max(9px, calc(10.5px * var(--escala-texto, 1)));color:var(--green,#16a34a);">' + g.ids.length + ' cadastros juntados</span>'
    h += '</div>'
    h += '<div style="font-size:max(9px, calc(11.5px * var(--escala-texto, 1)));color:var(--muted);font-family:var(--fonte-dados);">' + g.pedidos + ' pedidos · ' + escHtml(comoDizerALoja(g.loja, nomeDaLoja)) + '</div>'
    h += '</div>'
    // O AVISO DOS PARECIDOS. A máquina não junta por conta própria quando tem
    // dúvida — ela conta a dúvida.
    if ((g.parecidos || []).length) {
      h += '<div style="font-size:max(9px, calc(11px * var(--escala-texto, 1)));color:var(--orange,#d97706);margin-top:3px;">Parecido com ' + escHtml(g.parecidos.join(', ')) + ' — se for a mesma pessoa, junte no Bling antes de criar a conta.</div>'
    }
    if (!g.balcao) {
      h += '<div style="display:flex;gap:8px;margin-top:7px;flex-wrap:wrap;align-items:center;">'
      h += '<label style="display:flex;align-items:center;gap:5px;font-size:max(9px, calc(11.5px * var(--escala-texto, 1)));color:var(--muted);cursor:pointer;">'
        + '<input type="checkbox" data-vd-criar="' + escHtml(g.nome) + '"' + (e.criar ? ' checked' : '') + '> criar conta</label>'
      h += '<input data-vd-email="' + escHtml(g.nome) + '" value="' + escHtml(e.email || '') + '" placeholder="e-mail" style="flex:1;min-width:190px;padding:6px 9px;border-radius:7px;border:1px solid var(--border);background:var(--surface2);color:var(--text);font-size:max(9px, calc(11.5px * var(--escala-texto, 1)));">'
      h += '<select data-vd-equipe="' + escHtml(g.nome) + '" style="padding:6px 9px;border-radius:7px;border:1px solid var(--border);background:var(--surface2);color:var(--text);font-size:max(9px, calc(11.5px * var(--escala-texto, 1)));">'
        + '<option value="">— sem time —</option>'
        + ordenarTimes(_eqTimes).map(t => '<option value="' + escHtml(t.id) + '"' + (String(e.equipe_id) === String(t.id) ? ' selected' : '') + '>' + escHtml(t.nome) + '</option>').join('')
        + '</select>'
      h += '</div>'
    }
    h += '</div>'
  }
  // COM QUE ACESSO ELAS NASCEM. Sem isto, cada conta criada aqui nascia sem
  // nada e alguém tinha de abrir uma por uma depois para marcar as ferramentas
  // — o mesmo trabalho, repetido tantas vezes quantas forem as vendedoras.
  h += '<div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border);">'
  h += '<label style="display:block;font-size:max(9px, calc(11px * var(--escala-texto, 1)));font-weight:700;color:var(--text);margin-bottom:4px;">Todas começam com o acesso de</label>'
  h += '<select data-vd-perfil style="width:100%;padding:7px 10px;border-radius:8px;border:1px solid var(--border);background:var(--surface2);color:var(--text);font-size:max(9px, calc(12px * var(--escala-texto, 1)));">'
    + '<option value="">Sem nada — marco uma a uma depois</option>'
    + (_perfisCache || []).map(p => '<option value="' + escHtml(p.id) + '"' + (String(_vdPerfilId) === String(p.id) ? ' selected' : '') + '>'
        + escHtml(p.nome + ' — ' + Object.keys(p.permissions || {}).length + ' ferramentas') + '</option>').join('')
    + '</select>'
  h += '<div style="font-size:max(9px, calc(11px * var(--escala-texto, 1)));color:var(--muted);margin-top:4px;">Vale para todas as marcadas. Depois dá para ajustar uma a uma pelo botão <b>Permissões</b> de cada pessoa, dentro do time.</div>'
  h += '</div>'
  h += '<div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap;">'
  h += '<button class="btn btn-principal" data-vd-criar-tudo>Criar as contas marcadas</button>'
  h += '<button class="btn" data-vd-fechar>Cancelar</button>'
  h += '</div></div>'
  return h
}

async function _vdCriarContas(botao) {
  const marcadas = _vdLista.filter(g => (_vdEscolhas[g.nome] || {}).criar && !g.balcao)
  if (!marcadas.length) { adminToast('Nenhuma conta marcada.', false); return }
  const semEmail = marcadas.filter(g => !(_vdEscolhas[g.nome].email || '').includes('@'))
  if (semEmail.length) { adminToast('Falta e-mail em: ' + semEmail.map(g => g.nome).join(', '), false); return }

  // O perfil é resolvido AQUI, uma vez, e o que a confirmação diz é o que vai
  // ser gravado. Perfil escolhido que sumiu da lista (outra janela apagou) vira
  // "sem nada" — o lado seguro do erro.
  const perfilEscolhido = _vdPerfilId ? (_perfisCache || []).find(p => String(p.id) === String(_vdPerfilId)) : null

  const ok = await _gtConfirmAdmin('Criar ' + marcadas.length + (marcadas.length === 1 ? ' conta?' : ' contas?'),
    'Cada uma recebe uma senha diferente, e é obrigada a trocá-la no primeiro acesso. '
    + 'As senhas aparecem UMA vez — anote antes de fechar.\n\n'
    + (perfilEscolhido
      ? 'Cada uma nasce com o acesso de "' + perfilEscolhido.nome + '" ('
        + Object.keys(perfilEscolhido.permissions || {}).length + ' ferramentas).'
      : 'Nenhuma delas vai enxergar ferramenta alguma até você marcar as permissões.'))
  if (!ok) return

  botao.disabled = true; botao.textContent = 'Criando…'
  const feitas = []
  for (const g of marcadas) {
    const esc = _vdEscolhas[g.nome]
    // SENHA DIFERENTE PARA CADA UMA. Senha igual para todas significa que
    // qualquer uma entra na conta da outra — e essas contas veem faturamento.
    const senha = gerarSenhaForte(12)
    try {
      const r = await fetch(SUPABASE_URL + '/functions/v1/invite-user', {
        method: 'POST',
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + adTok(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: esc.email.trim(), name: g.nome, role: 'viewer', password: senha }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || ('a função respondeu ' + r.status))

      // O ID VEM DE UMA CONSULTA, e não da resposta.
      //
      // `invite-user` devolve `{ success: true }` e mais nada — ela nunca
      // mandou o id. A primeira versão daqui fazia `d.user?.id || d.id || null`
      // e, quando dava null, PULAVA em silêncio a marca de trocar senha e a
      // entrada no time. O teste ponta a ponta pegou: a conta nasceu, e nasceu
      // sem time e sem cobrança de senha — o pior resultado possível, porque
      // parece que deu certo.
      //
      // Consultar por e-mail funciona porque a função já gravou o perfil antes
      // de responder.
      const rBusca = await adFetch('profiles?select=id&email=eq.' + encodeURIComponent(esc.email.trim()))
      const achados = rBusca.ok ? await rBusca.json().catch(() => []) : []
      const novoId = (achados[0] || {}).id || null
      if (!novoId) throw new Error('a conta foi criada, mas não achei o cadastro dela para pôr no time')

      const rMarca = await adFetch('profiles?id=eq.' + encodeURIComponent(novoId),
        { method: 'PATCH', body: JSON.stringify({ precisa_trocar_senha: true }) })
      if (!rMarca.ok) throw new Error('a conta foi criada, mas não consegui exigir a troca da senha')

      if (esc.equipe_id) {
        const rTime = await adFetch('equipes_membros',
          { method: 'POST', body: JSON.stringify({ equipe_id: esc.equipe_id, profile_id: novoId, papel: 'vendedora' }) })
        if (!rTime.ok) throw new Error('a conta foi criada, mas não entrou no time')
      }

      // O ACESSO INICIAL, se foi escolhido um perfil. Mesmo PATCH que o
      // formulário de convidar faz (`adminInviteUser`) — `invite-user` só grava
      // id/email/name/role, não aceita perfil nem permissões.
      //
      // Falhar aqui NÃO estoura: a conta e o time já estão feitos, e mandar o
      // laço para o `catch` esconderia a senha desta pessoa, que só aparece uma
      // vez. O aviso vai por toast e a senha continua na lista.
      if (perfilEscolhido) {
        const permissions = { ...perfilEscolhido.permissions }
        const rPerfil = await adFetch('profiles?id=eq.' + encodeURIComponent(novoId), {
          method: 'PATCH',
          body: JSON.stringify({
            perfil_id: perfilEscolhido.id,
            permissions,
            permissions_excecao: {},
            features: derivarFeatures(permissions, { ehSuperadmin: false }),
          }),
        }).catch(() => null)
        if (!rPerfil || !rPerfil.ok) {
          adminToast('A conta de ' + g.nome + ' foi criada, mas não consegui aplicar o acesso de "'
            + perfilEscolhido.nome + '" — marque pelo botão Permissões dela.', false)
        }
      }
      feitas.push({ nome: g.nome, email: esc.email.trim(), senha })
    } catch (e) {
      adminToast('Falhou em ' + g.nome + ': ' + String(e && e.message || e), false)
    }
  }
  _vdSenhas = feitas
  _vdLista = []
  // O perfil NÃO sobrevive à rodada: deixá-lo escolhido faria a próxima puxada
  // conceder acesso por omissão, sem ninguém ter escolhido de novo.
  _vdPerfilId = ''
  botao.disabled = false
  await loadAdminEquipes()
}

// Confirmação simples desta seção. O admin não tem o _gtConfirm da Gestão de
// Tráfego, e criar conta é ação que não deve acontecer por clique errado.
function _gtConfirmAdmin(titulo, texto) {
  return Promise.resolve(window.confirm(titulo + '\n\n' + texto))
}

/* ── TIMES DE VENDA ─────────────────────────────────────────────────────────
 *
 * PEDIDO DO DONO (04/08/2026): gerir as equipes de lojas e canais aqui, definir
 * quem gere cada time e quem pode criar e excluir.
 *
 * A LISTA DE LOJAS É DADO, NÃO CÓDIGO. "tem dom pedro também, e aí logo terá
 * iguatemi campinas, sorocaba, etc" — loja nova é rotina do negócio. Tudo o que
 * esta tela faz é escrever em `equipes` e `equipes_membros`; nenhuma loja está
 * escrita em lugar nenhum do sistema.
 */
let _eqTimes = []
let _eqMembros = []
// As supervisoras do GRUPO (`canais_grupos_membros`). Ficam à parte de
// `_eqMembros` porque não são membros de time nenhum: o alcance delas é o grupo.
let _eqSupervisoras = []
let _eqPessoas = []
let _eqCanais = []
// O que a supervisora liberou para alguém do time (`equipes_permissoes`; hoje
// só a chave 'estoque'). Sem esta lista, a caixinha de liberar estoque não tem
// como saber o estado atual — e foi por não ter sido carregada que a caixinha
// ficou dois meses sem ser desenhada.
let _eqLiberacoes = []
let _eqEditando = null   // id do time aberto para edição, ou 'novo'
// AS PESSOAS, no formato que `_criarLinhaPessoa` desenha — o MESMO cartão da
// lista de baixo. Guardado aqui porque quem monta é `loadAdminUsers` e quem
// desenha dentro do time é `_eqLigar`.
//
// PEDIDO DO DONO (12/08/2026): "os cards que aparecem embaixo junto com os
// outros usuários, pode subir nos cards de cada loja... para ficar mais
// organizado e separado". Reusar o cartão, e não fazer um segundo parecido, é
// o que garante que os dois lugares nunca digam coisas diferentes sobre a
// mesma pessoa — e é o que apagou daqui um bloco inteiro de controles
// repetidos ("informação demais").
let _eqLinhasPessoa = []
let _eqGaveta = 'marca'
let _eqMeuEmail = ''

const _eqEu = () => ({ is_superadmin: !!estado.is_superadmin, id: estado.user?.id })

// Meu papel num time. O dono não precisa ser membro para administrar.
function _eqMeuPapel(timeId) {
  const m = _eqMembros.find(x => String(x.equipe_id) === String(timeId) && String(x.profile_id) === String(estado.user?.id))
  return m ? m.papel : null
}

// `desenhar: false` = só busca, não desenha.
//
// POR QUE O PARÂMETRO EXISTE: os cartões das pessoas dentro de cada loja são o
// MESMO `_criarLinhaPessoa` da lista de baixo, e quem monta essas linhas é
// `loadAdminUsers`. Mas `loadAdminUsers` também precisa saber QUEM já está num
// time, para tirar essas pessoas da lista de baixo. Uma precisa da outra nos
// dois sentidos.
//
// Buscar cedo e desenhar tarde desata o nó com UMA consulta só: no começo de
// `loadAdminUsers` isto enche `_eqMembros`, e no fim `_eqDesenhar()` roda com
// as linhas das pessoas já prontas. Sem isso, ou os times desenhavam vazios na
// primeira passada, ou a mesma consulta seria feita duas vezes.
/* ── CANAIS DE VENDA E SEUS GRUPOS ──────────────────────────────────────────
 *
 * PEDIDO DO DONO (20/08/2026): separar o seletor de canais das dashboards por
 * atacado e varejo, e separar os times da lista de usuários do mesmo jeito.
 *
 * O grupo é a fundação das outras três peças — o seletor agrupado, o alcance da
 * supervisora e os cards de time — e todas leem DAQUI. Por isso ele se
 * configura num lugar só, e o time não tem campo de grupo: ele herda do canal.
 */
let _canaisComGrupo = []
// Os grupos CADASTRADOS (`canais_grupos`). Antes de 27/08 o grupo era deduzido
// do texto dos canais; agora ele é linha com identidade própria, e um grupo
// recém-criado precisa existir na tela ANTES de ter canal nenhum dentro.
let _gruposDeCanal = []
// Qual grupo está com o painel de escolher canais aberto. Um por vez: dois
// painéis abertos mostrando a mesma lista de 14 canais, com marcações
// diferentes, é convite para clicar no errado.
let _grupoAberto = null

async function loadAdminCanais() {
  const body = document.getElementById('admin-canais-body'); if (!body) return
  try {
    const [rc, rt, rg] = await Promise.all([
      sbClient.from('bling_lojas').select('loja_id,nome,grupo,grupo_id,fechado_em').order('nome'),
      sbClient.from('equipes').select('id,nome,canal_loja_id'),
      sbClient.from('canais_grupos').select('id,nome').order('nome'),
    ])
    // Erro de leitura NÃO vira lista vazia: "nenhum canal" quando a leitura
    // falhou é a mentira mais cara que uma tela conta.
    if (rc.error) throw new Error(rc.error.message)
    if (rg.error) throw new Error(rg.error.message)
    _canaisComGrupo = rc.data || []
    _gruposDeCanal = rg.data || []
    const mapaTimes = timePorCanal(rt.data || [])
    // A LINHA DE UM CANAL, num lugar só: ela aparece dentro do grupo e também
    // na lista dos que estão fora de grupo. Duas cópias divergiriam no dia em
    // que uma delas ganhasse campo novo — foi o que quase aconteceu com o
    // fechamento da loja.
    const linhaDeCanal = (c, t) => {
      let l = '<div class="adm-canal-linha">'
      l += '<span class="adm-canal-nome">' + escHtml(c.nome)
      l += t
        ? '<span class="adm-canal-time">time: ' + escHtml(t.nome) + '</span>'
        : '<span class="adm-canal-time adm-canal-sem">sem time</span>'
      // ⚠️ O QUE FECHAR SIGNIFICA, ESCRITO NA TELA. "Fechou em" sozinho deixaria
      // a dúvida de se o histórico some junto — e ele NÃO some.
      if (c.fechado_em) {
        l += '<span class="adm-canal-time adm-canal-sem">fechou em '
          + escHtml(dataISOparaBR(c.fechado_em)) + ' — fora dos menus de venda, histórico mantido</span>'
      }
      l += '</span>'
      l += '<button type="button" class="btn" data-canal-fechou="' + escHtml(String(c.loja_id)) + '">'
        + (c.fechado_em ? 'Reabrir' : 'Marcar fechamento') + '</button>'
      l += '</div>'
      return l
    }

    const baldes = agruparCanaisPorCadastro(_canaisComGrupo, _gruposDeCanal)
    const soltos = baldes.find((b) => b.grupo === null)
    const faltam = soltos ? soltos.canais.length : 0

    // A LINHA DE CIMA responde as três perguntas do relance: quantos canais
    // existem, em quantos grupos, e quantos ainda estão de fora.
    let h = '<div class="adm-canais-topo">'
    h += '<span>' + _canaisComGrupo.length + (_canaisComGrupo.length === 1 ? ' canal' : ' canais') + '</span>'
    h += '<span>' + _gruposDeCanal.length + (_gruposDeCanal.length === 1 ? ' grupo' : ' grupos') + '</span>'
    h += faltam
      ? '<span class="adm-canais-faltam">' + faltam + (faltam === 1 ? ' fora de grupo' : ' fora de grupo')  + '</span>'
      : '<span class="adm-canais-ok">todos em um grupo</span>'
    h += '<button type="button" class="btn btn-principal" data-grupo-criar="1">+ Criar grupo</button>'
    h += '</div>'

    for (const balde of baldes) {
      if (balde.grupo === null) continue // o balde dos soltos vai no fim, com outro desenho
      const g = balde.grupo
      const gid = escHtml(String(g.id))
      const aberto = String(_grupoAberto) === String(g.id)
      h += '<div class="adm-grupo-card">'
      h += '<div class="adm-grupo-topo">'
      h += '<span class="adm-grupo-nome">' + escHtml(g.nome) + '</span>'
      h += '<span class="adm-grupo-conta">' + balde.canais.length
        + (balde.canais.length === 1 ? ' canal' : ' canais') + '</span>'
      h += '<span class="adm-grupo-acoes">'
      h += '<button type="button" class="btn" data-grupo-abrir="' + gid + '">'
        + (aberto ? 'Fechar' : 'Escolher canais') + '</button>'
      h += '<button type="button" class="btn" data-grupo-renomear="' + gid + '">Renomear</button>'
      // "Apagar" NÃO fica aqui. O padrão da Central diz que botão de perigo não
      // fica solto na lista — ele mora atrás de um passo a mais. Aqui esse passo
      // é abrir "Escolher canais": quem vai apagar um grupo já está olhando
      // quais canais tem dentro, que é justamente o que decide se pode.
      h += '</span>'
      h += '</div>'
      h += '<div class="adm-grupo-aviso" data-grupo-aviso="' + gid + '"></div>'

      // COM O PAINEL ABERTO, a lista de baixo não aparece: as caixinhas já dizem
      // quem é do grupo, e mostrar os mesmos nomes duas vezes na mesma tela faz
      // a pessoa procurar a diferença entre as duas listas — não há nenhuma.
      if (!aberto && !balde.canais.length) {
        // GRUPO VAZIO DIZ O QUE FAZER. Um card em branco parece defeito da tela.
        h += '<div class="adm-grupo-vazio">Nenhum canal neste grupo ainda. Use <b>Escolher canais</b>.</div>'
      }
      for (const c of (aberto ? [] : balde.canais)) {
        const t = mapaTimes.get(String(c.loja_id))
        h += linhaDeCanal(c, t)
      }

      // O PAINEL: os 14 canais, marcados os deste grupo. É aqui que a escolha
      // deixou de ser "um seletor por canal" e virou "um lugar por grupo".
      if (aberto) {
        h += '<div class="adm-grupo-painel">'
        h += '<div class="adm-grupo-painel-tit">Marque os canais que são do ' + escHtml(g.nome) + '</div>'
        for (const c of _canaisComGrupo) {
          const meu = String(c.grupo_id || '') === String(g.id)
          // De quem é hoje: sem isto, marcar um canal do Varejo dentro do
          // Atacado seria um roubo silencioso — a pessoa não veria de onde ele
          // saiu. Um canal mora num grupo só (é uma coluna, não uma lista), então
          // marcar aqui MOVE, e a tela diz isso antes do clique.
          const outro = !meu && c.grupo_id
            ? (_gruposDeCanal.find((x) => String(x.id) === String(c.grupo_id)) || null)
            : null
          h += '<label class="adm-grupo-opcao">'
          h += '<input type="checkbox" data-grupo-canal="' + gid + '" value="' + escHtml(String(c.loja_id)) + '"'
            + (meu ? ' checked' : '') + '>'
          h += '<span>' + escHtml(c.nome)
          if (outro) h += '<em class="adm-grupo-hoje">hoje em ' + escHtml(outro.nome) + ' — marcar aqui move</em>'
          h += '</span></label>'
        }
        // O passo a mais que o padrão pede para a ação de perigo.
        h += '<div class="adm-grupo-perigo">'
        h += '<button type="button" class="btn btn-perigo" data-grupo-apagar="' + gid + '">Apagar o grupo ' + escHtml(g.nome) + '</button>'
        h += '</div>'
        h += '</div>'
      }
      h += '</div>'
    }

    if (soltos) {
      h += '<div class="adm-canais-grupo">Fora de todo grupo</div>'
      h += '<div class="adm-grupo-vazio">Estes canais não entram em nenhum recorte de atacado/varejo. '
        + 'Para pôr um deles num grupo, abra o grupo acima e use <b>Escolher canais</b>.</div>'
      for (const c of soltos.canais) {
        const t = mapaTimes.get(String(c.loja_id))
        h += linhaDeCanal(c, t)
      }
    }

    body.innerHTML = h
    _ligarCadastroDeGrupos()
  } catch (e) {
    // `faixa-de-erro` é componente .vue e não serve dentro de innerHTML: aqui
    // vai texto, com o token de erro.
    body.innerHTML = '<div style="color:var(--red);font-family:var(--fonte-principal);font-size:max(9px, calc(12px * var(--escala-texto, 1)));">Não consegui carregar os canais: ' + escHtml(String(e && e.message || e)) + '</div>'
  }
}

// AS QUATRO AÇÕES DO CADASTRO DE GRUPOS, e a regra que todas obedecem:
// NENHUMA gravação passa por sucesso sem conferir que linha foi mesmo afetada.
//
// Quando o RLS barra, o PostgREST responde 200 com lista VAZIA — sem erro. Este
// projeto já pagou por isso: a tela diria "salvo" para uma gravação que não
// aconteceu, e a pessoa só descobriria quando a dashboard de alguém mudasse
// sozinha. Por isso todo pedido leva `Prefer: return=representation` e a
// resposta é contada antes de qualquer "pronto".
//
// Quem pode escrever aqui é só o super-admin (políticas `canais_grupos_escrever`
// e `bling_lojas_grupo_superadmin`, as duas por `superadmin_pela_ficha()`).
function _ligarCadastroDeGrupos() {
  const avisoDe = (gid) => document.querySelector('[data-grupo-aviso="' + gid + '"]')
  const dizer = (gid, texto, ruim) => {
    const el = avisoDe(gid)
    if (!el) { if (ruim) adminToast(texto, false); return }
    el.textContent = texto
    el.className = 'adm-grupo-aviso' + (ruim ? ' adm-grupo-erro' : '')
  }

  // Uma escrita, com a conferência de linhas embutida. Devolve as linhas.
  const gravar = async (caminho, opts, oQueEra) => {
    const r = await adFetch(caminho, {
      ...opts,
      headers: { Prefer: 'return=representation', ...(opts.headers || {}) },
    })
    if (!r.ok) throw new Error(await r.text())
    const linhas = await r.json().catch(() => [])
    if (!Array.isArray(linhas) || linhas.length === 0) {
      throw new Error('o banco aceitou o pedido e não gravou nada — você não tem permissão para '
        + oQueEra + '. Só o super-admin muda os grupos de canal.')
    }
    return linhas
  }

  // ── Fechar / reabrir um canal ──────────────────────────────────────────────
  // Loja que fechou some dos menus das telas de venda DAQUI PRA FRENTE e volta
  // sozinha quando o período escolhido alcança os dias em que ela operava. Nada
  // é apagado: venda, meta e equipe ficam. Ver `src/compartilhado/canal-fechado.js`.
  document.querySelectorAll('[data-canal-fechou]').forEach((b) => {
    b.onclick = async () => {
      const loja = b.getAttribute('data-canal-fechou')
      const c = _canaisComGrupo.find((x) => String(x.loja_id) === String(loja))
      if (!c) return
      // `window.prompt` porque é o que ESTA tela já usa para pedir texto.
      const digitado = window.prompt(
        'Quando o canal "' + c.nome + '" fechou?\n\n'
        + 'Escreva a data como 31/08/2026. Deixe vazio para reabrir.\n'
        + 'Ele sai dos menus de venda a partir do dia seguinte, e continua aparecendo '
        + 'quando o período escolhido alcançar os dias em que a loja operava.',
        dataISOparaBR(c.fechado_em))
      if (digitado === null) return
      // ⚠️ DATA QUE A TELA NÃO ENTENDEU NÃO VIRA NULO. Nulo aqui é "reabrir", e
      // reabrir uma loja por erro de digitação seria um "salvo" mentiroso.
      const veredito = dataDigitadaParaISO(digitado)
      if (!veredito.ok) { adminToast(veredito.mensagem, false); return }
      if ((veredito.iso || null) === (c.fechado_em || null)) return
      b.disabled = true
      try {
        await gravar('bling_lojas?loja_id=eq.' + encodeURIComponent(loja), {
          method: 'PATCH', body: JSON.stringify({ fechado_em: veredito.iso }),
        }, 'fechar ou reabrir um canal')
        await loadAdminCanais()
        adminToast(veredito.iso
          ? '"' + c.nome + '" fechou em ' + dataISOparaBR(veredito.iso)
            + '. Sai dos menus de venda daqui pra frente; o histórico continua.'
          : '"' + c.nome + '" voltou a aparecer nos menus de venda.', true)
      } catch (e) {
        b.disabled = false
        adminToast(String(e && e.message || e), false)
      }
    }
  })

  // ── Criar ──────────────────────────────────────────────────────────────────
  const bCriar = document.querySelector('[data-grupo-criar]')
  if (bCriar) bCriar.onclick = async () => {
    // `window.prompt` e não um modal próprio: é o que ESTA MESMA TELA já usa
    // para pedir um nome (perfil de acesso, e o grupo novo do seletor antigo).
    // Inventar um modal só aqui deixaria dois jeitos de pedir a mesma coisa no
    // mesmo arquivo.
    const digitado = window.prompt('Nome do grupo novo (ex.: Atacado, Varejo)')
    if (digitado === null) return
    const veredito = nomeDeGrupoAceito(digitado, _gruposDeCanal)
    if (!veredito.ok) { adminToast(veredito.mensagem, false); return }
    bCriar.disabled = true
    try {
      const linhas = await gravar('canais_grupos', {
        method: 'POST', body: JSON.stringify({ nome: veredito.nome }),
      }, 'criar grupo')
      // Já abre o grupo novo: quem acabou de criar quer pôr canal dentro, e o
      // card vazio sem o painel aberto obriga um clique que não informa nada.
      _grupoAberto = linhas[0] && linhas[0].id
      await loadAdminCanais()
      adminToast('Grupo "' + veredito.nome + '" criado.', true)
    } catch (e) {
      bCriar.disabled = false
      adminToast(String(e && e.message || e), false)
    }
  }

  // ── Abrir e fechar o painel ────────────────────────────────────────────────
  document.querySelectorAll('[data-grupo-abrir]').forEach((b) => {
    b.onclick = async () => {
      const gid = b.getAttribute('data-grupo-abrir')
      _grupoAberto = String(_grupoAberto) === String(gid) ? null : gid
      await loadAdminCanais()
    }
  })

  // ── Renomear ───────────────────────────────────────────────────────────────
  document.querySelectorAll('[data-grupo-renomear]').forEach((b) => {
    b.onclick = async () => {
      const gid = b.getAttribute('data-grupo-renomear')
      const g = _gruposDeCanal.find((x) => String(x.id) === String(gid))
      if (!g) return
      const digitado = window.prompt('Novo nome para o grupo "' + g.nome + '"', g.nome)
      if (digitado === null) return
      // O `gid` no terceiro argumento é o que faz corrigir a grafia funcionar:
      // sem ele, trocar "varejo" por "Varejo" seria recusado por já existir —
      // contra o próprio grupo que se está renomeando.
      const veredito = nomeDeGrupoAceito(digitado, _gruposDeCanal, gid)
      if (!veredito.ok) { dizer(gid, veredito.mensagem, true); return }
      if (veredito.nome === g.nome) return
      b.disabled = true
      dizer(gid, 'Renomeando…', false)
      try {
        // O texto de `bling_lojas.grupo` acompanha sozinho: quem faz isso é o
        // gatilho `espelhar_rename_do_grupo`, no banco. Renomear aqui NÃO parte
        // o grupo em dois, que é o defeito do nome digitado em cada canal.
        await gravar('canais_grupos?id=eq.' + encodeURIComponent(gid), {
          method: 'PATCH', body: JSON.stringify({ nome: veredito.nome }),
        }, 'renomear grupo')
        await loadAdminCanais()
        adminToast('Grupo renomeado para "' + veredito.nome + '".', true)
      } catch (e) {
        b.disabled = false
        dizer(gid, String(e && e.message || e), true)
      }
    }
  })

  // ── Apagar ─────────────────────────────────────────────────────────────────
  document.querySelectorAll('[data-grupo-apagar]').forEach((b) => {
    b.onclick = async () => {
      const gid = b.getAttribute('data-grupo-apagar')
      const g = _gruposDeCanal.find((x) => String(x.id) === String(gid))
      if (!g) return
      // A CHAVE ESTRANGEIRA É `on delete set null`: apagar um grupo com canais
      // dentro os desligaria EM SILÊNCIO, e o recorte das dashboards mudaria
      // sem ninguém saber por quê. A regra pura responde antes de perguntar.
      const veredito = podeApagarGrupo(gid, _canaisComGrupo)
      if (!veredito.ok) { dizer(gid, veredito.mensagem, true); return }
      // O confirm() é o mesmo que esta tela já usa para excluir usuário — o
      // único jeito de perguntar "tem certeza?" que existe neste arquivo.
      if (!window.confirm('Apagar o grupo "' + g.nome + '"? Ele não tem canal nenhum dentro.')) return
      b.disabled = true
      try {
        await gravar('canais_grupos?id=eq.' + encodeURIComponent(gid), { method: 'DELETE' }, 'apagar grupo')
        _grupoAberto = null
        await loadAdminCanais()
        adminToast('Grupo "' + g.nome + '" apagado.', true)
      } catch (e) {
        b.disabled = false
        dizer(gid, String(e && e.message || e), true)
      }
    }
  })

  // ── Pôr / tirar canal do grupo ─────────────────────────────────────────────
  document.querySelectorAll('[data-grupo-canal]').forEach((cx) => {
    cx.onchange = async () => {
      const gid = cx.getAttribute('data-grupo-canal')
      const loja = cx.value
      const entrando = cx.checked
      cx.disabled = true
      dizer(gid, entrando ? 'Pondo no grupo…' : 'Tirando do grupo…', false)
      try {
        // GRAVA `grupo_id`, NÃO O TEXTO. O texto acompanha pelo gatilho
        // `espelhar_grupo_do_canal` — é o caminho que o banco espelha, e é por
        // isso que a fatia do espelho veio antes desta.
        await gravar('bling_lojas?loja_id=eq.' + encodeURIComponent(loja), {
          method: 'PATCH', body: JSON.stringify({ grupo_id: entrando ? gid : null }),
        }, 'mudar o grupo do canal')
        await loadAdminCanais()
      } catch (e) {
        // Volta a caixinha ao que era: caixinha que PARECE marcada e não gravou
        // é o defeito mais caro de perceber — ninguém desconfia do que já leu
        // como certo.
        cx.checked = !entrando
        cx.disabled = false
        dizer(gid, String(e && e.message || e), true)
      }
    }
  })
}

async function loadAdminEquipes(opcoes) {
  const desenhar = !(opcoes && opcoes.desenhar === false)
  const body = document.getElementById('admin-equipes-body'); if (!body) return
  if (desenhar) body.innerHTML = '<div style="color:var(--muted);font-size:max(9px, calc(12px * var(--escala-texto, 1)))">Carregando…</div>'
  try {
    // `profiles` USA `sbClient`, NÃO `sb()` (mesmo motivo do comentário em
    // loadAdminUsers): com a chave anônima o PostgREST devolve 200 e lista
    // vazia pra tabela que só abre `to authenticated` — falha disfarçada de
    // "não tem nada". Como esta função roda A CADA loadAdminUsers, essa
    // mentira se repetiria toda vez que a tela de Usuários abrisse.
    // AS COLUNAS DE PERMISSÃO ENTRAM AQUI, e não é enfeite: o botão
    // "Permissões" desta seção abre o MESMO editor da lista de usuários
    // (`openPermModal`), e esse editor GRAVA o que recebeu. Se a pessoa
    // chegasse nele sem `permissions`/`allowed_accounts`/`perfil_id`, salvar
    // apagaria o acesso inteiro dela em silêncio — o editor não teria como
    // saber que o que faltava era o select, não o acesso.
    const [times, membros, canais, liberacoes, supervisoras, rp] = await Promise.all([
      sb('equipes?select=*'),
      sb('equipes_membros?select=*'),
      sb('bling_lojas?select=loja_id,nome&order=nome'),
      sb('equipes_permissoes?select=equipe_id,profile_id,chave'),
      // As supervisoras do GRUPO. Elas não estão em `equipes_membros`: o alcance
      // delas é o grupo inteiro, e é por isso que moram noutra tabela.
      sb('canais_grupos_membros?select=id,grupo_id,profile_id,papel'),
      sbClient.from('profiles').select(
        'id,name,email,disabled,escopo_por_equipe,'
        + 'permissions,permissions_excecao,allowed_accounts,is_superadmin,perfil_id,role').order('name'),
    ])
    if (rp.error) throw rp.error
    // `sb()` NAO lanca: devolve [] com `.erro` anexado. Sem conferir, uma falha
    // de rede ou de permissao virava "0 times cadastrados" na tela -- o numero
    // errado com cara de verdade, que e o defeito que o `.erro` existe pra
    // evitar. Confira ANTES de transformar: `.filter`/`.map` perdem o `.erro`.
    const falhou = times.erro || membros.erro || canais.erro
    if (falhou) throw new Error(falhou.mensagem || String(falhou))
    _eqTimes = times || []; _eqMembros = membros || []
    _eqPessoas = rp.data || []; _eqCanais = canais || []
    // A liberação de estoque NÃO derruba a seção se falhar: sem ela a caixinha
    // aparece desmarcada, que é o lado seguro do erro. Derrubar a lista de
    // times inteira por causa dela seria trocar um defeito pequeno por um
    // grande.
    _eqLiberacoes = liberacoes && !liberacoes.erro ? liberacoes : []
    // Mesma escolha da liberação de estoque: falhar aqui não derruba a lista de
    // times inteira. Sem elas o card pai diz "nenhuma supervisora", que é o lado
    // seguro do erro — o outro seria a tela sumir por causa de uma seção.
    _eqSupervisoras = supervisoras && !supervisoras.erro ? supervisoras : []
    if (desenhar) _eqDesenhar()
  } catch (e) {
    // O MOTIVO VAI PRA TELA. `catch` mudo aqui já custou meia hora de caça
    // noutra tela deste mesmo sistema.
    body.innerHTML = '<div style="color:var(--red,#dc2626);font-size:max(9px, calc(12.5px * var(--escala-texto, 1)))">Não consegui carregar os times: ' + escHtml(String(e && e.message || e)) + '</div>'
  }
}

function _eqDesenhar() {
  const body = document.getElementById('admin-equipes-body'); if (!body) return
  const eu = _eqEu()
  const podeCriar = eu.is_superadmin || _eqMembros.some(m => String(m.profile_id) === String(eu.id) && m.papel === 'gestor')

  let html = _vdSecao()
  html += '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:14px;flex-wrap:wrap;">'
  html += '<div style="color:var(--muted);font-size:max(9px, calc(12px * var(--escala-texto, 1)));">' + _eqTimes.length + (_eqTimes.length === 1 ? ' time' : ' times') + ' cadastrados</div>'
  if (podeCriar) html += '<button class="btn btn-principal" data-eq-novo>+ Novo time</button>'
  html += '</div>'

  if (!_eqTimes.length) {
    html += '<div style="border:1px dashed var(--border);border-radius:12px;padding:22px;text-align:center;color:var(--muted);font-size:max(9px, calc(12.5px * var(--escala-texto, 1)));">'
      + 'Nenhum time ainda. Crie um para cada loja e cada canal de venda — é o que permite dizer que uma vendedora só enxerga a loja dela.</div>'
  }

  // ── OS TIMES SOB CABEÇALHO DE GRUPO (Peça 4, 20/08/2026) ──────────────────
  // O time herda o grupo do canal a que está amarrado — ele não tem grupo
  // próprio. O cabeçalho só aparece quando existe ao menos um time com grupo:
  // enquanto ninguém marcar canal na lista "Canais de venda", esta parte da
  // tela fica idêntica ao que sempre foi.
  // ── O CARD PAI (27/08/2026) ────────────────────────────────────────────────
  // O grupo deixou de ser um TÍTULO solto acima dos cards e virou um CARTÃO com
  // as lojas dele dentro. O motivo é de leitura: com um título, as lojas do
  // Varejo e as do Atacado ficavam na mesma coluna, e nada mostrava onde um
  // grupo acabava e o outro começava — a separação existia no texto e não no
  // desenho. Com moldura, a hierarquia é o que se vê primeiro.
  //
  // A contagem soma DUAS coisas, e as duas importam: quantas lojas o grupo tem,
  // e quanta gente trabalha nelas somando todas. "Varejo: 2 lojas · 3 pessoas"
  // responde de relance a pergunta que hoje exige abrir loja por loja.
  const baldesDeTime = agruparTimesPorGrupo(ordenarTimes(_eqTimes), _canaisComGrupo, _gruposDeCanal)
  const mostrarCabecalhoDeGrupo = baldesDeTime.some(b => b.grupo !== null)
  for (const balde of baldesDeTime) {
    if (mostrarCabecalhoDeGrupo) {
      const gente = balde.times.reduce(
        (n, t) => n + _eqMembros.filter(m => String(m.equipe_id) === String(t.id)).length, 0)
      html += '<div class="adm-pai' + (balde.grupo ? '' : ' adm-pai-sem') + '">'
      html += '<div class="adm-pai-topo">'
      html += '<span class="adm-pai-nome">' + escHtml(balde.grupo ? balde.grupo.nome : 'Sem grupo') + '</span>'
      html += '<span class="adm-pai-conta">' + balde.times.length + (balde.times.length === 1 ? ' loja' : ' lojas')
        + ' · ' + gente + (gente === 1 ? ' pessoa' : ' pessoas') + '</span>'
      html += '</div>'
      if (!balde.grupo) {
        // CONTROLE QUE SOME SEM EXPLICAÇÃO VIRA CHAMADO. "Sem grupo" não é um
        // grupo, é a ausência de um — e a tela diz o que fazer, em vez de só
        // não ter nada ali.
        html += '<div class="adm-pai-nota">Estes times não estão em grupo nenhum. '
          + 'Ligue cada um a um canal de venda que esteja num grupo, na lista <b>Canais de venda</b>, acima.</div>'
      } else {
        // ── AS SUPERVISORAS DO GRUPO (27/08/2026) ────────────────────────────
        // Decisão do dono: "a supervisora fica a nível pai, gestora e vendedora
        // fica a nível loja". Ela vê o faturamento de TODAS as lojas do grupo,
        // e por isso mora aqui em cima e não dentro do card de uma loja.
        const gid = escHtml(String(balde.grupo.id))
        html += '<div class="adm-pai-rotulo">Supervisoras do ' + escHtml(balde.grupo.nome) + '</div>'
        html += '<div class="adm-pai-gente" data-pai-gente="' + gid + '"></div>'
        // ⚠️ SÓ SUPERADMIN PÕE E TIRA. Este vínculo abre o faturamento do grupo
        // inteiro — é a mesma classe de decisão da chave "só os canais dos times
        // dela", que também é só do super-admin. A gestora de uma loja não cria
        // a própria chefe.
        if (eu.is_superadmin) html += '<div class="adm-pai-por" data-pai-por="' + gid + '"></div>'
        html += '<div class="adm-pai-aviso" data-pai-aviso="' + gid + '"></div>'
      }
    }
    for (const t of balde.times) {
    const l = linhaDoTime(t, _eqMembros)
    const meu = _eqMeuPapel(t.id)
    const posso = podeAdministrarTime(eu, meu)
    const canal = _eqCanais.find(c => String(c.loja_id) === String(t.canal_loja_id))
    html += '<div style="border:1px solid var(--border);border-radius:12px;padding:14px 16px;margin-bottom:10px;background:var(--surface);'
      + (l.ativo ? '' : 'opacity:.6;') + '">'
    html += '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap;">'
    html += '<div style="font-weight:800;font-size:max(9px, calc(14px * var(--escala-texto, 1)));color:var(--text);">' + escHtml(l.nome)
      + '<span style="font-weight:600;font-size:max(9px, calc(10.5px * var(--escala-texto, 1)));color:var(--muted);margin-left:8px;text-transform:uppercase;letter-spacing:1px;">' + escHtml(l.tipo) + '</span>'
      + (l.ativo ? '' : '<span style="font-weight:700;font-size:max(9px, calc(10.5px * var(--escala-texto, 1)));color:var(--orange,#d97706);margin-left:8px;">inativo</span>')
      + '</div>'
    html += '<div style="font-size:max(9px, calc(12px * var(--escala-texto, 1)));color:var(--muted);">' + escHtml(l.quemTem) + '</div>'
    html += '</div>'
    // A AMARRA COM O BLING em letras claras: é ela que faz o faturamento
    // aparecer, e o nome de lá quase nunca é o nome da casa.
    html += '<div style="font-size:max(9px, calc(11.5px * var(--escala-texto, 1)));color:var(--muted);margin-top:5px;">Vendas pelo canal: '
      + (canal ? '<b style="color:var(--text)">' + escHtml(canal.nome) + '</b>' : '<i>nenhum ligado</i>') + '</div>'
    for (const a of l.avisos) {
      html += '<div style="margin-top:6px;font-size:max(9px, calc(11.5px * var(--escala-texto, 1)));color:' + (a.grave ? 'var(--orange,#d97706)' : 'var(--muted)') + ';">' + escHtml(a.texto) + '</div>'
    }
    html += '<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;">'
    if (posso) html += '<button class="btn" data-eq-editar="' + escHtml(t.id) + '">Editar</button>'
    if (!posso) html += '<span style="font-size:max(9px, calc(11.5px * var(--escala-texto, 1)));color:var(--muted);">Você não administra este time.</span>'
    html += '</div>'
    if (String(_eqEditando) === String(t.id)) html += _eqFormulario(t)
    // AS PESSOAS MORAM AQUI DENTRO, sempre visíveis — não atrás de um botão.
    // O cartão é preenchido por `_eqLigar`, com o MESMO `_criarLinhaPessoa` da
    // lista de baixo (é DOM, não texto, então não dá pra concatenar aqui).
    html += '<div data-eq-pessoas="' + escHtml(t.id) + '" style="margin-top:12px;padding-top:10px;border-top:1px solid var(--border);"></div>'
    html += '</div>'
    }
    // Fecha a moldura do grupo. Só existe quando há cabeçalho — sem grupo
    // nenhum marcado, esta parte da tela continua idêntica ao que sempre foi.
    if (mostrarCabecalhoDeGrupo) html += '</div>'
  }
  if (_eqEditando === 'novo') html += '<div style="border:1px solid var(--accent);border-radius:12px;padding:14px 16px;margin-bottom:10px;background:var(--surface);">' + _eqFormulario(null) + '</div>'

  body.innerHTML = html
  _eqLigar(body)
}

// O FORMULÁRIO do time. Os quatro vínculos ficam juntos e explicados: é aqui
// que "Tivoli" vira "Loja Santa Bárbara d'Oeste" para as vendas.
function _eqFormulario(t) {
  const e = t || { nome: '', tipo: 'loja', ativo: true }
  const livres = canaisLivres(_eqCanais, _eqTimes, e.id)
  const opc = (lista, val, chave, rot) => lista.map(x =>
    '<option value="' + escHtml(x[chave]) + '"' + (String(x[chave]) === String(val) ? ' selected' : '') + '>' + escHtml(x[rot]) + '</option>').join('')
  const campo = 'style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid var(--border);background:var(--surface2);color:var(--text);font-size:max(9px, calc(12.5px * var(--escala-texto, 1)));"'
  const rot = 'style="display:block;font-size:max(9px, calc(11px * var(--escala-texto, 1)));font-weight:700;color:var(--text);margin:10px 0 4px;"'
  let h = '<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border);">'
  h += '<label ' + rot + '>Nome do time</label>'
  h += '<input data-eq-campo="nome" value="' + escHtml(e.nome || '') + '" placeholder="Tivoli, Iguatemi Campinas, Sorocaba…" ' + campo + '>'
  h += '<label ' + rot + '>O que é</label>'
  h += '<select data-eq-campo="tipo" ' + campo + '>'
    + '<option value="loja"' + (e.tipo === 'loja' ? ' selected' : '') + '>Loja — ponto físico que vende</option>'
    + '<option value="canal"' + (e.tipo === 'canal' ? ' selected' : '') + '>Canal — vende sem loja física</option>'
    + '<option value="setor"' + (e.tipo === 'setor' ? ' selected' : '') + '>Setor — não vende</option></select>'
  h += '<label ' + rot + '>Canal no Bling (é ele que traz o faturamento)</label>'
  h += '<select data-eq-campo="canal_loja_id" ' + campo + '><option value="">— ainda não tem —</option>' + opc(livres, e.canal_loja_id, 'loja_id', 'nome') + '</select>'
  h += '<div style="font-size:max(9px, calc(11px * var(--escala-texto, 1)));color:var(--muted);margin-top:4px;">O nome no Bling quase nunca é o nome da casa: o time <b>Tivoli</b> usa o canal <b>Loja Santa Bárbara d\'Oeste</b>. Sem ligar, o time mostra faturamento zero.</div>'
  // O TIME NÃO ESCOLHE O GRUPO: ele herda do canal. Mostrar aqui, em leitura, é
  // o que torna a herança visível sem precisar explicar em texto — e é a prova
  // na tela de que a Peça 1 funcionou de ponta a ponta.
  const canalDoTime = _canaisComGrupo.find(c => String(c.loja_id) === String(e.canal_loja_id))
  const grupoDoTime = canalDoTime ? normalizarGrupo(canalDoTime.grupo) : null
  h += '<label ' + rot + '>Grupo</label>'
  h += '<div style="font-size:max(9px, calc(12px * var(--escala-texto, 1)));color:var(--muted);">'
    + (grupoDoTime
        ? '<b>' + escHtml(grupoDoTime) + '</b> — vem do canal <b>' + escHtml(canalDoTime.nome) + '</b>. Para mudar, use a lista <b>Canais de venda</b>, acima.'
        : (canalDoTime
            ? 'O canal <b>' + escHtml(canalDoTime.nome) + '</b> ainda não tem grupo. Marque na lista <b>Canais de venda</b>, acima.'
            : 'Sem canal do Bling, o time não tem grupo.'))
    + '</div>'
  h += '<div data-eq-erro style="margin-top:10px;color:var(--red,#dc2626);font-size:max(9px, calc(12px * var(--escala-texto, 1)));"></div>'
  h += '<div style="display:flex;gap:8px;margin-top:12px;">'
  h += '<button class="btn btn-principal" data-eq-salvar="' + escHtml(e.id || '') + '">Salvar</button>'
  h += '<button class="btn" data-eq-cancelar>Cancelar</button>'
  h += '</div></div>'
  return h
}

/* AS PESSOAS DENTRO DO CARD DA LOJA ────────────────────────────────────────
 *
 * PEDIDO DO DONO (12/08/2026): "os cards que aparecem embaixo junto com os
 * outros usuários, pode subir nos cards de cada loja do time de vendas, para
 * ficar mais organizado e separado" e "precisa melhorar o visual, tá muito
 * carregado, informação demais".
 *
 * AS DUAS COISAS SE RESOLVEM COM A MESMA DECISÃO: aqui se desenha o MESMO
 * cartão da lista de baixo (`_criarLinhaPessoa`), não um parecido. Por isso:
 *  - Permissões, foto, papel, desativar e excluir vêm de graça, iguais aos de
 *    lá — dois cartões diferentes seriam dois comportamentos divergindo;
 *  - a troca de senha continua onde já estava: tocar no nome abre a ficha, e é
 *    lá que mora `_secaoSenha` (só super-admin);
 *  - o bloco de controles que eu tinha acrescentado saiu INTEIRO. Sobrou só o
 *    que é do TIME e não existe no cartão: o papel, a liberação de estoque e o
 *    tirar do time.
 *
 * A chave `escopo_por_equipe` mudou de lugar: é permissão da PESSOA (vale no
 * sistema inteiro), então foi para dentro do editor de Permissões, junto do
 * resto do acesso dela — e não numa caixinha solta em cada time.
 */

// A faixa do TIME, colada embaixo do cartão da pessoa. Curta de propósito.
function _eqFaixaDoTime(m, { eu, meu, meus, t, podeDar }) {
  const faixa = mkEl('div', 'eq-faixa')
  const papel = acharPapel(m.papel)

  if (podeDar.length) {
    const sel = mkEl('select', 'eq-faixa-sel')
    for (const p of podeDar) {
      const o = mkEl('option'); o.value = p.id; o.textContent = p.rotulo
      if (p.id === m.papel) o.selected = true
      sel.appendChild(o)
    }
    sel.title = papel ? papel.explicacao : ''
    sel.addEventListener('change', async () => {
      sel.disabled = true
      const r = await adFetch('equipes_membros?id=eq.' + encodeURIComponent(m.id),
        { method: 'PATCH', body: JSON.stringify({ papel: sel.value }) })
      if (!r.ok) { sel.disabled = false; adminToast('Não consegui mudar o papel.', false); return }
      await loadAdminUsers()
    })
    faixa.appendChild(sel)
  } else {
    faixa.appendChild(mkEl('span', 'eq-faixa-txt', papel ? papel.rotulo : m.papel))
  }

  // ESTOQUE: pelo papel, ou porque alguém liberou. Quando vem do papel a
  // caixinha fica marcada e travada — desmarcá-la não faria nada, e caixinha
  // que não obedece ensina a não confiar na tela.
  //
  // Era ela a que estava MORTA: `veOEstoque`/`podeLiberarEstoque` tinham teste
  // verde, estavam importadas, e nada nesta tela as chamava.
  const est = veOEstoque(m, _eqLiberacoes)
  const porPapel = est.porque === 'pelo papel'
  const podeLiberar = podeLiberarEstoque(eu, meu)
  const rot = mkEl('label', 'eq-faixa-chk')
  const cb = mkEl('input'); cb.type = 'checkbox'; cb.checked = est.ve
  cb.disabled = porPapel || !podeLiberar
  rot.title = porPapel
    ? 'Vem do papel dela — não dá para tirar sem mudar o papel.'
    : 'Estar no time mostra as VENDAS. O estoque é liberado à parte.'
  rot.appendChild(cb)
  rot.appendChild(document.createTextNode(porPapel ? 'estoque (pelo papel)' : 'estoque'))
  cb.addEventListener('change', async () => {
    // Guardado ANTES do await: `cb.checked` muda no desfazer abaixo, e ler dele
    // depois faria a mensagem de erro dizer o contrário do que falhou.
    const liberando = cb.checked
    cb.disabled = true
    const alvo = 'equipes_permissoes?equipe_id=eq.' + encodeURIComponent(t.id)
      + '&profile_id=eq.' + encodeURIComponent(m.profile_id) + '&chave=eq.estoque'
    const r = liberando
      ? await adFetch('equipes_permissoes', { method: 'POST', body: JSON.stringify({ equipe_id: t.id, profile_id: m.profile_id, chave: 'estoque' }) })
      : await adFetch(alvo, { method: 'DELETE' })
    if (!r.ok) {
      // Desfaz na hora: caixinha marcada com o banco dizendo não é a mentira
      // mais cara que uma tela de permissão pode contar.
      cb.checked = !liberando; cb.disabled = false
      adminToast('Não consegui ' + (liberando ? 'liberar' : 'tirar') + ' o estoque: ' + await r.text(), false)
      return
    }
    adminToast(liberando ? 'Estoque liberado.' : 'Estoque tirado.')
    await loadAdminEquipes()
  })
  faixa.appendChild(rot)

  const r = podeRemover(eu, meu, m, meus)
  if (r.pode) {
    const b = mkEl('button', 'btn eq-faixa-btn', 'Tirar do time'); b.type = 'button'
    b.addEventListener('click', async () => {
      b.disabled = true
      const resp = await adFetch('equipes_membros?id=eq.' + encodeURIComponent(m.id), { method: 'DELETE' })
      if (!resp.ok) { b.disabled = false; adminToast('Não consegui tirar do time.', false); return }
      // `loadAdminUsers`, e não `loadAdminEquipes`: quem sai do time reaparece
      // na lista de baixo, e só a primeira redesenha as duas.
      await loadAdminUsers()
    })
    faixa.appendChild(b)
  } else {
    const s = mkEl('span', 'eq-faixa-txt', 'não dá para tirar'); s.title = r.porque
    faixa.appendChild(s)
  }
  return faixa
}

// COLOCAR GENTE. Só quem ainda não está no time aparece — oferecer quem já está
// leva ao erro de chave repetida, que não diz nada a quem está usando.
function _eqColocarNoTime(t, meus, podeDar) {
  const cx = mkEl('div', 'eq-por')
  const dentro = new Set(meus.map((m) => String(m.profile_id)))
  const fora = _eqPessoas.filter((p) => !dentro.has(String(p.id)) && !p.disabled)

  const selP = mkEl('select', 'eq-faixa-sel eq-por-quem')
  const vazio = mkEl('option'); vazio.value = ''; vazio.textContent = 'Colocar alguém no time…'
  selP.appendChild(vazio)
  for (const p of fora) { const o = mkEl('option'); o.value = p.id; o.textContent = p.name || p.email; selP.appendChild(o) }

  const selPapel = mkEl('select', 'eq-faixa-sel')
  for (const p of podeDar) { const o = mkEl('option'); o.value = p.id; o.textContent = p.rotulo; selPapel.appendChild(o) }

  const b = mkEl('button', 'btn eq-faixa-btn', 'Colocar'); b.type = 'button'
  b.addEventListener('click', async () => {
    if (!selP.value) { adminToast('Escolha quem entra no time.', false); return }
    b.disabled = true
    const r = await adFetch('equipes_membros', { method: 'POST', body: JSON.stringify({ equipe_id: t.id, profile_id: selP.value, papel: selPapel.value || 'vendedora' }) })
    if (!r.ok) { b.disabled = false; adminToast('Não consegui colocar no time.', false); return }
    await loadAdminUsers()
  })
  cx.appendChild(selP); cx.appendChild(selPapel); cx.appendChild(b)
  return cx
}

// O miolo do card da loja: os cartões das pessoas daquele time.
function _eqDesenharPessoas(cx, t) {
  const eu = _eqEu()
  const meu = _eqMeuPapel(t.id)
  const meus = _eqMembros.filter((m) => String(m.equipe_id) === String(t.id))
  const podeDar = papeisQuePossoConceder(eu, meu)

  if (!meus.length) {
    cx.appendChild(mkEl('div', 'eq-vazio', 'Ninguém neste time ainda.'))
  }
  for (const m of meus) {
    const p = _eqLinhasPessoa.find((x) => String(x.id) === String(m.profile_id))
    if (!p) {
      // Membro sem cadastro em `profiles`: dizer isso é melhor que desenhar um
      // cartão vazio, e melhor ainda que sumir com a linha em silêncio.
      cx.appendChild(mkEl('div', 'eq-vazio', 'Um login deste time não existe mais em Usuários — tire do time.'))
      continue
    }
    const cartao = _criarLinhaPessoa(p, _eqGaveta, _eqMeuEmail)
    cartao.appendChild(_eqFaixaDoTime(m, { eu, meu, meus, t, podeDar }))
    cx.appendChild(cartao)
  }
  if (podeDar.length) cx.appendChild(_eqColocarNoTime(t, meus, podeDar))
}

// AS SUPERVISORAS DO GRUPO, dentro do card pai.
//
// ⚠️ O CARTÃO É O MESMO da lista de baixo (`_criarLinhaPessoa`), e não um
// parecido. Assim a foto, o botão Permissões e a troca de senha pela ficha vêm
// de graça e iguais aos de lá. Escrever um cartão "quase igual" aqui é como a
// caixinha de estoque ficou dois meses morta: controle novo que ninguém liga.
function _ligarSupervisorasDoGrupo(body) {
  const eu = { is_superadmin: estado.is_superadmin }

  for (const cx of body.querySelectorAll('[data-pai-gente]')) {
    const gid = cx.getAttribute('data-pai-gente')
    const minhas = _eqSupervisoras.filter((m) => String(m.grupo_id) === String(gid) && m.papel === 'supervisora')
    if (!minhas.length) {
      cx.innerHTML = '<div class="adm-pai-vazio">Nenhuma supervisora neste grupo ainda.</div>'
      continue
    }
    cx.innerHTML = ''
    for (const m of minhas) {
      const p = (_eqLinhasPessoa || []).find((x) => String(x.id) === String(m.profile_id))
      // Vínculo apontando para login que não existe mais NÃO some calado: some
      // sem explicação é como se descobre tarde que alguém ficou com acesso.
      if (!p) {
        const orfa = mkEl('div', 'adm-pai-vazio',
          'Um vínculo aponta para um login que não existe mais. Tire e ponha de novo.')
        cx.appendChild(orfa)
        continue
      }
      const linha = mkEl('div', 'adm-pai-linha')
      linha.appendChild(_criarLinhaPessoa(p, _eqGaveta, _eqMeuEmail))
      if (eu.is_superadmin) {
        const tirar = mkEl('button', 'btn btn-perigo adm-pai-tirar', 'Tirar do grupo')
        tirar.type = 'button'
        tirar.addEventListener('click', () => _tirarSupervisora(tirar, m, gid))
        linha.appendChild(tirar)
      }
      cx.appendChild(linha)
    }
  }

  for (const cx of body.querySelectorAll('[data-pai-por]')) {
    const gid = cx.getAttribute('data-pai-por')
    const jaSao = new Set(_eqSupervisoras
      .filter((m) => String(m.grupo_id) === String(gid))
      .map((m) => String(m.profile_id)))
    // Quem OFERECER: quem ainda não é supervisora deste grupo e não está
    // desativada. Oferecer quem já é faria um clique que não muda nada.
    const candidatas = (_eqLinhasPessoa || [])
      .filter((p) => !jaSao.has(String(p.id)) && !(p.bruto && p.bruto.disabled))
    cx.innerHTML = ''
    if (!candidatas.length) continue
    const sel = mkEl('select', 'admin-form-input adm-pai-sel')
    const vazio = document.createElement('option')
    vazio.value = ''; vazio.textContent = '— escolher quem supervisiona —'
    sel.appendChild(vazio)
    for (const p of candidatas) {
      const o = document.createElement('option')
      o.value = p.id; o.textContent = p.nome + (p.email ? ' · ' + p.email : '')
      sel.appendChild(o)
    }
    const b = mkEl('button', 'btn', 'Pôr como supervisora'); b.type = 'button'
    b.addEventListener('click', () => _porSupervisora(b, sel, gid))
    cx.appendChild(sel); cx.appendChild(b)
  }
}

const _avisoDoPai = (gid, texto, ruim) => {
  const el = document.querySelector('[data-pai-aviso="' + gid + '"]')
  if (!el) { adminToast(texto, !ruim); return }
  el.textContent = texto
  el.className = 'adm-pai-aviso' + (ruim ? ' adm-pai-erro' : '')
}

async function _porSupervisora(botao, sel, gid) {
  if (!sel.value) { _avisoDoPai(gid, 'Escolha uma pessoa antes.', true); return }
  botao.disabled = true; _avisoDoPai(gid, 'Pondo no grupo…', false)
  try {
    const r = await adFetch('canais_grupos_membros', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ grupo_id: gid, profile_id: sel.value, papel: 'supervisora' }),
    })
    if (!r.ok) throw new Error(await r.text())
    // A CONFERÊNCIA QUE NÃO PODE FALTAR: quando o RLS barra, o PostgREST
    // responde 200 com lista VAZIA. Sem contar, a tela diria "pronto" para um
    // vínculo de permissão que não existe — e ninguém descobriria até a pessoa
    // reclamar que não vê as lojas.
    const linhas = await r.json().catch(() => [])
    if (!Array.isArray(linhas) || !linhas.length) {
      throw new Error('o banco aceitou o pedido e não gravou nada — só o super-admin põe supervisora.')
    }
    await loadAdminEquipes()
    adminToast('Supervisora do grupo definida.')
  } catch (e) {
    botao.disabled = false
    _avisoDoPai(gid, String(e && e.message || e), true)
  }
}

async function _tirarSupervisora(botao, membro, gid) {
  const p = (_eqLinhasPessoa || []).find((x) => String(x.id) === String(membro.profile_id))
  const nome = p ? p.nome : 'esta pessoa'
  // TIRAR SUPERVISORA ENCOLHE O QUE ELA VÊ, e isso merece a pergunta — é o mesmo
  // cuidado que a tela já tem para excluir usuário.
  if (!window.confirm('Tirar ' + nome + ' da supervisão deste grupo? '
    + 'Ela deixa de ver o faturamento das lojas do grupo que não são do time dela.')) return
  botao.disabled = true; _avisoDoPai(gid, 'Tirando…', false)
  try {
    const r = await adFetch('canais_grupos_membros?id=eq.' + encodeURIComponent(membro.id), {
      method: 'DELETE', headers: { Prefer: 'return=representation' },
    })
    if (!r.ok) throw new Error(await r.text())
    const linhas = await r.json().catch(() => [])
    if (!Array.isArray(linhas) || !linhas.length) {
      throw new Error('o banco aceitou o pedido e não apagou nada — só o super-admin tira supervisora.')
    }
    await loadAdminEquipes()
    adminToast('Tirada da supervisão do grupo.')
  } catch (e) {
    botao.disabled = false
    _avisoDoPai(gid, String(e && e.message || e), true)
  }
}

function _eqLigar(body) {
  const q = (sel) => Array.from(body.querySelectorAll(sel))
  const um = (sel) => body.querySelector(sel)
  _ligarSupervisorasDoGrupo(body)
  const puxar = um('[data-vd-puxar]'); if (puxar) puxar.onclick = () => _vdPuxar()
  const fechar = um('[data-vd-fechar]'); if (fechar) fechar.onclick = () => { _vdLista = []; _vdSenhas = []; _vdMotivoVazio = ''; _vdPerfilId = ''; _eqDesenhar() }
  const criarTudo = um('[data-vd-criar-tudo]'); if (criarTudo) criarTudo.onclick = () => _vdCriarContas(criarTudo)
  q('[data-vd-criar]').forEach(cb => { cb.onchange = () => { _vdEscolhas[cb.getAttribute('data-vd-criar')].criar = cb.checked } })
  q('[data-vd-email]').forEach(i => { i.oninput = () => { _vdEscolhas[i.getAttribute('data-vd-email')].email = i.value } })
  q('[data-vd-equipe]').forEach(s2 => { s2.onchange = () => { _vdEscolhas[s2.getAttribute('data-vd-equipe')].equipe_id = s2.value } })
  const selPerfilVd = um('[data-vd-perfil]'); if (selPerfilVd) selPerfilVd.onchange = () => { _vdPerfilId = selPerfilVd.value }

  const novo = um('[data-eq-novo]'); if (novo) novo.onclick = () => { _eqEditando = 'novo'; _eqDesenhar() }
  q('[data-eq-editar]').forEach(b => { b.onclick = () => { _eqEditando = b.getAttribute('data-eq-editar'); _eqDesenhar() } })
  q('[data-eq-cancelar]').forEach(b => { b.onclick = () => { _eqEditando = null; _eqDesenhar() } })

  const salvar = um('[data-eq-salvar]')
  if (salvar) salvar.onclick = async () => {
    const id = salvar.getAttribute('data-eq-salvar') || null
    const val = (c) => { const el = um('[data-eq-campo="' + c + '"]'); return el ? el.value : '' }
    const dados = {
      id: id || undefined,
      nome: val('nome').trim(),
      tipo: val('tipo'),
      canal_loja_id: val('canal_loja_id') ? Number(val('canal_loja_id')) : null,
    }
    const erro = validarTime(dados, _eqTimes)
    const cxErro = um('[data-eq-erro]')
    if (erro) { if (cxErro) cxErro.textContent = erro; return }
    salvar.disabled = true; salvar.textContent = 'Salvando…'
    try {
      const corpo = { nome: dados.nome, tipo: dados.tipo, canal_loja_id: dados.canal_loja_id }
      const r = id
        ? await adFetch('equipes?id=eq.' + encodeURIComponent(id), { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(corpo) })
        : await adFetch('equipes', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(corpo) })
      if (!r.ok) throw new Error(await r.text())
      _eqEditando = null
      await loadAdminEquipes()
      adminToast(id ? 'Time atualizado.' : 'Time criado.', true)
    } catch (e) {
      salvar.disabled = false; salvar.textContent = 'Salvar'
      if (cxErro) cxErro.textContent = 'Não consegui salvar: ' + String(e && e.message || e)
    }
  }

  // AS PESSOAS DE CADA TIME. `_criarLinhaPessoa` devolve DOM, não texto — por
  // isso o card da loja sai do `innerHTML` com um lugar vazio e é preenchido
  // aqui. Se `loadAdminUsers` ainda não montou as linhas, o lugar fica vazio e
  // a próxima passada preenche (ela chama `loadAdminEquipes` no fim).
  q('[data-eq-pessoas]').forEach(cx => {
    const t = _eqTimes.find(x => String(x.id) === String(cx.getAttribute('data-eq-pessoas')))
    if (t) _eqDesenharPessoas(cx, t)
  })
}

/* ── SAÚDE DOS DADOS (legacy L4411-4522, verbatim) ── */
async function loadAdminSaude() {
  const body = document.getElementById('admin-saude-body'); if (!body) return
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
  const BTNP = 'style="border:none;background:var(--accent);color:var(--sobre-cor);border-radius:9px;padding:10px 18px;font-size:max(9px, calc(12.5px * var(--escala-texto, 1)));font-weight:700;cursor:pointer;box-shadow:0 6px 16px -8px var(--accent);"'
  const BTNS = 'style="border:1px solid var(--accent);color:var(--accent);background:transparent;border-radius:9px;padding:10px 14px;font-size:max(9px, calc(12px * var(--escala-texto, 1)));font-weight:600;cursor:pointer;"'
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
  const ST = { ok: ['✅', 'var(--green)'], warn: ['⚠️', 'var(--orange)'], fail: ['❌', 'var(--red)'] }
  const PERIODS = [0, 1, 7, 14, 30, 99]
  const post = async slug => { try { await fetch(SUPABASE_URL + '/functions/v1/' + slug, { method: 'POST', headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + (estado.currentSession?.access_token || SUPABASE_ANON_KEY), 'Content-Type': 'application/json' }, body: '{}' }) } catch (e) {} }
  const wire = () => {
    const fix = body.querySelector('.btn-fix')
    if (fix) fix.onclick = async () => { fix.disabled = true; const o = fix.textContent
      fix.textContent = '🔧 Coletando e corrigindo… (até ~1 min)'; await post('coletar-dados')
      fix.textContent = '🔎 Revalidando…'; await post('auditar-dados')
      await loadAdminSaude(); updateSaudeBadge() }
    const rev = body.querySelector('.btn-rev')
    if (rev) rev.onclick = async () => { rev.disabled = true; rev.textContent = '🔎 Revalidando…'; await post('auditar-dados'); await loadAdminSaude(); updateSaudeBadge() }
  }
  body.innerHTML = '<div style="color:var(--muted);font-size:max(9px, calc(12px * var(--escala-texto, 1)))">Carregando…</div>'
  const last = await sb('data_integrity_checks?select=checked_date&order=checked_date.desc&limit=1')
  const date = last.length ? last[0].checked_date : null
  const [rows, accs, engT, dayT] = await Promise.all([
    date ? sb('data_integrity_checks?checked_date=eq.' + date + '&select=account_id,check_name,status,detail,created_at&order=created_at.desc') : Promise.resolve([]),
    sb('accounts?select=id,name,username&order=name.asc'),
    sb('engagement_snapshots?captured_at=eq.' + today + '&select=account_id,period_days,likes,comments,saves,shares,reach,views,total_interactions,created_at'),
    sb('daily_snapshots?captured_at=eq.' + today + '&select=account_id,followers_count')
  ])
  const accMap = {}; accs.forEach(a => accMap[a.id] = a.name || a.username || '—')
  // ── cobertura da coleta de HOJE (ao vivo) ──
  const engBy = {}; engT.forEach(r => { (engBy[r.account_id] = engBy[r.account_id] || []).push(r) })
  const folBy = {}; dayT.forEach(r => { folBy[r.account_id] = r.followers_count })
  let lastColl = null; engT.forEach(r => { if (r.created_at && (!lastColl || r.created_at > lastColl)) lastColl = r.created_at })
  const cov = accs.map(a => {
    const e = engBy[a.id] || []; const periods = new Set(e.map(r => r.period_days))
    const missing = PERIODS.filter(p => !periods.has(p))
    const zeroBreak = e.filter(r => r.period_days >= 1 && (Number(r.total_interactions) || 0) > 0 && ((Number(r.likes) || 0) + (Number(r.comments) || 0) + (Number(r.saves) || 0) + (Number(r.shares) || 0)) === 0).map(r => r.period_days)
    const zeroReach = e.filter(r => r.period_days >= 1 && !((Number(r.reach) || 0) > 0)).map(r => r.period_days)
    const fol = Number(folBy[a.id]) || 0
    let st = 'ok'; if (!fol || missing.length === PERIODS.length) st = 'fail'; else if (zeroBreak.length || zeroReach.length) st = 'fail'; else if (missing.length) st = 'warn'
    return { a, fol, periods, missing, zeroBreak, zeroReach, st }
  })
  const covBad = cov.filter(c => c.st !== 'ok')
  const collected = cov.filter(c => c.fol > 0).length
  const complete = cov.filter(c => c.fol > 0 && c.missing.length === 0 && !c.zeroBreak.length && !c.zeroReach.length).length
  // ── auditoria (verificações noturnas) ──
  const CHECKS = [['frescor', 'Frescor'], ['bruto_seguidores', 'Bruto seg.'], ['eng_likes0', 'Curtidas'], ['aninhamento', 'Aninham.'], ['nav_soma', 'Navegação'], ['queda_seguidores', 'Queda seg.'], ['alcance_vs_views', 'Alc×Views'], ['meta_spotcheck', 'vs Meta']]
  const idx = {}; rows.forEach(r => { (idx[r.account_id] = idx[r.account_id] || {})[r.check_name] = r })
  const counts = { ok: 0, warn: 0, fail: 0 }; rows.forEach(r => { counts[r.status] = (counts[r.status] || 0) + 1 })
  const auditAt = rows.length ? new Date(rows[0].created_at).toLocaleString('pt-BR') : '—'
  const collAt = lastColl ? new Date(lastColl).toLocaleString('pt-BR') : '—'
  // saúde geral
  const totalFail = counts.fail + cov.filter(c => c.st === 'fail').length
  const totalWarn = counts.warn + cov.filter(c => c.st === 'warn').length
  const overall = totalFail ? ['❌', 'var(--red)', totalFail + ' problema' + (totalFail > 1 ? 's' : '') + ' a corrigir'] : totalWarn ? ['⚠️', 'var(--orange)', totalWarn + ' aviso' + (totalWarn > 1 ? 's' : '')] : ['✅', 'var(--green)', 'Tudo saudável']
  const card = (big, lbl, col) => '<div style="flex:1 1 130px;min-width:120px;background:var(--card,#fff);border:1px solid var(--border,#e5e7eb);border-radius:12px;padding:14px 16px;"><div style="font-size:max(16px, calc(26px * var(--escala-texto, 1)));font-weight:800;line-height:1;color:' + col + '">' + big + '</div><div style="font-size:max(9px, calc(10.5px * var(--escala-texto, 1)));letter-spacing:.5px;text-transform:uppercase;color:var(--muted);margin-top:6px">' + lbl + '</div></div>'
  // ── header ──
  let html = '<div style="display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;margin-bottom:16px;">'
  html += '<div style="display:flex;align-items:center;gap:12px;"><div style="font-size:max(16px, calc(30px * var(--escala-texto, 1)))">' + overall[0] + '</div><div><div style="font-size:max(16px, calc(17px * var(--escala-texto, 1)));font-weight:800;color:' + overall[1] + '">' + esc(overall[2]) + '</div><div style="font-size:max(9px, calc(11px * var(--escala-texto, 1)));color:var(--muted)">Coleta: <b>' + esc(collAt) + '</b> · Auditoria: <b>' + esc(auditAt) + '</b> · auto todo dia 23:30</div></div></div>'
  html += '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn-fix" ' + BTNP + '>🔧 Rodar e corrigir agora</button><button class="btn-rev" ' + BTNS + '>↻ Só revalidar</button></div></div>'
  // ── stat cards ──
  html += '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:18px">'
    + card(collected + '/' + accs.length, 'Contas coletadas hoje', collected === accs.length ? 'var(--green)' : 'var(--orange)')
    + card(complete + '/' + accs.length, 'Coleta completa', complete === accs.length ? 'var(--green)' : 'var(--orange)')
    + card(String(totalFail), 'Problemas (❌)', totalFail ? 'var(--red)' : 'var(--green)')
    + card(String(totalWarn), 'Avisos (⚠️)', totalWarn ? 'var(--orange)' : 'var(--green)')
    + '</div>'
  // ── seção A: cobertura da coleta de hoje ──
  html += '<div style="font-size:max(9px, calc(10px * var(--escala-texto, 1)));letter-spacing:1.5px;text-transform:uppercase;color:var(--muted);margin-bottom:8px">Coleta de hoje · por perfil</div>'
  html += '<div style="overflow-x:auto"><table class="metas-tbl"><thead><tr><th>Perfil</th><th style="text-align:center">Seguidores</th><th style="text-align:center">Períodos</th><th style="text-align:center">Curtidas</th><th style="text-align:center">Alcance</th><th style="text-align:center">Status</th></tr></thead><tbody>'
  cov.forEach(c => { const s = ST[c.st]
    html += '<tr><td style="font-weight:600">' + esc(c.a.name || c.a.username || '—') + '</td>'
      + '<td style="text-align:center;color:' + (c.fol > 0 ? 'var(--green)' : 'var(--red)') + '">' + (c.fol > 0 ? c.fol.toLocaleString('pt-BR') : '—') + '</td>'
      + '<td style="text-align:center;color:' + (c.missing.length ? 'var(--orange)' : 'var(--green)') + '" title="' + (c.missing.length ? 'faltam: ' + c.missing.map(p => p === 99 ? 'mês' : p + 'd').join(', ') : 'todos os 6 períodos') + '">' + (PERIODS.length - c.missing.length) + '/6</td>'
      + '<td style="text-align:center;color:' + (c.zeroBreak.length ? 'var(--red)' : 'var(--green)') + '" title="' + (c.zeroBreak.length ? 'zerado em: ' + c.zeroBreak.map(p => p === 99 ? 'mês' : p + 'd').join(', ') : 'ok') + '">' + (c.zeroBreak.length ? 'zerada' : 'ok') + '</td>'
      + '<td style="text-align:center;color:' + (c.zeroReach.length ? 'var(--red)' : 'var(--green)') + '">' + (c.zeroReach.length ? 'zerado' : 'ok') + '</td>'
      + '<td style="text-align:center;color:' + s[1] + '">' + s[0] + '</td></tr>'
  })
  html += '</tbody></table></div>'
  // ── seção B: auditoria noturna (matriz) ──
  html += '<div style="font-size:max(9px, calc(10px * var(--escala-texto, 1)));letter-spacing:1.5px;text-transform:uppercase;color:var(--muted);margin:20px 0 8px">Auditoria de qualidade · ' + (date ? esc(String(date)) : 'sem registro') + '</div>'
  if (!rows.length) { html += '<div style="font-size:max(9px, calc(12px * var(--escala-texto, 1)));color:var(--muted)">Nenhuma auditoria registrada ainda — clique em “Rodar e corrigir agora”.</div>' }
  else {
    html += '<div style="overflow-x:auto"><table class="metas-tbl"><thead><tr><th>Perfil</th>' + CHECKS.map(c => '<th style="text-align:center">' + c[1] + '</th>').join('') + '</tr></thead><tbody>'
    accs.forEach(a => { html += '<tr><td style="font-weight:600">' + esc(a.name || a.username || '—') + '</td>'
      CHECKS.forEach(c => { const r = idx[a.id] && idx[a.id][c[0]]; if (!r) { html += '<td style="text-align:center;color:var(--muted)">—</td>'; return }
        const s = ST[r.status] || ['?', 'var(--muted)']; html += '<td style="text-align:center;color:' + s[1] + '" title="' + esc(r.detail) + '">' + s[0] + '</td>' })
      html += '</tr>' })
    html += '</tbody></table></div>'
  }
  // ── problemas consolidados ──
  const probsAudit = rows.filter(r => r.status !== 'ok')
  if (covBad.length || probsAudit.length) {
    html += '<div style="margin-top:20px;font-size:max(9px, calc(10px * var(--escala-texto, 1)));letter-spacing:1.5px;text-transform:uppercase;color:var(--muted)">Problemas encontrados</div><div style="margin-top:8px;display:flex;flex-direction:column;gap:6px">'
    covBad.forEach(c => { const s = ST[c.st]; const probs = []; if (!c.fol) probs.push('sem coleta hoje'); if (c.zeroBreak.length) probs.push('curtidas zeradas (' + c.zeroBreak.map(p => p === 99 ? 'mês' : p + 'd').join(', ') + ')'); if (c.zeroReach.length) probs.push('alcance zerado (' + c.zeroReach.map(p => p === 99 ? 'mês' : p + 'd').join(', ') + ')'); if (c.missing.length && c.missing.length < PERIODS.length) probs.push('faltam períodos (' + c.missing.map(p => p === 99 ? 'mês' : p + 'd').join(', ') + ')')
      html += '<div style="font-size:max(9px, calc(12px * var(--escala-texto, 1)))"><span style="color:' + s[1] + '">' + s[0] + '</span> <b>' + esc(c.a.name || c.a.username || '?') + '</b> — ' + esc(probs.join(' · ')) + ' <span style="color:var(--accent);font-weight:600">→ corrigível ao rodar</span></div>' })
    probsAudit.forEach(r => { const s = ST[r.status]; const lbl = (CHECKS.find(c => c[0] === r.check_name) || ['', r.check_name])[1]
      html += '<div style="font-size:max(9px, calc(12px * var(--escala-texto, 1)))"><span style="color:' + s[1] + '">' + s[0] + '</span> <b>' + esc(accMap[r.account_id] || '?') + '</b> — ' + esc(lbl) + (r.detail ? ' <span style="color:var(--muted)">(' + esc(r.detail) + ')</span>' : '') + '</div>' })
    html += '</div>'
    html += '<div style="margin-top:12px;font-size:max(9px, calc(11px * var(--escala-texto, 1)));color:var(--muted);background:var(--card,#f8fafc);border:1px dashed var(--border,#e5e7eb);border-radius:10px;padding:10px 12px">🔧 <b>Rodar e corrigir agora</b> recoleta da Meta com 5 tentativas e, se ela insistir em zerar, mantém o último valor válido (carry-forward) — depois revalida. Curtidas/alcance/coleta faltando são corrigidos por aqui.</div>'
  } else { html += '<div style="margin-top:16px;color:var(--green);font-size:max(9px, calc(13px * var(--escala-texto, 1)));font-weight:700">✅ Nenhum problema — coleta de hoje completa e auditoria 100% OK.</div>' }
  html += '<details style="margin-top:18px"><summary style="cursor:pointer;font-size:max(9px, calc(11px * var(--escala-texto, 1)));color:var(--muted)">O que cada verificação significa</summary><div style="font-size:max(9px, calc(11px * var(--escala-texto, 1)));color:var(--muted);line-height:1.8;margin-top:8px">'
    + '<b>Coleta de hoje</b> — leitura ao vivo: cada perfil precisa ter seguidores + os 6 períodos (hoje/1/7/14/30/mês) com curtidas e alcance não-zerados.<br>'
    + '<b>Frescor</b> — os dados de hoje foram coletados (seguidores + engajamento + conteúdo).<br>'
    + '<b>Bruto seg.</b> — a métrica do IG de "seguiram − deixaram de seguir" está chegando. ⚠️ quando a Meta para de entregar (problema dela; o painel cai na contagem "em consolidação").<br>'
    + '<b>Curtidas</b> — não há curtidas zeradas com interações &gt; 0 (detecta resposta incompleta da Meta).<br>'
    + '<b>Aninham.</b> — 7 dias ≤ 14 dias ≤ 30 dias (consistência entre períodos).<br>'
    + '<b>Navegação</b> — o total de navegação dos stories bate com a soma dos 4 tipos.<br>'
    + '<b>Queda seg.</b> — queda de seguidores de um dia pro outro (⚠️ &gt; 10%, ❌ &gt; 25% — erro de dado ou evento em massa).<br>'
    + '<b>Alc×Views</b> — alcance vs visualizações coerente (não pode ter views sem alcance, nem alcance &gt; views).<br>'
    + '<b>vs Meta</b> — compara curtidas e alcance (7d) do painel com a <b>Meta ao vivo</b>; ❌ se divergir &gt; 30% (pega bug conceitual).</div></details>'
  body.innerHTML = html; wire()
}

/* ── PERMISSÕES (Fase 1: matriz recurso×ação + escopo por perfil + super-admin + duplicar) ── */
let _permState = null       // { userId, perfilId, permissions, allowed_accounts, is_superadmin }
let _contasCache = null     // perfis de rede (accounts)
let _usersCache = []        // lista de usuários (p/ o "duplicar")
let _perfisCache = []       // acessos_perfis (p/ "começar com o acesso de…" ao criar usuário — Task 5)

async function openPermModal(u, opcoes) {
  const soNotificacoes = !!(opcoes && opcoes.soNotificacoes)
  // Cada pessoa abre na primeira aba dela. Sem este reajuste, quem tivesse
  // acabado de olhar o cadastro de alguém abriria a próxima pessoa direto no
  // cadastro — e leria a situação de uma como se fosse a da outra.
  _permAba = soNotificacoes ? 'avisos' : 'ferramentas'
  _permState = {
    userId: u.id,
    // Em que perfil esta pessoa está, se está em algum. Não é enfeite: é o que
    // permite `savePermissions` separar "veio do perfil" de "alguém deu de
    // propósito" e gravar a segunda metade em `permissions_excecao` (D9). Vem
    // de `loadAdminUsers`, que já traz `perfil_id` no select de `profiles`.
    perfilId: u.perfil_id || null,
    permissions: JSON.parse(JSON.stringify(u.permissions || {})),
    allowed_accounts: u.allowed_accounts ?? null,
    is_superadmin: !!u.is_superadmin,
    // `!== false`, e não `=== true`: coluna ausente no select não pode virar
    // "vê todos os canais" por omissão. Errar para o lado restritivo é o erro
    // barato — o outro entrega faturamento de loja alheia.
    escopo_por_equipe: u.escopo_por_equipe !== false,
    // O valor de ANTES, para saber se a pessoa mexeu nele. Sem guardar isto, o
    // salvamento não teria como perguntar só quando muda — e perguntar sempre
    // ensina a clicar em "ok" sem ler.
    escopoOriginal: u.escopo_por_equipe !== false,
    // { vendas: true, saldo: false } — o estado resolvido (preferência salva ou
    // o padrão do tipo).
    notificacoes: {},
    // No modo "minhas notificações" o save NÃO toca em permissions/features:
    // editar os próprios privilégios é exatamente o que a tela impede.
    soNotificacoes,
  }
  // As preferências vêm por usuário; sem linha salva vale o padrão do tipo.
  let prefs = []
  try {
    const r = await adFetch(`push_preferencias?select=user_id,tipo,ativo&user_id=eq.${u.id}`)
    prefs = await r.json()
  } catch { prefs = [] }
  for (const t of TIPOS_DE_NOTIFICACAO) _permState.notificacoes[t.chave] = querReceber(prefs, u.id, t.chave)
  const sub = document.getElementById('perm-modal-user'); sub.textContent = ''
  const strong = document.createElement('strong'); strong.textContent = u.name || u.email
  sub.appendChild(strong); sub.appendChild(document.createTextNode(' · ' + u.email))
  if (!_contasCache) { try { const r = await adFetch('accounts?select=id,name&order=name'); _contasCache = await r.json() } catch { _contasCache = [] } }
  _renderPermBody(u)
  document.getElementById('perm-modal-overlay').classList.add('open')
}

// `??` e não `||`: com `||`, passar mt=0 caía no default 6 — o topo da matriz
// pede margem 0 de verdade.
function _lbl10(txt, mt) { const d = document.createElement('div'); d.textContent = txt; d.style.cssText = `font-size:max(9px, calc(10px * var(--escala-texto, 1)));letter-spacing:1.5px;color:var(--muted);font-weight:700;margin:${mt ?? 6}px 0 6px`; return d }

// Checkbox "marcar/desmarcar tudo" de uma lista de recursos. O MESMO builder
// serve o global (recebe RECURSOS inteiro) e o de cada card (recebe só os
// recursos daquela ferramenta) — quem define o escopo é o parâmetro, então não
// existe uma segunda regra de "marcar tudo" pra sair de sincronia.
//
// Parcial vira indeterminate (o tracinho): 'cheio' e 'vazio' já são checked/
// unchecked, mas sem o indeterminate um grupo meio marcado mentiria dizendo
// "desmarcado". Clicar num parcial LIGA tudo (só desliga a partir do cheio).
function _mkMarcarTudo(texto, recursos, u) {
  const estadoSel = estadoDaSelecao(recursos, _permState.permissions)
  const w = document.createElement('label'); w.className = 'perm-marcar-tudo'
  const cb = document.createElement('input'); cb.type = 'checkbox'
  cb.checked = estadoSel === 'cheio'
  cb.indeterminate = estadoSel === 'parcial'
  cb.setAttribute('aria-label', `${texto} (${recursos.length} ${recursos.length === 1 ? 'recurso' : 'recursos'})`)
  cb.addEventListener('change', () => {
    _permState.permissions = marcarTudo(_permState.permissions, recursos, estadoSel !== 'cheio')
    _renderPermBody(u)
  })
  const t = document.createElement('span'); t.textContent = texto
  w.appendChild(cb); w.appendChild(t)
  return w
}

// As PRÓPRIAS notificações: mesmo card, mesmo salvamento, sem a matriz de
// permissões junto — que é justamente o que não se pode editar em si mesmo.
async function _abrirMinhasNotificacoes(u) {
  await openPermModal(u, { soNotificacoes: true })
}

// Um interruptor por tipo de notificação, com a descrição do que chega e
// quando. Sem a descrição, "Saldo" sozinho não diz se avisa todo dia ou só
// quando acaba — e quem decide ligar precisa saber o que está ligando.
function _mkBlocoNotificacoes() {
  const card = document.createElement('section'); card.className = 'perm-card'
  const hdr = document.createElement('div'); hdr.className = 'perm-card-hdr'
  const t = document.createElement('span'); t.className = 'perm-card-titulo'; t.textContent = 'Notificações no celular'
  const n = Object.values(_permState.notificacoes).filter(Boolean).length
  const c = document.createElement('span'); c.className = 'perm-card-contagem'
  c.textContent = `${n} de ${TIPOS_DE_NOTIFICACAO.length}`
  hdr.appendChild(t); hdr.appendChild(c); card.appendChild(hdr)

  const lista = document.createElement('div'); lista.className = 'perm-notif-lista'
  for (const tipo of TIPOS_DE_NOTIFICACAO) {
    const linha = document.createElement('label'); linha.className = 'perm-notif'
    const cb = document.createElement('input'); cb.type = 'checkbox'
    cb.checked = !!_permState.notificacoes[tipo.chave]
    cb.addEventListener('change', () => {
      _permState.notificacoes[tipo.chave] = cb.checked
      c.textContent = `${Object.values(_permState.notificacoes).filter(Boolean).length} de ${TIPOS_DE_NOTIFICACAO.length}`
    })
    const txt = document.createElement('div'); txt.className = 'perm-notif-txt'
    const rot = document.createElement('span'); rot.className = 'perm-notif-rot'; rot.textContent = tipo.rotulo
    const des = document.createElement('span'); des.className = 'perm-notif-des'; des.textContent = tipo.descricao
    txt.appendChild(rot); txt.appendChild(des)
    linha.appendChild(cb); linha.appendChild(txt)
    lista.appendChild(linha)
  }
  card.appendChild(lista)
  const nota = document.createElement('div'); nota.className = 'perm-notif-nota'
  nota.textContent = 'A pessoa só recebe se também tiver autorizado as notificações no aparelho dela.'
  card.appendChild(nota)
  return card
}

/* ── AS TRÊS ABAS DENTRO DA PESSOA (D6) ──────────────────────────────────────
 *
 * Estavam as três coisas numa janela só — o que ela abre, se o celular dela
 * toca e a qual colaborador o login pertence — e era uma das quatro queixas do
 * dono. Nada mudou de acesso aqui: os MESMOS blocos, pendurados em abas.
 *
 * A aba escolhida mora fora do `_permState` de propósito: `_permState` vira
 * null ao fechar o modal, e a aba é da tela, não do que se salva.
 */
let _permAba = 'ferramentas'

// O aviso de propagação incompleta (D8/D11). Mora fora do `_permState` pelo
// mesmo motivo da aba: ele é da tela, não do que se salva.
//
// POR QUE ELE EXISTE: quando a propagação de um perfil falha para alguém, o
// perfil JÁ FOI GRAVADO e aquela pessoa ficou com o acesso antigo — perfil e
// pessoas divergem. Essa notícia num toast some em 2,8 segundos e não deixa
// rastro nenhum: quem desviasse o olhar ficaria achando que aplicou em todo
// mundo, e a divergência não reapareceria em lugar nenhum. Por isso ela vira
// faixa que fica até alguém fechar.
let _permAvisoPropagacao = null

// A faixa fica no TOPO DA ABA, e nunca um `alert()` nativo: o alert trava a
// tela num botão "OK" e some sem deixar rastro — mas o que ele tinha a dizer
// continua verdadeiro depois do OK. Pelo mesmo motivo ela também não é um
// toast: toast some em 2,8s (avisos.js) e leva a notícia junto.
//
// `aoFechar` é opcional: quando vem, a faixa ganha um botão de dispensar e só
// sai da tela por decisão de gente. Quem não passa nada continua com a faixa de
// antes, sem botão — o aviso do elo faltante some sozinho quando o elo é feito.
// Uma linha por `\n`, porque `textContent` não quebra linha sozinho.
function _mkFaixaDeAviso(texto, aoFechar) {
  const f = document.createElement('div'); f.className = 'perm-faixa-aviso'
  f.setAttribute('role', 'status')
  for (const linha of String(texto).split('\n')) {
    const l = document.createElement('div'); l.textContent = linha; f.appendChild(l)
  }
  if (aoFechar) {
    const acao = document.createElement('div'); acao.className = 'perm-faixa-aviso-acao'
    const b = document.createElement('button'); b.type = 'button'
    b.className = 'btn'            // comum: dispensar não é a ação principal de nada
    b.textContent = 'Entendi, fechar aviso'
    b.addEventListener('click', aoFechar)
    acao.appendChild(b); f.appendChild(acao)
  }
  return f
}

// A barra das abas. Classe `.abas` compartilhada (a mesma da Frota, do
// Patrimônio e dos Acessos), cujo estado ativo é `on` — e não `active`.
function _mkBarraDeAbas(abas, u) {
  const barra = document.createElement('div'); barra.className = 'abas perm-abas'
  barra.setAttribute('role', 'tablist')
  for (const a of abas) {
    const b = document.createElement('button'); b.type = 'button'
    b.dataset.aba = a.chave
    b.classList.toggle('on', a.chave === _permAba)
    b.setAttribute('role', 'tab')
    b.setAttribute('aria-selected', a.chave === _permAba ? 'true' : 'false')
    b.appendChild(document.createTextNode(a.rotulo))
    // O ponto só existe quando há o que dizer — aviso que aparece sempre vira
    // paisagem. Sem ele, a falta do elo só apareceria para quem CLICASSE na
    // aba, e a lacuna continuaria escondida em quase todas as pessoas.
    if (a.aviso) {
      const ponto = document.createElement('span')
      ponto.className = 'perm-aba-ponto'; ponto.setAttribute('aria-hidden', 'true')
      b.appendChild(ponto)
      b.title = a.aviso
    }
    b.addEventListener('click', () => { _permAba = a.chave; _renderPermBody(u) })
    barra.appendChild(b)
  }
  return barra
}

// O CADASTRO é a MESMA seção da ficha da pessoa, botões de ligar e criar
// inclusive. Reescrevê-la aqui daria duas telas para a mesma decisão, e essa
// decisão é cara de errar: casar o login com o colaborador errado dá a lotação
// e o histórico de uma pessoa para outra.
function _abaDeCadastro(painel, u) {
  _secaoVinculo(painel, { id: u.id, email: u.email, bruto: u }, async () => {
    // NÃO fecha o modal: quem já mexeu na matriz e ainda não salvou perderia o
    // que mexeu, sem aviso nenhum. Relê os colaboradores e redesenha a aba com
    // o elo novo. `_permState` pode ter virado null se alguém fechou no meio.
    await loadAdminUsers()
    if (_permState) _renderPermBody(u)
  })
}

function _renderPermBody(u) {
  const body = document.getElementById('perm-modal-body'); body.replaceChildren()
  // Quem responde se o elo existe é `estadoDoVinculo` — a MESMA regra da ficha
  // e do subtítulo da lista. Uma segunda regra aqui daria duas respostas
  // diferentes para a mesma pergunta, e uma delas estaria errada.
  const { estado: situacaoDoVinculo } = estadoDoVinculo({ id: u.id, email: u.email }, _colaboradores)
  const abas = abasDaPessoa({
    soNotificacoes: _permState.soNotificacoes,
    temVinculo: situacaoDoVinculo === 'ligado',
  })
  // No modo "minhas notificações" só existe a aba de avisos; uma aba escolhida
  // que não está mais na lista cairia num painel vazio.
  if (!abas.some((a) => a.chave === _permAba)) _permAba = abas[0].chave
  body.appendChild(_mkBarraDeAbas(abas, u))

  // Antes das abas e acima de tudo: propagação que ficou pela metade vale para
  // o modal inteiro, não para uma aba só, e não pode depender de a pessoa
  // clicar na aba certa para descobrir.
  if (_permAvisoPropagacao) {
    body.appendChild(_mkFaixaDeAviso(_permAvisoPropagacao, () => {
      _permAvisoPropagacao = null
      _renderPermBody(u)
    }))
  }

  const painel = document.createElement('div'); painel.className = 'perm-aba-painel'
  painel.setAttribute('role', 'tabpanel')
  body.appendChild(painel)

  const escolhida = abas.find((a) => a.chave === _permAba)
  if (escolhida.aviso) painel.appendChild(_mkFaixaDeAviso(escolhida.aviso))

  // AVISOS. Vale para todo mundo, super-admin inclusive: acesso total não quer
  // dizer "recebe todo aviso no celular". E no modo "minhas notificações" esta
  // é a única aba — sem o interruptor de super-admin junto, que é justamente o
  // que ninguém pode mexer em si mesmo.
  if (_permAba === 'avisos') { painel.appendChild(_mkBlocoNotificacoes()); return }
  if (_permAba === 'cadastro') { _abaDeCadastro(painel, u); return }
  _abaDeFerramentas(painel, u)
}

// O QUE ELA ABRE. Bloco inteiro como já estava — super-admin, a matriz por
// ferramenta, os perfis de rede e o duplicar. Só mudou onde é pendurado: era
// direto no corpo do modal, agora é no painel da aba. As notificações saíram
// daqui porque não são permissão.
//
// O parâmetro se chama `body` de propósito: é o mesmo nó que estas linhas
// sempre receberam, e trocar o nome só criaria diferença onde não há mudança.
function _abaDeFerramentas(body, u) {
  // 1) Super-admin
  const saRow = document.createElement('label'); saRow.style.cssText = 'display:flex;align-items:center;gap:8px;cursor:pointer;border-bottom:2px solid var(--border);padding-bottom:10px;margin-bottom:8px'
  const saCb = document.createElement('input'); saCb.type = 'checkbox'; saCb.checked = _permState.is_superadmin
  saCb.addEventListener('change', () => { _permState.is_superadmin = saCb.checked; _renderPermBody(u) })
  const saTxt = document.createElement('span'); saTxt.textContent = 'Super-admin (vê tudo · gerencia permissões)'; saTxt.style.cssText = 'font-weight:700;font-size:max(9px, calc(13px * var(--escala-texto, 1)))'
  saRow.appendChild(saCb); saRow.appendChild(saTxt); body.appendChild(saRow)
  // As NOTIFICAÇÕES ficavam aqui, antes do desvio de super-admin, para que
  // super-admin também escolhesse o que chega no celular. Foram inteiras para
  // a aba "Avisos no celular", que aparece para todo mundo — inclusive para
  // super-admin, que nem chega a ver o resto desta aba.
  if (_permState.is_superadmin) {
    const info = document.createElement('div'); info.textContent = 'Super-admin tem acesso total — permissões e perfis não se aplicam.'; info.style.cssText = 'font-size:max(9px, calc(12px * var(--escala-texto, 1)));color:var(--muted);padding:6px 0'
    body.appendChild(info); return
  }
  // 2) Escada de níveis por recurso, agrupada por ferramenta (um card por
  // ferramenta).
  //
  // Cada ferramenta é UMA escolha (Sem acesso / Ver / Mexer / Tudo — conforme
  // o que aquele recurso realmente tem no catálogo), não mais uma linha de 5
  // caixinhas. Era a matriz que fazia 105 células parecerem 105 escolhas
  // quando só 45 existiam de verdade, e metade dessas 45 nunca foi marcada em
  // produção (ver niveis-de-permissao.js).
  //
  // Os grupos saem de agruparRecursos(RECURSOS, PERMISSION_TREE): derivados da
  // chave ('social.relatorio' → ferramenta 'social'). Nenhuma lista de grupos
  // escrita à mão aqui — catálogo paralelo é dívida que este projeto já paga.
  const grupos = agruparRecursos(RECURSOS, PERMISSION_TREE)

  const topo = document.createElement('div'); topo.className = 'perm-matriz-topo'
  topo.appendChild(_lbl10('PERMISSÕES', 0))
  topo.appendChild(_mkMarcarTudo('Marcar tudo', RECURSOS, u))
  body.appendChild(topo)

  grupos.forEach(g => {
    const card = document.createElement('section'); card.className = 'perm-card'

    const hdr = document.createElement('div'); hdr.className = 'perm-card-hdr'
    const titulo = document.createElement('span'); titulo.className = 'perm-card-titulo'; titulo.textContent = g.label
    const { total, marcadas } = contarAcoes(g.recursos, _permState.permissions)
    const contagem = document.createElement('span'); contagem.className = 'perm-card-contagem'
    contagem.textContent = `${marcadas} de ${total}`
    hdr.appendChild(titulo); hdr.appendChild(contagem)
    hdr.appendChild(_mkMarcarTudo('Tudo', g.recursos, u))
    card.appendChild(hdr)

    // Cada recurso vira uma linha: a escada de degraus, exceto as chaves de
    // "aprovar" (frota.aprovar, conteudo.aprovar) — essas são uma caixinha só,
    // porque "Pode ver" não diz o que elas realmente liberam.
    g.recursos.forEach(r => {
      card.appendChild(APROVACOES[r.key] ? _linhaDeAprovacao(r, u) : _linhaDeNivel(r, u))
    })
    body.appendChild(card)
  })
  // 2b) DE QUAIS CANAIS DE VENDA ELA VÊ O FATURAMENTO
  //
  // Veio da seção de times (12/08/2026) para cá, e este é o lugar certo:
  // `escopo_por_equipe` é da PESSOA e vale no sistema inteiro, não de um time.
  // Numa caixinha dentro do card da loja, ela mentia por omissão — parecia
  // dizer respeito só àquela loja.
  //
  // Só super-admin mexe: desligar abre TODOS os canais, inclusive os de times
  // que quem clica não administra. É a regra de ouro dos times ao contrário
  // ("ninguém concede o que não tem").
  body.appendChild(_lbl10('CANAIS DE VENDA', 12))
  const escLinha = document.createElement('label')
  escLinha.style.cssText = 'display:flex;align-items:flex-start;gap:6px;font-size:max(9px, calc(12px * var(--escala-texto, 1)));cursor:pointer;padding:3px 0;font-weight:600'
  const escCb = document.createElement('input'); escCb.type = 'checkbox'
  escCb.checked = _permState.escopo_por_equipe
  // A REGRA vem do módulo puro e testado, não de um `if` reescrito aqui: é o
  // jeito de a tela e o teste não contarem histórias diferentes sobre quem pode.
  escCb.disabled = !podeMudarEscopo({ is_superadmin: estado.is_superadmin })
  escCb.addEventListener('change', () => { _permState.escopo_por_equipe = escCb.checked; _renderPermBody(u) })
  escLinha.appendChild(escCb)
  escLinha.appendChild(document.createTextNode('Só os canais dos times dela'))
  body.appendChild(escLinha)
  // A FRASE DO EFEITO, sempre visível — o mesmo princípio do resto deste
  // editor: a linha diz o que aquele estado FAZ, em vez de deixar adivinhar.
  const escTxt = document.createElement('div')
  escTxt.style.cssText = 'font-size:max(9px, calc(11px * var(--escala-texto, 1)));color:var(--muted);margin:2px 0 0 22px;line-height:1.45'
  escTxt.textContent = oQueVeDeVendas({
    pessoa: { ...u, escopo_por_equipe: _permState.escopo_por_equipe },
    times: _eqTimes, membros: _eqMembros, canais: _eqCanais,
  }).frase + (estado.is_superadmin ? '' : ' Só um super-admin muda isto.')
  body.appendChild(escTxt)

  // 3) Perfis de rede social
  body.appendChild(_lbl10('PERFIS DE REDE SOCIAL', 12))
  const todos = document.createElement('label'); todos.style.cssText = 'display:flex;align-items:center;gap:5px;font-size:max(9px, calc(12px * var(--escala-texto, 1)));cursor:pointer;padding:3px 0;font-weight:600'
  const todosCb = document.createElement('input'); todosCb.type = 'checkbox'; todosCb.checked = _permState.allowed_accounts === null
  todosCb.addEventListener('change', () => { _permState.allowed_accounts = todosCb.checked ? null : []; _renderPermBody(u) })
  todos.appendChild(todosCb); todos.appendChild(document.createTextNode('Todos os perfis')); body.appendChild(todos)
  if (_permState.allowed_accounts !== null) {
    (_contasCache || []).forEach(c => {
      const w = document.createElement('label'); w.style.cssText = 'display:flex;align-items:center;gap:5px;font-size:max(9px, calc(12px * var(--escala-texto, 1)));cursor:pointer;padding:3px 0 3px 16px'
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = (_permState.allowed_accounts || []).includes(c.id)
      cb.addEventListener('change', () => {
        const arr = (_permState.allowed_accounts || []).slice()
        if (cb.checked) { if (!arr.includes(c.id)) arr.push(c.id) } else { const i = arr.indexOf(c.id); if (i >= 0) arr.splice(i, 1) }
        _permState.allowed_accounts = arr
      })
      w.appendChild(cb); w.appendChild(document.createTextNode(c.name)); body.appendChild(w)
    })
  }
  // 4) Duplicar de outro usuário
  body.appendChild(_lbl10('DUPLICAR PERMISSÕES DE', 12))
  const dupRow = document.createElement('div'); dupRow.style.cssText = 'display:flex;gap:6px;align-items:center'
  const dupSel = mkEl('select', 'admin-form-input'); dupSel.style.cssText = 'flex:1;font-size:max(9px, calc(12px * var(--escala-texto, 1)));padding:5px'
  dupSel.appendChild(new Option('— escolher usuário —', ''))
  _usersCache.filter(x => x.id !== u.id).forEach(x => dupSel.appendChild(new Option(x.name || x.email, x.id)))
  const dupBtn = mkEl('button', 'btn btn-principal'); dupBtn.textContent = 'Aplicar'
  dupBtn.addEventListener('click', () => {
    const src = _usersCache.find(x => x.id === dupSel.value); if (!src) return
    _permState.permissions = JSON.parse(JSON.stringify(src.permissions || {}))
    _permState.allowed_accounts = src.allowed_accounts ?? null
    _permState.is_superadmin = false
    _renderPermBody(u); adminToast('Permissões copiadas — salve para aplicar')
  })
  dupRow.appendChild(dupSel); dupRow.appendChild(dupBtn); body.appendChild(dupRow)

  // 5) Salvar como perfil — D7: o perfil nasce de alguém que já está certo. Não
  // existe taxonomia de cargo neste banco — 21 das 26 pessoas têm o campo
  // vazio —, então pedir pra classificar todo mundo antes de usar mataria a
  // funcionalidade na primeira semana. Copiar de uma pessoa real é o caminho
  // que funciona no dia 1. Botão comum (não principal): "Aplicar" já é a ação
  // principal deste bloco.
  //
  // Revisão: a policy `acessos_perfis_escrever` (039_perfis_de_acesso.sql) é
  // SÓ superadmin. Um admin comum que clicasse sempre bateria em 403 com um
  // toast genérico — o botão nem deveria existir pra ele. Mesmo gate que já
  // existe no arquivo para `_secaoSenha` (:1642) e para a Administração
  // inteira (onMounted, :2670): `if (estado.is_superadmin)`.
  if (estado.is_superadmin) {
    const btnPerfil = mkEl('button', 'btn')
    btnPerfil.type = 'button'
    btnPerfil.textContent = 'Salvar como perfil'
    btnPerfil.style.cssText = 'margin-top:8px'
    btnPerfil.addEventListener('click', async () => {
      // `uiPrompt`/`uiConfirm` NÃO EXISTEM neste projeto (são de outro projeto
      // do dono). O que existe aqui é `_gtConfirmAdmin`, que só confirma — não
      // pede texto. Como o nome do perfil precisa ser digitado, `window.prompt`
      // é o caminho coerente com o que o arquivo já faz para confirmar; não há
      // proibição a diálogo nativo em PADRAO-DA-CENTRAL.md (conferido por
      // leitura).
      const nome = window.prompt('Nome do perfil (ex.: Vendedora)')
      if (!nome || !nome.trim()) return
      const nomeLimpo = String(nome).trim()
      // Cópia do mapa que está aberto na ficha. Cópia, e não a referência, para
      // que fechar/mexer no editor enquanto as chamadas de rede acontecem não
      // troque por baixo o que está sendo gravado e propagado.
      const novasPermissions = JSON.parse(JSON.stringify(_permState.permissions || {}))
      const r = await adFetch('acessos_perfis', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        // `criado_por`: a coluna existe pra rastrear quem criou o perfil e não
        // tem default (039_perfis_de_acesso.sql) — sem gravar aqui, fica
        // sempre NULL. `estado.userId` é o campo certo (mesmo usado em
        // `alterado_por: estado.userId`, ~L1500).
        body: JSON.stringify({ nome: nomeLimpo, permissions: novasPermissions, criado_por: estado.userId }),
      })
      // `nome` é unique na tabela (039_perfis_de_acesso.sql) — nome repetido
      // devolve 409. Isso NÃO é erro: é o único jeito que esta fase tem de
      // mudar o mapa de um perfil que já existe ("salvando de novo a partir de
      // uma pessoa", plano de 11/08). E é exatamente aí que D8 acontece —
      // regravar o perfil muda o acesso de todo mundo que está nele. Por isso
      // este caminho passa OBRIGATORIAMENTE pela confirmação de impacto (D11).
      if (r.status === 409) { await _regravarPerfilExistente(nomeLimpo, novasPermissions, u); return }
      if (!r.ok) { adminToast('Não consegui salvar o perfil', false); return }
      // Perfil recém-criado não tem ninguém dentro (`perfil_id` de ninguém
      // aponta pra ele ainda), então nenhum acesso de terceiro muda aqui. O que
      // muda é a pessoa DESTA ficha, e só se ela for perguntada — I4, logo
      // abaixo. UM toast só, no fim: dizer "criado" agora e "entrou" depois
      // seriam duas frases sobre o mesmo clique, e a primeira sumiria por trás
      // da janela de confirmação.
      const criadas = await r.json().catch(() => null)
      const novoPerfil = Array.isArray(criadas) ? criadas[0] : null
      if (!novoPerfil || !novoPerfil.id) {
        adminToast(`O perfil "${nomeLimpo}" foi criado, mas não consegui ler o id dele — ninguém entrou no perfil.`, false)
        return
      }
      // O perfil recém-criado ainda não está em `_perfisCache` (ele só recarrega
      // em `loadAdminUsers`). Sem pôr aqui, um "Salvar" logo em seguida nesta
      // mesma ficha não acharia o mapa do perfil e deixaria de gravar a exceção.
      _perfisCache = [...(_perfisCache || []), { id: novoPerfil.id, nome: nomeLimpo, permissions: novasPermissions }]
      await _porPessoaNoPerfil(u, novoPerfil.id, nomeLimpo)
    })
    body.appendChild(btnPerfil)
  }
}

/**
 * I4 — PÔR NO PERFIL A PESSOA CUJA FICHA ORIGINOU ELE.
 *
 * POR QUE ISTO EXISTE (revisão final de 12/08/2026): `perfil_id` só era escrito
 * no convite. "Salvar como perfil" criava o perfil e não punha ninguém dentro —
 * nem a própria pessoa de quem ele foi copiado. Efeito em cascata: nos primeiros
 * usos a lista de membros vinha vazia, o impacto dava sempre zero e a janela de
 * confirmação (D11) NUNCA aparecia. O dono aprenderia que "salvar perfil não
 * pergunta nada", e a janela iria surpreendê-lo justamente no dia em que houver
 * gente para mudar — que é o dia em que ela precisa ser lida.
 *
 * PERGUNTA ANTES porque entrar num perfil VIVO tem consequência futura: daí em
 * diante toda regravação do perfil mexe no acesso dela. Agora não muda nada — o
 * perfil é cópia exata do que está na ficha —, e é isso que o texto diz.
 *
 * A exceção nasce `{}` pelo mesmo motivo: neste instante não existe nada "dado
 * à mão" além do perfil para preservar.
 */
async function _porPessoaNoPerfil(u, perfilId, nomePerfil) {
  const quem = u.name || u.email
  const ok = await _gtConfirmAdmin(
    `Pôr ${quem} dentro do perfil "${nomePerfil}"?`,
    `Ela passa a receber as mudanças dele: toda vez que alguém regravar o perfil "${nomePerfil}", `
    + `o acesso de ${quem} muda junto.\n\n`
    + 'Agora nada muda no acesso dela — o perfil é uma cópia exata do que está nesta ficha.\n\n'
    + 'Se disser não, o perfil fica criado do mesmo jeito e ela continua fora dele.',
  )
  if (!ok) { adminToast(`Perfil "${nomePerfil}" criado — ${quem} continua fora dele.`); return }
  let r = null
  try {
    r = await adFetch('profiles?id=eq.' + encodeURIComponent(u.id), {
      method: 'PATCH',
      // Mesma exigência dos outros PATCHes desta tela: RLS que filtra a linha
      // devolve 204 com `.ok === true` e zero linha alterada. Sem exigir a linha
      // de volta, a tela diria que pôs a pessoa no perfil sem ter posto.
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ perfil_id: perfilId, permissions_excecao: {} }),
    })
  } catch { r = null }
  const linhas = r && r.ok ? await r.json().catch(() => null) : null
  if (!Array.isArray(linhas) || linhas.length === 0) {
    adminToast(`O perfil "${nomePerfil}" foi criado, mas não consegui pôr ${quem} dentro dele — ela continua fora do perfil.`, false)
    return
  }
  // O editor continua aberto nesta ficha: sem atualizar o estado, um "Salvar"
  // logo em seguida acharia que ela não está em perfil nenhum e não gravaria a
  // exceção (D9).
  if (_permState && _permState.userId === u.id) _permState.perfilId = perfilId
  adminToast(`Perfil "${nomePerfil}" criado, e ${quem} está dentro dele.`)
}

// O nome que o dono lê. `patrimonio` e `meta.gestor` são chave de banco; a
// confirmação de impacto é o texto que ele lê ANTES de mudar o acesso de
// outras pessoas, e não pode estar em jargão de código. Chave que não estiver
// no catálogo cai na própria chave, em vez de sumir do texto.
function _rotuloDoRecurso(chave) {
  const r = RECURSOS.find(x => x.key === chave)
  return r ? r.label : chave
}

/**
 * D8 + D11 — SENSITIVE MUTATION: regravar um perfil MUDA O ACESSO DE TODO
 * MUNDO que está nele, de uma vez.
 *
 * O dono escolheu o perfil vivo ciente do risco (D8 do desenho de 11/08/2026).
 * Esta função é a única proteção que sobrou: antes de gravar qualquer coisa ela
 * NOMEIA as pessoas e diz o que cada uma perde, ganha ou tem trocado de nível.
 * Sem essa confirmação, a propagação não vai ao ar — está escrito no desenho, e
 * vale como regra: se um dia alguém precisar mexer aqui, some com a propagação
 * junto, não com o aviso.
 *
 * A ordem importa e não é acidental:
 *   1. ler quem está no perfil     — sem essa lista não dá pra confirmar nada;
 *   2. confirmar com nome e perda  — a única chance do dono dizer "não";
 *   3. gravar o perfil;
 *   4. propagar pessoa por pessoa.
 * Qualquer passo que falhe interrompe tudo ANTES de mexer em gente.
 *
 * `u` é a pessoa cuja ficha está aberta — precisa dela para redesenhar o editor
 * quando a propagação fica pela metade e o modal continua aberto com o aviso.
 */
async function _regravarPerfilExistente(nome, novasPermissions, u) {
  // 1) Achar o perfil pelo nome (é `unique` na tabela, então é no máximo um).
  let perfil = null
  try {
    const rP = await adFetch('acessos_perfis?select=id,nome&nome=eq.' + paraEq(nome))
    const jP = rP.ok ? await rP.json() : null
    if (Array.isArray(jP)) perfil = jP[0] || null
  } catch { perfil = null }
  if (!perfil) {
    adminToast(`Já existe um perfil chamado "${nome}", mas não consegui abrir ele pra regravar. Nada foi alterado.`, false)
    return
  }

  // 2) Só quem ESTÁ no perfil entra na conta. Perguntar por todo mundo faria a
  // tela prometer mudança em gente que não muda.
  //
  // Falha de leitura NÃO pode virar "lista vazia": vazio segue pelo atalho do
  // `total === 0` e gravaria o perfil sem ninguém conferir quem perde acesso —
  // que é exatamente o que o D11 existe pra impedir. Por isso aqui a falha
  // aborta tudo, sem tocar em nada.
  let membrosCrus = null
  try {
    const rM = await adFetch('profiles?select=id,name,email,permissions,permissions_excecao,is_superadmin&perfil_id=eq.'
      + encodeURIComponent(perfil.id))
    const jM = rM.ok ? await rM.json() : null
    if (Array.isArray(jM)) membrosCrus = jM
  } catch { membrosCrus = null }
  if (!membrosCrus) {
    adminToast('Não consegui ler quem está neste perfil, então não mexi em nada.', false)
    return
  }

  // DUAS listas de propósito: `membrosCrus` guarda a linha inteira (o `id` e o
  // `is_superadmin` são necessários pro PATCH do passo 4); `membros` é a forma
  // reduzida que `impactoDaMudanca` espera — e o nome do campo é `nome`, não
  // `name`: passar a linha crua faria a confirmação dizer "undefined: PERDE…".
  const membros = membrosCrus.map(p => ({
    nome: p.name || p.email, permissions: p.permissions, permissions_excecao: p.permissions_excecao,
  }))
  const impacto = impactoDaMudanca(novasPermissions, membros)

  if (impacto.total > 0) {
    // A PERDA VEM PRIMEIRO, e em maiúscula. O plano escrevia o ganho antes, mas
    // o motivo declarado dele é "quem lê rápido tem que enxergar a perda antes
    // do ganho" — quem lê rápido lê a primeira coisa da linha, não a maiúscula
    // no meio dela. `muda` mostra o de-para porque "mudou de nível" sem dizer
    // pra qual não ajuda ninguém a decidir.
    const linhas = impacto.afetados.map((a) => {
      const partes = []
      if (a.perde.length) partes.push(`PERDE ${a.perde.map(_rotuloDoRecurso).join(', ')}`)
      if (a.ganha.length) partes.push(`ganha ${a.ganha.map(_rotuloDoRecurso).join(', ')}`)
      for (const m of a.muda || []) {
        partes.push(`${_rotuloDoRecurso(m.chave)}: de [${m.de.join(', ')}] para [${m.para.join(', ')}]`)
      }
      return `${a.nome}: ${partes.join(' · ')}`
    })
    // `_gtConfirmAdmin(titulo, texto)` é o que existe neste arquivo (~L658):
    // dois argumentos, devolve Promise<boolean>. `uiConfirm` é de outro projeto
    // do dono e não existe aqui.
    const ok = await _gtConfirmAdmin(
      `${impacto.total} ${impacto.total === 1 ? 'pessoa vai mudar' : 'pessoas vão mudar'} de acesso agora`,
      `Regravando o perfil "${nome}" com o acesso desta ficha:\n\n${linhas.join('\n')}`,
    )
    if (!ok) return
  }
  // Se `total === 0` não há confirmação, de propósito: uma confirmação que não
  // tem o que confirmar ensina a clicar "Aplicar" sem ler, e aí a que importa
  // também passa batida. Isso só é seguro porque `impactoDaMudanca` enxerga
  // TODAS as mudanças, inclusive as vindas de exceção (ver o cabeçalho de
  // perfis-de-acesso.js) — não mexa nesse cálculo achando que é detalhe.

  // 3) Gravar o mapa novo no perfil. Se isto falhar, ninguém foi tocado ainda.
  //
  // `.ok` NÃO PROVA GRAVAÇÃO. Um PATCH do PostgREST cujo alvo o RLS filtra
  // devolve 204, não 403: zero linhas alteradas e `.ok === true`. Sem exigir a
  // linha de volta, esta função seguia achando que gravou e PROPAGAVA em cima
  // de gente com um perfil que não mudou.
  //
  // E o caminho para isso acontecer está aberto: existem DUAS definições
  // independentes de super-admin neste sistema. A tela usa
  // `estado.is_superadmin` (a coluna `profiles.is_superadmin`); a policy
  // `acessos_perfis_escrever` (039_perfis_de_acesso.sql) usa
  // `public.is_superadmin()`, que é uma LISTA FIXA DE E-MAILS escrita dentro da
  // função. Uma não lê a outra. Quem for super-admin pela coluna e não estiver
  // na lista vê o botão, passa pela confirmação, não grava nada — e antes desta
  // guarda a propagação rodava mesmo assim.
  //
  // Medido em 12/08/2026 (leitura): hoje as duas listas BATEM — erick@,
  // gabriel.gertrudes@ e breno@ são super-admin nos dois caminhos, e nenhuma
  // conta cai no meio. Mas quem for promovido só pela coluna amanhã cai, e
  // nada no sistema obriga a mexer nos dois lugares. Alinhar as definições é
  // decisão do dono e mexe em segurança; aqui a tela só para de mentir sobre o
  // que aconteceu.
  let rG = null
  try {
    rG = await adFetch('acessos_perfis?id=eq.' + encodeURIComponent(perfil.id), {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ permissions: novasPermissions }),
    })
  } catch { rG = null }
  if (!rG || !rG.ok) { adminToast('Não consegui regravar o perfil — ninguém foi alterado.', false); return }
  const linhasPerfil = await rG.json().catch(() => null)
  if (!Array.isArray(linhasPerfil) || linhasPerfil.length === 0) {
    adminToast('O banco recusou a gravação: seu login não está na lista de super-admins do banco. '
      + 'Nada foi alterado.', false)
    return
  }

  if (impacto.total === 0) {
    adminToast(`Perfil "${nome}" atualizado — ninguém muda de acesso.`)
    // Fecha pelo mesmo motivo do caminho de sucesso lá embaixo: o editor ficaria
    // com o mapa do perfil na mão, e salvar por cima de alguém que está neste
    // perfil apagaria a exceção dela. "Ninguém muda de acesso" é sobre o que a
    // propagação faz, não sobre o que um clique seguinte poderia fazer.
    closePermModal()
    return
  }

  // 4) Propagar. Um PATCH por pessoa, com o acesso recalculado pela regra de
  // sobreposição (o perfil manda no que ele cobre, a exceção dada à mão
  // sobrevive — D9). `features` vai junto porque este projeto tem dois modelos
  // de permissão convivendo e gravar um só deixa a pessoa vendo metade das
  // telas (ver derivar-features.js).
  //
  // `derivarFeatures` devolve `null` para super-admin, e null quer dizer "NÃO
  // MEXA no features[] desta pessoa" — mandar isso no PATCH gravaria NULL na
  // coluna e apagaria o acesso dela. Por isso o campo fica FORA do corpo nesse
  // caso, igual ao que `savePermissions` já faz (~L1670).
  const falhas = []
  // O que FICOU no banco para cada pessoa: o efetivo quando o PATCH passou, o
  // de antes quando falhou. Serve para resincronizar o editor logo abaixo, sem
  // uma segunda ida ao banco.
  const noBanco = new Map()
  for (const p of membrosCrus) {
    const efetivo = acessoEfetivo(novasPermissions, p.permissions_excecao)
    const corpo = { permissions: efetivo }
    const features = derivarFeatures(efetivo, { ehSuperadmin: !!p.is_superadmin })
    if (features !== null) corpo.features = features
    let okp = false
    try {
      // Mesma armadilha do PATCH do perfil: RLS que filtra a linha devolve 204
      // com `.ok === true` e zero linhas alteradas. Exigir a linha de volta é o
      // que separa "gravei" de "achei que gravei" — e o nome desta pessoa só
      // entra na lista de falhas se a gravação realmente não aconteceu.
      const rr = await adFetch('profiles?id=eq.' + encodeURIComponent(p.id), {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(corpo),
      })
      if (rr && rr.ok) {
        const linhas = await rr.json().catch(() => null)
        okp = Array.isArray(linhas) && linhas.length > 0
      }
    } catch { okp = false }
    if (!okp) falhas.push(p.name || p.email)
    noBanco.set(p.id, okp ? efetivo : (p.permissions || {}))
  }

  setTimeout(loadAdminUsers, 400)

  if (!falhas.length) {
    adminToast(`Perfil "${nome}" atualizado — ${impacto.total} `
      + (impacto.total === 1 ? 'pessoa mudou' : 'pessoas mudaram') + ' de acesso.')
    // FECHAR O EDITOR NÃO É COSMÉTICO. Ele continuaria aberto com o mapa do
    // PERFIL na mão, e o que a pessoa desta ficha tem no banco é perfil +
    // exceção DELA. Um "Salvar" logo depois gravaria o mapa cru nela e apagaria
    // a exceção que a propagação acabou de preservar — desfazendo o D9 em
    // silêncio, que é o oposto do que esta tela inteira existe pra garantir.
    // `savePermissions` fecha pelo mesmo motivo.
    closePermModal()
    return
  }

  // Deu falha: o perfil está gravado e essas pessoas ficaram com o acesso
  // antigo. O modal fica ABERTO de propósito — é onde a faixa mora, e fechar
  // levaria o aviso junto. Um toast sozinho some em 2,8s e a divergência não
  // reapareceria em lugar nenhum.
  //
  // As três coisas que o texto tem que dizer: o perfil FOI gravado, estas
  // pessoas NÃO receberam (nome a nome), e o acesso delas continua como estava.
  _permAvisoPropagacao = `O perfil "${nome}" FOI gravado, mas a mudança não chegou em todo mundo.\n`
    + `Não consegui aplicar em: ${falhas.join(', ')}.\n`
    + 'O acesso dessas pessoas continua exatamente como estava — o perfil e elas estão diferentes '
    + 'até alguém abrir a ficha de cada uma e salvar de novo.'
  adminToast(`Perfil "${nome}" gravado, mas NÃO consegui aplicar em: ${falhas.join(', ')}.`
    + ' O acesso dessas pessoas continua como estava — abra a ficha de cada uma.', false)

  // Com o modal aberto, o editor ainda mostra o mapa do PERFIL. Se a pessoa
  // desta ficha estava no perfil, resincroniza com o que FICOU no banco pra
  // ela: sem isso, salvar aqui apagaria a exceção dela (D9) sem avisar.
  if (_permState && noBanco.has(_permState.userId)) {
    _permState.permissions = JSON.parse(JSON.stringify(noBanco.get(_permState.userId) || {}))
  }
  if (_permState) _renderPermBody(u)
}

// Marcar uma ação marca 'ver' junto; desmarcar 'ver' limpa o recurso. Mantém a ordem do catálogo.
function _togglePerm(r, acao, on) {
  const cur = new Set(_permState.permissions[r.key] || [])
  if (on) { cur.add(acao); if (acao !== 'ver') cur.add('ver') }
  else { cur.delete(acao); if (acao === 'ver') cur.clear() }
  const arr = r.acoes.filter(a => cur.has(a))
  if (arr.length) _permState.permissions[r.key] = arr; else delete _permState.permissions[r.key]
}

// As duas chaves de "aprovar" só têm 'ver' no catálogo, mas "Pode ver" não diz
// o que elas realmente liberam — quem aprova requisição de veículo não está só
// "vendo" a Frota. Por isso ganham uma caixinha única com o texto por extenso,
// em vez de entrar na escada.
const APROVACOES = {
  'frota.aprovar': 'Pode aprovar requisição de veículo',
  'conteudo.aprovar': 'Pode aprovar peças para publicar',
}

// Uma ferramenta = uma escolha. Os degraus vêm do catálogo (niveis-de-
// permissao.js), então ferramenta que só deixa ver mostra dois botões, e
// ferramenta completa mostra quatro. Nada de célula vazia: era isso que fazia
// a matriz parecer ter 105 escolhas quando tinha 45.
function _linhaDeNivel(r, u) {
  const atual = _permState.permissions[r.key] || []
  const degrau = degrauDoConjunto(r, atual)   // null = conjunto fora da escada

  const linha = document.createElement('div')
  linha.className = 'perm-nivel'

  const nome = document.createElement('div')
  nome.className = 'perm-nivel-nome'
  nome.textContent = r.label            // linha inteira: o nome NUNCA corta
  linha.appendChild(nome)

  // SELO DE DINHEIRO (D4). Vai junto do nome, não junto da frase: quem lê o
  // nome da ferramenta precisa ver o selo no MESMO movimento de olho.
  if (mexeEmDinheiro(r.key)) {
    linha.classList.add('perm-dinheiro')
    const selo = document.createElement('span')
    selo.className = 'perm-selo-dinheiro'
    selo.textContent = SELO_DINHEIRO
    nome.appendChild(selo)
  }

  const botoes = document.createElement('div')
  botoes.className = 'perm-nivel-botoes'
  for (const d of degrausDoRecurso(r)) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'perm-degrau' + (d.chave === degrau ? ' escolhido' : '')
    b.textContent = d.rotulo
    b.onclick = () => { _aplicarDegrau(r, d.chave); _renderPermBody(u) }
    botoes.appendChild(b)
  }
  linha.appendChild(botoes)

  // A FRASE SEMPRE VISÍVEL (D3). O dono recusou que ela aparecesse só ao
  // clicar: "eu ainda gosto de uma visualização de todas as ferramentas, porém
  // um detalhamento maior do que é cada permissão".
  //
  // SÓ quando há degrau. Conjunto fora da escada já tem a própria mensagem
  // logo abaixo (`perm-nivel-aviso`, mais adiante) — duas mensagens na mesma
  // linha brigariam, e a de baixo é a mais importante ali.
  if (degrau) {
    const frase = document.createElement('div')
    frase.className = 'perm-o-que-faz'
    frase.textContent = oQueONivelFaz(r.key, degrau)
    linha.appendChild(frase)
  }

  // CONJUNTO FORA DA ESCADA: não escolhe degrau nenhum e não aproxima. Mostra o
  // que está gravado e deixa a pessoa decidir. Aproximar mudaria acesso sem
  // ninguém ter pedido — e é justamente o que esta tela não pode fazer.
  if (atual.length && !degrau) {
    const aviso = document.createElement('div')
    aviso.className = 'perm-nivel-aviso'
    aviso.textContent = 'Personalizado: ' + atual.join(', ') + '. Escolher um nível substitui isto.'
    linha.appendChild(aviso)
  }
  return linha
}

// Aplica um degrau: grava exatamente as ações daquele degrau, e apaga a chave
// quando o degrau é "Sem acesso" — mesmo contrato do _togglePerm, onde recurso
// sem 'ver' não existe no objeto.
function _aplicarDegrau(r, chaveDoDegrau) {
  const acoes = acoesDoDegrau(r, chaveDoDegrau)
  if (!acoes.length) delete _permState.permissions[r.key]
  else _permState.permissions[r.key] = acoes
}

// Caixinha única das aprovações: mesmo _togglePerm da escada, só que sem
// degrau nenhum — é liga/desliga puro, porque só existe uma ação ('ver') a
// marcar.
function _linhaDeAprovacao(r, u) {
  const linha = document.createElement('label')
  linha.className = 'perm-nivel perm-nivel-aprovacao'
  linha.style.cssText = 'display:flex;align-items:center;gap:8px;cursor:pointer'
  const cb = document.createElement('input'); cb.type = 'checkbox'
  cb.checked = (_permState.permissions[r.key] || []).includes('ver')
  cb.addEventListener('change', () => { _togglePerm(r, 'ver', cb.checked); _renderPermBody(u) })
  const txt = document.createElement('span'); txt.textContent = APROVACOES[r.key]
  linha.appendChild(cb); linha.appendChild(txt)
  return linha
}

function closePermModal() {
  document.getElementById('perm-modal-overlay').classList.remove('open')
  _permState = null
  // Fechar o modal é decisão de gente, e o aviso é sobre o que acabou de
  // acontecer NESTA ficha. Deixá-lo de pé reapareceria na ficha de outra
  // pessoa, dizendo dela o que era de outra — aviso que mente é pior que aviso
  // nenhum. Quem grava com falha não passa por aqui: o modal fica aberto.
  _permAvisoPropagacao = null
}

// SENSITIVE MUTATION — PATCH em profiles.permissions/features/allowed_accounts/is_superadmin.
//
// `features` vai junto de propósito, derivado de `permissions` pela mesma
// regra que corrigiu os usuários já afetados no banco (ver derivar-features.js).
// Motivo: o FRONT lê `permissions{}` e as EDGE FUNCTIONS leem `features[]`.
// Gravar só um dos dois desincroniza os dois lados — era exatamente esse o bug
// ("sem permissão" na Análise de Campanhas, "nenhuma campanha encontrada" na
// Gestão de Tráfego). Enquanto a Onda 3 (função SQL tem_permissao(), fonte
// única — docs/superpowers/specs/2026-07-16-seguranca-e-dados-design.md) não
// existir, os dois campos TÊM de ser escritos na mesma operação.
//
// derivarFeatures() devolve null para super-admin = "não mexa no features[]".
// Nesse caso o campo fica FORA do PATCH e o valor do banco é preservado — a
// razão está explicada em derivar-features.js e não é redundância: derivar do
// `permissions` vazio de um super-admin daria [] e TIRARIA o acesso dele.
async function savePermissions() {
  if (!_permState) return
  const btn = document.getElementById('perm-save-btn'); btn.disabled = true; btn.textContent = 'Salvando...'
  // No modo "minhas notificações" o PATCH em profiles nem acontece: só as
  // preferências são gravadas.
  const features = _permState.soNotificacoes ? null
    : derivarFeatures(_permState.permissions, { ehSuperadmin: _permState.is_superadmin })
  const payload = {
    permissions: _permState.permissions,
    allowed_accounts: _permState.allowed_accounts,
    is_superadmin: _permState.is_superadmin,
  }
  // O escopo de canal só vai no PATCH quando quem salva é super-admin. Mandar
  // sempre faria um admin comum REGRAVAR o valor atual a cada salvamento — e
  // um dia, com a caixinha desenhada a partir de um select incompleto, gravaria
  // o valor errado sem ninguém ter clicado nela.
  if (!_permState.soNotificacoes && podeMudarEscopo({ is_superadmin: estado.is_superadmin })) {
    // MUDOU O ALCANCE DELA: pergunta, e diz o tamanho. Abrir os canais é a
    // mudança de maior raio desta tela depois de excluir a conta — a pessoa
    // passa a ver o faturamento de lojas que não são dela, no sistema inteiro.
    // Só pergunta quando MUDA: perguntar em todo salvamento ensina a clicar em
    // "ok" sem ler, que é pior que não perguntar.
    if (_permState.escopo_por_equipe !== _permState.escopoOriginal) {
      // O nome sai do cache de usuários (esta função não recebe a pessoa, só o
      // `_permState`). Sem nome achado, `avisoDaMudancaDeEscopo` já diz "esta
      // pessoa" — a frase continua verdadeira, só menos específica.
      const quem = (_usersCache || []).find((x) => String(x.id) === String(_permState.userId))
      const ok = await _gtConfirmAdmin(
        _permState.escopo_por_equipe ? 'Limitar aos times dela?' : 'Abrir TODOS os canais para ela?',
        avisoDaMudancaDeEscopo({
          pessoa: { id: _permState.userId, name: quem && (quem.name || quem.email) },
          ligar: _permState.escopo_por_equipe,
          times: _eqTimes, membros: _eqMembros,
        }))
      if (!ok) { btn.disabled = false; btn.textContent = 'Salvar'; return }
    }
    payload.escopo_por_equipe = _permState.escopo_por_equipe
  }
  if (features !== null) payload.features = features

  // D9 NO CAMINHO REAL — o que foi dado à mão precisa ficar REGISTRADO como
  // exceção, senão a próxima regravação do perfil apaga.
  //
  // Sem isto (era o estado até 12/08/2026), a sequência real era: cria a Ana no
  // perfil "Vendedora" com exceção `{}` → alguém dá Frota a ela pela ficha →
  // entra só em `permissions`, exceção continua `{}` → alguém regrava o perfil
  // → a Frota da Ana some. A promessa "exceção sobrevive" valia só nos testes.
  //
  // A decisão mora em `excecaoAoSalvar` (perfis-de-acesso.js), pura e testada:
  // sem o mapa do perfil em mãos ela devolve `gravar: false` com aviso, porque
  // gravar exceção errada é pior que não gravar — e ficar calado é pior ainda.
  let avisoExcecao = null
  if (!_permState.soNotificacoes) {
    const dec = excecaoAoSalvar({
      perfilId: _permState.perfilId,
      perfis: _perfisCache,
      permissions: _permState.permissions,
    })
    if (dec.gravar) payload.permissions_excecao = dec.excecao
    avisoExcecao = dec.aviso
  }

  // `.ok` NÃO PROVA GRAVAÇÃO — mesma armadilha corrigida nos outros PATCHes
  // desta tela (regravar perfil, propagação por membro, pôr pessoa no
  // perfil): um PATCH do PostgREST cujo alvo o RLS filtra devolve 204, não
  // 403, com zero linhas alteradas e `.ok === true`. Este é o PATCH mais
  // usado da ficha — roda toda vez que alguém salva UMA pessoa, e é o que
  // grava `permissions_excecao` (D9) — por isso não pode ficar de fora.
  if (!_permState.soNotificacoes) {
    let r = null
    try {
      r = await adFetch('profiles?id=eq.' + _permState.userId, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(payload),
      })
    } catch { r = null }
    const linhasPerm = r && r.ok ? await r.json().catch(() => null) : null
    if (!Array.isArray(linhasPerm) || linhasPerm.length === 0) {
      btn.disabled = false; btn.textContent = 'Salvar'
      adminToast('O banco recusou a gravação — nada foi alterado. '
        + 'Seu login pode não ter permissão para editar este usuário.', false)
      return
    }
  }

  // NOTIFICAÇÕES: grava uma linha por tipo com o estado escolhido. Poderia
  // gravar só o que difere do padrão, mas aí "ligado por escolha" e "ligado
  // porque é o padrão" viram a mesma coisa no banco — e se o padrão mudar
  // amanhã, a escolha de quem já decidiu seria silenciosamente revertida.
  const linhas = Object.entries(_permState.notificacoes).map(([tipo, ativo]) => ({
    user_id: _permState.userId, tipo, ativo: !!ativo,
    alterado_em: new Date().toISOString(), alterado_por: estado.userId,
  }))
  if (linhas.length) {
    // upsert pela chave (user_id, tipo): regravar é o caso normal aqui.
    await adFetch('push_preferencias?on_conflict=user_id,tipo', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify(linhas),
    })
  }

  btn.disabled = false; btn.textContent = 'Salvar'
  // O aviso de exceção não gravada vai NA MESMA frase, e em vermelho: um toast
  // verde "Permissões atualizadas" seguido de silêncio ensinaria que está tudo
  // certo justamente quando o D9 ficou sem registro.
  if (avisoExcecao) adminToast('Permissões atualizadas. ' + avisoExcecao, false)
  else adminToast('Permissões atualizadas')
  closePermModal()
  setTimeout(loadAdminUsers, 400)
}

/* ── USUÁRIOS: lista separada por marca, local ou setor (Task 6) ──
   CORREÇÃO 1 (revisão da Task 6): a primeira versão desta lista virou só um
   DIRETÓRIO — nome, as outras duas lotações, papel — e deixou pra trás os
   controles que a lista antiga tinha (permissões, trocar papel, trocar
   senha, desativar, excluir, avatar). Isso não era escopo novo, era
   regressão: o editor de permissões que a Task 4 reconstruiu ficou
   INALCANÇÁVEL, sem nenhum botão que o chamasse. Corrigido aqui: o
   agrupamento por lotação continua (é o pedido original desta tarefa), mas
   cada pessoa GANHA DE VOLTA a linha de ações, como uma segunda fileira
   dentro do mesmo cartão — ver `_criarLinhaPessoa` e a classe `.usr-acoes`. */

// Sem acento, sem caixa: quem digita "raissa" tem de achar "Raíssa".
const _crua = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

// A busca filtra ANTES de agrupar, senão os cabeçalhos mostrariam contagem que
// não corresponde ao que está na tela.
function _filtrar(linhas, termo) {
  const t = _crua(termo)
  if (!t) return linhas
  return linhas.filter((p) => _crua(p.nome).includes(t) || _crua(p.email).includes(t))
}

// A gaveta escolhida sobrevive ao recarregar — mesmo espírito do "lembrar onde
// parei" que o projeto já usa nas outras telas. try/catch porque navegador com
// armazenamento bloqueado não pode derrubar a tela inteira por causa disto.
const CHAVE_GAVETA = 'admin-agrupar-por'
function _gavetaEscolhida() {
  try { const v = localStorage.getItem(CHAVE_GAVETA); if (DIMENSOES.some((d) => d.chave === v)) return v } catch (e) {}
  return 'marca'
}
function _guardarGaveta(chave) { try { localStorage.setItem(CHAVE_GAVETA, chave) } catch (e) {} }

// O seletor é um botão por dimensão (mesma classe `.perm-degrau` da Task 4,
// que já tem 32px de altura e quebra linha).
function _desenharSeletor(alvo, atual, aoTrocar) {
  const barra = document.createElement('div')
  barra.className = 'usr-gavetas'
  const rot = document.createElement('span')
  rot.className = 'usr-gavetas-rot'; rot.textContent = 'Agrupar:'
  barra.appendChild(rot)
  for (const d of DIMENSOES) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'perm-degrau' + (d.chave === atual ? ' escolhido' : '')
    b.textContent = d.rotulo
    b.onclick = () => { _guardarGaveta(d.chave); aoTrocar(d.chave) }
    barra.appendChild(b)
  }
  alvo.appendChild(barra)
}

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// A lista inteira de colaboradores, guardada por `loadAdminUsers`. A ficha
// precisa dela para saber o que oferecer, e reler a cada abertura seria um ida
// e volta ao banco por clique.
let _colaboradores = []

// As listas das três gavetas, lidas uma vez por carregamento da tela.
let _listasDeLotacao = { marca: [], local: [], setor: [] }

// A lotação mora no cadastro de colaborador. `organizacao_id` é o LOCAL: o nome
// da coluna é histórico, o conteúdo é lugar (Sede Centro, Fábrica Conchal…).
const CAMPOS_DE_LOTACAO = [
  { chave: 'marca', rotulo: 'Marca', coluna: 'marca_id' },
  { chave: 'local', rotulo: 'Local', coluna: 'organizacao_id' },
  { chave: 'setor', rotulo: 'Setor', coluna: 'setor_id' },
]

/* ── A FICHA DA PESSOA ───────────────────────────────────────────────────────
 *
 * POR QUE FICHA E NÃO EDIÇÃO NA LINHA: são três campos de lotação por pessoa e
 * quinze pessoas. Sempre visíveis, no celular isso vira uma coluna interminável
 * e empurra as ações para longe do polegar.
 *
 * A ORDEM DAS SEÇÕES NÃO É ESTÉTICA: o vínculo vem primeiro porque a lotação
 * depende dele. Sem cadastro ligado não existe onde gravar marca, local e setor.
 */
function abrirFichaDaPessoa(p) {
  // Uma ficha por vez. Sem isto, dois cliques rápidos empilham dois painéis, e
  // fechar o de cima revela o de baixo ainda aberto — a pessoa acha que fechou
  // e não fechou.
  const jaAberta = document.querySelector('.ficha-fundo')
  if (jaAberta) jaAberta.remove()

  const fundo = mkEl('div', 'ficha-fundo')
  const caixa = mkEl('div', 'ficha-caixa')
  const fechar = () => { fundo.remove(); fecharModal() }
  // Clique no fundo fecha; clique DENTRO da caixa não (senão mexer num campo
  // fecharia a ficha na cara da pessoa).
  fundo.addEventListener('click', (e) => { if (e.target === fundo) fechar() })

  const cab = mkEl('div', 'ficha-cab')
  cab.appendChild(mkEl('div', 'ficha-titulo', p.nome))
  const x = mkEl('button', 'ficha-x'); x.type = 'button'; x.textContent = '✕'
  x.setAttribute('aria-label', 'Fechar'); x.addEventListener('click', fechar)
  cab.appendChild(x); caixa.appendChild(cab)

  const corpo = mkEl('div', 'ficha-corpo'); caixa.appendChild(corpo)
  // Ao ligar ou criar cadastro, a ficha se refaz: a lotação que estava travada
  // passa a valer, e a lista de trás precisa parar de dizer "sem cadastro".
  const refazer = () => { fechar(); loadAdminUsers() }
  _secaoVinculo(corpo, p, refazer)

  // Só passa o colaborador quando o vínculo EXISTE. Com sugestão pendente os
  // campos ficam travados de propósito: gravar num cadastro que ainda não é
  // desta pessoa seria escrever na ficha de outra.
  const v = estadoDoVinculo({ id: p.id, email: p.email }, _colaboradores)
  _secaoLotacao(corpo, v.estado === 'ligado' ? v.colaborador : null)

  // As mesmas ações da linha, aqui dentro. No celular a fileira da linha fica
  // escondida e ESTE é o único caminho — por isso a ficha precisa ter tudo.
  const u = p.bruto || {}
  const secAcesso = mkEl('div', 'ficha-sec')
  secAcesso.appendChild(mkEl('div', 'ficha-sec-tit', 'Acesso'))
  secAcesso.appendChild(_construirAcoes(p, u, {
    isSelf: u.email === estado.user?.email,
    canEdit: !u.is_superadmin || estado.is_superadmin,
  }))
  corpo.appendChild(secAcesso)

  // Só superadmin troca a senha de outra pessoa — é o que a edge function
  // exige. Mostrar o campo para quem vai receber "não autorizado" seria
  // prometer o que a tela não cumpre.
  if (estado.is_superadmin) _secaoSenha(corpo, p)

  fundo.appendChild(caixa)
  // PENDURAR DENTRO DA `.tela-admin`, NUNCA NO `body`.
  //
  // O CSS deste arquivo é `scoped`: `.tela-admin :deep(.ficha-fundo)` só casa
  // com elemento que esteja DENTRO do componente. Pendurado no `body`, a ficha
  // ficava sem uma única regra aplicada — `position: static`, sem fundo, sem
  // z-index — e em vez de um painel por cima despencava como texto cru no fim
  // da página. Foi assim que foi para produção, e foi o dono quem viu.
  const raiz = document.querySelector('.tela-admin')
  if (raiz) { raiz.appendChild(fundo); abrirModal() }
  else { fechar(); adminToast('Não consegui abrir a ficha nesta tela.', false) }
}

function _secaoVinculo(alvo, p, aoMudar) {
  const sec = mkEl('div', 'ficha-sec')
  sec.appendChild(mkEl('div', 'ficha-sec-tit', 'Cadastro de colaborador'))

  // `situacao`, e não `estado`: `estado` é o estado global de login do app,
  // importado no topo deste arquivo. Sombreá-lo aqui funcionaria hoje, e
  // quebraria calado no dia em que alguém escrevesse `estado.is_superadmin`
  // dentro desta função e recebesse `undefined`.
  const { estado: situacao, colaborador } = estadoDoVinculo({ id: p.id, email: p.email }, _colaboradores)
  const txt = mkEl('div', 'ficha-txt')

  if (situacao === 'ligado') {
    txt.textContent = 'Ligado a ' + colaborador.nome + '.'
    sec.appendChild(txt)
  } else if (situacao === 'sugestao') {
    // Montado por nós, não por innerHTML: o nome vem do banco, e escapar à mão
    // funciona até alguém esquecer uma vez. `textContent` não tem esse jeito de
    // errar.
    txt.appendChild(document.createTextNode('Achei um cadastro com este e-mail: '))
    txt.appendChild(mkEl('b', null, colaborador.nome))
    txt.appendChild(document.createTextNode('. É a mesma pessoa?'))
    sec.appendChild(txt)
    const b = mkEl('button', 'btn btn-principal', 'Sim, ligar'); b.type = 'button'
    b.addEventListener('click', () => _ligarCadastro(b, colaborador.id, p.id, aoMudar))
    sec.appendChild(b)
  } else if (situacao === 'ambiguo') {
    // Sem botão de propósito: escolher por conta própria seria chutar qual
    // pessoa recebe a lotação e o histórico.
    txt.textContent = 'Há mais de um cadastro com este e-mail. Resolva em '
      + 'Colaboradores antes de ligar — daqui não dá para saber qual é a pessoa certa.'
    sec.appendChild(txt)
  } else {
    // ── ANTES DE OFERECER "CRIAR", DESCONFIAR DO NOME (27/08/2026) ──────────
    //
    // FOI EXATAMENTE AQUI que o Douglas Pereira ganhou a segunda ficha. A de
    // 19/08 nasceu pelo `+` rápido da Frota, SEM e-mail; `estadoDoVinculo` casa
    // só por e-mail, então não tinha o que casar, e esta tela — honestamente,
    // pelo que sabia — disse "ainda não tem cadastro" e ofereceu criar.
    //
    // O nome era IDÊNTICO, e ninguém olhou. O preço: os pertences dele ficaram
    // partidos entre as duas fichas, e o app mostrava um item de três.
    //
    // Só entram candidatos SEM login. Um cadastro já ligado a outro login não
    // se sugere: seria oferecer um clique que rouba a ficha de outra pessoa —
    // a mesma regra que `estadoDoVinculo` já aplica para o e-mail.
    const soltos = (_colaboradores || []).filter((c) => c && !c.profile_id)
    const parecidas = parecidos(p.nome, soltos)

    if (parecidas.length) {
      txt.appendChild(document.createTextNode(fraseDoParecido(parecidas)))
      sec.appendChild(txt)
      for (const s of parecidas) {
        // Ligar, e não criar: é o clique que faltou em 21/08.
        const bSim = mkEl('button', parecidas.length === 1 ? 'btn btn-principal' : 'btn',
          'É ' + s.pessoa.nome); bSim.type = 'button'
        bSim.addEventListener('click', () => _ligarCadastro(bSim, s.pessoa.id, p.id, aoMudar))
        sec.appendChild(bSim)
      }
      // Homônimo de verdade existe (a base tem duas Clara e dois Gabriel), então
      // a saída de criar continua aberta — só deixou de ser a primeira.
      const bNao = mkEl('button', 'btn', 'Não, criar cadastro novo'); bNao.type = 'button'
      bNao.addEventListener('click', () => _criarCadastro(bNao, p, aoMudar))
      sec.appendChild(bNao)
    } else {
      txt.textContent = 'Esta pessoa ainda não tem cadastro de colaborador. '
        + 'Sem ele não há onde guardar marca, local e setor.'
      sec.appendChild(txt)
      const b = mkEl('button', 'btn btn-principal', 'Criar cadastro'); b.type = 'button'
      b.addEventListener('click', () => _criarCadastro(b, p, aoMudar))
      sec.appendChild(b)
    }
  }
  alvo.appendChild(sec)
}

// Copiar com plano B: `navigator.clipboard` falha em contexto sem HTTPS e
// quando a permissão é negada. Falhar calado aqui faz o dono mandar por
// mensagem uma senha que ele não copiou.
function _copiar(texto, aoTerminar) {
  const plano2 = () => {
    try {
      const ta = document.createElement('textarea')
      ta.value = texto; ta.style.position = 'fixed'; ta.style.opacity = '0'
      document.body.appendChild(ta); ta.focus(); ta.select()
      document.execCommand('copy'); ta.remove(); return true
    } catch (e) { return false }
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(texto).then(() => aoTerminar(true)).catch(() => aoTerminar(plano2()))
  } else { aoTerminar(plano2()) }
}

function _secaoSenha(alvo, p) {
  const sec = mkEl('div', 'ficha-sec')
  sec.appendChild(mkEl('div', 'ficha-sec-tit', 'Senha'))
  sec.appendChild(mkEl('div', 'ficha-txt',
    'Gere uma senha, salve e copie a mensagem pronta para mandar à pessoa. '
    + 'Ela vai ser obrigada a trocar por uma dela no primeiro acesso.'))

  const inp = mkEl('input', 'admin-form-input'); inp.type = 'text'
  inp.placeholder = 'clique em Gerar'
  inp.style.cssText = 'width:100%;font-family:var(--fonte-dados);font-size:max(16px, calc(16px * var(--escala-texto, 1)));margin-bottom:8px'
  sec.appendChild(inp)

  const acoes = mkEl('div'); acoes.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px'
  const gerar = mkEl('button', 'btn', 'Gerar'); gerar.type = 'button'
  gerar.addEventListener('click', () => { inp.value = gerarSenhaForte(14); inp.focus(); inp.select() })

  // COPIA A MENSAGEM INTEIRA, não a senha crua. Uma senha sozinha no WhatsApp
  // não diz onde usar, e o resto do recado ia digitado à mão toda vez — com o
  // endereço errado de vez em quando.
  const copiar = mkEl('button', 'btn', 'Copiar mensagem'); copiar.type = 'button'
  copiar.addEventListener('click', () => {
    if (!inp.value) { adminToast('Gere uma senha primeiro.', false); return }
    const recado = recadoDeAcesso({ email: p.email, senha: inp.value })
    _copiar(recado, (ok) => adminToast(
      ok ? 'Mensagem copiada — é só colar pra pessoa.'
         : 'Não consegui copiar — selecione e copie à mão.', ok))
  })

  const salvar = mkEl('button', 'btn btn-principal', 'Salvar senha'); salvar.type = 'button'
  salvar.addEventListener('click', () => _salvarSenha(salvar, inp, p))

  acoes.appendChild(gerar); acoes.appendChild(copiar); acoes.appendChild(salvar)
  sec.appendChild(acoes)
  alvo.appendChild(sec)
}

async function _salvarSenha(botao, inp, p) {
  const pw = String(inp.value || '').trim()
  if (pw.length < 6) { adminToast('A senha precisa de no mínimo 6 caracteres.', false); return }
  botao.disabled = true; botao.textContent = 'Salvando…'
  try {
    const { data: { session: s } } = await sbClient.auth.getSession()
    const r = await fetch(`${SUPABASE_URL}/functions/v1/invite-user`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${s?.access_token || SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ resetPasswordUserId: p.id, password: pw }),
    })
    const res = await r.json()
    if (res.error) throw new Error(res.error)
    botao.textContent = 'Salva'
    // A SENHA FICA NO CAMPO. É ela que o dono vai copiar e mandar; sumir agora
    // faria o botão de copiar chegar tarde demais.
    adminToast('Senha trocada. Copie e mande para a pessoa.')
  } catch (e) {
    botao.disabled = false; botao.textContent = 'Salvar senha'
    adminToast('Não consegui trocar a senha: ' + e.message, false)
  }
}

function _secaoLotacao(alvo, colaborador) {
  const sec = mkEl('div', 'ficha-sec')
  sec.appendChild(mkEl('div', 'ficha-sec-tit', 'Lotação'))

  if (!colaborador) {
    // O MOTIVO FICA ESCRITO. Campo travado sem explicação parece defeito da
    // tela; com o motivo, vira instrução.
    sec.appendChild(mkEl('div', 'ficha-txt',
      'Ligue ou crie o cadastro de colaborador acima para poder preencher.'))
  }

  for (const campo of CAMPOS_DE_LOTACAO) {
    const linha = mkEl('div', 'ficha-campo')
    linha.appendChild(mkEl('label', null, campo.rotulo))
    const sel = mkEl('select', 'admin-form-input')
    sel.disabled = !colaborador
    const vazio = document.createElement('option')
    vazio.value = ''; vazio.textContent = '— não informado —'
    sel.appendChild(vazio)
    for (const item of (_listasDeLotacao[campo.chave] || [])) {
      const o = document.createElement('option')
      o.value = item.id; o.textContent = item.nome
      if (colaborador && String(colaborador[campo.coluna]) === String(item.id)) o.selected = true
      sel.appendChild(o)
    }
    // Guardar o valor de partida ANTES de ligar o evento: é para onde o campo
    // volta se a gravação falhar.
    sel.dataset.valorAnterior = sel.value
    if (colaborador) {
      sel.addEventListener('change', () => _gravarLotacao(sel, colaborador.id, campo.coluna))
    }
    linha.appendChild(sel); sec.appendChild(linha)
  }
  alvo.appendChild(sec)
}

async function _gravarLotacao(sel, colaboradorId, coluna) {
  const antes = sel.dataset.valorAnterior || ''
  sel.disabled = true
  const { error } = await sbClient.from('acessos_pessoas')
    .update({ [coluna]: sel.value || null }).eq('id', colaboradorId)
  sel.disabled = false
  if (error) {
    // Volta ao que era. Campo que PARECE salvo e não salvou é o defeito mais
    // caro de perceber: ninguém desconfia do que já leu como certo.
    sel.value = antes
    adminToast('Não consegui salvar: ' + error.message, false); return
  }
  sel.dataset.valorAnterior = sel.value
  adminToast('Salvo.')
}

async function _ligarCadastro(botao, colaboradorId, profileId, aoMudar) {
  botao.disabled = true; const antes = botao.textContent; botao.textContent = 'Ligando…'
  // `.is('profile_id', null)` NÃO É DECORAÇÃO: a lista que decidiu mostrar este
  // botão foi lida uma vez, e a ficha pode ficar aberta. Há três superadmins;
  // se outro tiver ligado este mesmo cadastro nesse meio-tempo, um update sem
  // essa condição sobrescreveria o vínculo dele em silêncio — dando a lotação e
  // o histórico daquela pessoa para outra. É exatamente o estrago que esta tela
  // existe para evitar, e a guarda tem de estar no BANCO, não só na tela.
  //
  // O `.select('id')` é o que permite saber se alguma linha foi mesmo afetada:
  // sem ele, zero linhas atualizadas volta como sucesso.
  const { data, error } = await sbClient.from('acessos_pessoas')
    .update({ profile_id: profileId })
    .eq('id', colaboradorId).is('profile_id', null).select('id')
  if (!error && (!data || !data.length)) {
    botao.disabled = false; botao.textContent = antes
    adminToast('Este cadastro já foi ligado a outro login enquanto esta ficha estava aberta. '
      + 'Feche e abra de novo para ver como está agora.', false)
    return
  }
  if (error) {
    // Falha não pode passar por sucesso: o dono acharia que ligou e seguiria
    // preenchendo a lotação num cadastro que continua solto.
    botao.disabled = false; botao.textContent = antes
    adminToast('Não consegui ligar: ' + error.message, false); return
  }
  adminToast('Ligado.'); aoMudar()
}

async function _criarCadastro(botao, p, aoMudar) {
  botao.disabled = true; const antes = botao.textContent; botao.textContent = 'Criando…'
  // `nome` é a única coluna obrigatória sem valor padrão. Cai para o e-mail
  // quando o login não tem nome — mesma regra que a lista usa para exibir.
  const { error } = await sbClient.from('acessos_pessoas').insert({
    nome: (p.bruto && p.bruto.name) || p.email,
    email_corporativo: p.email,
    profile_id: p.id,
  })
  if (error) {
    botao.disabled = false; botao.textContent = antes
    adminToast('Não consegui criar o cadastro: ' + error.message, false); return
  }
  adminToast('Cadastro criado.'); aoMudar()
}

// As OUTRAS duas informações — a que agrupa já está no cabeçalho, repeti-la em
// cada linha é ruído.
function _subtitulo(p, gaveta) {
  // "Sem cadastro" era MENTIRA em um caso, e foi o dono quem percebeu: a Raíssa
  // tem cadastro ativo com o e-mail idêntico ao login, só sem ninguém ter ligado
  // os dois. Dizer "sem cadastro" mandava procurar o que já existia.
  if (!p.temCadastro) {
    // `situacao` e nao `estado`: `estado` e o estado global de login do app.
    const { estado: situacao } = estadoDoVinculo({ id: p.id, email: p.email }, _colaboradores)
    if (situacao === 'sugestao') return '<span class="usr-alerta">cadastro encontrado — falta ligar</span>'
    if (situacao === 'ambiguo') return '<span class="usr-alerta">mais de um cadastro com este e-mail</span>'
    return '<span class="usr-alerta">sem cadastro de colaborador</span>'
  }
  const outras = DIMENSOES.filter((d) => d.chave !== gaveta)
    .map((d) => p[d.chave] || `sem ${d.rotulo.toLowerCase()}`)
  return esc(outras.join(' · '))
}

// Correção 2: e-mail + "desde <data>", numa terceira linha discreta abaixo da
// lotação — sem isso, duas pessoas de nome parecido na mesma gaveta só se
// distinguem abrindo "Trocar senha".
//
// A REGRA saiu daqui em 13/08/2026 e virou `linha-de-contato.js`, com teste ao
// lado: ela estava errada havia meses (o e-mail sumia de quem não tem cadastro
// de colaborador ligado, que é o caso das pessoas dos times de venda) e não
// tinha como quebrar nenhum teste, porque vivia dentro do .vue.

// Ações por pessoa (Correção 1): permissões, trocar papel, trocar senha,
// desativar/reativar, excluir, avatar — e "minhas notificações" pra você
// mesmo, que usa o MESMO openPermModal com soNotificacoes (é o jeito de
// evitar o bug de 2026-07-29, onde sem esse botão o dono acabou tentando
// ligar o próprio aviso e gravando na linha de outro usuário). A linha vira
// nó de DOM de verdade (não mais template de string), porque select/blur/
// upload de avatar/confirm() precisam de listener de verdade.
//
// `p.bruto` é o profile cru que `loadAdminUsers` guardou em cada linha —
// mesmos campos que a lista antiga usava (id, email, name, role,
// is_superadmin, disabled, avatar_url, allowed_accounts, permissions).
function _criarLinhaPessoa(p, gaveta, currentEmail) {
  const u = p.bruto
  const isSelf = u.email === currentEmail
  const isSuperAdmin = !!u.is_superadmin
  const canEdit = !isSuperAdmin || estado.is_superadmin // super-admin só é editável por outro super-admin

  const linha = document.createElement('div')
  linha.className = 'usr-linha'
  linha.dataset.uid = p.id
  if (u.disabled) linha.style.opacity = '.5'

  // ── topo: avatar + nome/badges/subtítulo (as outras duas lotações) + papel ──
  const topo = document.createElement('div')
  topo.className = 'usr-linha-topo'

  const avWrap = mkEl('div', 'av-wrap'); avWrap.style.cssText = 'width:32px;height:32px;'
  const av = mkEl('div'); av.style.cssText = 'width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:1px solid var(--border);overflow:hidden;position:relative;'
  av.style.background = u.role === 'admin' ? 'var(--accent)' : 'var(--surface2)'
  if (u.avatar_url) { const img = mkEl('img', 'av-img'); img.src = u.avatar_url + '?t=' + Date.now(); img.alt = ''; av.appendChild(img) }
  else { const avTxt = mkEl('span'); avTxt.style.cssText = 'font-family:var(--fonte-principal);font-size:max(9px, calc(13px * var(--escala-texto, 1)));font-weight:600'; avTxt.style.color = u.role === 'admin' ? 'var(--sobre-cor)' : 'var(--muted)'; avTxt.textContent = (p.nome || u.email).charAt(0).toUpperCase(); av.appendChild(avTxt) }
  const avEditBtn = mkEl('button', 'av-edit-btn'); avEditBtn.type = 'button'; avEditBtn.title = 'Trocar foto'
  avEditBtn.innerHTML = '<svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>'
  avEditBtn.addEventListener('click', () => _triggerAvatarUpload(u.id, (url) => {
    av.innerHTML = ''; const img = mkEl('img', 'av-img'); img.src = url + '?t=' + Date.now(); img.alt = ''; av.appendChild(img)
    // _setGubAvatar (botão de usuário global) ainda não existe no app Vue —
    // o typeof evita o ReferenceError que fazia aparecer um toast de erro falso
    // mesmo com o upload OK. Volta a funcionar sozinho se o botão global for portado.
    if (u.id === estado.userId && typeof _setGubAvatar === 'function') _setGubAvatar(url)
    adminToast('Foto atualizada!')
  }))
  avWrap.appendChild(av); avWrap.appendChild(avEditBtn)

  // ── A DISTRIBUIÇÃO DO CARD (redesenho de 13/08/2026, escolha do dono) ──────
  //
  // Antes eram QUATRO linhas empilhadas, todas do mesmo tamanho e do mesmo
  // cinza: lotação, resumo de acesso, e-mail e data. Nada se destacava, e o
  // e-mail — que é como se distingue uma pessoa de outra — era a última e a
  // menos visível.
  //
  // Agora o card responde duas perguntas em dois lugares:
  //   ESQUERDA  QUEM É   → avatar, nome, selos, e-mail logo abaixo do nome.
  //   DIREITA   O QUE PODE → papel, resumo do acesso, selo de dinheiro.
  //   EMBAIXO   CONTEXTO → lotação (ou o aviso de cadastro) e "desde", na
  //                        menor fonte, separados por um filete.
  // No celular a grade vira uma coluna só e a direita passa a ser uma fileira
  // que quebra — mesma informação, empilhada.
  //
  // NADA FOI PERDIDO NA MUDANÇA, e isso foi conferido item a item, porque o
  // padrão manda (§8) e porque já aconteceu antes nesta mesma lista: avatar +
  // botão de trocar foto, nome, selo "Você", selo SUPERADMIN, lotação, aviso de
  // cadastro, resumo do acesso, selo 💰, e-mail, "desde", papel, a fileira de
  // ações e o convite "tocar para abrir ›" do celular.
  const quem = mkEl('div', 'usr-quem')
  quem.appendChild(avWrap)

  const info = mkEl('div', 'usr-linha-info')
  const nomeWrap = mkEl('div', 'usr-nome-wrap')
  nomeWrap.appendChild(mkEl('span', 'usr-nome', p.nome))
  if (isSelf) nomeWrap.appendChild(mkEl('span', 'usr-badge', 'Você'))
  if (isSuperAdmin) nomeWrap.appendChild(mkEl('span', 'usr-badge usr-badge-super', 'SUPERADMIN'))
  info.appendChild(nomeWrap)

  // O E-MAIL SOBE PARA DEBAIXO DO NOME: é identidade, não rodapé. Era aqui que
  // o dono não achava o e-mail das pessoas dos times de venda.
  const { email: emailDoCard, desde } = partesDeContato(p)
  if (emailDoCard) info.appendChild(mkEl('div', 'usr-contato', emailDoCard))
  quem.appendChild(info)

  // O clique no bloco de identidade abre a ficha. NÃO na linha inteira: a
  // fileira de ações fica logo abaixo, e clicar em "Permissões" abriria as
  // duas coisas.
  quem.style.cursor = 'pointer'
  quem.title = 'Abrir a ficha de ' + (p.nome || p.email)
  quem.addEventListener('click', () => abrirFichaDaPessoa(p))
  topo.appendChild(quem)

  // O resumo de uma linha: quem é essa pessoa aqui dentro, sem abrir (D5).
  //
  // Super-admin não passa por `permissions`: ele entra por is_superadmin, e as
  // marcas gravadas na coluna não decidem nada. Contar "15 de 22" nele seria
  // mentira legível — a linha do erick@ dizia que ele não mexia em veículo,
  // bem, peça nem etiqueta, quando ele cadastra e apaga os quatro. Por isso
  // aqui não vai contagem nem selo de dinheiro: a contagem não se aplica.
  // É a mesma resposta que a ficha já dá em _abaDeFerramentas.
  const direita = mkEl('div', 'usr-direita')
  direita.appendChild(mkEl('span', 'usr-papel papel-' + p.papel, p.papel))
  const resumoLinha = mkEl('div', 'usr-resumo')
  if (isSuperAdmin) {
    resumoLinha.textContent = 'Acesso total — super-admin'
  } else {
    const resumo = resumoDoAcesso(u.permissions)
    resumoLinha.textContent = `${resumo.frase} · ${resumo.quantos} de ${RECURSOS.length}`
    if (resumo.comDinheiro) {
      const resumoSelo = mkEl('span', 'perm-selo-dinheiro', `${EMOJI_DINHEIRO} ${resumo.comDinheiro}`)
      resumoLinha.appendChild(resumoSelo)
    }
  }
  direita.appendChild(resumoLinha)
  topo.appendChild(direita)

  // A LINHA DE CONTEXTO: lotação (ou o aviso laranja de cadastro) e "desde".
  // Só nasce se tiver o que dizer — filete sem conteúdo é sujeira.
  const sub = _subtitulo(p, gaveta) // já vem escapado (ou é o span fixo de "sem cadastro")
  if (sub || desde) {
    const ctx = mkEl('div', 'usr-ctx')
    ctx.innerHTML = sub
    if (desde) {
      if (sub) ctx.appendChild(document.createTextNode(' · '))
      ctx.appendChild(document.createTextNode(desde))
    }
    topo.appendChild(ctx)
  }
  linha.appendChild(topo)

  // ── ações: fileira própria, quebra livre — nunca estoura a largura do
  // cartão no celular. `.usr-acoes` no CSS garante alvo de toque >=40px.
  //
  // NO CELULAR ESTA FILEIRA FICA ESCONDIDA (ver o @media no fim do arquivo) e
  // as mesmas ações aparecem na ficha, que abre tocando no nome. Com quatro
  // controles por pessoa e quinze pessoas, a lista virava meia tela por linha,
  // com "Excluir" em vermelho a um toque de distância em todas elas.
  const acoes = _construirAcoes(p, u, { isSelf, canEdit })
  linha.appendChild(acoes)
  return linha
}

// As ações de uma pessoa, num bloco só. Usada pela LINHA (no computador) e pela
// FICHA (sempre) — uma função só para os dois, senão os dois lugares divergem
// e um deles fica com o comportamento velho sem ninguém perceber.
function _construirAcoes(p, u, { isSelf, canEdit }) {
  const acoes = mkEl('div', 'usr-acoes')

  const sel = mkEl('select', 'admin-form-input usr-acao-select')
  ;[{ v: 'viewer', l: 'Viewer' }, { v: 'admin', l: 'Admin' }].forEach(({ v, l }) => {
    const o = mkEl('option'); o.value = v; o.textContent = l; if (u.role === v) o.selected = true; sel.appendChild(o)
  })
  if (!isSelf && canEdit) {
    sel.addEventListener('change', async () => {
      await adFetch('profiles?id=eq.' + u.id, { method: 'PATCH', body: JSON.stringify({ role: sel.value }) })
      adminToast('Role atualizado'); setTimeout(loadAdminUsers, 800)
    })
  } else sel.disabled = true
  acoes.appendChild(sel)

  // A TROCA DE SENHA SAIU DAQUI e foi para a ficha da pessoa (etapa 2), onde
  // ela ganhou o botão de copiar e a senha que permanece na tela até a ficha
  // fechar. Dois caminhos para a mesma coisa é o começo de dois comportamentos
  // diferentes — e o daqui não copiava, então mandaria o dono anotar à mão.
  // A ficha abre clicando no nome da pessoa.

  if (isSelf) {
    const notifBtn = mkEl('button', 'btn usr-acao-btn'); notifBtn.type = 'button'; notifBtn.textContent = 'Minhas notificações'
    notifBtn.addEventListener('click', () => _abrirMinhasNotificacoes(u))
    acoes.appendChild(notifBtn)
  }

  if (!isSelf && canEdit) {
    const permBtn = mkEl('button', 'btn usr-acao-btn'); permBtn.type = 'button'; permBtn.textContent = 'Permissões'
    permBtn.addEventListener('click', () => openPermModal(u))
    acoes.appendChild(permBtn)

    const disBtn = mkEl('button', 'btn usr-acao-btn' + (u.disabled ? '' : ' btn-perigo'))
    disBtn.type = 'button'; disBtn.textContent = u.disabled ? 'Ativar' : 'Desativar'
    disBtn.addEventListener('click', async () => {
      await adFetch('profiles?id=eq.' + u.id, { method: 'PATCH', body: JSON.stringify({ disabled: !u.disabled }) })
      adminToast(u.disabled ? 'Usuário ativado' : 'Usuário desativado'); setTimeout(loadAdminUsers, 600)
    })
    acoes.appendChild(disBtn)

    // SENSITIVE MUTATION — exclui usuário DE VERDADE (edge function
    // invite-user com {deleteUserId}). Único confirm() do módulo Admin,
    // preservado com a MESMA mensagem/lugar do legado.
    const delBtn = mkEl('button', 'btn usr-acao-btn btn-perigo'); delBtn.type = 'button'; delBtn.textContent = 'Excluir'
    delBtn.addEventListener('click', async () => {
      if (!confirm(`Excluir definitivamente "${u.name || u.email}"?\n\nRemove o acesso e o perfil. Esta ação NÃO pode ser desfeita.`)) return
      delBtn.disabled = true; delBtn.textContent = 'Excluindo…'
      try {
        const { data: { session: s } } = await sbClient.auth.getSession()
        const tok = s?.access_token || SUPABASE_ANON_KEY
        const r = await fetch(`${SUPABASE_URL}/functions/v1/invite-user`, { method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ deleteUserId: u.id }) })
        const res = await r.json()
        if (res.error) throw new Error(res.error)
        adminToast('Usuário excluído')
        setTimeout(loadAdminUsers, 600)
      } catch (e) {
        alert('Erro ao excluir: ' + (e.message || e))
        delBtn.disabled = false; delBtn.textContent = 'Excluir'
      }
    })
    acoes.appendChild(delBtn)
  }

  return acoes
}

// A FILEIRA DE FILTROS DE ESTADO.
//
// ⚠️ FILTRO ZERADO NÃO APARECE. Hoje ninguém está desativado; um botão
// "Desativado (0)" que só sabe esvaziar a lista é controle morto, e controle
// morto ensina a não confiar nos outros. Ele volta sozinho no dia em que
// alguém for desativado.
//
// Se NENHUM estado tem gente, a fileira inteira não nasce — a tela fica
// idêntica ao que sempre foi.
function _desenharFiltrosDeEstado(alvo, contagem, lerEscolhidos, aoMudar) {
  const comGente = ESTADOS.filter((e) => (contagem[e.chave] || 0) > 0)
  if (!comGente.length) return
  const escolhidos = lerEscolhidos() || []

  const fila = mkEl('div', 'usr-filtros')
  fila.setAttribute('role', 'group')
  fila.setAttribute('aria-label', 'Filtrar por situação')

  for (const e of comGente) {
    const ligado = escolhidos.includes(e.chave)
    const b = mkEl('button', 'usr-filtro' + (ligado ? ' usr-filtro-on' : ''))
    b.type = 'button'
    b.title = e.ajuda
    // `aria-pressed` e não `aria-checked`: é um botão que fica apertado, e quem
    // usa leitor de tela precisa ouvir que ele TEM estado — sem isso o filtro
    // ligado e o desligado se anunciam igual.
    b.setAttribute('aria-pressed', ligado ? 'true' : 'false')
    b.appendChild(mkEl('span', null, e.rotulo))
    b.appendChild(mkEl('span', 'usr-filtro-conta', String(contagem[e.chave])))
    b.addEventListener('click', () => {
      const atual = lerEscolhidos() || []
      aoMudar(atual.includes(e.chave) ? atual.filter((c) => c !== e.chave) : [...atual, e.chave])
    })
    fila.appendChild(b)
  }

  if (escolhidos.length) {
    const limpar = mkEl('button', 'usr-filtro usr-filtro-limpar', 'Limpar')
    limpar.type = 'button'
    limpar.addEventListener('click', () => aoMudar([]))
    fila.appendChild(limpar)
  }
  alvo.appendChild(fila)
}

// "MOSTRANDO 4 DE 19". Só aparece quando algo está filtrando.
//
// ⚠️ ISTO NÃO É ENFEITE. Esta lista já escondeu gente por outro motivo — quem
// está num time saiu daqui e virou cartão dentro da loja — e uma lista que
// encolhe sem dizer por quê é lida como "sumiu do sistema". Com filtro ligado,
// o número tem de estar escrito.
function _desenharContagem(alvo, mostrando, total, filtrando) {
  if (!filtrando) return
  const el = mkEl('div', 'usr-contagem')
  el.setAttribute('role', 'status')
  el.setAttribute('aria-live', 'polite')
  el.textContent = mostrando === total
    ? `${total} ${total === 1 ? 'pessoa' : 'pessoas'}`
    : `Mostrando ${mostrando} de ${total} ${total === 1 ? 'pessoa' : 'pessoas'}`
  alvo.appendChild(el)
}

function _desenharGrupos(alvo, linhas, gaveta, currentEmail) {
  const grupos = agruparPor(linhas, gaveta)
  if (!grupos.length) {
    // A frase dizia "com esse nome" — e desde que existem filtros de situação,
    // a lista também pode esvaziar sem ninguém ter digitado nada. Mandar
    // procurar o nome errado é pior que não explicar.
    alvo.insertAdjacentHTML('beforeend',
      '<div class="usr-vazio">Ninguém aqui com essa busca ou esse filtro.</div>')
    return
  }
  for (const g of grupos) {
    const cx = document.createElement('div')
    cx.className = 'usr-grupo' + (g.semLotacao ? ' grupo-sem' : '')
    cx.innerHTML = `
      <div class="usr-grupo-cab">
        <span>${esc(g.rotulo)} · ${g.quantos}</span>
        ${g.semLotacao ? '<span class="usr-preencher">preencher ›</span>' : ''}
      </div>`
    for (const p of g.pessoas) cx.appendChild(_criarLinhaPessoa(p, gaveta, currentEmail))
    alvo.appendChild(cx)
  }
}

/* ── USUÁRIOS (legacy L4609-4708, adaptado — ver comentário acima: a lista
   de linhas ricas virou diretório agrupado por lotação) ── */
async function loadAdminUsers() {
  // Times de venda virou seção de Usuários (Task 5). Agora é ESPERADO, e só a
  // busca: quem está num time sai da lista de baixo e vira cartão dentro do
  // card da loja dele, então a lista de baixo não pode ser desenhada antes de
  // saber quem está em time. O desenho dos times acontece no fim desta função,
  // quando as linhas das pessoas já existem.
  // Os canais vêm ANTES dos times: a ficha do time mostra o grupo que ela herda
  // do canal, e para isso `_canaisComGrupo` já precisa estar carregado.
  await loadAdminCanais()
  await loadAdminEquipes({ desenhar: false })

  const alvo = document.getElementById('admin-user-list')

  // A lotação mora no cadastro de Colaboradores, não no login — uma verdade só.
  // `organizacao` é o LOCAL (Sede Centro, Sede Village, Fábrica Conchal): o nome
  // da coluna é histórico, o conteúdo é lugar.
  //
  // USE `sbClient`, NÃO o `sb()` desta tela: o `sb()` monta o cabeçalho com
  // `estado.currentSession?.access_token || SUPABASE_ANON_KEY` — e, com a chave
  // anônima, o PostgREST responde 200 com lista VAZIA para tabela que só abre
  // para `authenticated`. Falha que se disfarça de "não tem nada". Foi
  // exatamente isso que matou o botão "Puxar das vendedoras" em 05/08/2026
  // (ver comentário de _vdPuxar). `acessos_pessoas` está nessa situação.
  const [rp, rc] = await Promise.all([
    // avatar_url e allowed_accounts entraram na Correção 1: sem eles a foto
    // não desenha e o editor de permissões (openPermModal) recebe
    // allowed_accounts undefined em vez do valor gravado. created_at entrou
    // na Correção 2, pra mostrar "desde <data>" junto do e-mail.
    // `perfil_id` entrou na revisão final (12/08/2026): sem ele o editor de
    // permissões não sabe em que perfil a pessoa está, e sem saber disso não dá
    // pra registrar o que foi dado à mão como exceção (D9). Era por isso que a
    // exceção nunca era gravada e o perfil apagava trabalho na regravação.
    // `escopo_por_equipe` entrou em 12/08/2026: a chave "só os canais dos times
    // dela" virou linha do editor de permissões, e sem a coluna aqui ela
    // apareceria sempre marcada (o default restritivo) mesmo em quem vê tudo.
    sbClient.from('profiles').select('id,email,name,role,is_superadmin,permissions,disabled,avatar_url,allowed_accounts,created_at,perfil_id,escopo_por_equipe'),
    // `id`, `email_corporativo` e `conta_apple` entraram na etapa 2 e são
    // ESSENCIAIS: sem os dois e-mails, `estadoDoVinculo` não acha candidato
    // nenhum e a Raíssa — que TEM cadastro ativo com o e-mail idêntico ao
    // login — continuaria aparecendo como "sem cadastro de colaborador". Sem o
    // `id`, ligar o cadastro mandaria `undefined` e não atualizaria nada. Os
    // dois defeitos seriam silenciosos: nenhum erro, nenhum teste vermelho.
    sbClient.from('acessos_pessoas').select(
      'id,profile_id,nome,email_corporativo,conta_apple,setor_id,organizacao_id,marca_id,'
      + 'acessos_setores(nome),acessos_organizacoes(nome),patrimonio_empresas(nome)'),
  ])
  if (rp.error || rc.error) {
    // Erro NÃO vira lista vazia: dizer "não há usuários" quando a leitura falhou
    // é a mentira mais cara desta tela.
    alvo.innerHTML = '<div class="usr-vazio">Não consegui ler os usuários: '
      + esc((rp.error || rc.error).message) + '</div>'
    return
  }
  const perfis = rp.data || []
  const pessoas = rc.data || []
  _usersCache = perfis // p/ o "duplicar permissões de outro usuário" no editor

  // Os perfis existentes, pra oferecer "começar com o acesso de…" no formulário
  // de criar usuário (Task 5). Falhar aqui não pode impedir criar usuário: sem
  // perfil, a pessoa nasce sem nada, que é o padrão do projeto (permissão nasce
  // desmarcada).
  // Revisão: um 4xx do PostgREST devolve um OBJETO de erro, `.json()` resolve
  // normal (não lança), e sem checar `.ok` o `_perfisCache` virava esse
  // objeto — `.forEach`/`.find` nele lançavam TypeError que escapava desta
  // função inteira e derrubava a renderização da lista de usuários. Por isso
  // dois cintos: `.ok` antes de ler o corpo, e `Array.isArray` antes de
  // aceitar o resultado.
  try {
    const rPerfis = await adFetch('acessos_perfis?select=id,nome,permissions&order=nome')
    const jPerfis = rPerfis.ok ? await rPerfis.json() : null
    _perfisCache = Array.isArray(jPerfis) ? jPerfis : []
  } catch { _perfisCache = [] }
  const selPerfilForm = document.getElementById('adm-perfil')
  if (selPerfilForm) {
    while (selPerfilForm.options.length > 1) selPerfilForm.remove(1)
    ;(_perfisCache || []).forEach(p => {
      selPerfilForm.appendChild(new Option(`${p.nome} — ${Object.keys(p.permissions || {}).length} ferramentas`, p.id))
    })
  }

  // AS TRÊS LISTAS SÃO ESPERADAS, e não carregadas soltas em segundo plano.
  //
  // A primeira versão usava `.then()` sem esperar, para não atrasar a lista de
  // pessoas. Mas a lista já fica clicável antes disso resolver: quem abrisse a
  // ficha de alguém JÁ LOTADO nessa janela veria os três campos em "— não
  // informado —", porque o select é montado uma vez com a lista ainda vazia.
  // Ou seja, a tela diria "não tem" para quem tem — que é exatamente a mentira
  // que esta etapa existe para consertar (o caso da Raíssa). São três consultas
  // pequenas em paralelo; o atraso não se compara ao estrago.
  const [rMarcas, rLocais, rSetores] = await Promise.all([
    sbClient.from('patrimonio_empresas').select('id,nome').order('nome'),
    sbClient.from('acessos_organizacoes').select('id,nome').order('nome'),
    sbClient.from('acessos_setores').select('id,nome').order('nome'),
  ])
  const errListas = rMarcas.error || rLocais.error || rSetores.error
  if (errListas) {
    // Select vazio pareceria "não há setores cadastrados" — mentira que faz o
    // dono achar que precisa cadastrar tudo de novo.
    adminToast('Não consegui carregar as listas de marca/local/setor: ' + errListas.message, false)
  } else {
    _listasDeLotacao = { marca: rMarcas.data || [], local: rLocais.data || [], setor: rSetores.data || [] }
  }
  // A ficha precisa da lista INTEIRA, inclusive de quem ainda não tem login:
  // é justamente entre esses que mora o cadastro a sugerir.
  _colaboradores = pessoas

  const active = perfis.filter(u => !u.disabled), admins = active.filter(u => u.role === 'admin').length
  const stats = document.getElementById('admin-stats-users'); stats.replaceChildren()
  ;[[perfis.length, 'Total'], [admins, 'Admins'], [active.length - admins, 'Viewers'], [perfis.filter(u => u.disabled).length, 'Inativos']].forEach(([v, l]) => {
    const s = mkEl('div', 'admin-stat'); s.appendChild(mkEl('div', 'admin-stat-val', String(v))); s.appendChild(mkEl('div', 'admin-stat-lbl', l)); stats.appendChild(s)
  })

  const porPerfil = {}
  for (const p of pessoas) if (p.profile_id) porPerfil[p.profile_id] = p
  const linhas = perfis.map((u) => {
    const c = porPerfil[u.id]
    return {
      id: u.id, nome: c?.nome || u.name || u.email, email: u.email,
      papel: u.is_superadmin ? 'super' : (u.role || 'viewer'),
      marca: c?.patrimonio_empresas?.nome || null,
      local: c?.acessos_organizacoes?.nome || null,
      setor: c?.acessos_setores?.nome || null,
      temCadastro: !!c, bruto: u,
    }
  })

  // A barra (seletor + busca) só é reconstruída quando a gaveta muda — trocar
  // gaveta é clique deliberado, então recriar o campo de busca ali não perde
  // nada. Já a cada tecla digitada só os GRUPOS são redesenhados: recriar o
  // <input> de busca a cada tecla derrubaria o foco/cursor no meio da digitação.
  const currentEmail = estado.user?.email || '' // quem sou eu, pra "Você" e pra travar autopromoção
  let gaveta = _gavetaEscolhida()
  let termo = ''
  const grupos = document.createElement('div')

  // QUEM ESTÁ NUM TIME SAI DAQUI. A pessoa aparece dentro do card da loja dela,
  // e não nos dois lugares: repetir a mesma pessoa em duas listas é o
  // "informação demais" que o dono pediu pra cortar, e é também como duas
  // telas começam a divergir.
  //
  // `linhas` (a lista INTEIRA) continua indo pra `_eqLinhasPessoa`, porque é
  // dela que os cards das lojas tiram a pessoa.
  _eqLinhasPessoa = linhas
  _eqGaveta = gaveta
  _eqMeuEmail = currentEmail
  const emTime = new Set(_eqMembros.map((m) => String(m.profile_id)))
  const linhasSemTime = linhas.filter((l) => !emTime.has(String(l.id)))

  // OS FILTROS DE ESTADO (27/08/2026). A lista já sabia responder "onde está
  // fulano" — a busca por nome/e-mail e a gaveta por Marca. O que faltava era a
  // pergunta do outro lado: "quem está em tal situação?". Os avisos existiam,
  // mas um por cartão: descobrir que 4 pessoas estão sem cadastro de colaborador
  // exigia varrer os 19 com o olho.
  let estadosEscolhidos = []

  function _redesenharGrupos() {
    grupos.innerHTML = ''
    // A ORDEM IMPORTA: filtra por estado, depois por texto, e só então agrupa.
    // Agrupar antes faria os cabeçalhos mostrarem contagem de gente que a lista
    // não está mostrando — a mesma razão pela qual a busca já filtrava antes.
    const visiveis = _filtrar(aplicarEstados(linhasSemTime, estadosEscolhidos), termo)
    _desenharContagem(grupos, visiveis.length, linhasSemTime.length,
      estadosEscolhidos.length > 0 || !!_crua(termo))
    _desenharGrupos(grupos, visiveis, gaveta, currentEmail)
  }

  function _redesenharTudo() {
    alvo.innerHTML = ''
    _desenharSeletor(alvo, gaveta, (nova) => { gaveta = nova; _eqGaveta = nova; _redesenharTudo(); _eqDesenhar() })
    const busca = mkEl('input', 'admin-form-input usr-busca')
    busca.type = 'search'
    busca.placeholder = 'Buscar por nome ou email…'
    busca.value = termo
    busca.addEventListener('input', () => { termo = busca.value; _redesenharGrupos() })
    alvo.appendChild(busca)
    // A contagem dos filtros olha a lista INTEIRA, não a filtrada: um filtro cujo
    // número mudasse conforme os outros filtros faria a pessoa perseguir o
    // próprio clique.
    _desenharFiltrosDeEstado(alvo, contarEstados(linhasSemTime), () => estadosEscolhidos,
      (novos) => { estadosEscolhidos = novos; _redesenharTudo() })
    alvo.appendChild(grupos)
    _redesenharGrupos()
  }
  _redesenharTudo()

  // OS TIMES DESENHAM POR ÚLTIMO, agora que `_eqLinhasPessoa` existe: é dela
  // que cada card de loja tira o cartão das pessoas dele.
  _eqDesenhar()
}

// Mini-form de troca de senha (só superadmin). Abre inline na linha do usuário; digita OU gera.
// A troca em si roda na Edge invite-user ({resetPasswordUserId,password}), que confere superadmin
// no servidor e usa auth.admin.updateUserById (service_role nunca vai pro front).
// `_abrirTrocaSenha` foi APAGADA aqui: a troca de senha virou seção da ficha
// da pessoa, com gerar, copiar e a senha permanecendo na tela. Esta versão não
// copiava — mandava "anote e passe pro usuário".
// SENSITIVE MUTATION — cria/convida usuário DE VERDADE (edge function
// invite-user). Sem confirm() no legado; nenhum foi adicionado aqui.
async function adminInviteUser(mode) {
  const email = document.getElementById('adm-email').value.trim()
  const name = document.getElementById('adm-name').value.trim()
  const password = document.getElementById('adm-pass').value
  const role = document.getElementById('adm-role').value
  const selPerfil = document.getElementById('adm-perfil')
  const perfilEscolhidoId = selPerfil ? selPerfil.value : ''
  const msg = document.getElementById('adm-invite-msg')
  if (!email) { msg.textContent = 'Informe o email.'; msg.style.color = 'var(--red)'; return }
  const isInvite = mode === 'invite' || !password
  if (!isInvite && password.length < 6) { msg.textContent = 'A senha precisa ter no mínimo 6 caracteres.'; msg.style.color = 'var(--red)'; return }
  msg.textContent = isInvite ? 'Enviando convite...' : 'Criando acesso...'; msg.style.color = 'var(--muted)'

  // Task 5 (D7, segunda metade), revisão: a pergunta certa é "esta conta já
  // existia?", checada ANTES de chamar invite-user — não "ela parece vazia?"
  // depois. Conta criada sem permissão marcada (fluxo normal desta tela),
  // conta que teve TUDO revogado (permissions={}, features=[] — mesma cara
  // de recém-nascida) e conta desativada de ex-funcionário são todas
  // indistinguíveis de "acabou de nascer" só pelo estado do dado. E o edge
  // devolve sucesso mesmo quando o e-mail já tem conta (só reenvia link de
  // senha), então o estado DEPOIS da chamada não prova nada. `ilike` porque
  // e-mail não diferencia por maiúscula/minúscula.
  // `null` = não consegui saber se já existia — nesse caso NÃO aplica: errar
  // para o lado de não mexer em conta alheia.
  //
  // Re-revisão: `_` e `%` são curingas no ILIKE, e `encodeURIComponent`
  // resolve transporte (URL), não metacaractere de padrão — os dois
  // problemas são independentes. `erick_martins@` sem escapar casaria
  // `erick.martins@` também. `paraIlike` (escapar-curinga-ilike.js) escapa
  // antes de codificar.
  const jaExistia = perfilEscolhidoId
    ? await adFetch(`profiles?select=id&email=ilike.${encodeURIComponent(paraIlike(email))}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => (Array.isArray(j) ? j.length > 0 : null))
        .catch(() => null)
    : false

  const { data: { session: s } } = await sbClient.auth.getSession()
  const tok = s?.access_token || SUPABASE_ANON_KEY
  const body = isInvite ? { email, name, role } : { email, name, role, password }
  const r = await fetch(`${SUPABASE_URL}/functions/v1/invite-user`, { method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const res = await r.json()
  if (res.error) { msg.textContent = 'Erro: ' + res.error; msg.style.color = 'var(--red)' }
  else {
    msg.textContent = isInvite ? '✓ Convite enviado para ' + email : '✓ Acesso criado para ' + email
    msg.style.color = 'var(--green)'

    // A MENSAGEM DE ACESSO FICA À MÃO, num botão, ANTES de os campos serem
    // limpos. Até aqui a senha era apagada do campo no instante do sucesso e
    // não sobrava jeito nenhum de copiá-la: quem criava o acesso tinha que
    // lembrar de cor o que digitou, ou trocar a senha de novo pela ficha da
    // pessoa só para conseguir copiar. A senha vive só nesta função — nada
    // dela vai para a tela nem fica guardado em lugar nenhum.
    const recado = recadoDeAcesso({ email, senha: isInvite ? '' : password })
    const btnCopiar = mkEl('button', 'btn', isInvite ? 'Copiar recado' : 'Copiar mensagem de acesso')
    btnCopiar.type = 'button'
    btnCopiar.style.marginLeft = '8px'
    btnCopiar.addEventListener('click', () => _copiar(recado, (ok) => adminToast(
      ok ? 'Mensagem copiada — é só colar pra pessoa.'
         : 'Não consegui copiar — troque a senha pela ficha da pessoa e copie de lá.', ok)))
    msg.appendChild(btnCopiar)

    ;['adm-email', 'adm-name', 'adm-pass'].forEach(id => document.getElementById(id).value = '')

    // Se foi escolhido "começar com o acesso de…", aplica o perfil na pessoa
    // — só quando `jaExistia === false`, ou seja, só na pessoa que este
    // clique acabou de criar. O edge invite-user (supabase/functions/
    // invite-user/index.ts) só grava id/email/name/role no upsert —
    // conferido por leitura, não aceita perfil_id/permissions — por isso a
    // aplicação acontece aqui, com PATCH direto em profiles via adFetch, do
    // mesmo jeito que o editor de permissões já grava (savePermissions,
    // ~L1480). `avisoPerfil` vira parte da MESMA frase do toast final — não
    // um segundo toast que contradiz o primeiro.
    let avisoPerfil = ''
    if (perfilEscolhidoId) {
      const perfil = _perfisCache.find(p => p.id === perfilEscolhidoId)
      if (perfil) {
        if (jaExistia === true) {
          avisoPerfil = ' Esse e-mail já tinha conta — não mexi no perfil dela, marque manualmente se for o caso.'
        } else if (jaExistia === null) {
          avisoPerfil = ' Não consegui confirmar se o e-mail já tinha conta, então não apliquei o perfil — marque manualmente.'
        } else {
          // GRAVE se sair errado: esta consulta escolhe QUEM recebe o PATCH
          // do perfil. Sem escapar o curinga, um e-mail com `_` casaria conta
          // de outra pessoa e aplicaria o perfil nela — exatamente o risco
          // que a guarda de pré-existência acima existe pra fechar, só que
          // por uma porta lateral. `&limit=1` é só teto de tamanho, NÃO é a
          // proteção — a proteção é o escaping.
          //
          // `limit=1` sozinho TRUNCA a resposta em 1 linha, e uma resposta
          // truncada não prova nada sobre quantas linhas existiam — por isso
          // vai junto `Prefer: count=exact`, que faz o PostgREST devolver o
          // TOTAL de casamentos no cabeçalho `Content-Range` (formato
          // "0-0/N"), independente do `limit`. Se o total vier > 1 — dado
          // estranho, e-mail duplicado por alguma falha anterior — a resposta
          // é NÃO aplicar e avisar, nunca escolher a primeira linha às cegas.
          // Se o cabeçalho não vier (CORS não expôs `Content-Range`), cai no
          // tamanho do corpo como total — despiora a segurança em nada, só
          // perde o bônus de detectar >1: quem protege de verdade continua
          // sendo o escaping.
          const rNovo = await adFetch(`profiles?select=id&email=ilike.${encodeURIComponent(paraIlike(email))}&limit=1`, {
            headers: { Prefer: 'count=exact' },
          }).catch(() => null)
          const jNovo = rNovo && rNovo.ok ? await rNovo.json() : null
          const linhasNovo = Array.isArray(jNovo) ? jNovo : []
          const contentRange = rNovo && rNovo.ok ? rNovo.headers.get('content-range') : null
          const totalMatches = contentRange ? Number(contentRange.split('/')[1]) : linhasNovo.length
          const novoId = Number.isFinite(totalMatches) && totalMatches === 1 && linhasNovo.length === 1
            ? linhasNovo[0]?.id : null
          if (Number.isFinite(totalMatches) && totalMatches > 1) {
            avisoPerfil = ' Mas achei mais de um cadastro com esse e-mail — não apliquei o perfil, confira o dado.'
          } else if (novoId) {
            const permissions = { ...perfil.permissions }
            const rPatch = await adFetch('profiles?id=eq.' + novoId, {
              method: 'PATCH',
              body: JSON.stringify({
                perfil_id: perfil.id,
                permissions,
                permissions_excecao: {},
                features: derivarFeatures(permissions, { ehSuperadmin: false }),
              }),
            }).catch(() => null)
            if (!rPatch || !rPatch.ok) avisoPerfil = ' Mas não consegui aplicar o perfil — marque manualmente.'
          } else {
            avisoPerfil = ' Mas não achei o cadastro pra aplicar o perfil — marque manualmente.'
          }
        }
      }
    }
    if (selPerfil) selPerfil.value = ''

    const textoFinal = (isInvite ? 'Convite enviado!' : 'Acesso criado com sucesso') + avisoPerfil
    adminToast(textoFinal, !avisoPerfil)
    setTimeout(loadAdminUsers, 1200)
  }
}

/* ── CONTAS (legacy L4711-4759, verbatim) ── */
async function loadAdminAccounts() {
  const accounts = await sb('accounts?order=name.asc&select=id,name,username,instagram_id,picture_url,accent_color')
  const c = document.getElementById('admin-accounts-list'); c.innerHTML = ''
  if (accounts.erro) {
    c.appendChild(mkEl('div', null, 'Não consegui carregar as contas: ' + (accounts.erro.mensagem || 'erro desconhecido')))
    c.lastChild.style.color = 'var(--red)'
    return
  }
  accounts.forEach(acc => {
    const storedColor = acc.accent_color || (PROFILE_THEMES[acc.name] || { accent: '#1A3A6B' }).accent
    const card = mkEl('div', 'sg'); card.style.marginBottom = '12px'
    const head = mkEl('div', 'sr'); head.style.cssText = 'border-bottom:1px solid var(--border);padding-bottom:0'
    const av = mkEl('div'); av.style.cssText = `width:44px;height:44px;border-radius:50%;background:${storedColor};display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden;border:2px solid var(--border)`
    if (acc.picture_url) { const img = mkEl('img'); img.src = acc.picture_url; img.style.cssText = 'width:100%;height:100%;object-fit:cover'; av.appendChild(img) }
    else { const sp = mkEl('span'); sp.style.cssText = 'color:var(--sobre-cor);font-size:max(16px, calc(16px * var(--escala-texto, 1)));font-weight:700'; sp.textContent = acc.name.charAt(0); av.appendChild(sp) }
    const hMain = mkEl('div', 'sr-main'); hMain.style.marginLeft = '12px'
    hMain.appendChild(mkEl('div', 'sr-label', acc.name))
    hMain.appendChild(mkEl('div', 'sr-sub', acc.instagram_id))
    const connBadge = mkEl('span'); connBadge.style.cssText = 'display:flex;align-items:center;gap:5px;font-family:var(--fonte-principal);font-size:max(9px, calc(11px * var(--escala-texto, 1)));color:var(--green)'
    const dot = mkEl('span', 'online-dot'); connBadge.appendChild(dot); connBadge.appendChild(document.createTextNode('Conectada'))
    head.appendChild(av); head.appendChild(hMain); head.appendChild(connBadge); card.appendChild(head)
    const nameRow = mkEl('div', 'sr'); nameRow.style.justifyContent = 'space-between'; nameRow.appendChild(mkEl('div', 'sr-sub', 'Nome da conta'))
    const nameInp = mkEl('input', 'auth-input'); nameInp.value = acc.name; nameInp.style.cssText = 'max-width:220px;font-size:max(9px, calc(12px * var(--escala-texto, 1)));padding:5px 10px'
    nameRow.appendChild(nameInp); card.appendChild(nameRow)
    const usrRow = mkEl('div', 'sr'); usrRow.style.justifyContent = 'space-between'; usrRow.appendChild(mkEl('div', 'sr-sub', 'Username'))
    const usrInp = mkEl('input', 'auth-input'); usrInp.value = acc.username; usrInp.style.cssText = 'max-width:220px;font-size:max(9px, calc(12px * var(--escala-texto, 1)));padding:5px 10px'
    usrRow.appendChild(usrInp); card.appendChild(usrRow)
    const colorRow = mkEl('div', 'sr'); colorRow.style.justifyContent = 'space-between'; colorRow.appendChild(mkEl('div', 'sr-sub', 'Cor de destaque'))
    const colorWrap = mkEl('div'); colorWrap.style.cssText = 'display:flex;align-items:center;gap:10px'
    const colorPick = mkEl('input'); colorPick.type = 'color'; colorPick.value = storedColor; colorPick.style.cssText = 'width:36px;height:28px;border:none;border-radius:6px;cursor:pointer;background:none;padding:0'
    const colorVal = mkEl('span', 'sr-val', storedColor)
    colorPick.addEventListener('input', () => { colorVal.textContent = colorPick.value; av.style.background = colorPick.value })
    colorWrap.appendChild(colorPick); colorWrap.appendChild(colorVal); colorRow.appendChild(colorWrap); card.appendChild(colorRow)
    const actRow = mkEl('div', 'sr'); actRow.style.justifyContent = 'flex-end'; actRow.style.gap = '8px'
    const saveBtn = mkEl('button', 'btn btn-principal'); saveBtn.textContent = 'Salvar alterações'
    saveBtn.addEventListener('click', async () => {
      saveBtn.textContent = 'Salvando...'; saveBtn.disabled = true
      const { error } = await sbClient.from('accounts').update({ name: nameInp.value.trim(), username: usrInp.value.trim(), accent_color: colorPick.value }).eq('id', acc.id)
      if (error) { saveBtn.textContent = 'Salvar alterações'; saveBtn.disabled = false; adminToast('Erro ao salvar: ' + error.message, false); return }
      if (PROFILE_THEMES[acc.name]) { const t = PROFILE_THEMES[acc.name]; t.accent = colorPick.value; t.light = colorPick.value + '1a'; t.mid = colorPick.value + '4d' }
      else { PROFILE_THEMES[nameInp.value.trim()] = { accent: colorPick.value, light: colorPick.value + '1a', mid: colorPick.value + '4d' } }
      saveBtn.textContent = 'Salvo ✓'; setTimeout(() => { saveBtn.textContent = 'Salvar alterações'; saveBtn.disabled = false }, 1500)
      adminToast('Conta atualizada')
    })
    actRow.appendChild(saveBtn); card.appendChild(actRow)
    c.appendChild(card)
  })
}

/* ── APARÊNCIA (legacy L4762-4801, verbatim) ── */
/* ── DADOS (legacy L4804-4839, verbatim) ── */
async function loadAdminData() {
  const accounts = await sb('accounts?order=name.asc&select=id,name')
  const syncEl = document.getElementById('admin-data-sync')
  if (accounts.erro) {
    syncEl.innerHTML = ''
    const aviso = mkEl('div', null, 'Não consegui carregar as contas: ' + (accounts.erro.mensagem || 'erro desconhecido'))
    aviso.style.color = 'var(--red)'; syncEl.appendChild(aviso)
    return
  }
  syncEl.innerHTML = ''; const loading = mkEl('div', 'sr'); loading.appendChild(mkEl('span', null, 'Carregando...')); syncEl.appendChild(loading)
  const [daily, eng, cnt, ads, syncResults] = await Promise.all([
    sb('daily_snapshots?select=id').then(r => r.erro ? '?' : r.length),
    sb('engagement_snapshots?select=id').then(r => r.erro ? '?' : r.length),
    sb('content_snapshots?select=id').then(r => r.erro ? '?' : r.length),
    sb('ads_snapshots?select=id').then(r => r.erro ? '?' : r.length),
    Promise.all(accounts.map(a => sb(`daily_snapshots?account_id=eq.${a.id}&order=captured_at.desc&limit=1&select=captured_at,followers_count`).then(r => ({ a, d: r[0] || null }))))
  ])
  const stats = document.getElementById('admin-data-stats'); stats.innerHTML = ''
  ;[[accounts.length, 'Contas'], [daily, 'Snapshots'], [eng, 'Engajamentos'], [cnt, 'Conteúdos'], [ads, 'Ads']].forEach(([v, l]) => {
    const s = mkEl('div', 'admin-stat'); s.appendChild(mkEl('div', 'admin-stat-val', String(v))); s.appendChild(mkEl('div', 'admin-stat-lbl', l)); stats.appendChild(s)
  })
  syncEl.innerHTML = ''
  syncResults.forEach(({ a, d }) => {
    const row = mkEl('div', 'sr'); row.style.justifyContent = 'space-between'
    const m = mkEl('div', 'sr-main'); m.appendChild(mkEl('div', 'sr-label', a.name))
    if (d) { const ago = Math.floor((Date.now() - new Date(d.captured_at)) / (864e5)); const sub = mkEl('div', 'sr-sub', `Última coleta: ${d.captured_at} (${ago === 0 ? 'hoje' : ago === 1 ? 'ontem' : ago + 'd atrás'})`); m.appendChild(sub) }
    row.appendChild(m)
    const val = mkEl('span', 'sr-val')
    if (d) { val.textContent = fmtN(d.followers_count) + ' seguidores'; val.style.color = d.followers_count > 0 ? 'var(--accent)' : 'var(--muted)' }
    else { val.textContent = 'Sem dados'; val.style.color = 'var(--orange)' }
    row.appendChild(val); syncEl.appendChild(row)
  })
}
function adminShowCmd(title, cmd) {
  const el = document.getElementById('admin-action-info'); el.style.display = 'block'; el.textContent = ''
  const card = mkEl('div', 'sg'); const row = mkEl('div', 'sr'); const m = mkEl('div', 'sr-main')
  m.appendChild(mkEl('div', 'sr-label', title))
  const code = mkEl('div'); code.style.cssText = 'margin-top:8px;font-family:monospace;background:var(--surface2);padding:10px 12px;border-radius:6px;font-size:max(9px, calc(11px * var(--escala-texto, 1)));line-height:1.8;white-space:pre;border:1px solid var(--border)'
  code.textContent = cmd; m.appendChild(code); row.appendChild(m); card.appendChild(row); el.appendChild(card)
}
function adminShowRefetchInfo() { adminShowCmd('Atualizar fotos de perfil', 'cd ~/IAmundi/projetos/central-inteligencia/redes-sociais/coletor\npython3 fetch_profile_pics.py') }
function adminShowColetorInfo() { adminShowCmd('Rodar coletor de dados', 'cd ~/IAmundi/projetos/central-inteligencia/redes-sociais/coletor\npython3 coletar.py') }

/* ── METAS ADMIN (legacy L4853-5076, verbatim) ── */
async function loadAdminMetas() {
  const body = document.getElementById('admin-metas-body')
  body.textContent = ''
  const now = new Date()
  const y = now.getFullYear(), m = now.getMonth() + 1
  const mesLabel = now.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }).toUpperCase()
  const [lojasRes, metasRes] = await Promise.all([
    sbClient.from('bling_lojas').select('loja_id,nome').order('nome'),
    sbClient.from('bling_metas').select('loja_id,meta_valor').eq('year', y).eq('month', m)
  ])
  const lojas = lojasRes.data || []
  const metasMap = {}; (metasRes.data || []).forEach(r => metasMap[r.loja_id] = r.meta_valor)
  const hasData = Object.keys(metasMap).length > 0
  const daysInMonth = new Date(y, m, 0).getDate()

  const safeRows = hasData ? [
    ...(metasMap[0] ? [`<tr><td><strong>Total Geral</strong></td><td style="text-align:right"><strong>${escHtml(fmtR(metasMap[0]))}</strong></td><td style="text-align:right;color:var(--muted)">${escHtml(fmtR(metasMap[0] / daysInMonth))}</td></tr>`] : []),
    ...lojas.filter(l => metasMap[l.loja_id]).map(l => `<tr><td>${escHtml(l.nome)}</td><td style="text-align:right">${escHtml(fmtR(metasMap[l.loja_id]))}</td><td style="text-align:right;color:var(--muted)">${escHtml(fmtR(metasMap[l.loja_id] / daysInMonth))}</td></tr>`)
  ].join('') : null

  const html = [
    '<div class="admin-section-sub" style="margin-bottom:20px">Importe uma planilha <strong>.xlsx</strong> (Excel) com as metas por canal. Baixe o template, preencha a meta de cada dia por canal e importe. Também aceita <em>.xls</em> e <em>.csv</em>.</div>',
    '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:24px">',
    '<button class="admin-btn-sm btn" onclick="downloadMetasTemplate()">',
    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Baixar template .xlsx</button>',
    `<label class="admin-btn-sm" style="display:flex;align-items:center;gap:6px;padding:8px 16px;cursor:pointer;background:var(--accent);color:var(--sobre-cor);border-color:var(--accent)">`,
    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>Importar planilha',
    `<input type="file" accept=".xlsx,.xls,.csv" id="metas-csv-input" style="display:none" onchange="importMetasCSV(this,${y},${m})"></label></div>`,
    '<div id="metas-import-msg" style="font-size:max(9px, calc(12px * var(--escala-texto, 1)));margin-bottom:16px;display:none"></div>',
    hasData ? `<div class="sg-label">Metas actuais — ${escHtml(mesLabel)}</div><div class="sg"><table class="metas-tbl"><thead><tr><th>Canal / Loja</th><th style="text-align:right">Meta (R$)</th><th style="text-align:right">Meta/dia*</th></tr></thead><tbody>${safeRows}</tbody></table><div style="font-size:max(9px, calc(10px * var(--escala-texto, 1)));color:var(--muted);padding:8px 0">*Meta diária = meta mensal ÷ dias do mês</div></div>`
      : '<div style="color:var(--muted);font-size:max(9px, calc(12px * var(--escala-texto, 1)));padding:8px 0">Nenhuma meta cadastrada para este mês. Importe uma planilha para começar.</div>'
  ].join('')
  body.innerHTML = html
  await loadAdminVendMetas(body, y, m, mesLabel)
}

async function downloadMetasTemplate() {
  const now = new Date()
  const y = now.getFullYear(), m = now.getMonth() + 1
  const daysInMonth = new Date(y, m, 0).getDate()
  const [{ data: lojas }, { data: metas }] = await Promise.all([
    sbClient.from('bling_lojas').select('loja_id,nome').order('nome'),
    sbClient.from('bling_metas').select('loja_id,meta_valor,daily_goals').eq('year', y).eq('month', m)
  ])
  const metasMap = {}; const dailyMap = {}
  ;(metas || []).forEach(r => { metasMap[r.loja_id] = r.meta_valor; if (r.daily_goals) dailyMap[r.loja_id] = r.daily_goals })
  const dayHdrs = Array.from({ length: daysInMonth }, (_, i) => `dia_${String(i + 1).padStart(2, '0')}`)
  const makeRow = (id, nome) => {
    const dg = dailyMap[id] || {}
    return [id, nome, ...Array.from({ length: daysInMonth }, (_, i) => dg[i + 1] != null ? Number(dg[i + 1]) : '')]
  }
  const rows = [['loja_id', 'nome', ...dayHdrs], makeRow(0, 'Total Geral'), ...(lojas || []).map(l => makeRow(l.loja_id, l.nome))]
  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!freeze'] = { xSplit: 2, ySplit: 1, topLeftCell: 'C2', activePane: 'bottomLeft', state: 'frozen' }
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Metas')
  XLSX.writeFile(wb, `metas_template_${y}_${String(m).padStart(2, '0')}.xlsx`)
}

async function importMetasCSV(input, y, m) {
  const file = input.files[0]
  if (!file) return
  showMetasMsg('Lendo arquivo...', false, true)
  try {
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf, { type: 'array', cellDates: false, raw: false })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
    if (!data.length) { showMetasMsg('Arquivo vazio.', true); return }
    const hdr = data[0].map(h => String(h == null ? '' : h).trim().toLowerCase())
    const idxId = hdr.indexOf('loja_id')
    const idxTotal = hdr.findIndex(h => h === 'meta_total' || h === 'meta_valor')
    const dayMap = []; hdr.forEach((h, i) => { const mt = /^dia_(\d+)$/.exec(h); if (mt) dayMap.push({ i, d: parseInt(mt[1]) }) })
    if (idxId < 0 || (idxTotal < 0 && !dayMap.length)) {
      const preview = hdr.filter(Boolean).slice(0, 5).join(' | ') || '(nenhuma)'
      showMetasMsg('Coluna loja_id nao encontrada. Colunas: ' + preview + '. Use o template.', true)
      return
    }
    const toNum = v => { if (typeof v === 'number') return isNaN(v) ? NaN : v; const s = String(v).trim().replace(/[R$\s]/g, ''); const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.'); return parseFloat(lc > ld ? s.replace(/\./g, '').replace(',', '.') : s) }
    const rows = []
    for (let i = 1; i < data.length; i++) {
      const row = data[i]
      const id = parseInt(String(row[idxId] || ''))
      if (isNaN(id)) continue
      const dg = {}; let sumDays = 0
      dayMap.forEach(({ i: ci, d: day }) => { const v = toNum(row[ci]); if (!isNaN(v) && v > 0) { dg[day] = v; sumDays += v } })
      const val = sumDays > 0 ? sumDays : (idxTotal >= 0 ? toNum(row[idxTotal]) : NaN)
      if (!isNaN(id) && !isNaN(val) && val > 0) {
        const rec = { loja_id: id, year: y, month: m, meta_valor: val }
        if (sumDays > 0) rec.daily_goals = dg
        rows.push(rec)
      }
    }
    if (!rows.length) { showMetasMsg('Nenhum valor valido encontrado. Verifique loja_id e valores nos dias.', true); return }
    showMetasMsg(`Importando ${rows.length} metas...`, false, true)
    const { error: delErr } = await sbClient.from('bling_metas').delete().eq('year', y).eq('month', m)
    if (delErr) { showMetasMsg('Erro ao limpar metas anteriores: ' + delErr.message, true); return }
    const { error } = await sbClient.from('bling_metas').insert(rows)
    if (error) { showMetasMsg('Erro ao salvar: ' + error.message, true) }
    else { showMetasMsg(`${rows.length} meta${rows.length !== 1 ? 's' : ''} importada${rows.length !== 1 ? 's' : ''}!`, false); loadAdminMetas() }
  } catch (e) { showMetasMsg('Erro ao ler arquivo: ' + e.message, true) }
  input.value = ''
}

async function loadAdminVendMetas(parentBody, y, m, mesLabel) {
  const [vendsRes, vendMetasRes] = await Promise.all([
    sbClient.from('bling_vendedores').select('vendor_id,nome').order('nome'),
    sbClient.from('bling_vendedor_metas').select('vendor_id,meta_valor').eq('year', y).eq('month', m)
  ])
  const vends = vendsRes.data || []
  const vendMetasMap = {}; (vendMetasRes.data || []).forEach(r => vendMetasMap[r.vendor_id] = r.meta_valor)
  const diasMes = new Date(y, m, 0).getDate()
  const hasVendData = Object.keys(vendMetasMap).length > 0

  const sec = document.createElement('div'); sec.style.marginTop = '32px'
  const hdr = document.createElement('div'); hdr.className = 'sg-label'; hdr.textContent = 'METAS DE VENDEDORAS'
  sec.appendChild(hdr)

  const desc = document.createElement('div'); desc.className = 'admin-section-sub'; desc.style.marginBottom = '20px'
  desc.textContent = 'Baixe o template, preencha as metas diárias por vendedora e importe.'
  sec.appendChild(desc)

  const btnRow = document.createElement('div'); btnRow.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:24px'

  const dlBtn = document.createElement('button'); dlBtn.className = 'admin-btn-sm'; dlBtn.style.cssText = 'display:flex;align-items:center;gap:6px;padding:8px 16px'; dlBtn.textContent = 'Baixar template .xlsx'
  dlBtn.addEventListener('click', () => downloadVendedoresTemplate())
  btnRow.appendChild(dlBtn)

  const label = document.createElement('label'); label.className = 'admin-btn-sm'; label.style.cssText = 'display:flex;align-items:center;gap:6px;padding:8px 16px;cursor:pointer;background:var(--accent);color:var(--sobre-cor);border-color:var(--accent)'
  label.textContent = 'Importar planilha'
  const fileInput = document.createElement('input'); fileInput.type = 'file'; fileInput.accept = '.xlsx,.xls,.csv'; fileInput.style.display = 'none'; fileInput.id = 'vend-metas-csv-input'
  fileInput.addEventListener('change', function () { importVendedoresCSV(this, y, m) })
  label.appendChild(fileInput)
  btnRow.appendChild(label)
  sec.appendChild(btnRow)

  const msgEl = document.createElement('div'); msgEl.id = 'vend-metas-import-msg'; msgEl.style.cssText = 'font-size:max(9px, calc(12px * var(--escala-texto, 1)));margin-bottom:16px;display:none'
  sec.appendChild(msgEl)

  if (hasVendData) {
    const tblTitle = document.createElement('div'); tblTitle.className = 'sg-label'; tblTitle.textContent = 'Metas actuais — ' + mesLabel; sec.appendChild(tblTitle)
    const sg = document.createElement('div'); sg.className = 'sg'
    const tbl = document.createElement('table'); tbl.className = 'metas-tbl'
    const thead = document.createElement('thead')
    const hr = document.createElement('tr')
    ;['Vendedora', 'Meta (R$)', 'Meta/dia'].forEach(h => { const th = document.createElement('th'); th.textContent = h; hr.appendChild(th) })
    thead.appendChild(hr); tbl.appendChild(thead)
    const tbody = document.createElement('tbody')
    vends.filter(v => vendMetasMap[v.vendor_id]).forEach(v => {
      const tr = document.createElement('tr')
      const nm = document.createElement('td'); nm.textContent = v.nome; tr.appendChild(nm)
      const mv = document.createElement('td'); mv.style.textAlign = 'right'; mv.textContent = fmtR(vendMetasMap[v.vendor_id]); tr.appendChild(mv)
      const md = document.createElement('td'); md.style.cssText = 'text-align:right;color:var(--muted)'; md.textContent = fmtR(vendMetasMap[v.vendor_id] / diasMes); tr.appendChild(md)
      tbody.appendChild(tr)
    })
    tbl.appendChild(tbody); sg.appendChild(tbl); sec.appendChild(sg)
  } else {
    const empty = document.createElement('div'); empty.style.cssText = 'color:var(--muted);font-size:max(9px, calc(12px * var(--escala-texto, 1)));padding:8px 0'; empty.textContent = 'Nenhuma meta de vendedora para este mês.'; sec.appendChild(empty)
  }
  parentBody.appendChild(sec)
}

async function downloadVendedoresTemplate() {
  const now = new Date(); const y = now.getFullYear(), m = now.getMonth() + 1; const diasMes = new Date(y, m, 0).getDate()
  const [{ data: vends }, { data: metas }] = await Promise.all([
    sbClient.from('bling_vendedores').select('vendor_id,nome').order('nome'),
    sbClient.from('bling_vendedor_metas').select('vendor_id,daily_goals').eq('year', y).eq('month', m)
  ])
  const dailyMap = {}; (metas || []).forEach(r => { if (r.daily_goals) dailyMap[r.vendor_id] = r.daily_goals })
  const dayHdrs = Array.from({ length: diasMes }, (_, i) => String(i + 1))
  const makeRow = (id, nome) => { const dg = dailyMap[id] || {}; return [id, nome, ...Array.from({ length: diasMes }, (_, i) => dg[i + 1] != null ? Number(dg[i + 1]) : '')] }
  const rows = [['vendor_id', 'nome', ...dayHdrs], ...(vends || []).map(v => makeRow(v.vendor_id, v.nome))]
  const ws = XLSX.utils.aoa_to_sheet(rows); ws['!freeze'] = { xSplit: 2, ySplit: 1, topLeftCell: 'C2', activePane: 'bottomLeft', state: 'frozen' }
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'MetasVendedoras')
  XLSX.writeFile(wb, `metas_vendedoras_${y}_${String(m).padStart(2, '0')}.xlsx`)
}

async function importVendedoresCSV(input, y, m) {
  const msgEl = document.getElementById('vend-metas-import-msg')
  if (msgEl) { msgEl.style.display = 'block'; msgEl.textContent = 'Processando...' }
  try {
    const file = input.files[0]; if (!file) return
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf, { type: 'array' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
    if (rows.length < 2) { throw new Error('Planilha vazia') }
    const header = rows[0].map(h => String(h).trim())
    const idIdx = header.indexOf('vendor_id')
    if (idIdx < 0) throw new Error('Coluna vendor_id não encontrada')
    const dayIdxs = []; for (let c = 0; c < header.length; c++) { const n = parseInt(header[c]); if (!isNaN(n) && n >= 1 && n <= 31) dayIdxs.push({ col: c, day: n }) }
    const records = []
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r]; const id = parseInt(row[idIdx]); if (!id || isNaN(id)) continue
      const goals = {}; let total = 0
      dayIdxs.forEach(({ col, day }) => { const v = parseFloat(row[col]) || 0; if (v > 0) { goals[String(day)] = v; total += v } })
      records.push({ vendor_id: id, year: y, month: m, meta_valor: total, daily_goals: goals })
    }
    for (const rec of records) {
      const { error } = await sbClient.from('bling_vendedor_metas').upsert(rec, { onConflict: 'vendor_id,year,month' })
      if (error) throw error
    }
    if (msgEl) { msgEl.style.color = 'var(--accent)'; msgEl.textContent = records.length + ' vendedora(s) importada(s) com sucesso.' }
    adminToast('Metas de vendedoras importadas')
  } catch (e) {
    if (msgEl) { msgEl.style.color = 'var(--red)'; msgEl.textContent = 'Erro: ' + e.message }
    adminToast('Erro ao importar: ' + e.message, false)
  }
  input.value = ''
}

function showMetasMsg(text, isErr, neutral) {
  const msg = document.getElementById('metas-import-msg')
  if (!msg) return
  msg.style.color = neutral ? 'var(--muted)' : isErr ? 'var(--red)' : 'var(--green)'
  msg.textContent = text
  msg.style.display = 'block'
}

/* ── SOLICITAÇÕES ADMIN (legacy L5078-5213, verbatim) ── */
async function loadAdminRequests() {
  const body = document.getElementById('admin-requests-body')
  body.innerHTML = '<div style="color:var(--muted);font-size:max(9px, calc(12px * var(--escala-texto, 1)));padding:16px 0">Carregando...</div>'
  const { data, error } = await sbClient.from('access_requests').select('*').order('created_at', { ascending: false })
  if (error || !data) { body.innerHTML = '<div style="color:var(--red);font-size:max(9px, calc(12px * var(--escala-texto, 1)))">Erro ao carregar solicitações.</div>'; return }
  if (!data.length) { body.innerHTML = '<div style="color:var(--muted);font-size:max(9px, calc(12px * var(--escala-texto, 1)));padding:16px 0">Nenhuma solicitação de acesso.</div>'; return }
  const statusLabel = { pending: 'Pendente', approved: 'Aprovado', denied: 'Negado' }
  const statusColor = { pending: 'var(--yellow)', approved: 'var(--green)', denied: 'var(--red)' }
  const wrap = document.createElement('div'); wrap.className = 'sg'
  data.forEach(r => {
    const row = document.createElement('div'); row.className = 'sr'; row.style.cssText = 'justify-content:space-between;flex-wrap:wrap;gap:8px'; row.id = 'req-row-' + r.id
    const main = document.createElement('div'); main.className = 'sr-main'
    const lbl = document.createElement('div'); lbl.className = 'sr-label'
    lbl.textContent = r.name || ''
    const muted = document.createElement('span'); muted.style.cssText = 'color:var(--muted);font-weight:400'; muted.textContent = ' — ' + (r.email || '')
    lbl.appendChild(muted)
    const sub = document.createElement('div'); sub.className = 'sr-sub'; sub.textContent = (r.message || 'Sem mensagem') + ' · ' + new Date(r.created_at).toLocaleDateString('pt-BR')
    main.appendChild(lbl); main.appendChild(sub)
    const ctrl = document.createElement('div'); ctrl.style.cssText = 'display:flex;align-items:center;gap:8px;flex-shrink:0'
    const badge = document.createElement('span'); badge.style.cssText = `font-size:max(9px, calc(10px * var(--escala-texto, 1)));font-weight:600;color:${statusColor[r.status] || 'var(--muted)'};letter-spacing:1px;text-transform:uppercase`; badge.textContent = statusLabel[r.status] || r.status
    ctrl.appendChild(badge)
    if (r.status === 'pending') {
      const apv = document.createElement('button'); apv.className = 'admin-btn-sm'; apv.style.cssText = 'background:var(--green);color:var(--sobre-cor)'; apv.textContent = 'Aprovar'; apv.addEventListener('click', () => handleRequest(r.id, 'approved'))
      const den = document.createElement('button'); den.className = 'admin-btn-sm'; den.style.cssText = 'background:var(--red);color:var(--sobre-cor)'; den.textContent = 'Negar'; den.addEventListener('click', () => handleRequest(r.id, 'denied'))
      ctrl.appendChild(apv); ctrl.appendChild(den)
    }
    row.appendChild(main); row.appendChild(ctrl); wrap.appendChild(row)
  })
  body.innerHTML = ''; body.appendChild(wrap)
}
// SENSITIVE MUTATION — aprova/nega solicitação de acesso real. Sem confirm()
// no legado; nenhum foi adicionado aqui.
async function handleRequest(id, status) {
  await sbClient.from('access_requests').update({ status }).eq('id', id)
  loadAdminRequests()
}

/* ── Fechar (voltar para a Central) — adapta closeAdmin do legado (legacy
   L4389: display:none + showHome()) para navegação por rota ── */
function closeAdmin() {
  router.push({ name: 'inicio' })
}

onMounted(() => {
  // Fase 1 permissões: só SUPER-ADMIN acessa a Administração (fim do "admin total").
  if (!estado.is_superadmin) {
    adminToast('Sem acesso', false)
    router.push({ name: 'inicio' })
    return
  }
  loadAdminSection('users')
})
// Nenhum timer/listener de documento é criado pelo módulo Admin em si —
// updateSaudeBadge/loadAdminSaude/loadAdminSection rodam uma vez por
// navegação (não em setInterval), e o único document-level listener do
// legado relacionado a este módulo (fechar o menu do usuário global ao
// clicar fora, legacy L5470) pertence ao "botão global do usuário", uma
// feature que ainda não foi portada — não faz parte deste componente. Por
// isso onUnmounted fica vazio (nada para limpar).
onUnmounted(() => {})

// Exposição em window: todas as funções chamadas por onclick="..."/
// onchange="..." literais no <template> acima e dentro das strings de
// innerHTML geradas por loadAdminMetas (loadAdminSection, adminInviteUser,
// adminSaveSetting, adminShowRefetchInfo, adminShowColetorInfo,
// downloadMetasTemplate, importMetasCSV, openPermModal*, closePermModal,
// savePermissions, handleRequest*). (*openPermModal e handleRequest são hoje
// disparados via addEventListener dentro de loadAdminUsers/loadAdminRequests
// — não por atributo onclick literal — mas ficam expostos também, sem custo,
// por robustez.) closeAdmin NÃO entra aqui: é o botão "Voltar" e virou
// binding Vue (@click) direto no <template>.
Object.assign(window, {
  loadAdminSection,
  adminInviteUser,
  adminShowRefetchInfo,
  adminShowColetorInfo,
  downloadMetasTemplate,
  importMetasCSV,
  openPermModal,
  closePermModal,
  savePermissions,
  handleRequest,
})
</script>

<style scoped>
/* ── CABEÇALHO DE GRUPO NOS TIMES (Peça 4, 20/08/2026) ─────────────────────
   Só aparece quando algum time tem grupo; sem configuração, a tela fica igual. */
/* O CARD PAI (27/08/2026). O grupo era um TÍTULO solto acima dos cards de loja;
   virou MOLDURA com as lojas dentro. Com título, as lojas do Varejo e as do
   Atacado ficavam na mesma coluna e nada mostrava onde um grupo acabava — a
   separação existia no texto, não no desenho. Só token, como manda o padrão. */
.tela-admin :deep(.adm-pai){border:1px solid var(--border);border-radius:var(--radius-lg);padding:var(--sp-3);margin:var(--sp-4) 0;background:var(--surface2);}
/* "Sem grupo" NÃO é um grupo: é a ausência de um. Tracejado e sem fundo para
   ele não competir de igual para igual com os grupos de verdade. */
.tela-admin :deep(.adm-pai-sem){background:transparent;border-style:dashed;}
.tela-admin :deep(.adm-pai-topo){display:flex;align-items:baseline;justify-content:space-between;gap:var(--sp-2);flex-wrap:wrap;margin-bottom:var(--sp-2);}
.tela-admin :deep(.adm-pai-nome){font-family:var(--fonte-principal);font-size:max(9px, calc(12px * var(--escala-texto, 1)));font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:var(--text);overflow-wrap:anywhere;}
.tela-admin :deep(.adm-pai-conta){font-family:var(--fonte-principal);font-size:max(9px, calc(11px * var(--escala-texto, 1)));color:var(--muted);}
.tela-admin :deep(.adm-pai-nota){font-family:var(--fonte-principal);font-size:max(9px, calc(11.5px * var(--escala-texto, 1)));color:var(--muted);margin-bottom:var(--sp-2);}
/* A SUPERVISORA DENTRO DO CARD PAI (27/08/2026). O cartão dela é o MESMO da
   lista de baixo; o que existe aqui é só a moldura em volta e o botão de tirar. */
.tela-admin :deep(.adm-pai-rotulo){font-family:var(--fonte-principal);font-size:max(9px, calc(10.5px * var(--escala-texto, 1)));font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--muted);margin:var(--sp-2) 0 var(--sp-1);}
.tela-admin :deep(.adm-pai-vazio){font-family:var(--fonte-principal);font-size:max(9px, calc(11.5px * var(--escala-texto, 1)));color:var(--muted);padding:var(--sp-1) 0;}
.tela-admin :deep(.adm-pai-linha){display:flex;align-items:flex-start;gap:var(--sp-2);flex-wrap:wrap;}
/* O cartão da pessoa cresce e o botão fica do tamanho dele: a 375px o botão cai
   para a linha de baixo em vez de espremer o nome até cortar. */
.tela-admin :deep(.adm-pai-linha > :first-child){flex:1 1 240px;min-width:0;}
.tela-admin :deep(.adm-pai-tirar){flex:0 0 auto;}
.tela-admin :deep(.adm-pai-por){display:flex;gap:var(--sp-2);flex-wrap:wrap;align-items:center;margin-top:var(--sp-2);}
.tela-admin :deep(.adm-pai-sel){flex:1 1 240px;min-width:0;min-height:40px;box-sizing:border-box;font-family:var(--fonte-principal);font-size:max(16px, calc(16px * var(--escala-texto, 1)));border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface2);color:var(--text);padding:0 var(--sp-2);}
.tela-admin :deep(.adm-pai-aviso){font-family:var(--fonte-principal);font-size:max(9px, calc(11px * var(--escala-texto, 1)));color:var(--muted);margin-top:var(--sp-1);}
.tela-admin :deep(.adm-pai-aviso:empty){display:none;}
.tela-admin :deep(.adm-pai-erro){color:var(--red);}
/* CELULAR: o aninhamento não pode empurrar a largura. No desktop o pai recua o
   filho; a 375px ele encosta na borda — os cards de loja já sabem encolher, e é
   a moldura NOVA que precisa ceder, não eles. */
@media (max-width:640px){
  .tela-admin :deep(.adm-pai){padding:var(--sp-2) 0;border-left:0;border-right:0;border-radius:0;}
}
/* ── CANAIS DE VENDA (20/08/2026) ──────────────────────────────────────────
   Só token: espaçamento da escala --sp-*, raio --radius-*, cor por token. */
.tela-admin :deep(.adm-canais-topo){display:flex;align-items:center;gap:var(--sp-2);flex-wrap:wrap;margin-bottom:var(--sp-2);font-family:var(--fonte-principal);font-size:max(9px, calc(12px * var(--escala-texto, 1)));color:var(--muted);}
.tela-admin :deep(.adm-canais-faltam){color:var(--red);font-weight:600;}
.tela-admin :deep(.adm-canais-ok){color:var(--green);font-weight:600;}
.tela-admin :deep(.adm-canais-grupo){font-family:var(--fonte-principal);font-size:max(9px, calc(10px * var(--escala-texto, 1)));font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--muted);margin:var(--sp-4) 0 var(--sp-2);}
.tela-admin :deep(.adm-canal-linha){display:flex;align-items:center;gap:var(--sp-3);flex-wrap:wrap;padding:var(--sp-2) 0;border-bottom:1px solid var(--border);}
.tela-admin :deep(.adm-canal-nome){flex:1 1 220px;min-width:0;display:flex;flex-direction:column;gap:2px;font-family:var(--fonte-principal);font-size:max(9px, calc(13px * var(--escala-texto, 1)));color:var(--text);overflow-wrap:anywhere;}
.tela-admin :deep(.adm-canal-time){font-size:max(9px, calc(11px * var(--escala-texto, 1)));color:var(--muted);}
.tela-admin :deep(.adm-canal-sem){font-style:italic;}
/* min-height 40px e fonte 16px no select nao sao estetica: e o alvo do dedo e o
   zoom que o iOS da quando a fonte do campo e menor que 16px. */
/* O GRUPO COMO CARTÃO (27/08/2026). O seletor por canal (`.adm-canal-sel`) saiu
   junto com a ideia de escolher o grupo catorze vezes; o que sobrou aqui é o
   cartão do grupo e o painel de marcar canais dentro dele. Só token — nenhuma
   cor, espaço ou raio literal, como manda o padrão da Central. */
.tela-admin :deep(.adm-grupo-card){border:1px solid var(--border);border-radius:var(--radius-lg);padding:var(--sp-3);margin:var(--sp-3) 0;background:var(--surface2);}
.tela-admin :deep(.adm-grupo-topo){display:flex;align-items:center;gap:var(--sp-2);flex-wrap:wrap;}
.tela-admin :deep(.adm-grupo-nome){flex:1 1 auto;min-width:0;font-family:var(--fonte-principal);font-size:max(9px, calc(13px * var(--escala-texto, 1)));font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:var(--text);overflow-wrap:anywhere;}
.tela-admin :deep(.adm-grupo-conta){font-family:var(--fonte-principal);font-size:max(9px, calc(11px * var(--escala-texto, 1)));color:var(--muted);}
/* No celular os botões passam a ocupar a linha inteira: a 375px, três botões
   lado a lado com o nome do grupo espremiam o nome até cortar. */
.tela-admin :deep(.adm-grupo-acoes){display:flex;gap:var(--sp-2);flex-wrap:wrap;}
.tela-admin :deep(.adm-grupo-aviso){font-family:var(--fonte-principal);font-size:max(9px, calc(11px * var(--escala-texto, 1)));color:var(--muted);}
.tela-admin :deep(.adm-grupo-aviso:empty){display:none;}
.tela-admin :deep(.adm-grupo-erro){color:var(--red);}
.tela-admin :deep(.adm-grupo-vazio){font-family:var(--fonte-principal);font-size:max(9px, calc(11.5px * var(--escala-texto, 1)));color:var(--muted);padding:var(--sp-2) 0;}
.tela-admin :deep(.adm-grupo-painel){margin-top:var(--sp-2);padding-top:var(--sp-2);border-top:1px solid var(--border);}
.tela-admin :deep(.adm-grupo-painel-tit){font-family:var(--fonte-principal);font-size:max(9px, calc(10.5px * var(--escala-texto, 1)));font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--muted);margin-bottom:var(--sp-2);}
/* Alvo de 40px na linha inteira: a caixinha sozinha tem 16px e o dedo erra. */
.tela-admin :deep(.adm-grupo-opcao){display:flex;align-items:center;gap:var(--sp-2);min-height:40px;cursor:pointer;font-family:var(--fonte-principal);font-size:max(9px, calc(13px * var(--escala-texto, 1)));color:var(--text);}
.tela-admin :deep(.adm-grupo-opcao input){width:18px;height:18px;flex:0 0 auto;accent-color:var(--accent);}
.tela-admin :deep(.adm-grupo-opcao span){min-width:0;display:flex;flex-direction:column;gap:2px;overflow-wrap:anywhere;}
.tela-admin :deep(.adm-grupo-hoje){font-style:italic;font-size:max(9px, calc(11px * var(--escala-texto, 1)));color:var(--muted);}
.tela-admin :deep(.adm-grupo-perigo){margin-top:var(--sp-3);padding-top:var(--sp-2);border-top:1px solid var(--border);}
/* Porte das regras admin- e #admin- (Módulo Admin, legacy/index.html
   L505-554 + L628-647 + L1397-1400) que #admin-screen usa de fato, MOVIDAS
   para cá (removidas do global — CSS PEEL RULE: só o que é literalmente
   prefixado admin- ou #admin- sai do global; ver relatório para a lista
   completa). A tela Redes Sociais tem seu PRÓPRIO painel embutido usando
   alguns nomes parecidos (admin-panel id, admin-title, admin-grid,
   admin-select, admin-action-btn, admin-msg) — já com cópia scoped própria,
   não afetada por esta remoção; este componente não usa esses seletores
   (são de outro widget) e por isso não os duplica aqui.
   Além disso, ficam aqui (DUPLICADOS, mas MANTIDOS no global também — não
   têm o prefixo admin-, então a regra de remoção não se aplica): .sr/.sg*
   .av-edit-btn/.av-img e o modal de permissões .perm-*. */
/* Fundo TRANSPARENTE: o #bg-shapes (degradê + ícones) fica fixo atrás de tudo
   pra aparecer, e o body já pinta a cor base nos DOIS temas. Pintar cor sólida
   aqui tapava a decoração e ainda deixava uma faixa visível onde a tela
   terminava. */
.tela-admin{min-height:100vh;display:flex;flex-direction:column;background:transparent;}
.tela-admin :deep(.admin-topbar){display:flex;align-items:center;justify-content:space-between;padding:13px 24px;border-bottom:1px solid var(--border);background:var(--surface);position:sticky;top:0;z-index:10;}
.tela-admin :deep(.admin-topbar-back){display:flex;align-items:center;gap:6px;font-family:var(--fonte-principal);font-size:max(9px, calc(13px * var(--escala-texto, 1)));color:var(--accent);cursor:pointer;background:none;border:none;padding:0;letter-spacing:.2px;}
.tela-admin :deep(.admin-topbar-title){font-family:var(--fonte-principal);font-size:max(9px, calc(15px * var(--escala-texto, 1)));font-weight:500;letter-spacing:2.5px;text-transform:uppercase;color:var(--text);}
.tela-admin :deep(.admin-layout){display:grid;grid-template-columns:210px 1fr;min-height:calc(100vh - 50px);}
.tela-admin :deep(.admin-sidebar){border-right:1px solid var(--border);padding:12px 8px;background:var(--surface2);overflow-y:auto;}
.tela-admin :deep(.admin-nav-group-label){font-family:var(--fonte-principal);font-size:max(9px, calc(9px * var(--escala-texto, 1)));letter-spacing:2px;text-transform:uppercase;color:var(--muted);padding:14px 12px 4px;margin-top:4px;}
.tela-admin :deep(.admin-nav-group-label:first-child){margin-top:0;}
.tela-admin :deep(.admin-nav-item){display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:var(--radius-md);cursor:pointer;transition:all .15s;font-family:var(--fonte-principal);font-size:max(9px, calc(13px * var(--escala-texto, 1)));color:var(--text);margin-bottom:1px;user-select:none;}
.tela-admin :deep(.admin-nav-item:hover){background:var(--surface);}
.tela-admin :deep(.admin-nav-item.active){background:var(--accent-light);color:var(--accent-forte);}
.tela-admin :deep(.admin-nav-item svg){flex-shrink:0;opacity:.6;}
.tela-admin :deep(.admin-nav-item.active svg){opacity:1;}
.tela-admin :deep(.admin-content){padding:36px 44px;overflow-y:auto;max-height:calc(100vh - 50px);}
.tela-admin :deep(.admin-section){display:none;}
.tela-admin :deep(.admin-section.active){display:block;}
.tela-admin :deep(.admin-section-title){font-family:var(--fonte-principal);font-size:max(16px, calc(22px * var(--escala-texto, 1)));font-weight:500;letter-spacing:1.5px;text-transform:uppercase;color:var(--text);margin-bottom:3px;}
.tela-admin :deep(.admin-section-sub){font-family:var(--fonte-principal);font-size:max(9px, calc(12px * var(--escala-texto, 1)));color:var(--muted);margin-bottom:28px;}
/* Faixa de aviso da Saúde dos dados, montada em updateSaudeBadge() (Task 5) —
   substitui a bolinha vermelha que morava no item da barra que não existe mais. */
/* Mesma história da `.grupo-sem`: era âmbar fixo e virava uma barra branca no
   tema escuro.
   O ÂMBAR FICA NA BORDA E NO FUNDO, ONDE ELE É SINAL; O TEXTO USA `--text`.
   Medido: o `--orange` do tema claro (var(--orange)) sobre esse fundo dá 4,14 de
   contraste — abaixo do mínimo de 4,5 para texto de 12px, e nenhuma proporção
   da mistura conserta (a 4% ainda dá 4,48). Com `--text` são 15,2 no claro e
   14,0 no escuro. Aviso que não se lê não avisa. */
.tela-admin :deep(.saude-faixa){background:color-mix(in srgb, var(--orange) 10%, var(--surface));border:1px solid color-mix(in srgb, var(--orange) 38%, var(--surface));color:var(--text);border-radius:10px;padding:10px 12px;font-size:max(9px, calc(12px * var(--escala-texto, 1)));margin-bottom:14px;cursor:pointer;}
.tela-admin :deep(.admin-stats){display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px;margin-bottom:24px;}
.tela-admin :deep(.admin-stat){background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);padding:16px;text-align:center;}
.tela-admin :deep(.admin-stat-val){font-family:var(--fonte-dados);font-size:max(16px, calc(30px * var(--escala-texto, 1)));font-weight:500;color:var(--accent);}
.tela-admin :deep(.admin-stat-lbl){font-family:var(--fonte-principal);font-size:max(9px, calc(9px * var(--escala-texto, 1)));color:var(--muted);letter-spacing:1.5px;text-transform:uppercase;margin-top:3px;}
@media(max-width:768px){
  .tela-admin :deep(.admin-layout){grid-template-columns:1fr;}
  .tela-admin :deep(.admin-sidebar){display:flex;overflow-x:auto;border-right:none;border-bottom:1px solid var(--border);padding:8px;gap:4px;}
  .tela-admin :deep(.admin-nav-group-label){display:none;}
  /* O CELULAR ROLA A PÁGINA INTEIRA, e o conteúdo não tem teto de altura.
   *
   * O DEFEITO QUE ISTO CONSERTA, relatado com foto pelo dono: a lista de
   * usuários SUMIA e sobrava uma faixa preta ocupando o resto da tela — o
   * botão "Puxar das vendas" ficava cortado ao meio e nada abaixo dele
   * aparecia. Não dava pra criar login nem mexer em permissão pelo celular,
   * que é justamente o que essa tela serve pra fazer.
   *
   * A CAUSA: no computador a barra lateral fica à ESQUERDA, então descontar
   * 50px (a barra de topo) da altura está certo. No celular ela vira uma
   * faixa horizontal EM CIMA do conteúdo — e essa faixa nunca entrou na
   * conta. O conteúdo ganhava altura de `100vh - 50px` num espaço que já
   * tinha perdido ~100px, e o que passava disso caía pra fora do recorte:
   * cortado, sem barra de rolagem visível, sem nada indicando que havia mais.
   *
   * No iPhone é pior ainda: `100vh` no Safari conta a barra de endereço
   * junto, então o teto é maior que a tela de verdade mesmo no computador
   * essa conta batendo.
   *
   * A correção não é acertar o número. É TIRAR o teto: no celular a página
   * já rola sozinha, e uma caixa que rola por dentro de uma página que rola
   * é sempre pior — o dedo nunca sabe qual das duas vai se mexer. */
  .tela-admin :deep(.admin-content){padding:20px 16px;max-height:none;overflow-y:visible;}
}
.tela-admin :deep(.admin-btn-sm){font-family:var(--fonte-principal);font-size:max(9px, calc(10px * var(--escala-texto, 1)));color:var(--sobre-cor);background:var(--accent);border:none;border-radius:3px;padding:5px 10px;cursor:pointer;letter-spacing:.6px;white-space:nowrap;transition:opacity .18s;text-transform:uppercase;}
.tela-admin :deep(.admin-btn-sm:hover){opacity:.85;}
/* .admin-input-row aparecia DUAS vezes no CSS global (grid, depois flex) — a
   segunda definição vencia a cascata; reproduzimos a mesma ordem aqui para o
   resultado visual ficar idêntico. */
.tela-admin :deep(.admin-input-row){display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:14px 16px;}
.tela-admin :deep(.admin-input-row){display:flex;gap:8px;margin-bottom:10px;}
.tela-admin :deep(.admin-input){flex:1;padding:9px 12px;background:var(--surface2);border:1.5px solid var(--border);border-radius:3px;color:var(--text);font-family:var(--fonte-principal);font-size:max(9px, calc(13px * var(--escala-texto, 1)));outline:none;transition:border-color .18s;}
.tela-admin :deep(.admin-input:focus){border-color:var(--accent);}
.tela-admin :deep(.admin-form-label){font-family:var(--fonte-principal);font-size:max(9px, calc(9px * var(--escala-texto, 1)));letter-spacing:1.5px;color:var(--muted);text-transform:uppercase;display:block;margin-bottom:6px;font-weight:600;}
/* O CAMPO USA --bg, NAO --surface2 NEM --surface.
   --surface2 deixava o campo CINZA no tema claro (a bronca do dono), e
   --surface deixava ele com a MESMA cor da caixa no tema escuro -- o campo
   sumia e sobrava so a borda. --bg e o fundo da pagina: mais claro que a caixa
   no tema claro, mais escuro no tema escuro. Nos dois o campo parece afundado,
   que e como campo se le. Isto vale pra ficha inteira: os tres selects de
   Lotacao nao tinham classe nenhuma e vinham com a aparencia crua do
   navegador, diferente do select de Acesso ao lado -- mesma ficha, dois
   padroes, e e disso que vem a cara de amador. */
.tela-admin :deep(.admin-form-input){width:100%;min-height:40px;padding:9px 12px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-md);color:var(--text);font-family:var(--fonte-principal);font-size:max(16px, calc(16px * var(--escala-texto, 1)));box-sizing:border-box;}
.tela-admin :deep(.admin-form-input:focus){border-color:var(--accent);}
.tela-admin :deep(.admin-form-input::placeholder){color:var(--muted);opacity:.7;}

/* ── Design system de linhas/grupos (.sr/.sg*, legacy L528-542) — genérico,
   usado por várias telas; cada uma traz sua própria cópia, MANTIDO no
   global também (não é .admin-*). ── */
.tela-admin :deep(.sg-label){font-family:var(--fonte-principal);font-size:max(9px, calc(9px * var(--escala-texto, 1)));letter-spacing:2px;text-transform:uppercase;color:var(--muted);padding:0 4px 6px;margin-top:18px;display:block;}
.tela-admin :deep(.sg){background:var(--surface);border:1px solid var(--border);border-radius:10px;overflow:hidden;margin-bottom:4px;}
.tela-admin :deep(.sr){display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid var(--border);transition:background .15s;}
.tela-admin :deep(.sr:last-child){border-bottom:none;}
.tela-admin :deep(.sr.clickable){cursor:pointer;}
.tela-admin :deep(.sr.clickable:hover){background:var(--surface2);}
.tela-admin :deep(.sr-icon){width:32px;height:32px;border-radius:7px;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
.tela-admin :deep(.sr-main){flex:1;}
.tela-admin :deep(.sr-label){font-family:var(--fonte-principal);font-size:max(9px, calc(13px * var(--escala-texto, 1)));color:var(--text);font-weight:500;}
.tela-admin :deep(.sr-sub){font-family:var(--fonte-principal);font-size:max(9px, calc(11px * var(--escala-texto, 1)));color:var(--muted);margin-top:1px;}
.tela-admin :deep(.sr-val){font-family:var(--fonte-principal);font-size:max(9px, calc(12px * var(--escala-texto, 1)));color:var(--muted);white-space:nowrap;}
.tela-admin :deep(.online-dot){width:8px;height:8px;border-radius:50%;background:var(--green);flex-shrink:0;}

/* ── Tabela de metas/saúde (.metas-tbl, legacy L1358-1361) — genérico,
   MANTIDO no global também. ── */
.tela-admin :deep(.metas-tbl){width:100%;border-collapse:collapse;}
.tela-admin :deep(.metas-tbl th){font-family:var(--fonte-principal);font-size:max(9px, calc(9px * var(--escala-texto, 1)));letter-spacing:1.5px;text-transform:uppercase;color:var(--muted);padding:7px 10px;text-align:left;border-bottom:1px solid var(--border);}
.tela-admin :deep(.metas-tbl td){font-family:var(--fonte-principal);font-size:max(9px, calc(12px * var(--escala-texto, 1)));padding:8px 10px;border-bottom:1px solid var(--border);}
.tela-admin :deep(.metas-tbl tr:last-child td){border-bottom:none;}

/* ── Avatar editável na lista de usuários (.av-*, legacy L1377-1380) —
   genérico, MANTIDO no global também. ── */
.tela-admin :deep(.av-wrap){position:relative;flex-shrink:0;}
.tela-admin :deep(.av-edit-btn){position:absolute;bottom:-2px;right:-2px;width:16px;height:16px;border-radius:50%;background:var(--accent);border:1.5px solid var(--bg);display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0;opacity:0;transition:opacity .15s;}
.tela-admin :deep(.av-wrap:hover .av-edit-btn){opacity:1;}
.tela-admin :deep(.av-img){width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;}

/* ── Modal de permissões (.perm-*, legacy L1402-1423) — não é .admin-*,
   MANTIDO no global também; duplicado aqui pois o modal foi trazido para
   dentro da raiz deste componente. ── */
/* 99995: ACIMA da ficha do usuário (99990), que é de onde este modal é
   aberto. Estava em 3000 e nascia ATRÁS dela — o dono relatou em 12/08:
   "na config de usuários, quando clico no botão permissões" abre outro modal
   atrás desse. Modal aberto DE DENTRO de outro tem de cobrir quem o abriu.
   A solução geral é o balcão em compartilhado/camada-de-modal.js, já usado
   na Frota; aqui o número fixo resolve porque esta tela tem só estes dois
   modais e a ordem entre eles é sempre a mesma. */
.tela-admin :deep(.perm-overlay){position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:99995;display:none;align-items:center;justify-content:center;backdrop-filter:blur(4px);touch-action:none;overscroll-behavior:contain;padding-top:max(16px,env(safe-area-inset-top));padding-bottom:max(16px,env(safe-area-inset-bottom));padding-left:max(12px,env(safe-area-inset-left));padding-right:max(12px,env(safe-area-inset-right));}
.tela-admin :deep(.perm-overlay.open){display:flex;}
/* 420 → 760: a matriz tem 5 colunas fixas de ação + a coluna de nomes; em 420
   ela nasceria rolando na horizontal já no desktop. 95vw segura o celular. */
.tela-admin :deep(.perm-modal){background:var(--surface);border-radius:8px;width:760px;max-width:95vw;max-height:85vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.25);overflow:hidden;}
.tela-admin :deep(.perm-modal-hdr){padding:20px 22px 14px;border-bottom:1px solid var(--border);}
.tela-admin :deep(.perm-modal-title){font-family:var(--fonte-principal);font-size:max(16px, calc(17px * var(--escala-texto, 1)));font-weight:500;letter-spacing:2px;text-transform:uppercase;color:var(--text);}
.tela-admin :deep(.perm-modal-user){font-family:var(--fonte-principal);font-size:max(9px, calc(12px * var(--escala-texto, 1)));color:var(--muted);margin-top:3px;}
.tela-admin :deep(.perm-modal-body){flex:1;overflow-y:auto;padding:14px 22px;overscroll-behavior:contain;touch-action:pan-y;}

/* ── AS TRÊS ABAS DENTRO DA PESSOA (D6) ──────────────────────────────────────
   A classe `.abas` é a compartilhada (mesma da Frota, do Patrimônio e dos
   Acessos), e o estado ativo dela é `on` — não `active`. Aqui só se ajusta o
   que muda por estar DENTRO de um modal: sem o recuo lateral próprio (o corpo
   do modal já tem o dele) e alinhada à esquerda, junto do texto que ela manda.
   Tudo em `:deep()` dentro de `.tela-admin`: regra global vazaria para as
   outras 24 telas que usam `.abas`. ── */
.tela-admin :deep(.perm-abas){justify-content:flex-start;padding-left:0;padding-right:0;margin-bottom:var(--sp-3);}
/* O ponto de atenção na aba: só existe quando há aviso (ver _mkBarraDeAbas). */
.tela-admin :deep(.perm-aba-ponto){display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--orange);margin-left:var(--sp-1);vertical-align:middle;flex-shrink:0;}
/* A faixa do aviso, no topo da aba. `--orange` é o token de aviso deste projeto
   (`--aviso` não existe, e variável inexistente cai no herdado, calada). */
.tela-admin :deep(.perm-faixa-aviso){border:1px solid color-mix(in srgb,var(--orange) 45%,transparent);background:color-mix(in srgb,var(--orange) 10%,var(--surface));color:color-mix(in srgb,var(--orange) 75%,var(--text));border-radius:var(--radius-md);padding:10px 12px;font-size:max(9px, calc(12.5px * var(--escala-texto, 1)));line-height:1.5;margin-bottom:var(--sp-3);overflow-wrap:anywhere;}
/* A linha do botão de dispensar, quando a faixa é do tipo que fica até alguém
   fechar. Só posiciona: o botão é `.btn` comum, sem `style` solto. */
.tela-admin :deep(.perm-faixa-aviso-acao){display:flex;justify-content:flex-end;margin-top:var(--sp-2);}
.tela-admin :deep(.perm-section){margin-bottom:2px;}
.tela-admin :deep(.perm-row){display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:5px;transition:background .12s;cursor:pointer;}
.tela-admin :deep(.perm-row:hover){background:var(--surface2);}
.tela-admin :deep(.perm-row.child){padding-left:36px;}
.tela-admin :deep(.perm-row-label){font-family:var(--fonte-principal);font-size:max(9px, calc(13px * var(--escala-texto, 1)));color:var(--text);flex:1;user-select:none;}
.tela-admin :deep(.perm-row.child .perm-row-label){font-size:max(9px, calc(12px * var(--escala-texto, 1)));color:var(--muted);}
.tela-admin :deep(.perm-section-sep){height:6px;}
.tela-admin :deep(.perm-toggle){position:relative;width:36px;height:20px;flex-shrink:0;}
.tela-admin :deep(.perm-toggle input){opacity:0;width:0;height:0;position:absolute;}
.tela-admin :deep(.perm-toggle-track){position:absolute;inset:0;background:var(--border);border-radius:10px;cursor:pointer;transition:background .2s;}
.tela-admin :deep(.perm-toggle input:checked ~ .perm-toggle-track){background:var(--accent);}
.tela-admin :deep(.perm-toggle-track::after){content:'';position:absolute;width:14px;height:14px;border-radius:50%;background:#fff;top:3px;left:3px;transition:transform .2s;box-shadow:0 1px 3px rgba(0,0,0,.2);}
.tela-admin :deep(.perm-toggle input:checked ~ .perm-toggle-track::after){transform:translateX(16px);}
.tela-admin :deep(.perm-modal-ftr){padding:14px 22px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:8px;}

/* ── Matriz de permissões (recurso × ação), agrupada em cards por ferramenta.
   TODAS as classes daqui usam o prefixo `perm-` e são NOVAS (não existem no
   estilos-globais.css): o projeto já quebrou uma tela reusando um nome global
   (`home-card` → `fab-card`), então nada de nome genérico tipo .card/.grade. ── */
.tela-admin :deep(.perm-matriz-topo){display:flex;align-items:center;justify-content:space-between;gap:10px;margin:2px 0 8px;}

.tela-admin :deep(.perm-marcar-tudo){display:flex;align-items:center;gap:5px;cursor:pointer;font-family:var(--fonte-principal);font-size:max(9px, calc(11px * var(--escala-texto, 1)));font-weight:600;color:var(--muted);user-select:none;flex-shrink:0;white-space:nowrap;}
.tela-admin :deep(.perm-marcar-tudo:hover){color:var(--text);}
.tela-admin :deep(.perm-marcar-tudo input){cursor:pointer;margin:0;}

.tela-admin :deep(.perm-card){border:1px solid var(--border);border-radius:7px;background:var(--surface);overflow:hidden;margin-bottom:10px;}
.tela-admin :deep(.perm-card-hdr){display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--surface2);border-bottom:1px solid var(--border);}
.tela-admin :deep(.perm-card-titulo){font-family:var(--fonte-principal);font-size:max(9px, calc(12px * var(--escala-texto, 1)));font-weight:700;color:var(--text);flex:1;min-width:0;overflow-wrap:anywhere;}
.tela-admin :deep(.perm-card-contagem){font-family:var(--fonte-principal);font-size:max(9px, calc(10px * var(--escala-texto, 1)));color:var(--muted);flex-shrink:0;font-variant-numeric:tabular-nums;}
/* NOTIFICAÇÃO NÃO É COLUNA DA MATRIZ. A matriz é recurso × ação (ver, editar,
   criar...) e vale pra toda ferramenta; "quer receber aviso no celular" não é
   uma ação sobre um recurso, e como coluna deixaria a célula vazia em quase
   todas as linhas. Por isso é um card próprio, com o texto do que chega. */
.tela-admin :deep(.perm-notif-lista){display:flex;flex-direction:column;gap:2px;padding:4px 0;}
.tela-admin :deep(.perm-notif){display:flex;align-items:flex-start;gap:10px;padding:9px 12px;cursor:pointer;border-radius:8px;}
.tela-admin :deep(.perm-notif:hover){background:var(--surface2);}
.tela-admin :deep(.perm-notif input){margin-top:2px;flex-shrink:0;}
.tela-admin :deep(.perm-notif-txt){display:flex;flex-direction:column;gap:2px;}
.tela-admin :deep(.perm-notif-rot){font-family:var(--fonte-principal);font-size:max(9px, calc(12.5px * var(--escala-texto, 1)));font-weight:600;color:var(--text);}
/* A descrição existe porque "Saldo" sozinho não diz se avisa todo dia ou só
   quando acaba — quem liga precisa saber o que está ligando. */
.tela-admin :deep(.perm-notif-des){font-family:var(--fonte-principal);font-size:max(9px, calc(11px * var(--escala-texto, 1)));color:var(--muted);line-height:1.45;}
.tela-admin :deep(.perm-notif-nota){font-family:var(--fonte-principal);font-size:max(9px, calc(10.5px * var(--escala-texto, 1)));color:var(--muted);padding:2px 12px 8px;font-style:italic;}

/* A escada de níveis: uma linha por recurso, o nome ocupando a linha inteira
   (nunca corta) e os degraus quebrando linha por baixo — sem coluna fixa,
   porque não é mais matriz. Nome grande o bastante pra caber no dedo, no
   celular e no desktop igual. */
.tela-admin :deep(.perm-nivel){padding:10px 12px;border-bottom:1px solid var(--border);}
.tela-admin :deep(.perm-nivel-nome){font-size:max(9px, calc(12.5px * var(--escala-texto, 1)));font-weight:600;color:var(--text);margin-bottom:7px;}
.tela-admin :deep(.perm-nivel-botoes){display:flex;flex-wrap:wrap;gap:6px;}
.tela-admin :deep(.perm-degrau){border:1px solid var(--border);background:transparent;color:var(--muted);border-radius:99px;padding:7px 12px;font-size:max(9px, calc(11.5px * var(--escala-texto, 1)));min-height:32px;cursor:pointer;font-family:var(--fonte-principal);}
.tela-admin :deep(.perm-degrau.escolhido){background:var(--accent);border-color:var(--accent);color:var(--sobre-cor);font-weight:600;}
.tela-admin :deep(.perm-o-que-faz){font-size:max(9px, calc(12.5px * var(--escala-texto, 1)));line-height:1.5;color:var(--muted);margin:6px 0 2px;max-width:62ch;overflow-wrap:anywhere;}
.tela-admin :deep(.perm-selo-dinheiro){font-size:max(9px, calc(10.5px * var(--escala-texto, 1)));letter-spacing:.4px;color:var(--orange);border:1px solid var(--orange);border-radius:99px;padding:2px 8px;margin-left:8px;white-space:nowrap;}
.tela-admin :deep(.perm-dinheiro){border-left:2px solid var(--orange);padding-left:10px;}
/* Conjunto fora da escada: mostra o que está gravado sem aproximar de degrau
   nenhum — aproximar mudaria acesso que ninguém pediu. */
.tela-admin :deep(.perm-nivel-aviso){margin-top:7px;font-size:max(9px, calc(11px * var(--escala-texto, 1)));color:var(--orange,#d97706);}

/* Diretório de pessoas por marca/local/setor (Task 6): um cartão por gaveta,
   uma coluna, sem tabela — nome nunca corta (overflow-wrap, não ellipsis). */
.tela-admin :deep(.usr-grupo){border:1px solid var(--border);border-radius:12px;padding:10px 12px;margin-bottom:10px;}
/* O AVISO ÂMBAR TEM DE EXISTIR NOS DOIS TEMAS.
   Este bloco nasceu com `background:#fffbeb` fixo — âmbar claríssimo. No tema
   escuro isso virou um retângulo BRANCO ocupando a seção inteira, porque hoje
   o grupo "Sem marca" contém TODAS as pessoas. Cor fixa não sabe que existe
   tema escuro.
   A cor sai de `--orange`, que o tema já troca (claro var(--orange), escuro var(--orange)),
   misturada com a superfície do tema. Assim o aviso continua âmbar e legível
   nos dois, sem uma segunda regra para manter em sincronia. */
.tela-admin :deep(.usr-grupo.grupo-sem){
  background:color-mix(in srgb, var(--orange) 10%, var(--surface));
  border-color:color-mix(in srgb, var(--orange) 38%, var(--surface));
}
/* Rede de segurança: navegador sem `color-mix` ignora as duas linhas acima e o
   cartão fica com o fundo padrão do tema — discreto, mas nunca branco no
   escuro. O aviso continua legível pelo texto e pela borda. */
/* Correção 2: overflow-wrap também no cabeçalho do grupo — nenhum título
   pode cortar, nem o de gaveta (ex.: nome de setor comprido). */
.tela-admin :deep(.usr-grupo-cab){display:flex;justify-content:space-between;align-items:center;gap:8px;font-weight:700;font-size:max(9px, calc(12px * var(--escala-texto, 1)));letter-spacing:.5px;overflow-wrap:anywhere;}
/* Correção 1: a linha virou um cartão de DUAS fileiras — topo (avatar+nome+
   papel) e ações (embaixo, quebra livre). Antes `.usr-linha` era só a
   fileira do topo (display:flex direto); agora é a coluna que segura as
   duas, e `.usr-linha-topo` herdou o que era do `.usr-linha` antigo. */
.tela-admin :deep(.usr-linha){display:flex;flex-direction:column;gap:8px;padding:10px 0;border-top:1px solid var(--border);}
/* ── A faixa do TIME, colada embaixo do cartão da pessoa ──────────────────
   Só o que é do time e não existe no cartão: papel, estoque e tirar. Tudo
   numa linha que QUEBRA (flex-wrap) — no celular ela vira duas ou três, e
   nunca estoura a largura do card. Alvo de toque de 40px nos controles,
   igual ao resto da tela. */
.tela-admin :deep(.eq-faixa){display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;padding-top:8px;}
.tela-admin :deep(.eq-faixa-sel){padding:6px 9px;border-radius:7px;border:1px solid var(--border);background:var(--surface2);color:var(--text);font-family:var(--fonte-principal);font-size:max(9px, calc(11.5px * var(--escala-texto, 1)));max-width:100%;}
.tela-admin :deep(.eq-faixa-chk){display:flex;align-items:center;gap:5px;font-size:max(9px, calc(11.5px * var(--escala-texto, 1)));color:var(--muted);cursor:pointer;min-height:40px;}
.tela-admin :deep(.eq-faixa-txt){font-size:max(9px, calc(11.5px * var(--escala-texto, 1)));color:var(--muted);}
.tela-admin :deep(.eq-faixa-btn){font-size:max(9px, calc(11.5px * var(--escala-texto, 1)));}
.tela-admin :deep(.eq-por){display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:12px;padding-top:10px;border-top:1px dashed var(--border);}
/* O seletor de quem entra cresce, mas nunca empurra a linha: `min-width:0` é o
   que impede um nome comprido de esticar o flex além da tela no celular. */
.tela-admin :deep(.eq-por-quem){flex:1 1 190px;min-width:0;}
.tela-admin :deep(.eq-vazio){color:var(--muted);font-size:max(9px, calc(12px * var(--escala-texto, 1)));padding:4px 0 2px;}
/* A GRADE DO CARD (13/08/2026): quem é a pessoa à esquerda, o que ela pode à
   direita, contexto embaixo ocupando a largura toda. Grade e não flex porque a
   linha de contexto precisa atravessar as duas colunas. */
.tela-admin :deep(.usr-linha-topo){display:grid;grid-template-columns:minmax(0,1fr) minmax(180px,280px);gap:4px var(--sp-4);align-items:start;}
.tela-admin :deep(.usr-quem){display:flex;align-items:flex-start;gap:10px;min-width:0;}
.tela-admin :deep(.usr-linha-info){display:flex;flex-direction:column;gap:2px;min-width:0;flex:1;}
/* `max-width` na coluna da direita para o resumo longo ("Mexe em Frota,
   Patrimônio e Anúncios") não comer a largura do nome e do e-mail. Sem isto a
   coluna `auto` cresce até onde quiser e espreme a esquerda. */
/* QUEM MANDA NA LARGURA É A TRILHA DA GRADE, e não este elemento. Tentei
   primeiro com `min-width` percentual aqui e não funcionou, por um motivo
   que vale ficar escrito: porcentagem dentro de uma coluna `auto` se mede
   contra a PRÓPRIA coluna, que já tinha encolhido — a conta se mordia e o
   resumo descia letra a letra, com 68px de largura. Por isso a trilha é
   `minmax(180px,280px)` lá em cima, em pixel. */
.tela-admin :deep(.usr-direita){display:flex;flex-direction:column;align-items:flex-end;gap:4px;text-align:right;}
/* A linha de contexto: menor fonte da tela, separada por um filete. */
.tela-admin :deep(.usr-ctx){grid-column:1/-1;font-size:max(9px, calc(10.5px * var(--escala-texto, 1)));color:var(--muted);line-height:1.6;margin-top:6px;padding-top:6px;border-top:1px dashed var(--border);overflow-wrap:anywhere;}
.tela-admin :deep(.usr-nome-wrap){display:flex;align-items:center;flex-wrap:wrap;gap:6px;}
.tela-admin :deep(.usr-nome){font-weight:600;font-size:max(9px, calc(13px * var(--escala-texto, 1)));overflow-wrap:anywhere;}
.tela-admin :deep(.usr-sub){font-size:max(9px, calc(11px * var(--escala-texto, 1)));color:var(--muted);overflow-wrap:anywhere;}
/* O resumo de uma linha (D5): quem é essa pessoa aqui dentro, sem abrir a
   ficha. Mesmo tratamento discreto do subtítulo, com o selo de dinheiro
   herdado de .perm-selo-dinheiro (já usado dentro do modal de permissões). */
.tela-admin :deep(.usr-resumo){font-size:max(9px, calc(12px * var(--escala-texto, 1)));color:var(--muted);}
/* Correção 2: e-mail + "desde <data>" — terceira linha discreta, mesmo
   tratamento visual do subtítulo de lotação. E-mail comprido quebra, nunca
   corta (overflow-wrap, sem ellipsis). */
.tela-admin :deep(.usr-contato){font-size:max(9px, calc(12px * var(--escala-texto, 1)));color:var(--muted);overflow-wrap:anywhere;}
.tela-admin :deep(.usr-alerta){color:color-mix(in srgb,var(--orange) 75%,var(--text));}
.tela-admin :deep(.usr-badge){font-size:max(9px, calc(9px * var(--escala-texto, 1)));letter-spacing:1px;text-transform:uppercase;color:var(--accent-forte);background:var(--accent-light);padding:2px 6px;border-radius:3px;flex-shrink:0;}
.tela-admin :deep(.usr-badge-super){color:var(--sobre-cor);background:var(--roxo);}
.tela-admin :deep(.usr-papel){font-size:max(9px, calc(10px * var(--escala-texto, 1)));border:1px solid var(--border);color:var(--muted);border-radius:99px;padding:2px 8px;white-space:nowrap;flex-shrink:0;}
.tela-admin :deep(.usr-papel.papel-super),.tela-admin :deep(.usr-papel.papel-admin){background:var(--accent);border-color:var(--accent);color:var(--sobre-cor);}
/* Ações restauradas (Correção 1): permissões/papel/senha/desativar/excluir/
   avatar. `flex-wrap` deixa os botões quebrarem pra uma nova linha DENTRO do
   mesmo cartão quando não cabem ao lado — nunca estouram a largura no
   celular. min-height:40px é o alvo de toque mínimo pedido na correção
   (o `.sr-btn` global só tem padding:5px 12px, insuficiente sozinho). */
.tela-admin :deep(.usr-acoes){display:flex;flex-wrap:wrap;align-items:center;gap:8px;}
.tela-admin :deep(.usr-acoes select){min-height:40px;box-sizing:border-box;}
.tela-admin :deep(.usr-acao-select){max-width:130px;font-size:max(9px, calc(12px * var(--escala-texto, 1)));padding:6px 8px;}
.tela-admin :deep(.usr-gavetas){display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:14px 0 8px;}
.tela-admin :deep(.usr-gavetas-rot){font-size:max(9px, calc(11px * var(--escala-texto, 1)));color:var(--muted);}
.tela-admin :deep(.usr-preencher){font-size:max(9px, calc(11px * var(--escala-texto, 1)));color:color-mix(in srgb,var(--orange) 75%,var(--text));cursor:pointer;}
.tela-admin :deep(.usr-vazio){color:var(--muted);font-size:max(9px, calc(12px * var(--escala-texto, 1)));padding:14px 2px;}
/* OS FILTROS DE SITUAÇÃO (27/08/2026). Mesma linguagem visual do `.ptab` que a
   Central já usa para alternar — borda com fundo transparente quando desligado,
   cor de destaque quando ligado —, mas com os 40px de alvo que o padrão exige e
   que o `.ptab` (feito para tabinha de período) não tem. Só token. */
.tela-admin :deep(.usr-filtros){display:flex;gap:var(--sp-2);flex-wrap:wrap;margin:var(--sp-2) 0;}
.tela-admin :deep(.usr-filtro){display:inline-flex;align-items:center;gap:var(--sp-2);min-height:40px;padding:0 var(--sp-3);border-radius:var(--radius-md);border:1px solid var(--border);background:none;color:var(--text);cursor:pointer;font-family:var(--fonte-principal);font-size:max(9px, calc(13px * var(--escala-texto, 1)));font-weight:600;}
.tela-admin :deep(.usr-filtro:hover){background:var(--surface2);}
.tela-admin :deep(.usr-filtro-on){background:var(--accent);border-color:var(--accent);color:var(--sobre-cor);}
/* A contagem herda a cor do botão de propósito: pintada de `--muted`, ela
   sumiria contra o fundo de destaque quando o filtro está ligado. */
.tela-admin :deep(.usr-filtro-conta){font-weight:700;opacity:.75;}
.tela-admin :deep(.usr-filtro-limpar){font-weight:500;color:var(--muted);}
.tela-admin :deep(.usr-contagem){font-family:var(--fonte-principal);font-size:max(9px, calc(11.5px * var(--escala-texto, 1)));color:var(--muted);margin:var(--sp-1) 0 var(--sp-2);}

/* A ficha da pessoa (etapa 2). Uma coluna, cabe no celular, e as cores saem do
   tema — nada de cor fixa, que foi o que deixou a seção branca no escuro. */
/* `touch-action:none` no fundo: arrastar o dedo na área escura não faz nada.
   `overscroll-behavior:contain` na caixa: chegar ao fim da rolagem de dentro
   NÃO continua rolando a página atrás (é o "encadeamento de rolagem"). Os dois,
   mais a trava de `travar-rolagem.js`, é o que impede a tela de escorregar. */
.tela-admin :deep(.ficha-fundo){position:fixed;inset:0;z-index:99990;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:16px;touch-action:none;overscroll-behavior:contain;}
.tela-admin :deep(.ficha-caixa){background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:14px;width:100%;max-width:420px;max-height:88vh;overflow-y:auto;overscroll-behavior:contain;touch-action:pan-y;}
.tela-admin :deep(.ficha-cab){display:flex;justify-content:space-between;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid var(--border);position:sticky;top:0;background:var(--surface);}
.tela-admin :deep(.ficha-titulo){font-weight:700;font-size:max(9px, calc(14px * var(--escala-texto, 1)));overflow-wrap:anywhere;}
.tela-admin :deep(.ficha-x){border:none;background:transparent;color:var(--muted);font-size:max(16px, calc(18px * var(--escala-texto, 1)));cursor:pointer;min-width:40px;min-height:40px;flex-shrink:0;}
.tela-admin :deep(.ficha-corpo){padding:14px 16px;}
.tela-admin :deep(.ficha-sec){padding:12px 0;border-bottom:1px solid var(--border);}
.tela-admin :deep(.ficha-sec:last-child){border-bottom:none;}
.tela-admin :deep(.ficha-sec-tit){font-size:max(9px, calc(10px * var(--escala-texto, 1)));letter-spacing:1.5px;text-transform:uppercase;color:var(--muted);margin-bottom:8px;}
.tela-admin :deep(.ficha-txt){font-size:max(9px, calc(12.5px * var(--escala-texto, 1)));line-height:1.5;margin-bottom:10px;overflow-wrap:anywhere;}
.tela-admin :deep(.ficha-campo){display:flex;flex-direction:column;gap:4px;margin-bottom:10px;}
.tela-admin :deep(.ficha-campo label){font-size:max(9px, calc(11px * var(--escala-texto, 1)));color:var(--muted);}
/* Fonte 16px no select de propósito: abaixo disso o iOS dá zoom ao focar, e a
   tela salta na cara de quem está escolhendo. */
.tela-admin :deep(.ficha-campo select:disabled){opacity:.5;cursor:not-allowed;}
/* A busca não está no brief original — foi preciso desenhar o campo pra
   `_filtrar` ter onde ler o termo. `admin-form-input` já dá o visual padrão
   (width:100%); aqui só limita a largura no desktop. */
.tela-admin :deep(.usr-busca){max-width:280px;margin-bottom:10px;}

@media (max-width:640px){
  /* NO CELULAR A LINHA É COMPACTA. As quatro ações por pessoa (papel,
     permissões, desativar, excluir) quebravam em duas fileiras e faziam cada
     pessoa ocupar meia tela — quinze vezes, com "Excluir" em vermelho a um
     toque de distância em todas. Aqui elas somem da lista e vivem na ficha,
     que abre tocando no nome. No computador, onde sobra largura, continuam na
     linha. */
  .tela-admin :deep(.usr-linha > .usr-acoes){display:none;}

  /* MODAL DE CELULAR: LARGURA DA TELA COM MARGEM, E CENTRALIZADO.
     Eu tinha escrito `align-items:flex-start` aqui pra evitar "faixa escura
     embaixo" — e foi ISSO que criou o defeito: com a caixa presa no topo, TODO
     o espaço que sobra vira um bloco preto embaixo dela, e o modal fica grudado
     no alto da tela. O dono viu e chamou de amador, com razão.
     Modal se centraliza: o véu escuro se reparte em cima e embaixo, como no
     computador. `height:100dvh` também saiu — `inset:0` já cobre a tela, e a
     altura extra só reforçava o bloco.
     `dvh` e não `vh` na CAIXA continua valendo: no celular a barra de endereço
     aparece e some, e `vh` é calculado com ela escondida — a caixa passava do
     que dá pra ver e o fim ficava embaixo da barra do navegador. */
  .tela-admin :deep(.ficha-fundo){padding:12px;}
  .tela-admin :deep(.ficha-caixa){max-width:none;max-height:calc(100dvh - 24px);}
  /* NO CELULAR A GRADE VIRA UMA COLUNA. A direita deixa de ser coluna alinhada
     ao fim e vira uma fileira que quebra — a mesma informação, empilhada, sem
     espremer o nome contra a borda. */
  .tela-admin :deep(.usr-linha-topo){grid-template-columns:1fr;}
  .tela-admin :deep(.usr-direita){align-items:flex-start;text-align:left;flex-direction:row;flex-wrap:wrap;gap:4px 8px;margin-top:2px;}
  /* O BOTÃO DE TROCAR FOTO tem 22px de altura e o padrão pede 40 de ALVO. A
     área cresce só na VERTICAL, mantendo a largura do botão: o vizinho da
     direita é o nome, e o toque nele abre a ficha — um alvo que crescesse para
     o lado roubaria esse toque e abriria o seletor de foto no lugar.
     Conferido com `elementFromPoint` que o centro do nome continua caindo no
     nome. Sem `pointer-events:none`: o pseudo PRECISA receber o toque. */
  .tela-admin :deep(.av-edit-btn){position:relative;}
  .tela-admin :deep(.av-edit-btn)::after{content:'';position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);height:40px;}
  .tela-admin :deep(.perm-selo-dinheiro){margin-left:0;}
  /* A ficha é o caminho no celular, então o convite tem de estar visível. */
  .tela-admin :deep(.usr-linha-info::after){content:'tocar para abrir ›';display:block;margin-top:4px;font-size:max(9px, calc(10.5px * var(--escala-texto, 1)));color:var(--accent);}
  /* Topbar compacto no celular: menos padding, logo e e-mail do usuário somem
     (não são essenciais na barra) — sobra Voltar + título, ocupando menos altura. */
  .tela-admin :deep(.admin-topbar){padding:8px 14px;gap:10px;}
  .tela-admin :deep(.admin-topbar-title){font-size:max(9px, calc(12px * var(--escala-texto, 1)));letter-spacing:1.5px;}
  .tela-admin :deep(.admin-topbar .rbv-logo){display:none;}
  .tela-admin :deep(#admin-topbar-user){display:none;}
  /* O outro modal desta tela seguia `max-height:85vh` -- `vh` no celular e
     calculado com a barra de endereco ESCONDIDA, entao a caixa passava do que
     da pra ver e o fim ficava atras da barra do navegador. Mesma correcao da
     ficha: largura da tela com 12px de margem, altura em `dvh`. */
  .tela-admin :deep(.perm-modal){max-width:none;width:100%;max-height:calc(100dvh - 24px);}
  .tela-admin :deep(.perm-modal-body){padding:12px 14px;}
  .tela-admin :deep(.perm-card-hdr){padding:7px 8px;}

  /* Task 7 — Medir e consertar o celular. Tudo daqui pra baixo é o que a
     medição a 375px acusou (script no brief da tarefa): estouro=0 já fechava
     sozinho, sobrou alvo de toque <40px e fonte <16px em input/select
     (zoom automático do iOS ao focar). Nada de desktop foi tocado — os
     seletores abaixo só valem dentro deste @media. */

  /* 1) Campos de texto/seleção (.admin-form-input): 13px de fonte e ~37-39px
     de altura. O !important é porque alguns nascem com font-size/padding
     inline (desenhados em JS: o input de "trocar senha" por linha e o select
     de "duplicar permissões de outro usuário") — sem ele, a cascata perderia
     pro estilo inline e o celular continuaria dando zoom. */
  .tela-admin :deep(.admin-form-input){font-size:max(16px, calc(16px * var(--escala-texto, 1)))!important;min-height:40px!important;box-sizing:border-box;}
  /* .usr-acao-select (Viewer/Admin por pessoa) já tinha min-height:40px do
     `.usr-acoes select` (correção anterior) — faltava só a fonte. */
  .tela-admin :deep(.usr-acao-select){font-size:max(16px, calc(16px * var(--escala-texto, 1)));}

  /* 2) Botões padrão (.sr-btn): "Enviar convite"/"Criar com senha", rodapé
     do modal (Cancelar/Salvar), "Aplicar" (duplicar permissões) e o miniform
     de trocar senha por linha (Gerar/Salvar senha/Cancelar) tinham só
     padding:5-8px — na prática 25-31px de altura. */

  /* 3) Degraus (.perm-degrau): tanto o "Agrupar: Marca|Local|Setor" quanto os
     graus dentro do modal (Sem acesso/Só ver/Ver e mexer/Tudo) herdavam os
     32px do desktop. */
  .tela-admin :deep(.perm-degrau){min-height:40px;box-sizing:border-box;padding:9px 14px;}

  /* 4) Botões dos Times de venda ("Puxar das vendas", "+ Novo time",
     "Editar", "Quem trabalha aqui (N)") são HTML cru com style inline (sem
     classe própria) — os data-attributes que os identificam no JS servem de
     gancho aqui; nenhum deles define altura inline, então não precisa de
     !important. */
  .tela-admin :deep([data-vd-puxar]),
  .tela-admin :deep([data-eq-novo]),
  .tela-admin :deep([data-eq-editar]),
  .tela-admin :deep(.eq-faixa-btn),.tela-admin :deep(.eq-faixa-sel){min-height:40px;box-sizing:border-box;display:inline-flex;align-items:center;}

  /* 5) Checkboxes soltos (Super-admin, "Marcar tudo", "Tudo" de cada card,
     "Todos os perfis", cada conta em "Perfis de rede social") usam o <label>
     inteiro como alvo de toque — o quadradinho nativo sempre mede uns 13px
     (é o checkbox do sistema, não dá pra crescer sem reinventá-lo do zero) e
     por isso NÃO está na lista de seletores medidos pelo dono; o que importa
     de verdade é o label. .perm-notif não precisava (já tem 67px pela
     descrição de duas linhas) mas herdar o min-height não muda nada nele. */
  .tela-admin :deep(.perm-modal-body label){min-height:40px;box-sizing:border-box;}

  /* 6) .av-edit-btn ("trocar foto"): só aparecia no :hover do avatar — no
     toque isso nunca dispara, então ficava para sempre invisível E
     inalcançável (bug de sempre, não desta tarefa; aqui ele passa a
     aparecer). NÃO foi levado a 40px de propósito: o avatar em si tem 32px,
     e um selo de edição do mesmo tamanho (ou maior) cobriria a foto/inicial
     da pessoa por baixo — pior que hoje. É ação secundária e rara (trocar
     foto), então documentamos a exceção em vez de forçar uma tela pior só
     pra fechar o número. */
  .tela-admin :deep(.av-edit-btn){opacity:1;width:22px;height:22px;bottom:-4px;right:-4px;}
  .tela-admin :deep(.av-edit-btn svg){width:11px;height:11px;}
}
</style>
