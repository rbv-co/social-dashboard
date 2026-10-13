// Package redes: as rotas do sub-plano 5.6 — as métricas da Meta e das redes que o worker grava
// (Plano 4) e o painel lê (contas, seguidores, engajamento, conteúdo, campanhas, conjuntos, anúncios,
// insights por dia e por hora, visitas) e o que as telas gravam (metas, filtros de campanha, campos da
// conta). Regra de toda tabela = catálogo de produção (autz.Producao: a restritiva so_contas_permitidas
// em 15 das 17); escrita em banco.ComUsuario; "entrar como" só lê (Ruling 5.6-6). O cliente da Graph,
// o meta-proxy e as rotas ao vivo continuam no pacote meta (Ruling 5.6-2).
package redes

import "github.com/rbv-co/social-dashboard/api/internal/dados"

var soSessaoPropria = dados.SoSessaoPropria(dados.FraseEntrarComo)

// deve: declaração de rota errada (Consulta ou Tabela fora do catálogo) faz a API não subir.
func deve(err error) {
	if err != nil {
		panic(err)
	}
}

// Filtros comuns. TODA leitura do pacote declara o de conta e projeta account_id (Ruling 5.6-10): é o
// que a varredura de vazamento da Task 9 usa para provar que nenhuma rota entrega outra conta.
var (
	filtroConta      = dados.Filtro{Param: "account_id", SQL: "t.account_id = @account_id::uuid", Tipo: "uuid"}
	filtroContaTexto = dados.Filtro{Param: "account_id", SQL: "t.account_id = @account_id::text", Tipo: "texto"} // social_metas
	filtroPeriodo    = dados.Filtro{Param: "period_days", SQL: "t.period_days = @period_days::bigint", Tipo: "inteiro"}
)

// filtrosDeData: os recortes eq/gte/lte do PostgREST sobre uma coluna date (`<col>`, `<col>_de`,
// `<col>_ate`), com o cast ::date do PostgREST. col é constante da rota, nunca do pedido.
func filtrosDeData(col string) []dados.Filtro {
	return []dados.Filtro{
		{Param: col, SQL: "t." + col + " = @" + col + "::date", Tipo: "data"},
		{Param: col + "_de", SQL: "t." + col + " >= @" + col + "_de::date", Tipo: "data"},
		{Param: col + "_ate", SQL: "t." + col + " <= @" + col + "_ate::date", Tipo: "data"},
	}
}
