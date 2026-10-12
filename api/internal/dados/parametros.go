package dados

import (
	"errors"
	"fmt"
	"math"
	"net/url"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// LimitePadrao é o max_rows do PostgREST do Supabase: nenhuma tela recebeu mais linhas que
// isso numa leitura; manter o teto evita que uma tela antiga passe a baixar a tabela inteira.
const LimitePadrao = 1000

// ErrDeclaracao marca defeito na declaração da rota (filtro ou ordem mal escritos): não é erro
// do pedido, a rota responde 500. ValidarFiltros/ValidarOrdem pegam isso na montagem (a API
// não sobe); LerFiltros/LerOrdem conferem de novo, então pular a validação não abre brecha.
var ErrDeclaracao = errors.New("declaração de rota inválida")

func declaracao(formato string, a ...any) error {
	return fmt.Errorf("%w: %s", ErrDeclaracao, fmt.Sprintf(formato, a...))
}

// Reservado diz se o parâmetro de query é de toda leitura (e não pode ser nome de filtro).
// É função, não mapa: ninguém altera a lista em tempo de execução.
func Reservado(nome string) bool {
	switch nome {
	case "limite", "deslocamento", "ordem", "contar":
		return true
	}
	return false
}

var reDigitos = regexp.MustCompile(`^[0-9]{1,18}$`)

// unico devolve o valor do parâmetro de valor único; repetido é erro (q.Get leria só o primeiro).
func unico(q url.Values, nome string) (string, error) {
	if len(q[nome]) > 1 {
		return "", fmt.Errorf("parâmetro repetido: %q", nome)
	}
	return q.Get(nome), nil
}

type Pagina struct{ Limite, Deslocamento int }

// LerPagina: ?limite= (1..1000, padrão 1000) e ?deslocamento= (0..2147483647, padrão 0; o
// SQL da leitura usa ::int). Só dígitos: "+5" e "1.5" são recusados.
func LerPagina(q url.Values) (Pagina, error) {
	p := Pagina{Limite: LimitePadrao}
	v, err := unico(q, "limite")
	if err != nil {
		return p, err
	}
	if v != "" {
		n, err := strconv.Atoi(v)
		if !reDigitos.MatchString(v) || err != nil || n < 1 || n > LimitePadrao {
			return p, fmt.Errorf("limite deve ser de 1 a %d", LimitePadrao)
		}
		p.Limite = n
	}
	if v, err = unico(q, "deslocamento"); err != nil {
		return p, err
	}
	if v != "" {
		n, err := strconv.Atoi(v)
		if !reDigitos.MatchString(v) || err != nil || n > math.MaxInt32 {
			return p, fmt.Errorf("deslocamento deve ser de 0 a %d", math.MaxInt32)
		}
		p.Deslocamento = n
	}
	return p, nil
}

var reDesempate = regexp.MustCompile(`^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$`)

// ValidarOrdem confere a declaração de ordem da rota (chamado na montagem: erro = a API não
// sobe). `desempate` é uma coluna ÚNICA por linha (ex.: "u.id"), sempre a última chave do
// order by: sem ela, linhas com a chave de ordem repetida mudam de posição entre uma página e
// outra e o deslocamento repete ou pula linhas.
func ValidarOrdem(permitidas map[string]string, padrao, desempate string) error {
	switch {
	case padrao == "":
		return declaracao("ordem padrão obrigatória")
	case !reDesempate.MatchString(desempate):
		return declaracao("desempate %q: precisa ser uma coluna única (ex.: u.id)", desempate)
	}
	for nome, expr := range permitidas {
		if expr == "" {
			return declaracao("ordem %q sem expressão", nome)
		}
	}
	return nil
}

// LerOrdem: ?ordem=campo ou ?ordem=campo.desc, só com campos de `permitidas` (nome público →
// expressão SQL fixa, escrita na rota). Sem ?ordem, usa `padrao` (SQL fixo da rota). Devolve
// sempre "<ordem>, <desempate>". O texto do pedido NUNCA entra no SQL: só a expressão da
// tabela de permitidas.
func LerOrdem(q url.Values, permitidas map[string]string, padrao, desempate string) (string, error) {
	if err := ValidarOrdem(permitidas, padrao, desempate); err != nil {
		return "", err
	}
	v, err := unico(q, "ordem")
	if err != nil {
		return "", err
	}
	if v == "" {
		return padrao + ", " + desempate, nil
	}
	campo, sentido, temPonto := strings.Cut(v, ".")
	expr, ok := permitidas[campo]
	if !ok || (temPonto && sentido != "asc" && sentido != "desc") {
		return "", fmt.Errorf("ordem inválida: %q", v)
	}
	if sentido == "" {
		sentido = "asc"
	}
	return expr + " " + sentido + ", " + desempate, nil
}

// Filtro é um filtro de query DECLARADO pela rota: ?<Param>=valor vira `and <SQL>` com o valor
// no parâmetro nomeado @<Param>, já convertido para o Tipo. SQL é texto fixo da rota e TEM de
// trazer o cast explícito do parâmetro, compatível com o Tipo (ex.: "u.veiculo_id =
// @veiculo::uuid"), e não pode citar outro @parâmetro.
type Filtro struct {
	Param string
	SQL   string
	Tipo  string // texto | uuid | inteiro | data | instante | booleano; com sufixo [] = lista por vírgula
}

var (
	reParam = regexp.MustCompile(`^[a-z][a-z0-9_]{0,40}$`)
	reUUID  = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
	// @nome com o cast que vem logo depois, se houver; "@>" e "@@" do Postgres não casam
	reUsoDeParam = regexp.MustCompile(`@([a-z][a-z0-9_]*)(::[A-Za-z0-9_]+(?:\[\])?)?`)
	// Para cada Tipo, os casts em que o pgx consegue codificar o valor que converter() produz.
	// inteiro é int64: ::int e ::smallint estourariam com 2147483648 (erro de codificação = 500).
	castsDoTipo = map[string][]string{
		"texto":    {"text", "varchar"},
		"uuid":     {"uuid"},
		"inteiro":  {"bigint", "int8", "numeric"},
		"data":     {"date"},
		"instante": {"timestamptz"},
		"booleano": {"boolean", "bool"},
	}
)

// Validar confere a declaração (chamado na montagem das rotas: erro = a API não sobe).
func (f Filtro) Validar() error {
	lista := strings.HasSuffix(f.Tipo, "[]")
	casts, ok := castsDoTipo[strings.TrimSuffix(f.Tipo, "[]")]
	switch {
	case !reParam.MatchString(f.Param) || Reservado(f.Param):
		return declaracao("filtro %q: nome inválido ou reservado", f.Param)
	case !ok:
		return declaracao("filtro %q: tipo desconhecido %q", f.Param, f.Tipo)
	}
	usos := 0
	for _, m := range reUsoDeParam.FindAllStringSubmatch(f.SQL, -1) {
		if m[1] != f.Param {
			return declaracao("filtro %q: o SQL usa @%s, que não é o parâmetro do filtro", f.Param, m[1])
		}
		usos++
		cast := strings.ToLower(strings.TrimPrefix(m[2], "::"))
		if lista != strings.HasSuffix(cast, "[]") || !slices.Contains(casts, strings.TrimSuffix(cast, "[]")) {
			return declaracao("filtro %q: o SQL precisa de @%s::<tipo> compatível com %s (um de %v%s), achei %q",
				f.Param, f.Param, f.Tipo, casts, map[bool]string{true: " com []", false: ""}[lista], m[0])
		}
	}
	if usos == 0 {
		return declaracao("filtro %q: o SQL não usa @%s", f.Param, f.Param)
	}
	return nil
}

// ValidarFiltros confere todos os filtros da rota (cada um, Param repetido) e que nenhum
// Param colide com `usados`, os nomes de argumentos que a rota já põe no SQL (escopo, página).
func ValidarFiltros(filtros []Filtro, usados ...string) error {
	vistos := map[string]bool{}
	for _, u := range usados {
		vistos[u] = true
	}
	for _, f := range filtros {
		if err := f.Validar(); err != nil {
			return err
		}
		if vistos[f.Param] {
			return declaracao("filtro %q: nome repetido ou igual a um argumento da rota", f.Param)
		}
		vistos[f.Param] = true
	}
	return nil
}

// LerFiltros lê os filtros presentes na query, põe os valores em args e devolve as condições,
// cada uma JÁ ENTRE PARÊNTESES (um `a or b` solto, num `and` depois da regra de leitura, a
// cancelaria: nenhum chamador pode esquecer), na ordem do nome do parâmetro (SQL determinístico). Parâmetro que não é filtro nem
// reservado, repetido (inclusive reservado) ou com valor inválido = erro (400). Filtro mal
// declarado ou nome já presente em args = ErrDeclaracao (500: defeito da rota).
func LerFiltros(q url.Values, filtros []Filtro, args pgx.NamedArgs) ([]string, error) {
	porNome := map[string]Filtro{}
	for _, f := range filtros {
		porNome[f.Param] = f
	}
	nomes := make([]string, 0, len(q))
	for nome, vals := range q {
		if len(vals) != 1 {
			return nil, fmt.Errorf("parâmetro repetido: %q", nome)
		}
		nomes = append(nomes, nome)
	}
	slices.Sort(nomes)
	var conds []string
	for _, nome := range nomes {
		if Reservado(nome) {
			continue
		}
		f, ok := porNome[nome]
		if !ok {
			return nil, fmt.Errorf("parâmetro desconhecido: %q", nome)
		}
		if err := f.Validar(); err != nil {
			return nil, err
		}
		if _, existe := args[nome]; existe {
			return nil, declaracao("filtro %q: já existe argumento com esse nome", nome)
		}
		v, err := converter(f.Tipo, q.Get(nome))
		if err != nil {
			return nil, fmt.Errorf("%s: %w", nome, err)
		}
		args[nome] = v
		conds = append(conds, "("+f.SQL+")")
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
