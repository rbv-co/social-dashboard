import test from 'node:test'
import assert from 'node:assert/strict'
import {
  PASSOS, ESTAGIOS, TELAS_DO_GUIA, AJUDA_DA_ABA, SOCORRO, ONDE_SE_GRAVA,
  passoAtual, guiaJaVisto, marcarGuiaVisto, proximaTelaDoGuia, telaAnteriorDoGuia,
} from './tutorial.js'

// ── o passo a passo ────────────────────────────────────────────────────────

test('passoAtual: sem lote nenhum, esta no passo 1', () => {
  assert.equal(passoAtual({ temLote: false, pecas: [] }), 1)
  assert.equal(passoAtual(), 1)
})

test('passoAtual: lote escolhido mas ainda sem peca carregada, continua no 1', () => {
  // a tela pede as pecas depois de escolher o lote; nesse intervalo nao da pra
  // dizer "esta gravando" — seria mentira
  assert.equal(passoAtual({ temLote: true, pecas: [] }), 1)
})

test('passoAtual: falta etiqueta, esta gravando', () => {
  const pecas = [{ gravada_em: '2026-08-30T10:00:00Z' }, { gravada_em: null }]
  assert.equal(passoAtual({ temLote: true, pecas }), 2)
})

test('passoAtual: lote inteiro gravado, esta no fim', () => {
  const pecas = [{ gravada_em: '2026-08-30T10:00:00Z' }, { gravada_em: '2026-08-30T10:01:00Z' }]
  assert.equal(passoAtual({ temLote: true, pecas }), 3)
})

test('passoAtual: uma peca so, ainda por gravar', () => {
  assert.equal(passoAtual({ temLote: true, pecas: [{ gravada_em: null }] }), 2)
})

test('PASSOS: sao tres, numerados de 1 a 3, cada um com titulo e resumo', () => {
  assert.equal(PASSOS.length, 3)
  PASSOS.forEach((p, i) => {
    assert.equal(p.n, i + 1)
    assert.ok(p.titulo.length > 3, 'o passo precisa ter titulo')
    assert.ok(p.resumo.length > 20, 'o resumo tem de explicar, nao rotular')
  })
})

test('PASSOS: o numero do passo e o MESMO numero da aba', () => {
  // a barra de abas mostra "1 LOTES  2 GRAVAR  3 ETIQUETAS": dois numeros
  // diferentes para a mesma etapa seriam duas verdades sobre o mesmo caminho
  assert.deepEqual(PASSOS.map((p) => p.aba), ['lotes', 'gravar', 'etiquetas'])
  assert.deepEqual(ESTAGIOS.map((e) => e.aba), ['lotes', 'gravar', 'etiquetas'])
  assert.deepEqual(ESTAGIOS.map((e) => e.n), PASSOS.map((p) => p.n))
})

// ── os tres estagios, por extenso ──────────────────────────────────────────

test('ESTAGIOS: cada um diz o que fazer, o que a tela mostra e como saber que deu certo', () => {
  assert.equal(ESTAGIOS.length, 3)
  for (const e of ESTAGIOS) {
    assert.ok(e.oQueFazer.length > 60, `o estagio ${e.n} nao diz o que fazer`)
    assert.ok(e.oQueATelaMostra.length > 60, `o estagio ${e.n} nao diz o que a tela mostra`)
    assert.ok(e.comoSaber.length > 60, `o estagio ${e.n} nao diz como saber que deu certo`)
  }
})

test('ESTAGIOS: o de gravar avisa que sem o sinal a peca NAO foi marcada', () => {
  // e a diferenca entre a bolsa sair pronta e sair com a etiqueta em branco
  const gravar = ESTAGIOS.find((e) => e.aba === 'gravar')
  assert.match(gravar.comoSaber, /nao foi marcada|NÃO foi marcada/i)
})

// ── a ajuda dentro de cada aba ─────────────────────────────────────────────

test('AJUDA_DA_ABA: as SEIS abas tem ajuda propria, e nenhuma e rotulo', () => {
  // guia unico ninguem reabre: quem chega na aba Alertas seis meses depois
  // precisa da explicacao ALI
  assert.deepEqual(Object.keys(AJUDA_DA_ABA).sort(),
    ['alertas', 'cartoes', 'etiquetas', 'gravar', 'lotes', 'registros'])
  for (const [aba, texto] of Object.entries(AJUDA_DA_ABA)) {
    assert.ok(texto.length > 80, `a ajuda da aba ${aba} e curta demais para explicar`)
  }
})

test('AJUDA_DA_ABA: a de Lotes explica o arquivamento automatico', () => {
  // e o unico lugar onde a pessoa descobre para onde foram os lotes encerrados
  assert.match(AJUDA_DA_ABA.lotes, /encerrado/i)
  assert.match(AJUDA_DA_ABA.etiquetas, /30 dias/i)
})

test('⚠️ AJUDA_DA_ABA: a de Cartoes avisa que o numero congela', () => {
  // E a consequencia que a pessoa NAO adivinha: depois de o cartao sair, aquela
  // peca nao pode mais ser renumerada nem apagada. Descobrir isso na recusa de
  // um botao, tres semanas depois, e descobrir tarde.
  assert.match(AJUDA_DA_ABA.cartoes, /n[aã]o muda mais|congel/i)
  // E que a previa e o cartao, e nao um desenho parecido.
  assert.match(AJUDA_DA_ABA.cartoes, /pr[eé]via/i)
})

// ── quem grava por onde ────────────────────────────────────────────────────

test('ONDE_SE_GRAVA: cobre Android, iPhone, computador e o gravador de mesa', () => {
  assert.deepEqual(ONDE_SE_GRAVA.map((g) => g.chave),
    ['android', 'iphone', 'computador', 'gravador'])
  for (const g of ONDE_SE_GRAVA) assert.ok(g.como.length > 60, `${g.chave} nao explica nada`)
})

test('ONDE_SE_GRAVA: todo caminho listado existe HOJE, e diz onde encontrar', () => {
  // ⚠️ MUDOU EM 01/09/2026. Ate esta data o gravador de mesa estava
  // `pronto:false` porque a maquina nao tinha sido comprada — e o teste guardava
  // isso, para a tela nao mandar alguem procurar na bancada uma coisa que nao
  // estava la. A maquina chegou, o caminho foi provado a mao no Windows, e o
  // programa que empresta o leitor existe. Manter "AINDA NAO EXISTE" agora seria
  // a MESMA mentira ao contrario: a bancada ignoraria o botao que esta na frente
  // dela. Se um caminho novo entrar aqui antes de existir, ele volta a `false`.
  for (const g of ONDE_SE_GRAVA) {
    assert.equal(g.pronto, true, `${g.chave} esta na lista e nao existe`)
  }
  const gravador = ONDE_SE_GRAVA.find((g) => g.chave === 'gravador')
  assert.match(gravador.como, /leitor de mesa/i, 'tem de dizer o nome do botao')
  assert.match(gravador.como, /programa/i,
    'tem de dizer que ele so existe dentro do programa: sem isso a pessoa procura o botao no navegador')
})

// ── deu errado, e agora? ───────────────────────────────────────────────────

test('SOCORRO: cobre os seis casos que o dono listou, e cada um diz o que houve E o que fazer', () => {
  const precisa = [
    'nao-grava', 'ja-tem-outra', 'peca-errada',
    'nao-pergunta-nada', 'iphone-sem-botao', 'computador-sem-modo',
  ]
  const tem = SOCORRO.map((s) => s.chave)
  assert.deepEqual(precisa.filter((c) => !tem.includes(c)), [], 'faltou caso no socorro')
  for (const s of SOCORRO) {
    assert.ok(s.sintoma.length > 10, `${s.chave} sem sintoma escrito`)
    assert.ok(s.oQueHouve.length > 40, `${s.chave} nao diz o que houve`)
    assert.ok(s.oQueFazer.length > 60, `${s.chave} nao diz o que fazer`)
  }
})

test('SOCORRO: "gravei a peca errada" manda na aba certa e avisa da etiqueta que sobrou', () => {
  // a peca volta pra fila, mas a ETIQUETA continua com o endereco antigo dentro
  const caso = SOCORRO.find((s) => s.chave === 'peca-errada')
  assert.match(caso.oQueFazer, /Etiquetas/)
  assert.match(caso.oQueFazer, /senha/i)
  assert.match(caso.oQueFazer, /endere/i)
})

test('SOCORRO: o caso do iPhone nao manda a pessoa procurar um botao que nao existe', () => {
  const caso = SOCORRO.find((s) => s.chave === 'iphone-sem-botao')
  assert.match(caso.oQueHouve, /iPhone/)
  assert.match(caso.oQueFazer, /Gravei essa/)
})

// ── o guia da primeira vez ─────────────────────────────────────────────────

test('TELAS_DO_GUIA: todas com titulo e texto que explicam', () => {
  assert.ok(TELAS_DO_GUIA.length >= 10, 'o guia de bancada nao pode encolher para meia duzia de telas')
  const chaves = TELAS_DO_GUIA.map((t) => t.chave)
  assert.equal(new Set(chaves).size, chaves.length, 'duas telas com a mesma chave')
  for (const t of TELAS_DO_GUIA) {
    assert.ok(t.titulo.length > 3, `tela ${t.chave} sem titulo`)
    assert.ok(t.texto.length > 60, `tela ${t.chave}: texto curto demais nao ensina nada`)
    for (const i of t.itens || []) {
      assert.ok(i.rotulo.length > 3 && i.texto.length > 40, `item fraco na tela ${t.chave}`)
    }
  }
})

/* PADRAO-DA-CENTRAL, ITEM 8: NADA SE PERDE AO REORGANIZAR.
 * O guia foi refeito de cinco telas de texto corrido para o guia de bancada.
 * Esta e a lista do que ele dizia ANTES, conferida item a item. */
test('o guia refeito nao perdeu NENHUMA das cinco telas que ja existiam', () => {
  const antes = [
    ['para que serve', 'para-que-serve', /encosta o celular/i],
    ['onde a etiqueta vai', 'onde-a-etiqueta-vai', /forro interno/i],
    ['como gravar', 'como-gravar', /uma etiqueta de cada vez/i],
    ['o que a tela faz por voce', 'o-que-a-tela-faz', /le a etiqueta ANTES|lê a etiqueta ANTES/i],
    ['a trava', 'a-trava', /nasce desligada/i],
  ]
  for (const [nome, chave, marca] of antes) {
    const tela = TELAS_DO_GUIA.find((t) => t.chave === chave)
    assert.ok(tela, `a tela "${nome}" sumiu do guia`)
    assert.match(tela.texto, marca, `a tela "${nome}" perdeu o que ela dizia`)
  }
})

test('TELAS_DO_GUIA: a de ONDE A ETIQUETA VAI avisa do metal', () => {
  // e o erro que estraga a peca na fabrica: NFC nao atravessa metal, e o dono
  // decidiu que a etiqueta vai costurada no forro
  const tela = TELAS_DO_GUIA.find((t) => /onde a etiqueta vai/i.test(t.titulo))
  assert.ok(tela, 'a tela do lugar da etiqueta tem de existir')
  assert.match(tela.texto, /metal/i)
  assert.match(tela.texto, /forro/i)
})

test('TELAS_DO_GUIA: a parte fisica diz onde encostar o celular em cada aparelho', () => {
  // nunca esteve escrito em lugar nenhum: no iPhone o leitor fica em cima, no
  // Android costuma ficar no meio das costas
  const tela = TELAS_DO_GUIA.find((t) => t.chave === 'onde-a-etiqueta-vai')
  const tudo = (tela.itens || []).map((i) => `${i.rotulo} ${i.texto}`).join(' ')
  assert.match(tudo, /iPhone/)
  assert.match(tudo, /Android/)
  assert.match(tudo, /parado/i, 'segurar parado ate a confirmacao faz parte da parte fisica')
})

test('TELAS_DO_GUIA: a da TRAVA diz que nao tem volta', () => {
  const tela = TELAS_DO_GUIA.find((t) => /trava/i.test(t.titulo))
  assert.ok(tela, 'a tela da trava tem de existir')
  assert.match(tela.texto, /sempre|volta|descartavel|descartável/i)
})

test('TELAS_DO_GUIA: os tres estagios e o socorro inteiro estao no guia', () => {
  for (const e of ESTAGIOS) {
    const tela = TELAS_DO_GUIA.find((t) => t.chave === `estagio-${e.n}`)
    assert.ok(tela, `o estagio ${e.n} nao virou tela do guia`)
    assert.equal(tela.texto, e.oQueFazer, 'a tela do guia nasce do estagio, nao de texto reescrito')
  }
  const doSocorro = TELAS_DO_GUIA.filter((t) => t.chave.startsWith('socorro-'))
  const itens = doSocorro.flatMap((t) => t.itens)
  assert.equal(itens.length, SOCORRO.length, 'algum caso do socorro ficou de fora do guia')
})

// ── o "ja vi o guia", guardado no aparelho ─────────────────────────────────

function depositoDeMentira() {
  const caixa = new Map()
  return {
    getItem: (k) => (caixa.has(k) ? caixa.get(k) : null),
    setItem: (k, v) => caixa.set(k, String(v)),
  }
}

test('guiaJaVisto: da falso antes de qualquer coisa, verdadeiro depois de marcar', () => {
  const d = depositoDeMentira()
  assert.equal(guiaJaVisto(d), false)
  assert.equal(marcarGuiaVisto(d), true)
  assert.equal(guiaJaVisto(d), true)
})

test('guiaJaVisto: deposito que ESTOURA nao derruba a tela', () => {
  // janela anonima e "bloquear dados de sites" fazem localStorage lancar erro.
  // Sem o try/catch, a tela inteira ficaria em branco por causa de um tutorial.
  const explosivo = {
    getItem() { throw new Error('acesso negado') },
    setItem() { throw new Error('acesso negado') },
  }
  assert.equal(guiaJaVisto(explosivo), false)
  assert.equal(marcarGuiaVisto(explosivo), false)
})

test('proximaTelaDoGuia: anda ate o fim e ai devolve nulo', () => {
  assert.equal(proximaTelaDoGuia(0), 1)
  assert.equal(proximaTelaDoGuia(3), 4)
  assert.equal(proximaTelaDoGuia(TELAS_DO_GUIA.length - 1), null, 'a ultima tela fecha o guia')
})

test('proximaTelaDoGuia: entrada estranha volta para o comeco em vez de quebrar', () => {
  assert.equal(proximaTelaDoGuia(undefined), 0)
  assert.equal(proximaTelaDoGuia(-1), 0)
  assert.equal(proximaTelaDoGuia('abc'), 0)
})

test('telaAnteriorDoGuia: da pra voltar uma, e a primeira nao tem para onde', () => {
  // com mais de dez telas, quem passa direto pela que interessava recomecaria o
  // guia inteiro sem isto
  assert.equal(telaAnteriorDoGuia(1), 0)
  assert.equal(telaAnteriorDoGuia(4), 3)
  assert.equal(telaAnteriorDoGuia(0), null)
  assert.equal(telaAnteriorDoGuia(-2), null)
  assert.equal(telaAnteriorDoGuia('abc'), null)
})
