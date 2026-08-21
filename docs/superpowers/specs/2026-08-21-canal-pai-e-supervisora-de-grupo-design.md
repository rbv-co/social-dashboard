# O canal pai e a supervisora do grupo

**Data:** 21/08/2026

**Pedido do dono:** *"o canal pai precisa ser o 'pai' dos times de vendas,
entendeu? Então precisa ter a seção do time de vendas, com um card 'pai' varejo
e aí todos os times do varejo. E aí, por exemplo, a supervisora fica a nível
'pai', gestora e vendedora fica a nível loja."*

Sucessora de `2026-08-20-grupo-do-canal-design.md` (as quatro peças da separação
atacado/varejo). Lá o grupo virou um **rótulo**; aqui ele passa a ter **gente
dentro**, e é isso que muda o que ele precisa ser.

---

## 0. O que foi medido antes de desenhar (21/08/2026, na produção)

| | |
|---|---|
| Perfis | **23** — 3 super-admins, 9 `role=admin` |
| Perfis com limite por time ligado (`escopo_por_equipe`) | **5** |
| Times (`equipes`) | **4** — Atacado Nuvem Shop (2 pessoas), Dom Pedro (2), **Tivoli (0)**, **Iguatemi Campinas (0)** |
| Membros (`equipes_membros`) | **4**, e **todos `vendedora`** |
| Supervisoras hoje | **zero** |
| Canais (`bling_lojas`) | **14** |
| Canais com grupo | **10** — 8 Varejo, 2 Atacado |
| Canais sem grupo | **4** — Canal Direto, Canal Direto 2, Institucional, Private Label |
| Canais do Varejo **sem time nenhum** | **6** — Amazon Seller, Loja Hortolândia, Loja Shopify, Seller Mercado Livre, Tik Tok Shop, Varejo Fábrica |

Três consequências que essa medição impõe ao desenho, e que valem mais que
qualquer preferência de arquitetura:

1. **Ninguém precisa ser migrado.** Não existe supervisora cadastrada. Tirar o
   papel `supervisora` de dentro do time não tira o papel de pessoa nenhuma.
2. **A regra da supervisora que subiu em 20/08 (PR #160) nunca valeu para
   ninguém.** Ela está no ar, provada em `rollback`, e inerte. Isto aqui é o que
   a liga.
3. **`Iguatemi Campinas` está sem canal e sem depósito**, e `Douglas Pereira`
   está com o limite por time ligado e **fora de todo time**. Os dois são o
   mesmo defeito visto de dois lados: a pessoa abre o painel e vê zero, sem
   explicação nenhuma.

---

## 1. As quatro decisões do dono

Perguntadas uma a uma antes de qualquer linha de código:

| # | Decisão |
|---|---|
| 1 | **Estar no card pai vale como estar dentro de cada loja do grupo:** venda, estoque e patrimônio das lojas de baixo. **Loja nova no grupo entra sozinha** no alcance dela, sem ninguém mexer. |
| 2 | **A supervisora só existe no pai.** Dentro do card da loja só cabem gestora e vendedora. Cada papel tem um lugar só. |
| 3 | **O grupo vira cadastro de verdade** — uma lista com nome próprio, e o canal aponta pra ela em vez de repetir o nome. |
| 4 | **A supervisora não administra o time.** Quem põe, tira e muda papel continua sendo a gestora da loja. |

A decisão 4 é a que segura a decisão 1: o alcance dela é largo **de leitura**,
não de poder. Ela vê e libera estoque; ela não mexe em quem entra e quem sai.

---

## 2. Por que o grupo deixa de ser texto (o defeito que isso evita)

Em 20/08 o grupo nasceu como **texto digitado** em cada canal, e a justificativa
está escrita na spec anterior: *"grupo novo é digitação na tela, não evento de
engenharia"*. Essa justificativa continua de pé — e **este desenho a preserva**:
criar grupo novo continua sendo digitar na tela, sem migration e sem programador.

O que mudou foi o **peso** do texto. Enquanto o grupo era um título, escrever
errado era um título errado. Agora ele decide quem enxerga o quê, e aí o texto
livre vira uma armadilha silenciosa:

> Alguém abre Config de Admin › Canais de venda e troca "Varejo" por
> "Varejo Físico" em 3 dos 8 canais. O balde se parte em dois. A supervisora do
> "Varejo" perde 3 lojas — **sem erro, sem aviso, e sem ninguém ficar sabendo**.

Permissão que se perde em silêncio é a pior classe de defeito deste sistema, e
ele já pagou por ela antes (a caixinha de estoque que ficou dois meses morta, o
`excecaoDe` que tinha teste verde e ninguém chamava). Com o grupo virando linha
com identidade própria, **renomear é renomear**: muda o nome em todo lugar de uma
vez e ninguém perde acesso.

---

## 3. Por que o pai NÃO entra na tabela `equipes` (a alternativa recusada)

A tentação óbvia é criar o grupo como uma linha em `equipes` com `tipo='grupo'`,
com os times filhos apontando pro pai. Aí a supervisora ficaria em
`equipes_membros` como todo mundo, e não haveria tabela nova.

**Recusado, e a medição é o motivo.** A tabela `equipes` é feita de
`canal_loja_id`, `deposito_id`, `local_id`, `setor_id` — e o pai não tem nada
disso. Cada aviso de `avisosDoTime()` teria que aprender a se calar para uma
linha que é time só no nome.

Mas o argumento que decide é outro, e é o mesmo de 20/08: **o grupo é do canal,
não do time.** Dos 14 canais, 10 têm grupo e **só 3 têm time**. Se o pai fosse um
time, os canais sem time ficariam sem pai — e são justamente os 6 canais do
Varejo que a supervisora **já enxerga hoje**. Seria um retrocesso do que está no
ar, disfarçado de simplificação.

**Também recusado: copiar a supervisora para dentro de cada loja** (gravar uma
linha em `equipes_membros` por loja do grupo). Loja nova não entraria sozinha,
contra a decisão 1 — e é a lista escrita à mão que envelhece em silêncio, defeito
que este repositório já catalogou.

---

## 4. O que muda no banco

Migration: `db/migrations/2026-08-21-canal-pai-e-supervisora-de-grupo.sql`.

### 4.1 `canais_grupos` — a lista de grupos

```sql
create table if not exists public.canais_grupos (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null,
  ordem       int  not null default 0,
  ativo       boolean not null default true,
  criado_em   timestamptz not null default now()
);
create unique index if not exists canais_grupos_nome_unico
  on public.canais_grupos (lower(btrim(nome)));
```

O índice único por `lower(btrim(nome))` é o que impede "Varejo", "varejo" e
"Varejo " de virarem três grupos que parecem um — a mesma normalização que
`normalizarGrupo()`/`mesmoGrupo()` já fazem no JavaScript, agora garantida pelo
banco e não pela boa vontade da tela.

**RLS:** leitura para `authenticated` (a tela precisa listar os grupos);
escrita só para super-admin, igual à política `bling_lojas_grupo_superadmin` que
já existe.

### 4.2 `bling_lojas.grupo_id` — o canal aponta pro grupo

```sql
alter table public.bling_lojas
  add column if not exists grupo_id uuid references public.canais_grupos(id) on delete set null;
```

**Migração dos dados de hoje:** criar um grupo para cada nome distinto que já
existe em `bling_lojas.grupo` (hoje: Varejo e Atacado) e ligar os 10 canais. Os
4 sem grupo continuam sem grupo — **não adivinhar pelo nome do canal**, que é o
defeito já catalogado do estoque.

**O texto `bling_lojas.grupo` continua existindo, como espelho só-leitura
mantido por gatilho.** Ninguém escreve nele; o gatilho o mantém igual ao nome do
grupo apontado. São **dois** gatilhos, e esquecer o segundo é o erro fácil aqui:
um em `bling_lojas` (quando o canal troca de grupo) e outro em `canais_grupos`
(quando o grupo é **renomeado**, que precisa reescrever o texto de todos os
canais daquele grupo). Sem o segundo, o espelho ficaria desatualizado justamente
no caso que motivou o cadastro existir. Isso existe por um motivo concreto e temporário: no minuto do
deploy há gente com a tela **já aberta**, rodando o pacote anterior, e esse
pacote lê o texto. Sem o espelho, o seletor de canais dessas pessoas mostraria
"Sem grupo" em tudo até elas recarregarem — e este aplicativo já teve o problema
de tela aberta rodando versão velha.

O espelho sai numa faxina posterior, e **fica anotado na lista de pendências como
dívida**, com todas as letras: enquanto ele existir, `grupo_id` é a verdade e
`grupo` é cópia. Nenhum código novo pode ler `grupo`.

### 4.3 `canais_grupos_membros` — quem supervisiona qual grupo

```sql
create table if not exists public.canais_grupos_membros (
  id           uuid primary key default gen_random_uuid(),
  grupo_id     uuid not null references public.canais_grupos(id) on delete cascade,
  profile_id   uuid not null references public.profiles(id)      on delete cascade,
  papel        text not null default 'supervisora' check (papel in ('supervisora')),
  concedido_por uuid references public.profiles(id),
  concedido_em  timestamptz not null default now(),
  unique (grupo_id, profile_id)
);
```

De propósito com a **mesma forma** de `equipes_membros` (vínculo · pessoa ·
papel · quem concedeu · quando). É isso que faz a soma das duas origens ser uma
linha de SQL, e não um emaranhado — e `concedido_por`/`concedido_em` seguem a
mesma escolha de `equipes_permissoes`, onde um booleano perderia "quem deixou".

O `check` prende o papel em `supervisora` porque é a decisão 2. A coluna existe
mesmo assim para a soma ser uniforme; se um dia aparecer outro papel de grupo, é
o `check` que muda, não a forma da tabela.

**RLS:**
- **Leitura:** `profile_id = auth.uid() or public.pode_ver_grupo(grupo_id)` — a
  mesma forma da política `membros_leitura` de `equipes_membros`. Ninguém deixa
  de enxergar o próprio vínculo. A função nasce junto, espelhando
  `pode_ver_equipe`:

  ```sql
  create or replace function public.pode_ver_grupo(p_grupo uuid)
  returns boolean
  language sql stable security definer set search_path to 'public'
  as $$
    select
      public.is_superadmin()
      or coalesce((select not escopo_por_equipe from public.profiles where id = auth.uid()), false)
      or exists (select 1 from public.canais_grupos_membros gm
                  where gm.grupo_id = p_grupo and gm.profile_id = auth.uid());
  $$;
  ```
- **Escrita: só super-admin.** A gestora da loja não pode criar a própria chefe,
  e a regra de ouro deste sistema é *ninguém concede o que não tem*.

---

## 5. As regras: **um** lugar que soma, nunca dois

Hoje cada regra procura a pessoa em `equipes_membros` por conta própria. Se cada
uma aprender o grupo do seu jeito, elas discordam — e duas regras discordando
sobre permissão é o defeito mais caro que este sistema pode produzir.

### 5.1 `meus_vinculos()` — a soma, num lugar só

```sql
create or replace function public.meus_vinculos()
returns table (equipe_id uuid, papel text)
language sql stable security definer set search_path to 'public'
as $$
  -- 1. os times onde eu fui cadastrada
  select m.equipe_id, m.papel
    from public.equipes_membros m
   where m.profile_id = auth.uid()
  union
  -- 2. os times das lojas do grupo que eu supervisiono
  select e.id, 'supervisora'
    from public.canais_grupos_membros gm
    join public.bling_lojas bl on bl.grupo_id = gm.grupo_id
    join public.equipes     e  on e.canal_loja_id = bl.loja_id
   where gm.profile_id = auth.uid()
     and gm.papel = 'supervisora';
$$;
```

O caminho 2 é o que faz **loja nova entrar sozinha** (decisão 1): não há lista
guardada, a resposta é calculada na hora a partir de quem está no grupo.

### 5.2 O que passa a sair dela

| Função | O que muda |
|---|---|
| `minhas_equipes()` | passa a ser `select equipe_id from meus_vinculos()` |
| `pode_ver_bem` | **nada** — herda de `minhas_equipes()`. O patrimônio das lojas do grupo vem de graça |
| `pode_ver_equipe` | **nada** — herda. A supervisora passa a enxergar quem está nas lojas dela |
| `pode_ver_canal` | ganha um **segundo caminho** (ver 5.3) |
| `pode_ver_estoque` | passa a ler `meus_vinculos()` em vez de `equipes_membros` |
| `sou_gestor_da_equipe` | **muda de forma, sem mudar de efeito** (ver 5.4) |

Conferido antes de escrever: `minhas_equipes()` é usada por exatamente três
funções — `pode_ver_bem`, `pode_ver_canal`, `pode_ver_equipe` — e por **nenhuma
política diretamente**. As três são justamente as que devem alargar. Alargar uma
função que meia dúzia de políticas usa sem saber seria abrir acesso onde ninguém
pediu; aqui o raio da explosão foi medido, não presumido.

### 5.3 `pode_ver_canal` precisa de DOIS caminhos, não um

Este é o ponto mais fácil de errar do desenho inteiro.

Se o pai valesse só "pelas lojas de baixo", a supervisora do Varejo veria os
canais dos times do Varejo — e **perderia os 6 canais do Varejo que não têm time
nenhum** (Amazon Seller, Hortolândia, Shopify, Mercado Livre, Tik Tok, Varejo
Fábrica). Ela vê esses 6 **hoje**, pela regra que subiu em 20/08. Seria um retrocesso do que já
está no ar, escondido dentro de uma melhoria.

Então `pode_ver_canal` responde `true` quando:

1. sou super-admin, **ou**
2. estou sem o limite por time (`not escopo_por_equipe`), **ou**
3. o canal é de um time meu (`meus_vinculos()`), **ou**
4. **o canal pertence a um grupo que eu superviso** — direto por
   `bling_lojas.grupo_id`, sem passar por time nenhum.

O caminho 4 substitui o `join` por texto de grupo que a regra de 20/08 faz hoje.
Canal **sem grupo** (`grupo_id is null`) não amplia nada — e isso não pode virar
"vê tudo" por omissão, que é o defeito que `canais-de-venda-permitidos.js`
protege com teste desde 13/08.

### 5.4 A armadilha do "qual é o meu papel"

`meu_papel_na_equipe(equipe)` devolve **um** papel. Com a soma, uma pessoa pode
ter **dois** vínculos com o mesmo time: gestora da loja Dom Pedro *e* supervisora
do Varejo.

Se `meu_papel_na_equipe` devolver `'supervisora'` para essa pessoa,
`sou_gestor_da_equipe` — que compara com `'gestor'` — passa a dar **false**, e
**a gestora perde o poder de administrar o próprio time**. Silenciosamente, por
ter ganhado um papel a mais.

Por isso:

- Nasce `tenho_papel_na_equipe(p_equipe uuid, p_papeis text[])` → `exists` sobre
  `meus_vinculos()`. **Toda regra de PODER passa a perguntar assim**, nunca
  comparando um papel único:
  - `sou_gestor_da_equipe(e)` = super-admin **ou** `tenho_papel_na_equipe(e, '{gestor}')`
  - liberação de estoque (`eqperm_escrever`) = super-admin **ou** `tenho_papel_na_equipe(e, '{supervisora,gestor}')`
  - `pode_ver_estoque(dep)` = idem, pelo time que tem aquele depósito
- `meu_papel_na_equipe` continua existindo só para **frase de tela** (dizer o que
  a pessoa é naquele time), com precedência declarada: `supervisora` >
  `gestor` > `vendedora`. **Nenhuma decisão de acesso passa mais por ela.**

### 5.5 O que NÃO muda

`sou_gestor_da_equipe` continua exigindo `gestor`: **a supervisora não põe nem
tira gente** (decisão 4). E `pode_ver_estoque` mantém a regra própria e mais
apertada que foi escrita de propósito — *estar no time não basta*: ou você
supervisiona, ou é gestora, ou alguém liberou pra você. O que muda é só que
"supervisiona" passa a incluir quem supervisiona pelo grupo.

---

## 6. No navegador e na `bling-proxy`

A mesma soma precisa existir do lado de fora do banco, porque as duas dashboards
de venda **não leem** as tabelas protegidas por RLS: elas leem o Bling ao vivo
pela edge `bling-proxy`.

Nasce `supabase/functions/_shared/vinculos-de-time.js`, **puro**, no mesmo
arranjo de `grupo-do-canal.js` e `canais-de-venda-permitidos.js` — a regra mora
onde o Deno alcança, e `src/compartilhado/` só reexporta. Uma regra, dois lugares
que a leem, zero cópias.

```
vinculosDaPessoa({ meuId, membros, membrosDeGrupo, times, canais })
  -> [{ equipe_id, papel }]        // a MESMA soma do meus_vinculos()
gruposQueSupervisiono({ meuId, membrosDeGrupo })
  -> Set de grupo_id
```

`canaisDoEscopo()` passa a receber `membrosDeGrupo` e a usar os dois: os canais
dos times (caminho 3) **mais** os canais dos grupos supervisionados (caminho 4).
A lógica de supervisora que hoje está espalhada dentro dela sai e vira a soma.

**Se `membrosDeGrupo` não chegar, nada amplia.** Falta de dado nunca pode dar
acesso a mais — é a mesma escolha que já está escrita no módulo para papel
ausente ("papel ausente é tratado como vendedora").

Os três lugares que carregam esses dados e precisam passar a buscar a tabela
nova:

- `src/ferramentas/gestao-a-vista/tela-de-gestao-a-vista.vue`
- `src/ferramentas/analise-vendas/tela-de-analise-vendas.vue`
- `supabase/functions/bling-proxy/index.ts` ← **esta é a tranca**; as duas de
  cima são a experiência de quem usa

⚠️ **A edge não sobe com `git push`.** Vai por CLI com `--use-api`, e tem de ser
**chamada depois de subir** para provar que compilou.

---

## 7. A tela

### 7.1 Gestão de Usuários › Times de venda — o cabeçalho vira card pai

```
┌─ VAREJO ────────────────────────── 2 lojas · 2 pessoas ─┐
│  Supervisoras do grupo                                  │
│  ( foto ) Fulana de Tal            Permissões · Tirar    │
│  [ escolher pessoa ▾ ]  [ Pôr supervisora ]              │
│                                                          │
│  ┌─ Dom Pedro · loja ─────── 1 gestora · 2 vendedoras ─┐ │
│  │  Vendas pelo canal: Loja Dom Pedro                  │ │
│  │  ( cartões das pessoas, exatamente como já são )    │ │
│  └──────────────────────────────────────────────────────┘│
│  ┌─ Tivoli · loja ──────────────────── ninguém ainda ──┐ │
│  └──────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────┘

── Sem grupo ───────────────────────────────────────────────
   Iguatemi Campinas · loja · ninguém ainda
   Este time não está em grupo nenhum, então não tem
   supervisora. Ligue-o a um canal de venda com grupo.
```

**A supervisora é um cartão de pessoa igual aos outros:** reuso o mesmo
`_criarLinhaPessoa` que já desenha as pessoas dentro da loja. Vêm de graça a
foto, o botão **Permissões** (o mesmo `openPermModal`) e o **Trocar a senha** (a
mesma `_secaoSenha`). Nenhum controle novo é escrito — foi assim que a rodada 2
de 12/08 resolveu "organizar e aliviar" de uma vez.

**"Sem grupo" continua existindo e não recebe supervisora.** Nenhum time pode
sumir da gestão de usuários — mas ali não cabe supervisora, porque *sem grupo*
não é um grupo, é a ausência de um. E a tela **diz isso**, em vez de só não ter
botão: controle que some sem explicação vira chamado.

**O botão "Pôr supervisora" só aparece para super-admin** (4.3), e para quem não
é, o card pai mostra as supervisoras em leitura, sem o seletor.

**Dentro do card da loja o seletor de papel passa a oferecer só Gestora e
Vendedora.** Conferido: não existe nenhuma supervisora cadastrada hoje, então
ninguém perde papel.

Em `src/ferramentas/admin/equipes.js`:
- `PAPEIS` passa a ser o que cabe **no time**: `vendedora`, `gestor`
- nasce `PAPEIS_DE_GRUPO`: `supervisora`
- `papeisQuePossoConceder` passa a oferecer só os do time
- `avisosDoTime()` ganha o aviso de time fora de grupo
- `veOEstoque` e `podeLiberarEstoque` **não mudam de regra** — passam a receber o
  papel já somado, e `supervisora` continua valendo

**Celular (375px):** o aninhamento não pode empurrar a largura. O card pai recua
o filho no desktop e **encosta na borda no celular**, dentro do
`@media (max-width:640px)` — as pessoas do time são cartões que já sabem
encolher, e é a moldura nova que precisa ceder, não elas.

### 7.2 A aba espelho muda junto

`src/ferramentas/gestao-comercial/time-de-vendas.vue` importa o **mesmo**
`admin/equipes.js`. Se eu mexer só na tela de admin, viram duas telas
discordando sobre permissão — e está escrito no repositório que essa é a pior
classe de defeito daqui. Ela ganha o card pai em leitura e, para super-admin, o
mesmo controle.

### 7.3 Config de Admin › Canais de venda

O campo de grupo deixa de ser texto livre e vira **lista + "criar grupo novo"**.
Criar continua sendo digitar (a promessa de 20/08 fica de pé); a diferença é que
digitar passa a criar **uma linha**, e digitar de novo o mesmo nome reaproveita a
que existe, em vez de partir o balde. Renomear passa a ser em um lugar só.

### 7.4 O aviso que falta hoje (o caso do Douglas)

**Douglas Pereira** está com o limite por time ligado e **fora de todo time e de
todo grupo**. Pela regra, ele abre a Gestão à Vista e a Análise de Vendas e vê
**zero**, sem erro e sem explicação.

- Na Gestão de Usuários, o cartão dele diz: *"Não vê venda nenhuma: está com o
  limite por time ligado e não está em time nem em grupo."*
- Nas duas telas de venda, o vazio passa a dizer o motivo, em vez de parecer que
  não houve venda.

O módulo já sabe distinguir `null` (vê tudo) de `[]` (não vê nada) — e a
distinção está protegida por teste desde 13/08 exatamente por isso. O que falta é
a tela **usar** essa diferença para falar.

---

## 8. O que eu provo antes de subir

**Testes puros** (`node --test`), que rodam sem navegador:
- `vinculos-de-time.test.mjs` — a soma. Casos que importam: só time · só grupo ·
  os dois no mesmo time (a armadilha do 5.4) · grupo sem canal · canal sem grupo
  · `membrosDeGrupo` ausente **não amplia** · loja nova no grupo entra sozinha.
- `canais-de-venda-permitidos.test.mjs` — os casos de hoje **continuam
  passando**, mais os dois caminhos do 5.3, com atenção ao canal do grupo **sem
  time** (o retrocesso que este desenho evita).
- `equipes.test.mjs` — papéis do time contra papéis de grupo; `papeisQuePossoConceder`
  não oferece mais `supervisora`; o aviso de time fora de grupo.
- Os guardas que já existem: `imports.test.mjs` (import que não entrou) e
  `ligacoes-da-tela.test.mjs` (controle desenhado e não ligado — foi assim que a
  caixinha de estoque ficou dois meses morta).

**SQL dentro de `rollback`**, em `docs/provar-canal-pai.sql`, no mesmo formato do
`provar-alcance-da-supervisora.sql` que já existe: com a trava **armada**,
medindo o que cada papel enxerga. Cenários:

| quem | esperado |
|---|---|
| supervisora do Varejo | os 8 canais do Varejo (**inclusive os 6 sem time**) · estoque das lojas do Varejo · patrimônio das lojas do Varejo · **não** administra time |
| gestora da loja Dom Pedro | só Dom Pedro · administra o próprio time |
| gestora do Dom Pedro **que também é supervisora do Varejo** | vê o Varejo **e continua administrando o Dom Pedro** (o 5.4) |
| vendedora do Dom Pedro | só Dom Pedro · sem estoque |
| pessoa com limite ligado e sem vínculo | nada — e a tela diz o motivo |
| loja nova criada no Varejo **durante o teste** | entra sozinha no alcance da supervisora |

**Não semear, não limpar e não trocar senha de ninguém.** Tudo em `rollback`,
sobre os dados reais, com a trava armada — desarmar a trava para o teste passar
seria testar outra coisa.

**Depois de subir**, medir no que está no ar (não no que está na minha máquina):
o `index.html` servido apontando para os hashes do build, o pedaço do admin
trazendo as frases novas, e a `bling-proxy` **chamada** uma vez para provar que
compilou.

---

## 9. O que esta spec NÃO faz

- **Não cria papel novo de grupo** além de `supervisora`. O `check` prende, e
  soltar é uma linha no dia em que alguém pedir.
- **Não mexe no estoque além do necessário.** A regra apertada continua apertada.
- **Não dá poder de administrar à supervisora** (decisão 4).
- **Não apaga `bling_lojas.grupo` agora** — o espelho fica, e a dívida fica
  anotada na lista de pendências.
- **Não preenche grupo nos 4 canais sem grupo.** Adivinhar pelo nome é o defeito
  já catalogado; isso é clique do dono.
- **Não cadastra supervisora nenhuma.** Quem entra em time e em grupo é decisão
  do dono, na tela — nunca por SQL nas costas dela.

---

## 10. Ordem de subida, e como voltar atrás

1. **Migration** (tabelas, `grupo_id`, espelho, funções, políticas) — as funções
   antigas continuam respondendo igual enquanto `canais_grupos_membros` estiver
   vazia, então este passo **não muda nada para ninguém**.
2. **Edge `bling-proxy`** por CLI com `--use-api`, e **chamada** depois.
3. **Tela** por push na `main`.
4. Só então o dono cadastra a primeira supervisora — e é aí que a regra começa a
   valer.

**Voltar atrás:** a tela e a edge pelo Instant Rollback da Vercel / redeploy da
versão anterior. O banco não precisa voltar: com a tabela de membros de grupo
vazia, `meus_vinculos()` responde exatamente o que `equipes_membros` respondia.
**Essa é a propriedade que torna esta subida segura**, e ela é de propósito.
