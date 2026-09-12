import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MOTIVOS, recadoDoPush, deuCerto } from './recado-do-push.js'

test('todo motivo previsto tem recado, e nenhum cai no texto genérico', () => {
  // A lista e as frases moram no mesmo arquivo justamente para não se
  // separarem: motivo novo sem frase é a tela calando de novo.
  for (const m of MOTIVOS) {
    if (m === 'ok') { assert.equal(recadoDoPush(m), ''); continue }
    const frase = recadoDoPush(m)
    assert.ok(frase.length > 20, `${m} precisa de recado`)
    assert.doesNotMatch(frase, /^Não consegui ativar os avisos agora/, `${m} caiu no genérico`)
  }
})

test('deu certo NAO tem recado — quem ativou nao le nada', () => {
  assert.equal(recadoDoPush('ok'), '')
})

test('motivo desconhecido ainda diz alguma coisa, e nunca fica em branco', () => {
  // Silêncio é o defeito que este módulo existe para consertar. Mesmo um caso
  // que ninguém previu tem de virar frase.
  assert.ok(recadoDoPush('coisa-que-nao-existe').length > 10)
  assert.ok(recadoDoPush(undefined).length > 10)
})

// ── O caminho que o dono descobriu sozinho ──────────────────────────────────
// Ele resolveu clicando no ícone ao lado do endereço. Os recados dos casos em
// que isso resolve PRECISAM apontar para lá — foi o que faltou.

test('os casos que se resolvem pelo navegador mandam a pessoa para o topo da janela', () => {
  for (const m of ['negado', 'ignorado', 'demorou']) {
    assert.match(recadoDoPush(m), /topo da janela/, `${m} deveria apontar o caminho que funciona`)
  }
})

test('"ignorado" nao acusa a pessoa de ter negado', () => {
  // No Windows o navegador as vezes nem pergunta. Dizer "voce negou" seria a
  // tela mentindo sobre o que aconteceu.
  const frase = recadoDoPush('ignorado')
  assert.doesNotMatch(frase, /negou|bloqueou/i)
  assert.match(frase, /não chegou a registrar/i)
})

test('o recado de rede nao manda mexer em permissao, porque nao e disso que se trata', () => {
  const frase = recadoDoPush('sem-inscricao')
  assert.match(frase, /rede/i)
  assert.doesNotMatch(frase, /topo da janela/)
})

// ── deuCerto ────────────────────────────────────────────────────────────────

test('deuCerto so aceita ok verdadeiro', () => {
  assert.equal(deuCerto({ ok: true, motivo: 'ok' }), true)
  assert.equal(deuCerto({ ok: false, motivo: 'negado' }), false)
  assert.equal(deuCerto(null), false)
  assert.equal(deuCerto(undefined), false)
  // O formato antigo era um booleano solto; se alguém voltar a devolver isso,
  // `deuCerto` recusa em vez de aceitar por engano.
  assert.equal(deuCerto(true), false)
})
