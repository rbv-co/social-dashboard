package trafego

import (
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

// GET /gestao-trafego/interesses-sugeridos: o que o robô sugerir-interesses gravou por marca × objetivo.
// A conta sai da marca, e só para quem lê a marca (fabrica_marcas tem a restritiva pode_ver_conta).
var consultaInteresses = dados.Consulta{Tabela: "interesses_sugeridos", Alias: "t",
	SQL: `select t.id, t.marca_id, m.account_id, t.objetivo, t.itens, t.propostos, t.validos, t.gerado_em
	  from interesses_sugeridos t left join fabrica_marcas m on m.id = t.marca_id and {ler:fabrica_marcas:m}`,
	Filtros: []dados.Filtro{
		{Param: "account_id", SQL: "m.account_id = @account_id::text", Tipo: "texto"},
		{Param: "marca_id", SQL: "t.marca_id = @marca_id::uuid", Tipo: "uuid"},
		{Param: "objetivo", SQL: "t.objetivo = @objetivo::text", Tipo: "texto"}},
	OrdemPadrao: "t.objetivo", Desempate: "t.id"}

func montarInteresses(r chi.Router, p *pgxpool.Pool) {
	r.Get("/gestao-trafego/interesses-sugeridos", consultaInteresses.Handler(p, autz.Producao))
}
