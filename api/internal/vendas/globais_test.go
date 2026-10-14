package vendas

import (
	"net/http"
	"strings"
	"testing"
)

// Leituras de policy `true` em produção: toda sessão as lê (paridade; achado 2 do plano).
func TestLeiturasGlobais(t *testing.T) {
	m := novoMundo(t, montarGlobais)
	pedir := func(quem, caminho string) (int, string) { return m.Pedir(t, quem, http.MethodGet, caminho, "") }
	if st, c := pedir("viewer", "/comercial/depositos"); st != 200 || chaves(t, c, "deposito_id") != "11,12,13,99" {
		t.Errorf("depósitos = %d %s", st, c)
	}
	if st, c := pedir("viewer", "/comercial/depositos?ordem=nome&limite=1"); st != 200 || !strings.Contains(c, "Depósito Atacado") {
		t.Errorf("depósitos por nome = %d %s", st, c)
	}
	if st, c := pedir("viewer", "/comercial/briefings?limite=1"); st != 200 || chaves(t, c, "id") != B2 {
		t.Errorf("briefing mais novo = %d %s", st, c)
	}
	if st, c := pedir("viewer", "/comercial/briefings?ordem=created_at.asc&limite=1"); st != 200 || chaves(t, c, "id") != B1 {
		t.Errorf("briefing mais velho = %d %s", st, c)
	}
	if st, c := pedir("viewer", "/comercial/briefings?rodada=x"); st != http.StatusBadRequest {
		t.Errorf("filtro desconhecido = %d %s", st, c)
	}
	if st, _ := pedir("", "/comercial/depositos"); st != http.StatusUnauthorized {
		t.Errorf("sem sessão = %d", st)
	}
}
