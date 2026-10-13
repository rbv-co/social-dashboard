package testebanco

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

// A fatia 5.4: as acessos_* com os checks, os únicos e as FKs das migrations (que decidem o 400/409
// das rotas e a cascata de excluir colaborador), sem gatilho nenhum, e acessos_pessoas completa.
// acessos_conexoes guarda segredos em produção: aqui só as colunas existem, nenhum teste grava valor.
func TestFatiaDosAcessos(t *testing.T) {
	p := ComEsquemaDeProducao(t)
	ctx := context.Background()
	const (
		org1 = "a4a00000-0000-4000-a000-000000000001"
		org2 = "a4a00000-0000-4000-a000-000000000002"
		set1 = "a4b00000-0000-4000-a000-000000000001"
		emp  = "a4c00000-0000-4000-a000-000000000001"
		pes  = "a4d00000-0000-4000-a000-000000000001"
		rec  = "a4e00000-0000-4000-a000-000000000001"
		eq   = "a4f00000-0000-4000-a000-000000000001"
	)
	exec := func(sql string) error { _, err := p.Exec(ctx, sql); return err }
	codigo := func(err error) string {
		var pe *pgconn.PgError
		if errors.As(err, &pe) {
			return pe.Code
		}
		return "<sem erro>"
	}
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
	colunas := func(tabela string) string {
		return um(`select string_agg(column_name, ',' order by column_name) from information_schema.columns
			where table_schema = 'public' and table_name = '` + tabela + `'`)
	}
	if err := exec(`
		insert into acessos_organizacoes (id, nome) values ('` + org1 + `', 'Sede Centro'), ('` + org2 + `', 'Fábrica');
		insert into acessos_setores (id, nome, organizacao_id) values ('` + set1 + `', 'RH', '` + org1 + `');
		insert into patrimonio_empresas (id, nome) values ('` + emp + `', 'Vessel');
		insert into acessos_pessoas (id, nome, setor_id, organizacao_id, marca_id)
		  values ('` + pes + `', 'Ana', '` + set1 + `', '` + org1 + `', '` + emp + `');
		insert into acessos_recursos (id, tipo, nome, external_id) values ('` + rec + `', 'workdrive', 'Contratos', 'wd-1');
		insert into acessos_vinculos (recurso_id, pessoa_id) values ('` + rec + `', '` + pes + `');
		insert into acessos_termos (pessoa_id, arquivo_path) values ('` + pes + `', '` + pes + `/1-t.pdf');
		insert into acessos_dispositivos (pessoa_id, tipo, descricao) values ('` + pes + `', 'celular', 'iPhone');
		insert into equipes (id, nome, tipo, setor_id) values ('` + eq + `', 'Time RH', 'setor', '` + set1 + `');`); err != nil {
		t.Fatal(err)
	}

	// 1. nenhum gatilho nas acessos_* (nada a gerar) e as colunas de produção (acessos_pessoas: a mínima
	// da 5.1 + a 5.2 + o resto; acessos_conexoes: só o formato, sem segredo)
	if v := um(`select count(*)::text from pg_trigger g join pg_class c on c.oid = g.tgrelid
		where not g.tgisinternal and c.relname like 'acessos\_%'`); v != "0" {
		t.Errorf("gatilhos nas acessos_* = %s, esperava 0", v)
	}
	for tabela, quer := range map[string]string{
		"acessos_pessoas": "atualizado_em,avatar_url,cargo,conta_apple,criado_em,data_fim_contrato,data_inicio_contrato," +
			"email_corporativo,email_outlook,id,marca_id,motivo_saida,nome,numero_corporativo,numero_pessoal," +
			"organizacao_id,profile_id,setor_id,status,zoho_account_id",
		"acessos_setores": "cor,criado_em,id,nome,ordem,organizacao_id",
		"acessos_conexoes": "atualizado_em,client_id,client_secret,conectado_em,conectado_por,data_center,escopos," +
			"oauth_state,oauth_state_em,org_id,provedor,refresh_token",
	} {
		if v := colunas(tabela); v != quer {
			t.Errorf("colunas de %s = %s", tabela, v)
		}
	}

	// 2. o que o banco recusa (é o 400/409 das rotas)
	for sql, quer := range map[string]string{
		`insert into acessos_pessoas (nome, status) values ('X', 'inativo')`:                                         "23514",
		`insert into acessos_pessoas (nome) values (null)`:                                                           "23502",
		`insert into acessos_recursos (tipo, nome) values ('dropbox', 'X')`:                                          "23514",
		`insert into acessos_recursos (tipo, nome, external_id) values ('workdrive', 'Y', 'wd-1')`:                   "23505",
		`insert into acessos_vinculos (recurso_id, pessoa_id, papel) values ('` + rec + `', '` + pes + `', 'admin')`: "23514",
		`insert into acessos_log (acao, resultado) values ('x', 'parcial')`:                                          "23514",
		`insert into acessos_setores (nome, organizacao_id) values ('RH', '` + org1 + `')`:                           "23505",
		`insert into acessos_organizacoes (nome) values ('Fábrica')`:                                                 "23505",
		`delete from patrimonio_empresas where id = '` + emp + `'`:                                                   "23503",
	} {
		if c := codigo(exec(sql)); c != quer {
			t.Errorf("%s: código %s, esperava %s", sql, c, quer)
		}
	}
	// ...e o que ele aceita: mesmo nome de setor em outra organização; external_id repetido fora do WorkDrive
	for _, sql := range []string{
		`insert into acessos_setores (nome, organizacao_id) values ('RH', '` + org2 + `')`,
		`insert into acessos_recursos (tipo, nome, external_id) values ('onedrive', 'Z', 'wd-1'), ('onedrive', 'W', 'wd-1')`,
	} {
		if err := exec(sql); err != nil {
			t.Errorf("%s: %v", sql, err)
		}
	}

	// 3. as FKs de produção: setor → ficha e time; organização → setor e ficha; ficha → vínculos, termos, dispositivos
	if err := exec(`delete from acessos_setores where id = '` + set1 + `'`); err != nil {
		t.Fatal(err)
	}
	if v := um(`select coalesce((select setor_id::text from acessos_pessoas where id = '` + pes + `'), '<nulo>') || '/' ||
		coalesce((select setor_id::text from equipes where id = '` + eq + `'), '<nulo>')`); v != "<nulo>/<nulo>" {
		t.Errorf("apagar setor: ficha/time = %s, esperava os dois zerados", v)
	}
	if err := exec(`insert into acessos_setores (id, nome, organizacao_id) values ('` + set1 + `', 'TI', '` + org1 + `')`); err != nil {
		t.Fatal(err)
	}
	if err := exec(`delete from acessos_organizacoes where id = '` + org1 + `'`); err != nil {
		t.Fatal(err)
	}
	if v := um(`select coalesce((select organizacao_id::text from acessos_pessoas where id = '` + pes + `'), '<nulo>') || '/' ||
		coalesce((select organizacao_id::text from acessos_setores where id = '` + set1 + `'), '<nulo>')`); v != "<nulo>/<nulo>" {
		t.Errorf("apagar organização: ficha/setor = %s, esperava os dois zerados", v)
	}
	if err := exec(`delete from acessos_pessoas where id = '` + pes + `'`); err != nil {
		t.Fatal(err)
	}
	if v := um(`select ((select count(*) from acessos_vinculos) + (select count(*) from acessos_termos) +
		(select count(*) from acessos_dispositivos))::text`); v != "0" {
		t.Errorf("apagar a ficha deixou %s vínculos/termos/dispositivos", v)
	}
}
