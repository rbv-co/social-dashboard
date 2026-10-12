// Package banco abre o pool do Postgres e aplica as migrations embutidas.
package banco

import (
	"context"
	"embed"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
)

//go:embed migracoes/*.sql
var migracoes embed.FS

// Configurar é o que toda conexão da API usa. timezone=UTC é o do Supabase: o JSON que o
// Postgres monta (dados.Lista) sai com "+00:00", no formato que o PostgREST entregava às telas.
func Configurar(c *pgxpool.Config) {
	c.ConnConfig.RuntimeParams["timezone"] = "UTC"
}

func Abrir(ctx context.Context, url string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, err
	}
	Configurar(cfg)
	p, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	if err := p.Ping(ctx); err != nil {
		p.Close()
		return nil, err
	}
	return p, nil
}

func Migrar(p *pgxpool.Pool) error {
	goose.SetBaseFS(migracoes)
	if err := goose.SetDialect("postgres"); err != nil {
		return err
	}
	db := stdlib.OpenDBFromPool(p)
	defer db.Close()
	return goose.Up(db, "migracoes")
}
