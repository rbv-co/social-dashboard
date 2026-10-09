package banco_test

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

// uma tabela com trigger que grava quem editou, como as de produção (trilha-de-edicoes)
const fixtura = `
create table coisas (id serial primary key, nome text, editado_por uuid);
create function coisas_quem() returns trigger language plpgsql as $$
begin new.editado_por := auth.uid(); return new; end $$;
create trigger coisas_quem before insert or update on coisas for each row execute function coisas_quem();`

func TestComUsuarioGravaAIdentidadeParaOsTriggers(t *testing.T) {
	p := testebanco.Novo(t)
	ctx := context.Background()
	if _, err := p.Exec(ctx, banco.Compat); err != nil {
		t.Fatal(err)
	}
	if _, err := p.Exec(ctx, fixtura); err != nil {
		t.Fatal(err)
	}

	err := banco.ComUsuario(ctx, p, uidA, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `insert into coisas (nome) values ('a')`)
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	var quem *string
	if err := p.QueryRow(ctx, `select editado_por::text from coisas where nome = 'a'`).Scan(&quem); err != nil {
		t.Fatal(err)
	}
	if quem == nil || *quem != uidA {
		t.Fatalf("editado_por = %v", quem)
	}

	// fora do ComUsuario a identidade não existe (e não sobra da transação anterior)
	if _, err := p.Exec(ctx, `insert into coisas (nome) values ('b')`); err != nil {
		t.Fatal(err)
	}
	quem = nil
	if err := p.QueryRow(ctx, `select editado_por::text from coisas where nome = 'b'`).Scan(&quem); err != nil {
		t.Fatal(err)
	}
	if quem != nil {
		t.Fatalf("a identidade vazou para outra transação: %v", *quem)
	}
}

func TestComUsuarioFazRollbackSeAFuncaoFalhar(t *testing.T) {
	p := testebanco.Novo(t)
	ctx := context.Background()
	if _, err := p.Exec(ctx, banco.Compat); err != nil {
		t.Fatal(err)
	}
	if _, err := p.Exec(ctx, fixtura); err != nil {
		t.Fatal(err)
	}

	falha := errors.New("falhou")
	err := banco.ComUsuario(ctx, p, uidA, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `insert into coisas (nome) values ('x')`); err != nil {
			t.Error(err)
		}
		return falha
	})
	if !errors.Is(err, falha) {
		t.Fatalf("err = %v", err)
	}
	var n int
	if err := p.QueryRow(ctx, `select count(*) from coisas`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatalf("não fez rollback: %d linhas", n)
	}
}

func TestComUsuarioRecusaIDInvalidoSemExecutarAFuncao(t *testing.T) {
	p := testebanco.Novo(t)
	ctx := context.Background()
	if _, err := p.Exec(ctx, banco.Compat); err != nil {
		t.Fatal(err)
	}
	chamou := false
	err := banco.ComUsuario(ctx, p, "nao-e-uuid", func(pgx.Tx) error { chamou = true; return nil })
	if err == nil || chamou {
		t.Fatalf("deveria recusar um id que não é uuid (err=%v, chamou=%v)", err, chamou)
	}
}
