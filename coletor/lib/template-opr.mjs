// coletor/lib/template-opr.mjs
// HTML autocontido (CSS inline, sem fonte/imagem externa) pro relatório OPR
// diário — vira PNG via render-criativo.mjs::renderPNG.
//
// Visual: o MESMO da tela `tela-de-relatorio-opr.vue` (dashboard executivo no
// app) — pedido do dono (17/09/2026: "mas o png não é assim", comparando com
// a tela) — cores e tipografia copiadas dos tokens de
// `src/estilos/estilos-globais.css` (tema claro: --bg/--surface/--surface2/
// --border/--text/--muted/--green), não mais o mockup dourado/serifado da
// primeira versão. Fonte só de sistema (sem Google Fonts) porque este HTML
// roda OFFLINE no Puppeteer, sem rede garantida.
//
// `dados.sales.leadsQuentes/vendas` (e tudo que depende deles) e
// `dados.mix` chegam como `null` até: Leads Quentes/Vendas dependerem do
// Chatwoot (integração futura); Media Mix ser confirmado pelo gerente de
// marketing (dono pediu pra manter o card, "vou confirmar ainda",
// 17/09/2026) — `null` sempre aparece como "—", nunca um número inventado.
export const DIM_OPR = { width: 1500, height: 1050 };

// `null` no dado vira "—" — nunca "R$ 0,00"/"0%" inventado (regra "a tela
// nunca mente" do projeto). `tipo`: 'moeda' | 'percentual' | undefined (= número puro).
// Mesma formatação da tela `tela-de-relatorio-opr.vue` (sem abreviar em
// mil/M): o layout novo tem colunas largas o bastante pra qualquer valor
// realista caber numa linha só, sem o risco de quebra que o mockup antigo
// (denso, 4-5 colunas) tinha — abreviar aqui só criaria divergência com o
// número que a tela mostra pro mesmo dado.
function fmtValor(n, tipo) {
  if (n == null) return '—';
  if (tipo === 'percentual') return `${n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
  if (tipo === 'moeda') return `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return n.toLocaleString('pt-BR');
}

function kpiCard(label, valor) {
  return `<div class="kpi"><span class="kpi-label">${label}</span><span class="kpi-valor">${valor}</span></div>`;
}
function metrica(label, valor, extra = '') {
  return `<div class="metrica ${extra}"><span>${label}</span><strong>${valor}</strong></div>`;
}
function funilEtapa(label, valor) {
  return `<div class="funil-etapa"><span>${label}</span><strong>${valor}</strong></div>`;
}
function mixLinha(label, pct) {
  const largura = pct == null ? 0 : Math.min(Math.max(pct, 0), 100);
  return `<div class="mix-linha"><span class="mix-rotulo">${label}</span><div class="mix-barra"><span style="width:${largura}%"></span></div><strong>${fmtValor(pct, 'percentual')}</strong></div>`;
}

export function montarHtmlOpr(dados, meta) {
  const { header, growth, engagement, sales, mix } = dados;
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<style>
  :root{ --bg:#faf7f2; --surface:#ffffff; --surface2:#f2ede4; --border:rgba(0,0,0,0.10); --text:#17150f; --muted:rgba(23,21,15,0.72); --green:#1a6e45; }
  *{box-sizing:border-box}
  html,body{margin:0}
  body{
    background:var(--bg); color:var(--text); padding:32px;
    font-family:-apple-system,"Segoe UI",Roboto,sans-serif;
  }
  .fonte-dados{font-family:ui-monospace,"SF Mono","IBM Plex Mono",monospace;font-variant-numeric:tabular-nums}
  .topo{margin-bottom:20px}
  .titulo{font-size:26px;font-weight:700;margin:0}
  .subtitulo{margin-top:4px;font-size:15px;color:var(--muted)}

  .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:20px}
  .kpi{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:20px;display:flex;flex-direction:column;gap:6px}
  .kpi-label{font-size:14px;color:var(--muted)}
  .kpi-valor{font-family:ui-monospace,"SF Mono","IBM Plex Mono",monospace;font-variant-numeric:tabular-nums;font-size:32px;font-weight:700}

  .secoes{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;align-items:start;margin-bottom:20px}
  .secao{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:20px;display:flex;flex-direction:column;gap:10px}
  .secao h2{margin:0 0 2px;font-size:19px;font-weight:700}

  .metrica{display:flex;align-items:baseline;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid var(--border)}
  .metrica:last-child{border-bottom:none}
  .metrica span{color:var(--muted);font-size:14px}
  .metrica strong{font-family:ui-monospace,"SF Mono","IBM Plex Mono",monospace;font-variant-numeric:tabular-nums;font-size:15px;white-space:nowrap}

  .funil{display:flex;gap:10px}
  .funil-etapa{flex:1;background:var(--surface2);border-radius:10px;padding:14px;display:flex;flex-direction:column;gap:4px;text-align:center}
  .funil-etapa span{font-size:13px;color:var(--muted)}
  .funil-etapa strong{font-family:ui-monospace,"SF Mono","IBM Plex Mono",monospace;font-variant-numeric:tabular-nums;font-size:19px}

  .mix{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:20px;display:flex;flex-direction:column;gap:8px}
  .mix h2{margin:0;font-size:19px;font-weight:700}
  .mix-sub{margin:0 0 4px;font-size:13px;color:var(--muted)}
  .mix-linha{display:grid;grid-template-columns:110px 1fr 60px;align-items:center;gap:14px}
  .mix-rotulo{font-size:14px}
  .mix-barra{height:10px;background:var(--surface2);border-radius:5px;overflow:hidden}
  .mix-barra span{display:block;height:100%;background:var(--green)}
  .mix-linha strong{font-family:ui-monospace,"SF Mono","IBM Plex Mono",monospace;font-variant-numeric:tabular-nums;text-align:right}
</style>
</head>
<body>
  <div class="topo">
    <h1 class="titulo">Relatório OPR</h1>
    <div class="subtitulo">${meta.conta} · ${meta.periodoLabel}</div>
  </div>

  <div class="kpis">
    ${kpiCard('Investimento Total', fmtValor(header.investimentoTotal, 'moeda'))}
    ${kpiCard('Novos Seguidores', fmtValor(header.novosSeguidores))}
    ${kpiCard('Engajamentos', fmtValor(header.engajamentos))}
    ${kpiCard('Leads Gerados', fmtValor(header.leadsGerados))}
  </div>

  <div class="secoes">
    <section class="secao">
      <h2>Growth / Seguidores</h2>
      ${metrica('Investimento', fmtValor(growth.investimento, 'moeda'))}
      ${metrica('Seguidores', fmtValor(growth.seguidores))}
      ${metrica('Visitas ao Perfil', fmtValor(growth.visitasPerfil))}
      ${metrica('Custo por Seguidor', fmtValor(growth.custoPorSeguidor, 'moeda'))}
      ${metrica('Custo por Visita', fmtValor(growth.custoPorVisita, 'moeda'))}
      ${metrica('Conversão Visita → Seguidor', fmtValor(growth.conversaoVisitaSeguidor, 'percentual'))}
    </section>

    <section class="secao">
      <h2>Engagement</h2>
      ${metrica('Investimento', fmtValor(engagement.investimento, 'moeda'))}
      ${metrica('Curtidas', fmtValor(engagement.curtidas))}
      ${metrica('Comentários', fmtValor(engagement.comentarios))}
      ${metrica('Compartilhamentos', fmtValor(engagement.compartilhamentos))}
      ${metrica('Salvamentos', fmtValor(engagement.salvamentos))}
      ${metrica('Custo por Curtida', fmtValor(engagement.custoPorCurtida, 'moeda'))}
      ${metrica('Custo por Comentário', fmtValor(engagement.custoPorComentario, 'moeda'))}
      ${metrica('Custo por Compartilhamento', fmtValor(engagement.custoPorCompartilhamento, 'moeda'))}
      ${metrica('Custo por Salvamento', fmtValor(engagement.custoPorSalvamento, 'moeda'))}
      ${metrica('Total de Interações', fmtValor(engagement.totalInteracoes))}
      ${metrica('Custo Médio por Engajamento', fmtValor(engagement.custoMedioPorEngajamento, 'moeda'))}
    </section>

    <section class="secao">
      <h2>Leads &amp; Sales</h2>
      <div class="funil">
        ${funilEtapa('Leads', fmtValor(sales.leads))}
        ${funilEtapa('Leads Quentes', fmtValor(sales.leadsQuentes))}
        ${funilEtapa('Vendas', fmtValor(sales.vendas))}
      </div>
      ${metrica('Investimento', fmtValor(sales.investimento, 'moeda'))}
      ${metrica('Custo por Lead', fmtValor(sales.custoPorLead, 'moeda'))}
      ${metrica('Custo por Lead Quente', fmtValor(sales.custoPorLeadQuente, 'moeda'))}
      ${metrica('Custo por Venda', fmtValor(sales.custoPorVenda, 'moeda'))}
      ${metrica('Conversão Lead → Quente', fmtValor(sales.conversaoLeadQuente, 'percentual'))}
      ${metrica('Conversão Quente → Venda', fmtValor(sales.conversaoQuenteVenda, 'percentual'))}
    </section>
  </div>

  <div class="mix">
    <h2>Media Mix</h2>
    <p class="mix-sub">Distribuição do investimento por categoria — definição provisória, aguardando confirmação do gerente de marketing.</p>
    ${mixLinha('Growth', mix.growth)}
    ${mixLinha('Engagement', mix.engagement)}
    ${mixLinha('Leads', mix.leads)}
  </div>
</body>
</html>`;
}
