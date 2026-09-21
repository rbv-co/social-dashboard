// A ABA DAS GARANTIAS — as regras de QUEM entra e COMO se chama cada estado.
//
// ⚠️ ESTE ARQUIVO CARREGA CPF DE CLIENTE, por decisão do dono em 06/09/2026.
// Foi perguntado com a alternativa mascarada na mesa; ele escolheu inteiro para
// a planilha bastar sozinha numa disputa, sem abrir a Central. Quem mexer aqui
// depois: isto é escolha consciente, não descuido — e o arquivo mora num drive
// compartilhado.
//
// ⚠️ MUDOU DE CASA EM 21/09/2026. Era `supabase/functions/_shared/csv-de-garantias.js`,
// e morava lá porque a edge do Supabase escrevia a planilha. Agora quem escreve
// é o robô das planilhas, em node, e o motivo de morar em `_shared` acabou:
// nenhuma edge importa isto. As regras (a fila que não duplica, o estado em
// português, o prazo que não se inventa) vieram inteiras, com os testes.
//
// Ele devolve LINHAS CRUAS, não texto: a data vai como o banco a deu e quem
// formata é `planilha-xlsx.mjs`, num lugar só. Foi assim que o fuso parou de
// errar — antes cada planilha cortava a data do jeito dela.

// Os três estados que a fila do banco aceita (`vessel_pedidos_de_registro`),
// mais o da garantia que já existe de verdade. Rótulo em português porque quem
// abre a planilha não lê `pendente`.
export const ESTADO_LEGIVEL = {
  confirmada: 'confirmada',
  pendente: 'em conferência',
  aprovado: 'confirmada',
  recusado: 'recusada',
};

export const COLUNAS = [
  { titulo: 'Estado', largura: 16 },
  { titulo: 'Código', largura: 14 },
  { titulo: 'Modelo', largura: 16 },
  { titulo: 'Cor', largura: 14 },
  { titulo: 'Nome', largura: 28 },
  { titulo: 'CPF', largura: 16 },
  { titulo: 'WhatsApp', largura: 18 },
  { titulo: 'Onde comprou', largura: 30 },
  { titulo: 'Comprado em', tipo: 'dia', largura: 14 },
  { titulo: 'Garantia até', tipo: 'dia', largura: 14 },
  { titulo: 'Registrado em', tipo: 'instante', largura: 18 },
  { titulo: 'Pedido no Bling', largura: 15 },
];

// ⚠️ Data que não é data vira vazio, e não vai crua para a célula: 'xx' numa
// coluna de data confunde mais do que ajuda, e 'Invalid Date' nunca.
const dia = (v) => {
  const s = String(v ?? '');
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '';
};

/**
 * As linhas da aba, das garantias confirmadas e da fila de conferência.
 *
 * @param registros  linhas de `vessel_registros` (a garantia que vale)
 * @param pedidos    linhas de `vessel_pedidos_de_registro` (a fila)
 * @param pecaParaLote  { codigo -> {modelo, cor} }, para a planilha dizer QUAL bolsa
 */
export function linhasDeGarantias(registros, pedidos, pecaParaLote = {}) {
  const linhas = [];

  for (const r of (registros || [])) {
    const peca = pecaParaLote[r.codigo] || {};
    linhas.push({
      ordem: r.registrado_em || r.comprado_em || '',
      campos: [
        ESTADO_LEGIVEL.confirmada, r.codigo, peca.modelo || '', peca.cor || '',
        r.nome, r.cpf, r.whatsapp, r.onde_comprou,
        dia(r.comprado_em), dia(r.garantia_ate), r.registrado_em || '', r.bling_pedido || '',
      ],
    });
  }

  // ⚠️ A FILA SÓ ENTRA COM O QUE AINDA NÃO VIROU GARANTIA. Um pedido aprovado
  // já tem linha em `vessel_registros`; sem este corte a mesma pessoa apareceria
  // DUAS vezes na planilha, uma "confirmada" e outra "confirmada" — e quem
  // contasse as garantias contaria errado.
  const jaSaoGarantia = new Set((registros || []).map((r) => String(r.codigo)));
  for (const p of (pedidos || [])) {
    if (jaSaoGarantia.has(String(p.codigo))) continue;
    const peca = pecaParaLote[p.codigo] || {};
    linhas.push({
      ordem: p.criado_em || '',
      campos: [
        ESTADO_LEGIVEL[p.estado] || p.estado || '', p.codigo, peca.modelo || '', peca.cor || '',
        p.nome, p.cpf, p.whatsapp, p.onde_comprou,
        // ⚠️ Pedido em conferência NÃO tem prazo de garantia nem pedido no
        // Bling. Escrever qualquer coisa nessas duas colunas seria mentira.
        dia(p.comprado_em), '', p.criado_em || '', '',
      ],
    });
  }

  // Mais recente primeiro: quem abre a planilha quer ver o que chegou hoje.
  linhas.sort((a, b) => String(b.ordem).localeCompare(String(a.ordem)));
  return linhas.map((l) => l.campos);
}

/**
 * O mapa `código da peça -> {modelo, cor}`, montado das duas tabelas.
 * Duas leituras e um mapa, em vez de um `select` aninhado: embed com nome
 * ambíguo já derrubou consulta nesta casa, e aqui o custo é o mesmo.
 */
export function pecaParaLote(pecas, lotes) {
  const loteDoId = new Map((lotes || []).map((l) => [String(l.id), l]));
  const mapa = {};
  for (const p of (pecas || [])) {
    const l = loteDoId.get(String(p.lote_id));
    if (l) mapa[String(p.codigo)] = { modelo: l.modelo, cor: l.cor };
  }
  return mapa;
}
