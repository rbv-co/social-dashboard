<template>
  <!-- Porte fiel de .wrapper (dashboard central de Redes Sociais, legacy/index.html
       L2926-3283), VERBATIM, mesmo padrão de Gestão de Tráfego/Gestão à Vista/Análise
       de Campanhas: raiz vira .tela-redes-sociais (sem display:none — quem controla a
       visibilidade agora é o vue-router). Três elementos que no legado são <div>
       irmãos soltos no <body>, FORA de .wrapper (posicionados via position:fixed, então
       o lugar deles na árvore do DOM não muda o layout visual) foram colocados DENTRO
       da raiz deste componente — mesma técnica já usada nos modais da Gestão de
       Tráfego — para que o CSS :deep() (scoped) os alcance: #autocycle-progress
       (legacy L2925), #chart-tooltip (L2635-2649) e #campaign-modal-overlay
       (L11754-11769, o modal "Filtrar campanhas").
       Único onclick trocado por binding Vue: o botão "Central" (Voltar) —
       showHome() vira @click="fecharDashboard" (a função por trás dele agora limpa
       os timers e navega pelo router, em vez de fazer display:none + mostrar a Home
       do monólito). Os demais onclick="..." ficam como STRING literal (igual ao
       legado) — são atributos HTML nativos, avaliados no escopo global; por isso o
       cluster de funções que eles chamam é exposto em window mais abaixo. -->
  <div class="tela-redes-sociais">
    <div id="autocycle-progress"></div>
    <div class="wrapper">

      <!-- TOPBAR — sticky, primeira coisa visível -->
      <barra-de-topo voltar="Central" titulo="Análise de Redes Sociais" subtitulo="Inteligência RBV" @voltar="fecharDashboard">
    <!-- FAIXA DE CONTROLES DENTRO DA BARRA (2026-08-06, pedido do dono).
         Antes era irma da barra, numa faixa propria — e no computador isso
         gastava ~80px de altura a toa. Agora entra pelo encaixe de acoes, que
         ja resolve os dois tamanhos sozinho: fica na linha 1 quando cabe
         (computador) e desce em largura cheia quando nao cabe (celular). -->
    <template #acoes>

      <!-- FAIXA DE CONTROLES: periodo, datas e perfis. Tira larga que dentro da
           barra disputava espaco com o titulo. -->
      <div class="gv-controles">
        <div class="topbar-center">
          <div class="period-tabs" id="period-tabs"></div>
          <div class="custom-range-inline" id="custom-range-panel">
            <span class="custom-range-lbl">de</span>
            <input type="date" id="custom-start" class="custom-date-input" onchange="onCustomDateChange()" title="Data inicial — clique para abrir o calendário">
            <span class="custom-range-lbl">até</span>
            <input type="date" id="custom-end" class="custom-date-input" onchange="onCustomDateChange()" title="Data final — clique para abrir o calendário">
            <button class="custom-clear-btn" id="custom-clear-btn" onclick="clearCustomRange()" style="display:none" title="Limpar intervalo personalizado">✕</button>
          </div>
          <div class="ac-toggle on" id="ac-toggle-btn" onclick="toggleAutoCycle()" title="Rotação automática de perfis">
            <div class="ac-toggle-track on" id="ac-toggle-track"><div class="ac-toggle-thumb"></div></div>
            <span class="ac-toggle-lbl">AUTO</span>
          </div>
        </div>
        <!-- Saíram daqui, a pedido do dono: "Tempo Real", o relógio, a data,
             "ATUALIZADO HOJE" e "● ao vivo (Meta)". Eram cinco linhas de
             carimbo dizendo que o dado está fresco — e dado fresco é o
             esperado, não notícia.

             O que avisa de verdade CONTINUA: a faixa vermelha logo abaixo
             (#freshness-banner) aparece quando o dado NÃO é de hoje. Essa é a
             informação que muda o que a pessoa faz; o resto era ruído.

             O JS que escrevia nesses elementos já era todo protegido por
             `if (el)`, então nada quebra por eles não existirem mais. -->
    
      </div>
    </template>
    </barra-de-topo>

      <!-- GUARDA DE FRESCOR: avisa quando os dados não são de hoje (coletor parado) -->
      <div id="freshness-banner" style="display:none;align-items:center;gap:8px;padding:9px 16px;background:var(--red);color:var(--sobre-cor);font-family:var(--fonte-principal);font-size:max(9px, calc(12px * var(--escala-texto, 1)));font-weight:600;letter-spacing:.3px;"></div>

      <!-- HEADER — seleção de perfil (abaixo da topbar) -->
      <header>
        <div id="header-collapsible">
          <div class="profile-select" id="profile-select"></div>
        </div>
        <button id="header-toggle" onclick="toggleHeader()" title="Ocultar cabeçalho"><span class="ht-arrow">▲</span></button>
      </header>

      <!-- ADMIN PANEL -->
      <div id="admin-panel" style="display:none">
        <div class="admin-title">⚙️ <span>Gerenciar Usuários</span></div>
        <div class="admin-grid">
          <div>
            <div class="admin-section-title">Enviar convite</div>
            <div class="admin-input-row" style="display:flex;flex-direction:column;gap:12px;padding:14px 0;">
              <div>
                <label class="auth-label" for="invite-email">E-mail</label>
                <input type="email" id="invite-email" class="admin-input" placeholder="email@exemplo.com" style="width:100%;box-sizing:border-box;">
              </div>
              <button class="admin-action-btn" id="invite-btn" onclick="doInvite()" style="width:100%;padding:11px;">Enviar convite</button>
            </div>
            <div class="admin-msg" id="invite-msg"></div>
          </div>
          <div>
            <div class="admin-section-title">Usuários cadastrados</div>
            <div class="user-list" id="user-list"><div style="font-family:var(--fonte-principal);font-size:max(9px, calc(11px * var(--escala-texto, 1)));color:var(--muted)">Carregando...</div></div>
          </div>
        </div>
      </div>

      <div id="active-profile-bar">
        <div id="apb-ring-wrap"><img id="apb-img" alt=""></div>
        <div id="apb-dot"></div>
        <span id="apb-name">—</span>
      </div>

      <!-- ANÁLISE INTELIGENTE -->
      <div class="insight-card" id="insight-card">
        <div class="insight-header">
          <span class="insight-icon">◈</span>
          <span class="insight-title">Análise do período</span>
          <span class="insight-period" id="insight-period-label">—</span>
        </div>
        <div class="insight-list" id="insight-list">
          <div class="insight-item muted"><div class="insight-dot muted"></div><span>Carregando...</span></div>
        </div>
        <div class="overall-bar-row">
          <span class="overall-bar-lbl">Meta geral</span>
          <div class="overall-bar-track"><div class="overall-bar-fill" id="overall-bar-fill" style="width:0%"></div></div>
          <span class="overall-bar-pct" id="overall-bar-pct">—</span>
        </div>
      </div>

      <!-- 01 SEGUIDORES -->
      <div class="sec-header">
        <div class="section-label">01 · Seguidores</div>        <div class="sec-line"></div>
      </div>
      <div class="sec1-grid mb40">
        <div class="card" style="padding:0;overflow:hidden;">
          <!-- Hero: total de seguidores -->
          <div id="followers-hero" style="padding:22px 24px 18px;background:var(--accent-light);position:relative;">
            <div class="mc-lbl" style="letter-spacing:2.5px;margin-bottom:10px;">TOTAL DE SEGUIDORES</div>
            <div style="font-family:'Oswald',sans-serif;font-size:max(16px, calc(54px * var(--escala-texto, 1)));font-weight:500;line-height:1;color:var(--accent);letter-spacing:-1px;" id="total-followers">0</div>
          </div>
          <!-- Separador gradiente -->
          <div style="height:2px;background:linear-gradient(to right,var(--accent-mid),var(--border));"></div>
          <!-- Novos no período -->
          <div style="padding:16px 24px 20px;">
            <div class="mc-header" style="margin-bottom:6px;">
              <div class="mc-lbl">NOVOS NO PERÍODO <button onclick="openFollowersInfo()" title="Como esse número é contado?" style="display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;border-radius:50%;border:1px solid currentColor;background:transparent;color:inherit;font-size:max(9px, calc(10px * var(--escala-texto, 1)));font-weight:700;cursor:pointer;line-height:1;padding:0;vertical-align:middle;">?</button></div>
              <div class="mc-goal-area">
                <span class="mc-goal-lbl">META</span>
                <span class="mc-goal-val" id="goal-followers" contenteditable="true" spellcheck="false">200</span>
                <span class="mc-edit-hint">✏</span>
              </div>
            </div>
            <div class="nf-linhas">
              <div class="nf-linha"><span class="nf-lbl">Seguidores</span><span class="nf-val a-green" id="nf-gained">0</span></div>
              <div class="nf-linha"><span class="nf-lbl">Deixaram de seguir</span><span class="nf-val a-red" id="nf-lost">0</span></div>
              <div class="nf-linha"><span class="nf-lbl">Total</span><span class="nf-val nf-total a-blue" id="new-followers-val">0</span><span class="nf-provisorio" id="nf-provisorio" hidden>parcial</span></div>
            </div>
            <div class="mc-compare" id="cmp-followers"></div>
            <div id="previa-followers" style="display:none;margin-top:6px;"></div>
            <div class="mc-divider"></div>
            <div class="mc-progress-track"><div class="mc-progress-fill" id="prog-followers" style="width:0%"></div></div>
            <div class="mc-bottom">
              <span class="mc-pct" id="pct-followers">0%</span>
              <span class="mc-diff" id="diff-followers"></span>
            </div>
          </div>
        </div>
        <div class="card" style="display:flex;flex-direction:column;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
            <div style="font-family:'Oswald',sans-serif;font-weight:400;font-size:max(9px, calc(11px * var(--escala-texto, 1)));letter-spacing:1.5px;color:var(--muted)">NOVOS SEGUIDORES / DIA</div>
            <div class="chart-legend">
              <div class="legend-item"><div class="legend-dot" style="background:var(--green)"></div><span>Seguiram</span></div>
              <div class="legend-item"><div class="legend-dot" style="background:var(--red)"></div><span>Deixaram</span></div>
              <div class="legend-item"><span style="font-weight:700;color:var(--text)">n</span><span>= líquido</span></div>
            </div>
          </div>
          <!-- O GRÁFICO ROLA PARA O LADO QUANDO O PERÍODO NÃO CABE NA TELA.
               A 375px o gráfico tem 319px: com 30 dias sobram ~10px por dia, e
               "R$ 17,34" não cabe em 10px em fonte nenhuma. A régua está em
               largura-do-grafico.js — mínimo de 30px por dia. Enquanto os dias
               cabem nesse mínimo, nada disto entra em ação e o gráfico continua
               do tamanho do cartão, como sempre foi.

               São três camadas, e cada uma tem um motivo:
                 .grafico-que-rola  → NÃO rola; é ela que segura a faixa apagada
                                       da direita colada na borda visível (dentro
                                       do que rola, a faixa iria embora junto).
                 .rolagem-de-grafico → é o que rola, e só ela: a página não pode
                                       ganhar rolagem para o lado por causa disto.
                 .trilho-de-grafico  → é o que fica LARGO. O SVG e os rótulos são
                                       filhos dele, então a camada de números
                                       nasce da largura do desenho e não da
                                       largura visível — sem isso os números
                                       ficariam espremidos sobre um desenho largo. -->
          <div class="grafico-que-rola" id="grafico-de-seguidores">
          <div class="rolagem-de-grafico" id="rolagem-de-seguidores">
          <div class="trilho-de-grafico" id="trilho-de-seguidores">
          <div class="chart-svg-wrap">
            <svg id="followers-chart" viewBox="0 0 400 110" preserveAspectRatio="none">
              <defs>
                <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.25"/>
                  <stop offset="100%" stop-color="var(--accent)" stop-opacity="0"/>
                </linearGradient>
              </defs>
              <path id="chart-fill" fill="url(#chartGrad)"/>
              <line id="chart-zero" x1="0" y1="0" x2="400" y2="0" stroke="currentColor" stroke-width="0.6" opacity="0.25"/>
              <g id="chart-bars"></g>
              <polyline id="prev-line" fill="none" stroke="rgba(0,0,0,0.15)" stroke-width="1.5" stroke-dasharray="4,3" stroke-linecap="round"/>
              <polyline id="chart-line" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              <line id="chart-meta" x1="0" y1="0" x2="400" y2="0" display="none"/>
              <line id="crosshair" x1="0" y1="0" x2="0" y2="110" stroke="rgba(0,0,0,0.15)" stroke-width="1" display="none"/>
              <circle id="dot-curr" r="4" fill="var(--accent)" stroke="var(--surface)" stroke-width="2" display="none"/>
              <circle id="dot-prev" r="3.5" fill="rgba(0,0,0,0.2)" stroke="#f4f5fa" stroke-width="2" display="none"/>
              <rect id="chart-overlay" x="0" y="0" width="400" height="110" fill="transparent"/>
            </svg>
            <div id="chart-data-labels"></div>
          </div>
          <div class="x-labels" id="chart-xlabels"></div>
          </div><!-- /.trilho-de-grafico -->
          </div><!-- /.rolagem-de-grafico -->
          </div><!-- /.grafico-que-rola -->
          <!-- Aviso dos dias ESTIMADOS. Só aparece quando existe dia estimado; fica
               vazio (e sem ocupar espaço) no dia a dia normal. O texto técnico de
               dentro é só para super-admin — ver montarNotaDeEstimativa(). -->
          <div class="nota-estimativa" id="nota-estimativa" hidden></div>
        </div>
      </div>

      <!-- 02 META ADS -->
      <faixa-de-erro :erro="erroAds" @tentar-de-novo="refresh" />
      <div class="sec-header">
        <div class="section-label">02 · Meta Ads</div>        <div class="sec-line"></div>
      </div>
      <!-- AVISO DE CLASSIFICAÇÃO PROVISÓRIA: enquanto campaign_adsets está vazia
           pra este perfil, toda campanha cai pela regra do objetivo — e o
           objetivo mente (ex.: WhatsApp da Vessel contando como Seguidores).
           Mesmo estilo do #freshness-banner, de propósito: é o mesmo tipo de
           aviso ("o número que você está vendo pode não estar fechado"). -->
      <div id="balde-provisorio-banner" style="display:none;align-items:center;gap:8px;padding:9px 16px;background:var(--red);color:var(--sobre-cor);font-family:var(--fonte-principal);font-size:max(9px, calc(12px * var(--escala-texto, 1)));font-weight:600;letter-spacing:.3px;"></div>

      <!-- Recorte por TIPO de campanha. O balde recorta o tipo; o "⚙ Filtrar
           campanhas" logo abaixo recorta DENTRO dele — os dois se somam. -->
      <div class="balde-bar" id="balde-bar" role="tablist" aria-label="Tipo de campanha"></div>
      <div class="camp-filter-bar">
        <span class="camp-filter-lbl">Campanhas consideradas no cálculo:</span>
        <span class="camp-filter-info" id="camp-filter-info">Todas as campanhas</span>
        <button class="btn-campaign-filter" id="btn-campaign-filter" onclick="openCampaignModal()">⚙ Filtrar campanhas</button>
      </div>
      <div class="sec2-grid mb40">
        <div class="card">
          <div class="mc-header">
            <div class="mc-icon">💰</div>
            <div class="mc-goal-area">
              <span class="mc-goal-lbl">BUDGET</span>
              <span class="mc-goal-val" id="goal-spend" contenteditable="true" spellcheck="false">600</span>
              <span class="mc-edit-hint">✏</span>
            </div>
          </div>
          <div class="mc-lbl">INVESTIMENTO NO PERÍODO</div>
          <div class="mc-val a-purple" id="ads-spend-val">R$ 0</div>
          <div class="mc-compare" id="cmp-spend"></div>
          <div class="mc-divider"></div>
          <div class="mc-progress-track"><div class="mc-progress-fill" id="prog-spend" style="width:0%"></div></div>
          <div class="mc-bottom">
            <span class="mc-pct" id="pct-spend">0%</span>
            <span class="mc-diff" id="diff-spend"></span>
          </div>
          <div class="calc-badge">⚡ Menor gasto com mais resultado = ideal</div>
          <!-- Um bloco de gráfico por LUGAR da grade (ver SLOTS_DOS_CARTOES).
               NASCE FORA DA TELA: `.gmad-bloco` tem borda em cima e respiro
               próprio, então vazio e visível ele é um risco solto no pé do
               cartão — o que a pessoa veria entre o primeiro pintar e o fim da
               primeira leitura, e para sempre se a leitura falhar. Quem o traz
               de volta é desenharGraficosDosCartoes, ao ter o que desenhar. -->
          <div class="gmad-bloco" id="gmad-spend" style="display:none"></div>
        </div>
        <div class="card">
          <div class="mc-header">
            <div class="mc-icon">🎯</div>
            <div class="mc-goal-area">
              <span class="mc-goal-lbl">META MÁX</span>
              <span class="mc-goal-val" id="goal-cps" contenteditable="true" spellcheck="false">2.00</span>
              <span class="mc-edit-hint">✏</span>
            </div>
          </div>
          <div class="mc-lbl">CUSTO POR SEGUIDOR</div>
          <div class="mc-val a-blue" id="ads-cps-val">R$ 0</div>
          <div id="previa-cps" style="display:none;margin-top:5px;"></div>
          <div class="mc-compare" id="cmp-cps"></div>
          <div class="mc-divider"></div>
          <div class="mc-progress-track"><div class="mc-progress-fill" id="prog-cps" style="width:0%"></div></div>
          <div class="mc-bottom">
            <span class="mc-pct" id="pct-cps">0%</span>
            <span class="mc-diff" id="diff-cps"></span>
          </div>
          <div class="calc-badge">⚡ Menor é melhor · investimento ÷ novos seguidores</div>
          <div class="gmad-bloco" id="gmad-cps" style="display:none"></div>
        </div>
        <div class="card">
          <div class="mc-header">
            <div class="mc-icon">🤝</div>
            <div class="mc-goal-area">
              <span class="mc-goal-lbl">META MÁX</span>
              <span class="mc-goal-val" id="goal-cpi" contenteditable="true" spellcheck="false">0.15</span>
              <span class="mc-edit-hint">✏</span>
            </div>
          </div>
          <div class="mc-lbl">CUSTO POR INTERAÇÃO</div>
          <div class="mc-val a-purple" id="ads-cpi-val">R$ —</div>
          <div class="mc-compare" id="cmp-cpi"></div>
          <div class="mc-divider"></div>
          <div class="mc-progress-track"><div class="mc-progress-fill" id="prog-cpi" style="width:0%"></div></div>
          <div class="mc-bottom">
            <span class="mc-pct" id="pct-cpi">0%</span>
            <span class="mc-diff" id="diff-cpi"></span>
          </div>
          <div class="calc-badge">⚡ Menor é melhor · investimento ÷ interações do anúncio</div>
          <!-- O bloco do gráfico é do LUGAR, não do indicador: em Contatos aqui
               mora o custo por cadastro, em Site o custo por mil impressões. Ver
               SLOTS_DOS_CARTOES e desenharGraficosDosCartoes. -->
          <div class="gmad-bloco" id="gmad-cpi" style="display:none"></div>
        </div>
        <div class="card">
          <div class="mc-header">
            <div class="mc-icon">❤️</div>
            <div class="mc-goal-area">
              <span class="mc-goal-lbl">META MÁX</span>
              <span class="mc-goal-val" id="goal-cpl" contenteditable="true" spellcheck="false">0.20</span>
              <span class="mc-edit-hint">✏</span>
            </div>
          </div>
          <div class="mc-lbl">CUSTO POR CURTIDA</div>
          <div class="mc-val a-blue" id="ads-cpl-val">R$ —</div>
          <div class="mc-compare" id="cmp-cpl"></div>
          <div class="mc-divider"></div>
          <div class="mc-progress-track"><div class="mc-progress-fill" id="prog-cpl" style="width:0%"></div></div>
          <div class="mc-bottom">
            <span class="mc-pct" id="pct-cpl">0%</span>
            <span class="mc-diff" id="diff-cpl"></span>
          </div>
          <div class="calc-badge">⚡ Menor é melhor · investimento ÷ curtidas do anúncio</div>
          <div class="gmad-bloco" id="gmad-cpl" style="display:none"></div>
        </div>
      </div>

      <!-- 03 ENGAJAMENTO -->
      <div class="sec-header">
        <div class="section-label">03 · Engajamento</div>        <div class="sec-line"></div>
      </div>
      <div class="eng-tabs" id="eng-tabs">
        <button class="eng-tab active" data-tab="geral" onclick="setEngTab('geral')">Geral</button>
        <button class="eng-tab" data-tab="reel" onclick="setEngTab('reel')">Reels</button>
        <button class="eng-tab" data-tab="post" onclick="setEngTab('post')">Posts</button>
        <button class="eng-tab" data-tab="story" onclick="setEngTab('story')">Stories</button>
        <button class="eng-tab" data-tab="ad" onclick="setEngTab('ad')">Anúncios</button>
      </div>
      <div class="sec3-grid mb40">
        <div class="card" style="animation-delay:.05s">
          <div class="mc-header"><div class="mc-icon">❤️</div><div class="mc-goal-area"><span class="mc-goal-lbl">META</span><span class="mc-goal-val" id="goal-likes" contenteditable="true" spellcheck="false">1000</span><span class="mc-edit-hint">✏</span></div></div>
          <div class="mc-lbl">CURTIDAS</div>
          <div class="mc-val a-orange" id="eng-likes">0</div>
          <div class="mc-ad-sub" id="eng-likes-ad"></div>
          <div class="nf-linhas" id="likes-linhas" style="display:none">
            <div class="nf-linha"><span class="nf-lbl">Orgânico</span><span class="nf-val a-orange" id="likes-org">0</span></div>
            <div class="nf-linha"><span class="nf-lbl">Anúncios</span><span class="nf-val a-purple" id="likes-ad">0</span></div>
            <div class="mc-obs" style="margin-top:-1px">ⓘ Anúncios vem direto da API da Meta — sem relatório pra validar.</div>
            <div class="nf-linha"><span class="nf-lbl">Total</span><span class="nf-val nf-total" id="likes-total">0</span></div>
          </div>
          <div class="mc-obs" id="obs-likes-ad" style="display:none">ⓘ Vem direto da API da Meta — não há relatório do Meta pra validar esse número.</div>
          <div class="mc-compare" id="cmp-likes"></div>
          <div class="mc-divider"></div>
          <div class="mc-progress-track"><div class="mc-progress-fill" id="prog-likes" style="width:0%"></div></div>
          <div class="mc-bottom"><span class="mc-pct" id="pct-likes">0%</span><span class="mc-diff" id="diff-likes"></span></div>
        </div>
        <div class="card" style="animation-delay:.075s">
          <div class="mc-header"><div class="mc-icon">💬</div><div class="mc-goal-area"><span class="mc-goal-lbl">META</span><span class="mc-goal-val" id="goal-comments" contenteditable="true" spellcheck="false">120</span><span class="mc-edit-hint">✏</span></div></div>
          <div class="mc-lbl">COMENTÁRIOS</div>
          <div class="mc-val a-blue" id="eng-comments">0</div>
          <div class="mc-ad-sub" id="eng-comments-ad"></div>
          <div class="nf-linhas" id="comments-linhas" style="display:none">
            <div class="nf-linha"><span class="nf-lbl">Orgânico</span><span class="nf-val a-blue" id="comments-org">0</span></div>
            <div class="nf-linha"><span class="nf-lbl">Anúncios</span><span class="nf-val a-purple" id="comments-ad">0</span></div>
            <div class="nf-linha"><span class="nf-lbl">Total</span><span class="nf-val nf-total" id="comments-total">0</span></div>
          </div>
          <div class="mc-compare" id="cmp-comments"></div>
          <div class="mc-divider"></div>
          <div class="mc-progress-track"><div class="mc-progress-fill" id="prog-comments" style="width:0%"></div></div>
          <div class="mc-bottom"><span class="mc-pct" id="pct-comments">0%</span><span class="mc-diff" id="diff-comments"></span></div>
        </div>
        <div class="card" style="animation-delay:.10s">
          <div class="mc-header"><div class="mc-icon">🔖</div><div class="mc-goal-area"><span class="mc-goal-lbl">META</span><span class="mc-goal-val" id="goal-saves" contenteditable="true" spellcheck="false">250</span><span class="mc-edit-hint">✏</span></div></div>
          <div class="mc-lbl">SALVAMENTOS</div>
          <div class="mc-val a-pink" id="eng-saves">0</div>
          <div class="mc-ad-sub" id="eng-saves-ad"></div>
          <div class="nf-linhas" id="saves-linhas" style="display:none">
            <div class="nf-linha"><span class="nf-lbl">Orgânico</span><span class="nf-val a-pink" id="saves-org">0</span></div>
            <div class="nf-linha"><span class="nf-lbl">Anúncios</span><span class="nf-val a-purple" id="saves-ad">0</span></div>
            <div class="nf-linha"><span class="nf-lbl">Total</span><span class="nf-val nf-total" id="saves-total">0</span></div>
          </div>
          <div class="mc-compare" id="cmp-saves"></div>
          <div class="mc-divider"></div>
          <div class="mc-progress-track"><div class="mc-progress-fill" id="prog-saves" style="width:0%"></div></div>
          <div class="mc-bottom"><span class="mc-pct" id="pct-saves">0%</span><span class="mc-diff" id="diff-saves"></span></div>
        </div>
        <div class="card" style="animation-delay:.15s">
          <div class="mc-header"><div class="mc-icon">↗️</div><div class="mc-goal-area"><span class="mc-goal-lbl">META</span><span class="mc-goal-val" id="goal-shares" contenteditable="true" spellcheck="false">200</span><span class="mc-edit-hint">✏</span></div></div>
          <div class="mc-lbl">COMPARTILHAMENTOS</div>
          <div class="mc-val a-purple" id="eng-shares">0</div>
          <div class="mc-ad-sub" id="eng-shares-ad"></div>
          <div class="nf-linhas" id="shares-linhas" style="display:none">
            <div class="nf-linha"><span class="nf-lbl">Orgânico</span><span class="nf-val a-green" id="shares-org">0</span></div>
            <div class="nf-linha"><span class="nf-lbl">Anúncios</span><span class="nf-val a-purple" id="shares-ad">0</span></div>
            <div class="nf-linha"><span class="nf-lbl">Total</span><span class="nf-val nf-total" id="shares-total">0</span></div>
          </div>
          <div class="mc-compare" id="cmp-shares"></div>
          <div class="mc-divider"></div>
          <div class="mc-progress-track"><div class="mc-progress-fill" id="prog-shares" style="width:0%"></div></div>
          <div class="mc-bottom"><span class="mc-pct" id="pct-shares">0%</span><span class="mc-diff" id="diff-shares"></span></div>
        </div>
        <div class="card" id="card-replies" style="display:none;animation-delay:.2s">
          <div class="mc-header"><div class="mc-icon">💬</div><div class="mc-goal-area"><span class="mc-goal-lbl">META</span><span class="mc-goal-val" id="goal-replies" contenteditable="true" spellcheck="false">30</span><span class="mc-edit-hint">✏</span></div></div>
          <div class="mc-lbl">RESPOSTAS</div>
          <div class="mc-val a-green" id="eng-replies">0</div>
          <div class="mc-compare" id="cmp-replies"></div>
          <div class="mc-divider"></div>
          <div class="mc-progress-track"><div class="mc-progress-fill" id="prog-replies" style="width:0%"></div></div>
          <div class="mc-bottom"><span class="mc-pct" id="pct-replies">0%</span><span class="mc-diff" id="diff-replies"></span></div>
        </div>
        <div class="card"><div class="mc-header"><div class="mc-icon">👁</div><div class="mc-goal-area"><span class="mc-goal-lbl">META</span><span class="mc-goal-val" id="goal-reach" contenteditable="true" spellcheck="false">30000</span><span class="mc-edit-hint">✏</span></div></div><div class="mc-lbl">ALCANCE</div><div class="mc-val a-blue" id="eng-reach">0</div><div class="mc-compare" id="cmp-reach"></div><div class="mc-divider"></div><div class="mc-progress-track"><div class="mc-progress-fill" id="prog-reach" style="width:0%"></div></div><div class="mc-bottom"><span class="mc-pct" id="pct-reach">0%</span><span class="mc-diff" id="diff-reach"></span></div></div>
        <div class="card"><div class="mc-header"><div class="mc-icon">▶️</div><div class="mc-goal-area"><span class="mc-goal-lbl">META</span><span class="mc-goal-val" id="goal-views" contenteditable="true" spellcheck="false">50000</span><span class="mc-edit-hint">✏</span></div></div><div class="mc-lbl">VISUALIZAÇÕES</div><div class="mc-val a-orange" id="eng-views">0</div><div class="mc-compare" id="cmp-views"></div><div class="mc-divider"></div><div class="mc-progress-track"><div class="mc-progress-fill" id="prog-views" style="width:0%"></div></div><div class="mc-bottom"><span class="mc-pct" id="pct-views">0%</span><span class="mc-diff" id="diff-views"></span></div></div>
        <div class="card"><div class="mc-header"><div class="mc-icon">🤝</div><div class="mc-goal-area"><span class="mc-goal-lbl">META</span><span class="mc-goal-val" id="goal-interactions" contenteditable="true" spellcheck="false">3000</span><span class="mc-edit-hint">✏</span></div></div><div class="mc-lbl">INTERAÇÕES TOTAIS</div><div class="mc-val a-pink" id="eng-interactions">0</div><div class="mc-compare" id="cmp-interactions"></div><div class="mc-divider"></div><div class="mc-progress-track"><div class="mc-progress-fill" id="prog-interactions" style="width:0%"></div></div><div class="mc-bottom"><span class="mc-pct" id="pct-interactions">0%</span><span class="mc-diff" id="diff-interactions"></span></div></div>
        <div class="card"><div class="mc-header"><div class="mc-icon">👤</div><div class="mc-goal-area"><span class="mc-goal-lbl">META</span><span class="mc-goal-val" id="goal-profile-views" contenteditable="true" spellcheck="false">3000</span><span class="mc-edit-hint">✏</span></div></div><div class="mc-lbl">VISITAS AO PERFIL</div><div class="mc-val a-blue" id="eng-profile-views">0</div><div class="mc-compare" id="cmp-profile-views"></div><div class="mc-divider"></div><div class="mc-progress-track"><div class="mc-progress-fill" id="prog-profile-views" style="width:0%"></div></div><div class="mc-bottom"><span class="mc-pct" id="pct-profile-views">0%</span><span class="mc-diff" id="diff-profile-views"></span></div></div>
      </div>

      <!-- 04 CONTEÚDO -->
      <div class="sec-header">
        <div class="section-label">04 · Conteúdos criados/postados</div>        <div class="sec-line"></div>
      </div>
      <div class="sec4-grid">
        <div class="card" style="animation-delay:.05s">
          <div class="mc-header"><div class="mc-icon">⭕</div><div class="mc-goal-area"><span class="mc-goal-lbl">META</span><span class="mc-goal-val" id="goal-stories" contenteditable="true" spellcheck="false">28</span><span class="mc-edit-hint">✏</span></div></div>
          <div class="mc-lbl">STORIES</div>
          <div class="mc-val a-pink" id="cnt-stories">0</div>
          <div class="mc-compare" id="cmp-stories"></div>
          <div class="mc-divider"></div>
          <div class="mc-progress-track"><div class="mc-progress-fill" id="prog-stories" style="width:0%"></div></div>
          <div class="mc-bottom"><span class="mc-pct" id="pct-stories">0%</span><span class="mc-diff" id="diff-stories"></span></div>
        </div>
        <div class="card" style="animation-delay:.10s">
          <div class="mc-header"><div class="mc-icon">🖼️</div><div class="mc-goal-area"><span class="mc-goal-lbl">META</span><span class="mc-goal-val" id="goal-posts" contenteditable="true" spellcheck="false">6</span><span class="mc-edit-hint">✏</span></div></div>
          <div class="mc-lbl">POSTS</div>
          <div class="mc-val a-purple" id="cnt-posts">0</div>
          <div class="mc-obs">ⓘ Inclui collabs entre perfis da RBV; collabs com contas externas não entram.</div>
          <div class="mc-compare" id="cmp-posts"></div>
          <div class="mc-divider"></div>
          <div class="mc-progress-track"><div class="mc-progress-fill" id="prog-posts" style="width:0%"></div></div>
          <div class="mc-bottom"><span class="mc-pct" id="pct-posts">0%</span><span class="mc-diff" id="diff-posts"></span></div>
        </div>
        <div class="card" style="animation-delay:.15s">
          <div class="mc-header"><div class="mc-icon">🎬</div><div class="mc-goal-area"><span class="mc-goal-lbl">META</span><span class="mc-goal-val" id="goal-reels" contenteditable="true" spellcheck="false">6</span><span class="mc-edit-hint">✏</span></div></div>
          <div class="mc-lbl">REELS</div>
          <div class="mc-val a-orange" id="cnt-reels">0</div>
          <div class="mc-obs">ⓘ Inclui collabs entre perfis da RBV; collabs com contas externas não entram.</div>
          <div class="mc-compare" id="cmp-reels"></div>
          <div class="mc-divider"></div>
          <div class="mc-progress-track"><div class="mc-progress-fill" id="prog-reels" style="width:0%"></div></div>
          <div class="mc-bottom"><span class="mc-pct" id="pct-reels">0%</span><span class="mc-diff" id="diff-reels"></span></div>
        </div>
      </div>
    </div><!-- /wrapper -->

    <!-- FLOATING TOOLTIP (legacy L2635-2649 — irmão solto no body; posicionado aqui
         dentro da raiz do componente só para o :deep() alcançar; position:fixed não
         muda o layout visual) -->
    <div id="chart-tooltip">
      <div class="tt-date" id="tt-date"></div>
      <div class="tt-row"><span class="tt-dot" style="background:var(--green)"></span><span class="tt-label">Seguiram</span><span class="tt-val" id="tt-seguiu"></span></div>
      <div class="tt-row"><span class="tt-dot" style="background:var(--red)"></span><span class="tt-label">Deixaram</span><span class="tt-val" id="tt-deixou"></span></div>
      <div class="tt-sep"></div>
      <div class="tt-row"><span class="tt-label" style="font-weight:700;color:var(--text)">Líquido</span><span class="tt-val" id="tt-liquido" style="font-weight:800"></span></div>
      <div class="tt-cmp" id="tt-cmp"></div>
    </div>

    <!-- MODAL "Filtrar campanhas" (legacy L11754-11769 — mesmo motivo do tooltip
         acima: irmão solto no body no legado, trazido pra dentro da raiz aqui) -->
    <div id="campaign-modal-overlay" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:2000;align-items:center;justify-content:center;backdrop-filter:blur(4px);padding-top:max(16px,env(safe-area-inset-top));padding-bottom:max(16px,env(safe-area-inset-bottom));padding-left:max(12px,env(safe-area-inset-left));padding-right:max(12px,env(safe-area-inset-right));" onclick="if(event.target===this)this.style.display='none'">
      <div class="campaign-modal">
        <div class="camp-modal-hdr">
          <span>Filtro de Campanhas</span>
          <button class="camp-modal-close" onclick="document.getElementById('campaign-modal-overlay').style.display='none'">✕</button>
        </div>
        <div class="camp-modal-sub">Selecione as campanhas contabilizadas nos indicadores de Ads. <strong id="camp-count"></strong></div>
        <div id="campaign-list" class="camp-list"></div>
        <div class="camp-modal-footer">
          <button class="btn-camp-all" onclick="document.querySelectorAll('#campaign-list input').forEach(cb=>cb.checked=true);updateCampaignCount()">Selecionar todas</button>
          <button class="btn-camp-all" onclick="document.querySelectorAll('#campaign-list input').forEach(cb=>cb.checked=false);updateCampaignCount()">Desmarcar todas</button>
          <button class="btn-camp-none" onclick="saveNoneCampaigns()">Nenhuma</button>
          <button class="btn-camp-save" onclick="saveCampaignFilter()">Salvar filtro</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, onUnmounted, ref } from 'vue'
import BarraDeTopo from '../../compartilhado/barra-de-topo.vue'
import { useRouter } from 'vue-router'
import FaixaDeErro from '../../compartilhado/faixa-de-erro.vue'
import { sbClient, SUPABASE_URL, SUPABASE_ANON_KEY } from '../../compartilhado/conectar-no-banco-de-dados.js'
import { estado, hasPermission, contasPermitidas } from '../../compartilhado/controle-de-login-e-usuario.js'
import { adminToast } from '../../compartilhado/avisos.js'
import { sb } from '../../compartilhado/buscar-e-salvar-dados.js'
import { hojeLocal } from '../../compartilhado/datas.js'
import { montarSerieDeInvestimento, montarSerieDeCustoPorSeguidor, montarSerieDeCustoPorResultado, diasComInvestimentoEResultado, valeDesenharOGrafico } from './series-diarias-de-meta-ads.js'
import { graficoDoCartao, opcoesDoGrafico } from './graficos-de-custo-diario.js'
import { ehRecorteRolante, ehGraficoDeContexto } from './janela-de-seguidores.js'
// Quanta largura um gráfico de um ponto por dia precisa ter, e se ele passa a
// rolar para o lado. Puro e com teste ao lado (largura-do-grafico.test.mjs).
// Nasceu da medida a 375px: 30 dias em 319px davam ~10px por dia e os valores em
// reais se sobrepunham em −5px.
import { larguraDoGrafico, rotulosQueCabem, ancoraDoRotulo, ESPACO_ANTES_DO_GRAFICO, ESPACO_DEPOIS_DO_GRAFICO } from './largura-do-grafico.js'
// Decide se a barra do dia é número do Instagram ou estimativa nossa. Puro e com
// teste ao lado (estimativa-de-seguidores.test.mjs), usando a contagem REAL do
// Breno nos dias em que a Meta parou de publicar.
import { barraDoDia, diasSemPublicacao, totalPelasBarras } from './estimativa-de-seguidores.js'
// Em que balde cada campanha entra (Seguidores / Contatos / Site e alcance /
// Vendas). Puro e com teste ao lado (baldes-do-painel.test.mjs), decidido pelo
// sinal que a Meta afirma no conjunto — nunca pelo nome da campanha.
import { BALDES, idsDoBalde, idsParaConsulta, conjuntosMaisRecentes, baldesSemGasto, baldeEfetivo, classificacaoEhProvisoria, campanhasSemTipoConfirmado, fraseDoRecorte } from './baldes-do-painel.js'
import { cartoesDoBalde, podeDarVeredito, chaveDeMeta, ehMetaDeTaxa } from './cartoes-do-balde.js'
import { capturaDoAgregado, capturasDaJanela } from './captura-do-agregado.js'
// Por quantos seguidores o custo por seguidor divide. Puro e com teste ao lado:
// o denominador tem de sair da MESMA fonte do número impresso no cartão de
// seguidores — era daí que vinha o R$ 16,76 no lugar de R$ 8,22.
import { seguidoresDoCusto, FONTES } from './seguidores-do-custo.js'

const router = useRouter()

// Falha das buscas de campaign_insights (seção 02 · Meta Ads). Nulo = deu certo.
const erroAds = ref(null)

const logoClaroUrl = '/midia/LOGOTIPOBRENOPRETO.png'
const logoEscuroUrl = '/midia/LOGOTIPOBRENOBRANCO.png'

// ==========================================================================
// PORTE VERBATIM do Dashboard Redes Sociais (legacy/index.html — funções e
// estado espalhados entre L3286-5725), menos openDashboard/showDashboard/
// loadDashboard (que setavam currentUserRole/Features/currentSession e
// mostravam/escondiam "telas" do monólito por display:none) — essas 3 já
// estão cobertas pela fundação de login compartilhada (controle-de-login-e-
// usuario.js: estado.role/features/userId/currentSession) e pelo vue-router
// (visibilidade da tela). Em vez delas, onMounted abaixo roda diretamente o
// PIPELINE de inicialização que loadDashboard chamava depois de já ter o
// papel/features (ver comentário no onMounted).
//
// Dependências externas resolvidas:
//   - sbClient, SUPABASE_URL, SUPABASE_ANON_KEY → import (conectar-no-banco-de-dados.js)
//   - hasPermission                              → import (controle-de-login-e-usuario.js)
//     (a checagem por dentro dela é idêntica à hasPermission local do legado
//     (legacy L3291-3298) — mesmo keyMap, incluindo 'tool:social' — por isso
//     NÃO foi copiada de novo aqui, só importada.)
//   - adminToast                                 → import (avisos.js)
//   - sb                                         → import (buscar-e-salvar-dados.js) —
//     idêntico ao sb() do legado (legacy L3356), só troca currentSession por
//     estado.currentSession; reaproveitado em vez de copiado de novo.
//   - estado.currentSession                      → substitui a global solta `currentSession`
//     do legado (usada em saveNoneCampaigns/saveCampaignFilter).
//   - estado.role/estado.features/estado.userId  → substituem
//     currentUserRole/currentUserFeatures/currentUserId (não usados diretamente
//     neste módulo — só via hasPermission importado).
//
// Coisas que no legado rodavam SOLTAS no escopo global do <script> (fora de
// qualquer função, executadas uma vez ao carregar a página) e que aqui viraram
// parte do onMounted/onUnmounted (senão os elementos do DOM ainda não existem
// quando o módulo é avaliado, e os listeners vazariam entre montagens da rota):
//   - a wiring do tooltip do gráfico (svgEl/overlay/crosshair/dotCurr/dotPrev/
//     tooltip + addEventListener mousemove/mouseleave no #chart-overlay,
//     legacy L3599-3629);
//   - os 4 document.addEventListener(mousemove/click/keydown/touchstart,
//     _acResetInactivity) do auto-cycle (legacy L4302-4306).
// Ambos são registrados em onMounted e removidos em onUnmounted.
//
// Outra pequena adaptação (fora do "verbatim" estrito, mas exigida pra não
// vazar timers entre entradas/saídas da rota — CLAUDE.md gotcha #4): o
// startClock() do legado (L5222) nunca guardava o id do seu próprio
// setInterval (um "bug" inofensivo no monólito, que só carregava a página
// uma vez). Aqui ele guarda em _clockTimer, limpo em onUnmounted.
//
// Nada foi reescrito para template reativo — o board inteiro (metric cards,
// gráfico SVG, chips, seletor de perfis, modal de campanhas, painel admin)
// segue montado via getElementById/createElement/innerHTML, exatamente como
// a produção atual. Por isso o cluster de funções chamadas por onclick="..."
// literal no <template> acima é exposto em window no fim deste bloco.
// ==========================================================================

/* ── PERÍODOS / TEMAS DE PERFIL (legacy L3300-3321, verbatim) ── */
// "Hoje" removido; "MÊS" (mês corrente) unifica o antigo MÊS + ATÉ AGORA (eram a mesma coisa).
// 2D (não 1D): o follows de ONTEM ainda não consolidou na Meta (~2 dias); 2D já pega um dia consolidado.
const PERIODS = [{ label: 'Hoje', value: 0 }, { label: '1D', value: 1 }, { label: '3D', value: 3 }, { label: '7D', value: 7 }, { label: '14D', value: 14 }, { label: '30D', value: 30 }, { label: 'MÊS', value: 'monthfull' }, { label: 'MÊS PASS.', value: 'lastmonth' }]
const ACCOUNT_PICS = {}
const PROFILE_THEMES = {
  'Raíssa Herculano': { accent: '#BE185D', light: 'rgba(190,24,93,0.08)', mid: 'rgba(190,24,93,0.30)' },
  'Breno Vale': { accent: 'var(--accent)', light: 'rgba(29,78,216,0.08)', mid: 'rgba(29,78,216,0.30)' },
  'Mantova Móveis': { accent: 'var(--accent)', light: 'rgba(29,78,216,0.08)', mid: 'rgba(29,78,216,0.30)' },
  'Vessel': { accent: 'var(--green)', light: 'rgba(22,101,52,0.08)', mid: 'rgba(22,101,52,0.30)' },
  'Motoeasy': { accent: 'var(--red)', light: 'rgba(155,28,28,0.08)', mid: 'rgba(155,28,28,0.30)' },
}
function applyProfileTheme(name) {
  // Cor de destaque FIXA — NÃO muda por perfil (nem no modo vitrine, nem no clique manual).
  // Usa o accent do tema atual (respeita claro/escuro); não sobrescreve --accent por perfil.
  const acc = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || 'var(--accent)'
  const line = document.getElementById('chart-line'); if (line) line.setAttribute('stroke', acc)
  const dot = document.getElementById('dot-curr'); if (dot) dot.setAttribute('fill', acc)
  document.querySelectorAll('#chartGrad stop').forEach(s => s.setAttribute('stop-color', acc))
  const ll = document.getElementById('chart-legend-line'); if (ll) ll.style.background = acc
  const apbName = document.getElementById('apb-name'); if (apbName) apbName.textContent = name
  const apbImg = document.getElementById('apb-img')
  const apbRingWrap2 = document.getElementById('apb-ring-wrap')
  if (apbImg) { const pic = ACCOUNT_PICS[name]; if (pic) { apbImg.src = pic; if (apbRingWrap2) apbRingWrap2.style.display = 'flex' } else { if (apbRingWrap2) apbRingWrap2.style.display = 'none' } }
}

/* ── METAS PADRÃO (legacy L3323-3346, verbatim) ── */
const GOALS = {
  followers: { 1: 60, 7: 200, 14: 400, 30: 1500 },
  spend: { 1: 100, 7: 600, 14: 1200, 30: 2500 },
  cps: { 1: 2.0, 7: 2.0, 14: 2.0, 30: 2.0 },
  cpi: { 1: 0.15, 7: 0.15, 14: 0.15, 30: 0.15 },
  cpl: { 1: 0.20, 7: 0.20, 14: 0.20, 30: 0.20 },
  // NÃO existe padrão para custo por conversa, por cadastro, por venda, por visita
  // nem para o custo por mil impressões — de propósito. Indicador de balde novo
  // nasce SEM META (ver metaDefinida): mostra o número, não mostra barra e não dá
  // nota, até o dono digitar o alvo dele. Um número chutado aqui viraria veredito
  // sobre a campanha de todo mundo sem ninguém ter medido nada.
  likes: { 1: 400, 7: 1000, 14: 2000, 30: 12000 },
  saves: { 1: 80, 7: 250, 14: 500, 30: 2500 },
  shares: { 1: 60, 7: 200, 14: 400, 30: 2000 },
  stories: { 1: 6, 7: 28, 14: 56, 30: 120 },
  'posts-reels': { 1: 3, 7: 12, 14: 24, 30: 50 },
  posts: { 1: 3, 7: 6, 14: 12, 30: 25 },
  reels: { 1: 3, 7: 6, 14: 12, 30: 25 },
  'story-shares': { 1: 30, 7: 200, 14: 400, 30: 900 },
  'story-replies': { 1: 8, 7: 50, 14: 100, 30: 220 },
  reach: { 1: 5000, 7: 30000, 14: 60000, 30: 120000 },
  views: { 1: 8000, 7: 50000, 14: 100000, 30: 200000 },
  interactions: { 1: 500, 7: 3000, 14: 6000, 30: 12000 },
  engaged: { 1: 400, 7: 2500, 14: 5000, 30: 10000 },
  'profile-views': { 1: 500, 7: 3000, 14: 6000, 30: 12000 },
  'st-reach': { 1: 500, 7: 3000, 14: 6000, 30: 12000 },
  'st-interactions': { 1: 30, 7: 150, 14: 300, 30: 600 },
  'st-navigation': { 1: 200, 7: 1200, 14: 2400, 30: 5000 },
  'st-profile-visits': { 1: 10, 7: 60, 14: 120, 30: 250 },
  'st-follows': { 1: 2, 7: 12, 14: 24, 30: 50 },
}

/* ── ESTADO DO MÓDULO (legacy L3348-3353, verbatim exceto currentSession,
   que virou estado.currentSession — importado) ── */
let currentPeriod = (function () { try { const raw = localStorage.getItem('dash_period'); if (raw == null) return 7; const m = PERIODS.find(p => String(p.value) === raw); return m ? m.value : 7 } catch (e) { return 7 } })()
let currentAccountId = null
// ⚠️ O INTERVALO É GUARDADO, COMO O PERÍODO JÁ ERA — e restaurado JUNTO com os
// campos de data. Sem isto, o navegador restaurava os CAMPOS ao recarregar e o
// estado voltava para o período padrão: a tela mostrava "05/09 a 09/09" escrito
// nos campos e calculava "7 dias" por dentro. O dono passou horas apontando
// números que não batiam, e todos batiam — com o período errado (09/09/2026).
const CHAVE_INTERVALO = 'dash_custom'
const _intervaloGuardado = (function () {
  try {
    const raw = localStorage.getItem(CHAVE_INTERVALO)
    if (!raw) return null
    const v = JSON.parse(raw)
    const ehData = (x) => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x)
    return (ehData(v && v.s) && ehData(v && v.e) && v.s <= v.e) ? v : null
  } catch (e) { return null }
})()
let currentStartDate = _intervaloGuardado ? _intervaloGuardado.s : null
let currentEndDate = _intervaloGuardado ? _intervaloGuardado.e : null
let activeChartData = null

/* ── BALDE DE CAMPANHA (seção 02 · Meta Ads) ──
   O balde escolhido é recorte de LEITURA, não configuração de conta: fica no
   navegador de quem olha, por perfil, e não vira ajuste compartilhado. Sessão
   nova abre em Seguidores — este é o painel de redes sociais, e o que ele
   responde primeiro é quanto custa crescer. */
let _baldeAtual = 'seguidores'
const _baldeKey = id => 'ig_balde_' + (id || 'default')
function carregarBalde(accountId) {
  let salvo = null
  try { salvo = localStorage.getItem(_baldeKey(accountId)) } catch (e) {}
  // Só aceita id de balde que existe: um valor velho no localStorage (ou editado
  // à mão) recortaria as consultas por um tipo que ninguém conhece e a seção 02
  // ficaria vazia sem explicação.
  _baldeAtual = BALDES.some(b => b.id === salvo) ? salvo : 'seguidores'
}
function setBalde(id) {
  _baldeAtual = id
  try { localStorage.setItem(_baldeKey(currentAccountId), id) } catch (e) {}
  refresh()
}
// `vazios` = ids de balde sem gasto no período. Ficam APAGADOS com o motivo —
// nunca somem: sumir faz a pessoa procurar o que não está lá.
// `efetivo` é o balde que as consultas REALMENTE usaram: quando o escolhido está
// vazio neste perfil/período, a tela cai em Todos e a barra precisa dizer isso,
// senão ela marcaria um balde que não é o dos números na tela.
function desenharBaldeBar(vazios, efetivo) {
  const bar = document.getElementById('balde-bar'); if (!bar) return
  const semGasto = vazios || []
  bar.textContent = ''
  BALDES.forEach(b => {
    const bt = document.createElement('button')
    bt.className = 'balde-btn'; bt.type = 'button'; bt.dataset.balde = b.id
    bt.textContent = b.rotulo
    bt.setAttribute('role', 'tab')
    bt.setAttribute('aria-selected', String(b.id === (efetivo || _baldeAtual)))
    if (semGasto.includes(b.id)) {
      bt.disabled = true
      // O texto afirma uma MEDIÇÃO, então só pode aparecer onde ela existe: um
      // balde só entra em `vazios` quando há série diária na janela para medir
      // (ver baldesSemGasto). Sem série, nada é apagado e nada é afirmado.
      bt.title = 'Nenhuma campanha desse tipo gastou nos dias deste período'
      bt.setAttribute('aria-disabled', 'true')
    } else {
      bt.addEventListener('click', () => setBalde(b.id))
    }
    bar.appendChild(bt)
  })
}
// Enquanto campaign_adsets estiver vazia pra este perfil, TODA campanha dele
// cai pela regra do objetivo (ver baldes-do-painel.js) — e o objetivo mente:
// campanha de WhatsApp chega da Meta rotulada "engagement", que é a mesma
// caixa dos Seguidores. Isso já mede 87% do dinheiro "de engajamento" da
// Vessel. A tela não pode mostrar o recorte por balde com cara de número
// fechado enquanto isso for verdade — precisa avisar.
//
// E ELE QUASE NUNCA É O CASO. Os cinco perfis ativos já têm conjunto coletado,
// então o aviso do perfil inteiro não fala mais — enquanto o risco de verdade
// virou POR CAMPANHA: campanha criada agora fica sem conjunto até a próxima
// rodada e é classificada pelo objetivo, que engana (na Vessel, duas campanhas
// gêmeas de WhatsApp caem em baldes DIFERENTES por causa disso). Por isso o
// segundo aviso, com a contagem — ver campanhasSemTipoConfirmado.
//
// Um de cada vez, de propósito: quando a tabela está vazia para o perfil, TODAS
// as campanhas estão sem conjunto, e as duas frases diriam a mesma coisa duas
// vezes. A do perfil é a mais precisa, então ela vence.
function desenharAvisoBalde(provisorio, semTipo) {
  const banner = document.getElementById('balde-provisorio-banner'); if (!banner) return
  let texto = ''
  if (provisorio) texto = '⚠️ Classificação provisória: os tipos de campanha ainda não foram coletados neste perfil. Os valores por tipo de campanha podem mudar depois da próxima coleta.'
  else if (semTipo > 0) texto = semTipo === 1
    ? '⚠️ 1 campanha ainda sem tipo confirmado — classificada pelo objetivo. O tipo dela pode mudar depois da próxima coleta.'
    : '⚠️ ' + semTipo + ' campanhas ainda sem tipo confirmado — classificadas pelo objetivo. O tipo delas pode mudar depois da próxima coleta.'
  banner.style.display = texto ? 'flex' : 'none'
  banner.textContent = texto
}

/* ── OS QUATRO CARTÕES DA SEÇÃO 02 (o conteúdo troca com o balde) ── */
// Os quatro lugares FÍSICOS da grade. Os ids de dentro (goal-, cmp-, prog-, pct-,
// diff-, ads-…-val) continuam sendo os de sempre: o que troca com o balde é o
// CONTEÚDO, não o esqueleto. Assim applyMetric/applySpend/_mcValColor, que
// procuram elemento por esses ids, seguem valendo sem precisar saber que existe
// balde. A ordem é a que cartoesDoBalde() devolve.
const SLOTS_DOS_CARTOES = ['spend', 'cps', 'cpi', 'cpl']
// Um ícone por indicador. Emoji aqui é o mesmo padrão dos outros cartões da tela
// (não é ícone de interface — é o desenho decorativo do topo do cartão).
const ICONE_DO_CARTAO = {
  investimento: '💰', cps: '🎯', cpi: '🤝', cpl: '❤️', cpm: '📣', alcance: '👁',
  frequencia: '🔁', custo_conversa: '💬', conversas: '💬', custo_cadastro: '📝',
  custo_venda: '🛒', compras: '🛒', custo_visita: '🔗', visitas: '🔗',
}
// O semáforo do módulo puro fala em bom/atenção/ruim; a tela pinta com as cores
// que já existem em estilos-globais.css (var(--green)/(--yellow)/(--red)).
const COR_DO_SEMAFORO = { bom: 'green', atencao: 'yellow', ruim: 'red' }

// "—" nunca pode sair como zero. Em dinheiro fica "R$ —" (é o texto que a seção
// 02 já usava e que diz de que unidade estamos falando).
function textoDoCartao(cartao) {
  if (cartao.valor == null) return cartao.formato === 'dinheiro' ? 'R$ —' : '—'
  if (cartao.formato === 'dinheiro') return fmtR(cartao.valor)
  if (cartao.formato === 'decimal') return cartao.valor.toFixed(2).replace('.', ',') + '×'
  return fmtN(cartao.valor)
}

// De ONDE veio o alcance muda o que dá para afirmar dele — e só a tela sabe. Em
// Todos sem filtro nenhum ele é o total DEDUPLICADO da conta; em qualquer recorte
// é a soma campanha a campanha, e aí quem viu dois anúncios entrou duas vezes. A
// frequência sai desse mesmo denominador, então herda o aviso: com alcance
// inflado, ela sai BAIXA demais. Afirmar isso como fato seria mentir com número.
function explicacaoDoCartao(cartao, ctx) {
  if (cartao.id === 'alcance') {
    return cartao.explicacao + (ctx.alcanceRepete
      ? ' Atenção: aqui ele soma campanha a campanha, então quem viu dois anúncios está contado duas vezes.'
      : ' Vem do total da conta, já sem repetir gente.')
  }
  if (cartao.id === 'frequencia' && ctx.alcanceRepete) {
    return cartao.explicacao + ' Atenção: calculada sobre um alcance que repete pessoa — a de verdade é maior que esta.'
  }
  return cartao.explicacao
}

function desenharCartoesDoBalde(cartoes, ctx) {
  SLOTS_DOS_CARTOES.forEach((slot, i) => {
    const pctEl = document.getElementById('pct-' + slot)
    const card = pctEl && pctEl.closest('.card')
    if (!card) return
    const cartao = cartoes[i] || null
    // Balde de TRÊS cartões (Vendas): o quarto lugar sai da grade. Deixar um
    // retângulo vazio ali faria a pessoa procurar o indicador que não existe.
    card.style.display = cartao ? '' : 'none'
    // Limpa o que o balde anterior deixou. Sem isto, o "↑ R$ 3,00 acima da meta"
    // do indicador de ontem ficaria embaixo do número de hoje.
    _mcValColor(slot, ''); _mcBorderColor(slot, '')
    const cmpEl = document.getElementById('cmp-' + slot); if (cmpEl) cmpEl.textContent = ''
    const progEl = document.getElementById('prog-' + slot); if (progEl) { progEl.style.width = '0%'; progEl.className = 'mc-progress-fill' }
    pctEl.textContent = ''; pctEl.className = 'mc-pct'
    const diffEl = document.getElementById('diff-' + slot); if (diffEl) { diffEl.textContent = ''; diffEl.className = 'mc-diff' }
    // O selo de prévia/consolidando mora no segundo cartão e só vale quando ele é
    // o custo por seguidor (ver desenharCustoPorSeguidor).
    if (slot === 'cps') { const p = document.getElementById('previa-cps'); if (p) { p.style.display = 'none'; p.innerHTML = '' } }
    // A CHAVE da meta carrega o balde (ver chaveDeMeta): a meta que o dono digita
    // em Contatos é `contatos.custo_conversa` e não encosta na de Seguidores. As
    // que já existiam no banco (cps/cpi/cpl em Seguidores, spend em Todos) seguem
    // sem prefixo, no balde contra o qual foram definidas.
    const chaveMeta = (cartao && cartao.metaKey) ? chaveDeMeta(cartao.metaKey, ctx.balde) : null
    // O campo de meta larga a chave do balde anterior mesmo quando o cartão SOME
    // (Vendas esconde o quarto). Guardar o id de um indicador que não está na tela
    // deixaria dois elementos com o mesmo id quando ele voltasse em outro lugar da
    // grade — e quem lê meta por id leria o escondido.
    const metaEl = card.querySelector('.mc-goal-val')
    if (metaEl && !chaveMeta) metaEl.id = 'goal-livre-' + slot
    if (!cartao) return
    const icone = card.querySelector('.mc-icon'); if (icone) icone.textContent = ICONE_DO_CARTAO[cartao.id] || '📊'
    const rotulo = card.querySelector('.mc-lbl'); if (rotulo) rotulo.textContent = cartao.rotulo
    const selo = card.querySelector('.calc-badge'); if (selo) selo.textContent = '⚡ ' + explicacaoDoCartao(cartao, ctx)
    // ÁREA DE META: só existe onde há meta. Cartão de QUANTIDADE (alcance,
    // conversas, vendas) e a frequência não têm — desenhar um campo editável vazio
    // ali convidaria o dono a preencher uma meta que ninguém lê.
    const temMeta = !!chaveMeta
    const areaMeta = card.querySelector('.mc-goal-area'); if (areaMeta) areaMeta.style.display = temMeta ? '' : 'none'
    // O ALVO que o dono realmente definiu, ou null. Indicador de balde novo NASCE
    // SEM META: o campo fica em "—", esperando o número dele. Herdar a meta de
    // outro indicador ou inventar um padrão é pior do que não ter — um alvo
    // chutado faz o semáforo responder "de quem é essa conta?" em vez de "essa
    // campanha vai bem?".
    const meta = temMeta ? metaDefinida(chaveMeta, currentPeriod, currentAccountId) : null
    if (metaEl && temMeta) {
      // O id DO ELEMENTO é a chave de gravação: watchGoals lê el.id no blur e
      // grava com ela. Trocar o id junto com o cartão é o que impede a meta de
      // custo por conversa de gravar por cima da de custo por seguidor.
      // (O caso sem meta já foi estacionado lá em cima, antes do `return`.)
      metaEl.id = 'goal-' + chaveMeta
      metaEl.textContent = meta == null ? '—' : String(meta)
      const lblMeta = card.querySelector('.mc-goal-lbl')
      if (lblMeta) lblMeta.textContent = cartao.id === 'investimento' ? 'BUDGET' : 'META MÁX'
    }
    // Barra, porcentagem e veredito só existem com alvo. Sem meta o cartão mostra
    // o número e a comparação, e cala a nota — é um estado normal, não quebrado.
    const temBarra = temMeta && meta != null
    ;['.mc-divider', '.mc-progress-track', '.mc-bottom'].forEach((sel) => { const el = card.querySelector(sel); if (el) el.style.display = temBarra ? '' : 'none' })
    // O CUSTO POR SEGUIDOR segue com o caminho dele, inteiro: é o único indicador
    // desta tela cujo denominador a Meta publica com ~1 dia de atraso, e os selos
    // "⏳ consolidando" e "⏳ prévia" existem por causa disso. O NÚMERO, porém, é o
    // mesmo dos outros custos: investimento do cartão ÷ novos seguidores.
    if (cartao.id === 'cps') { desenharCustoPorSeguidor(ctx.d, ctx.pl, ctx.inv, ctx.invAnt, cartao, meta, ctx.segCusto); return }
    const valEl = document.getElementById('ads-' + slot + '-val')
    if (valEl) {
      if (cartao.valor != null && cartao.formato === 'inteiro') animCount(valEl, cartao.valor)
      else { valEl.textContent = textoDoCartao(cartao); valEl.removeAttribute('title'); valEl.classList.remove('tem-tooltip') }
    }
    // SEM NÚMERO NÃO SE DÁ NOTA. Barra em 0% com veredito seria uma conclusão
    // tirada de "não sei" — pior do que não dizer nada.
    if (cartao.valor == null) return
    if (cartao.id === 'investimento') {
      setCompare('cmp-' + slot, cartao.valor, ctx.invAnt, 'R$ ', ctx.pl, true)
      if (podeDarVeredito(cartao, meta)) applySpend(cartao.valor, meta)
      return
    }
    if (cartao.semaforo) {
      // Limiar de negócio (frequência ≥ 4), não preferência de conta: pinta o
      // número e a borda, sem barra de progresso nem meta editável.
      const cor = COR_DO_SEMAFORO[cartao.semaforo(cartao.valor)] || ''
      _mcValColor(slot, cor); _mcBorderColor(slot, cor)
      return
    }
    if (!podeDarVeredito(cartao, meta)) return
    applyMetricInverse(slot, cartao.valor, meta)
    _mcBorderColor(slot, perfColor((meta / cartao.valor) * 100))
  })
  // Caixa de comparação VAZIA sai da tela. Ela tem fundo próprio, então vazia vira
  // um retângulo bege no meio do cartão — e retângulo que não diz nada só faz a
  // pessoa procurar o que deveria estar ali. Só o investimento e o custo por
  // seguidor têm período anterior guardado; os outros indicadores ainda não.
  SLOTS_DOS_CARTOES.forEach((slot) => {
    const el = document.getElementById('cmp-' + slot)
    if (el) el.style.display = el.textContent.trim() ? '' : 'none'
  })
}

/* ── UM GRÁFICO DIÁRIO POR LUGAR DA GRADE — nunca por indicador ── */
// O bloco do gráfico é do LUGAR (`gmad-spend`, `gmad-cps`, `gmad-cpi`,
// `gmad-cpl` — os mesmos nomes de SLOTS_DOS_CARTOES), e o que se desenha dentro
// dele sai do cartão que CAIU ali neste balde.
//
// Amarrar o gráfico ao indicador seria repetir o defeito que já apareceu na
// tarefa 6: o bloco ficava com o título do cartão anterior depois que o balde
// trocava. Em Contatos, o segundo lugar é o custo por conversa — um gráfico
// "quanto custou cada seguidor novo" embaixo dele estaria falando de um número
// que não está na tela.
//
// LUGAR SEM CARTÃO (Vendas esconde o quarto) e CARTÃO SEM GRÁFICO (alcance,
// frequência, contagens) esvaziam o bloco. Sem isso, o desenho do balde anterior
// ficaria embaixo de um cartão que não é dele.
function desenharGraficosDosCartoes(cartoes, balde, diario) {
  SLOTS_DOS_CARTOES.forEach((slot, i) => {
    const host = document.getElementById('gmad-' + slot)
    if (!host) return
    // BLOCO VAZIO SAI DA TELA, não fica só sem conteúdo. `.gmad-bloco` tem
    // borda em cima e respiro próprio: esvaziado e ainda exibido, ele vira um
    // risco solto de 13px no pé do cartão — medido a 375px, embaixo do cartão de
    // contagem em Contatos e dos dois lugares vazios em Vendas. Traço sem nada
    // depois faz a pessoa procurar o que deveria estar ali.
    const semGrafico = () => { host.textContent = ''; host.style.display = 'none' }
    host.style.display = ''
    const cartao = cartoes[i] || null
    if (!cartao) { semGrafico(); return }
    // A META vem pela MESMA porta e com a MESMA chave do cartão logo acima (ver
    // chaveDeMeta). Lida aqui, na hora de desenhar, porque o dono edita o campo
    // direto na tela: ler pelo texto do elemento faria o gráfico e o cartão
    // afirmarem metas diferentes sobre o mesmo dinheiro, dependendo da ordem em
    // que foram desenhados.
    const meta = cartao.metaKey ? metaDefinida(chaveDeMeta(cartao.metaKey, balde), currentPeriod, currentAccountId) : null
    if (cartao.id === 'investimento') {
      desenharGraficoDiario(host.id, montarSerieDeInvestimento({
        inicio: diario.inicio, fim: diario.fim, linhasDeGasto: diario.linhasDeGasto, budgetDoPeriodo: meta,
      }), {
        titulo: 'Quanto foi investido em cada dia',
        rotuloValor: 'Investido no dia',
        rotuloMeta: 'Meta do dia',
        // Sem budget não há linha nem barra vermelha — e a legenda não pode prometer o
        // que não está desenhado. Balde novo nasce sem budget: mostra o gasto do dia e
        // cala a nota, até o dono digitar o dele.
        legendaBase: meta > 0
          ? 'Cada barra é um dia · a linha é o budget dividido pelos dias do período · barra vermelha = passou do budget do dia'
          : 'Cada barra é um dia · sem budget definido para este tipo de campanha, então não há linha de meta',
        textoVazio: 'Nenhum investimento registrado nos dias deste período.',
        textoSemDado: { 'sem-coleta': 'sem informação coletada neste dia' },
      })
      return
    }
    if (cartao.id === 'cps') {
      desenharGraficoDiario(host.id, montarSerieDeCustoPorSeguidor({
        inicio: diario.inicio, fim: diario.fim, linhasDeGasto: diario.linhasDeGasto, linhasDeSeguidores: diario.linhasDeSeguidores,
        metaDeCustoPorSeguidor: meta,
      }), {
        titulo: 'Quanto custou cada seguidor novo, dia a dia',
        rotuloValor: 'Custo por seguidor no dia',
        rotuloMeta: 'Meta máxima',
        legendaBase: 'Cada barra é um dia (investido no dia ÷ seguidores novos do dia) · a linha é a meta máxima · barra vermelha = custou mais caro que a meta',
        textoVazio: 'Nenhum dia deste período teve investimento e seguidor novo ao mesmo tempo — sem custo por seguidor pra mostrar.',
        textoSemDado: { 'sem-coleta': 'sem informação coletada neste dia', 'sem-seguidor': 'nenhum seguidor novo neste dia — sem como calcular o custo' },
      })
      return
    }
    // OS SETE CUSTOS POR RESULTADO: a mesma série, com o denominador que o
    // catálogo aponta. O denominador sai das MESMAS linhas do gasto (uma linha
    // por campanha por dia, period_days = 0) — nenhuma viagem a mais ao banco.
    const receita = graficoDoCartao(cartao.id)
    if (!receita) { semGrafico(); return }
    const serie = montarSerieDeCustoPorResultado({
      inicio: diario.inicio, fim: diario.fim, linhasDeGasto: diario.linhasDeGasto,
      linhasDeResultado: (diario.linhasDeGasto || []).map(r => ({ captured_at: r.captured_at, quantidade: r[receita.campo] })),
      meta, divisorDoResultado: receita.divisor,
    })
    // DOIS DIAS PAGOS É O MÍNIMO. Abaixo disso entra a frase, não um gráfico de
    // um pontinho — e o dia que teve resultado sem gastar nada NÃO conta para
    // liberar, senão o gráfico inteiro poderia ser de barras de R$ 0,00, que não
    // dizem nada sobre custo. Ele continua sendo desenhado como ponto quando o
    // gráfico existe: é medida, não buraco.
    //
    // Medido em 30 dias (17/08/2026): custo por venda não desenha em perfil
    // NENHUM, e custo por cadastro não desenha em Breno Vale (1 cadastro),
    // Motoeasy, Raíssa nem Mantova (nenhum). Isso é a regra funcionando, não
    // gráfico faltando: não se baixa o mínimo para preencher o vão.
    desenharGraficoDiario(host.id, serie, {
      ...opcoesDoGrafico(cartao.id, { temMeta: serie.meta > 0, diasComCusto: diasComInvestimentoEResultado(serie) }),
      minimoDeDias: 2,
      exigirInvestimento: true,
    })
  })
}

// ── CUSTO POR SEGUIDOR: investimento ÷ os NOVOS SEGUIDORES QUE ESTÃO NA TELA. ──
// Em 7D/14D/30D isso é o BRUTO (quem seguiu), nunca o líquido — a régua de
// sempre. Em HOJE e 1D a Meta ainda não publicou a quebra "seguiu/saiu", o
// cartão de cima esconde essas duas linhas e mostra só o líquido pela contagem:
// ali o denominador é esse líquido, com selo de prévia, porque é o único número
// de seguidor que a pessoa tem na frente para refazer a conta.
//
// De ONDE sai esse número quem decide é seguidores-do-custo.js (puro, testado).
// Aqui só se desenha — e os dois selos, que são sobre o DENOMINADOR e não sobre
// qual gasto está em cima: a Meta publica "quem seguiu" com ~1 dia de atraso.
//
// `seg` pode faltar numa pintura antiga que não passe pelo update() novo; nesse
// caso vale o caminho coletado de sempre, que é o que existia antes.
function desenharCustoPorSeguidor(d, pl, inv, invAnt, cartao, meta, seg) {
  const _cpsVal = document.getElementById('ads-cps-val')
  const _cpsPrev = document.getElementById('previa-cps')
  const cps = cartao.valor
  const _seg = seg || { valor: d.divSeguidores, anterior: d.divSeguidoresAnterior, previa: !!d.cpsPrevia, fonte: FONTES.coletado }
  // O CUSTO ANTERIOR SÓ EXISTE QUANDO OS DOIS LADOS SÃO DA MESMA JANELA.
  //
  // Isso só acontece com o ao vivo respondendo em 7D/14D/30D: ali o investimento
  // anterior e os seguidores anteriores vêm os dois do período imediatamente
  // anterior, da mesma leitura. Nos outros casos a divisão juntava janelas
  // diferentes — sem ao vivo, `d.prevSpend` é de UM MÊS atrás e o bruto de
  // seguidores é da semana passada, e o quociente não é custo de período nenhum.
  // Em HOJE/1D `_seg.anterior` já vem null (líquido de hoje contra bruto de
  // ontem seriam medidas diferentes).
  // Sem base, o cartão diz "Acumulando histórico…" — que é a verdade — em vez de
  // imprimir uma seta verde sobre um número que ninguém mediu.
  const mesmaJanelaNosDoisLados = _seg.fonte === FONTES.brutoAoVivo
  const cpsAnterior = (mesmaJanelaNosDoisLados && invAnt > 0 && _seg.anterior > 0) ? invAnt / _seg.anterior : null
  const _temInv = (d.spend > 0) || (inv > 0) // só faz sentido falar de custo se houve investimento
  // "Consolidando" = houve dinheiro e mesmo assim não há denominador para dividir.
  //
  // SÓ HOJE/1D ganham regra nova, e de propósito: ali o denominador é o líquido
  // impresso no cartão, e se ele não for positivo não há custo a afirmar — a
  // quebra "quem seguiu" desses dias é justamente a que o Instagram ainda não
  // publicou, que é o que o aviso diz. Em todos os outros caminhos continua
  // mandando o `cpsConsolidando` que o fetchData calcula: ele já distingue "a
  // Meta não fechou" de "ninguém seguiu mesmo", e trocar isso por "não é
  // positivo" faria a tela dizer "aguardando o Instagram" num dia em que a
  // resposta é zero de verdade.
  const _cpsConsolidando = _temInv && (_seg.fonte === FONTES.impressoAoVivo ? !(_seg.valor > 0) : !!d.cpsConsolidando)
  if (_cpsConsolidando) {
    // Sem novos seguidores brutos ainda (dias recentes não fecharam) → não inventa custo, avisa.
    if (_cpsVal) _cpsVal.textContent = '—'
    _mcValColor('cps', 'orange')
    if (_cpsPrev) {
      _cpsPrev.style.display = 'block'
      _cpsPrev.innerHTML = '<span class="previa-selo">⏳ consolidando</span>' +
        '<div class="previa-nota">O custo por seguidor aparece assim que o Instagram publicar quantas pessoas novas seguiram nos dias mais recentes — costuma sair em cerca de 1 dia. Até lá, esses dias ainda não fecharam o número de novos seguidores.</div>'
    }
    const _c = document.getElementById('cmp-cps'); if (_c) _c.innerHTML = '' // "anterior" não ajuda enquanto não fecha
    const _pg = document.getElementById('prog-cps'); if (_pg) { _pg.style.width = '0%'; _pg.className = 'mc-progress-fill' }
    const _pc = document.getElementById('pct-cps'); if (_pc) { _pc.textContent = 'consolidando'; _pc.className = 'mc-pct c-orange' }
    const _df = document.getElementById('diff-cps'); if (_df) { _df.textContent = 'aguardando o Instagram publicar os novos seguidores'; _df.className = 'mc-diff c-orange' }
    _mcBorderColor('cps', 'orange')
  } else if (_seg.previa && cps > 0) {
    // PRÉVIA: o custo foi calculado pelo crescimento da CONTAGEM de hoje (a Meta ainda não
    // publicou o bruto oficial de "quem seguiu"). Mostra o número (não zera!) mas avisa que é
    // prévia e pode ajustar quando fechar. Ex.: R$40 investidos ÷ +5 seguidores hoje = R$8.
    if (_cpsVal) _cpsVal.textContent = fmtR(cps)
    _mcValColor('cps', 'orange')
    if (_cpsPrev) {
      _cpsPrev.style.display = 'block'
      _cpsPrev.innerHTML = '<span class="previa-selo">⏳ prévia</span>' +
        '<div class="previa-nota">Prévia: calculado pelo crescimento da contagem de seguidores (o Instagram ainda não publicou o número oficial de quem seguiu nos dias recentes — costuma sair em ~1 dia). O valor pode ajustar quando fechar.</div>'
    }
    const _c = document.getElementById('cmp-cps'); if (_c) _c.innerHTML = '' // "anterior" não compara com prévia
    _mcBorderColor('cps', 'orange')
    const _pc = document.getElementById('pct-cps'); if (_pc) { _pc.textContent = 'prévia'; _pc.className = 'mc-pct c-orange' }
  } else {
    if (_cpsVal) _cpsVal.textContent = cps > 0 ? fmtR(cps) : 'R$ —'
    if (_cpsPrev) { _cpsPrev.style.display = 'none'; _cpsPrev.innerHTML = '' }
    setCompare('cmp-cps', cps || 0, cpsAnterior, 'R$ ', pl, true)
    if (podeDarVeredito(cartao, meta)) {
      applyMetricInverse('cps', cps, meta); _mcBorderColor('cps', perfColor((meta / cps) * 100))
    } else { _mcValColor('cps', ''); _mcBorderColor('cps', '') }
  }
}

/* ── HELPERS (legacy L3367-3411, verbatim) ── */
function popEl(el) {
  const tgt = el.closest ? el.closest('.mc-val') || el : el
  tgt.style.animation = 'none'; void tgt.offsetWidth
  tgt.style.animation = 'numPop .4s cubic-bezier(.34,1.56,.64,1)'
}
function animCount(el, target) {
  const dur = 800, start = performance.now()
  // Tooltip universal: guarda o número INTEIRO (fmtN resume no texto) p/ revelar no hover/toque.
  const cheio = (Number(target) || 0).toLocaleString('pt-BR')
  try { el.title = cheio; el.dataset.full = cheio; el.classList.add('tem-tooltip') } catch (e) {}
  function tick(now) {
    const t = Math.min((now - start) / dur, 1)
    const v = Math.round(target * (1 - Math.pow(1 - t, 3)))
    el.textContent = fmtN(v)
    if (t < 1) requestAnimationFrame(tick); else popEl(el)
  }
  requestAnimationFrame(tick)
}
// Toque/clique num número resumido revela o inteiro (mobile); no desktop o :hover já mostra.
function _onTooltipTap(e) {
  const alvo = e.target.closest ? e.target.closest('.tem-tooltip') : null
  document.querySelectorAll('.tela-redes-sociais .tem-tooltip.mostrar').forEach(el => { if (el !== alvo) el.classList.remove('mostrar') })
  if (alvo) alvo.classList.toggle('mostrar')
}
function animCountFull(el, target) {
  const dur = 900, start = performance.now()
  function tick(now) {
    const t = Math.min((now - start) / dur, 1)
    const v = Math.round(target * (1 - Math.pow(1 - t, 3)))
    el.textContent = v.toLocaleString('pt-BR')
    if (t < 1) requestAnimationFrame(tick); else popEl(el)
  }
  requestAnimationFrame(tick)
}
function fmtN(n) { n = Number(n) || 0; const a = Math.abs(n); if (a >= 1e6) return (n / 1e6).toFixed(1).replace('.', ',') + ' mi'; if (a >= 1e3) return (n / 1e3).toFixed(1).replace('.', ',') + ' mil'; return String(n) }
function fmtR(v) { const p = v.toFixed(2).split('.'); return 'R$ ' + p[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + p[1] }
function pctDiff(curr, prev) { if (!prev) return '+0.0%'; const d = ((curr - prev) / prev * 100); return (d >= 0 ? '+' : '') + d.toFixed(1) + '%' }
// Indicadores de engajamento nunca são negativos: valor negativo (glitch da Meta) vira 0.
function naoNeg(v) { return Math.max(0, Number(v) || 0) }
function perfColor(pct) { return pct >= 100 ? 'green' : pct >= 75 ? 'yellow' : pct >= 50 ? 'orange' : 'red' }
// formatação condicional: pinta o NÚMERO do indicador conforme o desempenho vs meta
const _PERF_VAR = { green: 'var(--green)', yellow: 'var(--yellow)', orange: 'var(--orange)', red: 'var(--red)' }
function _mcValColor(key, clr) { const pe = document.getElementById('pct-' + key); const card = pe && pe.closest('.card'); const v = card && card.querySelector('.mc-val'); if (!v) return; const col = _PERF_VAR[clr] || ''; if (col) { v.style.setProperty('color', col, 'important'); v.style.setProperty('-webkit-text-fill-color', col, 'important') } else { v.style.removeProperty('color'); v.style.removeProperty('-webkit-text-fill-color') } }
function _mcBorderColor(key, clr) { const pe = document.getElementById('pct-' + key); const card = pe && pe.closest('.card'); if (!card) return; card.style.borderLeftColor = clr ? (_PERF_VAR[clr] || '') : '' }
function goalStorageKey(key, period, accountId) { return 'ig_goal_' + (accountId || 'default') + '_' + period + '_' + key }
// `ehMetaDeTaxa` mora em cartoes-do-balde.js, ao lado do `chaveDeMeta` que monta
// a chave que ela lê — e com teste. Ela é a única coisa que impede uma meta de
// custo de ser MULTIPLICADA de um período para outro (R$ 12 por conversa em 7D
// virando R$ 51 na linha de 30D): o que ela estraga é um número GRAVADO, não um
// pixel, e por isso não podia continuar sem prova.
// comprimento em dias de cada período (pro recálculo proporcional). null = comprimento variável (não escala).
function periodDays(period) {
  if (period === 0 || period === 1) return 1
  if (period === 7 || period === 14 || period === 30) return period
  const now = new Date()
  if (period === 'monthfull') return new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  if (period === 'lastmonth') return new Date(now.getFullYear(), now.getMonth(), 0).getDate()
  if (period === 'sofar') return null
  const n = Number(period); return (isFinite(n) && n > 0) ? n : 7
}
// Janelas EXATAS por período (fuso BRT) para a busca AO VIVO dos KPIs (ver docs/superpowers/.../redes-hibrido).
// Engajamento = faixa do período (mês-calendário no lastmonth/monthfull). Follows = a MESMA janela deslocada -1 dia
// (a Meta bucketiza follows_and_unfollows 1 dia atrás — validado: mês passado follows = 31/05→30/06 = 1281/571).
// 🔒 TRAVA DE SEGURANÇA: os intervalos aqui (ENGAJAMENTO e NOVOS SEGUIDORES) estão VALIDADOS contra o
// painel profissional do Breno (batendo exato). NÃO alterar à toa — se mexer, o auto-teste
// `verificarTravaJanelas()` (roda no mount) GRITA no console. Camada extra de decisão: só mude com os
// números exatos do Breno em mãos, revalidando na tela E atualizando a referência da trava junto.
function janelasDoPeriodo(period, hoje = new Date(), customStart = null, customEnd = null) {
  const TS = (d) => String(Math.floor(d.getTime() / 1000))
  const dia00 = (yy, mm1, dd) => new Date(`${yy}-${String(mm1).padStart(2, '0')}-${String(dd).padStart(2, '0')}T00:00:00-03:00`)
  const menos1 = (d) => new Date(d.getTime() - 86400000)
  const menosDias = (d, n) => new Date(d.getTime() - n * 86400000)
  const primeiro = (yy, mIdx) => { const d = new Date(yy, mIdx, 1); return dia00(d.getFullYear(), d.getMonth() + 1, 1) }
  const y = hoje.getFullYear(), M = hoje.getMonth()
  const hoje00 = dia00(y, M + 1, hoje.getDate())
  // engS/engU = janela ATUAL; engSp/engUp = janela do período ANTERIOR (pro comparativo).
  // folShift = aplica o -1 dia nos follows? Só o MÊS PASSADO (fechado) precisa (validado 1281/571).
  // Rolantes/mês corrente/personalizado usam a janela DIRETA (validado: 7D 30/06-06/07 = 319/130 exato).
  let engS, engU, engSp, engUp, folShift = false
  if (customStart && customEnd) {
    // Intervalo personalizado (faixa fechada): eng = [início 00:00, fim+1dia 00:00); anterior = mesma duração logo antes.
    engS = new Date(`${customStart}T00:00:00-03:00`)
    engU = new Date(new Date(`${customEnd}T00:00:00-03:00`).getTime() + 86400000)
    const dias = Math.round((engU.getTime() - engS.getTime()) / 86400000)
    engSp = menosDias(engS, dias); engUp = engS
  } else if (period === 'lastmonth') {
    engS = primeiro(y, M - 1); engU = primeiro(y, M)
    engSp = primeiro(y, M - 2); engUp = primeiro(y, M - 1)
  } else if (period === 'monthfull' || period === 'sofar' || period === 'month') {
    // MÊS = mês corrente ATÉ ONTEM (dias completos); comparativo = MESMO nº de dias no mês anterior.
    engS = primeiro(y, M); engU = hoje00
    const dias = Math.round((engU.getTime() - engS.getTime()) / 86400000)
    engSp = primeiro(y, M - 1); engUp = new Date(engSp.getTime() + dias * 86400000)
  } else if (period === 0) {
    // HOJE: engajamento do dia ATÉ AGORA [hoje 00:00, agora); comparativo = ONTEM (dia completo).
    engS = hoje00; engU = hoje; engUp = hoje00; engSp = menos1(hoje00)
  } else if (period === 1) {
    engU = hoje00; engS = menos1(hoje00); engUp = engS; engSp = menos1(engS)
  } else {
    // Rolantes (7/14/30): janela DIRETA [hoje-N, hoje) — inclui ONTEM, SEM -1 dia (validado: 7D=319/130, 14D=638/262, 30D=1295/580).
    const n = Number(period) || 30
    engU = hoje00; engS = menosDias(hoje00, n); engUp = engS; engSp = menosDias(engS, n)
  }
  // FOLLOWS: a Meta consolida com ~1 dia de atraso (o painel profissional também). Duas regras
  // validadas (Breno, hoje=07/07): 7D 319/130, 14D 638/262, 30D 1295/580, mês pass 1281/571:
  //  • MÊS PASSADO (fechado): janela deslocada -1 dia nos DOIS lados — a Meta bucketiza o mês 1 dia
  //    atrás, então "junho" = [31/05, 30/06).
  //  • Rolantes / mês corrente / personalizado: follows termina no MÁXIMO em ontem 00:00 — exclui o
  //    último dia (ontem) ainda assentando; o início fica igual ao engajamento.
  //  • HOJE / 1D: janela CRUA (sem cortar ontem) — o follows desses intervalos é tratado no card com o
  //    LÍQUIDO por delta da contagem total + selo "consolidando" (a quebra seguiu/deixou da Meta ainda assenta).
  const folCap = menos1(hoje00)
  const capFol = (u) => new Date(Math.min(u.getTime(), folCap.getTime()))
  const ehLastmonth = period === 'lastmonth'
  const ehRecente = period === 0 || period === 1
  // ⚠️ O PERSONALIZADO NÃO SOFRE O CORTE DE `capFol`. O corte existe para os
  // ROLANTES, onde o último dia é sempre "ontem, ainda assentando" — mas num
  // intervalo FECHADO o dono escolheu as datas e tem de receber aquelas datas.
  // Sem esta exceção, filtrar 5 a 9 mostrava três dias e parava no 7 (09/09/2026).
  // Dia sem número da Meta aparece como estimativa marcada, que é o certo — some
  // do gráfico é que não pode.
  const ehCustom = !!(customStart && customEnd)
  const folS = ehLastmonth ? menos1(engS) : engS
  const folU = ehLastmonth ? menos1(engU) : ((ehRecente || ehCustom) ? engU : capFol(engU))
  const folSp = ehLastmonth ? menos1(engSp) : engSp
  const folUp = ehLastmonth ? menos1(engUp) : engUp
  return {
    engSince: TS(engS), engUntil: TS(engU),
    folSince: TS(folS), folUntil: TS(folU),
    prevEngSince: TS(engSp), prevEngUntil: TS(engUp),
    prevFolSince: TS(folSp), prevFolUntil: TS(folUp),
    folShift: ehLastmonth,
  }
}

// ══ TRAVA DE SEGURANÇA DAS JANELAS ══════════════════════════════════════════
// VALE PARA TODOS OS PERFIS: `janelasDoPeriodo` é genérica (só depende do período + data de hoje,
// NÃO recebe conta/perfil) — a mesma janela vai pro insights-ao-vivo de cada perfil. Logo esta trava
// protege os 7 perfis de uma vez. REGRA: qualquer ajuste na lógica de janela/engajamento é SEMPRE
// compartilhado por todos — nunca fazer gambiarra por perfil (senão quebra a paridade).
// CAMADA EXTRA DE DECISÃO: os intervalos abaixo (engajamento E novos seguidores) estão
// CONGELADOS numa referência validada com o painel profissional do Breno (07/07/2026).
// Se `janelasDoPeriodo` for mexida e QUALQUER janela deixar de cair EXATAMENTE nestes
// valores, `verificarTravaJanelas()` (chamada no onMounted) dispara um erro vermelho no
// console apontando o período e o que mudou. É o freio pra não quebrar os dados sem querer.
//   Cada linha: eng = janela do ENGAJAMENTO (curtidas/alcance/interações); fol = janela dos FOLLOWS (novos seguidores).
//   PARA MUDAR DE VERDADE: pegar os números exatos do Breno, revalidar na tela, e SÓ ENTÃO
//   atualizar esta referência junto — nunca mexer na lógica sem atualizar a trava.
const _TRAVA_JANELAS = [
  { period: 0,           eS: '2026-07-07', eU: '2026-07-07', fS: '2026-07-07', fU: '2026-07-07' }, // HOJE (crua, sem corte)
  { period: 1,           eS: '2026-07-06', eU: '2026-07-07', fS: '2026-07-06', fU: '2026-07-07' }, // 1D   (crua, sem corte)
  { period: 3,           eS: '2026-07-04', eU: '2026-07-07', fS: '2026-07-04', fU: '2026-07-06' }, // 3D
  { period: 7,           eS: '2026-06-30', eU: '2026-07-07', fS: '2026-06-30', fU: '2026-07-06' }, // 7D  → novos 319/130
  { period: 14,          eS: '2026-06-23', eU: '2026-07-07', fS: '2026-06-23', fU: '2026-07-06' }, // 14D → novos 638/262
  { period: 30,          eS: '2026-06-07', eU: '2026-07-07', fS: '2026-06-07', fU: '2026-07-06' }, // 30D → novos 1295/580
  { period: 'monthfull', eS: '2026-07-01', eU: '2026-07-07', fS: '2026-07-01', fU: '2026-07-06' }, // MÊS (corrente até ontem)
  { period: 'lastmonth', eS: '2026-06-01', eU: '2026-07-01', fS: '2026-05-31', fU: '2026-06-30' }, // MÊS PASS → novos 1281/571
  // ⚠️ PERSONALIZADO: recebe EXATAMENTE os dias escolhidos, sem o corte de ontem.
  // Filtrar 5 a 9 e ver três dias até o 7 foi defeito real (09/09/2026).
  { period: 7, cS: '2026-07-01', cE: '2026-07-04', eS: '2026-07-01', eU: '2026-07-05', fS: '2026-07-01', fU: '2026-07-05' },
]
function verificarTravaJanelas() {
  const ref = new Date('2026-07-07T12:00:00-03:00')
  const dstr = (ts) => new Date(Number(ts) * 1000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
  const falhas = []
  for (const t of _TRAVA_JANELAS) {
    const j = janelasDoPeriodo(t.period, ref, t.cS || null, t.cE || null)
    if (dstr(j.engSince) !== t.eS || dstr(j.engUntil) !== t.eU) {
      falhas.push(`  • ${t.period} · ENGAJAMENTO: esperado [${t.eS} → ${t.eU}], veio [${dstr(j.engSince)} → ${dstr(j.engUntil)}]`)
    }
    if (dstr(j.folSince) !== t.fS || dstr(j.folUntil) !== t.fU) {
      falhas.push(`  • ${t.period} · NOVOS SEGUIDORES: esperado [${t.fS} → ${t.fU}], veio [${dstr(j.folSince)} → ${dstr(j.folUntil)}]`)
    }
  }
  if (falhas.length) {
    console.error('%c🔒⚠️ TRAVA DAS JANELAS DISPAROU — a lógica de intervalo (engajamento e/ou novos seguidores) mudou e NÃO bate mais com o painel profissional:\n' + falhas.join('\n') + '\n→ Reverta janelasDoPeriodo OU revalide com os números exatos do Breno E atualize a referência da trava antes de subir.', 'color:var(--red);font-weight:bold;font-size:max(9px, calc(13px * var(--escala-texto, 1)))')
    return false
  }
  return true
}
// KPIs AO VIVO (exatos da Meta) via edge function insights-ao-vivo. Token fica no servidor.
// Cache leve por (conta+período) por 3min; null se a Meta falhar (a tela cai no coletado).
const _kpiCache = {}
async function buscarKpisAoVivo(accountId, period, customStart, customEnd, campanhas) {
  // `campanhas` = o recorte de balde+filtro. Lista VAZIA é o caminho de sempre:
  // a edge soma level=account, que é o número exato e mais barato da conta.
  const ids = (campanhas || []).map(String)
  // Os ids entram na CHAVE DO CACHE, não só no corpo: sem isso, trocar de balde
  // devolveria o número do balde anterior por até 3 minutos. A lista inteira e
  // ordenada (não o tamanho dela) — dois baldes de mesmo tamanho colidiriam.
  const chave = accountId + '|' + String(period) + '|' + (customStart || '') + '|' + (customEnd || '') + '|' + ids.slice().sort().join(',')
  const agora = Date.now()
  if (_kpiCache[chave] && (agora - _kpiCache[chave].t) < 180000) return _kpiCache[chave].v
  try {
    const jan = janelasDoPeriodo(period, new Date(), customStart, customEnd)
    const { data, error } = await sbClient.functions.invoke('insights-ao-vivo', { body: { account_id: accountId, ...jan, campanhas: ids } })
    if (error || !data || data.meta_erro || data.followers_count == null) return null
    _kpiCache[chave] = { t: agora, v: data }
    return data
  } catch (e) { return null }
}
// Contagem de COLLABS (posts/reels em parceria que não vêm no /media do perfil). Varre os outros perfis RBV. Cache 3min.
const _collabCache = {}
async function buscarCollabs(accountId, period, customStart, customEnd) {
  const chave = accountId + '|col|' + String(period) + '|' + (customStart || '') + '|' + (customEnd || '')
  const agora = Date.now()
  if (_collabCache[chave] && (agora - _collabCache[chave].t) < 180000) return _collabCache[chave].v
  try {
    const jan = janelasDoPeriodo(period, new Date(), customStart, customEnd)
    const d = ts => new Date(Number(ts) * 1000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
    const { data, error } = await sbClient.functions.invoke('contar-collabs', { body: { account_id: accountId, since: d(jan.engSince), until: d(Number(jan.engUntil) - 86400) } })
    if (error || !data || data.erro) return null
    _collabCache[chave] = { t: agora, v: data }
    return data // { posts, reels }
  } catch (e) { return null }
}
// Série DIÁRIA exata de novos seguidores (para o gráfico bater com o painel). Cada dia = follows numa janela
// de 1 dia deslocada -1 dia (mesmo offset do agregado). Batch via edge serie-novos-dia. Cache 3min.
const _serieCache = {}
async function buscarSerieNovos(accountId, period, customStart, customEnd, shiftMonths = 0) {
  const chave = accountId + '|serie|' + String(period) + '|' + (customStart || '') + '|' + (customEnd || '') + '|m' + shiftMonths
  const agora = Date.now()
  if (_serieCache[chave] && (agora - _serieCache[chave].t) < 180000) return _serieCache[chave].v
  try {
    const jan = janelasDoPeriodo(period, new Date(), customStart, customEnd)
    // Barras do gráfico (cada barra = follows REAL do próprio dia, janela direta):
    //  • MÊS PASSADO: os dias do mês CALENDÁRIO (ex.: junho 01→30). O rótulo bate com o valor do dia.
    //  • Demais (rolantes/mês corrente/custom): dias de folSince→folUntil (exclui o último dia assentando).
    // Obs.: no mês passado a SOMA das barras pode diferir levemente do card, pois o card usa o agregado
    // da Meta (bucketizado -1 dia), enquanto as barras mostram o valor real de cada dia — mesmo comportamento do painel profissional.
    const DIA = 86400, dias = []
    // ⚠️ AS BARRAS FICAM NO DIA REAL, E A SOMA DELAS NÃO FECHA COM O CARD.
    //
    // Isto foi tentado ao contrário em 09/09/2026 e o dono derrubou: com as barras
    // na régua deslocada, a barra "9" carregava o dia 8 (443) enquanto o filtro
    // "hoje" mostrava 326 para o mesmo dia 9. O MESMO DIA com dois números.
    //
    // ⚠️ E O PRÓPRIO PAINEL DO INSTAGRAM NÃO FECHA COM ELE MESMO. Medido pelo dono:
    // filtrando 5 a 8 ele dá total 951 e o gráfico dele vai só até o dia 7. O total
    // é deslocado, as barras são do dia real — as duas coisas ao mesmo tempo.
    // Copiar o painel fielmente É ter essa diferença; escondê-la seria inventar
    // uma coerência que a fonte não tem. Quem explica é a nota sob o gráfico.
    const upTo = jan.folShift ? Number(jan.engUntil) : Number(jan.folUntil)
    for (let d = Number(jan.engSince); d < upTo; d += DIA) {
      let iso, ds = d // shiftMonths: mesmo dia N meses atrás (comparativo do mês anterior)
      if (shiftMonths) {
        const dt = new Date(d * 1000); dt.setMonth(dt.getMonth() - shiftMonths)
        iso = dt.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
        ds = Math.floor(new Date(iso + 'T00:00:00-03:00').getTime() / 1000)
      } else {
        iso = new Date(d * 1000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
      }
      // Cada barra = follows do PRÓPRIO dia (janela direta [dia 00:00, dia+1 00:00)) — o rótulo bate com o valor.
      dias.push({ label: iso, since: ds, until: ds + DIA })
    }
    if (!dias.length || dias.length > 93) return null // janela vazia ou muito longa → mantém coletado
    const { data, error } = await sbClient.functions.invoke('serie-novos-dia', { body: { account_id: accountId, dias } })
    if (error || !data || !Array.isArray(data.serie) || !data.serie.length) return null
    _serieCache[chave] = { t: agora, v: data.serie }
    return data.serie
  } catch (e) { return null }
}
// salva a meta no período editado, RECALCULA proporcional em todos os outros intervalos,
// grava no localStorage (instantâneo) E no Supabase (compartilhado entre usuários).
function saveGoal(key, val) {
  const num = parseFloat(String(val).replace(',', '.')); if (isNaN(num)) return
  const anchor = currentPeriod === 0 ? 1 : currentPeriod
  const rows = [[anchor, num]]
  if (ehMetaDeTaxa(key)) { // taxa (ex.: custo por seguidor) — mesmo valor em todo período
    PERIODS.forEach(P => { const p = P.value === 0 ? 1 : P.value; if (p !== anchor) rows.push([p, num]) })
  } else {
    const aDays = periodDays(anchor)
    if (aDays) PERIODS.forEach(P => { const p = P.value === 0 ? 1 : P.value; if (p === anchor) return; const d = periodDays(p); if (!d) return; rows.push([p, Math.max(1, Math.round(num * d / aDays))]) }) // 'sofar' mantém meta própria
  }
  const seen = {}, final = []
  for (const r of rows) { const pk = String(r[0]); if (seen[pk]) continue; seen[pk] = 1; final.push(r); localStorage.setItem(goalStorageKey(key, r[0], currentAccountId), String(r[1])) }
  _metasUpsert(key, final)
}
function _metasUpsert(key, rows) {
  if (!currentAccountId || typeof sbClient === 'undefined' || !sbClient) return
  const payload = rows.map(r => ({ account_id: String(currentAccountId), periodo: String(r[0]), indicador: key, valor: r[1] }))
  try { sbClient.from('social_metas').upsert(payload, { onConflict: 'account_id,periodo,indicador' }).then(res => { if (res && res.error) console.warn('meta upsert:', res.error.message) }).catch(() => {}) } catch (e) {}
}
async function metasFetchAll(accountId) {
  if (!accountId || typeof sbClient === 'undefined' || !sbClient) return
  try {
    const { data, error } = await sbClient.from('social_metas').select('periodo,indicador,valor').eq('account_id', String(accountId))
    if (error || !data) return
    data.forEach(r => localStorage.setItem(goalStorageKey(r.indicador, r.periodo, accountId), String(r.valor)))
    updateGoalDisplays(currentPeriod)
  } catch (e) {}
}
function loadGoal(key, period, accountId) {
  const pk = period === 0 ? 1 : period
  const s = localStorage.getItem(goalStorageKey(key, pk, accountId))
  if (s !== null && s !== '' && s !== 'NaN') return s                       // valor salvo (ignora corrupção antiga)
  const base = GOALS[key]; if (!base) return '0'
  if (base[pk] != null) return String(base[pk])                     // default exato do período
  if (ehMetaDeTaxa(key)) return String(base[7] ?? base[30] ?? 0)
  const refP = base[30] != null ? 30 : (base[7] != null ? 7 : 1)              // default escalado a partir do 30/7
  const d = periodDays(pk), rd = periodDays(refP)
  if (!d || !rd) return String(base[refP] ?? base[7] ?? 0)
  return String(Math.max(1, Math.round((base[refP] || 0) * d / rd)))
}
function getGoal(key) { const el = document.getElementById('goal-' + key); const v = el ? parseFloat(String(el.textContent).replace(',', '.')) : NaN; return isFinite(v) ? v : (parseFloat(loadGoal(key, currentPeriod, currentAccountId)) || 0) }
// A meta que o dono REALMENTE definiu para este indicador, como número — ou null.
//
// `loadGoal` devolve '0' quando não existe valor salvo NEM padrão em GOALS, e um 0
// na tela seria um alvo que ninguém pôs. Os indicadores que só aparecem nos baldes
// novos (custo por conversa, por cadastro, por venda, por visita, custo por mil
// impressões) NASCEM SEM META de propósito: o campo mostra "—", o cartão não tem
// barra nem nota, e é assim até o dono digitar o número dele.
//
// Herdar a meta de outro indicador, ou inventar um padrão, é pior do que não ter:
// um alvo chutado igual para cinco contas já fez o semáforo desta casa responder
// "de quem é essa conta?" em vez de "essa campanha vai bem?".
function metaDefinida(key, period, accountId) {
  const pk = period === 0 ? 1 : period
  const salva = localStorage.getItem(goalStorageKey(key, pk, accountId))
  if (salva !== null && salva !== '' && salva !== 'NaN') {
    const v = parseFloat(String(salva).replace(',', '.'))
    return isFinite(v) ? v : null
  }
  if (!GOALS[key]) return null
  const v = parseFloat(loadGoal(key, period, accountId))
  return isFinite(v) ? v : null
}
// (Havia aqui um `getPrevLabel(period)` que ninguém chamava e que fazia a MESMA
// conta errada de "30 dias atrás" para qualquer período. Removido em 21/08/2026
// junto com o conserto do rótulo: função morta é armadilha esperando quem
// precisar de um rótulo e achar que ela serve.)

/* ── COMPARE ROW (legacy L3465-3482, verbatim) ── */
function setCompare(id, curr, prev, prefix, periodLabel, lowerIsBetter) {
  const el = document.getElementById(id); el.textContent = ''
  if (prev === null || prev === undefined) {
    const lbl = document.createElement('span'); lbl.className = 'mc-compare-label'
    lbl.style.fontStyle = 'italic'; lbl.textContent = 'Acumulando histórico...'
    el.appendChild(lbl); return
  }
  const lbl = document.createElement('span'); lbl.className = 'mc-compare-label'; lbl.textContent = 'vs ' + periodLabel
  const vals = document.createElement('div'); vals.className = 'mc-compare-vals'
  const prevEl = document.createElement('span'); prevEl.className = 'mc-compare-prev'
  prevEl.textContent = prefix ? fmtR(prev) : fmtN(prev)
  const d = curr - prev; const pct = prev > 0 ? ((d / prev) * 100) : 0; const isGood = lowerIsBetter ? (d <= 0) : (d >= 0)
  const deltaEl = document.createElement('span')
  deltaEl.className = 'mc-compare-delta ' + (isGood ? 'c-green' : 'c-red')
  const pctStr = prev > 0 ? ' (' + Math.abs(pct).toFixed(1) + '%)' : ''
  deltaEl.textContent = (d >= 0 ? '↑ +' : '↓ ') + (prefix ? fmtR(Math.abs(d)) : fmtN(Math.abs(d))) + pctStr
  vals.appendChild(prevEl); vals.appendChild(deltaEl); el.appendChild(lbl); el.appendChild(vals)
}

/* ── METRIC GOAL (legacy L3485-3514, verbatim) ── */
function applyMetric(key, curr, goal) {
  const pct = Math.min((curr / goal) * 100, 150); const clr = perfColor(pct); const diff = curr - goal
  _mcValColor(key, clr)
  setTimeout(() => { const p = document.getElementById('prog-' + key); p.style.width = Math.min(pct, 100) + '%'; p.className = 'mc-progress-fill bg-' + clr }, 80)
  document.getElementById('pct-' + key).textContent = Math.round(pct) + '%'
  document.getElementById('pct-' + key).className = 'mc-pct c-' + clr
  const diffEl = document.getElementById('diff-' + key)
  if (diff >= 0) { diffEl.textContent = '✓ +' + fmtN(diff) + ' acima da meta'; diffEl.className = 'mc-diff c-green' }
  else { diffEl.textContent = '↓ ' + fmtN(Math.abs(diff)) + ' abaixo da meta'; diffEl.className = 'mc-diff c-' + clr }
}
// Igual ao applyMetric, mas SEM o veredito: mostra o progresso e cala a nota.
//
// Existe porque o dia em consolidação tem um número parcial. Mostrar a barra ajuda
// (dá noção de onde está); pintar de vermelho e escrever "270 abaixo da meta" não —
// isso é uma conclusão, e o Instagram ainda não fechou o dado pra concluir. No fim
// do dia o número fecha e o applyMetric normal volta a valer.
// Usa 'orange' (que existe em _PERF_VAR e no estilos-globais como c-orange/bg-orange).
// NÃO existe 'amber' na paleta — c-amber/bg-amber seriam classes mortas, sem cor.
function aplicarMetaEmConsolidacao(key, curr, goal) {
  const pct = goal > 0 ? Math.min((curr / goal) * 100, 150) : 0
  setTimeout(() => {
    const p = document.getElementById('prog-' + key)
    if (p) { p.style.width = Math.min(pct, 100) + '%'; p.className = 'mc-progress-fill bg-orange' }
  }, 80)
  const pctEl = document.getElementById('pct-' + key)
  if (pctEl) { pctEl.textContent = Math.round(pct) + '%'; pctEl.className = 'mc-pct c-orange' }
  const diffEl = document.getElementById('diff-' + key)
  if (diffEl) {
    diffEl.textContent = 'parcial — a meta é medida quando o dia fechar'
    diffEl.className = 'mc-diff c-orange'
  }
}

function applyMetricInverse(key, curr, goal) {
  const pct = (goal / curr) * 100; const clr = perfColor(pct); const diff = curr - goal
  _mcValColor(key, clr)
  setTimeout(() => { const p = document.getElementById('prog-' + key); p.style.width = Math.min(pct, 100) + '%'; p.className = 'mc-progress-fill bg-' + clr }, 80)
  document.getElementById('pct-' + key).textContent = Math.round(pct) + '%'
  document.getElementById('pct-' + key).className = 'mc-pct c-' + clr
  const diffEl = document.getElementById('diff-' + key)
  if (diff <= 0) { diffEl.textContent = '✓ ' + fmtR(Math.abs(diff)) + ' abaixo da meta'; diffEl.className = 'mc-diff c-green' }
  else { diffEl.textContent = '↑ ' + fmtR(diff) + ' acima da meta'; diffEl.className = 'mc-diff c-' + clr }
}
function applySpend(curr, budget) {
  const pct = (curr / budget) * 100; const clr = pct <= 100 ? 'green' : pct <= 120 ? 'yellow' : 'red'; const rem = budget - curr
  _mcValColor('spend', clr)
  setTimeout(() => { const p = document.getElementById('prog-spend'); p.style.width = Math.min(pct, 100) + '%'; p.className = 'mc-progress-fill bg-' + clr }, 80)
  document.getElementById('pct-spend').textContent = Math.round(pct) + '% do budget'
  document.getElementById('pct-spend').className = 'mc-pct c-' + clr
  const diffEl = document.getElementById('diff-spend')
  if (rem >= 0) { diffEl.textContent = fmtR(rem) + ' ainda disponível'; diffEl.className = 'mc-diff c-green' }
  else { diffEl.textContent = fmtR(Math.abs(rem)) + ' acima do budget'; diffEl.className = 'mc-diff c-red' }
}

/* ── SECTION CHIPS (legacy L3517-3520, verbatim) ── */
// Aceita texto solto (o caso de sempre) OU { texto, classe } para o chip que
// precisa de um tratamento próprio — hoje, o aviso que pode passar de uma linha.
// O .sec-chip normal é `nowrap` porque carrega número curto; um aviso em nowrap
// sairia cortado no celular, e texto cortado é justamente o que não pode.
function setChips(id, chips) {
  const wrap = document.getElementById(id); if (!wrap) return; wrap.textContent = ''
  chips.forEach(item => {
    const ehObj = item && typeof item === 'object'
    const c = document.createElement('div')
    c.className = 'sec-chip' + (ehObj && item.classe ? ' ' + item.classe : '')
    c.textContent = ehObj ? item.texto : item
    wrap.appendChild(c)
  })
}

/* ── CHART (legacy L3523-3596, verbatim) ── */
function _polylineLength(pts) {
  const pairs = pts.trim().split(' ').map(p => p.split(',').map(Number))
  let len = 0
  for (let i = 1; i < pairs.length; i++) { const dx = pairs[i][0] - pairs[i - 1][0], dy = pairs[i][1] - pairs[i - 1][1]; len += Math.sqrt(dx * dx + dy * dy) }
  return len
}
function _animateChartLine(el, pts) {
  const len = _polylineLength(pts)
  el.style.strokeDasharray = len; el.style.strokeDashoffset = len
  el.style.transition = 'none'; void el.getBoundingClientRect()
  el.style.transition = 'stroke-dashoffset .9s cubic-bezier(.22,1,.36,1)'
  el.style.strokeDashoffset = '0'
}
// A nota embaixo do gráfico de novos seguidores por dia.
//
// DOIS PÚBLICOS, DE PROPÓSITO:
//   • TODO MUNDO vê que as barras marcadas com ≈ são estimativa. Esconder isso de
//     quem não é super-admin recriaria exatamente o defeito que estamos
//     consertando — número calculado por nós passando por número do Instagram.
//   • SÓ O SUPER-ADMIN vê a explicação técnica (desde quando, quantos dias, que a
//     falta é da Meta). Para quem só usa o painel isso é ruído; para quem cuida
//     do sistema é o aviso de que tem coisa parada.
function montarNotaDeEstimativa(semPublicacao, diag) {
  const el = document.getElementById('nota-estimativa')
  if (!el) return
  const dias = semPublicacao || []
  // ⚠️ O DIAGNÓSTICO APARECE MESMO SEM DIA FALTANDO — é ele que diz de onde os
  // números saíram, e é justamente quando "está tudo certo" que ele é preciso.
  // ⚠️ NÃO SÓ SUPER-ADMIN. A primeira versão disto ficou invisível justamente para
  // quem precisava dela: o dono abriu a tela, tirou o print, e o diagnóstico não
  // estava lá porque a conta dele não é super-admin. Agora `?diag=1` no endereço
  // liga para qualquer um que já tenha acesso à tela.
  // O sinal é capturado no boot (ponto-de-partida.js) porque o roteador apaga a
  // query ao navegar. Aqui só se lê o que ficou guardado — ou a query, se a
  // pessoa abriu direto nesta tela.
  let _querDiag = false
  try {
    _querDiag = localStorage.getItem('rbv_diag') === '1'
      || new URLSearchParams(window.location.search).get('diag') === '1'
  } catch (e) {}
  const _diagHtml = (diag && (estado.is_superadmin || _querDiag))
    ? `<div class="nota-est-tec">🔧 recorte: ${escHtml(diag.ehCustom ? 'PERSONALIZADO' : 'período ' + diag.periodo)}`
      + ` · janela ${escHtml(diag.follow)} (${diag.effectivePeriod} dia(s))`
      + ` · seguidores: ${escHtml(diag.fonteSeguidores || '?')}`
      + ` · ads: period_days=${diag.adsPd}, ${diag.adsDias} dia(s), ${diag.adsLinhas} linha(s)`
      + ` · snapshot de engajamento: ${diag.storedPeriod}d · ao vivo: ${diag.aoVivo ? 'sim' : 'NÃO'}</div>`
    : ''
  if (!dias.length) {
    el.innerHTML = _diagHtml
    el.hidden = !_diagHtml
    return
  }
  // Só datas YYYY-MM-DD entram. Este texto vai por innerHTML e o rótulo do dia dá
  // uma volta pela Edge Function antes de chegar aqui — nada que não seja data
  // passa, e o resto do texto é fixo, escrito neste arquivo.
  const soData = iso => (/^\d{4}-\d{2}-\d{2}$/.test(String(iso)) ? String(iso) : null)
  const ordenados = dias.map(soData).filter(Boolean).sort()
  if (!ordenados.length) { el.hidden = true; el.innerHTML = ''; return }
  const fmt = iso => iso.slice(8, 10) + '/' + iso.slice(5, 7)
  const desde = fmt(ordenados[0])
  const plural = ordenados.length === 1 ? 'dia' : 'dias'
  let html = `<span class="nota-est-marca">≈</span> <b>${ordenados.length} ${plural}</b> com número estimado pela variação do total de seguidores — o Instagram ainda não divulgou quantas pessoas seguiram e quantas saíram nesses dias. O saldo está certo; a divisão entre "seguiram" e "deixaram" é que não existe ainda.`
  if (estado.is_superadmin) {
    html += `<div class="nota-est-tec">🔧 O Instagram não publica <code>follows_and_unfollows</code> desde ${desde}. A coleta está rodando normalmente e a contagem total continua chegando — a falta é do lado da Meta. Se ela voltar a publicar em até 14 dias, o coletor preenche esses dias sozinho; passando disso, o número se perde.</div>`
  }
  el.innerHTML = html + _diagHtml
  el.hidden = false
}

/* Põe no trilho a largura do desenho e as duas tiras vazias das beiradas.
   As tiras ficam aqui, e não no CSS, para não haver dois lugares dizendo o mesmo
   número: quem manda são as constantes de largura-do-grafico.js, que é onde está
   escrito POR QUE elas existem. */
function vestirOTrilho(trilho, medida) {
  if (!trilho) return
  if (medida.rola) {
    trilho.style.setProperty('--largura-do-grafico', medida.largura + 'px')
    trilho.style.paddingLeft = ESPACO_ANTES_DO_GRAFICO + 'px'
    trilho.style.paddingRight = ESPACO_DEPOIS_DO_GRAFICO + 'px'
  } else {
    // Cabendo, o trilho volta a ser fluido (100%) e sem tira nenhuma: o gráfico
    // acompanha o cartão sozinho, inclusive quando o aparelho gira, sem depender
    // de um novo desenho.
    trilho.style.removeProperty('--largura-do-grafico')
    trilho.style.paddingLeft = ''
    trilho.style.paddingRight = ''
  }
}

/* Mede o espaço que o cartão dá e aplica a régua dos 30px por dia nas três
   camadas do gráfico (ver o comentário do template, na seção 01).

   `caixaExterna` = a `.grafico-que-rola`; dentro dela vêm a `.rolagem-de-grafico`
   (a que rola) e o `.trilho-de-grafico` (o que fica largo).

   Devolve a medida, porque o desenho depende dela: com 30px por dia cabe número
   dentro da barra onde antes não cabia. */
function medirLarguraDoGrafico(caixaExterna, pontos) {
  const rolagem = caixaExterna ? caixaExterna.querySelector('.rolagem-de-grafico') : null
  const trilho = rolagem ? rolagem.querySelector('.trilho-de-grafico') : null
  // Medimos a CAIXA QUE ROLA, não o trilho: ela recorta o que passa, então a
  // largura dela é a largura VISÍVEL mesmo quando um desenho largo de uma
  // passada anterior ainda está lá dentro. Medir o trilho devolveria a largura
  // do desenho antigo, e o gráfico nunca mais voltaria a encolher.
  const medida = larguraDoGrafico({ pontos, larguraDisponivel: rolagem ? rolagem.clientWidth : 0 })
  if (caixaExterna) caixaExterna.classList.toggle('rolando', medida.rola)
  vestirOTrilho(trilho, medida)
  return medida
}

function buildChart(chartData) {
  // BARRAS EMPILHADAS por dia: VERDE (seguiu) embaixo + VERMELHO (deixou) em cima; LÍQUIDO rotulado no topo.
  let { gained, lost, labels, dates } = chartData
  const prevSeguiu = chartData.prevSeguiu, prevDeixou = chartData.prevDeixou, prevDates = chartData.prevDates
  const netOnly = chartData.netOnly || [] // dias "líquidos" (hoje/ontem): barra única, só o nº líquido (sem seguiu/deixou dentro)
  // Dias em que o Instagram NÃO publicou o número e a barra é ESTIMATIVA pela
  // variação da contagem total. Vão desenhados diferente (vazados, com contorno
  // tracejado) e o rótulo ganha "≈". Sem isso, estimativa e número real do
  // Instagram ficam iguais na tela — que é o defeito de origem.
  const estimado = chartData.estimado || []
  gained = (gained || []).slice(); lost = (lost || []).slice(); labels = (labels || []).slice(); dates = (dates || []).slice()
  if (gained.length === 0) { gained = [0]; lost = [0]; labels = labels.length ? labels : ['']; dates = dates.length ? dates : [''] }
  const n = gained.length
  // A régua dos 30px por dia. Ela mexe na LARGURA do desenho, não no viewBox:
  // este SVG tem preserveAspectRatio="none", então esticar a largura estica só na
  // horizontal (a altura continua presa em 150px pelo CSS) e os rótulos, que são
  // posicionados em PORCENTAGEM sobre a camada de números, acompanham de graça.
  const medidaDoGrafico = medirLarguraDoGrafico(document.getElementById('grafico-de-seguidores'), n)
  const net = gained.map((g, i) => g - (lost[i] || 0))
  const totals = gained.map((g, i) => g + (lost[i] || 0))
  // A meta é lida ANTES de fechar a moldura porque ela muda a moldura: quando
  // existe rótulo de meta, o topo do quadro vira faixa dele e de mais ninguém
  // (mesmo motivo do gráfico da seção 02 — ver o comentário do padTop de lá).
  const metaPeriodoDoGrafico = getGoal('followers')
  const metaDia = (metaPeriodoDoGrafico > 0 && n > 0) ? metaPeriodoDoGrafico / n : 0
  const W = 400, H = 110, padX = 8, padTop = metaDia > 0 ? 32 : 18, padBot = 4
  const maxTot = Math.max(...totals, 1)
  const chartH = H - padTop - padBot, baseY = H - padBot
  const hOf = v => (v / maxTot) * chartH
  const px = i => n > 1 ? padX + (i / (n - 1)) * (W - padX * 2) : W / 2
  const py = v => baseY - hOf(v)
  activeChartData = { gained, lost, net, labels, dates, px, py, W, H, yZero: baseY, n, prevSeguiu, prevDeixou, prevDates }
  // Elementos de linha/zero do gráfico antigo não são usados nas barras empilhadas.
  const zl = document.getElementById('chart-zero'); if (zl) zl.setAttribute('display', 'none')
  document.getElementById('chart-line').setAttribute('points', '')
  document.getElementById('chart-fill').setAttribute('d', '')
  document.getElementById('prev-line').setAttribute('points', '')
  const NS = 'http://www.w3.org/2000/svg'
  const bars = document.getElementById('chart-bars'); bars.textContent = ''
  const slot = (W - padX * 2) / Math.max(n, 1)
  const bw = Math.max(4, Math.min(slot * 0.6, 22))
  const _rect = (x, y, h, fill, rTop, est) => {
    const r = document.createElementNS(NS, 'rect')
    r.setAttribute('x', (x - bw / 2).toFixed(2)); r.setAttribute('y', y.toFixed(2))
    r.setAttribute('width', bw.toFixed(2)); r.setAttribute('height', Math.max(0, h).toFixed(2))
    r.setAttribute('rx', rTop ? '2' : '0'); r.setAttribute('fill', fill)
    if (est) { // estimativa: barra vazada com contorno tracejado, na mesma cor
      r.setAttribute('fill-opacity', '0.28')
      r.setAttribute('stroke', fill); r.setAttribute('stroke-width', '1'); r.setAttribute('stroke-dasharray', '2,1.5')
    }
    bars.appendChild(r)
  }
  for (let i = 0; i < n; i++) {
    const x = px(i), g = gained[i] || 0, l = lost[i] || 0, est = !!estimado[i]
    const gh = hOf(g), lh = hOf(l)
    if (g > 0) _rect(x, baseY - gh, gh, 'var(--green)', l === 0, est) // verde (seguiu) embaixo
    if (l > 0) _rect(x, baseY - gh - lh, lh, 'var(--red)', true, est) // vermelho (deixou) em cima
  }
  // Rótulos HTML SOBREPOSTOS (não distorcem como o <text> do SVG esticado): números dentro + líquido no topo.
  const labelsG = document.getElementById('chart-data-labels'); labelsG.textContent = ''
  const _lab = (xPx, yPx, text, cls) => { const s = document.createElement('span'); s.className = cls; s.textContent = text; s.style.left = ((xPx / W) * 100) + '%'; s.style.top = ((yPx / H) * 100) + '%'; labelsG.appendChild(s); return s }
  // Número DENTRO da barra (quantos seguiram / quantos saíram). A regra sempre foi
  // de espaço, escrita em contagem de dias: até 14 dias cabia, daí em diante não.
  // Rolando, cada dia tem 30px garantidos — mais do que os ~22px que os 14 dias
  // tinham no celular — então o número volta a caber e não há por que escondê-lo.
  // A conta por dias fica de pé para quem NÃO rola (o computador), que continua
  // exatamente como está hoje.
  const showInside = n <= 14 || medidaDoGrafico.rola
  for (let i = 0; i < n; i++) {
    const x = px(i), g = gained[i] || 0, l = lost[i] || 0
    const gh = hOf(g), lh = hOf(l)
    if (showInside && !netOnly[i]) { // barra líquida (hoje/ontem) não mostra número dentro — só o líquido no topo.
      if (g > 0 && gh >= 12) { const s = _lab(x, baseY - gh / 2, String(g), 'cdl-in'); s.style.transform = 'translate(-50%, -50%)' }
      if (l > 0 && lh >= 12) { const s = _lab(x, baseY - gh - lh / 2, String(l), 'cdl-in'); s.style.transform = 'translate(-50%, -50%)' }
    }
    const v = net[i], topY = baseY - hOf(totals[i])
    // "≈" na frente = este número é ESTIMATIVA (variação da contagem), não o
    // número que o Instagram publicou. Um sinal, não um texto: cabe no gráfico
    // apertado e o significado fica escrito por extenso na nota abaixo dele.
    const marca = estimado[i] ? '≈' : ''
    const s = _lab(x, topY, marca + (v > 0 ? '+' : '') + fmtN(v), 'cdl' + (n > 12 ? ' cdl-sm' : '') + (estimado[i] ? ' cdl-est' : '') + (v > 0 ? ' cdl-up' : v < 0 ? ' cdl-down' : ''))
    s.style.transform = 'translate(-50%, -118%)'
  }
  const xlWrap = document.getElementById('chart-xlabels'); xlWrap.textContent = ''
  const step = Math.max(1, Math.floor(n / 7))
  labels.forEach((l, i) => {
    if (i % step !== 0 && i !== n - 1) return
    const s = document.createElement('span'); s.className = 'x-label'; s.textContent = l
    s.style.left = (((px(i) - padX) / (W - padX * 2)) * 100) + '%'
    xlWrap.appendChild(s)
  })
  // ── Linha de META de seguidores/dia (referência discreta) ──
  // A meta é a MESMA do card de seguidores (getGoal('followers') = meta do período),
  // virada em meta POR DIA dividindo pelos dias mostrados no gráfico. Não existe meta
  // diária separada no banco, então usamos meta-do-período ÷ dias (genérico, sem regra
  // por perfil). Desenhamos na escala das barras; se a meta/dia passar do dia mais alto,
  // a linha encosta no topo (clamp) pra nunca sumir do quadro.
  const metaEl = document.getElementById('chart-meta')
  if (metaEl) {
    if (metaDia > 0) {
      const my = py(Math.min(metaDia, maxTot))
      metaEl.setAttribute('y1', my.toFixed(2)); metaEl.setAttribute('y2', my.toFixed(2))
      metaEl.removeAttribute('display')
      // O RÓTULO DA META MORA NO CANTO DE CIMA, À ESQUERDA — e essa faixa é dele
      // sozinho (o padTop lá em cima foi aberto para isso).
      //
      // Antes ele ficava na direita, na altura da linha: em cima do ÚLTIMO dia,
      // que é sempre rotulado ("+22" por cima de "Meta 69/dia" foi um dos pares
      // medidos). Só trocar de lado NÃO resolve — medido a 375px, ele passou a
      // bater no PRIMEIRO dia ("+28" × "Meta 69/dia"). O que resolve é tirá-lo
      // da faixa onde moram os números dos dias.
      const lab = _lab(0, 0, 'Meta ' + fmtN(Math.round(metaDia)) + '/dia', 'cdl-meta')
      lab.style.transform = 'translate(0, 0)'
    } else metaEl.setAttribute('display', 'none')
  }
}

/* ── GRÁFICOS DIÁRIOS DA SEÇÃO 02 · META ADS ──
   Barras = o valor de cada dia · linha tracejada = a meta daquele dia.
   SVG puro no mesmo estilo do buildChart acima — sem biblioteca externa, sem CDN.
   Aqui o SVG escala uniforme (sem preserveAspectRatio="none"), então o texto pode ficar
   dentro do próprio SVG: não estica nem distorce como no gráfico de seguidores.
   Genérico: os dois gráficos usam ESTA função, sem nenhuma regra por perfil. */
/* Quanto um <text> de SVG mede DE VERDADE, em unidades do desenho.
   Estimar por número de caracteres não serve: "R$ 92,86" é mais largo que
   "R$ 17,34" com os mesmos 8 caracteres, porque o "1" é estreito. Foi por uma
   estimativa assim que um rótulo escapou do quadro sem ninguém ver.
   Devolve 0 quando não dá para medir (elemento fora da tela, sem renderização) —
   e aí quem chamou mantém o desenho de sempre em vez de arriscar. */
function medidaDeTexto(no) {
  try { return no.getComputedTextLength() } catch (e) { return 0 }
}
/* A caixa que o texto ocupa, nos dois eixos, em unidades do desenho. Null quando
   não dá para medir. */
function caixaDeTexto(no) {
  try {
    const b = no.getBBox()
    if (!b || !(b.width > 0)) return null
    return { x0: b.x, x1: b.x + b.width, y0: b.y, y1: b.y + b.height }
  } catch (e) { return null }
}
function _gmadDiaCurto(iso) { const p = String(iso).split('-'); return p.length === 3 ? Number(p[2]) + '/' + Number(p[1]) : String(iso) }
const _GMAD_MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
function _gmadDiaLongo(iso) { const d = new Date(iso + 'T12:00:00'); return isNaN(d.getTime()) ? String(iso) : d.getDate() + ' ' + _GMAD_MESES[d.getMonth()] }
function desenharGraficoDiario(hostId, serie, opcoes) {
  const host = document.getElementById(hostId); if (!host) return
  host.textContent = ''
  const titulo = document.createElement('div'); titulo.className = 'gmad-titulo'; titulo.textContent = opcoes.titulo
  host.appendChild(titulo)
  const pontos = (serie && serie.pontos) || []
  // QUANTOS DIAS COM NÚMERO JÁ VALEM UM GRÁFICO. O padrão é 1 (um dia medido é um
  // dado, e o período "Hoje" tem um só) — é o que os gráficos de investimento e de
  // custo por seguidor sempre fizeram. Os custos por resultado pedem 2: um ponto
  // solto não mostra tendência nenhuma e ainda ocupa a altura inteira de um
  // gráfico fingindo que mostra. Quem manda é `valeDesenharOGrafico`, que é puro e
  // testado — a tela não tem regra própria sobre isso.
  if (!valeDesenharOGrafico(serie, opcoes.minimoDeDias || 1, { exigirInvestimento: !!opcoes.exigirInvestimento })) {
    const v = document.createElement('div'); v.className = 'gmad-vazio'; v.textContent = opcoes.textoVazio
    host.appendChild(v); return
  }
  const NS = 'http://www.w3.org/2000/svg'
  const el = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, String(attrs[k])); return e }
  const comTitulo = (node, texto) => { const t = document.createElementNS(NS, 'title'); t.textContent = texto; node.appendChild(t); return node }
  // ── A régua dos 30px por dia (largura-do-grafico.js) ──
  // AQUI A LARGURA NÃO PODE SER SÓ ESTICADA. Este SVG escala UNIFORME (não tem
  // preserveAspectRatio="none"): alargar o desenho mantendo o viewBox em 400
  // esticaria a ALTURA junto e o gráfico viraria um paredão. Então a largura
  // entra no próprio viewBox — o desenho passa a ser feito em `W` unidades, que
  // é exatamente o número de pixels na tela, na escala 1:1.
  //
  // Não cabendo rolagem (computador, período curto), `W` continua 400 e o SVG
  // continua em width:100% — pixel a pixel o que está no ar hoje.
  const medida = larguraDoGrafico({ pontos: pontos.length, larguraDisponivel: host.clientWidth })
  const caixaQueRola = document.createElement('div')
  caixaQueRola.className = 'grafico-que-rola' + (medida.rola ? ' rolando' : '')
  const rolagem = document.createElement('div'); rolagem.className = 'rolagem-de-grafico'
  const trilho = document.createElement('div'); trilho.className = 'trilho-de-grafico'
  vestirOTrilho(trilho, medida)
  rolagem.appendChild(trilho); caixaQueRola.appendChild(rolagem)
  const W = medida.rola ? medida.largura : 400
  const meta = serie.meta > 0 ? serie.meta : 0
  // A FAIXA DE CIMA É DO RÓTULO DA META, E DE MAIS NINGUÉM.
  // Só mudar o rótulo de lado (direita → esquerda) NÃO resolveu: medido a 375px,
  // "Meta do dia R$ 20,00" continuou por cima de "R$ 17,34", agora do primeiro
  // dia em vez do último. A tarja é opaca e desenhada por último, então ela
  // ESCONDIA o valor — e esconder número é pior que amontoar. Reservando 28 em
  // vez de 14 no topo, o valor mais alto possível fica embaixo da faixa e a
  // sobreposição deixa de existir por construção, não por sorte de dado.
  // Sem meta não há rótulo, e aí não há por que encurtar as barras.
  const H = 136, padX = 10, padTop = meta > 0 ? 28 : 14, padBot = 24
  const valores = pontos.filter(p => !p.semDado).map(p => p.valor)
  // A meta entra na escala pra linha NUNCA sair do gráfico (uma linha invisível mentiria).
  const maxVal = Math.max(...valores, meta, 0.01)
  const n = pontos.length
  const chartH = H - padTop - padBot, baseY = H - padBot
  const hOf = v => (Math.max(0, v) / maxVal) * chartH
  const px = i => n > 1 ? padX + (i / (n - 1)) * (W - padX * 2) : W / 2
  // `gmad-rola` só existe quando o gráfico rola, e serve para uma coisa: os
  // valores em reais ficarem em 11px. Eles estão em 9px hoje porque não havia
  // espaço; com a rolagem há, e 9px era o menor tamanho que ainda se lê. Sem a
  // classe, o computador ganharia letra maior sem precisar — e letra maior no
  // mesmo espaço é sobreposição de volta.
  const svg = el('svg', { class: 'gmad-svg' + (medida.rola ? ' gmad-rola' : ''), viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': opcoes.titulo })
  // O SVG ENTRA NA TELA ANTES DE SER DESENHADO, de propósito: texto de SVG só
  // pode ser MEDIDO depois de renderizado, e os rótulos precisam ser medidos para
  // não saírem do quadro nem se sobreporem (ver o bloco dos rótulos, abaixo).
  trilho.appendChild(svg)
  host.appendChild(caixaQueRola)
  // linha de base
  svg.appendChild(el('line', { class: 'gmad-base', x1: padX, x2: W - padX, y1: baseY, y2: baseY }))
  const slot = (W - padX * 2) / Math.max(n, 1)
  const bw = Math.max(3, Math.min(slot * 0.6, 22))
  for (let i = 0; i < n; i++) {
    const p = pontos[i], x = px(i)
    if (p.semDado) {
      // Buraco honesto: dia sem número não vira barra zerada (isso seria mentira).
      const marca = el('rect', { class: 'gmad-buraco', x: (x - bw / 2).toFixed(2), y: (baseY - 3).toFixed(2), width: bw.toFixed(2), height: 3, rx: 1 })
      svg.appendChild(comTitulo(marca, _gmadDiaLongo(p.data) + ' · ' + (opcoes.textoSemDado[p.motivo] || 'sem informação neste dia')))
      continue
    }
    const h = hOf(p.valor)
    const acima = meta > 0 && p.valor > meta
    const r = el('rect', { class: 'gmad-barra' + (acima ? ' gmad-barra-acima' : ''), x: (x - bw / 2).toFixed(2), y: (baseY - h).toFixed(2), width: bw.toFixed(2), height: Math.max(1, h).toFixed(2), rx: 2 })
    svg.appendChild(comTitulo(r, _gmadDiaLongo(p.data) + ' · ' + opcoes.rotuloValor + ': ' + fmtR(p.valor) + (meta > 0 ? ' · ' + opcoes.rotuloMeta + ': ' + fmtR(meta) : '')))
  }
  // ── Rótulo de dados: o valor (R$) em cima de cada barra ──
  // Quando o período é longo, muitos rótulos de moeda viram sujeira; então mostramos
  // SALTEADO (no máx. ~10 no gráfico) e garantimos SEMPRE o dia mais alto e o último dia.
  // Sem regra por perfil: vale pros dois gráficos que usam esta função.
  //
  // O SALTEADO SOZINHO NÃO BASTA, e isto foi medido na tela logada: um dia SEM
  // DADO encurta a lista de dias com número, o passo passa a cair no vizinho do
  // último, e o último é rotulado de qualquer jeito — dois rótulos a um dia de
  // distância, medindo mais de um dia de largura cada. Foi assim que nasceram
  // "R$ 20,41" × "R$ 26,40". Por isso, depois de desenhados, os rótulos são
  // MEDIDOS no navegador e quem ainda assim se tocaria sai.
  const idxComDado = pontos.map((p, i) => (p.semDado ? -1 : i)).filter(i => i >= 0)
  if (idxComDado.length) {
    const passoRot = Math.max(1, Math.ceil(idxComDado.length / 10))
    let idxTopo = idxComDado[0]
    idxComDado.forEach(i => { if (pontos[i].valor > pontos[idxTopo].valor) idxTopo = i })
    const ultimoComDado = idxComDado[idxComDado.length - 1]
    const candidatos = []
    idxComDado.forEach((i, ordem) => {
      const obrigatorio = i === ultimoComDado || i === idxTopo
      if (ordem % passoRot !== 0 && !obrigatorio) return
      const h = hOf(pontos[i].valor)
      const t = el('text', { class: 'gmad-valor', x: px(i).toFixed(2), y: Math.max(7, baseY - h - 3).toFixed(2), 'text-anchor': 'middle' })
      t.textContent = fmtR(pontos[i].valor)
      svg.appendChild(t)
      // O ÚLTIMO dia disputa na frente do MAIS ALTO: se os dois estiverem colados,
      // quem sobra é o dia de hoje, que é o que o dono está olhando.
      candidatos.push({ chave: i, no: t, centro: px(i), obrigatorio, naDisputa: i === ultimoComDado ? 0 : i === idxTopo ? 1 : 2 })
    })
    // Medir de verdade, não estimar por número de caracteres: "R$ 92,86" é mais
    // largo que "R$ 17,34" com os mesmos 8 caracteres, porque o "1" é estreito.
    // Foi essa diferença que fez o rótulo do primeiro dia escapar do quadro.
    let deuParaMedir = candidatos.length > 0
    for (const c of candidatos) {
      const larguraDoTexto = medidaDeTexto(c.no)
      if (!(larguraDoTexto > 0)) { deuParaMedir = false; break }
      // Encosta na borda quem sairia do quadro. Fora do quadro, dentro de uma
      // caixa que rola, é lugar que pode não ter como alcançar.
      const ancorado = ancoraDoRotulo({ centro: c.centro, largura: larguraDoTexto, quadro: W })
      c.no.setAttribute('x', ancorado.x.toFixed(2))
      c.no.setAttribute('text-anchor', ancorado.ancora)
    }
    if (deuParaMedir) for (const c of candidatos) { c.caixa = caixaDeTexto(c.no); if (!c.caixa) deuParaMedir = false }
    // Não deu para medir (SVG ainda não renderizado, cartão escondido): fica tudo
    // como sempre foi. Rótulo a mais é melhor que rótulo que sumiu por engano.
    if (deuParaMedir) {
      const naOrdemDaDisputa = candidatos.slice().sort((a, b) => a.naDisputa - b.naDisputa)
      const ficam = new Set(rotulosQueCabem(naOrdemDaDisputa.map(c => ({ chave: c.chave, caixa: c.caixa, obrigatorio: c.obrigatorio }))))
      for (const c of candidatos) if (!ficam.has(c.chave)) c.no.remove()
    }
  }
  // Linha da meta por cima das barras
  if (meta > 0) {
    const y = baseY - hOf(meta)
    svg.appendChild(comTitulo(el('line', { class: 'gmad-meta', x1: padX, x2: W - padX, y1: y.toFixed(2), y2: y.toFixed(2) }), opcoes.rotuloMeta + ': ' + fmtR(meta)))

    // O RÓTULO DA META MORA NO CANTO DE CIMA, À ESQUERDA — na faixa que o padTop
    // abriu lá em cima só para ele.
    //
    // Antes ele ficava colado na linha, na borda direita. Dois problemas, os dois
    // medidos: o último dia com dado é SEMPRE rotulado, então a tarja caía em
    // cima do valor dele; e, colado na linha, ele passeava pela altura do gráfico
    // e esbarrava no valor de qualquer dia na mesma altura. Foi assim que este
    // rótulo entrou em 5 dos 8 pares sobrepostos ("R$ 2,88" × "Meta máxima
    // R$ 3,00"). Só trocar de lado NÃO resolve: passa a bater no primeiro dia.
    //
    // A tarja continua opaca porque continua sobre o desenho, e sem fundo o texto
    // se misturava e virava sujeira. A linha continua tracejada e laranja como o
    // rótulo: os dois se leem juntos sem precisar estar encostados, e a linha
    // ainda diz o valor no toque longo.
    const txt = opcoes.rotuloMeta + ' ' + fmtR(meta)
    const larguraTxt = txt.length * 4.4 + 8 // ~4.4px por caractere no corpo 8
    const alturaTarja = 11
    const tarjaY = 2
    svg.appendChild(el('rect', {
      class: 'gmad-meta-tarja',
      x: padX.toFixed(2), y: tarjaY.toFixed(2),
      width: larguraTxt.toFixed(2), height: alturaTarja, rx: 2.5,
    }))
    const tag = el('text', {
      class: 'gmad-meta-txt',
      x: (padX + 4).toFixed(2),
      y: (tarjaY + 8).toFixed(2),
      'text-anchor': 'start',
    })
    tag.textContent = txt
    svg.appendChild(tag)
  }
  // Datas embaixo (afina automático quando o período é longo)
  const step = Math.max(1, Math.ceil(n / 8))
  for (let i = 0; i < n; i++) {
    if (i % step !== 0 && i !== n - 1) continue
    const t = el('text', { class: 'gmad-xlabel', x: px(i).toFixed(2), y: baseY + 12, 'text-anchor': 'middle' })
    t.textContent = _gmadDiaCurto(pontos[i].data)
    svg.appendChild(t)
  }
  const legenda = document.createElement('div'); legenda.className = 'gmad-legenda'
  const semColeta = pontos.filter(p => p.semDado && p.motivo === 'sem-coleta').length
  const semSeguidor = pontos.filter(p => p.semDado && p.motivo === 'sem-seguidor').length
  const partes = [opcoes.legendaBase]
  if (semColeta > 0) partes.push(semColeta === 1 ? '1 dia sem informação coletada' : semColeta + ' dias sem informação coletada')
  if (semSeguidor > 0) partes.push(semSeguidor === 1 ? '1 dia sem seguidor novo (não dá pra calcular o custo)' : semSeguidor + ' dias sem seguidor novo (não dá pra calcular o custo)')
  // Os custos por resultado trazem a frase pronta de graficos-de-custo-diario.js,
  // porque o nome do que faltou muda com o indicador ("sem conversa", "sem
  // cadastro") e é ele que sabe o gênero da palavra.
  const semResultado = pontos.filter(p => p.semDado && p.motivo === 'sem-resultado').length
  if (semResultado > 0 && opcoes.rotuloDiasSemResultado) partes.push(opcoes.rotuloDiasSemResultado(semResultado))
  legenda.textContent = partes.join(' · ')
  host.appendChild(legenda)
}

/* ── CHART INTERACTIVITY (legacy L3599-3629 — no legado rodava solto no
   escopo global do <script>; aqui a wiring (getElementById dos elementos e
   addEventListener) foi movida pro onMounted/onUnmounted, já que o DOM do
   componente só existe depois de montado) ── */
let svgEl = null, chartOverlayEl = null, crosshairEl = null, dotCurrEl = null, dotPrevEl = null, tooltipEl = null
function _onChartMouseMove(e) {
  if (!activeChartData || !activeChartData.n) return
  const { gained, lost, net, dates, px, py, yZero, n, prevSeguiu, prevDeixou, prevDates } = activeChartData
  const rect = svgEl.getBoundingClientRect()
  const xPct = (e.clientX - rect.left) / rect.width
  const i = Math.max(0, Math.min(n - 1, Math.round(xPct * (n - 1))))
  const x = px(i)
  const nf = v => (v || 0).toLocaleString('pt-BR')
  crosshairEl.setAttribute('x1', x); crosshairEl.setAttribute('x2', x); crosshairEl.removeAttribute('display')
  dotCurrEl.setAttribute('cx', x); dotCurrEl.setAttribute('cy', gained[i] > 0 ? py(gained[i]) : yZero); dotCurrEl.removeAttribute('display')
  dotPrevEl.setAttribute('display', 'none')
  document.getElementById('tt-date').textContent = dates[i] || ''
  document.getElementById('tt-seguiu').textContent = '+' + nf(gained[i])
  document.getElementById('tt-deixou').textContent = '−' + nf(lost[i])
  const liq = net[i] || 0
  const liqEl = document.getElementById('tt-liquido')
  liqEl.textContent = (liq >= 0 ? '+' : '') + nf(liq)
  liqEl.style.color = liq >= 0 ? 'var(--green)' : 'var(--red)'
  // Comparativo: MESMO DIA do mês anterior.
  const cmpEl = document.getElementById('tt-cmp')
  if (prevSeguiu && prevSeguiu[i] != null) {
    const pNet = (prevSeguiu[i] || 0) - (prevDeixou[i] || 0)
    const dd = liq - pNet
    const arrow = dd > 0 ? '▲' : dd < 0 ? '▼' : '•', col = dd > 0 ? 'var(--green)' : dd < 0 ? 'var(--red)' : 'var(--muted)'
    cmpEl.innerHTML = `<div class="tt-cmp-lbl">vs. ${prevDates[i] || ''} (mês ant.)</div>`
      + `<div class="tt-cmp-row"><span>Líquido ${(pNet >= 0 ? '+' : '') + nf(pNet)}</span>`
      + `<span style="color:${col};font-weight:800">${arrow} ${(dd >= 0 ? '+' : '') + nf(dd)}</span></div>`
    cmpEl.style.display = 'block'
  } else cmpEl.style.display = 'none'
  let tx = e.clientX + 16, ty = e.clientY - 72
  if (tx + 210 > window.innerWidth) tx = e.clientX - 226; if (ty < 8) ty = 8
  tooltipEl.style.left = tx + 'px'; tooltipEl.style.top = ty + 'px'; tooltipEl.style.display = 'block'
}
function _onChartMouseLeave() {
  crosshairEl.setAttribute('display', 'none'); dotCurrEl.setAttribute('display', 'none'); dotPrevEl.setAttribute('display', 'none'); tooltipEl.style.display = 'none'
}

/* ── FETCH DATA FROM SUPABASE (legacy L3632-3861, verbatim) ── */
function closestStoredPeriod(d) { return [1, 7, 14, 30].reduce((a, b) => Math.abs(b - d) < Math.abs(a - d) ? b : a) }
function localDate(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') }

async function fetchData(accountId, period, customStart, customEnd) {
  const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
  const days = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
  // ⚠️ INTERVALO ESCOLHIDO MANDA MAIS QUE O NÚMERO DO PERÍODO. Ao escolher datas,
  // `period` CONTINUA com o valor antigo — então "Hoje" + datas caía em `isHoje` e
  // a tela mostrava só o dia. Este arquivo já pagou por isso três vezes em
  // 09/09/2026 (gráfico rolante, gráfico de contexto, e aqui).
  const ehCustom = !!(customStart && customEnd)
  const isHoje = !ehCustom && period === 0
  const isOntem = !ehCustom && period === 1
  const isCalMonth = !ehCustom && (period === 'monthfull' || period === 'sofar' || period === 'month')
  const isLastMonth = !ehCustom && period === 'lastmonth'
  let refDate, histStartDate, storedPeriod, effectivePeriod
  if (customStart && customEnd) {
    refDate = new Date(customEnd + 'T12:00:00')
    const sd = new Date(customStart + 'T12:00:00')
    effectivePeriod = Math.max(1, Math.round((refDate - sd) / 86400000))
    storedPeriod = closestStoredPeriod(effectivePeriod)
    // Margem p/ trás suficiente p/ cobrir TAMBÉM a janela do período anterior (comparação bruta).
    // Sem margem, snaps começava em customStart e o bruto do período anterior ficava incompleto.
    histStartDate = new Date(sd); histStartDate.setDate(histStartDate.getDate() - (effectivePeriod + 2))
  } else if (isLastMonth) {
    // MÊS PASS: refDate = último dia do mês passado → todas as queries (followers,
    // engajamento, ads) recortam no mês anterior. storedPeriod=30 usa o snapshot
    // 30D capturado no fim daquele mês (proxy do mês; histórico diário já existe).
    const now = new Date()
    const lastDayPrev = new Date(now.getFullYear(), now.getMonth(), 0)
    refDate = new Date(lastDayPrev.getFullYear(), lastDayPrev.getMonth(), lastDayPrev.getDate(), 12)
    effectivePeriod = lastDayPrev.getDate()
    storedPeriod = 30
    histStartDate = new Date(refDate); histStartDate.setDate(histStartDate.getDate() - effectivePeriod - 5)
  } else if (isCalMonth) {
    const now = new Date()
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 12)
    refDate = now
    effectivePeriod = Math.max(1, now.getDate() - 1)
    storedPeriod = 99 // MÊS/ATÉ AGORA = mês-corrente real (snapshot MTD do coletor)
    histStartDate = new Date(firstOfMonth); histStartDate.setDate(histStartDate.getDate() - 5)
  } else {
    effectivePeriod = isHoje ? 1 : period; storedPeriod = period
    refDate = new Date()
    histStartDate = new Date(refDate); histStartDate.setDate(histStartDate.getDate() - 30 - Math.max(effectivePeriod, 1) - 5)
  }
  const refDateStr = localDate(refDate)
  const histStartStr = localDate(histStartDate)
  const prevRefDate = new Date(refDate)
  prevRefDate.setMonth(prevRefDate.getMonth() - 1)
  const prevRefDateStr = localDate(prevRefDate)
  const periodStart = new Date(refDate); periodStart.setDate(periodStart.getDate() - effectivePeriod)
  const periodStartStr = localDate(periodStart)
  // Janelas dia-precisas por período: HOJE = só hoje · 1D = só ontem · demais = rolante/mês.
  const _hojeBRT = localDate(new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })))
  const _ontemBRT = localDate(new Date(new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })).getTime() - 86400000))
  let followStart, followEnd
  if (isHoje) { followStart = followEnd = _hojeBRT }
  else if (isOntem) { followStart = followEnd = _ontemBRT }
  else if (typeof period === 'number' && !customStart) {
    // Dias corridos (7/14/30): N dias terminando ONTEM (régua do app — não conta o dia corrente
    // incompleto). Ex.: 7D = [ontem−6 .. ontem]. 1D acima = só ontem.
    followEnd = _ontemBRT
    followStart = localDate(new Date(new Date(_ontemBRT + 'T00:00:00').getTime() - (period - 1) * 86400000))
  }
  else if (isLastMonth) {
    // MÊS PASSADO = mês-calendário anterior EXATO (ex.: jun → 01/05..31/05). Antes pegava
    // refDate−effectivePeriod = 30/04..31/05 (off-by-one que incluía o último dia de abril).
    const _n = new Date()
    followStart = localDate(new Date(_n.getFullYear(), _n.getMonth() - 1, 1))
    followEnd = localDate(new Date(_n.getFullYear(), _n.getMonth(), 0))
  }
  else { followStart = periodStartStr; followEnd = refDateStr }
  const _fsMs = new Date(followStart + 'T00:00:00').getTime()
  const _spanDays = Math.round((new Date(followEnd + 'T00:00:00').getTime() - _fsMs) / 86400000) + 1
  const prevEndStr = localDate(new Date(_fsMs - 86400000))
  const prevStartStr = localDate(new Date(_fsMs - _spanDays * 86400000))
  const [snaps, engCurr, engPrev, cntCurr, cntPrev, filterRow, storyDailyCurr, storyDailyPrev, trueLastRows, campanhasRows, conjuntosRows] = await Promise.all([
    sb(`daily_snapshots?account_id=eq.${accountId}&captured_at=gte.${histStartStr}&captured_at=lte.${refDateStr}&order=captured_at.asc&select=followers_count,captured_at,gained,lost`),
    sb(`engagement_snapshots?account_id=eq.${accountId}&period_days=eq.${storedPeriod}&captured_at=lte.${refDateStr}&order=captured_at.desc&limit=1&select=likes,saves,shares,comments,reach,views,total_interactions,accounts_engaged,profile_views,captured_at`),
    sb(`engagement_snapshots?account_id=eq.${accountId}&period_days=eq.${storedPeriod}&captured_at=lte.${prevRefDateStr}&order=captured_at.desc&limit=1&select=likes,saves,shares,comments,reach,views,total_interactions,accounts_engaged,profile_views,captured_at`),
    sb(`content_snapshots?account_id=eq.${accountId}&period_days=eq.${storedPeriod}&captured_at=lte.${refDateStr}&order=captured_at.desc&limit=1&select=posts_count,stories_count,reels_count,captured_at`),
    sb(`content_snapshots?account_id=eq.${accountId}&period_days=eq.${storedPeriod}&captured_at=lte.${prevRefDateStr}&order=captured_at.desc&limit=1&select=posts_count,stories_count,reels_count,captured_at`),
    sb(`campaign_filters?account_id=eq.${accountId}&select=selected_ids`),
    sb(`content_snapshots?account_id=eq.${accountId}&period_days=eq.1&captured_at=gte.${followStart}&captured_at=lte.${followEnd}&select=captured_at,story_shares,story_replies,stories_count,story_reach,story_interactions,story_navigation,story_nav_forward,story_nav_back,story_nav_exit,story_nav_next,story_profile_visits,story_follows`),
    sb(`content_snapshots?account_id=eq.${accountId}&period_days=eq.1&captured_at=gte.${prevStartStr}&captured_at=lte.${prevEndStr}&select=captured_at,story_shares,story_replies,stories_count,story_reach,story_interactions,story_navigation,story_nav_forward,story_nav_back,story_nav_exit,story_nav_next,story_profile_visits,story_follows`),
    // FRESCOR = saúde do coletor (global por perfil), NÃO o fim da janela escolhida.
    // Sem limite superior: pega a última coleta REAL, independente do período exibido.
    sb(`daily_snapshots?account_id=eq.${accountId}&order=captured_at.desc&limit=1&select=captured_at,followers_count`),
    // Campanha + os conjuntos dela = o que decide o BALDE. Limite folgado de
    // propósito: a maior conta (Vessel) tem 126 campanhas e 5 contas somam 299
    // conjuntos — nenhuma chega perto de 5000, e um corte silencioso aqui faria
    // campanha sumir do recorte sem ninguém perceber.
    sb(`campaigns?account_id=eq.${accountId}&limit=5000&select=campaign_id,objective`),
    sb(`campaign_adsets?account_id=eq.${accountId}&limit=5000&select=campaign_id,destination_type,optimization_goal,synced_at`),
  ])
  const eng = engCurr[0] || { likes: 0, saves: 0, shares: 0, comments: 0 }
  const prevEng = engPrev[0] || null
  const cnt = cntCurr[0] || { posts_count: 0, stories_count: 0, reels_count: 0 }
  const prevCnt = cntPrev[0] || null
  const latest = snaps.length > 0 ? snaps[snaps.length - 1].followers_count : 0
  function fmtLabel(dateStr) { const d = new Date(dateStr + 'T12:00:00'); return effectivePeriod <= 7 ? days[d.getDay()] : d.getDate() + '/' + (d.getMonth() + 1) }
  function fmtFull(dateStr) { const d = new Date(dateStr + 'T12:00:00'); return d.getDate() + ' ' + months[d.getMonth()] }
  // NOVOS x SAÍRAM por dia. Régua do app = bruto follows_and_unfollows (gained/lost). PORÉM a Graph
  // API consolida o bruto ~2 dias depois (dias recentes vêm 0/0, mesmo o app já mostrando). Para NÃO
  // deixar dias zerados, dias recentes ainda 0/0 caem no LÍQUIDO pela contagem total (followers_count,
  // diário/tempo real) — preserva o líquido do período; quando a Meta consolida, o coletor re-coleta
  // e o bruto real entra no lugar automaticamente.
  const _idxByDate = {}; snaps.forEach((s, i) => { _idxByDate[s.captured_at] = i })
  const _netCountOf = s => { const i = _idxByDate[s.captured_at]; return i > 0 ? ((Number(s.followers_count) || 0) - (Number(snaps[i - 1].followers_count) || 0)) : 0 }
  const _daysAgo = s => Math.round((new Date(_hojeBRT + 'T00:00:00') - new Date(s.captured_at + 'T00:00:00')) / 864e5)
  // CONSOLIDADO = BRUTO PURO (seguiram−saíram), EXATAMENTE igual ao painel profissional do IG,
  // em TODOS os períodos (conferidos no painel: 7d Breno=3, 14d=165, 30d=1268). SEM fallback por
  // contagem: dia recente ainda não consolidado pela Meta conta 0 e é marcado "consolidando".
  // O número em tempo real (variação da contagem) vai SEPARADO, como PRÉVIA (previaReal, abaixo).
  // [novos, saíram, parcial] do dia.
  const _glOf = s => {
    const g = Number(s.gained) || 0, l = Number(s.lost) || 0
    if (g > 0 || l > 0) return [g, l, false]
    return [0, 0, _daysAgo(s) <= 2] // recente e 0/0 → ainda consolidando (não inventa pela contagem)
  }
  const chartSrc = snaps.filter(s => s.captured_at >= followStart && s.captured_at <= followEnd)
  // BRUTO puro (p/ o oficial confirmado e o sub-rótulo ▲novos ▼saíram).
  const _gl = chartSrc.map(_glOf)
  const grossGained = _gl.reduce((a, x) => a + x[0], 0)
  const grossLost = _gl.reduce((a, x) => a + x[1], 0)
  // Líquido do período = Σnovos − Σsaíram (régua do painel profissional; usado quando confirmado).
  const newFollowers = grossGained - grossLost
  // "parcial/consolidando": algum dia da janela ainda não fechou o bruto na Meta.
  const grossPartial = _gl.some(x => x[2])
  // GRÁFICO resiliente (sincronizado com o número): dia COM bruto → split ▲novos/▼saíram;
  // dia SEM bruto → variação real da contagem (sobe verde se +, desce vermelho se −). Nunca achata.
  const _chart = chartSrc.map(s => {
    const g = Number(s.gained) || 0, l = Number(s.lost) || 0
    if (g > 0 || l > 0) return [g, l]
    const n = _netCountOf(s)
    return n >= 0 ? [n, 0] : [0, -n]
  })
  const chartGained = _chart.map(x => x[0])
  const chartLost = _chart.map(x => x[1])
  // ── PRÉVIA TEMPO REAL (variação da contagem de seguidores; janela terminando HOJE) ──
  // Métrica DIFERENTE do bruto/IG. Em picos fica acima do que o IG contabiliza. Mesma régua em
  // todos os períodos → entre si nunca inverte (hoje ≤ 7d ≤ 14d ≤ 30d).
  const _countAtOrBefore = ds => { let v = null; for (let i = 0; i < snaps.length; i++) { if (snaps[i].captured_at <= ds) v = Number(snaps[i].followers_count) || 0; else break } return v }
  let _prevNumD = _hojeBRT, _prevBaseD
  if (isOntem) { _prevNumD = _ontemBRT; _prevBaseD = localDate(new Date(new Date(_ontemBRT + 'T00:00:00').getTime() - 86400000)) }
  else if (customStart && customEnd) { _prevNumD = customEnd; _prevBaseD = localDate(new Date(new Date(customStart + 'T00:00:00').getTime() - 86400000)) }
  else if (isLastMonth) { _prevNumD = followEnd; _prevBaseD = localDate(new Date(new Date(followStart + 'T00:00:00').getTime() - 86400000)) }
  else if (isCalMonth) { const _n = new Date(); _prevBaseD = localDate(new Date(_n.getFullYear(), _n.getMonth(), 0)) }
  else { _prevBaseD = localDate(new Date(new Date(_hojeBRT + 'T00:00:00').getTime() - (isHoje ? 1 : period) * 86400000)) }
  const _cNum = _countAtOrBefore(_prevNumD)
  let _cBase = _countAtOrBefore(_prevBaseD), _partialSince = null
  if (_cBase == null && snaps.length) { _cBase = Number(snaps[0].followers_count) || 0; _partialSince = snaps[0].captured_at } // histórico curto
  const previaReal = (_cNum != null && _cBase != null) ? (_cNum - _cBase) : null
  // CONFIRMADO PELO IG: o bruto (gained/lost) cobre todo o período? A Meta às vezes atrasa/para de
  // entregar follows_and_unfollows (ex.: parou em 13/06/2026). Se o último dia da janela já tem bruto,
  // mostramos o oficial (IGUAL ao IG); senão, mostramos a variação da contagem (fresca) "em consolidação".
  const lastGrossDay = snaps.reduce((mx, s) => (((Number(s.gained) || 0) > 0 || (Number(s.lost) || 0) > 0) && s.captured_at > mx) ? s.captured_at : mx, '')
  const confirmadoIG = !!lastGrossDay && followEnd <= lastGrossDay
  const chartLabels = chartSrc.length ? chartSrc.map(s => fmtLabel(s.captured_at)) : ['—']
  const chartDates = chartSrc.length ? chartSrc.map(s => fmtFull(s.captured_at)) : ['—']
  // Período anterior (mesma duração) imediatamente antes da janela — MESMA régua (bruto novos−saíram).
  const _prevWindow = snaps.filter(s => s.captured_at >= prevStartStr && s.captured_at <= prevEndStr)
  const _prevGained = _prevWindow.reduce((a, s) => a + (Number(s.gained) || 0), 0)
  const _prevLost = _prevWindow.reduce((a, s) => a + (Number(s.lost) || 0), 0)
  const prevNewFollowers = _prevWindow.length ? (_prevGained - _prevLost) : null
  // ── Conferência (F4): líquido === novos − saíram ──
  // (nota) o líquido pela contagem total e o bruto novos−saíram são medições distintas da Meta
  // e não batem exatamente — por isso o saldo principal usa a contagem total (confiável/tempo real).
  const engTotal = eng.likes + eng.saves + eng.shares + (eng.comments || 0)
  const prevEngTotal = (prevEng?.likes || 0) + (prevEng?.saves || 0) + (prevEng?.shares || 0)
  // Taxa de engajamento POR ALCANCE (padrão IG): (curtidas+comentários+salvamentos+compartilhamentos) / alcance × 100.
  const engRate = eng.reach > 0 ? ((engTotal / eng.reach) * 100).toFixed(1) : '0.0'
  const avgPerDay = effectivePeriod > 0 ? (newFollowers / effectivePeriod).toFixed(1) : '0.0'
  const pLabel = customStart && customEnd ? effectivePeriod + 'D' : _perShort(period, effectivePeriod)
  const followerDeltas = [{ p: pLabel, v: (newFollowers >= 0 ? '+' : '') + fmtN(newFollowers), dir: newFollowers >= 0 ? 'up' : 'down' }]
  if (prevNewFollowers > 0) { followerDeltas.push({ p: 'vs per. ant.', v: pctDiff(newFollowers, prevNewFollowers), dir: newFollowers >= prevNewFollowers ? 'up' : 'down' }) }
  // ── SEÇÃO 02 · META ADS: quem entra na conta ──
  // Dois recortes que se SOMAM: o BALDE recorta o tipo de campanha (Seguidores,
  // Contatos, Site e alcance, Vendas) e o "⚙ Filtrar campanhas" recorta DENTRO
  // dele. Quem faz a interseção é idsParaConsulta(), testada à parte.
  const selectedIds = filterRow[0]?.selected_ids // null=todas, []=nenhuma, [ids]=filtradas
  const noneSelected = Array.isArray(selectedIds) && selectedIds.length === 0
  const safeIds = Array.isArray(selectedIds) ? selectedIds.filter(id => /^\d+$/.test(String(id))) : []
  // .erro lido AQUI, colado no await do Promise.all lá de cima: ele mora no array
  // que o sb() devolveu, e o forEach/Object.values abaixo criam coleções novas que
  // o deixariam para trás. Falha ao buscar as campanhas NÃO pode virar "este perfil
  // não tem campanha nenhuma" em silêncio — isso apagaria dinheiro real da tela.
  erroAds.value = campanhasRows.erro || conjuntosRows.erro || null
  // Chamada AQUI pelo mesmo motivo do erroAds acima: classificacaoEhProvisoria
  // olha o .erro do array, que mora nele só até o primeiro .map()/.filter().
  // Pura e testada em baldes-do-painel.test.mjs (é lá que fica documentado o
  // limite: RLS negando leitura também chega como [] sem erro nenhum).
  const _semConjuntoDeVerdade = classificacaoEhProvisoria(conjuntosRows)
  // Campanha + os conjuntos dela = o que decide o balde. Conjunto ainda não
  // coletado não some: cai pela regra do objetivo (ver baldes-do-painel.js), que é
  // exatamente o que acontece enquanto campaign_adsets ainda está vazia.
  const _porCampanha = {}
  campanhasRows.forEach(c => { _porCampanha[String(c.campaign_id)] = { campaign_id: String(c.campaign_id), objective: c.objective, conjuntos: [] } })
  conjuntosMaisRecentes(conjuntosRows).forEach(s => { const c = _porCampanha[String(s.campaign_id)]; if (c) c.conjuntos.push(s) })
  const _campanhas = Object.values(_porCampanha)
  const _selecionadas = Array.isArray(selectedIds) ? safeIds : null
  // A lista de ids de CADA balde, já com o filtro manual aplicado por dentro.
  // Sai da mesma função que monta o recorte final: assim a conta de "balde vazio"
  // e a consulta do dinheiro nunca podem discordar.
  const _idsPorBalde = {}
  BALDES.forEach(b => { if (b.id !== 'todos') _idsPorBalde[b.id] = idsParaConsulta(_campanhas, b.id, _selecionadas) })
  const _filtroManual = safeIds.length > 0 ? `&campaign_id=in.(${safeIds.join(',')})` : ''

  // ── GRÁFICOS DIÁRIOS DA SEÇÃO 02 (barras por dia + linha de meta) ──
  // period_days = 0 guarda o gasto do DIA isolado (uma linha por campanha por dia). O agregado dos
  // cards abaixo NÃO é tocado — isto aqui é leitura à parte. O recorte é sempre a
  // janela exibida (followStart..followEnd), igual pra todo perfil e todo período.
  //
  // Esta busca virou a base de DUAS coisas, e por isso subiu para antes dos
  // agregados: as barras por dia e a conta de qual balde ficou sem dinheiro no
  // período. Ela traz o campaign_id porque é o gasto POR CAMPANHA que diz em que
  // balde o dinheiro caiu — o agregado da Meta não separa por tipo. O recorte por
  // balde é feito aqui na memória, não na URL, para não pagar duas viagens.
  let _diaRows = []
  if (!noneSelected) {
    const ciDia = await sb(`campaign_insights?account_id=eq.${accountId}&period_days=eq.0&captured_at=gte.${followStart}&captured_at=lte.${followEnd}&order=captured_at.asc&limit=5000&select=captured_at,campaign_id,spend,post_engagement,likes,conversas,cadastros,visitas,compras,impressions${_filtroManual}`)
    // .erro lido AQUI, colado no await: ele mora no array que o sb() devolveu e o .map() abaixo
    // cria um array novo, deixando o .erro pra trás.
    if (ciDia.erro && !erroAds.value) erroAds.value = ciDia.erro
    if (!ciDia.erro) _diaRows = ciDia.map(r => ({
      captured_at: r.captured_at, campaign_id: String(r.campaign_id), spend: r.spend,
      // AS CONTAGENS DO DIA, CRUAS: null continua null. Elas alimentam o gráfico
      // de custo por resultado de cada cartão (ver graficos-de-custo-diario.js),
      // e nulo virando 0 aqui faria "R$ 0,00 por conversa" num dia que ninguém
      // mediu. Quem separa "não coletado" de "aconteceu zero" é a série pura.
      post_engagement: r.post_engagement, likes: r.likes, conversas: r.conversas,
      cadastros: r.cadastros, visitas: r.visitas, compras: r.compras, impressions: r.impressions,
    }))
  }
  // Balde sem gasto no período fica APAGADO na barra, com o motivo — nunca some:
  // sumir faz a pessoa procurar o que não está lá. 'todos' nunca entra na lista.
  // Sem série diária nenhuma, NADA é dado como vazio (ver baldesSemGasto).
  const baldesVazios = baldesSemGasto(_idsPorBalde, _diaRows)
  const _efetivo = baldeEfetivo(_baldeAtual, baldesVazios)
  const idsDoRecorte = idsParaConsulta(_campanhas, _efetivo, _selecionadas)
  // EM TODOS SEM FILTRO MANUAL, nada de lista de ids: fica exatamente no caminho de
  // hoje. Dois motivos, os dois já custaram caro aqui:
  //  • a Vessel tem 126 campanhas, e um in.(...) com 126 ids de 18 dígitos é uma URL
  //    de mais de 2 mil caracteres por nada;
  //  • é o `_todasAsCampanhas` logo abaixo que troca o alcance somado por campanha
  //    pelo alcance DEDUPLICADO da conta — somar por campanha inflava até ~35%.
  //    Mandar a lista mataria essa guarda.
  const _todasAsCampanhas = _efetivo === 'todos' && _selecionadas == null
  // RECORTE VAZIO NUNCA PODE VIRAR "TODAS". `idFilter` vazio quer dizer "a conta
  // inteira" nestas consultas, então um recorte sem nenhuma campanha cairia
  // justamente no oposto do que ele pede — e no cartão de dinheiro.
  //
  // Isso é alcançável pela armadilha que os comentários deste arquivo já avisam:
  // o sb() devolve 200 + [] sem .erro quando a RLS esconde tudo. Com `campaigns`
  // escondida e um filtro manual salvo, o recorte fica vazio e a tela mostraria o
  // gasto INTEIRO da conta com o rótulo "1 campanha selecionada".
  //
  // Sem campanha no recorte, não se mostra nada: é o mesmo tratamento de quando o
  // dono desmarca todas (noneSelected). Melhor "R$ —" do que dinheiro que não é
  // daquele recorte.
  const _recorteSemCampanha = noneSelected || (!_todasAsCampanhas && idsDoRecorte.length === 0)
  const idFilter = _todasAsCampanhas ? '' : `&campaign_id=in.(${idsDoRecorte.join(',')})`
  // O ao vivo tem de somar o MESMO conjunto que o coletado, senão o cartão de
  // investimento mostra um balde e o de custo por seguidor mostra outro. Lista
  // vazia = a edge volta ao caminho level=account, o número exato e mais barato.
  const idsParaAoVivo = _todasAsCampanhas ? [] : idsDoRecorte
  // As barras do gráfico seguem o mesmo recorte dos cartões.
  const _noRecorte = new Set(idsDoRecorte)
  const gastoDiarioRows = _recorteSemCampanha ? [] : _diaRows
    .filter(r => _todasAsCampanhas || _noRecorte.has(r.campaign_id))
    .map(r => ({
      captured_at: r.captured_at, spend: r.spend,
      post_engagement: r.post_engagement, likes: r.likes, conversas: r.conversas,
      cadastros: r.cadastros, visitas: r.visitas, compras: r.compras, impressions: r.impressions,
    }))
  // AS QUATRO CONTAGENS NOVAS: NULO NÃO É ZERO.
  //
  // conversas/cadastros/compras/visitas só passaram a ser gravadas em 17/08/2026 e
  // nasceram SEM default (ver a migration). Somar nulo como 0 faria o cartão dizer
  // "nenhuma conversa" — que é uma afirmação — onde a verdade é "ainda não foi
  // coletado". Só entra na soma a linha que tem o número; se NENHUMA tiver,
  // devolve null e o cartão mostra "—".
  function somaOuNulo(rows, campo) {
    const com = rows.filter(r => r[campo] != null)
    return com.length ? com.reduce((s, r) => s + (parseInt(r[campo]) || 0), 0) : null
  }
  // `linhas` já vem de capturaDoAgregado(): ou é a captura inteira que CABE na
  // janela exibida, ou está vazia. Quem escolhe a captura e quem recusa a velha
  // demais é o módulo puro — aqui só se soma.
  function aggCi(d) {
    if (!d.length) return null
    return { spend: d.reduce((s, r) => s + parseFloat(r.spend || 0), 0), impressions: d.reduce((s, r) => s + parseInt(r.impressions || 0), 0), clicks: d.reduce((s, r) => s + parseInt(r.clicks || 0), 0), reach: d.reduce((s, r) => s + parseInt(r.reach || 0), 0), adEngagement: d.reduce((s, r) => s + parseInt(r.post_engagement || 0), 0), adLikes: d.reduce((s, r) => s + parseInt(r.likes || 0), 0), adComments: d.reduce((s, r) => s + parseInt(r.comments || 0), 0), adShares: d.reduce((s, r) => s + parseInt(r.shares || 0), 0), adSaves: d.reduce((s, r) => s + parseInt(r.saves || 0), 0), conversas: somaOuNulo(d, 'conversas'), cadastros: somaOuNulo(d, 'cadastros'), compras: somaOuNulo(d, 'compras'), visitas: somaOuNulo(d, 'visitas') }
  }
  let spend = 0, impressions = 0, clicks = 0, reach = 0, prevSpend = null, adEngagement = 0, adLikes = 0, adComments = 0, adShares = 0, adSaves = 0
  // Começam em null (não em 0) porque "—" é o estado honesto antes de qualquer
  // leitura: recorte sem campanha nenhuma nunca sai daqui, e não pode virar zero.
  let conversas = null, cadastros = null, compras = null, visitas = null, frequencia = null
  // O alcance saiu da SOMA por campanha (repete quem viu mais de um anúncio) ou do
  // total deduplicado da conta? Começa em "somado" e só vira false quando o número
  // nível-conta realmente entra no lugar.
  let alcanceSomado = true
  let _capDias = [], _capLinhas = 0
  // Ads dia-preciso p/ HOJE/1D: gasto do DIA exato (period_days=0 de hoje/ontem),
  // em vez do agregado "última captura" (que defasava o HOJE e somava 2 dias no 1D).
  let _adsPd = storedPeriod, _adsCur = `captured_at=lte.${refDateStr}&order=captured_at.desc`, _adsPrev = `captured_at=lte.${prevRefDateStr}&order=captured_at.desc`
  // ATÉ QUE PONTO PARA TRÁS UMA CAPTURA AINDA É "ESTE PERÍODO".
  //
  // A consulta acima limita a data só POR CIMA. Isso bastava enquanto ela trazia
  // TODAS as campanhas da conta: a mais recente era sempre a última rodada do
  // coletor. Com o recorte por tipo de campanha, a mais recente passou a ser a
  // mais recente DAQUELE tipo — e um tipo parado devolve uma foto de meses atrás
  // com o rótulo "últimos 7 dias" (Breno Vale, 08/06 sob 7D: 488 impressões e
  // R$ 6,32 impressos como a semana). Quem recusa é capturaDoAgregado(), testado
  // ao lado; aqui só se diz qual é a janela de cada uma das duas consultas.
  //
  // A tolerância é o tamanho da própria janela exibida: uma captura de 7 dias
  // tirada dentro dos últimos 7 dias ainda fala do período; uma de 70 dias atrás
  // não fala. A do período ANTERIOR usa a MESMA tolerância contada a partir da
  // data de referência DELA (que é outra: um mês atrás), senão a comparação
  // "vs período anterior" sumiria de todo mundo.
  const _tolDias = Math.max(1, Math.round((new Date(refDateStr + 'T00:00:00').getTime() - new Date(followStart + 'T00:00:00').getTime()) / 86400000))
  let _janCur = { inicio: followStart, fim: refDateStr }
  let _janPrev = { inicio: localDate(new Date(new Date(prevRefDateStr + 'T00:00:00').getTime() - _tolDias * 86400000)), fim: prevRefDateStr }
  // ⚠️ INTERVALO ESCOLHIDO SOMA OS DIAS. Até 09/09/2026 os cartões de Meta Ads
  // liam `period_days = closestStoredPeriod(dias)` — arredondavam o intervalo para
  // a captura agregada de 1, 7, 14 ou 30 dias e pegavam UMA. Escolher 5 a 9 caía
  // na de 1 dia; vindo de "7 dias", caía na mesma de antes e os números NÃO
  // MUDAVAM ao trocar de período. Foi o que o dono viu.
  //
  // Existe captura DIÁRIA (`period_days = 0`) cobrindo o intervalo — medido no
  // mesmo dia: 5 a 9 de setembro somam R$ 14.948,60 de investimento.
  if (ehCustom) {
    _adsPd = 0
    _adsCur = `captured_at=gte.${followStart}&captured_at=lte.${followEnd}&order=captured_at.desc`
    _adsPrev = `captured_at=gte.${prevStartStr}&captured_at=lte.${prevEndStr}&order=captured_at.desc`
    _janCur = { inicio: followStart, fim: followEnd }
    _janPrev = { inicio: prevStartStr, fim: prevEndStr }
  }
  else if (isHoje) { _adsPd = 0; _adsCur = `captured_at=eq.${_hojeBRT}`; _adsPrev = `captured_at=eq.${_ontemBRT}`; _janCur = { inicio: _hojeBRT, fim: _hojeBRT }; _janPrev = { inicio: _ontemBRT, fim: _ontemBRT } }
  else if (isOntem) { const _anteBRT = localDate(new Date(new Date(_ontemBRT + 'T00:00:00').getTime() - 86400000)); _adsPd = 0; _adsCur = `captured_at=eq.${_ontemBRT}`; _adsPrev = `captured_at=eq.${_anteBRT}`; _janCur = { inicio: _ontemBRT, fim: _ontemBRT }; _janPrev = { inicio: _anteBRT, fim: _anteBRT } }
  // De quando é a captura que foi RECUSADA por ser de fora da janela. null = não
  // houve recusa. A tela escreve isso junto dos "—", senão o dono vê traço sem
  // saber se é falta de coleta, falta de gasto, ou defeito.
  let capturaAdsFora = null
  // QUEM REALMENTE PÔS DINHEIRO NOS CARTÕES desta janela. Sai da MESMA captura
  // que os cartões somaram — não é uma segunda medição que possa discordar. É a
  // porta do aviso de "sem tipo confirmado": campanha que não gastou não
  // distorce número nenhum aqui, e avisar sobre ela acenderia a faixa vermelha
  // para sempre (medido: 37 das 38 campanhas sem conjunto não gastam nada).
  let _idsComGastoNaJanela = []
  if (!_recorteSemCampanha) {
    // ⚠️ O TETO DE 200 LINHAS SERVIA PARA UMA CAPTURA SÓ. Somando um intervalo,
    // são ~30 campanhas POR DIA: cinco dias já dão 150, e um mês estoura — o
    // PostgREST corta em silêncio e o investimento sai MENOR sem aviso nenhum,
    // que é o defeito mais caro desta casa (número no lugar de falha).
    const _tetoAds = ehCustom ? 5000 : 200
    const [ciCurr, ciPrev] = await Promise.all([
      sb(`campaign_insights?account_id=eq.${accountId}&period_days=eq.${_adsPd}&${_adsCur}&limit=${_tetoAds}&select=campaign_id,spend,impressions,clicks,reach,post_engagement,likes,comments,shares,saves,conversas,cadastros,compras,visitas,captured_at${idFilter}`),
      sb(`campaign_insights?account_id=eq.${accountId}&period_days=eq.${_adsPd}&${_adsPrev}&limit=${_tetoAds}&select=campaign_id,spend,impressions,clicks,reach,post_engagement,likes,comments,shares,saves,conversas,cadastros,compras,visitas,captured_at${idFilter}`),
    ])
    // ⚠️ BATEU NO TETO = LEITURA PELA METADE, e não "foi isso que teve". Sem este
    // aviso o dono veria um investimento menor e acreditaria.
    // ⚠️ SÓ NO INTERVALO. Fora dele a consulta NÃO tem limite de data por baixo:
    // ela devolve as 200 linhas mais recentes de propósito, e `capturaDoAgregado`
    // escolhe a captura mais nova entre elas. Bater em 200 ali é o normal, não
    // truncamento — e eu fiz o aviso disparar em toda carga, que é o jeito mais
    // rápido de ensinar alguém a ignorar aviso.
    if (ehCustom && ((ciCurr && ciCurr.length >= _tetoAds) || (ciPrev && ciPrev.length >= _tetoAds))) {
      erroAds.value = erroAds.value
        || 'A leitura de anúncios bateu no teto de linhas e pode estar incompleta — escolha um intervalo menor.'
    }
    // Captura o .erro AQUI, colado no await: o .erro é uma propriedade do array
    // que o sb() devolveu — .filter()/.map() (o aggCi abaixo) criam array novo e
    // deixam o .erro para trás.
    // Só ACRESCENTA: uma falha anterior (campanhas, conjuntos ou gasto do dia) não
    // pode ser apagada por um `|| null` daqui — o dono ficaria sem o aviso.
    erroAds.value = erroAds.value || ciCurr.erro || ciPrev.erro || null
    // A captura mais recente de CADA consulta, recusada quando é de fora da
    // janela que a tela está afirmando (ver captura-do-agregado.js).
    // Intervalo escolhido soma TODOS os dias; os demais períodos continuam
    // pegando a captura agregada mais nova e recusando a que for velha demais.
    const _capCur = ehCustom ? capturasDaJanela(ciCurr, _janCur) : capturaDoAgregado(ciCurr, _janCur)
    _capDias = _capCur.dias || (_capCur.data ? [_capCur.data] : [])
    _capLinhas = (_capCur.linhas || []).length
    const _capPrev = ehCustom ? capturasDaJanela(ciPrev, _janPrev) : capturaDoAgregado(ciPrev, _janPrev)
    capturaAdsFora = _capCur.foraDaJanela ? _capCur.data : null
    // A captura já vem recortada pelo balde e pelo filtro manual (o idFilter da
    // consulta), e já vem recusada quando é velha demais — então isto é, com
    // todas as letras, "as campanhas cujo dinheiro está impresso nesta tela".
    _idsComGastoNaJanela = _capCur.linhas.filter(r => parseFloat(r.spend || 0) > 0).map(r => String(r.campaign_id))
    const adsAgg = aggCi(_capCur.linhas); const prevAdsAgg = aggCi(_capPrev.linhas)
    spend = adsAgg?.spend || 0; impressions = adsAgg?.impressions || 0; clicks = adsAgg?.clicks || 0; reach = adsAgg?.reach || 0
    adEngagement = adsAgg?.adEngagement || 0; adLikes = adsAgg?.adLikes || 0; adComments = adsAgg?.adComments || 0; adShares = adsAgg?.adShares || 0; adSaves = adsAgg?.adSaves || 0
    // Sem `|| 0` de propósito: aqui zero é resposta ("ninguém abriu conversa") e
    // null é ausência de leitura. As duas coisas têm de chegar diferentes na tela.
    conversas = adsAgg ? adsAgg.conversas : null; cadastros = adsAgg ? adsAgg.cadastros : null; compras = adsAgg ? adsAgg.compras : null; visitas = adsAgg ? adsAgg.visitas : null
    prevSpend = prevAdsAgg ? prevAdsAgg.spend : null
    // Reach DEDUPLICADO: sem filtro de campanhas, usa o total nível-conta (account_insights).
    // Somar reach por campanha infla (mesma pessoa em várias) — chegava a ~35% no real.
    // "Sem filtro" agora quer dizer as DUAS coisas: balde Todos E nenhum filtro
    // manual. Com um recorte qualquer não existe alcance deduplicado guardado, e
    // aí a soma por campanha é o melhor que temos — o mesmo que já acontecia
    // quando o dono marcava campanhas na mão. Quando isso acontece, o cartão TEM
    // de dizer em uma linha que o número repete pessoa — desde que a tela abre em
    // Seguidores, esse virou o caso PADRÃO, e imprimir um alcance inflado como
    // fato é pior do que não mostrá-lo.
    //
    // Na MESMA viagem vêm impressões e frequência, que os cartões do balde Todos
    // pedem. Nada de tabela nova nem de segunda ida: as três colunas moram na
    // linha que já estava sendo lida. As impressões do nível-conta batem EXATO com
    // a soma por campanha nas 5 contas (conferido em 17/08/2026) — impressão não
    // duplica pessoa, então aqui é só coerência de fonte, não correção de número.
    // ⚠️ NO INTERVALO ESCOLHIDO NÃO HÁ ALCANCE DEDUPLICADO. `account_insights`
    // também tem uma linha por captura: com `limit=1` num intervalo, o número
    // seria o de UM DIA — menor que a verdade, impresso como se fosse do período.
    // Melhor o alcance somado, que o cartão já declara ("repete pessoa").
    if (_todasAsCampanhas && !ehCustom) {
      const aiCurr = await sb(`account_insights?account_id=eq.${accountId}&period_days=eq.${_adsPd}&${_adsCur}&limit=1&select=reach,impressions,frequency`).catch(() => [])
      // `> 0`, NÃO `!= null`. Estas três colunas são anuláveis MAS têm default 0:
      // a linha em que a Meta não publicou nada chega com zero, passa por um
      // teste de "veio número?" e a tela imprime "0,00×" com borda VERDE — um
      // veredito fabricado a partir de leitura ausente. Zero aqui nunca é
      // resposta útil (conta com investimento tem impressão e tem alcance), e
      // trocar um alcance somado por um zero seria apagar número bom.
      if (aiCurr && aiCurr.length && aiCurr[0].reach > 0) { reach = parseInt(aiCurr[0].reach); alcanceSomado = false }
      if (aiCurr && aiCurr.length && aiCurr[0].impressions > 0) impressions = parseInt(aiCurr[0].impressions)
      if (aiCurr && aiCurr.length && aiCurr[0].frequency > 0) frequencia = parseFloat(aiCurr[0].frequency)
    }
    // FREQUÊNCIA em qualquer recorte que não seja a conta inteira: não existe
    // guardada, e a única conta possível é impressões ÷ alcance SOMADO. Como esse
    // alcance conta a mesma pessoa mais de uma vez, a frequência sai BAIXA demais —
    // por isso ela herda, na tela, o mesmo aviso do alcance (ver _alcanceRepete).
    // Sem alcance não se divide: fica null, e o cartão mostra "—".
    if (frequencia == null && impressions > 0 && reach > 0) frequencia = impressions / reach
  }
  // Novos seguidores por dia: MESMA série resiliente que o gráfico da seção 01 desenha
  // (bruto quando a Meta consolidou; senão a variação da contagem) — os dois nunca divergem.
  const seguidoresDiarioRows = chartSrc.map((row, i) => ({ data: row.captured_at, novos: chartGained[i], saiu: chartLost[i] }))
  // Custo por seguidor = investimento ÷ NOVOS seguidores BRUTOS (soma de gained) do período.
  // NUNCA usa o líquido: mesmo com saldo negativo, sabemos quantos ENTRARAM (gained). Isso cobre
  // 7d/30d, onde a maioria dos dias já consolidou. Quando a soma de gained é 0 SÓ porque os dias
  // recentes ainda não consolidaram na Meta (gained/lost não publicados, mas a contagem mexeu),
  // o card mostra "consolidando" em vez de R$0 — nunca R$0, número negativo, nem valor por líquido.
  // "novos seguidores" pro custo: usa o BRUTO quando a Meta consolidou. Quando o bruto ainda
  // NÃO saiu (dia recente) mas a contagem SUBIU, usa esse ganho de contagem (chartGained já traz
  // o +N dos dias sem bruto) como PRÉVIA — senão um custo que existe (ex.: R$40 investidos hoje,
  // +5 seguidores) apareceria zerado. É o número que já dá pra ver hoje.
  //
  // O CUSTO em si não sai daqui: quem divide é o cartão, e ele divide o
  // investimento que está IMPRESSO nele (ver cartoes-do-balde.js). Daqui vai só o
  // DENOMINADOR — os novos seguidores do período, e os do período anterior para a
  // linha de comparação. Assim os três custos do balde Seguidores dividem o mesmo
  // numerador que o cartão de cima mostra, e o dono consegue refazer a conta.
  const chartGainedSum = chartGained.reduce((a, b) => a + (b || 0), 0)
  const _divSeguidores = grossGained > 0 ? grossGained : chartGainedSum
  // prévia = está usando o ganho de contagem (não o bruto oficial) porque a Meta ainda não fechou.
  const cpsPrevia = grossGained === 0 && chartGainedSum > 0
  // "consolidando" (custo NÃO calculável): bruto não fechou E a contagem não subiu (net ≤ 0) —
  // aí não dá pra dividir. Só então mostra "consolidando" em vez de um número.
  const _countMoved = chartSrc.some(s => _netCountOf(s) !== 0)
  const cpsConsolidando = grossGained === 0 && grossPartial && _countMoved && chartGainedSum <= 0
  const storyShares = storyDailyCurr.reduce((s, r) => s + (r.story_shares || 0), 0)
  const storyRep = storyDailyCurr.reduce((s, r) => s + (r.story_replies || 0), 0)
  const prevStoryShares = storyDailyPrev.length ? storyDailyPrev.reduce((s, r) => s + (r.story_shares || 0), 0) : null
  const prevStoryRep = storyDailyPrev.length ? storyDailyPrev.reduce((s, r) => s + (r.story_replies || 0), 0) : null
  const _sdSum = (arr, key) => arr.reduce((s, r) => s + (r[key] || 0), 0)
  const storyReach = _sdSum(storyDailyCurr, 'story_reach'), storyInter = _sdSum(storyDailyCurr, 'story_interactions'), storyNav = _sdSum(storyDailyCurr, 'story_navigation'), storyPV = _sdSum(storyDailyCurr, 'story_profile_visits'), storyFol = _sdSum(storyDailyCurr, 'story_follows')
  const prevStoryReach = storyDailyPrev.length ? _sdSum(storyDailyPrev, 'story_reach') : null, prevStoryInter = storyDailyPrev.length ? _sdSum(storyDailyPrev, 'story_interactions') : null, prevStoryNav = storyDailyPrev.length ? _sdSum(storyDailyPrev, 'story_navigation') : null, prevStoryPV = storyDailyPrev.length ? _sdSum(storyDailyPrev, 'story_profile_visits') : null, prevStoryFol = storyDailyPrev.length ? _sdSum(storyDailyPrev, 'story_follows') : null
  const storyNavF = _sdSum(storyDailyCurr, 'story_nav_forward'), storyNavB = _sdSum(storyDailyCurr, 'story_nav_back'), storyNavE = _sdSum(storyDailyCurr, 'story_nav_exit'), storyNavN = _sdSum(storyDailyCurr, 'story_nav_next')
  // Stories postados: soma diária dentro da janela (corrige HOJE = 1D). Posts/Reels NÃO mudam (são por-período).
  const storiesCount = storyDailyCurr.reduce((s, r) => s + (r.stories_count || 0), 0)
  const prevStoriesCount = storyDailyPrev.length ? storyDailyPrev.reduce((s, r) => s + (r.stories_count || 0), 0) : null
  // ── DOIS RÓTULOS, PORQUE HÁ DUAS JANELAS ANTERIORES NESTA TELA ──
  //
  // O rótulo não é enfeite: ele afirma DE QUANDO é o número que está do lado
  // dele. Havia um só, e ele descrevia a janela de um mês atrás — enquanto o ao
  // vivo (o caminho normal) compara com o período IMEDIATAMENTE anterior. Em 7D
  // o cartão de investimento dizia "vs 13 Jul – 20 Jul" mostrando o gasto de
  // 06–12/08: o número certo, com a data um mês fora. Quem lê acredita na data.
  //
  //   `pl`         → a MESMA janela de N dias, tirada UM MÊS atrás. É o que as
  //                  consultas do agregado coletado comparam: engajamento,
  //                  posts/reels, e o gasto quando o ao vivo não responde.
  //   `plAnterior` → os N dias IMEDIATAMENTE anteriores (prevStartStr..prevEndStr,
  //                  as mesmas datas que já recortam o bruto de seguidores). É o
  //                  que o ao vivo compara, e também os stories.
  //
  // Cada `setCompare` escolhe o seu conforme a fonte do número anterior — não há
  // um rótulo "geral", porque não há uma janela só.
  const _mm = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
  const _fd = d => d.getDate() + ' ' + _mm[d.getMonth()]
  const pl = effectivePeriod <= 1 ? _fd(prevRefDate) : (() => { const s = new Date(prevRefDate.getTime() - effectivePeriod * 86400000); return _fd(s) + ' – ' + _fd(prevRefDate) })()
  const _fdIso = iso => _fd(new Date(iso + 'T12:00:00'))
  const plAnterior = prevStartStr === prevEndStr ? _fdIso(prevEndStr) : _fdIso(prevStartStr) + ' – ' + _fdIso(prevEndStr)
  return {
    followerTotal: (trueLastRows[0]?.followers_count ?? latest), newFollowers, prevNewFollowers, avgPerDay, bestDay: '—', engRate, followerDeltas, effectivePeriod, impressions, clicks, reach,
    chart: { gained: chartGained, lost: chartLost, labels: chartLabels, dates: chartDates },
    spend, prevSpend, cpsConsolidando, cpsPrevia, adEngagement, adLikes, adComments, adShares, adSaves,
    // Só o DENOMINADOR do custo por seguidor (o numerador é o investimento do
    // cartão). `divSeguidoresAnterior` é o do período anterior, para a comparação.
    divSeguidores: _divSeguidores, divSeguidoresAnterior: _prevGained,
    adsDiario: { inicio: followStart, fim: followEnd, linhasDeGasto: gastoDiarioRows, linhasDeSeguidores: seguidoresDiarioRows },
    // Recorte por balde: o que a barra desenha e o que o ao vivo tem de somar.
    baldesVazios, baldeEfetivo: _efetivo, idsParaAoVivo,
    // A frase embaixo da barra tem de dizer o que está REALMENTE valendo. Sem
    // estes três números ela dizia "Todas as campanhas (126)" logo acima de
    // cartões que falavam de 9 delas.
    campanhasNoRecorte: idsDoRecorte.length,
    campanhasDoBalde: idsDoBalde(_campanhas, _efetivo).length,
    campanhasNoTotal: _campanhas.length,
    // Quantas campanhas COM DINHEIRO NESTA JANELA ainda não têm conjunto
    // coletado — elas caem pelo objetivo, que às vezes engana (ver
    // desenharAvisoBalde). Só as que gastaram: campanha parada não move número
    // nenhum da tela, e avisar sobre ela deixaria a faixa acesa para sempre.
    campanhasSemTipo: campanhasSemTipoConfirmado(_campanhas, _idsComGastoNaJanela),
    // De quando é a captura recusada por ser de fora da janela exibida. A tela
    // escreve isso junto dos "—": traço sem motivo faz o dono procurar defeito.
    capturaAdsFora,
    // Sem nenhum conjunto coletado pra este perfil, toda campanha cai pela
    // regra do objetivo — provisório, não fechado (ver desenharAvisoBalde e
    // classificacaoEhProvisoria em baldes-do-painel.js, com o limite do RLS
    // documentado lá e testado ao lado).
    classificacaoProvisoria: _semConjuntoDeVerdade,
    // Nenhuma campanha no recorte → o cartão de dinheiro mostra "—", nunca o
    // total da conta. E o alcance avisa quando repete pessoa.
    recorteSemCampanha: _recorteSemCampanha, alcanceSomado,
    // Os números que os cartões de CADA balde dividem (ver cartoes-do-balde.js).
    // null = não coletado, e null vira "—" na tela — nunca zero.
    frequencia, conversas, cadastros, compras, visitas,
    eng: { likes: eng.likes, saves: eng.saves, shares: eng.shares, comments: eng.comments ?? 0, reach: eng.reach ?? 0, views: eng.views ?? 0, interactions: eng.total_interactions ?? 0, engaged: eng.accounts_engaged ?? 0, profileViews: eng.profile_views ?? 0, prevLikes: prevEng?.likes ?? null, prevSaves: prevEng?.saves ?? null, prevShares: prevEng?.shares ?? null, prevComments: prevEng?.comments ?? null, prevReach: prevEng?.reach ?? null, prevViews: prevEng?.views ?? null, prevInteractions: prevEng?.total_interactions ?? null, prevEngaged: prevEng?.accounts_engaged ?? null, prevProfileViews: prevEng?.profile_views ?? null },
    cnt: { posts: cnt.posts_count, stories: storiesCount, reels: cnt.reels_count, postsReels: cnt.posts_count + cnt.reels_count, prevPosts: prevCnt != null ? prevCnt.posts_count : null, prevReels: prevCnt != null ? prevCnt.reels_count : null, prevPostsReels: prevCnt != null ? prevCnt.posts_count + prevCnt.reels_count : null, prevStories: prevStoriesCount },
    storyEng: { shares: storyShares, replies: storyRep, prevShares: prevStoryShares, prevReplies: prevStoryRep, reach: storyReach, interactions: storyInter, navigation: storyNav, profileVisits: storyPV, follows: storyFol, navForward: storyNavF, navBack: storyNavB, navExit: storyNavE, navNext: storyNavN, prevReach: prevStoryReach, prevInteractions: prevStoryInter, prevNavigation: prevStoryNav, prevProfileVisits: prevStoryPV, prevFollows: prevStoryFol },
    pl, plAnterior,
    // Última coleta REAL do perfil (não o fim da janela) → frescor honesto em todo período.
    trueLastSnap: trueLastRows.length ? trueLastRows[0].captured_at : null,
    grossGained, grossLost, grossPartial, previaReal, partialSince: _partialSince, confirmadoIG, lastGrossDay,
    // ⚠️ DIAGNÓSTICO DO RECORTE (super-admin). Não é enfeite: em 09/09/2026 passei
    // horas deduzindo de onde cada número vinha, e o dono teve de repetir a mesma
    // queixa quatro vezes. Ver a janela e a fonte na tela responde em um olhar o
    // que a dedução não respondeu.
    diag: {
      ehCustom, periodo: String(period), effectivePeriod, storedPeriod,
      follow: `${followStart}→${followEnd}`,
      adsPd: _adsPd, adsDias: (_capDias || []).length, adsLinhas: _capLinhas,
    },
  }
}

/* ── ANÁLISE INTELIGENTE (legacy L3863-3984, verbatim) ── */
// Rótulos de período legíveis (evita "monthfullD"/"sofarD" etc.).
function _perShort(period, eff) {
  if (period === 0) return 'Hoje'
  if (period === 1) return 'Ontem'
  if (period === 'monthfull' || period === 'sofar') return 'Mês'
  if (period === 'lastmonth') return 'Mês passado'
  return (eff || period) + ' dias'
}
function _perPhrase(period, eff) {
  if (period === 'monthfull' || period === 'sofar') return 'no mês'
  if (period === 'lastmonth') return 'no mês passado'
  return 'em ' + (eff || period) + 'D'
}
function generateInsight(d, period, profileName) {
  const insights = []
  const nf = d.newFollowers, pnf = d.prevNewFollowers, avg = d.avgPerDay
  const likes = d.eng.likes, saves = d.eng.saves, shares = d.eng.shares, comments = d.eng.comments || 0
  const engTotal = likes + saves + shares + comments
  const prevEngTotal = (d.eng.prevLikes || 0) + (d.eng.prevSaves || 0) + (d.eng.prevShares || 0) + (d.eng.prevComments || 0)
  const engRate = parseFloat(d.engRate || '0')
  const reels = d.cnt.reels, posts = d.cnt.posts, stories = d.cnt.stories
  const totalContent = reels + posts + stories
  const stShares = d.storyEng.shares, stReplies = d.storyEng.replies
  const savesRate = engTotal > 0 ? saves / engTotal : 0
  const sharesRate = engTotal > 0 ? shares / engTotal : 0
  const r = pnf != null && pnf > 0 ? nf / pnf : null

  if (period === 0) {
    if (nf > 0 && r && r >= 1.5)
      insights.push({ t: 'green', s: `Ritmo acelerado hoje: +${nf} seguidor${nf !== 1 ? 'es' : ''} — ${Math.round((r - 1) * 100)}% acima do período anterior` })
    else if (nf > 0)
      insights.push({ t: 'blue', s: `+${nf} seguidor${nf !== 1 ? 'es' : ''} captados até agora` })
    else
      insights.push({ t: 'muted', s: `Nenhum seguidor novo registrado ainda hoje` })
    if (stories > 0) {
      if (stReplies >= 3) insights.push({ t: 'green', s: `${stories} storie${stories !== 1 ? 's' : ''} gerando conversa — ${stReplies} pessoas responderam via DM` })
      else if (stShares >= 3) insights.push({ t: 'blue', s: `${stories} storie${stories !== 1 ? 's' : ''} no ar com ${stShares} encaminhamentos` })
      else insights.push({ t: 'blue', s: `${stories} storie${stories !== 1 ? 's' : ''} publicado${stories !== 1 ? 's' : ''}hoje` })
    }
    if (reels > 0) insights.push({ t: 'green', s: `${reels} reel${reels !== 1 ? 's' : ''} no ar — formato de maior alcance orgânico` })
    else if (engTotal > 0) insights.push({ t: 'blue', s: `${fmtN(engTotal)} interações acumuladas hoje` })

  } else if (period === 1) {
    if (nf > 0 && r && r >= 1.3)
      insights.push({ t: 'green', s: `Ontem acelerou: +${nf} seguidor${nf !== 1 ? 'es' : ''} — ${pctDiff(nf, pnf)} acima do dia anterior` })
    else if (nf > 0 && r && r < 0.6)
      insights.push({ t: 'yellow', s: `Ontem abaixo do ritmo: +${nf} seguidor${nf !== 1 ? 'es' : ''} (${pctDiff(nf, pnf)} vs anterior)` })
    else if (nf > 0)
      insights.push({ t: 'blue', s: `Ontem: +${nf} novo${nf !== 1 ? 's' : ''} seguidor${nf !== 1 ? 'es' : ''}` })
    else
      insights.push({ t: 'muted', s: `Nenhum seguidor novo registrado ontem` })
    if (savesRate >= 0.15 && saves > 0)
      insights.push({ t: 'green', s: `${fmtN(saves)} salvamentos ontem — alto índice, conteúdo sendo guardado como referência` })
    else if (engTotal > 0) {
      const ep = prevEngTotal > 0 ? Math.round(((engTotal - prevEngTotal) / prevEngTotal) * 100) : null
      insights.push({
        t: ep != null && ep > 20 ? 'green' : ep != null && ep < -20 ? 'yellow' : 'blue',
        s: `${fmtN(engTotal)} interações ontem${ep != null ? ' (' + pctDiff(engTotal, prevEngTotal) + ' vs anterior)' : ''}`
      })
    }
    if (totalContent === 0)
      insights.push({ t: 'yellow', s: `Nenhum conteúdo publicado ontem — vale manter consistência diária` })
    else {
      const types = []
      if (reels > 0) types.push(`${reels} reel${reels !== 1 ? 's' : ''}`)
      if (posts > 0) types.push(`${posts} post${posts !== 1 ? 's' : ''}`)
      if (stories > 0) types.push(`${stories} storie${stories !== 1 ? 's' : ''}`)
      insights.push({ t: 'blue', s: types.join(', ') + ` publicado${totalContent !== 1 ? 's' : ''} ontem` })
    }

  } else {
    const ptx = _perPhrase(period, d.effectivePeriod)
    const epd = d.effectivePeriod || (typeof period === 'number' ? period : 1)
    if (nf > 0 && avg > 0 && r && r >= 1.5)
      insights.push({ t: 'green', s: `+${fmtN(nf)} seguidores ${ptx} — crescimento ${Math.round((r - 1) * 100)}% acima do período anterior (média +${avg}/dia)` })
    else if (nf > 0 && avg > 0 && r && r < 0.7)
      insights.push({ t: 'yellow', s: `+${fmtN(nf)} seguidores ${ptx} — ritmo desacelerou ${pctDiff(nf, pnf)} vs período anterior (média +${avg}/dia)` })
    else if (nf > 0)
      insights.push({ t: 'blue', s: `+${fmtN(nf)} seguidores ${ptx} — média de +${avg} novos por dia` })
    else
      insights.push({ t: 'muted', s: `Sem dados de crescimento disponíveis ${ptx}` })
    if (savesRate >= 0.15 && saves > 0)
      insights.push({ t: 'green', s: `Alto índice de salvamentos (${fmtN(saves)}) — conteúdo sendo guardado como referência de valor` })
    else if (sharesRate >= 0.12 && shares > 0)
      insights.push({ t: 'green', s: `Alto volume de compartilhamentos (${fmtN(shares)}) — conteúdo com alto potencial viral no período` })
    else if (engRate >= 5)
      insights.push({ t: 'green', s: `Taxa de engajamento em ${d.engRate}% — excelente, bem acima da média do setor` })
    else if (engRate >= 3)
      insights.push({ t: 'green', s: `Engajamento de ${d.engRate}% com ${fmtN(engTotal)} interações — muito bom ${ptx}` })
    else if (engRate >= 1)
      insights.push({ t: 'blue', s: `Engajamento de ${d.engRate}% ${ptx} — ${fmtN(likes)} curtidas · ${fmtN(saves)} salvamentos · ${fmtN(shares)} compartilhamentos` })
    else if (engRate > 0)
      insights.push({ t: 'yellow', s: `Engajamento abaixo de 1% ${ptx} — vale revisar formatos e horários de publicação` })
    if (totalContent === 0)
      insights.push({ t: 'yellow', s: `Nenhum conteúdo publicado ${ptx} — produção pausada no período` })
    else {
      const pubs = reels + posts
      const freq = (pubs / epd).toFixed(1)
      const parts = []
      if (reels > 0) parts.push(`${reels} reel${reels !== 1 ? 's' : ''}`)
      if (posts > 0) parts.push(`${posts} post${posts !== 1 ? 's' : ''}`)
      const freqLbl = parseFloat(freq) >= 0.7 ? ` — ritmo consistente (${freq}/dia)` : parseFloat(freq) >= 0.3 ? ` — ${freq}/dia` : ``
      if (parts.length > 0) insights.push({ t: 'blue', s: parts.join(' + ') + ` publicado${pubs !== 1 ? 's' : ''}${freqLbl}` })
    }
  }
  return insights.slice(0, 4)
}

function renderInsight(d, period) {
  const lbl = document.getElementById('insight-period-label')
  const list = document.getElementById('insight-list')
  if (!lbl || !list) return
  lbl.textContent = _perShort(period, d.effectivePeriod)
  const profileName = document.getElementById('apb-name')?.textContent || ''
  const items = generateInsight(d, period, profileName)
  list.textContent = ''
  items.forEach(item => {
    const row = document.createElement('div'); row.className = 'insight-item' + (item.t === 'muted' ? ' muted' : '')
    const dot = document.createElement('div'); dot.className = 'insight-dot ' + item.t
    const span = document.createElement('span'); span.textContent = item.s
    row.appendChild(dot); row.appendChild(span); list.appendChild(row)
  })
}

/* ── GUARDA DE FRESCOR: dado de hoje? senão, avisa (não mente em silêncio) (legacy L3987-4012, verbatim) ── */
function applyFreshness(lastSnapStr) {
  if (lastSnapStr !== undefined) window._lastSnap = lastSnapStr // guarda p/ reavaliação no relógio
  const banner = document.getElementById('freshness-banner')
  const status = document.getElementById('collection-status')
  if (!banner) return
  const snap = window._lastSnap
  if (snap === undefined) return // nenhum perfil carregado ainda
  const brt = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
  const today = `${brt.getFullYear()}-${String(brt.getMonth() + 1).padStart(2, '0')}-${String(brt.getDate()).padStart(2, '0')}`
  if (!snap) {
    banner.style.display = 'flex'
    banner.textContent = '⚠️ Sem dados coletados para este perfil.'
    if (status) { status.textContent = '⚠️ SEM DADOS'; status.style.color = 'var(--red)'; status.style.opacity = '1' }
    return
  }
  const diff = Math.round((new Date(today + 'T00:00:00') - new Date(snap + 'T00:00:00')) / 864e5)
  const br = snap.split('-').reverse().join('/')
  if (diff <= 0) {
    banner.style.display = 'none'
    if (status) { status.textContent = 'ATUALIZADO HOJE'; status.style.color = ''; status.style.opacity = '' }
  } else {
    banner.style.display = 'flex'
    banner.textContent = `⚠️ Dados desatualizados — última coleta ${br} (${diff} dia${diff > 1 ? 's' : ''} atrás). O coletor pode estar parado (verifique o token da Meta).`
    if (status) { status.textContent = `⚠️ DESATUALIZADO · ${br}`; status.style.color = 'var(--red)'; status.style.opacity = '1' }
  }
}

/* ── INFO: como contamos novos seguidores (modal do "?") (legacy L4015-4042, verbatim) ── */
function openFollowersInfo() {
  const ov = document.createElement('div')
  // O id não muda nada visualmente — é o que permite o observador global de
  // trava-de-rolagem (observar-modais-legados.js) achar este modal: ele não
  // tinha nome nenhum antes, e sem um seletor estável a rolagem do fundo não
  // travaria enquanto ele estivesse aberto.
  ov.id = 'rs-followers-info-ov'
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:99999;display:flex;align-items:center;justify-content:center;padding:18px;padding-top:max(16px,env(safe-area-inset-top));padding-bottom:max(16px,env(safe-area-inset-bottom));padding-left:max(12px,env(safe-area-inset-left));padding-right:max(12px,env(safe-area-inset-right));'
  ov.onclick = e => { if (e.target === ov) ov.remove() }
  const m = document.createElement('div')
  m.style.cssText = "background:var(--surface);max-width:470px;width:100%;max-height:calc(100dvh - 24px);overflow:auto;overscroll-behavior:contain;border-radius:16px;box-shadow:var(--shadow-lg);font-family:var(--fonte-principal);color:var(--text);"
  m.innerHTML =
    `<div style="padding:18px 20px;border-bottom:1px solid #eef2f7;display:flex;align-items:center;justify-content:space-between;gap:12px;">
      <div style="font-family:'Oswald',sans-serif;font-size:max(16px, calc(16px * var(--escala-texto, 1)));font-weight:600;letter-spacing:.5px;">COMO CONTAMOS OS NOVOS SEGUIDORES</div>
      <button class="btn" id="_fi_x" style="min-width:40px">✕</button>
    </div>
    <div style="padding:18px 20px;font-size:max(9px, calc(13px * var(--escala-texto, 1)));line-height:1.6;">
      <div style="background:color-mix(in srgb,var(--green) 12%,var(--surface));border:1px solid #86efac;border-radius:10px;padding:12px 14px;margin:0 0 14px;">
        <p style="margin:0 0 6px;"><b style="color:color-mix(in srgb,var(--green) 75%,var(--text));">✓ Confirmado pelo Instagram</b></p>
        <p style="margin:0;">O período já tem o número oficial do Instagram (<b>seguiram − deixaram de seguir</b>). É exatamente o que aparece no painel profissional — se conferir no app, vai bater.</p>
      </div>
      <div style="background:color-mix(in srgb,var(--orange) 10%,var(--surface));border:1px solid #fde68a;border-radius:10px;padding:12px 14px;margin:0 0 14px;">
        <p style="margin:0 0 6px;"><b style="color:color-mix(in srgb,var(--orange) 75%,var(--text));">⏳ Em consolidação</b></p>
        <p style="margin:0;">O Instagram ainda <b>não fechou</b> os números oficiais (seguiram/saíram) deste período. Isso costuma levar 1–2 dias, mas às vezes a Meta <b>atrasa bastante</b>. Enquanto isso, mostramos a <b>variação real de seguidores</b> (quantos a conta tem a mais), que é sempre atual. Quando o Instagram fecha, o card vira <b>✓ confirmado</b> sozinho.</p>
      </div>
      <p style="margin:0 0 14px;"><b>Por que pode mudar ao confirmar?</b> A variação da contagem e o "seguiram − saíram" do Instagram são medidas um pouco diferentes (a contagem inclui também quem desativou/reativou a conta), então em dias de pico podem divergir.</p>
      <div style="background:color-mix(in srgb,var(--accent) 8%,var(--surface));border:1px solid color-mix(in srgb,var(--accent) 30%,var(--surface));border-radius:10px;padding:12px 14px;">
        <p style="margin:0;"><b style="color:var(--accent);">Na prática:</b> o número <b>✓ confirmado</b> é o oficial do Instagram (use para apresentar). O <b>⏳ em consolidação</b> é o crescimento real mais recente, que o Instagram ainda vai oficializar.</p>
      </div>
    </div>`
  ov.appendChild(m); document.body.appendChild(ov)
  m.querySelector('#_fi_x').onclick = () => ov.remove()
}

// ── ABAS DE ENGAJAMENTO (Geral/Reels/Posts/Stories/Anúncios) ──
let _engTab = 'geral'
let _engCtx = null
const _IMAP = { likes: 'curtidas', comments: 'comentarios', saves: 'salvamentos', shares: 'compartilhamentos' }
function setEngTab(tab) {
  _engTab = tab
  document.querySelectorAll('#eng-tabs .eng-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab))
  renderInteracoes()
}
function renderInteracoes() {
  const ctx = _engCtx; if (!ctx) return
  const tab = _engTab
  const ehStory = tab === 'story', ehAd = tab === 'ad', ehGeral = tab === 'geral'
  // Visibilidade por aba: Stories = Curtidas + Compart. + Respostas; cards de conta só na Geral.
  const _mostra = (id, show) => { const el = document.getElementById(id); const c = el ? el.closest('.card') : null; if (c) c.style.display = show ? '' : 'none' }
  _mostra('eng-likes', true) // curtidas em todas as abas (na Stories = curtidas de STORY, fatia media_product_type=STORY)
  _mostra('eng-comments', !ehStory)
  _mostra('eng-saves', !ehStory)
  const cardRepl = document.getElementById('card-replies'); if (cardRepl) cardRepl.style.display = ehStory ? '' : 'none'
  // Na aba GERAL, os 4 cards de interação mostram 3 linhas iguais (Orgânico/Anúncios/Total); outras abas = número grande.
  ;['likes', 'comments', 'saves', 'shares'].forEach(k => {
    const io = ctx.inter ? ctx.inter[_IMAP[k]] : null
    const big = document.getElementById('eng-' + k), lin = document.getElementById(k + '-linhas')
    if (big) big.style.display = ehGeral ? 'none' : ''
    if (lin) lin.style.display = ehGeral ? '' : 'none'
    if (ehGeral && io) {
      animCount(document.getElementById(k + '-org'), naoNeg(io.org))
      animCount(document.getElementById(k + '-ad'), naoNeg(io.ad))
      const totEl = document.getElementById(k + '-total')
      const geralNN = naoNeg(io.geral)
      animCount(totEl, geralNN)
      // Total com a cor condicional de meta (verde/amarelo/laranja/vermelho conforme % da meta).
      const g = getGoal(k), col = _PERF_VAR[perfColor(g > 0 ? (geralNN / g) * 100 : 0)] || ''
      if (totEl && col) { totEl.style.setProperty('color', col, 'important'); totEl.style.setProperty('-webkit-text-fill-color', col, 'important') }
    }
  })
  // Nota da API (só curtidas de anúncio não têm relatório): na Geral já está na linha de Anúncios; nos Anúncios mostra embaixo.
  const obsLikes = document.getElementById('obs-likes-ad'); if (obsLikes) obsLikes.style.display = ehAd ? '' : 'none'
  // Alcance/Visualizações/Interações totais/Visitas ao perfil (nível conta) → só na aba Geral.
  ;['eng-reach', 'eng-views', 'eng-interactions', 'eng-profile-views'].forEach(id => _mostra(id, ehGeral))
  ;['likes', 'comments', 'saves', 'shares'].forEach(k => {
    if (ehStory && k !== 'shares' && k !== 'likes') return // Stories: curtidas (de story) + compartilhamentos
    const key = _IMAP[k]
    const io = ctx.inter ? ctx.inter[key] : null
    // valor da aba: live tem por-tipo; sem live só a aba Geral (coletado). Negativo (glitch) → 0.
    const val = naoNeg(io ? (io[tab] != null ? io[tab] : io.geral) : ((tab === 'geral') ? (ctx.eng[k] || 0) : 0))
    animCount(document.getElementById('eng-' + k), val)
    // comparativo: mesmo tipo na janela anterior.
    const ioAnt = ctx.ant ? ctx.ant[key] : null
    const prev = ioAnt ? (ioAnt[tab] != null ? ioAnt[tab] : ioAnt.geral) : ((tab === 'geral') ? ctx.eng['prev' + k.charAt(0).toUpperCase() + k.slice(1)] : null)
    setCompare('cmp-' + k, val, prev != null ? naoNeg(prev) : null, '', ctx.pl, false)
    applyMetric(k, val, getGoal(k))
  })
  // Respostas (só na aba Stories) — métrica de conta ao vivo.
  if (ehStory) {
    const val = naoNeg(ctx.respostas != null ? ctx.respostas : 0)
    animCount(document.getElementById('eng-replies'), val)
    setCompare('cmp-replies', val, ctx.respostasAnt != null ? naoNeg(ctx.respostasAnt) : null, '', ctx.plRespostas || ctx.pl, false)
    applyMetric('replies', val, getGoal('replies'))
  }
}

/* ── MAIN UPDATE (legacy L4045-4157, verbatim) ── */
function update(d, period) {
  const pl = d.pl                     // janela de um mês atrás (agregado coletado)
  const plAnt = d.plAnterior || d.pl  // janela imediatamente anterior (ao vivo, bruto, stories)
  // Balde sem gasto no período fica apagado, com o motivo. A conta usa o gasto
  // COLETADO por campanha (o ao vivo não sabe separar por tipo). `baldeEfetivo`
  // é o que as consultas REALMENTE usaram — pode ser Todos, quando o escolhido
  // não tem dinheiro neste perfil.
  desenharBaldeBar(d.baldesVazios || [], d.baldeEfetivo)
  // Dois avisos possíveis, o do perfil inteiro e o das campanhas soltas — ver
  // desenharAvisoBalde.
  desenharAvisoBalde(d.classificacaoProvisoria, d.campanhasSemTipo || 0)
  // A frase embaixo da barra segue o tipo de campanha que REALMENTE valeu, e é
  // reescrita a cada update — sem isso ela ficava congelada no que foi pintado na
  // troca de perfil e contradizia os cartões.
  updateCampaignFilterBadge(d.campanhasNoRecorte, d.campanhasNoTotal, d.baldeEfetivo, d.campanhasDoBalde)
  applyFreshness(d.trueLastSnap) // frescor = última coleta REAL do coletor, igual em qualquer período
  const totalEl = document.getElementById('total-followers'); if (totalEl) animCountFull(totalEl, (d.live ? d.live.followers_count : d.followerTotal))
  // Status ao vivo × fallback honesto (nunca esconde que é dado coletado quando a Meta falha).
  const _lsu = document.getElementById('live-status')
  if (_lsu) {
    if (d.live) { _lsu.style.color = 'var(--green)'; _lsu.textContent = '● ao vivo (Meta)' }
    else {
      let q = ''
      try { q = new Date(d.trueLastSnap).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) } catch (e) {}
      _lsu.style.color = 'var(--orange)'; _lsu.textContent = '⚠ ao vivo indisponível — última coleta ' + q
    }
  }
  // RESILIENTE: se o período está confirmado pela Meta (bruto cobre a janela) → número oficial = IGUAL ao IG.
  // Senão (Meta atrasada/sem dado) → variação real da contagem, marcada "em consolidação". Nunca zera.
  // AO VIVO (exato da Meta) quando disponível; senão cai na lógica de consolidação do coletado.
  // EXCEÇÃO Hoje/1D: a quebra seguiu/deixou da Meta ainda assenta → total = LÍQUIDO real por delta da
  // contagem (previaReal) + selo "consolidando". SÓ vale pra Hoje/1D; demais períodos seguem validados.
  const _ehContexto = ehGraficoDeContexto(period, currentStartDate, currentEndDate)
  const ehRecenteLive = !!d.live && _ehContexto
  const confirmado = ehRecenteLive ? false : (d.live ? true : d.confirmadoIG)
  // Hoje/1D: usa o líquido AO VIVO (mesma fonte do gráfico → card e gráfico batem); fallback previaReal.
  const _netRec = (d.netRecente && _ehContexto) ? (period === 0 ? d.netRecente.hoje : d.netRecente.ontem) : null
  // ⚠️ O DIA QUE A META NÃO PUBLICOU ENTRA PELA ESTIMATIVA — regra do dono
  // (09/09/2026): "Dia 8 n pode ficar zerado". Sem isto o card mostrava 883 num
  // período em que o dia que faltava valia ~443, e ainda carimbava "confirmado".
  // ⚠️⚠️ O CARD É A SOMA DO GRÁFICO. Ordem do dono (09/09/2026): "o importante é o
  // card de novos seguidores bater sempre com o gráfico diário".
  //
  // O erro de origem era perseguir o painel profissional. Ele filtra OUTRO
  // período — medido pelo dono no painel dele: "últimos 7 dias" vai de 2 a 7, e
  // "5 a 8" mostra 4 a 7. Enquanto se tentava casar os dois, o card e o gráfico
  // DESTA tela divergiam entre si, que é o que a pessoa realmente vê: em
  // "últimos 7 dias" as barras somavam 1593 e o card mostrava 967, porque a janela
  // do card parava no dia 08 e deixava de fora os dois maiores dias.
  //
  // ⚠️ NENHUM CARD VAI BATER COM O PAINEL, e isso é esperado, não defeito. Quem
  // for conferir faz a conta pela janela que o painel mostrar.
  // ⚠️ "O CARD É A SOMA DO GRÁFICO" VALE ONDE O GRÁFICO É O PERÍODO. Em HOJE e
  // ONTEM o gráfico desenha os últimos 7 dias de CONTEXTO — uma barra só seria um
  // retângulo sem leitura — e somá-lo faria o card do dia mostrar a semana. Foi o
  // que aconteceu: "ontem" saiu 1,7 mil quando o dia tinha sido 443 (09/09/2026).
  const _somaBarras = _ehContexto ? null : totalPelasBarras(d.chart)
  const _temBuraco = !!(_somaBarras && _somaBarras.estimado)
  const headlineVal = _somaBarras
    ? _somaBarras.total
    // Sem gráfico não há de onde somar: mantém o caminho de sempre em vez de
    // imprimir zero, que seria afirmar "não seguiu ninguém".
    : (ehRecenteLive
      ? (_netRec != null ? _netRec : (d.previaReal != null ? d.previaReal : d.live.novos.total))
      : (d.live ? d.live.novos.total : (confirmado ? d.newFollowers : (d.previaReal != null ? d.previaReal : d.newFollowers))))
  const newEl = document.getElementById('new-followers-val'); if (newEl) animCount(newEl, headlineVal) // Total (líquido)
  // O NÚMERO precisa PARECER provisório quando é provisório.
  //
  // O selo "em consolidação" existia e o dono, com razão, achou discreto: o número
  // saía no MESMO azul confiante do "total de seguidores" (que é final), e o olho lê
  // os dois como fatos da mesma natureza. Quando o Instagram ainda não fechou o dia,
  // o número muda de cor e ganha o rótulo "parcial" colado nele — a ressalva chega
  // junto com o número, não seis linhas abaixo.
  // ⚠️ O SELO NÃO PODE AFIRMAR O QUE A TELA NÃO SABE. Até 09/09/2026 o card
  // carimbava "✓ confirmado pelo Instagram" sempre que o ao vivo respondia —
  // inclusive quando faltava um dia inteiro dentro da janela.
  const _provisorio = ehRecenteLive || _temBuraco
  if (newEl) newEl.classList.toggle('nf-em-consolidacao', _provisorio)
  const provEl = document.getElementById('nf-provisorio')
  if (provEl) {
    provEl.hidden = !_provisorio
    // ⚠️ CURTO: o selo é `white-space:nowrap` e a tela se mede a 375px. A frase
    // inteira ("o Instagram ainda não publicou o dia X") vai no title, que é onde
    // cabe — o selo precisa caber ao lado do número sem empurrar a linha.
    if (_temBuraco && !ehRecenteLive && (d.semPublicacao || []).length) {
      // ⚠️ OS DIAS VÊM DE `semPublicacao`, a MESMA lista que a nota do gráfico usa.
      // Antes vinha de `_falta`, que deixou de existir quando o card passou a ser a
      // soma do gráfico — e a referência órfã derrubava a tela inteira em tempo de
      // execução: tudo zerado e nem a faixa de diagnóstico aparecia. Nem o build
      // nem os testes pegam variável apagada dentro de um .vue (09/09/2026).
      const _dd = (d.semPublicacao || []).map((x) => { const t = String(x).split('-'); return t[2] + '/' + t[1] })
      provEl.textContent = _dd.length === 1 ? `≈ falta ${_dd[0]}` : `≈ faltam ${_dd.length} dias`
      provEl.title = `O Instagram ainda não publicou ${_dd.length === 1 ? 'o dia' : 'os dias'} `
        + `${_dd.join(', ')}. O saldo desse${_dd.length === 1 ? '' : 's'} dia${_dd.length === 1 ? '' : 's'} `
        + 'entrou pela variação da contagem total, que é estimativa — não separa quem seguiu de quem saiu.'
    } else {
      provEl.textContent = 'parcial'
      provEl.removeAttribute('title')
    }
  }
  // 3 linhas de fonte igual: Seguidores · Deixaram de seguir · Total.
  const gEl = document.getElementById('nf-gained'), lEl = document.getElementById('nf-lost')
  // Hoje/1D: a Meta ainda não fechou a quebra seguiu/deixou → esconde essas 2 linhas e mostra só o Total (líquido).
  const gRow = gEl && gEl.closest('.nf-linha'), lRow = lEl && lEl.closest('.nf-linha')
  if (gRow) gRow.style.display = ehRecenteLive ? 'none' : ''
  if (lRow) lRow.style.display = ehRecenteLive ? 'none' : ''
  if (_somaBarras) {
    // ⚠️ AS TRÊS LINHAS SAEM DA MESMA SOMA. Se "Seguidores" viesse do ao vivo e o
    // "Total" das barras, as três linhas do cartão não fechariam entre si — que é
    // o defeito que este trabalho inteiro veio consertar.
    //
    // ⚠️ COM DIA ESTIMADO, `seguiu`/`deixou` são APROXIMADOS: a barra estimada
    // guarda só o líquido, e a quebra "quem seguiu / quem saiu" daquele dia é
    // justamente o que a Meta não publicou. O total é que continua certo.
    if (gEl) animCount(gEl, _somaBarras.seguiu)
    if (lEl) animCount(lEl, _somaBarras.deixou)
  } else if (d.live) {
    if (gEl) animCount(gEl, d.live.novos.seguiu)
    if (lEl) animCount(lEl, d.live.novos.deixou)
  } else if (confirmado) {
    if (gEl) animCount(gEl, d.grossGained)
    if (lEl) animCount(lEl, d.grossLost)
  } else {
    if (gEl) { gEl.textContent = '—'; gEl.removeAttribute('title'); gEl.classList.remove('tem-tooltip') }
    if (lEl) { lEl.textContent = '—'; lEl.removeAttribute('title'); lEl.classList.remove('tem-tooltip') }
  }
  // Selo de status: ✓ confirmado pelo IG (verde) ou ⏳ em consolidação (âmbar — número é a contagem real).
  const prevEl = document.getElementById('previa-followers')
  if (prevEl) {
    prevEl.style.display = 'block'
    if (confirmado) {
      prevEl.innerHTML = `<span style="display:inline-flex;align-items:center;gap:5px;font-size:max(9px, calc(10.5px * var(--escala-texto, 1)));font-weight:800;color:color-mix(in srgb,var(--green) 75%,var(--text));background:color-mix(in srgb,var(--green) 12%,var(--surface));border:1px solid #86efac;border-radius:6px;padding:2px 8px;">✓ confirmado pelo Instagram</span>`
    } else {
      prevEl.innerHTML = `<span style="display:inline-flex;align-items:center;gap:5px;font-size:max(9px, calc(10.5px * var(--escala-texto, 1)));font-weight:800;color:color-mix(in srgb,var(--orange) 75%,var(--text));background:color-mix(in srgb,var(--orange) 12%,var(--surface));border:1px solid #fcd34d;border-radius:6px;padding:2px 8px;">⏳ em consolidação</span>` +
        `<div style="font-size:max(9px, calc(9.5px * var(--escala-texto, 1)));line-height:1.35;color:var(--muted);font-weight:500;margin-top:3px;">Número pela variação real de seguidores. O Instagram ainda não fechou os números oficiais (seguiram/saíram) deste período — quando fechar, aparece o ✓ confirmado.</div>`
    }
  }
  buildChart(d.chart)
  // ⚠️ FAIXA FIXA NO TOPO, CRIADA AQUI. A nota sob o gráfico foi tentada duas vezes
  // e o dono não a viu nenhuma: primeiro por estar atrás de `is_superadmin`, depois
  // porque o roteador apagava o `?diag=1`. Instrumentação que a pessoa não acha não
  // serve. Esta não depende de elemento no template, não rola com a página, e sai
  // no console junto — se a faixa falhar, o console tem.
  try {
    const _ligado = localStorage.getItem('rbv_diag') === '1'
      || new URLSearchParams(window.location.search).get('diag') === '1'
    if (_ligado && d.diag) {
      const _txt = `recorte: ${d.diag.ehCustom ? 'PERSONALIZADO' : 'periodo ' + d.diag.periodo}`
        + ` · janela ${d.diag.follow} (${d.diag.effectivePeriod} dia(s))`
        + ` · seguidores: ${_somaBarras ? 'soma de ' + ((d.chart && d.chart.gained || []).length) + ' barra(s)' : 'caminho antigo'}`
        + ` · ads: period_days=${d.diag.adsPd}, ${d.diag.adsDias} dia(s), ${d.diag.adsLinhas} linha(s)`
        + ` · snapshot engajamento: ${d.diag.storedPeriod}d · ao vivo: ${d.live ? 'sim' : 'NAO'}`
      console.log('%c🔧 DIAGNÓSTICO ' + _txt, 'background:#7a0025;color:#fff;padding:2px 6px')
      let _f = document.getElementById('rbv-diag-faixa')
      if (!_f) {
        _f = document.createElement('div')
        _f.id = 'rbv-diag-faixa'
        _f.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#7a0025;color:#fff;'
          + 'font:600 12px/1.4 monospace;padding:6px 10px;white-space:pre-wrap;word-break:break-word;'
          + 'box-shadow:0 2px 8px rgba(0,0,0,.35);cursor:pointer'
        _f.title = 'Clique para esconder. Para desligar de vez, abra o endereço com ?diag=0'
        _f.onclick = () => { _f.style.display = 'none' }
        document.body.appendChild(_f)
      }
      _f.style.display = ''
      _f.textContent = '🔧 ' + _txt
    }
  } catch (e) {}
  montarNotaDeEstimativa(d.semPublicacao, d.diag && {
    ...d.diag,
    aoVivo: !!d.live,
    fonteSeguidores: _somaBarras ? `soma de ${(d.chart && d.chart.gained || []).length} barra(s)` : 'caminho antigo',
  })
  // Comparação só quando confirmado (no período em consolidação o "anterior" do bruto distorceria).
  const cmpEl = document.getElementById('cmp-followers')
  // AO VIVO: compara total atual vs total do período ANTERIOR (exato, mesma janela). Senão, coletado.
  // Os DOIS caminhos comparam com o período imediatamente anterior: o ao vivo
  // porque a edge recebe essa janela, e o coletado porque `prevNewFollowers` sai
  // de prevStartStr..prevEndStr. Por isso os dois levam `plAnt`.
  if (d.live) setCompare('cmp-followers', d.live.novos.total, d.live.anterior ? d.live.anterior.novos.total : null, '', plAnt, false)
  else if (confirmado) setCompare('cmp-followers', d.newFollowers, d.prevNewFollowers, '', plAnt, false)
  else if (cmpEl) cmpEl.innerHTML = ''
  // Nota de desempenho SÓ com número fechado.
  //
  // O applyMetric pintava "0% ↓ 270 abaixo da meta" em vermelho de alarme mesmo com
  // o dia em consolidação — ou seja, o card afirmava um fracasso com base num número
  // que ele PRÓPRIO diz não estar fechado (o selo "em consolidação" está logo acima).
  // Dar nota assim é pior que não dar: o vermelho é uma conclusão, e não havia dado
  // pra concluir.
  if (ehRecenteLive) aplicarMetaEmConsolidacao('followers', headlineVal, getGoal('followers'))
  else applyMetric('followers', headlineVal, getGoal('followers'))
  const engTotal = d.eng.likes + d.eng.saves + d.eng.shares + (d.eng.comments || 0)
  const prevEngTotal = d.eng.prevLikes + d.eng.prevSaves + d.eng.prevShares + (d.eng.prevComments || 0)
  const _avgShown = (d.effectivePeriod > 0 ? (headlineVal / d.effectivePeriod) : headlineVal).toFixed(1)
  setChips('chips-followers', ['Média: +' + _avgShown + '/dia', 'Taxa de eng.: ' + d.engRate + '%', 'Engajamento total: ' + fmtN(engTotal)])
  // Investimento AO VIVO = gasto das campanhas do recorte (exato). null = perfil sem ads.
  //
  // Quando NÃO há campanha nenhuma no recorte, o ao vivo não pode falar: a edge lê
  // lista vazia como "a conta inteira", então aceitar o número dela aqui mostraria
  // o gasto total sob o rótulo de um recorte que não tem ninguém dentro. Nesse
  // estado o cartão fica em "R$ —", que é a verdade.
  const _inv = d.recorteSemCampanha ? 0 : ((d.live && d.live.investimento != null) ? d.live.investimento : d.spend)
  const _invAnt = d.recorteSemCampanha ? null : ((d.live && d.live.anterior) ? d.live.anterior.investimento : d.prevSpend)
  // O alcance DEDUPLICADO só existe no total da conta. Com um balde escolhido (ou
  // filtro manual) a tela soma o alcance de cada campanha, e aí quem viu dois
  // anúncios é contado duas vezes — chegava a ~35% a mais no real. Como a tela
  // abre em Seguidores, esse é o caso PADRÃO: o cartão diz isso com todas as
  // letras em vez de imprimir o número inflado como se fosse fato. Fica AQUI, e não
  // lá embaixo com os chips, porque o selo de cálculo dos cartões de alcance e de
  // frequência depende dele.
  const _alcanceRepete = !!d.alcanceSomado && d.reach > 0
  // ── OS CARTÕES DA SEÇÃO 02 TROCAM COM O BALDE ──
  // Quais indicadores aparecem sai de cartoes-do-balde.js: em Contatos não faz
  // sentido custo por seguidor, e em Vendas não existe um quarto indicador honesto.
  // A grade continua com os mesmos quatro lugares e os mesmos ids por dentro — o
  // que troca é o CONTEÚDO de cada um.
  //
  // Zero vira null de propósito nos números que o coletor grava com default 0
  // (alcance, impressões, interações): ali o 0 quase sempre quer dizer "não veio
  // dado", e "custou R$ 0,00" é justamente a mentira que este painel já publicou
  // por 17 horas. Onde o banco sabe diferenciar (conversas, cadastros, compras,
  // visitas — colunas sem default), o null vem do banco e o 0 é resposta de
  // verdade: passa direto.
  // ── E UM DENOMINADOR SÓ, PELA MESMA RAZÃO ──
  // O numerador já vinha do cartão; o denominador do custo por seguidor continuava
  // vindo do coletor, e os dois passaram a falar de momentos diferentes. Medido na
  // tela em 20/08/2026 (Raíssa, HOJE): o cartão mostrava 53 seguidores — a contagem
  // AO VIVO de agora menos a de ontem — e o custo dividia R$ 435,88 (ao vivo, do
  // minuto) por 26, que era a foto que o coletor tinha tirado de manhã. Saiu
  // R$ 16,76 onde a conta na mão dá R$ 8,22, e sem selo nenhum avisando.
  // Quem decide de onde sai o denominador é seguidores-do-custo.js, puro e testado.
  const _segCusto = seguidoresDoCusto({
    // ⚠️ O DENOMINADOR É O BRUTO DAS MESMAS BARRAS que o cartão soma — custo que
    // divide um número que não está na tela ninguém confere. Continua sendo o
    // BRUTO (quem seguiu), e não o líquido: custo de aquisição não desconta quem
    // saiu. Decisão do dono, 09/09/2026.
    live: d.live || _somaBarras
      ? { seguiu: _somaBarras ? _somaBarras.seguiu : d.live.novos.seguiu,
          anteriorSeguiu: d.live && d.live.anterior ? d.live.anterior.novos.seguiu : null }
      : null,
    ehRecenteLive,
    numeroImpresso: headlineVal,
    // Falta dia na janela → o bruto que serve de denominador está subestimado, e
    // o custo por seguidor sai alto demais. Não dá para corrigir o número; dá
    // para não fingir que ele está fechado.
    estimado: _temBuraco,
    coletado: { bruto: d.divSeguidores, brutoAnterior: d.divSeguidoresAnterior, previa: !!d.cpsPrevia },
  })
  const _numerosDoBalde = {
    // UM NUMERADOR SÓ, e é o que está na tela: o investimento do CARTÃO (ao vivo
    // quando existe), não o do banco. Os três custos do balde dividem exatamente
    // este número — inclusive o custo por seguidor, que antes dividia o gasto
    // coletado. Custo que não divide o número impresso acima dele é custo que
    // ninguém consegue conferir: a Vessel mostrava R$ 7.802 de investimento
    // enquanto os custos dividiam R$ 461,52.
    investimento: _inv > 0 ? _inv : null,
    seguidores: _segCusto.valor,
    interacoes: d.adEngagement > 0 ? d.adEngagement : null,
    curtidas: d.adLikes > 0 ? d.adLikes : null,
    conversas: d.conversas, cadastros: d.cadastros, compras: d.compras, visitas: d.visitas,
    alcance: d.reach > 0 ? d.reach : null,
    impressoes: d.impressions > 0 ? d.impressions : null,
    frequencia: d.frequencia,
  }
  // UM balde só manda em tudo o que vem abaixo: os cartões, as CHAVES das metas e
  // os gráficos de cada lugar da grade. Se `baldeEfetivo` faltasse, `chaveDeMeta` gravaria numa chave
  // fantasma ('undefined.spend') enquanto os cartões cairiam em Todos — a meta do
  // dono iria para uma linha que nenhuma tela lê de volta.
  const _balde = d.baldeEfetivo || _baldeAtual
  const _cartoes = cartoesDoBalde(_balde, _numerosDoBalde)
  // O rótulo do "vs" segue a FONTE do investimento anterior: ao vivo é o período
  // imediatamente anterior; sem ao vivo, `d.prevSpend` vem de um mês atrás.
  const _plInv = (d.live && d.live.anterior) ? plAnt : pl
  desenharCartoesDoBalde(_cartoes, { d, pl: _plInv, inv: _inv, invAnt: _invAnt, alcanceRepete: _alcanceRepete, balde: _balde, segCusto: _segCusto })
  // ── Gráficos diários (abaixo de cada cartão) ──
  // Um por LUGAR da grade, com o gráfico do cartão que caiu ali neste balde.
  // As metas são lidas lá dentro, na hora de desenhar, porque o dono edita o
  // BUDGET/META MÁX direto na tela (contenteditable).
  const _diario = d.adsDiario || { inicio: null, fim: null, linhasDeGasto: [], linhasDeSeguidores: [] }
  desenharGraficosDosCartoes(_cartoes, _balde, _diario)
  const adsChips = []
  if (d.impressions > 0) adsChips.push(fmtN(d.impressions) + ' impressões')
  if (d.clicks > 0) adsChips.push(fmtN(d.clicks) + ' cliques')
  if (d.reach > 0) adsChips.push(fmtN(d.reach) + ' alcance')
  if (_alcanceRepete) adsChips.push({ texto: 'esse alcance conta a mesma pessoa mais de uma vez', classe: 'sec-chip-nota' })
  // "—" SEM MOTIVO FAZ O DONO PROCURAR DEFEITO. Quando os cartões estão em traço
  // porque a última coleta deste tipo de campanha é de FORA do período exibido, é
  // isso que a linha diz — com a data. Antes desta obra a tela fazia o contrário:
  // imprimia aquela coleta velha como se fosse a semana (Breno Vale, 7D, "Site e
  // alcance": números de 08/06 rotulados como os últimos 7 dias).
  if (d.capturaAdsFora) {
    let _q = d.capturaAdsFora
    try { _q = new Date(d.capturaAdsFora + 'T00:00:00').toLocaleDateString('pt-BR') } catch (e) {}
    adsChips.push({ texto: 'a coleta mais recente deste tipo de campanha é de ' + _q + ', fora do período mostrado — por isso os cartões estão em "—"', classe: 'sec-chip-nota' })
  }
  if (!adsChips.length) adsChips.push('Sem dados de Ads no período')
  setChips('chips-ads', adsChips)
  const custoChips = []
  // UM NUMERADOR SÓ NA SEÇÃO INTEIRA — a mesma régua dos cartões, agora também
  // aqui embaixo. Estas linhas dividiam `d.spend` (o gasto COLETADO) enquanto os
  // cartões dividiam `_inv` (o ao vivo, quando existe). Em "Todos" os dois
  // apareciam juntos na tela: o cartão "CUSTO POR MIL IMPRESSÕES R$ X" e a
  // linha "CPM R$ Y", mesmo nome, mesmo denominador, números diferentes — e não
  // tinham como bater, porque a janela do ao vivo é de N dias e a do agregado
  // coletado era de N+1 — com o dia de HOJE, incompleto, dentro. Dois números com
  // o mesmo nome na mesma tela é o dono perguntando qual dos dois está errado.
  //
  // A CAUSA foi consertada no coletor em 20/08/2026 (ver janela-de-ads.js): as
  // capturas NOVAS já vêm com N dias completos. As antigas continuam de N+1, e
  // por isso os denominadores desta seção ainda encolhem um pouco a cada dia que
  // passa, até a janela exibida só conter captura nova.
  const _invChips = _inv > 0 ? _inv : 0
  if (d.clicks > 0 && _invChips > 0) custoChips.push('CPC ' + fmtR(_invChips / d.clicks))
  if (d.impressions > 0 && _invChips > 0) custoChips.push('CPM ' + fmtR(_invChips / d.impressions * 1000))
  // Este custo divide dinheiro por um alcance que pode repetir pessoa — então ele
  // sai barato demais. O rótulo avisa junto com o número, não seis linhas abaixo.
  if (d.reach > 0 && _invChips > 0) {
    custoChips.push(_alcanceRepete
      ? { texto: 'Custo/alcance ' + fmtR(_invChips / d.reach) + ' (com pessoa repetida)', classe: 'sec-chip-nota' }
      : 'Custo/alcance ' + fmtR(_invChips / d.reach))
  }
  if (d.adComments > 0 && _invChips > 0) custoChips.push('Custo/comentário ' + fmtR(_invChips / d.adComments))
  if (d.adSaves > 0 && _invChips > 0) custoChips.push('Custo/salvamento ' + fmtR(_invChips / d.adSaves))
  if (d.adShares > 0 && _invChips > 0) custoChips.push('Custo/compart. ' + fmtR(_invChips / d.adShares))
  if (!custoChips.length) custoChips.push('Sem custos no período')
  setChips('chips-ads-custo', custoChips)
  // Curtidas/Comentários/Salvamentos/Compart. por ABA (Geral/Reels/Posts/Stories/Anúncios). Guarda o contexto
  // e renderiza a aba ativa. AO VIVO tem o split por tipo; sem live, só a aba Geral (coletado).
  _engCtx = {
    inter: (d.live && d.live.interacoes) ? d.live.interacoes : null,
    ant: (d.live && d.live.anterior && d.live.anterior.interacoes) ? d.live.anterior.interacoes : null,
    respostas: (d.live && d.live.respostas != null) ? d.live.respostas : null,
    respostasAnt: (d.live && d.live.anterior && d.live.anterior.respostas != null) ? d.live.anterior.respostas : null,
    eng: d.eng,
    // Com o ao vivo, `ant` é o período imediatamente anterior; sem ele, os
    // `prev*` do coletado são de um mês atrás. O rótulo acompanha.
    pl: (d.live && d.live.anterior) ? plAnt : pl,
    plRespostas: plAnt, // respostas só existem ao vivo
  }
  renderInteracoes()
  // Cards novos (alcance/visualizações/interações/contas engajadas/visitas) — sem meta/progresso.
  // Alcance/Visualizações/Interações/Visitas: AO VIVO (exato) quando disponível; senão coletado.
  const engLive = d.live ? { reach: d.live.engajamento.reach, views: d.live.engajamento.views, interactions: d.live.engajamento.interacoes, profileViews: d.live.engajamento.visitas } : null
  const engAnt = (d.live && d.live.anterior) ? { reach: d.live.anterior.engajamento.reach, views: d.live.anterior.engajamento.views, interactions: d.live.anterior.engajamento.interacoes, profileViews: d.live.anterior.engajamento.visitas } : null
  ;[['reach', 'reach', 'prevReach'], ['views', 'views', 'prevViews'], ['interactions', 'interactions', 'prevInteractions'], ['profile-views', 'profileViews', 'prevProfileViews']].forEach(([id, k, pk]) => {
    const val = naoNeg(engLive ? (engLive[k] || 0) : (d.eng[k] || 0))
    const prevAcc = engAnt ? engAnt[k] : d.eng[pk]
    animCount(document.getElementById('eng-' + id), val)
    setCompare('cmp-' + id, val, prevAcc != null ? naoNeg(prevAcc) : null, '', engAnt ? plAnt : pl, false)
    applyMetric(id, val, getGoal(id))
  })
  const avgPerPost = d.cnt.posts > 0 ? Math.round(d.eng.likes / d.cnt.posts) : 0
  setChips('chips-eng', ['Taxa de eng.: ' + d.engRate + '%', 'Comentários: ' + fmtN(d.eng.comments || 0), 'Média curtidas/post: ' + fmtN(avgPerPost), prevEngTotal > 0 ? 'Total: ' + fmtN(engTotal) + ' vs ' + fmtN(prevEngTotal) + ' (' + pctDiff(engTotal, prevEngTotal) + ')' : 'Total engajamento: ' + fmtN(engTotal)])
  // Engajamento de Stories agora é a aba "Stories" da seção 03 (Engajamento) — seção separada removida.
  animCount(document.getElementById('cnt-stories'), d.cnt.stories)
  // Stories saem da soma diária de prevStartStr..prevEndStr — janela imediatamente
  // anterior. Posts e Reels, logo abaixo, vêm do agregado de um mês atrás.
  setCompare('cmp-stories', d.cnt.stories, d.cnt.prevStories, '', plAnt, false); applyMetric('stories', d.cnt.stories, getGoal('stories'))
  animCount(document.getElementById('cnt-posts'), d.cnt.posts)
  setCompare('cmp-posts', d.cnt.posts, d.cnt.prevPosts, '', pl, false); applyMetric('posts', d.cnt.posts, getGoal('posts'))
  animCount(document.getElementById('cnt-reels'), d.cnt.reels)
  setCompare('cmp-reels', d.cnt.reels, d.cnt.prevReels, '', pl, false); applyMetric('reels', d.cnt.reels, getGoal('reels'))
  const totalContent = d.cnt.postsReels + d.cnt.stories
  const ep = d.effectivePeriod || period
  setChips('chips-cnt', ['Total: ' + totalContent + ' publicações', 'Freq.: ' + (totalContent / ep).toFixed(1) + '/dia', d.cnt.prevPostsReels > 0 ? 'Posts+Reels ' + pctDiff(d.cnt.postsReels, d.cnt.prevPostsReels) + ' vs ' + pl : 'Posts+Reels no período: ' + d.cnt.postsReels])
  renderInsight(d, period)
  renderGoalBar(d)
  // Stories arc: anel no perfil ativo + atualiza todos os botões
  const apbRingWrap = document.getElementById('apb-ring-wrap')
  if (apbRingWrap) apbRingWrap.classList.toggle('has-stories', d.cnt.stories > 0)
  updateStoriesRings()
}

/* ── BUILD UI (legacy L4160-4208, verbatim) ── */
async function buildProfiles() {
  const _todas = await sb('accounts?order=name.asc&select=id,name,username,picture_url,accent_color')
  // Escopo por perfil de rede: só mostra os perfis permitidos (null = todos).
  const _perm = contasPermitidas()
  const accounts = _perm ? _todas.filter(a => _perm.includes(a.id)) : _todas
  accounts.forEach(acc => {
    if (acc.picture_url) ACCOUNT_PICS[acc.name] = acc.picture_url
    if (acc.accent_color && PROFILE_THEMES[acc.name]) { PROFILE_THEMES[acc.name].accent = acc.accent_color; PROFILE_THEMES[acc.name].light = acc.accent_color + '1a'; PROFILE_THEMES[acc.name].mid = acc.accent_color + '4d' }
  })
  const wrap = document.getElementById('profile-select')
  wrap.textContent = ''
  accounts.forEach((acc, idx) => {
    const btn = document.createElement('button'); btn.className = 'profile-btn' + (idx === 0 ? ' active' : ''); btn.dataset.id = acc.id
    const t = PROFILE_THEMES[acc.name] || { accent: '#1A3A6B' }
    const av = document.createElement('div'); av.className = 'av'; av.style.background = t.accent; av.dataset.accountId = acc.id
    if (acc.picture_url) { const img = document.createElement('img'); img.src = acc.picture_url; img.alt = acc.name.charAt(0); av.appendChild(img) }
    else { av.textContent = acc.name.charAt(0) }
    const ringWrap = document.createElement('div'); ringWrap.className = 'av-ring-wrap'; ringWrap.dataset.accountId = acc.id; ringWrap.appendChild(av)
    btn.appendChild(ringWrap); btn.appendChild(document.createTextNode(' ' + acc.username))
    btn.addEventListener('click', () => {
      document.querySelectorAll('.profile-btn').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      _acIdx = idx
      try { localStorage.setItem('dash_account', String(acc.id)) } catch (e) {}
      currentAccountId = acc.id; applyProfileTheme(acc.name); updateGoalDisplays(currentPeriod); metasFetchAll(acc.id); carregarBalde(acc.id); loadCampaignFilterBadge()
      const wrapper = document.querySelector('.wrapper')
      _fadeSwap(wrapper, () => refresh())
    })
    wrap.appendChild(btn)
  })
  _allAccounts = accounts
  if (accounts.length > 0) {
    let selIdx = 0
    try { const savedId = localStorage.getItem('dash_account'); if (savedId != null) { const i = accounts.findIndex(a => String(a.id) === savedId); if (i >= 0) selIdx = i } } catch (e) {}
    _acIdx = selIdx
    currentAccountId = accounts[selIdx].id; applyProfileTheme(accounts[selIdx].name); carregarBalde(accounts[selIdx].id)
    document.querySelectorAll('.profile-btn').forEach((b, i) => b.classList.toggle('active', i === selIdx))
    setTimeout(loadCampaignFilterBadge, 100)
  }
  updateStoriesRings()
}

async function updateStoriesRings() {
  try {
    // BRT: com toISOString() (UTC), das 21h à meia-noite a query pedia um dia que em
    // Brasília nem tinha começado → zero linhas → o anel sumia de TODOS os perfis.
    const today = hojeLocal()
    const rows = await sb(`content_snapshots?captured_at=eq.${today}&period_days=lte.1&select=account_id,stories_count&order=period_days.asc`)
    const hasStories = new Set((rows || []).filter(r => (r.stories_count || 0) > 0).map(r => String(r.account_id)))
    document.querySelectorAll('.av-ring-wrap[data-account-id]').forEach(wrap => {
      wrap.classList.toggle('has-stories', hasStories.has(String(wrap.dataset.accountId)))
    })
  } catch (e) {}
}

/* ── AUTO-CYCLE (legacy L4211-4306, verbatim, exceto os 4 document.
   addEventListener(...) do fim, que rodavam soltos no legado e aqui são
   registrados em onMounted/removidos em onUnmounted) ── */
let _allAccounts = []
let _acIdx = 0
let _acTimer = null
let _acCountdown = null
let _acInactivity = null
let _acSecsLeft = 0
let _acEnabled = (localStorage.getItem('ac_enabled') !== '0')
const AC_INACTIVITY = 5    // segundos sem mouse p/ ativar
const AC_DURATION = 40     // segundos por perfil

function _acSwitchTo(idx) {
  if (!_acEnabled) { _acStopCycle(); return }
  const wrapper = document.querySelector('.wrapper')
  _fadeSwap(wrapper, () => {
    _acIdx = idx
    const acc = _allAccounts[idx]
    document.querySelectorAll('.profile-btn').forEach((b, i) => b.classList.toggle('active', i === idx))
    // carregarBalde ANTES do refresh: o balde é POR PERFIL, e o refresh já
    // consulta com ele. Depois, o vitrine mostraria o perfil novo com o balde do
    // perfil anterior por uma rodada inteira.
    currentAccountId = acc.id; applyProfileTheme(acc.name); updateGoalDisplays(currentPeriod); metasFetchAll(acc.id); carregarBalde(acc.id); refresh(); loadCampaignFilterBadge()
    _acSecsLeft = AC_DURATION
  })
}

function _acStartCycle() {
  if (!_acEnabled || _acTimer || _allAccounts.length <= 1) return
  _acSecsLeft = AC_DURATION
  const prog = document.getElementById('autocycle-progress')
  prog.style.transition = 'none'; prog.style.width = '0%'
  requestAnimationFrame(() => {
    prog.style.transition = 'width ' + AC_DURATION + 's linear'
    prog.style.width = '100%'
  })
  _acCountdown = setInterval(() => {
    _acSecsLeft--
    const m = Math.floor(_acSecsLeft / 60)
    const s = String(_acSecsLeft % 60).padStart(2, '0')
    const el = document.getElementById('ac-countdown'); if (el) el.textContent = m + ':' + s
  }, 1000)
  _acTimer = setInterval(() => {
    _acSwitchTo((_acIdx + 1) % _allAccounts.length)
    _acSecsLeft = AC_DURATION
    prog.style.transition = 'none'; prog.style.width = '0%'
    requestAnimationFrame(() => {
      prog.style.transition = 'width ' + AC_DURATION + 's linear'
      prog.style.width = '100%'
    })
  }, AC_DURATION * 1000)
}

function _acStopCycle() {
  clearInterval(_acTimer); clearInterval(_acCountdown)
  _acTimer = null; _acCountdown = null
  const badge = document.getElementById('autocycle-badge')
  const prog = document.getElementById('autocycle-progress')
  if (badge) badge.style.display = 'none'
  if (prog) { prog.style.transition = 'none'; prog.style.width = '0%' }
}

function _acResetInactivity() {
  if (!_acEnabled) return
  if (_acTimer) _acStopCycle()
  clearTimeout(_acInactivity)
  _acInactivity = setTimeout(_acStartCycle, AC_INACTIVITY * 1000)
}

function toggleAutoCycle() {
  _acEnabled = !_acEnabled
  const btn = document.getElementById('ac-toggle-btn')
  const track = document.getElementById('ac-toggle-track')
  if (_acEnabled) {
    btn.classList.add('on'); track.classList.add('on')
    _acResetInactivity()
  } else {
    btn.classList.remove('on'); track.classList.remove('on')
    _acStopCycle()
    clearTimeout(_acInactivity); _acInactivity = null
  }
  localStorage.setItem('ac_enabled', _acEnabled ? '1' : '0')
}

function initAutoCycleToggle() {
  const saved = localStorage.getItem('ac_enabled')
  if (saved === '0') {
    _acEnabled = false
    const btn = document.getElementById('ac-toggle-btn')
    const track = document.getElementById('ac-toggle-track')
    if (btn) btn.classList.remove('on')
    if (track) track.classList.remove('on')
    _acStopCycle(); clearTimeout(_acInactivity); _acInactivity = null
  }
}

/* ── PERÍODOS / HEADER / METAS (legacy L4307-4347, verbatim) ── */
let _hojeTimer = null
function buildPeriodTabs() {
  const wrap = document.getElementById('period-tabs')
  wrap.innerHTML = ''
  PERIODS.forEach(p => {
    const btn = document.createElement('button'); btn.className = 'ptab' + (p.value === currentPeriod ? ' active' : '')
    if (p.value === 0) { const dot = document.createElement('span'); dot.style.cssText = 'display:inline-block;width:5px;height:5px;border-radius:50%;background:var(--green);margin-right:5px;animation:pulse 2s infinite;vertical-align:middle;'; btn.appendChild(dot) }
    btn.appendChild(document.createTextNode(p.label))
    btn.addEventListener('click', () => {
      document.querySelectorAll('.ptab').forEach(b => b.classList.remove('active')); btn.classList.add('active')
      currentPeriod = p.value; try { localStorage.setItem('dash_period', String(p.value)); localStorage.removeItem(CHAVE_INTERVALO) } catch (e) {} currentStartDate = null; currentEndDate = null
      document.getElementById('custom-start').value = ''; document.getElementById('custom-end').value = ''; document.getElementById('custom-clear-btn').style.display = 'none'
      updateGoalDisplays(p.value); refresh()
      if (_hojeTimer) { clearInterval(_hojeTimer); _hojeTimer = null }
      if (p.value === 0) { _hojeTimer = setInterval(refresh, 10 * 60 * 1000) }
    })
    wrap.appendChild(btn)
  })
}
function toggleHeader() {
  const c = document.getElementById('header-collapsible')
  const btn = document.getElementById('header-toggle')
  const isNowCollapsed = c.classList.toggle('collapsed')
  btn.querySelector('.ht-arrow').style.transform = isNowCollapsed ? 'rotate(180deg)' : 'rotate(0deg)'
  localStorage.setItem('hdr_collapsed', isNowCollapsed ? '1' : '0')
}
function restoreHeaderState() {
  if (localStorage.getItem('hdr_collapsed') === '1') {
    const c = document.getElementById('header-collapsible')
    const btn = document.getElementById('header-toggle')
    c.classList.add('collapsed')
    if (btn) btn.querySelector('.ht-arrow').style.transform = 'rotate(180deg)'
  }
}
// Reescreve o texto de TODA meta editável da tela quando o período muda ou quando
// as metas chegam do banco (metasFetchAll). São DUAS famílias, e as duas precisam
// ser percorridas:
//
// 1) as metas de sempre (seção 01 e as de GOALS): o id do elemento é fixo no HTML;
// 2) as DOS QUATRO CARTÕES da seção 02, cuja chave carrega o balde
//    ('contatos.custo_conversa'). Essas não estão em GOALS e nunca seriam
//    alcançadas percorrendo só ele — por isso os cartões são percorridos pelos
//    lugares da grade, com a chave que o desenho acabou de carimbar no id.
//    Aqui o texto sai de metaDefinida: sem meta o campo mostra "—", nunca 0 — um
//    0 na tela seria um alvo que ninguém pôs.
function updateGoalDisplays(period) {
  Object.keys(GOALS).forEach(k => { const el = document.getElementById('goal-' + k); if (el) el.textContent = loadGoal(k, period, currentAccountId) })
  SLOTS_DOS_CARTOES.forEach((slot) => {
    const pctEl = document.getElementById('pct-' + slot)
    const card = pctEl && pctEl.closest('.card'); if (!card) return
    const metaEl = card.querySelector('.mc-goal-val')
    if (!metaEl || !metaEl.id.startsWith('goal-') || metaEl.id.startsWith('goal-livre-')) return
    const chave = metaEl.id.slice('goal-'.length)
    const v = metaDefinida(chave, period, currentAccountId)
    metaEl.textContent = v == null ? '—' : String(v)
  })
}
function watchGoals() {
  document.querySelectorAll('.mc-goal-val').forEach(el => {
    el.addEventListener('blur', () => {
      const key = el.id.replace('goal-', '')
      // Cartão sem meta fica com id 'goal-livre-<lugar>' (ver desenharCartoesDoBalde).
      // Ele está escondido e não deveria receber foco, mas gravar 'livre-cps' seria
      // uma linha de lixo no social_metas do dono — e o banco aceitaria caladinho.
      if (!key || key.startsWith('livre-')) return
      saveGoal(key, el.textContent.trim()); updateGoalDisplays(currentPeriod); refresh()
    })
    el.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); el.blur() } })
  })
}
let _refreshId = 0
async function refresh() {
  if (!currentAccountId) return
  const myId = ++_refreshId
  const _ls = document.getElementById('live-status'); if (_ls) _ls.innerHTML = '<span style="opacity:.7">⟳ atualizando ao vivo…</span>'
  // PARALELO: coletado (gráficos/histórico) + KPIs ao vivo + série do gráfico — juntos, não em fila.
  //
  // ÚNICA exceção: o ao vivo espera o coletado. Quem classifica as campanhas em
  // baldes é o fetchData, e o ao vivo PRECISA somar exatamente o mesmo conjunto —
  // senão o cartão de investimento mostraria um balde e o de custo por seguidor,
  // outro. Os outros três continuam saindo junto, como sempre.
  const _pDados = fetchData(currentAccountId, currentPeriod, currentStartDate, currentEndDate)
  const [data, live, serie, seriePrev, collabs] = await Promise.all([
    _pDados,
    _pDados.then(d => buscarKpisAoVivo(currentAccountId, currentPeriod, currentStartDate, currentEndDate, d.idsParaAoVivo)),
    buscarSerieNovos(currentAccountId, currentPeriod, currentStartDate, currentEndDate),
    buscarSerieNovos(currentAccountId, currentPeriod, currentStartDate, currentEndDate, 1), // mesmos dias, mês anterior
    buscarCollabs(currentAccountId, currentPeriod, currentStartDate, currentEndDate), // posts/reels em collab (não vêm no /media)
  ])
  if (myId !== _refreshId) return
  data.live = live // null → a tela cai no coletado
  // Soma os COLLABS (posts/reels em parceria) na contagem de conteúdo.
  if (collabs && data.cnt) {
    data.cnt.posts = (data.cnt.posts || 0) + (collabs.posts || 0)
    data.cnt.reels = (data.cnt.reels || 0) + (collabs.reels || 0)
    data.cnt.collabs = (collabs.posts || 0) + (collabs.reels || 0)
  }
  // GRÁFICO novos/dia AO VIVO exato: só sobrescreve quando o KPI ao vivo funcionou (consistência).
  if (live && serie && serie.length) {
    const _d3 = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'], _m3 = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
    const _dfull = iso => { const dt = new Date(iso + 'T12:00:00'); return dt.getDate() + ' ' + _m3[dt.getMonth()] }
    const _lbl = iso => { const dt = new Date(iso + 'T12:00:00'); return dt.getDate() + '/' + (dt.getMonth() + 1) }
    // ⚠️ O PERSONALIZADO NUNCA CAI NESTES DOIS RAMOS. Ao escolher datas,
    // `currentPeriod` continua com o valor antigo (7, 30…) — decidir só por ele
    // punha o recorte personalizado no ramo dos rolantes, que cola "ontem" e
    // "hoje" no fim da série. Filtrando 5 a 8 de setembro, o dia 8 aparecia DUAS
    // vezes (dia da série + "ontem") e um dia 9 que ninguém pediu.
    const _ehCustom = !!(currentStartDate && currentEndDate)
    const _mesAtual = !_ehCustom && (currentPeriod === 'monthfull' || currentPeriod === 'sofar' || currentPeriod === 'month')
    const _rolante = ehRecorteRolante(currentPeriod, currentStartDate, currentEndDate)
    // ── DIA QUE O INSTAGRAM NÃO PUBLICOU → ESTIMATIVA, não zero ──
    //
    // A Edge Function serie-novos-dia agora devolve `publicado: false` quando a
    // Meta responde 200 sem número nenhum. Antes isso virava `seguiu:0, deixou:0`
    // e o gráfico desenhava uma barra zerada idêntica à de um dia em que ninguém
    // seguiu de verdade — foi o que o dono viu de 03 a 06/08/2026, nos 7 perfis.
    //
    // No lugar do zero entra o líquido pela variação da contagem total: é o saldo
    // real do dia, e vai MARCADO como estimativa (não separa quem seguiu de quem
    // saiu, porque esse dado é justamente o que não existe).
    //
    // Fica ANTES do if para valer nos DOIS caminhos. Mês passado e período
    // personalizado caem no `else` e ficariam com os zeros de volta — o defeito
    // reapareceria em quem olhasse um mês fechado.
    //
    // 100 dias de contagem total, e não os 6 de antes: os 6 só davam para hoje e
    // ontem. Um dia parado no meio do período precisa da contagem do DIA ANTERIOR
    // para ter de onde estimar; sem ela, volta a desenhar zero.
    const { data: tots } = await sbClient.from('daily_snapshots').select('captured_at,followers_count').eq('account_id', currentAccountId).order('captured_at', { ascending: false }).limit(100)
    if (myId !== _refreshId) return // trocou de período/perfil no meio → aborta este refresh
    const totMap = {}; (tots || []).forEach(t => { totMap[t.captured_at] = Number(t.followers_count) || 0 })
    // ⚠️ A CONTAGEM DE HOJE VEM DO AO VIVO, NÃO DA FOTO DO COLETOR. O coletor
    // roda 4x por dia; a foto dele fica velha em horas. Sem isto, a barra de hoje
    // no período personalizado mostrava 183 (foto da madrugada) enquanto o filtro
    // "hoje" mostrava 326 (ao vivo) — o MESMO DIA com dois números, que é
    // exatamente a confusão que o dono já tinha apontado em 09/09/2026.
    {
      const _hojeIso = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
      if (live && live.followers_count != null) totMap[_hojeIso] = Number(live.followers_count) || 0
    }
    const _brt = ms => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
    let semPublicacao = []
    if (_rolante || _mesAtual) {
      // TODOS os intervalos atuais/rolantes (Hoje/1D/3D/7D/14D/30D) e MÊS incluem HOJE e ONTEM como
      // BARRA LÍQUIDA no fim (só o nº líquido — a Meta ainda não fechou a quebra desses dias). MÊS PASS.
      // (mês fechado) e personalizado NÃO. Base: Hoje/1D = últimos 7 dias; demais = o próprio serie do intervalo.
      const baseSerie = (currentPeriod === 0 || currentPeriod === 1) ? ((await buscarSerieNovos(currentAccountId, 7, null, null)) || []) : (serie || [])
      const hoje = _brt(Date.now()), base = new Date(hoje + 'T12:00:00-03:00').getTime()
      const ontem = _brt(base - 86400000), anteontem = _brt(base - 2 * 86400000)
      const totHoje = live.followers_count != null ? live.followers_count : (totMap[hoje] ?? 0)
      const netOntem = (totMap[ontem] != null && totMap[anteontem] != null) ? (totMap[ontem] - totMap[anteontem]) : 0
      const netHoje = (totMap[ontem] != null) ? (totHoje - totMap[ontem]) : 0
      // Guarda os líquidos AO VIVO (mesma fonte do gráfico) p/ o card usar — senão card (coletado) e gráfico (ao vivo) divergem.
      data.netRecente = { hoje: netHoje, ontem: netOntem }
      // Hoje e ontem já entram como barra líquida logo abaixo, com a contagem AO
      // VIVO — por isso saem do estimador (senão viriam duas vezes, e a segunda
      // com o número do banco, mais velho que o ao vivo).
      const diasBase = baseSerie.map(s => barraDoDia(s, totMap, [hoje, ontem]))
      semPublicacao = diasSemPublicacao(baseSerie, [hoje, ontem])
      const dias = [...diasBase,
        { iso: ontem, g: netOntem >= 0 ? netOntem : 0, l: netOntem < 0 ? -netOntem : 0, net: true, est: false },
        { iso: hoje, g: netHoje >= 0 ? netHoje : 0, l: netHoje < 0 ? -netHoje : 0, net: true, est: false }]
      data.chart = {
        gained: dias.map(d => d.g), lost: dias.map(d => d.l), netOnly: dias.map(d => d.net),
        estimado: dias.map(d => !!d.est),
        labels: dias.map(d => _lbl(d.iso)), dates: dias.map(d => _dfull(d.iso)),
        prevSeguiu: null, prevDeixou: null, prevDates: null,
      }
    } else {
      // MÊS PASSADO e período PERSONALIZADO: sem hoje/ontem no fim (são janelas
      // fechadas), mas com a MESMA estimativa para dias que o Instagram não
      // publicou — senão o defeito voltaria a aparecer para quem olha um mês
      // fechado, que é justamente onde ninguém iria conferir.
      const curto = serie.length <= 7
      const barras = serie.map(s => barraDoDia(s, totMap))
      semPublicacao = diasSemPublicacao(serie)
      data.chart = {
        gained: barras.map(b => b.g), lost: barras.map(b => b.l),
        netOnly: barras.map(b => b.net), estimado: barras.map(b => !!b.est),
        // O rótulo é o dia do PRÓPRIO dado. Rotular um dia à frente fez o mesmo
        // dia mostrar dois números em filtros diferentes (09/09/2026).
        labels: serie.map(s => { const dt = new Date(s.label + 'T12:00:00'); return curto ? _d3[dt.getDay()] : _lbl(s.label) }),
        dates: serie.map(s => _dfull(s.label)),
        // comparativo: mesmos dias do MÊS ANTERIOR (por dia).
        prevSeguiu: seriePrev ? seriePrev.map(s => s.seguiu) : null,
        prevDeixou: seriePrev ? seriePrev.map(s => s.deixou) : null,
        prevDates: seriePrev ? seriePrev.map(s => _dfull(s.label)) : null,
      }
    }
    data.semPublicacao = semPublicacao
  }
  update(data, currentPeriod)
}
// Campos de data sempre visíveis: ao escolher AS DUAS datas, aplica sozinho (sem botão). O ✕ aparece pra limpar.
function onCustomDateChange() {
  const s = document.getElementById('custom-start').value, e = document.getElementById('custom-end').value
  document.getElementById('custom-clear-btn').style.display = (s || e) ? 'inline-flex' : 'none'
  if (!s || !e) return
  if (s > e) { alert('A data inicial deve ser anterior à data final.'); return }
  currentStartDate = s; currentEndDate = e
  try { localStorage.setItem(CHAVE_INTERVALO, JSON.stringify({ s, e })) } catch (err) {}
  document.querySelectorAll('.ptab').forEach(b => b.classList.remove('active'))
  refresh()
}
function clearCustomRange() {
  currentStartDate = null; currentEndDate = null
  try { localStorage.removeItem(CHAVE_INTERVALO) } catch (e) {}
  document.getElementById('custom-start').value = ''; document.getElementById('custom-end').value = ''
  document.getElementById('custom-clear-btn').style.display = 'none'
  document.querySelectorAll('.ptab').forEach((b, i) => { if (i === 1) b.classList.add('active') })
  currentPeriod = 7; updateGoalDisplays(7); refresh()
}

/* ── FADE SWAP — fetch-first, then smooth out→swap→in (legacy L5410-5422, verbatim) ── */
function _fadeSwap(el, swapFn) {
  el.style.transition = 'opacity .18s ease'
  el.style.opacity = '0'
  setTimeout(() => {
    swapFn()
    // 80ms buffer: let browser fully paint new DOM before fading in
    setTimeout(() => {
      el.style.transition = 'opacity .38s cubic-bezier(.22,1,.36,1)'
      el.style.opacity = '1'
      setTimeout(() => { el.style.transition = ''; el.style.opacity = '' }, 420)
    }, 80)
  }, 190)
}

/* ── RELÓGIO (legacy L5216-5236, verbatim exceto _clockTimer, que agora guarda
   o id do setInterval pra poder limpar no onUnmounted — ver nota no topo) ── */
function updateCollectionStatus() {
  // Status baseado no FRESCOR REAL do dado (não em horário agendado, que mentia
  // mostrando "coletou" mesmo com o coletor parado). Reavalia p/ pegar virada de dia.
  applyFreshness()
}
let _clockTimer = null
/* O RELÓGIO SAIU DA TELA (pedido do dono), mas o que ele fazia por baixo
   NÃO PODE SAIR JUNTO: era o tique dele que reavaliava a guarda de frescor a
   cada minuto — a faixa vermelha que avisa quando o dado não é de hoje.

   Se eu tivesse só apagado o elemento, `startClock` cairia no `if (!el) return`
   e o aviso congelaria no estado em que estivesse ao abrir a tela. Numa
   dashboard que fica ligada o dia inteiro numa TV, isso é exatamente o caso que
   ela precisa pegar.

   Então virou o que sempre foi de verdade: um verificador de frescor. Uma vez
   por minuto, sem desenhar nada. */
function startClock() {
  updateCollectionStatus()
  if (_clockTimer) clearInterval(_clockTimer)
  _clockTimer = setInterval(updateCollectionStatus, 60000)
}

/* ── META GERAL (barra única) (legacy L5240-5255, verbatim) ── */
function renderGoalBar(d) {
  const metrics = [
    { curr: d.newFollowers, goal: getGoal('followers') },
    { curr: d.eng.likes, goal: getGoal('likes') },
    { curr: d.cnt.postsReels + d.cnt.stories, goal: getGoal('posts') + getGoal('reels') },
  ]
  const valid = metrics.filter(m => m.goal > 0)
  const pct = valid.length > 0
    ? Math.min(100, Math.round(valid.reduce((s, m) => s + Math.min(100, m.curr / m.goal * 100), 0) / valid.length))
    : 0
  const color = pct >= 100 ? 'var(--green)' : pct >= 60 ? 'var(--accent)' : 'var(--orange)'
  const fill = document.getElementById('overall-bar-fill')
  const pctEl = document.getElementById('overall-bar-pct')
  if (fill) { fill.style.width = pct + '%'; fill.style.background = color; fill.style.boxShadow = pct >= 100 ? '0 0 7px #16a34a99,0 0 18px #16a34a33' : '' }
  if (pctEl) { pctEl.textContent = pct + '%'; pctEl.style.color = color }
}

/* ── ADMIN PANEL embutido no dashboard (legacy L5524-5579, verbatim).
   ATENÇÃO: toggleAdminPanel() não tem NENHUM gatilho no HTML do legado
   (conferido por grep exaustivo em legacy/index.html: só a própria definição
   e o loadUsers() usam o div #admin-panel) — o painel some no legado
   também, permanentemente escondido. Isso é pré-existente ao port (não foi
   introduzido aqui); ver relatório para detalhes. ── */
let adminPanelOpen = false
function toggleAdminPanel() {
  adminPanelOpen = !adminPanelOpen
  document.getElementById('admin-panel').style.display = adminPanelOpen ? 'block' : 'none'
  if (adminPanelOpen) loadUsers()
}
async function loadUsers() {
  const listEl = document.getElementById('user-list')
  listEl.textContent = ''
  const { data: { session } } = await sbClient.auth.getSession()
  const token = session?.access_token || SUPABASE_ANON_KEY
  const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles?order=created_at.asc&select=id,email,name,role`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` }
  })
  const users = await r.json()
  if (!Array.isArray(users) || users.length === 0) { listEl.innerHTML = '<div style="font-family:var(--fonte-principal);font-size:max(9px, calc(11px * var(--escala-texto, 1)));color:var(--muted)">Nenhum usuário.</div>'; return }
  users.forEach(u => {
    const row = document.createElement('div'); row.className = 'user-row'
    const info = document.createElement('div'); info.className = 'user-info'
    const emailSpan = document.createElement('span'); emailSpan.className = 'user-email'; emailSpan.textContent = u.email || ''
    const nameSpan = document.createElement('span'); nameSpan.className = 'user-name'; nameSpan.textContent = u.name || '—'
    info.appendChild(emailSpan); info.appendChild(nameSpan)
    const sel = document.createElement('select'); sel.className = 'user-role-select'
    sel.innerHTML = '<option value="viewer"' + (u.role === 'viewer' ? ' selected' : '') + '>Visualizador</option><option value="admin"' + (u.role === 'admin' ? ' selected' : '') + '>Admin</option>'
    sel.addEventListener('change', async () => {
      const { data: { session } } = await sbClient.auth.getSession()
      const tok = session?.access_token || SUPABASE_ANON_KEY
      await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${u.id}`, {
        method: 'PATCH',
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify({ role: sel.value })
      })
    })
    row.appendChild(info); row.appendChild(sel); listEl.appendChild(row)
  })
}
async function doInvite() {
  const email = document.getElementById('invite-email').value.trim()
  const msgEl = document.getElementById('invite-msg')
  const btn = document.getElementById('invite-btn')
  if (!email) { msgEl.textContent = 'Informe o e-mail.'; msgEl.className = 'admin-msg err'; msgEl.style.display = 'block'; return }
  msgEl.style.display = 'none'; btn.disabled = true; btn.textContent = 'Enviando...'
  const { data: { session } } = await sbClient.auth.getSession()
  const token = session?.access_token || SUPABASE_ANON_KEY
  const redirectTo = location.origin + location.pathname
  const r = await fetch(`${SUPABASE_URL}/functions/v1/invite-user`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, redirectTo })
  })
  const res = await r.json()
  btn.disabled = false; btn.textContent = 'Enviar convite'
  if (res.error) { msgEl.textContent = 'Erro: ' + res.error; msgEl.className = 'admin-msg err'; msgEl.style.display = 'block' }
  else { msgEl.textContent = ''; const t = document.createTextNode('✓ Convite enviado para '); const eb = document.createElement('strong'); eb.textContent = email; msgEl.appendChild(t); msgEl.appendChild(eb); msgEl.className = 'admin-msg ok'; msgEl.style.display = 'block'; document.getElementById('invite-email').value = ''; loadUsers() }
}

/* ── CAMPAIGN FILTER (legacy L5644-5723, verbatim exceto currentSession →
   estado.currentSession em saveNoneCampaigns/saveCampaignFilter) ── */
async function openCampaignModal() {
  if (!currentAccountId) return
  const [campaigns, filterRows] = await Promise.all([
    sb('campaigns?account_id=eq.' + currentAccountId + '&order=status.asc,name.asc&select=campaign_id,name,objective,status'),
    sb('campaign_filters?account_id=eq.' + currentAccountId + '&select=selected_ids'),
  ])
  const rawIds = filterRows[0]?.selected_ids // null=todas, []=nenhuma, [ids]=filtradas
  renderCampaignModal(campaigns, rawIds)
  document.getElementById('campaign-modal-overlay').style.display = 'flex'
}
function renderCampaignModal(campaigns, rawIds) {
  // rawIds: null/undefined=todas marcadas, []=nenhuma marcada, [ids]=só essas marcadas
  const selIds = rawIds === null || rawIds === undefined ? null : new Set(rawIds)
  const list = document.getElementById('campaign-list'); list.innerHTML = ''
  const active = campaigns.filter(c => c.status === 'ACTIVE')
  const other = campaigns.filter(c => c.status !== 'ACTIVE')
  function renderGroup(title, items) {
    if (!items.length) return
    const hdr = document.createElement('div'); hdr.className = 'camp-group-hdr'; hdr.textContent = title; list.appendChild(hdr)
    items.forEach(c => {
      const row = document.createElement('label'); row.className = 'camp-row'
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.value = c.campaign_id
      cb.checked = selIds === null || selIds.has(c.campaign_id)
      const info = document.createElement('div'); info.className = 'camp-info'
      const nm = document.createElement('span'); nm.className = 'camp-name'; nm.textContent = c.name
      const obj = document.createElement('span'); obj.className = 'camp-obj'; obj.textContent = (c.objective || '').replace(/_/g, ' ')
      info.appendChild(nm); info.appendChild(obj); row.appendChild(cb); row.appendChild(info); list.appendChild(row)
      cb.addEventListener('change', updateCampaignCount)
    })
  }
  renderGroup('Ativas', active); renderGroup('Pausadas / Outras', other)
  updateCampaignCount()
}
function updateCampaignCount() {
  const total = document.querySelectorAll('#campaign-list input[type=checkbox]').length
  const checked = document.querySelectorAll('#campaign-list input[type=checkbox]:checked').length
  document.getElementById('camp-count').textContent = checked === total ? '(todas selecionadas)' : '(' + checked + ' de ' + total + ' selecionadas)'
}
async function saveNoneCampaigns() {
  const token = estado.currentSession?.access_token || SUPABASE_ANON_KEY
  await fetch(SUPABASE_URL + '/rest/v1/campaign_filters', {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ account_id: currentAccountId, selected_ids: [], updated_at: new Date().toISOString() }),
  })
  document.getElementById('campaign-modal-overlay').style.display = 'none'
  const info = document.getElementById('camp-filter-info')
  if (info) info.textContent = 'Nenhuma campanha selecionada'
  refresh()
}
async function saveCampaignFilter() {
  const allCbs = [...document.querySelectorAll('#campaign-list input[type=checkbox]')]
  const checked = allCbs.filter(cb => cb.checked).map(cb => cb.value)
  const toSave = checked.length === allCbs.length ? null : checked
  const token = estado.currentSession?.access_token || SUPABASE_ANON_KEY
  // A RESPOSTA É CONFERIDA. Até 20/08/2026 este `fetch` era disparado e
  // esquecido: o modal fechava e o contador mudava mesmo quando o banco tinha
  // recusado a gravação. A tela dizia que o filtro estava salvo, e no próximo
  // carregamento ele voltava ao que era, sem uma palavra de explicação — o
  // defeito que o padrão da casa chama de "campo que parece salvo e não
  // salvou", o mais caro de perceber.
  let r = null
  try {
    r = await fetch(SUPABASE_URL + '/rest/v1/campaign_filters', {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ account_id: currentAccountId, selected_ids: toSave, updated_at: new Date().toISOString() }),
    })
  } catch (e) { r = null }
  if (!r || !r.ok) {
    // O modal FICA ABERTO: fechar aqui jogaria fora a escolha que a pessoa
    // acabou de fazer, e ela teria que remarcar tudo de novo.
    adminToast('Não consegui salvar o filtro. Confira a conexão e clique em Salvar de novo.', false)
    return
  }
  adminToast('Filtro salvo.')
  document.getElementById('campaign-modal-overlay').style.display = 'none'
  // Contagem por tipo desconhecida neste ponto (o recorte só é montado no
  // fetchData); o refresh() logo abaixo completa a frase.
  updateCampaignFilterBadge(toSave === null ? allCbs.length : toSave.length, allCbs.length, _baldeAtual, null)
  refresh()
}
// A FRASE TEM DE FALAR DO TIPO DE CAMPANHA, senão ela contradiz os cartões que
// estão logo abaixo dela: "Todas as campanhas (126)" em cima de quatro números
// que falam de 9. Quem monta o texto é `fraseDoRecorte`, pura e testada ao lado.
//
// `doBalde` chega null nas pinturas que acontecem ANTES dos dados (troca de
// perfil, gravação do filtro): ali não existe a contagem por tipo, e a frase
// omite o número em vez de chutar um. O update() logo em seguida a completa.
function updateCampaignFilterBadge(selCount, total, balde, doBalde) {
  const info = document.getElementById('camp-filter-info')
  if (!info) return
  info.textContent = fraseDoRecorte(balde, { noRecorte: selCount, total, doBalde: doBalde === undefined ? null : doBalde })
}
async function loadCampaignFilterBadge() {
  if (!currentAccountId) return
  const [filterRows, campaigns] = await Promise.all([
    sb('campaign_filters?account_id=eq.' + currentAccountId + '&select=selected_ids'),
    sb('campaigns?account_id=eq.' + currentAccountId + '&select=campaign_id'),
  ])
  const rawIds = filterRows[0]?.selected_ids
  const selCount = rawIds === null || rawIds === undefined ? campaigns.length : rawIds.length
  // Só o tipo ESCOLHIDO é conhecido aqui; se ele estiver vazio neste perfil, o
  // update() troca para Todos e reescreve a frase com o tipo que realmente valeu.
  updateCampaignFilterBadge(selCount, campaigns.length, _baldeAtual, null)
}

// Equivalente ao showHome() do legado quando chamado a partir do dashboard
// (que fazia display:none do .wrapper + mostrava a Home do monólito). Além
// de parar todos os timers/listeners que esta tela inicia, navega pelo router.
function _pararTimersDashboard() {
  if (_hojeTimer) { clearInterval(_hojeTimer); _hojeTimer = null }
  if (_clockTimer) { clearInterval(_clockTimer); _clockTimer = null }
  _acStopCycle()
  clearTimeout(_acInactivity); _acInactivity = null
  if (chartOverlayEl) { chartOverlayEl.removeEventListener('mousemove', _onChartMouseMove); chartOverlayEl.removeEventListener('mouseleave', _onChartMouseLeave) }
  document.removeEventListener('mousemove', _acResetInactivity)
  document.removeEventListener('click', _acResetInactivity)
  document.removeEventListener('keydown', _acResetInactivity)
  document.removeEventListener('touchstart', _acResetInactivity)
}
function fecharDashboard() {
  _pararTimersDashboard()
  router.push({ name: 'inicio' })
}

// Cluster de funções chamadas por onclick="..." literal no <template> acima
// (estático) e no modal de campanhas (também estático, dentro da raiz do
// componente) — mesmo padrão da Gestão de Tráfego/Gestão à Vista/Análise de
// Campanhas. Conferido por grep: dentro do HTML gerado em runtime
// (buildProfiles/buildPeriodTabs/renderCampaignModal/loadUsers) NENHUMA
// função é chamada por onclick="..." literal — todas usam addEventListener,
// então não precisam ser expostas em window.
Object.assign(window, {
  onCustomDateChange,
  clearCustomRange,
  setEngTab,
  toggleAutoCycle,
  toggleHeader,
  openFollowersInfo,
  openCampaignModal,
  saveNoneCampaigns,
  saveCampaignFilter,
  updateCampaignCount,
  doInvite,
})

onMounted(async () => {
  if (!hasPermission('tool:social')) {
    adminToast('Sem acesso', false)
    router.push({ name: 'inicio' })
    return
  }
  verificarTravaJanelas() // 🔒 auto-teste: avisa no console se a lógica de intervalo foi quebrada.
  // ⚠️⚠️ OS CAMPOS DE DATA SÃO ESPELHO DO ESTADO, NUNCA O CONTRÁRIO.
  //
  // Este foi O defeito de 09/09/2026, e custou uma noite inteira ao dono. O
  // navegador RESTAURA sozinho o valor de um `<input type="date">` ao recarregar,
  // mas o estado da tela voltava para o período guardado (7 dias). Resultado: os
  // campos mostravam "05/09 a 09/09" e a tela calculava SETE DIAS por dentro.
  //
  // Tudo o que ele apontou vinha daqui — gráfico com 8 barras num intervalo de 5,
  // Meta Ads com uma captura só, cards zerados, números que não mudavam ao trocar
  // de período. Cada número que eu conferia batia; batia com o período ERRADO.
  //
  // Agora, no carregamento: ou o intervalo guardado entra nos campos, ou os campos
  // são LIMPOS. Os dois nunca discordam.
  {
    const _ci = document.getElementById('custom-start')
    const _cf = document.getElementById('custom-end')
    const _cx = document.getElementById('custom-clear-btn')
    if (_ci && _cf) {
      if (currentStartDate && currentEndDate) {
        _ci.value = currentStartDate; _cf.value = currentEndDate
        if (_cx) _cx.style.display = 'inline-flex'
        document.querySelectorAll('.ptab').forEach((b) => b.classList.remove('active'))
      } else {
        _ci.value = ''; _cf.value = ''
        if (_cx) _cx.style.display = 'none'
      }
    }
  }
  // Wiring que no legado rodava solto no escopo global do <script> (ver nota
  // no topo do bloco): tooltip do gráfico + detector de inatividade do auto-cycle.
  svgEl = document.getElementById('followers-chart')
  chartOverlayEl = document.getElementById('chart-overlay')
  crosshairEl = document.getElementById('crosshair')
  dotCurrEl = document.getElementById('dot-curr')
  dotPrevEl = document.getElementById('dot-prev')
  tooltipEl = document.getElementById('chart-tooltip')
  chartOverlayEl?.addEventListener('mousemove', _onChartMouseMove)
  chartOverlayEl?.addEventListener('mouseleave', _onChartMouseLeave)
  document.addEventListener('mousemove', _acResetInactivity, { passive: true })
  document.addEventListener('click', _acResetInactivity, { passive: true })
  document.addEventListener('keydown', _acResetInactivity, { passive: true })
  document.addEventListener('touchstart', _acResetInactivity, { passive: true })
  document.addEventListener('click', _onTooltipTap) // tooltip do número inteiro no toque
  // Pipeline de inicialização (mirror de loadDashboard, legacy L5586-5601,
  // menos a parte que já rodou na fundação de login — buscar role/features).
  buildPeriodTabs()
  updateGoalDisplays(currentPeriod)
  watchGoals()
  await buildProfiles()
  restoreHeaderState()
  initAutoCycleToggle()
  startClock()
  await refresh()
})

// CRÍTICO: limpa TODOS os timers/listeners que este dashboard inicia, para
// não deixar nada rodando em segundo plano depois que o usuário sai da rota
// (fecharDashboard cobre o caminho do botão "Central"; isto cobre qualquer
// outra forma de sair, ex.: navegação direto pela URL).
onUnmounted(() => {
  _pararTimersDashboard()
  document.removeEventListener('click', _onTooltipTap)
})
</script>

<style scoped>
/* ── Tooltip universal do número inteiro (fmtN resume; hover no desktop / toque no mobile revela) ── */
.tela-redes-sociais :deep(.tem-tooltip) { position: relative; }
.tela-redes-sociais :deep(.tem-tooltip.mostrar)::after,
.tela-redes-sociais :deep(.tem-tooltip:hover)::after {
  content: attr(data-full);
  position: absolute; left: 50%; bottom: calc(100% + 6px); transform: translateX(-50%);
  background: var(--text); color: var(--surface);
  font-family: var(--fonte-principal); font-size: 12px; font-weight: 600; letter-spacing: .3px;
  padding: 4px 8px; border-radius: 6px; white-space: nowrap; z-index: 60; pointer-events: none;
  box-shadow: 0 4px 14px rgba(0,0,0,.22);
}
/* ── Novos seguidores em 3 linhas de FONTE IGUAL (Seguidores / Deixaram de seguir / Total) ── */
.tela-redes-sociais :deep(.nf-linhas){ display:flex; flex-direction:column; gap:6px; margin:4px 0 2px; }
.tela-redes-sociais :deep(.nf-linha){ display:flex; align-items:baseline; justify-content:space-between; gap:12px; }
.tela-redes-sociais :deep(.nf-lbl){ font-family:var(--fonte-principal); font-size:max(9px, calc(12px * var(--escala-texto, 1))); font-weight:500; color:var(--muted); letter-spacing:.2px; }
.tela-redes-sociais :deep(.nf-val){ font-family:'Oswald',sans-serif; font-size:max(16px, calc(22px * var(--escala-texto, 1))); font-weight:600; color:var(--text); font-variant-numeric:tabular-nums; line-height:1.1; }
.tela-redes-sociais :deep(.nf-total){ font-size:max(16px, calc(32px * var(--escala-texto, 1))); font-weight:700; }
.tela-redes-sociais :deep(.nf-val.a-green){ color:var(--green); }
.tela-redes-sociais :deep(.nf-val.a-red){ color:var(--red); }
.tela-redes-sociais :deep(.nf-val.a-blue){ color:var(--accent); }
/* NÚMERO PARCIAL — quando o Instagram ainda não fechou o dia.
   O !important vence o .a-blue do template: sem isso o total sairia no mesmo azul
   confiante do "total de seguidores" (que É final), e o olho leria os dois como
   fatos da mesma natureza. O selo "em consolidação" já existia logo abaixo e o dono
   achou discreto — com razão: a ressalva chegava depois da conclusão. */
/* Precisa declarar -webkit-text-fill-color TAMBÉM, não só color: a regra .a-blue
   (linha ~2583 / estilos-globais:153) define as DUAS com !important, e é o
   text-fill que pinta o texto de verdade. Só com `color` o getComputedStyle().color
   já diz laranja e o pixel continua azul — foi o que aconteceu na 1ª tentativa. */
.tela-redes-sociais :deep(.nf-val.nf-em-consolidacao){ color:var(--orange)!important; -webkit-text-fill-color:var(--orange)!important; }
.tela-redes-sociais :deep(.nf-provisorio){ font-family:var(--fonte-principal); font-size:max(9px, calc(9.5px * var(--escala-texto, 1))); font-weight:800; text-transform:uppercase; letter-spacing:.5px; color:var(--orange); border:1px solid var(--orange); border-radius:4px; padding:1px 5px; margin-left:7px; opacity:.95; white-space:nowrap; }
.tela-redes-sociais :deep(.nf-linha:has(.nf-provisorio:not([hidden]))){ align-items:center; }
/* PRÉVIA do CUSTO POR SEGUIDOR — quando o Instagram ainda não publicou o bruto (seguiu/deixou)
   dos dias recentes e o custo sai pelo saldo líquido. Mesma cor âmbar da consolidação dos seguidores,
   via tokens de tema (claro E escuro). Não usa cores fixas pra não quebrar no modo escuro. */
.tela-redes-sociais :deep(.previa-selo){ display:inline-flex; align-items:center; gap:5px; font-family:var(--fonte-principal); font-size:max(9px, calc(10.5px * var(--escala-texto, 1))); font-weight:800; letter-spacing:.3px; color:var(--orange); border:1px solid var(--orange); border-radius:6px; padding:2px 8px; white-space:nowrap; }
.tela-redes-sociais :deep(.previa-nota){ font-family:var(--fonte-principal); font-size:max(9px, calc(9.5px * var(--escala-texto, 1))); line-height:1.35; font-weight:500; color:var(--muted); margin-top:3px; }
.tela-redes-sociais :deep(.mc-ad-sub){ font-family:var(--fonte-principal); font-size:max(9px, calc(10.5px * var(--escala-texto, 1))); font-weight:600; color:var(--muted); margin-top:2px; letter-spacing:.2px; }
.tela-redes-sociais :deep(.mc-obs){ font-family:var(--fonte-principal); font-size:max(9px, calc(10px * var(--escala-texto, 1))); font-weight:500; line-height:1.35; color:var(--muted); opacity:.85; margin-top:4px; }
/* Porte das regras do dashboard central de Redes Sociais (legacy/index.html,
   principalmente L34-386/389-470/683-709/815-870 — hoje ainda em
   src/estilos/estilos-globais.css, de onde NÃO foram removidas: ao contrário
   da Gestão à Vista/Análise de Campanhas (que puderam "arrancar" seus
   seletores gv- e ma- do global porque eram exclusivos delas), boa parte
   destas regras (.mc-*, .card, .topbar*, .sec*, .profile-*, .ac-toggle*,
   #apb-*, .insight-*, .overall-bar-*, #dash-clock, .chart-*, .calc-badge,
   .rbv-logo, .live-dot, .gv-back/.gv-perf-tag/.gv-brand-tag/.gv-clock-date/
   .gv-update-status, .custom-range-btn/.custom-date-input,
   .admin-input/.admin-select/.admin-action-btn/.admin-msg/.user-list/
   .auth-label) são compartilhadas com telas AINDA não migradas (Vendas,
   Meta Ads, Admin) e com o tela-de-login.vue já migrado — removê-las do
   global quebraria essas outras telas. Por isso: cópia própria aqui (mesmo
   padrão de sempre — cada tela traz a sua), SEM tocar em
   estilos-globais.css. Isso é uma escolha deliberada de segurança, não uma
   omissão — ver "CONCERNS" no relatório (.superpowers/sdd/social-port-
   report.md) para a lista exata do que ficou como candidato a uma limpeza
   futura, quando todas as telas restantes estiverem portadas.
   .wrapper vira a raiz .tela-redes-sociais (sem display:none — a
   visibilidade é do router). #period-tabs, #profile-select, #chips-*,
   #admin-panel > #user-list e o board de métricas inteiro são preenchidos
   via getElementById/createElement/innerHTML (JS imperativo acima), por
   isso os seletores usam :deep(). #chart-tooltip/#campaign-modal-overlay/
   #autocycle-progress são irmãos soltos no <body> no legado — aqui vivem
   dentro da raiz do componente (position:fixed não muda o layout) só para
   o :deep() alcançá-los, mesma técnica dos modais da Gestão de Tráfego. */
.tela-redes-sociais{min-height:100vh;position:relative;z-index:1;}

.tela-redes-sociais :deep(.wrapper){max-width:none;width:100%;margin:0;padding:16px 28px;box-sizing:border-box;position:relative;z-index:1;transition:opacity .08s ease;}
.tela-redes-sociais :deep(.wrapper.fading){opacity:.4;}
.tela-redes-sociais :deep(.wrapper.entering){animation:profileEnter .28s cubic-bezier(.22,1,.36,1) both;}
.tela-redes-sociais :deep(#autocycle-progress){display:none!important;}

/* Header / seletor de perfil */
.tela-redes-sociais :deep(header){display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:16px;padding-bottom:0;}
.tela-redes-sociais :deep(#header-collapsible){display:flex;align-items:center;gap:16px;flex-wrap:wrap;overflow:hidden;max-height:120px;opacity:1;transition:max-height .35s ease,opacity .25s ease;}
.tela-redes-sociais :deep(#header-collapsible.collapsed){max-height:0;opacity:0;pointer-events:none;}
.tela-redes-sociais :deep(#header-toggle){background:none;border:1px solid var(--border);cursor:pointer;color:var(--muted);font-size:max(9px, calc(11px * var(--escala-texto, 1)));padding:5px 10px;border-radius:3px;font-family:var(--fonte-principal);display:flex;align-items:center;gap:5px;transition:border-color .18s,color .18s;white-space:nowrap;align-self:flex-start;}
.tela-redes-sociais :deep(#header-toggle:hover){border-color:var(--accent);color:var(--accent);}
.tela-redes-sociais :deep(#header-toggle .ht-arrow){display:inline-block;transition:transform .35s ease;font-size:max(9px, calc(9px * var(--escala-texto, 1)));line-height:1;}
.tela-redes-sociais :deep(.profile-select){display:flex;gap:6px;flex-wrap:wrap;}
.tela-redes-sociais :deep(.profile-btn){background:var(--surface);border:1px solid var(--border);color:var(--muted);padding:7px 14px;border-radius:var(--radius-sm);font-family:var(--fonte-principal);font-size:max(9px, calc(12px * var(--escala-texto, 1)));font-weight:500;cursor:pointer;display:flex;align-items:center;gap:8px;transition:background .2s cubic-bezier(.4,0,.2,1),border-color .2s ease,color .15s ease,transform .12s ease;}
.tela-redes-sociais :deep(.profile-btn:active){transform:scale(.95);}
.tela-redes-sociais :deep(.profile-btn:focus-visible){outline:2px solid var(--accent);outline-offset:2px;}
.tela-redes-sociais :deep(.profile-btn .av){width:20px;height:20px;border-radius:50%;font-size:max(9px, calc(9px * var(--escala-texto, 1)));display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;overflow:hidden;flex-shrink:0;position:relative;z-index:1;}
.tela-redes-sociais :deep(.profile-btn .av img){width:100%;height:100%;object-fit:cover;border-radius:50%;}
.tela-redes-sociais :deep(.av-ring-wrap){position:relative;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
.tela-redes-sociais :deep(.av-ring-wrap)::before{content:'';position:absolute;inset:-2.5px;border-radius:50%;background:conic-gradient(#f09433,#e6683c,#dc2743,#cc2366,#bc1888,#833ab4,#405de6,#f09433);animation:storiesRotate 3s linear infinite;opacity:0;transition:opacity .3s;}
.tela-redes-sociais :deep(.av-ring-wrap.has-stories)::before{opacity:1;}
.tela-redes-sociais :deep(.av-ring-wrap.has-stories>.av){outline:1.5px solid var(--bg);outline-offset:0;}
.tela-redes-sociais :deep(#apb-ring-wrap){position:relative;display:none;flex-shrink:0;}
.tela-redes-sociais :deep(#apb-ring-wrap)::before{content:'';position:absolute;inset:-4px;border-radius:50%;background:conic-gradient(#f09433,#e6683c,#dc2743,#cc2366,#bc1888,#833ab4,#405de6,#f09433);animation:storiesRotate 3s linear infinite;opacity:0;transition:opacity .3s;}
.tela-redes-sociais :deep(#apb-ring-wrap.has-stories)::before{opacity:1;}
.tela-redes-sociais :deep(#apb-img){width:44px;height:44px;border-radius:50%;object-fit:cover;flex-shrink:0;border:none;display:block;position:relative;z-index:1;}
.tela-redes-sociais :deep(#apb-ring-wrap.has-stories #apb-img){outline:2.5px solid var(--bg);outline-offset:0;}
.tela-redes-sociais :deep(.profile-btn.active){background:var(--accent);border-color:var(--accent);color:var(--sobre-cor);}
.tela-redes-sociais :deep(.profile-btn:hover:not(.active)){border-color:var(--accent-forte);color:var(--text);background:var(--accent-light);}

/* Topbar */
.tela-redes-sociais :deep(.topbar){display:flex;align-items:center;justify-content:space-between;padding-bottom:6px;margin-bottom:6px;flex-wrap:nowrap;gap:10px;padding-right:58px;/* reserva espaço pro avatar de perfil (fixed no topo direito) */}
.tela-redes-sociais :deep(.topbar-left){display:flex;align-items:center;gap:14px;min-width:0;flex-shrink:1;}
.tela-redes-sociais :deep(.topbar-center){display:flex;align-items:center;gap:8px;flex-wrap:nowrap;flex:1 1 auto;min-width:0;justify-content:center;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none;}
.tela-redes-sociais :deep(.topbar-center)::-webkit-scrollbar{display:none;}
.tela-redes-sociais :deep(.topbar-right){display:flex;align-items:center;gap:12px;text-align:right;flex-shrink:0;}
.tela-redes-sociais :deep(.period-tabs){display:flex;gap:3px;flex-wrap:nowrap;flex-shrink:0;}
.tela-redes-sociais :deep(.ptab){padding:4px 7px;border-radius:var(--radius-sm);font-family:var(--fonte-principal);font-size:max(9px, calc(9px * var(--escala-texto, 1)));font-weight:600;cursor:pointer;color:var(--muted);border:1px solid var(--border);background:none;letter-spacing:.3px;text-transform:uppercase;white-space:nowrap;flex-shrink:0;transition:background .2s cubic-bezier(.4,0,.2,1),color .15s ease,border-color .15s ease,transform .12s ease,box-shadow .2s ease;}
.tela-redes-sociais :deep(.ptab):active{transform:scale(.94);}
.tela-redes-sociais :deep(.ptab.active){background:var(--accent);color:var(--sobre-cor);border-color:var(--accent);box-shadow:0 2px 8px rgba(29,78,216,.25);}
[data-theme="dark"] .tela-redes-sociais :deep(.ptab.active){box-shadow:0 2px 10px rgba(79,124,255,.35);}
.tela-redes-sociais :deep(.ptab):focus-visible{outline:2px solid var(--accent);outline-offset:2px;}

/* Relógio / live-dot / logo — compartilhados com outras telas (cópia própria, ver nota acima) */
.tela-redes-sociais :deep(.live-dot){display:inline-flex;align-items:center;gap:6px;font-family:var(--fonte-principal);font-size:max(9px, calc(9px * var(--escala-texto, 1)));color:var(--green);letter-spacing:1.5px;font-weight:500;text-transform:uppercase;}
.tela-redes-sociais :deep(.live-dot)::before{content:'';width:5px;height:5px;border-radius:50%;background:var(--green);animation:pulse 2s infinite;}
.tela-redes-sociais :deep(.rbv-logo){height:52px;width:auto;object-fit:contain;display:block;}
.tela-redes-sociais :deep(.rbv-logo-dark){display:none;}
[data-theme="dark"] .tela-redes-sociais :deep(.rbv-logo-light){display:none;}
[data-theme="dark"] .tela-redes-sociais :deep(.rbv-logo-dark){display:block;}
.tela-redes-sociais :deep(.gv-back){display:flex;align-items:center;gap:4px;font-family:var(--fonte-principal);font-size:max(9px, calc(10px * var(--escala-texto, 1)));font-weight:600;color:var(--accent);cursor:pointer;background:none;border:none;padding:0;transition:opacity .15s;letter-spacing:.3px;text-transform:uppercase;}
.tela-redes-sociais :deep(.gv-back):hover{opacity:.75;}
.tela-redes-sociais :deep(.gv-perf-tag){font-family:var(--fonte-principal);font-size:max(9px, calc(13.5px * var(--escala-texto, 1)));font-weight:700;letter-spacing:6px;text-transform:uppercase;color:var(--text);opacity:1;line-height:1.2;}
.tela-redes-sociais :deep(.gv-brand-tag){font-family:var(--fonte-principal);font-size:max(9px, calc(10px * var(--escala-texto, 1)));font-weight:600;letter-spacing:3px;text-transform:uppercase;color:var(--text);opacity:.6;line-height:1;}
.tela-redes-sociais :deep(.gv-clock-date){font-family:var(--fonte-principal);font-size:max(9px, calc(8px * var(--escala-texto, 1)));letter-spacing:2px;text-transform:uppercase;color:var(--muted);margin-top:3px;}
.tela-redes-sociais :deep(.gv-update-status){font-family:var(--fonte-principal);font-size:max(9px, calc(8px * var(--escala-texto, 1)));letter-spacing:1.5px;text-transform:uppercase;color:var(--muted);opacity:.45;margin-top:4px;text-align:right;}
.tela-redes-sociais :deep(#dash-clock){font-family:'Oswald',sans-serif;font-size:max(9px, calc(15px * var(--escala-texto, 1)));font-weight:400;letter-spacing:2px;color:var(--muted);white-space:nowrap;line-height:1;}
.tela-redes-sociais :deep(#dash-clock span){color:var(--accent);font-weight:500;}

/* Active profile bar */
.tela-redes-sociais :deep(#active-profile-bar){display:flex;align-items:center;gap:9px;margin-bottom:14px;}
.tela-redes-sociais :deep(#apb-dot){width:8px;height:8px;border-radius:50%;background:var(--accent);flex-shrink:0;transition:background .4s ease;}
.tela-redes-sociais :deep(#apb-name){font-family:'Oswald',sans-serif;font-size:max(16px, calc(22px * var(--escala-texto, 1)));font-weight:500;letter-spacing:2px;text-transform:uppercase;color:var(--text);}

/* Auto-cycle toggle (dashboard-específico) */
.tela-redes-sociais :deep(.ac-toggle){display:inline-flex;align-items:center;gap:7px;cursor:pointer;user-select:none;}
.tela-redes-sociais :deep(.ac-toggle-track){width:34px;height:19px;border-radius:10px;background:var(--border);position:relative;flex-shrink:0;transition:background .25s ease;border:1px solid rgba(0,0,0,.08);}
.tela-redes-sociais :deep(.ac-toggle-track.on){background:var(--accent);}
.tela-redes-sociais :deep(.ac-toggle-thumb){position:absolute;top:2px;left:2px;width:13px;height:13px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.25);transition:transform .25s cubic-bezier(.34,1.56,.64,1);}
.tela-redes-sociais :deep(.ac-toggle-track.on .ac-toggle-thumb){transform:translateX(15px);}
.tela-redes-sociais :deep(.ac-toggle-lbl){font-family:var(--fonte-principal);font-size:max(9px, calc(10px * var(--escala-texto, 1)));font-weight:600;letter-spacing:1.5px;color:var(--muted);text-transform:uppercase;transition:color .2s;}
.tela-redes-sociais :deep(.ac-toggle.on .ac-toggle-lbl){color:var(--accent);}
.tela-redes-sociais :deep(#autocycle-badge){position:fixed;bottom:18px;right:18px;display:none;align-items:center;gap:8px;background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:7px 14px;font-family:var(--fonte-principal);font-size:max(9px, calc(11px * var(--escala-texto, 1)));color:var(--text);letter-spacing:.8px;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,.15);}
.tela-redes-sociais :deep(#autocycle-badge .ac-dot){width:6px;height:6px;border-radius:50%;background:var(--green);animation:pulse 2s infinite;flex-shrink:0;}

/* Section headers / grids / cards */
.tela-redes-sociais :deep(.sec-header){display:flex;align-items:center;gap:12px;margin-bottom:8px;}
.tela-redes-sociais :deep(.section-label){font-family:var(--fonte-principal);font-weight:600;font-size:max(9px, calc(11px * var(--escala-texto, 1)));letter-spacing:2px;color:var(--muted);text-transform:uppercase;white-space:nowrap;}
.tela-redes-sociais :deep(.sec-line){flex:1;height:1px;background:var(--border);}
.tela-redes-sociais :deep(.sec-chips){display:flex;gap:6px;flex-wrap:wrap;}
.tela-redes-sociais :deep(.sec-chip){font-family:var(--fonte-principal);font-weight:500;font-size:max(9px, calc(10px * var(--escala-texto, 1)));padding:3px 8px;border-radius:var(--radius-sm);background:var(--surface2);color:var(--muted);border:1px solid var(--border);white-space:nowrap;letter-spacing:.3px;}
/* Chip de AVISO (ex.: "esse alcance conta a mesma pessoa mais de uma vez"): pode
   passar de uma linha. O chip comum é nowrap porque carrega número curto; uma
   frase em nowrap sairia cortada a 375px, e texto cortado é o que não pode. */
.tela-redes-sociais :deep(.sec-chip.sec-chip-nota){white-space:normal;max-width:100%;line-height:1.35;}
.tela-redes-sociais :deep(.mb40){margin-bottom:22px;}
.tela-redes-sociais :deep(.card){background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-md);padding:22px 24px;border-left:3px solid transparent;animation:fadeUp .55s cubic-bezier(.22,1,.36,1) both;transition:border-color .22s,box-shadow .22s;will-change:transform,opacity;cursor:default;}
.tela-redes-sociais :deep(.card):hover{border-left-color:var(--accent);border-color:var(--accent-mid);box-shadow:var(--shadow-md);}
[data-theme="dark"] .tela-redes-sociais :deep(.card){box-shadow:none;}

/* ── Gráficos diários da seção 02 · Meta Ads ──
   Prefixo gmad- (gráfico meta ads diário): nomes EXCLUSIVOS desta tela, pra não colidir com
   nenhuma classe genérica do estilos-globais.css. Como o SVG é criado por JS (não pelo template),
   ele não recebe o atributo de escopo do Vue — por isso :deep(), igual ao resto do arquivo. */
.tela-redes-sociais :deep(.gmad-bloco){margin-top:14px;padding-top:12px;border-top:1px solid var(--border);}
.tela-redes-sociais :deep(.gmad-titulo){font-family:var(--fonte-principal);font-size:max(9px, calc(10px * var(--escala-texto, 1)));font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin-bottom:6px;}
.tela-redes-sociais :deep(.gmad-svg){display:block;width:100%;height:auto;max-width:100%;overflow:visible;}
.tela-redes-sociais :deep(.gmad-barra){fill:var(--accent);}
.tela-redes-sociais :deep(.gmad-barra-acima){fill:var(--red);}
.tela-redes-sociais :deep(.gmad-buraco){fill:var(--border);}
.tela-redes-sociais :deep(.gmad-base){stroke:var(--border);stroke-width:1;}
/* Meta = referência discreta: linha propositalmente translúcida pra não competir com as barras. */
.tela-redes-sociais :deep(.gmad-meta){stroke:var(--orange);stroke-width:1.5;stroke-dasharray:4 3;opacity:.5;}
.tela-redes-sociais :deep(.gmad-meta-txt){font-family:var(--fonte-principal);font-size:max(9px, calc(8px * var(--escala-texto, 1)));font-weight:600;fill:var(--orange);}
/* Rótulo de dados (valor R$) em cima de cada barra dos gráficos diários. */
.tela-redes-sociais :deep(.gmad-valor){font-family:var(--fonte-principal);font-size:max(9px, calc(7.5px * var(--escala-texto, 1)));font-weight:700;fill:var(--text);}
/* 11px quando o gráfico rola. Os 9px acima não foram escolha de estilo: era o
   menor corpo legível, e mesmo assim "R$ 17,34" e "R$ 11,35" se sobrepunham em
   −5px a 375px, porque cada dia tinha ~10px. Rolando, cada dia tem 30px — e aí
   não há motivo para continuar espremendo a letra. Só rolando: no computador o
   espaço é o mesmo de sempre, e letra maior no mesmo espaço traria a
   sobreposição de volta. */
.tela-redes-sociais :deep(.gmad-rola .gmad-valor){font-size:max(11px, calc(11px * var(--escala-texto, 1)));}
/* Tarja atrás do rótulo da meta: ele fica sobre as barras e sem fundo virava sujeira. */
.tela-redes-sociais :deep(.gmad-meta-tarja){fill:var(--surface);stroke:var(--orange);stroke-width:.5;opacity:.94;}
.tela-redes-sociais :deep(.gmad-xlabel){font-family:var(--fonte-principal);font-size:max(9px, calc(8px * var(--escala-texto, 1)));fill:var(--muted);}
.tela-redes-sociais :deep(.gmad-legenda){font-family:var(--fonte-principal);font-size:max(9px, calc(10px * var(--escala-texto, 1)));line-height:1.4;color:var(--muted);margin-top:6px;}
.tela-redes-sociais :deep(.gmad-vazio){font-family:var(--fonte-principal);font-size:max(9px, calc(11px * var(--escala-texto, 1)));line-height:1.4;color:var(--muted);padding:10px 0;}

/* Metric card */
.tela-redes-sociais :deep(.mc-header){display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:8px;}
.tela-redes-sociais :deep(.mc-icon){font-size:max(16px, calc(16px * var(--escala-texto, 1)));opacity:.35;}
.tela-redes-sociais :deep(.mc-goal-area){display:flex;align-items:center;gap:5px;}
.tela-redes-sociais :deep(.mc-goal-lbl){font-family:var(--fonte-principal);font-weight:600;font-size:max(9px, calc(10px * var(--escala-texto, 1)));letter-spacing:1px;color:var(--muted);text-transform:uppercase;}
.tela-redes-sociais :deep(.mc-goal-val){font-family:var(--fonte-principal);font-weight:500;font-size:max(9px, calc(12px * var(--escala-texto, 1)));color:var(--text);border-bottom:1px dashed rgba(0,0,0,.15);cursor:text;outline:none;background:transparent;min-width:20px;text-align:right;}
.tela-redes-sociais :deep(.mc-goal-val):focus{border-color:var(--accent);color:var(--accent);}
.tela-redes-sociais :deep(.mc-edit-hint){font-size:max(9px, calc(9px * var(--escala-texto, 1)));color:var(--muted);opacity:.35;transition:opacity .2s;}
.tela-redes-sociais :deep(.mc-goal-val:focus+.mc-edit-hint),.tela-redes-sociais :deep(.mc-edit-hint):hover{opacity:1;}
@media (hover:none){.tela-redes-sociais :deep(.mc-edit-hint){opacity:1;}}
.tela-redes-sociais :deep(.mc-lbl){font-family:var(--fonte-principal);font-weight:600;font-size:max(9px, calc(11px * var(--escala-texto, 1)));letter-spacing:1.5px;color:var(--muted);text-transform:uppercase;margin-bottom:5px;}
.tela-redes-sociais :deep(.mc-val){font-family:'Oswald',sans-serif;font-size:max(16px, calc(44px * var(--escala-texto, 1)));font-weight:500;line-height:1;margin-bottom:8px;color:var(--text);font-variant-numeric:tabular-nums;}
.tela-redes-sociais :deep(.mc-compare){display:flex;flex-direction:column;gap:4px;margin-bottom:12px;padding:7px 10px;background:var(--surface2);border-radius:var(--radius-sm);border:1px solid var(--border);}
.tela-redes-sociais :deep(.mc-compare-label){font-family:var(--fonte-principal);font-weight:500;font-size:max(9px, calc(10px * var(--escala-texto, 1)));color:var(--muted);text-transform:uppercase;letter-spacing:.6px;overflow-wrap:break-word;word-break:break-word;line-height:1.3;}
.tela-redes-sociais :deep(.mc-compare-vals){display:flex;align-items:center;justify-content:space-between;gap:6px;flex-wrap:wrap;}
.tela-redes-sociais :deep(.mc-compare-prev){font-family:var(--fonte-principal);font-weight:400;font-size:max(9px, calc(12px * var(--escala-texto, 1)));color:var(--muted);}
.tela-redes-sociais :deep(.mc-compare-delta){font-family:var(--fonte-principal);font-size:max(9px, calc(12px * var(--escala-texto, 1)));font-weight:600;white-space:nowrap;}
.tela-redes-sociais :deep(.mc-divider){height:1px;background:var(--border);margin-bottom:10px;}
.tela-redes-sociais :deep(.mc-progress-track){height:2px;border-radius:0;background:var(--surface2);overflow:hidden;margin-bottom:7px;}
.tela-redes-sociais :deep(.mc-progress-fill){height:100%;border-radius:0;transition:width .8s cubic-bezier(.34,1.56,.64,1),background .4s,box-shadow .5s;position:relative;overflow:hidden;}
.tela-redes-sociais :deep(.mc-progress-fill)::after{content:'';position:absolute;top:0;left:-60%;width:55%;height:100%;background:linear-gradient(90deg,transparent,rgba(255,255,255,.42),transparent);animation:barLiq 2.2s ease-in-out infinite;pointer-events:none;}
.tela-redes-sociais :deep(.mc-progress-fill.bg-green){box-shadow:0 0 7px #22c55e99,0 0 18px #22c55e33;}
[data-theme="light"] .tela-redes-sociais :deep(.mc-progress-fill.bg-green){box-shadow:0 0 5px #1a6e4566;}
.tela-redes-sociais :deep(.mc-bottom){display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:4px;}
.tela-redes-sociais :deep(.mc-pct){font-family:'Oswald',sans-serif;font-size:max(9px, calc(15px * var(--escala-texto, 1)));font-weight:400;color:var(--muted);}
.tela-redes-sociais :deep(.mc-diff){font-family:var(--fonte-principal);font-size:max(9px, calc(10px * var(--escala-texto, 1)));font-weight:500;}

/* Colors */
.tela-redes-sociais :deep(.c-green){color:var(--green)!important;}
.tela-redes-sociais :deep(.c-yellow){color:var(--yellow)!important;}
.tela-redes-sociais :deep(.c-orange){color:var(--orange)!important;}
.tela-redes-sociais :deep(.c-red){color:var(--red)!important;}
.tela-redes-sociais :deep(.bg-green){background:var(--green)!important;}
.tela-redes-sociais :deep(.bg-yellow){background:var(--yellow)!important;}
.tela-redes-sociais :deep(.bg-orange){background:var(--orange)!important;}
.tela-redes-sociais :deep(.bg-red){background:var(--red)!important;}
.tela-redes-sociais :deep(.a-orange),.tela-redes-sociais :deep(.a-pink),.tela-redes-sociais :deep(.a-purple),.tela-redes-sociais :deep(.a-blue){color:var(--accent)!important;-webkit-text-fill-color:var(--accent)!important;background:none!important;}

/* Grids */
.tela-redes-sociais :deep(.sec1-grid){display:grid;grid-template-columns:280px 1fr;gap:16px;}
.tela-redes-sociais :deep(.sec2-grid){display:grid;grid-template-columns:1fr 1fr;gap:16px;}
.tela-redes-sociais :deep(.sec3-grid){display:grid;grid-template-columns:repeat(3,1fr);gap:16px;}
.tela-redes-sociais :deep(.sec4-grid){display:grid;grid-template-columns:repeat(2,1fr);gap:16px;}

/* ── GRÁFICO QUE ROLA PARA O LADO — vale para a seção 01 e para a seção 02 ──
   A régua está em largura-do-grafico.js: cada dia recebe no MÍNIMO 30px. Cabendo
   os dias nesse mínimo (o computador em qualquer período; o celular em períodos
   curtos), NADA aqui entra em ação: sem `overflow`, sem faixa, sem largura
   cravada — o gráfico continua exatamente como está no ar hoje.

   REPARE QUE O `overflow` SÓ EXISTE COM A CLASSE `.rolando`. É de propósito:
   caixa que rola RECORTA também de cima e de baixo (não existe rolar num eixo e
   deixar o outro transbordar), e os números do gráfico de seguidores ficam por
   cima das barras, na beirada. Sem rolagem não há o que recortar, então não se
   recorta nada. */
/* SEM ESTE `min-width:0` A PÁGINA INTEIRA GANHA ROLAGEM PARA O LADO. Cartão é
   item de grade, e item de grade nasce com `min-width:auto` — que quer dizer
   "nunca menor que o conteúdo". O conteúdo aqui é DE PROPÓSITO maior que a tela
   (é o gráfico largo), e a coluna ia atrás dele: medido a 375px, o cartão da
   seção 02 esticou para 980px e o `body` foi para 992px. Recortar dentro da
   caixa que rola não basta; a coluna precisa ter permissão de ser menor que o
   que está dentro dela. */
.tela-redes-sociais :deep(.sec1-grid)>.card,
.tela-redes-sociais :deep(.sec2-grid)>.card{min-width:0;}
.tela-redes-sociais :deep(.grafico-que-rola){position:relative;width:100%;margin-top:auto;}
.tela-redes-sociais :deep(.grafico-que-rola.rolando .rolagem-de-grafico){
  overflow-x:auto;overflow-y:hidden;
  /* A rolagem para o lado morre AQUI: sem isto, o dedo que chega no fim do
     gráfico empurra a PÁGINA para o lado (ou dispara o "voltar" do navegador). */
  overscroll-behavior-x:contain;touch-action:pan-x pan-y;
}
/* O trilho é o que fica largo. `content-box` de propósito: as tiras vazias das
   beiradas entram como padding e NÃO entram na largura do desenho — os rótulos
   são posicionados em porcentagem sobre essa largura, e um trilho maior que o
   desenho deslocaria todos eles. A largura e as tiras são postas pelo JavaScript
   (ver vestirOTrilho), a partir das constantes de largura-do-grafico.js.
   `min-width:100%` é a rede: se o cartão crescer depois do desenho (girar o
   aparelho), o gráfico acompanha em vez de virar um toco no meio do cartão. */
.tela-redes-sociais :deep(.trilho-de-grafico){box-sizing:content-box;width:var(--largura-do-grafico, 100%);min-width:100%;}
/* A faixa apagada da direita é o único aviso de que existe mais gráfico para o
   lado — sem ela ninguém descobre. Mora na camada que NÃO rola, senão iria
   embora junto com o conteúdo; e cai sobre a tira vazia da saída, nunca sobre o
   último dia (ver FAIXA_QUE_AVISA em largura-do-grafico.js — os 28 daqui são os
   mesmos de lá). */
.tela-redes-sociais :deep(.grafico-que-rola.rolando)::after{
  content:'';position:absolute;top:0;right:0;bottom:0;width:28px;
  pointer-events:none;background:linear-gradient(to right,transparent,var(--surface));
}

/* Chart */
.tela-redes-sociais :deep(.chart-svg-wrap){position:relative;width:100%;}
.tela-redes-sociais :deep(.chart-svg-wrap) svg{width:100%;height:150px;overflow:visible;cursor:crosshair;display:block;}
.tela-redes-sociais :deep(#chart-data-labels){position:absolute;top:0;left:0;right:0;bottom:0;pointer-events:none;overflow:visible;}
/* Linha de meta de seguidores/dia: laranja tracejado e translúcido, igual às outras metas. */
.tela-redes-sociais :deep(#chart-meta){stroke:var(--orange);stroke-width:1.2;stroke-dasharray:4 3;opacity:.5;vector-effect:non-scaling-stroke;}
.tela-redes-sociais :deep(.cdl-meta){position:absolute;font-family:var(--fonte-principal);font-size:max(9px, calc(9px * var(--escala-texto, 1)));font-weight:700;color:var(--orange);opacity:.75;white-space:nowrap;pointer-events:none;}
.tela-redes-sociais :deep(.cdl){position:absolute;transform:translate(-50%,calc(-100% - 3px));font-family:'Oswald',sans-serif;font-size:max(9px, calc(14px * var(--escala-texto, 1)));font-weight:500;color:rgba(22,22,42,0.65);white-space:nowrap;letter-spacing:.3px;}
[data-theme="dark"] .tela-redes-sociais :deep(.cdl){color:rgba(226,228,240,0.78);}
.tela-redes-sociais :deep(.cdl-in){position:absolute;font-family:var(--fonte-principal);font-size:max(9px, calc(10px * var(--escala-texto, 1)));font-weight:700;line-height:1;color:var(--sobre-cor);white-space:nowrap;pointer-events:none;text-shadow:0 1px 2px rgba(0,0,0,.28);}
.tela-redes-sociais :deep(.cdl-sm){font-size:max(9px, calc(10px * var(--escala-texto, 1)));letter-spacing:0;}
/* Rótulo de dia ESTIMADO: mais apagado que o número real, para a diferença entre
   "o Instagram disse" e "nós calculamos" ser visível sem precisar ler nada. */
.tela-redes-sociais :deep(.cdl-est){font-style:italic;}
/* Nota dos dias estimados, embaixo do gráfico. */
.tela-redes-sociais :deep(.nota-estimativa){margin-top:8px;font-family:var(--fonte-principal);font-size:max(9px, calc(10.5px * var(--escala-texto, 1)));line-height:1.45;color:var(--muted);border-top:1px dashed var(--border);padding-top:7px;}
.tela-redes-sociais :deep(.nota-est-marca){font-weight:800;color:var(--orange);font-size:max(9px, calc(12px * var(--escala-texto, 1)));}
/* Bloco técnico: só o super-admin recebe este pedaço no HTML (montarNotaDeEstimativa). */
.tela-redes-sociais :deep(.nota-est-tec){margin-top:5px;padding:5px 8px;border-left:2px solid var(--orange);background:rgba(180,83,9,.06);border-radius:0 4px 4px 0;font-size:max(9px, calc(10px * var(--escala-texto, 1)));color:var(--muted);}
.tela-redes-sociais :deep(.nota-est-tec code){font-family:'IBM Plex Mono','SF Mono',monospace;font-size:max(9px, calc(9.5px * var(--escala-texto, 1)));background:rgba(0,0,0,.06);padding:0 3px;border-radius:3px;}
[data-theme="dark"] .tela-redes-sociais :deep(.nota-est-tec){background:rgba(251,146,60,.08);}
[data-theme="dark"] .tela-redes-sociais :deep(.nota-est-tec code){background:rgba(255,255,255,.08);}
.tela-redes-sociais :deep(.cdl-hi){transform:translate(-50%,calc(-100% - 22px));}
.tela-redes-sociais :deep(.cdl-hi)::after{content:'';position:absolute;left:50%;top:100%;width:0;height:20px;border-left:1px dashed currentColor;opacity:.4;}
.tela-redes-sociais :deep(.cdl-up){color:var(--green);}
.tela-redes-sociais :deep(.cdl-down){color:var(--red);}
[data-theme="dark"] .tela-redes-sociais :deep(.cdl-up){color:var(--green);}
[data-theme="dark"] .tela-redes-sociais :deep(.cdl-down){color:var(--red);}
.tela-redes-sociais :deep(.chart-legend){display:flex;gap:16px;margin-top:8px;margin-bottom:4px;}
.tela-redes-sociais :deep(.legend-item){display:flex;align-items:center;gap:5px;font-family:'Oswald',sans-serif;font-size:max(9px, calc(10px * var(--escala-texto, 1)));font-weight:400;color:var(--muted);letter-spacing:.5px;}
.tela-redes-sociais :deep(.legend-line){width:20px;height:2px;border-radius:0;}
.tela-redes-sociais :deep(.legend-dot){width:9px;height:9px;border-radius:2px;}
.tela-redes-sociais :deep(.legend-dash){width:20px;height:2px;background:repeating-linear-gradient(90deg,rgba(0,0,0,.2)0,rgba(0,0,0,.2)4px,transparent 4px,transparent 7px);}
.tela-redes-sociais :deep(.x-labels){position:relative;height:16px;overflow:visible;}
.tela-redes-sociais :deep(.x-label){position:absolute;transform:translateX(-50%);font-family:'Oswald',sans-serif;font-weight:400;font-size:max(9px, calc(9px * var(--escala-texto, 1)));color:var(--muted);white-space:nowrap;letter-spacing:.3px;}

/* Tooltip flutuante do gráfico */
.tela-redes-sociais :deep(#chart-tooltip){position:fixed;pointer-events:none;z-index:999;display:none;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-md);padding:12px 14px;min-width:180px;box-shadow:var(--shadow-tooltip);}
.tela-redes-sociais :deep(.tt-date){font-family:'Oswald',sans-serif;font-size:max(9px, calc(9px * var(--escala-texto, 1)));font-weight:400;color:var(--muted);margin-bottom:8px;letter-spacing:1.5px;text-transform:uppercase;}
.tela-redes-sociais :deep(.tt-row){display:flex;align-items:center;gap:8px;margin-bottom:4px;}
.tela-redes-sociais :deep(.tt-dot){width:7px;height:7px;border-radius:50%;flex-shrink:0;}
.tela-redes-sociais :deep(.tt-dot.curr){background:var(--accent);}
.tela-redes-sociais :deep(.tt-dot.prev){background:rgba(0,0,0,.2);}
.tela-redes-sociais :deep(.tt-label){font-family:'Oswald',sans-serif;font-size:max(9px, calc(11px * var(--escala-texto, 1)));font-weight:400;color:var(--muted);flex:1;letter-spacing:.5px;}
.tela-redes-sociais :deep(.tt-val){font-family:'Oswald',sans-serif;font-weight:500;font-size:max(16px, calc(17px * var(--escala-texto, 1)));color:var(--text);font-variant-numeric:tabular-nums;}
.tela-redes-sociais :deep(.tt-sep){height:1px;background:var(--border);margin:6px 0;}
.tela-redes-sociais :deep(.tt-delta){font-family:'Oswald',sans-serif;font-size:max(9px, calc(11px * var(--escala-texto, 1)));font-weight:400;margin-top:4px;}
.tela-redes-sociais :deep(.tt-cmp){margin-top:9px;padding-top:8px;border-top:1px dashed var(--border);}
.tela-redes-sociais :deep(.tt-cmp-lbl){font-family:'Oswald',sans-serif;font-size:max(9px, calc(8.5px * var(--escala-texto, 1)));font-weight:400;color:var(--muted);letter-spacing:1px;text-transform:uppercase;margin-bottom:3px;}
.tela-redes-sociais :deep(.tt-cmp-row){display:flex;align-items:center;justify-content:space-between;gap:14px;font-family:'Oswald',sans-serif;font-size:max(9px, calc(12px * var(--escala-texto, 1)));color:var(--muted);font-variant-numeric:tabular-nums;}

/* Calc badge / seletor de período personalizado (compartilhado com Análise de Campanhas) */
/* O selo de cálculo passou a carregar a EXPLICAÇÃO do indicador (uma frase, não
   três palavras), e frase quebra linha. `line-height` para as linhas não colarem
   e `align-items:flex-start` para o texto não centralizar em bloco. Continua sem
   `nowrap`: texto cortado é o que não pode. */
.tela-redes-sociais :deep(.calc-badge){display:inline-flex;align-items:flex-start;gap:5px;font-family:var(--fonte-principal);font-size:max(9px, calc(10px * var(--escala-texto, 1)));line-height:1.45;background:var(--accent-light);color:var(--accent-forte);padding:5px 10px;border-radius:2px;margin-top:8px;font-weight:500;letter-spacing:.3px;}
.tela-redes-sociais :deep(.custom-range-btn){font-family:var(--fonte-principal);font-weight:500;font-size:max(9px, calc(11px * var(--escala-texto, 1)));padding:5px 14px;border-radius:3px;background:transparent;border:1px solid var(--border);color:var(--muted);cursor:pointer;transition:all .18s;white-space:nowrap;}
.tela-redes-sociais :deep(.custom-range-btn):hover,.tela-redes-sociais :deep(.custom-range-btn.active){border-color:var(--accent);color:var(--accent);}
.tela-redes-sociais :deep(.custom-date-input){font-family:var(--fonte-principal);font-weight:400;font-size:max(9px, calc(10px * var(--escala-texto, 1)));padding:4px 7px;border-radius:3px;border:1.5px solid var(--border);background:var(--surface);color:var(--text);outline:none;cursor:pointer;flex-shrink:0;}
.tela-redes-sociais :deep(.custom-date-input):hover,.tela-redes-sociais :deep(.custom-date-input):focus{border-color:var(--accent);}
/* 16px no celular: abaixo disso o iOS da zoom sozinho ao focar. No
   computador o tamanho miudo continua, que la nao ha esse efeito. */
@media(max-width:640px){.tela-redes-sociais :deep(.custom-date-input){font-size:max(16px, calc(16px * var(--escala-texto, 1)));}}
.tela-redes-sociais :deep(.custom-range-inline){display:flex;align-items:center;gap:5px;flex-wrap:nowrap;flex-shrink:0;}
.tela-redes-sociais :deep(.custom-range-lbl){font-family:var(--fonte-principal);font-size:max(9px, calc(11px * var(--escala-texto, 1)));color:var(--muted);}
.tela-redes-sociais :deep(.eng-tabs){display:inline-flex;gap:4px;flex-wrap:wrap;margin-bottom:22px;padding:4px;background:var(--surface2);border:1px solid var(--border);border-radius:12px;}
.tela-redes-sociais :deep(.eng-tab){font-family:var(--fonte-principal);font-weight:600;font-size:max(9px, calc(11.5px * var(--escala-texto, 1)));letter-spacing:.2px;padding:7px 18px;border-radius:9px;background:transparent;border:none;color:var(--muted);cursor:pointer;transition:all .16s;white-space:nowrap;}
.tela-redes-sociais :deep(.eng-tab):hover{color:var(--text);background:rgba(128,128,128,.10);}
.tela-redes-sociais :deep(.eng-tab.active){background:var(--accent);color:var(--sobre-cor);box-shadow:0 2px 8px rgba(0,0,0,.14);}
.tela-redes-sociais :deep(.eng-tab.active):hover{background:var(--accent);color:var(--sobre-cor);}
.tela-redes-sociais :deep(.custom-date-input):focus{border-color:var(--accent);}
.tela-redes-sociais :deep(.custom-apply-btn){font-family:var(--fonte-principal);font-weight:600;font-size:max(9px, calc(11px * var(--escala-texto, 1)));padding:5px 14px;border-radius:3px;background:var(--accent);color:var(--sobre-cor);border:none;cursor:pointer;letter-spacing:.5px;text-transform:uppercase;}
.tela-redes-sociais :deep(.custom-clear-btn){font-family:var(--fonte-principal);font-size:max(9px, calc(11px * var(--escala-texto, 1)));padding:5px 10px;border-radius:3px;background:transparent;border:1px solid var(--border);color:var(--muted);cursor:pointer;}

/* Insight card + barra de meta geral */
.tela-redes-sociais :deep(.insight-card){background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:10px 16px 12px;margin-bottom:22px;border-left:3px solid var(--accent);}
.tela-redes-sociais :deep(.insight-header){display:flex;align-items:center;gap:8px;margin-bottom:7px;}
.tela-redes-sociais :deep(.insight-icon){font-size:max(9px, calc(11px * var(--escala-texto, 1)));color:var(--muted);}
.tela-redes-sociais :deep(.insight-title){font-family:var(--fonte-principal);font-weight:600;font-size:max(9px, calc(9px * var(--escala-texto, 1)));letter-spacing:2px;color:var(--muted);text-transform:uppercase;}
.tela-redes-sociais :deep(.insight-period){font-family:var(--fonte-principal);font-size:max(9px, calc(9px * var(--escala-texto, 1)));font-weight:600;letter-spacing:1.5px;color:var(--accent-forte);text-transform:uppercase;margin-left:auto;background:var(--accent-light);padding:2px 7px;border-radius:2px;}
.tela-redes-sociais :deep(.insight-list){display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;}
.tela-redes-sociais :deep(.insight-item){display:inline-flex;align-items:center;gap:6px;font-family:var(--fonte-principal);font-size:max(9px, calc(11px * var(--escala-texto, 1)));line-height:1.4;color:var(--text);background:var(--surface2);border:1px solid var(--border);border-radius:20px;padding:3px 10px;}
.tela-redes-sociais :deep(.insight-dot){width:5px;height:5px;border-radius:50%;flex-shrink:0;}
.tela-redes-sociais :deep(.insight-dot.green){background:var(--green);}
.tela-redes-sociais :deep(.insight-dot.blue){background:var(--accent);}
.tela-redes-sociais :deep(.insight-dot.yellow){background:var(--orange);}
.tela-redes-sociais :deep(.insight-dot.red){background:var(--red);}
.tela-redes-sociais :deep(.insight-dot.muted){background:var(--border);}
.tela-redes-sociais :deep(.insight-item.muted){color:var(--muted);}
.tela-redes-sociais :deep(.overall-bar-row){display:flex;align-items:center;gap:10px;}
.tela-redes-sociais :deep(.overall-bar-lbl){font-family:var(--fonte-principal);font-size:max(9px, calc(9px * var(--escala-texto, 1)));font-weight:600;letter-spacing:1.5px;color:var(--muted);text-transform:uppercase;white-space:nowrap;}
.tela-redes-sociais :deep(.overall-bar-track){flex:1;height:4px;background:var(--surface2);border-radius:2px;overflow:hidden;border:1px solid var(--border);}
.tela-redes-sociais :deep(.overall-bar-fill){height:100%;border-radius:2px;transition:width .9s cubic-bezier(.4,0,.2,1),box-shadow .5s;position:relative;overflow:hidden;}
.tela-redes-sociais :deep(.overall-bar-fill)::after{content:'';position:absolute;top:0;left:-60%;width:55%;height:100%;background:linear-gradient(90deg,transparent,rgba(255,255,255,.45),transparent);animation:barLiq 2.2s ease-in-out infinite;pointer-events:none;}
.tela-redes-sociais :deep(.overall-bar-pct){font-family:'Oswald',sans-serif;font-size:max(9px, calc(13px * var(--escala-texto, 1)));font-weight:500;white-space:nowrap;}
.tela-redes-sociais :deep(#insight-card.loading .insight-list){opacity:.4;}

/* Balde de campanha — recorta a seção 02 por TIPO (exclusivo desta tela).
   ROLA na horizontal em vez de quebrar linha ou encolher a fonte: a 375px os
   cinco rótulos não cabem lado a lado, e quebrar linha empurraria os cartões
   de dinheiro para fora da primeira tela. Aparência copiada da .profile-btn
   desta mesma tela (surface + border + muted), que já é a pílula do app. */
.tela-redes-sociais :deep(.balde-bar){display:flex;gap:6px;overflow-x:auto;-webkit-overflow-scrolling:touch;padding:4px 0 10px;margin-bottom:4px;}
.tela-redes-sociais :deep(.balde-btn){flex:0 0 auto;min-height:40px;padding:9px 16px;border:1px solid var(--border);border-radius:999px;background:var(--surface);color:var(--muted);font-family:var(--fonte-principal);font-size:max(11px, calc(11.5px * var(--escala-texto, 1)));font-weight:600;letter-spacing:.4px;cursor:pointer;white-space:nowrap;transition:background .16s,color .16s,border-color .16s;}
.tela-redes-sociais :deep(.balde-btn:hover:not(:disabled):not([aria-selected="true"])){color:var(--text);border-color:var(--accent-mid);background:var(--accent-light);}
.tela-redes-sociais :deep(.balde-btn[aria-selected="true"]){background:var(--accent);color:var(--sobre-cor);border-color:var(--accent);}
.tela-redes-sociais :deep(.balde-btn:disabled){opacity:.45;cursor:not-allowed;}

/* Filtro de campanhas — barra + modal (exclusivo desta tela) */
.tela-redes-sociais :deep(.camp-filter-bar){display:flex;align-items:center;gap:10px;background:var(--accent-light);border:1px solid var(--accent-mid);border-radius:4px;padding:9px 14px;margin-bottom:14px;flex-wrap:wrap;}
.tela-redes-sociais :deep(.camp-filter-lbl){font-family:var(--fonte-principal);font-size:max(9px, calc(10px * var(--escala-texto, 1)));font-weight:500;color:var(--muted);white-space:nowrap;text-transform:uppercase;letter-spacing:.8px;}
.tela-redes-sociais :deep(.camp-filter-info){font-family:var(--fonte-principal);font-size:max(9px, calc(12px * var(--escala-texto, 1)));font-weight:600;color:var(--accent);flex:1;}
.tela-redes-sociais :deep(.btn-campaign-filter){font-family:var(--fonte-principal);font-size:max(9px, calc(10px * var(--escala-texto, 1)));font-weight:600;padding:5px 14px;border-radius:3px;border:1px solid var(--accent);background:var(--accent);color:var(--sobre-cor);cursor:pointer;letter-spacing:.8px;transition:opacity .15s;white-space:nowrap;text-transform:uppercase;}
.tela-redes-sociais :deep(.btn-campaign-filter):hover{opacity:.85;}
.tela-redes-sociais :deep(.camp-filter-count){font-size:max(9px, calc(10px * var(--escala-texto, 1)));opacity:.8;}
.tela-redes-sociais :deep(.campaign-modal){background:#fff;border-radius:4px;width:500px;max-width:95vw;max-height:82vh;display:flex;flex-direction:column;box-shadow:0 16px 48px rgba(0,0,0,.18);}
.tela-redes-sociais :deep(.camp-modal-hdr){display:flex;align-items:center;justify-content:space-between;padding:18px 20px 10px;font-family:var(--fonte-principal);font-weight:700;font-size:max(9px, calc(14px * var(--escala-texto, 1)));color:var(--text);}
.tela-redes-sociais :deep(.camp-modal-close){background:none;border:none;font-size:max(16px, calc(18px * var(--escala-texto, 1)));cursor:pointer;color:var(--muted);line-height:1;padding:2px 6px;border-radius:3px;transition:background .1s;}
.tela-redes-sociais :deep(.camp-modal-close):hover{background:var(--surface2);}
.tela-redes-sociais :deep(.camp-modal-sub){padding:0 20px 12px;font-family:var(--fonte-principal);font-size:max(9px, calc(12px * var(--escala-texto, 1)));color:var(--muted);line-height:1.5;}
.tela-redes-sociais :deep(.camp-list){flex:1;overflow-y:auto;padding:0 12px 8px;display:flex;flex-direction:column;gap:2px;}
.tela-redes-sociais :deep(.camp-group-hdr){font-family:var(--fonte-principal);font-size:max(9px, calc(9px * var(--escala-texto, 1)));font-weight:700;letter-spacing:2px;color:var(--muted);text-transform:uppercase;padding:10px 8px 4px;margin-top:4px;}
.tela-redes-sociais :deep(.camp-row){display:flex;align-items:flex-start;gap:10px;padding:8px 10px;border-radius:3px;cursor:pointer;transition:background .1s;}
.tela-redes-sociais :deep(.camp-row):hover{background:var(--surface2);}
.tela-redes-sociais :deep(.camp-row) input[type=checkbox]{margin-top:2px;accent-color:var(--accent);width:15px;height:15px;flex-shrink:0;cursor:pointer;}
.tela-redes-sociais :deep(.camp-info){display:flex;flex-direction:column;gap:1px;}
.tela-redes-sociais :deep(.camp-name){font-family:var(--fonte-principal);font-size:max(9px, calc(13px * var(--escala-texto, 1)));font-weight:400;color:var(--text);line-height:1.4;}
.tela-redes-sociais :deep(.camp-obj){font-family:var(--fonte-principal);font-size:max(9px, calc(10px * var(--escala-texto, 1)));color:var(--muted);text-transform:uppercase;letter-spacing:.8px;}
.tela-redes-sociais :deep(.camp-modal-footer){display:flex;gap:10px;padding:14px 20px;border-top:1px solid var(--border);}
.tela-redes-sociais :deep(.btn-camp-all){flex:1;font-family:var(--fonte-principal);font-size:max(9px, calc(11px * var(--escala-texto, 1)));font-weight:500;padding:9px 14px;border-radius:3px;border:1px solid var(--border);background:transparent;color:var(--muted);cursor:pointer;transition:background .1s;letter-spacing:.5px;}
.tela-redes-sociais :deep(.btn-camp-all):hover{background:var(--surface2);}
.tela-redes-sociais :deep(.btn-camp-none){font-family:var(--fonte-principal);font-size:max(9px, calc(11px * var(--escala-texto, 1)));font-weight:500;padding:9px 14px;border-radius:3px;border:1px solid rgba(176,30,58,.3);background:transparent;color:var(--red);cursor:pointer;transition:background .1s;}
.tela-redes-sociais :deep(.btn-camp-none):hover{background:rgba(176,30,58,.04);}
.tela-redes-sociais :deep(.btn-camp-save){flex:2;font-family:var(--fonte-principal);font-size:max(9px, calc(12px * var(--escala-texto, 1)));font-weight:600;padding:9px 20px;border-radius:3px;border:none;background:var(--accent);color:var(--sobre-cor);cursor:pointer;transition:opacity .15s;text-transform:uppercase;letter-spacing:.8px;}
.tela-redes-sociais :deep(.btn-camp-save):hover{opacity:.88;}

/* Painel admin embutido (compartilhado com tela-de-login/Admin tool p/ .admin-input/
   .admin-select/.admin-action-btn/.admin-msg/.user-list/.auth-label — cópia própria) */
.tela-redes-sociais :deep(#admin-panel){background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:28px;margin-bottom:32px;animation:fadeUp .3s ease;}
.tela-redes-sociais :deep(.admin-title){font-family:'Oswald',sans-serif;font-size:max(16px, calc(20px * var(--escala-texto, 1)));font-weight:500;letter-spacing:3px;text-transform:uppercase;margin-bottom:20px;display:flex;align-items:center;gap:10px;color:var(--text);}
.tela-redes-sociais :deep(.admin-grid){display:grid;grid-template-columns:1fr 1fr;gap:20px;}
@media(max-width:640px){.tela-redes-sociais :deep(.admin-grid){grid-template-columns:1fr;}}
.tela-redes-sociais :deep(.admin-section-title){font-family:var(--fonte-principal);font-size:max(9px, calc(9px * var(--escala-texto, 1)));letter-spacing:2px;color:var(--muted);text-transform:uppercase;margin-bottom:12px;font-weight:600;}
.tela-redes-sociais :deep(.admin-input-row){display:flex;gap:8px;margin-bottom:10px;}
.tela-redes-sociais :deep(.admin-input){flex:1;padding:9px 12px;background:var(--surface2);border:1.5px solid var(--border);border-radius:3px;color:var(--text);font-family:var(--fonte-principal);font-size:max(9px, calc(13px * var(--escala-texto, 1)));outline:none;transition:border-color .18s;}
.tela-redes-sociais :deep(.admin-input):focus{border-color:var(--accent);}
.tela-redes-sociais :deep(.admin-select){padding:9px 12px;background:var(--surface2);border:1.5px solid var(--border);border-radius:3px;color:var(--text);font-family:var(--fonte-principal);font-size:max(9px, calc(12px * var(--escala-texto, 1)));outline:none;cursor:pointer;}
.tela-redes-sociais :deep(.admin-action-btn){padding:9px 16px;background:var(--accent);color:var(--sobre-cor);border:none;border-radius:3px;font-family:var(--fonte-principal);font-size:max(9px, calc(11px * var(--escala-texto, 1)));cursor:pointer;white-space:nowrap;transition:opacity .18s;font-weight:600;text-transform:uppercase;letter-spacing:.8px;}
.tela-redes-sociais :deep(.admin-action-btn):hover{opacity:.85;}
.tela-redes-sociais :deep(.admin-action-btn):disabled{opacity:.5;}
.tela-redes-sociais :deep(.admin-msg){font-family:var(--fonte-principal);font-size:max(9px, calc(11px * var(--escala-texto, 1)));margin-top:8px;padding:7px 12px;border-radius:3px;display:none;}
.tela-redes-sociais :deep(.admin-msg.ok){background:rgba(26,110,69,.07);color:var(--green);}
.tela-redes-sociais :deep(.admin-msg.err){background:rgba(176,30,58,.06);color:var(--red);}
.tela-redes-sociais :deep(.user-list){display:flex;flex-direction:column;gap:8px;}
.tela-redes-sociais :deep(.user-row){display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--surface2);border-radius:3px;border:1px solid var(--border);}
.tela-redes-sociais :deep(.user-info){display:flex;flex-direction:column;gap:2px;}
.tela-redes-sociais :deep(.user-email){font-family:var(--fonte-principal);font-size:max(9px, calc(12px * var(--escala-texto, 1)));font-weight:600;color:var(--text);}
.tela-redes-sociais :deep(.user-name){font-family:var(--fonte-principal);font-size:max(9px, calc(11px * var(--escala-texto, 1)));font-weight:400;color:var(--muted);}
.tela-redes-sociais :deep(.user-role-select){font-family:var(--fonte-principal);font-size:max(9px, calc(11px * var(--escala-texto, 1)));padding:4px 8px;background:var(--surface);border:1px solid var(--border);border-radius:3px;color:var(--text);cursor:pointer;outline:none;}

/* ── RESPONSIVE ── */

/* MOBILE (≤ 480px) */
@media(max-width:480px){
  .tela-redes-sociais :deep(.wrapper){padding:0 0 24px;}
  .tela-redes-sociais :deep(.topbar){flex-wrap:wrap;gap:0;padding:0;margin-bottom:0;border-bottom:1px solid var(--border);}
  .tela-redes-sociais :deep(.topbar-left){flex:1;min-width:0;gap:8px;padding:9px 52px 9px 12px;order:1;/* espaço à direita pro avatar */}
  .tela-redes-sociais :deep(.topbar-right){gap:6px;padding:9px 12px;order:2;}
  .tela-redes-sociais :deep(.topbar-center){order:3;width:100%;padding:6px 12px 8px;border-top:1px solid var(--border);overflow-x:auto;-webkit-overflow-scrolling:touch;gap:6px;flex-wrap:nowrap;box-sizing:border-box;}
  .tela-redes-sociais :deep(.topbar) .rbv-logo{display:none!important;}
  .tela-redes-sociais :deep(.gv-perf-tag){font-size:max(9px, calc(9px * var(--escala-texto, 1)))!important;letter-spacing:2px!important;}
  .tela-redes-sociais :deep(.gv-brand-tag){display:none!important;}
  .tela-redes-sociais :deep(.period-tabs){gap:3px;flex-shrink:0;}
  .tela-redes-sociais :deep(.ptab){padding:5px 10px;font-size:max(9px, calc(10px * var(--escala-texto, 1)));letter-spacing:.5px;}
  .tela-redes-sociais :deep(#dash-clock){font-size:max(9px, calc(11px * var(--escala-texto, 1)));}
  .tela-redes-sociais :deep(.live-dot){font-size:max(9px, calc(8px * var(--escala-texto, 1)));letter-spacing:1px;}
  .tela-redes-sociais :deep(.ac-toggle-lbl){display:none;}
  .tela-redes-sociais :deep(.ac-toggle){flex-shrink:0;}
  .tela-redes-sociais :deep(.gv-back){font-size:max(9px, calc(11px * var(--escala-texto, 1)));padding:5px 10px;}
  .tela-redes-sociais :deep(header){padding:8px 12px;margin-bottom:0;gap:8px;flex-wrap:nowrap;overflow:hidden;border-bottom:1px solid var(--border);}
  .tela-redes-sociais :deep(#header-collapsible){flex:1;min-width:0;overflow-x:auto;-webkit-overflow-scrolling:touch;}
  .tela-redes-sociais :deep(.profile-select){flex-wrap:nowrap;gap:5px;}
  .tela-redes-sociais :deep(.profile-btn){padding:5px 8px;font-size:max(9px, calc(10px * var(--escala-texto, 1)));white-space:nowrap;flex-shrink:0;}
  .tela-redes-sociais :deep(.profile-btn .av){width:18px;height:18px;font-size:max(9px, calc(8px * var(--escala-texto, 1)));}
  .tela-redes-sociais :deep(#header-toggle){flex-shrink:0;align-self:center;}
  .tela-redes-sociais :deep(#active-profile-bar){padding:8px 12px;margin-bottom:0;gap:7px;border-bottom:1px solid var(--border);}
  .tela-redes-sociais :deep(#apb-name){font-size:max(9px, calc(15px * var(--escala-texto, 1)));letter-spacing:1.5px;}
  .tela-redes-sociais :deep(#apb-ring-wrap){display:flex;}
  .tela-redes-sociais :deep(#apb-img){width:28px;height:28px;}
  .tela-redes-sociais :deep(#apb-dot){width:6px;height:6px;}
  .tela-redes-sociais :deep(.sec-header){margin:14px 12px 8px;padding-bottom:0;}
  .tela-redes-sociais :deep(.section-label){font-size:max(9px, calc(8px * var(--escala-texto, 1)));letter-spacing:2px;}
  .tela-redes-sociais :deep(.sec-chip){font-size:max(9px, calc(8px * var(--escala-texto, 1)));padding:2px 6px;}
  /* Os 12px laterais alinham as pílulas com os cartões (que ganham
     `padding:0 12px` no celular) e tiram a primeira de cima da borda da tela. */
  .tela-redes-sociais :deep(.balde-bar){padding:6px 12px 8px;margin-bottom:0;}
  .tela-redes-sociais :deep(.camp-filter-bar){padding:6px 12px;font-size:max(9px, calc(10px * var(--escala-texto, 1)));gap:5px;}
  .tela-redes-sociais :deep(.camp-filter-lbl){display:none;}
  .tela-redes-sociais :deep(.btn-campaign-filter){font-size:max(9px, calc(9px * var(--escala-texto, 1)));padding:4px 8px;}
  .tela-redes-sociais :deep(.sec1-grid),.tela-redes-sociais :deep(.sec2-grid),.tela-redes-sociais :deep(.sec3-grid),.tela-redes-sociais :deep(.sec4-grid){grid-template-columns:1fr;gap:8px;padding:0 12px;margin-left:0;margin-right:0;}
  .tela-redes-sociais :deep(.mb40){margin-bottom:16px;}
  .tela-redes-sociais :deep(.card){padding:13px 14px;border-radius:3px;}
  .tela-redes-sociais :deep(.mc-val){font-size:max(16px, calc(32px * var(--escala-texto, 1)));margin-bottom:5px;}
  .tela-redes-sociais :deep(#total-followers){font-size:max(16px, calc(38px * var(--escala-texto, 1)))!important;}
  .tela-redes-sociais :deep(.mc-lbl){font-size:max(9px, calc(8px * var(--escala-texto, 1)));letter-spacing:1.5px;}
  .tela-redes-sociais :deep(.mc-compare-prev),.tela-redes-sociais :deep(.mc-compare-delta){font-size:max(9px, calc(11px * var(--escala-texto, 1)));}
  .tela-redes-sociais :deep(.mc-pct){font-size:max(9px, calc(13px * var(--escala-texto, 1)));}
  .tela-redes-sociais :deep(.mc-diff){font-size:max(9px, calc(11px * var(--escala-texto, 1)));}
  .tela-redes-sociais :deep(.mc-icon){font-size:max(16px, calc(16px * var(--escala-texto, 1)));}
  .tela-redes-sociais :deep(.calc-badge){font-size:max(9px, calc(8px * var(--escala-texto, 1)));padding:4px 8px;margin-top:8px;}
  .tela-redes-sociais :deep(#followers-hero){padding:14px 14px 12px;}
  .tela-redes-sociais :deep(#followers-hero) .mc-lbl{font-size:max(9px, calc(7px * var(--escala-texto, 1)));margin-bottom:6px;}
  .tela-redes-sociais :deep(.chart-legend){flex-wrap:wrap;gap:4px;}
  .tela-redes-sociais :deep(.x-labels){font-size:max(9px, calc(8px * var(--escala-texto, 1)));}
}

/* TABLET (481px – 1024px) */
@media(min-width:481px) and (max-width:1024px){
  .tela-redes-sociais :deep(.wrapper){padding:14px 20px;}
  .tela-redes-sociais :deep(.sec1-grid){grid-template-columns:1fr;}
  .tela-redes-sociais :deep(.sec3-grid){grid-template-columns:repeat(2,1fr);}
  .tela-redes-sociais :deep(.mc-val){font-size:max(16px, calc(38px * var(--escala-texto, 1)));}
  .tela-redes-sociais :deep(#total-followers){font-size:max(16px, calc(48px * var(--escala-texto, 1)))!important;}
  .tela-redes-sociais :deep(#apb-name){font-size:max(16px, calc(18px * var(--escala-texto, 1)));}
}

/* TV / WIDESCREEN (≥ 1600px) */
@media(min-width:1600px){
  .tela-redes-sociais :deep(.wrapper){max-width:none;padding:20px 28px;} /* usa a largura toda (era 5vw = ~84px de margem no notebook) */
  .tela-redes-sociais :deep(header){margin-bottom:18px;padding-bottom:14px;}
  .tela-redes-sociais :deep(#apb-name){font-size:max(16px, calc(30px * var(--escala-texto, 1)));}
  .tela-redes-sociais :deep(#apb-dot){width:11px;height:11px;}
  .tela-redes-sociais :deep(.section-label){font-size:max(9px, calc(13px * var(--escala-texto, 1)));}
  .tela-redes-sociais :deep(.mc-lbl){font-size:max(9px, calc(13px * var(--escala-texto, 1)));}
  .tela-redes-sociais :deep(.mc-val){font-size:max(16px, calc(58px * var(--escala-texto, 1)));}
  .tela-redes-sociais :deep(#total-followers){font-size:max(16px, calc(72px * var(--escala-texto, 1)))!important;}
  .tela-redes-sociais :deep(.card){padding:28px 32px;}
  .tela-redes-sociais :deep(.mb40){margin-bottom:30px;}
  .tela-redes-sociais :deep(.sec-header){margin-bottom:12px;}
  .tela-redes-sociais :deep(.sec3-grid){grid-template-columns:repeat(3,1fr);gap:20px;}
  .tela-redes-sociais :deep(.sec4-grid){grid-template-columns:repeat(3,1fr);gap:20px;}
  .tela-redes-sociais :deep(.sec1-grid){grid-template-columns:340px 1fr;gap:20px;}
  .tela-redes-sociais :deep(.ptab){padding:6px 20px;font-size:max(9px, calc(13px * var(--escala-texto, 1)));}
  .tela-redes-sociais :deep(.profile-btn){padding:9px 18px;font-size:max(9px, calc(13px * var(--escala-texto, 1)));}
  .tela-redes-sociais :deep(.profile-btn .av){width:26px;height:26px;font-size:max(9px, calc(11px * var(--escala-texto, 1)));}
  .tela-redes-sociais :deep(.mc-compare-prev),.tela-redes-sociais :deep(.mc-compare-delta){font-size:max(9px, calc(14px * var(--escala-texto, 1)));}
  .tela-redes-sociais :deep(.mc-pct){font-size:max(16px, calc(18px * var(--escala-texto, 1)));}
  .tela-redes-sociais :deep(.mc-diff){font-size:max(9px, calc(12px * var(--escala-texto, 1)));}
  .tela-redes-sociais :deep(.sec-chip){font-size:max(9px, calc(12px * var(--escala-texto, 1)));padding:4px 10px;}
  .tela-redes-sociais :deep(#autocycle-badge){font-size:max(9px, calc(13px * var(--escala-texto, 1)));padding:9px 18px;}
}

/* FULLHD+ (≥ 1920px) */
@media(min-width:1920px){
  .tela-redes-sociais :deep(.mc-val){font-size:max(16px, calc(68px * var(--escala-texto, 1)));}
  .tela-redes-sociais :deep(#total-followers){font-size:max(16px, calc(84px * var(--escala-texto, 1)))!important;}
  .tela-redes-sociais :deep(#apb-name){font-size:max(16px, calc(36px * var(--escala-texto, 1)));}
  .tela-redes-sociais :deep(.card){padding:32px 36px;}
}

/* TV MODE (body.dev-tv — somente ≥ 1920px via JS de detecção de dispositivo) */
body.dev-tv .tela-redes-sociais :deep(.wrapper){max-width:none;padding:24px 40px;}
body.dev-tv .tela-redes-sociais :deep(#apb-name){font-size:max(16px, calc(52px * var(--escala-texto, 1)));}
body.dev-tv .tela-redes-sociais :deep(.section-label){font-size:max(16px, calc(18px * var(--escala-texto, 1)));letter-spacing:3px;}
body.dev-tv .tela-redes-sociais :deep(.mc-lbl){font-size:max(16px, calc(16px * var(--escala-texto, 1)));letter-spacing:2px;}
body.dev-tv .tela-redes-sociais :deep(.mc-val){font-size:max(16px, calc(100px * var(--escala-texto, 1)));}
body.dev-tv .tela-redes-sociais :deep(#total-followers){font-size:max(16px, calc(96px * var(--escala-texto, 1)))!important;}
body.dev-tv .tela-redes-sociais :deep(.mc-compare-label){font-size:max(9px, calc(14px * var(--escala-texto, 1)));}
body.dev-tv .tela-redes-sociais :deep(.mc-compare-prev){font-size:max(16px, calc(20px * var(--escala-texto, 1)));}
body.dev-tv .tela-redes-sociais :deep(.mc-compare-delta){font-size:max(16px, calc(20px * var(--escala-texto, 1)));}
body.dev-tv .tela-redes-sociais :deep(.mc-pct){font-size:max(16px, calc(26px * var(--escala-texto, 1)));}
body.dev-tv .tela-redes-sociais :deep(.mc-diff){font-size:max(16px, calc(16px * var(--escala-texto, 1)));}
body.dev-tv .tela-redes-sociais :deep(.sec-chip){font-size:max(9px, calc(14px * var(--escala-texto, 1)));padding:5px 12px;}
body.dev-tv .tela-redes-sociais :deep(.profile-btn){font-size:max(16px, calc(16px * var(--escala-texto, 1)));padding:10px 22px;}
body.dev-tv .tela-redes-sociais :deep(.profile-btn .av){width:30px;height:30px;font-size:max(9px, calc(13px * var(--escala-texto, 1)));}
body.dev-tv .tela-redes-sociais :deep(#apb-img){width:64px;height:64px;}
body.dev-tv .tela-redes-sociais :deep(.ptab){font-size:max(16px, calc(16px * var(--escala-texto, 1)));padding:8px 24px;}
body.dev-tv .tela-redes-sociais :deep(.live-dot){font-size:max(9px, calc(13px * var(--escala-texto, 1)));}
body.dev-tv .tela-redes-sociais :deep(.ac-toggle-lbl){font-size:max(9px, calc(14px * var(--escala-texto, 1)));}
body.dev-tv .tela-redes-sociais :deep(#dash-clock){font-size:max(16px, calc(23px * var(--escala-texto, 1)));}
body.dev-tv .tela-redes-sociais :deep(.insight-icon){font-size:max(16px, calc(17px * var(--escala-texto, 1)));}
body.dev-tv .tela-redes-sociais :deep(.insight-title){font-size:max(9px, calc(14px * var(--escala-texto, 1)));}
body.dev-tv .tela-redes-sociais :deep(.insight-period){font-size:max(9px, calc(14px * var(--escala-texto, 1)));padding:3px 10px;}
body.dev-tv .tela-redes-sociais :deep(.insight-item){font-size:max(16px, calc(17px * var(--escala-texto, 1)));padding:5px 15px;}
body.dev-tv .tela-redes-sociais :deep(.overall-bar-lbl){font-size:max(9px, calc(14px * var(--escala-texto, 1)));}
body.dev-tv .tela-redes-sociais :deep(.overall-bar-pct){font-size:max(16px, calc(20px * var(--escala-texto, 1)));}
body.dev-tv .tela-redes-sociais :deep(.legend-item){font-size:max(9px, calc(13px * var(--escala-texto, 1)));}
body.dev-tv .tela-redes-sociais :deep(.mc-goal-lbl){font-size:max(9px, calc(13px * var(--escala-texto, 1)));}
body.dev-tv .tela-redes-sociais :deep(.mc-goal-val){font-size:max(16px, calc(16px * var(--escala-texto, 1)));}
body.dev-tv .tela-redes-sociais :deep(.calc-badge){font-size:max(9px, calc(13px * var(--escala-texto, 1)));padding:4px 12px;}
body.dev-tv .tela-redes-sociais :deep(.camp-filter-lbl){font-size:max(9px, calc(13px * var(--escala-texto, 1)));}
body.dev-tv .tela-redes-sociais :deep(.camp-filter-info){font-size:max(16px, calc(16px * var(--escala-texto, 1)));}
body.dev-tv .tela-redes-sociais :deep(.btn-campaign-filter){font-size:max(9px, calc(13px * var(--escala-texto, 1)));}
body.dev-tv .tela-redes-sociais :deep(.rbv-logo){height:72px;}
/* FAIXA DE CONTROLES — ver o comentario no template. */
.gv-controles{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap;padding:0;background:transparent;}  /* mora DENTRO da barra: fundo, borda de baixo e respiro lateral sao dela */
@media(max-width:640px){.gv-controles{padding:8px 12px;flex-direction:column;align-items:stretch;gap:8px;}}
</style>
