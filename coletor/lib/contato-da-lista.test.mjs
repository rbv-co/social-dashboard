import test from 'node:test';
import assert from 'node:assert/strict';
import { resp, coreFalso } from './core-falso-do-bling.mjs';
import { codigoDeOrigem, corpoDoContato, semDadoPessoal, contatoDaLinha, PREFIXO_POR_ORIGEM } from './contato-da-lista.mjs';

const linha = { id: 654, nome: 'Ana Prova', email: 'Ana@Prova.com', whatsapp: '+55 (19) 99999-0000', origem: 'lp-vesselbrasil', criado_em: '2026-10-20T05:04:23.213Z' };

test('a marca de origem sai da origem da linha; pop-up tem a sua (PP) e origem desconhecida cai em LP', () => {
  assert.equal(PREFIXO_POR_ORIGEM['pre-venda'], 'PV');
  assert.equal(codigoDeOrigem(linha), 'LP-20261020-654');
  assert.equal(codigoDeOrigem({ ...linha, origem: 'popup-loja' }), 'PP-20261020-654');
  assert.equal(codigoDeOrigem({ ...linha, origem: 'pre-venda' }), 'PV-20261020-654');
  assert.equal(codigoDeOrigem({ ...linha, origem: 'qualquer-coisa' }), 'LP-20261020-654');
});

test('o corpo leva tipo, situação, celular normalizado, marca e o tipo Lead', () => {
  const c = corpoDoContato(linha);
  assert.deepEqual([c.tipo, c.situacao, c.celular, c.codigo, c.tiposContato], ['F', 'A', '19999990000', 'LP-20261020-654', [{ id: 14584907560 }]]);
});

test('o motivo gravado não leva e-mail nem telefone', () => {
  const t = semDadoPessoal('Contato ana@prova.com com celular (19) 99999-0000 recusado');
  assert.doesNotMatch(t, /@|9999/);
});

test('reaproveita o contato que já existe (e-mail conferido no detalhe) e não cria', async () => {
  const core = coreFalso({ existentes: [{ id: 11, email: 'ana@prova.com' }] });
  assert.deepEqual(await contatoDaLinha(core, linha), { id: '11', reaproveitado: true });
  assert.ok(!core.chamadas.some((c) => c.startsWith('POST')));
});

test('achado pela busca mas com e-mail diferente no detalhe: cria um novo', async () => {
  const core = coreFalso({ existentes: [{ id: 11, nome: 'ana@prova.com', email: 'outra@pessoa.com' }] });
  const r = await contatoDaLinha(core, linha);
  assert.equal(r.reaproveitado, false);
  assert.equal(core.criados.size, 1);
});

test('cria quando não existe; repetir a mesma linha reusa a chave e não duplica', async () => {
  const core = coreFalso();
  const a = await contatoDaLinha(core, linha), b = await contatoDaLinha(core, linha);
  assert.equal(a.id, b.id);
  assert.equal(core.criados.size, 1);
});

test('429 e reautorização param o lote sem marcar a linha', async () => {
  assert.deepEqual(await contatoDaLinha(coreFalso({ falhas: { 'POST /contatos': resp(429) } }), linha), { pausa: '429' });
  assert.deepEqual(await contatoDaLinha(coreFalso({ falhas: { 'POST /contatos': resp(409, {}, { reautorizar: true }) } }), linha), { pausa: 'reautorizar' });
  assert.deepEqual(await contatoDaLinha(coreFalso({ falhas: { 'GET /contatos': resp(429) } }), linha), { pausa: '429' });
});

test('504 incerto não reenvia; 5xx/sem resposta tenta de novo; 400 é definitivo sem dado pessoal', async () => {
  const incerto = await contatoDaLinha(coreFalso({ falhas: { 'POST /contatos': resp(504, {}, { incerto: true }) } }), linha);
  assert.equal(incerto.tipo, 'incerto');
  assert.match(incerto.erro, /chave vessel-lista_654:contato-criar:/);
  assert.equal((await contatoDaLinha(coreFalso({ falhas: { 'POST /contatos': resp(502) } }), linha)).tipo, 'tenta');
  assert.equal((await contatoDaLinha(coreFalso({ falhas: { 'POST /contatos': resp(0) } }), linha)).tipo, 'tenta');
  assert.equal((await contatoDaLinha(coreFalso({ falhas: { 'GET /contatos': resp(500) } }), linha)).tipo, 'tenta');
  const d = await contatoDaLinha(coreFalso({ falhas: { 'POST /contatos': resp(400, { error: { description: 'email ana@prova.com inválido' } }) } }), linha);
  assert.equal(d.tipo, 'definitivo');
  assert.doesNotMatch(d.erro, /ana@prova/);
});

test('o Bling aceitou mas não devolveu o id: incerto (o contato pode existir)', async () => {
  const r = await contatoDaLinha(coreFalso({ falhas: { 'POST /contatos': resp(201, {}) } }), linha);
  assert.equal(r.tipo, 'incerto');
});
