import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, resolverLoja, payloadCampanhaAdset, lojasDoDestino, subirPorLoja, campanhaDoRastro } from './subir-estudio.mjs';

// --- campanhaDoRastro: a idempotência do destino 'nova' (B4, defeito 2) ------------------------
// Sem ela, o segundo clique em Publicar depois de um rate limit criava uma SEGUNDA campanha por
// loja na Meta. O filtro real (`payload->>campanhaId=eq.<uuid>`) foi conferido contra o banco em
// 12/08/2026 na rodada 975079c2: devolveu a linha do Tivoli e nada pro Dom Pedro.
const RASTROS = [
  { meta_campaign_id: '120249067134390342', loja: 'Tivoli (Santa Bárbara)', created_at: '2026-07-13T22:52:24Z' },
];

test('campanhaDoRastro: loja que já subiu nesta rodada é REAPROVEITADA (não duplica)', () => {
  assert.equal(campanhaDoRastro(RASTROS, 'Tivoli (Santa Bárbara)'), '120249067134390342');
});

test('campanhaDoRastro: loja que ainda não subiu volta null (aí sim cria)', () => {
  assert.equal(campanhaDoRastro(RASTROS, 'Shopping Dom Pedro'), null);
});

test('campanhaDoRastro: sem rastro nenhum não trava a subida (comportamento de antes)', () => {
  assert.equal(campanhaDoRastro([], 'Tivoli (Santa Bárbara)'), null);
  assert.equal(campanhaDoRastro(null, 'Tivoli (Santa Bárbara)'), null);
  assert.equal(campanhaDoRastro(undefined, 'Tivoli (Santa Bárbara)'), null);
});

test('campanhaDoRastro: linha sem meta_campaign_id é ignorada (rastro pela metade não reaproveita)', () => {
  const meia = [{ meta_campaign_id: null, loja: 'Tivoli (Santa Bárbara)' }, ...RASTROS];
  assert.equal(campanhaDoRastro(meia, 'Tivoli (Santa Bárbara)'), '120249067134390342');
});

test('campanhaDoRastro: nome de loja diferente NÃO casa (chave é rodada+loja, não o nome da campanha)', () => {
  assert.equal(campanhaDoRastro(RASTROS, 'Tivoli'), null);
});

test('lojasDoDestino: normaliza p/ [{slug, publico, orcamento}] (público por loja)', () => {
  // slugs (retrocompat) + público único da campanha
  assert.deepEqual(lojasDoDestino({ lojas: ['tivoli', 'dp'], publico: { g: 1 } }),
    [{ slug: 'tivoli', publico: { g: 1 }, orcamento: null }, { slug: 'dp', publico: { g: 1 }, orcamento: null }]);
  // público POR loja
  assert.deepEqual(lojasDoDestino({ lojas: [{ slug: 'tivoli', publico: { a: 1 } }, { slug: 'dp', publico: { b: 2 } }] }),
    [{ slug: 'tivoli', publico: { a: 1 }, orcamento: null }, { slug: 'dp', publico: { b: 2 }, orcamento: null }]);
  // single retrocompat
  assert.deepEqual(lojasDoDestino({ loja: 'tivoli' }), [{ slug: 'tivoli', publico: null, orcamento: null }]);
  assert.deepEqual(lojasDoDestino({}), []);
  assert.deepEqual(lojasDoDestino(null), []);
});

const MARCA = { adAccount: 'act_1', pageId: 'P', igId: 'IG' };
const LOJA = { nome: 'Tivoli', whatsapp: '5519...', geoCities: ['1058'] };
const CFG = { DAILY_BUDGET: 5000, DATA: '11-07-2026' };

test('nomes legíveis: campanha "Bolsas · loja · objetivo · dd/mm/aaaa", conjunto "loja · objetivo"', () => {
  const row = { chave: 'engajamento', rotulo: 'Engajamento (WhatsApp)', meta_objective: 'OUTCOME_ENGAGEMENT', optimization_goal: 'CONVERSATIONS', billing_event: 'IMPRESSIONS', destination_type: 'WHATSAPP', promoted_object_tipo: 'whatsapp' };
  const { campaign, adset } = payloadCampanhaAdset(row, MARCA, LOJA, { DAILY_BUDGET: 5000, DATA: '11-07-2026' });
  assert.equal(campaign.name, 'Bolsas · Tivoli · Engajamento (WhatsApp) · 11/07/2026');
  assert.equal(adset.name, 'Tivoli · Engajamento (WhatsApp)');
  // sem rótulo cai na chave (retrocompat)
  const { campaign: c2 } = payloadCampanhaAdset({ ...row, rotulo: null }, MARCA, LOJA, { DAILY_BUDGET: 5000, DATA: '01-01-2026' });
  assert.equal(c2.name, 'Bolsas · Tivoli · engajamento · 01/01/2026');
});

test('payloadCampanhaAdset: engajamento -> OUTCOME_ENGAGEMENT + CONVERSATIONS + WHATSAPP + promoted whatsapp', () => {
  const row = { chave: 'engajamento', meta_objective: 'OUTCOME_ENGAGEMENT', optimization_goal: 'CONVERSATIONS', billing_event: 'IMPRESSIONS', destination_type: 'WHATSAPP', promoted_object_tipo: 'whatsapp' };
  const { campaign, adset } = payloadCampanhaAdset(row, MARCA, LOJA, CFG);
  assert.equal(campaign.objective, 'OUTCOME_ENGAGEMENT');
  assert.equal(campaign.status, 'PAUSED');
  assert.equal(adset.optimization_goal, 'CONVERSATIONS');
  assert.equal(adset.destination_type, 'WHATSAPP');
  assert.deepEqual(adset.promoted_object, { page_id: 'P', whatsapp_phone_number: '5519...' });
  assert.equal(adset.status, 'PAUSED');
});

test('payloadCampanhaAdset: branding -> OUTCOME_AWARENESS + REACH + sem destination_type + sem promoted_object', () => {
  const row = { chave: 'branding', meta_objective: 'OUTCOME_AWARENESS', optimization_goal: 'REACH', billing_event: 'IMPRESSIONS', destination_type: null, promoted_object_tipo: 'none' };
  const { campaign, adset } = payloadCampanhaAdset(row, MARCA, LOJA, CFG);
  assert.equal(campaign.objective, 'OUTCOME_AWARENESS');
  assert.equal(adset.optimization_goal, 'REACH');
  assert.ok(!('destination_type' in adset) || adset.destination_type == null);
  assert.ok(!('promoted_object' in adset) || adset.promoted_object === undefined);
});

test('payloadCampanhaAdset aplica o publico no targeting (cidades+raio+interesses)', () => {
  const row = { chave: 'engajamento', meta_objective: 'OUTCOME_ENGAGEMENT', optimization_goal: 'CONVERSATIONS', billing_event: 'IMPRESSIONS', destination_type: 'WHATSAPP', promoted_object_tipo: 'whatsapp' };
  const marca = { adAccount: 'act_1', pageId: 'P', igId: 'IG' };
  const loja = { nome: 'Tivoli', whatsapp: '55', geoCities: ['1058'] };
  const publico = { geo: { cities: [{ key: '1058', radius: 15, distance_unit: 'kilometer' }] }, interesses: [{ id: '6003', name: 'Moda' }], generos: [2], idade_min: 25, idade_max: 45 };
  const { adset } = payloadCampanhaAdset(row, marca, loja, { DAILY_BUDGET: 5000, DATA: 'X' }, publico);
  // SP-4 fix: montarTargeting faz clamp do raio pro mínimo do Meta (15 -> 17km)
  assert.deepEqual(adset.targeting.geo_locations.cities, [{ key: '1058', radius: 17, distance_unit: 'kilometer' }]);
  assert.deepEqual(adset.targeting.flexible_spec, [{ interests: [{ id: '6003', name: 'Moda' }] }]);
  assert.equal(adset.targeting.age_min, 25);
});

test('payloadCampanhaAdset sem publico mantém geo da loja (retrocompat)', () => {
  const row = { chave: 'engajamento', meta_objective: 'OUTCOME_ENGAGEMENT', optimization_goal: 'CONVERSATIONS', billing_event: 'IMPRESSIONS', destination_type: 'WHATSAPP', promoted_object_tipo: 'whatsapp' };
  const { adset } = payloadCampanhaAdset(row, { adAccount: 'act_1', pageId: 'P' }, { nome: 'T', whatsapp: '55', geoCities: ['1058'] }, { DAILY_BUDGET: 5000, DATA: 'X' });
  assert.deepEqual(adset.targeting, { geo_locations: { cities: [{ key: '1058' }] } });
});

test('run() exportada', () => { assert.equal(typeof run, 'function'); });

test('resolverLoja com slug vazio/undefined não casa nenhuma loja (evita fallback silencioso pra 1ª ativa)', () => {
  const lojas = [
    { ativo: true, nome: 'Tivoli' },
    { ativo: true, nome: 'Dom Pedro' },
  ];
  assert.equal(resolverLoja(lojas, ''), undefined);
  assert.equal(resolverLoja(lojas, undefined), undefined);
  assert.equal(resolverLoja(lojas, null), undefined);
  // sanity: slug válido continua casando normalmente
  assert.equal(resolverLoja(lojas, 'tivoli').nome, 'Tivoli');
});

test('run({dry:true}) sem escolhidos retorna adIds vazio', async () => {
  const r = await run({ campanhaId: '00000000-0000-0000-0000-000000000000', destino: { tipo: 'nova', loja: 'tivoli' }, dry: true });
  assert.deepEqual(r.adIds, []);
  assert.equal(r.pendentes, 0);
  assert.equal(r.metaCampaignId, null);
});

test('lojasDoDestino inclui orcamento por loja (default null)', () => {
  assert.deepEqual(
    lojasDoDestino({ lojas: [{ slug: 'tivoli', publico: { a: 1 }, orcamento: { modo: 'CBO', tipo: 'diario', valor: 9000 } }] }),
    [{ slug: 'tivoli', publico: { a: 1 }, orcamento: { modo: 'CBO', tipo: 'diario', valor: 9000 } }]);
  // slugs (retrocompat): orcamento null
  assert.deepEqual(lojasDoDestino({ lojas: ['dp'] }), [{ slug: 'dp', publico: null, orcamento: null }]);
});

test('payloadCampanhaAdset sem orcamento = ABO diario DAILY_BUDGET (retrocompat byte-idêntico)', () => {
  const row = { chave: 'engajamento', meta_objective: 'OUTCOME_ENGAGEMENT', optimization_goal: 'CONVERSATIONS', billing_event: 'IMPRESSIONS', destination_type: 'WHATSAPP', promoted_object_tipo: 'whatsapp' };
  const { campaign, adset } = payloadCampanhaAdset(row, MARCA, LOJA, CFG);
  assert.equal(adset.daily_budget, 5000);
  assert.ok(!('lifetime_budget' in adset));
  assert.ok(!('daily_budget' in campaign));
  assert.equal(campaign.is_adset_budget_sharing_enabled, false);
});

test('payloadCampanhaAdset CBO diario -> budget na campanha, adset sem budget', () => {
  const row = { chave: 'engajamento', meta_objective: 'OUTCOME_ENGAGEMENT', optimization_goal: 'CONVERSATIONS', billing_event: 'IMPRESSIONS', destination_type: 'WHATSAPP', promoted_object_tipo: 'whatsapp' };
  const { campaign, adset } = payloadCampanhaAdset(row, MARCA, LOJA, CFG, null, { modo: 'CBO', tipo: 'diario', valor: 12000 });
  assert.equal(campaign.daily_budget, 12000);
  assert.ok(!('daily_budget' in adset));
});

test('payloadCampanhaAdset ABO total -> lifetime + datas no adset', () => {
  const row = { chave: 'engajamento', meta_objective: 'OUTCOME_ENGAGEMENT', optimization_goal: 'CONVERSATIONS', billing_event: 'IMPRESSIONS', destination_type: 'WHATSAPP', promoted_object_tipo: 'whatsapp' };
  const { campaign, adset } = payloadCampanhaAdset(row, MARCA, LOJA, CFG, null, { modo: 'ABO', tipo: 'total', valor: 30000, inicio: 'I', fim: 'F' });
  assert.equal(adset.lifetime_budget, 30000);
  assert.equal(adset.start_time, 'I');
  assert.equal(adset.end_time, 'F');
  assert.ok(!('daily_budget' in adset));
  assert.ok(!('lifetime_budget' in campaign));
});

// --- subirPorLoja(): O LAÇO MULTI-LOJA ---------------------------------------------------------
// Este é o laço que a pendência B4 acusava ("gerei e subiu só do Tivoli, faltou Dom Pedro"). Medido
// em 12/08 no banco: o laço nunca perdeu loja — quando subiu uma só, o destino já chegava com uma
// só. O que ele TEM de errado é abortar na primeira falha: a campanha da loja anterior já existe de
// verdade na Meta e some do resultado (money-path). Mesma lição que o ativar-estudio.mjs já
// aprendeu. Seams injetáveis (criar/subir) — nenhuma chamada ao Graph aqui.
const LOJAS_CFG = [
  { nome: 'Tivoli (Santa Bárbara)', ativo: true, marca: { adAccount: 'act_1', nome: 'La Vessel' } },
  { nome: 'Shopping Dom Pedro', ativo: true, marca: { adAccount: 'act_1', nome: 'La Vessel' } },
];
const OBJ = { chave: 'engajamento', meta_objective: 'OUTCOME_ENGAGEMENT' };

test('subirPorLoja: 2 lojas -> 2 campanhas, cada uma com o público e o orçamento DELA', async () => {
  const criadas = [];
  const criar = async (loja, objetivoRow, publico, orcamento) => {
    criadas.push({ loja: loja.nome, publico, orcamento });
    return { campaignId: 'c' + criadas.length, adsets: [{ id: 's' + criadas.length }] };
  };
  const subir = async ({ metaCampaignId, adsets, lojaNome }) =>
    ({ adIds: [metaCampaignId + '-ad'], pendentes: 0, metaCampaignId, adsetIds: adsets.map((a) => a.id), lojaNome });

  const r = await subirPorLoja({
    alvosLoja: [
      { slug: 'tivoli', publico: { a: 1 }, orcamento: { valor: 5000 } },
      { slug: 'dp', publico: { b: 2 }, orcamento: { valor: 8000 } },
    ],
    lojas: LOJAS_CFG, objetivoRow: OBJ, criar, subir, log: () => {},
  });

  assert.deepEqual(criadas, [
    { loja: 'Tivoli (Santa Bárbara)', publico: { a: 1 }, orcamento: { valor: 5000 } },
    { loja: 'Shopping Dom Pedro', publico: { b: 2 }, orcamento: { valor: 8000 } },
  ]);
  assert.deepEqual(r.resultados.map((x) => x.metaCampaignId), ['c1', 'c2']);
  assert.deepEqual(r.falhas, []);
});

test('subirPorLoja: falha na loja 2 NÃO aborta e NÃO perde a campanha da loja 1', async () => {
  // Money-path: a campanha da loja 1 já existe na Meta. Se o erro da loja 2 propagar, o runner grava
  // só `erro` e o `resultado` some — o Conferir e o Ativar param de enxergar a campanha que subiu.
  const criar = async (loja) => {
    if (loja.nome === 'Shopping Dom Pedro') throw new Error('(#100) Invalid parameter: promoted_object');
    return { campaignId: 'c1', adsets: [{ id: 's1' }] };
  };
  const subir = async ({ metaCampaignId, adsets }) =>
    ({ adIds: ['a1'], pendentes: 0, metaCampaignId, adsetIds: adsets.map((a) => a.id) });

  const r = await subirPorLoja({
    alvosLoja: [{ slug: 'tivoli', publico: null, orcamento: null }, { slug: 'dp', publico: null, orcamento: null }],
    lojas: LOJAS_CFG, objetivoRow: OBJ, criar, subir, log: () => {},
  });

  assert.deepEqual(r.resultados.map((x) => x.metaCampaignId), ['c1']);
  assert.equal(r.falhas.length, 1);
  assert.equal(r.falhas[0].loja, 'Shopping Dom Pedro');
  assert.match(r.falhas[0].erro, /promoted_object/);
});

test('subirPorLoja: loja que não existe no cadastro vira falha, não derruba as outras', async () => {
  const criar = async () => ({ campaignId: 'c1', adsets: [{ id: 's1' }] });
  const subir = async ({ metaCampaignId, adsets }) =>
    ({ adIds: ['a1'], pendentes: 0, metaCampaignId, adsetIds: adsets.map((a) => a.id) });

  const r = await subirPorLoja({
    alvosLoja: [{ slug: 'loja-que-nao-existe' }, { slug: 'tivoli' }],
    lojas: LOJAS_CFG, objetivoRow: OBJ, criar, subir, log: () => {},
  });

  assert.deepEqual(r.resultados.map((x) => x.metaCampaignId), ['c1']);
  assert.equal(r.falhas.length, 1);
  assert.equal(r.falhas[0].loja, 'loja-que-nao-existe');
});

test('subirPorLoja: TODAS as lojas falharem lança — job não pode dizer "concluído" sem nada subir', async () => {
  const criar = async () => { throw new Error('sem ads_management'); };
  await assert.rejects(
    subirPorLoja({
      alvosLoja: [{ slug: 'tivoli' }, { slug: 'dp' }],
      lojas: LOJAS_CFG, objetivoRow: OBJ, criar, subir: async () => ({}), log: () => {},
    }),
    /nenhuma loja subiu/,
  );
});

test('subirPorLoja: registra uma linha de log POR loja subida', async () => {
  const linhas = [];
  const criar = async (loja) => ({ campaignId: 'c-' + loja.nome.slice(0, 3), adsets: [{ id: 's1' }] });
  const subir = async ({ metaCampaignId, adsets }) =>
    ({ adIds: ['a1', 'a2'], pendentes: 0, metaCampaignId, adsetIds: adsets.map((a) => a.id) });

  await subirPorLoja({
    alvosLoja: [{ slug: 'tivoli' }, { slug: 'dp' }],
    lojas: LOJAS_CFG, objetivoRow: OBJ, criar, subir, log: (m) => linhas.push(m),
  });

  assert.equal(linhas.length, 2);
  assert.match(linhas[0], /Tivoli/);
  assert.match(linhas[1], /Dom Pedro/);
});
