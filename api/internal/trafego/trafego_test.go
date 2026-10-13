package trafego

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
)

// eco: sonda montada só no teste. Escreve o que a cadeia (auth.Exigir → autz.ComEscopo) entregou.
func eco(r chi.Router, _ *pgxpool.Pool) {
	r.Get("/eco", func(w http.ResponseWriter, r *http.Request) {
		e, a := autz.EscopoDo(r.Context()), auth.AtorDoContexto(r.Context())
		fmt.Fprintf(w, "%t|%t|%s|%t", autz.PodeVerConta(e, A2), e.Modulo("meta.gestor"), e.Papel, a.ImpersonadorID != nil)
	})
}

func TestMundoDoTrafego(t *testing.T) {
	m := novoMundo(t, eco)
	for _, c := range []struct {
		quem  string
		st    int
		corpo string
	}{
		{"", 401, ""},
		{"gestorTodas", 200, "true|true|viewer|false"},
		{"gestorA1", 200, "false|true|viewer|false"},
		{"gestorNenhuma", 200, "false|true|viewer|false"},
		{"adminA1", 200, "true|false|admin|false"},
		{"superA1", 200, "true|false|viewer|false"},
		{"leitor", 200, "true|false|viewer|false"},
		{"impersonado", 200, "false|true|viewer|true"},
		{"desativado", 401, ""},
	} {
		st, corpo := m.Pedir(t, c.quem, "GET", "/eco", "")
		if st != c.st || (c.st == 200 && corpo != c.corpo) {
			t.Errorf("%q: %d %q, esperava %d %q", c.quem, st, corpo, c.st, c.corpo)
		}
	}
	if n := m.Um(t, `select count(*)::text from gt_fila_decisoes`); n != "3" {
		t.Errorf("gt_fila_decisoes: %s linhas, esperava 3", n)
	}
	if f := m.Um(t, fotoDoTrafego); f == "<nulo>" || f == "" {
		t.Errorf("a foto do tráfego veio vazia: %q", f)
	}
}

func TestAjudantesDeValidacao(t *testing.T) {
	raw := func(s string) json.RawMessage { return json.RawMessage(s) }
	for _, s := range []string{`null`, `5`, `{}`} {
		if _, ok := texto(raw(s)); ok {
			t.Errorf("texto(%s) aceitou", s)
		}
	}
	for _, c := range []struct {
		nome string
		got  bool
		quer bool
	}{
		{"só espaço, vazio não pode", textoAte(raw(`"  "`), 10, false), false},
		{"só espaço, vazio pode", textoAte(raw(`"  "`), 10, true), true},
		{"conta caracteres e não bytes", textoAte(raw(`"ção"`), 3, false), true},
		{"passa do limite", textoAte(raw(`"ções"`), 3, false), false},
		{"objeto {}", objeto(raw(`{}`)), true},
		{"objeto []", objeto(raw(`[]`)), false},
		{"objeto null", objeto(raw(`null`)), false},
		{"inteiro fracionário", inteiroEntre(raw(`1.5`), 0, 9), false},
		{"inteiro dentro", inteiroEntre(raw(`9`), 0, 9), true},
		{"inteiro fora", inteiroEntre(raw(`10`), 0, 9), false},
		{"id da Meta", casa(raw(`"9001"`), reIDDaMeta), true},
		{"id da Meta com letra", casa(raw(`"90a"`), reIDDaMeta), false},
		{"textoEm", textoEm(raw(`"a"`), "a", "b"), true},
		{"textoEm fora", textoEm(raw(`"c"`), "a", "b"), false},
		{"nulo", nulo(raw(` null `)), true},
	} {
		if c.got != c.quer {
			t.Errorf("%s: %v, esperava %v", c.nome, c.got, c.quer)
		}
	}
}
