// coletor/conteudo-ideias.mjs
//
// O robô de pauta: olha o histórico de uma marca e sugere o que postar.
//
// POR QUE AQUI E NÃO NUMA EDGE FUNCTION: Opus com um contexto grande leva mais
// tempo que o relógio de uma Edge permite. É a mesma razão de a Fábrica de
// Anúncios rodar por GitHub Actions — o `conteudo-trigger` só enfileira e
// dispara este script.
//
// O QUE FAZ ESTE ROBÔ VALER: o contexto, não o modelo. Qualquer LLM escreve
// "poste um bastidor da loja". O que ele não adivinha é o que funcionou NESTA
// marca, o que já está agendado e como ela fala — ver conteudo-contexto.mjs.
//
// Uso:
//   node conteudo-ideias.mjs --job <uuid>
//   node conteudo-ideias.mjs --conta <uuid> --quantas 12
//   node conteudo-ideias.mjs --conta <uuid> --seco     (não grava nada)
// SEM `import 'dotenv/config'`. Parece inofensivo e derrubou as duas primeiras
// rodadas de verdade: no GitHub Actions o pacote não existe (não é dependência
// do coletor, e o workflow instala com --omit=dev), então o script morria com
// ERR_MODULE_NOT_FOUND antes da primeira linha.
//
// Nenhum outro robô daqui usa dotenv — budget-ia, gestor-comercial e companhia
// leem `process.env` direto, porque no Actions as variáveis vêm do `env:` do
// workflow. Para rodar na sua máquina, use:
//   node --env-file=.env conteudo-ideias.mjs --conta <uuid>
import { OPUS, structured, usageSummary } from './lib-llm.mjs';
import { registrarExecucao } from './registrar-execucao.mjs';
import {
  abrirBanco, lerJob, lerMarca, metricasDasPecas, concorrentesDoPortal, gravarIdeias, concluirJob, falharJob,
} from './lib/conteudo-banco.mjs';
import { ESQUEMA, SISTEMA, montarContextoDaMarca, ehRepetida } from './conteudo-contexto.mjs';

const DB_URL = process.env.CONTEUDO_DATABASE_URL;
let db = null;

const arg = (nome, padrao = null) => {
  const i = process.argv.indexOf(`--${nome}`);
  return i > -1 ? (process.argv[i + 1] || true) : padrao;
};
const SECO = process.argv.includes('--seco');

async function carregarDadosDaMarca(accountId) {
  const { conta: contaDaMarca, blocos, pecas, ideias: ideiasExistentes, doNicho } = await lerMarca(db, accountId, {
    pecasColunas: 'id, titulo, formato, status, publicado_em',
    ideiasSql: `select titulo from conteudo_ideias where (account_id = $1 or account_id is null) and situacao in ('nova','favorita')`,
    ideiasValores: [accountId],
  });

  const publicadas = (pecas || []).filter(p => p.status === 'publicada');
  let publicados = publicadas;

  // As métricas de quem já publicou — o insumo que só existe por causa da Fase 3.
  if (publicadas.length) {
    const ultima = await metricasDasPecas(db, publicadas.map(p => p.id));
    publicados = publicadas.map(p => ({ ...p, metrica: ultima[p.id] || null }));
  }

  const conta = contaDaMarca;

  // Concorrentes da rodada mais recente do Portal de Notícias.
  //
  // SÓ PARA QUEM É DO NICHO. O Portal cobre moda e calçado (Schutz, Anacapri,
  // Petite Jolie, Arezzo...). Antes eu puxava sem filtro, e a primeira pauta
  // real do Breno Vale — marca pessoal — citou "@Isla, @Santa Lolla e
  // @Arezzo&Co" como concorrentes dele. Quem manda é a coluna
  // `accounts.conteudo_usa_portal`, que nasce falsa.
  //
  // As colunas são `marca`, `titulo` e `resumo` — NÃO handle/legenda/curtidas.
  // (Escrevi errado na primeira versão e o try/catch abaixo engoliu: a seção de
  // concorrentes simplesmente não aparecia no prompt, sem erro nenhum. Se mexer
  // aqui, confira contra o schema antes.)
  //
  // Best-effort de propósito: sem o Portal, o briefing sai um pouco mais pobre,
  // mas a rodada não pode falhar por causa de uma seção acessória.
  let concorrentes = [];
  if (conta.conteudo_usa_portal) {
    try {
      const linhas = await concorrentesDoPortal(db);
      concorrentes = linhas.map(l => ({
        handle: l.marca,
        legenda: [l.titulo, l.resumo].filter(Boolean).join(' — '),
      })).filter(c => c.legenda);
    } catch { concorrentes = []; }
  }

  return {
    conta,
    blocos: blocos || [],
    publicados,
    agendadas: pecas || [],
    concorrentes,
    concorrentesDaMarca: doNicho || [],
    hoje: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }),
    jaExistem: (ideiasExistentes || []).map(i => i.titulo),
  };
}

async function main() {
  const jobId = arg('job');
  let accountId = arg('conta');
  let quantas = Number(arg('quantas', 12));
  const comecou = Date.now();

  db = await abrirBanco(DB_URL);

  // Veio pela fila: o vigia já marcou `rodando`; aqui só se lê a conta e o pedido.
  if (jobId) {
    const job = await lerJob(db, jobId);
    accountId = job.account_id;
    // Defesa: a API só enfileira 1 a 20, mas o valor vem do banco.
    if (job.params?.quantas) quantas = Math.max(1, Math.min(20, Math.trunc(Number(job.params.quantas)) || 12));
  }
  if (!accountId) throw new Error('informe --conta <uuid> ou --job <uuid>');

  const dados = await carregarDadosDaMarca(accountId);
  const briefing = montarContextoDaMarca(dados);
  console.log(`marca: ${dados.conta.name} · ${dados.publicados.length} publicados · ${dados.jaExistem.length} ideias já no banco`);

  // O TETO ACOMPANHA O TAMANHO DO PEDIDO.
  //
  // Era fixo em 8192, e isso bastava enquanto a ideia era título + gancho +
  // falas. Com o roteiro completo cada ideia passou a custar ~850 tokens de
  // saída (medido: 8 ideias = 6783). Ao pedir 12, a resposta bateu no teto,
  // veio pela metade, e a rodada gravou ZERO ideias se dizendo concluída.
  //
  // 1200 por ideia dá folga sobre os 850 medidos — roteiro longo de reels puxa
  // mais. Se um dia faltar, `structured()` avisa alto em vez de truncar calado.
  const tetoDeSaida = Math.min(32000, 1500 + quantas * 1200);

  const resposta = await structured({
    model: OPUS,
    system: SISTEMA,
    user: `${briefing}\n\n## Sua tarefa\nSugira ${quantas} ideias de conteúdo para esta marca.`,
    schema: ESQUEMA,
    maxTokens: tetoDeSaida,
  });

  const brutas = Array.isArray(resposta?.ideias) ? resposta.ideias : [];

  // NENHUMA IDEIA É FALHA, NÃO RESULTADO. Sem isto a rodada se declarava
  // concluída com zero, a tela parava de girar sem dizer nada e a pessoa ficava
  // olhando para a mesma lista de antes sem saber por quê.
  // (Diferente de "todas repetidas", logo abaixo: ali a IA trabalhou e o dedup
  // é que descartou — isso é resultado legítimo e tem recado próprio.)
  if (!brutas.length) {
    throw new Error('a IA não devolveu nenhuma ideia nesta rodada. Tente de novo.');
  }

  // DEDUPLICAÇÃO. Sem isto, "gerar mais ideias" pela terceira vez devolve a
  // mesma pauta com outras palavras, e o banco vira um depósito de repetição.
  // Compara contra o que já existe E contra as desta mesma rodada.
  const jaVistas = [...dados.jaExistem];
  const novas = [];
  let repetidas = 0;
  for (const ideia of brutas) {
    if (ehRepetida(ideia?.titulo, jaVistas)) { repetidas++; continue; }
    jaVistas.push(ideia.titulo);
    novas.push(ideia);
  }

  console.log(`${brutas.length} sugeridas · ${novas.length} novas · ${repetidas} repetidas (descartadas)`);

  if (SECO) {
    console.log(JSON.stringify(novas, null, 2));
  } else if (novas.length) {
    await gravarIdeias(db, accountId, novas, { modelo: OPUS, jobId });
  }

  const uso = usageSummary();
  console.log(uso.text);

  if (jobId && !SECO) {
    await concluirJob(db, jobId, { sugeridas: brutas.length, gravadas: novas.length, repetidas, usd: uso.usd });
  }

  // Telemetria: aparece sozinha no Painel de Status do Claude, sem tocar naquela tela.
  await registrarExecucao({
    robo: 'conteudo-ideias',
    acao: `gerar ideias de conteúdo · ${dados.conta.name || accountId}`,
    modelo: OPUS,
    inputTokens: uso.tin, outputTokens: uso.tout, chamadas: uso.calls,
    duracaoMs: Date.now() - comecou,
    itens: novas.length, unidade: 'ideias',
    status: 'ok',
    detalhe: repetidas ? `${repetidas} repetidas descartadas` : null,
    db,
  });
  await db.fechar();
}

main().catch(async (e) => {
  console.error('ERRO:', e.message);
  const jobId = arg('job');
  if (jobId && db) await falharJob(db, jobId, e.message).catch(() => {});
  await registrarExecucao({
    robo: 'conteudo-ideias', acao: 'gerar ideias de conteúdo',
    status: 'erro', detalhe: String(e.message).slice(0, 300), db,
  }).catch(() => {});
  await db?.fechar();
  process.exit(1);
});
