package worker

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

func TestAgendasDaSpecSaoValidas(t *testing.T) {
	a := Novo(testebanco.Novo(t))
	for _, ag := range []string{
		"0 10 * * *", "0 15 * * *", "0 21 * * *", "59 2 * * *", "0 1 * * *", "0 11 * * *",
		"30 2 * * *", "17 4 * * *", "*/30 * * * *", "*/5 * * * *", "2-59/5 * * * *",
		"* * * * *", "4,14,24,34,44,54 * * * *", "*/10 * * * *",
	} {
		if err := a.Registrar(Tarefa{Nome: "t", Agenda: ag, Limite: time.Second, Executar: func(context.Context) error { return nil }}); err != nil {
			t.Errorf("agenda %q: %v", ag, err)
		}
	}
	if err := a.Registrar(Tarefa{Nome: "x", Agenda: "isto não é cron"}); err == nil {
		t.Error("agenda inválida deveria falhar")
	}
}

func linha(t *testing.T, a *Agendador, robo string) (ok bool, resp string, n int) {
	t.Helper()
	a.pool.QueryRow(context.Background(), `select count(*) from robos_execucoes where robo = $1`, robo).Scan(&n)
	a.pool.QueryRow(context.Background(), `select coalesce(ok, false), coalesce(resposta, '') from robos_execucoes where robo = $1 order by id desc limit 1`, robo).Scan(&ok, &resp)
	return
}

func TestRodarRegistraSucessoEErro(t *testing.T) {
	a := Novo(testebanco.Novo(t))
	ctx := context.Background()
	if ex, err := a.Rodar(ctx, Tarefa{Nome: "boa", Limite: time.Second, Executar: func(context.Context) error { return nil }}); !ex || err != nil {
		t.Fatalf("ex=%v err=%v", ex, err)
	}
	if ok, resp, n := linha(t, a, "boa"); !ok || resp != "ok" || n != 1 {
		t.Fatalf("ok=%v resp=%q n=%d", ok, resp, n)
	}
	a.Rodar(ctx, Tarefa{Nome: "ruim", Limite: time.Second, Executar: func(context.Context) error { return errors.New("bling fora") }})
	if ok, resp, _ := linha(t, a, "ruim"); ok || resp != "bling fora" {
		t.Fatalf("ok=%v resp=%q", ok, resp)
	}
}

func TestLimiteDeTempoCancelaATarefa(t *testing.T) {
	a := Novo(testebanco.Novo(t))
	a.Rodar(context.Background(), Tarefa{Nome: "lenta", Limite: 50 * time.Millisecond,
		Executar: func(ctx context.Context) error { <-ctx.Done(); return ctx.Err() }})
	if ok, resp, _ := linha(t, a, "lenta"); ok || !strings.Contains(resp, "deadline") {
		t.Fatalf("ok=%v resp=%q", ok, resp)
	}
}

func TestDuasInstanciasSoUmaExecuta(t *testing.T) {
	a := Novo(testebanco.Novo(t))
	preso, liberar := make(chan struct{}), make(chan struct{})
	tarefa := Tarefa{Nome: "unica", Limite: 5 * time.Second, Executar: func(context.Context) error {
		close(preso)
		<-liberar
		return nil
	}}
	feito := make(chan bool)
	go func() { ex, _ := a.Rodar(context.Background(), tarefa); feito <- ex }()
	<-preso
	if ex, err := a.Rodar(context.Background(), Tarefa{Nome: "unica", Limite: time.Second, Executar: func(context.Context) error { t.Error("não podia executar"); return nil }}); ex || err != nil {
		t.Fatalf("segunda rodada: ex=%v err=%v", ex, err)
	}
	close(liberar)
	if !<-feito {
		t.Fatal("a primeira deveria ter executado")
	}
	if _, _, n := linha(t, a, "unica"); n != 1 {
		t.Fatalf("esperava 1 linha, achei %d", n)
	}
}

// Extras além do brief: pânico não derruba o worker e a trava é liberada
// mesmo após falha/timeout/pânico (uma nova rodada precisa conseguir executar).
func TestPanicoEhRegistradoELiberaATrava(t *testing.T) {
	a := Novo(testebanco.Novo(t))
	ctx := context.Background()
	ex, err := a.Rodar(ctx, Tarefa{Nome: "boom", Limite: time.Second, Executar: func(context.Context) error { panic("kaboom") }})
	if !ex || err != nil {
		t.Fatalf("ex=%v err=%v", ex, err)
	}
	if ok, resp, n := linha(t, a, "boom"); ok || !strings.Contains(resp, "kaboom") || n != 1 {
		t.Fatalf("ok=%v resp=%q n=%d", ok, resp, n)
	}
	for i, f := range []func(context.Context) error{
		func(context.Context) error { return nil },
		func(context.Context) error { return errors.New("falha") },
		func(c context.Context) error { <-c.Done(); return c.Err() },
	} {
		if ex, err := a.Rodar(ctx, Tarefa{Nome: "boom", Limite: 20 * time.Millisecond, Executar: f}); !ex || err != nil {
			t.Fatalf("rodada %d após liberar trava: ex=%v err=%v", i, ex, err)
		}
	}
	if _, _, n := linha(t, a, "boom"); n != 4 {
		t.Fatalf("esperava 4 linhas, achei %d", n)
	}
}
