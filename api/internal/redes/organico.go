package redes

import (
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

// Leituras do orgânico: a regra é auth_read_* + a restritiva pode_ver_conta de cada tabela
// (autz.Producao); as telas pedem sempre por conta e data.

// GET /redes/seguidores (daily_snapshots): Admin (1778 ?captured_at=hoje; 4029 ?contar=1&limite=1;
// 4033 ?account_id=&ordem=captured_at.desc&limite=1), Redes (2106 ?account_id=&captured_at_de=&captured_at_ate=
// &ordem=captured_at; 2116; 3557 …&limite=100), Relatório (157, 163).
var consultaSeguidores = dados.Consulta{Tabela: "daily_snapshots", Alias: "t",
	SQL:     `select t.account_id, t.captured_at, t.followers_count, t.gained, t.lost from daily_snapshots t`,
	Filtros: append([]dados.Filtro{filtroConta}, filtrosDeData("captured_at")...),
	Ordens:  map[string]string{"captured_at": "t.captured_at"}, OrdemPadrao: "t.captured_at", Desempate: "t.account_id"}

// GET /redes/leituras-de-seguidores (followers_leituras): Gestor (746), OPR (307), Por hora (316), todos
// com ?account_id=&lido_em_de=<instante>&ordem=lido_em.
var consultaLeituras = dados.Consulta{Tabela: "followers_leituras", Alias: "t",
	SQL: `select t.id, t.account_id, t.followers_count, t.lido_em, t.origem from followers_leituras t`,
	Filtros: []dados.Filtro{filtroConta,
		{Param: "lido_em_de", SQL: "t.lido_em >= @lido_em_de::timestamptz", Tipo: "instante"}},
	Ordens: map[string]string{"lido_em": "t.lido_em"}, OrdemPadrao: "t.lido_em", Desempate: "t.id"}

// GET /redes/engajamento (engagement_snapshots): Admin (1777 ?captured_at=hoje; 4030 contagem), Redes
// (2107, 2108 ?account_id=&period_days=&captured_at_ate=&ordem=captured_at.desc&limite=1), Relatório (158).
var consultaEngajamento = dados.Consulta{Tabela: "engagement_snapshots", Alias: "t",
	SQL: `select t.account_id, t.captured_at, t.period_days, t.likes, t.comments, t.saves, t.shares, t.reach,
	  t.views, t.total_interactions, t.accounts_engaged, t.profile_views, t.created_at from engagement_snapshots t`,
	Filtros: append([]dados.Filtro{filtroConta, filtroPeriodo}, filtrosDeData("captured_at")...),
	Ordens:  map[string]string{"captured_at": "t.captured_at"}, OrdemPadrao: "t.captured_at, t.account_id", Desempate: "t.period_days"}

// GET /redes/conteudo (content_snapshots): Admin (4031 contagem), Redes (2109, 2110, 2112, 2113;
// 3323 ?captured_at=hoje&period_days_ate=1&ordem=period_days), Relatório (159).
var consultaConteudo = dados.Consulta{Tabela: "content_snapshots", Alias: "t",
	SQL: `select t.account_id, t.captured_at, t.period_days, t.posts_count, t.reels_count, t.stories_count,
	  t.story_shares, t.story_replies, t.story_reach, t.story_interactions, t.story_navigation, t.story_nav_forward,
	  t.story_nav_back, t.story_nav_exit, t.story_nav_next, t.story_profile_visits, t.story_follows from content_snapshots t`,
	Filtros: append([]dados.Filtro{filtroConta, filtroPeriodo,
		{Param: "period_days_ate", SQL: "t.period_days <= @period_days_ate::bigint", Tipo: "inteiro"}},
		filtrosDeData("captured_at")...),
	Ordens:      map[string]string{"captured_at": "t.captured_at", "period_days": "t.period_days"},
	OrdemPadrao: "t.captured_at, t.account_id", Desempate: "t.period_days"}

// GET /redes/chatwoot-eventos (chatwoot_eventos): relatório OPR (tela-de-relatorio-opr.vue:310), ?dia_br_de=&dia_br_ate=
// (ACHADO 02-2). A regra é chatwoot_eventos_leitura (admin, superadmin ou a permissão meta.opr); só o webhook grava.
var consultaChatwootEventos = dados.Consulta{Tabela: "chatwoot_eventos", Alias: "t",
	SQL: `select t.id, t.tipo, t.dia_br from chatwoot_eventos t`,
	Filtros: []dados.Filtro{
		{Param: "dia_br_de", SQL: "t.dia_br >= @dia_br_de::date", Tipo: "data"},
		{Param: "dia_br_ate", SQL: "t.dia_br <= @dia_br_ate::date", Tipo: "data"}},
	Ordens: map[string]string{"dia_br": "t.dia_br"}, OrdemPadrao: "t.dia_br", Desempate: "t.id"}

func montarOrganico(r chi.Router, p *pgxpool.Pool) {
	r.Get("/redes/seguidores", consultaSeguidores.Handler(p, autz.Producao))
	r.Get("/redes/leituras-de-seguidores", consultaLeituras.Handler(p, autz.Producao))
	r.Get("/redes/chatwoot-eventos", consultaChatwootEventos.Handler(p, autz.Producao))
	r.Get("/redes/engajamento", consultaEngajamento.Handler(p, autz.Producao))
	r.Get("/redes/conteudo", consultaConteudo.Handler(p, autz.Producao))
}
