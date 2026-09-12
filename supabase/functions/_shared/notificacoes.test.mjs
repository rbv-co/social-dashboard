import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TIPOS_DE_NOTIFICACAO, ehTipoValido, padraoDoTipo, querReceber, inscricoesDoTipo } from './notificacoes.js';

const subs = [
  { endpoint: 'a', user_id: 'breno' },
  { endpoint: 'b', user_id: 'erick' },
  { endpoint: 'c', user_id: 'erick' },   // duas pessoas, tres aparelhos
];

test('os tipos que existem hoje', () => {
  assert.deepEqual(TIPOS_DE_NOTIFICACAO.map((t) => t.chave),
    ['vendas', 'saldo', 'conteudo', 'frota', 'frota_reserva']);
  assert.equal(ehTipoValido('vendas'), true);
  assert.equal(ehTipoValido('inventado'), false);
});

test('so vendas vem ligado por padrao; saldo e conteudo NAO', () => {
  // So quem cuida de trafego precisa do saldo. Ligar pra todo mundo repetiria o
  // problema que essa preferencia existe pra resolver.
  assert.equal(padraoDoTipo('vendas'), true);
  assert.equal(padraoDoTipo('saldo'), false);
  // 'conteudo' nasce DESMARCADO (decisao do dono): so recebe quem ligar em
  // Administracao > Usuarios. E o que permite o robo da hora H ficar ativo sem
  // tocar o celular de quem nao pediu.
  assert.equal(padraoDoTipo('conteudo'), false);
});

test('sem ninguem ter ligado, o aviso de conteudo nao vai pra ninguem', () => {
  // A garantia de que ativar o cron nao incomoda ninguem de saida.
  const subs = [{ user_id: 'u1', endpoint: 'e1' }, { user_id: 'u2', endpoint: 'e2' }];
  assert.deepEqual(inscricoesDoTipo(subs, [], 'conteudo'), []);
});

test('quem liga passa a receber', () => {
  const subs = [{ user_id: 'u1', endpoint: 'e1' }];
  const prefs = [{ user_id: 'u1', tipo: 'conteudo', ativo: true }];
  assert.equal(inscricoesDoTipo(subs, prefs, 'conteudo').length, 1);
});

test('todo tipo tem chave, rotulo e descricao (a tela de preferencias le esta lista)', () => {
  for (const t of TIPOS_DE_NOTIFICACAO) {
    assert.ok(t.chave, 'faltou chave');
    assert.ok(t.rotulo, `faltou rotulo em ${t.chave}`);
    assert.ok(t.descricao && t.descricao.length > 15, `descricao fraca em ${t.chave}`);
    assert.equal(typeof t.padrao, 'boolean');
  }
});

test('a lista de tipos bate com o CHECK de push_preferencias.tipo', () => {
  // Se um tipo novo entrar aqui sem a migration que solta o CHECK, salvar a
  // preferencia falha com erro de constraint. Ja aconteceu com 'conteudo' e
  // com 'frota'.
  //
  // Cada chave desta lista tem a migration que a liberou:
  //   vendas, saldo   o CHECK original
  //   conteudo        db/migrations/2026-07-30-conteudo-04-hora-h.sql
  //   frota           db/migrations/acessos/030_push_tipo_frota.sql
  //   frota_reserva   db/migrations/acessos/052_push_tipo_reserva.sql
  //
  // A 052 foi APLICADA no banco em 21/08/2026, e a prova foi feita com
  // `rollback`: dentro da transação o insert de 'frota_reserva' passou, e
  // depois do rollback a tabela ficou com zero linha do tipo. Ligar o
  // interruptor na tela não quebra mais.
  assert.deepEqual(
    TIPOS_DE_NOTIFICACAO.map((t) => t.chave).sort(),
    ['conteudo', 'frota', 'frota_reserva', 'saldo', 'vendas'],
  );
});

test('sem preferencia salva vale o padrao do tipo', () => {
  // Assim ligar uma notificacao nova nao exige mexer em cada usuario.
  assert.equal(querReceber([], 'breno', 'vendas'), true);
  assert.equal(querReceber([], 'breno', 'saldo'), false);
  assert.equal(querReceber(null, 'breno', 'vendas'), true);
});

test('preferencia salva ganha do padrao, nos dois sentidos', () => {
  const prefs = [
    { user_id: 'breno', tipo: 'vendas', ativo: false },
    { user_id: 'breno', tipo: 'saldo', ativo: true },
  ];
  assert.equal(querReceber(prefs, 'breno', 'vendas'), false, 'desligar o que e padrao');
  assert.equal(querReceber(prefs, 'breno', 'saldo'), true, 'ligar o que nao e');
});

test('a preferencia de um nao vale pra outro', () => {
  const prefs = [{ user_id: 'breno', tipo: 'saldo', ativo: true }];
  assert.equal(querReceber(prefs, 'breno', 'saldo'), true);
  assert.equal(querReceber(prefs, 'erick', 'saldo'), false);
});

test('tipo desconhecido nao entrega pra ninguem', () => {
  assert.equal(querReceber([{ user_id: 'breno', tipo: 'x', ativo: true }], 'breno', 'x'), false);
  assert.deepEqual(inscricoesDoTipo(subs, [], 'x'), []);
});

test('filtra os aparelhos pelo dono, e pega TODOS os de quem quer', () => {
  const prefs = [{ user_id: 'erick', tipo: 'saldo', ativo: true }];
  const r = inscricoesDoTipo(subs, prefs, 'saldo');
  assert.deepEqual(r.map((s) => s.endpoint), ['b', 'c'], 'os dois aparelhos do erick');
});

test('vendas (padrao ligado) vai pra todos que nao desligaram', () => {
  const r = inscricoesDoTipo(subs, [{ user_id: 'breno', tipo: 'vendas', ativo: false }], 'vendas');
  assert.deepEqual(r.map((s) => s.endpoint), ['b', 'c'], 'o breno desligou');
});

test('inscricao SEM dono fica de fora', () => {
  // Nao da pra saber de quem e; mandar "por via das duvidas" e o comportamento
  // antigo que se esta corrigindo.
  const r = inscricoesDoTipo([{ endpoint: 'orfa', user_id: null }], [], 'vendas');
  assert.deepEqual(r, []);
});

test('lista vazia ou nula nao quebra', () => {
  assert.deepEqual(inscricoesDoTipo([], [], 'vendas'), []);
  assert.deepEqual(inscricoesDoTipo(null, null, 'vendas'), []);
});
