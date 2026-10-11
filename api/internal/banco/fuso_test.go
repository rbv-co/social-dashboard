package banco

import (
	"context"
	"os"
	"testing"
)

// O pool da API fala UTC, como o Supabase: sem isso o JSON montado pelo Postgres sairia no
// fuso do servidor (o contêiner do Postgres usa "Etc/UTC", e um VPS pode usar outro).
func TestAbrirFalaUTC(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL ausente: rode `make teste` em api/")
	}
	p, err := Abrir(context.Background(), url)
	if err != nil {
		t.Fatal(err)
	}
	defer p.Close()
	var fuso string
	if err := p.QueryRow(context.Background(), `show timezone`).Scan(&fuso); err != nil || fuso != "UTC" {
		t.Fatalf("timezone = %q (%v), esperava UTC", fuso, err)
	}
}
