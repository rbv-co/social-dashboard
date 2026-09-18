// supabase/functions/vessel-registrar-garantia/revisao-final.test.mjs
//
// Achados da revisão final da branch inteira (17/09/2026) que caem nesta
// edge: C2 (a página de ensaio não pode gravar em produção), C3 (teto de
// tentativas de "É presente?") e I3 (ja_tem_dono cravado em ramo de erro).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FONTE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.ts'), 'utf8');

test('⚠️ C2 — as duas chamadas a vessel_registrar_como_cliente repassam p_so_teste', () => {
  // Sem repassar, a página de ensaio /verify/novo poderia mandar so_teste, e a
  // edge simplesmente IGNORARIA — a trava do banco nunca seria acionada.
  const chamadas = FONTE.split("rpc('vessel_registrar_como_cliente'").slice(1);
  assert.equal(chamadas.length, 2, 'esperava duas chamadas a vessel_registrar_como_cliente (presente e normal)');
  for (const c of chamadas) {
    const bloco = c.slice(0, c.indexOf('});') + 3);
    assert.match(bloco, /p_so_teste\s*:\s*corpo\.so_teste\s*===\s*true/,
      'a chamada precisa forçar booleano (corpo.so_teste === true), nunca repassar o valor cru');
  }
});

test('⚠️ I1 (lado da edge) — o caminho do presente repassa o nome digitado', () => {
  const inicio = FONTE.indexOf('if (corpo.presente_de)');
  const fimBloco = FONTE.indexOf('// ── REGISTRO NORMAL');
  const bloco = FONTE.slice(inicio, fimBloco);
  assert.match(bloco, /p_presente_de_nome\s*:\s*corpo\.presente_de/,
    'sem isso presente_de_nome nasce e continua sem ser gravado pelo caminho do presente');
});

test('⚠️ C3 — a edge confere o teto de tentativas ANTES de buscar candidatos', () => {
  const inicio = FONTE.indexOf('if (corpo.presente_de)');
  const posTentativa = FONTE.indexOf("rpc('vessel_tentativa_de_presente'", inicio);
  const posCandidatos = FONTE.indexOf("rpc('vessel_candidatos_de_presente'", inicio);
  assert.ok(posTentativa > -1, 'falta a chamada a vessel_tentativa_de_presente no caminho do presente');
  assert.ok(posCandidatos > -1, 'falta a chamada a vessel_candidatos_de_presente');
  assert.ok(posTentativa < posCandidatos,
    'o teto tem de ser conferido ANTES de buscar candidatos — senão a busca já revela informação');
});

test('⚠️ C3 — estourado o teto, a edge nunca chega a rodar o casamento de nome', () => {
  const inicio = FONTE.indexOf("rpc('vessel_tentativa_de_presente'");
  const posCandidatos = FONTE.indexOf("rpc('vessel_candidatos_de_presente'", inicio);
  const bloco = FONTE.slice(inicio, posCandidatos);
  assert.match(bloco, /permitido/, 'a edge precisa ler o campo "permitido" da resposta');
  assert.match(bloco, /estado:\s*'pendente'/,
    'estourado o teto, a resposta tem de ser pendente — sem rodar nomesBatem/nomesChegamPerto');
});

test('⚠️ I3 — decidirPeloBlingComoCliente usa o ja_tem_dono DE VERDADE nos ramos de erro', () => {
  const inicio = FONTE.indexOf('async function decidirPeloBlingComoCliente');
  const fim = FONTE.indexOf('Deno.serve', inicio);
  const corpo = FONTE.slice(inicio, fim);
  // Antes: os dois ramos de falha (rpc com error, e rpc que respondeu !ok)
  // cravavam `ja_tem_dono: true` literal — uma peça LIVRE podia ser anunciada
  // como já tendo dona só porque o rpc de decisão tropeçou.
  assert.ok(!/ja_tem_dono:\s*true\b/.test(corpo),
    'ja_tem_dono não pode ser um literal true — tem de vir de aberto.ja_tem_dono');
  const ocorrencias = corpo.match(/ja_tem_dono:\s*aberto\.ja_tem_dono\s*===\s*true/g) ?? [];
  assert.ok(ocorrencias.length >= 3,
    `os três retornos de decidirPeloBlingComoCliente (sem achado, erro do rpc, !ok) têm de usar o valor de verdade — achei ${ocorrencias.length}`);
});
