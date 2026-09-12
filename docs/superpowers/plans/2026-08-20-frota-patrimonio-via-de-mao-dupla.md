# Via de mão dupla Frota ↔ Patrimônio · Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cadastrar um carro em qualquer uma das duas ferramentas passa a criar e amarrar a ficha do outro lado sozinho, acabando com o segundo cadastro à mão.

**Architecture:** Uma função no banco (`sincronizar_carro_e_bem`) serve as duas direções: acha o carro pela placa e o bem pela etiqueta, cria o que faltar, amarra `frota_veiculos.bem_id` e devolve um código do que fez. As telas continuam gravando o que já gravam; elas só chamam a função depois, e a frase que aparece pra pessoa é montada em JS a partir do código devolvido — assim a frase é testável sem banco. Um índice único fecha o buraco de dois carros no mesmo bem.

**Tech Stack:** Vue 3 (Options-free, `<script setup>`), Supabase (Postgres + RLS + PostgREST), testes em `node:test` com `.test.mjs`, migrations SQL aplicadas pelo MCP do Supabase.

**Spec:** `docs/superpowers/specs/2026-08-20-frota-patrimonio-via-de-mao-dupla-design.md`

## Global Constraints

- **Português de leigo em tudo que a pessoa lê.** Sem jargão, sem "erro 23505", sem nome de tabela na tela. As mensagens de `raise exception` também são lidas por gente — elas viram texto de tela.
- **Nunca mexer em dado real pra testar.** Nada de semear, limpar ou apagar. Prova de trava se faz dentro de `begin … rollback`.
- **Ícone é SVG, nunca emoji.**
- **Migration nova entra pelo MCP do Supabase** (`apply_migration`), e o arquivo também é commitado em `db/migrations/acessos/`.
- **Toda migration é comentada em português explicando o PORQUÊ**, no estilo de `047_frota_reserva_arquivar.sql`.
- **Nada de `git add <pasta>`** — sempre arquivo a arquivo.
- **`npm test` roda `node --test 'src/**/*.test.mjs' …`.** Teste verde não prova tela: `node --test` não compila `.vue`.
- **Valores medidos em 20/08/2026** que o código pode assumir: categoria "Veículos" = `bb8ae418-68c3-4d73-8a0e-4cf9e17c6e77`; teto da numeração = **400**; próxima etiqueta livre = **5**; 362 bens, 353 com número; 11 carros; `placa` e `numero` são UNIQUE; `bem_id` **não** é único (0 duplicatas hoje).

---

## Mapa dos arquivos

| Arquivo | Responsabilidade |
|---|---|
| `db/migrations/acessos/048_frota_bem_id_unico.sql` | **Criar.** A trava: um bem, um carro. |
| `db/migrations/acessos/049_sincronizar_carro_e_bem.sql` | **Criar.** As duas funções: a que costura e a que diz o próximo número livre. |
| `src/ferramentas/frota/etiqueta-do-veiculo.js` | **Criar.** Regras puras: normalizar placa, validar etiqueta, montar a frase do que aconteceu. |
| `src/ferramentas/frota/etiqueta-do-veiculo.test.mjs` | **Criar.** Testes das regras acima. |
| `src/ferramentas/frota/bens-para-veiculo.js` | **Modificar.** Matar a sugestão errada de `000291`. |
| `src/ferramentas/frota/tela-de-frota.vue` | **Modificar.** Campo "Nº de patrimônio" + chamada da função ao salvar. |
| `src/ferramentas/patrimonio/ligacao-com-frota.js` | **Modificar.** A regra "categoria Veículos exige placa". |
| `src/ferramentas/patrimonio/tela-de-patrimonio.vue` | **Modificar.** Campo "Placa" + chamada da função ao salvar. |
| `src/ferramentas/frota/LEIA-ME.txt` | **Criar.** A pasta é a única de ferramenta sem LEIA-ME. |
| `docs/pendencias.md` | **Modificar.** Entra a tarefa das 9 etiquetas físicas. |

---

### Task 1: A trava — um bem, um carro

**Files:**
- Create: `db/migrations/acessos/048_frota_bem_id_unico.sql`

**Interfaces:**
- Consumes: nada.
- Produces: índice `uq_frota_veiculos_bem_id`. As tarefas 2 e 5 contam com ele pra que o conflito "bem já usado" seja recusado pelo banco, e não só pelo `if` da função.

- [ ] **Step 1: Provar que hoje o banco aceita a duplicata** (dentro de `rollback`, sem deixar rastro)

Rodar pelo MCP (`execute_sql`):

```sql
begin;
  -- Pega dois carros e força os dois no MESMO bem. Se o banco aceitar, o buraco existe.
  update public.frota_veiculos set bem_id = (
    select bem_id from public.frota_veiculos where bem_id is not null order by placa limit 1
  ) where placa in (
    select placa from public.frota_veiculos where bem_id is not null order by placa limit 2
  );
  select count(*) as carros_no_mesmo_bem
    from (select bem_id from public.frota_veiculos
           where bem_id is not null group by bem_id having count(*) > 1) t;
rollback;
```

Esperado: `carros_no_mesmo_bem = 1` — ou seja, **o banco deixou**. É a prova de que a trava não existe.

⚠️ O `rollback` é obrigatório: sem ele isso reescreve a ligação de dois carros reais.

- [ ] **Step 2: Conferir que não há duplicata pra limpar antes**

```sql
select bem_id, count(*) from public.frota_veiculos
 where bem_id is not null group by bem_id having count(*) > 1;
```

Esperado: **zero linhas.** Se vier alguma, PARE e mostre ao dono — criar índice único sobre dado sujo falha, e escolher qual ligação morre é decisão dele, não sua.

- [ ] **Step 3: Escrever a migration**

```sql
-- Frota: um bem do Patrimônio pertence a UM veículo, e o banco passa a garantir.
--
-- Desenho: docs/superpowers/specs/2026-08-20-frota-patrimonio-via-de-mao-dupla-design.md
--
-- POR QUE AGORA. A partir desta leva, criar carro passa a criar bem sozinho
-- (049). Automatizar em cima de um vínculo que o banco não protege é multiplicar
-- o defeito: hoje é preciso alguém errar na tela pra duplicar; depois bastaria
-- uma chamada repetida.
--
-- O BURACO, medido em 20/08/2026: `frota_veiculos.bem_id` tinha FK, mas não
-- tinha unicidade. Os dois lados evitavam a colisão por gentileza no código
-- (`veiculosParaLigar`, `bensLivresParaFrota` filtram os já usados) — e
-- gentileza de tela não é trava: qualquer escrita que não passe pela tela
-- (SQL na mão, robô, PostgREST direto) passava reto. Provado com um update
-- dentro de `rollback`: o banco aceitou dois carros no mesmo bem.
--
-- Duplicatas existentes na hora de criar: ZERO. Está limpo — é a hora certa.
--
-- PARCIAL, e o `where` é o ponto todo: carro sem bem é caso NORMAL (o KWID de
-- 20/08 é um). Índice único cheio trataria cada `bem_id` nulo como valor
-- repetido? Não — em Postgres nulo não colide com nulo, então até um índice
-- cheio funcionaria. O `where` está aqui por outro motivo: não indexar as
-- linhas nulas, que não são consultadas por este caminho.
--
-- SEM `grant` aqui, de propósito. Índice não tem ACL, e a regra decorada
-- ("coluna nova precisa de grant") é do `accounts`, onde o SELECT é concedido
-- coluna a coluna. Aqui não há coluna nova.

create unique index if not exists uq_frota_veiculos_bem_id
  on public.frota_veiculos (bem_id)
  where bem_id is not null;

comment on index public.uq_frota_veiculos_bem_id is
  'Um bem do Patrimônio pertence a um veículo só. Parcial: carro sem bem é normal.';
```

- [ ] **Step 4: Aplicar pelo MCP**

Usar `apply_migration` com `name: "048_frota_bem_id_unico"` e o conteúdo acima.

- [ ] **Step 5: Provar que a trava RECUSA agora**

Repetir exatamente o SQL do Step 1.

Esperado: o `update` **falha** com `duplicate key value violates unique constraint "uq_frota_veiculos_bem_id"`, e o `rollback` desfaz. Trava que não foi vista recusando não está provada.

- [ ] **Step 6: Commit**

```bash
git add db/migrations/acessos/048_frota_bem_id_unico.sql
git commit -m "fix(frota): um bem do Patrimônio passa a pertencer a um carro só

O vínculo bem<->carro tinha FK mas não tinha unicidade: provado com um
update dentro de rollback, o banco aceitava dois carros no mesmo bem. Os
dois lados evitavam por gentileza no código, e gentileza de tela não é
trava — qualquer escrita fora da tela passava reto.

Fecha agora porque a 049 passa a criar bem sozinho, e automatizar em cima
de um vínculo desprotegido multiplica o defeito.

Duplicatas na hora de criar: zero.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: As duas funções no banco

**Files:**
- Create: `db/migrations/acessos/049_sincronizar_carro_e_bem.sql`

**Interfaces:**
- Consumes: `uq_frota_veiculos_bem_id` (Task 1).
- Produces, e as tarefas 4 e 5 chamam exatamente assim:
  - `sincronizar_carro_e_bem(p_carro_id uuid, p_bem_id uuid, p_placa text, p_etiqueta int, p_nome text, p_marca text, p_valor_centavos bigint) → jsonb` com as chaves `carro_id`, `bem_id`, `placa`, `etiqueta`, `fez`. `fez` é um de: `'criou_os_dois'`, `'criou_carro'`, `'criou_bem'`, `'ligou'`, `'ja_ligados'`.
  - `proxima_etiqueta_livre() → int` (ou `null` se a numeração estiver cheia).

- [ ] **Step 1: Escrever a migration**

```sql
-- Frota ↔ Patrimônio: cadastrar de um lado passa a criar e amarrar o outro.
--
-- Desenho: docs/superpowers/specs/2026-08-20-frota-patrimonio-via-de-mao-dupla-design.md
--
-- O PEDIDO DO DONO (20/08/2026): "o cadastro de bens de carros está
-- necessitando duas mão de obra. Se eu cadastro o carro pelo patrimônio já é
-- para aparecer em frota, e se eu cadastro em frota primeiro já é pra ir pra
-- patrimônio."
--
-- O CASO REAL que provocou: dois KWIDs cadastrados no mesmo dia. Bem nº 291 às
-- 09:53 pelo Patrimônio (sem carro) e carro RVU6B06 às 11:11 pela Frota (sem
-- bem). Mesmo carro, duas fichas, nenhuma sabia da outra.
--
-- ── POR QUE UMA FUNÇÃO, E NÃO DOIS INSERTS NA TELA ──────────────────────────
--
-- Os portões de permissão são DIFERENTES: `is_frota_admin()` (feature 'frota'
-- ou superadmin) e `is_patrimonio_admin()` (role admin ou feature
-- 'patrimonio'). Medido em 20/08 sobre 22 pessoas: 5 têm SÓ Frota e 2 têm SÓ
-- Patrimônio. Pra essas 7, o insert do outro lado bateria na RLS e falharia —
-- e a mão de obra dobrada voltaria justamente pra quem menos pode resolver.
--
-- Esta função tem poder próprio, mas NÃO é uma porta dos fundos pro Patrimônio:
-- ela só sabe fazer uma coisa — criar bem da categoria Veículos amarrado àquele
-- carro. Não cria cadeira, não lê os outros 362 bens, não edita o que já existe.
-- Quem só tem Frota continua sem enxergar o Patrimônio.
--
-- ── O QUE ELA RECUSA, E POR QUÊ ─────────────────────────────────────────────
--
-- Se a placa aponta pro carro A, a etiqueta aponta pro bem B, e A já está preso
-- ao bem C, ela PARA e explica. Religar ficha errada é pior que não ligar:
-- some prova sem ninguém saber. Quem desfaz ligação antiga é gente, na tela.
--
-- ── proxima_etiqueta_livre(), e por que ela existe ──────────────────────────
--
-- A conta do próximo número livre já existe em JS (`mapaDeNumeros`, em
-- numeros-de-etiqueta.js), mas ela precisa de DUAS coisas que a Frota não
-- alcança: a lista de bens e o teto. E `patrimonio_config` tem RLS
-- `is_patrimonio_admin()` — medido: as 5 pessoas só-Frota NÃO conseguem ler o
-- teto. Fazer a conta na tela da Frota daria número errado pra elas, em
-- silêncio. Então a conta desce pro banco, onde a resposta é a mesma pra todos.
--
-- Ela devolve o primeiro BURACO, não o maior+1 — em 20/08 isso é 5, e não 381.
-- É de propósito: etiqueta é adesivo físico, e queimar número é desperdício.
-- É a mesma regra que o Patrimônio já usa; a tela é que precisa DIZER o número,
-- pra ninguém achar que veio do nada.
--
-- ── GRANTS ──────────────────────────────────────────────────────────────────
--
-- `revoke from public, anon` explícito nas duas. Função SECURITY DEFINER nasce
-- executável por todo mundo, inclusive anônimo — e uma que cria linha em duas
-- tabelas não pode ficar assim.

-- ── 1. O próximo número livre ───────────────────────────────────────────────
create or replace function public.proxima_etiqueta_livre()
returns int
language sql stable security definer set search_path = public as $$
  select min(n)::int
    from generate_series(
           1,
           coalesce((select nullif(btrim(valor), '')::int
                       from public.patrimonio_config where chave = 'numero_maximo'),
                    400)
         ) as n
   where not exists (select 1 from public.patrimonio_bens b where b.numero = n);
$$;

comment on function public.proxima_etiqueta_livre() is
  'O primeiro número de etiqueta ainda livre (o primeiro BURACO, não o maior+1). '
  'Nulo quando a numeração está cheia. Existe no banco porque patrimonio_config '
  'não é legível por quem só tem a Frota.';

revoke all on function public.proxima_etiqueta_livre() from public, anon;
grant execute on function public.proxima_etiqueta_livre() to authenticated;

-- ── 2. A costura ────────────────────────────────────────────────────────────
create or replace function public.sincronizar_carro_e_bem(
  p_carro_id       uuid   default null,
  p_bem_id         uuid   default null,
  p_placa          text   default null,
  p_etiqueta       int    default null,
  p_nome           text   default null,
  p_marca          text   default null,
  p_valor_centavos bigint default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_carro       public.frota_veiculos%rowtype;
  v_bem         public.patrimonio_bens%rowtype;
  v_cat         uuid;
  v_placa       text;
  v_outro       uuid;
  v_criou_carro boolean := false;
  v_criou_bem   boolean := false;
  v_fez         text;
begin
  if not (public.is_frota_admin() or public.is_patrimonio_admin()) then
    raise exception 'Você não pode cadastrar veículo nem bem. Peça a quem administra.'
      using errcode = 'check_violation';
  end if;

  -- Mesma normalização que a tela da Frota já faz ao gravar (salvarVeiculo):
  -- sem ela, "ABC-1D23" e "abc1d23" viram dois carros diferentes.
  v_placa := nullif(upper(regexp_replace(coalesce(p_placa, ''), '[^A-Za-z0-9]', '', 'g')), '');

  -- ── O CARRO: acha, ou cria ──
  if p_carro_id is not null then
    select * into v_carro from public.frota_veiculos where id = p_carro_id;
    if not found then
      raise exception 'O veículo informado não existe mais. Recarregue a tela.'
        using errcode = 'check_violation';
    end if;
  elsif v_placa is not null then
    select * into v_carro from public.frota_veiculos where placa = v_placa;
    if not found then
      if coalesce(btrim(p_nome), '') = '' then
        raise exception 'Pra criar o veículo eu preciso do nome dele.'
          using errcode = 'check_violation';
      end if;
      insert into public.frota_veiculos (placa, nome, marca, fipe_centavos, situacao)
      values (v_placa, btrim(p_nome),
              nullif(btrim(coalesce(p_marca, '')), ''),
              p_valor_centavos, 'ativo')
      returning * into v_carro;
      v_criou_carro := true;
    end if;
  else
    raise exception 'Preciso da placa pra achar ou criar o veículo.'
      using errcode = 'check_violation';
  end if;

  -- ── O BEM: acha, ou cria ──
  if p_bem_id is not null then
    select * into v_bem from public.patrimonio_bens where id = p_bem_id;
    if not found then
      raise exception 'O bem informado não existe mais. Recarregue a tela.'
        using errcode = 'check_violation';
    end if;
  elsif p_etiqueta is not null then
    select * into v_bem from public.patrimonio_bens where numero = p_etiqueta;
    if not found then
      -- Mesmo critério tolerante a acento que os dois lados já usam pra achar
      -- a categoria. Sem ela identificada, NÃO cria bem sem categoria: bem solto
      -- não aparece em relatório nenhum e vira item fantasma.
      select id into v_cat from public.patrimonio_categorias
       where nome ilike '%ve%cul%' order by nome limit 1;
      if v_cat is null then
        raise exception 'Não achei a categoria "Veículos" no Patrimônio. Crie a categoria antes.'
          using errcode = 'check_violation';
      end if;
      insert into public.patrimonio_bens (nome, numero, marca, valor_centavos, categoria_id)
      values (coalesce(nullif(btrim(coalesce(p_nome, '')), ''), v_carro.nome),
              p_etiqueta,
              nullif(btrim(coalesce(p_marca, '')), ''),
              p_valor_centavos, v_cat)
      returning * into v_bem;
      v_criou_bem := true;
    end if;
  else
    raise exception 'Preciso do nº de patrimônio pra achar ou criar o bem.'
      using errcode = 'check_violation';
  end if;

  -- ── O CONFLITO: para e explica, nunca rewira calada ──
  if v_carro.bem_id is not null and v_carro.bem_id <> v_bem.id then
    raise exception
      'O veículo % já está ligado a outro item do Patrimônio. Desfaça a ligação antiga primeiro.',
      v_carro.placa using errcode = 'check_violation';
  end if;

  select id into v_outro from public.frota_veiculos
   where bem_id = v_bem.id and id <> v_carro.id limit 1;
  if v_outro is not null then
    raise exception
      'O nº de patrimônio % já pertence a outro veículo da Frota. Desfaça a ligação antiga primeiro.',
      v_bem.numero using errcode = 'check_violation';
  end if;

  -- ── AMARRA ──
  if v_carro.bem_id is null then
    update public.frota_veiculos
       set bem_id = v_bem.id, atualizado_em = now()
     where id = v_carro.id;
    v_fez := 'ligou';
  else
    v_fez := 'ja_ligados';
  end if;

  if v_criou_carro and v_criou_bem then v_fez := 'criou_os_dois';
  elsif v_criou_carro then v_fez := 'criou_carro';
  elsif v_criou_bem then v_fez := 'criou_bem';
  end if;

  return jsonb_build_object(
    'carro_id', v_carro.id,
    'bem_id',   v_bem.id,
    'placa',    v_carro.placa,
    'etiqueta', v_bem.numero,
    'fez',      v_fez);
end;
$$;

comment on function public.sincronizar_carro_e_bem(uuid,uuid,text,int,text,text,bigint) is
  'Costura carro e bem nas duas direções: acha pela placa e pela etiqueta, cria o '
  'que faltar, amarra frota_veiculos.bem_id. Recusa religar ficha que já tem par.';

revoke all on function public.sincronizar_carro_e_bem(uuid,uuid,text,int,text,text,bigint)
  from public, anon;
grant execute on function public.sincronizar_carro_e_bem(uuid,uuid,text,int,text,text,bigint)
  to authenticated;
```

- [ ] **Step 2: Aplicar pelo MCP**

`apply_migration` com `name: "049_sincronizar_carro_e_bem"`.

- [ ] **Step 3: Provar `proxima_etiqueta_livre()` rodando de verdade**

```sql
select public.proxima_etiqueta_livre() as proximo;
```

Esperado: **5**. Poder executar não é passar pelo `if` de dentro — o corpo tem que rodar e o número tem que bater com o que foi medido.

- [ ] **Step 4: Provar a costura inteira, dentro de `rollback`**

```sql
begin;
  -- (a) CRIA OS DOIS: placa e etiqueta que não existem.
  select public.sincronizar_carro_e_bem(
    p_placa => 'ZZZ9Z99', p_etiqueta => 399,
    p_nome => 'CARRO DE TESTE', p_marca => 'TESTE') as criou_os_dois;

  -- (b) LIGA O QUE JÁ EXISTE: o KWID real, o caso que motivou tudo.
  select public.sincronizar_carro_e_bem(
    p_placa => 'RVU6B06', p_etiqueta => 291) as ligou_o_kwid;

  -- (c) IDEMPOTENTE: repetir não duplica nem quebra.
  select public.sincronizar_carro_e_bem(
    p_placa => 'RVU6B06', p_etiqueta => 291) as ja_ligados;
rollback;
```

Esperado, em ordem: `fez = "criou_os_dois"`, `fez = "ligou"`, `fez = "ja_ligados"`.

- [ ] **Step 5: Provar que o conflito RECUSA, dentro de `rollback`**

```sql
begin;
  -- A placa do Volvo XC60 (já ligado ao bem dele) com a etiqueta do KWID.
  -- Dois pares diferentes brigando: tem que PARAR.
  select public.sincronizar_carro_e_bem(p_placa => 'BDN3A67', p_etiqueta => 291);
rollback;
```

Esperado: exceção com a frase **"O veículo BDN3A67 já está ligado a outro item do Patrimônio. Desfaça a ligação antiga primeiro."** Se passar, a função está religando ficha calada — PARE e conserte antes de seguir.

- [ ] **Step 6: Conferir que o `rollback` não deixou rastro**

```sql
select (select count(*) from public.frota_veiculos)  as carros,
       (select count(*) from public.patrimonio_bens) as bens,
       (select bem_id from public.frota_veiculos where placa = 'RVU6B06') as kwid_bem;
```

Esperado: **11 carros, 362 bens, `kwid_bem` nulo** — exatamente como antes das provas. Se algum número mudou, um `rollback` não pegou e há dado de teste no banco do dono.

- [ ] **Step 7: Commit**

```bash
git add db/migrations/acessos/049_sincronizar_carro_e_bem.sql
git commit -m "feat(frota): cadastrar de um lado passa a criar e amarrar o outro

Dois KWIDs no mesmo dia — bem 291 às 09:53 pelo Patrimônio, carro RVU6B06
às 11:11 pela Frota — e nenhuma ficha sabia da outra.

sincronizar_carro_e_bem() serve as duas direções: acha o carro pela placa,
o bem pela etiqueta, cria o que faltar e amarra. Recusa religar ficha que
já tem par: religar some prova sem ninguém saber.

Tem poder próprio porque os portões são diferentes e 7 pessoas têm só um
dos dois. Mas não é porta dos fundos: só cria bem da categoria Veículos
amarrado àquele carro.

proxima_etiqueta_livre() desce pro banco porque patrimonio_config tem RLS
de Patrimônio — a conta na tela da Frota daria número errado, em silêncio,
pras 5 pessoas só-Frota.

Provado rodando: criou_os_dois, ligou, ja_ligados e o conflito recusado,
tudo dentro de rollback, com as contagens conferidas depois.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: As regras puras em JS

**Files:**
- Create: `src/ferramentas/frota/etiqueta-do-veiculo.js`
- Test: `src/ferramentas/frota/etiqueta-do-veiculo.test.mjs`

**Interfaces:**
- Consumes: nada (módulo puro, sem Supabase e sem Vue).
- Produces, usado pelas tarefas 4 e 5:
  - `normalizarPlaca(texto) → string` (maiúscula, só letra e número, `''` quando vazio)
  - `validarEtiqueta(texto, { obrigatoria }) → { ok: boolean, numero: number|null, erro: string|null }`
  - `fraseDaSincronia(resposta) → string|null`

- [ ] **Step 1: Escrever o teste que falha**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizarPlaca, validarEtiqueta, fraseDaSincronia } from './etiqueta-do-veiculo.js'

test('normalizarPlaca: mesma regra que a tela já usa ao gravar', () => {
  // Sem isto, "ABC-1D23" e "abc1d23" viram DOIS carros — e placa é UNIQUE,
  // então o segundo cadastro falharia com erro de banco na cara da pessoa.
  assert.equal(normalizarPlaca('rvu-6b06'), 'RVU6B06')
  assert.equal(normalizarPlaca(' FFK 9E60 '), 'FFK9E60')
  assert.equal(normalizarPlaca(''), '')
  assert.equal(normalizarPlaca(null), '')
})

test('validarEtiqueta: só número, e o texto do erro é pra leigo', () => {
  assert.deepEqual(validarEtiqueta('291'), { ok: true, numero: 291, erro: null })
  assert.deepEqual(validarEtiqueta(' 5 '), { ok: true, numero: 5, erro: null })

  const r = validarEtiqueta('RBB-005')
  assert.equal(r.ok, false)
  assert.equal(r.numero, null)
  assert.equal(r.erro, 'O nº de patrimônio é só número. Ex.: 5')
})

test('validarEtiqueta: vazia passa quando não é obrigatória, e barra quando é', () => {
  // A Frota deixa criar carro sem etiqueta (os 9 antigos são assim); o campo
  // sugere, não obriga. Quem obriga é o Patrimônio, e só pela PLACA.
  assert.deepEqual(validarEtiqueta('', { obrigatoria: false }),
    { ok: true, numero: null, erro: null })

  const r = validarEtiqueta('', { obrigatoria: true })
  assert.equal(r.ok, false)
  assert.equal(r.erro, 'Informe o nº de patrimônio.')
})

test('validarEtiqueta: zero e negativo não são etiqueta', () => {
  // A numeração começa em 1. Um "0" digitado por engano viraria bem nº 0,
  // que nenhuma etiqueta impressa carrega.
  assert.equal(validarEtiqueta('0').ok, false)
  assert.equal(validarEtiqueta('-3').ok, false)
})

test('fraseDaSincronia: cada caso diz o que REALMENTE aconteceu', () => {
  // Nunca um "sincronizado!" genérico: a pessoa precisa saber se criou ficha
  // nova ou só amarrou o que já existia.
  const base = { placa: 'RVU6B06', etiqueta: 291 }

  assert.equal(fraseDaSincronia({ ...base, fez: 'criou_os_dois' }),
    'Criei o veículo RVU6B06 e o item nº 291 no Patrimônio, já ligados.')
  assert.equal(fraseDaSincronia({ ...base, fez: 'criou_bem' }),
    'Criei o item nº 291 no Patrimônio e liguei ao veículo RVU6B06.')
  assert.equal(fraseDaSincronia({ ...base, fez: 'criou_carro' }),
    'Criei o veículo RVU6B06 na Frota e liguei ao item nº 291 do Patrimônio.')
  assert.equal(fraseDaSincronia({ ...base, fez: 'ligou' }),
    'Liguei o veículo RVU6B06 ao item nº 291 do Patrimônio.')
  assert.equal(fraseDaSincronia({ ...base, fez: 'ja_ligados' }),
    'O veículo RVU6B06 e o item nº 291 já estavam ligados.')
})

test('fraseDaSincronia: resposta estranha não vira frase inventada', () => {
  // Se o banco devolver algo que esta versão não conhece, a tela fica CALADA
  // em vez de afirmar uma coisa que talvez não tenha acontecido.
  assert.equal(fraseDaSincronia(null), null)
  assert.equal(fraseDaSincronia({ fez: 'coisa_nova' }), null)
  assert.equal(fraseDaSincronia({ fez: 'ligou' }), null) // sem placa/etiqueta
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx node --test src/ferramentas/frota/etiqueta-do-veiculo.test.mjs`
Expected: FAIL — `Cannot find module './etiqueta-do-veiculo.js'`

- [ ] **Step 3: Escrever o módulo**

```js
/* O nº de patrimônio na Frota, e a frase do que a sincronia fez (20/08/2026).
 *
 * Desenho: docs/superpowers/specs/2026-08-20-frota-patrimonio-via-de-mao-dupla-design.md
 *
 * Separado da tela por ser regra pura. E a frase mora AQUI, e não no banco, por
 * um motivo prático: frase em SQL não se testa sem subir Postgres. O banco
 * devolve um código (`fez`), este arquivo vira português, e o português fica
 * travado em teste. */

/** A placa do jeito que o banco guarda: maiúscula, só letra e número.
 *  É a mesma conta que `salvarVeiculo` já fazia inline — agora com dono, porque
 *  o Patrimônio passou a precisar dela também. Placa é UNIQUE: normalizar
 *  diferente nos dois lados criaria carro duplicado por causa de um hífen. */
export function normalizarPlaca(texto) {
  return String(texto || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/**
 * O nº de patrimônio digitado vira número — ou vira um erro em português.
 *
 * Vazio passa quando `obrigatoria` é falso: a Frota deixa cadastrar carro sem
 * etiqueta, que é a situação real de 9 dos 11 carros. O campo SUGERE.
 */
export function validarEtiqueta(texto, { obrigatoria = false } = {}) {
  const cru = String(texto ?? '').trim()
  if (!cru) {
    return obrigatoria
      ? { ok: false, numero: null, erro: 'Informe o nº de patrimônio.' }
      : { ok: true, numero: null, erro: null }
  }
  if (!/^\d+$/.test(cru)) {
    return { ok: false, numero: null, erro: 'O nº de patrimônio é só número. Ex.: 5' }
  }
  const n = parseInt(cru, 10)
  // A numeração começa em 1. "0" digitado por engano viraria um bem nº 0, que
  // nenhuma etiqueta impressa carrega.
  if (!(n >= 1)) {
    return { ok: false, numero: null, erro: 'O nº de patrimônio começa em 1.' }
  }
  return { ok: true, numero: n, erro: null }
}

/* "Item" e não "bem" de propósito: é a palavra que a tela do Patrimônio usa
 * com quem cadastra. */
const FRASES = {
  criou_os_dois: (p, e) => `Criei o veículo ${p} e o item nº ${e} no Patrimônio, já ligados.`,
  criou_bem: (p, e) => `Criei o item nº ${e} no Patrimônio e liguei ao veículo ${p}.`,
  criou_carro: (p, e) => `Criei o veículo ${p} na Frota e liguei ao item nº ${e} do Patrimônio.`,
  ligou: (p, e) => `Liguei o veículo ${p} ao item nº ${e} do Patrimônio.`,
  ja_ligados: (p, e) => `O veículo ${p} e o item nº ${e} já estavam ligados.`,
}

/**
 * O que a pessoa lê depois de salvar. NUNCA um "sincronizado!" genérico: ela
 * precisa saber se nasceu ficha nova ou se só amarrou o que já existia — é a
 * diferença entre "criei um carro" e "achei o carro que você já tinha".
 *
 * Devolve `null` quando a resposta não dá pra afirmar nada (código
 * desconhecido, placa ou número faltando). Tela calada é melhor que tela
 * afirmando o que talvez não tenha acontecido.
 */
export function fraseDaSincronia(resposta) {
  const r = resposta || {}
  const monta = FRASES[r.fez]
  if (!monta) return null
  const placa = String(r.placa || '').trim()
  const etiqueta = r.etiqueta
  if (!placa || !Number.isInteger(etiqueta)) return null
  return monta(placa, etiqueta)
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx node --test src/ferramentas/frota/etiqueta-do-veiculo.test.mjs`
Expected: PASS, 6 testes.

- [ ] **Step 5: Rodar a suíte inteira**

Run: `npm test`
Expected: PASS. ⚠️ Anote o **total de testes**. Se num passo futuro o total ficar MENOR que este, é arquivo sumindo da suíte — nunca "flake".

- [ ] **Step 6: Commit**

```bash
git add src/ferramentas/frota/etiqueta-do-veiculo.js src/ferramentas/frota/etiqueta-do-veiculo.test.mjs
git commit -m "feat(frota): as regras do nº de patrimônio, testadas fora da tela

normalizarPlaca ganha dono: era conta inline do salvarVeiculo, e agora o
Patrimônio precisa da MESMA. Normalizar diferente nos dois lados criaria
carro duplicado por causa de um hífen — placa é UNIQUE.

A frase do que aconteceu mora em JS, não em SQL: frase em SQL não se testa
sem subir Postgres. O banco devolve o código, aqui vira português travado
em teste. E código desconhecido deixa a tela CALADA, em vez de afirmar o
que talvez não tenha acontecido.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: A Frota ganha o campo "Nº de patrimônio"

**Files:**
- Modify: `src/ferramentas/frota/bens-para-veiculo.js` (a função `patchDoBem`)
- Modify: `src/ferramentas/frota/bens-para-veiculo.test.mjs`
- Modify: `src/ferramentas/frota/tela-de-frota.vue`
- Create: `src/ferramentas/frota/LEIA-ME.txt`

**Interfaces:**
- Consumes: `normalizarPlaca`, `validarEtiqueta`, `fraseDaSincronia` (Task 3); `sincronizar_carro_e_bem`, `proxima_etiqueta_livre` (Task 2).
- Produces: nada que outra tarefa use.

- [ ] **Step 1: Ajustar o teste de `patchDoBem` pra exigir que a sugestão errada morra**

Em `src/ferramentas/frota/bens-para-veiculo.test.mjs`, trocar a asserção que hoje espera `codigo_patrimonial` por esta:

```js
test('patchDoBem: NÃO inventa código patrimonial', () => {
  // Até 20/08/2026 esta função escrevia `String(bem.numero).padStart(6,'0')` —
  // o bem 291 virava "000291" no campo de código. Formato que não batia com
  // NADA em uso: os 9 carros antigos usam "RBB-00X", e nenhuma tela mostra
  // seis dígitos. O nº de patrimônio agora tem campo próprio, ligado à
  // etiqueta de verdade; o código é texto interno antigo e ninguém o inventa.
  const vForm = { nome: '', marca: '', fipe: '', codigo_patrimonial: '' }
  const patch = patchDoBem(vForm, { nome: 'KWID', marca: 'RENAULT', numero: 291 })
  assert.equal('codigo_patrimonial' in patch, false)
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx node --test src/ferramentas/frota/bens-para-veiculo.test.mjs`
Expected: FAIL — `patch` ainda traz `codigo_patrimonial: '000291'`.

- [ ] **Step 3: Tirar a sugestão errada**

Em `src/ferramentas/frota/bens-para-veiculo.js`, apagar esta linha de `patchDoBem`:

```js
  if (!vForm.codigo_patrimonial && bem.numero) patch.codigo_patrimonial = String(bem.numero).padStart(6, '0');
```

E ajustar o comentário do bloco acima dela, acrescentando:

```js
 * NÃO sugere `codigo_patrimonial`: até 20/08/2026 sugeria seis dígitos
 * ("000291"), formato que não batia com os "RBB-00X" dos carros nem com
 * nenhuma tela. O nº de patrimônio tem campo próprio agora.
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx node --test src/ferramentas/frota/bens-para-veiculo.test.mjs`
Expected: PASS

- [ ] **Step 5: Importar as regras novas na tela**

Em `src/ferramentas/frota/tela-de-frota.vue`, junto dos outros imports da pasta (perto da linha 93):

```js
import { normalizarPlaca, validarEtiqueta, fraseDaSincronia } from './etiqueta-do-veiculo.js'
```

- [ ] **Step 6: Guardar o número livre e o campo do formulário**

Ainda em `tela-de-frota.vue`, perto de `const bensLivres = computed(...)` (linha ~2296):

```js
// O próximo nº de etiqueta livre, vindo do BANCO e não de conta na tela.
// `patrimonio_config` tem RLS de Patrimônio, e 5 pessoas só têm a Frota —
// a conta local daria número errado pra elas, em silêncio.
const proximaEtiqueta = ref(null)

async function carregarProximaEtiqueta() {
  const { data, error } = await sbClient.rpc('proxima_etiqueta_livre')
  // Falhou? Fica nulo, e a tela NÃO sugere número nenhum. Sugerir um chute
  // faria alguém colar um adesivo com número já usado.
  proximaEtiqueta.value = error ? null : (data ?? null)
}
```

Chamar `carregarProximaEtiqueta()` dentro de `carregar()`, junto das outras leituras.

E acrescentar `etiqueta` ao formulário — o `vForm` já é reativo; basta limpá-lo ao abrir. Em `abrirVeiculo(v)`, depois do laço `for (const c of CAMPOS_VEICULO)`:

```js
  // A etiqueta NÃO entra em CAMPOS_VEICULO: ela não é coluna de
  // `frota_veiculos`, é o número do bem do outro lado. Editar carro que já
  // existe não mexe nela — quem liga bem a carro pronto usa o seletor de bem.
  vForm.etiqueta = ''
```

- [ ] **Step 7: Desenhar o campo, só na criação**

No formulário de veículo, logo abaixo do campo de placa, acrescentar:

```html
<!-- NÚMERO DE PATRIMÔNIO (20/08/2026). Só ao CRIAR: num carro que já
     existe, o número é o do bem ligado, e mexer aqui religaria ficha. -->
<label class="fr-campo" v-if="veiculoAberto && veiculoAberto.novo">
  <span>Nº de patrimônio</span>
  <input v-model="vForm.etiqueta" type="text" inputmode="numeric"
         :placeholder="proximaEtiqueta ? `Ex.: ${proximaEtiqueta}` : 'Ex.: 5'">
  <small class="fr-dica" v-if="proximaEtiqueta">
    Próximo livre: <strong>{{ proximaEtiqueta }}</strong>. É o número da
    etiqueta que vai colada no carro — o mesmo do Patrimônio.
  </small>
  <small class="fr-dica" v-else>
    É o número da etiqueta que vai colada no carro, o mesmo do Patrimônio.
    Não consegui conferir qual é o próximo livre agora.
  </small>
</label>
```

⚠️ O ramo `v-else` importa: sem ele, uma leitura que falhou viraria uma tela sem dica nenhuma, e a pessoa não saberia se é porque não há número ou porque não deu pra conferir.

- [ ] **Step 8: Ligar o Salvar na função do banco**

Em `salvarVeiculo()`, trocar a linha da placa por:

```js
  dados.placa = normalizarPlaca(vForm.placa)
```

E no ramo `if (criando)`, **depois** do `insert` dar certo e **antes** de `fecharVeiculo()`:

```js
    // A ETIQUETA, e a costura com o Patrimônio. Só depois do carro existir:
    // a função precisa da placa gravada pra achá-lo.
    const et = validarEtiqueta(vForm.etiqueta, { obrigatoria: false })
    if (!et.ok) {
      // O carro JÁ foi gravado. Dizer "não consegui gravar" aqui seria mentira,
      // e a pessoa cadastraria o mesmo carro de novo — batendo na placa UNIQUE.
      errosDoVeiculo.value = [`O veículo foi cadastrado. ${et.erro} Abra a ficha `
        + 'dele e ligue ao Patrimônio quando quiser.']
      fecharVeiculo(); carregar(); return
    }
    if (et.numero !== null) {
      const { data: sinc, error: erroSinc } = await sbClient.rpc('sincronizar_carro_e_bem', {
        p_placa: dados.placa,
        p_etiqueta: et.numero,
        p_nome: dados.nome,
        p_marca: dados.marca,
        p_valor_centavos: dados.fipe_centavos,
      })
      if (erroSinc) {
        // De novo: o carro existe. O que falhou foi a ligação, e a frase diz
        // exatamente isso — inclusive o motivo que veio do banco, que já vem
        // escrito em português pra leigo.
        errosDoVeiculo.value = ['O veículo foi cadastrado, mas não consegui ligá-lo ao '
          + `Patrimônio: ${erroSinc.message} Abra a ficha dele e tente de novo.`]
        fecharVeiculo(); carregar(); return
      }
      seloDaSincronia.value = fraseDaSincronia(sinc)
    }
```

E declarar o selo perto dos outros avisos de tela:

```js
// O que a sincronia com o Patrimônio fez, em português. Nulo = nada a dizer.
const seloDaSincronia = ref(null)
```

Mostrá-lo na área de Gestão, junto dos outros avisos:

```html
<p class="fr-aviso" v-if="seloDaSincronia">{{ seloDaSincronia }}</p>
```

E limpá-lo em `abrirVeiculo()` e `abrirVeiculoNovo()`: `seloDaSincronia.value = null` — o resultado do carro anterior não pertence ao próximo.

- [ ] **Step 9: Registrar a tela nova no guarda de imports**

`src/ferramentas/frota/imports.test.mjs` conta as telas da pasta. Nenhum `.vue` foi criado nesta tarefa, então **`minimoDeTelas` não muda**. Confirme rodando:

Run: `npx node --test src/ferramentas/frota/imports.test.mjs`
Expected: PASS. Se falhar por import não declarado, é o `etiqueta-do-veiculo.js` faltando no import da tela — conserte o import, nunca o número.

- [ ] **Step 10: Rodar a suíte e o build**

Run: `npm test && npm run build`
Expected: PASS nos dois. ⚠️ O build tem que passar: import esquecido **não** quebra o `node --test`, só deixa a tela em branco quando alguém clica.

- [ ] **Step 11: Escrever o LEIA-ME que falta na pasta**

`src/ferramentas/frota/LEIA-ME.txt` — a pasta é a única de ferramenta sem um. Conteúdo:

```
A ferramenta de Frota: quem dirige pega e devolve carro, quem administra
cuida da frota inteira. A tela é `tela-de-frota.vue`, e ao redor dela cada
regra mora num arquivo próprio, testado sem montar componente.

As duas áreas da tela (areas-da-frota.js): Motorista e Gestão. Motorista é
quem está de pé no estacionamento e quer uma coisa só; Gestão é a frota
inteira, com contrato e valor. A separação é de ATENÇÃO, não de sigilo.

  areas-da-frota.js        quais abas cada pessoa vê, e o que a área
                           Motorista mostra
  botoes-rapidos.js        os botões do topo, com a resposta já no rótulo
  gavetas.js               as seções que abrem e fecham; gaveta com algo
                           esperando a pessoa ABRE SOZINHA e não deixa fechar
  estado-do-veiculo.js     se o carro está livre, na rua, na oficina
  historico-de-reservas.js a linha do tempo de reserva, retirada e posse
  requisicoes.js           o pedido de carro e a decisão de quem aprova
  revisoes.js              de quantos em quantos km cada item se troca
  assinar-checklist.js     a ficha do dia e a assinatura de quem conferiu
  conferencia-de-assinaturas.js  se a assinatura é de quem pegou o carro
  copias-no-zoho.js        se a ficha assinada chegou no Zoho
  bens-para-veiculo.js     que bem do Patrimônio pode virar carro
  etiqueta-do-veiculo.js   o nº de patrimônio e a frase da sincronia

A VIA DE MÃO DUPLA COM O PATRIMÔNIO (20/08/2026). Cadastrar carro aqui cria
o item no Patrimônio, e cadastrar item de veículo lá cria o carro aqui. Quem
costura é a função `sincronizar_carro_e_bem` no banco (migration 049), e não
a tela — os portões de permissão das duas ferramentas são diferentes, e 7
pessoas têm só um dos dois. O outro lado da ponte é
`../patrimonio/ligacao-com-frota.js`.

O vínculo mora numa coluna só: `frota_veiculos.bem_id`, única desde a 048.

CUIDADO. `tela-de-frota.vue` passa de 5.000 linhas — é onde um import
esquecido se esconde melhor, e import esquecido NÃO quebra o build: deixa a
tela em branco quando alguém clica. Por isso existe `imports.test.mjs`.
```

- [ ] **Step 12: Commit**

```bash
git add src/ferramentas/frota/bens-para-veiculo.js src/ferramentas/frota/bens-para-veiculo.test.mjs src/ferramentas/frota/tela-de-frota.vue src/ferramentas/frota/LEIA-ME.txt
git commit -m "feat(frota): acrescentar veículo pede o nº de patrimônio e já liga tudo

O campo faltava, e por isso o KWID cadastrado pela Frota em 20/08 nasceu
órfão do Patrimônio.

O próximo número livre vem do BANCO, não de conta na tela: patrimonio_config
tem RLS de Patrimônio e 5 pessoas só têm a Frota — a conta local daria
número errado pra elas, calada. Falhou a leitura, a tela não sugere nada:
chute vira adesivo colado com número já usado.

E quando a ligação falha DEPOIS do carro gravado, a tela diz exatamente
isso. Dizer 'não consegui gravar' faria a pessoa cadastrar de novo e bater
na placa UNIQUE.

Morre também a sugestão de codigo_patrimonial em seis dígitos: '000291' não
batia com os 'RBB-00X' dos carros nem com nenhuma tela.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: O Patrimônio ganha o campo "Placa"

**Files:**
- Modify: `src/ferramentas/patrimonio/ligacao-com-frota.js`
- Modify: `src/ferramentas/patrimonio/ligacao-com-frota.test.mjs`
- Modify: `src/ferramentas/patrimonio/tela-de-patrimonio.vue`
- Modify: `src/ferramentas/patrimonio/LEIA-ME.txt`

**Interfaces:**
- Consumes: `normalizarPlaca`, `fraseDaSincronia` (Task 3); `sincronizar_carro_e_bem` (Task 2); `veiculoLigadoAoBem` (já existe).
- Produces: `exigePlacaNoBem(form, categoriaVeiculoId) → boolean`.

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar em `src/ferramentas/patrimonio/ligacao-com-frota.test.mjs`:

```js
import { exigePlacaNoBem } from './ligacao-com-frota.js'

test('exigePlacaNoBem: só a categoria Veículos exige placa', () => {
  // Decisão do dono (20/08/2026): bem de veículo não salva sem placa, porque
  // é a placa que faz o carro nascer na Frota. Cadeira não tem placa.
  assert.equal(exigePlacaNoBem({ categoria_id: 'cat-veic' }, 'cat-veic'), true)
  assert.equal(exigePlacaNoBem({ categoria_id: 'cat-moveis' }, 'cat-veic'), false)
})

test('exigePlacaNoBem: sem a categoria identificada, NÃO exige nada', () => {
  // Mesma cautela de bemEhCategoriaVeiculo: se a busca da categoria falhou,
  // exigir placa travaria o cadastro de QUALQUER bem da empresa.
  assert.equal(exigePlacaNoBem({ categoria_id: 'cat-veic' }, null), false)
  assert.equal(exigePlacaNoBem(null, 'cat-veic'), false)
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx node --test src/ferramentas/patrimonio/ligacao-com-frota.test.mjs`
Expected: FAIL — `exigePlacaNoBem is not a function`

- [ ] **Step 3: Escrever a função**

Em `src/ferramentas/patrimonio/ligacao-com-frota.js`, no fim:

```js
/**
 * Este bem precisa de placa? Só se for da categoria Veículos.
 *
 * Decisão do dono (20/08/2026): bem de veículo não salva sem placa. Não é
 * burocracia — é a placa que faz o carro NASCER na Frota, e sem ela o bem
 * ficaria órfão exatamente como o KWID nº 291 ficou.
 *
 * Sem a categoria identificada devolve `false`, mesma cautela de
 * `bemEhCategoriaVeiculo`: se a busca da categoria falhar, exigir placa
 * travaria o cadastro de QUALQUER bem da empresa — 362 deles.
 */
export function exigePlacaNoBem(form, categoriaVeiculoId) {
  return bemEhCategoriaVeiculo(form, categoriaVeiculoId);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx node --test src/ferramentas/patrimonio/ligacao-com-frota.test.mjs`
Expected: PASS

- [ ] **Step 5: Importar na tela e preencher a placa dos bens que já têm carro**

Em `src/ferramentas/patrimonio/tela-de-patrimonio.vue`, no import de `./ligacao-com-frota.js` (linha ~936), acrescentar `exigePlacaNoBem`. E importar da Frota:

```js
import { normalizarPlaca, fraseDaSincronia } from '../frota/etiqueta-do-veiculo.js'
```

⚠️ Import entre pastas de ferramenta já é prática desta base (`tela-de-acessos.vue:59` importa `../patrimonio/ligacao-com-frota.js`). Duplicar `normalizarPlaca` aqui é que seria erro: normalizar diferente dos dois lados cria carro duplicado por causa de um hífen.

Onde a ficha do bem é aberta (a função que preenche `form` a partir de `bemAberto`, perto da linha 1552), acrescentar:

```js
  // A PLACA NÃO É COLUNA DO BEM, de propósito: ela mora em
  // `frota_veiculos.placa`, e cópia em duas tabelas é o que diverge depois.
  // Num bem que já tem carro, ela vem preenchida do carro ligado — assim
  // ninguém digita nada pra editar um bem antigo (10 dos 11 são assim).
  form.placa = (veiculoLigadoAoBem(veiculosFrota.value, bem.id) || {}).placa || ''
```

- [ ] **Step 6: Desenhar o campo**

No formulário do bem, logo abaixo do campo de nº de etiqueta, acrescentar:

```html
<!-- PLACA (20/08/2026). Só pra Veículos, e obrigatória: é ela que faz o
     carro nascer na Frota. Não vira coluna do bem — é gravada do outro
     lado, em frota_veiculos.placa. -->
<label class="pat-campo" v-if="exigePlacaNoBem(form, categoriaVeiculoId)">
  <span>Placa <em class="pat-obrig">obrigatória</em></span>
  <input v-model="form.placa" type="text" placeholder="Ex.: RVU6B06">
  <small class="pat-dica">
    Com a placa, este item já aparece na Frota como carro. Se a placa já
    existir lá, eu ligo os dois em vez de criar outro.
  </small>
</label>
```

- [ ] **Step 7: Ligar o Salvar na função do banco**

Em `salvarBem()`, logo depois da validação do nº da etiqueta:

```js
  // A PLACA, quando é veículo. Barra ANTES de gravar: o dono decidiu que bem
  // de veículo não nasce sem placa, e nascer sem seria repetir o KWID órfão.
  const precisaPlaca = exigePlacaNoBem(form, categoriaVeiculoId.value)
  const placa = normalizarPlaca(form.placa)
  if (precisaPlaca && !placa) {
    adminToast('Item de veículo precisa da placa — é ela que cria o carro na Frota', false)
    return
  }
```

⚠️ `linha` **não** ganha campo de placa. A tabela `patrimonio_bens` não tem essa coluna, e mandá-la faria o PostgREST recusar a gravação inteira.

E depois do `insert`/`update` dar certo, antes de `sincronizarPosse`:

```js
  // A COSTURA COM A FROTA. Só pra veículo, e só depois do bem existir: a
  // função precisa do `bem_id` gravado.
  let seloDaFrota = null
  if (precisaPlaca) {
    const { data: sinc, error: erroSinc } = await sbClient.rpc('sincronizar_carro_e_bem', {
      p_bem_id: bemId,
      p_placa: placa,
      p_nome: nome,
      p_marca: linha.marca,
      p_valor_centavos: valorCentavos,
    })
    if (erroSinc) {
      // O bem JÁ está gravado. A mensagem diz isso na cara, senão a pessoa
      // cadastra de novo e cria bem duplicado — `numero` é UNIQUE, mas nome
      // repetido passa liso.
      salvando.value = false
      adminToast('O item foi salvo, mas não consegui criar o carro na Frota: '
        + erroSinc.message, false)
      await carregar()
      return
    }
    seloDaFrota = fraseDaSincronia(sinc)
  }
```

E trocar o `adminToast('Bem salvo')` do fim por:

```js
  adminToast(seloDaFrota || 'Bem salvo')
```

- [ ] **Step 8: Rodar a suíte e o build**

Run: `npm test && npm run build`
Expected: PASS nos dois. O total de testes tem que ser **maior** que o anotado na Task 3 — dois testes novos entraram.

- [ ] **Step 9: Atualizar o LEIA-ME do Patrimônio**

Em `src/ferramentas/patrimonio/LEIA-ME.txt`, na linha que descreve `ligacao-com-frota.js`, acrescentar depois dela:

```
  A ligação virou MÃO DUPLA DE VERDADE em 20/08/2026: bem da categoria
  Veículos exige placa, e salvar já cria (ou acha) o carro na Frota. Quem
  costura é `sincronizar_carro_e_bem` no banco, não a tela — os portões de
  permissão das duas ferramentas são diferentes. A placa NÃO é coluna do
  bem: mora em `frota_veiculos.placa`, e a ficha a mostra lendo o carro
  ligado.
```

- [ ] **Step 10: Commit**

```bash
git add src/ferramentas/patrimonio/ligacao-com-frota.js src/ferramentas/patrimonio/ligacao-com-frota.test.mjs src/ferramentas/patrimonio/tela-de-patrimonio.vue src/ferramentas/patrimonio/LEIA-ME.txt
git commit -m "feat(patrimonio): item de veículo pede a placa e já nasce na Frota

Decisão do dono: bem da categoria Veículos não salva sem placa. É ela que
faz o carro nascer do outro lado — sem ela o item fica órfão, como o KWID
nº 291 ficou em 20/08.

A placa NÃO vira coluna do bem. Mora em frota_veiculos.placa, e a ficha a
mostra lendo o carro ligado: cópia em duas tabelas é o que diverge depois.
Nos 10 bens que já têm carro ela vem preenchida sozinha, então editar bem
antigo não pede digitação nenhuma.

normalizarPlaca vem da Frota em vez de ser reescrita aqui: normalizar
diferente nos dois lados criaria carro duplicado por causa de um hífen.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Provar na tela, juntar o KWID e fechar a documentação

**Files:**
- Modify: `docs/pendencias.md`

**Interfaces:**
- Consumes: tudo das tarefas 1 a 5.
- Produces: nada.

⚠️ **Esta tarefa é a que decide se o trabalho existe.** Teste verde não é tela que abre: `node --test` não compila `.vue`, e o build passa com a tela quebrada.

- [ ] **Step 1: Subir o app numa porta própria**

```bash
npm run dev -- --port 5199 --strictPort
```

⚠️ Porta fixa e `--strictPort` de propósito: outra janela de trabalho pode estar usando a porta padrão, e **nunca** se mata processo alheio.

- [ ] **Step 2: Cadastrar um carro pela Frota, com conta real**

Na aba Gestão → *Acrescentar um veículo*. Preencher nome, uma placa **que não existe**, e o nº de patrimônio sugerido.

Conferir na tela, não no código:
- o campo "Nº de patrimônio" aparece, e a dica diz **"Próximo livre: 5"**
- depois de salvar, a frase é **"Criei o veículo … e o item nº 5 no Patrimônio, já ligados."**
- abrir o Patrimônio e achar o item nº 5, na categoria Veículos

- [ ] **Step 3: Cadastrar um item de veículo pelo Patrimônio, com conta real**

Novo bem → categoria **Veículos**. Conferir que o campo **Placa** aparece e que salvar **sem** ela é recusado com a frase em português. Depois preencher uma placa nova e conferir que o carro apareceu na Frota.

- [ ] **Step 4: Provar que o campo Placa não atrapalha bem antigo**

Abrir um bem de veículo que já tem carro (ex.: **VOLVO XC60**). Conferir que a placa vem **preenchida sozinha** (`BDN3A67`) e que salvar não pede nada nem muda a ligação.

- [ ] **Step 5: Apagar o que foi criado nas provas**

Os dois cadastros dos passos 2 e 3 são dado de teste **criado por você** — some com eles pela própria tela.

⚠️ **Não confundir com o KWID:** aquilo é dado de verdade do dono e **não se apaga**.

- [ ] **Step 6: Juntar o KWID — o caso que provocou o pedido**

Pela tela do Patrimônio, abrir o bem **nº 291 (KWID)** e digitar a placa **`RVU6B06`**. Salvar.

Esperado: a frase **"Liguei o veículo RVU6B06 ao item nº 291 do Patrimônio."** — a função acha o carro que já existe pela placa e amarra os dois. As duas fichas de 20/08 viram uma, sem apagar nada.

Conferir no banco (leitura):

```sql
select v.placa, v.nome, b.numero, b.nome as bem
  from public.frota_veiculos v join public.patrimonio_bens b on b.id = v.bem_id
 where v.placa = 'RVU6B06';
```

Esperado: **uma linha**, com `numero = 291`.

- [ ] **Step 7: Conferir que nada mais mudou no banco**

```sql
select (select count(*) from public.frota_veiculos)  as carros,
       (select count(*) from public.patrimonio_bens) as bens,
       (select count(*) from public.frota_veiculos where bem_id is not null) as ligados;
```

Esperado: **11 carros, 362 bens, 11 ligados** — os mesmos totais de antes, com um vínculo a mais (era 10).

- [ ] **Step 8: Escrever a pendência das 9 etiquetas**

Em `docs/pendencias.md`, na **Parte A — Só o dono resolve**, acrescentar:

```markdown
**A14 · os 9 carros antigos não têm etiqueta de patrimônio.** Medido em
20/08/2026: o sistema tem 362 bens, 353 com número, e os **9 sem número são
exatamente os 9 carros antigos** — nenhum outro bem da empresa ficou de fora.
Eles carregam o código `RBB-00X`, que é só da Frota e nenhum leitor de código
lê.

Desde 20/08 carro novo já nasce com número de etiqueta pelos dois caminhos.
Falta o passado: **colar o adesivo nesses 9 e escrever o número na ficha**.
Enquanto não for feito, o leitor de código não acha carro, e o `RBB-00X`
continua sendo a única identificação que eles têm — por isso ele **não** foi
aposentado.

Os 9: VOLVO XC60, FIAT DOBLO, FIAT BRAVO ESSENCE, FIAT BRAVO BLACKMOTION,
HONDA FIT, FORD FIESTA SEDAN, VOLVO XC90, PORSCHE CAYENNE PHEV, BMW X1.
(O FIAT PUNTO escapou: já tem o nº 14.)
```

⚠️ Se a Parte A estiver marcada como **"Vazia em 18/08"**, tire essa marcação — deixar as duas coisas seria a lista mentindo sobre si mesma.

- [ ] **Step 9: Atualizar a data de revisão do arquivo**

No topo de `docs/pendencias.md`, trocar `Última revisão: **19/08/2026**` por `Última revisão: **20/08/2026**`.

- [ ] **Step 10: Commit**

```bash
git add docs/pendencias.md
git commit -m "docs: A14 — os 9 carros antigos ainda não têm etiqueta de patrimônio

Carro novo já nasce com número pelos dois caminhos desde 20/08. Falta o
passado: 9 dos 362 bens não têm número, e são exatamente os 9 carros
antigos. Adesivo pra colar, não código — por isso entra na Parte A.

O RBB-00X fica onde está enquanto isso: é a única identificação que esses
9 carros têm.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 11: Deploy**

```bash
git push origin main
```

Conferir no ar pelo caminho: home → entrada → chunk. ⚠️ O hash local mente — a conferência é pelo que o servidor serve.

---

## Auto-revisão do plano

**Cobertura da spec:**

| Requisito da spec | Onde |
|---|---|
| Função que costura os dois lados, gateada por "Frota OU Patrimônio" | Task 2 |
| Só cria bem da categoria Veículos | Task 2, Step 1 |
| Recusa religar par cruzado | Task 2, Steps 1 e 5 |
| Devolve ids + o que fez, em português | Task 2 (código) + Task 3 (frase) |
| `bem_id` vira único | Task 1 |
| Nenhuma coluna de placa no bem | Task 5, Step 7 (o aviso no `linha`) |
| Campo Nº de patrimônio na Frota, com próximo livre | Task 4, Steps 6 e 7 |
| Próximo livre é 5, e a tela DIZ isso | Task 4, Step 7 |
| Morre a sugestão `000291` | Task 4, Steps 1 a 4 |
| Placa obrigatória em bem de veículo | Task 5 |
| Placa preenchida sozinha nos 10 bens ligados | Task 5, Step 5 |
| O KWID juntado pela via normal | Task 6, Step 6 |
| Os 9 sem etiqueta ficam de fora, escritos | Task 6, Step 8 |
| Prova: teste puro, `rollback`, trava recusando, tela | Tasks 1–6 |

Sem buracos.

**Nomes conferidos entre tarefas:** `normalizarPlaca`, `validarEtiqueta`, `fraseDaSincronia` (Task 3) são usados com o mesmo nome nas Tasks 4 e 5. `exigePlacaNoBem` (Task 5) idem. `sincronizar_carro_e_bem` e `proxima_etiqueta_livre` (Task 2) são chamados com os mesmos nomes de parâmetro (`p_placa`, `p_etiqueta`, `p_bem_id`, `p_nome`, `p_marca`, `p_valor_centavos`) nas Tasks 4 e 5. Os cinco códigos de `fez` batem entre o SQL da Task 2 e o `FRASES` da Task 3.
