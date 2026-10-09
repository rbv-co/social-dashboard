package web

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

func TestSaudeEPronto(t *testing.T) {
	p := testebanco.Novo(t)
	h := Rotas(p, auth.NovoStore(p), auth.NovoLimitador())
	for _, caminho := range []string{"/saude", "/pronto"} {
		r := httptest.NewRecorder()
		h.ServeHTTP(r, httptest.NewRequest("GET", caminho, nil))
		if r.Code != http.StatusOK {
			t.Fatalf("%s = %d", caminho, r.Code)
		}
	}
}

func TestAuthEuPelasRotasReais(t *testing.T) {
	p := testebanco.Novo(t)
	s := auth.NovoStore(p)
	h := Rotas(p, s, auth.NovoLimitador())
	ctx := context.Background()
	const painel, cliente = "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"
	p.Exec(ctx, `insert into usuarios (id, email) values ($1, 'p@x.com'), ($2, 'c@x.com')`, painel, cliente)
	p.Exec(ctx, `insert into profiles (id, email, role) values ($1, 'p@x.com', 'viewer')`, painel)
	tokP, _ := s.Criar(ctx, painel, "painel", nil)
	tokC, _ := s.Criar(ctx, cliente, "cliente", nil)
	casos := []struct {
		nome, token string
		quer        int
	}{{"sem token", "", 401}, {"painel", tokP, 200}, {"cliente", tokC, 403}}
	for _, c := range casos {
		r := httptest.NewRequest("GET", "/auth/eu", nil)
		if c.token != "" {
			r.Header.Set("Authorization", "Bearer "+c.token)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != c.quer {
			t.Errorf("%s: %d, esperava %d (%s)", c.nome, w.Code, c.quer, w.Body)
		}
	}
}
