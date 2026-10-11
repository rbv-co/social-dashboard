// Gera os vetores de relatorio_hora (relatorio_hora_vetores_dados_test.go): a cola do index.ts (leitura ->
// montagem) sobre o _shared/relatorio-por-hora.js REAL, no Node 22. O import é relativo a ESTE arquivo
// (import.meta.url resolve a partir de api/internal/meta/testdata), então roda de qualquer pasta:
//   node api/internal/meta/testdata/gerar-vetores-relatorio.mjs > api/internal/meta/relatorio_hora_vetores_dados_test.go
// Saída determinística (sementes fixas). Os vetores cobrem: o centavo do gasto de seguidores, a virada do dia
// (02:10 UTC = 23:10 em SP), só-seguidores, 8 aleatórios e 60 DIVERGENTES: cenários em que somar o gasto
// campanha por campanha direto no total do dia (soma plana) daria uma mensagem diferente de somar a hora
// primeiro e depois as horas (o que a edge faz; ver somaDoTipo em relatorio_hora.go).
// O _shared/relatorio-por-hora.js sai do repositório com a edge: os vetores já gerados ficam como estão.
import {
  agruparPorDiaEHora, montarMensagemWpp, leadsWppNoDia, gastoWppNoDia, montarMensagemSeguidores,
  deltaDeSeguidoresPorHora, seguidoresNaHora, seguidoresTotalNaHora, seguidoresNoDia,
  gastoSeguidoresNoDia, visitasPerfilNoDia,
} from '../../../../supabase/functions/_shared/relatorio-por-hora.js';

const GRUPO = '120363431546698175-group';
function todayBR(d) { return d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }); }
function horaBR(d) { return Number(d.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false })); }

function esperado(sc, plana = false) {
  const dia = todayBR(sc.agora), hora = horaBR(sc.agora);
  const linhas = sc.insights.filter((l) => l.dia === dia);
  const nomes = Object.fromEntries(sc.campanhas.map(([id, n]) => [id, n]));
  const agrupado = agruparPorDiaEHora(linhas, nomes);
  const horasDoDia = agrupado[0]?.horas ?? [];
  const daHora = horasDoDia.find((h) => h.hora === hora)?.campanhas ?? [];
  const leadsHoje = leadsWppNoDia(horasDoDia);
  // soma plana: campanha por campanha direto no total do dia (o que a edge NÃO faz); só para achar divergências
  const plano = (tipo) => horasDoDia.flatMap((h) => h.campanhas.filter((c) => c.tipo === tipo)).reduce((s, c) => s + c.gastoHora, 0);
  const gastoWppHoje = plana ? plano('wpp') : gastoWppNoDia(horasDoDia);
  const desde = new Date(sc.agora.getTime() - 25 * 3600 * 1000);
  const leituras = sc.leituras.filter((l) => new Date(l.lido_em) >= desde).sort((a, b) => new Date(a.lido_em) - new Date(b.lido_em));
  const deltas = deltaDeSeguidoresPorHora(leituras);
  const segDelta = seguidoresNaHora(deltas, dia, hora), segTotal = seguidoresTotalNaHora(deltas, dia, hora), segHoje = seguidoresNoDia(deltas, dia);
  const vis = sc.visitas.filter((v) => v.dia === dia);
  const visDelta = vis.find((v) => v.hora === hora)?.visitas_hora ?? null;
  const visHoje = visitasPerfilNoDia(vis, dia);
  const gastoSeg = daHora.filter((c) => c.tipo === 'seguidores').reduce((s, c) => s + c.gastoHora, 0);
  const gastoSegHoje = plana ? plano('seguidores') : gastoSeguidoresNoDia(horasDoDia);
  const msgs = [
    montarMensagemWpp(dia, hora, daHora, leadsHoje, gastoWppHoje),
    montarMensagemSeguidores(dia, hora, segDelta, visDelta, segTotal, segHoje, gastoSeg, gastoSegHoje, visHoje),
  ].filter(Boolean);
  if (!msgs.length) msgs.push(`⚠️ Relatório das ${String(hora).padStart(2, '0')}h, ${dia.slice(8, 10)}/${dia.slice(5, 7)} não saiu — sem dado disponível pra essa hora.`);
  return { dia, hora, msgs };
}

let seed = 20261010;
const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const r2 = (x) => Math.round(x * 100) / 100;
const iso = (d) => d.toISOString().replace('.000Z', 'Z');
const sp = (dia, hora, min) => new Date(Date.parse(`${dia}T${String(hora).padStart(2, '0')}:${String(min).padStart(2, '0')}:00-03:00`));

const camp = (id, nome) => [id, nome];
const cenarios = [];

// A: o centavo que virava (R$ 51,07 na edge): duas [+ SEGUIDORES], horas 12-14.
{
  const dia = '2026-10-10';
  const pares = { 12: [16.09, 5.73], 13: [33.95, 27.89], 14: [13.7, 4.79] };
  const insights = [];
  for (const [h, [a, b]] of Object.entries(pares)) {
    insights.push({ campaign_id: 's1', dia, hora: +h, gasto_hora: a, gasto_acumulado: a, conversas_hora: 0 });
    insights.push({ campaign_id: 's2', dia, hora: +h, gasto_hora: b, gasto_acumulado: b, conversas_hora: 0 });
  }
  cenarios.push({ nome: 'centavo_do_gasto_de_seguidores', agora: sp(dia, 14, 10),
    campanhas: [camp('s1', '[+ SEGUIDORES] Perfil A'), camp('s2', '[+ SEGUIDORES] Perfil B')], insights,
    leituras: [{ followers_count: 24300, lido_em: iso(sp(dia, 12, 5)), origem: 'hora' }, { followers_count: 24300, lido_em: iso(sp(dia, 13, 5)), origem: 'hora' },
      { followers_count: 24302, lido_em: iso(sp(dia, 14, 5)), origem: 'hora' }],
    visitas: [{ dia, hora: 12, visitas_hora: 1 }, { dia, hora: 14, visitas_hora: 1 }] });
}
// G: 02:10 UTC = 23:10 em São Paulo do dia ANTERIOR; isca no dia/hora do UTC.
{
  const agora = new Date('2026-10-10T02:10:00Z'); const dia = '2026-10-09';
  const insights = [
    { campaign_id: 'w1', dia, hora: 22, gasto_hora: 11.11, gasto_acumulado: 40.4, conversas_hora: 2 },
    { campaign_id: 'w1', dia, hora: 23, gasto_hora: 9.99, gasto_acumulado: 50.39, conversas_hora: 3 },
    { campaign_id: 's1', dia, hora: 23, gasto_hora: 4.5, gasto_acumulado: 20, conversas_hora: 0 },
    { campaign_id: 'w1', dia: '2026-10-10', hora: 2, gasto_hora: 77.77, gasto_acumulado: 77.77, conversas_hora: 9 },
    { campaign_id: 's1', dia: '2026-10-10', hora: 2, gasto_hora: 66.66, gasto_acumulado: 66.66, conversas_hora: 0 }];
  cenarios.push({ nome: 'virada_do_dia_2h10_utc_eh_23h10_de_sp', agora, campanhas: [camp('w1', '[CAMPANHA WPP] Leads'), camp('s1', '[+ SEGUIDORES] Perfil')], insights,
    leituras: [{ followers_count: 100, lido_em: '2026-10-10T01:05:00Z', origem: 'hora' }, { followers_count: 104, lido_em: '2026-10-10T02:05:00Z', origem: 'hora' },
      { followers_count: 999, lido_em: '2026-10-10T02:06:00Z', origem: 'diario' }],
    visitas: [{ dia, hora: 23, visitas_hora: 6 }, { dia, hora: 22, visitas_hora: 2 }, { dia: '2026-10-10', hora: 2, visitas_hora: 99 }] });
}
// H: só campanha de seguidores (a mensagem WPP não existe: sai uma só).
{
  const dia = '2026-10-10';
  cenarios.push({ nome: 'so_seguidores_sai_uma_mensagem', agora: sp(dia, 9, 10), campanhas: [camp('s1', '[+ SEGUIDORES] Perfil')],
    insights: [{ campaign_id: 's1', dia, hora: 9, gasto_hora: 8.25, gasto_acumulado: 8.25, conversas_hora: 0 }],
    leituras: [{ followers_count: 5000, lido_em: iso(sp(dia, 8, 5)), origem: 'hora' }, { followers_count: 5007, lido_em: iso(sp(dia, 9, 5)), origem: 'hora' }], visitas: [{ dia, hora: 9, visitas_hora: 3 }] });
}
// aleatórios (semente fixa)
for (let i = 0; i < 8; i++) {
  const dia = '2026-10-10', h = 3 + Math.floor(rnd() * 21);
  const cs = [['w1', '[CAMPANHA WPP] Leads'], ['w2', '[CAMPANHA WPP] Remarketing'], ['w3', '[CAMPANHA WPP] Lookalike'], ['s1', '[+ SEGUIDORES] Perfil'],
    ['s2', '[+ SEGUIDORES] Reels'], ['s3', '[+ SEGUIDORES] Stories'], ['e1', '[+ ENGAJAMENTO] Post'], ['o1', 'AXIOM']];
  const insights = [];
  for (const [id] of cs) { let ac = 0; for (let hh = Math.max(0, h - 6); hh <= h; hh++) {
    if (rnd() < 0.15) continue; const g = r2(0.5 + rnd() * 90); ac = r2(ac + g);
    insights.push({ campaign_id: id, dia, hora: hh, gasto_hora: g, gasto_acumulado: ac, conversas_hora: id[0] === 'w' ? Math.floor(rnd() * 7) : 0 }); } }
  let total = 20000 + Math.floor(rnd() * 5000); const leituras = [];
  for (let hh = Math.max(0, h - 6); hh <= h; hh++) { if (rnd() < 0.15 && hh !== h) continue; total += Math.floor(rnd() * 25) - 3;
    leituras.push({ followers_count: total, lido_em: iso(sp(dia, hh, 5)), origem: 'hora' }); }
  const visitas = []; for (let hh = Math.max(0, h - 6); hh <= h; hh++) if (rnd() < 0.8) visitas.push({ dia, hora: hh, visitas_hora: Math.floor(rnd() * 21) });
  cenarios.push({ nome: `aleatorio_${i + 1}_${String(h).padStart(2, '0')}h`, agora: sp(dia, h, 10), campanhas: cs.map(([a, b]) => camp(a, b)), insights, leituras, visitas });
}

// DIVERGENTES (semente própria, para não mexer nos 8 aleatórios acima): candidatos com gastos de 2 casas e
// seguidores/leads pares (o custo por unidade cai em meio centavo, onde 1 ULP da soma decide o arredondamento);
// fica o candidato cuja mensagem muda quando o gasto do dia é a soma plana.
let seed2 = 20261011;
const rnd2 = () => { seed2 |= 0; seed2 = (seed2 + 0x6d2b79f5) | 0; let t = Math.imul(seed2 ^ (seed2 >>> 15), 1 | seed2); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
let divergentes = 0;
for (let tentativa = 0; divergentes < 60; tentativa++) {
  if (tentativa > 2000000) throw new Error('não achei 60 cenários divergentes');
  const dia = '2026-10-10', h = 6 + Math.floor(rnd2() * 17);
  const tipo = rnd2() < 0.5 ? 'w' : 's';
  const nc = 2 + Math.floor(rnd2() * 3);
  const cs = Array.from({ length: nc }, (_, i) => [`${tipo}${i + 1}`, tipo === 'w' ? `[CAMPANHA WPP] Camp ${i + 1}` : `[+ SEGUIDORES] Camp ${i + 1}`]);
  const insights = [];
  for (const [id] of cs) { let ac = 0; for (let hh = Math.max(0, h - 5); hh <= h; hh++) {
    const g = r2(0.5 + rnd2() * 40); ac = r2(ac + g);
    insights.push({ campaign_id: id, dia, hora: hh, gasto_hora: g, gasto_acumulado: ac, conversas_hora: tipo === 'w' ? 1 + Math.floor(rnd2() * 3) : 0 }); } }
  const leituras = []; let total = 10000;
  for (let hh = Math.max(0, h - 5); hh <= h; hh++) { total += 2 * Math.floor(rnd2() * 4); leituras.push({ followers_count: total, lido_em: iso(sp(dia, hh, 5)), origem: 'hora' }); }
  const visitas = []; for (let hh = Math.max(0, h - 5); hh <= h; hh++) visitas.push({ dia, hora: hh, visitas_hora: 2 * Math.floor(rnd2() * 6) });
  const sc = { nome: `divergente_${String(divergentes + 1).padStart(2, '0')}_${tipo === 'w' ? 'wpp' : 'seguidores'}_${String(h).padStart(2, '0')}h`, agora: sp(dia, h, 10),
    campanhas: cs.map(([a, b]) => camp(a, b)), insights, leituras, visitas };
  if (JSON.stringify(esperado(sc).msgs) === JSON.stringify(esperado(sc, true).msgs)) continue;
  divergentes++;
  cenarios.push(sc);
}

const q = (s) => JSON.stringify(s).replace(/ /g, '\\u00a0');
const f = (n) => (Number.isInteger(n) ? n.toFixed(1) : String(n));
let go = `// Código gerado: vetores da edge (cola do index.ts sobre o _shared/relatorio-por-hora.js REAL, Node ${process.version}).
// Não editar à mão: gerado por api/internal/meta/testdata/gerar-vetores-relatorio.mjs (comando no cabeçalho dele).
package meta

var vetoresRelatorio = []vetorRelatorio{
`;
for (const sc of cenarios) {
  const e = esperado(sc);
  go += `\t{nome: ${q(sc.nome)}, agora: ${q(iso(sc.agora))}, dia: ${q(e.dia)}, hora: ${e.hora},\n`;
  go += `\t\tcampanhas: [][2]string{${sc.campanhas.map(([a, b]) => `{${q(a)}, ${q(b)}}`).join(', ')}},\n`;
  go += `\t\tinsights: []insightHora{\n${sc.insights.map((l) => `\t\t\t{${q(l.campaign_id)}, ${q(l.dia)}, ${l.hora}, ${f(l.gasto_hora)}, ${f(l.gasto_acumulado)}, ${l.conversas_hora}},`).join('\n')}\n\t\t},\n`;
  go += `\t\tleituras: []leituraFalsa{${sc.leituras.map((l) => `{${l.followers_count}, ${q(l.lido_em)}, ${q(l.origem)}}`).join(', ')}},\n`;
  go += `\t\tvisitas: []visitaFalsa{${sc.visitas.map((v) => `{${q(v.dia)}, ${v.hora}, ${v.visitas_hora}}`).join(', ')}},\n`;
  go += `\t\tmensagens: []string{\n${e.msgs.map((m) => `\t\t\t${q(m)},`).join('\n')}\n\t\t}},\n`;
}
go += '}\n';
process.stdout.write(go);
