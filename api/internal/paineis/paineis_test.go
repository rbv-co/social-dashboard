package paineis

import (
	"net/http"
	"slices"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
)

// As cinco leituras do 5.12 validam contra o catálogo de produção (sem banco: b == nil só
// valida e registra) e são exatamente estas rotas GET.
func TestLeiturasValidamContraOCatalogo(t *testing.T) {
	r := chi.NewRouter()
	if err := Montar(r, nil, autz.Producao); err != nil {
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
