package comercial

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/rbv-co/social-dashboard/api/internal/core"
)

// produtosDoCore: o espelho de mentira com 4 produtos (2 ativos) e o detalhe de um deles.
func produtosDoCore() http.Handler {
	lista := []map[string]any{
		{"id_bling": "11", "codigo": "SS-ABC-PRETO", "descricao": "Bolsa Mônaco Preta", "preco": 100, "id_situacaocadastro": 1, "tipo": "P"},
		{"id_bling": "12", "codigo": "SS-ABC-CARAMELO", "descricao": "Bolsa Mônaco Caramelo", "preco": 110, "id_situacaocadastro": 1, "tipo": "P"},
		{"id_bling": "13", "codigo": "LV-VELHA", "descricao": "Bolsa Velha", "preco": 90, "id_situacaocadastro": 0, "tipo": "P"},
		{"id_bling": "14", "codigo": "LV-OUTRA", "descricao": "Outra", "preco": 80, "id_situacaocadastro": 2, "tipo": "P"},
	}
	detalhe := []map[string]any{{"id_bling": 11, "situacao": "A", "detalhe": map[string]any{"id": 11, "nome": "Bolsa Mônaco Preta", "tributacao": map[string]any{"ncm": "4202.32.00"}}}}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		linhas := lista
		if strings.Contains(r.URL.Path, "bling_produtos_detalhe") {
			linhas = nil
			for _, d := range detalhe {
				if r.URL.Query().Get("id_bling") == "11" {
					linhas = append(linhas, d)
				}
			}
		}
		if linhas == nil {
			linhas = []map[string]any{}
		}
		if strings.HasSuffix(r.URL.Path, "/contagem") {
			json.NewEncoder(w).Encode(map[string]any{"linhas": len(linhas)})
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"data": linhas, "proximo_cursor": nil,
			"sincronia": map[string]any{"ultimo_ok": "2026-10-21T04:41:03Z", "atrasado": false}})
	})
}

func blingFora(status int) func(core.PedidoBling, int) (int, string, map[string]string) {
	return func(core.PedidoBling, int) (int, string, map[string]string) {
		return status, `{"error":"bling_instavel"}`, map[string]string{"X-Core-Origem": "proxy"}
	}
}

func lerProdutos(t *testing.T, a *ambiente, token, corpo string) (int, map[string]any) {
	t.Helper()
	w := a.post(token, corpo)
	var m map[string]any
	json.Unmarshal(w.Body.Bytes(), &m)
	return w.Code, m
}

// Bling fora (503/429): a lista de produtos sai do espelho, no formato do Bling, ativos por padrão, marcada `fonte`.
func TestProdutosReservaDoEspelhoQuandoOBlingFalha(t *testing.T) {
	for _, st := range []int{503, 429, 504} {
		a := montar(t, blingFora(st))
		a.core.espelho = produtosDoCore()
		code, m := lerProdutos(t, a, a.tokens[uAutent], `{"endpoint":"produtos","params":{"criterio":2,"pagina":1,"limite":100}}`)
		d, _ := m["data"].([]any)
		if code != 200 || m["fonte"] != "espelho" || len(d) != 2 || m["sincronia"] == nil {
			t.Fatalf("%d: %d %v", st, code, m)
		}
		p := d[0].(map[string]any)
		if p["codigo"] != "SS-ABC-PRETO" || p["nome"] != "Bolsa Mônaco Preta" || p["situacao"] != "A" || p["id"] != json.Number("11") && p["id"] != float64(11) {
			t.Fatalf("formato: %v", p)
		}
	}
}

func TestProdutosReservaFiltros(t *testing.T) {
	a := montar(t, blingFora(503))
	a.core.espelho = produtosDoCore()
	n := func(params string) int {
		_, m := lerProdutos(t, a, a.tokens[uVendas], `{"endpoint":"produtos","params":`+params+`}`)
		d, _ := m["data"].([]any)
		return len(d)
	}
	for params, esperado := range map[string]int{
		`{"codigo":"ss-abc-preto"}`:          1, // exato, sem caixa
		`{"codigo":"SS-ABC"}`:                0, // codigo não é prefixo
		`{"pesquisa":"monaco"}`:              0, // sem acento não casa: o texto é o do Bling, com acento
		`{"pesquisa":"mônaco"}`:              2,
		`{"pesquisa":"ss-abc-car"}`:          1,
		`{"criterio":5}`:                     4,
		`{"criterio":3}`:                     2,
		`{"limite":1,"pagina":2}`:            1,
		`{"limite":1,"pagina":3}`:            0,
		`{"criterio":2,"codigo":"LV-VELHA"}`: 0, // inativo não vem no criterio 2
	} {
		if got := n(params); got != esperado {
			t.Errorf("%s: %d, esperado %d", params, got, esperado)
		}
	}
}

// Detalhe: o JSON do Bling guardado no Core; sem ele, a linha da lista; sem nenhum, o erro do Bling como veio.
func TestProdutosReservaDetalhe(t *testing.T) {
	a := montar(t, blingFora(503))
	a.core.espelho = produtosDoCore()
	code, m := lerProdutos(t, a, a.tokens[uAutent], `{"endpoint":"produtos/11"}`)
	d, _ := m["data"].(map[string]any)
	if code != 200 || m["fonte"] != "espelho" || d["tributacao"] == nil || d["_espelho_em"] == nil {
		t.Fatalf("detalhe: %d %v", code, m)
	}
	code, m = lerProdutos(t, a, a.tokens[uAutent], `{"endpoint":"produtos/12"}`)
	d, _ = m["data"].(map[string]any)
	if code != 200 || d["codigo"] != "SS-ABC-CARAMELO" {
		t.Fatalf("sem detalhe cai na linha da lista: %d %v", code, m)
	}
	if code, _ = lerProdutos(t, a, a.tokens[uAutent], `{"endpoint":"produtos/999"}`); code != 503 {
		t.Fatalf("produto que o espelho não conhece devolve o erro do Bling: %d", code)
	}
}

// 404 do Bling é resposta de verdade (não reserva); espelho fora devolve o erro do Bling; e o Bling vivo vence sempre.
func TestProdutosReservaSoQuandoDevida(t *testing.T) {
	a := montar(t, blingFora(404))
	a.core.espelho = produtosDoCore()
	if code, m := lerProdutos(t, a, a.tokens[uAutent], `{"endpoint":"produtos/11"}`); code != 404 || m["fonte"] != nil {
		t.Fatalf("404: %d %v", code, m)
	}
	b := montar(t, blingFora(503)) // sem espelho configurado: o core falso responde ao espelho como proxy do Bling (503)
	if code, _ := lerProdutos(t, b, b.tokens[uAutent], `{"endpoint":"produtos","params":{}}`); code < 500 {
		t.Fatalf("espelho fora tem de devolver o erro do Bling: %d", code)
	}
	c := montar(t, ok200(`{"data":[{"id":1,"codigo":"X"}]}`))
	c.core.espelho = produtosDoCore()
	if code, m := lerProdutos(t, c, c.tokens[uAutent], `{"endpoint":"produtos","params":{}}`); code != 200 || m["fonte"] != nil {
		t.Fatalf("Bling vivo: %d %v", code, m)
	}
	if code, _ := lerProdutos(t, a, a.tokens[uNada], `{"endpoint":"produtos","params":{}}`); code != 403 {
		t.Fatalf("sem permissão continua 403 mesmo com reserva: %d", code)
	}
}
