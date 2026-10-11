package dados

import (
	"fmt"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// LimitePadrao é o max_rows do PostgREST do Supabase: nenhuma tela recebeu mais linhas que
// isso numa leitura; manter o teto evita que uma tela antiga passe a baixar a tabela inteira.
const LimitePadrao = 1000

// Reservados são os parâmetros de query que toda leitura entende, além dos filtros da rota.
var Reservados = map[string]bool{"limite": true, "deslocamento": true, "ordem": true, "contar": true}

type Pagina struct{ Limite, Deslocamento int }

// LerPagina: ?limite= (1..1000, padrão 1000) e ?deslocamento= (>= 0, padrão 0).
func LerPagina(q url.Values) (Pagina, error) {
	p := Pagina{Limite: LimitePadrao}
	if v := q.Get("limite"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 || n > LimitePadrao {
			return p, fmt.Errorf("limite deve ser de 1 a %d", LimitePadrao)
		}
		p.Limite = n
	}
	if v := q.Get("deslocamento"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 0 {
			return p, fmt.Errorf("deslocamento deve ser 0 ou mais")
		}
		p.Deslocamento = n
	}
	return p, nil
}

// LerOrdem: ?ordem=campo ou ?ordem=campo.desc, só com campos de `permitidas` (nome público →
// expressão SQL fixa, escrita na rota). Sem ?ordem, devolve `padrao` (SQL fixo da rota).
// O texto do pedido NUNCA entra no SQL: só a expressão da tabela de permitidas.
func LerOrdem(q url.Values, permitidas map[string]string, padrao string) (string, error) {
	v := q.Get("ordem")
	if v == "" {
		return padrao, nil
	}
	campo, sentido, _ := strings.Cut(v, ".")
	expr, ok := permitidas[campo]
	if !ok || (sentido != "" && sentido != "asc" && sentido != "desc") {
		return "", fmt.Errorf("ordem inválida: %q", v)
	}
	if sentido == "" {
		sentido = "asc"
	}
	return expr + " " + sentido, nil
}

// Filtro é um filtro de query DECLARADO pela rota: ?<Param>=valor vira `and <SQL>` com o valor
// no parâmetro nomeado @<Param>, já convertido para o Tipo. SQL é texto fixo da rota e TEM de
// trazer o cast explícito do parâmetro (ex.: "u.veiculo_id = @veiculo::uuid").
type Filtro struct {
	Param string
	SQL   string
	Tipo  string // texto | uuid | inteiro | data | instante | booleano; com sufixo [] = lista por vírgula
}

var (
	reParam = regexp.MustCompile(`^[a-z][a-z0-9_]{0,40}$`)
	reUUID  = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
	tipos   = map[string]bool{"texto": true, "uuid": true, "inteiro": true, "data": true, "instante": true, "booleano": true}
)

// Validar confere a declaração (chamado na montagem das rotas: erro = a API não sobe).
func (f Filtro) Validar() error {
	base := strings.TrimSuffix(f.Tipo, "[]")
	switch {
	case !reParam.MatchString(f.Param) || Reservados[f.Param]:
		return fmt.Errorf("filtro %q: nome inválido ou reservado", f.Param)
	case !tipos[base]:
		return fmt.Errorf("filtro %q: tipo desconhecido %q", f.Param, f.Tipo)
	case !strings.Contains(f.SQL, "@"+f.Param+"::"):
		return fmt.Errorf("filtro %q: o SQL precisa do cast explícito @%s::<tipo>", f.Param, f.Param)
	}
	return nil
}

// LerFiltros lê os filtros presentes na query, põe os valores em args e devolve as condições.
// Parâmetro que não é filtro nem reservado, repetido ou com valor inválido = erro (400).
func LerFiltros(q url.Values, filtros []Filtro, args pgx.NamedArgs) ([]string, error) {
	porNome := map[string]Filtro{}
	for _, f := range filtros {
		porNome[f.Param] = f
	}
	var conds []string
	for nome, vals := range q {
		if len(vals) != 1 {
			return nil, fmt.Errorf("parâmetro repetido: %q", nome)
		}
		if Reservados[nome] {
			continue
		}
		f, ok := porNome[nome]
		if !ok {
			return nil, fmt.Errorf("parâmetro desconhecido: %q", nome)
		}
		v, err := converter(f.Tipo, vals[0])
		if err != nil {
			return nil, fmt.Errorf("%s: %w", nome, err)
		}
		args[nome] = v
		conds = append(conds, f.SQL)
	}
	return conds, nil
}

func converter(tipo, v string) (any, error) {
	if base, lista := strings.CutSuffix(tipo, "[]"); lista {
		partes := strings.Split(v, ",")
		if len(partes) > 1000 {
			return nil, fmt.Errorf("lista grande demais")
		}
		// fatia tipada: o pgx sabe codificar []string, []int64 e []bool num array do Postgres
		var textos []string
		var inteiros []int64
		var bools []bool
		for _, p := range partes {
			x, err := converter(base, p)
			if err != nil {
				return nil, err
			}
			switch y := x.(type) {
			case int64:
				inteiros = append(inteiros, y)
			case bool:
				bools = append(bools, y)
			case time.Time:
				textos = append(textos, y.Format(time.RFC3339Nano))
			default:
				textos = append(textos, y.(string))
			}
		}
		switch base {
		case "inteiro":
			return inteiros, nil
		case "booleano":
			return bools, nil
		}
		return textos, nil
	}
	switch tipo {
	case "texto":
		if len(v) > 500 {
			return nil, fmt.Errorf("texto grande demais")
		}
		return v, nil
	case "uuid":
		if !reUUID.MatchString(v) {
			return nil, fmt.Errorf("não é um uuid")
		}
		return strings.ToLower(v), nil
	case "inteiro":
		return strconv.ParseInt(v, 10, 64)
	case "booleano":
		return strconv.ParseBool(v)
	case "data":
		d, err := time.Parse(time.DateOnly, v)
		if err != nil {
			return nil, fmt.Errorf("data deve ser AAAA-MM-DD")
		}
		return d.Format(time.DateOnly), nil
	case "instante":
		t, err := time.Parse(time.RFC3339, v)
		if err != nil {
			return nil, fmt.Errorf("instante deve ser RFC 3339")
		}
		return t, nil
	}
	return nil, fmt.Errorf("tipo desconhecido %q", tipo)
}
