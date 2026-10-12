package acesso

import (
	"net/http"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
)

// Toda escrita do 5.1 recusa a sessão de "entrar como", sem tocar no banco (Ruling 5.1-4). A varredura
// anda pelas rotas de Montar: escrita nova sem soSessaoPropria (ou fora da conta) faz o teste falhar.
func TestEscritasRecusamImpersonado(t *testing.T) {
	m := novoMundo(t, Montar)
	antes := m.um(t, fotoDoMundo)
	n := 0
	err := chi.Walk(m.h.(chi.Routes), func(metodo, rota string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		if metodo == http.MethodGet {
			return nil
		}
		n++
		st, corpo := m.pedir(t, "impersonado", metodo, strings.ReplaceAll(rota, "{id}", mVendT1), `{}`)
		if st != http.StatusForbidden || !strings.Contains(corpo, "Quem entrou como outra pessoa") || !strings.Contains(corpo, "sem_permissao") {
			t.Errorf("%s %s como impersonado = %d %s", metodo, rota, st, corpo)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if n != 19 {
		t.Errorf("escritas = %d, esperava 19 (rota de escrita nova? ponha soSessaoPropria e conte aqui)", n)
	}
	if depois := m.um(t, fotoDoMundo); depois != antes {
		t.Error("o impersonado mudou o banco")
	}
}

// Ruling 5.1-14: /saude/ia-execucoes é do 5.12 (/status-ia/execucoes); o 5.1 não monta a rota.
func TestMontarNaoTemIAExecucoes(t *testing.T) {
	m := novoMundo(t, Montar)
	if st, corpo := m.pedir(t, "admin", "GET", "/saude/ia-execucoes", ""); st != http.StatusNotFound {
		t.Errorf("GET /saude/ia-execucoes = %d %s, esperava 404 (a rota é do 5.12)", st, corpo)
	}
	if st, _ := m.pedir(t, "admin", "GET", "/saude/conferencias", ""); st != http.StatusOK {
		t.Errorf("GET /saude/conferencias = %d, esperava 200", st)
	}
}
