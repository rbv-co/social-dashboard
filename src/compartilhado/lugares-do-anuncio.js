// UM LUGAR ONDE O ANÚNCIO APARECE — e as quatro formas que a Meta entende.
//
// PEDIDO DO DONO (13/08/2026): "eu preciso selecionar entre Brasil, Estado,
// Cidade e Local (estabelecimento, comércio, negócio) e aparece o pin automático
// no mapa e vice versa".
//
// POR QUE ESTE MÓDULO EXISTE: a tela mostra UMA lista ("os lugares deste
// anúncio"), mas a Meta guarda isso em QUATRO chaves diferentes de
// `geo_locations` — `countries`, `regions`, `cities` e `custom_locations`. Aqui
// mora a tradução, nos dois sentidos, e só ela. Sem tela e sem rede.
//
// MEDIDO na Graph API em 13/08/2026, e é o que obriga o desenho:
//   • a busca da Meta NÃO devolve coordenada (nem `adgeolocation` nem
//     `adgeolocationmeta`) — quem dá coordenada é o mapa, não ela;
//   • a Meta NÃO tem busca de estabelecimento (`location_types:["place"]`
//     devolve lista vazia). "Local" não é chave dela: é ponto com raio.

export const LUGAR_TIPOS = [
  { id: 'pais', rotulo: 'Brasil' },
  { id: 'estado', rotulo: 'Estado' },
  { id: 'cidade', rotulo: 'Cidade' },
  { id: 'local', rotulo: 'Local' },
];

// País só existe como área inteira: um ponto com raio no centro geográfico do
// Brasil não mira nada que alguém queira. Decisão do dono, 13/08/2026.
export function podeVirarPonto(tipo) {
  return tipo !== 'pais';
}

const lista = (v) => (Array.isArray(v) ? v : []);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

export function deListas(listas) {
  const l = listas || {};
  const saida = [];
  for (const p of lista(l.paises)) {
    if (p == null || p.key == null) continue;
    saida.push({ tipo: 'pais', chave: String(p.key), nome: p.nome || String(p.key), uf: '', comoMirar: 'area' });
  }
  for (const e of lista(l.estados)) {
    if (e == null || e.key == null) continue;
    saida.push({ tipo: 'estado', chave: String(e.key), nome: e.nome || String(e.key), uf: '', comoMirar: 'area' });
  }
  for (const c of lista(l.cidades)) {
    if (c == null || c.key == null) continue;
    saida.push({
      tipo: 'cidade', chave: String(c.key), nome: c.nome || String(c.key), uf: '',
      comoMirar: 'area', raio: Number(c.raio) || 0, unidade: c.unidade || 'kilometer',
    });
  }
  // TODO PIN VOLTA COMO "LOCAL", inclusive o que nasceu de uma cidade: para a
  // Meta os dois são o mesmo `custom_location`, e ela não guarda de onde veio.
  for (const pin of lista(l.pins)) {
    if (pin == null) continue;
    saida.push({
      tipo: 'local', chave: null, nome: pin.nome || '', uf: '', endereco: pin.endereco || '',
      comoMirar: 'ponto', lat: num(pin.lat), lng: num(pin.lng),
      raio: Number(pin.raio) || 1, unidade: pin.unidade || 'kilometer',
      pais: pin.pais || 'BR', cidadeId: pin.cidadeId ?? null, regiaoId: pin.regiaoId ?? null,
    });
  }
  return saida;
}

export function paraListas(lugares) {
  const saida = { paises: [], estados: [], cidades: [], pins: [] };
  for (const l of lista(lugares)) {
    if (l == null) continue;
    // PONTO: vale para qualquer tipo que aceite ponto, e sempre vira
    // custom_location. Sem coordenada não grava nada — a Meta recusaria, e um
    // lugar que some ao salvar sem avisar é pior que um erro na cara.
    if (l.comoMirar === 'ponto' && podeVirarPonto(l.tipo)) {
      const lat = num(l.lat); const lng = num(l.lng);
      if (lat == null || lng == null) continue;
      saida.pins.push({
        lat, lng, raio: Number(l.raio) > 0 ? Number(l.raio) : 1,
        unidade: l.unidade === 'mile' ? 'mile' : 'kilometer',
        nome: l.nome || '', endereco: l.endereco || '',
        pais: l.pais || 'BR', cidadeId: l.cidadeId ?? null, regiaoId: l.regiaoId ?? null,
      });
      continue;
    }
    if (l.chave == null || l.chave === '') continue;
    if (l.tipo === 'pais') saida.paises.push({ key: String(l.chave), nome: l.nome || String(l.chave) });
    else if (l.tipo === 'estado') saida.estados.push({ key: String(l.chave), nome: l.nome || String(l.chave) });
    else if (l.tipo === 'cidade') {
      saida.cidades.push({
        key: String(l.chave), nome: l.nome || String(l.chave),
        raio: Number(l.raio) || 0, unidade: l.unidade === 'mile' ? 'mile' : 'kilometer',
      });
    }
  }
  return saida;
}

// JÁ ESTÁ NA LISTA? Duas identidades diferentes, porque os lugares têm duas
// naturezas: o que vem da Meta é a CHAVE (mesma chave e mesmo tipo = mesmo
// lugar), e o que vem do mapa é a COORDENADA. Sem isto, clicar duas vezes no
// mesmo resultado duplicaria a segmentação — e público duplicado não dá erro
// nenhum na Meta, só gasta.
export function jaEstaNaLista(lugares, achado) {
  if (!achado) return false;
  return lista(lugares).some((l) => {
    if (l == null) return false;
    if (l.chave != null && achado.chave != null) {
      return String(l.chave) === String(achado.chave) && l.tipo === achado.tipo;
    }
    const a = num(l.lat); const b = num(l.lng);
    const c = num(achado.lat); const d = num(achado.lng);
    return a != null && c != null && a === c && b === d;
  });
}

// O que a pessoa lê na linha. Nunca devolve vazio: ponto sem nome mostra a
// coordenada, que é feia mas verdadeira — melhor que uma linha em branco.
export function rotuloDoLugar(lugar) {
  const l = lugar || {};
  const complemento = l.uf || l.endereco || '';
  if (l.nome) return complemento ? `${l.nome} · ${complemento}` : l.nome;
  const lat = num(l.lat); const lng = num(l.lng);
  if (lat != null && lng != null) return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  return String(l.chave || 'sem nome');
}
