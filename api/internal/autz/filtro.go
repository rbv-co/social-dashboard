package autz

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"

	"github.com/jackc/pgx/v5"
)

// Filtro é a condição SQL de uma tabela×operação para quem pede, já com os valores do ator
// em parâmetros nomeados (@autz_N, com cast). Entra no WHERE da consulta da rota.
type Filtro struct {
	SQL   string
	Args  pgx.NamedArgs
	Alias string
}

// Nega: a condição é a constante false (a rota pode responder 403 sem ir ao banco).
func (f Filtro) Nega() bool { return f.SQL == "false" }

// Filtro devolve a condição de tab×op sobre `alias`. Tabela fora do catálogo = erro (nega).
// O SQL só contém texto fixo deste pacote e o alias (citado): nada do pedido entra nele.
func (c *Catalogo) Filtro(e *Escopo, tab string, op Op, alias string) (Filtro, error) {
	nega := Filtro{SQL: "false", Args: pgx.NamedArgs{}, Alias: alias}
	if !reAlias.MatchString(alias) {
		return nega, fmt.Errorf("autz: alias inválido %q", alias)
	}
	if e == nil {
		return nega, errors.New("autz: sem escopo (a rota não passou por ComEscopo)")
	}
	p, err := c.regra(tab, op)
	if err != nil {
		return nega, err
	}
	a := &argumentos{prefixo: fmt.Sprintf("autz_%s_%d_", alias, op), v: pgx.NamedArgs{}}
	return Filtro{SQL: p.sql(e, alias, a), Args: a.v, Alias: alias}, nil
}

var reAlias = regexp.MustCompile(`^[a-z][a-z0-9_]{0,30}$`)

// Juntar copia os parâmetros do filtro em args (os nomes autz_* não colidem com os da rota).
func (f Filtro) Juntar(args pgx.NamedArgs) pgx.NamedArgs {
	for k, v := range f.Args {
		args[k] = v
	}
	return args
}

// Conferir avalia o filtro sobre uma linha que ainda não existe (insert, ou o valor novo de um
// update): monta a linha com o tipo da própria tabela (jsonb_populate_record) e roda a condição.
// Coluna que a tabela não tem é ignorada pelo Postgres; NULL na condição = negado.
func Conferir(ctx context.Context, b Banco, f Filtro, tab string, linha map[string]any) (bool, error) {
	if f.Nega() {
		return false, nil
	}
	j, err := json.Marshal(linha)
	if err != nil {
		return false, err
	}
	args := f.Juntar(pgx.NamedArgs{"autz_linha": string(j)})
	var ok *bool
	err = b.QueryRow(ctx, `select (`+f.SQL+`) from jsonb_populate_record(null::`+pgx.Identifier{tab}.Sanitize()+
		`, @autz_linha::jsonb) as `+pgx.Identifier{f.Alias}.Sanitize(), args).Scan(&ok)
	if err != nil {
		return false, err
	}
	return ok != nil && *ok, nil
}

// ErrNegado: a operação não passa na regra (a rota responde 403).
var ErrNegado = errors.New("autz: negado")
