package redes

import (
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

// GET /redes/campanhas (campaigns): Redes (2121 ?account_id=; 3785 ?account_id= na ordem padrão status,
// nome; 3898), OPR (305) e Por hora (315) sem filtro. A campanha sem conta é visível a todos (pode_ver_conta(null)).
var consultaCampanhas = dados.Consulta{Tabela: "campaigns", Alias: "t",
	SQL:         `select t.campaign_id, t.account_id, t.name, t.objective, t.status, t.synced_at from campaigns t`,
	Filtros:     []dados.Filtro{filtroConta},
	OrdemPadrao: "t.status, t.name", Desempate: "t.campaign_id"}

// GET /redes/conjuntos (campaign_adsets): Redes (2122 ?account_id=).
var consultaConjuntos = dados.Consulta{Tabela: "campaign_adsets", Alias: "t",
	SQL:         `select t.adset_id, t.campaign_id, t.account_id, t.destination_type, t.optimization_goal, t.synced_at from campaign_adsets t`,
	Filtros:     []dados.Filtro{filtroConta},
	OrdemPadrao: "t.campaign_id", Desempate: "t.adset_id"}

// GET /redes/anuncios (ads): Por hora (318 ?account_id=).
var consultaAnuncios = dados.Consulta{Tabela: "ads", Alias: "t",
	SQL:         `select t.ad_id, t.campaign_id, t.account_id, t.name, t.status, t.destino_link, t.synced_at from ads t`,
	Filtros:     []dados.Filtro{filtroConta},
	OrdemPadrao: "t.name", Desempate: "t.ad_id"}

// GET /redes/insights-de-campanha (campaign_insights): Redes (2280 ?account_id=&period_days=0&captured_at_de=
// &captured_at_ate=&ordem=captured_at; 2458/2459 …&campaign_id=a,b&ordem=captured_at.desc), Relatório (154),
// Gestor (1024 ?captured_at_de= de todas as contas), OPR (306). Ordem padrão: mais nova primeiro (o corte
// do teto, se houver, leva as mais antigas: Ruling 5.6-11).
var consultaInsightsDeCampanha = dados.Consulta{Tabela: "campaign_insights", Alias: "t",
	SQL: `select t.campaign_id, t.account_id, t.captured_at, t.period_days, t.spend, t.impressions, t.clicks, t.reach,
	  t.post_engagement, t.likes, t.comments, t.shares, t.saves, t.conversas, t.cadastros, t.compras, t.visitas
	  from campaign_insights t`,
	Filtros: append([]dados.Filtro{filtroConta, filtroPeriodo,
		{Param: "campaign_id", SQL: "t.campaign_id = any(@campaign_id::text[])", Tipo: "texto[]"}},
		filtrosDeData("captured_at")...),
	Ordens:      map[string]string{"captured_at": "t.captured_at"},
	OrdemPadrao: "t.captured_at desc, t.account_id, t.period_days", Desempate: "t.campaign_id"}

// GET /redes/insights-da-conta (account_insights): Redes (2518 ?account_id=&period_days=&captured_at_ate=
// &ordem=captured_at.desc&limite=1).
var consultaInsightsDaConta = dados.Consulta{Tabela: "account_insights", Alias: "t",
	SQL: `select t.account_id, t.captured_at, t.period_days, t.spend, t.impressions, t.clicks, t.reach, t.frequency
	  from account_insights t`,
	Filtros:     append([]dados.Filtro{filtroConta, filtroPeriodo}, filtrosDeData("captured_at")...),
	Ordens:      map[string]string{"captured_at": "t.captured_at"},
	OrdemPadrao: "t.captured_at desc, t.account_id", Desempate: "t.period_days"}

func montarAnuncios(r chi.Router, p *pgxpool.Pool) {
	for rota, c := range map[string]dados.Consulta{
		"/redes/campanhas":            consultaCampanhas,
		"/redes/conjuntos":            consultaConjuntos,
		"/redes/anuncios":             consultaAnuncios,
		"/redes/insights-de-campanha": consultaInsightsDeCampanha,
		"/redes/insights-da-conta":    consultaInsightsDaConta,
	} {
		deve(c.Validar(autz.Producao))
		r.Get(rota, c.Handler(p, autz.Producao))
	}
}
