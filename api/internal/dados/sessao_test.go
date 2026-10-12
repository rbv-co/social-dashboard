package dados

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/rbv-co/social-dashboard/api/internal/auth"
)

func TestSoSessaoPropria(t *testing.T) {
	chamou := false
	h := SoSessaoPropria("Só a própria sessão grava.")(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		chamou = true
		w.WriteHeader(http.StatusNoContent)
	}))
	por := "11111111-0000-4000-a000-000000000009"
	for _, c := range []struct {
		nome   string
		ator   *auth.Ator
		status int
	}{
		{"sem ator", nil, http.StatusForbidden},
		{"sessão própria", &auth.Ator{ID: "11111111-0000-4000-a000-000000000001"}, http.StatusNoContent},
		{"entrou como outra pessoa", &auth.Ator{ID: "11111111-0000-4000-a000-000000000001", ImpersonadorID: &por}, http.StatusForbidden},
	} {
		chamou = false
		r := httptest.NewRequest("POST", "/x", nil)
		if c.ator != nil {
			r = r.WithContext(auth.NoContexto(r.Context(), c.ator))
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		negado := c.status == http.StatusForbidden
		if w.Code != c.status || chamou == negado || (negado && !strings.Contains(w.Body.String(), "Só a própria sessão grava.")) {
			t.Errorf("%s: %d %s (handler rodou: %v)", c.nome, w.Code, w.Body, chamou)
		}
	}
}
