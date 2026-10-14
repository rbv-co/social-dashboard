package vendas

import (
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Montar registra as rotas do 5.5 no grupo de DOMÍNIO de web.Rotas (depois de auth.Exigir e de
// autz.ComEscopo). Declaração errada derruba a subida (deve / Consulta.Handler).
func Montar(r chi.Router, p *pgxpool.Pool) {
	montarLeituras(r, p)
	montarGlobais(r, p)
	montarLojas(r, p)
	montarMetas(r, p)
	montarCaches(r, p)
}
