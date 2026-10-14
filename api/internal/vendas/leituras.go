package vendas

import (
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

// leiturasComEscopo: as 7 tabelas com restritiva de produção (pode_ver_canal ×6, pode_ver_estoque ×1).
// Colunas = as que as telas leem (Ruling 5.5-7: nos pedidos da Shopify, nada de cliente nem payload).
var leiturasComEscopo = map[string]dados.Consulta{
	// data-da-venda.js:28. janela = daterange do Postgres ("[AAAA-MM-DD,AAAA-MM-DD]"): o
	// .or(and(data_da_venda…),and(data_pedido…)) da tela (Ruling 5.5-11). Restritiva: bpn_so_do_meu_canal.
	"/comercial/notas": {Tabela: "bling_pedido_nota", Alias: "t",
		SQL: `select t.pedido_id, t.pedido_numero, t.data_pedido, t.data_da_venda, t.total, t.loja_id, t.nota_situacao from bling_pedido_nota t`,
		Filtros: []dados.Filtro{{Param: "janela", Tipo: "texto",
			SQL: "(t.data_da_venda >= lower(@janela::text::daterange) and t.data_da_venda < upper(@janela::text::daterange)) or " +
				"(t.data_pedido >= lower(@janela::text::daterange) and t.data_pedido < upper(@janela::text::daterange))"}},
		OrdemPadrao: "t.pedido_id", Desempate: "t.pedido_id"},
	// valor-corrigido.js:30. Restritiva: bpav_so_do_meu_canal. motivo/criado_por: nenhuma tela lê.
	"/comercial/ajustes-de-valor": {Tabela: "bling_pedido_ajuste_valor", Alias: "t",
		SQL:         `select t.pedido_id, t.total_corrigido from bling_pedido_ajuste_valor t`,
		OrdemPadrao: "t.pedido_id", Desempate: "t.pedido_id"},
	// vendedor-corrigido.js:23. Restritiva: bpaven_so_do_meu_canal.
	"/comercial/ajustes-de-vendedor": {Tabela: "bling_pedido_ajuste_vendedor", Alias: "t",
		SQL:         `select t.pedido_id, t.vendor_id_corrigido from bling_pedido_ajuste_vendedor t`,
		OrdemPadrao: "t.pedido_id", Desempate: "t.pedido_id"},
	// valor-liquido-de-troca.js:26 (?eh_devolucao=true). Restritiva: bpfp_so_do_meu_canal.
	"/comercial/formas-de-pagamento": {Tabela: "bling_pedido_forma_pagamento", Alias: "t",
		SQL:         `select t.pedido_id, t.valor from bling_pedido_forma_pagamento t`,
		Filtros:     []dados.Filtro{{Param: "eh_devolucao", SQL: "t.eh_devolucao = @eh_devolucao::boolean", Tipo: "booleano"}},
		OrdemPadrao: "t.pedido_id", Desempate: "t.parcela_id"},
	// tela-de-gestao-a-vista.vue:970 (?deposito_id=), relatorios-comerciais.vue:414. Restritiva: gc_ei_so_do_meu_time (pode_ver_estoque).
	"/comercial/estoque": {Tabela: "gc_estoque_item", Alias: "t",
		SQL:         `select t.deposito_id, t.sku, t.produto, t.categoria, t.saldo from gc_estoque_item t`,
		Filtros:     []dados.Filtro{{Param: "deposito_id", SQL: "t.deposito_id = any(@deposito_id::bigint[])", Tipo: "inteiro[]"}},
		OrdemPadrao: "t.deposito_id", Desempate: "(t.deposito_id, t.sku)"},
	// relatorios-comerciais.vue:402 (?mes=), :426. Restritiva: gc_vi_so_do_meu_time (pode_ver_canal(canal_loja_id)).
	"/comercial/vendas-por-item": {Tabela: "gc_vendas_item", Alias: "t",
		SQL:         `select t.mes, t.canal_loja_id, t.sku, t.produto, t.categoria, t.unidades, t.faturamento from gc_vendas_item t`,
		Filtros:     []dados.Filtro{{Param: "mes", SQL: "t.mes = any(@mes::date[])", Tipo: "data[]"}},
		OrdemPadrao: "t.mes", Desempate: "(t.mes, t.canal_loja_id, t.sku)"},
	// pedidos-shopify.js:42. Restritiva: shopify_pedidos_so_do_meu_canal.
	"/comercial/pedidos-shopify": {Tabela: "shopify_pedidos", Alias: "t",
		SQL: `select t.id, t.total, t.criado_em_shopify, t.status_financeiro from shopify_pedidos t`,
		Filtros: []dados.Filtro{
			{Param: "criado_de", SQL: "t.criado_em_shopify >= @criado_de::timestamptz", Tipo: "instante"},
			{Param: "criado_ate", SQL: "t.criado_em_shopify < @criado_ate::timestamptz", Tipo: "instante"},
			{Param: "status_financeiro", SQL: "t.status_financeiro = any(@status_financeiro::text[])", Tipo: "texto[]"},
		},
		OrdemPadrao: "t.criado_em_shopify", Desempate: "t.id"},
}

// montarLeituras: as 7 GET. Handler chama Validar (declaração errada derruba a subida).
func montarLeituras(r chi.Router, p *pgxpool.Pool) {
	for caminho, c := range leiturasComEscopo {
		r.Get(caminho, c.Handler(p, autz.Producao))
	}
}
