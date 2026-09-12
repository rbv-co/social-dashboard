// AS LINHAS DE PROBLEMA DE UMA CONTA, prontas para `gt_registrar_problemas`.
//
// Existe para que o robô-vigia (`coletor/vigia-problemas-meta.mjs`) e a tela da
// Gestão de Tráfego montem a MESMA coisa. A regra de como se lê um problema já
// mora em `problemas-do-anuncio.js`, junto da tela; aqui só se junta anúncio com
// o nome da campanha dele e da conta.
//
// PURO: sem rede, sem banco.
import { linhasParaGuardar } from '../../src/ferramentas/gestao-trafego/problemas-do-anuncio.js';

// `anuncios` tem que ser a lista TODA da conta, não só os ativos: medido em
// 17/08/2026, dos 13 anúncios com `issues_info` nas 5 contas, ZERO estavam
// ACTIVE. Filtrar por ativo esconde todos os problemas, sempre.
export function linhasDaConta(conta, campanhas, anuncios) {
  const contaNome = (conta && (conta.display_name || conta.name)) || '';
  const nomeDaCampanha = new Map(
    (campanhas || []).filter((c) => c && c.id).map((c) => [String(c.id), c.name || '']),
  );

  // Um grupo por campanha, porque `linhasParaGuardar` recebe UM contexto para a
  // lista inteira — e o contexto é justamente o nome da campanha.
  const porCampanha = new Map();
  for (const a of anuncios || []) {
    if (!a || !a.id) continue;
    const chave = a.campaign_id ? String(a.campaign_id) : '';
    if (!porCampanha.has(chave)) porCampanha.set(chave, []);
    porCampanha.get(chave).push(a);
  }

  // DEDUPE NO NÍVEL DA CONTA, e não só dentro de cada grupo.
  //
  // O lote inteiro de uma conta é recusado pelo Postgres quando o mesmo par
  // (ad_id, codigo) aparece duas vezes — "ON CONFLICT DO UPDATE command cannot
  // affect row a second time". Não é erro de linha, é erro de comando: uma
  // repetição apaga a história da conta toda. Já aconteceu com a Vessel em
  // 17/08/2026, e ali a repetição vinha da própria Meta.
  //
  // `linhasParaGuardar` já deduplica dentro da chamada dele; o que ele não pode
  // ver é a repetição ENTRE grupos — que a paginação da Meta produz quando um
  // anúncio muda de página no meio da leitura.
  const vistos = new Set();
  const linhas = [];
  for (const [campanhaId, doGrupo] of porCampanha) {
    const contexto = {
      conta_nome: contaNome,
      campanha_nome: campanhaId ? (nomeDaCampanha.get(campanhaId) || '') : '',
      campaign_id: campanhaId || null,
    };
    for (const linha of linhasParaGuardar(doGrupo, contexto)) {
      const chave = `${linha.ad_id}::${linha.codigo}`;
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      linhas.push(linha);
    }
  }
  return linhas;
}
