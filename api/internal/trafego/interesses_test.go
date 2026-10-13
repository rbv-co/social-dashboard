package trafego

import (
	"strings"
	"testing"
)

func TestInteresses(t *testing.T) {
	m := novoMundo(t, montarInteresses)
	const rota = "/gestao-trafego/interesses-sugeridos"
	for _, c := range []struct {
		nome, quem, caminho string
		st, linhas          int
		tem, naoTem         string
	}{
		{"gestorA1 sem filtro: as duas, a de M2 sem conta", "gestorA1", rota, 200, 2, `"account_id":null`, A2},
		{"gestorA1 vê a conta de M1", "gestorA1", rota, 200, 2, `"account_id":"` + A1 + `"`, A2},
		{"gestorA1 filtra A1", "gestorA1", rota + "?account_id=" + A1, 200, 1, `"marca_id":"` + M1 + `"`, M2},
		{"gestorA1 filtra A2: marca invisível nunca casa", "gestorA1", rota + "?account_id=" + A2, 200, 0, "", "Bolsas"},
		{"gestorA1 contar=1", "gestorA1", rota + "?account_id=" + A2 + "&contar=1", 200, 0, "", "Bolsas"},
		{"gestorTodas filtra A2", "gestorTodas", rota + "?account_id=" + A2, 200, 1, `"account_id":"` + A2 + `"`, M1},
		{"marca_id e objetivo (como a fábrica)", "gestorA1", rota + "?marca_id=" + M2 + "&objetivo=seguidores", 200, 1, `"account_id":null`, A2},
		{"objetivo sem linha", "gestorTodas", rota + "?objetivo=vendas", 200, 0, "", ""},
		{"semModulo lê", "semModulo", rota, 200, 2, "", ""},
		{"marca_id inválido", "gestorA1", rota + "?marca_id=x", 400, 0, "", ""},
		{"sem sessão", "", rota, 401, 0, "", ""},
	} {
		st, corpo := m.Pedir(t, c.quem, "GET", c.caminho, "")
		if st != c.st || (st == 200 && strings.Count(corpo, `"marca_id"`) != c.linhas) ||
			!strings.Contains(corpo, c.tem) || (c.naoTem != "" && strings.Contains(corpo, c.naoTem)) {
			t.Errorf("%s: %d %s", c.nome, st, corpo)
		}
	}
	// o vazamento: a lista de gestorA1 não carrega o uuid de A2 em lugar nenhum, nem com contar=1
	w := m.Resposta(t, "gestorA1", "GET", rota+"?contar=1", "")
	if w.Header().Get("X-Total-Count") != "2" || strings.Contains(w.Body.String(), A2) {
		t.Errorf("contar=1: total %q, corpo %s", w.Header().Get("X-Total-Count"), w.Body.String())
	}
}
