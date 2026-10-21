package comercial

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/core"
)

const (
	lojaDomPedro = "205657609"
	lojaTivoli   = "205834140"
)

// coreEspelho é o espelho do core de mentira: 3 pedidos "Atendido" (2 do Dom Pedro, 1 do Tivoli), itens e
// sincronia; conta as chamadas e guarda a última query de cada tabela.
type coreEspelho struct {
	chamadas  atomic.Int32
	queries   map[string]string
	status    int // 0 = 200
	ultimoOK  string
	pedidoSem bool // um pedido sem vendedor
}

func (f *coreEspelho) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.chamadas.Add(1)
	if f.status != 0 {
		w.WriteHeader(f.status)
		return
	}
	tabela := strings.TrimPrefix(r.URL.Path, "/api/interno/espelho/")
	contagem := strings.HasSuffix(tabela, "/contagem")
	tabela = strings.TrimSuffix(tabela, "/contagem")
	if !contagem {
		f.queries[tabela] = r.URL.RawQuery
	}
	var linhas []map[string]any
	switch tabela {
	case "pedidos":
		vend := "15596931796"
		linhas = []map[string]any{
			{"pedido_id_bling": "1001", "numero": 2707, "data": "2026-10-01", "total": 1472.5, "total_produtos": 1550, "status_id_bling": 9,
				"descricao": "Atendido", "loja_id_bling": lojaDomPedro, "loja_descricao": "Dom Pedro", "vendedor_id_bling": vend},
			{"pedido_id_bling": "1002", "numero": 2708, "data": "2026-10-02", "total": 100.0, "total_produtos": 100, "status_id_bling": 9,
				"descricao": "Atendido", "loja_id_bling": lojaDomPedro, "loja_descricao": "Dom Pedro", "vendedor_id_bling": nil},
			{"pedido_id_bling": "1003", "numero": 2709, "data": "2026-10-02", "total": 50.25, "total_produtos": 50.25, "status_id_bling": 9,
				"descricao": "Atendido", "loja_id_bling": lojaTivoli, "loja_descricao": "Tivoli", "vendedor_id_bling": "777"},
		}
	case "pedido_itens":
		linhas = []map[string]any{
			{"pedido_id_bling": "1001", "codigo": "SS0003SB.B2", "descricao": "Shoulder Marea", "unidade": "UN", "quantidade": 1, "valor": 1550, "desconto": 5, "produto_id": "16699865939"},
			{"pedido_id_bling": "1002", "codigo": "A", "descricao": "A", "quantidade": 2, "valor": 50, "desconto": 0},
			{"pedido_id_bling": "1003", "codigo": "B", "descricao": "B", "quantidade": 1, "valor": 50.25, "desconto": 0},
		}
	default:
		w.WriteHeader(404)
		return
	}
	if ids := r.URL.Query()["pedido_id_bling[]"]; len(ids) > 0 { // como o core: filtra pelos ids pedidos
		var so []map[string]any
		for _, l := range linhas {
			for _, id := range ids {
				if l["pedido_id_bling"] == id {
					so = append(so, l)
				}
			}
		}
		linhas = so
	}
	w.Header().Set("Content-Type", "application/json")
	sinc := map[string]any{"ultimo_ok": f.ultimoOK, "periodo_s": 900, "atrasado": false}
	if contagem {
		json.NewEncoder(w).Encode(map[string]any{"linhas": len(linhas), "sincronia": sinc})
		return
	}
	json.NewEncoder(w).Encode(map[string]any{"data": linhas, "proximo_cursor": nil, "sincronia": sinc})
}

type vendasT struct {
	h     *VendasEspelho
	core  *coreEspelho
	agora time.Time
}

func novoVendas(t *testing.T, fonte string, lista []int64) *vendasT {
	t.Helper()
	agora := time.Date(2026, 10, 21, 20, 0, 0, 0, time.UTC)
	f := &coreEspelho{queries: map[string]string{}, ultimoOK: agora.Add(-5 * time.Minute).Format(time.RFC3339)}
	srv := httptest.NewServer(f)
	t.Cleanup(srv.Close)
	cli := core.Novo(srv.URL, "tok")
	cli.Dormir = func(context.Context, time.Duration) error { return nil }
	v := &vendasT{core: f, agora: agora}
	v.h = &VendasEspelho{Core: cli, Fonte: fonte, Agora: func() time.Time { return v.agora },
		Canais: func(context.Context, *auth.Ator) ([]int64, error) { return lista, nil }}
	return v
}

func (v *vendasT) get(t *testing.T, query string, a *auth.Ator) (int, map[string]any) {
	t.Helper()
	if a == nil {
		a = &auth.Ator{Tipo: "painel", Modulos: []string{"sales"}}
	}
	r := httptest.NewRequest(http.MethodGet, "/vendas/pedidos?"+query, nil).WithContext(auth.NoContexto(context.Background(), a))
	w := httptest.NewRecorder()
	v.h.ServeHTTP(w, r)
	var corpo map[string]any
	json.Unmarshal(w.Body.Bytes(), &corpo)
	return w.Code, corpo
}

func TestFonteDeVendas(t *testing.T) {
	casos := []struct{ env, tela, quer string }{
		{"", "", "bling"}, {"espelho", "", "espelho"}, {"espelho", "gestao", "espelho"}, {"BLING", "", "bling"},
		{"gestao=espelho,analise=bling", "gestao", "espelho"}, {"gestao=espelho,analise=bling", "analise", "bling"},
		{"gestao=espelho", "analise", "bling"}, {"espelho,analise=bling", "analise", "bling"}, {"espelho,analise=bling", "gestao", "espelho"},
		{"torto", "", "bling"}, {"gestao=talvez", "gestao", "bling"},
	}
	for _, c := range casos {
		if got := FonteDeVendas(c.env, c.tela); got != c.quer {
			t.Errorf("FonteDeVendas(%q,%q)=%s, quer %s", c.env, c.tela, got, c.quer)
		}
	}
}

func TestVendasEspelhoComFlagBlingNaoTocaNoCore(t *testing.T) {
	v := novoVendas(t, "", nil)
	st, c := v.get(t, "de=2026-10-01&ate=2026-10-21", nil)
	if st != 200 || c["fonte"] != "bling" || v.core.chamadas.Load() != 0 {
		t.Fatalf("st=%d corpo=%v chamadas=%d", st, c, v.core.chamadas.Load())
	}
}

func TestVendasEspelhoFormatoDaListaDoBlingEItensDentro(t *testing.T) {
	v := novoVendas(t, "espelho", nil)
	st, c := v.get(t, "de=2026-10-01&ate=2026-10-21", nil)
	if st != 200 || c["fonte"] != "espelho" {
		t.Fatalf("st=%d corpo=%v", st, c)
	}
	dados := c["data"].([]any)
	if len(dados) != 3 {
		t.Fatalf("pedidos=%d", len(dados))
	}
	p := dados[0].(map[string]any)
	if p["id"] != float64(1001) || p["numero"] != float64(2707) || p["data"] != "2026-10-01" || p["total"] != 1472.5 || p["totalProdutos"] != float64(1550) {
		t.Fatalf("pedido: %v", p)
	}
	if loja := p["loja"].(map[string]any); loja["id"] != float64(205657609) {
		t.Fatalf("loja.id tem de ser número, como o Bling: %v", loja)
	}
	if p["vendedor"].(map[string]any)["id"] != float64(15596931796) || p["situacao"].(map[string]any)["id"] != float64(9) {
		t.Fatalf("vendedor/situacao: %v", p)
	}
	it := p["itens"].([]any)[0].(map[string]any)
	if it["codigo"] != "SS0003SB.B2" || it["quantidade"] != float64(1) || it["valor"] != float64(1550) || it["desconto"] != float64(5) {
		t.Fatalf("item: %v", it)
	}
	if _, tem := dados[1].(map[string]any)["vendedor"]; tem {
		t.Fatalf("pedido sem vendedor no espelho não inventa vendedor: %v", dados[1])
	}
	if q := v.core.queries["pedidos"]; !strings.Contains(q, "status_id_bling=9") || !strings.Contains(q, "data_de=2026-10-01") || !strings.Contains(q, "data_ate=2026-10-21") {
		t.Fatalf("query ao core: %s", q)
	}
	if s := c["sincronia"].(map[string]any); s["defasado"] != false || s["ultimo_ok"] == nil {
		t.Fatalf("sincronia: %v", s)
	}
}

func TestVendasEspelhoAvisaQuandoOEspelhoEstaVelho(t *testing.T) {
	v := novoVendas(t, "espelho", nil)
	v.core.ultimoOK = v.agora.Add(-45 * time.Minute).Format(time.RFC3339)
	_, c := v.get(t, "de=2026-10-01&ate=2026-10-21", nil)
	if c["sincronia"].(map[string]any)["defasado"] != true {
		t.Fatalf("45 min de atraso tem de acusar defasado: %v", c["sincronia"])
	}
}

func TestVendasEspelhoRecortePorCanal(t *testing.T) {
	v := novoVendas(t, "espelho", []int64{205657609})
	_, c := v.get(t, "de=2026-10-01&ate=2026-10-21", nil)
	dados := c["data"].([]any)
	if len(dados) != 2 {
		t.Fatalf("a supervisora do Dom Pedro vê só os 2 do Dom Pedro, veio %d", len(dados))
	}
	for _, p := range dados {
		if p.(map[string]any)["loja"].(map[string]any)["id"] != float64(205657609) {
			t.Fatalf("vazou outro canal: %v", p)
		}
	}
	// pedir o canal alheio explicitamente não amplia
	_, c = v.get(t, "de=2026-10-01&ate=2026-10-21&loja="+lojaTivoli, nil)
	if len(c["data"].([]any)) != 0 {
		t.Fatalf("loja fora do escopo devolveu pedido: %v", c)
	}
	// ids soltos também são recortados
	_, c = v.get(t, "ids=1003", nil)
	if len(c["data"].([]any)) != 0 {
		t.Fatalf("id de outro canal vazou: %v", c)
	}
	// limitada a nenhum canal: lista vazia e nem lê o core
	v2 := novoVendas(t, "espelho", []int64{})
	_, c = v2.get(t, "de=2026-10-01&ate=2026-10-21", nil)
	if len(c["data"].([]any)) != 0 || v2.core.chamadas.Load() != 0 {
		t.Fatalf("sem canal: %v chamadas=%d", c, v2.core.chamadas.Load())
	}
}

func TestVendasEspelhoFiltrosDeLojaEVendedor(t *testing.T) {
	v := novoVendas(t, "espelho", nil)
	_, c := v.get(t, "de=2026-10-01&ate=2026-10-21&loja="+lojaTivoli, nil)
	if len(c["data"].([]any)) != 1 {
		t.Fatalf("loja: %v", c)
	}
	_, c = v.get(t, "de=2026-10-01&ate=2026-10-21&vendedor=15596931796", nil)
	if len(c["data"].([]any)) != 1 {
		t.Fatalf("vendedor: %v", c)
	}
}

func TestVendasEspelhoPortaoEValidacao(t *testing.T) {
	v := novoVendas(t, "espelho", nil)
	if st, _ := v.get(t, "de=2026-10-01&ate=2026-10-21", &auth.Ator{Tipo: "painel", Modulos: []string{"meta"}}); st != 403 {
		t.Fatalf("sem sales/gestor: %d", st)
	}
	if st, _ := v.get(t, "de=2026-10-01&ate=2026-10-21", &auth.Ator{Tipo: "painel", Modulos: []string{"gestor"}}); st != 200 {
		t.Fatalf("gestor: %d", st)
	}
	antes := v.core.chamadas.Load()
	for _, q := range []string{"", "de=2026-10-01", "de=ontem&ate=hoje", "de=2026-10-21&ate=2026-10-01", "de=2026-01-01&ate=2026-10-21",
		"de=2026-10-01&ate=2026-10-21&loja=x", "ids=1,abc", "de=2026-10-01&ate=2026-10-21&tela=A_B"} {
		if st, _ := v.get(t, q, nil); st != 400 {
			t.Errorf("query %q: %d, quer 400", q, st)
		}
	}
	if v.core.chamadas.Load() != antes {
		t.Fatalf("pedido inválido não pode gastar o balde do core")
	}
}

func TestVendasEspelhoCoreForaEErroClaroSemCache(t *testing.T) {
	v := novoVendas(t, "espelho", nil)
	v.core.status = 500
	st, c := v.get(t, "de=2026-10-01&ate=2026-10-21", nil)
	if st != 503 || c["error"] != "core_indisponivel" || c["mensagem"] == nil {
		t.Fatalf("st=%d corpo=%v", st, c)
	}
	v.core.status = 0
	if st, c = v.get(t, "de=2026-10-01&ate=2026-10-21", nil); st != 200 || len(c["data"].([]any)) != 3 {
		t.Fatalf("a falha não pode ficar em cache: st=%d %v", st, c)
	}
}

func TestVendasEspelhoCacheDe60s(t *testing.T) {
	v := novoVendas(t, "espelho", nil)
	v.get(t, "de=2026-10-01&ate=2026-10-21", nil)
	n := v.core.chamadas.Load()
	v.get(t, "de=2026-10-01&ate=2026-10-21&loja="+lojaTivoli, &auth.Ator{Tipo: "painel", Modulos: []string{"gestor"}})
	if v.core.chamadas.Load() != n {
		t.Fatalf("o recorte e a pessoa não entram na chave do cache: %d → %d chamadas", n, v.core.chamadas.Load())
	}
	v.agora = v.agora.Add(61 * time.Second)
	v.get(t, "de=2026-10-01&ate=2026-10-21", nil)
	if v.core.chamadas.Load() == n {
		t.Fatalf("depois de 60 s tem de ler de novo")
	}
}
