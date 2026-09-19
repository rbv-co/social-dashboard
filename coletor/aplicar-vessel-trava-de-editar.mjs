// APLICA, REGISTRA e PROVA a trava de editar do Comercial Vessel.
// ⚠️ As provas escrevem dado de verdade e sao desfeitas antes do commit.
import './lib/carregar-env.mjs'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

const ARQUIVO = '2026-09-19-vessel-trava-de-editar.sql'
const TRAVA = 'public.is_vessel_atendimentos_editar()'

const sql = readFileSync(new URL(`../db/migrations/${ARQUIVO}`, import.meta.url), 'utf8')
const cli = new pg.Client({ connectionString: process.env.DATABASE_URL })
await cli.connect()
await cli.query('begin')
try {
  await cli.query(sql)
  await cli.query(
    `insert into public.schema_migrations (name, observacao) values ($1,$2)
     on conflict (name) do nothing`,
    [ARQUIVO, 'Aplicada e registrada na mesma transacao por coletor/aplicar-vessel-trava-de-editar.mjs'])

  const uma = async (s, a = []) => (await cli.query(s, a)).rows[0]

  // 1. A PORTA: a Central usa, a pagina publica nao.
  const p = await uma(
    `select has_function_privilege('anon',$1,'EXECUTE') as anon,
            has_function_privilege('authenticated',$1,'EXECUTE') as autenticado,
            has_function_privilege('public',$1,'EXECUTE') as qualquer_um`, [TRAVA])
  if (!p.autenticado) throw new Error('a Central nao consegue usar a trava')
  if (p.anon || p.qualquer_um) throw new Error('porta aberta para a pagina publica')

  // 2. SEM SESSAO, NAO. auth.uid() e nulo aqui.
  const semSessao = await uma(`select public.is_vessel_atendimentos_editar() as r`)
  if (semSessao.r !== false) throw new Error('sem sessao a trava deixou passar')

  // 3. A PROVA DE VERDADE, com perfis de mentira e rollback.
  await cli.query('savepoint prova')

  // ⚠️ `profiles.id` tem FK para `auth.users(id)`, e `profiles.email` e NOT
  // NULL sem default — o brief nao previu nenhuma das duas porque so mediu as
  // colunas que a trava LE. Por isso cada perfil de mentira nasce em DOIS
  // inserts: primeiro um `auth.users` minimo (so `id` e obrigatorio la), para
  // a FK aceitar o `profiles` que vem em seguida. Nenhuma das duas tabelas
  // sobrevive ao commit: tudo aqui esta depois do `savepoint prova` e some no
  // `rollback to savepoint prova` mais abaixo.
  const perfil = async (features, permissions, superadmin = false) => {
    const id = randomUUID()
    const email = `prova-trava-editar-${id}@teste.invalido`
    await cli.query(`insert into auth.users (id, email) values ($1, $2)`, [id, email])
    await cli.query(
      `insert into public.profiles (id, email, features, permissions, is_superadmin)
       values ($1, $2, $3, $4::jsonb, $5)`,
      [id, email, features, JSON.stringify(permissions), superadmin])
    return id
  }
  // ⚠️ Roda uma COPIA VERBATIM da regra da funcao, e nao a funcao em si.
  // `auth.uid()` so existe dentro de uma sessao autenticada da Central; aqui,
  // por um `psql`/`pg` puro, nao ha sessao para simular (nao ha como "logar
  // como" um perfil sem fabricar um JWT, o que este script explicitamente NAO
  // faz — ver a Ruling R5 do brief). Por isso o SQL abaixo e a UNIAO, na MESMA
  // ORDEM, dos corpos de `is_vessel_atendimentos()` e de
  // `is_vessel_atendimentos_editar()` tal como estao na migration — a unica
  // mudanca e trocar `auth.uid()` por `$1` nos dois, porque nao ha sessao para
  // o `auth.uid()` ler. Se a funcao mudar, esta copia precisa mudar junto — e
  // pode DRIFT. A prova com sessao de verdade (login real, `auth.uid()` de
  // verdade) fica para uma tarefa posterior, em
  // `docs/provar-private-edit-mexer.sql`. O que este script prova aqui e mais
  // estreito: que a REGRA, copiada fielmente, se comporta como o esperado —
  // inclusive na armadilha do nulo (Ruling R9, caso `buraco` abaixo).
  const comoSe = async (id) => (await uma(
    // -- corpo de is_vessel_atendimentos(), auth.uid() -> $1 --
    `select coalesce(
        (select 'atendimentos' = any(p.features) or p.is_superadmin
           from public.profiles p where p.id = $1),
        false)
     -- -- 'and' do corpo de is_vessel_atendimentos_editar() --
     and coalesce(
       (select p.is_superadmin or (p.permissions -> 'atendimentos') ? 'editar'
          from public.profiles p where p.id = $1),
       false) as r`, [id])).r

  const so_ve  = await perfil(['atendimentos'], { atendimentos: ['ver'] })
  const mexe   = await perfil(['atendimentos'], { atendimentos: ['ver', 'editar'] })
  const solto  = await perfil([], { atendimentos: ['ver', 'editar'] })
  const chefe  = await perfil([], {}, true)
  // Ruling R9 — A ARMADILHA DO NULO: `permissions` e `'{}'::jsonb`, a chave
  // `atendimentos` nem existe. `(p.permissions -> 'atendimentos') ? 'editar'`
  // devolve NULL, nao false. Sem o `coalesce` envolvendo a subconsulta
  // INTEIRA, um `if not <trava>()` deixaria passar quem nao tem NENHUMA
  // permissao. Este perfil tem o `feature` de ver (passaria pelo portao de
  // hoje) mas nao tem superadmin nem a chave `atendimentos` em `permissions`.
  const buraco = await perfil(['atendimentos'], {})

  if (await comoSe(so_ve)) throw new Error('quem so ve passou pela trava de editar')
  if (!(await comoSe(mexe))) throw new Error('quem pode editar foi barrado')
  if (await comoSe(solto)) throw new Error('editar ficou MAIS FROUXO que ver')
  if (!(await comoSe(chefe))) throw new Error('o superadmin foi barrado')
  if (await comoSe(buraco)) throw new Error('a armadilha do nulo escapou: permissions {} passou pela trava')

  await cli.query('rollback to savepoint prova')
  await cli.query('commit')
  console.log('✅ aplicada, registrada e provada:', ARQUIVO)
} catch (e) {
  await cli.query('rollback')
  console.error('❌ nao aplicada:', e.message)
  process.exitCode = 1
} finally { await cli.end() }
