import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montarTargeting } from './publico.mjs';

const LOJA = { geoCities: ['1058', '2777'] };

test('sem publico = amplo: só as cidades da loja', () => {
  assert.deepEqual(montarTargeting(null, LOJA), { geo_locations: { cities: [{ key: '1058' }, { key: '2777' }] } });
});

test('cidades com raio: clamp pro mínimo do Meta (17km / 10mi); acima do mínimo mantém', () => {
  // 15km < 17 → clamp p/ 17 (Meta rejeita <17km com code 1487110)
  const t = montarTargeting({ geo: { cities: [{ key: '1058', radius: 15, distance_unit: 'kilometer' }] } }, LOJA);
  assert.deepEqual(t.geo_locations.cities, [{ key: '1058', radius: 17, distance_unit: 'kilometer' }]);
  // 25km >= 17 → mantém
  const t2 = montarTargeting({ geo: { cities: [{ key: '1058', radius: 25, distance_unit: 'kilometer' }] } }, LOJA);
  assert.deepEqual(t2.geo_locations.cities, [{ key: '1058', radius: 25, distance_unit: 'kilometer' }]);
  // 5mi < 10 → clamp p/ 10
  const t3 = montarTargeting({ geo: { cities: [{ key: '1058', radius: 5, distance_unit: 'mile' }] } }, LOJA);
  assert.deepEqual(t3.geo_locations.cities, [{ key: '1058', radius: 10, distance_unit: 'mile' }]);
});

test('targeting_automation opt-out do Advantage+ só quando há público manual', () => {
  const t = montarTargeting({ generos: [2] }, LOJA);
  assert.deepEqual(t.targeting_automation, { advantage_audience: 0 });
  // amplo (sem publico) não opta por sair — mantém Advantage+ ligado
  const amplo = montarTargeting(null, LOJA);
  assert.ok(!('targeting_automation' in amplo));
});

test('geo.cities vazio cai pras cidades da loja', () => {
  const t = montarTargeting({ geo: { cities: [] }, generos: [] }, LOJA);
  assert.deepEqual(t.geo_locations.cities, [{ key: '1058' }, { key: '2777' }]);
});

test('excluidas agrupadas por tipo', () => {
  const t = montarTargeting({ geo: { cities: [{ key: '1058' }], excluded: [{ key: '9', type: 'city' }, { key: 'R', type: 'region' }] } }, LOJA);
  assert.deepEqual(t.excluded_geo_locations, { cities: [{ key: '9' }], regions: [{ key: 'R' }] });
});

test('idade/genero: genders só quando houver', () => {
  const t = montarTargeting({ idade_min: 25, idade_max: 45, generos: [2] }, LOJA);
  assert.equal(t.age_min, 25); assert.equal(t.age_max, 45); assert.deepEqual(t.genders, [2]);
  const t2 = montarTargeting({ generos: [] }, LOJA);
  assert.ok(!('genders' in t2));
});

test('interesses viram flexible_spec; custom_audiences só quando houver', () => {
  const t = montarTargeting({ interesses: [{ id: '6003', name: 'Moda' }], custom_audiences: [{ id: 'A1' }] }, LOJA);
  assert.deepEqual(t.flexible_spec, [{ interests: [{ id: '6003', name: 'Moda' }] }]);
  assert.deepEqual(t.custom_audiences, [{ id: 'A1' }]);
  const t2 = montarTargeting({ interesses: [] }, LOJA);
  assert.ok(!('flexible_spec' in t2)); assert.ok(!('custom_audiences' in t2));
});

// ── OS QUATRO JEITOS DE MIRAR UM LUGAR (13/08/2026) ───────────────────────
// Antes só existia cidade. O editor passou a oferecer Brasil, Estado, Cidade e
// Local (ponto com raio), e a Fábrica precisa saber montar os quatro — senão o
// dono escolhe um estado na tela e o robô sobe outra coisa.

test('pais, estado e ponto entram no targeting da Fabrica', () => {
  const t = montarTargeting({
    geo: {
      cities: [{ key: '1058', radius: 0 }],
      countries: [{ key: 'BR' }],
      regions: [{ key: '449' }],
      pins: [{ lat: -18.91, lng: -48.26, raio: 2, unidade: 'kilometer', nome: 'Center Shopping', endereco: 'Rua Argentina' }],
      excluded: [],
    },
  }, { geoCities: ['999'] });
  assert.deepEqual(t.geo_locations.countries, ['BR'], 'país é string crua');
  assert.deepEqual(t.geo_locations.regions, [{ key: '449' }]);
  assert.equal(t.geo_locations.custom_locations.length, 1);
  assert.equal(t.geo_locations.custom_locations[0].latitude, -18.91);
  assert.equal(t.geo_locations.custom_locations[0].radius, 2);
  assert.equal(t.geo_locations.custom_locations[0].name, 'Center Shopping');
  assert.deepEqual(t.geo_locations.cities, [{ key: '1058' }]);
});

// A cidade da loja é a rede de segurança contra público mundial. Ela só entra
// quando NÃO há lugar nenhum — e ponto, país e estado são lugar. Sem esta
// regra, escolher só um estado faria a cidade da loja entrar por baixo e
// alargar o anúncio sem ninguém pedir.
test('lugar sem cidade nao cai na cidade da loja', () => {
  const t = montarTargeting({
    geo: { cities: [], countries: [], regions: [{ key: '449' }], pins: [], excluded: [] },
  }, { geoCities: ['999'] });
  assert.ok(!t.geo_locations.cities, 'com estado escolhido, a cidade da loja não pode entrar por baixo');
  assert.deepEqual(t.geo_locations.regions, [{ key: '449' }]);
});

test('so por ponto tambem nao cai na cidade da loja', () => {
  const t = montarTargeting({
    geo: { cities: [], pins: [{ lat: -18.9, lng: -48.2, raio: 1 }], excluded: [] },
  }, { geoCities: ['999'] });
  assert.ok(!t.geo_locations.cities);
  assert.equal(t.geo_locations.custom_locations.length, 1);
});

test('publico sem lugar NENHUM ainda cai na cidade da loja', () => {
  const t = montarTargeting({ geo: { cities: [], excluded: [] } }, { geoCities: ['999'] });
  assert.deepEqual(t.geo_locations.cities, [{ key: '999' }]);
});

// Preset salvo ANTES de 13/08/2026 não tem as chaves novas. Ele tem que
// continuar subindo igual — `fabrica_publicos.geo` é jsonb e o que falta lê como
// lista vazia.
test('preset antigo, sem as chaves novas, sobe igual', () => {
  const t = montarTargeting({ geo: { cities: [{ key: '1058' }], excluded: [] } }, { geoCities: ['999'] });
  assert.deepEqual(t.geo_locations, { cities: [{ key: '1058' }] });
});
