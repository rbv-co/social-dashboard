package vendas

import (
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

// GET /comercial/depositos (bling_depositos_read: true). tela-de-gestao-a-vista.vue:704.
var consultaDepositos = dados.Consulta{Tabela: "bling_depositos", Alias: "t",
	SQL:    `select t.deposito_id, t.nome, t.ativo, t.padrao from bling_depositos t`,
	Ordens: map[string]string{"nome": "t.nome"}, OrdemPadrao: "t.deposito_id", Desempate: "t.deposito_id"}

// GET /comercial/briefings (gcb_select: true). tela-de-gestao-comercial.vue:277 (?ordem=created_at.desc&limite=20).
var consultaBriefings = dados.Consulta{Tabela: "gestao_comercial_briefings", Alias: "t",
	SQL:    `select t.id, t.rodada, t.periodo, t.resumo, t.conteudo, t.dados_json, t.created_at from gestao_comercial_briefings t`,
	Ordens: map[string]string{"created_at": "t.created_at", "rodada": "t.rodada"}, OrdemPadrao: "t.created_at desc", Desempate: "t.id"}

func montarGlobais(r chi.Router, p *pgxpool.Pool) {
	r.Get("/comercial/depositos", consultaDepositos.Handler(p, autz.Producao))
	r.Get("/comercial/briefings", consultaBriefings.Handler(p, autz.Producao))
}
