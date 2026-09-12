/* Quando cada carro precisa de revisão.
 *
 * A conta é simples: KM da última troca + o intervalo do plano = o KM alvo.
 * O que faz isso funcionar aqui e não funcionar na planilha é de onde vem o
 * "KM atual": lá ele é digitado à mão (e por isso a aba "Alertas" está vazia),
 * aqui ele cai sozinho de cada devolução. */

// Avisa quando falta 10% do intervalo — 700 km para um óleo de 7.000, uns
// 6.000 para uma correia de 60.000. Proporcional, porque avisar 500 km antes
// da correia seria tarde e 500 km antes do óleo seria cedo demais.
export const FATIA_DE_AVISO = 0.10;

export const SITUACOES_REVISAO = {
  vencida:      { rotulo: 'Vencida', peso: 0 },
  perto:        { rotulo: 'Perto', peso: 1 },
  'em-dia':     { rotulo: 'Em dia', peso: 2 },
  'sem-registro': { rotulo: 'Sem registro', peso: 3 },
  'sem-km':     { rotulo: 'Sem quilometragem', peso: 4 },
};

/** A última revisão registrada de um item, num carro. Nula se nunca houve. */
export function ultimaRevisao(revisoes, veiculoId, item) {
  const doItem = (revisoes || []).filter((r) =>
    r && r.veiculo_id === veiculoId && r.item === item && Number.isInteger(r.km));
  if (!doItem.length) return null;
  // Pelo MAIOR km, não pela data: data digitada errada acontece o tempo todo,
  // e o odômetro só anda pra frente.
  return doItem.slice().sort((a, b) => b.km - a.km)[0];
}

/**
 * O estado de um item de revisão num carro.
 * Devolve { item, aCadaKm, ultimaKm, alvo, situacao, faltam, texto }.
 * Nunca chuta: sem quilometragem ou sem histórico, diz isso.
 */
export function estadoDaRevisao({ item, aCadaKm, ultimaKm, kmAtual }) {
  const base = { item, aCadaKm, ultimaKm: ultimaKm ?? null, alvo: null, faltam: null };
  if (!Number.isInteger(kmAtual)) {
    return { ...base, situacao: 'sem-km',
      texto: 'Ainda não sei a quilometragem deste carro. Ela aparece na primeira devolução.' };
  }
  if (!Number.isInteger(ultimaKm)) {
    return { ...base, situacao: 'sem-registro',
      texto: `Nunca foi registrada uma troca de ${item.toLowerCase()} neste carro.` };
  }
  const alvo = ultimaKm + aCadaKm;
  const faltam = alvo - kmAtual;
  const margem = Math.round(aCadaKm * FATIA_DE_AVISO);
  const situacao = faltam <= 0 ? 'vencida' : (faltam <= margem ? 'perto' : 'em-dia');
  const km = (n) => Math.abs(n).toLocaleString('pt-BR');
  const texto = situacao === 'vencida'
    ? `Passou ${km(faltam)} km do ponto de troca.`
    : `Faltam ${km(faltam)} km.`;
  return { ...base, alvo, faltam, situacao, texto };
}

/** Todos os itens do plano, para um carro. Ordenados pelo que dói primeiro. */
export function revisoesDoVeiculo({ veiculo, kmAtual, plano, revisoes }) {
  return (plano || [])
    .filter((p) => p && p.ativo !== false)
    .map((p) => {
      const u = ultimaRevisao(revisoes, veiculo.id, p.item);
      return estadoDaRevisao({
        item: p.item, aCadaKm: p.a_cada_km,
        ultimaKm: u ? u.km : null, kmAtual,
      });
    })
    .sort((a, b) => {
      const pa = SITUACOES_REVISAO[a.situacao].peso, pb = SITUACOES_REVISAO[b.situacao].peso;
      if (pa !== pb) return pa - pb;
      // Dentro do mesmo grupo, o mais urgente primeiro.
      return (a.faltam ?? Infinity) - (b.faltam ?? Infinity);
    });
}

/** O que a lista de carros mostra: quantos itens gritando neste veículo. */
export function resumoDeRevisoes(itens) {
  const l = itens || [];
  // Lista vazia é o que uma consulta ao plano que FALHOU devolve — não um
  // carro sem nada a revisar. Ver tela-de-frota.vue:
  // `plano.value = pl && !pl.error ? (pl.data || []) : []`: permissão negada
  // ou rede fora dá `[]` em silêncio, e sem este corte os 10 carros da frota
  // mostrariam o selo verde "Revisões em dia" sobre uma sanfona vazia — a
  // mesma mentira que o resto desta função existe pra evitar (ver `semKm` e
  // `semRegistro` abaixo).
  if (!l.length) return { nivel: 'sem-registro', texto: 'Sem plano de revisão' };
  const vencidas = l.filter((i) => i.situacao === 'vencida').length;
  const perto = l.filter((i) => i.situacao === 'perto').length;
  if (vencidas) return { nivel: 'vencida', texto: vencidas === 1 ? '1 revisão vencida' : `${vencidas} revisões vencidas` };
  if (perto) return { nivel: 'perto', texto: perto === 1 ? '1 revisão chegando' : `${perto} revisões chegando` };
  // "Em dia" só se pode dizer sobre o que se SABE. Carro sem quilometragem
  // conhecida (nenhuma devolução registrada ainda) e carro sem histórico de
  // troca não estão em dia — não se sabe nada sobre eles, e afirmar que estão
  // bem é a pior resposta possível: some do alerta e ninguém revisa.
  const semKm = l.filter((i) => i.situacao === 'sem-km').length;
  if (semKm === l.length && l.length) {
    return { nivel: 'sem-km', texto: 'Sem quilometragem ainda' };
  }
  const semRegistro = l.filter((i) => i.situacao === 'sem-registro').length;
  if (semRegistro + semKm === l.length && l.length) {
    return { nivel: 'sem-registro', texto: 'Sem histórico de revisão' };
  }
  return { nivel: 'em-dia', texto: 'Revisões em dia' };
}

/**
 * A ordem da aba Revisões quando ela mostra TUDO (D30): o que dói primeiro em
 * cima, e nenhum carro descartado.
 *
 * A versão antiga jogava fora o carro que não tivesse item vencendo — e como
 * 8 dos 10 carros não têm quilometragem conhecida, a aba ficava praticamente
 * vazia e parecia que estava tudo em dia. "Sem quilometragem" não é estar em
 * dia: é não se saber nada, e some do alerta justamente quem mais precisa dele.
 *
 * O peso reaproveita SITUACOES_REVISAO, que já ordena os itens dentro do carro
 * — dois critérios diferentes pra mesma urgência dariam duas respostas.
 */
export function ordenarCarrosPorUrgencia(cartoes) {
  const peso = (c) => SITUACOES_REVISAO[c && c.resumo && c.resumo.nivel]?.peso ?? 9;
  return (cartoes || []).slice().sort((a, b) =>
    peso(a) - peso(b)
    // Desempate pelo nome: sem ele a lista dança de posição a cada carregada,
    // e quem procura um carro pelo lugar onde ele estava não acha.
    || String(a?.linha?.veiculo?.nome || '').localeCompare(String(b?.linha?.veiculo?.nome || '')));
}

/* ── O editor de limiares ─────────────────────────────────────────────────── */

/**
 * Valida um item do plano antes de gravar. O dono edita e acrescenta itens
 * aqui — o mecânico muda de opinião, e o plano tem que acompanhar sem depender
 * de programador.
 */
export function problemasDoItem({ item, aCadaKm, existentes, idAtual }) {
  const p = [];
  const nome = String(item || '').trim();
  if (!nome) p.push('Dê um nome ao item. Ex.: "Filtro de ar".');
  else if (nome.length < 3) p.push('O nome está curto demais para alguém entender depois.');

  const km = Number(aCadaKm);
  if (!Number.isFinite(km) || !Number.isInteger(km) || km <= 0) {
    p.push('Informe de quantos em quantos quilômetros esse item se troca.');
  } else if (km < 500) {
    p.push('Menos de 500 km entre trocas é quase certamente um dedo errado — confira o número.');
  } else if (km > 500000) {
    p.push('Mais de 500.000 km entre trocas não avisaria nunca. Confira o número.');
  }

  const repetido = (existentes || []).some((e) =>
    e && e.id !== idAtual && String(e.item || '').trim().toLowerCase() === nome.toLowerCase());
  if (nome && repetido) {
    p.push(`Já existe um item chamado "${nome}". Edite o que existe em vez de criar outro igual — `
      + 'dois itens com o mesmo nome dariam dois alertas para a mesma troca.');
  }
  return p;
}

/** Aviso ao desativar um item: o histórico não se perde, e vale dizer isso. */
export function avisoAoDesativar(item) {
  return `"${item}" deixa de gerar alerta. As trocas já registradas continuam no histórico `
    + 'de cada carro — nada é apagado, e dá pra reativar depois.';
}
