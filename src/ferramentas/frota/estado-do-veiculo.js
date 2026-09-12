/* Onde está cada carro, e o que fazer com ele.
 *
 * Esta é a tela que a empresa já olha hoje (a aba "Resumo Geral" da planilha).
 * A diferença do que existe: o KM atual NÃO é um campo que alguém digita — sai
 * da última devolução. Na planilha, a coluna "KM Atual" é preenchida à mão, e
 * é por isso que a aba "Alertas" nasceu vazia: o número que alimenta o alerta
 * nunca chega. */

export const NIVEIS_TANQUE = ['Reserva', '1/4', '2/4', '3/4', 'Cheio'];

/** O ponteiro do tanque como a pessoa lê no painel. */
export function rotuloDoTanque(quartos) {
  if (quartos === null || quartos === undefined || quartos === '') return '—';
  return NIVEIS_TANQUE[quartos] || '—';
}

/** Tanque em 1/4 ou menos pede combustível antes da próxima saída. */
export function precisaAbastecer(quartos) {
  return Number.isInteger(quartos) && quartos <= 1;
}

/** O uso ainda aberto de um veículo — o que está na rua agora.
 *
 * SÓ VIAGEM. A posse do dono fixo (F6/D9) também é uma linha aberta, e contá-la
 * aqui faria o Volvo do Humberto aparecer "na rua com Humberto" para sempre,
 * com o botão de devolver aceso sem fim. Linha sem `tipo` é anterior à
 * migration 028 e vale como viagem. */
export function usoAberto(usos, veiculoId) {
  return (usos || []).find((u) =>
    u && u.veiculo_id === veiculoId && !u.volta_em
    && (u.tipo || 'viagem') === 'viagem') || null;
}

/** O maior hodômetro já registrado em checklist deste carro. Nulo se não há.
 *
 * Pelo MAIOR e não pela data mais nova, pela mesma razão de ultimaRevisao():
 * data digitada errada acontece o tempo todo, e o odômetro só anda pra frente. */
export function ultimoHodometro(fichas, veiculoId) {
  const meus = (fichas || [])
    .filter((f) => f && f.veiculo_id === veiculoId && Number.isInteger(f.hodometro))
    .map((f) => f.hodometro);
  return meus.length ? Math.max(...meus) : null;
}

/** O maior KM já registrado numa manutenção deste carro. Nulo se não há.
 *
 * A QUARTA fonte de quilometragem (D29), e a que faz a aba Revisões existir de
 * verdade: medido em 12/08/2026, 8 dos 10 carros não tinham KM conhecido nenhum,
 * porque quase ninguém registra viagem e o checklist tinha 2 fichas na frota
 * toda. Sem esta fonte, o dono registra a troca de óleo com 92.000 km e a aba
 * continua respondendo "ainda não sei a quilometragem deste carro" — o trabalho
 * dele não apareceria em lugar nenhum.
 *
 * Pelo MAIOR e não pela data mais nova, mesma razão de ultimoHodometro() e de
 * ultimaRevisao(): data digitada errada acontece o tempo todo, e o odômetro só
 * anda pra frente. */
export function ultimoKmDeRevisao(revisoes, veiculoId) {
  const meus = (revisoes || [])
    .filter((r) => r && r.veiculo_id === veiculoId && Number.isInteger(r.km))
    .map((r) => r.km);
  return meus.length ? Math.max(...meus) : null;
}

/** O último uso ENCERRADO, que é de onde sai o KM atual. */
export function ultimoUsoFechado(usos, veiculoId) {
  const fechados = (usos || [])
    .filter((u) => u && u.veiculo_id === veiculoId && u.volta_em && Number.isInteger(u.km_volta));
  if (!fechados.length) return null;
  // Ordena pela VOLTA, não pela saída: quem devolveu por último é quem tem o
  // odômetro mais recente, mesmo que tenha saído antes de outro.
  return fechados.slice().sort((a, b) => String(b.volta_em).localeCompare(String(a.volta_em)))[0];
}

/**
 * Monta a linha da tela para um veículo: onde está, com quem, KM e tanque.
 * Não inventa nada: campo sem resposta volta nulo, e a tela mostra travessão.
 */
export function estadoDoVeiculo(veiculo, usos, fichas, revisoes) {
  const aberto = usoAberto(usos, veiculo.id);
  const fechado = ultimoUsoFechado(usos, veiculo.id);
  // O KM mais alto que se conhece. QUATRO fontes: a última devolução, a saída de
  // quem está na rua, o hodômetro do checklist — que é a única que funciona pra
  // quem tem carro fixo e nunca registra viagem — e o KM da manutenção (D29),
  // que é a única que funciona pra carro que ninguém dirige nem confere, e são
  // 8 dos 10.
  //
  // `revisoes` é OPCIONAL de propósito: quem chamar com três argumentos continua
  // com o comportamento de antes. É o mesmo molde do `pessoas` opcional de
  // quemEstaComOCarro(), pela mesma razão — a Edge não tem essa lista à mão.
  const kms = [
    fechado && fechado.km_volta,
    aberto && aberto.km_saida,
    ultimoHodometro(fichas, veiculo.id),
    ultimoKmDeRevisao(revisoes, veiculo.id),
  ].filter(Number.isInteger);
  const km = kms.length ? Math.max(...kms) : null;
  // O tanque também vem do registro mais recente que tiver informado.
  const ultimo = aberto || fechado;
  const tanque = ultimo && Number.isInteger(ultimo.tanque_quartos) ? ultimo.tanque_quartos : null;

  return {
    veiculo,
    naRua: !!aberto,
    // Pessoa e local são SEPARADOS (decisão do dono): quem está com o carro
    // agora vence o responsável fixo; parado, mostra onde ele está.
    comQuem: aberto ? (aberto.pessoa_nome || null) : (veiculo.pessoa_nome || null),
    // Quem está com ele AGORA, por identificador. A área Motorista usa isto
    // pra separar "o meu carro" de "o carro de outra pessoa" — comparar por
    // nome quebraria com dois Gabriéis, e a empresa tem dois.
    usoAbertoPessoaId: aberto ? (aberto.pessoa_id || null) : null,
    // ONDE ELE ESTÁ: o local apontado na árvore VENCE o texto digitado à mão.
    // O contrário era o defeito B1 — 9 dos 10 carros tinham local apontado e a
    // lista lia só `local_texto`, então o trabalho de apontar não aparecia em
    // lugar nenhum. `local_bonito` é enriquecido por quem chama (mesmo padrão
    // de `pessoa_nome`), porque resolver a árvore aqui obrigaria esta função —
    // que é pura e roda no teste — a conhecer o Patrimônio.
    ondeEsta: aberto ? null : (veiculo.local_bonito || veiculo.local_texto || null),
    desde: aberto ? aberto.saida_em : (fechado ? fechado.volta_em : null),
    km,
    tanque,
    precisaAbastecer: precisaAbastecer(tanque),
    // LIVRE é o carro sem viagem aberta, sem dono fixo, ativo — e SEM RESERVA
    // APROVADA segurando. A reserva entrou aqui em 12/08/2026: a Bravo Essence
    // estava reservada e aprovada pro Felipe até 24/08 e a tela continuava
    // oferecendo ela como livre. O app aprovava a reserva e convidava outra
    // pessoa a pegar o mesmo carro — o CONFLITO DE VIAGENS que esta ferramenta
    // existe pra impedir.
    // `reservada` vem enriquecida por quem chama, no mesmo molde de
    // `pessoa_nome` e `local_bonito`: manter esta função pura e sem conhecer a
    // agenda de requisições.
    disponivel: !aberto && veiculo.situacao === 'ativo' && !veiculo.pessoa_id
      && !veiculo.reservada,
    // LIVRE PARA MIM é a mesma coisa, com UMA exceção: a reserva que segura o
    // carro não segura contra quem a fez. Medido em 20/08/2026: da hora
    // marcada em diante, `disponivel` escondia o carro de "Livres para pegar"
    // pra todo mundo — e é lá dentro que mora o botão "Peguei o carro". Quem
    // chegava no horário combinado abria o app e o carro tinha sumido; só
    // funcionava pra quem abria ANTES da hora.
    //
    // Os dois campos convivem de propósito: a Gestão continua lendo
    // `disponivel` e vendo o carro como reservado, que é a verdade da frota. O
    // que muda é só o painel de quem dirige. `reservada_para_mim` é
    // enriquecido por quem chama, no mesmo molde de `reservada` — esta função
    // é pura e não sabe quem está logado.
    disponivelParaMim: !aberto && veiculo.situacao === 'ativo' && !veiculo.pessoa_id
      && (!veiculo.reservada || !!veiculo.reservada_para_mim),
    // Quem reservou, pra frase da tela poder dizer com quem falar.
    reservadaPor: (!aberto && veiculo.reservada && veiculo.reservada_por) || null,
    // A minha reserva em vigor neste carro: o selo "Sua reserva" no card sai
    // daqui. Sem ele, o carro reaparece nos livres sem dizer por quê.
    reservadaParaMim: !aberto && !!veiculo.reservada && !!veiculo.reservada_para_mim,
  };
}

/** A frase curta que resume a linha, pra quem só bate o olho. */
export function resumoDoEstado(e) {
  if (!e) return '';
  if (e.veiculo.situacao === 'em_manutencao') return 'Na oficina';
  if (e.veiculo.situacao === 'alienado') return 'Fora da frota';
  if (e.veiculo.situacao === 'inativo') return 'Parado';
  if (e.naRua) return e.comQuem ? `Na rua com ${e.comQuem}` : 'Na rua';
  // Carro com responsável NÃO é livre — e o texto tem que dizer isso. A
  // primeira versão escrevia "Livre, com Humberto", que se contradiz na mesma
  // frase e fazia a pessoa achar que podia pegar.
  if (e.comQuem) return `Com ${e.comQuem}`;
  // Reservado NÃO é livre, e a frase tem de dizer POR QUE — senão o carro some
  // da lista de livres e ninguém entende o motivo. Com o nome de quem reservou,
  // quem precisa do carro resolve no WhatsApp em trinta segundos, que é a mesma
  // razão pela qual o aviso de conflito carrega nome e destino.
  if (e.reservadaPor) return `Reservado para ${e.reservadaPor}`;
  if (e.veiculo.reservada) return 'Reservado';
  // Sem responsável mas COM contato: o vazio sozinho parecia defeito, e o
  // dono estranhou a Doblo justamente por isso — ela não tem responsável na
  // Frota e tem "Siqueira" no contato, e as duas coisas se confundiam.
  // Responsável é quem responde pelo carro; contato é a quem perguntar. Dizer
  // as duas na mesma frase resolve, sem fingir que uma é a outra.
  if (e.veiculo.contato_nome) {
    return e.ondeEsta
      ? `Livre, em ${e.ondeEsta} — perguntar a ${e.veiculo.contato_nome}`
      : `Livre — sem responsável; perguntar a ${e.veiculo.contato_nome}`;
  }
  if (e.ondeEsta) return `Livre, em ${e.ondeEsta}`;
  return 'Livre';
}

/** Ordena a lista do jeito que ajuda: o que está livre primeiro, sucata por último. */
export function ordenarEstados(estados) {
  const peso = (e) => {
    if (e.veiculo.situacao === 'alienado') return 4;
    if (e.veiculo.situacao === 'inativo') return 3;
    if (e.veiculo.situacao === 'em_manutencao') return 2;
    return e.naRua ? 1 : 0;
  };
  return (estados || []).slice().sort((a, b) =>
    peso(a) - peso(b) || String(a.veiculo.nome || '').localeCompare(String(b.veiculo.nome || '')));
}

/**
 * Valida uma devolução ANTES de gravar. Devolve a lista de problemas em
 * português; vazia significa que pode gravar.
 */
/**
 * O que falta para registrar uma retirada que aconteceu FORA do aplicativo.
 *
 * POR QUE ESTE CAMINHO EXISTE: a vida acontece fora do app. Alguém pega o carro
 * no sábado, sem o celular na mão, e isso precisa entrar no sistema depois.
 * Antes de 21/08/2026 não havia porta nenhuma — só saía carro pelo "Peguei o
 * carro", que exige reserva aprovada. Fechar essa porta não faz o checklist
 * existir; faz a VIAGEM não existir, e aí o carro fica eternamente "livre" numa
 * tela que jura que ele está na garagem.
 *
 * NÃO PEDE CHECKLIST, de propósito: ninguém confere hoje um carro que saiu
 * sábado. O histórico marca essa retirada como "não ficou prova nenhuma" — é
 * ponta VISÍVEL, que é o melhor que se pode fazer com o que já passou.
 *
 * O QUE É TRAVA: o KM (é ele que alimenta o aviso de revisão) e a hora da
 * saída, que não pode estar no futuro — data adiante vira um carro "na rua"
 * antes de sair.
 */
export function problemasDoRegistroAvulso({ km, saidaEm, agoraIso } = {}) {
  if (!Number.isInteger(km) || km <= 0) {
    return ['Informe o KM que estava no painel quando o carro saiu.'];
  }
  const texto = String(saidaEm || '').trim();
  if (!texto) return ['Informe quando o carro saiu.'];
  const quando = Date.parse(texto);
  if (!Number.isFinite(quando)) {
    return ['Não entendi a data da saída. Confira o dia e a hora.'];
  }
  const agora = Date.parse(agoraIso);
  if (Number.isFinite(agora) && quando > agora) {
    return ['Essa saída está no futuro. Este registro é para o que já aconteceu — '
      + 'o carro ainda não saiu.'];
  }
  return [];
}

export function problemasDaDevolucao({ kmSaida, kmVolta }) {
  const p = [];
  if (!Number.isInteger(kmVolta) || kmVolta <= 0) {
    p.push('Informe o KM que está no painel agora.');
  } else if (Number.isInteger(kmSaida)) {
    if (kmVolta < kmSaida) {
      p.push(`O KM de volta (${kmVolta.toLocaleString('pt-BR')}) é menor que o da saída `
        + `(${kmSaida.toLocaleString('pt-BR')}). Confira o número no painel.`);
    } else if (kmVolta - kmSaida > 5000) {
      // Não impede: viagem longa existe. Mas 5.000 km numa saída é quase sempre
      // dedo errado, e é melhor perguntar do que gravar um odômetro falso que
      // depois dispara alerta de revisão sem motivo.
      p.push(`São ${(kmVolta - kmSaida).toLocaleString('pt-BR')} km nesta saída. `
        + 'Confirme se está certo antes de gravar.');
    }
  }
  return p;
}
