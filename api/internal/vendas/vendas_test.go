package vendas

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
)

// eco: sonda montada só no teste. Escreve o Escopo que a cadeia (auth.Exigir → autz.ComEscopo) entregou à rota.
func eco(r chi.Router, _ *pgxpool.Pool) {
	r.Get("/eco", func(w http.ResponseWriter, r *http.Request) {
		e, a := autz.EscopoDo(r.Context()), auth.AtorDoContexto(r.Context())
		fmt.Fprintf(w, "%v|%v|%v|%v", e.Canais, e.Depositos, e.SemTrava || e.SuperFicha, a.ImpersonadorID != nil)
	})
}

func TestMundoDoComercial(t *testing.T) {
	m := novoMundo(t, eco)
	for _, c := range []struct {
		quem  string
		st    int
		corpo string
	}{
		{"", 401, ""},
		{"super", 200, "[]|[]|true|false"},
		{"semTrava", 200, "[]|[]|true|false"},
		{"admin", 200, "[]|[]|false|false"},
		{"vendT1", 200, "[1]|[]|false|false"},
		{"estT1", 200, "[1]|[11]|false|false"},
		{"gestorT2", 200, "[2]|[12]|false|false"},
		{"supervG1", 200, "[3]|[13]|false|false"}, // a supervisora do grupo G1 chega ao T3 pelo grupo
		{"viewer", 200, "[]|[]|false|false"},
		{"impersonado", 200, "[]|[]|false|true"},
	} {
		st, corpo := m.Pedir(t, c.quem, "GET", "/eco", "")
		if st != c.st || (c.st == 200 && corpo != c.corpo) {
			t.Errorf("%q: %d %q, esperava %d %q", c.quem, st, corpo, c.st, c.corpo)
		}
	}
	if v := m.Um(t, "select count(*)::text from bling_pedido_nota"); v != "4" {
		t.Errorf("notas = %s", v)
	}
	if v := m.Um(t, fotoDoComercial); v == "<nulo>" {
		t.Error("a foto do Comercial veio nula")
	}
}
