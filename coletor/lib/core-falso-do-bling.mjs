// Core falso para os testes do contato da lista: guarda os contatos criados por chave de idempotência (replay não duplica).
import assert from 'node:assert/strict';

export const resp = (status, corpo = {}, extra = {}) => ({
  status, ok: status >= 200 && status < 300, incerto: false, reautorizar: false, retryAfter: null,
  json: async () => corpo, text: async () => JSON.stringify(corpo), ...extra,
});

/** Core falso: guarda os contatos criados por chave de idempotência (replay não duplica), como o Core de verdade. */
export function coreFalso({ existentes = [], falhas = {} } = {}) {
  const criados = new Map(); // chave -> id
  const chamadas = [];
  let proximo = 9000;
  return {
    criados, chamadas,
    async chamar(metodo, caminho, { query, corpo, chave } = {}) {
      chamadas.push(`${metodo} ${caminho}`);
      const f = falhas[`${metodo} ${caminho.replace(/\/\d+$/, '/{id}')}`];
      if (f) return typeof f === 'function' ? f() : f;
      if (metodo === 'GET' && caminho === '/contatos') {
        return resp(200, { data: existentes.filter((c) => JSON.stringify(c).toLowerCase().includes(String(query.pesquisa).toLowerCase())).map((c) => ({ id: c.id })) });
      }
      if (metodo === 'GET') return resp(200, { data: existentes.find((c) => String(c.id) === caminho.split('/').pop()) });
      if (metodo === 'POST' && caminho === '/contatos') {
        assert.ok(chave, 'escrita sem chave de idempotência');
        if (!criados.has(chave)) criados.set(chave, ++proximo);
        return resp(201, { data: { id: criados.get(chave) } });
      }
      throw new Error(`chamada inesperada ${metodo} ${caminho}`);
    },
  };
}
