// DE QUAIS CANAIS DE VENDA EU VEJO O FATURAMENTO.
//
// PEDIDO DO DONO (12/08/2026): "pode mostrar os canais zerados para os outros
// usuários igual era... somente para quem é de time de venda mostre somente o
// resultado de sua loja".
//
// ─────────────────────────────────────────────────────────────────────────────
// POR QUE ISTO PRECISOU EXISTIR (medido em 12/08/2026)
//
// O banco JÁ recorta as vendas por time: `pode_ver_canal`
// (db/migrations/2026-08-04-escopo-em-vendas-e-estoque.sql) tranca
// `gc_vendas_item` por RLS, e foi medido com usuário descartável.
//
// SÓ QUE AS DUAS DASHBOARDS NÃO LEEM ESSA TABELA. Gestão à Vista e Análise de
// Vendas buscam os pedidos AO VIVO no Bling, pela edge `bling-proxy` — e essa
// edge foi lida linha a linha: ela confere PERMISSÃO (`sales`/`gestor`/admin) e
// devolve os pedidos de TODOS os canais. Não há filtro de canal nenhum lá.
//
// Ou seja: a vendedora limitada ao time via, nessas duas telas, o faturamento
// de todas as lojas. A trava do banco valia na Gestão Comercial e não valia
// aqui. É o que este módulo fecha.
//
// ✅ AGORA É TRANCA TAMBÉM (13/08/2026, item B1f). Até então isto era só o
// recorte da TELA, e estava escrito aqui com todas as letras que não bastava:
// o front é público, então quem souber usar o console continuava conseguindo
// pedir tudo ao `bling-proxy`. A partir de 13/08 a MESMA regra roda dentro da
// edge, sobre a resposta do Bling, antes de ela sair de lá.
//
// POR QUE ELE MUDOU DE `src/compartilhado/` PARA CÁ
// Dois lugares precisam desta MESMA regra: as duas telas de venda e a edge
// `bling-proxy`. A edge roda no Deno e NÃO alcança `src/`. Então a regra mora
// aqui, onde os dois chegam, e `src/compartilhado/canais-de-venda-permitidos.js`
// virou uma ponte que só reexporta — mesmo arranjo de `data-da-venda.js`, pelo
// mesmo motivo. Duas cópias da mesma regra é como duas telas decidindo o mesmo:
// mais cedo ou mais tarde discordam, e ninguém sabe qual está certa.
//
// PURO de propósito: quem decide o que aparece na tela de faturamento é a coisa
// mais cara de errar aqui, e precisa poder ser provada sem navegador.

import { normalizarGrupo } from './grupo-do-canal.js';

// `null` = vê TODOS os canais (é o estado dos 15 de 17 perfis de hoje).
// `[]`   = não vê canal nenhum — e isso é diferente de `null`, com todas as
//          letras: confundir os dois é o defeito que faz uma vendedora sem time
//          enxergar a empresa inteira.
export function canaisDoEscopo({ isSuperadmin, escopoPorEquipe, meuId, times, membros, canais, membrosDeGrupo }) {
  if (isSuperadmin) return null;
  // `!== true` e não `=== false`: coluna ausente na consulta não pode virar
  // "vê tudo" por omissão. O default do banco é o fechado, e o da tela também.
  if (escopoPorEquipe !== true) return null;
  if (!meuId) return [];

  // Os MEUS vínculos, com o papel em cada time. Antes isto era só um Set de
  // equipe_id: o papel era ignorado, e supervisora via o mesmo que vendedora.
  const meus = new Map();
  for (const m of membros || []) {
    if (String(m.profile_id) !== String(meuId)) continue;
    // Papel ausente é tratado como 'vendedora'. Se o select esquecer a coluna,
    // o certo é NÃO ampliar — falta de dado nunca pode dar acesso a mais.
    meus.set(String(m.equipe_id), String((m && m.papel) || 'vendedora'));
  }

  const grupoDoCanal = new Map();
  for (const c of canais || []) {
    if (c == null || c.loja_id === undefined || c.loja_id === null) continue;
    const g = normalizarGrupo(c.grupo);
    if (g !== null) grupoDoCanal.set(String(c.loja_id), g.toLocaleLowerCase('pt-BR'));
  }

  const ids = [];
  const gruposQueSupervisiono = new Set();
  for (const t of times || []) {
    const papel = meus.get(String(t.id));
    if (papel === undefined) continue;
    // Time sem canal do Bling não some nem vira "vê tudo": ele simplesmente não
    // acrescenta canal. Quem está só nele fica com `[]`, e a tela diz o motivo.
    if (t.canal_loja_id === null || t.canal_loja_id === undefined || t.canal_loja_id === '') continue;
    ids.push(Number(t.canal_loja_id));
    // ── O ALCANCE DA SUPERVISORA (20/08/2026) ─────────────────────────────
    // Decisão do dono: supervisora vê TODOS os canais do grupo dos times onde
    // ela supervisiona; gestor (a "gerente" da fala dele) e vendedora seguem
    // vendo só a loja delas. O grupo vem do canal (`bling_lojas.grupo`).
    if (papel === 'supervisora') {
      const g = grupoDoCanal.get(String(t.canal_loja_id));
      // Canal SEM grupo não amplia nada — e isso não pode virar "vê tudo".
      if (g) gruposQueSupervisiono.add(g);
    }
  }

  if (gruposQueSupervisiono.size) {
    for (const c of canais || []) {
      if (c == null || c.loja_id === undefined || c.loja_id === null) continue;
      const g = grupoDoCanal.get(String(c.loja_id));
      if (g && gruposQueSupervisiono.has(g)) ids.push(Number(c.loja_id));
    }
  }

  // ── A SUPERVISORA QUE MORA NO GRUPO (27/08/2026) ─────────────────────────
  //
  // O SEGUNDO caminho para o mesmo direito, e ele existe porque o banco JÁ o
  // reconhece. Desde 21/08 a função `public.meus_vinculos()` soma o vínculo
  // direto com o do grupo, e `public.pode_ver_canal` confere
  // `canais_grupos_membros` com as mesmas palavras que estão aqui embaixo.
  //
  // ⚠️ SEM ISTO AS DUAS PONTAS DISCORDARIAM: o banco liberaria a supervisora de
  // grupo e estas telas mostrariam zero, sem erro nenhum. É a mesma classe de
  // defeito que esta base já pagou caro — e é por isso que este pedaço vai ao ar
  // ANTES da tela que cadastra supervisora, e não depois.
  //
  // ⚠️ POR QUE ESTE CAMINHO CASA POR `grupo_id` E O DE CIMA POR TEXTO:
  // cada um espelha a SUA fonte. O de cima é o vínculo pelo TIME (20/08), que
  // lê `bling_lojas.grupo`; este espelha `pode_ver_canal`, que lê `grupo_id`.
  // Os dois concordam porque o gatilho `espelhar_grupo_do_canal` mantém texto e
  // apontamento iguais nos dois sentidos desde 27/08 — provado com a trava
  // armada em `docs/provar-espelho-do-grupo.sql`. Trocar o de cima para `id`
  // seria mexer num caminho de permissão que já está no ar para não ganhar nada.
  const meusGrupos = new Set();
  for (const gm of membrosDeGrupo || []) {
    if (!gm || String(gm.profile_id) !== String(meuId)) continue;
    // Só 'supervisora' amplia. Papel ausente NÃO amplia — falta de dado nunca
    // pode dar acesso a mais, a mesma regra do membro de time aqui em cima.
    if (String(gm.papel || '') !== 'supervisora') continue;
    if (gm.grupo_id === null || gm.grupo_id === undefined || gm.grupo_id === '') continue;
    meusGrupos.add(String(gm.grupo_id));
  }
  if (meusGrupos.size) {
    for (const c of canais || []) {
      if (c == null || c.loja_id === undefined || c.loja_id === null) continue;
      const gid = c.grupo_id;
      if (gid === null || gid === undefined || gid === '') continue;
      if (meusGrupos.has(String(gid))) ids.push(Number(c.loja_id));
    }
  }

  return [...new Set(ids)];
}

// Está limitada? Serve para a tela decidir se avisa, e se esconde o filtro de
// canal (filtro que oferece o que não se pode ver é promessa quebrada).
export function estaLimitada(canais) {
  return Array.isArray(canais);
}

// Os pedidos que ela pode ver. `null` devolve a lista INTACTA — é o caminho dos
// 15 perfis de hoje, e ele não pode nem reordenar nem copiar por engano.
export function filtrarPedidos(pedidos, canais) {
  if (!Array.isArray(canais)) return pedidos || [];
  const ok = new Set(canais.map(String));
  return (pedidos || []).filter((p) => ok.has(String(canalDoPedido(p))));
}

// O mapa `{loja_id: nome}` que as duas telas montam de `bling_lojas`, recortado.
// É ele que alimenta os seletores de canal — se ficasse inteiro, o filtro
// ofereceria lojas cujo faturamento a pessoa não pode ver.
export function filtrarMapaDeCanais(mapa, canais) {
  if (!Array.isArray(canais)) return mapa || {};
  const ok = new Set(canais.map(String));
  const out = {};
  for (const k of Object.keys(mapa || {})) if (ok.has(String(k))) out[k] = mapa[k];
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// O LADO DA EDGE (B1f, 13/08/2026): recortar a RESPOSTA DO BLING.
//
// Aqui a conta é diferente da da tela. A tela recebe os pedidos e decide o que
// desenhar; a edge decide o que sequer SAI do servidor. Por isso ela também
// precisa responder "e os caminhos que não são pedido?" — e a resposta certa,
// para quem está limitado a uma loja, é NÃO ENTREGAR o que não dá pra recortar.
//
// `nfe`/`nfce` são as notas fiscais de TODAS as lojas. Nenhuma tela chama esses
// caminhos (conferido em 13/08: só o robô `notas-dos-pedidos` chama, e ele entra
// com a conta de serviço, que não é limitada). Entregá-las a alguém limitado
// seria devolver pela porta dos fundos exatamente o faturamento que a porta da
// frente acabou de recortar.
//
// `produtos` e `estoques/saldos` não falam de canal nenhum: catálogo e saldo são
// os mesmos para todo mundo. Ficam liberados — recortar o que não é do recorte
// só quebraria a Gestão Comercial sem proteger nada.

// Caminhos que quem está limitado a uma loja NÃO recebe, porque não há como
// recortá-los por canal.
const CAMINHOS_NEGADOS_A_QUEM_E_LIMITADO = [/^nfe(\/|$)/, /^nfce(\/|$)/];

// O canal de um pedido do Bling. Fica numa função só porque este caminho
// (`pedido.loja.id`) é a única coisa que liga um pedido a uma loja, e ele é
// lido em três lugares — se um dia o Bling mudar o formato, muda aqui.
function canalDoPedido(pedido) {
  return pedido && pedido.loja ? pedido.loja.id : undefined;
}

// Recorta o que a edge vai devolver.
//
// `canais === null` (não está limitada) devolve o corpo INTACTO, pelo mesmo
// motivo do `filtrarPedidos`: é o caminho de quase todo mundo e dos robôs, e ele
// não pode nem reordenar nem copiar por engano.
//
// Devolve `{ corpo, negado }`. `negado` verdadeiro quer dizer "não entregue
// isto" — a edge responde 403, e não uma lista vazia: lista vazia mentiria
// dizendo que não há venda, quando o que há é falta de permissão.
export function recortarRespostaDoBling(endpoint, corpo, canais) {
  if (!Array.isArray(canais)) return { corpo, negado: false };

  const caminho = String(endpoint || '');
  if (CAMINHOS_NEGADOS_A_QUEM_E_LIMITADO.some((re) => re.test(caminho))) {
    return { corpo: null, negado: true };
  }

  // A LISTA de pedidos: recorta os que não são dos canais dela.
  if (caminho === 'pedidos/vendas') {
    if (!corpo || !Array.isArray(corpo.data)) return { corpo, negado: false };
    return { corpo: { ...corpo, data: filtrarPedidos(corpo.data, canais) }, negado: false };
  }

  // UM pedido pelo id: ou é de um canal dela, ou ela não recebe.
  if (/^pedidos\/vendas\/[A-Za-z0-9_-]+$/.test(caminho)) {
    if (!corpo || !corpo.data) return { corpo, negado: false };
    const ok = new Set(canais.map(String));
    if (!ok.has(String(canalDoPedido(corpo.data)))) return { corpo: null, negado: true };
    return { corpo, negado: false };
  }

  return { corpo, negado: false };
}

// A frase do recorte, para a tela não mentir por omissão: um total menor sem
// explicação parece dado errado, e é assim que nasce um chamado.
export function fraseDoRecorte(canais, mapa) {
  if (!Array.isArray(canais)) return '';
  if (!canais.length) {
    return 'Você não está em nenhum time com canal de venda ligado, então não há '
      + 'faturamento para mostrar. Peça para um administrador te colocar no time da sua loja.';
  }
  const nomes = canais.map((id) => (mapa || {})[id] || (mapa || {})[String(id)] || ('canal ' + id));
  return 'Mostrando só ' + (nomes.length === 1 ? 'o seu canal' : 'os seus canais') + ': ' + nomes.join(' · ') + '.';
}
