package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/config"
	"github.com/rbv-co/social-dashboard/api/internal/mensagens"
	"github.com/rbv-co/social-dashboard/api/internal/webpush"
	"github.com/rbv-co/social-dashboard/api/internal/worker"
)

// rodarWorker é o subcomando `api worker`:
//
//	api worker                          agenda tudo e fica no ar (SIGTERM = desligamento gracioso)
//	api worker listar                   nome, agenda (UTC), prazo e se está desligada
//	api worker rodar <tarefa> [--forcar] executa UMA vez agora, com trava e linha em robos_execucoes
//	api worker conferir                 lista as premissas de schema quebradas (ensaio, depois do restore)
//	api worker saude                    GET http://$WORKER_ADDR/saude (healthcheck; tratado em main, sem banco)
//
// Saída de `rodar`: 0 ok, 1 a tarefa falhou, 2 uso errado (tarefa desconhecida, ou desligada sem
// --forcar), 3 pulada (outra execução segura a trava). Não existe rota HTTP que execute tarefa.
// montarTarefas é `tarefas`, trocável nos testes (para injetar uma tarefa que falha com segredo).
var montarTarefas = tarefas

func rodarWorker(ctx context.Context, p *pgxpool.Pool, cfg config.Config, args []string) int {
	sub := ""
	if len(args) > 0 {
		sub = args[0]
	}
	if err := conferirTabelas(ctx, p); err != nil {
		var pg *pgconn.PgError
		if errors.As(err, &pg) && pg.Code == "42P01" { // undefined_table
			slog.Error("worker: banco sem as tabelas do worker; rode `api migrar` (ou suba o api) antes", "erro", err)
		} else {
			slog.Error("worker: não consegui conferir o banco (conexão ou permissão); as tabelas podem existir", "erro", err)
		}
		return 1
	}
	ag := worker.Novo(p)
	// Desligadas e Segredos ANTES de registrar: Registrar não agenda o que já está desligado (e a
	// agenda confere de novo na hora de disparar).
	ag.Desligadas = cfg.TarefasDesligadas
	ag.Segredos = append(cfg.Segredos(), mensagens.LerConfig(os.Getenv).Segredos()...)
	avisarSegredosCurtos(ag.Segredos)
	ts := montarTarefas(p, cfg, ag)
	if err := worker.ValidarDesligadas(ts, cfg.TarefasDesligadas); err != nil { // nome desconhecido: recusa subir
		slog.Error("configuração", "erro", err)
		return 1
	}
	if _, err := webpush.ValidarVAPID(vapid(cfg)); err != nil { // o erro nunca traz as chaves
		slog.Warn("VAPID inválido: as tarefas de push vão falhar em toda execução", "erro", err)
	}
	for _, t := range ts {
		if err := ag.Registrar(t); err != nil {
			slog.Error("tarefa inválida", "nome", t.Nome, "erro", err)
			return 1
		}
	}
	switch sub {
	case "":
		if cfg.WorkerAddr != "" {
			srv := &http.Server{Addr: cfg.WorkerAddr, Handler: ag.Saude(), ReadHeaderTimeout: 5 * time.Second}
			go func() {
				if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
					slog.Error("worker: /saude", "erro", err)
				}
			}()
			defer srv.Close()
		}
		slog.Info("worker no ar", "tarefas", len(ag.Tarefas()), "desligadas", cfg.TarefasDesligadas)
		ag.Iniciar(ctx)
		return 0
	case "listar":
		for _, t := range ag.Tarefas() {
			estado := "ligada"
			if ag.Desligada(t.Nome) {
				estado = "DESLIGADA"
			}
			fmt.Printf("%-44s %-26s %-8s %s\n", t.Nome, t.Agenda, t.Limite, estado)
		}
		return 0
	case "conferir":
		faltam, err := conferirSchema(ctx, p)
		if err != nil {
			fmt.Fprintln(os.Stderr, "conferir:", err)
			return 1
		}
		for _, f := range faltam {
			fmt.Println(f)
		}
		if len(faltam) > 0 {
			fmt.Fprintf(os.Stderr, "%d premissa(s) do worker quebrada(s) no schema\n", len(faltam))
			return 1
		}
		fmt.Println("schema confere com o que o worker presume")
		return 0
	case "rodar":
		if len(args) < 2 {
			fmt.Fprintln(os.Stderr, "uso: api worker rodar <tarefa> [--forcar]")
			return 2
		}
		t, ok := ag.Buscar(args[1])
		if !ok {
			fmt.Fprintf(os.Stderr, "tarefa desconhecida: %q (veja `api worker listar`)\n", args[1])
			return 2
		}
		if ag.Desligada(t.Nome) && !slices.Contains(args[2:], "--forcar") {
			fmt.Fprintf(os.Stderr, "%s está em WORKER_TAREFAS_DESLIGADAS; para rodar mesmo assim: --forcar\n", t.Nome)
			return 2
		}
		executou, err := ag.Rodar(ctx, t)
		switch {
		case err != nil:
			fmt.Fprintf(os.Stderr, "%s falhou: %s\n", t.Nome, worker.Limpar(err.Error(), ag.Segredos))
			return 1
		case !executou:
			fmt.Fprintf(os.Stderr, "%s pulada: outra execução segura a trava\n", t.Nome)
			return 3
		}
		fmt.Printf("%s ok\n", t.Nome)
		return 0
	}
	fmt.Fprintf(os.Stderr, "subcomando desconhecido: worker %s\n", sub)
	return 2
}

// avisarSegredosCurtos: worker.Limpar não mascara segredo com menos de 8 caracteres. Avisa a
// quantidade, nunca o valor.
func avisarSegredosCurtos(segredos []string) {
	n := 0
	for _, s := range segredos {
		if s != "" && len(s) < 8 {
			n++
		}
	}
	if n > 0 {
		slog.Warn("segredo configurado com menos de 8 caracteres não é mascarado nos erros e no log; use um mais longo", "quantidade", n)
	}
}

// conferirTabelas: as tabelas que o worker escreve existem (o worker não migra; ver main).
func conferirTabelas(ctx context.Context, p *pgxpool.Pool) error {
	_, err := p.Exec(ctx, `select 1 from envios_feitos limit 0; select 1 from robos_execucoes limit 0`)
	return err
}

func saudeDoWorker(addr string) int {
	addr = strings.TrimSpace(addr) // como config.Carregar
	if addr == "" {
		fmt.Fprintln(os.Stderr, "WORKER_ADDR vazio: o worker não expõe /saude")
		return 1
	}
	cli := &http.Client{Timeout: 3 * time.Second}
	r, err := cli.Get("http://" + addr + "/saude")
	if err != nil {
		fmt.Fprintln(os.Stderr, "worker fora do ar:", err)
		return 1
	}
	defer r.Body.Close()
	io.Copy(io.Discard, r.Body)
	if r.StatusCode != http.StatusOK {
		fmt.Fprintln(os.Stderr, "worker parado:", r.StatusCode)
		return 1
	}
	return 0
}
