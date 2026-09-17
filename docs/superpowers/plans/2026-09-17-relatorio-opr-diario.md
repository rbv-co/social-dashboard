# Relatório OPR Diário Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gerar diariamente (08h BRT, consolidando o dia anterior) uma imagem "Paid Media Performance" com Growth/Seguidores + Engagement + Leads, e deixar tudo pronto pra mandar no grupo de WhatsApp — mas SEM ligar o envio de verdade nesta entrega.

**Architecture:** Nova categoria de campanha `[+ ENGAJAMENTO]` em `tipoDaCampanha` (mesmo arquivo pure-logic já usado pelo relatório por hora, espelhado nas duas cópias src/Deno). Nova lógica pura de agregação diária (`relatorio-diario-opr.js`) reaproveitando `custoPorLead`/`formatarReais`/`tipoDaCampanha`. Novo template HTML + Puppeteer (reaproveitando `coletor/lib/render-criativo.mjs`, já testado em produção pela Fábrica de Criativos) rodando via GitHub Actions — Deno não roda Chromium, por isso este pipeline vive em `coletor/`, não em Edge Function.

**Tech Stack:** Node ESM (coletor/), Puppeteer (renderização HTML→PNG), Z-API (`send-image`/`send-text`), GitHub Actions (cron), `node:test` (testes).

**Spec:** `docs/superpowers/specs/2026-09-17-relatorio-opr-diario-design.md`

## Global Constraints

- Nunca inventar número: quando um cálculo não é possível (contagem ou investimento ≤ 0), o valor é `null` na lógica pura e aparece como "—" no template — nunca "R$ 0,00"/0 fabricado.
- Exceção: TAXA/PERCENTUAL (conversão) pode ser `0%` de verdade quando a base (denominador) é positiva — não é fabricação, é fato.
- `tipoDaCampanha` é código DUPLICADO entre `src/ferramentas/meta-ads/relatorio-por-hora.js` e `supabase/functions/_shared/relatorio-por-hora.js` — as duas cópias mudam SEMPRE juntas, no mesmo commit.
- Prefixo reconhecido pra Engajamento é exatamente `[+ ENGAJAMENTO]` (maiúsculas, "+ " incluso) — igual ao padrão já usado por `[+ SEGUIDORES]`. Nomes soltos como "[Engajamento]"/"[engajamento]" em campanhas existentes NÃO contam.
- **Nenhum envio de verdade nesta entrega.** O script só roda em modo `--dry` (salva PNG local, nunca chama Z-API); o workflow do GitHub Actions só tem `workflow_dispatch`, sem `schedule` ativo. Ligar o envio de verdade é um commit SEPARADO, depois de aprovação explícita do dono.

---

### Task 1: Nova categoria de campanha `[+ ENGAJAMENTO]`

**Files:**
- Modify: `src/ferramentas/meta-ads/relatorio-por-hora.js` (função `tipoDaCampanha`, linhas 20-24)
- Modify: `src/ferramentas/meta-ads/relatorio-por-hora.test.mjs` (teste de `tipoDaCampanha`, linhas 17-21)
- Modify: `supabase/functions/_shared/relatorio-por-hora.js` (mesma função, cópia Deno)
- Modify: `supabase/functions/_shared/relatorio-por-hora.test.mjs` (mesmo teste, cópia Deno)

**Interfaces:**
- Produces: `tipoDaCampanha(nome: string): 'wpp' | 'seguidores' | 'engajamento' | 'outro'` — usado por Task 3.

- [ ] **Step 1: Atualizar o teste em `src/ferramentas/meta-ads/relatorio-por-hora.test.mjs`**

Trocar:
```js
test('tipoDaCampanha: reconhece os dois prefixos e cai em "outro" pro resto', () => {
  assert.equal(tipoDaCampanha('[CAMPANHA WPP] Criativo 1'), 'wpp');
  assert.equal(tipoDaCampanha('[+ SEGUIDORES] Reels 1'), 'seguidores');
  assert.equal(tipoDaCampanha('Post do Instagram: Vlog'), 'outro');
});
```
por:
```js
test('tipoDaCampanha: reconhece os três prefixos e cai em "outro" pro resto', () => {
  assert.equal(tipoDaCampanha('[CAMPANHA WPP] Criativo 1'), 'wpp');
  assert.equal(tipoDaCampanha('[+ SEGUIDORES] Reels 1'), 'seguidores');
  assert.equal(tipoDaCampanha('[+ ENGAJAMENTO] Feed 1'), 'engajamento');
  assert.equal(tipoDaCampanha('[Engajamento] Vaga Gerente'), 'outro', 'prefixo solto/minúsculo não conta — só "[+ ENGAJAMENTO]" exato');
  assert.equal(tipoDaCampanha('Post do Instagram: Vlog'), 'outro');
});
```

Fazer a MESMA troca em `supabase/functions/_shared/relatorio-por-hora.test.mjs` (texto idêntico).

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npm test 2>&1 | grep -A5 "tipoDaCampanha: reconhece"`
Expected: FAIL nas duas cópias (assert de `'[+ ENGAJAMENTO] Feed 1'` esperando `'engajamento'` mas recebendo `'outro'`).

- [ ] **Step 3: Implementar a nova categoria em `src/ferramentas/meta-ads/relatorio-por-hora.js`**

Trocar:
```js
export function tipoDaCampanha(nome) {
  if (nome.startsWith('[CAMPANHA WPP]')) return 'wpp';
  if (nome.startsWith('[+ SEGUIDORES]')) return 'seguidores';
  return 'outro';
}
```
por:
```js
export function tipoDaCampanha(nome) {
  if (nome.startsWith('[CAMPANHA WPP]')) return 'wpp';
  if (nome.startsWith('[+ SEGUIDORES]')) return 'seguidores';
  if (nome.startsWith('[+ ENGAJAMENTO]')) return 'engajamento';
  return 'outro';
}
```

Fazer a MESMA troca em `supabase/functions/_shared/relatorio-por-hora.js`.

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npm test 2>&1 | tail -10`
Expected: `# fail 0`

- [ ] **Step 5: Commit**

```bash
git add src/ferramentas/meta-ads/relatorio-por-hora.js src/ferramentas/meta-ads/relatorio-por-hora.test.mjs \
        supabase/functions/_shared/relatorio-por-hora.js supabase/functions/_shared/relatorio-por-hora.test.mjs
git commit -m "feat(meta-ads): tipoDaCampanha reconhece [+ ENGAJAMENTO]"
```

---

### Task 2: Lógica pura de agregação diária (`relatorio-diario-opr.js`)

**Files:**
- Create: `src/ferramentas/meta-ads/relatorio-diario-opr.js`
- Test: `src/ferramentas/meta-ads/relatorio-diario-opr.test.mjs`

**Interfaces:**
- Consumes: `tipoDaCampanha(nome)`, `custoPorLead(gasto, contagem)` de `./relatorio-por-hora.js` (já existem).
- Produces:
  - `agruparCampanhasDoDia(linhas, nomesPorCampanha): Array<{campaignId, nome, tipo, gasto, likes, comments, shares, saves, conversas, postEngagement}>` — usado por Task 4 (`gerar-opr-diario.mjs`).
  - `montarDadosOpr(campanhasDoDia, seguidoresDoDia, visitasPerfilDoDia): {header, growth, engagement, leads}` — usado por Task 3 (`template-opr.mjs`) e Task 4.
  - Formato exato do retorno de `montarDadosOpr`:
    ```
    header: { investimentoTotal, novosSeguidores, engajamentos, leadsGerados }
    growth: { investimento, seguidores, visitasPerfil, custoPorSeguidor, custoPorVisita, conversaoVisitaSeguidor }
    engagement: { investimento, curtidas, comentarios, compartilhamentos, salvamentos, custoPorCurtida, custoPorComentario, custoPorCompartilhamento, custoPorSalvamento, totalInteracoes, custoMedioPorEngajamento }
    leads: { leads, investimento, custoPorLead }
    ```

- [ ] **Step 1: Escrever `src/ferramentas/meta-ads/relatorio-diario-opr.test.mjs`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agruparCampanhasDoDia, montarDadosOpr } from './relatorio-diario-opr.js';

test('agruparCampanhasDoDia: classifica pelo nome e converte os números (string->number, ausente->0)', () => {
  const linhas = [
    { campaign_id: 'c1', spend: '100.50', likes: '10', comments: '2', shares: '1', saves: '3', conversas: '4', post_engagement: '20' },
    { campaign_id: 'c2', spend: '50', likes: null, comments: null, shares: null, saves: null, conversas: null, post_engagement: null },
  ];
  const nomes = { c1: '[+ SEGUIDORES] Reels', c2: '[VAGA] Emprego' };
  const out = agruparCampanhasDoDia(linhas, nomes);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], {
    campaignId: 'c1', nome: '[+ SEGUIDORES] Reels', tipo: 'seguidores',
    gasto: 100.5, likes: 10, comments: 2, shares: 1, saves: 3, conversas: 4, postEngagement: 20,
  });
  assert.equal(out[1].tipo, 'outro');
  assert.equal(out[1].gasto, 50);
  assert.equal(out[1].likes, 0, 'campo ausente vira 0, nunca null/NaN');
});

test('montarDadosOpr: soma cada categoria certa e ignora "outro"', () => {
  const campanhas = agruparCampanhasDoDia([
    { campaign_id: 'c1', spend: 100, conversas: 5 },
    { campaign_id: 'c2', spend: 200, likes: 30, comments: 5, shares: 2, saves: 3, post_engagement: 80 },
    { campaign_id: 'c3', spend: 999, conversas: 999 },
  ], { c1: '[CAMPANHA WPP] X', c2: '[+ ENGAJAMENTO] Y', c3: '[VAGA] Z' });

  const dados = montarDadosOpr(campanhas, 12, 150);

  assert.equal(dados.leads.leads, 5);
  assert.equal(dados.leads.investimento, 100);
  assert.equal(dados.engagement.investimento, 200);
  assert.equal(dados.engagement.curtidas, 30);
  assert.equal(dados.engagement.totalInteracoes, 40);
  assert.equal(dados.header.investimentoTotal, 300, 'soma wpp+engajamento+seguidores, nunca a campanha "outro"');
  assert.equal(dados.header.engajamentos, 80);
  assert.equal(dados.header.leadsGerados, 5);
});

test('montarDadosOpr: custo nunca nasce de contagem ou investimento <= 0', () => {
  const semNada = montarDadosOpr([], 0, 0);
  assert.equal(semNada.growth.custoPorSeguidor, null);
  assert.equal(semNada.growth.custoPorVisita, null);
  assert.equal(semNada.growth.conversaoVisitaSeguidor, null, 'visita 0 é denominador inválido, não 0%');
  assert.equal(semNada.engagement.custoPorCurtida, null);
  assert.equal(semNada.engagement.custoMedioPorEngajamento, null);
  assert.equal(semNada.leads.custoPorLead, null);
});

test('montarDadosOpr: conversão visita->seguidor pode ser 0% de verdade (não é custo)', () => {
  const campanhas = agruparCampanhasDoDia(
    [{ campaign_id: 'c1', spend: 50 }],
    { c1: '[+ SEGUIDORES] X' },
  );
  const dados = montarDadosOpr(campanhas, 0, 100);
  assert.equal(dados.growth.conversaoVisitaSeguidor, 0, '0 seguidor de 100 visitas é 0% real, não null');
  assert.equal(dados.growth.custoPorSeguidor, null, 'mas custo por seguidor não existe com 0 seguidor (denominador inválido pra custo)');
});

test('montarDadosOpr: seguidoresDoDia null (sem leitura nenhuma) propaga null, não 0', () => {
  const dados = montarDadosOpr([], null, 50);
  assert.equal(dados.header.novosSeguidores, null);
  assert.equal(dados.growth.seguidores, null);
  assert.equal(dados.growth.conversaoVisitaSeguidor, null);
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `node --test src/ferramentas/meta-ads/relatorio-diario-opr.test.mjs`
Expected: FAIL (módulo `./relatorio-diario-opr.js` não existe ainda).

- [ ] **Step 3: Implementar `src/ferramentas/meta-ads/relatorio-diario-opr.js`**

```js
// src/ferramentas/meta-ads/relatorio-diario-opr.js
// Agregação diária pro relatório OPR (Paid Media Performance) — ver spec em
// docs/superpowers/specs/2026-09-17-relatorio-opr-diario-design.md.
//
// Nunca a mensagem/HTML pronta (isso é responsabilidade do template em
// coletor/lib/template-opr.mjs) — só os NÚMEROS, testáveis por igualdade.
import { tipoDaCampanha, custoPorLead } from './relatorio-por-hora.js';

// Agrupa linhas de campaign_insights (period_days=1, já filtradas pro dia e
// conta certos) em campanhas classificadas — mesmo espírito de
// agruparPorDiaEHora, mas pro insight DIÁRIO (spend/likes/comments/shares/
// saves/conversas/post_engagement), não por hora.
export function agruparCampanhasDoDia(linhas, nomesPorCampanha = {}) {
  return linhas.map((l) => {
    const nome = nomesPorCampanha[l.campaign_id] || l.campaign_id;
    return {
      campaignId: l.campaign_id,
      nome,
      tipo: tipoDaCampanha(nome),
      gasto: Number(l.spend) || 0,
      likes: Number(l.likes) || 0,
      comments: Number(l.comments) || 0,
      shares: Number(l.shares) || 0,
      saves: Number(l.saves) || 0,
      conversas: Number(l.conversas) || 0,
      postEngagement: Number(l.post_engagement) || 0,
    };
  });
}

function porTipo(campanhas, tipo) {
  return campanhas.filter((c) => c.tipo === tipo);
}
function somar(campanhas, campo) {
  return campanhas.reduce((s, c) => s + c[campo], 0);
}

// Números prontos do relatório OPR diário. `seguidoresDoDia` pode ser `null`
// (nenhuma leitura de seguidor nesse dia ainda); `visitasPerfilDoDia` nunca é
// null (a soma do dia é 0 quando não há leitura).
//
// Regra de custo (mesma do resto do projeto): nunca divide por contagem <= 0
// nem por investimento <= 0 — cai pra `null`, nunca "R$ 0,00" inventado.
// Diferente disso, TAXA/PERCENTUAL (conversão) pode ser 0% de verdade — não é
// mentira, é fato quando a base é positiva e o resultado é zero.
export function montarDadosOpr(campanhasDoDia, seguidoresDoDia, visitasPerfilDoDia) {
  const seguidores = porTipo(campanhasDoDia, 'seguidores');
  const engajamento = porTipo(campanhasDoDia, 'engajamento');
  const wpp = porTipo(campanhasDoDia, 'wpp');

  const investimentoSeguidores = somar(seguidores, 'gasto');
  const investimentoEngajamento = somar(engajamento, 'gasto');
  const investimentoWpp = somar(wpp, 'gasto');

  const growth = {
    investimento: investimentoSeguidores,
    seguidores: seguidoresDoDia,
    visitasPerfil: visitasPerfilDoDia,
    custoPorSeguidor: investimentoSeguidores > 0 && seguidoresDoDia > 0
      ? custoPorLead(investimentoSeguidores, seguidoresDoDia) : null,
    custoPorVisita: investimentoSeguidores > 0 && visitasPerfilDoDia > 0
      ? custoPorLead(investimentoSeguidores, visitasPerfilDoDia) : null,
    conversaoVisitaSeguidor: visitasPerfilDoDia > 0 && seguidoresDoDia !== null
      ? (seguidoresDoDia / visitasPerfilDoDia) * 100 : null,
  };

  const curtidas = somar(engajamento, 'likes');
  const comentarios = somar(engajamento, 'comments');
  const compartilhamentos = somar(engajamento, 'shares');
  const salvamentos = somar(engajamento, 'saves');
  const totalInteracoes = curtidas + comentarios + compartilhamentos + salvamentos;
  const engagement = {
    investimento: investimentoEngajamento,
    curtidas, comentarios, compartilhamentos, salvamentos,
    custoPorCurtida: investimentoEngajamento > 0 && curtidas > 0
      ? custoPorLead(investimentoEngajamento, curtidas) : null,
    custoPorComentario: investimentoEngajamento > 0 && comentarios > 0
      ? custoPorLead(investimentoEngajamento, comentarios) : null,
    custoPorCompartilhamento: investimentoEngajamento > 0 && compartilhamentos > 0
      ? custoPorLead(investimentoEngajamento, compartilhamentos) : null,
    custoPorSalvamento: investimentoEngajamento > 0 && salvamentos > 0
      ? custoPorLead(investimentoEngajamento, salvamentos) : null,
    totalInteracoes,
    custoMedioPorEngajamento: investimentoEngajamento > 0 && totalInteracoes > 0
      ? custoPorLead(investimentoEngajamento, totalInteracoes) : null,
  };

  const leadsCount = somar(wpp, 'conversas');
  const leads = {
    leads: leadsCount,
    investimento: investimentoWpp,
    custoPorLead: investimentoWpp > 0 && leadsCount > 0
      ? custoPorLead(investimentoWpp, leadsCount) : null,
  };

  const header = {
    investimentoTotal: investimentoSeguidores + investimentoEngajamento + investimentoWpp,
    novosSeguidores: seguidoresDoDia,
    engajamentos: somar(engajamento, 'postEngagement'),
    leadsGerados: leadsCount,
  };

  return { header, growth, engagement, leads };
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `node --test src/ferramentas/meta-ads/relatorio-diario-opr.test.mjs`
Expected: todos os testes passam.

- [ ] **Step 5: Rodar a suíte inteira (garantir que nada mais quebrou)**

Run: `npm test 2>&1 | tail -10`
Expected: `# fail 0`

- [ ] **Step 6: Commit**

```bash
git add src/ferramentas/meta-ads/relatorio-diario-opr.js src/ferramentas/meta-ads/relatorio-diario-opr.test.mjs
git commit -m "feat(meta-ads): agregação diária pro relatório OPR (Growth/Engagement/Leads)"
```

---

### Task 3: Template HTML (`coletor/lib/template-opr.mjs`)

**Files:**
- Create: `coletor/lib/template-opr.mjs`
- Test: `coletor/lib/template-opr.test.mjs`

**Interfaces:**
- Consumes: `formatarReais(v)` de `../../src/ferramentas/meta-ads/relatorio-por-hora.js` (já existe); o formato de `dados` produzido por `montarDadosOpr` (Task 2).
- Produces:
  - `montarHtmlOpr(dados, meta: {conta, periodoLabel}): string` — usado por Task 4.
  - `DIM_OPR: {width, height}` — usado por Task 4 (passado pro `renderPNG`).

- [ ] **Step 1: Escrever `coletor/lib/template-opr.test.mjs`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montarHtmlOpr } from './template-opr.mjs';

test('montarHtmlOpr: injeta os valores calculados no HTML, formatados', () => {
  const dados = {
    header: { investimentoTotal: 300, novosSeguidores: 12, engajamentos: 80, leadsGerados: 5 },
    growth: { investimento: 100, seguidores: 12, visitasPerfil: 150, custoPorSeguidor: 8.33, custoPorVisita: 0.67, conversaoVisitaSeguidor: 8 },
    engagement: { investimento: 200, curtidas: 30, comentarios: 5, compartilhamentos: 2, salvamentos: 3, custoPorCurtida: 6.67, custoPorComentario: 40, custoPorCompartilhamento: 100, custoPorSalvamento: 66.67, totalInteracoes: 40, custoMedioPorEngajamento: 5 },
    leads: { leads: 5, investimento: 100, custoPorLead: 20 },
  };
  const html = montarHtmlOpr(dados, { conta: 'Vessel Brasil', periodoLabel: '16/09/2026' });
  assert.match(html, /Vessel Brasil/);
  assert.match(html, /16\/09\/2026/);
  assert.match(html, /R\$\s?300,00/);
  assert.match(html, /Custo por Lead/);
  assert.match(html, /R\$\s?20,00/);
});

test('montarHtmlOpr: valor null aparece como travessão, nunca "null" ou número inventado', () => {
  const dados = {
    header: { investimentoTotal: 0, novosSeguidores: null, engajamentos: 0, leadsGerados: 0 },
    growth: { investimento: 0, seguidores: null, visitasPerfil: 0, custoPorSeguidor: null, custoPorVisita: null, conversaoVisitaSeguidor: null },
    engagement: { investimento: 0, curtidas: 0, comentarios: 0, compartilhamentos: 0, salvamentos: 0, custoPorCurtida: null, custoPorComentario: null, custoPorCompartilhamento: null, custoPorSalvamento: null, totalInteracoes: 0, custoMedioPorEngajamento: null },
    leads: { leads: 0, investimento: 0, custoPorLead: null },
  };
  const html = montarHtmlOpr(dados, { conta: 'Vessel Brasil', periodoLabel: '16/09/2026' });
  assert.doesNotMatch(html, /null/);
  assert.match(html, /—/);
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `node --test coletor/lib/template-opr.test.mjs`
Expected: FAIL (módulo `./template-opr.mjs` não existe ainda).

- [ ] **Step 3: Implementar `coletor/lib/template-opr.mjs`**

```js
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
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `node --test coletor/lib/template-opr.test.mjs`
Expected: todos os testes passam.

- [ ] **Step 5: Rodar a suíte inteira**

Run: `npm test 2>&1 | tail -10`
Expected: `# fail 0`

- [ ] **Step 6: Commit**

```bash
git add coletor/lib/template-opr.mjs coletor/lib/template-opr.test.mjs
git commit -m "feat(meta-ads): template HTML do relatório OPR diário"
```

---

### Task 4: Script orquestrador (`coletor/gerar-opr-diario.mjs`)

**Files:**
- Create: `coletor/gerar-opr-diario.mjs`

**Interfaces:**
- Consumes: `renderPNG(html, {width,height})`/`fecharRender()` de `./lib/render-criativo.mjs` (já existem); `montarHtmlOpr`/`DIM_OPR` de `./lib/template-opr.mjs` (Task 3); `agruparCampanhasDoDia`/`montarDadosOpr` de `../src/ferramentas/meta-ads/relatorio-diario-opr.js` (Task 2); `deltaDeSeguidoresPorHora`/`seguidoresNoDia`/`visitasPerfilNoDia` de `../src/ferramentas/meta-ads/relatorio-por-hora.js` (já existem).
- Produces: nada consumido por outra task — é o topo do pipeline.

Este script não tem `.test.mjs` — é orquestração de I/O (rede, arquivo), sem lógica nova pra testar por igualdade (a lógica em si já foi testada nas Tasks 2 e 3). A verificação é o `--dry` manual no Step 3.

- [ ] **Step 1: Confirmar que `coletor/lib/carregar-env.mjs` e `coletor/.env` existem (necessários pra rodar local)**

Run: `ls coletor/lib/carregar-env.mjs coletor/.env`
Expected: os dois arquivos existem (se `coletor/.env` faltar, copiar do checkout principal — CLAUDE.md já avisa sobre isso em worktree novo).

- [ ] **Step 2: Criar `coletor/gerar-opr-diario.mjs`**

```js
#!/usr/bin/env node
// coletor/gerar-opr-diario.mjs
// Gera o relatório OPR diário (Paid Media Performance) — imagem consolidando
// o dia ANTERIOR (Growth/Seguidores + Engagement + Leads) — e manda pro
// grupo de WhatsApp via Z-API. Cron: .github/workflows/opr-diario.yml, 08h
// BRT. Ver spec: docs/superpowers/specs/2026-09-17-relatorio-opr-diario-design.md.
//
// Uso: node coletor/gerar-opr-diario.mjs [--dry]
//   --dry: salva o PNG em coletor/opr-preview.png e imprime os números no
//   terminal — NUNCA chama a Z-API. Único modo usado até o dono aprovar o
//   preview (pedido do dono, 17/09/2026: "monta pra mim mas não envia nada
//   lá no grupo ainda").
import './lib/carregar-env.mjs';
import { writeFile } from 'node:fs/promises';
import { renderPNG, fecharRender } from './lib/render-criativo.mjs';
import { montarHtmlOpr, DIM_OPR } from './lib/template-opr.mjs';
import { agruparCampanhasDoDia, montarDadosOpr } from '../src/ferramentas/meta-ads/relatorio-diario-opr.js';
import { deltaDeSeguidoresPorHora, seguidoresNoDia, visitasPerfilNoDia } from '../src/ferramentas/meta-ads/relatorio-por-hora.js';

const URL = process.env.SUPABASE_URL || 'https://kounqtdoioootxqegkij.supabase.co';
const SK = process.env.SUPABASE_SERVICE_KEY;
const REST = URL + '/rest/v1';
const H = { apikey: SK, Authorization: 'Bearer ' + SK, 'Content-Type': 'application/json' };
const CONTA_VESSEL = 'b6883e82-07cb-4f21-9fd7-ea7626786174';
// Mesmo grupo de teste do relatório por hora (enviar-relatorio-hora/index.ts).
const GRUPO_WHATSAPP = '120363431546698175-group';

const DRY = process.argv.includes('--dry');

async function sbGet(p) {
  const r = await fetch(REST + p, { headers: H });
  if (!r.ok) throw new Error('GET ' + p + ' ' + r.status);
  return r.json();
}

function ontemBR() {
  // -24h de "agora" cai solidamente em "ontem" em SP contanto que "agora" não
  // esteja perto da virada — o cron roda 08h BRT, 8h de folga da meia-noite.
  const ontem = new Date(Date.now() - 24 * 3600 * 1000);
  return ontem.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}
function periodoLabel(diaISO) {
  const [ano, mes, d] = diaISO.split('-');
  return `${d}/${mes}/${ano}`;
}

async function mandarImagemWhatsapp(buf, legenda) {
  const instanceId = process.env.ZAPI_INSTANCE_ID;
  const instanceToken = process.env.ZAPI_INSTANCE_TOKEN;
  const clientToken = process.env.ZAPI_TOKEN;
  const r = await fetch(`https://api.z-api.io/instances/${instanceId}/token/${instanceToken}/send-image`, {
    method: 'POST',
    headers: { 'Client-Token': clientToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: GRUPO_WHATSAPP, image: `data:image/png;base64,${buf.toString('base64')}`, caption: legenda }),
  });
  if (!r.ok) throw new Error(`Z-API send-image: ${r.status} ${await r.text()}`);
}
async function mandarTextoWhatsapp(mensagem) {
  const instanceId = process.env.ZAPI_INSTANCE_ID;
  const instanceToken = process.env.ZAPI_INSTANCE_TOKEN;
  const clientToken = process.env.ZAPI_TOKEN;
  const r = await fetch(`https://api.z-api.io/instances/${instanceId}/token/${instanceToken}/send-text`, {
    method: 'POST',
    headers: { 'Client-Token': clientToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: GRUPO_WHATSAPP, message: mensagem }),
  });
  if (!r.ok) throw new Error(`Z-API send-text: ${r.status} ${await r.text()}`);
}

async function main() {
  const dia = ontemBR();

  const [campanhas, insights, leituras, visitas] = await Promise.all([
    sbGet('/campaigns?select=campaign_id,name'),
    sbGet(`/campaign_insights?select=campaign_id,spend,likes,comments,shares,saves,conversas,post_engagement&account_id=eq.${CONTA_VESSEL}&captured_at=eq.${dia}&period_days=eq.1`),
    // 48h de folga: garante leitura ANTERIOR ao primeiro bucket de ontem, pra
    // deltaDeSeguidoresPorHora ter "anterior" pra comparar desde a primeira
    // hora do dia inteiro (não só a última hora, como no relatório por hora).
    sbGet(`/followers_leituras?select=followers_count,lido_em&account_id=eq.${CONTA_VESSEL}&lido_em=gte.${new Date(Date.now() - 48 * 3600 * 1000).toISOString()}&order=lido_em.asc`),
    sbGet(`/perfil_visitas_hora?select=dia,hora,visitas_hora&account_id=eq.${CONTA_VESSEL}&dia=eq.${dia}`),
  ]);

  const nomesPorCampanha = Object.fromEntries(campanhas.map((c) => [c.campaign_id, c.name]));
  const campanhasDoDia = agruparCampanhasDoDia(insights, nomesPorCampanha);
  const deltas = deltaDeSeguidoresPorHora(leituras);
  const seguidoresDoDia = seguidoresNoDia(deltas, dia);
  const visitasPerfilDoDia = visitasPerfilNoDia(visitas, dia);

  const dados = montarDadosOpr(campanhasDoDia, seguidoresDoDia, visitasPerfilDoDia);
  const html = montarHtmlOpr(dados, { conta: 'Vessel Brasil', periodoLabel: periodoLabel(dia) });

  let buf;
  try {
    buf = await renderPNG(html, DIM_OPR);
  } finally {
    await fecharRender();
  }

  if (DRY) {
    await writeFile(new URL('./opr-preview.png', import.meta.url), buf);
    console.log('--dry: PNG salvo em coletor/opr-preview.png, nada enviado.');
    console.log(JSON.stringify(dados, null, 2));
    return;
  }

  try {
    await mandarImagemWhatsapp(buf, `Paid Media Performance — ${periodoLabel(dia)}`);
  } catch (e) {
    console.error('Falha ao mandar a imagem, avisando por texto:', e.message);
    await mandarTextoWhatsapp(`⚠️ Relatório OPR de ${periodoLabel(dia)} não saiu — ${e.message}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
```

- [ ] **Step 3: Rodar em `--dry` local e conferir o PNG**

Run: `node coletor/gerar-opr-diario.mjs --dry`
Expected: imprime `--dry: PNG salvo em coletor/opr-preview.png, nada enviado.` seguido do JSON dos números; **nenhuma chamada à Z-API**. Abrir `coletor/opr-preview.png` e olhar — se algum número parecer visualmente cortado (`DIM_OPR.height` pequeno demais ou grande demais pro conteúdo), ajustar `DIM_OPR` em `coletor/lib/template-opr.mjs` e rodar de novo até o layout caber bem. Isso é esperado (a spec já previa esse ajuste visual nesta etapa).

- [ ] **Step 4: Rodar a suíte inteira de novo (garantir que nada quebrou)**

Run: `npm test 2>&1 | tail -10`
Expected: `# fail 0`

- [ ] **Step 5: Commit**

```bash
git add coletor/gerar-opr-diario.mjs
git commit -m "feat(meta-ads): script gerar-opr-diario.mjs (--dry por padrão, sem envio real)"
```

(Se o Step 3 exigiu ajuste de `DIM_OPR`, incluir `coletor/lib/template-opr.mjs` nesse mesmo commit.)

---

### Task 5: Workflow do GitHub Actions (schedule desligado)

**Files:**
- Create: `.github/workflows/opr-diario.yml`

**Interfaces:**
- Consumes: `coletor/gerar-opr-diario.mjs` (Task 4) via `node coletor/gerar-opr-diario.mjs --dry`.
- Produces: nada consumido por outra task.

- [ ] **Step 1: Criar `.github/workflows/opr-diario.yml`**

```yaml
name: Relatório OPR Diário
on:
  workflow_dispatch: {}
  # Cron DESLIGADO até o dono aprovar o preview (spec:
  # docs/superpowers/specs/2026-09-17-relatorio-opr-diario-design.md). Quando
  # aprovar: descomentar o schedule abaixo E trocar --dry por envio real em
  # coletor/gerar-opr-diario.mjs (commit separado).
  # schedule:
  #   - cron: '0 11 * * *'  # 08h BRT — Brasil não tem horário de verão desde 2019
jobs:
  gerar:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v6
        with: { node-version: '24' }
      - name: Instalar deps
        run: cd coletor && npm ci
      - name: Gerar relatório (--dry, envio real ainda desligado)
        env:
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
          ZAPI_INSTANCE_ID: ${{ secrets.ZAPI_INSTANCE_ID }}
          ZAPI_INSTANCE_TOKEN: ${{ secrets.ZAPI_INSTANCE_TOKEN }}
          ZAPI_TOKEN: ${{ secrets.ZAPI_TOKEN }}
        run: node coletor/gerar-opr-diario.mjs --dry
      - name: Guardar o PNG gerado
        uses: actions/upload-artifact@v4
        with:
          name: opr-preview
          path: coletor/opr-preview.png
```

- [ ] **Step 2: Confirmar que os secrets `ZAPI_INSTANCE_ID`/`ZAPI_INSTANCE_TOKEN`/`ZAPI_TOKEN` existem no repositório GitHub**

Run (de dentro do checkout do repo — `gh` detecta o repositório certo pela pasta atual): `gh secret list | grep ZAPI`
Expected: os 3 nomes aparecem. Se não aparecerem, avisar o dono — ele precisa fornecer os valores de novo (já configurados como secret do Supabase, mas `supabase secrets list` não expõe valor, só nome) pra cadastrar via `gh secret set ZAPI_INSTANCE_ID` etc. **Não seguir sem isso** — o job falharia em runtime, não em validação.

- [ ] **Step 3: Disparar manualmente e conferir o artefato**

Run: `gh workflow run opr-diario.yml` (depois `gh run list --workflow=opr-diario.yml` pra achar o run, e `gh run download <run-id>` pra baixar o artefato `opr-preview` — `<run-id>` vem do `gh run list`, não é um placeholder a preencher antes)
Expected: o run termina com sucesso, e o PNG baixado é o mesmo tipo de imagem já validado no Step 3 da Task 4.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/opr-diario.yml
git commit -m "feat(meta-ads): workflow do relatório OPR diário (schedule desligado, só workflow_dispatch)"
```

---

## Depois desta entrega (fora deste plano)

- Ligar o `schedule` do workflow e trocar `--dry` por envio real em
  `gerar-opr-diario.mjs` — só depois do dono revisar o PNG gerado nas Tasks 4
  e 5 e aprovar explicitamente.
- Leads Quentes/Vendas via Chatwoot — integração futura, spec própria.
- Media Mix — aguardando definição do gerente de marketing.
- "Depois transformamos isso em painel" — reaproveitar `montarDadosOpr` (já
  pronto pra isso, é lógica pura sem HTML) numa tela nova do dashboard.
