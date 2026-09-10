import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seguidoresDoCusto, FONTES } from './seguidores-do-custo.js';
import { cartoesDoBalde } from './cartoes-do-balde.js';

// O CASO REAL QUE ORIGINOU ESTE MÓDULO (medido na tela em 20/08/2026):
// Raíssa, período HOJE. O cartão de seguidores mostrava 53 e o de custo mostrava
// R$ 16,76 sobre R$ 435,88 de investimento. 435,88 ÷ 53 = R$ 8,22; o único
// divisor que produz R$ 16,76 é 26 — a foto que o coletor tinha tirado de manhã.
const RAISSA_HOJE = {
  investimento: 435.88,
  impressoNaTela: 53,   // ao vivo: contagem de agora − contagem de ontem
  coletadoDeManha: 26,  // daily_snapshots: o que o coletor viu na última passada
};

const centavos = (v) => Math.round(v * 100) / 100;

test('o caso da Raíssa: o custo passa a dividir os 53 da tela, não os 26 do banco', () => {
  const s = seguidoresDoCusto({
    live: { seguiu: 9, anteriorSeguiu: 40 },
    ehRecenteLive: true,
    numeroImpresso: RAISSA_HOJE.impressoNaTela,
    coletado: { bruto: RAISSA_HOJE.coletadoDeManha, brutoAnterior: 31, previa: false },
  });
  assert.equal(s.valor, 53, 'divide o número que está impresso no cartão de cima');
  assert.equal(s.fonte, FONTES.impressoAoVivo);

  const cps = cartoesDoBalde('seguidores', { investimento: RAISSA_HOJE.investimento, seguidores: s.valor })
    .find((c) => c.id === 'cps');
  assert.equal(centavos(cps.valor), 8.22, 'é a conta que o dono faz na mão');
  assert.notEqual(centavos(cps.valor), 16.76, 'o número velho não pode voltar');
});

test('HOJE/1D sempre sai marcado como prévia — e sem comparação com o anterior', () => {
  const s = seguidoresDoCusto({
    live: { seguiu: 9, anteriorSeguiu: 40 },
    ehRecenteLive: true,
    numeroImpresso: 53,
    coletado: { bruto: 26, brutoAnterior: 31, previa: false },
  });
  assert.equal(s.previa, true, 'a contagem ainda se ajusta quando o Instagram fecha o dia');
  assert.equal(s.anterior, null, 'líquido de hoje contra bruto de ontem são medidas diferentes');
});

test('7D com ao vivo: divide o BRUTO da MESMA leitura, não o do banco', () => {
  const s = seguidoresDoCusto({
    live: { seguiu: 319, anteriorSeguiu: 280 },
    ehRecenteLive: false,
    numeroImpresso: 189, // o cartão mostra o líquido; o custo NUNCA divide por ele
    coletado: { bruto: 305, brutoAnterior: 260, previa: false },
  });
  assert.equal(s.valor, 319, 'a régua continua sendo o bruto — só que da leitura ao vivo');
  assert.equal(s.anterior, 280, 'o anterior vem da mesma fonte, senão a seta compara duas medidas');
  assert.equal(s.previa, false);
  assert.equal(s.fonte, FONTES.brutoAoVivo);
});

test('sem ao vivo, nada muda: é o caminho coletado inteiro, com o selo que a tela já calculava', () => {
  const s = seguidoresDoCusto({
    live: null,
    ehRecenteLive: false,
    numeroImpresso: 189,
    coletado: { bruto: 305, brutoAnterior: 260, previa: true },
  });
  assert.equal(s.valor, 305);
  assert.equal(s.anterior, 260);
  assert.equal(s.previa, true, 'o cpsPrevia de sempre continua mandando neste caminho');
  assert.equal(s.fonte, FONTES.coletado);
});

test('ao vivo sem período anterior não inventa comparação', () => {
  const s = seguidoresDoCusto({
    live: { seguiu: 319, anteriorSeguiu: null },
    ehRecenteLive: false,
    numeroImpresso: 189,
    coletado: { bruto: 305, brutoAnterior: 260, previa: false },
  });
  assert.equal(s.anterior, null, 'null é "não sei" — nunca o número do banco por baixo');
});

// "NÃO SEI" NÃO PODE VIRAR ZERO, e zero não pode virar custo. Quem transforma
// isso em "—" é o div() de cartoes-do-balde.js; aqui só se garante que o valor
// chega até lá do jeito que veio.
test('valor ausente ou estragado vira null, e o cartão mostra "—" em vez de R$ 0,00', () => {
  for (const ruim of [undefined, null, NaN, 'abc']) {
    const s = seguidoresDoCusto({
      live: { seguiu: 10, anteriorSeguiu: 5 },
      ehRecenteLive: true,
      numeroImpresso: ruim,
      coletado: { bruto: 26, brutoAnterior: 31, previa: false },
    });
    assert.equal(s.valor, null, `"${String(ruim)}" não é denominador`);
    const cps = cartoesDoBalde('seguidores', { investimento: 435.88, seguidores: s.valor }).find((c) => c.id === 'cps');
    assert.equal(cps.valor, null, 'sem denominador o cartão fica em "—", nunca em R$ 0,00');
  }
});

test('dia que perdeu mais gente do que ganhou não vira custo negativo', () => {
  const s = seguidoresDoCusto({
    live: { seguiu: 2, anteriorSeguiu: 40 },
    ehRecenteLive: true,
    numeroImpresso: -7,
    coletado: { bruto: 26, brutoAnterior: 31, previa: false },
  });
  assert.equal(s.valor, -7, 'o número passa como veio; quem recusa é a divisão');
  const cps = cartoesDoBalde('seguidores', { investimento: 435.88, seguidores: s.valor }).find((c) => c.id === 'cps');
  assert.equal(cps.valor, null, 'nem custo negativo, nem R$ 0,00 — "—"');
});

test('entrada vazia não quebra: cai no coletado e devolve null', () => {
  const s = seguidoresDoCusto();
  assert.equal(s.valor, null);
  assert.equal(s.anterior, null);
  assert.equal(s.previa, false);
  assert.equal(s.fonte, FONTES.coletado);
});

test('⚠️ dia sem bruto na janela → o custo sai marcado como prévia', () => {
  /* Medido em 09/09/2026: a janela [05/09, 09/09) tem quatro dias, o dia 08 não
   * foi publicado, e a Meta devolve o agregado dos TRÊS publicados. O bruto vem
   * subestimado, então o custo por seguidor sai ALTO DEMAIS — e saía sem aviso.
   *
   * O denominador continua sendo o BRUTO (quem seguiu): custo de aquisição não
   * divide por líquido, senão quem saiu entra na conta de quem foi conquistado.
   * O que muda é só a honestidade do selo. */
  const r = seguidoresDoCusto({
    live: { seguiu: 907, anteriorSeguiu: 800 },
    ehRecenteLive: false,
    numeroImpresso: 1326,
    estimado: true,
    coletado: { bruto: 907, brutoAnterior: 800, previa: false },
  })
  assert.equal(r.valor, 907, 'continua dividindo o BRUTO')
  assert.equal(r.previa, true, 'mas avisa que o número ainda se mexe')
})

test('janela completa segue sem selo de prévia', () => {
  const r = seguidoresDoCusto({
    live: { seguiu: 951, anteriorSeguiu: 800 },
    ehRecenteLive: false,
    numeroImpresso: 920,
    estimado: false,
    coletado: { bruto: 951, brutoAnterior: 800, previa: false },
  })
  assert.equal(r.valor, 951)
  assert.equal(r.previa, false)
})
