# Stylist Circle — CRM da jornada e cartão da convidada · Plano de construção

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Somar à T11 o quadro por etapas com histórico de contatos da stylist e o gerador de cartão (PNG) + mensagem com link individual e rastreado para cada convidada do Private Edit.

**Architecture:** Tudo no banco entra NO MESMO arquivo da T11 (`db/migrations/2026-09-22-vessel-t11-bases-do-stylist-circle.sql`, ainda não aplicado) e no mesmo aplicador, que ganha as provas novas. A Central (Vue, `src/ferramentas/comercial-vessel/`) ganha regras puras testadas + três componentes (quadro, ficha, cartão). O site (`~/iamundi/vessel-brasil`) ganha a rota `/pe/<encontro>/<convidada>` e o fluxo personalizado da página do convite.

**Tech Stack:** Postgres/Supabase (plpgsql, RPC via PostgREST), Vue 3 `<script setup>`, `node --test`, canvas 2D, Playwright (laboratório de fotos fora do repo).

**Spec:** `docs/superpowers/specs/2026-09-22-stylist-circle-crm-e-cartao-design.md`

## Global Constraints

- Ler `PADRAO-DA-CENTRAL.md` antes de qualquer tela: cor só por token, três classes de botão, texto nunca corta, 375px sem rolagem horizontal, alvo ≥40px, campo ≥16px, tamanho de letra só da escala `--texto-*`.
- Modal: `v-trava-rolagem` (já registrada em `src/ponto-de-partida.js`), fundo `rgba(0,0,0,.55)` com `touch-action:none; overscroll-behavior:contain`, caixa ≤420px no computador e `calc(100dvh - 24px)` com 12px de margem no celular, pendurado DENTRO da raiz da tela.
- Toda função nova: `revoke all ... from public, anon` e `grant execute ... to authenticated` (as duas públicas do convite: `to anon, authenticated`).
- Trava de mexer = `is_vessel_atendimentos_editar()`; trava de ver = `is_vessel_atendimentos()`.
- Nunca `git add <pasta>`: arquivo por arquivo. Worktree `~/iamundi/arvores/t11-stylist-circle`, branch `feat/t11-bases-stylist-circle`.
- O aplicador roda SEM `--gravar` até a Task 9. Nenhuma escrita em dado real.
- Página pública mostra só o PRIMEIRO nome da convidada.
- Mensagens (texto exato, aprovado em 22/09/2026):
  - stylist: `[nome], estou preparando uma VESSEL Private Edit para um pequeno grupo de clientes. Vou apresentar uma seleção de bolsas sob o meu olhar, com a equipe da VESSEL à disposição. Será em [data], às [horário], em [local]. Gostaria muito de ter você comigo. Confirme sua presença por aqui: [link]`
  - equipe: `[nome], a [stylist] está preparando uma VESSEL Private Edit para um pequeno grupo de clientes e gostaria muito de ter você com ela. Será em [data], às [horário], em [local], com uma seleção de bolsas preparada pela [stylist] e a equipe da VESSEL à disposição. Confirme sua presença por aqui: [link]`

---

## Mapa de arquivos

| Arquivo | Papel |
|---|---|
| `db/migrations/2026-09-22-vessel-t11-bases-do-stylist-circle.sql` (modificar) | + blocos 13 (contatos) e 14 (convite individual); rastreio/placar/convidar/convidadas/para_escolher ganham campos |
| `coletor/aplicar-vessel-t11-bases-do-stylist-circle.mjs` (modificar) | + portas novas na lista e as provas do CRM e do convite |
| `src/ferramentas/comercial-vessel/crm-da-stylist-regras.js` (+ `.test.mjs`) | canais, resultados, sugestão de etapa, colunas do quadro, prazo atrasado, "há N dias" |
| `src/ferramentas/comercial-vessel/quadro-do-stylist-circle.vue` | o quadro (colunas / uma etapa por vez no celular) |
| `src/ferramentas/comercial-vessel/ficha-da-stylist.vue` | modal: resumo, registrar contato, histórico, sugestão |
| `src/ferramentas/comercial-vessel/tela-de-stylist-circle.vue` (modificar) | abas Quadro/Lista, liga quadro e ficha, número novo no placar |
| `src/ferramentas/comercial-vessel/convite-da-convidada-regras.js` (+ `.test.mjs`) | primeiro nome, link, data e hora, mensagens, WhatsApp, nome do arquivo, linhas do PNG |
| `src/ferramentas/comercial-vessel/desenhar-convite.js` | canvas do PNG |
| `public/cartao-private-edit/` | `fundo.png`, `logomarca-escura.png`, `fontes/*.woff2` copiados do site |
| `src/ferramentas/comercial-vessel/cartao-da-convidada.vue` | modal "Cartão e mensagem" |
| `src/ferramentas/comercial-vessel/tela-de-private-edit.vue` (modificar) | botão por convidada, "abriu o convite" |
| `~/iamundi/vessel-brasil/regras-da-private-edit.mjs` (+ teste) | `convidadaDoEndereco` |
| `~/iamundi/vessel-brasil/vercel.json`, `private-edit/index.html` | rota e fluxo personalizado |

---

### Task 1: Regras do CRM (JS puro)

**Files:**
- Create: `src/ferramentas/comercial-vessel/crm-da-stylist-regras.js`
- Test: `src/ferramentas/comercial-vessel/crm-da-stylist-regras.test.mjs`

**Interfaces:**
- Consumes: `ESTAGIOS_DA_STYLIST` de `./t11-regras.js`.
- Produces: `CANAIS`, `RESULTADOS`, `FLUXO_PRINCIPAL`, `SAIDAS`, `sugestaoDeEtapa(resultado, estagio, ativadaEm) → string|null`, `proximaEtapaManual(estagio) → string|null`, `reabrirPara(ativadaEm) → 'prospectado'|'sem_retorno'`, `colunasDoQuadro(lista, hoje) → { [etapa]: stylist[], saidas: stylist[] }`, `prazoAtrasado(prazo, hoje) → boolean`, `ultimoContatoEscrito(iso, agora) → string`.

- [ ] **Step 1: Escrever o teste**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  CANAIS, RESULTADOS, FLUXO_PRINCIPAL, SAIDAS, sugestaoDeEtapa, proximaEtapaManual,
  reabrirPara, colunasDoQuadro, prazoAtrasado, ultimoContatoEscrito,
} from './crm-da-stylist-regras.js'
import { ESTAGIOS_DA_STYLIST } from './t11-regras.js'

const MIGRATION = readFileSync(new URL(
  '../../../db/migrations/2026-09-22-vessel-t11-bases-do-stylist-circle.sql', import.meta.url), 'utf8')
const lista = (nome) => {
  const i = MIGRATION.indexOf(`constraint ${nome}`)
  assert.ok(i >= 0, `não achei ${nome}`)
  return [...MIGRATION.slice(i, MIGRATION.indexOf(')', MIGRATION.indexOf('(', MIGRATION.indexOf('in', i))) + 1)
    .matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
}

test('canais e resultados são os CHECK do banco', () => {
  assert.deepEqual(Object.keys(CANAIS).sort(), lista('vessel_stylist_contatos_canal_valido').sort())
  assert.deepEqual(Object.keys(RESULTADOS).sort(), lista('vessel_stylist_contatos_resultado_valido').sort())
})

test('fluxo + saídas = os onze estágios', () => {
  assert.deepEqual([...FLUXO_PRINCIPAL, ...SAIDAS].sort(), Object.keys(ESTAGIOS_DA_STYLIST).sort())
})

test('sugestão: só para a frente', () => {
  assert.equal(sugestaoDeEtapa('conversou', 'prospectado', null), 'contatado')
  assert.equal(sugestaoDeEtapa('interesse', 'contatado', null), 'interessado')
  assert.equal(sugestaoDeEtapa('proposta', 'prospectado', null), 'em_negociacao')
  assert.equal(sugestaoDeEtapa('conversou', 'interessado', null), null)
  assert.equal(sugestaoDeEtapa('sem_resposta', 'prospectado', null), null)
  assert.equal(sugestaoDeEtapa('marcou_encontro', 'em_negociacao', null), null)
})

test('sugestão: nunca em pausado/inativo nem depois do encontro', () => {
  for (const e of ['pausado', 'inativo']) assert.equal(sugestaoDeEtapa('conversou', e, null), null)
  assert.equal(sugestaoDeEtapa('conversou', 'ativado', 'x'), null)
  assert.equal(sugestaoDeEtapa('recusou', 'recorrente', 'x'), null)
})

test('sugestão: recusou vai para Não interessado só antes do encontro', () => {
  assert.equal(sugestaoDeEtapa('recusou', 'contatado', null), 'nao_interessado')
  assert.equal(sugestaoDeEtapa('recusou', 'nao_interessado', null), null)
})

test('sugestão: quem estava em Sem retorno e voltou a conversar é sugerida de volta', () => {
  assert.equal(sugestaoDeEtapa('conversou', 'sem_retorno', null), 'contatado')
  assert.equal(sugestaoDeEtapa('conversou', 'sem_retorno', 'x'), null)
})

test('a sugestão do banco é a mesma tabela', () => {
  const i = MIGRATION.indexOf('function public.vessel_stylist_sugestao_de_etapa')
  const corpo = MIGRATION.slice(i, MIGRATION.indexOf('$$;', i))
  for (const [r, e] of [['conversou', 'contatado'], ['interesse', 'interessado'],
    ['proposta', 'em_negociacao'], ['recusou', 'nao_interessado']]) {
    assert.match(corpo, new RegExp(`'${r}'[^\\n]*'${e}'`), `${r} → ${e} não está no banco`)
  }
})

test('avançar só existe nas etapas manuais', () => {
  assert.equal(proximaEtapaManual('prospectado'), 'contatado')
  assert.equal(proximaEtapaManual('contatado'), 'interessado')
  assert.equal(proximaEtapaManual('interessado'), 'em_negociacao')
  for (const e of ['em_negociacao', 'ativado', 'recorrente', 'pausado']) assert.equal(proximaEtapaManual(e), null)
})

test('reabrir: volta ao começo, ou ao fato se já teve encontro', () => {
  assert.equal(reabrirPara(null), 'prospectado')
  assert.equal(reabrirPara('2026-09-01T00:00:00Z'), 'sem_retorno')
})

test('colunas: cada stylist numa coluna, atrasadas primeiro', () => {
  const c = colunasDoQuadro([
    { codigo: 'A', nome: 'Ana', estagio: 'contatado', proxima_acao_em: '2026-09-30' },
    { codigo: 'B', nome: 'Bia', estagio: 'contatado', proxima_acao_em: '2026-09-10' },
    { codigo: 'C', nome: 'Cris', estagio: 'pausado' },
    { codigo: 'D', nome: 'Duda', estagio: 'recorrente' },
  ], '2026-09-22')
  assert.deepEqual(c.contatado.map((s) => s.codigo), ['B', 'A'])
  assert.deepEqual(c.saidas.map((s) => s.codigo), ['C'])
  assert.deepEqual(c.recorrente.map((s) => s.codigo), ['D'])
  assert.deepEqual(c.prospectado, [])
})

test('prazo atrasado é antes de hoje, não hoje', () => {
  assert.equal(prazoAtrasado('2026-09-21', '2026-09-22'), true)
  assert.equal(prazoAtrasado('2026-09-22', '2026-09-22'), false)
  assert.equal(prazoAtrasado(null, '2026-09-22'), false)
})

test('último contato escrito', () => {
  const agora = new Date('2026-09-22T15:00:00-03:00')
  assert.equal(ultimoContatoEscrito(null, agora), 'nenhum contato registrado')
  assert.equal(ultimoContatoEscrito('2026-09-22T09:00:00-03:00', agora), 'último contato hoje')
  assert.equal(ultimoContatoEscrito('2026-09-21T20:00:00-03:00', agora), 'último contato ontem')
  assert.equal(ultimoContatoEscrito('2026-09-19T10:00:00-03:00', agora), 'último contato há 3 dias')
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test src/ferramentas/comercial-vessel/crm-da-stylist-regras.test.mjs`
Expected: FAIL — `Cannot find module './crm-da-stylist-regras.js'`.

- [ ] **Step 3: Implementar**

```js
/* AS REGRAS DO CRM DA STYLIST — o quadro por etapas e o histórico de contatos.
 *
 * ⚠️ AS LISTAS SÃO ESPELHO DOS CHECK DE `vessel_stylist_contatos`, e a
 * sugestão de etapa é espelho de `vessel_stylist_sugestao_de_etapa`. O teste
 * lê a migration: se um lado mudar sozinho, a suíte reprova.
 *
 * ⚠️ A SUGESTÃO NUNCA MUDA NADA: a tela oferece "Mover para X?" e a Ionara
 * decide (decisão do dono, 22/09/2026).
 */
export const CANAIS = {
  whatsapp: 'WhatsApp', ligacao: 'Ligação', instagram: 'Instagram', email: 'E-mail', presencial: 'Presencial',
}
export const RESULTADOS = {
  sem_resposta: 'Sem resposta', conversou: 'Conversou', interesse: 'Demonstrou interesse',
  proposta: 'Pediu proposta', marcou_encontro: 'Marcou encontro', recusou: 'Recusou',
}
export const FLUXO_PRINCIPAL = ['prospectado', 'contatado', 'interessado', 'em_negociacao',
  'ativado', 'evento_realizado', 'recorrente']
export const SAIDAS = ['sem_retorno', 'nao_interessado', 'pausado', 'inativo']

const SUGERE = { conversou: 'contatado', interesse: 'interessado', proposta: 'em_negociacao' }
const MANUAL = { prospectado: 'contatado', contatado: 'interessado', interessado: 'em_negociacao' }

export function sugestaoDeEtapa(resultado, estagio, ativadaEm) {
  if (estagio === 'pausado' || estagio === 'inativo') return null
  if (resultado === 'recusou') return !ativadaEm && estagio !== 'nao_interessado' ? 'nao_interessado' : null
  const alvo = SUGERE[resultado]
  if (!alvo) return null
  // Quem saiu por "sem retorno" ou "não interessado" e voltou a conversar
  // volta ao funil — desde que ainda não tenha tido encontro.
  if (estagio === 'sem_retorno' || estagio === 'nao_interessado') return ativadaEm ? null : alvo
  const de = FLUXO_PRINCIPAL.indexOf(estagio)
  const para = FLUXO_PRINCIPAL.indexOf(alvo)
  return de >= 0 && para > de ? alvo : null
}

export function proximaEtapaManual(estagio) {
  return MANUAL[estagio] || null
}

/** Reabrir uma Saída. Quem já teve encontro volta pelo fato: "sem_retorno"
 * faz o gatilho do banco recalcular a etapa a partir dos encontros. */
export function reabrirPara(ativadaEm) {
  return ativadaEm ? 'sem_retorno' : 'prospectado'
}

export function prazoAtrasado(prazo, hoje) {
  return !!prazo && String(prazo).slice(0, 10) < String(hoje).slice(0, 10)
}

export function colunasDoQuadro(lista, hoje) {
  const colunas = Object.fromEntries(FLUXO_PRINCIPAL.map((e) => [e, []]))
  colunas.saidas = []
  for (const s of Array.isArray(lista) ? lista : []) {
    const destino = SAIDAS.includes(s?.estagio) ? 'saidas' : (colunas[s?.estagio] ? s.estagio : 'prospectado')
    colunas[destino].push(s)
  }
  const ordem = (a, b) => {
    const aa = prazoAtrasado(a.proxima_acao_em, hoje), bb = prazoAtrasado(b.proxima_acao_em, hoje)
    if (aa !== bb) return aa ? -1 : 1
    const pa = a.proxima_acao_em || '9999', pb = b.proxima_acao_em || '9999'
    if (pa !== pb) return pa < pb ? -1 : 1
    return String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR')
  }
  for (const k of Object.keys(colunas)) colunas[k].sort(ordem)
  return colunas
}

const diaLocal = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
export function ultimoContatoEscrito(iso, agora = new Date()) {
  if (!iso) return 'nenhum contato registrado'
  const dias = Math.round((diaLocal(agora) - diaLocal(new Date(iso))) / 86400000)
  if (dias <= 0) return 'último contato hoje'
  if (dias === 1) return 'último contato ontem'
  return `último contato há ${dias} dias`
}
```

- [ ] **Step 4: Rodar** — os testes que leem a migration AINDA FALHAM (os CHECK e a função de sugestão só existem depois da Task 2). Os demais passam. Seguir para a Task 2 sem commitar.

---

### Task 2: Banco do CRM (no mesmo arquivo da T11) + provas

**Files:**
- Modify: `db/migrations/2026-09-22-vessel-t11-bases-do-stylist-circle.sql` (novo bloco 13 antes do bloco 12 "AS PORTAS"; rastreio e placar ganham campos)
- Modify: `coletor/aplicar-vessel-t11-bases-do-stylist-circle.mjs`

**Interfaces:**
- Produces (RPC):
  - `vessel_stylist_registrar_contato(p_codigo text, p_canal text, p_resultado text, p_nota text default null, p_proxima_acao text default null, p_proxima_acao_em date default null) → {ok, situacao, id?, sugestao?}`; situações: `sem_permissao | nao_achei | canal_invalido | resultado_invalido | nota_longa | ok`.
  - `vessel_stylist_contatos(p_codigo text) → [{id, canal, resultado, nota, criado_em, criado_por_nome}]` (vazio sem permissão).
  - `vessel_rastreio_dos_stylists` ganha `contatos int`, `ultimo_contato_em timestamptz`.
  - `vessel_placar_do_stylist_circle` ganha `contatos_ate_ativar numeric|null`, `stylists_com_contatos_ate_ativar int`.

- [ ] **Step 1: Escrever o bloco 13 na migration** (inserir logo antes da linha `-- ── 12. AS PORTAS`)

```sql
-- ── 13. O CRM DA STYLIST: o histórico de contatos ───────────────────────────

-- ⚠️ UMA LINHA POR CONTATO, E NUNCA SE EDITA NEM APAGA: é o registro do que
-- aconteceu. Errou a nota? Registra outro contato corrigindo.
create table if not exists public.vessel_stylist_contatos (
  id              bigserial primary key,
  stylist_id      bigint not null references public.vessel_stylists(id) on delete cascade,
  canal           text not null,
  resultado       text not null,
  nota            text,
  criado_em       timestamptz not null default now(),
  criado_por      uuid,
  criado_por_nome text,
  teste           boolean not null default false,
  constraint vessel_stylist_contatos_canal_valido
    check (canal in ('whatsapp', 'ligacao', 'instagram', 'email', 'presencial')),
  constraint vessel_stylist_contatos_resultado_valido
    check (resultado in ('sem_resposta', 'conversou', 'interesse', 'proposta', 'marcou_encontro', 'recusou')),
  constraint vessel_stylist_contatos_nota_curta check (nota is null or length(nota) <= 500)
);
create index if not exists vessel_stylist_contatos_stylist_idx
  on public.vessel_stylist_contatos (stylist_id, criado_em desc);
alter table public.vessel_stylist_contatos enable row level security;
revoke all on table public.vessel_stylist_contatos from anon, authenticated;

-- ⚠️ A MESMA TABELA DE `sugestaoDeEtapa` (crm-da-stylist-regras.js); o teste
-- de lá lê este corpo.
create or replace function public.vessel_stylist_sugestao_de_etapa(
  p_resultado text, p_estagio text, p_ativada timestamptz)
returns text
language sql
immutable
as $$
  select case
    when p_estagio in ('pausado', 'inativo') then null
    when p_resultado = 'recusou' then
      case when p_ativada is null and p_estagio <> 'nao_interessado' then 'nao_interessado' end
    else (
      with alvo as (select case p_resultado
                             when 'conversou' then 'contatado'
                             when 'interesse' then 'interessado'
                             when 'proposta'  then 'em_negociacao' end as a)
      select case
        when a is null then null
        when p_estagio in ('sem_retorno', 'nao_interessado') then case when p_ativada is null then a end
        when array_position(array['prospectado','contatado','interessado','em_negociacao',
                                  'ativado','evento_realizado','recorrente'], a)
           > coalesce(array_position(array['prospectado','contatado','interessado','em_negociacao',
                                  'ativado','evento_realizado','recorrente'], p_estagio), 99)
          then a
      end from alvo)
  end
$$;
revoke all on function public.vessel_stylist_sugestao_de_etapa(text, text, timestamptz) from public, anon;

create or replace function public.vessel_stylist_registrar_contato(
  p_codigo text, p_canal text, p_resultado text, p_nota text default null,
  p_proxima_acao text default null, p_proxima_acao_em date default null)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_codigo text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
  v_canal  text := lower(nullif(trim(coalesce(p_canal, '')), ''));
  v_res    text := lower(nullif(trim(coalesce(p_resultado, '')), ''));
  v_nota   text := nullif(trim(coalesce(p_nota, '')), '');
  v_s      public.vessel_stylists%rowtype;
  v_id     bigint;
begin
  if not public.is_vessel_atendimentos_editar() then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  select * into v_s from public.vessel_stylists where codigo = v_codigo;
  if v_s.id is null then return json_build_object('ok', false, 'situacao', 'nao_achei'); end if;
  if v_canal is null or v_canal not in ('whatsapp', 'ligacao', 'instagram', 'email', 'presencial') then
    return json_build_object('ok', false, 'situacao', 'canal_invalido');
  end if;
  if v_res is null or v_res not in ('sem_resposta', 'conversou', 'interesse', 'proposta', 'marcou_encontro', 'recusou') then
    return json_build_object('ok', false, 'situacao', 'resultado_invalido');
  end if;
  if v_nota is not null and length(v_nota) > 500 then
    return json_build_object('ok', false, 'situacao', 'nota_longa');
  end if;

  insert into public.vessel_stylist_contatos
    (stylist_id, canal, resultado, nota, criado_por, criado_por_nome, teste)
  values (v_s.id, v_canal, v_res, v_nota, auth.uid(),
          (select coalesce(nullif(trim(p.name), ''), p.email) from public.profiles p where p.id = auth.uid()),
          v_s.teste)
  returning id into v_id;

  -- A próxima ação escrita aqui SUBSTITUI a de hoje; vazia, a de hoje fica.
  if nullif(trim(coalesce(p_proxima_acao, '')), '') is not null then
    update public.vessel_stylists
       set proxima_acao = trim(p_proxima_acao), proxima_acao_em = p_proxima_acao_em, atualizado_em = now()
     where id = v_s.id;
  end if;

  return json_build_object('ok', true, 'situacao', 'ok', 'id', v_id,
    'sugestao', public.vessel_stylist_sugestao_de_etapa(v_res, v_s.estagio, v_s.ativada_em));
end;
$function$;

create or replace function public.vessel_stylist_contatos(p_codigo text)
returns json
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare v_saida json;
begin
  -- Lista vazia, não erro: é um bloco dentro de uma ficha já aberta.
  if not public.is_vessel_atendimentos() then return '[]'::json; end if;
  select coalesce(json_agg(json_build_object(
           'id', c.id, 'canal', c.canal, 'resultado', c.resultado, 'nota', c.nota,
           'criado_em', c.criado_em, 'criado_por_nome', c.criado_por_nome)
         order by c.criado_em desc, c.id desc), '[]'::json)
    into v_saida
    from public.vessel_stylist_contatos c
    join public.vessel_stylists s on s.id = c.stylist_id
   where s.codigo = upper(nullif(trim(coalesce(p_codigo, '')), ''));
  return v_saida;
end;
$function$;
```

- [ ] **Step 2: Rastreio e placar ganham os campos** — no bloco 10 (`vessel_rastreio_dos_stylists`), logo depois da linha `'receita_dos_encontros', (select coalesce(sum(v.receita), 0) from vendas v where v.stylist_id = s.id),` inserir:

```sql
        'contatos', (select count(*)::int from public.vessel_stylist_contatos c where c.stylist_id = s.id),
        'ultimo_contato_em', (select max(c.criado_em) from public.vessel_stylist_contatos c where c.stylist_id = s.id),
```

No bloco 11 (`vessel_placar_do_stylist_circle`), logo depois da linha `'intervalo_medio_em_dias', (...)` (a que termina em `between v_de and v_ate),`), inserir:

```sql
    -- Contatos registrados ANTES do primeiro encontro, entre as ativadas no
    -- período. Razão, não proporção.
    'contatos_ate_ativar', (select round(avg(n)::numeric, 1) from (
        select (select count(*) from public.vessel_stylist_contatos c
                 where c.stylist_id = s.id and c.criado_em < s.ativada_em) as n
          from sty s where (s.ativada_em at time zone 'America/Sao_Paulo')::date between v_de and v_ate) x),
    'stylists_com_contatos_ate_ativar', (select count(*)::int from sty s
        where (s.ativada_em at time zone 'America/Sao_Paulo')::date between v_de and v_ate),
```

E no `foreach f in array array[...]` do bloco 12 acrescentar:

```sql
    'public.vessel_stylist_registrar_contato(text, text, text, text, text, date)',
    'public.vessel_stylist_contatos(text)',
```

- [ ] **Step 3: Aplicador** — em `PORTAS` acrescentar:

```js
  vessel_stylist_registrar_contato: 'vessel_stylist_registrar_contato(text,text,text,text,text,date)',
  vessel_stylist_contatos: 'vessel_stylist_contatos(text)',
```

Na `IMPRESSAO`, acrescentar a coluna `(select count(*) from public.vessel_stylist_contatos)::int as contatos,` — ⚠️ a tabela só existe DEPOIS da migration, então a impressão de ANTES deve tolerar: trocar a linha por
`(select case when to_regclass('public.vessel_stylist_contatos') is null then 0 else (xpath('/row/n/text()', query_to_xml('select count(*) as n from public.vessel_stylist_contatos', false, true, '')))[1]::text::int end) as contatos,`.

E antes de `console.log('\n── o encontro')` inserir as provas do CRM:

```js
  console.log('\n── o CRM: contatos')
  await falarComo(soVe)
  const naoPode = await r(`public.vessel_stylist_registrar_contato($1, 'whatsapp', 'conversou')`, [STY])
  conferir(naoPode.situacao === 'sem_permissao', 'quem só vê não registra contato', naoPode)
  await falarComo(mexe)
  const canalRuim = await r(`public.vessel_stylist_registrar_contato($1, 'telegrama', 'conversou')`, [STY])
  conferir(canalRuim.situacao === 'canal_invalido', 'canal fora da lista é recusado', canalRuim)
  const resRuim = await r(`public.vessel_stylist_registrar_contato($1, 'whatsapp', 'talvez')`, [STY])
  conferir(resRuim.situacao === 'resultado_invalido', 'resultado fora da lista é recusado', resRuim)
  const longa = await r(`public.vessel_stylist_registrar_contato($1, 'whatsapp', 'conversou', repeat('x', 501))`, [STY])
  conferir(longa.situacao === 'nota_longa', 'nota de 501 caracteres é recusada', longa)
  const c1 = await r(`public.vessel_stylist_registrar_contato($1, 'ligacao', 'proposta', 'Quer ver a coleção',
                        'Mandar a proposta', current_date + 1)`, [STY])
  s = await uma(`select estagio, proxima_acao from public.vessel_stylists where codigo = $1`, [STY])
  conferir(c1.ok && c1.sugestao === null && s.estagio === 'em_negociacao' && s.proxima_acao === 'Mandar a proposta',
    'em negociação, "pediu proposta" não sugere nada; a próxima ação foi trocada; a etapa NÃO mudou', { c1, s })
  const hist = await r(`public.vessel_stylist_contatos($1)`, [STY])
  conferir(hist.length === 1 && hist[0].canal === 'ligacao' && hist[0].criado_por_nome,
    'o histórico traz o contato com quem registrou', hist)
  const raC = (await r(`public.vessel_rastreio_dos_stylists(14, true)`)).find((x) => x.codigo === STY)
  conferir(raC.contatos === 1 && raC.ultimo_contato_em, 'o rastreio conta os contatos', raC)
  const sug = await uma(`select public.vessel_stylist_sugestao_de_etapa('conversou', 'prospectado', null) as a,
                                public.vessel_stylist_sugestao_de_etapa('conversou', 'interessado', null) as b,
                                public.vessel_stylist_sugestao_de_etapa('recusou', 'contatado', null) as c,
                                public.vessel_stylist_sugestao_de_etapa('conversou', 'pausado', null) as d`)
  conferir(sug.a === 'contatado' && sug.b === null && sug.c === 'nao_interessado' && sug.d === null,
    'a sugestão do banco segue a tabela do desenho', sug)
```

Ao `esperado` do placar (conferência "o placar fecha…") acrescentar `stylists_com_contatos_ate_ativar: 1` e conferir `Number(pl.contatos_ate_ativar) === 1` (o contato foi registrado antes do primeiro encontro).

- [ ] **Step 4: Rodar o ensaio e os testes**

Run: `node coletor/aplicar-vessel-t11-bases-do-stylist-circle.mjs 2>&1 | grep -E "✗|✅|❌"` → Expected: `✅ ensaio limpo`.
Run: `node --test src/ferramentas/comercial-vessel/crm-da-stylist-regras.test.mjs` → Expected: tudo PASS.

- [ ] **Step 5: Commit**

```bash
git add db/migrations/2026-09-22-vessel-t11-bases-do-stylist-circle.sql coletor/aplicar-vessel-t11-bases-do-stylist-circle.mjs src/ferramentas/comercial-vessel/crm-da-stylist-regras.js src/ferramentas/comercial-vessel/crm-da-stylist-regras.test.mjs
git commit -m "feat(T11): CRM da stylist no banco — historico de contatos e sugestao de etapa"
```

---

### Task 3: O quadro e a ficha na tela do Stylist Circle

**Files:**
- Create: `src/ferramentas/comercial-vessel/quadro-do-stylist-circle.vue`
- Create: `src/ferramentas/comercial-vessel/ficha-da-stylist.vue`
- Modify: `src/ferramentas/comercial-vessel/tela-de-stylist-circle.vue`
- Modify: `src/ferramentas/comercial-vessel/estilo-comercial.css`
- Test: `src/ferramentas/comercial-vessel/crm-da-stylist-regras.test.mjs` (fiação)

**Interfaces:**
- Consumes: Task 1 (regras) e Task 2 (RPCs).
- `quadro-do-stylist-circle.vue`: props `stylists: Array`, `podeEditar: Boolean`, `hoje: String`; emits `abrir(codigo)`, `mover({ codigo, estagio })`.
- `ficha-da-stylist.vue`: props `stylist: Object`, `podeEditar: Boolean`, `chamar: Function`; emits `fechar`, `mudou`, `corrigir(codigo)`.

- [ ] **Step 1: Teste de fiação** (acrescentar ao fim de `crm-da-stylist-regras.test.mjs`)

```js
const ler = (f) => readFileSync(new URL(f, import.meta.url), 'utf8')
test('FIAÇÃO: o quadro usa colunasDoQuadro e só oferece avançar nas etapas manuais', () => {
  const q = ler('./quadro-do-stylist-circle.vue')
  assert.match(q, /colunasDoQuadro\(/)
  assert.match(q, /proximaEtapaManual\(/)
  assert.match(q, /v-if="podeEditar && proximaEtapaManual\(s\.estagio\)"/)
})
test('FIAÇÃO: a ficha registra pelo banco e só SUGERE a etapa', () => {
  const f = ler('./ficha-da-stylist.vue')
  assert.match(f, /vessel_stylist_registrar_contato/)
  assert.match(f, /vessel_stylist_contatos/)
  assert.match(f, /v-trava-rolagem/)
  assert.doesNotMatch(f, /p_estagio:\s*r\.sugestao/, 'a sugestão não pode ser gravada sem o toque da Ionara')
})
test('FIAÇÃO: a tela tem as duas vistas e o quadro recebe a lista FILTRADA', () => {
  const t = ler('./tela-de-stylist-circle.vue')
  assert.match(t, /:stylists="stylistsNaTela"/)
  assert.match(t, /vista === 'quadro'/)
})
```

- [ ] **Step 2: Rodar e ver falhar** — `node --test src/ferramentas/comercial-vessel/crm-da-stylist-regras.test.mjs` → FAIL (arquivos não existem).

- [ ] **Step 3: `quadro-do-stylist-circle.vue`**

```vue
<template>
  <section class="cv-bloco">
    <h2 class="cv-etiqueta">O funil</h2>
    <!-- ⚠️ NO CELULAR, UMA ETAPA POR VEZ: as etapas viram botões que quebram
         em linhas — nunca colunas que rolam para o lado (PADRAO, item 6). -->
    <div class="cv-quadro-etapas" role="tablist" aria-label="Etapas do funil">
      <button v-for="k in COLUNAS" :key="k" type="button" role="tab"
              class="btn cv-quadro-etapa" :class="{ ativa: etapaNoCelular === k }"
              :aria-selected="etapaNoCelular === k" @click="etapaNoCelular = k">
        {{ rotuloDaColuna(k) }} · {{ colunas[k].length }}</button>
    </div>
    <div class="cv-quadro">
      <div v-for="k in COLUNAS" :key="k" class="cv-quadro-coluna"
           :class="{ 'no-celular': etapaNoCelular === k, recolhida: k === 'saidas' && !saidasAbertas }">
        <button v-if="k === 'saidas'" type="button" class="cv-quadro-titulo cv-quadro-titulo-botao"
                @click="saidasAbertas = !saidasAbertas">{{ rotuloDaColuna(k) }} · {{ colunas[k].length }}</button>
        <h3 v-else class="cv-quadro-titulo">{{ rotuloDaColuna(k) }} · {{ colunas[k].length }}</h3>
        <p v-if="!colunas[k].length" class="cv-nota">Ninguém nesta etapa.</p>
        <article v-for="s in colunas[k]" :key="s.codigo" class="cv-quadro-cartao"
                 :class="{ atrasada: prazoAtrasado(s.proxima_acao_em, hoje) }">
          <button type="button" class="cv-quadro-nome" @click="$emit('abrir', s.codigo)">{{ s.nome }}</button>
          <p class="cv-sub"><span class="cv-codigo">{{ s.codigo }}</span>
            <span v-if="s.cidade"> · {{ s.cidade }}</span><span v-if="s.loja"> · {{ LOJAS[s.loja] || s.loja }}</span></p>
          <p v-if="k === 'saidas'" class="cv-sub">{{ ESTAGIOS_DA_STYLIST[s.estagio] }}</p>
          <p v-if="s.proxima_acao" class="cv-quadro-acao">
            <b>{{ prazoAtrasado(s.proxima_acao_em, hoje) ? 'Atrasada:' : 'Próxima ação:' }}</b>
            {{ s.proxima_acao }}<span v-if="s.proxima_acao_em"> — até {{ dataLegivel(s.proxima_acao_em) }}</span></p>
          <p class="cv-sub">{{ ultimoContatoEscrito(s.ultimo_contato_em) }}</p>
          <div class="cv-acoes">
            <button v-if="podeEditar" type="button" class="btn" @click="$emit('abrir', s.codigo)">Registrar contato</button>
            <button v-if="podeEditar && proximaEtapaManual(s.estagio)" type="button" class="btn"
                    @click="$emit('mover', { codigo: s.codigo, estagio: proximaEtapaManual(s.estagio) })">
              Avançar para {{ ESTAGIOS_DA_STYLIST[proximaEtapaManual(s.estagio)] }}</button>
            <button v-if="podeEditar && k === 'saidas'" type="button" class="btn"
                    @click="$emit('mover', { codigo: s.codigo, estagio: reabrirPara(s.ativada_em) })">Reabrir</button>
          </div>
        </article>
      </div>
    </div>
  </section>
</template>

<script setup>
/* O QUADRO DO STYLIST CIRCLE — uma coluna por etapa (computador) ou uma etapa
 * por vez (celular). Não grava nada: emite `abrir` e `mover`, e a tela chama o
 * banco. As regras moram em `crm-da-stylist-regras.js`, testadas. */
import { ref, computed } from 'vue'
import { ESTAGIOS_DA_STYLIST, LOJAS } from './t11-regras.js'
import { dataLegivel } from './enderecos-publicos.js'
import {
  FLUXO_PRINCIPAL, colunasDoQuadro, proximaEtapaManual, reabrirPara, prazoAtrasado, ultimoContatoEscrito,
} from './crm-da-stylist-regras.js'

const props = defineProps({
  stylists: { type: Array, default: () => [] },
  podeEditar: { type: Boolean, default: false },
  hoje: { type: String, required: true },
})
defineEmits(['abrir', 'mover'])

const COLUNAS = [...FLUXO_PRINCIPAL, 'saidas']
const colunas = computed(() => colunasDoQuadro(props.stylists, props.hoje))
const rotuloDaColuna = (k) => (k === 'saidas' ? 'Saídas' : ESTAGIOS_DA_STYLIST[k])
// No celular abre na primeira etapa que tem gente.
const etapaNoCelular = ref(COLUNAS.find((k) => colunasDoQuadro(props.stylists, props.hoje)[k].length) || 'prospectado')
const saidasAbertas = ref(false)
</script>

<style scoped>
@import './estilo-comercial.css';
</style>
```

- [ ] **Step 4: CSS do quadro** (acrescentar a `estilo-comercial.css`)

```css
/* ── o quadro do Stylist Circle ── */
.cv-quadro-etapas { display: none; flex-wrap: wrap; gap: var(--sp-2); margin-bottom: var(--sp-3); }
.cv-quadro-etapa.ativa { background: var(--accent-light); color: var(--accent-forte); border-color: var(--accent); }
.cv-quadro { display: grid; grid-template-columns: repeat(8, minmax(0, 1fr)); gap: var(--sp-3); align-items: start; }
.cv-quadro-coluna { display: flex; flex-direction: column; gap: var(--sp-2); min-width: 0; }
.cv-quadro-coluna.recolhida .cv-quadro-cartao, .cv-quadro-coluna.recolhida .cv-nota { display: none; }
.cv-quadro-titulo {
  font-family: var(--fonte-principal); font-size: var(--texto-etiqueta); letter-spacing: 1.5px;
  text-transform: uppercase; color: var(--muted); margin: 0; overflow-wrap: anywhere;
}
.cv-quadro-titulo-botao { background: none; border: 0; padding: 0; text-align: left; cursor: pointer; min-height: 40px; }
.cv-quadro-cartao {
  border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--surface);
  padding: var(--sp-3); display: flex; flex-direction: column; gap: var(--sp-1);
}
.cv-quadro-cartao.atrasada { border-color: color-mix(in srgb, var(--orange) 38%, var(--surface)); }
.cv-quadro-nome {
  background: none; border: 0; padding: 0; text-align: left; cursor: pointer; min-height: 40px;
  font-family: var(--fonte-principal); font-size: var(--texto-campo); color: var(--text); overflow-wrap: anywhere;
}
.cv-quadro-acao {
  margin: 0; padding: var(--sp-2); border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--orange) 10%, var(--surface)); color: var(--text);
  font-family: var(--fonte-principal); font-size: var(--texto-corpo);
}
.cv-quadro-cartao:not(.atrasada) .cv-quadro-acao { background: var(--surface2); }
@media (max-width: 1100px) and (min-width: 641px) { .cv-quadro { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
@media (max-width: 640px) {
  .cv-quadro-etapas { display: flex; }
  .cv-quadro { grid-template-columns: 1fr; }
  .cv-quadro-coluna { display: none; }
  .cv-quadro-coluna.no-celular { display: flex; }
  .cv-quadro-coluna.no-celular .cv-quadro-titulo { display: none; }
  .cv-quadro-coluna.recolhida.no-celular .cv-quadro-cartao, .cv-quadro-coluna.recolhida.no-celular .cv-nota { display: flex; }
}
/* ── modais do Comercial Vessel (ficha da stylist, cartão da convidada) ── */
.cv-modal-fundo {
  position: fixed; inset: 0; z-index: 1200; background: rgba(0,0,0,.55); display: flex;
  align-items: center; justify-content: center; padding: var(--sp-3); touch-action: none; overscroll-behavior: contain;
}
.cv-modal {
  width: 100%; max-width: 420px; max-height: 88dvh; display: flex; flex-direction: column;
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); overflow: hidden;
}
.cv-modal-topo { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-2);
  padding: var(--sp-3) var(--sp-4); border-bottom: 1px solid var(--border); }
.cv-modal-titulo { font-family: var(--fonte-principal); font-size: var(--texto-titulo); color: var(--text);
  margin: 0; overflow-wrap: anywhere; }
.cv-modal-fechar { min-width: 40px; min-height: 40px; }
.cv-modal-corpo { padding: var(--sp-4); overflow-y: auto; touch-action: pan-y; overscroll-behavior: contain; }
.cv-historico { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--sp-2); }
.cv-historico li { border-left: 3px solid var(--border); padding-left: var(--sp-3); }
.cv-escolha { display: flex; flex-wrap: wrap; gap: var(--sp-2); }
.cv-escolha .btn.ativa { background: var(--accent-light); color: var(--accent-forte); border-color: var(--accent); }
@media (max-width: 640px) {
  .cv-modal-fundo { padding: 12px; }
  .cv-modal { max-width: none; max-height: calc(100dvh - 24px); }
}
```

- [ ] **Step 5: `ficha-da-stylist.vue`**

```vue
<template>
  <div class="cv-modal-fundo" v-trava-rolagem @click.self="$emit('fechar')">
    <div class="cv-modal" role="dialog" :aria-label="`Ficha de ${stylist.nome}`">
      <div class="cv-modal-topo">
        <h2 class="cv-modal-titulo">{{ stylist.nome }}</h2>
        <button type="button" class="btn cv-modal-fechar" aria-label="Fechar" @click="$emit('fechar')">✕</button>
      </div>
      <div class="cv-modal-corpo">
        <p class="cv-sub"><span class="cv-codigo">{{ stylist.codigo }}</span> · {{ ESTAGIOS_DA_STYLIST[stylist.estagio] }}
          <span v-if="stylist.cidade"> · {{ stylist.cidade }}</span></p>
        <p class="cv-sub">{{ telefoneLegivel(stylist.whatsapp) }}<span v-if="stylist.instagram"> · {{ stylist.instagram }}</span></p>
        <p v-if="stylist.proxima_acao" class="cv-nota cv-nota-aviso"><b>Próxima ação:</b> {{ stylist.proxima_acao }}
          <span v-if="stylist.proxima_acao_em"> — até {{ dataLegivel(stylist.proxima_acao_em) }}</span></p>
        <div class="cv-acoes">
          <button v-if="podeEditar" type="button" class="btn" @click="$emit('corrigir', stylist.codigo)">Corrigir dados…</button>
        </div>

        <template v-if="podeEditar">
          <h3 class="cv-etiqueta cv-etiqueta-interna">Registrar contato</h3>
          <p class="cv-sub">Canal</p>
          <div class="cv-escolha">
            <button v-for="(rotulo, k) in CANAIS" :key="k" type="button" class="btn"
                    :class="{ ativa: novo.canal === k }" @click="novo.canal = k">{{ rotulo }}</button>
          </div>
          <p class="cv-sub">Resultado</p>
          <div class="cv-escolha">
            <button v-for="(rotulo, k) in RESULTADOS" :key="k" type="button" class="btn"
                    :class="{ ativa: novo.resultado === k }" @click="novo.resultado = k">{{ rotulo }}</button>
          </div>
          <div class="cv-form">
            <label class="cv-campo cv-campo-largo" for="ficha-nota"><span>Nota (opcional)</span>
              <input id="ficha-nota" type="text" maxlength="500" v-model="novo.nota"></label>
            <label class="cv-campo cv-campo-largo" for="ficha-proxima"><span>Nova próxima ação (opcional)</span>
              <input id="ficha-proxima" type="text" maxlength="120" v-model="novo.proximaAcao"></label>
            <label class="cv-campo" for="ficha-proxima-em"><span>Até quando</span>
              <input id="ficha-proxima-em" type="date" v-model="novo.proximaAcaoEm"></label>
          </div>
          <p v-if="erro" class="cv-nota cv-nota-erro">{{ erro }}</p>
          <div class="cv-acoes">
            <button type="button" class="btn btn-principal" :disabled="!novo.canal || !novo.resultado || gravando"
                    @click="registrar">{{ gravando ? 'Registrando…' : 'Registrar contato' }}</button>
          </div>
          <!-- ⚠️ A SUGESTÃO SÓ GRAVA COM O TOQUE: nada muda de etapa sozinho. -->
          <div v-if="sugestao" class="cv-nota cv-nota-ok">
            Contato registrado. Mover {{ primeiroNome }} para <b>{{ ESTAGIOS_DA_STYLIST[sugestao] }}</b>?
            <div class="cv-acoes">
              <button type="button" class="btn" @click="sugestao = null">Deixar como está</button>
              <button type="button" class="btn btn-principal" :disabled="movendo" @click="aceitarSugestao">
                Mover para {{ ESTAGIOS_DA_STYLIST[sugestao] }}</button>
            </div>
          </div>
        </template>

        <h3 class="cv-etiqueta cv-etiqueta-interna">Histórico</h3>
        <p v-if="erroDoHistorico" class="cv-nota cv-nota-erro">{{ erroDoHistorico }}</p>
        <p v-else-if="carregando" class="cv-carregando">Carregando…</p>
        <p v-else-if="!historico.length" class="cv-vazio">Nenhum contato registrado ainda.</p>
        <ul v-else class="cv-historico">
          <li v-for="h in historico" :key="h.id">
            <p class="cv-sub"><b>{{ RESULTADOS[h.resultado] }}</b> · {{ CANAIS[h.canal] }}</p>
            <p v-if="h.nota" class="cv-nota cv-nota-primeira">{{ h.nota }}</p>
            <p class="cv-sub">{{ dataHoraLegivel(h.criado_em) }}<span v-if="h.criado_por_nome"> · {{ h.criado_por_nome }}</span></p>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>

<script setup>
/* A FICHA DA STYLIST — registrar contato e ver o histórico.
 * ⚠️ Pendurada DENTRO da tela (o `v-if` do pai), nunca no `body`: o CSS é
 * `scoped` e um modal fora da raiz despenca sem estilo (PADRAO, item 4). */
import { ref, reactive, computed, onMounted } from 'vue'
import { ESTAGIOS_DA_STYLIST, telefoneLegivel } from './t11-regras.js'
import { dataLegivel, dataHoraLegivel } from './enderecos-publicos.js'
import { CANAIS, RESULTADOS } from './crm-da-stylist-regras.js'

const props = defineProps({
  stylist: { type: Object, required: true },
  podeEditar: { type: Boolean, default: false },
  chamar: { type: Function, required: true },
})
const emit = defineEmits(['fechar', 'mudou', 'corrigir'])

const primeiroNome = computed(() => String(props.stylist.nome || '').split(' ')[0])
const historico = ref([])
const carregando = ref(true)
const erroDoHistorico = ref('')
const novo = reactive({ canal: '', resultado: '', nota: '', proximaAcao: '', proximaAcaoEm: '' })
const gravando = ref(false)
const erro = ref('')
const sugestao = ref(null)
const movendo = ref(false)

const MENSAGENS = {
  sem_permissao: 'Você não tem a permissão de Atendimentos para registrar contato.',
  nao_achei: 'Não achei mais esta parceira. Recarregue a página.',
  canal_invalido: 'Escolha o canal.', resultado_invalido: 'Escolha o resultado.',
  nota_longa: 'A nota passou de 500 caracteres.',
}

async function carregarHistorico() {
  carregando.value = true
  erroDoHistorico.value = ''
  try { historico.value = await props.chamar('vessel_stylist_contatos', { p_codigo: props.stylist.codigo }) || [] }
  catch { erroDoHistorico.value = 'Não consegui ler o histórico agora. Tente de novo em um instante.' }
  finally { carregando.value = false }
}

async function registrar() {
  gravando.value = true
  erro.value = ''
  sugestao.value = null
  try {
    const r = await props.chamar('vessel_stylist_registrar_contato', {
      p_codigo: props.stylist.codigo, p_canal: novo.canal, p_resultado: novo.resultado,
      p_nota: novo.nota || null, p_proxima_acao: novo.proximaAcao || null, p_proxima_acao_em: novo.proximaAcaoEm || null,
    })
    if (!r?.ok) { erro.value = MENSAGENS[r?.situacao] || 'Não consegui registrar agora. Tente de novo em um instante.'; return }
    Object.assign(novo, { canal: '', resultado: '', nota: '', proximaAcao: '', proximaAcaoEm: '' })
    sugestao.value = r.sugestao || null
    await carregarHistorico()
    emit('mudou')
  } catch { erro.value = 'Não consegui falar com o banco agora. Tente de novo em um instante.' }
  finally { gravando.value = false }
}

async function aceitarSugestao() {
  movendo.value = true
  try {
    const r = await props.chamar('vessel_stylist_editar', { p_codigo: props.stylist.codigo, p_estagio: sugestao.value })
    if (!r?.ok) { erro.value = 'Não consegui mudar a etapa agora.'; return }
    sugestao.value = null
    emit('mudou')
  } catch { erro.value = 'Não consegui mudar a etapa agora.' }
  finally { movendo.value = false }
}

onMounted(carregarHistorico)
</script>

<style scoped>
@import './estilo-comercial.css';
</style>
```

- [ ] **Step 6: Ligar na tela** — em `tela-de-stylist-circle.vue`:

  1. Logo depois da `<barra-de-lista … />`, inserir:

```vue
      <div class="cv-escolha cv-vistas" role="tablist" aria-label="Vista">
        <button type="button" role="tab" class="btn" :class="{ ativa: vista === 'quadro' }"
                :aria-selected="vista === 'quadro'" @click="trocarVista('quadro')">Quadro</button>
        <button type="button" role="tab" class="btn" :class="{ ativa: vista === 'lista' }"
                :aria-selected="vista === 'lista'" @click="trocarVista('lista')">Lista</button>
      </div>
      <quadro-do-stylist-circle v-if="vista === 'quadro' && !carregando && !erro" :stylists="stylistsNaTela"
                                :pode-editar="podeExecutarAcao('editar', podeEditar)" :hoje="hojeLocal"
                                @abrir="fichaAberta = $event" @mover="mover" />
```

  2. Envolver o bloco "Como ler", o `v-if="carregando"` e o `<template v-else-if="!erro">` inteiros num `<template v-if="vista === 'lista'">…</template>` (o carregando continua visível nas duas vistas: mover o `<div v-if="carregando" class="cv-carregando">` para fora).
  3. Antes do `</div>` final do template (o que fecha `.tela-sty`), inserir:

```vue
    <ficha-da-stylist v-if="fichaAberta && stylistDaFicha" :stylist="stylistDaFicha"
                      :pode-editar="podeExecutarAcao('editar', podeEditar)" :chamar="chamar"
                      @fechar="fichaAberta = null" @mudou="carregar" @corrigir="corrigirDaFicha" />
```

  4. No `<script setup>`, acrescentar os imports e o estado:

```js
import QuadroDoStylistCircle from './quadro-do-stylist-circle.vue'
import FichaDaStylist from './ficha-da-stylist.vue'

// A vista escolhida fica no aparelho (conveniência, não dado).
const lerVista = () => { try { return localStorage.getItem('sty-vista') || 'quadro' } catch { return 'quadro' } }
const vista = ref(lerVista())
function trocarVista(v) { vista.value = v; try { localStorage.setItem('sty-vista', v) } catch { /* modo privado */ } }

const fichaAberta = ref(null)
const stylistDaFicha = computed(() => stylists.value.find((s) => s.codigo === fichaAberta.value) || null)

async function mover({ codigo, estagio }) {
  const r = await chamar('vessel_stylist_editar', { p_codigo: codigo, p_estagio: estagio }).catch(() => null)
  if (!r?.ok) { erro.value = { tipo: 'gravacao', acao: null, mensagem: mensagemDeEditar(r?.situacao || 'erro_de_rede') }; return }
  await carregar()
}

function corrigirDaFicha(codigo) {
  fichaAberta.value = null
  trocarVista('lista')
  const s = stylists.value.find((x) => x.codigo === codigo)
  if (s) abrirEditar(s)
}
```

  5. No placar, depois do número "Intervalo entre encontros", inserir:

```vue
            <div class="cv-numero">
              <span class="cv-numero-valor">{{ placar.contatos_ate_ativar ?? '—' }}</span>
              <span class="cv-numero-rotulo">Contatos até ativar</span>
              <span class="cv-numero-base">{{ placar.stylists_com_contatos_ate_ativar
                ? `média de ${placar.stylists_com_contatos_ate_ativar} stylist(s)` : 'sem base ainda' }}</span>
            </div>
```

  6. CSS: `.cv-vistas { margin: var(--sp-3) 0; }` em `estilo-comercial.css`.

⚠️ `mover` usa `erro` (a faixa de erro da tela) só quando a gravação falha, com a frase de `mensagemDeEditar` — nunca "tente de novo" para `estagio_contradiz_encontro`.

- [ ] **Step 7: Rodar testes e build**

Run: `npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"` → Expected: `fail 0`.
Run: `npx vite build --logLevel error` → Expected: sem saída.

- [ ] **Step 8: Commit**

```bash
git add src/ferramentas/comercial-vessel/quadro-do-stylist-circle.vue src/ferramentas/comercial-vessel/ficha-da-stylist.vue src/ferramentas/comercial-vessel/tela-de-stylist-circle.vue src/ferramentas/comercial-vessel/estilo-comercial.css src/ferramentas/comercial-vessel/crm-da-stylist-regras.test.mjs
git commit -m "feat(T11): quadro por etapas e ficha com historico de contatos"
```

---

### Task 4: Regras do convite da convidada (JS puro)

**Files:**
- Create: `src/ferramentas/comercial-vessel/convite-da-convidada-regras.js`
- Test: `src/ferramentas/comercial-vessel/convite-da-convidada-regras.test.mjs`

**Interfaces:**
- Produces: `primeiroNome(nome)`, `linkDaConvidada(chaveEncontro, chaveConvidada) → string ('' se inválida)`, `dataPorExtenso(iso) → 'sábado, 10 de outubro'`, `horarioCurto(iso) → '19h' | '19h30'`, `mensagemDoConvite({ quem: 'equipe'|'stylist', convidada, stylist, quando, local, link }) → string`, `linkDoWhatsApp(telefone, texto) → string ('' se telefone inválido)`, `nomeDoArquivo(convidada, quando) → 'private-edit_<nome>_<AAAA-MM-DD>.png'`, `textosDoCartao({ convidada, stylist, quando, local }) → { titulo, hosted, nome, quando, horario, marca, local, frase }`, `LINHAS_DO_CONVITE`.

- [ ] **Step 1: Teste**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  primeiroNome, linkDaConvidada, dataPorExtenso, horarioCurto, mensagemDoConvite,
  linkDoWhatsApp, nomeDoArquivo, textosDoCartao, LINHAS_DO_CONVITE,
} from './convite-da-convidada-regras.js'

const QUANDO = '2026-10-10T22:00:00Z' // 19h de São Paulo, sábado

test('primeiro nome', () => {
  assert.equal(primeiroNome('  Beatriz Montenegro Siqueira '), 'Beatriz')
  assert.equal(primeiroNome(''), '')
})
test('link só com as duas chaves no formato', () => {
  assert.equal(linkDaConvidada('k7q2m9tx', 'H3N8P4WZ'), 'https://vesselbrasil.com.br/pe/K7Q2M9TX/H3N8P4WZ')
  assert.equal(linkDaConvidada('K7Q2M9TX', 'O0I1ABCD'), '')
  assert.equal(linkDaConvidada('', 'H3N8P4WZ'), '')
})
test('data e hora no fuso de São Paulo, não em UTC', () => {
  assert.equal(dataPorExtenso(QUANDO), 'sábado, 10 de outubro')
  assert.equal(horarioCurto(QUANDO), '19h')
  assert.equal(horarioCurto('2026-10-10T22:30:00Z'), '19h30')
  assert.equal(dataPorExtenso('2026-10-11T02:30:00Z'), 'sábado, 10 de outubro')
})
const BASE = { convidada: 'Beatriz Siqueira', stylist: 'Marina Castro', quando: QUANDO,
  local: 'Loja do Iguatemi Campinas', link: 'https://vesselbrasil.com.br/pe/K7Q2M9TX/H3N8P4WZ' }
test('mensagem da stylist: o texto aprovado, palavra por palavra', () => {
  assert.equal(mensagemDoConvite({ ...BASE, quem: 'stylist' }),
    'Beatriz, estou preparando uma VESSEL Private Edit para um pequeno grupo de clientes. Vou apresentar uma '
    + 'seleção de bolsas sob o meu olhar, com a equipe da VESSEL à disposição. Será em sábado, 10 de outubro, '
    + 'às 19h, em Loja do Iguatemi Campinas. Gostaria muito de ter você comigo. Confirme sua presença por aqui: '
    + 'https://vesselbrasil.com.br/pe/K7Q2M9TX/H3N8P4WZ')
})
test('mensagem da equipe: o texto aprovado, palavra por palavra', () => {
  assert.equal(mensagemDoConvite({ ...BASE, quem: 'equipe' }),
    'Beatriz, a Marina está preparando uma VESSEL Private Edit para um pequeno grupo de clientes e gostaria '
    + 'muito de ter você com ela. Será em sábado, 10 de outubro, às 19h, em Loja do Iguatemi Campinas, com uma '
    + 'seleção de bolsas preparada pela Marina e a equipe da VESSEL à disposição. Confirme sua presença por aqui: '
    + 'https://vesselbrasil.com.br/pe/K7Q2M9TX/H3N8P4WZ')
})
test('sem local, a frase não fica com "em ,"', () => {
  assert.doesNotMatch(mensagemDoConvite({ ...BASE, local: null, quem: 'stylist' }), /em ,|em \./)
})
test('WhatsApp só com número brasileiro completo', () => {
  assert.equal(linkDoWhatsApp('5519999990000', 'Oi & tchau'), 'https://wa.me/5519999990000?text=Oi%20%26%20tchau')
  assert.equal(linkDoWhatsApp('19999990000', 'x'), '')
})
test('nome do arquivo sem acento e com a data do encontro', () => {
  assert.equal(nomeDoArquivo('Ângela Souza', QUANDO), 'private-edit_angela_2026-10-10.png')
})
test('textos do cartão: título, hosted by e o nome inteiro da convidada', () => {
  const t = textosDoCartao({ convidada: 'Beatriz Siqueira', stylist: 'Marina Castro', quando: QUANDO, local: 'Loja X' })
  assert.equal(t.titulo, 'PRIVATE EDIT')
  assert.equal(t.hosted, 'Hosted by Marina Castro')
  assert.equal(t.nome, 'Beatriz Siqueira')
  assert.equal(t.quando, 'SÁBADO, 10 DE OUTUBRO')
  assert.equal(t.horario, '19H')
  for (const l of LINHAS_DO_CONVITE) assert.ok(l.campo in t, `a linha ${l.campo} não tem texto`)
})
test('as linhas que vêm de fora encolhem para caber', () => {
  for (const campo of ['nome', 'hosted', 'local', 'quando']) {
    const l = LINHAS_DO_CONVITE.find((x) => x.campo === campo)
    assert.ok(l.larguraMaxima && l.tamanhoMinimo, `${campo} sem larguraMaxima/tamanhoMinimo`)
  }
})
```

- [ ] **Step 2: Rodar e ver falhar** — `node --test src/ferramentas/comercial-vessel/convite-da-convidada-regras.test.mjs` → FAIL (módulo não existe).

- [ ] **Step 3: Implementar**

```js
/* O CONVITE DA CONVIDADA — o link só dela, a mensagem e os textos do PNG.
 *
 * ⚠️ AS DUAS MENSAGENS SÃO TEXTO APROVADO PELO DONO (22/09/2026) e têm teste
 * palavra por palavra. Mudar uma vírgula aqui é mudar o texto que vai para a
 * cliente — e o módulo 12 do plano pede a aprovação do Breno antes do uso.
 *
 * ⚠️ DATA E HORA NO FUSO DE SÃO PAULO, sempre com `timeZone`: `new Date()`
 * sozinho lê em UTC e um encontro das 21h30 viraria o dia seguinte. */
const RAIZ = 'https://vesselbrasil.com.br/pe'
const FORMATO_DA_CHAVE = /^[ABCDEFGHJKMNPQRSTVWXYZ23456789]{8}$/
const FUSO = 'America/Sao_Paulo'

export function primeiroNome(nome) {
  return String(nome || '').trim().split(/\s+/)[0] || ''
}

export function linkDaConvidada(chaveEncontro, chaveConvidada) {
  const a = String(chaveEncontro || '').toUpperCase()
  const b = String(chaveConvidada || '').toUpperCase()
  return FORMATO_DA_CHAVE.test(a) && FORMATO_DA_CHAVE.test(b) ? `${RAIZ}/${a}/${b}` : ''
}

export function dataPorExtenso(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const semana = d.toLocaleDateString('pt-BR', { timeZone: FUSO, weekday: 'long' })
  const dia = d.toLocaleDateString('pt-BR', { timeZone: FUSO, day: 'numeric' })
  const mes = d.toLocaleDateString('pt-BR', { timeZone: FUSO, month: 'long' })
  return `${semana}, ${dia} de ${mes}`
}

export function horarioCurto(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const [h, m] = d.toLocaleTimeString('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit', hour12: false }).split(':')
  return m === '00' ? `${Number(h)}h` : `${Number(h)}h${m}`
}

function ondeEQuando(quando, local) {
  const partes = [`Será em ${dataPorExtenso(quando)}`, `às ${horarioCurto(quando)}`]
  if (local) partes.push(`em ${local}`)
  return partes.join(', ')
}

export function mensagemDoConvite({ quem, convidada, stylist, quando, local, link }) {
  const nome = primeiroNome(convidada)
  if (quem === 'stylist') {
    return `${nome}, estou preparando uma VESSEL Private Edit para um pequeno grupo de clientes. `
      + 'Vou apresentar uma seleção de bolsas sob o meu olhar, com a equipe da VESSEL à disposição. '
      + `${ondeEQuando(quando, local)}. Gostaria muito de ter você comigo. Confirme sua presença por aqui: ${link}`
  }
  const anfitria = primeiroNome(stylist)
  return `${nome}, a ${anfitria} está preparando uma VESSEL Private Edit para um pequeno grupo de clientes `
    + `e gostaria muito de ter você com ela. ${ondeEQuando(quando, local)}, com uma seleção de bolsas preparada `
    + `pela ${anfitria} e a equipe da VESSEL à disposição. Confirme sua presença por aqui: ${link}`
}

export function linkDoWhatsApp(telefone, texto) {
  const d = String(telefone || '').replace(/\D/g, '')
  if (!/^55\d{10,11}$/.test(d)) return ''
  return `https://wa.me/${d}?text=${encodeURIComponent(texto || '')}`
}

const semAcento = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
export function nomeDoArquivo(convidada, quando) {
  const nome = semAcento(primeiroNome(convidada)).toLowerCase().replace(/[^a-z0-9]+/g, '') || 'convidada'
  const d = new Date(quando)
  const dia = Number.isNaN(d.getTime()) ? 'sem-data'
    : d.toLocaleDateString('en-CA', { timeZone: FUSO })
  return `private-edit_${nome}_${dia}.png`
}

// ── o desenho (1080×1350, a mesma régua do Appointment Card) ──
export const REGULAR = 'VesselVersatile'
export const LEVE = 'VesselVersatileLight'
export const MANUSCRITA = 'VesselAngeletta'
export const LINHAS_DO_CONVITE = [
  { campo: 'titulo',  fonte: REGULAR,    tamanho: 37.8,  base: 137.8, largura: 360 },
  { campo: 'hosted',  fonte: LEVE,       tamanho: 32.4,  base: 190.0, larguraMaxima: 860, tamanhoMinimo: 22 },
  { campo: 'nome',    fonte: MANUSCRITA, tamanho: 118.8, base: 380.0, tracking: 10.9, larguraMaxima: 800, tamanhoMinimo: 56 },
  { campo: 'quando',  fonte: REGULAR,    tamanho: 43.2,  base: 500.0, tracking: 4.0, larguraMaxima: 860, tamanhoMinimo: 28 },
  { campo: 'horario', fonte: REGULAR,    tamanho: 43.2,  base: 560.0, tracking: 4.0 },
  { campo: 'marca',   fonte: REGULAR,    tamanho: 37.8,  base: 690.0, largura: 153 },
  { campo: 'local',   fonte: LEVE,       tamanho: 37.8,  base: 735.0, larguraMaxima: 860, tamanhoMinimo: 22 },
  { campo: 'frase',   fonte: LEVE,       tamanho: 32.4,  base: 860.0 },
]
export const DIVISORIAS_DO_CONVITE = [{ meio: 625, largura: 120, espessura: 2.7 }]

export function textosDoCartao({ convidada, stylist, quando, local }) {
  return {
    titulo: 'PRIVATE EDIT',
    hosted: `Hosted by ${String(stylist || '').trim()}`,
    nome: String(convidada || '').trim().replace(/\s+/g, ' '),
    quando: dataPorExtenso(quando).toUpperCase(),
    horario: horarioCurto(quando).toUpperCase(),
    marca: 'VESSEL',
    local: String(local || '').trim(),
    frase: 'Será um prazer receber você.',
  }
}
```

- [ ] **Step 4: Rodar** — `node --test src/ferramentas/comercial-vessel/convite-da-convidada-regras.test.mjs` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ferramentas/comercial-vessel/convite-da-convidada-regras.js src/ferramentas/comercial-vessel/convite-da-convidada-regras.test.mjs
git commit -m "feat(T11): regras do convite da convidada — link, mensagens aprovadas, textos do cartao"
```

---

### Task 5: Banco do convite individual + provas

**Files:**
- Modify: `db/migrations/2026-09-22-vessel-t11-bases-do-stylist-circle.sql` (bloco 14 antes do bloco 12; ajustes nos blocos 8 e 9; `vessel_stylists_para_escolher` recriada)
- Modify: `coletor/aplicar-vessel-t11-bases-do-stylist-circle.mjs`

**Interfaces:**
- Produces (RPC):
  - `vessel_chave_da_convidada(p_id bigint) → {ok, situacao, chave, chave_encontro}` (trava de ver).
  - `vessel_convite_da_convidada(p_chave text, p_convidada text) → o mesmo JSON de vessel_convite_da_private_edit + {primeiro_nome, resposta}` quando a convidada bate; sem ela, o JSON geral (anon).
  - `vessel_rsvp_da_convidada(p_chave text, p_convidada text, p_resposta text, p_aceite_marketing boolean default false, p_aceite_versao text default null, p_armadilha text default null) → {ok, situacao}`; situações: `recebido | resposta_invalida | convite_invalido` (anon).
  - `vessel_convidadas_do_encontro` ganha `chave_convite`, `convite_aberto_em`, `convite_aberturas`.
  - `vessel_stylists_para_escolher` ganha `whatsapp`.

- [ ] **Step 1: Bloco 14** (antes de `-- ── 12. AS PORTAS`)

```sql
-- ── 14. O CONVITE DE CADA CONVIDADA: o link só dela e o rastreio ────────────

alter table public.vessel_atendimentos
  add column if not exists chave_convite      text,
  add column if not exists convite_aberto_em  timestamptz,
  add column if not exists convite_aberturas  int not null default 0;
create unique index if not exists vessel_atendimentos_chave_convite_idx
  on public.vessel_atendimentos (chave_convite) where chave_convite is not null;

-- ⚠️ O MESMO SORTEIO DA CHAVE DO ENCONTRO (`vessel_criar_private_edit`): 8
-- letras, sem O/0/I/1, e byte acima de 240 descartado para não viciar.
create or replace function public.vessel_sortear_chave_de_convidada()
returns text
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare
  v_alfabeto text := 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
  v_teto int := 240;
  v_chave text;
  v_byte int;
begin
  loop
    v_chave := '';
    while length(v_chave) < 8 loop
      v_byte := get_byte(extensions.gen_random_bytes(1), 0);
      continue when v_byte >= v_teto;
      v_chave := v_chave || substr(v_alfabeto, 1 + (v_byte % 30), 1);
    end loop;
    exit when not exists (select 1 from public.vessel_atendimentos where chave_convite = v_chave);
  end loop;
  return v_chave;
end;
$$;
revoke all on function public.vessel_sortear_chave_de_convidada() from public, anon, authenticated;

create or replace function public.vessel_chave_da_convidada(p_id bigint)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_t record;
  v_chave text;
begin
  if not public.is_vessel_atendimentos() then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  select t.id, t.chave_convite, e.chave as chave_encontro into v_t
    from public.vessel_atendimentos t
    join public.vessel_private_edits e on e.codigo = t.evento_codigo
   where t.id = p_id;
  if not found then return json_build_object('ok', false, 'situacao', 'nao_achei'); end if;
  v_chave := v_t.chave_convite;
  if v_chave is null then
    v_chave := public.vessel_sortear_chave_de_convidada();
    update public.vessel_atendimentos set chave_convite = v_chave where id = v_t.id and chave_convite is null;
    select chave_convite into v_chave from public.vessel_atendimentos where id = v_t.id;
  end if;
  return json_build_object('ok', true, 'situacao', 'ok', 'chave', v_chave, 'chave_encontro', v_t.chave_encontro);
end;
$function$;

-- ⚠️ A PÁGINA PÚBLICA. Chave de convidada errada ou de outro encontro devolve
-- EXATAMENTE o convite geral — a mesma resposta de uma chave que não existe,
-- para não dar a ninguém um jeito de descobrir chaves válidas.
-- ⚠️ SÓ O PRIMEIRO NOME: o link pode ser repassado.
create or replace function public.vessel_convite_da_convidada(p_chave text, p_convidada text)
returns json
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_geral jsonb := public.vessel_convite_da_private_edit(p_chave)::jsonb;
  v_t record;
begin
  if coalesce((v_geral ->> 'ok')::boolean, false) is not true then return v_geral::json; end if;
  select t.id, t.rsvp, pe.nome into v_t
    from public.vessel_atendimentos t
    join public.vessel_private_edits e on e.codigo = t.evento_codigo
    join public.vessel_pessoas pe on pe.id = t.pessoa_id
   where e.chave = upper(nullif(trim(coalesce(p_chave, '')), ''))
     and t.chave_convite = upper(nullif(trim(coalesce(p_convidada, '')), ''));
  if not found then return v_geral::json; end if;
  update public.vessel_atendimentos
     set convite_aberto_em = coalesce(convite_aberto_em, now()),
         convite_aberturas = convite_aberturas + 1
   where id = v_t.id;
  return (v_geral || jsonb_build_object(
    'primeiro_nome', split_part(trim(v_t.nome), ' ', 1),
    'resposta', v_t.rsvp))::json;
end;
$function$;

create or replace function public.vessel_rsvp_da_convidada(
  p_chave text, p_convidada text, p_resposta text, p_aceite_marketing boolean default false,
  p_aceite_versao text default null, p_armadilha text default null)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_t record;
begin
  if coalesce(trim(p_armadilha), '') <> '' then
    return json_build_object('ok', true, 'situacao', 'recebido');
  end if;
  if p_resposta is null or p_resposta not in ('sim', 'falar-com-equipe') then
    return json_build_object('ok', false, 'situacao', 'resposta_invalida');
  end if;
  select t.id, t.pessoa_id, t.teste into v_t
    from public.vessel_atendimentos t
    join public.vessel_private_edits e on e.codigo = t.evento_codigo
   where e.chave = upper(nullif(trim(coalesce(p_chave, '')), ''))
     and t.chave_convite = upper(nullif(trim(coalesce(p_convidada, '')), ''))
     and e.ativa and not coalesce(e.arquivada, false)
     and e.status not in ('cancelado', 'nao_realizado', 'realizado');
  if not found then return json_build_object('ok', false, 'situacao', 'convite_invalido'); end if;

  update public.vessel_atendimentos set rsvp = p_resposta, atualizado_em = now() where id = v_t.id;

  -- A permissão de atendimento, como no RSVP geral — uma por hora no máximo,
  -- para quem aperta o botão três vezes não virar três aceites.
  if not exists (select 1 from public.vessel_consentimentos
                  where pessoa_id = v_t.pessoa_id and finalidade = 'atendimento'
                    and fonte = 'private-edit' and criado_em > now() - interval '1 hour') then
    insert into public.vessel_consentimentos (pessoa_id, finalidade, canal, versao, fonte, teste)
    values (v_t.pessoa_id, 'atendimento', 'whatsapp', nullif(trim(coalesce(p_aceite_versao, '')), ''),
            'private-edit', v_t.teste);
  end if;
  if coalesce(p_aceite_marketing, false) then
    insert into public.vessel_consentimentos (pessoa_id, finalidade, canal, versao, fonte, teste)
    values (v_t.pessoa_id, 'marketing', 'whatsapp', nullif(trim(coalesce(p_aceite_versao, '')), ''),
            'private-edit', v_t.teste);
  end if;
  return json_build_object('ok', true, 'situacao', 'recebido');
end;
$function$;

create or replace function public.vessel_stylists_para_escolher()
returns json
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare v_saida json;
begin
  if not public.is_vessel_atendimentos() then
    raise exception 'sem permissao' using errcode = '42501';
  end if;
  -- T11: `whatsapp` para o "Mandar para a stylist" do cartão da convidada. É o
  -- mesmo dado que o rastreio já devolve, atrás do mesmo portão.
  select coalesce(json_agg(json_build_object('codigo', s.codigo, 'nome', s.nome,
                                             'cidade', s.cidade, 'whatsapp', s.whatsapp)
                           order by s.codigo), '[]'::json)
    into v_saida
    from public.vessel_stylists s
   where not coalesce(s.teste, false)
     and coalesce(s.ativa, true);
  return v_saida;
end;
$function$;
```

⚠️ Conferir antes: `select column_name from information_schema.columns where table_name='vessel_consentimentos'` tem `criado_em`. Se o nome for outro, usar o nome real na linha do `not exists`.

- [ ] **Step 2: Ajustes nos blocos existentes**
  - Bloco 8 (`vessel_convidar_para_encontro`): no `insert into public.vessel_atendimentos (…, convidada_em)` acrescentar a coluna `chave_convite` e o valor `public.vessel_sortear_chave_de_convidada()`.
  - Bloco 9 (`vessel_convidadas_do_encontro`): depois de `'convite_enviado_em', t.convite_enviado_em,` inserir
    `'chave_convite', t.chave_convite, 'convite_aberto_em', t.convite_aberto_em, 'convite_aberturas', t.convite_aberturas,`.
  - Bloco 12: acrescentar ao array `'public.vessel_chave_da_convidada(bigint)'` e `'public.vessel_stylists_para_escolher()'`; e DEPOIS do `do $$ … $$;`:

```sql
revoke all on function public.vessel_convite_da_convidada(text, text) from public;
revoke all on function public.vessel_rsvp_da_convidada(text, text, text, boolean, text, text) from public;
grant execute on function public.vessel_convite_da_convidada(text, text) to anon, authenticated;
grant execute on function public.vessel_rsvp_da_convidada(text, text, text, boolean, text, text) to anon, authenticated;
```

- [ ] **Step 3: Provas no aplicador** — em `PORTAS` acrescentar
  `vessel_chave_da_convidada: 'vessel_chave_da_convidada(bigint)'` e `vessel_stylists_para_escolher: 'vessel_stylists_para_escolher()'`; em `MIOLO` acrescentar `'vessel_sortear_chave_de_convidada()'`; e conferir as duas públicas à parte:

```js
  for (const f of ['vessel_convite_da_convidada(text,text)', 'vessel_rsvp_da_convidada(text,text,text,boolean,text,text)']) {
    const pr = await uma(`select has_function_privilege('anon', $1, 'EXECUTE') as anon`, [`public.${f}`])
    conferir(pr.anon === true, `${f}: a página pública entra`, pr)
  }
```

E, antes de `console.log('\n── a situação do encontro')`, inserir:

```js
  console.log('\n── o convite de cada convidada')
  const ch = await r(`public.vessel_chave_da_convidada($1)`, [ca.id])
  const chaveA = (await uma(`select chave_convite from public.vessel_atendimentos where id = $1`, [ca.id])).chave_convite
  conferir(ch.ok && /^[ABCDEFGHJKMNPQRSTVWXYZ23456789]{8}$/.test(ch.chave) && ch.chave === chaveA,
    'a convidada nasce com chave própria, no alfabeto sem O/0/I/1', ch)
  const chaveE = ch.chave_encontro
  await falarComo(null)
  const aberto = await r(`public.vessel_convite_da_convidada($1, $2)`, [chaveE, ch.chave])
  const geral = await r(`public.vessel_convite_da_private_edit($1)`, [chaveE])
  const errada = await r(`public.vessel_convite_da_convidada($1, 'ZZZZZZZZ')`, [chaveE])
  conferir(aberto.primeiro_nome === 'Ana' && !('telefone' in aberto) && !('email' in aberto),
    'com a chave dela: só o primeiro nome', aberto)
  conferir(JSON.stringify(errada) === JSON.stringify(geral), 'chave errada = exatamente o convite geral', { errada, geral })
  const cont = await uma(`select convite_aberturas, convite_aberto_em from public.vessel_atendimentos where id = $1`, [ca.id])
  conferir(cont.convite_aberturas === 1 && cont.convite_aberto_em, 'a abertura foi contada', cont)
  const semResp = await r(`public.vessel_rsvp_da_convidada($1, $2, 'talvez')`, [chaveE, ch.chave])
  conferir(semResp.situacao === 'resposta_invalida', 'resposta fora das duas é recusada', semResp)
  const alheia = await r(`public.vessel_rsvp_da_convidada($1, $2, 'sim')`, [chaveE, 'ZZZZZZZZ'])
  conferir(alheia.situacao === 'convite_invalido', 'chave de convidada errada não grava', alheia)
  await cli.query(`update public.vessel_atendimentos set rsvp = null where id = $1`, [cb.id])
  const chB = await r(`public.vessel_rsvp_da_convidada($1, (select chave_convite from public.vessel_atendimentos where id = $2), 'sim')`, [chaveE, cb.id])
  const rsvpB = await uma(`select rsvp from public.vessel_atendimentos where id = $1`, [cb.id])
  conferir(chB.situacao === 'recebido' && rsvpB.rsvp === 'sim', 'a resposta cai na cadeira DELA', { chB, rsvpB })
  await falarComo(mexe)
```

⚠️ Esta prova roda com o encontro 1 ainda `agendado` (antes do bloco "a situação do encontro" o realizar) — por isso ela vem ANTES dele. `ca` e `cb` são as convidadas criadas no bloco "as convidadas".

- [ ] **Step 4: Rodar** — `node coletor/aplicar-vessel-t11-bases-do-stylist-circle.mjs 2>&1 | grep -E "✗|✅|❌"` → Expected: `✅ ensaio limpo`. `npm test` → `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add db/migrations/2026-09-22-vessel-t11-bases-do-stylist-circle.sql coletor/aplicar-vessel-t11-bases-do-stylist-circle.mjs
git commit -m "feat(T11): link individual da convidada, abertura rastreada e resposta na cadeira dela"
```

---

### Task 6: O PNG e a janela "Cartão e mensagem" na Central

**Files:**
- Create: `public/cartao-private-edit/fundo.png`, `public/cartao-private-edit/logomarca-escura.png`, `public/cartao-private-edit/fontes/{vessel-versatile,vessel-versatile-light,vessel-angeletta}.woff2` (cópias)
- Create: `src/ferramentas/comercial-vessel/desenhar-convite.js`
- Create: `src/ferramentas/comercial-vessel/cartao-da-convidada.vue`
- Modify: `src/ferramentas/comercial-vessel/tela-de-private-edit.vue`
- Test: `src/ferramentas/comercial-vessel/convite-da-convidada-regras.test.mjs` (fiação)

**Interfaces:**
- Consumes: Task 4 (regras), Task 5 (RPCs `vessel_chave_da_convidada`, `vessel_convite_marcar`).
- `desenhar-convite.js`: `desenharConvite({ convidada, stylist, quando, local }) → Promise<HTMLCanvasElement>`.
- `cartao-da-convidada.vue`: props `convidada: Object`, `encontro: Object`, `telefoneDaStylist: String`, `chamar: Function`; emits `fechar`, `enviado`.

- [ ] **Step 1: Copiar os arquivos da marca**

```bash
mkdir -p public/cartao-private-edit/fontes
cp ~/iamundi/vessel-brasil/geradorappointmentcard/fundo.png public/cartao-private-edit/fundo.png
cp ~/iamundi/vessel-brasil/marca/logomarca-escura.png public/cartao-private-edit/logomarca-escura.png
cp ~/iamundi/vessel-brasil/geradorappointmentcard/fontes/*.woff2 public/cartao-private-edit/fontes/
shasum -a 256 public/cartao-private-edit/fontes/*.woff2 ~/iamundi/vessel-brasil/geradorappointmentcard/fontes/*.woff2
```
Expected: os hashes batem par a par (as fontes já vêm com `:`/`;` destrocados pelo `ferramentas/fontes-do-cartao.py` do site — NÃO reprocessar).

- [ ] **Step 2: Teste de fiação** (fim de `convite-da-convidada-regras.test.mjs`)

```js
import { readFileSync, existsSync } from 'node:fs'
const ler = (f) => readFileSync(new URL(f, import.meta.url), 'utf8')
test('FIAÇÃO: os arquivos da marca estão na pasta pública', () => {
  for (const f of ['fundo.png', 'logomarca-escura.png', 'fontes/vessel-versatile.woff2',
    'fontes/vessel-versatile-light.woff2', 'fontes/vessel-angeletta.woff2']) {
    assert.ok(existsSync(new URL(`../../../public/cartao-private-edit/${f}`, import.meta.url)), `falta ${f}`)
  }
})
test('FIAÇÃO: o cartão usa as regras e marca "convite enviado" pelo banco', () => {
  const c = ler('./cartao-da-convidada.vue')
  assert.match(c, /mensagemDoConvite\(/)
  assert.match(c, /linkDaConvidada\(/)
  assert.match(c, /vessel_chave_da_convidada/)
  assert.match(c, /p_marca: 'enviado'/)
  assert.match(c, /v-trava-rolagem/)
  assert.match(ler('./desenhar-convite.js'), /LINHAS_DO_CONVITE/)
})
test('FIAÇÃO: a lista de convidadas abre o cartão', () => {
  assert.match(ler('./tela-de-private-edit.vue'), /<cartao-da-convidada/)
})
```

- [ ] **Step 3: `desenhar-convite.js`**

```js
/* DESENHA O CARTÃO DA CONVIDADA num `canvas` — o mesmo método do Appointment
 * Card (`vessel-brasil/geradorappointmentcard/desenhar.mjs`): fontes carregadas
 * ANTES de desenhar (o canvas não espera e não avisa), sem kerning automático,
 * texto centrado pela tinta e linha que vem de fora encolhendo até caber. */
import { LINHAS_DO_CONVITE, DIVISORIAS_DO_CONVITE, textosDoCartao } from './convite-da-convidada-regras.js'

const CAMINHO = '/cartao-private-edit'
const LARGURA = 1080, ALTURA = 1350, CENTRO = 540
const COR = '#29211C' // cor de marca do cartão (PDF de detalhes do Appointment Card)
const LOGO = { x: 422, y: 1174, largura: 236, altura: 59 }
const RECORTE_DO_LOGO = { x: 0, y: 0, largura: 600, altura: 150 }
const VERSAO_DAS_FONTES = 3

let fontesProntas = null
function carregarFontes() {
  if (!fontesProntas) {
    fontesProntas = Promise.all([
      ['VesselVersatile', 'vessel-versatile.woff2'],
      ['VesselVersatileLight', 'vessel-versatile-light.woff2'],
      ['VesselAngeletta', 'vessel-angeletta.woff2'],
    ].map(async ([nome, arquivo]) => {
      const f = new FontFace(nome, `url(${CAMINHO}/fontes/${arquivo}?v=${VERSAO_DAS_FONTES})`)
      await f.load()
      document.fonts.add(f)
    }))
  }
  return fontesProntas
}

function carregarImagem(src) {
  return new Promise((ok, erro) => {
    const img = new Image()
    img.onload = () => ok(img)
    img.onerror = () => erro(new Error(`não carregou: ${src}`))
    img.src = src
  })
}

function medir(ctx, texto, espaco) {
  const letras = [...texto]
  const posicoes = []
  let x = 0
  for (const l of letras) { posicoes.push(x); x += ctx.measureText(l).width + espaco }
  let esquerda = Infinity, direita = -Infinity
  letras.forEach((l, i) => {
    if (l === ' ') return
    const m = ctx.measureText(l)
    esquerda = Math.min(esquerda, posicoes[i] - m.actualBoundingBoxLeft)
    direita = Math.max(direita, posicoes[i] + m.actualBoundingBoxRight)
  })
  return { letras, posicoes, esquerda, tinta: direita - esquerda }
}

function escrever(ctx, texto, linha) {
  if (!texto) return
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = COR
  ctx.fontKerning = 'none'
  let tamanho = linha.tamanho
  ctx.font = `${tamanho}px ${linha.fonte}`
  if (linha.larguraMaxima) {
    for (let n = 0; n < 40; n++) {
      ctx.font = `${tamanho}px ${linha.fonte}`
      const largura = medir(ctx, texto, (linha.tracking || 0) * (tamanho / linha.tamanho)).tinta
      if (largura <= linha.larguraMaxima || tamanho <= linha.tamanhoMinimo) break
      tamanho = Math.max(linha.tamanhoMinimo, Math.floor(tamanho * (linha.larguraMaxima / largura) * 100) / 100)
    }
    ctx.font = `${tamanho}px ${linha.fonte}`
  }
  let espaco = (linha.tracking || 0) * (tamanho / linha.tamanho)
  if (linha.largura) {
    const sem = medir(ctx, texto, 0)
    espaco = (linha.largura - sem.tinta) / Math.max([...texto].length - 1, 1)
  }
  if (espaco === 0) {
    const m = ctx.measureText(texto)
    ctx.fillText(texto, CENTRO - (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2, linha.base)
    return
  }
  const { letras, posicoes, esquerda, tinta } = medir(ctx, texto, espaco)
  const inicio = CENTRO - tinta / 2 - esquerda
  letras.forEach((l, i) => ctx.fillText(l, inicio + posicoes[i], linha.base))
}

export async function desenharConvite(dados) {
  await carregarFontes()
  const [fundo, logo] = await Promise.all([
    carregarImagem(`${CAMINHO}/fundo.png`), carregarImagem(`${CAMINHO}/logomarca-escura.png`),
  ])
  const tela = document.createElement('canvas')
  tela.width = LARGURA
  tela.height = ALTURA
  const ctx = tela.getContext('2d')
  ctx.drawImage(fundo, 0, 0, LARGURA, ALTURA)
  const t = textosDoCartao(dados)
  for (const linha of LINHAS_DO_CONVITE) escrever(ctx, t[linha.campo], linha)
  ctx.fillStyle = COR
  for (const d of DIVISORIAS_DO_CONVITE) ctx.fillRect(CENTRO - d.largura / 2, d.meio - d.espessura / 2, d.largura, d.espessura)
  const r = RECORTE_DO_LOGO
  ctx.drawImage(logo, r.x, r.y, r.largura, r.altura, LOGO.x, LOGO.y, LOGO.largura, LOGO.altura)
  return tela
}
```

⚠️ `#29211C` é cor de MARCA (a tinta do cartão impresso), não de tela: o `padrao-da-central.test.mjs` pode reclamar de hex em `.js` de ferramenta — se reclamar, acrescentar a exceção no próprio teste com o motivo "cor de marca do cartão da Vessel", como manda o item 9½ do padrão.

- [ ] **Step 4: `cartao-da-convidada.vue`**

```vue
<template>
  <div class="cv-modal-fundo" v-trava-rolagem @click.self="$emit('fechar')">
    <div class="cv-modal" role="dialog" :aria-label="`Cartão de ${convidada.nome}`">
      <div class="cv-modal-topo">
        <h2 class="cv-modal-titulo">Convite de {{ primeiroNome(convidada.nome) }}</h2>
        <button type="button" class="btn cv-modal-fechar" aria-label="Fechar" @click="$emit('fechar')">✕</button>
      </div>
      <div class="cv-modal-corpo">
        <p v-if="erro" class="cv-nota cv-nota-erro">{{ erro }}</p>
        <p v-else-if="!imagem" class="cv-carregando">Desenhando o cartão…</p>
        <img v-else :src="imagem" class="cv-cartao-previa" :alt="`Cartão do convite de ${convidada.nome}`">

        <p class="cv-sub">Quem envia</p>
        <div class="cv-escolha">
          <button type="button" class="btn" :class="{ ativa: quem === 'equipe' }" @click="escolher('equipe')">Equipe Vessel</button>
          <button type="button" class="btn" :class="{ ativa: quem === 'stylist' }" @click="escolher('stylist')">A stylist</button>
        </div>

        <h3 class="cv-etiqueta cv-etiqueta-interna">A mensagem</h3>
        <p class="cv-nota cv-nota-primeira cv-mensagem">{{ mensagem || '…' }}</p>

        <div class="cv-acoes">
          <a v-if="quem === 'equipe' && whatsDela" class="btn btn-principal" :href="whatsDela" target="_blank"
             rel="noopener noreferrer" @click="marcarEnviado">Enviar no WhatsApp dela</a>
          <a v-if="quem === 'stylist' && whatsDaStylist" class="btn btn-principal" :href="whatsDaStylist" target="_blank"
             rel="noopener noreferrer" @click="marcarEnviado">Mandar para a stylist</a>
          <button v-if="podeCompartilhar" type="button" class="btn" :disabled="!arquivo" @click="compartilhar">Compartilhar cartão</button>
          <a v-else class="btn" :href="imagem || undefined" :download="nomeDoArquivo(convidada.nome, encontro.quando)"
             :aria-disabled="!imagem" @click="marcarEnviado">Baixar cartão</a>
          <button type="button" class="btn" :disabled="!mensagem" @click="copiar">{{ copiado ? 'Copiada' : 'Copiar mensagem' }}</button>
        </div>
        <p v-if="quem === 'stylist'" class="cv-nota">A stylist recebe a mensagem pronta; o cartão, baixe e mande junto.</p>
        <p v-if="avisoDoEnvio" class="cv-nota cv-nota-erro">{{ avisoDoEnvio }}</p>
      </div>
    </div>
  </div>
</template>

<script setup>
/* "CARTÃO E MENSAGEM" — o PNG e a mensagem com o link só da convidada.
 * ⚠️ QUALQUER ENVIO MARCA "CONVITE ENVIADO" (vessel_convite_marcar). Se a
 * marcação falhar, o envio já saiu: a tela avisa em vez de fingir que marcou. */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import {
  primeiroNome, linkDaConvidada, mensagemDoConvite, linkDoWhatsApp, nomeDoArquivo,
} from './convite-da-convidada-regras.js'
import { desenharConvite } from './desenhar-convite.js'

const props = defineProps({
  convidada: { type: Object, required: true },
  encontro: { type: Object, required: true },
  telefoneDaStylist: { type: String, default: '' },
  chamar: { type: Function, required: true },
})
const emit = defineEmits(['fechar', 'enviado'])

const CHAVE_DA_ESCOLHA = `pe-quem-envia:${props.encontro.codigo}`
const lerEscolha = () => { try { return localStorage.getItem(CHAVE_DA_ESCOLHA) || 'equipe' } catch { return 'equipe' } }
const quem = ref(lerEscolha())
function escolher(q) { quem.value = q; try { localStorage.setItem(CHAVE_DA_ESCOLHA, q) } catch { /* modo privado */ } }

const link = ref('')
const imagem = ref('')
const arquivo = ref(null)
const erro = ref('')
const copiado = ref(false)
const avisoDoEnvio = ref('')

const mensagem = computed(() => link.value ? mensagemDoConvite({
  quem: quem.value, convidada: props.convidada.nome, stylist: props.encontro.anfitria,
  quando: props.encontro.quando, local: props.encontro.local, link: link.value,
}) : '')
const whatsDela = computed(() => linkDoWhatsApp(props.convidada.telefone, mensagem.value))
const whatsDaStylist = computed(() => linkDoWhatsApp(props.telefoneDaStylist, mensagem.value))
const podeCompartilhar = computed(() => !!arquivo.value && !!navigator.canShare?.({ files: [arquivo.value] }))

async function marcarEnviado() {
  avisoDoEnvio.value = ''
  try {
    const r = await props.chamar('vessel_convite_marcar', { p_id: props.convidada.id, p_marca: 'enviado' })
    if (!r?.ok) throw new Error()
    emit('enviado')
  } catch { avisoDoEnvio.value = 'O convite saiu, mas não consegui marcar "Convite enviado". Marque no cartão dela.' }
}

async function compartilhar() {
  try { await navigator.share({ files: [arquivo.value] }); await marcarEnviado() }
  catch { /* a pessoa desistiu do compartilhamento: nada a marcar */ }
}

async function copiar() {
  try {
    await navigator.clipboard.writeText(mensagem.value)
    copiado.value = true
    setTimeout(() => { copiado.value = false }, 2000)
    await marcarEnviado()
  } catch { /* o texto continua na tela para ser selecionado à mão */ }
}

onMounted(async () => {
  try {
    const c = await props.chamar('vessel_chave_da_convidada', { p_id: props.convidada.id })
    if (!c?.ok) throw new Error('chave')
    link.value = linkDaConvidada(c.chave_encontro, c.chave)
    if (!link.value) throw new Error('link')
    const tela = await desenharConvite({
      convidada: props.convidada.nome, stylist: props.encontro.anfitria,
      quando: props.encontro.quando, local: props.encontro.local,
    })
    const blob = await new Promise((ok) => tela.toBlob(ok, 'image/png'))
    arquivo.value = new File([blob], nomeDoArquivo(props.convidada.nome, props.encontro.quando), { type: 'image/png' })
    imagem.value = URL.createObjectURL(blob)
  } catch {
    erro.value = 'Não consegui preparar o cartão agora. Feche e tente de novo em um instante.'
  }
})
onBeforeUnmount(() => { if (imagem.value) URL.revokeObjectURL(imagem.value) })
</script>

<style scoped>
@import './estilo-comercial.css';
.cv-cartao-previa { width: 100%; height: auto; border: 1px solid var(--border); border-radius: var(--radius-md); display: block; }
.cv-mensagem { white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
```

- [ ] **Step 5: Ligar na tela do Private Edit** — em `tela-de-private-edit.vue`:
  1. No cartão de cada convidada, depois da linha `<p class="cv-sub">Ficha de cliente nº …</p>`, inserir:

```vue
                    <p class="cv-sub">{{ c.convite_aberto_em
                      ? `abriu o convite em ${dataHoraLegivel(c.convite_aberto_em)} (${c.convite_aberturas}×)`
                      : (c.convite_enviado_em ? 'ainda não abriu o convite' : '') }}</p>
```
  2. Na `<div class="cv-acoes">` do cartão da convidada, antes do `v-for` dos gestos, inserir:
     `<button type="button" class="btn" @click="cartaoAberto = { convidada: c, encontro: e }">Cartão e mensagem</button>`
  3. Antes do `</div>` final do template (o que fecha `.tela-pe`), inserir:

```vue
    <cartao-da-convidada v-if="cartaoAberto" :convidada="cartaoAberto.convidada" :encontro="cartaoAberto.encontro"
                         :telefone-da-stylist="(stylists.find((s) => s.codigo === cartaoAberto.encontro.stylist) || {}).whatsapp || ''"
                         :chamar="chamar" @fechar="cartaoAberto = null"
                         @enviado="buscarConvidadas(cartaoAberto.encontro, { silencioso: true })" />
```
  4. No script: `import CartaoDaConvidada from './cartao-da-convidada.vue'` e `const cartaoAberto = ref(null)`.

- [ ] **Step 6: Rodar** — `npm test` → `fail 0`; `npx vite build --logLevel error` → sem saída.

- [ ] **Step 7: Commit**

```bash
git add public/cartao-private-edit/fundo.png public/cartao-private-edit/logomarca-escura.png public/cartao-private-edit/fontes/vessel-versatile.woff2 public/cartao-private-edit/fontes/vessel-versatile-light.woff2 public/cartao-private-edit/fontes/vessel-angeletta.woff2 src/ferramentas/comercial-vessel/desenhar-convite.js src/ferramentas/comercial-vessel/cartao-da-convidada.vue src/ferramentas/comercial-vessel/tela-de-private-edit.vue src/ferramentas/comercial-vessel/convite-da-convidada-regras.test.mjs
git commit -m "feat(T11): cartao e mensagem da convidada, com link rastreado"
```

---

### Task 7: Fotos das telas (quadro, ficha, cartão) e o PNG

**Files:** laboratório fora do repositório: `$SCRATCH/fotos-t11.mjs` e `$SCRATCH/passo.mjs` (já existem; somar cenários).

- [ ] **Step 1:** Subir `npx vite --port 5207 --strictPort` no worktree (em segundo plano).
- [ ] **Step 2:** No laboratório, acrescentar às `LEITURAS`: `vessel_stylist_contatos` (3 contatos de exemplo), `vessel_chave_da_convidada` → `{ ok: true, chave: 'H3N8P4WZ', chave_encontro: 'K7Q2M9TX' }`; nos stylists de exemplo, `contatos`/`ultimo_contato_em`; nas convidadas, `chave_convite`/`convite_aberto_em`/`convite_aberturas`; no placar, `contatos_ate_ativar: 3.4, stylists_com_contatos_ate_ativar: 2`.
- [ ] **Step 3:** Fotografar a 375 e 1440, claro e escuro: quadro (uma etapa no celular, colunas no computador), ficha aberta com histórico e sugestão, janela "Cartão e mensagem" com a prévia; salvar o PNG gerado (`canvas.toDataURL` via `page.evaluate` no `<img>` da prévia) e olhar a imagem.
- [ ] **Step 4:** Medir: rolagem horizontal 0; nenhum botão novo < 40px; nenhum campo novo < 16px; nenhum texto cortado; nenhuma escrita saiu do navegador. Corrigir o que falhar e repetir.
- [ ] **Step 5:** Refazer o passo a passo HTML (arquivo único, imagens embutidas) com os passos novos, v2, na Mesa e em `~/Downloads/Growth Vessel/`; conferir 0 imagens quebradas.

---

### Task 8: O site — rota e página do convite personalizado

**Files (repositório `~/iamundi/vessel-brasil`, em worktree próprio `arvores/convite-da-convidada` a partir de `origin/main`):**
- Modify: `regras-da-private-edit.mjs`, `regras-da-private-edit.test.mjs`, `vercel.json`, `private-edit/index.html`

- [ ] **Step 1: Teste** (acrescentar a `regras-da-private-edit.test.mjs`)

```js
import { convidadaDoEndereco } from './regras-da-private-edit.mjs'
test('a chave da convidada vem da terceira parte do endereço', () => {
  assert.equal(convidadaDoEndereco('/pe/K7Q2M9TX/h3n8p4wz'), 'H3N8P4WZ')
  assert.equal(convidadaDoEndereco('/pe/K7Q2M9TX'), null)
  assert.equal(convidadaDoEndereco('/pe/K7Q2M9TX/O0I1ABCD'), null)
  assert.equal(convidadaDoEndereco('/x/K7Q2M9TX/H3N8P4WZ'), null)
})
```

- [ ] **Step 2:** `npm test` → FAIL (`convidadaDoEndereco` não existe).
- [ ] **Step 3: Implementar** (em `regras-da-private-edit.mjs`, depois de `chaveDoEndereco`)

```js
/** A chave da convidada, lida de `/pe/<encontro>/<convidada>` — ou null. */
export function convidadaDoEndereco(caminho) {
  const partes = String(caminho || '').split('/').filter(Boolean);
  if (partes[0] !== 'pe' || !partes[1] || !partes[2]) return null;
  const chave = decodeURIComponent(partes[2]).toUpperCase();
  return FORMATO_DA_CHAVE.test(chave) ? chave : null;
}
```

- [ ] **Step 4: Rota** — em `vercel.json`, logo antes de `{ "source": "/pe/:chave", … }`:

```json
    {
      "source": "/pe/:chave/:convidada",
      "destination": "/private-edit/index.html"
    },
```

- [ ] **Step 5: Página** — em `private-edit/index.html`:
  1. Import: acrescentar `convidadaDoEndereco` ao import de `/regras-da-private-edit.mjs`.
  2. Depois de `const chave = chaveDoEndereco(location.pathname);`: `const convidada = convidadaDoEndereco(location.pathname);`
  3. Em `abrirConvite()`, trocar o `fetch` por:

```js
    const fn = convidada ? 'vessel_convite_da_convidada' : 'vessel_convite_da_private_edit';
    const corpo = convidada ? { p_chave: chave, p_convidada: convidada } : { p_chave: chave };
    const r = await fetch(`${BANCO}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
    });
```
  4. No ramo `else` (convite bom), depois de `$('formulario').hidden = false;`:

```js
  /* ⚠️ COM O LINK DELA, A PÁGINA JÁ SABE QUEM É: não pede nome nem WhatsApp.
   * Só o primeiro nome aparece — o link pode ter sido repassado. */
  if (convite.primeiro_nome) {
    $('saudacao').hidden = false;
    $('saudacao').textContent = `Olá, ${convite.primeiro_nome}.`;
    for (const id of ['campo-nome', 'campo-whatsapp']) $(id).hidden = true;
    for (const id of ['nome', 'pais', 'ddd', 'whatsapp']) $(id).required = false;
  }
```
  5. No HTML: antes de `<p class="encontro" id="encontro" hidden>`, `<p class="encontro" id="saudacao" hidden></p>`; dar `id="campo-nome"` ao `<label class="campo" for="nome">` e `id="campo-whatsapp"` ao `<div class="campo">` do WhatsApp.
  6. No `submit`, logo depois de montar `dados`, antes de `problemasDoRsvp`:

```js
  if (convite.primeiro_nome) {
    if (!dados.resposta) { $('erro').textContent = RECUSAS.resposta_invalida; $('erro').hidden = false; return; }
    $('enviar').disabled = true;
    const rotuloP = $('enviar').textContent;
    $('enviar').textContent = 'Enviando…';
    try {
      const r = await fetch(`${BANCO}/rest/v1/rpc/vessel_rsvp_da_convidada`, {
        method: 'POST',
        headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_chave: chave, p_convidada: convidada, p_resposta: dados.resposta,
          p_aceite_marketing: $('marketing').checked, p_aceite_versao: VERSAO_DO_ACEITE, p_armadilha: $('empresa').value }),
      });
      const resposta = r.ok ? await r.json() : null;
      if (!resposta?.ok) throw new Error(resposta?.situacao || `o servidor respondeu ${r.status}`);
      $('formulario').hidden = true;
      $('feito').hidden = false;
    } catch (erro) {
      $('erro').textContent = 'Não foi possível enviar agora. Tente novamente ou fale com nossa equipe. (' + erro.message + ')';
      $('erro').hidden = false;
    } finally {
      $('enviar').disabled = false;
      $('enviar').textContent = rotuloP;
    }
    return;
  }
```

- [ ] **Step 6:** `npm test` no site → `fail 0`. Abrir a página local (`npx serve .` ou o servidor que o LEIA-ME do site indicar) com a rede do Supabase interceptada no laboratório: com chave de convidada → "Olá, Beatriz." sem campos de nome/WhatsApp; sem ela → igual a hoje. Fotografar a 375.
- [ ] **Step 7: Commit** (no worktree do site)

```bash
git add regras-da-private-edit.mjs regras-da-private-edit.test.mjs vercel.json private-edit/index.html
git commit -m "feat: convite com o link da propria convidada (/pe/<encontro>/<convidada>)"
```

---

### Task 9: Publicar (SÓ com o "pode publicar" do dono)

- [ ] **Step 1:** `git fetch` nos dois repositórios; rebase das duas branches no `origin/main`; `npm test` e build de novo.
- [ ] **Step 2:** Banco: `node coletor/aplicar-vessel-t11-bases-do-stylist-circle.mjs` (ensaio) → `✅`; depois `--gravar` → `✅ aplicada e registrada` e a conferência pós-commit numa conexão nova.
- [ ] **Step 3:** Central: PR da `feat/t11-bases-stylist-circle` para `main` em `rbv-co/social-dashboard` (corpo com o que muda e as provas); merge; conferir o hash do `index-*.js` no ar (`curl -s --compressed https://socialdashboard.rbvcompany.com/ | grep -o 'index-[^"]*\.js'`) contra o `dist/` local.
- [ ] **Step 4:** Site: PR/merge no `rbv-co/vessel-brasil`; conferir o GitHub Actions `publicar-o-site.yml` verde; `curl -sI https://vesselbrasil.com.br/pe/XXXXXXXX/YYYYYYYY` → 200.
- [ ] **Step 5:** Prova no ar: com um encontro e uma convidada `teste`, abrir o link individual no site publicado, responder, conferir `rsvp` e `convite_aberto_em` no banco; apagar o encontro de teste.
- [ ] **Step 6:** Atualizar `docs/pendencias.md` (se houver item da T11) e a memória do projeto.
