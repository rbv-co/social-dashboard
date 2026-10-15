package fabrica

import (
	"net/http"
	"testing"

	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
)

// Plano 03-A/B: oito pedidos juntos do próximo lote do MESMO job: um 201 e sete 200, todos devolvem o
// MESMO job novo e existe um job só com aquela continuação. A trava é o for update no job de origem
// (não há índice único: sem ele os oito inserem).
func TestOitoProximoLoteSimultaneosCriamUmJobSo(t *testing.T) {
	m := mundoRobo(t)
	m.Atrasar(t, "fabrica_jobs", "insert", 50)
	st := make([]int, 8)
	corpo := make([]string, 8)
	mundoteste.EmParalelo(len(st), func(i int) {
		st[i], corpo[i] = m.Pedir(t, "robo", "POST", "/fabrica/robo/jobs/"+J1+"/proximo-lote", "")
	})
	criados, ok := 0, 0
	for _, s := range st {
		switch s {
		case http.StatusCreated:
			criados++
		case http.StatusOK:
			ok++
		}
	}
	if criados != 1 || ok != 7 {
		t.Errorf("status %v, esperava um 201 e sete 200 (%s)", st, corpo[0])
	}
	if v := m.Um(t, `select count(*)::text from fabrica_jobs where tipo = 'gerar' and params->>'continuacao' = '1'`); v != "1" {
		t.Errorf("%s jobs com continuacao 1, esperava 1", v)
	}
	novo := m.Um(t, `select id::text from fabrica_jobs where tipo = 'gerar' and params->>'continuacao' = '1'`)
	for i := range corpo {
		if st[i] == http.StatusOK || st[i] == http.StatusCreated {
			if want := `{"job_id":"` + novo + `"}`; corpo[i] != want && corpo[i] != want+"\n" {
				t.Errorf("pedido %d devolveu %s, esperava %s", i, corpo[i], want)
			}
		}
	}
}

// Plano 03-B: oito "apagar campanha" juntos da MESMA rodada em geração: todos 200 e o run do GitHub é
// cancelado UMA vez (efeito externo não duplica). A trava é o for update na campanha: sem ele os oito
// leem a rodada viva e os oito cancelam o run.
func TestOitoApagarSimultaneosCancelamORunUmaVez(t *testing.T) {
	g, gh := novoGHApagar(t)
	m := mundoApagar(t, gh, arquivosDoMundo(t, false))
	m.Atrasar(t, "fabrica_campanhas", "delete", 50)
	st := make([]int, 8)
	mundoteste.EmParalelo(len(st), func(i int) {
		st[i], _ = m.Pedir(t, "fabricante", "POST", "/fabrica-apagar", corpoApagar(C1))
	})
	for i, s := range st {
		if s != http.StatusOK {
			t.Errorf("pedido %d = %d, esperava 200 (idempotente)", i, s)
		}
	}
	if g.n() != 1 {
		t.Errorf("pedidos ao GitHub = %v, esperava um cancelamento só", g.pedidos)
	}
	if existeNoBanco(m, t, "fabrica_campanhas", C1) {
		t.Error("C1 tem de sair do banco")
	}
}
