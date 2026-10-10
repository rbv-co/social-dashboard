package auth

import (
	"context"
	"net/http"
	"slices"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

func TestCarregarAtorLeFeaturesEExigirModulo(t *testing.T) {
	p := testebanco.Novo(t)
	s := NovoStore(p)
	ctx := context.Background()
	const com, sem = "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"
	p.Exec(ctx, `insert into usuarios (id, email) values ($1, 'a@x.com'), ($2, 'b@x.com')`, com, sem)
	p.Exec(ctx, `insert into profiles (id, email, role, features) values ($1, 'a@x.com', 'viewer', '{banco,meta}'), ($2, 'b@x.com', 'viewer', null)`, com, sem)
	se, _ := s.Criar(ctx, com, "painel", nil)
	sessao, err := s.Buscar(ctx, se)
	if err != nil {
		t.Fatal(err)
	}
	a, err := CarregarAtor(ctx, p, sessao)
	if err != nil || !slices.Equal(a.Modulos, []string{"banco", "meta"}) {
		t.Fatalf("Modulos = %v (%v)", a.Modulos, err)
	}

	r := chi.NewRouter()
	r.Use(Exigir(p, s))
	r.With(ExigirModulo("social", "meta")).Get("/x", func(w http.ResponseWriter, _ *http.Request) { w.Write([]byte("ok")) })
	tokSem, _ := s.Criar(ctx, sem, "painel", nil)
	for _, c := range []struct {
		token string
		quer  int
	}{{se, 200}, {tokSem, 403}} {
		if w := chamar(r, "GET", "/x", "", c.token); w.Code != c.quer {
			t.Errorf("token %q: %d, esperava %d", c.token[:4], w.Code, c.quer)
		}
	}
}
