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
var esquemaSQL embed.FS

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
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatal(err)
	}
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
	// o Cleanup entra logo depois do create database: qualquer falha adiante (t.Fatal) não vaza banco nem conexão
	var p *pgxpool.Pool
	t.Cleanup(func() {
		if p != nil {
			p.Close()
		}
		if _, err := admin.Exec(ctx, "drop database if exists "+nome+" with (force)"); err != nil {
			t.Logf("não consegui apagar o banco de teste %s: %v", nome, err)
		}
		admin.Close(ctx)
	})
	cfg.ConnConfig.Database = nome
	banco.Configurar(cfg)
	p, err = pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := p.Exec(ctx, banco.Compat); err != nil {
		t.Fatalf("compat: %v", err)
	}
	if err := banco.Migrar(p); err != nil {
		t.Fatalf("migrações: %v", err)
	}
	// Ordem do nome (fs.Glob): 01-tabelas-5-01, 01-tabelas-5-02, ..., 02-gatilhos. Os arquivos das fatias
	// dos próximos sub-planos usam DOIS dígitos (01-tabelas-5-02.sql ... 01-tabelas-5-12.sql): com um só,
	// 5-10 viria antes de 5-2 e uma FK para uma tabela de 5-2 quebraria a carga. TestNomesDosArquivosDeEsquema
	// reprova nome fora desse formato.
	arquivos, err := fs.Glob(esquemaSQL, "esquema/*.sql")
	if err != nil || len(arquivos) == 0 {
		t.Fatalf("esquema/*.sql: %v", err)
	}
	for _, a := range arquivos {
		sql, err := esquemaSQL.ReadFile(a)
		if err != nil {
			t.Fatalf("%s: %v", a, err)
		}
		if _, err := p.Exec(ctx, string(sql)); err != nil {
			t.Fatalf("%s: %v", a, err)
		}
	}
	return p
}
