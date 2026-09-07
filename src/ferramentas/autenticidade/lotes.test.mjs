import test from 'node:test'
import assert from 'node:assert/strict'
import {
  enderecoDaTag, progressoDoLote, proximaPorGravar, linhasDoCsv, resumoDeAlertas,
  MOTIVOS_DE_BAIXA, fraseDaRecusa, fraseDaSenha,
  rotuloDoMotivo, pecasEmOrdem, estadoDaPeca, linhasDaListaDoLote,
  codigosComGarantia, etiquetasGravadas, motivoObrigatorio, descricaoDaPeca,
  MOTIVOS_DE_DEVOLUCAO, motivoDaDevolucaoEscrito,
} from './lotes.js'

test('enderecoDaTag: e exatamente o que vai gravado na etiqueta', () => {
  assert.equal(enderecoDaTag('K7M4X9QP2R'), 'https://vesselbrasil.com.br/verify/K7M4X9QP2R')
})

test('progressoDoLote: conta so as que ja foram gravadas', () => {
  const pecas = [{ gravada_em: '2026-08-05T10:00:00Z' }, { gravada_em: null }, { gravada_em: null }]
  assert.deepEqual(progressoDoLote(pecas), { gravadas: 1, total: 3, texto: '1 de 3' })
})

test('progressoDoLote: lote vazio nao divide por zero', () => {
  assert.deepEqual(progressoDoLote([]), { gravadas: 0, total: 0, texto: '0 de 0' })
})

test('proximaPorGravar: a primeira sem gravacao, na ordem da serie', () => {
  // de proposito fora de ordem: o banco nao garante ordem sem order by
  const pecas = [
    { codigo: 'B', numero_na_serie: 2, gravada_em: null },
    { codigo: 'A', numero_na_serie: 1, gravada_em: '2026-08-05T10:00:00Z' },
    { codigo: 'C', numero_na_serie: 3, gravada_em: null },
  ]
  assert.equal(proximaPorGravar(pecas).codigo, 'B')
})

test('proximaPorGravar: lote inteiro gravado devolve nulo', () => {
  assert.equal(proximaPorGravar([{ codigo: 'A', numero_na_serie: 1, gravada_em: 'x' }]), null)
})

test('linhasDoCsv: cabecalho + uma linha por registro', () => {
  const csv = linhasDoCsv([{
    codigo: 'K7M4X9QP2R', nome: 'Ana', whatsapp: '19998887766',
    onde_comprou: 'Loja Tivoli', comprado_em: '2026-08-01', garantia_ate: '2028-08-01',
  }])
  const linhas = csv.split('\n')
  assert.equal(linhas[0], 'codigo;nome;whatsapp;onde comprou;comprado em;garantia ate')
  assert.equal(linhas[1], 'K7M4X9QP2R;Ana;19998887766;Loja Tivoli;2026-08-01;2028-08-01')
})

test('linhasDoCsv: ponto-e-virgula no texto nao quebra a coluna', () => {
  // "Ana; Maria" sem aspas viraria DUAS colunas e desalinharia a planilha toda
  const csv = linhasDoCsv([{ codigo: 'A', nome: 'Ana; Maria', whatsapp: '1' }])
  assert.equal(csv.split('\n')[1], 'A;"Ana; Maria";1;;;')
})

test('linhasDoCsv: aspas dentro do texto sao escapadas', () => {
  const csv = linhasDoCsv([{ codigo: 'A', nome: 'Ana "Aninha"', whatsapp: '1' }])
  assert.equal(csv.split('\n')[1], 'A;"Ana ""Aninha""";1;;;')
})

test('resumoDeAlertas: sem nada suspeito, diz que esta limpo', () => {
  assert.equal(resumoDeAlertas({ repetidas: [], invalidas: [] }).limpo, true)
})

test('resumoDeAlertas: conta os dois tipos', () => {
  const r = resumoDeAlertas({ repetidas: [{ codigo: 'A' }], invalidas: [{ codigo: 'B' }, { codigo: 'C' }] })
  assert.deepEqual({ limpo: r.limpo, repetidas: r.repetidas, invalidas: r.invalidas },
    { limpo: false, repetidas: 1, invalidas: 2 })
})

test('resumoDeAlertas: resposta vazia do banco nao quebra a tela', () => {
  assert.equal(resumoDeAlertas(null).limpo, true)
  assert.equal(resumoDeAlertas({}).limpo, true)
})

test('proximaPorGravar: peca BAIXADA sai da fila', () => {
  // sem isto a tela mandaria alguem gravar a etiqueta de uma peca dada como
  // refugo — e a etiqueta ia para dentro de uma bolsa que nao deveria existir
  const pecas = [
    { codigo: 'A', numero_na_serie: 1, gravada_em: null, baixada: true },
    { codigo: 'B', numero_na_serie: 2, gravada_em: null },
  ]
  assert.equal(proximaPorGravar(pecas).codigo, 'B')
})

test('proximaPorGravar: lote so com baixadas devolve nulo', () => {
  assert.equal(proximaPorGravar([{ codigo: 'A', gravada_em: null, baixada: true }]), null)
})

test('progressoDoLote: peca baixada nao entra na conta', () => {
  // se entrasse no total, o lote NUNCA fecharia: ficaria "2 de 3" para sempre
  const pecas = [
    { gravada_em: '2026-08-30T10:00:00Z' },
    { gravada_em: '2026-08-30T10:01:00Z' },
    { gravada_em: null, baixada: true },
  ]
  assert.deepEqual(progressoDoLote(pecas), { gravadas: 2, total: 2, texto: '2 de 2' })
})

test('progressoDoLote: peca GRAVADA e depois baixada tambem sai dos dois numeros', () => {
  const pecas = [
    { gravada_em: '2026-08-30T10:00:00Z' },
    { gravada_em: '2026-08-30T10:01:00Z', baixada: true },
  ]
  assert.deepEqual(progressoDoLote(pecas), { gravadas: 1, total: 1, texto: '1 de 1' })
})

/* A LISTA INTEIRA, e nao "contem tal chave".
 *
 * ESTA LISTA MORA EM TRES LUGARES e os tres precisam concordar:
 *   1. o `check (motivo in (...))` da coluna `vessel_baixas.motivo`;
 *   2. o `if ... not in (...)` de dentro de `vessel_baixar_peca` — e o de
 *      `vessel_sobrescrever_etiqueta`, que confere o motivo da baixa;
 *   3. `MOTIVOS_DE_BAIXA`, em `lotes.js`, que e o que a tela oferece.
 *
 * O `deepEqual` da lista inteira e de proposito: com um `includes`, acrescentar
 * um motivo aqui e esquecer do banco passaria verde, e a tela ofereceria uma
 * opcao que o banco recusa com `motivo_invalido`. Ficar vermelho e o aviso de
 * que os outros dois lugares tambem tem de ser conferidos. */
test('MOTIVOS_DE_BAIXA: a lista INTEIRA, na mesma ordem, com rotulo em portugues', () => {
  assert.deepEqual(MOTIVOS_DE_BAIXA.map((m) => m.chave),
    ['extraviada', 'defeito', 'devolvida', 'etiqueta_perdida', 'teste'])
  MOTIVOS_DE_BAIXA.forEach((m) => assert.ok(m.rotulo.length > 3))
})

test("MOTIVOS_DE_BAIXA: 'teste' tem rotulo proprio, e nao vira 'Defeito ou refugo'", () => {
  // a peca usada para testar a gravacao nunca vira bolsa. Baixando-a como
  // 'defeito', a contagem de refugo da producao mentiria.
  assert.equal(rotuloDoMotivo('teste'), 'Usada em teste')
  assert.notEqual(rotuloDoMotivo('teste'), rotuloDoMotivo('defeito'))
})

test('fraseDaRecusa: explica POR QUE, com o numero, em vez de "nao foi possivel"', () => {
  const f = fraseDaRecusa('tem_gravada', { gravadas: 7, total: 20 })
  assert.match(f, /7/)
  assert.match(f, /20/)
  assert.match(f, /baixa/i, 'tem de dizer o que fazer no lugar')
})

test('fraseDaRecusa: peca gravada manda dar baixa', () => {
  assert.match(fraseDaRecusa('esta_gravada', {}), /baixa/i)
})

test('fraseDaRecusa: abaixo do gravado diz qual e o minimo', () => {
  assert.match(fraseDaRecusa('abaixo_do_gravado', { gravadas: 7 }), /7/)
})

test('fraseDaRecusa: a garantia da cliente tem frase propria, e nao manda dar baixa', () => {
  // `gravada_em` nao era a unica prova de que a peca esta no mundo: a cliente
  // registra a garantia pelo CODIGO, sem a peca precisar estar gravada, e
  // `vessel_registros` cai por `on delete cascade` junto com a peca. Sem esta
  // frase, a recusa `tem_garantia` do banco caia no `default` e a pessoa lia
  // "Nao consegui fazer isso agora. Recarregue a tela" — que e mentira: a tela
  // recusou de proposito, para nao apagar a garantia de uma cliente.
  const f = fraseDaRecusa('tem_garantia', { garantias: 3, total: 20 })
  assert.match(f, /3/, 'tem de dizer QUANTAS')
  assert.match(f, /garantia/i)
  assert.match(f, /lote/i, 'no lote, a frase diz que as pecas sao deste lote')
  assert.doesNotMatch(f, /d[eê] baixa/i,
    'aqui nao ha conselho a dar: a garantia e de uma pessoa de verdade')
})

test('fraseDaRecusa: a mesma recusa numa peca sozinha nao fala em lote', () => {
  // vessel_excluir_peca devolve so `garantias: 1`, sem `total`. Dizer "deste
  // lote" ao excluir UMA peca seria mentira pequena, e a tela nao mente.
  const f = fraseDaRecusa('tem_garantia', { garantias: 1 })
  assert.match(f, /garantia/i)
  assert.doesNotMatch(f, /lote/i)
})

test('fraseDaRecusa: motivo desconhecido nao vira frase vazia', () => {
  const f = fraseDaRecusa('coisa_estranha', {})
  assert.ok(f.length > 15, 'sempre tem de sobrar alguma coisa legivel na tela')
})

test('resumoDeAlertas: peca baixada que foi LIDA nao deixa o selo dizer "limpo"', () => {
  // o alerta mais importante do projeto: a bolsa foi dada como extraviada e
  // alguem encostou o celular nela depois disso. Se nao contasse aqui, a aba
  // diria "nada suspeito" com uma bolsa extraviada reaparecendo no mundo.
  const r = resumoDeAlertas({
    repetidas: [], invalidas: [],
    baixadas_lidas: [{ codigo: 'A', motivo: 'extraviada', leituras: 3, ultima: '2026-08-29T10:00:00Z' }],
  })
  assert.equal(r.limpo, false)
  assert.equal(r.baixadasLidas, 1)
})

test('resumoDeAlertas: sem baixada lida, a conta e zero e o selo continua limpo', () => {
  const r = resumoDeAlertas({ repetidas: [], invalidas: [], baixadas_lidas: [] })
  assert.equal(r.baixadasLidas, 0)
  assert.equal(r.limpo, true)
})

test('resumoDeAlertas: banco velho, sem baixadas_lidas, nao quebra a tela', () => {
  // o campo chega da RPC: enquanto ela nao for atualizada, a chave nem existe
  assert.equal(resumoDeAlertas({ repetidas: [], invalidas: [] }).baixadasLidas, 0)
  assert.equal(resumoDeAlertas(null).baixadasLidas, 0)
})

// ── A LISTA INTEIRA DO LOTE ────────────────────────────────────────────────
// Depois de gravar e costurar, ninguem conseguia responder "qual link ficou na
// bolsa no 7": o unico codigo visivel na tela era o da PROXIMA peca da fila.

test('rotuloDoMotivo: a chave do banco vira a frase que a pessoa le', () => {
  assert.equal(rotuloDoMotivo('etiqueta_perdida'), 'Etiqueta perdida ou danificada')
})

test('rotuloDoMotivo: chave desconhecida nao vira vazio na tela', () => {
  // motivo novo no banco e rotulo velho na tela: melhor mostrar a chave crua
  // do que uma celula em branco, que se le como "nao tem motivo"
  assert.equal(rotuloDoMotivo('chave_que_ninguem_conhece'), 'chave_que_ninguem_conhece')
  assert.equal(rotuloDoMotivo(null), '—')
})

test('pecasEmOrdem: ordena pela serie, que e por onde se procura', () => {
  const pecas = [{ numero_na_serie: 3 }, { numero_na_serie: 1 }, { numero_na_serie: 2 }]
  assert.deepEqual(pecasEmOrdem(pecas).map((p) => p.numero_na_serie), [1, 2, 3])
})

test('pecasEmOrdem: NAO mexe na lista que a tela esta desenhando', () => {
  // `sort` ordena NO LUGAR. Sem o `slice()`, esta funcao reordenaria o array do
  // Vue por baixo da tela — e a lista de cima trocaria de ordem sozinha.
  const pecas = [{ numero_na_serie: 3 }, { numero_na_serie: 1 }]
  pecasEmOrdem(pecas)
  assert.deepEqual(pecas.map((p) => p.numero_na_serie), [3, 1])
})

test('pecasEmOrdem: sem peca nenhuma nao estoura', () => {
  assert.deepEqual(pecasEmOrdem(null), [])
  assert.deepEqual(pecasEmOrdem(undefined), [])
})

test('estadoDaPeca: os tres estados, cada um com o seu selo', () => {
  assert.equal(estadoDaPeca({}).chave, 'pendente')
  assert.equal(estadoDaPeca({}).selo, 'selo-neutro')
  assert.equal(estadoDaPeca({ gravada_em: '2026-08-05T10:00:00Z' }).chave, 'gravada')
  assert.equal(estadoDaPeca({ gravada_em: '2026-08-05T10:00:00Z' }).selo, 'selo-ok')
  assert.equal(estadoDaPeca({ baixada: true }).chave, 'baixada')
  assert.equal(estadoDaPeca({ baixada: true }).selo, 'selo-atencao')
})

test('estadoDaPeca: peca GRAVADA e depois baixada aparece como BAIXADA', () => {
  // a baixa e a ultima coisa que aconteceu com a peca. Dizendo "gravada",
  // alguem iria procurar o link dentro de uma bolsa dada como refugo.
  const p = { gravada_em: '2026-08-05T10:00:00Z', baixada: true, baixa_motivo: 'defeito' }
  assert.equal(estadoDaPeca(p).chave, 'baixada')
})

test('estadoDaPeca: sem peca nenhuma nao estoura', () => {
  assert.equal(estadoDaPeca(null).chave, 'pendente')
})

test('linhasDaListaDoLote: cabecalho + uma linha por peca, na ordem da serie', () => {
  const csv = linhasDaListaDoLote([
    { codigo: 'BBB222', numero_na_serie: 2, gravada_em: null },
    { codigo: 'AAA111', numero_na_serie: 1, gravada_em: '2026-08-05T10:00:00Z' },
  ], { formatarData: () => '05/08/2026', sku: 'H0015S' })
  const linhas = csv.split('\n')
  assert.equal(linhas[0], 'numero de serie;numero;codigo;endereco;estado;gravada em;motivo da baixa')
  assert.equal(linhas[1], 'H0015S001;1;AAA111;https://vesselbrasil.com.br/verify/AAA111;Gravada;05/08/2026;')
  assert.equal(linhas[2], 'H0015S002;2;BBB222;https://vesselbrasil.com.br/verify/BBB222;Pendente;;')
})

test('linhasDaListaDoLote: a baixada ENTRA na lista, com o motivo', () => {
  // esta e a diferenca inteira para `listaParaGravadorDeMesa`, que tira a
  // baixada da fila. Quem arquiva precisa saber o que aconteceu com o numero 3.
  const csv = linhasDaListaDoLote([
    { codigo: 'CCC333', numero_na_serie: 3, baixada: true, baixa_motivo: 'extraviada' },
  ])
  // sem `sku` a coluna do numero de serie sai VAZIA — lote sem referencia nao
  // tem numero de serie, e a planilha nao inventa um
  assert.equal(csv.split('\n')[1],
    ';3;CCC333;https://vesselbrasil.com.br/verify/CCC333;Baixada;;Extraviada')
})

test('linhasDaListaDoLote: a que FALTA tambem entra — a lista e INTEIRA', () => {
  const pecas = [
    { codigo: 'AAA111', numero_na_serie: 1, gravada_em: 'x' },
    { codigo: 'BBB222', numero_na_serie: 2 },
    { codigo: 'CCC333', numero_na_serie: 3, baixada: true, baixa_motivo: 'defeito' },
  ]
  assert.equal(linhasDaListaDoLote(pecas).split('\n').length, 4, 'cabecalho + as tres pecas')
})

test('linhasDaListaDoLote: lote vazio sai so com o cabecalho', () => {
  assert.equal(linhasDaListaDoLote([]),
    'numero de serie;numero;codigo;endereco;estado;gravada em;motivo da baixa')
  assert.equal(linhasDaListaDoLote(null).split('\n').length, 1)
})

test('linhasDaListaDoLote: o endereco NUNCA e escrito a mao', () => {
  // o dominio vai gravado dentro de um chip costurado numa bolsa, onde nao se
  // corrige. Ele nasce de `enderecoDaTag`, e este teste amarra os dois.
  const csv = linhasDaListaDoLote([{ codigo: 'k7m4x9', numero_na_serie: 1 }])
  assert.ok(csv.includes(enderecoDaTag('k7m4x9')))
  assert.ok(csv.includes('/verify/K7M4X9'), 'o codigo vai em MAIUSCULAS, como na etiqueta')
})

test('linhasDaListaDoLote: ponto-e-virgula no motivo nao quebra a coluna', () => {
  // Excel em portugues abre CSV por ponto-e-virgula: sem aspas, a planilha
  // inteira desalinha a partir dali
  const csv = linhasDaListaDoLote([
    { codigo: 'A1B2C3', numero_na_serie: 1, baixada: true, baixa_motivo: 'sumiu; voltou' },
  ])
  assert.ok(csv.includes('"sumiu; voltou"'))
})

/* ── A SENHA PEDIDA ANTES DE APAGAR ────────────────────────────────────────
 * Ela e FRICCAO, nao cofre: quem manda de verdade e o portao do banco. O que
 * estes testes seguram e a HONESTIDADE das frases — depois de digitar a senha
 * errada, a pessoa precisa saber que nada foi apagado, senao ela vai procurar o
 * lote que continua la achando que sumiu. */

test('fraseDaSenha: cada recusa da edge vira frase em portugues, sem codigo cru', () => {
  const codigos = ['senha_incorreta', 'bloqueado', 'sem_senha', 'sem_sessao', 'falha_interna']
  for (const c of codigos) {
    const f = fraseDaSenha(c)
    assert.ok(f.length > 20, `a frase de ${c} ficou curta demais para explicar`)
    assert.doesNotMatch(f, /_/, `a frase de ${c} vazou o codigo cru do banco`)
  }
})

test('fraseDaSenha: toda recusa diz que NADA foi apagado', () => {
  // esta e a parte que a pessoa precisa ler: sem ela, quem errou a senha fica
  // sem saber se o lote foi embora ou nao — e a tela nunca mente.
  for (const c of ['senha_incorreta', 'bloqueado', 'sem_sessao', 'falha_interna']) {
    assert.match(fraseDaSenha(c), /nada foi apagado/i, `a frase de ${c} nao diz o que sobrou`)
  }
})

test('fraseDaSenha: senha errada e bloqueio sao frases DIFERENTES', () => {
  // "bloqueado por dez minutos" lido como "senha incorreta" faz a pessoa tentar
  // sem parar, e cada tentativa estica o bloqueio
  assert.notEqual(fraseDaSenha('senha_incorreta'), fraseDaSenha('bloqueado'))
  assert.match(fraseDaSenha('bloqueado'), /dez minutos/)
})

test('fraseDaSenha: codigo desconhecido nao vira frase vazia', () => {
  assert.ok(fraseDaSenha('coisa_que_ninguem_conhece').length > 20)
  assert.ok(fraseDaSenha(undefined).length > 20)
})

/* ── EDITAR ETIQUETA JA GRAVADA ────────────────────────────────────────────
 * Do outro lado de cada uma destas contas ha uma etiqueta costurada dentro de
 * uma bolsa de couro, que nao se descose. */

test('fraseDaRecusa: TODA recusa das funcoes novas tem frase propria', () => {
  // a lista sai do contrato da migration 2026-09-01. Recusa que cai no
  // `default` faz a pessoa ler "Recarregue a tela e tente de novo" para um
  // problema que tem conserto conhecido — e ela recarrega a manha inteira.
  const doBanco = [
    'nao_esta_gravada', 'motivo_obrigatorio', 'motivo_invalido', 'destino_invalido',
    'mesma_peca', 'antiga_nao_existe', 'nova_nao_existe', 'antiga_nao_esta_gravada',
    'nova_ja_gravada',
  ]
  const generica = fraseDaRecusa('coisa_que_ninguem_conhece', {})
  const semFrase = doBanco.filter((m) => fraseDaRecusa(m, {}) === generica)
  assert.deepEqual(semFrase, [], 'caiu no default: ' + semFrase.join(', '))
})

test('fraseDaRecusa: motivo obrigatorio diz POR QUE, e fala da garantia', () => {
  const f = fraseDaRecusa('motivo_obrigatorio', {})
  assert.match(f, /garantia/i)
  assert.match(f, /motivo/i)
})

test('fraseDaRecusa: nova_ja_gravada explica o estrago e diz o caminho', () => {
  // este e o defeito que a funcao inteira veio impedir: o mesmo codigo em DUAS
  // etiquetas, em duas bolsas
  const f = fraseDaRecusa('nova_ja_gravada', {})
  assert.match(f, /DUAS bolsas/)
  assert.match(f, /Etiquetas/, 'tem de dizer ONDE se apaga a gravacao')
})

test('fraseDaRecusa: antiga_nao_esta_gravada manda gravar normalmente, sem sobrescrever', () => {
  assert.match(fraseDaRecusa('antiga_nao_esta_gravada', {}), /Gravar nesta etiqueta/)
})

test('codigosComGarantia: compara em MAIUSCULAS dos dois lados', () => {
  // o banco guarda em maiusculas, mas quem monta o conjunto e a tela: um
  // registro antigo em caixa baixa faria a peca de uma cliente aparecer SEM a
  // marca de garantia, e a tela deixaria apagar a gravacao dela sem motivo
  const com = codigosComGarantia([{ codigo: 'k7m4x9' }, { codigo: ' BBB222 ' }])
  assert.equal(com.has('K7M4X9'), true)
  assert.equal(com.has('BBB222'), true)
  assert.equal(com.size, 2)
})

test('codigosComGarantia: sem registro nenhum devolve conjunto vazio, sem estourar', () => {
  assert.equal(codigosComGarantia(null).size, 0)
  assert.equal(codigosComGarantia([{ codigo: null }, {}]).size, 0)
})

test('etiquetasGravadas: so as que TEM gravacao', () => {
  const pecas = [
    { codigo: 'A', gravada_em: '2026-09-01T10:00:00Z', numero_na_serie: 1 },
    { codigo: 'B', gravada_em: null, numero_na_serie: 2 },
  ]
  assert.deepEqual(etiquetasGravadas(pecas).map((p) => p.codigo), ['A'])
})

test('etiquetasGravadas: com lote escolhido, ordena pela SERIE', () => {
  // e assim que se procura a peca no 7 dentro de um lote de 50
  const pecas = [
    { codigo: 'C', lote_id: 'L1', numero_na_serie: 3, gravada_em: '2026-09-01T08:00:00Z' },
    { codigo: 'A', lote_id: 'L1', numero_na_serie: 1, gravada_em: '2026-09-01T10:00:00Z' },
    { codigo: 'Z', lote_id: 'L2', numero_na_serie: 1, gravada_em: '2026-09-01T11:00:00Z' },
  ]
  assert.deepEqual(etiquetasGravadas(pecas, 'L1').map((p) => p.codigo), ['A', 'C'])
})

test('etiquetasGravadas: sem filtro, a gravada mais RECENTE primeiro', () => {
  // quem abre a aba sem filtrar acabou de gravar errado e quer desfazer
  const pecas = [
    { codigo: 'VELHA', numero_na_serie: 1, gravada_em: '2026-08-01T10:00:00Z' },
    { codigo: 'NOVA', numero_na_serie: 9, gravada_em: '2026-09-01T10:00:00Z' },
  ]
  assert.deepEqual(etiquetasGravadas(pecas).map((p) => p.codigo), ['NOVA', 'VELHA'])
})

test('etiquetasGravadas: a BAIXADA continua na lista', () => {
  // ela pode ter sido gravada ANTES da baixa, e `vessel_desmarcar_gravada`
  // funciona nela. Tirando-a daqui, some justamente a peca baixada por engano
  // depois de gravada — que e o caso que a aba existe para consertar.
  const pecas = [{ codigo: 'A', numero_na_serie: 1, gravada_em: 'x', baixada: true }]
  assert.deepEqual(etiquetasGravadas(pecas).map((p) => p.codigo), ['A'])
})

test('etiquetasGravadas: NAO mexe na lista que a tela esta desenhando', () => {
  // `sort` ordena NO LUGAR — mesmo cuidado de `pecasEmOrdem`
  const pecas = [
    { codigo: 'B', lote_id: 'L1', numero_na_serie: 2, gravada_em: 'x' },
    { codigo: 'A', lote_id: 'L1', numero_na_serie: 1, gravada_em: 'x' },
  ]
  etiquetasGravadas(pecas, 'L1')
  assert.deepEqual(pecas.map((p) => p.codigo), ['B', 'A'])
})

test('etiquetasGravadas: sem peca nenhuma nao estoura', () => {
  assert.deepEqual(etiquetasGravadas(null), [])
  assert.deepEqual(etiquetasGravadas(undefined, 'L1'), [])
})

/* QUANDO O MOTIVO E OBRIGATORIO — a tela precisa saber ANTES do banco.
 * Deixando o banco dar a bronca, a pessoa aperta o botao, espera a rede e so
 * entao descobre que faltava um campo que estava na tela o tempo todo. */

test('motivoObrigatorio: peca COM garantia exige motivo escrito', () => {
  assert.equal(motivoObrigatorio({ temGarantia: true }), true)
  assert.equal(motivoObrigatorio({ temGarantia: true, destino: 'fila' }), true)
})

test('motivoObrigatorio: destino BAIXA exige motivo mesmo sem garantia', () => {
  // aqui o motivo nao e texto de auditoria: ele vai para `vessel_baixas.motivo`,
  // que tem `check`, e sem ele o banco recusa com `motivo_invalido`
  assert.equal(motivoObrigatorio({ temGarantia: false, destino: 'baixa' }), true)
})

test('motivoObrigatorio: peca sem garantia voltando para a fila NAO exige', () => {
  // desmarcar uma peca que ninguem registrou e conserto de bancada
  assert.equal(motivoObrigatorio({ temGarantia: false, destino: 'fila' }), false)
  assert.equal(motivoObrigatorio({ temGarantia: false }), false)
  assert.equal(motivoObrigatorio(), false)
})

/* QUAL PECA ESTA NESTA ETIQUETA. O codigo sozinho nao serve: quem esta com a
 * etiqueta na mao precisa saber QUAL BOLSA vai perder a identidade. */

test('descricaoDaPeca: modelo, cor e numero na serie, alem do codigo', () => {
  const f = descricaoDaPeca(
    { codigo: 'k7m4x9', numero_na_serie: 7 },
    { modelo: 'Monaco', cor: 'Quartz' },
  )
  assert.match(f, /Monaco/)
  assert.match(f, /Quartz/)
  assert.match(f, /nº 7/)
  assert.match(f, /K7M4X9/, 'o codigo vai em MAIUSCULAS, como na etiqueta')
})

test('descricaoDaPeca: o que falta simplesmente nao entra', () => {
  // "undefined" no lugar da cor se le como se fosse o nome dela, e um pedaco
  // vazio deixa dois separadores colados ("Monaco ·  · no 2")
  const f = descricaoDaPeca({ codigo: 'AAA111', numero_na_serie: 2 }, { modelo: 'Monaco' })
  assert.doesNotMatch(f, /undefined|null|· ·/)
  assert.equal(f, 'Monaco · nº 2 — AAA111')
})

test('descricaoDaPeca: peca que a tela nao conhece diz a verdade inteira', () => {
  // nunca inventar modelo: dizer o codigo e dizer que o lote nao foi achado
  const f = descricaoDaPeca({ codigo: 'ZZZ999' }, null)
  assert.match(f, /ZZZ999/)
  assert.match(f, /não achei o lote/i)
})

test('descricaoDaPeca: sem peca nenhuma nao estoura nem inventa', () => {
  assert.equal(descricaoDaPeca(null, null), 'peça desconhecida')
})

// ── ENCERRAR GARANTIA: POR QUE ─────────────────────────────────────────────
// A tela oferecia so um campo em branco, e o dono pediu motivos prontos. Estes
// testes travam a lista e, principalmente, o TEXTO QUE VAI PARAR NO HISTORICO:
// e ele que alguem vai ler daqui a meses para entender a decisao.

test('MOTIVOS_DE_DEVOLUCAO: a lista INTEIRA, na ordem, com rotulo em portugues', () => {
  assert.deepEqual(MOTIVOS_DE_DEVOLUCAO.map((m) => m.chave), [
    'devolucao_arrependimento', 'devolucao_defeito', 'troca_por_outra',
    'compra_cancelada', 'registro_errado', 'outro',
  ])
  for (const m of MOTIVOS_DE_DEVOLUCAO) {
    assert.ok(m.rotulo && m.rotulo.length > 3, `sem rotulo legivel: ${m.chave}`)
  }
})

test('MOTIVOS_DE_DEVOLUCAO: "outro" e o ULTIMO, porque e o escape da lista', () => {
  assert.equal(MOTIVOS_DE_DEVOLUCAO[MOTIVOS_DE_DEVOLUCAO.length - 1].chave, 'outro')
})

test('MOTIVOS_DE_DEVOLUCAO: nao repete as chaves da baixa de PECA', () => {
  // Duas listas com a mesma chave significando coisas diferentes e a receita
  // para o historico contar a historia errada.
  const daPeca = new Set(MOTIVOS_DE_BAIXA.map((m) => m.chave))
  for (const m of MOTIVOS_DE_DEVOLUCAO) {
    assert.ok(!daPeca.has(m.chave), `chave repetida nas duas listas: ${m.chave}`)
  }
})

test('motivoDaDevolucaoEscrito: escolha da lista vira a frase da lista', () => {
  assert.equal(motivoDaDevolucaoEscrito('devolucao_defeito'),
    'Devolução — defeito na peça')
})

test('motivoDaDevolucaoEscrito: escolha da lista MAIS observacao junta as duas', () => {
  assert.equal(motivoDaDevolucaoEscrito('devolucao_defeito', 'alça descosturada'),
    'Devolução — defeito na peça — alça descosturada')
})

test('motivoDaDevolucaoEscrito: "outro" guarda o que a pessoa escreveu, nao a palavra outro', () => {
  assert.equal(motivoDaDevolucaoEscrito('outro', 'cliente mudou de endereço'),
    'cliente mudou de endereço')
  // e sem nada escrito nao inventa texto: fica vazio, e a tela cobra.
  assert.equal(motivoDaDevolucaoEscrito('outro', '   '), '')
})

test('motivoDaDevolucaoEscrito: espaco em volta nao entra no historico', () => {
  assert.equal(motivoDaDevolucaoEscrito('outro', '  peça trocada  '), 'peça trocada')
})
