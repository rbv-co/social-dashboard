import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lerPublico, PUBLICO_VAZIO, montarTargeting, resumoDasMudancas, avisosDe, CHAVES_DE_LOCALIZACAO } from './publico-alvo.js';

// Forma real devolvida pela Meta (campos conferidos em coletor/lib/publico.mjs).
const ALVO_META = {
  geo_locations: { cities: [{ key: '1058', name: 'Campinas', radius: 25, distance_unit: 'kilometer' }] },
  excluded_geo_locations: { cities: [{ key: '2777', name: 'Americana' }], regions: [{ key: '456', name: 'Litoral' }] },
  age_min: 25,
  age_max: 45,
  genders: [2],
  flexible_spec: [{ interests: [{ id: '6003', name: 'Moda' }] }],
  custom_audiences: [{ id: 'aud1', name: 'Visitantes do site' }],
  excluded_custom_audiences: [{ id: 'aud2', name: 'Já compraram' }],
  targeting_automation: { advantage_audience: 0 },
  // NÃO gerenciados por este editor — presentes de propósito:
  publisher_platforms: ['facebook', 'instagram'],
  instagram_positions: ['stream', 'story'],
};

// O CONJUNTO COMO ELE É NA CONTA DE VERDADE — não como o editor gostaria que
// fosse. O ALVO_META acima foi montado a partir dos campos que o editor
// gerencia, e é exatamente por isso que a bateria ficou verde durante quatro
// perdas silenciosas de dados. Este aqui carrega o que a Meta manda de fato:
//   • location_types  → em quase todo conjunto criado no Gerenciador, e NÃO é lugar;
//   • exclusão por ponto no mapa (custom_locations) e por CEP, que o editor não desenha;
//   • cidade excluída COM raio e unidade (excluir 25 km em volta ≠ excluir a mancha urbana);
//   • flexible_spec com uma entrada MISTA (interesse + comportamento juntos) e
//     uma segunda entrada só de interesse — as duas entradas se somam com E;
//   • NENHUM targeting_automation, que é o caso em que "ligado" é palpite.
//
// SEM `name` nas entradas de lugar de propósito: nome de cidade é eco de
// leitura da Meta, o editor nunca manda nome de volta na escrita (mandar um
// campo que ninguém conferiu numa conta ao vivo seria trocar um risco por
// outro). O que TEM que sobreviver é chave, raio, unidade e tudo que o editor
// não gerencia — e é isso que a invariante abaixo cobra.
const ALVO_REALISTA = {
  geo_locations: {
    cities: [{ key: '1058', radius: 25, distance_unit: 'kilometer' }],
    location_types: ['home', 'recent'],
  },
  excluded_geo_locations: {
    custom_locations: [{ latitude: -22.9, longitude: -47.06, radius: 10, distance_unit: 'kilometer' }],
    zips: [{ key: 'BR:13000' }],
    cities: [{ key: '2777', radius: 25, distance_unit: 'kilometer' }],
  },
  age_min: 25,
  age_max: 45,
  genders: [2],
  flexible_spec: [
    { interests: [{ id: '6003', name: 'Moda' }], behaviors: [{ id: 'b1', name: 'Viajantes' }] },
    { interests: [{ id: '6004', name: 'Luxo' }] },
  ],
  custom_audiences: [{ id: 'aud1' }],
  excluded_custom_audiences: [{ id: 'aud2' }],
  publisher_platforms: ['facebook', 'instagram'],
  device_platforms: ['mobile'],
  locales: [6],
};

// Públicos dos testes de Advantage+ precisam de uma localização para isolar o
// comportamento do Advantage+ da regra de localização (que bloqueia sem cidades).
// Sem isso, testes medem duas coisas ao mesmo tempo.
const COM_CIDADE = { ...PUBLICO_VAZIO, cidades: [{ key: '1058', nome: 'Campinas', raio: 0, unidade: 'kilometer' }] };

test('le todos os campos que o editor gerencia', () => {
  const p = lerPublico(ALVO_META);
  assert.deepEqual(p.cidades, [{ key: '1058', nome: 'Campinas', raio: 25, unidade: 'kilometer' }]);
  assert.equal(p.idadeMin, 25);
  assert.equal(p.idadeMax, 45);
  assert.deepEqual(p.generos, [2]);
  assert.deepEqual(p.interesses, [{ id: '6003', name: 'Moda' }]);
  assert.deepEqual(p.incluir, [{ id: 'aud1', name: 'Visitantes do site' }]);
  assert.deepEqual(p.excluir, [{ id: 'aud2', name: 'Já compraram' }]);
});

test('cidade e regiao excluidas vem separadas por tipo', () => {
  const p = lerPublico(ALVO_META);
  assert.deepEqual(p.excluidas, [
    { key: '2777', nome: 'Americana', tipo: 'cidade' },
    { key: '456', nome: 'Litoral', tipo: 'regiao' },
  ]);
});

test('advantage_audience 0 e desligado; 1 e ausente sao ligado', () => {
  assert.equal(lerPublico({ targeting_automation: { advantage_audience: 0 } }).advantagePlus, false);
  assert.equal(lerPublico({ targeting_automation: { advantage_audience: 1 } }).advantagePlus, true);
  // Ausente = padrão da Meta, que é LIGADO. Assumir desligado faria a tela
  // mentir sobre o estado atual da conta do dono.
  assert.equal(lerPublico({}).advantagePlus, true);
});

test('interesses saem de qualquer entrada do flexible_spec, nao so da primeira', () => {
  const p = lerPublico({ flexible_spec: [
    { behaviors: [{ id: 'b1', name: 'Viajantes' }] },
    { interests: [{ id: '1', name: 'Bolsas' }, { id: '2', name: 'Moda' }] },
  ] });
  assert.deepEqual(p.interesses, [{ id: '1', name: 'Bolsas' }, { id: '2', name: 'Moda' }]);
});

test('publico ausente, vazio ou malformado nao quebra', () => {
  for (const entrada of [null, undefined, {}, { geo_locations: null }, { flexible_spec: 'lixo' }]) {
    const p = lerPublico(entrada);
    assert.deepEqual(p.cidades, []);
    assert.deepEqual(p.interesses, []);
    assert.equal(typeof p.idadeMin, 'number');
  }
});

test('PUBLICO_VAZIO tem a forma completa, sem campo faltando', () => {
  for (const chave of ['cidades','excluidas','idadeMin','idadeMax','generos','interesses','incluir','excluir','advantagePlus'])
    assert.ok(chave in PUBLICO_VAZIO, 'faltou ' + chave);
});

test('null em geo_locations.cities nao quebra, entrada valida ao lado sobrevive', () => {
  const p = lerPublico({ geo_locations: { cities: [null, { key: '123', name: 'Válida' }, null] } });
  assert.deepEqual(p.cidades, [{ key: '123', nome: 'Válida', raio: 0, unidade: 'kilometer' }]);
});

test('null em excluded_geo_locations (cities e regions) nao quebra', () => {
  const p = lerPublico({ excluded_geo_locations: { cities: [null, { key: '1', name: 'São Paulo' }], regions: [{ key: '2', name: 'Valid' }, null] } });
  assert.deepEqual(p.excluidas, [
    { key: '1', nome: 'São Paulo', tipo: 'cidade' },
    { key: '2', nome: 'Valid', tipo: 'regiao' },
  ]);
});

test('null em custom_audiences e excluded_custom_audiences nao quebra', () => {
  const p = lerPublico({ custom_audiences: [null, { id: 'a1', name: 'Aud1' }], excluded_custom_audiences: [{ id: 'a2', name: 'Aud2' }, null] });
  assert.deepEqual(p.incluir, [{ id: 'a1', name: 'Aud1' }]);
  assert.deepEqual(p.excluir, [{ id: 'a2', name: 'Aud2' }]);
});

test('null em flexible_spec nao quebra', () => {
  const p = lerPublico({ flexible_spec: [null, { interests: [null, { id: '1', name: 'Ok' }] }] });
  assert.deepEqual(p.interesses, [{ id: '1', name: 'Ok' }]);
});

test('age_min e age_max invalidos (NaN) recebem os valores padrao', () => {
  const p = lerPublico({ age_min: 'abc', age_max: null });
  assert.equal(p.idadeMin, PUBLICO_VAZIO.idadeMin);
  assert.equal(p.idadeMax, PUBLICO_VAZIO.idadeMax);

  const p2 = lerPublico({ age_min: {}, age_max: 'xyz' });
  assert.equal(p2.idadeMin, PUBLICO_VAZIO.idadeMin);
  assert.equal(p2.idadeMax, PUBLICO_VAZIO.idadeMax);
});

test('CAMPO DESCONHECIDO SOBREVIVE A IDA E VOLTA — o teste que segura tudo', () => {
  const original = {
    ...ALVO_META,
    device_platforms: ['mobile'],
    locales: [6],
    algo_que_a_meta_inventar_amanha: { seja_o_que_for: true },
  };
  const { targeting } = montarTargeting(lerPublico(original), original);
  assert.deepEqual(targeting.publisher_platforms, ['facebook', 'instagram'],
    'onde o anúncio aparece NÃO pode sumir por editar público');
  assert.deepEqual(targeting.instagram_positions, ['stream', 'story']);
  assert.deepEqual(targeting.device_platforms, ['mobile']);
  assert.deepEqual(targeting.locales, [6]);
  assert.deepEqual(targeting.algo_que_a_meta_inventar_amanha, { seja_o_que_for: true });
});

// ═══ A INVARIANTE DA TELA DE DINHEIRO ═══
// Abrir o editor, não mexer em nada e salvar tem que devolver para a Meta
// EXATAMENTE o pacote que veio dela. Qualquer diferença aqui é uma mudança em
// quem vê os anúncios que o dono não pediu, não viu no resumo e não vai
// descobrir até a conta ficar estranha.
test('IDA E VOLTA SEM EDIÇÃO NÃO MUDA UM BYTE DO PACOTE — a invariante que segura tudo', () => {
  const { targeting } = montarTargeting(lerPublico(ALVO_REALISTA), ALVO_REALISTA);
  assert.deepEqual(targeting, ALVO_REALISTA);
});

test('duas entradas de interesse continuam DUAS — E nunca vira OU', () => {
  // [{Moda}, {Luxo}] = "gosta de Moda E de Luxo". Juntar as duas numa entrada
  // só viraria "Moda OU Luxo" e o alcance pode pular de dezenas de milhares
  // para milhões — na conta ao vivo, sem uma linha no resumo.
  const original = { flexible_spec: [{ interests: [{ id: '1', name: 'Moda' }] }, { interests: [{ id: '2', name: 'Luxo' }] }] };
  const { targeting } = montarTargeting(lerPublico(original), original);
  assert.equal(targeting.flexible_spec.length, 2, 'as duas entradas continuam separadas');
  assert.deepEqual(targeting.flexible_spec, original.flexible_spec);
});

test('comportamento que mora na MESMA entrada de um interesse nao e apagado', () => {
  const original = { flexible_spec: [{ interests: [{ id: '1', name: 'Moda' }], behaviors: [{ id: 'b1', name: 'Viajantes' }] }] };
  const { targeting } = montarTargeting(lerPublico(original), original);
  assert.deepEqual(targeting.flexible_spec, original.flexible_spec);
});

test('tirar o unico interesse de uma entrada mista deixa o comportamento de pe', () => {
  const original = { flexible_spec: [{ interests: [{ id: '1', name: 'Moda' }], behaviors: [{ id: 'b1', name: 'Viajantes' }] }] };
  const p = lerPublico(original);
  p.interesses = [];
  const { targeting } = montarTargeting(p, original);
  assert.deepEqual(targeting.flexible_spec, [{ behaviors: [{ id: 'b1', name: 'Viajantes' }] }]);
});

test('entrada que so tinha interesses e ficou sem nenhum desaparece', () => {
  const original = { flexible_spec: [{ interests: [{ id: '1', name: 'Moda' }] }, { behaviors: [{ id: 'b1' }] }] };
  const p = lerPublico(original);
  p.interesses = [];
  const { targeting } = montarTargeting(p, original);
  assert.deepEqual(targeting.flexible_spec, [{ behaviors: [{ id: 'b1' }] }]);
});

test('interesse NOVO entra na entrada que ja mandava nos interesses, nao numa solta', () => {
  const original = { flexible_spec: [{ behaviors: [{ id: 'b1' }] }, { interests: [{ id: '1', name: 'Moda' }] }] };
  const p = lerPublico(original);
  p.interesses = [...p.interesses, { id: '9', name: 'Sapatos' }];
  const { targeting } = montarTargeting(p, original);
  assert.equal(targeting.flexible_spec.length, 2, 'não cria uma entrada nova (que seria um E a mais)');
  assert.deepEqual(targeting.flexible_spec[1].interests,
    [{ id: '1', name: 'Moda' }, { id: '9', name: 'Sapatos' }]);
  assert.deepEqual(targeting.flexible_spec[0], { behaviors: [{ id: 'b1' }] });
});

test('conjunto sem flexible_spec nenhum: interesse novo cria a primeira entrada', () => {
  const p = { ...PUBLICO_VAZIO, interesses: [{ id: '9', name: 'Sapatos' }] };
  const { targeting } = montarTargeting(p, {});
  assert.deepEqual(targeting.flexible_spec, [{ interests: [{ id: '9', name: 'Sapatos' }] }]);
});

test('RAIO DA CIDADE EXCLUIDA sobrevive — sem ele a exclusao encolhe sozinha', () => {
  const p = lerPublico(ALVO_REALISTA);
  assert.deepEqual(p.excluidas, [
    { key: '2777', nome: '', tipo: 'cidade', raio: 25, unidade: 'kilometer' },
  ]);
  p.idadeMin = 30;   // o dono só mexeu na idade
  const { targeting } = montarTargeting(p, ALVO_REALISTA);
  assert.deepEqual(targeting.excluded_geo_locations.cities,
    [{ key: '2777', radius: 25, distance_unit: 'kilometer' }],
    'perder o raio faria o anúncio voltar a rodar num raio de 25 km que o dono excluiu');
});

test('CEP e ponto no mapa excluidos sobrevivem a uma troca de idade', () => {
  const p = lerPublico(ALVO_REALISTA);
  p.idadeMin = 30;
  const { targeting } = montarTargeting(p, ALVO_REALISTA);
  assert.deepEqual(targeting.excluded_geo_locations.zips, ALVO_REALISTA.excluded_geo_locations.zips);
  assert.deepEqual(targeting.excluded_geo_locations.custom_locations, ALVO_REALISTA.excluded_geo_locations.custom_locations);
  assert.equal(targeting.age_min, 30);
});

test('tirar a cidade excluida NAO leva junto o CEP e o ponto no mapa', () => {
  const p = lerPublico(ALVO_REALISTA);
  p.excluidas = [];
  const { targeting } = montarTargeting(p, ALVO_REALISTA);
  assert.ok(!('cities' in targeting.excluded_geo_locations), 'a cidade saiu');
  assert.deepEqual(targeting.excluded_geo_locations.zips, ALVO_REALISTA.excluded_geo_locations.zips);
  assert.deepEqual(targeting.excluded_geo_locations.custom_locations, ALVO_REALISTA.excluded_geo_locations.custom_locations);
});

test('ADVANTAGE+ NAO E INVENTADO: conjunto sem o campo salva sem o campo', () => {
  const p = lerPublico(ALVO_REALISTA);
  assert.equal(p.advantagePlus, true, 'a TELA mostra ligado, que é o padrão da Meta');
  assert.equal(p.advantagePlusDeclarado, false, 'mas o conjunto nunca disse isso');
  p.idadeMin = 30;
  const { targeting } = montarTargeting(p, ALVO_REALISTA);
  assert.ok(!('targeting_automation' in targeting),
    'gravar o palpite ligaria o Advantage+ sozinho a cada salvamento, sem uma linha no resumo');
});

test('advantage+ e escrito quando o dono DESLIGA num conjunto que nao tinha o campo', () => {
  const p = lerPublico(ALVO_REALISTA);
  p.advantagePlus = false;
  const { targeting } = montarTargeting(p, ALVO_REALISTA);
  assert.equal(targeting.targeting_automation.advantage_audience, 0);
});

test('advantage+ e escrito sempre que o conjunto JA trazia o campo', () => {
  const p = lerPublico(ALVO_META);   // advantage_audience: 0
  const { targeting } = montarTargeting(p, ALVO_META);
  assert.equal(targeting.targeting_automation.advantage_audience, 0);
});

test('genero 0 (ou qualquer codigo invalido) nao chega na Meta', () => {
  const p = { ...PUBLICO_VAZIO, generos: [0] };
  const { targeting } = montarTargeting(p, {});
  assert.ok(!('genders' in targeting), '0 não é gênero na Meta — vira campo ausente, não [0]');
  const p2 = { ...PUBLICO_VAZIO, generos: [0, 1, 7, 2] };
  assert.deepEqual(montarTargeting(p2, {}).targeting.genders, [1, 2]);
});

test('ida e volta sem mexer em nada devolve o mesmo publico', () => {
  const { targeting } = montarTargeting(lerPublico(ALVO_META), ALVO_META);
  const lido = lerPublico(targeting);
  const original = lerPublico(ALVO_META);

  // Nomes de cidades, regiões e públicos são read-only echoes da Meta, não
  // sobrevivem à escrita (publico.mjs:9, 36). Comparar tudo mais — chaves,
  // raios, idades, gêneros, interesses (esses sim viajam), advantage+.
  assert.deepEqual(lido.cidades.map((c) => ({ key: c.key, raio: c.raio, unidade: c.unidade })),
    original.cidades.map((c) => ({ key: c.key, raio: c.raio, unidade: c.unidade })));
  assert.deepEqual(lido.excluidas.map((e) => ({ key: e.key, tipo: e.tipo })),
    original.excluidas.map((e) => ({ key: e.key, tipo: e.tipo })));
  assert.deepEqual(lido.idadeMin, original.idadeMin);
  assert.deepEqual(lido.idadeMax, original.idadeMax);
  assert.deepEqual(lido.generos, original.generos);
  assert.deepEqual(lido.interesses, original.interesses);
  assert.deepEqual(lido.incluir.map((a) => ({ id: a.id })), original.incluir.map((a) => ({ id: a.id })));
  assert.deepEqual(lido.excluir.map((a) => ({ id: a.id })), original.excluir.map((a) => ({ id: a.id })));
  assert.deepEqual(lido.advantagePlus, original.advantagePlus);
});

test('so as chaves gerenciadas mudam', () => {
  const p = lerPublico(ALVO_META);
  p.idadeMin = 30;
  const { targeting } = montarTargeting(p, ALVO_META);
  assert.equal(targeting.age_min, 30);
  for (const k of ['publisher_platforms', 'instagram_positions'])
    assert.deepEqual(targeting[k], ALVO_META[k], k + ' não devia mudar');
});

test('comportamentos no flexible_spec sobrevivem a troca de interesses', () => {
  const original = { flexible_spec: [
    { behaviors: [{ id: 'b1', name: 'Viajantes' }] },
    { interests: [{ id: '1', name: 'Bolsas' }] },
  ] };
  const p = lerPublico(original);
  p.interesses = [{ id: '9', name: 'Sapatos' }];
  const { targeting } = montarTargeting(p, original);
  assert.ok(targeting.flexible_spec.some(g => g.behaviors),
    'comportamento é do mesmo pacote e não pode ser apagado por editar interesse');
  const ints = targeting.flexible_spec.flatMap(g => g.interests || []);
  assert.deepEqual(ints, [{ id: '9', name: 'Sapatos' }]);
});

test('esvaziar um campo REMOVE a chave em vez de mandar lista vazia', () => {
  const p = lerPublico(ALVO_META);
  p.interesses = []; p.incluir = []; p.excluir = []; p.excluidas = []; p.generos = [];
  const { targeting } = montarTargeting(p, ALVO_META);
  for (const k of ['flexible_spec','custom_audiences','excluded_custom_audiences','excluded_geo_locations','genders'])
    assert.ok(!(k in targeting), k + ' vazio deve sair do pacote, não ir como []');
});

test('advantage+ liga e desliga nos dois sentidos', () => {
  const p = lerPublico(ALVO_META);
  p.advantagePlus = true;
  assert.equal(montarTargeting(p, ALVO_META).targeting.targeting_automation.advantage_audience, 1);
  p.advantagePlus = false;
  assert.equal(montarTargeting(p, ALVO_META).targeting.targeting_automation.advantage_audience, 0);
});

test('raio abaixo do minimo e ajustado E RELATADO, nunca em silencio', () => {
  const p = lerPublico(ALVO_META);
  p.cidades = [{ key: '1058', nome: 'Campinas', raio: 5, unidade: 'kilometer' }];
  const { targeting, ajustes } = montarTargeting(p, ALVO_META);
  assert.equal(targeting.geo_locations.cities[0].radius, 17);
  assert.deepEqual(ajustes, [{ cidade: 'Campinas', de: 5, para: 17, unidade: 'kilometer' }]);
});

test('raio em milhas usa o minimo em milhas', () => {
  const p = lerPublico(ALVO_META);
  p.cidades = [{ key: '1058', nome: 'Campinas', raio: 3, unidade: 'mile' }];
  const { targeting, ajustes } = montarTargeting(p, ALVO_META);
  assert.equal(targeting.geo_locations.cities[0].radius, 10);
  assert.equal(ajustes.length, 1);
});

test('raio zero significa a cidade inteira e NAO e ajustado', () => {
  const p = lerPublico(ALVO_META);
  p.cidades = [{ key: '1058', nome: 'Campinas', raio: 0, unidade: 'kilometer' }];
  const { targeting, ajustes } = montarTargeting(p, ALVO_META);
  assert.ok(!('radius' in targeting.geo_locations.cities[0]), 'raio 0 = cidade inteira');
  assert.deepEqual(ajustes, []);
});

test('incluir e excluir publico nao se misturam', () => {
  const p = lerPublico(ALVO_META);
  const { targeting } = montarTargeting(p, ALVO_META);
  assert.deepEqual(targeting.custom_audiences, [{ id: 'aud1' }]);
  assert.deepEqual(targeting.excluded_custom_audiences, [{ id: 'aud2' }]);
  assert.ok(!('exclusions' in targeting), 'público em exclusions está descontinuado na Meta');
});

test('sem original (conjunto sem targeting) monta do zero sem quebrar', () => {
  const { targeting } = montarTargeting(PUBLICO_VAZIO, null);
  assert.equal(typeof targeting, 'object');
});

test('publico SEM cidade nenhuma nao restaura as antigas em silencio', () => {
  const p = lerPublico(ALVO_META);
  p.cidades = [];
  const { targeting } = montarTargeting(p, ALVO_META);
  // A Meta exige localização (conjunto não mira em lugar nenhum), mas
  // ressuscitar as cidades antigas caladamente faria a tela mentir: o dono
  // apagou tudo e veria o de antes voltar. Quem barra é o aviso bloqueante
  // da Task 4; aqui a chave simplesmente sai do pacote.
  assert.ok(!('geo_locations' in targeting));
});

test('null em cidades nao quebra, entrada valida sobrevive', () => {
  const p = { cidades: [null, { key: '1', nome: 'Válida', raio: 25, unidade: 'kilometer' }, null], excluidas: [], idadeMin: 18, idadeMax: 65, generos: [], interesses: [], incluir: [], excluir: [], advantagePlus: true };
  const { targeting } = montarTargeting(p, {});
  assert.deepEqual(targeting.geo_locations.cities.length, 1);
  assert.equal(targeting.geo_locations.cities[0].key, '1');
});

test('null em excluidas nao quebra, entrada valida sobrevive', () => {
  const p = { cidades: [], excluidas: [null, { key: '1', nome: 'Válida', tipo: 'cidade' }, { key: '2', nome: 'Região', tipo: 'regiao' }, null], idadeMin: 18, idadeMax: 65, generos: [], interesses: [], incluir: [], excluir: [], advantagePlus: true };
  const { targeting } = montarTargeting(p, {});
  assert.deepEqual(targeting.excluded_geo_locations.cities.length, 1);
  assert.deepEqual(targeting.excluded_geo_locations.regions.length, 1);
});

test('null em interesses nao quebra, entrada valida sobrevive', () => {
  const p = { cidades: [], excluidas: [], idadeMin: 18, idadeMax: 65, generos: [], interesses: [null, { id: '1', name: 'Válido' }, null], incluir: [], excluir: [], advantagePlus: true };
  const { targeting } = montarTargeting(p, {});
  const ints = targeting.flexible_spec.flatMap(g => g.interests || []);
  assert.deepEqual(ints.length, 1);
  assert.equal(ints[0].id, '1');
});

test('null em incluir nao quebra, entrada valida sobrevive', () => {
  const p = { cidades: [], excluidas: [], idadeMin: 18, idadeMax: 65, generos: [], interesses: [], incluir: [null, { id: 'a1', name: 'Válido' }, null], excluir: [], advantagePlus: true };
  const { targeting } = montarTargeting(p, {});
  assert.deepEqual(targeting.custom_audiences.length, 1);
  assert.equal(targeting.custom_audiences[0].id, 'a1');
});

test('null em excluir nao quebra, entrada valida sobrevive', () => {
  const p = { cidades: [], excluidas: [], idadeMin: 18, idadeMax: 65, generos: [], interesses: [], incluir: [], excluir: [null, { id: 'a2', name: 'Válido' }, null], advantagePlus: true };
  const { targeting } = montarTargeting(p, {});
  assert.deepEqual(targeting.excluded_custom_audiences.length, 1);
  assert.equal(targeting.excluded_custom_audiences[0].id, 'a2');
});

test('null em generos nao quebra, entrada valida sobrevive', () => {
  const p = { cidades: [], excluidas: [], idadeMin: 18, idadeMax: 65, generos: [null, 1, null, 2, null], interesses: [], incluir: [], excluir: [], advantagePlus: true };
  const { targeting } = montarTargeting(p, {});
  assert.deepEqual(targeting.genders, [1, 2]);
});

test('excluida sem key (ou malformada) nao quebra, entrada valida sobrevive, nenhuma chave undefined', () => {
  // {} tem tipo undefined; { tipo: 'cidade' } tem key undefined; ambas devem ser saltadas
  const p = {
    cidades: [],
    excluidas: [
      {},
      { key: '1', nome: 'Válida', tipo: 'cidade' },
      { tipo: 'cidade' },
      { key: '2', nome: 'Região', tipo: 'regiao' },
      { tipo: 'regiao' }
    ],
    idadeMin: 18,
    idadeMax: 65,
    generos: [],
    interesses: [],
    incluir: [],
    excluir: [],
    advantagePlus: true
  };
  const { targeting } = montarTargeting(p, {});

  // Entradas válidas sobrevivem
  assert.deepEqual(targeting.excluded_geo_locations.cities.length, 1, 'uma cidade válida');
  assert.equal(targeting.excluded_geo_locations.cities[0].key, '1', 'chave correta da cidade');
  assert.deepEqual(targeting.excluded_geo_locations.regions.length, 1, 'uma região válida');
  assert.equal(targeting.excluded_geo_locations.regions[0].key, '2', 'chave correta da região');

  // Nunca produz chaves undefined ou null
  for (const c of targeting.excluded_geo_locations.cities || [])
    assert.notEqual(c.key, 'undefined', 'nunca escreve key: undefined nas cities');
  for (const r of targeting.excluded_geo_locations.regions || [])
    assert.notEqual(r.key, 'undefined', 'nunca escreve key: undefined nas regions');
});

test('sem mudanca, resumo vazio', () => {
  assert.deepEqual(resumoDasMudancas(lerPublico(ALVO_META), lerPublico(ALVO_META)), []);
});

test('cidade entrando e saindo aparecem com nome, nao com codigo', () => {
  const antes = lerPublico(ALVO_META);
  const depois = lerPublico(ALVO_META);
  depois.cidades = [{ key: '999', nome: 'Piracicaba', raio: 0, unidade: 'kilometer' }];
  const r = resumoDasMudancas(antes, depois).join(' | ');
  assert.match(r, /Piracicaba/);
  assert.match(r, /Campinas/);
  assert.ok(!/1058|999/.test(r), 'o dono não entende código de cidade');
});

test('idade, genero e advantage+ saem em frase legivel', () => {
  const antes = lerPublico(ALVO_META);
  const d1 = { ...antes, idadeMin: 30 };
  assert.match(resumoDasMudancas(antes, d1).join(' '), /30/);
  const d2 = { ...antes, generos: [] };
  assert.match(resumoDasMudancas(antes, d2).join(' ').toLowerCase(), /gênero|genero|todos/);
  const d3 = { ...antes, advantagePlus: true };
  assert.match(resumoDasMudancas(antes, d3).join(' '), /Advantage/);
});

test('mudanca de raio da mesma cidade e relatada', () => {
  const antes = lerPublico(ALVO_META);
  const depois = { ...antes, cidades: [{ key: '1058', nome: 'Campinas', raio: 50, unidade: 'kilometer' }] };
  assert.match(resumoDasMudancas(antes, depois).join(' '), /Campinas.*50|50.*Campinas/);
});

test('publicos personalizados: incluidos e excluidos saem separados', () => {
  const antes = lerPublico(ALVO_META);
  const depois = { ...antes, incluir: [], excluir: [] };
  const r = resumoDasMudancas(antes, depois).join(' | ');
  assert.match(r, /Visitantes do site/);
  assert.match(r, /Já compraram/);
});

test('toda frase e texto legivel, sem objeto vazando', () => {
  const antes = lerPublico(ALVO_META);
  const depois = { ...antes, idadeMin: 30, generos: [], interesses: [] };
  for (const frase of resumoDasMudancas(antes, depois)) {
    assert.equal(typeof frase, 'string');
    assert.ok(!frase.includes('[object'), 'objeto vazou pra tela: ' + frase);
  }
});

test('null ou entrada sem key/id nao quebra, entrada valida sobrevive', () => {
  const antes = lerPublico(ALVO_META);
  const depois = { ...antes, cidades: [null, { key: '1058', nome: 'Campinas', raio: 30, unidade: 'kilometer' }, null] };
  const r = resumoDasMudancas(antes, depois);
  assert.ok(r.some(linha => linha.includes('Campinas')), 'entrada válida sobrevive');
  assert.ok(!r.some(linha => linha.includes('[object')), 'nenhuma entrada null quebra a saída');
});

test('interesse/publico sem nome mostra "sem nome" + codigo, nunca codigo sozinho', () => {
  const antes = lerPublico(ALVO_META);
  const depois = { ...antes, interesses: [{ id: '999', name: '' }] };
  const r = resumoDasMudancas(antes, depois).join(' | ');
  assert.match(r, /sem nome.*999|interesse.*sem nome/, 'deve conter "sem nome" e o código');
  assert.ok(!r.match(/^999$|Interesses: \+999/), 'nunca mostra codigo sozinho');
});

test('cidade sem nome mostra "sem nome" + codigo, nao mostra codigo sozinho', () => {
  const antes = lerPublico(ALVO_META);
  const depois = { ...antes, cidades: [{ key: '777', nome: '', raio: 0, unidade: 'kilometer' }] };
  const r = resumoDasMudancas(antes, depois).join(' | ');
  assert.match(r, /sem nome.*777|cidade.*sem nome/, 'deve conter "sem nome" e o código');
});

test('publico personalizado sem nome mostra "sem nome" + codigo', () => {
  const antes = lerPublico(ALVO_META);
  const depois = { ...antes, incluir: [{ id: 'aud_vazio', name: '' }] };
  const r = resumoDasMudancas(antes, depois).join(' | ');
  assert.match(r, /sem nome.*aud_vazio|público.*sem nome/, 'deve conter "sem nome" e o id');
});

test('mudanca de unidade (kilometer <-> mile) no mesmo raio e relatada', () => {
  const antes = lerPublico(ALVO_META);
  const depois = { ...antes, cidades: [{ key: '1058', nome: 'Campinas', raio: 25, unidade: 'mile' }] };
  const r = resumoDasMudancas(antes, depois).join(' | ');
  assert.match(r, /Raio de Campinas/, 'deve mencionar a cidade');
  assert.match(r, /25\s*km.*mi|mi.*km/, 'deve mostrar ambas as unidades');
});

test('cidade existente sem nome, raio muda, mostra "sem nome" nao codigo', () => {
  const antes = lerPublico(ALVO_META);
  const depois = { ...antes, cidades: [{ key: '1058', nome: '', raio: 50, unidade: 'kilometer' }] };
  const r = resumoDasMudancas(antes, depois).join(' | ');
  assert.match(r, /sem nome.*1058|Raio.*sem nome/, 'deve conter "sem nome" e código');
  assert.ok(!r.match(/Raio de 1058/), 'nunca mostra codigo sozinho no raio');
});

test('cidade com raio 0 (cidade inteira) em ambos lados, unidade muda, nao gera linha', () => {
  const antes = { cidades: [{ key: '1058', nome: 'Campinas', raio: 0, unidade: 'kilometer' }], excluidas: [], idadeMin: 18, idadeMax: 65, generos: [], interesses: [], incluir: [], excluir: [], advantagePlus: true };
  const depois = { ...antes, cidades: [{ key: '1058', nome: 'Campinas', raio: 0, unidade: 'mile' }] };
  const r = resumoDasMudancas(antes, depois);
  assert.ok(!r.some(linha => linha.includes('Raio de Campinas')), 'nao deve gerar linha de raio quando ambos sao 0');
});

test('conjunto ATIVO avisa que reinicia o aprendizado; pausado nao avisa', () => {
  const a = lerPublico(ALVO_META), d = { ...a, idadeMin: 30 };
  const ativo = avisosDe(a, d, { ativo: true, ajustes: [] });
  assert.ok(ativo.some(x => /aprendizado/i.test(x.texto)));
  const pausado = avisosDe(a, d, { ativo: false, ajustes: [] });
  assert.ok(!pausado.some(x => /aprendizado/i.test(x.texto)),
    'aviso que aparece sempre é aviso que ninguém lê');
});

test('sem mudanca nenhuma, nao avisa nada — nem em conjunto ativo', () => {
  const a = lerPublico(ALVO_META);
  assert.deepEqual(avisosDe(a, a, { ativo: true, ajustes: [] }), []);
});

test('LIGAR advantage+ com restricao manual BLOQUEIA — a Meta recusa (1870227)', () => {
  // ALVO_META traz advantage_audience: 0 EXPLÍCITO, então o "antes" é
  // desligado de verdade e isto pinça a TRANSIÇÃO (desligado → ligado), não um
  // estado que já veio pronto da Meta.
  const a = lerPublico(ALVO_META);
  assert.equal(a.advantagePlus, false, 'o antes tem que ser desligado para isto medir a transição');
  const d = { ...a, advantagePlus: true };   // ALVO_META tem idade, gênero e interesses
  const avisos = avisosDe(a, d, { ativo: false, ajustes: [] });
  const conflito = avisos.find(x => x.bloqueia);
  assert.ok(conflito, 'combinação que a Meta recusa não pode ser oferecida como se funcionasse');
  assert.match(conflito.texto, /Advantage/);
});

test('conjunto que CHEGOU com advantage+ e restricao manual nao trava o Salvar', () => {
  // Ele já está assim na Meta. Travar aqui deixaria o dono sem saída a não ser
  // desligar o Advantage+ — mudança de verdade em quem vê os anúncios, que ele
  // não pediu — só para conseguir trocar uma cidade.
  const a = { ...COM_CIDADE, advantagePlus: true, idadeMin: 25, idadeMax: 45, generos: [2] };
  assert.deepEqual(avisosDe(a, a, { ativo: true, ajustes: [] }), [], 'nada mudou, nada avisa');

  const d = { ...a, cidades: [{ key: '999', nome: 'Piracicaba', raio: 0, unidade: 'kilometer' }] };
  assert.ok(!avisosDe(a, d, { ativo: false, ajustes: [] }).some(x => x.bloqueia),
    'trocar de cidade não pode ser barrado por um conflito que a ferramenta não criou');
});

test('mexer na restricao com advantage+ JA ligado BLOQUEIA — esse conflito e novo', () => {
  const a = { ...COM_CIDADE, advantagePlus: true, idadeMin: 25, idadeMax: 45 };
  const d = { ...a, idadeMin: 30 };
  const bloq = avisosDe(a, d, { ativo: false, ajustes: [] }).find(x => x.bloqueia);
  assert.ok(bloq, 'a Meta vai recusar essa gravação — melhor barrar antes');
  assert.match(bloq.texto, /Advantage/);
});

test('ligar advantage+ SEM restricao manual nao bloqueia', () => {
  const a = { ...COM_CIDADE, advantagePlus: false };
  const d = { ...COM_CIDADE, advantagePlus: true };
  assert.ok(!avisosDe(a, d, { ativo: false, ajustes: [] }).some(x => x.bloqueia));
});

test('desligar advantage+ avisa, mas nao bloqueia', () => {
  const a = { ...COM_CIDADE, advantagePlus: true };
  const d = { ...COM_CIDADE, advantagePlus: false, idadeMin: 25 };
  const avisos = avisosDe(a, d, { ativo: false, ajustes: [] });
  assert.ok(avisos.some(x => /desligado/i.test(x.texto)));
  assert.ok(!avisos.some(x => x.bloqueia));
});

test('ajuste de raio vira aviso com a cidade pelo nome', () => {
  const a = lerPublico(ALVO_META);
  const avisos = avisosDe(a, a, { ativo: false, ajustes: [{ cidade: 'Campinas', de: 5, para: 17, unidade: 'kilometer' }] });
  const r = avisos.find(x => /Campinas/.test(x.texto));
  assert.ok(r);
  assert.match(r.texto, /17/);
});

test('publico sem lugar nenhum BLOQUEIA — a Meta exige localizacao', () => {
  const a = lerPublico(ALVO_META);
  const d = { ...a, cidades: [] };
  const bloq = avisosDe(a, d, { ativo: false, ajustes: [] }).find(x => x.bloqueia);
  assert.ok(bloq, 'conjunto não pode mirar em lugar nenhum');
  assert.match(bloq.texto.toLowerCase(), /cidade|lugar|local/);
});

test('depois.cidades: null nao quebra e bloqueia por sem-lugar', () => {
  const a = lerPublico(ALVO_META);
  const d = { ...a, cidades: null };
  const avisos = avisosDe(a, d, { ativo: false, ajustes: [] });
  assert.ok(avisos.length > 0, 'não deve quebrar, deve retornar avisos');
  const bloq = avisos.find(x => x.bloqueia && /cidade|lugar|local/i.test(x.texto));
  assert.ok(bloq, 'null em cidades é "sem lugar", deve bloquear');
});

test('depois.cidades: undefined nao quebra e bloqueia por sem-lugar', () => {
  const a = lerPublico(ALVO_META);
  const d = { ...a, cidades: undefined };
  const avisos = avisosDe(a, d, { ativo: false, ajustes: [] });
  assert.ok(avisos.length > 0, 'não deve quebrar, deve retornar avisos');
  const bloq = avisos.find(x => x.bloqueia && /cidade|lugar|local/i.test(x.texto));
  assert.ok(bloq, 'undefined em cidades é "sem lugar", deve bloquear');
});

test('antes.cidades: null nao quebra', () => {
  const a = { ...COM_CIDADE, cidades: null };
  const d = lerPublico(ALVO_META);
  const avisos = avisosDe(a, d, { ativo: false, ajustes: [] });
  assert.ok(Array.isArray(avisos), 'não deve quebrar, deve retornar array');
});

test('antes.cidades: undefined nao quebra', () => {
  const a = { ...COM_CIDADE, cidades: undefined };
  const d = lerPublico(ALVO_META);
  const avisos = avisosDe(a, d, { ativo: false, ajustes: [] });
  assert.ok(Array.isArray(avisos), 'não deve quebrar, deve retornar array');
});

test('todo aviso tem texto legivel e marca de bloqueio explicita', () => {
  const a = lerPublico(ALVO_META);
  const d = { ...a, advantagePlus: true, idadeMin: 30 };
  for (const x of avisosDe(a, d, { ativo: true, ajustes: [] })) {
    assert.equal(typeof x.texto, 'string');
    assert.ok(x.texto.length > 15);
    assert.equal(typeof x.bloqueia, 'boolean');
  }
});

test('sem cidade E advantage+ conflict coexistem — dois bloqueios, nenhum se perde', () => {
  const a = lerPublico(ALVO_META);
  // Remove cidades E liga Advantage+ com restrição manual (ambas condições de bloqueio)
  const d = { ...a, cidades: [], advantagePlus: true };
  const avisos = avisosDe(a, d, { ativo: false, ajustes: [] });
  const bloqueios = avisos.filter(x => x.bloqueia);
  assert.ok(bloqueios.length >= 2, 'deve ter pelo menos 2 avisos bloqueantes: sem-cidade E conflito Advantage+');
  assert.ok(bloqueios.some(x => /cidade|lugar|local/i.test(x.texto)), 'um bloqueio é sobre localização');
  assert.ok(bloqueios.some(x => /Advantage/i.test(x.texto)), 'outro bloqueio é sobre Advantage+');
});

// Este teste dizia "regions popula outrasLocalizacoes" até 13/08/2026, quando o
// editor passou a DESENHAR estado. O que ele guarda continua sendo o mesmo: a
// região não se perde na leitura. Mudou só onde ela aparece.
test('lerPublico: targeting com regions popula ESTADOS (nao mais outrasLocalizacoes)', () => {
  const comRegioes = { geo_locations: { cities: [{ key: '1058', name: 'Campinas' }], regions: [{ key: '456', name: 'SP' }] } };
  const p = lerPublico(comRegioes);
  assert.deepEqual(p.estados, [{ key: '456', nome: 'SP' }], 'estado é gerenciado, com nome');
  assert.ok(!p.outrasLocalizacoes.includes('regions'), 'não pode avisar "não mexo nisso" sobre o que agora edita');
  assert.deepEqual(p.cidades.length, 1, 'cities ainda aparecem normalmente');
});

test('lerPublico: countries vira PAIS e zips continua sendo outra localizacao', () => {
  // A Meta manda country como STRING ("BR"); o formato de objeto é aceito por
  // tolerância, para nunca virar "[object Object]" caso ela mude.
  const comPaises = { geo_locations: { countries: ['BR'], zips: [{ key: '13000' }] } };
  const p = lerPublico(comPaises);
  assert.deepEqual(p.paises, [{ key: 'BR', nome: 'BR' }]);
  assert.ok(!p.outrasLocalizacoes.includes('countries'), 'país é gerenciado');
  assert.ok(p.outrasLocalizacoes.includes('zips'), 'CEP continua preservado sem ser editado');
  assert.deepEqual(p.cidades.length, 0, 'sem cities, cidades vazio');

  const emObjeto = lerPublico({ geo_locations: { countries: [{ key: 'BR' }] } });
  assert.deepEqual(emObjeto.paises, [{ key: 'BR', nome: 'BR' }], 'tolera o formato de objeto');
});

test('lerPublico: só cities não popula outrasLocalizacoes', () => {
  const p = lerPublico(ALVO_META);
  assert.deepEqual(p.outrasLocalizacoes, [], 'outrasLocalizacoes vazio quando só cities');
});

test('cities E regions: round-trip preserva regions enquanto cities atualiza', () => {
  const original = {
    geo_locations: {
      cities: [{ key: '1058', name: 'Campinas', radius: 25, distance_unit: 'kilometer' }],
      regions: [{ key: '456', name: 'SP' }],
    },
  };
  const p = lerPublico(original);
  p.cidades = [{ key: '999', nome: 'Piracicaba', raio: 0, unidade: 'kilometer' }];
  const { targeting } = montarTargeting(p, original);
  // A REGIÃO SOBREVIVE — agora pelo caminho gerenciado, não pela preservação
  // cega. O `name` não viaja de volta, e isso é de propósito: quem segmenta é a
  // CHAVE, e é exatamente assim que a cidade sempre funcionou aqui. Mandar o
  // rótulo de volta não muda nada na Meta.
  assert.ok(targeting.geo_locations.regions, 'regions sobrevivem');
  assert.deepEqual(targeting.geo_locations.regions, [{ key: '456' }], 'a chave é o que segmenta');
  // Cities devem ser atualizadas
  assert.deepEqual(targeting.geo_locations.cities[0].key, '999', 'cities atualizada');
});

test('só regions: montarTargeting NÃO deleta geo_locations inteira', () => {
  const original = { geo_locations: { regions: [{ key: '456', name: 'SP' }] } };
  const p = lerPublico(original);
  const { targeting } = montarTargeting(p, original);
  assert.ok('geo_locations' in targeting, 'geo_locations deve existir');
  assert.ok(targeting.geo_locations.regions, 'regions deve estar lá');
  assert.ok(!('cities' in targeting.geo_locations), 'cities não deve estar (foi vazia)');
});

// A CONTRAPARTIDA DE GERENCIAR UMA CHAVE, escrita para quem vier depois: chave
// gerenciada é AUTORITATIVA. Um público montado à mão, sem passar por
// `lerPublico`, apagaria o estado do conjunto — do mesmo jeito que sempre
// apagaria a cidade. Os dois chamadores de montarTargeting no app partem de
// `lerPublico` (conferido em 13/08/2026); quem acrescentar um terceiro tem de
// fazer o mesmo.
test('publico montado a mao SEM estados apaga os estados — o preco de gerenciar', () => {
  const original = { geo_locations: { regions: [{ key: '456', name: 'SP' }], zips: [{ key: '13000' }] } };
  const { targeting } = montarTargeting({ ...PUBLICO_VAZIO }, original);
  assert.ok(!('regions' in targeting.geo_locations), 'estado é gerenciado: lista vazia apaga');
  assert.deepEqual(targeting.geo_locations.zips, [{ key: '13000' }], 'o que NÃO é gerenciado continua intocado');
});

test('cities esvaziada (só tinha cities): geo_locations removida, compatível com comportamento anterior', () => {
  const original = { geo_locations: { cities: [{ key: '1058', name: 'Campinas' }] } };
  const p = { ...PUBLICO_VAZIO, cidades: [] };
  const { targeting } = montarTargeting(p, original);
  assert.ok(!('geo_locations' in targeting), 'geo_locations removida quando cities vazia e nada mais tem');
});

// MUDOU DE PROPÓSITO (revisão final): antes este teste exigia que QUALQUER
// chave desconhecida de geo_locations contasse como localização. Isso é o que
// fazia `location_types` (["home","recent"], presente em quase todo conjunto)
// passar por lugar — furando o bloqueio obrigatório da Meta e disparando um
// aviso que aparecia sempre. Contar agora é por lista fechada de lugares; a
// PRESERVAÇÃO da chave desconhecida continua garantida, que é o que importa.
test('tipo geo desconhecido sobrevive a ida e volta (mas NAO conta como localizacao)', () => {
  const original = {
    geo_locations: {
      cities: [{ key: '1058', name: 'Campinas' }],
      geo_algo_novo: [{ id: 'x' }],
    },
  };
  const p = lerPublico(original);
  assert.ok(!p.outrasLocalizacoes.includes('geo_algo_novo'),
    'chave que ninguém conferiu ser lugar não pode segurar o bloqueio de "sem localização"');
  const { targeting } = montarTargeting(p, original);
  assert.ok(targeting.geo_locations.geo_algo_novo, 'tipo desconhecido sobrevive');
  assert.deepEqual(targeting.geo_locations.geo_algo_novo, [{ id: 'x' }], 'conteúdo intacto');
});

// ESQUECER UM TIPO DE LUGAR NA LISTA TRAVA O SALVAR. Um conjunto mirado SÓ por
// grupo de países (o que o Gerenciador produz quando se escolhe "América do
// Sul"), por região metropolitana ou por área do mapa passaria a contar como
// "sem localização nenhuma": Salvar morto, sem o dono ter mudado nada, e a
// única saída seria acrescentar uma cidade que ele nunca quis — exatamente o
// beco sem saída que o bloqueio de Advantage+ já custou. Este teste percorre a
// lista INTEIRA, então tipo novo acrescentado lá entra aqui sozinho.
test('TODO tipo de lugar da lista conta como lugar, nao trava o salvar e volta intacto', () => {
  // 12 desde 13/08/2026: `countries` e `regions` SAÍRAM daqui porque o editor
  // passou a desenhar Brasil e Estado (antes, em 12/08, saiu `custom_locations`
  // pelo pin). Encolher a lista sem mais nada teria travado o Salvar de conjunto
  // mirado só por país ou só por estado — os testes lá no fim do arquivo são a
  // prova de que isso não acontece. Quem tirar outra chave daqui tem a mesma
  // obrigação: um lugar próprio no editor E contar no bloqueio de "sem
  // localização".
  assert.ok(CHAVES_DE_LOCALIZACAO.length >= 12, 'a lista não pode encolher sem alguém perceber');
  assert.ok(!CHAVES_DE_LOCALIZACAO.includes('custom_locations'), 'pin é gerenciado pelo editor, não preservado às cegas');
  assert.ok(!CHAVES_DE_LOCALIZACAO.includes('countries'), 'país é gerenciado pelo editor');
  assert.ok(!CHAVES_DE_LOCALIZACAO.includes('regions'), 'estado é gerenciado pelo editor');
  for (const chave of CHAVES_DE_LOCALIZACAO) {
    const conteudo = [{ key: 'x1' }];
    const original = { geo_locations: { [chave]: conteudo }, age_min: 25 };
    const p = lerPublico(original);

    assert.deepEqual(p.outrasLocalizacoes, [chave], chave + ' tem que contar como lugar');
    assert.deepEqual(p.cidades, [], chave + ' não é cidade');

    // Sem cidade nenhuma, mas COM esse lugar: não pode bloquear.
    const avisos = avisosDe(p, p, { ativo: false, ajustes: [] });
    assert.ok(!avisos.some((x) => x.bloqueia),
      chave + ': conjunto mirado só por isso ficaria impossível de salvar');

    // O aviso informativo tem que sair em português, nunca com a chave crua.
    const info = avisos.find((x) => x.tipo === 'outras-localizacoes');
    assert.ok(info, chave + ': deve avisar que o editor não gerencia isso');
    assert.ok(!info.texto.includes(chave), chave + ': o dono não pode ler a chave crua em inglês');
    assert.ok(!info.texto.includes('outra localização'),
      chave + ': caiu no nome genérico — falta a entrada dele em NOMES_LOCALIZACOES');

    // E volta intacto pra Meta.
    const { targeting } = montarTargeting(p, original);
    assert.deepEqual(targeting.geo_locations[chave], conteudo, chave + ' tem que sobreviver ao salvar');
  }
});

test('conjunto mirado so por grupo de paises salva normalmente (caso do Gerenciador)', () => {
  // Advantage+ desligado no original de propósito: isola a pergunta de
  // localização do bloqueio de "Advantage+ com restrição manual".
  const original = {
    geo_locations: { country_groups: ['south_america'], location_types: ['home', 'recent'] },
    age_min: 25,
    targeting_automation: { advantage_audience: 0 },
  };
  const p = lerPublico(original);
  const d = { ...p, idadeMin: 30 };
  const avisos = avisosDe(p, d, { ativo: false, ajustes: [] });
  assert.ok(!avisos.some((x) => x.bloqueia), 'trocar a idade não pode travar num conjunto sem cidade mas com lugar');
  assert.match(avisos.find((x) => x.tipo === 'outras-localizacoes').texto, /grupo de países/);
  const { targeting } = montarTargeting(d, original);
  assert.deepEqual(targeting.geo_locations, original.geo_locations, 'nada no lugar foi tocado');
  assert.equal(targeting.age_min, 30);
});

test('location_types NAO e localizacao: sem cidade nenhuma o salvar e BLOQUEADO', () => {
  const original = {
    geo_locations: { cities: [{ key: '1058', name: 'Campinas' }], location_types: ['home', 'recent'] },
  };
  const p = lerPublico(original);
  assert.deepEqual(p.outrasLocalizacoes, [],
    'location_types é configuração de "quem mora / quem está de passagem", não lugar');

  // O dono apaga a única cidade: tem que bater no bloqueio da Meta.
  const semCidade = { ...p, cidades: [] };
  const bloq = avisosDe(p, semCidade, { ativo: false, ajustes: [] }).find((x) => x.bloqueia);
  assert.ok(bloq, 'conjunto sem lugar nenhum não pode passar batido só porque tem location_types');
  assert.match(bloq.texto.toLowerCase(), /localização/);

  // E não pode inventar aviso: conjunto normal não recebe "tem outra localização".
  const avisos = avisosDe(p, p, { ativo: false, ajustes: [] });
  assert.ok(!avisos.some((x) => x.tipo === 'outras-localizacoes'),
    'aviso que aparece em quase todo conjunto é aviso que ninguém lê');

  // E a chave viaja intacta de volta.
  const { targeting } = montarTargeting(p, original);
  assert.deepEqual(targeting.geo_locations.location_types, ['home', 'recent']);
});

test('avisosDe: só regions → SEM bloqueio, mas aviso informativo com tradução', () => {
  const p = { ...PUBLICO_VAZIO, outrasLocalizacoes: ['regions'] };
  const avisos = avisosDe(p, p, { ativo: false, ajustes: [] });
  const bloqueios = avisos.filter(x => x.bloqueia);
  assert.ok(!bloqueios.length, 'não deve bloquear quando há regiões');
  const info = avisos.find(x => x.tipo === 'outras-localizacoes');
  assert.ok(info, 'deve ter aviso informativo');
  assert.ok(/região/i.test(info.texto), 'deve traduzir "regions" para "região"');
  // A promessa continua a mesma; a frase é que mudou (ver "a frase das outras
  // localizacoes fica legivel", no fim deste arquivo). "mantidas intactas"
  // virou "nada se perde", que diz o mesmo em português de gente.
  assert.ok(/nada se perde/i.test(info.texto), 'deve avisar que não se perde');
});

test('avisosDe: múltiplas outrasLocalizacoes na mensagem separadas por vírgula', () => {
  const p = { ...PUBLICO_VAZIO, outrasLocalizacoes: ['regions', 'countries', 'zips'] };
  const avisos = avisosDe(p, p, { ativo: false, ajustes: [] });
  const info = avisos.find(x => x.tipo === 'outras-localizacoes');
  assert.ok(/região.*país.*CEP/i.test(info.texto) || /CEP.*país.*região/i.test(info.texto), 'deve listar todas com português');
});

test('avisosDe: realmente sem localização nenhuma BLOQUEIA (nem cities, nem outras)', () => {
  const p = { ...PUBLICO_VAZIO, cidades: [], outrasLocalizacoes: [] };
  const avisos = avisosDe(p, p, { ativo: false, ajustes: [] });
  const bloqueio = avisos.find(x => x.bloqueia && /localização/i.test(x.texto));
  assert.ok(bloqueio, 'deve bloquear quando nem cidades nem outras localidades existem');
});

// ── A frase sobre localidades que o editor não desenha ─────────────────────
//
// A versão antiga saía "Este conjunto tem local definido(s)." — sem número, com
// um "(s)" preguiçoso, e falando em "conjunto" numa tela que às vezes está
// criando uma CAMPANHA NOVA. Visto ao vivo ao aplicar um público salvo.
test('a frase das outras localizacoes fica legivel no singular e no plural', () => {
  const comUma = avisosDe({}, { cidades: [{ key: '1' }], outrasLocalizacoes: ['places'] }, {})
    .find((a) => a.tipo === 'outras-localizacoes')
  assert.match(comUma.texto, /Além das cidades acima/)
  assert.match(comUma.texto, /também usa local/)
  assert.match(comUma.texto, /Ele vai junto/)
  assert.ok(!/\(s\)/.test(comUma.texto), 'o "(s)" preguiçoso voltou')
  assert.ok(!/conjunto/.test(comUma.texto), 'fala em conjunto numa tela que pode ser de campanha nova')

  const comTres = avisosDe({}, { cidades: [], outrasLocalizacoes: ['regions', 'zips', 'places'] }, {})
    .find((a) => a.tipo === 'outras-localizacoes')
  assert.match(comTres.texto, /^Este público também usa região, CEP e local/)
  assert.match(comTres.texto, /Eles vão junto/)
})

test('a frase promete o que o codigo cumpre: nada se perde', () => {
  const a = avisosDe({}, { cidades: [{ key: '1' }], outrasLocalizacoes: ['zips'] }, {})
    .find((x) => x.tipo === 'outras-localizacoes')
  assert.match(a.texto, /nada se perde/)
  assert.equal(a.bloqueia, false)
})


// A REGRESSAO QUE ESTE ARQUIVO PEGOU EM 12/08/2026, guardada pra nao voltar:
// ao tirar `custom_locations` de CHAVES_DE_LOCALIZACAO, um conjunto mirado SO
// por pin virou "sem localizacao nenhuma" e o Salvar morreu sem o dono ter
// mudado nada.
test('conjunto mirado SO por PIN nao trava o Salvar, e o pin volta intacto', () => {
  const pin = {
    name: 'Rua Miguel Guidotti, Limeira, SP, Brasil',
    address_string: 'Rua Miguel Guidotti, Limeira, SP, Brasil',
    distance_unit: 'kilometer', latitude: -22.53414, longitude: -47.3843, radius: 3,
    primary_city_id: 258269, region_id: 460, country: 'BR',
  };
  const original = { geo_locations: { custom_locations: [pin] }, age_min: 25 };
  const p = lerPublico(original);
  assert.equal(p.pins.length, 1, 'o pin tem que ser lido');
  assert.deepEqual(p.cidades, [], 'pin nao e cidade');

  const bloqueios = avisosDe(p, p, {}).filter((x) => x.bloqueia);
  assert.deepEqual(bloqueios, [], 'so pin NAO pode bloquear o salvar');

  const { targeting } = montarTargeting(p, original);
  const volta = targeting.geo_locations.custom_locations;
  assert.equal(volta.length, 1);
  assert.equal(volta[0].latitude, -22.53414);
  assert.equal(volta[0].radius, 3);
  assert.equal(volta[0].primary_city_id, 258269, 'o id da cidade vem da Meta e tem que voltar igual');
});

test('tirar o ultimo pin APAGA a chave, nao manda lista vazia', () => {
  // A Meta trata `[]` e ausente de formas diferentes — mandar `[]` e outra coisa.
  const original = { geo_locations: { custom_locations: [{ latitude: -22.5, longitude: -47.4, radius: 1, distance_unit: 'kilometer', country: 'BR' }], cities: [{ key: '1' }] } };
  const p = lerPublico(original);
  p.pins = [];
  const { targeting } = montarTargeting(p, original);
  assert.ok(!('custom_locations' in (targeting.geo_locations || {})), 'a chave tem que sumir');
});

// ── PAÍS E ESTADO PASSARAM A SER GERENCIADOS (13/08/2026) ──────────────────
// Saíram de CHAVES_DE_LOCALIZACAO porque o editor agora os desenha. A regra do
// arquivo obriga: quem sai da lista tem que contar no bloqueio de "sem
// localização". Os testes abaixo são essa obrigação, escrita.

test('pais vem como STRING no geo_locations e e lido assim', () => {
  const p = lerPublico({ geo_locations: { countries: ['BR', 'PT'] } });
  assert.deepEqual(p.paises, [{ key: 'BR', nome: 'BR' }, { key: 'PT', nome: 'PT' }]);
  assert.deepEqual(p.outrasLocalizacoes, [], 'país não é mais "outra localização"');
});

test('estado vem como objeto com key e nome', () => {
  const p = lerPublico({ geo_locations: { regions: [{ key: '449', name: 'Minas Gerais' }] } });
  assert.deepEqual(p.estados, [{ key: '449', nome: 'Minas Gerais' }]);
  assert.deepEqual(p.outrasLocalizacoes, []);
});

test('pais e estado voltam pra Meta na forma certa de cada um', () => {
  const p = { ...PUBLICO_VAZIO, paises: [{ key: 'BR', nome: 'Brasil' }], estados: [{ key: '449', nome: 'Minas Gerais' }] };
  const { targeting } = montarTargeting(p, {});
  assert.deepEqual(targeting.geo_locations.countries, ['BR'], 'país é string crua');
  assert.deepEqual(targeting.geo_locations.regions, [{ key: '449' }], 'estado é objeto com key');
});

test('pais que sai APAGA a chave em vez de mandar lista vazia', () => {
  const original = { geo_locations: { countries: ['BR'], cities: [{ key: '1058' }] } };
  const p = lerPublico(original);
  const { targeting } = montarTargeting({ ...p, paises: [] }, original);
  assert.ok(!('countries' in targeting.geo_locations), 'a Meta trata [] e ausente de formas diferentes');
  assert.deepEqual(targeting.geo_locations.cities, [{ key: '1058' }], 'a cidade ao lado não pode sumir junto');
});

test('conjunto mirado SO por pais salva — nao pode travar', () => {
  const original = { geo_locations: { countries: ['BR'] }, targeting_automation: { advantage_audience: 0 } };
  const p = lerPublico(original);
  const avisos = avisosDe(p, { ...p, idadeMin: 30 }, { ativo: false, ajustes: [] });
  assert.ok(!avisos.some((x) => x.bloqueia), 'país é localização — o Salvar não pode morrer');
});

test('conjunto mirado SO por estado salva — nao pode travar', () => {
  const original = { geo_locations: { regions: [{ key: '449', name: 'Minas Gerais' }] }, targeting_automation: { advantage_audience: 0 } };
  const p = lerPublico(original);
  const avisos = avisosDe(p, { ...p, idadeMin: 30 }, { ativo: false, ajustes: [] });
  assert.ok(!avisos.some((x) => x.bloqueia), 'estado é localização — o Salvar não pode morrer');
});

test('sem cidade, sem pais, sem estado, sem pin: ai sim bloqueia', () => {
  const avisos = avisosDe(PUBLICO_VAZIO, PUBLICO_VAZIO, { ativo: false, ajustes: [] });
  assert.ok(avisos.some((x) => x.bloqueia && x.tipo === 'sem-lugar'));
});

test('o resumo diz o que entrou e saiu de pais e estado, com nome', () => {
  const antes = { ...PUBLICO_VAZIO, estados: [{ key: '449', nome: 'Minas Gerais' }] };
  const depois = { ...PUBLICO_VAZIO, paises: [{ key: 'BR', nome: 'Brasil' }], estados: [] };
  const linhas = resumoDasMudancas(antes, depois);
  assert.ok(linhas.some((l) => l.includes('+Brasil')), 'entrou o Brasil');
  assert.ok(linhas.some((l) => l.includes('−Minas Gerais')), 'saiu Minas Gerais');
});

// ─────────────────────────────────────────────────────────────────────────────
// O PIN NO MAPA PRECISA CONTAR COMO MUDANÇA.
//
// O DEFEITO REAL (17/08/2026), visto na conta da Vessel com sessão logada: pus
// um ponto no mapa do conjunto "Criativos Genspark", a tela desenhou o ponto,
// descobriu sozinha o endereço ("CBMEG/FEAGRI · Avenida Marechal Cândido Rondon
// · Cidade Universitária · Campinas · SP") e mostrou "2 lugares no mapa" com
// raio de 1 km. Ao confirmar, a janela respondeu **"Nada mudou. Não há o que
// salvar."** e fechou.
//
// A causa: `lerPublico` LÊ o pin (de `geo_locations.custom_locations`) e
// `montarTargeting` MANDA o pin de volta — mas `resumoDasMudancas` não olhava
// para `pins`. Como a tela desiste quando o resumo vem vazio, o ponto morria ali
// e NUNCA chegava na Meta. Nada avisava: a tela desenha o pin, e o pin some.
//
// É o pior formato de falha do padrão da Central: a tela mente por omissão.

test('pin NOVO no mapa conta como mudança', () => {
  const antes = lerPublico(ALVO_META);
  const depois = lerPublico(ALVO_META);
  depois.pins = [{ lat: -22.8184, lng: -47.0647, raio: 1, unidade: 'kilometer', nome: 'CBMEG/FEAGRI', endereco: 'Av. Marechal Cândido Rondon' }];
  const r = resumoDasMudancas(antes, depois).join(' | ');
  assert.match(r, /CBMEG/, 'o ponto novo tem de aparecer no resumo, pelo nome');
  assert.ok(resumoDasMudancas(antes, depois).length > 0, 'sem linha, a tela diz "nada mudou" e o pin morre');
});

test('pin REMOVIDO do mapa também conta', () => {
  const antes = lerPublico(ALVO_META);
  antes.pins = [{ lat: -22.8184, lng: -47.0647, raio: 1, unidade: 'kilometer', nome: 'CBMEG/FEAGRI' }];
  const depois = lerPublico(ALVO_META);
  depois.pins = [];
  assert.match(resumoDasMudancas(antes, depois).join(' | '), /CBMEG/);
});

test('só o RAIO do pin mudando já conta — o ponto continua o mesmo', () => {
  const base = { lat: -22.8184, lng: -47.0647, unidade: 'kilometer', nome: 'CBMEG/FEAGRI' };
  const antes = { ...lerPublico(ALVO_META), pins: [{ ...base, raio: 1 }] };
  const depois = { ...lerPublico(ALVO_META), pins: [{ ...base, raio: 8 }] };
  const r = resumoDasMudancas(antes, depois).join(' | ');
  assert.match(r, /CBMEG/);
  assert.match(r, /1 km.*8 km|8 km/);
});

test('pin sem nome aparece pela COORDENADA, nunca "sem nome (undefined)"', () => {
  const antes = lerPublico(ALVO_META);
  const depois = { ...lerPublico(ALVO_META), pins: [{ lat: -22.8184, lng: -47.0647, raio: 1, unidade: 'kilometer', nome: '', endereco: '' }] };
  const r = resumoDasMudancas(antes, depois).join(' | ');
  assert.match(r, /-22\.81|-47\.06/, 'sem nome, a coordenada é o que identifica o ponto');
  assert.ok(!/undefined/.test(r));
});

test('pin IGUAL nos dois lados não vira mudança falsa', () => {
  // A outra metade: um resumo que acusa o que não mudou faz o dono aprovar no
  // automático, e aí a janela de confirmação deixa de significar alguma coisa.
  const pin = { lat: -22.8184, lng: -47.0647, raio: 1, unidade: 'kilometer', nome: 'CBMEG/FEAGRI' };
  const antes = { ...lerPublico(ALVO_META), pins: [{ ...pin }] };
  const depois = { ...lerPublico(ALVO_META), pins: [{ ...pin }] };
  assert.deepEqual(resumoDasMudancas(antes, depois), []);
});
