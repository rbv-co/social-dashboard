package frota

import (
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Montar registra as rotas do 5.3 no grupo de DOMÍNIO de web.Rotas (depois de auth.Exigir e de
// autz.ComEscopo). Declaração errada derruba a subida (deve). POST /avisar-decisao-de-reserva (Plano 4)
// é montado à parte, no grupo autenticado, com o portão da edge.
func Montar(r chi.Router, p *pgxpool.Pool) {
	montarVeiculos(r, p)
	montarUsos(r, p)
	montarRequisicoes(r, p)
	montarChecklists(r, p)
	montarConfiguracao(r, p)
	montarManutencoes(r, p)
}
