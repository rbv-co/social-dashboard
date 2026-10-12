package testebanco

import (
	"context"
	"crypto/rand"
	"embed"
	"encoding/hex"
	"io/fs"
	"os"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
)

//go:embed esquema/*.sql
var esquema embed.FS

// ComEsquemaDeProducao devolve um pool num banco NOVO (esq_<hex>) com a camada de compatibilidade,
// as migrações da API e o esquema de produção versionado em esquema/ (tabelas e, gerados do
// levantamento, as funções e os gatilhos verbatim), nessa ordem. Banco, e não schema, por teste: as
// funções de produção citam public.<tabela>. Pula sem TEST_DATABASE_URL, como Novo.
func ComEsquemaDeProducao(t *testing.T) *pgxpool.Pool {
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
	nome := "esq_" + hex.EncodeToString(b)
	if _, err := admin.Exec(ctx, "create database "+nome); err != nil {
		admin.Close(ctx)
		t.Fatal(err)
	}
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.Database = nome
	banco.Configurar(cfg)
	p, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		p.Close()
		admin.Exec(ctx, "drop database if exists "+nome+" with (force)")
		admin.Close(ctx)
	})
	if _, err := p.Exec(ctx, banco.Compat); err != nil {
		t.Fatalf("compat: %v", err)
	}
	if err := banco.Migrar(p); err != nil {
		t.Fatalf("migrações: %v", err)
	}
	arquivos, err := fs.Glob(esquema, "esquema/*.sql") // ordem do nome: 01-tabelas-5-1, 01-tabelas-5-2..., 02-gatilhos
	if err != nil || len(arquivos) == 0 {
		t.Fatalf("esquema/*.sql: %v", err)
	}
	for _, a := range arquivos {
		sql, _ := esquema.ReadFile(a)
		if _, err := p.Exec(ctx, string(sql)); err != nil {
			t.Fatalf("%s: %v", a, err)
		}
	}
	return p
}
