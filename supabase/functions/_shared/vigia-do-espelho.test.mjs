import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  etapaFalhou, linhasDoVigia, ETAPA_PLANILHA, ETAPA_BLING, ROBO, DIAS_DE_HISTORICO,
  ROBO_ETAPAS_LIKE,
} from './vigia-do-espelho.js';

/* ⚠️ ESTE TESTE GUARDA UM TERMÔMETRO, e termômetro que mente é pior que
 * termômetro nenhum: o painel diria "em dia" para sempre e ninguém olharia mais.
 *
 * As frases abaixo são as que a rodada REALMENTE devolve — foram copiadas das
 * respostas gravadas em `net._http_response` em 21/09/2026, não inventadas. Se
 * alguém mudar o texto de uma etapa no robô sem mexer aqui, é este teste que
 * tem de morrer. */

const AGORA = '2026-09-21T20:30:00.000Z';

// Frases de SUCESSO, medidas no ar
const SUCESSOS = [
  'em dia (Lista de espera: 150, Vendas: 464, Garantias: 1, Atribuição: 0, Origens: 0,'
  + ' Pessoas: 0, Atendimentos: 0, Convites abertos: 1, Stylists: 0, Private Edits: 0,'
  + ' Beauty Sessions: 3)',
  'regravada, 42.8 KB (Lista de espera: 150, Vendas: 464, Garantias: 1)',
  'em dia',
  'nenhum pendente',
  '3 de 5 cadastrado(s)',
  '2 completado(s), 1 já em dia, ',
];

// Frases de FALHA, medidas no ar
const FALHAS = [
  'falhou: Não consegui entrar no Zoho para atualizar a planilha. Abra Acessos → Zoho'
  + ' e clique em conectar; a próxima rodada tenta de novo sozinha.',
  'falhou: O Zoho recusou a planilha (código 500).',
  'bloqueado: falta a permissão de contatos no Bling (4 esperando)',
];

test('as frases de sucesso medidas no ar contam como sucesso', () => {
  for (const s of SUCESSOS) assert.equal(etapaFalhou(s), false, `deu falha em: ${s}`);
});

test('as frases de falha medidas no ar contam como falha', () => {
  for (const s of FALHAS) assert.equal(etapaFalhou(s), true, `deu sucesso em: ${s}`);
});

test('⚠️ "bloqueado" é FALHA — alarme não se desliga porque a causa é conhecida', () => {
  // Estado real: o app do Bling perdeu a permissão de contatos. Ninguém está
  // sendo cadastrado. Tratar como "em dia" porque sabemos o motivo é o mesmo
  // que desligar o alarme porque o incêndio tem explicação.
  assert.equal(etapaFalhou('bloqueado: falta a permissão de contatos no Bling (4 esperando)'), true);
});

test('vazio não vira sucesso silencioso na planilha', () => {
  // Se a rodada não disse nada da planilha, a linha ainda vai — com o aviso
  // dentro dela, em vez de uma célula em branco que passa batida.
  const [planilha] = linhasDoVigia({}, AGORA);
  assert.match(planilha.resposta, /não disse nada/);
});

test('a etapa da planilha acusa sozinha, sem derrubar a do Bling', () => {
  const [planilha, bling] = linhasDoVigia({
    planilha: FALHAS[0], bling: 'em dia', cadastros: 'nenhum pendente',
  }, AGORA);
  assert.equal(planilha.robo, ETAPA_PLANILHA);
  assert.equal(planilha.ok, false);
  assert.equal(bling.robo, ETAPA_BLING);
  assert.equal(bling.ok, true, 'o Bling funcionou e não pode ser marcado como falha');
});

test('a etapa do Bling acusa sozinha, sem derrubar a da planilha', () => {
  const [planilha, bling] = linhasDoVigia({
    planilha: SUCESSOS[0], bling: FALHAS[2], cadastros: 'nenhum pendente',
  }, AGORA);
  assert.equal(planilha.ok, true);
  assert.equal(bling.ok, false);
});

test('falha ao completar a ficha também derruba a etapa do Bling', () => {
  // As duas falam com a mesma API e o mesmo token: quando uma cai, a outra cai
  // junto. Por isso não existe uma terceira variante para as fichas.
  const [, bling] = linhasDoVigia({
    planilha: SUCESSOS[0], bling: 'em dia', cadastros: 'falhou: o Bling devolveu 500',
  }, AGORA);
  assert.equal(bling.ok, false);
  assert.match(bling.resposta, /completar a ficha: falhou/);
});

test('a resposta do Bling carrega as DUAS frases, para não ter de adivinhar qual caiu', () => {
  const [, bling] = linhasDoVigia({
    bling: '3 de 5 cadastrado(s)', cadastros: '2 completado(s), 1 já em dia, ',
  }, AGORA);
  assert.match(bling.resposta, /cadastrar: 3 de 5/);
  assert.match(bling.resposta, /completar a ficha: 2 completado/);
});

test('⚠️ `conferido_em` vai preenchido — senão o termômetro vira o alarme', () => {
  // `conferir_robos()` varre linha com `conferido_em is null` procurando a
  // resposta pelo `request_id`. Estas linhas não têm pedido nenhum: depois de 6
  // horas seriam fechadas com `ok` NULO, e a view lê nulo como "nunca deu
  // certo". O robô apareceria quebrado justamente por ter se reportado.
  for (const l of linhasDoVigia({ planilha: 'em dia', bling: 'em dia' }, AGORA)) {
    assert.equal(l.conferido_em, AGORA, `${l.robo} ficaria na fila de conferência`);
  }
});

test('os nomes das etapas COMEÇAM com o nome do robô — é assim que a view as junta', () => {
  // `robos_saude` faz `e.robo like x.robo || '%'`. Nome que não começa com
  // `vessel-espelhar-lista` não seria juntado, e a etapa nunca apareceria no
  // painel — sem erro nenhum, só silêncio.
  for (const nome of [ETAPA_PLANILHA, ETAPA_BLING]) {
    assert.ok(nome.startsWith(ROBO), `"${nome}" não seria encontrado pelo vigia`);
  }
  assert.notEqual(ETAPA_PLANILHA, ETAPA_BLING);
});

test('a resposta nunca passa de 500 letras — é o tamanho da coluna', () => {
  const enorme = 'x'.repeat(2000);
  for (const l of linhasDoVigia({ planilha: enorme, bling: enorme, cadastros: enorme }, AGORA)) {
    assert.ok(l.resposta.length <= 500, `${l.robo} passou de 500`);
  }
});

test('o histórico por etapa é curto de propósito, e maior que as 72h da view', () => {
  assert.ok(DIAS_DE_HISTORICO * 24 > 72, 'a view aposenta variante sem sinal em 72h');
  assert.ok(DIAS_DE_HISTORICO < 60, 'guardar 60 dias por etapa custaria ~25 MB no plano free');
});

// O `like` do Postgres, em JavaScript, para provar o filtro da faxina sem banco.
const casaComLike = (texto, padrao) => new RegExp(
  '^' + padrao.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$').test(texto);

test('⚠️ a faxina pega as ETAPAS e NUNCA a linha da rodada', () => {
  // A linha da rodada é de `disparar_robo`, vale 60 dias para todos os robôs, e
  // é a única prova de que este robô está sendo chamado. Se a faxina a apagasse,
  // o painel diria "sem registro ainda" de um robô que roda de 3 em 3 minutos.
  assert.ok(casaComLike(ETAPA_PLANILHA, ROBO_ETAPAS_LIKE));
  assert.ok(casaComLike(ETAPA_BLING, ROBO_ETAPAS_LIKE));
  assert.equal(casaComLike(ROBO, ROBO_ETAPAS_LIKE), false,
    'a faxina apagaria a linha da rodada');
});

test('a faxina não alcança robô de outro nome', () => {
  for (const outro of ['coletar-dados', 'conteudo-espelho', 'vessel-fotos-trigger',
    'vessel-lembretes', 'vessel-conta']) {
    assert.equal(casaComLike(outro, ROBO_ETAPAS_LIKE), false, `alcançaria ${outro}`);
  }
});
