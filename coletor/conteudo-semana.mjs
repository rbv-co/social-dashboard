// coletor/conteudo-semana.mjs
//
// O robô que monta a SEMANA.
//
// A DIFERENÇA PARA O ROBÔ DE PAUTA: aquele entrega ideias avulsas e deixa a
// distribuição para a pessoa. Este responde a pergunta seguinte — "o que sai
// segunda, quarta e sexta?" — que é como um social media realmente pensa.
//
// O QUE FAZ ELE VALER: ele NÃO começa do zero. O banco de ideias já tem pauta
// pronta com roteiro; o trabalho aqui é ESCOLHER e ORDENAR, não inventar mais.
// Inventar é o barato; encaixar sem repetir pilar, sem dois posts de venda
// seguidos e respeitando o que já está agendado é o que dá trabalho.
//
// Uso:
//   node conteudo-semana.mjs --job <uuid>
//   node conteudo-semana.mjs --conta <uuid> [--seco]
//
// Para rodar na sua máquina: node --env-file=.env conteudo-semana.mjs --conta <uuid>
import { OPUS, structured, usageSummary } from './lib-llm.mjs';
import { registrarExecucao } from './registrar-execucao.mjs';
import { abrirBanco, lerJob, lerMarca, metricasDasPecas, concorrentesDoPortal, concluirJob, falharJob } from './lib/conteudo-banco.mjs';
import { montarContextoDaMarca } from './conteudo-contexto.mjs';
import {
  CADENCIA_PADRAO, proximaSegunda, slotsDaSemana, casarSlotsComIdeias, conferirPlano,
} from '../src/ferramentas/conteudo/semana.js';

const DB_URL = process.env.CONTEUDO_DATABASE_URL;
let db = null;

const arg = (nome, padrao = null) => {
  const i = process.argv.indexOf(`--${nome}`);
  return i > -1 ? (process.argv[i + 1] || true) : padrao;
};
const SECO = process.argv.includes('--seco');

const ESQUEMA = {
  type: 'object',
  properties: {
    slots: {
      type: 'array',
      description: 'Um item por post da semana, na ordem dos dias.',
      items: {
        type: 'object',
        properties: {
          data: { type: 'string', description: 'AAAA-MM-DD, dentro da semana pedida.' },
          hora: { type: 'string', description: 'HH:MM em horário de Brasília.' },
          ideia_do_banco: {
            type: 'integer',
            description:
              'O NÚMERO da ideia na lista do banco, quando você estiver reaproveitando uma. '
              + 'Omita este campo quando propuser pauta nova.',
          },
          titulo_novo: {
            type: 'string',
            description: 'Só quando NÃO usar ideia do banco: o título da pauta nova.',
          },
          gancho_novo: {
            type: 'string',
            description: 'Só com titulo_novo: os 3 primeiros segundos, escritos como se fala.',
          },
          formato: { type: 'string', enum: ['feed', 'carrossel', 'reels', 'stories'] },
          porque_neste_dia: {
            type: 'string',
            description:
              'Por que ESTE conteúdo neste dia e nesta hora — a ordem da semana, uma data '
              + 'comercial, o descanso entre dois pesados. Não repita o resumo da ideia.',
          },
        },
        required: ['data', 'hora', 'formato', 'porque_neste_dia'],
      },
    },
    leitura_da_semana: {
      type: 'string',
      description: 'Duas ou três frases: o raciocínio da semana como um todo, não item a item.',
    },
  },
  required: ['slots', 'leitura_da_semana'],
};

const SISTEMA = `Você é o social media desta marca, montando a semana.

Você NÃO está inventando pautas do zero: o banco de ideias já tem conteúdo pronto,
com roteiro. Seu trabalho é ESCOLHER e ORDENAR. Inventar é a parte fácil.

Regras:
1. PREFIRA o banco. Só proponha pauta nova quando o banco não tiver nada que sirva
   para aquele dia — e diga por quê em "porque_neste_dia".
2. A semana precisa de VARIEDADE: não repita o mesmo pilar em dias seguidos, e não
   ponha dois posts de venda um atrás do outro. Alterne o que pede esforço de
   produção com o que é rápido de gravar.
3. Respeite o que JÁ está agendado — não repita tema e não empilhe no mesmo dia.
4. "porque_neste_dia" é sobre POSIÇÃO, não sobre a ideia: por que este conteúdo
   neste dia desta semana. "É um bom conteúdo" não é resposta.
5. Uma ideia aparece UMA vez na semana. Nunca a mesma em dois dias.
6. Você pode mudar o horário sugerido se o histórico da marca indicar outro melhor.
7. NUNCA cite o nome ou o @ de um concorrente em texto que vá ao ar.
8. Português do Brasil, direto, sem jargão de marketing.`;

async function carregar(accountId) {
  const { conta, blocos, pecas, ideias, doNicho } = await lerMarca(db, accountId, {
    pecasColunas: 'id, titulo, formato, status, publicar_em, publicado_em',
    // Só o que ainda não virou peça: propor uma ideia já usada seria repetir.
    ideiasSql: `select id, titulo, gancho, formato, pilar, por_que_agora from conteudo_ideias
                where account_id = $1 and situacao in ('nova','favorita') order by created_at desc limit 40`,
    ideiasValores: [accountId],
  });
  const publicadas = (pecas || []).filter(p => p.status === 'publicada');
  let publicados = publicadas;

  if (publicadas.length) {
    const ultima = await metricasDasPecas(db, publicadas.map(p => p.id));
    publicados = publicadas.map(p => ({ ...p, metrica: ultima[p.id] || null }));
  }

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
    jaExistem: [],
    ideias: ideias || [],
  };
}

// O banco de ideias NUMERADO. O número é como a IA aponta qual ela escolheu —
// pedir o título de volta convidaria a reescrever, e aí não daria para saber se
// ela quis reaproveitar ou inventou outra parecida.
function listarBanco(ideias) {
  if (!ideias.length) {
    return '## Banco de ideias\nVazio. Proponha pautas novas para todos os dias.';
  }
  return '## Banco de ideias — PREFIRA estas\n'
    + 'Aponte a que escolher pelo NÚMERO, no campo `ideia_do_banco`.\n'
    + ideias.map((i, n) => {
      const partes = [
        i.formato && `[${i.formato}]`,
        i.pilar && `(${i.pilar})`,
        i.titulo,
        i.gancho && `— "${i.gancho}"`,
      ].filter(Boolean).join(' ');
      return `${n}. ${partes}`;
    }).join('\n');
}

function descreverSlots(slots) {
  return '## Os dias desta semana\n'
    + 'Preencha EXATAMENTE estes espaços, um post em cada:\n'
    + slots.map(s => `- ${s.nome_do_dia} ${s.data} às ${s.hora}`).join('\n');
}

async function main() {
  const jobId = arg('job');
  let accountId = arg('conta');
  const comecou = Date.now();

  db = await abrirBanco(DB_URL);

  let params = {};
  // Veio pela fila: o vigia já marcou `rodando`; aqui só se lê a conta e o pedido.
  if (jobId) {
    const job = await lerJob(db, jobId);
    accountId = job.account_id;
    params = job.params || {};
  }
  if (!accountId) throw new Error('informe --conta <uuid> ou --job <uuid>');

  const segunda = params.segunda ? new Date(`${params.segunda}T00:00:00`) : proximaSegunda();
  const cadencia = Array.isArray(params.cadencia) && params.cadencia.length
    ? params.cadencia
    : CADENCIA_PADRAO;
  const slots = slotsDaSemana(segunda, cadencia);
  if (!slots.length) throw new Error('não consegui montar os dias desta semana');

  const dados = await carregar(accountId);
  const briefing = montarContextoDaMarca(dados);

  console.log(
    `marca: ${dados.conta.name} · semana de ${slots[0].data} · `
    + `${slots.length} espaços · ${dados.ideias.length} ideias no banco`,
  );

  const pedido = [
    briefing,
    listarBanco(dados.ideias),
    descreverSlots(slots),
    '## Sua tarefa\nMonte a semana: escolha do banco (ou proponha o que faltar) e '
    + 'distribua nos espaços acima. Explique a ORDEM, não as ideias.',
  ].join('\n\n');

  // O teto acompanha o tamanho: cada slot custa pouco, mas o banco numerado
  // entra inteiro no pedido. (No robô de pauta um teto fixo já cortou uma
  // resposta pela metade e a rodada gravou zero se dizendo concluída.)
  const resposta = await structured({
    model: OPUS,
    system: SISTEMA,
    user: pedido,
    schema: ESQUEMA,
    maxTokens: Math.min(16000, 2000 + slots.length * 700),
  });

  const propostos = casarSlotsComIdeias(resposta?.slots, dados.ideias);
  const problemas = conferirPlano(propostos, segunda);

  console.log(`${propostos.length} espaços preenchidos · ${propostos.filter(s => s.ideia).length} do banco`);
  if (problemas.length) console.log(`avisos: ${problemas.join(' ')}`);

  const plano = {
    semana: slots[0].data,
    leitura: resposta?.leitura_da_semana || null,
    // Guarda o ID da ideia, não o objeto inteiro: a ideia pode ser editada
    // depois, e o plano deve mostrar a versão atual dela, não uma foto velha.
    slots: propostos.map(s => ({
      data: s.data,
      hora: s.hora,
      formato: s.formato,
      porque_neste_dia: s.porque_neste_dia,
      ideia_id: s.ideia?.id || null,
      titulo_novo: s.titulo_novo,
      gancho_novo: s.gancho_novo,
    })),
    problemas,
  };

  if (SECO) {
    console.log(JSON.stringify(plano, null, 2));
  } else if (!propostos.length) {
    // Semana vazia é falha, não resultado: a tela pararia de girar sem dizer
    // nada e a pessoa ficaria olhando para o mesmo calendário de antes.
    throw new Error('a IA não conseguiu montar a semana desta vez. Tente de novo.');
  }

  const uso = usageSummary();
  console.log(uso.text);

  if (jobId && !SECO) {
    await concluirJob(db, jobId, { ...plano, usd: uso.usd });
  }

  await registrarExecucao({
    robo: 'conteudo-semana',
    acao: `montar a semana · ${dados.conta.name || accountId}`,
    modelo: OPUS,
    inputTokens: uso.tin, outputTokens: uso.tout, chamadas: uso.calls,
    duracaoMs: Date.now() - comecou,
    itens: propostos.length, unidade: 'posts',
    status: 'ok',
    detalhe: problemas.length ? problemas.join(' ') : null,
    db,
  });
  await db.fechar();
}

main().catch(async (e) => {
  console.error('ERRO:', e.message);
  const jobId = arg('job');
  if (jobId && db) await falharJob(db, jobId, e.message).catch(() => {});
  await registrarExecucao({
    robo: 'conteudo-semana', acao: 'montar a semana',
    status: 'erro', detalhe: String(e.message).slice(0, 300), db,
  }).catch(() => {});
  await db?.fechar();
  process.exit(1);
});
