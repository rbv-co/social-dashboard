// Package paineis são as leituras dos painéis pequenos (sub-plano 5.12): notícias e status da IA.
package paineis

import (
	"fmt"
	"maps"
	"net/http"
	"slices"

	"github.com/go-chi/chi/v5"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

// Montar registra as rotas do 5.12 no grupo de DOMÍNIO de web.Rotas (depois de autz.ComEscopo).
// Consulta que não valida contra o catálogo = erro (a API não sobe). Com b == nil só valida e
// registra um handler que responde 503 (teste sem banco).
func Montar(r chi.Router, b dados.Consultor, cat *autz.Catalogo) error {
	for _, caminho := range slices.Sorted(maps.Keys(leituras)) {
		c := leituras[caminho]
		if err := c.Validar(cat); err != nil {
			return fmt.Errorf("paineis %s: %w", caminho, err)
		}
		if b == nil {
			r.Get(caminho, func(w http.ResponseWriter, _ *http.Request) {
				dados.Erro(w, http.StatusServiceUnavailable, "sem_banco", "")
			})
			continue
		}
		r.Get(caminho, c.Handler(b, cat))
	}
	return nil
}
