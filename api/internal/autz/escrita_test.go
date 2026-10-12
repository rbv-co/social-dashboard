package autz

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

// CatalogoDeTeste: "coisa" lida por conta (restritiva), editada por quem vê a conta (antes E
// depois), criada por quem tem o módulo frota e apagada só por super-admin. "conta" é lida só
// por quem a tem em allowed_accounts.
const CatalogoDeTeste = `[
 {"tabela":"conta","nome":"le","tipo":"permissive","comando":"select","papeis":["authenticated"],"using":"(auth.role() = 'authenticated'::text)","withCheck":null},
 {"tabela":"conta","nome":"so","tipo":"restrictive","comando":"select","papeis":["authenticated"],"using":"pode_ver_conta((id)::text)","withCheck":null},
 {"tabela":"coisa","nome":"le","tipo":"permissive","comando":"select","papeis":["public"],"using":"true","withCheck":null},
 {"tabela":"coisa","nome":"so","tipo":"restrictive","comando":"select","papeis":["authenticated"],"using":"pode_ver_conta(account_id)","withCheck":null},
 {"tabela":"coisa","nome":"edita","tipo":"permissive","comando":"update","papeis":["authenticated"],"using":"pode_ver_conta(account_id)","withCheck":"pode_ver_conta(account_id)"},
 {"tabela":"coisa","nome":"cria","tipo":"permissive","comando":"insert","papeis":["authenticated"],"using":null,"withCheck":"is_frota_admin()"},
 {"tabela":"coisa","nome":"apaga","tipo":"permissive","comando":"delete","papeis":["authenticated"],"using":"superadmin_pela_ficha()","withCheck":null},
 {"tabela":"coisa","nome":"servico","tipo":"permissive","comando":"all","papeis":["service_role"],"using":"true","withCheck":null}
]`

const (
	coisaA1 = "aaaaaaaa-0000-4000-a000-000000000001"
	coisaA2 = "aaaaaaaa-0000-4000-a000-000000000002"
)

func escopoComContas(contas ...string) *Escopo {
	return &Escopo{ID: "11111111-0000-4000-a000-000000000001", TemPerfil: true, Ativo: true, SemTrava: true, Contas: contas}
}

func mundoDeEscrita(t *testing.T) (*Catalogo, pgx.Tx) {
	t.Helper()
	cat, err := Compilar([]byte(CatalogoDeTeste))
	if err != nil {
		t.Fatal(err)
	}
	p := testebanco.Novo(t)
	ctx := context.Background()
	if _, err := p.Exec(ctx, `create table conta (id text primary key);
		create table coisa (id uuid primary key, account_id text, nome text);
		insert into conta values ('A1'), ('A2');
		insert into coisa values ('`+coisaA1+`', 'A1', 'um'), ('`+coisaA2+`', 'A2', 'dois')`); err != nil {
		t.Fatal(err)
	}
	tx, err := p.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { tx.Rollback(ctx) })
	return cat, tx
}

func TestPodeEditar(t *testing.T) {
	cat, tx := mundoDeEscrita(t)
	ctx := context.Background()
	a1 := escopoComContas("A1")
	casos := []struct {
		nome     string
		tab      string
		id       string
		mudancas map[string]any
		quer     error
	}{
		{"a própria conta", "coisa", coisaA1, map[string]any{"nome": "novo"}, nil},
		{"linha de outra conta é 404, não 403 (IDOR)", "coisa", coisaA2, map[string]any{"nome": "x"}, ErrNaoEncontrado},
		{"mover para conta que não vê", "coisa", coisaA1, map[string]any{"account_id": "A2"}, ErrNegado},
		// pode_ver_conta(null) é true em produção (linha sem conta é de todos): mover para null passa
		{"mover para sem conta (null), como a RLS de produção", "coisa", coisaA1, map[string]any{"account_id": nil}, nil},
		{"id que não existe", "coisa", "aaaaaaaa-0000-4000-a000-000000000009", map[string]any{"nome": "x"}, ErrNaoEncontrado},
		{"id que nem é uuid", "coisa", "1 or 1=1", map[string]any{"nome": "x"}, ErrNaoEncontrado},
		{"vê a linha mas a tabela não tem policy de update: 403", "conta", "A1", map[string]any{"id": "A1"}, ErrNegado},
		{"conta que não vê: 404", "conta", "A2", map[string]any{}, ErrNaoEncontrado},
	}
	for _, c := range casos {
		if err := cat.PodeEditar(ctx, tx, a1, c.tab, c.id, c.mudancas); !errors.Is(err, c.quer) {
			t.Errorf("%s: %v, esperava %v", c.nome, err, c.quer)
		}
	}
	if err := cat.PodeEditar(ctx, tx, escopoComContas("A1", "A2"), "coisa", coisaA1, map[string]any{"account_id": "A2"}); err != nil {
		t.Errorf("quem vê as duas contas move: %v", err)
	}
	if err := cat.PodeEditar(ctx, tx, nil, "coisa", coisaA1, nil); err == nil {
		t.Error("sem escopo passou")
	}
	sem := escopoComContas() // vê nenhuma conta
	if err := cat.PodeEditar(ctx, tx, sem, "coisa", coisaA1, map[string]any{"nome": "x"}); !errors.Is(err, ErrNaoEncontrado) {
		t.Errorf("sem conta nenhuma: %v", err)
	}
	if err := cat.PodeEditar(ctx, tx, a1, "fora_do_catalogo", coisaA1, nil); !errors.Is(err, ErrRecursoDesconhecido) {
		t.Errorf("tabela fora do catálogo: %v", err)
	}
	// a conferência não grava: as duas linhas seguem como estavam
	var n int
	if err := tx.QueryRow(ctx, `select count(*) from coisa where nome in ('um', 'dois') and account_id in ('A1', 'A2')`).Scan(&n); err != nil || n != 2 {
		t.Errorf("a conferência alterou dados: n=%d err=%v", n, err)
	}
}

func TestPodeApagarECriar(t *testing.T) {
	cat, tx := mundoDeEscrita(t)
	ctx := context.Background()
	super := escopoComContas()
	super.SuperFicha = true
	if err := cat.PodeApagar(ctx, tx, escopoComContas("A1"), "coisa", coisaA1); !errors.Is(err, ErrNegado) {
		t.Errorf("quem só vê apaga: %v", err)
	}
	if err := cat.PodeApagar(ctx, tx, escopoComContas("A1"), "coisa", coisaA2); !errors.Is(err, ErrNaoEncontrado) {
		t.Errorf("apagar linha que não vê: %v", err)
	}
	if err := cat.PodeApagar(ctx, tx, super, "coisa", coisaA2); err != nil {
		t.Errorf("super-admin apaga: %v", err)
	}
	if err := cat.PodeApagar(ctx, tx, super, "coisa", "aaaaaaaa-0000-4000-a000-000000000009"); !errors.Is(err, ErrNaoEncontrado) {
		t.Errorf("apagar o que não existe: %v", err)
	}
	if err := cat.PodeApagar(ctx, tx, nil, "coisa", coisaA1); err == nil {
		t.Error("apagar sem escopo passou")
	}
	frota := escopoComContas()
	frota.Modulos = []string{"frota"}
	if err := cat.PodeCriar(ctx, tx, frota, "coisa", map[string]any{"account_id": "A2"}); err != nil {
		t.Errorf("módulo frota cria: %v", err)
	}
	if err := cat.PodeCriar(ctx, tx, escopoComContas("A1"), "coisa", map[string]any{"account_id": "A1"}); !errors.Is(err, ErrNegado) {
		t.Errorf("sem frota cria: %v", err)
	}
	if err := cat.PodeCriar(ctx, tx, nil, "coisa", nil); err == nil {
		t.Error("criar sem escopo passou")
	}
	if err := cat.PodeCriar(ctx, tx, frota, "fora_do_catalogo", nil); !errors.Is(err, ErrRecursoDesconhecido) {
		t.Errorf("criar em tabela fora do catálogo: %v", err)
	}
	frota.Ativo = false
	if err := cat.PodeCriar(ctx, tx, frota, "coisa", nil); !errors.Is(err, ErrNegado) {
		t.Errorf("conta desativada cria: %v", err)
	}
}
