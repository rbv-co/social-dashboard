// TRAZ AS VENDAS DO BLING, PEDIDO A PEDIDO.
//
//   node coletor/trazer-pedidos-do-bling.mjs              # janela de 30 dias
//   node coletor/trazer-pedidos-do-bling.mjs --dias=90
//   node coletor/trazer-pedidos-do-bling.mjs --ensaio     # lê e não grava
//
// ⚠️ POR QUE ESTE ROBÔ EXISTE
// A venda, no nosso banco, só existia como TOTAL DO MÊS por loja por SKU
// (`gc_vendas_item`). Não havia pedido, não havia cliente, não havia telefone —
// e não era coluna vazia: era coluna que não existia. Sem isto, a T07, a T08 e
// a T09 do Growth Plan não têm do que se alimentar. Mesmo que a loja preencha a
// cliente com capricho no Bling, o dado não chegava até aqui.
//
// ⚠️ A CHAVE NÃO É O TELEFONE — medido no Bling em 17/09/2026
// O pedido do Bling NÃO TRAZ telefone, nem na lista nem no detalhe. Traz
// `contato.id`, nome, tipo de pessoa e CPF. Então o casamento tem duas escadas:
//
//   1. `bling_contato_id` — EXATO. O robô do espelho já cria a ficha do lead no
//      Bling; no dia da venda a loja escolhe essa ficha, e o pedido vem com o
//      mesmo id. Sem fuzzy.
//   2. o telefone da FICHA (`contatos/<id>`), normalizado. Para quem comprou
//      sem ter passado por nós antes.
//
// Medido em 400 pedidos de 90 dias: TODOS têm contato (nenhum pedido anônimo) e
// 88% das fichas têm telefone aproveitável.
//
// ⚠️ ELE NÃO CRIA PESSOA. Só LIGA a pedido de quem já existe em
// `vessel_pessoas` — quem chegou por uma landing page ou pelo Appointment Card.
// Trazer as 341 compradoras do Bling para cá seria copiar dado de gente de uma
// tabela para outra sem ninguém ter decidido isso. Para contar compradoras, o
// painel usa `bling_contato_id` distinto, que responde a mesma pergunta sem
// duplicar ninguém.
//
// ⚠️ VENDA ÓRFÃ É UM FATO A MEDIR, NÃO UM ERRO A ESCONDER. Pedido que não casa
// com ninguém entra com `pessoa_id` nulo, e o robô diz quantos foram.
import './lib/carregar-env.mjs';
import pg from 'pg';
import { loginServico, blingProxy } from './lib/bling-comercial.mjs';
import { aplicarValorCorrigido } from '../supabase/functions/_shared/valor-corrigido.js';
import { ajustesDeValor } from './lib/ajustes-de-valor.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://kounqtdoioootxqegkij.supabase.co';
const BLING = 'https://api.bling.com.br/Api/v3';
const ATENDIDO = 9;                       // a situação que conta como venda
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

const arg = (nome, padrao) => {
  const a = process.argv.find((x) => x.startsWith(`--${nome}=`));
  return a ? a.split('=')[1] : padrao;
};
const dias = Number(arg('dias', 30));
const ensaio = process.argv.includes('--ensaio');
const iso = (d) => d.toISOString().slice(0, 10);

/** Telefone do jeito que o resto do sistema guarda: só dígitos, com o país. */
function telefoneCanonico(bruto) {
  const d = String(bruto || '').replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) return '55' + d;
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) return d;
  return null;
}

const cli = new pg.Client({ connectionString: process.env.DATABASE_URL });
await cli.connect();

try {
  const { rows: [tk] } = await cli.query(
    'select access_token from bling_tokens order by id desc limit 1');
  if (!tk?.access_token) throw new Error('não há token do Bling guardado.');

  const token = await loginServico();
  const ate = new Date();
  const de = new Date(ate); de.setDate(de.getDate() - dias);
  console.log(`\njanela: ${iso(de)} a ${iso(ate)}${ensaio ? '  (ENSAIO — nada será gravado)' : ''}\n`);

  // ── 1. os pedidos atendidos da janela ──────────────────────────────────────
  const pedidos = [];
  for (let pagina = 1; pagina <= 20; pagina++) {
    const r = await blingProxy(token, 'pedidos/vendas',
      { dataInicial: iso(de), dataFinal: iso(ate), 'idsSituacoes[]': ATENDIDO, pagina, limite: 100 });
    const d = r.data || [];
    pedidos.push(...d);
    if (d.length < 100) break;
  }
  console.log(`${pedidos.length} pedidos atendidos no Bling`);

  // ── 2. quem já conhecemos ──────────────────────────────────────────────────
  const { rows: pessoas } = await cli.query(
    'select id, telefone, bling_contato_id from vessel_pessoas');
  const porContato = new Map(pessoas.filter((p) => p.bling_contato_id)
    .map((p) => [String(p.bling_contato_id), p.id]));
  const porTelefone = new Map(pessoas.map((p) => [p.telefone, p.id]));
  console.log(`${pessoas.length} pessoas conhecidas (${porContato.size} já com ficha do Bling ligada)`);

  // ── 3. o valor corrigido, pela MESMA regra das telas ───────────────────────
  const chave = process.env.SUPABASE_SERVICE_KEY;
  const ajustes = await ajustesDeValor(SUPABASE_URL, chave);
  const { pedidos: comValor } = aplicarValorCorrigido(pedidos, ajustes);
  const corrigidoPorId = new Map(comValor.filter((p) => p.valorAjustado)
    .map((p) => [String(p.id), p.total]));

  // ── 4. a data da venda, que a casa JÁ calculou ─────────────────────────────
  // ⚠️ COPIAR, NÃO RECALCULAR. `bling_pedido_nota.data_da_venda` é o número que
  // a Gestão à Vista e os relatórios usam. Derivar o meu daria um segundo
  // número, parecido e não igual — e um dia alguém perguntaria por que o painel
  // da Vessel diz 12 e o comercial diz 14.
  const { rows: notas } = await cli.query(
    'select pedido_id, data_da_nota, data_da_venda, origem_da_data from bling_pedido_nota');
  const notaPorPedido = new Map(notas.map((n) => [String(n.pedido_id), n]));

  // ── 5. cada pedido ─────────────────────────────────────────────────────────
  const telefoneDoContato = new Map();   // cache da rodada: uma leitura por ficha
  let gravados = 0, orfaos = 0, porFicha = 0, porTel = 0, semTelefone = 0;

  for (const p of pedidos) {
    const detalhe = (await blingProxy(token, `pedidos/vendas/${p.id}`, {})).data || {};
    const contatoId = p.contato?.id ? String(p.contato.id) : null;

    // ── o casamento, nas duas escadas ──
    let pessoaId = contatoId ? porContato.get(contatoId) || null : null;
    let casouPor = pessoaId ? 'bling_contato' : null;

    if (!pessoaId && contatoId) {
      if (!telefoneDoContato.has(contatoId)) {
        await espera(380);                         // o Bling limita 3 por segundo
        const r = await fetch(`${BLING}/contatos/${contatoId}`, {
          headers: { Authorization: 'Bearer ' + tk.access_token, Accept: 'application/json' } });
        const ficha = r.ok ? (await r.json())?.data || {} : {};
        // ⚠️ OS DOIS CAMPOS. A ficha criada pela loja no PDV preenche
        // `telefone`; a criada pelo nosso robô preenche `celular`. Ler só um
        // perde metade — e perde calado.
        telefoneDoContato.set(contatoId, telefoneCanonico(ficha.celular || ficha.telefone));
      }
      const tel = telefoneDoContato.get(contatoId);
      if (!tel) semTelefone++;
      else if (porTelefone.has(tel)) {
        pessoaId = porTelefone.get(tel);
        casouPor = 'telefone';
        // Da próxima vez o casamento é exato: a ficha fica ligada à pessoa.
        if (!ensaio) {
          await cli.query(
            'update vessel_pessoas set bling_contato_id = $1 where id = $2 and bling_contato_id is null',
            [contatoId, pessoaId]);
          porContato.set(contatoId, pessoaId);
        }
      }
    }

    if (pessoaId) { casouPor === 'bling_contato' ? porFicha++ : porTel++; } else { orfaos++; }
    if (ensaio) continue;

    const { rows: [linha] } = await cli.query(
      `insert into vessel_pedidos
         (bling_pedido_id, numero, bling_contato_id, contato_nome, pessoa_id, casou_por,
          loja_id, vendedor_id, data_do_pedido, data_da_nota, data_da_venda, origem_da_data,
          total_produtos, desconto, outras_despesas, total_do_bling, total_corrigido, situacao_id,
          observacoes, observacoes_internas)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
       on conflict (bling_pedido_id) do update set
          numero = excluded.numero, bling_contato_id = excluded.bling_contato_id,
          contato_nome = excluded.contato_nome,
          -- ⚠️ Nunca DESLIGAR um casamento que já existe: se esta rodada não
          -- casou (a pessoa pode ter sido apagada da memória local), o que já
          -- estava ligado continua.
          pessoa_id = coalesce(excluded.pessoa_id, vessel_pedidos.pessoa_id),
          casou_por = coalesce(excluded.casou_por, vessel_pedidos.casou_por),
          loja_id = excluded.loja_id, vendedor_id = excluded.vendedor_id,
          data_do_pedido = excluded.data_do_pedido, data_da_nota = excluded.data_da_nota,
          data_da_venda = excluded.data_da_venda, origem_da_data = excluded.origem_da_data,
          total_produtos = excluded.total_produtos, desconto = excluded.desconto,
          outras_despesas = excluded.outras_despesas,
          total_do_bling = excluded.total_do_bling, total_corrigido = excluded.total_corrigido,
          situacao_id = excluded.situacao_id,
          -- As observações são o que a vendedora escreve no pedido — é onde
          -- mora a marca PRESENTE (vessel_pedido_marcado_presente). Sempre
          -- atualizadas: a loja pode editar o pedido depois de gravado.
          observacoes = excluded.observacoes, observacoes_internas = excluded.observacoes_internas,
          atualizado_em = now()
       returning id`,
      [p.id, String(p.numero ?? ''), contatoId, p.contato?.nome || null, pessoaId, casouPor,
       detalhe.loja?.id || null, detalhe.vendedor?.id || null,
       String(p.data).slice(0, 10),
       notaPorPedido.get(String(p.id))?.data_da_nota || null,
       // Sem linha na tabela da nota, a venda conta no dia do pedido — que é a
       // regra da casa para pedido que ainda não virou nota.
       notaPorPedido.get(String(p.id))?.data_da_venda || String(p.data).slice(0, 10),
       notaPorPedido.get(String(p.id))?.origem_da_data || 'pedido',
       detalhe.totalProdutos ?? p.totalProdutos ?? null,
       detalhe.desconto?.valor ?? null, detalhe.outrasDespesas ?? null,
       p.total ?? null, corrigidoPorId.get(String(p.id)) ?? null,
       p.situacao?.id ?? ATENDIDO,
       detalhe.observacoes || null, detalhe.observacoesInternas || null]);

    // Os itens são REFEITOS a cada rodada: pedido editado no Bling muda de
    // itens, e acrescentar deixaria os antigos ali para sempre.
    await cli.query('delete from vessel_pedido_itens where pedido_id = $1', [linha.id]);
    for (const it of detalhe.itens || []) {
      // ⚠️ `it.desconto` DO BLING É PORCENTAGEM, NÃO REAIS. Medido em
      // 17/09/2026: em 21 de 1.125 itens ele é MAIOR que o valor do próprio
      // item — em reais isso seria pagar para a cliente levar. Subtraindo como
      // dinheiro, um item de R$ 97,80 saía por R$ 0,80.
      //
      // Por isso a coluna se chama `desconto_percentual` e o total vai JÁ
      // CALCULADO: quem for somar receita não precisa saber da pegadinha.
      const quantidade = Number(it.quantidade ?? 0);
      const unitario = Number(it.valor ?? 0);
      const percentual = Number(it.desconto ?? 0);
      const totalDoItem = Math.round(quantidade * unitario * (1 - percentual / 100) * 100) / 100;
      await cli.query(
        `insert into vessel_pedido_itens
           (pedido_id, sku, descricao, quantidade, valor_unitario, desconto_percentual, total_do_item)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [linha.id, it.codigo || it.produto?.codigo || null, it.descricao || null,
         it.quantidade ?? null, it.valor ?? null, it.desconto ?? null, totalDoItem]);
    }
    // ⚠️ A RECEITA LÍQUIDA É CALCULADA AQUI, depois dos itens, porque ela
    // DEPENDE deles — e porque o `total` do Bling NÃO é esse número: ele não
    // desconta o desconto do item e sai ~6% maior (medido: R$ 161.545 contra
    // R$ 151.370 em 90 dias). Quem somasse a coluna errada erraria calado.
    //
    // Ajuste manual VENCE: quando a nota autorizada congelou o pedido errado, o
    // valor corrigido é o dinheiro de verdade.
    await cli.query(
      `update vessel_pedidos p
          set receita_liquida = round(greatest(
                coalesce(p.total_corrigido,
                         (select coalesce(sum(i.total_do_item), 0) from vessel_pedido_itens i
                           where i.pedido_id = p.id) - coalesce(p.desconto, 0)),
                0), 2)
        where p.id = $1`, [linha.id]);
    gravados++;
  }

  console.log(`\n  gravados            ${gravados}`);
  console.log(`  casaram pela ficha  ${porFicha}`);
  console.log(`  casaram pelo telefone ${porTel}`);
  console.log(`  ÓRFÃOS              ${orfaos}  ${pedidos.length
    ? '(' + (orfaos / pedidos.length * 100).toFixed(0) + '% — compraram sem ter passado por nós)' : ''}`);
  console.log(`  ficha sem telefone  ${semTelefone}`);

  if (!ensaio) {
    const { rows: [t] } = await cli.query(
      `select count(*)::int as pedidos,
              count(*) filter (where pessoa_id is not null)::int as com_pessoa,
              count(distinct bling_contato_id)::int as compradoras,
              coalesce(sum(receita_liquida), 0)::numeric(12,2) as liquida
         from vessel_pedidos`);
    console.log(`\nno banco: ${t.pedidos} pedidos, ${t.compradoras} compradoras distintas, `
      + `R$ ${t.liquida} que entraram · ${t.com_pessoa} ligados a alguém que conhecemos`);
  }
} finally {
  await cli.end();
}
