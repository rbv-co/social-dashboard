// O CONTATO DA LISTA DE ESPERA NO BLING (plano 07 da INTEGRACAO-CORE-2026-10).
//
// Até 20/10/2026 só a edge `vessel-espelhar-lista` (Supabase congelado) criava o contato e gravava `bling_id`/`bling_em`; nenhum
// código vivo escrevia isso. A regra do corpo e da marca de origem é a MESMA da edge (index.ts:362-396), copiada aqui sem mudar,
// com um prefixo a mais (`PP` para o pop-up da loja). Tudo passa pelo PROXY do Core (dono do token e da cota do Bling).
//
// Diferenças deliberadas em relação à edge: (1) antes de criar, procura o contato pelo e-mail e reaproveita o que existir
// (cliente que já comprou, ou linha da pré-venda que voltou a `bling_em = null`), em vez de duplicar; (2) devolve o tipo do
// resultado (`tenta` | `incerto` | `definitivo` | pausa) para o robô decidir sem ler texto.
import { chaveIdempotente } from '../../supabase/functions/_shared/core-bling-proxy.js';
import { celularParaOBling } from '../../supabase/functions/_shared/celular-do-bling.js';

export const TIPOS_DO_CADASTRO = [{ id: 14584907560 }]; // "Lead" (o tipo que o dono criou em 23/09/2026)
export const PREFIXO_POR_ORIGEM = { 'pre-venda': 'PV', 'lp-vesselbrasil': 'LP', 'popup-loja': 'PP' };
const PREFIXO_PADRAO = 'LP'; // origem desconhecida cai na etiqueta antiga, nunca num código que ninguém sabe ler

/** A marca de origem no único campo livre do contato do Bling (`codigo`): `LP-AAAAMMDD-xxxxxx`. */
export function codigoDeOrigem(linha) {
  const dia = new Date(linha.criado_em).toISOString().slice(0, 10).replace(/-/g, '');
  const curto = String(linha.id).replace(/[^A-Za-z0-9]/g, '').slice(-6).toUpperCase();
  const pre = PREFIXO_POR_ORIGEM[String(linha.origem || '').trim()] || PREFIXO_PADRAO;
  return `${pre}-${dia}-${curto}`;
}

export function corpoDoContato(linha) {
  return {
    nome: linha.nome,
    tipo: 'F', // pessoa física: obrigatório (sem ele todo cadastro volta 400)
    situacao: 'A', // ativo: idem
    email: linha.email,
    celular: celularParaOBling(linha.whatsapp), // normalizado: `+55...` cru volta 400 e a linha ficaria presa
    codigo: codigoDeOrigem(linha),
    tiposContato: TIPOS_DO_CADASTRO,
  };
}

/** O motivo que vai para `ultimo_erro` não pode levar dado pessoal (o Bling às vezes repete o e-mail/telefone na recusa). */
export function semDadoPessoal(txt) {
  return String(txt ?? '').replace(/[^\s@"']+@[^\s@"']+/g, '[e-mail]').replace(/\d[\d\s().+-]{6,}\d/g, '[número]').slice(0, 160);
}

const minusculo = (s) => String(s ?? '').trim().toLowerCase();

async function json(r) {
  try { return await r.json(); } catch { return null; }
}

/** Contato que já existe no Bling com este e-mail, conferido pelo detalhe (a lista não traz o e-mail). Devolve
 *  `{ id }`, `{ nenhum: true }`, `{ pausa }` ou `{ erro, tipo }`. */
// Chamada ao Bling pelo proxy do Core. Não é rota da API da Central: por isso a chamada não tem a forma literal método+caminho que o
// extrator do contrato do front (extrair-contrato-front.mjs) leria como "caminho direto da API" e cobraria rota na API.
const bling = (proxy, metodo, caminho, o) => proxy.chamar(metodo, caminho, o);

async function acharPorEmail(proxy, email) {
  const busca = await bling(proxy, 'GET', '/contatos', { query: { pesquisa: email }, prioridade: 'sync' });
  if (busca.reautorizar) return { pausa: 'reautorizar' };
  if (busca.status === 429) return { pausa: '429' };
  if (busca.status === 503) return { pausa: 'bling_instavel' };
  if (!busca.ok) return { erro: `busca no Bling falhou (${busca.status || 'sem resposta'})`, tipo: 'tenta' };
  const candidatos = ((await json(busca))?.data ?? []).slice(0, 5);
  for (const c of candidatos) {
    const det = await bling(proxy, 'GET', `/contatos/${c.id}`, { prioridade: 'sync' });
    if (det.reautorizar) return { pausa: 'reautorizar' };
    if (det.status === 429) return { pausa: '429' };
    if (det.status === 503) return { pausa: 'bling_instavel' };
    if (!det.ok) return { erro: `detalhe do contato no Bling falhou (${det.status || 'sem resposta'})`, tipo: 'tenta' };
    if (minusculo((await json(det))?.data?.email) === minusculo(email)) return { id: String(c.id) };
  }
  return { nenhum: true };
}

/**
 * Leva UMA linha da lista ao Bling. Devolve:
 *   { id, reaproveitado }                 deu certo (grave `bling_id`/`bling_em`)
 *   { pausa: '429' | 'bling_instavel' | 'reautorizar' }      pare o lote, sem gravar nada na linha (o Bling pede calma / nova autorização)
 *   { erro, tipo: 'tenta' }               falha temporária: tenta de novo na próxima rodada (conta tentativa)
 *   { erro, tipo: 'incerto' }             a chamada pode ter chegado: NÃO reenvia (conferir no Bling)
 *   { erro, tipo: 'definitivo' }          o Bling recusou o corpo: repetir não adianta
 */
export async function contatoDaLinha(proxy, linha) {
  const achado = await acharPorEmail(proxy, linha.email);
  if (achado.id) return { id: achado.id, reaproveitado: true };
  if (achado.pausa || achado.erro) return achado;

  const corpo = corpoDoContato(linha);
  // Chave ESTÁVEL (linha + operação + hash do corpo): a mesma tentativa nunca duplica no Core, mesmo de duas instâncias.
  const chave = await chaveIdempotente(`vessel-lista:${linha.id}`, 'contato-criar', corpo);
  const r = await bling(proxy, 'POST', '/contatos', { corpo, chave, prioridade: 'sync' });
  if (r.reautorizar) return { pausa: 'reautorizar' };
  if (r.incerto) return { erro: `incerto: não deu para saber se o Bling gravou (chave ${chave}); conferir o contato no Bling`, tipo: 'incerto' };
  if (r.status === 429) return { pausa: '429' };
  if (r.status === 503) return { pausa: 'bling_instavel' }; // disjuntor do Core aberto (X-Core-Origem: proxy): sem martelar, sem gastar tentativa
  if (r.status === 409) return { erro: 'outra chamada com a mesma chave está em andamento', tipo: 'tenta' };
  if (r.status === 0 || r.status >= 500) return { erro: `Bling indisponível (${r.status || 'sem resposta'})`, tipo: 'tenta' };
  if (!r.ok) return { erro: `o Bling recusou o cadastro (${r.status}): ${semDadoPessoal(await r.text().catch(() => ''))}`, tipo: 'definitivo' };
  const id = (await json(r))?.data?.id;
  if (!id) return { erro: `incerto: o Bling aceitou mas não disse o número do contato (chave ${chave}); conferir no Bling`, tipo: 'incerto' };
  return { id: String(id), reaproveitado: false };
}
