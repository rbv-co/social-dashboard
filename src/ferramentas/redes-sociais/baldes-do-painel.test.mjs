import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BALDES, baldeDaCampanha, rotuloDoBalde, idsDoBalde, idsParaConsulta, conjuntosMaisRecentes, baldesSemGasto, baldeEfetivo, classificacaoEhProvisoria, campanhasSemTipoConfirmado, fraseDoRecorte, idsComGastoNoPeriodo } from './baldes-do-painel.js';

// TODAS as campanhas abaixo são REAIS: nome, objetivo e gasto conferidos no banco
// de produção em 17/08/2026. Os conjuntos são o sinal que a Meta afirma.

test('campanha de engajamento com destino WhatsApp é CONTATOS, não seguidores', () => {
  // Vessel: R$ 2.254 em 30 dias. É 87% do dinheiro "de engajamento" dessa conta.
  const c = { objective: 'OUTCOME_ENGAGEMENT', conjuntos: [{ destination_type: 'WHATSAPP', optimization_goal: 'CONVERSATIONS' }] };
  assert.equal(baldeDaCampanha(c), 'contatos');
});

test('campanha de cadastro é CONTATOS mesmo com objetivo de engajamento', () => {
  // Motoeasy: "[LEADS] NEGATIVADO? | P3 | TESTE OBJ ENGAJAMENTO", R$ 98,22.
  const c = { objective: 'OUTCOME_LEADS', conjuntos: [{ destination_type: null, optimization_goal: 'LEAD_GENERATION' }] };
  assert.equal(baldeDaCampanha(c), 'contatos');
});

test('tráfego com destino PERFIL é SEGUIDORES', () => {
  // Breno Vale: "[TRÁFEGO] GESTÃO EMPRESARIAL | PERFIL", R$ 2.584 — 100% da conta.
  const c = { objective: 'OUTCOME_TRAFFIC', conjuntos: [{ destination_type: 'INSTAGRAM_PROFILE', optimization_goal: 'PROFILE_VISIT' }] };
  assert.equal(baldeDaCampanha(c), 'seguidores');
});

test('⚠️ engajamento na publicação é ENGAJAMENTO, não SEGUIDORES', () => {
  // Raíssa: "[ENGAJAMENTO] FEED | [P3]", R$ 3.710,64.
  //
  // ⚠️ ESTE TESTE JÁ ESPEROU 'seguidores'. Mudou em 10/09/2026 por decisão do dono
  // ("as campanhas de engajamento são outro objetivo, diferente de seguidores") e
  // porque o número dava razão a ele: 21% do dinheiro do balde Seguidores era
  // disto, e ia parar no denominador do custo por seguidor.
  const c = { objective: 'OUTCOME_ENGAGEMENT', conjuntos: [{ destination_type: 'ON_POST', optimization_goal: 'POST_ENGAGEMENT' }] };
  assert.equal(baldeDaCampanha(c), 'engajamento');
});

test('⚠️ visualização de vídeo é ENGAJAMENTO', () => {
  const c = { objective: 'OUTCOME_ENGAGEMENT', conjuntos: [{ destination_type: 'ON_VIDEO', optimization_goal: 'THRUPLAY' }] };
  assert.equal(baldeDaCampanha(c), 'engajamento');
});

test('⚠️ UM conjunto de PERFIL segura a campanha em SEGUIDORES, mesmo com outro na peça', () => {
  // É a ordem das regras que decide (3 antes de 4), e é ela que impede o balde de
  // Seguidores de esvaziar: campanha mista é de seguidor.
  const c = { objective: 'OUTCOME_ENGAGEMENT', conjuntos: [
    { destination_type: 'ON_POST', optimization_goal: 'POST_ENGAGEMENT' },
    { destination_type: 'INSTAGRAM_PROFILE', optimization_goal: 'PROFILE_VISIT' },
  ] };
  assert.equal(baldeDaCampanha(c), 'seguidores');
});

test('tráfego sem destino declarado é SITE E ALCANCE', () => {
  // Raíssa: "[TRÁFEGO] DIA DA BELEZA | [P3]", R$ 484,31 — vai pra fora do Instagram.
  const c = { objective: 'OUTCOME_TRAFFIC', conjuntos: [{ destination_type: null, optimization_goal: 'LINK_CLICKS' }] };
  assert.equal(baldeDaCampanha(c), 'site');
});

test('venda é VENDAS', () => {
  // Vessel: "[ATACADO - SALE] SUA VITRINE | MANUAL [30/07]", R$ 199,24.
  const c = { objective: 'OUTCOME_SALES', conjuntos: [{ destination_type: null, optimization_goal: 'OFFSITE_CONVERSIONS' }] };
  assert.equal(baldeDaCampanha(c), 'vendas');
});

test('conversa VENCE o objetivo declarado: um conjunto de WhatsApp basta', () => {
  // A regra que corrigiu R$ 15.177 na Gestão de Tráfego (PR #51).
  const c = { objective: 'OUTCOME_SALES', conjuntos: [
    { destination_type: null, optimization_goal: 'OFFSITE_CONVERSIONS' },
    { destination_type: 'WHATSAPP', optimization_goal: 'CONVERSATIONS' },
  ] };
  assert.equal(baldeDaCampanha(c), 'contatos');
});

test('campanha sem conjunto coletado cai pelo objetivo, e NUNCA some', () => {
  assert.equal(baldeDaCampanha({ objective: 'OUTCOME_TRAFFIC', conjuntos: [] }), 'site');
  assert.equal(baldeDaCampanha({ objective: 'OUTCOME_ENGAGEMENT', conjuntos: [] }), 'engajamento');
  assert.equal(baldeDaCampanha({ objective: 'OUTCOME_LEADS', conjuntos: null }), 'contatos');
  assert.equal(baldeDaCampanha({ objective: '', conjuntos: [] }), 'site');
  assert.equal(baldeDaCampanha({}), 'site');
  assert.equal(baldeDaCampanha(null), 'site');
});

test('LINK_CLICKS (objetivo antigo) é SITE E ALCANCE', () => {
  assert.equal(baldeDaCampanha({ objective: 'LINK_CLICKS', conjuntos: [] }), 'site');
});

test('reconhecimento cai em SITE E ALCANCE (não tem balde próprio)', () => {
  assert.equal(baldeDaCampanha({ objective: 'OUTCOME_AWARENESS', conjuntos: [] }), 'site');
});

test('a barra tem seis baldes, nesta ordem', () => {
  // Engajamento entra COLADO em Seguidores: são os dois recortes de perfil, e a
  // pergunta que a pessoa faz é justamente "quanto foi para um e para o outro".
  assert.deepEqual(BALDES.map(b => b.id), ['todos', 'seguidores', 'engajamento', 'contatos', 'site', 'vendas']);
  assert.equal(rotuloDoBalde('engajamento'), 'Engajamento');
  assert.equal(rotuloDoBalde('site'), 'Site e alcance');
  assert.equal(rotuloDoBalde('todos'), 'Todos');
});

test('NENHUMA campanha desaparece: a soma dos baldes é o total', () => {
  const campanhas = [
    { campaign_id: '1', objective: 'OUTCOME_ENGAGEMENT', conjuntos: [{ destination_type: 'WHATSAPP' }] },
    { campaign_id: '2', objective: 'OUTCOME_TRAFFIC', conjuntos: [{ destination_type: 'INSTAGRAM_PROFILE' }] },
    { campaign_id: '3', objective: 'OUTCOME_TRAFFIC', conjuntos: [] },
    { campaign_id: '4', objective: 'OUTCOME_SALES', conjuntos: [] },
    { campaign_id: '5', objective: 'BUGIGANGA_NOVA_DA_META', conjuntos: [] },
  ];
  const soma = ['seguidores', 'engajamento', 'contatos', 'site', 'vendas']
    .reduce((n, b) => n + idsDoBalde(campanhas, b).length, 0);
  assert.equal(soma, campanhas.length);
  assert.equal(idsDoBalde(campanhas, 'todos').length, campanhas.length);
});

test('idsDoBalde devolve id em texto, do jeito que o PostgREST espera', () => {
  // Id que chega como número vira texto. O literal é curto DE PROPÓSITO: um id
  // real da Meta tem 18 dígitos e não cabe num número de JavaScript sem perder
  // precisão (120249301837840342 vira ...340). Quem testa a precisão é o teste
  // abaixo, com o id de verdade, em texto — que é como ele chega na vida real.
  const ids = idsDoBalde([{ campaign_id: 12345, objective: 'OUTCOME_SALES', conjuntos: [] }], 'vendas');
  assert.deepEqual(ids, ['12345']);
});

test('id real de 18 dígitos atravessa sem perder um algarismo', () => {
  // Id real da campanha marcada no filtro da Vessel, conferido no banco em 17/08/2026.
  const ids = idsDoBalde([{ campaign_id: '120249301837840342', objective: 'OUTCOME_SALES', conjuntos: [] }], 'vendas');
  assert.deepEqual(ids, ['120249301837840342']);
});

/* ── O balde + o "⚙ Filtrar campanhas" se somam ── */

const campanhas = [
  { campaign_id: 'a', objective: 'OUTCOME_TRAFFIC', conjuntos: [{ destination_type: 'INSTAGRAM_PROFILE' }] },
  { campaign_id: 'b', objective: 'OUTCOME_ENGAGEMENT', conjuntos: [{ destination_type: 'WHATSAPP' }] },
  { campaign_id: 'c', objective: 'OUTCOME_TRAFFIC', conjuntos: [] },
];

test('o balde recorta o tipo e o filtro manual recorta DENTRO dele', () => {
  assert.deepEqual(idsParaConsulta(campanhas, 'seguidores', null), ['a']);
  assert.deepEqual(idsParaConsulta(campanhas, 'todos', ['a', 'c']), ['a', 'c']);
  assert.deepEqual(idsParaConsulta(campanhas, 'seguidores', ['b', 'c']), []);
  assert.deepEqual(idsParaConsulta(campanhas, 'contatos', ['b', 'c']), ['b']);
});

test('filtro manual vazio (nenhuma marcada) NÃO vira "todas"', () => {
  // [] no banco significa "nenhuma campanha" de propósito; virar "todas" faria a
  // tela mostrar dinheiro que o dono tirou da conta.
  assert.deepEqual(idsParaConsulta(campanhas, 'todos', []), []);
  assert.deepEqual(idsParaConsulta(campanhas, 'seguidores', []), []);
});

test('sem filtro manual (null = todas), o balde manda sozinho', () => {
  assert.deepEqual(idsParaConsulta(campanhas, 'todos', null), ['a', 'b', 'c']);
});

/* ── Só a coleta MAIS RECENTE de conjuntos vota ── */

test('conjunto de uma coleta VELHA não vota mais', () => {
  // campaign_adsets só CRESCE: o conjunto que a Meta apagou continuaria no banco
  // e classificaria a campanha para sempre. Uma campanha que já foi de WhatsApp
  // ficaria em Contatos pela eternidade.
  const linhas = [
    { adset_id: '1', campaign_id: 'x', destination_type: 'WHATSAPP', synced_at: '2026-08-10' },
    { adset_id: '2', campaign_id: 'x', destination_type: 'INSTAGRAM_PROFILE', synced_at: '2026-08-17' },
  ];
  assert.deepEqual(conjuntosMaisRecentes(linhas).map(l => l.adset_id), ['2']);
  // e o veredito muda junto: sem a limpeza, esta campanha ficaria em 'contatos'.
  assert.equal(baldeDaCampanha({ objective: 'OUTCOME_TRAFFIC', conjuntos: conjuntosMaisRecentes(linhas) }), 'seguidores');
});

test('a régua é o MAIOR synced_at do próprio dado, nunca a data de hoje', () => {
  // Se a coleta de conjuntos falhar por três dias, o maior é a última rodada boa
  // e nada se perde — comparar com "hoje" esvaziaria a tela sem motivo.
  const linhas = [
    { adset_id: '1', campaign_id: 'x', synced_at: '2026-01-02' },
    { adset_id: '2', campaign_id: 'y', synced_at: '2026-01-05' },
    { adset_id: '3', campaign_id: 'z', synced_at: '2026-01-05' },
  ];
  assert.deepEqual(conjuntosMaisRecentes(linhas).map(l => l.adset_id), ['2', '3']);
});

test('coleta única (tudo da mesma data) volta inteira', () => {
  const linhas = [
    { adset_id: '1', campaign_id: 'x', synced_at: '2026-08-17' },
    { adset_id: '2', campaign_id: 'y', synced_at: '2026-08-17' },
  ];
  assert.deepEqual(conjuntosMaisRecentes(linhas), linhas);
});

test('sem conjunto nenhum, volta vazio — e nada quebra', () => {
  assert.deepEqual(conjuntosMaisRecentes([]), []);
  assert.deepEqual(conjuntosMaisRecentes(null), []);
  assert.deepEqual(conjuntosMaisRecentes(undefined), []);
});

/* ── Os DEZ destinos que a Meta devolveu de verdade (coleta de 17/08/2026) ──
   INSTAGRAM_PROFILE, INSTAGRAM_PROFILE_AND_FACEBOOK_PAGE, INSTAGRAM_DIRECT,
   MESSAGING_INSTAGRAM_DIRECT_MESSENGER_WHATSAPP, WHATSAPP, ON_POST, ON_VIDEO,
   ON_AD, WEBSITE, WEBSITE_AND_PHONE_CALL e UNDEFINED. O módulo nasceu conhecendo
   três deles; estes testes prendem os outros. */

test('perfil + página do Facebook é SEGUIDORES (o destino não é só INSTAGRAM_PROFILE)', () => {
  // Raíssa tem conjuntos com este destino. A comparação exata mandava a campanha
  // para o objetivo, e ela caía em SITE — o erro exato que este módulo existe
  // para eliminar.
  const c = { objective: 'OUTCOME_TRAFFIC', conjuntos: [{ destination_type: 'INSTAGRAM_PROFILE_AND_FACEBOOK_PAGE', optimization_goal: 'PROFILE_VISIT' }] };
  assert.equal(baldeDaCampanha(c), 'seguidores');
});

test('INSTAGRAM_DIRECT continua CONTATOS — a conversa é checada ANTES do perfil', () => {
  // O prefixo de "INSTAGRAM_PROFILE" não pode arrastar o direct junto, e a ordem
  // das regras é que garante isso. Com os DOIS conjuntos, conversa vence.
  assert.equal(baldeDaCampanha({ objective: 'OUTCOME_TRAFFIC', conjuntos: [{ destination_type: 'INSTAGRAM_DIRECT' }] }), 'contatos');
  assert.equal(baldeDaCampanha({ objective: 'OUTCOME_TRAFFIC', conjuntos: [
    { destination_type: 'INSTAGRAM_PROFILE_AND_FACEBOOK_PAGE' },
    { destination_type: 'INSTAGRAM_DIRECT' },
  ] }), 'contatos');
});

test('o destino comprido de mensagem da Meta é CONTATOS', () => {
  const c = { objective: 'OUTCOME_ENGAGEMENT', conjuntos: [{ destination_type: 'MESSAGING_INSTAGRAM_DIRECT_MESSENGER_WHATSAPP' }] };
  assert.equal(baldeDaCampanha(c), 'contatos');
});

test('engajamento NO ANÚNCIO (ON_AD) é ENGAJAMENTO, como ON_POST e ON_VIDEO', () => {
  assert.equal(baldeDaCampanha({ objective: 'OUTCOME_ENGAGEMENT', conjuntos: [{ destination_type: 'ON_AD' }] }), 'engajamento');
});

test('destino SITE é SITE E ALCANCE por regra própria, não por sorte do objetivo', () => {
  // Antes, estes dois só acertavam porque o objetivo por acaso levava a 'site'.
  assert.equal(baldeDaCampanha({ objective: 'OUTCOME_TRAFFIC', conjuntos: [{ destination_type: 'WEBSITE' }] }), 'site');
  assert.equal(baldeDaCampanha({ objective: 'OUTCOME_TRAFFIC', conjuntos: [{ destination_type: 'WEBSITE_AND_PHONE_CALL' }] }), 'site');
  // e agora acertam TAMBÉM quando o objetivo levaria para outro lugar: mandar
  // gente para fora do Instagram não é campanha de seguidor.
  assert.equal(baldeDaCampanha({ objective: 'OUTCOME_ENGAGEMENT', conjuntos: [{ destination_type: 'WEBSITE' }] }), 'site');
});

test('mas VENDA para o site continua em VENDAS — a regra do site não rouba a venda', () => {
  // A regra do destino de site entra DEPOIS de vendas de propósito: quase toda
  // campanha de venda aponta para o site, e mandá-las para 'site' esvaziaria o
  // balde de Vendas.
  assert.equal(baldeDaCampanha({ objective: 'OUTCOME_SALES', conjuntos: [{ destination_type: 'WEBSITE' }] }), 'vendas');
});

test('UNDEFINED não decide nada: quem manda é o objetivo, de propósito', () => {
  // "UNDEFINED" é a Meta dizendo que não sabe. Inventar um balde a partir disso
  // seria responder errado com confiança.
  assert.equal(baldeDaCampanha({ objective: 'OUTCOME_TRAFFIC', conjuntos: [{ destination_type: 'UNDEFINED' }] }), 'site');
  assert.equal(baldeDaCampanha({ objective: 'OUTCOME_ENGAGEMENT', conjuntos: [{ destination_type: 'UNDEFINED' }] }), 'engajamento');
  assert.equal(baldeDaCampanha({ objective: 'OUTCOME_SALES', conjuntos: [{ destination_type: 'UNDEFINED' }] }), 'vendas');
});

/* ── Qual balde ficou sem gasto, e em qual balde a tela realmente entra ── */

const IDS_POR_BALDE = { seguidores: ['a'], contatos: ['b'], site: ['c'], vendas: [] };

test('SEM série diária nenhuma, NENHUM balde é dado como vazio', () => {
  // A conta de "vazio" é feita sobre o gasto DIÁRIO (period_days=0), mas os
  // cartões leem o agregado de 7/30 dias — e as duas fatias não têm o mesmo
  // frescor. Em 17/08/2026 o último dia solto do Breno Vale e da Raíssa era
  // 09/08, fora da janela de 7D (10/08..16/08): sem esta guarda, os quatro
  // botões apareciam apagados dizendo que ninguém gastou, enquanto essas contas
  // gastaram R$ 80,41 e R$ 297,21 exatamente ali.
  assert.deepEqual(baldesSemGasto(IDS_POR_BALDE, []), []);
  assert.deepEqual(baldesSemGasto(IDS_POR_BALDE, null), []);
});

test('com série diária, só fica de fora o balde que não gastou', () => {
  const linhas = [
    { campaign_id: 'a', spend: '10.50' },
    { campaign_id: 'a', spend: '4.50' },
    { campaign_id: 'b', spend: '2' },
  ];
  // 'site' tem campanha mas não gastou; 'vendas' não tem campanha nenhuma.
  assert.deepEqual(baldesSemGasto(IDS_POR_BALDE, linhas).sort(), ['site', 'vendas']);
});

test('gasto zerado no dia conta como vazio; gasto de campanha desconhecida não vira balde', () => {
  assert.deepEqual(baldesSemGasto({ seguidores: ['a'] }, [{ campaign_id: 'a', spend: '0' }]), ['seguidores']);
  // id que não está em balde nenhum (campanha fora de `campaigns`) não pode
  // acender um balde que não é dele.
  assert.deepEqual(baldesSemGasto({ seguidores: ['a'] }, [{ campaign_id: 'zzz', spend: '99' }]), ['seguidores']);
});

test('balde vazio faz a tela entrar em Todos, sem apagar a escolha do dono', () => {
  assert.equal(baldeEfetivo('seguidores', ['seguidores', 'vendas']), 'todos');
  assert.equal(baldeEfetivo('seguidores', ['vendas']), 'seguidores');
  assert.equal(baldeEfetivo('todos', ['seguidores', 'contatos', 'site', 'vendas']), 'todos');
  assert.equal(baldeEfetivo('seguidores', []), 'seguidores');
  assert.equal(baldeEfetivo(undefined, []), 'todos');
});

test('linha sem synced_at é descartada: ela não pode ser a mais recente', () => {
  const linhas = [
    { adset_id: '1', campaign_id: 'x', synced_at: null },
    { adset_id: '2', campaign_id: 'y', synced_at: '2026-08-17' },
  ];
  assert.deepEqual(conjuntosMaisRecentes(linhas).map(l => l.adset_id), ['2']);
  // TODAS sem data = nenhuma vota. A tela cai na regra do objetivo, que é o
  // mesmo caminho de quando campaign_adsets ainda está vazia. Não some ninguém.
  assert.deepEqual(conjuntosMaisRecentes([{ adset_id: '1', synced_at: null }, { adset_id: '2' }]), []);
});

test('classificacaoEhProvisoria: vazia e sem erro é provisório de verdade', () => {
  assert.equal(classificacaoEhProvisoria([]), true);
});

test('classificacaoEhProvisoria: vazia MAS com erro não é provisório — quem fala é o banner de erro geral', () => {
  // .erro é como sb() marca falha de rede/sessão/permissão num array que, sem
  // isso, pareceria "não tem nada" (ver buscar-e-salvar-dados.js). É exatamente
  // este caso que quebrou uma vez: a tela dizia "classificação provisória"
  // quando a leitura tinha FALHADO, não vindo vazia de verdade.
  const linhas = [];
  linhas.erro = 'falha de rede';
  assert.equal(classificacaoEhProvisoria(linhas), false);
});

test('classificacaoEhProvisoria: com conjunto coletado, nunca é provisório', () => {
  const linhas = [{ campaign_id: '1', destination_type: 'WHATSAPP', synced_at: '2026-08-17' }];
  assert.equal(classificacaoEhProvisoria(linhas), false);
});

// LIMITE CONHECIDO, e por isso NÃO testado como um quarto caso "correto" aqui:
// negação por RLS chega como sucesso HTTP (200 + []) sem nenhum .erro — pra esta
// função, uma leitura negada e uma leitura genuinamente vazia são o MESMO
// objeto, e ela vai dizer "provisório" nos dois. Escrever um teste que afirmasse
// isso como certo estaria fingindo que o ponto cego não existe; o lugar certo
// pra ele é o comentário da função, não uma asserção que finge resolvido o que
// não dá pra resolver neste nível.

// ── QUANTAS CAMPANHAS DO RECORTE AINDA NÃO TÊM CONJUNTO ──
// O par real que motivou a contagem (Vessel, medido em 17/08/2026): duas
// campanhas gêmeas de WhatsApp, uma com conjunto coletado e outra sem. A sem
// conjunto cai pelo objetivo e vai parar num balde diferente da irmã.
const testeChatSemConjunto = { campaign_id: '1', objective: 'OUTCOME_ENGAGEMENT', conjuntos: [] };
const testeChatComConjunto = { campaign_id: '2', objective: 'OUTCOME_ENGAGEMENT', conjuntos: [{ destination_type: 'WHATSAPP' }] };

test('as gêmeas da Vessel caem em baldes diferentes — e é isso que a contagem denuncia', () => {
  assert.equal(baldeDaCampanha(testeChatSemConjunto), 'engajamento', 'sem conjunto, o objetivo manda');
  assert.equal(baldeDaCampanha(testeChatComConjunto), 'contatos', 'com conjunto, o destino manda');
  // As duas gastaram na janela; só a sem conjunto conta.
  assert.equal(campanhasSemTipoConfirmado([testeChatSemConjunto, testeChatComConjunto], ['1', '2']), 1);
});

// ── O TESTE QUE SEGURA A DECISÃO, e o mais provável de alguém desfazer sem
// perceber: campanha SEM GASTO na janela NÃO acende o aviso, mesmo sem conjunto.
//
// Medido em produção (17/08/2026): das 38 campanhas sem conjunto nas cinco
// contas, UMA tem gasto em 30 dias. Contando as paradas, a faixa vermelha ficaria
// acesa para sempre em três dos cinco perfis (Raíssa 27, Vessel 8, Breno Vale 3)
// falando de campanha que não move um centavo em cartão nenhum — e aviso que
// nunca apaga vira moldura: ninguém o lê no dia em que ele importa.
test('campanha PARADA e sem conjunto NÃO acende o aviso: ela não distorce número nenhum', () => {
  const paradaSemConjunto = { campaign_id: '9', objective: 'OUTCOME_TRAFFIC', conjuntos: [] };
  // Ela está no recorte, mas não aparece entre as que gastaram na janela.
  assert.equal(campanhasSemTipoConfirmado([paradaSemConjunto], []), 0);
  assert.equal(campanhasSemTipoConfirmado([paradaSemConjunto, testeChatSemConjunto], ['1']), 1,
    'só a que gastou conta — a parada fica de fora mesmo estando na mesma lista');
});

test('o caso que o aviso EXISTE para pegar sobrevive: campanha nova que já está gastando', () => {
  // Campanha criada agora, gastando, e ainda sem a primeira coleta de conjuntos:
  // é exatamente "com gasto e sem conjunto". É esta que pode jogar dinheiro no
  // balde errado, e é esta que continua acendendo a faixa.
  const novaGastando = { campaign_id: '7', objective: 'OUTCOME_ENGAGEMENT', conjuntos: [] };
  assert.equal(campanhasSemTipoConfirmado([novaGastando], ['7']), 1);
});

test('quem gastou mas JÁ TEM conjunto nunca conta: o tipo dela está confirmado', () => {
  assert.equal(campanhasSemTipoConfirmado([testeChatComConjunto], ['2']), 0);
});

test('tabela cheia NÃO quer dizer classificação fechada: o aviso do perfil cala e a contagem fala', () => {
  const linhasDeConjunto = [{ campaign_id: '2', destination_type: 'WHATSAPP', synced_at: '2026-08-17' }];
  assert.equal(classificacaoEhProvisoria(linhasDeConjunto), false, 'o aviso do perfil inteiro não dispara');
  assert.equal(campanhasSemTipoConfirmado([testeChatSemConjunto, testeChatComConjunto], ['1', '2']), 1, 'mas ainda há campanha com gasto e sem tipo');
});

test('id que chega como número casa com o id em texto (o PostgREST devolve os dois jeitos)', () => {
  assert.equal(campanhasSemTipoConfirmado([{ campaign_id: 120210000000000340, conjuntos: [] }], ['120210000000000340']), 1);
});

test('entrada ausente não vira contagem: sem lista, nada a afirmar', () => {
  assert.equal(campanhasSemTipoConfirmado(null, ['1']), 0);
  assert.equal(campanhasSemTipoConfirmado([testeChatSemConjunto], null), 0);
});

// ── A FRASE DEBAIXO DA BARRA ──
// O defeito que ela conserta: na primeira pintura a tela dizia "Todas as
// campanhas (126)" logo acima de cartões que falavam de 9 delas.
test('com um tipo escolhido, a frase diz o tipo E o tamanho da fatia', () => {
  assert.equal(fraseDoRecorte('seguidores', { noRecorte: 9, doBalde: 9, total: 126 }), 'Todas as campanhas de Seguidores (9 de 126)');
});

test('filtro manual por cima do tipo: a frase conta dentro do tipo, não da conta inteira', () => {
  assert.equal(fraseDoRecorte('seguidores', { noRecorte: 3, doBalde: 9, total: 126 }), '3 de 9 campanhas de Seguidores selecionadas');
});

test('em Todos a frase continua exatamente a de hoje', () => {
  assert.equal(fraseDoRecorte('todos', { noRecorte: 126, doBalde: 126, total: 126 }), 'Todas as campanhas (126)');
  assert.equal(fraseDoRecorte('todos', { noRecorte: 4, doBalde: 126, total: 126 }), '4 de 126 campanhas selecionadas');
  assert.equal(fraseDoRecorte(null, { noRecorte: 126, doBalde: null, total: 126 }), 'Todas as campanhas (126)');
});

test('nenhuma campanha selecionada vence tudo, com tipo ou sem', () => {
  assert.equal(fraseDoRecorte('todos', { noRecorte: 0, doBalde: 126, total: 126 }), 'Nenhuma campanha selecionada');
  assert.equal(fraseDoRecorte('contatos', { noRecorte: 0, doBalde: 12, total: 126 }), 'Nenhuma campanha selecionada');
});

test('sem a contagem do tipo, a frase diz o tipo e CALA o número — não inventa um', () => {
  // É a pintura da troca de perfil, que acontece antes dos dados chegarem.
  assert.equal(fraseDoRecorte('site', { noRecorte: 126, doBalde: null, total: 126 }), 'Todas as campanhas de Site e alcance');
  assert.equal(fraseDoRecorte('site', { noRecorte: 4, doBalde: null, total: 126 }), 'Campanhas selecionadas, dentro de Site e alcance');
});

test('conta sem campanha nenhuma não vira frase de tipo', () => {
  assert.equal(fraseDoRecorte('seguidores', { noRecorte: null, doBalde: null, total: 0 }), 'Todas as campanhas (0)');
});

/* ── CLICAR NO BALDE JÁ TRAZ AS CAMPANHAS DELE ──────────────────────────────
 *
 * Pedido do dono (10/09/2026): "quando clico nos botões é para trazer o filtro de
 * campanhas automático já, inclusive campanhas pausadas mas que tiveram gasto no
 * intervalo selecionado, caso n tenha dado, mostre uma mensagem".
 *
 * ⚠️ PAUSADA COM GASTO ENTRA. O que decide é ter gastado no período, não o estado
 * de hoje: campanha pausada ontem gastou dinheiro de verdade nos dias anteriores, e
 * tirá-la faria o investimento do período sair menor do que foi.
 *
 * ⚠️ E CAMPANHA ATIVA SEM GASTO FICA DE FORA. Ela só encheria a lista de nomes que
 * não movem número nenhum naquele intervalo.
 */

test('o balde traz quem gastou no período, pausada inclusive', () => {
  const linhas = [
    { campaign_id: 'a', spend: 10 },   // ativa, gastou
    { campaign_id: 'b', spend: 0 },    // ativa, não gastou
    { campaign_id: 'c', spend: 5 },    // PAUSADA, gastou → entra
  ]
  assert.deepEqual(idsComGastoNoPeriodo(['a', 'b', 'c'], linhas), ['a', 'c'])
})

test('soma os dias antes de decidir', () => {
  // Gasto de centavos espalhado em vários dias é gasto.
  const linhas = [
    { campaign_id: 'a', spend: 0 }, { campaign_id: 'a', spend: 0.4 },
    { campaign_id: 'b', spend: 0 }, { campaign_id: 'b', spend: 0 },
  ]
  assert.deepEqual(idsComGastoNoPeriodo(['a', 'b'], linhas), ['a'])
})

test('⚠️ nenhuma gastou devolve lista VAZIA — e é ela que vira a mensagem', () => {
  assert.deepEqual(idsComGastoNoPeriodo(['a', 'b'], [{ campaign_id: 'a', spend: 0 }]), [])
  assert.deepEqual(idsComGastoNoPeriodo(['a'], []), [])
})

test('a ordem do balde é preservada', () => {
  // A lista vira o recorte e aparece na tela; ordem que muda a cada carga faz a
  // pessoa achar que o conteúdo mudou.
  const linhas = [{ campaign_id: 'c', spend: 1 }, { campaign_id: 'a', spend: 1 }]
  assert.deepEqual(idsComGastoNoPeriodo(['a', 'b', 'c'], linhas), ['a', 'c'])
})

test('aguenta lista nula e gasto estragado', () => {
  assert.deepEqual(idsComGastoNoPeriodo(null, null), [])
  assert.deepEqual(idsComGastoNoPeriodo(['a'], [{ campaign_id: 'a', spend: 'muito' }]), [])
})

test('a frase avisa quando o período não teve campanha do tipo', () => {
  assert.equal(
    fraseDoRecorte('contatos', { total: 68, noRecorte: 0, doBalde: 4 }, { semGastoNoPeriodo: true }),
    'Sem campanhas para esse período',
  )
  // Sem a marca, a frase de sempre continua valendo — desmarcar tudo à mão não é
  // a mesma coisa que o período não ter gasto.
  assert.equal(
    fraseDoRecorte('contatos', { total: 68, noRecorte: 0, doBalde: 4 }),
    'Nenhuma campanha selecionada',
  )
})
