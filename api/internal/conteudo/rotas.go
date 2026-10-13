package conteudo

import (
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Montar registra as rotas do 5.9 no grupo de DOMÍNIO de web.Rotas (depois de auth.Exigir e de
// autz.ComEscopo): 7 leituras, 13 escritas de catálogo e POST /conteudo-trigger. As 6 RPCs entram por
// FuncoesRPC. Declaração errada derruba a subida. Rota nova entra sozinha nas varreduras de rotas_test.go.
func Montar(r chi.Router, p *pgxpool.Pool) {
	montarLeituras(r, p)
	montarPecas(r, p)
	montarPauta(r, p)
	montarGatilho(r, p)
}
