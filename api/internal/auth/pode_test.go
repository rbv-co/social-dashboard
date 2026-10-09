package auth

import "testing"

func TestPode(t *testing.T) {
	comum := &Ator{Tipo: "painel", Permissoes: map[string][]string{"frota": {"ver", "criar"}, "meta.gestor": {"ver"}}}
	casos := []struct {
		nome    string
		ator    *Ator
		recurso string
		acao    string
		quer    bool
	}{
		{"ator nulo", nil, "frota", "ver", false},
		{"permitido", comum, "frota", "criar", true},
		{"ação não listada", comum, "frota", "excluir", false},
		{"recurso não listado", comum, "patrimonio", "ver", false},
		{"recurso vazio", comum, "", "ver", false},
		{"super-admin passa tudo", &Ator{Tipo: "painel", SuperAdmin: true}, "qualquer", "excluir", true},
		{"cliente da Vessel nunca", &Ator{Tipo: "cliente", SuperAdmin: true, Permissoes: map[string][]string{"frota": {"ver"}}}, "frota", "ver", false},
		{"conta de serviço usa permissões", &Ator{Tipo: "servico", Permissoes: map[string][]string{"meta.gestor": {"ver"}}}, "meta.gestor", "ver", true},
	}
	for _, c := range casos {
		if got := c.ator.Pode(c.recurso, c.acao); got != c.quer {
			t.Errorf("%s: Pode(%q,%q) = %v, esperava %v", c.nome, c.recurso, c.acao, got, c.quer)
		}
	}
}
