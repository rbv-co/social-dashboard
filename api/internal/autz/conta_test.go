package autz

import "testing"

func TestPodeVerConta(t *testing.T) {
	ok := func(mod func(*Escopo)) *Escopo {
		e := &Escopo{Ativo: true, TemPerfil: true, Papel: "viewer"}
		mod(e)
		return e
	}
	casos := []struct {
		nome  string
		e     *Escopo
		conta string
		quer  bool
	}{
		{"nil", nil, "A1", false},
		{"inativo admin", &Escopo{Ativo: false, TemPerfil: true, Papel: "admin", TodasContas: true}, "A1", false},
		{"inativo com lista", &Escopo{Ativo: false, TemPerfil: true, Contas: []string{"A1"}}, "A1", false},
		{"sem perfil", &Escopo{Ativo: true, TemPerfil: false, Papel: "admin", TodasContas: true, Contas: []string{"A1"}}, "A1", false},
		{"admin", ok(func(e *Escopo) { e.Papel = "admin" }), "qualquer", true},
		{"super pela ficha", ok(func(e *Escopo) { e.SuperFicha = true }), "qualquer", true},
		{"todas as contas", ok(func(e *Escopo) { e.TodasContas = true }), "qualquer", true},
		{"lista: a que tem", ok(func(e *Escopo) { e.Contas = []string{"A1"} }), "A1", true},
		{"lista: outra", ok(func(e *Escopo) { e.Contas = []string{"A1"} }), "A2", false},
		{"lista: comparação exata", ok(func(e *Escopo) { e.Contas = []string{"a1"} }), "A1", false},
		{"lista vazia", ok(func(e *Escopo) { e.Contas = []string{} }), "A1", false},
	}
	for _, c := range casos {
		if got := PodeVerConta(c.e, c.conta); got != c.quer {
			t.Errorf("%s: PodeVerConta = %v, esperava %v", c.nome, got, c.quer)
		}
	}
	if VeTodasAsContas(nil) {
		t.Error("VeTodasAsContas(nil) deve ser falso")
	}
}
