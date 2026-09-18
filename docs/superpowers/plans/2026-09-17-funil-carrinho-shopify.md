# Funil de Carrinho (Shopify) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rastrear o funil de carrinho da loja Shopify ponta a ponta antes do
checkout — produto adicionado, produto removido, checkout iniciado — e expor
isso numa ferramenta nova da Central (ranking de mais adicionados/removidos +
lista de carrinhos abandonados).

**Architecture:** Web Pixel Extension (código no repo, deploy via Shopify
CLI) manda cada evento por `fetch()` pra uma Edge Function nova e pública
(`capturar-evento-carrinho`), que valida e grava cru numa tabela só
(`carrinho_eventos`). Sem robô, sem fila: "abandonado" é uma view SQL
calculada na consulta. A tela nova lê a tabela e a view direto via `sbClient`.

**Tech Stack:** Vue 3 (`<script setup>`), Supabase (Postgres + Edge Functions
em Deno), Shopify CLI + Web Pixels API, Node `node:test` para os testes.

**Spec:** `docs/superpowers/specs/2026-09-17-funil-carrinho-shopify-design.md`

## Global Constraints

- **Uma loja Shopify só** — nada de `account_id`/multi-loja neste desenho (spec §2).
- **Três tipos de evento, e só esses:** `produto_adicionado`, `produto_removido`,
  `checkout_iniciado`. Sem `carrinho_visualizado` (Shopify não garante o evento — spec §2).
- **Sem valor em R$ parado no carrinho** e **sem robô de agregação** neste MVP (spec §2, §9).
- **`verify_jwt` desligado** na Edge Function `capturar-evento-carrinho`
  (`--no-verify-jwt` no deploy) — ela é chamada por visitante anônimo, sem
  sessão Supabase nenhuma (spec §5).
- **CORS da Edge Function restrito ao domínio da loja**, nunca `*` (spec §5).
- **Rate limit: 60 eventos por minuto, por IP — nunca por `cart_token`**
  (pedido explícito do dono, spec §2/§5).
- **Toda view nova sobre tabela com RLS precisa de `security_invoker = true`**
  — sem isso ela roda com a permissão do dono e ignora o RLS de baixo (ver
  `db/migrations/2026-07-31-saude-dos-robos.sql`).
- **PADRÃO-DA-CENTRAL.md vale para a tela nova:** cor só de token (nunca hex),
  botão só das 3 classes (`.btn`, `.btn.btn-principal`, `.btn.btn-perigo`),
  texto nunca corta (`overflow-wrap:anywhere`, nunca `ellipsis`), tamanho de
  fonte só da escala (`--texto-etiqueta/corpo/campo/titulo/numero`), e a
  entrega se mede a 375px num navegador de verdade antes de dar como pronta.

---

### Task 1: Migração do banco — `carrinho_eventos` + view `carrinho_abandonados`

**Files:**
- Create: `db/migrations/2026-09-17-carrinho-eventos.sql`
- Test: `db/carrinho-eventos.test.mjs`

**Interfaces:**
- Consumes: nada (primeira peça do sistema).
- Produces: tabela `public.carrinho_eventos` (colunas: `id`, `cart_token`,
  `tipo`, `produto_id`, `produto_titulo`, `variante_id`, `quantidade`,
  `preco`, `ip`, `criado_em`) e view `public.carrinho_abandonados`
  (`cart_token`, `iniciado_em`, `ultimo_evento`) — usados pela Edge Function
  (Task 3, insert) e pela tela (Task 6, select).

- [ ] **Step 1: Escrever o teste (vai falhar — o arquivo de migration ainda não existe)**

```js
// db/carrinho-eventos.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SQL = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)),
       'migrations/2026-09-17-carrinho-eventos.sql'), 'utf8')

test('os três tipos de evento do MVP, e só eles', () => {
  assert.match(SQL, /check \(tipo in \(\s*'produto_adicionado', 'produto_removido', 'checkout_iniciado'/)
})

test('⚠️ carrinho_visualizado NÃO entra — cortado no desenho (Shopify não garante o evento)', () => {
  assert.ok(!SQL.includes('carrinho_visualizado'))
})

test('guarda o IP, para o rate limit da edge function', () => {
  assert.match(SQL, /\bip\s+text\b/)
})

test('RLS ligado e sem policy de insert (só a chave de serviço grava)', () => {
  assert.match(SQL, /enable row level security/)
  assert.ok(!/for insert/i.test(SQL), 'não deveria existir policy de insert nesta migration')
})

test('⚠️ view de abandono roda com o invoker, não com o dono (senão passa por cima do RLS)', () => {
  assert.match(SQL, /alter view public\.carrinho_abandonados set \(security_invoker = true\)/)
})

test('abandono = teve produto_adicionado, nunca teve checkout_iniciado, parado há mais de 30 min', () => {
  const view = SQL.slice(SQL.indexOf('create or replace view public.carrinho_abandonados'))
  assert.match(view, /where tipo = 'produto_adicionado'/)
  assert.match(view, /e2\.tipo = 'checkout_iniciado'/)
  assert.match(view, /interval '30 minutes'/)
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `node --test db/carrinho-eventos.test.mjs`
Expected: FAIL — `ENOENT` (o arquivo `.sql` ainda não existe).

- [ ] **Step 3: Escrever a migration**

```sql
-- db/migrations/2026-09-17-carrinho-eventos.sql
--
-- Rastreamento de carrinho da loja Shopify (Funil de Carrinho): cada evento
-- (produto adicionado/removido, checkout iniciado) chega cru pela Edge
-- Function `capturar-evento-carrinho`, mandado pelo Web Pixel Extension da
-- loja. "Abandonado" é calculado na consulta (view carrinho_abandonados),
-- sem robô de agregação — ver spec
-- docs/superpowers/specs/2026-09-17-funil-carrinho-shopify-design.md.
create table if not exists public.carrinho_eventos (
  id             bigint generated always as identity primary key,
  cart_token     text not null,
  tipo           text not null check (tipo in (
                   'produto_adicionado', 'produto_removido', 'checkout_iniciado'
                 )),
  produto_id     text,
  produto_titulo text,
  variante_id    text,
  quantidade     int,
  preco          numeric,
  ip             text,
  criado_em      timestamptz not null default now()
);

create index if not exists carrinho_eventos_cart_token_criado_em_idx
  on public.carrinho_eventos (cart_token, criado_em);
create index if not exists carrinho_eventos_tipo_criado_em_idx
  on public.carrinho_eventos (tipo, criado_em);
create index if not exists carrinho_eventos_ip_criado_em_idx
  on public.carrinho_eventos (ip, criado_em);

comment on table public.carrinho_eventos is
  'Eventos crus de carrinho da loja Shopify, gravados só pela Edge Function capturar-evento-carrinho (chave de serviço). Leitura liberada a quem tem a permissão "carrinho".';

alter table public.carrinho_eventos enable row level security;

-- Sem policy de insert de propósito: só a chave de serviço grava (ela ignora
-- RLS). Nem o próprio pixel tem policy de escrita — ele nunca fala direto com
-- o banco, só com a Edge Function.
drop policy if exists carrinho_eventos_leitura on public.carrinho_eventos;
create policy carrinho_eventos_leitura
  on public.carrinho_eventos for select
  to authenticated
  using (exists (
    select 1 from public.profiles p where p.id = auth.uid()
      and (p.role = 'admin' or p.is_superadmin or 'carrinho' = any (p.features))
  ));

create or replace view public.carrinho_abandonados as
select cart_token,
       min(criado_em) as iniciado_em,
       max(criado_em) as ultimo_evento
from public.carrinho_eventos
where tipo = 'produto_adicionado'
group by cart_token
having not exists (
  select 1 from public.carrinho_eventos e2
  where e2.cart_token = carrinho_eventos.cart_token
    and e2.tipo = 'checkout_iniciado'
)
and max(criado_em) < now() - interval '30 minutes';

comment on view public.carrinho_abandonados is
  'Carrinhos com produto adicionado, sem checkout iniciado, parados há mais de 30 minutos (fixo, não é medido — ajustável se o dono achar cedo/tarde demais).';

-- OBRIGATÓRIO: sem isto a view roda com a permissão do DONO (postgres) e passa
-- por cima do RLS de carrinho_eventos — toda view nova sobre tabela com RLS
-- neste projeto precisa desta linha (ver db/migrations/2026-07-31-saude-dos-robos.sql).
alter view public.carrinho_abandonados set (security_invoker = true);
```

- [ ] **Step 4: Rodar o teste de novo e confirmar que passa**

Run: `node --test db/carrinho-eventos.test.mjs`
Expected: PASS (6 testes).

- [ ] **Step 5: Aplicar a migration no banco de verdade**

Run: `cd coletor && node run-migrations.mjs`
Expected: log mostrando `2026-09-17-carrinho-eventos.sql` aplicada, sem erro.
Confira à mão no painel do Supabase (Table Editor) que `carrinho_eventos` e a
view `carrinho_abandonados` existem.

- [ ] **Step 6: Registrar a permissão `carrinho` (para a policy de leitura acima ter o que checar)**

**Files:**
- Modify: `src/compartilhado/controle-de-login-e-usuario.js:145` (fim do array `RECURSOS`)
- Modify: `src/compartilhado/controle-de-login-e-usuario.js:214` (dentro de `PERMISSION_TREE`)

Old (linha 145, dentro de `RECURSOS`):
```js
  { key: 'atendimentos', label: 'Vessel — Atendimentos', acoes: ['ver', 'editar'] },
]
```
New:
```js
  { key: 'atendimentos', label: 'Vessel — Atendimentos', acoes: ['ver', 'editar'] },
  { key: 'carrinho', label: 'Funil de Carrinho', acoes: ['ver'] },
]
```

Old (linha 214, dentro de `PERMISSION_TREE`, logo depois de `claude.status`):
```js
  { key: 'claude.status', label: 'Painel de Status da IA', children: [] },
```
New:
```js
  { key: 'claude.status', label: 'Painel de Status da IA', children: [] },
  { key: 'carrinho', label: 'Funil de Carrinho', children: [] },
```

- [ ] **Step 7: Commit**

```bash
git add db/migrations/2026-09-17-carrinho-eventos.sql db/carrinho-eventos.test.mjs src/compartilhado/controle-de-login-e-usuario.js
git commit -m "feat(carrinho): tabela carrinho_eventos, view de abandono e permissão 'carrinho'"
```

---

### Task 2: Regra pura de validação e rate limit (`_shared`)

**Files:**
- Create: `supabase/functions/_shared/validar-evento-de-carrinho.js`
- Test: `supabase/functions/_shared/validar-evento-de-carrinho.test.mjs`

**Interfaces:**
- Consumes: nada.
- Produces: `validarPayload(corpo): {ok:true, evento:object} | {ok:false, motivo:string}`,
  `passouDoLimite(contagemUltimoMinuto, teto = TETO_POR_MINUTO): boolean`,
  `TIPOS_ACEITOS: string[]`, `TETO_POR_MINUTO: number` — usados pela Edge
  Function no Task 3.

- [ ] **Step 1: Escrever o teste (vai falhar — o módulo ainda não existe)**

```js
// supabase/functions/_shared/validar-evento-de-carrinho.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validarPayload, passouDoLimite, TIPOS_ACEITOS, TETO_POR_MINUTO } from './validar-evento-de-carrinho.js'

test('aceita os três tipos do MVP', () => {
  for (const tipo of TIPOS_ACEITOS) {
    const r = validarPayload({ tipo, cart_token: 'abc123' })
    assert.equal(r.ok, true)
    assert.equal(r.evento.tipo, tipo)
  }
})

test('rejeita tipo fora da lista (ex.: carrinho_visualizado, cortado no desenho)', () => {
  const r = validarPayload({ tipo: 'carrinho_visualizado', cart_token: 'abc123' })
  assert.equal(r.ok, false)
  assert.equal(r.motivo, 'tipo_invalido')
})

test('rejeita sem cart_token', () => {
  assert.equal(validarPayload({ tipo: 'produto_adicionado' }).ok, false)
  assert.equal(validarPayload({ tipo: 'produto_adicionado', cart_token: '' }).ok, false)
  assert.equal(validarPayload({ tipo: 'produto_adicionado', cart_token: '   ' }).ok, false)
})

test('rejeita corpo que não é objeto', () => {
  assert.equal(validarPayload(null).ok, false)
  assert.equal(validarPayload('x').ok, false)
})

test('sanitiza os campos numéricos: string vira número, lixo vira null', () => {
  const r = validarPayload({ tipo: 'produto_adicionado', cart_token: 'x', quantidade: '3', preco: 'não é número' })
  assert.equal(r.evento.quantidade, 3)
  assert.equal(r.evento.preco, null)
})

test('checkout_iniciado não precisa de produto nenhum', () => {
  const r = validarPayload({ tipo: 'checkout_iniciado', cart_token: 'x' })
  assert.equal(r.ok, true)
  assert.equal(r.evento.produto_id, null)
})

test('rate limit: abaixo do teto passa, no teto e acima barra', () => {
  assert.equal(passouDoLimite(59), false)
  assert.equal(passouDoLimite(60), true)
  assert.equal(passouDoLimite(61), true)
})

test('teto default é 60/minuto', () => {
  assert.equal(TETO_POR_MINUTO, 60)
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `node --test supabase/functions/_shared/validar-evento-de-carrinho.test.mjs`
Expected: FAIL — `Cannot find module './validar-evento-de-carrinho.js'`.

- [ ] **Step 3: Escrever o módulo**

```js
// supabase/functions/_shared/validar-evento-de-carrinho.js
//
// Regra pura de validação do payload que o Web Pixel Extension manda pra
// capturar-evento-carrinho, e da decisão de rate limit por IP. Separado do
// index.ts porque o Deno da edge não roda `node --test`, e aqui dá pra testar
// sem subir nada — ver spec
// docs/superpowers/specs/2026-09-17-funil-carrinho-shopify-design.md.

export const TIPOS_ACEITOS = ['produto_adicionado', 'produto_removido', 'checkout_iniciado']

// Teto de eventos por IP, por minuto. Por IP, nunca por cart_token — pedido
// explícito do dono, pra nunca barrar um cliente de verdade por conta de
// demanda alta (um carrinho não é o alvo do abuso; um IP martelando é).
export const TETO_POR_MINUTO = 60

function numeroOuNulo(v) {
  if (v === undefined || v === null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * Valida o corpo cru recebido pela edge function.
 * @returns {{ok:true, evento:object}|{ok:false, motivo:string}}
 */
export function validarPayload(corpo) {
  if (!corpo || typeof corpo !== 'object') return { ok: false, motivo: 'corpo_invalido' }
  if (!TIPOS_ACEITOS.includes(corpo.tipo)) return { ok: false, motivo: 'tipo_invalido' }
  if (typeof corpo.cart_token !== 'string' || !corpo.cart_token.trim()) {
    return { ok: false, motivo: 'cart_token_obrigatorio' }
  }
  return {
    ok: true,
    evento: {
      tipo: corpo.tipo,
      cart_token: corpo.cart_token.trim(),
      produto_id: corpo.produto_id != null ? String(corpo.produto_id) : null,
      produto_titulo: corpo.produto_titulo != null ? String(corpo.produto_titulo) : null,
      variante_id: corpo.variante_id != null ? String(corpo.variante_id) : null,
      quantidade: numeroOuNulo(corpo.quantidade),
      preco: numeroOuNulo(corpo.preco),
    },
  }
}

/** Já passou do teto de eventos por IP no último minuto? */
export function passouDoLimite(contagemUltimoMinuto, teto = TETO_POR_MINUTO) {
  return contagemUltimoMinuto >= teto
}
```

- [ ] **Step 4: Rodar o teste de novo e confirmar que passa**

Run: `node --test supabase/functions/_shared/validar-evento-de-carrinho.test.mjs`
Expected: PASS (8 testes).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/validar-evento-de-carrinho.js supabase/functions/_shared/validar-evento-de-carrinho.test.mjs
git commit -m "feat(carrinho): regra pura de validação de evento e rate limit por IP"
```

---

### Task 3: Edge Function `capturar-evento-carrinho`

**Files:**
- Create: `supabase/functions/capturar-evento-carrinho/index.ts`

**Interfaces:**
- Consumes: `validarPayload`, `passouDoLimite` de
  `../_shared/validar-evento-de-carrinho.js` (Task 2); tabela
  `carrinho_eventos` (Task 1).
- Produces: endpoint `POST /functions/v1/capturar-evento-carrinho`, chamado
  pelo Web Pixel Extension (Task 4). Responde `{ok:true}` (200), `{ok:false}`
  (400/500) ou `{ok:false, motivo:'limite'}` (429).

- [ ] **Step 1: Escrever a função**

```ts
// supabase/functions/capturar-evento-carrinho/index.ts
//
// A RECEPÇÃO DO PIXEL DA LOJA. Primeira função deste repo chamada por
// visitante ANÔNIMO da internet (o Web Pixel Extension da loja Shopify, sem
// login nenhum) — por isso verify_jwt fica DESLIGADO no deploy
// (--no-verify-jwt) e a validação/rate limit moram aqui, não num token.
//
// Grava cru em carrinho_eventos; quem decide "abandonado" é a view
// carrinho_abandonados (db/migrations/2026-09-17-carrinho-eventos.sql), não
// esta função. Ver spec
// docs/superpowers/specs/2026-09-17-funil-carrinho-shopify-design.md.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { validarPayload, passouDoLimite } from '../_shared/validar-evento-de-carrinho.js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Só o domínio da loja pode chamar — '*' deixaria qualquer site externo
// martelar a tabela. Configurar o segredo ORIGEM_DA_LOJA_SHOPIFY no deploy
// (ex.: 'https://minhaloja.myshopify.com').
const ORIGEM_DA_LOJA = Deno.env.get('ORIGEM_DA_LOJA_SHOPIFY') ?? '*';

const CORS = {
  'Access-Control-Allow-Origin': ORIGEM_DA_LOJA,
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const responder = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return responder({ ok: false }, 405);

  const corpo = await req.json().catch(() => null);
  const validado = validarPayload(corpo);
  if (!validado.ok) return responder({ ok: false }, 400);

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'desconhecido';
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  // Rate limit por IP, nunca por cart_token — ver _shared/validar-evento-de-carrinho.js.
  const umMinutoAtras = new Date(Date.now() - 60_000).toISOString();
  const { count } = await sb.from('carrinho_eventos')
    .select('id', { count: 'exact', head: true })
    .eq('ip', ip)
    .gte('criado_em', umMinutoAtras);
  if (passouDoLimite(count ?? 0)) return responder({ ok: false, motivo: 'limite' }, 429);

  const { error } = await sb.from('carrinho_eventos').insert({ ...validado.evento, ip });
  // Erro de banco nunca ecoa pro navegador do visitante — só um genérico.
  if (error) return responder({ ok: false }, 500);

  return responder({ ok: true });
});
```

- [ ] **Step 2: Rodar a suíte inteira e confirmar que o teste de fábrica (`toda-edge-compila.test.mjs`) pega a função nova**

Run: `npm test`
Expected: PASS em tudo, incluindo um caso novo para
`supabase/functions/capturar-evento-carrinho/index.ts` dentro de
`toda-edge-compila.test.mjs` (ele varre a pasta inteira sozinho — não precisa
editar esse arquivo).

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/capturar-evento-carrinho/index.ts
git commit -m "feat(carrinho): Edge Function pública que recebe os eventos do pixel"
```

- [ ] **Step 4: Deploy (checkpoint manual — segue o checklist do CLAUDE.md "Antes de publicar Edge Function")**

1. `git fetch` e confirme que está partindo do `origin/main` atualizado.
2. `npx supabase functions deploy capturar-evento-carrinho --no-verify-jwt --project-ref kounqtdoioootxqegkij`
3. Configure o segredo do domínio da loja (troque pela URL real):
   `npx supabase secrets set ORIGEM_DA_LOJA_SHOPIFY=https://<sua-loja>.myshopify.com --project-ref kounqtdoioootxqegkij`
4. Smoke test — confirme que valida e grava:
   ```bash
   curl -i -X POST https://kounqtdoioootxqegkij.supabase.co/functions/v1/capturar-evento-carrinho \
     -H 'Content-Type: application/json' \
     -d '{"tipo":"produto_adicionado","cart_token":"smoke-test","produto_titulo":"Teste"}'
   ```
   Espera-se `200 {"ok":true}`. Confira no Table Editor que a linha chegou em
   `carrinho_eventos` e depois apague essa linha de teste.
5. Confirme payload inválido devolve `400`:
   `curl -i -X POST .../capturar-evento-carrinho -d '{"tipo":"lixo"}'` → `400 {"ok":false}`.
6. **Não** faça o teste de "Bearer errado ⇒ 401" do CLAUDE.md aqui — ele vale
   pros robôs de cron com segredo próprio (`_shared/segredo-de-cron.ts`); esta
   função não usa esse mecanismo, é pública de propósito (spec §5).

---

### Task 4: Web Pixel Extension (Shopify)

**Files:**
- Create: `shopify-app/` (scaffold gerado pelo Shopify CLI)
- Create: `shopify-app/extensions/pixel-carrinho/src/index.js`

**Interfaces:**
- Consumes: URL pública da Edge Function `capturar-evento-carrinho` (Task 3).
- Produces: nada que outro Task consuma — é a ponta que fala com a Shopify.

- [ ] **Step 1: Autenticar e criar o app na conta de parceiro Shopify**

```bash
npm init @shopify/app@latest -- --name funil-carrinho-pixel --path shopify-app
```

Isso pede login interativo no navegador (conta de parceiro Shopify — crie uma
grátis em partners.shopify.com se ainda não tiver) e cria a pasta
`shopify-app/` com o esqueleto do app.

- [ ] **Step 2: Gerar a extensão de pixel**

```bash
cd shopify-app
shopify app generate extension --type web_pixel_extension --name pixel-carrinho
```

Isso cria `extensions/pixel-carrinho/` com `shopify.extension.toml` e
`src/index.js` de exemplo.

- [ ] **Step 3: Substituir o conteúdo de `src/index.js` gerado**

```js
// shopify-app/extensions/pixel-carrinho/src/index.js
//
// O PIXEL DA LOJA. Roda no navegador do visitante (sandbox da Shopify),
// escuta os três eventos do MVP e manda cada um pra
// capturar-evento-carrinho. Sem lógica de negócio aqui — quem valida e decide
// é a Edge Function (Task 3). Ver spec
// docs/superpowers/specs/2026-09-17-funil-carrinho-shopify-design.md.
import { register } from '@shopify/web-pixels-extension';

const URL_DA_EDGE = 'https://kounqtdoioootxqegkij.supabase.co/functions/v1/capturar-evento-carrinho';

register(({ analytics, init }) => {
  const enviar = (tipo, dados = {}) => {
    fetch(URL_DA_EDGE, {
      method: 'POST',
      body: JSON.stringify({ tipo, cart_token: init?.cart?.token, ...dados }),
    }).catch(() => {
      // Falha de rede do lado do visitante nunca deve aparecer pra ele —
      // é telemetria, não é o fluxo de compra. Silenciada de propósito.
    });
  };

  analytics.subscribe('product_added_to_cart', (evento) => {
    const item = evento.data.cartLine;
    enviar('produto_adicionado', {
      produto_id: item.merchandise.product.id,
      produto_titulo: item.merchandise.product.title,
      variante_id: item.merchandise.id,
      quantidade: item.quantity,
      preco: item.cost.totalAmount.amount,
    });
  });

  analytics.subscribe('product_removed_from_cart', (evento) => {
    const item = evento.data.cartLine;
    enviar('produto_removido', {
      produto_id: item.merchandise.product.id,
      produto_titulo: item.merchandise.product.title,
      variante_id: item.merchandise.id,
      quantidade: item.quantity,
      preco: item.cost.totalAmount.amount,
    });
  });

  analytics.subscribe('checkout_started', () => enviar('checkout_iniciado'));
});
```

- [ ] **Step 4: Deploy do app e instalação na loja**

```bash
shopify app deploy
```

Siga o link que o CLI imprime pra instalar o app na loja de verdade (o
cliente, ou você em nome dele, aprova uma vez — permissão mínima, é só
Customer Events).

- [ ] **Step 5: Verificação manual (sem teste automatizado — ver spec §8)**

1. Abra a loja de verdade (ou uma dev store), abra o DevTools → Network.
2. Adicione um produto ao carrinho. Confirme uma chamada `POST` pra
   `capturar-evento-carrinho` com `200` na aba Network.
3. Remova o produto do carrinho. Confirme o segundo evento.
4. Inicie o checkout. Confirme o terceiro evento (`checkout_iniciado`).
5. No Supabase Table Editor, confirme as 3 linhas em `carrinho_eventos` com o
   mesmo `cart_token`.

- [ ] **Step 6: Commit**

```bash
git add shopify-app/
git commit -m "feat(carrinho): Web Pixel Extension que manda os 3 eventos pra Edge Function"
```

---

### Task 5: Agregações puras da tela (`agregacoes-carrinho.js`)

**Files:**
- Create: `src/ferramentas/funil-carrinho/agregacoes-carrinho.js`
- Test: `src/ferramentas/funil-carrinho/agregacoes-carrinho.test.mjs`

**Interfaces:**
- Consumes: nada (pura).
- Produces: `rankearProdutos(linhas): {produto_titulo:string, contagem:number}[]`
  (do maior pro menor), `ordenarAbandonados(linhas): linhas` (mais recente
  primeiro) — usados pela tela no Task 6.

- [ ] **Step 1: Escrever o teste (vai falhar — o módulo ainda não existe)**

```js
// src/ferramentas/funil-carrinho/agregacoes-carrinho.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rankearProdutos, ordenarAbandonados } from './agregacoes-carrinho.js'

test('rankeia por número de eventos, do maior pro menor', () => {
  const linhas = [
    { produto_titulo: 'Bolsa Aurora' }, { produto_titulo: 'Bolsa Aurora' },
    { produto_titulo: 'Cinto Preto' },
    { produto_titulo: 'Bolsa Aurora' },
  ]
  assert.deepEqual(rankearProdutos(linhas), [
    { produto_titulo: 'Bolsa Aurora', contagem: 3 },
    { produto_titulo: 'Cinto Preto', contagem: 1 },
  ])
})

test('conta eventos, não soma quantidade — cada evento é uma vez que alguém mexeu no carrinho', () => {
  const linhas = [{ produto_titulo: 'Bolsa Aurora' }, { produto_titulo: 'Bolsa Aurora' }]
  assert.equal(rankearProdutos(linhas)[0].contagem, 2)
})

test('produto sem título não quebra o ranking', () => {
  const r = rankearProdutos([{ produto_titulo: null }, {}])
  assert.equal(r[0].produto_titulo, '(sem título)')
  assert.equal(r[0].contagem, 2)
})

test('período vazio devolve lista vazia, nunca quebra', () => {
  assert.deepEqual(rankearProdutos([]), [])
  assert.deepEqual(rankearProdutos(undefined), [])
})

test('abandonados: mais recente primeiro', () => {
  const linhas = [
    { cart_token: 'a', iniciado_em: '2026-09-01T10:00:00Z', ultimo_evento: '2026-09-01T10:05:00Z' },
    { cart_token: 'b', iniciado_em: '2026-09-02T09:00:00Z', ultimo_evento: '2026-09-02T09:30:00Z' },
  ]
  const r = ordenarAbandonados(linhas)
  assert.equal(r[0].cart_token, 'b')
})

test('abandonados: lista vazia não quebra', () => {
  assert.deepEqual(ordenarAbandonados([]), [])
  assert.deepEqual(ordenarAbandonados(undefined), [])
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `node --test src/ferramentas/funil-carrinho/agregacoes-carrinho.test.mjs`
Expected: FAIL — `Cannot find module './agregacoes-carrinho.js'`.

- [ ] **Step 3: Escrever o módulo**

```js
// src/ferramentas/funil-carrinho/agregacoes-carrinho.js
//
// Lógica pura da tela Funil de Carrinho: transforma as linhas cruas que vêm
// do Supabase (carrinho_eventos, carrinho_abandonados) em ranking pronto pra
// tabela. Sem rede aqui — a tela busca, isto agrega.

/**
 * Ranking de produtos por número de eventos (não soma quantidade: cada
 * evento é UMA vez que alguém adicionou/removeu, e é isso que a spec pediu
 * — "contagem", não "unidades").
 * @param {{produto_titulo: string|null}[]} linhas
 * @returns {{produto_titulo: string, contagem: number}[]} do maior pro menor
 */
export function rankearProdutos(linhas) {
  const contagem = new Map()
  for (const linha of linhas || []) {
    const titulo = linha?.produto_titulo || '(sem título)'
    contagem.set(titulo, (contagem.get(titulo) || 0) + 1)
  }
  return [...contagem.entries()]
    .map(([produto_titulo, contagem]) => ({ produto_titulo, contagem }))
    .sort((a, b) => b.contagem - a.contagem)
}

/**
 * Carrinhos abandonados prontos pra tabela: um por linha da view
 * carrinho_abandonados, ordenados do mais recente pro mais antigo.
 * @param {{cart_token:string, iniciado_em:string, ultimo_evento:string}[]} linhas
 */
export function ordenarAbandonados(linhas) {
  return [...(linhas || [])].sort((a, b) => new Date(b.ultimo_evento) - new Date(a.ultimo_evento))
}
```

- [ ] **Step 4: Rodar o teste de novo e confirmar que passa**

Run: `node --test src/ferramentas/funil-carrinho/agregacoes-carrinho.test.mjs`
Expected: PASS (6 testes).

- [ ] **Step 5: Commit**

```bash
git add src/ferramentas/funil-carrinho/agregacoes-carrinho.js src/ferramentas/funil-carrinho/agregacoes-carrinho.test.mjs
git commit -m "feat(carrinho): ranking puro de produtos e ordenação de abandonados"
```

---

### Task 6: Tela "Funil de Carrinho" + wiring (rota, permissão, card na Home)

**Files:**
- Create: `src/ferramentas/funil-carrinho/tela-de-funil-carrinho.vue`
- Create: `src/ferramentas/funil-carrinho/imports.test.mjs`
- Create: `src/ferramentas/funil-carrinho/LEIA-ME.txt`
- Modify: `src/mapa-de-enderecos.js`
- Modify: `src/ferramentas/inicio/tela-de-inicio.vue`

**Interfaces:**
- Consumes: `rankearProdutos`, `ordenarAbandonados` (Task 5); tabela
  `carrinho_eventos` e view `carrinho_abandonados` (Task 1); `sbClient` de
  `../../compartilhado/conectar-no-banco-de-dados.js`; `hojeLocal`,
  `diasAtras` de `../../compartilhado/datas.js`; `BarraDeTopo` de
  `../../compartilhado/barra-de-topo.vue`.
- Produces: rota `/funil-carrinho` (name: `funil-carrinho`), card na Home
  atrás da permissão `carrinho`.

- [ ] **Step 1: Escrever `imports.test.mjs` (guarda de import — nasce com a pasta)**

```js
// src/ferramentas/funil-carrinho/imports.test.mjs
import { guardarImports } from '../../compartilhado/guarda-de-imports.mjs'

guardarImports(import.meta.url, {
  minimoDeTelas: 1,
})
```

- [ ] **Step 2: Escrever a tela**

```vue
<!-- src/ferramentas/funil-carrinho/tela-de-funil-carrinho.vue -->
<template>
  <div class="fc-tela">
    <barra-de-topo voltar="Central" titulo="Funil de Carrinho" @voltar="voltar" />

    <div class="fc-body">
      <div class="fc-periodo">
        <span class="fc-periodo-label">Período</span>
        <button
          v-for="p in PERIODOS" :key="p.dias" class="btn"
          :class="{ 'btn-principal': periodoAtivo === p.dias }"
          @click="selecionarPeriodo(p.dias)"
        >{{ p.rotulo }}</button>
      </div>

      <p v-if="erro" class="fc-erro" role="alert">Não consegui carregar os dados: {{ erro }}</p>

      <div class="fc-grade">
        <section class="fc-cartao card-base">
          <h2 class="fc-titulo-secao">Mais adicionados ao carrinho</h2>
          <p v-if="carregando" class="fc-carregando">Carregando…</p>
          <p v-else-if="!maisAdicionados.length" class="fc-vazio">Nenhum produto adicionado ao carrinho neste período.</p>
          <table v-else class="fc-tabela">
            <thead><tr><th>Produto</th><th>Vezes adicionado</th></tr></thead>
            <tbody>
              <tr v-for="p in maisAdicionados" :key="p.produto_titulo">
                <td>{{ p.produto_titulo }}</td>
                <td>{{ p.contagem }}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section class="fc-cartao card-base">
          <h2 class="fc-titulo-secao">Mais removidos do carrinho</h2>
          <p v-if="carregando" class="fc-carregando">Carregando…</p>
          <p v-else-if="!maisRemovidos.length" class="fc-vazio">Nenhum produto removido do carrinho neste período.</p>
          <table v-else class="fc-tabela">
            <thead><tr><th>Produto</th><th>Vezes removido</th></tr></thead>
            <tbody>
              <tr v-for="p in maisRemovidos" :key="p.produto_titulo">
                <td>{{ p.produto_titulo }}</td>
                <td>{{ p.contagem }}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section class="fc-cartao fc-cartao-largo card-base">
          <h2 class="fc-titulo-secao">Carrinhos abandonados antes do checkout</h2>
          <p class="fc-explicacao">Teve produto adicionado, nunca chegou a iniciar o checkout, e ficou parado por mais de 30 minutos.</p>
          <p v-if="carregando" class="fc-carregando">Carregando…</p>
          <p v-else-if="!abandonados.length" class="fc-vazio">Nenhum carrinho abandonado neste período.</p>
          <table v-else class="fc-tabela">
            <thead><tr><th>Carrinho iniciado em</th><th>Última movimentação</th></tr></thead>
            <tbody>
              <tr v-for="c in abandonados" :key="c.cart_token">
                <td>{{ formatarData(c.iniciado_em) }}</td>
                <td>{{ formatarData(c.ultimo_evento) }}</td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import BarraDeTopo from '../../compartilhado/barra-de-topo.vue'
import { sbClient } from '../../compartilhado/conectar-no-banco-de-dados.js'
import { diasAtras } from '../../compartilhado/datas.js'
import { rankearProdutos, ordenarAbandonados } from './agregacoes-carrinho.js'

const router = useRouter()
const voltar = () => router.push({ name: 'inicio' })

const PERIODOS = [
  { dias: 7, rotulo: '7D' },
  { dias: 14, rotulo: '14D' },
  { dias: 30, rotulo: '30D' },
]

const periodoAtivo = ref(7)
const carregando = ref(true)
const erro = ref(null)
const maisAdicionados = ref([])
const maisRemovidos = ref([])
const abandonados = ref([])

function formatarData(iso) {
  return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
}

async function carregar() {
  carregando.value = true
  erro.value = null
  const desde = `${diasAtras(periodoAtivo.value)}T00:00:00-03:00`

  const [adicionados, removidos, carrinhosAbandonados] = await Promise.all([
    sbClient.from('carrinho_eventos').select('produto_titulo').eq('tipo', 'produto_adicionado').gte('criado_em', desde),
    sbClient.from('carrinho_eventos').select('produto_titulo').eq('tipo', 'produto_removido').gte('criado_em', desde),
    sbClient.from('carrinho_abandonados').select('cart_token,iniciado_em,ultimo_evento').gte('iniciado_em', desde),
  ])

  const primeiroErro = adicionados.error || removidos.error || carrinhosAbandonados.error
  if (primeiroErro) {
    erro.value = primeiroErro.message
    carregando.value = false
    return
  }

  maisAdicionados.value = rankearProdutos(adicionados.data)
  maisRemovidos.value = rankearProdutos(removidos.data)
  abandonados.value = ordenarAbandonados(carrinhosAbandonados.data)
  carregando.value = false
}

function selecionarPeriodo(dias) {
  periodoAtivo.value = dias
  carregar()
}

onMounted(carregar)
</script>

<style scoped>
.fc-tela { min-height: 100vh; background: var(--bg); }
.fc-body { padding: var(--sp-6); display: flex; flex-direction: column; gap: var(--sp-6); }
.fc-periodo { display: flex; align-items: center; gap: var(--sp-2); flex-wrap: wrap; }
.fc-periodo-label { font-size: var(--texto-etiqueta); text-transform: uppercase; letter-spacing: 1.5px; color: var(--muted); margin-right: var(--sp-2); }
.fc-grade { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: var(--sp-6); }
.fc-cartao-largo { grid-column: 1 / -1; }
.fc-titulo-secao { font-size: var(--texto-titulo); margin: 0 0 var(--sp-4); overflow-wrap: anywhere; }
.fc-explicacao { font-size: var(--texto-corpo); color: var(--muted); margin: 0 0 var(--sp-4); }
.fc-carregando, .fc-vazio { font-size: var(--texto-corpo); color: var(--muted); }
.fc-erro { font-size: var(--texto-campo); color: var(--red); }
.fc-tabela { width: 100%; border-collapse: collapse; font-size: var(--texto-corpo); }
.fc-tabela th, .fc-tabela td { text-align: left; padding: var(--sp-2) var(--sp-3); border-bottom: 1px solid var(--border); overflow-wrap: anywhere; }
.fc-tabela th { color: var(--muted); font-size: var(--texto-etiqueta); text-transform: uppercase; letter-spacing: 1.5px; }

@media (max-width: 640px) {
  .fc-body { padding: var(--sp-4); }
}
</style>
```

- [ ] **Step 3: Escrever o `LEIA-ME.txt` da pasta**

```
FERRAMENTA: Funil de Carrinho
==============================
Rastreamento de carrinho da loja Shopify ANTES do checkout — a Shopify não
guarda nada disso nativamente (o "checkout abandonado" dela só nasce quando a
pessoa clica em finalizar compra). Ver spec
docs/superpowers/specs/2026-09-17-funil-carrinho-shopify-design.md.

Como chega o dado:
- Web Pixel Extension (pasta shopify-app/, fora de src/) escuta 3 eventos da
  Web Pixels API do Shopify (produto adicionado, produto removido, checkout
  iniciado) e manda cada um pra Edge Function pública
  supabase/functions/capturar-evento-carrinho, que valida e grava cru na
  tabela carrinho_eventos.
- Sem robô de agregação: "abandonado" é a view carrinho_abandonados
  (db/migrations/2026-09-17-carrinho-eventos.sql), calculada na consulta —
  carrinho com produto adicionado, sem checkout iniciado, parado há mais de
  30 minutos.

A tela é SÓ DE LEITURA, com três blocos: mais adicionados, mais removidos,
carrinhos abandonados — filtro de período (7D/14D/30D) no topo.

FORA DO MVP (de propósito, ver spec §2 e §9):
- Evento "carrinho visualizado" (Shopify não garante).
- Valor em R$ parado no carrinho (só contagem por enquanto).
- Reconciliação com pedido/venda de verdade (o Bling já cobre isso).
- Robô de agregação e rate limit por cart_token (dono pediu só por IP).

Permissão: 'carrinho' (RECURSOS e PERMISSION_TREE em
src/compartilhado/controle-de-login-e-usuario.js). Quem ganha acesso precisa
que um admin marque e salve a permissão — mesmo mecanismo de toda ferramenta
nova daqui (ver derivar-features.js).
```

- [ ] **Step 4: Adicionar a rota**

**Modify:** `src/mapa-de-enderecos.js`

Old:
```js
  { path: '/conteudo/peca/:id', name: 'conteudo-peca', component: () => import('./ferramentas/conteudo/tela-de-peca.vue'), meta: { recurso: 'conteudo' }, props: true },
  // Catch-all — precisa ser a ÚLTIMA rota. Sem ela, uma URL/bookmark que não
```
New:
```js
  { path: '/conteudo/peca/:id', name: 'conteudo-peca', component: () => import('./ferramentas/conteudo/tela-de-peca.vue'), meta: { recurso: 'conteudo' }, props: true },
  { path: '/funil-carrinho', name: 'funil-carrinho', component: () => import('./ferramentas/funil-carrinho/tela-de-funil-carrinho.vue'), meta: { recurso: 'carrinho' } },
  // Catch-all — precisa ser a ÚLTIMA rota. Sem ela, uma URL/bookmark que não
```

- [ ] **Step 5: Adicionar o card na Home**

**Modify:** `src/ferramentas/inicio/tela-de-inicio.vue`

Old (dentro do `<script setup>`, perto de `podeClaudeStatus`):
```js
const podeClaudeStatus = computed(() => hasPermission('claude.status', 'ver'))
```
New:
```js
const podeClaudeStatus = computed(() => hasPermission('claude.status', 'ver'))
const podeCarrinho = computed(() => hasPermission('carrinho', 'ver'))
```

Old (no `<template>`, logo depois do card `home-card-claude-status`):
```html
        <div class="home-card" id="home-card-claude-status" v-show="podeClaudeStatus" @click="ir('claude-status')" @mouseenter="definirTemaFundo('default')" @mouseleave="definirTemaFundo('default')">
          <div class="home-card-icon" style="background:linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%)">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
          </div>
          <div class="home-card-text">
            <h3>Status<br>da IA</h3>
            <p>Robôs de IA, quanto cada tarefa custou e o gasto real das contas</p>
          </div>
          <span class="home-card-enter">→</span>
        </div>
```
New (acrescenta o card do Funil de Carrinho logo depois):
```html
        <div class="home-card" id="home-card-claude-status" v-show="podeClaudeStatus" @click="ir('claude-status')" @mouseenter="definirTemaFundo('default')" @mouseleave="definirTemaFundo('default')">
          <div class="home-card-icon" style="background:linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%)">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
          </div>
          <div class="home-card-text">
            <h3>Status<br>da IA</h3>
            <p>Robôs de IA, quanto cada tarefa custou e o gasto real das contas</p>
          </div>
          <span class="home-card-enter">→</span>
        </div>
        <div class="home-card" id="home-card-carrinho" v-show="podeCarrinho" @click="ir('funil-carrinho')" @mouseenter="definirTemaFundo('default')" @mouseleave="definirTemaFundo('default')">
          <div class="home-card-icon" style="background:linear-gradient(135deg,#ea580c 0%,#f97316 100%)">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
          </div>
          <div class="home-card-text">
            <h3>Funil de<br>Carrinho</h3>
            <p>Produtos mais adicionados/removidos e carrinhos abandonados antes do checkout</p>
          </div>
          <span class="home-card-enter">→</span>
        </div>
```

- [ ] **Step 6: Rodar a suíte inteira**

Run: `npm test`
Expected: PASS em tudo (inclui `imports.test.mjs` novo, `todo-vue-compila.test.mjs`
pegando a tela nova, e `padrao-da-central.test.mjs` conferindo cor/botão/modal
— esta tela não abre modal nenhum, então não deveria disparar nada ali).

- [ ] **Step 7: Build de produção**

Run: `npm run build`
Expected: sem erro.

- [ ] **Step 8: Verificação manual no navegador (obrigatória — PADRAO-DA-CENTRAL.md item 10)**

```bash
npm run dev -- --port 5199 --strictPort
```

1. Logue como um usuário com a permissão `carrinho` marcada (ou como admin/super-admin).
2. Abra a Home, confirme o card "Funil de Carrinho" aparece e leva pra `/funil-carrinho`.
3. Redimensione pra **375px**: confira rolagem horizontal = 0, nenhum botão
   abaixo de 40px de altura, nenhum texto cortado.
4. Confira também a **1440px** e no **tema escuro**.
5. Sem eventos ainda no banco: confirme que os três blocos mostram a mensagem
   de "nenhum X neste período" (nunca uma tabela vazia sem explicação — PADRAO item 9).
6. Se já tiver dado de teste da Task 3/4: confira o ranking bater com o que
   você mandou.

- [ ] **Step 9: Commit**

```bash
git add src/ferramentas/funil-carrinho/ src/mapa-de-enderecos.js src/ferramentas/inicio/tela-de-inicio.vue
git commit -m "feat(carrinho): tela Funil de Carrinho + rota + card na Home"
```

---

## Depois de tudo pronto

- Conceda a permissão `carrinho` pra si mesmo (ou pra quem for usar) em
  Admin → Permissões, e salve — sem isso a RLS de `carrinho_eventos` (Task 1)
  nega a leitura mesmo com a rota liberada.
- **⚠️ MUDANÇA DE ÚLTIMA HORA (18/09/2026), depois deste plano já ter sido
  executado — o mecanismo de captação NÃO é mais o Web Pixel App
  Extension nem o Custom Pixel descritos nas Tasks 4/originais.** Os dois
  foram tentados de verdade em produção e descartados:
  1. **App Extension** (`shopify-app/funil-carrinho-pixel/`) — publicada
     com sucesso, mas instalar exige OAuth contra um backend hospedado de
     verdade (este app não tem, nem precisa). Sem hospedar isso em algum
     lugar, a instalação nunca sai do `example.com` do template.
  2. **Custom Pixel** (`shopify-app/pixel-custom-colado-no-admin.js`,
     colado em Configurações → Customer events) — funcionou, mas só
     dispara pra quem aceita cookie de Marketing+Análises, sub-relatando o
     funil. Testado ao vivo e depois **desconectado**.

  O que roda de verdade: um **interceptador colado direto no tema**
  (`layout/theme.liquid` do tema ativo "VESSEL BRASIL V1.0 ERICK"), cópia
  de referência em `shopify-app/interceptador-carrinho-no-tema.html`. Ele
  troca `window.fetch`/`XMLHttpRequest` no navegador do cliente pra
  enxergar as chamadas de QUALQUER app de carrinho da loja aos endpoints
  padrão da Ajax Cart API (`/cart/add.js`, `/cart/change.js`,
  `/cart/update.js`) — captura 100% das ações, sem depender de
  consentimento de cookies (decisão de privacidade explícita do dono).
  Testado ao vivo na loja de produção em 18/09/2026, com eventos reais
  confirmados na tabela `carrinho_eventos` (produto, preço e quantidade
  corretos). Ver `src/ferramentas/funil-carrinho/LEIA-ME.txt` pro relato
  completo, incluindo uma limitação aceita (remoção após recarregar a
  página perde o nome do produto — o evento conta, só não identifica a
  peça).

  **Se um dia o tema for trocado**, este bloco de script some
  silenciosamente — colar de novo a partir de
  `shopify-app/interceptador-carrinho-no-tema.html`.
- Depois de alguns dias de dado real, releia com o dono se 30 minutos
  (janela de "abandonado") e 60/minuto (rate limit) continuam certos —
  os dois são ajustáveis, nenhum foi medido.
- **Achados da revisão final registrados, não bloqueantes (ver ledger do SDD
  para o texto completo):** o rótulo "Última movimentação" na tela conta só
  produto adicionado, não remoção (mesma definição da spec, não é bug de
  código); linhas de carrinho abandonado mostram só duas datas, sem produto
  nem cart_token, então não dá pra agir em cima — ambos ficam pra uma
  iteração futura, coerente com "com o tempo vamos pensando em mais coisas".
