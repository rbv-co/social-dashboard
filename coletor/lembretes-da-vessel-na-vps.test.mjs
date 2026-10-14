import test from 'node:test';
import assert from 'node:assert/strict';
import { rodada, mandadorZepto } from './lembretes-da-vessel-na-vps.mjs';

const linha = (n, extra = {}) => ({ id: `00000000-0000-4000-a000-00000000000${n}`, peca_codigo: `VBAAAA000${n}`, email: `cliente${n}@x.com`, qual: 7, token: `TOKEN-SECRETO-${n}`, ...extra });

// um banco de mentira: devolve a fila e registra o que foi marcado
function banco(linhas, { falhaMarcar = new Set(), marcado = true } = {}) {
  const marcas = [];
  return { marcas, query: async (sql, args) => {
    if (sql.includes('vessel_lembretes_a_enviar')) return { rows: [{ r: { linhas } }] };
    if (sql.includes('vessel_lembrete_marcar_enviado')) {
      if (falhaMarcar.has(args[0])) throw new Error('banco fora');
      marcas.push(args); return { rows: [{ m: { marcado } }] };
    }
    throw new Error('consulta inesperada: ' + sql);
  } };
}
const semPausa = { respiro: 0, dorme: async () => {} };

test('manda cada e-mail com o link do certificado e o de parar, e só marca depois que saiu', async () => {
  const cli = banco([linha(1), linha(2)]);
  const enviados = [];
  const r = await rodada(cli, async (para, msg) => { enviados.push([para, msg.texto, cli.marcas.length]); return true; }, { ...semPausa, log: () => {} });
  assert.deepEqual(r, { mandados: 2, falharam: 0 });
  assert.equal(enviados[0][0], 'cliente1@x.com');
  assert.match(enviados[0][1], /https:\/\/vesselbrasil\.com\.br\/verify\/VBAAAA0001/);
  assert.match(enviados[0][1], /verify\/parar-lembrete\?t=TOKEN-SECRETO-1/);
  assert.equal(enviados[0][2], 0, 'a marca só vem DEPOIS do envio');
  assert.equal(cli.marcas.length, 2);
});

test('e-mail que falha não é marcado (volta na próxima rodada) e o log não leva token nem e-mail inteiro', async () => {
  const cli = banco([linha(1), linha(2)]);
  const log = [];
  const r = await rodada(cli, async (para) => para !== 'cliente1@x.com', { ...semPausa, log: (m) => log.push(m) });
  assert.deepEqual(r, { mandados: 1, falharam: 1 });
  assert.equal(cli.marcas.length, 1);
  const tudo = log.join('\n');
  assert.ok(!tudo.includes('TOKEN-SECRETO') && !tudo.includes('cliente1@x.com'), tudo);
  assert.match(tudo, /c•••@x\.com/);
});

test('marcar que falha depois do envio conta como falha (a cliente pode receber duas vezes, nunca zero)', async () => {
  const cli = banco([linha(1), linha(2)], { falhaMarcar: new Set([linha(1).id]) });
  const r = await rodada(cli, async () => true, { ...semPausa, log: () => {} });
  assert.deepEqual(r, { mandados: 1, falharam: 1 });
});

test('fila vazia ou resposta estranha: nada a fazer; pausa entre e-mails', async () => {
  assert.deepEqual(await rodada(banco([]), async () => { throw new Error('não devia'); }, semPausa), { mandados: 0, falharam: 0 });
  const pausas = [];
  await rodada(banco([linha(1), linha(2), linha(3)]), async () => true, { respiro: 250, dorme: async (ms) => pausas.push(ms), log: () => {} });
  assert.deepEqual(pausas, [250, 250], 'respiro entre um e outro, não antes do primeiro');
});

test('ZeptoMail: o cabeçalho aceita a chave crua ou prefixada; sem token ou com recusa devolve false sem vazar', async () => {
  const visto = [];
  const http = async (url, o) => { visto.push([url, o.headers.Authorization, JSON.parse(o.body)]); return { ok: true }; };
  const msg = { assunto: 'a', html: '<p>h</p>', texto: 't' };
  assert.equal(await mandadorZepto({ token: 'abc', http })('x@x.com', msg), true);
  assert.equal(await mandadorZepto({ token: 'Zoho-enczapikey abc', http })('x@x.com', msg), true);
  assert.equal(visto[0][1], 'Zoho-enczapikey abc');
  assert.equal(visto[1][1], 'Zoho-enczapikey abc');
  assert.equal(visto[0][2].from.name, 'VESSEL Brasil');
  const log = [];
  assert.equal(await mandadorZepto({ token: '', log: (...a) => log.push(a.join(' ')) })('x@x.com', msg), false);
  const recusa = async () => ({ ok: false, status: 401, json: async () => ({ error: { code: 'TM_3501', message: 'invalido' } }) });
  assert.equal(await mandadorZepto({ token: 'SEGREDO', http: recusa, log: (...a) => log.push(a.join(' ')) })('x@x.com', msg), false);
  assert.ok(!log.join('\n').includes('SEGREDO') && !log.join('\n').includes('x@x.com'));
});
