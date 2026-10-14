package vendas

import (
	"net/http"
	"net/url"
	"strings"
	"testing"
)

// casoDeEscopo: as chaves que cada pessoa enxerga numa leitura com restritiva (campo ordenado; "" = vazia).
type casoDeEscopo struct {
	caminho, campo string
	quer           map[string]string
}

// casosDeEscopo: TODA rota de leiturasComEscopo × TODA pessoa do mundo. Lojas: 1 = T1, 2 = T2, 3 = T3 (G1),
// 205512275 = Shopify (sem time), nota 104 sem loja. papel admin COM trava não vê canal nenhum (paridade).
var casosDeEscopo = map[string]casoDeEscopo{
	"/comercial/notas": {"/comercial/notas", "pedido_id", map[string]string{
		"super": "101,102,103,104", "semTrava": "101,102,103,104", "admin": "", "vendT1": "101", "estT1": "101",
		"gestorT2": "102", "supervG1": "103", "viewer": ""}},
	"/comercial/ajustes-de-valor": {"/comercial/ajustes-de-valor", "pedido_id", map[string]string{
		"super": "101,102", "semTrava": "101,102", "admin": "", "vendT1": "101", "estT1": "101",
		"gestorT2": "102", "supervG1": "", "viewer": ""}},
	"/comercial/ajustes-de-vendedor": {"/comercial/ajustes-de-vendedor", "pedido_id", map[string]string{
		"super": "101,103", "semTrava": "101,103", "admin": "", "vendT1": "101", "estT1": "101",
		"gestorT2": "", "supervG1": "103", "viewer": ""}},
	"/comercial/formas-de-pagamento": {"/comercial/formas-de-pagamento?eh_devolucao=true", "pedido_id", map[string]string{
		"super": "101,102", "semTrava": "101,102", "admin": "", "vendT1": "101", "estT1": "101",
		"gestorT2": "102", "supervG1": "", "viewer": ""}},
	"/comercial/estoque": {"/comercial/estoque", "deposito_id", map[string]string{
		"super": "11,12,13,99", "semTrava": "11,12,13,99", "admin": "", "vendT1": "", "estT1": "11",
		"gestorT2": "12", "supervG1": "13", "viewer": ""}},
	"/comercial/vendas-por-item": {"/comercial/vendas-por-item", "canal_loja_id", map[string]string{
		"super": "1,1,2,3", "semTrava": "1,1,2,3", "admin": "", "vendT1": "1,1", "estT1": "1,1",
		"gestorT2": "2", "supervG1": "3", "viewer": ""}},
	"/comercial/pedidos-shopify": {"/comercial/pedidos-shopify", "id", map[string]string{
		"super": "9001,9002", "semTrava": "9001,9002", "admin": "", "vendT1": "9002", "estT1": "9002",
		"gestorT2": "", "supervG1": "", "viewer": ""}},
}

// Nenhuma linha de outra loja/depósito chega a quem não a vê em produção, pelo handler real.
func TestNadaVazaEntreLojas(t *testing.T) {
	m := novoMundo(t, montarLeituras)
	if len(casosDeEscopo) != len(leiturasComEscopo) {
		t.Fatalf("%d casos para %d rotas: rota com restritiva sem matriz", len(casosDeEscopo), len(leiturasComEscopo))
	}
	for rota, c := range casosDeEscopo {
		if _, ok := leiturasComEscopo[rota]; !ok {
			t.Fatalf("caso de %s sem rota", rota)
		}
		for _, p := range pessoas {
			quer, ok := c.quer[p.Chave]
			if !ok {
				t.Fatalf("%s: falta o caso de %s", rota, p.Chave)
			}
			st, corpo := m.Pedir(t, p.Chave, http.MethodGet, c.caminho, "")
			if st != http.StatusOK {
				t.Errorf("%s como %s = %d %s", c.caminho, p.Chave, st, corpo)
				continue
			}
			if v := chaves(t, corpo, c.campo); v != quer {
				t.Errorf("%s como %s: %s = %q, esperava %q", c.caminho, p.Chave, c.campo, v, quer)
			}
			for _, proibido := range []string{"Fulana", "fulana@", "cliente_", "bruto"} {
				if strings.Contains(corpo, proibido) {
					t.Errorf("%s como %s devolveu %q (dado pessoal)", c.caminho, p.Chave, proibido)
				}
			}
		}
	}
}

// Filtros que apontam para outra loja/depósito nunca abrem a linha; a contagem também só conta o visível.
func TestFiltrosNaoAbremOutraLoja(t *testing.T) {
	m := novoMundo(t, montarLeituras)
	janela := func(a, b string) string { return url.QueryEscape("[" + a + "," + b + "]") }
	for _, c := range []struct{ nome, quem, caminho, campo, quer string }{
		{"depósito de outra loja", "vendT1", "/comercial/estoque?deposito_id=12", "deposito_id", ""},
		{"liberado + outro", "estT1", "/comercial/estoque?deposito_id=11,12", "deposito_id", "11"},
		{"mês só do próprio canal", "vendT1", "/comercial/vendas-por-item?mes=2026-09-01", "canal_loja_id", "1"},
		{"mês de outro canal", "gestorT2", "/comercial/vendas-por-item?mes=2026-10-01", "canal_loja_id", ""},
		{"janela pelo dia do pedido", "vendT1", "/comercial/notas?janela=" + janela("2026-10-01", "2026-10-31"), "pedido_id", "101"},
		{"janela pelo dia da nota", "super", "/comercial/notas?janela=" + janela("2026-10-04", "2026-10-04"), "pedido_id", "103"},
		{"status da Shopify", "super", "/comercial/pedidos-shopify?status_financeiro=refunded", "id", ""},
		{"período da Shopify", "vendT1", "/comercial/pedidos-shopify?criado_de=2026-10-01T00:00:00Z&criado_ate=2026-10-02T00:00:00Z", "id", ""},
	} {
		st, corpo := m.Pedir(t, c.quem, http.MethodGet, c.caminho, "")
		if st != http.StatusOK || chaves(t, corpo, c.campo) != c.quer {
			t.Errorf("%s: %s como %s = %d %s; esperava %q", c.nome, c.caminho, c.quem, st, corpo, c.quer)
		}
	}
	// contar=1 conta só o visível
	r := m.Resposta(t, "vendT1", http.MethodGet, "/comercial/notas?contar=1", "")
	if n := r.Header().Get("X-Total-Count"); n != "1" {
		t.Errorf("contagem de vendT1 = %q, esperava 1", n)
	}
	// parâmetro desconhecido, janela que não é intervalo e mês que não é data = 400
	for _, caminho := range []string{"/comercial/notas?loja_id=2", "/comercial/notas?janela=hoje",
		"/comercial/vendas-por-item?mes=amanha", "/comercial/estoque?deposito_id=a"} {
		if st, corpo := m.Pedir(t, "super", http.MethodGet, caminho, ""); st != http.StatusBadRequest {
			t.Errorf("%s = %d %s, esperava 400", caminho, st, corpo)
		}
	}
}
