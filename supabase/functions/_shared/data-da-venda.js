// A venda conta no dia em que a NOTA saiu, não no dia em que o pedido foi feito.
//
// POR QUE ISTO EXISTE
// O Bling devolve os pedidos por data do PEDIDO. Só que a loja emite NFC-e no
// mesmo dia e o Atacado emite NF-e no dia seguinte — então a venda de sexta
// aparecia na quinta. Medido em 11/08/2026 sobre 12 meses: **197 dos 325 dias
// com venda mostravam valor errado**, erro médio de R$ 2.487,58 por dia. A
// Black Friday de 2025 aparecia com R$ 14.717,76 quando foram R$ 3.167,83.
//
// A data certa é coletada pelo robô coletor/notas-dos-pedidos.mjs e mora em
// `bling_pedido_nota`. Este módulo é a ponte: pega o que o Bling devolveu e
// devolve o que a janela realmente contém.
//
// POR QUE ELE MORA EM `supabase/functions/_shared/` E NÃO EM `src/`
// Três lugares precisam desta MESMA regra: as telas (Gestão à Vista e Análise
// de Vendas), a Edge da notificação de vendas e os robôs do coletor. A Edge
// roda no Deno e NÃO alcança `src/`. Então a regra mora aqui, onde os três
// chegam — mesmo arranjo de `checklist.js` e `rabisco.js`, pelo mesmo motivo.
// Duas cópias da mesma regra é como duas telas decidindo o mesmo: mais cedo ou
// mais tarde elas discordam, e ninguém sabe qual está certa.
//
// DUAS REGRAS QUE PARECEM DETALHE E NÃO SÃO:
//
// 1. **Pedido sem resposta nossa fica como está.** Se a tabela ainda não tem a
//    linha (o robô roda de hora em hora; um pedido feito agora não passou por
//    ele), o pedido mantém a data do pedido. É o comportamento de hoje, e é o
//    certo: para um pedido de hoje, a nota de hoje dá no mesmo. Sumir com ele
//    da tela por falta de informação seria trocar um erro pequeno por um buraco.
//
// 2. **A data original é preservada em `dataDoPedido`.** A Gestão à Vista grava
//    `pedido_data` no cache `bling_pedido_vendedor`; se ela gravasse a data da
//    nota numa coluna chamada "data do pedido", a mentira ficaria no banco e
//    ninguém desconfiaria depois.

const soDia = (v) => String(v ?? '').slice(0, 10);
const dentro = (dia, di, df) => !!dia && dia >= soDia(di) && dia <= soDia(df);

// ── O ESTADO DA NOTA ────────────────────────────────────────────────────────
//
// Pedido do dono em 22/09/2026: "não pode acontecer de mostrar pedido
// rejeitado, não autorizado, somente os que estiverem autorizado".
//
// Os números são os do Bling. Medido na nossa base: a NFC-e da loja fica em 5
// e a NF-e do atacado vai para 6 — as duas querem dizer autorizada, e 6 é só
// "autorizada e com a DANFE já emitida". Tratar 6 como "outra coisa" apagaria
// R$ 643 mil de NF-e da conta.
export const NOTA_AUTORIZADA = new Set([5, 6]);

// Nota cancelada (2), rejeitada (4) ou denegada (9) NÃO é venda e sai.
export const NOTA_NEGADA = new Set([2, 4, 9]);

// ⚠️ E A PENDENTE TAMBÉM SAI — mas isto foi MEDIDO antes, não deduzido.
//
// Este arquivo dizia, até 22/09/2026, que pendente ficava: "tirar a venda de
// hoje porque a nota ainda não voltou da Sefaz deixaria o painel vazio toda
// manhã". O medo é legítimo e a medição desmentiu ele. Na base inteira existem
// QUATRO linhas em situação 1, e nenhuma é de hoje: têm 18, 22, 25 e 26 dias.
// Nota que a Sefaz vai autorizar volta em segundos; a que fica pendente por
// três semanas ficou travada, e travada não é faturamento.
//
// E a venda de hoje não corre risco nenhum por outro motivo: enquanto o coletor
// não gravou a linha dela, ela cai na REGRA 1 (sem linha, fica como está) e
// continua na tela. O que sai daqui é só o que já tem linha E continua sem
// autorização depois de dias.
//
// Conferido pedido a pedido no Bling ao vivo em 22/09/2026: das quatro, uma
// segue mesmo pendente lá (#2550) e TRÊS respondem 404 — a nota foi apagada no
// Bling e a nossa tabela ficou com o número de uma nota que não existe mais.
export const NOTA_PENDENTE = new Set([1]);

// ⚠️ O QUE NÃO ESTÁ NESTAS LISTAS FICA, E ISSO É DE PROPÓSITO.
//
// `nota_situacao` NULO são 106 linhas, R$ 29.620,05, de 01/08/2025 a 02/08/2026
// — pedidos anteriores a termos começado a guardar o estado da nota. Trocar a
// regra por "só passa quem está autorizado" apagaria os R$ 29 mil de uma vez,
// e a tela cairia sem ninguém entender por quê. Situação 0 (3 linhas, R$ 505,30,
// todas de 01/12/2025) também fica: o Bling confirma o 0, mas eu não tenho
// prova do que ele significa, e falta de prova não apaga dinheiro.
// Mesma postura de `canal-fechado.js`: esconder é a exceção, e exceção precisa
// de prova.
const notaAutorizada = (l) => NOTA_AUTORIZADA.has(Number(l?.nota_situacao));
const notaNegada = (l) => NOTA_NEGADA.has(Number(l?.nota_situacao));
const notaPendente = (l) => NOTA_PENDENTE.has(Number(l?.nota_situacao));

// ── O ajuste, puro e testável ─────────────────────────────────────────────
// pedidos : o que o Bling devolveu para a janela (por data do pedido)
// linhas  : linhas de bling_pedido_nota que tocam a janela
//           [{ pedido_id, pedido_numero, data_pedido, data_da_venda, total, loja_id }]
// Devolve { pedidos, trazidos, removidos, semResposta, pendentes }.
export function ajustarPelaDataDaNota(pedidos, linhas, di, df) {
  const porId = new Map();
  for (const l of linhas || []) porId.set(String(l.pedido_id), l);

  const saida = [];
  const vistos = new Set();
  let removidos = 0, semResposta = 0, pendentes = 0;

  for (const p of pedidos || []) {
    const id = String(p?.id ?? '');
    vistos.add(id);
    const linha = porId.get(id);
    const dataDoPedido = soDia(p?.data);
    if (!linha) {
      // Regra 1: sem resposta nossa, fica como está.
      semResposta++;
      saida.push({ ...p, dataDoPedido });
      continue;
    }
    // ⚠️ NOTA NEGADA TIRA A VENDA, mesmo o pedido estando "atendido" no Bling.
    // Pedido atendido com nota rejeitada ou cancelada não é faturamento: é uma
    // venda que não se completou.
    if (notaNegada(linha)) { removidos++; continue; }
    // ⚠️ E A PENDENTE TAMBÉM — contada à parte, para não sumir calada. Ver o
    // bloco de NOTA_PENDENTE lá em cima: é o pedido explícito do dono
    // ("somente os que estiverem autorizado, tudo ok verdinho bonitinho") e a
    // medição que mostrou que nenhuma pendente da base é de hoje.
    if (notaPendente(linha)) { removidos++; pendentes++; continue; }
    const dataDaVenda = soDia(linha.data_da_venda) || dataDoPedido;
    if (!dentro(dataDaVenda, di, df)) { removidos++; continue; }
    saida.push({ ...p, data: dataDaVenda, dataDoPedido });
  }

  // Os que ENTRAM: a nota caiu nesta janela, mas o pedido é de antes — o Bling
  // não os devolveu, e são justamente as vendas que hoje somem do dia certo.
  let trazidos = 0;
  for (const l of linhas || []) {
    const id = String(l.pedido_id);
    if (vistos.has(id)) continue;
    // ⚠️ AQUI SÓ ENTRA NOTA AUTORIZADA, e esta linha é o conserto de um número
    // errado que o dono viu na tela em 22/09/2026: a Gestão à Vista mostrava
    // R$ 6.900 para 21/09 porque o pedido 2680 — CANCELADO no Bling — foi
    // trazido daqui. Este bloco inventa um pedido a partir da tabela, e o
    // Bling ao vivo NÃO o devolveu justamente porque ele não é mais venda.
    // Exigir a nota autorizada fecha os dois buracos de uma vez: o pedido
    // cancelado não tem nota autorizada, e o rejeitado também não.
    if (!notaAutorizada(l)) continue;
    const dataDaVenda = soDia(l.data_da_venda);
    if (!dentro(dataDaVenda, di, df)) continue;
    trazidos++;
    saida.push({
      id: l.pedido_id,
      numero: l.pedido_numero ?? undefined,
      data: dataDaVenda,
      dataDoPedido: soDia(l.data_pedido),
      total: Number(l.total) || 0,
      loja: l.loja_id != null ? { id: l.loja_id } : undefined,
      trazidoDeOutroDia: true,
    });
  }

  return { pedidos: saida, trazidos, removidos, semResposta, pendentes };
}

