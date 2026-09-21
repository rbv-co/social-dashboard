// O VIGIA DO ESPELHO DA VESSEL: uma linha por ETAPA em `robos_execucoes`.
//
// ⚠️ O FURO QUE ISTO FECHA (medido em 21/09/2026)
// `vessel-espelhar-lista` faz duas coisas independentes numa rodada: escreve a
// planilha no Zoho e cadastra a pessoa no Bling. Ela devolve HTTP 200 quando
// UMA das duas dá certo — e isso é de propósito: derrubar a rodada inteira
// porque o Zoho caiu perderia o cadastro no Bling, que já funcionava.
// Consequência: `conferir_robos()` calcula `ok = status_code entre 200 e 299`,
// então a rodada em que a planilha NÃO subiu ficava registrada como sucesso.
// Aconteceu de verdade às 17h09 de 21/09.
//
// A saída escolhida pelo dono: o robô grava uma linha POR ETAPA, com nome
// próprio. O vigia (`robos_saude`) junta as variantes por PREFIXO
// (`e.robo like x.robo || '%'`) e a situação do robô é a da PIOR variante viva
// — é o desenho que ele já usa desde 19/08 para os perfis do `coletar-dados`.
// Então basta `vessel-espelhar-lista` estar em `robos_esperados`: as duas
// etapas entram como variantes e cada uma acusa sozinha.
//
// ⚠️ ESTE ARQUIVO É A PARTE QUE PODE INVERTER EM SILÊNCIO. Se `etapaFalhou`
// errar, o vigia passa a dizer "em dia" para sempre — que é exatamente o
// defeito que estamos consertando, só mais difícil de achar. Por isso ele mora
// aqui, puro, com teste ao lado, em vez de dentro da edge.

export const ROBO = 'vessel-espelhar-lista';
export const ETAPA_PLANILHA = `${ROBO} · planilha`;
export const ETAPA_BLING = `${ROBO} · bling`;

/**
 * O filtro da faxina do próprio rastro.
 *
 * ⚠️ O ` · ` NO FIM NÃO É ENFEITE. Sem ele o filtro seria `vessel-espelhar-lista%`
 * e pegaria também a linha da RODADA, que não é nossa: ela é gravada por
 * `disparar_robo`, vale para o histórico de 60 dias de todos os robôs, e é a
 * única prova de que o robô está sendo chamado. Apagá-la faria o painel dizer
 * "sem registro ainda" de um robô que roda de 3 em 3 minutos.
 */
export const ROBO_ETAPAS_LIKE = `${ROBO} · %`;

// Quantos dias de histórico POR ETAPA guardar. O robô limpa o próprio rastro.
//
// ⚠️ A CONTA QUE DECIDIU ESTE NÚMERO: são 2 linhas a cada 3 minutos, 960 por
// dia. Guardadas os 60 dias que `conferir_robos()` usa para todo mundo, seriam
// ~25 MB num banco de 126 MB — e o plano é FREE, com teto de 500 MB. Cinco por
// cento do total só de termômetro.
// Sete dias custam ~3 MB e respondem "quando parou?" com folga: a view aposenta
// variante que não dá sinal em 72h e conta falhas em 24h. As linhas da RODADA
// (as que `disparar_robo` grava) continuam com os 60 dias de todos.
export const DIAS_DE_HISTORICO = 7;

/**
 * A etapa falhou?
 *
 * ⚠️ `bloqueado:` CONTA COMO FALHA, e é decisão consciente. É o estado de
 * "o app do Bling perdeu a permissão de contatos": ninguém está sendo
 * cadastrado, e o dono precisa reautorizar. Chamar isso de "em dia" porque a
 * causa é conhecida é como desligar o alarme porque o incêndio tem explicação.
 *
 * Tudo o que não começa com `falhou:` nem `bloqueado:` é sucesso — inclusive
 * "nenhum pendente" e "em dia", que são trabalho concluído sem ter o que fazer.
 */
export function etapaFalhou(texto) {
  const s = String(texto ?? '').trim();
  return s.startsWith('falhou:') || s.startsWith('bloqueado:');
}

/**
 * As duas linhas a gravar, a partir do resultado da rodada.
 *
 * @param resultado  o objeto que a rodada devolve (`planilha`, `bling`, `cadastros`)
 * @param agora      instante em texto ISO, injetado para o teste não depender do relógio
 */
export function linhasDoVigia(resultado, agora) {
  const r = resultado ?? {};
  const falhouAPlanilha = etapaFalhou(r.planilha);
  // ⚠️ "Completar a ficha no Bling" (`cadastros`) ENTRA NA ETAPA DO BLING, e não
  // numa terceira. As duas falam com a mesma API, com o mesmo token: quando uma
  // cai, a outra cai junto, e duas variantes acusariam o mesmo problema duas
  // vezes — no plano free cada variante custa disco.
  const falhouOBling = etapaFalhou(r.bling) || etapaFalhou(r.cadastros);

  // ⚠️ `conferido_em` JÁ VEM PREENCHIDO. `conferir_robos()` só mexe em linha com
  // `conferido_em is null`, procurando a resposta em `net._http_response` pelo
  // `request_id`. Estas linhas não vêm de `disparar_robo` e não têm pedido
  // nenhum a casar: sem esta marca ficariam na fila de conferência por 6 horas
  // e seriam fechadas como "a resposta foi apagada pelo pg_net" — com `ok` nulo,
  // que a view lê como "nunca deu certo". O termômetro viraria o alarme.
  return [
    {
      robo: ETAPA_PLANILHA,
      ok: !falhouAPlanilha,
      conferido_em: agora,
      resposta: String(r.planilha ?? 'a rodada não disse nada da planilha').slice(0, 500),
    },
    {
      robo: ETAPA_BLING,
      ok: !falhouOBling,
      conferido_em: agora,
      resposta: `cadastrar: ${r.bling ?? '—'} · completar a ficha: ${r.cadastros ?? '—'}`.slice(0, 500),
    },
  ];
}
