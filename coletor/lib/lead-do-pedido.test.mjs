import test from 'node:test';
import assert from 'node:assert/strict';
import { indiceDeLeads, leadDoPedido, telefoneCanonico } from './lead-do-pedido.mjs';

const LEADS = [
  { id: 1, whatsapp: '(19) 99876-5432', email: 'Ana@Exemplo.com ', criado_em: '2026-09-10T15:00:00Z', bling_id: '500' },
  { id: 2, whatsapp: '5511982457714', email: 'cris@uol.com.br', criado_em: '2026-09-13T17:09:23Z', bling_id: '501' },
  { id: 3, whatsapp: null, email: 'so-email@x.com', criado_em: '2026-09-01T10:00:00Z', bling_id: null },
];
const idx = indiceDeLeads(LEADS);

test('telefone: só dígitos, com o país; lixo vira nulo', () => {
  assert.equal(telefoneCanonico('(19) 99876-5432'), '5519998765432');
  assert.equal(telefoneCanonico('+55 11 98245-7714'), '5511982457714');
  assert.equal(telefoneCanonico('123'), null);
  assert.equal(telefoneCanonico(null), null);
});

test('casa pela ficha do próprio lead, que é a prova mais forte', () => {
  const r = leadDoPedido(idx, { contatoId: '500', telefones: [], email: '' }, '2026-09-20');
  assert.deepEqual(r, { leadId: 1, por: 'ficha' });
});

test('casa pelo e-mail, sem ligar para maiúscula e espaço', () => {
  const r = leadDoPedido(idx, { contatoId: '9', telefones: [], email: ' ana@exemplo.COM' }, '2026-09-20');
  assert.deepEqual(r, { leadId: 1, por: 'email' });
});

test('casa pelo telefone da ficha, com ou sem o nono dígito', () => {
  assert.deepEqual(leadDoPedido(idx, { contatoId: '9', telefones: ['5511982457714'], email: '' }, '2026-09-20'),
    { leadId: 2, por: 'telefone' });
  // ficha antiga da loja, gravada sem o 9: mesmo DDD, mesmos 8 finais
  assert.deepEqual(leadDoPedido(idx, { contatoId: '9', telefones: ['551182457714'], email: '' }, '2026-09-20'),
    { leadId: 2, por: 'telefone' });
});

test('pedido ANTES do cadastro não é conversão do lead', () => {
  // ela já era cliente e depois se cadastrou: o lead não trouxe a venda
  assert.equal(leadDoPedido(idx, { contatoId: '500', telefones: [], email: '' }, '2026-09-09'), null);
  // no MESMO dia do cadastro conta (cadastrou de manhã, comprou à tarde)
  assert.deepEqual(leadDoPedido(idx, { contatoId: '500', telefones: [], email: '' }, '2026-09-10'),
    { leadId: 1, por: 'ficha' });
});

test('o dia do cadastro é o de Brasília, não o de Londres', () => {
  // 01h UTC do dia 14 ainda é dia 13 em São Paulo: pedido do dia 13 conta
  const i = indiceDeLeads([{ id: 7, whatsapp: null, email: 'noite@x.com', criado_em: '2026-09-14T01:00:00Z' }]);
  assert.deepEqual(leadDoPedido(i, { contatoId: '1', telefones: [], email: 'noite@x.com' }, '2026-09-13'),
    { leadId: 7, por: 'email' });
});

test('sem nada em comum, não casa — e nunca casa por telefone vazio', () => {
  assert.equal(leadDoPedido(idx, { contatoId: '9', telefones: [], email: '' }, '2026-09-20'), null);
  assert.equal(leadDoPedido(idx, { contatoId: null, telefones: [null], email: null }, '2026-09-20'), null);
});

test('ficha vence e-mail, e e-mail vence telefone, quando apontam leads diferentes', () => {
  const r = leadDoPedido(idx,
    { contatoId: '501', telefones: ['5519998765432'], email: 'so-email@x.com' }, '2026-09-20');
  assert.deepEqual(r, { leadId: 2, por: 'ficha' });
  const r2 = leadDoPedido(idx,
    { contatoId: '9', telefones: ['5519998765432'], email: 'so-email@x.com' }, '2026-09-20');
  assert.deepEqual(r2, { leadId: 3, por: 'email' });
});

test('o mesmo telefone em dois cadastros: fica o mais antigo que já existia no dia da compra', () => {
  const i = indiceDeLeads([
    { id: 10, whatsapp: '19999990000', email: 'a@x.com', criado_em: '2026-09-05T12:00:00Z' },
    { id: 11, whatsapp: '19999990000', email: 'b@x.com', criado_em: '2026-09-15T12:00:00Z' },
  ]);
  assert.equal(leadDoPedido(i, { contatoId: '1', telefones: ['5519999990000'], email: '' }, '2026-09-20').leadId, 10);
  assert.equal(leadDoPedido(i, { contatoId: '1', telefones: ['5519999990000'], email: '' }, '2026-09-06').leadId, 10);
});
