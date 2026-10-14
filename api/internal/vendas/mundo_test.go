package vendas

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"sync"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
)

type caso = mundoteste.Caso

// Pessoas e linhas do mundo do 5.5 (ids fixos). "Trava" = escopo_por_equipe; "sales" = a feature que
// pode_ver_vendas() aceita (além de papel admin e super pela ficha).
const (
	idSuper    = "5e550000-0000-4000-a000-000000000001" // super pela ficha, papel viewer: vê todo canal; NÃO grava metas
	idAdmin    = "5e550000-0000-4000-a000-000000000002" // papel admin, com trava, sem time: grava metas e caches, não vê canal
	idSemTrava = "5e550000-0000-4000-a000-000000000003" // sem trava, sem sales: vê todo canal, não grava cache
	idVendT1   = "5e550000-0000-4000-a000-000000000004" // vendedora do T1 (canal 1), sales, sem liberação de estoque
	idEstT1    = "5e550000-0000-4000-a000-000000000005" // vendedora do T1 com a liberação de estoque do T1 (depósito 11)
	idGestorT2 = "5e550000-0000-4000-a000-000000000006" // gestora do T2 (canal 2, depósito 12)
	idSupervG1 = "5e550000-0000-4000-a000-000000000007" // supervisora do grupo G1 (loja 3 → T3, canal 3, depósito 13)
	idViewer   = "5e550000-0000-4000-a000-000000000008" // ninguém

	T1 = "e5500000-0000-4000-a000-000000000001"
	T2 = "e5500000-0000-4000-a000-000000000002"
	T3 = "e5500000-0000-4000-a000-000000000003"
	G1 = "c5500000-0000-4000-a000-000000000001"
	G2 = "c5500000-0000-4000-a000-000000000002"
	B1 = "b5500000-0000-4000-a000-000000000001" // briefing da semana 40
	B2 = "b5500000-0000-4000-a000-000000000002" // briefing da semana 41 (o mais novo)
)

var pessoas = []mundoteste.Pessoa{
	{Chave: "super", ID: idSuper, Email: "super@x.com", Papel: "viewer", Super: true, Trava: true},
	{Chave: "admin", ID: idAdmin, Email: "admin@x.com", Papel: "admin", Trava: true},
	{Chave: "semTrava", ID: idSemTrava, Email: "semtrava@x.com", Papel: "viewer"},
	{Chave: "vendT1", ID: idVendT1, Email: "vendt1@x.com", Papel: "viewer", Trava: true, Modulos: []string{"sales"}},
	{Chave: "estT1", ID: idEstT1, Email: "estt1@x.com", Papel: "viewer", Trava: true, Modulos: []string{"sales"}},
	{Chave: "gestorT2", ID: idGestorT2, Email: "gestort2@x.com", Papel: "viewer", Trava: true, Modulos: []string{"sales"}},
	{Chave: "supervG1", ID: idSupervG1, Email: "supervg1@x.com", Papel: "viewer", Trava: true, Modulos: []string{"sales"}},
	{Chave: "viewer", ID: idViewer, Email: "viewer@x.com", Papel: "viewer", Trava: true},
}

// sem identidade; o gatilho de bling_lojas espelha o nome do grupo em `grupo`
const linhasDoMundo = `
insert into canais_grupos (id, nome) values ('` + G1 + `', 'Atacado'), ('` + G2 + `', 'Varejo');
insert into bling_lojas (loja_id, nome, grupo_id) values (1, 'Loja Tivoli', null), (2, 'Loja Dom Pedro', null),
  (3, 'Atacado', '` + G1 + `'), (4, 'Fábrica', null), (205512275, 'Loja Shopify', null);
insert into equipes (id, nome, canal_loja_id, deposito_id) values
  ('` + T1 + `', 'Tivoli', 1, 11), ('` + T2 + `', 'Dom Pedro', 2, 12), ('` + T3 + `', 'Atacado', 3, 13);
insert into equipes_membros (equipe_id, profile_id, papel) values ('` + T1 + `', '` + idVendT1 + `', 'vendedora'),
  ('` + T1 + `', '` + idEstT1 + `', 'vendedora'), ('` + T2 + `', '` + idGestorT2 + `', 'gestor');
insert into canais_grupos_membros (grupo_id, profile_id) values ('` + G1 + `', '` + idSupervG1 + `');
insert into equipes_permissoes (equipe_id, profile_id, chave) values ('` + T1 + `', '` + idEstT1 + `', 'estoque');
insert into bling_depositos (deposito_id, nome, padrao) values (11, 'Depósito Tivoli', true), (12, 'Depósito Dom Pedro', false),
  (13, 'Depósito Atacado', false), (99, 'Depósito Geral', false);
insert into bling_metas (id, loja_id, year, month, meta_valor, daily_goals) values
  (1, 0, 2026, 10, 200000, null), (2, 1, 2026, 10, 60000, '{"1": 2000, "2": 2000}'), (3, 2, 2026, 9, 50000, null);
select setval('bling_metas_id_seq', 3);
insert into bling_vendedor_metas (id, vendor_id, year, month, meta_valor) values (1, 7, 2026, 10, 20000);
select setval('bling_vendedor_metas_id_seq', 1);
insert into bling_vendedores (vendor_id, nome) values (7, 'Ana'), (8, 'Bia');
insert into bling_pedido_vendedor (pedido_id, vendor_id, pedido_data, qtd_itens, loja_id) values
  (101, 7, '2026-10-01', 2, 1), (102, 8, '2026-10-02', 1, 2);
insert into bling_pedido_nota (pedido_id, pedido_numero, loja_id, data_pedido, total, nota_situacao, data_da_nota) values
  (101, '2001', 1, '2026-10-01', 100, 6, null), (102, '2002', 2, '2026-10-02', 200, 6, null),
  (103, '2003', 3, '2026-10-03', 300, 6, '2026-10-04'), (104, '2004', null, '2026-10-05', 400, 6, null);
insert into bling_pedido_ajuste_valor (pedido_id, loja_id, total_corrigido, total_do_bling, motivo) values
  (101, 1, 90, 100, 'desconto no pix não lançado'), (102, 2, 150, 200, 'troca abatida no caixa');
insert into bling_pedido_ajuste_vendedor (pedido_id, loja_id, vendor_id_corrigido, vendor_id_do_bling, motivo) values
  (101, 1, 8, 7, 'quem vendeu foi a Bia'), (103, 3, 7, null, 'quem vendeu foi a Ana');
insert into bling_pedido_forma_pagamento (parcela_id, pedido_id, loja_id, forma_pagamento_id, valor, eh_devolucao) values
  (1001, 101, 1, 5, 10, true), (1002, 102, 2, 5, 20, true), (1003, 101, 1, 1, 90, false);
insert into gc_vendas_item (mes, canal_loja_id, sku, produto, categoria, unidades, faturamento) values
  ('2026-09-01', 1, 'A', 'Bolsa A', 'Bolsas', 2, 500), ('2026-09-01', 2, 'B', 'Bolsa B', 'Bolsas', 1, 300),
  ('2026-09-01', 3, 'C', 'Bolsa C', 'Bolsas', 4, 900), ('2026-10-01', 1, 'A', 'Bolsa A', 'Bolsas', 1, 250);
insert into gc_estoque_item (deposito_id, sku, produto, categoria, saldo) values
  (11, 'A', 'Bolsa A', 'Bolsas', 5), (12, 'B', 'Bolsa B', 'Bolsas', 3), (13, 'C', 'Bolsa C', 'Bolsas', 7), (99, 'D', 'Bolsa D', 'Bolsas', 1);
insert into gestao_comercial_briefings (id, rodada, resumo, conteudo, created_at) values
  ('` + B1 + `', '2026-10-05', 'semana 40', 'texto 40', '2026-10-05T12:00:00Z'),
  ('` + B2 + `', '2026-10-12', 'semana 41', 'texto 41', '2026-10-12T12:00:00Z');
insert into shopify_pedidos (id, numero, loja_id, total, status_financeiro, cliente_nome, cliente_email, criado_em_shopify, bruto) values
  (9001, '#1001', 205512275, 500, 'paid', 'Fulana de Tal', 'fulana@exemplo.com', '2026-10-01T15:00:00Z', '{"email": "fulana@exemplo.com"}'),
  (9002, '#1002', 1, 300, 'paid', 'Beltrana', 'beltrana@exemplo.com', '2026-10-02T15:00:00Z', '{}');`

// fotoDoComercial: um hash de tudo que o 5.5 grava. Igual antes e depois = nada mudou.
const fotoDoComercial = `select md5(string_agg(l, '|' order by l)) from (
  select 'lojas:' || t::text as l from bling_lojas t union all
  select 'metas:' || t::text from bling_metas t union all
  select 'vmetas:' || t::text from bling_vendedor_metas t union all
  select 'vendedoras:' || t::text from bling_vendedores t union all
  select 'cache:' || t::text from bling_pedido_vendedor t) z`

func novoMundo(t *testing.T, montar ...func(chi.Router, *pgxpool.Pool)) *mundoteste.Mundo {
	t.Helper()
	return mundoteste.Novo(t, mundoteste.Opcoes{Pessoas: pessoas, Linhas: linhasDoMundo,
		Impersonadas: map[string][2]string{"impersonado": {idAdmin, idSuper}}}, montar...)
}

// chaves: os valores de `campo` numa lista JSON, como texto, ordenados e juntados por vírgula ("" = vazia).
func chaves(t *testing.T, corpo, campo string) string {
	t.Helper()
	d := json.NewDecoder(strings.NewReader(corpo))
	d.UseNumber()
	var l []map[string]any
	if err := d.Decode(&l); err != nil {
		t.Fatalf("%v: %s", err, corpo)
	}
	out := make([]string, 0, len(l))
	for _, x := range l {
		out = append(out, fmt.Sprint(x[campo]))
	}
	slices.Sort(out)
	return strings.Join(out, ",")
}

// aoMesmoTempo roda f(0) e f(1) soltos pela mesma largada (para provar a ausência de corrida). Dentro de
// f, só t.Errorf (nunca Fatal fora da goroutine do teste).
func aoMesmoTempo(f func(lado int)) {
	var wg sync.WaitGroup
	largada := make(chan struct{})
	for lado := range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-largada
			f(lado)
		}()
	}
	close(largada)
	wg.Wait()
}
