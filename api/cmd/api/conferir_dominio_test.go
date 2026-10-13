package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"slices"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/config"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
	"github.com/rbv-co/social-dashboard/api/internal/rpc"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
	"github.com/rbv-co/social-dashboard/api/internal/web"
)

// emTx roda fn numa transação que SEMPRE desfaz (DDL de teste, role local, set local).
func emTx(t *testing.T, p *pgxpool.Pool, fn func(tx pgx.Tx)) {
	t.Helper()
	ctx := context.Background()
	tx, err := p.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	fn(tx)
}

func txExec(t *testing.T, tx pgx.Tx, sqls ...string) {
	t.Helper()
	for _, s := range sqls {
		if _, err := tx.Exec(context.Background(), s); err != nil {
			t.Fatalf("%s: %v", s, err)
		}
	}
}

// papelAuthenticated: o papel do Supabase que a camada de compatibilidade do Plano 2 cria (cluster inteiro).
func papelAuthenticated(t *testing.T, p *pgxpool.Pool) {
	t.Helper()
	if _, err := p.Exec(context.Background(), `do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$`); err != nil {
		t.Fatal(err)
	}
}

func contem(faltam []string, trecho string) bool {
	return slices.ContainsFunc(faltam, func(f string) bool { return strings.Contains(f, trecho) })
}

// A declaração de cada RPC contra o pg_proc do banco restaurado: existe no schema (public em produção) e
// não em pg_catalog, `authenticated` executa, parâmetros (nome, tipo, DEFAULT × Opcional) e retorno batem.
func TestConferirRPCContraOPgProc(t *testing.T) {
	p := testebanco.Novo(t)
	papelAuthenticated(t, p)
	exec(t, p, `
		create function f_ok(p_a uuid, p_b integer default 1) returns table(x int) language sql as $$ select 1 $$;
		create function f_void(p_t text) returns void language sql as $$ select 1 $$;
		create function f_escalar(p_n numeric) returns integer language sql as $$ select 1 $$;
		create function f_conj() returns setof integer language sql as $$ select 1 $$;
		create function f_uuid(p_a uuid) returns integer language sql as $$ select 1 $$;
		create function f_arr(p_ids text[]) returns integer language sql as $$ select 1 $$;
		create function f_dois(p_a uuid, p_b uuid) returns integer language sql as $$ select 1 $$;
		create function f_def(p_a uuid, p_b integer default 1) returns integer language sql as $$ select 1 $$;
		create function f_semnome(uuid) returns integer language sql as $$ select 1 $$;
		create function f_sobre(p_a uuid) returns integer language sql as $$ select 1 $$;
		create function f_sobre(p_a uuid, p_b integer) returns integer language sql as $$ select 1 $$;
		create function f_fechada(p_a uuid) returns integer language sql as $$ select 1 $$;
		revoke execute on function f_fechada(uuid) from public;
		create function f_tipos(p_v varchar, p_t timestamptz, p_j jsonb, p_d date, p_bi bigint, p_bo boolean) returns jsonb language sql as $$ select '{}'::jsonb $$;
		create function abs(p_x integer) returns integer language sql as $$ select 1 $$;`)
	par := func(nome, tipo string, opc ...bool) rpc.Param {
		return rpc.Param{Nome: nome, Tipo: tipo, Opcional: len(opc) > 0 && opc[0]}
	}
	g := autz.SuperFicha
	casos := []struct {
		nome string
		f    rpc.Funcao
		quer string // "" = nenhuma premissa quebrada
	}{
		{"tudo certo", rpc.Funcao{Nome: "f_ok", Params: []rpc.Param{par("p_a", "uuid"), par("p_b", "integer", true)}, Retorno: rpc.Conjunto, Portao: g}, ""},
		{"tipos de coluna e varchar como text", rpc.Funcao{Nome: "f_tipos", Params: []rpc.Param{par("p_v", "text"), par("p_t", "timestamptz"), par("p_j", "jsonb"),
			par("p_d", "date"), par("p_bi", "bigint"), par("p_bo", "boolean")}, Retorno: rpc.Valor, Portao: g}, ""},
		{"void declarada Nada", rpc.Funcao{Nome: "f_void", Params: []rpc.Param{par("p_t", "text")}, Retorno: rpc.Nada, Portao: g}, ""},
		{"não existe", rpc.Funcao{Nome: "f_nao_existe", Retorno: rpc.Valor, Portao: g}, "rpc f_nao_existe: não existe"},
		{"existe em pg_catalog (abs)", rpc.Funcao{Nome: "abs", Params: []rpc.Param{par("p_x", "integer")}, Retorno: rpc.Valor, Portao: g}, "existe também em pg_catalog"},
		{"authenticated sem EXECUTE", rpc.Funcao{Nome: "f_fechada", Params: []rpc.Param{par("p_a", "uuid")}, Retorno: rpc.Valor, Portao: g}, "authenticated NÃO tem EXECUTE"},
		{"tipo do parâmetro", rpc.Funcao{Nome: "f_uuid", Params: []rpc.Param{par("p_a", "text")}, Retorno: rpc.Valor, Portao: g}, "p_a é uuid na função e foi declarado text"},
		{"array declarado como escalar", rpc.Funcao{Nome: "f_arr", Params: []rpc.Param{par("p_ids", "text")}, Retorno: rpc.Valor, Portao: g}, "p_ids é text[] na função e foi declarado text"},
		{"array de outro tipo", rpc.Funcao{Nome: "f_arr", Params: []rpc.Param{par("p_ids", "uuid[]")}, Retorno: rpc.Valor, Portao: g}, "foi declarado uuid[]"},
		{"parâmetro que a função não tem", rpc.Funcao{Nome: "f_uuid", Params: []rpc.Param{par("p_a", "uuid"), par("p_z", "uuid")}, Retorno: rpc.Valor, Portao: g}, "parâmetro p_z não existe na função"},
		{"parâmetro obrigatório não declarado", rpc.Funcao{Nome: "f_dois", Params: []rpc.Param{par("p_a", "uuid")}, Retorno: rpc.Valor, Portao: g}, "a função tem o parâmetro p_b (uuid), obrigatório"},
		{"DEFAULT não declarado Opcional", rpc.Funcao{Nome: "f_def", Params: []rpc.Param{par("p_a", "uuid"), par("p_b", "integer")}, Retorno: rpc.Valor, Portao: g}, "p_b tem DEFAULT na função mas não é Opcional"},
		{"pronargdefaults × Opcional", rpc.Funcao{Nome: "f_def", Params: []rpc.Param{par("p_a", "uuid"), par("p_b", "integer")}, Retorno: rpc.Valor, Portao: g}, "pronargdefaults = 1 e a declaração tem 0 Opcional"},
		{"Opcional sem DEFAULT", rpc.Funcao{Nome: "f_def", Params: []rpc.Param{par("p_a", "uuid", true), par("p_b", "integer", true)}, Retorno: rpc.Valor, Portao: g}, "p_a não tem DEFAULT na função mas é Opcional"},
		{"DEFAULT não declarado", rpc.Funcao{Nome: "f_def", Params: []rpc.Param{par("p_a", "uuid")}, Retorno: rpc.Valor, Portao: g}, "a função tem o parâmetro p_b (integer) com DEFAULT que a declaração não tem"},
		{"parâmetro sem nome", rpc.Funcao{Nome: "f_semnome", Params: []rpc.Param{par("p_a", "uuid")}, Retorno: rpc.Valor, Portao: g}, "parâmetro sem nome"},
		{"sobrecarga", rpc.Funcao{Nome: "f_sobre", Params: []rpc.Param{par("p_a", "uuid")}, Retorno: rpc.Valor, Portao: g}, "2 sobrecargas"},
		{"void declarada com retorno", rpc.Funcao{Nome: "f_void", Params: []rpc.Param{par("p_t", "text")}, Retorno: rpc.Valor, Portao: g}, "a função é void"},
		{"não void declarada Nada", rpc.Funcao{Nome: "f_escalar", Params: []rpc.Param{par("p_n", "numeric")}, Retorno: rpc.Nada, Portao: g}, "a função não é void"},
		{"escalar declarada Conjunto", rpc.Funcao{Nome: "f_escalar", Params: []rpc.Param{par("p_n", "numeric")}, Retorno: rpc.Conjunto, Portao: g}, "Conjunto e a função não devolve setof/table"},
		{"setof declarada Valor", rpc.Funcao{Nome: "f_conj", Retorno: rpc.Valor, Portao: g}, "devolve setof/table (use Conjunto)"},
	}
	for _, c := range casos {
		emTx(t, p, func(tx pgx.Tx) {
			faltam, err := conferirRPC(context.Background(), tx, []rpc.Funcao{c.f})
			if err != nil {
				t.Fatalf("%s: %v", c.nome, err)
			}
			if (c.quer == "") != (len(faltam) == 0) || (c.quer != "" && !contem(faltam, c.quer)) {
				t.Errorf("%s: faltam = %q, esperava %q", c.nome, faltam, c.quer)
			}
		})
	}
	// sem nada declarado não há o que conferir (o registro nasce vazio no 5.0)
	emTx(t, p, func(tx pgx.Tx) {
		if f, err := conferirRPC(context.Background(), tx, nil); err != nil || len(f) != 0 {
			t.Errorf("sem RPC: %v %v", f, err)
		}
	})
}

// O papel `authenticated` ausente é dito uma vez (não dá para conferir o EXECUTE sem ele).
func TestConferirRPCSemOPapelAuthenticated(t *testing.T) {
	p := testebanco.Novo(t)
	exec(t, p, `create function f_a(p_a uuid) returns integer language sql as $$ select 1 $$`)
	antigo := papelDasRPC
	papelDasRPC = "papel_que_nao_existe_t10"
	t.Cleanup(func() { papelDasRPC = antigo })
	emTx(t, p, func(tx pgx.Tx) {
		faltam, err := conferirRPC(context.Background(), tx, []rpc.Funcao{
			{Nome: "f_a", Params: []rpc.Param{{Nome: "p_a", Tipo: "uuid"}}, Retorno: rpc.Valor, Portao: autz.SuperFicha}})
		if err != nil || len(faltam) != 1 || !strings.Contains(faltam[0], "papel_que_nao_existe_t10 não existe neste banco") {
			t.Errorf("faltam = %q err = %v", faltam, err)
		}
	})
}

// A auditoria do "entrar como": a API só grava se for dona da tabela, BYPASSRLS ou superusuário
// quando a RLS está ligada (produção: RLS ligada e só a policy de SELECT do super-admin).
func TestConferirAuditoriaDonoOuBypassRLS(t *testing.T) {
	p := testebanco.Novo(t)
	b := make([]byte, 4)
	rand.Read(b)
	papel := "api_t10_" + hex.EncodeToString(b)
	exec(t, p, `create role `+papel+` nologin`)
	t.Cleanup(func() {
		p.Exec(context.Background(), `drop owned by `+papel)
		p.Exec(context.Background(), `drop role if exists `+papel)
	})
	var esquema string
	p.QueryRow(context.Background(), `select current_schema()`).Scan(&esquema)
	exec(t, p, `grant usage on schema `+esquema+` to `+papel, `create table entradas_como_outro_usuario (id uuid primary key default gen_random_uuid(), admin_id uuid)`)
	casos := []struct {
		nome string
		sql  []string
		role string // papel da conexão ("" = o do teste, superusuário)
		quer string
	}{
		{"superusuário com RLS ligada", []string{`alter table entradas_como_outro_usuario enable row level security`}, "", ""},
		{"sem RLS e com INSERT", []string{`grant insert on entradas_como_outro_usuario to ` + papel}, papel, ""},
		{"sem RLS e sem INSERT", nil, papel, "não tem INSERT"},
		{"RLS ligada, não é dona, com INSERT e policy de select (produção)", []string{`grant insert, select on entradas_como_outro_usuario to ` + papel,
			`alter table entradas_como_outro_usuario enable row level security`, `create policy so_select on entradas_como_outro_usuario for select using (true)`}, papel, "não é dona da tabela nem BYPASSRLS"},
		{"RLS ligada e a API é dona", []string{`alter table entradas_como_outro_usuario owner to ` + papel, `alter table entradas_como_outro_usuario enable row level security`}, papel, ""},
		{"RLS FORCE: dona não basta", []string{`alter table entradas_como_outro_usuario owner to ` + papel, `alter table entradas_como_outro_usuario enable row level security`,
			`alter table entradas_como_outro_usuario force row level security`}, papel, "a RLS é FORCE"},
		{"RLS ligada e BYPASSRLS", []string{`grant insert on entradas_como_outro_usuario to ` + papel, `alter table entradas_como_outro_usuario enable row level security`,
			`alter role ` + papel + ` bypassrls`}, papel, ""},
	}
	for _, c := range casos {
		emTx(t, p, func(tx pgx.Tx) {
			txExec(t, tx, c.sql...)
			if c.role != "" {
				txExec(t, tx, `set local role `+c.role)
			}
			faltam, err := conferirAuditoria(context.Background(), tx)
			if err != nil {
				t.Fatalf("%s: %v", c.nome, err)
			}
			if (c.quer == "") != (len(faltam) == 0) || (c.quer != "" && !contem(faltam, c.quer)) {
				t.Errorf("%s: faltam = %q, esperava %q", c.nome, faltam, c.quer)
			}
		})
	}
	// sem a tabela: nada a dizer aqui (a conferência de colunas acusa a falta)
	emTx(t, p, func(tx pgx.Tx) {
		txExec(t, tx, `drop table entradas_como_outro_usuario`)
		if f, err := conferirAuditoria(context.Background(), tx); err != nil || len(f) != 0 {
			t.Errorf("sem tabela: %v %v", f, err)
		}
	})
}

// PostgreSQL 15+ e standard_conforming_strings = on: as premissas da gramática de dados.Consulta.
func TestConferirAmbienteDaGramatica(t *testing.T) {
	p := testebanco.Novo(t)
	emTx(t, p, func(tx pgx.Tx) {
		if f, err := conferirAmbiente(context.Background(), tx); err != nil || len(f) != 0 {
			t.Errorf("ambiente normal: %v %v", f, err)
		}
		txExec(t, tx, `set local standard_conforming_strings = off`)
		f, err := conferirAmbiente(context.Background(), tx)
		if err != nil || !contem(f, "standard_conforming_strings") {
			t.Errorf("scf off: %v %v", f, err)
		}
	})
}

// As rotas de domínio montadas contra o banco restaurado: tabela real fora do catálogo derruba a montagem
// da rota (panic) e `conferir` conta isso como premissa quebrada em vez de morrer.
func TestConferirRotasVeAMontagemContraAsTabelasReais(t *testing.T) {
	p := testebanco.Novo(t)
	if f := conferirRotas(p, config.Config{}); len(f) != 0 {
		t.Fatalf("as rotas de hoje (sem rotas de domínio) têm de montar: %v", f)
	}
	c := dados.Consulta{Tabela: "profiles", Alias: "p", SQL: "select p.id, (select count(*) from usuarios) as n from profiles p",
		Ordens: map[string]string{"id": "p.id"}, OrdemPadrao: "id", Desempate: "p.id"}
	f := montarSemPanico(func() { c.Handler(p, autz.Producao) })
	if len(f) != 1 || !strings.Contains(f[0], "rotas: a montagem das rotas de domínio falhou") || !strings.Contains(f[0], "usuarios") {
		t.Fatalf("tabela real fora do catálogo = %q", f)
	}
}

// `api worker conferir` (conferirSchema) confere as funções de web.FuncoesRPC de verdade: uma registrada
// que não existe no banco restaurado aparece na lista (a fiação, não só a função auxiliar).
func TestConferirSchemaConfereAsRPCRegistradas(t *testing.T) {
	p := testebanco.Novo(t)
	esquemaCompleto(t, p, false)
	antigo := web.FuncoesRPC
	web.FuncoesRPC = []rpc.Funcao{{Nome: "funcao_registrada_que_nao_existe", Retorno: rpc.Valor, Portao: autz.SuperFicha}}
	t.Cleanup(func() { web.FuncoesRPC = antigo })
	f := faltamDe(t, p)
	if len(f) != 1 || !strings.Contains(f[0], "rpc funcao_registrada_que_nao_existe: não existe") {
		t.Fatalf("faltam = %q", f)
	}
}

// profiles.permissions fora do formato (array, escalar, chave cujo valor não é array) é tolerado pela API
// (nunca 500), mas é dado suspeito: o conferir AVISA com a contagem, sem falhar.
func TestConferirAvisaPermissionsForaDoFormato(t *testing.T) {
	p := testebanco.Novo(t)
	esquemaCompleto(t, p, false)
	ctx := context.Background()
	if av, err := conferirAvisos(ctx, p); err != nil || len(av) != 0 {
		t.Fatalf("sem perfis: avisos = %q (%v)", av, err)
	}
	exec(t, p, `insert into profiles (id, permissions) values
		(gen_random_uuid(), '{"meta.opr": ["ver"]}'), (gen_random_uuid(), null), (gen_random_uuid(), '{}'),
		(gen_random_uuid(), '["meta.opr"]'), (gen_random_uuid(), '"texto"'), (gen_random_uuid(), 'null'),
		(gen_random_uuid(), '{"meta.opr": true}'), (gen_random_uuid(), '{"k": [1]}'), (gen_random_uuid(), '{"k": ["ver"], "j": "x"}')`)
	av, err := conferirAvisos(ctx, p)
	if err != nil {
		t.Fatal(err)
	}
	// fora do formato: array, texto, 'null', {"meta.opr": true}, {"k": ["ver"], "j": "x"} = 5 (o `{"k": [1]}` é array: vale)
	if len(av) != 1 || !strings.Contains(av[0], "5 perfil(is)") || !strings.Contains(av[0], "permissions") {
		t.Fatalf("avisos = %q", av)
	}
	var codigo int
	saida := saidaDe(t, func() { codigo = rodarWorker(ctx, p, config.Config{}, []string{"conferir"}) })
	if codigo != 0 || !strings.Contains(saida, "AVISO: ") || !strings.Contains(saida, "5 perfil(is)") || !strings.Contains(saida, "schema confere") {
		t.Fatalf("AVISO não falha o conferir: codigo=%d saida=%q", codigo, saida)
	}
}

// Toda leitura de dados.Consulta vai pelo pool, FORA de banco.ComUsuario (a autorização é do autz, em Go).
// Com a RLS ligada nas tabelas restauradas e o papel da API nem dono nem BYPASSRLS, toda leitura de domínio
// devolveria [] em silêncio (e sem SELECT, erro). O conferir acusa as tabelas do catálogo nessa situação.
func TestConferirLeituraDoCatalogoRLSEPrivilegio(t *testing.T) {
	p := testebanco.Novo(t)
	b := make([]byte, 4)
	rand.Read(b)
	papel := "api_leit_" + hex.EncodeToString(b)
	exec(t, p, `create role `+papel+` nologin`)
	t.Cleanup(func() {
		p.Exec(context.Background(), `drop owned by `+papel)
		p.Exec(context.Background(), `drop role if exists `+papel)
	})
	var esquema string
	p.QueryRow(context.Background(), `select current_schema()`).Scan(&esquema)
	exec(t, p, `grant usage on schema `+esquema+` to `+papel,
		`create table t_sem_rls (id int)`, `create table t_rls_alheia (id int)`, `create table t_rls_dona (id int)`,
		`create table t_rls_force (id int)`, `create table t_rls_bypass (id int)`, `create table t_sem_select (id int)`,
		`grant select on t_sem_rls, t_rls_alheia, t_rls_dona, t_rls_force, t_rls_bypass to `+papel,
		`alter table t_rls_alheia enable row level security`, `alter table t_rls_dona owner to `+papel,
		`alter table t_rls_dona enable row level security`, `alter table t_rls_force owner to `+papel,
		`alter table t_rls_force enable row level security`, `alter table t_rls_force force row level security`,
		`alter table t_rls_bypass enable row level security`)
	tabelas := []string{"t_sem_rls", "t_rls_alheia", "t_rls_dona", "t_rls_force", "t_rls_bypass", "t_sem_select", "t_que_nao_existe"}
	casos := []struct {
		nome, role string
		quer       []string // trechos que a mensagem tem de trazer ("" = confere)
		naoQuer    []string
	}{
		{"superusuário: a RLS não vale", "", nil, nil},
		{"papel da API: dono ou sem RLS passa, o resto é acusado", papel,
			[]string{"t_rls_alheia", "t_rls_force", "t_rls_bypass", "devolveria []", "t_sem_select", "não tem SELECT"},
			[]string{"t_sem_rls", "t_rls_dona", "t_que_nao_existe"}},
	}
	for _, c := range casos {
		emTx(t, p, func(tx pgx.Tx) {
			if c.role != "" {
				txExec(t, tx, `set local role `+c.role)
			}
			faltam, err := conferirLeituraDoCatalogo(context.Background(), tx, tabelas)
			if err != nil {
				t.Fatalf("%s: %v", c.nome, err)
			}
			if c.quer == nil && len(faltam) != 0 {
				t.Errorf("%s: faltam = %q", c.nome, faltam)
			}
			juntas := strings.Join(faltam, "\n")
			for _, q := range c.quer {
				if !strings.Contains(juntas, q) {
					t.Errorf("%s: faltou %q em %q", c.nome, q, juntas)
				}
			}
			for _, q := range c.naoQuer {
				if strings.Contains(juntas, q) {
					t.Errorf("%s: não devia citar %q em %q", c.nome, q, juntas)
				}
			}
		})
	}
	// BYPASSRLS resolve a RLS (t_rls_bypass e t_rls_alheia passam; o SELECT em t_sem_select continua faltando)
	exec(t, p, `alter role `+papel+` bypassrls`)
	emTx(t, p, func(tx pgx.Tx) {
		txExec(t, tx, `set local role `+papel)
		faltam, err := conferirLeituraDoCatalogo(context.Background(), tx, tabelas)
		juntas := strings.Join(faltam, "\n")
		if err != nil || strings.Contains(juntas, "devolveria []") || !strings.Contains(juntas, "t_sem_select") {
			t.Errorf("BYPASSRLS: faltam = %q err = %v", faltam, err)
		}
	})
}
