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
	"github.com/rbv-co/social-dashboard/api/internal/comercial"
	"github.com/rbv-co/social-dashboard/api/internal/config"
	"github.com/rbv-co/social-dashboard/api/internal/core"
	"github.com/rbv-co/social-dashboard/api/internal/importacao"
	"github.com/rbv-co/social-dashboard/api/internal/web"
	"github.com/rbv-co/social-dashboard/api/internal/webpush"
	"github.com/rbv-co/social-dashboard/api/internal/worker"
)

func main() {
	if len(os.Args) < 2 {
		slog.Error("uso: api <api|worker|importar-usuarios|migrar>")
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
		// Prazos: WriteTimeout acima do maior prazo por requisição (web.PrazoCollabs = 120 s)
		// para o handler terminar e responder antes de a conexão cair; ReadTimeout cobre o
		// corpo de até 5 MB da Shopify em rede ruim; IdleTimeout fecha keep-alive parado.
		srv := &http.Server{Addr: cfg.Addr, Handler: web.Rotas(p, auth.NovoStore(p), auth.NovoLimitador(), cfg),
			ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 30 * time.Second,
			WriteTimeout: web.PrazoCollabs + 30*time.Second, IdleTimeout: 120 * time.Second}
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
		// HTTP nil: o push herda o cliente seguro (Dialer.Control recusa faixas proibidas).
		pv := &comercial.PushVendas{Pool: p, Core: core.Novo(cfg.CoreURL, cfg.CoreToken),
			VAPID: webpush.VAPID{Publica: cfg.VAPIDPublica, Privada: cfg.VAPIDPrivada, Assunto: cfg.VAPIDAssunto}}
		if _, err := webpush.ValidarVAPID(pv.VAPID); err != nil { // o erro nunca traz as chaves
			slog.Warn("VAPID inválido: o push de vendas vai falhar em toda execução", "erro", err)
		}
		tarefas, err := worker.Filtrar(pv.Tarefas(), cfg.TarefasDesligadas)
		if err != nil {
			slog.Error("configuração", "erro", err)
			os.Exit(1)
		}
		for _, t := range tarefas {
			if err := ag.Registrar(t); err != nil {
				slog.Error("tarefa", "nome", t.Nome, "erro", err)
				os.Exit(1)
			}
		}
		slog.Info("worker no ar", "tarefas", len(tarefas), "desligadas", cfg.TarefasDesligadas)
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
	case "migrar":
		slog.Info("migrations aplicadas")
	default:
		slog.Error("subcomando desconhecido", "cmd", os.Args[1])
		os.Exit(2)
	}
}
