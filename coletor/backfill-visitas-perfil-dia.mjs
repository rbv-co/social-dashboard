#!/usr/bin/env node
// coletor/backfill-visitas-perfil-dia.mjs
// Preenche visitas_perfil_dia pra trás — sem isso, só "ontem em diante" (o
// que o fechamento já rodou) tem cache, e os atalhos "7 dias"/"30 dias" da
// tela cairiam de volta pro cálculo por hora (com o buraco) pros dias mais
// antigos. Idempotente (upsert por dia) — rodar de novo não duplica.
//
// Uso: node coletor/backfill-visitas-perfil-dia.mjs [--dias=30]
import './lib/carregar-env.mjs';
import { visitasPerfilDoDiaMeta, salvarVisitasPerfilDoDia } from './lib/visitas-perfil-meta.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://kounqtdoioootxqegkij.supabase.co';
const SK = process.env.SUPABASE_SERVICE_KEY;
const REST = SUPABASE_URL + '/rest/v1';
const H = { apikey: SK, Authorization: 'Bearer ' + SK, 'Content-Type': 'application/json' };
const CONTA_VESSEL = 'b6883e82-07cb-4f21-9fd7-ea7626786174';

const argDias = process.argv.find((a) => a.startsWith('--dias='));
const DIAS = argDias ? Number(argDias.split('=')[1]) : 30;

function hojeBR() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}
function somarDias(iso, delta) {
  const [ano, mes, dia] = iso.split('-').map(Number);
  const d = new Date(Date.UTC(ano, mes - 1, dia, 12));
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const r = await fetch(`${REST}/accounts?select=instagram_id,access_token&id=eq.${CONTA_VESSEL}`, { headers: H });
  if (!r.ok) throw new Error('GET accounts ' + r.status);
  const [{ instagram_id: igId, access_token: token }] = await r.json();

  const hoje = hojeBR();
  // Só dias FECHADOS — "hoje" ainda não fechou, o fechamento nunca roda pra
  // ele (mesma regra de coletor/gerar-opr-diario.mjs).
  for (let i = 1; i <= DIAS; i++) {
    const dia = somarDias(hoje, -i);
    try {
      const visitas = await visitasPerfilDoDiaMeta(igId, token, dia);
      await salvarVisitasPerfilDoDia(REST, H, CONTA_VESSEL, dia, visitas);
      console.log(`✓ ${dia}: ${visitas} visitas`);
    } catch (e) {
      console.error(`✗ ${dia}: ${e.message}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
