package autz

import (
	"context"
	"reflect"
	"slices"
	"testing"

	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

const (
	eu    = "11111111-0000-4000-a000-000000000001"
	outra = "11111111-0000-4000-a000-000000000002"
	t1    = "e0000000-0000-4000-a000-000000000001"
	t2    = "e0000000-0000-4000-a000-000000000002"
	t3    = "e0000000-0000-4000-a000-000000000003"
	t4    = "e0000000-0000-4000-a000-000000000004"
	g1    = "c0000000-0000-4000-a000-000000000001"
	l1    = "10c00000-0000-4000-a000-000000000001"
	pe1   = "9e000000-0000-4000-a000-000000000001"
)

func TestCarregarEscopo(t *testing.T) {
	p := testebanco.Novo(t)
	testebanco.TabelasDoEscopo(t, p)
	ctx := context.Background()
	if _, err := p.Exec(ctx, `
		insert into profiles (id, email, role, is_superadmin, disabled, escopo_por_equipe, features, permissions, allowed_accounts) values
		  ('`+eu+`', 'eu@x', 'viewer', false, false, true, '{frota,null}', '{"atendimentos":["ver",1,"editar"],"meta.hora":true}', '{A1}'),
		  ('`+outra+`', 'outra@x', 'admin', false, false, true, '{}', '{}', null);
		insert into equipes (id, canal_loja_id, local_id, deposito_id) values
		  ('`+t1+`', 1, '`+l1+`', 11), ('`+t2+`', 2, null, 12), ('`+t3+`', 3, null, 13), ('`+t4+`', 4, null, 14);
		insert into bling_lojas (loja_id, grupo_id) values (1, null), (3, '`+g1+`'), (5, '`+g1+`');
		insert into equipes_membros (equipe_id, profile_id, papel) values
		  ('`+t1+`', '`+eu+`', 'vendedora'), ('`+t4+`', '`+eu+`', null), ('`+t2+`', '`+outra+`', 'gestor');
		insert into canais_grupos_membros (grupo_id, profile_id, papel) values ('`+g1+`', '`+eu+`', 'supervisora');
		insert into equipes_permissoes (equipe_id, profile_id, chave) values ('`+t4+`', '`+eu+`', 'estoque'), ('`+t2+`', '`+eu+`', 'estoque');
		insert into acessos_pessoas (id, profile_id) values ('`+pe1+`', '`+eu+`');`); err != nil {
		t.Fatal(err)
	}
	e, err := CarregarEscopo(ctx, p, eu)
	if err != nil {
		t.Fatal(err)
	}
	slices.Sort(e.Canais)
	quer := &Escopo{
		ID: eu, TemPerfil: true, Ativo: true, Email: "eu@x", Papel: "viewer", Modulos: []string{"frota"},
		Chaves: map[string]bool{"atendimentos": true, "meta.hora": true}, Acoes: map[string][]string{"atendimentos": {"ver", "editar"}},
		SemTrava: false, Contas: []string{"A1"},
		// vínculos: os diretos (T1 vendedora, T4 sem papel) + supervisora de T3 (canal 3 está no grupo G1)
		Vinculos: map[string][]string{t1: {"vendedora"}, t4: {""}, t3: {"supervisora"}},
		Diretos:  map[string][]string{t1: {"vendedora"}, t4: {""}},
		Canais:   []int64{1, 3, 4, 5}, Locais: []string{l1}, Pessoas: []string{pe1}, Grupos: []string{g1},
		// estoque: T3 (supervisora) e T4 (chave estoque + membro); T2 tem a chave mas eu não sou membro
		Depositos: []int64{13, 14},
	}
	if !reflect.DeepEqual(e, quer) {
		t.Fatalf("escopo =\n%+v\nesperava\n%+v", e, quer)
	}
	// sem perfil: ativo (conta_ativa() dá true), nada mais; outra pessoa não vaza para mim
	sem, err := CarregarEscopo(ctx, p, "11111111-0000-4000-a000-000000000009")
	if err != nil || sem.TemPerfil || !sem.Ativo || len(sem.Vinculos) != 0 || sem.TodasContas || len(sem.Canais) != 0 {
		t.Fatalf("sem perfil = %+v %v", sem, err)
	}
	p.Exec(ctx, `update profiles set disabled = true, permissions = '["meta.opr", 3]' where id = '`+eu+`'`)
	e, _ = CarregarEscopo(ctx, p, eu)
	if e.Ativo || !e.Chaves["meta.opr"] || len(e.Acoes) != 0 {
		t.Fatalf("desativado com permissions-lista = %+v", e)
	}
	o, _ := CarregarEscopo(ctx, p, outra)
	if !o.TodasContas || o.Papel != "admin" || !reflect.DeepEqual(o.Vinculos, map[string][]string{t2: {"gestor"}}) || len(o.Depositos) != 1 {
		t.Fatalf("outra = %+v", o)
	}
}
