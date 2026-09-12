// A JANELA DE DATAS DOS ANÚNCIOS MORA EM DOIS LUGARES. Este teste existe para que
// os dois nunca divirjam em silêncio — irmão do acoes-python-e-nuvem-batem.
//
// DOIS robôs gravam `campaign_insights` e `account_insights`, em duas linguagens:
//   1. o coletor da nuvem  → supabase/functions/_shared/janela-de-ads.js
//   2. o coletor deste Mac → projetos/.../redes-sociais/coletor/janela_de_ads.py
//
// E eles gravam com a MESMA chave (account_id, captured_at, period_days): quem roda
// por último vence. Consertar a janela num lado só seria o outro desfazendo o
// conserto — o do Mac roda 5x por dia pelo launchd. Foi exatamente esse par que, com
// `until = hoje`, fez "7 dias" cobrir OITO no painel inteiro.
//
// O teste EXECUTA o Python de verdade em vez de ler o texto do arquivo: aqui o que
// importa é a resposta, e uma cópia pode divergir sem mudar uma linha parecida.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { janelaDeAds } from '../../supabase/functions/_shared/janela-de-ads.js';

const AQUI = dirname(fileURLToPath(import.meta.url));
const PASTA_PY = resolve(AQUI, '../../projetos/central-inteligencia/redes-sociais/coletor');

// Datas escolhidas para pegar o que quebra conta de data: virada de mês, virada de
// ano, ano bissexto e um dia comum.
const DIAS = ['2026-08-21', '2026-03-01', '2026-01-01', '2028-03-01', '2026-12-31'];
const RECORTES = [0, 1, 7, 14, 30];

function janelasDoPython() {
  const codigo = [
    'import json',
    'from janela_de_ads import janela_de_ads',
    `dias = ${JSON.stringify(DIAS)}`,
    `recortes = ${JSON.stringify(RECORTES)}`,
    'print(json.dumps({f"{d}|{n}": janela_de_ads(d, n) for d in dias for n in recortes}))',
  ].join('\n');
  // Sem try/catch de propósito: python3 ausente ou módulo quebrado tem de FALHAR o
  // teste, não sumir com ele. Vigia que se desliga sozinho não é vigia.
  const saida = execFileSync('python3', ['-c', codigo], { cwd: PASTA_PY, encoding: 'utf8' });
  return JSON.parse(saida);
}

test('a janela do Python e a da nuvem respondem EXATAMENTE a mesma coisa', () => {
  const py = janelasDoPython();
  for (const d of DIAS) {
    for (const n of RECORTES) {
      const js = janelaDeAds(d, n);
      const p = py[`${d}|${n}`];
      assert.deepEqual(p, [js.since, js.until], `divergiram em ${d}, recorte ${n}`);
    }
  }
});

test('e a resposta é N dias completos, nenhum deles hoje (o defeito de 20/08/2026)', () => {
  const py = janelasDoPython();
  for (const d of DIAS) {
    for (const n of RECORTES.filter((x) => x > 0)) {
      const [since, until] = py[`${d}|${n}`];
      const quantos = Math.round((new Date(until + 'T12:00:00') - new Date(since + 'T12:00:00')) / 86400000) + 1;
      assert.equal(quantos, n, `${d} recorte ${n} cobriu ${quantos} dias`);
      assert.notEqual(until, d, `${d} recorte ${n} ainda inclui o dia corrente`);
    }
  }
});

test('o recorte 0 continua sendo o próprio dia nos dois', () => {
  const py = janelasDoPython();
  for (const d of DIAS) assert.deepEqual(py[`${d}|0`], [d, d]);
});
