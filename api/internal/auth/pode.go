package auth

import "slices"

// Pode é o ÚNICO ponto de decisão recurso×ação. Nega tudo o que não foi concedido.
func (a *Ator) Pode(recurso, acao string) bool {
	// lista de permitidos: tipo desconhecido (ou "cliente") nunca acessa o painel
	if a == nil || (a.Tipo != "painel" && a.Tipo != "servico") {
		return false
	}
	if a.SuperAdmin {
		return true
	}
	return slices.Contains(a.Permissoes[recurso], acao)
}
