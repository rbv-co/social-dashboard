# Stylist Circle — Edição como evento · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A edição do Stylist Circle vira o EVENTO de uma praça: turma = quem foi convidada, funil do evento com 3 marcas, Private Edit atribuído ao evento da 1ª presença para sempre, e "Indisponível na data" que volta sozinha na próxima edição.

**Architecture:** Regras puras em `src/ferramentas/comercial-vessel/edicao-regras.js` (testadas em node:test) espelham as regras do banco; o banco (Postgres/Supabase) ganha UMA migration nova com as colunas e as funções reescritas; o banco de mentira da demo (`src/demonstracao/banco-de-mentira.js`) espelha as mesmas funções; as telas Vue leem o que as funções devolvem. Produção só é gravada DEPOIS de o dono aprovar a demo publicada.

**Tech Stack:** Vue 3 (SFC), node:test, Postgres (Supabase), `pg` nos aplicadores `coletor/aplicar-*.mjs`, Vercel CLI (demo).

**Spec:** `docs/superpowers/specs/2026-09-28-stylist-circle-edicao-e-evento-design.md` (ler inteiro antes da 1ª linha).

## Global Constraints

- Ler `PADRAO-DA-CENTRAL.md` (obrigatório pelo CLAUDE.md) antes de tocar em tela: cor de token, três tipos de botão, texto nunca corta, medir a 375px em navegador de verdade.
- `coletor/.env` não vem no worktree: `cp ~/iamundi/coletor/.env coletor/.env` antes de rodar aplicador/testes.
- NUNCA `gh auth switch` / `vercel switch`.
- Worktree `arvores/edicao-e-evento` (branch `docs/edicao-e-evento`); NUNCA mexer no checkout principal `~/iamundi` (outra tarefa em andamento lá).
- Migration nova, SÓ ELA: `db/migrations/2026-09-28-zzzzzz-vessel-edicao-e-o-evento.sql` (o sufixo `zzzzzz` a ordena depois das de hoje). NUNCA rodar o runner de migrations (há pendentes zeradas — ver memória `project_iamundi_migrations_nao_registradas`).
- Aplicador `coletor/aplicar-vessel-edicao-e-o-evento.mjs`: sem `--gravar` faz ensaio e DESFAZ; com `--gravar` prova tudo e só então grava; aplica e registra na mesma transação; conta/stylist de prova em savepoint + `finally`. Copiar a forma de `coletor/aplicar-vessel-placar-da-edicao-conta-a-turma.mjs`.
- Ao reescrever uma função do banco, partir do CORPO MAIS RECENTE dela (grep em `db/migrations/*.sql`, pegar o último arquivo em ordem de nome), nunca de memória.
- Nenhuma stylist muda de etapa na migração dos dados. Contagem por etapa em 28/09: Stylist levantado 55, Validado 0, Conversa 0, Convidado 5, Confirmado 5, Presença 0, Ativada 0, Desclassificado 0 — igual antes e depois.
- Dia de evento é dia em São Paulo (`at time zone 'America/Sao_Paulo'` / `hojeEmSaoPaulo`).
- Texto de tela em português, frases do spec: "Nova edição", "Data do evento", "Abrir", "Encerrar", aviso "Para de aceitar convidadas.", "Incluir", "Tirar", "Sem evento", "Veio pelo evento: …", "Ainda sem evento", "Indisponíveis na data", "Voltou: indisponível na Edição N".
- Commits terminam com `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`; PR com `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. GitHub: `GH_TOKEN=$(gh auth token -u brenoov)`.
- Testes: `npm test`. As 38 falhas antigas de `coletor/lib/interesses.test.mjs` não são deste trabalho; nenhuma falha NOVA é aceita.

## Review Focus

1. Stylist presente em DUAS edições → o Private Edit conta só na 1ª presença (menor `presente_em`, desempate `edicao_id`); nunca em duas. Teste nas regras JS (Task 1) e mutação no aplicador (Task 2).
2. Voltar de etapa (Presença → Confirmado) NÃO apaga `presente_em`/`confirmou_em`. Teste no aplicador (Task 2) e no banco de mentira (Task 3).
3. Abrir a edição 2 com uma "Indisponível na data" que JÁ foi desativada (`ativa=false`) ou é `teste` → não volta. Teste no aplicador (Task 2).
4. Placar com 0 presentes → meta "—", nunca "0%". Teste nas regras JS (Task 1).
5. Mover para Convidado numa praça SEM edição aberta → nenhuma linha criada, nenhum erro. Teste no aplicador (Task 2).

---

### Task 1: Regras puras do evento (JS)

**Files:**
- Modify: `src/ferramentas/comercial-vessel/edicao-regras.js`
- Test: `src/ferramentas/comercial-vessel/edicao-regras.test.mjs`

**Interfaces:**
- Produces:
  - `eventoDeOrigem(linhas) → edicao_id | null` — `linhas` = `[{ edicao_id, presente_em }]` de UMA stylist.
  - `rotuloDoEncontro(encontro, origemPorStylist, edicoes) → string` — `origemPorStylist` = `{ [stylist_id]: edicao_id }`; devolve `rotuloDaEdicao(edicao)` ou `'Sem evento'`.
  - `funilDoEvento(turma, encontros, edicaoId) → { passos: [{ chave, rotulo, n, pct }], indisponiveis, meta: { pct, bateu } }` — `turma` = `[{ stylist_id, convidada_em, confirmou_em, presente_em, indisponivel_em, origem }]`, `encontros` = `[{ stylist_id, status, realizado_em }]`.
  - `edicaoDoEncontro` é REMOVIDA (e seus testes), substituída por `rotuloDoEncontro`.

- [ ] **Step 1: Escrever os testes que falham** (acrescentar ao arquivo de teste; apagar os testes de `edicaoDoEncontro`)

```js
import { eventoDeOrigem, rotuloDoEncontro, funilDoEvento } from './edicao-regras.js'

test('evento de origem = a 1ª presença; sem presença, nulo', () => {
  assert.equal(eventoDeOrigem([{ edicao_id: 2, presente_em: '2026-11-10T20:00:00Z' },
                               { edicao_id: 1, presente_em: '2026-10-15T22:00:00Z' }]), 1)
  assert.equal(eventoDeOrigem([{ edicao_id: 1, presente_em: null }]), null)
  assert.equal(eventoDeOrigem([]), null)
})

test('⚠️ presença no MESMO instante em duas edições: desempata pelo menor id', () => {
  assert.equal(eventoDeOrigem([{ edicao_id: 7, presente_em: '2026-10-15T22:00:00Z' },
                               { edicao_id: 5, presente_em: '2026-10-15T22:00:00Z' }]), 5)
})

test('o encontro leva o evento de origem da STYLIST, não a data', () => {
  const eds = [{ id: 46, praca_nome: 'Campinas', numero: 1 }]
  assert.equal(rotuloDoEncontro({ stylist_id: 9, quando: '2027-03-01T20:00:00Z' }, { 9: 46 }, eds), 'Campinas · Edição 1')
  assert.equal(rotuloDoEncontro({ stylist_id: 8, quando: '2026-10-20T20:00:00Z' }, { 9: 46 }, eds), 'Sem evento')
  assert.equal(rotuloDoEncontro({ stylist_id: null }, {}, eds), 'Sem evento')
})

const T = (o) => ({ convidada_em: '2026-10-01', confirmou_em: null, presente_em: null, indisponivel_em: null, origem: null, ...o })

test('funil do evento: cada passo sobre o anterior, e a meta é sobre as presentes', () => {
  const turma = [
    T({ stylist_id: 1, confirmou_em: 'x', presente_em: 'x', origem: 46 }),
    T({ stylist_id: 2, confirmou_em: 'x', presente_em: 'x', origem: 46 }),
    T({ stylist_id: 3, confirmou_em: 'x' }),
    T({ stylist_id: 4, indisponivel_em: 'x' }),
  ]
  const encontros = [{ stylist_id: 1, status: 'realizado', realizado_em: '2026-10-20' },
                     { stylist_id: 1, status: 'realizado', realizado_em: '2026-10-27' },
                     { stylist_id: 2, status: 'agendado', realizado_em: null }]
  const f = funilDoEvento(turma, encontros, 46)
  assert.deepEqual(f.passos.map((p) => [p.chave, p.n]),
    [['convidadas', 4], ['confirmaram', 3], ['presentes', 2], ['agendaram', 2], ['fizeram', 1], ['repetiram', 1]])
  assert.equal(f.indisponiveis, 1)
  assert.deepEqual(f.meta, { pct: 100, bateu: true })
})

test('⚠️ Private Edit de quem tem ORIGEM em outra edição não conta aqui', () => {
  const f = funilDoEvento([T({ stylist_id: 1, presente_em: 'x', confirmou_em: 'x', origem: 40 })],
    [{ stylist_id: 1, status: 'realizado', realizado_em: '2026-10-20' }], 46)
  assert.equal(f.passos.find((p) => p.chave === 'agendaram').n, 0)
})

test('⚠️ zero presentes: a meta é "—" (nulo), nunca 0%', () => {
  const f = funilDoEvento([T({ stylist_id: 1 })], [], 46)
  assert.deepEqual(f.meta, { pct: null, bateu: null })
  assert.equal(f.passos.find((p) => p.chave === 'agendaram').pct, null)
})

test('status em_planejamento não conta como agendou', () => {
  const f = funilDoEvento([T({ stylist_id: 1, presente_em: 'x', origem: 46 })],
    [{ stylist_id: 1, status: 'em_planejamento' }], 46)
  assert.equal(f.passos.find((p) => p.chave === 'agendaram').n, 0)
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test src/ferramentas/comercial-vessel/edicao-regras.test.mjs`
Expected: FAIL — `eventoDeOrigem` não exportada.

- [ ] **Step 3: Implementar** (em `edicao-regras.js`; apagar `edicaoDoEncontro`, `dia`, `diaDoInstante` se nada mais usar — conferir com `grep -rn "edicaoDoEncontro\|diaDoInstante" src`; atualizar o comentário do topo: a edição é o EVENTO, o encontro pertence ao evento de origem da stylist)

```js
export function eventoDeOrigem(linhas) {
  const com = (Array.isArray(linhas) ? linhas : []).filter((l) => l?.presente_em)
  if (!com.length) return null
  com.sort((a, b) => (new Date(a.presente_em) - new Date(b.presente_em)) || (a.edicao_id - b.edicao_id))
  return com[0].edicao_id
}

export function rotuloDoEncontro(encontro, origemPorStylist, edicoes) {
  const id = encontro?.stylist_id != null ? origemPorStylist?.[encontro.stylist_id] : null
  const ed = id != null ? (Array.isArray(edicoes) ? edicoes : []).find((e) => e.id === id) : null
  return ed ? rotuloDaEdicao(ed) : 'Sem evento'
}

const ROTULOS_DO_FUNIL = [
  ['convidadas', 'Convidadas'], ['confirmaram', 'Confirmaram'], ['presentes', 'Presentes'],
  ['agendaram', 'Agendaram Private Edit'], ['fizeram', 'Fizeram'], ['repetiram', 'Repetiram'],
]
const pct = (n, base) => (base > 0 ? Math.round((n / base) * 100) : null)

export function funilDoEvento(turma, encontros, edicaoId) {
  const t = Array.isArray(turma) ? turma : []
  const ev = Array.isArray(encontros) ? encontros : []
  const presentes = t.filter((s) => s.presente_em)
  const daqui = presentes.filter((s) => s.origem === edicaoId)
  const deles = (s) => ev.filter((e) => e.stylist_id === s.stylist_id)
  const realizados = (s) => deles(s).filter((e) => e.status === 'realizado').length
  const n = {
    convidadas: t.length,
    confirmaram: t.filter((s) => s.confirmou_em || s.presente_em).length,
    presentes: presentes.length,
    agendaram: daqui.filter((s) => deles(s).some((e) => e.status !== 'em_planejamento')).length,
    fizeram: daqui.filter((s) => realizados(s) >= 1).length,
    repetiram: daqui.filter((s) => realizados(s) >= 2).length,
  }
  const passos = ROTULOS_DO_FUNIL.map(([chave, rotulo], i) => ({
    chave, rotulo, n: n[chave], pct: i === 0 ? null : pct(n[chave], n[ROTULOS_DO_FUNIL[i - 1][0]]),
  }))
  const metaPct = pct(n.agendaram, n.presentes)
  return { passos, indisponiveis: t.filter((s) => s.indisponivel_em).length,
    meta: { pct: metaPct, bateu: metaPct == null ? null : metaPct >= 50 } }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test src/ferramentas/comercial-vessel/edicao-regras.test.mjs`
Expected: PASS. Depois `npm test` — nenhuma falha nova (quem importava `edicaoDoEncontro` quebra aqui: é a Task 4 que troca; se quebrar a compilação de teste de outra tela agora, trocar o import no mesmo commit para `rotuloDoEncontro`).

- [ ] **Step 5: Commit** — `feat(edição): regras puras do evento — origem, rótulo e funil`

---

### Task 2: Banco — migration + aplicador (ensaio, SEM gravar)

**Files:**
- Create: `db/migrations/2026-09-28-zzzzzz-vessel-edicao-e-o-evento.sql`
- Create: `coletor/aplicar-vessel-edicao-e-o-evento.mjs`
- Referência (ler, não editar): `db/migrations/2026-09-25-vessel-praca-e-edicao.sql`, `db/migrations/2026-09-28-vessel-placar-da-edicao-conta-a-turma.sql`, `db/migrations/2026-09-24-vessel-private-edit-so-com-stylist-liberada.sql` (corpo mais recente de `vessel_stylist_mover_de_etapa`), `coletor/aplicar-vessel-placar-da-edicao-conta-a-turma.mjs` (forma do aplicador).

**Interfaces:**
- Produces (funções do banco, as MESMAS que o banco de mentira da Task 3 imita, com os mesmos nomes e parâmetros):
  - colunas `vessel_stylist_na_edicao.convidada_em, confirmou_em, presente_em, indisponivel_em timestamptz`
  - coluna `vessel_stylist_motivos_de_saida.volta_na_proxima_edicao boolean not null default false` + motivo "Indisponível na data" (saída Desclassificado) com `true`
  - `vessel_evento_de_origem(p_stylist_id bigint) → bigint` (stable)
  - `vessel_eventos_de_origem() → table(stylist_id bigint, edicao_id bigint)` (para a tela do Private Edit)
  - `vessel_edicao_criar(p_praca_id, p_nome, p_comeca_em, p_termina_em)` — mesma assinatura; `p_termina_em` passa a ser ignorado (grava nulo)
  - `vessel_edicao_abrir(p_id)` → não puxa a praça; traz de volta as "Indisponível na data" da praça (ver spec) e devolve `{ ok, situacao, voltaram int }`
  - `vessel_edicao_encerrar(p_id, p_levar_para)` — mesma assinatura; `p_levar_para` não nulo → `{ ok:false, situacao:'levar_para_nao_existe_mais' }`; só muda situação
  - `vessel_edicao_incluir_stylist(p_codigo, p_edicao_id)` — mantida, grava `convidada_em = now()`
  - `vessel_edicao_tirar_stylist(p_codigo, p_edicao_id) → jsonb` — recusa `{ok:false, situacao:'ja_esteve_presente'}` se `presente_em` não nulo; senão apaga a linha
  - `vessel_edicao_turma(p_edicao_id) → table(stylist_id, codigo, nome, etapa_id, convidada_em, confirmou_em, presente_em, indisponivel_em, origem bigint)`
  - `vessel_placar_da_edicao(p_edicao_id)` → mesmo formato de hoje + `funil` (lista de passos igual à `funilDoEvento`), `indisponiveis`, `meta`
  - `vessel_stylist_mover_de_etapa(...)` — mesma assinatura; depois de mover, chama `vessel_edicao_marcar_movimento(v_stylist_id, v_etapa_nova, v_motivo_id)` (interna, `revoke` de anon/authenticated)
  - `vessel_stylist_sincronizar_edicao(...)` — deixa de tocar em `vessel_stylist_na_edicao` (corpo vira só o que não é turma; se só mexia em turma, vira `return;`)

- [ ] **Step 1: Escrever o aplicador com as provas ANTES da migration** (as provas falham porque as colunas/funções não existem). Provas, cada uma em `savepoint` que é desfeito, com stylist de prova `STY-PROVA-EVT-*` (`teste=true` NÃO serve — a turma filtra `teste`; usar `teste=false` e apagar no `rollback to savepoint`, conferido no `finally`):
  1. Mover para Convidado com edição aberta na praça → cria linha com `convidada_em`.
  2. Mover para Convidado numa praça SEM edição aberta → nenhuma linha, nenhum erro. *(Review Focus 5)*
  3. Mover para Confirmado → `confirmou_em`; para Presença → `presente_em`; voltar para Confirmado → `presente_em` continua. *(Review Focus 2)*
  4. Presente na edição A e depois na B → `vessel_evento_de_origem` = A; um Private Edit realizado dela conta em A e NÃO em B. *(Review Focus 1)*
  5. `vessel_edicao_abrir` numa praça com 30 ativas → turma continua vazia (não puxa a praça).
  6. Mover para Desclassificado com motivo "Indisponível na data" → `indisponivel_em`; abrir a próxima edição da praça → ela volta para Convidado, com linha nova e nota "Voltou: indisponível na Edição N" no histórico; uma segunda com o mesmo motivo mas `ativa=false` NÃO volta. *(Review Focus 3)*
  7. `vessel_edicao_tirar_stylist` recusa quem tem `presente_em`, apaga quem não tem.
  8. Mutação: trocar o desempate de origem para "maior presente_em" (em texto, dentro do savepoint, `create or replace` temporário) → a prova 4 tem de REPROVAR; desfazer.
  Mais as conferências de fora: contagem por etapa antes == depois; nenhuma `STY-PROVA-EVT-%` sobrando; migrations registradas +1.

- [ ] **Step 2: Rodar o ensaio e ver falhar**

Run: `node coletor/aplicar-vessel-edicao-e-o-evento.mjs`
Expected: FAIL nas provas (coluna `convidada_em` não existe).

- [ ] **Step 3: Escrever a migration**, nesta ordem, com comentário curto do porquê em cada seção (padrão da casa):
  1. colunas novas (`add column if not exists`) e o motivo novo (`insert … where not exists`);
  2. `vessel_evento_de_origem` / `vessel_eventos_de_origem`:
     ```sql
     create or replace function public.vessel_evento_de_origem(p_stylist_id bigint)
     returns bigint language sql stable security definer set search_path = public as $$
       select n.edicao_id from public.vessel_stylist_na_edicao n
        where n.stylist_id = p_stylist_id and n.presente_em is not null
        order by n.presente_em, n.edicao_id limit 1
     $$;
     ```
  3. `vessel_edicao_marcar_movimento(p_stylist_id, p_etapa_id, p_motivo_id)`: acha a edição `aberta` da praça da stylist; se a etapa nova é Convidado ou posterior no funil (`tipo='funil'` e `ordem >= ordem de Convidado`) e não há linha → `insert` com `convidada_em=now()`; Confirmado → `confirmou_em = coalesce(confirmou_em, now())` (e `convidada_em` também, se pulou); Presença → `presente_em = coalesce(presente_em, now())` (e as anteriores por coalesce); saída com motivo `volta_na_proxima_edicao` → `indisponivel_em = coalesce(indisponivel_em, now())`. Nunca apaga marca. Etapas achadas pelo NOME atual ("Convidado", "Confirmado", "Presença") via uma consulta só no topo — se alguma não existir, a função não marca nada (e o aplicador prova que existem).
  4. `vessel_stylist_mover_de_etapa`: corpo mais recente + a chamada ao final.
  5. `vessel_stylist_sincronizar_edicao`: parar de mexer em turma.
  6. `vessel_edicao_abrir` sem puxar praça + a volta das indisponíveis (mover pelo `vessel_stylist_mover_de_etapa` NÃO — ele exige permissão do usuário; mover direto na tabela + `insert` no histórico com a mesma forma que o mover grava, e depois `vessel_edicao_marcar_movimento`).
  7. `vessel_edicao_encerrar`, `vessel_edicao_incluir_stylist` (grava `convidada_em`), `vessel_edicao_tirar_stylist` (nova, mesmas permissões de `incluir`), `vessel_edicao_turma`, `vessel_placar_da_edicao` (funil pela mesma regra da Task 1), `vessel_edicoes_listar` (acrescentar `indisponiveis`).
  8. **Dados da Edição 1 (id 46)**: `delete` das linhas de quem está em "Stylist levantado"; para as que ficam, `convidada_em` = 1ª chegada em Convidado no `vessel_stylist_etapas_historico` (ou a de Confirmado, se pulou) e `confirmou_em` = 1ª chegada em Confirmado. Conferir: sobram 10.
  9. `grant execute` iguais aos das irmãs; `revoke` das internas.

- [ ] **Step 4: Rodar o ensaio e ver passar**

Run: `node coletor/aplicar-vessel-edicao-e-o-evento.mjs`
Expected: todas as provas ✅, "ENSAIO — nada gravado". **NÃO rodar `--gravar` aqui** (é a Task 6, depois da aprovação da demo).

- [ ] **Step 5: Commit** — `feat(banco): a edição é o evento — marcas da turma, origem e indisponível (migration + aplicador, não gravada)`

---

### Task 3: Banco de mentira da demo

**Files:**
- Modify: `src/demonstracao/banco-de-mentira.js` (funções `vessel_edicao_*`, `vessel_placar_da_edicao`, `vessel_stylist_mover_de_etapa` ~linhas 792, 1427–1600)
- Modify: `src/demonstracao/dados-iniciais.js` (Edição 1 com data do evento, turma de exemplo com as 3 marcas e uma "Indisponível na data"; motivo novo)
- Modify: `src/demonstracao/roteiro.js` (passo do roteiro: mover para Presença e ver o placar subir; mover para Desclassificado com "Indisponível na data")
- Test: `src/demonstracao/*.test.mjs` existentes + acrescentar em `src/demonstracao/banco-de-mentira.test.mjs` (criar se não existir, no estilo node:test)

**Interfaces:**
- Consumes: `eventoDeOrigem`, `funilDoEvento` da Task 1 (importar, NÃO copiar a regra); nomes/formatos das funções da Task 2.

- [ ] **Step 1: Testes que falham** — no banco de mentira: (a) mover para Convidado com edição aberta cria linha; (b) Presença → Confirmado não apaga `presente_em`; (c) abrir edição 2 traz de volta a indisponível e deixa a desativada; (d) `vessel_placar_da_edicao` devolve `funil` igual a `funilDoEvento(...)` dos mesmos dados; (e) `vessel_edicao_tirar_stylist` recusa presente; (f) `vessel_eventos_de_origem` devolve a 1ª presença.
- [ ] **Step 2:** `node --test src/demonstracao/` → FAIL.
- [ ] **Step 3:** Implementar espelhando a Task 2 (função desconhecida continua devolvendo "não encontrada", regra da casa).
- [ ] **Step 4:** `node --test src/demonstracao/` → PASS; `npm test` sem falha nova.
- [ ] **Step 5: Commit** — `feat(demo): banco de mentira com a edição como evento`

---

### Task 4: Telas

**Files:**
- Modify: `src/ferramentas/comercial-vessel/tela-de-edicoes.vue` (criar: praça + "Data do evento", sem data de fim; Abrir / Encerrar com "Para de aceitar convidadas."; lista `vessel_edicao_turma` com as 3 marcas + "Indisponível na data"; Incluir / Tirar; placar com o funil, % e meta verde/âmbar/"—", e "Indisponíveis na data: N")
- Modify: `src/ferramentas/comercial-vessel/tela-de-private-edit.vue` (etiqueta por `rotuloDoEncontro` com `vessel_eventos_de_origem`; "fora de edição" some)
- Modify: `src/ferramentas/comercial-vessel/ficha-da-stylist.vue` ("Veio pelo evento: Edição 1 · Campinas · 15/10" / "Ainda sem evento" / "Voltou: indisponível na Edição N")
- Modify: `src/ferramentas/comercial-vessel/placar-do-stylist-circle.vue`, `tela-de-stylist-circle.vue`, `barra-de-praca-e-edicao.vue` (só o que referenciar janela/termina_em/edicaoDoEncontro — conferir com grep)
- Test: `src/ferramentas/comercial-vessel/guardas-da-tela.test.mjs` (acrescentar: nenhuma tela contém "fora de edição" nem pede "termina_em"; `tela-de-edicoes.vue` chama `vessel_edicao_tirar_stylist` e `vessel_edicao_turma`)

- [ ] **Step 1:** Testes de guarda que falham (acima). **Provar por mutação** que a guarda pega o erro (memória `feedback_guarda_por_substring_nao_prova_aninhamento`): recolocar "fora de edição" num `.vue` e ver o teste reprovar.
- [ ] **Step 2:** `node --test src/ferramentas/comercial-vessel/guardas-da-tela.test.mjs` → FAIL.
- [ ] **Step 3:** Implementar as telas usando SÓ componentes/classes da casa (`estilo-comercial.css`, `cv-identidade`, tokens `--cor-stylist-circle`) — nada de classe inventada (memória `feedback_tela_nova_sem_os_componentes_da_casa`). Responsivo 375/390/430 e 1440.
- [ ] **Step 4:** `npm test` sem falha nova; `npm run build` passa.
- [ ] **Step 5: Commit** — `feat(telas): edição como evento — turma, funil, origem no Private Edit e na ficha`

---

### Task 5: Demo publicada + portão do dono

**Files:** nenhum novo (roteiro já na Task 3).

- [ ] **Step 1:** `npm run publicar:demonstracao` (login do CLI em `~/.vercel-iamundi`, conta brenoov; NUNCA ligar o projeto `vessel-demonstracao` ao Git).
- [ ] **Step 2:** `DEMO=https://vessel-demonstracao.vercel.app PLAYWRIGHT=<playwright-core> node src/demonstracao/passeio-pelas-ferramentas.mjs` → APROVADO, 0 pedidos ao Supabase.
- [ ] **Step 3:** Fotos 390px e 1440px de: tela de Edições (turma + funil), Private Edit (etiqueta), ficha (linha do evento), saída com "Indisponível na data".
- [ ] **Step 4: PARAR.** Mandar ao dono o link da demo + o que conferir. Nada vai a produção sem o "ok" dele.

---

### Task 6: Produção (só depois do ok da demo)

- [ ] **Step 1:** `node coletor/aplicar-vessel-edicao-e-o-evento.mjs` (ensaio de novo, contra o banco de HOJE — a Ionara move stylists durante o dia) → tudo ✅.
- [ ] **Step 2:** `node coletor/aplicar-vessel-edicao-e-o-evento.mjs --gravar` → gravado e registrado.
- [ ] **Step 3:** PR da branch `docs/edicao-e-evento` → merge na main; deploy da Central conforme memória `project_iamundi_deploy` (sem edge function nova neste trabalho).
- [ ] **Step 4:** Conferir: Edição 1 com turma de 10 e as marcas com as datas do histórico; contagem por etapa idêntica à de antes; placar lido como o usuário do dono; Central em produção abrindo as 3 telas (Playwright com respostas de mentira, como no PR #265).
- [ ] **Step 5 (pedido do dono, 28/09):** listar, só leitura, toda stylist em Desclassificado que esteve na turma da Edição 1 (id 46) ou foi desclassificada a partir de 28/09, com código, nome, motivo atual, quem moveu e quando (`vessel_stylist_etapas_historico`). Entregar a lista ao dono em múltipla escolha, para ele dizer quais foram por indisponibilidade na data. Só depois de ele responder, trocar o motivo delas para "Indisponível na data" pela função do sistema.
- [ ] **Step 6:** Remover o worktree; atualizar a memória `project_vessel_t11_bases_stylist_circle`.
