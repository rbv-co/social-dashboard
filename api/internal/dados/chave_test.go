package dados

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

// loja: chave loja_id (bigint); lida e editada por quem vê a conta, criada por quem tem o módulo frota,
// apagada por super pela ficha.
const catalogoDaChave = `[
 {"tabela":"loja","nome":"le","tipo":"permissive","comando":"select","papeis":["authenticated"],"using":"pode_ver_conta(conta)","withCheck":null},
 {"tabela":"loja","nome":"cria","tipo":"permissive","comando":"insert","papeis":["authenticated"],"using":null,"withCheck":"is_frota_admin()"},
 {"tabela":"loja","nome":"edita","tipo":"permissive","comando":"update","papeis":["authenticated"],"using":"pode_ver_conta(conta)","withCheck":"pode_ver_conta(conta)"},
 {"tabela":"loja","nome":"apaga","tipo":"permissive","comando":"delete","papeis":["authenticated"],"using":"superadmin_pela_ficha()","withCheck":null}
]`

func mundoDaChave(t *testing.T) (*autz.Catalogo, func(e *autz.Escopo, f func(tx pgx.Tx) error) error, func(string) string) {
	t.Helper()
	cat, err := autz.Compilar([]byte(catalogoDaChave))
	if err != nil {
		t.Fatal(err)
	}
	p := testebanco.Novo(t)
	ctx := context.Background()
	if _, err := p.Exec(ctx, `create table loja (loja_id bigint primary key, conta text, nome text not null default 'sem nome', n int);
		insert into loja values (1, 'A1', 'um', 10), (2, 'A2', 'dois', 20)`); err != nil {
		t.Fatal(err)
	}
	como := func(e *autz.Escopo, f func(tx pgx.Tx) error) error { return banco.ComUsuario(ctx, p, e.ID, f) }
	um := func(sql string) string {
		var v *string
		if err := p.QueryRow(ctx, sql).Scan(&v); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
		if v == nil {
			return "<nulo>"
		}
		return *v
	}
	return cat, como, um
}

var (
	frotaA1 = &autz.Escopo{ID: quemEscreve, TemPerfil: true, Ativo: true, Modulos: []string{"frota"}, Contas: []string{"A1"}}
	soA1    = &autz.Escopo{ID: quemEscreve, TemPerfil: true, Ativo: true, Contas: []string{"A1"}}
	superF  = &autz.Escopo{ID: quemEscreve, TemPerfil: true, Ativo: true, SuperFicha: true}
)

func raw(s string) json.RawMessage { return json.RawMessage(s) }

func TestTabelaComChave(t *testing.T) {
	cat, como, um := mundoDaChave(t)
	ctx := context.Background()
	tab := Tabela{Nome: "loja", Chave: "loja_id", Resposta: "t.loja_id, t.conta, t.nome, t.n"}
	if err := tab.Validar(cat); err != nil {
		t.Fatal(err)
	}
	if (Tabela{Nome: "loja", Chave: "loja_id; drop table loja", Resposta: "t.loja_id"}).Validar(cat) == nil {
		t.Fatal("chave inválida validou")
	}
	editar := func(e *autz.Escopo, chave string, campos map[string]any) (l []byte, err error) {
		err = como(e, func(tx pgx.Tx) error { l, err = tab.Editar(ctx, tx, cat, e, chave, campos); return err })
		return l, err
	}
	gravar := func(tb Tabela, e *autz.Escopo, campos map[string]any) (l []byte, err error) {
		err = como(e, func(tx pgx.Tx) error { l, err = tb.Gravar(ctx, tx, cat, e, campos); return err })
		return l, err
	}
	linha := func(k string) string {
		return um("select conta || '/' || nome || '/' || coalesce(n::text, '-') from loja where loja_id = " + k)
	}

	// Editar pela chave: a MESMA conferência do PodeEditar, achando a linha por loja_id
	if l, err := editar(soA1, "1", map[string]any{"nome": raw(`"um!"`)}); err != nil || !strings.Contains(string(l), `"nome":"um!"`) {
		t.Errorf("edita pela chave: %s %v", l, err)
	}
	if _, err := editar(soA1, "2", map[string]any{"nome": raw(`"x"`)}); !errors.Is(err, autz.ErrNaoEncontrado) || linha("2") != "A2/dois/20" {
		t.Errorf("outra conta = %v (IDOR)", err)
	}
	if _, err := editar(soA1, "1", map[string]any{"conta": raw(`"A2"`)}); !errors.Is(err, autz.ErrNegado) || linha("1") != "A1/um!/10" {
		t.Errorf("mover para conta que não vê = %v", err)
	}
	if _, err := editar(soA1, "1", map[string]any{"loja_id": raw(`9`)}); !errors.Is(err, ErrColunaProibida) || linha("1") != "A1/um!/10" {
		t.Errorf("mudar a própria chave = %v", err)
	}
	if _, err := editar(soA1, "x", map[string]any{"nome": raw(`"x"`)}); !errors.Is(err, autz.ErrNaoEncontrado) {
		t.Errorf("chave que não é número = %v", err)
	}

	// Gravar: edita o que existe (só as colunas presentes), cria o que não existe
	if _, err := gravar(tab, frotaA1, map[string]any{"loja_id": raw(`3`), "conta": raw(`"A1"`), "nome": raw(`"tres"`)}); err != nil || linha("3") != "A1/tres/-" {
		t.Errorf("cria pela chave: %v %s", err, linha("3"))
	}
	if _, err := gravar(tab, frotaA1, map[string]any{"loja_id": raw(`1`), "nome": raw(`"um de novo"`)}); err != nil || linha("1") != "A1/um de novo/10" {
		t.Errorf("edita o que existe sem mexer no ausente: %v %s", err, linha("1"))
	}
	if _, err := gravar(tab, soA1, map[string]any{"loja_id": raw(`1`), "n": raw(`11`)}); err != nil || linha("1") != "A1/um de novo/11" {
		t.Errorf("quem só edita grava a que existe: %v", err)
	}
	if _, err := gravar(tab, soA1, map[string]any{"loja_id": raw(`4`), "conta": raw(`"A1"`)}); !errors.Is(err, autz.ErrNegado) || um("select count(*)::text from loja where loja_id = 4") != "0" {
		t.Errorf("sem a regra de criar = %v", err)
	}
	if _, err := gravar(tab, frotaA1, map[string]any{"loja_id": raw(`2`), "nome": raw(`"x"`)}); !errors.Is(err, autz.ErrNaoEncontrado) || linha("2") != "A2/dois/20" {
		t.Errorf("existe e não se lê = %v (sem oráculo, intacta)", err)
	}
	if _, err := gravar(tab, frotaA1, map[string]any{"nome": raw(`"sem chave"`)}); err == nil {
		t.Error("gravar sem a chave passou")
	}
	if _, err := gravar(tab, frotaA1, map[string]any{"loja_id": raw(`5`)}); err == nil || um("select count(*)::text from loja where loja_id = 5") != "0" {
		t.Error("gravar só a chave passou")
	}
	if _, err := gravar(Tabela{Nome: "loja", Chave: "loja_id", Resposta: "t.loja_id", CriarSoLegivel: true}, frotaA1,
		map[string]any{"loja_id": raw(`6`), "nome": raw(`"x"`)}); !errors.Is(err, autz.ErrDeclaracao) {
		t.Errorf("Gravar com CriarSoLegivel = %v", err)
	}

	// Apagar pela chave
	var err error
	if err = como(soA1, func(tx pgx.Tx) error { return tab.Apagar(ctx, tx, cat, soA1, "1") }); !errors.Is(err, autz.ErrNegado) {
		t.Errorf("apagar sem a regra = %v", err)
	}
	if err = como(superF, func(tx pgx.Tx) error { return tab.Apagar(ctx, tx, cat, superF, "2") }); err != nil || um("select count(*)::text from loja where loja_id = 2") != "0" {
		t.Errorf("super apaga pela chave: %v", err)
	}
}

// Duas transações gravando a MESMA chave nova ao mesmo tempo: as duas passam e fica uma linha.
func TestGravarSemCorrida(t *testing.T) {
	cat, como, um := mundoDaChave(t)
	ctx := context.Background()
	tab := Tabela{Nome: "loja", Chave: "loja_id", Resposta: "t.loja_id"}
	for i := range 20 {
		k := fmt.Sprint(100 + i)
		var wg sync.WaitGroup
		largada := make(chan struct{})
		erros := make([]error, 2)
		for lado := range 2 {
			wg.Add(1)
			go func() {
				defer wg.Done()
				<-largada
				erros[lado] = como(frotaA1, func(tx pgx.Tx) error {
					_, err := tab.Gravar(ctx, tx, cat, frotaA1, map[string]any{"loja_id": raw(k), "conta": raw(`"A1"`), "n": raw(fmt.Sprint(lado))})
					return err
				})
			}()
		}
		close(largada)
		wg.Wait()
		if erros[0] != nil || erros[1] != nil {
			t.Fatalf("chave %s: %v / %v", k, erros[0], erros[1])
		}
		if v := um("select count(*)::text from loja where loja_id = " + k); v != "1" {
			t.Fatalf("chave %s: %s linhas", k, v)
		}
	}
}
