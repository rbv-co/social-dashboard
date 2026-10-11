package main

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/config"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
	"github.com/rbv-co/social-dashboard/api/internal/worker"
)

// `api worker rodar` de uma tarefa com uma linha por conta: se alguma conta falhou, sai com 1 e diz
// quantas, mas não grava a linha agregada (cada conta já tem a DELA).
func TestRodarManualComContaQueFalhouSaiComCodigo1SemLinhaAgregada(t *testing.T) {
	p := testebanco.Novo(t)
	antiga := montarTarefas
	montarTarefas = func(_ *pgxpool.Pool, _ config.Config, ag *worker.Agendador) []worker.Tarefa {
		gravar := ag.Gravador()
		return []worker.Tarefa{{Nome: "por-conta", Agenda: "0 1 * * *", Limite: time.Second, RegistroProprio: true,
			Executar: func(ctx context.Context) error {
				gravar(ctx, "por-conta · Mantova Móveis", time.Now(), context.DeadlineExceeded)
				return worker.Falhou(1, "Mantova Móveis")
			}}}
	}
	t.Cleanup(func() { montarTarefas = antiga })
	var codigo int
	saida := saidaDe(t, func() { codigo = rodarWorker(context.Background(), p, config.Config{}, []string{"rodar", "por-conta"}) })
	if codigo != 1 || !strings.Contains(saida, "por-conta falhou: 1 item(ns) falharam: Mantova Móveis") {
		t.Fatalf("codigo=%d saida=%q", codigo, saida)
	}
	var agregadas, daConta int
	p.QueryRow(context.Background(), `select count(*) from robos_execucoes where robo = 'por-conta'`).Scan(&agregadas)
	p.QueryRow(context.Background(), `select count(*) from robos_execucoes where robo = 'por-conta · Mantova Móveis' and not ok`).Scan(&daConta)
	if agregadas != 0 || daConta != 1 {
		t.Fatalf("linha agregada=%d, linha da conta ok=false=%d", agregadas, daConta)
	}
}
