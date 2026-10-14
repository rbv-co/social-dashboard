package patrimonio

import (
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Montar registra as rotas do 5.2 no grupo de DOMÍNIO de web.Rotas (depois de auth.Exigir e de
// autz.ComEscopo). As RPCs entram pela lista branca (FuncoesRPC → web.FuncoesRPC), não por aqui.
func Montar(r chi.Router, p *pgxpool.Pool) {
	montarBens(r, p)
	montarPosses(r, p)
	montarMassa(r, p)
	montarCadastros(r, p)
	montarConfig(r, p)
}
