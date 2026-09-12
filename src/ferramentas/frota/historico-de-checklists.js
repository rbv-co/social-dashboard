/* O HISTÓRICO DE CHECKLISTS: o que foi conferido, em que dia, por quem.
 *
 * Desenho: docs/superpowers/specs/2026-08-19-frota-gestao-refino-design.md (D6)
 *
 * POR QUE ISTO EXISTE. Pedido do dono em 19/08/2026: "quero uma seção também em
 * gestão onde eu possa ver o histórico de checklists feitos". Até aqui a aba
 * Gestão só mostrava o checklist de HOJE — quem quisesse ver o de ontem tinha
 * de abrir carro por carro, e mesmo assim só achava o último.
 *
 * NÃO HÁ CONSULTA NOVA POR TRÁS DISTO. A tela já carrega 120 dias de
 * `frota_checklist` (tela-de-frota.vue, em `carregar()`), justamente pra saber
 * quando foi a última mensal. O histórico é uma leitura diferente do mesmo dado
 * que já estava na memória.
 *
 * AGRUPA POR DIA, e não por carro, por escolha do dono: a pergunta que ele faz
 * é "o que aconteceu essa semana", não "me mostra tudo do Cayenne" — e pra essa
 * segunda já existe a ficha do próprio veículo. */

const texto = (v) => String(v ?? '').trim();

/** Os pedaços de uma data AAAA-MM-DD, ou nulo se não for uma. */
function partesDoDia(dia) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto(dia));
  if (!m) return null;
  return { ano: Number(m[1]), mes: Number(m[2]), dia: Number(m[3]) };
}

const NOME_DO_DIA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

/**
 * O dia escrito como gente lê: "17/08 · segunda".
 *
 * ⚠️ A ARMADILHA DO FUSO, e ela é a razão desta função existir em vez de um
 * `new Date(ficha.feita_em)` solto na tela.
 *
 * `feita_em` é uma coluna DATE — ela já é o dia local, sem hora. Mas
 * `new Date('2026-08-17')` é interpretado como MEIA-NOITE EM UTC, e num fuso
 * negativo como o nosso isso é 21h do dia 16. `getDay()` daquilo devolve
 * DOMINGO para uma ficha de segunda-feira.
 *
 * Por isso a data é lida como TEXTO e remontada com `new Date(ano, mes-1, dia)`,
 * que é hora local e não desliza. Esta central já quitou uma dívida inteira de
 * fuso; não se abre outra.
 */
export function rotuloDoDia(dia) {
  const p = partesDoDia(dia);
  if (!p) return 'sem data';
  const d = new Date(p.ano, p.mes - 1, p.dia);
  if (Number.isNaN(d.getTime())) return 'sem data';
  const dd = String(p.dia).padStart(2, '0');
  const mm = String(p.mes).padStart(2, '0');
  return `${dd}/${mm} · ${NOME_DO_DIA[d.getDay()]}`;
}

/* ── Os filtros ───────────────────────────────────────────────────────────── */

/**
 * A barra tem DOIS botões, e não um por resultado possível.
 *
 * "Só com ressalva" é a pergunta que se faz de verdade — "o que apareceu de
 * errado?". Um botão "Só liberado" existiria só por simetria, e responderia
 * uma pergunta que ninguém faz.
 */
export const FILTROS_DE_FICHA = [
  { chave: 'tudo', rotulo: 'Tudo' },
  { chave: 'com-ressalva', rotulo: 'Só com ressalva' },
];

/**
 * As fichas que passam pelos filtros.
 *
 * Os três SOMAM, não se substituem: escolher o carro e "só com ressalva" ao
 * mesmo tempo tem de responder "o que deu errado NESTE carro". Um filtro que
 * apagasse o outro faria a tela mostrar mais do que foi pedido — e quem
 * estivesse conferindo um carro específico leria linha de outro.
 */
export function filtrarFichas(fichas, { filtro, veiculoId, pessoaNome } = {}) {
  return (fichas || []).filter(Boolean).filter((f) => {
    if (filtro === 'com-ressalva' && f.resultado !== 'com_ressalvas') return false;
    if (veiculoId && f.veiculo_id !== veiculoId) return false;
    if (pessoaNome && texto(f.pessoa_nome) !== texto(pessoaNome)) return false;
    return true;
  });
}

/* ── O agrupamento ────────────────────────────────────────────────────────── */

/**
 * As fichas em blocos por dia, do mais novo pro mais velho.
 *
 * Cada ficha sai pronta pra tela: com o NOME do carro (nunca o id) e um
 * `assinada` booleano. Carro que saiu do cadastro ganha uma frase dizendo isso,
 * em vez de uma linha muda — mesma regra da linha do tempo.
 */
export function agruparPorDia(fichas, { veiculos } = {}) {
  const carros = new Map((veiculos || []).filter(Boolean).map((v) => [v.id, v]));
  const porDia = new Map();

  for (const f of (fichas || []).filter(Boolean)) {
    const dia = texto(f.feita_em);
    if (!porDia.has(dia)) porDia.set(dia, []);
    const carro = carros.get(f.veiculo_id);
    porDia.get(dia).push({
      ...f,
      veiculoNome: carro ? carro.nome : 'carro que saiu do cadastro',
      veiculoPlaca: carro ? (carro.placa || '') : '',
      // Booleano explícito: `assinada_em` nulo é "não assinada", e a tela tem de
      // poder DIZER isso. Deixar o nulo passar viraria um espaço em branco, que
      // é indistinguível de "a tela não sabe".
      assinada: !!f.assinada_em,
    });
  }

  return [...porDia.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
    .map(([dia, doDia]) => ({ dia, rotulo: rotuloDoDia(dia), fichas: doDia }));
}

/* ── O resumo do título fechado ───────────────────────────────────────────── */

/**
 * O que o título da gaveta diz quando ela está fechada: "3 fichas em 3 dias".
 *
 * Conta DIAS DISTINTOS, não fichas — duas fichas no mesmo dia são duas fichas
 * em um dia. É a mesma ideia dos outros títulos fechados desta tela: a resposta
 * chega antes do clique.
 */
export function resumoDasFichas(fichas) {
  const lista = (fichas || []).filter(Boolean);
  if (!lista.length) return 'nenhuma ficha ainda';
  const dias = new Set(lista.map((f) => texto(f.feita_em))).size;
  const f = lista.length === 1 ? '1 ficha' : `${lista.length} fichas`;
  const d = dias === 1 ? '1 dia' : `${dias} dias`;
  return `${f} em ${d}`;
}
