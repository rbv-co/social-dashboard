import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  posseAberta, passarPara, quemEstavaCom, abrirPossesQueFaltam,
  quemEstaComOCarro, trocarDonoFixo, quemDeveConferir } from './posse.js'

const AGORA = '2026-08-05T12:00:00.000Z'

test('a posse aberta de um carro é a linha de posse sem volta', () => {
  const usos = [
    { id: 'u1', veiculo_id: 'v1', tipo: 'posse', pessoa_id: 'p1', saida_em: '2026-08-01T00:00:00Z', volta_em: null },
    { id: 'u2', veiculo_id: 'v1', tipo: 'viagem', pessoa_id: 'p2', saida_em: '2026-08-04T00:00:00Z', volta_em: null },
  ]
  assert.equal(posseAberta(usos, 'v1').id, 'u1')
  assert.equal(posseAberta(usos, 'v9'), null)
})

test('passar o carro fecha a posse de quem estava e abre a de quem pegou', () => {
  const usos = [{ id: 'u1', veiculo_id: 'v1', tipo: 'posse', pessoa_id: 'p1', saida_em: '2026-08-01T00:00:00Z', volta_em: null }]
  const r = passarPara({ usos, veiculoId: 'v1', para: { id: 'p2', nome: 'Marcus' }, quando: AGORA })
  assert.deepEqual(r.fechar, { id: 'u1', volta_em: AGORA })
  assert.equal(r.abrir.pessoa_id, 'p2')
  assert.equal(r.abrir.pessoa_nome, 'Marcus')
  assert.equal(r.abrir.tipo, 'posse')
  assert.equal(r.abrir.volta_em, undefined)
})

test('devolver sem dono fixo (carro de rodízio): só fecha, não abre nada', () => {
  const usos = [{ id: 'u1', veiculo_id: 'v1', tipo: 'posse', pessoa_id: 'p2', saida_em: '2026-08-01T00:00:00Z', volta_em: null }]
  const r = passarPara({ usos, veiculoId: 'v1', para: null, donoFixo: null, quando: AGORA })
  assert.deepEqual(r.fechar, { id: 'u1', volta_em: AGORA })
  assert.equal(r.abrir, null)
})

test('devolver COM dono fixo: fecha a do emprestado e reabre a dele, no mesmo instante — sem buraco', () => {
  // Era o bug relatado: sem reabrir, quemEstavaCom() passava a devolver
  // "não sei" pro período depois da devolução, mesmo o dono fixo estando com
  // o carro de verdade. A multa que chegasse com data desse intervalo ficava
  // sem resposta.
  const usos = [{ id: 'u1', veiculo_id: 'v1', tipo: 'posse', pessoa_id: 'p2', pessoa_nome: 'Barbara', saida_em: '2026-08-01T00:00:00Z', volta_em: null }]
  const r = passarPara({ usos, veiculoId: 'v1', para: null, donoFixo: { id: 'p1', nome: 'Marcus' }, quando: AGORA })
  assert.deepEqual(r.fechar, { id: 'u1', volta_em: AGORA })
  assert.equal(r.abrir.pessoa_id, 'p1')
  assert.equal(r.abrir.pessoa_nome, 'Marcus')
  assert.equal(r.abrir.tipo, 'posse')
  // Mesmo instante do fechamento: nenhum intervalo sem posse no meio.
  assert.equal(r.abrir.saida_em, AGORA)
})

test('devolver com dono fixo fecha a linha do tempo sem buraco de verdade: quemEstavaCom acha alguém logo depois', () => {
  const usos = [{ id: 'u1', veiculo_id: 'v1', tipo: 'posse', pessoa_id: 'p2', pessoa_nome: 'Barbara', saida_em: '2026-08-01T00:00:00Z', volta_em: null }]
  const { fechar, abrir } = passarPara({ usos, veiculoId: 'v1', para: null, donoFixo: { id: 'p1', nome: 'Marcus' }, quando: AGORA })
  const depoisDaDevolucao = [
    { ...usos[0], volta_em: fechar.volta_em },
    abrir,
  ]
  const umSegundoDepois = '2026-08-05T12:00:01.000Z'
  assert.equal(quemEstavaCom(depoisDaDevolucao, 'v1', umSegundoDepois).pessoa_nome, 'Marcus')
})

test('carro que nunca teve posse só abre, sem fechar nada', () => {
  const r = passarPara({ usos: [], veiculoId: 'v1', para: { id: 'p1', nome: 'Humberto' }, quando: AGORA })
  assert.equal(r.fechar, null)
  assert.equal(r.abrir.pessoa_id, 'p1')
})

/* ── A pergunta que a multa faz ──────────────────────────────────────────── */

const LINHA_DO_TEMPO = [
  { id: 'a', veiculo_id: 'v1', tipo: 'posse',  pessoa_id: 'p1', pessoa_nome: 'Humberto',
    saida_em: '2026-08-01T00:00:00Z', volta_em: '2026-08-10T00:00:00Z' },
  { id: 'b', veiculo_id: 'v1', tipo: 'posse',  pessoa_id: 'p2', pessoa_nome: 'Marcus',
    saida_em: '2026-08-10T00:00:00Z', volta_em: null },
  { id: 'c', veiculo_id: 'v1', tipo: 'viagem', pessoa_id: 'p3', pessoa_nome: 'Barbara',
    saida_em: '2026-08-14T08:00:00Z', volta_em: '2026-08-14T18:00:00Z' },
]

test('quem estava com o carro numa data', () => {
  assert.equal(quemEstavaCom(LINHA_DO_TEMPO, 'v1', '2026-08-05T10:00:00Z').pessoa_nome, 'Humberto')
  assert.equal(quemEstavaCom(LINHA_DO_TEMPO, 'v1', '2026-08-12T10:00:00Z').pessoa_nome, 'Marcus')
})

test('viagem vence posse: quem pegou emprestado é quem estava dirigindo', () => {
  // É a resposta que a multa precisa. A multa de 14/08 às 15h40 é da Barbara,
  // que pegou o carro emprestado, não do Marcus, que é o dono.
  assert.equal(quemEstavaCom(LINHA_DO_TEMPO, 'v1', '2026-08-14T15:40:00Z').pessoa_nome, 'Barbara')
})

test('antes de existir registro, a resposta é NÃO SEI — nunca um chute', () => {
  // Acusar alguém com dado inventado é pior do que não responder.
  assert.equal(quemEstavaCom(LINHA_DO_TEMPO, 'v1', '2026-07-20T10:00:00Z'), null)
  assert.equal(quemEstavaCom([], 'v1', '2026-08-05T10:00:00Z'), null)
})

/* ── IMPORTANTE 1: instante de verdade, não texto ────────────────────────── */

test('o mesmo instante escrito de dois jeitos dá a mesma resposta', () => {
  // O Postgres devolve timestamptz como '+00:00' e sem milissegundos quando
  // são zero; o app grava com toISOString() ('.000Z'). Comparando como TEXTO,
  // '15:40:00.500Z' perde de '15:40:00Z' — o ponto vem antes do Z na tabela
  // de caracteres — mesmo sendo o instante mais tarde. Isto prova que a
  // comparação agora é por data de verdade.
  const usos = [
    { id: 'z', veiculo_id: 'v1', tipo: 'posse', pessoa_id: 'p1', pessoa_nome: 'Humberto',
      saida_em: '2026-08-14T00:00:00+00:00', volta_em: null },
  ]
  // saida_em em '+00:00' sem milissegundos; consultando em 'Z' com
  // milissegundos, no mesmo instante e um pouco depois.
  assert.equal(quemEstavaCom(usos, 'v1', '2026-08-14T00:00:00.000Z').pessoa_nome, 'Humberto')
  assert.equal(quemEstavaCom(usos, 'v1', '2026-08-14T15:40:00.500Z').pessoa_nome, 'Humberto')
  // E o caso que a comparação por texto errava: instante um pouco DEPOIS do
  // limite, escrito com milissegundos, tem que continuar valendo — não sumir
  // por causa do ponto antes do Z.
  const comLimite = [
    { id: 'y', veiculo_id: 'v2', tipo: 'posse', pessoa_id: 'p9', pessoa_nome: 'Raissa',
      saida_em: '2026-08-14T15:40:00Z', volta_em: null },
  ]
  assert.equal(quemEstavaCom(comLimite, 'v2', '2026-08-14T15:40:00.500Z').pessoa_nome, 'Raissa')
})

/* ── IMPORTANTE 2: duas viagens sobrepostas ──────────────────────────────── */

test('duas viagens valendo ao mesmo tempo: pega a de saída mais recente, e avisa que é ambíguo', () => {
  const usos = [
    { id: 'x', veiculo_id: 'v1', tipo: 'viagem', pessoa_id: 'p1', pessoa_nome: 'Thiago',
      saida_em: '2026-08-14T08:00:00Z', volta_em: '2026-08-14T20:00:00Z' },
    { id: 'y', veiculo_id: 'v1', tipo: 'viagem', pessoa_id: 'p2', pessoa_nome: 'Barbara',
      saida_em: '2026-08-14T10:00:00Z', volta_em: '2026-08-14T18:00:00Z' },
  ]
  const r = quemEstavaCom(usos, 'v1', '2026-08-14T15:00:00Z')
  assert.equal(r.pessoa_nome, 'Barbara')  // saiu por último das duas
  assert.equal(r.ambiguo, true)
})

test('uma viagem só, mesmo com posse valendo junto, não é ambíguo', () => {
  assert.equal(quemEstavaCom(LINHA_DO_TEMPO, 'v1', '2026-08-14T15:40:00Z').ambiguo, undefined)
})

/* ── A virada de chave ───────────────────────────────────────────────────── */

test('abre uma posse por carro com dono, e nenhuma pros de rodízio', () => {
  const veiculos = [
    { id: 'v1', pessoa_id: 'p1', situacao: 'ativo' },
    { id: 'v2', pessoa_id: null, situacao: 'ativo' },
    { id: 'v3', pessoa_id: 'p3', situacao: 'ativo' },
  ]
  const usos = [{ id: 'u1', veiculo_id: 'v1', tipo: 'posse', volta_em: null, saida_em: '2026-08-01T00:00:00Z' }]
  const novas = abrirPossesQueFaltam(veiculos, usos, AGORA)
  assert.equal(novas.length, 1)
  assert.equal(novas[0].veiculo_id, 'v3')
  assert.equal(novas[0].saida_em, AGORA)
})

/* ── D9b: a tela lê a posse ───────────────────────────────────────────────── */

test('quem está com o carro hoje: a posse aberta vence o dono fixo', () => {
  const veiculo = { id: 'v1', pessoa_id: 'p1', pessoa_nome: 'Marcus' }
  const usos = [{ id: 'u1', veiculo_id: 'v1', tipo: 'posse', pessoa_id: 'p2', pessoa_nome: 'Barbara', volta_em: null, saida_em: '2026-08-10T00:00:00Z' }]
  const r = quemEstaComOCarro(veiculo, usos)
  assert.deepEqual(r, { pessoaId: 'p2', pessoaNome: 'Barbara', porPosse: true })
})

test('sem posse aberta, quem está com o carro é o dono fixo', () => {
  const veiculo = { id: 'v1', pessoa_id: 'p1', pessoa_nome: 'Marcus' }
  const r = quemEstaComOCarro(veiculo, [])
  assert.deepEqual(r, { pessoaId: 'p1', pessoaNome: 'Marcus', porPosse: false })
})

test('sem posse e sem dono fixo, ninguém está com o carro', () => {
  const veiculo = { id: 'v2', pessoa_id: null, pessoa_nome: null }
  const r = quemEstaComOCarro(veiculo, [])
  assert.deepEqual(r, { pessoaId: null, pessoaNome: null, porPosse: false })
})

/* ── D9c: trocar o dono fixo não é emprestar ─────────────────────────────── */

test('nada muda: mesmo pessoa_id não mexe em posse nenhuma', () => {
  const usos = [{ id: 'u1', veiculo_id: 'v1', tipo: 'posse', pessoa_id: 'p1', volta_em: null, saida_em: '2026-08-01T00:00:00Z' }]
  const r = trocarDonoFixo({ usos, veiculoId: 'v1', deId: 'p1', paraId: 'p1', paraNome: 'Marcus', quando: AGORA })
  assert.deepEqual(r, { fechar: null, abrir: null })
})

test('trocar o dono com o carro na mão do dono: fecha a dele, abre a do novo', () => {
  const usos = [{ id: 'u1', veiculo_id: 'v1', tipo: 'posse', pessoa_id: 'p1', volta_em: null, saida_em: '2026-08-01T00:00:00Z' }]
  const r = trocarDonoFixo({ usos, veiculoId: 'v1', deId: 'p1', paraId: 'p2', paraNome: 'Thiago', quando: AGORA })
  assert.deepEqual(r.fechar, { id: 'u1', volta_em: AGORA })
  assert.equal(r.abrir.pessoa_id, 'p2')
  assert.equal(r.abrir.pessoa_nome, 'Thiago')
  assert.equal(r.abrir.tipo, 'posse')
})

test('trocar o dono com o carro emprestado a um terceiro: não mexe em nada', () => {
  // Se o carro está com a Barbara (terceira) e o dono fixo passa de Marcus
  // para Thiago, mexer na posse da Barbara diria que Thiago esteve com o
  // carro num dia em que nunca o viu.
  const usos = [{ id: 'u1', veiculo_id: 'v1', tipo: 'posse', pessoa_id: 'p3', pessoa_nome: 'Barbara', volta_em: null, saida_em: '2026-08-01T00:00:00Z' }]
  const r = trocarDonoFixo({ usos, veiculoId: 'v1', deId: 'p1', paraId: 'p2', paraNome: 'Thiago', quando: AGORA })
  assert.deepEqual(r, { fechar: null, abrir: null })
  // A posse da Barbara continua aberta e intacta.
  assert.equal(posseAberta(usos, 'v1').pessoa_id, 'p3')
})

test('tirar o dono fixo: fecha a posse aberta, não abre nenhuma', () => {
  const usos = [{ id: 'u1', veiculo_id: 'v1', tipo: 'posse', pessoa_id: 'p1', volta_em: null, saida_em: '2026-08-01T00:00:00Z' }]
  const r = trocarDonoFixo({ usos, veiculoId: 'v1', deId: 'p1', paraId: null, paraNome: null, quando: AGORA })
  assert.deepEqual(r.fechar, { id: 'u1', volta_em: AGORA })
  assert.equal(r.abrir, null)
})

test('tirar o dono fixo de um carro emprestado também fecha — nunca deixa posse órfã', () => {
  // Esta é a invariante do D9b: pessoa_id nulo com posse aberta faria o carro
  // aparecer livre pra qualquer um pegar mesmo estando com alguém.
  const usos = [{ id: 'u1', veiculo_id: 'v1', tipo: 'posse', pessoa_id: 'p3', volta_em: null, saida_em: '2026-08-01T00:00:00Z' }]
  const r = trocarDonoFixo({ usos, veiculoId: 'v1', deId: 'p1', paraId: null, paraNome: null, quando: AGORA })
  assert.deepEqual(r.fechar, { id: 'u1', volta_em: AGORA })
  assert.equal(r.abrir, null)
})

test('trocar dono num carro que nunca teve posse: só abre a do novo', () => {
  const r = trocarDonoFixo({ usos: [], veiculoId: 'v1', deId: 'p1', paraId: 'p2', paraNome: 'Raissa', quando: AGORA })
  assert.equal(r.fechar, null)
  assert.equal(r.abrir.pessoa_id, 'p2')
})

/* ── B2: posse sem nome gravado resgata pela lista de pessoas ───────────── */

test('posse sem nome gravado descobre o nome pelo identificador', () => {
  // O caso real: 5 das 8 posses abertas em 06/08 gravaram só o pessoa_id.
  // Sem isto, XC90, Porsche, Punto, Fiesta e XC60 aparecem sem ninguém.
  const veiculo = { id: 'v1', pessoa_id: 'p-humberto', pessoa_nome: 'Humberto Mendonça' }
  const usos = [{ veiculo_id: 'v1', tipo: 'posse', volta_em: null, pessoa_id: 'p-humberto', pessoa_nome: null }]
  const pessoas = [{ id: 'p-humberto', nome: 'Humberto Mendonça' }]
  const quem = quemEstaComOCarro(veiculo, usos, pessoas)
  assert.equal(quem.pessoaNome, 'Humberto Mendonça')
  assert.equal(quem.porPosse, true)
})

test('o nome GRAVADO na posse continua vencendo a lista de pessoas', () => {
  // A Bravo está com Gabriel por posse, e o dono fixo é o Erick. Deixar a lista
  // sobrescrever diria que o carro está com quem não está com ele.
  const veiculo = { id: 'v1', pessoa_id: 'p-erick', pessoa_nome: 'Erick Martins' }
  const usos = [{ veiculo_id: 'v1', tipo: 'posse', volta_em: null, pessoa_id: 'p-gabriel', pessoa_nome: 'Gabriel Alves' }]
  const pessoas = [{ id: 'p-gabriel', nome: 'Gabriel A. Silva' }]
  assert.equal(quemEstaComOCarro(veiculo, usos, pessoas).pessoaNome, 'Gabriel Alves')
})

test('sem a lista de pessoas, nada muda — a Edge chama com dois argumentos', () => {
  const veiculo = { id: 'v1', pessoa_id: 'p-a', pessoa_nome: 'Fulano' }
  const usos = [{ veiculo_id: 'v1', tipo: 'posse', volta_em: null, pessoa_id: 'p-a', pessoa_nome: null }]
  assert.equal(quemEstaComOCarro(veiculo, usos).pessoaNome, null)
})

test('posse com pessoa_id que não está na lista não inventa nome', () => {
  const veiculo = { id: 'v1', pessoa_id: 'p-a', pessoa_nome: 'Fulano' }
  const usos = [{ veiculo_id: 'v1', tipo: 'posse', volta_em: null, pessoa_id: 'p-sumiu', pessoa_nome: null }]
  assert.equal(quemEstaComOCarro(veiculo, usos, [{ id: 'p-a', nome: 'Fulano' }]).pessoaNome, null)
})

/* ── Passar o carro pra quem já está com ele não é evento nenhum ───────────
 * Achado na revisão da Fase B: confirmar a opção padrão num carro cuja posse
 * aberta JÁ é a do dono fixo fechava e reabria a posse da mesma pessoa,
 * escrevendo na linha do tempo uma transferência que nunca aconteceu. */

test('passar para quem JÁ está com o carro não mexe em nada', () => {
  const dono = { id: 'p1', nome: 'Humberto' };
  const usos = [{ id: 'u1', veiculo_id: 'v1', tipo: 'posse', volta_em: null, pessoa_id: 'p1' }];
  const r = passarPara({ usos, veiculoId: 'v1', para: dono, donoFixo: dono, quando: '2026-08-12T12:00:00Z' });
  assert.equal(r.fechar, null, 'não fecha a posse de quem já está com o carro');
  assert.equal(r.abrir, null, 'e não abre outra igual');
});

test('devolver ao dono fixo um carro que JÁ está com ele também não faz nada', () => {
  // O caso do botão: `para` vem nulo, `passarPara` cai no dono fixo, e ele já é
  // quem está com o carro.
  const dono = { id: 'p1', nome: 'Humberto' };
  const usos = [{ id: 'u1', veiculo_id: 'v1', tipo: 'posse', volta_em: null, pessoa_id: 'p1' }];
  const r = passarPara({ usos, veiculoId: 'v1', para: null, donoFixo: dono, quando: '2026-08-12T12:00:00Z' });
  assert.equal(r.fechar, null);
  assert.equal(r.abrir, null);
});

test('passar para OUTRA pessoa continua fechando e abrindo', () => {
  const usos = [{ id: 'u1', veiculo_id: 'v1', tipo: 'posse', volta_em: null, pessoa_id: 'p1' }];
  const r = passarPara({
    usos, veiculoId: 'v1', para: { id: 'p2', nome: 'Gabriel' },
    donoFixo: { id: 'p1', nome: 'Humberto' }, quando: '2026-08-12T12:00:00Z',
  });
  assert.equal(r.fechar.id, 'u1');
  assert.equal(r.abrir.pessoa_id, 'p2');
});

test('pessoa DE FORA vira posse com nome e SEM identificador', () => {
  // É o que faz a multa da quinzena do Felipe ter resposta.
  const r = passarPara({
    usos: [], veiculoId: 'v1', para: { id: null, nome: 'Felipe modelista' },
    donoFixo: null, quando: '2026-08-12T12:00:00Z',
  });
  assert.equal(r.abrir.pessoa_id, null);
  assert.equal(r.abrir.pessoa_nome, 'Felipe modelista');
});

/* ── Quem deve conferir o carro hoje ──────────────────────────────────────── */

test('quem está DIRIGINDO o carro hoje é quem confere, não o dono no papel', () => {
  // O relato do dono (21/08/2026): retirou a Bravo, de rodízio, e o cartão do
  // checklist não abria pra ele. O app só reconhecia "seu carro" por posse, e
  // ele estava com o carro por VIAGEM.
  const veiculo = { id: 'bravo', pessoa_id: 'p-dono-no-papel' }
  const usos = [{ veiculo_id: 'bravo', tipo: 'viagem', pessoa_id: 'p-erick', pessoa_nome: 'Erick Martins', volta_em: null }]
  const r = quemDeveConferir(veiculo, usos)
  assert.equal(r.pessoaId, 'p-erick')
  assert.equal(r.pessoaNome, 'Erick Martins')
  assert.equal(r.porViagem, true)
})

test('viagem DEVOLVIDA não manda mais: volta a valer a posse ou o dono', () => {
  const veiculo = { id: 'bravo', pessoa_id: 'p-dono' }
  const usos = [{ veiculo_id: 'bravo', tipo: 'viagem', pessoa_id: 'p-erick', volta_em: '2026-08-21T20:00:00Z' }]
  const r = quemDeveConferir(veiculo, usos)
  assert.equal(r.pessoaId, 'p-dono')
  assert.equal(r.porViagem, false)
})

test('sem viagem, é exatamente o que quemEstaComOCarro já dizia (posse vence o papel)', () => {
  const veiculo = { id: 'doblo', pessoa_id: 'p-dono' }
  const usos = [{ veiculo_id: 'doblo', tipo: 'posse', pessoa_id: 'p-jeremias', volta_em: null }]
  const r = quemDeveConferir(veiculo, usos)
  assert.equal(r.pessoaId, 'p-jeremias')
  assert.equal(r.porPosse, true)
  assert.equal(r.porViagem, false)
})

test('viagem sem pessoa registrada não rouba o carro de ninguém', () => {
  const veiculo = { id: 'x', pessoa_id: 'p-dono' }
  const usos = [{ veiculo_id: 'x', tipo: 'viagem', pessoa_id: null, volta_em: null }]
  assert.equal(quemDeveConferir(veiculo, usos).pessoaId, 'p-dono')
})

test('o nome vem da lista quando a viagem gravou só o id', () => {
  const usos = [{ veiculo_id: 'x', tipo: 'viagem', pessoa_id: 'p1', volta_em: null }]
  const r = quemDeveConferir({ id: 'x' }, usos, [{ id: 'p1', nome: 'Fulano' }])
  assert.equal(r.pessoaNome, 'Fulano')
})
