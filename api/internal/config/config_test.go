package config

import "testing"

func TestCarregarExigeDatabaseURL(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	if _, err := Carregar(); err == nil {
		t.Fatal("deveria recusar sem DATABASE_URL")
	}
}

func TestCarregarPadroes(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://x")
	t.Setenv("ADDR", "")
	t.Setenv("ORIGENS_PERMITIDAS", " https://a.com , ,https://b.com ")
	c, err := Carregar()
	if err != nil {
		t.Fatal(err)
	}
	if c.Addr != ":8080" {
		t.Fatalf("Addr = %q", c.Addr)
	}
	if len(c.Origens) != 2 || c.Origens[0] != "https://a.com" || c.Origens[1] != "https://b.com" {
		t.Fatalf("Origens = %#v", c.Origens)
	}
}
