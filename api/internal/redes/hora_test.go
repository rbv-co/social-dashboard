package redes

import (
	"net/http"
	"strings"
	"testing"

	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
)

// A regra dupla de produção: permissiva (papel admin, super pela FICHA ou meta.hora) E a restritiva
// por conta. Só admin e super veem A1 e A2 (a lista deles é ignorada); horaA1 vê só A1.
func TestPorHora(t *testing.T) {
	m := novoMundo(t, montarHora)
	rotas := []struct{ caminho, a1, a2 string }{
		{"/redes/campanhas-por-hora", `"campaign_id":"9001"`, `"campaign_id":"9002"`},
		{"/redes/anuncios-por-hora", `"ad_id":"7001"`, `"ad_id":"7002"`},
		{"/redes/visitas-por-hora", `"visitas_hora":11`, `"visitas_hora":22`},
	}
	var casos []mundoteste.Caso
	for _, r := range rotas {
		for _, quem := range []string{"adminA1", "superA1"} {
			casos = append(casos,
				mundoteste.Caso{Nome: "A1 de " + quem + " " + r.caminho, Quem: quem, Metodo: "GET", Caminho: r.caminho, Status: 200, Tem: r.a1},
				mundoteste.Caso{Nome: "A2 de " + quem + " " + r.caminho, Quem: quem, Metodo: "GET", Caminho: r.caminho, Status: 200, Tem: r.a2})
		}
		casos = append(casos,
			mundoteste.Caso{Nome: "horaA1 vê A1 " + r.caminho, Quem: "horaA1", Metodo: "GET", Caminho: r.caminho, Status: 200, Tem: r.a1, NaoTem: r.a2},
			mundoteste.Caso{Nome: "sem sessão " + r.caminho, Quem: "", Metodo: "GET", Caminho: r.caminho, Status: 401},
			mundoteste.Caso{Nome: "desativado " + r.caminho, Quem: "desativado", Metodo: "GET", Caminho: r.caminho, Status: 401})
		// Sem meta.hora (ou sem ficha de super): a permissiva nega, a lista é [] e não 403.
		for _, quem := range []string{"todas", "soA1", "nenhuma", "emailA1", "semModulo", "impersonado"} {
			casos = append(casos, mundoteste.Caso{Nome: "negada a " + quem + " " + r.caminho, Quem: quem, Metodo: "GET", Caminho: r.caminho, Status: 200})
			if st, corpo := m.Pedir(t, quem, "GET", r.caminho, ""); st != 200 || strings.TrimSpace(corpo) != "[]" {
				t.Errorf("%s como %s = %d %s, esperava []", r.caminho, quem, st, corpo)
			}
		}
		// IDOR: a conta de fora some igual a conta que não existe, com e sem contar.
		if st, corpo := m.Pedir(t, "horaA1", "GET", r.caminho+"?account_id="+A2, ""); st != 200 || strings.TrimSpace(corpo) != "[]" {
			t.Errorf("IDOR %s = %d %s, esperava []", r.caminho, st, corpo)
		}
		if st, corpo := m.Pedir(t, "horaA1", "GET", r.caminho+"?account_id="+A3, ""); st != 200 || strings.TrimSpace(corpo) != "[]" {
			t.Errorf("conta inexistente %s = %d %s, esperava []", r.caminho, st, corpo)
		}
		for _, q := range []string{"?dia_de=hoje", "?ordem=hora", "?hora=9"} {
			casos = append(casos, mundoteste.Caso{Nome: "400 " + q, Quem: "horaA1", Metodo: "GET", Caminho: r.caminho + q, Status: 400})
		}
	}
	m.Rodar(t, casos)
}

func TestPorHoraOrdemEValores(t *testing.T) {
	m := novoMundo(t, montarHora)
	st, corpo := m.Pedir(t, "horaA1", "GET", "/redes/campanhas-por-hora?account_id="+A1+"&dia_de=2026-10-11", "")
	if st != http.StatusOK {
		t.Fatalf("status %d %s", st, corpo)
	}
	i9, i10 := strings.Index(corpo, `"gasto_hora":12.50`), strings.Index(corpo, `"gasto_hora":7.50`)
	if i9 < 0 || i10 < 0 || i9 > i10 {
		t.Errorf("hora 9 (12.50) antes da 10 (7.50), numeric com duas casas: %s", corpo)
	}
	m.Rodar(t, []mundoteste.Caso{
		{Nome: "anúncios", Quem: "horaA1", Metodo: "GET", Caminho: "/redes/anuncios-por-hora?account_id=" + A1 + "&dia_de=2026-10-11", Status: 200, Tem: `"gasto_hora":3.25,`},
		{Nome: "cliques", Quem: "horaA1", Metodo: "GET", Caminho: "/redes/anuncios-por-hora?account_id=" + A1, Status: 200, Tem: `"cliques_hora":4`},
		{Nome: "visitas", Quem: "horaA1", Metodo: "GET", Caminho: "/redes/visitas-por-hora?account_id=" + A1 + "&dia_de=2026-10-11", Status: 200, Tem: `"visitas_hora":11`},
		{Nome: "dia_de depois dos dados", Quem: "horaA1", Metodo: "GET", Caminho: "/redes/visitas-por-hora?dia_de=2026-10-12", Status: 200, NaoTem: `"visitas_hora"`},
	})
}

func TestPorHoraContagem(t *testing.T) {
	m := novoMundo(t, montarHora)
	for _, c := range []struct{ quem, total string }{{"horaA1", "2"}, {"adminA1", "3"}, {"todas", "0"}} {
		w := m.Resposta(t, c.quem, "GET", "/redes/campanhas-por-hora?contar=1&limite=1", "")
		if w.Code != 200 || w.Header().Get("X-Total-Count") != c.total {
			t.Errorf("%s: %d X-Total-Count=%q, esperava %s", c.quem, w.Code, w.Header().Get("X-Total-Count"), c.total)
		}
	}
}
