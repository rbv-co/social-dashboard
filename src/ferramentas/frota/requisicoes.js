/* Requisição de uso: pedir o carro para uma data, e alguém aprovar.
 *
 * É o formulário de papel de hoje (Controle_Frota.pdf) virando tela. O manual
 * da planilha diz por que ele existe: "o ideal é fazer o pedido com 3 dias de
 * antecedência para não haver CONFLITO DE VIAGENS entre os departamentos".
 *
 * Esse conflito é justamente o que o papel não consegue ver — cada requisição
 * é uma folha solta, e ninguém compara as folhas. É a única coisa aqui que o
 * app faz e a pasta de PDFs nunca fez. */

export const SITUACOES = {
  pendente:  { rotulo: 'Aguardando aprovação', cor: 'espera' },
  aprovada:  { rotulo: 'Aprovada', cor: 'boa' },
  recusada:  { rotulo: 'Recusada', cor: 'ruim' },
  cancelada: { rotulo: 'Cancelada', cor: 'neutra' },
  usada:     { rotulo: 'Já usada', cor: 'neutra' },
};

export const ANTECEDENCIA_IDEAL_DIAS = 3;

const ms = (v) => { const t = Date.parse(v); return Number.isFinite(t) ? t : null; };
const DIA = 86400000;

/**
 * Duas reservas do MESMO veículo se atropelam?
 * Encostar não é conflito: quem devolve às 12h e quem pega às 12h passam a
 * chave na mão. Só cruzar conta.
 */
export function seAtropelam(a, b) {
  const ai = ms(a && a.retirada_prevista), af = ms(a && a.devolucao_prevista);
  const bi = ms(b && b.retirada_prevista), bf = ms(b && b.devolucao_prevista);
  if (ai === null || bi === null) return false;
  // Reserva sem hora de volta é tratada como o dia inteiro: quem não sabe
  // quando volta está ocupando o carro até o fim do dia, não por um instante.
  const fimA = af === null ? ai + DIA : af;
  const fimB = bf === null ? bi + DIA : bf;
  return ai < fimB && bi < fimA;
}

/** As reservas que disputam o carro com esta. Só pendente e aprovada disputam. */
export function conflitosDe(requisicao, todas) {
  if (!requisicao) return [];
  return (todas || []).filter((r) =>
    r && r.id !== requisicao.id
    && r.veiculo_id === requisicao.veiculo_id
    && (r.situacao === 'pendente' || r.situacao === 'aprovada')
    && seAtropelam(requisicao, r));
}

/**
 * Problemas de uma requisição ANTES de gravar. Devolve avisos em português.
 * Cada um traz `bloqueia`: true impede gravar, false é só um alerta.
 */
export function problemasDaRequisicao(req, todas, agoraIso) {
  const p = [];
  const agora = ms(agoraIso) ?? Date.now();
  const ini = ms(req && req.retirada_prevista);
  const fim = ms(req && req.devolucao_prevista);

  if (!req || !req.veiculo_id) p.push({ bloqueia: true, texto: 'Escolha o veículo.' });
  // Quem vai dirigir pode ser um COLABORADOR (`pessoa_id`) ou alguém de fora,
  // escrito na hora (`pessoa_nome` sem id) — ver nomes-de-fora.js. Exigir só o
  // `pessoa_id` foi o que obrigou o dono a se pôr como motorista pra registrar
  // o Felipe, e a multa da quinzena cairia no nome errado.
  if (!req || (!req.pessoa_id && !String(req.pessoa_nome || '').trim())) {
    p.push({ bloqueia: true, texto: 'Escolha quem vai dirigir, ou escreva o nome de quem é de fora.' });
  }
  if (ini === null) {
    p.push({ bloqueia: true, texto: 'Informe quando você vai retirar o carro.' });
  } else {
    if (fim !== null && fim <= ini) {
      p.push({ bloqueia: true, texto: 'A devolução tem que ser depois da retirada.' });
    }
    if (ini < agora - DIA) {
      // Registrar viagem passada é legítimo (alguém esqueceu de pedir), mas
      // quase sempre é data digitada errada. Avisa e deixa seguir.
      p.push({ bloqueia: false, texto: 'Essa data já passou. Confirme se é isso mesmo.' });
    } else if (ini - agora < ANTECEDENCIA_IDEAL_DIAS * DIA) {
      p.push({
        bloqueia: false,
        texto: `O combinado é pedir com ${ANTECEDENCIA_IDEAL_DIAS} dias de antecedência, `
          + 'para não atropelar viagem de outro departamento. Dá pra pedir assim mesmo.',
      });
    }
  }
  if (!req || !String(req.destino || '').trim()) {
    p.push({ bloqueia: false, texto: 'Sem destino, quem aprova não sabe o que está aprovando.' });
  }

  for (const c of conflitosDe(req, todas)) {
    p.push({
      bloqueia: false,
      texto: `Esse carro já está reservado nesse horário${c.pessoa_nome ? ' por ' + c.pessoa_nome : ''}`
        + `${c.destino ? ' (' + c.destino + ')' : ''}. Escolha outro carro, outro horário, `
        + 'ou combine com quem pediu antes.',
    });
  }
  return p;
}

/** Só o que impede gravar. */
export function bloqueios(problemas) {
  return (problemas || []).filter((x) => x && x.bloqueia);
}

/**
 * Quem pode decidir esta requisição.
 *
 * ATÉ 12/08/2026 o solicitante ficava de fora, para a aprovação ser um segundo
 * par de olhos. O dono derrubou a regra, ciente do que se perde: com dois
 * aprovadores e a maior parte dos pedidos saindo dele mesmo, ela não produzia
 * revisão nenhuma — produzia requisição parada. Duas ficaram travadas desde
 * 11/08 sem saída nenhuma pela tela, e é isso que este `podeDecidir` conserta.
 *
 * O que NÃO se perde: `decidida_por` e `decidida_em` continuam gravando quem
 * decidiu. O rastro segue no banco; o que o dono dispensou foi o aviso na tela.
 */
export function podeDecidir({ requisicao, temPermissaoAprovar }) {
  if (!temPermissaoAprovar) return { pode: false, motivo: 'sem-permissao' };
  if (!requisicao || requisicao.situacao !== 'pendente') return { pode: false, motivo: 'ja-decidida' };
  return { pode: true, motivo: null };
}

/** A frase que a tela mostra quando não dá pra decidir.
 *
 * O caso 'propria' saiu junto com a regra que o produzia (12/08/2026). Não
 * ficou como resposta órfã de propósito: frase que a tela nunca mostra é frase
 * que alguém lê no código e acredita. */
export function motivoEmPortugues(motivo) {
  switch (motivo) {
    case 'ja-decidida': return 'Esta requisição já foi decidida.';
    case 'sem-permissao': return 'Você não aprova requisições de veículo.';
    default: return '';
  }
}

/** Ordena a fila de quem aprova: o que sai antes, primeiro. */
export function ordenarFila(reqs) {
  return (reqs || []).slice().sort((a, b) =>
    (ms(a.retirada_prevista) ?? Infinity) - (ms(b.retirada_prevista) ?? Infinity));
}

/** Data e hora do jeito que se lê em voz alta. */
export function quando(iso) {
  const t = ms(iso);
  if (t === null) return '—';
  const d = new Date(t);
  const data = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `${data} às ${hora}`;
}

/**
 * Esta pessoa tem reserva APROVADA pra pegar este carro agora?
 *
 * De onde veio: até 12/08/2026 a aba Motorista tinha "Vou usar" ao lado de
 * "Reservar", e o dono mandou tirar o primeiro — com os dois lado a lado, quem
 * quisesse evitar o pedido bastava tocar no outro, e a aprovação virava enfeite.
 *
 * Mas tirar o botão sem mais nada abriria um buraco: aprovar NÃO cria o
 * registro de uso, então o carro nunca ficaria "na rua" e o "Devolver" nunca
 * apareceria. A saída escolhida pelo dono: o botão continua existindo, mas só
 * aparece no carro que JÁ FOI APROVADO pra aquela pessoa.
 *
 * A JANELA (`TOLERANCIA_RETIRADA_MS`) existe porque reserva não é hora marcada:
 * quem reservou pras 8h pega às 7h50 ou às 9h30, e a vida real não cabe no
 * minuto. Mas ela também não pode ser infinita — reserva de duas semanas atrás
 * não deve acender botão nenhum hoje.
 *
 * `usoJaAberto` é o que impede o botão de continuar aceso depois de a pessoa
 * pegar: com o carro já na rua, o que ela precisa é do "Devolver".
 */
export const TOLERANCIA_RETIRADA_MS = 12 * 60 * 60 * 1000;   // 12 horas

export function reservaParaPegar({ requisicoes, veiculoId, minhaPessoaId, agoraIso, usoJaAberto }) {
  if (!veiculoId || !minhaPessoaId || usoJaAberto) return null;
  const agora = ms(agoraIso) ?? Date.now();
  const minhas = (requisicoes || []).filter((r) =>
    r && r.veiculo_id === veiculoId
    && r.pessoa_id === minhaPessoaId
    && r.situacao === 'aprovada');

  for (const r of minhas) {
    const ini = ms(r.retirada_prevista);
    if (ini === null) continue;
    const fim = ms(r.devolucao_prevista);
    // Cedo demais: ainda não é hora de pegar. Tarde demais: passou da
    // devolução prevista (ou de 12h da retirada, quando não há devolução) e a
    // reserva não vale mais como autorização pra sair hoje.
    const limite = (fim === null ? ini : fim) + TOLERANCIA_RETIRADA_MS;
    if (agora >= ini - TOLERANCIA_RETIRADA_MS && agora <= limite) return r;
  }
  return null;
}

/**
 * A reserva APROVADA que está segurando este carro agora.
 *
 * O defeito que isto conserta, relatado pelo dono em 12/08/2026: "tem uma
 * reserva em vigor para o uso do Felipe até dia 24, mas ainda consta disponível
 * a Bravo Essence". Estava mesmo — `estadoDoVeiculo` decidia "livre" olhando só
 * posse, viagem aberta e dono fixo, e nunca a agenda de reservas. Ou seja: o
 * app aprovava a reserva e continuava oferecendo o mesmo carro pra outra pessoa
 * pegar, que é exatamente o CONFLITO DE VIAGENS que esta ferramenta existe pra
 * impedir — o manual da planilha pede 3 dias de antecedência por causa dele.
 *
 * Só `aprovada` segura o carro. Pendente NÃO: enquanto ninguém decidiu, o carro
 * continua de todos, e travá-lo por um pedido que pode ser recusado deixaria a
 * frota parada por engano.
 */
export function reservaSegurando({ requisicoes, veiculoId, agoraIso }) {
  const agora = ms(agoraIso) ?? Date.now();
  return (requisicoes || []).find((r) => {
    if (!r || r.veiculo_id !== veiculoId || r.situacao !== 'aprovada') return false;
    const ini = ms(r.retirada_prevista);
    if (ini === null) return false;
    // Sem hora de volta, vale o dia inteiro — mesma regra de seAtropelam().
    const fim = ms(r.devolucao_prevista) ?? (ini + DIA);
    return agora >= ini && agora <= fim;
  }) || null;
}

/**
 * Por quantos dias uma recusa continua aparecendo pra quem pediu.
 *
 * A lista "Seus pedidos" é um AVISO, não um arquivo morto: o histórico
 * completo mora na aba Gestão. Sete dias é tempo de a pessoa abrir o app na
 * semana em que pediu; depois disso a linha só ocuparia a tela de quem está de
 * pé no estacionamento.
 */
export const DIAS_MOSTRANDO_A_RECUSA = 7;

/**
 * Os pedidos que ESTA pessoa vê em "Seus pedidos".
 *
 * O DEFEITO QUE ISTO CONSERTA (medido em 20/08/2026): a lista filtrava só
 * `pendente` e `aprovada`. Quem recusa é obrigado pela tela a escrever o
 * motivo — a mensagem é "Diga o motivo. Quem pediu precisa saber o que fazer
 * diferente" —, e o motivo não chegava em ninguém: o pedido recusado sumia da
 * tela sem uma palavra. Havia até a linha pronta pra mostrá-lo no card, que
 * nunca rodava. Sem aviso nenhum por push ou e-mail, o resultado é uma pessoa
 * esperando resposta de um pedido já respondido.
 *
 * `revogada` entra pela mesma razão, e mais grave: é a reserva que JÁ VALIA e
 * foi encerrada no meio. Sumir em silêncio manda a pessoa até o estacionamento
 * buscar um carro que não é mais dela.
 *
 * `cancelada` entra pelo mesmo motivo — e a primeira versão disto a deixou de
 * fora por uma suposição ERRADA, que era "quase sempre é a própria pessoa
 * desmarcando". Não é: `acoesDaReserva` (historico-de-reservas.js) exige
 * `temPermissaoAprovar` para cancelar, então quem pediu NUNCA cancela o próprio
 * pedido pela tela. Cancelar é sempre outra pessoa mexendo na sua reserva, com
 * motivo obrigatório escrito — e some sem chegar em ninguém era exatamente o
 * defeito que este trecho existe para consertar.
 *
 * `criada_por` conta junto com `pessoa_id`: quem abre o pedido para outra
 * pessoa (a Gestão pedindo pelo motorista de fora) é quem espera a resposta.
 */
export function meusPedidos({ requisicoes, minhaPessoaId, meuUsuarioId, agoraIso } = {}) {
  const agora = ms(agoraIso) ?? Date.now();
  const limite = DIAS_MOSTRANDO_A_RECUSA * DIA;
  const meu = (r) => (!!minhaPessoaId && r.pessoa_id === minhaPessoaId)
    || (!!meuUsuarioId && r.criada_por === meuUsuarioId);

  return ordenarFila((requisicoes || []).filter((r) => {
    if (!r || !meu(r)) return false;
    if (r.situacao === 'pendente' || r.situacao === 'aprovada') return true;
    if (!['recusada', 'revogada', 'cancelada'].includes(r.situacao)) return false;
    // `decidida_em` é o carimbo da recusa; `encerrada_em`, o da revogação.
    // Vale o mais recente dos dois — uma reserva aprovada na segunda e
    // revogada na quarta tem os dois carimbos, e o que interessa é o segundo.
    const carimbos = [ms(r.decidida_em), ms(r.encerrada_em)].filter((t) => t !== null);
    // Sem carimbo nenhum não dá pra dizer se é velha. Mostrar é o lado seguro:
    // some uma linha a mais na tela, em vez de sumir uma recusa que a pessoa
    // nunca soube que existiu.
    if (!carimbos.length) return true;
    return agora - Math.max(...carimbos) <= limite;
  }));
}
