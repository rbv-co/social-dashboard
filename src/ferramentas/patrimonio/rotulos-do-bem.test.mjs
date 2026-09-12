import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SITUACOES, rotuloDaSituacao, classeDaSituacao, textoDoDono,
  CATEGORIAS_PESSOAIS, avisoDeDonoVazio,
} from './rotulos-do-bem.js'

test('SITUACOES cobre exatamente o que o banco aceita', () => {
  assert.deepEqual(SITUACOES.map(s => s.valor), ['em_uso', 'em_estoque', 'em_manutencao', 'baixado'])
})

test('rótulo é português de gente, não o valor do banco', () => {
  assert.equal(rotuloDaSituacao('em_uso'), 'Em uso')
  assert.equal(rotuloDaSituacao('em_estoque'), 'Em estoque')
  assert.equal(rotuloDaSituacao('em_manutencao'), 'Em manutenção')
  assert.equal(rotuloDaSituacao('baixado'), 'Baixado')
})

test('situação desconhecida não quebra a tela: devolve o próprio valor', () => {
  assert.equal(rotuloDaSituacao('coisa_nova'), 'coisa_nova')
  assert.equal(rotuloDaSituacao(null), '—')
})

test('cada situação tem sua classe de pílula', () => {
  assert.equal(classeDaSituacao('em_uso'), 'pat-pill-uso')
  assert.equal(classeDaSituacao('em_estoque'), 'pat-pill-estoque')
  assert.equal(classeDaSituacao('em_manutencao'), 'pat-pill-manutencao')
  assert.equal(classeDaSituacao('baixado'), 'pat-pill-baixado')
  assert.equal(classeDaSituacao('coisa_nova'), 'pat-pill-neutro')
})

test('dono: colaborador cadastrado vence o nome solto', () => {
  const pessoas = { 'p1': { id: 'p1', nome: 'Larissa Sousa' } }
  assert.equal(textoDoDono({ pessoa_id: 'p1', dono_texto: 'Larissa' }, pessoas), 'Larissa Sousa')
})

test('dono: nome solto da planilha aparece marcado como não cadastrado', () => {
  assert.equal(textoDoDono({ pessoa_id: null, dono_texto: 'Raíssa' }, {}), 'Raíssa (não cadastrada)')
})

test('dono: sem ninguém diz que não está com ninguém', () => {
  assert.equal(textoDoDono({ pessoa_id: null, dono_texto: null }, {}), 'Sem dono')
  assert.equal(textoDoDono({ pessoa_id: null, dono_texto: '   ' }, {}), 'Sem dono')
})

test('dono: pessoa_id que não existe mais não vira "undefined"', () => {
  assert.equal(textoDoDono({ pessoa_id: 'sumiu', dono_texto: null }, {}), 'Pessoa removida')
})

/* ── "Pessoa removida" só quando a lista foi LIDA ─────────────────────────────
   A leitura de colaboradores é uma RPC que ESTOURA quando falta acesso, e a
   tela já sabe disso (`pessoasErro`). Com a lista em branco por falha, todo bem
   que TEM dono passava a dizer que a pessoa dele foi removida — uma mentira
   sobre gente que existe, e a mesma família do "R$ 0,00 por 17 horas": a tela
   nunca inventa um fato a partir de uma leitura que não deu certo. */

test('dono: lista que NÃO carregou não acusa pessoa removida', () => {
  assert.equal(
    textoDoDono({ pessoa_id: 'p1', dono_texto: null }, {}, true),
    'Não consegui ler a lista de colaboradores')
})

test('dono: com a lista falhando, quem TEM nome solto continua aparecendo por ele', () => {
  // O nome solto vem do próprio bem, não da lista — a falha não o alcança.
  assert.equal(
    textoDoDono({ pessoa_id: null, dono_texto: 'Raíssa' }, {}, true),
    'Raíssa (não cadastrada)')
  assert.equal(textoDoDono({ pessoa_id: null, dono_texto: null }, {}, true), 'Sem dono')
})

test('dono: lista falhou mas a pessoa está no mapa — o nome dela vence', () => {
  // Pode acontecer com leitura parcial; havendo o nome, não há o que esconder.
  const pessoas = { p1: { id: 'p1', nome: 'Larissa Sousa' } }
  assert.equal(textoDoDono({ pessoa_id: 'p1' }, pessoas, true), 'Larissa Sousa')
})

test('dono: lista lida OK continua dizendo "Pessoa removida"', () => {
  // O caso legítimo não se perde: a lista veio, e o id não está nela.
  assert.equal(textoDoDono({ pessoa_id: 'sumiu' }, {}, false), 'Pessoa removida')
})

/* ── Dono é OPCIONAL em qualquer situação ─────────────────────────────────────
   A mesa da Produção está em uso e não é de ninguém em particular — foi o dono
   quem apontou isso, olhando os 104 móveis e 78 máquinas que a regra antiga
   tinha rotulado como "guardados no estoque". Aparelho pessoal sem dono vira
   AVISO, não bloqueio: quem sabe se está certo é quem está com a etiqueta na mão. */

test('nenhuma situação exige dono — nem "em uso"', () => {
  assert.equal(avisoDeDonoVazio({ situacao: 'em_uso', categoria: 'Móveis e Utensílios', temDono: false }), null)
  assert.equal(avisoDeDonoVazio({ situacao: 'em_uso', categoria: 'Máquinas e Equipamentos', temDono: false }), null)
  assert.equal(avisoDeDonoVazio({ situacao: 'em_uso', categoria: 'Televisões', temDono: false }), null)
})

test('aparelho pessoal em uso sem dono gera aviso (não bloqueio)', () => {
  for (const cat of ['Computadores e Periféricos', 'Celulares e tablets', 'Veículos']) {
    const a = avisoDeDonoVazio({ situacao: 'em_uso', categoria: cat, temDono: false })
    assert.ok(a && a.includes('sem ninguém'), `esperava aviso para ${cat}, veio: ${a}`)
  }
})

test('aparelho pessoal COM dono não avisa nada', () => {
  assert.equal(avisoDeDonoVazio({ situacao: 'em_uso', categoria: 'Celulares e tablets', temDono: true }), null)
})

test('fora de "em uso" nunca avisa — estoque sem dono é o normal', () => {
  assert.equal(avisoDeDonoVazio({ situacao: 'em_estoque', categoria: 'Celulares e tablets', temDono: false }), null)
  assert.equal(avisoDeDonoVazio({ situacao: 'em_manutencao', categoria: 'Veículos', temDono: false }), null)
})

test('categoria desconhecida ou vazia não avisa', () => {
  assert.equal(avisoDeDonoVazio({ situacao: 'em_uso', categoria: null, temDono: false }), null)
  assert.equal(avisoDeDonoVazio({ situacao: 'em_uso', categoria: 'Plantas', temDono: false }), null)
})

test('CATEGORIAS_PESSOAIS é a mesma lista que a regra de importação usou', () => {
  assert.deepEqual(CATEGORIAS_PESSOAIS,
    ['Computadores e Periféricos', 'Celulares e tablets', 'Veículos'])
})
