package acessos

import (
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Montar registra as rotas do 5.4 no grupo de DOMÍNIO de web.Rotas (depois de auth.Exigir e de
// autz.ComEscopo). Declaração errada derruba a subida (deve). O Plano 6 acrescenta aqui o proxy do
// Zoho/Microsoft e as rotas de arquivo; as varreduras de rotas_test.go passam a cobri-los.
func Montar(r chi.Router, p *pgxpool.Pool) {
	montarPessoas(r, p)
	montarAcoesDaPessoa(r, p)
	montarEstrutura(r, p)
	montarPastas(r, p)
}
