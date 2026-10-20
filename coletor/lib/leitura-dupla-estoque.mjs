// Leitura dupla do estoque: `gc_estoque_item` (Central) × `estoque_depositos` (espelho do Core), só medindo.
//
// A Central segue servindo o dado dela; isto só compara e devolve o relatório. A chave da Central é
// `codigo || id` (relatorios-comerciais.mjs:272), então o casamento é por id do produto (estoque-por-id.mjs).
// Escopo: só os depósitos que o Core espelha (hoje 4 dos 7); linha da Central em depósito fora do Core
// não é comparável e entra em `foraDoCore`, não em divergência.
// Ausente = 0 nos dois lados (a Central nunca zera e o Core guarda a linha zerada): só conta divergência
// quando o lado que tem a linha traz saldo diferente de zero.
import { indiceDeProdutos, idDoProdutoPelaChave } from './estoque-por-id.mjs';

const AMOSTRA = 5;
const n = (v) => Number(v) || 0;
const arred = (v) => Math.round(n(v));   // o mesmo arredondamento que o robô da Central aplica

/**
 * central: linhas de gc_estoque_item {deposito_id, sku, saldo}; produtos: `produtos_bling` do espelho
 * {id_bling, codigo, id_situacaocadastro}; saldosCore: `estoque_depositos` {id_bling, deposito_id, saldo}.
 */
export function compararEstoque({ central, produtos, saldosCore }) {
  const depCore = new Set(saldosCore.map((s) => String(s.deposito_id)));
  const doCore = new Map(saldosCore.map((s) => [`${s.id_bling}|${s.deposito_id}`, arred(s.saldo)]));
  const idx = indiceDeProdutos(produtos);
  const r = { iguais: 0, diferentes: [], centralNaoZerou: [], soCentral: [], soCore: [], semPar: [], foraDoCore: 0 };
  const vistas = new Set();
  for (const c of central) {
    const dep = String(c.deposito_id);
    const saldo = n(c.saldo);
    if (!depCore.has(dep)) { if (saldo !== 0) r.foraDoCore += 1; continue; }
    const id = idDoProdutoPelaChave(c.sku, idx);
    if (!id) { if (saldo !== 0) r.semPar.push({ sku: c.sku, deposito: dep, central: saldo }); continue; }
    const chave = `${id}|${dep}`;
    vistas.add(chave);
    const core = doCore.get(chave);
    if (core === undefined) { saldo !== 0 ? r.soCentral.push({ sku: c.sku, id, deposito: dep, central: saldo }) : r.iguais++; continue; }
    if (core === saldo) r.iguais++;
    else if (core === 0) r.centralNaoZerou.push({ sku: c.sku, id, deposito: dep, central: saldo });   // o robô só grava o que o Bling lista com saldo
    else r.diferentes.push({ sku: c.sku, id, deposito: dep, central: saldo, core });
  }
  for (const [chave, saldo] of doCore) {
    if (saldo === 0 || vistas.has(chave)) continue;
    const [id, deposito] = chave.split('|');
    r.soCore.push({ id, deposito, core: saldo });
  }
  return r;
}

const amostra = (l) => JSON.stringify(l.slice(0, AMOSTRA));

/** A linha de log estruturado (mesmo formato da leitura dupla de pedidos). */
export function linhaDeLog(r, { depositos, centralAtualizadoAte, sincroniaInformada }) {
  const ok = !r.diferentes.length && !r.centralNaoZerou.length && !r.soCentral.length && !r.soCore.length && !r.semPar.length;
  return `leitura dupla tabela=estoque_depositos depositos_core=${depositos} iguais=${r.iguais} diferentes=${r.diferentes.length}`
    + ` central_nao_zerou=${r.centralNaoZerou.length} so_central=${r.soCentral.length} so_core=${r.soCore.length} sem_par=${r.semPar.length} fora_do_core=${r.foraDoCore}`
    + ` central_atualizado_ate=${centralAtualizadoAte} sincronia_informada=${sincroniaInformada} resultado=${ok ? 'limpa' : 'divergente'}`
    + ` amostra_diferentes=${amostra(r.diferentes)} amostra_central_nao_zerou=${amostra(r.centralNaoZerou)} amostra_so_central=${amostra(r.soCentral)}`
    + ` amostra_so_core=${amostra(r.soCore)} amostra_sem_par=${amostra(r.semPar)}`;
}
