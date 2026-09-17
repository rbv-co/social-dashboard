// coletor/lib/template-opr.mjs
// HTML autocontido (CSS inline, sem fonte/imagem externa) pro relatório OPR
// diário — vira PNG via render-criativo.mjs::renderPNG. Layout inspirado no
// mockup mostrado pelo dono (17/09/2026), sem a seção de Leads Quentes/Vendas
// (Chatwoot, fora de escopo) nem Media Mix (aguardando definição do gerente
// de marketing) — ver spec.
import { formatarReais } from '../../src/ferramentas/meta-ads/relatorio-por-hora.js';

export const DIM_OPR = { width: 1200, height: 800 };

const fmtNum = (v) => (v == null ? '—' : String(Math.round(v)));
const fmtReais = (v) => (v == null ? '—' : formatarReais(v));
const fmtPct = (v) => (v == null ? '—' : `${v.toFixed(1)}%`);

function card(label, valor) {
  return `<div class="card"><div class="card-label">${label}</div><div class="card-valor">${valor}</div></div>`;
}
function linha(label, valor) {
  return `<div class="linha"><span>${label}</span><strong>${valor}</strong></div>`;
}

export function montarHtmlOpr(dados, meta) {
  const { header, growth, engagement, leads } = dados;
  return `<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { width: 1200px; background: #fdfbf7; font-family: -apple-system, "Segoe UI", sans-serif; color: #1a2e2a; padding: 48px; }
  h1 { font-family: Georgia, "Times New Roman", serif; font-size: 40px; letter-spacing: 1px; }
  .subtitulo { color: #6b6b6b; font-size: 18px; margin-top: 6px; }
  .meta { text-align: right; font-size: 13px; color: #6b6b6b; }
  .topo { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; }
  .kpis { display: flex; gap: 20px; margin-bottom: 32px; }
  .card { flex: 1; background: #fff; border-radius: 12px; padding: 20px; }
  .card-label { font-size: 14px; color: #6b6b6b; }
  .card-valor { font-size: 30px; font-weight: bold; margin-top: 8px; }
  .secoes { display: flex; gap: 24px; }
  .secao { flex: 1; background: #fff; border-radius: 12px; padding: 24px; }
  .secao h2 { font-size: 20px; margin-bottom: 16px; }
  .linha { display: flex; justify-content: space-between; padding: 6px 0; font-size: 15px; border-bottom: 1px solid #eee; }
</style>
</head>
<body>
  <div class="topo">
    <div>
      <h1>PAID MEDIA PERFORMANCE</h1>
      <div class="subtitulo">Dashboard Executivo · Tráfego Pago</div>
    </div>
    <div class="meta">
      CONTA/PERFIL: ${meta.conta}<br>
      PERÍODO: ${meta.periodoLabel}
    </div>
  </div>
  <div class="kpis">
    ${card('Investimento Total', fmtReais(header.investimentoTotal))}
    ${card('Novos Seguidores', fmtNum(header.novosSeguidores))}
    ${card('Engajamentos', fmtNum(header.engajamentos))}
    ${card('Leads Gerados', fmtNum(header.leadsGerados))}
  </div>
  <div class="secoes">
    <div class="secao">
      <h2>01 · Growth / Seguidores</h2>
      ${linha('Investimento', fmtReais(growth.investimento))}
      ${linha('Seguidores', fmtNum(growth.seguidores))}
      ${linha('Visitas ao Perfil', fmtNum(growth.visitasPerfil))}
      ${linha('Custo por Seguidor', fmtReais(growth.custoPorSeguidor))}
      ${linha('Custo por Visita', fmtReais(growth.custoPorVisita))}
      ${linha('Conversão Visita → Seguidor', fmtPct(growth.conversaoVisitaSeguidor))}
    </div>
    <div class="secao">
      <h2>02 · Engagement</h2>
      ${linha('Investimento', fmtReais(engagement.investimento))}
      ${linha('Curtidas', fmtNum(engagement.curtidas))}
      ${linha('Comentários', fmtNum(engagement.comentarios))}
      ${linha('Compartilhamentos', fmtNum(engagement.compartilhamentos))}
      ${linha('Salvamentos', fmtNum(engagement.salvamentos))}
      ${linha('Custo por Curtida', fmtReais(engagement.custoPorCurtida))}
      ${linha('Custo por Comentário', fmtReais(engagement.custoPorComentario))}
      ${linha('Custo por Compartilhamento', fmtReais(engagement.custoPorCompartilhamento))}
      ${linha('Custo por Salvamento', fmtReais(engagement.custoPorSalvamento))}
      ${linha('Total de Interações', fmtNum(engagement.totalInteracoes))}
      ${linha('Custo Médio por Engajamento', fmtReais(engagement.custoMedioPorEngajamento))}
    </div>
    <div class="secao">
      <h2>03 · Leads</h2>
      ${linha('Leads', fmtNum(leads.leads))}
      ${linha('Investimento', fmtReais(leads.investimento))}
      ${linha('Custo por Lead', fmtReais(leads.custoPorLead))}
    </div>
  </div>
</body>
</html>`;
}
