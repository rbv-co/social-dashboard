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

// PodeModulo é o portão das edge functions que as rotas portadas delas preservam
// (bling-proxy, meta-proxy, insights-ao-vivo...): `profiles.role = 'admin'` ou o módulo em
// `profiles.features` (text[], derivado de `permissions` por src/compartilhado/derivar-features.js).
// Super-admin passa, como em Pode. Tipo fora de painel/servico nunca passa.
// A unificação com `permissions` (Pode) é do plano de domínios.
func (a *Ator) PodeModulo(modulo string) bool {
	if a == nil || (a.Tipo != "painel" && a.Tipo != "servico") || modulo == "" {
		return false
	}
	return a.SuperAdmin || a.Papel == "admin" || slices.Contains(a.Modulos, modulo)
}
