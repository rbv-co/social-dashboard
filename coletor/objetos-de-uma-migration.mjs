// O QUE UMA MIGRATION CRIA — lido do texto do .sql, sem banco e sem rede.
//
// Separado de `conferir-migrations-pendentes.mjs` porque e a unica parte dele
// que pode errar CALADA: se a extracao deixar um objeto de fora, a migration
// passa como "ja aplicada" sem ter sido conferida inteira, e a divida volta
// disfarcada de lista limpa. Aqui ela tem teste.
// Tira comentario de linha e de bloco ANTES de procurar os `create`: sem isto,
// um exemplo dentro de comentario vira objeto que o banco nao tem, e a
// migration inteira sai como "falta algo" por causa de uma explicacao.
export const semComentario = (sql) => sql
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .split('\n').map((l) => l.replace(/--.*$/, '')).join('\n')

const nome = (s) => String(s).replace(/^public\./i, '').replace(/^"|"$/g, '').toLowerCase()

export function objetosDe(sql) {
  const s = semComentario(sql)
  const achados = []
  const p = (re, tipo, quantos = 1) => {
    for (const m of s.matchAll(re)) {
      achados.push(quantos === 2
        ? { tipo, alvo: nome(m[1]), dono: nome(m[2]) }
        : { tipo, alvo: nome(m[1]) })
    }
  }
  p(/create\s+table\s+(?:if\s+not\s+exists\s+)?([\w".]+)/gi, 'tabela')
  p(/create\s+(?:or\s+replace\s+)?(?:materialized\s+)?view\s+([\w".]+)/gi, 'view')
  p(/create\s+(?:or\s+replace\s+)?function\s+([\w".]+)\s*\(/gi, 'funcao')
  p(/create\s+trigger\s+([\w"]+)/gi, 'trigger')
  p(/create\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?([\w"]+)/gi, 'indice')
  p(/create\s+policy\s+("[^"]+"|[\w]+)\s+on\s+([\w".]+)/gi, 'policy', 2)
  // ⚠️ AQUI A ORDEM SE INVERTE, e foi assim que um teste pegou o furo: em
  // `create policy X on Y` o primeiro grupo e o ALVO e o segundo e o DONO; em
  // `alter table Y add column X` e o contrario. Sem inverter, o conferidor
  // procurava uma tabela chamada "grupo" dentro de uma tabela chamada
  // "bling_lojas" — nao achava, e reprovava uma migration que esta aplicada.
  for (const m of s.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?([\w".]+)[\s\S]{0,120}?add\s+column\s+(?:if\s+not\s+exists\s+)?([\w"]+)/gi)) {
    achados.push({ tipo: 'coluna', alvo: nome(m[2]), dono: nome(m[1]) })
  }
  // dedup: o mesmo objeto criado duas vezes no arquivo conta uma vez
  const vistos = new Set()
  return achados.filter((o) => {
    const k = `${o.tipo}|${o.alvo}|${o.dono || ''}`
    if (vistos.has(k)) return false
    vistos.add(k); return true
  })
}

