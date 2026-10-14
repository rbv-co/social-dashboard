package autz_test

import (
	"context"
	"reflect"
	"testing"

	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

// No esquema de produção escopo_por_equipe tem default true: o robô criado pelo CLI tem de sair SEM
// trava de equipe (e sem lista de contas), igual a um viewer sem trava; senão leria "restrito sem vínculo".
func TestRoboDoCLILeOQueUmViewerSemTravaLe(t *testing.T) {
	p := testebanco.ComEsquemaDeProducao(t)
	ctx := context.Background()
	if _, err := auth.NovoStore(p).CriarContaDeServico(ctx, "fabrica", "fabrica@robos.invalid", []string{"meta"}); err != nil {
		t.Fatal(err)
	}
	const ctl = "5e130000-0000-4000-a000-0000000000c1"
	if _, err := p.Exec(ctx, `insert into usuarios (id, email) values ($1::uuid, 'ctl@x.com')`, ctl); err != nil {
		t.Fatal(err)
	}
	if _, err := p.Exec(ctx, `insert into profiles (id, email, name, role, features, escopo_por_equipe) values ($1::uuid, 'ctl@x.com', 'ctl', 'viewer', '{meta}', false)`, ctl); err != nil {
		t.Fatal(err)
	}
	var robo string
	if err := p.QueryRow(ctx, `select id::text from usuarios where email = 'fabrica@robos.invalid'`).Scan(&robo); err != nil {
		t.Fatal(err)
	}
	er, err := autz.CarregarEscopo(ctx, p, robo)
	if err != nil {
		t.Fatal(err)
	}
	ec, err := autz.CarregarEscopo(ctx, p, ctl)
	if err != nil {
		t.Fatal(err)
	}
	if !er.SemTrava || !er.TodasContas {
		t.Fatalf("robô: SemTrava=%v TodasContas=%v, esperava os dois true", er.SemTrava, er.TodasContas)
	}
	er.ID, er.Email, ec.ID, ec.Email = "", "", "", ""
	if !reflect.DeepEqual(er, ec) {
		t.Fatalf("escopo do robô difere do viewer sem trava:\n%+v\n%+v", er, ec)
	}
}
