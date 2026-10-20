#!/usr/bin/env node
// coletor/leitura-dupla-estoque.mjs
//
// D2 do plano 04: compara o estoque da Central (`gc_estoque_item`) com o espelho do Core (`estoque_depositos`)
// e escreve UMA linha de log estruturado. Só mede: transação READ ONLY, nada é gravado, a Central continua
// servindo o dado dela. Desligado por padrão: só roda com `CORE_LEITURA_ESTOQUE_DEPOSITOS=true`.
//
//   CORE_LEITURA_ESTOQUE_DEPOSITOS=true node coletor/leitura-dupla-estoque.mjs
//
// Core fora do ar, lento, 429 ou resposta inesperada: o processo falha (exit 1) SEM registrar divergência.
// Core `atrasado`/defasado (bloco `sincronia`): registra `resultado=defasado` e não conta divergência.
import './lib/carregar-env.mjs';
import pg from 'pg';
import { ligada, clienteDoAmbiente, idadeDoEspelho, limiteDeIdadeMin } from '../supabase/functions/_shared/core-leitura.js';
import { compararEstoque, linhaDeLog } from './lib/leitura-dupla-estoque.mjs';

if (!ligada('ESTOQUE_DEPOSITOS', process.env)) {
  console.log('leitura dupla do estoque desligada (CORE_LEITURA_ESTOQUE_DEPOSITOS).');
  process.exit(0);
}

const core = clienteDoAmbiente(process.env);
const cli = new pg.Client({ connectionString: process.env.DATABASE_URL });
await cli.connect();
try {
  await cli.query('begin read only');
  const { rows: central } = await cli.query('select deposito_id, sku, saldo, atualizado_em from gc_estoque_item');
  await cli.query('rollback');
  const [{ linhas: produtos }, { linhas: saldosCore, sincronia }] = await Promise.all([
    core.todas('produtos_bling', { campos: ['id_bling', 'codigo', 'id_situacaocadastro'] }),
    core.todas('estoque_depositos', { campos: ['id_bling', 'deposito_id', 'saldo'] }),
  ]);
  if (!saldosCore.length) throw new Error('core: espelho sem linhas de estoque_depositos');
  const atualizadoAte = central.reduce((m, c) => (c.atualizado_em > m ? c.atualizado_em : m), new Date(0)).toISOString();
  const idade = idadeDoEspelho(sincronia, { maxIdadeMin: limiteDeIdadeMin(process.env, 'estoque_depositos') });
  if (idade.defasado) {
    console.warn(`leitura dupla tabela=estoque_depositos resultado=defasado motivo="${idade.motivo}" central_atualizado_ate=${atualizadoAte}`);
  } else {
    const r = compararEstoque({ central, produtos, saldosCore });
    const depositos = new Set(saldosCore.map((s) => String(s.deposito_id))).size;
    const linha = linhaDeLog(r, { depositos, centralAtualizadoAte: atualizadoAte, sincroniaInformada: !!sincronia });
    (linha.includes('resultado=limpa') ? console.log : console.warn)(linha);
  }
} finally {
  await cli.end();
}
