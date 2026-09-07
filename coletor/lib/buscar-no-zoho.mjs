// FALAR COM O ZOHO WORKDRIVE para buscar as fotos que faltam.
//
// ⚠️ SEGUNDA FONTE, NUNCA A PRIMEIRA (regra do dono, 07/09/2026). Quem chama
// isto e o robo das fotos, e SO depois de o Bling nao ter nenhuma.
//
// ⚠️ O TOKEN DO ZOHO E GUARDADO. Em 28/08/2026 pedir token novo a cada chamada
// (sete em poucos minutos) fez o Zoho barrar: "You have made too many requests
// continuously". Ele vale ~1h; aqui se pede UM por execucao e se reaproveita.
import { pastaDoSku, fotosDaPasta } from './fotos-do-zoho.mjs'

const API = 'https://www.zohoapis.com/workdrive/api/v1'
// A pasta "Fotos por SKU (coletor)", em 04. Vessel Brasil › 17. Marketing.
// O id vem por variavel para nao ficar cravado: se a pasta for recriada no
// Zoho, o id muda, e um id fixo apontaria calado para o lugar errado.
const PASTA_RAIZ = process.env.ZOHO_PASTA_FOTOS || '6kuqn469a1e0841ee49e0bd0d18cab60c9cd5'

let tokenGuardado = null
// ⚠️ A LISTA DE PASTAS E GUARDADA POR EXECUCAO. Sem isto, cada lote refazia
// TRES chamadas (raiz, marca, pasta do SKU) — com 66 lotes, ~200 chamadas ao
// Zoho numa rodada so. O Zoho ja barrou esta casa por excesso em 28/08/2026
// ("You have made too many requests continuously"), e o robo vai passar a rodar
// DE HORA EM HORA na nuvem. As pastas nao mudam no meio de uma rodada.
let pastasGuardadas = null

export async function tokenDoZoho(env = process.env, buscar = fetch) {
  if (tokenGuardado && tokenGuardado.ate > Date.now()) return tokenGuardado.valor
  // ⚠️ O `.env` guarda o DC como `com`, mas a URL precisa de `.com`. Sem
  // normalizar, o DNS falha em `accounts.zohocom` — ja mordeu esta casa.
  let dc = env.ZOHO_DC || 'com'
  if (!dc.startsWith('.')) dc = '.' + dc
  const r = await buscar(`https://accounts.zoho${dc}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: env.ZOHO_CLIENT_ID,
      client_secret: env.ZOHO_CLIENT_SECRET,
      refresh_token: env.ZOHO_REFRESH_TOKEN,
    }),
  })
  const j = await r.json().catch(() => null)
  if (!j?.access_token) {
    throw new Error('Não consegui entrar no Zoho para buscar as fotos. '
      + `Resposta: ${JSON.stringify(j).slice(0, 160)}`)
  }
  tokenGuardado = { valor: j.access_token, ate: Date.now() + 50 * 60 * 1000 }
  return tokenGuardado.valor
}

async function listar(token, id, buscar = fetch) {
  const r = await buscar(`${API}/files/${id}/files?` + new URLSearchParams({ 'page[limit]': '100' }),
    { headers: { Authorization: `Zoho-oauthtoken ${token}` } })
  const txt = await r.text()
  try {
    return (JSON.parse(txt).data || []).map((f) => ({
      id: f.id, nome: f.attributes?.name || '', ehPasta: !!f.attributes?.is_folder,
    }))
  } catch {
    throw new Error(`O Zoho respondeu algo que não é JSON (HTTP ${r.status}). `
      + `Começo: ${txt.slice(0, 120)}`)
  }
}

/**
 * As fotos daquele SKU, ja sem o desenho a mao e na ordem certa.
 * Devolve `[]` quando NAO HA pasta com aquele SKU — e nunca a pasta parecida.
 */
export async function fotosDoZohoParaSku(sku, { env = process.env, buscar = fetch, marca = /vessel brasil/i } = {}) {
  const token = await tokenDoZoho(env, buscar)

  if (!pastasGuardadas) {
    const raiz = await listar(token, PASTA_RAIZ, buscar)
    const daMarca = raiz.find((f) => f.ehPasta && marca.test(f.nome))
    if (!daMarca) return { fotos: [], porque: 'não achei a pasta da marca no Zoho' }
    pastasGuardadas = (await listar(token, daMarca.id, buscar)).filter((f) => f.ehPasta)
  }
  const pastas = pastasGuardadas
  const alvo = pastaDoSku(pastas, sku)
  if (!alvo) {
    return { fotos: [], porque: `nenhuma pasta do Zoho tem "${sku}" no nome. `
      + 'Renomeie a pasta lá incluindo o SKU e a próxima rodada pega.' }
  }

  const fotos = fotosDaPasta(await listar(token, alvo.id, buscar))
  return {
    fotos: fotos.map((f) => ({ nome: f.nome, url: `${API}/download/${f.id}` })),
    pasta: alvo.nome,
    porque: fotos.length ? null : `a pasta "${alvo.nome}" só tem o desenho, sem foto`,
    cabecalho: { Authorization: `Zoho-oauthtoken ${token}` },
  }
}

/** Esquece a lista guardada. Existe para o teste, e para quem rodar o robo por
 *  muito tempo: pasta criada no meio da rodada nao apareceria sozinha. */
export function esquecerAsPastas() { pastasGuardadas = null }
