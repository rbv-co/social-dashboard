// SP-4: monta o adset.targeting a partir de um `publico` (preset ou config inline) + a loja.
// Nunca deixa sem geo: sem cidades no publico, usa as cidades da loja (evita público mundial).
export function montarTargeting(publico, loja) {
  const cidadesLoja = (loja?.geoCities || []).map((key) => ({ key }));
  if (!publico) return { geo_locations: { cities: cidadesLoja } };

  const t = {};
  const cities = (publico.geo?.cities || []).map((c) => {
    const o = { key: c.key };
    if (c.radius) {
      // Meta rejeita raio de cidade abaixo do mínimo (~17 km / 10 mi) com code 1487110 —
      // clamp defensivo pra subida nunca falhar por raio curto (validado ao vivo 2026-07-12).
      const unit = c.distance_unit || 'kilometer';
      const min = unit === 'mile' ? 10 : 17;
      o.radius = c.radius < min ? min : c.radius;
      o.distance_unit = unit;
    }
    return o;
  });
  // AS QUATRO FORMAS DE MIRAR UM LUGAR (13/08/2026). Antes só existia cidade;
  // o editor passou a oferecer Brasil, Estado, Cidade e Local (ponto com raio).
  // A cidade da loja continua sendo a rede contra público mundial — mas só
  // quando NÃO há lugar nenhum, senão ela entraria por baixo de uma escolha
  // deliberada do dono e alargaria o anúncio sem ninguém pedir.
  const geo = {};
  if (cities.length) geo.cities = cities;
  const paises = (publico.geo?.countries || []).map((c) => String(c?.key ?? c)).filter(Boolean);
  if (paises.length) geo.countries = paises;
  const estados = (publico.geo?.regions || []).filter((r) => r && r.key != null).map((r) => ({ key: String(r.key) }));
  if (estados.length) geo.regions = estados;
  const pontos = (publico.geo?.pins || [])
    .filter((p) => p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)))
    .map((p) => {
      const o = {
        latitude: Number(Number(p.lat).toFixed(6)),
        longitude: Number(Number(p.lng).toFixed(6)),
        radius: Number(p.raio) > 0 ? Number(p.raio) : 1,
        distance_unit: p.unidade === 'mile' ? 'mile' : 'kilometer',
        country: p.pais || 'BR',
      };
      if (p.nome) { o.name = p.nome; o.address_string = p.endereco || p.nome; }
      return o;
    });
  if (pontos.length) geo.custom_locations = pontos;
  if (!Object.keys(geo).length) geo.cities = cidadesLoja;
  t.geo_locations = geo;

  const excl = publico.geo?.excluded || [];
  if (excl.length) {
    const ex = {};
    for (const e of excl) {
      const bucket = e.type === 'region' ? 'regions' : 'cities';
      (ex[bucket] ||= []).push({ key: e.key });
    }
    t.excluded_geo_locations = ex;
  }

  if (publico.idade_min != null) t.age_min = publico.idade_min;
  if (publico.idade_max != null) t.age_max = publico.idade_max;
  if (publico.generos?.length) t.genders = publico.generos;
  // INTERESSES E COMPORTAMENTOS NA MESMA ENTRADA do flexible_spec: entradas
  // diferentes se somam com E (aperta o público), chaves dentro da mesma se
  // somam com OU. Separá-los faria "gosta de Bolsas E é comprador engajado",
  // que é um público muito menor do que o público salvo original.
  //
  // `comportamentos` só existe quando o público veio de um PÚBLICO SALVO da
  // conta — o editor não os cria. Ausente, nada muda (retrocompatível com a
  // Fábrica, que nunca os manda).
  const flex = {};
  if (publico.interesses?.length) flex.interests = publico.interesses.map((i) => ({ id: i.id, name: i.name }));
  if (publico.comportamentos?.length) flex.behaviors = publico.comportamentos.map((b) => ({ id: b.id, name: b.name }));
  if (Object.keys(flex).length) t.flexible_spec = [flex];
  if (publico.custom_audiences?.length) t.custom_audiences = publico.custom_audiences.map((a) => ({ id: a.id }));
  // Meta liga o Advantage+ Audience por padrão e aí REJEITA segmentação manual de idade/gênero/
  // interesses (code 1870227). Como aqui o usuário definiu um público à mão, opta por sair —
  // as restrições viram limites de verdade (validado ao vivo 2026-07-12).
  t.targeting_automation = { advantage_audience: 0 };
  return t;
}
