package publico

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

const segredoDoCore = "segredo-do-core-de-teste"

// mundo: o esquema de produção da fatia (tabelas, funções e gatilhos verbatim) e as rotas montadas SEM sessão de painel.
type mundo struct {
	P *pgxpool.Pool
	S *Servico
	H http.Handler
}

func novoMundo(t *testing.T, ajusta ...func(*Servico)) *mundo {
	t.Helper()
	p := testebanco.ComEsquemaDeProducao(t)
	s := &Servico{Pool: p, Segredo: segredoDoCore, Origens: []string{"https://vesselbrasil.com.br"}}
	for _, f := range ajusta {
		f(s)
	}
	r := chi.NewRouter()
	s.Montar(r)
	return &mundo{P: p, S: s, H: r}
}

// pedido: POST JSON com cabeçalhos extras ("Nome: valor"). Endereço de origem é o do nginx local (loopback): só assim o
// X-Real-IP vale, como em produção.
func (m *mundo) pedido(t testing.TB, caminho, corpo string, cab ...string) (int, string, http.Header) {
	t.Helper()
	r := httptest.NewRequest("POST", caminho, strings.NewReader(corpo))
	r.RemoteAddr = "127.0.0.1:5555"
	r.Header.Set("Content-Type", "application/json")
	for _, c := range cab {
		k, v, _ := strings.Cut(c, ": ")
		r.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	m.H.ServeHTTP(w, r)
	return w.Code, strings.TrimSpace(w.Body.String()), w.Header()
}

func (m *mundo) um(t testing.TB, sql string, args ...any) string {
	t.Helper()
	var v *string
	if err := m.P.QueryRow(t.Context(), sql, args...).Scan(&v); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
	if v == nil {
		return ""
	}
	return *v
}

var comCore = "Authorization: Bearer " + segredoDoCore
