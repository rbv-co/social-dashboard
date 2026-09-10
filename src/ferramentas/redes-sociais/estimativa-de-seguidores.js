// COMO UM DIA VIRA BARRA NO GRÁFICO "NOVOS SEGUIDORES / DIA".
//
// O PROBLEMA QUE ISTO EXISTE PARA RESOLVER (medido em 2026-08-06):
// de 03 a 06/08 os 7 perfis apareceram com novos seguidores ZERADO. A coleta não
// tinha parado — a contagem total continuava subindo e descendo normalmente. O
// que houve foi o Instagram deixar de publicar a quebra do dia (quantos seguiram
// e quantos saíram), respondendo HTTP 200 com a lista de resultados vazia.
//
// O caminho do estrago era este: a Edge Function `serie-novos-dia` começava com
// `seguiu = 0, deixou = 0` e empurrava esse par para a série mesmo sem resposta.
// O gráfico então desenhava uma barra zerada — indistinguível de um dia em que
// ninguém seguiu de verdade. O dono olhou o painel, viu quatro dias em zero e não
// tinha como saber que aquilo não era um número, era a ausência de um.
//
// A SAÍDA: quando a Meta não publica, o saldo do dia ainda é conhecido por outro
// caminho — a variação da CONTAGEM TOTAL de seguidores, que o coletor grava todo
// dia e que não depende dessa métrica. Breno, por exemplo:
//
//     02/08  24.345          03/08  24.349  → +4
//     04/08  24.352  → +3    05/08  24.351  → −1    06/08  24.351  → 0
//
// Isso é ESTIMATIVA e sai marcado como tal. Ela acerta o saldo do dia, mas não
// separa quem seguiu de quem saiu: 20 entrando e 20 saindo dá o mesmo zero que
// ninguém se mexer. Por isso a barra estimada é desenhada vazada e o número leva
// "≈" na frente — quem olha precisa poder distinguir "o Instagram disse" de
// "nós calculamos".
//
// POR QUE ESTE ARQUIVO É SEPARADO E PURO: a decisão morava solta dentro do
// refresh da tela, misturada com fetch, cache e DOM, onde não dá para testar. É a
// mesma separação de series-diarias-de-meta-ads.js ao lado.

/**
 * Variação da contagem total de um dia para o anterior.
 * `contagemPorDia`: { 'YYYY-MM-DD': número de seguidores no fim do dia }.
 * Devolve null quando falta o dia ou o anterior — sem base, não se inventa nada.
 */
export function netPelaContagem(contagemPorDia, dia) {
  const mapa = contagemPorDia || {};
  const aqui = mapa[dia];
  const antes = mapa[diaAnterior(dia)];
  if (aqui == null || antes == null) return null;
  return Number(aqui) - Number(antes);
}

/** O dia civil anterior, em YYYY-MM-DD. Meio-dia para não escorregar de fuso. */
export function diaAnterior(dia) {
  const d = new Date(dia + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Transforma um dia da série numa barra.
 *
 * `dia`   = { label, seguiu, deixou, publicado } como vem de serie-novos-dia.
 * `pular` = dias que o chamador desenha à parte (hoje/ontem, que já usam a
 *           contagem AO VIVO e não devem ser estimados aqui de novo).
 *
 * Devolve { iso, g, l, net, est }:
 *   net = barra única (só o saldo, sem quebra por dentro);
 *   est = o número é estimativa nossa, não número publicado pelo Instagram.
 */
export function barraDoDia(dia, contagemPorDia, pular = []) {
  // O `=== false` é DE PROPÓSITO, não descuido: série vinda de cache antigo (o
  // cache da tela dura 3 min) ou de uma Edge Function ainda não atualizada chega
  // SEM o campo `publicado`. Nesse caso `undefined` não pode virar estimativa —
  // o certo é manter o comportamento de antes até o dado novo chegar.
  const naoPublicado = dia.publicado === false && !pular.includes(dia.label);
  if (!naoPublicado) {
    return { iso: dia.label, g: Number(dia.seguiu) || 0, l: Number(dia.deixou) || 0, net: false, est: false };
  }
  const n = netPelaContagem(contagemPorDia, dia.label);
  // Sem contagem para estimar (histórico curto, perfil novo): fica zero, mas
  // MARCADO. Zero marcado é honesto; zero sem marca é o defeito original.
  if (n == null) return { iso: dia.label, g: 0, l: 0, net: true, est: true };
  return { iso: dia.label, g: n >= 0 ? n : 0, l: n < 0 ? -n : 0, net: true, est: true };
}

/** Os dias da série que o Instagram não publicou — alimenta a nota do gráfico. */
export function diasSemPublicacao(serie, pular = []) {
  return (serie || [])
    .filter((d) => d && d.publicado === false && !pular.includes(d.label))
    .map((d) => d.label);
}

/**
 * O NÚMERO DO CARD: a soma do que o gráfico está desenhando.
 *
 * Decisão do dono (09/09/2026): "o importante é o card de novos seguidores bater
 * sempre com o gráfico diário".
 *
 * ⚠️ O ERRO DE ORIGEM ERA PERSEGUIR O PAINEL PROFISSIONAL. Ele filtra OUTRO
 * período — medido pelo dono no painel dele: "últimos 7 dias" vai de 2 a 7, e
 * "5 a 8" mostra 4 a 7. Enquanto se tentava casar os dois, o card e o gráfico da
 * NOSSA tela divergiam entre si — e é isso que a pessoa vê. Medido no mesmo dia,
 * em "últimos 7 dias" na Vessel: barras somando 1593, card mostrando 967, porque a
 * janela do card parava no dia 08 e deixava de fora os dois maiores dias.
 *
 * ⚠️ A BARRA ESTIMADA GUARDA O LÍQUIDO, não a quebra: o saldo positivo entra em
 * `gained`, o negativo em `lost`. Por isso `seguiu`/`deixou` são aproximados
 * quando há dia estimado — o total é que continua certo. Quem usa `seguiu` como
 * denominador de custo precisa olhar `estimado` e marcar prévia.
 *
 * Devolve `null` quando não há gráfico: zero seria "não seguiu ninguém", uma
 * afirmação, onde a verdade é "não há de onde somar".
 */
export function totalPelasBarras(chart) {
  const g = chart && Array.isArray(chart.gained) ? chart.gained : null;
  if (!g || !g.length) return null;
  const l = chart && Array.isArray(chart.lost) ? chart.lost : [];
  const est = chart && Array.isArray(chart.estimado) ? chart.estimado : [];
  const soma = (arr) => arr.reduce((t, v) => t + (Number(v) || 0), 0);
  const seguiu = soma(g), deixou = soma(l);
  return { seguiu, deixou, total: seguiu - deixou, estimado: est.some(Boolean) };
}
