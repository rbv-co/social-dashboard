#!/usr/bin/env node
// PROVA DA MIGRATION CONTRA A PRODUÇÃO, SEM DEIXAR RASTRO.
// Tudo acontece dentro de uma transação que termina em ROLLBACK — inclusive
// se algo explodir no meio, por isso o rollback mora no `finally`.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Mesmo carregador de .env dos outros scripts de coletor/ (ex.: consultar.mjs):
// lê coletor/.env relativo a este arquivo, sem sobrescrever variável já setada.
for (const raw of readFileSync(join(__dirname, '.env'), 'utf8').split('\n')) {
  const l = raw.trim(); if (!l || l.startsWith('#')) continue;
  const i = l.indexOf('='); if (i === -1) continue;
  const k = l.slice(0, i).trim(); let v = l.slice(i + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (!(k in process.env)) process.env[k] = v;
}

const sql = readFileSync(join(__dirname, '../db/migrations/2026-09-12-espelho-ao-vivo.sql'), 'utf8');
const caPath = process.env.PGSSLROOTCERT || join(__dirname, 'supabase-ca.crt');
const cli = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true, ca: readFileSync(caPath, 'utf8') },
});

await cli.connect();
await cli.query('begin');
try {
  await cli.query(sql);

  // 1. a trava é de UM SÓ: quem chega depois não entra
  const { rows: [a] } = await cli.query("select public.tomar_trava('prova', 120) as r");
  const { rows: [b] } = await cli.query("select public.tomar_trava('prova', 120) as r");
  console.log('primeiro pega a trava:', a.r, '(esperado: true)');
  console.log('segundo NAO pega:     ', b.r, '(esperado: false)');

  // 2. soltando, o próximo entra
  await cli.query("select public.soltar_trava('prova')");
  const { rows: [c] } = await cli.query("select public.tomar_trava('prova', 120) as r");
  console.log('depois de soltar:     ', c.r, '(esperado: true)');

  // 3. ⚠️ TRAVA VENCIDA NÃO PRENDE NINGUÉM. É o caso do robô que morreu no meio:
  //    sem isto, o espelho pararia para sempre e o sintoma seria "parou de ir".
  await cli.query("update public.robos_travas set expira_em = now() - interval '1 second' where robo = 'prova'");
  const { rows: [d] } = await cli.query("select public.tomar_trava('prova', 120) as r");
  console.log('trava vencida:        ', d.r, '(esperado: true — ela nao pode prender)');

  // 4. o gatilho perdeu o freio: dispara sempre
  const { rows: [e2] } = await cli.query(
    "select prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace"
    + " where n.nspname='public' and p.proname='vessel_espelhar_agora'");
  console.log('freio de 20s no gatilho:', /20 seconds/.test(e2.prosrc) ? 'AINDA EXISTE — defeito' : 'saiu');

  // 5. o vigia responde
  const { rows: [f] } = await cli.query('select public.vessel_lista_atrasados(10) as r');
  console.log('vigia:', JSON.stringify(f.r).slice(0, 120));

  // 6. ⚠️ A PORTA PÚBLICA NÃO ALCANÇA A TRAVA
  for (const papel of ['anon', 'authenticated']) {
    const { rows: [g] } = await cli.query(
      "select has_function_privilege($1, 'public.tomar_trava(text,integer)', 'execute') as r", [papel]);
    console.log(`${papel} executa tomar_trava:`, g.r, '(esperado: false)');
  }
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
