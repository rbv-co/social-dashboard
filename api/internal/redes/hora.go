package redes

import (
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

// Por hora (Relatório por hora): campaign_insights_hora, ad_insights_hora e perfil_visitas_hora. A regra
// vem do catálogo: permissiva "papel admin, super pela FICHA ou meta.hora" E a restritiva por conta.
var filtroDiaDe = dados.Filtro{Param: "dia_de", SQL: "t.dia >= @dia_de::date", Tipo: "data"}

var consultaCampanhasPorHora = dados.Consulta{Tabela: "campaign_insights_hora", Alias: "t",
	SQL: `select t.campaign_id, t.account_id, t.dia, t.hora, t.gasto_acumulado, t.gasto_hora, t.conversas_acumuladas,
	  t.conversas_hora, t.cliques_acumulados, t.cliques_hora from campaign_insights_hora t`,
	Filtros: []dados.Filtro{filtroConta, filtroDiaDe}, OrdemPadrao: "t.dia desc, t.hora, t.account_id", Desempate: "t.campaign_id"}

var consultaAnunciosPorHora = dados.Consulta{Tabela: "ad_insights_hora", Alias: "t",
	SQL: `select t.ad_id, t.campaign_id, t.account_id, t.dia, t.hora, t.gasto_acumulado, t.gasto_hora,
	  t.cliques_acumulados, t.cliques_hora from ad_insights_hora t`,
	Filtros: []dados.Filtro{filtroConta, filtroDiaDe}, OrdemPadrao: "t.dia desc, t.hora, t.account_id", Desempate: "t.ad_id"}

var consultaVisitasPorHora = dados.Consulta{Tabela: "perfil_visitas_hora", Alias: "t",
	SQL:     `select t.account_id, t.dia, t.hora, t.visitas_acumuladas, t.visitas_hora from perfil_visitas_hora t`,
	Filtros: []dados.Filtro{filtroConta, filtroDiaDe}, OrdemPadrao: "t.dia desc, t.hora", Desempate: "t.account_id"}

func montarHora(r chi.Router, p *pgxpool.Pool) {
	r.Get("/redes/campanhas-por-hora", consultaCampanhasPorHora.Handler(p, autz.Producao))
	r.Get("/redes/anuncios-por-hora", consultaAnunciosPorHora.Handler(p, autz.Producao))
	r.Get("/redes/visitas-por-hora", consultaVisitasPorHora.Handler(p, autz.Producao))
}
