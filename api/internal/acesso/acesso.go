// Package acesso: as rotas do sub-plano 5.1 — usuários e perfis de acesso, pedidos de acesso, times,
// grupos de canal, avisos (push) e saúde. Toda regra é a do catálogo de produção (autz.Producao);
// toda escrita roda em banco.ComUsuario (os gatilhos de profiles e os default auth.uid() leem quem
// pede); sessão de "entrar como" só lê (Ruling 5.1-4).
package acesso

import (
	"net/http"

	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

// soSessaoPropria recusa as escritas do 5.1 a quem entrou como outra pessoa: o rastro (audit_log)
// atribuiria ao alvo o que o super-admin fez, e a inscrição de push deixaria o aparelho dele
// recebendo os avisos do alvo.
func soSessaoPropria(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if a := auth.AtorDoContexto(r.Context()); a == nil || a.ImpersonadorID != nil {
			dados.Erro(w, http.StatusForbidden, "sem_permissao", "Quem entrou como outra pessoa não muda acessos nem avisos.")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// deve: declaração de rota errada (Consulta ou Tabela fora do catálogo) faz a API não subir.
func deve(err error) {
	if err != nil {
		panic(err)
	}
}
