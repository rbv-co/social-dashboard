// coletor/lib/template-opr.mjs
// HTML autocontido (CSS inline, sem fonte/imagem externa) pro relatório OPR
// diário — vira PNG via render-criativo.mjs::renderPNG. Layout aprovado pelo
// dono em 17/09/2026, a partir de um HTML de exemplo que ele mesmo trouxe —
// esta versão troca o `mockData`/JS de cliente por interpolação direta dos
// números reais (nunca client-side, mesma regra do resto do projeto).
//
// `dados.sales.leadsQuentes/vendas` (e tudo que depende deles) chegam como
// `null` — dependem do Chatwoot, integração futura — `null` sempre aparece
// como "—", nunca um número inventado. Media Mix já foi confirmado
// (17-18/09/2026, ver CAMPOS_CONFIRMADOS em relatorio-diario-opr.js) e tem
// CINCO fatias, não três: Growth/Engagement/Leads (WPP) + Sales (Link)/
// Leads (Link) (anúncio "outro" classificado pelo destino do link,
// 18/09/2026) — as duas últimas entraram em investimentoTotal desde então,
// então mostrar só as três primeiras aqui deixaria o card sem bater 100%
// com o resto do relatório (a tela interativa, tela-de-relatorio-opr.vue,
// já mostra as cinco).
export const DIM_OPR = { width: 1600, height: 900 };

// Abrevia acima de mil/milhão (arredondado, 1 decimal) — pedido do dono
// (17/09/2026): "os valores estão quebrando linha, vamos usar mil e M pra
// arredondar em valores muito altos". `null` quando NÃO precisa abreviar.
function abreviar(n) {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} M`;
  if (abs >= 1_000) return `${(n / 1_000).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} mil`;
  return null;
}
// `null` no dado vira "—" — nunca "R$ 0,00"/"0%" inventado (regra "a tela
// nunca mente" do projeto). `tipo`: 'moeda' | 'percentual' | undefined (= número puro).
function fmtValor(n, tipo) {
  if (n == null) return '—';
  if (tipo === 'percentual') return `${n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
  const abreviado = abreviar(n);
  if (tipo === 'moeda') return `R$ ${abreviado ?? n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return abreviado ?? n.toLocaleString('pt-BR');
}

const ICONES = {
  coins: '<svg viewBox="0 0 48 48"><ellipse cx="17" cy="13" rx="9" ry="4"/><path d="M8 13v7c0 2.2 4 4 9 4s9-1.8 9-4v-7"/><ellipse cx="28" cy="20" rx="9" ry="4"/><path d="M19 20v7c0 2.2 4 4 9 4s9-1.8 9-4v-7"/><ellipse cx="18" cy="29" rx="9" ry="4"/><path d="M9 29v7c0 2.2 4 4 9 4s9-1.8 9-4v-7"/></svg>',
  users: '<svg viewBox="0 0 48 48"><circle cx="18" cy="17" r="5"/><circle cx="31" cy="18" r="4"/><path d="M8 36c0-7 4-11 10-11s10 4 10 11"/><path d="M27 27c1.4-.8 2.8-1 4-1 5 0 8 3.4 8 9"/></svg>',
  heart: '<svg viewBox="0 0 48 48"><path d="M24 39S9 30 9 18c0-5 3.4-8 8-8 3.4 0 5.6 1.7 7 4 1.4-2.3 3.6-4 7-4 4.6 0 8 3 8 8 0 12-15 21-15 21Z"/></svg>',
  funnel: '<svg viewBox="0 0 48 48"><path d="M8 10h32L28 25v11l-8 4V25L8 10Z"/></svg>',
  bars: '<svg viewBox="0 0 48 48"><path d="M12 37V27M24 37V18M36 37V10"/></svg>',
};

function kpiCard(icone, label, valor, caption) {
  return `<div class="kpi-card"><div class="icon-circle">${ICONES[icone]}</div><div><div class="kpi-label">${label}</div><div class="kpi-value">${valor}</div><div class="kpi-caption">${caption}</div></div></div>`;
}
function metric(label, valor, extra = '') {
  return `<div class="metric ${extra}"><div class="metric-label">${label}</div><div class="metric-value">${valor}</div></div>`;
}
function funnelStep(label, valor, classe = '') {
  return `<div class="funnel-step ${classe}"><div class="funnel-label">${label}</div><div class="funnel-value">${valor}</div></div>`;
}
function panelNote(icone, texto) {
  return `<div class="panel-note"><div class="icon-circle">${ICONES[icone]}</div><div class="note-text">${texto}</div></div>`;
}
function mixRow(label, pct) {
  const largura = pct == null ? 0 : Math.min(Math.max(pct, 0), 100);
  return `<div class="mix-row"><div>${label}</div><div class="bar"><span style="width:${largura}%"></span></div><strong>${fmtValor(pct, 'percentual')}</strong></div>`;
}

export function montarHtmlOpr(dados, meta) {
  const { header, growth, engagement, sales, mix } = dados;
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<style>
  :root{
    --ink:#123b39; --gold:#b59a67; --gold-soft:#f4efe3; --paper:#fffefa;
    --line:#e7e4dc; --line-2:#d9d5cc; --soft:#f8f6f0; --green:#195c52;
  }
  *{box-sizing:border-box}
  html,body{margin:0;background:#151916;font-family:Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;color:var(--ink)}
  body{padding:16px}
  .report{
    width:min(1600px, calc(100vw - 32px));
    aspect-ratio:16/9;
    margin:0 auto;
    background:var(--paper);
    padding:34px 34px 24px;
    display:grid;
    grid-template-rows:auto auto 1fr auto;
    gap:14px;
    overflow:hidden;
    box-shadow:0 12px 60px rgba(0,0,0,.24);
  }
  .header{display:grid;grid-template-columns:1.8fr 1fr;gap:26px;align-items:start}
  .eyebrow-line{width:56px;height:4px;background:var(--gold);margin:2px 0 10px}
  .title{font:700 clamp(28px,3vw,58px)/.96 Georgia, "Times New Roman", serif;letter-spacing:.02em;margin:0;color:#123432}
  .subtitle{margin-top:6px;font-size:clamp(14px,1.25vw,25px);letter-spacing:.13em;color:#686b68}
  .meta{display:grid;grid-template-columns:1fr .9fr .7fr;min-height:88px;border-left:1px solid var(--line-2)}
  .meta-item{padding:10px 22px;border-right:1px solid var(--line-2)}
  .meta-label{font-size:10px;letter-spacing:.32em;text-transform:uppercase;color:#7b7b73;margin-bottom:8px}
  .meta-value{font:400 18px Georgia, serif;color:#173b39}
  .meta .accent::after{content:"";display:block;width:28px;height:3px;background:var(--gold);margin-top:15px}
  .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
  .kpi-card{border:1px solid var(--line);border-radius:7px;padding:18px 20px;display:grid;grid-template-columns:86px 1fr;align-items:center;min-height:148px;box-shadow:0 1px 0 rgba(0,0,0,.025)}
  .icon-circle{width:72px;height:72px;border-radius:50%;background:var(--gold-soft);display:grid;place-items:center;color:var(--ink)}
  .icon-circle svg{width:40px;height:40px;stroke:currentColor;fill:none;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
  .kpi-label{font:400 18px Georgia,serif;margin-bottom:3px}
  .kpi-value{font:700 clamp(27px,2.3vw,47px)/1 Georgia,serif;letter-spacing:.02em}
  .kpi-caption{margin-top:12px;font-size:10px;letter-spacing:.26em;text-transform:uppercase;color:#797b77}
  .sections{display:grid;grid-template-columns:1fr 1.18fr 1.08fr;gap:14px;min-height:0}
  .panel{border:1px solid var(--line);border-radius:7px;padding:12px 14px 10px;display:flex;flex-direction:column;min-width:0}
  .panel-head{display:grid;grid-template-columns:76px 1fr;gap:14px;align-items:center;padding:2px 4px 14px;border-bottom:1px solid var(--line)}
  .panel-num{font:400 40px Georgia,serif;color:var(--gold);padding-right:12px;border-right:1px solid #8e8d86}
  .panel-title{font:700 28px Georgia,serif;line-height:1.05}
  .panel-sub{font-size:10px;letter-spacing:.24em;text-transform:uppercase;color:#747975;margin-top:5px}
  .metric-grid{display:grid;gap:0;margin-top:11px}
  .growth-top{grid-template-columns:repeat(3,1fr)}
  .growth-bottom{grid-template-columns:1fr 1fr 1.15fr;border-top:1px solid var(--line);margin-top:10px}
  .engagement-top{grid-template-columns:1.5fr repeat(4,1fr)}
  .engagement-mid{grid-template-columns:repeat(4,1fr);border-top:1px solid var(--line);margin-top:9px}
  .engagement-bottom{grid-template-columns:1fr 1fr;border-top:1px solid var(--line);margin-top:9px}
  .leads-costs{grid-template-columns:repeat(4,1fr);margin-top:12px}
  .leads-conv{grid-template-columns:1fr 1fr;border-top:1px solid var(--line);margin-top:8px}
  .metric{padding:6px 8px;min-width:0}
  .metric:not(:first-child){border-left:1px solid var(--line)}
  .metric-label{font-size:12px;color:#58635f;line-height:1.25;overflow-wrap:break-word;height:30px;display:flex;align-items:flex-end}
  .metric-value{font:700 18px Georgia,serif;line-height:1.15;margin-top:9px;overflow-wrap:break-word}
  .metric.center{text-align:center}
  .panel-note{margin-top:auto;min-height:74px;background:var(--soft);display:grid;grid-template-columns:74px 1fr;align-items:center;padding:10px 14px}
  .panel-note .icon-circle{width:56px;height:56px}
  .panel-note .icon-circle svg{width:28px;height:28px}
  .note-text{font:italic 17px/1.15 Georgia,serif;color:#48615d}
  .funnel{display:grid;grid-template-columns:1fr 1fr 1fr;height:62px;margin:13px 0 8px;overflow:hidden}
  .funnel-step{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#e7e7df;color:#29443f;padding-left:17px;text-align:center;clip-path:polygon(0 0, 88% 0, 100% 50%, 88% 100%, 0 100%, 12% 50%);margin-left:-8px}
  .funnel-step:first-child{margin-left:0;clip-path:polygon(0 0,88% 0,100% 50%,88% 100%,0 100%)}
  .funnel-step.mid{background:#cfd5d1}
  .funnel-step.end{background:var(--green);color:#fff;clip-path:polygon(0 0,88% 0,100% 50%,88% 100%,0 100%,12% 50%)}
  .funnel-label{font-size:13px}
  .funnel-value{font:700 22px Georgia,serif;margin-top:2px}
  .footer{display:grid;grid-template-columns:1.35fr .9fr;gap:20px;align-items:end}
  .footer-left{border-top:2px solid #aaa9a3;padding:18px 22px 0;font-size:11px;letter-spacing:.29em;text-transform:uppercase;color:#9a9690;min-height:84px}
  .mix-card{border:1px solid var(--line);border-radius:6px;padding:8px 12px;display:grid;grid-template-columns:1fr 190px;gap:16px;align-items:center}
  .mix-title{font:700 17px Georgia,serif}
  .mix-sub{font-size:9px;letter-spacing:.26em;color:#8c8d87;text-transform:uppercase;margin-top:1px}
  /* 5 fatias desde 21/09/2026 (Sales/Leads por Link entraram) — linha mais
     enxuta que a original (era pensada pra 3): com o espaçamento antigo o
     card cresce, empurra a seção 03 pra fora e sobrepõe (visto ao vivo,
     renderizando com dado real). */
  .mix-row{display:grid;grid-template-columns:72px 1fr minmax(45px,auto);gap:10px;align-items:center;margin-top:5px;font-size:10px}
  .mix-row strong{white-space:nowrap}
  .bar{height:7px;background:#e9e9e6;border-radius:3px;overflow:hidden}
  .bar span{display:block;height:100%;background:var(--green)}
  .mix-side{border-left:1px solid var(--line-2);padding-left:18px;font:italic 15px/1.25 Georgia,serif;color:#52645f}
  .mix-side small{display:block;font:9px/1.5 Inter,sans-serif;letter-spacing:.25em;text-transform:uppercase;color:#aaa59c;margin-top:10px}
  .mix-side small::after{content:"";display:block;width:28px;height:2px;background:var(--gold);margin-top:8px}
</style>
</head>
<body>
  <main class="report">
    <header class="header">
      <div>
        <div class="eyebrow-line"></div>
        <h1 class="title">PAID MEDIA PERFORMANCE</h1>
        <div class="subtitle">Dashboard Executivo · Tráfego Pago</div>
      </div>
      <div class="meta">
        <div class="meta-item"><div class="meta-label">Conta / Perfil:</div><div class="meta-value">${meta.conta}</div></div>
        <div class="meta-item"><div class="meta-label">Período:</div><div class="meta-value">${meta.periodoLabel}</div></div>
        <div class="meta-item accent"><div class="meta-label">Estratégia<br>Dados<br>Crescimento</div></div>
      </div>
    </header>

    <section class="kpis">
      ${kpiCard('coins', 'Investimento Total', fmtValor(header.investimentoTotal, 'moeda'), 'Em tráfego pago')}
      ${kpiCard('users', 'Novos Seguidores', fmtValor(header.novosSeguidores), '+ audiência qualificada')}
      ${kpiCard('heart', 'Engajamentos', fmtValor(header.engajamentos), 'Interações totais')}
      ${kpiCard('funnel', 'Leads Gerados', fmtValor(header.leadsGerados), 'Oportunidades de negócio')}
    </section>

    <section class="sections">
      <article class="panel">
        <div class="panel-head">
          <div class="panel-num">01</div>
          <div><div class="panel-title">Growth / Seguidores</div><div class="panel-sub">Aquisição e expansão de audiência</div></div>
        </div>
        <div class="metric-grid growth-top">
          ${metric('Investimento', fmtValor(growth.investimento, 'moeda'))}
          ${metric('Seguidores', fmtValor(growth.seguidores))}
          ${metric('Visitas ao Perfil', fmtValor(growth.visitasPerfil))}
        </div>
        <div class="metric-grid growth-bottom">
          ${metric('Custo por Seguidor', fmtValor(growth.custoPorSeguidor, 'moeda'))}
          ${metric('Custo por Visita', fmtValor(growth.custoPorVisita, 'moeda'))}
          ${metric('Conversão Visita → Seguidor', fmtValor(growth.conversaoVisitaSeguidor, 'percentual'))}
        </div>
        ${panelNote('bars', 'Mais pessoas. Mais relevância.<br>Uma comunidade em crescimento.')}
      </article>

      <article class="panel">
        <div class="panel-head">
          <div class="panel-num">02</div>
          <div><div class="panel-title">Engagement</div><div class="panel-sub">Interações que fortalecem a marca</div></div>
        </div>
        <div class="metric-grid engagement-top">
          ${metric('Investimento', fmtValor(engagement.investimento, 'moeda'))}
          ${metric('Curtidas', fmtValor(engagement.curtidas))}
          ${metric('Comentários', fmtValor(engagement.comentarios))}
          ${metric('Compart.', fmtValor(engagement.compartilhamentos))}
          ${metric('Salvamentos', fmtValor(engagement.salvamentos))}
        </div>
        <div class="metric-grid engagement-mid">
          ${metric('Custo / Curtida', fmtValor(engagement.custoPorCurtida, 'moeda'))}
          ${metric('Custo / Comentário', fmtValor(engagement.custoPorComentario, 'moeda'))}
          ${metric('Custo / Compart.', fmtValor(engagement.custoPorCompartilhamento, 'moeda'))}
          ${metric('Custo / Salvamento', fmtValor(engagement.custoPorSalvamento, 'moeda'))}
        </div>
        <div class="metric-grid engagement-bottom">
          ${metric('Total de Interações', fmtValor(engagement.totalInteracoes), 'center')}
          ${metric('Custo Médio por Engajamento', fmtValor(engagement.custoMedioPorEngajamento, 'moeda'), 'center')}
        </div>
        ${panelNote('heart', 'Conteúdo que conecta.<br>Resultados que constroem valor.')}
      </article>

      <article class="panel">
        <div class="panel-head">
          <div class="panel-num">03</div>
          <div><div class="panel-title">Leads & Sales</div><div class="panel-sub">Do interesse ao faturamento</div></div>
        </div>
        <div class="funnel">
          ${funnelStep('Leads', fmtValor(sales.leads))}
          ${funnelStep('Leads Quentes', fmtValor(sales.leadsQuentes), 'mid')}
          ${funnelStep('Vendas', fmtValor(sales.vendas), 'end')}
        </div>
        <div class="metric-grid leads-costs">
          ${metric('Investimento', fmtValor(sales.investimento, 'moeda'))}
          ${metric('Custo por Lead', fmtValor(sales.custoPorLead, 'moeda'))}
          ${metric('Custo por Lead Quente', fmtValor(sales.custoPorLeadQuente, 'moeda'))}
          ${metric('Custo por Venda', fmtValor(sales.custoPorVenda, 'moeda'))}
        </div>
        <div class="metric-grid leads-conv">
          ${metric('Conversão Lead → Quente', fmtValor(sales.conversaoLeadQuente, 'percentual'), 'center')}
          ${metric('Conversão Quente → Venda', fmtValor(sales.conversaoQuenteVenda, 'percentual'), 'center')}
        </div>
        ${panelNote('funnel', 'Mais oportunidades.<br>Mais receita para o negócio.')}
      </article>
    </section>

    <footer class="footer">
      <div class="footer-left">Tráfego que gera pessoas. Pessoas que geram resultados.</div>
      <div class="mix-card">
        <div>
          <div class="mix-title">Media Mix</div>
          <div class="mix-sub">Distribuição do investimento</div>
          ${mixRow('Growth', mix.growth)}
          ${mixRow('Engagement', mix.engagement)}
          ${mixRow('Leads', mix.leads)}
          ${mixRow('Sales (Link)', mix.salesLink)}
          ${mixRow('Leads (Link)', mix.leadsLink)}
        </div>
        <div class="mix-side">Equilíbrio<br>para um crescimento<br>sustentável.
          <small>Dados hoje.<br>Mais amanhã.</small>
        </div>
      </div>
    </footer>
  </main>
</body>
</html>`;
}
