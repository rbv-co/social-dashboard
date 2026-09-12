# Lugares no mapa — Brasil, Estado, Cidade e Local — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Escolher lugar por tipo (Brasil, Estado, Cidade, Local) com o mapa mostrando cada escolha, e o caminho de volta: ponto largado no mapa se apresenta com o endereço por extenso.

**Architecture:** Uma lista única de "lugares" na tela, traduzida nas quatro chaves que a Meta entende (`countries`, `regions`, `cities`, `custom_locations`). Coordenada e nome de endereço vêm do OpenStreetMap por uma Edge Function própria (`buscar-lugar`), porque a Meta não devolve coordenada nenhuma nem tem busca de estabelecimento. O painel e o mapa são imperativos e montados num elemento, o que permite a MESMA peça na Gestão de Tráfego (DOM na mão) e na Fábrica (Vue).

**Tech Stack:** Vue 3 + Vite, módulos puros `.js` com testes `node --test` em `*.test.mjs`, Supabase Edge Functions (Deno), Meta Graph API v22.0, OpenStreetMap (quadradinhos + Nominatim).

**Spec:** `docs/superpowers/specs/2026-08-13-lugares-no-mapa-design.md`

## Global Constraints

Valem em TODA tarefa. Saíram do `PADRAO-DA-CENTRAL.md` e da memória do projeto.

- **Leia `PADRAO-DA-CENTRAL.md` antes da primeira linha.** Não é guia de estilo: é a lista do que já quebrou.
- **Cor só de token.** Nenhum hex novo. Dentro de `painel-do-mapa.js` e `painel-de-lugares.js` vale o padrão do próprio arquivo: `var(--token, #fallback)`, e o fallback só repete um que já existe ali.
- **Botão: três classes e só** — `.btn`, `.btn.btn-principal`, `.btn.btn-perigo`. Nunca `style=` em botão. Altura mínima 40px. `npm test` reprova quem desobedecer (`padrao-da-central.test.mjs`).
- **Texto nunca corta.** `overflow-wrap: anywhere`, nunca `text-overflow: ellipsis`.
- **375px é a régua.** Toda entrega se mede a 375px E a 1440px num navegador de verdade.
- **A tela nunca mente.** Falha de busca vira mensagem escrita, nunca lista vazia. Campo que não pode gravar fica travado com o motivo escrito.
- **Português, sem jargão**, em todo texto de tela, nome de arquivo (kebab-case) e comentário.
- **Comentário explica POR QUÊ**, com a medição ou o defeito real que o motivou — é o costume deste repositório, não enfeite.
- **Isolamento:** trabalhe em worktree próprio (`~/iamundi-lugares-mapa`, branch `lugares-no-mapa`). Servidor de desenvolvimento sempre com porta fixa: `npm run dev -- --port 5199 --strictPort`.
- **`coletor/.env` não vem no worktree novo** — copie do checkout principal, senão dois testes da Fábrica falham por credencial ausente.
- **Nunca `git add <pasta>`.** Some sempre os arquivos por nome.
- **Cada `commit` só depois do teste verde.** Teste verde não é tela que abre: `node --test` não compila `.vue`.

## Fatos medidos que o plano assume (13/08/2026)

Não re-meça; já foi feito contra a conta real. Estão aqui porque as tarefas dependem deles.

- `GET /search?type=adgeolocation&location_types=["city"]&q=Uberlandia` devolve `{key, name, type, country_code, country_name, region, region_id, supports_region, supports_city}` — **sem latitude/longitude**.
- A mesma chamada, pedindo só `city`, **devolve bairro junto** (`type:"neighborhood"`). O filtro não é respeitado.
- `location_types:["place"]` para "Shopping" devolve `{"data":[]}` — a Meta **não tem** busca de estabelecimento.
- `type=adgeolocationmeta` também **não** devolve coordenada.
- Nominatim `search` de "Shopping Uberlandia" devolve `name`, `lat`, `lon`, `display_name` e `address{road, suburb, city, state, ISO3166-2-lvl4, postcode}`.
- Nominatim `reverse` de `-18.9186,-48.2772` devolve `Pernambucanas, Avenida Afonso Pena, Centro, Setor Central, Uberlândia, Minas Gerais, 38400-112, Brasil`.
- Não existe `Content-Security-Policy` em `vercel.json` nem no `index.html` — nada bloqueia a chamada nova.

## Estrutura de arquivos

**Criar**

| Arquivo | Responsabilidade |
|---|---|
| `src/compartilhado/lugares-do-anuncio.js` | Puro. O modelo de "um lugar" e a tradução entre a lista da tela e as quatro listas do público (`paises`, `estados`, `cidades`, `pins`). |
| `src/compartilhado/lugares-do-anuncio.test.mjs` | Testes do acima. |
| `src/compartilhado/busca-de-lugar.js` | Puro. Monta as perguntas (Meta e mapa), normaliza as respostas nos dois sentidos, e a fila de uma pergunta por vez. |
| `src/compartilhado/busca-de-lugar.test.mjs` | Testes do acima. |
| `src/compartilhado/painel-de-lugares.js` | A linha de acrescentar + a lista de lugares. Imperativo, montado num elemento — serve às duas telas. |
| `supabase/functions/buscar-lugar/index.ts` | A recepção: se identifica no OpenStreetMap, guarda cache, devolve lugar e endereço. |

**Modificar**

| Arquivo | O que muda |
|---|---|
| `src/ferramentas/gestao-trafego/publico-alvo.js` | `paises` e `estados` viram campos gerenciados; saem de `CHAVES_DE_LOCALIZACAO`; contam no bloqueio de "sem localização". |
| `src/ferramentas/gestao-trafego/publico-alvo.test.mjs` | Testes novos + o número da lista que encolhe. |
| `src/ferramentas/gestao-trafego/painel-do-mapa.js` | Passa a receber `lugares` (não `pins`); desenha marca de área sem círculo; avisa quem chamou quando um ponto nasce. |
| `src/ferramentas/gestao-trafego/tela-de-gestao-trafego.vue` | `_gtPubSecaoLugar` usa o painel novo. |
| `src/ferramentas/meta-ads/painel-subir.vue` | Ganha o painel e o mapa no lugar da busca de cidade solta. |
| `coletor/lib/publico.mjs` | Monta `countries`, `regions` e `custom_locations` no targeting da Fábrica. |
| `coletor/lib/publico.test.mjs` | Testes do acima. |
| `src/compartilhado/LEIA-ME.txt` | Três arquivos novos na pasta. |
| `src/ferramentas/gestao-trafego/LEIA-ME.txt` | O mapa mudou de contrato. |

**Não muda:** `src/ferramentas/gestao-trafego/mapa-de-pins.js`. A aritmética de Mercator já serve — marca de área é só mais um ponto a desenhar.

---

### Task 1: O modelo de "um lugar" e a tradução

**Files:**
- Create: `src/compartilhado/lugares-do-anuncio.js`
- Test: `src/compartilhado/lugares-do-anuncio.test.mjs`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `LUGAR_TIPOS: [{id:'pais'|'estado'|'cidade'|'local', rotulo:string}]`
  - `podeVirarPonto(tipo) -> boolean`
  - `deListas({paises, estados, cidades, pins}) -> lugar[]`
  - `paraListas(lugar[]) -> {paises, estados, cidades, pins}`
  - `rotuloDoLugar(lugar) -> string`
  - Forma de um lugar: `{tipo, chave, nome, uf, comoMirar:'area'|'ponto', raio, unidade, lat, lng, endereco}`

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/compartilhado/lugares-do-anuncio.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LUGAR_TIPOS, podeVirarPonto, deListas, paraListas, rotuloDoLugar,
} from './lugares-do-anuncio.js';

test('os quatro tipos, na ordem que a tela mostra', () => {
  assert.deepEqual(LUGAR_TIPOS.map((t) => t.id), ['pais', 'estado', 'cidade', 'local']);
  assert.equal(LUGAR_TIPOS.find((t) => t.id === 'pais').rotulo, 'Brasil');
});

// País não vira ponto: um raio no centro geográfico do Brasil não mira nada que
// alguém queira. Decisão do dono, registrada no desenho.
test('so pais nao pode virar ponto com raio', () => {
  assert.equal(podeVirarPonto('pais'), false);
  assert.equal(podeVirarPonto('estado'), true);
  assert.equal(podeVirarPonto('cidade'), true);
  assert.equal(podeVirarPonto('local'), true);
});

test('as quatro listas do publico viram uma lista so de lugares', () => {
  const lugares = deListas({
    paises: [{ key: 'BR', nome: 'Brasil' }],
    estados: [{ key: '449', nome: 'Minas Gerais' }],
    cidades: [{ key: '273173', nome: 'Uberlândia · MG', raio: 0, unidade: 'kilometer' }],
    pins: [{ lat: -18.91, lng: -48.26, raio: 2, unidade: 'kilometer', nome: 'Center Shopping', endereco: 'Rua Argentina' }],
  });
  assert.deepEqual(lugares.map((l) => l.tipo), ['pais', 'estado', 'cidade', 'local']);
  assert.deepEqual(lugares.map((l) => l.comoMirar), ['area', 'area', 'area', 'ponto']);
  assert.equal(lugares[2].raio, 0, 'raio 0 da cidade é "a cidade inteira" e não pode sumir');
  assert.equal(lugares[3].lat, -18.91);
});

test('a lista de lugares volta pras quatro listas', () => {
  const listas = paraListas([
    { tipo: 'pais', chave: 'BR', nome: 'Brasil', comoMirar: 'area' },
    { tipo: 'estado', chave: '449', nome: 'Minas Gerais', comoMirar: 'area' },
    { tipo: 'cidade', chave: '273173', nome: 'Uberlândia', comoMirar: 'area', raio: 17, unidade: 'kilometer' },
    { tipo: 'local', nome: 'Center Shopping', endereco: 'Rua Argentina', comoMirar: 'ponto', lat: -18.91, lng: -48.26, raio: 2, unidade: 'kilometer' },
  ]);
  assert.deepEqual(listas.paises, [{ key: 'BR', nome: 'Brasil' }]);
  assert.deepEqual(listas.estados, [{ key: '449', nome: 'Minas Gerais' }]);
  assert.equal(listas.cidades[0].raio, 17);
  assert.equal(listas.pins.length, 1);
  assert.equal(listas.pins[0].nome, 'Center Shopping');
});

// A ESCOLHA "ponto com raio" NUMA CIDADE vira custom_location — que é o mesmo
// mecanismo do "Local". Ou seja: depois de salvar e reabrir, a Meta não tem como
// dizer se aquele ponto nasceu de uma cidade ou de um comércio, e ele volta como
// "Local". A assimetria é honesta e está aqui de propósito: fingir o contrário
// exigiria inventar dado que a Meta não guarda.
test('cidade escolhida como ponto volta da Meta como Local — e isso e proposital', () => {
  const listas = paraListas([
    { tipo: 'cidade', chave: '273173', nome: 'Uberlândia', comoMirar: 'ponto', lat: -18.91, lng: -48.27, raio: 5, unidade: 'kilometer' },
  ]);
  assert.deepEqual(listas.cidades, [], 'não pode gravar a cidade TAMBÉM como área — dobraria a segmentação');
  assert.equal(listas.pins.length, 1);
  const devolta = deListas(listas);
  assert.equal(devolta[0].tipo, 'local');
  assert.equal(devolta[0].nome, 'Uberlândia');
});

// Ponto sem coordenada não pode ser gravado: a Meta recusaria, e um lugar que
// some ao salvar sem dizer nada é o pior dos dois mundos.
test('ponto sem coordenada nao vira pin', () => {
  const listas = paraListas([
    { tipo: 'local', nome: 'Sem coordenada', comoMirar: 'ponto', lat: null, lng: undefined, raio: 1 },
  ]);
  assert.deepEqual(listas.pins, []);
});

test('rotulo mostra o estado junto quando existe', () => {
  assert.equal(rotuloDoLugar({ tipo: 'cidade', nome: 'Uberlândia', uf: 'Minas Gerais' }), 'Uberlândia · Minas Gerais');
  assert.equal(rotuloDoLugar({ tipo: 'local', nome: 'Center Shopping', endereco: 'Rua Argentina, Tibery' }), 'Center Shopping · Rua Argentina, Tibery');
  assert.equal(rotuloDoLugar({ tipo: 'local', nome: '', lat: -18.9, lng: -48.2 }), '-18.90000, -48.20000');
});

test('nada quebra com lista faltando ou nula', () => {
  assert.deepEqual(deListas(null), []);
  assert.deepEqual(deListas({}), []);
  assert.deepEqual(paraListas(null), { paises: [], estados: [], cidades: [], pins: [] });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd ~/iamundi-lugares-mapa && node --test src/compartilhado/lugares-do-anuncio.test.mjs`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` (`lugares-do-anuncio.js` não existe).

- [ ] **Step 3: Escrever o módulo**

Criar `src/compartilhado/lugares-do-anuncio.js`:

```js
// UM LUGAR ONDE O ANÚNCIO APARECE — e as quatro formas que a Meta entende.
//
// PEDIDO DO DONO (13/08/2026): "eu preciso selecionar entre Brasil, Estado,
// Cidade e Local (estabelecimento, comércio, negócio) e aparece o pin automático
// no mapa e vice versa".
//
// POR QUE ESTE MÓDULO EXISTE: a tela mostra UMA lista ("os lugares deste
// anúncio"), mas a Meta guarda isso em QUATRO chaves diferentes de
// `geo_locations` — `countries`, `regions`, `cities` e `custom_locations`. Aqui
// mora a tradução, nos dois sentidos, e só ela. Sem tela e sem rede.
//
// MEDIDO na Graph API em 13/08/2026, e é o que obriga o desenho:
//   • a busca da Meta NÃO devolve coordenada (nem `adgeolocation` nem
//     `adgeolocationmeta`) — quem dá coordenada é o mapa, não ela;
//   • a Meta NÃO tem busca de estabelecimento (`location_types:["place"]`
//     devolve lista vazia). "Local" não é chave dela: é ponto com raio.

export const LUGAR_TIPOS = [
  { id: 'pais', rotulo: 'Brasil' },
  { id: 'estado', rotulo: 'Estado' },
  { id: 'cidade', rotulo: 'Cidade' },
  { id: 'local', rotulo: 'Local' },
];

// País só existe como área inteira: um ponto com raio no centro geográfico do
// Brasil não mira nada que alguém queira. Decisão do dono, 13/08/2026.
export function podeVirarPonto(tipo) {
  return tipo !== 'pais';
}

const lista = (v) => (Array.isArray(v) ? v : []);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

export function deListas(listas) {
  const l = listas || {};
  const saida = [];
  for (const p of lista(l.paises)) {
    saida.push({ tipo: 'pais', chave: String(p.key), nome: p.nome || String(p.key), uf: '', comoMirar: 'area' });
  }
  for (const e of lista(l.estados)) {
    saida.push({ tipo: 'estado', chave: String(e.key), nome: e.nome || String(e.key), uf: '', comoMirar: 'area' });
  }
  for (const c of lista(l.cidades)) {
    saida.push({
      tipo: 'cidade', chave: String(c.key), nome: c.nome || String(c.key), uf: '',
      comoMirar: 'area', raio: Number(c.raio) || 0, unidade: c.unidade || 'kilometer',
    });
  }
  // TODO PIN VOLTA COMO "LOCAL", inclusive o que nasceu de uma cidade: para a
  // Meta os dois são o mesmo `custom_location`, e ela não guarda de onde veio.
  for (const pin of lista(l.pins)) {
    saida.push({
      tipo: 'local', chave: null, nome: pin.nome || '', uf: '', endereco: pin.endereco || '',
      comoMirar: 'ponto', lat: num(pin.lat), lng: num(pin.lng),
      raio: Number(pin.raio) || 1, unidade: pin.unidade || 'kilometer',
      pais: pin.pais || 'BR', cidadeId: pin.cidadeId ?? null, regiaoId: pin.regiaoId ?? null,
    });
  }
  return saida;
}

export function paraListas(lugares) {
  const saida = { paises: [], estados: [], cidades: [], pins: [] };
  for (const l of lista(lugares)) {
    if (l == null) continue;
    // PONTO: vale para qualquer tipo que aceite ponto, e sempre vira
    // custom_location. Sem coordenada não grava nada — a Meta recusaria, e um
    // lugar que some ao salvar sem avisar é pior que um erro na cara.
    if (l.comoMirar === 'ponto' && podeVirarPonto(l.tipo)) {
      const lat = num(l.lat); const lng = num(l.lng);
      if (lat == null || lng == null) continue;
      saida.pins.push({
        lat, lng, raio: Number(l.raio) > 0 ? Number(l.raio) : 1,
        unidade: l.unidade === 'mile' ? 'mile' : 'kilometer',
        nome: l.nome || '', endereco: l.endereco || '',
        pais: l.pais || 'BR', cidadeId: l.cidadeId ?? null, regiaoId: l.regiaoId ?? null,
      });
      continue;
    }
    if (l.chave == null || l.chave === '') continue;
    if (l.tipo === 'pais') saida.paises.push({ key: String(l.chave), nome: l.nome || String(l.chave) });
    else if (l.tipo === 'estado') saida.estados.push({ key: String(l.chave), nome: l.nome || String(l.chave) });
    else if (l.tipo === 'cidade') {
      saida.cidades.push({
        key: String(l.chave), nome: l.nome || String(l.chave),
        raio: Number(l.raio) || 0, unidade: l.unidade === 'mile' ? 'mile' : 'kilometer',
      });
    }
  }
  return saida;
}

// O que a pessoa lê na linha. Nunca devolve vazio: ponto sem nome mostra a
// coordenada, que é feia mas verdadeira — melhor que uma linha em branco.
export function rotuloDoLugar(lugar) {
  const l = lugar || {};
  const complemento = l.uf || l.endereco || '';
  if (l.nome) return complemento ? `${l.nome} · ${complemento}` : l.nome;
  const lat = num(l.lat); const lng = num(l.lng);
  if (lat != null && lng != null) return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  return String(l.chave || 'sem nome');
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test src/compartilhado/lugares-do-anuncio.test.mjs`
Expected: PASS — 8 testes.

- [ ] **Step 5: Commit**

```bash
git add src/compartilhado/lugares-do-anuncio.js src/compartilhado/lugares-do-anuncio.test.mjs
git commit -m "Lugares: o modelo de um lugar e a traducao para as quatro chaves da Meta"
```

---

### Task 2: País e Estado deixam de ser intocáveis

**Files:**
- Modify: `src/ferramentas/gestao-trafego/publico-alvo.js`
- Test: `src/ferramentas/gestao-trafego/publico-alvo.test.mjs`

**Interfaces:**
- Consumes: nada da Task 1 (este módulo trabalha nas quatro listas cruas).
- Produces: `PUBLICO_VAZIO` ganha `paises: []` e `estados: []`; `lerPublico` os lê; `montarTargeting` os grava; `avisosDe` os conta; `CHAVES_DE_LOCALIZACAO` perde `countries` e `regions`.

**A cicatriz que esta tarefa repete — leia antes de mexer.** O próprio arquivo tem escrito: tirar uma chave de `CHAVES_DE_LOCALIZACAO` obriga a (a) dar a ela um lugar próprio no editor e (b) fazê-la contar no bloqueio de "sem localização". Em 12/08 isso foi esquecido com `custom_locations` e um conjunto mirado só por pin ficou impossível de salvar. Os passos abaixo fazem as duas coisas de propósito.

**A armadilha de forma:** `countries` é uma lista de **strings** (`["BR"]`), não de objetos com `key`. Todas as outras chaves são objetos. Ler as duas do mesmo jeito devolve `undefined` em silêncio.

- [ ] **Step 1: Escrever os testes que falham**

Acrescentar ao fim de `src/ferramentas/gestao-trafego/publico-alvo.test.mjs`:

```js
// ── PAÍS E ESTADO PASSARAM A SER GERENCIADOS (13/08/2026) ──────────────────
// Saíram de CHAVES_DE_LOCALIZACAO porque o editor agora os desenha. A regra do
// arquivo obriga: quem sai da lista tem que contar no bloqueio de "sem
// localização". Os testes abaixo são essa obrigação, escrita.

test('pais vem como STRING no geo_locations e e lido assim', () => {
  const p = lerPublico({ geo_locations: { countries: ['BR', 'PT'] } });
  assert.deepEqual(p.paises, [{ key: 'BR', nome: 'BR' }, { key: 'PT', nome: 'PT' }]);
  assert.deepEqual(p.outrasLocalizacoes, [], 'país não é mais "outra localização"');
});

test('estado vem como objeto com key e nome', () => {
  const p = lerPublico({ geo_locations: { regions: [{ key: '449', name: 'Minas Gerais' }] } });
  assert.deepEqual(p.estados, [{ key: '449', nome: 'Minas Gerais' }]);
  assert.deepEqual(p.outrasLocalizacoes, []);
});

test('pais e estado voltam pra Meta na forma certa de cada um', () => {
  const p = { ...PUBLICO_VAZIO, paises: [{ key: 'BR', nome: 'Brasil' }], estados: [{ key: '449', nome: 'Minas Gerais' }] };
  const { targeting } = montarTargeting(p, {});
  assert.deepEqual(targeting.geo_locations.countries, ['BR'], 'país é string crua');
  assert.deepEqual(targeting.geo_locations.regions, [{ key: '449' }], 'estado é objeto com key');
});

test('pais que sai APAGA a chave em vez de mandar lista vazia', () => {
  const original = { geo_locations: { countries: ['BR'], cities: [{ key: '1058' }] } };
  const p = lerPublico(original);
  const { targeting } = montarTargeting({ ...p, paises: [] }, original);
  assert.ok(!('countries' in targeting.geo_locations), 'a Meta trata [] e ausente de formas diferentes');
  assert.deepEqual(targeting.geo_locations.cities, [{ key: '1058' }], 'a cidade ao lado não pode sumir junto');
});

test('conjunto mirado SO por pais salva — nao pode travar', () => {
  const original = { geo_locations: { countries: ['BR'] }, targeting_automation: { advantage_audience: 0 } };
  const p = lerPublico(original);
  const avisos = avisosDe(p, { ...p, idadeMin: 30 }, { ativo: false, ajustes: [] });
  assert.ok(!avisos.some((x) => x.bloqueia), 'país é localização — o Salvar não pode morrer');
});

test('conjunto mirado SO por estado salva — nao pode travar', () => {
  const original = { geo_locations: { regions: [{ key: '449', name: 'Minas Gerais' }] }, targeting_automation: { advantage_audience: 0 } };
  const p = lerPublico(original);
  const avisos = avisosDe(p, { ...p, idadeMin: 30 }, { ativo: false, ajustes: [] });
  assert.ok(!avisos.some((x) => x.bloqueia), 'estado é localização — o Salvar não pode morrer');
});

test('sem cidade, sem pais, sem estado, sem pin: ai sim bloqueia', () => {
  const avisos = avisosDe(PUBLICO_VAZIO, PUBLICO_VAZIO, { ativo: false, ajustes: [] });
  assert.ok(avisos.some((x) => x.bloqueia && x.tipo === 'sem-lugar'));
});

test('o resumo diz o que entrou e saiu de pais e estado, com nome', () => {
  const antes = { ...PUBLICO_VAZIO, estados: [{ key: '449', nome: 'Minas Gerais' }] };
  const depois = { ...PUBLICO_VAZIO, paises: [{ key: 'BR', nome: 'Brasil' }], estados: [] };
  const linhas = resumoDasMudancas(antes, depois);
  assert.ok(linhas.some((l) => l.includes('+Brasil')), 'entrou o Brasil');
  assert.ok(linhas.some((l) => l.includes('−Minas Gerais')), 'saiu Minas Gerais');
});
```

E **alterar** a linha 786 do mesmo arquivo (dentro de `test('TODO tipo de lugar da lista …')`), junto com o comentário logo acima:

```js
  // 12 desde 13/08/2026: `countries` e `regions` SAÍRAM daqui porque o editor
  // passou a desenhar Brasil e Estado. Encolher a lista sem mais nada teria
  // travado o Salvar de conjunto mirado só por país ou só por estado — os dois
  // testes logo abaixo são a prova de que isso não acontece. Quem tirar outra
  // chave daqui tem a mesma obrigação: um lugar próprio no editor E contar no
  // bloqueio de "sem localização".
  assert.ok(CHAVES_DE_LOCALIZACAO.length >= 12, 'a lista não pode encolher sem alguém perceber');
  assert.ok(!CHAVES_DE_LOCALIZACAO.includes('custom_locations'), 'pin é gerenciado pelo editor, não preservado às cegas');
  assert.ok(!CHAVES_DE_LOCALIZACAO.includes('countries'), 'país é gerenciado pelo editor');
  assert.ok(!CHAVES_DE_LOCALIZACAO.includes('regions'), 'estado é gerenciado pelo editor');
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test src/ferramentas/gestao-trafego/publico-alvo.test.mjs`
Expected: FAIL — `p.paises` é `undefined`, e o teste "TODO tipo de lugar" ainda encontra `countries`/`regions` na lista.

- [ ] **Step 3: Mexer no módulo — cinco pontos**

**3.1** Em `PUBLICO_VAZIO`, logo depois de `cidades: [], excluidas: [],`:

```js
  // PAÍS E ESTADO (13/08/2026). Saíram de CHAVES_DE_LOCALIZACAO — ver o comentário
  // daquela lista. `countries` é lista de STRINGS na Meta ("BR"), `regions` é
  // lista de objetos com `key`: ler as duas do mesmo jeito devolve undefined
  // calado.
  paises: [], estados: [],
```

**3.2** Em `CHAVES_DE_LOCALIZACAO`, tirar `'regions'` e `'countries'` da primeira linha e acrescentar, embaixo do comentário do `custom_locations`:

```js
// `countries` e `regions` saíram desta lista em 13/08/2026 pelo mesmo motivo do
// pin: o editor passou a desenhar Brasil e Estado, com escolha entre "a área
// inteira" e "ponto com raio". Deixá-los aqui faria a tela avisar "há localidades
// que eu não mexo" sobre justamente o que ela agora edita.
```

**3.3** Em `lerPublico`, dentro do objeto devolvido, depois de `excluidas: excluidasDe(t),`:

```js
    // A FORMA DE CADA UM É DIFERENTE, e a diferença é armadilha: `countries` é
    // lista de strings ("BR"), `regions` é lista de objetos ({key, name}).
    paises: lista(geo.countries).filter((c) => c != null && String(c) !== '').map((c) => ({ key: String(c), nome: String(c) })),
    estados: lista(geo.regions).filter((r) => r && r.key != null).map((r) => ({ key: String(r.key), nome: nomeDe(r) || String(r.key) })),
```

**3.4** Em `montarTargeting`, logo depois do bloco dos pins e ANTES do `if (Object.keys(geoOriginal).length)`:

```js
  // PAÍS E ESTADO, com o mesmo cuidado das cidades: sobrescreve a chave e some
  // com ela quando não sobra nenhum. Mandar `[]` não é a mesma coisa que não
  // mandar. País vai como string crua; estado, como objeto com `key`.
  const paisesFiltrados = (p.paises || []).filter((x) => x != null && x.key != null).map((x) => String(x.key));
  if (paisesFiltrados.length) geoOriginal.countries = paisesFiltrados;
  else delete geoOriginal.countries;
  const estadosFiltrados = (p.estados || []).filter((x) => x != null && x.key != null).map((x) => ({ key: String(x.key) }));
  if (estadosFiltrados.length) geoOriginal.regions = estadosFiltrados;
  else delete geoOriginal.regions;
```

**3.5** Em `avisosDe`, na conta de "tem lugar?":

```js
  const temPins = (d.pins || []).length > 0;
  // PAÍS E ESTADO CONTAM COMO LOCALIZAÇÃO. Ver a cicatriz de 12/08 no comentário
  // de CHAVES_DE_LOCALIZACAO: chave que sai daquela lista sem entrar aqui deixa
  // o Salvar impossível para quem mira só por ela.
  const temPaises = (d.paises || []).length > 0;
  const temEstados = (d.estados || []).length > 0;
  if (!temCidades && !temOutrasLoc && !temPins && !temPaises && !temEstados) {
```

**3.6** Em `resumoDasMudancas`, depois da linha das cidades:

```js
  const pais = diffLista(a.paises, d.paises, (x) => x.key, 'Países');
  if (pais) linhas.push(pais);
  const est = diffLista(a.estados, d.estados, (x) => x.key, 'Estados');
  if (est) linhas.push(est);
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test src/ferramentas/gestao-trafego/publico-alvo.test.mjs`
Expected: PASS, incluindo os 8 testes novos e o "TODO tipo de lugar" com a lista de 12.

- [ ] **Step 5: Rodar a suíte inteira** (esta mudança encosta em quem lê público)

Run: `npm test 2>&1 | tail -20`
Expected: total **maior** que o de antes. Total MENOR que o conhecido é arquivo sumindo, nunca flake — se acontecer, pare e investigue.

- [ ] **Step 6: Commit**

```bash
git add src/ferramentas/gestao-trafego/publico-alvo.js src/ferramentas/gestao-trafego/publico-alvo.test.mjs
git commit -m "Publico: pais e estado deixam de ser intocaveis e contam como lugar"
```

---

### Task 3: As buscas e a fila de uma pergunta por vez

**Files:**
- Create: `src/compartilhado/busca-de-lugar.js`
- Test: `src/compartilhado/busca-de-lugar.test.mjs`

**Interfaces:**
- Consumes: `LUGAR_TIPOS` de `lugares-do-anuncio.js` (só para validar o tipo).
- Produces:
  - `pedidoDaBusca(tipo, termo) -> {onde:'meta'|'mapa', params}`
  - `lugaresDaRespostaDaMeta(resposta) -> lugar[]`
  - `lugaresDaRespostaDoMapa(resposta) -> lugar[]`
  - `enderecoDeOndeCaiu(resposta) -> {nome, endereco}`
  - `criarFilaDeUmPorVez({esperar, intervalo}) -> (tarefa) => Promise`

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/compartilhado/busca-de-lugar.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pedidoDaBusca, lugaresDaRespostaDaMeta, lugaresDaRespostaDoMapa,
  enderecoDeOndeCaiu, criarFilaDeUmPorVez,
} from './busca-de-lugar.js';

test('cada tipo pergunta no lugar certo', () => {
  assert.equal(pedidoDaBusca('cidade', 'uber').onde, 'meta');
  assert.equal(pedidoDaBusca('estado', 'minas').onde, 'meta');
  assert.equal(pedidoDaBusca('pais', 'bra').onde, 'meta');
  // "Local" NÃO existe no catálogo da Meta: medido em 13/08/2026,
  // location_types:["place"] para "Shopping" devolve lista vazia.
  assert.equal(pedidoDaBusca('local', 'shopping').onde, 'mapa');
});

test('a pergunta pra Meta leva o tipo e o termo', () => {
  const p = pedidoDaBusca('cidade', 'uberlandia');
  assert.equal(p.params.type, 'adgeolocation');
  assert.deepEqual(JSON.parse(p.params.location_types), ['city']);
  assert.equal(p.params.q, 'uberlandia');
});

// A Meta devolve BAIRRO mesmo pedindo só cidade (medido em 13/08/2026 buscando
// "Uberlandia": vieram Centro e Martins como neighborhood). Se a tela não
// mostrar o tipo de cada linha, a pessoa acrescenta um bairro achando que
// acrescentou uma cidade.
test('o tipo REAL de cada linha da Meta viaja junto', () => {
  const achados = lugaresDaRespostaDaMeta({
    data: [
      { key: '273173', name: 'Uberlândia', type: 'city', region: 'Minas Gerais', country_name: 'Brasil' },
      { key: '2784682', name: 'Centro', type: 'neighborhood', region: 'Minas Gerais' },
      { key: '449', name: 'Minas Gerais', type: 'region', country_name: 'Brasil' },
      { key: 'BR', name: 'Brasil', type: 'country' },
    ],
  });
  assert.deepEqual(achados.map((a) => a.tipo), ['cidade', 'bairro', 'estado', 'pais']);
  assert.equal(achados[0].uf, 'Minas Gerais');
  assert.equal(achados[0].comoMirar, 'area');
  assert.equal(achados[0].lat, null, 'a Meta não devolve coordenada — nunca invente uma');
});

test('a resposta do mapa vira lugar com coordenada e endereco', () => {
  const achados = lugaresDaRespostaDoMapa([
    {
      name: 'Center Shopping Uberlândia', lat: '-18.9101557', lon: '-48.2605331',
      display_name: 'Center Shopping Uberlândia, Rua Argentina, Tibery, Uberlândia, Minas Gerais, 38405-174, Brasil',
      address: { road: 'Rua Argentina', suburb: 'Tibery', city: 'Uberlândia', state: 'Minas Gerais', 'ISO3166-2-lvl4': 'BR-MG' },
    },
  ]);
  assert.equal(achados[0].tipo, 'local');
  assert.equal(achados[0].comoMirar, 'ponto');
  assert.equal(achados[0].nome, 'Center Shopping Uberlândia');
  assert.equal(achados[0].lat, -18.9101557);
  assert.equal(achados[0].lng, -48.2605331);
  assert.equal(achados[0].endereco, 'Rua Argentina · Tibery · Uberlândia · MG');
});

test('onde o ponto caiu vira o endereco por extenso', () => {
  const r = enderecoDeOndeCaiu({
    name: 'Pernambucanas',
    address: { road: 'Avenida Afonso Pena', suburb: 'Centro', city: 'Uberlândia', state: 'Minas Gerais', 'ISO3166-2-lvl4': 'BR-MG' },
  });
  assert.equal(r.nome, 'Pernambucanas');
  assert.equal(r.endereco, 'Avenida Afonso Pena · Centro · Uberlândia · MG');
});

test('ponto que cai no meio do nada nao inventa nome', () => {
  assert.deepEqual(enderecoDeOndeCaiu(null), { nome: '', endereco: '' });
  assert.deepEqual(enderecoDeOndeCaiu({}), { nome: '', endereco: '' });
});

// O serviço de mapa é comunitário e pede no máximo uma pergunta por segundo.
// Clicar sete vezes seguidas no mapa tem que ENFILEIRAR sete perguntas, não
// disparar sete de uma vez — que é o jeito mais rápido de ser bloqueado.
test('a fila deixa uma pergunta por vez, com intervalo', async () => {
  const ordem = [];
  const esperas = [];
  const fila = criarFilaDeUmPorVez({ esperar: (ms) => { esperas.push(ms); return Promise.resolve(); }, intervalo: 1100 });
  const a = fila(async () => { ordem.push('comecou a'); return 'a'; });
  const b = fila(async () => { ordem.push('comecou b'); return 'b'; });
  assert.deepEqual(await Promise.all([a, b]), ['a', 'b']);
  assert.deepEqual(ordem, ['comecou a', 'comecou b'], 'b não pode começar antes de a terminar');
  assert.deepEqual(esperas, [1100], 'só espera ENTRE perguntas, não antes da primeira');
});

test('pergunta que falha nao trava a fila', async () => {
  const fila = criarFilaDeUmPorVez({ esperar: () => Promise.resolve(), intervalo: 0 });
  await assert.rejects(fila(async () => { throw new Error('caiu'); }), /caiu/);
  assert.equal(await fila(async () => 'a próxima roda'), 'a próxima roda');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test src/compartilhado/busca-de-lugar.test.mjs`
Expected: FAIL — `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Escrever o módulo**

Criar `src/compartilhado/busca-de-lugar.js`:

```js
// PROCURAR UM LUGAR PELO NOME, E DESCOBRIR QUE LUGAR É UMA COORDENADA.
//
// PURO: sem tela e sem rede. Monta a pergunta e traduz a resposta; quem faz a
// chamada é a tela, e quem fala com o mundo lá fora é a Edge Function
// `buscar-lugar`.
//
// POR QUE SÃO DOIS FORNECEDORES, medido na Graph API em 13/08/2026:
//   • Brasil, Estado e Cidade saem do catálogo da META, porque é a CHAVE dela
//     que segmenta o anúncio — mas ela não devolve coordenada nenhuma;
//   • "Local" (comércio, endereço) a Meta simplesmente não tem:
//     `location_types:["place"]` para "Shopping" devolveu lista vazia. Isso vem
//     do MAPA, e vira ponto com raio (`custom_locations`).

const TIPO_DA_META = { pais: 'country', estado: 'region', cidade: 'city' };

// O caminho de volta: o que a Meta chama, e como a tela chama.
const TIPO_DA_TELA = {
  country: 'pais', region: 'estado', city: 'cidade',
  neighborhood: 'bairro', subcity: 'bairro', subneighborhood: 'bairro',
};

export function pedidoDaBusca(tipo, termo) {
  const q = String(termo || '').trim();
  if (tipo === 'local') return { onde: 'mapa', params: { termo: q } };
  const daMeta = TIPO_DA_META[tipo] || 'city';
  return {
    onde: 'meta',
    params: { type: 'adgeolocation', location_types: JSON.stringify([daMeta]), q, limit: 15 },
  };
}

export function lugaresDaRespostaDaMeta(resposta) {
  const linhas = Array.isArray(resposta && resposta.data) ? resposta.data : [];
  return linhas.filter((x) => x && x.key != null).map((x) => ({
    // O TIPO REAL DA LINHA, não o que foi pedido: pedindo só `city` a Meta
    // devolve bairro junto (medido). Sem isto a pessoa acrescenta um bairro
    // achando que acrescentou uma cidade.
    tipo: TIPO_DA_TELA[x.type] || 'cidade',
    tipoDaMeta: x.type || '',
    chave: String(x.key),
    nome: x.name || String(x.key),
    uf: x.region || x.country_name || '',
    comoMirar: 'area',
    raio: 0, unidade: 'kilometer',
    // A Meta NÃO devolve coordenada. Fica nulo de propósito: inventar um número
    // aqui seria pôr o anúncio noutro lugar.
    lat: null, lng: null,
  }));
}

// "BR-MG" → "MG". A sigla é o que cabe na linha e é o que o dono lê rápido.
function siglaDoEstado(endereco) {
  const iso = (endereco && (endereco['ISO3166-2-lvl4'] || endereco['ISO3166-2-lvl9'])) || '';
  const parte = String(iso).split('-')[1];
  return parte || (endereco && endereco.state) || '';
}

function enderecoEmLinha(endereco) {
  const e = endereco || {};
  const cidade = e.city || e.town || e.village || e.municipality || '';
  return [e.road, e.suburb, cidade, siglaDoEstado(e)].filter(Boolean).join(' · ');
}

export function lugaresDaRespostaDoMapa(resposta) {
  const linhas = Array.isArray(resposta) ? resposta : (resposta && resposta.lugares) || [];
  return linhas.filter((x) => x && x.lat != null && x.lon != null).map((x) => ({
    tipo: 'local',
    chave: null,
    nome: x.name || String(x.display_name || '').split(',')[0] || '',
    uf: '',
    endereco: enderecoEmLinha(x.address),
    comoMirar: 'ponto',
    lat: Number(x.lat), lng: Number(x.lon),
    // 1 km é o raio que os conjuntos reais mais repetem (a Mantova usa isso nos
    // pins de condomínio) — não é chute nosso.
    raio: 1, unidade: 'kilometer', pais: 'BR',
  }));
}

export function enderecoDeOndeCaiu(resposta) {
  const r = resposta || {};
  return { nome: r.name || '', endereco: enderecoEmLinha(r.address) };
}

// UMA PERGUNTA POR VEZ. O serviço de mapa é comunitário e pede no máximo uma
// chamada por segundo. Sete cliques no mapa enfileiram sete perguntas em vez de
// disparar sete juntas — que é o jeito mais rápido de ser bloqueado, e bloqueio
// aqui vira busca que não devolve nada, em silêncio.
export function criarFilaDeUmPorVez(opcoes) {
  const o = opcoes || {};
  const esperar = o.esperar || ((ms) => new Promise((ok) => setTimeout(ok, ms)));
  const intervalo = o.intervalo == null ? 1100 : o.intervalo;
  let ultima = Promise.resolve();
  let jaRodouUma = false;
  return function enfileirar(tarefa) {
    const minha = ultima.then(async () => {
      if (jaRodouUma && intervalo > 0) await esperar(intervalo);
      jaRodouUma = true;
      return tarefa();
    });
    // A fila não pode morrer com uma pergunta que falhou: quem pediu recebe o
    // erro, mas a próxima da fila continua de pé.
    ultima = minha.then(() => undefined, () => undefined);
    return minha;
  };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test src/compartilhado/busca-de-lugar.test.mjs`
Expected: PASS — 8 testes.

- [ ] **Step 5: Commit**

```bash
git add src/compartilhado/busca-de-lugar.js src/compartilhado/busca-de-lugar.test.mjs
git commit -m "Busca de lugar: a pergunta certa pra cada tipo e a fila de uma por vez"
```

---

### Task 4: A recepção — Edge Function `buscar-lugar`

**Files:**
- Create: `supabase/functions/buscar-lugar/index.ts`

**Interfaces:**
- Consumes: nada do código do app (roda no Deno).
- Produces: `POST /functions/v1/buscar-lugar`
  - `{acao:'buscar', termo:string}` → `{lugares: [{name, lat, lon, display_name, address}]}`
  - `{acao:'ondeCaiu', lat:number, lng:number}` → `{name, address, display_name}`
  - erro → `{error: string}` com status 4xx/5xx

**Por que ela existe (decisão do dono, 13/08/2026):** o serviço de mapa é gratuito e comunitário e pede que quem chama se identifique — o navegador não deixa. Sem isso, o dia em que apertarem a regra a busca morre calada. Ela também guarda o que já perguntou e é o único lugar a mexer se um dia trocarmos de serviço.

**Custo assumido:** Edge Function **não sobe com o `git push`**. Publicar é passo à parte, na mão.

- [ ] **Step 1: Escrever a função**

Criar `supabase/functions/buscar-lugar/index.ts`:

```ts
// A RECEPÇÃO DO MAPA — quem liga para o OpenStreetMap em nome da Central.
//
// POR QUE NÃO É O NAVEGADOR QUE LIGA (decisão do dono, 13/08/2026): o Nominatim
// é gratuito e comunitário, e a regra de uso deles pede que quem chama se
// identifique (User-Agent) e não dispare em rajada. Navegador não deixa definir
// User-Agent. Sem isto, no dia em que apertarem a regra a busca de lugar morre
// EM SILÊNCIO — e silêncio virando dado errado já custou 17 horas nesta casa.
//
// Ela faz três coisas e mais nenhuma:
//   1. se identifica;
//   2. guarda o que já perguntou (perguntar duas vezes não custa duas ligações);
//   3. é o ÚNICO lugar a mexer se um dia trocarmos de serviço de mapa.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

const NOMINATIM = 'https://nominatim.openstreetmap.org';
// A identificação que a regra de uso deles pede. Trocar o e-mail aqui é trocar
// quem eles procuram se algo der errado — não é enfeite.
const QUEM_SOU = 'iamundi-central-inteligencia/1.0 (contato: erick@rbvcompany.com)';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Cache de processo, com validade. Não é banco de propósito: o volume é baixo
// (um punhado de buscas por sessão de edição) e tabela seria peso sem retorno.
// Se um dia o volume crescer, é AQUI que a tabela entra.
const cache = new Map<string, { quando: number; valor: unknown }>();
const VALIDADE_MS = 24 * 60 * 60 * 1000;
const TETO_DO_CACHE = 500;

function doCache(chave: string) {
  const achado = cache.get(chave);
  if (!achado) return null;
  if (Date.now() - achado.quando > VALIDADE_MS) { cache.delete(chave); return null; }
  return achado.valor;
}
function guardar(chave: string, valor: unknown) {
  if (cache.size >= TETO_DO_CACHE) cache.delete(cache.keys().next().value as string);
  cache.set(chave, { quando: Date.now(), valor });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  try {
    // MESMA PORTA DO meta-proxy: quem edita público já precisa passar por ela.
    const authHeader = req.headers.get('Authorization') || '';
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: 'nao autenticado' }, 401);

    const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const { data: prof } = await svc.from('profiles').select('role, features').eq('id', user.id).single();
    const allowed = !!prof && (prof.role === 'admin' || (Array.isArray(prof.features) && prof.features.includes('meta')));
    if (!allowed) return json({ error: 'sem permissao' }, 403);

    const { acao, termo, lat, lng } = await req.json();

    if (acao === 'buscar') {
      const q = String(termo || '').trim();
      if (q.length < 3) return json({ error: 'digite pelo menos 3 letras' }, 400);
      const chave = 'buscar:' + q.toLowerCase();
      const guardado = doCache(chave);
      if (guardado) return json({ lugares: guardado, doCache: true });

      // `countrycodes=br`: as sete contas anunciam no Brasil. Se um dia
      // anunciarem fora, é este parâmetro que sai — e não a busca inteira.
      const url = `${NOMINATIM}/search?format=jsonv2&addressdetails=1&limit=8`
        + `&countrycodes=br&q=${encodeURIComponent(q)}`;
      const r = await fetch(url, { headers: { 'User-Agent': QUEM_SOU, 'Accept-Language': 'pt-BR' } });
      if (!r.ok) return json({ error: `o servico de mapa respondeu ${r.status}` }, 502);
      const lugares = await r.json();
      guardar(chave, lugares);
      return json({ lugares });
    }

    if (acao === 'ondeCaiu') {
      const la = Number(lat); const ln = Number(lng);
      if (!Number.isFinite(la) || !Number.isFinite(ln)) return json({ error: 'coordenada invalida' }, 400);
      // Arredondar a chave em 5 casas (~1 metro) faz dois cliques no mesmo ponto
      // custarem uma ligação só.
      const chave = `ondeCaiu:${la.toFixed(5)},${ln.toFixed(5)}`;
      const guardado = doCache(chave);
      if (guardado) return json({ ...(guardado as object), doCache: true });

      const url = `${NOMINATIM}/reverse?format=jsonv2&addressdetails=1&lat=${la}&lon=${ln}`;
      const r = await fetch(url, { headers: { 'User-Agent': QUEM_SOU, 'Accept-Language': 'pt-BR' } });
      if (!r.ok) return json({ error: `o servico de mapa respondeu ${r.status}` }, 502);
      const lugar = await r.json();
      guardar(chave, lugar);
      return json(lugar);
    }

    return json({ error: 'acao desconhecida' }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
```

- [ ] **Step 2: Publicar na mão**

Edge Function **não sobe com push**. Publique pelo MCP do Supabase (`deploy_edge_function`, projeto `kounqtdoioootxqegkij`, nome `buscar-lugar`), com o arquivo inteiro. Ela não usa nada de `_shared`, então é um arquivo só.

- [ ] **Step 3: Provar que respondeu**

No navegador, já logado na Central, no console:

```js
await sbClient.functions.invoke('buscar-lugar', { body: { acao: 'buscar', termo: 'Center Shopping Uberlandia' } })
await sbClient.functions.invoke('buscar-lugar', { body: { acao: 'ondeCaiu', lat: -18.9186, lng: -48.2772 } })
```

Expected: a primeira devolve `lugares[0].name === 'Center Shopping Uberlândia'`; a segunda devolve `name: 'Pernambucanas'`. Rodando a mesma duas vezes, a segunda volta com `doCache: true`.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/buscar-lugar/index.ts
git commit -m "Recepcao do mapa: a funcao que pergunta o lugar e guarda a resposta"
```

---

### Task 5: O mapa desenha área e aceita nome que chega depois

**Files:**
- Modify: `src/ferramentas/gestao-trafego/painel-do-mapa.js`

**Interfaces:**
- Consumes: `lugares-do-anuncio.js` (`podeVirarPonto` não é usado aqui; o mapa só olha `comoMirar`).
- Produces: `montarMapa(alvo, {lugares, editavel, aoMudar, aoPorPonto}) -> {desenhar, enquadrarTudo}`
  - `lugares`: a lista viva (a MESMA que o painel usa). `comoMirar:'ponto'` desenha alfinete com círculo; `'area'` desenha marca chapada.
  - `aoPorPonto(lugar)`: chamado depois que um ponto nasce do clique. Quem chamou busca o nome e chama `desenhar()`.

**Mudança de contrato:** hoje ele recebe `pins`. Passa a receber `lugares`. Há **um** ponto de uso hoje (`tela-de-gestao-trafego.vue:3736`), atualizado na Task 7.

- [ ] **Step 1: Escrever o teste que falha**

Não há teste de DOM neste projeto para o mapa (a aritmética é testada em `mapa-de-pins.test.mjs`, e ela não muda). A prova desta tarefa é a próxima: `todo-vue-compila.test.mjs` + build + os olhos a 375px. Rode a guarda de imports da pasta para garantir que nada ficou pendurado:

Run: `node --test src/ferramentas/gestao-trafego/imports.test.mjs`
Expected: PASS antes e depois.

- [ ] **Step 2: Trocar `pins` por `lugares` e desenhar as duas formas**

Em `montarMapa`, trocar o começo:

```js
export function montarMapa(alvo, opcoes) {
  const o = opcoes || {};
  // A LISTA É UMA SÓ, e é a mesma do painel de lugares: ponto e área moram
  // juntos porque o dono escolhe entre os dois na mesma linha. O mapa não copia
  // a lista — ele mexe nela.
  const lugares = o.lugares || [];
  const pontos = () => lugares.filter((l) => l && l.comoMirar === 'ponto' && Number.isFinite(Number(l.lat)));
  const areas = () => lugares.filter((l) => l && l.comoMirar !== 'ponto' && Number.isFinite(Number(l.lat)));
  const editavel = !!o.editavel;
  garantirCss();
```

Em `desenhar()`, substituir o corpo de `camadaP.innerHTML = …` por:

```js
    // ÁREA NÃO LEVA CÍRCULO. Um alfinete com círculo diria uma mentira: "a
    // cidade inteira" não tem raio nenhum, e o círculo faria o dono acreditar
    // que o anúncio para na borda dele.
    const desenhoDaArea = areas().map((a) => {
      const pos = posicaoNaJanela(a, janela);
      return `<span class="gt-mapa-area" data-area="1" style="left:${pos.esquerda}px;top:${pos.topo}px" title="${esc(a.nome || '')} — a área inteira"></span>`;
    }).join('');

    const desenhoDosPontos = pontos().map((p) => {
      const pos = posicaoNaJanela(p, janela);
      const raio = raioEmPixels(p.lat, p.raio, p.unidade, janela.zoom);
      const circulo = raio > 2
        ? `<span class="gt-mapa-raio" style="left:${pos.esquerda - raio}px;top:${pos.topo - raio}px;width:${raio * 2}px;height:${raio * 2}px"></span>`
        : '';
      const rotulo = p.nome || `${Number(p.lat).toFixed(4)}, ${Number(p.lng).toFixed(4)}`;
      const indice = lugares.indexOf(p);
      return circulo + `<span class="gt-mapa-pin" data-pin="${indice}" style="left:${pos.esquerda}px;top:${pos.topo}px" title="${esc(rotulo)}"></span>`;
    }).join('');

    camadaP.innerHTML = desenhoDaArea + desenhoDosPontos;

    const qtd = pontos().length + areas().length;
    dica.textContent = qtd
      ? `${qtd} lugar${qtd > 1 ? 'es' : ''} · zoom ${vista.zoom}`
      : (editavel ? 'Nenhum lugar ainda — clique no mapa para pôr um ponto.' : 'Nenhum lugar.');
```

No `enquadrar`, trocar as três ocorrências de `pins` por `[...pontos(), ...areas()]`:

```js
  let vista = enquadrar([...pontos(), ...areas()], tamanho().largura, tamanho().altura)
    || { centro: { lat: -22.9099, lng: -47.0626 }, zoom: 9 };
```

(e o mesmo nas duas chamadas de `enquadrarTudo` e no botão `data-mapa="tudo"`.)

No clique que põe ponto:

```js
    const novo = {
      tipo: 'local', chave: null, nome: '', endereco: '',
      comoMirar: 'ponto', lat: c.lat, lng: c.lng,
      raio: 1, unidade: 'kilometer', pais: 'BR',
      // O NOME AINDA NÃO CHEGOU, e o alfinete não espera por ele: desenhar só
      // depois da resposta faria o mapa parecer travado no clique.
      procurandoNome: true,
    };
    lugares.push(novo);
    desenhar();
    if (o.aoMudar) o.aoMudar();
    if (o.aoPorPonto) o.aoPorPonto(novo);
```

No clique que tira ponto, trocar `pins.splice(...)` por `lugares.splice(Number(alvoPin.dataset.pin), 1)`.

- [ ] **Step 3: Acrescentar o CSS da marca de área**

No bloco `CSS`, depois da regra `.gt-mapa-pin:hover`:

```css
/* A marca de "área inteira": quadrada e chapada, DE PROPÓSITO diferente do
   alfinete — e sem círculo, porque área não tem raio. */
.gt-mapa-area{position:absolute;width:14px;height:14px;margin:-7px 0 0 -7px;pointer-events:none;
  background:var(--surface,#151a20);border:2px solid var(--accent,#4f7cff);border-radius:3px;box-shadow:0 1px 4px rgba(0,0,0,.5);}
```

- [ ] **Step 4: Rodar o que dá pra rodar**

Run: `node --test src/ferramentas/gestao-trafego/imports.test.mjs && npm run build 2>&1 | tail -5`
Expected: PASS + build limpo.

- [ ] **Step 5: Commit**

```bash
git add src/ferramentas/gestao-trafego/painel-do-mapa.js
git commit -m "Mapa: desenha area sem circulo e aceita o nome do ponto chegando depois"
```

---

### Task 6: O painel de lugares

**Files:**
- Create: `src/compartilhado/painel-de-lugares.js`

**Interfaces:**
- Consumes: `LUGAR_TIPOS`, `podeVirarPonto`, `rotuloDoLugar` (Task 1); `pedidoDaBusca`, `lugaresDaRespostaDaMeta`, `lugaresDaRespostaDoMapa`, `criarFilaDeUmPorVez` (Task 3).
- Produces: `montarPainelDeLugares(alvo, {lugares, buscarNaMeta, buscarNoMapa, aoMudar}) -> {redesenhar}`
  - `buscarNaMeta(params) -> Promise<resposta da Meta>` — quem chama decide se é `metaFetch` (Gestão de Tráfego) ou `functions.invoke('meta-proxy')` (Fábrica).
  - `buscarNoMapa(termo) -> Promise<{lugares}>` — a recepção da Task 4.

- [ ] **Step 1: Escrever o módulo**

Criar `src/compartilhado/painel-de-lugares.js`:

```js
// ESCOLHER ONDE O ANÚNCIO APARECE — Brasil, Estado, Cidade ou Local.
//
// PEDIDO DO DONO (13/08/2026): "eu preciso selecionar entre Brasil, Estado,
// Cidade e Local (estabelecimento, comércio, negócio) e aparece o pin automático
// no mapa e vice versa".
//
// IMPERATIVO E MONTADO NUM ELEMENTO, igual ao `painel-do-mapa.js`, e pela mesma
// razão: ele precisa servir DUAS telas de naturezas diferentes — a Gestão de
// Tráfego, cujo modal é montado com `document.body.appendChild` (fora da raiz do
// componente, onde `:deep()` não alcança), e a Fábrica, que é Vue de verdade.
// Uma peça só, desenhada uma vez.
import { LUGAR_TIPOS, podeVirarPonto, rotuloDoLugar } from './lugares-do-anuncio.js';
import {
  pedidoDaBusca, lugaresDaRespostaDaMeta, lugaresDaRespostaDoMapa, criarFilaDeUmPorVez,
} from './busca-de-lugar.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Mesma razão do CSS viajar com o mapa: o modal do público vive FORA da raiz do
// componente. Todo seletor começa em `.pl-`.
const CSS = `
.pl-tipos{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;}
.pl-linha{display:flex;flex-wrap:wrap;gap:8px;align-items:center;}
.pl-campo{flex:1 1 200px;min-height:40px;padding:0 10px;border:1px solid var(--border,#2a2a2a);border-radius:8px;
  background:var(--surface2,#11161c);color:var(--text,#e6edf3);font-size:max(16px, calc(16px * var(--escala-texto, 1)));}
.pl-achados{display:flex;flex-direction:column;gap:4px;margin-top:8px;}
.pl-achado{min-height:40px;text-align:left;padding:8px 10px;border:1px solid var(--border,#2a2a2a);border-radius:8px;
  background:none;color:var(--text,#e6edf3);font-size:max(9px, calc(13px * var(--escala-texto, 1)));cursor:pointer;overflow-wrap:anywhere;}
.pl-achado:hover{border-color:var(--accent,#4f7cff);}
.pl-achado-tipo{color:var(--muted,#93a3b3);}
.pl-recado{margin-top:8px;font-size:max(9px, calc(12px * var(--escala-texto, 1)));color:var(--muted,#93a3b3);overflow-wrap:anywhere;}
.pl-recado--erro{color:var(--red,#dc2626);}
.pl-lista{margin-top:10px;display:flex;flex-direction:column;gap:8px;}
.pl-item{display:flex;flex-wrap:wrap;gap:8px;align-items:center;font-size:max(9px, calc(13px * var(--escala-texto, 1)));color:var(--text,#e6edf3);}
.pl-item-nome{flex:1 1 180px;overflow-wrap:anywhere;}
.pl-item-raio{width:74px;min-height:40px;padding:0 8px;border:1px solid var(--border,#2a2a2a);border-radius:8px;
  background:var(--surface2,#11161c);color:var(--text,#e6edf3);font-size:max(16px, calc(16px * var(--escala-texto, 1)));}
.pl-vazio{margin:0;font-size:max(9px, calc(12px * var(--escala-texto, 1)));color:var(--muted,#93a3b3);}
@media(max-width:640px){.pl-item-nome{flex:1 1 100%;}}
`;

function garantirCss() {
  if (typeof document === 'undefined' || document.getElementById('pl-css')) return;
  const el = document.createElement('style');
  el.id = 'pl-css';
  el.textContent = CSS;
  document.head.appendChild(el);
}

const NOME_DO_TIPO = { pais: 'país', estado: 'estado', cidade: 'cidade', bairro: 'bairro', local: 'local' };

export function montarPainelDeLugares(alvo, opcoes) {
  const o = opcoes || {};
  const lugares = o.lugares || [];
  const fila = criarFilaDeUmPorVez({});
  garantirCss();

  let tipoAtivo = 'cidade';
  let achados = [];
  let recado = '';
  let recadoEhErro = false;
  let buscando = false;

  alvo.innerHTML = `
    <div class="pl">
      <div class="pl-tipos" role="group" aria-label="Tipo de lugar"></div>
      <div class="pl-linha">
        <input class="pl-campo" type="text" aria-label="Nome do lugar">
        <button type="button" class="btn" data-pl="buscar">Buscar</button>
      </div>
      <div class="pl-achados"></div>
      <p class="pl-recado"></p>
      <div class="pl-lista"></div>
    </div>`;

  const caixaTipos = alvo.querySelector('.pl-tipos');
  const campo = alvo.querySelector('.pl-campo');
  const btBuscar = alvo.querySelector('[data-pl="buscar"]');
  const caixaAchados = alvo.querySelector('.pl-achados');
  const caixaRecado = alvo.querySelector('.pl-recado');
  const caixaLista = alvo.querySelector('.pl-lista');

  function dizer(texto, ehErro) { recado = texto || ''; recadoEhErro = !!ehErro; pintar(); }

  async function buscar() {
    const termo = campo.value.trim();
    if (!termo) return;
    achados = []; buscando = true; dizer('Procurando…', false);
    try {
      const pedido = pedidoDaBusca(tipoAtivo, termo);
      if (pedido.onde === 'meta') {
        achados = lugaresDaRespostaDaMeta(await fila(() => o.buscarNaMeta(pedido.params)));
      } else {
        achados = lugaresDaRespostaDoMapa(await fila(() => o.buscarNoMapa(pedido.params.termo)));
      }
      // "Nada encontrado" é resultado, não erro — e "não consegui perguntar" é
      // erro, não resultado. A tela nunca pode confundir os dois: lista vazia
      // fingindo de resposta é a mentira mais cara que uma tela conta.
      dizer(achados.length ? '' : 'Nada encontrado para essa busca.', false);
    } catch (e) {
      achados = [];
      dizer('Não consegui buscar agora: ' + String((e && e.message) || e).slice(0, 140), true);
    } finally {
      buscando = false; pintar();
    }
  }

  function acrescentar(achado) {
    const igual = lugares.some((l) => (
      (l.chave != null && achado.chave != null && String(l.chave) === String(achado.chave) && l.tipo === achado.tipo)
      || (l.lat != null && achado.lat != null && Number(l.lat) === Number(achado.lat) && Number(l.lng) === Number(achado.lng))
    ));
    const novo = { ...achado };
    if (!igual) lugares.push(novo);
    achados = []; campo.value = ''; dizer('', false);
    if (o.aoMudar) o.aoMudar();
    // "APARECE O PIN AUTOMÁTICO NO MAPA" — a metade do pedido que a Meta não
    // consegue cumprir sozinha: ela não devolve coordenada NENHUMA (medido em
    // 13/08/2026). Quem escolheu "a área inteira" ainda assim precisa VER onde
    // aquilo fica, então a coordenada é procurada no mapa só para desenhar.
    // Ela não muda o que vai para a Meta: área continua indo pela chave.
    if (!igual && novo.lat == null) procurarOndeFica(novo);
  }

  // Descobre a coordenada de um lugar que veio do catálogo da Meta (que não tem
  // coordenada). Silencioso de propósito quando falha: o lugar CONTINUA valendo
  // pela chave, e um erro vermelho aqui assustaria por algo que não quebrou
  // nada. O que a falha custa é só a marca no mapa — e a linha diz isso.
  async function procurarOndeFica(lugar) {
    lugar.procurandoNome = true; pintar();
    try {
      const r = await fila(() => o.buscarNoMapa([lugar.nome, lugar.uf].filter(Boolean).join(', ')));
      const achado = lugaresDaRespostaDoMapa(r)[0];
      if (achado) { lugar.lat = achado.lat; lugar.lng = achado.lng; }
      else lugar.semMarcaNoMapa = true;
    } catch { lugar.semMarcaNoMapa = true; } finally {
      lugar.procurandoNome = false;
      pintar();
      if (o.aoMudar) o.aoMudar();
    }
  }

  // TROCAR "ÁREA INTEIRA" POR "PONTO COM RAIO" PRECISA DE COORDENADA, e a Meta
  // não devolve nenhuma (medido em 13/08/2026). Quem sabe onde fica é o mapa.
  // Se ele não souber, o botão NÃO troca e diz por quê: gravar um ponto sem
  // coordenada seria pôr o anúncio em lugar nenhum, em silêncio.
  async function virarPonto(lugar) {
    if (lugar.lat != null && lugar.lng != null) { lugar.comoMirar = 'ponto'; lugar.raio = lugar.raio || 5; pintar(); if (o.aoMudar) o.aoMudar(); return; }
    dizer('Procurando onde fica ' + rotuloDoLugar(lugar) + '…', false);
    try {
      const r = await fila(() => o.buscarNoMapa([lugar.nome, lugar.uf].filter(Boolean).join(', ')));
      const achado = lugaresDaRespostaDoMapa(r)[0];
      if (!achado) { dizer('Não achei a coordenada de ' + rotuloDoLugar(lugar) + ' — continua valendo como a área inteira.', true); return; }
      lugar.lat = achado.lat; lugar.lng = achado.lng;
      lugar.comoMirar = 'ponto'; lugar.raio = lugar.raio || 5;
      dizer('', false);
      if (o.aoMudar) o.aoMudar();
    } catch (e) {
      dizer('Não consegui a coordenada agora: ' + String((e && e.message) || e).slice(0, 140), true);
    }
  }

  function pintar() {
    caixaTipos.innerHTML = LUGAR_TIPOS.map((t) => (
      `<button type="button" class="btn${t.id === tipoAtivo ? ' btn-principal' : ''}" data-tipo="${t.id}"`
      + ` aria-pressed="${t.id === tipoAtivo}">${esc(t.rotulo)}</button>`
    )).join('');

    campo.placeholder = tipoAtivo === 'local'
      ? 'nome do comércio, ou o endereço…'
      : 'nome do ' + (NOME_DO_TIPO[tipoAtivo] || 'lugar') + '…';
    btBuscar.disabled = buscando;
    btBuscar.textContent = buscando ? 'Procurando…' : 'Buscar';

    caixaAchados.innerHTML = achados.map((a, i) => (
      `<button type="button" class="pl-achado" data-achado="${i}">${esc(rotuloDoLugar(a))}`
      + ` <span class="pl-achado-tipo">(${esc(NOME_DO_TIPO[a.tipo] || a.tipo)})</span></button>`
    )).join('');

    caixaRecado.textContent = recado;
    caixaRecado.className = 'pl-recado' + (recadoEhErro ? ' pl-recado--erro' : '');

    caixaLista.innerHTML = '';
    if (!lugares.length) {
      const p = document.createElement('p');
      p.className = 'pl-vazio';
      p.textContent = 'Nenhum lugar escolhido ainda. A Meta não aceita anúncio sem lugar.';
      caixaLista.appendChild(p);
    }
    lugares.forEach((l, i) => {
      const linha = document.createElement('div');
      linha.className = 'pl-item';

      const nome = document.createElement('span');
      nome.className = 'pl-item-nome';
      nome.textContent = rotuloDoLugar(l)
        + (l.procurandoNome ? ' · procurando no mapa…' : '')
        // A tela nunca mente: se a marca não pôde ser desenhada, ela DIZ, e diz
        // também que o lugar continua valendo.
        + (l.semMarcaNoMapa && l.comoMirar !== 'ponto' ? ' · não achei no mapa (continua valendo)' : '');

      linha.appendChild(nome);

      if (podeVirarPonto(l.tipo)) {
        const alterna = document.createElement('button');
        alterna.type = 'button';
        alterna.className = 'btn';
        alterna.textContent = l.comoMirar === 'ponto' ? 'ponto com raio' : 'a área inteira';
        alterna.setAttribute('aria-label', 'Como mirar ' + rotuloDoLugar(l));
        alterna.onclick = () => {
          if (l.comoMirar === 'ponto') { l.comoMirar = 'area'; pintar(); if (o.aoMudar) o.aoMudar(); }
          else virarPonto(l);
        };
        linha.appendChild(alterna);
      }

      // O RAIO aparece nos dois casos, com significados diferentes — e é por isso
      // que o título de cada um diz qual é. Cidade "área inteira" com raio 0 é a
      // cidade toda; o ponto começa em 1 km.
      if (l.tipo !== 'pais') {
        const raio = document.createElement('input');
        raio.type = 'number'; raio.min = '0'; raio.className = 'pl-item-raio';
        raio.value = String(l.raio == null ? 0 : l.raio);
        raio.title = l.comoMirar === 'ponto'
          ? 'Raio do ponto, em km'
          : 'Raio em volta da cidade, em km (0 = a cidade inteira; a Meta não aceita menos de 17)';
        raio.setAttribute('aria-label', 'Raio de ' + rotuloDoLugar(l));
        // Não repinta no `onchange`: repintar tiraria o cursor do campo no meio
        // da digitação (a mesma razão do raio das cidades no editor antigo).
        raio.onchange = () => { l.raio = Number(raio.value) || 0; if (o.aoMudar) o.aoMudar(); };
        linha.appendChild(raio);
      }

      const tirar = document.createElement('button');
      tirar.type = 'button';
      tirar.className = 'btn';
      tirar.textContent = 'remover';
      tirar.setAttribute('aria-label', 'Remover ' + rotuloDoLugar(l));
      tirar.onclick = () => { lugares.splice(i, 1); pintar(); if (o.aoMudar) o.aoMudar(); };
      linha.appendChild(tirar);

      caixaLista.appendChild(linha);
    });
  }

  caixaTipos.addEventListener('click', (ev) => {
    const bt = ev.target.closest('[data-tipo]');
    if (!bt) return;
    ev.preventDefault(); ev.stopPropagation();
    tipoAtivo = bt.dataset.tipo; achados = []; dizer('', false);
  });
  caixaAchados.addEventListener('click', (ev) => {
    const bt = ev.target.closest('[data-achado]');
    if (!bt) return;
    ev.preventDefault(); ev.stopPropagation();
    acrescentar(achados[Number(bt.dataset.achado)]);
  });
  btBuscar.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); buscar(); });
  campo.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); buscar(); } });

  pintar();
  return { redesenhar: pintar, dizer };
}
```

- [ ] **Step 2: Conferir que compila e que a régua do padrão aceita**

Run: `npm test 2>&1 | tail -20`
Expected: PASS. `padrao-da-central.test.mjs` reprova botão com `style=` ou fundo cinza — este painel usa só `.btn` e `.btn.btn-principal`.

- [ ] **Step 3: Commit**

```bash
git add src/compartilhado/painel-de-lugares.js
git commit -m "Painel de lugares: escolher entre Brasil, Estado, Cidade e Local"
```

---

### Task 7: A Gestão de Tráfego usa o painel

**Files:**
- Modify: `src/ferramentas/gestao-trafego/tela-de-gestao-trafego.vue` (função `_gtPubSecaoLugar`, hoje na linha 3682; `_gtPubListaDePins`, linha 3645, some)

**Interfaces:**
- Consumes: `montarPainelDeLugares` (Task 6), `deListas`/`paraListas` (Task 1), `montarMapa` com o contrato novo (Task 5).
- Produces: nada para tarefas seguintes.

- [ ] **Step 1: Trocar os imports**

No `<script>` da tela, junto dos outros imports:

```js
import { montarMapa } from './painel-do-mapa.js'
import { montarPainelDeLugares } from '../../compartilhado/painel-de-lugares.js'
import { deListas, paraListas } from '../../compartilhado/lugares-do-anuncio.js'
import { enderecoDeOndeCaiu } from '../../compartilhado/busca-de-lugar.js'
```

- [ ] **Step 2: Substituir o miolo de `_gtPubSecaoLugar`**

Apagar `_gtPubListaDePins` inteira e trocar, dentro de `_gtPubSecaoLugar`, tudo que vai do título "Onde mostrar" até o fim do bloco do mapa (a busca de cidade, os chips de cidade, o título "Pontos exatos no mapa", a `caixaMapa` e a `listaPins`) por:

```js
  cx.appendChild(_gtPubTitulo('Onde mostrar'));
  cx.appendChild(_gtPubAjuda('Escolha Brasil, Estado, Cidade ou Local. Cada um pode valer como a área inteira ou como um ponto com raio — e o mapa mostra onde cada escolha caiu. Clique no mapa para pôr um ponto; ele descobre sozinho a rua em que caiu.'));

  // A LISTA DE LUGARES É UMA SÓ, e o painel e o mapa mexem NELA. As quatro
  // listas que a Meta entende (`paises`, `estados`, `cidades`, `pins`) são
  // refeitas a cada mudança — assim `montarTargeting` continua sendo a única
  // dona da tradução, e a tela nunca escreve na Meta por conta própria.
  const lugares = deListas(_gtPub);
  const gravar = () => Object.assign(_gtPub, paraListas(lugares));

  const caixaPainel = document.createElement('div');
  cx.appendChild(caixaPainel);

  const caixaMapa = document.createElement('div');
  cx.appendChild(caixaMapa);

  let mapa = null;
  const painel = montarPainelDeLugares(caixaPainel, {
    lugares,
    buscarNaMeta: (params) => metaFetch('/search', params, _gtCurAcc?.id),
    buscarNoMapa: async (termo) => {
      const { data, error } = await sbClient.functions.invoke('buscar-lugar', { body: { acao: 'buscar', termo } });
      // O MOTIVO VAI PRA TELA. Engolir o erro aqui devolveria lista vazia, e
      // "nada encontrado" quando na verdade a busca falhou é a mentira que o
      // padrão proíbe.
      if (error || data?.error) throw new Error(data?.error || error?.message || 'a recepção do mapa não respondeu');
      return data;
    },
    aoMudar: () => { gravar(); if (mapa) mapa.desenhar(); },
  });

  // Desenha DEPOIS de estar na tela: o mapa mede a própria largura pra decidir
  // quantos quadradinhos busca, e fora do documento ela é zero.
  setTimeout(() => {
    try {
      mapa = montarMapa(caixaMapa, {
        lugares,
        editavel: true,
        aoMudar: () => { gravar(); painel.redesenhar(); },
        // O PONTO SE APRESENTA. Ele já nasceu no mapa; o nome chega depois, e
        // quando chega o rótulo deixa de ser um par de números.
        aoPorPonto: async (ponto) => {
          try {
            const { data, error } = await sbClient.functions.invoke('buscar-lugar', { body: { acao: 'ondeCaiu', lat: ponto.lat, lng: ponto.lng } });
            if (error || data?.error) throw new Error(data?.error || error?.message || 'sem resposta');
            const achado = enderecoDeOndeCaiu(data);
            ponto.nome = achado.nome; ponto.endereco = achado.endereco;
          } catch (e) {
            // Sem nome, fica a coordenada — que é feia e verdadeira. E a tela
            // DIZ que não conseguiu, em vez de deixar o dono achando que o
            // endereço em branco é o endereço.
            painel.dizer('Pus o ponto, mas não consegui o endereço dele: ' + String((e && e.message) || e).slice(0, 120), true);
          } finally {
            ponto.procurandoNome = false;
            gravar(); painel.redesenhar(); if (mapa) mapa.desenhar();
          }
        },
      });
    } catch (e) { console.warn('[GT] mapa nao abriu:', e); caixaMapa.textContent = 'Nao consegui abrir o mapa.'; }
  }, 0);

  // Aviso calmo: há localidades que este editor não gerencia (CEP, bairro,
  // região metropolitana…) e que serão preservadas intactas ao salvar.
  if ((_gtPub.outrasLocalizacoes || []).length) {
    const notaLocal = avisosDe(_gtPub, _gtPub, {}).find(x => x.tipo === 'outras-localizacoes');
    if (notaLocal) {
      const nota = document.createElement('div');
      nota.style.cssText = 'font-size:calc(11px*var(--gt-fs,1.3));color:var(--muted,#666);margin:2px 0 7px;line-height:1.45;';
      nota.innerHTML = notaLocal.texto;
      cx.appendChild(nota);
    }
  }
```

**Não mexa** no bloco "Onde NÃO mostrar" logo abaixo: exclusão continua exatamente como está.

- [ ] **Step 3: Rodar as guardas**

Run: `node --test src/ferramentas/gestao-trafego/imports.test.mjs && npm test 2>&1 | tail -20 && npm run build 2>&1 | tail -5`
Expected: PASS nos três. A guarda de imports pega justamente o caso de usar `montarPainelDeLugares` sem importar — que o build NÃO pega.

- [ ] **Step 4: Abrir no navegador e olhar**

Run: `npm run dev -- --port 5199 --strictPort`

Conferir, logado, em Gestão de Tráfego → editar público de um conjunto:
1. Os quatro tipos aparecem e o ativo está destacado.
2. Buscar "Uberlandia" em **Cidade** lista a cidade **e os bairros, cada um com o tipo escrito**.
3. Escolher a cidade → ela entra na lista e a marca quadrada aparece no mapa.
4. Trocar para "ponto com raio" → vira alfinete com círculo.
5. Clicar no mapa → alfinete na hora, e em seguida o endereço por extenso.
6. **A 375px e a 1440px**, e no tema escuro.

- [ ] **Step 5: Commit**

```bash
git add src/ferramentas/gestao-trafego/tela-de-gestao-trafego.vue
git commit -m "Gestao de Trafego: escolher lugar por tipo, com o mapa dos dois lados"
```

---

### Task 8: A Fábrica usa o mesmo painel

**Files:**
- Modify: `src/ferramentas/meta-ads/painel-subir.vue` (busca de cidade nas linhas 76–97; template nas linhas 418–435; `publicoBase` linha 45; `publicoParaEnvio` linha 180)
- Modify: `coletor/lib/publico.mjs`
- Test: `coletor/lib/publico.test.mjs`

**Interfaces:**
- Consumes: `montarPainelDeLugares`, `deListas`, `paraListas`, `montarMapa`, `enderecoDeOndeCaiu`.
- Produces: `publico.geo` ganha `countries: []`, `regions: []`, `pins: []` ao lado de `cities` e `excluded`. `fabrica_publicos.geo` é `jsonb` — **não precisa de migration**; preset antigo sem as chaves novas continua válido.

- [ ] **Step 1: Escrever o teste que falha (o robô que monta o targeting)**

Acrescentar a `coletor/lib/publico.test.mjs`:

```js
test('pais, estado e ponto entram no targeting da Fabrica', () => {
  const t = montarTargeting({
    geo: {
      cities: [{ key: '1058', radius: 0 }],
      countries: [{ key: 'BR' }],
      regions: [{ key: '449' }],
      pins: [{ lat: -18.91, lng: -48.26, raio: 2, unidade: 'kilometer', nome: 'Center Shopping', endereco: 'Rua Argentina' }],
      excluded: [],
    },
  }, { geoCities: ['999'] });
  assert.deepEqual(t.geo_locations.countries, ['BR'], 'país é string crua');
  assert.deepEqual(t.geo_locations.regions, [{ key: '449' }]);
  assert.equal(t.geo_locations.custom_locations.length, 1);
  assert.equal(t.geo_locations.custom_locations[0].latitude, -18.91);
  assert.equal(t.geo_locations.custom_locations[0].radius, 2);
  assert.equal(t.geo_locations.custom_locations[0].name, 'Center Shopping');
});

// A cidade da loja é a rede de segurança contra público mundial. Ela só entra
// quando NÃO há lugar nenhum — e ponto, país e estado são lugar.
test('lugar sem cidade nao cai na cidade da loja', () => {
  const t = montarTargeting({
    geo: { cities: [], countries: [], regions: [{ key: '449' }], pins: [], excluded: [] },
  }, { geoCities: ['999'] });
  assert.ok(!t.geo_locations.cities, 'com estado escolhido, a cidade da loja não pode entrar por baixo');
  assert.deepEqual(t.geo_locations.regions, [{ key: '449' }]);
});

test('publico sem lugar NENHUM ainda cai na cidade da loja', () => {
  const t = montarTargeting({ geo: { cities: [], excluded: [] } }, { geoCities: ['999'] });
  assert.deepEqual(t.geo_locations.cities, [{ key: '999' }]);
});
```

Run: `node --test coletor/lib/publico.test.mjs`
Expected: FAIL — `t.geo_locations.countries` é `undefined`.

- [ ] **Step 2: Ensinar o robô a montar as três chaves novas**

Em `coletor/lib/publico.mjs`, substituir a montagem do `geo_locations`:

```js
  // AS QUATRO FORMAS DE MIRAR UM LUGAR (13/08/2026). Antes só existia cidade;
  // o editor passou a oferecer Brasil, Estado, Cidade e Local (ponto com raio).
  // A cidade da loja continua sendo a rede contra público mundial — mas só
  // quando NÃO há lugar nenhum, senão ela entraria por baixo de uma escolha
  // deliberada do dono e alargaria o anúncio sem ninguém pedir.
  const geo = {};
  if (cities.length) geo.cities = cities;
  const paises = (publico.geo?.countries || []).map((c) => String(c.key ?? c)).filter(Boolean);
  if (paises.length) geo.countries = paises;
  const estados = (publico.geo?.regions || []).filter((r) => r && r.key != null).map((r) => ({ key: String(r.key) }));
  if (estados.length) geo.regions = estados;
  const pontos = (publico.geo?.pins || [])
    .filter((p) => p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)))
    .map((p) => {
      const o = {
        latitude: Number(Number(p.lat).toFixed(6)),
        longitude: Number(Number(p.lng).toFixed(6)),
        radius: Number(p.raio) > 0 ? Number(p.raio) : 1,
        distance_unit: p.unidade === 'mile' ? 'mile' : 'kilometer',
        country: p.pais || 'BR',
      };
      if (p.nome) { o.name = p.nome; o.address_string = p.endereco || p.nome; }
      return o;
    });
  if (pontos.length) geo.custom_locations = pontos;
  if (!Object.keys(geo).length) geo.cities = cidadesLoja;
  t.geo_locations = geo;
```

(A linha antiga `t.geo_locations = { cities: cities.length ? cities : cidadesLoja };` sai.)

Run: `node --test coletor/lib/publico.test.mjs`
Expected: PASS.

- [ ] **Step 3: Commit do robô**

```bash
git add coletor/lib/publico.mjs coletor/lib/publico.test.mjs
git commit -m "Fabrica: o robo monta pais, estado e ponto no targeting"
```

- [ ] **Step 4: Trocar a busca de cidade solta pelo painel, na tela**

Em `src/ferramentas/meta-ads/painel-subir.vue`:

**4.1** Imports:

```js
import { montarPainelDeLugares } from '../../compartilhado/painel-de-lugares.js'
import { deListas, paraListas } from '../../compartilhado/lugares-do-anuncio.js'
import { enderecoDeOndeCaiu } from '../../compartilhado/busca-de-lugar.js'
import { montarMapa } from '../gestao-trafego/painel-do-mapa.js'
```

**4.2** `publicoBase` ganha as três chaves novas:

```js
function publicoBase(slug) {
  // `countries`, `regions` e `pins` entraram em 13/08/2026 junto com o painel de
  // lugares. Preset salvo antes disso não tem essas chaves e continua válido —
  // `fabrica_publicos.geo` é jsonb, e o que falta lê como lista vazia.
  return { presetId: '', nome: '', geo: { cities: cidadesDaLoja(slug), excluded: [], countries: [], regions: [], pins: [] }, idade_min: 18, idade_max: 65, generos: [], interesses: [], custom_audiences: [] }
}
```

E o mesmo em `aplicarPreset` (nas duas montagens de `geo`).

**4.3** `publicoParaEnvio` carrega as três:

```js
function publicoParaEnvio(p = publico) {
  return {
    geo: {
      cities: (p.geo.cities || []).map((c) => ({ key: c.key, nome: c.nome, radius: c.radius, distance_unit: c.distance_unit })),
      excluded: (p.geo.excluded || []).map((e) => ({ key: e.key, nome: e.nome, type: e.type })),
      countries: (p.geo.countries || []).map((c) => ({ key: c.key, nome: c.nome })),
      regions: (p.geo.regions || []).map((r) => ({ key: r.key, nome: r.nome })),
      pins: (p.geo.pins || []).map((x) => ({ lat: x.lat, lng: x.lng, raio: x.raio, unidade: x.unidade, nome: x.nome, endereco: x.endereco, pais: x.pais })),
    },
    idade_min: p.idade_min, idade_max: p.idade_max, generos: [...p.generos],
    interesses: p.interesses.map((i) => ({ id: i.id, name: i.name })),
    custom_audiences: p.custom_audiences.map((a) => ({ id: a.id, name: a.name, subtype: a.subtype })),
  }
}
```

**4.4** Apagar `buscaCidade`, `cidadesAchadas`, `erroCidade`, `buscarCidades`, `addCidade`, `rmCidade` (as de INCLUIR; `excluirCidade`/`rmExcluida` **ficam**, a exclusão não muda) e pôr no lugar:

```js
// O PAINEL DE LUGARES, o MESMO da Gestão de Tráfego. As chaves da Fábrica
// (`geo.cities`, `geo.countries`, `geo.regions`, `geo.pins`) são refeitas a cada
// mudança a partir da lista única que o painel e o mapa compartilham.
const caixaLugares = ref(null); const caixaMapaLugares = ref(null)
let painelLugares = null; let mapaLugares = null; let lugares = []
function listasParaGeo() {
  const l = paraListas(lugares)
  publico.geo.cities = l.cidades.map((c) => ({ key: c.key, nome: c.nome, radius: c.raio, distance_unit: c.unidade }))
  publico.geo.countries = l.paises
  publico.geo.regions = l.estados
  publico.geo.pins = l.pins
}
function geoParaListas() {
  return deListas({
    paises: publico.geo.countries || [],
    estados: publico.geo.regions || [],
    cidades: (publico.geo.cities || []).map((c) => ({ key: c.key, nome: c.nome, raio: c.radius, unidade: c.distance_unit })),
    pins: publico.geo.pins || [],
  })
}
async function buscarNoMapa(termo) {
  const { data, error } = await sbClient.functions.invoke('buscar-lugar', { body: { acao: 'buscar', termo } })
  if (error || data?.error) throw new Error(data?.error || error?.message || 'a recepção do mapa não respondeu')
  return data
}
function montarLugares() {
  if (!caixaLugares.value) return
  lugares = geoParaListas()
  painelLugares = montarPainelDeLugares(caixaLugares.value, {
    lugares,
    buscarNaMeta: async (params) => {
      const { data, error } = await sbClient.functions.invoke('meta-proxy', { body: { accountId: ACCOUNT_ID, path: '/search', params, method: 'GET' } })
      if (error || data?.error) throw new Error(data?.error?.message || error?.message || 'a Meta não respondeu')
      return data
    },
    buscarNoMapa,
    aoMudar: () => { listasParaGeo(); if (mapaLugares) mapaLugares.desenhar() },
  })
  mapaLugares = montarMapa(caixaMapaLugares.value, {
    lugares, editavel: true,
    aoMudar: () => { listasParaGeo(); painelLugares.redesenhar() },
    aoPorPonto: async (ponto) => {
      try {
        const { data, error } = await sbClient.functions.invoke('buscar-lugar', { body: { acao: 'ondeCaiu', lat: ponto.lat, lng: ponto.lng } })
        if (error || data?.error) throw new Error(data?.error || error?.message || 'sem resposta')
        const achado = enderecoDeOndeCaiu(data)
        ponto.nome = achado.nome; ponto.endereco = achado.endereco
      } catch (e) {
        painelLugares.dizer('Pus o ponto, mas não consegui o endereço dele: ' + String(e?.message || e).slice(0, 120), true)
      } finally {
        ponto.procurandoNome = false
        listasParaGeo(); painelLugares.redesenhar(); mapaLugares.desenhar()
      }
    },
  })
}
onMounted(() => { montarLugares() })
// Trocar de loja troca o público inteiro: o painel tem que ser remontado com a
// lista da loja nova, senão ele continuaria mexendo na lista da loja anterior.
watch(lojaAtiva, () => { montarLugares() })
```

**4.5** No template, trocar o bloco de chips de cidade + busca (linhas ~415–428, **sem tocar** no bloco de excluídas) por:

```html
      <div ref="caixaLugares"></div>
      <div ref="caixaMapaLugares"></div>
```

- [ ] **Step 5: Rodar tudo**

Run: `npm test 2>&1 | tail -20 && npm run build 2>&1 | tail -5`
Expected: PASS + build limpo. `todo-vue-compila.test.mjs` pega `.vue` quebrado — que `node --test` sozinho não pegaria.

- [ ] **Step 6: Abrir no navegador**

Fábrica de Anúncios → Subir para a Meta, com destino "nova campanha":
1. O painel aparece com as cidades da loja já dentro (Tivoli: Santa Bárbara d'Oeste + Americana).
2. Trocar de aba de loja mantém cada uma com os seus lugares.
3. Acrescentar um Local por nome e ver o ponto no mapa.
4. A 375px e a 1440px, tema escuro.

- [ ] **Step 7: Commit**

```bash
git add src/ferramentas/meta-ads/painel-subir.vue
git commit -m "Fabrica: o mesmo painel de lugares do editor de publico"
```

---

### Task 9: Os LEIA-ME e a prova ao vivo

**Files:**
- Modify: `src/compartilhado/LEIA-ME.txt`
- Modify: `src/ferramentas/gestao-trafego/LEIA-ME.txt`

- [ ] **Step 1: Escrever os LEIA-ME**

Em `src/compartilhado/LEIA-ME.txt`, acrescentar:

```
lugares-do-anuncio.js — o modelo de "um lugar" (Brasil, Estado, Cidade, Local) e
  a tradução para as quatro chaves que a Meta entende. Puro.
busca-de-lugar.js — monta a pergunta certa pra cada tipo (Meta ou mapa) e traduz
  as respostas. A Meta NÃO devolve coordenada e NÃO tem busca de estabelecimento
  (medido em 13/08/2026): é por isso que existem dois fornecedores.
painel-de-lugares.js — a linha de acrescentar + a lista. Imperativo e montado num
  elemento, para servir tanto o modal da Gestão de Tráfego (que vive fora da raiz
  do componente) quanto a Fábrica, que é Vue.
```

Em `src/ferramentas/gestao-trafego/LEIA-ME.txt`, atualizar a linha do mapa:

```
painel-do-mapa.js — desenha o mapa. Recebe `lugares` (não mais `pins`): quem tem
  `comoMirar:'ponto'` vira alfinete com círculo, quem tem 'area' vira marca
  quadrada SEM círculo — área não tem raio, e o círculo mentiria.
```

- [ ] **Step 2: A lista final do padrão** (`PADRAO-DA-CENTRAL.md`, item 10)

- [ ] `npm test` inteiro passando, com total MAIOR que o de antes
- [ ] `npm run build` sem erro
- [ ] Aberto no navegador **a 375px E a 1440px**
- [ ] Nenhum hex de cor novo
- [ ] Nenhum `style=` solto em botão
- [ ] Tema escuro conferido
- [ ] Nada do que existia antes se perdeu: cidade com raio, exclusão de cidade e região, e as localidades que o editor não gerencia continuam intactas

- [ ] **Step 3: Commit**

```bash
git add src/compartilhado/LEIA-ME.txt src/ferramentas/gestao-trafego/LEIA-ME.txt
git commit -m "LEIA-ME: os tres arquivos novos e o contrato novo do mapa"
```

- [ ] **Step 4: A prova ao vivo — COM O DONO, não sozinho**

Duas coisas não se provam com teste, e as duas envolvem a conta real. **Não aplique em conjunto que está rodando sem o dono junto.**

1. **Nome de ponto indo para a Meta.** `pinParaMeta` manda `name` e `address_string` quando o ponto tem nome — mas até hoje todo ponto criado pelo mapa nasceu SEM nome, então esse ramo nunca rodou contra a Meta de verdade. Aplicar uma vez, num conjunto PAUSADO, e ver a Meta aceitar.
2. **Conferir no Gerenciador** que estado e ponto ficaram onde deviam. O mapa de 12/08 está anotado até hoje como "não provado ao vivo" exatamente aqui.

Depois disso, atualizar a memória `project_iamundi_mapa_de_pins` tirando o "NÃO provado ao vivo" — ou, se algo falhar, escrevendo o que falhou.
