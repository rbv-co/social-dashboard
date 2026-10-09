// CATÁLOGO DE POLICIES lido do texto das migrations (sem banco, sem rede).
// É um CRUZAMENTO, não a verdade: a verdade é `pg_policies` de produção
// (docs/migracao-go/levantamento.sql). A ordem aplicada é a ordem dos arquivos.
import { semComentario } from '../../coletor/objetos-de-uma-migration.mjs'

const nome = (s) => String(s).replace(/^public\./i, '').replace(/^"|"$/g, '').toLowerCase()

// Acha o fim do comando (';' fora de parênteses e de aspas simples).
function fimDoComando(s, de) {
  let d = 0, aspas = false
  for (let i = de; i < s.length; i++) {
    const c = s[i]
    if (c === "'") aspas = !aspas
    else if (!aspas && c === '(') d++
    else if (!aspas && c === ')') d--
    else if (!aspas && d === 0 && c === ';') return i
  }
  return s.length
}

// Devolve o conteúdo do parêntese que abre em s[i].
function conteudoDoParentese(s, i) {
  let d = 0, aspas = false
  for (let j = i; j < s.length; j++) {
    const c = s[j]
    if (c === "'") aspas = !aspas
    else if (!aspas && c === '(') d++
    else if (!aspas && c === ')') { d--; if (d === 0) return s.slice(i + 1, j).trim() }
  }
  return null
}

function clausula(corpo, re) {
  const m = re.exec(corpo)
  return m ? conteudoDoParentese(corpo, m.index + m[0].length - 1) : null
}

export function catalogo(arquivos) {
  const mapa = new Map()
  for (const { nome: arquivo, sql } of arquivos) {
    const s = semComentario(sql)
    const eventos = []
    for (const m of s.matchAll(/drop\s+policy\s+(?:if\s+exists\s+)?("[^"]+"|\w+)\s+on\s+([\w".]+)/gi)) {
      eventos.push({ pos: m.index, drop: true, nome: nome(m[1]), tabela: nome(m[2]) })
    }
    for (const m of s.matchAll(/create\s+policy\s+("[^"]+"|\w+)\s+on\s+([\w".]+)/gi)) {
      const corpo = s.slice(m.index, fimDoComando(s, m.index))
      const cmd = /\bfor\s+(all|select|insert|update|delete)\b/i.exec(corpo)
      const to = /\bto\s+([\w",\s]+?)(?=\s+(?:using|with)\b|\s*$)/i.exec(corpo)
      eventos.push({
        pos: m.index, drop: false, nome: nome(m[1]), tabela: nome(m[2]),
        comando: cmd ? cmd[1].toLowerCase() : 'all',
        papeis: to ? to[1].split(',').map((x) => x.trim().replace(/"/g, '').toLowerCase()).filter(Boolean) : ['public'],
        using: clausula(corpo, /\busing\s*\(/i),
        withCheck: clausula(corpo, /\bwith\s+check\s*\(/i),
        arquivo,
      })
    }
    eventos.sort((a, b) => a.pos - b.pos)
    for (const e of eventos) {
      const k = `${e.tabela}|${e.nome}`
      if (e.drop) mapa.delete(k)
      else mapa.set(k, { tabela: e.tabela, nome: e.nome, comando: e.comando, papeis: e.papeis, using: e.using, withCheck: e.withCheck, arquivo: e.arquivo })
    }
  }
  return [...mapa.values()].sort((a, b) => a.tabela.localeCompare(b.tabela) || a.nome.localeCompare(b.nome))
}
