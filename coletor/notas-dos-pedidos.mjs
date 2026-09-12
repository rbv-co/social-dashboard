#!/usr/bin/env node
// Robô Notas dos Pedidos — descobre em que dia cada venda foi FATURADA e grava
// em public.bling_pedido_nota.
//
// POR QUE ELE EXISTE
// A dashboard lança a venda na data do PEDIDO. Só que o pedido é gerado num dia
// e a nota sai em outro: a loja emite NFC-e no mesmo dia, o Atacado emite NF-e
// no dia seguinte. Medido em 11/08/2026, nos 30 dias anteriores, 18 pedidos
// somando R$ 19.375,69 caíram um dia antes do dia certo.
//
// ESTE ROBÔ NÃO MUDA NENHUM NÚMERO NA TELA. Ele só guarda a data certa. Quem
// passa a ler é uma etapa seguinte, separada e reversível.
//
// Uso:
//   node notas-dos-pedidos.mjs                # dia a dia: pedidos mexidos nos últimos 7 dias
//   node notas-dos-pedidos.mjs --dias=15      # janela maior
//   node notas-dos-pedidos.mjs --backfill=12  # os últimos 12 meses (uma vez)
//   node notas-dos-pedidos.mjs --previa       # não grava nada, só mostra o que faria
//
// Idempotente: rodar de novo regrava por cima (upsert por pedido_id). Sem deps
// externas — fetch nativo (Node 18+).

import './lib/carregar-env.mjs';   // popula process.env ANTES de importar a lib
import { pathToFileURL } from 'node:url';
import { loginServico, blingProxy } from './lib/bling-comercial.mjs';
import { mesesRange } from './relatorios-comerciais.mjs';
import { montarLinha, impactoPorMes, indiceDeNotas, notaPorId, idDaNota } from './lib/notas-bling.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://kounqtdoioootxqegkij.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const REST = SUPABASE_URL + '/rest/v1';
const sb = { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY, 'Content-Type': 'application/json' };

const SITUACAO_ATENDIDO = 9;   // é o que a dashboard conta hoje; não mudamos essa régua aqui
const brl = (v) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dia = (d) => d.toISOString().slice(0, 10);

// ── Pedidos MEXIDOS numa janela (é assim que aparece o pedido antigo que só
// hoje virou Atendido — o nº2372 era de 27/07 e foi concluído em 11/08).
//
// ⚠️ A borda do filtro de data do Bling não é confiável (ver a armadilha em
// lib/notas-bling.mjs). Por isso a janela é folgada e o robô é idempotente:
// reler o mesmo pedido duas vezes não custa nada; perder um custa caro.
async function pedidosAlterados(token, dataInicial, dataFinal) {
  const todos = [];
  for (let pagina = 1; pagina <= 30; pagina++) {
    const r = await blingProxy(token, 'pedidos/vendas', {
      dataAlteracaoInicial: dataInicial + ' 00:00:00',
      dataAlteracaoFinal: dataFinal + ' 23:59:59',
      pagina, limite: 100,
    });
    const arr = r?.data || [];
    todos.push(...arr);
    if (arr.length < 100) break;
  }
  return todos.filter(p => p?.situacao?.id === SITUACAO_ATENDIDO);
}

// ── Pedidos atendidos de um período, pela data do pedido (usado no backfill) ──
async function pedidosDoPeriodo(token, dataInicial, dataFinal) {
  const todos = [];
  for (let pagina = 1; pagina <= 30; pagina++) {
    const r = await blingProxy(token, 'pedidos/vendas', {
      dataInicial, dataFinal, 'idsSituacoes[]': SITUACAO_ATENDIDO, pagina, limite: 100,
    });
    const arr = r?.data || [];
    todos.push(...arr);
    if (arr.length < 100) break;
  }
  return todos;
}

async function upsert(rows, previa) {
  if (!rows.length) return;
  if (previa) return;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const r = await fetch(`${REST}/bling_pedido_nota?on_conflict=pedido_id`, {
      method: 'POST',
      headers: { ...sb, Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(chunk),
    });
    if (!r.ok && ![200, 201, 204].includes(r.status)) {
      throw new Error(`upsert bling_pedido_nota -> ${r.status} ${(await r.text()).slice(0, 200)}`);
    }
  }
}

// ── Para cada pedido: acha a nota e monta a linha ──
async function linhasDosPedidos(token, pedidos, indice, log) {
  const linhas = [];
  let comNota = 0, semNota = 0, buscadasUmaAUma = 0, naoAbriu = 0;
  const pendentes = [];
  for (const [i, p] of pedidos.entries()) {
    let notaId = null;
    try {
      const det = await blingProxy(token, `pedidos/vendas/${p.id}`, {});
      notaId = idDaNota(det);   // trata o "id: 0" que o Bling manda p/ pedido sem nota
    } catch (e) {
      naoAbriu++;
      log(`    pedido ${p.id} não abriu (segue): ${e.message.slice(0, 70)}`);
      continue;
    }
    let nota = null;
    if (notaId != null) {
      nota = indice.get(Number(notaId)) || null;
      if (!nota) { nota = await notaPorId(blingProxy, token, notaId); buscadasUmaAUma++; }
      if (nota) {
        nota = { ...nota, id: Number(notaId) };
        comNota++;
      } else {
        // O pedido TEM nota e não consegui ler. Gravar aqui seria escrever
        // "sem nota" — e "sem nota" faz a venda ficar no dia do pedido, que é
        // exatamente o erro que este robô existe para corrigir. Então NÃO grava:
        // fica pendente e a próxima rodada tenta de novo. Silêncio é melhor que
        // número errado que ninguém desconfia.
        pendentes.push({ pedido: p.numero ?? p.id, nota: notaId });
        log(`    pedido nº${p.numero ?? p.id}: nota ${notaId} não abriu — NÃO gravado, fica p/ a próxima rodada`);
        continue;
      }
    } else {
      semNota++;
    }
    linhas.push(montarLinha(p, nota));
    if ((i + 1) % 50 === 0) log(`    ${i + 1}/${pedidos.length} pedidos…`);
  }
  return { linhas, comNota, semNota, buscadasUmaAUma, naoAbriu, pendentes };
}

function mostrarImpacto(linhas) {
  const imp = impactoPorMes(linhas);
  const meses = Object.keys(imp).sort();
  if (!meses.length) return;
  console.log('\n── O que muda se a venda passar a contar pelo dia da NOTA ──');
  console.log('mês      | como está hoje   | pelo dia da nota | diferença        | pedidos que mudam de dia');
  for (const m of meses) {
    const x = imp[m];
    console.log(
      `${m}  | ${brl(x.pelo_pedido).padStart(16)} | ${brl(x.pela_nota).padStart(16)} | ` +
      `${(x.diferenca >= 0 ? '+' : '') + brl(x.diferenca).padStart(15)} | ${x.movidos}`
    );
  }
  const movidos = linhas.filter(l => l.data_da_nota && l.data_da_nota !== l.data_pedido);
  const soma = movidos.reduce((s, l) => s + Number(l.total || 0), 0);
  console.log(`\nTotal: ${movidos.length} pedidos mudam de dia, somando ${brl(soma)}.`);
  const sem = linhas.filter(l => l.nota_id == null);
  if (sem.length) console.log(`${sem.length} pedido(s) atendido(s) SEM nota — esses ficam no dia do pedido, como hoje.`);
}

async function main() {
  if (!SERVICE_KEY) { console.error('✗ Falta SUPABASE_SERVICE_KEY'); process.exit(1); }
  const arg = (nome) => (process.argv.find(a => a.startsWith(`--${nome}=`)) || '').split('=')[1];
  const backfill = Number(arg('backfill')) || 0;
  const dias = Number(arg('dias')) || 7;
  const previa = process.argv.includes('--previa');
  if (previa) console.log('PRÉVIA: nada será gravado.\n');

  const token = await loginServico();
  const todasAsLinhas = [];

  if (backfill > 0) {
    const meses = mesesRange(backfill);
    console.log(`→ Backfill de ${meses.length} mês(es) [${meses[0].ini} .. ${meses.at(-1).fim}]`);
    for (const { ini, fim } of meses) {
      const pedidos = await pedidosDoPeriodo(token, ini, fim);
      console.log(`  ${ini.slice(0, 7)}: ${pedidos.length} pedidos atendidos`);
      if (!pedidos.length) continue;
      // Janela do índice folgada dos dois lados: a nota pode sair depois do mês
      // e a borda de baixo do filtro do Bling escapa.
      const antes = dia(new Date(new Date(ini + 'T12:00:00').getTime() - 5 * 864e5));
      const depois = dia(new Date(new Date(fim + 'T12:00:00').getTime() + 15 * 864e5));
      const indice = await indiceDeNotas(blingProxy, token, antes, depois, console.log);
      const r = await linhasDosPedidos(token, pedidos, indice, console.log);
      console.log(`    ${r.comNota} com nota · ${r.semNota} sem nota · ${r.buscadasUmaAUma} buscadas uma a uma · ${r.pendentes.length} pendente(s) · ${r.naoAbriu} pedido(s) que não abriram`);
      await upsert(r.linhas, previa);
      todasAsLinhas.push(...r.linhas);
    }
  } else {
    const hoje = new Date();
    const de = dia(new Date(hoje.getTime() - dias * 864e5));
    const ate = dia(hoje);
    console.log(`→ Pedidos mexidos entre ${de} e ${ate}`);
    const pedidos = await pedidosAlterados(token, de, ate);
    console.log(`  ${pedidos.length} pedidos atendidos na janela`);
    const indice = await indiceDeNotas(blingProxy, token, dia(new Date(hoje.getTime() - (dias + 40) * 864e5)), ate, console.log);
    const r = await linhasDosPedidos(token, pedidos, indice, console.log);
    console.log(`  ${r.comNota} com nota · ${r.semNota} sem nota · ${r.buscadasUmaAUma} buscadas uma a uma · ${r.pendentes.length} pendente(s) · ${r.naoAbriu} pedido(s) que não abriram`);
    await upsert(r.linhas, previa);
    todasAsLinhas.push(...r.linhas);
  }

  mostrarImpacto(todasAsLinhas);
  console.log(`\n✓ ${todasAsLinhas.length} pedido(s) ${previa ? 'conferido(s), nada gravado' : 'gravado(s)'}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch(e => { console.error('Erro:', e.message); process.exit(1); });
}
