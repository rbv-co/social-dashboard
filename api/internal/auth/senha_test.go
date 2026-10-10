package auth

import (
	"strings"
	"testing"
)

func TestSenhaRoundTrip(t *testing.T) {
	h, err := HashDaSenha("correta")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(h, "$2a$") { // mesmo prefixo que o GoTrue grava
		t.Fatalf("prefixo inesperado: %q", h[:4])
	}
	if !SenhaConfere(h, "correta") || SenhaConfere(h, "errada") || SenhaConfere("", "correta") {
		t.Fatal("conferência incorreta")
	}
}
