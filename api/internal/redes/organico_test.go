package redes

import (
	"strings"
	"testing"

	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
)

var rotasDoOrganico = []string{"seguidores", "leituras-de-seguidores", "engajamento", "conteudo"}

func TestOrganico(t *testing.T) {
	m := novoMundo(t, montarOrganico)
	var casos []mundoteste.Caso

	// matriz por conta, nas quatro rotas
	for _, rota := range rotasDoOrganico {
		cam := "/redes/" + rota
		for _, q := range []string{"todas", "adminA1", "superA1", "semModulo"} {
			casos = append(casos, mundoteste.Caso{Nome: rota + " vê as duas: " + q, Quem: q, Metodo: "GET", Caminho: cam, Status: 200, Tem: A2})
		}
		for _, q := range []string{"soA1", "emailA1", "horaA1", "impersonado"} {
			casos = append(casos,
				mundoteste.Caso{Nome: rota + " só A1: " + q, Quem: q, Metodo: "GET", Caminho: cam, Status: 200, Tem: A1, NaoTem: A2},
				// IDOR: a conta de fora responde como conta inexistente
				mundoteste.Caso{Nome: rota + " IDOR lista: " + q, Quem: q, Metodo: "GET", Caminho: cam + "?account_id=" + A2, Status: 200, Tem: "[]"},
				mundoteste.Caso{Nome: rota + " IDOR contagem: " + q, Quem: q, Metodo: "GET", Caminho: cam + "?account_id=" + A2 + "&contar=1&limite=1", Status: 200, Tem: "[]"})
		}
		casos = append(casos,
			mundoteste.Caso{Nome: rota + " nenhuma", Quem: "nenhuma", Metodo: "GET", Caminho: cam, Status: 200, Tem: "[]", NaoTem: A1},
			mundoteste.Caso{Nome: rota + " desativado", Quem: "desativado", Metodo: "GET", Caminho: cam, Status: 401},
			mundoteste.Caso{Nome: rota + " sem sessão", Quem: "", Metodo: "GET", Caminho: cam, Status: 401},
			mundoteste.Caso{Nome: rota + " limite", Quem: "todas", Metodo: "GET", Caminho: cam + "?limite=1001", Status: 400},
			mundoteste.Caso{Nome: rota + " conta inválida", Quem: "todas", Metodo: "GET", Caminho: cam + "?account_id=x", Status: 400},
			mundoteste.Caso{Nome: rota + " ordem fora da lista", Quem: "todas", Metodo: "GET", Caminho: cam + "?ordem=followers_count", Status: 400})
	}

	casos = append(casos,
		// filtros e ordens
		mundoteste.Caso{Nome: "seguidores de", Quem: "todas", Metodo: "GET", Caminho: "/redes/seguidores?account_id=" + A1 + "&captured_at_de=2026-10-11", Status: 200, Tem: `"followers_count":1004`, NaoTem: `"followers_count":1000`},
		mundoteste.Caso{Nome: "seguidores desc", Quem: "todas", Metodo: "GET", Caminho: "/redes/seguidores?account_id=" + A1 + "&ordem=captured_at.desc&limite=1", Status: 200, Tem: `"followers_count":1004`, NaoTem: `"followers_count":1000`},
		mundoteste.Caso{Nome: "leituras", Quem: "soA1", Metodo: "GET", Caminho: "/redes/leituras-de-seguidores?account_id=" + A1 + "&lido_em_de=2026-10-11T00:00:00Z&ordem=lido_em", Status: 200, Tem: `"origem":"hora"`},
		mundoteste.Caso{Nome: "leituras depois do instante", Quem: "soA1", Metodo: "GET", Caminho: "/redes/leituras-de-seguidores?lido_em_de=2026-10-11T12:00:01Z", Status: 200, Tem: "[]"},
		mundoteste.Caso{Nome: "engajamento", Quem: "soA1", Metodo: "GET", Caminho: "/redes/engajamento?account_id=" + A1 + "&period_days=7&captured_at_ate=2026-10-11&ordem=captured_at.desc&limite=1", Status: 200, Tem: `"reach":100`, NaoTem: `"reach":20,`},
		mundoteste.Caso{Nome: "conteúdo", Quem: "soA1", Metodo: "GET", Caminho: "/redes/conteudo?captured_at=2026-10-11&period_days_ate=1&ordem=period_days", Status: 200, Tem: `"story_replies":4`, NaoTem: A2},
		// 400
		mundoteste.Caso{Nome: "period_days texto", Quem: "todas", Metodo: "GET", Caminho: "/redes/engajamento?period_days=sete", Status: 400},
		mundoteste.Caso{Nome: "captured_at texto", Quem: "todas", Metodo: "GET", Caminho: "/redes/seguidores?captured_at=ontem", Status: 400},
		mundoteste.Caso{Nome: "instante sem hora", Quem: "todas", Metodo: "GET", Caminho: "/redes/leituras-de-seguidores?lido_em_de=2026-10-11", Status: 400},
	)
	m.Rodar(t, casos)

	// ordem do conteúdo: period 0 antes de 1
	_, corpo := m.Pedir(t, "soA1", "GET", "/redes/conteudo?captured_at=2026-10-11&period_days_ate=1&ordem=period_days", "")
	if i0, i1 := strings.Index(corpo, `"period_days":0`), strings.Index(corpo, `"period_days":1`); i0 < 0 || i1 < 0 || i0 > i1 {
		t.Errorf("conteúdo fora de ordem: %s", corpo)
	}
	if n := strings.Count(corpo, `"account_id"`); n != 2 {
		t.Errorf("conteúdo de soA1 = %d linhas, esperava 2: %s", n, corpo)
	}

	// contagem: X-Total-Count respeita o recorte por conta
	for _, c := range []struct{ quem, caminho, total string }{
		{"todas", "/redes/seguidores?captured_at=2026-10-11&contar=1&limite=1", "2"},
		{"soA1", "/redes/seguidores?captured_at=2026-10-11&contar=1&limite=1", "1"},
		{"soA1", "/redes/seguidores?account_id=" + A2 + "&contar=1&limite=1", "0"},
		{"soA1", "/redes/leituras-de-seguidores?account_id=" + A2 + "&contar=1&limite=1", "0"},
		{"soA1", "/redes/engajamento?account_id=" + A2 + "&contar=1&limite=1", "0"},
		{"soA1", "/redes/conteudo?account_id=" + A2 + "&contar=1&limite=1", "0"},
		{"todas", "/redes/engajamento?captured_at=2026-10-11&contar=1&limite=1", "3"},
		{"soA1", "/redes/conteudo?captured_at=2026-10-11&contar=1&limite=1", "2"},
	} {
		w := m.Resposta(t, c.quem, "GET", c.caminho, "")
		if got := w.Header().Get("X-Total-Count"); w.Code != 200 || got != c.total {
			t.Errorf("%s %s: %d, X-Total-Count %q, esperava %q", c.quem, c.caminho, w.Code, got, c.total)
		}
	}
}
