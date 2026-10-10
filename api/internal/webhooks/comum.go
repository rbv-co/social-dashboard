package webhooks

import (
	"errors"

	"github.com/jackc/pgx/v5/pgconn"
)

// erroSemDados: o texto de erro do Postgres pode citar o valor recusado (dado pessoal); do erro do
// banco só vão ao log o código e a restrição/contexto.
func erroSemDados(err error) string {
	var pg *pgconn.PgError
	if errors.As(err, &pg) {
		return "pg " + pg.Code + " " + pg.ConstraintName
	}
	return err.Error()
}
