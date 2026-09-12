# Excluir, editar e baixar lotes e peças do Selo Vessel — plano

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA: use
> `superpowers:subagent-driven-development` (recomendado) ou
> `superpowers:executing-plans`. Os passos usam caixinha (`- [ ]`).

**Objetivo:** deixar o dono corrigir e limpar o que criou, sem que uma bolsa
original na mão de uma cliente vire uma página dizendo "não consta".

**Arquitetura:** a recusa mora no BANCO — funções `security definer` que se
negam a excluir peça gravada. A tela só traduz a recusa para português. Peça
gravada não se exclui: vira BAIXA reversível, numa tabela de histórico própria.

**Tecnologia:** PostgreSQL (Supabase), Vue 3 Composition API, `node:test`.

**Spec:** `docs/superpowers/specs/2026-08-30-vessel-excluir-editar-baixar-design.md`

## Restrições que valem para TODAS as tarefas

- **Ler `PADRAO-DA-CENTRAL.md` antes da primeira linha.** Obrigatório neste repo.
- **A recusa é do BANCO, não da tela.** A tela impedir não basta: quem chama a
  função direto passaria por cima, e o custo é uma bolsa original virando
  "não consta" na mão da cliente.
- **Excluir só o que NUNCA foi gravado.** Peça gravada só vira baixa.
- Motivos de baixa, exatamente estes quatro: `extraviada`, `defeito`,
  `devolvida`, `etiqueta_perdida`.
- `baixada_por` e `desfeita_por` saem de `auth.uid()` DENTRO da função, nunca de
  parâmetro — parâmetro deixaria quem chama dizer que foi outra pessoa.
- Padrão das funções do selo, copiado do que já existe:
  `security definer`, `set search_path to 'public'`, portão
  `if not public.is_vessel_admin() then return json_build_object('ok', false, 'motivo', 'sem_permissao'); end if;`,
  e no fim `revoke all on function ... from public, anon;` +
  `grant execute on function ... to authenticated;`
- **RLS: uma política de SELECT** para `authenticated` com `is_vessel_admin()`.
  **NÃO é "zero política"** — foi medido em 30/08: é essa política que deixa o
  painel ler `vessel_pecas` direto. Escrita nenhuma; só as funções escrevem.
- **NUNCA tocar no dado real do dono.** Hoje há 1 lote (Mônaco Quartz LV1021,
  5 peças, zero gravadas). Toda prova cria o próprio lote e desfaz com
  `rollback`. **Nunca desarmar a trava para o teste passar** — teste que precisa
  desarmar a trava está provando outra coisa.
- Texto em português, sem jargão, para o dono ler.
- Tela medida **a 375px num navegador de verdade**, nos dois temas.
- `npm run dev -- --port 5199 --strictPort` (há mais de uma janela neste repo).
- Trabalhar em worktree isolado, nunca na `main`.

### ⚠️ Como as tarefas de banco funcionam neste plano

⚠️ **DUAS ARMADILHAS JÁ MEDIDAS na Tarefa 1 — as tarefas 2 e 3 herdam as duas:**

1. **O service role NÃO contorna `is_vessel_admin()`.** A primeira prova rodou
   numa conexão administrativa e as oito asserções voltaram FALSAS de uma vez —
   `auth.uid()` é nulo ali, então toda função devolve `sem_permissao` e a prova
   mede o PORTÃO, não a regra. A saída não é desarmar a trava: é dar a chave à
   conta de robô `claudecode@rbvcompany.com`
   (`5efc08ed-ca8a-437b-9e43-31542029cea9`) **dentro da transação** e fazer a
   sessão ser ela com `set local request.jwt.claims`. O `rollback` devolve.
2. **`union all` não garante ordem de avaliação.** A asserção do histórico ficou
   vermelha sozinha porque a contagem rodou antes das baixas existirem. Os passos
   vivem num bloco `do $$`, um por vez, gravando numa tabela temporária.

O arquivo `db/provas/2026-08-30-vessel-excluir-editar-baixar.sql` já está assim.
**Acrescente as suas asserções DENTRO do bloco `do $$` existente**, antes do
`end $$;` — não crie um bloco novo e não use `union all`.

As tarefas 1 a 3 mexem no banco de **PRODUÇÃO**. Quem implementa **escreve o
arquivo `.sql` e o script de prova**, e **NÃO aplica nada**: quem coordena
aplica pelo MCP do Supabase e roda a prova, devolvendo a saída. Escrita em
produção não sai da mão de quem coordena. Se você é o implementador e sentiu
vontade de aplicar, pare — não é a sua tarefa.

---

## Estrutura de arquivos

| arquivo | responsabilidade |
|---|---|
| `db/migrations/2026-08-30-vessel-baixas.sql` *(novo)* | a tabela `vessel_baixas`, as funções de baixar/desfazer, e `vessel_alertas` com a linha nova |
| `db/migrations/2026-08-30-vessel-excluir.sql` *(novo)* | `vessel_excluir_lote` e `vessel_excluir_peca` |
| `db/migrations/2026-08-30-vessel-editar-lote.sql` *(novo)* | o ajudante `vessel_criar_pecas`, o `vessel_gerar_lote` refeito para usá-lo, e `vessel_editar_lote` |
| `db/provas/2026-08-30-vessel-excluir-editar-baixar.sql` *(novo)* | a prova por `rollback` das três acima |
| `src/ferramentas/autenticidade/lotes.js` *(alterar)* | a fila ignora peça baixada; os motivos e as frases de recusa |
| `src/ferramentas/autenticidade/lotes.test.mjs` *(alterar)* | teste do acima |
| `src/ferramentas/autenticidade/nfc-fila.js` *(alterar)* | `listaParaGravadorDeMesa` não exporta peça baixada |
| `src/ferramentas/autenticidade/nfc-fila.test.mjs` *(alterar)* | teste do acima |
| `src/ferramentas/autenticidade/tela-de-autenticidade.vue` *(alterar)* | Lotes ganha editar e excluir; Gravar ganha baixar e desfazer; Alertas ganha a linha nova |
| `src/ferramentas/autenticidade/LEIA-ME.txt` *(alterar)* | por que peça gravada não se exclui |

### O que já existe, medido, e que as tarefas consomem

```
vessel_lotes (id uuid, modelo text, cor text, sku text, quantidade int,
              fabricado_em date not null default current_date,
              fotos text[], criado_por uuid, criado_em timestamptz)
vessel_pecas (codigo text PK, lote_id uuid -> vessel_lotes on delete cascade,
              numero_na_serie int not null, gravada_em timestamptz,
              criado_em timestamptz)
```

O alfabeto dos códigos é `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (32 letras, sem O,
0, I, 1), 10 caracteres, sorteados com `extensions.gen_random_bytes`. A tela lê
`vessel_pecas` direto com
`sbClient.from('vessel_pecas').select('codigo,lote_id,numero_na_serie,gravada_em')`.

---

### Tarefa 1: A tabela das baixas, baixar, desfazer, e o alerta

**Arquivos:**
- Criar: `db/migrations/2026-08-30-vessel-baixas.sql`

**Interfaces:**
- Consome: `public.is_vessel_admin()`, `public.vessel_pecas`,
  `public.vessel_leituras(codigo, achou, lido_em, ip_hash)`.
- Produz: a tabela `public.vessel_baixas`; `vessel_baixar_peca(p_codigo text, p_motivo text) returns json`;
  `vessel_desfazer_baixa(p_codigo text) returns json`; e `vessel_alertas()`
  passando a devolver mais uma chave, `baixadas_lidas`.

- [ ] **Passo 1: escrever a migration**

Criar `db/migrations/2026-08-30-vessel-baixas.sql`:

```sql
-- BAIXA DE PEÇA — e por que ela existe em vez de um "excluir".
--
-- A página da cliente, diante de um código que não existe, diz "não consta no
-- nosso registro de peças". Então APAGAR uma peça cuja etiqueta já foi gravada e
-- costurada dentro de uma bolsa faz a bolsa ORIGINAL parecer falsa para quem
-- comprou — e não há como desfazer, porque a etiqueta está dentro da bolsa.
--
-- Por isso peça gravada não se exclui: ela é BAIXADA, com motivo. O código
-- continua respondendo normalmente para a cliente (decisão do dono: a página não
-- muda), e some da fila de gravação.

-- É TABELA, e não coluna em vessel_pecas, para o histórico ficar inteiro: com
-- coluna, baixar de novo depois de desfazer apagaria a baixa anterior — e é
-- justamente numa peça que já sumiu uma vez que o histórico interessa.
create table if not exists public.vessel_baixas (
  id           uuid primary key default gen_random_uuid(),
  codigo       text not null references public.vessel_pecas(codigo) on delete cascade,
  motivo       text not null check (motivo in ('extraviada','defeito','devolvida','etiqueta_perdida')),
  baixada_em   timestamptz not null default now(),
  baixada_por  uuid,
  desfeita_em  timestamptz,
  desfeita_por uuid
);

create index if not exists vessel_baixas_codigo_idx on public.vessel_baixas(codigo);

-- UMA baixa ativa por peça, garantida pelo banco. Sem isto, dois cliques
-- rápidos deixariam duas baixas abertas e "desfazer" fecharia só uma.
create unique index if not exists vessel_baixas_ativa_idx
  on public.vessel_baixas(codigo) where desfeita_em is null;

alter table public.vessel_baixas enable row level security;

-- UMA política, de SELECT, igual às outras quatro tabelas do selo. É ela que
-- deixa o painel ler. Escrita nenhuma: só as funções abaixo escrevem.
drop policy if exists vessel_baixas_read on public.vessel_baixas;
create policy vessel_baixas_read on public.vessel_baixas
  for select to authenticated using (public.is_vessel_admin());

-- ── BAIXAR ────────────────────────────────────────────────────────────────
create or replace function public.vessel_baixar_peca(p_codigo text, p_motivo text)
returns json language plpgsql security definer set search_path to 'public'
as $$
declare v_codigo text := upper(trim(coalesce(p_codigo, '')));
begin
  if not public.is_vessel_admin() then
    return json_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if p_motivo not in ('extraviada','defeito','devolvida','etiqueta_perdida') then
    return json_build_object('ok', false, 'motivo', 'motivo_invalido');
  end if;
  if not exists (select 1 from public.vessel_pecas where codigo = v_codigo) then
    return json_build_object('ok', false, 'motivo', 'peca_nao_existe');
  end if;
  if exists (select 1 from public.vessel_baixas
              where codigo = v_codigo and desfeita_em is null) then
    return json_build_object('ok', false, 'motivo', 'ja_baixada');
  end if;
  -- quem baixou sai de auth.uid(), NUNCA de parâmetro: por parâmetro, quem
  -- chama poderia dizer que foi outra pessoa.
  insert into public.vessel_baixas (codigo, motivo, baixada_por)
  values (v_codigo, p_motivo, auth.uid());
  return json_build_object('ok', true, 'codigo', v_codigo, 'motivo_da_baixa', p_motivo);
end;
$$;

-- ── DESFAZER ──────────────────────────────────────────────────────────────
-- Existe porque peça dada como extraviada REAPARECE, e porque um clique errado
-- não pode ser definitivo numa peça que já está com a cliente.
create or replace function public.vessel_desfazer_baixa(p_codigo text)
returns json language plpgsql security definer set search_path to 'public'
as $$
declare v_codigo text := upper(trim(coalesce(p_codigo, ''))); v_n int;
begin
  if not public.is_vessel_admin() then
    return json_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  update public.vessel_baixas
     set desfeita_em = now(), desfeita_por = auth.uid()
   where codigo = v_codigo and desfeita_em is null;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    return json_build_object('ok', false, 'motivo', 'nao_esta_baixada');
  end if;
  return json_build_object('ok', true, 'codigo', v_codigo);
end;
$$;

-- ── O ALERTA QUE DEVOLVE O SINAL PERDIDO ──────────────────────────────────
-- A página da cliente não avisa nada sobre peça baixada (decisão do dono), então
-- o dono não saberia que a bolsa extraviada apareceu. Mas a página JÁ registra
-- toda leitura — então o painel avisa, sem incomodar quem está com a bolsa.
create or replace function public.vessel_alertas()
returns json language plpgsql security definer set search_path to 'public'
as $$
declare v json;
begin
  if not public.is_vessel_admin() then
    return json_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;

  select json_build_object(
    'ok', true,
    'repetidas', coalesce((
      select json_agg(x) from (
        select l.codigo,
               count(*)                  as leituras,
               count(distinct l.ip_hash) as aparelhos,
               max(l.lido_em)            as ultima
          from public.vessel_leituras l
         where l.achou and l.lido_em > now() - interval '30 days'
         group by l.codigo
        having count(distinct l.ip_hash) >= 5
         order by count(distinct l.ip_hash) desc
         limit 20
      ) x), '[]'::json),
    'invalidas', coalesce((
      select json_agg(x) from (
        select l.codigo,
               count(*)       as tentativas,
               max(l.lido_em) as ultima
          from public.vessel_leituras l
         where not l.achou and l.lido_em > now() - interval '30 days'
         group by l.codigo
         order by count(*) desc
         limit 20
      ) x), '[]'::json),
    'baixadas_lidas', coalesce((
      select json_agg(x) from (
        select b.codigo,
               b.motivo,
               count(l.*)     as leituras,
               max(l.lido_em) as ultima
          from public.vessel_baixas b
          join public.vessel_leituras l
            on l.codigo = b.codigo and l.achou and l.lido_em > b.baixada_em
         where b.desfeita_em is null
         group by b.codigo, b.motivo
         order by max(l.lido_em) desc
         limit 20
      ) x), '[]'::json),
    'total_leituras', (select count(*) from public.vessel_leituras where lido_em > now() - interval '30 days')
  ) into v;
  return v;
end;
$$;

revoke all on function public.vessel_baixar_peca(text, text) from public, anon;
revoke all on function public.vessel_desfazer_baixa(text) from public, anon;
grant execute on function public.vessel_baixar_peca(text, text) to authenticated;
grant execute on function public.vessel_desfazer_baixa(text) to authenticated;
```

- [ ] **Passo 2: escrever a prova por rollback**

Criar `db/provas/2026-08-30-vessel-excluir-editar-baixar.sql` com **só a parte
das baixas** por enquanto (as tarefas 2 e 3 acrescentam a delas):

```sql
-- PROVA POR ROLLBACK. Cria o próprio lote e desfaz tudo no fim — o lote real do
-- dono (Mônaco Quartz LV1021) nunca é tocado.
begin;

-- um lote de mentira, com uma peça gravada e uma não gravada
insert into public.vessel_lotes (id, modelo, quantidade, fabricado_em)
values ('11111111-1111-1111-1111-111111111111', 'PROVA', 2, current_date);
insert into public.vessel_pecas (codigo, lote_id, numero_na_serie, gravada_em) values
  ('PROVAGRAV01', '11111111-1111-1111-1111-111111111111', 1, now()),
  ('PROVALIVRE1', '11111111-1111-1111-1111-111111111111', 2, null);

-- 1. baixar com motivo fora da lista tem de RECUSAR
select 'motivo invalido recusa' as prova,
       (public.vessel_baixar_peca('PROVAGRAV01','qualquer') ->> 'motivo') = 'motivo_invalido' as passou;

-- 2. baixar de verdade
select 'baixa funciona' as prova,
       (public.vessel_baixar_peca('PROVAGRAV01','extraviada') ->> 'ok')::boolean as passou;

-- 3. baixar de novo tem de RECUSAR
select 'baixa repetida recusa' as prova,
       (public.vessel_baixar_peca('PROVAGRAV01','defeito') ->> 'motivo') = 'ja_baixada' as passou;

-- 4. desfazer funciona, e desfazer de novo recusa
select 'desfazer funciona' as prova,
       (public.vessel_desfazer_baixa('PROVAGRAV01') ->> 'ok')::boolean as passou;
select 'desfazer duas vezes recusa' as prova,
       (public.vessel_desfazer_baixa('PROVAGRAV01') ->> 'motivo') = 'nao_esta_baixada' as passou;

-- 5. depois de desfazer, dá pra baixar de novo — e o histórico guarda AS DUAS
select 'baixar de novo depois de desfazer' as prova,
       (public.vessel_baixar_peca('PROVAGRAV01','devolvida') ->> 'ok')::boolean as passou;
select 'historico guarda as duas baixas' as prova,
       (select count(*) from public.vessel_baixas where codigo = 'PROVAGRAV01') = 2 as passou;

-- 6. peça que não existe recusa
select 'peca inexistente recusa' as prova,
       (public.vessel_baixar_peca('NAOEXISTE1','defeito') ->> 'motivo') = 'peca_nao_existe' as passou;

rollback;
```

- [ ] **Passo 3: NÃO aplicar — entregar para quem coordena**

Escreva no relatório: "migration e prova escritas, não aplicadas". Quem coordena
aplica pelo MCP e roda a prova. **Todas as linhas da prova têm de vir
`passou = true`**; qualquer `false` ou nulo é defeito.

- [ ] **Passo 4: commitar**

```bash
git add db/migrations/2026-08-30-vessel-baixas.sql db/provas/2026-08-30-vessel-excluir-editar-baixar.sql
git commit -m "banco: baixa de peca, reversivel, e o alerta de peca baixada lida

Peca gravada nao se exclui: a pagina da cliente diz 'nao consta' para codigo
que nao existe, entao apagar uma peca com etiqueta dentro de uma bolsa faz a
bolsa ORIGINAL parecer falsa. Ela vira BAIXA, com motivo, reversivel.

E TABELA e nao coluna para o historico ficar inteiro — com coluna, baixar de
novo depois de desfazer apagaria a baixa anterior, e e justamente numa peca que
ja sumiu uma vez que o historico interessa.

Como a pagina nao avisa nada sobre baixa (decisao do dono), o painel avisa: ela
JA registra toda leitura, entao Alertas ganha 'peca baixada foi lida'."
```

---

### Tarefa 2: Excluir lote e excluir peça, com a recusa no banco

**Arquivos:**
- Criar: `db/migrations/2026-08-30-vessel-excluir.sql`
- Modificar: `db/provas/2026-08-30-vessel-excluir-editar-baixar.sql`

**Interfaces:**
- Consome: `public.is_vessel_admin()`, `public.vessel_pecas`, `public.vessel_lotes`.
- Produz: `vessel_excluir_lote(p_lote uuid) returns json` e
  `vessel_excluir_peca(p_codigo text) returns json`.
  Recusas: `{ok:false, motivo:'tem_gravada', gravadas:int, total:int}` e
  `{ok:false, motivo:'esta_gravada'}`.

- [ ] **Passo 1: escrever a migration**

Criar `db/migrations/2026-08-30-vessel-excluir.sql`:

```sql
-- EXCLUIR SÓ O QUE NUNCA FOI GRAVADO.
--
-- A recusa mora AQUI, e não na tela. A tela impedir não basta: quem chamar a
-- função direto passaria por cima, e o custo é uma bolsa original virando
-- "não consta no nosso registro" na mão de quem comprou.

create or replace function public.vessel_excluir_lote(p_lote uuid)
returns json language plpgsql security definer set search_path to 'public'
as $$
declare v_gravadas int; v_total int;
begin
  if not public.is_vessel_admin() then
    return json_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;

  select count(*) filter (where gravada_em is not null), count(*)
    into v_gravadas, v_total
    from public.vessel_pecas where lote_id = p_lote;

  if not exists (select 1 from public.vessel_lotes where id = p_lote) then
    return json_build_object('ok', false, 'motivo', 'lote_nao_existe');
  end if;

  -- BASTA UMA gravada para o lote inteiro ficar preso: as outras peças até
  -- poderiam sumir, mas o lote é o que dá modelo, cor e data para a página da
  -- cliente ler. Sem ele, a peça gravada fica órfã.
  if v_gravadas > 0 then
    return json_build_object('ok', false, 'motivo', 'tem_gravada',
                             'gravadas', v_gravadas, 'total', v_total);
  end if;

  -- as peças saem por cascade (vessel_pecas.lote_id ... on delete cascade),
  -- e as baixas delas por cascade também
  delete from public.vessel_lotes where id = p_lote;
  return json_build_object('ok', true, 'excluidas', v_total);
end;
$$;

create or replace function public.vessel_excluir_peca(p_codigo text)
returns json language plpgsql security definer set search_path to 'public'
as $$
declare v_codigo text := upper(trim(coalesce(p_codigo, '')));
        v_gravada timestamptz; v_lote uuid;
begin
  if not public.is_vessel_admin() then
    return json_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;

  select gravada_em, lote_id into v_gravada, v_lote
    from public.vessel_pecas where codigo = v_codigo;
  if not found then
    return json_build_object('ok', false, 'motivo', 'peca_nao_existe');
  end if;
  if v_gravada is not null then
    return json_build_object('ok', false, 'motivo', 'esta_gravada');
  end if;

  delete from public.vessel_pecas where codigo = v_codigo;
  -- A quantidade do lote acompanha, senão a tela diria "3 de 5" para sempre.
  -- O `lote_id` foi guardado ANTES do delete, de propósito: depois dele a linha
  -- não existe mais para ser consultada.
  update public.vessel_lotes
     set quantidade = (select count(*) from public.vessel_pecas p where p.lote_id = v_lote)
   where id = v_lote;
  return json_build_object('ok', true, 'codigo', v_codigo);
end;
$$;

revoke all on function public.vessel_excluir_lote(uuid) from public, anon;
revoke all on function public.vessel_excluir_peca(text) from public, anon;
grant execute on function public.vessel_excluir_lote(uuid) to authenticated;
grant execute on function public.vessel_excluir_peca(text) to authenticated;
```

- [ ] **Passo 2: acrescentar à prova**

Acrescentar ao `db/provas/2026-08-30-vessel-excluir-editar-baixar.sql`, ANTES do
`rollback;` final:

```sql
-- 7. excluir lote com peça gravada tem de RECUSAR, dizendo quantas
select 'excluir lote com gravada recusa' as prova,
       (public.vessel_excluir_lote('11111111-1111-1111-1111-111111111111') ->> 'motivo') = 'tem_gravada' as passou;
select 'e diz quantas estao gravadas' as prova,
       (public.vessel_excluir_lote('11111111-1111-1111-1111-111111111111') ->> 'gravadas')::int = 1 as passou;

-- 8. excluir peça gravada tem de RECUSAR
select 'excluir peca gravada recusa' as prova,
       (public.vessel_excluir_peca('PROVAGRAV01') ->> 'motivo') = 'esta_gravada' as passou;

-- 9. excluir peça NÃO gravada funciona, e a quantidade do lote acompanha
select 'excluir peca livre funciona' as prova,
       (public.vessel_excluir_peca('PROVALIVRE1') ->> 'ok')::boolean as passou;
select 'quantidade do lote acompanha' as prova,
       (select quantidade from public.vessel_lotes
         where id = '11111111-1111-1111-1111-111111111111') = 1 as passou;

-- 10. sem peça gravada, o lote inteiro sai
insert into public.vessel_lotes (id, modelo, quantidade, fabricado_em)
values ('22222222-2222-2222-2222-222222222222', 'PROVA LIVRE', 2, current_date);
insert into public.vessel_pecas (codigo, lote_id, numero_na_serie) values
  ('PROVALIVRE2', '22222222-2222-2222-2222-222222222222', 1),
  ('PROVALIVRE3', '22222222-2222-2222-2222-222222222222', 2);
select 'excluir lote livre funciona' as prova,
       (public.vessel_excluir_lote('22222222-2222-2222-2222-222222222222') ->> 'ok')::boolean as passou;
select 'e as pecas dele sumiram junto' as prova,
       (select count(*) from public.vessel_pecas
         where lote_id = '22222222-2222-2222-2222-222222222222') = 0 as passou;
```

- [ ] **Passo 3: NÃO aplicar — entregar para quem coordena**

- [ ] **Passo 4: commitar**

```bash
git add db/migrations/2026-08-30-vessel-excluir.sql db/provas/2026-08-30-vessel-excluir-editar-baixar.sql
git commit -m "banco: excluir lote e peca, com a recusa no proprio banco

Basta UMA peca gravada para o lote inteiro ficar preso: as outras ate poderiam
sumir, mas o lote e o que da modelo, cor e data para a pagina da cliente ler —
sem ele a peca gravada fica orfa.

A recusa mora no banco e nao na tela. A tela impedir nao basta: quem chama a
funcao direto passaria por cima, e o custo e uma bolsa original virando 'nao
consta' na mao de quem comprou.

Excluir peca livre ajusta a quantidade do lote, senao a tela diria '3 de 5'
para sempre."
```

---

### Tarefa 3: Editar o lote, com o sorteio de códigos escrito UMA vez

**Arquivos:**
- Criar: `db/migrations/2026-08-30-vessel-editar-lote.sql`
- Modificar: `db/provas/2026-08-30-vessel-excluir-editar-baixar.sql`

**Interfaces:**
- Consome: `public.is_vessel_admin()`, `extensions.gen_random_bytes`.
- Produz: `vessel_criar_pecas(p_lote uuid, p_de int, p_ate int) returns int`;
  `vessel_gerar_lote(...)` reescrita para usá-lo (assinatura **inalterada**:
  `p_modelo text, p_cor text, p_sku text, p_quantidade int, p_fabricado_em date, p_fotos text[]`);
  `vessel_editar_lote(p_lote uuid, p_modelo text, p_cor text, p_sku text, p_fabricado_em date, p_quantidade int) returns json`.

- [ ] **Passo 1: escrever a migration**

Criar `db/migrations/2026-08-30-vessel-editar-lote.sql`:

```sql
-- O SORTEIO DE CÓDIGOS, ESCRITO UMA VEZ SÓ.
--
-- Ele nasceu dentro do vessel_gerar_lote. Agora o vessel_editar_lote também
-- precisa dele, para quando a quantidade AUMENTA. Copiar o laço seria copiar
-- junto o cuidado com viés de módulo e o motivo de não usar random() — e
-- copiar cuidado é como se perde cuidado.
create or replace function public.vessel_criar_pecas(p_lote uuid, p_de int, p_ate int)
returns int language plpgsql security definer set search_path to 'public'
as $$
declare
  ALFABETO constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  -- sem O, 0, I, 1
  v_codigo text; v_bytes bytea; i int; j int; tentativa int; v_feitas int := 0;
begin
  for i in p_de..p_ate loop
    tentativa := 0;
    loop
      -- Sorteio CRIPTOGRAFICO, nao random(). O random() do Postgres e
      -- previsivel: quem comprasse algumas bolsas e olhasse os codigos poderia
      -- calcular os proximos — e a protecao contra falsificacao depende
      -- justamente de o codigo nao ser adivinhavel.
      -- O alfabeto tem exatamente 32 letras e 256/32 = 8, entao `byte % 32` nao
      -- puxa pra letra nenhuma (sem vies de modulo).
      v_bytes := extensions.gen_random_bytes(10);
      v_codigo := '';
      for j in 0..9 loop
        v_codigo := v_codigo || substr(ALFABETO, 1 + (get_byte(v_bytes, j) % length(ALFABETO)), 1);
      end loop;
      begin
        insert into public.vessel_pecas (codigo, lote_id, numero_na_serie)
        values (v_codigo, p_lote, i);
        v_feitas := v_feitas + 1;
        exit;
      exception when unique_violation then
        tentativa := tentativa + 1;
        if tentativa > 20 then raise exception 'nao consegui sortear codigo livre'; end if;
      end;
    end loop;
  end loop;
  return v_feitas;
end;
$$;

-- vessel_gerar_lote passa a usar o ajudante. A ASSINATURA NAO MUDA: a tela
-- chama com os mesmos seis parametros, e nada do lado dela precisa mexer.
create or replace function public.vessel_gerar_lote(
  p_modelo text, p_cor text, p_sku text, p_quantidade int,
  p_fabricado_em date, p_fotos text[]
) returns json language plpgsql security definer set search_path to 'public'
as $$
declare v_lote uuid;
begin
  if not public.is_vessel_admin() then
    return json_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if coalesce(trim(p_modelo), '') = '' or coalesce(p_quantidade, 0) < 1 or p_quantidade > 500 then
    return json_build_object('ok', false, 'motivo', 'dados_invalidos');
  end if;

  insert into public.vessel_lotes (modelo, cor, sku, quantidade, fabricado_em, fotos, criado_por)
  values (trim(p_modelo),
          nullif(trim(coalesce(p_cor, '')), ''),
          nullif(trim(coalesce(p_sku, '')), ''),
          p_quantidade, coalesce(p_fabricado_em, current_date), p_fotos, auth.uid())
  returning id into v_lote;

  perform public.vessel_criar_pecas(v_lote, 1, p_quantidade);

  return json_build_object('ok', true, 'lote_id', v_lote, 'quantidade', p_quantidade);
end;
$$;

-- ── EDITAR ────────────────────────────────────────────────────────────────
create or replace function public.vessel_editar_lote(
  p_lote uuid, p_modelo text, p_cor text, p_sku text,
  p_fabricado_em date, p_quantidade int
) returns json language plpgsql security definer set search_path to 'public'
as $$
declare v_gravadas int; v_hoje int; v_maior int;
begin
  if not public.is_vessel_admin() then
    return json_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if not exists (select 1 from public.vessel_lotes where id = p_lote) then
    return json_build_object('ok', false, 'motivo', 'lote_nao_existe');
  end if;
  if coalesce(trim(p_modelo), '') = '' or coalesce(p_quantidade, 0) < 1 or p_quantidade > 500 then
    return json_build_object('ok', false, 'motivo', 'dados_invalidos');
  end if;

  select count(*) filter (where gravada_em is not null), count(*),
         coalesce(max(numero_na_serie), 0)
    into v_gravadas, v_hoje, v_maior
    from public.vessel_pecas where lote_id = p_lote;

  -- Diminuir abaixo do que ja foi gravado apagaria peca com etiqueta dentro de
  -- bolsa. Recusa dizendo QUANTAS estao presas — numero seco ajuda mais que
  -- "nao e possivel".
  if p_quantidade < v_gravadas then
    return json_build_object('ok', false, 'motivo', 'abaixo_do_gravado',
                             'gravadas', v_gravadas);
  end if;

  -- modelo, cor, SKU e data sao seguros a qualquer momento: nao tocam em
  -- codigo nenhum, so mudam o que a cliente le na pagina.
  update public.vessel_lotes
     set modelo = trim(p_modelo),
         cor = nullif(trim(coalesce(p_cor, '')), ''),
         sku = nullif(trim(coalesce(p_sku, '')), ''),
         fabricado_em = coalesce(p_fabricado_em, fabricado_em),
         quantidade = p_quantidade
   where id = p_lote;

  if p_quantidade > v_hoje then
    -- nascem codigos novos CONTINUANDO a serie, nunca reaproveitando numero
    perform public.vessel_criar_pecas(p_lote, v_maior + 1, v_maior + (p_quantidade - v_hoje));
  elsif p_quantidade < v_hoje then
    -- saem as NAO GRAVADAS de maior numero na serie
    delete from public.vessel_pecas
     where codigo in (
       select codigo from public.vessel_pecas
        where lote_id = p_lote and gravada_em is null
        order by numero_na_serie desc
        limit (v_hoje - p_quantidade)
     );
  end if;

  return json_build_object('ok', true, 'quantidade',
    (select count(*) from public.vessel_pecas where lote_id = p_lote));
end;
$$;

revoke all on function public.vessel_criar_pecas(uuid, int, int) from public, anon;
revoke all on function public.vessel_editar_lote(uuid, text, text, text, date, int) from public, anon;
grant execute on function public.vessel_editar_lote(uuid, text, text, text, date, int) to authenticated;
```

⚠️ `vessel_criar_pecas` **NÃO recebe grant para `authenticated`**: ela é ajudante
das outras duas, e dar acesso direto deixaria alguém criar peça solta em
qualquer lote.

- [ ] **Passo 2: acrescentar à prova**

Acrescentar ao `db/provas/2026-08-30-vessel-excluir-editar-baixar.sql`, antes do
`rollback;`:

```sql
-- 11. criar lote continua funcionando depois de trocar o miolo pelo ajudante
select 'gerar lote ainda funciona' as prova,
       (public.vessel_gerar_lote('PROVA EDIT', 'Cor', 'SKU1', 3, current_date, null) ->> 'ok')::boolean as passou;

-- 12. e os 3 codigos sao DIFERENTES entre si e tem 10 caracteres
select 'os codigos sao distintos e com 10 letras' as prova,
       (select count(distinct codigo) = 3 and bool_and(length(codigo) = 10)
          from public.vessel_pecas p
          join public.vessel_lotes l on l.id = p.lote_id
         where l.modelo = 'PROVA EDIT') as passou;

-- 13. editar nome e data e seguro
insert into public.vessel_lotes (id, modelo, quantidade, fabricado_em)
values ('33333333-3333-3333-3333-333333333333', 'ANTES', 2, '2020-01-01');
insert into public.vessel_pecas (codigo, lote_id, numero_na_serie, gravada_em) values
  ('PROVAED0001', '33333333-3333-3333-3333-333333333333', 1, now()),
  ('PROVAED0002', '33333333-3333-3333-3333-333333333333', 2, null);
select 'editar nome e data funciona' as prova,
       (public.vessel_editar_lote('33333333-3333-3333-3333-333333333333',
        'DEPOIS', 'Nova', 'SKU9', '2026-03-01', 2) ->> 'ok')::boolean as passou;
select 'a data mudou mesmo' as prova,
       (select fabricado_em = '2026-03-01' and modelo = 'DEPOIS'
          from public.vessel_lotes where id = '33333333-3333-3333-3333-333333333333') as passou;

-- 14. AUMENTAR cria codigos novos continuando a serie
select 'aumentar cria pecas' as prova,
       (public.vessel_editar_lote('33333333-3333-3333-3333-333333333333',
        'DEPOIS', 'Nova', 'SKU9', '2026-03-01', 4) ->> 'quantidade')::int = 4 as passou;
select 'a serie continua, nao repete numero' as prova,
       (select count(distinct numero_na_serie) = 4 and max(numero_na_serie) = 4
          from public.vessel_pecas where lote_id = '33333333-3333-3333-3333-333333333333') as passou;

-- 15. DIMINUIR tira as nao gravadas, e a gravada FICA
select 'diminuir tira as livres' as prova,
       (public.vessel_editar_lote('33333333-3333-3333-3333-333333333333',
        'DEPOIS', 'Nova', 'SKU9', '2026-03-01', 1) ->> 'quantidade')::int = 1 as passou;
select 'a peca gravada sobreviveu' as prova,
       (select count(*) = 1 from public.vessel_pecas
         where lote_id = '33333333-3333-3333-3333-333333333333' and codigo = 'PROVAED0001') as passou;

-- 16. diminuir ABAIXO do gravado recusa, dizendo quantas estao presas
select 'diminuir abaixo do gravado recusa' as prova,
       (public.vessel_editar_lote('33333333-3333-3333-3333-333333333333',
        'DEPOIS', 'Nova', 'SKU9', '2026-03-01', 0) ->> 'motivo') in ('dados_invalidos','abaixo_do_gravado') as passou;
```

- [ ] **Passo 3: NÃO aplicar — entregar para quem coordena**

- [ ] **Passo 4: commitar**

```bash
git add db/migrations/2026-08-30-vessel-editar-lote.sql db/provas/2026-08-30-vessel-excluir-editar-baixar.sql
git commit -m "banco: editar lote, e o sorteio de codigos escrito uma vez so

O laco do sorteio nasceu dentro do vessel_gerar_lote e agora o editar tambem
precisa dele, para quando a quantidade aumenta. Copiar o laco seria copiar
junto o cuidado com vies de modulo e o motivo de nao usar random() — e copiar
cuidado e como se perde cuidado. Virou vessel_criar_pecas, e o gerar_lote passa
a usa-lo com a MESMA assinatura de fora.

Diminuir tira as nao gravadas de maior numero na serie; abaixo do que ja foi
gravado, recusa dizendo QUANTAS estao presas."
```

---

### Tarefa 4: A fila de gravação ignora peça baixada

**Arquivos:**
- Modificar: `src/ferramentas/autenticidade/lotes.js`
- Modificar: `src/ferramentas/autenticidade/lotes.test.mjs`
- Modificar: `src/ferramentas/autenticidade/nfc-fila.js`
- Modificar: `src/ferramentas/autenticidade/nfc-fila.test.mjs`

**Interfaces:**
- Consome: nada novo.
- Produz: `proximaPorGravar` e `progressoDoLote` (em `lotes.js`) e
  `listaParaGravadorDeMesa` (em `nfc-fila.js`) passam a ignorar peça com
  `baixada` verdadeiro. Mais `MOTIVOS_DE_BAIXA` e `fraseDaRecusa(motivo, dados)`
  em `lotes.js`.

A peça baixada chega à tela como um objeto com o campo `baixada` — a tela cruza
`vessel_pecas` com `vessel_baixas` ao carregar (tarefa 6).

- [ ] **Passo 1: escrever os testes que falham**

Acrescentar a `src/ferramentas/autenticidade/lotes.test.mjs` (e somar
`MOTIVOS_DE_BAIXA` e `fraseDaRecusa` ao `import` do topo):

```js
test('proximaPorGravar: peca BAIXADA sai da fila', () => {
  // sem isto a tela mandaria alguem gravar a etiqueta de uma peca dada como
  // refugo — e a etiqueta ia para dentro de uma bolsa que nao deveria existir
  const pecas = [
    { codigo: 'A', numero_na_serie: 1, gravada_em: null, baixada: true },
    { codigo: 'B', numero_na_serie: 2, gravada_em: null },
  ]
  assert.equal(proximaPorGravar(pecas).codigo, 'B')
})

test('proximaPorGravar: lote so com baixadas devolve nulo', () => {
  assert.equal(proximaPorGravar([{ codigo: 'A', gravada_em: null, baixada: true }]), null)
})

test('progressoDoLote: peca baixada nao entra na conta', () => {
  // se entrasse no total, o lote NUNCA fecharia: ficaria "2 de 3" para sempre
  const pecas = [
    { gravada_em: '2026-08-30T10:00:00Z' },
    { gravada_em: '2026-08-30T10:01:00Z' },
    { gravada_em: null, baixada: true },
  ]
  assert.deepEqual(progressoDoLote(pecas), { gravadas: 2, total: 2, texto: '2 de 2' })
})

test('progressoDoLote: peca GRAVADA e depois baixada tambem sai dos dois numeros', () => {
  const pecas = [
    { gravada_em: '2026-08-30T10:00:00Z' },
    { gravada_em: '2026-08-30T10:01:00Z', baixada: true },
  ]
  assert.deepEqual(progressoDoLote(pecas), { gravadas: 1, total: 1, texto: '1 de 1' })
})

test('MOTIVOS_DE_BAIXA: os quatro do dono, com rotulo em portugues', () => {
  assert.deepEqual(MOTIVOS_DE_BAIXA.map((m) => m.chave),
    ['extraviada', 'defeito', 'devolvida', 'etiqueta_perdida'])
  MOTIVOS_DE_BAIXA.forEach((m) => assert.ok(m.rotulo.length > 3))
})

test('fraseDaRecusa: explica POR QUE, com o numero, em vez de "nao foi possivel"', () => {
  const f = fraseDaRecusa('tem_gravada', { gravadas: 7, total: 20 })
  assert.match(f, /7/)
  assert.match(f, /20/)
  assert.match(f, /baixa/i, 'tem de dizer o que fazer no lugar')
})

test('fraseDaRecusa: peca gravada manda dar baixa', () => {
  assert.match(fraseDaRecusa('esta_gravada', {}), /baixa/i)
})

test('fraseDaRecusa: abaixo do gravado diz qual e o minimo', () => {
  assert.match(fraseDaRecusa('abaixo_do_gravado', { gravadas: 7 }), /7/)
})

test('fraseDaRecusa: motivo desconhecido nao vira frase vazia', () => {
  const f = fraseDaRecusa('coisa_estranha', {})
  assert.ok(f.length > 15, 'sempre tem de sobrar alguma coisa legivel na tela')
})
```

Acrescentar a `src/ferramentas/autenticidade/nfc-fila.test.mjs`:

```js
test('listaParaGravadorDeMesa: peca baixada nao vai para o gravador', () => {
  const pecas = [
    { codigo: 'AAA111', numero_na_serie: 1, gravada_em: null },
    { codigo: 'BBB111', numero_na_serie: 2, gravada_em: null, baixada: true },
  ]
  assert.equal(listaParaGravadorDeMesa(pecas),
    'https://vesselbrasil.com.br/verify/AAA111')
})
```

- [ ] **Passo 2: rodar e ver falhar**

Rodar: `node --test 'src/ferramentas/autenticidade/*.test.mjs'`
Esperado: FALHA — `MOTIVOS_DE_BAIXA is not defined` e as filas ainda devolvendo
a peça baixada.

- [ ] **Passo 3: implementar**

Em `src/ferramentas/autenticidade/lotes.js`, trocar as duas funções e
acrescentar as duas novas:

```js
// PEÇA BAIXADA SAI DA FILA. Sem isto a tela mandaria alguém gravar a etiqueta
// de uma peça dada como refugo, e a etiqueta iria para dentro de uma bolsa que
// não deveria existir.
const naFila = (p) => !p.baixada

export function progressoDoLote(pecas) {
  // a baixada sai dos DOIS números: se ficasse no total, o lote nunca fecharia
  const lista = (Array.isArray(pecas) ? pecas : []).filter(naFila)
  const gravadas = lista.filter((p) => p.gravada_em).length
  return { gravadas, total: lista.length, texto: `${gravadas} de ${lista.length}` }
}

export function proximaPorGravar(pecas) {
  const lista = (Array.isArray(pecas) ? pecas : [])
    .filter((p) => naFila(p) && !p.gravada_em)
    .sort((a, b) => (a.numero_na_serie || 0) - (b.numero_na_serie || 0))
  return lista[0] || null
}

// ── OS MOTIVOS DE BAIXA ────────────────────────────────────────────────────
// Os quatro que o dono escolheu. A chave é o que o banco aceita (há um `check`
// na tabela com exatamente estas quatro); o rótulo é o que a pessoa lê.
export const MOTIVOS_DE_BAIXA = [
  { chave: 'extraviada', rotulo: 'Extraviada' },
  { chave: 'defeito', rotulo: 'Defeito ou refugo' },
  { chave: 'devolvida', rotulo: 'Devolvida' },
  { chave: 'etiqueta_perdida', rotulo: 'Etiqueta perdida ou danificada' },
]

// ── AS FRASES DE RECUSA ────────────────────────────────────────────────────
// Botão desabilitado calado faz a pessoa achar que a ferramenta está quebrada.
// Cada recusa do banco vira uma frase que diz POR QUE e O QUE FAZER.
export function fraseDaRecusa(motivo, dados = {}) {
  const d = dados || {}
  switch (motivo) {
    case 'tem_gravada':
      return `Não dá para excluir: ${d.gravadas} das ${d.total} etiquetas deste lote `
        + 'já foram gravadas e podem estar dentro de bolsas. Você pode dar baixa nas peças, uma a uma.'
    case 'esta_gravada':
      return 'Esta etiqueta já foi gravada e pode estar dentro de uma bolsa. '
        + 'Em vez de excluir, dê baixa nela com o motivo.'
    case 'abaixo_do_gravado':
      return `Não dá para diminuir tanto: ${d.gravadas} peça(s) já foram gravadas. `
        + `O mínimo é ${d.gravadas}.`
    case 'ja_baixada':
      return 'Esta peça já está baixada. Desfaça a baixa antes de baixar de novo.'
    case 'nao_esta_baixada':
      return 'Esta peça não está baixada.'
    case 'sem_permissao':
      return 'Você não tem permissão para isso. Peça a chave "autenticidade" a um administrador.'
    case 'lote_nao_existe':
    case 'peca_nao_existe':
      return 'Não encontrei esse registro. Recarregue a tela e tente de novo.'
    case 'dados_invalidos':
      return 'Confira os campos: o modelo é obrigatório e a quantidade vai de 1 a 500.'
    default:
      return 'Não consegui fazer isso agora. Recarregue a tela e tente de novo.'
  }
}
```

Em `src/ferramentas/autenticidade/nfc-fila.js`, na `listaParaGravadorDeMesa`:

```js
    .filter((p) => !p.gravada_em && !p.baixada)
```

- [ ] **Passo 4: rodar e ver passar**

Rodar: `node --test 'src/ferramentas/autenticidade/*.test.mjs'`
Esperado: PASSA. ⚠️ Confira que os testes que JÁ existiam continuam verdes —
`progressoDoLote` e `proximaPorGravar` são usadas na tela que está no ar.

- [ ] **Passo 5: commitar**

```bash
git add src/ferramentas/autenticidade/lotes.js src/ferramentas/autenticidade/lotes.test.mjs src/ferramentas/autenticidade/nfc-fila.js src/ferramentas/autenticidade/nfc-fila.test.mjs
git commit -m "autenticidade: peca baixada sai da fila de gravacao

Sem isto a tela mandaria alguem gravar a etiqueta de uma peca dada como refugo,
e a etiqueta iria para dentro de uma bolsa que nao deveria existir. Ela sai dos
DOIS numeros do progresso: se ficasse no total, o lote nunca fecharia.

E as frases de recusa, porque botao desabilitado calado faz a pessoa achar que
a ferramenta esta quebrada — cada recusa do banco diz POR QUE e O QUE FAZER."
```

---

### Tarefa 5: A aba Lotes ganha editar e excluir

**Arquivos:**
- Modificar: `src/ferramentas/autenticidade/tela-de-autenticidade.vue`

**Interfaces:**
- Consome: `fraseDaRecusa(motivo, dados)` de `./lotes.js`; as funções do banco
  `vessel_editar_lote(p_lote, p_modelo, p_cor, p_sku, p_fabricado_em, p_quantidade)`
  e `vessel_excluir_lote(p_lote)`.
- Produz: nada para outras tarefas.

O cliente do banco chama-se **`sbClient`** e devolve `{ data, error }` — ele
**não estoura**. `sbClient.rpc` sem checar `error` foi um defeito real deste
mesmo arquivo. Há também `adminToast(texto, ok)`, `podeEditar`, `carregar()`,
`lotes`, `pecasDoLote(id)` e `loteAtual`.

- [ ] **Passo 1: somar o import**

⚠️ Função usada sem import NÃO quebra o build neste repo — o Vite supõe que é
global, e a tela fica EM BRANCO quando alguém clica. Já derrubou tela quatro
vezes. `imports.test.mjs` da pasta pega isso.

```js
import { enderecoDaTag, progressoDoLote, proximaPorGravar, linhasDoCsv, resumoDeAlertas, MOTIVOS_DE_BAIXA, fraseDaRecusa } from './lotes.js'
```

- [ ] **Passo 2: o estado e as duas ações**

```js
const editando = ref(null)   // o lote sendo editado, ou null
const edicao = reactive({ modelo: '', cor: '', sku: '', fabricado_em: '', quantidade: 1 })

function abrirEdicao(l) {
  editando.value = l.id
  edicao.modelo = l.modelo || ''
  edicao.cor = l.cor || ''
  edicao.sku = l.sku || ''
  edicao.fabricado_em = l.fabricado_em || ''
  edicao.quantidade = l.quantidade || 1
}

async function salvarEdicao() {
  const { data, error } = await sbClient.rpc('vessel_editar_lote', {
    p_lote: editando.value,
    p_modelo: edicao.modelo,
    p_cor: edicao.cor,
    p_sku: edicao.sku,
    p_fabricado_em: edicao.fabricado_em || null,
    p_quantidade: Number(edicao.quantidade),
  })
  // `error` é falha de rede ou permissão; `data.ok === false` é a regra de
  // negócio recusando. Os dois precisam aparecer, e com frases diferentes.
  if (error) { adminToast('Não consegui salvar agora', false); return }
  if (!data?.ok) { adminToast(fraseDaRecusa(data?.motivo, data), false); return }
  editando.value = null
  await carregar()
  adminToast('Lote atualizado')
}

// A confirmação de excluir NÃO é `confirm()` nativo — é proibido neste projeto,
// e `uiConfirm` não existe aqui. É um bloco de aviso na própria tela.
const excluindo = ref(null)

async function excluirLote(id) {
  const { data, error } = await sbClient.rpc('vessel_excluir_lote', { p_lote: id })
  if (error) { adminToast('Não consegui excluir agora', false); return }
  if (!data?.ok) { excluindo.value = null; adminToast(fraseDaRecusa(data?.motivo, data), false); return }
  excluindo.value = null
  await carregar()
  adminToast(`Lote excluído, com ${data.excluidas} etiqueta(s).`)
}
```

- [ ] **Passo 3: o template da aba Lotes**

Cada lote da lista ganha, quando `podeEditar`:

```html
<div class="au-lote-acoes">
  <button class="au-link" type="button" @click="abrirEdicao(l)">Editar</button>
  <button class="au-link" type="button" @click="excluindo = l.id">Excluir</button>
</div>

<!-- a pergunta de excluir, na propria tela -->
<div v-if="excluindo === l.id" class="au-confirma">
  <p>Excluir o lote <strong>{{ l.modelo }}</strong> e as {{ l.quantidade }} etiquetas dele?</p>
  <p class="au-aviso-menor">
    Só dá para excluir lote em que nenhuma etiqueta foi gravada. Se alguma já foi,
    a tela vai dizer quantas.
  </p>
  <div class="au-acoes">
    <button class="au-botao secundario" type="button" @click="excluindo = null">Cancelar</button>
    <button class="au-botao" type="button" @click="excluirLote(l.id)">Sim, excluir</button>
  </div>
</div>

<!-- o formulario de editar -->
<div v-if="editando === l.id" class="au-edicao">
  <label class="au-campo"><span class="au-rot">Modelo</span>
    <input v-model="edicao.modelo" type="text"></label>
  <label class="au-campo"><span class="au-rot">Cor</span>
    <input v-model="edicao.cor" type="text"></label>
  <label class="au-campo"><span class="au-rot">SKU</span>
    <input v-model="edicao.sku" type="text"></label>
  <label class="au-campo"><span class="au-rot">Fabricado em</span>
    <input v-model="edicao.fabricado_em" type="date"></label>
  <label class="au-campo"><span class="au-rot">Quantidade</span>
    <input v-model="edicao.quantidade" type="number" min="1" max="500"></label>
  <p class="au-aviso-menor">
    Aumentar cria etiquetas novas. Diminuir tira só as que ainda não foram gravadas.
  </p>
  <div class="au-acoes">
    <button class="au-botao secundario" type="button" @click="editando = null">Cancelar</button>
    <button class="au-botao" type="button" @click="salvarEdicao">Salvar</button>
  </div>
</div>
```

- [ ] **Passo 4: o CSS**

⚠️ Cor sai de token, nunca escrita à mão. Alvo de toque mínimo de 40px.

```css
.au-lote-acoes{display:flex; gap:var(--sp-3); margin-top:var(--sp-2)}
.au-lote-acoes .au-link{display:inline-flex; align-items:center; min-height:40px}
.au-edicao, .au-confirma{
  margin-top:var(--sp-2); padding:var(--sp-3);
  border:1px solid var(--border); border-radius:var(--radius-md);
  background:var(--surface2);
}
.au-aviso-menor{margin:var(--sp-2) 0; font-size:13px; line-height:1.45; color:var(--muted)}
/* o campo de digitar precisa de 16px, senao o iPhone DA ZOOM ao tocar nele */
.au-edicao input{min-height:40px; font-size:max(16px, 1rem)}
```

- [ ] **Passo 5: rodar a suíte e o build**

Rodar: `npm test` e `npm run build`
Esperado: PASSA. ⚠️ Se o total de testes CAIR abaixo de 3776, é arquivo sumindo
— investigue, nunca aceite como instabilidade.

- [ ] **Passo 6: medir a 375px num navegador de verdade**

`npm run dev -- --port 5199 --strictPort`, abrir `/autenticidade` a 375px e
conferir com os olhos, nos DOIS temas: os botões de editar e excluir cabem, o
formulário não estoura a largura, nenhum texto corta, e o bloco de confirmação
aparece embaixo do lote certo. Teste verde não é tela que abre.

- [ ] **Passo 7: commitar**

```bash
git add src/ferramentas/autenticidade/tela-de-autenticidade.vue
git commit -m "autenticidade: a aba Lotes ganha editar e excluir

A pergunta de excluir e um bloco na propria tela: confirm() nativo e proibido
neste projeto e uiConfirm nao existe aqui.

`error` e falha de rede ou permissao; `data.ok === false` e a regra de negocio
recusando. Os dois aparecem, com frases diferentes — sbClient.rpc NAO estoura,
e tratar so o error foi defeito real deste mesmo arquivo."
```

---

### Tarefa 6: A aba Gravar ganha baixar e desfazer, e Alertas ganha a linha nova

**Arquivos:**
- Modificar: `src/ferramentas/autenticidade/tela-de-autenticidade.vue`

**Interfaces:**
- Consome: `MOTIVOS_DE_BAIXA` e `fraseDaRecusa` de `./lotes.js` (já importados na
  tarefa 5); as funções `vessel_baixar_peca(p_codigo, p_motivo)` e
  `vessel_desfazer_baixa(p_codigo)`; e `vessel_alertas()` devolvendo
  `baixadas_lidas: [{codigo, motivo, leituras, ultima}]`.
- Produz: nada.

- [ ] **Passo 1: a tela passa a saber quais peças estão baixadas**

Em `carregar()`, junto das outras leituras, buscar as baixas ativas e marcar as
peças. A tela já lê `vessel_pecas` direto; `vessel_baixas` tem a mesma política
de SELECT, então lê do mesmo jeito:

```js
      sbClient.from('vessel_baixas').select('codigo,motivo,baixada_em').is('desfeita_em', null),
```

e, depois de carregar as peças:

```js
  // a peça carrega a baixa junto: é `baixada` que tira ela da fila de gravação
  const porCodigo = new Map((baixas.data || []).map((b) => [b.codigo, b]))
  pecas.value.forEach((p) => {
    const b = porCodigo.get(p.codigo)
    p.baixada = Boolean(b)
    p.baixa_motivo = b?.motivo || null
    p.baixada_em = b?.baixada_em || null
  })
```

- [ ] **Passo 2: baixar e desfazer**

```js
const baixando = ref(false)
const motivoDaBaixa = ref('extraviada')

async function baixarPeca(codigo) {
  const { data, error } = await sbClient.rpc('vessel_baixar_peca',
    { p_codigo: codigo, p_motivo: motivoDaBaixa.value })
  if (error) { adminToast('Não consegui dar baixa agora', false); return }
  if (!data?.ok) { adminToast(fraseDaRecusa(data?.motivo, data), false); return }
  baixando.value = false
  await carregar()
  const rotulo = (MOTIVOS_DE_BAIXA.find((m) => m.chave === motivoDaBaixa.value) || {}).rotulo
  adminToast(`Peça baixada como ${rotulo}. Ela sai da fila e continua respondendo para a cliente.`)
}

async function desfazerBaixa(codigo) {
  const { data, error } = await sbClient.rpc('vessel_desfazer_baixa', { p_codigo: codigo })
  if (error) { adminToast('Não consegui desfazer agora', false); return }
  if (!data?.ok) { adminToast(fraseDaRecusa(data?.motivo, data), false); return }
  await carregar()
  adminToast('Baixa desfeita. A peça voltou para a fila.')
}
```

- [ ] **Passo 3: o template**

Na aba Gravar, junto das ações da peça da vez:

```html
<button v-if="podeEditar && !gravando" class="au-link" type="button"
        @click="baixando = true">Dar baixa nesta peça</button>

<div v-if="baixando" class="au-confirma">
  <p>Dar baixa na peça {{ proxima.numero_na_serie }}?</p>
  <label class="au-campo"><span class="au-rot">Motivo</span>
    <select v-model="motivoDaBaixa">
      <option v-for="m in MOTIVOS_DE_BAIXA" :key="m.chave" :value="m.chave">{{ m.rotulo }}</option>
    </select>
  </label>
  <p class="au-aviso-menor">
    A peça sai da fila de gravação e continua respondendo normalmente para a cliente.
    Dá para desfazer depois.
  </p>
  <div class="au-acoes">
    <button class="au-botao secundario" type="button" @click="baixando = false">Cancelar</button>
    <button class="au-botao" type="button" @click="baixarPeca(proxima.codigo)">Dar baixa</button>
  </div>
</div>
```

E a lista das baixadas do lote, com desfazer:

```html
<details v-if="baixadasDoLote.length" class="au-mesa">
  <summary>{{ baixadasDoLote.length }} peça(s) baixada(s) neste lote</summary>
  <ul class="au-baixadas">
    <li v-for="p in baixadasDoLote" :key="p.codigo">
      <span>Peça {{ p.numero_na_serie }} — {{ rotuloDoMotivo(p.baixa_motivo) }}</span>
      <button v-if="podeEditar" class="au-link" type="button"
              @click="desfazerBaixa(p.codigo)">Desfazer</button>
    </li>
  </ul>
</details>
```

com, no script:

```js
const baixadasDoLote = computed(() => pecasDoLote(loteEscolhido.value)
  .filter((p) => p.baixada)
  .sort((a, b) => (a.numero_na_serie || 0) - (b.numero_na_serie || 0)))

function rotuloDoMotivo(chave) {
  return (MOTIVOS_DE_BAIXA.find((m) => m.chave === chave) || {}).rotulo || chave || '—'
}
```

- [ ] **Passo 4: a aba Alertas**

```html
<div v-if="alertas?.baixadas_lidas?.length" class="au-bloco">
  <h3 class="au-bloco-titulo">Peças baixadas que foram lidas</h3>
  <p class="au-aviso-menor">
    Estas peças estão baixadas e alguém encostou o celular nelas depois disso.
    Vale conferir onde a bolsa apareceu.
  </p>
  <ul class="au-baixadas">
    <li v-for="b in alertas.baixadas_lidas" :key="b.codigo">
      <span>{{ b.codigo }} — {{ rotuloDoMotivo(b.motivo) }} · {{ b.leituras }} leitura(s)</span>
      <span class="au-aviso-menor">{{ dataCurta(b.ultima) }}</span>
    </li>
  </ul>
</div>
```

- [ ] **Passo 5: o CSS**

```css
.au-baixadas{list-style:none; margin:var(--sp-2) 0 0; padding:0}
.au-baixadas li{
  display:flex; justify-content:space-between; align-items:center;
  gap:var(--sp-2); padding:var(--sp-1) 0; font-size:14px;
  border-bottom:1px solid var(--border);
}
.au-baixadas .au-link{min-height:40px; display:inline-flex; align-items:center}
.au-bloco{margin-top:var(--sp-4)}
.au-bloco-titulo{margin:0 0 var(--sp-1); font-size:16px}
```

- [ ] **Passo 6: rodar tudo e medir a 375px**

`npm test`, `npm run build`, e a tela a 375px nos dois temas.
⚠️ Piso de 3776 testes.

- [ ] **Passo 7: commitar**

```bash
git add src/ferramentas/autenticidade/tela-de-autenticidade.vue
git commit -m "autenticidade: dar baixa numa peca, desfazer, e o alerta de baixada lida

A peca carrega a baixa junto ao carregar, e e `baixada` que tira ela da fila.

O alerta existe porque a pagina da cliente nao avisa nada sobre baixa (decisao
do dono) — entao o painel avisa, usando as leituras que a pagina ja registra.
Assim o dono fica sabendo que a bolsa extraviada apareceu, sem incomodar quem
esta com ela."
```

---

### Tarefa 7: O LEIA-ME conta por que peça gravada não se exclui

**Arquivos:**
- Modificar: `src/ferramentas/autenticidade/LEIA-ME.txt`

- [ ] **Passo 1: escrever**

⚠️ O arquivo NÃO usa acentos, de propósito. Mantenha o padrão.

Acrescentar ao fim:

```
EXCLUIR, EDITAR E BAIXAR
========================

EXCLUIR SO O QUE NUNCA FOI GRAVADO. A pagina da cliente, diante de um codigo
que nao existe, diz "nao consta no nosso registro de pecas". Entao apagar uma
peca cuja etiqueta ja foi costurada dentro de uma bolsa faz a bolsa ORIGINAL
parecer falsa para quem comprou — e nao ha como desfazer, porque a etiqueta
esta dentro da bolsa.

Por isso peca gravada vira BAIXA, com motivo (extraviada, defeito, devolvida,
etiqueta perdida). O codigo continua respondendo normalmente para a cliente: a
pagina NAO MUDA, por decisao do dono. O que muda e que a peca sai da fila de
gravacao — senao a tela mandaria alguem gravar a etiqueta de uma peca dada como
refugo.

A BAIXA SE DESFAZ, e o historico guarda as duas coisas. Peca dada como
extraviada reaparece, e um clique errado nao pode ser definitivo numa peca que
ja esta com a cliente. Por isso e TABELA e nao coluna: com coluna, baixar de
novo depois de desfazer apagaria a baixa anterior.

A RECUSA MORA NO BANCO, nao na tela. A tela impedir nao basta: quem chama a
funcao direto passaria por cima. As funcoes de excluir se negam sozinhas quando
ha peca gravada, e dizem QUANTAS estao presas.

O ALERTA DE PECA BAIXADA LIDA existe porque a pagina nao avisa nada. Como ela
ja registra toda leitura, o painel avisa quando alguem encosta o celular numa
peca baixada — o dono fica sabendo que a bolsa extraviada apareceu, sem
incomodar quem esta com ela.

EDITAR: modelo, cor, SKU e data de fabricacao sao seguros a qualquer momento,
porque nao tocam em codigo nenhum. Aumentar a quantidade cria codigos novos
continuando a serie. Diminuir tira as NAO GRAVADAS de maior numero; abaixo do
que ja foi gravado, recusa.
```

- [ ] **Passo 2: conferir a suíte**

Rodar: `npm test` — piso de 3776.

- [ ] **Passo 3: commitar**

```bash
git add src/ferramentas/autenticidade/LEIA-ME.txt
git commit -m "autenticidade: o LEIA-ME conta por que peca gravada nao se exclui"
```

---

## Depois de tudo

**SUB-SKILL OBRIGATÓRIA:** `superpowers:finishing-a-development-branch`.

## O que este plano NÃO faz

A página da cliente (`vessel-brasil/verify/`) não muda — decisão do dono. E as
fotos automáticas do Bling são o Projeto 3.
