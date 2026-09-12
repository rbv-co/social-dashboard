# Cadastro rápido de colaborador — plano de implementação

> **Para quem executa:** use `superpowers:subagent-driven-development` (recomendado) ou
> `superpowers:executing-plans` para tocar tarefa por tarefa. Os passos usam caixinha
> (`- [ ]`) para marcar o andamento.

**Objetivo:** pôr o `+` de cadastro rápido de colaborador nos 6 campos de pessoa do
Patrimônio e da Frota, e abrir a lista de nomes para quem hoje a enxerga vazia.

**Arquitetura:** um componente compartilhado (`escolha-de-pessoa.vue`) que NÃO toca no
banco — quem grava é a tela, como já faz o `escolha-de-local-e-ambiente.vue`. O acesso
novo ao cadastro de colaboradores passa inteiro por funções `security definer` no banco,
que entregam nome/cargo/situação e nunca contato.

**Ferramentas:** Vue 3 (`<script setup>`), Vite, Supabase (PostgREST + RPC), testes com
`node --test` em arquivos `*.test.mjs`.

**Spec:** `docs/superpowers/specs/2026-08-13-cadastro-rapido-de-pessoa-design.md`

## Restrições que valem para todas as tarefas

- **Ler `PADRAO-DA-CENTRAL.md` antes de escrever a primeira linha.** Cor sai de token,
  texto nunca corta, campo de digitar tem `font-size` de no mínimo 16px (abaixo disso o
  iOS dá zoom e a tela salta), alvo de toque com 44px.
- **Pasta isolada:** o trabalho é em `~/iamundi-pessoa-rapida`, branch
  `feat/cadastro-rapido-de-pessoa`. Há mais de uma janela neste repositório — **não** rodar
  `git checkout -b` na pasta principal e **nunca** `git add <pasta>`, só arquivo por arquivo.
- **Porta de desenvolvimento fixa:** `npm run dev -- --port 5199 --strictPort`.
- **Nunca escrever em dado real de produção.** Toda prova no banco é dentro de
  `begin … rollback`. Não criar colaborador de teste em produção.
- **`npm test` (a suíte inteira) além do `npm run build`.** Teste verde não é tela que
  abre: `node --test` não compila `.vue`.
- **Migration não roda sozinha.** Aplicar dirigido pelo MCP do Supabase (projeto
  `kounqtdoioootxqegkij`), nunca pelo runner que lista pendências.
- **Texto de tela em português literal, sem jargão.** "Colaborador", não "usuário"; "quem
  responde pelo carro", não "responsável (FK)".

---

## Mapa dos arquivos

| Arquivo | Responsabilidade |
|---|---|
| `db/migrations/2026-08-13-cadastro-rapido-de-pessoa.sql` (criar) | as 5 funções do banco |
| `src/compartilhado/nova-opcao.js` (mover de `ferramentas/patrimonio/`) | regra de nome repetido, agora com 3 donos |
| `src/compartilhado/nova-opcao.test.mjs` (mover junto) | teste dela |
| `src/compartilhado/pessoas-para-escolher.js` (criar) | mesclar as duas listas, montar os dados do cadastro rápido, listar cargos já usados |
| `src/compartilhado/pessoas-para-escolher.test.mjs` (criar) | teste dela |
| `src/compartilhado/escolha-de-pessoa.vue` (criar) | o `select` + `+` + a caixinha, sem tocar no banco |
| `src/ferramentas/patrimonio/tela-de-patrimonio.vue` (modificar) | 2 campos + carregamento pela porta estreita |
| `src/ferramentas/frota/tela-de-frota.vue` (modificar) | 4 campos + carregamento pela porta estreita |
| `src/compartilhado/escolha-de-local-e-ambiente.vue` (modificar) | 1 linha de import que muda de lugar |
| `src/ferramentas/patrimonio/LEIA-ME.txt` (modificar) | tirar a linha do arquivo que saiu |

---

## Tarefa 1: As funções no banco

**Arquivos:**
- Criar: `db/migrations/2026-08-13-cadastro-rapido-de-pessoa.sql`

**Interfaces:**
- Consome: `is_acessos_admin()`, `is_patrimonio_admin()`, `is_frota_admin()` (já existem).
- Entrega, para as tarefas 5 e 6:
  - `pessoas_para_escolher()` → linhas `{ id uuid, nome text, status text, cargo text, profile_id uuid }`
  - `setores_para_escolher()` → linhas `{ id uuid, nome text }`
  - `criar_pessoa_rapida(p_nome text, p_cargo text, p_marca_id uuid, p_setor_id uuid)` →
    uma linha `{ id, nome, status, cargo, profile_id, ja_existia boolean }`
  - `criar_setor_rapido(p_nome text)` → uma linha `{ id, nome, ja_existia boolean }`
  - `pode_cadastrar_pessoa_rapida()` → `boolean`

- [ ] **Passo 1: provar que hoje falha, com o login do Gabriel Alves**

Rodar pelo MCP do Supabase (`execute_sql`, projeto `kounqtdoioootxqegkij`):

```sql
begin;
select set_config('request.jwt.claims',
  json_build_object('sub', (select id from profiles where email='gabriel.alves@rbvcompany.com'),
                    'role','authenticated')::text, true);
set local role authenticated;
select * from public.pessoas_para_escolher();
rollback;
```

Esperado: **erro** `function public.pessoas_para_escolher() does not exist`.

Guardar também o retrato de hoje, que é o defeito que se está consertando:

```sql
begin;
select set_config('request.jwt.claims',
  json_build_object('sub', (select id from profiles where email='gabriel.alves@rbvcompany.com'),
                    'role','authenticated')::text, true);
set local role authenticated;
select (select count(*) from acessos_pessoas) as pessoas,
       (select count(*) from acessos_setores) as setores;
rollback;
```

Esperado: `pessoas = 0`, `setores = 0`.

- [ ] **Passo 2: escrever a migration**

Criar `db/migrations/2026-08-13-cadastro-rapido-de-pessoa.sql` com exatamente isto:

```sql
-- Cadastro rápido de colaborador nos campos de pessoa do Patrimônio e da Frota.
-- Desenho: docs/superpowers/specs/2026-08-13-cadastro-rapido-de-pessoa-design.md
--
-- POR QUE ESTE ARQUIVO EXISTE: em 13/08/2026 o dono pediu para cadastrar na hora
-- o colaborador que ainda não existe, sem sair do formulário do bem ou do carro.
-- Ao medir, apareceu um defeito maior por trás: Gabriel Alves, Guilherme Cardoso
-- e Jeremias Vieira mexem na Frota e enxergam ZERO colaboradores e ZERO setores,
-- porque `acessos_pessoas` e `acessos_setores` só abrem para is_acessos_admin().
-- Para os três, o campo "Responsável — de quem é o carro" já está vazio hoje.
--
-- A SAÍDA ESCOLHIDA foi a PORTA ESTREITA: nenhuma policy é afrouxada. Quem mexe
-- em Patrimônio/Frota passa por estas funções, que entregam nome, cargo,
-- situação e o elo com o login — e NUNCA e-mail, celular ou conta Apple.

-- ── Quem pode ───────────────────────────────────────────────────────────────
-- Uma função só, para a regra não divergir entre os quatro lugares que a usam.
create or replace function public.pode_cadastrar_pessoa_rapida()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(public.is_acessos_admin(), false)
      or coalesce(public.is_patrimonio_admin(), false)
      or coalesce(public.is_frota_admin(), false);
$$;

revoke execute on function public.pode_cadastrar_pessoa_rapida() from public;
revoke execute on function public.pode_cadastrar_pessoa_rapida() from anon;
grant  execute on function public.pode_cadastrar_pessoa_rapida() to authenticated;

-- ── Ler os nomes ────────────────────────────────────────────────────────────
-- ESTOURA em vez de devolver lista vazia. Vazio silencioso é o defeito que já
-- mostrou R$ 0,00 na tela do dono por 17 horas: "não tenho acesso" e "não tem
-- ninguém cadastrado" não podem chegar iguais na tela.
create or replace function public.pessoas_para_escolher()
returns table(id uuid, nome text, status text, cargo text, profile_id uuid)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.pode_cadastrar_pessoa_rapida() then
    raise exception 'Sem acesso à lista de colaboradores' using errcode = '42501';
  end if;
  return query
    select p.id, p.nome, p.status, p.cargo, p.profile_id
      from public.acessos_pessoas p
     order by p.nome;
end;
$$;

revoke execute on function public.pessoas_para_escolher() from public;
revoke execute on function public.pessoas_para_escolher() from anon;
grant  execute on function public.pessoas_para_escolher() to authenticated;

create or replace function public.setores_para_escolher()
returns table(id uuid, nome text)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.pode_cadastrar_pessoa_rapida() then
    raise exception 'Sem acesso à lista de setores' using errcode = '42501';
  end if;
  return query
    select s.id, s.nome from public.acessos_setores s order by s.ordem, s.nome;
end;
$$;

revoke execute on function public.setores_para_escolher() from public;
revoke execute on function public.setores_para_escolher() from anon;
grant  execute on function public.setores_para_escolher() to authenticated;

-- ── Criar o colaborador que faltou ──────────────────────────────────────────
-- NOME REPETIDO NÃO ENTRA, e a checagem mora AQUI e não só na tela: duas
-- pessoas cadastrando em janelas diferentes é justamente o caso que a tela
-- sozinha não cobre.
--
-- `acessos_pessoas.nome` NÃO ganha unique de propósito: um dia pode existir
-- homônimo de verdade, e uma trava dura impediria o cadastro legítimo. Quem
-- precisa do homônimo cria pela tela de Colaboradores, decidindo com calma.
-- Por isso a trava aqui é uma FILA por nome (advisory lock da transação): duas
-- chamadas simultâneas com o mesmo nome entram uma de cada vez, e a segunda
-- encontra o que a primeira criou em vez de criar a segunda linha.
create or replace function public.criar_pessoa_rapida(
  p_nome     text,
  p_cargo    text default null,
  p_marca_id uuid default null,
  p_setor_id uuid default null)
returns table(id uuid, nome text, status text, cargo text, profile_id uuid, ja_existia boolean)
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_nome   text := btrim(coalesce(p_nome, ''));
  v_cargo  text := nullif(btrim(coalesce(p_cargo, '')), '');
  v_achada public.acessos_pessoas%rowtype;
begin
  if not public.pode_cadastrar_pessoa_rapida() then
    raise exception 'Sem acesso para cadastrar colaborador' using errcode = '42501';
  end if;
  if v_nome = '' then
    raise exception 'Digite o nome antes de criar.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('pessoa-rapida:' || lower(v_nome)));

  select * into v_achada
    from public.acessos_pessoas p
   where lower(btrim(p.nome)) = lower(v_nome)
   limit 1;

  if found then
    return query select v_achada.id, v_achada.nome, v_achada.status,
                        v_achada.cargo, v_achada.profile_id, true;
    return;
  end if;

  return query
    insert into public.acessos_pessoas (nome, cargo, marca_id, setor_id)
    values (v_nome, v_cargo, p_marca_id, p_setor_id)
    returning acessos_pessoas.id, acessos_pessoas.nome, acessos_pessoas.status,
              acessos_pessoas.cargo, acessos_pessoas.profile_id, false;
end;
$$;

revoke execute on function public.criar_pessoa_rapida(text, text, uuid, uuid) from public;
revoke execute on function public.criar_pessoa_rapida(text, text, uuid, uuid) from anon;
grant  execute on function public.criar_pessoa_rapida(text, text, uuid, uuid) to authenticated;

-- ── Criar o setor que faltou ────────────────────────────────────────────────
-- `acessos_setores.nome` já é unique; devolver o que existe evita o erro cru do
-- banco chegar à tela ("duplicate key value violates...").
create or replace function public.criar_setor_rapido(p_nome text)
returns table(id uuid, nome text, ja_existia boolean)
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_nome   text := btrim(coalesce(p_nome, ''));
  v_achado public.acessos_setores%rowtype;
begin
  if not public.pode_cadastrar_pessoa_rapida() then
    raise exception 'Sem acesso para cadastrar setor' using errcode = '42501';
  end if;
  if v_nome = '' then
    raise exception 'Digite o nome antes de criar.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('setor-rapido:' || lower(v_nome)));

  select * into v_achado
    from public.acessos_setores s
   where lower(btrim(s.nome)) = lower(v_nome)
   limit 1;

  if found then
    return query select v_achado.id, v_achado.nome, true;
    return;
  end if;

  return query
    insert into public.acessos_setores (nome, ordem)
    values (v_nome, coalesce((select max(ordem) from public.acessos_setores), 0) + 1)
    returning acessos_setores.id, acessos_setores.nome, false;
end;
$$;

revoke execute on function public.criar_setor_rapido(text) from public;
revoke execute on function public.criar_setor_rapido(text) from anon;
grant  execute on function public.criar_setor_rapido(text) to authenticated;

-- MARCA não precisa de função nova: patrimonio_empresas já tem
-- `patrimonio_empresas_leitura_frota` e `patrimonio_empresas_criar_frota`, além
-- da policy do Patrimônio. Quem mexe em qualquer um dos dois já lê e cria marca.
```

- [ ] **Passo 3: aplicar a migration**

Pelo MCP do Supabase, `apply_migration`, projeto `kounqtdoioootxqegkij`, nome
`cadastro_rapido_de_pessoa`, com o conteúdo do arquivo acima.

- [ ] **Passo 4: provar que o Gabriel Alves passou a enxergar e a poder criar**

Tudo dentro de `begin … rollback` — nada fica gravado:

```sql
begin;
select set_config('request.jwt.claims',
  json_build_object('sub', (select id from profiles where email='gabriel.alves@rbvcompany.com'),
                    'role','authenticated')::text, true);
set local role authenticated;

select count(*) as nomes_que_ele_ve from public.pessoas_para_escolher();
select count(*) as setores_que_ele_ve from public.setores_para_escolher();
select * from public.criar_pessoa_rapida('Teste Rollback Nao Fica', 'Modelista', null, null);
select * from public.criar_pessoa_rapida('  teste rollback nao fica  ');
rollback;
```

Esperado: `nomes_que_ele_ve = 28`, `setores_que_ele_ve = 14`, a primeira chamada volta com
`ja_existia = false`, a segunda com `ja_existia = true` **e o mesmo `id`** (é a prova do
nome repetido, com grafia e espaços diferentes).

Depois do `rollback`, conferir que nada sobrou:

```sql
select count(*) as tem_que_ser_zero from acessos_pessoas where nome ilike '%rollback%';
```

Esperado: `0`.

- [ ] **Passo 5: provar que quem não tem nada continua barrado**

```sql
begin;
select set_config('request.jwt.claims',
  json_build_object('sub', (select id from profiles
                            where role <> 'admin'
                              and not coalesce(features,'{}') && array['acessos','patrimonio','frota']
                            limit 1),
                    'role','authenticated')::text, true);
set local role authenticated;
select * from public.pessoas_para_escolher();
rollback;
```

Esperado: **erro** "Sem acesso à lista de colaboradores". Se a consulta interna não achar
ninguém sem nenhuma das três permissões, anotar isso no relato e pular o passo — não
inventar um perfil de teste no banco.

- [ ] **Passo 6: conferir o aviso de segurança do Supabase**

Rodar `get_advisors` (tipo `security`) pelo MCP. Esperado: nenhum aviso **novo** sobre as
funções criadas. `search_path` já está fixado em todas.

- [ ] **Passo 7: commit**

```bash
git add db/migrations/2026-08-13-cadastro-rapido-de-pessoa.sql
git commit -m "Banco: quem cadastra bem ou carro passa a ver e criar colaborador"
```

---

## Tarefa 2: `nova-opcao.js` vira compartilhado

A regra de nome repetido passa a ter três donos (Patrimônio, a escolha de local e a
escolha de pessoa). Um arquivo de `compartilhado/` importando de
`ferramentas/patrimonio/` é a seta apontando para o lado errado — e hoje é exatamente o
que acontece.

**Arquivos:**
- Mover: `src/ferramentas/patrimonio/nova-opcao.js` → `src/compartilhado/nova-opcao.js`
- Mover: `src/ferramentas/patrimonio/nova-opcao.test.mjs` → `src/compartilhado/nova-opcao.test.mjs`
- Modificar: `src/compartilhado/escolha-de-local-e-ambiente.vue:220`
- Modificar: `src/ferramentas/patrimonio/tela-de-patrimonio.vue:895`
- Modificar: `src/ferramentas/patrimonio/LEIA-ME.txt:15`

**Interfaces:**
- Consome: nada.
- Entrega: `resolverNovaOpcao(nomeDigitado, itensExistentes)` e `normalizarNome(nome)`,
  agora em `src/compartilhado/nova-opcao.js`. Assinaturas **não mudam**.

- [ ] **Passo 1: mover os dois arquivos**

```bash
git mv src/ferramentas/patrimonio/nova-opcao.js      src/compartilhado/nova-opcao.js
git mv src/ferramentas/patrimonio/nova-opcao.test.mjs src/compartilhado/nova-opcao.test.mjs
```

- [ ] **Passo 2: rodar o teste movido e ver ele passar**

```bash
node --test src/compartilhado/nova-opcao.test.mjs
```

Esperado: PASS. O teste não importa nada de fora, então mudar de pasta não o quebra. Se
falhar por caminho de import, corrigir o import dentro do próprio teste para `./nova-opcao.js`.

- [ ] **Passo 3: apontar os dois importadores para o lugar novo**

Em `src/compartilhado/escolha-de-local-e-ambiente.vue`, trocar:

```js
import { resolverNovaOpcao, normalizarNome } from '../ferramentas/patrimonio/nova-opcao.js'
```

por:

```js
import { resolverNovaOpcao, normalizarNome } from './nova-opcao.js'
```

Em `src/ferramentas/patrimonio/tela-de-patrimonio.vue`, trocar:

```js
import { resolverNovaOpcao } from './nova-opcao.js'
```

por:

```js
import { resolverNovaOpcao } from '../../compartilhado/nova-opcao.js'
```

- [ ] **Passo 4: atualizar o LEIA-ME da pasta**

Em `src/ferramentas/patrimonio/LEIA-ME.txt`, apagar a linha:

```
  nova-opcao.js           o "+" que cria empresa/categoria/local/ambiente/tipo
```

e pôr no lugar:

```
  (a regra do "+" saiu daqui para src/compartilhado/nova-opcao.js — agora ela
   também serve a escolha de local e a escolha de pessoa)
```

- [ ] **Passo 5: suíte inteira e build**

```bash
npm test
npm run build
```

Esperado: os dois passam. O build é obrigatório aqui: import quebrado em `.vue` **não**
aparece no `node --test`.

- [ ] **Passo 6: commit**

```bash
git add src/compartilhado/nova-opcao.js src/compartilhado/nova-opcao.test.mjs \
        src/compartilhado/escolha-de-local-e-ambiente.vue \
        src/ferramentas/patrimonio/tela-de-patrimonio.vue \
        src/ferramentas/patrimonio/LEIA-ME.txt
git commit -m "A regra do + sai do Patrimonio e vira compartilhada"
```

---

## Tarefa 3: a lógica pura da escolha de pessoa

**Arquivos:**
- Criar: `src/compartilhado/pessoas-para-escolher.js`
- Criar: `src/compartilhado/pessoas-para-escolher.test.mjs`

**Interfaces:**
- Consome: nada.
- Entrega, para as tarefas 4, 5 e 6:
  - `mesclarPessoas(nomes, contatos)` → `Array<{id, nome, status, cargo, profile_id, ...contato}>`
  - `apenasAtivas(pessoas)` → mesma forma, só `status !== 'desligado'`
  - `cargosConhecidos(pessoas)` → `Array<string>` sem repetição, em ordem
  - `dadosDaPessoaRapida({ nome, cargo, marcaId, setorId })` →
    `{ ok: true, dados: { p_nome, p_cargo, p_marca_id, p_setor_id } }` ou
    `{ ok: false, mensagem }`

- [ ] **Passo 1: escrever o teste que falha**

Criar `src/compartilhado/pessoas-para-escolher.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  mesclarPessoas, apenasAtivas, cargosConhecidos, dadosDaPessoaRapida,
} from './pessoas-para-escolher.js'

// A porta estreita devolve nome/cargo/situação; a leitura direta da tabela
// devolve os contatos, e só chega para quem tem Colaboradores e Acessos. A tela
// precisa das duas metades na mesma lista, sem duplicar ninguém.
test('mesclar junta a lista de nomes com a de contatos pelo id', () => {
  const nomes = [
    { id: 'a', nome: 'Ana', status: 'ativo', cargo: 'RH', profile_id: null },
    { id: 'b', nome: 'Bruno', status: 'ativo', cargo: null, profile_id: 'u1' },
  ]
  const contatos = [{ id: 'b', nome: 'Bruno', numero_pessoal: '19999', email_corporativo: 'b@x' }]
  const junto = mesclarPessoas(nomes, contatos)

  assert.equal(junto.length, 2)
  assert.equal(junto.find((p) => p.id === 'b').numero_pessoal, '19999')
  assert.equal(junto.find((p) => p.id === 'b').profile_id, 'u1')
  assert.equal(junto.find((p) => p.id === 'a').numero_pessoal, undefined)
})

test('mesclar aguenta a lista de contatos vazia — é o caso de quem não tem Acessos', () => {
  const nomes = [{ id: 'a', nome: 'Ana', status: 'ativo' }]
  assert.deepEqual(mesclarPessoas(nomes, []), nomes)
  assert.deepEqual(mesclarPessoas(nomes, null), nomes)
})

// Quem só aparece na lista de contatos e não na de nomes não pode sumir: seria
// dado a menos sem ninguém avisar.
test('mesclar não perde quem só existe na lista de contatos', () => {
  const junto = mesclarPessoas([], [{ id: 'z', nome: 'Zeca' }])
  assert.deepEqual(junto.map((p) => p.id), ['z'])
})

test('mesclar devolve em ordem de nome, ignorando maiúsculas', () => {
  const junto = mesclarPessoas(
    [{ id: '1', nome: 'bruno' }, { id: '2', nome: 'Ana' }, { id: '3', nome: 'Carlos' }], [])
  assert.deepEqual(junto.map((p) => p.nome), ['Ana', 'bruno', 'Carlos'])
})

test('só as ativas — desligado não aparece em campo de escolha', () => {
  const lista = [
    { id: 'a', nome: 'Ana', status: 'ativo' },
    { id: 'b', nome: 'Bruno', status: 'desligado' },
    { id: 'c', nome: 'Célia' },
  ]
  assert.deepEqual(apenasAtivas(lista).map((p) => p.id), ['a', 'c'])
})

test('cargos já usados viram sugestão, sem repetir e sem vazio', () => {
  const lista = [
    { id: 'a', cargo: 'Modelista' }, { id: 'b', cargo: 'modelista' },
    { id: 'c', cargo: '  ' }, { id: 'd', cargo: null }, { id: 'e', cargo: 'Costureira' },
  ]
  assert.deepEqual(cargosConhecidos(lista), ['Costureira', 'Modelista'])
})

test('nome vazio não vira cadastro', () => {
  const r = dadosDaPessoaRapida({ nome: '   ' })
  assert.equal(r.ok, false)
  assert.match(r.mensagem, /nome/i)
})

test('os dados vão aparados, e o que está em branco vai como nada', () => {
  const r = dadosDaPessoaRapida({
    nome: '  Maria Souza ', cargo: '  ', marcaId: '', setorId: 'set-1',
  })
  assert.deepEqual(r, {
    ok: true,
    dados: { p_nome: 'Maria Souza', p_cargo: null, p_marca_id: null, p_setor_id: 'set-1' },
  })
})
```

- [ ] **Passo 2: rodar e ver falhar**

```bash
node --test src/compartilhado/pessoas-para-escolher.test.mjs
```

Esperado: FALHA com `Cannot find module .../pessoas-para-escolher.js`.

- [ ] **Passo 3: escrever o módulo**

Criar `src/compartilhado/pessoas-para-escolher.js`:

```js
// A LISTA DE COLABORADORES COMO O PATRIMÔNIO E A FROTA PRECISAM DELA.
//
// POR QUE ESTE ARQUIVO EXISTE: a tabela `acessos_pessoas` só abre para quem tem
// Colaboradores e Acessos. Medido em 13/08/2026: Gabriel Alves, Guilherme
// Cardoso e Jeremias Vieira mexem na Frota e enxergavam ZERO pessoas — o campo
// "Responsável — de quem é o carro" nascia vazio para eles.
//
// A saída foi a porta estreita: a função `pessoas_para_escolher()` do banco
// entrega nome, cargo, situação e o elo com o login para quem mexe em
// Patrimônio/Frota, e NUNCA e-mail nem telefone. Quem tem Colaboradores e
// Acessos continua lendo a tabela direto, e é dali que vêm os contatos (a Frota
// usa o celular para cobrar multa).
//
// Duas leituras, uma lista só: é isso que este módulo faz.

// Junta pelo id. O que veio da leitura direta (contatos) entra por cima, porque
// é a fonte mais completa; quem só existe num dos dois lados continua na lista.
export function mesclarPessoas(nomes, contatos) {
  const mapa = new Map()
  for (const p of nomes || []) if (p && p.id) mapa.set(p.id, { ...p })
  for (const c of contatos || []) {
    if (!c || !c.id) continue
    mapa.set(c.id, { ...(mapa.get(c.id) || {}), ...c })
  }
  return [...mapa.values()].sort((a, b) =>
    String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR', { sensitivity: 'base' }))
}

// Campo de escolher pessoa mostra quem trabalha aqui hoje. Ficha sem `status`
// conta como ativa: a coluna tem padrão 'ativo' no banco, e sumir com alguém por
// causa de campo vazio seria dado a menos sem avisar.
export function apenasAtivas(pessoas) {
  return (pessoas || []).filter((p) => p && p.status !== 'desligado')
}

// Os cargos que já existem viram sugestão do campo de digitar. Não vira lista
// cadastrada: 23 das 28 pessoas estão sem cargo, e uma tabela nasceria com ~5
// valores para manter, sem ganho nenhum.
export function cargosConhecidos(pessoas) {
  const vistos = new Map()
  for (const p of pessoas || []) {
    const cargo = String((p && p.cargo) || '').trim()
    if (!cargo) continue
    const chave = cargo.toLowerCase()
    if (!vistos.has(chave)) vistos.set(chave, cargo)
  }
  return [...vistos.values()].sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }))
}

// Os argumentos da chamada `criar_pessoa_rapida` no banco. Só o nome é
// obrigatório: exigir marca e setor criaria uma trava nova no lugar da que se
// está tirando (16 das 28 pessoas de hoje estão sem marca, 15 sem setor).
export function dadosDaPessoaRapida({ nome, cargo, marcaId, setorId } = {}) {
  const limpo = String(nome || '').trim()
  if (!limpo) return { ok: false, mensagem: 'Digite o nome da pessoa antes de criar.' }
  return {
    ok: true,
    dados: {
      p_nome: limpo,
      p_cargo: String(cargo || '').trim() || null,
      p_marca_id: marcaId || null,
      p_setor_id: setorId || null,
    },
  }
}
```

- [ ] **Passo 4: rodar e ver passar**

```bash
node --test src/compartilhado/pessoas-para-escolher.test.mjs
```

Esperado: 8 testes PASS.

- [ ] **Passo 5: commit**

```bash
git add src/compartilhado/pessoas-para-escolher.js src/compartilhado/pessoas-para-escolher.test.mjs
git commit -m "A lista de colaboradores como as duas telas precisam dela"
```

---

## Tarefa 4: o componente `escolha-de-pessoa.vue`

**Arquivos:**
- Criar: `src/compartilhado/escolha-de-pessoa.vue`

**Interfaces:**
- Consome: `resolverNovaOpcao`, `normalizarNome` (tarefa 2); `cargosConhecidos`,
  `dadosDaPessoaRapida` (tarefa 3).
- Entrega, para as tarefas 5 e 6, este contrato:

```html
<escolha-de-pessoa
  v-model="form.pessoa_id"
  :pessoas="pessoasAtivas" :marcas="empresas" :setores="setores"
  :pode-criar="podeEditar" :criando="criandoPessoa" :recado-de-erro="erroDePessoa"
  rotulo="Com quem está" texto-vazio="Ninguém"
  @criar="criarPessoaRapida" @criar-setor="criarSetorRapido" @criar-marca="criarMarcaRapida">
  <option :value="DE_FORA">— outra pessoa, de fora da empresa —</option>
</escolha-de-pessoa>
```

- `@criar` recebe `{ nome, cargo, marcaId, setorId }`
- `@criar-setor` e `@criar-marca` recebem `{ nome }`
- O que vier dentro da etiqueta (o `<slot>`) aparece **depois** dos nomes, no mesmo
  `select` — é onde a Frota mantém a opção "outra pessoa, de fora da empresa".
- **O componente não toca no banco.** Quem grava e recarrega é a tela; a caixinha se
  fecha sozinha quando o nome criado aparece nas props, e fica aberta com o que foi
  digitado se a gravação falhar.

- [ ] **Passo 1: escrever o componente**

Criar `src/compartilhado/escolha-de-pessoa.vue`:

```html
<template>
  <div class="esc-pessoa">
    <div class="esc-pessoa-linha">
      <select class="esc-pessoa-campo" :value="modelValue" :disabled="desabilitado"
              :aria-label="rotulo" @change="$emit('update:modelValue', $event.target.value)">
        <option value="">{{ textoVazio }}</option>
        <option v-for="p in pessoas" :key="p.id" :value="p.id">{{ p.nome }}</option>
        <!-- A Frota põe aqui a opção "de fora da empresa": quem não é da casa
             continua tendo por onde entrar, sem virar cadastro. -->
        <slot />
      </select>
      <button v-if="podeCriar" type="button" class="esc-pessoa-mais"
              :title="'Cadastrar um colaborador novo'" aria-label="Cadastrar um colaborador novo"
              @click="abrirCaixinha">+</button>
    </div>

    <!-- A caixinha nasce e morre aqui: some ao criar, ao cancelar e ao trocar de
         ficha, pra nunca ficar aberta numa pergunta que já foi respondida. -->
    <div v-if="aberta" class="esc-pessoa-caixa">
      <p class="esc-pessoa-titulo">Cadastrar quem ainda não está na lista</p>

      <label class="esc-pessoa-rotulo">
        Nome completo
        <input v-model="novo.nome" ref="campoNome" type="text" class="esc-pessoa-entrada"
               placeholder="Ex.: Maria Souza"
               @keyup.enter="confirmar" @keyup.esc.stop="cancelar">
      </label>

      <label class="esc-pessoa-rotulo">
        Cargo <em class="esc-pessoa-opcional">(opcional)</em>
        <input v-model="novo.cargo" type="text" class="esc-pessoa-entrada"
               :list="idDaListaDeCargos" placeholder="Ex.: Modelista"
               @keyup.enter="confirmar" @keyup.esc.stop="cancelar">
      </label>
      <!-- Sugestão, não trava: digitar um cargo que não existe continua valendo. -->
      <datalist :id="idDaListaDeCargos">
        <option v-for="c in cargos" :key="c" :value="c"></option>
      </datalist>

      <label class="esc-pessoa-rotulo">
        Marca <em class="esc-pessoa-opcional">(opcional)</em>
        <span class="esc-pessoa-linha">
          <select v-model="novo.marcaId" class="esc-pessoa-campo">
            <option value="">—</option>
            <option v-for="m in marcas" :key="m.id" :value="m.id">{{ m.nome }}</option>
          </select>
          <button type="button" class="esc-pessoa-mais" title="Cadastrar uma marca nova"
                  aria-label="Cadastrar uma marca nova" @click="abrirSub('marca')">+</button>
        </span>
      </label>

      <label class="esc-pessoa-rotulo">
        Setor <em class="esc-pessoa-opcional">(opcional)</em>
        <span class="esc-pessoa-linha">
          <select v-model="novo.setorId" class="esc-pessoa-campo">
            <option value="">—</option>
            <option v-for="s in setores" :key="s.id" :value="s.id">{{ s.nome }}</option>
          </select>
          <button type="button" class="esc-pessoa-mais" title="Cadastrar um setor novo"
                  aria-label="Cadastrar um setor novo" @click="abrirSub('setor')">+</button>
        </span>
      </label>

      <!-- A caixinha de dentro: criar a marca ou o setor que falta, sem fechar a
           de fora e sem perder o nome já digitado. -->
      <div v-if="sub" class="esc-pessoa-sub">
        <input v-model="subNome" ref="campoSub" type="text" class="esc-pessoa-entrada"
               :placeholder="sub === 'marca' ? 'Nome da marca nova…' : 'Nome do setor novo…'"
               @keyup.enter.stop="confirmarSub" @keyup.esc.stop="cancelarSub">
        <div class="esc-pessoa-botoes">
          <button type="button" class="btn btn-principal" :disabled="criando" @click="confirmarSub">
            {{ criando ? 'Criando…' : 'Criar' }}
          </button>
          <button type="button" class="btn" @click="cancelarSub">Cancelar</button>
        </div>
      </div>

      <p v-if="recado" class="esc-pessoa-recado">{{ recado }}</p>
      <p v-if="recadoDeErro" class="esc-pessoa-recado esc-pessoa-recado-erro">{{ recadoDeErro }}</p>

      <div class="esc-pessoa-botoes">
        <button type="button" class="btn btn-principal" :disabled="criando" @click="confirmar">
          {{ criando ? 'Criando…' : 'Criar e usar' }}
        </button>
        <button type="button" class="btn" @click="cancelar">Cancelar</button>
      </div>

      <p class="esc-pessoa-nota">
        Isto cria só a ficha da pessoa, para o bem ou o carro sair no nome certo. E-mail,
        telefone e acesso ao aplicativo continuam sendo cadastrados em Colaboradores e Acessos.
      </p>
    </div>
  </div>
</template>

<script setup>
/* ESCOLHER A PESSOA — E CADASTRAR NA HORA A QUE FALTAR.
 *
 * Pedido do dono em 13/08/2026: "quando vou cadastrar um patrimônio ou veículo
 * em um colaborador não cadastrado, quero que permita eu cadastrar de forma
 * rápida ali na hora só para sair no nome da pessoa correta" — e, logo depois,
 * "campos como marca, setor, cargo, também com possibilidade de adicionar novos".
 *
 * É a regra do "+" (que já vale para marca, local, ambiente e tipo desde
 * 07/08/2026) chegando ao campo de pessoa. A exceção escrita naquela época
 * ("pessoa vem de outro cadastro, criar gente aqui seria errado") foi derrubada
 * pelo dono depois de ver que ela trava quem está cadastrando.
 *
 * MESMO CONTRATO do escolha-de-local-e-ambiente.vue, de propósito: o componente
 * NÃO toca no banco. Ele avisa "criar isto" e espera o nome aparecer nas props.
 * Quem sabe de tabela e de permissão é a tela. Se a gravação falhar, a caixinha
 * fica aberta com o que foi digitado, em vez de sumir fingindo que criou. */
import { ref, reactive, computed, watch, nextTick } from 'vue'
import { resolverNovaOpcao, normalizarNome } from './nova-opcao.js'
import { cargosConhecidos, dadosDaPessoaRapida } from './pessoas-para-escolher.js'

const props = defineProps({
  modelValue: { type: String, default: '' },
  // Já vem pronta da tela: mesclada e só com as ativas.
  pessoas: { type: Array, default: () => [] },   // { id, nome, status, cargo }
  marcas: { type: Array, default: () => [] },    // { id, nome }
  setores: { type: Array, default: () => [] },   // { id, nome }

  // Quem não pode cadastrar não vê o "+", mas continua escolhendo da lista.
  podeCriar: { type: Boolean, default: false },
  // A tela avisa que está gravando, pro botão dizer "Criando…" e não aceitar
  // dois toques.
  criando: { type: Boolean, default: false },
  // O erro da gravação, em português, vindo da tela.
  recadoDeErro: { type: String, default: '' },

  desabilitado: { type: Boolean, default: false },
  rotulo: { type: String, default: 'Pessoa' },
  textoVazio: { type: String, default: '— ninguém —' },
})

const emit = defineEmits(['update:modelValue', 'criar', 'criar-setor', 'criar-marca'])

// Um id por instância: há mais de um campo de pessoa na mesma tela, e datalist
// com id repetido faz a sugestão de um campo aparecer no outro.
let contador = 0
const idDaListaDeCargos = `esc-pessoa-cargos-${++contador}`

const cargos = computed(() => cargosConhecidos(props.pessoas))

const aberta = ref(false)
const novo = reactive({ nome: '', cargo: '', marcaId: '', setorId: '' })
const recado = ref('')
const campoNome = ref(null)
// O nome que foi mandado criar e ainda não voltou nas props.
const esperando = ref(null)

async function abrirCaixinha() {
  aberta.value = true
  novo.nome = ''
  novo.cargo = ''
  novo.marcaId = ''
  novo.setorId = ''
  recado.value = ''
  esperando.value = null
  await nextTick()
  if (campoNome.value && campoNome.value.focus) campoNome.value.focus()
}

function cancelar() {
  aberta.value = false
  sub.value = ''
  subNome.value = ''
  recado.value = ''
  esperando.value = null
}

function confirmar() {
  const dados = dadosDaPessoaRapida({
    nome: novo.nome, cargo: novo.cargo, marcaId: novo.marcaId, setorId: novo.setorId,
  })
  if (!dados.ok) { recado.value = dados.mensagem; return }

  // Nome repetido não cria a segunda pessoa: aponta pra que já está lá. O banco
  // faz a mesma checagem — aqui é só pra pessoa saber na hora, sem ida e volta.
  const r = resolverNovaOpcao(novo.nome, props.pessoas)
  if (r.ok && r.jaExistia) {
    emit('update:modelValue', r.item.id)
    recado.value = `“${r.item.nome}” já estava cadastrada — deixei essa selecionada.`
    aberta.value = false
    return
  }

  esperando.value = normalizarNome(dados.dados.p_nome)
  emit('criar', {
    nome: dados.dados.p_nome, cargo: dados.dados.p_cargo,
    marcaId: dados.dados.p_marca_id, setorId: dados.dados.p_setor_id,
  })
}

// A caixinha fecha quando a pessoa nova APARECE NAS PROPS — ou seja, quando a
// tela gravou e recarregou de verdade.
watch(() => props.pessoas, () => {
  if (!esperando.value) return
  const achada = (props.pessoas || []).find((p) => normalizarNome(p?.nome) === esperando.value)
  if (!achada) return
  emit('update:modelValue', achada.id)
  esperando.value = null
  aberta.value = false
  recado.value = ''
})

// ── O "+" de dentro: marca e setor ──────────────────────────────────────────
const sub = ref('')          // '' | 'marca' | 'setor'
const subNome = ref('')
const campoSub = ref(null)
const esperandoSub = ref(null)

async function abrirSub(qual) {
  sub.value = qual
  subNome.value = ''
  recado.value = ''
  esperandoSub.value = null
  await nextTick()
  if (campoSub.value && campoSub.value.focus) campoSub.value.focus()
}

function cancelarSub() {
  sub.value = ''
  subNome.value = ''
  esperandoSub.value = null
}

function confirmarSub() {
  const lista = sub.value === 'marca' ? props.marcas : props.setores
  const r = resolverNovaOpcao(subNome.value, lista)
  if (!r.ok) { recado.value = r.mensagem; return }

  if (r.jaExistia) {
    if (sub.value === 'marca') novo.marcaId = r.item.id
    else novo.setorId = r.item.id
    recado.value = `“${r.item.nome}” já existia — deixei essa selecionada.`
    cancelarSub()
    return
  }

  esperandoSub.value = { qual: sub.value, chave: normalizarNome(r.nome) }
  emit(sub.value === 'marca' ? 'criar-marca' : 'criar-setor', { nome: r.nome })
}

watch(() => [props.marcas, props.setores], () => {
  const alvo = esperandoSub.value
  if (!alvo) return
  const lista = alvo.qual === 'marca' ? props.marcas : props.setores
  const achado = (lista || []).find((x) => normalizarNome(x?.nome) === alvo.chave)
  if (!achado) return
  if (alvo.qual === 'marca') novo.marcaId = achado.id
  else novo.setorId = achado.id
  recado.value = `“${achado.nome}” criado.`
  cancelarSub()
})
</script>

<style scoped>
/* Nomes prefixados com esc-pessoa- de propósito: o estilos-globais.css tem
   classes genéricas e já houve colisão entre global e scoped neste projeto.
   Toda cor sai de token — este componente vive em ficha dentro de modal, no
   tema claro e no escuro. */
.esc-pessoa{ display:flex; flex-direction:column; gap:var(--sp-2); min-width:0; }

.esc-pessoa-linha{ display:flex; gap:var(--sp-2); align-items:stretch; min-width:0; }

/* 16px não é estética: abaixo disso o iOS dá zoom ao focar e a tela salta. */
.esc-pessoa-campo{
  flex:1; min-width:0; min-height:44px;
  padding:0 var(--sp-3);
  font-family:inherit; font-size:max(16px, calc(16px * var(--escala-texto, 1))); color:var(--text);
  background:var(--surface); border:1px solid var(--border); border-radius:var(--radius-md);
}
.esc-pessoa-campo:focus{ outline:2px solid var(--accent); outline-offset:-1px; }

/* Mesmo "+" da escolha de local: um jeito só de cadastrar o que falta em toda a
   Central. 44px de alvo porque o dedo erra. */
.esc-pessoa-mais{
  flex-shrink:0; width:44px; min-height:44px;
  border:1px solid var(--border); border-radius:var(--radius-md);
  background:var(--surface); color:var(--accent);
  font-family:inherit; font-size:max(16px, calc(20px * var(--escala-texto, 1))); line-height:1;
  cursor:pointer; touch-action:manipulation;
}
.esc-pessoa-mais:hover:not(:disabled){ border-color:var(--accent); }
.esc-pessoa-mais:disabled{ opacity:.4; cursor:not-allowed; }

.esc-pessoa-caixa{
  display:flex; flex-direction:column; gap:var(--sp-2);
  padding:var(--sp-3);
  border:1px solid var(--accent-mid); border-radius:var(--radius-lg);
  background:var(--surface2);
}
.esc-pessoa-titulo{
  margin:0; font-size:max(9px, calc(13px * var(--escala-texto, 1))); font-weight:600;
  color:var(--text); line-height:1.4; overflow-wrap:anywhere;
}
.esc-pessoa-rotulo{
  display:flex; flex-direction:column; gap:var(--sp-1);
  font-size:max(9px, calc(12px * var(--escala-texto, 1))); color:var(--muted); line-height:1.4;
}
.esc-pessoa-opcional{ font-style:italic; }
.esc-pessoa-entrada{
  min-height:44px; padding:0 var(--sp-3); min-width:0;
  font-family:inherit; font-size:max(16px, calc(16px * var(--escala-texto, 1))); color:var(--text);
  background:var(--surface); border:1px solid var(--border); border-radius:var(--radius-md);
}
.esc-pessoa-entrada:focus{ outline:2px solid var(--accent); outline-offset:-1px; }

.esc-pessoa-sub{
  display:flex; flex-direction:column; gap:var(--sp-2);
  padding:var(--sp-2); background:var(--surface); border-radius:var(--radius-md);
}
/* Quebra de linha permitida: dois botões lado a lado não cabem em 375px com o
   texto inteiro, e texto cortado é o defeito que o padrão da casa proíbe. */
.esc-pessoa-botoes{ display:flex; flex-wrap:wrap; gap:var(--sp-2); }
.esc-pessoa-recado{
  margin:0; font-size:max(9px, calc(12px * var(--escala-texto, 1))); line-height:1.5;
  color:var(--muted); overflow-wrap:anywhere;
}
/* O texto usa --text e não --orange: laranja sobre esta superfície fica em 4,14
   de contraste, abaixo do mínimo de 4,5. */
.esc-pessoa-recado-erro{
  padding:var(--sp-2); border-radius:var(--radius-md); color:var(--text);
  background:color-mix(in srgb, var(--orange) 12%, var(--surface));
  border:1px solid color-mix(in srgb, var(--orange) 38%, var(--surface));
}
.esc-pessoa-nota{
  margin:0; font-size:max(9px, calc(11px * var(--escala-texto, 1))); line-height:1.5;
  color:var(--muted); overflow-wrap:anywhere;
}
</style>
```

- [ ] **Passo 2: provar que o componente compila**

```bash
npm run build
```

Esperado: build passa. (`node --test` **não** compila `.vue` — é o build que pega erro de
marcação aqui. A prova de que ele funciona na tela vem na tarefa 7.)

- [ ] **Passo 3: commit**

```bash
git add src/compartilhado/escolha-de-pessoa.vue
git commit -m "Componente: escolher a pessoa e cadastrar na hora a que faltar"
```

---

## Tarefa 5: Patrimônio — 2 campos e a porta estreita

**Arquivos:**
- Modificar: `src/ferramentas/patrimonio/tela-de-patrimonio.vue`
  - `:640-644` (o campo "Com quem está")
  - `:407-411` (o campo da alteração em massa)
  - `:1841` (o carregamento)
  - `:895` (bloco de imports)

**Interfaces:**
- Consome: `escolha-de-pessoa.vue` (tarefa 4), `mesclarPessoas`/`apenasAtivas` (tarefa 3),
  `pessoas_para_escolher`/`setores_para_escolher`/`criar_pessoa_rapida`/`criar_setor_rapido`
  (tarefa 1).
- Entrega: nada para tarefas seguintes.

- [ ] **Passo 1: importar o componente e o módulo**

Junto dos outros imports (perto da linha 895), acrescentar:

```js
import EscolhaDePessoa from '../../compartilhado/escolha-de-pessoa.vue'
import { mesclarPessoas, apenasAtivas } from '../../compartilhado/pessoas-para-escolher.js'
```

- [ ] **Passo 2: trocar o carregamento das pessoas pela porta estreita**

Em `carregar()`, trocar a linha:

```js
    sbClient.from('acessos_pessoas').select('id,nome,status').order('nome'),
```

por:

```js
    // PORTA ESTREITA (13/08/2026): a leitura direta de `acessos_pessoas` só
    // abre para quem tem Colaboradores e Acessos, e devolvia lista VAZIA para
    // os demais. A função do banco entrega nome/cargo/situação para quem mexe
    // no Patrimônio, sem abrir e-mail nem telefone de ninguém.
    sbClient.rpc('pessoas_para_escolher'),
    sbClient.rpc('setores_para_escolher'),
```

Na desestruturação do `Promise.all`, acrescentar `rSet` depois de `rPes`:

```js
  const [rBens, rEmp, rLoc, rCom, rCat, rTip, rPes, rSet, rCfg, rFrota] = await Promise.all([
```

E, onde hoje está `pessoas.value = rPes.data || []`, pôr:

```js
  pessoas.value = mesclarPessoas(rPes.data || [], [])
  setores.value = rSet && !rSet.error ? (rSet.data || []) : []
```

**Cuidado com a ordem:** `rSet` tem de ficar exatamente na mesma posição em que a chamada
foi posta na lista do `Promise.all`. Trocar a ordem faz a tela ler bem como pessoa.

- [ ] **Passo 3: declarar o estado novo**

Perto de `const pessoas = ref([])` (linha ~914), acrescentar:

```js
const setores = ref([])
const criandoPessoa = ref(false)
const erroDePessoa = ref('')
```

- [ ] **Passo 4: escrever quem grava**

Perto de `confirmarNovaOpcao` (linha ~1371), acrescentar:

```js
/* CADASTRO RÁPIDO DE COLABORADOR (13/08/2026).
 *
 * Quem grava é a tela, não o componente — mesmo contrato do "+" de local. O
 * banco é quem decide se pode: `criar_pessoa_rapida` recusa quem não mexe em
 * Patrimônio, Frota ou Acessos, e devolve `ja_existia` quando o nome já estava
 * lá (comparando sem caixa e sem espaço nas pontas). */
async function criarPessoaRapida({ nome, cargo, marcaId, setorId }) {
  if (criandoPessoa.value) return
  criandoPessoa.value = true
  erroDePessoa.value = ''

  const { data, error } = await sbClient.rpc('criar_pessoa_rapida', {
    p_nome: nome, p_cargo: cargo, p_marca_id: marcaId, p_setor_id: setorId,
  })
  criandoPessoa.value = false

  if (error) {
    erroDePessoa.value = 'Não consegui cadastrar. Tente de novo; se continuar, confirme '
      + 'com quem administra se você pode cadastrar colaborador.'
    return
  }

  const criada = Array.isArray(data) ? data[0] : data
  await carregar()
  if (criada && criada.ja_existia) adminToast(`"${criada.nome}" já estava cadastrada`)
  else if (criada) adminToast(`"${criada.nome}" cadastrada`)
}

async function criarSetorRapido({ nome }) {
  if (criandoPessoa.value) return
  criandoPessoa.value = true
  erroDePessoa.value = ''
  const { error } = await sbClient.rpc('criar_setor_rapido', { p_nome: nome })
  criandoPessoa.value = false
  if (error) { erroDePessoa.value = 'Não consegui cadastrar o setor. Tente de novo.'; return }
  await carregar()
}

// Marca reaproveita a tabela que o Patrimônio já cadastra por aqui — não há
// função nova no banco pra ela.
async function criarMarcaRapida({ nome }) {
  if (criandoPessoa.value) return
  criandoPessoa.value = true
  erroDePessoa.value = ''
  const { error } = await sbClient.from('patrimonio_empresas')
    .insert({ nome, ordem: empresas.value.length + 1 })
  criandoPessoa.value = false
  if (error) { erroDePessoa.value = 'Não consegui cadastrar a marca. Tente de novo.'; return }
  await carregar()
}
```

- [ ] **Passo 5: trocar o campo "Com quem está"**

Trocar o bloco das linhas 638-644:

```html
          <label class="pat-campo" data-tour="bem-responsavel">
            <span>Com quem está <em>(opcional)</em> <button type="button" class="pat-ajuda-q" @click.prevent="alternarAjuda('dono')" title="O que é isso?">?</button></span>
            <select v-model="form.pessoa_id">
              <option value="">Ninguém</option>
              <option v-for="p in pessoasAtivas" :key="p.id" :value="p.id">{{ p.nome }}</option>
            </select>
          </label>
```

por:

```html
          <div class="pat-campo" data-tour="bem-responsavel">
            <span class="pat-campo-titulo">Com quem está <em>(opcional)</em> <button type="button" class="pat-ajuda-q" @click.prevent="alternarAjuda('dono')" title="O que é isso?">?</button></span>
            <EscolhaDePessoa
              v-model="form.pessoa_id"
              :pessoas="pessoasAtivas" :marcas="empresas" :setores="setores"
              :pode-criar="podeEditar" :criando="criandoPessoa" :recado-de-erro="erroDePessoa"
              rotulo="Com quem está" texto-vazio="Ninguém"
              @criar="criarPessoaRapida" @criar-setor="criarSetorRapido" @criar-marca="criarMarcaRapida" />
          </div>
```

**Por que virou `<div>`:** o campo antigo era um `<label>` envolvendo o `select`. Com o
componente dentro, o `<label>` passaria a envolver TAMBÉM os campos da caixinha — clicar no
rótulo do cargo focaria o `select` de pessoa. Um `<div>` com o título ao lado do
`aria-label` que o componente já põe resolve sem essa armadilha.

No `<style scoped>`, junto das outras regras `.pat-campo`, acrescentar:

```css
.tela-patrimonio .pat-campo-titulo{display:block;margin-bottom:5px;}
```

- [ ] **Passo 6: trocar o campo da alteração em massa**

Trocar o bloco das linhas 404-412:

```html
          <label class="pat-campo">
            <span>Com quem está</span>
            <select v-model="massa.pessoaId">
              <option value="">— não mudar —</option>
              <option :value="LIMPAR">Tirar o dono (ninguém)</option>
              <option v-for="p in pessoasAtivas" :key="p.id" :value="p.id">{{ p.nome }}</option>
            </select>
          </label>
```

por:

```html
          <div class="pat-campo">
            <span class="pat-campo-titulo">Com quem está</span>
            <EscolhaDePessoa
              v-model="massa.pessoaId"
              :pessoas="pessoasAtivas" :marcas="empresas" :setores="setores"
              :pode-criar="podeEditar" :criando="criandoPessoa" :recado-de-erro="erroDePessoa"
              rotulo="Com quem está" texto-vazio="— não mudar —"
              @criar="criarPessoaRapida" @criar-setor="criarSetorRapido" @criar-marca="criarMarcaRapida">
              <option :value="LIMPAR">Tirar o dono (ninguém)</option>
            </EscolhaDePessoa>
          </div>
```

**A opção `LIMPAR` não pode cair.** Ela é o que diferencia "não mudar o dono destes bens" de
"tirar o dono destes bens" numa ação que atinge vários bens de uma vez. Ela vai dentro da
etiqueta (o `<slot>`), como a opção "de fora" da Frota. E `texto-vazio` continua sendo
exatamente `— não mudar —`: trocar esse texto muda o que a ação em massa faz com o que não
foi escolhido.

O `<label>` vira `<div>` pelo mesmo motivo do passo 5.

- [ ] **Passo 7: usar a lista mesclada em `pessoasAtivas`**

Trocar (linha ~1147):

```js
const pessoasAtivas = computed(() => pessoas.value.filter((p) => p.status === 'ativo'))
```

por:

```js
// `apenasAtivas` trata ficha sem `status` como ativa: a coluna tem padrão
// 'ativo' no banco, e sumir com alguém por campo vazio seria dado a menos sem
// avisar. Pessoa recém-criada pelo "+" cai exatamente nesse caso.
const pessoasAtivas = computed(() => apenasAtivas(pessoas.value))
```

- [ ] **Passo 8: rodar a suíte e o build**

```bash
npm test
npm run build
```

Esperado: os dois passam. O `imports.test.mjs` da pasta é quem pega nome usado sem import —
se ele reclamar de `EscolhaDePessoa`, `mesclarPessoas` ou `apenasAtivas`, o import do passo
1 ficou faltando.

- [ ] **Passo 9: commit**

```bash
git add src/ferramentas/patrimonio/tela-de-patrimonio.vue
git commit -m "Patrimonio: cadastrar na hora o colaborador que falta"
```

---

## Tarefa 6: Frota — 4 campos, a porta estreita e o casamento por `profile_id`

**Arquivos:**
- Modificar: `src/ferramentas/frota/tela-de-frota.vue`
  - `:732` (desestruturação do carregamento) e `:764-765` (a leitura de pessoas)
  - `:2851` ("Responsável — de quem é o carro")
  - `:3306` ("Quem vai dirigir", na requisição)
  - `:3465` ("Quem vai usar", na retirada)
  - `:3544` ("Passar para")
  - `:99` (bloco de imports)

**Interfaces:**
- Consome: as mesmas coisas da tarefa 5.
- Entrega: nada para tarefas seguintes.

- [ ] **Passo 1: importar**

Junto do import do `EscolhaDeLocalEAmbiente` (linha ~99):

```js
import EscolhaDePessoa from '../../compartilhado/escolha-de-pessoa.vue'
import { mesclarPessoas, apenasAtivas } from '../../compartilhado/pessoas-para-escolher.js'
```

- [ ] **Passo 2: as duas leituras, uma lista só**

A Frota **continua** lendo `acessos_pessoas` direto: ela precisa de e-mail e telefone para
casar o usuário logado e para o botão de cobrança. Essa leitura volta vazia para quem não
tem Colaboradores e Acessos — e é justamente por isso que a porta estreita entra AO LADO
dela, não no lugar.

Na lista do `Promise.all` (linha ~732 em diante), logo depois da leitura de
`acessos_pessoas`, acrescentar:

```js
    // PORTA ESTREITA (13/08/2026): a leitura acima devolve VAZIO para quem não
    // tem Colaboradores e Acessos — medido: Gabriel Alves, Guilherme Cardoso e
    // Jeremias Vieira enxergavam ZERO pessoas, e o campo "Responsável" nascia
    // vazio pra eles. Esta função entrega os nomes (e o `profile_id`, que é
    // como pessoaDoUsuario() acha a ficha de quem está logado), sem abrir
    // e-mail nem telefone.
    sbClient.rpc('pessoas_para_escolher'),
    sbClient.rpc('setores_para_escolher'),
```

Trocar a desestruturação da linha 732 por:

```js
  const [v, ua, uh, p, pe, se, q, pl, rv, bn, ci, cc, cf, catv] = await Promise.all([
```

**A ordem tem de bater exatamente com a ordem das chamadas na lista.** Conferir contando:
`pe` e `se` ficam onde as duas linhas novas foram postas.

Trocar `pessoas.value = (p.data || [])` por:

```js
  // Nome vem da porta estreita (todo mundo vê); contato vem da leitura direta
  // (só quem tem Colaboradores e Acessos). Quem tem os dois recebe a ficha
  // inteira; quem tem um só recebe o que pode — e nunca uma lista vazia por
  // falta de permissão.
  pessoas.value = mesclarPessoas(pe && !pe.error ? (pe.data || []) : [], p.data || [])
  setores.value = se && !se.error ? (se.data || []) : []
```

(Conferido em 13/08: a linha 800 é só `pessoas.value = (p.data || [])`, sem nada encadeado
depois. Se ela tiver mudado, preservar o que estiver lá aplicando depois do `mesclarPessoas`.)

- [ ] **Passo 3: declarar o estado novo**

Perto de `const pessoas = ref([])` (linha ~111):

```js
const setores = ref([])
const criandoPessoa = ref(false)
const erroDePessoa = ref('')
const pessoasAtivas = computed(() => apenasAtivas(pessoas.value))
```

- [ ] **Passo 4: escrever quem grava**

Perto de `criarNaArvore` (linha ~1884), acrescentar:

```js
/* CADASTRO RÁPIDO DE COLABORADOR (13/08/2026). Mesmo contrato do "+" da árvore
 * de locais: quem grava é a tela; o componente só avisa e espera o nome
 * aparecer. `criar_pessoa_rapida` devolve `ja_existia` quando o nome já estava
 * lá — a checagem mora no banco porque duas janelas cadastrando ao mesmo tempo
 * é o caso que a tela sozinha não cobre. */
async function criarPessoaRapida({ nome, cargo, marcaId, setorId }) {
  if (criandoPessoa.value) return
  criandoPessoa.value = true
  erroDePessoa.value = ''

  const { error } = await sbClient.rpc('criar_pessoa_rapida', {
    p_nome: nome, p_cargo: cargo, p_marca_id: marcaId, p_setor_id: setorId,
  })
  criandoPessoa.value = false
  if (error) {
    erroDePessoa.value = 'Não consegui cadastrar. Tente de novo; se continuar, confirme '
      + 'com quem administra se você pode cadastrar colaborador.'
    return
  }
  await carregar()
}

async function criarSetorRapido({ nome }) {
  if (criandoPessoa.value) return
  criandoPessoa.value = true
  erroDePessoa.value = ''
  const { error } = await sbClient.rpc('criar_setor_rapido', { p_nome: nome })
  criandoPessoa.value = false
  if (error) { erroDePessoa.value = 'Não consegui cadastrar o setor. Tente de novo.'; return }
  await carregar()
}

async function criarMarcaRapida({ nome }) {
  if (criandoPessoa.value) return
  criandoPessoa.value = true
  erroDePessoa.value = ''
  const { error } = await sbClient.from('patrimonio_empresas')
    .insert({ nome, ordem: (empresasPat.value || []).length + 1 })
  criandoPessoa.value = false
  if (error) { erroDePessoa.value = 'Não consegui cadastrar a marca. Tente de novo.'; return }
  await carregarArvoreDeLocais()
}
```

(Conferido em 13/08: a função que recarrega a tela da Frota é `async function carregar()`,
na linha 729, e a da árvore de locais é `carregarArvoreDeLocais()`, na 878.)

- [ ] **Passo 5: campo "Responsável — de quem é o carro" (linha ~2851)**

Trocar:

```html
              <select v-model="vForm.pessoa_id">
                <option value="">— ninguém —</option>
                <option v-for="p in pessoas" :key="p.id" :value="p.id">{{ p.nome }}</option>
              </select>
```

por:

```html
              <EscolhaDePessoa
                v-model="vForm.pessoa_id"
                :pessoas="pessoasAtivas" :marcas="empresasPat" :setores="setores"
                :pode-criar="podeEditar" :criando="criandoPessoa" :recado-de-erro="erroDePessoa"
                rotulo="Responsável pelo carro" texto-vazio="— ninguém —"
                @criar="criarPessoaRapida" @criar-setor="criarSetorRapido" @criar-marca="criarMarcaRapida" />
```

Se esse `<select>` estiver dentro de um `<label>`, trocar o `<label>` por `<div>` com a
mesma classe e manter o `<span class="fr-lab">` como está — pelo mesmo motivo do passo 5 da
tarefa 5 (o `<label>` passaria a capturar os cliques dos campos da caixinha).

- [ ] **Passo 6: campo "Quem vai dirigir" (linha ~3306)**

Trocar o `<select v-model="pedidoForm.pessoaId" @change="conferirPedido">` inteiro por:

```html
              <EscolhaDePessoa
                v-model="pedidoForm.pessoaId"
                :pessoas="pessoasAtivas" :marcas="empresasPat" :setores="setores"
                :pode-criar="podeEditar" :criando="criandoPessoa" :recado-de-erro="erroDePessoa"
                rotulo="Quem vai dirigir" texto-vazio="— escolha —"
                @update:modelValue="conferirPedido"
                @criar="criarPessoaRapida" @criar-setor="criarSetorRapido" @criar-marca="criarMarcaRapida">
                <option :value="DE_FORA">— outra pessoa, de fora da empresa —</option>
              </EscolhaDePessoa>
```

**Duas coisas que não podem cair:**
1. A opção `DE_FORA` continua, dentro da etiqueta (é o `<slot>`). Ela existe por um caso
   real: em 11/08 o dono precisou registrar o Felipe, modelista de fora, não achou onde, e
   pôs a si mesmo como motorista — uma multa cairia no nome errado.
2. O `@change="conferirPedido"` vira `@update:modelValue="conferirPedido"`. Sem isso a
   conferência do pedido para de rodar em silêncio.

- [ ] **Passo 7: campo "Quem vai usar" (linha ~3465)**

Trocar o `<select v-model="form.pessoaId">` desse bloco por:

```html
              <EscolhaDePessoa
                v-model="form.pessoaId"
                :pessoas="pessoasAtivas" :marcas="empresasPat" :setores="setores"
                :pode-criar="podeEditar" :criando="criandoPessoa" :recado-de-erro="erroDePessoa"
                rotulo="Quem vai usar" texto-vazio="— escolha —"
                @criar="criarPessoaRapida" @criar-setor="criarSetorRapido" @criar-marca="criarMarcaRapida" />
```

- [ ] **Passo 8: campo "Passar para" (linha ~3544)**

Aqui a primeira `<option>` tem texto **calculado** ("Devolver para Fulano" ou "Encerrar a
posse — o carro fica livre"). Passar esse texto por `texto-vazio`:

```html
            <EscolhaDePessoa
              v-model="paraQuem"
              :pessoas="pessoasAtivas" :marcas="empresasPat" :setores="setores"
              :pode-criar="podeEditar" :criando="criandoPessoa" :recado-de-erro="erroDePessoa"
              rotulo="Passar para"
              :texto-vazio="passando.pessoa_id
                ? ('Devolver para ' + (nomeDaPessoa(passando.pessoa_id) || 'o responsável fixo'))
                : 'Encerrar a posse — o carro fica livre'"
              @criar="criarPessoaRapida" @criar-setor="criarSetorRapido" @criar-marca="criarMarcaRapida">
              <option :value="DE_FORA">— outra pessoa, de fora da empresa —</option>
            </EscolhaDePessoa>
```

**Não mexer no que `paraQuem` vazio significa:** vazio aqui é "devolver / encerrar", e é
`frota_uso` que responde quem estava com o carro no dia da multa. É o dado dos R$ 1.301,60.

- [ ] **Passo 9: rodar a suíte e o build**

```bash
npm test
npm run build
```

Esperado: os dois passam. Se `abas-sem-vazamento.test.mjs` ou `botoes-padronizados.test.mjs`
reclamarem, ler o que eles cobram — são guardas de padrão da casa, não ruído.

- [ ] **Passo 10: commit**

```bash
git add src/ferramentas/frota/tela-de-frota.vue
git commit -m "Frota: os 4 campos de pessoa passam a enxergar a lista e a cadastrar"
```

---

## Tarefa 7: provar na tela e subir

**Arquivos:**
- Nenhum de produção. O harness de medida vive no scratchpad da sessão, fora do repositório.

- [ ] **Passo 1: medir a 375px**

O aplicativo exige login e não se loga em conta real. O que se mede é um harness: extrair o
`<style scoped>` de `escolha-de-pessoa.vue`, montar um HTML com a marcação real da caixinha
aberta dentro de um envelope de 375px, servir por http local (`file://` é bloqueado) e
medir com `chromium.launch({ channel: 'chrome' })` via `playwright-core` instalado no
scratchpad. **Desembrulhar os `:deep(...)` antes** — o navegador descarta a regra e o teste
mente. **Não matar processo de navegador alheio**: outra janela pode estar usando.

Invariantes que têm de valer:
- nenhuma rolagem horizontal (`scrollWidth <= clientWidth` no envelope);
- todo campo de digitar com `font-size` medido `>= 16px`;
- todo botão com altura medida `>= 44px`;
- os dois botões do rodapé da caixinha visíveis, sem texto cortado.

- [ ] **Passo 2: conferir o tema escuro**

Repetir a medida com `document.documentElement.dataset.theme = 'dark'`. Esperado: nenhum
bloco branco — toda cor do componente sai de token, e hex cravado já deixou bloco branco em
produção neste projeto.

- [ ] **Passo 3: a suíte inteira mais uma vez**

```bash
npm test
npm run build
```

- [ ] **Passo 4: conferir que a `main` remota não andou**

```bash
git fetch origin
git rev-list --left-right --count origin/main...HEAD
```

Há mais gente trabalhando neste repositório. Se `origin/main` andou, mesclar antes de subir
e **rodar `npm test` de novo depois da mescla** — a suíte junta é o que vale.

- [ ] **Passo 5: subir**

```bash
git checkout main
git merge feat/cadastro-rapido-de-pessoa
npm test && npm run build
git push origin main
```

- [ ] **Passo 6: conferir o que subiu, pelo caminho**

Não confiar no hash local. Abrir `https://socialdashboard.rbvcompany.com`, seguir
home → arquivo de entrada → pedaço do pacote, e confirmar que o texto novo ("Cadastrar quem
ainda não está na lista") está no que o servidor entrega.

- [ ] **Passo 7: contar para o dono, em português**

O que ele precisa saber: onde apareceu o `+`, que Gabriel/Guilherme/Jeremias passaram a
enxergar a lista de nomes na Frota (defeito que existia antes deste pedido), que o cadastro
rápido cria só a ficha — não o login —, e que e-mail e telefone continuam fechados para
quem não tem Colaboradores e Acessos.

---

## Depois que subir

Registrar na memória:
- que a exceção "não se cria pessoa pelo formulário do bem" foi **derrubada pelo dono** em
  13/08/2026 — senão alguém a "conserta" de volta lendo a anotação antiga;
- que `acessos_pessoas` e `acessos_setores` agora têm porta estreita para Patrimônio/Frota,
  e que a leitura direta continua fechada.

---

## Tarefa 8: IMEI / Nº de série no Patrimônio

**Pedido novo do dono, 13/08/2026:** *"adicione aí em patrimônio um campo de IMEI/Serial ID
para melhor identificar o dispositivo, caso já houver deixe mais próximo do campo de
patrimônio"*.

**Medido antes:** o campo **não existe** — nem coluna no banco (`patrimonio_bens` tem 19
colunas e nenhuma de série/IMEI) nem campo na ficha. Então é criar, não mover. O lugar
pedido é logo abaixo do "Nº da etiqueta".

**Decidido com o dono:** **um campo só** ("IMEI / Nº de série", serve para os dois — celular
põe o IMEI, notebook põe o serial), que **entra na busca** e **entra na planilha exportada**.
Fora: cartão da lista (apertaria a lista no celular).

**Consequência que o dono precisa saber:** `COLUNAS_PLANILHA` alimenta ao mesmo tempo a
exportação e a aba "Planilha" da tela. Pôr a coluna no arquivo põe a coluna na aba também —
são a mesma lista, de propósito, justamente para as duas não divergirem.

**Esta tarefa roda DEPOIS da Tarefa 5**: as duas mexem em `tela-de-patrimonio.vue`.

**Arquivos:**
- Criar: `db/migrations/2026-08-13-patrimonio-numero-de-serie.sql`
- Modificar: `src/ferramentas/patrimonio/filtro-de-bens.js` (a busca) + `filtro-de-bens.test.mjs`
- Modificar: `src/ferramentas/patrimonio/planilha-e-resumo.js` (a coluna)
- Modificar: `src/ferramentas/patrimonio/tela-de-patrimonio.vue` (campo, formulário, gravação, achatamento)

**Interfaces:**
- Consome: nada das tarefas anteriores.
- Entrega: coluna `patrimonio_bens.numero_serie text`.

- [ ] **Passo 1: a migration**

Criar `db/migrations/2026-08-13-patrimonio-numero-de-serie.sql`:

```sql
-- IMEI / Nº de série do bem. Pedido do dono em 13/08/2026: "um campo de
-- IMEI/Serial ID para melhor identificar o dispositivo".
--
-- UM CAMPO SÓ para os dois números, decidido com ele: celular tem IMEI, notebook
-- tem número de série, e a maioria dos 349 bens (cadeira, mesa, TV) não tem
-- nenhum dos dois. Dois campos deixariam um sempre vazio.
--
-- SEM unique: o mesmo aparelho pode ser recadastrado por engano e uma trava dura
-- impediria a correção; e serial de fabricante repete entre fabricantes
-- diferentes. Quem confere é a pessoa, olhando a busca.
alter table public.patrimonio_bens
  add column if not exists numero_serie text;

comment on column public.patrimonio_bens.numero_serie is
  'IMEI (celular) ou número de série (notebook, TV). Nulo = não informado.';
```

Aplicar pelo MCP do Supabase (`apply_migration`, projeto `kounqtdoioootxqegkij`, nome
`patrimonio_numero_de_serie`). **Não** rodar o runner do repositório.

- [ ] **Passo 2: provar que a coluna nasceu legível E gravável**

Esta casa já foi mordida por coluna nova sem permissão: uma coluna sem `GRANT` derruba a
linha inteira na leitura (o erro que apareceu foi "g is not iterable"). Conferir, pelo MCP:

```sql
select privilege_type
from information_schema.column_privileges
where table_schema='public' and table_name='patrimonio_bens'
  and column_name='numero_serie' and grantee='authenticated'
order by privilege_type;
```

Esperado: `INSERT`, `REFERENCES`, `SELECT`, `UPDATE`. **Se faltar alguma**, rodar:

```sql
grant select, insert, update (numero_serie) on public.patrimonio_bens to authenticated;
```

e conferir de novo. Registrar no relatório o que veio ANTES e DEPOIS.

- [ ] **Passo 3: o teste da busca (TDD, vermelho primeiro)**

Em `src/ferramentas/patrimonio/filtro-de-bens.test.mjs`, acrescentar:

```js
test('busca acha o bem pelo IMEI / número de série', () => {
  const bens = [
    { id: '1', nome: 'Macbook Air', numero: 47, numero_serie: 'C02XK1ABJGH5' },
    { id: '2', nome: 'Cadeira', numero: 48, numero_serie: null },
  ]
  const achados = filtrarBens(bens, { ...FILTRO_VAZIO, busca: 'c02xk1' })
  assert.deepEqual(achados.map((b) => b.id), ['1'], 'digitar parte do serial tem que achar o aparelho')
})
```

Conferir os nomes que o arquivo de teste já importa (`filtrarBens`, `FILTRO_VAZIO`) e usar
os mesmos; se a assinatura de `filtrarBens` no arquivo for outra, seguir a que está lá.

Rodar e ver FALHAR:
```bash
node --test src/ferramentas/patrimonio/filtro-de-bens.test.mjs
```
Esperado: falha, porque a busca ainda não olha `numero_serie`. **Capturar a saída de
verdade** — prova prevista não vale.

- [ ] **Passo 4: fazer a busca olhar o campo**

Em `src/ferramentas/patrimonio/filtro-de-bens.js`, na função `casaBusca`, trocar:

```js
  const partes = [bem.nome, bem.numero, bem.marca, bem.dono_texto, bem.observacao]
```

por:

```js
  // `numero_serie` entra porque é o segundo jeito de identificar um aparelho com
  // ele na mão: quando a etiqueta caiu, sobra o IMEI atrás do celular.
  const partes = [bem.nome, bem.numero, bem.numero_serie, bem.marca, bem.dono_texto, bem.observacao]
```

E atualizar o comentário logo acima da função, que hoje lista o que a busca varre, para
incluir o número de série. Rodar o teste de novo: tem de passar.

- [ ] **Passo 5: a coluna na planilha**

Em `src/ferramentas/patrimonio/planilha-e-resumo.js`, dentro de `COLUNAS_PLANILHA`, inserir
logo DEPOIS da linha do `numero`:

```js
  { chave: 'numero_serie', titulo: 'IMEI / Nº de série', tipo: 'texto' },
```

Em `src/ferramentas/patrimonio/tela-de-patrimonio.vue`, no `linhasAchatadas` (perto da
linha 1564), acrescentar logo depois de `numero: b.numero,`:

```js
    numero_serie: b.numero_serie || '',
```

Sem isso a coluna aparece vazia para todo mundo: quem monta a linha da planilha é este
achatamento, não o bem cru.

- [ ] **Passo 6: o campo na ficha**

Em `src/ferramentas/patrimonio/tela-de-patrimonio.vue`, logo DEPOIS do bloco
`<div class="pat-ajuda-txt" v-if="ajudaAberta === 'etiqueta' || ajudaAberta === 'valor'">`
(que fecha o par "Nº da etiqueta / Valor de compra"), inserir:

```html
          <!-- Colado no Nº da etiqueta de propósito (pedido do dono): são os dois
               jeitos de dizer QUAL aparelho é este. A etiqueta é da empresa e pode
               cair; o IMEI é do aparelho e não sai nunca. -->
          <label class="pat-campo">
            <span>IMEI / Nº de série <em>(opcional)</em></span>
            <input v-model="form.numero_serie" type="text" placeholder="Ex.: 356938035643809">
          </label>
```

- [ ] **Passo 7: o campo no formulário, na abertura e na gravação**

Três lugares, e esquecer qualquer um faz o valor sumir sem erro nenhum:

1. No objeto que zera o formulário (perto da linha 1150, onde estão `nome`, `numero`,
   `valor`, `data_compra`), acrescentar `numero_serie: '',`.
2. Em `abrirFicha` (perto da linha 1405, onde faz `numero: bem.numero === null ...`),
   acrescentar `numero_serie: bem.numero_serie || '',`.
3. Em `salvarBem`, dentro do objeto `linha` (perto da linha 1469, logo depois de `numero:`),
   acrescentar:

```js
    numero_serie: (form.numero_serie || '').trim() || null,
```

Aparar e virar nulo quando vazio é o mesmo tratamento que `marca` e `observacao` já
recebem ali — texto em branco no banco vira dado sujo que a busca acha por engano.

- [ ] **Passo 8: suíte, build e um olho na aba Planilha**

```bash
npm test
npm run build
```

A suíte tem de fechar sem falha e com o total **maior** que o conhecido (a base desta
branch é 2921 + o teste novo). Total MENOR que o conhecido significa arquivo de teste que
não carregou — rodar `npm install` e repetir, nunca explicar como flake.

- [ ] **Passo 9: commit**

```bash
git add db/migrations/2026-08-13-patrimonio-numero-de-serie.sql \
        src/ferramentas/patrimonio/filtro-de-bens.js \
        src/ferramentas/patrimonio/filtro-de-bens.test.mjs \
        src/ferramentas/patrimonio/planilha-e-resumo.js \
        src/ferramentas/patrimonio/tela-de-patrimonio.vue
git commit -m "Patrimonio: IMEI / numero de serie para identificar o aparelho"
```
