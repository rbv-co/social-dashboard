#!/usr/bin/env node
// PREENCHER A LOJA DOS PEDIDOS ANTIGOS.
//
// O PROBLEMA: `bling_pedido_vendedor` é o cache que diz "este pedido foi da
// fulana". A coluna `loja_id` nasceu depois da maior parte do cache, e quem
// grava é a tela de Gestão à Vista — que só escreve pedido que ela BUSCOU. Como
// pedido já cacheado não é buscado de novo, os antigos ficam com loja NULA para
// sempre. Medido em 2026-08-05: 39 de 713 (5,5%).
//
// POR QUE ISSO IMPORTA: é esse campo que responde "de qual loja é esta
// vendedora" na hora de montar os times de venda (`lojaDaVendedora` em
// src/ferramentas/admin/vendedoras.js). Com 5,5% de cobertura o palpite é
// chute: hoje só 4 das 18 vendedoras têm loja conhecida.
//
// O QUE ELE FAZ: lê os pedidos sem loja, pergunta a loja de cada um ao Bling
// (`pedidos/vendas/{id}`, que já é caminho liberado no bling-proxy) e grava.
// NÃO inventa e NÃO sobrescreve: só toca em linha com `loja_id` nulo, e só
// quando o Bling responde uma loja. Rodar duas vezes não faz mal.
//
// Uso:
//   node preencher-loja-dos-pedidos.mjs                  # PRÉVIA, não grava nada
//   node preencher-loja-dos-pedidos.mjs --limite=40      # prévia de 40 (amostra)
//   node preencher-loja-dos-pedidos.mjs --gravar         # grava de verdade
//
// O Bling limita 3 chamadas por segundo; `blingProxy` já segura o ritmo em
// ~450ms, então 674 pedidos levam uns 5 minutos. Sem deps externas (Node 18+).

import './lib/carregar-env.mjs';
import { loginServico, blingProxy } from './lib/bling-comercial.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://supabase-desligado.invalid';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const REST = SUPABASE_URL + '/rest/v1';
const sb = { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY, 'Content-Type': 'application/json' };

const args = process.argv.slice(2);
const GRAVAR = args.includes('--gravar');
const LIMITE = Number((args.find((a) => a.startsWith('--limite=')) || '').split('=')[1]) || 0;

async function sbGet(caminho) {
  const r = await fetch(REST + caminho, { headers: sb });
  if (!r.ok) throw new Error(`GET ${caminho} -> ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

// Uma linha por vez, por `pedido_id`. PATCH e não upsert: upsert exigiria mandar
// a linha inteira de volta, e um campo esquecido apagaria dado bom.
async function gravarLoja(pedidoId, lojaId) {
  const r = await fetch(`${REST}/bling_pedido_vendedor?pedido_id=eq.${pedidoId}&loja_id=is.null`, {
    method: 'PATCH',
    headers: { ...sb, Prefer: 'return=minimal' },
    body: JSON.stringify({ loja_id: lojaId }),
  });
  if (!r.ok && ![200, 204].includes(r.status)) {
    throw new Error(`PATCH ${pedidoId} -> ${r.status} ${(await r.text()).slice(0, 200)}`);
  }
}

async function main() {
  if (!SERVICE_KEY) { console.error('✗ Falta SUPABASE_SERVICE_KEY (coletor/.env)'); process.exit(1); }

  const lojas = await sbGet('/bling_lojas?select=loja_id,nome');
  const nomeDaLoja = Object.fromEntries(lojas.map((l) => [String(l.loja_id), l.nome]));

  // Do mais recente para o mais antigo: se parar no meio, o que ficou pronto é
  // o que mais importa para dizer onde a pessoa trabalha HOJE.
  let caminho = '/bling_pedido_vendedor?loja_id=is.null&select=pedido_id,vendor_id,pedido_data'
    + '&order=pedido_data.desc.nullslast';
  if (LIMITE) caminho += `&limit=${LIMITE}`;
  const pendentes = await sbGet(caminho);

  console.log(`${pendentes.length} pedido(s) sem loja.${GRAVAR ? '' : '  (PRÉVIA — nada será gravado)'}`);
  if (!pendentes.length) return;

  const token = await loginServico();
  const conta = {};
  let achou = 0; let semLoja = 0; let erro = 0;

  for (let i = 0; i < pendentes.length; i++) {
    const p = pendentes[i];
    let lojaId = null;
    try {
      const resp = await blingProxy(token, 'pedidos/vendas/' + p.pedido_id, {});
      lojaId = resp?.data?.loja?.id ?? null;
    } catch (e) {
      erro++;
      console.log(`  ! pedido ${p.pedido_id}: ${String(e.message).slice(0, 120)}`);
      continue;
    }
    if (lojaId == null) { semLoja++; continue; }

    achou++;
    conta[lojaId] = (conta[lojaId] || 0) + 1;
    if (GRAVAR) await gravarLoja(p.pedido_id, lojaId);

    if ((i + 1) % 25 === 0 || i === pendentes.length - 1) {
      console.log(`  ${i + 1}/${pendentes.length} — com loja: ${achou} · sem loja no Bling: ${semLoja} · erro: ${erro}`);
    }
  }

  console.log('\nPor loja:');
  for (const [id, n] of Object.entries(conta).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)} · ${nomeDaLoja[id] || 'loja ' + id} (${id})`);
  }
  console.log(GRAVAR
    ? `\n✓ Gravado. ${achou} pedido(s) ganharam loja.`
    : `\nPrévia. Rode de novo com --gravar para valer (${achou} pedido(s) ganhariam loja).`);
}

main().catch((e) => { console.error('✗ ' + e.message); process.exit(1); });
