import { test } from 'node:test'
import assert from 'node:assert/strict'
import { recusaDaSenha, avisoDoQueGravou, selo } from './assinar-checklist.js'

/* ── A senha ──────────────────────────────────────────────────────────────── */

test('cada recusa da senha tem a sua frase, e nenhuma se repete', () => {
  const frases = ['senha_incorreta', 'bloqueado', 'sem_senha', 'sem_sessao', 'entrou_como_outra_pessoa'].map(recusaDaSenha)
  assert.equal(new Set(frases).size, frases.length, 'duas recusas diferentes com a mesma frase')
  for (const f of frases) assert.ok(f.length > 20, 'frase curta demais pra dizer o que fazer')
})

test('motivo desconhecido NÃO acusa a pessoa de errar a senha', () => {
  // Este é o caso real de internet caindo, e do 429/401 que o supabase-js
  // devolve com `data` nulo. Dizer "senha incorreta" faria a pessoa digitar de
  // novo até a Edge bloquear de verdade por dez minutos.
  for (const desconhecido of [undefined, null, '', 'falha_interna', 'coisa_que_nao_existe']) {
    const f = recusaDaSenha(desconhecido)
    assert.doesNotMatch(f, /incorreta/i, `"${desconhecido}" virou acusação de senha errada`)
    assert.match(f, /nada foi gravado/i, 'tem que dizer que nada foi gravado')
  }
})

test('bloqueado diz quanto tempo esperar, não só que bloqueou', () => {
  assert.match(recusaDaSenha('bloqueado'), /dez minutos/)
})

test('toda recusa da senha acontece ANTES de gravar, e nenhuma frase sugere o contrário', () => {
  // A conferência da senha vem antes das três escritas: senha errada não pode
  // deixar ficha pela metade no banco. Nenhuma destas frases pode mandar a
  // pessoa procurar uma ficha que não existe, nem avisar do índice "um carro,
  // um dia, uma ficha" — que só morde quem JÁ gravou.
  for (const c of ['senha_incorreta', 'bloqueado', 'sem_senha', 'sem_sessao', 'entrou_como_outra_pessoa', 'falha_interna']) {
    assert.doesNotMatch(recusaDaSenha(c), /já existe|foi registrad[ao]/i)
  }
})

/* ── O que ficou gravado ──────────────────────────────────────────────────── */

test('tudo certo com assinatura: nada a avisar', () => {
  assert.equal(avisoDoQueGravou({
    fichaGravada: true, respostasGravadas: true, assinaturaGravada: true, queriaAssinar: true,
  }), '')
})

test('quem não tem login termina sem assinatura, e isso NÃO é aviso de falha (D22)', () => {
  assert.equal(avisoDoQueGravou({
    fichaGravada: true, respostasGravadas: true, assinaturaGravada: false, queriaAssinar: false,
  }), '')
})

test('a ficha não gravou: quem avisa é a mensagem do insert, não esta', () => {
  assert.equal(avisoDoQueGravou({
    fichaGravada: false, respostasGravadas: false, assinaturaGravada: false, queriaAssinar: true,
  }), '')
})

test('respostas não gravaram: diz o que ficou, e que tentar de novo vai ser recusado', () => {
  const f = avisoDoQueGravou({
    fichaGravada: true, respostasGravadas: false, assinaturaGravada: false, queriaAssinar: true,
  })
  assert.match(f, /ficha.*foi registrada/i)
  assert.match(f, /respostas.*não foram salvas/i)
  assert.match(f, /já existe/i)
})

test('a ASSINATURA não gravou: frase PRÓPRIA, e ela não manda refazer o checklist', () => {
  // O estado é diferente do anterior: a conferência está inteira, só falta a
  // prova de quem a fez. Mandar refazer bateria no índice "um carro, um dia,
  // uma ficha" e faria a pessoa perder o trabalho à toa.
  const f = avisoDoQueGravou({
    fichaGravada: true, respostasGravadas: true, assinaturaGravada: false, queriaAssinar: true,
  })
  assert.match(f, /assinatura/i)
  assert.match(f, /não precisa refazer/i)
  assert.notEqual(f, avisoDoQueGravou({
    fichaGravada: true, respostasGravadas: false, assinaturaGravada: false, queriaAssinar: true,
  }))
})

test('respostas faltando vence assinatura faltando: o buraco maior é o que se conta primeiro', () => {
  const f = avisoDoQueGravou({
    fichaGravada: true, respostasGravadas: false, assinaturaGravada: false, queriaAssinar: true,
  })
  assert.match(f, /respostas/i)
})

/* ── O selo do sucesso ────────────────────────────────────────────────────── */

test('o selo NUNCA diz assinado quando não assinou (D22)', () => {
  assert.match(selo({ queriaAssinar: true, assinaturaGravada: true }), /assinado/i)
  for (const caso of [
    { queriaAssinar: false, assinaturaGravada: false },
    { queriaAssinar: true, assinaturaGravada: false },
    { queriaAssinar: false, assinaturaGravada: true },
  ]) {
    assert.match(selo(caso), /sem assinatura/i)
    assert.doesNotMatch(selo(caso), /assinado por você/i)
  }
})

test('aba de "entrar como" (API em Go): frase própria, e diz que nada foi gravado', () => {
  assert.match(recusaDaSenha('entrou_como_outra_pessoa'), /outra pessoa/)
  assert.match(recusaDaSenha('entrou_como_outra_pessoa'), /nada foi gravado/i)
})
