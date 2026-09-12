import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { completarContato } from './completar-contato-do-bling.js';

/* ⚠️ ESTA REGRA ESCREVE NO CADASTRO REAL DA CLIENTE, no ERP do dono.
 * O maior risco nao e escrever errado: e APAGAR CALADO o que ja estava la.
 * Nesta casa um PUT ja apagou as fotos de um produto e respondeu 200. */

const CONTATO = {
  id: 9, nome: 'Marina A', celular: '', telefone: '(19) 3455-0000',
  email: 'm@x.com', numeroDocumento: '12345678900', situacao: 'A', tipo: 'F',
  dadosAdicionais: { sexo: 'F', naturalidade: 'Limeira' },
  endereco: { geral: { cep: '13480-000', municipio: 'Limeira' } },
  financeiro: { limiteCredito: 0 },
};
const GARANTIA = { nome: 'Marina Albuquerque', whatsapp: '19998124477', nascimento: '1990-05-12' };

test('⚠️ TUDO que ja existia no contato sobrevive', () => {
  const { corpo } = completarContato(CONTATO, GARANTIA);
  assert.equal(corpo.telefone, '(19) 3455-0000');
  assert.equal(corpo.email, 'm@x.com');
  assert.equal(corpo.numeroDocumento, '12345678900');
  assert.deepEqual(corpo.endereco, CONTATO.endereco);
  assert.deepEqual(corpo.financeiro, CONTATO.financeiro);
  assert.equal(corpo.dadosAdicionais.naturalidade, 'Limeira', 'campo vizinho foi apagado');
  assert.equal(corpo.dadosAdicionais.sexo, 'F');
});

test('o `id` nao vai no corpo — ele identifica na URL', () => {
  assert.ok(!('id' in completarContato(CONTATO, GARANTIA).corpo));
});

test('os tres campos da cliente entram', () => {
  const { corpo, campos, mudou } = completarContato(CONTATO, GARANTIA);
  assert.equal(mudou, true);
  assert.deepEqual(campos, ['nome', 'celular', 'nascimento']);
  assert.equal(corpo.nome, 'Marina Albuquerque');
  assert.equal(corpo.celular, '19998124477');
  assert.equal(corpo.dadosAdicionais.dataNascimento, '1990-05-12');
});

test('⚠️ o que a cliente escreveu GANHA — decisao do dono', () => {
  const jaTinha = { ...CONTATO, celular: '19911112222',
                    dadosAdicionais: { dataNascimento: '1985-01-01' } };
  const { corpo } = completarContato(jaTinha, GARANTIA);
  assert.equal(corpo.celular, '19998124477', 'o dado da cliente tinha de vencer');
  assert.equal(corpo.dadosAdicionais.dataNascimento, '1990-05-12');
});

test('⚠️ VAZIO nao apaga: "nao respondeu" nao e "apagou"', () => {
  const semNada = { nome: '', whatsapp: null, nascimento: undefined };
  const { corpo, mudou } = completarContato(CONTATO, semNada);
  assert.equal(mudou, false, 'nao havia nada para mudar');
  assert.equal(corpo.telefone, '(19) 3455-0000');
  assert.equal(corpo.nome, 'Marina A', 'o nome antigo foi apagado por um vazio');
  assert.deepEqual(corpo.dadosAdicionais, CONTATO.dadosAdicionais);
});

test('nada mudou => `mudou` e falso, e o robo nao gasta chamada', () => {
  const igual = { nome: 'Marina A', whatsapp: '', nascimento: '' };
  assert.equal(completarContato(CONTATO, igual).mudou, false);
  // e quando o valor e o MESMO que ja esta la, tambem nao ha o que fazer
  const mesmo = { ...CONTATO, celular: '19998124477',
                  dadosAdicionais: { dataNascimento: '1990-05-12' } };
  assert.equal(completarContato(mesmo, { ...GARANTIA, nome: 'Marina A' }).mudou, false);
});

test('espaco em volta nao conta como mudanca', () => {
  const { mudou } = completarContato(CONTATO, { nome: '  Marina A  ' });
  assert.equal(mudou, false);
});

test('contato sem `dadosAdicionais` nao quebra', () => {
  const cru = { nome: 'X' };
  const { corpo } = completarContato(cru, { nascimento: '2000-01-01' });
  assert.equal(corpo.dadosAdicionais.dataNascimento, '2000-01-01');
});

test('entrada nula nao quebra', () => {
  assert.equal(completarContato(null, null).mudou, false);
  assert.deepEqual(completarContato(null, null).corpo, {});
});

test('⚠️ o objeto ORIGINAL nao e modificado', () => {
  // Se fosse, o robo compararia contra um objeto ja alterado na volta.
  const copia = JSON.parse(JSON.stringify(CONTATO));
  completarContato(CONTATO, GARANTIA);
  assert.deepEqual(CONTATO, copia);
});

test('⚠️ o modulo REGISTRA que contato nao tem PATCH — so PUT', () => {
  /* A duvida e legitima e volta sempre, porque em PRODUTO a regra e a inversa
   * (usar PATCH; o PUT apaga as fotos). Quem mexer aqui precisa achar a medicao
   * sem ter de refazer o teste contra a API. */
  const fonte = readFileSync(new URL('./completar-contato-do-bling.js', import.meta.url), 'utf8');
  assert.match(fonte, /CONTATO → só existe PUT/);
  assert.match(fonte, /PRODUTO → usar PATCH/);
  assert.match(fonte, /404 \(RESOURCE_NOT_FOUND\)/);
});

test('⚠️⚠️ o corpo devolvido e o contato INTEIRO — PUT parcial APAGA', () => {
  /* MEDIDO em 06/09/2026 contra a API de verdade: um PUT mandando so
   * nome/tipo/situacao/numeroDocumento/celular respondeu 204 e deixou telefone,
   * email, naturalidade e cep VAZIOS. Sem erro nenhum.
   *
   * Este teste existe para o dia em que alguem achar que mandar o contato
   * inteiro e desperdicio de banda. Nao e: e o que impede de apagar o cadastro
   * da cliente. */
  const cheio = {
    id: 1, nome: 'A', tipo: 'F', situacao: 'A', numeroDocumento: '1', telefone: 'T',
    email: 'E', ie: 'IE', rg: 'RG', fantasia: 'F2', emailNotaFiscal: 'EN',
    dadosAdicionais: { naturalidade: 'N', sexo: 'F' },
    endereco: { geral: { cep: 'C' } }, financeiro: { limiteCredito: 7 },
    tiposContato: [{ id: 9 }], vendedor: { id: 3 }, pais: { nome: 'Brasil' },
  };
  const { corpo } = completarContato(cheio, { nascimento: '1990-05-12' });
  // TODA chave do contato original (menos `id`) tem de voltar no corpo.
  for (const chave of Object.keys(cheio)) {
    if (chave === 'id') continue;
    assert.ok(chave in corpo, `campo "${chave}" sumiu do corpo do PUT — isso APAGA o dado`);
  }
  assert.equal(corpo.telefone, 'T');
  assert.equal(corpo.financeiro.limiteCredito, 7);
  assert.deepEqual(corpo.tiposContato, [{ id: 9 }]);
});
