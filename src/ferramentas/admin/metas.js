// METAS DE VENDAS: a parte que decide, sem banco e sem tela.
//
// PEDIDO DO DONO (29/09/2026): a planilha (baixar template, preencher, importar)
// "tá ruim". A tela passa a listar as lojas e as vendedoras do banco, cada uma
// com o campo de quanto de meta. Este arquivo é o que a tela usa para ler o que
// foi digitado, saber o que mudou e não deixar meta diária velha mentir.
//
// PURO: os testes provam cada decisão sem navegador.
import { parsearValor } from '../patrimonio/patrimonio.js'
import { lojaDaVendedora } from './vendedoras.js'

// O que foi digitado, em reais.
//   ''            -> null  (campo vazio: sem meta)
//   'R$ 74.151,13'-> 74151.13
//   'abc'         -> NaN   (a tela recusa e diz qual campo)
export function valorDoCampo(texto) {
  if (texto === null || texto === undefined || String(texto).trim() === '') return null
  const centavos = parsearValor(texto)
  return centavos === null ? NaN : centavos / 100
}

// Meta por dia = meta do mês ÷ dias do mês (a regra que a tela sempre mostrou).
export function metaPorDia(total, ano, mes) {
  const dias = new Date(ano, mes, 0).getDate()
  return (Number(total) || 0) / dias
}

// O QUE MUDOU. `atuais` é { id: valor gravado }, `digitados` é { id: texto }.
// Só entra na lista o que mudou de verdade: gravar tudo a cada clique
// reescreveria a meta de quem ninguém tocou. Vazio onde havia meta = apagar.
// Texto inválido não entra em `gravar`: vai em `invalidos`, para a tela apontar.
export function mudancas(atuais, digitados) {
  const gravar = []
  const apagar = []
  const invalidos = []
  for (const [id, texto] of Object.entries(digitados || {})) {
    const novo = valorDoCampo(texto)
    const antigo = atuais && atuais[id] != null ? Number(atuais[id]) : null
    if (Number.isNaN(novo)) { invalidos.push(id); continue }
    if (novo === null || novo === 0) {
      if (antigo) apagar.push(id)
      continue
    }
    if (novo !== antigo) gravar.push({ id, valor: novo })
  }
  return { gravar, apagar, invalidos }
}

// META DIÁRIA GRAVADA NÃO PODE FICAR VELHA.
//
// As dashboards (Gestão à Vista, Análise de Vendas, os robôs) preferem a meta
// de cada dia (`daily_goals`) à do mês. Se o dono muda o mês de 60 mil para 80
// mil e os dias antigos ficam lá, as telas seguem somando 60 mil e o número novo
// nunca aparece. Então, ao mudar o total, os dias já gravados são reescalados na
// mesma proporção — a forma do mês (sábado forte, segunda fraca) é preservada.
// Sem dias gravados, devolve null e as dashboards dividem o mês por igual.
export function reescalarDiarias(diarias, novoTotal) {
  if (!diarias || typeof diarias !== 'object') return null
  const soma = Object.values(diarias).reduce((s, v) => s + (Number(v) || 0), 0)
  if (!(soma > 0) || !(novoTotal > 0)) return null
  const fator = novoTotal / soma
  const saida = {}
  for (const [dia, v] of Object.entries(diarias)) {
    const n = Number(v) || 0
    if (n > 0) saida[dia] = Math.round(n * fator * 100) / 100
  }
  return saida
}

// Duas vendedoras com o mesmo nome (o cadastro do Bling tem) precisam de algo
// que as separe na tela — senão o dono põe a meta na errada sem perceber.
export function rotuloDeVendedora(v, todas) {
  const repetido = todas.filter((o) => o.nome === v.nome).length > 1
  return repetido ? `${v.nome} (cód. ${v.vendor_id})` : v.nome
}

// LOJA E SUAS VENDEDORAS, JUNTAS (pedido do dono, 29/09/2026).
//
// O cadastro não guarda de qual loja é cada vendedora; a loja vem das vendas
// (`lojaDaVendedora`: onde ela mais vendeu, a mesma regra da tela de Times).
// Quem não tem venda com loja registrada, ou vendeu numa loja que não está na
// lista, vai para `sem` — nunca some e nunca é jogada numa loja no chute.
// `lojas` e `vendedoras` são [{ id, nome }]; `pedidos` são [{ vendor_id, loja_id }].
export function agruparPorLoja(lojas, vendedoras, pedidos) {
  const porVendedora = {}
  for (const p of pedidos || []) (porVendedora[p.vendor_id] = porVendedora[p.vendor_id] || []).push(p)
  const grupos = (lojas || []).map((loja) => ({ loja, vendedoras: [] }))
  const sem = []
  for (const v of vendedoras || []) {
    const { loja_id } = lojaDaVendedora(porVendedora[v.id] || [])
    const g = loja_id != null && grupos.find((x) => String(x.loja.id) === String(loja_id))
    if (g) g.vendedoras.push(v)
    else sem.push(v)
  }
  return { grupos, sem }
}
