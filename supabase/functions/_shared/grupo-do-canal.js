// O GRUPO DO CANAL DE VENDA (atacado, varejo, ...).
//
// PEDIDO DO DONO (20/08/2026): "nas vendas tem o campo seletor de canais, eu
// quero uma separação por canal — exemplo, atacado (opção pra marcar/desmarcar
// todos) e varejo".
//
// PURO de propósito, como os vizinhos desta pasta: aqui não se desenha nada e
// não se fala com banco. A tela pergunta e obedece.
//
// O GRUPO MORA NO CANAL (`bling_lojas.grupo`), NÃO NO TIME. Medido: dos 14
// canais do Bling só 3 têm time, e os 11 sem time aparecem no seletor das
// dashboards do mesmo jeito. Pôr o rótulo no time deixaria esses 11 sem grupo.
// O time é atacado ou varejo pelo canal a que já está amarrado.
//
// Grupo é TEXTO, não uma lista travada no código: o dono disse "exemplo,
// atacado e varejo", e "exemplo" é o aviso de que um terceiro pode aparecer.

// Espaço das pontas fora, espaço repetido virando um só, vazio virando nulo.
// Sem isto, "Atacado " e "Atacado" viram dois grupos que parecem um.
export function normalizarGrupo(texto) {
  const t = String(texto == null ? '' : texto).trim().replace(/\s+/g, ' ');
  return t === '' ? null : t;
}

// Comparar SEM diferenciar maiúscula: quem digita "atacado" está falando do
// mesmo grupo de quem digitou "Atacado".
export function mesmoGrupo(a, b) {
  const na = normalizarGrupo(a);
  const nb = normalizarGrupo(b);
  if (na === null || nb === null) return na === nb;
  return na.toLocaleLowerCase('pt-BR') === nb.toLocaleLowerCase('pt-BR');
}

// Os grupos que já existem, para o seletor oferecer. Guarda a grafia da PRIMEIRA
// aparição — quem escreveu primeiro decide como o nome aparece.
export function gruposExistentes(canais) {
  const vistos = new Map();
  for (const c of canais || []) {
    const g = normalizarGrupo(c && c.grupo);
    if (g === null) continue;
    const chave = g.toLocaleLowerCase('pt-BR');
    if (!vistos.has(chave)) vistos.set(chave, g);
  }
  return [...vistos.values()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

// Os canais em baldes. O balde SEM GRUPO vai por ÚLTIMO e só existe se tiver
// gente dentro: canal sem grupo não pode sumir da lista — some do seletor é o
// defeito que a Peça 2 evita — mas cabeçalho vazio também não ajuda ninguém.
export function agruparCanais(canais) {
  const lista = canais || [];
  const baldes = [];
  for (const nome of gruposExistentes(lista)) {
    baldes.push({ grupo: nome, canais: lista.filter((c) => mesmoGrupo(c && c.grupo, nome)) });
  }
  const orfaos = lista.filter((c) => normalizarGrupo(c && c.grupo) === null);
  if (orfaos.length) baldes.push({ grupo: null, canais: orfaos });
  return baldes;
}

// De-para canal -> time, para a linha do canal poder dizer de quem ele é.
// Chave em TEXTO porque o id vem number do banco e string do formulário: casar
// por tipo diferente faz a linha dizer "sem time" com o time bem ali.
export function timePorCanal(times) {
  const mapa = new Map();
  for (const t of times || []) {
    if (t == null) continue;
    const id = t.canal_loja_id;
    if (id === null || id === undefined || id === '') continue;
    mapa.set(String(id), t);
  }
  return mapa;
}

// Quantos ainda faltam configurar — vai no cabeçalho da seção.
export function contarSemGrupo(canais) {
  return (canais || []).filter((c) => normalizarGrupo(c && c.grupo) === null).length;
}

// ─────────────────────────────────────────────────────────────────────────────
// MARCAR / DESMARCAR TODOS DE UM GRUPO (Peça 2)
//
// PEDIDO DO DONO: "atacado (opção pra marcar/desmarcar todos) e varejo".
//
// O id é comparado como TEXTO: ele vem number do banco e string do atributo do
// HTML. Casar por tipo diferente faria o botão dizer "nenhum marcado" com o
// grupo inteiro marcado na tela.

function _ids(canaisDoGrupo) {
  return (canaisDoGrupo || [])
    .map((c) => (c && c.loja_id !== undefined && c.loja_id !== null ? String(c.loja_id) : null))
    .filter((id) => id !== null);
}

// 'todos' | 'alguns' | 'nenhum'. Grupo vazio é 'nenhum', nunca 'todos': "todos
// de nada" é verdade vazia, e faria o botão oferecer desmarcar o que não há.
export function estadoDoGrupo(canaisDoGrupo, selecionados) {
  const ids = _ids(canaisDoGrupo);
  if (!ids.length) return 'nenhum';
  const sel = new Set([...(selecionados || [])].map(String));
  const marcados = ids.filter((id) => sel.has(id)).length;
  if (marcados === 0) return 'nenhum';
  return marcados === ids.length ? 'todos' : 'alguns';
}

// Devolve um Set NOVO com o grupo inteiro marcado, ou o grupo inteiro fora se
// ele já estava todo marcado. Canal de outro grupo não é tocado — o que sai é o
// mesmo tipo que entrou, para a tela não precisar converter de volta.
export function alternarGrupo(canaisDoGrupo, selecionados) {
  const atual = new Set(selecionados || []);
  const ids = new Set(_ids(canaisDoGrupo));
  if (estadoDoGrupo(canaisDoGrupo, atual) === 'todos') {
    for (const v of [...atual]) if (ids.has(String(v))) atual.delete(v);
    return atual;
  }
  for (const c of canaisDoGrupo || []) {
    if (c && c.loja_id !== undefined && c.loja_id !== null) atual.add(c.loja_id);
  }
  return atual;
}

// ─────────────────────────────────────────────────────────────────────────────
// OS TIMES SOB CABEÇALHO DE GRUPO (Peça 4)
//
// PEDIDO DO DONO: "em usuários tem as seções de cada time, eu preciso também de
// uma separação por atacado e varejo".
//
// O time NÃO tem grupo próprio: ele herda do canal a que está amarrado. Time sem
// canal (loja que ainda vai abrir) e time cujo canal está sem grupo caem no
// mesmo balde do fim — sumir da gestão de usuários seria perder o time de vista.
//
// Cabeçalho de grupo que não tem time embaixo NÃO é criado: um canal marcado
// como "Marketplace" sem time nenhum viraria um título vazio na tela.
export function agruparTimesPorGrupo(times, canais, grupos) {
  const lista = times || [];
  if (!lista.length) return [];

  // De-para canal -> id do grupo. O id, e não o texto: desde 27/08 o grupo é uma
  // linha cadastrada (`canais_grupos`), e é ela que o card pai precisa ter na
  // mão — um cartão de grupo sem o id do grupo não teria onde pendurar as
  // supervisoras nem os botões dele.
  const grupoIdDoCanal = new Map();
  for (const c of canais || []) {
    if (c == null || c.loja_id === undefined || c.loja_id === null) continue;
    const gid = c.grupo_id;
    grupoIdDoCanal.set(String(c.loja_id), gid === undefined || gid === null || gid === '' ? null : String(gid));
  }

  const porId = new Map();
  for (const g of grupos || []) if (g && g.id !== undefined && g.id !== null) porId.set(String(g.id), g);

  // O grupo do time, ou nulo. Nulo vale para três casos que a tela trata igual:
  // time sem canal (loja que ainda vai abrir), canal sem grupo, e canal
  // apontando para um grupo que não existe mais.
  const doTime = (t) => {
    const id = t && t.canal_loja_id;
    if (id === null || id === undefined || id === '') return null;
    const gid = grupoIdDoCanal.get(String(id));
    if (!gid) return null;
    return porId.get(gid) || null;
  };

  // Só entra grupo QUE TEM TIME. Um grupo com canais e nenhum time viraria um
  // cartão vazio no meio da gestão de usuários — a lista de canais é que mostra
  // todos os grupos, inclusive os vazios; esta aqui é a lista de TIMES.
  const usados = [];
  const vistos = new Set();
  for (const t of lista) {
    const g = doTime(t);
    if (!g) continue;
    const k = String(g.id);
    if (vistos.has(k)) continue;
    vistos.add(k);
    usados.push(g);
  }
  usados.sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));

  const baldes = usados.map((g) => ({
    grupo: g,
    times: lista.filter((t) => { const x = doTime(t); return x && String(x.id) === String(g.id); }),
  }));

  // Os sem grupo vão por último e NÃO somem: perder um time de vista na gestão
  // de usuários é perder o time inteiro.
  const orfaos = lista.filter((t) => doTime(t) === null);
  if (orfaos.length) baldes.push({ grupo: null, times: orfaos });
  return baldes;
}
