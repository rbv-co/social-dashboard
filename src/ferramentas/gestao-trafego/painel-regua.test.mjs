// O painel da régua PRECISA montar sem estourar.
//
// POR QUE ESTE ARQUIVO EXISTE (13/08/2026): a aba "A régua" ficou COMPLETAMENTE
// quebrada por um dia inteiro e ninguém viu. Ao clicar nela, o navegador dava
//
//     ReferenceError: Cannot access 'campo' before initialization
//
// e a aba não pintava nada. A causa: `montarPainelRegua` usa o ajudante
// `campo(...)` do módulo lá em cima (para desenhar os pesos), e lá embaixo, na
// parte da persona, declarava `const campo = document.getElementById(...)`. Um
// `const` vale para a FUNÇÃO INTEIRA, inclusive antes da linha onde aparece —
// então o uso de cima passou a apontar para o `const` de baixo, que ainda não
// existia. Zona morta.
//
// Isso entrou junto com a persona (commit ebf162d, 12/08) e passou porque este
// arquivo não tinha teste NENHUM: `npm test` ficava verde, o build ficava verde,
// e a tela estava morta. É o mesmo buraco que o B4b das pendências apontava —
// "subiu sem ninguém ver na tela".
//
// A guarda é grosseira de propósito: montar o painel e conferir que ele monta.
// Qualquer sombra de variável, qualquer erro em tempo de execução no caminho de
// montagem, cai aqui antes de chegar ao dono.

import test from 'node:test';
import assert from 'node:assert/strict';
import { montarPainelRegua } from './painel-regua.js';
import { normalizarRegua } from './regua.js';

// DOM de mentira, o mínimo que o painel encosta. `getElementById` devolvendo
// null é o cenário mais duro: todos os `if (x && ...)` do painel têm que
// aguentar. Se o painel passar a exigir um elemento de verdade, é aqui que se
// descobre.
function comDomFalso(rodar) {
  const antes = globalThis.document;
  globalThis.document = { getElementById: () => null };
  try {
    return rodar();
  } finally {
    if (antes === undefined) delete globalThis.document;
    else globalThis.document = antes;
  }
}

function alvoFalso() {
  return { innerHTML: '', querySelectorAll: () => [] };
}

// ── DOM de mentira COM elementos, para o caminho do upload ───────────────────
//
// O de cima (getElementById => null) prova que o painel monta. Este aqui prova o
// que acontece DEPOIS do await da leitura do arquivo — que é onde mora o defeito
// do PDF: a leitura demora dezenas de segundos e o painel pode se redesenhar no
// meio, trocando os elementos por baixo.

function elementoFalso(id) {
  return {
    id,
    value: '',
    textContent: '',
    dataset: {},
    files: null,
    ouvintes: {},
    classList: { toggle() {} },
    addEventListener(evento, fn) { (this.ouvintes[evento] ||= []).push(fn); },
  };
}

function domComElementos(contaId) {
  const mapa = new Map();
  for (const id of ['pnd-persona', 'pnd-persona-status', 'pnd-persona-conta',
                    'pnd-persona-frase', 'pnd-persona-salvar', 'pnd-persona-upload']) {
    mapa.set(id, elementoFalso(id));
  }
  mapa.get('pnd-persona').dataset.contaId = String(contaId);
  return {
    mapa,
    document: { getElementById: (id) => mapa.get(id) || null },
    // Simula o redesenho do painel: os elementos viram OUTROS objetos, como
    // acontece de verdade quando o innerHTML é reescrito.
    remontar(novaContaId) {
      for (const id of [...mapa.keys()]) mapa.set(id, elementoFalso(id));
      mapa.get('pnd-persona').dataset.contaId = String(novaContaId);
    },
    sumirCampo() { mapa.delete('pnd-persona'); },
  };
}

const OPCOES_BASE = {
  regua: normalizarRegua({}),
  editavel: true,
  carregouOk: true,
  nomeConta: 'Mantova Móveis',
  // Sem `contaId` o bloco da persona vira o convite "escolha uma conta lá em
  // cima" — é o estado legítimo de quem abriu a aba antes de escolher conta, e
  // não serve para testar o editor.
  contaId: 'de592c37-9a0e-40a3-98c3-2b44a5db57ac',
};

test('monta o painel sem estourar — a zona morta do `campo` cai aqui', () => {
  comDomFalso(() => {
    const alvo = alvoFalso();
    // Se alguém voltar a sombrear um ajudante do módulo, isto lança.
    assert.doesNotThrow(() => montarPainelRegua(alvo, OPCOES_BASE));
    assert.ok(alvo.innerHTML.length > 0, 'o painel tem que pintar alguma coisa');
  });
});

test('os campos de peso saem desenhados — era o uso que estourava', () => {
  comDomFalso(() => {
    const alvo = alvoFalso();
    montarPainelRegua(alvo, OPCOES_BASE);
    for (const k of ['curtidas', 'comentarios', 'salvamentos', 'compartilhamentos']) {
      assert.ok(alvo.innerHTML.includes('pnd-peso-' + k), `faltou o campo do peso "${k}"`);
    }
  });
});

test('o bloco da persona aparece quando há conta escolhida', () => {
  comDomFalso(() => {
    const alvo = alvoFalso();
    montarPainelRegua(alvo, { ...OPCOES_BASE, persona: 'Quem a marca atende.', personaEditavel: true });
    assert.ok(alvo.innerHTML.includes('id="pnd-persona"'), 'faltou o campo da persona');
    assert.ok(alvo.innerHTML.includes('pnd-persona-salvar'), 'faltou o botão de salvar a persona');
  });
});

test('quem NÃO é administrador vê a persona sem botão de salvar', () => {
  comDomFalso(() => {
    const alvo = alvoFalso();
    montarPainelRegua(alvo, { ...OPCOES_BASE, persona: 'Texto.', personaEditavel: false });
    assert.ok(alvo.innerHTML.includes('id="pnd-persona"'), 'o campo continua à vista');
    assert.ok(!alvo.innerHTML.includes('pnd-persona-salvar'), 'não pode oferecer salvar a quem não pode');
  });
});

test('o botão de trazer de um arquivo aceita Word, PDF e texto', () => {
  comDomFalso(() => {
    const alvo = alvoFalso();
    montarPainelRegua(alvo, { ...OPCOES_BASE, persona: '', personaEditavel: true });
    // O dono pediu upload "como pdf, word, enfim" (12/08). Se alguém tirar um
    // formato da lista sem querer, o caminho some da tela sem aviso.
    assert.ok(alvo.innerHTML.includes('pnd-persona-upload'), 'faltou o campo de arquivo');
    for (const ext of ['.docx', '.pdf', '.txt', '.md']) {
      assert.ok(alvo.innerHTML.includes(ext), `o upload deixou de aceitar ${ext}`);
    }
  });
});

// ── O redesenho no meio da leitura do arquivo ───────────────────────────────
//
// MEDIDO NA TELA REAL (13/08/2026): subir um PDF com o Gestor de Tráfego ainda
// carregando fazia o texto SUMIR sem aviso. A edge respondia 200 com o texto, e
// o campo ficava vazio — porque o painel se redesenhou no meio da leitura (a IA
// leva de 10 a 60 segundos) e o código escrevia no elemento velho, órfão.
// Com a tela parada, o mesmo arquivo chegava. Custava dinheiro e não avisava.

const CONTA_A = 'de592c37-9a0e-40a3-98c3-2b44a5db57ac';
const CONTA_B = '0cc4f2b4-4d21-41e9-9b39-fb1d4043aa9b';

// Monta o painel, dispara o upload e devolve o controle da leitura, para o teste
// decidir o que acontece ENTRE o clique e a resposta da IA.
function montarComUpload(dom, contaId) {
  let resolver;
  const opcoes = {
    ...OPCOES_BASE,
    contaId,
    personaEditavel: true,
    aoLerArquivo: () => new Promise((r) => { resolver = r; }),
  };
  const antes = globalThis.document;
  globalThis.document = dom.document;
  try {
    montarPainelRegua(alvoFalso(), opcoes);
  } finally {
    globalThis.document = antes;
  }
  const upload = dom.mapa.get('pnd-persona-upload');
  upload.files = [{ name: 'persona.pdf' }];
  return {
    async subir() {
      globalThis.document = dom.document;
      const p = upload.ouvintes.change[0]();
      return { p, entregar: async (texto) => { resolver(texto); await p; globalThis.document = antes; } };
    },
  };
}

test('o texto do arquivo chega quando o painel NÃO se redesenhou', async () => {
  const dom = domComElementos(CONTA_A);
  const { subir } = montarComUpload(dom, CONTA_A);
  const { entregar } = await subir();
  await entregar('PERSONA VINDA DO PDF');
  assert.equal(dom.mapa.get('pnd-persona').value, 'PERSONA VINDA DO PDF');
  assert.match(dom.mapa.get('pnd-persona-status').textContent, /Trouxe 20 caracteres/);
});

test('painel redesenhado para a MESMA conta: o texto entra no campo NOVO', async () => {
  const dom = domComElementos(CONTA_A);
  const { subir } = montarComUpload(dom, CONTA_A);
  const { entregar } = await subir();
  dom.remontar(CONTA_A);              // loadGtData terminou e remontou a régua
  await entregar('PERSONA VINDA DO PDF');
  // Sem o conserto, isto ia para o elemento órfão e o campo ficava vazio.
  assert.equal(dom.mapa.get('pnd-persona').value, 'PERSONA VINDA DO PDF');
});

test('trocou de CONTA no meio: não escreve a persona de uma marca na outra', async () => {
  const dom = domComElementos(CONTA_A);
  const { subir } = montarComUpload(dom, CONTA_A);
  const { entregar } = await subir();
  dom.remontar(CONTA_B);              // o dono trocou de conta enquanto a IA lia
  await entregar('PERSONA DA CONTA A');
  assert.equal(dom.mapa.get('pnd-persona').value, '', 'não pode vazar de uma conta para outra');
  assert.match(dom.mapa.get('pnd-persona-status').textContent, /trocou de conta/i);
});

test('saiu da aba no meio: avisa em vez de engolir', async () => {
  const dom = domComElementos(CONTA_A);
  const { subir } = montarComUpload(dom, CONTA_A);
  const { entregar } = await subir();
  dom.sumirCampo();
  await entregar('PERSONA VINDA DO PDF');
  assert.match(dom.mapa.get('pnd-persona-status').textContent, /Saí da tela|suba outra vez/i);
});
