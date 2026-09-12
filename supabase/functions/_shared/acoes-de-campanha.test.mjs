import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contagensDaCampanha } from './acoes-de-campanha.js';

// O array `actions` é o que a Meta devolve em act_X/insights. Os nomes de
// action_type mudam conforme o tipo de campanha, e a mesma coisa aparece com
// mais de um nome — por isso cada contagem tenta uma LISTA, na ordem, e para na
// primeira que existir. Somar as duas contaria a mesma conversa duas vezes.

test('conta conversa de WhatsApp', () => {
  const actions = [
    { action_type: 'onsite_conversion.total_messaging_connection', value: '1020' },
    { action_type: 'link_click', value: '55' },
  ];
  assert.equal(contagensDaCampanha(actions).conversas, 1020);
});

test('a conversa não é contada duas vezes quando a Meta manda os dois nomes', () => {
  const actions = [
    { action_type: 'onsite_conversion.total_messaging_connection', value: '100' },
    { action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '97' },
  ];
  assert.equal(contagensDaCampanha(actions).conversas, 100);
});

test('conta cadastro, compra e visita', () => {
  const actions = [
    { action_type: 'lead', value: '2' },
    { action_type: 'purchase', value: '7' },
    { action_type: 'landing_page_view', value: '480' },
    { action_type: 'link_click', value: '900' },
  ];
  const c = contagensDaCampanha(actions);
  assert.equal(c.cadastros, 2);
  assert.equal(c.compras, 7);
  assert.equal(c.visitas, 480, 'visita é landing_page_view; clique NÃO é visita');
});

test('sem o tipo, a contagem é zero — e não quebra', () => {
  const c = contagensDaCampanha([{ action_type: 'post_reaction', value: '10' }]);
  assert.deepEqual(c, { conversas: 0, cadastros: 0, compras: 0, visitas: 0 });
});

test('resposta sem actions não derruba a coleta', () => {
  assert.deepEqual(contagensDaCampanha(undefined), { conversas: 0, cadastros: 0, compras: 0, visitas: 0 });
  assert.deepEqual(contagensDaCampanha(null), { conversas: 0, cadastros: 0, compras: 0, visitas: 0 });
  assert.deepEqual(contagensDaCampanha('nada disso'), { conversas: 0, cadastros: 0, compras: 0, visitas: 0 });
});

test('valor vem como texto e vira número inteiro', () => {
  assert.equal(contagensDaCampanha([{ action_type: 'lead', value: '12' }]).cadastros, 12);
  assert.equal(contagensDaCampanha([{ action_type: 'lead', value: 12 }]).cadastros, 12);
  assert.equal(contagensDaCampanha([{ action_type: 'lead', value: 'xis' }]).cadastros, 0);
});
