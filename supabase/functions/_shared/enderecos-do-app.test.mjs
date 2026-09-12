import test from 'node:test';
import assert from 'node:assert';
import {
  ENDERECOS_DO_APP, ENDERECO_PADRAO,
  enderecoPermitido, enderecoDeRetorno, corsDoPedido,
} from './enderecos-do-app.js';

const ANTIGO = 'https://socialdashboard.rbvcompany.com';
const NOVO   = 'https://central.rbvcompany.com';

// Um pedido de mentira com a MESMA forma do de verdade: `headers.get('Origin')`.
const pedido = (origem) => ({ headers: { get: (k) => (k === 'Origin' ? origem : null) } });

test('os dois endereços da mudança estão na lista', () => {
  assert.ok(ENDERECOS_DO_APP.includes(ANTIGO), 'o antigo não pode sair da lista');
  assert.ok(ENDERECOS_DO_APP.includes(NOVO));
});

test('enquanto a mudança não vira, o padrão é o endereço ANTIGO', () => {
  // Se isto quebrar, é porque alguém virou a chave. Só vire junto com o DNS.
  assert.equal(ENDERECO_PADRAO, ANTIGO);
});

test('endereço nosso volta ele mesmo', () => {
  assert.equal(enderecoPermitido(ANTIGO), ANTIGO);
  assert.equal(enderecoPermitido(NOVO), NOVO);
  assert.equal(enderecoDeRetorno(NOVO), NOVO);
});

test('endereço de fora NÃO passa — cai no padrão', () => {
  for (const forjado of [
    'https://central.rbvcompany.com.site-de-outro.net', // sufixo colado
    'https://rbvcompany.com',                            // o domínio raiz
    'https://www.rbvcompany.com',                        // hospedado por terceiro
    'http://central.rbvcompany.com',                     // sem cadeado
    'https://central.rbvcompany.com/',                   // com barra no fim
    'https://evil.com',
  ]) {
    assert.equal(enderecoPermitido(forjado), null, `deixou passar: ${forjado}`);
    assert.equal(enderecoDeRetorno(forjado), ENDERECO_PADRAO, `retorno errado: ${forjado}`);
  }
});

test('sem origem nenhuma cai no padrão, sem estourar', () => {
  for (const nada of [undefined, null, '', 0, {}, []]) {
    assert.equal(enderecoPermitido(nada), null);
    assert.equal(enderecoDeRetorno(nada), ENDERECO_PADRAO);
  }
});

test('o CORS devolve a origem que perguntou — cada endereço recebe a sua', () => {
  assert.equal(corsDoPedido(pedido(NOVO))['Access-Control-Allow-Origin'], NOVO);
  assert.equal(corsDoPedido(pedido(ANTIGO))['Access-Control-Allow-Origin'], ANTIGO);
});

test('o CORS traz Vary: Origin — senão um cache entrega a liberação do outro', () => {
  assert.equal(corsDoPedido(pedido(NOVO)).Vary, 'Origin');
});

test('site de fora não recebe liberação no CORS', () => {
  const h = corsDoPedido(pedido('https://evil.com'));
  assert.notEqual(h['Access-Control-Allow-Origin'], 'https://evil.com');
  assert.notEqual(h['Access-Control-Allow-Origin'], '*');
});

test('pedido sem Origin (chamada de servidor) não quebra o CORS', () => {
  assert.equal(corsDoPedido({}) ['Access-Control-Allow-Origin'], ENDERECO_PADRAO);
  assert.equal(corsDoPedido(pedido(null))['Access-Control-Allow-Origin'], ENDERECO_PADRAO);
});
