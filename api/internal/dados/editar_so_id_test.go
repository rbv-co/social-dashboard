package dados

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

// Editar passa e Ler não: a regra confere a linha nova ANTES dos gatilhos (Ler + WITH CHECK), mas a
// resposta lê a linha DEPOIS deles. Um gatilho que tira a linha do alcance de quem editou (aqui, move
// para a conta A2 que ela não vê) faz a edição responder 200 só com o {"id"} (contrato II.2) — nem
// ErrNegado (esse é do CriarSoLegivel; a gravação aconteceu) nem ErrNaoEncontrado. Trocar o `false` por
// `true` na chamada de devolver em Tabela.Editar passaria a devolver ErrNegado e este teste reprova.
func TestEditarQuePassaELerNaoDevolveSoOId(t *testing.T) {
	cat, err := autz.Compilar([]byte(catalogoDeEscrita))
	if err != nil {
		t.Fatal(err)
	}
	p := testebanco.Novo(t)
	ctx := context.Background()
	if _, err := p.Exec(ctx, `create table coisa (id uuid primary key, account_id text, nome text);
		create function leva_para_a2() returns trigger language plpgsql as
		  $$ begin if new.nome = 'move' then new.account_id := 'A2'; end if; return new; end $$;
		create trigger leva_para_a2 before update on coisa for each row execute function leva_para_a2();
		insert into coisa values ('`+coisaA1+`', 'A1', 'um')`); err != nil {
		t.Fatal(err)
	}
	e := &autz.Escopo{ID: quemEscreve, TemPerfil: true, Ativo: true, SemTrava: true, Contas: []string{"A1"}}
	tb := Tabela{Nome: "coisa", Resposta: "t.id, t.account_id, t.nome"}
	editar := func(campos map[string]any) (l []byte, err error) {
		err = banco.ComUsuario(ctx, p, e.ID, func(tx pgx.Tx) (err error) {
			l, err = tb.Editar(ctx, tx, cat, e, coisaA1, campos)
			return err
		})
		return l, err
	}
	if l, err := editar(map[string]any{"nome": "dois"}); err != nil || string(l) != `{"id":"`+coisaA1+`","account_id":"A1","nome":"dois"}` {
		t.Fatalf("edição que ela continua lendo: %s %v", l, err)
	}
	l, err := editar(map[string]any{"nome": "move"})
	if err != nil || string(l) != `{"id":"`+coisaA1+`"}` {
		t.Errorf("edição que o gatilho tira da leitura: %s %v, esperava só o id", l, err)
	}
	var conta string
	if err := p.QueryRow(ctx, `select account_id from coisa where id = $1`, coisaA1).Scan(&conta); err != nil || conta != "A2" {
		t.Errorf("a gravação não ficou: conta %q %v", conta, err)
	}
	// agora a linha está fora da leitura: uma nova edição não a acha (404, nada muda)
	if _, err := editar(map[string]any{"nome": "tres"}); !errors.Is(err, autz.ErrNaoEncontrado) {
		t.Errorf("editar o que não lê = %v, esperava não encontrado", err)
	}
}
