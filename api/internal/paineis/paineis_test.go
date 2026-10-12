package paineis

import (
	"context"
	"net/http"
	"slices"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

// semBanco é um Consultor falso que só responde a conferência do ambiente que a montagem de cada
// rota faz (PG 17, as tabelas do 5.12 existem); consulta de dados não é feita nestes testes.
type semBanco struct{}

func (semBanco) QueryRow(context.Context, string, ...any) pgx.Row { return ambienteFalso{} }

type ambienteFalso struct{}

func (ambienteFalso) Scan(dest ...any) error {
	*dest[0].(*string), *dest[1].(*int), *dest[2].(*string) = "on", 170000, "public"
	*dest[3].(*[]string) = []string{"noticias_concorrentes", "noticias_panorama", "ia_execucoes", "robos_esperados", "robos_execucoes", "robos_saude"}
	return nil
}

var _ dados.Consultor = semBanco{}

// Declaração que não valida contra o catálogo: Montar devolve erro (a API não sobe) e diz qual rota.
func TestMontarRecusaDeclaracaoInvalida(t *testing.T) {
	leituras["/invalida"] = dados.Consulta{Tabela: "tabela_fora_do_catalogo", Alias: "x", SQL: `select x.* from tabela_fora_do_catalogo x`,
		OrdemPadrao: "x.id", Desempate: "x.id"}
	t.Cleanup(func() { delete(leituras, "/invalida") })
	if err := Montar(chi.NewRouter(), semBanco{}, autz.Producao); err == nil || !strings.Contains(err.Error(), "paineis /invalida") {
		t.Fatalf("Montar com declaração inválida = %v, esperava erro citando /invalida", err)
	}
}

// As cinco leituras do 5.12 validam contra o catálogo de produção e são exatamente estas rotas GET.
func TestLeiturasValidamContraOCatalogo(t *testing.T) {
	r := chi.NewRouter()
	if err := Montar(r, semBanco{}, autz.Producao); err != nil {
		t.Fatal(err)
	}
	var vistas []string
	chi.Walk(r, func(metodo, rota string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		vistas = append(vistas, metodo+" "+rota)
		return nil
	})
	slices.Sort(vistas)
	quer := []string{"GET /noticias/concorrentes", "GET /noticias/panorama", "GET /noticias/rodadas", "GET /status-ia/execucoes", "GET /status-ia/saude-dos-robos"}
	if !slices.Equal(vistas, quer) {
		t.Fatalf("rotas = %v, esperava %v", vistas, quer)
	}
}
