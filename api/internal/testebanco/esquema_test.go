package testebanco

import (
	"context"
	"errors"
	"reflect"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
)

// A fatia 5.1 do esquema de produção: os gatilhos VERBATIM disparam com a identidade da transação
// (banco.ComUsuario). Sem identidade, guard_profiles confia (contexto de serviço) e tudo passa.
func TestEsquemaDeProducaoComOsGatilhosVerbatim(t *testing.T) {
	p := ComEsquemaDeProducao(t)
	ctx := context.Background()
	const (
		super = "5e000000-0000-4000-a000-000000000001" // breno@rbvcompany.com: na lista de is_superadmin()
		admin = "5e000000-0000-4000-a000-000000000002"
		outra = "5e000000-0000-4000-a000-000000000003"
		erick = "5e000000-0000-4000-a000-000000000004"
		grupo = "c6000000-0000-4000-a000-000000000001"
		time1 = "e1000000-0000-4000-a000-000000000001"
	)
	if _, err := p.Exec(ctx, `
		insert into usuarios (id, email) values ('`+super+`', 'breno@rbvcompany.com'), ('`+admin+`', 'admin@x.com'),
		  ('`+outra+`', 'outra@x.com'), ('`+erick+`', 'erick@rbvcompany.com');
		insert into profiles (id, email, role, is_superadmin) values ('`+super+`', 'breno@rbvcompany.com', 'admin', true),
		  ('`+admin+`', 'admin@x.com', 'admin', false), ('`+outra+`', 'outra@x.com', 'viewer', false),
		  ('`+erick+`', 'erick@rbvcompany.com', 'admin', true);
		insert into canais_grupos (id, nome) values ('`+grupo+`', 'Varejo');
		insert into bling_lojas (loja_id, nome, grupo_id) values (3, 'Loja 3', '`+grupo+`');
		insert into equipes (id, nome, canal_loja_id, atualizado_em) values ('`+time1+`', 'Time 1', 3, '2026-01-01T00:00:00Z');`); err != nil {
		t.Fatal(err)
	}
	var gat []string
	linhas, _ := p.Query(ctx, `select tgname::text from pg_trigger where not tgisinternal order by 1`)
	for linhas.Next() {
		var n string
		linhas.Scan(&n)
		gat = append(gat, n)
	}
	if quer := []string{"equipes_atualizado", "trg_espelhar_grupo_do_canal", "trg_espelhar_rename_do_grupo",
		"trg_guard_profiles", "trg_impedir_autopromocao"}; !reflect.DeepEqual(gat, quer) {
		t.Fatalf("gatilhos = %v, esperava %v", gat, quer)
	}

	como := func(id, sql string) error {
		return banco.ComUsuario(ctx, p, id, func(tx pgx.Tx) error { _, err := tx.Exec(ctx, sql); return err })
	}
	codigo := func(err error) string {
		var pe *pgconn.PgError
		if errors.As(err, &pe) {
			return pe.Code
		}
		return ""
	}
	um := func(sql string) string {
		var v string
		if err := p.QueryRow(ctx, sql).Scan(&v); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
		return v
	}

	// negados: o gatilho barra e a linha fica como estava
	if err := como(admin, `update profiles set role = 'admin' where id = '`+outra+`'`); codigo(err) != "P0001" {
		t.Errorf("admin comum mudou o cargo: %v", err)
	}
	if err := como(admin, `update profiles set permissions = '{"frota":["ver"]}' where id = '`+admin+`'`); codigo(err) != "42501" {
		t.Errorf("admin comum mudou o próprio acesso: %v", err)
	}
	if err := como(admin, `update profiles set name = 'x' where id = '`+erick+`'`); codigo(err) != "P0001" {
		t.Errorf("admin comum mexeu no perfil do erick: %v", err)
	}
	if v := um(`select string_agg(role || '/' || permissions::text || '/' || coalesce(name, '-'), ',' order by email)
		from profiles where id in ('` + admin + `', '` + erick + `', '` + outra + `')`); v != "admin/{}/-,admin/{}/-,viewer/{}/-" {
		t.Errorf("negado gravou: %s", v)
	}
	// permitidos, com o rastro de QUEM mudou
	if err := como(super, `update profiles set role = 'admin' where id = '`+outra+`'`); err != nil {
		t.Errorf("super por e-mail não mudou o cargo: %v", err)
	}
	if err := como(admin, `update profiles set permissions = '{"frota":["ver"]}' where id = '`+outra+`'`); err != nil {
		t.Errorf("admin não mudou permissões de outra pessoa: %v", err)
	}
	if v := um(`select count(*) filter (where action = 'role_change' and actor_id = '` + super + `')::text || '/' ||
		count(*) filter (where action = 'acesso_change' and actor_id = '` + admin + `')::text from audit_log`); v != "1/1" {
		t.Errorf("rastro role_change/acesso_change = %s, esperava 1/1", v)
	}
	// sem identidade o guard confia: por isso TODA escrita roda em banco.ComUsuario
	if _, err := p.Exec(ctx, `update profiles set role = 'viewer' where id = '`+outra+`'`); err != nil {
		t.Errorf("sem identidade: %v", err)
	}
	// espelho do nome do grupo, atualizado_em e default auth.uid()
	if err := como(super, `update canais_grupos set nome = 'Varejo Físico' where id = '`+grupo+`'`); err != nil {
		t.Fatal(err)
	}
	if v := um(`select grupo from bling_lojas where loja_id = 3`); v != "Varejo Físico" {
		t.Errorf("bling_lojas.grupo = %q", v)
	}
	if err := como(super, `update equipes set nome = 'Time Um' where id = '`+time1+`'`); err != nil {
		t.Fatal(err)
	}
	if v := um(`select (atualizado_em > '2026-01-02')::text from equipes where id = '` + time1 + `'`); v != "true" {
		t.Error("equipes_toca_atualizado não rodou")
	}
	if err := como(super, `insert into equipes_membros (equipe_id, profile_id) values ('`+time1+`', '`+outra+`')`); err != nil {
		t.Fatal(err)
	}
	if v := um(`select criado_por::text from equipes_membros`); v != super {
		t.Errorf("criado_por = %s, esperava quem gravou", v)
	}
}
