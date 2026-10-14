package testebanco

import (
	"context"
	"errors"
	"io/fs"
	"reflect"
	"regexp"
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
		-- a FICHA is_superadmin vale o contrário do e-mail de propósito: is_superadmin() lê a lista de e-mails,
		-- então o super por e-mail (ficha falsa) passa e o admin com a ficha marcada é barrado
		insert into profiles (id, email, role, is_superadmin) values ('`+super+`', 'breno@rbvcompany.com', 'admin', false),
		  ('`+admin+`', 'admin@x.com', 'admin', true), ('`+outra+`', 'outra@x.com', 'viewer', false),
		  ('`+erick+`', 'erick@rbvcompany.com', 'admin', true);
		insert into canais_grupos (id, nome) values ('`+grupo+`', 'Varejo');
		insert into bling_lojas (loja_id, nome, grupo_id) values (3, 'Loja 3', '`+grupo+`');
		insert into equipes (id, nome, canal_loja_id, atualizado_em) values ('`+time1+`', 'Time 1', 3, '2026-01-01T00:00:00Z');`); err != nil {
		t.Fatal(err)
	}
	linhas, err := p.Query(ctx, `select tgname::text from pg_trigger where not tgisinternal order by 1`)
	if err != nil {
		t.Fatal(err)
	}
	gat, err := pgx.CollectRows(linhas, pgx.RowTo[string])
	if err != nil {
		t.Fatal(err)
	}
	if quer := []string{"conteudo_pecas_guarda", "equipes_atualizado", "gt_rascunho_updated_at", "trg_bem_de_veiculo_segue_a_frota", "trg_espelhar_grupo_do_canal",
		"trg_espelhar_rename_do_grupo", "trg_frota_aceite_imutavel", "trg_frota_checar_arquivamento",
		"trg_frota_checar_decisao", "trg_frota_checklist_enfileirar_pdf", "trg_frota_checklist_imutavel",
		"trg_frota_espelha_responsavel", "trg_frota_espelha_situacao", "trg_frota_espelha_situacao_no_bem",
		"trg_frota_fechar_posse_orfa", "trg_frota_gravar_historico", "trg_frota_resposta_imutavel",
		"trg_frota_uso_enfileirar_pdf", "trg_guard_profiles", "trg_impedir_autopromocao",
		"trg_patrimonio_espelha_responsavel", "trg_patrimonio_espelha_situacao"}; !reflect.DeepEqual(gat, quer) {
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
	// permitidos, com o rastro de QUEM mudou e a linha conferida (um no-op silencioso não passa)
	linhaDe := func(id string) string {
		return um(`select role || '/' || permissions::text from profiles where id = '` + id + `'`)
	}
	if err := como(super, `update profiles set role = 'admin' where id = '`+outra+`'`); err != nil {
		t.Errorf("super por e-mail não mudou o cargo: %v", err)
	}
	if v := linhaDe(outra); v != "admin/{}" {
		t.Errorf("depois do super mudar o cargo: %s", v)
	}
	if err := como(admin, `update profiles set permissions = '{"frota":["ver"]}' where id = '`+outra+`'`); err != nil {
		t.Errorf("admin não mudou permissões de outra pessoa: %v", err)
	}
	if v := linhaDe(outra); v != `admin/{"frota": ["ver"]}` {
		t.Errorf("depois do admin mudar as permissões: %s", v)
	}
	if v := um(`select count(*) filter (where action = 'role_change' and actor_id = '` + super + `')::text || '/' ||
		count(*) filter (where action = 'acesso_change' and actor_id = '` + admin + `')::text from audit_log`); v != "1/1" {
		t.Errorf("rastro role_change/acesso_change = %s, esperava 1/1", v)
	}
	// sem identidade o guard confia: por isso TODA escrita roda em banco.ComUsuario
	if _, err := p.Exec(ctx, `update profiles set role = 'viewer' where id = '`+outra+`'`); err != nil {
		t.Errorf("sem identidade: %v", err)
	}
	if v := linhaDe(outra); v != `viewer/{"frota": ["ver"]}` {
		t.Errorf("sem identidade o cargo tinha de mudar: %s", v)
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

// Os arquivos de tabelas das fatias têm de usar dois dígitos (01-tabelas-5-02.sql): fs.Glob ordena por
// nome e 5-10 viria antes de 5-2, quebrando FK de uma fatia para a de número menor. O 02-gatilhos.sql
// (gerado) vem depois de todas.
func TestNomesDosArquivosDeEsquema(t *testing.T) {
	arquivos, err := fs.Glob(esquemaSQL, "esquema/*.sql")
	if err != nil {
		t.Fatal(err)
	}
	re := regexp.MustCompile(`^esquema/(01-tabelas-5-[0-9]{2}|02-gatilhos|03-funcoes-5-[0-9]{2})\.sql$`)
	for _, a := range arquivos {
		if !re.MatchString(a) {
			t.Errorf("%s: o nome tem de ser 01-tabelas-5-NN.sql, 02-gatilhos.sql ou 03-funcoes-5-NN.sql (dois dígitos; as 03 são funções fora do gerador, carregadas depois do 02)", a)
		}
	}
}
