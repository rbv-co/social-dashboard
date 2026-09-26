import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { semComentarios } from '../../compartilhado/guarda-de-imports.mjs';

// TRAVA OBRIGATÓRIA da Onda C, Tarefa 5.
//
// O DEFEITO (achado no plano da Onda C, 25/09/2026, ao medir a régua real):
// `ALVOS` foi REINDEXADO por MERCADO (mercados.js/alvos.js) — as chaves hoje
// são 'conversa', 'perfil', 'video', 'post'... — mas a tela (.vue:2473, antes
// desta tarefa) ainda pedia a meta pelo BALDE do objetivo declarado
// ('engajamento', 'mensagens', 'trafego', 'vendas', 'leads',
// 'reconhecimento'). `metaDoBalde` (regua.js) resolve a chave por
// `ALVOS[balde].chaveMeta || balde` — como nenhum desses nomes de balde bate
// mais em ALVOS, a busca caía num ATALHO SILENCIOSO (`|| balde`) que lê
// `regua.metas[balde]` direto. Esse atalho é LEGÍTIMO para as INTERAÇÕES
// declaradas (curtida/comentário/salvamento/compartilhamento — não estão em
// ALVOS de propósito, ver regua.js), mas para um balde de OBJETIVO ele
// coincide por pura sorte de nome em alguns casos e ERRA feio no de
// engajamento: comparava custo por engajamento (R$ 0,09) contra a meta
// ANTIGA em R$/ponto (R$ 0,012) — 7,5× errado, com cara de certo.
//
// ⚠️ O atalho em si NÃO PODE SER REMOVIDO de `metaDoBalde` — é o que faz as
// interações declaradas funcionarem, e elas não têm (nem precisam ter)
// entrada em ALVOS. A trava tem de ser no CHAMADOR: nenhum caminho da tela
// pode passar um nome de balde antigo para `alvoDoBalde`/`metaDoBalde`. Só os
// MERCADOS (mercados.js) e as INTERAÇÕES declaradas podem indexar essas
// funções a partir da tela.
//
// COMO ESTE TESTE PROVA ISSO: extrai o argumento de TODA chamada de
// `alvoDoBalde(...)` e o SEGUNDO argumento de TODA chamada de
// `metaDoBalde(..., ...)` no(s) <script> da tela, e afirma que cada um é uma
// das variáveis da lista branca — nunca um balde velho, literal ou por
// variável. `semComentarios` (guarda-de-imports.mjs) apaga comentário E
// esvazia string ('...'  vira ''), então um literal como
// `alvoDoBalde('mensagens')` também é pego: sobra `alvoDoBalde('')`, que não
// bate em nenhum nome da lista branca.

const AQUI = dirname(fileURLToPath(import.meta.url));
const VUE = readFileSync(join(AQUI, 'tela-de-gestao-trafego.vue'), 'utf8');
const SCRIPT_BRUTO = [...VUE.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
const CORPO = semComentarios(SCRIPT_BRUTO);

// Os nomes de balde ANTIGO (objetivo declarado) — nenhum pode ser índice de
// ALVOS a partir de agora. 'padrao' também não é mercado, mas nunca teve
// alvo — incluído aqui só para documentar que ele também está fora.
const BALDES_ANTIGOS = ['engajamento', 'mensagens', 'trafego', 'vendas', 'leads', 'reconhecimento', 'padrao'];

// ÚNICA fonte da lista branca — TODOS os testes abaixo leem DAQUI, nunca uma
// cópia local (I2, rodada de correção 2: ver o comentário grande mais abaixo,
// no teste "todo balde antigo segue banido", sobre por que uma cópia local
// tornava a "documentação executável" uma promessa falsa).
const PERMITIDOS_ALVO_DO_BALDE = new Set(['mercado', 'mercadoCj', 'mercadoDosAnuncios']);
// 'mercado'/'mercadoCj' são os mercados de mercados.js (cartão da campanha e
// linha do conjunto); 'mercadoDosAnuncios' é o mesmo mercado, descido pronto
// pro CARTÃO DO ANÚNCIO (Onda C, Tarefa 5, Passo 3 — `mercadoDoGrupoDeAnuncios`
// em mercados.js: o da campanha, ou o do CONJUNTO quando ela é MISTA, nunca
// recalculado por anúncio); 'objDeclarado'/'declAd' são as INTERAÇÕES
// declaradas (Fase 3) — o atalho de metaDoBalde que resolve por essas chaves
// é LEGÍTIMO (não estão em ALVOS, ver regua.js) e não pode ser removido da
// função; esta trava é no CHAMADOR.
const PERMITIDOS_META_DO_BALDE = new Set(['mercado', 'mercadoCj', 'mercadoDosAnuncios', 'objDeclarado', 'declAd']);

// ⚠️ LIMITE HONESTO DESTA TRAVA (I1-b, rodada de correção 2, 25/09/2026): a
// lista branca é checada pelo NOME da variável no ponto de chamada, NÃO pela
// PROCEDÊNCIA do valor que ela carrega. Isto passaria limpo, hoje, sem
// acusação nenhuma:
//
//     const mercado = temMensagem ? 'mensagens' : baldeCamp; // balde antigo!
//     metaDoBalde(reguaAtiva, mercado);
//
// Bastou batizar a variável de "mercado" para a trava aprovar um valor que na
// verdade veio do balde antigo (`baldeCamp`). Regex sobre texto não enxerga de
// onde uma variável foi atribuída — fechar esse buraco por completo pediria
// análise de fluxo de dados, que este arquivo não faz. O que ESTA trava
// garante: nenhuma chamada usa, DIRETAMENTE no argumento, um literal de balde
// antigo ou uma variável de outro nome fora da lista branca. O que ela NÃO
// garante: que a variável chamada "mercado"/"mercadoCj"/"objDeclarado"/
// "declAd" de fato contém um mercado, e não um balde disfarçado atrás do
// nome certo. Uma trava com a fronteira escrita é útil; uma que parece total
// e não é, engana — daí este comentário existir.

// Extrai TODAS as chamadas de `nomeFuncao(...)` no corpo, respeitando
// parênteses ANINHADOS (ex.: `metaDoBalde(_gtReguaAtiva(), baldeCamp)`).
//
// I1(a) (rodada de correção 2, 25/09/2026): a versão anterior usava um regex
// raso, `\bnome\s*\(([^()]*)\)`, que simplesmente NÃO CASA quando há um
// parêntese dentro dos argumentos — a chamada inteira sumia da extração: 0
// chamadas, 0 violações, em silêncio. Provado contra o código real desta
// tela: `metaDoBalde(_gtReguaAtiva(), baldeCamp)` e
// `alvoDoBalde(_gtBalde(ins.objective))` davam as duas 0 chamadas extraídas
// com o regex antigo. Quem escreveu a versão antiga percebeu o buraco e, em
// vez de consertar a EXTRAÇÃO, mudou o CÓDIGO DE PRODUÇÃO para nunca passar
// uma chamada aninhada a estas duas funções — o que inverte a relação: o
// teste parou de medir o código e passou a moldá-lo. Esta versão faz o
// caminho certo: conta parênteses caractere por caractere, então uma chamada
// aninhada não escapa mais da extração (nem por isso a trava fica dispensada
// de continuar existindo — ver a prova por mutação "(nested)" abaixo).
//
// Devolve `{ chamadas, totalOcorrencias }`. `totalOcorrencias` conta toda
// abertura `nomeFuncao(` no arquivo, por um caminho independente de onde o
// parêntese fecha; `chamadas.length` só cresce quando o parêntese da chamada
// FECHA dentro do arquivo (profundidade volta a 0). Código válido sempre
// fecha — se as duas contagens divergirem é a própria extração perdendo
// chamada, e os testes abaixo comparam as duas e FALHAM dizendo quantas
// foram perdidas, em vez de passar limpo como o regex antigo passava.
function extrairArgumentos(corpo, nomeFuncao) {
  const reOcorrencia = new RegExp(`\\b${nomeFuncao}\\s*\\(`, 'g');
  const ocorrencias = [...corpo.matchAll(reOcorrencia)];
  const chamadas = [];
  for (const m of ocorrencias) {
    let profundidade = 1; // o '(' da própria ocorrência já abriu um nível
    let i = m.index + m[0].length;
    while (i < corpo.length && profundidade > 0) {
      if (corpo[i] === '(') profundidade++;
      else if (corpo[i] === ')') profundidade--;
      i++;
    }
    if (profundidade !== 0) continue; // não fechou dentro do arquivo — não conta como extraída
    const args = corpo.slice(m.index + m[0].length, i - 1);
    chamadas.push(dividirArgumentosDoTopo(args));
  }
  return { chamadas, totalOcorrencias: ocorrencias.length };
}

// Divide a lista de argumentos por vírgula só no nível 0 de parênteses — uma
// vírgula dentro de um argumento aninhado, como em `_gtBalde(a, b)`, não pode
// quebrar a lista de fora em 3 pedaços em vez de 1.
function dividirArgumentosDoTopo(args) {
  if (args.trim() === '') return [];
  const partes = [];
  let atual = '';
  let profundidade = 0;
  for (const ch of args) {
    if (ch === '(') profundidade++;
    else if (ch === ')') profundidade--;
    if (ch === ',' && profundidade === 0) {
      partes.push(atual.trim());
      atual = '';
    } else {
      atual += ch;
    }
  }
  partes.push(atual.trim());
  return partes;
}

test('alvoDoBalde só recebe MERCADO — nenhum balde antigo indexa ALVOS', () => {
  const { chamadas, totalOcorrencias } = extrairArgumentos(CORPO, 'alvoDoBalde');
  assert.ok(chamadas.length > 0, 'a tela não chama mais alvoDoBalde — atualize/remova este teste');
  assert.equal(chamadas.length, totalOcorrencias,
    `a extração perdeu ${totalOcorrencias - chamadas.length} chamada(s) de alvoDoBalde (parêntese não fechou dentro do arquivo?) — não dá para confiar na lista de violações abaixo`);
  const violacoes = chamadas.map((args) => args[0]).filter((a) => !PERMITIDOS_ALVO_DO_BALDE.has(a));
  assert.deepEqual(violacoes, [],
    `alvoDoBalde recebeu argumento fora da lista branca de mercado: ${violacoes.join(', ')}`);
  // Nenhum balde antigo pode aparecer, nem como literal esvaziado (string vazia).
  for (const balde of BALDES_ANTIGOS) assert.ok(!CORPO.includes(`alvoDoBalde('${balde}')`) && !CORPO.includes(`alvoDoBalde("${balde}")`));
});

test('metaDoBalde só recebe MERCADO ou interação declarada — nunca balde antigo', () => {
  const { chamadas, totalOcorrencias } = extrairArgumentos(CORPO, 'metaDoBalde');
  assert.ok(chamadas.length > 0, 'a tela não chama mais metaDoBalde — atualize/remova este teste');
  assert.equal(chamadas.length, totalOcorrencias,
    `a extração perdeu ${totalOcorrencias - chamadas.length} chamada(s) de metaDoBalde (parêntese não fechou dentro do arquivo?) — não dá para confiar na lista de violações abaixo`);
  const violacoes = chamadas.map((args) => args[1]).filter((a) => !PERMITIDOS_META_DO_BALDE.has(a));
  assert.deepEqual(violacoes, [],
    `metaDoBalde recebeu 2º argumento fora da lista branca: ${violacoes.join(', ')}`);
});

test('prova por mutação: um balde antigo, mesmo como literal escondido num comentário de propósito, é pego pela extração', () => {
  // Reproduz o defeito ORIGINAL desta tarefa (.vue:2473 antes da correção):
  // `metaDoBalde(reguaAtiva, temMensagem ? 'mensagens' : baldeCamp)`.
  const trechoOriginal = "metaDoBalde(reguaAtiva, temMensagem ? 'mensagens' : baldeCamp);";
  const corpoMutado = semComentarios(trechoOriginal);
  const { chamadas } = extrairArgumentos(corpoMutado, 'metaDoBalde');
  assert.equal(chamadas.length, 1);
  assert.ok(!PERMITIDOS_META_DO_BALDE.has(chamadas[0][1]),
    `a extração deveria ter rejeitado "${chamadas[0][1]}" (o defeito original) — a trava não pegaria mais`);
});

test('prova por mutação (nested): parêntese aninhado no argumento não escapa mais da extração — I1(a)', () => {
  // Reproduz o buraco (a) do I1: com o regex antigo (`[^()]*`), isto dava 0
  // chamadas extraídas e 0 violações — em silêncio. `baldeCamp` aqui é o
  // 2º argumento de verdade (depois de `_gtReguaAtiva()`), e não está na
  // lista branca.
  const trecho = 'metaDoBalde(_gtReguaAtiva(), baldeCamp);';
  const corpoMutado = semComentarios(trecho);
  const { chamadas, totalOcorrencias } = extrairArgumentos(corpoMutado, 'metaDoBalde');
  assert.equal(totalOcorrencias, 1, 'deveria ter visto 1 ocorrência de "metaDoBalde("');
  assert.equal(chamadas.length, 1, 'a extração perdeu a chamada com parêntese aninhado — o buraco (a) do I1 voltou');
  assert.equal(chamadas[0][1], 'baldeCamp', `argumento extraído errado: ${JSON.stringify(chamadas[0])}`);
  assert.ok(!PERMITIDOS_META_DO_BALDE.has(chamadas[0][1]),
    `a extração deveria ter rejeitado "${chamadas[0][1]}" (balde antigo por trás de uma chamada aninhada) — a trava não pegaria mais`);
});

test('todo balde antigo (índice de ALVOS) segue banido, nome por nome, para quem ler só este teste', () => {
  // Documentação executável — DE VERDADE (I2, rodada de correção 2,
  // 25/09/2026): lê os MESMOS Sets (`PERMITIDOS_ALVO_DO_BALDE`,
  // `PERMITIDOS_META_DO_BALDE`) que os dois testes de cima usam para validar
  // a tela, em vez de uma cópia local.
  //
  // O DEFEITO QUE ISTO CORRIGE: a versão anterior redeclarava seu próprio
  // `permitidos` AQUI DENTRO, um terceiro Set igual (de olho) aos dois de
  // cima, mas sem nenhum vínculo com eles. O comentário prometia que o teste
  // "falha se algum dia um destes nomes voltar a ser aceito pela lista branca
  // acima" — falso: editar o Set real (o de cima) não move a cópia local
  // nenhuma linha; o teste continuaria verde mesmo com a trava de verdade
  // desarmada. Esse é o SEXTO teste desta série com essa mesma forma: a
  // asserção descreve a intenção, mas os dados do teste não vêm do mesmo
  // lugar que o código real usa.
  //
  // PROVA POR MUTAÇÃO feita manualmente para esta correção (não fica no
  // código — mutação de verdade se desfaz): acrescentei 'engajamento' a
  // `PERMITIDOS_META_DO_BALDE` (a lista real, no topo deste arquivo), rodei
  // `npm test`, e ESTE teste falhou junto com o de "metaDoBalde só recebe
  // MERCADO..." — apontando exatamente "engajamento" como o nome que não
  // podia estar ali. Removida a mutação, os dois voltaram a passar. Resultado
  // e mensagem de erro exatos: ver o relatório desta tarefa.
  for (const balde of BALDES_ANTIGOS) {
    assert.ok(!PERMITIDOS_META_DO_BALDE.has(balde), `"${balde}" não pode nunca entrar na lista branca de metaDoBalde`);
    assert.ok(!PERMITIDOS_ALVO_DO_BALDE.has(balde), `"${balde}" não pode nunca entrar na lista branca de alvoDoBalde`);
  }
});
