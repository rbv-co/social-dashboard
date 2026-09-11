# LP nova da VESSEL — plano de execução

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA: use
> `superpowers:subagent-driven-development` (recomendada) ou
> `superpowers:executing-plans` para executar tarefa a tarefa. Os passos usam
> caixa de seleção (`- [ ]`).

**Objetivo:** substituir a página de `vesselbrasil.com.br/universovessel` por uma
LP de sete blocos que termina sempre na mesma pergunta — visitar uma loja ou
comprar pelo site — e que registra essa escolha no banco.

**Arquitetura:** página estática servida pela Vercel, sem etapa de build,
dividida em quatro arquivos (estrutura, estilo, textos dos dois idiomas,
comportamento). O cadastro continua entrando pelo Supabase por função
`security definer`; a escolha do caminho é uma **segunda escrita**, autorizada
por uma senha de uso único devolvida pela primeira.

**Tecnologias:** HTML/CSS/JS sem framework · Node `node:test` · Postgres
(Supabase) · Vercel (redirects + uma serverless function já existente) · ffmpeg.

**Desenho:** `docs/superpowers/specs/2026-09-11-lp-nova-universovessel-design.md`

---

## Restrições globais

Valem para **todas** as tarefas.

- **Dois repositórios, duas bancadas.** Página em
  `vessel-brasil/arvores/lp-nova` (branch `feat/lp-nova`); banco em
  `iamundi/arvores/lp-nova-banco` (branch `feat/lp-nova-objetivo-e-loja`).
  **Há outras janelas trabalhando nos dois.** Nunca `git add <pasta>` — sempre
  arquivo por arquivo, com `git status --short` antes e
  `git diff --cached --stat` depois.
- **Nunca mandar o runner aplicar as migrations pendentes** no iamundi. O
  registro está zerado; aplica-se uma por uma, à mão.
- **Nunca mexer em dado real.** Prova de banco é em transação com `ROLLBACK`.
  Linha de teste criada no ar é apagada dos dois lados (banco e planilha).
- **Tokens da marca:** cores `espresso #29211C` · `olive #667355` ·
  `mushroom #F2EFE6` · `warm_off_white #B7AA9A` · `olive_noir #20261C` ·
  `olive_deep #2A3023` · `champagne #C3A36A` · `cta_ivory #F4F0E7`.
  Fonte: `'Avenir Next', Montserrat, 'Segoe UI', sans-serif` — **nessa ordem**.
  **Peso 400 em tudo**; título em 200 deixa a página sem corpo.
- **Nada aparece por opacidade.** Revelação é por máscara. Uma curva só na
  página inteira: `cubic-bezier(.16,1,.3,1)`.
- **Caminho de import sempre absoluto** (`/arquivo.mjs`), nunca relativo.
- **Toda medida se prova a 375px em navegador de verdade**, com
  `getBoundingClientRect` — a foto de tela mente.
- **Supabase:** `https://kounqtdoioootxqegkij.supabase.co`. A chave anônima que
  a página usa já está dentro da página atual; reaproveitar a mesma.
- Mensagens de commit em português, descrevendo **o efeito**, não o arquivo.

---

## Estrutura de arquivos

### No `vessel-brasil`

| arquivo | responsabilidade |
|---|---|
| `universovessel-novo/index.html` | **criar** — só estrutura e conteúdo |
| `universovessel-novo/estilo.css` | **criar** — tokens, os sete blocos, responsivo |
| `universovessel-novo/textos.mjs` | **criar** — pt e en lado a lado, uma chave por frase |
| `universovessel-novo/pagina.mjs` | **criar** — revelação, idioma, vídeo, convite, os dois cartões |
| `universovessel-novo/textos.test.mjs` | **criar** — paridade de chaves entre os idiomas |
| `fotos/lp-nova/` | **criar** — hero, prancha técnica, bolsas, vídeo e capa |
| `o-que-vai-ao-ar.test.mjs:31` | **modificar** — `universovessel-novo` entra em `SAO_SITE` |
| `vercel.json` | **modificar** — raiz passa a desviar para a loja |
| `vercel-json.test.mjs` | **modificar** — os desvios novos, com e sem barra |

### No `iamundi`

| arquivo | responsabilidade |
|---|---|
| `db/migrations/2026-09-11-vessel-lista-objetivo-e-loja.sql` | **criar** — colunas, senha de uso único, as duas funções |
| `db/lp-objetivo-e-loja.test.mjs` | **criar** — confere o texto da migration |
| `coletor/provar-lp-objetivo.mjs` | **criar** — prova contra a produção, com `ROLLBACK` |
| `supabase/functions/vessel-espelhar-lista/index.ts` | **modificar** — o objetivo vai para a planilha |

---

## Task 1: O banco — as duas colunas e a senha de uso único

**Arquivos:**
- Criar: `db/migrations/2026-09-11-vessel-lista-objetivo-e-loja.sql`
- Criar: `db/lp-objetivo-e-loja.test.mjs`

**Interfaces:**
- Produz: colunas `vessel_lista_espera.objetivo`, `.loja`, `.senha_hash`,
  `.senha_em`; usadas pelas Tasks 2, 3 e 4.

**Por que a senha existe:** o dono decidiu cadastrar primeiro e perguntar
depois. Logo a escolha é uma segunda escrita. Sem senha, a página teria de dizer
"grave visita na linha 412" — e qualquer visitante poderia dizer isso sobre
qualquer linha. A lista de espera é dado de cliente.

- [ ] **Passo 1: escrever o teste que falha**

Criar `db/lp-objetivo-e-loja.test.mjs`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/* ⚠️ POR QUE ESTE ARQUIVO EXISTE
 *
 * A escolha do caminho (visita ou loja online) é uma SEGUNDA escrita, feita
 * depois de a pessoa já estar no banco. Sem prova de identidade, a porta
 * pública passaria a aceitar "grave visita na linha 412" — sobre a linha de
 * qualquer cliente.
 *
 * Este teste falha se a senha de uso único sair da migration, se ela passar a
 * ser guardada em texto puro, ou se `loja` nascer presa a uma loja só. */

const SQL = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)),
       'migrations/2026-09-11-vessel-lista-objetivo-e-loja.sql'), 'utf8')

test('as duas colunas do dono entram', () => {
  assert.match(SQL, /add column if not exists objetivo\s+text/i)
  assert.match(SQL, /add column if not exists loja\s+text/i)
})

test('⚠️ a senha é guardada como IMPRESSÃO DIGITAL, nunca em texto puro', () => {
  assert.match(SQL, /add column if not exists senha_hash\s+text/i)
  assert.ok(!/senha\s+text/i.test(SQL.replace(/senha_hash\s+text/gi, '')),
    'nenhuma coluna guarda a senha crua')
  assert.match(SQL, /digest\(/i, 'a senha passa por digest antes de ser gravada')
})

test('⚠️ `loja` nasce aceitando AS DUAS lojas abertas', () => {
  assert.match(SQL, /tivoli/i)
  assert.match(SQL, /iguatemi/i)
})

test('⚠️ a senha EXPIRA — senão vale para sempre', () => {
  assert.match(SQL, /senha_em\s+timestamptz/i)
})
```

- [ ] **Passo 2: rodar e ver falhar**

Executar: `cd /Users/erickmartins/iamundi/arvores/lp-nova-banco && node --test db/lp-objetivo-e-loja.test.mjs`
Esperado: FALHA com `ENOENT` — a migration ainda não existe.

- [ ] **Passo 3: escrever a migration**

Criar `db/migrations/2026-09-11-vessel-lista-objetivo-e-loja.sql`:

```sql
-- O QUE A PESSOA QUER, DEPOIS DE JÁ ESTAR NO BANCO.
--
-- A LP nova cadastra primeiro e pergunta depois (decisão do dono, 11/09/2026):
-- se a escolha viesse antes, quem desistisse no meio sumiria sem deixar
-- contato. Isso torna a escolha uma SEGUNDA escrita.
--
-- ⚠️ E a segunda escrita é o risco. Se a página pudesse dizer "grave visita na
-- linha 412", qualquer visitante diria isso sobre a linha de qualquer cliente.
-- Por isso `vessel_entrar_na_lista` passa a devolver uma SENHA DE USO ÚNICO,
-- guardada aqui só como impressão digital, e `vessel_marcar_objetivo` só aceita
-- quem a tiver na mão.

alter table public.vessel_lista_espera
  add column if not exists objetivo   text,
  add column if not exists loja       text,
  add column if not exists senha_hash text,
  add column if not exists senha_em   timestamptz;

comment on column public.vessel_lista_espera.objetivo is
  'O que a pessoa escolheu na LP: visita, ecommerce, ou nulo (cadastrou e não escolheu).';

-- ⚠️ NASCE ACEITANDO AS DUAS LOJAS ABERTAS (Tivoli Santa Bárbara e Iguatemi
-- Campinas). A tela de hoje grava só `iguatemi`, porque foi o que o dono pediu
-- em 11/09 — o seletor é trabalho de tela depois, SEM migration nova.
-- Não cravar loja no código da tela: duas lojas fecharam em 2026.
comment on column public.vessel_lista_espera.loja is
  'Qual loja, quando o objetivo é visita: tivoli | iguatemi.';

comment on column public.vessel_lista_espera.senha_hash is
  'sha256 da senha de uso único devolvida no cadastro. Zerada assim que usada.';

-- ⚠️ SEM LISTA FECHADA (CHECK) NO OBJETIVO. Já aconteceu neste projeto de um
-- CHECK derrubar a transação INTEIRA quando chegou um valor que ninguém previu.
-- A trava está na FUNÇÃO, que recusa o valor devolvendo erro tratado, em vez de
-- abortar tudo. Valor novo (por exemplo um terceiro caminho) passa a ser uma
-- linha na função, não uma migration de emergência.

create index if not exists vessel_lista_espera_senha_hash_idx
  on public.vessel_lista_espera (senha_hash)
  where senha_hash is not null;
```

- [ ] **Passo 4: rodar e ver passar**

Executar: `node --test db/lp-objetivo-e-loja.test.mjs`
Esperado: 4 testes passando.

- [ ] **Passo 5: conferir contra as irmãs**

⚠️ Já subiu tabela neste projeto sem a trava que todas as outras tinham, e nove
revisões não pegaram.

Executar: `ls db/migrations/*vessel*.sql` e abrir a migration da própria
`vessel_lista_espera` (`2026-08-28-vessel-lista-de-espera.sql`). Conferir que o
arquivo novo repete o que as irmãs fazem no fim: `revoke execute ... from public`
e `grant execute ... to anon`. Se as irmãs revogam também de `authenticated`,
revogar — ⚠️ `revoke from public` **não** fecha `authenticated`.

- [ ] **Passo 6: commit**

```bash
git add db/migrations/2026-09-11-vessel-lista-objetivo-e-loja.sql db/lp-objetivo-e-loja.test.mjs
git commit -m "A lista de espera passa a guardar o que a pessoa quer, e uma senha de uso unico"
```

---

## Task 2: `vessel_entrar_na_lista` devolve a senha

**Arquivos:**
- Modificar: `db/migrations/2026-09-11-vessel-lista-objetivo-e-loja.sql`
- Modificar: `db/lp-objetivo-e-loja.test.mjs`

**Interfaces:**
- Consome: colunas da Task 1.
- Produz: a função passa a devolver `'senha'` (uuid em texto) no json de
  resposta. A Task 12 (a página) lê essa chave.

⚠️ **Três caminhos de saída da função devolvem sucesso FALSO de propósito** — a
armadilha anti-robô e o teto por IP. Eles **têm de devolver uma senha falsa**,
gerada na hora e não gravada. Sem isso, a ausência da senha vira o sinal que
diz ao robô que ele foi pego, e a armadilha deixa de servir.

⚠️ **`ja_na_lista` também devolve senha de verdade.** É gente real voltando; se
não devolvesse, quem já se cadastrou antes não conseguiria escolher caminho
nenhum — e essas são justamente as pessoas mais engajadas.

- [ ] **Passo 1: escrever o teste que falha**

Acrescentar a `db/lp-objetivo-e-loja.test.mjs`:

```js
/**
 * O corpo de UMA função, e não daí até o fim do arquivo.
 * ⚠️ A migration guarda duas funções. Uma fatia que vai até o fim arrastaria a
 * `vessel_marcar_objetivo` para dentro da conta — e ela tem `json_build_object`
 * SEM senha, de propósito. O teste ficaria verde hoje e vermelho quando a Task 3
 * entrasse, apontando para a tarefa errada. Mesmo cuidado de `ultimaDefinicaoDe`
 * em `db/cartao-trava-a-serie.test.mjs`.
 */
function corpoDaFuncao(nome) {
  const i = SQL.indexOf('create or replace function public.' + nome)
  assert.notEqual(i, -1, 'a função ' + nome + ' não está na migration')
  const resto = SQL.slice(i)
  const fim = resto.indexOf('$function$;')
  return fim === -1 ? resto : resto.slice(0, fim + 11)
}

test('⚠️ TODO caminho de saída devolve senha — inclusive os falsos', () => {
  const corpo = corpoDaFuncao('vessel_entrar_na_lista')
  const saidas = corpo.match(/json_build_object\(/g) || []
  const comSenha = corpo.match(/'senha'/g) || []
  assert.equal(comSenha.length, saidas.length,
    'a armadilha e o teto por IP precisam devolver senha FALSA: sem ela, a '
    + 'ausência da senha vira o sinal de que o robô foi pego')
})

test('⚠️ quem JÁ ESTÁ na lista também recebe senha de verdade', () => {
  assert.match(SQL, /ja_na_lista[\s\S]{0,400}?'senha'/i)
})
```

- [ ] **Passo 2: rodar e ver falhar**

Executar: `node --test db/lp-objetivo-e-loja.test.mjs`
Esperado: FALHA nos dois testes novos.

- [ ] **Passo 3: acrescentar a função à migration**

Copiar o corpo atual de `vessel_entrar_na_lista` (obtido com
`select pg_get_functiondef(oid) from pg_proc where proname='vessel_entrar_na_lista'`)
e aplicar **três** mudanças. O resto do corpo fica intacto — ele carrega regras
já pagas (a armadilha muda, o teto que fala diferente nas duas portas, a trava
de fila, e o `v_atual.id is not null` que não pode virar `found`).

Declarar, junto das outras variáveis:

```sql
  v_senha    uuid := gen_random_uuid();
```

Trocar **todo** `return json_build_object('ok', ...)` para incluir a senha.
Exemplo do caminho da armadilha:

```sql
  -- ⚠️ SENHA FALSA, e de propósito: não é gravada em lugar nenhum. Robô que
  -- recebesse sucesso SEM senha saberia que caiu na armadilha e tentaria de
  -- outro jeito. Aqui ele sai achando que deu certo, e a senha não abre porta.
  if coalesce(trim(p_armadilha), '') <> '' then
    return json_build_object('ok', true, 'situacao', 'reservado',
                             'senha', v_senha::text);
  end if;
```

No caminho de quem já está na lista, gravar a senha antes de responder:

```sql
    if not v_prevenda then
      update public.vessel_lista_espera
         set senha_hash = encode(extensions.digest(v_senha::text, 'sha256'), 'hex'),
             senha_em   = now()
       where id = v_atual.id;
      return json_build_object('ok', true, 'situacao', 'ja_na_lista',
                               'senha', v_senha::text);
    end if;
```

E no insert final:

```sql
  insert into public.vessel_lista_espera
    (nome, email, whatsapp, ip_hash, aceite_versao, origem, senha_hash, senha_em)
  values
    (trim(p_nome), v_email, trim(p_whatsapp), v_ip, p_aceite_versao, v_origem,
     encode(extensions.digest(v_senha::text, 'sha256'), 'hex'), now())
  returning id into v_id;

  return json_build_object('ok', true,
    'situacao', case when v_prevenda then 'reservado' else 'na_lista' end,
    'senha', v_senha::text,
    'restam', case when v_prevenda then greatest(0, v_total - (v_feitos + 1)) else null end);
```

⚠️ O caminho `invalido` também devolve senha falsa — a regra vale para os
**seis** `json_build_object` da função.

- [ ] **Passo 4: rodar e ver passar**

Executar: `node --test db/lp-objetivo-e-loja.test.mjs`
Esperado: 6 testes passando.

- [ ] **Passo 5: commit**

```bash
git add db/migrations/2026-09-11-vessel-lista-objetivo-e-loja.sql db/lp-objetivo-e-loja.test.mjs
git commit -m "O cadastro devolve uma senha de uso unico — inclusive quando finge que deu certo"
```

---

## Task 3: `vessel_marcar_objetivo`

**Arquivos:**
- Modificar: `db/migrations/2026-09-11-vessel-lista-objetivo-e-loja.sql`
- Modificar: `db/lp-objetivo-e-loja.test.mjs`

**Interfaces:**
- Consome: a senha da Task 2.
- Produz: `vessel_marcar_objetivo(p_senha text, p_objetivo text, p_loja text)`
  → `json` com `{ok, situacao}`. A Task 12 a chama.

- [ ] **Passo 1: escrever o teste que falha**

Acrescentar a `db/lp-objetivo-e-loja.test.mjs`:

```js
Reaproveite `corpoDaFuncao`, criada na Task 2 — ela é o que impede uma função
de arrastar a outra para dentro da conta.

```js
test('a função da segunda escrita existe e é security definer', () => {
  const corpo = corpoDaFuncao('vessel_marcar_objetivo')
  assert.match(corpo, /security definer/i)
  assert.match(corpo, /set search_path to 'public'/i)
})

test('⚠️ a senha é de USO ÚNICO: some depois de usada', () => {
  const corpo = corpoDaFuncao('vessel_marcar_objetivo')
  assert.match(corpo, /senha_hash\s*=\s*null/i,
    'sem zerar, a mesma senha reescreveria o objetivo para sempre')
})

test('⚠️ a função NUNCA recebe id de linha', () => {
  const corpo = corpoDaFuncao('vessel_marcar_objetivo')
  assert.ok(!/p_id\b/.test(corpo),
    'receber id deixaria qualquer visitante escrever na linha de qualquer cliente')
})

test('⚠️ valor de objetivo desconhecido é RECUSADO, não gravado', () => {
  const corpo = corpoDaFuncao('vessel_marcar_objetivo')
  assert.match(corpo, /not in \('visita', 'ecommerce'\)|<> 'visita' and .* <> 'ecommerce'/i)
})
```

- [ ] **Passo 2: rodar e ver falhar**

Executar: `node --test db/lp-objetivo-e-loja.test.mjs`
Esperado: FALHA nos quatro testes novos.

- [ ] **Passo 3: escrever a função**

Acrescentar à migration:

```sql
-- A SEGUNDA ESCRITA. Só passa quem tem a senha devolvida pelo cadastro.
create or replace function public.vessel_marcar_objetivo(
  p_senha    text,
  p_objetivo text,
  p_loja     text default null
) returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_hash text := encode(extensions.digest(coalesce(p_senha, ''), 'sha256'), 'hex');
  v_id   bigint;
begin
  -- ⚠️ A TRAVA MORA AQUI, e não num CHECK da coluna. CHECK derruba a transação
  -- inteira quando chega um valor novo; aqui o valor novo é uma linha a mais.
  if p_objetivo not in ('visita', 'ecommerce') then
    return json_build_object('ok', false, 'situacao', 'objetivo_invalido');
  end if;

  -- A senha vale por 2 horas. Sem prazo, uma senha vazada abriria a linha para
  -- sempre; com prazo, a janela é a da própria visita à página.
  update public.vessel_lista_espera
     set objetivo   = p_objetivo,
         loja       = case when p_objetivo = 'visita'
                           then coalesce(nullif(trim(p_loja), ''), 'iguatemi')
                           else null end,
         -- USO ÚNICO: some assim que usada.
         senha_hash = null,
         -- O espelho precisa rodar de novo para levar o objetivo adiante.
         planilha_em = null
   where senha_hash = v_hash
     and senha_em > now() - interval '2 hours'
  returning id into v_id;

  -- ⚠️ UPDATE QUE NÃO ACHA LINHA NÃO DÁ ERRO: devolve zero linhas, calado. Sem
  -- esta checagem, senha errada ou vencida responderia "deu certo".
  if v_id is null then
    return json_build_object('ok', false, 'situacao', 'senha_invalida');
  end if;

  return json_build_object('ok', true, 'situacao', 'registrado');
end;
$function$;

revoke execute on function public.vessel_marcar_objetivo(text, text, text) from public;
revoke execute on function public.vessel_marcar_objetivo(text, text, text) from authenticated;
grant  execute on function public.vessel_marcar_objetivo(text, text, text) to anon;
```

- [ ] **Passo 4: rodar e ver passar**

Executar: `node --test db/lp-objetivo-e-loja.test.mjs`
Esperado: 10 testes passando.

- [ ] **Passo 5: provar contra a produção, com ROLLBACK**

Criar `coletor/provar-lp-objetivo.mjs`, no molde de
`coletor/provar-cartoes-fila-e-trava.mjs`. Ele abre transação, aplica o SQL da
migration, exercita o caminho inteiro e volta atrás:

```js
// PROVA DA MIGRATION CONTRA A PRODUÇÃO, SEM DEIXAR RASTRO.
// Tudo acontece dentro de uma transação que termina em ROLLBACK.
import { readFileSync } from 'node:fs'
import pg from 'pg'

const sql = readFileSync(new URL('../db/migrations/2026-09-11-vessel-lista-objetivo-e-loja.sql', import.meta.url), 'utf8')
const cli = new pg.Client({ connectionString: process.env.DATABASE_URL })
await cli.connect()
await cli.query('begin')
try {
  await cli.query(sql)

  // 1. cadastro pela porta pública devolve senha
  const { rows: [r1] } = await cli.query(
    `select public.vessel_entrar_na_lista($1,$2,$3,$4,null,null) as r`,
    ['Prova Rollback', `prova+${Date.now()}@exemplo.invalido`, '19999999999', 'v1'])
  const senha = r1.r.senha
  console.log('senha devolvida:', senha ? 'sim' : 'NAO — defeito')

  // 2. senha errada é recusada, e NÃO grava
  const { rows: [r2] } = await cli.query(
    `select public.vessel_marcar_objetivo($1,'visita',null) as r`,
    ['00000000-0000-0000-0000-000000000000'])
  console.log('senha errada:', r2.r.situacao, '(esperado: senha_invalida)')

  // 3. senha certa grava visita + loja
  const { rows: [r3] } = await cli.query(
    `select public.vessel_marcar_objetivo($1,'visita',null) as r`, [senha])
  console.log('senha certa:', r3.r.situacao, '(esperado: registrado)')

  // 4. USO ÚNICO: a mesma senha não serve duas vezes
  const { rows: [r4] } = await cli.query(
    `select public.vessel_marcar_objetivo($1,'ecommerce',null) as r`, [senha])
  console.log('reuso:', r4.r.situacao, '(esperado: senha_invalida)')
} finally {
  await cli.query('rollback')   // ⚠️ SEMPRE, inclusive se algo acima explodir
  await cli.end()
}
```

Executar: `node coletor/provar-lp-objetivo.mjs`
Esperado: `sim` / `senha_invalida` / `registrado` / `senha_invalida`.

- [ ] **Passo 6: commit**

```bash
git add db/migrations/2026-09-11-vessel-lista-objetivo-e-loja.sql db/lp-objetivo-e-loja.test.mjs coletor/provar-lp-objetivo.mjs
git commit -m "A escolha do caminho vira dado, e so entra com a senha do proprio cadastro"
```

---

## Task 4: o espelho leva o objetivo à planilha

**Arquivos:**
- Modificar: `supabase/functions/vessel-espelhar-lista/index.ts`

**Interfaces:**
- Consome: coluna `objetivo` (Task 1).

Quem trabalha no Bling e na planilha precisa **ver** o objetivo — informação que
existe e ninguém lê é informação que não existe. O `codigo` do Bling fica como
está (`LP-<AAAAMMDD>-<id>`): mexer no formato quebraria o padrão das linhas já
gravadas.

- [ ] **Passo 1: ler a função e achar onde o CSV é montado**

Executar: `grep -n "csv\|cabecalho\|join(';')" supabase/functions/vessel-espelhar-lista/index.ts`

- [ ] **Passo 2: acrescentar a coluna ao cabeçalho e à linha**

A coluna entra **no fim**, nunca no meio: quem já baixou o CSV tem planilha
montada na ordem antiga.

```ts
// A coluna nova vai NO FIM. No meio, ela deslocaria todas as seguintes e
// quebraria qualquer planilha que alguém já tenha montado sobre este arquivo.
const CABECALHO = [...COLUNAS_DE_HOJE, 'objetivo']

// Texto legível, não o código do banco: quem lê a planilha é gente.
function objetivoLegivel(v: string | null) {
  if (v === 'visita') return 'quer visitar a loja'
  if (v === 'ecommerce') return 'quer comprar pelo site'
  return 'ainda nao escolheu'
}
```

- [ ] **Passo 3: publicar a edge**

⚠️ Edge **não** sobe com `git push`, e **nunca** pela interface. Pela CLI:

```bash
supabase functions deploy vessel-espelhar-lista --no-verify-jwt
```

⚠️ **Não usar `--use-api`**: ela LIGA o `verify_jwt` e derruba o cron, porque o
segredo do cron não é um JWT.

- [ ] **Passo 4: provar no ar e apagar o rastro**

Cadastrar pela **porta pública** (não por INSERT direto — provaria o caminho
errado), esperar a rodada, conferir a linha no CSV do Zoho com a coluna nova, e
**apagar do banco e da planilha**. A rodada seguinte tem de deixar o CSV sem a
linha, porque o robô compara o arquivo com o que ele deveria ser.

- [ ] **Passo 5: commit**

```bash
git add supabase/functions/vessel-espelhar-lista/index.ts
git commit -m "A planilha passa a dizer o que a pessoa quer"
```

---

## Task 5: a bancada da página e o guarda de publicação

**Arquivos:**
- Criar: `universovessel-novo/index.html`
- Modificar: `o-que-vai-ao-ar.test.mjs:31`

**Interfaces:**
- Produz: a pasta que as Tasks 6 a 13 preenchem.

⚠️ **Este teste é o guarda:** num site estático não existe pasta privada. Pasta
nova na raiz sem decisão **falha aqui**, e não em produção. Em 01/09/2026 o
catálogo de atacado ficou aberto com preço de cada bolsa por causa disso.

- [ ] **Passo 1: rodar o teste e ver falhar**

```bash
cd /Users/erickmartins/iamundi/vessel-brasil/arvores/lp-nova
mkdir -p universovessel-novo && touch universovessel-novo/index.html
npm test 2>&1 | tail -5
```
Esperado: FALHA — `estas pastas iriam AO AR PUBLICO sem ninguem ter decidido isso: universovessel-novo`.

- [ ] **Passo 2: decidir a pasta**

Em `o-que-vai-ao-ar.test.mjs`, linha 31, acrescentar `'universovessel-novo'` ao
conjunto `SAO_SITE` — **é site**, e a decisão é consciente: a página fica
publicamente acessível durante o teste, por isso o passo 3.

- [ ] **Passo 3: o esqueleto, com a marca de não indexar**

⚠️ Criar **vazios** `universovessel-novo/estilo.css` e
`universovessel-novo/pagina.mjs` junto com o `index.html`. Eles só ganham
conteúdo nas Tasks 9 e 7; sem os arquivos, a página dá 404 em dois recursos
durante quatro tarefas, e 404 que a gente já espera é 404 que esconde o próximo.

```html
<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<!-- ⚠️ ENQUANTO EM TESTE. Sem isto o Google acha a página inacabada e passa a
     mostrá-la nos resultados; tirar de lá depois é lento. SAI NA VIRADA. -->
<meta name="robots" content="noindex, nofollow">
<title>Vessel Brasil</title>
<link rel="stylesheet" href="/universovessel-novo/estilo.css">
</head>
<body>
<main id="pagina"></main>
<script type="module" src="/universovessel-novo/pagina.mjs"></script>
</body>
</html>
```

- [ ] **Passo 4: rodar e ver passar**

Executar: `npm test`
Esperado: todos passando (298 + os que vierem).

- [ ] **Passo 5: commit**

```bash
git add universovessel-novo/index.html o-que-vai-ao-ar.test.mjs
git commit -m "A pagina nova ganha endereco proprio, fora do alcance do buscador"
```

---

## Task 6: os textos nos dois idiomas

**Arquivos:**
- Criar: `universovessel-novo/textos.mjs`
- Criar: `universovessel-novo/textos.test.mjs`

**Interfaces:**
- Produz: `export const TEXTOS = { pt: {...}, en: {...} }` e
  `export function texto(idioma, chave)`. Tasks 7, 10, 11 e 12 consomem.

⚠️ **O defeito mais provável de uma página bilíngue é uma frase traduzida num
idioma só** — e ele é silencioso: a página abre, só que com um pedaço na língua
errada. O teste de paridade é o que o torna barulhento.

- [ ] **Passo 1: escrever o teste que falha**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { TEXTOS } from './textos.mjs'

test('⚠️ os dois idiomas têm EXATAMENTE as mesmas chaves', () => {
  const pt = Object.keys(TEXTOS.pt).sort()
  const en = Object.keys(TEXTOS.en).sort()
  const soEmPt = pt.filter((k) => !en.includes(k))
  const soEmEn = en.filter((k) => !pt.includes(k))
  assert.deepEqual(soEmPt, [], 'faltou traduzir para o inglês: ' + soEmPt.join(', '))
  assert.deepEqual(soEmEn, [], 'existe só em inglês: ' + soEmEn.join(', '))
})

test('nenhuma frase está vazia', () => {
  for (const idioma of ['pt', 'en'])
    for (const [chave, valor] of Object.entries(TEXTOS[idioma]))
      assert.ok(String(valor).trim() !== '', `${idioma}.${chave} está vazia`)
})

test('⚠️ os títulos em inglês são IGUAIS nos dois idiomas', () => {
  // O padrão da marca é título em inglês + apoio em português. No modo
  // português, o título NÃO se traduz — traduzir "Made in Brazil" mataria o
  // bloco 6 inteiro, que nasceu dessa expressão.
  for (const chave of Object.keys(TEXTOS.pt).filter((k) => k.endsWith('.titulo')))
    assert.equal(TEXTOS.pt[chave], TEXTOS.en[chave], chave + ' deveria ser igual')
})
```

- [ ] **Passo 2: rodar e ver falhar**

Executar: `node --test universovessel-novo/textos.test.mjs`
Esperado: FALHA — `textos.mjs` não existe.

- [ ] **Passo 3: escrever os textos**

```js
// OS TEXTOS DA PÁGINA, NOS DOIS IDIOMAS, LADO A LADO.
//
// ⚠️ Frase solta dentro do HTML é frase que se traduz num idioma e se esquece
// no outro — e o esquecimento não dá erro: a página abre com um pedaço na
// língua errada. Aqui as duas versões ficam a uma linha de distância, e o
// teste ao lado falha se uma faltar.
//
// PADRÃO DA MARCA: título em inglês, apoio em português. No modo português os
// títulos NÃO se traduzem (é decisão do dono, 11/09/2026) — por isso as chaves
// `.titulo` são idênticas nos dois lados.

export const TEXTOS = {
  pt: {
    'hero.titulo': 'A new expression of Brazilian luxury.',
    'hero.visitar': 'Agendar uma visita',
    'hero.comprar': 'Comprar agora',

    'autoria.titulo': 'Designed by hand. Created with intention.',
    'autoria.apoio': 'Cada peça Vessel nasce de um desenho autoral e é '
      + 'desenvolvida internamente, da primeira linha ao produto final.',

    'atelie.titulo': 'Handmade. Technology perfected.',
    'atelie.apoio': 'Produção própria, em nosso ateliê no Brasil, unindo '
      + 'trabalho manual, tecnologia e controle integral de cada etapa.',

    'desejo.titulo': 'Sculpted to be remembered.',
    'desejo.descobrir': 'Descobrir',

    'identidade.titulo': 'Every piece has an identity.',
    'identidade.apoio': 'Cada peça carrega número de série e etiqueta de '
      + 'autenticidade. Uma bolsa Vessel se prova.',

    'brasil.titulo': 'Designed. Crafted. Made in Brazil.',

    'fim.titulo': 'Experience Vessel',
    'fim.apoio': 'Conheça a coleção online ou viva a Vessel pessoalmente.',
    'fim.visitar': 'Agendar uma visita',
    'fim.comprar': 'Comprar a coleção',

    'convite.titulo': 'Acesso privado',
    'convite.apoio': 'Deixe seu contato para saber em primeira mão.',
    'convite.nome': 'Nome',
    'convite.email': 'E-mail',
    'convite.whatsapp': 'WhatsApp',
    'convite.enviar': 'Entrar',
    'convite.depois': 'Ver a página primeiro',
    'convite.erro': 'Não conseguimos enviar agora. Tente de novo em instantes.',

    'escolha.titulo': 'Obrigado. Como você prefere continuar?',
    'escolha.visita.titulo': 'Visitar uma loja',
    'escolha.visita.apoio': 'Agende sua visita para uma experiência exclusiva '
      + 'com nossa personal shopper.',
    'escolha.loja.titulo': 'Comprar pelo site',
    'escolha.loja.apoio': 'Garanta sua peça Vessel na comodidade de sua casa.',
    'escolha.visita.feito': 'Recebemos seu pedido. Entraremos em contato pelo '
      + 'WhatsApp para combinar o melhor horário.',
  },

  en: {
    'hero.titulo': 'A new expression of Brazilian luxury.',
    'hero.visitar': 'Visit a store',
    'hero.comprar': 'Shop now',

    'autoria.titulo': 'Designed by hand. Created with intention.',
    'autoria.apoio': 'Every Vessel piece begins as an original drawing and is '
      + 'developed in house, from the first line to the finished product.',

    'atelie.titulo': 'Handmade. Technology perfected.',
    'atelie.apoio': 'Made in our own atelier in Brazil, combining hand work, '
      + 'technology and full control of every stage.',

    'desejo.titulo': 'Sculpted to be remembered.',
    'desejo.descobrir': 'Discover',

    'identidade.titulo': 'Every piece has an identity.',
    'identidade.apoio': 'Each piece carries a serial number and an '
      + 'authenticity tag. A Vessel bag can prove itself.',

    'brasil.titulo': 'Designed. Crafted. Made in Brazil.',

    'fim.titulo': 'Experience Vessel',
    'fim.apoio': 'Discover the collection online or experience Vessel in person.',
    'fim.visitar': 'Visit a store',
    'fim.comprar': 'Shop the collection',

    'convite.titulo': 'Private access',
    'convite.apoio': 'Leave your contact to be the first to know.',
    'convite.nome': 'Name',
    'convite.email': 'Email',
    'convite.whatsapp': 'WhatsApp',
    'convite.enviar': 'Join',
    'convite.depois': 'See the page first',
    'convite.erro': 'We could not send it right now. Please try again shortly.',

    'escolha.titulo': 'Thank you. How would you like to continue?',
    'escolha.visita.titulo': 'Visit a store',
    'escolha.visita.apoio': 'Book your visit for an exclusive experience with '
      + 'our personal shopper.',
    'escolha.loja.titulo': 'Shop online',
    'escolha.loja.apoio': 'Secure your Vessel piece from the comfort of home.',
    'escolha.visita.feito': 'We received your request. We will reach out on '
      + 'WhatsApp to arrange the best time.',
  },
}

/** A frase, no idioma pedido. Chave que não existe grita no teste, não aqui. */
export function texto(idioma, chave) {
  return TEXTOS[idioma]?.[chave] ?? TEXTOS.pt[chave] ?? ''
}
```

- [ ] **Passo 4: rodar e ver passar**

Executar: `node --test universovessel-novo/textos.test.mjs`
Esperado: 3 testes passando.

- [ ] **Passo 5: commit**

```bash
git add universovessel-novo/textos.mjs universovessel-novo/textos.test.mjs
git commit -m "Os textos da pagina passam a morar num lugar so, nos dois idiomas"
```

---

## Task 7: a troca de idioma

**Arquivos:**
- Criar: `universovessel-novo/pagina.mjs`
- Criar: `universovessel-novo/idioma.test.mjs`

**Interfaces:**
- Consome: `texto(idioma, chave)` da Task 6.

⚠️ **`pagina.mjs` importa `textos.mjs` por caminho RELATIVO (`./textos.mjs`).**
A restrição global "import sempre absoluto" vale para o que a **página** carrega
(`index.html` → `pagina.mjs`), não para um módulo chamando o vizinho: caminho
absoluto dentro do módulo resolve para a raiz do DISCO no `node --test`, e o
teste desta tarefa nunca roda. É o padrão da casa — `regras-da-lista.mjs` é
carregado por caminho absoluto e importa `./verify/regras.js` relativo.
- Produz: `export function idiomaInicial(location, armazem)` e
  `export function aplicarIdioma(raiz, idioma)`. Task 10 chama `aplicarIdioma`.

- [ ] **Passo 1: escrever o teste que falha**

Criar `universovessel-novo/idioma.test.mjs`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { idiomaInicial } from './pagina.mjs'

const semArmazem = { getItem: () => null, setItem: () => {} }

test('o padrão é português', () => {
  assert.equal(idiomaInicial(new URL('https://x/y'), semArmazem), 'pt')
})

test('⚠️ o endereço manda mais que a memória do navegador', () => {
  // Sem isto não há como MANDAR a versão em inglês para alguém: quem já visitou
  // em português abriria o link em português, e o remetente nunca saberia.
  const lembra = { getItem: () => 'pt', setItem: () => {} }
  assert.equal(idiomaInicial(new URL('https://x/y?idioma=en'), lembra), 'en')
})

test('idioma desconhecido cai no padrão, não quebra', () => {
  assert.equal(idiomaInicial(new URL('https://x/y?idioma=zz'), semArmazem), 'pt')
})

test('⚠️ armazém que EXPLODE não derruba a página', () => {
  // localStorage estoura em janela anônima. Se a leitura não estiver protegida,
  // o erro sobe e leva a página inteira junto.
  const explode = { getItem: () => { throw new Error('SecurityError') }, setItem: () => {} }
  assert.equal(idiomaInicial(new URL('https://x/y'), explode), 'pt')
})
```

- [ ] **Passo 2: rodar e ver falhar**

Executar: `node --test universovessel-novo/idioma.test.mjs`
Esperado: FALHA — `idiomaInicial` não existe.

- [ ] **Passo 3: implementar**

Em `universovessel-novo/pagina.mjs`:

```js
import { texto, TEXTOS } from './textos.mjs'

const IDIOMAS = ['pt', 'en']
const CHAVE_IDIOMA = 'vessel-idioma'

/**
 * Qual idioma abrir. O ENDEREÇO manda mais que a memória: é o que permite
 * mandar a versão em inglês para alguém.
 * ⚠️ A leitura do armazém vai em try/catch — ele estoura em janela anônima.
 */
export function idiomaInicial(url, armazem) {
  const doEndereco = url.searchParams.get('idioma')
  if (IDIOMAS.includes(doEndereco)) return doEndereco
  try {
    const lembrado = armazem.getItem(CHAVE_IDIOMA)
    if (IDIOMAS.includes(lembrado)) return lembrado
  } catch { /* janela anônima: segue no padrão */ }
  return 'pt'
}

/** Troca todo texto marcado com data-t, e o idioma da própria página. */
export function aplicarIdioma(raiz, idioma) {
  raiz.querySelectorAll('[data-t]').forEach((el) => {
    el.textContent = texto(idioma, el.dataset.t)
  })
  raiz.querySelectorAll('[data-t-ph]').forEach((el) => {
    el.placeholder = texto(idioma, el.dataset.tPh)
  })
  // ⚠️ O `lang` do documento muda junto: é o que leitor de tela e buscador leem.
  document.documentElement.lang = idioma === 'en' ? 'en' : 'pt-BR'
}
```

- [ ] **Passo 4: rodar e ver passar**

Executar: `node --test universovessel-novo/idioma.test.mjs`
Esperado: 4 testes passando.

- [ ] **Passo 5: commit**

```bash
git add universovessel-novo/pagina.mjs universovessel-novo/idioma.test.mjs
git commit -m "A pagina fala os dois idiomas, e o ingles cabe num link"
```

---

## Task 8: o vídeo do ateliê

**Arquivos:**
- Criar: `fotos/lp-nova/atelie.mp4`, `fotos/lp-nova/atelie.webm`, `fotos/lp-nova/atelie-capa.jpg`

**Interfaces:**
- Produz: os três arquivos que o bloco 3 (Task 10) consome.

**Origem:** `~/Desktop/WhatsApp Video 2026-09-10 at 14.24.03.mp4` — 576×1024,
19,9s, sem áudio. Confirmado pelo dono como o vídeo do ateliê; **não há original
melhor.**

Trechos aproveitados (medidos quadro a quadro): ~3–6s moldes sobre o couro ·
~7–10s a mão marcando · ~11–13s a máquina · ~18–20s o acabamento a martelo.
**Saem** o rosto do começo e a mesa com cola (~15–17s).

- [ ] **Passo 1: cortar os quatro trechos e emendar**

```bash
V="$HOME/Desktop/WhatsApp Video 2026-09-10 at 14.24.03.mp4"
S=/tmp/vessel-video && mkdir -p "$S"
# Um corte por trecho. `-an` porque não há áudio e nem pode haver.
for t in "3 3" "7 3" "11 2.5" "17.5 2.5"; do
  set -- $t
  ffmpeg -v error -y -ss "$1" -t "$2" -i "$V" -an -c:v libx264 -crf 20 "$S/p$1.mp4"
done
printf "file '%s'\n" "$S"/p*.mp4 > "$S/lista.txt"
ffmpeg -v error -y -f concat -safe 0 -i "$S/lista.txt" -an -c copy "$S/emendado.mp4"
ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1 "$S/emendado.mp4"
```
Esperado: duração entre 10 e 12 segundos.

- [ ] **Passo 2: comprimir nos dois formatos**

```bash
# ⚠️ Alvo ~2 MB: este bloco fica NO MEIO da página. Se pesar, ele não atrasa só
# a si mesmo — atrasa tudo que vem depois, no celular na rede da rua.
ffmpeg -v error -y -i "$S/emendado.mp4" -an -c:v libx264 -crf 28 -preset slow \
  -movflags +faststart fotos/lp-nova/atelie.mp4
ffmpeg -v error -y -i "$S/emendado.mp4" -an -c:v libvpx-vp9 -crf 36 -b:v 0 \
  fotos/lp-nova/atelie.webm
ls -lh fotos/lp-nova/atelie.mp4 fotos/lp-nova/atelie.webm
```
Esperado: cada um com 2 MB ou menos.

- [ ] **Passo 3: o quadro de capa**

```bash
# ⚠️ É ELE que fica para quem pediu menos animação no sistema. Tem de ser um
# quadro que se sustente parado — o primeiro do trecho da mão marcando.
ffmpeg -v error -y -ss 4 -i "$S/emendado.mp4" -frames:v 1 -q:v 3 \
  fotos/lp-nova/atelie-capa.jpg
```

- [ ] **Passo 4: conferir olhando**

Abrir `fotos/lp-nova/atelie-capa.jpg` e o `.mp4`. Conferir: nenhum rosto, a volta
não tem começo e fim perceptíveis, e a capa se sustenta sozinha.

- [ ] **Passo 5: commit**

```bash
git add fotos/lp-nova/atelie.mp4 fotos/lp-nova/atelie.webm fotos/lp-nova/atelie-capa.jpg
git commit -m "O video do atelie entra cortado, mudo e leve"
```

---

## Task 9: o motor de revelação

**Arquivos:**
- Modificar: `universovessel-novo/pagina.mjs`
- Criar: `universovessel-novo/estilo.css`

**Interfaces:**
- Produz: `export function ligarRevelacao(raiz)`. Task 10 chama.

⚠️ **A armadilha que apaga conteúdo para sempre:** `clip-path` que esconde um
elemento **zera a área dele**, e o `IntersectionObserver` calcula por área
visível. Área zero nunca cruza o limite → o gatilho nunca dispara → a foto some.
Já foi provado que um observador novo no mesmo alvo também não dispara.

- [ ] **Passo 1: implementar, observando o PAI**

```js
/**
 * Revela por máscara, nunca por opacidade (o dono reprovou desbotar).
 * ⚠️ OBSERVA O PAI, e não o elemento escondido: máscara zera a área, e área
 * zero nunca cruza o limite do observador — o gatilho que revelaria a foto
 * nunca dispararia, e o conteúdo sumiria para sempre.
 */
export function ligarRevelacao(raiz) {
  const alvos = [...raiz.querySelectorAll('[data-revela]')]
  if (!('IntersectionObserver' in window)) {
    alvos.forEach((el) => el.classList.add('visivel'))
    return
  }
  const obs = new IntersectionObserver((entradas) => {
    entradas.forEach((e) => {
      if (!e.isIntersecting) return
      e.target.classList.add('visivel')
      obs.unobserve(e.target)
    })
  }, { threshold: 0.15 })
  alvos.forEach((el) => obs.observe(el))

  // ⚠️ REDE DE SEGURANÇA. Nunca apostar conteúdo num observador: passados 6
  // segundos, o que ainda estiver escondido aparece de qualquer jeito.
  setTimeout(() => alvos.forEach((el) => el.classList.add('visivel')), 6000)
}
```

- [ ] **Passo 2: o CSS da máscara**

```css
:root{
  --espresso:#29211C; --olive:#667355; --mushroom:#F2EFE6;
  --warm-off-white:#B7AA9A; --olive-noir:#20261C; --olive-deep:#2A3023;
  --champagne:#C3A36A; --cta-ivory:#F4F0E7;
  /* UMA CURVA SÓ na página inteira. */
  --curva:cubic-bezier(.16,1,.3,1);
  --fonte:'Avenir Next',Montserrat,'Segoe UI',sans-serif;
}
body{margin:0;font-family:var(--fonte);font-weight:400;background:var(--mushroom);color:var(--espresso)}

/* A REVELAÇÃO. O invólucro esconde; o conteúdo sobe de trás da borda.
   ⚠️ Sem `opacity` no vocabulário: desbotar parece template, e o dono reprovou. */
[data-revela]{overflow:hidden}
[data-revela] > *{transform:translateY(110%);transition:transform .9s var(--curva)}
[data-revela].visivel > *{transform:none}

/* ⚠️ A MÁSCARA NÃO PODE CORTAR PERNA DE ç/g/p. Medir a altura do invólucro
   contra a altura real do texto antes de dar por pronto. */
@media (prefers-reduced-motion:reduce){
  [data-revela] > *{transform:none;transition:none}
}
```

- [ ] **Passo 3: commit**

```bash
git add universovessel-novo/pagina.mjs universovessel-novo/estilo.css
git commit -m "O vocabulario de movimento aprovado entra na pagina nova"
```

---

## Task 10: os blocos 1, 2 e 3

**Arquivos:**
- Modificar: `universovessel-novo/index.html`, `estilo.css`, `pagina.mjs`

**Interfaces:**
- Consome: `aplicarIdioma`, `ligarRevelacao`, os arquivos da Task 8.

- [ ] **Passo 1: escolher as imagens com o dono**

Antes de montar, levar ao dono: 4 candidatas de hero (das 424 de
`17. Marketing/ENSAIOS/07.09 - DIREÇÃO GIULIANO`, mais `VESSEL HERO/HERO.png`),
**com a imagem ao lado de cada opção**. Copiar a escolhida para
`fotos/lp-nova/hero.jpg`, e a prancha para `fotos/lp-nova/prancha.png`
(de `Shared with Me/01. Desenvolvimento de Produtos/02. Aprovados/VESSEL CELINE/Vista Explodida.png`).

⚠️ **Conferir se a foto escolhida é JPEG CMYK com a marca Adobe** antes de usar:
canais == 4 no marcador SOF **e** segmento `FF EE` com a string `Adobe`. Se for,
ela aparece em NEGATIVO no navegador e o conserto é no ARQUIVO
(`ferramentas/cmyk-para-preto-e-branco.swift`), nunca em CSS.

- [ ] **Passo 2: montar os três blocos**

```html
<section class="heroi" id="topo">
  <img src="/fotos/lp-nova/hero.jpg" alt="">
  <div class="dentro">
    <h1 data-revela><span data-t="hero.titulo"></span></h1>
    <div class="caminhos">
      <button class="botao" data-caminho="visita"   data-t="hero.visitar"></button>
      <button class="botao vazado" data-caminho="ecommerce" data-t="hero.comprar"></button>
    </div>
  </div>
</section>

<section class="faixa clara" id="autoria">
  <div class="dentro duas">
    <div>
      <h2 data-revela><span data-t="autoria.titulo"></span></h2>
      <p class="apoio" data-t="autoria.apoio"></p>
    </div>
    <!-- A PRANCHA PROVA a frase em vez de ilustrá-la: 16 componentes com
         código, dimensão e material, e o carimbo DESENVOLVIDO POR VESSEL. -->
    <figure data-revela><img src="/fotos/lp-nova/prancha.png" alt="Vista explodida de um modelo Vessel, com os 16 componentes" loading="lazy"></figure>
  </div>
</section>

<section class="faixa escura" id="atelie">
  <div class="dentro duas">
    <!-- ⚠️ `playsinline` é obrigatório: sem ele o iPhone abre o vídeo em tela
         cheia sozinho e engole a página. `muted` é o que permite tocar só. -->
    <video data-revela
           src="/fotos/lp-nova/atelie.mp4"
           poster="/fotos/lp-nova/atelie-capa.jpg"
           autoplay muted loop playsinline preload="metadata"></video>
    <div>
      <h2 data-revela><span data-t="atelie.titulo"></span></h2>
      <p class="apoio" data-t="atelie.apoio"></p>
    </div>
  </div>
</section>
```

- [ ] **Passo 3: o CSS dos três**

```css
.heroi{position:relative;min-height:100svh;display:grid;place-items:center}
.heroi img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.heroi .dentro{position:relative;text-align:center;padding:0 24px}

/* ⚠️ O VÍDEO É 576×1024 (resolução de WhatsApp). Esticado na largura de um
   monitor fica mole, por isso no computador ele é PAINEL EM PÉ, no tamanho que
   a imagem aguenta. No celular ocupa a coluna inteira, e ali fica ótimo. */
#atelie video{width:100%;max-width:420px;aspect-ratio:9/16;object-fit:cover;display:block}

/* Gutter de 24px em toda largura; nenhuma linha do corpo rola na horizontal. */
.dentro{max-width:1160px;margin:0 auto;padding-inline:24px}
.duas{display:grid;gap:48px}
@media (min-width:900px){ .duas{grid-template-columns:1fr 1fr;align-items:center} }
```

- [ ] **Passo 4: provar no navegador, com régua**

Subir em porta própria (há mais de uma janela neste repositório):
`npx vite --port 5199 --strictPort` — ou servir a pasta com
`npx serve -l 5199`. Conferir com `getBoundingClientRect` a 375px que nada
ultrapassa a largura da tela. ⚠️ **Foto de tela mente** — ela renderiza num
viewport largo e reduz.

- [ ] **Passo 5: commit**

```bash
git add universovessel-novo/index.html universovessel-novo/estilo.css fotos/lp-nova/hero.jpg fotos/lp-nova/prancha.png
git commit -m "Os tres primeiros blocos: o impacto, a autoria e o atelie"
```

---

## Task 11: os blocos 4, 5, 6 e 7

**Arquivos:**
- Modificar: `universovessel-novo/index.html`, `estilo.css`

**Interfaces:**
- Consome: as mesmas da Task 10.

- [ ] **Passo 1: identificar os modelos do ensaio e levar ao dono**

Percorrer `17. Marketing/ENSAIOS/07.09 - DIREÇÃO GIULIANO` olhando as imagens,
casar cada bolsa com o catálogo em `fotos/selo/<modelo>-<tamanho>-<cor>/`, e
levar ao dono os 4 modelos que mais aparecem, **com a foto ao lado**. Ele
escolhe 3 ou 4.

- [ ] **Passo 2: descobrir o endereço de cada modelo na loja**

```bash
curl -s "https://y3m93e2yvszg.vesselbrasil.com.br/products.json?limit=250" \
  | python3 -c "import sys,json;[print(p['handle'],'|',p['title']) for p in json.load(sys.stdin)['products']]"
```
Se cada modelo escolhido tiver um endereço próprio, o "Descobrir" aponta para
ele. Se não, aponta para a coleção inteira. **Medir, não supor.**

- [ ] **Passo 3: montar os quatro blocos**

Os blocos 4 a 7 seguem a mesma forma do bloco 2 (Task 10, passo 2): `<section>`
com `.dentro`, título em `data-revela`, apoio em `data-t`, imagem em `<figure
data-revela>`. O que muda é o conteúdo:

| bloco | id | título | imagem | ação |
|---|---|---|---|---|
| 4 · desejo | `desejo` | `desejo.titulo` | 3–4 fotos do ensaio, uma por modelo | `desejo.descobrir` → endereço do passo 2 |
| 5 · identidade | `identidade` | `identidade.titulo` | um cartão EAN de `fotos/cartao/` + a etiqueta | link para um `/verify/<código>` de demonstração |
| 6 · brasil | `brasil` | `brasil.titulo` | `atelie-capa.jpg`, o acabamento a martelo | nenhuma |
| 7 · fim | `fim` | `fim.titulo` | nenhuma | os dois `data-caminho`, iguais aos do hero |

⚠️ **No bloco 5, NUNCA usar o código de uma peça de cliente real** — a página do
selo mostra onde a peça foi comprada. Escolher um código de peça que não saiu:

```sql
-- Peça gravada que NINGUÉM registrou: sem registro não há cliente, nome,
-- WhatsApp nem local de compra para expor.
select p.codigo
  from public.vessel_pecas p
 where p.gravada_em is not null
   and not exists (select 1 from public.vessel_registros r where r.codigo = p.codigo)
 limit 5;
```

- [ ] **Passo 4: provar a 375px, com régua**

Como na Task 10, passo 4. ⚠️ Atenção ao bloco 4: três ou quatro fotos lado a
lado só cabem acima de 1160px. Medir, e não deduzir por "parece que cabe" — já
houve erro de conta por ignorar que o `padding-left` do separador conta na
largura útil.

- [ ] **Passo 5: commit**

```bash
git add universovessel-novo/index.html universovessel-novo/estilo.css fotos/lp-nova/
git commit -m "Os objetos de desejo, a identidade da peca, o Brasil e o fechamento"
```

---

## Task 12: o convite, os dois cartões e o Chatwoot

**Arquivos:**
- Modificar: `universovessel-novo/index.html`, `pagina.mjs`, `estilo.css`
- Criar: `universovessel-novo/convite.test.mjs`

**Interfaces:**
- Consome: `vessel_entrar_na_lista` (Task 2), `vessel_marcar_objetivo` (Task 3),
  `/regras-da-lista.mjs` (já existe).

**A regra que atravessa a página:** quem **já se cadastrou** vai direto ao
destino. Quem **ainda não** abre o convite primeiro e cai nos dois cartões ao
terminar. Sem isso, o botão do topo é um furo na captação.

- [ ] **Passo 1: escrever o teste que falha**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { decidirCaminho } from './pagina.mjs'

test('quem ainda não se cadastrou passa pelo convite', () => {
  assert.deepEqual(decidirCaminho('ecommerce', { senha: null }),
    { acao: 'abrir-convite', depois: 'ecommerce' })
})

test('⚠️ quem JÁ se cadastrou não é barrado de novo', () => {
  // Barrar duas vezes é o jeito mais rápido de fazer a pessoa fechar a aba.
  assert.deepEqual(decidirCaminho('ecommerce', { senha: 'abc' }),
    { acao: 'ir', depois: 'ecommerce' })
})
```

- [ ] **Passo 2: rodar e ver falhar**

Executar: `node --test universovessel-novo/convite.test.mjs`
Esperado: FALHA — `decidirCaminho` não existe.

- [ ] **Passo 3: implementar o fluxo**

```js
const LOJA = 'https://vesselbrasil.com.br'   // a raiz desvia para a Shopify

export function decidirCaminho(destino, estado) {
  return estado.senha
    ? { acao: 'ir', depois: destino }
    : { acao: 'abrir-convite', depois: destino }
}

/** O cadastro. Devolve a senha de uso único, ou null se não gravou. */
async function cadastrar(dados) {
  const r = await fetch(`${SUPABASE}/rest/v1/rpc/vessel_entrar_na_lista`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      p_nome: dados.nome, p_email: dados.email, p_whatsapp: dados.whatsapp,
      p_aceite_versao: VERSAO_DO_ACEITE, p_armadilha: dados.empresa,
      // ⚠️ p_origem NÃO vai: 'pre-venda' é outro balde, e misturar faria a
      // contagem das unidades passar a contar quem só entrou na lista.
    }),
  })
  if (!r.ok) throw new Error('rpc ' + r.status)
  const resposta = await r.json()

  // ⚠️ DISPARO SEM ESPERA, e nunca direto para o Chatwoot: o segredo do robô
  // só pode viver no servidor, e o CORS dele só libera /api/*. Se o Chatwoot
  // cair, o cadastro NÃO se perde — o que importa é o Supabase.
  fetch('/api/lista-espera', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(dados),
  }).catch((e) => console.error('lista_espera -> chatwoot falhou', e))

  return resposta.senha ?? null
}

/** A segunda escrita: o que a pessoa escolheu. */
async function marcarObjetivo(senha, objetivo) {
  const r = await fetch(`${SUPABASE}/rest/v1/rpc/vessel_marcar_objetivo`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' },
    // ⚠️ A loja NÃO vai cravada daqui. O banco resolve o padrão; no dia em que
    // houver seletor, ele passa a mandar o valor e nada mais muda.
    body: JSON.stringify({ p_senha: senha, p_objetivo: objetivo }),
  })
  return r.ok ? r.json() : { ok: false }
}
```

⚠️ **O cartão TROCA DE CONTEÚDO, não fecha e abre outro.** No lugar do
formulário aparecem os dois caminhos, na mesma janela.

⚠️ **O botão de enviar nasce `disabled` no HTML** e é solto pelo próprio script:
sem isso, clique antes de o módulo carregar cai no envio nativo, a página
recarrega e o que a pessoa digitou se perde.

⚠️ **`overflow-x:hidden` no cartão.** `overflow-y:auto` faz o outro eixo virar
`auto` sozinho, e o campo-armadilha mora a 9999px à esquerda — com os dois eixos
roláveis o cartão nasce empurrado para fora da tela no celular de 375px.

- [ ] **Passo 4: rodar e ver passar**

Executar: `node --test universovessel-novo/convite.test.mjs`
Esperado: 2 testes passando.

- [ ] **Passo 5: commit**

```bash
git add universovessel-novo/pagina.mjs universovessel-novo/index.html universovessel-novo/estilo.css universovessel-novo/convite.test.mjs
git commit -m "O convite vira a porta: cadastra, e so entao mostra os dois caminhos"
```

---

## Task 13: os desvios — a raiz passa a ser a loja

**Arquivos:**
- Modificar: `vercel.json`, `vercel-json.test.mjs`

⚠️ **Esta é a tarefa que protege 157 etiquetas NFC.** O domínio **fica na
Vercel**; só a raiz desvia. Apontar o DNS do apex para a Shopify tiraria do ar
`/verify`, `/termos` e `/privacidade` — e dentro de cada uma das 157 etiquetas
já gravadas está `https://vesselbrasil.com.br/verify/<código>`. Etiqueta dentro
de bolsa vendida não se regrava.

- [ ] **Passo 1: escrever o teste que falha**

```js
// O arquivo é lido UMA vez, fora dos testes: dentro do primeiro, `cfg` não
// existiria para o segundo, e o segundo quebraria por ReferenceError — não
// por defeito de configuração, que é o que ele deveria denunciar.
const cfg = JSON.parse(readFileSync('./vercel.json', 'utf8'))

test('⚠️ a RAIZ desvia para a loja, e o /verify continua de pé', () => {
  const raiz = cfg.redirects.find((r) => r.source === '/')
  assert.ok(/y3m93e2yvszg|myshopify/.test(raiz.destination),
    'a raiz tem de ir para a loja')
  assert.equal(raiz.permanent, false,
    'TEMPORÁRIO: este domínio já trocou de capa três vezes, e permanente fica '
    + 'gravado no navegador de quem visitou')
  assert.ok(!cfg.redirects.some((r) => r.source.startsWith('/verify')),
    'NENHUM desvio pode pegar o /verify: 157 etiquetas já gravadas apontam para lá')
})

test('⚠️ cada caminho tem as DUAS regras, com e sem a barra no fim', () => {
  const fontes = new Set(cfg.redirects.map((r) => r.source))
  for (const p of ['/prevenda', '/universovessel-novo'])
    if (fontes.has(p)) assert.ok(fontes.has(p + '/'),
      `${p} sem a versão com barra deixa metade das pessoas na página velha`)
})
```

- [ ] **Passo 2: rodar e ver falhar**

Executar: `node --test vercel-json.test.mjs`

- [ ] **Passo 3: mudar o `vercel.json`**

⚠️ **`vercel.json` não aceita comentário** — o porquê fica no teste e no commit.

```json
{
  "redirects": [
    { "source": "/",  "destination": "https://y3m93e2yvszg.vesselbrasil.com.br", "permanent": false },
    { "source": "/prevenda",  "destination": "/universovessel", "permanent": false },
    { "source": "/prevenda/", "destination": "/universovessel", "permanent": false }
  ]
}
```

- [ ] **Passo 4: rodar e ver passar**

Executar: `npm test`
Esperado: tudo passando.

- [ ] **Passo 5: commit**

```bash
git add vercel.json vercel-json.test.mjs
git commit -m "A raiz passa a ser a loja — sem tirar o /verify do ar"
```

---

## Task 14: as provas finais, e a virada

**Arquivos:** nenhum novo.

- [ ] **Passo 1: a suíte inteira, nos dois repositórios**

```bash
cd /Users/erickmartins/iamundi/vessel-brasil/arvores/lp-nova && npm test
cd /Users/erickmartins/iamundi/arvores/lp-nova-banco && npm test
```
⚠️ **Conferir o TOTAL, não só o "0 falhas".** Suíte que encolhe em silêncio já
escondeu teste apagado; o número tem de fechar na conta.

- [ ] **Passo 2: publicar a página de teste**

```bash
cd /Users/erickmartins/iamundi/vessel-brasil/arvores/lp-nova
./ferramentas/publicar.sh
```
⚠️ Publica de uma cópia **sem o `.git`**: a Vercel no plano Hobby bloqueia
deploy de repositório privado de organização, e a mensagem dela **mente** sobre
a causa (diz que é o e-mail do autor; o motivo real é `githubCommitOrg`).

- [ ] **Passo 3: o caminho inteiro, no ar**

1. Abrir `vesselbrasil.com.br/universovessel-novo` no celular.
2. Cadastrar-se pelo formulário (porta pública — atalho pelo banco provaria o
   caminho errado).
3. Escolher "visitar uma loja".
4. Conferir no banco:
   ```sql
   select nome, objetivo, loja, senha_hash from public.vessel_lista_espera
    where email = '<o e-mail do teste>';
   ```
   Esperado: `objetivo=visita`, `loja=iguatemi`, `senha_hash` **nula** (uso único).
5. Conferir que a linha chegou ao Chatwoot e ao CSV do Zoho.
6. **Apagar a linha de teste do banco e da planilha.**

- [ ] **Passo 4: as medidas**

- Régua a 375px, e também em 768, 1024, 1160 e 1920.
- `/verify/<código>` continua devolvendo 200 com as fotos.
- `/termos` e `/privacidade` continuam de pé.
- Vídeo: toca mudo e em repetição; com movimento reduzido, fica a capa.
- Trocar para inglês, recarregar, e conferir que o idioma ficou.

- [ ] **Passo 5: levar ao dono**

Fotos de tela do celular e do computador, nos dois idiomas, com o nome no padrão
`lp-nova_tela-<onde>_<AAAA-MM-DD>_<HHMM>_v<N>.png`, na pasta de entregas **e** na
mesa.

- [ ] **Passo 6: a virada — só depois do sim dele**

1. Confirmar com o dono o destino de `/prevenda` (continua na LP ou segue a raiz
   para a loja?).
2. Mover o conteúdo de `universovessel-novo/` para `universovessel/`.
3. **Tirar o `<meta name="robots" content="noindex">`.**
4. Tirar `universovessel-novo` do `SAO_SITE`.
5. `npm test`, publicar, e conferir no domínio real.

---

## Autorrevisão do plano

**Cobertura do desenho:** os sete blocos (Tasks 10 e 11), o convite e os dois
caminhos (12), o banco com as duas colunas e a senha (1–3), o espelho (4), o
Chatwoot (12), o vídeo (8), os dois idiomas (6 e 7), o domínio e as 157
etiquetas (13), as provas (14). **Sem lacuna.**

**Consistência de nomes:** `vessel_marcar_objetivo(p_senha, p_objetivo, p_loja)`
é a mesma na Task 3 (definição), na 12 (chamada) e na 14 (prova).
`idiomaInicial`, `aplicarIdioma`, `ligarRevelacao` e `decidirCaminho` aparecem
com a mesma grafia onde são criadas e onde são usadas.

**Duas escolhas do dono ainda em aberto** — a foto do hero (Task 10, passo 1) e
os modelos do bloco 4 (Task 11, passo 1). Nenhuma impede começar: as tarefas
1 a 9 não dependem delas.
