import { test } from 'node:test'
import assert from 'node:assert/strict'
import { seloDoVeiculo, acaoPrincipalDoVeiculo, cartaoCompacto } from './cartao-do-veiculo.js'
import { estadoDoVeiculo, ordenarEstados } from './estado-do-veiculo.js'

const carro = (extra = {}) => ({ id: 'v1', nome: 'KWID', placa: 'RUL1A35', situacao: 'ativo', ...extra })
const estado = (v, usos = []) => estadoDoVeiculo(v, usos, [])
const naRua = (v) => estado(v, [{
  veiculo_id: v.id, pessoa_id: 'p-cristian', pessoa_nome: 'Cristian Leonel', tipo: 'viagem',
  saida_em: '2026-09-10T16:03Z',
}])

test('o selo é UMA palavra, não a frase inteira', () => {
  // O estrago que ele conserta: a etiqueta estreita carregava "Na rua com
  // Cristian Leonel". Quem bate o olho quer a situação.
  const s = seloDoVeiculo(naRua(carro()))
  assert.equal(s.texto, 'NA RUA')
  assert.ok(!/Cristian/.test(s.texto), 'nome de pessoa não entra no selo')
})

test('cada situação tem sua palavra e seu tom, e o tom sai da casa', () => {
  const casos = [
    [carro({ situacao: 'alienado' }), 'FORA DA FROTA', 'neutro'],
    [carro({ situacao: 'em_manutencao' }), 'OFICINA', 'atencao'],
    [carro({ situacao: 'inativo' }), 'PARADO', 'neutro'],
    [carro(), 'LIVRE', 'ok'],
    [carro({ pessoa_id: 'p1', pessoa_nome: 'Héllen' }), 'FIXO', 'info'],
    [carro({ reservada: true, reservada_por: 'Mariá' }), 'RESERVADO', 'info'],
  ]
  const tonsDaCasa = ['ok', 'atencao', 'erro', 'info', 'neutro', 'robo']
  for (const [v, texto, tom] of casos) {
    const s = seloDoVeiculo(estado(v))
    assert.equal(s.texto, texto, `${v.situacao}/${v.pessoa_nome || ''} devia dizer ${texto}`)
    assert.equal(s.tom, tom)
    assert.ok(tonsDaCasa.includes(s.tom), `${s.tom} não é tom da casa`)
  }
})

test('carro com responsável fixo NUNCA diz LIVRE', () => {
  // A mesma contradição que já tinha sido corrigida na frase da linha:
  // "Livre, com Humberto" fazia a pessoa achar que podia pegar.
  assert.equal(seloDoVeiculo(estado(carro({ pessoa_id: 'p1', pessoa_nome: 'Humberto' }))).texto, 'FIXO')
})

test('a ação principal segue o estado do carro', () => {
  assert.deepEqual(acaoPrincipalDoVeiculo(naRua(carro()), { podeEditar: true }),
    { chave: 'devolver', rotulo: 'Devolver' })
  assert.deepEqual(acaoPrincipalDoVeiculo(estado(carro()), { podeEditar: true }),
    { chave: 'retirada', rotulo: 'Registrar retirada' })
})

test('carro que JÁ ESTÁ com alguém não convida a retirar', () => {
  // Achado na primeira foto: o Bravo, fixo com o Humberto, ganhou um botão
  // largo "Registrar retirada" — convidando a retirar um carro que está na mão
  // dele. O botão não some da tela; some do lugar que empurra.
  const fixo = estado(carro({ pessoa_id: 'p-humberto', pessoa_nome: 'Humberto Mendonça' }))
  assert.deepEqual(acaoPrincipalDoVeiculo(fixo, { podeEditar: true }),
    { chave: 'passe', rotulo: 'Passar ou recolher' })
})

test('carro na oficina ou fora da frota não tem ação principal', () => {
  // Botão largo apagado é pior que botão nenhum: promete e não cumpre.
  for (const s of ['em_manutencao', 'alienado', 'inativo']) {
    assert.equal(acaoPrincipalDoVeiculo(estado(carro({ situacao: s })), { podeEditar: true }), null,
      `${s} não devia oferecer ação principal`)
  }
})

test('quem não pode editar não vê ação principal nenhuma', () => {
  assert.equal(acaoPrincipalDoVeiculo(naRua(carro()), { podeEditar: false }), null)
  assert.equal(acaoPrincipalDoVeiculo(naRua(carro()), {}), null, 'sem opção nenhuma, assume que NÃO pode')
})

test('carro que não está circulando vira cartão pequeno, no fim', () => {
  // Decisão do dono em 21/09: "menores no fim" para oficina e fora da frota, e
  // na segunda passada ele fechou a regra incluindo o PARADO — "funcional, não
  // carregado". Uma regra só, e a mesma que decide o cartão esmaecido: quem
  // não está circulando ocupa menos tela.
  for (const s of ['em_manutencao', 'alienado', 'inativo']) {
    assert.equal(cartaoCompacto(estado(carro({ situacao: s }))), true, `${s} devia ser pequeno`)
  }
  assert.equal(cartaoCompacto(estado(carro())), false, 'carro livre é grande')
  assert.equal(cartaoCompacto(naRua(carro())), false, 'carro na rua é grande')
})

test('os cartões pequenos ficam NO FIM da lista, que é onde o dono os quer', () => {
  // A ordem já existia em ordenarEstados(); este teste prende as duas regras
  // juntas — encolher sem descer deixaria o carro pequeno no meio da lista.
  const lista = ordenarEstados([
    estado(carro({ id: 'a', nome: 'VOLVO XC90', situacao: 'em_manutencao' })),
    estado(carro({ id: 'b', nome: 'KWID' })),
    estado(carro({ id: 'c', nome: 'FIAT FIESTA', situacao: 'alienado' })),
    naRua(carro({ id: 'd', nome: 'BMW X1' })),
  ])
  const compactos = lista.map(cartaoCompacto)
  assert.deepEqual(compactos, [false, false, true, true],
    'os compactos têm de ser os últimos — encolher sem descer deixaria o '
    + 'cartão pequeno no meio da lista')
})

test('nada quebra com entrada vazia', () => {
  assert.deepEqual(seloDoVeiculo(null), { texto: '', tom: 'neutro' })
  assert.equal(acaoPrincipalDoVeiculo(null, { podeEditar: true }), null)
  assert.equal(cartaoCompacto(null), false)
})

/* ── A LINHA embaixo do nome ──────────────────────────────────────────────
 * Estes testes vieram de `resumoDoEstado`, em estado-do-veiculo.test.mjs, e
 * foram reescritos para o par selo+linha. As decisões do dono que eles
 * prendiam continuam prendidas — o que mudou é ONDE cada metade aparece. */
import { linhaDoCartao } from './cartao-do-veiculo.js'

test('a linha NÃO repete o selo', () => {
  // Pedido do dono, 21/09/2026, vendo a primeira foto: "quero funcional, não
  // carregado". O selo dizia NA RUA e a linha, logo abaixo, "Na rua com
  // Cristian Leonel".
  const e = naRua(carro())
  assert.equal(seloDoVeiculo(e).texto, 'NA RUA')
  assert.equal(linhaDoCartao(e), 'Com Cristian Leonel')
  assert.ok(!/na rua/i.test(linhaDoCartao(e)), 'o que o selo já diz não se repete')
})

test('carro na rua mostra COM QUEM, nunca o local', () => {
  const v = carro({ local_texto: 'Barracão' })
  assert.equal(linhaDoCartao(naRua(v)), 'Com Cristian Leonel')
})

test('carro parado num lugar mostra o LUGAR', () => {
  assert.equal(linhaDoCartao(estado(carro({ local_texto: 'Barracão' }))), 'Em Barracão')
})

test('carro com responsável fixo: o par nunca diz LIVRE', () => {
  // A contradição original era "Livre, com Humberto" numa frase só. Agora são
  // duas metades, e a invariante vale para as duas juntas.
  const e = estado(carro({ pessoa_id: 'p1', pessoa_nome: 'Humberto' }))
  assert.equal(seloDoVeiculo(e).texto, 'FIXO')
  assert.equal(linhaDoCartao(e), 'Com Humberto')
  assert.ok(!/livre/i.test(seloDoVeiculo(e).texto + ' ' + linhaDoCartao(e)))
})

test('oficina e fora da frota: o selo basta, a linha fica vazia', () => {
  // Vazio é resposta: o template esconde a linha. Repetir "Na oficina" embaixo
  // de um selo OFICINA é exatamente o "carregado" que o dono não quer.
  for (const s of ['em_manutencao', 'alienado', 'inativo']) {
    assert.equal(linhaDoCartao(estado(carro({ situacao: s }))), '', `${s} não precisa de linha`)
  }
})

test('na oficina COM lugar apontado, a linha diz o lugar', () => {
  assert.equal(linhaDoCartao(estado(carro({ situacao: 'em_manutencao', local_texto: 'Oficina do Zé' }))),
    'Em Oficina do Zé')
})

test('sem responsável mas com contato, a linha diz a quem perguntar', () => {
  // O dono estranhou a Doblo: sem responsável na Frota e com "Siqueira" no
  // contato, as duas coisas se confundiam. Responsável responde pelo carro;
  // contato é a quem perguntar.
  const v = carro({ pessoa_id: null, contato_nome: 'Siqueira' })
  assert.equal(linhaDoCartao(estado(v)), 'Perguntar a Siqueira')
  assert.equal(linhaDoCartao(estado(carro({ contato_nome: 'Siqueira', local_texto: 'Barracão' }))),
    'Em Barracão · perguntar a Siqueira')
})

test('o contato NÃO é apresentado como se fosse o responsável', () => {
  const v = carro({ pessoa_id: null, contato_nome: 'Siqueira' })
  assert.doesNotMatch(linhaDoCartao(estado(v)), /^Com /)
})

test('com responsável, o contato não entra na linha', () => {
  const v = carro({ pessoa_id: 'p1', pessoa_nome: 'Marcus', contato_nome: 'Outro' })
  assert.equal(linhaDoCartao(estado(v)), 'Com Marcus')
})

test('reservado diz PARA QUEM — é com quem se resolve no WhatsApp', () => {
  const e = estado(carro({ reservada: true, reservada_por: 'Mariá Pessoa' }))
  assert.equal(seloDoVeiculo(e).texto, 'RESERVADO')
  assert.equal(linhaDoCartao(e), 'Para Mariá Pessoa')
})

test('a linha não quebra com entrada vazia', () => {
  assert.equal(linhaDoCartao(null), '')
  assert.equal(linhaDoCartao({}), '')
})

test('o filete do cartão tem o MESMO tom do selo (Onda 2b da cor)', async () => {
  const { tomDoCartao } = await import('./cartao-do-veiculo.js')
  // Cada situação, e o tom `--situacao-*` que o filete pinta.
  const casos = [
    [carro(), 'viva'],                                                  // LIVRE, selo verde
    [carro({ pessoa_id: 'p1', pessoa_nome: 'Héllen' }), 'andamento'],   // FIXO, selo azul
    [carro({ reservada: true, reservada_por: 'Mariá' }), 'andamento'],  // RESERVADO, selo azul
    [carro({ situacao: 'em_manutencao' }), 'queda'],                    // OFICINA, selo laranja
    [carro({ situacao: 'inativo' }), 'parada'],                         // PARADO, selo cinza
    [carro({ situacao: 'alienado' }), 'parada'],                        // FORA DA FROTA, cinza
  ]
  for (const [v, tom] of casos) assert.equal(tomDoCartao(estado(v)), tom, seloDoVeiculo(estado(v)).texto)
  assert.equal(tomDoCartao(naRua(carro())), 'queda')                  // NA RUA, selo laranja
  assert.equal(tomDoCartao(null), 'parada')
})

test('a tela liga o tom do filete no cartão do carro', async () => {
  const { readFileSync } = await import('node:fs')
  const tela = readFileSync(new URL('./tela-de-frota.vue', import.meta.url), 'utf8')
  assert.match(tela, /class="fr-card fr-carro id-cartao"/)
  assert.match(tela, /`id-tom-\$\{tomDoCartao\(l\)\}`/)
  assert.match(tela, /import \{[^}]*tomDoCartao[^}]*\} from '\.\/cartao-do-veiculo\.js'/)
})
