package trafego

import (
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Montar registra as rotas de tabela do 5.7 no grupo de DOMÍNIO de web.Rotas (depois de auth.Exigir e de
// autz.ComEscopo). A RPC entra por FuncoesRPC; os proxies de IA e de mapa, por internal/ia e internal/mapa.
// Declaração errada derruba a subida. Rota nova entra sozinha nas varreduras.
func Montar(r chi.Router, p *pgxpool.Pool) {
	montarFila(r, p)
	montarRascunhos(r, p)
	montarEscolhas(r, p)
	montarRegua(r, p)
	montarInteresses(r, p)
}
