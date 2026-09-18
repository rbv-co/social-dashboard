import test from 'node:test'
import assert from 'node:assert/strict'
import { classificarMaterial } from './material-do-produto.js'

// ── OS TRÊS EXEMPLOS REAIS DO DONO ─────────────────────────────────────────
// Nomes e NCM medidos de verdade no Bling em 18/09/2026 (GET /produtos/{id}),
// para os três produtos citados na decisão. Não são exemplos inventados.

test('Cyrène Café (SS0002SB.M1): lona + camurça + couro na mesma estrutura — a regra não sabe qual está por fora, e diz isso', () => {
  // Por fora, esta bolsa É camurça — mas nenhum nome de insumo diz "este é o
  // de fora". "LONA AMERICA CAFE" bate canvas; "CAMURCA CAFE (DUPLA)" e
  // "MundoCamurca - Couro - Bristol nozes" batem couro. Chutar "couro" aqui
  // por já ter dois candidatos seria acertar por sorte, não concluir com
  // segurança — por isso o resultado HONESTO é ambíguo.
  const r = classificarMaterial({
    componentes: [
      'FIM250-9 9K ESCOV COMPLETO',
      'Reginato - Corrente Escovado 9K - Elo 8,8X12,6 / Esp.2,5mm - CA4015-1',
      'Reginato - Argola Escovado 9K - Abertura 22mm - AR2240-2N',
      'Ponteira de Ziper - Mostruario',
      'Reginato - Puxador Vessel Escovado 9K - XI26-8',
      'Ziper Metal - 570 Café/Marrom',
      'Reginato - Letreiro Vessel Ouro 9K - EI7026-31',
      'Retalho - York - Diversos',
      'LONA AMERICA CAFE',
      'Artedur - Sh 7007/2 - Magma',
      'Cartolina Grossa',
      'GUTTAFORRO 70015 AC BRANCO C/C OC CLARA',
      'CAMURCA CAFE (DUPLA)',
      'NEW SLIM CORES',
      'FQ 16923 - AGEN PRIMER',
      'FastQuimica - Resina Top Fosco - FQ 12878',
      'FQ 19168 - LEON PAINT NOZES',
      'FQ 19170 - LEON PAINT MARRON',
      'MundoCamurca - Couro - Bristol nozes',
      'Hot Stamping - Fita Carimbo Ouro Claro - 40mm',
      'Hot Stamping - Fita Carimbo Transparente - 40mm',
      'NFC',
      'Linha Poliamida - NZ-60/80g - Café 29 - Linhasita',
      'Linha Poliamida - NZ-40/80g - Café 29 - Linhasita',
    ],
    ncm: '4202.32.00',
  })
  assert.equal(r.material, null)
  assert.equal(r.ambiguo, true)
  assert.deepEqual(r.evidencia, ['CAMURCA CAFE (DUPLA)', 'MundoCamurca - Couro - Bristol nozes', 'LONA AMERICA CAFE'])
})

test('Astrea Bordô (SS0001EW.B3): recouro + napa sintética de um lado, couro do outro — mesma forma de ambiguidade da Cyrène', () => {
  // "Recouro" e "Napa Fly" são sintéticos (regra 3: contam como canvas);
  // "MundoCamurca - Couro - Bristol nozes" bate couro. A ferragem Reginato
  // inteira é ignorada (botão, ímã, puxador, placa, pé de bolsa não bate
  // nenhum dos dois grupos). Dois grupos com candidato → ambíguo, pela mesma
  // razão da Cyrène: nome nenhum diz qual componente é a pele de fora.
  const r = classificarMaterial({
    componentes: [
      'Reginato -  Botao Pressao SS Escovado 9K - EI6026-39',
      'Reginato - Puxador Vessel Escovado 9K - XI26-8',
      'Botão  ima invisível 15MM',
      'Botão  ima invisível 10MM',
      'Reginato - Pe de Bolsa Escovado 9K - EI4026-7',
      'Reginato - Placa Vessel Brasil Escovado 9K - 40mmX24mm - KI5026-12',
      'Termoplastico - Magma',
      'Artedur - Sh 7007/2 - Magma',
      'Recouro - Tex Braz - Natural 0,5',
      'Placa De Eva Impregnado - 2mm',
      'Cartolina Grossa',
      'NAPA FLY VINHO',
      'FQ 16923 - AGEN PRIMER',
      'FastQuimica - Resina Top Fosco - FQ 12878',
      'FQ 19168 - LEON PAINT NOZES',
      'FQ 19165 - LEON PAINT BORDO',
      'MundoCamurca - Couro - Bristol nozes',
      'Hot Stamping - Fita Carimbo Ouro Claro - 40mm',
      'Hot Stamping - Fita Carimbo Transparente - 40mm',
      'NFC',
      'Linha Poliamida - NZ-40/80g - Merlot 60 - Linhasita',
      'Linha Poliamida - NZ-60/80g - Merlot 60 - Linhasita',
      'Ziper Metal - 048 Vinho',
      '6,00MM- C. NITRILICO PRETO TOL. +- 0,5',
    ],
    ncm: '4202.32.00',
  })
  assert.equal(r.material, null)
  assert.equal(r.ambiguo, true)
  assert.deepEqual(r.evidencia, ['MundoCamurca - Couro - Bristol nozes', 'Recouro - Tex Braz - Natural 0,5', 'NAPA FLY VINHO'])
})

test('Bath Mostarda (SS1088-Mostarda): forro de suede e reforço de nylon NÃO contam — só o tecido de fora sobra, e a regra conclui canvas', () => {
  // "Forro Suede - Vermelho" tem "suede" no nome (bateria couro), mas é FORRO
  // — fica dentro, nunca decide. "Reforco Nylon 600" tem "nylon" (bateria
  // canvas), mas é reforço — mesma exclusão. Sobra só "York Tecidos -
  // Detroid mostarda", que é o tecido de fora: único candidato, sem ambiguidade.
  const r = classificarMaterial({
    componentes: [
      'Forro Suede - Vermelho - Eurobraz',
      'Rebite personalizado n° 4 - IC2.110.110.F  - Eberle',
      'Botão de Pressão BT7 - BT7.130.80.6.CM.F  - Eberle',
      'Botão Imã - 10280-G - Altero',
      'Artedur - Sh 7007/2 - Magma',
      'Fivela - 16198 - Reginato',
      'Grampo - 0.7cm - Okero',
      'INSUMOS DE PRODUCAO - BOLSAS',
      'Placa Retangular Grande - 12822 - 6.0x1.5cm - Fatobene',
      'Placa De Eva Impregnado - 2mm',
      'Placa De Papelão - Lema Plast',
      'Porta Alça Ouro - 39803 - 2cm - Reginato',
      'Puxador Personalizado - Fatobene',
      'York Tecidos - Detroid mostarda - 2521',
      'Ziper Merlot - Sancris',
      'Reforco Nylon 600 - LemaPlast - Bege',
    ],
    ncm: '4202.32.00',
  })
  assert.deepEqual(r, {
    material: 'canvas',
    ambiguo: false,
    evidencia: ['York Tecidos - Detroid mostarda - 2521'],
    motivo: 'componente(s) de canvas/sintético na estrutura, sem nenhum candidato a couro: York Tecidos - Detroid mostarda - 2521.',
  })
})

// ── CASOS DE BORDA ──────────────────────────────────────────────────────────

test('só candidato de couro: conclui couro sem precisar do NCM', () => {
  const r = classificarMaterial({ componentes: ['Vaqueta Natural', 'Ziper Metal Preto'], ncm: '4202.21.00' })
  assert.equal(r.material, 'couro')
  assert.equal(r.ambiguo, false)
  assert.deepEqual(r.evidencia, ['Vaqueta Natural'])
})

test('só candidato de canvas: conclui canvas', () => {
  const r = classificarMaterial({ componentes: ['Lona Impermeável Azul', 'Linha Poliéster'], ncm: '' })
  assert.equal(r.material, 'canvas')
  assert.equal(r.ambiguo, false)
})

test('camurça conta como couro (regra 2 do dono)', () => {
  const r = classificarMaterial({ componentes: ['Camurça Bege Dupla Face'] })
  assert.equal(r.material, 'couro')
})

test('sintéticos contam como canvas (regra 3 do dono): PU, laminado e "sintético" isolado', () => {
  assert.equal(classificarMaterial({ componentes: ['PU Preto Fosco'] }).material, 'canvas')
  assert.equal(classificarMaterial({ componentes: ['Material Laminado Off White'] }).material, 'canvas')
  assert.equal(classificarMaterial({ componentes: ['Sintético Estampado'] }).material, 'canvas')
})

test('"PU" isolado bate canvas, mas encaixado dentro de outra palavra não confunde', () => {
  assert.equal(classificarMaterial({ componentes: ['Alça PU Preta'] }).material, 'canvas')
  // "reputado" tem "pu" no meio, mas não é a palavra "PU" — \bpu\b não bate.
  const semFalsoPositivo = classificarMaterial({ componentes: ['Suporte Reputado Cinza'] })
  assert.equal(semFalsoPositivo.material, null)
  assert.equal(semFalsoPositivo.ambiguo, true)
  assert.deepEqual(semFalsoPositivo.evidencia, [])
})

test('nenhum componente reconhecido pelo nome, mas o NCM desempata (canvas)', () => {
  const r = classificarMaterial({ componentes: ['Artedur - Sh 7007/2 - Magma', 'NFC'], ncm: '4202.32.00' })
  assert.equal(r.material, 'canvas')
  assert.equal(r.ambiguo, false)
  assert.deepEqual(r.evidencia, ['NCM 4202.32.00'])
})

test('nenhum componente reconhecido pelo nome, e o NCM também não ajuda: ambíguo de verdade', () => {
  const r = classificarMaterial({ componentes: ['Artedur - Sh 7007/2 - Magma'], ncm: '9999.99.99' })
  assert.equal(r.material, null)
  assert.equal(r.ambiguo, true)
  assert.deepEqual(r.evidencia, [])
})

test('estrutura vazia e sem NCM: ambíguo, nunca chuta', () => {
  const r = classificarMaterial({ componentes: [], ncm: '' })
  assert.equal(r.material, null)
  assert.equal(r.ambiguo, true)
})

test('entrada nula não derruba a função', () => {
  assert.doesNotThrow(() => classificarMaterial({}))
  assert.doesNotThrow(() => classificarMaterial())
})

test('NCM nunca sobrescreve a estrutura quando ela já decidiu algo (mesmo se o NCM discordar)', () => {
  // Estrutura só tem candidato de couro; NCM aponta pra 4202.32 (canvas). A
  // estrutura manda — o NCM é ignorado, porque "nunca é fonte única CONTRA a
  // estrutura".
  const r = classificarMaterial({ componentes: ['Couro Legítimo Marrom'], ncm: '4202.32.00' })
  assert.equal(r.material, 'couro')
  assert.equal(r.ambiguo, false)
})

test('forro de couro não conta, mesmo sendo a única menção a couro na estrutura', () => {
  const r = classificarMaterial({ componentes: ['Forro de Couro Sintético Preto', 'York Tecidos Azul'] })
  assert.equal(r.material, 'canvas')
  assert.deepEqual(r.evidencia, ['York Tecidos Azul'])
})

test('reforço de couro não conta', () => {
  const r = classificarMaterial({ componentes: ['Reforço de Couro na Base', 'Lona Bege'] })
  assert.equal(r.material, 'canvas')
})
