package frota

import (
	"slices"
	"strings"
	"testing"
	"time"
)

func sp(s string) *string { return &s }

// Esperados gerados com _shared/checklist.js, aviso-de-checklist.js e aviso-de-reserva.js (Node 22).
func TestCadenciasDoDiaComoAEdge(t *testing.T) {
	cfg := Config{DiaSemanal: 5, SemanaMensal: 1, DiaMensal: 3}
	casos := []struct {
		hoje, semanal, mensal string
		quer                  []string
	}{
		{"2026-10-09", "", "", []string{"diario", "semanal"}},           // sexta = dia da semanal
		{"2026-10-07", "", "", []string{"diario", "mensal"}},            // 1ª quarta = dia do mensal
		{"2026-10-06", "2026-09-25", "", []string{"diario", "semanal"}}, // semanal atrasada (11 dias)
		{"2026-10-06", "", "2026-09-01", []string{"diario", "mensal"}},  // mensal atrasada (35 dias)
		{"2026-10-10", "", "", nil},                                     // sábado
		{"2026-10-14", "2026-10-09", "2026-10-07", []string{"diario"}},
	}
	for _, c := range casos {
		if got := cadenciasDoDia(c.hoje, cfg, c.semanal, c.mensal); !slices.Equal(got, c.quer) {
			t.Errorf("%s: %v, esperava %v", c.hoje, got, c.quer)
		}
	}
}

func TestMontarAvisoDoChecklist(t *testing.T) {
	for _, c := range []struct {
		n             int
		cad           []string
		titulo, corpo string
	}{
		{1, []string{"diario"}, "Checklist do Volvo", "1 item e o hodômetro."},
		{3, []string{"diario", "semanal", "mensal"}, "Checklist do Volvo", "3 itens e o hodômetro. Hoje tem a conferência do mês junto."},
		{2, []string{"diario", "semanal"}, "Checklist do Volvo", "2 itens e o hodômetro. Hoje tem a conferência da semana junto."},
	} {
		if ti, co := montarAviso("Volvo", c.n, c.cad); ti != c.titulo || co != c.corpo {
			t.Errorf("%q / %q", ti, co)
		}
	}
	itens := []Item{{"semanal", 2, true}, {"diario", 3, true}, {"diario", 1, false}, {"mensal", 0, true}, {"diario", 1, true}}
	if got := itensDaFicha(itens, []string{"diario", "semanal"}); len(got) != 3 || got[0].Ordem != 1 || got[2].Ordem != 3 {
		t.Fatalf("ativos das cadências, na ordem: %+v", got)
	}
}

func TestLoginDaPessoa(t *testing.T) {
	us := []Usuario{{"u1", "raissa@rbv.com"}, {"u2", "marcus@rbv.com"}}
	casos := []struct {
		p    *Pessoa
		quer string
	}{
		{&Pessoa{ProfileID: "u2", EmailCorporativo: "raissa@rbv.com"}, "u2"}, // o elo vence
		{&Pessoa{ProfileID: "u-sumiu", EmailCorporativo: " Raissa@RBV.com "}, "u1"},
		{&Pessoa{EmailCorporativo: ""}, ""}, // duas ausências não são a mesma pessoa
		{&Pessoa{EmailCorporativo: "outra@rbv.com"}, ""},
		{nil, ""},
	}
	for i, c := range casos {
		if got := loginDaPessoa(c.p, us); got != c.quer {
			t.Errorf("caso %d: %q", i, got)
		}
	}
}

func TestMontarAvisoDeReservaComoAEdge(t *testing.T) {
	ret := time.Date(2026, 10, 12, 17, 5, 0, 0, time.UTC)            // 14:05 em São Paulo
	meiaNoite := time.Date(2026, 10, 12, 3, 5, 0, 0, time.UTC)       // 00:05 em São Paulo
	quaseMeiaNoite := time.Date(2026, 10, 12, 2, 59, 0, 0, time.UTC) // 23:59 de 11/10
	base := Requisicao{RetiradaPrevista: &ret, Destino: sp("Campinas ")}
	com := func(f func(*Requisicao)) Requisicao { r := base; f(&r); return r }
	casos := []struct {
		r             Requisicao
		veiculo       string
		titulo, corpo string
	}{
		{com(func(r *Requisicao) { r.Situacao = "aprovada" }), "Volvo", "Reserva aprovada", "Volvo · 12/10 às 14:05 · Campinas"},
		{com(func(r *Requisicao) { r.Situacao, r.Destino = "aprovada", sp("  ") }), "Volvo", "Reserva aprovada", "Volvo · 12/10 às 14:05 · "},
		{com(func(r *Requisicao) { r.Situacao, r.MotivoDecisao = "recusada", sp("  carro   na\noficina  ") }), "", "Reserva recusada", "o veículo · 12/10 às 14:05 — carro na oficina"},
		{com(func(r *Requisicao) { r.Situacao, r.MotivoDecisao = "recusada", sp("") }), "Volvo", "Reserva recusada", "Volvo · 12/10 às 14:05 — sem motivo escrito. Fale com quem administra a Frota."},
		{Requisicao{Situacao: "revogada", EncerradaMotivo: sp(strings.Repeat("x", 130))}, "Volvo", "A sua reserva foi encerrada", "Volvo — " + strings.Repeat("x", 119) + "…"},
		{com(func(r *Requisicao) { r.Situacao = "cancelada" }), "Volvo", "A sua reserva foi cancelada", "Volvo · 12/10 às 14:05 — o carro não está mais reservado para você."},
		// Vetores do Node 22 (aviso-de-reserva.js): meia-noite de São Paulo é 00:05 (não 24:05) e o dia é o de lá;
		// trim() do JS tira U+00A0 e U+FEFF mas não U+0085.
		{Requisicao{Situacao: "aprovada", RetiradaPrevista: &meiaNoite, Destino: sp("\u0085Campinas\ufeff")}, "Volvo", "Reserva aprovada", "Volvo · 12/10 às 00:05 · \u0085Campinas"},
		{Requisicao{Situacao: "aprovada", RetiradaPrevista: &meiaNoite, Destino: sp("\u00a0 ")}, "Volvo", "Reserva aprovada", "Volvo · 12/10 às 00:05 · "},
		{Requisicao{Situacao: "aprovada", RetiradaPrevista: &quaseMeiaNoite, Destino: sp("X")}, "Volvo", "Reserva aprovada", "Volvo · 11/10 às 23:59 · X"},
		{com(func(r *Requisicao) { r.Situacao, r.MotivoDecisao = "recusada", sp("\u00a0 a\u2003b\u00a0") }), "Volvo", "Reserva recusada", "Volvo · 12/10 às 14:05 — a b"},
	}
	for i, c := range casos {
		a, ok := montarAvisoDeReserva(c.r, c.veiculo)
		if !ok || a.Titulo != c.titulo || a.Corpo != c.corpo || a.URL != "/frota" {
			t.Errorf("caso %d: %+v ok=%v", i, a, ok)
		}
	}
	if _, ok := montarAvisoDeReserva(com(func(r *Requisicao) { r.Situacao = "pendente" }), "Volvo"); ok {
		t.Fatal("pendente não é decisão: não avisa")
	}
}
