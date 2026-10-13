package rpc

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

// Função que grava recusa a sessão de "entrar como" ANTES de rodar; função que só lê continua aberta.
func TestRPCSoSessaoPropria(t *testing.T) {
	p := testebanco.Novo(t)
	ctx := context.Background()
	if _, err := p.Exec(ctx, `create table marca (quem text);
		create function marcar() returns void language sql as $$ insert into marca values (current_setting('app.usuario_id', true)) $$;
		create function ler() returns int language sql as $$ select 1 $$;`); err != nil {
		t.Fatal(err)
	}
	reg, err := Novo(p, Funcao{Nome: "marcar", Retorno: Nada, Portao: todos, SoSessaoPropria: true}, Funcao{Nome: "ler", Portao: todos})
	if err != nil {
		t.Fatal(err)
	}
	por := "11111111-0000-4000-a000-000000000009"
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			c := auth.NoContexto(req.Context(), &auth.Ator{ID: quemPede, Tipo: "painel", ImpersonadorID: &por})
			next.ServeHTTP(w, req.WithContext(autz.NoContexto(c, &autz.Escopo{ID: quemPede})))
		})
	})
	r.Post("/rpc/{nome}", reg.ServeHTTP)
	if w := chamar(r, "marcar", `{}`); w.Code != http.StatusForbidden || !strings.Contains(w.Body.String(), "Quem entrou como outra pessoa") {
		t.Fatalf("impersonado gravando = %d %s", w.Code, w.Body)
	}
	var n int
	p.QueryRow(ctx, `select count(*) from marca`).Scan(&n)
	if n != 0 {
		t.Fatalf("a função rodou para quem entrou como (%d marcas)", n)
	}
	if w := chamar(r, "ler", `{}`); w.Code != http.StatusOK {
		t.Fatalf("função que só lê = %d %s", w.Code, w.Body)
	}
}
