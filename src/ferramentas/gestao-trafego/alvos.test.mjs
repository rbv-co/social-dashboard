import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALVOS, alvoDoBalde, avaliarAlvo } from './alvos.js';

// REINDEXADO POR MERCADO em 25/09/2026 (Onda C, Tarefa 2). Os testes abaixo
// que citavam ALVOS.leads/.mensagens/.trafego/.vendas/.reconhecimento/
// .engajamento documentavam o índice ANTIGO (por balde = objetivo declarado).
// A medição de 25/09 mostrou que o objetivo mente sobre o que a campanha
// compra (ver mercados.js) — a régua passou a ser indexada por MERCADO, e
// esses testes foram reescritos para o índice novo, não "consertados" para o
// código velho continuar passando. Ver o cabeçalho de alvos.js para a
// correspondência completa balde -> mercado e o porquê de cada `chaveMeta`.

test('cada mercado tem alvo na unidade dele', () => {
  assert.equal(ALVOS.conversa.metrica, 'custo_conversa');
  assert.equal(ALVOS.perfil.metrica, 'custo_visita_perfil');
  assert.equal(ALVOS.video.metrica, 'custo_view');
  assert.equal(ALVOS.post.metrica, 'custo_engajamento');
  assert.equal(ALVOS.site_venda.metrica, 'cac');
  assert.equal(ALVOS.site_trafego.metrica, 'custo_visita');
  assert.equal(ALVOS.lead.metrica, 'custo_lead');
  assert.equal(ALVOS.reconhecimento.metrica, 'cpm');
});

test('desconhecido e misto não têm alvo — mercados.js os declara de propósito fora de MERCADOS', () => {
  // Não são mercados, são vereditos sobre AUSÊNCIA ou MULTIPLICIDADE de
  // mercado (ver mercados.js). Sem alvo, eles não recebem veredito de custo.
  assert.equal(alvoDoBalde('desconhecido'), null);
  assert.equal(alvoDoBalde('misto'), null);
});

test('ALVOS só tem as chaves de MERCADOS — nem uma a mais, nem uma a menos', () => {
  // Rodada de correção 3 (25/09/2026): 'lead' e 'reconhecimento' entraram em
  // MERCADOS (mercados.js) e ganham alvo aqui na mesma rodada.
  assert.deepEqual(Object.keys(ALVOS).sort(), [
    'conversa', 'perfil', 'post', 'site_trafego', 'site_venda', 'video', 'lead', 'reconhecimento',
  ].sort());
});

test('perfil mede pelo clique, nasce sem meta antiga pra herdar (mercado novo, 25/09/2026)', () => {
  assert.equal(ALVOS.perfil.resultado, 'visitas_perfil');
  assert.equal(ALVOS.perfil.chaveMeta, undefined,
    'perfil não existia como mercado antes desta onda — não há meta antiga pra herdar');
});

test('video mede por view, nasce sem meta antiga pra herdar (mercado novo, 25/09/2026)', () => {
  assert.equal(ALVOS.video.resultado, 'video_views');
  assert.equal(ALVOS.video.chaveMeta, undefined,
    'video não existia como mercado antes desta onda — não há meta antiga pra herdar');
});

test('post é o mais parecido com o antigo balde de engajamento, mas NÃO herda a meta dele', () => {
  // O antigo 'engajamento' misturava, por objetivo declarado, campanhas que
  // hoje são 'perfil' e 'video' — a meta `engajamento_bruto` foi calibrada
  // nessa mistura. Trazê-la para 'post' aplicaria um número calibrado para
  // outra coisa (spec 2026-09-25, seção 7, risco 3: "toda meta nova começa
  // vazia"). Por isso `post` lê a própria chave (`metas.post`), que hoje não
  // existe em nenhuma conta.
  assert.equal(ALVOS.post.resultado, 'engaj_pub');
  assert.equal(ALVOS.post.chaveMeta, undefined);
});

test('cinco mercados preservam a meta que o dono já calibrou, por chaveMeta', () => {
  // A prova de que reindexar não perdeu meta nenhuma: cada um destes mercados
  // é a MESMA coisa que o dono já vinha medindo com outro nome de balde, e a
  // chave antiga continua sendo a que `chaveMeta` aponta.
  assert.equal(ALVOS.conversa.chaveMeta, 'mensagens',
    'conversa é o antigo balde de WhatsApp/Direct — a meta dele mora em metas.mensagens');
  assert.equal(ALVOS.site_venda.chaveMeta, 'vendas',
    'site_venda é o antigo balde de venda — a meta dele mora em metas.vendas');
  assert.equal(ALVOS.site_trafego.chaveMeta, 'trafego',
    'site_trafego é o antigo balde de tráfego — a meta dele mora em metas.trafego');
  // Entraram na rodada de correção 3 (25/09/2026), junto com o sinal novo em
  // mercados.js:
  assert.equal(ALVOS.lead.chaveMeta, 'leads',
    'lead é o antigo balde de formulário/cadastro (plural) — a meta dele mora em metas.leads');
  assert.equal(ALVOS.reconhecimento.chaveMeta, 'reconhecimento',
    'reconhecimento tem o mesmo nome do balde antigo — chaveMeta declarado explicitamente mesmo assim');
});

test('a meta antiga é encontrada pela chave nova — prova de que o dono não perde o que calibrou', () => {
  // Simula o objeto `regua.metas` como ele está salvo HOJE no banco, com as
  // chaves de balde de antes desta onda — e prova que `chaveMeta` acha cada
  // uma a partir do MERCADO novo, sem o dono precisar recalibrar nada.
  const metasSalvasHoje = { mensagens: 12, vendas: 45, trafego: 3.5, leads: 22, reconhecimento: 8 };
  const chave = (mercado) => ALVOS[mercado].chaveMeta || mercado;
  assert.equal(metasSalvasHoje[chave('conversa')], 12);
  assert.equal(metasSalvasHoje[chave('site_venda')], 45);
  assert.equal(metasSalvasHoje[chave('site_trafego')], 3.5);
  assert.equal(metasSalvasHoje[chave('lead')], 22);
  assert.equal(metasSalvasHoje[chave('reconhecimento')], 8);
});

test('todo alvo tem rótulo e unidade em português para a tela', () => {
  for (const [mercado, a] of Object.entries(ALVOS)) {
    assert.ok(a.rotulo && a.rotulo.length > 3, mercado + ' sem rótulo');
    assert.ok(a.unidade, mercado + ' sem unidade');
    assert.ok(a.ajuda && a.ajuda.length > 10, mercado + ' sem explicação');
  }
});

test('alvoDoBalde devolve null para mercado sem alvo (nao inventa)', () => {
  assert.equal(alvoDoBalde('desconhecido'), null);
  assert.equal(alvoDoBalde('misto'), null);
  assert.equal(alvoDoBalde('mercado-que-nao-existe'), null);
  assert.equal(alvoDoBalde(undefined), null);
});

test('baldes de antes desta onda não indexam mais ALVOS direto', () => {
  // Documenta a troca (25/09/2026): estes nomes eram chave de ALVOS antes da
  // Onda C, e continuam SEM bater direto — a chave nova que existe agora é o
  // MERCADO ('lead', singular), não o balde antigo ('leads', plural).
  for (const antigo of ['engajamento', 'trafego', 'mensagens', 'leads', 'vendas']) {
    assert.equal(alvoDoBalde(antigo), null, antigo + ' não é mais chave direta de ALVOS');
  }
});

test('reconhecimento é EXCEÇÃO: o mercado novo tem o mesmo nome do balde antigo, então indexa ALVOS direto', () => {
  // Rodada de correção 3 (25/09/2026): diferente dos baldes do teste acima,
  // 'reconhecimento' virou mercado com o MESMO nome do balde que já existia —
  // não confundir com esquecimento de exclusão da lista anterior.
  assert.notEqual(alvoDoBalde('reconhecimento'), null);
  assert.equal(alvoDoBalde('reconhecimento').metrica, 'cpm');
});

test('avaliarAlvo compara custo com meta e devolve a faixa', () => {
  const lim = { escalarForte: 0.8, dentroMeta: 1.0, manter: 1.3 };
  assert.equal(avaliarAlvo({ custo: 8, meta: 10, limiares: lim }).faixa, 'escalar-forte');
  assert.equal(avaliarAlvo({ custo: 10, meta: 10, limiares: lim }).faixa, 'dentro-da-meta');
  assert.equal(avaliarAlvo({ custo: 13, meta: 10, limiares: lim }).faixa, 'manter');
  assert.equal(avaliarAlvo({ custo: 14, meta: 10, limiares: lim }).faixa, 'otimizar');
  assert.equal(avaliarAlvo({ custo: 8, meta: 10, limiares: lim }).indice, 0.8);
});

test('sem custo ou sem meta e SEM-DADOS, nunca um palpite', () => {
  const lim = { escalarForte: 0.8, dentroMeta: 1.0, manter: 1.3 };
  assert.equal(avaliarAlvo({ custo: null, meta: 10, limiares: lim }).faixa, 'sem-dados');
  assert.equal(avaliarAlvo({ custo: 5, meta: 0, limiares: lim }).faixa, 'sem-dados');
  assert.equal(avaliarAlvo({ custo: 5, meta: null, limiares: lim }).faixa, 'sem-dados');
  assert.equal(avaliarAlvo({}).faixa, 'sem-dados');
  assert.equal(avaliarAlvo({ custo: null, meta: 10, limiares: lim }).indice, null);
});

test('custo zero e resultado valido (de graca), nao ausencia', () => {
  const lim = { escalarForte: 0.8, dentroMeta: 1.0, manter: 1.3 };
  const r = avaliarAlvo({ custo: 0, meta: 10, limiares: lim });
  assert.equal(r.indice, 0);
  assert.equal(r.faixa, 'escalar-forte');
});
