package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
	"github.com/rbv-co/social-dashboard/api/internal/config"
	"github.com/rbv-co/social-dashboard/api/internal/importacao"
	"github.com/rbv-co/social-dashboard/api/internal/web"
	"github.com/rbv-co/social-dashboard/api/internal/worker"
)

func main() {
	if len(os.Args) < 2 {
		slog.Error("uso: api <api|worker|importar-usuarios>")
		os.Exit(2)
	}
	ctx, parar := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer parar()
	cfg, err := config.Carregar()
	if err != nil {
		slog.Error("configuração", "erro", err)
		os.Exit(1)
	}
	p, err := banco.Abrir(ctx, cfg.DatabaseURL)
	if err != nil {
		slog.Error("banco", "erro", err)
		os.Exit(1)
	}
	defer p.Close()
	if err := banco.Migrar(p); err != nil {
		slog.Error("migrations", "erro", err)
		os.Exit(1)
	}
	switch os.Args[1] {
	case "api":
		srv := &http.Server{Addr: cfg.Addr, Handler: web.Rotas(p, auth.NovoStore(p), auth.NovoLimitador()), ReadHeaderTimeout: 10 * time.Second}
		fim := make(chan struct{})
		go func() {
			<-ctx.Done()
			c, cancela := context.WithTimeout(context.Background(), 15*time.Second)
			defer cancela()
			if err := srv.Shutdown(c); err != nil {
				slog.Error("encerramento", "erro", err)
			}
			close(fim)
		}()
		slog.Info("api no ar", "addr", cfg.Addr)
		if err := srv.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
			slog.Error("servidor", "erro", err)
			os.Exit(1)
		}
		<-fim // espera o escoamento das requisições antes do p.Close() adiado
	case "worker":
		ag := worker.Novo(p)
		slog.Info("worker no ar (sem tarefas registradas ainda; entram nos planos seguintes)")
		ag.Iniciar(ctx)
	case "importar-usuarios":
		origem := os.Getenv("ORIGEM_DATABASE_URL")
		if origem == "" {
			slog.Error("defina ORIGEM_DATABASE_URL (somente leitura, restore local no ensaio)")
			os.Exit(1)
		}
		n, ign, err := importacao.Importar(ctx, importacao.FonteSupabase(origem), p, time.Now())
		if err != nil {
			slog.Error("importação", "erro", err)
			os.Exit(1)
		}
		slog.Info("usuários importados", "importados", n, "ignorados_sem_email", ign)
	default:
		slog.Error("subcomando desconhecido", "cmd", os.Args[1])
		os.Exit(2)
	}
}
