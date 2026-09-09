import test from 'node:test';
import assert from 'node:assert/strict';
import { fotosDoZohoParaSku, esquecerAsPastas } from './buscar-no-zoho.mjs';

/* ⚠️ ESTE ARQUIVO EXISTE POR CAUSA DE UM DEFEITO QUE PASSOU POR TUDO.
 *
 * Em 08/09/2026 a trava de cor foi escrita, testada e aprovada — mas o `import`
 * de `pastaServeParaACor` neste modulo nao entrou (a substituicao procurava a
 * linha com ponto-e-virgula, e o arquivo nao tem). `node --check` passou: nome
 * indefinido nao e erro de sintaxe. Os testes passaram: eles liam o TEXTO dos
 * arquivos, nunca chamavam a funcao. So a rodada de verdade acusou, com
 * `pastaServeParaACor is not defined` engolido pelo catch — e 39 bolsas caindo
 * no Bling calado, como se a regra estivesse valendo.
 *
 * Por isso o teste daqui CHAMA a funcao de verdade, com um Zoho de mentira. */

function zohoDeMentira({ pasta, arquivos }) {
  // ⚠️ A RAIZ E LIDA DE `process.env` NA CARGA DO MODULO, entao nao da para
  // escolher o id da pasta por parametro. O de mentira responde pela ORDEM das
  // chamadas, que e o que o modulo realmente faz: raiz → marca → pasta do SKU.
  let chamada = 0;
  const corpo = (itens) => ({ status: 200, text: async () => JSON.stringify({ data: itens }) });
  return async (url) => {
    if (String(url).includes('oauth/v2/token')) {
      return { json: async () => ({ access_token: 'tok' }) };
    }
    chamada += 1;
    if (chamada === 1) return corpo([{ id: 'marca', attributes: { name: 'Vessel Brasil', is_folder: true } }]);
    if (chamada === 2) return corpo([{ id: 'p1', attributes: { name: pasta, is_folder: true } }]);
    return corpo(arquivos.map((nome, i) => ({ id: `f${i}`, attributes: { name: nome, is_folder: false } })));
  };
}

const ENV = { ZOHO_PASTA_FOTOS: 'raiz', ZOHO_DC: 'com' };
const opcoes = (extra) => ({ env: { ...ENV, ...extra?.env }, ...extra });

test('⚠️ a LUNEA PINHAO reprova de verdade, chamando a funcao', async () => {
  esquecerAsPastas();
  const r = await fotosDoZohoParaSku('SS0008HB.M4', opcoes({
    cor: 'Pinhão',
    buscar: zohoDeMentira({
      pasta: 'Lunea_Pinhão - SS0008HB.M4',
      arquivos: ['Lunea_Marrom_Frente.png', 'Lunea_Marrom_Costas.png'],
    }),
  }));
  assert.equal(r.fotos.length, 0, 'a pasta tem o SKU certo e a cor errada dentro');
  assert.match(r.porque, /nao confere com a cor/);
});

test('pasta com a cor certa entrega as fotos', async () => {
  esquecerAsPastas();
  const r = await fotosDoZohoParaSku('SS0002HB.B1', opcoes({
    cor: 'Jeans',
    buscar: zohoDeMentira({
      pasta: 'Cerne_Jeans - SS0002HB.B1',
      arquivos: ['Cerne_Jeans_Frente.png', 'Cerne_Jeans_Alca.png'],
    }),
  }));
  assert.equal(r.fotos.length, 2);
  assert.equal(r.pasta, 'Cerne_Jeans - SS0002HB.B1');
  assert.match(r.fotos[0].nome, /Frente/, 'a Frente vem primeiro — e a capa do certificado');
});

test('lote sem cor nao leva foto do Zoho', async () => {
  esquecerAsPastas();
  const r = await fotosDoZohoParaSku('SS0002HB.B1', opcoes({
    cor: null,
    buscar: zohoDeMentira({
      pasta: 'Cerne_Jeans - SS0002HB.B1',
      arquivos: ['Cerne_Jeans_Frente.png'],
    }),
  }));
  assert.equal(r.fotos.length, 0);
});
