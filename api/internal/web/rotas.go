// Package web monta o roteador HTTP.
package web

import (
	"context"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/canais"
	"github.com/rbv-co/social-dashboard/api/internal/comercial"
	"github.com/rbv-co/social-dashboard/api/internal/config"
	"github.com/rbv-co/social-dashboard/api/internal/core"
	"github.com/rbv-co/social-dashboard/api/internal/meta"
	"github.com/rbv-co/social-dashboard/api/internal/webhooks"
)

// Prazos por requisição das rotas lentas da Meta (o contexto da requisição não tem prazo
// próprio). contar-collabs varre N perfis x até 5 páginas em série, então é o maior; o
// WriteTimeout do servidor (main.go) e o proxy_read_timeout do nginx (NOTAS) ficam ACIMA
// destes valores, senão o prazo nunca teria como disparar antes da conexão cair.
const (
	PrazoMetaAoVivo = 90 * time.Second
	PrazoCollabs    = 120 * time.Second
)

// comPrazo limita o contexto da requisição; o que estiver preso na rede/core desiste junto.
func comPrazo(d time.Duration) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx, cancela := context.WithTimeout(r.Context(), d)
			defer cancela()
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// Rotas: tudo atrás de sessão (Exigir) e de um portão, exceto a lista PÚBLICA explícita
// (saúde, login e os webhooks, que se autenticam por assinatura/segredo e têm limite por IP).
// As rotas portadas das edges têm o MESMO nome, corpo e resposta da edge (Plano 7 troca
// `functions.invoke(nome)` por `POST /nome`).
func Rotas(p *pgxpool.Pool, s *auth.Store, l *auth.Limitador, cfg config.Config) http.Handler {
	r := chi.NewRouter()
	r.Get("/saude", func(w http.ResponseWriter, _ *http.Request) { w.Write([]byte("ok")) })
	r.Get("/pronto", func(w http.ResponseWriter, r *http.Request) {
		if err := p.Ping(r.Context()); err != nil {
			http.Error(w, "banco indisponível", http.StatusServiceUnavailable)
			return
		}
		w.Write([]byte("ok"))
	})
	h := auth.NovosHandlers(p, s, l)
	r.Post("/auth/entrar", h.Entrar)

	// Webhooks: públicos, sem sessão. O fan-out do core vem de um IP só: teto folgado.
	// Só POST: outro método = 405 do chi (testado).
	sh := &webhooks.Shopify{Pool: p, Segredos: cfg.ShopifySegredos}
	cw := &webhooks.Chatwoot{Pool: p, Segredo: cfg.ChatwootSegredo}
	r.Group(func(r chi.Router) {
		r.Use(auth.LimitarPorIP(600, time.Minute))
		r.Post("/receber-webhook-pedido-shopify", sh.Pedido)
		r.Post("/receber-webhook-checkout", sh.Checkout)
		r.Post("/receber-webhook-abandono", sh.Abandono)
		r.Post("/receber-webhook-chatwoot", cw.Evento)
		r.Post("/receber-opt-out-chatwoot", cw.OptOut)
	})

	cli := core.Novo(cfg.CoreURL, cfg.CoreToken)
	av := &meta.AoVivo{Pool: p, Core: cli}
	r.Group(func(r chi.Router) {
		r.Use(auth.Exigir(p, s))
		r.Post("/auth/sair", h.Sair)
		r.Get("/auth/eu", h.Eu)
		r.Get("/eu/canais", canais.Handler(p))
		r.Post("/bling-proxy", (&comercial.Bling{Pool: p, Core: cli}).ServeHTTP)                                                           // portão por caminho, lá dentro
		r.With(auth.ExigirModulo("meta")).Post("/meta-proxy", (&meta.Proxy{Pool: p, Core: cli, HostsDeMidia: cfg.HostsDeMidia}).ServeHTTP) // prazo próprio (25/45/75 s)
		r.With(auth.ExigirModulo("social"), comPrazo(PrazoMetaAoVivo)).Post("/insights-ao-vivo", av.Insights)
		r.With(auth.ExigirModulo("social"), comPrazo(PrazoMetaAoVivo)).Post("/serie-novos-dia", av.SerieNovosDia)
		r.With(auth.ExigirModulo("social"), comPrazo(PrazoCollabs)).Post("/contar-collabs", av.ContarCollabs)
	})
	return r
}
