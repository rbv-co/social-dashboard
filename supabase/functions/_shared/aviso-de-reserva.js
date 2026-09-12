/* O TEXTO DO AVISO DA RESPOSTA AO PEDIDO DE CARRO.
 *
 * Puro, sem rede: a Edge busca os dados e passa pra cá — mesmo molde de
 * aviso-de-checklist.js.
 *
 * POR QUE ESTE AVISO EXISTE. Medido em 20/08/2026: aprovar ou recusar uma
 * reserva é um UPDATE e nada mais. Não sai push, não sai e-mail, e quem pediu
 * o carro só descobre a resposta se abrir o aplicativo e olhar. Quem recusa é
 * OBRIGADO pela tela a escrever o motivo — "quem pediu precisa saber o que
 * fazer diferente" — e esse motivo ficava esperando alguém passar por ele.
 *
 * O MOTIVO DA RECUSA VAI NO CORPO, e não só um "seu pedido foi recusado".
 * Recusa sem motivo faz a pessoa pedir de novo igual, e o segundo pedido morre
 * pela mesma razão do primeiro. */

const ms = (v) => { const t = Date.parse(v); return Number.isFinite(t) ? t : null; };

/** Data e hora do jeito que se lê em voz alta, no fuso de Brasília. */
export function quandoNoAviso(iso) {
  const t = ms(iso);
  if (t === null) return null;
  const d = new Date(t);
  const data = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' });
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
  return `${data} às ${hora}`;
}

/* Um push com um parágrafo dentro é cortado pelo sistema do celular, e cortado
 * no meio de uma frase. Melhor cortar aqui, onde dá pra pôr as reticências. */
const LIMITE_DO_MOTIVO = 120;
function encurtar(texto) {
  const t = String(texto || '').trim().replace(/\s+/g, ' ');
  if (t.length <= LIMITE_DO_MOTIVO) return t;
  return t.slice(0, LIMITE_DO_MOTIVO - 1).trimEnd() + '…';
}

/**
 * O aviso de uma reserva decidida, ou `null` quando não há o que avisar.
 *
 * Devolve `null` de propósito para situação que não é decisão (pendente,
 * cancelada): mandar "sua reserva está pendente" para o celular de alguém é o
 * tipo de aviso que ensina a ignorar aviso.
 */
export function montarAvisoDeReserva({ requisicao, veiculo } = {}) {
  const r = requisicao || {};
  const nomeDoCarro = (veiculo && veiculo.nome) || 'o veículo';
  const quando = quandoNoAviso(r.retirada_prevista);
  // O QUE foi decidido vem antes do resto: é a primeira coisa que a pessoa lê
  // na tela travada do celular, e às vezes a única.
  const partes = [nomeDoCarro];
  if (quando) partes.push(quando);

  if (r.situacao === 'aprovada') {
    if (r.destino) partes.push(String(r.destino).trim());
    return {
      titulo: 'Reserva aprovada',
      corpo: partes.join(' · '),
      url: '/frota',
    };
  }
  if (r.situacao === 'recusada') {
    const motivo = encurtar(r.motivo_decisao);
    return {
      titulo: 'Reserva recusada',
      // Sem motivo escrito a frase não finge que tem um: manda perguntar a
      // quem decidiu, que é o que sobra de verdade pra fazer.
      corpo: motivo ? `${partes.join(' · ')} — ${motivo}`
        : `${partes.join(' · ')} — sem motivo escrito. Fale com quem administra a Frota.`,
      url: '/frota',
    };
  }
  // REVOGADA e CANCELADA são as duas em que outra pessoa mexeu na reserva
  // alheia — a tela que faz isso exige motivo escrito ("quem pediu o carro
  // precisa saber"), e quem pediu NUNCA cancela a própria pela tela: cancelar
  // exige permissão de aprovar. Deixar qualquer uma das duas de fora era
  // engolir justamente o motivo que a tela obrigou alguém a escrever.
  //
  // As palavras são diferentes porque as situações são: cancelada é a reserva
  // que ainda não tinha começado; revogada é a que já valia e foi encerrada no
  // meio — e essa segunda pode pegar alguém a caminho do estacionamento.
  if (r.situacao === 'revogada' || r.situacao === 'cancelada') {
    const motivo = encurtar(r.encerrada_motivo);
    const titulo = r.situacao === 'revogada'
      ? 'A sua reserva foi encerrada'
      : 'A sua reserva foi cancelada';
    return {
      titulo,
      corpo: motivo ? `${partes.join(' · ')} — ${motivo}`
        : `${partes.join(' · ')} — o carro não está mais reservado para você.`,
      url: '/frota',
    };
  }
  return null;
}
