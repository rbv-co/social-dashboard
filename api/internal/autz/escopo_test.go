package autz

import (
	"context"
	"reflect"
	"slices"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
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

func executar(t *testing.T, p *pgxpool.Pool, sql string) {
	t.Helper()
	if _, err := p.Exec(context.Background(), sql); err != nil {
		t.Fatalf("montar o mundo do teste: %v", err)
	}
}

func carregar(t *testing.T, p *pgxpool.Pool, quem string) *Escopo {
	t.Helper()
	e, err := CarregarEscopo(context.Background(), p, quem)
	if err != nil {
		t.Fatalf("CarregarEscopo(%s): %v", quem, err)
	}
	slices.Sort(e.Canais)
	slices.Sort(e.Locais)
	slices.Sort(e.Pessoas)
	slices.Sort(e.Grupos)
	slices.Sort(e.Depositos)
	return e
}

func confere(t *testing.T, nome string, e, quer *Escopo) {
	t.Helper()
	if !reflect.DeepEqual(e, quer) {
		t.Fatalf("%s =\n%+v\nesperava\n%+v", nome, e, quer)
	}
}

func TestCarregarEscopo(t *testing.T) {
	p := testebanco.Novo(t)
	testebanco.TabelasDoEscopo(t, p)
	const (
		g2  = "c0000000-0000-4000-a000-000000000002"
		pe2 = "9e000000-0000-4000-a000-000000000002"
	)
	executar(t, p, `
		insert into profiles (id, email, role, is_superadmin, disabled, escopo_por_equipe, features, permissions, allowed_accounts) values
		  ('`+eu+`', 'eu@x', 'viewer', false, false, true, '{frota,null}', '{"atendimentos":["ver",1,"editar"],"meta.hora":true}', '{A1}'),
		  ('`+outra+`', 'outra@x', 'admin', false, false, true, '{}', '{}', null);
		insert into equipes (id, canal_loja_id, local_id, deposito_id) values
		  ('`+t1+`', 1, '`+l1+`', 11), ('`+t2+`', 2, null, 12), ('`+t3+`', 3, null, 13), ('`+t4+`', 4, null, 14);
		insert into bling_lojas (loja_id, grupo_id) values (1, null), (3, '`+g1+`'), (5, '`+g1+`');
		insert into equipes_membros (equipe_id, profile_id, papel) values
		  ('`+t1+`', '`+eu+`', 'vendedora'), ('`+t4+`', '`+eu+`', null),
		  ('`+t2+`', '`+outra+`', 'gestor'), ('`+t4+`', '`+outra+`', 'vendedora');
		-- eu é supervisora do grupo G1; outra é só 'membro' de G1 (não vira supervisora) e de G2
		insert into canais_grupos_membros (grupo_id, profile_id, papel) values
		  ('`+g1+`', '`+eu+`', 'supervisora'), ('`+g1+`', '`+outra+`', 'membro'), ('`+g2+`', '`+outra+`', 'membro');
		-- a chave estoque é de eu; outra é membro direta de T4 mas SEM a chave
		insert into equipes_permissoes (equipe_id, profile_id, chave) values ('`+t4+`', '`+eu+`', 'estoque'), ('`+t2+`', '`+eu+`', 'estoque');
		insert into acessos_pessoas (id, profile_id) values ('`+pe1+`', '`+eu+`'), ('`+pe2+`', '`+outra+`');`)

	queroEu := &Escopo{
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
	// outra: nada de eu vaza (grupo, pessoa, chave de estoque) e 'membro' de grupo não é supervisora
	queroOutra := &Escopo{
		ID: outra, TemPerfil: true, Ativo: true, Email: "outra@x", Papel: "admin", Modulos: []string{},
		Chaves: map[string]bool{}, Acoes: map[string][]string{}, TodasContas: true,
		Vinculos: map[string][]string{t2: {"gestor"}, t4: {"vendedora"}},
		Diretos:  map[string][]string{t2: {"gestor"}, t4: {"vendedora"}},
		Canais:   []int64{2, 4}, Locais: []string{}, Pessoas: []string{pe2}, Grupos: []string{g1, g2},
		Depositos: []int64{12}, // T2 (gestor); T4 sem a chave estoque não conta
	}
	confere(t, "eu", carregar(t, p, eu), queroEu)
	confere(t, "outra", carregar(t, p, outra), queroOutra)

	// sem perfil: ativo (conta_ativa() dá true), nada mais; nenhuma conta liberada, nenhuma trava aberta
	confere(t, "sem perfil", carregar(t, p, "11111111-0000-4000-a000-000000000009"), &Escopo{
		ID: "11111111-0000-4000-a000-000000000009", Ativo: true, Chaves: map[string]bool{}, Acoes: map[string][]string{},
		Vinculos: map[string][]string{}, Diretos: map[string][]string{},
		Canais: []int64{}, Locais: []string{}, Pessoas: []string{}, Grupos: []string{},
	})

	// desativada, com permissions em lista: Ativo=false, chaves só dos textos; os vínculos continuam
	// preenchidos (quem consome o Escopo é que nega por Ativo) e a outra pessoa não muda
	executar(t, p, `update profiles set disabled = true, permissions = '["meta.opr", 3]' where id = '`+eu+`'`)
	queroEu.Ativo = false
	queroEu.Chaves = map[string]bool{"meta.opr": true}
	queroEu.Acoes = map[string][]string{}
	confere(t, "eu desativada", carregar(t, p, eu), queroEu)
	confere(t, "outra depois de eu desativada", carregar(t, p, outra), queroOutra)
}

// Perfis no limite do formato: a falta de dado nunca amplia o acesso.
func TestCarregarEscopoPerfisNoLimite(t *testing.T) {
	p := testebanco.Novo(t)
	testebanco.TabelasDoEscopo(t, p)
	const (
		semEscopo = "11111111-0000-4000-a000-0000000000a1"
		vazia     = "11111111-0000-4000-a000-0000000000a2"
		nulo      = "11111111-0000-4000-a000-0000000000a3"
		maiuscula = "11111111-0000-4000-a000-0000000000a4"
	)
	executar(t, p, `
		insert into profiles (id, email, role, escopo_por_equipe, allowed_accounts) values
		  ('`+semEscopo+`', 'a1@x', 'viewer', null, null),
		  ('`+vazia+`', 'a2@x', 'viewer', true, '{}'),
		  ('`+nulo+`', 'a3@x', 'viewer', true, '{A1,NULL}'),
		  ('`+maiuscula+`', 'a4@x', 'Admin', true, null);`)

	// escopo_por_equipe nulo = RESTRITO (a coluna de produção é NOT NULL default true; a função
	// de produção dá false quando não acha o valor): nunca abre a trava
	if e := carregar(t, p, semEscopo); e.SemTrava || !e.TemPerfil || !e.TodasContas {
		t.Errorf("escopo_por_equipe nulo: SemTrava=%v (esperava false), %+v", e.SemTrava, e)
	}
	// allowed_accounts '{}' é "nenhuma conta", NÃO "todas as contas"
	if e := carregar(t, p, vazia); e.TodasContas || e.Contas == nil || len(e.Contas) != 0 {
		t.Errorf("allowed_accounts '{}': TodasContas=%v Contas=%#v (esperava false e lista vazia)", e.TodasContas, e.Contas)
	}
	// elemento nulo no array não derruba a pessoa (erro de Scan = 500 em toda requisição) nem libera conta
	if e := carregar(t, p, nulo); e.TodasContas || !reflect.DeepEqual(e.Contas, []string{"A1"}) {
		t.Errorf("allowed_accounts '{A1,NULL}': TodasContas=%v Contas=%#v (esperava false e [A1])", e.TodasContas, e.Contas)
	}
	// o papel vai como está no banco: 'Admin' não casa 'admin'
	if e := carregar(t, p, maiuscula); e.Papel != "Admin" {
		t.Errorf("papel = %q, esperava \"Admin\" (sem normalizar caixa)", e.Papel)
	}
}
