// POS-VIRADA plano 05, item B (lado negativo): perfil SEM a permissão de escrita tenta gravar com corpo válido `zz-prova-05-barrada`
// no mesmo endereço que a tela usa. Esperado: 403 (nunca 2xx). O que passar é apagado pela limpeza (nome zz-prova-05-%).
//   TOK=tokens.json node ops/pos-virada/escrita-barrada.mjs
import { readFileSync } from 'node:fs'
const BASE = (process.env.BASE || 'https://central.rbvcompany.com').replace(/\/$/, '')
const tokens = JSON.parse(readFileSync(process.env.TOK, 'utf8'))
const N = 'zz-prova-05-barrada'
// o corpo de peça precisa ser VÁLIDO (account_id + formato), senão a validação responde 400 antes de a permissão ser testada
import { execFileSync } from 'node:child_process'
const conta = execFileSync('ssh', ['-o', 'BatchMode=yes', 'op', 'docker exec -i api-db sh -c \'psql -X -At -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select id from accounts order by id limit 1"\''], { }).toString().trim()
if (!conta) { console.log('FALHA: sem account_id para montar o corpo válido'); process.exit(1) }
const alvos = [
  ['POST', '/api/patrimonio/bens', { nome: N }, ['sem', 'gestor', 'loja', 'frota', 'comercial']],
  ['POST', '/api/frota/veiculos', { nome: N, placa: 'ZZB0000' }, ['sem', 'gestor', 'loja', 'comercial']],
  ['POST', '/api/conteudo/pecas', { account_id: conta, titulo: N, formato: 'reels' }, ['sem', 'gestor', 'loja', 'frota', 'comercial']],
  ['PUT', '/api/arquivos/arquivos/zz-prova-05-barrada.txt', 'zz-prova-05', ['sem', 'gestor', 'loja', 'frota', 'comercial']],
]
let ruim = 0
for (const [m, rota, corpo, perfis] of alvos) for (const p of perfis) {
  const r = await fetch(BASE + rota, { method: m, headers: { Authorization: 'Bearer ' + tokens[p], 'Content-Type': typeof corpo === 'string' ? 'text/plain' : 'application/json' }, body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo) })
  const ok = r.status === 403
  if (!ok) ruim++
  console.log(`${m} ${rota} como ${p} => ${r.status} ${ok ? 'ok (barrado)' : 'FALHA (esperava 403)'}`)
}
// sem sessão
for (const [m, rota, corpo] of alvos) { const r = await fetch(BASE + rota, { method: m, headers: { 'Content-Type': 'application/json' }, body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo) }); const ok = r.status === 401; if (!ok) ruim++; console.log(`${m} ${rota} sem sessão => ${r.status} ${ok ? 'ok' : 'FALHA (esperava 401)'}`) }
process.exit(ruim ? 1 : 0)
