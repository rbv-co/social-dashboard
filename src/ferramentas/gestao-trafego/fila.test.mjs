import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montarFila, distribuirEntreConjuntos, pedeAcao, DIAS_DE_SILENCIO } from './fila.js';

// Relógio fixo: o silêncio de 7 dias não se testa esperando 7 dias.
const AGORA = '2026-07-29T12:00:00Z';
const dias = (n) => new Date(Date.parse(AGORA) + n * 86400000).toISOString();

const analise = (extra) => ({
  campaign_id: 'c1', veredito: 'escalar', gerado_em: dias(-1),
  budget_atual_centavos: 23000, budget_sugerido_centavos: 28000, ...extra,
});

// ── o que entra na fila ─────────────────────────────────────────────────────

test('"manter" nao entra: nao ha nada pra aprovar num conselho de nao mexer', () => {
  // Das 38 analises guardadas em 29/07, 12 eram 'manter'.
  assert.equal(pedeAcao({ veredito: 'escalar' }), true);
  assert.equal(pedeAcao({ veredito: 'reduzir' }), true);
  assert.equal(pedeAcao({ veredito: 'pausar' }), true);
  assert.equal(pedeAcao({ veredito: 'manter' }), false);
  const f = montarFila([analise({ veredito: 'manter' })], [], AGORA);
  assert.equal(f.pendentes.length, 0);
});

test('analise sem decisao nenhuma fica pendente', () => {
  const f = montarFila([analise()], [], AGORA);
  assert.equal(f.pendentes.length, 1);
});

test('a fila vem com o MAIOR gasto primeiro', () => {
  const f = montarFila([
    analise({ campaign_id: 'pequena', budget_atual_centavos: 3500 }),
    analise({ campaign_id: 'grande', budget_atual_centavos: 23000 }),
    analise({ campaign_id: 'media', budget_atual_centavos: 9000 }),
  ], [], AGORA);
  assert.deepEqual(f.pendentes.map((i) => i.campaign_id), ['grande', 'media', 'pequena']);
});

// ── decisao ja tomada ───────────────────────────────────────────────────────

test('aprovada some da fila', () => {
  const f = montarFila([analise()], [{ campaign_id: 'c1', decisao: 'aprovada', decidido_em: dias(0) }], AGORA);
  assert.equal(f.pendentes.length, 0);
  assert.equal(f.respondidas.length, 1);
});

test('analise NOVA depois da decisao volta a perguntar — e outro contexto', () => {
  // O robo roda todo dia. Se a situacao mudou e ele sugeriu de novo, a pergunta
  // vale outra vez; senao aprovar uma vez calaria a campanha pra sempre.
  const f = montarFila(
    [analise({ gerado_em: dias(0) })],
    [{ campaign_id: 'c1', decisao: 'aprovada', decidido_em: dias(-2) }],
    AGORA,
  );
  assert.equal(f.pendentes.length, 1, 'a analise e mais nova que a decisao');
});

// ── o silencio de 7 dias ────────────────────────────────────────────────────

test('recusada cala a campanha mesmo com analise NOVA', () => {
  // Este e o ponto do silencio: o robo regrava todo dia, entao sem valer sobre
  // analise nova a recusa duraria algumas horas.
  const f = montarFila(
    [analise({ gerado_em: dias(0) })],
    [{ campaign_id: 'c1', decisao: 'recusada', decidido_em: dias(-1), silenciar_ate: dias(6) }],
    AGORA,
  );
  assert.equal(f.pendentes.length, 0);
  assert.equal(f.silenciadas.length, 1);
});

test('passados os 7 dias a sugestao VOLTA', () => {
  const f = montarFila(
    [analise({ gerado_em: dias(0) })],
    [{ campaign_id: 'c1', decisao: 'recusada', decidido_em: dias(-8), silenciar_ate: dias(-1) }],
    AGORA,
  );
  assert.equal(f.pendentes.length, 1);
});

test('recusa sem silenciar_ate gravado cai nos 7 dias por padrao', () => {
  const dentro = montarFila([analise()], [{ campaign_id: 'c1', decisao: 'recusada', decidido_em: dias(-3) }], AGORA);
  assert.equal(dentro.silenciadas.length, 1, `${DIAS_DE_SILENCIO} dias ainda nao passaram`);
  const fora = montarFila([analise()], [{ campaign_id: 'c1', decisao: 'recusada', decidido_em: dias(-8) }], AGORA);
  assert.equal(fora.pendentes.length, 1);
});

// ── vencidas ────────────────────────────────────────────────────────────────

test('vencida sai da lista principal mas NAO some', () => {
  // Campanha que o robo parou de reanalisar e justamente o que ninguem percebe
  // faltando — em 29/07 havia tres, de 23 a 26 dias.
  const f = montarFila([analise({ valida_ate: dias(-2) })], [], AGORA);
  assert.equal(f.pendentes.length, 0);
  assert.equal(f.vencidas.length, 1, 'fica contavel pra tela avisar');
});

test('sem valida_ate a analise nao vence', () => {
  const f = montarFila([analise({ valida_ate: null })], [], AGORA);
  assert.equal(f.pendentes.length, 1);
});

test('vale a decisao MAIS RECENTE quando ha varias na mesma campanha', () => {
  const f = montarFila([analise({ gerado_em: dias(-1) })], [
    { campaign_id: 'c1', decisao: 'recusada', decidido_em: dias(-20), silenciar_ate: dias(-13) },
    { campaign_id: 'c1', decisao: 'aprovada', decidido_em: dias(0) },
  ], AGORA);
  assert.equal(f.respondidas.length, 1, 'a recusa velha nao pode mandar');
  assert.equal(f.pendentes.length, 0);
});

// ── distribuicao proporcional (ABO) ─────────────────────────────────────────

test('reparte mantendo a proporcao entre os conjuntos', () => {
  // "[ENGAJAMENTO] FEED | P1" real: R$ 90 em 3 conjuntos iguais -> R$ 117.
  const r = distribuirEntreConjuntos(
    [{ id: 'a', deCentavos: 3000 }, { id: 'b', deCentavos: 3000 }, { id: 'c', deCentavos: 3000 }],
    11700,
  );
  assert.deepEqual(r.map((x) => x.paraCentavos), [3900, 3900, 3900]);
});

test('quem tinha o dobro continua com o dobro', () => {
  const r = distribuirEntreConjuntos([{ id: 'a', deCentavos: 2000 }, { id: 'b', deCentavos: 4000 }], 12000);
  assert.deepEqual(r.map((x) => x.paraCentavos), [4000, 8000]);
});

test('a soma das partes bate EXATAMENTE com o total aprovado', () => {
  // "MODA & BOLSAS" real: R$ 230 -> R$ 280 em 4 conjuntos desiguais. Arredondar
  // cada parte por conta propria nao fecha, e aprovar R$ 280 aplicando R$ 279,98
  // e uma promessa quebrada em silencio.
  const conj = [
    { id: 'a', deCentavos: 5000 }, { id: 'b', deCentavos: 6000 },
    { id: 'c', deCentavos: 6000 }, { id: 'd', deCentavos: 6000 },
  ];
  const r = distribuirEntreConjuntos(conj, 28000);
  assert.equal(r.reduce((t, x) => t + x.paraCentavos, 0), 28000);
  assert.ok(r.every((x) => Number.isInteger(x.paraCentavos)), 'centavos sao inteiros');
});

test('a sobra do arredondamento vai pros maiores restos, e o resultado e estavel', () => {
  const conj = [{ id: 'a', deCentavos: 1000 }, { id: 'b', deCentavos: 1000 }, { id: 'c', deCentavos: 1000 }];
  const um = distribuirEntreConjuntos(conj, 10000);
  const dois = distribuirEntreConjuntos(conj, 10000);
  assert.equal(um.reduce((t, x) => t + x.paraCentavos, 0), 10000);
  assert.deepEqual(um, dois, 'mesma entrada, mesma saida');
});

test('conjunto SEM orcamento nao recebe nada', () => {
  const r = distribuirEntreConjuntos([{ id: 'a', deCentavos: 3000 }, { id: 'b', deCentavos: 0 }], 6000);
  assert.equal(r.length, 1);
  assert.equal(r[0].id, 'a');
  assert.equal(r[0].paraCentavos, 6000);
});

test('entrada vazia ou invalida devolve [] em vez de inventar', () => {
  assert.deepEqual(distribuirEntreConjuntos([], 10000), []);
  assert.deepEqual(distribuirEntreConjuntos(null, 10000), []);
  assert.deepEqual(distribuirEntreConjuntos([{ id: 'a', deCentavos: 3000 }], 0), []);
  assert.deepEqual(distribuirEntreConjuntos([{ id: 'a', deCentavos: 3000 }], null), []);
});

test('o conjunto original e preservado no resultado (a tela precisa do nome)', () => {
  const r = distribuirEntreConjuntos([{ id: 'a', nome: 'DIA DA BELEZA', deCentavos: 5000 }], 6000);
  assert.equal(r[0].nome, 'DIA DA BELEZA');
  assert.equal(r[0].deCentavos, 5000, 'o "de" continua disponivel pro antes -> depois');
});

test('nada quebra com lista de analises nula', () => {
  const f = montarFila(null, null, AGORA);
  assert.deepEqual(f.pendentes, []);
});

// ── saude linkada as analises (2026-07-29) ─────────────────────────────────

import { mesclarSaude } from './fila.js';

const saudeAlerta = { nivel: 'alerta', veredito: 'reduzir', porque: 'Frequência 4,2× — o mesmo público já viu demais.' };
const saudeAtencao = { nivel: 'atencao', veredito: 'monitorar', porque: 'CTR 0,30% baixo para engajamento.' };

test('a saude GRUDA no item que o robo ja trouxe', () => {
  const f = montarFila([analise()], [], AGORA);
  const r = mesclarSaude(f, [{ campaign_id: 'c1', saude: saudeAtencao }]);
  assert.equal(r.pendentes[0].saude.nivel, 'atencao');
  assert.equal(r.pendentes.length, 1, 'nao duplica o item');
});

test('alerta em campanha que o robo NAO trouxe vira item proprio', () => {
  // O caso real: robo disse 'manter' (nao entra na fila) numa campanha com
  // frequencia 4,2x. Sem isto o alerta ficava invisivel.
  const f = montarFila([], [], AGORA);
  const r = mesclarSaude(f, [{
    campaign_id: 'so-saude', campaign_name: '[Leads] Para WhatsApp', conta_nome: 'Motoeasy',
    saude: saudeAlerta, budget_atual_centavos: 11532,
  }]);
  assert.equal(r.pendentes.length, 1);
  assert.equal(r.pendentes[0].veredito, 'reduzir');
  assert.equal(r.pendentes[0].origem, 'saude');
  assert.equal(r.pendentes[0].budget_sugerido_centavos, null, 'ninguem calculou um numero — nao se inventa');
});

test('"atencao" sozinha NAO cria item: e observacao, nao pendencia', () => {
  const f = montarFila([], [], AGORA);
  const r = mesclarSaude(f, [{ campaign_id: 'x', saude: saudeAtencao }]);
  assert.equal(r.pendentes.length, 0);
});

test('alerta em campanha SILENCIADA nao ressuscita pela saude', () => {
  // Senao a recusa de 7 dias seria contornada por um caminho lateral.
  const f = montarFila([analise()], [{ campaign_id: 'c1', decisao: 'recusada', decidido_em: dias(-1), silenciar_ate: dias(6) }], AGORA);
  const r = mesclarSaude(f, [{ campaign_id: 'c1', saude: saudeAlerta }]);
  assert.equal(r.pendentes.length, 0);
});

test('alerta em campanha ja RESPONDIDA tambem nao volta', () => {
  const f = montarFila([analise()], [{ campaign_id: 'c1', decisao: 'aprovada', decidido_em: dias(0) }], AGORA);
  const r = mesclarSaude(f, [{ campaign_id: 'c1', saude: saudeAlerta }]);
  assert.equal(r.pendentes.length, 0);
});

// --- DISPENSAR O ALERTA DE SAUDE (item 2 da lista do dono, medido em 12/08/2026) ---
// O alerta que vira item PROPRIO (campanha sem sugestao de verba) nao passava por
// nenhuma checagem de decisao: `mesclarSaude` roda depois de `montarFila` e so
// pulava campanha que ja estivesse na fila. Clicar em "Recusar" nao fazia nada.
const soSaude = (extra) => ({
  campaign_id: 'so-saude', campaign_name: '[Leads] Para WhatsApp', conta_nome: 'Motoeasy',
  saude: saudeAlerta, budget_atual_centavos: 11532, medido_em: dias(0), ...extra,
});

test('alerta de saude DISPENSADO nao volta enquanto o silencio durar', () => {
  const f = montarFila([], [], AGORA);
  const r = mesclarSaude(f, [soSaude()], [
    { campaign_id: 'so-saude', escopo: 'saude', decisao: 'recusada', decidido_em: dias(-1), silenciar_ate: dias(6) },
  ], AGORA);
  assert.equal(r.pendentes.length, 0, 'dispensar tem que dispensar de verdade');
});

test('passado o silencio, o alerta so volta se a medicao for MAIS NOVA que a decisao', () => {
  const f = () => montarFila([], [], AGORA);
  const decisaoVelha = [{ campaign_id: 'so-saude', escopo: 'saude', decisao: 'recusada', decidido_em: dias(-10), silenciar_ate: dias(-3) }];
  // medicao de hoje, decisao de 10 dias atras e silencio ja vencido -> volta
  assert.equal(mesclarSaude(f(), [soSaude({ medido_em: dias(0) })], decisaoVelha, AGORA).pendentes.length, 1);
  // medicao ANTERIOR a decisao -> e a mesma situacao ja respondida, nao volta
  assert.equal(mesclarSaude(f(), [soSaude({ medido_em: dias(-20) })], decisaoVelha, AGORA).pendentes.length, 0);
});

test('decisao de OUTRO escopo nao dispensa o alerta de saude', () => {
  // O espelho do defeito: pausar criativos (ou aprovar verba) nao responde
  // "esta campanha esta queimando a audiencia".
  const f = montarFila([], [], AGORA);
  const r = mesclarSaude(f, [soSaude()], [
    { campaign_id: 'so-saude', escopo: 'criativos', decisao: 'aprovada', decidido_em: dias(0), silenciar_ate: dias(7) },
  ], AGORA);
  assert.equal(r.pendentes.length, 1);
});

test('sem decisoes de saude o comportamento e o de antes (retrocompat)', () => {
  const f = montarFila([], [], AGORA);
  assert.equal(mesclarSaude(f, [soSaude()], undefined, AGORA).pendentes.length, 1);
  assert.equal(mesclarSaude(f, [soSaude()], [], AGORA).pendentes.length, 1);
});

// E O OUTRO LADO: a dispensa da saude NAO pode calar a sugestao de orcamento.
test('dispensar a saude NAO cala a sugestao de orcamento da mesma campanha', () => {
  const dispensaSaude = [{ campaign_id: 'c1', escopo: 'saude', decisao: 'recusada', decidido_em: dias(0), silenciar_ate: dias(7) }];
  const f = montarFila([analise()], dispensaSaude, AGORA);
  assert.equal(f.pendentes.length, 1, 'a pergunta de verba continua de pe');
  assert.equal(f.silenciadas.length, 0);
});

test('itens de saude entram na mesma ordem por gasto', () => {
  const f = montarFila([analise({ campaign_id: 'media', budget_atual_centavos: 9000 })], [], AGORA);
  const r = mesclarSaude(f, [
    { campaign_id: 'grande', saude: saudeAlerta, budget_atual_centavos: 30000 },
    { campaign_id: 'pequena', saude: saudeAlerta, budget_atual_centavos: 1000 },
  ]);
  assert.deepEqual(r.pendentes.map((i) => i.campaign_id), ['grande', 'media', 'pequena']);
});

test('sem saude nenhuma a fila passa intacta', () => {
  const f = montarFila([analise()], [], AGORA);
  assert.deepEqual(mesclarSaude(f, []).pendentes.length, 1);
  assert.deepEqual(mesclarSaude(f, null).pendentes.length, 1);
});

// ── criativos sem tracao, agrupados na campanha (2026-07-29) ───────────────

import { anexarCriativos } from './fila.js';

const criativo = (extra) => ({
  campaign_id: 'c1', ad_id: 'a1', nome: 'Criativo A', ctr: 0.12, gasto: 89,
  porque: 'CTR crítico', analisado_em: dias(-1), ...extra,
});

test('os criativos GRUDAM na linha da campanha, nao viram linhas soltas', () => {
  // 16 anuncios da mesma campanha nao sao 16 decisoes — sao uma: "esta campanha
  // precisa de criativo novo".
  const f = montarFila([analise()], [], AGORA);
  const r = anexarCriativos(f, [criativo(), criativo({ ad_id: 'a2' }), criativo({ ad_id: 'a3' })], []);
  assert.equal(r.pendentes.length, 1, 'continua uma linha');
  assert.equal(r.pendentes[0].criativos.length, 3);
});

test('campanha SO com criativo fraco vira item proprio', () => {
  // Senao a recomendacao sumiria — que e o erro que se esta corrigindo ao tirar
  // o selo do cartao.
  const f = montarFila([], [], AGORA);
  const r = anexarCriativos(f, [criativo({ campaign_id: 'so-criativo', campaign_name: 'Dom Pedro' })], []);
  assert.equal(r.pendentes.length, 1);
  assert.equal(r.pendentes[0].veredito, 'criativos');
  assert.equal(r.pendentes[0].budget_sugerido_centavos, null, 'nao e sobre verba');
});

test('decidir sobre CRIATIVOS nao responde a pergunta de ORCAMENTO', () => {
  // A mesma campanha tem duas perguntas independentes. Sem separar por escopo,
  // pausar os criativos calaria a sugestao de verba que ainda espera resposta.
  const f = montarFila([analise()], [{ campaign_id: 'c1', decisao: 'aprovada', decidido_em: dias(0), escopo: 'criativos' }], AGORA);
  assert.equal(f.pendentes.length, 1, 'a sugestao de orcamento continua de pe');
});

test('e o contrario tambem: decidir orcamento nao cala os criativos', () => {
  const f = montarFila([analise()], [{ campaign_id: 'c1', decisao: 'aprovada', decidido_em: dias(0), escopo: 'orcamento' }], AGORA);
  assert.equal(f.pendentes.length, 0, 'o orcamento foi respondido');
  const r = anexarCriativos(f, [criativo()], [{ campaign_id: 'c1', decisao: 'aprovada', decidido_em: dias(0), escopo: 'orcamento' }]);
  assert.equal(r.pendentes.length, 1, 'mas os criativos ainda perguntam');
  assert.equal(r.pendentes[0].origem, 'criativos');
});

test('criativos ja respondidos somem ate o robo reanalisar', () => {
  const f = montarFila([], [], AGORA);
  const decisao = [{ campaign_id: 'c1', decisao: 'aprovada', decidido_em: dias(0), escopo: 'criativos' }];
  assert.equal(anexarCriativos(f, [criativo({ analisado_em: dias(-1) })], decisao).pendentes.length, 0);
  // analise NOVA (criativo novo ou reavaliacao) volta a perguntar
  assert.equal(anexarCriativos(f, [criativo({ analisado_em: dias(1) })], decisao).pendentes.length, 1);
});

test('sem criativo nenhum a fila passa intacta', () => {
  const f = montarFila([analise()], [], AGORA);
  assert.equal(anexarCriativos(f, [], []).pendentes.length, 1);
  assert.equal(anexarCriativos(f, null, null).pendentes[0].criativos, undefined);
});

// ── a fila vazia se explica (item 1 da lista do dono, 12/08/2026) ────────────
// "Sugestoes na Mantova inexistente na fila da IA". Medido no banco: a Mantova
// TEM analise -- na ultima rodada o robo olhou 2 campanhas ativas e disse
// 'manter' nas duas. 'manter' nao entra na fila, entao ela ficava vazia, e vazia
// e indistinguivel de quebrada.
import { resumoDoRobo, fraseDaFilaVazia } from './fila.js';

const MANTOVA = 'de592c37-9a0e-40a3-98c3-2b44a5db57ac';
// as duas linhas ATIVAS reais da Mantova em 12/08/2026
const analisesMantova = [
  { campaign_id: '120249070538900381', account_id: MANTOVA, veredito: 'manter', gerado_em: '2026-08-12T11:54:19Z' },
  { campaign_id: '120249145035940381', account_id: MANTOVA, veredito: 'manter', gerado_em: '2026-08-12T11:53:55Z' },
  { campaign_id: 'de-outra-conta', account_id: 'outra', veredito: 'escalar', gerado_em: '2026-08-12T11:00:00Z' },
];

test('resumoDoRobo conta so a conta pedida, e conta o "manter" que a fila descarta', () => {
  const r = resumoDoRobo(analisesMantova, MANTOVA);
  assert.equal(r.analisadas, 2);
  assert.equal(r.manter, 2);
  assert.equal(r.ultima, '2026-08-12T11:54:19.000Z', 'a mais recente das duas');
});

test('a frase da Mantova diz o que o robo fez, em vez de deixar a tela muda', () => {
  const f = fraseDaFilaVazia(resumoDoRobo(analisesMantova, MANTOVA));
  assert.match(f, /2 campanhas/);
  assert.match(f, /manter como est/);
});

test('uma campanha so nao vira "1 campanhas"', () => {
  const f = fraseDaFilaVazia({ analisadas: 1, manter: 1 });
  assert.match(f, /1 campanha e a recomenda/);
});

test('conta que o robo NUNCA analisou nao ganha frase inventada', () => {
  assert.equal(fraseDaFilaVazia(resumoDoRobo(analisesMantova, 'conta-sem-analise')), '');
  assert.equal(fraseDaFilaVazia(null), '');
  assert.equal(fraseDaFilaVazia({ analisadas: 0, manter: 0 }), '');
});

test('analisou e propos algo, mas nada chegou: a tela NAO chuta o motivo', () => {
  const f = fraseDaFilaVazia({ analisadas: 3, manter: 1 });
  assert.match(f, /3 campanhas/);
  assert.doesNotMatch(f, /manter como est/, 'nem todas foram manter — nao pode dizer que foram');
});

test('sem conta pedida, conta tudo (a fila sem filtro)', () => {
  assert.equal(resumoDoRobo(analisesMantova, null).analisadas, 3);
});
