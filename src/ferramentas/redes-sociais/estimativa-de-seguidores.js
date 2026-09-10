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
 * O QUE FALTA NA JANELA: os dias sem bruto e quanto eles valem pela contagem.
 *
 * ⚠️ O DIA NÃO PUBLICADO SOME DO AGREGADO DA META, e some CALADO. Medido em
 * 09/09/2026 na Vessel: a janela [05/09, 09/09) tem quatro dias, o dia 08 valeu
 * ~443 líquidos, e a Meta devolveu 907/24 — o mesmo que os três dias publicados.
 * Nenhum campo diz "faltou um dia": o total simplesmente sai menor. E a tela
 * ainda carimbava "✓ confirmado pelo Instagram" em cima disso.
 *
 * `snaps` = linhas de `daily_snapshots` ({ captured_at, gained, lost }).
 * `contagemPorDia` = { 'YYYY-MM-DD': seguidores no fim do dia }.
 * `inicio`/`fim` = a janela do card, INCLUSIVE nos dois lados.
 *
 * Devolve `{ dias, estimativa }`.
 *
 * ⚠️ `dias` E `estimativa` SÃO INDEPENDENTES DE PROPÓSITO: um dia sem bruto e sem
 * contagem do dia anterior entra em `dias` com estimativa zero. É o que faz o selo
 * dizer "falta o dia 8" em vez de "confirmado" — perder o aviso porque não deu
 * para estimar seria trocar um número errado por um número errado e silencioso.
 */
export function faltaNaJanela(snaps, contagemPorDia, inicio, fim) {
  const dias = [];
  let estimativa = 0;
  for (const s of Array.isArray(snaps) ? snaps : []) {
    const dia = s && s.captured_at;
    if (!dia || dia < inicio || dia > fim) continue;
    if ((Number(s.gained) || 0) > 0 || (Number(s.lost) || 0) > 0) continue;
    dias.push(dia);
    const net = netPelaContagem(contagemPorDia, dia);
    if (net != null) estimativa += net;
  }
  return { dias, estimativa };
}
