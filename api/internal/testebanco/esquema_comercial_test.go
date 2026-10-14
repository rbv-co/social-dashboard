package testebanco

import (
	"context"
	"errors"
	"slices"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

// colunasDoComercial: o que as rotas do 5.5 leem e gravam. A MESMA lista vai ao cmd/api/conferir.go (Task 9).
var colunasDoComercial = map[string]string{
	"bling_lojas":                  "loja_id,nome,grupo,grupo_id,fechado_em,foco",
	"bling_depositos":              "deposito_id,nome,ativo,padrao",
	"bling_metas":                  "id,loja_id,year,month,meta_valor,daily_goals",
	"bling_vendedor_metas":         "id,vendor_id,year,month,meta_valor,daily_goals",
	"bling_vendedores":             "vendor_id,nome,updated_at",
	"bling_pedido_vendedor":        "pedido_id,vendor_id,pedido_data,qtd_itens,loja_id",
	"bling_pedido_nota":            "pedido_id,pedido_numero,data_pedido,data_da_venda,total,loja_id,nota_situacao",
	"bling_pedido_ajuste_valor":    "pedido_id,loja_id,total_corrigido",
	"bling_pedido_ajuste_vendedor": "pedido_id,loja_id,vendor_id_corrigido",
	"bling_pedido_forma_pagamento": "parcela_id,pedido_id,loja_id,valor,eh_devolucao",
	"gc_estoque_item":              "deposito_id,sku,produto,categoria,saldo",
	"gc_vendas_item":               "mes,canal_loja_id,sku,produto,categoria,unidades,faturamento",
	"gestao_comercial_briefings":   "id,rodada,periodo,resumo,conteudo,dados_json,created_at",
	"shopify_pedidos":              "id,loja_id,total,status_financeiro,criado_em_shopify",
}

// A fatia 5.5: as colunas que as rotas presumem, as colunas geradas da nota, os checks dos ajustes, os
// defaults e nenhum gatilho novo (o único do domínio, em bling_lojas, é do D0 do 5.1).
func TestFatiaDoComercial(t *testing.T) {
	p := ComEsquemaDeProducao(t)
	ctx := context.Background()
	um := func(sql string) string {
		var v *string
		if err := p.QueryRow(ctx, sql).Scan(&v); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
		if v == nil {
			return "<nulo>"
		}
		return *v
	}
	for tab, quer := range colunasDoComercial {
		var tem []string
		linhas, err := p.Query(ctx, `select column_name::text from information_schema.columns
			where table_schema = 'public' and table_name = $1::text`, tab)
		if err != nil {
			t.Fatal(err)
		}
		for linhas.Next() {
			var c string
			linhas.Scan(&c)
			tem = append(tem, c)
		}
		for _, c := range strings.Split(quer, ",") {
			if !slices.Contains(tem, c) {
				t.Errorf("%s.%s ausente na fatia", tab, c)
			}
		}
	}

	if _, err := p.Exec(ctx, `
		insert into bling_lojas (loja_id, nome) values (77, 'Loja de teste');
		insert into bling_pedido_nota (pedido_id, loja_id, data_pedido) values (1, 77, '2026-10-01');
		insert into bling_pedido_nota (pedido_id, loja_id, data_pedido, data_da_nota) values (2, 77, '2026-10-01', '2026-10-02');
		insert into shopify_pedidos (id, total, status_financeiro, criado_em_shopify, bruto) values (1, 10, 'paid', now(), '{}');
		insert into bling_pedido_vendedor (pedido_id, vendor_id) values (1, 7);`); err != nil {
		t.Fatal(err)
	}
	if v := um(`select string_agg(data_da_venda::text || '/' || origem_da_data, ',' order by pedido_id) from bling_pedido_nota`); v != "2026-10-01/pedido,2026-10-02/nota" {
		t.Errorf("data_da_venda = %s", v)
	}
	if v := um(`select (select loja_id::text from shopify_pedidos) || '/' || (select foco::text from bling_lojas where loja_id = 77) ||
		'/' || (select qtd_itens::text from bling_pedido_vendedor)`); v != "205512275/true/1" {
		t.Errorf("defaults = %s", v)
	}
	for _, sql := range []string{
		`insert into bling_pedido_ajuste_valor (pedido_id, total_corrigido, motivo) values (1, 10, 'curto')`,
		`insert into bling_pedido_ajuste_valor (pedido_id, total_corrigido, motivo) values (2, -5, 'motivo bem comprido')`,
		`insert into bling_pedido_ajuste_vendedor (pedido_id, vendor_id_corrigido, motivo) values (1, 7, 'curto')`,
	} {
		var pe *pgconn.PgError
		if _, err := p.Exec(ctx, sql); !errors.As(err, &pe) || pe.Code != "23514" {
			t.Errorf("%s: %v (esperava 23514)", sql, err)
		}
	}
	if v := um(`select ((select count(*) from bling_pedido_ajuste_valor) + (select count(*) from bling_pedido_ajuste_vendedor))::text`); v != "0" {
		t.Errorf("check negado gravou: %s", v)
	}
	// Do dump do ensaio (o plano presumia o contrário): metas por loja/mês são únicas e o vendedor do pedido é obrigatório.
	for sql, codigo := range map[string]string{
		`insert into bling_metas (loja_id, year, month) values (77, 2026, 10), (77, 2026, 10)`: "23505",
		`insert into bling_pedido_vendedor (pedido_id, vendor_id) values (99, null)`:           "23502",
	} {
		var pe *pgconn.PgError
		if _, err := p.Exec(ctx, sql); !errors.As(err, &pe) || pe.Code != codigo {
			t.Errorf("%s: %v (esperava %s)", sql, err, codigo)
		}
	}
	if v := um(`select string_agg(tgname::text, ',') from pg_trigger where not tgisinternal and tgrelid::regclass::text in (
		'bling_depositos','bling_metas','bling_vendedor_metas','bling_vendedores','bling_pedido_vendedor','bling_pedido_nota',
		'bling_pedido_ajuste_valor','bling_pedido_ajuste_vendedor','bling_pedido_forma_pagamento','gc_estoque_item',
		'gc_vendas_item','gestao_comercial_briefings','shopify_pedidos')`); v != "<nulo>" {
		t.Errorf("gatilho inesperado na fatia 5.5: %s", v)
	}
}
