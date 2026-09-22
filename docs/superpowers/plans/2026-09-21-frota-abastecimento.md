# Abastecimento na Frota — Plano de implementação

> **Para quem executa:** use `superpowers:subagent-driven-development` ou
> `superpowers:executing-plans`. Os passos são caixinhas (`- [ ]`).

**Objetivo:** o motorista registra o abastecimento no celular (km, R$, litros,
como ficou o tanque), e esse dado passa a alimentar a quilometragem, o tanque
atual e o consumo do carro.

**Arquitetura:** tabela nova `frota_abastecimentos` no molde das irmãs; toda
regra em módulo puro testado (`abastecimentos.js`); a tela só chama a regra. As
costuras com o que já existe entram como argumento OPCIONAL, no mesmo molde do
`revisoes` opcional de `estadoDoVeiculo`, para não quebrar quem chama com menos.

**Stack:** Vue 3 (`<script setup>`), Supabase/Postgres com RLS, testes em
`node --test` (`*.test.mjs`), migrations em `db/migrations/acessos/` aplicadas
com `node coletor/run-acessos-sql.mjs <arquivo>`.

**Spec:** `docs/superpowers/specs/2026-09-21-frota-abastecimento-design.md` —
leia junto; este plano argumenta a partir dela.

## Restrições globais

- **Padrão obrigatório:** `PADRAO-DA-CENTRAL.md`. Cor só de token, nunca hex.
  Bloco novo usa os tokens de tamanho de letra (`--texto-titulo`, `--texto-corpo`,
  `--texto-etiqueta`), nunca número solto. Botão tem três tipos e só. Texto nunca
  corta (`overflow-wrap: anywhere`). Campo de formulário com fonte ≥ 16px.
- **Mede-se a 375px E a 1440px** num navegador de verdade, claro e escuro. Os
  quatro critérios: rolagem horizontal 0, alvo de toque ≥ 40px, fonte de campo
  ≥ 16px, nenhum texto cortado.
- **Níveis do tanque:** a escala que já existe, `NIVEIS_TANQUE` de
  `estado-do-veiculo.js` — `['Reserva','1/4','2/4','3/4','Cheio']`, índice 0..4.
  Não criar escala nova.
- **Dinheiro em centavos** (int), como no resto da central. Litros em
  `numeric(7,3)` — a bomba dá três casas.
- **Nada é publicado antes de o dono ver a foto.** Regra dele, 21/09/2026.
- **Rodar:** `npm test` · `npm run build` · `npm run dev -- --port 5209 --strictPort`
  (porta livre: há mais de uma janela neste repositório).

---

### Tarefa 1: A tabela no banco

**Arquivos:**
- Criar: `db/migrations/acessos/056_frota_abastecimentos.sql`

**Interfaces:**
- Produz: a tabela `frota_abastecimentos` com as colunas que as tarefas 2 a 6
  consomem: `id, veiculo_id, pessoa_id, pessoa_nome, abastecido_em, km, litros,
  total_centavos, tanque_depois, combustivel, posto, observacao, criado_em,
  criado_por`.

- [ ] **Passo 1: Escrever a migration**

```sql
-- 056 — ABASTECIMENTO (21/09/2026)
-- Desenho: docs/superpowers/specs/2026-09-21-frota-abastecimento-design.md
--
-- Primeira fonte de LITRO e DINHEIRO da Frota. Medido no dia: o tanque só era
-- perguntado na devolução, e 18 das 25 viagens voltaram sem resposta.
create table if not exists public.frota_abastecimentos (
  id uuid primary key default gen_random_uuid(),
  veiculo_id uuid not null references public.frota_veiculos(id) on delete cascade,
  -- SET NULL como nas irmãs: o registro do abastecimento não some quando a
  -- pessoa sai da empresa. `pessoa_nome` guarda quem era.
  pessoa_id uuid references public.acessos_pessoas(id) on delete set null,
  pessoa_nome text,
  abastecido_em timestamptz not null default now(),
  km integer not null,
  litros numeric(7,3) not null,
  total_centavos integer not null,
  -- A escala da casa: 0 = Reserva … 4 = Cheio. Ver NIVEIS_TANQUE.
  tanque_depois smallint not null,
  combustivel text not null,
  posto text,
  observacao text,
  criado_em timestamptz not null default now(),
  criado_por uuid,
  -- As travas moram AQUI, não só na tela: tela é lembrete, banco é portão.
  constraint frota_abast_km_positivo check (km > 0),
  constraint frota_abast_litros_positivo check (litros > 0),
  constraint frota_abast_total_positivo check (total_centavos > 0),
  constraint frota_abast_tanque_valido check (tanque_depois between 0 and 4)
);

-- Toda leitura desta tabela é "os abastecimentos deste carro, do mais novo
-- para o mais velho".
create index if not exists idx_frota_abast_veiculo
  on public.frota_abastecimentos (veiculo_id, abastecido_em desc);

alter table public.frota_abastecimentos enable row level security;

-- MESMO PORTÃO DAS IRMÃS, conferido contra frota_checklist e frota_manutencoes
-- antes de escrever: as duas liberam ler e escrever para is_frota_admin(), que
-- é "tem a permissão frota ou é superadmin". A restrição por carro é da TELA —
-- está escrito na spec (D38) para ninguém achar que há tranca aqui.
drop policy if exists frota_abast_ler on public.frota_abastecimentos;
create policy frota_abast_ler on public.frota_abastecimentos
  for select using (public.is_frota_admin());

drop policy if exists frota_abast_escrever on public.frota_abastecimentos;
create policy frota_abast_escrever on public.frota_abastecimentos
  for all using (public.is_frota_admin()) with check (public.is_frota_admin());
```

- [ ] **Passo 2: Provar as travas CONTRA O BANCO, dentro de transação desfeita**

Rodar pelo MCP do Supabase (projeto `kounqtdoioootxqegkij`). A migration entra
na própria transação do ensaio e o `rollback` no fim desfaz tudo:

```sql
begin;
-- (cole aqui o conteúdo da migration do Passo 1)
create temp table r(caso text, esperado text, resposta text);
do $$ begin
  insert into frota_abastecimentos (veiculo_id, km, litros, total_centavos, tanque_depois, combustivel)
  values ((select id from frota_veiculos limit 1), -5, 40, 25000, 4, 'FLEX');
  insert into r values ('km negativo','RECUSAR','passou (errado)');
exception when others then insert into r values ('km negativo','RECUSAR','recusou certo'); end $$;
do $$ begin
  insert into frota_abastecimentos (veiculo_id, km, litros, total_centavos, tanque_depois, combustivel)
  values ((select id from frota_veiculos limit 1), 1000, 0, 25000, 4, 'FLEX');
  insert into r values ('litros zero','RECUSAR','passou (errado)');
exception when others then insert into r values ('litros zero','RECUSAR','recusou certo'); end $$;
do $$ begin
  insert into frota_abastecimentos (veiculo_id, km, litros, total_centavos, tanque_depois, combustivel)
  values ((select id from frota_veiculos limit 1), 1000, 40, 25000, 9, 'FLEX');
  insert into r values ('tanque 9','RECUSAR','passou (errado)');
exception when others then insert into r values ('tanque 9','RECUSAR','recusou certo'); end $$;
do $$ begin
  insert into frota_abastecimentos (veiculo_id, km, litros, total_centavos, tanque_depois, combustivel)
  values ((select id from frota_veiculos limit 1), 36900, 41.3, 25000, 4, 'FLEX');
  insert into r values ('registro bom','PASSAR','passou');
exception when others then insert into r values ('registro bom','PASSAR','RECUSOU: '||sqlerrm); end $$;
select * from r;
rollback;
```

Esperado: as três primeiras `recusou certo`, a quarta `passou`.
⚠️ Se a quarta recusar, **pare**: a trava está apertada demais e barraria
registro legítimo.

- [ ] **Passo 3: Aplicar de verdade**

```bash
node coletor/run-acessos-sql.mjs db/migrations/acessos/056_frota_abastecimentos.sql
```

- [ ] **Passo 4: Conferir que está no ar**

```sql
select count(*) as colunas from information_schema.columns
 where table_schema='public' and table_name='frota_abastecimentos';
select count(*) as politicas from pg_policies
 where schemaname='public' and tablename='frota_abastecimentos';
```
Esperado: 14 colunas e 2 políticas.

- [ ] **Passo 5: Commit**

```bash
git add db/migrations/acessos/056_frota_abastecimentos.sql
git commit -m "feat(frota): a tabela de abastecimentos, com as travas no banco"
```

---

### Tarefa 2: A regra do registro — preço por litro e o que barra

**Arquivos:**
- Criar: `src/ferramentas/frota/abastecimentos.js`
- Criar: `src/ferramentas/frota/abastecimentos.test.mjs`

**Interfaces:**
- Produz: `precoPorLitro(totalCentavos, litros) -> number|null` (em reais) e
  `problemasDoAbastecimento({ km, kmConhecido, litros, totalCentavos,
  tanqueDepois, abastecidoEm, agoraIso, tanqueDoCarro }) -> { barra: string[],
  avisa: string[] }`. As tarefas 3 a 6 consomem as duas.

- [ ] **Passo 1: Escrever os testes que falham**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { precoPorLitro, problemasDoAbastecimento } from './abastecimentos.js'

const bom = {
  km: 36900, kmConhecido: 36896, litros: 41.3, totalCentavos: 25000,
  tanqueDepois: 4, abastecidoEm: '2026-09-21T12:00:00Z', agoraIso: '2026-09-21T15:00:00Z',
}

test('o preço por litro é o que a pessoa confere no cupom', () => {
  assert.equal(precoPorLitro(25000, 41.3).toFixed(2), '6.05')
  assert.equal(precoPorLitro(25000, 0), null, 'sem litros não há preço — e não é zero')
  assert.equal(precoPorLitro(null, 41.3), null)
})

test('registro completo e coerente não barra nem avisa', () => {
  const r = problemasDoAbastecimento(bom)
  assert.deepEqual(r.barra, [])
  assert.deepEqual(r.avisa, [])
})

test('km menor que o já conhecido BARRA — o odômetro só anda pra frente', () => {
  const r = problemasDoAbastecimento({ ...bom, km: 30000 })
  assert.equal(r.barra.length, 1)
  assert.match(r.barra[0], /36\.896/, 'mostrar os dois números é o que faz achar o erro')
})

test('os quatro campos que fazem o registro valer BARRAM quando faltam', () => {
  for (const campo of ['km', 'litros', 'totalCentavos', 'tanqueDepois']) {
    const r = problemasDoAbastecimento({ ...bom, [campo]: null })
    assert.ok(r.barra.length >= 1, `${campo} vazio devia barrar`)
  }
})

test('data no futuro BARRA — abastecimento é coisa que já aconteceu', () => {
  const r = problemasDoAbastecimento({ ...bom, abastecidoEm: '2026-09-22T12:00:00Z' })
  assert.equal(r.barra.length, 1)
  assert.match(r.barra[0], /futuro/i)
})

test('litros acima do tanque do carro AVISA e deixa salvar', () => {
  const r = problemasDoAbastecimento({ ...bom, litros: 90, tanqueDoCarro: 50 })
  assert.deepEqual(r.barra, [], 'aviso não barra')
  assert.equal(r.avisa.length, 1)
})

test('preço por litro fora do pé AVISA — pega o dedo errado, não a variação', () => {
  assert.equal(problemasDoAbastecimento({ ...bom, totalCentavos: 650000 }).avisa.length, 1)
  assert.deepEqual(problemasDoAbastecimento({ ...bom, totalCentavos: 26500 }).avisa, [],
    'R$ 6,42 o litro é normal e não pode virar aviso')
})

test('sem km conhecido ainda dá para registrar — carro novo na frota', () => {
  const r = problemasDoAbastecimento({ ...bom, kmConhecido: null })
  assert.deepEqual(r.barra, [])
})
```

- [ ] **Passo 2: Rodar e ver falhar**

```bash
node --test src/ferramentas/frota/abastecimentos.test.mjs
```
Esperado: FALHA com "Cannot find module './abastecimentos.js'".

- [ ] **Passo 3: Escrever o módulo**

```js
/* O ABASTECIMENTO — a regra, longe da tela.
 *
 * Desenho: docs/superpowers/specs/2026-09-21-frota-abastecimento-design.md
 * D39: número que não fecha AVISA; só o dedo errado barra. Um sistema que
 * recusa o registro do que aconteceu de verdade ensina a não registrar. */

/** O número que a pessoa confere contra o cupom, em reais. Nulo quando não dá
 *  para calcular — nunca zero, que seria um preço. */
export function precoPorLitro(totalCentavos, litros) {
  const t = Number(totalCentavos);
  const l = Number(litros);
  if (!Number.isFinite(t) || !Number.isFinite(l) || t <= 0 || l <= 0) return null;
  return t / 100 / l;
}

const PRECO_MIN = 1;    // R$/litro. Frouxo de propósito: pega o dedo errado,
const PRECO_MAX = 15;   // não a variação de posto pra posto.

export function problemasDoAbastecimento({
  km, kmConhecido, litros, totalCentavos, tanqueDepois,
  abastecidoEm, agoraIso, tanqueDoCarro,
} = {}) {
  const barra = [];
  const avisa = [];
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

  const kmN = n(km);
  if (kmN === null || kmN <= 0) barra.push('Informe o KM que está no painel.');
  else if (n(kmConhecido) !== null && kmN < n(kmConhecido)) {
    barra.push(`O KM informado (${kmN.toLocaleString('pt-BR')}) é menor que o último `
      + `conhecido deste carro (${n(kmConhecido).toLocaleString('pt-BR')}). Confira o painel.`);
  }

  const litrosN = n(litros);
  if (litrosN === null || litrosN <= 0) barra.push('Informe quantos litros você colocou.');

  const totalN = n(totalCentavos);
  if (totalN === null || totalN <= 0) barra.push('Informe quanto você pagou.');

  const tanqueN = n(tanqueDepois);
  if (tanqueN === null || tanqueN < 0 || tanqueN > 4) {
    barra.push('Diga como ficou o tanque depois de abastecer.');
  }

  const quando = Date.parse(abastecidoEm);
  const agora = Date.parse(agoraIso || new Date().toISOString());
  if (Number.isFinite(quando) && Number.isFinite(agora) && quando > agora) {
    barra.push('A data do abastecimento está no futuro.');
  }

  // Avisos só fazem sentido quando os números existem.
  if (litrosN !== null && n(tanqueDoCarro) !== null && litrosN > n(tanqueDoCarro)) {
    avisa.push(`São ${litrosN.toLocaleString('pt-BR')} litros num tanque de `
      + `${n(tanqueDoCarro).toLocaleString('pt-BR')}. Confirme antes de gravar.`);
  }
  const preco = precoPorLitro(totalN, litrosN);
  if (preco !== null && (preco < PRECO_MIN || preco > PRECO_MAX)) {
    avisa.push(`Isso dá R$ ${preco.toFixed(2).replace('.', ',')} o litro. Confirme os dois números.`);
  }

  return { barra, avisa };
}
```

- [ ] **Passo 4: Rodar e ver passar**

```bash
node --test src/ferramentas/frota/abastecimentos.test.mjs
```
Esperado: 8 testes passando.

- [ ] **Passo 5: Commit**

```bash
git add src/ferramentas/frota/abastecimentos.js src/ferramentas/frota/abastecimentos.test.mjs
git commit -m "feat(frota): a regra do abastecimento — preço por litro e o que barra"
```

---

### Tarefa 3: O consumo, de um tanque cheio ao próximo

**Arquivos:**
- Modificar: `src/ferramentas/frota/abastecimentos.js`
- Modificar: `src/ferramentas/frota/abastecimentos.test.mjs`

**Interfaces:**
- Consome: o módulo da Tarefa 2.
- Produz: `trechosDeConsumo(abastecimentos) -> [{ de, ate, km, litros, kmPorLitro,
  combustivel }]` e `consumoDoVeiculo(abastecimentos) -> { kmPorLitro, media,
  trechos } | null`. A Tarefa 5 usa `consumoDoVeiculo` no estado do botão; a
  Tarefa 6 usa as duas na tela.

- [ ] **Passo 1: Escrever os testes que falham**

```js
import { trechosDeConsumo, consumoDoVeiculo } from './abastecimentos.js'

const ab = (km, litros, tanque, extra = {}) => ({
  id: `a-${km}`, veiculo_id: 'v1', km, litros, tanque_depois: tanque,
  total_centavos: Math.round(litros * 605), combustivel: 'GASOLINA',
  abastecido_em: `2026-09-${String(extra.dia || 1).padStart(2, '0')}T12:00:00Z`, ...extra,
})

test('D36 · o trecho vai de um CHEIO ao próximo CHEIO', () => {
  // 36.000 cheio → 36.400 cheio, com 40 litros no meio: 10 km/l.
  const t = trechosDeConsumo([ab(36000, 30, 4, { dia: 1 }), ab(36400, 40, 4, { dia: 10 })])
  assert.equal(t.length, 1)
  assert.equal(t[0].km, 400)
  assert.equal(t[0].litros, 40, 'os litros do PRIMEIRO cheio encheram o tanque que veio ANTES')
  assert.equal(t[0].kmPorLitro, 10)
})

test('D36 · o parcial do meio ENTRA na conta do trecho', () => {
  // cheio 36.000 → parcial 20 L → cheio 36.600 com 40 L = 60 L para 600 km.
  const t = trechosDeConsumo([
    ab(36000, 30, 4, { dia: 1 }), ab(36300, 20, 2, { dia: 5 }), ab(36600, 40, 4, { dia: 10 }),
  ])
  assert.equal(t.length, 1)
  assert.equal(t[0].litros, 60)
  assert.equal(t[0].kmPorLitro, 10)
})

test('D36 · com um cheio só, não há consumo — e a resposta é NULA, não zero', () => {
  assert.deepEqual(trechosDeConsumo([ab(36000, 30, 4)]), [])
  assert.equal(consumoDoVeiculo([ab(36000, 30, 4)]), null)
})

test('D37 · trecho com combustível diferente nas pontas não vira consumo', () => {
  // Etanol rende menos que gasolina: misturar os dois inventaria uma piora.
  const t = trechosDeConsumo([
    ab(36000, 30, 4, { dia: 1, combustivel: 'GASOLINA' }),
    ab(36400, 40, 4, { dia: 10, combustivel: 'ETANOL' }),
  ])
  assert.deepEqual(t, [])
})

test('o consumo do veículo devolve o trecho mais novo e a média', () => {
  const c = consumoDoVeiculo([
    ab(36000, 30, 4, { dia: 1 }), ab(36400, 40, 4, { dia: 10 }), ab(36900, 50, 4, { dia: 20 }),
  ])
  assert.equal(c.trechos.length, 2)
  assert.equal(c.kmPorLitro, 10, 'o mais novo: 500 km / 50 L')
  assert.equal(c.media, 10)
})

test('lista fora de ordem não quebra a conta', () => {
  const t = trechosDeConsumo([ab(36400, 40, 4, { dia: 10 }), ab(36000, 30, 4, { dia: 1 })])
  assert.equal(t.length, 1)
  assert.equal(t[0].kmPorLitro, 10)
})

test('nada quebra com entrada vazia', () => {
  assert.deepEqual(trechosDeConsumo([]), [])
  assert.deepEqual(trechosDeConsumo(null), [])
  assert.equal(consumoDoVeiculo(null), null)
})
```

- [ ] **Passo 2: Rodar e ver falhar**

```bash
node --test src/ferramentas/frota/abastecimentos.test.mjs
```
Esperado: FALHA com "trechosDeConsumo is not a function".

- [ ] **Passo 3: Implementar**

```js
const CHEIO = 4;

/** Os trechos fechados: de um tanque CHEIO ao próximo tanque CHEIO.
 *
 * D36. O parcial do meio ENTRA nos litros do trecho — ele foi queimado ali. O
 * que ele não faz é FECHAR um trecho sozinho, porque ninguém sabe quanto havia
 * no tanque antes nem depois dele.
 *
 * Os litros do PRIMEIRO cheio não entram: eles encheram o tanque que rodou
 * ANTES deste trecho. É o erro clássico dessa conta, e ele infla o consumo. */
export function trechosDeConsumo(abastecimentos) {
  const lista = (abastecimentos || [])
    .filter((a) => a && Number.isFinite(Number(a.km)) && Number.isFinite(Number(a.litros)))
    .slice()
    .sort((a, b) => Number(a.km) - Number(b.km));

  const trechos = [];
  let inicio = null;
  let litros = 0;
  for (const a of lista) {
    if (inicio === null) {
      if (Number(a.tanque_depois) === CHEIO) { inicio = a; litros = 0; }
      continue;
    }
    litros += Number(a.litros);
    if (Number(a.tanque_depois) !== CHEIO) continue;
    const km = Number(a.km) - Number(inicio.km);
    // Combustível diferente nas pontas não vira consumo (D37): etanol rende
    // menos que gasolina, e misturar os dois inventaria uma piora.
    if (km > 0 && litros > 0 && a.combustivel === inicio.combustivel) {
      trechos.push({
        de: inicio.id, ate: a.id, km, litros,
        kmPorLitro: km / litros, combustivel: a.combustivel,
      });
    }
    inicio = a;
    litros = 0;
  }
  return trechos;
}

/** O consumo do carro: o trecho mais novo e a média de todos. Nulo enquanto não
 *  houver dois cheios — a tela diz "ainda não dá para calcular", nunca um zero. */
export function consumoDoVeiculo(abastecimentos) {
  const trechos = trechosDeConsumo(abastecimentos);
  if (!trechos.length) return null;
  const soma = trechos.reduce((t, x) => t + x.kmPorLitro, 0);
  return {
    kmPorLitro: trechos[trechos.length - 1].kmPorLitro,
    media: soma / trechos.length,
    trechos,
  };
}
```

- [ ] **Passo 4: Rodar e ver passar**

```bash
node --test src/ferramentas/frota/abastecimentos.test.mjs
```
Esperado: 15 testes passando.

- [ ] **Passo 5: Commit**

```bash
git add src/ferramentas/frota/abastecimentos.js src/ferramentas/frota/abastecimentos.test.mjs
git commit -m "feat(frota): consumo de um tanque cheio ao próximo, por combustível"
```

---

### Tarefa 4: As costuras — quinta fonte de km e tanque atual

**Arquivos:**
- Modificar: `src/ferramentas/frota/abastecimentos.js`
- Modificar: `src/ferramentas/frota/estado-do-veiculo.js`
- Modificar: `src/ferramentas/frota/abastecimentos.test.mjs`
- Modificar: `src/ferramentas/frota/estado-do-veiculo.test.mjs`

**Interfaces:**
- Consome: `trechosDeConsumo` da Tarefa 3.
- Produz: `ultimoKmDeAbastecimento(abastecimentos, veiculoId) -> number|null` e
  `estadoDoVeiculo(veiculo, usos, fichas, revisoes, abastecimentos)` — o quinto
  argumento é OPCIONAL, como o quarto já é.

- [ ] **Passo 1: Escrever os testes que falham**

Em `abastecimentos.test.mjs`:

```js
import { ultimoKmDeAbastecimento } from './abastecimentos.js'

test('o maior km de abastecimento do carro, no molde de ultimoKmDeRevisao', () => {
  const lista = [
    { veiculo_id: 'v1', km: 36000 }, { veiculo_id: 'v1', km: 36900 },
    { veiculo_id: 'v2', km: 99999 }, { veiculo_id: 'v1', km: null },
  ]
  assert.equal(ultimoKmDeAbastecimento(lista, 'v1'), 36900, 'pelo MAIOR: odômetro só anda pra frente')
  assert.equal(ultimoKmDeAbastecimento(lista, 'v3'), null)
  assert.equal(ultimoKmDeAbastecimento(null, 'v1'), null)
})
```

Em `estado-do-veiculo.test.mjs`:

```js
test('D40 · o abastecimento é a QUINTA fonte de quilometragem', () => {
  // O ganho de graça: quem abastece toda semana alimenta o alerta de revisão
  // sem digitar nada em lugar nenhum.
  const v = { id: 'v1', situacao: 'ativo' }
  const usos = [{ veiculo_id: 'v1', saida_em: '2026-08-01', volta_em: '2026-08-02', km_volta: 36000 }]
  const abast = [{ veiculo_id: 'v1', km: 36900, litros: 40, tanque_depois: 4 }]
  assert.equal(estadoDoVeiculo(v, usos, [], [], abast).km, 36900)
})

test('D40 · entre as cinco fontes vale o MAIOR, não a mais nova', () => {
  const v = { id: 'v1', situacao: 'ativo' }
  const usos = [{ veiculo_id: 'v1', saida_em: '2026-09-01', volta_em: '2026-09-02', km_volta: 37500 }]
  const abast = [{ veiculo_id: 'v1', km: 36900, litros: 40, tanque_depois: 4 }]
  assert.equal(estadoDoVeiculo(v, usos, [], [], abast).km, 37500)
})

test('D40 · chamar sem os abastecimentos continua funcionando', () => {
  // Mesmo molde do `revisoes` opcional: a Edge não tem essa lista à mão.
  const v = { id: 'v1', situacao: 'ativo' }
  assert.equal(estadoDoVeiculo(v, [], []).km, null)
})
```

- [ ] **Passo 2: Rodar e ver falhar**

```bash
node --test src/ferramentas/frota/abastecimentos.test.mjs src/ferramentas/frota/estado-do-veiculo.test.mjs
```
Esperado: FALHA — `ultimoKmDeAbastecimento is not a function` e o km voltando 36000.

- [ ] **Passo 3: Implementar**

Em `abastecimentos.js`:

```js
/** O maior km já registrado num abastecimento deste carro. A QUINTA fonte de
 *  quilometragem (D40). Pelo MAIOR e não pela data, mesma razão das outras
 *  quatro: data digitada errada acontece, odômetro só anda pra frente. */
export function ultimoKmDeAbastecimento(abastecimentos, veiculoId) {
  const meus = (abastecimentos || [])
    .filter((a) => a && a.veiculo_id === veiculoId && Number.isFinite(Number(a.km)))
    .map((a) => Number(a.km));
  return meus.length ? Math.max(...meus) : null;
}
```

Em `estado-do-veiculo.js`, no topo:

```js
import { ultimoKmDeAbastecimento } from './abastecimentos.js';
```

e na assinatura e no cálculo do km:

```js
export function estadoDoVeiculo(veiculo, usos, fichas, revisoes, abastecimentos) {
```

```js
  const kms = [
    fechado && fechado.km_volta,
    aberto && aberto.km_saida,
    ultimoHodometro(fichas, veiculo.id),
    ultimoKmDeRevisao(revisoes, veiculo.id),
    // A QUINTA (21/09/2026): quem abastece toda semana passa a alimentar o
    // alerta de revisão sem digitar nada. `abastecimentos` é OPCIONAL pelo
    // mesmo motivo que `revisoes` é — a Edge não tem a lista à mão.
    ultimoKmDeAbastecimento(abastecimentos, veiculo.id),
  ].filter(Number.isInteger);
```

⚠️ `ultimoKmDeAbastecimento` devolve `Number`, e o filtro é `Number.isInteger`:
se algum km vier com casa decimal ele seria descartado em silêncio. A coluna é
`integer` no banco (Tarefa 1), então isso não acontece — mas o teste do Passo 1
prende o comportamento.

- [ ] **Passo 4: Rodar e ver passar**

```bash
npm test
```
Esperado: a suíte inteira passa, e o total SOBE em relação à rodada anterior.
⚠️ Se o total cair, pare: algum arquivo de teste deixou de ser encontrado.

- [ ] **Passo 5: Commit**

```bash
git add src/ferramentas/frota/abastecimentos.js src/ferramentas/frota/abastecimentos.test.mjs \
        src/ferramentas/frota/estado-do-veiculo.js src/ferramentas/frota/estado-do-veiculo.test.mjs
git commit -m "feat(frota): o abastecimento vira a quinta fonte de quilometragem"
```

---

### Tarefa 5: O botão do motorista

**Arquivos:**
- Modificar: `src/ferramentas/frota/botoes-rapidos.js`
- Modificar: `src/ferramentas/frota/botoes-rapidos.test.mjs`

**Interfaces:**
- Consome: `consumoDoVeiculo` da Tarefa 3.
- Produz: um terceiro botão em `botoesDoMotorista`, com `chave: 'abasteci'` e
  `acao: 'abasteci'`. A Tarefa 6 liga essa ação ao formulário.

- [ ] **Passo 1: Escrever os testes que falham**

```js
test('o motorista ganha o botão de abastecimento', () => {
  const b = botoesDoMotorista({ painel: { livres: [] }, nomeDoMeuCarro: 'RENAULT KWID' })
  const abast = b.find((x) => x.chave === 'abasteci')
  assert.ok(abast, 'o botão tem de existir')
  assert.equal(abast.rotulo, 'Abasteci o carro')
})

test('D38c · quem não tem carro na mão TAMBÉM vê o botão, e o estado diz por quê', () => {
  // Esconder faria quem abasteceu carro emprestado procurar onde registrar e
  // desistir — e é esse registro que ninguém lança depois.
  const b = botoesDoMotorista({ painel: { livres: [] } })
  const abast = b.find((x) => x.chave === 'abasteci')
  assert.ok(abast)
  assert.match(abast.estado, /não tem carro/i)
})

test('o estado do botão mostra o consumo quando ele existe', () => {
  const b = botoesDoMotorista({
    painel: { livres: [] }, nomeDoMeuCarro: 'RENAULT KWID',
    consumoDoMeuCarro: { kmPorLitro: 11.234, media: 11, trechos: [{}, {}] },
  })
  const abast = b.find((x) => x.chave === 'abasteci')
  assert.match(abast.estado, /11,2 km\/l/)
})

test('sem consumo ainda, o botão NÃO inventa número', () => {
  const b = botoesDoMotorista({
    painel: { livres: [] }, nomeDoMeuCarro: 'RENAULT KWID', consumoDoMeuCarro: null,
  })
  const abast = b.find((x) => x.chave === 'abasteci')
  assert.doesNotMatch(abast.estado || '', /km\/l/)
})
```

- [ ] **Passo 2: Rodar e ver falhar**

```bash
node --test src/ferramentas/frota/botoes-rapidos.test.mjs
```
Esperado: FALHA — o botão não existe.

- [ ] **Passo 3: Implementar**

Na assinatura de `botoesDoMotorista`, acrescentar `consumoDoMeuCarro`:

```js
export function botoesDoMotorista({ painel, checklistDeHoje, nomeDoMeuCarro, consumoDoMeuCarro } = {}) {
```

e, antes do `return`, montar o estado; depois acrescentar o botão ao array:

```js
  /* O ESTADO DO ABASTECIMENTO. Sem carro na mão o botão FICA (D38c) e diz por
   * quê — ele abre com o seletor de carro. Sem consumo calculado, não escreve
   * número nenhum: a regra desta tela é que `estado` nulo não vira linha. */
  let estadoAbastecimento = null
  if (!carro) estadoAbastecimento = 'você não tem carro na mão'
  else if (consumoDoMeuCarro && Number.isFinite(consumoDoMeuCarro.kmPorLitro)) {
    estadoAbastecimento = `${carro} · ${consumoDoMeuCarro.kmPorLitro.toFixed(1).replace('.', ',')} km/l`
  } else estadoAbastecimento = carro
```

```js
    {
      chave: 'abasteci',
      rotulo: 'Abasteci o carro',
      estado: estadoAbastecimento,
      acao: 'abasteci',
    },
```

- [ ] **Passo 4: Rodar e ver passar**

```bash
node --test src/ferramentas/frota/botoes-rapidos.test.mjs
```
Esperado: todos passando.

- [ ] **Passo 5: Commit**

```bash
git add src/ferramentas/frota/botoes-rapidos.js src/ferramentas/frota/botoes-rapidos.test.mjs
git commit -m "feat(frota): o botão Abasteci o carro na aba Motorista"
```

---

### Tarefa 6: A tela e a prova de foto

**Arquivos:**
- Modificar: `src/ferramentas/frota/tela-de-frota.vue`

**Interfaces:**
- Consome: tudo das Tarefas 2 a 5.

- [ ] **Passo 1: Carregar os abastecimentos junto do resto**

Na função que carrega a Frota, acrescentar a leitura no mesmo molde das irmãs
(`frota_revisoes`, `frota_manutencoes`), guardando em `const abastecimentos = ref([])`,
e passar a lista para `estadoDoVeiculo(...)` como quinto argumento em TODAS as
chamadas — procure por `estadoDoVeiculo(` no arquivo e conserte cada uma.

- [ ] **Passo 2: Ligar o botão à ficha**

`botoesDoMotorista` passa a receber `consumoDoMeuCarro: consumoDoVeiculo(
abastecimentos.value.filter((a) => a.veiculo_id === idDoMeuCarro))`, e a ação
`'abasteci'` abre a ficha nova.

- [ ] **Passo 3: O formulário**

Campos, nesta ordem: **quilometragem** (numérico), **quanto pagou** (em reais,
convertido para centavos na gravação), **quantos litros**, **como ficou o
tanque** (cinco botões grandes com os rótulos de `NIVEIS_TANQUE`), **combustível**
(já preenchido com `veiculo.combustivel`) e **posto** (opcional).

Abaixo dos dois primeiros, a linha viva: `R$ {{ precoPorLitro(...) }} o litro`,
só quando os dois existirem.

O aviso de duplicata (D38b) no topo, quando houver abastecimento do mesmo carro
nas últimas 12 horas.

Erros de `problemasDoAbastecimento().barra` travam o botão de gravar; os de
`.avisa` aparecem em amarelo e deixam gravar.

**Padrão obrigatório:** classes `.btn`/`.btn-principal`, tokens de cor e de
tamanho de letra, campos com fonte ≥ 16px, nada de hex.

- [ ] **Passo 4: Gravar**

```js
const { error } = await sbClient.from('frota_abastecimentos').insert({
  veiculo_id: veiculoId, pessoa_id: euId.value, pessoa_nome: nomeDaPessoa(euId.value),
  abastecido_em: quando, km, litros, total_centavos: centavos,
  tanque_depois: tanque, combustivel, posto: posto || null, criado_por: estado.userId,
})
```

Falha ao gravar mostra a mensagem do banco, **nunca** uma lista vazia silenciosa.

- [ ] **Passo 5: `npm test` e `npm run build`**

Esperado: suíte inteira passando e build sem erro.

- [ ] **Passo 6: A prova de tela**

Rodar `npm run dev -- --port 5209 --strictPort` e o laboratório de fotos (o
molde está em `/tmp/claude-501/.../provar-frota.mjs` desta sessão; a receita é
interceptar `/supabase\.co\//` por REGEX e responder com dados de exemplo — nada
sai para produção). Fotografar, a **375px e 1440px, claro e escuro**:

1. o botão novo na aba Motorista, com o estado embaixo;
2. o formulário com "R$ 6,05 o litro" aparecendo;
3. o aviso de duplicata;
4. a mensagem de quando ainda não dá para calcular o consumo.

Medir os quatro critérios do padrão e conferir que as escritas bloqueadas são
zero.

- [ ] **Passo 7: Mostrar as fotos ao dono e ESPERAR o "pode"**

⚠️ **Não publicar antes disso.** Regra dele, 21/09/2026.

- [ ] **Passo 8: Commit**

```bash
git add src/ferramentas/frota/tela-de-frota.vue
git commit -m "feat(frota): a tela do abastecimento na aba Motorista"
```
