import test from 'node:test';
import assert from 'node:assert/strict';
import { FERRAMENTAS, ferramentaDisponivel, reduzir } from './reduzir-imagem.mjs';

/* ⚠️ O ROBO DAS FOTOS ESTAVA PRESO A UM MAC.
 *
 * Ele chamava `sips` direto, que e nativo do macOS. Se o Mac estivesse dormindo
 * as 8h05, ninguem tirava foto nenhuma naquele dia — e aconteceu: das tres
 * execucoes no log, duas morreram por falta de rede. O dono pediu que rodasse
 * sem depender do computador de ninguem. */

test('a escolha e por EXISTENCIA, e nao por sistema operacional', () => {
  /* Testar `process.platform` seria pior: um Mac sem `sips`, ou um Linux com
   * ele instalado, cairia no caminho errado. */
  assert.equal(ferramentaDisponivel(() => false), null);
  assert.equal(ferramentaDisponivel((c) => c === 'magick').nome, 'magick');
  assert.equal(ferramentaDisponivel((c) => c === 'convert').nome, 'convert');
  assert.equal(ferramentaDisponivel(() => true).nome, 'sips', 'com todas, o sips vem primeiro');
});

test('⚠️ o ImageMagick so ENCOLHE, nunca estica', () => {
  /* Sem o `>` no fim, foto menor que o teto seria ESTICADA — e foto esticada
   * fica borrada na tela da cliente. */
  for (const nome of ['magick', 'convert']) {
    const f = FERRAMENTAS.find((x) => x.nome === nome);
    const args = f.argumentos('e.png', 's.jpg', 1400);
    assert.ok(args.includes('1400x1400>'), `${nome} esticaria foto pequena`);
  }
});

test('as tres ferramentas produzem o MESMO tamanho e a mesma qualidade', () => {
  for (const f of FERRAMENTAS) {
    const args = f.argumentos('entrada.png', 'saida.jpg', 1400).join(' ');
    assert.match(args, /1400/, `${f.nome} nao recebeu a largura`);
    assert.match(args, /55/, `${f.nome} nao recebeu a qualidade`);
    assert.match(args, /entrada\.png/);
    assert.match(args, /saida\.jpg/);
  }
});

test('`convert` fica por ULTIMO — ele e ambiguo em algumas maquinas', () => {
  // Em ImageMagick 6 `convert` e o certo, mas o nome colide com outro programa
  // em Windows. `magick` nunca e ambiguo.
  assert.equal(FERRAMENTAS[FERRAMENTAS.length - 1].nome, 'convert');
});

test('⚠️ SEM ferramenta nenhuma, ESTOURA — nao segue calado', () => {
  /* Silencio aqui viraria foto original de 326 KB indo para o site, ou nenhuma
   * foto e ninguem sabendo por que. */
  assert.throws(
    () => reduzir('a.png', 'b.jpg', 1400, { existe: () => false, rodar: () => {} }),
    /sips|ImageMagick/,
  );
});

test('reduzir CHAMA a ferramenta com os argumentos dela, e diz qual usou', () => {
  const chamadas = [];
  const usou = reduzir('a.png', 'b.jpg', 1400, {
    existe: (c) => c === 'magick',
    rodar: (cmd, args) => chamadas.push([cmd, args]),
  });
  assert.equal(usou, 'magick');
  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0][0], 'magick');
  assert.ok(chamadas[0][1].includes('1400x1400>'));
});
