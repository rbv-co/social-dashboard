# Onda A — O robô das 8h enxergar o custo por resultado

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para executar tarefa a tarefa. Os passos usam caixinha (`- [ ]`) para marcar.

**Objetivo:** fazer o robô diário `coletor/budget-ia.mjs` mandar ao Opus o custo por resultado de TODA campanha (não só das de engajamento), com o resultado de cada anúncio, a janela anterior e o tempo no ar — para a análise das 8h deixar de ser feita sem o número principal.

**Arquitetura:** o cálculo de custo por resultado hoje está preso dentro de `tela-de-gestao-trafego.vue`, que um robô Node não importa. A onda extrai esse conhecimento para um módulo PURO novo (`metricas.js`), do mesmo jeito que `baldes.js` e `alvos.js` já fizeram, e liga o robô nele. Nenhuma tela muda de aparência.

**Tecnologias:** JavaScript ES modules puro, `node --test` (sem framework), Vue 3 só como consumidor.

**Spec:** `docs/superpowers/specs/2026-09-24-gt-analise-potente-design.md`

## Restrições globais

- **Módulo puro = sem rede e sem tela.** `metricas.js` não pode importar Vue, Supabase, `fetch` ou qualquer coisa de navegador. É o que permite o robô usá-lo.
- **Quantidade zero devolve `null`, NUNCA `0`.** Um custo de R$ 0,00 no prompt é lido pelo modelo como "de graça" e vira "escalar". Vale para toda função nova.
- **A extração é VERBATIM.** O corpo das funções vai copiado, não reescrito. Melhoria de código nesta onda é proibida: se a tela mudar um número no mesmo dia da mudança, ninguém sabe de quem foi a culpa.
- **Uma fonte só.** Depois da extração, o `.vue` NÃO pode ter mais a sua cópia de `GT_METRIC_CATALOG`, `GT_BALDE_PADRAO`, `_GT_*`, `_gtNum`, `_gtActionVal`, `_gtActionValue`, `_gtPerGasto` — ele importa.
- **Testes rodam com** `npm test` na raiz do repo (`/Users/erickmartins/iamundi`).
- **Nenhuma migration nesta onda.** O esquema de `gt_budget_analises` não muda.
- **Não mexer em dados reais:** toda prova contra a conta de verdade usa `--dry` (não grava, não chama o modelo) exceto a prova final da Tarefa 6, que é combinada com o dono antes.

## Mapa dos arquivos

| Arquivo | Responsabilidade |
|---|---|
| `src/ferramentas/gestao-trafego/metricas.js` | **NOVO.** Os action types da Meta, os leitores de `actions`, o catálogo de métricas e `custoDoAlvo`. Puro. |
| `src/ferramentas/gestao-trafego/metricas.test.mjs` | **NOVO.** Prova o catálogo contra insight de valores conhecidos e a regra do null. |
| `src/ferramentas/gestao-trafego/tela-de-gestao-trafego.vue` | Passa a IMPORTAR de `metricas.js` e perde as cópias (linhas 628-696). |
| `coletor/budget-ia.mjs` | Passa a mandar custo atual de todo balde, resultado por anúncio, janela anterior e tempo no ar. |
| `coletor/budget-ia.test.mjs` | Ganha os testes que provam que as quatro cegueiras fecharam. |

---

### Tarefa 1: `metricas.js` — extrair o catálogo, verbatim

**Arquivos:**
- Criar: `src/ferramentas/gestao-trafego/metricas.js`
- Criar: `src/ferramentas/gestao-trafego/metricas.test.mjs`
- Modificar: `src/ferramentas/gestao-trafego/tela-de-gestao-trafego.vue:628-696`

**Interfaces:**
- Consome: nada (é a base da onda).
- Produz: `GT_METRIC_CATALOG`, `GT_BALDE_PADRAO`, `_gtNum`, `_gtActionVal`, `_gtActionValue`, `_gtPerGasto` e as constantes `_GT_PURCHASE`, `_GT_LEAD`, `_GT_VISIT`, `_GT_MSG`, `_GT_MSG_CONN`, `_GT_MSG_REPLY`, `_GT_ATC`, `_GT_IC`, `_GT_VIDEO`, `_GT_POSTENG`, `_GT_LPV` — todos como exports nomeados.

- [ ] **Passo 1: escrever o teste que falha**

Criar `src/ferramentas/gestao-trafego/metricas.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GT_METRIC_CATALOG, GT_BALDE_PADRAO } from './metricas.js';

// Um insight com número redondo em cada métrica, pra conta errada aparecer.
const INS = {
  spend: '1000', impressions: '50000', clicks: '800', ctr: '1.6', cpc: '1.25',
  reach: '25000', frequency: '2',
  actions: [
    { action_type: 'lead', value: '40' },
    { action_type: 'landing_page_view', value: '500' },
    { action_type: 'link_click', value: '800' },
    { action_type: 'post_engagement', value: '2000' },
    { action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '100' },
    { action_type: 'purchase', value: '20' },
  ],
  action_values: [{ action_type: 'purchase', value: '5000' }],
};

const calc = (k) => GT_METRIC_CATALOG[k].compute(INS);

test('o catálogo calcula o que a tela sempre calculou', () => {
  assert.equal(calc('leads'), 40);
  assert.equal(calc('custo_lead'), 25);          // 1000 / 40
  assert.equal(calc('visitas'), 500);            // landing_page_view ganha de link_click
  assert.equal(calc('custo_visita'), 2);         // 1000 / 500
  assert.equal(calc('cpm'), 20);                 // 1000 / 50000 * 1000
  assert.equal(calc('conversas'), 100);
  assert.equal(calc('custo_conversa'), 10);      // 1000 / 100
  assert.equal(calc('compras'), 20);
  assert.equal(calc('cac'), 50);                 // 1000 / 20
  assert.equal(calc('valor_conversao'), 5000);
  assert.equal(calc('roas'), 5);                 // 5000 / 1000, sem purchase_roas
  assert.equal(calc('engaj_pub'), 2000);
  assert.equal(calc('alcance'), 25000);
  assert.equal(calc('frequencia'), 2);
  assert.equal(calc('gasto'), 1000);
});

test('ação que a Meta omitiu vira null, nunca zero', () => {
  // A Meta OMITE o action_type inteiro quando a contagem é zero.
  const vazio = { spend: '500', actions: [] };
  assert.equal(GT_METRIC_CATALOG.leads.compute(vazio), null);
  assert.equal(GT_METRIC_CATALOG.custo_lead.compute(vazio), null,
    'custo com zero lead precisa ser null: R$ 0,00 seria lido como "de graça"');
  assert.equal(GT_METRIC_CATALOG.custo_conversa.compute(vazio), null);
});

test('insight sem o array actions não derruba o cálculo', () => {
  assert.equal(GT_METRIC_CATALOG.leads.compute({ spend: '10' }), null);
  assert.equal(GT_METRIC_CATALOG.roas.compute({ spend: '10' }), null);
});

test('todo balde aponta só para métricas que existem no catálogo', () => {
  for (const [balde, chaves] of Object.entries(GT_BALDE_PADRAO)) {
    for (const k of chaves) {
      assert.ok(GT_METRIC_CATALOG[k], `${balde} aponta para "${k}", que não existe no catálogo`);
    }
  }
});
```

- [ ] **Passo 2: rodar e ver falhar**

Rodar: `cd /Users/erickmartins/iamundi && node --test src/ferramentas/gestao-trafego/metricas.test.mjs`
Esperado: FALHA com `Cannot find module './metricas.js'`.

- [ ] **Passo 3: criar `metricas.js` movendo o código VERBATIM**

Copiar de `tela-de-gestao-trafego.vue` as linhas **628 a 696** — de `function _gtNum(x)` até o fim de `GT_BALDE_PADRAO` — para `src/ferramentas/gestao-trafego/metricas.js`, **sem mudar uma vírgula do corpo**, só acrescentando `export` em cada declaração de topo. Cabeçalho do arquivo novo:

```javascript
// As MÉTRICAS do Meta Ads: como ler o array `actions` e quanto custou cada
// resultado. PURO: sem rede, sem tela.
//
// Vive num módulo próprio pelo MESMO motivo de baldes.js: a tela e o robô
// precisam da mesma resposta. Enquanto este catálogo morava dentro do .vue, o
// robô não tinha como calcular o custo por resultado — e por isso mandava ao
// Opus a META da conta com o custo atual NULO em toda campanha que não fosse
// de engajamento (a única cujo custo já morava num módulo puro, ponderada.js).
// O modelo recebia a régua sem o número que ela mede.
```

- [ ] **Passo 4: rodar e ver passar**

Rodar: `cd /Users/erickmartins/iamundi && node --test src/ferramentas/gestao-trafego/metricas.test.mjs`
Esperado: PASSA, 4 testes.

- [ ] **Passo 5: a tela passa a importar, e perde as cópias**

Em `tela-de-gestao-trafego.vue`: **apagar** as linhas 628-696 e acrescentar, junto dos outros imports da pasta:

```javascript
import { GT_METRIC_CATALOG, GT_BALDE_PADRAO, _gtNum, _gtActionVal, _gtActionValue, _gtPerGasto,
  _GT_PURCHASE, _GT_LEAD, _GT_VISIT, _GT_MSG, _GT_MSG_CONN, _GT_MSG_REPLY,
  _GT_ATC, _GT_IC, _GT_VIDEO, _GT_POSTENG, _GT_LPV } from './metricas.js'
```

Atenção: `_gtNum` tem 15 usos e `_gtActionVal` 15 na tela, espalhados fora do catálogo — todos precisam do import. Quem protege contra esquecimento é `imports.test.mjs` (o guarda de imports), que já derrubou esta tela quatro vezes por exatamente isso.

- [ ] **Passo 6: provar que sobrou UMA fonte só**

Acrescentar a `metricas.test.mjs` (os `import` vão no TOPO do arquivo):

```javascript
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

test('a tela não tem mais a sua própria cópia do catálogo', () => {
  const aqui = dirname(fileURLToPath(import.meta.url));
  const vue = readFileSync(join(aqui, 'tela-de-gestao-trafego.vue'), 'utf8');
  assert.ok(!/const\s+GT_METRIC_CATALOG\s*=/.test(vue),
    'a tela redefine GT_METRIC_CATALOG: duas fontes acabam discordando');
  assert.ok(!/function\s+_gtActionVal\s*\(/.test(vue),
    'a tela redefine _gtActionVal: duas fontes acabam discordando');
  assert.ok(/from '\.\/metricas\.js'/.test(vue), 'a tela precisa importar de metricas.js');
});
```

- [ ] **Passo 7: rodar a bateria inteira e o build**

Rodar: `cd /Users/erickmartins/iamundi && npm test 2>&1 | tail -20 && npm run build 2>&1 | tail -5`
Esperado: todos os testes passam (inclusive `imports.test.mjs`) e o build conclui.

- [ ] **Passo 8: abrir a tela e conferir que nenhum número mudou**

Rodar `npm run dev`, abrir a Gestão de Tráfego, aba Campanhas, e conferir numa campanha de LEAD e numa de VENDAS que os KPIs mostram os mesmos valores de antes. Teste verde não é tela que abre — esta extração precisa da foto.

- [ ] **Passo 9: commit**

```bash
cd /Users/erickmartins/iamundi
git add src/ferramentas/gestao-trafego/metricas.js src/ferramentas/gestao-trafego/metricas.test.mjs src/ferramentas/gestao-trafego/tela-de-gestao-trafego.vue
git commit -m "refactor(gt): catálogo de métricas sai do .vue para metricas.js (puro)

O robô não conseguia calcular custo por resultado porque o catálogo morava
dentro do componente Vue. Mesma razão que fez nascer baldes.js."
```

---

### Tarefa 2: `custoDoAlvo` — o custo por resultado de qualquer balde

**Arquivos:**
- Modificar: `src/ferramentas/gestao-trafego/metricas.js`
- Modificar: `src/ferramentas/gestao-trafego/metricas.test.mjs`

**Interfaces:**
- Consome: `GT_METRIC_CATALOG` (Tarefa 1); `alvoDoBalde` de `./alvos.js`.
- Produz: `custoDoAlvo(balde: string, insight: object) => number | null`.

- [ ] **Passo 1: escrever o teste que falha**

Acrescentar a `metricas.test.mjs` (o `INS` do topo já serve):

```javascript
import { custoDoAlvo } from './metricas.js';

test('custoDoAlvo devolve o custo na unidade de cada tipo de campanha', () => {
  assert.equal(custoDoAlvo('leads', INS), 25);            // custo por lead
  assert.equal(custoDoAlvo('vendas', INS), 50);           // CAC
  assert.equal(custoDoAlvo('trafego', INS), 2);           // custo por visita
  assert.equal(custoDoAlvo('mensagens', INS), 10);        // custo por conversa
  assert.equal(custoDoAlvo('reconhecimento', INS), 20);   // CPM
});

test('engajamento fica com a ponderada, não com o catálogo', () => {
  assert.equal(custoDoAlvo('engajamento', INS), null,
    'o custo de engajamento é o custo por ponto, e quem calcula é ponderada.js');
});

test('balde sem alvo não inventa número', () => {
  assert.equal(custoDoAlvo('padrao', INS), null);
  assert.equal(custoDoAlvo('balde-que-nao-existe', INS), null);
  assert.equal(custoDoAlvo(undefined, INS), null);
});

test('sem resultado na janela o custo é null, nunca zero', () => {
  const semNada = { spend: '900', actions: [] };
  assert.equal(custoDoAlvo('leads', semNada), null,
    'R$ 0,00 no prompt seria lido como "de graça" e viraria escalar');
  assert.equal(custoDoAlvo('vendas', semNada), null);
});

test('gasto zero não vira custo zero', () => {
  const semGasto = { spend: '0', actions: [{ action_type: 'lead', value: '5' }] };
  assert.equal(custoDoAlvo('leads', semGasto), null);
});
```

- [ ] **Passo 2: rodar e ver falhar**

Rodar: `cd /Users/erickmartins/iamundi && node --test src/ferramentas/gestao-trafego/metricas.test.mjs`
Esperado: FALHA com `custoDoAlvo is not a function`.

- [ ] **Passo 3: implementar**

Em `metricas.js` — o `import` vai no TOPO do arquivo, junto dos outros; o resto no fim:

```javascript
import { alvoDoBalde } from './alvos.js';  // <- topo do arquivo

// O CUSTO POR RESULTADO deste tipo de campanha, na unidade dele (alvos.js diz
// qual é: custo por lead, CAC, custo por visita, custo por conversa, CPM).
//
// Engajamento devolve null de propósito: o resultado dele é o PONTO ponderado,
// e quem calcula isso é ponderada.js. Dois cálculos para o mesmo balde
// acabariam discordando.
//
// Devolve null (e nunca 0) quando não há resultado ou não há gasto na janela:
// um custo de R$ 0,00 escrito no prompt é lido pelo modelo como "de graça" e
// vira recomendação de escalar.
export function custoDoAlvo(balde, insight) {
  const alvo = alvoDoBalde(balde);
  if (!alvo || alvo.metrica === 'ponderada') return null;
  const m = GT_METRIC_CATALOG[alvo.metrica];
  if (!m) return null;
  const v = m.compute(insight || {});
  return (v != null && Number.isFinite(v) && v > 0) ? v : null;
}
```

Conferir que não nasceu import circular: `alvos.js` importa `ponderada.js`, e `ponderada.js` não importa `metricas.js`.

- [ ] **Passo 4: rodar e ver passar**

Rodar: `cd /Users/erickmartins/iamundi && npm test 2>&1 | tail -15`
Esperado: tudo passa.

- [ ] **Passo 5: commit**

```bash
cd /Users/erickmartins/iamundi
git add src/ferramentas/gestao-trafego/metricas.js src/ferramentas/gestao-trafego/metricas.test.mjs
git commit -m "feat(gt): custoDoAlvo devolve o custo por resultado de qualquer balde"
```

---

### Tarefa 3: o robô deixa de mandar a meta sem o número

**Arquivos:**
- Modificar: `coletor/budget-ia.mjs:83`, `:139-140`, `:410-420`
- Modificar: `coletor/budget-ia.test.mjs`

**Interfaces:**
- Consome: `custoDoAlvo` (Tarefa 2).
- Produz: no JSON do prompt, `dados.regua.custo_atual_reais` e `dados.regua.indice_contra_meta` preenchidos para TODO balde.

- [ ] **Passo 1: escrever o teste que falha — este é o teste que prova a cegueira**

Acrescentar a `coletor/budget-ia.test.mjs`:

```javascript
// A CEGUEIRA (24/09/2026): o robô mandava ao Opus a META da conta e o custo
// atual NULO em toda campanha que não fosse de engajamento, enquanto o system
// prompt ordenava "cite esse número em reais e contra a meta".
// A chave é `metas` — metaDoBalde lê `regua.metas[balde]` (regua.js:109).
// `metas_resultado` NÃO existe: devolveria 0 e o índice viria null.
const REGUA_TESTE = normalizarRegua({
  metas: { leads: 15, vendas: 80, trafego: 1.5, mensagens: 10, reconhecimento: 25 },
});

const INS_LEAD = {
  spend: '1000', impressions: '50000', clicks: '800', ctr: '1.6', cpc: '1.25',
  reach: '25000', frequency: '2',
  actions: [{ action_type: 'lead', value: '40' }],
};

function dadosDoPrompt(camp, ins, ads, conjuntos, regua) {
  const { user } = montarMensagens(camp, ins, ads, conjuntos, regua);
  return JSON.parse(user.slice(user.indexOf('{'), user.lastIndexOf('}') + 1));
}

test('campanha de LEAD leva o custo atual, não só a meta', () => {
  const camp = { id: '1', name: 'Captação', objective: 'OUTCOME_LEADS' };
  const d = dadosDoPrompt(camp, INS_LEAD, [], [], REGUA_TESTE);
  assert.equal(d.regua.custo_atual_reais, 25, 'custo por lead = 1000 / 40');
  assert.ok(d.regua.meta_reais > 0, 'a meta precisa continuar indo junto');
  assert.ok(Math.abs(d.regua.indice_contra_meta - 25 / 15) < 0.001,
    'índice = custo ÷ meta; 1,0 é exatamente na meta');
});

test('campanha de VENDAS também leva o custo atual', () => {
  const camp = { id: '2', name: 'Vendas', objective: 'OUTCOME_SALES' };
  const ins = { spend: '1000', actions: [{ action_type: 'purchase', value: '20' }] };
  const d = dadosDoPrompt(camp, ins, [], [], REGUA_TESTE);
  assert.equal(d.regua.custo_atual_reais, 50, 'CAC = 1000 / 20');
});

test('campanha de engajamento continua medida pelo ponto ponderado', () => {
  const camp = { id: '3', name: 'Engaja', objective: 'OUTCOME_ENGAGEMENT' };
  const ins = { spend: '100', actions: [{ action_type: 'post_engagement', value: '500' }] };
  const d = dadosDoPrompt(camp, ins, [], [], REGUA_TESTE);
  assert.equal(d.regua.tipo_de_campanha, 'engajamento');
  assert.equal(d.regua.rotulo, 'Custo por ponto');
});

test('campanha sem resultado na janela manda null, nunca zero', () => {
  const camp = { id: '4', name: 'Parada', objective: 'OUTCOME_LEADS' };
  const d = dadosDoPrompt(camp, { spend: '800', actions: [] }, [], [], REGUA_TESTE);
  assert.equal(d.regua.custo_atual_reais, null);
  assert.equal(d.regua.indice_contra_meta, null);
});
```

Conferir no topo do arquivo de teste que `montarMensagens` e `normalizarRegua` estão importados; se não estiverem, acrescentar.

- [ ] **Passo 2: rodar e ver falhar**

Rodar: `cd /Users/erickmartins/iamundi && node --test coletor/budget-ia.test.mjs 2>&1 | tail -20`
Esperado: FALHA nos dois primeiros testes, com `custo_atual_reais` chegando `null` em vez de 25 e 50. **É esta falha que documenta que o furo existia.**

- [ ] **Passo 3: implementar**

Em `coletor/budget-ia.mjs`, acrescentar ao bloco de imports (perto da linha 229):

```javascript
import { custoDoAlvo } from '../src/ferramentas/gestao-trafego/metricas.js';
```

Logo abaixo do cálculo de `pnd` (linha 83), acrescentar:

```javascript
  // O CUSTO ATUAL de qualquer campanha, não só das de engajamento. Antes disto
  // o robô mandava `meta_reais` preenchida e `custo_atual_reais: null` em lead,
  // venda, mensagem e tráfego — e o system prompt mandava citar o número.
  const custoAtual = pnd ? pnd.custoPorPonto : custoDoAlvo(balde, ins);
```

E trocar as linhas 139-140 por:

```javascript
      custo_atual_reais: custoAtual,
      indice_contra_meta: (custoAtual != null && meta > 0) ? custoAtual / meta : null,
```

- [ ] **Passo 4: rodar e ver passar**

Rodar: `cd /Users/erickmartins/iamundi && npm test 2>&1 | tail -15`
Esperado: tudo passa.

- [ ] **Passo 5: pôr o número na linha do `--dry`**

Em `budget-ia.mjs:420`, a linha impressa por campanha em `--dry` já mostra o balde e a meta. Acrescentar o custo atual e o índice, para a prova contra a conta real sair sem gastar Opus e sem gravar nada:

```javascript
        const ca = pndDry ? pndDry.custoPorPonto : custoDoAlvo(bal, insDry);
        const txtCusto = ca == null ? 'custo SEM DADO' : `custo R$ ${ca.toFixed(2)}`;
        const txtIdx = (ca != null && mt > 0) ? ` (${(ca / mt).toFixed(2)}× a meta)` : '';
```

e incluir `· ${txtCusto}${txtIdx}` no fim do `console.log` existente. Os nomes `pndDry`/`insDry`/`bal`/`mt` são os que já existem nesse bloco — conferir os nomes reais na linha 410-420 antes de escrever.

- [ ] **Passo 6: provar contra a conta real, sem gravar**

Rodar: `cd /Users/erickmartins/iamundi && node coletor/budget-ia.mjs --dry 2>&1 | head -40`
Esperado: cada campanha de lead/venda/mensagem/tráfego imprime `custo R$ X,XX (N× a meta)` em vez de `custo SEM DADO`. Conferir **na tela da ferramenta** que o custo impresso bate com o KPI da mesma campanha no mesmo período.

- [ ] **Passo 7: commit**

```bash
cd /Users/erickmartins/iamundi
git add coletor/budget-ia.mjs coletor/budget-ia.test.mjs
git commit -m "fix(budget-ia): mandar o custo atual ao modelo em TODO balde

O robô mandava a meta da conta com custo_atual_reais nulo em lead, venda,
mensagem e tráfego, enquanto o prompt mandava citar esse número."
```

---

### Tarefa 4: os anúncios param de ser julgados só por CTR

**Arquivos:**
- Modificar: `coletor/budget-ia.mjs:389` (adFields) e `:160-170` (mapa de anúncios)
- Modificar: `coletor/budget-ia.test.mjs`

**Interfaces:**
- Consome: `custoDoAlvo` (Tarefa 2), `GT_METRIC_CATALOG` (Tarefa 1), `alvoDoBalde` (já existe).
- Produz: cada item de `dados.anuncios` ganha `resultado` e `custo_por_resultado`.

- [ ] **Passo 1: escrever o teste que falha**

```javascript
test('cada anúncio leva o resultado dele, não só CTR', () => {
  const camp = { id: '5', name: 'Captação', objective: 'OUTCOME_LEADS' };
  const ads = [{
    ad_id: 'a1', ad_name: 'Criativo A', spend: '200', ctr: '2', cpc: '1',
    impressions: '10000', reach: '8000', frequency: '1.25',
    actions: [{ action_type: 'lead', value: '10' }],
  }, {
    ad_id: 'a2', ad_name: 'Criativo B', spend: '300', ctr: '2.4', cpc: '1',
    impressions: '12000', reach: '9000', frequency: '1.33',
    actions: [],
  }];
  const d = dadosDoPrompt(camp, INS_LEAD, ads, [], REGUA_TESTE);
  assert.equal(d.anuncios[0].resultado, 10);
  assert.equal(d.anuncios[0].custo_por_resultado, 20, '200 / 10 leads');
  assert.equal(d.anuncios[1].resultado, null, 'sem lead na janela: null, não zero');
  assert.equal(d.anuncios[1].custo_por_resultado, null,
    'o criativo B tem CTR MAIOR e nenhum lead — é isso que o modelo precisa ver');
});

test('o balde usado no anúncio é o da CAMPANHA, nunca recalculado', () => {
  // A Meta OMITE um action_type quando a contagem é zero: um anúncio de campanha
  // de WhatsApp que não puxou conversa na janela fica idêntico a um de
  // engajamento puro. Recalcular por anúncio classificaria no mercado errado.
  const camp = { id: '6', name: 'Zap', objective: 'OUTCOME_ENGAGEMENT' };
  const conjuntos = [{ id: 'c1', destination_type: 'WHATSAPP' }];
  const ads = [{ ad_id: 'b1', ad_name: 'Sem conversa', spend: '150', actions: [] }];
  const d = dadosDoPrompt(camp, { spend: '150', actions: [] }, ads, conjuntos, REGUA_TESTE);
  assert.equal(d.regua.tipo_de_campanha, 'mensagens', 'o conjunto diz WhatsApp');
  assert.equal(d.anuncios[0].resultado, null);
});
```

- [ ] **Passo 2: rodar e ver falhar**

Rodar: `cd /Users/erickmartins/iamundi && node --test coletor/budget-ia.test.mjs 2>&1 | tail -20`
Esperado: FALHA com `resultado` chegando `undefined`.

- [ ] **Passo 3: implementar**

Acrescentar `GT_METRIC_CATALOG` ao import de `metricas.js` feito na Tarefa 3.

Trocar o mapa de anúncios (linhas ~160-170) por:

```javascript
    anuncios: (ads || []).map((a) => ({
      ad_id: a.ad_id || a.id || '',
      nome: a.ad_name || a.adset_name || '',
      gasto: num(a.spend),
      ctr_pct: num(a.ctr),
      cpc: num(a.cpc),
      impressoes: num(a.impressions),
      alcance: num(a.reach),
      frequencia: num(a.frequency),
      // O RESULTADO deste criativo, no balde DA CAMPANHA (descido pronto, nunca
      // recalculado por anúncio — ver H1 do review de 2026-07-28). Sem isto o
      // robô mandava pausar criativo de conversão olhando só CTR e frequência.
      resultado: (alvo && alvo.resultado && GT_METRIC_CATALOG[alvo.resultado])
        ? GT_METRIC_CATALOG[alvo.resultado].compute(a) : null,
      custo_por_resultado: custoDoAlvo(balde, a),
    })),
```

E em `adFields` (linha 389), acrescentar os campos — mesmo GET, nenhuma chamada nova:

```javascript
      const adFields = 'ad_id,ad_name,adset_name,campaign_id,spend,impressions,clicks,ctr,cpc,reach,frequency,actions,action_values';
```

- [ ] **Passo 4: rodar e ver passar**

Rodar: `cd /Users/erickmartins/iamundi && npm test 2>&1 | tail -15`
Esperado: tudo passa.

- [ ] **Passo 5: commit**

```bash
cd /Users/erickmartins/iamundi
git add coletor/budget-ia.mjs coletor/budget-ia.test.mjs
git commit -m "fix(budget-ia): anúncios levam o resultado deles, não só CTR"
```

---

### Tarefa 5: tendência e tempo no ar

**Arquivos:**
- Modificar: `coletor/budget-ia.mjs` (assinatura de `montarMensagens`, busca de insights ~`:363-392`, system prompt `:85-130`)
- Modificar: `coletor/budget-ia.test.mjs`

**Interfaces:**
- Consome: tudo das tarefas anteriores.
- Produz: `montarMensagens(camp, ins, ads, conjuntos, regua, extra)` onde `extra` é `{ insAnterior?: object, diasNoAr?: number }` — **parâmetro opcional no fim**, para não quebrar as chamadas e os testes que já existem. O JSON ganha `dados.janela_anterior` e `dados.dias_no_ar`.

- [ ] **Passo 1: escrever o teste que falha**

```javascript
test('a janela anterior entra no prompt para o modelo ver o sentido', () => {
  const camp = { id: '7', name: 'Captação', objective: 'OUTCOME_LEADS' };
  const anterior = { spend: '1000', actions: [{ action_type: 'lead', value: '80' }] };
  const d = dadosDoPrompt2(camp, INS_LEAD, [], [], REGUA_TESTE, { insAnterior: anterior });
  assert.equal(d.janela_anterior.custo_do_alvo, 12.5, '1000 / 80 na janela anterior');
  assert.equal(d.regua.custo_atual_reais, 25, 'e 25 agora: o custo DOBROU');
  assert.equal(d.janela_anterior.gasto, 1000);
});

test('sem janela anterior o campo é null e nada quebra', () => {
  const camp = { id: '8', name: 'Nova', objective: 'OUTCOME_LEADS' };
  const d = dadosDoPrompt2(camp, INS_LEAD, [], [], REGUA_TESTE, {});
  assert.equal(d.janela_anterior, null);
});

test('campanha recém-subida vai marcada como em aprendizado', () => {
  const camp = { id: '9', name: 'Nova', objective: 'OUTCOME_LEADS' };
  const d = dadosDoPrompt2(camp, INS_LEAD, [], [], REGUA_TESTE, { diasNoAr: 2 });
  assert.equal(d.dias_no_ar, 2);
  assert.equal(d.em_aprendizado, true, 'menos de 3 dias: a Meta ainda está aprendendo');
  const madura = dadosDoPrompt2(camp, INS_LEAD, [], [], REGUA_TESTE, { diasNoAr: 30 });
  assert.equal(madura.em_aprendizado, false);
});
```

Acrescentar o ajudante, ao lado do `dadosDoPrompt` da Tarefa 3:

```javascript
function dadosDoPrompt2(camp, ins, ads, conjuntos, regua, extra) {
  const { user } = montarMensagens(camp, ins, ads, conjuntos, regua, extra);
  return JSON.parse(user.slice(user.indexOf('{'), user.lastIndexOf('}') + 1));
}
```

- [ ] **Passo 2: rodar e ver falhar**

Rodar: `cd /Users/erickmartins/iamundi && node --test coletor/budget-ia.test.mjs 2>&1 | tail -20`
Esperado: FALHA com `janela_anterior` `undefined`.

- [ ] **Passo 3: implementar no `montarMensagens`**

Assinatura: `export function montarMensagens(camp, ins, ads, conjuntos, regua, extra) {`, e no começo do corpo:

```javascript
  const ex = extra || {};
  const diasNoAr = Number.isFinite(ex.diasNoAr) ? ex.diasNoAr : null;
```

No objeto `dados`, acrescentar:

```javascript
    dias_no_ar: diasNoAr,
    // Menos de 3 dias: a Meta ainda está na fase de aprendizado, e mexer no
    // orçamento reinicia essa fase. O prompt manda não mexer em quem está
    // aprendendo, a menos que esteja queimando dinheiro.
    em_aprendizado: diasNoAr != null ? diasNoAr < 3 : false,
    janela_anterior: ex.insAnterior ? {
      gasto: num(ex.insAnterior.spend),
      custo_do_alvo: pnd ? null : custoDoAlvo(balde, ex.insAnterior),
      frequencia: num(ex.insAnterior.frequency),
      ctr_pct: num(ex.insAnterior.ctr),
    } : null,
```

- [ ] **Passo 4: rodar e ver passar**

Rodar: `cd /Users/erickmartins/iamundi && node --test coletor/budget-ia.test.mjs 2>&1 | tail -10`
Esperado: PASSA.

- [ ] **Passo 5: buscar a janela anterior de verdade**

No bloco de busca (perto da linha 370), depois dos insights atuais, acrescentar uma segunda chamada com o período de **mesma duração, imediatamente anterior** — se a janela atual é `since..until`, a anterior termina na véspera de `since` e tem a mesma quantidade de dias:

```javascript
      // A janela ANTERIOR, de mesma duração, para o modelo dizer o SENTIDO do
      // movimento ("o custo por lead subiu de R$ 12 para R$ 25 em 7 dias").
      // Mesmos campos, mesma conta: uma chamada a mais por conta, na rodada das 8h.
      const diasJanela = Math.max(1, Math.round((new Date(until) - new Date(since)) / 86400000) + 1);
      const fimAnt = new Date(new Date(since) - 86400000).toISOString().slice(0, 10);
      const iniAnt = new Date(new Date(fimAnt) - (diasJanela - 1) * 86400000).toISOString().slice(0, 10);
      let insAnt = [];
      try {
        insAnt = (await graphGet(`/act_${adAcc}/insights`,
          { level: 'campaign', fields: insFields, time_range: { since: iniAnt, until: fimAnt }, limit: 500 },
          acc.access_token)).data || [];
      } catch { insAnt = []; }
      const insAntByCamp = {};
      insAnt.forEach((i) => { insAntByCamp[i.campaign_id] = i; });
```

O `catch` que devolve lista vazia é deliberado: perder a janela anterior deixa a análise mais pobre, mas **não pode derrubar a rodada das 8h** — sem tendência o prompt continua válido (o teste do Passo 1 cobre `janela_anterior: null`).

- [ ] **Passo 6: passar `extra` na chamada de `montarMensagens`**

Onde a rodada monta as mensagens por campanha, passar o sexto argumento:

```javascript
        const criadoEm = camp.created_time ? new Date(camp.created_time).getTime() : null;
        const diasNoAr = criadoEm ? Math.floor((agoraMs - criadoEm) / 86400000) : null;
        const msgs = montarMensagens(camp, ins, adsDaCamp, conjuntosDaCamp, regua,
          { insAnterior: insAntByCamp[camp.id], diasNoAr });
```

**Antes de escrever isto, conferir que `created_time` vem de verdade** na resposta da Meta: rodar `node coletor/budget-ia.mjs --dry` e imprimir o campo de uma campanha. Se não vier, acrescentá-lo aos `fields` da busca de campanhas; se a Meta não der, `diasNoAr` fica `null` e o resto da tarefa segue (a spec já prevê isso).

- [ ] **Passo 7: ajustar o system prompt**

No `system` (linha ~85), acrescentar antes da parte do JSON de resposta:

```javascript
    'TENDÊNCIA: quando `janela_anterior` existir, compare com ela e diga o SENTIDO do movimento na justificativa ' +
    '(ex.: "o custo por lead subiu de R$ 12 para R$ 25 em 7 dias"). Custo piorando é argumento contra escalar, mesmo abaixo da meta. ' +
    'APRENDIZADO: com `em_aprendizado` true a campanha tem menos de 3 dias e a Meta ainda está aprendendo — ' +
    'o veredito deve ser "manter", a menos que ela esteja gastando muito acima da meta. Mexer agora reinicia o aprendizado. ' +
    'ANÚNCIOS: julgue cada criativo pelo `resultado` e `custo_por_resultado` dele, não só por CTR — ' +
    'criativo com CTR alto e nenhum resultado é candidato a pausar, e CTR baixo com resultado barato NÃO é. ' +
    'Quando `custo_atual_reais` vier nulo e houver meta, diga que esta campanha não registrou resultado na janela — nunca invente o número. ' +
```

- [ ] **Passo 8: rodar a bateria e a rodada seca**

Rodar: `cd /Users/erickmartins/iamundi && npm test 2>&1 | tail -15 && node coletor/budget-ia.mjs --dry 2>&1 | head -30`
Esperado: testes passam e o `--dry` roda inteiro sem estourar.

- [ ] **Passo 9: commit**

```bash
cd /Users/erickmartins/iamundi
git add coletor/budget-ia.mjs coletor/budget-ia.test.mjs
git commit -m "feat(budget-ia): tendência contra a janela anterior e tempo no ar"
```

---

### Tarefa 6: a prova na conta real

**Arquivos:** nenhum — é conferência. Se algo aparecer errado, vira tarefa nova.

**Interfaces:** consome o resultado das tarefas 1 a 5.

- [ ] **Passo 1: combinar com o dono antes de gastar Opus**

Esta é a única etapa que chama o modelo e grava. Avisar o dono e esperar o ok.

- [ ] **Passo 2: rodar uma vez, escopo forçado**

Rodar: `cd /Users/erickmartins/iamundi && BUDGET_ESCOPO=ativas node coletor/budget-ia.mjs 2>&1 | tail -30`

- [ ] **Passo 3: ler as justificativas de 5 campanhas de baldes diferentes**

Abrir a aba Fila e conferir, em uma campanha de cada balde (lead, venda, mensagem, tráfego, engajamento):
1. a justificativa **cita um número em reais** e o compara com a meta;
2. esse número **bate** com o KPI da mesma campanha na aba Campanhas, no mesmo período;
3. onde houver janela anterior, o texto diz se subiu ou caiu;
4. nenhum texto diz "a meta do dono" (regra de 2026-07-29 — quem lê é quem definiu).

- [ ] **Passo 4: conferir o custo da rodada**

Abrir a ferramenta de custo (`custo-anthropic`) e comparar o gasto desta rodada com a média das anteriores. O prompt cresceu; a spec previu que subiria um pouco. Se dobrar, anotar para o dono decidir.

- [ ] **Passo 5: registrar o resultado**

Anotar no fim deste plano o que foi conferido, com data. Se algum número não bateu, **parar** e abrir o diagnóstico antes de seguir para a Onda B.

---

## Autorrevisão (feita em 24/09/2026)

**Cobertura da spec:** seção 3.1 → Tarefa 1; 3.2 → Tarefas 2 e 3; 3.3 → Tarefa 4; 3.4 → Tarefa 5 (passos 5-6); 3.5 → Tarefa 5 (passos 6-7); 3.6 → Tarefa 5 (passo 7). Provas da seção 5: 5.1 → Tarefa 1 passos 1-6; 5.2 → Tarefa 2; 5.3 → Tarefa 3 passo 2 (a falha que documenta o furo); 5.4 → Tarefa 6. Riscos da seção 6: extração verbatim → Tarefa 1 passos 6-8; custo do Opus → Tarefa 6 passo 4; vereditos mudando → Tarefa 6 passo 3.

**Sem placeholders:** todos os passos de código trazem o código. Os dois pontos que dependem da resposta real da Meta (`created_time` na Tarefa 5 passo 6, e os nomes de variável do bloco `--dry` na Tarefa 3 passo 5) trazem a instrução explícita de conferir antes de escrever, com o que fazer se não vier.

**Consistência de tipos:** `custoDoAlvo(balde, insight) => number|null` é usada com essa assinatura nas Tarefas 3, 4 e 5. `montarMensagens` ganha um sexto parâmetro **opcional** — as chamadas de cinco argumentos das Tarefas 3 e 4 continuam válidas, e o teste da Tarefa 5 cobre o caso sem `extra`.
