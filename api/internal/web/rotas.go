// Package web monta o roteador HTTP.
package web

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/auth"
)

func Rotas(p *pgxpool.Pool, s *auth.Store, l *auth.Limitador) http.Handler {
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
	r.Group(func(r chi.Router) {
		r.Use(auth.Exigir(p, s))
		r.Post("/auth/sair", h.Sair)
		r.Get("/auth/eu", h.Eu)
	})
	return r
}
