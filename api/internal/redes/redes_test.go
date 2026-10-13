package redes

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
)

// eco: sonda montada só no teste. Escreve o que a cadeia (auth.Exigir → autz.ComEscopo) entregou.
func eco(r chi.Router, _ *pgxpool.Pool) {
	r.Get("/eco", func(w http.ResponseWriter, r *http.Request) {
		e, a := autz.EscopoDo(r.Context()), auth.AtorDoContexto(r.Context())
		fmt.Fprintf(w, "%t|%s|%t", autz.VeTodasAsContas(e), strings.Join(e.Contas, ","), a.ImpersonadorID != nil)
	})
}

func TestMundoDasRedes(t *testing.T) {
	m := novoMundo(t, eco)
	for _, c := range []struct {
		quem  string
		st    int
		corpo string
	}{
		{"", 401, ""},
		{"todas", 200, "true||false"},
		{"soA1", 200, "false|" + A1 + "|false"},
		{"nenhuma", 200, "false||false"},
		{"adminA1", 200, "true|" + A1 + "|false"},
		{"superA1", 200, "true|" + A1 + "|false"},
		{"emailA1", 200, "false|" + A1 + "|false"},
		{"semModulo", 200, "true||false"},
		{"impersonado", 200, "false|" + A1 + "|true"},
		{"desativado", 401, ""},
	} {
		st, corpo := m.Pedir(t, c.quem, "GET", "/eco", "")
		if st != c.st || (c.st == 200 && corpo != c.corpo) {
			t.Errorf("%q: %d %q, esperava %d %q", c.quem, st, corpo, c.st, c.corpo)
		}
	}
}

// A regra que o proxy e as rotas ao vivo usam (autz.PodeVerConta) é a de produção, pessoa a pessoa.
func TestPodeVerContaIgualAProducao(t *testing.T) {
	m := novoMundo(t)
	ctx := context.Background()
	viu, negou := false, false
	for _, x := range pessoas {
		e, err := autz.CarregarEscopo(ctx, m.P, x.ID)
		if err != nil {
			t.Fatal(err)
		}
		for _, c := range []string{A1, A2, A3} {
			var prod bool
			if err := banco.ComUsuario(ctx, m.P, x.ID, func(tx pgx.Tx) error {
				return tx.QueryRow(ctx, `select public.pode_ver_conta($1::text)`, c).Scan(&prod)
			}); err != nil {
				t.Fatal(err)
			}
			if got := autz.PodeVerConta(e, c); got != prod {
				t.Errorf("%s × %s: Go %v, produção %v", x.Chave, c, got, prod)
			}
			viu, negou = viu || prod, negou || !prod
		}
	}
	if !viu || !negou {
		t.Error("o mundo não mostra os dois lados de pode_ver_conta")
	}
}
