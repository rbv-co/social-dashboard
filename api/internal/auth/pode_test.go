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
		{"tipo desconhecido nega até super-admin", &Ator{Tipo: "outro", SuperAdmin: true, Permissoes: map[string][]string{"frota": {"ver"}}}, "frota", "ver", false},
		{"tipo vazio nega", &Ator{SuperAdmin: true}, "frota", "ver", false},
		{"conta de serviço usa permissões", &Ator{Tipo: "servico", Permissoes: map[string][]string{"meta.gestor": {"ver"}}}, "meta.gestor", "ver", true},
	}
	for _, c := range casos {
		if got := c.ator.Pode(c.recurso, c.acao); got != c.quer {
			t.Errorf("%s: Pode(%q,%q) = %v, esperava %v", c.nome, c.recurso, c.acao, got, c.quer)
		}
	}
}

func TestPodeModulo(t *testing.T) {
	vendas := &Ator{Tipo: "painel", Papel: "viewer", Modulos: []string{"banco", "sales"}}
	casos := []struct {
		nome   string
		ator   *Ator
		modulo string
		quer   bool
	}{
		{"ator nulo", nil, "sales", false},
		{"tem o módulo", vendas, "sales", true},
		{"não tem o módulo", vendas, "meta", false},
		{"módulo vazio", vendas, "", false},
		{"role admin passa (como nas edges)", &Ator{Tipo: "painel", Papel: "admin"}, "meta", true},
		{"super-admin passa", &Ator{Tipo: "painel", SuperAdmin: true}, "social", true},
		{"conta de serviço usa os módulos", &Ator{Tipo: "servico", Modulos: []string{"sales"}}, "sales", true},
		{"cliente da Vessel nunca, nem admin", &Ator{Tipo: "cliente", Papel: "admin", Modulos: []string{"sales"}}, "sales", false},
		{"tipo vazio nega", &Ator{Papel: "admin"}, "sales", false},
		{"permissions não abre módulo", &Ator{Tipo: "painel", Permissoes: map[string][]string{"meta": {"ver"}}}, "meta", false},
	}
	for _, c := range casos {
		if got := c.ator.PodeModulo(c.modulo); got != c.quer {
			t.Errorf("%s: PodeModulo(%q) = %v, esperava %v", c.nome, c.modulo, got, c.quer)
		}
	}
}
