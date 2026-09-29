# Mensagem de recuperação de checkout — Plano de implementação

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA: `superpowers:subagent-driven-development` (recomendada) ou `superpowers:executing-plans`. Os passos usam checkbox (`- [ ]`).

**Objetivo:** enviar **uma** mensagem de WhatsApp (template aprovado, via Chatwoot) a quem está na Fila de mensagens, com travas para nunca sair sem querer.

**Arquitetura:** o `pg_cron` chama uma edge a cada minuto. Ela reserva no banco os checkouts elegíveis (trava `skip locked`), aplica regras puras (telefone, bloqueio, horário, link), fala com a API do Chatwoot (contato → conversa → template) e grava o resultado. O robô nasce `desligado`. Um webhook padrão do Chatwoot (mensagem recebida) alimenta a lista de bloqueados.

**Tecnologias:** Supabase (Postgres, pg_cron, Edge Functions em Deno), JS puro com `node:test`, Vue 3 (a tela).

**Spec:** `docs/superpowers/specs/2026-09-29-mensagem-de-abandono-design.md`

## Restrições globais

- Comentários e textos de tela em **português**; identificadores como no código vizinho (`fila_envio`, `filaEnvio`).
- **Nunca** ler, procurar ou colar credenciais do Chatwoot em código, testes ou commits. Elas são segredos do Supabase, gravados pelo dono.
- Migrations **idempotentes** (`if not exists`, `create or replace`, `drop ... if exists`); funções de escrita `security definer` + `set search_path = public` + `revoke ... from public, anon, authenticated` + `grant ... to service_role`.
- Tabelas com dado pessoal: RLS ligada, **sem** policy de escrita.
- Edge publicada com `--no-verify-jwt`; função de cron protegida por `exigirSegredoDeCron(req, nome)`.
- Tela: só tokens de cor (`var(--...)`), nada de hex, checagem em 375px.
- Testes: `node --test <arquivo>`; a suíte inteira (`npm test`) tem **38 falhas que já existem na `main`** (coletor/fábrica). O critério é **não subir esse número**.
- Modo do robô: `ENVIO_MODO` = `desligado` (padrão) | `seco` | `lista` | `ligado`. **Nunca** ligar `ligado` sem passar por `seco` e `lista`.

## Foco da revisão

1. **Telefone** em formatos reais: com/sem `+55`, com máscara, fixo de 10 dígitos, sem o 9 → só celular válido segue; o resto vira `ignorada`. (Task 1)
2. **21:00 e 08:00 em ponto** no horário de Brasília: 08:00 entra, 21:00 não. (Task 1)
3. **Duas execuções ao mesmo tempo** não pegam o mesmo checkout; item que ficou `enviando` por mais de 10 min volta a ser elegível. (Task 2)
4. **Quem voltou para a fila depois de um Pix expirado** e já recebeu **não** recebe de novo. (Task 2)
5. **Template não aprovado (4xx)** não pode ficar em laço de retentativa; **401/403 para a rodada inteira** sem marcar os leads como falha. (Tasks 3 e 4)
6. **Nome vazio, nulo ou gigante** vira "cliente"/truncado, nunca "null". Link que não começa com a base fixa vira `ignorada / sem_link`. (Task 1)

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `supabase/functions/_shared/mensagem-de-abandono.js` | Regras puras: nome, telefone, janela, link, `decidirEnvio`, montar `template_params`. |
| `supabase/functions/_shared/cliente-chatwoot.js` | Cliente HTTP do Chatwoot (`fetch` injetável) e classificação de erro. |
| `supabase/functions/_shared/opt-out.js` | Reconhece o pedido "não quero receber" no payload do Chatwoot. |
| `db/migrations/2026-09-30-zzy-mensagem-de-abandono.sql` | Colunas de estado, tabela de bloqueados, funções de reserva/resultado. |
| `db/migrations/2026-09-30-zzz-enviar-mensagem-abandono-cron.sql` | Segredo de cron, agenda de 1 min, vigia. |
| `supabase/functions/enviar-mensagem-abandono/index.ts` | O robô (modos, laço, gravação). |
| `supabase/functions/receber-opt-out-chatwoot/index.ts` | Webhook de mensagem recebida → bloqueados. |
| `src/ferramentas/abandono-carrinho/*` | Selo de mensagem na tela. |
| `coletor/verificar-chatwoot.mjs` | Script de verificação com o número do dono. |

---

### Task 1: Regras puras da mensagem

**Files:**
- Create: `supabase/functions/_shared/mensagem-de-abandono.js`
- Test: `supabase/functions/_shared/mensagem-de-abandono.test.mjs`

**Interfaces:**
- Produces:
  - `primeiroNome(nome: unknown): string` (nunca vazio; `'cliente'` no fallback; máx. 30 caracteres)
  - `normalizarTelefone(bruto: unknown): string | null` (só dígitos, `55` + DDD + 9 + 8 dígitos = 13 dígitos)
  - `dentroDaJanela(agora?: Date): boolean` (08:00 ≤ hora < 21:00, `America/Sao_Paulo`)
  - `sufixoDoLink(url: unknown, base: string): string | null`
  - `montarTemplateParams({ nomeTemplate, idioma, nome, sufixoUrl }): object`
  - `decidirEnvio({ linha, bloqueados: Set<string>, agora?: Date, baseLink: string })`: `{acao:'enviar', telefone, nome, sufixoUrl} | {acao:'ignorar', motivo} | {acao:'esperar', motivo:'fora_da_janela'}`

- [ ] **Step 1: Escrever os testes que falham**

```js
// supabase/functions/_shared/mensagem-de-abandono.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  primeiroNome, normalizarTelefone, dentroDaJanela, sufixoDoLink, montarTemplateParams, decidirEnvio,
} from './mensagem-de-abandono.js'

test('primeiroNome: só o primeiro nome, com fallback e teto', () => {
  assert.equal(primeiroNome('Luis Magrin'), 'Luis')
  assert.equal(primeiroNome('  Ana   Paula '), 'Ana')
  for (const v of [null, undefined, '', '   ', 42]) assert.equal(primeiroNome(v), 'cliente')
  assert.equal(primeiroNome('A'.repeat(80)).length, 30)
})

test('⚠️ normalizarTelefone: só celular brasileiro válido (55 + DDD + 9 + 8 dígitos)', () => {
  assert.equal(normalizarTelefone('19982621828'), '5519982621828')
  assert.equal(normalizarTelefone('+5519982621828'), '5519982621828')
  assert.equal(normalizarTelefone('(19) 98262-1828'), '5519982621828')
  assert.equal(normalizarTelefone('+55 19 98262-1828'), '5519982621828')
  assert.equal(normalizarTelefone('005519982621828'), '5519982621828')
  for (const ruim of ['1932221828', '', 'abc', '5511', '551998262182', '5504982621828', null, 12345678901]) {
    assert.equal(normalizarTelefone(ruim), null, `deveria rejeitar ${ruim}`)
  }
})

test('⚠️ dentroDaJanela: 08:00 entra, 21:00 não (horário de Brasília, UTC-3)', () => {
  assert.equal(dentroDaJanela(new Date('2026-09-29T10:59:59Z')), false) // 07:59
  assert.equal(dentroDaJanela(new Date('2026-09-29T11:00:00Z')), true)  // 08:00
  assert.equal(dentroDaJanela(new Date('2026-09-29T23:59:59Z')), true)  // 20:59
  assert.equal(dentroDaJanela(new Date('2026-09-30T00:00:00Z')), false) // 21:00
  assert.equal(dentroDaJanela(new Date('2026-09-29T05:00:00Z')), false) // 02:00
})

test('sufixoDoLink: parte depois da base fixa; base diferente ou vazia vira null', () => {
  const base = 'https://loja.com.br/'
  assert.equal(sufixoDoLink('https://loja.com.br/123/checkouts/abc/recover?key=k', base), '123/checkouts/abc/recover?key=k')
  assert.equal(sufixoDoLink('https://outra.com/x', base), null)
  assert.equal(sufixoDoLink('https://loja.com.br/', base), null)
  assert.equal(sufixoDoLink(null, base), null)
})

test('montarTemplateParams: nome no corpo, sufixo no PRIMEIRO botão, categoria MARKETING', () => {
  assert.deepEqual(
    montarTemplateParams({ nomeTemplate: 'recuperacao_checkout_v1', idioma: 'pt_BR', nome: 'Luis Magrin', sufixoUrl: 'x/y' }),
    {
      name: 'recuperacao_checkout_v1', category: 'MARKETING', language: 'pt_BR',
      processed_params: { body: { '1': 'Luis' }, buttons: [{ type: 'url', parameter: 'x/y' }] },
    })
})

const BASE = 'https://loja.com.br/'
const linha = (extra = {}) => ({
  status: 'fila_envio', telefone: '19982621828', nome: 'Luis Magrin',
  url_de_recuperacao: BASE + '1/checkouts/t/recover?key=k', ...extra,
})
const DENTRO = new Date('2026-09-29T15:00:00Z') // 12:00
const decidir = (l, extra = {}) => decidirEnvio({ linha: l, bloqueados: new Set(), agora: DENTRO, baseLink: BASE, ...extra })

test('decidirEnvio: caminho feliz', () => {
  assert.deepEqual(decidir(linha()), { acao: 'enviar', telefone: '5519982621828', nome: 'Luis Magrin', sufixoUrl: '1/checkouts/t/recover?key=k' })
})

test('decidirEnvio: motivos de ignorar, na ordem certa', () => {
  assert.equal(decidir(linha({ status: 'comprou' })).motivo, 'nao_esta_mais_na_fila')
  assert.equal(decidir(linha({ telefone: null })).motivo, 'sem_telefone')
  assert.equal(decidir(linha({ telefone: '  ' })).motivo, 'sem_telefone')
  assert.equal(decidir(linha({ telefone: '1932221828' })).motivo, 'telefone_invalido')
  assert.equal(decidir(linha(), { bloqueados: new Set(['5519982621828']) }).motivo, 'pediu_para_nao_receber')
  assert.equal(decidir(linha({ url_de_recuperacao: 'https://outra.com/x' })).motivo, 'sem_link')
})

test('decidirEnvio: fora do horário espera (e só depois de validar o resto)', () => {
  const noite = new Date('2026-09-30T02:00:00Z') // 23:00
  assert.deepEqual(decidir(linha(), { agora: noite }), { acao: 'esperar', motivo: 'fora_da_janela' })
  assert.equal(decidir(linha({ telefone: null }), { agora: noite }).acao, 'ignorar')
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test supabase/functions/_shared/mensagem-de-abandono.test.mjs`
Expected: FAIL (`Cannot find module './mensagem-de-abandono.js'`).

- [ ] **Step 3: Implementar**

```js
// supabase/functions/_shared/mensagem-de-abandono.js
//
// Regras PURAS do robô de mensagens de recuperação (sem rede, sem banco). Quem executa é
// a edge `enviar-mensagem-abandono`. Ver docs/superpowers/specs/2026-09-29-mensagem-de-abandono-design.md.

const FUSO = 'America/Sao_Paulo'
export const JANELA_INICIO = 8   // 08:00 entra
export const JANELA_FIM = 21     // 21:00 não entra

/** Só o primeiro nome. Nunca devolve vazio: o template exige a variável preenchida. */
export function primeiroNome(nome) {
  if (typeof nome !== 'string') return 'cliente'
  const primeiro = nome.trim().split(/\s+/)[0]
  if (!primeiro) return 'cliente'
  return primeiro.slice(0, 30)
}

/**
 * Celular brasileiro no formato que o Chatwoot/WhatsApp usa como source_id: só dígitos,
 * `55` + DDD (2, sem zero) + `9` + 8 dígitos = 13. Fixo (10 dígitos) e celular sem o 9 NÃO
 * recebem WhatsApp de forma confiável: viram null e o item é ignorado.
 */
export function normalizarTelefone(bruto) {
  if (typeof bruto !== 'string') return null
  let d = bruto.replace(/\D/g, '')
  if (d.startsWith('00')) d = d.slice(2)
  if (d.length === 10 || d.length === 11) d = '55' + d
  return /^55[1-9][1-9]9\d{8}$/.test(d) ? d : null
}

/** 08:00 ≤ hora < 21:00 em Brasília (o Brasil não tem horário de verão desde 2019). */
export function dentroDaJanela(agora = new Date()) {
  const hora = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: FUSO }).format(agora))
  return hora >= JANELA_INICIO && hora < JANELA_FIM
}

/** O link dinâmico do template = parte FIXA + um sufixo variável. Fora da base fixa: null. */
export function sufixoDoLink(url, base) {
  if (typeof url !== 'string' || !url.startsWith(base)) return null
  return url.slice(base.length) || null
}

/**
 * `template_params` no formato que o Chatwoot aceita (app/models/message.rb).
 * ⚠️ O botão de URL precisa ser o PRIMEIRO botão do template: o Chatwoot usa a posição no array.
 */
export function montarTemplateParams({ nomeTemplate, idioma, nome, sufixoUrl }) {
  return {
    name: nomeTemplate,
    category: 'MARKETING',
    language: idioma,
    processed_params: {
      body: { '1': primeiroNome(nome) },
      buttons: [{ type: 'url', parameter: sufixoUrl }],
    },
  }
}

/** Decide o que fazer com UMA linha da fila. `bloqueados` = Set de telefones já normalizados. */
export function decidirEnvio({ linha, bloqueados, agora = new Date(), baseLink }) {
  if (linha.status !== 'fila_envio') return { acao: 'ignorar', motivo: 'nao_esta_mais_na_fila' }
  if (typeof linha.telefone !== 'string' || !linha.telefone.trim()) return { acao: 'ignorar', motivo: 'sem_telefone' }
  const telefone = normalizarTelefone(linha.telefone)
  if (!telefone) return { acao: 'ignorar', motivo: 'telefone_invalido' }
  if (bloqueados.has(telefone)) return { acao: 'ignorar', motivo: 'pediu_para_nao_receber' }
  const sufixoUrl = sufixoDoLink(linha.url_de_recuperacao, baseLink)
  if (!sufixoUrl) return { acao: 'ignorar', motivo: 'sem_link' }
  if (!dentroDaJanela(agora)) return { acao: 'esperar', motivo: 'fora_da_janela' }
  return { acao: 'enviar', telefone, nome: linha.nome, sufixoUrl }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test supabase/functions/_shared/mensagem-de-abandono.test.mjs`
Expected: PASS (8 testes).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/mensagem-de-abandono.js supabase/functions/_shared/mensagem-de-abandono.test.mjs
git commit -m "feat: regras puras do robo de mensagens de abandono (telefone, janela, link, decisao)"
```

---

### Task 2: Banco — estado da mensagem, bloqueados, reserva

**Files:**
- Create: `db/migrations/2026-09-30-zzy-mensagem-de-abandono.sql`
- Test: `db/mensagem-de-abandono.test.mjs`

**Interfaces:**
- Produces (SQL):
  - colunas em `checkout_abandono`: `mensagem_status`, `mensagem_reservada_em`, `mensagem_enviada_em`, `mensagem_motivo`, `mensagem_tentativas`, `chatwoot_conversation_id`
  - tabela `contatos_sem_mensagem(telefone text pk, motivo text, criado_em)`
  - `pegar_para_mensagem(p_limite int, p_atraso_min int, p_reservar boolean default true, p_ultimos11 text[] default null) returns setof checkout_abandono`
  - `marcar_mensagem(p_token text, p_status text, p_motivo text default null, p_conversa bigint default null) returns void`
  - `devolver_mensagem(p_token text, p_contar boolean) returns void`
  - `liberar_mensagens_travadas() returns int`

- [ ] **Step 1: Escrever o teste de texto que falha**

```js
// db/mensagem-de-abandono.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SQL = readFileSync(join(dirname(fileURLToPath(import.meta.url)),
  'migrations/2026-09-30-zzy-mensagem-de-abandono.sql'), 'utf8')

test('estado da mensagem: os quatro valores e nulo', () => {
  assert.match(SQL, /mensagem_status is null or mensagem_status in \('enviando', 'enviada', 'falhou', 'ignorada'\)/)
})

test('⚠️ reserva sem duplicar: skip locked, só fila_envio ainda sem mensagem', () => {
  const fn = SQL.slice(SQL.indexOf('function public.pegar_para_mensagem'), SQL.indexOf('function public.marcar_mensagem'))
  assert.match(fn, /for update skip locked/)
  assert.match(fn, /status = 'fila_envio' and mensagem_status is null/)
  assert.match(fn, /mensagem_status = 'enviando'/)
})

test('⚠️ quem já recebeu (enviada) nunca é escolhido de novo: o filtro é mensagem_status is null', () => {
  const fn = SQL.slice(SQL.indexOf('function public.pegar_para_mensagem'), SQL.indexOf('function public.marcar_mensagem'))
  assert.equal((fn.match(/mensagem_status is null/g) || []).length, 2) // caminho que reserva e caminho seco
})

test('finalizar só vale para quem está enviando; devolver conta tentativa e esgota em 3', () => {
  assert.match(SQL, /where token = p_token\s+and mensagem_status = 'enviando'/)
  assert.match(SQL, /mensagem_tentativas \+ 1 >= 3/)
  assert.match(SQL, /'tentativas_esgotadas'/)
})

test('travados: enviando há mais de 10 min volta a ser elegível', () => {
  assert.match(SQL, /mensagem_reservada_em < now\(\) - interval '10 minutes'/)
})

test('⚠️ bloqueados: RLS ligada, sem policy, fechada para anon/authenticated', () => {
  assert.match(SQL, /alter table public\.contatos_sem_mensagem enable row level security/)
  assert.match(SQL, /revoke all on public\.contatos_sem_mensagem from anon, authenticated/)
  assert.ok(!/create policy[^;]*contatos_sem_mensagem/i.test(SQL))
})

test('⚠️ funções de escrita: security definer, search_path fixo, só o service_role executa', () => {
  assert.equal((SQL.match(/security definer/g) || []).length, 4)
  assert.equal((SQL.match(/set search_path = public/g) || []).length, 4)
  assert.equal((SQL.match(/from public, anon, authenticated;/g) || []).length, 4)
  assert.equal((SQL.match(/to service_role;/g) || []).length, 4)
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test db/mensagem-de-abandono.test.mjs`
Expected: FAIL (`ENOENT ... 2026-09-30-zzy-mensagem-de-abandono.sql`).

- [ ] **Step 3: Escrever a migration**

```sql
-- 2026-09-30-zzy-mensagem-de-abandono.sql
-- ESTADO DA MENSAGEM DE RECUPERAÇÃO + LISTA DE BLOQUEADOS.
-- Design: docs/superpowers/specs/2026-09-29-mensagem-de-abandono-design.md
--
-- `fila_envio` (o status) é a "Fila de mensagens" da tela. A mensagem em si tem estado PRÓPRIO
-- (mensagem_status), porque um checkout pode voltar para `fila_envio` depois de um Pix
-- expirado: se já recebeu, o `mensagem_status = 'enviada'` o impede de receber de novo.

alter table public.checkout_abandono
  add column if not exists mensagem_status text,
  add column if not exists mensagem_reservada_em timestamptz,
  add column if not exists mensagem_enviada_em timestamptz,
  add column if not exists mensagem_motivo text,
  add column if not exists mensagem_tentativas int not null default 0,
  add column if not exists chatwoot_conversation_id bigint;

alter table public.checkout_abandono drop constraint if exists checkout_abandono_mensagem_status_check;
alter table public.checkout_abandono add constraint checkout_abandono_mensagem_status_check
  check (mensagem_status is null or mensagem_status in ('enviando', 'enviada', 'falhou', 'ignorada'));

create index if not exists checkout_abandono_fila_mensagem_idx
  on public.checkout_abandono (fila_envio_em)
  where status = 'fila_envio' and mensagem_status is null;

-- Quem pediu para não receber. Telefone JÁ normalizado (55 + DDD + 9 + 8 dígitos).
create table if not exists public.contatos_sem_mensagem (
  telefone  text primary key,
  motivo    text,
  criado_em timestamptz not null default now()
);
alter table public.contatos_sem_mensagem enable row level security;
revoke all on public.contatos_sem_mensagem from anon, authenticated;
comment on table public.contatos_sem_mensagem is
  'Telefones que pediram para nao receber. RLS sem policies: so o service role le e grava.';

-- Reserva os próximos da fila. Com p_reservar = false só LÊ (modo seco). p_ultimos11 = filtro
-- opcional pelos últimos 11 dígitos do telefone (modo lista: só os números do dono).
create or replace function public.pegar_para_mensagem(
  p_limite int, p_atraso_min int, p_reservar boolean default true, p_ultimos11 text[] default null
) returns setof public.checkout_abandono
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_reservar then
    return query
    with alvo as (
      select token from public.checkout_abandono
       where status = 'fila_envio' and mensagem_status is null
         and fila_envio_em <= now() - make_interval(mins => p_atraso_min)
         and (p_ultimos11 is null
              or right(regexp_replace(coalesce(telefone, ''), '\D', '', 'g'), 11) = any (p_ultimos11))
       order by fila_envio_em
       limit p_limite
       for update skip locked
    )
    update public.checkout_abandono c
       set mensagem_status = 'enviando', mensagem_reservada_em = now()
      from alvo
     where c.token = alvo.token
    returning c.*;
  else
    return query
    select c.* from public.checkout_abandono c
     where c.status = 'fila_envio' and c.mensagem_status is null
       and c.fila_envio_em <= now() - make_interval(mins => p_atraso_min)
       and (p_ultimos11 is null
            or right(regexp_replace(coalesce(c.telefone, ''), '\D', '', 'g'), 11) = any (p_ultimos11))
     order by c.fila_envio_em
     limit p_limite;
  end if;
end;
$$;

-- Resultado final. Só finaliza quem está `enviando` (não sobrescreve outro estado).
create or replace function public.marcar_mensagem(
  p_token text, p_status text, p_motivo text default null, p_conversa bigint default null
) returns void
language sql
security definer
set search_path = public
as $$
  update public.checkout_abandono
     set mensagem_status          = p_status,
         mensagem_motivo          = p_motivo,
         chatwoot_conversation_id = coalesce(p_conversa, chatwoot_conversation_id),
         mensagem_enviada_em      = case when p_status = 'enviada' then now() else mensagem_enviada_em end
   where token = p_token
     and mensagem_status = 'enviando';
$$;

-- Devolve à fila. p_contar = true conta uma tentativa (erro de rede/5xx); na terceira, falha de vez.
create or replace function public.devolver_mensagem(p_token text, p_contar boolean)
returns void
language sql
security definer
set search_path = public
as $$
  update public.checkout_abandono
     set mensagem_tentativas   = mensagem_tentativas + case when p_contar then 1 else 0 end,
         mensagem_status       = case when p_contar and mensagem_tentativas + 1 >= 3 then 'falhou' else null end,
         mensagem_motivo       = case when p_contar and mensagem_tentativas + 1 >= 3 then 'tentativas_esgotadas' else mensagem_motivo end,
         mensagem_reservada_em = null
   where token = p_token
     and mensagem_status = 'enviando';
$$;

-- Robô que morreu no meio da rodada: quem ficou `enviando` por mais de 10 min volta a ser elegível.
create or replace function public.liberar_mensagens_travadas()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  liberados int;
begin
  update public.checkout_abandono
     set mensagem_status = null, mensagem_reservada_em = null
   where mensagem_status = 'enviando'
     and mensagem_reservada_em < now() - interval '10 minutes';
  get diagnostics liberados = row_count;
  return liberados;
end;
$$;

revoke execute on function public.pegar_para_mensagem(int, int, boolean, text[]) from public, anon, authenticated;
revoke execute on function public.marcar_mensagem(text, text, text, bigint) from public, anon, authenticated;
revoke execute on function public.devolver_mensagem(text, boolean) from public, anon, authenticated;
revoke execute on function public.liberar_mensagens_travadas() from public, anon, authenticated;
grant execute on function public.pegar_para_mensagem(int, int, boolean, text[]) to service_role;
grant execute on function public.marcar_mensagem(text, text, text, bigint) to service_role;
grant execute on function public.devolver_mensagem(text, boolean) to service_role;
grant execute on function public.liberar_mensagens_travadas() to service_role;
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test db/mensagem-de-abandono.test.mjs`
Expected: PASS (7 testes).

- [ ] **Step 5: Commit**

```bash
git add db/migrations/2026-09-30-zzy-mensagem-de-abandono.sql db/mensagem-de-abandono.test.mjs
git commit -m "feat: estado da mensagem de abandono, bloqueados e funcoes de reserva (skip locked)"
```

> **Aplicar em produção só na Task 7**, junto com o resto.

---

### Task 3: Cliente do Chatwoot

**Files:**
- Create: `supabase/functions/_shared/cliente-chatwoot.js`
- Test: `supabase/functions/_shared/cliente-chatwoot.test.mjs`

**Interfaces:**
- Produces:
  - `class ErroChatwoot extends Error { status: number; corpo: unknown; passo: string }`
  - `classificarErro(e: unknown): 'parar' | 'tentar_de_novo' | 'falhou'` (401/403 → `parar`; 429/5xx/erro de rede → `tentar_de_novo`; demais 4xx → `falhou`)
  - `criarClienteChatwoot({ url, contaId, caixaId, token, fetchFn? })` → `{ acharOuCriarContato({nome, telefone}): Promise<number>, abrirConversa({contatoId, telefone}): Promise<number>, enviarTemplate({conversaId, texto, templateParams}): Promise<number> }`

> ⚠️ **Os endereços abaixo seguem a API pública do Chatwoot, mas NÃO foram verificados contra a versão instalada.** A Task 7 confirma cada um com o número do dono. Se algum divergir, ajuste **só este arquivo** (e o teste).

- [ ] **Step 1: Escrever os testes que falham**

```js
// supabase/functions/_shared/cliente-chatwoot.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { criarClienteChatwoot, classificarErro, ErroChatwoot } from './cliente-chatwoot.js'

const json = (corpo, status = 200) => new Response(JSON.stringify(corpo), { status })

function fake(respostas) {
  const chamadas = []
  const fetchFn = async (url, init) => {
    chamadas.push({ url, metodo: init.method, cabecalhos: init.headers, corpo: init.body ? JSON.parse(init.body) : null })
    return respostas.shift()
  }
  return { chamadas, fetchFn }
}
const cliente = (fetchFn) => criarClienteChatwoot({ url: 'https://cw.exemplo.com/', contaId: 7, caixaId: 3, token: 'T', fetchFn })

test('acharOuCriarContato: usa o existente pelo telefone E.164 (busca com o token no cabeçalho)', async () => {
  const { chamadas, fetchFn } = fake([json({ payload: [{ id: 11, phone_number: '+5519982621828' }] })])
  assert.equal(await cliente(fetchFn).acharOuCriarContato({ nome: 'Luis', telefone: '5519982621828' }), 11)
  assert.equal(chamadas.length, 1)
  assert.equal(chamadas[0].url, 'https://cw.exemplo.com/api/v1/accounts/7/contacts/search?q=%2B5519982621828')
  assert.equal(chamadas[0].cabecalhos.api_access_token, 'T')
})

test('acharOuCriarContato: sem correspondência exata, cria o contato na caixa', async () => {
  const { chamadas, fetchFn } = fake([
    json({ payload: [{ id: 99, phone_number: '+5511000000000' }] }),
    json({ payload: { contact: { id: 12 } } }),
  ])
  assert.equal(await cliente(fetchFn).acharOuCriarContato({ nome: 'Luis', telefone: '5519982621828' }), 12)
  assert.deepEqual(chamadas[1].corpo, { inbox_id: 3, name: 'Luis', phone_number: '+5519982621828' })
})

test('abrirConversa e enviarTemplate: corpos e endereços', async () => {
  const { chamadas, fetchFn } = fake([json({ id: 55 }), json({ id: 66 })])
  const c = cliente(fetchFn)
  assert.equal(await c.abrirConversa({ contatoId: 12, telefone: '5519982621828' }), 55)
  assert.deepEqual(chamadas[0].corpo, { inbox_id: 3, contact_id: 12, source_id: '5519982621828' })
  const tp = { name: 't', category: 'MARKETING', language: 'pt_BR', processed_params: { body: { '1': 'Luis' } } }
  assert.equal(await c.enviarTemplate({ conversaId: 55, texto: 'oi', templateParams: tp }), 66)
  assert.equal(chamadas[1].url, 'https://cw.exemplo.com/api/v1/accounts/7/conversations/55/messages')
  assert.deepEqual(chamadas[1].corpo, { content: 'oi', message_type: 'outgoing', private: false, template_params: tp })
})

test('resposta não-2xx vira ErroChatwoot com passo, status e corpo', async () => {
  const { fetchFn } = fake([json({ error: 'template' }, 422)])
  await assert.rejects(
    () => cliente(fetchFn).enviarTemplate({ conversaId: 1, texto: 'x', templateParams: {} }),
    (e) => e instanceof ErroChatwoot && e.status === 422 && e.passo === 'enviar_template' && e.corpo.error === 'template')
})

test('⚠️ classificarErro: 401/403 para; 429, 5xx e rede tentam de novo; 4xx (template não aprovado) falha sem laço', () => {
  const e = (status) => new ErroChatwoot(status, null, 'x')
  assert.equal(classificarErro(e(401)), 'parar')
  assert.equal(classificarErro(e(403)), 'parar')
  assert.equal(classificarErro(e(429)), 'tentar_de_novo')
  assert.equal(classificarErro(e(502)), 'tentar_de_novo')
  assert.equal(classificarErro(new TypeError('fetch failed')), 'tentar_de_novo')
  assert.equal(classificarErro(e(422)), 'falhou')
  assert.equal(classificarErro(e(404)), 'falhou')
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test supabase/functions/_shared/cliente-chatwoot.test.mjs`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar**

```js
// supabase/functions/_shared/cliente-chatwoot.js
//
// Cliente mínimo da API do Chatwoot para o robô de mensagens de abandono. `fetchFn` injetável:
// o teste não envia nada. ⚠️ Endereços conforme a API pública do Chatwoot; a Task 7 do plano os
// confirma contra a versão instalada. O token NUNCA aparece em log nem em mensagem de erro.

export class ErroChatwoot extends Error {
  constructor(status, corpo, passo) {
    super(`chatwoot ${passo}: HTTP ${status}`)
    this.status = status
    this.corpo = corpo
    this.passo = passo
  }
}

/** 401/403 -> parar a rodada (credencial); 429/5xx/rede -> tentar de novo; demais 4xx -> falhou. */
export function classificarErro(e) {
  if (!(e instanceof ErroChatwoot)) return 'tentar_de_novo'
  if (e.status === 401 || e.status === 403) return 'parar'
  if (e.status === 429 || e.status >= 500) return 'tentar_de_novo'
  return 'falhou'
}

export function criarClienteChatwoot({ url, contaId, caixaId, token, fetchFn = fetch }) {
  const base = `${url.replace(/\/$/, '')}/api/v1/accounts/${contaId}`

  async function chamar(passo, caminho, { metodo = 'GET', corpo } = {}) {
    const r = await fetchFn(base + caminho, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', api_access_token: token },
      body: corpo ? JSON.stringify(corpo) : undefined,
    })
    const texto = await r.text()
    let json = null
    try { json = texto ? JSON.parse(texto) : null } catch { /* corpo que não é JSON: fica só o texto */ }
    if (!r.ok) throw new ErroChatwoot(r.status, json ?? texto, passo)
    return json
  }

  return {
    async acharOuCriarContato({ nome, telefone }) {
      const e164 = '+' + telefone
      const achados = await chamar('buscar_contato', `/contacts/search?q=${encodeURIComponent(e164)}`)
      const existente = (achados?.payload ?? []).find((c) => c.phone_number === e164)
      if (existente) return existente.id
      const criado = await chamar('criar_contato', '/contacts', {
        metodo: 'POST', corpo: { inbox_id: caixaId, name: nome || e164, phone_number: e164 },
      })
      return criado?.payload?.contact?.id ?? criado?.id
    },

    // Para WhatsApp, o source_id do contato na caixa é o número sem o "+".
    async abrirConversa({ contatoId, telefone }) {
      const c = await chamar('abrir_conversa', '/conversations', {
        metodo: 'POST', corpo: { inbox_id: caixaId, contact_id: contatoId, source_id: telefone },
      })
      return c?.id
    },

    async enviarTemplate({ conversaId, texto, templateParams }) {
      const m = await chamar('enviar_template', `/conversations/${conversaId}/messages`, {
        metodo: 'POST',
        corpo: { content: texto, message_type: 'outgoing', private: false, template_params: templateParams },
      })
      return m?.id
    },
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test supabase/functions/_shared/cliente-chatwoot.test.mjs`
Expected: PASS (5 testes).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/cliente-chatwoot.js supabase/functions/_shared/cliente-chatwoot.test.mjs
git commit -m "feat: cliente do Chatwoot (contato, conversa, template) com fetch injetavel e classificacao de erro"
```

---

### Task 4: O robô (`enviar-mensagem-abandono`) e o agendamento

**Files:**
- Create: `supabase/functions/enviar-mensagem-abandono/index.ts`
- Create: `db/migrations/2026-09-30-zzz-enviar-mensagem-abandono-cron.sql`
- Test: `supabase/functions/enviar-mensagem-abandono/modos.test.mjs`

**Interfaces:**
- Consumes: Task 1 (`decidirEnvio`, `montarTemplateParams`, `primeiroNome`), Task 2 (as quatro funções SQL e `contatos_sem_mensagem`), Task 3 (`criarClienteChatwoot`, `classificarErro`, `ErroChatwoot`), `exigirSegredoDeCron(req, nome)` de `_shared/segredo-de-cron.ts`.
- Produces: a edge `enviar-mensagem-abandono` e o job `enviar-mensagem-abandono` (1/min). Resposta JSON `{ ok, modo, ... }`.
- Segredos lidos: `ENVIO_MODO`, `ENVIO_SO_PARA` (números separados por vírgula), `ENVIO_LIMITE_POR_RODADA` (padrão 10), `ENVIO_ATRASO_MINUTOS` (padrão 0), `LINK_BASE`, `CHATWOOT_URL`, `CHATWOOT_CONTA_ID`, `CHATWOOT_CAIXA_ID`, `CHATWOOT_API_TOKEN`, `TEMPLATE_NOME`, `TEMPLATE_IDIOMA` (padrão `pt_BR`), `TEMPLATE_TEXTO` (opcional, com `{{1}}`).

- [ ] **Step 1: Escrever o teste de texto que falha** (a edge roda em Deno; as regras já têm teste nas Tasks 1–3)

```js
// supabase/functions/enviar-mensagem-abandono/modos.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const aqui = dirname(fileURLToPath(import.meta.url))
const TS = readFileSync(join(aqui, 'index.ts'), 'utf8')
const CRON = readFileSync(join(aqui, '../../../db/migrations/2026-09-30-zzz-enviar-mensagem-abandono-cron.sql'), 'utf8')

test('⚠️ nasce desligado: sem ENVIO_MODO o robô não faz nada, e a checagem do cron vem primeiro', () => {
  assert.match(TS, /Deno\.env\.get\('ENVIO_MODO'\) \|\| 'desligado'/)
  assert.ok(TS.indexOf('exigirSegredoDeCron') < TS.indexOf("MODO === 'desligado'"))
  assert.match(TS, /if \(MODO === 'desligado'\) return responder\(\{ ok: true, modo: MODO \}\)/)
})

test('modo desconhecido falha fechado (500), e lista sem números também', () => {
  assert.match(TS, /modo_invalido/)
  assert.match(TS, /lista_vazia/)
})

test('⚠️ modo seco não reserva nem chama o Chatwoot', () => {
  assert.match(TS, /p_reservar: MODO !== 'seco'/)
  assert.match(TS, /MODO === 'seco'[\s\S]{0,400}continue/)
})

test('⚠️ 401/403 para a rodada sem marcar o lead como falha: devolve sem contar tentativa', () => {
  assert.match(TS, /tipo === 'parar'/)
  assert.match(TS, /p_contar: false/)
})

test('só o primeiro nome vai no template e o token do Chatwoot nunca é logado', () => {
  assert.ok(!/console\.(log|error)\([^)]*CHATWOOT_API_TOKEN/.test(TS))
  assert.ok(!/console\.(log|error)\([^)]*token\b/i.test(TS.replace(/linha\.token/g, '')))
})

test('cron: 1/min, com segredo próprio e no vigia (robos_esperados)', () => {
  assert.match(CRON, /cron\.schedule\('enviar-mensagem-abandono', '\* \* \* \* \*'/)
  assert.match(CRON, /disparar_robo\('enviar-mensagem-abandono', 'enviar-mensagem-abandono', 'enviar-mensagem-abandono'/)
  assert.match(CRON, /insert into public\.segredos_de_cron/)
  assert.match(CRON, /insert into public\.robos_esperados/)
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test supabase/functions/enviar-mensagem-abandono/modos.test.mjs`
Expected: FAIL (`ENOENT ... index.ts`).

- [ ] **Step 3: Implementar a edge**

```ts
// supabase/functions/enviar-mensagem-abandono/index.ts
//
// Robô da mensagem de recuperação. Roda a cada minuto (pg_cron -> disparar_robo) e manda UMA
// mensagem de WhatsApp (template aprovado, via Chatwoot) a quem está na Fila de mensagens.
// Design: docs/superpowers/specs/2026-09-29-mensagem-de-abandono-design.md
//
// ⚠️ NASCE DESLIGADO. ENVIO_MODO: desligado (padrão: não faz nada) | seco (decide e devolve o
// que enviaria; não reserva, não chama o Chatwoot) | lista (só os telefones de ENVIO_SO_PARA) |
// ligado. Nunca ir para `ligado` sem passar por `seco` e `lista`.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { exigirSegredoDeCron } from '../_shared/segredo-de-cron.ts';
import { decidirEnvio, montarTemplateParams, primeiroNome } from '../_shared/mensagem-de-abandono.js';
import { criarClienteChatwoot, classificarErro, ErroChatwoot } from '../_shared/cliente-chatwoot.js';

const env = (nome: string) => Deno.env.get(nome) ?? '';
const MODO = Deno.env.get('ENVIO_MODO') || 'desligado';
const LIMITE = Number(env('ENVIO_LIMITE_POR_RODADA') || 10);
const ATRASO_MIN = Number(env('ENVIO_ATRASO_MINUTOS') || 0);
const SO_PARA = env('ENVIO_SO_PARA').split(',').map((n) => n.replace(/\D/g, '')).filter(Boolean);
const LINK_BASE = env('LINK_BASE');
const TEMPLATE = env('TEMPLATE_NOME');
const IDIOMA = env('TEMPLATE_IDIOMA') || 'pt_BR';

const responder = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  const negado = await exigirSegredoDeCron(req, 'enviar-mensagem-abandono');
  if (negado) return negado;

  if (MODO === 'desligado') return responder({ ok: true, modo: MODO });
  if (!['seco', 'lista', 'ligado'].includes(MODO)) return responder({ ok: false, erro: 'modo_invalido', modo: MODO }, 500);
  if (MODO === 'lista' && !SO_PARA.length) return responder({ ok: false, erro: 'lista_vazia' }, 500);

  const sb = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
  await sb.rpc('liberar_mensagens_travadas');

  const { data: linhas, error } = await sb.rpc('pegar_para_mensagem', {
    p_limite: LIMITE,
    p_atraso_min: ATRASO_MIN,
    p_reservar: MODO !== 'seco',
    p_ultimos11: MODO === 'lista' ? SO_PARA.map((n) => n.slice(-11)) : null,
  });
  if (error) return responder({ ok: false, erro: 'falha_ao_pegar', detalhe: error.message }, 500);

  const { data: bloq } = await sb.from('contatos_sem_mensagem').select('telefone');
  const bloqueados = new Set<string>((bloq ?? []).map((b: { telefone: string }) => b.telefone));

  const cliente = MODO === 'seco' ? null : criarClienteChatwoot({
    url: env('CHATWOOT_URL'), contaId: env('CHATWOOT_CONTA_ID'), caixaId: Number(env('CHATWOOT_CAIXA_ID')),
    token: env('CHATWOOT_API_TOKEN'),
  });

  const resultado: Array<Record<string, unknown>> = [];
  const pendentes = (linhas ?? []).map((l: { token: string }) => l.token);

  for (const linha of linhas ?? []) {
    const d = decidirEnvio({ linha, bloqueados, baseLink: LINK_BASE });
    const curto = String(linha.token).slice(0, 8);

    if (MODO === 'seco') {
      resultado.push({ token: curto, decisao: d.acao, motivo: 'motivo' in d ? d.motivo : null, telefone_final: 'telefone' in d ? d.telefone.slice(-4) : null });
      continue;
    }
    pendentes.splice(pendentes.indexOf(linha.token), 1);

    if (d.acao === 'ignorar') {
      await sb.rpc('marcar_mensagem', { p_token: linha.token, p_status: 'ignorada', p_motivo: d.motivo });
      resultado.push({ token: curto, resultado: 'ignorada', motivo: d.motivo });
      continue;
    }
    if (d.acao === 'esperar') {
      await sb.rpc('devolver_mensagem', { p_token: linha.token, p_contar: false });
      resultado.push({ token: curto, resultado: 'esperando', motivo: d.motivo });
      continue;
    }

    try {
      const contatoId = await cliente!.acharOuCriarContato({ nome: d.nome, telefone: d.telefone });
      const conversaId = await cliente!.abrirConversa({ contatoId, telefone: d.telefone });
      const texto = (env('TEMPLATE_TEXTO') || `[template ${TEMPLATE}]`).replace('{{1}}', primeiroNome(d.nome));
      await cliente!.enviarTemplate({
        conversaId, texto,
        templateParams: montarTemplateParams({ nomeTemplate: TEMPLATE, idioma: IDIOMA, nome: d.nome, sufixoUrl: d.sufixoUrl }),
      });
      await sb.rpc('marcar_mensagem', { p_token: linha.token, p_status: 'enviada', p_conversa: conversaId });
      resultado.push({ token: curto, resultado: 'enviada' });
    } catch (e) {
      const tipo = classificarErro(e);
      const detalhe = e instanceof ErroChatwoot
        ? `${e.passo}:${e.status} ${JSON.stringify(e.corpo ?? '').slice(0, 160)}`
        : String(e).slice(0, 160);
      if (tipo === 'parar') {
        // Credencial/permissão: o problema não é do lead. Devolve este e os que sobraram, sem contar tentativa.
        for (const t of [linha.token, ...pendentes]) await sb.rpc('devolver_mensagem', { p_token: t, p_contar: false });
        console.error('chatwoot recusou a credencial; rodada interrompida:', detalhe);
        return responder({ ok: false, erro: 'credencial_recusada', detalhe, resultado }, 502);
      }
      if (tipo === 'tentar_de_novo') await sb.rpc('devolver_mensagem', { p_token: linha.token, p_contar: true });
      else await sb.rpc('marcar_mensagem', { p_token: linha.token, p_status: 'falhou', p_motivo: detalhe });
      resultado.push({ token: curto, resultado: tipo === 'falhou' ? 'falhou' : 'tentar_de_novo', detalhe });
    }
  }

  return responder({ ok: true, modo: MODO, quantidade: resultado.length, resultado });
});
```

- [ ] **Step 4: Escrever a migration do agendamento**

```sql
-- 2026-09-30-zzz-enviar-mensagem-abandono-cron.sql
-- Agenda o robô de mensagens (1/min). Ele nasce DESLIGADO (ENVIO_MODO não definido): o cron
-- chama, a função responde {ok:true, modo:'desligado'} e não faz nada.
insert into public.segredos_de_cron (nome, segredo)
values ('enviar-mensagem-abandono', encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (nome) do nothing;

select cron.schedule('enviar-mensagem-abandono', '* * * * *', $cron$
  select public.disparar_robo('enviar-mensagem-abandono', 'enviar-mensagem-abandono', 'enviar-mensagem-abandono',
    '{"origem":"cron"}'::jsonb, 55000);
$cron$);

insert into public.robos_esperados (robo, horas_sem_sucesso_ate, critico, porque) values
  ('enviar-mensagem-abandono', 2, false,
   'Manda o WhatsApp de recuperacao a quem esta na Fila de mensagens. Parado, ninguem recebe a mensagem; '
   'desligado (ENVIO_MODO) tambem responde ok.')
on conflict (robo) do update
  set horas_sem_sucesso_ate = excluded.horas_sem_sucesso_ate,
      critico = excluded.critico,
      porque = excluded.porque;
```

- [ ] **Step 5: Rodar e ver passar**

Run: `node --test supabase/functions/enviar-mensagem-abandono/modos.test.mjs supabase/functions/toda-edge-compila.test.mjs`
Expected: PASS (6 + compilação).

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/enviar-mensagem-abandono db/migrations/2026-09-30-zzz-enviar-mensagem-abandono-cron.sql
git commit -m "feat: robo de mensagens de abandono (modos desligado/seco/lista/ligado) e agendamento"
```

---

### Task 5: Bloqueio ("Não quero receber")

**Files:**
- Create: `supabase/functions/_shared/opt-out.js`
- Create: `supabase/functions/receber-opt-out-chatwoot/index.ts`
- Test: `supabase/functions/_shared/opt-out.test.mjs`

**Interfaces:**
- Consumes: `normalizarTelefone` (Task 1), `tokenValido` de `_shared/verificar-webhook-chatwoot.js`.
- Produces: `extrairOptOut(corpo): { telefone: string, motivo: string } | null`; a edge `receber-opt-out-chatwoot` (POST, `?token=`), que faz upsert em `contatos_sem_mensagem`.

> ⚠️ O formato do payload do webhook padrão do Chatwoot (`message_created`) está aqui **de memória** da documentação; a Task 7 confirma com uma mensagem real. Quem manda o webhook é o Chatwoot (Configurações → Integrações → Webhooks → "Message created"), **configurado pelo dono**.

- [ ] **Step 1: Escrever os testes que falham**

```js
// supabase/functions/_shared/opt-out.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { extrairOptOut } from './opt-out.js'

const msg = (extra = {}) => ({
  event: 'message_created', message_type: 'incoming', content: 'Não quero receber',
  sender: { phone_number: '+55 19 98262-1828' }, ...extra,
})

test('reconhece o botão "Não quero receber" e normaliza o telefone', () => {
  assert.deepEqual(extrairOptOut(msg()), { telefone: '5519982621828', motivo: 'resposta: nao quero receber' })
})

test('reconhece variações de acento, caixa e pontuação, e as palavras PARAR/SAIR sozinhas', () => {
  for (const c of ['NAO QUERO RECEBER!', 'não quero receber mais', 'Parar', 'sair.', ' pare ']) {
    assert.ok(extrairOptOut(msg({ content: c })), `deveria reconhecer "${c}"`)
  }
})

test('⚠️ não bloqueia conversa normal nem palavra solta dentro de frase', () => {
  for (const c of ['quero comprar', 'posso parar na loja hoje?', 'oi', '', null]) {
    assert.equal(extrairOptOut(msg({ content: c })), null, `não deveria bloquear "${c}"`)
  }
})

test('só mensagem RECEBIDA do cliente conta (a enviada por nós não), e só o evento certo', () => {
  assert.equal(extrairOptOut(msg({ message_type: 'outgoing' })), null)
  assert.equal(extrairOptOut(msg({ event: 'conversation_updated' })), null)
  assert.equal(extrairOptOut(null), null)
})

test('sem telefone utilizável não bloqueia nada; usa o telefone da conversa se o sender não tiver', () => {
  assert.equal(extrairOptOut(msg({ sender: {} })), null)
  assert.equal(extrairOptOut(msg({ sender: { phone_number: 'abc' } })), null)
  assert.equal(
    extrairOptOut(msg({ sender: {}, conversation: { meta: { sender: { phone_number: '19982621828' } } } })).telefone,
    '5519982621828')
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test supabase/functions/_shared/opt-out.test.mjs`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar**

```js
// supabase/functions/_shared/opt-out.js
//
// Reconhece, no webhook de mensagem recebida do Chatwoot, o cliente pedindo para NÃO receber
// mais mensagem (o botão do template ou as palavras PARAR/SAIR). Frase exata: uma palavra solta
// dentro de uma conversa normal ("posso parar na loja?") NÃO bloqueia ninguém.
import { normalizarTelefone } from './mensagem-de-abandono.js'

const FRASES = new Set(['parar', 'pare', 'sair'])
const PREFIXO = 'nao quero receber'

const limpar = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

export function extrairOptOut(corpo) {
  if (!corpo || corpo.event !== 'message_created' || corpo.message_type !== 'incoming') return null
  const texto = limpar(String(corpo.content ?? ''))
  if (!(FRASES.has(texto) || texto.startsWith(PREFIXO))) return null
  const bruto = corpo.sender?.phone_number ?? corpo.conversation?.meta?.sender?.phone_number ?? ''
  const telefone = normalizarTelefone(bruto)
  return telefone ? { telefone, motivo: `resposta: ${texto}` } : null
}
```

```ts
// supabase/functions/receber-opt-out-chatwoot/index.ts
//
// Webhook PADRÃO do Chatwoot (evento "Message created") -> quem pediu para não receber vai para
// `contatos_sem_mensagem`. Não confundir com receber-webhook-chatwoot, que é o webhook de CRM
// customizado (só lead_novo/lead_quente) e não recebe respostas de clientes.
// Autentica pelo segredo na URL (?token=), o mesmo CHATWOOT_WEBHOOK_SEGREDO daquele.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { tokenValido } from '../_shared/verificar-webhook-chatwoot.js';
import { extrairOptOut } from '../_shared/opt-out.js';

const responder = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return responder({ ok: false }, 405);
  const url = new URL(req.url);
  if (!tokenValido(Deno.env.get('CHATWOOT_WEBHOOK_SEGREDO') ?? '', url.searchParams.get('token'))) {
    return responder({ error: 'nao_autorizado' }, 401);
  }

  let corpo: unknown;
  try { corpo = await req.json(); } catch { return responder({ error: 'corpo_invalido' }, 400); }

  const pedido = extrairOptOut(corpo);
  if (!pedido) return responder({ ok: true, ignorado: true });

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { error } = await sb.from('contatos_sem_mensagem')
    .upsert(pedido, { onConflict: 'telefone', ignoreDuplicates: true });
  // Mesmo raciocínio dos outros receptores: erro de banco não se resolve com retentativa. Loga e responde 200.
  if (error) console.error('falha ao gravar opt-out:', error.message);
  return responder({ ok: true });
});
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test supabase/functions/_shared/opt-out.test.mjs supabase/functions/toda-edge-compila.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/opt-out.js supabase/functions/_shared/opt-out.test.mjs supabase/functions/receber-opt-out-chatwoot
git commit -m "feat: bloqueio 'nao quero receber' via webhook padrao do Chatwoot (message_created)"
```

---

### Task 6: Selo da mensagem na tela

**Files:**
- Modify: `src/ferramentas/abandono-carrinho/regras-do-abandono.js`
- Modify: `src/ferramentas/abandono-carrinho/tela-de-abandono-carrinho.vue`
- Test: `src/ferramentas/abandono-carrinho/regras-do-abandono.test.mjs`

**Interfaces:**
- Consumes: as colunas `mensagem_status`, `mensagem_motivo`, `mensagem_enviada_em` (Task 2), que já vêm no `select('*')` da tela.
- Produces: `seloDaMensagem(linha): { texto: string, tipo: 'ok'|'info'|'erro'|'neutro' } | null`.

- [ ] **Step 1: Escrever o teste que falha** (acrescentar ao fim de `regras-do-abandono.test.mjs`)

```js
import { seloDaMensagem } from './regras-do-abandono.js'

test('seloDaMensagem: um selo por estado, e nada quando a mensagem nem começou', () => {
  assert.equal(seloDaMensagem({ mensagem_status: null }), null)
  assert.deepEqual(seloDaMensagem({ mensagem_status: 'enviando' }), { texto: 'enviando…', tipo: 'info' })
  assert.deepEqual(seloDaMensagem({ mensagem_status: 'enviada' }), { texto: 'mensagem enviada', tipo: 'ok' })
  assert.deepEqual(seloDaMensagem({ mensagem_status: 'falhou', mensagem_motivo: 'enviar_template:422' }),
    { texto: 'falhou', tipo: 'erro' })
})

test('seloDaMensagem: ignorada explica o motivo em português; motivo desconhecido não quebra', () => {
  const motivo = (m) => seloDaMensagem({ mensagem_status: 'ignorada', mensagem_motivo: m })
  assert.equal(motivo('sem_telefone').texto, 'sem telefone: não recebe WhatsApp')
  assert.equal(motivo('telefone_invalido').texto, 'telefone inválido')
  assert.equal(motivo('pediu_para_nao_receber').texto, 'pediu para não receber')
  assert.equal(motivo('sem_link').texto, 'sem link de recuperação')
  assert.equal(motivo('nao_esta_mais_na_fila').texto, 'já não estava na fila')
  assert.deepEqual(motivo('algo_novo'), { texto: 'não enviada', tipo: 'neutro' })
  assert.equal(motivo('sem_telefone').tipo, 'neutro')
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test src/ferramentas/abandono-carrinho/regras-do-abandono.test.mjs`
Expected: FAIL (`seloDaMensagem` não é exportado).

- [ ] **Step 3: Implementar a regra** (acrescentar ao fim de `regras-do-abandono.js`)

```js
const MOTIVOS_IGNORADA = {
  sem_telefone: 'sem telefone: não recebe WhatsApp',
  telefone_invalido: 'telefone inválido',
  pediu_para_nao_receber: 'pediu para não receber',
  sem_link: 'sem link de recuperação',
  nao_esta_mais_na_fila: 'já não estava na fila',
}

/** Selo do estado da mensagem de WhatsApp para os itens da Fila de mensagens. */
export function seloDaMensagem(linha) {
  switch (linha.mensagem_status) {
    case 'enviando': return { texto: 'enviando…', tipo: 'info' }
    case 'enviada': return { texto: 'mensagem enviada', tipo: 'ok' }
    case 'falhou': return { texto: 'falhou', tipo: 'erro' }
    case 'ignorada': return { texto: MOTIVOS_IGNORADA[linha.mensagem_motivo] ?? 'não enviada', tipo: 'neutro' }
    default: return null
  }
}
```

- [ ] **Step 4: Mostrar na tela** — em `tela-de-abandono-carrinho.vue`, importar `seloDaMensagem` na lista de imports de `./regras-do-abandono.js`, e dentro do `<li>` da coluna "Fila de mensagens", logo depois do selo `comprou depois` (se ele existir) ou do valor, acrescentar:

```vue
              <span v-if="seloDaMensagem(c)" class="selo" :class="'selo-' + seloDaMensagem(c).tipo">{{ seloDaMensagem(c).texto }}</span>
              <span v-if="c.mensagem_status === 'enviada' && c.mensagem_enviada_em" class="ac-detalhe">enviada às {{ hora(c.mensagem_enviada_em) }}</span>
```

- [ ] **Step 5: Rodar tudo e o build**

Run: `node --test src/ferramentas/abandono-carrinho/regras-do-abandono.test.mjs src/compartilhado/padrao-da-central.test.mjs src/compartilhado/todo-vue-compila.test.mjs && npm run build`
Expected: PASS e `✓ built`.

- [ ] **Step 6: Commit**

```bash
git add src/ferramentas/abandono-carrinho
git commit -m "feat: selo do estado da mensagem de WhatsApp na Fila de mensagens"
```

---

### Task 7: Verificação e colocação no ar (com o dono)

**Files:**
- Create: `coletor/verificar-chatwoot.mjs`
- Modify: `src/ferramentas/abandono-carrinho/LEIA-ME.txt`

Esta tarefa é **de execução conjunta**: usa segredos e o número do dono. Quem executa **não procura credenciais**: o dono grava os segredos.

- [ ] **Step 1: Script de verificação** (só usa variáveis de ambiente que o dono passa; sem `--enviar`, é somente leitura)

```js
// coletor/verificar-chatwoot.mjs
// Confere, contra o Chatwoot REAL, cada passo que o robô usa. Sem --enviar: só LÊ (busca de contato).
//   CHATWOOT_URL=... CHATWOOT_CONTA_ID=... CHATWOOT_CAIXA_ID=... CHATWOOT_API_TOKEN=... \
//   NUMERO=5519999999999 node coletor/verificar-chatwoot.mjs
// Com --enviar (e TEMPLATE_NOME, TEMPLATE_IDIOMA, LINK_SUFIXO): cria a conversa e manda o template
// PARA O NÚMERO INFORMADO (use só o do dono).
import { criarClienteChatwoot } from '../supabase/functions/_shared/cliente-chatwoot.js'
import { montarTemplateParams, normalizarTelefone } from '../supabase/functions/_shared/mensagem-de-abandono.js'

const e = process.env
const telefone = normalizarTelefone(e.NUMERO ?? '')
if (!telefone) { console.error('NUMERO inválido (celular brasileiro com DDD).'); process.exit(1) }
const c = criarClienteChatwoot({ url: e.CHATWOOT_URL, contaId: e.CHATWOOT_CONTA_ID, caixaId: Number(e.CHATWOOT_CAIXA_ID), token: e.CHATWOOT_API_TOKEN })
const ver = (rotulo, valor) => console.log(rotulo.padEnd(22), JSON.stringify(valor))

try {
  const contatoId = await c.acharOuCriarContato({ nome: 'Teste do dono', telefone })
  ver('contato id', contatoId)
  if (!process.argv.includes('--enviar')) { console.log('Somente leitura/criação de contato. Use --enviar para o template.'); process.exit(0) }
  const conversaId = await c.abrirConversa({ contatoId, telefone })
  ver('conversa id', conversaId)
  const tp = montarTemplateParams({ nomeTemplate: e.TEMPLATE_NOME, idioma: e.TEMPLATE_IDIOMA || 'pt_BR', nome: 'Teste do dono', sufixoUrl: e.LINK_SUFIXO })
  ver('mensagem id', await c.enviarTemplate({ conversaId, texto: `[template ${e.TEMPLATE_NOME}]`, templateParams: tp }))
} catch (erro) {
  console.error('FALHOU no passo:', erro.passo ?? '(rede)', erro.status ?? '', JSON.stringify(erro.corpo ?? String(erro)).slice(0, 300))
  process.exit(2)
}
```

- [ ] **Step 2: O dono grava os segredos** (`supabase secrets set ...` ou painel): `CHATWOOT_URL`, `CHATWOOT_CONTA_ID`, `CHATWOOT_CAIXA_ID`, `CHATWOOT_API_TOKEN`, `TEMPLATE_NOME`, `TEMPLATE_IDIOMA`, `LINK_BASE` e, para o teste, `ENVIO_SO_PARA` com o número dele. **Não** grava `ENVIO_MODO` ainda (fica desligado).

- [ ] **Step 3: Confirmar os endereços do Chatwoot** — o dono roda o script **sem** `--enviar` com o número dele. Se alguma chamada falhar ou o formato divergir, corrigir **só** `cliente-chatwoot.js` e seu teste, e repetir. Depois, com `--enviar`, confirmar que o template chega no WhatsApp do dono, **com o botão de link funcionando**.

- [ ] **Step 4: Conferir o link.** Comparar `abandoned_checkout_url` de uma linha real com `LINK_BASE`: `sufixoDoLink(url, LINK_BASE)` tem que devolver o final, e a URL montada (`LINK_BASE` + sufixo) tem que abrir o checkout. Se o domínio não bater, o template precisa de outra base fixa (e outra aprovação).

- [ ] **Step 5: Aplicar em produção**, nesta ordem, com o procedimento do `CLAUDE.md` (partir do `origin/main`, ver o que está no ar):
  1. `node coletor/run-migrations.mjs --dry` (só as duas migrations novas pendentes) e depois sem `--dry`.
  2. Publicar as duas edges: `npx supabase functions deploy enviar-mensagem-abandono --project-ref kounqtdoioootxqegkij --no-verify-jwt --use-api` e o mesmo para `receber-opt-out-chatwoot`.
  3. Testar `401 {"error":"nao_autorizado"}` com assinatura/`token` errados nas duas.

- [ ] **Step 6: Webhook de mensagem recebida.** O dono cadastra no Chatwoot (Configurações → Integrações → Webhooks) o evento "Message created" apontando para `https://kounqtdoioootxqegkij.supabase.co/functions/v1/receber-opt-out-chatwoot?token=<CHATWOOT_WEBHOOK_SEGREDO>`. Responder "Não quero receber" do número do dono e conferir a linha em `contatos_sem_mensagem`. **Se o formato do payload divergir, ajustar `opt-out.js` e seu teste.**

- [ ] **Step 7: Modo seco.** O dono grava `ENVIO_MODO=seco`. Conferir a resposta da função (`resultado`) contra a fila real: decisões e motivos coerentes, nenhuma linha mudou de estado (`mensagem_status` continua nulo).

- [ ] **Step 8: Modo lista.** `ENVIO_MODO=lista` com `ENVIO_SO_PARA` = número do dono. Criar um checkout de teste com esse número, esperar entrar na fila, e confirmar: **uma** mensagem chegou, a linha ficou `enviada`, e **nenhuma segunda** chegou nas rodadas seguintes.

- [ ] **Step 9: Só depois, por decisão explícita do dono,** `ENVIO_MODO=ligado`. Acompanhar as primeiras rodadas (`ENVIO_LIMITE_POR_RODADA` baixo) e a nota de qualidade do número na Meta.

- [ ] **Step 10: Atualizar o LEIA-ME** da ferramenta com: os modos, os segredos, o webhook de mensagem recebida e a equivalência "Fila de mensagens = `fila_envio`". Commit:

```bash
git add coletor/verificar-chatwoot.mjs src/ferramentas/abandono-carrinho/LEIA-ME.txt
git commit -m "feat: script de verificacao do Chatwoot e LEIA-ME do robo de mensagens"
```

---

## Autorrevisão

**Cobertura do design:** reserva sem duplicar (Task 2) · sem reenvio após Pix expirado (Task 2, teste do filtro) · telefone/janela/link/nome (Task 1) · Chatwoot contato→conversa→template (Task 3) · modos, limite, atraso, parada em 401/403 (Task 4) · bloqueio (Task 5) · tela (Task 6) · verificação com o número do dono e rollout gradual (Task 7). Riscos do design que não são código (consentimento, número de terceiros, checkout recriado) permanecem como **decisões do dono** registradas na spec.

**Correção em relação à spec:** o bloqueio **não** estende `receber-webhook-chatwoot` (webhook de CRM customizado, só `lead_novo`/`lead_quente`); é uma função nova ligada ao webhook padrão do Chatwoot.

**Consistência de nomes:** `decidirEnvio` devolve `{acao, motivo|telefone,nome,sufixoUrl}`; a edge usa exatamente esses campos. As funções SQL têm as mesmas assinaturas nas Tasks 2 e 4 (`pegar_para_mensagem(int,int,boolean,text[])`, `marcar_mensagem(text,text,text,bigint)`, `devolver_mensagem(text,boolean)`).

**Não verificado até a Task 7:** endereços/corpos da API do Chatwoot na versão instalada, formato do payload de mensagem recebida, e o formato do link de recuperação contra o domínio.
