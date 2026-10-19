import test from 'node:test';
import assert from 'node:assert/strict';
import { lerEnv, alvos } from './conferir-papeis.mjs';

test('lê env como texto e monta os alvos sem confundir senha com comando', () => {
  const env = lerEnv('SAIU_DO_SUPABASE=1\nROBO_NOTAS_DOS_PEDIDOS_DATABASE_URL=postgres://robo_notas:s3$(x)@api-db:5432/api?sslmode=disable\nDATABASE_URL=postgres://postgres:v@aws.supabase.com:5432/postgres\nCOPIA_DB_SENHA="abc"\n# x=1\n');
  const a = alvos(env, '172.21.0.2', 'api_corte');
  assert.equal(a.length, 2); // a URL do Supabase velho não entra
  assert.deepEqual([a[0].config.host, a[0].config.user, a[0].config.database], ['172.21.0.2', 'robo_notas', 'api_corte']);
  assert.deepEqual([a[1].config.user, a[1].config.password], ['copia', 'abc']);
});
test('senha solta sem URL de referência falha alto', () => {
  assert.throws(() => alvos({ CARTOES_DB_SENHA: 'x' }, '1.1.1.1'), /sem nenhuma/);
});
