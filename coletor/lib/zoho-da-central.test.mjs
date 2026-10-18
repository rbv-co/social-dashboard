import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conexaoZohoPg } from './zoho-da-central.mjs';

// Depois do Supabase não existe PostgREST: o robô que já fala com o banco por `pg` lê a conexão do Zoho
// (`acessos_conexoes`, a que o dono liga em Acessos → Zoho) do MESMO banco, em vez de ir à REST do Supabase.
// Antes, `meta-ads-no-zoho` e `log-de-carocos` liam o banco novo para os dados e o Supabase para o Zoho.

const clienteCom = (rows) => ({
  consultas: [],
  async query(sql, valores) { this.consultas.push({ sql, valores }); return { rows }; },
});

test('lê a conexão do Zoho do banco do próprio robô, só as 4 colunas de que o token precisa', async () => {
  const c = { client_id: 'id', client_secret: 's', refresh_token: 'r', data_center: '.com' };
  const cli = clienteCom([c]);
  assert.deepEqual(await conexaoZohoPg(cli), c);
  assert.match(cli.consultas[0].sql, /from\s+(public\.)?acessos_conexoes/);
  assert.match(cli.consultas[0].sql, /provedor\s*=\s*'zoho'/);
  assert.match(cli.consultas[0].sql, /client_id, client_secret, refresh_token, data_center/);
});

test('sem conexão (ou sem refresh_token) recusa com a frase de sempre: a Central não está ligada ao Zoho', async () => {
  await assert.rejects(conexaoZohoPg(clienteCom([])), /não está conectada ao Zoho/);
  await assert.rejects(conexaoZohoPg(clienteCom([{ refresh_token: '' }])), /não está conectada ao Zoho/);
});
