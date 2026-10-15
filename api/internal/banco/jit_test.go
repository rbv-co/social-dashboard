package banco

import (
	"context"
	"os"
	"testing"
)

// Plano 07 (REVISAO-TESTES-2026-10): o JIT do Postgres liga sozinho quando o custo estimado passa de 100000, e as
// funções de painel com subconsultas por linha passam (vessel_rastreio_dos_stylists: 2,05 s com JIT, 17 ms sem, medido no
// api-db de ensaio). Toda conexão da API e do worker sai com jit=off.
func TestAbrirDesligaOJIT(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL ausente: rode `make teste` em api/")
	}
	p, err := Abrir(context.Background(), url)
	if err != nil {
		t.Fatal(err)
	}
	defer p.Close()
	var jit string
	if err := p.QueryRow(context.Background(), `select current_setting('jit')`).Scan(&jit); err != nil {
		t.Fatal(err)
	}
	if jit != "off" {
		t.Errorf("jit = %q, esperava off", jit)
	}
}
