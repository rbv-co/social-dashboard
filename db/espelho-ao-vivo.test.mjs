import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/* ⚠️ POR QUE ESTE ARQUIVO EXISTE
 *
 * O dono pediu, em 12/09/2026, que o cadastro fosse AO VIVO para o Bling e para
 * a planilha, "sem travar, com certeza absoluta que irá aos dois caminhos".
 *
 * O que atrasava era um FREIO DE 20 SEGUNDOS no gatilho, e ele existia por um
 * motivo real: duas rodadas ao mesmo tempo criam DOIS contatos no Bling para a
 * mesma pessoa. Esta migration troca o freio por uma TRAVA.
 *
 * Este teste falha se alguém: devolver o freio, deixar a trava sem prazo de
 * validade (que prenderia o robô para sempre se ele morresse no meio), trocar a
 * tomada atômica por select+update, ou abrir a trava para o navegador. */

const SQL = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)),
       'migrations/2026-09-12-espelho-ao-vivo.sql'), 'utf8')

/** O corpo de UMA função, para uma asserção não vazar para a função vizinha. */
function corpoDaFuncao(nome) {
  const i = SQL.indexOf(`function public.${nome}(`)
  assert.notEqual(i, -1, `não achei a função ${nome}`)
  const ini = SQL.indexOf('$function$', i)
  const fim = SQL.indexOf('$function$;', ini + 10)
  return SQL.slice(ini, fim)
}

test('⚠️ o freio de 20 segundos SAIU do gatilho', () => {
  /* Era ele que fazia ~1 de cada 6 cadastros esperar até 3 minutos. Se voltar,
   * o "ao vivo" que o dono pediu volta a não ser verdade — e ninguém percebe,
   * porque continua chegando, só que tarde. */
  const gatilho = corpoDaFuncao('vessel_espelhar_agora')
  assert.ok(!/interval\s*'20 seconds'/i.test(gatilho), 'o freio de 20s voltou')
  assert.ok(!/robos_execucoes/i.test(gatilho),
    'o gatilho voltou a consultar a última rodada para decidir se dispara')
  assert.match(gatilho, /disparar_robo/, 'o gatilho tem de continuar disparando')
})

test('⚠️ a trava TEM prazo de validade', () => {
  /* Trava sem prazo presa por um robô que morreu no meio trava o robô PARA
   * SEMPRE, e o sintoma é exatamente o que o dono não quer: parou de ir. */
  assert.match(SQL, /create table if not exists public\.robos_travas/i)
  assert.match(SQL, /expira_em\s+timestamptz not null/i)
  const tomar = corpoDaFuncao('tomar_trava')
  assert.match(tomar, /make_interval\(secs\s*=>\s*p_segundos\)/i,
    'o prazo tem de vir do parâmetro, não cravado')
})

test('⚠️ tomar a trava é UM comando — nunca select seguido de update', () => {
  /* Duas rodadas passam pelo `select` juntas e as duas acham que ganharam. É a
   * forma clássica de a trava não travar nada. Aqui quem arbitra é a chave
   * primária, e o `where` do `do update` só deixa entrar quem chega com a trava
   * já vencida. */
  const tomar = corpoDaFuncao('tomar_trava')
  assert.match(tomar, /on conflict \(robo\) do update/i)
  assert.match(tomar, /where t\.expira_em <= now\(\)/i,
    'sem este `where`, quem chega atropela quem está com a trava')
  assert.ok(!/select .* from public\.robos_travas/i.test(tomar),
    'voltou a ler antes de escrever: duas rodadas passariam juntas')
})

test('⚠️ a trava não é do navegador', () => {
  for (const f of ['tomar_trava\\(text, integer\\)', 'soltar_trava\\(text\\)']) {
    assert.match(SQL, new RegExp(`revoke execute on function public\\.${f}\\s+from public, anon, authenticated`, 'i'),
      `${f} ficou aberta para quem não é robô`)
  }
  assert.match(SQL, /grant\s+execute on function public\.tomar_trava\(text, integer\)\s+to service_role/i)
})

test('⚠️ a tabela da trava tem RLS ligada', () => {
  assert.match(SQL, /alter table public\.robos_travas enable row level security/i)
})

test('o vigia responde quem está parado, e há quanto tempo', () => {
  /* "Certeza absoluta" não é promessa: é medida. O robô se cura sozinho porque
   * COMPARA em vez de trabalhar por fila — mas "deveria se curar" não é prova. */
  const vigia = corpoDaFuncao('vessel_lista_atrasados')
  assert.match(vigia, /bling_em is null/i)
  assert.match(vigia, /planilha_em is null/i)
  assert.match(vigia, /make_interval\(mins\s*=>\s*p_minutos\)/i)
  assert.match(SQL, /revoke execute on function public\.vessel_lista_atrasados\(integer\) from public, anon/i,
    'o vigia lê data de cadastro de gente: não é para a porta pública')
})

test('⚠️ toda função nova é security definer com search_path preso', () => {
  for (const nome of ['tomar_trava', 'soltar_trava', 'vessel_espelhar_agora', 'vessel_lista_atrasados']) {
    const i = SQL.indexOf(`function public.${nome}(`)
    const cabecalho = SQL.slice(i, SQL.indexOf('$function$', i))
    assert.match(cabecalho, /security definer/i, `${nome} sem security definer`)
    assert.match(cabecalho, /set search_path to 'public'/i,
      `${nome} sem search_path preso — é por onde se sequestra uma função definer`)
  }
})
