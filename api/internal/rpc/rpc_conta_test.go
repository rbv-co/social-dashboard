package rpc

import (
	"context"
	"strings"
	"testing"

	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

func TestRPCParamConta(t *testing.T) {
	conta := Funcao{Nome: "conta_marcar", Retorno: Nada, Portao: todos, ParamConta: "p_conta",
		Params: []Param{{Nome: "p_conta", Tipo: "text"}, {Nome: "p_n", Tipo: "integer", Opcional: true}}}
	ator := &auth.Ator{ID: quemPede, Tipo: "painel"}
	criar := `create function conta_marcar(p_conta text, p_n integer default 0) returns void language sql as
		$$ insert into marca values (p_conta) $$`
	casos := []struct {
		nome   string
		escopo *autz.Escopo
		corpo  string
		status int
		msg    string
		marcas int
	}{
		{"conta que vê", &autz.Escopo{ID: quemPede, TemPerfil: true, Ativo: true, Contas: []string{"A1"}}, `{"p_conta":"A1"}`, 204, "", 1},
		{"conta que não vê", &autz.Escopo{ID: quemPede, TemPerfil: true, Ativo: true, Contas: []string{"A1"}}, `{"p_conta":"A2"}`, 403, `{"error":"sem_permissao"}`, 0},
		{"não é texto", &autz.Escopo{ID: quemPede, TemPerfil: true, Ativo: true, Contas: []string{"A1"}}, `{"p_conta":5}`, 400, "p_conta deve ser texto", 0},
		{"null: a função decide", &autz.Escopo{ID: quemPede, TemPerfil: true, Ativo: true, Contas: []string{"A1"}}, `{"p_conta":null}`, 204, "", 1},
		{"todas as contas", &autz.Escopo{ID: quemPede, TemPerfil: true, Ativo: true, TodasContas: true}, `{"p_conta":"A2"}`, 204, "", 1},
	}
	for _, c := range casos {
		p, h := montarCom(t, ator, c.escopo, conta)
		if _, err := p.Exec(context.Background(), criar); err != nil {
			t.Fatal(err)
		}
		w := chamar(h, "conta_marcar", c.corpo)
		if w.Code != c.status || !strings.Contains(w.Body.String(), c.msg) {
			t.Errorf("%s: %d %s, esperava %d %q", c.nome, w.Code, w.Body, c.status, c.msg)
		}
		if n := marcas(t, p); n != c.marcas {
			t.Errorf("%s: %d marcas, esperava %d", c.nome, n, c.marcas)
		}
	}
}

func TestRPCParamContaDeclaracao(t *testing.T) {
	for _, f := range []Funcao{
		{Nome: "conta_marcar", Portao: todos, ParamConta: "p_x", Params: []Param{{Nome: "p_conta", Tipo: "text"}}},
		{Nome: "conta_marcar", Portao: todos, ParamConta: "p_n", Params: []Param{{Nome: "p_n", Tipo: "integer"}}},
	} {
		if _, err := Novo(nil, f); err == nil {
			t.Errorf("ParamConta %q passou", f.ParamConta)
		}
	}
}

// Função que grava: quem entrou como outra pessoa leva 403 com a frase e a função não roda; o portão
// vem antes (portão fechado = 403 sem frase); função que só lê segue aberta a quem entrou como.
func TestRPCSoSessaoPropria(t *testing.T) {
	outro := "22222222-0000-4000-a000-000000000002"
	imp := &auth.Ator{ID: quemPede, Tipo: "painel", ImpersonadorID: &outro}
	esc := &autz.Escopo{ID: quemPede}
	grava := Funcao{Nome: "marcar", Retorno: Nada, Portao: todos, SoSessaoPropria: true}
	p, h := montarCom(t, imp, esc, grava, Funcao{Nome: "quem", Portao: todos})
	w := chamar(h, "marcar", `lixo`)
	if w.Code != 403 || !strings.Contains(w.Body.String(), dados.FraseEntrarComo) || !strings.Contains(w.Body.String(), "sem_permissao") {
		t.Fatalf("impersonado = %d %s", w.Code, w.Body)
	}
	if n := marcas(t, p); n != 0 {
		t.Fatalf("a função rodou na sessão de entrar como (%d marcas)", n)
	}
	if w := chamar(h, "quem", ``); w.Code != 200 {
		t.Fatalf("função sem a marca, impersonado = %d %s", w.Code, w.Body)
	}
	_, h2 := montarCom(t, imp, esc, Funcao{Nome: "marcar", Retorno: Nada, Portao: ninguem, SoSessaoPropria: true})
	if w := chamar(h2, "marcar", ``); w.Code != 403 || strings.Contains(w.Body.String(), dados.FraseEntrarComo) {
		t.Fatalf("portão fechado = %d %s (o portão vem antes)", w.Code, w.Body)
	}
	p3, h3 := montarCom(t, &auth.Ator{ID: quemPede, Tipo: "painel"}, esc, grava)
	if w := chamar(h3, "marcar", ``); w.Code != 204 || marcas(t, p3) != 1 {
		t.Fatalf("sessão própria = %d %s", w.Code, w.Body)
	}
}
