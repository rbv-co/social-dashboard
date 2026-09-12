/* O HISTÓRICO DA ABA GESTÃO: o que foi reservado, o que foi retirado, e a prova.
 *
 * Desenho: docs/superpowers/specs/2026-08-13-frota-gestao-reservas-design.md
 *
 * POR QUE ISTO EXISTE. Medido no banco em 13/08/2026: existiam 2 reservas — uma
 * aprovada e uma recusada — e NENHUMA pendente. Como a aba Gestão só mostrava a
 * fila de aprovação, e a fila só lista pendentes, o resultado era uma tela
 * vazia com duas reservas invisíveis atrás dela. Não havia caminho nenhum na
 * tela para editar, cancelar ou revogar o que já tinha sido decidido.
 *
 * POR QUE A LISTA TRAZ RETIRADA, E NÃO SÓ RESERVA. No mesmo dia, no mesmo
 * banco: 5 retiradas reais e 2 reservas. Uma lista só de reservas mostraria
 * menos da metade do que aconteceu com os carros — e a tela nunca mente. Então
 * a lista é uma LINHA DO TEMPO: cada reserva, cada retirada, e o elo entre as
 * duas quando ele existe.
 *
 * A REGRA QUE MANDA NESTE ARQUIVO: nada aqui inventa elo. Quando não dá pra
 * afirmar que aquela retirada saiu daquela reserva, o par não é feito — e a
 * tela mostra as duas coisas separadas, que é a verdade. Casar por engano seria
 * pior do que não casar: o histórico passaria a afirmar que alguém pegou o
 * carro com uma autorização que nunca usou. */

import { SITUACOES, TOLERANCIA_RETIRADA_MS } from './requisicoes.js';

/* ── As situações, agora com 'revogada' ───────────────────────────────────── */

/**
 * 'revogada' entra aqui, e não em `SITUACOES` (requisicoes.js), porque aquele
 * arquivo é sobre PEDIR e DECIDIR. Encerrar uma reserva que já valia é outro
 * assunto, e mora com o histórico, que é onde ela aparece.
 *
 * A palavra é do dono (13/08/2026), e a diferença entre as duas é dele:
 *   cancelada — a reserva ainda não tinha começado. Desmarcou-se.
 *   revogada  — já estava valendo, e alguém tirou o direito no meio.
 */
export const SITUACOES_DO_HISTORICO = {
  ...SITUACOES,
  revogada: { rotulo: 'Revogada', cor: 'ruim' },
  /* CARRO FIXO (19/08/2026). Não é situação de reserva — é o estado de uma
   * posse, e entra aqui porque é a linha do tempo que a mostra. Sem estes dois
   * rótulos, `rotuloDaSituacao` devolveria a chave crua e a tela escreveria
   * "posse-aberta" no selo. */
  'posse-aberta': { rotulo: 'Carro fixo', cor: 'info' },
  'posse-encerrada': { rotulo: 'Foi fixo', cor: 'neutro' },
};

/**
 * A FRASE CURTA da linha fechada: quem e quando, em uma linha só.
 *
 * O card do histórico passou a abrir só quando alguém pede (21/08/2026, pedido
 * do dono: "os registros vão ter um botão de abrir para mostrar mais
 * detalhes"). Fechado, ele precisa continuar respondendo o básico — linha que
 * some e não diz nada obriga a abrir uma por uma pra achar a que interessa,
 * que é pior do que a lista comprida que existia antes.
 */
export function resumoCurtoDaLinha(linha, formatarInstante) {
  const l = linha || {};
  const quandoTexto = typeof formatarInstante === 'function' && l.quando
    ? formatarInstante(new Date(l.quando).toISOString()) : null;
  const partes = [];

  const quem = texto(l.pessoa_nome)
    || texto(l.reserva && l.reserva.pessoa_nome)
    || texto(l.uso && l.uso.pessoa_nome);
  if (quem) partes.push(quem);
  if (quandoTexto) partes.push(quandoTexto);

  const destino = texto(l.reserva && l.reserva.destino) || texto(l.uso && l.uso.destino);
  if (destino) partes.push(destino);

  // Nunca devolve vazio: a linha fechada sem uma palavra parece defeito de
  // carregamento. Sem nome, sem data e sem destino, ela ao menos diz o que é.
  if (!partes.length) return rotuloDaSituacao(l.situacao);
  return partes.join(' · ');
}

/** O rótulo em português de uma situação, sem nunca devolver vazio. */
export function rotuloDaSituacao(situacao) {
  return (SITUACOES_DO_HISTORICO[situacao] || {}).rotulo || String(situacao || 'sem situação');
}

/**
 * A cor do selo daquela situação, sempre uma que EXISTE no CSS.
 *
 * Por que não ler `SITUACOES[x].cor` direto na tela: `revogada` não mora em
 * `SITUACOES` (mora aqui), e `SITUACOES['revogada']` é `undefined` — ler `.cor`
 * dele derruba a renderização inteira do bloco. E duas cores desta tabela
 * ('info', 'neutro', dos estados de posse) não têm classe no CSS: chegariam na
 * tela como selo sem cor nenhuma.
 */
export function corDaSituacao(situacao) {
  const cor = (SITUACOES_DO_HISTORICO[situacao] || {}).cor;
  return ['espera', 'boa', 'ruim', 'neutra'].includes(cor) ? cor : 'neutra';
}

const ms = (v) => { const t = Date.parse(v); return Number.isFinite(t) ? t : null; };
const texto = (v) => String(v ?? '').trim();
const mesmoNome = (a, b) => {
  const x = texto(a).toLowerCase(); const y = texto(b).toLowerCase();
  return !!x && x === y;
};

/**
 * O dia (AAAA-MM-DD) de um instante, no fuso de Brasília.
 *
 * Mesma conta que a tela usa pra `hoje`, e pelo mesmo motivo: `toISOString()`
 * puro dá a data em UTC, e depois das 21h no Brasil isso já é o dia seguinte —
 * a retirada das 22h procuraria a ficha de amanhã e nunca acharia.
 */
export function diaEmBrasilia(iso) {
  const t = ms(iso);
  if (t === null) return null;
  return new Date(t - 3 * 3600 * 1000).toISOString().slice(0, 10);
}

/* ── O que dá pra fazer com cada reserva ──────────────────────────────────── */

/**
 * As três ações do admin, e o motivo de cada uma quando não dá.
 *
 * CANCELAR E REVOGAR NUNCA APARECEM JUNTAS. Só uma das duas cabe em cada
 * momento — o que ainda não começou se cancela, o que já está valendo se
 * revoga —, e o padrão da casa manda uma ação principal por bloco. Dois botões
 * quase iguais lado a lado é o mesmo que nenhum: a pessoa para pra decidir
 * qual, e escolhe no chute.
 *
 * `pode:false` SEMPRE vem com `motivo`. Botão que some sem explicação faz quem
 * usa achar que a ferramenta quebrou — é regra escrita do padrão da central.
 */
export function acoesDaReserva({ requisicao, temPermissaoAprovar, agoraIso } = {}) {
  const r = requisicao || {};
  const agora = ms(agoraIso) ?? Date.now();
  const inicio = ms(r.retirada_prevista);
  // Sem hora de retirada não dá pra dizer se começou. Trata-se como "ainda não
  // começou": cancelar é a ação reversível das duas, e na dúvida a tela oferece
  // a menos grave.
  const jaComecou = inicio !== null && agora >= inicio;
  const viva = r.situacao === 'pendente' || r.situacao === 'aprovada';
  const virouViagem = !!r.uso_id;

  const negar = (motivo) => ({ pode: false, motivo });
  const semPermissao = () => negar('sem-permissao');

  let editar;
  if (!temPermissaoAprovar) editar = semPermissao();
  else if (!viva) editar = negar('ja-encerrada');
  else if (virouViagem) editar = negar('ja-virou-viagem');
  else editar = { pode: true, motivo: null };

  let cancelar;
  if (!temPermissaoAprovar) cancelar = semPermissao();
  else if (!viva) cancelar = negar('ja-encerrada');
  else if (virouViagem || jaComecou) cancelar = negar('ja-comecou');
  else cancelar = { pode: true, motivo: null };

  let revogar;
  if (!temPermissaoAprovar) revogar = semPermissao();
  else if (!viva) revogar = negar('ja-encerrada');
  else if (!virouViagem && !jaComecou) revogar = negar('ainda-nao-comecou');
  else revogar = { pode: true, motivo: null };

  /* ARQUIVAR (D4). Tira da lista sem tirar do banco. É o contrário exato das
   * três de cima: elas só valem pro que ainda está vivo, esta só vale pro que
   * já acabou.
   *
   * PENDENTE NUNCA. Uma pendente arquivada sumiria da fila de aprovação sem ter
   * sido decidida — o pior destino possível pra um pedido. A trava de verdade
   * está no gatilho da migration 047; isto aqui só evita oferecer o botão. */
  const jaArquivada = !!r.arquivada_em;
  const acabou = ['recusada', 'cancelada', 'revogada'].includes(r.situacao);

  let arquivar;
  if (!temPermissaoAprovar) arquivar = semPermissao();
  else if (jaArquivada) arquivar = negar('ja-arquivada');
  else if (!acabou) arquivar = negar('ainda-em-aberto');
  else arquivar = { pode: true, motivo: null };

  let desarquivar;
  if (!temPermissaoAprovar) desarquivar = semPermissao();
  else if (!jaArquivada) desarquivar = negar('nao-esta-arquivada');
  else desarquivar = { pode: true, motivo: null };

  return { editar, cancelar, revogar, arquivar, desarquivar };
}

/** A frase que a tela mostra quando a ação não pode. */
export function porQueNaoDaEmPortugues(motivo, situacao) {
  switch (motivo) {
    case 'sem-permissao':
      return 'Você não altera reserva de veículo. Peça a quem aprova.';
    case 'ja-encerrada':
      return `Esta reserva já está ${rotuloDaSituacao(situacao).toLowerCase()}, e reserva encerrada não se mexe: `
        + 'o histórico tem de continuar dizendo o que foi combinado.';
    case 'ja-virou-viagem':
      return 'O carro já saiu com esta reserva. Mudar o pedido agora faria o registro discordar do que aconteceu.';
    case 'ja-comecou':
      return 'Esta reserva já está valendo. O caminho aqui é revogar, não cancelar.';
    case 'ainda-nao-comecou':
      return 'Esta reserva ainda não começou. O caminho aqui é cancelar, não revogar.';
    case 'ainda-em-aberto':
      return 'Só reserva encerrada sai da lista. Esta ainda está em aberto, e pedido em aberto '
        + 'precisa continuar à vista até alguém decidir.';
    case 'ja-arquivada':
      return 'Esta reserva já está arquivada. Ela continua guardada, e volta pela aba Arquivadas.';
    case 'nao-esta-arquivada':
      return 'Esta reserva está na lista normal, então não há o que desarquivar.';
    default:
      return '';
  }
}

/* ── A prova de uma retirada ──────────────────────────────────────────────── */

/**
 * Que prova ficou de uma retirada — e de quem ela é.
 *
 * ESTA É A FUNÇÃO QUE MOTIVOU A ENTREGA. O dono perguntou se a assinatura do
 * checklist já não valia como assinatura de retirada. A resposta saiu do banco:
 * no único dia em que houve ficha assinada, quem assinou foi Erick Martins e
 * quem pegou o carro foi Breno. As duas frases são diferentes —
 *   o checklist diz "o carro estava assim neste dia, e fulano viu";
 *   a retirada diz "eu, fulano, recebi este carro assim e respondo por ele" —
 * e só coincidem quando é a mesma pessoa. É exatamente isso que os cinco
 * estados abaixo separam, em vez de mostrar um "✔ assinado" que esconderia a
 * diferença.
 */
export function provaDaRetirada({ uso, fichas } = {}) {
  const u = uso || {};
  const dia = diaEmBrasilia(u.saida_em);
  const ficha = (fichas || []).find((f) => f && f.veiculo_id === u.veiculo_id && f.feita_em === dia) || null;

  // O aceite vem PRIMEIRO porque é a prova mais forte que pode existir aqui:
  // é a assinatura de quem pegou, feita na hora de pegar.
  if (u.aceite_em) {
    return {
      estado: 'aceite',
      ficha,
      quemAssinou: texto(u.aceite_nome) || texto(u.pessoa_nome) || 'quem pegou o carro',
      frase: `${texto(u.aceite_nome) || texto(u.pessoa_nome) || 'Quem pegou o carro'} assinou o aceite de retirada.`,
    };
  }

  if (!ficha) {
    return {
      estado: 'sem-ficha',
      ficha: null,
      quemAssinou: null,
      frase: 'Não houve checklist deste carro neste dia: não ficou prova nenhuma desta retirada.',
    };
  }

  if (!ficha.assinada_em) {
    return {
      estado: 'ficha-sem-assinatura',
      ficha,
      quemAssinou: null,
      frase: 'O checklist do dia foi preenchido, mas ninguém assinou.',
    };
  }

  const mesmaPessoa = (u.pessoa_id && ficha.pessoa_id && u.pessoa_id === ficha.pessoa_id)
    || mesmoNome(u.pessoa_nome, ficha.pessoa_nome);

  if (mesmaPessoa) {
    return {
      estado: 'assinada-por-quem-pegou',
      ficha,
      quemAssinou: texto(ficha.pessoa_nome) || texto(u.pessoa_nome) || 'quem pegou o carro',
      frase: `${texto(ficha.pessoa_nome) || 'Quem pegou o carro'} conferiu e assinou o checklist deste dia.`,
    };
  }

  return {
    estado: 'assinada-por-outra',
    ficha,
    quemAssinou: texto(ficha.pessoa_nome) || 'outra pessoa',
    frase: `O checklist deste dia foi assinado por ${texto(ficha.pessoa_nome) || 'outra pessoa'}, `
      + `e quem pegou o carro foi ${texto(u.pessoa_nome) || 'outra pessoa'}. `
      + 'Não ficou assinatura de quem pegou.',
  };
}

/* ── A cópia em PDF na pasta do Zoho ──────────────────────────────────────── */

/**
 * O que aconteceu com a cópia em PDF de UMA ficha.
 *
 * Segue a doutrina que `copias-no-zoho.js` já escreveu por extenso, e ela vale
 * aqui igual: **espera não é problema.** O robô sobe de 10 em 10 minutos, e uma
 * ficha assinada há dois minutos está esperando o relógio, não quebrada. E a
 * ficha continua valendo de qualquer jeito — o PDF é cópia; a prova mora no
 * banco desde o segundo em que foi assinada.
 */
export function copiaNoZoho({ checklistId, copias } = {}) {
  if (!checklistId) return { estado: 'sem-ficha', frase: '' };
  const c = (copias || []).find((x) => x && x.checklist_id === checklistId);
  if (!c) return { estado: 'sem-copia', frase: 'A cópia em PDF ainda não entrou na fila do Zoho.' };
  if (c.situacao === 'enviado') {
    return { estado: 'chegou', frase: 'A cópia em PDF chegou na pasta do Zoho.' };
  }
  if (c.situacao === 'falhou') {
    // O texto do robô sai como ele escreveu: ele já vem em português dizendo o
    // que FAZER ("Abra Acessos → Zoho e clique em conectar"). Resumir isso pra
    // "erro ao enviar" jogaria fora justamente a parte que resolve.
    return {
      estado: 'desistiu',
      frase: `A cópia em PDF não chegou no Zoho: ${texto(c.ultimo_erro) || 'o robô tentou 8 vezes e parou.'}`,
    };
  }
  if (texto(c.ultimo_erro)) {
    return {
      estado: 'tropecou',
      frase: `A cópia em PDF está atrasada, e o robô continua tentando: ${texto(c.ultimo_erro)}`,
    };
  }
  return { estado: 'esperando', frase: 'A cópia em PDF está na fila do Zoho, esperando a vez.' };
}

/* ── O elo entre reserva e retirada ───────────────────────────────────────── */

/**
 * A retirada que saiu desta reserva — ou nada.
 *
 * `uso_id` é a resposta certa quando existe. Ele SÓ passou a ser gravado em
 * 13/08/2026: até então nada na tela ligava a reserva à viagem, e por isso as
 * reservas antigas precisam do segundo caminho.
 *
 * O SEGUNDO CAMINHO USA A MESMA REGRA QUE AUTORIZA A RETIRADA — a janela de
 * `reservaParaPegar()` em requisicoes.js — e isso é de propósito: se aquela
 * regra deixou a pessoa pegar o carro por causa desta reserva, é esta reserva
 * que autorizou a saída. Duas respostas diferentes pra mesma pergunta é defeito
 * que esta central já pagou caro.
 *
 * E ele exige a MESMA PESSOA. Sem isso, a reserva do Felipe casaria com a saída
 * da Barbara no mesmo carro e no mesmo dia, e o histórico afirmaria uma coisa
 * que não aconteceu.
 */
export function retiradaDaReserva({ requisicao, usos } = {}) {
  const r = requisicao || {};
  if (!r.veiculo_id) return null;

  if (r.uso_id) return (usos || []).find((u) => u && u.id === r.uso_id) || null;

  const inicio = ms(r.retirada_prevista);
  if (inicio === null || r.situacao !== 'aprovada') return null;
  const fim = ms(r.devolucao_prevista) ?? inicio;

  const candidatas = (usos || []).filter((u) => {
    if (!u || u.veiculo_id !== r.veiculo_id) return false;
    const mesma = (u.pessoa_id && r.pessoa_id && u.pessoa_id === r.pessoa_id)
      || mesmoNome(u.pessoa_nome, r.pessoa_nome);
    if (!mesma) return false;
    const saiu = ms(u.saida_em);
    if (saiu === null) return false;
    return saiu >= inicio - TOLERANCIA_RETIRADA_MS && saiu <= fim + TOLERANCIA_RETIRADA_MS;
  });

  if (candidatas.length === 0) return null;
  // Mais de uma cabendo na janela: fica a que saiu mais perto da hora marcada.
  return candidatas.slice().sort((a, b) =>
    Math.abs(ms(a.saida_em) - inicio) - Math.abs(ms(b.saida_em) - inicio))[0];
}

/* ── Quem está com o carro fixo ───────────────────────────────────────────── */

/**
 * De quem é a posse — e NUNCA um nome inventado.
 *
 * POR QUE PRECISA DE TRÊS CAMINHOS: medido em 19/08/2026, 7 das 11 posses
 * reais tinham `pessoa_nome` NULO. Elas foram criadas na carga inicial, antes
 * do campo existir, e a tela escrevia "motorista não informado" pra todas —
 * sendo que o `pessoa_id` estava lá o tempo todo.
 *
 * A ordem, do mais específico pro mais geral:
 *   1. o nome gravado na própria posse;
 *   2. a pessoa da posse, pelo id;
 *   3. o dono fixo do veículo.
 *
 * E quando nenhum responde, devolve `null` — nunca um palpite. O FIAT BRAVO
 * ESSENCE é de propósito um carro sem dono fixo (decisão do dono), e a tela
 * tem de poder dizer isso em vez de escrever o nome de alguém que não é.
 */
export function quemTemAPosse({ uso, veiculo, nomeDaPessoa } = {}) {
  const gravado = texto(uso && uso.pessoa_nome);
  if (gravado) return gravado;
  const buscar = typeof nomeDaPessoa === 'function' ? nomeDaPessoa : () => null;
  for (const id of [uso && uso.pessoa_id, veiculo && veiculo.pessoa_id]) {
    if (!id) continue;
    const achado = texto(buscar(id));
    if (achado) return achado;
  }
  return null;
}

/** O dia em DD/MM, no fuso de Brasília. Nulo quando não dá pra saber — e aí
 *  quem chama omite o trecho, em vez de escrever "desde null" na tela. */
function diaCurto(iso) {
  const d = diaEmBrasilia(iso);
  if (!d) return null;
  const [, mes, dia] = d.split('-');
  return `${dia}/${mes}`;
}

/**
 * A frase de uma linha de posse, pronta pra tela.
 *
 * ELA MORA AQUI, E NÃO NO `.vue`, por regra da casa: são quatro combinações
 * (aberta/encerrada × com dono/sem dono) mais formato de data, e lógica dentro
 * de template não tem como quebrar teste nenhum.
 *
 * O QUE ELA NUNCA DIZ: "ainda não voltou". Pedido do dono, em 19/08/2026 —
 * carro fixo não está atrasado, ele está onde deveria estar. Há um teste só
 * pra travar isso.
 */
export function fraseDaPosse(linha) {
  const p = (linha || {}).posse;
  if (!p) return null;
  const quem = texto(p.quem);
  const desde = diaCurto(p.desde);
  const ate = diaCurto(p.ate);

  if (p.ate) {
    const janela = desde && ate ? ` de ${desde} a ${ate}` : (ate ? ` até ${ate}` : '');
    return quem
      ? `Esteve fixo com ${quem}${janela}.`
      : `Esteve sem dono fixo registrado,${janela}.`;
  }
  const inicio = desde ? ` desde ${desde}` : '';
  return quem
    ? `Fixo com ${quem}${inicio}.`
    : `Sem dono fixo registrado,${inicio}.`;
}

/* ── A linha do tempo ─────────────────────────────────────────────────────── */

/**
 * Tudo o que aconteceu com os carros, do mais novo pro mais velho.
 *
 * TRÊS espécies de linha, e a diferença importa pra quem lê:
 *   'reserva'  — alguém pediu o carro. Pode ter virado retirada, ou não.
 *   'retirada' — alguém pegou o carro SEM reserva nenhuma atrás.
 *   'posse'    — o carro está FIXO com alguém. Não é movimento; é estado.
 *
 * A segunda espécie não é enfeite: em 13/08/2026 ela era a maioria (5 retiradas
 * contra 2 reservas). Uma lista só de reservas diria que quase nada aconteceu.
 *
 * ⚠️ A TERCEIRA NASCEU DE UM DEFEITO CARO, e o comentário fica pra ninguém
 * desfazer isto por engano. Até 19/08/2026 esta função percorria `frota_uso`
 * SEM olhar o `tipo`, e `frota_uso` é majoritariamente posse: 11 de 12 linhas.
 * O efeito, conferido na tela no ar:
 *
 *   - 11 dos 13 cartões eram carro parado se passando por viagem;
 *   - 8 diziam "ainda não voltou" (posse não volta — é isso que ela é);
 *   - 7 diziam "motorista não informado";
 *   - e o título da gaveta acusava "12 retiradas ficaram sem assinatura de quem
 *     pegou o carro" quando havia acontecido UMA viagem.
 *
 * O último é o pior: é falha virando NÚMERO, a mesma família do 500 que virou
 * R$ 0,00 por 17 horas. Quem lê aquilo conclui que as cópias pro Zoho pararam.
 *
 * `nomeDaPessoa` é opcional (id → nome). Sem ela a posse ainda funciona; só
 * perde a chance de nomear quem está com o carro quando a linha veio da carga
 * antiga, sem `pessoa_nome`.
 */
export function linhaDoTempo({
  requisicoes, usos, veiculos, fichas, copias, temPermissaoAprovar, agoraIso, nomeDaPessoa,
} = {}) {
  const carros = new Map((veiculos || []).filter(Boolean).map((v) => [v.id, v]));
  const nomeDoCarro = (id) => (carros.get(id) || {}).nome || 'carro que saiu do cadastro';
  const placaDoCarro = (id) => (carros.get(id) || {}).placa || '';

  const usadas = new Set();
  const linhas = [];

  for (const r of (requisicoes || []).filter(Boolean)) {
    const uso = retiradaDaReserva({ requisicao: r, usos });
    if (uso) usadas.add(uso.id);
    const prova = uso ? provaDaRetirada({ uso, fichas }) : null;
    linhas.push({
      chave: `reserva:${r.id}`,
      tipo: 'reserva',
      quando: ms(uso ? uso.saida_em : r.retirada_prevista) ?? ms(r.criada_em) ?? 0,
      reserva: r,
      uso,
      prova,
      zoho: prova && prova.ficha ? copiaNoZoho({ checklistId: prova.ficha.id, copias }) : null,
      veiculoNome: nomeDoCarro(r.veiculo_id),
      veiculoPlaca: placaDoCarro(r.veiculo_id),
      situacao: r.situacao,
      // Fica na LINHA, e não só dentro de `reserva`, porque é o filtro que
      // decide o que aparece — e ele não deve precisar saber a forma da reserva.
      arquivada: !!r.arquivada_em,
      acoes: acoesDaReserva({ requisicao: r, temPermissaoAprovar, agoraIso }),
    });
  }

  for (const u of (usos || []).filter(Boolean)) {
    if (usadas.has(u.id)) continue;

    /* POSSE: carro fixo com alguém. Sai por aqui e não chega a virar retirada.
     * O teste `tipo === 'posse'` é EXATO de propósito — linha sem `tipo`, ou
     * com um tipo novo que ninguém previu, segue como retirada. Errar pro lado
     * de "some do Tudo" seria esconder movimento de carro, que é o oposto do
     * que esta tela existe pra fazer. */
    if (u.tipo === 'posse') {
      linhas.push({
        chave: `posse:${u.id}`,
        tipo: 'posse',
        quando: ms(u.saida_em) ?? 0,
        reserva: null,
        uso: u,
        // Sem prova, e não uma prova vazia: posse não é retirada, então não há
        // assinatura de quem pegou pra cobrar. Era daqui que saía o número falso.
        prova: null,
        zoho: null,
        veiculoNome: nomeDoCarro(u.veiculo_id),
        veiculoPlaca: placaDoCarro(u.veiculo_id),
        situacao: u.volta_em ? 'posse-encerrada' : 'posse-aberta',
        posse: {
          quem: quemTemAPosse({ uso: u, veiculo: carros.get(u.veiculo_id), nomeDaPessoa }),
          desde: u.saida_em || null,
          ate: u.volta_em || null,
        },
        acoes: null,
      });
      continue;
    }

    const prova = provaDaRetirada({ uso: u, fichas });
    linhas.push({
      chave: `retirada:${u.id}`,
      tipo: 'retirada',
      quando: ms(u.saida_em) ?? 0,
      reserva: null,
      uso: u,
      prova,
      zoho: prova.ficha ? copiaNoZoho({ checklistId: prova.ficha.id, copias }) : null,
      veiculoNome: nomeDoCarro(u.veiculo_id),
      veiculoPlaca: placaDoCarro(u.veiculo_id),
      // Retirada sem reserva não tem situação de reserva. A palavra é essa
      // mesma, e não um 'aprovada' emprestado: o carro saiu sem pedido, e o
      // histórico tem de dizer isso.
      situacao: 'sem-reserva',
      acoes: null,
    });
  }

  return linhas.sort((a, b) => b.quando - a.quando);
}

/* ── O filtro ─────────────────────────────────────────────────────────────── */

/**
 * Os filtros da barra, na ordem em que aparecem.
 * 'tudo' primeiro porque é o que responde "o que andou acontecendo".
 */
export const FILTROS = [
  { chave: 'tudo', rotulo: 'Tudo' },
  { chave: 'pendente', rotulo: 'Aguardando' },
  { chave: 'aprovada', rotulo: 'Aprovadas' },
  { chave: 'encerrada', rotulo: 'Encerradas' },
  /* "Sem reserva" era a palavra, e ela confundia o dono — com razão. Medido em
   * 19/08/2026: os 11 cartões marcados assim eram TODOS posse, e a única viagem
   * real tinha reserva atrás. O selo estava sempre errado. A frase nova diz o
   * que aconteceu: alguém pegou o carro sem pedir antes. */
  { chave: 'sem-reserva', rotulo: 'Pegou sem reservar' },
  { chave: 'sem-assinatura', rotulo: 'Sem assinatura' },
  /* Fica por último e FORA do "Tudo": é consulta ("quem está com o quê"), não
   * movimento. Com ele dentro do Tudo, 8 carros parados enterrariam a única
   * reserva que existe. */
  { chave: 'carro-fixo', rotulo: 'Carro fixo' },
  /* Também fora do "Tudo": arquivar existe justamente pra sumir de lá. Mas o
   * filtro EXISTE, e é isso que separa "arquivar" de "apagar" — o caminho de
   * volta está a um toque, e a tela diz onde ele fica. */
  { chave: 'arquivadas', rotulo: 'Arquivadas' },
];

/**
 * `sem-assinatura` é o filtro que o dono vai usar mais, e por isso ele existe:
 * é a resposta pra "está indo tudo pro Zoho?". Ele mostra o que saiu do pátio
 * sem prova de quem pegou — que em 13/08/2026 era TODAS as cinco retiradas.
 */
export function filtrar(linhas, filtro) {
  const L = linhas || [];
  switch (filtro) {
    // O "Tudo" é tudo que MOVIMENTO de carro — carro parado tem filtro próprio,
    // e o que foi arquivado saiu da lista de propósito (é o pedido do dono).
    case 'tudo':       return L.filter((l) => l.tipo !== 'posse' && !l.arquivada);
    case 'carro-fixo': return L.filter((l) => l.tipo === 'posse');
    case 'arquivadas': return L.filter((l) => l.arquivada);
    case 'pendente':   return L.filter((l) => l.situacao === 'pendente');
    case 'aprovada':   return L.filter((l) => l.situacao === 'aprovada');
    case 'encerrada':  return L.filter((l) =>
      ['recusada', 'cancelada', 'revogada', 'usada'].includes(l.situacao));
    case 'sem-reserva': return L.filter((l) => l.tipo === 'retirada');
    case 'sem-assinatura': return L.filter((l) =>
      l.prova && ['sem-ficha', 'ficha-sem-assinatura', 'assinada-por-outra'].includes(l.prova.estado));
    default: return L.slice();
  }
}

/**
 * A frase de cima do quadro. Diz o tamanho do problema em vez de só contar
 * linhas: "38 movimentos" não ajuda ninguém a decidir o que fazer.
 */
export function resumoDoHistorico(linhas) {
  const L = linhas || [];

  /* A POSSE NÃO ENTRA NA CONTA, e é esta separação que conserta a frase. Ela
   * dizia "12 retiradas ficaram sem assinatura" num dia em que houve UMA
   * viagem — as outras onze eram carros parados com o dono deles. */
  const movimentos = L.filter((l) => l.tipo !== 'posse' && !l.arquivada);
  const fixos = L.filter((l) => l.tipo === 'posse' && l.situacao === 'posse-aberta').length;
  const eFixos = fixos === 0 ? ''
    : (fixos === 1 ? ' 1 carro está fixo com alguém.' : ` ${fixos} carros estão fixos com alguém.`);

  if (!movimentos.length) return `Nenhuma reserva e nenhuma retirada registradas ainda.${eFixos}`;

  const semProva = movimentos.filter((l) =>
    l.prova && ['sem-ficha', 'ficha-sem-assinatura', 'assinada-por-outra'].includes(l.prova.estado)).length;
  const total = movimentos.length;
  const inicio = total === 1 ? '1 movimento registrado' : `${total} movimentos registrados`;
  if (!semProva) return `${inicio}. Todas as retiradas têm assinatura de quem pegou o carro.${eFixos}`;
  return semProva === 1
    ? `${inicio}. 1 retirada ficou sem assinatura de quem pegou o carro.${eFixos}`
    : `${inicio}. ${semProva} retiradas ficaram sem assinatura de quem pegou o carro.${eFixos}`;
}
