/* O LABORATÓRIO DE FOTOS DA ABA "CARTÕES EAN".
 *
 * Abre o app rodando aqui na máquina e fotografa a aba nova no celular e no
 * computador. Nenhuma conta real é usada e nada é gravado: as respostas do
 * banco são trocadas por dados de exemplo antes de chegarem ao navegador, e
 * toda escrita é recusada e anotada no fim.
 *
 * A tela é a do app, sem alteração nenhuma. O que muda é só o que o banco
 * responde, e só dentro deste navegador.
 *
 * ⚠️ O QUE **NÃO** É TROCADO: a prévia do cartão. Ela vem do site de verdade,
 * como na tela do dono — é isso que a prova precisa mostrar, e trocá-la faria a
 * foto mentir sobre a única coisa que a aba tem de garantir.
 *
 * Rodar:  node src/ferramentas/autenticidade/fotografar-cartoes-ean.mjs
 * (com `npm run dev -- --port 5241 --strictPort` ligado noutra janela)
 */
import { chromium } from '/Users/erickmartins/.claude/jobs/74a3c410/tmp/lab/node_modules/playwright-core/index.mjs'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const AQUI = dirname(fileURLToPath(import.meta.url))
const FOTOS = process.env.FOTOS_EM || '/private/tmp/claude-501/-Users-erickmartins/30715ad4-66c3-4b2c-adc2-ee2082c59618/scratchpad/fotos-cartoes'
mkdirSync(FOTOS, { recursive: true })

const APP = process.env.APP || 'http://localhost:5241'
const REF = 'kounqtdoioootxqegkij'
const CELULAR = { width: 375, height: 812 }
const COMPUTADOR = { width: 1440, height: 900 }

const USUARIO_ID = '00000000-0000-4000-8000-00000000ab01'
const EMAIL = 'laboratorio@exemplo.invalido'
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const CRACHA = [
  b64({ alg: 'HS256', typ: 'JWT' }),
  b64({ sub: USUARIO_ID, role: 'authenticated', exp: 4102444800, email: EMAIL }),
  'assinatura-de-mentira',
].join('.')
const USUARIO = {
  id: USUARIO_ID, aud: 'authenticated', role: 'authenticated', email: EMAIL,
  email_confirmed_at: '2026-01-01T00:00:00Z', phone: '',
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: { name: 'Laboratório' },
  identities: [], created_at: '2026-01-01T00:00:00Z', updated_at: '2026-09-11T09:00:00Z',
}
const SESSAO = {
  access_token: CRACHA, token_type: 'bearer', expires_in: 31536000,
  expires_at: 4102444800, refresh_token: 'renovacao-de-mentira', user: USUARIO,
}
// ⚠️ `features[]` E `permissions{}` juntos: sem os dois o Início diz "sem acesso"
// e a foto sai da tela errada.
const PERFIL = [{
  id: USUARIO_ID, email: EMAIL, nome: 'Laboratório', is_superadmin: true,
  features: ['autenticidade'], permissions: { autenticidade: ['ver', 'criar', 'editar'] },
}]

/* ── O cenário ────────────────────────────────────────────────────────────
 * Dois produtos que existem de verdade no índice publicado (para a prévia
 * desenhar), e um terceiro sem foto — porque a linha que NÃO pode gerar é
 * justamente a que a foto precisa mostrar. */
const LOTES = [
  { id: 'l1', modelo: 'ClutchBag Maelle Medium', cor: 'Bege', sku: 'SS0001CB.M1',
    quantidade: 4, fabricado_em: '2026-09-02', criado_em: '2026-09-02T12:00:00Z', os: '1042' },
  { id: 'l2', modelo: 'HandBag Linear Small', cor: 'Branca', sku: 'SS0001HB.S3',
    quantidade: 2, fabricado_em: '2026-09-04', criado_em: '2026-09-04T12:00:00Z', os: '1051' },
  { id: 'l3', modelo: 'Bolsa nova sem foto', cor: 'Preta', sku: 'ZZ9999XX.T9',
    quantidade: 1, fabricado_em: '2026-09-10', criado_em: '2026-09-10T12:00:00Z', os: null },
]
const PECAS = [
  { codigo: 'K7M4X001QP', lote_id: 'l1', numero_na_serie: 1, gravada_em: '2026-09-03T10:00:00Z', cartao_gerado_em: '2026-09-07T03:00:00Z' },
  { codigo: 'VKQF697U7N', lote_id: 'l1', numero_na_serie: 2, gravada_em: null, cartao_gerado_em: '2026-09-07T03:00:00Z' },
  { codigo: 'B2NR84WQZ1', lote_id: 'l1', numero_na_serie: 3, gravada_em: null, cartao_gerado_em: null },
  { codigo: 'TQ9L3MVH07', lote_id: 'l1', numero_na_serie: 4, gravada_em: null, cartao_gerado_em: null },
  { codigo: '89M46GXVG5', lote_id: 'l2', numero_na_serie: 1, gravada_em: '2026-09-05T09:00:00Z', cartao_gerado_em: null },
  { codigo: 'P4XC22DKR8', lote_id: 'l2', numero_na_serie: 2, gravada_em: null, cartao_gerado_em: null },
  { codigo: 'ZZ00TESTE1', lote_id: 'l3', numero_na_serie: 1, gravada_em: null, cartao_gerado_em: null },
]
const PEDIDOS = [
  { id: 'q1', pecas: ['B2NR84WQZ1', 'TQ9L3MVH07'], situacao: 'rodando',
    pasta: null, erro: null, criado_em: '2026-09-11T17:50:00Z', comecou_em: '2026-09-11T17:50:12Z', terminou_em: null },
]
const TABELAS = {
  vessel_lotes: LOTES,
  vessel_pecas: PECAS,
  vessel_registros: [],
  vessel_baixas: [],
  vessel_cartao_pedidos: PEDIDOS,
  profiles: PERFIL,
}

function responder(caminho, busca) {
  if (caminho.startsWith('/rest/v1/rpc/')) {
    const fn = caminho.slice('/rest/v1/rpc/'.length)
    if (fn === 'vessel_alertas') return { leituras: 0, repetidos: [], invalidos: [], baixadas_lidas: [] }
    if (fn === 'vessel_fila_de_registros') return { pedidos: [] }
    return []
  }
  const tabela = caminho.replace('/rest/v1/', '').split('?')[0]
  if (tabela === 'profiles') return PERFIL
  return TABELAS[tabela] || []
}

const escritasBloqueadas = []
const navegador = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--force-color-profile=srgb', '--font-render-hinting=none'],
})

async function abrirContexto(viewport, celular) {
  const contexto = await navegador.newContext({
    viewport, deviceScaleFactor: celular ? 3 : 2, isMobile: celular, hasTouch: celular,
    locale: 'pt-BR', timezoneId: 'America/Sao_Paulo',
  })
  // A TRAVA: nada sai daqui para o banco de verdade.
  // ⚠️ REGEX, NÃO GLOB — o glob `**host/**` não pega, e as chamadas vazam para a
  // produção com 401.
  await contexto.route(/supabase\.co\//, async (rota) => {
    const req = rota.request()
    const url = new URL(req.url())
    const metodo = req.method()
    if (url.pathname.startsWith('/auth/v1/')) {
      const corpo = url.pathname.includes('/user') ? USUARIO : SESSAO
      return rota.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(corpo) })
    }
    // HEAD é LEITURA: o PostgREST conta linhas com ele. Bloquear HEAD junto com
    // POST forja erro na tela.
    if (metodo !== 'GET' && metodo !== 'HEAD' && !url.pathname.startsWith('/rest/v1/rpc/')) {
      escritasBloqueadas.push(`${metodo} ${url.pathname}`)
      return rota.fulfill({ status: 403, contentType: 'application/json',
        body: JSON.stringify({ message: 'escrita bloqueada pelo laboratorio de fotos' }) })
    }
    const linhas = responder(url.pathname, url.search)
    const n = Array.isArray(linhas) ? linhas.length : 1
    return rota.fulfill({ status: 200, contentType: 'application/json',
      headers: { 'content-range': `0-${Math.max(n - 1, 0)}/${n}` },
      body: JSON.stringify(linhas) })
  })
  await contexto.addInitScript(({ ref, sessao }) => {
    const guardar = (c, v) => { try { localStorage.setItem(c, v) } catch (e) { /* modo privado */ } }
    guardar(`sb-${ref}-auth-token`, JSON.stringify(sessao))
    // ⚠️ O GUIA DA BANCADA ABRE SOZINHO NA PRIMEIRA VISITA e tapa a tela inteira
    // — um modal que engole até o clique na aba. A chave é a de `tutorial.js`
    // (`CHAVE_DO_GUIA`), com o valor 'sim': chutar o nome deixa o modal de pé e
    // a foto sai do guia, não da aba.
    guardar('autenticidade-guia-visto', 'sim')
    // ⚠️ E O CONVITE DAS NOTIFICAÇÕES TAPA A TELA INTEIRA. Ele nasce por cima de
    // tudo (`np-modal-fundo`, z-index 10001) e engole até o clique na aba — a
    // primeira rodada deste laboratório morreu esperando um botão que estava
    // debaixo dele. A chave é a de `moldura-do-aplicativo.vue`.
    guardar('push-dispensado-v1', '1')
  }, { ref: REF, sessao: SESSAO })
  return contexto
}

async function fotografar(contexto, prefixo) {
  const pagina = await contexto.newPage()
  const erros = []
  pagina.on('console', (m) => { if (m.type() === 'error') erros.push(m.text().slice(0, 180)) })

  await pagina.goto(`${APP}/autenticidade`, { waitUntil: 'networkidle' })
  await pagina.waitForTimeout(1200)
  await pagina.getByRole('tab', { name: /Cart[õo]es EAN/i }).click()
  // O índice vem do site de verdade: dar tempo de chegar.
  await pagina.waitForTimeout(2500)
  await pagina.screenshot({ path: join(FOTOS, `${prefixo}-1-lista.png`), fullPage: true })

  // A prévia: é o que a aba promete, e é o que a foto tem de provar.
  const verOCartao = pagina.getByRole('button', { name: 'Ver o cartão' }).first()
  let previaDesenhou = null
  if (await verOCartao.count()) {
    // ⚠️ ESCUTA O RECADO DA PRÉVIA, e não só o tamanho do quadro. Um iframe que
    // não desenhou nada continua medindo 420 × 533: olhar a caixa diria "está
    // lá" com o cartão em branco dentro. Quem sabe se desenhou é a própria
    // página, que manda 'pronto' ou 'falhou' por postMessage.
    await pagina.evaluate(() => {
      window.__previa = null
      addEventListener('message', (e) => { if (e.data?.previaDoCartao) window.__previa = e.data })
    })
    await verOCartao.click()
    await pagina.waitForFunction(() => window.__previa, null, { timeout: 30000 }).catch(() => {})
    previaDesenhou = await pagina.evaluate(() => window.__previa)
    await pagina.waitForTimeout(1500)
    await pagina.screenshot({ path: join(FOTOS, `${prefixo}-2-previa.png`), fullPage: true })
    // E um recorte SÓ do quadro: a foto de página inteira não é confiável para
    // iframe de outro endereço, e um branco ali seria lido como defeito.
    const quadro = pagina.locator('.au-previa-cartao')
    if (await quadro.count()) {
      await quadro.scrollIntoViewIfNeeded()
      await pagina.waitForTimeout(400)
      await quadro.screenshot({ path: join(FOTOS, `${prefixo}-3-previa-recorte.png`) })
    }
  }

  // ⚠️ MEDIR, E NÃO OLHAR A FOTO. Texto cortado e coluna estourando não se
  // julgam no olho: `scrollWidth > clientWidth` é o que diz.
  const medida = await pagina.evaluate(() => {
    const estoura = [...document.querySelectorAll('.tela-autenticidade *')]
      .filter((el) => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX === 'visible')
      .slice(0, 6)
      .map((el) => `${el.className || el.tagName}: ${el.scrollWidth}>${el.clientWidth}`)
    const previa = document.querySelector('.au-previa-folha')
    const marcas = document.querySelectorAll('.au-marca-cartao input')
    const alvoPequeno = [...marcas]
      .map((i) => i.closest('label').getBoundingClientRect().height)
      .filter((h) => h < 40)
    return {
      larguraDaPagina: document.documentElement.scrollWidth,
      larguraDaJanela: document.documentElement.clientWidth,
      estoura,
      previaVisivel: previa ? previa.getBoundingClientRect().width > 0 : false,
      previaLargura: previa ? Math.round(previa.getBoundingClientRect().width) : null,
      previaAltura: previa ? Math.round(previa.getBoundingClientRect().height) : null,
      // ⚠️ O TAMANHO NATURAL DO CARTÃO, medido por dentro. O quadro pode ser
      // maior que ele e sobrar branco à direita — que na tela parece cartão
      // cortado, e não moldura folgada.
      cartaoNatural: (() => {
        try {
          const d = previa?.contentDocument?.getElementById('folha')?.contentDocument;
          if (!d) return null;
          const f = d.querySelector('.cartao.frente')?.getBoundingClientRect();
          return { largura: Math.round(f.width), altura: Math.round(d.body.scrollHeight) };
        } catch { return 'outro endereço'; }
      })(),
      pecasNaLista: document.querySelectorAll('.au-tabela-cartoes .au-card').length,
      marcadas: [...marcas].filter((i) => i.checked).length,
      desabilitadas: [...marcas].filter((i) => i.disabled).length,
      alvosPequenos: alvoPequeno.length,
      botao: document.querySelector('.au-pedir-cartoes .au-botao')?.textContent.trim() || null,
    }
  })
  console.log(`\n── ${prefixo} ──`)
  console.log(JSON.stringify({ ...medida, previaDesenhou }, null, 1))
  if (erros.length) { console.log('  erros de console:'); for (const e of [...new Set(erros)]) console.log('   · ' + e) }
  await pagina.close()
  return { ...medida, previaDesenhou }
}

const noCelular = await fotografar(await abrirContexto(CELULAR, true), 'celular-375')
const noComputador = await fotografar(await abrirContexto(COMPUTADOR, false), 'computador-1440')
await navegador.close()

console.log('\n── escritas que tentaram sair para a produção ──')
console.log(escritasBloqueadas.length ? escritasBloqueadas.join('\n') : '  nenhuma');
console.log('\nfotos em ' + FOTOS)

const ok = noCelular.larguraDaPagina <= noCelular.larguraDaJanela
  && noCelular.estoura.length === 0 && noComputador.estoura.length === 0
  && noCelular.previaDesenhou?.previaDoCartao === 'pronto'
  && noComputador.previaDesenhou?.previaDoCartao === 'pronto'
  && noCelular.alvosPequenos === 0 && noComputador.alvosPequenos === 0
  && escritasBloqueadas.length === 0
console.log('\n' + (ok ? '✓ a aba cabe nas duas telas, a prévia desenha, e nada saiu para a produção'
  : '✗ ver as medidas acima'))
process.exit(ok ? 0 : 1)
