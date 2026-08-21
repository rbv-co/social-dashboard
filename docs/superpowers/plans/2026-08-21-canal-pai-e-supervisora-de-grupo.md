# Canal pai e supervisora de grupo — Plano de Implementação

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA: use `superpowers:subagent-driven-development` (recomendado) ou `superpowers:executing-plans` para implementar tarefa a tarefa. Os passos usam `- [ ]` para marcação.

**Objetivo:** o grupo do canal (Varejo / Atacado) vira o "pai" dos times de venda — card pai na Gestão de Usuários, supervisora cadastrada no pai valendo em todas as lojas do grupo, gestora e vendedora na loja.

**Arquitetura:** o grupo deixa de ser texto em `bling_lojas.grupo` e vira cadastro (`canais_grupos`), com o canal apontando por `grupo_id`. Quem supervisiona um grupo entra em `canais_grupos_membros`. Toda regra de acesso passa a ler **um** lugar que soma os vínculos diretos com os derivados do grupo — `meus_vinculos()` no banco e `vinculos-de-time.js` no navegador/edge.

**Stack:** Postgres/Supabase (RLS + SECURITY DEFINER), Deno (edge `bling-proxy`), Vue 3 + Vite, `node --test` para os módulos puros.

**Spec:** `docs/superpowers/specs/2026-08-21-canal-pai-e-supervisora-de-grupo-design.md` — leia antes da Tarefa 1.

**Worktree:** `~/iamundi-worktrees/canal-pai` · branch `feat/canal-pai-e-supervisora-de-grupo`

---

## Restrições globais

- **Português, sempre.** Nomes de arquivo em `kebab-case` português; comentários e texto de tela em português sem jargão. É o padrão do repositório.
- **`PADRAO-DA-CENTRAL.md` antes da primeira linha de tela.** Espaço por `--sp-*`, raio por `--radius-*`, cor por token (`var(--text)`, `var(--muted)`, `var(--border)`, `var(--surface)`, `var(--red)`, `var(--green)`). Nada de cor literal.
- **Fonte de campo:** `font-size: max(16px, calc(16px * var(--escala-texto, 1)))` em `select`/`input` — abaixo de 16px o iOS dá zoom. Alvo de dedo `min-height: 40px`.
- **Texto:** `font-size: max(9px, calc(Npx * var(--escala-texto, 1)))`, como o resto da tela.
- **Medir a 375px** e conferir contraste nos **dois temas**.
- **Falta de dado nunca amplia acesso.** Papel ausente vale como `vendedora`; lista ausente vale como "não amplia"; `escopo_por_equipe !== true` (nunca `=== false`).
- **`null` não é `[]`** em `canaisDoEscopo`: `null` = vê tudo, `[]` = não vê nada. Confundir os dois é o defeito que faz vendedora sem time ver a empresa inteira.
- **Nunca semear, limpar ou trocar senha de ninguém.** Prova de banco só dentro de `rollback`, com a trava **armada**.
- **Não commitar arquivo de pasta compartilhada com `git add <pasta>`** — sempre `git add <arquivo>`.
- **A edge não sobe com `git push`.** `supabase functions deploy bling-proxy --use-api` e **chamar a função depois** para provar que compilou.

---

## Estrutura de arquivos

**Criar:**

| Arquivo | Responsabilidade |
|---|---|
| `db/migrations/2026-08-21-canal-pai-e-supervisora-de-grupo.sql` | tabelas, `grupo_id`, espelho, funções e políticas |
| `supabase/functions/_shared/vinculos-de-time.js` | **a soma** dos vínculos (direto + grupo), pura |
| `supabase/functions/_shared/vinculos-de-time.test.mjs` | os testes dela |
| `src/compartilhado/vinculos-de-time.js` | ponte que só reexporta (o Deno não alcança `src/`) |
| `docs/provar-canal-pai.sql` | os cenários de banco, dentro de `rollback` |

**Modificar:**

| Arquivo | O que muda |
|---|---|
| `supabase/functions/_shared/grupo-do-canal.js` | passa a chavear por `grupo_id`, não pelo texto |
| `supabase/functions/_shared/grupo-do-canal.test.mjs` | idem |
| `supabase/functions/_shared/canais-de-venda-permitidos.js` | usa a soma + o 2º caminho do grupo |
| `supabase/functions/_shared/canais-de-venda-permitidos.test.mjs` | idem |
| `supabase/functions/bling-proxy/index.ts` | busca `canais_grupos_membros` e passa adiante |
| `src/ferramentas/gestao-a-vista/tela-de-gestao-a-vista.vue` | idem + o vazio que explica |
| `src/ferramentas/analise-vendas/tela-de-analise-vendas.vue` | idem |
| `src/ferramentas/admin/equipes.js` | papéis do time contra papéis de grupo |
| `src/ferramentas/admin/equipes.test.mjs` | idem |
| `src/ferramentas/admin/tela-de-admin.vue` | card pai + Canais de venda por lista |
| `src/ferramentas/gestao-comercial/time-de-vendas.vue` | a aba espelho acompanha |
| `docs/pendencias.md` | a dívida do espelho `bling_lojas.grupo` |

---

## Tarefa 1 — O banco ganha o cadastro de grupos (sem mexer em regra nenhuma)

**Por que sozinha:** ao fim desta tarefa **nada muda para ninguém**. As tabelas existem, os dados de hoje foram migrados, o espelho funciona — e nenhuma função de acesso foi tocada. É o passo que dá pra conferir sem risco.

**Arquivos:**
- Criar: `db/migrations/2026-08-21-canal-pai-e-supervisora-de-grupo.sql`

**Interfaces produzidas:**
- tabela `public.canais_grupos (id uuid, nome text, ordem int, ativo boolean, criado_em timestamptz)`
- coluna `public.bling_lojas.grupo_id uuid`
- tabela `public.canais_grupos_membros (id uuid, grupo_id uuid, profile_id uuid, papel text, concedido_por uuid, concedido_em timestamptz)`
- função `public.pode_ver_grupo(p_grupo uuid) returns boolean`

- [ ] **Passo 1: Medir o estado de hoje, para comparar depois**

```sql
select grupo, count(*) from public.bling_lojas group by grupo order by 1;
```

Esperado hoje: `Atacado 2`, `Varejo 8`, `null 4`. **Anote os números** — o Passo 5 confere contra eles.

- [ ] **Passo 2: Escrever a migration**

```sql
-- O CANAL PAI E A SUPERVISORA DO GRUPO (21/08/2026)
--
-- PEDIDO DO DONO: "o canal pai precisa ser o 'pai' dos times de vendas... a
-- supervisora fica a nível 'pai', gestora e vendedora fica a nível loja".
--
-- Em 20/08 o grupo nasceu como TEXTO em bling_lojas.grupo, e a justificativa
-- continua de pé: grupo novo é digitação na tela, não evento de engenharia.
-- Esta migration PRESERVA isso — criar grupo continua sendo digitar. O que muda
-- é que o texto passou a decidir ACESSO, e aí ele vira armadilha: trocar
-- "Varejo" por "Varejo Físico" em 3 dos 8 canais partiria o balde e tiraria 3
-- lojas da supervisora em silêncio. Grupo com identidade própria não parte.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. A LISTA DE GRUPOS

create table if not exists public.canais_grupos (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null,
  ordem      int not null default 0,
  ativo      boolean not null default true,
  criado_em  timestamptz not null default now()
);

-- É este índice que impede "Varejo", "varejo" e "Varejo " de virarem três
-- grupos que parecem um. A mesma normalização que normalizarGrupo() já faz no
-- JavaScript, agora garantida pelo banco e não pela boa vontade da tela.
create unique index if not exists canais_grupos_nome_unico
  on public.canais_grupos (lower(btrim(nome)));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. O CANAL APONTA PRO GRUPO

alter table public.bling_lojas
  add column if not exists grupo_id uuid references public.canais_grupos(id) on delete set null;

create index if not exists bling_lojas_grupo_id_idx on public.bling_lojas (grupo_id);

-- Os grupos que JÁ existem viram linha. NÃO adivinhar grupo pelo nome do canal:
-- adivinhar por nome é o defeito já catalogado do estoque.
insert into public.canais_grupos (nome)
select distinct btrim(grupo)
  from public.bling_lojas
 where nullif(btrim(grupo), '') is not null
on conflict do nothing;

update public.bling_lojas bl
   set grupo_id = g.id
  from public.canais_grupos g
 where lower(btrim(bl.grupo)) = lower(btrim(g.nome))
   and bl.grupo_id is null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. O ESPELHO DO TEXTO — dívida temporária, com data para sair
--
-- bling_lojas.grupo passa a ser CÓPIA. grupo_id é a verdade; ninguém escreve no
-- texto. Ele existe por um motivo só: no minuto do deploy há gente com a tela JÁ
-- ABERTA rodando o pacote anterior, e esse pacote lê o texto. Sem o espelho, o
-- seletor de canais dessas pessoas mostraria "Sem grupo" em tudo.
--
-- SÃO DOIS GATILHOS, e esquecer o segundo é o erro fácil: um quando o canal
-- troca de grupo, outro quando o GRUPO É RENOMEADO — que é justamente o caso que
-- motivou o cadastro existir.

create or replace function public.espelhar_grupo_do_canal()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  new.grupo := (select nome from public.canais_grupos where id = new.grupo_id);
  return new;
end;
$$;

drop trigger if exists trg_espelhar_grupo_do_canal on public.bling_lojas;
create trigger trg_espelhar_grupo_do_canal
  before insert or update of grupo_id on public.bling_lojas
  for each row execute function public.espelhar_grupo_do_canal();

create or replace function public.espelhar_rename_do_grupo()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.nome is distinct from old.nome then
    update public.bling_lojas set grupo = new.nome where grupo_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_espelhar_rename_do_grupo on public.canais_grupos;
create trigger trg_espelhar_rename_do_grupo
  after update on public.canais_grupos
  for each row execute function public.espelhar_rename_do_grupo();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. QUEM SUPERVISIONA QUAL GRUPO
--
-- MESMA FORMA de equipes_membros (vínculo · pessoa · papel · quem concedeu ·
-- quando), de propósito: é isso que faz a soma das duas origens ser uma linha de
-- SQL. concedido_por/concedido_em seguem equipes_permissoes, onde um booleano
-- perderia "quem deixou".
--
-- O check prende o papel em 'supervisora' porque é a decisão do dono: cada papel
-- tem um lugar só. Soltar é uma linha, no dia em que alguém pedir.

create table if not exists public.canais_grupos_membros (
  id            uuid primary key default gen_random_uuid(),
  grupo_id      uuid not null references public.canais_grupos(id) on delete cascade,
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  papel         text not null default 'supervisora' check (papel in ('supervisora')),
  concedido_por uuid references public.profiles(id),
  concedido_em  timestamptz not null default now(),
  unique (grupo_id, profile_id)
);

create index if not exists cgm_profile_idx on public.canais_grupos_membros (profile_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. RLS
--
-- SECURITY DEFINER pelo mesmo motivo das funções de 04/08: elas leem profiles e
-- as tabelas de vínculo de quem está perguntando, e a política que as chama pode
-- estar justamente sobre uma dessas tabelas. Sem isso a política se consulta em
-- círculo.

create or replace function public.pode_ver_grupo(p_grupo uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select
    coalesce((select is_superadmin from public.profiles where id = auth.uid()), false)
    or coalesce((select not escopo_por_equipe from public.profiles where id = auth.uid()), false)
    or exists (select 1 from public.canais_grupos_membros gm
                where gm.grupo_id = p_grupo and gm.profile_id = auth.uid());
$$;

alter table public.canais_grupos enable row level security;
alter table public.canais_grupos_membros enable row level security;

drop policy if exists canais_grupos_leitura on public.canais_grupos;
create policy canais_grupos_leitura on public.canais_grupos
  for select to authenticated using (true);

-- Escrita só de super-admin, igual à política que já protege bling_lojas.grupo.
drop policy if exists canais_grupos_escrever on public.canais_grupos;
create policy canais_grupos_escrever on public.canais_grupos
  for all to authenticated
  using (public.is_superadmin()) with check (public.is_superadmin());

-- Ninguém deixa de enxergar o PRÓPRIO vínculo — mesma forma de membros_leitura.
drop policy if exists cgm_leitura on public.canais_grupos_membros;
create policy cgm_leitura on public.canais_grupos_membros
  for select to authenticated
  using (profile_id = auth.uid() or public.pode_ver_grupo(grupo_id));

-- A REGRA DE OURO: ninguém concede o que não tem. A gestora da loja não pode
-- criar a própria chefe, então escrever aqui é só de super-admin.
drop policy if exists cgm_escrever on public.canais_grupos_membros;
create policy cgm_escrever on public.canais_grupos_membros
  for all to authenticated
  using (public.is_superadmin()) with check (public.is_superadmin());
```

- [ ] **Passo 3: Aplicar a migration**

Pelo MCP do Supabase (`apply_migration`), projeto `kounqtdoioootxqegkij`, nome `2026-08-21-canal-pai-e-supervisora-de-grupo`.

- [ ] **Passo 4: Provar que o espelho funciona nos dois sentidos, dentro de `rollback`**

```sql
begin;
  -- renomear o grupo tem de reescrever o texto de TODOS os canais dele
  update public.canais_grupos set nome = 'Varejo Teste' where lower(btrim(nome)) = 'varejo';
  select nome, grupo from public.bling_lojas
   where grupo_id = (select id from public.canais_grupos where nome = 'Varejo Teste') order by nome;
  -- esperado: os 8 canais com grupo = 'Varejo Teste'
rollback;
```

Depois, o outro sentido:

```sql
begin;
  update public.bling_lojas
     set grupo_id = (select id from public.canais_grupos where lower(btrim(nome)) = 'atacado')
   where nome = 'Institucional';
  select nome, grupo from public.bling_lojas where nome = 'Institucional';
  -- esperado: grupo = 'Atacado'
rollback;
```

- [ ] **Passo 5: Conferir que a migração dos dados bateu**

```sql
select
  (select count(*) from public.canais_grupos) as grupos,
  (select count(*) from public.bling_lojas where grupo_id is not null) as canais_ligados,
  (select count(*) from public.bling_lojas where grupo_id is null) as canais_sem_grupo,
  (select count(*) from public.bling_lojas where (grupo is null) <> (grupo_id is null)) as espelho_divergente;
```

Esperado: `grupos = 2` · `canais_ligados = 10` · `canais_sem_grupo = 4` · **`espelho_divergente = 0`**.

- [ ] **Passo 6: Commit**

```bash
git add db/migrations/2026-08-21-canal-pai-e-supervisora-de-grupo.sql
git commit -m "feat(times de venda): o grupo do canal vira cadastro, com espelho do texto antigo"
```

---

## Tarefa 2 — As regras do banco passam a somar os dois vínculos

**Por que separada da 1:** aqui as funções de acesso mudam. Com `canais_grupos_membros` **vazia** (é o estado de hoje), tudo deve responder exatamente o que responde agora — e é isso que o Passo 4 mede.

**Arquivos:**
- Modificar: `db/migrations/2026-08-21-canal-pai-e-supervisora-de-grupo.sql` (acrescentar ao fim)
- Criar: `docs/provar-canal-pai.sql`

**Interfaces consumidas:** `canais_grupos`, `canais_grupos_membros`, `bling_lojas.grupo_id` (Tarefa 1)

**Interfaces produzidas:**
- `public.meus_vinculos() returns table (equipe_id uuid, papel text)`
- `public.tenho_papel_na_equipe(p_equipe uuid, p_papeis text[]) returns boolean`

- [ ] **Passo 1: Confirmar que as funções de hoje executam**

```sql
select count(*) from public.bling_lojas bl where public.pode_ver_canal(bl.loja_id);
```

Isto roda como super-admin, então responde por *você* — serve só para confirmar que a função **executa sem erro** antes de ser substituída. A medição por pessoa é o Passo 5.

- [ ] **Passo 2: Escrever as funções**

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- 6. A SOMA, NUM LUGAR SÓ
--
-- Até aqui cada regra procurava a pessoa em equipes_membros por conta própria.
-- Se cada uma aprender o grupo do seu jeito, elas discordam — e duas regras
-- discordando sobre permissão é o defeito mais caro que este sistema produz.
--
-- O caminho 2 é o que faz LOJA NOVA ENTRAR SOZINHA: não há lista guardada, a
-- resposta é calculada na hora a partir de quem está no grupo.

create or replace function public.meus_vinculos()
returns table (equipe_id uuid, papel text)
language sql stable security definer set search_path to 'public' as $$
  select m.equipe_id, m.papel
    from public.equipes_membros m
   where m.profile_id = auth.uid()
  union
  select e.id, 'supervisora'
    from public.canais_grupos_membros gm
    join public.bling_lojas bl on bl.grupo_id = gm.grupo_id
    join public.equipes     e  on e.canal_loja_id = bl.loja_id
   where gm.profile_id = auth.uid()
     and gm.papel = 'supervisora';
$$;

-- A ARMADILHA QUE ESTA FUNÇÃO EXISTE PARA EVITAR:
--
-- Quem for gestora da loja Dom Pedro E supervisora do Varejo tem DOIS vínculos
-- com o mesmo time. meu_papel_na_equipe devolve UM papel — se devolver
-- 'supervisora', sou_gestor_da_equipe (que compara com 'gestor') vira false, e a
-- gestora PERDE, calada, o poder de administrar o próprio time. Por ter ganhado
-- um papel a mais.
--
-- Então toda regra de PODER pergunta "tenho este papel?", nunca "qual é o meu".
create or replace function public.tenho_papel_na_equipe(p_equipe uuid, p_papeis text[])
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.meus_vinculos() v
                  where v.equipe_id = p_equipe and v.papel = any(p_papeis));
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. AS REGRAS QUE PASSAM A LER A SOMA

create or replace function public.minhas_equipes()
returns setof uuid language sql stable security definer set search_path to 'public' as $$
  select equipe_id from public.meus_vinculos();
$$;

-- pode_ver_bem e pode_ver_equipe NÃO MUDAM: herdam de minhas_equipes(). Foi
-- conferido antes de escrever que minhas_equipes() é usada por exatamente três
-- funções — pode_ver_bem, pode_ver_canal, pode_ver_equipe — e por NENHUMA
-- política diretamente. As três são justamente as que devem alargar.

-- pode_ver_canal PRECISA DE DOIS CAMINHOS, e este é o ponto mais fácil de errar
-- do desenho inteiro:
--
-- Se o pai valesse só "pelas lojas de baixo", a supervisora do Varejo veria os
-- canais dos times do Varejo e PERDERIA os 6 canais do Varejo que não têm time
-- nenhum (Amazon Seller, Hortolândia, Shopify, Mercado Livre, Tik Tok, Varejo
-- Fábrica). Ela vê esses 6 HOJE, pela regra de 20/08. Seria um retrocesso do que
-- já está no ar, escondido dentro de uma melhoria.
create or replace function public.pode_ver_canal(p_canal bigint)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select
    coalesce((select is_superadmin from public.profiles where id = auth.uid()), false)
    or coalesce((select not escopo_por_equipe from public.profiles where id = auth.uid()), false)
    -- caminho 3: o canal é de um time meu
    or exists (select 1 from public.equipes e
                where e.canal_loja_id = p_canal
                  and e.id in (select public.minhas_equipes()))
    -- caminho 4: o canal é de um grupo que eu superviso — direto, sem time.
    -- Canal SEM grupo (grupo_id nulo) não amplia nada, e isso não pode virar
    -- "vê tudo" por omissão.
    or exists (select 1
                 from public.canais_grupos_membros gm
                 join public.bling_lojas alvo on alvo.grupo_id = gm.grupo_id
                where gm.profile_id = auth.uid()
                  and gm.papel = 'supervisora'
                  and alvo.loja_id = p_canal);
$$;

-- O ESTOQUE MANTÉM A REGRA PRÓPRIA E MAIS APERTADA, escrita de propósito:
-- "estar no time não basta" — ou você supervisiona, ou é gestora, ou alguém
-- liberou. O que muda é só que "supervisiona" passa a incluir quem supervisiona
-- pelo grupo.
create or replace function public.pode_ver_estoque(p_deposito bigint)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select
    coalesce((select is_superadmin from public.profiles where id = auth.uid()), false)
    or coalesce((select not escopo_por_equipe from public.profiles where id = auth.uid()), false)
    or exists (
      select 1 from public.equipes e
       where e.deposito_id = p_deposito
         and (public.tenho_papel_na_equipe(e.id, array['supervisora','gestor'])
              or exists (select 1 from public.equipes_permissoes p
                          where p.equipe_id = e.id and p.profile_id = auth.uid() and p.chave = 'estoque'))
    );
$$;

-- PODER, não leitura: continua exigindo 'gestor'. A supervisora tem alcance
-- largo de LEITURA e nenhum de PODER — ela não põe nem tira gente.
create or replace function public.sou_gestor_da_equipe(p_equipe uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce((select is_superadmin from public.profiles where id = auth.uid()), false)
      or public.tenho_papel_na_equipe(p_equipe, array['gestor']);
$$;

-- SÓ PARA FRASE DE TELA, com precedência declarada. NENHUMA decisão de acesso
-- passa mais por aqui — quem decide poder é tenho_papel_na_equipe.
create or replace function public.meu_papel_na_equipe(p_equipe uuid)
returns text language sql stable security definer set search_path to 'public' as $$
  select v.papel from public.meus_vinculos() v
   where v.equipe_id = p_equipe
   order by case v.papel when 'supervisora' then 1 when 'gestor' then 2 else 3 end
   limit 1;
$$;

-- A política de liberar estoque também para de comparar papel único.
drop policy if exists eqperm_escrever on public.equipes_permissoes;
create policy eqperm_escrever on public.equipes_permissoes
  for all to authenticated
  using (public.is_superadmin() or public.tenho_papel_na_equipe(equipe_id, array['supervisora','gestor']))
  with check (public.is_superadmin() or public.tenho_papel_na_equipe(equipe_id, array['supervisora','gestor']));
```

- [ ] **Passo 3: Aplicar**

Pelo MCP (`apply_migration`), nome `2026-08-21-canal-pai-regras`.

- [ ] **Passo 4: Provar que com a tabela vazia NADA mudou**

```sql
select
  (select count(*) from public.canais_grupos_membros) as supervisoras_de_grupo,
  (select count(*) from public.meus_vinculos()) as vinculos_do_superadmin;
```

Esperado: `supervisoras_de_grupo = 0`. Esta é a propriedade que torna a subida segura — com a tabela vazia, `meus_vinculos()` responde exatamente o que `equipes_membros` respondia.

- [ ] **Passo 5: Escrever `docs/provar-canal-pai.sql` e rodá-lo**

Espelhe o formato de `docs/provar-alcance-da-supervisora.sql`, que já existe. Tudo dentro de `begin; ... rollback;`, com a trava **armada** — desarmar a trava para o teste passar seria testar outra coisa.

Cenários obrigatórios, um bloco cada:

| quem | esperado |
|---|---|
| supervisora do Varejo | **8** canais do Varejo (inclusive os 6 sem time) · estoque das lojas do Varejo · patrimônio delas · `sou_gestor_da_equipe` = **false** |
| gestora da loja Dom Pedro | só o canal Dom Pedro · `sou_gestor_da_equipe` = **true** |
| gestora do Dom Pedro **que também é supervisora do Varejo** | vê o Varejo **e** `sou_gestor_da_equipe(Dom Pedro)` continua **true** |
| vendedora do Dom Pedro | só Dom Pedro · `pode_ver_estoque` = false |
| pessoa com limite ligado e sem vínculo | zero canais |
| **loja nova criada no Varejo dentro do `rollback`** | entra sozinha no alcance da supervisora |

Modelo de um bloco (repita mudando o papel e o esperado):

```sql
begin;
  set local role authenticated;
  set local request.jwt.claims to '{"sub":"<uuid da pessoa>","role":"authenticated"}';

  -- ainda sem vínculo: tem de ver ZERO
  select count(*) from public.bling_lojas bl where public.pode_ver_canal(bl.loja_id);

  set local role postgres;
  insert into public.canais_grupos_membros (grupo_id, profile_id)
  values ((select id from public.canais_grupos where lower(btrim(nome)) = 'varejo'), '<uuid da pessoa>');

  set local role authenticated;
  set local request.jwt.claims to '{"sub":"<uuid da pessoa>","role":"authenticated"}';
  -- agora tem de ver os 8 do Varejo, e SÓ eles
  select bl.nome from public.bling_lojas bl where public.pode_ver_canal(bl.loja_id) order by bl.nome;
  -- e NÃO administra time nenhum
  select public.sou_gestor_da_equipe((select id from public.equipes where nome = 'Dom Pedro'));
rollback;
```

- [ ] **Passo 6: Commit**

```bash
git add db/migrations/2026-08-21-canal-pai-e-supervisora-de-grupo.sql docs/provar-canal-pai.sql
git commit -m "feat(times de venda): as regras do banco somam o vinculo direto com o do grupo"
```

---

## Tarefa 3 — `vinculos-de-time.js`: a mesma soma, fora do banco

**Por que:** as duas dashboards de venda **não leem** as tabelas protegidas por RLS — elas leem o Bling ao vivo pela edge. A soma tem de existir dos dois lados, e numa cópia só.

**Arquivos:**
- Criar: `supabase/functions/_shared/vinculos-de-time.js`
- Criar: `supabase/functions/_shared/vinculos-de-time.test.mjs`
- Criar: `src/compartilhado/vinculos-de-time.js`

**Interfaces produzidas:**
- `vinculosDaPessoa({ meuId, membros, membrosDeGrupo, times, canais }) -> Array<{ equipe_id: string, papel: string }>`
- `gruposQueSupervisiono({ meuId, membrosDeGrupo }) -> Set<string>`

- [ ] **Passo 1: Escrever o teste que falha**

`supabase/functions/_shared/vinculos-de-time.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vinculosDaPessoa, gruposQueSupervisiono } from './vinculos-de-time.js';

// Medidos no banco em 21/08/2026.
const VAREJO = 'g-varejo';
const ATACADO = 'g-atacado';
const CANAIS = [
  { loja_id: 205657609, nome: 'Loja Dom Pedro', grupo_id: VAREJO },
  { loja_id: 205834140, nome: "Loja Santa Bárbara d'Oeste", grupo_id: VAREJO },
  { loja_id: 205680515, nome: 'Amazon Seller', grupo_id: VAREJO },
  { loja_id: 205451611, nome: 'Atacado Nuvem Shop', grupo_id: ATACADO },
  { loja_id: 205513121, nome: 'Institucional', grupo_id: null },
];
const TIMES = [
  { id: 't-dom-pedro', nome: 'Dom Pedro', canal_loja_id: 205657609 },
  { id: 't-tivoli', nome: 'Tivoli', canal_loja_id: 205834140 },
  { id: 't-atacado', nome: 'Atacado Nuvem Shop', canal_loja_id: 205451611 },
  { id: 't-iguatemi', nome: 'Iguatemi Campinas', canal_loja_id: null },
];
const papelEm = (v, id) => v.filter((x) => x.equipe_id === id).map((x) => x.papel).sort();

test('só time: devolve o vínculo direto e nada mais', () => {
  const v = vinculosDaPessoa({
    meuId: 'eu', times: TIMES, canais: CANAIS,
    membros: [{ equipe_id: 't-dom-pedro', profile_id: 'eu', papel: 'vendedora' }],
    membrosDeGrupo: [],
  });
  assert.deepEqual(v, [{ equipe_id: 't-dom-pedro', papel: 'vendedora' }]);
});

test('só grupo: supervisiona o Varejo e ganha os times das lojas do Varejo', () => {
  const v = vinculosDaPessoa({
    meuId: 'eu', times: TIMES, canais: CANAIS, membros: [],
    membrosDeGrupo: [{ grupo_id: VAREJO, profile_id: 'eu', papel: 'supervisora' }],
  });
  assert.deepEqual(v.map((x) => x.equipe_id).sort(), ['t-dom-pedro', 't-tivoli']);
  assert.ok(v.every((x) => x.papel === 'supervisora'));
});

// A ARMADILHA: gestora da loja E supervisora do grupo. Os dois papéis têm de
// sobreviver — senão ela perde, calada, o poder de administrar o próprio time.
test('os dois no mesmo time: gestora E supervisora, sem um comer o outro', () => {
  const v = vinculosDaPessoa({
    meuId: 'eu', times: TIMES, canais: CANAIS,
    membros: [{ equipe_id: 't-dom-pedro', profile_id: 'eu', papel: 'gestor' }],
    membrosDeGrupo: [{ grupo_id: VAREJO, profile_id: 'eu', papel: 'supervisora' }],
  });
  assert.deepEqual(papelEm(v, 't-dom-pedro'), ['gestor', 'supervisora']);
});

test('time sem canal não entra pelo grupo — não há canal para dizer de que grupo ele é', () => {
  const v = vinculosDaPessoa({
    meuId: 'eu', times: TIMES, canais: CANAIS, membros: [],
    membrosDeGrupo: [{ grupo_id: VAREJO, profile_id: 'eu', papel: 'supervisora' }],
  });
  assert.ok(!v.some((x) => x.equipe_id === 't-iguatemi'));
});

test('canal sem grupo não amplia nada', () => {
  const v = vinculosDaPessoa({
    meuId: 'eu', times: TIMES, canais: CANAIS, membros: [],
    membrosDeGrupo: [{ grupo_id: null, profile_id: 'eu', papel: 'supervisora' }],
  });
  assert.deepEqual(v, []);
});

// FALTA DE DADO NUNCA AMPLIA.
test('membrosDeGrupo ausente não amplia', () => {
  const v = vinculosDaPessoa({
    meuId: 'eu', times: TIMES, canais: CANAIS,
    membros: [{ equipe_id: 't-dom-pedro', profile_id: 'eu', papel: 'vendedora' }],
  });
  assert.deepEqual(v, [{ equipe_id: 't-dom-pedro', papel: 'vendedora' }]);
});

test('o vínculo de OUTRA pessoa não é meu', () => {
  const v = vinculosDaPessoa({
    meuId: 'eu', times: TIMES, canais: CANAIS,
    membros: [{ equipe_id: 't-dom-pedro', profile_id: 'outra', papel: 'gestor' }],
    membrosDeGrupo: [{ grupo_id: VAREJO, profile_id: 'outra', papel: 'supervisora' }],
  });
  assert.deepEqual(v, []);
});

// LOJA NOVA ENTRA SOZINHA: é a decisão do dono, e não há lista guardada.
test('loja nova no grupo entra sozinha, sem ninguém mexer no cadastro dela', () => {
  const timesDepois = TIMES.concat([{ id: 't-nova', nome: 'Loja Nova', canal_loja_id: 205680515 }]);
  const v = vinculosDaPessoa({
    meuId: 'eu', times: timesDepois, canais: CANAIS, membros: [],
    membrosDeGrupo: [{ grupo_id: VAREJO, profile_id: 'eu', papel: 'supervisora' }],
  });
  assert.ok(v.some((x) => x.equipe_id === 't-nova' && x.papel === 'supervisora'));
});

test('gruposQueSupervisiono devolve só os meus, e ignora papel que não é supervisora', () => {
  const g = gruposQueSupervisiono({
    meuId: 'eu',
    membrosDeGrupo: [
      { grupo_id: VAREJO, profile_id: 'eu', papel: 'supervisora' },
      { grupo_id: ATACADO, profile_id: 'outra', papel: 'supervisora' },
      { grupo_id: ATACADO, profile_id: 'eu', papel: 'vendedora' },
    ],
  });
  assert.deepEqual([...g], [VAREJO]);
});

test('meuId ausente não devolve vínculo nenhum', () => {
  assert.deepEqual(vinculosDaPessoa({ times: TIMES, canais: CANAIS, membros: [], membrosDeGrupo: [] }), []);
});
```

- [ ] **Passo 2: Rodar e ver falhar**

```bash
node --test supabase/functions/_shared/vinculos-de-time.test.mjs
```

Esperado: FALHA com `Cannot find module './vinculos-de-time.js'`.

- [ ] **Passo 3: Escrever o módulo**

`supabase/functions/_shared/vinculos-de-time.js`:

```js
// EM QUAIS TIMES EU ESTOU, E COMO — somando as DUAS origens.
//
// PEDIDO DO DONO (21/08/2026): "o canal pai precisa ser o 'pai' dos times de
// vendas... a supervisora fica a nível 'pai', gestora e vendedora fica a nível
// loja."
//
// Duas origens: o time onde a pessoa foi cadastrada (`equipes_membros`) e o
// GRUPO que ela supervisiona (`canais_grupos_membros`), que vale nas lojas de
// todos os canais daquele grupo.
//
// É o gêmeo de `public.meus_vinculos()` no banco. Existe aqui porque as duas
// dashboards de venda NÃO leem as tabelas protegidas por RLS: elas leem o Bling
// ao vivo pela edge `bling-proxy`, e a edge roda no Deno, que não alcança
// `src/`. Uma regra, dois lugares que a leem, zero cópias.
//
// PURO de propósito: quem enxerga o quê é a coisa mais cara de errar aqui, e
// precisa poder ser provada sem navegador.

const eq = (a, b) => String(a) === String(b);

// Os grupos que EU superviso. Papel que não é 'supervisora' não conta — hoje o
// banco só aceita esse, mas a regra não pode depender disso para estar certa.
export function gruposQueSupervisiono({ meuId, membrosDeGrupo }) {
  const out = new Set();
  if (!meuId) return out;
  for (const g of membrosDeGrupo || []) {
    if (!g || !eq(g.profile_id, meuId)) continue;
    if (String(g.papel || '') !== 'supervisora') continue;
    if (g.grupo_id === null || g.grupo_id === undefined || g.grupo_id === '') continue;
    out.add(String(g.grupo_id));
  }
  return out;
}

// A SOMA. Devolve uma linha por (time, papel) — e uma pessoa PODE ter duas no
// mesmo time: gestora da loja e supervisora do grupo.
//
// NÃO reduzir isso a "um papel por time": quem for gestora do Dom Pedro E
// supervisora do Varejo perderia, calada, o poder de administrar o próprio time
// se o papel do grupo comesse o papel da loja.
export function vinculosDaPessoa({ meuId, membros, membrosDeGrupo, times, canais }) {
  if (!meuId) return [];
  const vistos = new Set();
  const out = [];
  const por = (equipeId, papel) => {
    const chave = String(equipeId) + ' ' + papel;
    if (vistos.has(chave)) return;
    vistos.add(chave);
    out.push({ equipe_id: String(equipeId), papel });
  };

  // 1. os times onde eu fui cadastrada. Papel ausente vale como 'vendedora':
  // se o select esquecer a coluna, o certo é NÃO ampliar.
  for (const m of membros || []) {
    if (!m || !eq(m.profile_id, meuId)) continue;
    if (m.equipe_id === null || m.equipe_id === undefined || m.equipe_id === '') continue;
    por(m.equipe_id, String(m.papel || 'vendedora'));
  }

  // 2. os times das lojas do grupo que eu superviso.
  const meusGrupos = gruposQueSupervisiono({ meuId, membrosDeGrupo });
  if (meusGrupos.size) {
    const grupoDoCanal = new Map();
    for (const c of canais || []) {
      if (c == null || c.loja_id === undefined || c.loja_id === null) continue;
      if (c.grupo_id === null || c.grupo_id === undefined || c.grupo_id === '') continue;
      grupoDoCanal.set(String(c.loja_id), String(c.grupo_id));
    }
    for (const t of times || []) {
      if (t == null || t.id === undefined || t.id === null) continue;
      // Time sem canal não tem como dizer de que grupo é — e falta de dado
      // nunca pode dar acesso a mais.
      if (t.canal_loja_id === null || t.canal_loja_id === undefined || t.canal_loja_id === '') continue;
      const g = grupoDoCanal.get(String(t.canal_loja_id));
      if (g && meusGrupos.has(g)) por(t.id, 'supervisora');
    }
  }

  return out;
}
```

- [ ] **Passo 4: Rodar e ver passar**

```bash
node --test supabase/functions/_shared/vinculos-de-time.test.mjs
```

Esperado: **10 testes passando**.

- [ ] **Passo 5: A ponte para as telas**

`src/compartilhado/vinculos-de-time.js`:

```js
// A ponte entre as TELAS e a soma dos vínculos de time.
//
// A REGRA em si mora em `supabase/functions/_shared/vinculos-de-time.js`, porque
// a edge `bling-proxy` também precisa dela e roda no Deno, que não alcança
// `src/`. Mesmo arranjo de `grupo-do-canal.js` e `canais-de-venda-permitidos.js`,
// pelo mesmo motivo: duas cópias da mesma regra acabam discordando.
//
// Aqui não há lógica nenhuma de propósito.
export {
  vinculosDaPessoa,
  gruposQueSupervisiono,
} from '../../supabase/functions/_shared/vinculos-de-time.js'
```

- [ ] **Passo 6: Commit**

```bash
git add supabase/functions/_shared/vinculos-de-time.js supabase/functions/_shared/vinculos-de-time.test.mjs src/compartilhado/vinculos-de-time.js
git commit -m "feat(times de venda): a soma dos vinculos (time + grupo) num modulo puro"
```

---

## Tarefa 4 — `grupo-do-canal.js` passa a chavear por `grupo_id`

**Por que:** o grupo agora tem identidade. Continuar agrupando pelo texto manteria a armadilha que a Tarefa 1 foi feita para fechar — dois canais do mesmo grupo com grafia diferente voltariam a virar dois baldes.

**Arquivos:**
- Modificar: `supabase/functions/_shared/grupo-do-canal.js`
- Modificar: `supabase/functions/_shared/grupo-do-canal.test.mjs`
- Modificar: `src/compartilhado/grupo-do-canal.js` (a lista de reexports)

**Interfaces consumidas:** `canais_grupos` (Tarefa 1)

**Interfaces produzidas** (assinaturas que as Tarefas 7, 9 e 10 usam):
- `agruparCanais(canais, grupos) -> Array<{ grupo: {id, nome}|null, canais: [] }>`
- `agruparTimesPorGrupo(times, canais, grupos) -> Array<{ grupo: {id, nome}|null, times: [] }>`
- `contarSemGrupo(canais) -> number`
- `estadoDoGrupo(canaisDoGrupo, selecionados)` e `alternarGrupo(canaisDoGrupo, selecionados)` — **inalteradas**
- `timePorCanal(times)` — **inalterada**
- `normalizarGrupo(texto)` e `mesmoGrupo(a, b)` — **permanecem**, agora só para comparar o NOME que a pessoa digita ao criar grupo
- `gruposExistentes` — **removida** (lia o texto)

- [ ] **Passo 1: Ajustar o teste primeiro**

Trocar os dados de exemplo para carregarem `grupo_id` e acrescentar a lista de grupos:

```js
const GRUPOS = [
  { id: 'g-atacado', nome: 'Atacado', ordem: 0, ativo: true },
  { id: 'g-varejo', nome: 'Varejo', ordem: 0, ativo: true },
];
const CANAIS = [
  { loja_id: 205451611, nome: 'Atacado Nuvem Shop', grupo_id: 'g-atacado' },
  { loja_id: 205657609, nome: 'Loja Dom Pedro', grupo_id: 'g-varejo' },
  { loja_id: 205834140, nome: "Loja Santa Bárbara d'Oeste", grupo_id: 'g-varejo' },
  { loja_id: 205395333, nome: 'Atacado Fábrica', grupo_id: null },
];
```

E acrescentar os testes que provam o motivo da mudança:

```js
test('grafia diferente NÃO parte mais o balde — o grupo tem identidade', () => {
  const grupos = [{ id: 'g-varejo', nome: 'Varejo' }];
  const canais = [
    { loja_id: 1, nome: 'a', grupo_id: 'g-varejo' },
    { loja_id: 2, nome: 'b', grupo_id: 'g-varejo' },
  ];
  const baldes = agruparCanais(canais, grupos);
  assert.equal(baldes.length, 1);
  assert.equal(baldes[0].grupo.nome, 'Varejo');
  assert.equal(baldes[0].canais.length, 2);
});

test('canal sem grupo vai para o balde do fim, e o balde só existe se tiver gente', () => {
  const grupos = [{ id: 'g-varejo', nome: 'Varejo' }];
  assert.equal(agruparCanais([{ loja_id: 1, grupo_id: 'g-varejo' }], grupos).length, 1);
  const com = agruparCanais([{ loja_id: 1, grupo_id: 'g-varejo' }, { loja_id: 2, grupo_id: null }], grupos);
  assert.equal(com.length, 2);
  assert.equal(com[1].grupo, null);
});

test('grupo que não tem canal nenhum não vira cabeçalho vazio', () => {
  const grupos = [{ id: 'g-varejo', nome: 'Varejo' }, { id: 'g-vazio', nome: 'Marketplace' }];
  const baldes = agruparCanais([{ loja_id: 1, grupo_id: 'g-varejo' }], grupos);
  assert.deepEqual(baldes.map((b) => b.grupo && b.grupo.nome), ['Varejo']);
});

test('nenhum time some: sem canal e com canal sem grupo caem juntos no fim', () => {
  const grupos = [{ id: 'g-varejo', nome: 'Varejo' }];
  const canais = [{ loja_id: 1, grupo_id: 'g-varejo' }, { loja_id: 2, grupo_id: null }];
  const times = [
    { id: 'a', canal_loja_id: 1 },
    { id: 'b', canal_loja_id: 2 },
    { id: 'c', canal_loja_id: null },
  ];
  const baldes = agruparTimesPorGrupo(times, canais, grupos);
  assert.deepEqual(baldes.map((b) => b.times.map((t) => t.id)), [['a'], ['b', 'c']]);
});
```

- [ ] **Passo 2: Rodar e ver falhar**

```bash
node --test supabase/functions/_shared/grupo-do-canal.test.mjs
```

Esperado: FALHA — `agruparCanais` ainda lê `c.grupo` e devolve o nome como texto, não `{id, nome}`.

- [ ] **Passo 3: Reescrever as funções de balde**

```js
// A ORDEM dos baldes: pela `ordem` do cadastro, e o nome desempata.
function _ordenarGrupos(grupos) {
  return (grupos || []).slice().sort((a, b) => {
    const ao = Number(a && a.ordem) || 0;
    const bo = Number(b && b.ordem) || 0;
    if (ao !== bo) return ao - bo;
    return String((a && a.nome) || '').localeCompare(String((b && b.nome) || ''), 'pt-BR');
  });
}

export function agruparCanais(canais, grupos) {
  const lista = canais || [];
  const baldes = [];
  for (const g of _ordenarGrupos(grupos)) {
    const dele = lista.filter((c) => c && c.grupo_id != null && String(c.grupo_id) === String(g.id));
    // Cabeçalho sem canal embaixo NÃO nasce: um grupo recém-criado viraria um
    // título vazio na tela.
    if (dele.length) baldes.push({ grupo: g, canais: dele });
  }
  // O balde SEM GRUPO vai por ÚLTIMO e só existe se tiver gente dentro: canal
  // sem grupo não pode sumir da lista, mas cabeçalho vazio não ajuda ninguém.
  const orfaos = lista.filter((c) => !c || c.grupo_id == null || c.grupo_id === '');
  if (orfaos.length) baldes.push({ grupo: null, canais: orfaos });
  return baldes;
}

export function agruparTimesPorGrupo(times, canais, grupos) {
  const lista = times || [];
  if (!lista.length) return [];
  const grupoDoCanal = new Map();
  for (const c of canais || []) {
    if (c == null || c.loja_id == null) continue;
    if (c.grupo_id == null || c.grupo_id === '') continue;
    grupoDoCanal.set(String(c.loja_id), String(c.grupo_id));
  }
  // O time NÃO tem grupo próprio: herda do canal a que está amarrado.
  const doTime = (t) => {
    if (!t || t.canal_loja_id == null || t.canal_loja_id === '') return null;
    return grupoDoCanal.get(String(t.canal_loja_id)) || null;
  };
  const baldes = [];
  for (const g of _ordenarGrupos(grupos)) {
    const dele = lista.filter((t) => doTime(t) === String(g.id));
    if (dele.length) baldes.push({ grupo: g, times: dele });
  }
  // Time sem canal (loja que ainda vai abrir) e time cujo canal está sem grupo
  // caem juntos no balde do fim. NENHUM time pode sumir da gestão de usuários.
  const orfaos = lista.filter((t) => doTime(t) === null);
  if (orfaos.length) baldes.push({ grupo: null, times: orfaos });
  return baldes;
}

export function contarSemGrupo(canais) {
  return (canais || []).filter((c) => !c || c.grupo_id == null || c.grupo_id === '').length;
}
```

Remover `gruposExistentes` e tirá-la também do `export` de `src/compartilhado/grupo-do-canal.js`.

- [ ] **Passo 4: Rodar e ver passar**

```bash
node --test supabase/functions/_shared/grupo-do-canal.test.mjs
```

- [ ] **Passo 5: Commit**

```bash
git add supabase/functions/_shared/grupo-do-canal.js supabase/functions/_shared/grupo-do-canal.test.mjs src/compartilhado/grupo-do-canal.js
git commit -m "refactor(grupo do canal): agrupar por identidade do grupo, nao pelo texto"
```

---

## Tarefa 5 — `canais-de-venda-permitidos.js` usa a soma e ganha o 2º caminho

**Arquivos:**
- Modificar: `supabase/functions/_shared/canais-de-venda-permitidos.js`
- Modificar: `supabase/functions/_shared/canais-de-venda-permitidos.test.mjs`

**Interfaces consumidas:** `vinculosDaPessoa`, `gruposQueSupervisiono` (Tarefa 3)

**Interfaces produzidas:**
- `canaisDoEscopo({ isSuperadmin, escopoPorEquipe, meuId, times, membros, membrosDeGrupo, canais }) -> number[] | null`

- [ ] **Passo 1: Escrever os testes novos**

Acrescentar aos que já existem, **sem apagar nenhum** — eles são a prova de que ninguém regrediu:

```js
test('supervisora do grupo vê os canais do grupo INCLUSIVE os que não têm time', () => {
  const canais = canaisDoEscopo({
    isSuperadmin: false, escopoPorEquipe: true, meuId: 'eu',
    times: [{ id: 't-dom-pedro', canal_loja_id: 205657609 }],
    membros: [],
    membrosDeGrupo: [{ grupo_id: 'g-varejo', profile_id: 'eu', papel: 'supervisora' }],
    canais: [
      { loja_id: 205657609, grupo_id: 'g-varejo' },   // tem time
      { loja_id: 205680515, grupo_id: 'g-varejo' },   // Amazon: SEM time
      { loja_id: 205451611, grupo_id: 'g-atacado' },  // outro grupo
    ],
  });
  assert.deepEqual([...canais].sort(), [205657609, 205680515]);
});

test('vendedora do time NÃO ganha o grupo junto', () => {
  const canais = canaisDoEscopo({
    isSuperadmin: false, escopoPorEquipe: true, meuId: 'eu',
    times: [{ id: 't-dom-pedro', canal_loja_id: 205657609 }],
    membros: [{ equipe_id: 't-dom-pedro', profile_id: 'eu', papel: 'vendedora' }],
    membrosDeGrupo: [],
    canais: [{ loja_id: 205657609, grupo_id: 'g-varejo' }, { loja_id: 205680515, grupo_id: 'g-varejo' }],
  });
  assert.deepEqual(canais, [205657609]);
});

test('canal sem grupo não amplia, e não vira "vê tudo"', () => {
  const canais = canaisDoEscopo({
    isSuperadmin: false, escopoPorEquipe: true, meuId: 'eu',
    times: [], membros: [],
    membrosDeGrupo: [{ grupo_id: 'g-varejo', profile_id: 'eu', papel: 'supervisora' }],
    canais: [{ loja_id: 205513121, grupo_id: null }],
  });
  assert.deepEqual(canais, []);
  assert.notEqual(canais, null);
});

test('membrosDeGrupo ausente não amplia — falta de dado nunca dá acesso a mais', () => {
  const canais = canaisDoEscopo({
    isSuperadmin: false, escopoPorEquipe: true, meuId: 'eu',
    times: [{ id: 't-dom-pedro', canal_loja_id: 205657609 }],
    membros: [{ equipe_id: 't-dom-pedro', profile_id: 'eu', papel: 'vendedora' }],
    canais: [{ loja_id: 205657609, grupo_id: 'g-varejo' }, { loja_id: 205680515, grupo_id: 'g-varejo' }],
  });
  assert.deepEqual(canais, [205657609]);
});
```

- [ ] **Passo 2: Rodar e ver falhar**

```bash
node --test supabase/functions/_shared/canais-de-venda-permitidos.test.mjs
```

- [ ] **Passo 3: Reescrever `canaisDoEscopo`**

Trocar `import { normalizarGrupo } from './grupo-do-canal.js';` por `import { vinculosDaPessoa, gruposQueSupervisiono } from './vinculos-de-time.js';` e substituir o corpo. **Manter os três primeiros `if` exatamente como estão** — são a distinção `null` contra `[]`, que já tem teste.

```js
export function canaisDoEscopo({ isSuperadmin, escopoPorEquipe, meuId, times, membros, membrosDeGrupo, canais }) {
  if (isSuperadmin) return null;
  // `!== true` e não `=== false`: coluna ausente na consulta não pode virar
  // "vê tudo" por omissão.
  if (escopoPorEquipe !== true) return null;
  if (!meuId) return [];

  const ids = [];

  // CAMINHO 1 — os canais dos times onde eu tenho vínculo (direto OU pelo grupo).
  const vinculos = vinculosDaPessoa({ meuId, membros, membrosDeGrupo, times, canais });
  const meusTimes = new Set(vinculos.map((v) => String(v.equipe_id)));
  for (const t of times || []) {
    if (!t || !meusTimes.has(String(t.id))) continue;
    // Time sem canal do Bling não some nem vira "vê tudo": ele simplesmente não
    // acrescenta canal. Quem está só nele fica com `[]`, e a tela diz o motivo.
    if (t.canal_loja_id === null || t.canal_loja_id === undefined || t.canal_loja_id === '') continue;
    ids.push(Number(t.canal_loja_id));
  }

  // CAMINHO 2 — os canais do GRUPO que eu superviso, DIRETO, sem passar por time.
  //
  // Este caminho não é redundância do primeiro: sem ele a supervisora perderia
  // os 6 canais do Varejo que não têm time nenhum (Amazon Seller, Hortolândia,
  // Shopify, Mercado Livre, Tik Tok, Varejo Fábrica) — canais que ela JÁ enxerga
  // desde 20/08. Seria um retrocesso escondido dentro de uma melhoria.
  const meusGrupos = gruposQueSupervisiono({ meuId, membrosDeGrupo });
  if (meusGrupos.size) {
    for (const c of canais || []) {
      if (c == null || c.loja_id === undefined || c.loja_id === null) continue;
      if (c.grupo_id === null || c.grupo_id === undefined || c.grupo_id === '') continue;
      if (meusGrupos.has(String(c.grupo_id))) ids.push(Number(c.loja_id));
    }
  }

  return [...new Set(ids)];
}
```

- [ ] **Passo 4: Rodar a suíte inteira dos módulos compartilhados**

```bash
node --test supabase/functions/_shared/*.test.mjs
```

Esperado: **todos passando**, inclusive os antigos. Se algum antigo quebrou, **não conserte o teste** — o teste antigo é a asserção de que ninguém regrediu; conserte o código.

- [ ] **Passo 5: Commit**

```bash
git add supabase/functions/_shared/canais-de-venda-permitidos.js supabase/functions/_shared/canais-de-venda-permitidos.test.mjs
git commit -m "feat(canais): a supervisora do grupo pelos dois caminhos, sem perder canal sem time"
```

---

## Tarefa 6 — A tranca: a edge `bling-proxy`

**Por que antes das telas:** o front é público. Enquanto o recorte existir só na tela, quem souber usar o console continua pedindo tudo à edge. A tranca vai antes.

**Arquivos:**
- Modificar: `supabase/functions/bling-proxy/index.ts:147-175`

**Interfaces consumidas:** `canaisDoEscopo` com `membrosDeGrupo` (Tarefa 5)

- [ ] **Passo 1: Buscar a tabela nova e passar adiante**

```ts
    let times: { id: string; canal_loja_id: number | null }[] = [];
    let membros: { equipe_id: string; profile_id: string; papel?: string }[] = [];
    let membrosDeGrupo: { grupo_id: string; profile_id: string; papel?: string }[] = [];
    let canaisDoBling: { loja_id: number; grupo_id: string | null }[] = [];
    if (prof.escopo_por_equipe === true) {
      const { data: m } = await sb.from('equipes_membros').select('equipe_id, profile_id, papel').eq('profile_id', user.id);
      membros = m || [];
      // O VÍNCULO PELO GRUPO (21/08/2026): sem ele a supervisora do grupo é
      // tratada como quem não tem time, e a edge devolveria MENOS do que a tela
      // mostra — as duas contando histórias diferentes sobre a mesma pessoa.
      const { data: gm } = await sb.from('canais_grupos_membros').select('grupo_id, profile_id, papel').eq('profile_id', user.id);
      membrosDeGrupo = gm || [];
      // TODOS os times, não só os meus: o vínculo pelo grupo é descoberto
      // cruzando o canal do time com o grupo que eu superviso, então filtrar
      // pelos ids de `membros` ANTES esconderia justamente os times que o grupo
      // me dá. São 4 linhas.
      const { data: t } = await sb.from('equipes').select('id, canal_loja_id');
      times = t || [];
      // TODOS os canais com o grupo deles. São 14 linhas.
      const { data: c } = await sb.from('bling_lojas').select('loja_id, grupo_id');
      canaisDoBling = c || [];
    }
    const canais = canaisDoEscopo({
      isSuperadmin: !!prof.is_superadmin,
      escopoPorEquipe: prof.escopo_por_equipe === true,
      meuId: user.id,
      times,
      membros,
      membrosDeGrupo,
      canais: canaisDoBling,
    });
```

> **A mudança na leitura de `equipes` é obrigatória.** Hoje a edge busca só os times cujos ids estão em `membros` (`.in('id', ids)`). Com o vínculo pelo grupo, o time chega **pelo canal**, não por `membros` — manter o filtro antigo faria a supervisora do grupo receber lista vazia e ver zero.

- [ ] **Passo 2: Subir a edge**

```bash
supabase functions deploy bling-proxy --use-api --project-ref kounqtdoioootxqegkij
```

- [ ] **Passo 3: CHAMAR a função, para provar que compilou**

Subir não prova nada — já houve caso de uma variável repetida derrubar a `bling-proxy` depois de um deploy "bem-sucedido".

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  "https://kounqtdoioootxqegkij.supabase.co/functions/v1/bling-proxy" \
  -H "Content-Type: application/json" -d '{"endpoint":"produtos"}'
```

Esperado: **401** — sem sessão de usuário, e isso já prova que a função **subiu e está executando**. Um **500** ou **503** quer dizer que ela não compilou: **volte a versão anterior imediatamente**.

- [ ] **Passo 4: Commit**

```bash
git add supabase/functions/bling-proxy/index.ts
git commit -m "feat(bling-proxy): a tranca enxerga o vinculo pelo grupo"
```

---

## Tarefa 7 — As duas telas de venda

**Arquivos:**
- Modificar: `src/ferramentas/gestao-a-vista/tela-de-gestao-a-vista.vue:655-685`
- Modificar: `src/ferramentas/analise-vendas/tela-de-analise-vendas.vue:388-415`

- [ ] **Passo 1: Gestão à Vista — buscar grupos e membros de grupo**

Trocar o `select` de `bling_lojas` para `loja_id,nome,grupo_id` e acrescentar duas leituras ao `Promise.all`:

```js
      sbClient.from('bling_lojas').select('loja_id,nome,grupo_id').then(r=>{const mp={};_gvGrupoDoCanal={};_gvCanaisBrutos=r.data||[];_gvCanaisBrutos.forEach(l=>{mp[l.loja_id]=l.nome;_gvGrupoDoCanal[l.loja_id]=l.grupo_id||null;});return mp;}).catch(()=>({})),
      // A LISTA DE GRUPOS, para o menu de canais desenhar os baldes com nome.
      sbClient.from('canais_grupos').select('id,nome,ordem,ativo').then(r=>{_gvGrupos=r.data||[];return _gvGrupos;}).catch(()=>{_gvGrupos=[];return [];}),
      // Quem supervisiona qual grupo. Falhar devolve lista vazia — e lista vazia
      // NÃO amplia, que é o lado seguro do erro.
      sbClient.from('canais_grupos_membros').select('grupo_id,profile_id,papel').then(r=>r.data||[]).catch(()=>[])
```

E passar adiante:

```js
    const meusCanais=canaisDoEscopo({
      isSuperadmin:estado.is_superadmin,
      escopoPorEquipe:estado.escopo_por_equipe,
      meuId:estado.userId,
      times:eqTimes,membros:eqMembros,membrosDeGrupo:eqMembrosDeGrupo,
      canais:_gvCanaisBrutos,
    });
```

Ajustar as chamadas de `agruparCanais(...)` no menu de canais para passar `_gvGrupos` como 2º argumento, e o rótulo do balde para ler `balde.grupo.nome` (era texto, agora é objeto). Balde sem grupo continua indo para **Outros**.

- [ ] **Passo 2: Análise de Vendas — a mesma mudança**

Repetir em `tela-de-analise-vendas.vue`, sobre `_saCanaisBrutos` / `_saGrupos`. **Repetir, não "fazer igual à outra"** — as duas telas têm variáveis próprias, e trocar uma pela outra é o tipo de engano que passa em revisão.

- [ ] **Passo 3: Build**

```bash
npm run build
```

Esperado: build sem erro. **Build passando não é tela abrindo** — abrir é a Tarefa 9, Passo 6.

- [ ] **Passo 4: Rodar os guardas**

```bash
node --test src/compartilhado/imports.test.mjs src/ferramentas/admin/ligacoes-da-tela.test.mjs
```

Esses dois pegam o import que nunca entrou e o controle desenhado sem quem o escute — os dois defeitos que já custaram uma tarde e dois meses neste repositório.

- [ ] **Passo 5: Commit**

```bash
git add src/ferramentas/gestao-a-vista/tela-de-gestao-a-vista.vue src/ferramentas/analise-vendas/tela-de-analise-vendas.vue
git commit -m "feat(vendas): as duas dashboards enxergam o vinculo pelo grupo"
```

---

## Tarefa 8 — `admin/equipes.js`: papel de time contra papel de grupo

**Arquivos:**
- Modificar: `src/ferramentas/admin/equipes.js:17-45` e `avisosDoTime`
- Modificar: `src/ferramentas/admin/equipes.test.mjs`

**Interfaces produzidas:**
- `PAPEIS` — agora só os do **time**: `vendedora` (nível 1), `gestor` (nível 2)
- `PAPEIS_DE_GRUPO` — `supervisora`
- `rotuloDoPapel(id) -> string`

- [ ] **Passo 1: Escrever os testes**

```js
test('o seletor do time não oferece mais supervisora — cada papel tem um lugar só', () => {
  assert.deepEqual(PAPEIS.map((p) => p.id), ['vendedora', 'gestor']);
  assert.deepEqual(PAPEIS_DE_GRUPO.map((p) => p.id), ['supervisora']);
});

// A ESCADA É DE PROPÓSITO: a supervisora tem alcance largo de LEITURA e nenhum
// de PODER. nivelDo('supervisora') = 0 é o que a mantém fora da administração.
test('supervisora não administra time e não concede papel nenhum', () => {
  const eu = { id: 'eu', is_superadmin: false };
  assert.equal(podeAdministrarTime(eu, 'supervisora'), false);
  assert.deepEqual(papeisQuePossoConceder(eu, 'supervisora'), []);
});

test('gestor continua administrando e concedendo até gestor', () => {
  const eu = { id: 'eu', is_superadmin: false };
  assert.equal(podeAdministrarTime(eu, 'gestor'), true);
  assert.deepEqual(papeisQuePossoConceder(eu, 'gestor').map((p) => p.id), ['vendedora', 'gestor']);
});

test('a supervisora continua vendo e liberando o estoque — o papel só mudou de lugar', () => {
  assert.equal(veOEstoque({ papel: 'supervisora' }, []).ve, true);
  assert.equal(podeLiberarEstoque({ id: 'eu', is_superadmin: false }, 'supervisora'), true);
});

test('rotuloDoPapel acha o papel de grupo, para a tela escrever o nome certo', () => {
  assert.equal(rotuloDoPapel('supervisora'), 'Supervisora');
  assert.equal(rotuloDoPapel('vendedora'), 'Vendedora');
  assert.equal(rotuloDoPapel('nao-existe'), '');
});

test('time sem canal é avisado também sobre o grupo: é o que explica a tela vazia', () => {
  const avisos = avisosDoTime({ tipo: 'loja', canal_loja_id: null });
  assert.ok(avisos.some((a) => /grupo/i.test(a.texto)));
});
```

- [ ] **Passo 2: Rodar e ver falhar**

```bash
node --test src/ferramentas/admin/equipes.test.mjs
```

- [ ] **Passo 3: Implementar**

```js
// OS PAPÉIS DO TIME.
//
// 21/08/2026: `supervisora` SAIU daqui. Decisão do dono: cada papel tem um lugar
// só — supervisora se cadastra no card PAI (o grupo) e vale em todas as lojas
// dele; dentro da loja só cabem gestora e vendedora.
//
// `nivel` compara sem depender da ordem do array. Repare que `supervisora` não
// tem nível de time, e é isso que a mantém fora da administração: `nivelDo`
// devolve 0 para ela, então `podeAdministrarTime` diz não. Alcance largo de
// LEITURA, nenhum de PODER.
export const PAPEIS = [
  {
    id: 'vendedora', nivel: 1, rotulo: 'Vendedora',
    explicacao: 'Vê os números do time dela. Não gerencia ninguém.',
  },
  {
    id: 'gestor', nivel: 2, rotulo: 'Gestor',
    explicacao: 'Administra o time: coloca gente, tira gente e define o papel de cada uma.',
  },
];

// OS PAPÉIS DO GRUPO (o card pai).
export const PAPEIS_DE_GRUPO = [
  {
    id: 'supervisora', nivel: 0, rotulo: 'Supervisora',
    explicacao: 'Vê a venda de todos os canais do grupo, e o estoque e o patrimônio '
      + 'de todas as lojas dele — inclusive de loja que entrar depois. '
      + 'Não coloca nem tira gente do time.',
  },
];

// Só para ESCREVER o nome na tela. `acharPapel` continua olhando só os do time,
// de propósito: é ele que alimenta `nivelDo`, e dar nível à supervisora
// devolveria a ela o poder de administrar que a decisão do dono tirou.
export function rotuloDoPapel(id) {
  const p = PAPEIS.concat(PAPEIS_DE_GRUPO).find((x) => x.id === id);
  return p ? p.rotulo : '';
}
```

E em `avisosDoTime`, trocar o texto do aviso de canal ausente:

```js
  if (!e.canal_loja_id) {
    out.push({
      grave: true,
      texto: 'Sem canal do Bling: este time não vai mostrar faturamento nenhum. '
        + 'E como o grupo vem do canal, ele também fica fora de grupo — ou seja, sem supervisora. '
        + 'Ligue ao canal correspondente assim que ele existir no Bling.',
    });
  }
```

- [ ] **Passo 4: Rodar e ver passar**

```bash
node --test src/ferramentas/admin/equipes.test.mjs
```

- [ ] **Passo 5: Commit**

```bash
git add src/ferramentas/admin/equipes.js src/ferramentas/admin/equipes.test.mjs
git commit -m "feat(times de venda): supervisora sai do time e vira papel do grupo"
```

---

## Tarefa 9 — O card pai na Gestão de Usuários

**Arquivos:**
- Modificar: `src/ferramentas/admin/tela-de-admin.vue` — carregamento (~L920), `_eqDesenhar` (~L968-1000), `_eqLigar` (~L1200), CSS (~L3682)

**Interfaces consumidas:** `agruparTimesPorGrupo(times, canais, grupos)` (T4), `PAPEIS_DE_GRUPO` e `rotuloDoPapel` (T8), `_criarLinhaPessoa` (já existe, L2745)

- [ ] **Passo 1: Carregar grupos e membros de grupo**

No `Promise.all` de `loadAdminEquipes` (~L920), acrescentar `sb('canais_grupos?select=*')` e `sb('canais_grupos_membros?select=*')`, guardando em `_eqGrupos` e `_eqMembrosDeGrupo` (declarar as duas junto de `_eqMembros`).

> **`loadAdminCanais()` roda ANTES de `loadAdminEquipes()`** — `_canaisComGrupo` já precisa estar carregado. Isso já vale hoje e continua valendo.

- [ ] **Passo 2: Desenhar o card pai**

Em `_eqDesenhar`, o laço que hoje escreve um cabeçalho passa a abrir um card:

```js
  const baldesDeTime = agruparTimesPorGrupo(ordenarTimes(_eqTimes), _canaisComGrupo, _eqGrupos)
  for (const balde of baldesDeTime) {
    const g = balde.grupo
    const pessoas = balde.times.reduce((n, t) => n + _eqMembros.filter(m => String(m.equipe_id) === String(t.id)).length, 0)
    html += '<div class="adm-pai' + (g ? '' : ' adm-pai-sem') + '">'
    html += '<div class="adm-pai-topo"><span class="adm-pai-nome">' + escHtml(g ? g.nome : 'Sem grupo') + '</span>'
      + '<span class="adm-pai-conta">' + balde.times.length + (balde.times.length === 1 ? ' loja' : ' lojas')
      + ' · ' + pessoas + (pessoas === 1 ? ' pessoa' : ' pessoas') + '</span></div>'
    if (g) {
      html += '<div class="adm-pai-rotulo">Supervisoras do grupo</div>'
      html += '<div class="adm-pai-gente" data-pai-gente="' + escHtml(g.id) + '"></div>'
      // O seletor só para quem pode: a gestora da loja não cria a própria chefe.
      if (eu.is_superadmin) html += '<div class="adm-pai-por" data-pai-por="' + escHtml(g.id) + '"></div>'
    } else {
      // CONTROLE QUE SOME SEM EXPLICAÇÃO VIRA CHAMADO. "Sem grupo" não é um
      // grupo, é a ausência de um — e a tela diz isso, em vez de só não ter botão.
      html += '<div class="adm-pai-nota">Estes times não estão em grupo nenhum, então não têm supervisora. '
        + 'Ligue cada um a um canal de venda que tenha grupo.</div>'
    }
    for (const t of balde.times) {
      // ... o card da loja, exatamente como já é hoje, sem mudança ...
    }
    html += '</div>'
  }
```

- [ ] **Passo 3: Preencher as pessoas com o MESMO cartão**

Em `_eqLigar` (~L1200), acrescentar:

```js
  // O MESMO cartão da lista de baixo: vêm de graça a foto, o botão Permissões
  // (o mesmo openPermModal) e o Trocar a senha (a mesma _secaoSenha). Escrever
  // um cartão "parecido" aqui é como a caixinha de estoque ficou dois meses
  // morta — controle novo que ninguém liga.
  for (const cx of body.querySelectorAll('[data-pai-gente]')) {
    const gid = cx.getAttribute('data-pai-gente')
    const meus = _eqMembrosDeGrupo.filter(m => String(m.grupo_id) === String(gid))
    if (!meus.length) { cx.innerHTML = '<div class="adm-pai-vazio">Nenhuma supervisora neste grupo ainda.</div>'; continue }
    for (const m of meus) {
      const p = _eqPessoas.find(x => String(x.id) === String(m.profile_id))
      if (!p) continue
      cx.appendChild(_criarLinhaPessoa(p, _eqGaveta, _eqMeuEmail))
    }
  }
```

> **`_eqPessoas` precisa trazer as colunas de permissão no `select`.** Abrir o editor de permissões com uma linha incompleta e SALVAR apaga o acesso inteiro da pessoa — o editor grava o que recebeu. Isso já foi corrigido em 12/08; **confira que continua** antes de reusar o cartão aqui.

- [ ] **Passo 4: O seletor de pôr supervisora**

Nos `[data-pai-por]`, montar `select` de pessoa + botão. O `select` oferece quem **ainda não é** supervisora daquele grupo e não está desligada.

```js
    const r = await adFetch('canais_grupos_membros', { method: 'POST', body: JSON.stringify({ grupo_id: gid, profile_id: selP.value, papel: 'supervisora' }) })
    if (!r.ok) { msg.textContent = 'Não consegui pôr no grupo: ' + (r.erro || r.status); return }
```

E o "Tirar" por `DELETE` em `canais_grupos_membros?id=eq.<id>`. **Toda falha fala na tela** — `catch` mudo aqui já custou meia hora de caça noutra tela deste sistema.

- [ ] **Passo 5: CSS, só com token**

```css
.tela-admin :deep(.adm-pai){border:1px solid var(--border);border-radius:var(--radius-lg);padding:var(--sp-3);margin:var(--sp-4) 0;background:var(--surface2);}
.tela-admin :deep(.adm-pai-sem){background:transparent;border-style:dashed;}
.tela-admin :deep(.adm-pai-topo){display:flex;align-items:baseline;justify-content:space-between;gap:var(--sp-2);flex-wrap:wrap;margin-bottom:var(--sp-2);}
.tela-admin :deep(.adm-pai-nome){font-family:var(--fonte-principal);font-size:max(9px, calc(12px * var(--escala-texto, 1)));font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:var(--text);overflow-wrap:anywhere;}
.tela-admin :deep(.adm-pai-conta){font-size:max(9px, calc(11px * var(--escala-texto, 1)));color:var(--muted);}
.tela-admin :deep(.adm-pai-rotulo){font-size:max(9px, calc(10.5px * var(--escala-texto, 1)));font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--muted);margin-bottom:var(--sp-1);}
.tela-admin :deep(.adm-pai-vazio),.tela-admin :deep(.adm-pai-nota){font-size:max(9px, calc(11.5px * var(--escala-texto, 1)));color:var(--muted);}
/* CELULAR: o aninhamento não pode empurrar a largura. No desktop o pai recua o
   filho; a 375px ele encosta na borda — as pessoas do time são cartões que já
   sabem encolher, e é a moldura NOVA que precisa ceder, não elas. */
@media (max-width:640px){
  .tela-admin :deep(.adm-pai){padding:var(--sp-2) 0;border-left:0;border-right:0;border-radius:0;}
}
```

- [ ] **Passo 6: Provar NA TELA, a 375px e nos dois temas**

```bash
npm run build && npm run provar-telas
```

Depois abrir e conferir com os olhos: card pai do Varejo com Dom Pedro e Tivoli dentro · card pai do Atacado · "Sem grupo" com o Iguatemi Campinas e a frase · seletor de papel do time **sem** supervisora · nada estourando a 375px · contraste no claro e no escuro.

- [ ] **Passo 7: Commit**

```bash
git add src/ferramentas/admin/tela-de-admin.vue
git commit -m "feat(gestao de usuarios): o grupo vira card pai, com as supervisoras dentro"
```

---

## Tarefa 10 — Canais de venda: o grupo por lista

**Arquivos:**
- Modificar: `src/ferramentas/admin/tela-de-admin.vue:805-840` (seção Canais de venda)

- [ ] **Passo 1: Trocar o campo de texto por lista + criar**

O `select` de grupo passa a ser montado de `_eqGrupos`, mais a opção **"+ Criar grupo…"**. Gravar vira `PATCH bling_lojas?loja_id=eq.<id>` com `{ grupo_id }`.

Ao criar: `POST canais_grupos { nome }`. **Antes de gravar, comparar com `mesmoGrupo` contra os que já existem** — digitar "varejo" quando existe "Varejo" deve reaproveitar a linha, não bater no índice único, cujo erro (`duplicate key value violates unique constraint`) não diz nada a quem está cadastrando.

- [ ] **Passo 2: Ajustar os baldes e o contador**

`agruparCanais(_canaisComGrupo, _eqGrupos)`, rótulo lendo `balde.grupo.nome`, e `contarSemGrupo` (que agora olha `grupo_id`) alimentando o "faltam N".

- [ ] **Passo 3: Conferir que o espelho acompanha**

Depois de trocar o grupo de um canal **pela tela**:

```sql
select nome, grupo, grupo_id from public.bling_lojas where nome = '<o canal que você mexeu>';
```

Esperado: `grupo` (texto) igual ao nome do grupo apontado. Se divergir, o gatilho da Tarefa 1 não está no ar.

- [ ] **Passo 4: Commit**

```bash
git add src/ferramentas/admin/tela-de-admin.vue
git commit -m "feat(canais de venda): grupo por lista, com criar sem duplicar"
```

---

## Tarefa 11 — A aba espelho acompanha

**Arquivos:**
- Modificar: `src/ferramentas/gestao-comercial/time-de-vendas.vue:140-185`

**Por que não pode ficar para depois:** esta aba importa o **mesmo** `admin/equipes.js`. Se a tela de admin mostra uma coisa e ela outra, viram duas telas discordando sobre permissão — a pior classe de defeito deste sistema, e já documentada nele.

- [ ] **Passo 1: Carregar grupos e membros de grupo**

Acrescentar ao `Promise.all` (L146) as leituras de `canais_grupos` e `canais_grupos_membros`.

- [ ] **Passo 2: Desenhar o card pai em leitura**

As supervisoras do grupo aparecem no topo do bloco do grupo. **Pôr e tirar só para super-admin**, igual à tela de admin — a regra é a mesma porque o módulo é o mesmo.

- [ ] **Passo 3: Conferir na tela que o seletor de papel não oferece supervisora**

Ele já vem de `papeisQuePossoConceder`, que a Tarefa 8 ajustou. **Confirme na tela, não no código** — teste verde de função pura não prova que ela está no caminho.

- [ ] **Passo 4: Commit**

```bash
git add src/ferramentas/gestao-comercial/time-de-vendas.vue
git commit -m "feat(gestor comercial): a aba espelho ganha o card pai, pelas mesmas regras"
```

---

## Tarefa 12 — O vazio passa a dizer o motivo

**Por que:** hoje **Douglas Pereira** está com o limite por time ligado e fora de todo time e de todo grupo. Ele abre as duas telas de venda e vê **zero**, sem erro e sem explicação. O módulo já distingue `null` (vê tudo) de `[]` (não vê nada), e essa distinção tem teste desde 13/08 — o que falta é a tela **usar** a diferença para falar.

**Arquivos:**
- Modificar: `src/ferramentas/admin/tela-de-admin.vue` (o resumo do cartão da pessoa)
- Modificar: `src/ferramentas/gestao-a-vista/tela-de-gestao-a-vista.vue`
- Modificar: `src/ferramentas/analise-vendas/tela-de-analise-vendas.vue`

- [ ] **Passo 1: Na Gestão de Usuários**

Quando `escopo_por_equipe === true` e a pessoa não tem vínculo nenhum (nem `equipes_membros`, nem `canais_grupos_membros`), o resumo do cartão dela diz, em `var(--red)` — porque é estado quebrado, não informação:

```
Não vê venda nenhuma: está com o limite por time ligado e não está em time nem em grupo.
```

- [ ] **Passo 2: Nas duas telas de venda**

Quando `estaLimitada(meusCanais)` **e** `meusCanais.length === 0`, a área de faturamento diz:

```
Você está com o limite por loja ligado e ainda não está em nenhum time nem grupo,
então não há venda para mostrar. Peça a um administrador para colocar você no time da sua loja.
```

**Não é lista vazia silenciosa:** vazio sem explicação parece "não houve venda", e é assim que nasce um chamado. É a mesma escolha que a edge já faz ao responder 403 em vez de lista vazia.

- [ ] **Passo 3: Conferir com o caso real**

```sql
select p.email
  from public.profiles p
 where p.escopo_por_equipe
   and not exists (select 1 from public.equipes_membros m where m.profile_id = p.id)
   and not exists (select 1 from public.canais_grupos_membros g where g.profile_id = p.id);
```

Esperado hoje: **`douglas.pereira@rbvcompany.com`**. Se vier mais gente, a frase vale para todas — mas **anote quem**, porque cada uma dessas pessoas está vendo tela vazia agora.

- [ ] **Passo 4: Commit**

```bash
git add src/ferramentas/admin/tela-de-admin.vue src/ferramentas/gestao-a-vista/tela-de-gestao-a-vista.vue src/ferramentas/analise-vendas/tela-de-analise-vendas.vue
git commit -m "fix(vendas): a tela vazia passa a dizer o motivo em vez de parecer que nao houve venda"
```

---

## Tarefa 13 — Subir, medir no ar, e anotar a dívida

- [ ] **Passo 1: Suíte inteira e build**

```bash
npm test && npm run build
```

Esperado: tudo verde. **Se o total de testes for MENOR que o conhecido, não é flake — é arquivo sumindo.** Investigue antes de seguir.

- [ ] **Passo 2: Subir a tela**

Abrir PR da branch `feat/canal-pai-e-supervisora-de-grupo` para a `main`; o merge builda na Vercel.

- [ ] **Passo 3: Conferir o que está NO AR, não o que está na sua máquina**

Hash local mente. Conferir pelo caminho: `index.html` servido → entrada → chunk do admin, e procurar dentro dele as frases novas ("Supervisoras do grupo", "não têm supervisora"). Domínios: `central.rbvcompany.com` e `socialdashboard.rbvcompany.com` (os dois vivos; nesta máquina o segundo exige o pin do IP .65 no `/etc/hosts`).

- [ ] **Passo 4: Anotar a dívida do espelho em `docs/pendencias.md`**

Item novo na Parte B:

```markdown
### B26 · `bling_lojas.grupo` é cópia e precisa sair 🟡 *aberto em 21/08*

Desde 21/08 quem manda é `bling_lojas.grupo_id`. O texto `grupo` virou espelho
só-leitura, mantido por dois gatilhos, e existe por um motivo temporário: no
minuto do deploy havia gente com a tela já aberta rodando o pacote anterior, que
lia o texto.

**Enquanto ele existir, `grupo_id` é a verdade e `grupo` é cópia — nenhum código
novo pode ler `grupo`.** Fechar isto é: conferir que nada mais lê a coluna,
apagar os dois gatilhos e a coluna.
```

- [ ] **Passo 5: Commit**

```bash
git add docs/pendencias.md
git commit -m "docs(pendencias): a divida do espelho de bling_lojas.grupo"
```

- [ ] **Passo 6: O que fica para o dono (não é código)**

1. **Cadastrar a primeira supervisora** — é só aí que a regra começa a valer.
2. **Decidir o grupo dos 4 canais sem grupo** (Canal Direto, Canal Direto 2, Institucional, Private Label). Adivinhar pelo nome é o defeito já catalogado; isto é clique dele.
3. **Ligar o time `Iguatemi Campinas` a um canal**, ou ele fica fora de grupo e sem supervisora — e continua mostrando zero para quem entrar nele.
