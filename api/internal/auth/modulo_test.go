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
	const nulo = "33333333-3333-3333-3333-333333333333"
	if _, err := p.Exec(ctx, `insert into usuarios (id, email) values ($1, 'a@x.com'), ($2, 'b@x.com'), ($3, 'c@x.com')`, com, sem, nulo); err != nil {
		t.Fatal(err)
	}
	if _, err := p.Exec(ctx, `insert into profiles (id, email, role, features) values ($1, 'a@x.com', 'viewer', '{banco,meta}'),
		($2, 'b@x.com', 'viewer', null), ($3, 'c@x.com', 'viewer', '{sales,NULL}')`, com, sem, nulo); err != nil {
		t.Fatal(err)
	}
	// features com elemento NULL não pode derrubar a API inteira (500): o NULL some.
	tn, err := s.Criar(ctx, nulo, "painel", nil)
	if err != nil {
		t.Fatal(err)
	}
	sn, err := s.Buscar(ctx, tn)
	if err != nil {
		t.Fatal(err)
	}
	an, err := CarregarAtor(ctx, p, sn)
	if err != nil {
		t.Fatalf("features com NULL: %v", err)
	}
	if !slices.Equal(an.Modulos, []string{"sales"}) {
		t.Fatalf("features com NULL: Modulos = %v", an.Modulos)
	}
	se, err := s.Criar(ctx, com, "painel", nil)
	if err != nil {
		t.Fatal(err)
	}
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
	tokSem, err := s.Criar(ctx, sem, "painel", nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct {
		token string
		quer  int
	}{{se, 200}, {tokSem, 403}} {
		if w := chamar(r, "GET", "/x", "", c.token); w.Code != c.quer {
			t.Errorf("token %q: %d, esperava %d", c.token[:min(4, len(c.token))], w.Code, c.quer)
		}
	}
}
