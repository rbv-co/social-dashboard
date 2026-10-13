package dados

import (
	"net/http"

	"github.com/rbv-co/social-dashboard/api/internal/auth"
)

// FraseEntrarComo responde às escritas recusadas a quem entrou como outra pessoa.
const FraseEntrarComo = "Quem entrou como outra pessoa só consulta."

// SoSessaoPropria recusa a rota (403 com `frase`, sem chamar o handler) a quem entrou como outra
// pessoa ("entrar como", Ruling 18 do mestre) e a pedido sem ator (rota montada fora de auth.Exigir).
// Extraído do 5.1 (acesso.soSessaoPropria) no 5.2: o rastro e a autoria iriam no nome do alvo.
func SoSessaoPropria(frase string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if a := auth.AtorDoContexto(r.Context()); a == nil || a.ImpersonadorID != nil {
				Erro(w, http.StatusForbidden, "sem_permissao", frase)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
