package paineis

import "github.com/rbv-co/social-dashboard/api/internal/dados"

// leituras: as Consultas do 5.12. A regra de Ler do catálogo entra sozinha no WHERE; filtros e ordens
// só destas listas (o pedido nunca escolhe tabela, coluna nem trecho de SQL).
// Desempate é obrigatório em dados.Consulta; onde a linha não tem id (distinct, chave primária da
// própria ordem) ele repete a chave da ordem.
var leituras = map[string]dados.Consulta{
	// tela-de-noticias.vue:108-109: as edições mais recentes (a tela pede ?limite=6).
	"/noticias/rodadas": {Tabela: "noticias_concorrentes", Alias: "n",
		SQL: `select distinct n.rodada from noticias_concorrentes n`, OrdemPadrao: "n.rodada desc", Desempate: "n.rodada"},
	// tela-de-noticias.vue:110-112: as notícias dessas edições; sem filtro = todas (até 1000).
	"/noticias/concorrentes": {Tabela: "noticias_concorrentes", Alias: "n",
		SQL:         `select n.* from noticias_concorrentes n`,
		Filtros:     []dados.Filtro{{Param: "rodada", SQL: "n.rodada = any(@rodada::date[])", Tipo: "data[]"}},
		OrdemPadrao: "n.rodada desc, n.destaque desc, n.created_at desc", Desempate: "n.id"},
	// tela-de-noticias.vue:119: o panorama, só as 4 colunas que a tela pede.
	"/noticias/panorama": {Tabela: "noticias_panorama", Alias: "p",
		SQL: `select p.rodada, p.conteudo_md, p.modelo, p.created_at from noticias_panorama p`, OrdemPadrao: "p.rodada desc", Desempate: "p.rodada"},
	// tela-de-status-claude.vue:703: o diário das execuções de IA.
	"/status-ia/execucoes": {Tabela: "ia_execucoes", Alias: "x",
		SQL: `select x.* from ia_execucoes x`, OrdemPadrao: "x.run_at desc", Desempate: "x.id"},
}
