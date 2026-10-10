package main

import (
	"context"
	"maps"
	"testing"

	"github.com/rbv-co/social-dashboard/api/internal/config"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
	"github.com/rbv-co/social-dashboard/api/internal/worker"
)

// producao: nome em robos_execucoes -> agenda de cron.job (UTC). Cada task do Plano 4 acrescenta as
// suas linhas; a Task 12 confere a lista inteira contra a tabela do plano.
var producao = map[string]string{
	"enviar-push-vendas-07h": "0 10 * * *",
	"enviar-push-vendas-22h": "0 1 * * *",
}

func TestTarefasDeProducao(t *testing.T) {
	got := map[string]string{}
	for _, tf := range tarefas(nil, config.Config{}, worker.Novo(nil)) {
		if _, dup := got[tf.Nome]; dup {
			t.Errorf("nome repetido: %s", tf.Nome)
		}
		got[tf.Nome] = tf.Agenda
	}
	if !maps.Equal(got, producao) {
		t.Fatalf("tarefas = %v\nesperava %v", got, producao)
	}
}

func TestWorkerSubcomandos(t *testing.T) {
	p := testebanco.Novo(t)
	ctx := context.Background()
	cfg := config.Config{TarefasDesligadas: []string{"enviar-push-vendas-07h"}}
	casos := []struct {
		args []string
		quer int
	}{
		{[]string{"listar"}, 0},
		{[]string{"rodar"}, 2},
		{[]string{"rodar", "nao-existe"}, 2},
		{[]string{"rodar", "enviar-push-vendas-07h"}, 2}, // desligada sem --forcar
		{[]string{"rodar", "enviar-push-vendas-22h"}, 1}, // VAPID vazio: a tarefa falha (sem rede)
		{[]string{"rodar", "enviar-push-vendas-07h", "--forcar"}, 1},
		{[]string{"bobagem"}, 2},
	}
	for _, c := range casos {
		if got := rodarWorker(ctx, p, cfg, c.args); got != c.quer {
			t.Errorf("worker %v = %d, esperava %d", c.args, got, c.quer)
		}
	}
	// Erro de digitação em WORKER_TAREFAS_DESLIGADAS manteria ligado o que se quis desligar: recusa subir.
	errado := config.Config{TarefasDesligadas: []string{"enviar-push-vendas-7h"}}
	if got := rodarWorker(ctx, p, errado, []string{"listar"}); got != 1 {
		t.Fatalf("nome desconhecido em WORKER_TAREFAS_DESLIGADAS: %d", got)
	}
	var n int
	p.QueryRow(ctx, `select count(*) from robos_execucoes where ok = false and robo like 'enviar-push-vendas-%'`).Scan(&n)
	if n != 2 {
		t.Fatalf("as duas execuções manuais deviam virar linha com erro: %d", n)
	}
	if _, err := p.Exec(ctx, `drop table envios_feitos`); err != nil {
		t.Fatal(err)
	}
	if got := rodarWorker(ctx, p, cfg, []string{"listar"}); got != 1 {
		t.Fatalf("sem as tabelas do worker ele recusa subir: %d", got)
	}
}
