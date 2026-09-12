# Grupo do canal (atacado / varejo) — Peça 1

> **Para quem executa:** os passos usam caixa (`- [ ]`) para marcar o andamento.
> Este plano é a Peça 1 de quatro; as outras três estão listadas na spec e **não**
> entram aqui.

**Objetivo:** dar a cada canal de venda do Bling um grupo (atacado, varejo, ou
outro que o dono criar), configurável numa tela, para as peças seguintes lerem.

**Abordagem:** uma coluna `grupo` em `bling_lojas` com a política de escrita que
falta; a lógica de normalizar/agrupar num módulo puro testável sem navegador; e uma
seção nova em Config de Admin que lista os 14 canais com um seletor cada. O time
não ganha campo — ele herda o grupo do canal a que já está amarrado.

**Ferramentas:** Postgres/Supabase (migration pelo MCP), Vue 3 + Vite, `node --test`.

**Spec:** `docs/superpowers/specs/2026-08-20-grupo-do-canal-design.md`

## Restrições que valem para todas as tarefas

- **Ler `PADRAO-DA-CENTRAL.md` antes da primeira linha.** Espaçamento só da escala
  `--sp-1`…`--sp-8`; raio `--radius-*`; cor só por token, nunca hex; botão usa
  `.btn` / `.btn.btn-principal` / `.btn.btn-perigo`; nada de `style=` solto em botão.
- **Texto para o dono, em português, sem jargão.** "Grupo", não "segmento".
- **Nada de dado real alterado na mão.** As provas de banco rodam dentro de
  `begin … rollback`.
- **A tela nunca mente:** gravação que não gravou tem de dizer que não gravou.
- Medir a **375px e 1440px**, nos dois temas, antes de dizer que acabou.

---

### Tarefa 1 — A coluna e a política de escrita

**Arquivos:**
- Criar: `db/migrations/2026-08-20-grupo-do-canal.sql`
- Criar: `docs/provar-grupo-do-canal.sql`

**Interfaces:**
- Produz: `public.bling_lojas.grupo text null` e a política
  `bling_lojas_grupo_superadmin` (UPDATE, `to authenticated`).

- [ ] **Passo 1: escrever a migration**

```sql
-- O GRUPO DO CANAL (atacado / varejo) — 20/08/2026
--
-- PEDIDO DO DONO: "nas vendas tem o campo seletor de canais, eu quero uma
-- separação por canal — exemplo, atacado (opção pra marcar/desmarcar todos) e
-- varejo".
--
-- POR QUE AQUI E NÃO EM `equipes` (medido em 20/08/2026):
--   canais no Bling ....... 14
--   canais com time ....... 3   (os mesmos 3 que têm venda)
-- Pôr o rótulo no time deixaria 11 canais sem grupo — inclusive "Private Label"
-- e "Institucional", que não são time de gente nenhuma. O dono confirmou que os
-- 11 vão vender um dia e quer marcá-los agora. Então o grupo é do CANAL, e o
-- time é atacado ou varejo pelo canal a que já está amarrado.
--
-- TEXTO, e não uma lista travada no código: o dono disse "exemplo, atacado e
-- varejo", e "exemplo" é o aviso de que um terceiro pode aparecer. Grupo novo
-- tem de ser digitação na tela, não migration — a mesma decisão que este banco
-- já tomou para as lojas.
alter table public.bling_lojas
  add column if not exists grupo text;

comment on column public.bling_lojas.grupo is
  'Grupo comercial do canal (atacado, varejo, ...). NULL = sem grupo. Editavel so por superadmin, na Config de Admin. O time herda daqui pelo equipes.canal_loja_id.';

-- ─────────────────────────────────────────────────────────────────────────────
-- A POLÍTICA QUE FALTAVA
--
-- `bling_lojas` tinha RLS ligado e UMA política: leitura. Sem uma de escrita, a
-- tela salvaria sem salvar — o PostgREST responde SUCESSO COM ZERO LINHAS quando
-- o RLS barra, sem erro nenhum. Já custou um dia neste projeto.
--
-- `using` E `with check`: só o `using` é metade da trava. Ele decide quais linhas
-- podem ser alcançadas; o `with check` decide o que pode ficar gravado nelas.
drop policy if exists "bling_lojas_grupo_superadmin" on public.bling_lojas;
create policy "bling_lojas_grupo_superadmin"
  on public.bling_lojas for update
  to authenticated
  using      (coalesce((select p.is_superadmin from public.profiles p where p.id = auth.uid()), false))
  with check (coalesce((select p.is_superadmin from public.profiles p where p.id = auth.uid()), false));
```

- [ ] **Passo 2: aplicar pelo MCP do Supabase**

Usar `apply_migration` com o nome `grupo_do_canal`. Não rodar por CLI: neste
projeto migration nova vai pelo MCP.

- [ ] **Passo 3: conferir que a coluna nasceu vazia nos 14**

```sql
select count(*) as total, count(grupo) as com_grupo from public.bling_lojas;
```

Esperado: `total = 14`, `com_grupo = 0`. Nenhum grupo é adivinhado pelo nome do
canal — quem marca é o dono, na tela.

- [ ] **Passo 4: escrever a prova permanente da trava**

Criar `docs/provar-grupo-do-canal.sql`:

```sql
-- PROVA DA TRAVA DO GRUPO DO CANAL (20/08/2026)
--
-- Roda inteiro dentro de begin/rollback: NENHUM dado real fica alterado.
-- A trava se prova COM ela armada. Desarmar para testar é testar outra coisa.
begin;

-- 1. Como superadmin: grava.
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', (select id from public.profiles where is_superadmin limit 1))::text, true);

update public.bling_lojas set grupo = 'atacado'
 where loja_id = (select loja_id from public.bling_lojas order by loja_id limit 1);
-- ESPERADO: UPDATE 1

-- 2. Como quem NÃO é superadmin: alcança zero linhas.
select set_config('request.jwt.claims',
  json_build_object('sub', (select id from public.profiles where not coalesce(is_superadmin,false) limit 1))::text, true);

update public.bling_lojas set grupo = 'varejo'
 where loja_id = (select loja_id from public.bling_lojas order by loja_id limit 1);
-- ESPERADO: UPDATE 0  ← e SEM erro. É por isso que a tela confere a contagem:
--                        o banco não reclama, ele só não grava.

rollback;
```

- [ ] **Passo 5: rodar a prova e conferir os dois números**

Rodar o conteúdo pelo `execute_sql` do MCP. Esperado: o primeiro `update` afeta
**1** linha, o segundo afeta **0**, e nenhum dos dois dá erro.

- [ ] **Passo 6: commitar**

```bash
git add db/migrations/2026-08-20-grupo-do-canal.sql docs/provar-grupo-do-canal.sql
git commit -m "feat(banco): o canal do Bling ganha grupo, com a politica de escrita que faltava"
```

---

### Tarefa 2 — A lógica de agrupar, testável sem navegador

**Arquivos:**
- Criar: `src/ferramentas/admin/grupo-do-canal.js`
- Criar: `src/ferramentas/admin/grupo-do-canal.test.mjs`

**Interfaces:**
- Consome: nada (módulo puro).
- Produz, para a Tarefa 3 e para as Peças 2 e 4:
  - `normalizarGrupo(texto) -> string | null`
  - `mesmoGrupo(a, b) -> boolean`
  - `gruposExistentes(canais) -> string[]`
  - `agruparCanais(canais) -> [{ grupo: string|null, canais: object[] }]`
  - `timePorCanal(times) -> Map<string, object>`
  - `contarSemGrupo(canais) -> number`
  - `canais` são objetos `{ loja_id, nome, grupo }`; `times` são `{ id, nome, canal_loja_id }`.

- [ ] **Passo 1: escrever o teste que reprova**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizarGrupo, mesmoGrupo, gruposExistentes,
  agruparCanais, timePorCanal, contarSemGrupo,
} from './grupo-do-canal.js';

// Os 14 canais reais, medidos no banco em 20/08/2026.
const CANAIS = [
  { loja_id: 205451611, nome: 'Atacado Nuvem Shop', grupo: 'Atacado' },
  { loja_id: 205657609, nome: 'Loja Dom Pedro', grupo: 'Varejo' },
  { loja_id: 205834140, nome: "Loja Santa Bárbara d'Oeste", grupo: 'Varejo' },
  { loja_id: 205395333, nome: 'Atacado Fábrica', grupo: null },
  { loja_id: 205513124, nome: 'Varejo Fábrica', grupo: '' },
];

test('normalizar: tira espaço das pontas, junta espaço repetido, vazio vira nulo', () => {
  assert.equal(normalizarGrupo('  Atacado  '), 'Atacado');
  assert.equal(normalizarGrupo('Loja  de   Fábrica'), 'Loja de Fábrica');
  assert.equal(normalizarGrupo(''), null);
  assert.equal(normalizarGrupo('   '), null);
  assert.equal(normalizarGrupo(null), null);
  assert.equal(normalizarGrupo(undefined), null);
});

test('mesmoGrupo ignora maiúscula e espaço — senão nascem dois grupos que parecem um', () => {
  assert.ok(mesmoGrupo('Atacado', 'atacado'));
  assert.ok(mesmoGrupo(' Varejo ', 'VAREJO'));
  assert.ok(mesmoGrupo(null, ''));
  assert.ok(!mesmoGrupo('Atacado', 'Varejo'));
  assert.ok(!mesmoGrupo('Atacado', null));
});

test('gruposExistentes: sem repetir, em ordem, guardando a grafia da primeira vez', () => {
  const canais = [
    { loja_id: 1, nome: 'a', grupo: 'Varejo' },
    { loja_id: 2, nome: 'b', grupo: 'atacado' },
    { loja_id: 3, nome: 'c', grupo: 'VAREJO' },
    { loja_id: 4, nome: 'd', grupo: null },
  ];
  assert.deepEqual(gruposExistentes(canais), ['atacado', 'Varejo']);
});

test('gruposExistentes com lista vazia devolve lista vazia, não quebra', () => {
  assert.deepEqual(gruposExistentes([]), []);
  assert.deepEqual(gruposExistentes(null), []);
});

test('agruparCanais: um balde por grupo, e o SEM GRUPO por último', () => {
  const r = agruparCanais(CANAIS);
  assert.deepEqual(r.map((b) => b.grupo), ['Atacado', 'Varejo', null]);
  assert.deepEqual(r[0].canais.map((c) => c.nome), ['Atacado Nuvem Shop']);
  assert.equal(r[1].canais.length, 2);
  // Canal sem grupo NÃO some: some do seletor é o defeito que a Peça 2 evita.
  assert.deepEqual(r[2].canais.map((c) => c.nome), ['Atacado Fábrica', 'Varejo Fábrica']);
});

test('agruparCanais: sem nenhum canal agrupado, existe só o balde sem grupo', () => {
  const r = agruparCanais([{ loja_id: 1, nome: 'x', grupo: null }]);
  assert.equal(r.length, 1);
  assert.equal(r[0].grupo, null);
});

test('agruparCanais: todos agrupados, o balde sem grupo NÃO aparece vazio', () => {
  const r = agruparCanais([{ loja_id: 1, nome: 'x', grupo: 'Atacado' }]);
  assert.deepEqual(r.map((b) => b.grupo), ['Atacado']);
});

test('agruparCanais mantém a ordem dos canais dentro do balde', () => {
  const r = agruparCanais([
    { loja_id: 2, nome: 'B', grupo: 'Atacado' },
    { loja_id: 1, nome: 'A', grupo: 'Atacado' },
  ]);
  assert.deepEqual(r[0].canais.map((c) => c.nome), ['B', 'A']);
});

test('timePorCanal casa o time pelo canal, e canal sem time não aparece', () => {
  const times = [
    { id: 't1', nome: 'Dom Pedro', canal_loja_id: 205657609 },
    { id: 't2', nome: 'Iguatemi Campinas', canal_loja_id: null },
  ];
  const mapa = timePorCanal(times);
  assert.equal(mapa.get('205657609').nome, 'Dom Pedro');
  assert.equal(mapa.get('205451611'), undefined);
  assert.equal(mapa.size, 1, 'time sem canal não entra no mapa');
});

test('contarSemGrupo conta o que falta configurar', () => {
  assert.equal(contarSemGrupo(CANAIS), 2);
  assert.equal(contarSemGrupo([]), 0);
});
```

- [ ] **Passo 2: rodar e ver reprovar**

Rodar: `node --test src/ferramentas/admin/grupo-do-canal.test.mjs`
Esperado: FALHA com "does not provide an export named 'normalizarGrupo'".

- [ ] **Passo 3: escrever o módulo**

```js
// O GRUPO DO CANAL DE VENDA (atacado, varejo, ...).
//
// PURO de propósito, como os vizinhos desta pasta: aqui não se desenha nada e
// não se fala com banco. A tela pergunta e obedece.
//
// O grupo mora no CANAL (`bling_lojas.grupo`), não no time — dos 14 canais do
// Bling só 3 têm time, e o dono quer marcar os 11 zerados agora. O time é
// atacado ou varejo pelo canal a que está amarrado.

// Espaço das pontas fora, espaço repetido virando um só, vazio virando nulo.
// Sem isto, "Atacado " e "Atacado" viram dois grupos que parecem um.
export function normalizarGrupo(texto) {
  const t = String(texto == null ? '' : texto).trim().replace(/\s+/g, ' ');
  return t === '' ? null : t;
}

// Comparar SEM diferenciar maiúscula: quem digita "atacado" está falando do
// mesmo grupo de quem digitou "Atacado".
export function mesmoGrupo(a, b) {
  const na = normalizarGrupo(a);
  const nb = normalizarGrupo(b);
  if (na === null || nb === null) return na === nb;
  return na.toLocaleLowerCase('pt-BR') === nb.toLocaleLowerCase('pt-BR');
}

// Os grupos que já existem, para o seletor oferecer. Guarda a grafia da PRIMEIRA
// aparição — quem escreveu primeiro decide como o nome aparece.
export function gruposExistentes(canais) {
  const vistos = new Map();
  for (const c of canais || []) {
    const g = normalizarGrupo(c && c.grupo);
    if (g === null) continue;
    const chave = g.toLocaleLowerCase('pt-BR');
    if (!vistos.has(chave)) vistos.set(chave, g);
  }
  return [...vistos.values()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

// Os canais em baldes. O balde SEM GRUPO vai por último e só existe se tiver
// gente dentro — canal sem grupo não pode sumir da lista, mas cabeçalho vazio
// também não ajuda ninguém.
export function agruparCanais(canais) {
  const lista = canais || [];
  const baldes = [];
  for (const nome of gruposExistentes(lista)) {
    baldes.push({ grupo: nome, canais: lista.filter((c) => mesmoGrupo(c && c.grupo, nome)) });
  }
  const orfaos = lista.filter((c) => normalizarGrupo(c && c.grupo) === null);
  if (orfaos.length) baldes.push({ grupo: null, canais: orfaos });
  return baldes;
}

// De-para canal -> time, para a linha do canal poder dizer de quem ele é.
// Chave em texto porque o id vem number do banco e string do formulário.
export function timePorCanal(times) {
  const mapa = new Map();
  for (const t of times || []) {
    if (t == null || t.canal_loja_id === null || t.canal_loja_id === undefined || t.canal_loja_id === '') continue;
    mapa.set(String(t.canal_loja_id), t);
  }
  return mapa;
}

// Quantos ainda faltam configurar — vai no cabeçalho da seção.
export function contarSemGrupo(canais) {
  return (canais || []).filter((c) => normalizarGrupo(c && c.grupo) === null).length;
}
```

- [ ] **Passo 4: rodar e ver passar**

Rodar: `node --test src/ferramentas/admin/grupo-do-canal.test.mjs`
Esperado: 10 testes, 10 passando.

- [ ] **Passo 5: commitar**

```bash
git add src/ferramentas/admin/grupo-do-canal.js src/ferramentas/admin/grupo-do-canal.test.mjs
git commit -m "feat(admin): a logica de agrupar canais por grupo, testada sem navegador"
```

---

### Tarefa 3 — A seção "Canais de venda" na Config de Admin

**Arquivos:**
- Modificar: `src/ferramentas/admin/tela-de-admin.vue`
  (template: dentro de `#admin-section-users`, logo ANTES de `<span class="sg-label">Times de venda</span>`, por volta da linha 93; script: função nova `loadAdminCanais`, chamada de onde `loadAdminEquipes` já é chamada)

**Interfaces:**
- Consome da Tarefa 2: `gruposExistentes`, `agruparCanais`, `timePorCanal`,
  `contarSemGrupo`, `normalizarGrupo`.
- Consome da Tarefa 1: a coluna `grupo` e a política de escrita.

- [ ] **Passo 1: acrescentar o lugar no template**

Antes da linha `<span class="sg-label">Times de venda</span>`:

```html
          <!-- CANAIS DE VENDA — o grupo (atacado/varejo) mora AQUI, no canal,
               e não na ficha do time: dos 14 canais do Bling só 3 têm time. O
               time é atacado ou varejo pelo canal a que está amarrado. -->
          <span class="sg-label">Canais de venda</span>
          <div class="admin-section-sub">Cada canal do Bling pertence a um grupo — <b>Atacado</b>, <b>Varejo</b>, ou outro que você criar. É esse grupo que vai separar o seletor das dashboards e os times na lista de usuários. Canal sem grupo continua aparecendo, no fim da lista.</div>
          <div id="admin-canais-body"><div style="color:var(--muted);font-size:max(9px, calc(12px * var(--escala-texto, 1)))">Carregando...</div></div>
```

- [ ] **Passo 2: importar o módulo no script**

Na linha de import que já traz `equipes.js`, acrescentar:

```js
import { gruposExistentes, agruparCanais, timePorCanal, contarSemGrupo, normalizarGrupo } from './grupo-do-canal.js'
```

- [ ] **Passo 3: escrever `loadAdminCanais`**

Colocar logo abaixo de `loadAdminEquipes`:

```js
/* ── CANAIS DE VENDA E SEUS GRUPOS ──────────────────────────────────────────
 *
 * O grupo do canal (atacado/varejo) é a fundação das outras três peças: o
 * seletor agrupado das dashboards, o alcance da supervisora e os cards de time
 * na lista de usuários leem TODOS daqui. Por isso ele se configura num lugar só.
 */
let _canaisComGrupo = []

async function loadAdminCanais() {
  const body = document.getElementById('admin-canais-body'); if (!body) return
  try {
    const [rc, rt] = await Promise.all([
      sbClient.from('bling_lojas').select('loja_id,nome,grupo').order('nome'),
      sbClient.from('equipes').select('id,nome,canal_loja_id'),
    ])
    // Erro de leitura NÃO vira lista vazia: "nenhum canal" quando a leitura
    // falhou é a mentira mais cara que uma tela conta.
    if (rc.error) throw new Error(rc.error.message)
    _canaisComGrupo = rc.data || []
    const mapaTimes = timePorCanal(rt.data || [])
    const grupos = gruposExistentes(_canaisComGrupo)
    const faltam = contarSemGrupo(_canaisComGrupo)

    let h = '<div class="adm-canais-topo">'
    h += '<span>' + _canaisComGrupo.length + (_canaisComGrupo.length === 1 ? ' canal' : ' canais') + '</span>'
    h += faltam ? '<span class="adm-canais-faltam">' + faltam + ' sem grupo</span>' : '<span class="adm-canais-ok">todos com grupo</span>'
    h += '</div>'

    for (const balde of agruparCanais(_canaisComGrupo)) {
      h += '<div class="adm-canais-grupo">' + escHtml(balde.grupo || 'Sem grupo') + '</div>'
      for (const c of balde.canais) {
        const t = mapaTimes.get(String(c.loja_id))
        h += '<div class="adm-canal-linha" data-canal="' + escHtml(String(c.loja_id)) + '">'
        h += '<div class="adm-canal-nome">' + escHtml(c.nome)
        h += t ? '<span class="adm-canal-time">time: ' + escHtml(t.nome) + '</span>' : '<span class="adm-canal-time adm-canal-sem">sem time</span>'
        h += '</div>'
        h += '<select class="adm-canal-sel" data-canal-sel="' + escHtml(String(c.loja_id)) + '">'
        h += '<option value="">— sem grupo —</option>'
        for (const g of grupos) h += '<option value="' + escHtml(g) + '"' + (normalizarGrupo(c.grupo) === g ? ' selected' : '') + '>' + escHtml(g) + '</option>'
        // SEM esta opção a pessoa TRAVA na hora em que precisa de um grupo novo.
        h += '<option value="__novo__">+ novo grupo…</option>'
        h += '</select>'
        h += '<span class="adm-canal-aviso" data-canal-aviso="' + escHtml(String(c.loja_id)) + '"></span>'
        h += '</div>'
      }
    }
    body.innerHTML = h
    _ligarSelecaoDeGrupo()
  } catch (e) {
    // Erro aparece ESCRITO. "Nenhum canal" quando a leitura falhou é a mentira
    // mais cara que uma tela conta. (`faixa-de-erro` é componente .vue e não
    // serve dentro de innerHTML — aqui vai texto com o token de erro.)
    body.innerHTML = '<div style="color:var(--red);font-family:var(--fonte-principal);font-size:max(9px, calc(12px * var(--escala-texto, 1)));">Não consegui carregar os canais: ' + escHtml(String(e && e.message || e)) + '</div>'
  }
}
```

- [ ] **Passo 4: escrever a gravação, com a conferência de linhas**

```js
function _ligarSelecaoDeGrupo() {
  document.querySelectorAll('[data-canal-sel]').forEach((sel) => {
    sel.onchange = async () => {
      const id = sel.getAttribute('data-canal-sel')
      const aviso = document.querySelector('[data-canal-aviso="' + id + '"]')
      let valor = sel.value
      if (valor === '__novo__') {
        // `window.prompt` e não um modal próprio: é o que ESTA MESMA TELA já usa
        // para criar perfil de acesso (linha ~1639). Inventar um modal só aqui
        // deixaria dois jeitos de pedir um nome no mesmo arquivo.
        const digitado = window.prompt('Nome do grupo novo (ex.: Atacado, Varejo)')
        valor = normalizarGrupo(digitado) || ''
        if (!valor) { await loadAdminCanais(); return }
      }
      const grupo = normalizarGrupo(valor)
      sel.disabled = true
      if (aviso) { aviso.textContent = 'Salvando…'; aviso.className = 'adm-canal-aviso' }
      try {
        const r = await adFetch('bling_lojas?loja_id=eq.' + encodeURIComponent(id), {
          method: 'PATCH',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify({ grupo }),
        })
        if (!r.ok) throw new Error(await r.text())
        // A CONFERÊNCIA QUE NÃO PODE FALTAR. Quando o RLS barra, o PostgREST
        // responde 200 com lista VAZIA — sem erro. Sem olhar a contagem, a tela
        // diria "salvo" para uma gravação que não aconteceu.
        const linhas = await r.json()
        if (!Array.isArray(linhas) || linhas.length === 0) {
          throw new Error('o banco aceitou o pedido e não gravou nada — provavelmente você não tem permissão para mudar o grupo do canal')
        }
        await loadAdminCanais()
        adminToast('Grupo do canal salvo.', true)
      } catch (e) {
        sel.disabled = false
        if (aviso) { aviso.textContent = String(e && e.message || e); aviso.className = 'adm-canal-aviso adm-canal-erro' }
      }
    }
  })
}
```

- [ ] **Passo 5: chamar no carregamento**

Onde `loadAdminEquipes()` já é chamado no carregamento da seção de usuários,
acrescentar `loadAdminCanais()` na mesma leva.

- [ ] **Passo 6: o CSS, só com token**

No `<style scoped>` da tela:

```css
.tela-admin :deep(.adm-canais-topo){display:flex;align-items:center;gap:var(--sp-2);margin-bottom:var(--sp-2);font-family:var(--fonte-principal);font-size:max(9px, calc(12px * var(--escala-texto, 1)));color:var(--muted);}
.tela-admin :deep(.adm-canais-faltam){color:var(--red);font-weight:600;}
.tela-admin :deep(.adm-canais-ok){color:var(--green);font-weight:600;}
.tela-admin :deep(.adm-canais-grupo){font-family:var(--fonte-principal);font-size:max(9px, calc(10px * var(--escala-texto, 1)));font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--muted);margin:var(--sp-4) 0 var(--sp-2);}
.tela-admin :deep(.adm-canal-linha){display:flex;align-items:center;gap:var(--sp-3);flex-wrap:wrap;padding:var(--sp-2) 0;border-bottom:1px solid var(--border);}
.tela-admin :deep(.adm-canal-nome){flex:1 1 220px;min-width:0;display:flex;flex-direction:column;gap:2px;font-family:var(--fonte-principal);font-size:max(9px, calc(13px * var(--escala-texto, 1)));color:var(--text);overflow-wrap:anywhere;}
.tela-admin :deep(.adm-canal-time){font-size:max(9px, calc(11px * var(--escala-texto, 1)));color:var(--muted);}
.tela-admin :deep(.adm-canal-sem){font-style:italic;}
.tela-admin :deep(.adm-canal-sel){flex:0 0 auto;min-height:40px;font-size:max(16px, calc(16px * var(--escala-texto, 1)));border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface2);color:var(--text);padding:0 var(--sp-2);}
.tela-admin :deep(.adm-canal-aviso){flex:1 1 100%;font-family:var(--fonte-principal);font-size:max(9px, calc(11px * var(--escala-texto, 1)));color:var(--muted);}
.tela-admin :deep(.adm-canal-erro){color:var(--red);}
```

`min-height:40px` e `font-size:16px` no `select` não são estética: é o alvo do
dedo e o zoom que o iOS dá quando a fonte do campo é menor que 16px.

- [ ] **Passo 7: build e suíte**

```bash
npm run build && npm run test:ci
```
Esperado: build sem erro; a suíte com os 10 testes novos da Tarefa 2 e nada
reprovando. **Se o total de testes cair, é arquivo sumindo — parar e investigar.**

- [ ] **Passo 8: medir a tela**

Abrir a Config de Admin a **375px** e a **1440px**, nos dois temas, e conferir os
quatro critérios do `PADRAO-DA-CENTRAL`: zero rolagem horizontal, alvo ≥ 40px,
fonte de campo ≥ 16px, nada de texto cortado.

- [ ] **Passo 9: commitar**

```bash
git add src/ferramentas/admin/tela-de-admin.vue
git commit -m "feat(admin): a secao Canais de venda, onde o grupo de cada canal se configura"
```

---

### Tarefa 4 — O grupo na ficha do time, em leitura, e a documentação

**Arquivos:**
- Modificar: `src/ferramentas/admin/tela-de-admin.vue` (a ficha do time,
  logo abaixo do campo "Canal no Bling", por volta da linha 903)
- Modificar: `src/ferramentas/admin/LEIA-ME.txt`
- Modificar: `docs/pendencias.md`

**Interfaces:**
- Consome da Tarefa 2: `normalizarGrupo`; e `_canaisComGrupo`, carregado na Tarefa 3.

- [ ] **Passo 1: mostrar o grupo herdado na ficha do time**

Logo depois da linha do `<select data-eq-campo="canal_loja_id" …>` e da explicação
que já existe:

```js
  // O time NÃO escolhe o grupo: ele herda do canal. Mostrar aqui, em leitura, é
  // o que torna a herança visível sem precisar explicar em texto.
  const canalDoTime = _canaisComGrupo.find(c => String(c.loja_id) === String(e.canal_loja_id))
  const grupoDoTime = canalDoTime ? normalizarGrupo(canalDoTime.grupo) : null
  h += '<label ' + rot + '>Grupo</label>'
  h += '<div style="font-size:max(9px, calc(12px * var(--escala-texto, 1)));color:var(--muted);">'
    + (grupoDoTime
        ? '<b>' + escHtml(grupoDoTime) + '</b> — vem do canal <b>' + escHtml(canalDoTime.nome) + '</b>. Para mudar, use a lista <b>Canais de venda</b> acima.'
        : (canalDoTime
            ? 'O canal <b>' + escHtml(canalDoTime.nome) + '</b> ainda não tem grupo. Marque na lista <b>Canais de venda</b> acima.'
            : 'Sem canal do Bling, o time não tem grupo.'))
    + '</div>'
```

- [ ] **Passo 2: build e suíte**

```bash
npm run build && npm run test:ci
```

- [ ] **Passo 3: conferir na tela que a herança aparece**

Abrir a ficha do time **Dom Pedro** depois de marcar o canal "Loja Dom Pedro"
como Varejo na lista nova. Esperado: a ficha diz *"Varejo — vem do canal Loja Dom
Pedro"*. É a prova de que a Peça 1 funcionou de ponta a ponta.

- [ ] **Passo 4: escrever no LEIA-ME do Admin**

Acrescentar ao fim de `src/ferramentas/admin/LEIA-ME.txt`:

```
O GRUPO DO CANAL — ATACADO / VAREJO (20/08/2026)
-------------------------------------------------
Cada canal do Bling tem um grupo (`bling_lojas.grupo`): Atacado, Varejo, ou
outro que o dono criar na tela. É texto, não lista travada no código — grupo
novo tem de ser digitação, não migration.

O GRUPO É DO CANAL, NÃO DO TIME, e isso foi medido: dos 14 canais do Bling só 3
têm time, e os 11 sem time aparecem no seletor das dashboards do mesmo jeito.
O time é atacado ou varejo pelo canal a que está amarrado; a ficha dele mostra
o grupo em leitura e manda configurar na lista "Canais de venda".

⚠️ `bling_lojas` só tinha política de LEITURA. A de escrita nasceu junto desta
peça (`bling_lojas_grupo_superadmin`, só superadmin). Sem ela a tela salvaria
sem salvar: o PostgREST responde 200 com lista VAZIA quando o RLS barra, sem
erro. Por isso a gravação aqui CONFERE a contagem de linhas devolvidas antes de
dizer "salvo" — não copie esta tela sem copiar essa conferência.

⚠️ Canal novo no Bling NÃO entra sozinho em `bling_lojas`: a tabela foi semeada
uma vez em 21/05/2026 e nada no repositório escreve nela. Canal criado no Bling
hoje não aparece nem aqui nem no seletor até alguém inserir a linha.

Quem lê o grupo: por enquanto, ninguém além desta tela. As Peças 2 (seletor
agrupado), 3 (alcance da supervisora) e 4 (usuários agrupados) leem daqui.
Spec: docs/superpowers/specs/2026-08-20-grupo-do-canal-design.md
```

- [ ] **Passo 5: registrar as três peças que ficaram**

Em `docs/pendencias.md`, na Parte B, antes de `## Parte C`, colar:

```markdown
### B24 · Separação atacado/varejo › faltam três das quatro peças 🟡 *aberto em 20/08*

A **Peça 1 está no ar**: cada canal do Bling tem um grupo (`bling_lojas.grupo`),
configurável em Config de Admin › Canais de venda. Ninguém lê esse grupo ainda
além da própria tela. Faltam:

- **Peça 2 — o seletor das dashboards agrupado.** O dropdown de canal passa a ter
  os blocos *Atacado* e *Varejo*, cada um com marcar/desmarcar todos, e um bloco
  *Outros* para canal sem grupo. Vale para Gestão à Vista e Análise de Vendas, que
  dividem a mesma regra. Só tela.
- **Peça 3 — o alcance da supervisora.** Hoje o recorte de canais **ignora o
  papel**: supervisora vê o mesmo que vendedora. Passa a ser: supervisora vê todos
  os canais do **grupo** dos times onde ela é supervisora; gerente (`gestor`) e
  vendedora seguem vendo só a loja delas. ⚠️ **Mexe em trava e precisa entrar em
  TRÊS lugares**: o módulo `_shared/canais-de-venda-permitidos.js`, a edge
  `bling-proxy` (que não sobe com push) e a função `pode_ver_canal` no banco. Só
  na tela não vale — foi esse buraco que se fechou em 13/08. Vai em sessão própria.
- **Peça 4 — Config de Usuários agrupada.** Os cards de time sob cabeçalhos de
  grupo, herdando do canal.

**O estoque não entra em nenhuma delas.** `pode_ver_estoque` tem regra própria e
mais apertada ("estar no time não basta"), escrita de propósito.

Spec: `docs/superpowers/specs/2026-08-20-grupo-do-canal-design.md`
```

- [ ] **Passo 6: commitar**

```bash
git add src/ferramentas/admin/tela-de-admin.vue src/ferramentas/admin/LEIA-ME.txt docs/pendencias.md
git commit -m "feat(admin): a ficha do time mostra o grupo que ela herda do canal"
```

---

## Conferência final, antes de dizer que acabou

- [ ] `npm run test:ci` inteiro passando, e o total **não caiu**
- [ ] `npm run build` sem erro
- [ ] Aberto no navegador a **375px** e a **1440px**, nos dois temas
- [ ] A prova da trava (`docs/provar-grupo-do-canal.sql`) rodada, com `UPDATE 1`
      e `UPDATE 0`, dentro de `rollback`
- [ ] Nenhum hex de cor novo, nenhum `style=` solto em botão
- [ ] Marcar um canal, recarregar a página e conferir que o grupo **continua lá**
      (a prova de que gravou de verdade, e não só na tela)
