#!/usr/bin/env node
// PROVA DA MIGRATION CONTRA A PRODUÇÃO, SEM DEIXAR RASTRO.
// Tudo acontece dentro de uma transação que termina em ROLLBACK — inclusive
// se algo explodir no meio, por isso o rollback mora no `finally`.
import './lib/carregar-env.mjs';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));

const sql = readFileSync(join(__dirname, '../db/migrations/2026-09-11-vessel-lista-objetivo-e-loja.sql'), 'utf8');
const caPath = process.env.PGSSLROOTCERT || join(__dirname, 'supabase-ca.crt');
const cli = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true, ca: readFileSync(caPath, 'utf8') },
});

await cli.connect();
await cli.query('begin');
try {
  await cli.query(sql);

  // 1. cadastro pela porta pública devolve senha
  const { rows: [r1] } = await cli.query(
    `select public.vessel_entrar_na_lista($1,$2,$3,$4,null,null) as r`,
    ['Prova Rollback', `prova+${Date.now()}@exemplo.invalido`, '19999999999', 'v1']);
  const senha = r1.r.senha;
  console.log('senha devolvida:', senha ? 'sim' : 'NAO — defeito');

  // 2. senha errada é recusada, e NÃO grava
  const { rows: [r2] } = await cli.query(
    `select public.vessel_marcar_objetivo($1,'visita',null) as r`,
    ['00000000-0000-0000-0000-000000000000']);
  console.log('senha errada:', r2.r.situacao, '(esperado: senha_invalida)');

  // 3. senha certa grava visita + loja
  const { rows: [r3] } = await cli.query(
    `select public.vessel_marcar_objetivo($1,'visita',null) as r`, [senha]);
  console.log('senha certa:', r3.r.situacao, '(esperado: registrado)');

  // 4. USO ÚNICO: a mesma senha não serve duas vezes
  const { rows: [r4] } = await cli.query(
    `select public.vessel_marcar_objetivo($1,'ecommerce',null) as r`, [senha]);
  console.log('reuso:', r4.r.situacao, '(esperado: senha_invalida)');
} catch (e) {
  console.error('ERRO:', e.message);
  if (e.position) console.error('posição:', e.position);
  if (e.hint) console.error('dica:', e.hint);
  process.exitCode = 1;
} finally {
  await cli.query('rollback'); // ⚠️ SEMPRE, inclusive se algo acima explodir
  await cli.end();
  console.log('rollback feito — nada ficou no banco');
}
