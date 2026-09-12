/* A PORTA DO LEITOR DE MESA, testada como a do celular.
 *
 * Este arquivo é irmão de `gravador-nfc.test.mjs`, e de propósito: os dois
 * testam a MESMA ideia — a única porta que fala com o mundo de fora — com o
 * mundo de fora entrando por injeção. Lá é o `NDEFReader` do Chrome do Android;
 * aqui é o `window.gravadorDeMesa` que o programa da janela pendura.
 *
 * ⚠️ O TESTE QUE MAIS IMPORTA ESTÁ NO FIM: leitura que falha NUNCA pode virar
 * "etiqueta em branco". Vazio é a resposta que autoriza gravar por cima de uma
 * bolsa que já tem dono — e a etiqueta já está costurada dentro do forro, onde
 * não se reabre.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  temLeitorDeMesa,
  traduzirFalha,
  criarGravadorDeMesa,
  pedeParaReligar, sabeReligar, religarOLeitor,
} from './porta-do-gravador-de-mesa.js'
import { planoDeGravacao, BYTES_DE_USUARIO } from './ndef-para-ntag213.js'
import { conferirLeitura } from '../nfc-fila.js'
import { enderecoDaTag } from '../lotes.js'

/* ── UMA NTAG213 DE MENTIRA, DO OUTRO LADO DA JANELA ───────────────────────
 * Ela imita o que o programa entrega: bytes crus, uma página por escrita, e
 * frases de bancada em vez de código do Windows. A memória é FÍSICA: o que a
 * escrita deixa nela é o que a leitura devolve — é isso que permite o teste de
 * ida e volta lá embaixo.
 *
 * De fábrica, as páginas 4 e 5 trazem o Lock Control TLV (`01 03 A0 0C 34`) —
 * a armadilha que fez uma etiqueta reaproveitada sair ilegível na bancada. */
const CC_DE_FABRICA = [0xe1, 0x10, 0x12, 0x00]

function memoriaDeFabrica() {
  const m = new Array(BYTES_DE_USUARIO).fill(0)
  m[0] = 0x01; m[1] = 0x03; m[2] = 0xa0; m[3] = 0x0c; m[4] = 0x34
  m[5] = 0x03; m[6] = 0x00; m[7] = 0xfe
  return m
}

function janelaComLeitor({
  leitores = ['ACS ACR122U PICC Interface 0'],
  capability = CC_DE_FABRICA,
  memoria = memoriaDeFabrica(),
  aoLer = null,
  aoEscrever = null,
  aoConectar = null,
} = {}) {
  const registro = { conectado: null, escritas: [], desconectou: 0 }
  const gravadorDeMesa = {
    async disponivel() { return true },
    async listarLeitores() { return leitores },
    async conectar(nome) {
      if (aoConectar) await aoConectar(nome)
      registro.conectado = nome || leitores[0]
      return registro.conectado
    },
    async lerPaginas(pagina, quantosBytes) {
      if (aoLer) {
        const resposta = await aoLer(pagina, quantosBytes)
        if (resposta !== undefined) return resposta
      }
      if (pagina === 3) return capability.slice(0, quantosBytes)
      const inicio = (pagina - 4) * 4
      return memoria.slice(inicio, inicio + quantosBytes)
    },
    async escreverPagina(pagina, bytes) {
      if (aoEscrever) await aoEscrever(pagina, bytes)
      registro.escritas.push({ pagina, bytes: [...bytes] })
      const inicio = (pagina - 4) * 4
      for (let i = 0; i < 4; i++) memoria[inicio + i] = bytes[i]
      return true
    },
    async desconectar() { registro.desconectou += 1 },
  }
  return { janela: { gravadorDeMesa }, registro, memoria }
}

/* ── O PROGRAMA ESTÁ AÍ, OU NÃO ESTÁ ─────────────────────────────────────── */

test('temLeitorDeMesa: falso no navegador comum, que não tem o programa', () => {
  assert.equal(temLeitorDeMesa({}), false)
  assert.equal(temLeitorDeMesa(undefined), false)
})

test('temLeitorDeMesa: falso quando a superfície existe pela metade', () => {
  // um `window.gravadorDeMesa = {}` de qualquer origem não pode ligar o modo:
  // o botão apareceria e a primeira gravação morreria com "não é função"
  assert.equal(temLeitorDeMesa({ gravadorDeMesa: {} }), false)
})

test('temLeitorDeMesa: verdadeiro dentro da janela do gravador', () => {
  assert.equal(temLeitorDeMesa(janelaComLeitor().janela), true)
})

test('criarGravadorDeMesa: devolve nulo fora da janela do gravador', () => {
  assert.equal(criarGravadorDeMesa({ janela: {} }), null)
})

/* ── AS FRASES ───────────────────────────────────────────────────────────── */

test('traduzirFalha: a frase de bancada do programa passa inteira', () => {
  const frase = 'Não há leitor nenhum ligado nesta máquina. Ligue o cabo USB do ACR122U.'
  assert.equal(traduzirFalha(new Error(frase)), frase)
})

test('traduzirFalha: falha sem recado nenhum não vira frase vazia', () => {
  const frase = traduzirFalha(new Error(''))
  assert.ok(frase.length > 20, 'a frase precisa dizer o que fazer na bancada')
  assert.match(frase, /cabo|leitor/i)
})

test('traduzirFalha: o arranque do serviço do Windows NÃO chega à pessoa como código', () => {
  // 0x8010001D é o serviço de cartão do Windows subindo sob demanda. O motor já
  // tenta de novo sozinho; se algum dia escapar, a pessoa lê uma frase, nunca um
  // código hexadecimal que não diz nada a quem está com uma bolsa na mão.
  const frase = traduzirFalha(new Error('0x8010001D'))
  assert.doesNotMatch(frase, /0x8010001D/i, 'código do Windows não é recado de bancada')
  assert.ok(frase.length > 20)
})

test('traduzirFalha: NENHUMA frase de problema do leitor manda trocar a etiqueta', () => {
  // mesma cicatriz do `InvalidStateError` no celular: leitor ocupado é leitor,
  // não etiqueta — e quem troca etiqueta boa joga bolsa fora
  for (const bruto of ['', '0x8010001D', '0x8010000F']) {
    assert.doesNotMatch(traduzirFalha(new Error(bruto)), /troque a etiqueta/i)
  }
})

/* ── ESCOLHER O LEITOR ───────────────────────────────────────────────────── */

test('listarLeitores devolve o que o programa enxerga', async () => {
  const { janela } = janelaComLeitor({ leitores: ['ACR122U', 'Outro'] })
  assert.deepEqual(await criarGravadorDeMesa({ janela }).listarLeitores(), ['ACR122U', 'Outro'])
})

test('conectar sem leitor ligado estoura com a frase do programa, e não com vazio', async () => {
  const { janela } = janelaComLeitor({
    aoConectar: () => { throw new Error('Não há leitor nenhum ligado nesta máquina.') },
  })
  await assert.rejects(
    () => criarGravadorDeMesa({ janela }).conectar(),
    /leitor nenhum ligado/i,
  )
})

/* ── LER A ETIQUETA ──────────────────────────────────────────────────────── */

test('lerAEtiqueta traz os 144 bytes do usuário e o Capability Container', async () => {
  const { janela } = janelaComLeitor()
  const g = criarGravadorDeMesa({ janela })
  await g.conectar()
  const lida = await g.lerAEtiqueta()
  assert.equal(lida.memoria.length, BYTES_DE_USUARIO)
  assert.equal(lida.capability.formatada, true)
  assert.equal(lida.capability.podeGravar, true)
  assert.equal(lida.endereco, '', 'etiqueta de fábrica não tem endereço nenhum')
})

test('lerAEtiqueta lê a etiqueta INTEIRA, nunca só o começo', async () => {
  // outro aplicativo pode ter posto um registro na frente e empurrado o endereço
  // para adiante: ler pela metade acharia "nada" numa etiqueta ocupada
  const pedidos = []
  const { janela } = janelaComLeitor({ aoLer: (pagina, quantos) => { pedidos.push([pagina, quantos]) } })
  const g = criarGravadorDeMesa({ janela })
  await g.conectar()
  await g.lerAEtiqueta()
  const bytesDoUsuario = pedidos.filter(([p]) => p >= 4).reduce((s, [, q]) => s + q, 0)
  assert.equal(bytesDoUsuario, BYTES_DE_USUARIO)
  assert.ok(pedidos.some(([p]) => p === 3), 'a página 3 tem de ser lida: é ela que diz se grava')
})

test('⚠️ leitura que FALHOU não vira etiqueta em branco: ela estoura', async () => {
  // O teste que sustenta a ferramenta inteira. Se esta leitura devolvesse
  // `{ endereco: '' }`, `conferirLeitura` diria 'vazia', e 'vazia' quer dizer
  // PODE GRAVAR — por cima de uma bolsa que já tem dono.
  const { janela } = janelaComLeitor({
    aoLer: (pagina) => { if (pagina >= 4) throw new Error('A etiqueta saiu de cima do leitor.') },
  })
  const g = criarGravadorDeMesa({ janela })
  await g.conectar()
  await assert.rejects(() => g.lerAEtiqueta(), /saiu de cima/i)
})

test('⚠️ leitura TRUNCADA também estoura, em vez de virar meia memória', async () => {
  // meia memória lê como etiqueta em branco, que é o mesmo estrago
  const { janela } = janelaComLeitor({
    aoLer: (pagina, quantos) => (pagina >= 4 ? new Array(quantos - 1).fill(0) : undefined),
  })
  const g = criarGravadorDeMesa({ janela })
  await g.conectar()
  await assert.rejects(() => g.lerAEtiqueta(), /(de novo|parada|incompleta|bytes)/i)
})

test('⚠️ leitura que devolve coisa que não é lista de bytes estoura', async () => {
  const { janela } = janelaComLeitor({ aoLer: (pagina) => (pagina >= 4 ? null : undefined) })
  const g = criarGravadorDeMesa({ janela })
  await g.conectar()
  await assert.rejects(() => g.lerAEtiqueta())
})

test('etiqueta com OUTRA peça é lida como outra peça, nunca como em branco', async () => {
  const ocupada = memoriaDeFabrica()
  for (const { pagina, bytes } of planoDeGravacao(enderecoDaTag('ZZZ999'), ocupada)) {
    const inicio = (pagina - 4) * 4
    for (let i = 0; i < 4; i++) ocupada[inicio + i] = bytes[i]
  }
  const { janela } = janelaComLeitor({ memoria: ocupada })
  const g = criarGravadorDeMesa({ janela })
  await g.conectar()
  const lida = await g.lerAEtiqueta()
  assert.equal(lida.endereco, enderecoDaTag('ZZZ999'))
  assert.equal(conferirLeitura(lida.endereco, 'AAA111'), 'outra-peca')
})

test('etiqueta travada para gravação vem com o aviso, e não com um "pode"', async () => {
  const { janela } = janelaComLeitor({ capability: [0xe1, 0x10, 0x12, 0x0f] })
  const g = criarGravadorDeMesa({ janela })
  await g.conectar()
  const lida = await g.lerAEtiqueta()
  assert.equal(lida.capability.podeGravar, false)
  assert.match(lida.capability.aviso, /travada/i)
})

/* ── GRAVAR ──────────────────────────────────────────────────────────────── */

test('gravar monta o plano A PARTIR DA MEMÓRIA LIDA e preserva o Lock Control', async () => {
  // A armadilha medida na bancada em 01/09/2026: plano montado supondo etiqueta
  // de fábrica, gravado numa reaproveitada, doze `90 00` e a etiqueta ilegível.
  const { janela, registro } = janelaComLeitor()
  const g = criarGravadorDeMesa({ janela })
  await g.conectar()
  const lida = await g.lerAEtiqueta()
  await g.gravar(enderecoDaTag('AAA111'), lida.memoria)
  // O Lock Control tem 5 bytes: os 4 da página 4 e MAIS UM, que cai dentro da
  // página 5. Então a página 4 não se toca, e a 5 tem de sair com o rabo dele
  // (`34`) no primeiro byte. Montar o plano sem a memória zeraria esse byte e a
  // trava iria embora junto com a gravação.
  const primeira = registro.escritas[0]
  assert.equal(primeira.pagina, 5, 'a página 4 é inteira do Lock Control: não se escreve nela')
  assert.equal(primeira.bytes[0], 0x34, 'o rabo do Lock Control tem de sobreviver à gravação')
  assert.ok(!registro.escritas.some((e) => e.pagina === 4), 'ninguém pode escrever na página 4 aqui')
})

test('gravar SEM a memória lida é recusado — é o estrago de 01/09 virado teste', async () => {
  const { janela, registro } = janelaComLeitor()
  const g = criarGravadorDeMesa({ janela })
  await g.conectar()
  await assert.rejects(() => g.gravar(enderecoDaTag('AAA111')), /lid[ao]|mem[óo]ria/i)
  assert.equal(registro.escritas.length, 0, 'não pode ter escrito nada')
})

test('IDA E VOLTA: grava e lê de volta pela MESMA porta, e confere', async () => {
  const { janela } = janelaComLeitor()
  const g = criarGravadorDeMesa({ janela })
  await g.conectar()
  const antes = await g.lerAEtiqueta()
  assert.equal(conferirLeitura(antes.endereco, 'AAA111'), 'vazia')
  await g.gravar(enderecoDaTag('AAA111'), antes.memoria)
  const depois = await g.lerAEtiqueta()
  assert.equal(conferirLeitura(depois.endereco, 'AAA111'), 'confere',
    'sem "confere" a tela nunca marcaria a peça — o modo de mesa seria inútil')
})

test('etiqueta que sai no meio da gravação estoura com o que já foi escrito', async () => {
  const { janela, registro } = janelaComLeitor({
    aoEscrever: (pagina) => {
      if (pagina >= 6) throw new Error('A etiqueta saiu de cima do leitor no meio da gravação.')
    },
  })
  const g = criarGravadorDeMesa({ janela })
  await g.conectar()
  const antes = await g.lerAEtiqueta()
  await assert.rejects(() => g.gravar(enderecoDaTag('AAA111'), antes.memoria), /saiu de cima/i)
  assert.ok(registro.escritas.length > 0, 'a etiqueta ficou pela metade, e a tela precisa saber')
})

test('endereço que não cabe é recusado ANTES de qualquer escrita', async () => {
  const { janela, registro } = janelaComLeitor()
  const g = criarGravadorDeMesa({ janela })
  await g.conectar()
  const antes = await g.lerAEtiqueta()
  await assert.rejects(() => g.gravar(`https://x.com/${'a'.repeat(200)}`, antes.memoria))
  assert.equal(registro.escritas.length, 0)
})

/* ── SOLTAR A ETIQUETA ───────────────────────────────────────────────────── */

test('desconectar não estoura nunca: soltar a etiqueta é limpeza', async () => {
  const { janela } = janelaComLeitor()
  janela.gravadorDeMesa.desconectar = async () => { throw new Error('já saiu') }
  const g = criarGravadorDeMesa({ janela })
  await g.conectar()
  await g.desconectar() // não pode estourar
})

test('a porta é a ÚNICA que fala com a janela: ela não expõe APDU cru', async () => {
  const { janela } = janelaComLeitor()
  const g = criarGravadorDeMesa({ janela })
  for (const nome of Object.keys(g)) {
    assert.doesNotMatch(nome, /apdu|transmitir|comando/i,
      `a porta expôs "${nome}": comando cru é do motor, do lado do programa`)
  }
})

// ── O BOTAO DE RELIGAR O LEITOR (07/09/2026) ───────────────────────────────
/* O servico de Cartao Inteligente do Windows caiu na bancada em 06/09 e o
 * conserto — abrir "Servicos", achar o nome certo, clicar em Iniciar — e longe
 * demais de quem esta com uma bolsa na mao. O botao encurta isso.
 *
 * ⚠️ Ele SO aparece no erro, e so no erro CERTO: botao sempre visivel convida a
 * apertar quando nada esta errado, e ele abre a janelinha de autorizacao do
 * Windows, que nao pode virar rotina. */

test('pedeParaReligar: SIM na mensagem do servico', () => {
  assert.equal(pedeParaReligar('O serviço de Cartão Inteligente do Windows não está rodando. '
    + 'Abra "Serviços" no Windows, procure por "Cartão Inteligente" e inicie.'), true)
  assert.equal(pedeParaReligar('O serviço de Cartão Inteligente do Windows parou.'), true)
})

test('⚠️ pedeParaReligar: NAO em problema de etiqueta', () => {
  /* Oferecer o conserto do Windows aqui ensina a apertar o botao errado — e o
   * botao pede autorizacao de administrador. */
  for (const frase of [
    'Não há etiqueta no leitor. Encoste a etiqueta em cima do leitor, no meio.',
    'A etiqueta saiu de cima do leitor no meio. Encoste de novo e segure parada.',
    'A etiqueta não respondeu. Encoste de novo e segure parada.',
    'A resposta do leitor veio estragada. Encoste a etiqueta de novo.',
  ]) {
    assert.equal(pedeParaReligar(frase), false, `ofereceu religar em: ${frase}`)
  }
})

test('pedeParaReligar: NAO quando o problema e o cabo ou outro programa', () => {
  assert.equal(pedeParaReligar('Não achei nenhum leitor. Confira se o ACR122U está ligado na USB.'), false)
  assert.equal(pedeParaReligar('O leitor está sendo usado por outro programa.'), false)
})

test('pedeParaReligar: sem frase nenhuma, nao aparece', () => {
  assert.equal(pedeParaReligar(''), false)
  assert.equal(pedeParaReligar(null), false)
  assert.equal(pedeParaReligar(undefined), false)
});

test('sabeReligar: versao antiga do programa NAO oferece o botao', () => {
  // A tela e a mesma para todas as versoes do `.exe`. Um botao que nao faz nada
  // e pior que botao nenhum.
  assert.equal(sabeReligar({ gravadorDeMesa: {} }), false);
  assert.equal(sabeReligar({}), false);
  assert.equal(sabeReligar({ gravadorDeMesa: { religarOServico: () => {} } }), true);
});

test('religarOLeitor devolve a frase do programa', async () => {
  const janela = { gravadorDeMesa: { religarOServico: async () => 'Pronto. Religado.' } };
  assert.deepEqual(await religarOLeitor(janela), { ok: true, frase: 'Pronto. Religado.' });
});

test('⚠️ religarOLeitor: recusa vira frase, e nunca estoura na tela', async () => {
  const janela = { gravadorDeMesa: {
    religarOServico: async () => { throw new Error('Você cancelou a autorização do Windows.') },
  } };
  const r = await religarOLeitor(janela);
  assert.equal(r.ok, false);
  assert.match(r.frase, /cancelou/);
});

test('religarOLeitor sem o programa diz o caminho manual', async () => {
  const r = await religarOLeitor({});
  assert.equal(r.ok, false);
  assert.match(r.frase, /Serviços/);
});
