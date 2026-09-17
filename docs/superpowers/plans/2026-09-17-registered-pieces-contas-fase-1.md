# Contas da cliente no Registered Pieces — Fase 1

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA: use `superpowers:subagent-driven-development` (recomendado) ou `superpowers:executing-plans` para executar tarefa a tarefa. Os passos usam caixinhas (`- [ ]`).

**Objetivo:** dar conta própria à cliente da Vessel (criar perfil, entrar, recuperar senha, ver e editar os dados) e ligar o registro da peça a essa conta, incluindo o caminho "É presente?".

**Arquitetura:** contas próprias em tabelas fechadas do banco atual; nenhuma cliente vira `authenticated` do Supabase (49 tabelas internas se abrem a qualquer logado — ver a spec, seção 2). Toda escrita passa por funções `security definer` chamadas por UMA edge (`vessel-conta`) com a chave de serviço. A página de teste é estática, sem framework, e mora no repositório público.

**Tech Stack:** Postgres/Supabase (migrations em `db/migrations/`), Edge Functions em Deno/TypeScript, HTML/CSS/JS sem framework, testes com `node --test`, provas de tela com o módulo `playwright` por node (`channel: 'chrome'`), e-mail pelo ZeptoMail (API HTTP).

**Spec:** `docs/superpowers/specs/2026-09-17-registered-pieces-contas-design.md`

**Escopo:** esta Fase 1 **não** inclui transferência de propriedade nem a troca do certificado real — os dois viram o plano da Fase 2. Fase 1 entrega software funcionando sozinho: perfil + registro com conta, num endereço de teste.

## Restrições globais

- **Dois repositórios.** Banco, edges e robôs em `~/iamundi` (`rbv-co/social-dashboard`). Páginas públicas em `~/iamundi/vessel-brasil` (`rbv-co/vessel-brasil`, repo SEPARADO). **Nunca** trazer código da Central para `vessel-brasil`.
- **Ler o padrão antes da primeira linha:** `PADRAO-DA-CENTRAL.md` (no iamundi).
- **A página de verdade (`vessel-brasil/verify/index.html`) NÃO é tocada nesta fase.** 157 etiquetas gravadas em bolsas vendidas apontam para ela.
- **A demo (`vessel-brasil/verify/demo/`) NÃO é tocada.** Ela é material de gravação e não fala com o banco (há teste que reprova rede lá dentro).
- **`pgcrypto` mora no schema `extensions`**: escrever `extensions.crypt`, `extensions.gen_salt`, `extensions.digest`, `extensions.gen_random_bytes`. Sem o prefixo, quebra com `search_path = public`.
- **Segredo nenhum no `vessel-brasil`**: tudo ali é público. A chave do ZeptoMail vai nos segredos da Supabase.
- **Nunca `git add -A`**: adicionar arquivo por arquivo (há trabalho de outras janelas no mesmo repositório).
- **Trabalhar em worktree** (`arvores/<nome>`), nunca na `main` do checkout principal.
- **Migrations não são aplicadas pelo runner** (o registro de migrations do projeto está zerado). Cada migration desta fase é aplicada **à mão**, pelo MCP da Supabase (`apply_migration`), depois de o teste estático passar.
- **Publicar edge só pela CLI** (`npx supabase functions deploy`), nunca pelo MCP, e **nunca com `--use-api`** (liga o `verify_jwt` e derruba cron). Antes de publicar: `git fetch`, partir de `origin/main` e conferir o que está no ar.
- **Português explica, inglês assina** (regra do Growth Plan). Títulos de seção em inglês; texto em português.
- **Nada de dado real em teste:** provas de banco dentro de `do $$ ... rollback`; provas de tela com e-mail fingido.
- **A garantia:** 90 dias de garantia legal; 2 anos **ao registrar**, contados **da data da compra**. Nunca escrever que o registro é obrigatório para ter direito legal.

---

### Tarefa 1: A senha gerada na hora (regra pura)

**Arquivos:**
- Criar: `supabase/functions/_shared/senha-gerada.js`
- Teste: `supabase/functions/_shared/senha-gerada.test.mjs`

**Interfaces:**
- Consome: nada.
- Produz: `gerarSenha(sorteio?: () => number): string` — 12 caracteres do alfabeto sem ambíguos; `ALFABETO_DA_SENHA: string`.

- [ ] **Passo 1: escrever o teste que falha**

```js
// supabase/functions/_shared/senha-gerada.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { gerarSenha, ALFABETO_DA_SENHA } from './senha-gerada.js';

test('a senha tem 12 caracteres', () => {
  assert.equal(gerarSenha().length, 12);
});

test('⚠️ o alfabeto não tem caractere que se confunde ao ler', () => {
  // A cliente vai COPIAR do e-mail e DIGITAR. 0/O e 1/l/I viram chamado de
  // suporte, não senha errada dela.
  for (const proibido of ['0', 'O', '1', 'l', 'I']) {
    assert.ok(!ALFABETO_DA_SENHA.includes(proibido), `alfabeto contém ${proibido}`);
  }
});

test('duas senhas seguidas não são iguais', () => {
  assert.notEqual(gerarSenha(), gerarSenha());
});

test('o sorteio pode ser injetado, para o teste ser determinístico', () => {
  assert.equal(gerarSenha(() => 0), ALFABETO_DA_SENHA[0].repeat(12));
});
```

- [ ] **Passo 2: rodar e ver falhar**

Executar: `cd ~/iamundi && node --test supabase/functions/_shared/senha-gerada.test.mjs`
Esperado: FALHA com `Cannot find module` (o arquivo ainda não existe).

- [ ] **Passo 3: escrever o mínimo que faz passar**

```js
// supabase/functions/_shared/senha-gerada.js
// A SENHA QUE A CLIENTE RECEBE POR E-MAIL.
//
// ⚠️ SEM CARACTERE AMBÍGUO. Ela copia do e-mail e digita no celular: 0/O e
// 1/l/I viram "minha senha não funciona", que chega como chamado de suporte.
export const ALFABETO_DA_SENHA = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

export const TAMANHO_DA_SENHA = 12;

/** `sorteio` existe para o teste ser determinístico. Em produção é
 *  `crypto.getRandomValues`, injetado por quem chama — nunca `Math.random`. */
export function gerarSenha(sorteio) {
  const sortear = sorteio ?? (() => {
    const n = new Uint32Array(1);
    crypto.getRandomValues(n);
    return n[0] / 2 ** 32;
  });
  let senha = '';
  for (let i = 0; i < TAMANHO_DA_SENHA; i++) {
    senha += ALFABETO_DA_SENHA[Math.floor(sortear() * ALFABETO_DA_SENHA.length)];
  }
  return senha;
}
```

- [ ] **Passo 4: rodar e ver passar**

Executar: `node --test supabase/functions/_shared/senha-gerada.test.mjs`
Esperado: 4 testes PASSAM.

- [ ] **Passo 5: rodar a suíte inteira**

Executar: `npm test`
Esperado: nenhuma falha nova. (Anote o total de testes: ele só pode crescer.)

- [ ] **Passo 6: commit**

```bash
git add supabase/functions/_shared/senha-gerada.js supabase/functions/_shared/senha-gerada.test.mjs
git commit -m "Contas: a senha gerada na hora, sem caractere ambiguo"
```

---

### Tarefa 2: "É presente?" — comparar o nome de quem deu (regra pura)

**Arquivos:**
- Criar: `supabase/functions/_shared/nome-de-quem-deu.js`
- Teste: `supabase/functions/_shared/nome-de-quem-deu.test.mjs`

**Interfaces:**
- Consome: nada.
- Produz: `normalizarNome(t: string): string`; `nomesBatem(digitado: string, doPedido: string): boolean` (regra estrita); `nomesChegamPerto(digitado: string, doPedido: string): boolean` (regra frouxa, só vale quando o pedido está marcado PRESENTE).

- [ ] **Passo 1: escrever o teste que falha**

```js
// supabase/functions/_shared/nome-de-quem-deu.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizarNome, nomesBatem, nomesChegamPerto } from './nome-de-quem-deu.js';

test('normalizar tira acento, maiúscula e espaço sobrando', () => {
  assert.equal(normalizarNome('  Ana  MARIA de Souza '), 'ana maria de souza');
});

test('bate ignorando partícula e nome do meio', () => {
  assert.ok(nomesBatem('Ana Souza', 'ANA MARIA DE SOUZA'));
  assert.ok(nomesBatem('ana maria de souza', 'Ana Souza'));
});

test('⚠️ NÃO bate quando só o primeiro nome coincide', () => {
  // "Ana" existe às dezenas na base. Aprovar por primeiro nome entregaria a
  // garantia de uma peça para a pessoa errada, calado.
  assert.ok(!nomesBatem('Ana Ferreira', 'Ana Souza'));
  assert.ok(!nomesBatem('Ana', 'Ana Souza'));
});

test('chega perto aceita sobrenome escrito errado, mas exige primeiro nome', () => {
  assert.ok(nomesChegamPerto('Ana Sousa', 'Ana Souza'));   // z/s
  assert.ok(nomesChegamPerto('Ana Soza', 'Ana Souza'));    // letra faltando
  assert.ok(!nomesChegamPerto('Bia Souza', 'Ana Souza'));  // outro primeiro nome
  assert.ok(!nomesChegamPerto('Ana', 'Ana Souza'));        // sem sobrenome
});

test('vazio nunca bate com nada', () => {
  assert.ok(!nomesBatem('', 'Ana Souza'));
  assert.ok(!nomesChegamPerto('  ', 'Ana Souza'));
  assert.ok(!nomesBatem('Ana Souza', ''));
});
```

- [ ] **Passo 2: rodar e ver falhar**

Executar: `node --test supabase/functions/_shared/nome-de-quem-deu.test.mjs`
Esperado: FALHA com `Cannot find module`.

- [ ] **Passo 3: escrever o mínimo que faz passar**

```js
// supabase/functions/_shared/nome-de-quem-deu.js
// "É PRESENTE?": a presenteada informa o nome de quem deu, e é ESTA regra que
// decide se a garantia é aprovada na hora ou fica na fila de gente.
//
// ⚠️ ELA APROVA SEM NINGUÉM OLHAR. Frouxa demais entrega a peça a quem não é
// dona; apertada demais joga cliente honesta na fila. Na dúvida, FILA.

const PARTICULAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);

export function normalizarNome(texto) {
  return String(texto ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')  // tira acento
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pedacos(nome) {
  return normalizarNome(nome).split(' ').filter((p) => p && !PARTICULAS.has(p));
}

/** Estrita: primeiro nome igual E último sobrenome igual. */
export function nomesBatem(digitado, doPedido) {
  const a = pedacos(digitado), b = pedacos(doPedido);
  if (a.length < 2 || b.length < 2) return false;
  return a[0] === b[0] && a[a.length - 1] === b[b.length - 1];
}

/** Distância de edição, limitada — só para sobrenome escrito errado. */
function distancia(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1,
                         d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

/** Frouxa: primeiro nome IGUAL e sobrenome quase igual (até 2 letras de
 *  diferença). ⚠️ Só pode ser usada quando o pedido está marcado PRESENTE —
 *  a marca é a segunda prova que autoriza afrouxar o nome. */
export function nomesChegamPerto(digitado, doPedido) {
  const a = pedacos(digitado), b = pedacos(doPedido);
  if (a.length < 2 || b.length < 2) return false;
  if (a[0] !== b[0]) return false;
  return distancia(a[a.length - 1], b[b.length - 1]) <= 2;
}
```

- [ ] **Passo 4: rodar e ver passar**

Executar: `node --test supabase/functions/_shared/nome-de-quem-deu.test.mjs`
Esperado: 5 testes PASSAM.

- [ ] **Passo 5: commit**

```bash
git add supabase/functions/_shared/nome-de-quem-deu.js supabase/functions/_shared/nome-de-quem-deu.test.mjs
git commit -m "Contas: a regra que compara o nome de quem deu o presente"
```

---

### Tarefa 3: A base das contas no banco (migration 1)

**Arquivos:**
- Criar: `db/migrations/2026-09-17-vessel-contas-base.sql`
- Teste: `db/contas-nascem-fechadas.test.mjs`

**Interfaces:**
- Consome: nada.
- Produz (funções chamadas pela edge da Tarefa 5):
  - `vessel_conta_criar(p_nome text, p_cpf text, p_email text, p_whatsapp text, p_nascimento date, p_senha text) → json` — `{ok:true, cliente_id, email}` ou `{ok:false, motivo:'cpf_invalido'|'email_invalido'|'nome_vazio'|'nascimento_invalido'|'ja_existe'}`
  - `vessel_conta_entrar(p_login text, p_senha text, p_lembrar boolean, p_agente text, p_ip_hash text) → json` — `{ok:true, token, expira_em, nome}` ou `{ok:false, motivo:'senha_errada'|'muitas_tentativas'}`
  - `vessel_conta_da_sessao(p_token text) → json` — `{ok:true, cliente_id, nome, email}` ou `{ok:false}`
  - `vessel_conta_sair(p_token text, p_todas boolean) → json`
  - `vessel_conta_nova_senha(p_login text, p_senha text) → json` — `{ok:true, email}`; resposta idêntica quando não existe
  - `vessel_conta_editar(p_token text, p_nome text, p_whatsapp text, p_senha_atual text, p_senha_nova text) → json`

- [ ] **Passo 1: escrever a migration**

```sql
-- db/migrations/2026-09-17-vessel-contas-base.sql
--
-- AS CONTAS DA CLIENTE DO REGISTERED PIECES.
-- Desenho: docs/superpowers/specs/2026-09-17-registered-pieces-contas-design.md
--
-- ⚠️ POR QUE NÃO É O LOGIN DO SUPABASE. Medido em 17/09/2026: 49 tabelas deste
-- banco têm política aberta a QUALQUER logado (a Central e a Vessel dividem o
-- banco). Cliente logada pelo Supabase Auth leria dado interno da consultoria.
-- Aqui a cliente NUNCA é `authenticated`: ela só existe dentro destas funções.
--
-- ⚠️ pgcrypto mora no schema `extensions`: todo `crypt`, `gen_salt`, `digest` e
-- `gen_random_bytes` vem qualificado. Sem isso, quebra com search_path=public.

create table if not exists public.vessel_clientes (
  id                  uuid primary key default gen_random_uuid(),
  nome                text not null,
  cpf                 text not null unique,          -- só dígitos
  email               text not null unique,          -- sempre minúsculo
  whatsapp            text,
  nascimento          date,
  cidade              text,
  senha_hash          text not null,
  senha_trocada_em    timestamptz,
  email_confirmado_em timestamptz,
  bling_contato_id    bigint,
  pessoa_id           bigint,
  teste               boolean not null default false,
  criado_em           timestamptz not null default now(),
  atualizado_em       timestamptz not null default now()
);

create table if not exists public.vessel_sessoes (
  id            uuid primary key default gen_random_uuid(),
  cliente_id    uuid not null references public.vessel_clientes(id) on delete cascade,
  token_hash    text not null unique,
  criada_em     timestamptz not null default now(),
  expira_em     timestamptz not null,
  ultimo_uso_em timestamptz,
  agente        text,
  ip_hash       text,
  encerrada_em  timestamptz
);
create index if not exists vessel_sessoes_cliente_idx on public.vessel_sessoes (cliente_id);

create table if not exists public.vessel_tentativas_de_login (
  id      bigserial primary key,
  chave   text not null,          -- login normalizado
  quando  timestamptz not null default now(),
  acertou boolean not null
);
create index if not exists vessel_tentativas_login_idx
  on public.vessel_tentativas_de_login (chave, quando desc);

-- ── trava de linha ───────────────────────────────────────────────────────────
-- ⚠️ CONFERIDO CONTRA AS IRMÃS (vessel_pecas, vessel_registros): RLS ligada,
-- UMA política, só de SELECT, para `authenticated`, gateada por
-- is_vessel_admin() — é o que deixa o painel Autenticidade ler. Escrita, zero:
-- só por função security definer.
alter table public.vessel_clientes            enable row level security;
alter table public.vessel_sessoes             enable row level security;
alter table public.vessel_tentativas_de_login enable row level security;

drop policy if exists vessel_clientes_admin_le on public.vessel_clientes;
create policy vessel_clientes_admin_le on public.vessel_clientes
  for select to authenticated using (public.is_vessel_admin());

-- vessel_sessoes e vessel_tentativas_de_login ficam SEM política nenhuma, de
-- propósito: nem o painel precisa, e token de sessão não se lê em tela.

create trigger vessel_clientes_atualizado
  before update on public.vessel_clientes
  for each row execute function public.vessel_toca_atualizado_em();

-- ── ajudantes ────────────────────────────────────────────────────────────────

create or replace function public.vessel_cpf_digitos(p_bruto text)
returns text language sql immutable as $$
  select nullif(regexp_replace(coalesce(p_bruto, ''), '\D', '', 'g'), '');
$$;

-- ── criar perfil ─────────────────────────────────────────────────────────────

create or replace function public.vessel_conta_criar(
  p_nome text, p_cpf text, p_email text, p_whatsapp text,
  p_nascimento date, p_senha text
) returns json language plpgsql security definer set search_path to 'public' as $$
declare
  v_cpf   text := public.vessel_cpf_digitos(p_cpf);
  v_email text := lower(trim(coalesce(p_email, '')));
  v_id    uuid;
begin
  if v_cpf is null or length(v_cpf) <> 11 then
    return json_build_object('ok', false, 'motivo', 'cpf_invalido');
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return json_build_object('ok', false, 'motivo', 'email_invalido');
  end if;
  if coalesce(trim(p_nome), '') = '' then
    return json_build_object('ok', false, 'motivo', 'nome_vazio');
  end if;
  -- ⚠️ NASCIMENTO É OBRIGATÓRIO, e não é burocracia: na venda a loja quase
  -- nunca consegue tirar todos os dados, e o registro é o momento em que a
  -- própria cliente completa o cadastro (decisão do dono, 06/09 e 17/09/2026).
  if p_nascimento is null
     or p_nascimento > current_date
     or p_nascimento < current_date - interval '120 years' then
    return json_build_object('ok', false, 'motivo', 'nascimento_invalido');
  end if;
  if exists (select 1 from public.vessel_clientes
              where cpf = v_cpf or email = v_email) then
    return json_build_object('ok', false, 'motivo', 'ja_existe');
  end if;

  insert into public.vessel_clientes (nome, cpf, email, whatsapp, nascimento, senha_hash)
  values (trim(p_nome), v_cpf, v_email, p_whatsapp, p_nascimento,
          extensions.crypt(p_senha, extensions.gen_salt('bf', 10)))
  returning id into v_id;

  return json_build_object('ok', true, 'cliente_id', v_id, 'email', v_email);
end;
$$;

-- ── entrar ───────────────────────────────────────────────────────────────────

create or replace function public.vessel_conta_entrar(
  p_login text, p_senha text, p_lembrar boolean,
  p_agente text default null, p_ip_hash text default null
) returns json language plpgsql security definer set search_path to 'public' as $$
declare
  v_login  text := lower(trim(coalesce(p_login, '')));
  v_cpf    text := public.vessel_cpf_digitos(p_login);
  v_c      record;
  v_erros  int;
  v_token  text;
  v_expira timestamptz;
begin
  -- ⚠️ O TETO É POR LOGIN E VEM ANTES DE QUALQUER COMPARAÇÃO DE SENHA: sem ele
  -- esta função vira um chutador de senhas com a chave anônima na mão.
  select count(*) into v_erros from public.vessel_tentativas_de_login
   where chave = v_login and acertou = false and quando > now() - interval '15 minutes';
  if v_erros >= 5 then
    return json_build_object('ok', false, 'motivo', 'muitas_tentativas');
  end if;

  select * into v_c from public.vessel_clientes
   where email = v_login or cpf = v_cpf limit 1;

  if v_c.id is null or v_c.senha_hash <> extensions.crypt(p_senha, v_c.senha_hash) then
    insert into public.vessel_tentativas_de_login (chave, acertou) values (v_login, false);
    return json_build_object('ok', false, 'motivo', 'senha_errada');
  end if;

  insert into public.vessel_tentativas_de_login (chave, acertou) values (v_login, true);

  v_token  := encode(extensions.gen_random_bytes(32), 'hex');
  v_expira := now() + case when coalesce(p_lembrar, false) then interval '90 days'
                           else interval '12 hours' end;
  insert into public.vessel_sessoes (cliente_id, token_hash, expira_em, agente, ip_hash)
  values (v_c.id, encode(extensions.digest(v_token, 'sha256'), 'hex'),
          v_expira, left(coalesce(p_agente, ''), 300), p_ip_hash);

  return json_build_object('ok', true, 'token', v_token, 'expira_em', v_expira,
                           'nome', v_c.nome, 'cliente_id', v_c.id);
end;
$$;

-- ── quem é a sessão ──────────────────────────────────────────────────────────

create or replace function public.vessel_conta_da_sessao(p_token text)
returns json language plpgsql security definer set search_path to 'public' as $$
declare v_s record; v_c record;
begin
  select * into v_s from public.vessel_sessoes
   where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
     and encerrada_em is null and expira_em > now();
  if v_s.id is null then return json_build_object('ok', false); end if;

  update public.vessel_sessoes set ultimo_uso_em = now() where id = v_s.id;
  select * into v_c from public.vessel_clientes where id = v_s.cliente_id;
  return json_build_object('ok', true, 'cliente_id', v_c.id, 'nome', v_c.nome,
                           'email', v_c.email, 'whatsapp', v_c.whatsapp,
                           'cpf_fim', right(v_c.cpf, 2));
end;
$$;

create or replace function public.vessel_conta_sair(p_token text, p_todas boolean default false)
returns json language plpgsql security definer set search_path to 'public' as $$
declare v_s record;
begin
  select * into v_s from public.vessel_sessoes
   where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
  if v_s.id is null then return json_build_object('ok', true); end if;
  if coalesce(p_todas, false) then
    update public.vessel_sessoes set encerrada_em = now()
     where cliente_id = v_s.cliente_id and encerrada_em is null;
  else
    update public.vessel_sessoes set encerrada_em = now() where id = v_s.id;
  end if;
  return json_build_object('ok', true);
end;
$$;

-- ── esqueci a senha ──────────────────────────────────────────────────────────
-- ⚠️ A RESPOSTA É IGUAL EXISTINDO OU NÃO O PERFIL. Diferenciar transformaria a
-- página num confirmador de quem é cliente da marca.

create or replace function public.vessel_conta_nova_senha(p_login text, p_senha text)
returns json language plpgsql security definer set search_path to 'public' as $$
declare
  v_login text := lower(trim(coalesce(p_login, '')));
  v_cpf   text := public.vessel_cpf_digitos(p_login);
  v_c     record;
begin
  select * into v_c from public.vessel_clientes
   where email = v_login or cpf = v_cpf limit 1;
  if v_c.id is null then
    return json_build_object('ok', true, 'email', null);   -- resposta idêntica
  end if;

  update public.vessel_clientes
     set senha_hash = extensions.crypt(p_senha, extensions.gen_salt('bf', 10)),
         senha_trocada_em = now()
   where id = v_c.id;
  -- a senha nova derruba as sessões abertas: se alguém entrou, perde o acesso
  update public.vessel_sessoes set encerrada_em = now()
   where cliente_id = v_c.id and encerrada_em is null;

  return json_build_object('ok', true, 'email', v_c.email);
end;
$$;

-- ── editar os próprios dados ─────────────────────────────────────────────────
-- ⚠️ CPF NÃO MUDA AQUI: é a prova de compra. Só a equipe altera, pelo painel.

create or replace function public.vessel_conta_editar(
  p_token text, p_nome text default null, p_whatsapp text default null,
  p_senha_atual text default null, p_senha_nova text default null
) returns json language plpgsql security definer set search_path to 'public' as $$
declare v_sessao json; v_id uuid; v_c record;
begin
  v_sessao := public.vessel_conta_da_sessao(p_token);
  if not (v_sessao ->> 'ok')::boolean then
    return json_build_object('ok', false, 'motivo', 'sem_sessao');
  end if;
  v_id := (v_sessao ->> 'cliente_id')::uuid;

  if p_senha_nova is not null then
    select * into v_c from public.vessel_clientes where id = v_id;
    if v_c.senha_hash <> extensions.crypt(coalesce(p_senha_atual, ''), v_c.senha_hash) then
      return json_build_object('ok', false, 'motivo', 'senha_atual_errada');
    end if;
    if length(coalesce(p_senha_nova, '')) < 8 then
      return json_build_object('ok', false, 'motivo', 'senha_curta');
    end if;
    update public.vessel_clientes
       set senha_hash = extensions.crypt(p_senha_nova, extensions.gen_salt('bf', 10)),
           senha_trocada_em = now()
     where id = v_id;
  end if;

  update public.vessel_clientes
     set nome = coalesce(nullif(trim(coalesce(p_nome, '')), ''), nome),
         whatsapp = coalesce(nullif(trim(coalesce(p_whatsapp, '')), ''), whatsapp)
   where id = v_id;

  return json_build_object('ok', true);
end;
$$;

-- ── o portão ─────────────────────────────────────────────────────────────────
-- ⚠️ `revoke from public` NÃO fecha `anon`/`authenticated`: os papéis herdam
-- direito próprio. Revogar dos três, um a um, e conceder só a service_role
-- (que é quem a edge usa).
do $$
declare f text;
begin
  foreach f in array array[
    'vessel_conta_criar(text,text,text,text,date,text)',
    'vessel_conta_entrar(text,text,boolean,text,text)',
    'vessel_conta_da_sessao(text)',
    'vessel_conta_sair(text,boolean)',
    'vessel_conta_nova_senha(text,text)',
    'vessel_conta_editar(text,text,text,text,text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
```

- [ ] **Passo 2: escrever o teste estático que falha**

```js
// db/contas-nascem-fechadas.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/* ⚠️ POR QUE ESTE ARQUIVO EXISTE
 *
 * A chave anônima da Supabase está DENTRO do HTML das páginas públicas. Se uma
 * destas funções ficar concedida a `anon`, qualquer visitante chama
 * `vessel_conta_entrar` direto e a página vira chutador de senha; se
 * `vessel_clientes` ganhar política aberta, a lista de clientes vaza.
 * Já aconteceu no projeto de uma tabela nova nascer sem a trava das irmãs. */

const SQL = readFileSync(join(dirname(fileURLToPath(import.meta.url)),
  'migrations/2026-09-17-vessel-contas-base.sql'), 'utf8').toLowerCase();

test('⚠️ as três tabelas nascem com RLS ligada', () => {
  for (const t of ['vessel_clientes', 'vessel_sessoes', 'vessel_tentativas_de_login']) {
    assert.match(SQL, new RegExp(`alter table public.${t}\\s+enable row level security`));
  }
});

test('⚠️ sessão e tentativas não têm política nenhuma', () => {
  for (const t of ['vessel_sessoes', 'vessel_tentativas_de_login']) {
    assert.ok(!new RegExp(`create policy[^;]+on public.${t}`).test(SQL),
      `${t} não pode ter política: token de sessão não se lê em tela`);
  }
});

test('⚠️ a política de clientes é SÓ de leitura e gateada por is_vessel_admin', () => {
  const m = SQL.match(/create policy[^;]+on public\.vessel_clientes[^;]+;/);
  assert.ok(m, 'falta a política de leitura do painel');
  assert.match(m[0], /for select/);
  assert.match(m[0], /is_vessel_admin\(\)/);
});

test('⚠️ toda função de conta é revogada de anon E authenticated', () => {
  assert.match(SQL, /revoke all on function public\.%s from public, anon, authenticated/);
  assert.ok(!/grant execute on function public\.%s to (anon|authenticated)/.test(SQL));
});

test('⚠️ pgcrypto é chamado qualificado (extensions.)', () => {
  for (const f of ['crypt(', 'gen_salt(', 'digest(', 'gen_random_bytes(']) {
    const solto = new RegExp(`(?<!extensions\\.)\\b${f.replace('(', '\\(')}`);
    assert.ok(!solto.test(SQL), `${f} sem o prefixo extensions. quebra com search_path=public`);
  }
});

test('⚠️ a senha é guardada com bcrypt, nunca em claro nem em sha', () => {
  assert.match(SQL, /extensions\.crypt\([^)]*extensions\.gen_salt\('bf'/);
});
```

- [ ] **Passo 3: rodar e ver falhar**

Executar: `node --test db/contas-nascem-fechadas.test.mjs` **antes** de salvar o SQL do Passo 1 (ou renomeando-o temporariamente).
Esperado: FALHA por arquivo inexistente. Depois de restaurar o SQL, os 6 testes passam.

- [ ] **Passo 4: rodar a suíte inteira**

Executar: `npm test`
Esperado: sem falhas novas.

- [ ] **Passo 5: aplicar a migration à mão**

⚠️ **Não mande o runner aplicar as pendentes** — o registro de migrations deste projeto está zerado e ele tentaria aplicar dezenas de arquivos antigos.

Aplicar pelo MCP da Supabase (`apply_migration`, projeto `kounqtdoioootxqegkij`), com o conteúdo do arquivo. Depois conferir:

```sql
select tablename, rowsecurity from pg_tables
 where schemaname='public' and tablename like 'vessel_%conta%' or tablename in
 ('vessel_clientes','vessel_sessoes','vessel_tentativas_de_login');
select proname from pg_proc where proname like 'vessel_conta%' order by 1;
```
Esperado: 3 tabelas com `rowsecurity = true` e 6 funções.

- [ ] **Passo 6: provar as funções dentro de uma transação desfeita**

Executar este bloco (MCP `execute_sql`) — ele cria, entra, erra a senha e desfaz tudo:

```sql
do $$
declare v json; v_token text;
begin
  v := public.vessel_conta_criar('Cliente Teste','390.533.447-05',
        'teste-conta@exemplo.com.br','(19) 99999-0000','1990-01-01','senha-de-teste');
  assert (v->>'ok')::boolean, 'criar falhou: ' || v::text;

  v := public.vessel_conta_criar('Outra','390.533.447-05',
        'outro@exemplo.com.br',null,'1990-01-01','x');
  assert (v->>'motivo') = 'ja_existe', 'CPF repetido deveria ser recusado';

  v := public.vessel_conta_criar('Sem Nascimento','111.444.777-35',
        'sem-nascimento@exemplo.com.br',null,null,'x');
  assert (v->>'motivo') = 'nascimento_invalido', 'nascimento é obrigatório';

  v := public.vessel_conta_entrar('teste-conta@exemplo.com.br','senha-errada',false,null,null);
  assert (v->>'motivo') = 'senha_errada', 'senha errada deveria falhar';

  v := public.vessel_conta_entrar('39053344705','senha-de-teste',true,'teste',null);
  assert (v->>'ok')::boolean, 'entrar por CPF falhou: ' || v::text;
  v_token := v->>'token';

  v := public.vessel_conta_da_sessao(v_token);
  assert (v->>'ok')::boolean, 'sessao nao reconhecida';

  v := public.vessel_conta_sair(v_token, false);
  v := public.vessel_conta_da_sessao(v_token);
  assert not (v->>'ok')::boolean, 'sessao encerrada ainda responde';

  raise exception 'rollback proposital: todas as asserções passaram';
end $$;
```
Esperado: erro final `rollback proposital: todas as asserções passaram` — qualquer outra mensagem é defeito de verdade. Conferir que nada sobrou: `select count(*) from vessel_clientes;` deve ser 0.

- [ ] **Passo 7: commit**

```bash
git add db/migrations/2026-09-17-vessel-contas-base.sql db/contas-nascem-fechadas.test.mjs
git commit -m "Contas: tabelas e funcoes fechadas, fora do login do painel"
```

---

### Tarefa 4: Mandar e-mail pelo ZeptoMail

**Arquivos:**
- Criar: `supabase/functions/_shared/email-zeptomail.ts`
- Criar: `supabase/functions/_shared/email-textos.js`
- Teste: `supabase/functions/_shared/email-textos.test.mjs`

**Interfaces:**
- Consome: nada.
- Produz: `textoDaSenhaNova(nome, senha): {assunto, html, texto}`; `textoDoPrimeiroAcesso(nome, senha): {assunto, html, texto}`; `mascararEmail(email): string`; e, no `.ts`, `mandarEmail(para: string, msg: {assunto, html, texto}): Promise<boolean>`.

- [ ] **Passo 1: escrever o teste que falha**

```js
// supabase/functions/_shared/email-textos.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { textoDoPrimeiroAcesso, textoDaSenhaNova, mascararEmail } from './email-textos.js';

test('o e-mail do primeiro acesso traz a senha e o endereço da página', () => {
  const m = textoDoPrimeiroAcesso('Tereza Aparecida', 'ABCdef234567');
  assert.match(m.html, /ABCdef234567/);
  assert.match(m.texto, /ABCdef234567/);
  assert.match(m.assunto, /VESSEL/);
});

test('⚠️ o e-mail NUNCA repete CPF nem diz o que a pessoa comprou', () => {
  const m = textoDaSenhaNova('Tereza', 'ABCdef234567');
  const tudo = (m.assunto + m.html + m.texto).toLowerCase();
  for (const proibido of ['cpf', 'pedido', 'nota fiscal', 'comprou']) {
    assert.ok(!tudo.includes(proibido), `o texto não pode conter "${proibido}"`);
  }
});

test('⚠️ o e-mail não promete que registrar dá direito legal', () => {
  const tudo = (textoDoPrimeiroAcesso('T', 'x').html).toLowerCase();
  assert.ok(!tudo.includes('obrigat'), 'registro é opcional; o texto não pode dizer o contrário');
});

test('mascarar mostra a primeira letra e o domínio', () => {
  assert.equal(mascararEmail('tereza@exemplo.com.br'), 't•••@exemplo.com.br');
  assert.equal(mascararEmail(''), '');
});
```

- [ ] **Passo 2: rodar e ver falhar**

Executar: `node --test supabase/functions/_shared/email-textos.test.mjs`
Esperado: FALHA com `Cannot find module`.

- [ ] **Passo 3: escrever os textos**

```js
// supabase/functions/_shared/email-textos.js
// OS TEXTOS DOS E-MAILS DA CONTA.
//
// ⚠️ NADA DE CPF, PEDIDO OU PRODUTO AQUI. E-mail passa por servidores que não
// são nossos e fica na caixa da pessoa para sempre. Há teste que reprova essas
// palavras. O que o e-mail carrega é o mínimo: quem somos e a senha.

const ASSINATURA = 'VESSEL Brasil · vesselbrasil.com.br';

function montar(assunto, titulo, miolo, senha) {
  const texto = `${titulo}\n\n${miolo}\n\nSua senha: ${senha}\n\n${ASSINATURA}`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#2A2823;line-height:1.6">
  <p style="letter-spacing:.2em;font-size:12px;color:#5E6851">VESSEL</p>
  <h1 style="font-weight:300;font-size:22px">${titulo}</h1>
  <p>${miolo}</p>
  <p style="font-size:20px;letter-spacing:.08em;background:#F2EFE6;padding:12px 16px;display:inline-block">${senha}</p>
  <p style="font-size:12px;color:#6B685F">${ASSINATURA}</p>
</div>`;
  return { assunto, html, texto };
}

export function textoDoPrimeiroAcesso(nome, senha) {
  return montar(
    'Seu acesso VESSEL',
    `Bem-vinda, ${String(nome || '').split(' ')[0]}`,
    'Criamos seu perfil VESSEL. Use o e-mail ou o seu documento e a senha abaixo para entrar. '
    + 'Você pode trocar a senha assim que entrar.',
    senha,
  );
}

export function textoDaSenhaNova(nome, senha) {
  return montar(
    'Sua nova senha VESSEL',
    'Nova senha',
    'Geramos uma senha nova para o seu perfil. A senha anterior deixou de valer. '
    + 'Se não foi você quem pediu, fale com a gente.',
    senha,
  );
}

export function mascararEmail(email) {
  const e = String(email || '');
  const i = e.indexOf('@');
  if (i < 1) return '';
  return `${e[0]}•••${e.slice(i)}`;
}
```

- [ ] **Passo 4: rodar e ver passar**

Executar: `node --test supabase/functions/_shared/email-textos.test.mjs`
Esperado: 4 testes PASSAM.

- [ ] **Passo 5: escrever o envio**

```ts
// supabase/functions/_shared/email-zeptomail.ts
// O ENVIO DE E-MAIL DA CONTA, pelo ZeptoMail (Zoho).
//
// O domínio vesselbrasil.com.br está verificado lá desde 17/09/2026 (DKIM
// `171134._domainkey` e bounce `bounce-zem` publicados no Registro.br).
//
// ⚠️ FALHA DE ENVIO NÃO DERRUBA A CHAMADA: quem chama decide o que dizer à
// cliente. Aqui devolve-se apenas true/false.
const TOKEN = Deno.env.get('ZEPTOMAIL_TOKEN') ?? '';
const REMETENTE = Deno.env.get('ZEPTOMAIL_DE') ?? 'nao-responda@vesselbrasil.com.br';

export async function mandarEmail(
  para: string,
  msg: { assunto: string; html: string; texto: string },
): Promise<boolean> {
  if (!TOKEN) return false;
  try {
    const r = await fetch('https://api.zeptomail.com/v1.1/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json',
                 Authorization: TOKEN },
      body: JSON.stringify({
        from: { address: REMETENTE, name: 'VESSEL Brasil' },
        to: [{ email_address: { address: para } }],
        subject: msg.assunto,
        htmlbody: msg.html,
        textbody: msg.texto,
      }),
    });
    return r.ok;
  } catch {
    return false;
  }
}
```

- [ ] **Passo 6: guardar os segredos**

Pedir ao dono a chave de envio (Mail Agent "Registered Pieces" no ZeptoMail). ⚠️ **A chave nunca entra na conversa nem em arquivo do repositório.** Ele mesmo grava:

```bash
npx supabase secrets set ZEPTOMAIL_TOKEN='<a chave>' --project-ref kounqtdoioootxqegkij
npx supabase secrets set ZEPTOMAIL_DE='nao-responda@vesselbrasil.com.br' --project-ref kounqtdoioootxqegkij
```

- [ ] **Passo 7: commit**

```bash
git add supabase/functions/_shared/email-textos.js supabase/functions/_shared/email-textos.test.mjs supabase/functions/_shared/email-zeptomail.ts
git commit -m "Contas: os textos e o envio de e-mail pelo ZeptoMail"
```

---

### Tarefa 5: A edge `vessel-conta`

**Arquivos:**
- Criar: `supabase/functions/vessel-conta/index.ts`
- Teste: `supabase/functions/vessel-conta/porta.test.mjs`

**Interfaces:**
- Consome: `gerarSenha` (Tarefa 1), `textoDoPrimeiroAcesso`/`textoDaSenhaNova`/`mascararEmail` (Tarefa 4), `mandarEmail` (Tarefa 4), funções `vessel_conta_*` (Tarefa 3).
- Produz: `POST /functions/v1/vessel-conta` com `{acao}` em `criar|entrar|sair|esqueci|editar|eu`. Respostas: `{ok:true, ...}` ou `{ok:false, motivo}`. `criar` e `esqueci` devolvem `email_mascarado`; `entrar` devolve `token` e `expira_em`.

> **Uma edge só, e não seis como a spec desenhou.** Motivo: publicar edge é o ponto frágil deste projeto (mais de uma pessoa publica, e quem publica por último vence — `CLAUDE.md`). Seis funções são seis publicações e seis cópias de `_shared`. O portão é o mesmo: a chave de serviço mora só aqui.

- [ ] **Passo 1: escrever o teste que falha**

```js
// supabase/functions/vessel-conta/porta.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FONTE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.ts'), 'utf8');

test('⚠️ a edge NUNCA devolve a senha gerada para a página', () => {
  // A senha vai por e-mail, e só. Devolvê-la no JSON deixaria a senha no
  // histórico do navegador e em qualquer registro de rede pelo caminho.
  assert.ok(!/senha:\s*senha/.test(FONTE) && !/'senha',\s*senha/.test(FONTE),
    'a resposta não pode conter a senha em claro');
});

test('⚠️ a edge não responde nada sem passar pelas funções do banco', () => {
  assert.ok(!/from\('vessel_clientes'\)/.test(FONTE),
    'acesso direto à tabela contorna as travas — tem de ser por rpc');
  assert.match(FONTE, /rpc\('vessel_conta_entrar'/);
});

test('a edge trata as seis ações', () => {
  for (const acao of ['criar', 'entrar', 'sair', 'esqueci', 'editar', 'eu']) {
    assert.ok(FONTE.includes(`'${acao}'`), `falta a ação ${acao}`);
  }
});
```

- [ ] **Passo 2: rodar e ver falhar**

Executar: `node --test supabase/functions/vessel-conta/porta.test.mjs`
Esperado: FALHA (arquivo `index.ts` não existe).

- [ ] **Passo 3: escrever a edge**

```ts
// supabase/functions/vessel-conta/index.ts
// A PORTA DAS CONTAS DA CLIENTE (Registered Pieces).
//
// A página pública chama AQUI, com a chave anônima. As funções `vessel_conta_*`
// não são concedidas a `anon`: só esta edge as chama, com a chave de serviço.
//
// ⚠️ A SENHA GERADA SÓ SAI POR E-MAIL. A resposta devolve o e-mail mascarado.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { gerarSenha } from '../_shared/senha-gerada.js';
import { textoDoPrimeiroAcesso, textoDaSenhaNova, mascararEmail } from '../_shared/email-textos.js';
import { mandarEmail } from '../_shared/email-zeptomail.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const responder = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return responder({ ok: false, motivo: 'metodo' }, 405);

  const corpo = await req.json().catch(() => null);
  if (!corpo?.acao) return responder({ ok: false, motivo: 'dados_invalidos' }, 400);

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  const agente = req.headers.get('user-agent') ?? '';

  if (corpo.acao === 'criar') {
    const senha = gerarSenha();
    const { data } = await sb.rpc('vessel_conta_criar', {
      p_nome: corpo.nome, p_cpf: corpo.cpf, p_email: corpo.email,
      p_whatsapp: corpo.whatsapp ?? null, p_nascimento: corpo.nascimento ?? null,
      p_senha: senha,
    });
    if (!data?.ok) return responder(data ?? { ok: false, motivo: 'falhou' });
    const enviou = await mandarEmail(data.email, textoDoPrimeiroAcesso(corpo.nome, senha));
    // ⚠️ E-mail que não sai deixaria a cliente com perfil e sem senha. Nesse
    // caso a conta é apagada e ela tenta de novo, em vez de ficar travada.
    if (!enviou) {
      await sb.rpc('vessel_conta_apagar_recem_criada', { p_cliente_id: data.cliente_id });
      return responder({ ok: false, motivo: 'email_nao_saiu' });
    }
    return responder({ ok: true, email_mascarado: mascararEmail(data.email) });
  }

  if (corpo.acao === 'entrar') {
    const { data } = await sb.rpc('vessel_conta_entrar', {
      p_login: corpo.login, p_senha: corpo.senha, p_lembrar: corpo.lembrar === true,
      p_agente: agente, p_ip_hash: null,
    });
    return responder(data ?? { ok: false, motivo: 'falhou' });
  }

  if (corpo.acao === 'eu') {
    const { data } = await sb.rpc('vessel_conta_da_sessao', { p_token: corpo.token });
    return responder(data ?? { ok: false });
  }

  if (corpo.acao === 'sair') {
    const { data } = await sb.rpc('vessel_conta_sair', {
      p_token: corpo.token, p_todas: corpo.todas === true });
    return responder(data ?? { ok: true });
  }

  if (corpo.acao === 'esqueci') {
    const senha = gerarSenha();
    const { data } = await sb.rpc('vessel_conta_nova_senha', {
      p_login: corpo.login, p_senha: senha });
    // ⚠️ A RESPOSTA É IGUAL EXISTINDO OU NÃO O PERFIL.
    if (data?.email) await mandarEmail(data.email, textoDaSenhaNova('', senha));
    return responder({ ok: true });
  }

  if (corpo.acao === 'editar') {
    const { data } = await sb.rpc('vessel_conta_editar', {
      p_token: corpo.token, p_nome: corpo.nome ?? null, p_whatsapp: corpo.whatsapp ?? null,
      p_senha_atual: corpo.senha_atual ?? null, p_senha_nova: corpo.senha_nova ?? null,
    });
    return responder(data ?? { ok: false, motivo: 'falhou' });
  }

  return responder({ ok: false, motivo: 'acao_desconhecida' }, 400);
});
```

- [ ] **Passo 4: acrescentar a função que apaga o perfil órfão**

Na migration da Tarefa 3 (arquivo novo `db/migrations/2026-09-17-vessel-contas-apagar-orfa.sql`):

```sql
-- ⚠️ SÓ APAGA PERFIL RECÉM-CRIADO E SEM NADA: é o desfazer de "o e-mail não
-- saiu". Perfil com sessão, peça ou mais de 10 minutos NÃO é apagado.
create or replace function public.vessel_conta_apagar_recem_criada(p_cliente_id uuid)
returns json language plpgsql security definer set search_path to 'public' as $$
begin
  delete from public.vessel_clientes c
   where c.id = p_cliente_id
     and c.criado_em > now() - interval '10 minutes'
     and not exists (select 1 from public.vessel_sessoes s where s.cliente_id = c.id);
  return json_build_object('ok', true);
end;
$$;
revoke all on function public.vessel_conta_apagar_recem_criada(uuid) from public, anon, authenticated;
grant execute on function public.vessel_conta_apagar_recem_criada(uuid) to service_role;
```

Aplicar pelo MCP, como no Passo 5 da Tarefa 3.

- [ ] **Passo 5: rodar os testes**

Executar: `node --test supabase/functions/vessel-conta/porta.test.mjs && npm test`
Esperado: tudo passa, inclusive `toda-edge-compila.test.mjs` (que compila as edges).

- [ ] **Passo 6: publicar a edge**

⚠️ Antes: `git fetch`, estar em cima de `origin/main`, e conferir o que já está no ar (ver `CLAUDE.md`, seção de edge).

```bash
npx supabase functions deploy vessel-conta --project-ref kounqtdoioootxqegkij --no-verify-jwt
```

Conferir de fora (deve responder `dados_invalidos`, provando que a porta existe e valida):

```bash
curl -s -X POST "https://kounqtdoioootxqegkij.supabase.co/functions/v1/vessel-conta" \
  -H "Content-Type: application/json" -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
  -d '{}'
```

- [ ] **Passo 7: commit**

```bash
git add supabase/functions/vessel-conta/index.ts supabase/functions/vessel-conta/porta.test.mjs db/migrations/2026-09-17-vessel-contas-apagar-orfa.sql
git commit -m "Contas: a edge vessel-conta (criar, entrar, sair, esqueci, editar, eu)"
```

---

### Tarefa 6: Ligar o registro da peça à conta, e a marca PRESENTE (migration 2)

**Arquivos:**
- Criar: `db/migrations/2026-09-17-vessel-registro-com-conta.sql`
- Modificar: `coletor/` — o robô que espelha pedidos do Bling passa a guardar as observações (arquivo exato: procurar com `grep -rl "vessel_pedidos" coletor/`)
- Teste: `db/registro-com-conta.test.mjs`

**Interfaces:**
- Consome: `vessel_conta_da_sessao` (Tarefa 3).
- Produz:
  - `vessel_registrar_como_cliente(p_token text, p_codigo text, p_onde text, p_comprado_em date) → json` — `{ok:true, pedido, sku, cliente_id}`
  - `vessel_candidatos_de_presente(p_sku text) → setof (pedido_id bigint, contato_nome text, tem_marca boolean)`
  - `vessel_aprovar_presente(p_pedido uuid, p_bling_pedido text) → json`

- [ ] **Passo 1: escrever a migration**

```sql
-- db/migrations/2026-09-17-vessel-registro-com-conta.sql
--
-- O REGISTRO DA PEÇA PASSA A TER DONA COM PERFIL, E GANHA O "É PRESENTE?".

alter table public.vessel_registros
  add column if not exists cliente_id uuid references public.vessel_clientes(id);
alter table public.vessel_pedidos_de_registro
  add column if not exists cliente_id uuid references public.vessel_clientes(id),
  add column if not exists presente_de_nome text;

-- A cópia local dos pedidos do Bling passa a guardar as observações: é onde a
-- vendedora escreve PRESENTE.
alter table public.vessel_pedidos
  add column if not exists observacoes text,
  add column if not exists observacoes_internas text;

comment on column public.vessel_pedidos.observacoes_internas is
  'Texto livre do pedido no Bling. A palavra PRESENTE aqui afrouxa a conferência de nome no "É presente?".';

-- ⚠️ A MARCA É PALAVRA SOLTA, e por isso a leitura é tolerante: maiúscula,
-- acento e a frase em volta não importam. O que NÃO pode é casar com "presente
-- de aniversário do vendedor" escrito por engano — daí a marca sozinha nunca
-- aprova: ela só permite o nome chegar perto (ver _shared/nome-de-quem-deu.js).
create or replace function public.vessel_pedido_marcado_presente(p_texto text)
returns boolean language sql immutable as $$
  select coalesce(p_texto, '') <> '' and
         translate(lower(p_texto), 'áéíóúâêôãõç', 'aeiouaeoaoc') like '%presente%';
$$;

-- Candidatos de presente: pedidos que contêm aquele SKU.
create or replace function public.vessel_candidatos_de_presente(p_sku text)
returns table (bling_pedido text, contato_nome text, tem_marca boolean)
language sql stable security definer set search_path to 'public' as $$
  select p.numero, p.contato_nome,
         public.vessel_pedido_marcado_presente(
           coalesce(p.observacoes, '') || ' ' || coalesce(p.observacoes_internas, ''))
    from public.vessel_pedidos p
    join public.vessel_pedido_itens i on i.pedido_id = p.id
   where i.sku = p_sku
   order by p.data_do_pedido desc nulls last
   limit 50;
$$;

-- Registrar estando logada: o pedido nasce ligado ao perfil.
create or replace function public.vessel_registrar_como_cliente(
  p_token text, p_codigo text, p_onde text default null, p_comprado_em date default null
) returns json language plpgsql security definer set search_path to 'public' as $$
declare v_sessao json; v_c record; v_aberto json;
begin
  v_sessao := public.vessel_conta_da_sessao(p_token);
  if not (v_sessao ->> 'ok')::boolean then
    return json_build_object('ok', false, 'motivo', 'sem_sessao');
  end if;
  select * into v_c from public.vessel_clientes where id = (v_sessao ->> 'cliente_id')::uuid;

  v_aberto := public.vessel_abrir_pedido_de_registro(
    p_codigo, v_c.nome, v_c.cpf, v_c.whatsapp, p_onde, p_comprado_em, v_c.nascimento);
  if not (v_aberto ->> 'ok')::boolean then return v_aberto; end if;

  update public.vessel_pedidos_de_registro
     set cliente_id = v_c.id where id = (v_aberto ->> 'pedido')::uuid;

  return json_build_object('ok', true, 'pedido', v_aberto ->> 'pedido',
                           'sku', v_aberto ->> 'sku', 'cliente_id', v_c.id);
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'vessel_registrar_como_cliente(text,text,text,date)',
    'vessel_candidatos_de_presente(text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
```

⚠️ Antes de escrever este arquivo, **ler a assinatura real** de `vessel_abrir_pedido_de_registro` (ela pode ter mudado):

```sql
select pg_get_function_arguments(oid) from pg_proc where proname = 'vessel_abrir_pedido_de_registro';
```
e ajustar a chamada acima para casar exatamente com ela.

- [ ] **Passo 2: escrever o teste estático**

```js
// db/registro-com-conta.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SQL = readFileSync(join(dirname(fileURLToPath(import.meta.url)),
  'migrations/2026-09-17-vessel-registro-com-conta.sql'), 'utf8').toLowerCase();

test('⚠️ registrar exige sessão', () => {
  const f = SQL.slice(SQL.indexOf('function public.vessel_registrar_como_cliente'));
  assert.match(f, /vessel_conta_da_sessao/);
  assert.match(f, /sem_sessao/);
});

test('⚠️ as funções novas não são concedidas a anon', () => {
  assert.ok(!/grant execute on function public\.vessel_(registrar_como_cliente|candidatos_de_presente)[^;]*to (anon|authenticated)/.test(SQL));
});

test('a marca PRESENTE é lida sem acento e sem maiúscula', () => {
  assert.match(SQL, /translate\(lower\(p_texto\)/);
});
```

- [ ] **Passo 3: rodar e ver falhar, depois passar**

Executar: `node --test db/registro-com-conta.test.mjs`
Esperado: primeiro FALHA (sem o arquivo), depois PASSA com os 3 testes.

- [ ] **Passo 4: aplicar a migration e provar com rollback**

Aplicar pelo MCP. Depois:

```sql
do $$
declare v boolean;
begin
  v := public.vessel_pedido_marcado_presente('Entrega para PRESENTE de aniversário');
  assert v, 'deveria reconhecer a marca';
  v := public.vessel_pedido_marcado_presente('pedido normal');
  assert not v, 'não deveria reconhecer marca onde não há';
  raise exception 'rollback proposital: asserções passaram';
end $$;
```

- [ ] **Passo 5: fazer o robô guardar as observações**

Achar o arquivo: `grep -rln "vessel_pedidos" coletor/ | head`. No trecho que monta a linha do pedido, acrescentar `observacoes` e `observacoes_internas` vindos do detalhe do pedido do Bling (campos `observacoes` e `observacoesInternas`). Rodar o robô em modo seco (`--dry`) e conferir que os dois campos aparecem.

- [ ] **Passo 6: commit**

```bash
git add db/migrations/2026-09-17-vessel-registro-com-conta.sql db/registro-com-conta.test.mjs coletor/<arquivo-do-robo>
git commit -m "Registro ligado ao perfil da cliente, e a marca PRESENTE do Bling"
```

---

### Tarefa 7: A edge do registro passa a aceitar sessão e presente

**Arquivos:**
- Modificar: `supabase/functions/vessel-registrar-garantia/index.ts`
- Teste: `supabase/functions/vessel-registrar-garantia/presente.test.mjs`

**Interfaces:**
- Consome: `vessel_registrar_como_cliente`, `vessel_candidatos_de_presente` (Tarefa 6), `nomesBatem`/`nomesChegamPerto` (Tarefa 2).
- Produz: o corpo do POST aceita `{token, codigo, onde, comprado_em}` (logada) e `{token, codigo, presente_de}` (o "É presente?"). Respostas: `{ok:true, estado:'aprovado'|'pendente'}`.

- [ ] **Passo 1: escrever o teste que falha**

```js
// supabase/functions/vessel-registrar-garantia/presente.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nomesBatem, nomesChegamPerto } from '../_shared/nome-de-quem-deu.js';

const FONTE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.ts'), 'utf8');

test('⚠️ o caminho do presente exige UM candidato só', () => {
  assert.match(FONTE, /length === 1|length !== 1/,
    'dois pedidos possíveis têm de cair na fila, nunca aprovar no chute');
});

test('⚠️ a regra frouxa só vale com a marca PRESENTE', () => {
  // Sem a marca, "Ana Sousa" não pode virar "Ana Souza" sozinho.
  const i = FONTE.indexOf('nomesChegamPerto');
  assert.ok(i > 0, 'a edge tem de usar a regra frouxa');
  assert.match(FONTE.slice(Math.max(0, i - 300), i + 200), /tem_marca/);
});

test('a decisão de aprovar é a mesma da regra pura', () => {
  assert.ok(nomesBatem('Ana Souza', 'ANA MARIA DE SOUZA'));
  assert.ok(!nomesChegamPerto('Bia Souza', 'Ana Souza'));
});
```

- [ ] **Passo 2: rodar e ver falhar**

Executar: `node --test supabase/functions/vessel-registrar-garantia/presente.test.mjs`
Esperado: FALHA (a edge ainda não fala de presente).

- [ ] **Passo 3: alterar a edge**

No topo, acrescentar os imports:

```ts
import { nomesBatem, nomesChegamPerto } from '../_shared/nome-de-quem-deu.js';
```

Dentro do `Deno.serve`, **antes** do caminho antigo, tratar a ação de presente:

```ts
  // ── "É PRESENTE?" ────────────────────────────────────────────────────────
  // A compra está no CPF de quem deu. A presenteada informa o nome dessa
  // pessoa; aprovamos só quando há UM candidato e o nome fecha.
  if (corpo.presente_de) {
    const { data: sessao } = await sb.rpc('vessel_conta_da_sessao', { p_token: corpo.token });
    if (!sessao?.ok) return responder({ ok: false, motivo: 'sem_sessao' }, 401);

    const { data: pedidoAberto } = await sb.rpc('vessel_registrar_como_cliente', {
      p_token: corpo.token, p_codigo: corpo.codigo,
      p_onde: corpo.onde ?? null, p_comprado_em: corpo.comprado_em ?? null,
    });
    if (!pedidoAberto?.ok) return responder(pedidoAberto ?? { ok: false }, 200);

    const { data: candidatos } = await sb.rpc('vessel_candidatos_de_presente',
      { p_sku: pedidoAberto.sku });
    const bons = (candidatos ?? []).filter((c: any) =>
      nomesBatem(corpo.presente_de, c.contato_nome) ||
      (c.tem_marca && nomesChegamPerto(corpo.presente_de, c.contato_nome)));

    // ⚠️ MAIS DE UM CANDIDATO = FILA. Escolher "o mais provável" seria dar a
    // garantia de uma peça para quem talvez não seja a dona.
    if (bons.length !== 1) {
      return responder({ ok: true, estado: 'pendente' });
    }
    const { data: decidido } = await sb.rpc('vessel_decidir_pedido_de_registro', {
      p_pedido: pedidoAberto.pedido, p_estado: 'aprovado', p_quem_decidiu: 'presente',
      p_conferencia: { pedido: bons[0].bling_pedido, de: bons[0].contato_nome,
                       marca: bons[0].tem_marca === true },
      p_motivo: null,
    });
    if (!decidido?.ok) return responder({ ok: true, estado: 'pendente' });
    return responder({ ok: true, estado: 'aprovado', garantia_ate: decidido.garantia_ate });
  }

  // ── REGISTRO NORMAL, ESTANDO LOGADA ──────────────────────────────────────
  if (corpo.token) {
    const { data: aberto2 } = await sb.rpc('vessel_registrar_como_cliente', {
      p_token: corpo.token, p_codigo: corpo.codigo,
      p_onde: corpo.onde ?? null, p_comprado_em: corpo.comprado_em ?? null,
    });
    if (!aberto2?.ok) return responder(aberto2 ?? { ok: false }, 200);
    // daqui para a frente o caminho é o mesmo de sempre: procurar a compra no
    // Bling pelo CPF do perfil e aprovar ou deixar pendente.
    // (reaproveitar o bloco existente, passando `aberto2` no lugar de `aberto`)
  }
```

⚠️ **Não apagar o caminho antigo** (sem token) nesta fase: a página de verdade continua usando-o, e ela só muda na Fase 2.

- [ ] **Passo 4: rodar os testes e compilar**

Executar: `node --test supabase/functions/vessel-registrar-garantia/presente.test.mjs && npm test`
Esperado: passa, inclusive o teste que compila todas as edges.

- [ ] **Passo 5: publicar e conferir**

```bash
npx supabase functions deploy vessel-registrar-garantia --project-ref kounqtdoioootxqegkij --no-verify-jwt
```
Conferir que a função responde e que o caminho antigo continua vivo (chamar sem `token`, com um código inexistente: deve responder `nao_existe`, não erro 500).

- [ ] **Passo 6: commit**

```bash
git add supabase/functions/vessel-registrar-garantia/index.ts supabase/functions/vessel-registrar-garantia/presente.test.mjs
git commit -m "Registro: aceita sessao da cliente e o caminho 'E presente?'"
```

---

### Tarefa 8: A página de teste `/verify/novo`

**Arquivos (no repositório `vessel-brasil`):**
- Criar: `verify/novo/index.html`
- Criar: `verify/novo/conta.js`
- Modificar: `vercel.json` (rewrite novo, ANTES do `/verify/:codigo`)
- Teste: `verify/novo/pagina.test.mjs`

**Interfaces:**
- Consome: a edge `vessel-conta` e a `vessel-registrar-garantia` (Tarefas 5 e 7); `vessel_verificar` para os dados da peça.
- Produz: `guardarSessao(token, expira)`, `sessaoGuardada()`, `esquecerSessao()` em `conta.js`.

- [ ] **Passo 1: escrever o teste que falha**

```js
// verify/novo/pagina.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(join(AQUI, 'index.html'), 'utf8');
const RAIZ = join(AQUI, '..', '..');
const CONFIG = JSON.parse(readFileSync(join(RAIZ, 'vercel.json'), 'utf8'));

test('⚠️ a página de teste avisa que é de teste', () => {
  assert.match(HTML, /Ambiente de teste/);
  assert.match(HTML, /<meta name="robots" content="noindex, nofollow">/);
});

test('⚠️ a senha nunca fica guardada no aparelho', () => {
  assert.ok(!/localStorage\.setItem\([^)]*senha/i.test(HTML + readFileSync(join(AQUI, 'conta.js'), 'utf8')),
    'guardar senha no navegador entrega a conta a qualquer script da página');
});

test('/verify/novo tem rewrite próprio, antes do /verify/:codigo', () => {
  const fontes = CONFIG.rewrites.map((r) => r.source);
  const novo = fontes.findIndex((s) => s.startsWith('/verify/novo'));
  assert.ok(novo >= 0, 'falta o rewrite de /verify/novo');
  assert.ok(novo < fontes.indexOf('/verify/:codigo'));
});

test('⚠️ a página de verdade continua intacta', () => {
  const real = readFileSync(join(RAIZ, 'verify/index.html'), 'utf8');
  assert.ok(!real.includes('vessel-conta'), 'a página das 157 etiquetas não muda nesta fase');
});
```

- [ ] **Passo 2: rodar e ver falhar**

Executar: `cd ~/iamundi/vessel-brasil && node --test verify/novo/pagina.test.mjs`
Esperado: FALHA (arquivos não existem).

- [ ] **Passo 3: escrever a página**

Partir da demo aprovada (`verify/demo/index.html`) como base visual — copiar o arquivo e trocar o miolo dos dados fixos por chamadas de verdade. As diferenças obrigatórias:

1. No topo, a faixa fixa: `Ambiente de teste — esta página não é o certificado da sua peça.`
2. O código vem do endereço (`/verify/novo/<codigo>`), como na página real.
3. Os dados da peça vêm de `vessel_verificar` (mesma chamada da página real).
4. Login, cadastro e "esqueci a senha" chamam a edge `vessel-conta`.
5. "Registrar em meu nome" chama `vessel-registrar-garantia` com o `token`.
6. Quando a resposta vier `pendente`, aparece o botão **"É presente?"**, que pede o nome de quem deu e chama a mesma edge com `presente_de`.

```js
// verify/novo/conta.js
// A SESSÃO DA CLIENTE, guardada no aparelho dela.
//
// ⚠️ SÓ O CÓDIGO DA SESSÃO É GUARDADO — nunca a senha, nunca o CPF. O código
// vale por tempo limitado e pode ser derrubado pelo servidor; senha guardada,
// não.
const CHAVE = 'vessel-sessao';

export function guardarSessao(token, expiraEm) {
  try {
    localStorage.setItem(CHAVE, JSON.stringify({ token, expiraEm }));
  } catch { /* navegador anônimo: a sessão vale só enquanto a aba viver */ }
}

export function sessaoGuardada() {
  try {
    const s = JSON.parse(localStorage.getItem(CHAVE) || 'null');
    if (!s?.token) return null;
    if (s.expiraEm && new Date(s.expiraEm) < new Date()) { esquecerSessao(); return null; }
    return s.token;
  } catch { return null; }
}

export function esquecerSessao() {
  try { localStorage.removeItem(CHAVE); } catch { /* idem */ }
}
```

No `vercel.json`, acrescentar **antes** das regras existentes de `/verify`:

```json
{ "source": "/verify/novo/:codigo", "destination": "/verify/novo/index.html" }
```

- [ ] **Passo 4: rodar os testes**

Executar: `npm test` (no `vessel-brasil`)
Esperado: os 4 testes novos passam e nenhum antigo quebra.

- [ ] **Passo 5: provar na tela, com navegador de verdade**

⚠️ Chrome headless trava nesta máquina: usar o módulo `playwright` por node com `channel:'chrome'` (achar o módulo com `find ~/.npm ~/.claude -maxdepth 7 -type d -name playwright-core`).

Roteiro da prova, com servidor local (`python3 -m http.server 8789`) e 375px de largura:
1. abrir `/verify/novo/?c=<código de teste>` → a peça aparece, com a faixa de teste;
2. cadastrar → a tela mostra "enviamos sua senha para t•••@…";
3. entrar com a senha (lida do registro do ZeptoMail, em ambiente de teste) → confirmação;
4. voltar à peça → aparece o nome da dona;
5. fotografar as 4 telas e conferir que nada corta a 375px.

- [ ] **Passo 6: commit e publicar**

```bash
git add verify/novo/index.html verify/novo/conta.js verify/novo/pagina.test.mjs vercel.json
git commit -m "Pagina de teste /verify/novo: contas e registro ligados ao banco"
git push origin HEAD:main
```
⚠️ Publicar o site hoje depende do vigia local (`ferramentas/instalar-o-vigia.sh --ver`), porque as Actions estão paradas por cobrança. Conferir o registro dele depois do push.

---

### Tarefa 9: "Minhas peças" e "Meus dados"

**Arquivos:**
- Criar: `db/migrations/2026-09-17-vessel-minhas-pecas.sql`
- Modificar: `supabase/functions/vessel-conta/index.ts` (ação `minhas-pecas`)
- Modificar: `vessel-brasil/verify/novo/index.html` (as duas telas)
- Teste: `db/minhas-pecas.test.mjs`

**Interfaces:**
- Consome: `vessel_conta_da_sessao`.
- Produz: `vessel_minhas_pecas(p_token text) → json` — `{ok:true, pecas:[{codigo, modelo, cor, serie, registrada_em, garantia_ate, estado}]}`.

- [ ] **Passo 1: escrever a migration**

```sql
-- db/migrations/2026-09-17-vessel-minhas-pecas.sql
--
-- ⚠️ TUDO PARTE DA SESSÃO. Nenhuma função aceita "me dê as peças do cliente X":
-- quem diz quem é o dono é o token, nunca a página.
create or replace function public.vessel_minhas_pecas(p_token text)
returns json language plpgsql security definer set search_path to 'public' as $$
declare v_sessao json; v_id uuid; v_pecas json;
begin
  v_sessao := public.vessel_conta_da_sessao(p_token);
  if not (v_sessao ->> 'ok')::boolean then
    return json_build_object('ok', false, 'motivo', 'sem_sessao');
  end if;
  v_id := (v_sessao ->> 'cliente_id')::uuid;

  select coalesce(json_agg(x order by x.registrado_em desc), '[]'::json) into v_pecas
    from (
      select r.codigo, l.modelo, l.cor, l.sku, p.numero_na_serie,
             r.registrado_em, r.garantia_ate, 'registrada' as estado
        from public.vessel_registros r
        join public.vessel_pecas p on p.codigo = r.codigo
        join public.vessel_lotes l on l.id = p.lote_id
       where r.cliente_id = v_id
      union all
      select pr.codigo, l.modelo, l.cor, l.sku, p.numero_na_serie,
             pr.criado_em, null::date, 'em conferência'
        from public.vessel_pedidos_de_registro pr
        join public.vessel_pecas p on p.codigo = pr.codigo
        join public.vessel_lotes l on l.id = p.lote_id
       where pr.cliente_id = v_id and pr.estado = 'pendente'
    ) x;

  return json_build_object('ok', true, 'pecas', v_pecas);
end;
$$;
revoke all on function public.vessel_minhas_pecas(text) from public, anon, authenticated;
grant execute on function public.vessel_minhas_pecas(text) to service_role;
```

- [ ] **Passo 2: escrever o teste estático**

```js
// db/minhas-pecas.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SQL = readFileSync(join(dirname(fileURLToPath(import.meta.url)),
  'migrations/2026-09-17-vessel-minhas-pecas.sql'), 'utf8').toLowerCase();

test('⚠️ a lista sai da SESSÃO, nunca de um id vindo da página', () => {
  assert.match(SQL, /vessel_conta_da_sessao/);
  assert.ok(!/p_cliente_id/.test(SQL), 'aceitar o id do cliente por parâmetro deixaria qualquer um listar as peças de qualquer um');
});

test('a peça em conferência aparece com esse estado', () => {
  assert.match(SQL, /em conferência/);
});
```

- [ ] **Passo 3: rodar, aplicar e provar**

Executar: `node --test db/minhas-pecas.test.mjs && npm test`, aplicar pelo MCP e provar com `rollback` (criar conta, registrar peça de teste, listar, conferir que vem 1 peça, e desfazer).

- [ ] **Passo 4: ação na edge**

Em `vessel-conta/index.ts`, acrescentar:

```ts
  if (corpo.acao === 'minhas-pecas') {
    const { data } = await sb.rpc('vessel_minhas_pecas', { p_token: corpo.token });
    return responder(data ?? { ok: false, motivo: 'falhou' });
  }
```
E acrescentar `'minhas-pecas'` à lista do teste `porta.test.mjs`.

- [ ] **Passo 5: as duas telas na página**

Em `verify/novo/index.html`, o menu ☰ ganha "Minhas peças" e "Meus dados":
- **Minhas peças:** lista cada peça com modelo, cor, número de série, estado e validade da garantia. Peça em conferência aparece com a palavra "em conferência" — ⚠️ **sem nenhuma palavra que acuse quem espera** (regra do projeto).
- **Meus dados:** nome, WhatsApp e senha editáveis; e-mail e CPF só de leitura, com a explicação de por quê.

- [ ] **Passo 6: provar na tela e commitar**

Repetir a prova de Playwright da Tarefa 8, agora passando por "Minhas peças" e "Meus dados". Commits separados por repositório.

---

### Tarefa 10: A fase de testes de verdade

**Arquivos:**
- Criar: `db/migrations/2026-09-17-vessel-lote-de-teste.sql`
- Criar: `vessel-brasil/verify/novo/LEIA-ME.txt`

- [ ] **Passo 1: criar o lote de teste**

```sql
-- db/migrations/2026-09-17-vessel-lote-de-teste.sql
--
-- ⚠️ PEÇAS DE TESTE, E ELAS PRECISAM SER RECONHECÍVEIS. Sem a marca, leitura de
-- teste vira alerta falso no painel e número errado em relatório.
insert into public.vessel_lotes (modelo, cor, sku, quantidade, fabricado_em, os)
values ('Cyrène Medium Café (TESTE)', 'Café', 'TESTE-SS0002SB.M1', 3, current_date, 'TESTE')
on conflict do nothing;
-- as peças nascem pela função de sempre, para o código continuar sorteado com
-- gen_random_bytes: chamar `vessel_gerar_lote` para esse lote.
```

⚠️ Conferir antes se `vessel_lotes` tem coluna para marcar teste; se não tiver, acrescentar `teste boolean not null default false` nesta migration e mandar o painel e os relatórios ignorarem `teste = true`.

- [ ] **Passo 2: escrever o LEIA-ME da pasta**

Escrever `verify/novo/LEIA-ME.txt` dizendo, em português simples: o que é a pasta, que ela é de teste, quais são os códigos de teste, como entrar, e a frase que o dono precisa ler antes de aprovar: **"quando esta fase for aprovada, o layout e as contas vão para o endereço das 157 etiquetas, e o formulário antigo sai."**

- [ ] **Passo 3: roteiro de validação para o dono**

Escrever no mesmo LEIA-ME o roteiro, numerado, do que ele precisa conseguir fazer sozinho:
1. abrir a peça de teste e criar o perfil; receber a senha por e-mail;
2. entrar, registrar a peça e ver a confirmação;
3. abrir a segunda peça de teste e registrar com um toque;
4. abrir "Minhas peças" e ver as duas;
5. pedir "esqueci a senha" e entrar com a nova;
6. registrar a terceira peça com o CPF de outra pessoa e usar o "É presente?".

- [ ] **Passo 4: commit**

```bash
git add db/migrations/2026-09-17-vessel-lote-de-teste.sql
git commit -m "Lote de peças de teste para a validação do dono"
# e, no vessel-brasil:
git add verify/novo/LEIA-ME.txt
git commit -m "LEIA-ME da pagina de teste, com o roteiro de validacao"
```

---

## O que fica para a Fase 2

- **Transferência de propriedade** (`vessel_transferencias`, convite por e-mail de 7 dias, cancelamento, histórico de donas).
- **Levar o layout e as contas para o certificado real**, no endereço das 157 etiquetas, e aposentar o formulário antigo.
- **Ligar o registro que já existe** (1 em 17/09/2026) ao perfil da dona quando ela entrar com o mesmo CPF.
- **WhatsApp** como segundo canal da senha, se o dono quiser (hoje é só e-mail, por decisão dele).
