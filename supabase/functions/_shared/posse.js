/* A POSSE DO CARRO — quem estava com ele, e quando.
 *
 * frota_uso guardava só VIAGEM: sai com tanto km, volta com tanto. Para quem
 * tem carro fixo isso não acontece nunca — ninguém "retira" e "devolve" o
 * próprio carro —, e por isso a tabela ficou vazia com 7 pessoas já tendo
 * acesso.
 *
 * Agora ela guarda também POSSE: uma linha aberta dizendo "este carro está com
 * esta pessoa desde esta data". O resultado é uma linha do tempo sem buraco, e
 * é ela que responde a pergunta que a multa faz — quem dirigia dia 14 às
 * 15h40. Foram R$ 1.301,60 perdidos por não ter essa resposta.
 *
 * MORA NO _shared (não em src/), como checklist.js: a Edge Function do robô
 * da manhã (Tarefa 12) roda em Deno e precisa saber quem está com o carro pra
 * avisar a pessoa certa — ela não alcança src/, só o front alcança o
 * _shared. Um arquivo, dois consumidores, pra não haver duas verdades sobre
 * quem está com cada carro. */

const ehPosse = (u) => u && u.tipo === 'posse';

/** A posse aberta de um carro: com quem ele está agora. Nula se não há. */
export function posseAberta(usos, veiculoId) {
  return (usos || []).find((u) => ehPosse(u) && u.veiculo_id === veiculoId && !u.volta_em) || null;
}

/**
 * Passar o carro para outra pessoa — ou devolver. Devolve o que gravar:
 * `fechar` é o update na posse de quem estava, `abrir` é o insert da nova.
 * Qualquer um dos dois pode ser nulo.
 *
 * `donoFixo` é `{ id, nome }` do responsável fixo do veículo, ou nulo se ele
 * não tem um (carro de rodízio) — mesmo formato de `para`, só que resolvido
 * pelo chamador a partir do veículo, não escolhido na tela. Só importa
 * quando `para` é nulo (devolver):
 *
 * D9c: devolver SEM apontar ninguém não pode deixar a linha do tempo com um
 * buraco. Antes desta função só fechava a posse de quem estava — e depois
 * disso `quemEstavaCom` passava a devolver "não sei" pra aquele período,
 * mesmo o dono fixo estando com o carro de verdade (só não tinha ficado
 * registrado). Agora, se há dono fixo, a posse dele REABRE no mesmo
 * instante em que a do emprestado fecha — sem buraco. Sem dono fixo (carro
 * de rodízio), só fecha mesmo: "livre" é o estado certo.
 */
export function passarPara({ usos, veiculoId, para, donoFixo, quando }) {
  const atual = posseAberta(usos, veiculoId);
  const alvo = para || donoFixo || null;
  // Passar o carro pra quem JÁ está com ele não é evento nenhum. Sem esta
  // guarda, confirmar a opção padrão num carro cuja posse aberta já é a do dono
  // fixo fechava e reabria a posse da MESMA pessoa — e a linha do tempo ganhava
  // uma transferência que nunca aconteceu. Num histórico que serve pra
  // responder "quem estava com o carro no dia da multa", evento inventado é
  // ruído caro. Comparação por identificador, não por nome: dois Gabriéis.
  // `alvo.id` nulo é pessoa de fora — aí não há como ser "a mesma", e passa.
  if (atual && alvo && alvo.id && atual.pessoa_id === alvo.id) {
    return { fechar: null, abrir: null };
  }
  return {
    fechar: atual ? { id: atual.id, volta_em: quando } : null,
    abrir: alvo ? {
      veiculo_id: veiculoId, tipo: 'posse',
      pessoa_id: alvo.id, pessoa_nome: alvo.nome, saida_em: quando,
    } : null,
  };
}

/**
 * Quem está com o carro HOJE — a pergunta que a tela faz o tempo todo, ao
 * contrário de `quemEstavaCom` (que responde para qualquer instante do
 * passado). Se há posse aberta, é ela quem manda (D9b: emprestar não
 * transfere o `pessoa_id`, só quem responde pelo carro enquanto durar).
 * Faltando posse, cai no dono fixo do veículo. `porPosse` diz qual dos dois
 * caminhos respondeu, pra quem consome poder distinguir "é o dono" de "está
 * emprestado com essa pessoa".
 */
export function quemEstaComOCarro(veiculo, usos, pessoas) {
  const posse = veiculo ? posseAberta(usos, veiculo.id) : null;
  if (posse) {
    // O nome GRAVADO na posse vence sempre: ele é o que valia no dia em que a
    // posse foi aberta, e histórico que muda quando o cadastro muda deixa de
    // ser histórico. A lista só entra quando o nome está em BRANCO — as 5
    // posses abertas em 06/08 gravaram só o pessoa_id, e sem este resgate 5
    // carros com dono cadastrado aparecem sem ninguém (defeito B2).
    // `pessoas` é opcional de propósito: a Edge chama com dois argumentos e
    // não tem a lista à mão. Sem ela, o comportamento é o de antes.
    const nome = posse.pessoa_nome
      || (posse.pessoa_id && pessoas
        ? ((pessoas.find((p) => p && p.id === posse.pessoa_id) || {}).nome || null)
        : null);
    return { pessoaId: posse.pessoa_id || null, pessoaNome: nome || null, porPosse: true };
  }
  return {
    pessoaId: (veiculo && veiculo.pessoa_id) || null,
    pessoaNome: (veiculo && veiculo.pessoa_nome) || null,
    porPosse: false,
  };
}

// Um instante de verdade, não o texto que o veio escrito. O Postgres devolve
// timestamptz como '...+00:00', sem milissegundos quando são zero; o app
// grava com toISOString() ('...000Z'). Comparar como TEXTO faz
// '...15:40:00.500Z' perder de '...15:40:00Z' na tabela de caracteres — o
// ponto vem antes do Z —, mesmo o primeiro sendo o instante mais tarde.
// Nulo quando o texto não é uma data válida, pra nunca comparar um chute.
const instante = (v) => {
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
};

const valeNoInstante = (u, veiculoId, t) => {
  if (!u || u.veiculo_id !== veiculoId) return false;
  const saida = instante(u.saida_em);
  if (saida === null || saida > t) return false;
  if (!u.volta_em) return true;
  const volta = instante(u.volta_em);
  return volta !== null && volta >= t;
};

/**
 * Quem estava com o carro num instante do PASSADO. Nulo quando não se sabe —
 * e "não sei" é a resposta certa para antes de existir registro. Acusar
 * alguém com dado inventado é pior do que não responder.
 */
export function quemEstavaCom(usos, veiculoId, quando) {
  const t = instante(quando);
  if (t === null) return null;
  const valem = (usos || []).filter((u) => valeNoInstante(u, veiculoId, t));
  if (!valem.length) return null;

  // VIAGEM VENCE POSSE: se alguém pegou o carro emprestado naquela hora, quem
  // estava dirigindo é essa pessoa, não o dono.
  const viagens = valem.filter((u) => (u.tipo || 'viagem') === 'viagem');
  const candidatas = viagens.length ? viagens : valem;
  // Entre as que valem, a de saída mais recente é a resposta. Duas viagens
  // valendo no mesmo instante não deveria existir, mas o banco não impede —
  // e fingir certeza aí seria o mesmo chute que esta função existe pra
  // evitar. `ambiguo: true` avisa quem consome que a resposta pode não ser a
  // única.
  const escolhida = candidatas.slice()
    .sort((a, b) => instante(b.saida_em) - instante(a.saida_em))[0];
  const resultado = {
    pessoa_id: escolhida.pessoa_id || null,
    pessoa_nome: escolhida.pessoa_nome || null,
    uso: escolhida,
  };
  if (viagens.length > 1) resultado.ambiguo = true;
  return resultado;
}

/**
 * As posses que faltam abrir, na virada de chave: uma por carro ativo com dono
 * que ainda não tem posse aberta.
 *
 * A POSSE COMEÇA HOJE, NÃO NO PASSADO. Ninguém sabe desde quando cada carro
 * está com cada pessoa, e inventar essa data encheria a linha do tempo de
 * resposta falsa — a multa passaria a acusar alguém com um dado inventado.
 */
export function abrirPossesQueFaltam(veiculos, usos, agora) {
  return (veiculos || [])
    .filter((v) => v && v.pessoa_id && v.situacao === 'ativo' && !posseAberta(usos, v.id))
    .map((v) => ({ veiculo_id: v.id, tipo: 'posse', pessoa_id: v.pessoa_id, saida_em: agora }));
}

/**
 * O que gravar quando o DONO FIXO de um veículo muda pela ficha (D9c) —
 * diferente de emprestar. Três casos, e um quarto de guarda:
 *
 *  - nada muda (`deId === paraId`): não mexe em nada — salvar a ficha por
 *    outro motivo (seguro, placa) não pode resetar a data da posse.
 *  - o carro está EMPRESTADO A UM TERCEIRO (a posse aberta não é do dono
 *    anterior): não mexe. Fechar a posse dele aqui diria que o novo dono
 *    esteve com o carro num dia em que nunca o viu — a mesma resposta
 *    inventada que `quemEstavaCom` existe pra nunca dar.
 *  - o dono fixo está sendo REMOVIDO (`paraId` nulo): fecha a posse aberta,
 *    não abre nenhuma. É a mesma invariante que o gatilho do banco garante
 *    por trás — aqui ela só evita a viagem de ida e volta ao banco.
 *  - carro na mão do dono (ou sem posse ainda): fecha a do anterior, abre a
 *    do novo, começando hoje.
 */
export function trocarDonoFixo({ usos, veiculoId, deId, paraId, paraNome, quando }) {
  if (deId === paraId) return { fechar: null, abrir: null };

  const atual = posseAberta(usos, veiculoId);

  if (!paraId) {
    return { fechar: atual ? { id: atual.id, volta_em: quando } : null, abrir: null };
  }

  if (atual && deId && atual.pessoa_id && atual.pessoa_id !== deId) {
    return { fechar: null, abrir: null };
  }

  return {
    fechar: atual ? { id: atual.id, volta_em: quando } : null,
    abrir: { veiculo_id: veiculoId, tipo: 'posse', pessoa_id: paraId, pessoa_nome: paraNome || null, saida_em: quando },
  };
}

/**
 * QUEM DEVE CONFERIR O CARRO HOJE — e por que não é `quemEstaComOCarro`.
 *
 * Aquela responde "de quem é este carro", e por isso olha só a POSSE: a viagem
 * é passageira e não muda de dono nada. Esta responde outra coisa — "quem está
 * com a chave na mão agora" —, e aí a viagem aberta vence, porque é ela que diz
 * quem vai dirigir hoje.
 *
 * O QUE ISTO CONSERTA (relatado pelo dono em 21/08/2026): ele retirou a Bravo
 * Blackmotion, um carro de rodízio, e o cartão do checklist não abria pra ele —
 * o app só reconhecia como "seu carro" o que estava por posse. Para fazer o
 * checklist do carro que estava DIRIGINDO, ele tinha que caçar o veículo num
 * seletor, coisa que só quem administra a Frota enxerga.
 *
 * A ordem é: viagem aberta → posse → dono no papel.
 */
export function quemDeveConferir(veiculo, usos, pessoas) {
  const viagem = (usos || []).find((u) => u
    && u.veiculo_id === (veiculo && veiculo.id)
    && !u.volta_em
    && (u.tipo || 'viagem') === 'viagem') || null;
  if (viagem && viagem.pessoa_id) {
    const nome = viagem.pessoa_nome
      || (pessoas ? ((pessoas.find((p) => p && p.id === viagem.pessoa_id) || {}).nome || null) : null);
    return { pessoaId: viagem.pessoa_id, pessoaNome: nome || null, porViagem: true };
  }
  return { ...quemEstaComOCarro(veiculo, usos, pessoas), porViagem: false };
}
