// QUAL CAPTURA DO AGREGADO PODE FALAR PELA JANELA QUE A TELA DIZ ESTAR MOSTRANDO.
//
// A seção 02 lê `campaign_insights` no agregado (period_days = 7/30/99…): cada
// linha é uma campanha, e o conjunto de linhas com o MESMO `captured_at` é uma
// captura — a foto que o coletor tirou naquele dia daquela janela de N dias.
//
// A consulta limita a data POR CIMA (`captured_at=lte.<hoje>`) e pega a mais
// recente. Enquanto a consulta trazia TODAS as campanhas da conta, a mais recente
// era sempre a última rodada do coletor, e limitar por baixo era desnecessário.
//
// COM O RECORTE POR TIPO DE CAMPANHA ISSO DEIXOU DE VALER. A consulta agora leva
// `campaign_id=in.(…)`, então a captura mais recente é a mais recente DAQUELAS
// campanhas — e um tipo de campanha parado há meses devolve uma foto de meses
// atrás. Medido em produção (17/08/2026): no Breno Vale, em 7D, o tipo "Site e
// alcance" trazia 488 impressões, 2 cliques e 478 de alcance de uma captura de
// 08/06/2026 — setenta dias — impressos como "os últimos 7 dias", sem marca
// nenhuma. Com a Meta muda, o cartão de investimento imprimia R$ 6,32 como o
// gasto da semana e os custos dividiam esse número.
//
// A régua desta obra vale aqui como vale no resto dela: NUNCA IMPRIMIR UMA
// MEDIÇÃO QUE NÃO FOI FEITA NA JANELA QUE SE ESTÁ AFIRMANDO. Captura de fora da
// janela não vira número — vira "—", e a tela diz de quando ela é.
// PURO: sem rede, sem tela.

// Datas do PostgREST chegam como texto ISO ('2026-08-17'), e ISO ordena igual em
// texto e no calendário — por isso a comparação é de string, sem Date nenhum
// (Date aqui só traria fuso para dentro de uma conta que é de dia inteiro).
export function capturaEstaNaJanela(data, janela) {
  if (!data) return false;
  const j = janela || {};
  const d = String(data);
  if (j.inicio && d < String(j.inicio)) return false;
  if (j.fim && d > String(j.fim)) return false;
  return true;
}

// Escolhe a captura mais recente da resposta e diz se ela vale para a janela.
//
// `linhas` vem do PostgREST já ordenado por `captured_at` DESC e limitado por
// cima, então a primeira linha É a captura mais recente e nenhuma outra pode ser
// mais nova: se a primeira está velha demais, todas estão.
//
// Devolve sempre o mesmo formato, para quem chama não ter de adivinhar:
//   { data, foraDaJanela, linhas } — `linhas` é a captura inteira quando ela
//   vale, e vazia quando não vale. `data` continua preenchida mesmo fora da
//   janela, porque é ela que a tela mostra no aviso ("a última coleta é de …").
export function capturaDoAgregado(linhas, janela) {
  const lista = Array.isArray(linhas) ? linhas : [];
  if (lista.length === 0) return { data: null, foraDaJanela: false, linhas: [] };
  const data = String(lista[0].captured_at);
  if (!capturaEstaNaJanela(data, janela)) return { data, foraDaJanela: true, linhas: [] };
  return { data, foraDaJanela: false, linhas: lista.filter(r => String(r.captured_at) === data) };
}

/**
 * TODAS as capturas DIÁRIAS dentro de um intervalo escolhido.
 *
 * ⚠️ OS CARTÕES DE META ADS NUNCA TIVERAM JANELA PERSONALIZADA. Eles liam
 * `period_days = closestStoredPeriod(dias)` — arredondavam o intervalo para a
 * captura agregada de 1, 7, 14 ou 30 dias mais próxima e pegavam UMA captura.
 * Escolher 5 a 9 (4 dias) caía na de 1 dia; vindo de "7 dias", caía na mesma de
 * antes, e por isso os números não mudavam ao trocar o período. Achado pelo dono
 * em 09/09/2026.
 *
 * Aqui é diferente de `capturaDoAgregado`, e de propósito: lá se escolhe UMA
 * captura (a mais nova) e se recusa quando ela é velha demais. Aqui se SOMAM os
 * dias do intervalo — e não existe "captura velha": ou o dia está dentro, ou não
 * é desta janela. Por isso `foraDaJanela` é sempre falso.
 *
 * ⚠️ QUEM SOMA ALCANCE POR AQUI ESTÁ SOMANDO PESSOA REPETIDA: a mesma pessoa
 * alcançada em três dias conta três vezes. O nível-conta (`account_insights`) não
 * ajuda num intervalo, porque lá também há uma linha por captura. O cartão TEM de
 * dizer que o alcance está somado — é o que o `alcanceSomado` já faz.
 */
export function capturasDaJanela(linhas, janela) {
  const j = janela || {};
  const vazio = { dias: [], linhas: [], foraDaJanela: false, data: null };
  if (!j.inicio || !j.fim) return vazio;
  const dentro = (Array.isArray(linhas) ? linhas : []).filter((r) => {
    const d = r && r.captured_at ? String(r.captured_at) : null;
    return d && d >= j.inicio && d <= j.fim;
  });
  const dias = [...new Set(dentro.map((r) => String(r.captured_at)))].sort();
  return { dias, linhas: dentro, foraDaJanela: false, data: dias[dias.length - 1] || null };
}
