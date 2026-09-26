// APAGA AS CONTAS DE PROVA esquecidas em produção (`…@teste.invalido`).
//
//   node --env-file=coletor/.env coletor/apagar-contas-de-prova.mjs            → simulação: só lista o que apagaria
//   node --env-file=coletor/.env coletor/apagar-contas-de-prova.mjs --gravar   → apaga e confere lendo de volta
//
// DE ONDE VIERAM (25/09/2026): aplicadores de 24–25/09 criavam o perfil de
// prova (auth.users + profiles) DENTRO da transação mas FORA do savepoint da
// prova; com `--gravar`, o COMMIT levava as contas junto. Oito ficaram: 3 do
// pe-agenda, 2 do pe-ativada, 1 do codigo e 2 do convite. A regra que impede a
// próxima está em PADRAO-DA-CENTRAL.md ("Aplicador de migration").
//
// ⚠️ SÓ APAGA QUEM CUMPRE AS DUAS: e-mail terminado em `@teste.invalido` E
// nunca entrou (`last_sign_in_at` vazio). Qualquer outra conta fica.
// ⚠️ APAGA PELA API DE ADMIN do Supabase Auth — nunca escrevendo em
// `auth.users`. O perfil em `profiles` vai junto pelo `on delete cascade` de
// `profiles_id_fkey`; se algum sobrar, o programa apaga o perfil (pela API
// REST, com a chave de serviço) e diz.
//
// ⚠️ A API DE ADMIN NÃO ENXERGA AS OITO (medido em 25/09/2026): os
// aplicadores fizeram `insert into auth.users (id, email)` e nada mais — sem
// `instance_id`, `aud`, `role`, `created_at`. O Auth só lista e só apaga conta
// da instância dele, e responde 404 `user_not_found` para estas. Por isso a
// lista sai de uma LEITURA de `auth.users` (DATABASE_URL, só select), e para a
// conta que a API não enxerga o programa apaga SÓ o perfil (é ele que carrega
// as permissões) e deixa a linha de `auth.users`, dizendo quais. Tirar essas
// linhas exige um DELETE direto em `auth.users` — decisão do dono, fora daqui.
// Sem perfil e sem senha, elas não entram na Central nem passam em trava
// nenhuma (todas leem `profiles`).
//
// Precisa de SUPABASE_URL e SUPABASE_SERVICE_KEY (coletor/.env).
import './lib/carregar-env.mjs'
import pg from 'pg'

const GRAVAR = process.argv.includes('--gravar')
const URL_ = process.env.SUPABASE_URL
const CHAVE = process.env.SUPABASE_SERVICE_KEY
if (!URL_ || !CHAVE || !process.env.DATABASE_URL) {
  console.error('❌ falta SUPABASE_URL, SUPABASE_SERVICE_KEY ou DATABASE_URL'); process.exit(1)
}
const H = { apikey: CHAVE, Authorization: `Bearer ${CHAVE}`, 'Content-Type': 'application/json' }

// A leitura de auth.users (só select): quem é de prova, e se o Auth o enxerga.
async function contasDeProva() {
  const cli = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await cli.connect()
  try {
    const { rows } = await cli.query(`select u.id::text as id, u.email, u.last_sign_in_at,
        exists (select 1 from public.profiles p where p.id = u.id) as tem_perfil
      from auth.users u where u.email ilike '%@teste.invalido' order by u.email`)
    return rows
  } finally { await cli.end() }
}
async function oAuthEnxerga(id) {
  const r = await fetch(`${URL_}/auth/v1/admin/users/${id}`, { headers: H })
  if (r.status === 404) return false
  if (!r.ok) throw new Error(`consultar ${id}: HTTP ${r.status} ${await r.text()}`)
  return true
}
async function perfisDe(ids) {
  if (!ids.length) return []
  const r = await fetch(`${URL_}/rest/v1/profiles?select=id,email&id=in.(${ids.join(',')})`, { headers: H })
  if (!r.ok) throw new Error(`ler perfis: HTTP ${r.status} ${await r.text()}`)
  return r.json()
}

const todas = await contasDeProva()
const jaEntrou = todas.filter((u) => u.last_sign_in_at)
const alvo = todas.filter((u) => !u.last_sign_in_at)
for (const u of alvo) u.visivel = await oAuthEnxerga(u.id)
console.log(`${alvo.length} conta(s) de prova (…@teste.invalido, nunca entrou):`)
for (const u of alvo) {
  console.log(`   ${u.email}  ${u.visivel ? 'apaga a conta pela API de admin (o perfil vai junto)' : 'a API NÃO enxerga → apaga só o perfil'}${u.tem_perfil ? '' : ' (sem perfil)'}`)
}
if (jaEntrou.length) console.log(`⚠️ ${jaEntrou.length} com @teste.invalido que JÁ entrou — não são tocadas: ${jaEntrou.map((u) => u.email).join(', ')}`)

if (!GRAVAR) {
  console.log('\nSimulação: nada foi apagado. Rode com --gravar para apagar.')
  process.exit(0)
}

let erros = 0
for (const u of alvo.filter((x) => x.visivel)) {
  const r = await fetch(`${URL_}/auth/v1/admin/users/${u.id}`, { method: 'DELETE', headers: H })
  if (!r.ok) { erros++; console.error(`  ✗ conta ${u.email}: HTTP ${r.status} ${await r.text()}`) } else console.log(`  ✓ conta apagada: ${u.email}`)
}
const ids = alvo.map((u) => u.id)
for (const p of await perfisDe(ids)) {
  const r = await fetch(`${URL_}/rest/v1/profiles?id=eq.${p.id}`, { method: 'DELETE', headers: { ...H, Prefer: 'return=minimal' } })
  if (!r.ok) { erros++; console.error(`  ✗ perfil ${p.email}: HTTP ${r.status} ${await r.text()}`) } else console.log(`  ✓ perfil apagado: ${p.email}`)
}

// Lendo de volta, por outro caminho (o banco): nenhum perfil daqueles ids, e
// só ficaram em auth.users as que a API não enxerga.
const depois = await contasDeProva()
const perfisDepois = depois.filter((u) => ids.includes(u.id) && u.tem_perfil)
const contasDepois = depois.filter((u) => ids.includes(u.id))
const esperadoFicar = alvo.filter((u) => !u.visivel).map((u) => u.id).sort()
if (erros || perfisDepois.length || JSON.stringify(contasDepois.map((u) => u.id).sort()) !== JSON.stringify(esperadoFicar)) {
  console.error(`\n❌ não terminou: ${erros} erro(s); perfis ainda existentes: ${perfisDepois.length}; contas: ${contasDepois.length}.`)
  process.exitCode = 1
} else {
  console.log(`\n✅ ${alvo.length} perfil(is) de prova sem sobra; ${alvo.length - esperadoFicar.length} conta(s) apagada(s) pela API.`)
  if (esperadoFicar.length) {
    console.log(`⚠️ ${esperadoFicar.length} linha(s) ficaram em auth.users (sem perfil, sem senha, invisíveis ao Auth) — tirar exige DELETE direto, decisão do dono.`)
  }
}
