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
import { colunasExistem } from './lib/colunas-existem.mjs';
import { contasDoItem } from './lib/preco-do-item.mjs';
import { indiceDeLeads, leadDoPedido } from './lib/lead-do-pedido.mjs';

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

  // ⚠️ C5 (revisão final, 17/09/2026): este robô roda da `main` todo dia às
  // 07h34 UTC. Se a migration que cria `observacoes`/`observacoes_internas`
  // (db/migrations/2026-09-17-vessel-registro-com-conta.sql) entrar na `main`
  // antes de ser aplicada no banco, o insert abaixo quebraria com "column
  // does not exist" e a VENDA DO DIA inteira se perderia, calada. Confere UMA
  // vez por rodada, e grava sem essas duas colunas quando faltarem — a venda
  // nunca se perde por causa da ordem entre merge e migration.
  const temObservacoes = await colunasExistem(
    (sql, params) => cli.query(sql, params), 'vessel_pedidos',
    ['observacoes', 'observacoes_internas']);
  if (!temObservacoes) {
    console.warn('\n⚠️  vessel_pedidos ainda não tem observacoes/observacoes_internas — '
      + 'aplique db/migrations/2026-09-17-vessel-registro-com-conta.sql. '
      + 'Gravando os pedidos SEM essas duas colunas por enquanto.\n');
  }

  // Mesmo cuidado, para o casamento com o lead (db/migrations/
  // 2026-09-23-pedido-sabe-de-qual-lead-veio.sql): sem as colunas, a venda
  // entra do mesmo jeito e só o casamento com o lead fica para depois.
  const temLead = await colunasExistem(
    (sql, params) => cli.query(sql, params), 'vessel_pedidos', ['lead_id', 'casou_lead_por']);
  if (!temLead) {
    console.warn('\n⚠️  vessel_pedidos ainda não tem lead_id/casou_lead_por — '
      + 'aplique db/migrations/2026-09-23-pedido-sabe-de-qual-lead-veio.sql. '
      + 'Gravando os pedidos SEM o casamento com o lead por enquanto.\n');
  }

  const token = await loginServico();
  const ate = new Date();
  const de = new Date(ate); de.setDate(de.getDate() - dias);
  console.log(`\njanela: ${iso(de)} a ${iso(ate)}${ensaio ? '  (ENSAIO — nada será gravado)' : ''}\n`);

  // ── 1. TODOS os pedidos da janela, em qualquer situação ────────────────────
  //
  // ⚠️ ATÉ 21/09/2026 ESTA LEITURA FILTRAVA `idsSituacoes[]: ATENDIDO`, e era
  // por isso que pedido cancelado virava venda eterna: quem nasce fora do
  // filtro nunca mais é olhado. O robô importava o pedido enquanto ele estava
  // atendido e nunca voltava para perguntar "e agora?".
  //
  // Medido no dia em que isso apareceu: 2 dos 223 pedidos dos últimos 60 dias
  // já estavam cancelados no Bling e continuavam como venda aqui — R$ 3.850 a
  // mais. A loja refaz o pedido quando erra, e a venda da Luiza Maria Carvalho
  // chegou a ter TRÊS (2680 e 2681 cancelados, 2682 valendo).
  //
  // Agora a leitura é SEM filtro e o robô separa aqui dentro: os atendidos ele
  // importa, e a situação de TODOS ele grava. Custa as mesmas páginas de
  // listagem — a chamada cara (o detalhe, um por pedido) continua só para os
  // atendidos.
  const todosDoBling = [];
  for (let pagina = 1; pagina <= 40; pagina++) {
    const r = await blingProxy(token, 'pedidos/vendas',
      { dataInicial: iso(de), dataFinal: iso(ate), pagina, limite: 100 });
    const d = r.data || [];
    todosDoBling.push(...d);
    if (d.length < 100) break;
  }
  const pedidos = todosDoBling.filter((p) => Number(p.situacao?.id) === ATENDIDO);
  const outros = todosDoBling.length - pedidos.length;
  console.log(`${todosDoBling.length} pedidos no Bling na janela`
    + ` — ${pedidos.length} atendidos, ${outros} em outra situação`);

  // ── 2. quem já conhecemos ──────────────────────────────────────────────────
  const { rows: pessoas } = await cli.query(
    'select id, telefone, bling_contato_id from vessel_pessoas');
  const porContato = new Map(pessoas.filter((p) => p.bling_contato_id)
    .map((p) => [String(p.bling_contato_id), p.id]));
  const porTelefone = new Map(pessoas.map((p) => [p.telefone, p.id]));
  console.log(`${pessoas.length} pessoas conhecidas (${porContato.size} já com ficha do Bling ligada)`);

  // Os cadastros da LP. Os de teste ficam de fora — pela origem E pelo nome:
  // o "TESTE LP VESSEL" (origem lp-vesselbrasil, comum) casou pelo telefone
  // com o pedido 2600 de "Cliente Teste Treinamento" no ensaio de 23/09/2026.
  // Seria a única conversão da LP, e era falsa.
  const { rows: leads } = await cli.query(
    `select id, whatsapp, email, criado_em, bling_id from vessel_lista_espera
      where coalesce(origem, '') not ilike '%teste%' and nome not ilike '%teste%'`);
  const idxLeads = indiceDeLeads(leads);
  console.log(`${leads.length} leads da LP para cruzar`);

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
  const fichaDoContato = new Map();   // cache da rodada: uma leitura por ficha
  let gravados = 0, orfaos = 0, porFicha = 0, porTel = 0, semTelefone = 0;
  const leadPor = { ficha: 0, email: 0, telefone: 0 };

  // Lê a ficha uma vez por rodada. Antes só se lia a de quem não casava pela
  // ficha; o cruzamento com o lead precisa do telefone e do e-mail de TODAS.
  const lerFicha = async (contatoId) => {
    if (!fichaDoContato.has(contatoId)) {
      await espera(380);                         // o Bling limita 3 por segundo
      const r = await fetch(`${BLING}/contatos/${contatoId}`, {
        headers: { Authorization: 'Bearer ' + tk.access_token, Accept: 'application/json' } });
      const ficha = r.ok ? (await r.json())?.data || {} : {};
      // ⚠️ OS DOIS CAMPOS. A ficha criada pela loja no PDV preenche
      // `telefone`; a criada pelo nosso robô preenche `celular`. Ler só um
      // perde metade — e perde calado.
      fichaDoContato.set(contatoId, {
        tel: telefoneCanonico(ficha.celular || ficha.telefone),
        telefones: [telefoneCanonico(ficha.celular), telefoneCanonico(ficha.telefone)].filter(Boolean),
        email: ficha.email || '',
      });
    }
    return fichaDoContato.get(contatoId);
  };

  for (const p of pedidos) {
    const detalhe = (await blingProxy(token, `pedidos/vendas/${p.id}`, {})).data || {};
    const contatoId = p.contato?.id ? String(p.contato.id) : null;

    // ── o casamento, nas duas escadas ──
    let pessoaId = contatoId ? porContato.get(contatoId) || null : null;
    let casouPor = pessoaId ? 'bling_contato' : null;

    if (!pessoaId && contatoId) {
      const tel = (await lerFicha(contatoId)).tel;
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

    // ── de qual lead veio ──
    const lead = temLead && contatoId
      ? leadDoPedido(idxLeads, { contatoId, ...(await lerFicha(contatoId)) }, String(p.data).slice(0, 10))
      : null;
    if (lead) leadPor[lead.por]++;
    if (ensaio) continue;

    // ⚠️ C5: as colunas de observações só entram na lista (e no valor) quando
    // `temObservacoes` for true. Assim o insert nunca cita uma coluna que
    // pode não existir ainda no banco — ver o comentário no início do
    // arquivo.
    const colunasBase = [
      'bling_pedido_id', 'numero', 'bling_contato_id', 'contato_nome', 'pessoa_id', 'casou_por',
      'loja_id', 'vendedor_id', 'data_do_pedido', 'data_da_nota', 'data_da_venda', 'origem_da_data',
      'total_produtos', 'desconto', 'outras_despesas', 'total_do_bling', 'total_corrigido',
      'situacao_id',
    ];
    const valoresBase = [
      p.id, String(p.numero ?? ''), contatoId, p.contato?.nome || null, pessoaId, casouPor,
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
    ];
    const colunas = [...colunasBase,
      ...(temObservacoes ? ['observacoes', 'observacoes_internas'] : []),
      ...(temLead ? ['lead_id', 'casou_lead_por'] : [])];
    const valores = [...valoresBase,
      ...(temObservacoes ? [detalhe.observacoes || null, detalhe.observacoesInternas || null] : []),
      ...(temLead ? [lead?.leadId ?? null, lead?.por ?? null] : [])];
    const marcadores = colunas.map((_, i) => `$${i + 1}`).join(',');

    const setObservacoes = temObservacoes
      // ⚠️ NUNCA APAGAR uma observação que já está gravada. É nela que mora a
      // marca PRESENTE (vessel_pedido_marcado_presente), e o Bling pode
      // devolver o detalhe SEM esses dois campos (campo ausente vira null na
      // ligação acima, não string vazia). Sem o coalesce, essa ausência
      // calada apagaria um "PRESENTE" já lido numa rodada anterior, e o "É
      // presente?" mudaria de resposta sem erro nenhum — mesmo risco que
      // pessoa_id/casou_por já tratam abaixo.
      ? `, observacoes = coalesce(excluded.observacoes, vessel_pedidos.observacoes),
           observacoes_internas = coalesce(excluded.observacoes_internas, vessel_pedidos.observacoes_internas)`
      : '';

    // Mesma regra de pessoa_id: casamento com lead nunca se desfaz sozinho.
    const setLead = temLead
      ? `, lead_id = coalesce(excluded.lead_id, vessel_pedidos.lead_id),
           casou_lead_por = coalesce(excluded.casou_lead_por, vessel_pedidos.casou_lead_por)`
      : '';

    const { rows: [linha] } = await cli.query(
      `insert into vessel_pedidos (${colunas.join(', ')})
       values (${marcadores})
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
          situacao_id = excluded.situacao_id${setObservacoes}${setLead},
          atualizado_em = now()
       returning id`,
      valores);

    // Os itens são REFEITOS a cada rodada: pedido editado no Bling muda de
    // itens, e acrescentar deixaria os antigos ali para sempre.
    await cli.query('delete from vessel_pedido_itens where pedido_id = $1', [linha.id]);
    for (const it of detalhe.itens || []) {
      // ⚠️ `it.valor` DO BLING JÁ VEM COM O DESCONTO APLICADO, e `it.desconto`
      // é a porcentagem que já foi usada — informativa, não uma conta a fazer.
      // A regra, o porquê e a prova moram em `lib/preco-do-item.mjs`, com teste.
      //
      // Até 22/09/2026 esta linha descontava a porcentagem OUTRA VEZ, e isso
      // inventava R$ 10.028,94 de desconto em 116 pedidos: a `receita_liquida`
      // não batia com o Bling, nem com a nota, nem com a tela.
      const { totalDoItem, precoDeTabela } = contasDoItem(it);
      await cli.query(
        `insert into vessel_pedido_itens
           (pedido_id, sku, descricao, quantidade, valor_unitario, desconto_percentual,
            total_do_item, preco_de_tabela)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [linha.id, it.codigo || it.produto?.codigo || null, it.descricao || null,
         it.quantidade ?? null, it.valor ?? null, it.desconto ?? null,
         totalDoItem, precoDeTabela]);
    }
    // ⚠️ A RECEITA LÍQUIDA É CALCULADA AQUI, depois dos itens, porque ela
    // DEPENDE deles: é a soma das peças menos o desconto do PEDIDO (o do
    // cabeçalho, que existe de verdade e o Bling aplica).
    //
    // ⚠️ ESTE COMENTÁRIO DIZIA O CONTRÁRIO ATÉ 22/09/2026. Ele afirmava que o
    // `total` do Bling "sai ~6% maior porque não desconta o desconto do item"
    // (R$ 161.545 contra R$ 151.370 em 90 dias). Os 6% eram o defeito, não a
    // correção: o Bling não desconta porque não há o que descontar — o desconto
    // do item já está dentro do `valor`. Quem somava esta coluna somava R$ 10
    // mil a menos que a nota fiscal. Ver `lib/preco-do-item.mjs`.
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

  // ── 6. A CONFERÊNCIA: o que a nossa base diz, e o que o Bling diz AGORA ────
  //
  // ⚠️ ESTA ETAPA É O CONSERTO DO FANTASMA. Importar é metade do trabalho; a
  // outra metade é voltar e perguntar "isto ainda é verdade?". Sem ela, pedido
  // cancelado depois de importado vira venda para sempre, e ninguém descobre —
  // porque nada erra, nada avisa, e o número só fica maior.
  //
  // ⚠️ A JANELA É COMPARADA POR `data_do_pedido`, e não por `data_da_venda`.
  // O Bling filtrou a listagem pelo campo `data`, que é o nosso
  // `data_do_pedido`; `data_da_venda` vem da nota e pode cair em outro dia. Usar
  // a data errada aqui faria o robô dizer "sumiu do Bling" sobre pedido que
  // está lá, só com outra data — e apagar venda boa é pior que guardar venda
  // cancelada.
  const situacaoNoBling = new Map(
    todosDoBling.map((p) => [String(p.numero), Number(p.situacao?.id)]));

  const { rows: nossos } = await cli.query(
    `select id, numero, situacao_id, receita_liquida, contato_nome
       from vessel_pedidos
      where data_do_pedido between $1 and $2`, [iso(de), iso(ate)]);

  let confirmados = 0;
  const mudaram = [];
  const sumiram = [];
  for (const n of nossos) {
    const agora = situacaoNoBling.has(String(n.numero))
      ? situacaoNoBling.get(String(n.numero)) : null;
    if (agora === null) sumiram.push(n);
    else if (agora !== n.situacao_id) mudaram.push({ ...n, agora });
    else confirmados++;

    if (!ensaio) {
      await cli.query(
        `update vessel_pedidos set situacao_id = $2, conferido_no_bling_em = now()
          where id = $1`, [n.id, agora]);
    }
  }

  const perdido = [...mudaram, ...sumiram]
    .filter((x) => x.situacao_id === ATENDIDO)
    .reduce((t, x) => t + Number(x.receita_liquida || 0), 0);

  console.log(`\n  ── conferência com o Bling ──`);
  console.log(`  conferidos e iguais ${confirmados}`);
  console.log(`  MUDARAM de situação ${mudaram.length}`);
  console.log(`  SUMIRAM do Bling    ${sumiram.length}`);
  if (perdido > 0) {
    console.log(`  ⚠️ deixam de ser venda: R$ ${perdido.toFixed(2)}`);
  }
  for (const x of [...mudaram, ...sumiram].slice(0, 15)) {
    console.log(`     ${String(x.numero).padStart(6)}  ${x.situacao_id} -> `
      + `${x.agora ?? 'sumiu'}  R$ ${Number(x.receita_liquida || 0).toFixed(2)}  ${x.contato_nome ?? ''}`);
  }

  console.log(`\n  gravados            ${gravados}`);
  console.log(`  casaram pela ficha  ${porFicha}`);
  console.log(`  casaram pelo telefone ${porTel}`);
  console.log(`  ÓRFÃOS              ${orfaos}  ${pedidos.length
    ? '(' + (orfaos / pedidos.length * 100).toFixed(0) + '% — compraram sem ter passado por nós)' : ''}`);
  console.log(`  ficha sem telefone  ${semTelefone}`);
  console.log(`  VIERAM DE UM LEAD   ${leadPor.ficha + leadPor.email + leadPor.telefone}`
    + `  (ficha ${leadPor.ficha} · e-mail ${leadPor.email} · telefone ${leadPor.telefone})`
    + `${temLead ? '' : '  — colunas ainda não existem, nada gravado'}`);

  if (!ensaio) {
    const { rows: [t] } = await cli.query(
      // ⚠️ `situacao_id = 9` AQUI TAMBÉM. Este resumo é a última frase que o
      // robô diz, e ela vira print de conversa. Sem o filtro ele somava os
      // cancelados e anunciava "R$ 169.525,79 que entraram" com R$ 3.850 que
      // não entraram — o mesmo defeito que a conferência acabou de consertar no
      // banco, repetido na frase que conta o resultado dela.
      `select count(*) filter (where situacao_id = 9)::int as pedidos,
              count(*) filter (where situacao_id = 9 and pessoa_id is not null)::int as com_pessoa,
              count(distinct bling_contato_id) filter (where situacao_id = 9)::int as compradoras,
              coalesce(sum(receita_liquida) filter (where situacao_id = 9), 0)::numeric(12,2) as liquida,
              count(*) filter (where situacao_id is distinct from 9)::int as nao_sao_venda
         from vessel_pedidos`);
    console.log(`\nno banco: ${t.pedidos} vendas, ${t.compradoras} compradoras distintas, `
      + `R$ ${t.liquida} que entraram · ${t.com_pessoa} ligados a alguém que conhecemos`);
    if (t.nao_sao_venda > 0) {
      console.log(`          (+ ${t.nao_sao_venda} pedido(s) guardado(s) que NÃO são venda: `
        + `cancelados ou sumidos do Bling — ficam no histórico e fora de toda conta)`);
    }
  }
} finally {
  await cli.end();
}
