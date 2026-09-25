// CONTAS DE PROVA DE APLICADOR — criar, e garantir que NENHUMA chegue ao COMMIT.
//
// POR QUE EXISTE (25/09/2026): quatro aplicadores (agenda do Private Edit,
// Private Edit só com stylist liberada, código do encontro e convite da
// convidada) criavam os perfis de prova logo depois do `begin`, FORA do
// savepoint da prova. O ensaio desfazia tudo; o `--gravar` fazia COMMIT — e as
// contas iam junto. Ficaram 8 em produção, com chaves do Comercial Vessel.
//
// A REGRA (PADRAO-DA-CENTRAL.md, "Aplicador de migration"):
//   1. de preferência, a conta nasce DENTRO do savepoint da prova e morre com ele;
//   2. quando ela precisa viver fora (vários savepoints usam a mesma), nasce por
//      aqui e `apagarEConferir()` roda ANTES do `commit` — é o `finally` da
//      transação: no caminho do erro o ROLLBACK já a leva; no do COMMIT, quem a
//      leva é esta chamada, que também confere que não sobrou nenhuma e, se
//      sobrar, lança (e o COMMIT não acontece).
// Só apaga o que ESTA execução criou (pelos ids), nunca por padrão de e-mail.
export function contasDeProva(cli) {
  const ids = []
  return {
    ids,
    async criar(prefixo, { name, features = [], permissions = {}, is_superadmin = false, disabled = false } = {}) {
      const { randomUUID } = await import('node:crypto')
      const id = randomUUID(), email = `${prefixo}-${id}@teste.invalido`
      await cli.query(`insert into auth.users (id, email) values ($1, $2)`, [id, email])
      ids.push(id)
      await cli.query(`insert into public.profiles (id, email, name, features, permissions, is_superadmin, disabled)
        values ($1, $2, $3, $4, $5::jsonb, $6, $7)`, [id, email, name ?? email, features, JSON.stringify(permissions), is_superadmin, disabled])
      return id
    },
    async apagarEConferir() {
      if (!ids.length) return
      await cli.query(`select set_config('request.jwt.claims', '', true)`)
      await cli.query(`delete from public.profiles where id = any($1::uuid[])`, [ids])
      await cli.query(`delete from auth.users where id = any($1::uuid[])`, [ids])
      const { rows: [{ n }] } = await cli.query(
        `select (select count(*) from auth.users where id = any($1::uuid[])) + (select count(*) from public.profiles where id = any($1::uuid[])) as n`, [ids])
      if (Number(n) !== 0) throw new Error(`sobraram ${n} conta(s)/perfil(is) de prova — o COMMIT não acontece`)
    },
  }
}
