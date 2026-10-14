package vendas

import (
	"net/http"
	"slices"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
)

// leiturasGlobais: as leituras SEM restritiva em produção (policy true ou auth.role() = 'authenticated'):
// toda sessão lê tudo, como pelo PostgREST (Ruling 5.5-5; achado 2 para o dono). As com restritiva estão
// em casosDeEscopo (Task 4).
var leiturasGlobais = []string{"/comercial/lojas", "/comercial/depositos", "/comercial/metas-lojas",
	"/comercial/metas-vendedoras", "/comercial/vendedoras", "/comercial/pedidos-vendedor", "/comercial/briefings"}

// Toda escrita do 5.5 recusa a sessão de "entrar como", sem tocar no banco (Ruling 5.5-8).
func TestEscritasRecusamImpersonado(t *testing.T) {
	m := novoMundo(t, Montar)
	antes := m.Um(t, fotoDoComercial)
	n := 0
	err := chi.Walk(m.H.(chi.Routes), func(metodo, rota string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		if metodo == http.MethodGet {
			return nil
		}
		n++
		st, corpo := m.Pedir(t, "impersonado", metodo, strings.ReplaceAll(rota, "{id}", "1"), `{}`)
		if st != http.StatusForbidden || !strings.Contains(corpo, "Quem entrou como outra pessoa") {
			t.Errorf("%s %s como impersonado = %d %s", metodo, rota, st, corpo)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if n != 4 {
		t.Errorf("escritas = %d, esperava 4 (rota de escrita nova? ponha soSessaoPropria e conte aqui)", n)
	}
	if m.Um(t, fotoDoComercial) != antes {
		t.Error("o impersonado mudou o banco")
	}
}

// Toda leitura montada tem a matriz de escopo (restritiva de produção) ou está declarada global; uma
// leitura nova sem nenhum dos dois faz o teste falhar.
func TestTodaLeituraTemEscopoDeclarado(t *testing.T) {
	m := novoMundo(t, Montar)
	n := 0
	err := chi.Walk(m.H.(chi.Routes), func(metodo, rota string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		if metodo != http.MethodGet {
			return nil
		}
		n++
		if _, ok := casosDeEscopo[rota]; ok {
			return nil // provada pessoa a pessoa em TestNadaVazaEntreLojas
		}
		if !slices.Contains(leiturasGlobais, rota) {
			t.Errorf("leitura sem matriz de escopo e não declarada global: %s", rota)
			return nil
		}
		if st, corpo := m.Pedir(t, "viewer", http.MethodGet, rota, ""); st != http.StatusOK || strings.TrimSpace(corpo) == "[]" {
			t.Errorf("global %s como viewer = %d %s (paridade: toda sessão lê)", rota, st, corpo)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if n != 14 || len(casosDeEscopo)+len(leiturasGlobais) != 14 {
		t.Errorf("leituras = %d (casos %d + globais %d), esperava 14", n, len(casosDeEscopo), len(leiturasGlobais))
	}
}

// Quem não pode gravar não grava NADA, pelo handler real (403 e banco intacto); uma escrita nova sem caso
// faz o teste falhar.
func TestNadaGravaQuemNaoPode(t *testing.T) {
	m := novoMundo(t, Montar)
	antes := m.Um(t, fotoDoComercial)
	escritas := map[string]struct {
		caminho, corpo string
		negados        []string
	}{
		"PATCH /comercial/lojas/{id}": {"/comercial/lojas/2", `{"fechado_em":"2026-08-31"}`,
			[]string{"admin", "semTrava", "vendT1", "estT1", "gestorT2", "supervG1", "viewer"}},
		"POST /comercial/metas/salvar": {"/comercial/metas/salvar", `{"ano":2026,"mes":10,"lojas":{"gravar":[{"loja_id":1,"meta_valor":1}]}}`,
			[]string{"super", "semTrava", "vendT1", "estT1", "gestorT2", "supervG1", "viewer"}},
		"POST /comercial/vendedoras/gravar": {"/comercial/vendedoras/gravar", `{"linhas":[{"vendor_id":7,"nome":"Intrusa"}]}`,
			[]string{"semTrava", "viewer"}},
		"POST /comercial/pedidos-vendedor/gravar": {"/comercial/pedidos-vendedor/gravar", `{"linhas":[{"pedido_id":101,"vendor_id":8}]}`,
			[]string{"semTrava", "viewer"}},
	}
	n := 0
	err := chi.Walk(m.H.(chi.Routes), func(metodo, rota string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		if metodo == http.MethodGet {
			return nil
		}
		n++
		e, ok := escritas[metodo+" "+rota]
		if !ok {
			t.Errorf("escrita sem caso de recusa: %s %s", metodo, rota)
			return nil
		}
		for _, quem := range e.negados {
			if st, corpo := m.Pedir(t, quem, metodo, e.caminho, e.corpo); st != http.StatusForbidden {
				t.Errorf("%s %s como %s = %d %s; esperava 403", metodo, e.caminho, quem, st, corpo)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if n != len(escritas) {
		t.Errorf("escritas = %d, casos = %d", n, len(escritas))
	}
	if m.Um(t, fotoDoComercial) != antes {
		t.Error("quem não pode gravar mudou o banco")
	}
}
