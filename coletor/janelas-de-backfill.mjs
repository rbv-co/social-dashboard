// A JANELA DE DATAS de cada recorte de campaign_insights.
//
// Cada recorte é gravado por um código diferente, com uma conta de datas
// diferente. O backfill tem de fazer a MESMA pergunta que quem gravou a linha
// fez — senão o número novo não bate com o gasto que já está na mesma linha, e
// duas colunas vizinhas passam a falar de períodos diferentes.
//
// Lido no código em 17/08/2026, não deduzido:
//   0            → coletarAdsDia: time_range {since: dia, until: dia}
//                  (e coletarAdsPorCampanha com dias=0 dá a MESMA janela)
//   1, 7, 14, 30 → coletarAdsPorCampanha. A janela DELE mudou em 20/08/2026:
//                  até então era `until = hoje, since = hoje − dias`, que cobre
//                  N+1 dias com o dia de hoje dentro; hoje é `hoje − dias` até
//                  ONTEM, N dias completos. Ver janela-de-ads.js, onde as duas
//                  moram lado a lado com teste. O backfill continua COPIANDO o
//                  jeito de quem gravou a linha — por isso precisa saber a data
//                  da virada (PRIMEIRO_DIA_COM_A_JANELA_NOVA, logo abaixo).
//   99           → O COLETOR PYTHON LEGADO, não a Edge Function:
//                  projetos/central-inteligencia/redes-sociais/coletor/coletar.py
//                  linha 369  dias_mtd = max(date.today().day - 1, 0)
//                  linha 394  coletar_ads_por_campanha(..., dias_mtd, hoje, store_as=99)
//                  e a janela sai hoje de `janela_do_mes_corrente` (since = hoje
//                  − dias_mtd, until = hoje) — do 1º do mês até o dia. Confere, e
//                  esse recorte NÃO mudou em 21/08: ele inclui o dia corrente de
//                  propósito, que é o que o botão "MÊS / ATÉ AGORA" promete.
//                  (Um comentário anterior citava recuperar-curtidas-zeradas.mjs:
//                  aquele arquivo grava engagement_snapshots e NUNCA
//                  campaign_insights. A janela calculada estava certa, a fonte
//                  citada não. Corrigido em 17/08/2026.)
//                  Repare de passagem: o Python pede
//                  `fields=campaign_id,spend,impressions,clicks,reach` — SEM
//                  `actions`. É por isso que o recorte 99 não tem uma única linha
//                  preenchida, e é por isso que ele só se preenche por aqui.
// PURO: sem rede, sem banco.

// UM MOTOR SÓ para a janela de N dias: a mesma função que o coletor usa para
// PERGUNTAR é a que o backfill usa para REPETIR a pergunta. Duas cópias desta
// conta seriam duas verdades esperando para divergir no primeiro conserto.
import { janelaDeAds, janelaDeAdsAntiga } from '../supabase/functions/_shared/janela-de-ads.js';

const RECORTES_DE_N_DIAS = [1, 7, 14, 30];

// A PARTIR DE QUE `captured_at` AS LINHAS FORAM GRAVADAS COM A JANELA NOVA.
//
// NASCE `null` DE PROPÓSITO, e null quer dizer "a Edge ainda não subiu": enquanto
// estiver assim, o backfill trata TODA linha como linha da janela velha — que é
// exatamente o que elas são hoje. Chutar uma data aqui antes do deploy faria o
// backfill perguntar à Meta um período diferente do que gravou o gasto da mesma
// linha, e aí duas colunas vizinhas passariam a falar de semanas diferentes.
//
// COMO PREENCHER: só quando OS DOIS robôs estiverem com o código novo. São dois
// que gravam estas linhas, com a mesma chave, e quem roda por último vence:
//   • o coletor deste Mac (`coletar.py`, launchd 5x/dia) — já vai com o arquivo;
//   • a Edge `coletar-dados` — precisa de deploy na mão pelo MCP.
// Enquanto só um estiver novo, a linha do dia pode sair de qualquer um dos dois
// jeitos, conforme quem passou por último — e nesse dia não há resposta certa
// para pôr aqui. Ponha a data BRT do primeiro dia INTEIRO com os dois novos, no
// formato 'AAAA-MM-DD'. Nem antes, nem depois.
// MEDIDO, não deduzido (21/08/2026, contra os dados de produção): comparando o
// agregado de 7 dias de cada perfil com a soma dos gastos diários, 4 dos 5 perfis
// já batiam com a janela NOVA em 21/08 — e a La Vessel Dom Pedro ainda batia com
// a VELHA, porque só a Edge escreve os anúncios dela (ela não está no mapa fixo
// do coletar.py) e a Edge só subiu às 08h13, depois da rodada das 07h.
//
// Ou seja, 21/08 é um dia MISTURADO. Ele fica tratado como dia da janela velha:
// no pior caso o backfill repete uma pergunta de 8 dias para uma linha de 7, o
// que é o mesmo estado em que ela já esteve; marcá-lo como novo arriscaria o
// contrário para a La Vessel, que é a linha que sabidamente não é nova.
//
// 22/08 é o primeiro dia em que TODA rodada, dos dois robôs, usa a janela nova.
export const PRIMEIRO_DIA_COM_A_JANELA_NOVA = '2026-08-22';

export function janelaDoRecorte(capturedAt, periodDays, viradaEm = PRIMEIRO_DIA_COM_A_JANELA_NOVA) {
  if (!capturedAt) return null;
  if (periodDays === 0) return { since: capturedAt, until: capturedAt };
  if (RECORTES_DE_N_DIAS.includes(periodDays)) {
    // Comparação por texto: `captured_at` já vem em 'AAAA-MM-DD', e ISO ordena
    // igual em texto e no calendário.
    const nova = !!viradaEm && String(capturedAt) >= String(viradaEm);
    return nova ? janelaDeAds(capturedAt, periodDays) : janelaDeAdsAntiga(capturedAt, periodDays);
  }
  if (periodDays === 99) return { since: capturedAt.slice(0, 7) + '-01', until: capturedAt };
  return null; // recorte que ninguém grava hoje: não inventa janela
}

// Uma chamada à Meta cobre TODAS as campanhas de uma conta numa janela. Então o
// alvo é conta + data + recorte, e não a linha (que é por campanha).
// Do mais antigo para o mais novo: se a Meta interromper no meio, o que sobra é o
// pedaço recente, que a própria rodada seguinte do coletor cobre.
//
// `desde` (opcional, "AAAA-MM-DD") é o filtro do dono para rodar só o pedaço
// recente agora e deixar o resto para a passada de madrugada. Comparação de
// texto basta porque captured_at já vem em "AAAA-MM-DD": ordena igual a data.
// O filtro entra ANTES da deduplicação/ordenação — aqui mesmo, no ponto onde os
// alvos nascem — para a contagem que o script imprime no início já saber dele.
export function alvosPendentes(linhas, desde) {
  const vistos = new Set();
  const alvos = [];
  for (const l of (linhas || [])) {
    if (!janelaDoRecorte(l.captured_at, l.period_days)) continue;
    if (desde && l.captured_at < desde) continue;
    const chave = `${l.account_id}|${l.captured_at}|${l.period_days}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    alvos.push({ account_id: l.account_id, captured_at: l.captured_at, period_days: l.period_days });
  }
  return alvos.sort((a, b) => (a.captured_at < b.captured_at ? -1 : a.captured_at > b.captured_at ? 1 : 0));
}

// ------------------------------------------------------------- as bandeiras

export const PAUSA_PADRAO = 2000;
// Piso. Pausa zero é exatamente o que martelou a Meta em 07/07/2026 e derrubou o
// painel ao vivo por horas. Um valor menor que isto é engano de digitação, não
// intenção — então o piso vence em silêncio, e o script avisa que venceu.
export const PAUSA_MINIMA = 250;

// AAAA-MM-DD estrito, e a data tem de existir de verdade: "2026-13-45" tem o
// formato certo mas mês 13 e dia 45 não existem, e o construtor Date rola por
// cima disso em silêncio (mês 13 vira janeiro do ano seguinte) em vez de avisar.
// Por isso o round-trip: monta a data a partir dos três números e confere se
// ano/mês/dia voltam iguais. Se algo rolou por cima, não bate, e é recusado —
// nunca coagido para uma data vizinha que preencheria o período errado.
// UTC de propósito (não T12:00:00 local): aqui não há fuso a proteger, só os
// três números soltos; Date.UTC não deixa hora nenhuma entrar na conta.
const FORMATO_DESDE = /^(\d{4})-(\d{2})-(\d{2})$/;
function dataDeCalendarioValida(texto) {
  const m = FORMATO_DESDE.exec(texto);
  if (!m) return false;
  const [, aTxt, mTxt, dTxt] = m;
  const ano = Number(aTxt), mes = Number(mTxt), dia = Number(dTxt);
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  return d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia;
}

// Por que um interpretador em vez de process.argv.includes(): `includes` é
// comparação exata, então `--dry-run` — a grafia que quase todo mundo tenta
// primeiro — passava batido e o script começava a gravação de verdade, 2.179
// chamadas, sem perguntar nada. Aqui bandeira que não existe RECUSA a execução.
// PURO: só lê o array que recebe.
export function interpretarArgumentos(argv) {
  let dry = false;
  let pausaPedida = null;
  let desde = null;

  for (let i = 0; i < (argv || []).length; i++) {
    const arg = argv[i];
    if (arg === '--dry' || arg === '--dry-run') { dry = true; continue; }

    if (arg === '--desde' || (typeof arg === 'string' && arg.startsWith('--desde='))) {
      const bruto = arg === '--desde' ? argv[++i] : arg.slice('--desde='.length);
      const texto = String(bruto ?? '').trim();
      // Data malformada ou impossível PARA o script — nunca vira "sem filtro"
      // (preencheria tudo) nem "data mais próxima" (preencheria o período errado).
      if (!dataDeCalendarioValida(texto)) {
        return { erro: `--desde precisa de uma data real no formato AAAA-MM-DD; veio "${texto}".` };
      }
      desde = texto;
      continue;
    }

    let bruto;
    if (arg === '--pausa') bruto = argv[++i];
    else if (typeof arg === 'string' && arg.startsWith('--pausa=')) bruto = arg.slice('--pausa='.length);
    else return { erro: `não reconheço "${arg}". Só existem --dry (ou --dry-run), --pausa <ms> e --desde AAAA-MM-DD.` };

    const texto = String(bruto ?? '').trim();
    const n = parseInt(texto, 10);
    // Recusa "3000ms", "abc" e o --pausa solto no fim. Cair no padrão em silêncio
    // faria o script correr num ritmo que ninguém pediu.
    if (!Number.isFinite(n) || String(n) !== texto) {
      return { erro: `--pausa precisa de um número em milissegundos; veio "${texto}".` };
    }
    pausaPedida = n;
  }

  const pausa = pausaPedida === null ? PAUSA_PADRAO : Math.max(pausaPedida, PAUSA_MINIMA);
  return { dry, pausa, pausaPedida, desde, erro: null };
}

// --------------------------------------------- a resposta pela metade da Meta

// A Meta já respondeu 200 estruturalmente válido com o detalhe faltando neste
// projeto — é a história inteira em
// supabase/functions/_shared/leitura-de-engajamento.js.
//
// No coletor isso se conserta sozinho: ele regrava a MESMA linha a cada passada.
// Aqui não. Este script grava cada linha UMA vez, e o filtro `conversas=is.null`
// — que existe para proteger — tranca a linha contra qualquer conserto depois.
// Meia resposta gravada aqui é dano PERMANENTE.
//
// Então o critério é conservador: se a Meta devolveu campanhas mas NENHUMA delas
// traz o array `actions`, a resposta não serve e o alvo fica nulo. Ficar nulo é
// "não sei", que é a verdade e é consertável. Gravar zero não é nem uma coisa
// nem outra.
//
// `actions: []` (lista vazia, presente) SERVE: a Meta olhou e não havia ação.
// Diferente de `actions` ausente, que é a Meta não tendo respondido aquilo.
export function respostaTemAcoes(itens) {
  return Array.isArray(itens) && itens.some((i) => Array.isArray(i?.actions));
}
