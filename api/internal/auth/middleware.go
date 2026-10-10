package auth

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

type chaveAtor struct{}

func AtorDoContexto(ctx context.Context) *Ator {
	a, _ := ctx.Value(chaveAtor{}).(*Ator)
	return a
}

func erroJSON(w http.ResponseWriter, status int, codigo string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	w.Write([]byte(`{"error":"` + codigo + `"}`))
}

func tokenDe(r *http.Request) string {
	t, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	if !ok {
		return ""
	}
	return t
}

func Exigir(p *pgxpool.Pool, s *Store) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			token := tokenDe(r)
			if token == "" {
				erroJSON(w, http.StatusUnauthorized, "nao_autenticado")
				return
			}
			se, err := s.Buscar(r.Context(), token)
			if errors.Is(err, ErrSessaoInvalida) {
				erroJSON(w, http.StatusUnauthorized, "nao_autenticado")
				return
			}
			if err != nil {
				erroJSON(w, http.StatusInternalServerError, "erro_interno")
				return
			}
			// default deny (spec §5): sessão de cliente só vale nas rotas públicas da
			// Vessel, que terão middleware próprio
			if se.Tipo != "painel" && se.Tipo != "servico" {
				erroJSON(w, http.StatusForbidden, "sem_permissao")
				return
			}
			a, err := CarregarAtor(r.Context(), p, se)
			if err != nil {
				erroJSON(w, http.StatusInternalServerError, "erro_interno")
				return
			}
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), chaveAtor{}, a)))
		})
	}
}

// ExigirPermissao deve vir DEPOIS de Exigir.
func ExigirPermissao(recurso, acao string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !AtorDoContexto(r.Context()).Pode(recurso, acao) {
				erroJSON(w, http.StatusForbidden, "sem_permissao")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// ExigirModulo deve vir DEPOIS de Exigir: passa quem tem QUALQUER um dos módulos (PodeModulo).
func ExigirModulo(modulos ...string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			a := AtorDoContexto(r.Context())
			for _, m := range modulos {
				if a.PodeModulo(m) {
					next.ServeHTTP(w, r)
					return
				}
			}
			erroJSON(w, http.StatusForbidden, "sem_permissao")
		})
	}
}
