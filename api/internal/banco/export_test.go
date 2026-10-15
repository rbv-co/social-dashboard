package banco

import (
	"database/sql"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
)

// GooseDoTeste entrega ao teste externo (banco_test) o goose já ligado às migrações embutidas, para
// subir e descer versão por versão (Migrar só sobe até o fim).
func GooseDoTeste(p *pgxpool.Pool) (*sql.DB, string, error) {
	goose.SetBaseFS(migracoes)
	if err := goose.SetDialect("postgres"); err != nil {
		return nil, "", err
	}
	return stdlib.OpenDBFromPool(p), "migracoes", nil
}
