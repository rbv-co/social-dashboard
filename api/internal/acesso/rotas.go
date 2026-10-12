package acesso

import (
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Montar registra as rotas do 5.1 no grupo de DOMÍNIO de web.Rotas (depois de auth.Exigir e de
// autz.ComEscopo). Declaração errada derruba a subida (deve). A única rota pública, POST /pedir-acesso,
// é de MontarPublicas e fica FORA do grupo autenticado.
func Montar(r chi.Router, p *pgxpool.Pool) {
	montarUsuarios(r, p)
	montarPerfis(r, p)
	montarPedidos(r, p)
	montarTimes(r, p)
	montarGrupos(r, p)
	montarAvisos(r, p)
	montarSaude(r, p)
}
