package worker

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

// Tarefa com uma linha por conta: a conta que falhou fica na linha DELA (ok=false); a execução devolve
// Falhou(n, ...), que sinaliza (métrica, erro de Rodar para a CLI e o log do cron) SEM gravar a linha
// agregada com o nome da tarefa (ela viraria uma variante sem sucesso na view robos_saude).
func TestFalhaDeItensSinalizaSemLinhaAgregada(t *testing.T) {
	p := testebanco.Novo(t)
	a := Novo(p)
	a.Segredos = []string{"segredo-inventado-1234"}
	gravar := a.Gravador()
	ctx := context.Background()
	tf := Tarefa{Nome: "coletar-dados-07h", RegistroProprio: true, Limite: time.Second, Executar: func(ctx context.Context) error {
		if err := gravar(ctx, "coletar-dados-07h · Vessel", time.Now(), nil); err != nil {
			return err
		}
		if err := gravar(ctx, "coletar-dados-07h · Mantova Móveis", time.Now(), errors.New("Meta API /1785: fora")); err != nil {
			return err
		}
		return Falhou(1, "Mantova Móveis, segredo-inventado-1234")
	}}
	executou, err := a.Rodar(ctx, tf)
	var fi *FalhaDeItens
	if !executou || err == nil || !errors.As(err, &fi) || fi.Quantos != 1 {
		t.Fatalf("Rodar deve devolver a falha de itens: executou=%v err=%v", executou, err)
	}
	if got := err.Error(); got != "1 item(ns) falharam: Mantova Móveis, ***" {
		t.Fatalf("erro (já sem segredo) = %q", got)
	}
	if _, _, n := linha(t, p, "coletar-dados-07h"); n != 0 {
		t.Fatalf("nenhuma linha agregada com o nome da tarefa: %d", n)
	}
	if ok, _, n := linha(t, p, "coletar-dados-07h · Mantova Móveis"); ok || n != 1 {
		t.Fatalf("a linha própria da conta que falhou (ok=false) tem de existir: ok=%v n=%d", ok, n)
	}
	if ok, _, n := linha(t, p, "coletar-dados-07h · Vessel"); !ok || n != 1 {
		t.Fatalf("a linha da conta boa: ok=%v n=%d", ok, n)
	}
	m := *a.metricas["coletar-dados-07h"]
	if m.Execucoes != 1 || m.Falhas != 1 || m.UltimoErro != "1 item(ns) falharam: Mantova Móveis, ***" {
		t.Fatalf("métrica: %+v", m)
	}
	semTrava(t, p, "coletar-dados-07h")
}

// Sem RegistroProprio, Falhou é um erro como outro qualquer: a linha agregada é gravada.
func TestFalhaDeItensSemRegistroProprioGravaALinhaDaTarefa(t *testing.T) {
	p := testebanco.Novo(t)
	a := Novo(p)
	_, err := a.Rodar(context.Background(), Tarefa{Nome: "sem-registro-proprio", Limite: time.Second,
		Executar: func(context.Context) error { return Falhou(2, "a, b") }})
	if err == nil {
		t.Fatal("deveria devolver o erro")
	}
	if ok, resp, n := linha(t, p, "sem-registro-proprio"); ok || n != 1 || resp != "2 item(ns) falharam: a, b" {
		t.Fatalf("ok=%v n=%d resp=%q", ok, n, resp)
	}
}

// Um erro de verdade (banco, prazo) continua gravando a linha agregada, mesmo com RegistroProprio.
func TestErroDeVerdadeComRegistroProprioGravaALinhaDaTarefa(t *testing.T) {
	p := testebanco.Novo(t)
	a := Novo(p)
	_, err := a.Rodar(context.Background(), Tarefa{Nome: "rodada-estourou", RegistroProprio: true, Limite: time.Second,
		Executar: func(context.Context) error { return errors.New("limite de tempo da rodada") }})
	if err == nil {
		t.Fatal("deveria devolver o erro")
	}
	if ok, _, n := linha(t, p, "rodada-estourou"); ok || n != 1 {
		t.Fatalf("ok=%v n=%d", ok, n)
	}
}
