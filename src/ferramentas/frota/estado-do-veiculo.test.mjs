import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  estadoDoVeiculo, resumoDoEstado, ordenarEstados, usoAberto, ultimoUsoFechado,
  rotuloDoTanque, precisaAbastecer, problemasDaDevolucao, problemasDoRegistroAvulso, ultimoHodometro,
} from './estado-do-veiculo.js'

const carro = (extra = {}) => ({ id: 'v1', nome: 'FORD FIESTA SEDAN', placa: 'ERO3G55', situacao: 'ativo', ...extra })

test('carro parado, sem uso nenhum, não inventa número', () => {
  const e = estadoDoVeiculo(carro(), [])
  assert.equal(e.naRua, false)
  assert.equal(e.km, null, 'KM desconhecido é nulo, nunca zero — zero é um odômetro')
  assert.equal(e.tanque, null)
  assert.equal(e.disponivel, true)
})

test('o KM sai da última DEVOLUÇÃO, não de campo digitado', () => {
  // É a razão de ser deste módulo: na planilha "KM Atual" é preenchido à mão e
  // por isso a aba Alertas nasceu vazia.
  const usos = [
    { veiculo_id: 'v1', saida_em: '2026-07-01T08:00Z', volta_em: '2026-07-01T18:00Z', km_saida: 145000, km_volta: 145300 },
    { veiculo_id: 'v1', saida_em: '2026-07-10T08:00Z', volta_em: '2026-07-10T18:00Z', km_saida: 145300, km_volta: 145928 },
  ]
  assert.equal(estadoDoVeiculo(carro(), usos).km, 145928)
})

test('quem devolveu por último manda, mesmo tendo saído antes', () => {
  // Dois carros na rua ao mesmo tempo não acontece (o banco impede), mas
  // registros lançados fora de ordem acontecem. Ordenar pela SAÍDA daria o
  // odômetro errado.
  const usos = [
    { veiculo_id: 'v1', saida_em: '2026-07-01T08:00Z', volta_em: '2026-07-20T18:00Z', km_volta: 146500 },
    { veiculo_id: 'v1', saida_em: '2026-07-10T08:00Z', volta_em: '2026-07-11T18:00Z', km_volta: 145928 },
  ]
  assert.equal(ultimoUsoFechado(usos, 'v1').km_volta, 146500)
})

test('carro na rua: mostra COM QUEM, e não o local', () => {
  const usos = [{ veiculo_id: 'v1', pessoa_nome: 'Siqueira', saida_em: '2026-08-04T07:00Z', km_saida: 145928, tanque_quartos: 1 }]
  const e = estadoDoVeiculo(carro({ local_texto: 'Barracão' }), usos)
  assert.equal(e.naRua, true)
  assert.equal(e.comQuem, 'Siqueira')
  assert.equal(e.ondeEsta, null, 'na rua, o local guardado não vale mais')
  assert.equal(e.disponivel, false)
  assert.equal(resumoDoEstado(e), 'Na rua com Siqueira')
})

test('carro parado: pessoa e local são coisas SEPARADAS', () => {
  // Decisão do dono. A planilha junta os dois numa coluna só ("Raissa",
  // "Barracão") e perde uma das informações.
  const soLocal = estadoDoVeiculo(carro({ local_texto: 'Barracão' }), [])
  assert.equal(resumoDoEstado(soLocal), 'Livre, em Barracão')

  const soPessoa = estadoDoVeiculo(carro({ pessoa_id: 'p-raissa', pessoa_nome: 'Raissa' }), [])
  assert.equal(resumoDoEstado(soPessoa), 'Com Raissa')

  const ambos = estadoDoVeiculo(carro({ pessoa_nome: 'Raissa', local_texto: 'Conchal' }), [])
  assert.equal(ambos.comQuem, 'Raissa')
  assert.equal(ambos.ondeEsta, 'Conchal', 'os dois sobrevivem — nenhum apaga o outro')
})

test('carro com RESPONSÁVEL FIXO não é carro livre', () => {
  // Correção do dono: "os carros que têm nome atrelado não estão livres". O
  // Volvo do Humberto não está esperando alguém pegar — ele é o carro do
  // Humberto. Oferecê-lo como disponível convidava a pegar o carro alheio.
  const e = estadoDoVeiculo(carro({ pessoa_id: 'p-humberto', pessoa_nome: 'Humberto' }), [])
  assert.equal(e.naRua, false, 'não está na rua: está parado, mas é dele')
  assert.equal(e.disponivel, false)
  // O TEXTO tem que concordar com a regra. "Livre, com Humberto" se contradiz
  // na mesma frase — e foi o que o dono viu na tela.
  assert.equal(resumoDoEstado(e), 'Com Humberto')
  assert.ok(!/livre/i.test(resumoDoEstado(e)), 'carro com responsável nunca diz "livre"')
})

test('sem responsável e sem uso aberto, aí sim está livre', () => {
  assert.equal(estadoDoVeiculo(carro(), []).disponivel, true)
})

test('carro na oficina não é carro livre', () => {
  const e = estadoDoVeiculo(carro({ situacao: 'em_manutencao' }), [])
  assert.equal(e.disponivel, false)
  assert.equal(resumoDoEstado(e), 'Na oficina')
})

test('carro alienado sai do caminho', () => {
  // O Ford Fiesta Hatch: o dono disse que não é mais da frota.
  const e = estadoDoVeiculo(carro({ situacao: 'alienado' }), [])
  assert.equal(e.disponivel, false)
  assert.equal(resumoDoEstado(e), 'Fora da frota')
})

test('a lista põe na frente o que dá pra usar agora', () => {
  const ests = [
    estadoDoVeiculo(carro({ id: 'a', nome: 'Alienado', situacao: 'alienado' }), []),
    estadoDoVeiculo(carro({ id: 'b', nome: 'Na rua' }), [{ veiculo_id: 'b', saida_em: 'x' }]),
    estadoDoVeiculo(carro({ id: 'c', nome: 'Oficina', situacao: 'em_manutencao' }), []),
    estadoDoVeiculo(carro({ id: 'd', nome: 'Livre' }), []),
  ]
  assert.deepEqual(ordenarEstados(ests).map((e) => e.veiculo.nome),
    ['Livre', 'Na rua', 'Oficina', 'Alienado'])
})

test('o tanque é lido como o ponteiro do painel', () => {
  assert.equal(rotuloDoTanque(0), 'Reserva')
  assert.equal(rotuloDoTanque(1), '1/4')
  assert.equal(rotuloDoTanque(4), 'Cheio')
  assert.equal(rotuloDoTanque(null), '—')
  assert.equal(rotuloDoTanque(9), '—')
})

test('1/4 ou menos avisa pra abastecer antes de sair', () => {
  assert.equal(precisaAbastecer(0), true)
  assert.equal(precisaAbastecer(1), true)
  assert.equal(precisaAbastecer(2), false)
  assert.equal(precisaAbastecer(null), false, 'sem informação não é motivo de alarme')
})

test('usoAberto acha só o que não voltou, e só daquele carro', () => {
  const usos = [
    { veiculo_id: 'v1', volta_em: '2026-07-01T18:00Z' },
    { veiculo_id: 'v2', volta_em: null },
    { veiculo_id: 'v1', volta_em: null },
  ]
  assert.equal(usoAberto(usos, 'v1').veiculo_id, 'v1')
  assert.equal(usoAberto(usos, 'v3'), null)
  assert.equal(usoAberto(null, 'v1'), null)
})

/* ── Devolução: o odômetro errado é o que estraga tudo depois ─────────────── */

test('devolução sem KM não passa', () => {
  const p = problemasDaDevolucao({ kmSaida: 145928, kmVolta: null })
  assert.equal(p.length, 1)
  assert.match(p[0], /painel/i)
})

test('KM de volta menor que o de saída é dedo errado', () => {
  const p = problemasDaDevolucao({ kmSaida: 145928, kmVolta: 145000 })
  assert.equal(p.length, 1)
  assert.match(p[0], /menor que o da sa[ií]da/i)
  assert.match(p[0], /145\.928/, 'mostrar os dois números é o que faz a pessoa achar o erro')
})

test('salto absurdo AVISA, mas não proíbe — viagem longa existe', () => {
  const p = problemasDaDevolucao({ kmSaida: 145928, kmVolta: 152000 })
  assert.equal(p.length, 1)
  assert.match(p[0], /Confirme/i)
  assert.ok(!/menor/i.test(p[0]))
})

test('devolução normal passa limpa', () => {
  assert.deepEqual(problemasDaDevolucao({ kmSaida: 145928, kmVolta: 146080 }), [])
})

test('sem KM de saída registrado, ainda dá pra devolver', () => {
  // A planilha tem "KM Inicial" em branco em quase todo registro. O módulo não
  // pode travar a devolução por causa de um dado que ninguém preencheu antes.
  assert.deepEqual(problemasDaDevolucao({ kmSaida: null, kmVolta: 146080 }), [])
})

/* ── O km também vem do checklist (F6) ───────────────────────────────────── */

test('o hodômetro do checklist vira a quilometragem do carro', () => {
  // É o ponto da fase inteira: sem checklist, este carro não tem km nenhum,
  // porque ninguém registra viagem.
  const e = estadoDoVeiculo({ id: 'v1', situacao: 'ativo' }, [],
    [{ veiculo_id: 'v1', feita_em: '2026-08-05', hodometro: 148320 }])
  assert.equal(e.km, 148320)
})

test('entre devolução e checklist, vale o MAIOR — odômetro só anda pra frente', () => {
  const usos = [{ veiculo_id: 'v1', saida_em: '2026-08-01', volta_em: '2026-08-02', km_volta: 140000 }]
  const fichas = [{ veiculo_id: 'v1', feita_em: '2026-08-05', hodometro: 148320 }]
  assert.equal(estadoDoVeiculo({ id: 'v1', situacao: 'ativo' }, usos, fichas).km, 148320)
  const antigas = [{ veiculo_id: 'v1', feita_em: '2026-07-01', hodometro: 130000 }]
  assert.equal(estadoDoVeiculo({ id: 'v1', situacao: 'ativo' }, usos, antigas).km, 140000)
})

test('ficha de outro carro não conta', () => {
  assert.equal(ultimoHodometro([{ veiculo_id: 'v2', hodometro: 999999 }], 'v1'), null)
  assert.equal(ultimoHodometro([], 'v1'), null)
  assert.equal(ultimoHodometro(null, 'v1'), null)
})

test('chamar com dois argumentos continua funcionando', () => {
  const e = estadoDoVeiculo({ id: 'v1', situacao: 'ativo' }, [])
  assert.equal(e.km, null)
})

/* ── O local da árvore vence o texto antigo (B1) ─────────────────────────── */

test('onde o carro está prefere o local da árvore ao texto antigo', () => {
  // Medido em 12/08: BMW, Porsche e XC90 tinham árvore apontada E texto velho.
  // A tela mostrava o texto velho, e o dono achava que não tinha salvado.
  const v = { id: 'v1', situacao: 'ativo', local_texto: 'Casa RB', local_bonito: 'Fábrica Conchal' }
  const e = estadoDoVeiculo(v, [], [])
  assert.equal(e.ondeEsta, 'Fábrica Conchal')
})

test('sem local da árvore, o texto escrito à mão continua aparecendo', () => {
  const v = { id: 'v1', situacao: 'ativo', local_texto: 'Barracão', local_bonito: null }
  assert.equal(estadoDoVeiculo(v, [], []).ondeEsta, 'Barracão')
})

test('carro na rua não mostra local nenhum — está com uma pessoa, não num lugar', () => {
  const v = { id: 'v1', situacao: 'ativo', local_texto: 'Barracão', local_bonito: 'Casa RB' }
  const usos = [{ veiculo_id: 'v1', tipo: 'viagem', volta_em: null, pessoa_nome: 'Gabriel' }]
  assert.equal(estadoDoVeiculo(v, usos, []).ondeEsta, null)
})

/* ── Posse não é "na rua" (D9) ───────────────────────────────────────────── */

test('posse aberta do dono fixo NÃO deixa o carro eternamente na rua', () => {
  // Sem esta distinção, o Volvo do Humberto apareceria "na rua com Humberto"
  // para sempre, e o botão de devolver ficaria aceso sem fim.
  const usos = [{ veiculo_id: 'v1', tipo: 'posse', pessoa_id: 'p1',
    pessoa_nome: 'Humberto', saida_em: '2026-08-05', volta_em: null }]
  const e = estadoDoVeiculo({ id: 'v1', situacao: 'ativo', pessoa_id: 'p1' }, usos)
  assert.equal(e.naRua, false)
})

test('viagem aberta continua sendo na rua', () => {
  const usos = [{ veiculo_id: 'v1', tipo: 'viagem', pessoa_id: 'p2',
    pessoa_nome: 'Marcus', saida_em: '2026-08-05', volta_em: null, km_saida: 1000 }]
  assert.equal(estadoDoVeiculo({ id: 'v1', situacao: 'ativo' }, usos).naRua, true)
})

test('linha antiga sem o campo tipo é tratada como viagem', () => {
  // As linhas gravadas antes da migration 028 não têm `tipo`. Tratá-las como
  // posse faria carro na rua sumir da lista de quem está fora.
  const usos = [{ veiculo_id: 'v1', pessoa_id: 'p2', saida_em: '2026-08-05', volta_em: null }]
  assert.equal(estadoDoVeiculo({ id: 'v1', situacao: 'ativo' }, usos).naRua, true)
})

/* ── O KM da manutenção como quarta fonte (D29) ─────────────────────────────
 *
 * Medido em 12/08/2026: 8 dos 10 carros não tinham quilometragem conhecida
 * nenhuma, e por isso a aba Revisões respondia "ainda não sei" em 8 carros × 8
 * itens do plano. Sem esta fonte, o dono registra a troca e nada muda na tela —
 * o trabalho dele não apareceria em lugar nenhum. */

test('o KM de uma manutenção conta como quilometragem conhecida do carro', () => {
  const v = { id: 'v1', situacao: 'ativo' }
  const revisoes = [{ veiculo_id: 'v1', item: 'Troca de óleo', km: 92000 }]
  assert.equal(estadoDoVeiculo(v, [], [], revisoes).km, 92000)
})

test('entre as fontes de KM vence o MAIOR, nunca o mais recente por data', () => {
  // Mesma regra de ultimaRevisao(): data digitada errada acontece o tempo todo,
  // odômetro só anda pra frente.
  const v = { id: 'v1', situacao: 'ativo' }
  const fichas = [{ veiculo_id: 'v1', hodometro: 188000 }]
  const revisoes = [{ veiculo_id: 'v1', item: 'Óleo', km: 92000 }]
  assert.equal(estadoDoVeiculo(v, [], fichas, revisoes).km, 188000)
})

test('revisão de OUTRO carro não vaza pra este', () => {
  const v = { id: 'v1', situacao: 'ativo' }
  const revisoes = [{ veiculo_id: 'v2', item: 'Óleo', km: 500000 }]
  assert.equal(estadoDoVeiculo(v, [], [], revisoes).km, null)
})

test('revisão com km nulo não zera nem quebra', () => {
  const v = { id: 'v1', situacao: 'ativo' }
  const revisoes = [{ veiculo_id: 'v1', item: 'Óleo', km: null }]
  assert.equal(estadoDoVeiculo(v, [], [], revisoes).km, null)
})

test('sem o quarto parâmetro nada muda — quem chama com três continua igual', () => {
  const v = { id: 'v1', situacao: 'ativo' }
  const fichas = [{ veiculo_id: 'v1', hodometro: 54000 }]
  assert.equal(estadoDoVeiculo(v, [], fichas).km, 54000)
})

test('KM zero de manutenção é KM conhecido — carro zero km existe', () => {
  const v = { id: 'v1', situacao: 'ativo' }
  assert.equal(estadoDoVeiculo(v, [], [], [{ veiculo_id: 'v1', item: 'Óleo', km: 0 }]).km, 0)
})

/* ── Reserva aprovada tira o carro dos livres (defeito da Bravo Essence) ──── */

test('carro com reserva aprovada em vigor NÃO é livre', () => {
  // Medido em 12/08/2026: a Bravo Essence tinha reserva aprovada até 24/08 e
  // continuava listada como livre pra qualquer um pegar.
  const v = { id: 'v1', situacao: 'ativo', pessoa_id: null, reservada: true }
  assert.equal(estadoDoVeiculo(v, [], []).disponivel, false)
})

test('sem reserva, o carro de rodízio continua livre como sempre', () => {
  const v = { id: 'v1', situacao: 'ativo', pessoa_id: null, reservada: false }
  assert.equal(estadoDoVeiculo(v, [], []).disponivel, true)
})

/* ── Responsável e contato são coisas diferentes ────────────────────────────
 * O dono estranhou a Doblo: sem responsável na Frota, com "Siqueira" no
 * contato, e as duas coisas se confundindo na tela. */

test('carro sem responsável mas com contato DIZ a quem perguntar', () => {
  const v = { id: 'v1', situacao: 'ativo', pessoa_id: null, contato_nome: 'Siqueira' }
  const f = resumoDoEstado(estadoDoVeiculo(v, [], []))
  assert.match(f, /sem responsável/i, 'tem de dizer que não há responsável')
  assert.match(f, /Siqueira/, 'e a quem perguntar')
})

test('o contato NÃO é apresentado como se fosse o responsável', () => {
  // Dizer "Com Siqueira" seria a tela afirmando que ele responde pelo carro.
  const v = { id: 'v1', situacao: 'ativo', pessoa_id: null, contato_nome: 'Siqueira' }
  assert.doesNotMatch(resumoDoEstado(estadoDoVeiculo(v, [], [])), /^Com /)
})

test('com responsável, o contato não entra na frase', () => {
  const v = { id: 'v1', situacao: 'ativo', pessoa_id: 'p1', pessoa_nome: 'Marcus', contato_nome: 'Outro' }
  assert.equal(resumoDoEstado(estadoDoVeiculo(v, [], [])), 'Com Marcus')
})

/* ── A reserva que segura o carro, e a exceção de quem reservou ───────────── */

test('reserva aprovada segura o carro — mas não contra QUEM RESERVOU', () => {
  // O defeito (medido em 20/08/2026): a partir da hora marcada, a reserva
  // aprovada tirava o carro de "Livres para pegar" pra TODO MUNDO, inclusive
  // pra quem tinha reservado. E é dentro dessa lista que mora o botão "Peguei
  // o carro". Quem chegava no horário combinado abria o app e o carro tinha
  // sumido da tela; só quem abria ANTES da hora conseguia pegar.
  const deOutraPessoa = estadoDoVeiculo(carro({ reservada: true }), [])
  assert.equal(deOutraPessoa.disponivel, false)
  assert.equal(deOutraPessoa.disponivelParaMim, false, 'reserva dos outros me barra')

  const minha = estadoDoVeiculo(carro({ reservada: true, reservada_para_mim: true }), [])
  assert.equal(minha.disponivel, false,
    'na Gestão o carro continua reservado: a tela não mente sobre a frota')
  assert.equal(minha.disponivelParaMim, true,
    'pra quem reservou, o carro está lá pra ser pego — é o que a reserva comprou')
})

test('a exceção não ressuscita carro na rua, na oficina, nem com dono fixo', () => {
  // `reservada_para_mim` abre UMA porta só. Sem isto, uma reserva minha antiga
  // faria aparecer como "livre pra pegar" um carro que está com outra pessoa.
  const naRua = estadoDoVeiculo(
    carro({ reservada: true, reservada_para_mim: true }),
    [{ veiculo_id: 'v1', pessoa_id: 'p-outro', saida_em: '2026-08-20T07:00Z' }],
  )
  assert.equal(naRua.disponivelParaMim, false, 'carro na rua não está livre pra ninguém')

  const oficina = estadoDoVeiculo(carro({ reservada: true, reservada_para_mim: true, situacao: 'em_manutencao' }), [])
  assert.equal(oficina.disponivelParaMim, false)

  const comDono = estadoDoVeiculo(carro({ reservada: true, reservada_para_mim: true, pessoa_id: 'p-dono' }), [])
  assert.equal(comDono.disponivelParaMim, false, 'carro fixo de alguém não entra nos livres')
})

test('sem reserva nenhuma, "livre pra mim" é igual a "livre"', () => {
  const e = estadoDoVeiculo(carro(), [])
  assert.equal(e.disponivel, true)
  assert.equal(e.disponivelParaMim, true)
})

/* ── Registrar uma retirada que aconteceu FORA do aplicativo ──────────────── */

test('registro avulso exige o KM e a hora em que o carro saiu', () => {
  // Este caminho existe porque a vida acontece fora do app: alguém pega o carro
  // no sábado, sem o celular na mão, e isso precisa entrar no sistema depois.
  // Fechar essa porta não faz o checklist existir — faz a VIAGEM não existir.
  assert.deepEqual(
    problemasDoRegistroAvulso({ km: null, saidaEm: '2026-08-22T09:00', agoraIso: '2026-08-24T12:00:00Z' }),
    ['Informe o KM que estava no painel quando o carro saiu.'])
  assert.deepEqual(
    problemasDoRegistroAvulso({ km: 185359, saidaEm: '', agoraIso: '2026-08-24T12:00:00Z' }),
    ['Informe quando o carro saiu.'])
})

test('não dá pra registrar uma saída no futuro', () => {
  // Registro avulso conta o que JÁ aconteceu. Data no futuro é dedo errado, e
  // gravada vira um carro "na rua" antes de sair.
  const p = problemasDoRegistroAvulso({ km: 185359, saidaEm: '2026-08-30T09:00', agoraIso: '2026-08-24T12:00:00Z' })
  assert.equal(p.length, 1)
  assert.match(p[0], /futuro|ainda não/i)
})

test('saída no passado, com KM, passa', () => {
  assert.deepEqual(
    problemasDoRegistroAvulso({ km: 185359, saidaEm: '2026-08-22T09:00', agoraIso: '2026-08-24T12:00:00Z' }), [])
})

test('data impossível é recusada, não tratada como vazia', () => {
  // Vazio e podre são coisas diferentes: dizer "informe quando saiu" pra quem
  // digitou uma data manda a pessoa preencher o campo que ela já preencheu.
  const p = problemasDoRegistroAvulso({ km: 1, saidaEm: 'trinta e um de fevereiro', agoraIso: '2026-08-24T12:00:00Z' })
  assert.equal(p.length, 1)
  assert.match(p[0], /não entendi|inválida|confira/i)
})
