package meta

import (
	"bytes"
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/rbv-co/social-dashboard/api/internal/core"
	"github.com/rbv-co/social-dashboard/api/internal/worker"
)

// coreMorto: a URL de um core que já fechou (porta recusando), e as partes que nunca podem sair.
func coreMorto(t *testing.T) (cli *core.Cliente, proibidos []string) {
	t.Helper()
	srv := httptest.NewServer(http.NotFoundHandler())
	srv.Close()
	u, _ := url.Parse(srv.URL)
	return core.Novo(srv.URL, "token-do-core-xyz"), []string{u.Host, u.Port(), "127.0.0.1", "/api/interno", "api/interno", "token-do-core-xyz", "dial tcp"}
}

// logDebug captura o slog no nível Debug (onde o cliente do core pode deixar a classe da falha).
func logDebug(t *testing.T) *bytes.Buffer {
	var log bytes.Buffer
	antes := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&log, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() { slog.SetDefault(antes) })
	return &log
}

func semVazar(t *testing.T, onde, saida string, proibidos []string) {
	t.Helper()
	for _, p := range proibidos {
		if strings.Contains(saida, p) {
			t.Fatalf("%q vazou em %s: %q", p, onde, saida)
		}
	}
}

// Core fora do ar na coleta diária: a linha de cada conta em robos_execucoes, o erro da rodada e o slog
// (até em Debug) levam só "core: conexão recusada", sem host, porta nem caminho do core.
func TestColetaDiariaCoreForaDoArSoLevaAClasse(t *testing.T) {
	c, _, p, ag := ambienteColeta(t)
	cli, proibidos := coreMorto(t)
	c.Core = cli
	log := logDebug(t)
	_, err := ag.Rodar(context.Background(), c.Tarefas()[0])
	if !falhaDeContas(err) {
		t.Fatalf("as 3 contas falharam: %v", err)
	}
	linhas, _ := p.Query(context.Background(), `select coalesce(resposta, '') from robos_execucoes where not ok`)
	defer linhas.Close() // um Fatalf no meio do laço não pode deixar a conexão presa (o Cleanup fecha o pool)
	n := 0
	for linhas.Next() {
		var resp string
		linhas.Scan(&resp)
		n++
		if !strings.Contains(resp, "core: conexão recusada") {
			t.Errorf("linha sem a classe: %q", resp)
		}
		semVazar(t, "robos_execucoes", resp, proibidos)
	}
	if n != 3 {
		t.Fatalf("linhas com falha: %d", n)
	}
	semVazar(t, "erro da rodada", err.Error(), proibidos)
	semVazar(t, "slog", log.String(), proibidos)
	if !strings.Contains(log.String(), "core: conexão recusada") {
		t.Fatalf("o slog.Error da conta leva a classe: %s", log)
	}
}

// Mesma garantia na meta-hora (que antes vazava o *url.Error inteiro na linha e no erro da tarefa).
func TestMetaHoraCoreForaDoArSoLevaAClasse(t *testing.T) {
	ch, p, _ := ambienteHoraCom(t, graphDaHora("10"), time.Date(2026, 10, 10, 15, 5, 0, 0, time.UTC))
	cli, proibidos := coreMorto(t)
	ch.Core = cli
	log := logDebug(t)
	ag := worker.Novo(p)
	_, err := ag.Rodar(context.Background(), ch.Tarefas()[0])
	if err == nil || !strings.Contains(err.Error(), "core: conexão recusada") {
		t.Fatalf("a tarefa termina em erro com a classe: %v", err)
	}
	var resp string
	if e := p.QueryRow(context.Background(), `select coalesce(resposta, '') from robos_execucoes where robo = 'meta-hora' and not ok`).Scan(&resp); e != nil {
		t.Fatal(e)
	}
	semVazar(t, "robos_execucoes", resp, proibidos)
	semVazar(t, "erro da tarefa", err.Error(), proibidos)
	semVazar(t, "slog", log.String(), proibidos)
	if !strings.Contains(resp, "core: conexão recusada") {
		t.Fatalf("linha sem a classe: %q", resp)
	}
}
