package dados

import (
	"regexp"
	"slices"
	"strings"

	"github.com/rbv-co/social-dashboard/api/internal/autz"
)

// GRAMÁTICA ACEITA PARA O SQL DE UMA Consulta (e para Onde, filtros e ordens). O que não for
// reconhecido é recusado (ErrDeclaracao): a validação FALHA FECHADA. Ela existe para que nenhuma
// tabela seja lida sem a regra de Ler do catálogo; não é um parser de SQL.
//
//   - UM select só, sem `;`, sem comentário (`--`, `/*`), sem identificador entre aspas, sem `$`,
//     sem `union`/`intersect`/`except`, `with`, `table`, `values`, `lateral`, `for`, `into`, `window`.
//   - Literais entre apóstrofos são lidos por inteiro (parênteses e palavras dentro deles não contam);
//     um literal não pode conter `{ler:`; E'..', B'..', U&'..' são recusados.
//   - O nível 0 é: select <lista> from <Tabela> <Alias> [join ...]*, sem where/group/order/limit
//     (o framework acrescenta where, order by e limit; filtros e a regra entram ali, ou em Onde).
//   - A principal (Tabela Alias) aparece UMA vez, em qualquer lugar do texto, e é o primeiro item do
//     from do nível 0. Quem a lê de novo (subconsulta, join) é recusado.
//   - Toda outra tabela lida, em qualquer lugar (join, subconsulta na lista, em where, em parênteses),
//     vem depois de from/join, é tabela do catálogo, tem alias, e tem o marcador {ler:<tabela>:<alias>}
//     NA SUA CONDIÇÃO: no `on` do próprio join, ou no `where` da subconsulta quando é o primeiro item
//     do from. O marcador tem de ser um termo de `and` (precedido por and/on/where/"(" e seguido de
//     and/")"), sem `or` no mesmo nível nem em nível que o envolva, e sem `not`, comparação ou função
//     em volta: o marcador vira "(regra)", e `x or (regra)` ou `not (regra)` cancelaria a regra.
//   - Um alias por tabela e uma tabela por alias, em toda a declaração (SQL e Onde): os parâmetros
//     da regra se chamam autz_<alias>_..., e dois marcadores com o mesmo alias trocariam parâmetros.
//   - Só join, inner join e left join, sempre com `on`. Sem right/full/cross/natural join, sem
//     `using`, sem junção por vírgula, sem subconsulta nem parênteses depois de from/join.
//   - Função depois de from/join só da lista fechada abaixo (funções de conjunto que expandem uma
//     coluna ou literal); qualquer outra poderia ler tabelas (SECURITY DEFINER) sem regra.
//   - `from` só abre o from de um select; dentro de função ou expressão é recusado.
//
// FALSOS POSITIVOS (recusados de propósito): `is [not] distinct from` (use `is not distinct from`
// só no where das subconsultas? não: use `coalesce`/`<>` com `is null`), `extract(... from c.col)`
// (use `date_part('...', c.col)`), `trim/substring/overlay(... from ...)` (use btrim/ltrim/rtrim,
// substr, left/right), `from` com várias tabelas separadas por vírgula (use join), CTE (`with`),
// subconsulta no from (derived table), `left`/`right`/`inner`/`full`/`cross`/`natural`/`using`/`order`/
// `group`/`limit`/`for`/`window`/`values`/`only`/`table`/`into`/`fetch`/`returning` usados como nome de
// coluna, qualquer `where`/`group by`/`order by`/`limit` no nível 0, marcador sob `or`/`not`.
//
// NÃO É VERIFICÁVEL AQUI (revisão humana em cada rota): função na LISTA do select (ou em qualquer
// expressão) que leia tabelas por dentro (funções SECURITY DEFINER do banco): chamá-la pode expor
// linhas que a regra de Ler não deixaria ver.
var funcoesDeConjunto = []string{"jsonb_array_elements", "jsonb_array_elements_text", "json_array_elements",
	"json_array_elements_text", "jsonb_each", "jsonb_each_text", "json_each", "json_each_text", "unnest", "generate_series"}

type tk struct {
	k byte   // i ident (minúsculo) | n número | s literal | o operador/pontuação | m marcador | p parâmetro @nome
	s string // texto; do marcador, a tabela
	a string // do marcador, o alias
}

var reAliasSQL = regexp.MustCompile(`^[a-z][a-z0-9_]{0,30}$`)

func ehLetra(c byte) bool   { return c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c == '_' }
func ehDigito(c byte) bool  { return c >= '0' && c <= '9' }
func ehIdentCh(c byte) bool { return ehLetra(c) || ehDigito(c) }

// tokenizar lê o SQL por inteiro ou recusa. Comentário, aspas duplas, `$`, `;`, barra invertida,
// crase e byte não ASCII fora de literal não têm lugar numa consulta declarada.
func tokenizar(sql string) ([]tk, error) {
	var out []tk
	n := len(sql)
	for i := 0; i < n; {
		c := sql[i]
		switch {
		case c == ' ' || c == '\t' || c == '\n' || c == '\r':
			i++
		case c == '{':
			loc := reMarcador.FindStringSubmatchIndex(sql[i:])
			if loc == nil || loc[0] != 0 {
				return nil, declaracao("'{' fora de um marcador {ler:<tabela>:<alias>}")
			}
			out = append(out, tk{k: 'm', s: sql[i+loc[2] : i+loc[3]], a: sql[i+loc[4] : i+loc[5]]})
			i += loc[1]
		case c == '\'':
			if i > 0 && (ehIdentCh(sql[i-1]) || sql[i-1] == '&') {
				return nil, declaracao("literal com prefixo (E'', B'', U&'', N''): não suportado")
			}
			j := i + 1
			for {
				if j >= n {
					return nil, declaracao("literal sem fim")
				}
				if sql[j] == '\'' {
					if j+1 < n && sql[j+1] == '\'' {
						j += 2
						continue
					}
					break
				}
				j++
			}
			if strings.Contains(sql[i+1:j], "{ler:") {
				return nil, declaracao("literal contendo {ler:")
			}
			out = append(out, tk{k: 's', s: sql[i : j+1]})
			i = j + 1
		case ehLetra(c):
			j := i
			for j < n && ehIdentCh(sql[j]) {
				j++
			}
			out = append(out, tk{k: 'i', s: strings.ToLower(sql[i:j])})
			i = j
		case ehDigito(c):
			j := i
			for j < n && (ehIdentCh(sql[j]) || sql[j] == '.') {
				j++
			}
			out = append(out, tk{k: 'n', s: sql[i:j]})
			i = j
		case c == '@' && i+1 < n && ehLetra(sql[i+1]):
			j := i + 1
			for j < n && ehIdentCh(sql[j]) {
				j++
			}
			out = append(out, tk{k: 'p', s: sql[i:j]})
			i = j
		case strings.IndexByte("(),.[]", c) >= 0:
			out = append(out, tk{k: 'o', s: string(c)})
			i++
		case strings.IndexByte("+-*/<>=~!@#%^&|:?", c) >= 0:
			j := i
			for j < n && strings.IndexByte("+-*/<>=~!@#%^&|:?", sql[j]) >= 0 {
				j++
			}
			if strings.Contains(sql[i:j], "--") || strings.Contains(sql[i:j], "/*") {
				return nil, declaracao("comentário no SQL")
			}
			out = append(out, tk{k: 'o', s: sql[i:j]})
			i = j
		default:
			return nil, declaracao("caractere %q não permitido no SQL da consulta (comentário, aspas duplas, $, ; ou fora do ASCII)", string(c))
		}
	}
	return out, nil
}

var proibidas = map[string]bool{"union": true, "intersect": true, "except": true, "table": true, "with": true,
	"recursive": true, "lateral": true, "full": true, "natural": true, "cross": true, "using": true, "values": true,
	"only": true, "tablesample": true, "for": true, "into": true, "fetch": true, "window": true, "returning": true}

// reservadas não são nome de tabela nem de alias.
var reservadas = map[string]bool{"select": true, "from": true, "where": true, "on": true, "join": true, "left": true,
	"right": true, "inner": true, "outer": true, "group": true, "order": true, "limit": true, "offset": true,
	"having": true, "as": true, "and": true, "or": true, "not": true, "distinct": true, "by": true}

// registro liga cada alias a uma tabela e cada tabela a um alias, em toda a declaração.
type registro struct{ tabAlias, aliasTab map[string]string }

func novoRegistro() *registro {
	return &registro{tabAlias: map[string]string{}, aliasTab: map[string]string{}}
}

func (r *registro) ligar(tab, alias string) error {
	if a, ok := r.tabAlias[tab]; ok && a != alias {
		return declaracao("a tabela %s tem dois aliases (%s e %s): use um alias só por tabela", tab, a, alias)
	}
	if t, ok := r.aliasTab[alias]; ok && t != tab {
		return declaracao("o alias %s está em duas tabelas (%s e %s): os parâmetros da regra se chocariam", alias, t, tab)
	}
	r.tabAlias[tab], r.aliasTab[alias] = alias, tab
	return nil
}

type leitura struct {
	tab, alias string
	ini, fim   int // tokens [ini,fim) da condição (on ou where) onde o marcador tem de estar; ini<0: sem condição
}

const (
	fLista    = iota // select <lista>, antes do from
	fItem            // logo depois de from/join: espera tabela ou função de conjunto
	fApos            // depois do item: espera on/join/where/... ou o fim
	fAliasSRF        // depois de uma função de conjunto: alias opcional
	fOn              // condição do on
	fOnde            // condição do where
	fCauda           // group/order/limit/offset/having
)

type moldura struct {
	sel       bool // select (senão parênteses de expressão/função)
	srf       bool // argumentos de uma função de conjunto no from
	fase      int
	nivel     int
	primeiro  bool     // o próximo item é o primeiro do from
	primeira  *leitura // leitura do primeiro item do from (a condição dela é o where)
	juncao    *leitura // leitura do join que espera o on
	precisaOn bool
	cur       *leitura // leitura cuja condição está aberta
}

type varredor struct {
	cat        *autz.Catalogo
	tabela     string // a principal da consulta: não pode ser lida em outro lugar
	alias      string
	reg        *registro
	marcadores bool // o texto aceita {ler:}
	nivel0     bool // o texto é o SQL de uma Consulta (começa em select), não um fragmento
	toks       []tk
	d          []int // profundidade de cada token ("(" e ")" ficam na de fora)
	leituras   []*leitura
	usados     []int // índices dos marcadores
}

func (v *varredor) e(formato string, a ...any) error { return declaracao(formato, a...) }

func (t tk) eh(s string) bool { return (t.k == 'i' || t.k == 'o') && t.s == s }

func (v *varredor) prox(i int) tk {
	if i+1 < len(v.toks) {
		return v.toks[i+1]
	}
	return tk{}
}

func srfListada(s string) bool { return slices.Contains(funcoesDeConjunto, s) }

// varrer confere `sql` (nivel0 true: o SQL de uma Consulta, que começa em select) ou um
// fragmento escalar (Onde, filtro, ordem). Ver a gramática no topo do arquivo.
func (v *varredor) varrer(sql string, nivel0 bool) error {
	toks, err := tokenizar(sql)
	if err != nil {
		return err
	}
	v.nivel0 = nivel0
	v.toks, v.d = toks, make([]int, len(toks))
	n := len(toks)
	pilha := []*moldura{{sel: nivel0, fase: fLista, primeiro: false}}
	i := 0
	if nivel0 {
		if n == 0 || !toks[0].eh("select") {
			return v.e("o SQL tem de ser um select só")
		}
		i = 1
	}
	for ; i < n; i++ {
		t := toks[i]
		f := pilha[len(pilha)-1]
		v.d[i] = len(pilha) - 1
		// fecha parênteses
		if t.eh(")") && t.k == 'o' {
			if len(pilha) == 1 {
				return v.e("parêntese de fechar sem abrir")
			}
			if f.sel && (f.fase == fItem || (f.fase == fApos && f.precisaOn)) {
				return v.e("subconsulta termina no meio do from/join")
			}
			if f.cur != nil {
				f.cur.fim = i
			}
			pilha = pilha[:len(pilha)-1]
			v.d[i] = len(pilha) - 1
			if f.srf {
				pilha[len(pilha)-1].fase = fAliasSRF
			}
			continue
		}
		// alias opcional depois de função de conjunto
		if f.sel && f.fase == fAliasSRF {
			f.fase = fApos
			if t.k == 'i' && t.s == "as" {
				if p := v.prox(i); p.k != 'i' || reservadas[p.s] || !reAliasSQL.MatchString(p.s) {
					return v.e("alias inválido depois de as")
				}
				i++
				v.d[i] = len(pilha) - 1
				continue
			}
			if t.k == 'i' && !reservadas[t.s] {
				if !reAliasSQL.MatchString(t.s) {
					return v.e("alias inválido %q", t.s)
				}
				continue
			}
		}
		if t.k == 'm' {
			if !v.marcadores {
				return v.e("marcador {ler:...} não vale aqui (só no SQL e no Onde)")
			}
			if f.sel && (f.fase == fItem || f.fase == fApos || f.fase == fAliasSRF) {
				return v.e("marcador no meio do from/join")
			}
			v.usados = append(v.usados, i)
			continue
		}
		if f.sel && f.fase == fItem {
			j, err := v.item(f, i)
			if err != nil {
				return err
			}
			if j < 0 { // função de conjunto: o "(" abre a moldura dos argumentos
				v.d[i] = len(pilha) - 1
				i = -j
				v.d[i] = len(pilha) - 1 // o "(" fica na profundidade de fora
				pilha = append(pilha, &moldura{srf: true, nivel: len(pilha)})
				continue
			}
			for k := i; k <= j; k++ {
				v.d[k] = len(pilha) - 1
			}
			i = j
			continue
		}
		if t.eh("(") && t.k == 'o' {
			if f.sel && f.fase == fApos {
				return v.e("parênteses depois do item do from/join")
			}
			nova := &moldura{nivel: len(pilha)}
			if p := v.prox(i); p.eh("select") {
				nova.sel = true
				i++
				v.d[i] = len(pilha)
			}
			pilha = append(pilha, nova)
			continue
		}
		if t.k != 'i' {
			if f.sel && f.fase == fApos {
				if t.eh(",") {
					p, q := v.prox(i), tk{}
					if i+2 < n {
						q = toks[i+2]
					}
					if p.k != 'i' || !srfListada(p.s) || !q.eh("(") {
						return v.e("junção por vírgula: use join com on (só função de conjunto da lista fechada entra depois da vírgula)")
					}
					f.fase = fItem
					continue
				}
				return v.e("%q depois do item do from/join", t.s)
			}
			continue
		}
		// ---- palavras ----
		w := t.s
		if proibidas[w] {
			return v.e("%q não é aceito numa consulta declarada", w)
		}
		switch w {
		case "select":
			return v.e("select fora de parênteses")
		case "right":
			if !v.prox(i).eh("(") {
				return v.e("right join não é aceito (o lado preservado ficaria sem regra)")
			}
		case "from":
			if !f.sel || f.fase != fLista {
				return v.e("from fora de um select (extract/trim/substring/is distinct from: use date_part/btrim/<>)")
			}
			if i > 0 && toks[i-1].eh("distinct") {
				return v.e("is [not] distinct from não é aceito")
			}
			f.fase, f.primeiro = fItem, true
			continue
		case "join", "inner", "left":
			if w == "left" && v.prox(i).eh("(") {
				break // função left(texto, n)
			}
			if w == "inner" || w == "left" {
				j := i + 1
				if w == "left" && j < n && toks[j].eh("outer") {
					j++
				}
				if j >= n || !toks[j].eh("join") {
					return v.e("%q sem join", w)
				}
				if !f.sel || (f.fase != fApos && f.fase != fOn) {
					return v.e("%s join fora do from", w)
				}
				v.juntar(f, i)
				for k := i; k <= j; k++ {
					v.d[k] = len(pilha) - 1
				}
				i = j
				continue
			}
			if !f.sel || (f.fase != fApos && f.fase != fOn) {
				return v.e("join fora do from")
			}
			v.juntar(f, i)
			continue
		case "on":
			if f.sel {
				switch f.fase {
				case fApos:
					if !f.precisaOn {
						return v.e("on sem join")
					}
					f.cur = f.juncao
					if f.cur != nil {
						f.cur.ini = i + 1
					}
					f.precisaOn, f.fase = false, fOn
					continue
				case fLista: // select distinct on (...)
				default:
					return v.e("on fora de um join")
				}
			}
		case "where":
			if f.sel {
				switch f.fase {
				case fApos, fOn:
					if f.fase == fApos && f.precisaOn {
						return v.e("join sem on")
					}
					if f.nivel == 0 {
						return v.e("where no nível 0: o framework acrescenta where, order e limit (use Onde e os filtros)")
					}
					if f.cur != nil {
						f.cur.fim = i
					}
					f.cur = f.primeira
					if f.cur != nil && f.cur.ini < 0 {
						f.cur.ini = i + 1
					}
					f.fase = fOnde
					continue
				default:
					return v.e("where fora do lugar")
				}
			}
		case "group", "order", "limit", "offset", "having":
			if f.sel {
				if f.nivel == 0 {
					return v.e("%s no nível 0: o framework acrescenta order e limit; sem group/having/offset", w)
				}
				switch f.fase {
				case fApos:
					if f.precisaOn {
						return v.e("join sem on")
					}
					fallthrough
				case fOn, fOnde:
					if f.cur != nil {
						f.cur.fim = i
					}
					f.cur, f.fase = nil, fCauda
				}
			}
		}
		if f.sel && f.fase == fApos {
			return v.e("%q depois do item do from/join", w)
		}
	}
	if len(pilha) != 1 {
		return v.e("parênteses sem fechar")
	}
	f := pilha[0]
	if nivel0 {
		if (f.fase != fApos && f.fase != fOn && f.fase != fAliasSRF) || f.precisaOn {
			return v.e("o SQL tem de terminar no from/join (o framework acrescenta where, order e limit)")
		}
		if f.cur != nil {
			f.cur.fim = n
		}
	}
	return v.conferir()
}

// juntar abre o item de um join (o `join`, ou o `inner`/`left` que o precede, está em i).
func (v *varredor) juntar(f *moldura, i int) {
	if f.cur != nil {
		f.cur.fim = i
	}
	f.cur, f.juncao, f.fase, f.precisaOn = nil, nil, fItem, true
}

// item lê o item depois de from/join/vírgula em toks[i]. Devolve o índice do último token usado,
// ou -(índice do "(") quando é função de conjunto (a moldura dos argumentos abre no chamador).
func (v *varredor) item(f *moldura, i int) (int, error) {
	t := v.toks[i]
	if t.k != 'i' || reservadas[t.s] || proibidas[t.s] {
		return 0, v.e("depois de from/join só tabela ou função de conjunto (achei %q)", t.s)
	}
	p := v.prox(i)
	primeiro := f.primeiro
	f.primeiro = false
	if p.eh("(") && p.k == 'o' {
		if !srfListada(t.s) {
			return 0, v.e("função %q no from: só %v (outra poderia ler tabelas sem a regra)", t.s, funcoesDeConjunto)
		}
		if f.nivel == 0 && primeiro && v.nivel0 {
			return 0, v.e("o primeiro item do from é %s %s", v.tabela, v.alias)
		}
		return -(i + 1), nil
	}
	if p.eh(".") {
		return 0, v.e("tabela com schema (%s.): use o nome simples", t.s)
	}
	j := i + 1
	if p.eh("as") {
		j++
	}
	if j >= len(v.toks) || v.toks[j].k != 'i' || reservadas[v.toks[j].s] || !reAliasSQL.MatchString(v.toks[j].s) {
		return 0, v.e("tabela %q sem alias válido", t.s)
	}
	tab, alias := t.s, v.toks[j].s
	if _, err := v.cat.Filtro(&autz.Escopo{}, tab, autz.Ler, alias); err != nil {
		return 0, v.e("tabela %q (alias %q): %v", tab, alias, err)
	}
	if err := v.reg.ligar(tab, alias); err != nil {
		return 0, err
	}
	switch {
	case f.nivel == 0 && primeiro && v.nivel0: // o lugar da principal
		if tab != v.tabela || alias != v.alias {
			return 0, v.e("o primeiro item do from é %s %s (e não %s %s)", v.tabela, v.alias, tab, alias)
		}
	case tab == v.tabela:
		return 0, v.e("%s é a tabela principal: lida só uma vez, como primeiro item do from do nível 0", tab)
	case f.nivel == 0 && primeiro && v.nivel0:
		return 0, v.e("o primeiro item do from é %s %s", v.tabela, v.alias)
	default:
		rd := &leitura{tab: tab, alias: alias, ini: -1}
		v.leituras = append(v.leituras, rd)
		if primeiro {
			f.primeira = rd
		} else {
			f.juncao = rd
		}
	}
	f.fase = fApos
	return j, nil
}

// conferir: toda tabela lida tem o marcador dela, bem posto, na condição dela; e todo
// marcador usado pertence a uma tabela lida (ou à principal).
func (v *varredor) conferir() error {
	for _, rd := range v.leituras {
		if rd.ini < 0 || rd.ini >= len(v.toks) || rd.fim < rd.ini {
			return v.e("%s %s é lida sem condição: ponha {ler:%s:%s} no on do join, ou no where da subconsulta", rd.tab, rd.alias, rd.tab, rd.alias)
		}
		achou := false
		for _, m := range v.usados {
			if m >= rd.ini && m < rd.fim && v.toks[m].s == rd.tab && v.toks[m].a == rd.alias && v.marcadorSeguro(rd.ini, rd.fim, m) {
				achou = true
				break
			}
		}
		if !achou {
			return v.e("%s %s é lida sem {ler:%s:%s} como termo de and na própria condição (sem or, not nem comparação em volta)", rd.tab, rd.alias, rd.tab, rd.alias)
		}
	}
	for _, m := range v.usados {
		t := v.toks[m]
		if v.reg.tabAlias[t.s] != t.a {
			return v.e("marcador {ler:%s:%s} sem a leitura da tabela com esse alias", t.s, t.a)
		}
	}
	return nil
}

func (v *varredor) termoDeAnd(t tk) bool {
	return t.k == 'i' && (t.s == "and" || t.s == "on" || t.s == "where")
}

// marcadorSeguro: o marcador `m` (dentro da condição [ini,fim)) é um termo de and, sem or no
// seu nível nem nos que o envolvem, e os parênteses que o envolvem são só agrupamento.
func (v *varredor) marcadorSeguro(ini, fim, m int) bool {
	ant := v.toks[m-1]
	if !v.termoDeAnd(ant) && !ant.eh("(") {
		return false
	}
	if m+1 < fim {
		if p := v.toks[m+1]; !(p.k == 'i' && p.s == "and") && !p.eh(")") {
			return false
		}
	}
	base := v.d[ini]
	for nivel := v.d[m]; nivel >= base; nivel-- {
		esq, dir := m, m
		for esq-1 >= ini && v.d[esq-1] >= nivel {
			esq--
		}
		for dir+1 < fim && v.d[dir+1] >= nivel {
			dir++
		}
		for k := esq; k <= dir; k++ {
			if v.d[k] == nivel && v.toks[k].k == 'i' && v.toks[k].s == "or" {
				return false
			}
		}
		if nivel > base {
			ab := esq - 1 // o "(" que abre este nível
			if ab < ini || ab < 1 || !v.toks[ab].eh("(") || v.toks[ab].k != 'o' {
				return false
			}
			if a := v.toks[ab-1]; !v.termoDeAnd(a) && !a.eh("(") {
				return false
			}
			if v.toks[ab+1].eh("select") {
				return false
			}
		}
	}
	return true
}
