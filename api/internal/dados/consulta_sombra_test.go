package dados

import (
	"context"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

func fixtureSombra(t *testing.T) (*pgxpool.Pool, *autz.Catalogo, *ambiente) {
	t.Helper()
	cat, err := autz.Compilar([]byte(catalogoDeAtaque))
	if err != nil {
		t.Fatal(err)
	}
	p := testebanco.Novo(t)
	if _, err := p.Exec(context.Background(), `create table conta (id text primary key);
		create table coisa (id serial primary key, nome text, account_id text, dona text);
		create table eq_a (id serial primary key, equipe_id text, nome text);
		create table eq_b (id serial primary key, equipe_id text, nome text);
		create table segredo (id serial primary key, valor text);
		insert into conta values ('A1'), ('A2');
		insert into coisa (nome, account_id, dona) values ('a', 'A1', 'A1'), ('b', 'A1', 'A2'), ('c', 'A2', 'A1'), ('d', null, null);
		insert into segredo (valor) values ('SEGREDO')`); err != nil {
		t.Fatal(err)
	}
	amb, err := ambienteDoBanco(context.Background(), p)
	if err != nil {
		t.Fatal(err)
	}
	return p, cat, amb
}

func umaContaA1() *autz.Escopo {
	return &autz.Escopo{ID: "11111111-0000-4000-a000-000000000001", TemPerfil: true, Ativo: true, Contas: []string{"A1"}}
}

// executar roda a consulta SEM validar (para provar a sombra sozinha): a declaração pode ser vazadora.
func executar(t *testing.T, p *pgxpool.Pool, cat *autz.Catalogo, c Consulta, sombra []string) string {
	t.Helper()
	sql, _, args, err := c.montar(map[string][]string{}, umaContaA1(), cat, sombra)
	if err != nil {
		t.Fatalf("montar: %v", err)
	}
	w := httptest.NewRecorder()
	Lista(context.Background(), p, w, sql, args)
	if w.Code != 200 {
		t.Fatalf("lista = %d %s", w.Code, w.Body)
	}
	return compacto(w.Body.String())
}

// DEFESA EM PROFUNDIDADE: mesmo uma declaração que a gramática não pegasse lê a relação filtrada,
// porque a CTE com o nome da tabela sombreia a tabela real em toda referência sem schema.
func TestSombraNeutralizaReferenciaQueAGramaticaNaoViu(t *testing.T) {
	p, cat, amb := fixtureSombra(t)
	// o trecho do JSON da linha "a" sem a sombra (vaza) e com ela (certo)
	casos := []struct{ nome, sql, vaza, certo string }{
		{"junção por vírgula", "select c.nome, k.id as vaza from coisa c, conta k", `"nome":"a","vaza":"A2"`, `[{"nome":"a","vaza":"A1"},{"nome":"b","vaza":"A1"},{"nome":"d","vaza":"A1"}]`},
		{"subconsulta sem regra", "select c.nome, (select json_agg(k.id order by k.id) from conta k) as vaza from coisa c", `"vaza":["A1","A2"]`, `"vaza":["A1"]`},
		{"table dentro de array", "select c.nome, array(table conta) as vaza from coisa c", `A2`, `"vaza":["A1"]`},
		{"principal relida", "select c.nome, (select count(*) from coisa) as vaza from coisa c", `"vaza":4`, `"vaza":3`},
		{"argumento de função", "select c.nome, (select count(*) from jsonb_array_elements((select to_jsonb(array_agg(id)) from conta))) as vaza from coisa c", `"vaza":2`, `"vaza":1`},
		{"exists sem alias", "select c.nome, exists (select 1 from conta where id = 'A2') as vaza from coisa c", `"vaza":true`, `"vaza":false`},
	}
	for _, k := range casos {
		c := consultaAtaque(k.sql)
		sem := executar(t, p, cat, c, nil)
		com := executar(t, p, cat, c, c.tabelasDaSombra(amb))
		if !strings.Contains(sem, k.vaza) {
			t.Errorf("%s: o teste não morde, sem a sombra veio %s", k.nome, sem)
		}
		if strings.Contains(com, k.vaza) || !strings.Contains(com, k.certo) {
			t.Errorf("%s: com a sombra veio %s (esperava conter %s)", k.nome, com, k.certo)
		}
	}
}

// A sombra usa a regra de Ler da tabela para a pessoa: A1 vê só a própria conta, inclusive na
// contagem de linhas da principal e nas tabelas citadas só pela subconsulta.
func TestSombraDaResultadoIgualAoDoBancoFiltrado(t *testing.T) {
	p, cat, amb := fixtureSombra(t)
	c := consultaAtaque("select c.nome, (select count(*) from conta) as n_contas, (select count(*) from coisa) as n_coisas from coisa c")
	got := executar(t, p, cat, c, c.tabelasDaSombra(amb))
	if got != `[{"nome":"a","n_contas":1,"n_coisas":3},{"nome":"b","n_contas":1,"n_coisas":3},{"nome":"d","n_contas":1,"n_coisas":3}]` {
		t.Errorf("= %s", got)
	}
}

func TestTabelaRealForaDoCatalogoERecusada(t *testing.T) {
	_, cat, amb := fixtureSombra(t)
	for nome, c := range map[string]Consulta{
		"em subconsulta":      consultaAtaque("select c.nome, (select count(*) from segredo) from coisa c"),
		"em array(table x)":   consultaAtaque("select c.nome, array(table segredo) from coisa c"),
		"na lista, como nome": consultaAtaque("select c.nome, segredo from coisa c"),
		"no Onde": func() Consulta {
			c := consultaAtaque("select c.nome from coisa c")
			c.Onde = "exists (select 1 from segredo)"
			return c
		}(),
		"na ordem": func() Consulta {
			c := consultaAtaque("select c.nome from coisa c")
			c.Ordens = map[string]string{"x": "(select count(*) from segredo)"}
			return c
		}(),
	} {
		err := c.validar(cat, amb)
		if err == nil || !errors.Is(err, ErrDeclaracao) {
			t.Errorf("%s: %v", nome, err)
		}
	}
	// o Handler recusa na montagem
	p, cat, _ := fixtureSombra(t)
	defer func() {
		if recover() == nil {
			t.Error("Handler aceitou tabela real fora do catálogo")
		}
	}()
	consultaAtaque("select c.nome, (select count(*) from segredo) from coisa c").Handler(p, cat)
}

func TestQualificadorDeSchemaERecusado(t *testing.T) {
	_, cat, amb := fixtureSombra(t)
	for nome, sql := range map[string]string{
		"public.conta":          "select c.nome, (select count(*) from public.conta k where {ler:conta:k}) from coisa c",
		"schema corrente":       "select c.nome, (select json_agg(k.id) from " + schemaDe(amb) + ".conta k where {ler:conta:k}) from coisa c",
		"x.conta sem ser alias": "select c.nome, x.conta from coisa c",
		"pg_catalog.length":     "select pg_catalog.length(c.nome) from coisa c",
		"information_schema":    "select c.nome, (select count(*) from information_schema.tables) from coisa c",
		"pg_class":              "select c.nome, (select count(*) from pg_class) from coisa c",
		"três níveis":           "select c.nome, public.conta.id from coisa c",
	} {
		if err := consultaAtaque(sql).validar(cat, amb); !errors.Is(err, ErrDeclaracao) {
			t.Errorf("%s: %v", nome, err)
		}
	}
	// o alias como qualificador segue valendo
	if err := consultaAtaque("select c.nome, k.id from coisa c left join conta k on k.id = c.dona and {ler:conta:k}").validar(cat, amb); err != nil {
		t.Errorf("alias recusado: %v", err)
	}
}

func schemaDe(amb *ambiente) string {
	for n := range amb.esquemas {
		if n != "public" && n != "information_schema" {
			return n
		}
	}
	return "public"
}

// Funções que executam SQL em texto, leem tabela por nome/oid ou mudam o estado da sessão.
func TestFuncoesQueEscapamDaSombraSaoRecusadas(t *testing.T) {
	_, cat, amb := fixtureSombra(t)
	for nome, expr := range map[string]string{
		"query_to_xml":       "query_to_xml('select * from conta', true, false, '')",
		"query_to_xml mai":   "QUERY_TO_XML('select * from conta', true, false, '')",
		"table_to_xml":       "table_to_xml('conta'::regclass, true, false, '')",
		"cursor_to_xml":      "cursor_to_xml('x', 1, true, false, '')",
		"schema_to_xml":      "schema_to_xml('public', true, false, '')",
		"database_to_xml":    "database_to_xml(true, false, '')",
		"query_to_xmlschema": "query_to_xmlschema('select 1', true, false, '')",
		"ts_stat":            "ts_stat('select 1')",
		"pg_read_file":       "pg_read_file('/etc/passwd')",
		"pg_ls_dir":          "pg_ls_dir('.')",
		"lo_get":             "lo_get(1)",
		"dblink":             "dblink('x', 'select 1')",
		"set_config":         "set_config('search_path', 'x', false)",
		"pg_sleep":           "pg_sleep(1)",
		"pg_advisory_lock":   "pg_advisory_lock(1)",
		"txid_current":       "txid_current()",
		"to_regclass":        "to_regclass('conta')",
		"to_regproc":         "to_regproc('now')",
		"nextval":            "nextval('s')",
		"currval":            "currval('s')",
		"setval":             "setval('s', 1)",
		"pg_get_viewdef":     "pg_get_viewdef(1)",
		"cast regclass":      "'conta'::regclass",
		"cast regclass 2":    "cast('conta' as regclass)",
		"oid":                "c.tableoid",
		"set":                "set search_path = x",
		"current schema":     schemaDe(amb) + ".x",
	} {
		c := consultaAtaque("select c.nome, " + expr + " from coisa c")
		if err := c.validar(cat, amb); !errors.Is(err, ErrDeclaracao) {
			t.Errorf("%s: aceito ou sem ErrDeclaracao: %v", nome, err)
		}
	}
	// em qualquer parte do texto
	c := consultaAtaque("select c.nome from coisa c")
	c.Onde = "pg_sleep(1) is not null"
	if err := c.validar(cat, amb); !errors.Is(err, ErrDeclaracao) {
		t.Errorf("Onde: %v", err)
	}
	c = consultaAtaque("select c.nome from coisa c")
	c.Filtros = []Filtro{{Param: "x", SQL: "c.nome = @x::text and to_regclass('conta') is null", Tipo: "texto"}}
	if err := c.validar(cat, amb); !errors.Is(err, ErrDeclaracao) {
		t.Errorf("filtro: %v", err)
	}
}

// Revisão final: ts_rewrite(tsquery, text) executa um SELECT escrito em texto (pelo SPI, sem sombra e
// sem gramática) e currtid2(nome, tid) lê uma relação por nome. Aqui está a LISTA FECHADA recusada
// (PG 15-17 + contrib comum): toda função de pg_proc que executa SQL de texto, lê relação por
// nome/oid (regclass, text, oid) ou espia o catálogo por oid.
func TestListaFechadaDeFuncoesQueExecutamSQLOuLeemRelacao(t *testing.T) {
	_, cat, amb := fixtureSombra(t)
	casos := map[string]string{
		"ts_rewrite":              "ts_rewrite('a'::tsquery, 'select ''a''::tsquery, ''b''::tsquery from segredo')",
		"ts_rewrite caixa":        "TS_REWRITE('a'::tsquery, 'select 1')",
		"ts_rewrite 3 args":       "ts_rewrite('a'::tsquery, 'b'::tsquery, 'c'::tsquery)",
		"currtid2":                "currtid2('segredo', '(0,1)'::tid)",
		"currtid":                 "currtid('x', '(0,1)'::tid)",
		"regclassout":             "regclassout(1::oid)",
		"regtypeout":              "regtypeout(1::oid)",
		"brin_summarize":          "brin_summarize_new_values(1::oid)",
		"gin_clean_pending_list":  "gin_clean_pending_list(1::oid)",
		"row_security_active":     "row_security_active('segredo')",
		"has_table_privilege":     "has_table_privilege('segredo', 'select')",
		"has_column_privilege":    "has_column_privilege('segredo', 'valor', 'select')",
		"has_schema_privilege":    "has_schema_privilege('public', 'usage')",
		"has_database_privilege":  "has_database_privilege('postgres', 'connect')",
		"obj_description":         "obj_description(1::oid, 'pg_class')",
		"col_description":         "col_description(1::oid, 1)",
		"shobj_description":       "shobj_description(1::oid, 'pg_database')",
		"format_type":             "format_type(1::oid, null)",
		"current_query":           "current_query()",
		"current_setting":         "current_setting('server_version')",
		"loread":                  "loread(1, 1)",
		"lowrite":                 "lowrite(1, 'x'::bytea)",
		"binary_upgrade":          "binary_upgrade_set_next_pg_tablespace_oid(1::oid)",
		"query_to_xml_and_schema": "query_to_xml_and_xmlschema('select 1', true, false, '')",
		"table_to_xmlschema":      "table_to_xmlschema('segredo', true, false, '')",
		"cursor_to_xmlschema":     "cursor_to_xmlschema('x', true, false, '')",
		"schema_to_xmlschema":     "schema_to_xmlschema('public', true, false, '')",
		"database_to_xmlschema":   "database_to_xmlschema(true, false, '')",
		"crosstab (tablefunc)":    "crosstab('select 1')",
		"connectby (tablefunc)":   "connectby('segredo', 'a', 'b', 'c', 1)",
		"xpath_table (xml2)":      "xpath_table('a', 'b', 'segredo', 'c', 'd')",
		"pgstattuple":             "pgstattuple('segredo')",
		"pgrowlocks":              "pgrowlocks('segredo')",
		"get_raw_page":            "get_raw_page('segredo', 0)",
		"bt_page_items":           "bt_page_items('x', 1)",
		"verify_heapam":           "verify_heapam('segredo')",
		"st_estimatedextent":      "st_estimatedextent('segredo', 'geom')",
	}
	for nome, expr := range casos {
		for onde, c := range map[string]Consulta{
			"lista": consultaAtaque("select c.nome, " + expr + " from coisa c"),
			"onde": func() Consulta {
				c := consultaAtaque("select c.nome from coisa c")
				c.Onde = expr + " is not null"
				return c
			}(),
		} {
			if err := c.validar(cat, amb); !errors.Is(err, ErrDeclaracao) {
				t.Errorf("%s (%s): aceito ou sem ErrDeclaracao: %v", nome, onde, err)
			}
		}
	}
	// o que NÃO lê relação segue aceito (a lista fechada não pode virar recusa geral)
	for _, expr := range []string{"lower(c.nome)", "to_tsvector('portuguese', c.nome)", "regexp_replace(c.nome, 'a', 'b')",
		"json_build_object('a', c.nome)", "coalesce(c.dona, '')", "c.nome || 'x'", "length(c.nome) + 1"} {
		if err := consultaAtaque("select c.nome, "+expr+" from coisa c").validar(cat, amb); err != nil {
			t.Errorf("%s recusado: %v", expr, err)
		}
	}
}

func TestMenoresDaSegundaRevisao(t *testing.T) {
	_, cat, amb := fixtureSombra(t)
	base := func() Consulta { return consultaAtaque("select c.nome from coisa c") }
	casos := map[string]Consulta{
		"alias autz_":              Consulta{Tabela: "coisa", Alias: "autz_c", SQL: "select 1 from coisa autz_c", OrdemPadrao: "autz_c.nome", Desempate: "autz_c.id"},
		"alias autz_ na junção":    consultaAtaque("select c.nome from coisa c left join conta autz_k on autz_k.id = c.dona and {ler:conta:autz_k}"),
		"ordem com limit":          func() Consulta { c := base(); c.Ordens = map[string]string{"x": "c.nome limit 1"}; return c }(),
		"ordem com offset":         func() Consulta { c := base(); c.Ordens = map[string]string{"x": "c.nome offset 1"}; return c }(),
		"OrdemPadrao com limit":    func() Consulta { c := base(); c.OrdemPadrao = "c.nome limit 5"; return c }(),
		"Onde com marcador solto":  func() Consulta { c := base(); c.Onde = "{ler:conta:k}"; return c }(),
		"Onde com marcador negado": func() Consulta { c := base(); c.Onde = "not {ler:conta:k}"; return c }(),
	}
	for nome, c := range casos {
		if err := c.validar(cat, amb); !errors.Is(err, ErrDeclaracao) {
			t.Errorf("%s: %v", nome, err)
		}
	}
}

// As premissas da gramática são conferidas na montagem da rota.
func TestAmbienteConfereAsPremissas(t *testing.T) {
	p, _, amb := fixtureSombra(t)
	if !amb.reais["coisa"] || !amb.reais["segredo"] || amb.reais["coisa_id_seq"] {
		t.Errorf("reais = %v", amb.reais)
	}
	tx, _ := p.Begin(context.Background())
	defer tx.Rollback(context.Background())
	if _, err := tx.Exec(context.Background(), `set local standard_conforming_strings = off`); err != nil {
		t.Fatal(err)
	}
	if _, err := ambienteDoBanco(context.Background(), tx); err == nil || !strings.Contains(err.Error(), "standard_conforming_strings") {
		t.Errorf("com standard_conforming_strings = off: %v", err)
	}
}

// fakeConsultor devolve uma linha fixa: o que ambienteDoBanco lê (scf, versão, schema, tabelas).
type fakeConsultor struct {
	scf    string
	versao int
}

func (f fakeConsultor) QueryRow(context.Context, string, ...any) pgx.Row { return f }
func (f fakeConsultor) Scan(d ...any) error {
	*d[0].(*string), *d[1].(*int), *d[2].(*string), *d[3].(*[]string) = f.scf, f.versao, "public", []string{"coisa"}
	return nil
}

// `api worker conferir` reusa as premissas da montagem (ConferirAmbiente): premissa quebrada vem
// como ErrAmbiente (diferente de falha de conexão, que é erro comum).
func TestConferirAmbiente(t *testing.T) {
	ctx := context.Background()
	if err := ConferirAmbiente(ctx, fakeConsultor{"on", 170000}); err != nil {
		t.Errorf("PG 17 com scf on: %v", err)
	}
	for nome, f := range map[string]fakeConsultor{"scf off": {"off", 170000}, "PG 14": {"on", 140012}} {
		if err := ConferirAmbiente(ctx, f); !errors.Is(err, ErrAmbiente) {
			t.Errorf("%s: err = %v, esperava ErrAmbiente", nome, err)
		}
	}
}
