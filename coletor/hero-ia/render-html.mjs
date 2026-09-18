// coletor/hero-ia/render-html.mjs
// Renderer de PRODUÇÃO do Motor Hero-IA: hero fotorreal (gpt-image-2) de fundo full-bleed +
// camada comercial em HTML/CSS (mesmo motor/tipografia da fábrica), via renderPNG (puppeteer).
// CI-safe: logo e fontes vêm do repo. Preços vêm do `dados` (Bling, calculado pela fábrica).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { renderPNG, renderMotion } from '../lib/render-criativo.mjs';

const DIR = dirname(fileURLToPath(import.meta.url));
const FONTS_CSS = readFileSync(join(DIR, '../templates-criativos/assets/fonts.css'), 'utf8');
const LOGO = 'data:image/png;base64,' + readFileSync(join(DIR, 'assets/logo-cream.png')).toString('base64');
const LOGO_DARK = 'data:image/png;base64,' + readFileSync(join(DIR, 'assets/logo-espresso.png')).toString('base64');

const LIGHT = '#F2EFE6', CHAMP = '#C3A36A', IVORY = '#F4F0E7', ESP = '#29211C', MUTED = '#B7AA9A';
const cormNum = "font-family:'Cormorant Garamond',serif;font-variant-numeric:lining-nums;font-feature-settings:'lnum' 1;";

// formato -> canvas + coluna de texto (largura fixa p/ nada cruzar pra bolsa) + posição do texto
export const FMT = {
  feed_1x1:     { w: 1080, h: 1080, pos: 'left', pad: '96px',                   colW: 520, big: 118, name: 46 },
  fb_4x5:       { w: 1080, h: 1350, pos: 'left', pad: '96px',                   colW: 540, big: 128, name: 50 },
  stories_9x16: { w: 1080, h: 1920, pos: 'top',  pad: '270px 90px 390px 90px',  colW: 600, big: 120, name: 52 },
  youtube_16x9: { w: 1920, h: 1080, pos: 'left', pad: '70px 96px 90px 96px',    colW: 820, big: 118, name: 50 },
};
export const DIM = { feed_1x1: '1080x1080', fb_4x5: '1080x1350', stories_9x16: '1080x1920', youtube_16x9: '1920x1080' };
// variante do motor -> sufixo padrão da fábrica
export const VARIANTES = { parcelamento: 'parcelado', avista: 'avista', desconto: 'desconto' };

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// A pílula de garantia (selo + texto) — SÓ aparece com `d.garantiaTexto` já resolvido
// (por `texto-da-garantia.mjs`, a partir do material do lote do SKU). Sem material
// (SKU sem lote, lote sem material, ou falha na busca), `d.garantiaTexto` vem `null`/
// ausente e a pílula simplesmente NÃO ENTRA na arte — nunca chuta "2 anos" fixo.
function pilulaGarantiaHtml(d, s) {
  if (!d.garantiaTexto) return '';
  return `<div style="display:inline-flex;align-items:center;gap:${s(12)}px;border:2px solid ${CHAMP};border-radius:999px;padding:${s(11)}px ${s(24)}px;width:fit-content;white-space:nowrap;">
          <svg width="${s(26)}" height="${s(26)}" viewBox="0 0 24 24" fill="none" stroke="${CHAMP}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 L20 5 V11 C20 16 16 19.5 12 22 C8 19.5 4 16 4 11 V5 Z"/><path d="M8.5 12 l2.5 2.5 l4.5-5"/></svg>
          <span style="font-size:${s(27)}px;font-weight:500;color:${LIGHT};">${esc(d.garantiaTexto)}</span></div>`;
}

function priceBlock(variant, s, big, d) {
  const de = `<div style="display:flex;align-items:baseline;gap:${s(10)}px;">
      <span style="font-size:${s(24)}px;letter-spacing:.26em;font-weight:600;color:${MUTED};">DE</span>
      <span style="${cormNum}font-size:${s(46)}px;font-weight:500;color:${MUTED};text-decoration:line-through;text-decoration-thickness:3px;">R$ ${esc(d.precoDe)}</span></div>`;
  const bigCss = `${cormNum}font-size:${s(big)}px;font-weight:600;line-height:.9;color:${LIGHT};white-space:nowrap;`;
  const label = (t) => `<span style="font-size:${s(26)}px;letter-spacing:.22em;font-weight:700;color:${CHAMP};">${t}</span>`;
  if (variant === 'parcelamento') return `${de}
    ${label(`EM ATÉ ${d.parcelas}× DE`)}
    <span style="${bigCss}">R$ ${esc(d.parcelado)}</span>
    <span style="font-size:${s(24)}px;letter-spacing:.2em;font-weight:600;color:${CHAMP};">SEM JUROS</span>`;
  if (variant === 'avista') return `
    ${label('À VISTA POR APENAS')}
    <span style="${bigCss}">R$ ${esc(d.precoPor)}</span>
    <span style="font-size:${s(24)}px;letter-spacing:.04em;font-weight:500;color:${LIGHT};">ou ${d.parcelas}× de R$ ${esc(d.parcelado)} sem juros</span>`;
  return `${de}
    <span style="${bigCss}">R$ ${esc(d.precoPor)}</span>
    <span style="display:inline-block;font-size:${s(40)}px;letter-spacing:.06em;font-weight:800;color:${CHAMP};background:rgba(195,163,106,.14);padding:${s(6)}px ${s(18)}px;border-radius:${s(8)}px;width:fit-content;">${esc(d.pct)}% OFF</span>`;
}

export function buildHtml(fmt, variant, heroDataUrl, d, opts = {}) {
  const motion = !!opts.motion; // true -> injeta animação (zoom na foto + entrada escalonada do texto) p/ MP4
  const f = FMT[fmt]; const s = (n) => Math.round(n);
  const align = f.pos === 'top' ? 'justify-content:flex-start;' : 'justify-content:center;';
  const branding = variant === 'branding';
  const logo = branding ? LOGO_DARK : LOGO;
  const txt = branding ? ESP : LIGHT;
  const dir = f.pos === 'top' ? '180deg' : '90deg';
  const grad = branding
    ? `linear-gradient(${dir}, rgba(244,240,231,.78) 0%, rgba(244,240,231,.40) 42%, rgba(244,240,231,0) 66%)`
    : `linear-gradient(${dir}, rgba(20,26,18,.80) 0%, rgba(20,26,18,.45) 40%, rgba(20,26,18,0) 64%)`;
  const bloco = branding ? `
        <div style="font-size:${s(30)}px;letter-spacing:.30em;font-weight:600;color:${CHAMP};text-transform:uppercase;line-height:1.4;">${esc(d.tagline || 'ELEGÂNCIA ATEMPORAL')}</div>
        <div style="width:${s(64)}px;height:2px;background:${CHAMP};"></div>
        <div style="display:inline-flex;align-items:center;gap:${s(14)}px;margin-top:${s(8)}px;white-space:nowrap;">
          <span style="font-size:${s(26)}px;letter-spacing:.14em;font-weight:600;color:${ESP};text-transform:uppercase;">Conheça a coleção</span>
          <span style="font-size:${s(30)}px;color:${CHAMP};line-height:1;">&#8594;</span></div>`
    : `<div style="display:flex;flex-direction:column;gap:${s(10)}px;">${priceBlock(variant, s, f.big, d)}</div>
        ${pilulaGarantiaHtml(d, s)}
        <div style="display:inline-flex;align-items:center;gap:${s(12)}px;background:${IVORY};border-radius:999px;padding:${s(13)}px ${s(18)}px;width:fit-content;max-width:100%;box-shadow:0 16px 34px rgba(0,0,0,.32);white-space:nowrap;">
          <span style="font-size:${s(21)}px;font-weight:700;color:${ESP};">Converse com nossas vendedoras</span>
          <span style="display:flex;align-items:center;justify-content:center;width:${s(38)}px;height:${s(38)}px;border-radius:50%;background:${ESP};color:${IVORY};font-size:${s(20)}px;flex:0 0 auto;">&#8594;</span></div>`;
  const inner = `
  <div style="position:relative;width:${f.w}px;height:${f.h}px;overflow:hidden;font-family:'Archivo',sans-serif;">
    <img class="hero" src="${heroDataUrl}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;">
    <div style="position:absolute;inset:0;background:${grad};"></div>
    <div style="position:absolute;inset:0;padding:${f.pad};display:flex;flex-direction:column;align-items:flex-start;${align}box-sizing:border-box;">
      <div class="col" style="width:${f.colW}px;max-width:${f.colW}px;display:flex;flex-direction:column;gap:${s(28)}px;">
        <img src="${logo}" style="width:${s(280)}px;height:auto;">
        <div style="display:flex;flex-direction:column;gap:${s(8)}px;">
          <span style="font-size:${s(f.name)}px;letter-spacing:.12em;font-weight:400;color:${txt};text-transform:uppercase;line-height:1.05;white-space:nowrap;">${esc(d.name)}</span>
          <span style="font-size:${s(24)}px;letter-spacing:.22em;font-weight:700;color:${CHAMP};text-transform:uppercase;">${esc(d.camp)}</span>
        </div>
        ${bloco}
      </div>
    </div>
  </div>`;
  // Animação (motion): foto com zoom lento (Ken Burns) + coluna de texto entrando escalonada.
  // Faithful: só move os MESMOS elementos da arte estática — bolsa/logo/preço não mudam.
  const animCss = motion ? `
    .hero{transform-origin:50% 50%;animation:kb 10s ease-out both;}
    @keyframes kb{from{transform:scale(1.05)}to{transform:scale(1.15)}}
    .col>*{opacity:0;animation:fu .85s cubic-bezier(.2,.7,.2,1) forwards;}
    .col>*:nth-child(1){animation-delay:.25s}.col>*:nth-child(2){animation-delay:.55s}
    .col>*:nth-child(3){animation-delay:.9s}.col>*:nth-child(4){animation-delay:1.25s}
    .col>*:nth-child(5){animation-delay:1.6s}
    @keyframes fu{from{opacity:0;transform:translateY(28px)}to{opacity:1;transform:translateY(0)}}` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><style>${FONTS_CSS}
    *{margin:0;padding:0;box-sizing:border-box}html,body{width:${f.w}px;height:${f.h}px;overflow:hidden}${animCss}</style></head><body>${inner}</body></html>`;
}

// Renderiza um criativo (formato+variante) -> Buffer PNG
export async function renderCriativo(fmt, variant, heroDataUrl, dados) {
  const f = FMT[fmt];
  const html = buildHtml(fmt, variant, heroDataUrl, dados);
  return renderPNG(html, { width: f.w, height: f.h });
}

// Renderiza o MP4 animado (motion) de um criativo -> Buffer. Usado no widescreen 16:9 (Google Ads).
export async function renderCriativoMotion(fmt, variant, heroDataUrl, dados) {
  const f = FMT[fmt];
  const html = buildHtml(fmt, variant, heroDataUrl, dados, { motion: true });
  return renderMotion(html, { width: f.w, height: f.h });
}
