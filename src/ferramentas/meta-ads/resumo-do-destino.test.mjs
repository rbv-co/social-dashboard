import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resumoDoDestino } from './resumo-do-destino.js';

// POR QUE ESTE ARQUIVO EXISTE (pendência B4, medida em 12/08/2026):
// O dono relatou "gerei e subiu só do Tivoli, faltou Dom Pedro" e a suspeita caiu no laço
// multi-loja do coletor. Medido nos 5 jobs de subida do banco: o laço nunca perdeu loja — nas 2
// vezes em que o destino tinha 2 lojas, subiram 2 campanhas. Quando subiu uma só, o destino já
// chegava com uma só. A causa é a TELA: `destino.lojas` nasce ['tivoli'] e a segunda loja depende
// de um chip pequeno que passa despercebido. A tela não mentia — ela simplesmente não dizia
// (PADRÃO item 9). Esta função é a frase que ela passa a dizer ANTES de o dono clicar em Subir.

const LOJAS = [{ slug: 'tivoli', nome: 'Tivoli' }, { slug: 'dp', nome: 'Dom Pedro' }];

test('uma loja selecionada: diz quantas campanhas E nomeia a que vai ficar de fora', () => {
  const r = resumoDoDestino({ tipo: 'nova', lojas: ['tivoli'] }, LOJAS);
  assert.equal(r.texto, 'Vai criar 1 campanha nova: Tivoli.');
  assert.equal(r.fora, 'Dom Pedro não vai receber campanha.');
  assert.equal(r.atencao, true);
});

test('todas as lojas selecionadas: nada fica de fora, sem aviso', () => {
  const r = resumoDoDestino({ tipo: 'nova', lojas: ['tivoli', 'dp'] }, LOJAS);
  assert.equal(r.texto, 'Vai criar 2 campanhas novas: Tivoli e Dom Pedro.');
  assert.equal(r.fora, null); // PADRÃO item 9: aviso que aparece sempre vira paisagem
  // e a tarja NÃO fica âmbar: aqui não há nada a alertar. Conferido na tela em 12/08/2026 —
  // o âmbar em todos os casos era o próprio item 9 sendo desrespeitado pela cor.
  assert.equal(r.atencao, false);
});

test('nenhuma loja: fala que não vai sair nada, não fica em branco', () => {
  const r = resumoDoDestino({ tipo: 'nova', lojas: [] }, LOJAS);
  assert.equal(r.texto, 'Nenhuma loja selecionada — não vai subir nada.');
  assert.equal(r.fora, null);
  assert.equal(r.atencao, true); // não sair nada É o caso que mais precisa de alerta
});

test('três lojas de fora saem separadas por vírgula e "e"', () => {
  const tres = [...LOJAS, { slug: 'atacado', nome: 'Atacado' }];
  const r = resumoDoDestino({ tipo: 'nova', lojas: ['tivoli'] }, tres);
  assert.equal(r.fora, 'Dom Pedro e Atacado não vão receber campanha.');
});

test('destino "existente" não fala de loja nenhuma', () => {
  assert.equal(resumoDoDestino({ tipo: 'existente', campaignId: '123' }, LOJAS), null);
});
