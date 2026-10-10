// Package testebanco dá a cada teste um schema novo e migrado num Postgres real.
// Pula sozinho se TEST_DATABASE_URL não existir (use `make teste`).
package testebanco

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"os"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
)

// Tabelas que em produção vêm do dump do Supabase. Aqui só o mínimo que o núcleo lê.
const legado = `
create table profiles (
  id uuid primary key, email text, role text,
  is_superadmin boolean default false, permissions jsonb default '{}'::jsonb,
  disabled boolean default false,
  features text[] default '{banco}', escopo_por_equipe boolean default false
);
create table robos_execucoes (
  id bigserial primary key, robo text not null, request_id bigint,
  disparado_em timestamptz not null default now(), status_code int, ok boolean,
  resposta text, conferido_em timestamptz
);`

func Novo(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL ausente: rode `make teste` em api/")
	}
	ctx := context.Background()
	admin, err := pgx.Connect(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	b := make([]byte, 6)
	rand.Read(b)
	esquema := "t_" + hex.EncodeToString(b)
	if _, err := admin.Exec(ctx, "create schema "+esquema); err != nil {
		t.Fatal(err)
	}
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = esquema
	p, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		p.Close()
		admin.Exec(ctx, "drop schema "+esquema+" cascade")
		admin.Close(ctx)
	})
	if err := banco.Migrar(p); err != nil {
		t.Fatal(err)
	}
	if _, err := p.Exec(ctx, legado); err != nil {
		t.Fatal(err)
	}
	return p
}
