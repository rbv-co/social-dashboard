import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { semComentarios } from '../../compartilhado/guarda-de-imports.mjs';
import { GT_METRIC_CATALOG, GT_BALDE_PADRAO, custoDoAlvo } from './metricas.js';

// Um insight com número redondo em cada métrica, pra conta errada aparecer.
const INS = {
  spend: '1000', impressions: '50000', clicks: '800', ctr: '1.6', cpc: '1.25',
  reach: '25000', frequency: '2',
  actions: [
    { action_type: 'lead', value: '40' },
    { action_type: 'landing_page_view', value: '500' },
    { action_type: 'link_click', value: '800' },
    { action_type: 'post_engagement', value: '2000' },
    { action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '100' },
    { action_type: 'purchase', value: '20' },
    // Acrescentado 25/09/2026 (Onda C): view de vídeo, pro mercado `video`
    // (custo_view) ter o que calcular neste mesmo insight redondo.
    { action_type: 'video_view', value: '400' },
  ],
  action_values: [{ action_type: 'purchase', value: '5000' }],
};

const calc = (k) => GT_METRIC_CATALOG[k].compute(INS);

test('o catálogo calcula o que a tela sempre calculou', () => {
  assert.equal(calc('leads'), 40);
  assert.equal(calc('custo_lead'), 25);          // 1000 / 40
  assert.equal(calc('visitas'), 500);            // landing_page_view ganha de link_click
  assert.equal(calc('custo_visita'), 2);         // 1000 / 500
  assert.equal(calc('cpm'), 20);                 // 1000 / 50000 * 1000
  assert.equal(calc('conversas'), 100);
  assert.equal(calc('custo_conversa'), 10);      // 1000 / 100
  assert.equal(calc('compras'), 20);
  assert.equal(calc('cac'), 50);                 // 1000 / 20
  assert.equal(calc('valor_conversao'), 5000);
  assert.equal(calc('roas'), 5);                 // 5000 / 1000, sem purchase_roas
  assert.equal(calc('engaj_pub'), 2000);
  assert.equal(calc('custo_engajamento'), 0.5); // 1000 / 2000
  assert.equal(calc('alcance'), 25000);
  assert.equal(calc('frequencia'), 2);
  assert.equal(calc('gasto'), 1000);
});

test('custo por engajamento é o gasto dividido pelo engajamento bruto', () => {
  assert.equal(GT_METRIC_CATALOG.custo_engajamento.compute(INS), 0.5); // 1000 / 2000
});

test('campanha de perfil mede pelo clique, não pelo resíduo de landing_page_view', () => {
  // O BUG (achado em 25/09): _GT_VISIT é ['landing_page_view','link_click'] e
  // _gtActionVal devolve o PRIMEIRO que existir. No [SEGUIDORES][REMARKETING] da
  // Raíssa, landing_page_view=1 (resíduo) e link_click=3203 — o custo por visita
  // saía R$ 247,45 (1455× a meta) em vez de R$ 0,09. Não era falta de dado: era
  // a ordem da lista.
  const ins = { spend: '283.84', actions: [
    { action_type: 'landing_page_view', value: '1' },
    { action_type: 'link_click', value: '3203' },
  ] };
  const v = GT_METRIC_CATALOG.custo_visita_perfil.compute(ins);
  assert.ok(Math.abs(v - 0.0886) < 0.001, `esperava ~R$ 0,09 por clique, veio ${v}`);
});

test('sem engajamento na janela o custo é null, nunca zero', () => {
  assert.equal(GT_METRIC_CATALOG.custo_engajamento.compute({ spend: '300', actions: [] }), null,
    'R$ 0,00 por engajamento seria lido pelo modelo como "de graça"');
});

test('ação que a Meta omitiu vira null, nunca zero', () => {
  // A Meta OMITE o action_type inteiro quando a contagem é zero.
  const vazio = { spend: '500', actions: [] };
  assert.equal(GT_METRIC_CATALOG.leads.compute(vazio), null);
  assert.equal(GT_METRIC_CATALOG.custo_lead.compute(vazio), null,
    'custo com zero lead precisa ser null: R$ 0,00 seria lido como "de graça"');
  assert.equal(GT_METRIC_CATALOG.custo_conversa.compute(vazio), null);
});

test('insight sem o array actions não derruba o cálculo', () => {
  assert.equal(GT_METRIC_CATALOG.leads.compute({ spend: '10' }), null);
  assert.equal(GT_METRIC_CATALOG.roas.compute({ spend: '10' }), null);
});

// REINDEXADO POR MERCADO em 25/09/2026 (Onda C, Tarefa 2). Os testes abaixo
// chamavam `custoDoAlvo` com nome de BALDE ('leads', 'vendas', 'trafego',
// 'mensagens', 'reconhecimento', 'engajamento') — o índice antigo, por
// objetivo declarado. Agora `custoDoAlvo` recebe MERCADO (ver mercados.js e
// o cabeçalho de alvos.js); os nomes mudaram, reescritos aqui, não
// "consertados" pra continuar aceitando o nome velho.
test('custoDoAlvo devolve o custo na unidade de cada mercado', () => {
  assert.equal(custoDoAlvo('site_venda', INS), 50);        // CAC
  assert.equal(custoDoAlvo('site_trafego', INS), 2);       // custo por visita (landing_page_view=500)
  assert.equal(custoDoAlvo('conversa', INS), 10);          // custo por conversa (lead do WhatsApp)
  assert.equal(custoDoAlvo('perfil', INS), 1.25);          // custo por visita ao perfil, 1000/800 cliques
  assert.equal(custoDoAlvo('video', INS), 2.5);            // custo por view, 1000/400
  assert.equal(custoDoAlvo('post', INS), 0.5);             // custo por engajamento, 1000/2000
});

test('mercado sem sinal em mercados.js (reconhecimento, leads-formulário) fica sem alvo', () => {
  // 'reconhecimento' (awareness/CPM) e 'leads' (LEAD_GENERATION) eram baldes
  // com alvo antes desta onda. A tabela de mercados de mercados.js (Tarefa 1
  // da Onda C) não emite sinal pra nenhum dos dois ainda — não é bug desta
  // tarefa, é fronteira: sem mercado, sem alvo, sem veredito inventado.
  assert.equal(custoDoAlvo('reconhecimento', INS), null);
  assert.equal(custoDoAlvo('leads', INS), null);
});

test('mercado sem alvo (desconhecido, misto) não inventa número', () => {
  assert.equal(custoDoAlvo('desconhecido', INS), null);
  assert.equal(custoDoAlvo('misto', INS), null);
  assert.equal(custoDoAlvo('padrao', INS), null);
  assert.equal(custoDoAlvo('mercado-que-nao-existe', INS), null);
  assert.equal(custoDoAlvo(undefined, INS), null);
});

test('sem resultado na janela o custo é null, nunca zero', () => {
  const semNada = { spend: '900', actions: [] };
  assert.equal(custoDoAlvo('conversa', semNada), null,
    'R$ 0,00 no prompt seria lido como "de graça" e viraria escalar');
  assert.equal(custoDoAlvo('site_venda', semNada), null);
});

test('gasto zero não vira custo zero', () => {
  // Trocado de 'leads' (sem alvo desde a reindexação por mercado, 25/09/2026)
  // para 'site_venda', que tem alvo de verdade (cac) — senão o teste passaria
  // só porque o mercado não existe, e não porque a guarda de gasto zero funciona.
  const semGasto = { spend: '0', actions: [{ action_type: 'purchase', value: '5' }] };
  assert.equal(custoDoAlvo('site_venda', semGasto), null);
});

test('todo balde aponta só para métricas que existem no catálogo', () => {
  for (const [balde, chaves] of Object.entries(GT_BALDE_PADRAO)) {
    for (const k of chaves) {
      assert.ok(GT_METRIC_CATALOG[k], `${balde} aponta para "${k}", que não existe no catálogo`);
    }
  }
});

test('a tela não tem mais a sua própria cópia do catálogo', () => {
  const aqui = dirname(fileURLToPath(import.meta.url));
  const vue = readFileSync(join(aqui, 'tela-de-gestao-trafego.vue'), 'utf8');
  assert.ok(!/const\s+GT_METRIC_CATALOG\s*=/.test(vue),
    'a tela redefine GT_METRIC_CATALOG: duas fontes acabam discordando');
  assert.ok(!/function\s+_gtActionVal\s*\(/.test(vue),
    'a tela redefine _gtActionVal: duas fontes acabam discordando');
  assert.ok(/from '\.\/metricas\.js'/.test(vue), 'a tela precisa importar de metricas.js');
});

// O DEFEITO REAL (24/09/2026): o brief desta tarefa mandou importar 15 nomes
// (_gtNum, _gtActionVal, _GT_* etc.) que só eram usados DENTRO do próprio
// bloco que saiu do .vue no passo 5 — contados antes da extração, quando
// ainda viviam lá dentro. Depois de mover pra metricas.js a tela não chamava
// nenhum deles direto (só GT_METRIC_CATALOG e GT_BALDE_PADRAO), e ninguém
// percebeu porque `npm test` não tinha nada que provasse "todo import serve
// pra algo". Ao mesmo tempo, ensinar o guarda de globais a aceitar `import`
// como declaração (rodada de correção 1) abriu outro buraco: aquele teste
// nunca conferiu se o nome importado EXISTE de verdade em metricas.js — só
// que ele "nasceu" de algum jeito no arquivo.
//
// Este teste fecha as duas pontas: todo nome que a tela importa de
// metricas.js precisa (a) existir como export lá, e (b) ser usado no corpo
// da tela — senão é import morto, e import morto é exatamente o tipo de
// coisa que ninguém nota até o dia em que o nome errado entra no lugar certo.
test('a tela só importa de metricas.js o que o módulo exporta e o que ela usa', () => {
  const aqui = dirname(fileURLToPath(import.meta.url));
  const vue = readFileSync(join(aqui, 'tela-de-gestao-trafego.vue'), 'utf8');
  const metricas = readFileSync(join(aqui, 'metricas.js'), 'utf8');

  // Todos os blocos <script>, ainda COM comentário e string intactos — o
  // `semComentarios` do guarda apaga o texto entre aspas (vira `''`), e o
  // caminho `'./metricas.js'` do import é justamente uma string.
  const scriptBruto = [...vue.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');

  const imp = scriptBruto.match(/import\s*\{([^}]+)\}\s*from\s*'\.\/metricas\.js'/);
  assert.ok(imp, 'a tela não tem mais um import de metricas.js — atualize este teste');
  const importados = imp[1].split(',').map((s) => s.trim()).filter(Boolean)
    .map((s) => s.split(/\s+as\s+/).pop());

  // 1) todo nome importado precisa EXISTIR como export em metricas.js — é a
  // rede que o guarda de globais perdeu quando passou a aceitar `import` como
  // declaração (rodada de correção 1): ele nunca confere se o módulo de fato
  // exporta o nome, só que o nome "nasceu" de algum jeito no arquivo.
  const exportados = new Set(
    [...metricas.matchAll(/export\s+(?:async\s+)?(?:function|const|let|var)\s+(\w+)/g)].map((m) => m[1]),
  );
  const inexistentes = importados.filter((nome) => !exportados.has(nome));
  assert.deepEqual(inexistentes, [],
    `a tela importa ${inexistentes.join(', ')} de metricas.js, mas o módulo não exporta esse(s) nome(s)`);

  // 2) todo nome importado precisa ser USADO no corpo da tela — senão é
  // import morto, e foi exatamente assim que 15 dos 17 nomes ficaram de graça
  // na extração original (o brief contou os usos ANTES de o bloco sair do
  // .vue; depois de sair, sobrou só o import). Descarta a PRÓPRIA linha do
  // import antes de procurar — sem isto o nome se conta a si mesmo dentro da
  // lista que ele mesmo declara, e o teste passa sempre — e tira comentário
  // do que sobrou, porque MENCIONAR o nome num comentário não é usá-lo.
  const semImport = scriptBruto.slice(0, imp.index) + scriptBruto.slice(imp.index + imp[0].length);
  const corpo = semComentarios(semImport);
  const semUso = importados.filter((nome) => !new RegExp(`\\b${nome}\\b`).test(corpo));
  assert.deepEqual(semUso, [],
    `a tela importa ${semUso.join(', ')} de metricas.js e nunca usa — import morto`);
});
