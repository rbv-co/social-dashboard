package main

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log/slog"
	"maps"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/config"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
	"github.com/rbv-co/social-dashboard/api/internal/worker"
)

// producao: nome em robos_execucoes -> agenda de cron.job (UTC). Cada task do Plano 4 acrescenta as
// suas linhas; a Task 12 confere a lista inteira contra a tabela do plano.
var producao = map[string]string{
	"enviar-push-vendas-07h": "0 10 * * *",
	"enviar-push-vendas-22h": "0 1 * * *",
	// Task 2
	"conferir-robos":       "2-59/5 * * * *",
	"faxina-da-api":        "41 5 * * *",
	"abandono-de-checkout": "* * * * *",
	"vessel-rd-station":    "* * * * *",
	"fabrica-purga":        "17 4 * * *",
	// Task 3
	"enviar-push-saldo-08h": "0 11 * * *",
	// Task 4
	"enviar-push-frota": "30 10 * * 1-5",
	// Task 5
	"conteudo-hora-h":  "*/5 * * * *",
	"conteudo-espelho": "*/30 * * * *",
	// Task 6
	"coletar-dados-07h":  "0 10 * * *",
	"coletar-dados-12h":  "0 15 * * *",
	"coletar-dados-18h":  "0 21 * * *",
	"coletar-dados-2359": "59 2 * * *",
	"auditar-dados":      "30 2 * * *",
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

type bufferSeguro struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (b *bufferSeguro) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.b.Write(p)
}

func (b *bufferSeguro) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.b.String()
}

func capturarLog(t *testing.T) *bufferSeguro {
	t.Helper()
	b := &bufferSeguro{}
	antigo := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(b, nil)))
	t.Cleanup(func() { slog.SetDefault(antigo) })
	return b
}

// saidaDe captura o que f escreve em stdout e stderr.
func saidaDe(t *testing.T, f func()) string {
	t.Helper()
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	so, se := os.Stdout, os.Stderr
	os.Stdout, os.Stderr = w, w
	defer func() { os.Stdout, os.Stderr = so, se }()
	f()
	w.Close()
	b, _ := io.ReadAll(r)
	return string(b)
}

func TestRodarManualNaoMostraSegredoNemNoErroNemNoLog(t *testing.T) {
	const seg = "tok-core-inventado-9876"
	p := testebanco.Novo(t)
	cfg := config.Config{CoreToken: seg}
	antiga := montarTarefas
	montarTarefas = func(*pgxpool.Pool, config.Config, *worker.Agendador) []worker.Tarefa {
		return []worker.Tarefa{{Nome: "falha-com-segredo", Agenda: "0 1 * * *", Limite: time.Second, Executar: func(context.Context) error {
			return fmt.Errorf("GET http://core/x?t=%s: 500", seg)
		}}}
	}
	t.Cleanup(func() { montarTarefas = antiga })
	log := capturarLog(t)
	var codigo int
	saida := saidaDe(t, func() { codigo = rodarWorker(context.Background(), p, cfg, []string{"rodar", "falha-com-segredo"}) })
	if codigo != 1 || !strings.Contains(saida, "t=***") {
		t.Fatalf("codigo=%d saida=%q", codigo, saida)
	}
	if strings.Contains(saida, seg) || strings.Contains(log.String(), seg) {
		t.Fatalf("segredo na saída da CLI ou no log: %q / %s", saida, log)
	}
	var resp string
	p.QueryRow(context.Background(), `select resposta from robos_execucoes where robo = 'falha-com-segredo'`).Scan(&resp)
	if strings.Contains(resp, seg) {
		t.Fatalf("segredo em robos_execucoes: %q", resp)
	}
}

func TestRodarPuladaSaiComCodigo3(t *testing.T) {
	p := testebanco.Novo(t)
	ctx := context.Background()
	outra, err := pgx.ConnectConfig(ctx, p.Config().ConnConfig.Copy()) // "outro worker" segurando a trava
	if err != nil {
		t.Fatal(err)
	}
	defer outra.Close(ctx)
	var ganhou bool
	if err := outra.QueryRow(ctx, `select pg_try_advisory_lock($1::int, hashtext($2::text))`, worker.EspacoDaTrava, "enviar-push-vendas-22h").Scan(&ganhou); err != nil || !ganhou {
		t.Fatalf("ganhou=%v err=%v", ganhou, err)
	}
	var codigo int
	saida := saidaDe(t, func() { codigo = rodarWorker(ctx, p, config.Config{}, []string{"rodar", "enviar-push-vendas-22h"}) })
	if codigo != 3 || !strings.Contains(saida, "pulada") {
		t.Fatalf("codigo=%d saida=%q", codigo, saida)
	}
	var n int
	p.QueryRow(ctx, `select count(*) from robos_execucoes`).Scan(&n)
	if n != 0 {
		t.Fatalf("pulada não grava linha: %d", n)
	}
}

func TestAvisaSegredoCurtoSemMostrarOValor(t *testing.T) {
	log := capturarLog(t)
	avisarSegredosCurtos(config.Config{CoreToken: "abc123", ChatwootSegredo: "segredo-longo-o-bastante", ShopifySegredos: []string{"xyz"}}.Segredos())
	if !strings.Contains(log.String(), "menos de 8") || !strings.Contains(log.String(), "quantidade=2") ||
		strings.Contains(log.String(), "abc123") || strings.Contains(log.String(), "xyz") {
		t.Fatalf("aviso: %s", log)
	}
	log2 := capturarLog(t)
	avisarSegredosCurtos(config.Config{CoreToken: "segredo-longo-o-bastante"}.Segredos())
	if log2.String() != "" {
		t.Fatalf("sem segredo curto não há aviso (vazio não conta): %s", log2)
	}
}

func TestBancoForaDoArNaoViraTabelaFaltando(t *testing.T) {
	p := testebanco.Novo(t)
	log := capturarLog(t)
	p.Close()
	if got := rodarWorker(context.Background(), p, config.Config{}, []string{"listar"}); got != 1 {
		t.Fatalf("got=%d", got)
	}
	if strings.Contains(log.String(), "sem as tabelas") {
		t.Fatalf("erro de conexão não é tabela faltando: %s", log)
	}
	p2 := testebanco.Novo(t)
	if _, err := p2.Exec(context.Background(), `drop table envios_feitos`); err != nil {
		t.Fatal(err)
	}
	log2 := capturarLog(t)
	if got := rodarWorker(context.Background(), p2, config.Config{}, []string{"listar"}); got != 1 || !strings.Contains(log2.String(), "sem as tabelas") {
		t.Fatalf("got=%d log=%s", got, log2)
	}
}

func TestSaudeDoWorkerAceitaEnderecoComEspacos(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.Write([]byte("ok")) }))
	defer srv.Close()
	if got := saudeDoWorker(" " + strings.TrimPrefix(srv.URL, "http://") + " \n"); got != 0 {
		t.Fatalf("got=%d", got)
	}
}

func TestClienteDoCoreDoWorkerAndaNoRitmoDoCore(t *testing.T) {
	cli := clienteDoCore(config.Config{CoreURL: "http://core.exemplo", CoreToken: "token-inventado"})
	if cli.RitmoMeta != 600*time.Millisecond || cli.URL != "http://core.exemplo" || cli.Token != "token-inventado" {
		t.Fatalf("cliente do worker: %+v", cli)
	}
}
