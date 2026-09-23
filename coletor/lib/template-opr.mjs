// coletor/lib/template-opr.mjs
// HTML autocontido (CSS inline, sem fonte/imagem externa) pro relatório OPR
// diário — vira PNG via render-criativo.mjs::renderPNG. Layout original
// aprovado pelo dono em 17/09/2026; reformado em 21/09/2026 pra classificar
// campanha por OBJECTIVE da Meta em vez de nome; ajustado em 22/09/2026:
// Seguidores volta a ser painel próprio (tinha sumido o custo por seguidor
// dentro do balde genérico de Tráfego) e Leads junta com Vendas no mesmo
// painel (igual o antigo "Leads & Sales") — a grade continua 2×2:
// Seguidores/Tráfego/Engajamento/Leads&Vendas.
//
// `dados.mix` chega com uma fatia por categoria (4, batendo com os 4
// painéis); nunca `null` inventado — mesma regra de sempre.
export const DIM_OPR = { width: 1600, height: 900 };

// Abrevia acima de mil/milhão (arredondado, 1 decimal) — pedido do dono
// (17/09/2026): "os valores estão quebrando linha, vamos usar mil e M pra
// arredondar em valores muito altos". `null` quando NÃO precisa abreviar.
function abreviar(n) {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} M`;
  if (abs >= 1_000) return `${(n / 1_000).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} mil`;
  return null;
}
// `null` no dado vira "—" — nunca "R$ 0,00"/"0%" inventado (regra "a tela
// nunca mente" do projeto). `tipo`: 'moeda' | 'percentual' | undefined (= número puro).
function fmtValor(n, tipo) {
  if (n == null) return '—';
  if (tipo === 'percentual') return `${n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
  const abreviado = abreviar(n);
  if (tipo === 'moeda') return `R$ ${abreviado ?? n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return abreviado ?? n.toLocaleString('pt-BR');
}

const ICONES = {
  coins: '<svg viewBox="0 0 48 48"><ellipse cx="17" cy="13" rx="9" ry="4"/><path d="M8 13v7c0 2.2 4 4 9 4s9-1.8 9-4v-7"/><ellipse cx="28" cy="20" rx="9" ry="4"/><path d="M19 20v7c0 2.2 4 4 9 4s9-1.8 9-4v-7"/><ellipse cx="18" cy="29" rx="9" ry="4"/><path d="M9 29v7c0 2.2 4 4 9 4s9-1.8 9-4v-7"/></svg>',
  users: '<svg viewBox="0 0 48 48"><circle cx="18" cy="17" r="5"/><circle cx="31" cy="18" r="4"/><path d="M8 36c0-7 4-11 10-11s10 4 10 11"/><path d="M27 27c1.4-.8 2.8-1 4-1 5 0 8 3.4 8 9"/></svg>',
  heart: '<svg viewBox="0 0 48 48"><path d="M24 39S9 30 9 18c0-5 3.4-8 8-8 3.4 0 5.6 1.7 7 4 1.4-2.3 3.6-4 7-4 4.6 0 8 3 8 8 0 12-15 21-15 21Z"/></svg>',
  funnel: '<svg viewBox="0 0 48 48"><path d="M8 10h32L28 25v11l-8 4V25L8 10Z"/></svg>',
  bars: '<svg viewBox="0 0 48 48"><path d="M12 37V27M24 37V18M36 37V10"/></svg>',
  compass: '<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="17"/><path d="M30 18l-4 10-10 4 4-10 10-4Z"/></svg>',
  cart: '<svg viewBox="0 0 48 48"><path d="M8 10h5l4 22h20l4-16H15"/><circle cx="20" cy="38" r="2.5"/><circle cx="33" cy="38" r="2.5"/></svg>',
};

function kpiCard(icone, label, valor, caption) {
  return `<div class="kpi-card"><div class="icon-circle">${ICONES[icone]}</div><div><div class="kpi-label">${label}</div><div class="kpi-value">${valor}</div><div class="kpi-caption">${caption}</div></div></div>`;
}
function metric(label, valor, extra = '') {
  return `<div class="metric ${extra}"><div class="metric-label">${label}</div><div class="metric-value">${valor}</div></div>`;
}
function panelNote(icone, texto) {
  return `<div class="panel-note"><div class="icon-circle">${ICONES[icone]}</div><div class="note-text">${texto}</div></div>`;
}
function mixRow(label, pct) {
  const largura = pct == null ? 0 : Math.min(Math.max(pct, 0), 100);
  return `<div class="mix-row"><div>${label}</div><div class="bar"><span style="width:${largura}%"></span></div><strong>${fmtValor(pct, 'percentual')}</strong></div>`;
}
// Um painel da grade 2×2 — mesma anatomia pros 4 (Investimento + resultado(s)
// + custo por resultado), pra ficarem visualmente parelhos.
function painel(numero, icone, titulo, subtitulo, metricasTop, metricasBottom, nota) {
  return `<article class="panel">
    <div class="panel-head">
      <div class="panel-num">${numero}</div>
      <div><div class="panel-title">${titulo}</div><div class="panel-sub">${subtitulo}</div></div>
    </div>
    <div class="metric-grid panel-top">${metricasTop.join('')}</div>
    <div class="metric-grid panel-bottom">${metricasBottom.join('')}</div>
    ${panelNote(icone, nota)}
  </article>`;
}

export function montarHtmlOpr(dados, meta) {
  const {
    header, seguidores, trafego, engajamento, leadsEVendas, mix,
  } = dados;
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
    padding:26px 28px 18px;
    display:grid;
    grid-template-rows:auto auto 1fr auto;
    gap:10px;
    overflow:hidden;
    box-shadow:0 12px 60px rgba(0,0,0,.24);
  }
  .header{display:grid;grid-template-columns:1.8fr 1fr;gap:26px;align-items:start}
  .eyebrow-line{width:48px;height:3px;background:var(--gold);margin:2px 0 6px}
  .title{font:700 clamp(24px,2.6vw,46px)/.96 Georgia, "Times New Roman", serif;letter-spacing:.02em;margin:0;color:#123432}
  .subtitle{margin-top:4px;font-size:clamp(12px,1.1vw,20px);letter-spacing:.13em;color:#686b68}
  .meta{display:grid;grid-template-columns:1fr .9fr .7fr;min-height:62px;border-left:1px solid var(--line-2)}
  .meta-item{padding:6px 18px}
  .meta-item:not(:last-child){border-right:1px solid var(--line-2)}
  .meta-label{font-size:9px;letter-spacing:.28em;text-transform:uppercase;color:#7b7b73;margin-bottom:5px}
  .meta-value{font:400 15px Georgia, serif;color:#173b39}
  .meta .accent::after{content:"";display:block;width:24px;height:2px;background:var(--gold);margin-top:10px}
  .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
  .kpi-card{border:1px solid var(--line);border-radius:7px;padding:12px 16px;display:grid;grid-template-columns:52px 1fr;align-items:center;min-height:96px;box-shadow:0 1px 0 rgba(0,0,0,.025)}
  .icon-circle{width:46px;height:46px;border-radius:50%;background:var(--gold-soft);display:grid;place-items:center;color:var(--ink)}
  .icon-circle svg{width:26px;height:26px;stroke:currentColor;fill:none;stroke-width:2.3;stroke-linecap:round;stroke-linejoin:round}
  .kpi-label{font:400 13px Georgia,serif;margin-bottom:1px}
  .kpi-value{font:700 clamp(20px,1.7vw,32px)/1 Georgia,serif;letter-spacing:.02em}
  .kpi-caption{margin-top:5px;font-size:9px;letter-spacing:.22em;text-transform:uppercase;color:#797b77}
  /* Grade 2×2 — cada painel com a mesma largura que os 3-em-linha tinham
     antes (metade do relatório, não um quarto), pra caber Tráfego +
     Engajamento + Vendas + Leads sem espremer número/rótulo. Espaçamento
     bem mais apertado que o layout de 3 painéis: são 2 LINHAS agora, na
     mesma altura fixa de 900px (imagem, overflow escondido — o que não
     coube aqui simplesmente some, por isso cada medida foi conferida
     renderizando de verdade, não só no navegador). */
  .sections{display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:10px;min-height:0}
  .panel{border:1px solid var(--line);border-radius:6px;padding:10px 16px 8px;display:flex;flex-direction:column;min-width:0;min-height:0}
  .panel-head{display:grid;grid-template-columns:42px 1fr;gap:10px;align-items:center;padding:0 2px 6px;border-bottom:1px solid var(--line)}
  .panel-num{font:400 22px Georgia,serif;color:var(--gold);padding-right:9px;border-right:1px solid #8e8d86}
  .panel-title{font:700 18px Georgia,serif;line-height:1.05}
  .panel-sub{font-size:9px;letter-spacing:.18em;text-transform:uppercase;color:#747975;margin-top:2px}
  .metric-grid{display:grid;gap:0;margin-top:8px}
  .panel-top{grid-template-columns:repeat(auto-fit,minmax(96px,1fr))}
  .panel-bottom{grid-template-columns:repeat(auto-fit,minmax(96px,1fr));border-top:1px solid var(--line);margin-top:6px}
  .metric{padding:4px 8px;min-width:0}
  .metric:not(:first-child){border-left:1px solid var(--line)}
  .metric-label{font-size:10px;color:#58635f;line-height:1.2;overflow-wrap:break-word;height:20px;display:flex;align-items:flex-end}
  .metric-value{font:700 15px Georgia,serif;line-height:1.1;margin-top:4px;overflow-wrap:break-word}
  .panel-note{margin-top:auto;min-height:42px;background:var(--soft);display:grid;grid-template-columns:34px 1fr;align-items:center;padding:6px 10px;gap:0 8px}
  .panel-note .icon-circle{width:28px;height:28px}
  .panel-note .icon-circle svg{width:15px;height:15px}
  .note-text{font:italic 12px/1.15 Georgia,serif;color:#48615d}
  .footer{display:grid;grid-template-columns:1.35fr .9fr;gap:16px;align-items:end}
  .footer-left{border-top:2px solid #aaa9a3;padding:8px 18px 0;font-size:9px;letter-spacing:.24em;text-transform:uppercase;color:#9a9690;min-height:0}
  .mix-card{border:1px solid var(--line);border-radius:6px;padding:6px 10px;display:grid;grid-template-columns:1fr 170px;gap:12px;align-items:center}
  .mix-title{font:700 13px Georgia,serif}
  .mix-sub{font-size:8px;letter-spacing:.22em;color:#8c8d87;text-transform:uppercase;margin-top:0}
  .mix-row{display:grid;grid-template-columns:60px 1fr minmax(40px,auto);gap:8px;align-items:center;margin-top:5px;font-size:10px}
  .mix-row strong{white-space:nowrap}
  .bar{height:7px;background:#e9e9e6;border-radius:4px;overflow:hidden}
  .bar span{display:block;height:100%;background:var(--green)}
  .mix-side{border-left:1px solid var(--line-2);padding-left:14px;font:italic 12px/1.2 Georgia,serif;color:#52645f}
  .mix-side small{display:block;font:8px/1.4 Inter,sans-serif;letter-spacing:.2em;text-transform:uppercase;color:#aaa59c;margin-top:6px}
  .mix-side small::after{content:"";display:block;width:22px;height:2px;background:var(--gold);margin-top:6px}
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
      ${painel('01', 'users', 'Seguidores', 'Aquisição de audiência', [
        metric('Investimento', fmtValor(seguidores.investimento, 'moeda')),
        metric('Novos Seguidores', fmtValor(seguidores.novos)),
        metric('Curtidas', fmtValor(seguidores.curtidas)),
        metric('Comentários', fmtValor(seguidores.comentarios)),
        metric('Compart.', fmtValor(seguidores.compartilhamentos)),
        metric('Salvamentos', fmtValor(seguidores.salvamentos)),
      ], [
        metric('Custo por Seguidor', fmtValor(seguidores.custoPorSeguidor, 'moeda')),
      ], 'Mais pessoas. Mais relevância.')}

      ${painel('02', 'compass', 'Tráfego', 'Visitas geradas pela mídia paga', [
        metric('Investimento', fmtValor(trafego.investimento, 'moeda')),
        metric('Visitas', fmtValor(trafego.visitas)),
      ], [
        metric('Custo por Visita', fmtValor(trafego.custoPorVisita, 'moeda')),
      ], 'Mais visitas. Mais chance de conversão.')}

      ${painel('03', 'heart', 'Engajamento', 'Interações que fortalecem a marca', [
        metric('Investimento', fmtValor(engajamento.investimento, 'moeda')),
        metric('Curtidas', fmtValor(engajamento.curtidas)),
        metric('Comentários', fmtValor(engajamento.comentarios)),
        metric('Compart.', fmtValor(engajamento.compartilhamentos)),
        metric('Salvamentos', fmtValor(engajamento.salvamentos)),
      ], [
        metric('Total de Interações', fmtValor(engajamento.totalInteracoes)),
        metric('Custo Médio por Engajamento', fmtValor(engajamento.custoMedioPorEngajamento, 'moeda')),
      ], 'Conteúdo que conecta. Resultados que constroem valor.')}

      ${painel('04', 'funnel', 'Leads & Vendas', 'Do interesse ao faturamento', [
        metric('Investimento', fmtValor(leadsEVendas.investimento, 'moeda')),
        metric('Leads', fmtValor(leadsEVendas.leads)),
        metric('Leads Quentes', fmtValor(leadsEVendas.leadsQuentes)),
        metric('Vendas', fmtValor(leadsEVendas.vendas)),
      ], [
        metric('Custo por Lead', fmtValor(leadsEVendas.custoPorLead, 'moeda')),
        metric('Custo por Venda', fmtValor(leadsEVendas.custoPorVenda, 'moeda')),
      ], 'Mais oportunidades. Mais receita para o negócio.')}
    </section>

    <footer class="footer">
      <div class="footer-left">Tráfego que gera pessoas. Pessoas que geram resultados.</div>
      <div class="mix-card">
        <div>
          <div class="mix-title">Media Mix</div>
          <div class="mix-sub">Distribuição do investimento</div>
          ${mixRow('Seguidores', mix.seguidores)}
          ${mixRow('Tráfego', mix.trafego)}
          ${mixRow('Engajamento', mix.engajamento)}
          ${mixRow('Leads & Vendas', mix.leadsEVendas)}
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
