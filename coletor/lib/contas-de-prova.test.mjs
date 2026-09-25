import { test } from 'node:test'
import assert from 'node:assert/strict'
import { contasDeProva } from './contas-de-prova.mjs'

// Um cliente de mentira que guarda as linhas como o banco guardaria.
function banco({ deleteFalha = false } = {}) {
  const users = new Set(), perfis = new Set(), log = []
  return {
    log, users, perfis,
    async query(sql, a = []) {
      log.push(sql.trim().split(/\s+/).slice(0, 3).join(' '))
      if (/insert into auth\.users/.test(sql)) users.add(a[0])
      else if (/insert into public\.profiles/.test(sql)) perfis.add(a[0])
      else if (/delete from public\.profiles/.test(sql)) { if (!deleteFalha) a[0].forEach((id) => perfis.delete(id)) }
      else if (/delete from auth\.users/.test(sql)) { if (!deleteFalha) a[0].forEach((id) => users.delete(id)) }
      else if (/select \(select count/.test(sql)) {
        const n = a[0].filter((id) => users.has(id)).length + a[0].filter((id) => perfis.has(id)).length
        return { rows: [{ n }] }
      }
      return { rows: [] }
    },
  }
}

test('cria no prefixo pedido e apaga SÓ o que criou', async () => {
  const cli = banco()
  cli.users.add('conta-de-verdade'); cli.perfis.add('conta-de-verdade')
  const p = contasDeProva(cli)
  const a = await p.criar('prova-x', { name: 'A' }), b = await p.criar('prova-x', { name: 'B', disabled: true })
  assert.equal(cli.users.size, 3)
  await p.apagarEConferir()
  assert.deepEqual([...cli.users], ['conta-de-verdade'])
  assert.deepEqual([...cli.perfis], ['conta-de-verdade'])
  assert.ok(!cli.users.has(a) && !cli.users.has(b))
})

test('se sobrar conta, lança — e o COMMIT não acontece', async () => {
  const cli = banco({ deleteFalha: true })
  const p = contasDeProva(cli)
  await p.criar('prova-x')
  await assert.rejects(() => p.apagarEConferir(), /sobraram 2/)
})

test('sem conta criada, não mexe no banco', async () => {
  const cli = banco()
  await contasDeProva(cli).apagarEConferir()
  assert.deepEqual(cli.log, [])
})
