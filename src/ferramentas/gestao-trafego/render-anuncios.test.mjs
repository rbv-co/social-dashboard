import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// EXECUTA _renderGtAds com um DOM de mentira.
//
// POR QUE ISTO EXISTE: ao remover o selo da IA do cartão do anúncio eu apaguei
// junto a criação do `card`, e sobrou uma linha usando uma variável que não
// existia mais. `npm run build` passou — é JavaScript válido, o erro só aparece
// quando a função RODA — e a aba Campanhas quebrou inteira com "card is not
// defined" (2026-07-29). Nenhum teste pegava porque a função vive dentro do
// .vue e nunca era chamada fora do navegador.
//
// A função é extraída do arquivo e executada aqui com stubs. Frágil se ela for
// renomeada — e é esse o ponto: quem renomear vai reler este comentário.

const fonte = readFileSync(new URL('./tela-de-gestao-trafego.vue', import.meta.url), 'utf8');

// Recorta o texto da função pelo nome, contando chaves até fechar.
function corpoDaFuncao(nome) {
  const i = fonte.indexOf(`function ${nome}(`);
  assert.ok(i > 0, `não achei a função ${nome}`);
  let d = 0, dentro = false;
  for (let j = fonte.indexOf('{', i); j < fonte.length; j++) {
    const c = fonte[j];
    if (c === '{') { d++; dentro = true; }
    else if (c === '}') { d--; if (dentro && d === 0) return fonte.slice(i, j + 1); }
  }
  throw new Error(`função ${nome} não fecha`);
}

// DOM mínimo: só o que a função toca.
function domFalso() {
  const criados = [];
  const el = () => {
    const e = {
      className: '', textContent: '', innerHTML: '', style: { cssText: '' }, title: '',
      filhos: [], appendChild(f) { this.filhos.push(f); return f; },
      addEventListener() {}, querySelectorAll: () => [], querySelector: () => null,
    };
    criados.push(e);
    return e;
  };
  return { document: { createElement: el }, criados };
}

// Stubs comuns das dependências. Qualquer nome que a função use e NÃO esteja
// aqui nem declarado nela estoura — que é exatamente o bug que se quer pegar.
// `extra` sobrescreve/acrescenta stubs específicos de cada teste (o KPI do
// mercado no anúncio, Onda C Tarefa 5 Passo 3, precisa de alvoDoBalde,
// custoDoAlvo, GT_METRIC_CATALOG e _gtFmt — ausentes na função antes desta
// tarefa, por isso não estavam aqui).
function escopoComDom(extra) {
  const { document, criados } = domFalso();
  const escopo = {
    document,
    _gtEsc: (s) => String(s == null ? '' : s),
    _maFmtPct: (v) => `${v}%`,
    _maFmtR: (v) => `R$ ${v}`,
    _gtBalde: () => 'trafego',
    _gtSeloObjetivoEl: () => null,
    _gtSelCaixa: () => null,
    _gtManualToggleBtn: () => null,
    // Devolve null como os outros botões opcionais: o cartão faz `if(bDupAd)`
    // antes de encaixar, então null exercita o caminho de "sem permissão".
    _gtBotaoDuplicar: () => null,
    _gtVerCriativo: () => {},
    _gtReguaAtiva: () => ({ pesos: {}, limiares: {}, metas: {}, limiares_resultado: {} }),
    _gtObjetivoInteracao: {},
    interacaoValida: () => false,
    quantidadesDoInsight: () => ({}),
    custoDaInteracao: () => null,
    metaDoBalde: () => 0,
    avaliarAlvo: () => ({ faixa: 'sem-dados' }),
    INTERACOES: {},
    _gtCurAcc: { id: 'conta-1' },
    // O KPI do mercado no anúncio (Onda C, Tarefa 5, Passo 3): sem mercado
    // (null) por padrão — o cartão não pinta chip nenhum se ninguém pedir.
    alvoDoBalde: () => null,
    custoDoAlvo: () => null,
    _gtMetricValue: () => null,
    GT_METRIC_CATALOG: {},
    _gtFmt: (v) => String(v),
    ...(extra || {}),
  };
  const nomes = Object.keys(escopo);
  const fn = new Function(...nomes, `${corpoDaFuncao('_renderGtAds')}; return _renderGtAds;`)(...nomes.map((n) => escopo[n]));
  return { fn, criados };
}

test('_renderGtAds monta o cartão sem referenciar variável inexistente', () => {
  const pane = { filhos: [], appendChild(f) { this.filhos.push(f); }, className: '', style: { cssText: '' } };
  const { fn, criados } = escopoComDom();

  const ads = [
    { ad_id: 'a1', ad_name: 'Criativo A', adset_name: 'Conjunto X', ctr: '1.5', spend: '100', effective_status: 'ACTIVE' },
    { ad_id: 'a2', ad_name: 'Criativo B', ctr: '0.3', spend: '40', effective_status: 'PAUSED' },
  ];
  fn(pane, ads, [], [], 1, false, null);

  assert.equal(pane.filhos.length, 3, 'rótulo + um cartão por anúncio');
  const nomesCriados = criados.map((c) => c.className);
  assert.ok(nomesCriados.includes('gt-ad-card'), 'o cartão do anúncio precisa existir');
  assert.ok(nomesCriados.some((c) => c.startsWith('gt-status-badge')), 'e o badge de status junto');
});

// O KPI DO MERCADO NO CARTÃO DO ANÚNCIO (Onda C, Tarefa 5, Passo 3) — pedido
// do dono, 25/09: "eu não vejo as kpis no card dos anúncios também".
test('_renderGtAds mostra o KPI do mercado (custo + cor) e a quantidade do resultado', () => {
  const pane = { filhos: [], appendChild(f) { this.filhos.push(f); } };
  const { fn, criados } = escopoComDom({
    alvoDoBalde: (m) => (m === 'lead' ? { rotulo: 'Custo por lead', resultado: 'leads' } : null),
    custoDoAlvo: () => 12.5,
    metaDoBalde: () => 20,
    avaliarAlvo: () => ({ faixa: 'dentro-da-meta' }),
    _gtMetricValue: () => 3,
    GT_METRIC_CATALOG: { leads: { label: 'Leads', fmt: 'int' } },
    _gtFmt: (v) => String(v),
  });
  const ads = [{ ad_id: 'a1', ad_name: 'Criativo A', ctr: '1.5', spend: '100', effective_status: 'ACTIVE' }];
  fn(pane, ads, [], [], 1, false, 'lead');

  const metricasHtml = criados.filter((c) => c.className === 'gt-metric').map((c) => c.innerHTML).join(' | ');
  assert.ok(metricasHtml.includes('Custo por lead'), 'o rótulo do mercado precisa aparecer');
  assert.ok(metricasHtml.includes('var(--green)'), 'dentro da meta pinta de verde');
  assert.ok(metricasHtml.includes('R$ 12.5'), 'o custo do mercado precisa aparecer');
  assert.ok(metricasHtml.includes('Leads') && metricasHtml.includes('3'), 'a QUANTIDADE do resultado precisa aparecer, não só o custo');
});

test('_renderGtAds: quantidade ZERO nunca aparece como "0" — Meta omite o action_type, zero vira ausência', () => {
  const pane = { filhos: [], appendChild(f) { this.filhos.push(f); } };
  const { fn, criados } = escopoComDom({
    alvoDoBalde: () => ({ rotulo: 'Custo por lead', resultado: 'leads' }),
    custoDoAlvo: () => 12.5,
    _gtMetricValue: () => 0, // resultado zero
    GT_METRIC_CATALOG: { leads: { label: 'Leads', fmt: 'int' } },
  });
  const ads = [{ ad_id: 'a1', ad_name: 'Criativo A', ctr: '1.5', spend: '100', effective_status: 'ACTIVE' }];
  fn(pane, ads, [], [], 1, false, 'lead');

  const metricasHtml = criados.filter((c) => c.className === 'gt-metric').map((c) => c.innerHTML).join(' | ');
  assert.ok(!metricasHtml.includes('Leads'), 'sem quantidade nenhuma: zero devolve null, não "0"');
});

test('_renderGtAds: sem meta pro mercado, o custo aparece SEM COR — não julga', () => {
  const pane = { filhos: [], appendChild(f) { this.filhos.push(f); } };
  const { fn, criados } = escopoComDom({
    alvoDoBalde: () => ({ rotulo: 'Custo por lead', resultado: 'leads' }),
    custoDoAlvo: () => 12.5,
    metaDoBalde: () => 0, // sem meta calibrada pra este mercado ainda
    avaliarAlvo: () => ({ faixa: 'sem-dados' }),
    _gtMetricValue: () => null,
  });
  const ads = [{ ad_id: 'a1', ad_name: 'Criativo A', ctr: '1.5', spend: '100', effective_status: 'ACTIVE' }];
  fn(pane, ads, [], [], 1, false, 'lead');

  const metricasHtml = criados.filter((c) => c.className === 'gt-metric').map((c) => c.innerHTML).join(' | ');
  assert.ok(metricasHtml.includes('var(--muted)'), 'sem meta, a cor cai em muted — nunca verde/laranja/vermelho');
  assert.ok(!metricasHtml.includes('var(--green)') && !metricasHtml.includes('var(--red)') && !metricasHtml.includes('var(--orange)'),
    'sem meta não é "manter" nem "otimizar" nem "escalar" — é NÃO JULGAR');
});

test('_renderGtAds: sem mercado nenhum (mercadoDosAnuncios ausente), nenhum chip de KPI de mercado aparece', () => {
  const pane = { filhos: [], appendChild(f) { this.filhos.push(f); } };
  const { fn, criados } = escopoComDom({
    // alvoDoBalde nem deveria ser chamado sem mercado — se for chamado com
    // algo, devolve um alvo válido só para provar que, mesmo assim, nada é
    // desenhado (o gatilho é `mercadoDosAnuncios`, não uma chamada solta).
    alvoDoBalde: () => ({ rotulo: 'Custo por lead', resultado: 'leads' }),
  });
  const ads = [{ ad_id: 'a1', ad_name: 'Criativo A', ctr: '1.5', spend: '100', effective_status: 'ACTIVE' }];
  fn(pane, ads, [], [], 1, false, null);

  const metricasHtml = criados.filter((c) => c.className === 'gt-metric').map((c) => c.innerHTML).join(' | ');
  assert.ok(!metricasHtml.includes('Custo por lead'), 'sem mercado, sem KPI — a régua de apoio não é herdada do nada');
});

test('_renderGtAds sem anúncio nenhum não quebra', () => {
  const { document } = domFalso();
  const pane = { filhos: [], appendChild(f) { this.filhos.push(f); } };
  const escopo = { document };
  const fn = new Function('document', `${corpoDaFuncao('_renderGtAds')}; return _renderGtAds;`)(document);
  fn(pane, [], [], [], 1, false);
  assert.equal(pane.filhos.length, 2, 'rótulo + aviso de vazio');
});

test('o cartão NÃO traz mais o selo de julgamento da IA', () => {
  // O selo "Manter"/"Pausar" migrou pra Fila; se voltar aqui, a mesma decisão
  // passa a existir em dois lugares e a daqui não deixa registro.
  const corpo = corpoDaFuncao('_renderGtAds');
  assert.ok(!corpo.includes('gt-ad-pill'), 'a pílula de veredito não pode voltar');
  assert.ok(!corpo.includes('_gtAdIA'), 'nem a leitura da análise por anúncio');
});
