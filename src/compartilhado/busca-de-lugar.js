// PROCURAR UM LUGAR PELO NOME, E DESCOBRIR QUE LUGAR É UMA COORDENADA.
//
// PURO: sem tela e sem rede. Monta a pergunta e traduz a resposta; quem faz a
// chamada é a tela, e quem fala com o mundo lá fora é a Edge Function
// `buscar-lugar`.
//
// POR QUE SÃO DOIS FORNECEDORES, medido na Graph API em 13/08/2026:
//   • Brasil, Estado e Cidade saem do catálogo da META, porque é a CHAVE dela
//     que segmenta o anúncio — mas ela não devolve coordenada nenhuma;
//   • "Local" (comércio, endereço) a Meta simplesmente não tem:
//     `location_types:["place"]` para "Shopping" devolveu lista vazia. Isso vem
//     do MAPA, e vira ponto com raio (`custom_locations`).

const TIPO_DA_META = { pais: 'country', estado: 'region', cidade: 'city' };

// O caminho de volta: o que a Meta chama, e como a tela chama.
const TIPO_DA_TELA = {
  country: 'pais', region: 'estado', city: 'cidade',
  neighborhood: 'bairro', subcity: 'bairro', subneighborhood: 'bairro',
};

export function pedidoDaBusca(tipo, termo) {
  const q = String(termo || '').trim();
  if (tipo === 'local') return { onde: 'mapa', params: { termo: q } };
  const daMeta = TIPO_DA_META[tipo] || 'city';
  return {
    onde: 'meta',
    params: { type: 'adgeolocation', location_types: JSON.stringify([daMeta]), q, limit: 15 },
  };
}

export function lugaresDaRespostaDaMeta(resposta) {
  const linhas = Array.isArray(resposta && resposta.data) ? resposta.data : [];
  return linhas.filter((x) => x && x.key != null).map((x) => ({
    // O TIPO REAL DA LINHA, não o que foi pedido: pedindo só `city` a Meta
    // devolve bairro junto (medido). Sem isto a pessoa acrescenta um bairro
    // achando que acrescentou uma cidade.
    tipo: TIPO_DA_TELA[x.type] || 'cidade',
    tipoDaMeta: x.type || '',
    chave: String(x.key),
    nome: x.name || String(x.key),
    uf: x.region || x.country_name || '',
    comoMirar: 'area',
    raio: 0, unidade: 'kilometer',
    // A Meta NÃO devolve coordenada. Fica nulo de propósito: inventar um número
    // aqui seria pôr o anúncio noutro lugar.
    lat: null, lng: null,
  }));
}

// "BR-MG" → "MG". A sigla é o que cabe na linha e é o que o dono lê rápido.
function siglaDoEstado(endereco) {
  const iso = (endereco && (endereco['ISO3166-2-lvl4'] || endereco['ISO3166-2-lvl9'])) || '';
  const parte = String(iso).split('-')[1];
  return parte || (endereco && endereco.state) || '';
}

function enderecoEmLinha(endereco) {
  const e = endereco || {};
  const cidade = e.city || e.town || e.village || e.municipality || '';
  return [e.road, e.suburb, cidade, siglaDoEstado(e)].filter(Boolean).join(' · ');
}

export function lugaresDaRespostaDoMapa(resposta) {
  const linhas = Array.isArray(resposta) ? resposta : (resposta && resposta.lugares) || [];
  return (Array.isArray(linhas) ? linhas : []).filter((x) => x && x.lat != null && x.lon != null).map((x) => ({
    tipo: 'local',
    chave: null,
    nome: x.name || String(x.display_name || '').split(',')[0] || '',
    uf: '',
    endereco: enderecoEmLinha(x.address),
    comoMirar: 'ponto',
    lat: Number(x.lat), lng: Number(x.lon),
    // 1 km é o raio que os conjuntos reais mais repetem (a Mantova usa isso nos
    // pins de condomínio) — não é chute nosso.
    raio: 1, unidade: 'kilometer', pais: 'BR',
  }));
}

export function enderecoDeOndeCaiu(resposta) {
  const r = resposta || {};
  return { nome: r.name || '', endereco: enderecoEmLinha(r.address) };
}

// UMA PERGUNTA POR VEZ. O serviço de mapa é comunitário e pede no máximo uma
// chamada por segundo. Sete cliques no mapa enfileiram sete perguntas em vez de
// disparar sete juntas — que é o jeito mais rápido de ser bloqueado, e bloqueio
// aqui vira busca que não devolve nada, em silêncio.
export function criarFilaDeUmPorVez(opcoes) {
  const o = opcoes || {};
  const esperar = o.esperar || ((ms) => new Promise((ok) => setTimeout(ok, ms)));
  const intervalo = o.intervalo == null ? 1100 : o.intervalo;
  let ultima = Promise.resolve();
  let jaRodouUma = false;
  return function enfileirar(tarefa) {
    const minha = ultima.then(async () => {
      if (jaRodouUma && intervalo > 0) await esperar(intervalo);
      jaRodouUma = true;
      return tarefa();
    });
    // A fila não pode morrer com uma pergunta que falhou: quem pediu recebe o
    // erro, mas a próxima da fila continua de pé.
    ultima = minha.then(() => undefined, () => undefined);
    return minha;
  };
}
