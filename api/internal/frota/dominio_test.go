package frota

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

// montarSondas: /eco devolve o Escopo que chegou (FrotaAdmin|SuperFicha|impersonado); /grava passa pelo
// portão da sessão própria; /linha/ecoa o {id} que naLinha fixou.
func montarSondas(r chi.Router, _ *pgxpool.Pool) {
	r.Get("/eco", func(w http.ResponseWriter, r *http.Request) {
		e, a := autz.EscopoDo(r.Context()), auth.AtorDoContexto(r.Context())
		if e == nil || a == nil { // rota fora de ComEscopo/Exigir não pode derrubar o teste com pânico
			http.Error(w, "sem escopo", http.StatusInternalServerError)
			return
		}
		_, _ = fmt.Fprintf(w, "%t|%t|%t", autz.FrotaAdmin(e), e.SuperFicha, a.ImpersonadorID != nil)
	})
	r.With(soSessaoPropria).Post("/grava", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
}

func TestMundoDaFrota(t *testing.T) {
	m := novoMundo(t, montarSondas)
	// igualdade exata, não só "contém": FrotaAdmin|SuperFicha|impersonado
	for quem, quer := range map[string]string{
		"motorista":   "true|false|false",
		"motorista2":  "true|false|false",
		"aprovador":   "true|false|false",
		"superFicha":  "true|true|false",
		"soAprovar":   "false|false|false",
		"patrimonio":  "false|false|false",
		"admin":       "false|false|false",
		"viewer":      "false|false|false",
		"impersonado": "true|false|true",
	} {
		if st, corpo := m.Pedir(t, quem, "GET", "/eco", ""); st != http.StatusOK || corpo != quer {
			t.Errorf("escopo de %s = %d %q, esperava %q", quem, st, corpo, quer)
		}
	}
	// a sessão da conta desativada não vale: nem chega ao Escopo (o Store.Buscar do 5.0 recusa o perfil disabled)
	m.Rodar(t, []caso{
		{Nome: "sem sessão", Quem: "", Metodo: "GET", Caminho: "/eco", Status: http.StatusUnauthorized},
		{Nome: "desativado", Quem: "desativado", Metodo: "GET", Caminho: "/eco", Status: http.StatusUnauthorized},
		{Nome: "ficha C1 na fila do PDF (o gatilho rodou na carga)",
			Efeito: "select count(*)::text from frota_checklist_pdf where checklist_id = '" + C1 + "'", Quer: "1"},
	})
	for _, quem := range semFrota {
		if st, corpo := m.Pedir(t, quem, "GET", "/eco", ""); st != http.StatusOK || !strings.HasPrefix(corpo, "false|") {
			t.Errorf("%s (sem a Frota) = %d %q", quem, st, corpo)
		}
	}
	if f := m.Um(t, fotoDaFrota); f == "<nulo>" || f == "" {
		t.Errorf("foto do mundo vazia: %q", f)
	}
}

// A foto enxerga TODA tabela frota_* do esquema (e os bens do Patrimônio, que os gatilhos espelham): rota
// nova do 5.3 que grave numa tabela fora da foto passaria despercebida pelo "negado não grava".
func TestFotoDaFrotaCobreTodasAsTabelas(t *testing.T) {
	m := novoMundo(t)
	rows, err := m.P.Query(t.Context(), `select table_name::text from information_schema.tables
		where table_schema = 'public' and table_type = 'BASE TABLE' and table_name like 'frota\_%' order by 1`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var n int
	for rows.Next() {
		var tab string
		if err := rows.Scan(&tab); err != nil {
			t.Fatal(err)
		}
		n++
		if !strings.Contains(fotoDaFrota, " from "+tab+" t") {
			t.Errorf("a foto não enxerga %s", tab)
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if n != 14 {
		t.Errorf("%d tabelas frota_* no esquema, esperava 14", n)
	}
	if !strings.Contains(fotoDaFrota, " from patrimonio_bens t") {
		t.Error("a foto não enxerga patrimonio_bens")
	}
	// e a foto muda quando uma linha muda (não é um hash constante)
	antes := m.Um(t, fotoDaFrota)
	if _, err := m.P.Exec(t.Context(), `update frota_veiculos set nome = 'Gol 2' where id = $1`, V1); err != nil {
		t.Fatal(err)
	}
	if depois := m.Um(t, fotoDaFrota); depois == antes {
		t.Error("a foto não mudou com a linha")
	}
}

func TestSoSessaoPropria(t *testing.T) {
	chamou := false
	h := soSessaoPropria(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		chamou = true
		w.WriteHeader(http.StatusNoContent)
	}))
	pedir := func(a *auth.Ator) *httptest.ResponseRecorder {
		chamou = false
		r := httptest.NewRequest("POST", "/x", nil)
		if a != nil {
			r = r.WithContext(auth.NoContexto(r.Context(), a))
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	if w := pedir(nil); w.Code != http.StatusForbidden || chamou {
		t.Errorf("sem ator = %d (chamou=%v), esperava 403 sem chamar", w.Code, chamou)
	}
	if w := pedir(&auth.Ator{ID: idMotorista}); w.Code != http.StatusNoContent || !chamou {
		t.Errorf("ator próprio = %d (chamou=%v), esperava 204", w.Code, chamou)
	}
	por := idSuperFicha
	w := pedir(&auth.Ator{ID: idMotorista, ImpersonadorID: &por})
	if w.Code != http.StatusForbidden || chamou || !strings.Contains(w.Body.String(), "Quem entrou como outra pessoa") ||
		!strings.Contains(w.Body.String(), dados.FraseEntrarComo) {
		t.Errorf("impersonado = %d %s (chamou=%v)", w.Code, w.Body.String(), chamou)
	}
	// e no mundo de verdade, atrás de auth.Exigir → ComEscopo
	m := novoMundo(t, montarSondas)
	m.Rodar(t, []caso{
		{Nome: "sessão própria", Quem: "motorista", Metodo: "POST", Caminho: "/grava", Status: http.StatusNoContent},
		{Nome: "entrou como", Quem: "impersonado", Metodo: "POST", Caminho: "/grava", Status: http.StatusForbidden, Tem: "Quem entrou como outra pessoa"},
		{Nome: "sem sessão", Quem: "", Metodo: "POST", Caminho: "/grava", Status: http.StatusUnauthorized},
	})
}

func TestIdDaLinha(t *testing.T) {
	for _, c := range []struct {
		linha, quer string
		erro        bool
	}{
		{`{"id":"x","a":1}`, "x", false},
		{`{"id":"x"}`, "x", false},
		{`{}`, "", true},
		{`{"id":""}`, "", true},
		{`lixo`, "", true},
		{``, "", true},
	} {
		got, err := idDaLinha([]byte(c.linha))
		if (err != nil) != c.erro || got != c.quer {
			t.Errorf("idDaLinha(%q) = %q, %v", c.linha, got, err)
		}
	}
}

func TestVazio(t *testing.T) {
	for v, quer := range map[string]bool{"": true, "null": true, `""`: false, "0": false, "false": false, "{}": false, "[]": false} {
		if got := vazio(json.RawMessage(v)); got != quer {
			t.Errorf("vazio(%q) = %v", v, got)
		}
	}
	if !vazio(nil) {
		t.Error("vazio(nil)")
	}
}

func TestNaLinha(t *testing.T) {
	r := chi.NewRouter()
	r.Post("/config", naLinha("true", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(chi.URLParam(r, "id")))
	}))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest("POST", "/config", nil))
	if w.Body.String() != "true" {
		t.Errorf("id = %q", w.Body.String())
	}
}

func TestDeve(t *testing.T) {
	deve(nil)
	defer func() {
		if recover() == nil {
			t.Error("deve(err) tem de entrar em pânico")
		}
	}()
	deve(fmt.Errorf("rota errada"))
}
