package dados

import (
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"reflect"
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

var reMarcador = regexp.MustCompile(`\{ler:([a-z_][a-z0-9_]*):([a-z][a-z0-9_]*)\}`)

// Validar confere a declaração na montagem das rotas (erro = a API não sobe, e todo erro daqui
// é ErrDeclaracao): tabela e alias no catálogo, ordem e filtros válidos, e a gramática de
// gramatica.go: NENHUMA tabela lida sem a regra, no SQL, no Onde, nos filtros e nas ordens.
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
	reg := novoRegistro()
	if err := reg.ligar(c.Tabela, c.Alias); err != nil {
		return err
	}
	novo := func(marcadores bool, r *registro) *varredor {
		return &varredor{cat: cat, tabela: c.Tabela, alias: c.Alias, reg: r, marcadores: marcadores}
	}
	if err := novo(true, reg).varrer(c.SQL, true); err != nil {
		return fmt.Errorf("consulta %s: %w", c.Tabela, err)
	}
	if c.Onde != "" {
		if err := novo(true, reg).varrer(c.Onde, false); err != nil {
			return fmt.Errorf("consulta %s (Onde): %w", c.Tabela, err)
		}
	}
	// filtros e ordens não são trocados por marcador (não têm {ler:}): não podem ler tabela alguma
	escalar := func(onde, texto string) error {
		r := novoRegistro()
		r.ligar(c.Tabela, c.Alias)
		if err := novo(false, r).varrer(texto, false); err != nil {
			return fmt.Errorf("consulta %s (%s): %w", c.Tabela, onde, err)
		}
		return nil
	}
	for _, f := range c.Filtros {
		if strings.HasPrefix(f.Param, "autz_") {
			return declaracao("filtro %q: o prefixo autz_ é do escopo", f.Param)
		}
		if err := escalar("filtro "+f.Param, f.SQL); err != nil {
			return err
		}
	}
	for nome, expr := range c.Ordens {
		if err := escalar("ordem "+nome, expr); err != nil {
			return err
		}
	}
	return escalar("OrdemPadrao", c.OrdemPadrao)
}

// juntarArgs copia os parâmetros do filtro do escopo para args. Dois filtros com o mesmo nome de
// parâmetro e valores diferentes (um sobrescreveria o outro e a regra de uma tabela seria avaliada
// com os valores da regra de outra) é defeito da declaração: ErrDeclaracao, nunca "o último vence".
func juntarArgs(args pgx.NamedArgs, f autz.Filtro) error {
	for k, v := range f.Args {
		if antigo, ok := args[k]; ok && !reflect.DeepEqual(antigo, v) {
			return declaracao("o parâmetro %s da regra de Ler aparece com dois valores (alias repetido em tabelas diferentes?)", k)
		}
		args[k] = v
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
		if err := juntarArgs(args, f); err != nil {
			falha = err
			return "false"
		}
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
	if err := juntarArgs(args, f); err != nil {
		return "", "", nil, err
	}
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
	// cada condição entre parênteses: `a or b` sem eles viraria `(regra) and a or b` e cancelaria a regra
	onde := []string{"(" + f.SQL + ")"}
	for _, cond := range conds {
		onde = append(onde, "("+cond+")")
	}
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
	case errors.Is(err, autz.ErrDeclaracao), errors.Is(err, ErrDeclaracao):
		slog.Error("escrita: declaração da rota inválida", "erro", err.Error())
		Erro(w, http.StatusInternalServerError, "erro_interno", "")
	default:
		ErroDoBanco(w, err)
	}
}
