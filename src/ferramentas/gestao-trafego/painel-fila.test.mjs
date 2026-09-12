import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montarPainelFila } from './painel-fila.js';

// Alvo de mentira: o painel só precisa de innerHTML e querySelectorAll. Sem DOM
// de verdade dá pra provar o que importa aqui — o HTML que sai.
const alvoFalso = () => ({ innerHTML: '', querySelectorAll: () => [] });

const item = (extra) => ({
  campaign_id: 'c1', account_id: 'conta-1', conta_nome: 'Raíssa Herculano',
  campaign_name: 'MODA & BOLSAS', veredito: 'escalar', gerado_em: '2026-07-29T00:00:00Z',
  budget_atual_centavos: 23000, budget_sugerido_centavos: 28000, ...extra,
});
const monta = (o) => { const a = alvoFalso(); montarPainelFila(a, { agora: '2026-07-29T12:00:00Z', ...o }); return a.innerHTML; };

// ── escape: justificativa e impacto sao ESCRITOS PELO MODELO ────────────────

test('texto do modelo nao vira HTML', () => {
  const html = monta({
    pendentes: [item({
      justificativa: '<img src=x onerror="alert(1)">',
      impacto_estimado: '</p><script>alert(2)</script>',
    })],
  });
  assert.ok(!html.includes('<img src=x'), 'a tag do modelo nao pode sair viva');
  assert.ok(!html.includes('<script>'), 'nem script');
  assert.ok(html.includes('&lt;img src=x'), 'sai escapado, mas sai — o dono precisa ler o texto');
});

test('nome de campanha e de conjunto tambem sao escapados', () => {
  const html = monta({
    pendentes: [item({
      campaign_name: '"><script>x</script>',
      conta_nome: '<b>conta</b>',
      conjuntos: [{ id: 'a', nome: '<i>conj</i>', deCentavos: 23000 }],
    })],
  });
  assert.ok(!html.includes('<script>x'));
  assert.ok(!html.includes('<b>conta</b>'));
  assert.ok(!html.includes('<i>conj</i>'));
});

test('veredito desconhecido nao injeta classe nem markup', () => {
  const html = monta({ pendentes: [item({ veredito: '"><script>x</script>' })] });
  assert.ok(!html.includes('<script>x'));
  assert.ok(html.includes('gtf-item neutro'), 'cai na cor neutra, que e literal');
});

// ── conteudo ────────────────────────────────────────────────────────────────

test('mostra de -> para e a variacao em %', () => {
  const html = monta({ pendentes: [item()] });
  assert.match(html, /R\$ 230,00/);
  assert.match(html, /R\$ 280,00/);
  assert.match(html, /\+22%/);
});

test('pausar nao mostra de -> para: o que muda e o estado', () => {
  const html = monta({ pendentes: [item({ veredito: 'pausar' })] });
  assert.match(html, /para de rodar/);
  assert.ok(!html.includes('gtf-seta'), 'seta de valor nao faz sentido aqui');
});

test('ABO: a quebra por conjunto aparece ANTES de aprovar, e fecha no total', () => {
  const html = monta({
    pendentes: [item({
      conjuntos: [
        { id: 'a', nome: 'DIA DA BELEZA', deCentavos: 5000 },
        { id: 'b', nome: 'MINI VLOG', deCentavos: 6000 },
        { id: 'c', nome: 'BASTIDORES', deCentavos: 6000 },
        { id: 'd', nome: 'CONSTRUÇÃO BOLSA', deCentavos: 6000 },
      ],
    })],
  });
  assert.match(html, /est(á|&aacute;) em 4 conjuntos/);
  assert.match(html, /DIA DA BELEZA/);
  // a soma tem que bater com os R$ 280 aprovados
  const valores = [...html.matchAll(/gtf-cj-para">R\$ ([\d.,]+)</g)].map((m) => Number(m[1].replace(/\./g, '').replace(',', '.')));
  assert.equal(valores.length, 4);
  assert.equal(Math.round(valores.reduce((t, v) => t + v, 0) * 100), 28000);
});

test('CBO nao mostra bloco de conjuntos', () => {
  const html = monta({ pendentes: [item({ conjuntos: [] })] });
  assert.ok(!html.includes('gtf-conjuntos'));
});

// ── filtro por conta ────────────────────────────────────────────────────────

test('quem filtra e o seletor da topbar: mostra so a conta aberta', () => {
  const html = monta({
    pendentes: [item({ campaign_name: 'DA RAISSA' }), item({ campaign_id: 'c2', account_id: 'conta-2', campaign_name: 'DA VESSEL' })],
    contas: [{ id: 'conta-1', name: 'Raíssa' }, { id: 'conta-2', name: 'Vessel' }],
    contaFiltro: 'conta-2', contaNome: 'Vessel',
  });
  assert.ok(html.includes('DA VESSEL'));
  assert.ok(!html.includes('DA RAISSA'));
  assert.ok(!html.includes('gtf-filtro'), 'os botoes proprios de conta sairam');
});

test('o que esta nas OUTRAS contas continua sendo dito', () => {
  // Filtrar por conta some com itens da lista; some do CONHECIMENTO nao pode —
  // senao o dono acha que resolveu tudo olhando uma conta so.
  const html = monta({
    pendentes: [
      item({ account_id: 'conta-1' }),
      item({ campaign_id: 'c2', account_id: 'conta-2' }),
      item({ campaign_id: 'c3', account_id: 'conta-2' }),
      item({ campaign_id: 'c4', account_id: 'conta-3' }),
    ],
    contas: [{ id: 'conta-1', name: 'Raíssa' }, { id: 'conta-2', name: 'Vessel' }, { id: 'conta-3', name: 'Motoeasy' }],
    contaFiltro: 'conta-1', contaNome: 'Raíssa',
  });
  assert.match(html, /Mais 3 em/);
  assert.match(html, /Vessel<\/b> \(2\)/);
  assert.match(html, /Motoeasy<\/b> \(1\)/);
  assert.match(html, /troque a conta lá em cima/);
});

test('sem nada em outras contas, nao inventa aviso', () => {
  const html = monta({
    pendentes: [item({ account_id: 'conta-1' })],
    contas: [{ id: 'conta-1', name: 'Raíssa' }], contaFiltro: 'conta-1', contaNome: 'Raíssa',
  });
  assert.ok(!html.includes('gtf-outras'));
});

test('a fila vazia DESTA conta diz o nome dela', () => {
  const html = monta({ pendentes: [], contaFiltro: 'conta-1', contaNome: 'Mantova Móveis', carregou: true });
  assert.match(html, /Nada esperando decisão em Mantova Móveis/);
});

// ── estados ─────────────────────────────────────────────────────────────────

test('fila vazia explica o que vai aparecer ali', () => {
  const html = monta({ pendentes: [] });
  assert.match(html, /Nada esperando decis(ã|&atilde;)o/);
  assert.match(html, /toda madrugada/);
});

test('vencidas ficam dobradas num <details>, com a contagem visivel', () => {
  const html = monta({ pendentes: [], vencidas: [item({ campaign_id: 'v1' }), item({ campaign_id: 'v2' })] });
  assert.match(html, /<details/);
  assert.match(html, /2 sugest(õ|&otilde;)es vencidas/);
  assert.match(html, /parou de reanalisar/);
});

test('silenciadas viram uma nota, nao somem caladas', () => {
  const html = monta({ pendentes: [], silenciadas: [item()] });
  assert.match(html, /recusada volta/);
});

test('sem permissao nao mostra botao de decidir', () => {
  const comPermissao = monta({ pendentes: [item()], editavel: true });
  const sem = monta({ pendentes: [item()], editavel: false });
  assert.match(comPermissao, /data-gtf-acao/);
  assert.ok(!sem.includes('data-gtf-acao'));
  assert.match(sem, /n(ã|&atilde;)o tem permiss(ã|&atilde;)o/);
});

test('nada quebra sem opcoes', () => {
  const a = alvoFalso();
  montarPainelFila(a, {});
  assert.ok(a.innerHTML.length > 0);
});

// ── saude linkada (2026-07-29) ─────────────────────────────────────────────

test('CONFLITO ganha destaque: robo manda escalar, audiencia queimada', () => {
  const html = monta({ pendentes: [item({
    conflito: true,
    saude: { nivel: 'alerta', veredito: 'reduzir', porque: 'Frequência 4,2× — o mesmo público já viu demais.' },
  })], editavel: true });
  assert.match(html, /gtf-item positivo conflito/);
  assert.match(html, /4,2/);
  assert.match(html, /vale conferir antes de aprovar/);
});

test('saude de atencao aparece discreta, sem alarde', () => {
  const html = monta({ pendentes: [item({ saude: { nivel: 'atencao', veredito: 'monitorar', porque: 'CTR 0,30% baixo.' } })] });
  assert.match(html, /gtf-saude atencao/);
  assert.ok(!html.includes('conflito'));
});

test('item nascido da SAUDE nao repete o mesmo texto duas vezes', () => {
  const html = monta({ pendentes: [item({
    origem: 'saude', veredito: 'reduzir', budget_sugerido_centavos: null,
    justificativa: 'Frequência 4,2× — o mesmo público já viu demais.',
    saude: { nivel: 'alerta', veredito: 'reduzir', porque: 'Frequência 4,2× — o mesmo público já viu demais.' },
  })] });
  assert.equal((html.match(/4,2×/g) || []).length, 1);
  assert.match(html, /saúde da campanha/, 'diz de onde veio');
});

test('SEM valor sugerido as tres aparecem — mas a tela DIZ de onde veio o numero', () => {
  // A regra antiga era "sem numero, sem botao: um botao que promete agir e nao
  // sabe o que fazer e pior que nenhum botao". O dono pediu as tres sempre
  // (2026-08-03), e a promessa deixa de ser oca por outro caminho: o valor esta
  // escrito no botao E a origem dele esta escrita na linha. Sem essa segunda
  // parte, esta mudanca teria reintroduzido exatamente o defeito de antes.
  const html = monta({ pendentes: [item({ origem: 'saude', veredito: 'reduzir', budget_sugerido_centavos: null })], editavel: true });
  assert.match(html, /data-gtf-acao="subir"/);
  assert.match(html, /data-gtf-acao="baixar"/);
  assert.match(html, /data-gtf-acao="manter"/);
  assert.match(html, /não sugeriu um valor para esta linha/, 'a origem do número tem de estar dita');
});

test('campanha SEM orcamento conhecido so pode manter, e a tela explica', () => {
  // Aqui nao ha o que multiplicar: oferecer "subir 20%" de nada seria inventar.
  const html = monta({ pendentes: [item({ origem: 'saude', veredito: 'reduzir', budget_sugerido_centavos: null, budget_atual_centavos: null })], editavel: true });
  assert.ok(!html.includes('data-gtf-acao="subir"'));
  assert.match(html, /data-gtf-acao="manter"/);
  assert.match(html, /não tem orçamento conhecido/);
});

test('pausar continua existindo ao lado das tres — tirar seria tirar capacidade', () => {
  const html = monta({ pendentes: [item({ origem: 'saude', veredito: 'pausar', budget_sugerido_centavos: null })], editavel: true });
  assert.match(html, /data-gtf-acao="pausar"/);
  assert.match(html, /data-gtf-acao="subir"/, 'e as tres tambem');
  assert.match(html, /data-gtf-acao="manter"/);
});

test('sem valor sugerido mostra o gasto de hoje, nao um "de -> para" vazio', () => {
  const html = monta({ pendentes: [item({ origem: 'saude', veredito: 'reduzir', budget_sugerido_centavos: null })] });
  assert.match(html, /R\$ 230,00/);
  assert.match(html, /gtf-hoje/);
});

test('enquanto NAO carregou nao afirma que a fila esta vazia', () => {
  // O bug de 2026-07-29: a fila rodou antes de as contas chegarem, achou zero
  // campanha e anunciou "Nada esperando decisao" — quando na verdade nao tinha
  // lido nada. Dizer "nao ha o que decidir" e uma afirmacao, nao um placeholder.
  const html = monta({ pendentes: [], carregou: false });
  assert.match(html, /Carregando/);
  assert.ok(!html.includes('Nada esperando'));
});

test('carregado e vazio de verdade diz que esta vazio', () => {
  const html = monta({ pendentes: [], carregou: true });
  assert.match(html, /Nada esperando decis/);
});

test('sem o parametro assume carregado (compatibilidade)', () => {
  assert.match(monta({ pendentes: [] }), /Nada esperando decis/);
});

test('o botao DIZ a acao e o valor, nao um "Aprovar" generico', () => {
  // "Aprovar" numa linha que corta verba e ambiguo — ler o botao tem que bastar.
  const subir = monta({ pendentes: [item({ veredito: 'escalar', budget_sugerido_centavos: 28000 })], editavel: true });
  assert.match(subir, /Subir para R\$\s?280,00/);

  const baixar = monta({ pendentes: [item({ veredito: 'reduzir', budget_sugerido_centavos: 15000 })], editavel: true });
  assert.match(baixar, /Baixar para R\$\s?150,00/);
  assert.match(baixar, /gtf-btn aprovar reduzir/, 'e carrega a cor da acao');

  const pausar = monta({ pendentes: [item({ veredito: 'pausar' })], editavel: true });
  assert.match(pausar, /Pausar campanha/);
});

test('as TRES escolhas aparecem sempre, e a do robo vem destacada', () => {
  // Antes havia uma so: a que o robo escolheu. Quem discordava tinha de
  // dispensar a sugestao e ir mexer na aba Campanhas — na pratica, a fila decidia.
  const html = monta({ pendentes: [item({ veredito: 'escalar', budget_atual_centavos: 23000, budget_sugerido_centavos: 28000 })], editavel: true });
  // A recomendada carrega a estrela antes do rótulo, então o `>` não cola no texto.
  assert.match(html, /data-gtf-acao="subir"[^>]*>.*Subir para R\$\s?280,00/);
  assert.match(html, /Baixar para R\$\s?180,00/, 'espelho: o mesmo 22% para baixo');
  assert.match(html, /Manter como está/);
  assert.match(html, /class="gtf-btn aprovar recomendada"/, 'a do robo vem cheia');
  assert.match(html, /data-gtf-acao="baixar"[^>]*class=|class="gtf-btn alternativa reduzir"/, 'a inversa vem discreta');
  assert.match(html, /data-gtf-acao="manter"[^>]*>|alternativa/, 'manter tambem e discreto');
});

test('o impacto de cada escolha aparece POR EXTENSO, nao so no title', () => {
  // `title` nao existe em tela de toque, e a explicacao foi o que o dono pediu
  // junto com os botoes.
  const html = monta({ pendentes: [item({ veredito: 'escalar', budget_atual_centavos: 5000, budget_sugerido_centavos: 6250 })], editavel: true });
  assert.match(html, /O que acontece em cada escolha/);
  assert.match(html, /No mês, cerca de R\$\s?375,00 a mais/);
  assert.match(html, /No mês, cerca de R\$\s?375,00 a menos/);
  assert.match(html, /volta a aparecer daqui a 7 dias/);
});

test('a lupa aparece em cada criativo travado, com o id do anuncio', () => {
  const html = monta({ pendentes: [item({ criativos: [{ ad_id: '99', nome: 'Bolsa A', porque: 'CTR baixo' }] })], editavel: true });
  assert.match(html, /data-gtf-lupa="99"/);
  assert.match(html, /ver</);
});

test('criativos aparecem DOBRADOS, com numero e motivo, e uma acao so', () => {
  const html = monta({ pendentes: [item({
    criativos: [
      { ad_id: 'a1', nome: 'Criativo A', ctr: 0.12, gasto: 89, porque: 'CTR crítico com R$ 89 gastos' },
      { ad_id: 'a2', nome: 'Criativo B', ctr: 0.08, gasto: 64, porque: 'Frequência 5,1×' },
    ],
  })], editavel: true });
  assert.match(html, /<details class="gtf-criativos"/, 'fechado por padrao');
  assert.match(html, /2 criativos sem tração/);
  assert.match(html, /CTR crítico com R\$ 89 gastos/, 'o motivo aparece: pausar nao pode ser pedido de fe');
  // O motivo ja traz os numeros da janela do robo. Repetir CTR ao lado, vindo
  // dos ultimos 30 dias, colocava dois valores diferentes na mesma linha.
  assert.ok(!/CTR 0,12%/.test(html), 'nao repete um CTR de outra janela');
  assert.match(html, /Pausar os 2/);
  assert.equal((html.match(/data-gtf-criativos/g) || []).length, 1, 'uma acao pra todos');
});

test('um criativo so fala no singular', () => {
  const html = monta({ pendentes: [item({ criativos: [{ ad_id: 'a1', nome: 'X', porque: 'y' }] })], editavel: true });
  assert.match(html, /1 criativo sem tração — ver qual/);
  assert.match(html, /Pausar o criativo/);
});

test('sem permissao nao mostra o botao de pausar criativos', () => {
  const html = monta({ pendentes: [item({ criativos: [{ ad_id: 'a1', nome: 'X' }] })], editavel: false });
  assert.match(html, /criativo sem tração/, 'mas continua vendo quais sao');
  assert.ok(!html.includes('data-gtf-criativos'));
});

test('campanha SO com criativos nao finge ser sugestao de verba', () => {
  const html = monta({ pendentes: [item({
    veredito: 'criativos', origem: 'criativos', budget_sugerido_centavos: null,
    justificativa: null, criativos: [{ ad_id: 'a1', nome: 'X', porque: 'y' }],
  })], editavel: true });
  assert.match(html, /Trocar criativos/);
  assert.ok(!html.includes('data-gtf-aprovar'), 'nao ha valor de orcamento pra aprovar');
});

test('nome de criativo e motivo sao escapados', () => {
  const html = monta({ pendentes: [item({ criativos: [{ ad_id: 'a1', nome: '<script>x</script>', porque: '<img src=y>' }] })] });
  assert.ok(!html.includes('<script>x'));
  assert.ok(!html.includes('<img src=y'));
});

// ── o FAROL de público (item 4 da lista do dono, 12/08/2026) ────────────────
// Fica FORA da lista de decisões: aparece mesmo com veredito 'manter' (pedido
// dele), e o contador da aba conta DECISÕES pendentes.

const leitura = (extra) => ({
  veredito: 'ajustar', titulo: 'Vale olhar a idade: 18 a 24 anos custa mais barato',
  frase: 'Nesta conta, a faixa 18-24 custa a partir de R$ 3,95 por resultado',
  contando: 'conversas iniciadas',
  faixas: [
    { faixa: '18-24', gasto: 430.14, resultados: 109, custo: 3.95, confiavel: true },
    { faixa: '65+', gasto: 1832.03, resultados: 137, custo: 13.37, confiavel: true },
  ],
  dinheiroEmFaixasCaras: 9683.8,
  fraseDoDinheiro: 'Nos últimos 90 dias, R$ 9.683,80 foram para faixas que custam mais caro.',
  receita: { idadeMin: 18, idadeMax: 24, cidades: [{ key: '1' }], interesses: [], porqueDosConjuntos: '' },
  alerta: 'Atenção: isto deixaria de fora 5 das 6 faixas de idade.',
  ...extra,
});

test('o farol mostra a tabela em REAIS, nao dividida por 100', () => {
  // A `reais()` da fila recebe CENTAVOS; estes numeros vem do Graph em reais.
  // Passar por ela mostraria R$ 4,30 onde sao R$ 430,14.
  const html = monta({ pendentes: [], carregou: true, leituraPublico: leitura() });
  assert.ok(html.includes('R$ 430,14'), 'o gasto da faixa sai em reais');
  assert.ok(!html.includes('R$ 4,30'), 'nao pode dividir por 100');
});

test('o farol DIZ a janela de 90 dias (o resto da fila fala de 30)', () => {
  const html = monta({ pendentes: [], carregou: true, leituraPublico: leitura() });
  assert.match(html, /últimos 90 dias/);
});

test('veredito "manter" APARECE — e sem receita nao oferece botao de usar', () => {
  const html = monta({ pendentes: [], carregou: true, leituraPublico: leitura({
    veredito: 'manter', titulo: 'O público desta conta está equilibrado',
    receita: null, alerta: '', dinheiroEmFaixasCaras: 0, fraseDoDinheiro: '',
  }) });
  assert.match(html, /equilibrado/);
  assert.ok(!html.includes('gtf-lp-usar'), 'sem receita nao ha o que levar pro editor');
});

test('o farol NAO vira item da lista (nao infla o que espera decisao)', () => {
  const html = monta({ pendentes: [], carregou: true, leituraPublico: leitura() });
  assert.match(html, /Nada esperando decisão/, 'a lista continua dizendo que esta vazia');
  assert.match(html, /Leitura de público/, 'e o farol aparece assim mesmo');
});

test('o farol diz que nao muda nada sozinho', () => {
  const html = monta({ pendentes: [], carregou: true, leituraPublico: leitura() });
  assert.match(html, /não muda nada sozinha/);
});

test('sem leitura o painel segue igual ao que era', () => {
  const html = monta({ pendentes: [], carregou: true });
  assert.ok(!html.includes('gtf-lp'), 'nada de bloco vazio');
});

test('texto da leitura tambem passa por escape', () => {
  const html = monta({ pendentes: [], carregou: true, leituraPublico: leitura({ titulo: '<script>alert(1)</script>' }) });
  assert.ok(!html.includes('<script>alert(1)</script>'));
});
