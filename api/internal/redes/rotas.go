package redes

import (
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Montar registra as rotas do 5.6 no grupo de DOMÍNIO de web.Rotas (depois de auth.Exigir e de
// autz.ComEscopo). Declaração errada derruba a subida. Rota nova entra sozinha nas varreduras.
func Montar(r chi.Router, p *pgxpool.Pool) {
	montarContas(r, p)
	montarOrganico(r, p)
	montarAnuncios(r, p)
	montarHora(r, p)
	montarEscolhas(r, p)
}
