/* A GRAVAÇÃO COM VIDA — e a regra que não pode ser quebrada por ela.
 *
 * O botão só trocava de texto para "Encoste a etiqueta…". Quem grava está de pé
 * na bancada, com a bolsa numa mão e o celular na outra, e precisa entender pelo
 * canto do olho.
 *
 * MAS A ANIMAÇÃO NUNCA PODE SER A ÚNICA FORMA DE SABER O QUE ACONTECEU. Quem
 * desliga animação no sistema costuma ter motivo, e nesses casos o estado tem de
 * aparecer sem se mexer — mas aparecer. É isso que estes testes seguram: sem
 * eles, a próxima animação entra sem o `prefers-reduced-motion` e o único aviso
 * de "gravou" some para quem não pode ver movimento.
 *
 * É pelo código-fonte porque `node --test` não compila `.vue` — mesma técnica de
 * `gravar-marca-a-peca-certa.test.mjs`. O que é visual foi MEDIDO no navegador.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const fonte = readFileSync(new URL('./tela-de-autenticidade.vue', import.meta.url), 'utf8');
const template = fonte.slice(0, fonte.indexOf('<script setup>'));
const script = fonte.slice(fonte.indexOf('<script setup>'), fonte.indexOf('</script>'));
const estilo = fonte.slice(fonte.indexOf('<style scoped>'));

/** O corpo de uma função do `<script setup>`, por contagem de chaves. */
function corpoDaFuncao(nome) {
  const abre = script.indexOf(`function ${nome}(`);
  assert.notEqual(abre, -1, `função ${nome} sumiu da tela`);
  let nivel = 0;
  const i = script.indexOf('{', abre);
  for (let j = i; j < script.length; j += 1) {
    if (script[j] === '{') nivel += 1;
    else if (script[j] === '}') { nivel -= 1; if (nivel === 0) return script.slice(i, j + 1); }
  }
  throw new Error(`não achei o fim de ${nome}`);
}

/* ── A REGRA QUE IMPORTA ─────────────────────────────────────────────────── */

/* ⚠️ ESTE TESTE FICOU MAIS LARGO EM 01/09/2026, e por um motivo concreto: ele
 * só enxergava regra de UMA classe escrita no começo da linha (`^.classe{`). A
 * animação dos anéis é escrita por ESTADO — `.au-aneis-gravando .au-anel-2{…}` —
 * e passava inteira por baixo dele, sem nenhum erro. Um teste que "passa o
 * alvo" é pior que teste nenhum, porque dá sossego.
 * Agora ele lê TODA regra com `animation:`, seja qual for a forma do seletor, e
 * cobra que pelo menos uma das classes daquele seletor esteja citada dentro do
 * bloco de movimento reduzido. */
test('TODA animação desta tela é desligada por prefers-reduced-motion', () => {
  const reduz = estilo.indexOf('@media (prefers-reduced-motion: reduce)');
  assert.notEqual(reduz, -1, 'nenhuma animação pode entrar sem este bloco');
  const dentro = estilo.slice(reduz, estilo.indexOf('\n}', reduz));

  // toda REGRA que anima, tirada do próprio CSS: animação nova entra aqui
  // sozinha e reprova se ninguém a desligar. Os `@keyframes` ficam de fora — o
  // que se desliga é o elemento, não a receita do movimento.
  const semKeyframes = estilo.replace(/@keyframes[^{]*\{(?:[^{}]|\{[^{}]*\})*\}/g, '');
  const soltas = [];
  for (const m of semKeyframes.matchAll(/([^{}]+)\{([^}]*\banimation:(?!none)[^}]*)\}/g)) {
    const seletor = m[1].split('\n').pop().trim();
    const classes = [...seletor.matchAll(/\.([\w-]+)/g)].map((c) => c[1]);
    if (!classes.length) continue;
    if (!classes.some((cls) => dentro.includes(`.${cls}`))) soltas.push(seletor);
  }
  assert.ok(
    [...semKeyframes.matchAll(/\banimation:(?!none)/g)].length >= 6,
    'quase nenhuma regra animada encontrada — o teste perdeu o alvo de novo',
  );
  assert.deepEqual(soltas, [], 'anima e não é desligada com movimento reduzido: ' + soltas.join(' | '));

  /* ⚠️ E DESLIGAR TEM DE GANHAR A DISPUTA. Citar a classe no bloco não basta:
   * as regras de estado têm DUAS classes no seletor
   * (`.au-aneis-gravando .au-anel-2`) e a de desligar tinha UMA
   * (`.au-aneis circle`). Quem tem mais especificidade ganha, esteja onde
   * estiver no arquivo — e o bloco inteiro virava enfeite. Medido no navegador
   * com `prefers-reduced-motion: reduce` ligado, em 01/09/2026: `animationName`
   * continuava `au-onda`. O `!important` é o único jeito de não depender de
   * contar classe a cada regra nova. */
  for (const m of dentro.matchAll(/(animation|transition|transform|opacity):\s*([^;}]+)/g)) {
    assert.match(m[2], /!important/,
      `\`${m[0].trim()}\` sem \`!important\`: a regra de estado tem mais classes no `
      + 'seletor e ganha desta, e o bloco de movimento reduzido não desliga nada');
  }
});

test('os quatro estados dos anéis continuam DISTINGUÍVEIS sem movimento', () => {
  // "prefers-reduced-motion mostra os mesmos estados parados e distinguíveis —
  // não some tudo" foi o pedido, com estas palavras. Sem movimento, o que separa
  // um estado do outro é a COR do anel (token), o núcleo vazio ou cheio, e o ✓.
  const reduz = estilo.indexOf('@media (prefers-reduced-motion: reduce)');
  const dentro = estilo.slice(reduz, estilo.indexOf('\n}', reduz));
  for (const estado of ['esperando', 'gravando', 'ok', 'fim']) {
    assert.ok(dentro.includes(`.au-aneis-${estado}`),
      `o estado ${estado} some quando o movimento é desligado`);
  }
  // o ✓ do "gravou" tem de voltar VISÍVEL: o keyframes dele começa em opacity 0
  assert.match(dentro, /\.au-aneis-ok \.au-anel-visto[^{]*\{opacity:1!important\}/,
    'sem devolver a opacidade, o ✓ fica invisível para quem desligou animação');
  // e cada estado tem uma cor de TOKEN própria, que é o que se lê parado
  for (const [estado, token] of [
    ['esperando', '--accent'], ['gravando', '--orange'], ['ok, .au-aneis-fim', '--green'],
    ['erro', '--red'],
  ]) {
    const cls = `.au-aneis-${estado}`;
    const regra = estilo.match(new RegExp(`\\${cls.replace('.', '.')}\\{color:var\\(${token}\\)\\}`));
    assert.ok(regra, `o estado ${estado} não tem cor de token própria (${token})`);
  }
});

test('nada pisca mais de 3 vezes por segundo — é gatilho de convulsão', () => {
  // contado, não estimado: em "gravando", o mais rápido, cada anel acende uma vez
  // a cada 1,2s e são três defasados em 0,4s — 2,5 acendimentos por segundo no
  // conjunto. Este teste lê as durações do próprio CSS.
  const ciclos = [...estilo.matchAll(/animation:\s*au-(onda|onda-curta|respira)\s+([\d.]+)s/g)]
    .map((m) => Number(m[2]));
  assert.ok(ciclos.length >= 6, 'o teste perdeu o alvo: nenhuma animação em laço encontrada');
  const maisRapida = Math.min(...ciclos);
  // três anéis defasados dentro do MESMO ciclo: o conjunto pisca 3/ciclo
  assert.ok(3 / maisRapida <= 3,
    `o ciclo mais rápido é ${maisRapida}s: com três anéis dá ${(3 / maisRapida).toFixed(1)} `
    + 'acendimentos por segundo, acima do limite de 3');
});

test('com movimento reduzido o sinal continua VISÍVEL, não some junto', () => {
  const reduz = estilo.indexOf('@media (prefers-reduced-motion: reduce)');
  const dentro = estilo.slice(reduz, estilo.indexOf('\n}', reduz));
  // `animation:none` num keyframes de ENTRADA deixaria o elemento no estado
  // inicial dele — que é `opacity:0`, ou seja, invisível. Desligar o movimento
  // não pode ser desligar a informação.
  assert.match(dentro, /opacity:1/,
    'sem devolver a opacidade, o ✓ fica invisível para quem desligou animação');
  assert.match(dentro, /transform:none/);
});

/* ⚠️ MUDOU DE CARREGADOR EM 01/09/2026, e não de regra. A frase morava num
 * `textoDoSinal` desta tela ("Esperando a etiqueta encostar…", "Peça marcada
 * como gravada.", "Não deu certo. A peça NÃO foi marcada.") desenhado num bloco
 * PRÓPRIO, logo acima do bloco de estado que dizia a MESMA coisa em outras
 * palavras ("Encoste a etiqueta", "Pronto", "Deu erro"). Cada informação aparece
 * uma vez: a frase ficou onde ela já se prova — em `estadoDaBancada`, no módulo
 * puro — e o desenho de canto de olho virou os anéis, dentro do mesmo bloco.
 * A REGRA É A MESMA: a animação nunca é o único aviso. */
test('cada estado da gravação também está ESCRITO, ao lado dos anéis', () => {
  // a animação é para o canto do olho; quem diz o que aconteceu é o texto
  assert.match(template, /\{\{ estadoDaBancadaAgora\.titulo \}\}/, 'o estado tem de ir para a tela');
  assert.match(template, /\{\{ estadoDaBancadaAgora\.detalhe \}\}/, 'o que fazer tem de ir para a tela');
  assert.match(template, /class="au-bancada-estado" role="status"/,
    'sem role="status" o leitor de tela não anuncia a mudança');
  // os anéis são desenho puro: eles não podem ser lidos duas vezes
  assert.match(template, /class="au-aneis"[^>]*aria-hidden="true"/,
    'o desenho tem de sair da árvore de acessibilidade — quem fala é o texto');
  // e o texto continua saindo da conta pura, que se prova em modo-bancada.test.mjs
  assert.match(script, /const estadoDaBancadaAgora = computed\(\(\) => estadoDaBancada\(\{/);
});

/* ── O SINAL DIZ A VERDADE ───────────────────────────────────────────────── */

test('o ✓ só acende quando o BANCO confirmou', () => {
  // ele nasce dentro de `marcarGravada`, o único ponto que sabe a resposta do
  // banco. Acendendo no chamador, o ✓ apareceria para uma peça que não foi
  // marcada — e a tela nunca mente (PADRAO item 9).
  const corpo = corpoDaFuncao('marcarGravada').replace(/\s+/g, ' ');
  assert.match(corpo, /avisarNaTela\('ok'\)/);
  assert.match(corpo, /avisarNaTela\('falha'\).*return false/,
    'o caminho que NÃO marcou tem de acender falha, nunca o ✓');
  const depoisDoOk = corpo.slice(corpo.indexOf("avisarNaTela('ok')"));
  assert.match(depoisDoOk, /^avisarNaTela\('ok'\) return true/,
    'o ✓ e o `return true` andam juntos: separados, um dos dois mente');
});

test('nenhuma saída de gravarNaEtiqueta fica sem sinal', () => {
  const corpo = corpoDaFuncao('gravarNaEtiqueta');
  // os dois caminhos que NÃO passam por marcarGravada: a etiqueta que já tem
  // outra peça, e a leitura de volta que não confere.
  //
  // A PERGUNTA MUDOU DE CASA em 01/09/2026: ela é a MESMA para o celular e para
  // o leitor de mesa, e mora em `abrirPerguntaDeSobrescrita`. O sinal continua
  // sendo aceso pelo RAMO — é ele que sabe que ninguém marcou peça nenhuma.
  const pare = corpo.slice(corpo.indexOf("if (situacao === 'outra-peca')"),
    corpo.indexOf("if (situacao === 'confere')"));
  assert.match(pare, /abrirPerguntaDeSobrescrita\(/, 'o ramo parou de abrir a pergunta');
  assert.match(corpoDaFuncao('abrirPerguntaDeSobrescrita'), /PARE: esta etiqueta/,
    'a pergunta parou de dizer PARE');
  assert.match(pare, /avisarNaTela\('falha'\)/, 'o "PARE" ficou sem sinal');
  const leituraRuim = corpo.slice(corpo.indexOf('não devolveu o endereço certo'));
  assert.match(leituraRuim.slice(0, 260), /avisarNaTela\('falha'\)/,
    'a leitura de volta que não confere ficou sem sinal');
  assert.match(corpo.slice(corpo.indexOf('} catch (erro)')), /avisarNaTela\('falha'\)/,
    'a falha do chip (NFC desligado, etiqueta pequena) ficou sem sinal');
});

test('o sinal some sozinho, e trocar de lote o apaga na hora', () => {
  // ✓ que fica na tela vira paisagem e passa a ser lido como se fosse da
  // PRÓXIMA etiqueta — e aí ele mente
  const corpo = corpoDaFuncao('avisarNaTela').replace(/\s+/g, ' ');
  assert.match(corpo, /clearTimeout\(relogioDoSinal\)/,
    'sem limpar o relógio anterior, o sinal novo some no tempo do antigo');
  assert.match(corpo, /setTimeout\(\(\) => \{ sinalDaGravacao\.value = '' \}/);
  const trocaDeLote = script.slice(script.indexOf('watch(loteEscolhido'));
  assert.match(trocaDeLote.slice(0, trocaDeLote.indexOf('})')), /sinalDaGravacao\.value = ''/,
    'o ✓ do lote anterior sob um lote novo é sinal do lote errado');
});

/* ── PADRAO-DA-CENTRAL, ITEM 8: A BARRA SOMA, NÃO SUBSTITUI ──────────────── */

test('a barra entrou e o texto "N de M" continua na tela', () => {
  assert.match(template, /class="au-barra" role="progressbar"/, 'a barra sumiu');
  assert.match(template, /\{\{ progressoDoLoteAtual\.texto \}\} gravadas neste lote/,
    'barra sozinha não diz quantas faltam nem dá para ler em voz alta na bancada');
  // ⚠️ E APARECE UMA VEZ SÓ. Ele aparecia TRÊS vezes na mesma aba: no rótulo de
  // cada opção do seletor de lote ("— 6 de 20"), aqui na barra, e num
  // "PEÇA 8 DE 20 · 6 DE 19 PRONTAS" logo acima do endereço. O dono chamou a
  // tela de confusa quatro vezes, e repetição é metade da confusão.
  assert.equal((template.match(/\{\{ progressoDoLoteAtual\.texto \}\}/g) || []).length, 1,
    'o progresso voltou a ser escrito em mais de um lugar da aba Gravar');
  assert.doesNotMatch(template, /— \{\{ progressoDoLote\(pecasDoLote\(l\.id\)\)\.texto \}\}<span v-if="loteEstaEncerrado/,
    'o progresso voltou para o rótulo de cada opção do seletor de lote');
  assert.doesNotMatch(template, /\}\} prontas/,
    'voltou o "N de M prontas" — é a terceira cópia do progresso');
  // a barra tem de dizer os mesmos números para quem usa leitor de tela
  assert.match(template, /:aria-valuenow="progressoDoLoteAtual\.gravadas"/);
  assert.match(template, /:aria-valuemax="progressoDoLoteAtual\.total"/);
});

test('a barra não divide por zero num lote sem peça', () => {
  const corpo = script.slice(script.indexOf('const larguraDoProgresso = computed('));
  assert.match(corpo.slice(0, corpo.indexOf('\n})')), /total \?/,
    'sem a guarda, um lote vazio devolve `NaN%` e a barra some sem explicação');
});

test('o progresso fica FORA do que some quando o lote acaba', () => {
  // gravando a última peça, `proxima` vira nulo. Havia um bloco `.au-gravacao`
  // inteiro atrás de `v-if="proxima"`, e ele levava junto o ✓ da etiqueta que a
  // pessoa acabou de encostar. Agora a obra da bancada não tem condição nenhuma:
  // com a fila acabada ela mostra o lote fechado, no lugar de sumir.
  //
  // ⚠️ O PROGRESSO MUDOU DE CAIXA EM 02/09/2026, e não de condição. O painel
  // virou DUAS colunas a pedido do dono, e o progresso foi para a da direita
  // (`.au-bancada-comandos`, "o que você faz"), junto do endereço e dos botões.
  // O que este teste guarda é o mesmo de antes, e agora nas DUAS caixas:
  // nenhuma delas pode ganhar um `v-if`, senão a última etiqueta gravada leva
  // junto o ✓ e a barra que diz que o lote fechou.
  assert.match(template, /<div class="au-bancada-obra">/,
    'a obra da bancada ganhou um `v-if` — com a fila acabada ela sumiria inteira');
  assert.match(template, /<div class="au-bancada-comandos">/,
    'a coluna da ação ganhou um `v-if` — com a fila acabada ela sumiria inteira');
  const obra = template.slice(template.indexOf('<div class="au-bancada-obra">'));
  const progresso = obra.indexOf('class="au-bancada-progresso"');
  assert.ok(progresso > 0, 'sumiu o bloco do progresso');
  // e o número da peça — que é "qual peça está na mão", não progresso — sai de
  // cena quando não há peça nenhuma: quem vira o elemento dominante é o estado
  assert.match(obra.slice(0, progresso), /<p v-if="proxima" class="au-bancada-peca">/);
});
