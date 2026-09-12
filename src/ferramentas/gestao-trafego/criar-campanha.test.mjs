import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  PASSOS, estadoInicial, faltaNoPasso, podeAvancar, primeiroPassoIncompleto,
  imagemServe, resumoDoQueVaiSerCriado, payloadsDoAssistente, publicoParaFabrica,
  LADO_MINIMO_PX, ORCAMENTO_MINIMO_CENTAVOS, horarioDeTermino, pedeWhatsapp,
  numerosJaUsados, numerosParaPagina, siteValido, criativaDoAssistente,
} from './criar-campanha.js'
import { acharSubobjetivo } from './subobjetivos.js'

const cheio = () => ({
  ...estadoInicial(),
  objetivo: 'engajamento', nome: 'Bolsas — Campinas',
  pageId: '324679337390168', igId: '17841462952561833', whatsapp: '5519999999999',
  publico: { cidades: [{ key: '267873', nome: 'Campinas', raio: 20, unidade: 'kilometer' }], idadeMin: 25, idadeMax: 45, interesses: [{ id: '6003', name: 'Bolsas' }] },
  imagemHash: 'abc123', texto: 'Bolsas com 30% OFF',
})

test('sao cinco passos, na ordem da decisao', () => {
  // "de quem é" entra em SEGUNDO, logo depois do objetivo: é o objetivo que
  // decide se o número de WhatsApp vai ser pedido.
  assert.deepEqual(PASSOS.map((p) => p.chave), ['objetivo', 'identidade', 'orcamento', 'publico', 'anuncio'])
})

test('o estado novo nao avanca em nada — e diz o que falta, em portugues', () => {
  const e = estadoInicial()
  assert.match(faltaNoPasso('objetivo', e)[0], /Escolha o que você quer/)
  assert.match(faltaNoPasso('anuncio', e)[0], /Escolha uma imagem/)
  assert.equal(podeAvancar('objetivo', e), false)
})

test('nome vazio segura o passo 1 — sem nome ninguem acha a campanha depois', () => {
  const e = { ...estadoInicial(), objetivo: 'engajamento' }
  assert.equal(podeAvancar('objetivo', e), false)
  assert.ok(faltaNoPasso('objetivo', e).some((f) => /nome/i.test(f)))
})

test('orcamento abaixo do minimo e barrado ANTES de a Meta recusar', () => {
  const e = { ...cheio(), orcamentoCentavos: ORCAMENTO_MINIMO_CENTAVOS - 1 }
  assert.match(faltaNoPasso('orcamento', e)[0], /não aceita menos de/)
  assert.equal(podeAvancar('orcamento', { ...cheio(), orcamentoCentavos: ORCAMENTO_MINIMO_CENTAVOS }), true)
})

test('sem lugar nao avanca — e a Meta EXIGE lugar', () => {
  const e = { ...cheio(), publico: { cidades: [] } }
  assert.match(faltaNoPasso('publico', e)[0], /pelo menos uma cidade ou região/)
  // Região ou país também servem: o editor gerencia cidade, mas o conjunto pode
  // ter outras localidades que ele preserva sem desenhar.
  assert.equal(podeAvancar('publico', { ...cheio(), publico: { cidades: [], outrasLocalizacoes: [{ tipo: 'pais' }] } }), true)
})

test('primeiroPassoIncompleto aponta ONDE parar, nao so que falta algo', () => {
  assert.equal(primeiroPassoIncompleto(estadoInicial()), 'objetivo')
  assert.equal(primeiroPassoIncompleto({ ...cheio(), imagemHash: '' }), 'anuncio')
  assert.equal(primeiroPassoIncompleto(cheio()), null)
})

// ── A imagem, conferida ANTES de subir ──────────────────────────────────────

test('imagem pequena e barrada no navegador, antes do envio', () => {
  // Medido: um PNG de 95 bytes voltou 100/2446496 da Meta. Descobrir isso depois
  // de esperar o upload é o pior momento possível.
  const r = imagemServe({ bytes: 95, largura: 8, altura: 8 })
  assert.equal(r.ok, false)
  assert.equal(r.problemas.length, 2)
  assert.match(r.problemas[1], new RegExp(`${LADO_MINIMO_PX}×${LADO_MINIMO_PX}`))
})

test('imagem boa passa', () => {
  assert.equal(imagemServe({ bytes: 104223, largura: 600, altura: 600 }).ok, true)
})

test('o que nao se sabe NAO vira acusacao', () => {
  // Nem todo navegador entrega dimensão de todo formato. Faltar dado não pode
  // barrar uma imagem que talvez esteja boa.
  assert.equal(imagemServe({}).ok, true)
  assert.equal(imagemServe({ bytes: 500000 }).ok, true)
})

// ── O resumo da confirmação ────────────────────────────────────────────────

test('o resumo lista o que vai ser criado, com nome de gente', () => {
  const l = resumoDoQueVaiSerCriado(cheio(), 'Conversas no WhatsApp')
  assert.match(l[0], /"Bolsas — Campinas" — Conversas no WhatsApp/)
  assert.ok(l.some((x) => /1 conjunto com R\$\s?50,00 por dia/.test(x)))
  assert.ok(l.some((x) => /Em Campinas/.test(x)))
  assert.ok(l.some((x) => /Idade 25–45/.test(x)))
  assert.ok(l.some((x) => /Interesses: Bolsas/.test(x)))
})

// ── A tradução entre o editor e a Fábrica ──────────────────────────────────

test('traduz a cidade do editor para a forma da Fabrica', () => {
  const f = publicoParaFabrica(cheio().publico)
  assert.deepEqual(f.geo.cities, [{ key: '267873', radius: 20, distance_unit: 'kilometer' }])
  assert.deepEqual(f.interesses, [{ id: '6003', name: 'Bolsas' }])
})

test('cidade inteira (raio 0) vai SEM radius — nao inventa um raio', () => {
  const f = publicoParaFabrica({ cidades: [{ key: '1', raio: 0 }] })
  assert.deepEqual(f.geo.cities, [{ key: '1' }])
})

/* O DEFEITO QUE ESTES TRÊS CONSERTAM (medido em 18/08/2026, com o dono na tela).
 *
 * O assistente EXIGE um lugar antes de deixar avançar, e aceita três formas:
 * cidade, PIN no mapa e "outras localizações" (estado, país). A tradução para a
 * Fábrica levava só as CIDADES — então quem marcasse um pin criava a campanha
 * SEM ele, e nada na tela dizia.
 *
 * Foi o que aconteceu: o dono marcou um pin na Moto Easy. O pin teria ido para o
 * lixo e a campanha rodaria só na cidade que veio de um público salvo — mais
 * larga do que ele escolheu, em silêncio.
 *
 * O montador da Fábrica (`coletor/lib/publico.mjs`) SEMPRE soube ler `pins`,
 * `countries` e `regions`. O que faltava era a ponte — o pedaço do meio, que é
 * onde este projeto já perdeu dado três vezes. */
test('o PIN do mapa atravessa a tradução — era ele que morria', () => {
  const f = publicoParaFabrica({ pins: [{ lat: -22.7253, lng: -47.6492, raio: 3, unidade: 'kilometer', nome: 'Loja Piracicaba' }] })
  assert.equal(f.geo.pins.length, 1)
  assert.equal(f.geo.pins[0].lat, -22.7253)
  assert.equal(f.geo.pins[0].nome, 'Loja Piracicaba')
})

test('estado e país também atravessam', () => {
  const f = publicoParaFabrica({ estados: [{ key: 'BR:saopaulo' }], paises: [{ key: 'BR' }] })
  assert.deepEqual(f.geo.regions, [{ key: 'BR:saopaulo' }])
  assert.deepEqual(f.geo.countries, [{ key: 'BR' }])
})

// Pin sem coordenada não é lugar. Deixar passar faria a Meta recusar o pedido
// inteiro por causa de um ponto vazio — pior que ignorá-lo aqui.
test('pin sem coordenada não vai', () => {
  const f = publicoParaFabrica({ pins: [{ nome: 'sem coordenada' }] })
  assert.equal(f.geo.pins.length, 0)
})

// ── O payload final ────────────────────────────────────────────────────────

const ROW = { chave: 'engajamento', rotulo: 'Conversas', meta_objective: 'OUTCOME_ENGAGEMENT', optimization_goal: 'CONVERSATIONS', billing_event: 'IMPRESSIONS', destination_type: 'WHATSAPP', promoted_object_tipo: 'page' }
const MARCA = { nome: 'La Vessel', pageId: '324679337390168', igId: '17841462952561833' }
const LOJA = { nome: 'Tivoli', geoCities: ['267873'], whatsapp: '5519999999999' }

test('o payload sai do montador COMPARTILHADO, com os campos que a Meta exige', () => {
  // Os dois campos abaixo foram justamente os que faltaram nas recusas 4834011 e
  // 1870227 quando eu escrevi payload próprio. Vêm de graça ao reusar.
  const { campaign, adset } = payloadsDoAssistente({ estado: cheio(), objetivoRow: ROW, nomeDaConta: 'Vessel' })
  assert.equal(campaign.objective, 'OUTCOME_ENGAGEMENT')
  assert.equal(campaign.status, 'PAUSED')
  assert.equal(campaign.is_adset_budget_sharing_enabled, false)
  assert.equal(adset.status, 'PAUSED')
  assert.equal(adset.destination_type, 'WHATSAPP')
  assert.ok(adset.targeting)
})

// A PROVA QUE MAIS IMPORTA: o caminho inteiro, do assistente ao pedido. Os
// testes de tradução acima provam a ponte; este prova que ela está LIGADA.
test('com pin escolhido, o conjunto sai com custom_locations', () => {
  const e = { ...cheio(), publico: { cidades: [], pins: [{ lat: -22.7253, lng: -47.6492, raio: 3, unidade: 'kilometer' }] } }
  const { adset } = payloadsDoAssistente({ estado: e, objetivoRow: ROW, nomeDaConta: 'Vessel' })
  const geo = adset.targeting.geo_locations
  assert.ok(geo.custom_locations, 'o pin tem de chegar na Meta')
  assert.equal(geo.custom_locations[0].latitude, -22.7253)
  assert.equal(geo.custom_locations[0].radius, 3)
})

test('o nome DIGITADO manda sobre o nome automatico', () => {
  const { campaign, adset } = payloadsDoAssistente({ estado: cheio(), objetivoRow: ROW, nomeDaConta: 'Vessel' })
  assert.equal(campaign.name, 'Bolsas — Campinas')
  assert.match(adset.name, /^Bolsas — Campinas · conjunto$/)
})

test('tudo nasce PAUSED — a promessa que garante que nada gasta', () => {
  const { campaign, adset } = payloadsDoAssistente({ estado: cheio(), objetivoRow: ROW, nomeDaConta: 'Vessel' })
  assert.equal(campaign.status, 'PAUSED')
  assert.equal(adset.status, 'PAUSED')
})

test('sem objetivo, marca ou loja nao monta payload nenhum', () => {
  assert.equal(payloadsDoAssistente({ estado: cheio(), objetivoRow: null }), null)
  // SEM PÁGINA não monta: a página é o que assina o anúncio, e a Meta recusa
  // criativo sem ela. Antes o bloqueio era "sem marca cadastrada", que exigia
  // cadastro da Fábrica para criar campanha numa conta qualquer.
  assert.equal(payloadsDoAssistente({ estado: { ...cheio(), pageId: '' }, objetivoRow: ROW }), null)
})

// ─────────────────────────────────────────────────────────────────────────────
// ORÇAMENTO TOTAL NÃO PODE VIRAR ORÇAMENTO DIÁRIO.
//
// O DEFEITO REAL (achado antes de subir, 2026-08-03): `payloadsDoAssistente`
// montava `{ tipo: 'lifetime', valorCentavos }`, mas `normalizarOrcamento` só
// conhece `'total'` e `valor` — os dois nomes errados caíam no padrão em
// silêncio. Quem escolhesse "Total R$ 500" criava um conjunto de R$ 500 POR DIA.
//
// Nenhum erro, nenhum aviso: a Meta aceita, a campanha nasce pausada e correta
// aos olhos, e a diferença só aparece na fatura. É o formato de falha mais caro
// que esta tela pode ter, porque é o único em que ela mexe em dinheiro.
test('orçamento TOTAL vira lifetime_budget, e nunca daily_budget', () => {
  const e = {
    ...estadoInicial(), objetivo: 'conversao', nome: 'X', pageId: '324679337390168',
    orcamentoCentavos: 50000, tipoOrcamento: 'total', terminaEm: '2026-09-30',
  };
  const { adset } = payloadsDoAssistente({ estado: e, objetivoRow: ROW, nomeDaConta: 'Vessel' });
  assert.equal(adset.daily_budget, undefined, 'total NÃO pode virar orçamento diário');
  assert.equal(adset.lifetime_budget, 50000);
  // A data vira o FIM do dia escolhido: quem marca 30 quer o dia 30 inteiro.
  assert.equal(adset.end_time, '2026-09-30T23:59:59');
});

test('orçamento POR DIA continua daily_budget, sem data nenhuma', () => {
  const e = { ...estadoInicial(), objetivo: 'conversao', nome: 'X', pageId: '324679337390168', orcamentoCentavos: 8000 };
  const { adset } = payloadsDoAssistente({ estado: e, objetivoRow: ROW, nomeDaConta: 'Vessel' });
  assert.equal(adset.daily_budget, 8000);
  assert.equal(adset.lifetime_budget, undefined);
  assert.equal(adset.end_time, undefined);
});

test('total SEM data de término não deixa avançar', () => {
  const e = { ...estadoInicial(), orcamentoCentavos: 50000, tipoOrcamento: 'total' };
  const faltas = faltaNoPasso('orcamento', e);
  assert.equal(faltas.length, 1);
  assert.match(faltas[0], /término/);
  assert.ok(podeAvancar('orcamento', { ...e, terminaEm: '2026-09-30' }));
});

test('data mal formada não vira end_time inventado', () => {
  assert.equal(horarioDeTermino('30/09/2026'), '');
  assert.equal(horarioDeTermino(''), '');
  assert.equal(horarioDeTermino('2026-09-30'), '2026-09-30T23:59:59');
});

// ─────────────────────────────────────────────────────────────────────────────
// DE QUEM É O ANÚNCIO — escolhido na tela, não herdado do cadastro.
//
// O DEFEITO DE DESENHO (apontado pelo dono, 03/08/2026): o assistente exigia
// que a conta tivesse uma loja cadastrada na Fábrica, e tirava dela a página, o
// Instagram e o WhatsApp. Só que criar campanha do zero não tem nada a ver com
// a Fábrica — em conta sem cadastro o botão simplesmente não funcionava, e
// mesmo com cadastro não dava para usar OUTRA página.
test('sem pagina escolhida, o passo de identidade nao avanca', () => {
  const faltas = faltaNoPasso('identidade', estadoInicial(), ROW)
  assert.ok(faltas.some((f) => /página do Facebook/.test(f)))
})

test('o WhatsApp so e cobrado quando o sub-objetivo leva pra la', () => {
  // QUEM DECIDE É O CATÁLOGO, e não o formato do destino. A primeira versão
  // olhava "contém WHATSAPP" no `destination_type`, e acertava por acidente:
  // INSTAGRAM_DIRECT não contém, mas MESSAGING_..._WHATSAPP contém — e a
  // pergunta certa ("este tipo precisa de um número?") é a do catálogo.
  const semWa = acharSubobjetivo('conversa-direct')
  const comWa = acharSubobjetivo('conversa-whatsapp')
  assert.equal(pedeWhatsapp(semWa), false)
  assert.equal(pedeWhatsapp(comWa), true)
  assert.equal(pedeWhatsapp(acharSubobjetivo('conversa-todos')), true, 'multi-destino também leva ao WhatsApp')

  const estado = { ...estadoInicial(), pageId: '123' }
  assert.equal(podeAvancar('identidade', estado, semWa), true, 'cobrou WhatsApp num tipo que não usa')
  assert.equal(podeAvancar('identidade', estado, comWa), false)
  assert.ok(faltaNoPasso('identidade', estado, comWa)[0].includes('DDI'))
})

test('numero curto demais e recusado — link morto gasta e nao conversa', () => {
  const comWa = acharSubobjetivo('conversa-whatsapp')
  const curto = { ...estadoInicial(), pageId: '123', whatsapp: '99999' }
  assert.equal(podeAvancar('identidade', curto, comWa), false)
  // Aceita o que a pessoa digitar com pontuação: 55 (19) 99999-9999 são 13 dígitos.
  assert.equal(podeAvancar('identidade', { ...curto, whatsapp: '55 (19) 99999-9999' }, comWa), true)
})

// ── O endereço do site ─────────────────────────────────────────────────────

test('quem leva pro site cobra endereco COMPLETO', () => {
  const site = acharSubobjetivo('site-cliques')
  const base = { ...estadoInicial(), pageId: '123' }
  assert.equal(podeAvancar('identidade', base, site), false)
  // "loja.com" sem esquema é recusado pela Meta — melhor recusar aqui.
  assert.equal(podeAvancar('identidade', { ...base, site: 'lavessel.com.br' }, site), false)
  assert.equal(podeAvancar('identidade', { ...base, site: 'https://lavessel.com.br' }, site), true)
  assert.ok(faltaNoPasso('identidade', base, site)[0].includes('https://'))
})

test('siteValido recusa o que a Meta recusaria', () => {
  assert.equal(siteValido('https://loja.com.br/promo'), true)
  assert.equal(siteValido('http://loja.com'), true)
  assert.equal(siteValido('loja.com'), false)
  assert.equal(siteValido('https://localhost'), false, 'sem ponto não é domínio')
  assert.equal(siteValido(''), false)
})

// ── O criativo de cada destino ─────────────────────────────────────────────

test('WhatsApp continua saindo do montador PROVADO da Fabrica', () => {
  const c = criativaDoAssistente({
    sub: acharSubobjetivo('conversa-whatsapp'),
    estado: { imagemHash: 'h', texto: 'Oi', whatsapp: '5519971092194' },
    page: '324679337390168', ig: '17841462952561833',
  })
  assert.match(c.object_story_spec.link_data.link, /wa\.me\/5519971092194/)
  assert.equal(c.object_story_spec.link_data.call_to_action.type, 'WHATSAPP_MESSAGE')
  assert.ok(c.degrees_of_freedom_spec, 'perdeu o DOF_SPEC da Fábrica')
})

test('Direct do Instagram NAO vira link de WhatsApp', () => {
  // O defeito que isto impede: `payloadCriativa` cai no ramo "WhatsApp puro"
  // para QUALQUER destino não-vazio. Um anúncio de Direct sairia com wa.me,
  // sem erro nenhum da Meta.
  const c = criativaDoAssistente({
    sub: acharSubobjetivo('conversa-direct'),
    estado: { imagemHash: 'h', texto: 'Oi' }, page: 'P', ig: 'IG',
  })
  assert.ok(!/wa\.me/.test(JSON.stringify(c)), 'montou link de WhatsApp num anúncio de Direct')
  assert.equal(c.object_story_spec.link_data.call_to_action.type, 'INSTAGRAM_MESSAGE')
})

test('site leva pro ENDERECO digitado, e nao pro instagram.com', () => {
  const c = criativaDoAssistente({
    sub: acharSubobjetivo('site-cliques'),
    estado: { imagemHash: 'h', texto: 'Oi', site: 'https://lavessel.com.br/promo' }, page: 'P', ig: 'IG',
  })
  assert.equal(c.object_story_spec.link_data.link, 'https://lavessel.com.br/promo')
  assert.equal(c.object_story_spec.link_data.call_to_action.type, 'LEARN_MORE')
})

test('reconhecimento, sem site e sem destino, liga ao perfil', () => {
  const c = criativaDoAssistente({
    sub: acharSubobjetivo('alcance'),
    estado: { imagemHash: 'h', texto: 'Oi' }, page: 'P', ig: 'IG',
  })
  assert.match(c.object_story_spec.link_data.link, /instagram\.com/)
  assert.equal(c.object_story_spec.instagram_user_id, 'IG')
})

test('o que ainda nao da pra criar nao deixa avancar, com o motivo', () => {
  // Sobrou o que depende de pixel e de formulário. Impulsionar publicação saiu
  // desta lista em 03/08/2026, quando passou a funcionar.
  const pixel = acharSubobjetivo('site-conversao')
  const e = { ...estadoInicial(), objetivo: 'site-conversao', nome: 'X' }
  assert.equal(podeAvancar('objetivo', e, pixel), false)
  assert.match(faltaNoPasso('objetivo', e, pixel)[0], /pixel/)
})

// ── Impulsionar publicação ─────────────────────────────────────────────────

test('impulsionar publicacao pede a PUBLICACAO, e nao imagem nem texto', () => {
  // Pedir imagem e texto aqui faria escrever um texto que nunca apareceria: a
  // arte e a legenda são as do post. O anúncio É o post.
  const post = acharSubobjetivo('engajamento-post')
  const vazio = { ...estadoInicial() }
  assert.deepEqual(faltaNoPasso('anuncio', vazio, post), ['Escolha a publicação que vai ser impulsionada.'])

  const comPost = { ...vazio, publicacaoId: '18096882434461048' }
  assert.deepEqual(faltaNoPasso('anuncio', comPost, post), [], 'cobrou imagem ou texto num impulsionamento')
})

test('anuncio NOVO continua pedindo imagem e texto', () => {
  const novo = acharSubobjetivo('conversa-whatsapp')
  const so_post = { ...estadoInicial(), publicacaoId: '123' }
  const faltas = faltaNoPasso('anuncio', so_post, novo)
  assert.equal(faltas.length, 2, 'publicação não substitui imagem+texto num anúncio novo')
})

test('o criativo de publicacao leva SO os dois campos provados', () => {
  // Provado ao vivo em 03/08/2026. Mandar `object_story_spec` junto faz a Meta
  // responder "O campo de link é obrigatório" e recusar — os dois caminhos não
  // se misturam, e essa é a armadilha.
  const c = criativaDoAssistente({
    sub: acharSubobjetivo('engajamento-post'),
    estado: { publicacaoId: '18096882434461048', texto: 'ignorado', imagemHash: 'ignorado' },
    page: 'P', ig: '17841462952561833',
  })
  assert.deepEqual(c, { instagram_user_id: '17841462952561833', source_instagram_media_id: '18096882434461048' })
  assert.equal(c.object_story_spec, undefined, 'object_story_spec junto faz a Meta recusar')
})

test('a confirmacao diz QUAL publicacao vai ser impulsionada', () => {
  const e = { ...cheio(), publicacaoId: '1', publicacaoResumo: 'o vídeo de 27/07' }
  const l = resumoDoQueVaiSerCriado(e, 'Engajamento', {}, acharSubobjetivo('engajamento-post'))
  assert.ok(l.some((x) => /impulsionando o vídeo de 27\/07/.test(x)))
  // E num anúncio novo continua falando de imagem.
  const novo = resumoDoQueVaiSerCriado(e, 'WhatsApp', {}, acharSubobjetivo('conversa-whatsapp'))
  assert.ok(novo.some((x) => /com a imagem escolhida/.test(x)))
})

test('a pagina e o Instagram escolhidos vao PRO PAYLOAD, e nao um cadastro', () => {
  const e = { ...cheio(), pageId: '999', igId: '888', whatsapp: '5511988887777' }
  const { adset } = payloadsDoAssistente({ estado: e, objetivoRow: ROW, nomeDaConta: 'Qualquer conta' })
  assert.deepEqual(adset.promoted_object, { page_id: '999' }, 'usou a página do cadastro em vez da escolhida')
})

test('objetivo de WhatsApp leva o numero DIGITADO pro promoted_object', () => {
  const row = { ...ROW, promoted_object_tipo: 'whatsapp', destination_type: 'WHATSAPP' }
  const e = { ...cheio(), pageId: '999', whatsapp: '55 11 98888-7777' }
  const { adset } = payloadsDoAssistente({ estado: e, objetivoRow: row, nomeDaConta: 'X' })
  assert.equal(adset.promoted_object.page_id, '999')
  assert.equal(adset.promoted_object.whatsapp_phone_number, '55 11 98888-7777')
})

test('a confirmacao diz QUAL pagina assina — e avisa quando nao ha Instagram', () => {
  const linhas = resumoDoQueVaiSerCriado(cheio(), 'Engajamento', { pagina: 'La Vessel', instagram: 'vessel.brasil' })
  assert.ok(linhas.some((l) => /La Vessel/.test(l) && /vessel\.brasil/.test(l)))

  const semIg = resumoDoQueVaiSerCriado(cheio(), 'Engajamento', { pagina: 'La Vessel Hortolândia' })
  assert.ok(semIg.some((l) => /sem Instagram ligado/.test(l)))
})

// ─────────────────────────────────────────────────────────────────────────────
// OS NÚMEROS DE WHATSAPP QUE A META JÁ ACEITOU
//
// DESCOBERTO DO JEITO CARO (03/08/2026): criei uma campanha com um número
// inventado e a Meta recusou o CONJUNTO depois de a campanha já existir —
// "This WhatsApp phone number is not linked to your account". Não há endpoint
// que liste os números permitidos; o que há é a prova pelo uso, no
// `promoted_object` dos conjuntos que já rodam.
const CONJUNTOS = [
  { promoted_object: { page_id: '324679337390168', whatsapp_phone_number: '5519971092194' } },
  { promoted_object: { page_id: '1015508584968115', whatsapp_phone_number: '5519971124217' } },
  { promoted_object: { page_id: '1015508584968115', whatsapp_phone_number: '5519971124217' } }, // repetido
  { promoted_object: { page_id: '324679337390168' } },                                          // sem número
  { },                                                                                          // sem nada
]

test('colhe os numeros dos conjuntos que existem, sem repetir', () => {
  assert.deepEqual(numerosJaUsados(CONJUNTOS), [
    { pageId: '324679337390168', numero: '5519971092194' },
    { pageId: '1015508584968115', numero: '5519971124217' },
  ])
  assert.deepEqual(numerosJaUsados(null), [])
})

test('mostra os numeros DA PAGINA escolhida', () => {
  const n = numerosParaPagina(numerosJaUsados(CONJUNTOS), '1015508584968115')
  assert.deepEqual(n.map((x) => x.numero), ['5519971124217'])
})

test('pagina sem numero conhecido mostra os da conta, em vez de lista vazia', () => {
  // Palpite útil vale mais que nada: a pessoa vê de qual página cada um é.
  const n = numerosParaPagina(numerosJaUsados(CONJUNTOS), '999999')
  assert.equal(n.length, 2)
})

test('a confirmacao NAO promete WhatsApp num tipo que vai pro Direct', () => {
  // O DEFEITO REAL, visto ao vivo (03/08/2026): o número vem sugerido do
  // cadastro da marca e fica no estado mesmo quando se escolhe um tipo que
  // leva ao Direct. A confirmação dizia "Conversas vão para o WhatsApp +55…"
  // numa campanha de Direct — mentira, e justamente na tela que existe para
  // conferir antes de gastar.
  const e = { ...cheio(), whatsapp: '5519971690502', site: 'https://x.com.br' }

  const direct = resumoDoQueVaiSerCriado(e, 'Direct', {}, acharSubobjetivo('conversa-direct'))
  assert.ok(!direct.some((l) => /WhatsApp/.test(l)), 'prometeu WhatsApp num anúncio de Direct')
  assert.ok(!direct.some((l) => /leva para https/.test(l)), 'prometeu site num anúncio de Direct')

  const whats = resumoDoQueVaiSerCriado(e, 'WhatsApp', {}, acharSubobjetivo('conversa-whatsapp'))
  assert.ok(whats.some((l) => /WhatsApp 5519971690502/.test(l)))

  const site = resumoDoQueVaiSerCriado(e, 'Site', {}, acharSubobjetivo('site-cliques'))
  assert.ok(site.some((l) => /leva para https:\/\/x\.com\.br/.test(l)))
  assert.ok(!site.some((l) => /WhatsApp/.test(l)))
})

test('os comportamentos do publico salvo CHEGAM na Meta, junto dos interesses', () => {
  // O silêncio que isto impede: aplicar um público salvo com "Engaged Shoppers"
  // e criar a campanha sem ele — público mais largo que o escolhido, sem aviso.
  const e = {
    ...cheio(),
    publico: {
      cidades: [{ key: '247071', nome: 'Campinas' }],
      idadeMin: 25, idadeMax: 65,
      interesses: [{ id: '6003198476967', name: 'Bolsas' }],
      comportamentos: [{ id: '6071631541183', name: 'Engaged Shoppers' }],
    },
  }
  const { adset } = payloadsDoAssistente({ estado: e, objetivoRow: ROW, nomeDaConta: 'Vessel' })
  const flex = adset.targeting.flexible_spec
  assert.equal(flex.length, 1, 'entradas separadas somam com E e APERTAM o público')
  assert.deepEqual(flex[0].interests.map((i) => i.name), ['Bolsas'])
  assert.deepEqual(flex[0].behaviors.map((b) => b.name), ['Engaged Shoppers'])
})

test('sem comportamento, o payload sai igual ao de antes (a Fábrica nao muda)', () => {
  const { adset } = payloadsDoAssistente({ estado: cheio(), objetivoRow: ROW, nomeDaConta: 'Vessel' })
  const flex = adset.targeting.flexible_spec
  assert.equal(flex.length, 1)
  assert.equal(flex[0].behaviors, undefined)
  assert.ok(flex[0].interests.length)
})

// ── Vídeo ──────────────────────────────────────────────────────────────────

test('video vira video_data, com a capa dentro — e nao link_data', () => {
  // Medido num anúncio real desta conta: o formato é `video_data` com
  // `image_url` dentro. Sem a capa a Meta recusa o criativo.
  const c = criativaDoAssistente({
    sub: acharSubobjetivo('conversa-whatsapp'),
    estado: { videoId: '1471771715011230', videoCapa: 'https://x/capa.jpg', texto: 'Oi', whatsapp: '5519971092194' },
    page: 'P', ig: 'IG',
  })
  const vd = c.object_story_spec.video_data
  assert.equal(vd.video_id, '1471771715011230')
  assert.equal(vd.image_url, 'https://x/capa.jpg')
  assert.equal(vd.message, 'Oi')
  assert.equal(vd.call_to_action.type, 'WHATSAPP_MESSAGE')
  assert.equal(c.object_story_spec.link_data, undefined, 'vídeo não usa link_data')
})

test('o video manda no criativo mesmo se houver imagem escolhida antes', () => {
  const c = criativaDoAssistente({
    sub: acharSubobjetivo('alcance'),
    estado: { videoId: 'V', videoCapa: 'https://x/c.jpg', imagemHash: 'H', texto: 'Oi' },
    page: 'P', ig: 'IG',
  })
  assert.ok(c.object_story_spec.video_data, 'a imagem antiga ganhou do vídeo escolhido')
})

test('video de Direct leva o botao do Direct, e nao o do WhatsApp', () => {
  const c = criativaDoAssistente({
    sub: acharSubobjetivo('conversa-direct'),
    estado: { videoId: 'V', videoCapa: 'https://x/c.jpg', texto: 'Oi', whatsapp: '5519999999999' },
    page: 'P', ig: 'IG',
  })
  assert.equal(c.object_story_spec.video_data.call_to_action.type, 'INSTAGRAM_MESSAGE')
  assert.ok(!/wa\.me|api\.whatsapp/.test(JSON.stringify(c)))
})

test('video SEM capa nao deixa avancar — a Meta recusaria', () => {
  const semCapa = { ...estadoInicial(), videoId: 'V', texto: 'Oi' }
  const faltas = faltaNoPasso('anuncio', semCapa, acharSubobjetivo('conversa-whatsapp'))
  assert.ok(faltas.some((f) => /capa/.test(f)))

  const comCapa = { ...semCapa, videoCapa: 'https://x/c.jpg' }
  assert.deepEqual(faltaNoPasso('anuncio', comCapa, acharSubobjetivo('conversa-whatsapp')), [])
})

test('a confirmacao diz que e video, e nao "a imagem escolhida"', () => {
  const e = { ...cheio(), imagemHash: '', videoId: 'V', videoCapa: 'https://x/c.jpg' }
  const l = resumoDoQueVaiSerCriado(e, 'WhatsApp', {}, acharSubobjetivo('conversa-whatsapp'))
  assert.ok(l.some((x) => /com o vídeo escolhido/.test(x)))
})

// ── Os campos novos do anúncio (03/08/2026) ─────────────────────────────────

test('a saudacao do WhatsApp CHEGA no criativo, no campo que a Meta le', () => {
  const c = criativaDoAssistente({
    sub: acharSubobjetivo('conversa-whatsapp'),
    estado: { imagemHash: 'h', texto: 'oi', whatsapp: '11999999999',
      saudacao: 'Bem-vindo à Vessel!', saudacaoResposta: 'Quero ver as bolsas' },
    page: 'P', ig: 'I',
  })
  const d = c.object_story_spec.link_data || c.object_story_spec.video_data
  const w = JSON.parse(d.page_welcome_message)
  assert.equal(w.text_format.message.text, 'Bem-vindo à Vessel!')
  assert.equal(w.text_format.message.autofill_message.content, 'Quero ver as bolsas')
})

test('saudacao NAO entra em campanha que nao abre conversa', () => {
  // Num anúncio de site ela seria um campo ignorado — ou um erro, dependendo do
  // humor da Meta. Melhor não mandar.
  const c = criativaDoAssistente({
    sub: acharSubobjetivo('site-cliques'),
    estado: { imagemHash: 'h', texto: 'oi', site: 'https://vessel.com.br', saudacao: 'Oi!' },
    page: 'P', ig: 'I',
  })
  assert.equal(c.object_story_spec.link_data.page_welcome_message, undefined)
})

test('titulo e descricao chegam no criativo — e no NOME certo por formato', () => {
  const img = criativaDoAssistente({
    sub: acharSubobjetivo('site-cliques'),
    estado: { imagemHash: 'h', texto: 'oi', site: 'https://vessel.com.br', titulo: 'Bolsas novas', descricao: 'Frete grátis' },
    page: 'P', ig: 'I',
  })
  assert.equal(img.object_story_spec.link_data.name, 'Bolsas novas')
  assert.equal(img.object_story_spec.link_data.description, 'Frete grátis')

  const vid = criativaDoAssistente({
    sub: acharSubobjetivo('site-cliques'),
    estado: { videoId: 'v1', videoCapa: 'https://x/c.png', texto: 'oi', site: 'https://vessel.com.br', titulo: 'Bolsas novas' },
    page: 'P', ig: 'I',
  })
  assert.equal(vid.object_story_spec.video_data.title, 'Bolsas novas')
  assert.equal(vid.object_story_spec.video_data.name, undefined)
})

test('trocar o botao NAO perde o caminho ate o numero do WhatsApp', () => {
  // Medido: no WhatsApp puro o número vai no `link` (wa.me/…), e o botão vem
  // sem `value`. Sobrescrever o call_to_action inteiro, ou mexer no link,
  // faria o botão apontar pra lugar nenhum.
  const c = criativaDoAssistente({
    sub: acharSubobjetivo('conversa-whatsapp'),
    estado: { imagemHash: 'h', texto: 'oi', whatsapp: '11999999999', botao: 'SHOP_NOW' },
    page: 'P', ig: 'I',
  })
  const d = c.object_story_spec.link_data || c.object_story_spec.video_data
  assert.equal(d.call_to_action.type, 'WHATSAPP_MESSAGE', 'botão que não cabe no destino não pode passar')
  assert.match(String(d.link), /11999999999/)
})

test('multi-destino NAO tem o botao trocado — quem escolhe e a Meta', () => {
  // O caminho multi manda três botões em `asset_feed_spec` e deixa a Meta
  // escolher. Trocar o de baixo brigaria com a lista de cima.
  const sub = { ...acharSubobjetivo('conversa-todos') }
  const c = criativaDoAssistente({
    sub, estado: { imagemHash: 'h', texto: 'oi', whatsapp: '11999999999', botao: 'WHATSAPP_MESSAGE' },
    page: 'P', ig: 'I',
  })
  if (c.asset_feed_spec) {
    assert.equal(c.object_story_spec.link_data.call_to_action.type, 'MESSAGE_PAGE')
    assert.equal(c.asset_feed_spec.call_to_actions.length, 3)
  }
})

test('impulsionar publicacao continua com os DOIS campos, sem extras grudados', () => {
  // O caminho da publicação não tem object_story_spec: mandar título ou
  // saudação nele faz a Meta responder "O campo de link é obrigatório".
  const c = criativaDoAssistente({
    sub: acharSubobjetivo('engajamento-post'),
    estado: { publicacaoId: '123', titulo: 'ignorar', saudacao: 'ignorar', descricao: 'ignorar' },
    page: 'P', ig: 'I',
  })
  assert.deepEqual(Object.keys(c).sort(), ['instagram_user_id', 'source_instagram_media_id'])
})
