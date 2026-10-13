package dados

import (
	"context"
	"errors"
	"testing"

	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

const catalogoDeUpsert = `[
 {"tabela":"escolha","nome":"le","tipo":"permissive","comando":"select","papeis":["authenticated"],"using":"true","withCheck":null},
 {"tabela":"escolha","nome":"so_contas","tipo":"restrictive","comando":"select","papeis":["authenticated"],"using":"pode_ver_conta(account_id)","withCheck":null},
 {"tabela":"escolha","nome":"grava","tipo":"permissive","comando":"all","papeis":["authenticated"],"using":"true","withCheck":"true"}
]`

func TestUpsertVisivel(t *testing.T) {
	cat, err := autz.Compilar([]byte(catalogoDeUpsert))
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	p := testebanco.Novo(t)
	if _, err := p.Exec(ctx, `create table escolha (account_id uuid primary key, valor int);
		insert into escolha values ('`+coisaA2+`', 20)`); err != nil {
		t.Fatal(err)
	}
	const inexistente = "aaaaaaaa-0000-4000-a000-000000000003"
	e := &autz.Escopo{ID: quemEscreve, TemPerfil: true, Ativo: true, Contas: []string{coisaA1}}
	valor := func(conta string) (v *int) {
		if err := p.QueryRow(ctx, `select (select valor from escolha where account_id = $1::uuid)`, conta).Scan(&v); err != nil {
			t.Fatal(err)
		}
		return v
	}
	casos := []struct {
		nome  string
		esc   *autz.Escopo
		linha map[string]any
		corpo string
		erro  error
		conta string
		quer  *int
	}{
		{nome: "nova visível", esc: e, linha: map[string]any{"account_id": coisaA1, "valor": 1},
			corpo: `{"account_id":"` + coisaA1 + `","valor":1}`, conta: coisaA1, quer: ptr(1)},
		{nome: "de novo muda", esc: e, linha: map[string]any{"account_id": coisaA1, "valor": 2},
			corpo: `{"account_id":"` + coisaA1 + `","valor":2}`, conta: coisaA1, quer: ptr(2)},
		{nome: "existe e invisível", esc: e, linha: map[string]any{"account_id": coisaA2, "valor": 99},
			erro: autz.ErrNegado, conta: coisaA2, quer: ptr(20)},
		{nome: "não existe e invisível", esc: e, linha: map[string]any{"account_id": inexistente, "valor": 5},
			erro: autz.ErrNegado, conta: inexistente, quer: nil},
		{nome: "escopo nulo", esc: nil, linha: map[string]any{"account_id": coisaA1, "valor": 7},
			erro: autz.ErrNegado, conta: coisaA1, quer: ptr(2)},
		{nome: "só a chave", esc: e, linha: map[string]any{"account_id": coisaA1},
			erro: autz.ErrDeclaracao, conta: coisaA1, quer: ptr(2)},
	}
	for _, c := range casos {
		tx, err := p.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		corpo, err := UpsertVisivel(ctx, tx, cat, c.esc, "escolha", []string{"account_id"}, c.linha, "account_id, valor")
		if c.erro == nil && err != nil || c.erro != nil && !errors.Is(err, c.erro) {
			t.Errorf("%s: erro = %v, esperava %v", c.nome, err, c.erro)
		}
		if c.erro == nil && string(corpo) != c.corpo {
			t.Errorf("%s: corpo = %s, esperava %s", c.nome, corpo, c.corpo)
		}
		if err := tx.Commit(ctx); err != nil && c.erro == nil {
			t.Fatal(err)
		}
		if v := valor(c.conta); (v == nil) != (c.quer == nil) || v != nil && *v != *c.quer {
			t.Errorf("%s: valor gravado = %v, esperava %v", c.nome, v, c.quer)
		}
	}
}

func ptr(n int) *int { return &n }
