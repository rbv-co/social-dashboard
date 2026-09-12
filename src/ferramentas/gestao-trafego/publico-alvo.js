// Editar o público de um conjunto de anúncios da Meta.
//
// MÓDULO PURO: sem tela, sem rede. Traduz o `targeting` da Meta nos dois
// sentidos, resume o que mudou e gera os avisos.
//
// O PERIGO QUE MOLDA ESTE ARQUIVO: o `targeting` é UM PACOTE SÓ. Além do que
// este editor mexe, ele carrega onde o anúncio aparece (feed, story, reels),
// em que aparelhos e em que idiomas. Montar esse pacote só com os campos
// editados e mandar de volta APAGARIA todo o resto, em silêncio — o dono
// trocaria uma cidade e o conjunto pararia de rodar no Instagram Stories sem
// nada avisar. Por isso montarTargeting (Task 2) parte do original.

// A REGRA QUE VALE EM TODO NÍVEL: ler o que gerenciamos e escrever DE VOLTA
// DENTRO do que foi lido — nunca montar um objeto do zero no lugar de um que
// já existia. Vale para o `targeting` inteiro, para o `geo_locations`, para o
// `excluded_geo_locations` e para cada entrada do `flexible_spec`. Montar um
// container novo um nível abaixo apaga em silêncio o que morava ao lado.
import { lerPosicionamentos, gravarPosicionamentos, resumoDosPosicionamentos, estreitou, POSICIONAMENTO_AUTOMATICO } from './posicionamentos.js';

export const PUBLICO_VAZIO = {
  cidades: [], excluidas: [],
  // PAÍS E ESTADO (13/08/2026). Saíram de CHAVES_DE_LOCALIZACAO — ver o
  // comentário daquela lista. A FORMA DOS DOIS É DIFERENTE na Meta e isso é
  // armadilha: `countries` é lista de STRINGS ("BR"), `regions` é lista de
  // objetos com `key`. Ler as duas do mesmo jeito devolve undefined calado.
  paises: [], estados: [],
  idadeMin: 18, idadeMax: 65,
  generos: [], interesses: [], comportamentos: [],
  incluir: [], excluir: [],
  advantagePlus: true,
  // O conjunto TRAZIA o campo advantage_audience da Meta? Quando não trazia, o
  // `advantagePlus: true` acima é PALPITE (o padrão da Meta), e palpite não
  // pode virar valor gravado. Ver montarTargeting.
  advantagePlusDeclarado: false,
  outrasLocalizacoes: [],
  // PIN no mapa (`custom_locations`). Medido em 12/08/2026: 26 dos 292 conjuntos
  // ja usam isto — a Mantova segmenta condominio assim.
  pins: [],
  // ONDE O ANÚNCIO APARECE. Automático é o estado de 44 dos 50 conjuntos da
  // conta (medido), então é ele que tem de ser o padrão aqui — o contrário faria
  // o editor propor "escolhido à mão" a quem nunca escolheu nada.
  posicionamentos: POSICIONAMENTO_AUTOMATICO,
};

import { pinDaMeta, pinParaMeta } from './mapa-de-pins.js';

const lista = (v) => (Array.isArray(v) ? v : []);
const nomeDe = (o) => (o && (o.name || o.nome)) || '';

// Interesses podem estar em QUALQUER entrada do flexible_spec — a Meta usa
// esse array para combinar grupos (interesses, comportamentos, eventos de
// vida). Ler só a primeira entrada perderia interesses de verdade.
function interessesDe(targeting) {
  const flex = lista(targeting && targeting.flexible_spec);
  const achados = [];
  for (const grupo of flex) {
    for (const i of lista(grupo && grupo.interests)) {
      if (i && i.id != null) achados.push({ id: String(i.id), name: nomeDe(i) });
    }
  }
  return achados;
}

// COMPORTAMENTOS moram no MESMO `flexible_spec` dos interesses, e o editor não
// os desenha. Ler mesmo assim não é capricho: os públicos salvos desta conta
// trazem "Engaged Shoppers" e "Frequent Travelers", e um público aplicado sem
// eles é um público DIFERENTE — mais largo, e não é o que a pessoa escolheu.
//
// Ao editar um conjunto que já existe eles se preservam sozinhos (montarTargeting
// copia as outras chaves de cada entrada). Quem precisa dessa lista é a CAMPANHA
// NOVA, que monta o targeting do zero e os perderia em silêncio.
function comportamentosDe(targeting) {
  const flex = lista(targeting && targeting.flexible_spec);
  const achados = [];
  for (const grupo of flex) {
    for (const b of lista(grupo && grupo.behaviors)) {
      if (b && b.id != null) achados.push({ id: String(b.id), name: nomeDe(b) });
    }
  }
  return achados;
}

// Cidade excluída também pode ter RAIO (excluir 25 km em volta de uma cidade
// não é a mesma coisa que excluir só a mancha urbana dela). O raio só entra na
// forma simples quando existe no original — assim a cidade sem raio continua
// exatamente com a mesma forma de antes.
function excluidasDe(targeting) {
  const ex = (targeting && targeting.excluded_geo_locations) || {};
  const fora = [];
  for (const c of lista(ex.cities)) {
    if (!c || c.key == null) continue;
    const item = { key: String(c.key), nome: nomeDe(c), tipo: 'cidade' };
    if (c.radius != null) {
      item.raio = Number(c.radius);
      item.unidade = c.distance_unit || 'kilometer';
    }
    fora.push(item);
  }
  for (const r of lista(ex.regions)) if (r && r.key != null) fora.push({ key: String(r.key), nome: nomeDe(r), tipo: 'regiao' });
  return fora;
}

// LISTA DE PERMISSÃO DE LUGARES DE VERDADE — e a linha que ela desenha tem os
// dois lados perigosos. Quem for acrescentar chave aqui precisa saber de que
// lado a sua está:
//
//   DENTRO  → só o que mira um LUGAR. Esquecer um tipo de lugar aqui é pior do
//             que parece: um conjunto mirado SÓ por esse tipo passa a contar
//             como "sem localização nenhuma" e o Salvar trava, sem o dono ter
//             mudado nada — e a única saída seria acrescentar uma cidade que
//             ele nunca quis.
//   FORA    → tudo que é configuração e mora no mesmo objeto. O caso que deu
//             errado é o `location_types` (["home","recent"]), presente em
//             quase todo conjunto criado no Gerenciador: contado como lugar,
//             ele furava o bloqueio obrigatório da Meta (conjunto sem cidade
//             nenhuma salvava e não mirava em lugar algum) e ainda disparava o
//             aviso "este conjunto tem outra localização" em quase todo
//             conjunto — aviso que aparece sempre é aviso que ninguém lê.
//
// Chave que não está aqui continua PRESERVADA ao salvar de qualquer jeito (a
// escrita espalha o objeto inteiro); o que esta lista decide é só o que CONTA
// como lugar. Toda chave listada precisa de um nome em português em
// NOMES_LOCALIZACOES, senão o dono leria a chave crua em inglês no aviso.
export const CHAVES_DE_LOCALIZACAO = [
  'country_groups', 'zips',
  'places', 'geo_markets', 'metro_areas', 'electoral_districts',
  'medium_geo_areas', 'small_geo_areas', 'subcities', 'neighborhoods',
  'subneighborhoods', 'location_cluster_ids',
];

// `custom_locations` (o PIN no mapa) saiu desta lista em 12/08/2026: o editor
// passou a GERENCIAR pin, com mapa e tudo. Deixá-lo aqui faria a tela avisar
// "há localidades que eu não mexo" sobre justamente o que ela agora edita —
// e o aviso viraria mentira.
//
// `countries` e `regions` saíram em 13/08/2026 pelo mesmo motivo: o editor
// passou a desenhar Brasil e Estado, com escolha entre "a área inteira" e
// "ponto com raio". A obrigação que vem junto está cumprida logo abaixo — os
// dois são lidos, gravados e CONTAM no bloqueio de "sem localização".

// Localidades que o editor não gerencia, mas que devem ser preservadas.
// Devolve os nomes das chaves de geo_locations que são lugar e têm conteúdo.
function outrasLocalizacoesDe(targeting) {
  const geo = (targeting && targeting.geo_locations) || {};
  const outras = [];
  for (const chave of CHAVES_DE_LOCALIZACAO) {
    if (lista(geo[chave]).length > 0) outras.push(chave);
  }
  return outras;
}

// Traduz o público como a Meta devolve para uma forma simples de trabalhar.
// Nunca lança: público ausente ou malformado devolve a forma padrão, porque
// travar a tela por causa de um campo estranho seria pior que mostrar vazio.
export function lerPublico(targeting) {
  const t = targeting && typeof targeting === 'object' ? targeting : {};
  const geo = t.geo_locations || {};
  const auto = t.targeting_automation || {};
  return {
    cidades: lista(geo.cities).filter((c) => c && c.key != null).map((c) => ({
      key: String(c.key),
      nome: nomeDe(c),
      raio: c.radius == null ? 0 : Number(c.radius),
      unidade: c.distance_unit || 'kilometer',
    })),
    excluidas: excluidasDe(t),
    // A FORMA DE CADA UM É DIFERENTE, e a diferença é armadilha: `countries` é
    // lista de strings ("BR"), `regions` é lista de objetos ({key, name}).
    // `countries` chega da Meta como lista de strings — mas aceitar `{key}`
    // também custa uma linha e evita gravar "[object Object]" como país se um
    // dia vier no outro formato. País errado é anúncio no país errado.
    paises: lista(geo.countries)
      .map((c) => (c && typeof c === 'object' ? c.key : c))
      .filter((c) => c != null && String(c) !== '')
      .map((c) => ({ key: String(c), nome: String(c) })),
    estados: lista(geo.regions).filter((r) => r && r.key != null).map((r) => ({ key: String(r.key), nome: nomeDe(r) || String(r.key) })),
    idadeMin: t.age_min == null ? PUBLICO_VAZIO.idadeMin : Number.isFinite(Number(t.age_min)) ? Number(t.age_min) : PUBLICO_VAZIO.idadeMin,
    idadeMax: t.age_max == null ? PUBLICO_VAZIO.idadeMax : Number.isFinite(Number(t.age_max)) ? Number(t.age_max) : PUBLICO_VAZIO.idadeMax,
    generos: lista(t.genders).map(Number),
    interesses: interessesDe(t),
    // Lidos e carregados, não editados — ver comportamentosDe.
    comportamentos: comportamentosDe(t),
    incluir: lista(t.custom_audiences).filter((a) => a && a.id != null).map((a) => ({ id: String(a.id), name: nomeDe(a) })),
    excluir: lista(t.excluded_custom_audiences).filter((a) => a && a.id != null).map((a) => ({ id: String(a.id), name: nomeDe(a) })),
    // Ausente = padrão da Meta = LIGADO. Assumir desligado faria a tela mentir
    // sobre o estado atual da conta do dono. Mas isso é PALPITE, e o palpite
    // fica marcado ao lado para não ser gravado como se fosse fato.
    advantagePlus: auto.advantage_audience == null ? true : Number(auto.advantage_audience) === 1,
    advantagePlusDeclarado: auto.advantage_audience != null,
    // Localidades que o editor não gerencia (regiões, países, CEPs, etc.).
    // Descritivo apenas; montarTargeting ignora esse campo e preserva as outras
    // localidades direto do original.
    outrasLocalizacoes: outrasLocalizacoesDe(t),
    pins: lista(geo.custom_locations)
      .filter((c) => c && Number.isFinite(Number(c.latitude)) && Number.isFinite(Number(c.longitude)))
      .map(pinDaMeta),
    posicionamentos: lerPosicionamentos(t),
  };
}

// A Meta recusa raio de cidade abaixo disso (código 1487110, apanhado ao vivo
// em 2026-07-12). Raio 0 é caso à parte: significa "a cidade inteira".
export const RAIO_MINIMO_KM = 17;
export const RAIO_MINIMO_MI = 10;

function cidadeParaMeta(c, ajustes) {
  if (c == null || c.key == null) return null;
  const saida = { key: String(c.key) };
  const raio = Number(c.raio) || 0;
  if (raio > 0) {
    const unidade = c.unidade === 'mile' ? 'mile' : 'kilometer';
    const minimo = unidade === 'mile' ? RAIO_MINIMO_MI : RAIO_MINIMO_KM;
    if (raio < minimo) {
      ajustes.push({ cidade: c.nome || String(c.key), de: raio, para: minimo, unidade });
      saida.radius = minimo;
    } else {
      saida.radius = raio;
    }
    saida.distance_unit = unidade;
  }
  return saida;
}

// Reescreve os interesses DENTRO das entradas que já existem no flexible_spec,
// sem nunca remontar o array.
//
// COMO A META LÊ ESSE ARRAY (é o que faz a diferença entre alcançar 50 mil e
// alcançar 5 milhões de pessoas):
//   • entradas DIFERENTES do array se somam com E (tem que valer as duas);
//   • chaves DENTRO da mesma entrada se somam com OU.
// Ou seja: [{interests:[Moda]}, {interests:[Luxo]}] é "gosta de Moda E de
// Luxo"; [{interests:[Moda, Luxo]}] é "gosta de Moda OU de Luxo" — público
// muito maior. E [{interests:[Moda], behaviors:[Viajantes]}] guarda um
// comportamento que mora na MESMA entrada que o interesse.
//
// Por isso aqui: cada entrada é copiada, só a lista `interests` dela é
// filtrada, e as outras chaves passam intactas. Interesse novo entra na
// primeira entrada que já mandava nos interesses (ou numa entrada nova, se
// nenhuma mandava) — nunca vira uma entrada solta que apertaria o público com
// um E que o dono não pediu.
function flexComInteresses(originalFlex, interesses) {
  const orig = Array.isArray(originalFlex) ? originalFlex : [];
  // Filtra nulls de interesses: a Meta manda nome na leitura, mas não valida na escrita.
  const querem = interesses.filter((i) => i != null && i.id != null);
  const idsQueridos = new Set(querem.map((i) => String(i.id)));

  // Tudo que JÁ estava em alguma entrada. O que não estiver aqui é interesse
  // que o dono acabou de acrescentar.
  const jaEstavam = new Set();
  for (const grupo of orig)
    for (const i of lista(grupo && grupo.interests))
      if (i && i.id != null) jaEstavam.add(String(i.id));

  let dona = -1;   // entrada que manda nos interesses (a primeira que os tinha)
  const entradas = [];
  for (const grupo of orig) {
    if (grupo == null || typeof grupo !== 'object') continue;
    if (!Array.isArray(grupo.interests)) { entradas.push(grupo); continue; }
    const mantidos = grupo.interests.filter((i) => i != null && i.id != null && idsQueridos.has(String(i.id)));
    const copia = { ...grupo };
    // Entrada que perdeu todos os interesses só perde ESSA chave — o que
    // estava ao lado (comportamentos, eventos de vida) continua de pé.
    if (mantidos.length) copia.interests = mantidos;
    else delete copia.interests;
    if (dona < 0) dona = entradas.length;
    entradas.push(copia);
  }

  const novos = [];
  const vistos = new Set();
  for (const i of querem) {
    const id = String(i.id);
    if (jaEstavam.has(id) || vistos.has(id)) continue;
    vistos.add(id);
    novos.push({ id, name: i.name });
  }
  if (novos.length) {
    if (dona < 0) entradas.push({ interests: novos });
    else entradas[dona] = { ...entradas[dona], interests: [...lista(entradas[dona].interests), ...novos] };
  }

  // Entrada que ficou completamente vazia desaparece; as demais sobrevivem.
  const saida = entradas.filter((e) => Object.keys(e).length > 0);
  return saida.length ? saida : null;
}

// Escreve o público de volta no formato da Meta.
//
// PARTE DO ORIGINAL e sobrescreve só as chaves gerenciadas. Toda chave que
// este editor não conhece passa intacta. Campo gerenciado que ficou vazio é
// REMOVIDO do pacote em vez de ir como lista vazia — a Meta trata `[]` e
// ausente de formas diferentes.
export function montarTargeting(publico, original) {
  const t = Object.assign({}, original && typeof original === 'object' ? original : {});
  const p = Object.assign({}, PUBLICO_VAZIO, publico || {});
  const ajustes = [];
  const põe = (chave, valor) => { if (valor == null) delete t[chave]; else t[chave] = valor; };

  // Preserva outras localidades (regiões, países, etc.) que o editor não gerencia.
  // Começa do original e sobrescreve só o campo 'cities'. Se as cidades ficarem
  // vazias, deleta apenas esse campo, mantendo o resto. Deleta geo_locations
  // inteira só se nada restar.
  const cidsFiltered = p.cidades.filter((c) => c != null).map((c) => cidadeParaMeta(c, ajustes)).filter((c) => c != null);
  const geoOriginal = (t.geo_locations && typeof t.geo_locations === 'object') ? { ...t.geo_locations } : {};
  if (cidsFiltered.length) {
    geoOriginal.cities = cidsFiltered;
  } else {
    delete geoOriginal.cities;
  }
  // OS PINS, com o mesmo cuidado das cidades: sobrescreve a chave e some com ela
  // quando nao sobra nenhum. Mandar `[]` nao e a mesma coisa que nao mandar.
  const pinsFiltered = (p.pins || []).filter((x) => x && Number.isFinite(Number(x.lat)) && Number.isFinite(Number(x.lng))).map(pinParaMeta);
  if (pinsFiltered.length) {
    geoOriginal.custom_locations = pinsFiltered;
  } else {
    delete geoOriginal.custom_locations;
  }
  // PAÍS E ESTADO, com o mesmo cuidado das cidades: sobrescreve a chave e some
  // com ela quando não sobra nenhum. Mandar `[]` não é a mesma coisa que não
  // mandar. País vai como string crua; estado, como objeto com `key`.
  const paisesFiltrados = (p.paises || []).filter((x) => x != null && x.key != null).map((x) => String(x.key));
  if (paisesFiltrados.length) geoOriginal.countries = paisesFiltrados;
  else delete geoOriginal.countries;
  const estadosFiltrados = (p.estados || []).filter((x) => x != null && x.key != null).map((x) => ({ key: String(x.key) }));
  if (estadosFiltrados.length) geoOriginal.regions = estadosFiltrados;
  else delete geoOriginal.regions;

  // Deleta geo_locations inteira só se nenhuma outra localização restar
  if (Object.keys(geoOriginal).length) {
    t.geo_locations = geoOriginal;
  } else {
    delete t.geo_locations;
  }

  // MESMO TRATAMENTO DO geo_locations, pela mesma razão. Um conjunto pode
  // excluir CEP, ponto no mapa (custom_locations) e cidade ao mesmo tempo; o
  // editor só desenha cidade e região. Montar esse objeto do zero apagava o
  // resto — e o dono, que só queria trocar uma idade, voltava a anunciar num
  // lugar que tinha excluído de propósito, sem uma linha de aviso.
  const excluirCidade = (e) => {
    const saida = { key: String(e.key) };
    // O raio da cidade excluída vem da Meta e não é editável aqui: viaja de
    // volta como estava, sem passar pelo mínimo (mexer num número que o dono
    // não vê seria trocar a exclusão dele por outra).
    const raio = Number(e.raio) || 0;
    if (raio > 0) {
      saida.radius = raio;
      saida.distance_unit = e.unidade === 'mile' ? 'mile' : 'kilometer';
    }
    return saida;
  };
  const cid = p.excluidas.filter((e) => e != null && e.key != null && e.tipo !== 'regiao').map(excluirCidade);
  const reg = p.excluidas.filter((e) => e != null && e.key != null && e.tipo === 'regiao').map((e) => ({ key: String(e.key) }));
  const foraOriginal = (t.excluded_geo_locations && typeof t.excluded_geo_locations === 'object') ? { ...t.excluded_geo_locations } : {};
  if (cid.length) foraOriginal.cities = cid; else delete foraOriginal.cities;
  if (reg.length) foraOriginal.regions = reg; else delete foraOriginal.regions;
  põe('excluded_geo_locations', Object.keys(foraOriginal).length ? foraOriginal : null);

  põe('age_min', Number(p.idadeMin));
  põe('age_max', Number(p.idadeMax));
  // A Meta só conhece 1 (homens) e 2 (mulheres). Qualquer outra coisa é lixo —
  // e 0 é o lixo mais perigoso, porque Number(null) vale 0 e passaria batido.
  const gerosValid = p.generos.filter((g) => g != null).map(Number).filter((g) => g === 1 || g === 2);
  põe('genders', gerosValid.length ? gerosValid : null);
  põe('flexible_spec', flexComInteresses(t.flexible_spec, p.interesses));
  const incluirValid = p.incluir.filter((a) => a != null && a.id != null).map((a) => ({ id: String(a.id) }));
  põe('custom_audiences', incluirValid.length ? incluirValid : null);
  const excluirValid = p.excluir.filter((a) => a != null && a.id != null).map((a) => ({ id: String(a.id) }));
  põe('excluded_custom_audiences', excluirValid.length ? excluirValid : null);
  // ADVANTAGE+ SÓ VAI PRO PACOTE SE FOR FATO, NUNCA SE FOR PALPITE.
  // Quando o conjunto não traz advantage_audience, a leitura mostra "ligado"
  // porque é o padrão da Meta — mas gravar esse palpite LIGARIA o Advantage+
  // sozinho, em todo salvamento, mudando quem vê os anúncios sem uma linha no
  // resumo (true comparado com true não gera diferença nenhuma). Então: só
  // escreve se o campo já existia no conjunto ou se o dono mexeu no
  // interruptor de verdade.
  const autoOriginal = (t.targeting_automation && typeof t.targeting_automation === 'object') ? t.targeting_automation : null;
  const jaTinha = !!(autoOriginal && autoOriginal.advantage_audience != null);
  const comoEstava = jaTinha ? Number(autoOriginal.advantage_audience) === 1 : true;
  const donoMexeu = !!p.advantagePlus !== comoEstava;
  if (jaTinha || p.advantagePlusDeclarado || donoMexeu)
    põe('targeting_automation', { ...(autoOriginal || {}), advantage_audience: p.advantagePlus ? 1 : 0 });

  // ONDE O ANÚNCIO APARECE — por último, e sobre o `t` já montado, porque
  // `gravarPosicionamentos` também parte do original e preserva o que não
  // desenha (`whatsapp_positions`, `device_platforms`). Rodar antes faria as
  // atribuições acima passarem por cima do que ele acabou de decidir.
  const comPlacements = gravarPosicionamentos(t, p.posicionamentos);
  return { targeting: comPlacements, ajustes };
}

const GENERO_NOME = { 1: 'homens', 2: 'mulheres' };

// Formata nome para display: mostra "sem nome" se vazio, nunca codigo sozinho.
function nomePara(x, chave) {
  const nome = x.nome || x.name;
  if (nome) return nome;
  return `sem nome (${chave})`;
}

// Compara duas listas por chave e devolve "+entrou, −saiu" com NOMES.
// Código de cidade e id de interesse não significam nada para o dono.
// Null ou sem chave/id é saltado — nunca quebra.
function diffLista(antes, depois, chaveDe, rotulo) {
  const mapa = (arr) => new Map(
    (arr || [])
      .filter((x) => x != null && chaveDe(x) != null)
      .map((x) => {
        const chave = String(chaveDe(x));
        const nome = nomePara(x, chave);
        return [chave, nome];
      })
  );
  const a = mapa(antes), d = mapa(depois);
  const entrou = [...d].filter(([k]) => !a.has(k)).map(([, n]) => '+' + n);
  const saiu = [...a].filter(([k]) => !d.has(k)).map(([, n]) => '−' + n);
  if (!entrou.length && !saiu.length) return null;
  return rotulo + ': ' + [...entrou, ...saiu].join(', ');
}

// Lista em português do que mudou entre dois públicos. É o que o dono lê
// antes de confirmar — por isso nomes, nunca códigos.
export function resumoDasMudancas(antes, depois) {
  const a = Object.assign({}, PUBLICO_VAZIO, antes || {});
  const d = Object.assign({}, PUBLICO_VAZIO, depois || {});
  const linhas = [];

  const cid = diffLista(a.cidades, d.cidades, (x) => x.key, 'Cidades');
  if (cid) linhas.push(cid);

  // País e estado entram no resumo pela mesma razão das cidades: mudança de
  // lugar que passa calada pela janela de confirmação é mudança que ninguém
  // aprovou.
  const pais = diffLista(a.paises, d.paises, (x) => x.key, 'Países');
  if (pais) linhas.push(pais);
  const est = diffLista(a.estados, d.estados, (x) => x.key, 'Estados');
  if (est) linhas.push(est);

  // Onde o anúncio aparece. Sem estas linhas, trocar posicionamento seria a
  // ÚNICA mudança do editor que passaria calada pela janela de confirmação — e
  // é a que muda onde o anúncio é entregue.
  for (const l of resumoDosPosicionamentos(a.posicionamentos, d.posicionamentos)) linhas.push(l);

  // Raio ou unidade mudam sem a cidade entrar ou sair — precisa de comparação própria.
  const raioAntes = new Map((a.cidades || []).filter((c) => c != null && c.key != null).map((c) => [c.key, c]));
  for (const c of (d.cidades || [])) {
    if (c == null || c.key == null) continue;
    const ant = raioAntes.get(c.key);
    if (ant && (Number(ant.raio) !== Number(c.raio) || ant.unidade !== c.unidade)) {
      // Pula mudança de unidade quando ambos os raios são 0 (cidade inteira), é irrelevante.
      if (Number(ant.raio) === 0 && Number(c.raio) === 0) continue;
      const unAnt = ant.unidade === 'mile' ? 'mi' : 'km';
      const unNova = c.unidade === 'mile' ? 'mi' : 'km';
      const valAnt = ant.raio ? `${ant.raio} ${unAnt}` : 'cidade inteira';
      const valNova = c.raio ? `${c.raio} ${unNova}` : 'cidade inteira';
      const nomeCidade = nomePara(c, c.key);
      linhas.push(`Raio de ${nomeCidade}: ${valAnt} → ${valNova}`);
    }
  }

  // O PIN NO MAPA (`custom_locations`). SEM ESTAS LINHAS O RESUMO VINHA VAZIO E
  // A TELA DESISTIA COM "Nada mudou. Não há o que salvar." — o ponto era
  // desenhado no mapa, com endereço e raio, e nunca chegava na Meta.
  //
  // Defeito real, visto na conta da Vessel em 17/08/2026. As duas outras pontas
  // já estavam certas o tempo todo: `lerPublico` lê o pin e `montarTargeting` o
  // manda de volta. Faltava só o resumo enxergá-lo — e é o resumo que decide se
  // há o que salvar.
  //
  // O pin não tem chave da Meta: o que o identifica é ONDE ele caiu. Arredondar
  // em 5 casas (~1 metro) evita que o mesmo ponto pareça outro por ruído de
  // ponto flutuante na ida e volta pela API.
  const chaveDoPin = (p) => `${Number(p.lat).toFixed(5)},${Number(p.lng).toFixed(5)}`;
  const nomeDoPin = (p) => p.nome || p.endereco
    || `ponto (${Number(p.lat).toFixed(4)}, ${Number(p.lng).toFixed(4)})`;
  const pinsValidos = (arr) => (arr || [])
    .filter((p) => p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)));
  const paraDiff = (arr) => pinsValidos(arr).map((p) => ({ key: chaveDoPin(p), nome: nomeDoPin(p) }));
  const pin = diffLista(paraDiff(a.pins), paraDiff(d.pins), (x) => x.key, 'Pontos no mapa');
  if (pin) linhas.push(pin);

  // Raio ou unidade do pin que FICOU — mesma necessidade das cidades: mudar o
  // alcance de um ponto sem tirá-lo do mapa também é mudança de entrega.
  const pinAntes = new Map(pinsValidos(a.pins).map((p) => [chaveDoPin(p), p]));
  for (const p of pinsValidos(d.pins)) {
    const ant = pinAntes.get(chaveDoPin(p));
    if (!ant) continue;
    if (Number(ant.raio) === Number(p.raio) && ant.unidade === p.unidade) continue;
    const un = (u) => (u === 'mile' ? 'mi' : 'km');
    linhas.push(`Raio de ${nomeDoPin(p)}: ${ant.raio} ${un(ant.unidade)} → ${p.raio} ${un(p.unidade)}`);
  }

  const exc = diffLista(a.excluidas, d.excluidas, (x) => x.key, 'Lugares excluídos');
  if (exc) linhas.push(exc);

  if (a.idadeMin !== d.idadeMin || a.idadeMax !== d.idadeMax)
    linhas.push(`Idade: ${a.idadeMin}–${a.idadeMax} → ${d.idadeMin}–${d.idadeMax}`);

  const gen = (g) => (g.length ? g.map((x) => GENERO_NOME[x] || x).join(' e ') : 'todos');
  if (gen(a.generos) !== gen(d.generos))
    linhas.push(`Gênero: ${gen(a.generos)} → ${gen(d.generos)}`);

  const int = diffLista(a.interesses, d.interesses, (x) => x.id, 'Interesses');
  if (int) linhas.push(int);

  const inc = diffLista(a.incluir, d.incluir, (x) => x.id, 'Públicos incluídos');
  if (inc) linhas.push(inc);

  const exd = diffLista(a.excluir, d.excluir, (x) => x.id, 'Públicos excluídos');
  if (exd) linhas.push(exd);

  if (a.advantagePlus !== d.advantagePlus)
    linhas.push('Advantage+: ' + (d.advantagePlus ? 'desligado → LIGADO' : 'ligado → DESLIGADO'));

  return linhas;
}

const temRestricaoManual = (p) =>
  (p.generos && p.generos.length > 0) ||
  (p.interesses && p.interesses.length > 0) ||
  p.idadeMin !== PUBLICO_VAZIO.idadeMin ||
  p.idadeMax !== PUBLICO_VAZIO.idadeMax;

// As três restrições que brigam com o Advantage+ estão iguais nos dois lados?
// Serve para o bloqueio olhar a MUDANÇA e não o estado: conflito que já veio
// pronto da Meta não é erro que esta ferramenta possa cobrar do dono.
function restricoesIguais(a, b) {
  if (Number(a.idadeMin) !== Number(b.idadeMin) || Number(a.idadeMax) !== Number(b.idadeMax)) return false;
  const gen = (p) => (p.generos || []).filter((g) => g != null).map(Number).sort().join(',');
  if (gen(a) !== gen(b)) return false;
  const ids = (p) => (p.interesses || []).filter((i) => i != null && i.id != null).map((i) => String(i.id)).sort().join(',');
  return ids(a) === ids(b);
}

// Uma entrada para CADA chave de CHAVES_DE_LOCALIZACAO, em português de gente —
// esse texto vai direto pro aviso que o dono lê antes de confirmar, e chave
// crua em inglês ali não diz nada a ninguém.
const NOMES_LOCALIZACOES = {
  regions: 'região',
  countries: 'país',
  country_groups: 'grupo de países',
  zips: 'CEP',
  custom_locations: 'localização personalizada',
  places: 'local',
  geo_markets: 'mercado geográfico',
  metro_areas: 'região metropolitana',
  electoral_districts: 'distrito eleitoral',
  medium_geo_areas: 'área média do mapa',
  small_geo_areas: 'área pequena do mapa',
  subcities: 'região dentro da cidade',
  neighborhoods: 'bairro',
  subneighborhoods: 'parte de um bairro',
  location_cluster_ids: 'conjunto de lugares salvo na Meta',
};

// Traduz chaves de geo_locations da Meta para português legível.
function nomeDaLocalizacao(chave) {
  return NOMES_LOCALIZACOES[chave] || 'outra localização';
}

// A FRASE SOBRE O QUE O EDITOR NÃO DESENHA.
//
// A versão antiga saía como "Este conjunto tem local definido(s)." — sem número,
// com um "(s)" preguiçoso e falando em "conjunto" numa tela que às vezes está
// criando uma CAMPANHA NOVA, onde conjunto nenhum existe ainda. Visto ao vivo
// ao aplicar um público salvo (03/08/2026).
//
// O que a pessoa precisa saber é uma coisa só: existe segmentação de lugar aqui
// que a tela não mostra, e ela NÃO se perde.
export function frasePosLocalizacoes(outras) {
  const nomes = (Array.isArray(outras) ? outras : []).map(nomeDaLocalizacao);
  if (!nomes.length) return '';
  if (nomes.length === 1) return nomes[0];
  if (nomes.length === 2) return `${nomes[0]} e ${nomes[1]}`;
  return `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`;
}

function fraseDasOutrasLocalizacoes(outras, temCidades) {
  const quais = frasePosLocalizacoes(outras);
  const um = (Array.isArray(outras) ? outras : []).length === 1;
  return (temCidades ? 'Além das cidades acima, este público' : 'Este público')
    + ` também usa ${quais} — ${um ? 'um tipo de lugar' : 'tipos de lugar'} que esta tela não sabe mostrar.`
    + ` ${um ? 'Ele vai' : 'Eles vão'} junto do jeito que ${um ? 'está' : 'estão'}: <b>nada se perde</b>.`;
}

// Os avisos que precedem o salvar. `bloqueia: true` impede a gravação até o
// dono resolver o conflito.
//
// Aviso que aparece sempre é aviso que ninguém lê: se nada mudou, não avisa
// nada, e o aviso de aprendizado só sai em conjunto que está rodando.
export function avisosDe(antes, depois, contexto) {
  const a = Object.assign({}, PUBLICO_VAZIO, antes || {});
  const d = Object.assign({}, PUBLICO_VAZIO, depois || {});
  const ctx = contexto || {};
  const avisos = [];
  const mudou = resumoDasMudancas(a, d).length > 0;

  for (const aj of ctx.ajustes || []) {
    if (aj == null) continue;
    const un = aj.unidade === 'mile' ? 'milhas' : 'km';
    avisos.push({
      tipo: 'raio',
      texto: `Ajustei o raio de ${aj.cidade} de ${aj.de} para ${aj.para} ${un} — a Meta não aceita menos.`,
      bloqueia: false,
    });
  }

  // ESTREITAR A ENTREGA DE UM CONJUNTO ATIVO. É a mudança mais cara que este
  // editor permite e a mais silenciosa: nada dá erro, o anúncio só passa a
  // alcançar menos gente, e a queda aparece dias depois como "caiu o resultado".
  //
  // AVISA, NÃO BLOQUEIA: estreitar de propósito é uso legítimo (foi o que os
  // seis conjuntos de vaga de emprego fizeram). O que não pode é acontecer sem
  // ninguém ler.
  if (ctx.ativo && estreitou(a.posicionamentos, d.posicionamentos)) {
    avisos.push({
      tipo: 'posicionamento-estreitou',
      texto: '<b>Este conjunto está ATIVO e vai passar a aparecer em menos lugares.</b><br>'
        + 'A entrega diminui sem nada dar erro — o efeito aparece dias depois, como queda de resultado. '
        + 'Se a ideia era só testar, volte para automático.',
      bloqueia: false,
    });
  }

  // A Meta exige localização: conjunto não mira em lugar nenhum. Barrar aqui
  // é melhor que deixar salvar e tomar recusa sem entender o motivo.
  // Mas só bloqueia se REALMENTE não houver localização nenhuma — nem cidades
  // nem regiões/países/CEPs/etc.
  const temCidades = (d.cidades || []).length > 0;
  const temOutrasLoc = (d.outrasLocalizacoes || []).length > 0;
  // PIN CONTA COMO LOCALIZACAO. Quando `custom_locations` saiu de
  // CHAVES_DE_LOCALIZACAO (12/08/2026, porque o editor passou a gerencia-lo),
  // um conjunto mirado SO por pin passou a cair aqui como "sem localizacao" e o
  // Salvar morria sem o dono ter mudado nada. O teste que percorre a lista pegou
  // isso na hora — e e exatamente o beco sem saida que ele existe pra impedir.
  const temPins = (d.pins || []).length > 0;
  // PAÍS E ESTADO CONTAM COMO LOCALIZAÇÃO. Ver a cicatriz de 12/08 no comentário
  // de CHAVES_DE_LOCALIZACAO: chave que sai daquela lista sem entrar aqui deixa
  // o Salvar impossível para quem mira só por ela.
  const temPaises = (d.paises || []).length > 0;
  const temEstados = (d.estados || []).length > 0;
  if (!temCidades && !temOutrasLoc && !temPins && !temPaises && !temEstados) {
    avisos.push({
      tipo: 'sem-lugar',
      texto: 'O público ficou <b>sem nenhuma localização</b>. A Meta não aceita um conjunto sem localização — escolha pelo menos uma cidade, região, país, CEP ou localização customizada.',
      bloqueia: true,
    });
  } else if (temOutrasLoc) {
    // Avisa que há localidades que o editor não gerencia, mas que serão preservadas.
    avisos.push({
      tipo: 'outras-localizacoes',
      texto: fraseDasOutrasLocalizacoes(d.outrasLocalizacoes, temCidades),
      bloqueia: false,
    });
  }

  // A Meta REJEITA segmentação manual com o Advantage+ ligado (código 1870227,
  // apanhado ao vivo em 2026-07-12). Deixar salvar e tomar o erro seria
  // transferir pro dono um conflito que a ferramenta já conhece.
  //
  // MAS SÓ BLOQUEIA O CONFLITO QUE O DONO ACABOU DE CRIAR — ou ligando o
  // Advantage+, ou mexendo em idade/gênero/interesse com ele já ligado. Um
  // conjunto que chegou da Meta assim já está assim: travar o Salvar nesse
  // caso deixaria o dono sem saída a não ser desligar o Advantage+, que é uma
  // mudança de verdade em quem vê os anúncios — e que ele não pediu.
  const conflitoNovo = d.advantagePlus && temRestricaoManual(d)
    && (!a.advantagePlus || !restricoesIguais(a, d));
  if (conflitoNovo) {
    avisos.push({
      tipo: 'conflito',
      texto: 'Com o Advantage+ ligado, a Meta <b>recusa</b> idade, gênero e interesses definidos à mão. Escolha: ou desliga o Advantage+, ou limpa essas restrições.',
      bloqueia: true,
    });
  } else if (!d.advantagePlus && a.advantagePlus) {
    avisos.push({
      tipo: 'advantage',
      texto: 'O Advantage+ será <b>desligado</b>. A partir daí idade, gênero e interesses passam a valer como limite de verdade.',
      bloqueia: false,
    });
  }

  if (mudou && ctx.ativo) {
    avisos.push({
      tipo: 'aprendizado',
      texto: 'Este conjunto está rodando. Mudar o público <b>reinicia o aprendizado da Meta</b> — o custo pode piorar por alguns dias até estabilizar.',
      bloqueia: false,
    });
  }

  return avisos;
}
