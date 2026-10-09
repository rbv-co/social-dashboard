package auth

import "slices"

// Pode é o ÚNICO ponto de decisão recurso×ação. Nega tudo o que não foi concedido.
func (a *Ator) Pode(recurso, acao string) bool {
	if a == nil || a.Tipo == "cliente" {
		return false
	}
	if a.SuperAdmin {
		return true
	}
	return slices.Contains(a.Permissoes[recurso], acao)
}
