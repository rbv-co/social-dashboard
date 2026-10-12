package dados

import (
	"errors"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
)

// Consulta é uma rota de LEITURA declarada: SQL fixo escrito no domínio, filtros e ordens da
// lista branca, e a regra de Ler do catálogo entrando sozinha no WHERE da tabela principal e
// em cada tabela embutida ({ler:<tabela>:<alias>}). O pedido nunca escolhe tabela, coluna nem
// trecho de SQL: só valores de filtros declarados.
type Consulta struct {
	Tabela, Alias string
	// SQL: "select ... from <Tabela> <Alias> [join ...]", sem where/order/limit. Toda OUTRA
	// tabela lida (join, subconsulta) leva o marcador {ler:<tabela>:<alias>} na sua condição,
	// ex.: "(select row_to_json(v) from frota_veiculos v where v.id = u.veiculo_id and {ler:frota_veiculos:v})".
	SQL         string
	Onde        string // condição fixa extra (sem valor do pedido); opcional; aceita marcadores
	Filtros     []Filtro
	Ordens      map[string]string
	OrdemPadrao string // obrigatória: lista sem ordem não é determinística
	Desempate   string // coluna única por linha (ex.: "c.id"): última chave do order by (ver ValidarOrdem)
}

var (
	reMarcador = regexp.MustCompile(`\{ler:([a-z_][a-z0-9_]*):([a-z][a-z0-9_]*)\}`)
	reFonte    = regexp.MustCompile(`(?i)\b(?:from|join)\s*`)
	reItem     = regexp.MustCompile(`(?i)^([a-z_][a-z0-9_.]*)(\s*\()?(?:\s+(?:as\s+)?([a-z][a-z0-9_]*))?`)
	reAliasFn  = regexp.MustCompile(`(?i)^(?:\s+(?:as\s+)?[a-z][a-z0-9_]*)?`)
	reVirgula  = regexp.MustCompile(`^\s*,\s*(?:(?i:lateral)\s+)?`)
	reSubquery = regexp.MustCompile(`(?i)^\(\s*(select|values)\b`)
	// palavras que aparecem depois de from/join sem ser tabela, ou no lugar do alias
	palavras = map[string]bool{"lateral": true, "select": true, "where": true, "on": true, "join": true, "left": true,
		"right": true, "full": true, "inner": true, "cross": true, "natural": true, "order": true, "group": true,
		"limit": true, "offset": true, "using": true, "union": true, "except": true, "intersect": true, "having": true,
		"window": true, "for": true, "returning": true, "tablesample": true}
)

// fechaParenteses devolve a posição logo depois do ")" que fecha o "(" em s[0] (len(s) se não fecha).
func fechaParenteses(s string) int {
	nivel := 0
	for i := 0; i < len(s); i++ {
		switch s[i] {
		case '(':
			nivel++
		case ')':
			if nivel--; nivel == 0 {
				return i + 1
			}
		}
	}
	return len(s)
}

// varrer acha toda tabela lida por `sql` (depois de from/join, inclusive as separadas por
// vírgula) e exige que cada "tabela alias" esteja em `guardadas`. Funções (jsonb_array_elements(...))
// e subconsultas não são tabelas. Devolve as tabelas lidas. Erro = ErrDeclaracao.
//
// ponytail: é um regex, não um parser. Ele erra para o lado seguro (recusa): `extract(x from c.col)`
// ou `trim(... from c.col)` com coluna de alias.coluna parecem tabela e são recusados; escreva
// `date_part('x', c.col)`. Identificador entre aspas e tabela entre parênteses são recusados.
func varrer(sql string, guardadas map[string]bool) (map[string]bool, error) {
	if strings.ContainsAny(sql, `"`) {
		return nil, declaracao("SQL com identificador entre aspas: não dá para conferir que tabela lê")
	}
	lidas := map[string]bool{}
	for _, loc := range reFonte.FindAllStringIndex(sql, -1) {
		resto := sql[loc[1]:]
		for {
			if strings.HasPrefix(resto, "(") {
				if !reSubquery.MatchString(resto) {
					return nil, declaracao("%q: tabela entre parênteses; use join/from simples", abreviar(resto))
				}
				break // subconsulta: o from de dentro é varrido por si
			}
			m := reItem.FindStringSubmatch(resto)
			if m == nil {
				break // from 1 (substring), etc.: não é tabela
			}
			nome, alias := strings.ToLower(m[1]), strings.ToLower(m[3])
			if m[2] != "" || palavras[nome] { // função, ou palavra-chave no lugar do nome
				if m[2] == "" {
					break
				}
				resto = resto[len(m[1])+len(m[2])-1:]
				resto = resto[fechaParenteses(resto):]
				resto = resto[len(reAliasFn.FindString(resto)):]
			} else {
				if palavras[alias] {
					alias = ""
				}
				if !guardadas[nome+" "+alias] {
					return nil, declaracao("%q (alias %q) é lida sem {ler:%s:%s}", nome, alias, nome, alias)
				}
				lidas[nome+" "+alias] = true
				fim := len(m[1])
				if alias != "" {
					fim = len(m[0])
				}
				resto = resto[fim:]
			}
			v := reVirgula.FindString(resto)
			if v == "" {
				break
			}
			resto = resto[len(v):]
		}
	}
	return lidas, nil
}

func abreviar(s string) string {
	if len(s) > 30 {
		return s[:30]
	}
	return s
}

// Validar confere a declaração na montagem das rotas (erro = a API não sobe, e todo erro daqui
// é ErrDeclaracao): tabela e marcadores no catálogo, alias certo, ordem e filtros válidos, e
// NENHUMA tabela lida sem regra (no SQL, no Onde, nos filtros e nas ordens).
func (c Consulta) Validar(cat *autz.Catalogo) error {
	sem := &autz.Escopo{} // só para o catálogo conferir tabela e alias; o resultado não é usado
	if _, err := cat.Filtro(sem, c.Tabela, autz.Ler, c.Alias); err != nil {
		return declaracao("consulta %q alias %q: %v", c.Tabela, c.Alias, err)
	}
	if err := ValidarOrdem(c.Ordens, c.OrdemPadrao, c.Desempate); err != nil {
		return err
	}
	if err := ValidarFiltros(c.Filtros, "limite", "deslocamento"); err != nil {
		return err
	}
	guardadas := map[string]bool{c.Tabela + " " + c.Alias: true}
	for _, texto := range []string{c.SQL, c.Onde} {
		for _, m := range reMarcador.FindAllStringSubmatch(texto, -1) {
			if _, err := cat.Filtro(sem, m[1], autz.Ler, m[2]); err != nil {
				return declaracao("consulta %s: marcador {ler:%s:%s}: %v", c.Tabela, m[1], m[2], err)
			}
			guardadas[m[1]+" "+m[2]] = true
		}
	}
	lidas, err := varrer(reMarcador.ReplaceAllString(c.SQL, "true"), guardadas)
	if err != nil {
		return declaracao("consulta %s: %v", c.Tabela, err)
	}
	if !lidas[c.Tabela+" "+c.Alias] {
		return declaracao("consulta %s: o SQL não lê %s %s", c.Tabela, c.Tabela, c.Alias)
	}
	if _, err := varrer(reMarcador.ReplaceAllString(c.Onde, "true"), guardadas); err != nil {
		return declaracao("consulta %s (Onde): %v", c.Tabela, err)
	}
	// filtros e ordens não têm marcador (não são trocados em montar): não podem ler tabela
	// alguma, nem conter o texto de um marcador (iria cru para o Postgres)
	soEscalar := func(onde, texto string) error {
		if reMarcador.MatchString(texto) {
			return declaracao("consulta %s (%s): marcador {ler:...} só vale no SQL e no Onde", c.Tabela, onde)
		}
		if _, err := varrer(texto, nil); err != nil {
			return declaracao("consulta %s (%s): %v", c.Tabela, onde, err)
		}
		return nil
	}
	for _, f := range c.Filtros {
		if strings.HasPrefix(f.Param, "autz_") {
			return declaracao("filtro %q: o prefixo autz_ é do escopo", f.Param)
		}
		if err := soEscalar("filtro "+f.Param, f.SQL); err != nil {
			return err
		}
	}
	for nome, expr := range c.Ordens {
		if err := soEscalar("ordem "+nome, expr); err != nil {
			return err
		}
	}
	if err := soEscalar("OrdemPadrao", c.OrdemPadrao); err != nil {
		return err
	}
	return nil
}

// trocarMarcadores põe a regra de Ler de cada {ler:<tabela>:<alias>} e junta os parâmetros dela em args.
func trocarMarcadores(texto string, e *autz.Escopo, cat *autz.Catalogo, args pgx.NamedArgs) (string, error) {
	var falha error
	out := reMarcador.ReplaceAllStringFunc(texto, func(s string) string {
		m := reMarcador.FindStringSubmatch(s)
		f, err := cat.Filtro(e, m[1], autz.Ler, m[2])
		if err != nil {
			falha = err
			return "false"
		}
		f.Juntar(args)
		return "(" + f.SQL + ")"
	})
	return out, falha
}

// montar devolve o SQL final (com ordem e página), o SQL base (para contar) e os argumentos.
func (c Consulta) montar(q url.Values, e *autz.Escopo, cat *autz.Catalogo) (string, string, pgx.NamedArgs, error) {
	args := pgx.NamedArgs{}
	// a regra do escopo primeiro: LerFiltros recusa filtro com nome de argumento já usado
	sql, err := trocarMarcadores(c.SQL, e, cat, args)
	if err != nil {
		return "", "", nil, err
	}
	extra, err := trocarMarcadores(c.Onde, e, cat, args)
	if err != nil {
		return "", "", nil, err
	}
	f, err := cat.Filtro(e, c.Tabela, autz.Ler, c.Alias)
	if err != nil {
		return "", "", nil, err
	}
	f.Juntar(args)
	pag, err := LerPagina(q)
	if err != nil {
		return "", "", nil, errPedido{err}
	}
	ordem, err := LerOrdem(q, c.Ordens, c.OrdemPadrao, c.Desempate)
	if err != nil {
		return "", "", nil, comoPedido(err)
	}
	conds, err := LerFiltros(q, c.Filtros, args)
	if err != nil {
		return "", "", nil, comoPedido(err)
	}
	onde := append([]string{"(" + f.SQL + ")"}, conds...)
	if extra != "" {
		onde = append(onde, "("+extra+")")
	}
	base := sql + " where " + strings.Join(onde, " and ")
	args["limite"], args["deslocamento"] = pag.Limite, pag.Deslocamento
	return base + " order by " + ordem + " limit @limite::int offset @deslocamento::int", base, args, nil
}

// errPedido é o erro do pedido (400); ErrDeclaracao e falhas do catálogo/banco não são (500).
type errPedido struct{ error }

func comoPedido(err error) error {
	if errors.Is(err, ErrDeclaracao) {
		return err
	}
	return errPedido{err}
}

// Handler responde a lista (200 [] quando nada passa na regra, como o PostgREST com RLS).
// ?contar=1 acrescenta X-Total-Count (total sem paginação). Monte DEPOIS de autz.ComEscopo.
// Declaração inválida derruba a montagem (panic): rota que lê sem regra nunca entra no ar.
func (c Consulta) Handler(b Consultor, cat *autz.Catalogo) http.HandlerFunc {
	if err := c.Validar(cat); err != nil {
		panic(err)
	}
	return func(w http.ResponseWriter, r *http.Request) {
		q, ok := LerQuery(w, r)
		if !ok {
			return
		}
		sql, base, args, err := c.montar(q, autz.EscopoDo(r.Context()), cat)
		var pe errPedido
		switch {
		case errors.As(err, &pe):
			Erro(w, http.StatusBadRequest, "pedido_invalido", pe.Error())
			return
		case err != nil:
			ErroDoBanco(w, err)
			return
		}
		if v := q.Get("contar"); v != "" {
			if v != "1" {
				Erro(w, http.StatusBadRequest, "pedido_invalido", "contar só aceita 1")
				return
			}
			var n int64
			if err := b.QueryRow(r.Context(), `select count(*) from (`+base+`) t`, args).Scan(&n); err != nil {
				ErroDoBanco(w, err)
				return
			}
			w.Header().Set("X-Total-Count", strconv.FormatInt(n, 10))
		}
		Lista(r.Context(), b, w, sql, args)
	}
}

// ErroDeEscrita traduz o resultado de autz.PodeCriar/PodeEditar/PodeApagar ou da gravação.
func ErroDeEscrita(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, autz.ErrNaoEncontrado):
		Erro(w, http.StatusNotFound, "nao_encontrado", "")
	case errors.Is(err, autz.ErrNegado):
		Erro(w, http.StatusForbidden, "sem_permissao", "")
	default:
		ErroDoBanco(w, err)
	}
}
