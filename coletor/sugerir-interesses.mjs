// Robô semanal: sugere interesses de segmentação por marca × objetivo.
//
// COMO FUNCIONA: lê as marcas ativas e as lojas de cada uma, pede ao modelo
// TERMOS DE BUSCA para cada objetivo, BUSCA CADA TERMO NA META e colhe os
// interesses que voltarem. Os nomes saem do catálogo da Meta — a IA só escolhe
// o assunto.
//
// POR QUE ASSIM: antes se pedia ao modelo o NOME EXATO de cada interesse e
// depois se validava nome por nome. Medido na conta de verdade, 15% dos nomes
// existiam — a faixa chegava à tela com uma ou duas sugestões. Pedir nome exato
// é pedir que o modelo decore um catálogo que ele nunca viu; pedir o assunto é
// pedir o que ele sabe fazer.
//
// POR QUE PRÉ-CALCULADO E NÃO SOB CLIQUE: a sugestão já está na tela quando o
// dono abre o editor, o custo é fixo por semana em vez de crescer com o uso, e
// não se abre a porta de "IA respondendo a clique", que este produto não tem.
//
// Custo: ~6 gerações pequenas por semana com Sonnet. Anotado em ia_execucoes,
// então o valor real aparece no painel Status do Claude, em reais.
import { structured, SONNET, usageSummary } from './lib-llm.mjs';
import { registrarExecucao } from './registrar-execucao.mjs';
import { abrirRest } from './lib/rest-pg.mjs';
import { montarPedido, montarEscolha, MAXIMO_POR_OBJETIVO, termosDaMarca, juntarTermos, escolhidosValidos, linhaDaEscolha, nomesPropostos, colherDaBusca, linhaDosTermos, linhasDaPrevia, linhasDosLargos, linhasDosPequenos, linhasPorTermo, comCidadesResolvidas, rodadaFalhouInteira, OBJETIVOS } from './lib/interesses.mjs';
// Login da conta de serviço (mesma usada por subir-estudio.mjs, ativar-estudio.mjs
// etc.) — o meta-proxy chama auth.getUser() sobre o Authorization recebido, e uma
// service key não é sessão de usuário: ela sempre daria 401 "nao autenticado" ali.
import { loginServico, urlDaEdge, cabecalhosDaEdge } from './lib/bling-comercial.mjs';

// Mesma anon key hardcoded (com override por env) que os outros scripts de
// coletor/ usam para chamar o meta-proxy — não é segredo, é a chave pública
// do projeto.
const MODEL = process.env.INTERESSES_MODEL || SONNET;
const DRY = process.argv.includes('--dry');

// REST do Supabase (rollback) ou pg com o papel robo_interesses (REST_VIA_PG=1); aberto em run() por abrirRest().
let rest, REST, sbHeaders;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function sbGet(path) {
  const r = await rest.fetch(REST + path, { headers: sbHeaders });
  if (!r.ok) throw new Error(`GET ${path} ${r.status}`);
  return r.json();
}
async function sbPost(path, body, prefer) {
  const r = await rest.fetch(REST + path, {
    method: 'POST',
    headers: { ...sbHeaders, Prefer: prefer || 'return=minimal' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`POST ${path} ${r.status} ${(await r.text()).slice(0, 200)}`);
}

// Busca UM termo no catálogo de interesses da Meta, pela Edge meta-proxy.
//
// É EXATAMENTE A MESMA CHAMADA que a Fábrica faz quando o dono digita na busca
// de interesses (painel-subir.vue, "buscarInteresses"): type=adinterest, o termo
// em `q`, `limit` 10. Nada além disso — e o parágrafo abaixo existe pra que
// ninguém acrescente `locale` de novo achando que é uma boa ideia nova.
//
// JÁ TENTAMOS `locale: 'pt_BR'` — NÃO FUNCIONA. MEDIDO, NÃO SUPOSTO:
// a Meta ACEITOU o parâmetro (nenhum 400, nenhum erro, zero ⚠ no log) e
// devolveu ZERO resultado nas 48 buscas da rodada. Ou seja: o parâmetro existe
// de verdade, mas o formato/significado não é o que a gente supôs — o locale de
// segmentação da Meta costuma ser um ID numérico, não a sigla em texto.
//
// NÃO SAIA CHUTANDO OUTRO FORMATO. Cada chute custa uma rodada, e o problema que
// o locale ia resolver (filme americano, semana de moda da Índia, rede social
// russa aparecendo numa busca em português) pode muito bem já estar resolvido de
// graça pelo pedido: aqueles nomes vieram todos de termo GENÉRICO batendo no
// catálogo mundial. Termo específico em português tende a cair sozinho em
// entrada brasileira. É isso que a próxima rodada mede.
//
// Fica registrado o susto que essa tentativa deu, porque ele valeu a pena: com
// zero resultado em tudo, a rodada terminou VERMELHA e com código de saída 1,
// em vez de gravar uma faixa vazia em silêncio. Foi a regra da "rodada que não
// produziu nada é falha" (rodadaFalhouInteira) fazendo exatamente o trabalho
// dela.
//
// Manda os parâmetros como objeto, não texto: o proxy já faz JSON.stringify em
// valor que é objeto, e converter aqui converteria duas vezes.
// AUTENTICAÇÃO: token de USUÁRIO (loginServico), não a service key — o
// meta-proxy resolve o chamador via auth.getUser(), que só reconhece sessão de
// usuário de verdade. `token` vem de run(), obtido uma única vez antes do laço.
async function buscarNaMeta(accountId, termo, token) {
  const r = await fetch(urlDaEdge('meta-proxy', token), {
    method: 'POST',
    headers: cabecalhosDaEdge(token),
    body: JSON.stringify({
      accountId,
      path: '/search',
      params: { type: 'adinterest', q: termo, limit: 10 },
      method: 'GET',
    }),
  });
  if (!r.ok) throw new Error('meta-proxy ' + r.status);
  return r.json();
}

// Traduz CHAVE de cidade → NOME de cidade, perguntando à Meta.
//
// POR QUE PRECISA: `fabrica_lojas.geo_cities` guarda chaves ('[267873,241913]'),
// não nomes — foi assim que a migration 018 semeou a coluna. Sem traduzir, o
// pedido à IA sai com o nome das lojas e ZERO geografia, e ninguém percebe:
// nada dá erro, a rodada fica verde e as sugestões só ficam mais genéricas.
//
// É A MESMA CHAMADA da Fábrica (painel-subir.vue, "resolverNomesCidades"):
// type=adgeolocationmeta com a lista de chaves. Manda ARRAY porque o meta-proxy
// já faz JSON.stringify em valor que é objeto — a Fábrica manda o texto pronto,
// e os dois chegam idênticos na Meta.
//
// UMA VEZ POR RODADA: as mesmas chaves se repetem em todo objetivo de toda
// marca, e cada ida à Meta é uma chamada paga. Resolver por marca × objetivo
// seria pagar seis vezes pela mesma resposta.
//
// A geolocalização da Meta é global (não é dado da conta de anúncios), então
// qualquer `accountId` válido serve só para o proxy achar o token.
async function resolverNomesDeCidade(chaves, token, accountId) {
  const brutas = Array.isArray(chaves) ? chaves : [];
  const unicas = [...new Set(brutas.filter((k) => k != null && typeof k !== 'object').map((k) => String(k)))]
    .filter((k) => k.length > 0);
  if (!unicas.length || !accountId) return {};
  try {
    const r = await fetch(urlDaEdge('meta-proxy', token), {
      method: 'POST',
      headers: cabecalhosDaEdge(token),
      body: JSON.stringify({
        accountId,
        path: '/search',
        params: { type: 'adgeolocationmeta', cities: unicas },
        method: 'GET',
      }),
    });
    if (!r.ok) throw new Error('meta-proxy ' + r.status);
    const resp = await r.json();
    const cidades = (resp && resp.data && resp.data.cities) || {};
    const mapa = {};
    for (const chave of Object.keys(cidades)) {
      const c = cidades[chave];
      if (!c || typeof c !== 'object') continue;
      const nome = typeof c.name === 'string' ? c.name.trim() : '';
      if (!nome) continue;
      // "Americana (São Paulo)" e não "Americana · São Paulo": o pedido junta as
      // cidades com vírgula, e a vírgula do estado viraria uma cidade a mais.
      const regiao = typeof c.region === 'string' ? c.region.trim() : '';
      mapa[String(chave)] = regiao ? `${nome} (${regiao})` : nome;
    }
    return mapa;
  } catch (e) {
    // NÃO derruba a rodada. Um pedido só com o nome das lojas rende sugestão mais
    // genérica que um com as cidades — mas é MUITO melhor que semana sem sugestão
    // nenhuma, que é o que aconteceria se a falha subisse.
    console.log(`  ⚠ não consegui traduzir as cidades na Meta — ${String(e).slice(0, 120)}`);
    console.log('    (o pedido segue sem a geografia das lojas)');
    return {};
  }
}

// O campo continua se chamando `interesses` — é o que o modelo devolve, e mudar
// o nome não mudaria nada além de exigir tocar em mais um lugar. O que ele
// carrega hoje são TERMOS DE BUSCA, e a descrição diz isso.
const SCHEMA = {
  type: 'object',
  properties: {
    interesses: {
      type: 'array',
      items: { type: 'string' },
      // Voltou a pedir termo CURTO, junto com o pedido: a versão que exigia
      // termo "ESPECÍFICO" zerou as 48 buscas — o catálogo da Meta é grosso e
      // não tem entrada pra termo estreito. Ver o comentário em montarPedido.
      description: 'Termos de busca curtos (1 a 3 palavras), em português do Brasil, até 8.',
    },
  },
  required: ['interesses'],
};

// SEGUNDA ETAPA: só os id, nunca nomes.
//
// Pedir NOME de volta reabriria a porta que este robô fechou a duras penas — a
// IA escreveria "Bolsas femininas" com a melhor das intenções e gravaríamos um
// interesse que não existe no Meta. Id ela não tem como inventar de forma
// plausível, e `escolhidosValidos` ainda confere um a um contra a lista
// oferecida.
const SCHEMA_ESCOLHA = {
  type: 'object',
  properties: {
    ids: {
      type: 'array',
      items: { type: 'string' },
      description: 'Os id dos interesses que servem, do mais relevante para o menos. Só id que está na lista.',
    },
  },
  required: ['ids'],
};

// Pausa entre uma busca e a seguinte. São 8 termos × 6 objetivos por marca, e
// este robô roda uma vez por semana: não existe motivo nenhum pra ter pressa
// com a API da Meta.
const PAUSA_ENTRE_BUSCAS = 400;

export async function run() {
  const t0 = Date.now();
  rest = await abrirRest();   // banco fora (ou falta a chave do REST): falha aqui, antes de qualquer escrita
  ({ REST, sb: sbHeaders } = rest);

  // Login UMA VEZ antes de tocar em qualquer marca: se a conta de serviço não
  // loga, nenhuma validação na Meta vai funcionar mesmo — melhor falhar rápido
  // com uma mensagem clara do que rodar todas as marcas colecionando o mesmo
  // 401 repetido. O erro sobe direto pro catch de run() lá embaixo, que já
  // grava em ia_execucoes com status 'erro'.
  const token = await loginServico({ naApi: true });

  // `segmento` (o que a marca vende) é o campo mais importante do pedido — ver
  // montarPedido. Esquecer de pedir a coluna aqui NÃO daria erro: ela chegaria
  // undefined, a linha sumiria do pedido e a IA voltaria a adivinhar pelo nome,
  // exatamente o defeito que a coluna existe pra consertar, e em silêncio.
  const marcas = await sbGet('/fabrica_marcas?select=id,nome,segmento,termos_produto,account_id&ativo=eq.true');
  const lojas = await sbGet('/fabrica_lojas?select=nome,marca_id,geo_cities');

  // Traduz TODAS as chaves de cidade de uma vez, antes do laço (ver
  // resolverNomesDeCidade). Se a Meta não responder, `nomesDeCidade` fica vazio,
  // as chaves seguem cruas e o pedido sai sem geografia — sem derrubar a rodada.
  const chavesDeCidade = lojas.flatMap((l) => (Array.isArray(l && l.geo_cities) ? l.geo_cities : []));
  const contaParaGeo = (marcas.find((m) => m && m.account_id) || {}).account_id;
  const nomesDeCidade = await resolverNomesDeCidade(chavesDeCidade, token, contaParaGeo);

  // `gravadas` só sobe quando uma linha É ESCRITA de verdade — em --dry ela
  // fica genuinamente zero, como no budget-ia.mjs. `simuladas` conta o que
  // TERIA sido gravado, separado, pra --dry poder ser informativo sem inflar
  // um número que vai parar em ia_execucoes como se fosse escrita real.
  let gravadas = 0, simuladas = 0, puladas = 0, totPropostos = 0, totValidos = 0;

  for (const marca of marcas) {
    const lojasDaMarca = lojas
      .filter((l) => l && l.marca_id === marca.id)
      .map((l) => comCidadesResolvidas(l, nomesDeCidade));
    for (const objetivo of OBJETIVOS) {
      const pedido = montarPedido({ marca, lojas: lojasDaMarca, objetivo });
      if (!pedido) { puladas++; continue; }

      let resposta;
      try {
        resposta = await structured({ model: MODEL, system: pedido.system, user: pedido.user, schema: SCHEMA, toolName: 'sugerir' });
      } catch (e) {
        console.log(`  ⚠ ${marca.nome} · ${objetivo}: IA falhou — ${String(e).slice(0, 120)}`);
        puladas++; continue;
      }

      // OS PRODUTOS DA MARCA ENTRAM SEMPRE, na frente dos palpites da IA.
      // Ver termosDaMarca/juntarTermos: `Cinto` ficou em zero dos seis objetivos
      // numa rodada real só porque a IA não lembrou de pedir, e cinto é a maior
      // categoria do estoque. Produto da loja não pode depender de sorteio.
      const termos = juntarTermos(termosDaMarca(marca), nomesPropostos(resposta));
      if (!termos.length) { console.log(`  ⚠ ${marca.nome} · ${objetivo}: nem a marca nem a IA deram termo nenhum`); puladas++; continue; }

      // SÓ EM SECO, E ANTES DE BUSCAR: os termos que a IA devolveu.
      //
      // Duas rodadas terminaram em zero e não deu pra saber por quê, porque os
      // termos — a única pista que restava — não apareciam em lugar nenhum. Sai
      // ANTES das buscas de propósito: assim ele aparece mesmo quando toda busca
      // falha ou toda busca volta vazia, que é justamente quando ele importa.
      if (DRY) console.log(`  ${marca.nome} · ${objetivo} — ${linhaDosTermos(termos)}`);

      // UMA BUSCA POR TERMO, e uma busca que falha NÃO derruba o objetivo: os
      // outros termos ainda trazem interesse bom. Só se TODAS falharem é que o
      // objetivo é pulado — aí a causa não é o termo, é a Meta ou o token, e a
      // regra antiga continua valendo: sem resposta da Meta, não se grava nada.
      // GUARDADO EM PARES { termo, resposta }, não em dois arrays lado a lado:
      // busca que falha não entra, e sem o par o log de "o que cada termo achou"
      // atribuiria o resultado ao termo errado a partir da primeira falha.
      const buscas = [];
      for (const termo of termos) {
        try {
          buscas.push({ termo, resposta: await buscarNaMeta(marca.account_id, termo, token) });
        } catch (e) {
          console.log(`  ⚠ ${marca.nome} · ${objetivo}: a busca por "${termo}" falhou — ${String(e).slice(0, 120)}`);
        }
        await sleep(PAUSA_ENTRE_BUSCAS);
      }
      const respostas = buscas.map((b) => b.resposta);
      if (!respostas.length) {
        console.log(`  ⚠ ${marca.nome} · ${objetivo}: TODAS as ${termos.length} buscas na Meta falharam — nada gravado`);
        puladas++; continue;
      }

      // COLHE SEM TETO DE QUANTIDADE — o `Infinity` aqui é o conserto de
      // 2026-08-01, não descuido.
      //
      // Com o teto de 12 aplicado AQUI, o corte era por TAMANHO DE PÚBLICO e
      // acontecia ANTES de a IA olhar. `Cinto` (37 mi), da maior categoria do
      // estoque, não cabia entre os 12 maiores e sumia dos seis objetivos — sem
      // nunca ter sido recusado por ninguém. `Hard rock` (186 mi) ficava no
      // lugar dele. Ver MAXIMO_POR_OBJETIVO em lib/interesses.mjs.
      //
      // Os cortes por TAMANHO (piso e teto de público) continuam valendo aqui:
      // aqueles julgam se o interesse serve como critério de segmentação, o que
      // é diferente de escolher os N melhores.
      const colhido = colherDaBusca(termos, respostas, Infinity);
      const { propostos: nProp, largos, pequenos } = colhido;

      // SEGUNDA ETAPA: a IA escolhe entre as fichinhas REAIS que a Meta devolveu.
      //
      // Aqui ela não adivinha nada — recebe o que existe e só separa o que serve
      // do que caiu por coincidência de palavra ("bolsa" traz bolsa de valores).
      // Ver montarEscolha em lib/interesses.mjs para o porquê de cada linha.
      //
      // DEGRADA, NÃO DERRUBA: se esta chamada falhar, a lista segue como veio da
      // busca — que é exatamente o comportamento de antes desta etapa existir.
      // Perder a rodada inteira por causa de um refinamento seria trocar uma
      // faixa boa por nenhuma faixa. Mas o aviso sai no log: degradar em
      // silêncio é como um filtro desligado passa meses sem ninguém notar.
      let itens = colhido.itens;
      const escolha = montarEscolha({ marca, objetivo, itens });
      if (escolha) {
        try {
          const r = await structured({ model: MODEL, system: escolha.system, user: escolha.user, schema: SCHEMA_ESCOLHA, toolName: 'escolher' });
          const ficaram = escolhidosValidos(r && r.ids, itens);
          // Lista vazia é resposta legítima ("nenhum serve") e é respeitada: quem
          // decide o que fazer com uma rodada inteira vazia é rodadaFalhouInteira,
          // lá embaixo, que já pinta o Actions de vermelho.
          if (DRY) console.log(linhaDaEscolha(itens, ficaram));
          itens = ficaram;
        } catch (e) {
          console.log(`  ⚠ ${marca.nome} · ${objetivo}: a escolha da IA falhou — seguindo com a lista da busca (${String(e).slice(0, 90)})`);
        }
      }
      // O TETO DE QUANTIDADE VEM AGORA, sobre o que a IA escolheu — e não mais
      // sobre o que a busca achou. A lista chega dela em ordem de RELEVÂNCIA,
      // então cortar o fim tira o menos relevante, e não o menor.
      //
      // Vale também para o caminho degradado (escolha falhou): ali a ordem ainda
      // é por tamanho, o corte volta a ser o antigo, e isso é aceitável — é o
      // comportamento de antes, num caminho de exceção que grita no log.
      if (itens.length > MAXIMO_POR_OBJETIVO) itens = itens.slice(0, MAXIMO_POR_OBJETIVO);
      const validos = itens.length;
      totPropostos += nProp; totValidos += validos;
      // O número mudou de sentido: antes era "quantos sobreviveram à validação",
      // agora é "quantos interesses as buscas acharam". Passar de 100% é normal —
      // um termo pode trazer vários interesses.
      console.log(`  ${marca.nome} · ${objetivo}: ${validos} interesses achados a partir de ${nProp} termos`);

      // A PRÉVIA VEM ANTES DO `continue` DE LISTA VAZIA, e isso é um conserto:
      // do jeito anterior, um objetivo em que TUDO foi descartado por tamanho
      // saía do laço aqui em cima e o bloco de descartados nunca era impresso —
      // ou seja, o corte ficava invisível justamente no caso em que ele explica
      // tudo. Com `itens` vazio a prévia simplesmente não tem linha nenhuma.
      if (DRY) {
        // A prévia do que SERIA gravado, nome por nome, na mesma ordem que iria
        // pro banco: o número diz se rendeu, os nomes dizem se prestam, e só o
        // dono responde a segunda pergunta.
        for (const linha of linhasDaPrevia(itens)) console.log(linha);
        // E o que foi CORTADO por ser largo demais, com o tamanho. O teto que
        // corta é provisório (ver TETO_DE_PUBLICO): sem ver o que ele derruba,
        // não há como saber se está no lugar certo — e um corte invisível nunca
        // seria corrigido.
        for (const linha of linhasDosLargos(largos)) console.log(linha);
        // O mesmo por baixo (ver PISO_DE_PUBLICO). Vem depois dos largos porque
        // é a leitura menos frequente: o teto foi afrouxado e o piso, apertado.
        for (const linha of linhasDosPequenos(pequenos)) console.log(linha);
        // E, por último, o CRU: qual termo achou o quê. É a linha que responde
        // se a lista repetida vem da IA ou do catálogo da Meta. Fica no fim de
        // propósito — é a mais comprida, e quem só quer conferir a qualidade da
        // rodada já leu tudo que precisava acima.
        for (const linha of linhasPorTermo(buscas)) console.log(linha);
      }

      if (!itens.length) { puladas++; continue; }
      // Em --dry nenhuma SUGESTÃO é gravada. A linha de ia_execucoes lá embaixo é
      // gravada do mesmo jeito, e isso é de propósito: as chamadas de IA da rodada
      // seca custam dinheiro de verdade, então o custo tem de aparecer no painel.
      // O que não sobe é `gravadas`: um registro de auditoria que afirmasse
      // "6 gravadas" numa rodada seca seria uma mentira permanente no robô que
      // ninguém fica olhando.
      // A prévia já foi impressa acima. Aqui só se conta a simulação: no modo
      // normal a linha está na tabela e na tela, e o log fica sendo resumo.
      if (DRY) { simuladas++; continue; }

      try {
        await sbPost('/interesses_sugeridos?on_conflict=marca_id,objetivo', {
          marca_id: marca.id, objetivo, itens, propostos: nProp, validos, modelo: MODEL,
          gerado_em: new Date().toISOString(),
        }, 'resolution=merge-duplicates,return=minimal');
      } catch (e) {
        // Uma marca não pode derrubar a rodada inteira: as outras marca×objetivo
        // ainda não processadas continuam valendo a pena tentar.
        console.log(`  ⚠ ${marca.nome} · ${objetivo}: gravar falhou — ${String(e).slice(0, 120)}`);
        puladas++; continue;
      }
      gravadas++;
      await sleep(500);
    }
  }

  const uso = usageSummary();
  // NÃO é mais "aproveitamento": não existe mais um total de nomes propostos do
  // qual uma parte sobrevive. São interesses ACHADOS a partir de termos buscados,
  // e o número pode passar de um por termo sem que isso seja anomalia nenhuma.
  // Manter a palavra antiga aqui faria o dono ler 250% e achar que quebrou.
  const rendimento = `${totValidos} interesses achados em ${totPropostos} termos`;
  // Em --dry o resumo fala de `simuladas`, nunca de `gravadas` — a mesma frase
  // vira o log do console E o `detalhe` gravado em ia_execucoes logo abaixo,
  // então não existe uma versão "bonita" pro console e uma verdadeira pro
  // banco: é a mesma, e ela já nasce certa nos dois lugares.
  const base = DRY
    ? `SECO: ${simuladas} teriam sido gravadas (nada escrito), ${puladas} puladas, ${rendimento}`
    : `${gravadas} gravadas, ${puladas} puladas, ${rendimento}`;

  // FALHA SISTÊMICA ≠ falha de uma marca. A regra mora no lib (com teste), porque
  // é ela que decide se um problema aparece ou passa batido — ver rodadaFalhouInteira.
  const falhouTudo = rodadaFalhouInteira({ gravadas, simuladas, puladas, seco: DRY });
  const resumo = falhouTudo
    ? `${base} — NADA saiu nesta rodada; olhe o log acima para achar a causa`
    : base;
  console.log(`\n${resumo}`);
  if (falhouTudo) {
    // exitCode (e não process.exit) pra que a linha de auditoria abaixo AINDA
    // seja gravada antes do processo terminar em vermelho no Actions.
    process.exitCode = 1;
    console.error('rodada sem nenhum resultado — marcando a execução como erro');
  }

  // NOMES CONFERIDOS em lib-llm.mjs: usageSummary devolve { usd, tin, tout,
  // calls, text } — NÃO inputTokens/outputTokens/chamadas. Errar aqui faria o
  // custo aparecer como ZERO no painel Status do Claude.
  // E não se passa `usd`: quem calcula preço é o registrar-execucao.mjs, que é
  // a fonte de verdade (o lib-llm tem tabela própria que pode divergir).
  await registrarExecucao({
    robo: 'sugerir-interesses', acao: 'sugestão de interesses', modelo: MODEL,
    inputTokens: uso.tin || 0, outputTokens: uso.tout || 0, chamadas: uso.calls || 0,
    // `itens: gravadas` (nunca `simuladas`): em --dry isso fica 0 de verdade,
    // porque nenhuma linha foi escrita — o registro de auditoria não pode
    // afirmar uma gravação que não aconteceu.
    duracaoMs: Date.now() - t0, itens: gravadas, unidade: 'marca×objetivo',
    status: falhouTudo ? 'erro' : 'ok', detalhe: resumo,
  });
}

run().catch(async (e) => {
  console.error(e);
  await registrarExecucao({
    robo: 'sugerir-interesses', acao: 'sugestão de interesses', modelo: MODEL,
    status: 'erro', detalhe: String((e && e.message) || e).slice(0, 500),
  });
  process.exit(1);
}).finally(() => rest?.fechar());
