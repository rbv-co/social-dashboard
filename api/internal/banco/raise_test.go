package banco

import (
	"errors"
	"fmt"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

// A regra única de "isto é um RAISE escrito por nós" (dados.ErroDoBanco e auth.InviteUser a
// usam): P0001 sempre; 42501/22023/P0002/23514 só se a PRIMEIRA linha do Where termina em
// " at RAISE"; erro nativo e `raise;` que re-lança 23505 não.
func TestRaiseNossoETabelaDeEntradas(t *testing.T) {
	casos := []struct {
		nome  string
		pe    pgconn.PgError
		quer  bool
		frase string
	}{
		{"P0001 sem Where", pgconn.PgError{Code: "P0001", Message: "frase p1"}, true, "frase p1"},
		{"P0001 num Where qualquer", pgconn.PgError{Code: "P0001", Message: "frase p2", Where: "PL/pgSQL function f() line 3 at RETURN"}, true, "frase p2"},
		{"42501 de RAISE", pgconn.PgError{Code: "42501", Message: "sem permissao", Where: "PL/pgSQL function f() line 4 at RAISE"}, true, "sem permissao"},
		{"22023 de RAISE aninhado", pgconn.PgError{Code: "22023", Message: "Digite o nome.", Where: "PL/pgSQL function g() line 9 at RAISE\nSQL statement \"select g()\"\nPL/pgSQL function f() line 2 at PERFORM"}, true, "Digite o nome."},
		{"P0002 de RAISE", pgconn.PgError{Code: "P0002", Message: "edicao nao encontrada", Where: "PL/pgSQL function f() line 7 at RAISE"}, true, "edicao nao encontrada"},
		{"23514 de RAISE", pgconn.PgError{Code: "23514", Message: "regra", Where: "PL/pgSQL function f() line 1 at RAISE"}, true, "regra"},
		{"42501 nativo (permission denied)", pgconn.PgError{Code: "42501", Message: "permission denied for table segredos"}, false, ""},
		{"42501 nativo dentro de função", pgconn.PgError{Code: "42501", Message: "permission denied for table x", Where: "PL/pgSQL function f() line 3 at SQL statement"}, false, ""},
		{"22023 nativo", pgconn.PgError{Code: "22023", Message: `unit "xx" not recognized`, Where: "PL/pgSQL function f() line 3 at RETURN"}, false, ""},
		{"RAISE só na 2ª linha do Where", pgconn.PgError{Code: "42501", Message: "nativo", Where: "SQL expression \"x\"\nPL/pgSQL function f() line 3 at RAISE"}, false, ""},
		{"23505 re-lançado por raise;", pgconn.PgError{Code: "23505", Message: `duplicate key value violates unique constraint "k"`, Where: "PL/pgSQL function f() line 3 at RAISE"}, false, ""},
		{"23503 de RAISE", pgconn.PgError{Code: "23503", Message: "x", Where: "PL/pgSQL function f() line 3 at RAISE"}, false, ""},
	}
	for _, c := range casos {
		pe := c.pe
		if got := RaiseNosso(&pe); got != c.quer {
			t.Errorf("%s: RaiseNosso = %v, esperava %v", c.nome, got, c.quer)
		}
		frase, ok := FraseDoRaise(fmt.Errorf("embrulhado: %w", &pe))
		if ok != c.quer || frase != c.frase {
			t.Errorf("%s: FraseDoRaise = %q %v, esperava %q %v", c.nome, frase, ok, c.frase, c.quer)
		}
	}
	if frase, ok := FraseDoRaise(errors.New("erro qualquer")); ok || frase != "" {
		t.Errorf("erro que não é do banco: %q %v", frase, ok)
	}
	if _, ok := FraseDoRaise(nil); ok {
		t.Error("nil é RAISE?")
	}
}
