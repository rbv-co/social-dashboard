// A PLANILHA DAS GARANTIAS, espelhada no Zoho WorkDrive.
//
// Mora aqui, e não dentro da edge, por um motivo prático: a edge é Deno e
// importa de URL, então não dá para carregá-la num teste de node. A regra que
// decide o que a planilha diz precisa de teste — ela carrega CPF de cliente.
//
// ⚠️ O CPF VAI INTEIRO, por decisão do dono em 06/09/2026. Foi perguntado com a
// alternativa mascarada na mesa; ele escolheu inteiro para a planilha bastar
// sozinha numa disputa, sem abrir a Central. Quem mexer aqui depois: isto é uma
// escolha consciente, não um descuido — e o arquivo mora num drive
// compartilhado.

// Os três estados que a fila do banco aceita (`vessel_pedidos_de_registro`),
// mais o da garantia que já existe de verdade. Rótulo em português porque quem
// abre a planilha não lê `pendente`.
export const ESTADO_LEGIVEL = {
  confirmada: 'confirmada',
  pendente: 'em conferência',
  aprovado: 'confirmada',
  recusado: 'recusada',
};

function celula(v) {
  const s = v === null || v === undefined ? '' : String(v);
  // Aspas, ponto-e-vírgula, vírgula e quebra de linha dentro do campo quebram a
  // planilha se não forem escapados. Nome de gente tem vírgula.
  return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function quando(v) {
  if (!v) return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 19).replace('T', ' ');
}

function dia(v) {
  if (!v) return '';
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '';
}

export const CABECALHO = [
  'estado', 'codigo', 'modelo', 'cor', 'nome', 'cpf', 'whatsapp',
  'onde_comprou', 'comprado_em', 'garantia_ate', 'registrado_em', 'pedido_bling',
];

/**
 * Monta a planilha a partir das garantias confirmadas e da fila de conferência.
 *
 * @param registros  linhas de `vessel_registros` (a garantia que vale)
 * @param pedidos    linhas de `vessel_pedidos_de_registro` (a fila)
 * @param pecaParaLote  { codigo -> {modelo, cor} }, para a planilha dizer QUAL bolsa
 */
export function montarCsvDeGarantias(registros, pedidos, pecaParaLote = {}) {
  const linhas = [];

  for (const r of (registros || [])) {
    const peca = pecaParaLote[r.codigo] || {};
    linhas.push({
      ordem: r.registrado_em || r.comprado_em || '',
      campos: [
        ESTADO_LEGIVEL.confirmada, r.codigo, peca.modelo || '', peca.cor || '',
        r.nome, r.cpf, r.whatsapp, r.onde_comprou,
        dia(r.comprado_em), dia(r.garantia_ate), quando(r.registrado_em), r.bling_pedido || '',
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
        dia(p.comprado_em), '', quando(p.criado_em), '',
      ],
    });
  }

  // Mais recente primeiro: quem abre a planilha quer ver o que chegou hoje.
  linhas.sort((a, b) => String(b.ordem).localeCompare(String(a.ordem)));

  const corpo = linhas.map((l) => l.campos.map(celula).join(','));
  return [CABECALHO.join(','), ...corpo].join('\n') + '\n';
}
