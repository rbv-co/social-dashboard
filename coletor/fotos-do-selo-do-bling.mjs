#!/usr/bin/env node
// coletor/fotos-do-selo-do-bling.mjs
//
// O ROBO QUE ENCHE O CERTIFICADO. Para cada lote do selo que tem SKU e esta
// SEM FOTO OU SEM COR, procura o produto no Bling, copia as imagens grandes
// para o site e atualiza o lote. A bolsa que ja esta com a cliente passa a
// mostrar a foto na proxima vez que ela encostar o celular — sem regravar
// etiqueta nenhuma, porque a tag guarda so o endereco.
//
//   node coletor/fotos-do-selo-do-bling.mjs           # roda e publica
//   node coletor/fotos-do-selo-do-bling.mjs --dry     # so diz o que faria
//   node coletor/fotos-do-selo-do-bling.mjs --sem-push  # baixa e grava, nao publica
//
// ── AS FOTOS NAO VAO PARA O SUPABASE, E ISSO E DELIBERADO ──────────────────
//
// O dono levantou o medo de estourar o armazenamento. Medido em 03/09/2026: o
// projeto esta no plano FREE — 1 GB — com 0,56 GB usados (56%), ~440 MB
// sobrando. As fotos do selo nunca moraram la: elas ficam no REPOSITORIO DO
// SITE, servidas pela Vercel, que nao cobra por arquivo estatico. Este robo
// mantem essa escolha. Custo no 1 GB do Supabase: ZERO.
//
// E as fotos entram OTIMIZADAS: o `sips` (nativo do Mac, sem instalar nada)
// reduz para 1400px de largura. Medido: uma foto do Bling tem ~326 KB em media
// e sai daqui com ~60 KB, do tamanho das que ja estao no site.
//
// ── POR QUE COPIAR, E NAO APONTAR ─────────────────────────────────────────
//
// ⚠️ AS URLS DO BLING SAO ASSINADAS E EXPIRAM. O proprio Bling manda a
// `validade`, e na medicao ela era de SETE DIAS. Apontar o certificado direto
// para o Bling deixaria a bolsa da cliente com um quadrado quebrado uma semana
// depois da compra. Copiar nao e escolha de arquitetura — e a unica forma de a
// foto continuar la.
//
// ⚠️ E A IMAGEM GRANDE SO VEM NO DETALHE DO PRODUTO. A lista devolve
// `imagemURL`, que e MINIATURA DE 70x70 PIXELS. O robo antigo
// (`baixar-fotos-bling.mjs`) pega essa primeiro — por isso ele nao serve aqui.
import './lib/carregar-env.mjs'
import pg from 'pg'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync, existsSync, rmSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { reduzir } from './lib/reduzir-imagem.mjs'
import { pastaDoSku, fotosDaPasta } from './lib/fotos-do-zoho.mjs'
import { fotosDoZohoParaSku } from './lib/buscar-no-zoho.mjs'
import {
  lotesParaOlhar, pastaDoLote, enderecoDaFoto, imagensGrandesDoProduto,
  corDoProduto, produtoQueBate, loteEstaFaltando, pastasDisputadas, achatar,
} from './lib/fotos-do-selo.mjs'

const aqui = dirname(fileURLToPath(import.meta.url))

// ⚠️ O SITE MORA NO CHECKOUT PRINCIPAL, e nao "uma pasta acima deste arquivo".
// `vessel-brasil` e um repositorio SEPARADO que fica dentro do iamundi, e nao
// e versionado por ele — entao um worktree do iamundi nao tem copia dele.
// A primeira versao usava `resolve(aqui, '..')` e, rodando de um worktree, o
// robo CRIOU uma pasta `vessel-brasil/fotos/selo/` vazia la dentro e baixou as
// fotos para um lugar que nenhum site publica. Nao deu erro nenhum: baixou,
// reduziu, gravou no banco e o certificado apontaria para o vazio.
// `--git-common-dir` devolve o `.git` do checkout PRINCIPAL mesmo de dentro de
// um worktree; a pasta acima dele e a raiz de verdade.
function raizDoIamundi() {
  try {
    const git = execFileSync('/usr/bin/git', ['-C', aqui, 'rev-parse',
      '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim()
    return dirname(git)
  } catch {
    return resolve(aqui, '..')
  }
}
const SITE = join(raizDoIamundi(), 'vessel-brasil')
const PASTA_DAS_FOTOS = join(SITE, 'fotos', 'selo')
const BLING = 'https://api.bling.com.br/Api/v3'
const DRY = process.argv.includes('--dry')
const SEM_PUSH = process.argv.includes('--sem-push')
// ⚠️ `--refazer` REBAIXA A FOTO DE QUEM JA TEM. Serve para quando a ORDEM DAS
// FONTES muda: sem ele, quem ja tem foto fica com a da fonte antiga para
// sempre, porque "ja tem foto" e a condicao de ser ignorado.
const REFAZER = process.argv.includes('--refazer')
// ⚠️ `--sku=SS0008HB.M4` MEXE EM UMA BOLSA SO. Regra do dono, 08/09/2026: "as
// vezes a maior parte ja ta ok, uma ou outra que aconteceu isso de mostrar uma
// foto errada ou duplicada". Refazer as 104 para consertar duas troca o defeito
// conhecido por 102 riscos novos — e foi assim que 20 enderecos do banco
// passaram a apontar para foto que nao estava publicada.
const SO_ESTE_SKU = (process.argv.find((a) => a.startsWith('--sku=')) || '').slice(6).trim()
// ⚠️ UM CRITERIO SO, PORQUE SAO DOIS FILTROS. Um escolhe os lotes, o outro
// decide baixar a foto. Com `--sku` em apenas um deles, o robo dizia o nome da
// bolsa e nao fazia nada — sem erro. Foi exatamente o que aconteceu em
// 08/09/2026, no primeiro uso, e o teste nao pegou porque olhava so o primeiro.
const REBAIXAR = REFAZER || Boolean(SO_ESTE_SKU)
// ⚠️ 900 PIXELS PORQUE E O QUE JA ESTA NO SITE, nao porque eu escolhi um numero
// bonito. Medido: as seis pastas que ja existem tem fotos de 900x900 com 36-52
// KB. A minha primeira versao usava 1400, e as fotos sairam com 196 KB — quatro
// vezes o peso das vizinhas, na mesma galeria, no celular de uma cliente que
// pode estar num sinal ruim. Foto do robo tem de ser indistinguivel da foto que
// o dono sobe a mao.
const LARGURA_MAXIMA = 900
// ⚠️ ERAM 4, E ERA PALPITE MEU — nao medida. O comentario antigo dizia "o
// certificado mostra uma galeria, nao um album", e a conta parava ai. So que as
// pastas TRATADAS do Zoho tem 8 ou 9 fotos (frente, costas, lado, lateralizada,
// alca, interno e dois ou tres detalhes): o limite jogava fora metade do
// material pronto.
//
// O dono mandou trazer todas (07/09/2026). O custo e pequeno: cada foto sai com
// ~30 KB, entao 9 fotos sao ~270 KB — menos que UMA foto de rede social.
//
// O teto de 12 nao contradiz "todas": ele existe para o caso de uma pasta vir
// com lixo dentro (um arquivo solto, uma exportacao esquecida). Nenhuma pasta
// medida chega perto disso; se um dia chegar, e mais provavel ser engano do que
// bolsa com 13 angulos.
const MAXIMO_DE_FOTOS = 12

const espera = (ms) => new Promise((r) => setTimeout(r, ms))

async function pedirAoBling(caminho, token) {
  // O Bling responde 429 com facilidade. Esperar e tentar de novo e mais
  // barato do que perder a rodada inteira e voltar so amanha.
  for (let tentativa = 0; tentativa < 4; tentativa++) {
    const r = await fetch(`${BLING}/${caminho}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    })
    if (r.status === 429) { await espera(1500 * (tentativa + 1)); continue }
    if (!r.ok) return null
    return r.json().catch(() => null)
  }
  return null
}

// ⚠️ UMA CONEXAO CAIDA NAO PODE MATAR A RODADA INTEIRA. Em 08/09/2026 o `fetch`
// cru estourou `ECONNRESET` baixando uma foto e DERRUBOU O PROCESSO no lote 76
// de 104. O estrago nao foi perder 28 lotes: foi que a publicacao do site vem
// DEPOIS do laco, entao os 71 lotes ja gravados no banco passaram a apontar para
// fotos que nao estavam no ar — quadrado quebrado no certificado da cliente.
// Devolve o Buffer da foto, ou `{ erro }` para o robo contar e seguir.
async function baixarFoto(url, cabecalho) {
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    try {
      const r = await fetch(url, cabecalho ? { headers: cabecalho } : undefined)
      if (r.ok) return Buffer.from(await r.arrayBuffer())
      return { erro: `recusou (${r.status})` }
    } catch (e) {
      if (tentativa === 2) return { erro: `a conexão caiu (${e.message})` }
      await espera(1000 * (tentativa + 1))
    }
  }
}

/** Baixa e reduz. Devolve o tamanho final em bytes, ou 0 se nao deu. */
function baixarEReduzir(bytes, destino) {
  const cru = `${destino}.original`
  writeFileSync(cru, bytes)
  try {
    // ⚠️ ERA `sips` DIRETO, que e nativo do macOS — e prendia este robo A UMA
    // MAQUINA. Com o Mac dormindo as 8h05 ninguem tirava foto naquele dia. Agora
    // ele escolhe entre `sips` e ImageMagick pelo que EXISTE, e roda igual no
    // Linux do GitHub Actions.
    reduzir(cru, destino, LARGURA_MAXIMA)
  } catch {
    // Se o `sips` recusar (arquivo que nao e imagem, por exemplo), NAO se
    // guarda o original no lugar: uma foto que o redutor nao entendeu tambem
    // nao vai abrir no celular da cliente.
    rmSync(cru, { force: true })
    rmSync(destino, { force: true })
    return 0
  }
  rmSync(cru, { force: true })
  return tamanhoDe(destino)
}

// ⚠️ `require` NAO EXISTE NUM MODULO ESM, e a primeira versao disto usava. O
// arquivo carregava normalmente e so quebraria na hora de medir a foto — ou
// seja, so na primeira rodada que achasse uma imagem, que hoje e rara.
const tamanhoDe = (caminho) => {
  try { return statSync(caminho).size } catch { return 0 }
}

async function main() {
  const cliente = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await cliente.connect()
  let publicou = false
  try {
    const { rows: tokens } = await cliente.query(
      'select access_token from public.bling_tokens order by id desc limit 1')
    const token = tokens[0]?.access_token
    if (!token) { console.log('Sem token do Bling. Nada a fazer.'); return }

    const { rows: lotes } = await cliente.query(
      'select id, modelo, cor, sku, fotos from public.vessel_lotes order by criado_em desc')
    let alvos = lotesParaOlhar(lotes, { refazer: REBAIXAR })
    if (SO_ESTE_SKU) {
      alvos = alvos.filter((l) => achatar(l.sku) === achatar(SO_ESTE_SKU))
      console.log(`só a bolsa ${SO_ESTE_SKU} — ${alvos.length} lote(s)\n`)
    }
    // ⚠️ "Em duvida, sem foto" — regra do dono. Pasta reivindicada por dois SKUs
    // e foto errada garantida para um dos dois, e em silencio.
    const disputadas = pastasDisputadas(lotes)
    console.log(`${lotes.length} lotes no total · ${alvos.length} com SKU e faltando foto ou cor\n`)
    if (!alvos.length) return

    for (const lote of alvos) {
      // ⚠️ UM LOTE COM PROBLEMA NAO LEVA A RODADA JUNTO. A publicacao do site
      // vem DEPOIS deste laco: qualquer excecao aqui deixava dezenas de lotes
      // com o endereco da foto gravado no banco e a foto fora do ar. Errar num
      // lote tem de custar aquele lote, e nao os outros 103.
      try {
        const falta = loteEstaFaltando(lote)
        const oQueFalta = [falta.faltaFoto && 'foto', falta.faltaCor && 'cor'].filter(Boolean).join(' e ')
        console.log(`── ${lote.modelo} (${lote.sku}) — falta ${oQueFalta}`)

        const busca = await pedirAoBling(`produtos?codigo=${encodeURIComponent(lote.sku)}&limite=5`, token)
        const achado = produtoQueBate(busca?.data, lote.sku)
        if (!achado) { console.log('   não achei este SKU no Bling. Fica como está.'); continue }

        const detalhe = await pedirAoBling(`produtos/${achado.id}`, token)
        const produto = detalhe?.data
        if (!produto) { console.log('   o Bling não devolveu o detalhe. Tento na próxima rodada.'); continue }

        const mudou = {}

        // ── A COR ──
        if (falta.faltaCor) {
          const cor = corDoProduto(produto)
          if (cor) { mudou.cor = cor; console.log(`   cor: "${cor}"`) }
          else console.log('   o Bling também não diz a cor. Fica vazia — palpite errado é pior que vazio.')
        }

        // ── AS FOTOS ──
        if (falta.faltaFoto || REBAIXAR) {
          // ⚠️⚠️ AS DUAS FONTES, E A TRAVA QUE DECIDE ENTRE ELAS.
          //
          // Regra do dono, 08/09/2026: "Zoho quando houver pasta tratada e a cor e
          // o SKU bater". A pasta do Zoho ja vem tratada, entao ela tem
          // preferencia — mas SO com o SKU exato E a cor conferindo. Nao
          // conferindo, quem responde e o Bling, que e o cadastro que a cliente ve
          // na loja, no Mercado Livre e na Shopify, onde ela DECIDE COMPRAR.
          //
          // ⚠️ A TRAVA DE COR NASCEU DE UM DEFEITO DE VERDADE. Em 07/09 o Zoho
          // passou a vir primeiro sem conferir cor nenhuma. A LUNEA PINHAO
          // (SS0008HB.M4) tem pasta com o SKU exato — `Lunea_Pinhão -
          // SS0008HB.M4` — e arquivos `Lunea_Marrom_*` dentro dela. O
          // certificado da cliente ficou com aquele conjunto, e nao com o
          // cadastro do Bling. Conferido em 08/09 pelos md5 do que estava
          // publicado. Hoje ela reprova na cor e cai no Bling, como deve.
          //
          // Medido no mesmo dia contra os 54 SKUs com pasta no Zoho: 32 passam na
          // cor, 22 caem no Bling. Reprovar aqui NAO e ficar sem foto.
          const corDoLote = mudou.cor ?? lote.cor
          let urls = []
          let cabecalhoExtra = null
          let deOnde = ''

          if (lote.sku) {
            // Casamento por SKU EXATO. Pasta sem o SKU no nome fica de fora, e o
            // robo diz qual — adivinhar pelo modelo poria a foto de OUTRA bolsa
            // num certificado de autenticidade.
            try {
              const doZoho = await fotosDoZohoParaSku(lote.sku, { cor: corDoLote })
              if (doZoho.fotos.length) {
                urls = doZoho.fotos.slice(0, MAXIMO_DE_FOTOS).map((f) => f.url)
                cabecalhoExtra = doZoho.cabecalho
                deOnde = `Zoho (${doZoho.pasta})`
              } else if (doZoho.porque) {
                console.log(`   ${doZoho.porque}`)
              }
            } catch (e) {
              // Falha do Zoho NAO derruba a rodada: cai no Bling, que e o caminho
              // de sempre.
              console.log(`   o Zoho falhou (${e.message}); tentando o Bling`)
            }
          }

          if (!urls.length) {
            urls = imagensGrandesDoProduto(produto).slice(0, MAXIMO_DE_FOTOS)
            if (urls.length) deOnde = 'Bling'
          }

          const pasta = pastaDoLote({ ...lote, cor: mudou.cor ?? lote.cor })
          if (pasta && disputadas.has(pasta)) {
            // Sem foto e melhor do que a foto da bolsa vizinha.
            console.log(`   outra bolsa também cai na pasta "${pasta}". Fica sem foto,`
              + ' que é melhor do que a foto errada. Separe os cadastros.')
          } else if (!urls.length) {
            console.log('   o produto não tem foto no Bling. Assim que subir lá, a próxima rodada pega.')
          } else if (!pasta) {
            console.log('   sem modelo nem cor não dá para nomear a pasta. Fica como está.')
          } else if (DRY) {
            console.log(`   [dry] baixaria ${urls.length} foto(s) do ${deOnde} para fotos/selo/${pasta}/`)
          } else {
            // ⚠️ A FONTE TEM DE FICAR ESCRITA NA RODADA DE VERDADE, e nao so no
            // `--dry`. Sem esta linha, saber de onde veio a foto de cada bolsa
            // depois vira deducao minha em cima da regra — e nao o registro do
            // que o robo fez. O dono pediu esse relatorio em 08/09/2026.
            console.log(`   fonte: ${deOnde} · ${urls.length} foto(s)`)
            const destino = join(PASTA_DAS_FOTOS, pasta)
            mkdirSync(destino, { recursive: true })
            const guardadas = []
            // ⚠️ A MESMA FOTO DUAS VEZES NA GALERIA. Nao e o robo que duplica: a
            // FONTE repete. Medido em 08/09/2026 na LUNEA PINHAO (SS0008HB.M4) —
            // na pasta do Zoho, `Lunea_Marrom_Lado.png` e `Lunea_Marrom_Costas.png`
            // sao o mesmo arquivo, e no cadastro do Bling a 2a e a 3a imagem sao
            // identicas. O dono viu a repeticao no certificado 5YUNAVAAG8.
            //
            // A comparacao e pelos BYTES BAIXADOS, antes de reduzir: duas reducoes
            // da mesma origem dariam o mesmo arquivo, e comparar depois gastaria o
            // redutor a toa.
            const jaVistas = new Set()
            for (let i = 0; i < urls.length; i++) {
              // O Zoho exige o cabecalho de autorizacao; o Bling manda URL
              // assinada e nao quer nenhum. Por isso ele vem junto da fonte.
              const baixada = await baixarFoto(urls[i], cabecalhoExtra)
              if (!Buffer.isBuffer(baixada)) { console.log(`   foto ${i + 1}: ${deOnde} ${baixada.erro}.`); continue }
              const impressao = createHash('md5').update(baixada).digest('hex')
              if (jaVistas.has(impressao)) {
                console.log(`   foto ${i + 1}: repetida na fonte, não entra de novo.`)
                continue
              }
              jaVistas.add(impressao)
              const arquivo = join(destino, `${guardadas.length + 1}.jpg`)
              const tamanho = baixarEReduzir(baixada, arquivo)
              if (!tamanho) { console.log(`   foto ${i + 1}: não é uma imagem que eu consiga reduzir.`); continue }
              guardadas.push(enderecoDaFoto(pasta, guardadas.length + 1))
              console.log(`   foto ${guardadas.length}: ${(tamanho / 1024).toFixed(0)} KB`)
            }
            // ⚠️ AS SOBRAS DA RODADA ANTERIOR TEM DE SAIR. Se antes gravamos 8
            // fotos e agora saem 7 (uma repetida foi descartada), a `8.jpg` velha
            // continua publicada no endereco antigo. O certificado nao a mostra
            // — o banco lista so as 7 — mas ela fica no ar, e e justamente a foto
            // que acabamos de decidir que nao devia estar la.
            if (guardadas.length) {
              for (let sobra = guardadas.length + 1; sobra <= 20; sobra++) {
                const velha = join(destino, `${sobra}.jpg`)
                if (existsSync(velha)) { rmSync(velha, { force: true }); console.log(`   tirei a sobra ${sobra}.jpg`) }
              }
              mudou.fotos = guardadas
            }
          }
        }

        if (!Object.keys(mudou).length) continue
        if (DRY) { console.log('   [dry] gravaria', JSON.stringify(mudou).slice(0, 120)); continue }

        // ⚠️ O BANCO SO E ATUALIZADO DEPOIS DE O ARQUIVO EXISTIR. Ao contrario, o
        // lote apontaria para uma foto que ainda nao esta publicada, e a cliente
        // que encostasse o celular no meio do caminho veria quadrado quebrado.
        await cliente.query(
          `update public.vessel_lotes
              set cor = coalesce($2, cor), fotos = coalesce($3, fotos)
            where id = $1`,
          [lote.id, mudou.cor ?? null, mudou.fotos ?? null])
        publicou = publicou || Boolean(mudou.fotos)
        console.log('   gravado no lote.')
      } catch (e) {
        console.log(`   deu erro neste lote (${e.message}); sigo para o próximo.`)
      }
    }

    // ── PUBLICAR O SITE ──
    if (publicou && !DRY && !SEM_PUSH) {
      // ⚠️ `git add` SO DA PASTA DAS FOTOS. `git add .` levaria junto qualquer
      // coisa que estiver no meio do caminho no repositorio do site — e esse
      // repositorio e publicado a cada push.
      const git = (...args) => execFileSync('/usr/bin/git', ['-C', SITE, ...args], { encoding: 'utf8' })
      const sujo = git('status', '--porcelain', 'fotos/selo').trim()
      if (!sujo) { console.log('\nNada novo para publicar.'); return }
      git('add', 'fotos/selo')
      git('commit', '-m', 'Fotos do selo vindas do Bling (robô)')
      git('push', 'origin', 'main')

      // ⚠️ O `git push` GUARDA, MAS NAO PUBLICA — e ate 07/09/2026 este robo
      // dizia "Site publicado" logo depois dele.
      //
      // Este site nao e publicado pelo git: o plano Hobby da Vercel BLOQUEIA o
      // deploy quando os metadados dizem que o repositorio e privado e de
      // organizacao. Por isso existe `ferramentas/publicar.sh`, que publica de
      // uma copia SEM o `.git`. Quem so faz push guarda a foto no repositorio e
      // deixa o site como estava.
      //
      // O estrago era invisivel: o robo terminava dizendo que publicou, o lote
      // ficava com o endereco da foto gravado no banco, e a pagina da cliente
      // pedia uma imagem que respondia 404. Descoberto em 07/09 conferindo o
      // endereco de verdade depois de rodar — 46 lotes com foto no banco e
      // nenhuma no ar. As antigas so funcionavam porque alguem tinha publicado
      // o site a mao por outro motivo, carregando a pasta junto.
      console.log('\nPublicando o site (o push sozinho não publica)…')
      execFileSync('./ferramentas/publicar.sh', [], { cwd: SITE, stdio: 'inherit' })
      console.log('\nSite publicado.')
    } else if (publicou) {
      console.log('\nFotos gravadas, sem publicar (--dry ou --sem-push).')
    }
  } finally {
    await cliente.end()
  }
}

await main()
