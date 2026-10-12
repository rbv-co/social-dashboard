package dados

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

// CriarSoLegivel: quem cria tem de conseguir ler o que criou; o que não existe responde igual ao que
// a pessoa não vê (sem oráculo). Catálogo de teste do 5.1: coisa lida por pode_ver_conta(account_id),
// criada por quem tem o módulo frota.
func TestCriarSoLegivel(t *testing.T) {
	cat, err := autz.Compilar([]byte(catalogoDeEscrita))
	if err != nil {
		t.Fatal(err)
	}
	p := testebanco.Novo(t)
	ctx := context.Background()
	if _, err := p.Exec(ctx, `create table conta (id text primary key);
		insert into conta values ('A1'), ('A2');
		create table coisa (id uuid primary key default gen_random_uuid(), account_id text references conta(id), nome text)`); err != nil {
		t.Fatal(err)
	}
	frota := &autz.Escopo{ID: quemEscreve, TemPerfil: true, Ativo: true, SemTrava: true, Modulos: []string{"frota"}, Contas: []string{"A1"}}
	criar := func(tb Tabela, conta string) ([]byte, error) {
		var linha []byte
		err := banco.ComUsuario(ctx, p, frota.ID, func(tx pgx.Tx) (err error) {
			linha, err = tb.Criar(ctx, tx, cat, frota, map[string]any{"account_id": conta, "nome": "x"})
			return err
		})
		return linha, err
	}
	total := func() (n int) {
		p.QueryRow(ctx, `select count(*) from coisa`).Scan(&n)
		return n
	}
	so := Tabela{Nome: "coisa", Resposta: "t.id, t.account_id", CriarSoLegivel: true}
	if l, err := criar(so, "A1"); err != nil || !strings.Contains(string(l), `"account_id":"A1"`) {
		t.Errorf("cria o que lê: %s %v", l, err)
	}
	if _, err := criar(so, "A2"); !errors.Is(err, autz.ErrNegado) || total() != 1 {
		t.Errorf("criou o que não lê: %v (%d linhas)", err, total())
	}
	if _, err := criar(so, "A9"); !errors.Is(err, autz.ErrNegado) || total() != 1 {
		t.Errorf("conta inexistente = %v: tem de responder igual à invisível", err)
	}
	livre := Tabela{Nome: "coisa", Resposta: "t.id, t.account_id"}
	if l, err := criar(livre, "A2"); err != nil || strings.Contains(string(l), "account_id") || total() != 2 {
		t.Errorf("sem a flag, o 5.1 devolve só o id: %s %v", l, err)
	}
	if _, err := criar(livre, "A9"); err == nil || errors.Is(err, autz.ErrNegado) {
		t.Errorf("sem a flag, FK inexistente continua erro do banco (409): %v", err)
	}
}
