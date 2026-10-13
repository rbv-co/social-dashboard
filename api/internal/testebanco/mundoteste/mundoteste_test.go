package mundoteste

import (
	"net/http"
	"strconv"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
)

// "a" é super: Buscar só aceita sessão de "entrar como" cujo impersonador seja super-admin ativo.
func TestMundoTeste(t *testing.T) {
	const idA = "11111111-0000-4000-a000-000000000001"
	const idB = "11111111-0000-4000-a000-000000000002"
	m := Novo(t, Opcoes{
		Pessoas: []Pessoa{
			{Chave: "a", ID: idA, Email: "a@x.com", Papel: "admin", Super: true, Modulos: []string{"frota"}},
			{Chave: "b", ID: idB, Email: "b@x.com", Papel: "viewer"},
		},
		Impersonadas: map[string][2]string{"imp": {idB, idA}},
		Linhas:       "create table eco_teste (x int); insert into eco_teste values (1)",
	}, func(r chi.Router, _ *pgxpool.Pool) {
		r.Get("/eco", func(w http.ResponseWriter, r *http.Request) {
			e, a := autz.EscopoDo(r.Context()), auth.AtorDoContexto(r.Context())
			_, _ = w.Write([]byte(strings.Join(e.Modulos, ",") + "|" + strconv.FormatBool(a.ImpersonadorID != nil)))
		})
	})
	m.Rodar(t, []Caso{
		{Nome: "sem sessão", Quem: "", Metodo: "GET", Caminho: "/eco", Status: http.StatusUnauthorized},
		{Nome: "sessão própria chega com o escopo", Quem: "a", Metodo: "GET", Caminho: "/eco", Status: http.StatusOK, Tem: "frota|false"},
		{Nome: "impersonada chega com o impersonador", Quem: "imp", Metodo: "GET", Caminho: "/eco", Status: http.StatusOK, Tem: "|true", NaoTem: "frota"},
		{Nome: "linhas rodaram", Efeito: "select count(*)::text from eco_teste", Quer: "1"},
	})
	if got := m.Um(t, "select count(*)::text from eco_teste"); got != "1" {
		t.Errorf("Um = %q", got)
	}
}
