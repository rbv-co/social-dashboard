// Lógica pura do filtro por canal + seção de estoque da Gestão à Vista. Sem Vue/DOM (node-testável).

// ⚠️ ESTA LISTA DEIXOU DE SER A VERDADE em 05/09/2026.
//
// Ela era três depósitos escritos à mão, e o Bling tem SETE. Os quatro que
// faltavam (Almoxarifado, Loja Hortolândia, M.P Pulmão e Sede B. Prado) nunca
// existiram para esta tela, e loja nova exigia mexer em código aqui, no coletor
// e no robô comercial — três arquivos. Pior: o que este arquivo chamava de
// "Estoque Pulmão" é, no Bling, "Estoque P.A Pulmão" (produto acabado), e há um
// "M.P Pulmão" (matéria-prima) separado que ninguém aqui sabia que existia.
//
// Agora os depósitos vêm da tabela `bling_depositos`, alimentada pelo próprio
// Bling. Esta lista ficou só como SEMENTE, para a tela não ficar vazia se a
// leitura falhar.
export const DEPOSITOS_SEMENTE = [
  { id: 14888726315, nome: 'Estoque Loja Sbo. Tivoli', pulmao: false },
  { id: 14888617206, nome: 'Estoque Loja Dom Pedro',   pulmao: false },
  { id: 14888248253, nome: 'Estoque P.A Pulmão',       pulmao: true  },
];

// ── QUEM É LOJA E QUEM É RETAGUARDA ────────────────────────────────────────
//
// O PULMÃO é o depósito marcado como `padrao` no Bling — hoje o P.A Pulmão. Não
// é palpite: `padrao` é o campo com que o próprio Bling diz qual depósito conta
// o saldo do produto. Antes isto era um `pulmao:true` escrito à mão aqui.
//
// LOJA é o depósito cujo nome traz "loja". É a convenção do próprio cadastro do
// Bling — os três são "Estoque Loja X" — e é o que faz um "Estoque Loja
// Iguatemi" novo ser reconhecido sozinho. Quando a convenção não for seguida, o
// vínculo explícito de `fabrica_lojas` resolve (ver `depositosVisiveis`).
export function normalizarDepositos(linhas) {
  const lista = (linhas || [])
    .filter((l) => l && l.ativo !== false)
    .map((l) => ({
      id: Number(l.deposito_id ?? l.id),
      nome: String(l.nome || '').trim(),
      pulmao: !!(l.padrao ?? l.pulmao),
    }))
    .filter((d) => Number.isFinite(d.id) && d.id > 0);
  return lista.length ? lista : DEPOSITOS_SEMENTE.slice();
}

export function ehDepositoDeLoja(dep) {
  return !!dep && !dep.pulmao && /\bloja\b/i.test(String(dep.nome || ''));
}

// ── AS PALAVRAS QUE NÃO IDENTIFICAM NADA ───────────────────────────────────
// "Estoque Loja Dom Pedro" e "Loja Santa Bárbara d'Oeste" têm "loja" em comum e
// não são a mesma coisa. Casar por palavra sem tirar estas daria par errado.
const PALAVRAS_VAZIAS = new Set(['estoque', 'loja', 'shopping', 'de', 'do', 'da', 'e', 'a', 'o']);

function palavrasDe(texto) {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((p) => p.length > 2 && !PALAVRAS_VAZIAS.has(p));
}

// O canal e o depósito são a mesma loja? Só quando sobra palavra própria em
// comum — "iguatemi" com "iguatemi", e não "loja" com "loja".
export function canalCasaComDeposito(nomeDoCanal, dep) {
  const a = new Set(palavrasDe(nomeDoCanal));
  if (!a.size) return false;
  return palavrasDe(dep && dep.nome).some((p) => a.has(p));
}

export function statusSaldo(saldo, { crit = 3, low = 8 } = {}) {
  const q = Number(saldo) || 0;
  return q <= crit ? 'crit' : q <= low ? 'low' : 'ok';
}

// Casa os canais de venda aos depósitos e devolve as colunas que a seção mostra.
//
// `vinculos` é o mapa EXPLÍCITO canal→depósito (`fabrica_lojas`: canal_loja_id →
// deposito_id). Ele manda, porque nome nem sempre basta: o canal "Loja Santa
// Bárbara d'Oeste" corresponde ao depósito "Estoque Loja Sbo. Tivoli", e não há
// palavra em comum entre os dois. Sem o vínculo, o casamento cai no nome — que
// é o que faz uma loja nova aparecer sozinha.
//
// O PULMÃO ENTRA SEMPRE: ele é a retaguarda de todas as lojas, e sem ele a
// pessoa vê a loja com 2 peças e conclui que acabou.
// Vazio/null -> todos os depósitos.
export function depositosVisiveis(canais, depositos = DEPOSITOS_SEMENTE, vinculos = null) {
  const todos = normalizarDepositos(depositos);
  const nomes = canais == null ? [] : Array.from(canais).filter((n) => n && n !== 'todos');
  if (nomes.length === 0) return todos;

  const mapa = vinculos instanceof Map ? vinculos : new Map(Object.entries(vinculos || {}));
  const casados = new Set();
  for (const canal of nomes) {
    // 1º o vínculo explícito, por id do canal OU pelo nome dele
    const porVinculo = mapa.get(String(canal?.loja_id ?? canal)) ?? mapa.get(String(canal));
    if (porVinculo != null) { casados.add(Number(porVinculo)); continue; }
    // 2º o nome, que é o que reconhece a loja nova sozinha
    const nomeDoCanal = canal?.nome ?? canal;
    for (const d of todos) {
      if (ehDepositoDeLoja(d) && canalCasaComDeposito(nomeDoCanal, d)) casados.add(d.id);
    }
  }
  // ⚠️ A ORDEM É DECIDIDA AQUI, e não herdada da ordem em que o Bling mandou:
  // LOJA primeiro, RETAGUARDA depois. Quem abre a seção está olhando a loja; o
  // pulmão é a resposta à pergunta seguinte ("tem mais de onde tirar?"). Com o
  // pulmão no meio das colunas, a leitura embaralha.
  const visiveis = todos.filter((d) => d.pulmao || casados.has(d.id));
  return [...visiveis.filter((d) => !d.pulmao), ...visiveis.filter((d) => d.pulmao)];
}

// Matéria-prima / insumo entra no banco com categoria VAZIA (o coletor classifica
// embalagem, aviamento, fivela a granel, tinta, forro, zíper etc. como categoria=null).
// Produto de verdade sempre tem categoria. Esta função reconhece o item que NÃO deve
// aparecer no estoque (regra fixa, não é um filtro que o usuário liga/desliga).
export function ehMateriaPrima(it) {
  return it == null || it.categoria == null || String(it.categoria).trim() === '';
}

// Lista as categorias reais (sem matéria-prima), únicas e ordenadas em pt-BR — pra
// montar o seletor de categoria da seção de estoque.
export function categoriasDisponiveis(itens) {
  const set = new Set();
  (itens || []).forEach((it) => { if (!ehMateriaPrima(it)) set.add(String(it.categoria)); });
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

export function prepararEstoque(itens, { busca = '', status = 'todos', sort = 'qasc', limit = 'all', categorias = null } = {}) {
  const b = String(busca).trim().toLowerCase();
  // categorias: array/Set de categorias selecionadas (multi). Vazio/null = todas.
  const cats = categorias == null ? [] : Array.from(categorias).filter((c) => c && c !== 'todas');
  const catSet = cats.length ? new Set(cats.map(String)) : null;
  // Quantos a tela esconde por não serem produto. Conta ANTES dos filtros da
  // pessoa, de propósito: o número é sobre o que a tela omite sempre, não sobre
  // o que a busca deixou de fora. Esconder calado é o defeito gêmeo de mostrar
  // o que não devia — desde 20/08/2026 aqui cai também o que o coletor não
  // conseguiu classificar, e uma linha de produto nova pode estar no meio.
  const semClassificacao = (itens || []).filter(ehMateriaPrima).length;
  let rows = (itens || []).filter((it) => {
    // Regra fixa: matéria-prima/insumo (categoria vazia) nunca aparece no estoque.
    if (ehMateriaPrima(it)) return false;
    if (catSet && !catSet.has(String(it.categoria))) return false;
    if (b && !(String(it.sku).toLowerCase().includes(b) || String(it.produto || '').toLowerCase().includes(b))) return false;
    const s = statusSaldo(it.saldo);
    return status === 'todos' || (status === 'crit' && s === 'crit') || (status === 'baixocrit' && (s === 'crit' || s === 'low'));
  });
  rows.sort((a, b2) => {
    if (sort === 'qasc') return a.saldo - b2.saldo;
    if (sort === 'qdesc') return b2.saldo - a.saldo;
    if (sort === 'sku') return String(a.sku) < String(b2.sku) ? -1 : 1;
    return String(a.produto || '') < String(b2.produto || '') ? -1 : 1;
  });
  const full = rows.length;
  if (limit !== 'all') rows = rows.slice(0, Number(limit) || full);
  return { rows, full, semClassificacao };
}

// canaisIds: array/Set de loja.id selecionados. Vazio/null -> todos os pedidos.
export function filtrarPedidosPorCanal(pedidos, canaisIds) {
  const ids = canaisIds == null ? [] : Array.from(canaisIds);
  if (ids.length === 0) return pedidos || [];
  const set = new Set(ids);
  return (pedidos || []).filter((p) => p.loja && set.has(p.loja.id));
}
