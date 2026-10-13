// Package paineis são as leituras dos painéis pequenos (sub-plano 5.12): notícias e status da IA.
package paineis

import (
	"fmt"
	"maps"
	"slices"

	"github.com/go-chi/chi/v5"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

// Montar registra as rotas do 5.12 no grupo de DOMÍNIO de web.Rotas (depois de autz.ComEscopo).
// Consulta que não valida contra o catálogo = erro (a API não sobe).
func Montar(r chi.Router, b dados.Consultor, cat *autz.Catalogo) error {
	for _, caminho := range slices.Sorted(maps.Keys(leituras)) {
		c := leituras[caminho]
		if err := c.Validar(cat); err != nil {
			return fmt.Errorf("paineis %s: %w", caminho, err)
		}
		r.Get(caminho, c.Handler(b, cat))
	}
	for _, t := range tabelasDaSaude { // tabela fora do catálogo: a API não sobe
		if _, err := cat.Filtro(&autz.Escopo{}, t, autz.Ler, "x"); err != nil {
			return fmt.Errorf("paineis saúde dos robôs: %w", err)
		}
	}
	r.Get("/status-ia/saude-dos-robos", SaudeDosRobos(b, cat))
	return nil
}
