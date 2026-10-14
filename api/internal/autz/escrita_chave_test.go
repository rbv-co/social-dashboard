package autz

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

// "loja" tem chave loja_id (bigint), sem coluna id: lida e editada por quem vê a conta, apagada só por
// super pela ficha. É o caso de bling_lojas, bling_vendedores e bling_pedido_vendedor (Ruling 5.5-2).
const catalogoDaLoja = `[
 {"tabela":"loja","nome":"le","tipo":"permissive","comando":"select","papeis":["authenticated"],"using":"pode_ver_conta(conta)","withCheck":null},
 {"tabela":"loja","nome":"edita","tipo":"permissive","comando":"update","papeis":["authenticated"],"using":"pode_ver_conta(conta)","withCheck":"pode_ver_conta(conta)"},
 {"tabela":"loja","nome":"apaga","tipo":"permissive","comando":"delete","papeis":["authenticated"],"using":"superadmin_pela_ficha()","withCheck":null}
]`

func TestPodeEditarPorOutraColuna(t *testing.T) {
	cat, err := Compilar([]byte(catalogoDaLoja))
	if err != nil {
		t.Fatal(err)
	}
	p := testebanco.Novo(t)
	ctx := context.Background()
	if _, err := p.Exec(ctx, `create table loja (loja_id bigint primary key, conta text, nome text);
		insert into loja values (1, 'A1', 'um'), (2, 'A2', 'dois')`); err != nil {
		t.Fatal(err)
	}
	tx, err := p.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { tx.Rollback(ctx) })
	a1 := escopoComContas("A1")
	editar := func(sp pgx.Tx, e *Escopo, coluna, valor string, m map[string]any) error {
		return cat.PodeEditarPor(ctx, sp, e, "loja", coluna, valor, m)
	}
	if err := editar(tx, a1, "loja_id", "1", map[string]any{"nome": "x"}); err != nil {
		t.Errorf("loja 1 (A1) = %v", err)
	}
	if err := editar(tx, a1, "loja_id", "2", map[string]any{"nome": "x"}); !errors.Is(err, ErrNaoEncontrado) {
		t.Errorf("loja 2 (A2) = %v (IDOR)", err)
	}
	if err := editar(tx, a1, "loja_id", "1", map[string]any{"conta": "A2"}); !errors.Is(err, ErrNegado) {
		t.Errorf("mover para A2 = %v", err)
	}
	if err := editar(tx, a1, "loja_id", "x", map[string]any{"nome": "x"}); !errors.Is(err, ErrNaoEncontrado) {
		t.Errorf("valor que não é número = %v", err)
	}
	// a coluna vem da declaração: nunca texto livre nem coluna que não é única
	if err := editar(tx, a1, "loja_id; drop table loja", "1", nil); !errors.Is(err, ErrDeclaracao) {
		t.Errorf("coluna inválida = %v", err)
	}
	if err := cat.PodeApagarPor(ctx, tx, a1, "loja", "loja_id", "1"); !errors.Is(err, ErrNegado) {
		t.Errorf("apagar sem a regra = %v", err)
	}
	if err := cat.PodeApagarPor(ctx, tx, a1, "loja", "loja_id", "2"); !errors.Is(err, ErrNaoEncontrado) {
		t.Errorf("apagar a de outra conta = %v", err)
	}
	super := &Escopo{ID: a1.ID, TemPerfil: true, Ativo: true, SuperFicha: true}
	if err := cat.PodeApagarPor(ctx, tx, super, "loja", "loja_id", "2"); err != nil {
		t.Errorf("super apaga pela chave = %v", err)
	}
	// "id" não existe em loja: o atalho PodeEditar acha 0 linhas por erro de coluna — não é o caminho de loja
	if err := cat.PodeEditar(ctx, tx, a1, "loja", "1", nil); err == nil {
		t.Error("PodeEditar (id) numa tabela sem id passou")
	}
}
