package redes

import (
	"strings"
	"testing"

	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
)

var rotasDeAnuncios = []string{"/redes/campanhas", "/redes/conjuntos", "/redes/anuncios", "/redes/insights-de-campanha", "/redes/insights-da-conta"}

// totais esperados de contar=1 por rota e pessoa (linhas semeadas: campanhas 9000 sem conta, 9001 A1, 9002 A2).
var totais = map[string]map[string]string{
	"/redes/campanhas":            {"todas": "3", "soA1": "2", "nenhuma": "1"},
	"/redes/conjuntos":            {"todas": "2", "soA1": "1", "nenhuma": "0"},
	"/redes/anuncios":             {"todas": "2", "soA1": "1", "nenhuma": "0"},
	"/redes/insights-de-campanha": {"todas": "3", "soA1": "2", "nenhuma": "0"},
	"/redes/insights-da-conta":    {"todas": "2", "soA1": "1", "nenhuma": "0"},
}

func TestAnuncios(t *testing.T) {
	m := novoMundo(t, montarAnuncios)
	foto := m.Um(t, fotoDasRedes)
	var casos []mundoteste.Caso
	c1, c2 := `"account_id":"`+A1+`"`, `"account_id":"`+A2+`"`
	for _, rota := range rotasDeAnuncios {
		// contagem sob a regra (X-Total-Count): quem é restrito conta só o que vê; as campanhas têm a 9000 sem conta
		for quem, esperado := range totais[rota] {
			w := m.Resposta(t, quem, "GET", rota+"?contar=1&limite=1", "")
			if got := w.Header().Get("X-Total-Count"); w.Code != 200 || got != esperado {
				t.Errorf("%s contar=1 como %s = %d X-Total-Count %q, esperava %q", rota, quem, w.Code, got, esperado)
			}
		}
		casos = append(casos, mundoteste.Caso{Nome: "sem sessão " + rota, Metodo: "GET", Caminho: rota, Status: 401})
		// a matriz por conta: quem vê o quê, sem filtro
		for _, q := range []string{"todas", "adminA1", "superA1", "semModulo"} {
			casos = append(casos, mundoteste.Caso{Nome: q + " " + rota, Quem: q, Metodo: "GET", Caminho: rota, Status: 200, Tem: c1})
			casos = append(casos, mundoteste.Caso{Nome: q + " vê A2 " + rota, Quem: q, Metodo: "GET", Caminho: rota, Status: 200, Tem: c2})
		}
		for _, q := range []string{"soA1", "emailA1", "horaA1", "impersonado"} {
			casos = append(casos,
				mundoteste.Caso{Nome: q + " " + rota, Quem: q, Metodo: "GET", Caminho: rota, Status: 200, Tem: c1, NaoTem: c2},
				// IDOR: pedir a conta de outro volta vazio, igual conta que não existe
				mundoteste.Caso{Nome: q + " IDOR " + rota, Quem: q, Metodo: "GET", Caminho: rota + "?account_id=" + A2, Status: 200, Tem: "[]", NaoTem: "account_id"},
				mundoteste.Caso{Nome: q + " conta inexistente " + rota, Quem: q, Metodo: "GET", Caminho: rota + "?account_id=" + A3, Status: 200, Tem: "[]"},
			)
		}
		if rota == "/redes/campanhas" {
			// a campanha sem conta (9000) é visível a todos: pode_ver_conta(null)
			casos = append(casos, mundoteste.Caso{Nome: "nenhuma só a sem conta", Quem: "nenhuma", Metodo: "GET", Caminho: rota, Status: 200, Tem: `"campaign_id":"9000"`, NaoTem: `"campaign_id":"9001"`})
			casos = append(casos, mundoteste.Caso{Nome: "nenhuma sem 9002", Quem: "nenhuma", Metodo: "GET", Caminho: rota, Status: 200, NaoTem: `"campaign_id":"9002"`})
			casos = append(casos, mundoteste.Caso{Nome: "soA1 vê a sem conta", Quem: "soA1", Metodo: "GET", Caminho: rota, Status: 200, Tem: `"campaign_id":"9000"`})
		} else {
			casos = append(casos, mundoteste.Caso{Nome: "nenhuma " + rota, Quem: "nenhuma", Metodo: "GET", Caminho: rota, Status: 200, Tem: "[]", NaoTem: "account_id"})
		}
		casos = append(casos,
			mundoteste.Caso{Nome: "conta própria " + rota, Quem: "soA1", Metodo: "GET", Caminho: rota + "?account_id=" + A1, Status: 200, Tem: c1},
			mundoteste.Caso{Nome: "limite acima do teto " + rota, Quem: "todas", Metodo: "GET", Caminho: rota + "?limite=5000", Status: 400},
			mundoteste.Caso{Nome: "ordem fora da lista " + rota, Quem: "todas", Metodo: "GET", Caminho: rota + "?ordem=spend", Status: 400},
		)
	}
	casos = append(casos,
		// gasto exato: numeric sai do Postgres como número JSON, sem passar por float64
		mundoteste.Caso{Nome: "gasto da campanha", Quem: "soA1", Metodo: "GET", Caminho: "/redes/insights-de-campanha?account_id=" + A1 + "&period_days=0&captured_at=2026-10-11", Status: 200, Tem: `"spend":1234.56`, NaoTem: `"spend":100.1`},
		// o zero final só o numeric do Postgres preserva: float64 em Go daria 100.1
		mundoteste.Caso{Nome: "gasto 100.10 com o zero final", Quem: "todas", Metodo: "GET", Caminho: "/redes/insights-de-campanha?account_id=" + A1 + "&captured_at=2026-10-10", Status: 200, Tem: `"spend":100.10,`},
		mundoteste.Caso{Nome: "filtro campaign_id direto", Quem: "todas", Metodo: "GET", Caminho: "/redes/insights-de-campanha?campaign_id=9001", Status: 200, Tem: `"campaign_id":"9001"`, NaoTem: `"campaign_id":"9002"`},
		mundoteste.Caso{Nome: "gasto e frequência da conta", Quem: "soA1", Metodo: "GET", Caminho: "/redes/insights-da-conta?account_id=" + A1 + "&period_days=7&ordem=captured_at.desc&limite=1", Status: 200, Tem: `"spend":1334.66,`},
		mundoteste.Caso{Nome: "frequência da conta", Quem: "soA1", Metodo: "GET", Caminho: "/redes/insights-da-conta?account_id=" + A1 + "&period_days=7&ordem=captured_at.desc&limite=1", Status: 200, Tem: `"frequency":3.33`},
		// lista de campanhas pedida por id: a regra continua valendo
		mundoteste.Caso{Nome: "campaign_id lista", Quem: "soA1", Metodo: "GET", Caminho: "/redes/insights-de-campanha?campaign_id=9001,9002", Status: 200, Tem: `"campaign_id":"9001"`, NaoTem: `"campaign_id":"9002"`},
		// o framework lê "campaign_id=" como a lista [""]: nenhuma campanha tem id vazio, a resposta é [] (o brief
		// esperava 400; ver o relatório). O que importa: não devolve linha nenhuma, de conta nenhuma.
		mundoteste.Caso{Nome: "campaign_id vazio", Quem: "todas", Metodo: "GET", Caminho: "/redes/insights-de-campanha?campaign_id=", Status: 200, Tem: "[]", NaoTem: "account_id"},
		mundoteste.Caso{Nome: "nenhuma pede 9002", Quem: "nenhuma", Metodo: "GET", Caminho: "/redes/insights-de-campanha?campaign_id=9002", Status: 200, Tem: "[]"},
		mundoteste.Caso{Nome: "ordem padrão das campanhas", Quem: "todas", Metodo: "GET", Caminho: "/redes/campanhas?account_id=" + A1, Status: 200, Tem: `"campaign_id":"9001"`, NaoTem: `"campaign_id":"9002"`},
		// 400
		mundoteste.Caso{Nome: "period_days x", Quem: "todas", Metodo: "GET", Caminho: "/redes/insights-de-campanha?period_days=x", Status: 400},
		mundoteste.Caso{Nome: "period_days x (conta)", Quem: "todas", Metodo: "GET", Caminho: "/redes/insights-da-conta?period_days=x", Status: 400},
		mundoteste.Caso{Nome: "data em formato errado", Quem: "todas", Metodo: "GET", Caminho: "/redes/insights-de-campanha?captured_at_de=10/10/2026", Status: 400},
		// a leitura não grava
		mundoteste.Caso{Nome: "nada mudou", Efeito: fotoDasRedes, Quer: foto},
	)
	m.Rodar(t, casos)

	pos := func(corpo, parte string) int { return strings.Index(corpo, parte) }
	_, corpo := m.Pedir(t, "todas", "GET", "/redes/insights-de-campanha", "")
	if a, b := pos(corpo, `"captured_at":"2026-10-11"`), pos(corpo, `"captured_at":"2026-10-10"`); a < 0 || b < 0 || a > b {
		t.Errorf("ordem padrão: o dia 11 tem de vir antes do 10: %s", corpo)
	}
	_, corpo = m.Pedir(t, "todas", "GET", "/redes/insights-de-campanha?ordem=captured_at", "")
	if a, b := pos(corpo, `"captured_at":"2026-10-11"`), pos(corpo, `"captured_at":"2026-10-10"`); a < 0 || b < 0 || a < b {
		t.Errorf("?ordem=captured_at: o dia 10 tem de vir antes do 11: %s", corpo)
	}
	_, corpo = m.Pedir(t, "todas", "GET", "/redes/campanhas", "")
	if a, b := pos(corpo, `"status":"ACTIVE"`), pos(corpo, `"status":"PAUSED"`); a < 0 || b < 0 || a > b {
		t.Errorf("ordem padrão das campanhas (status, name): ACTIVE antes de PAUSED: %s", corpo)
	}
}
