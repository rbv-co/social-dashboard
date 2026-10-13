package dados

import (
	"context"
	"fmt"
	"math/rand"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

// FUZZ determinístico (semente fixa) da gramática e da sombra. Para cada declaração candidata:
//   - sem parse/ou com qualquer sinal de risco, Validar tem de RECUSAR (e nunca dar panic);
//   - tudo o que Validar ACEITA roda como uma pessoa que só vê a conta A1 num banco de 2 contas e o
//     resultado tem de ser IGUAL ao da mesma rota num banco que SÓ TEM as linhas que A1 vê (oráculo
//     diferencial: nenhuma linha, contagem ou existência de A2 pode aparecer), e não pode conter o
//     marcador "a2" (os dados de A2 o têm; os de A1 não).
//
// Dois regimes: com a sombra (o framework real) e SEM ela (só marcadores + gramática: um defeito da
// gramática aparece aqui mesmo que a sombra o cobrisse).
const catalogoDoFuzz = `[
 {"tabela":"conta","nome":"le","tipo":"permissive","comando":"select","papeis":["public"],"using":"true","withCheck":null},
 {"tabela":"conta","nome":"so","tipo":"restrictive","comando":"select","papeis":["authenticated"],"using":"pode_ver_conta((id)::text)","withCheck":null},
 {"tabela":"coisa","nome":"le","tipo":"permissive","comando":"select","papeis":["public"],"using":"true","withCheck":null},
 {"tabela":"coisa","nome":"so","tipo":"restrictive","comando":"select","papeis":["authenticated"],"using":"pode_ver_conta(account_id)","withCheck":null},
 {"tabela":"item","nome":"le","tipo":"permissive","comando":"select","papeis":["public"],"using":"true","withCheck":null},
 {"tabela":"item","nome":"so","tipo":"restrictive","comando":"select","papeis":["authenticated"],"using":"pode_ver_conta(account_id)","withCheck":null}
]`

const ddlDoFuzz = `create table conta (id text primary key, rotulo text);
	create table coisa (id int primary key, nome text, account_id text, dona text);
	create table item (id int primary key, nome text, account_id text, coisa_id int);
	create table segredo (id int primary key, valor text)`

func carregarFuzz(t *testing.T, p *pgxpool.Pool, soA1 bool) {
	t.Helper()
	ctx := context.Background()
	if _, err := p.Exec(ctx, ddlDoFuzz); err != nil {
		t.Fatal(err)
	}
	contas := `('A1', 'r1'), ('A2', 'ra2')`
	coisas := `(1, 'x1', 'A1', 'A1'), (2, 'x2', 'A1', null), (3, 'xa2', 'A2', 'A2'), (4, 'x4', null, null), (5, 'xa2b', 'A2', 'A1'), (6, 'x6', 'A1', 'A2')`
	itens := `(1, 'i1', 'A1', 1), (2, 'i2', 'A1', 2), (3, 'ia2', 'A2', 3), (4, 'i4', null, 4), (5, 'ia2b', 'A2', 1)`
	if soA1 { // o mundo como A1 o enxerga: nada de A2 existe
		contas = `('A1', 'r1')`
		coisas = `(1, 'x1', 'A1', 'A1'), (2, 'x2', 'A1', null), (4, 'x4', null, null), (6, 'x6', 'A1', 'A2')`
		itens = `(1, 'i1', 'A1', 1), (2, 'i2', 'A1', 2), (4, 'i4', null, 4)`
	}
	for _, sql := range []string{"insert into conta values " + contas, "insert into coisa values " + coisas,
		"insert into item values " + itens, "insert into segredo values (1, 'SEGREDO')"} {
		if _, err := p.Exec(ctx, sql); err != nil {
			t.Fatal(err)
		}
	}
}

type mundoFuzz struct {
	t           *testing.T
	cat         *autz.Catalogo
	cheio, a1   *pgxpool.Pool // o banco completo e o banco só com o que A1 vê
	amb         *ambiente
	eA1, eTodas *autz.Escopo
	origem      string
	stats       map[string]*porOrigem
}

func (m *mundoFuzz) rodar(p *pgxpool.Pool, c Consulta, e *autz.Escopo, sombra []string) (string, error) {
	q := url.Values{}
	if len(c.Filtros) > 0 { // o filtro declarado de fato executa
		q.Set("q", "x1")
	}
	sql, _, args, err := c.montar(q, e, m.cat, sombra)
	if err != nil {
		return "", err
	}
	ctx, cancela := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancela()
	w := httptest.NewRecorder()
	Lista(ctx, p, w, sql, args)
	if w.Code != 200 {
		return fmt.Sprintf("ERRO %d", w.Code), nil
	}
	return strings.Join(ordenado(m.t, w.Body.String()), "\n"), nil
}

type contagem struct{ total, aceitas, recusadas, executadas, comErroSQL int }

// porOrigem: quanto cada gerador aceita e quantas execuções chegam ao fim sem erro de SQL (só estas
// exercitam a sombra e o oráculo; erro de sintaxe do Postgres não devolve dado nenhum).
type porOrigem struct{ total, aceitas, executadas, comErro int }

// avaliar: uma declaração candidata. Devolve true se foi aceita pela Validar.
func (m *mundoFuzz) avaliar(c Consulta, cnt *contagem) bool {
	m.t.Helper()
	cnt.total++
	st := m.stats[m.origem]
	if st == nil {
		st = &porOrigem{}
		m.stats[m.origem] = st
	}
	st.total++
	var err error
	func() {
		defer func() {
			if x := recover(); x != nil {
				m.t.Errorf("Validar deu panic (%v) em %+v", x, c)
				err = fmt.Errorf("panic")
			}
		}()
		err = c.validar(m.cat, m.amb)
	}()
	if err != nil {
		cnt.recusadas++
		if !strings.Contains(err.Error(), ErrDeclaracao.Error()) && err.Error() != "panic" {
			m.t.Errorf("recusada sem ErrDeclaracao: %v", err)
		}
		return false
	}
	cnt.aceitas++
	st.aceitas++
	if n := nomePerigosoEm(c); n != "" { // a lista fechada vale para TODO o texto da declaração
		m.t.Errorf("ACEITA declaração com %q (executa SQL em texto/lê relação por nome): %+v", n, c)
	}
	for _, sombra := range [][]string{c.tabelasDaSombra(m.amb), nil} {
		got, e1 := m.rodar(m.cheio, c, m.eA1, sombra)
		want, e2 := m.rodar(m.a1, c, m.eTodas, sombra)
		if e1 != nil || e2 != nil {
			m.t.Errorf("montar: %v / %v em %+v", e1, e2, c)
			continue
		}
		cnt.executadas++
		st.executadas++
		if strings.HasPrefix(got, "ERRO") || strings.HasPrefix(want, "ERRO") {
			cnt.comErroSQL++
			st.comErro++
			continue // SQL inválido para o Postgres (coluna que não existe...): não devolve dado
		}
		if got != want {
			m.t.Errorf("VAZAMENTO (sombra=%v): A1 recebeu\n%s\nenquanto o mundo de A1 dá\n%s\nSQL: %s\nOnde: %s", sombra != nil, got, want, c.SQL, c.Onde)
		}
		if strings.Contains(strings.ToLower(got), "a2") {
			m.t.Errorf("VAZAMENTO (sombra=%v): dado de A2 na resposta: %s\nSQL: %s", sombra != nil, got, c.SQL)
		}
	}
	return true
}

// nomesPerigosos: a lista fechada de gramatica.go, vista de fora (o fuzz não pode depender de nomeNegado).
var nomesPerigosos = []string{"query_to_xml", "table_to_xml", "schema_to_xml", "database_to_xml", "cursor_to_xml", "ts_rewrite",
	"ts_stat", "currtid", "to_regclass", "dblink", "pg_", "regclass", "row_security_active", "has_table_privilege",
	"obj_description", "current_query", "current_setting", "crosstab", "connectby", "pgstattuple", "nextval", "set_config"}

func nomePerigosoEm(c Consulta) string {
	txt := strings.ToLower(c.SQL + " " + c.Onde)
	for _, f := range c.Filtros {
		txt += " " + strings.ToLower(f.SQL)
	}
	for _, n := range nomesPerigosos {
		if strings.Contains(txt, n) {
			return n
		}
	}
	return ""
}

func novoMundoFuzz(t *testing.T) *mundoFuzz {
	t.Helper()
	cat, err := autz.Compilar([]byte(catalogoDoFuzz))
	if err != nil {
		t.Fatal(err)
	}
	m := &mundoFuzz{t: t, cat: cat, cheio: testebanco.Novo(t), a1: testebanco.Novo(t), stats: map[string]*porOrigem{}}
	carregarFuzz(t, m.cheio, false)
	carregarFuzz(t, m.a1, true)
	if m.amb, err = ambienteDoBanco(context.Background(), m.cheio); err != nil {
		t.Fatal(err)
	}
	id := "11111111-0000-4000-a000-000000000001"
	m.eA1 = &autz.Escopo{ID: id, TemPerfil: true, Ativo: true, Contas: []string{"A1"}}
	m.eTodas = &autz.Escopo{ID: id, TemPerfil: true, Ativo: true, TodasContas: true}
	return m
}

// ---- gerador ----

var (
	tabelasFuzz = []struct{ nome, alias string }{{"conta", "k"}, {"item", "i"}, {"segredo", "s"}, {"coisa", "z"}, {"conta", "x"}, {"outra", "o"}}
	// marcador do jeito certo e do jeito errado
	marcadores = []string{"{ler:T:A}", "({ler:T:A})", "(({ler:T:A}))", "not {ler:T:A}", "({ler:T:A}) = false", "({ler:T:A}) is not true",
		"{ler:T:A} or true", "true or {ler:T:A}", "({ler:T:A}) in (false)", "c.nome between 'a' and {ler:T:A}", "c.nome not between 'a' and {ler:T:A}", "c.nome between symmetric 'a' and {ler:T:A}", "A.id <> '' and {ler:T:A}",
		"{ler:T:A} and A.id <> ''", "{ler:T:A}", "{ler:T:A}", "{ler:T:A}", "case when {ler:T:A} then true else false end",
		"{ler:T:A}::text = 'true'", "(A.id <> '' or A.id is null) and {ler:T:A}", "{ler:T:A} is not distinct from true", "true"}
	condicoes = []string{"A.id = c.dona", "A.id is not null", "true", "A.nome <> 'q'", "A.account_id = c.account_id", "1 = 1",
		"A.id in (select 1)", "c.nome between 'a' and 'z'", "A.id = c.id::text", ""}
	itensLista = []string{"c.nome", "c.account_id", "'literal'", "c.id + 1", "(select 1)", "length(')')", "left(c.nome, 1)", "c.nome::text"}
	lixo       = []string{"/**/", "-- x\n", "\"conta\"", "public.", "table conta", "union select 1", ";", "(select 1) q,", "lateral", "with q as (select 1)",
		"pg_sleep(0)", "to_regclass('conta')", "ts_rewrite('a'::tsquery, 'select 1')", "currtid2('segredo', '(0,1)'::tid)",
		"has_table_privilege('segredo', 'select')", "row_security_active('segredo')", "current_setting('x')", "crosstab('select 1')", "query_to_xml('select 1', true, false, '')", "::regclass", "set x", "for update",
		"c.nome between 'a' and 'b'", "'{ler:conta:k}'", "E'x'", "$1", "\\", "é", "right join conta r on true", "full join conta r on true",
		"natural join conta", "using (id)", "pg_class", "information_schema.tables", "limit 1", "order by 1", "where true", "group by 1",
		"{ler:conta:q}", "{ler:coisa:c}", "}", "{", "((", "))", ",", "select", "from", "join", "on", "left", "outer", "and", "or", "not", "case", "end"}
)

func escolher[T any](r *rand.Rand, l []T) T { return l[r.Intn(len(l))] }

func troca(s, tab, alias string) string {
	return strings.NewReplacer("T", tab, "A", alias).Replace(s)
}

func condicao(r *rand.Rand, tab, alias string) string {
	if r.Intn(2) == 0 { // o caso que importa: um marcador (certo ou torto), sozinho ou com um termo
		m := troca(escolher(r, marcadores), tab, alias)
		if r.Intn(2) == 0 {
			return m
		}
		return troca(escolher(r, condicoes[:6]), tab, alias) + " and " + m
	}
	partes := []string{}
	for n := 1 + r.Intn(3); n > 0; n-- {
		var p string
		if r.Intn(3) == 0 {
			p = troca(escolher(r, marcadores), tab, alias)
		} else {
			p = troca(escolher(r, condicoes), tab, alias)
		}
		if p != "" {
			partes = append(partes, p)
		}
	}
	if len(partes) == 0 {
		return "true"
	}
	return strings.Join(partes, " "+escolher(r, []string{"and", "and", "and", "or", ","})+" ")
}

func itemDeLista(r *rand.Rand) string {
	if r.Intn(2) == 0 {
		return escolher(r, itensLista)
	}
	t := escolher(r, tabelasFuzz)
	cond := condicao(r, t.nome, t.alias)
	switch r.Intn(4) {
	case 0:
		return fmt.Sprintf("(select count(*) from %s %s where %s)", t.nome, t.alias, cond)
	case 1:
		return fmt.Sprintf("exists (select 1 from %s %s where %s)", t.nome, t.alias, cond)
	case 2:
		return fmt.Sprintf("(select json_agg(%s.id order by %s.id) from %s %s where %s)", t.alias, t.alias, t.nome, t.alias, cond)
	}
	return fmt.Sprintf("array(select %s.id from %s %s where %s)", t.alias, t.nome, t.alias, cond)
}

func juncao(r *rand.Rand) string {
	t := escolher(r, tabelasFuzz)
	cond := condicao(r, t.nome, t.alias)
	switch r.Intn(9) {
	case 0:
		return fmt.Sprintf("join %s %s on %s", t.nome, t.alias, cond)
	case 1:
		return fmt.Sprintf(", %s %s", t.nome, t.alias)
	case 2:
		return "join generate_series(1, 2) g on true"
	case 3:
		return fmt.Sprintf("right join %s %s on %s", t.nome, t.alias, cond)
	case 4:
		return fmt.Sprintf("left join %s %s on true, %s %s", t.nome, t.alias, escolher(r, tabelasFuzz).nome, escolher(r, tabelasFuzz).alias)
	case 5:
		return fmt.Sprintf("left join generate_series(1, 2) g on true, %s %s", t.nome, t.alias)
	}
	return fmt.Sprintf("left join %s %s on %s", t.nome, t.alias, cond)
}

func gerar(r *rand.Rand) Consulta {
	var js strings.Builder
	for n := r.Intn(3); n > 0; n-- {
		js.WriteString(" " + juncao(r))
	}
	var b strings.Builder
	b.WriteString("select c.id as pid")
	for n := r.Intn(4); n > 0; n-- {
		b.WriteString(", " + itemDeLista(r))
	}
	for _, t := range tabelasFuzz { // mostra as colunas das tabelas juntadas: é onde o vazamento aparece
		if strings.Contains(js.String(), " "+t.nome+" "+t.alias) && r.Intn(4) != 0 {
			b.WriteString(", " + t.alias + ".id")
		}
	}
	b.WriteString(" from coisa c")
	b.WriteString(js.String())
	if r.Intn(8) == 0 {
		b.WriteString(" " + escolher(r, lixo))
	}
	c := Consulta{Tabela: "coisa", Alias: "c", SQL: b.String(), OrdemPadrao: "c.nome", Desempate: "c.id"}
	if r.Intn(4) == 0 {
		t := escolher(r, tabelasFuzz)
		c.Onde = escolher(r, []string{"exists", "not exists", ""}) + " (select 1 from " + t.nome + " " + t.alias + " where " + condicao(r, t.nome, t.alias) + ")"
		if r.Intn(5) == 0 {
			c.Onde = troca(escolher(r, marcadores), "conta", "k")
		}
	}
	if r.Intn(5) == 0 {
		t := escolher(r, tabelasFuzz)
		c.Filtros = []Filtro{{Param: "q", SQL: "c.nome = @q::text or exists (select 1 from " + t.nome + " " + t.alias + " where " + t.alias + ".id is not null)", Tipo: "texto"}}
	}
	return c
}

// ---- funções que executam SQL em texto / leem relação por nome (a lista fechada de gramatica.go) ----

// perigosas: o Postgres executaria o SQL do texto (ou leria a relação pelo nome) sem a sombra e sem a
// gramática; Validar TEM de recusar toda declaração que as contenha. Os alvos incluem a tabela de A2.
func perigosa(r *rand.Rand) string {
	alvo := escolher(r, []string{"coisa", "conta", "item", "segredo"})
	txt := escolher(r, []string{"select * from " + alvo, "select id from " + alvo + " where true", "select nome from coisa where account_id = ''A2''"})
	txt = strings.ReplaceAll(txt, "''", "'")
	q := strings.ReplaceAll(txt, "'", "''")
	return escolher(r, []string{
		"query_to_xml('" + q + "', true, false, '')",
		"(xpath('/row', query_to_xml('" + q + "', true, true, '')))[1]",
		"query_to_xml_and_xmlschema('" + q + "', true, false, '')",
		"table_to_xml('" + alvo + "'::regclass, true, false, '')",
		"table_to_xml('" + alvo + "', true, false, '')",
		"schema_to_xml('public', true, false, '')",
		"database_to_xml(true, false, '')",
		"cursor_to_xml('x', 1, true, false, '')",
		"ts_rewrite('a'::tsquery, 'select ''a''::tsquery, ''b''::tsquery from " + alvo + "')",
		"ts_rewrite('a'::tsquery, 'select ''a''::tsquery, nome::tsquery from coisa')",
		"TS_REWRITE('a'::tsquery, '" + q + "')",
		"ts_stat('" + q + "')",
		"currtid2('" + alvo + "', '(0,1)'::tid)",
		"currtid2('" + alvo + "', c.ctid)",
		"to_regclass('" + alvo + "')",
		"dblink('dbname=x', '" + q + "')",
		"pg_get_viewdef('" + alvo + "'::regclass)",
		"pg_relation_size('" + alvo + "')",
		"pg_table_size('" + alvo + "')",
		"regclassout('" + alvo + "'::regclass)",
		"row_security_active('" + alvo + "')",
		"has_table_privilege('" + alvo + "', 'select')",
		"obj_description(1::oid, 'pg_class')",
		"current_query()",
		"current_setting('server_version')",
		"crosstab('" + q + "')",
		"connectby('" + alvo + "', 'id', 'id', '1', 1)",
		"pgstattuple('" + alvo + "')",
		"nextval('" + alvo + "')",
		"set_config('search_path', '" + alvo + "', false)",
	})
}

// inofensivas: funções comuns que a gramática aceita e que EXECUTAM (exercitam a sombra e o oráculo).
func inofensiva(r *rand.Rand) string {
	return escolher(r, []string{"lower(c.nome)", "coalesce(c.account_id, '')", "left(c.nome, 2)", "c.nome || 'x'", "length(c.nome) + 1",
		"to_tsvector('portuguese', c.nome)", "json_build_object('n', c.nome)", "to_json(c.nome)", "regexp_replace(c.nome, 'x', 'y')",
		"c.account_id is null", "case when c.dona is null then 1 else 2 end", "upper(coalesce(c.account_id, 'n'))", "xmlforest(c.nome as n)::text",
		"jsonb_build_array(c.id, c.nome)", "(c.id % 2 = 0)", "md5(c.nome)", "array_length(array[c.id, 1], 1)"})
}

// ---- gerador correto por construção: toda leitura de outra tabela traz o marcador certo ----

var colunasFuzz = map[string][]string{"conta": {"id", "rotulo"}, "item": {"id", "nome", "account_id", "coisa_id"}}
var aliasFuzz = map[string]string{"conta": "k", "item": "i"}

// ligacaoFuzz: o termo que liga a tabela t a coisa c.
func ligacaoFuzz(r *rand.Rand, t string) string {
	a := aliasFuzz[t]
	if t == "conta" {
		return escolher(r, []string{a + ".id = c.dona", a + ".id = c.account_id", a + ".id is not null"})
	}
	return escolher(r, []string{a + ".coisa_id = c.id", a + ".account_id = c.account_id", a + ".nome <> 'q'"})
}

// condicaoCorreta: termos de and com o marcador certo (em posição, agrupamento e redundância variados).
func condicaoCorreta(r *rand.Rand, t string) string {
	a := aliasFuzz[t]
	mk := "{ler:" + t + ":" + a + "}"
	termos := []string{ligacaoFuzz(r, t)}
	if r.Intn(3) == 0 {
		if t == "conta" {
			termos = append(termos, a+".id <> ''")
		} else {
			termos = append(termos, a+".id > 0")
		}
	}
	switch r.Intn(4) {
	case 0:
		mk = "(" + mk + ")"
	case 1:
		mk = "((" + mk + "))"
	}
	pos := r.Intn(len(termos) + 1)
	termos = append(termos[:pos], append([]string{mk}, termos[pos:]...)...)
	c := strings.Join(termos, " and ")
	if r.Intn(5) == 0 {
		c = "(" + c + ")"
	}
	return c
}

func subconsultaCorreta(r *rand.Rand, t string) string {
	a := aliasFuzz[t]
	cond := condicaoCorreta(r, t)
	switch r.Intn(4) {
	case 0:
		return fmt.Sprintf("(select count(*) from %s %s where %s)", t, a, cond)
	case 1:
		return fmt.Sprintf("exists (select 1 from %s %s where %s)", t, a, cond)
	case 2:
		return fmt.Sprintf("(select json_agg(%s.id order by %s.id) from %s %s where %s)", a, a, t, a, cond)
	}
	return fmt.Sprintf("array(select %s.id from %s %s where %s)", a, t, a, cond)
}

// gerarCorreta: declaração válida por construção, com no máximo um defeito (corrupção) opcional.
// O defeito é uma das formas torta/ausente de marcador, a função perigosa, ou lixo de sintaxe.
func gerarCorreta(r *rand.Rand, corromper bool) Consulta {
	var js, lista strings.Builder
	juntadas := map[string]bool{}
	lista.WriteString("select c.id as pid")
	for _, t := range []string{"conta", "item"} {
		if r.Intn(2) == 0 {
			continue
		}
		a := aliasFuzz[t]
		kind := escolher(r, []string{"left join", "left join", "join", "inner join"})
		js.WriteString(fmt.Sprintf(" %s %s %s on %s", kind, t, a, condicaoCorreta(r, t)))
		juntadas[t] = true
		lista.WriteString(", " + a + "." + escolher(r, colunasFuzz[t]))
	}
	for n := r.Intn(4); n > 0; n-- {
		switch r.Intn(3) {
		case 0:
			lista.WriteString(", " + inofensiva(r))
		case 1:
			lista.WriteString(", " + subconsultaCorreta(r, escolher(r, []string{"conta", "item"})))
		default:
			lista.WriteString(", " + escolher(r, []string{"c.nome", "c.account_id", "c.nome", "c.id + 1"}))
		}
	}
	sql := lista.String() + " from coisa c" + js.String()
	c := Consulta{Tabela: "coisa", Alias: "c", SQL: sql, OrdemPadrao: "c.nome", Desempate: "c.id"}
	if r.Intn(3) == 0 {
		t := escolher(r, []string{"conta", "item"})
		c.Onde = escolher(r, []string{"exists", "not exists"}) + " (select 1 from " + t + " " + aliasFuzz[t] + " where " + condicaoCorreta(r, t) + ")"
	}
	if r.Intn(4) == 0 {
		c.Filtros = []Filtro{{Param: "q", SQL: "c.nome = @q::text", Tipo: "texto"}}
	}
	if !corromper {
		return c
	}
	switch r.Intn(6) {
	case 0: // marcador torto
		c.SQL = strings.Replace(c.SQL, "{ler:", escolher(r, []string{"not {ler:", "false or {ler:", "true or {ler:"}), 1)
	case 1: // marcador ausente
		for _, t := range []string{"conta", "item"} {
			c.SQL = strings.Replace(c.SQL, " and {ler:"+t+":"+aliasFuzz[t]+"}", "", 1)
			c.SQL = strings.Replace(c.SQL, "{ler:"+t+":"+aliasFuzz[t]+"} and ", "", 1)
		}
	case 2: // função perigosa na lista, no Onde, num filtro ou numa condição de on
		x := perigosa(r)
		switch r.Intn(4) {
		case 0:
			c.SQL = strings.Replace(c.SQL, " from coisa c", ", "+x+" as z from coisa c", 1)
		case 1:
			c.Onde = x + " is not null"
		case 2:
			c.Filtros = []Filtro{{Param: "q", SQL: "c.nome = @q::text and " + x + " is not null", Tipo: "texto"}}
		default:
			c.SQL = strings.Replace(c.SQL, " on ", " on "+x+" is not null and ", 1)
		}
	case 3: // lixo de sintaxe
		c.SQL += " " + escolher(r, lixo)
	case 4: // outra tabela real no lugar de uma do catálogo
		c.SQL = strings.Replace(c.SQL, " from conta ", " from segredo ", 1)
		c.SQL = strings.Replace(c.SQL, "join conta ", "join segredo ", 1)
	default: // tabela principal lida de novo
		c.SQL = strings.Replace(c.SQL, " from coisa c", ", (select count(*) from coisa c where true) from coisa c", 1)
	}
	return c
}

// mutarEstruturado: troca peças inteiras de uma declaração (forma do marcador, tipo de junção, item
// extra) em vez de tokens soltos; o resultado quase sempre ainda é SQL válido e EXECUTA.
func mutarEstruturado(r *rand.Rand, c Consulta) Consulta {
	for n := 1 + r.Intn(2); n > 0; n-- {
		switch r.Intn(5) {
		case 0:
			for _, t := range []string{"conta", "item"} {
				mk := "{ler:" + t + ":" + aliasFuzz[t] + "}"
				if strings.Contains(c.SQL, mk) {
					c.SQL = strings.Replace(c.SQL, mk, troca(escolher(r, marcadores), t, aliasFuzz[t]), 1)
					break
				}
			}
		case 1:
			c.SQL = strings.Replace(c.SQL, " left join ", " join ", 1)
		case 2:
			c.SQL = strings.Replace(c.SQL, " join ", " left join ", 1)
		case 3:
			c.SQL = strings.Replace(c.SQL, " from coisa c", ", "+inofensiva(r)+" as m from coisa c", 1)
		default:
			t := escolher(r, []string{"conta", "item"})
			c.SQL = strings.Replace(c.SQL, " from coisa c", ", "+subconsultaCorreta(r, t)+" as s from coisa c", 1)
		}
	}
	return c
}

// mutar: mutação no nível dos tokens de uma declaração (válida ou não).
func mutar(r *rand.Rand, c Consulta) Consulta {
	toks := strings.Fields(strings.NewReplacer("(", " ( ", ")", " ) ", ",", " , ").Replace(c.SQL))
	for n := 1 + r.Intn(3); n > 0 && len(toks) > 2; n-- {
		i := 1 + r.Intn(len(toks)-1)
		switch r.Intn(5) {
		case 0:
			toks = append(toks[:i], toks[i+1:]...)
		case 1:
			toks = append(toks[:i+1], toks[i:]...)
		case 2:
			toks[i] = escolher(r, lixo)
		case 3:
			toks = append(toks[:i], append([]string{escolher(r, lixo)}, toks[i:]...)...)
		default:
			j := 1 + r.Intn(len(toks)-1)
			toks[i], toks[j] = toks[j], toks[i]
		}
	}
	c.SQL = strings.Join(toks, " ")
	return c
}

func sequenciaAleatoria(r *rand.Rand) Consulta {
	var toks []string
	for n := 3 + r.Intn(30); n > 0; n-- {
		toks = append(toks, escolher(r, append(append([]string{}, lixo...), "c.id", "c.nome", "conta", "k", "k.id", "coisa", "c", "item", "i", "'a'", "1", "=", "<>", "{ler:conta:k}", "{ler:item:i}", "(", ")", "exists", "json_agg", "count(*)", "g")))
	}
	return Consulta{Tabela: "coisa", Alias: "c", SQL: "select " + strings.Join(toks, " "), OrdemPadrao: "c.nome", Desempate: "c.id"}
}

func TestFuzzDaGramaticaESombra(t *testing.T) {
	m := novoMundoFuzz(t)
	r := rand.New(rand.NewSource(20261012))
	n := 12000
	if testing.Short() {
		n = 2000
	}
	var cnt contagem
	var aceitas []Consulta
	conhecidas := []Consulta{ // declarações válidas conhecidas: sementes das mutações
		consultaAtaque("select c.id as pid, c.nome from coisa c"),
		consultaAtaque("select c.id as pid, k.id from coisa c left join conta k on k.id = c.dona and {ler:conta:k}"),
		consultaAtaque("select c.id as pid, (select json_agg(i.id order by i.id) from item i where {ler:item:i}) as itens from coisa c"),
		consultaAtaque("select c.id as pid, (select count(*) from conta k where k.id = c.dona and ({ler:conta:k})) as n from coisa c"),
		consultaAtaque("select c.id as pid, e.value from coisa c, jsonb_array_elements('[1]'::jsonb) e"),
		consultaAtaque("select c.id as pid, i.nome from coisa c join item i on i.coisa_id = c.id and {ler:item:i} left join conta k on k.id = i.account_id and {ler:conta:k}"),
	}
	m.origem = "semente"
	for i := range conhecidas {
		conhecidas[i].Desempate = "c.id"
		if !m.avaliar(conhecidas[i], &cnt) {
			t.Errorf("semente válida recusada: %s", conhecidas[i].SQL)
		}
	}
	aceitas = append(aceitas, conhecidas...)
	// sistemático: toda forma de marcador (certa e torta) em todo contexto (on de left join, on de
	// join, where de subconsulta escalar/agregada/exists, Onde) para as tabelas do catálogo
	m.origem = "sistemática"
	for _, tab := range []struct{ nome, alias string }{{"conta", "k"}, {"item", "i"}} {
		for _, mk := range marcadores {
			cond := troca(mk, tab.nome, tab.alias)
			for _, sql := range []string{
				fmt.Sprintf("select c.id as pid, %s.id from coisa c left join %s %s on %s.id is not null and %s", tab.alias, tab.nome, tab.alias, tab.alias, cond),
				fmt.Sprintf("select c.id as pid, %s.id from coisa c join %s %s on %s", tab.alias, tab.nome, tab.alias, cond),
				fmt.Sprintf("select c.id as pid, (select count(*) from %s %s where %s) as n from coisa c", tab.nome, tab.alias, cond),
				fmt.Sprintf("select c.id as pid, (select json_agg(%s.id) from %s %s where %s.id is not null and %s) as j from coisa c", tab.alias, tab.nome, tab.alias, tab.alias, cond),
				fmt.Sprintf("select c.id as pid, exists (select 1 from %s %s where %s) as e from coisa c", tab.nome, tab.alias, cond),
			} {
				c := consultaAtaque(sql)
				if m.avaliar(c, &cnt) {
					aceitas = append(aceitas, c)
				}
			}
			c := consultaAtaque("select c.id as pid from coisa c")
			c.Onde = fmt.Sprintf("exists (select 1 from %s %s where %s)", tab.nome, tab.alias, cond)
			m.avaliar(c, &cnt)
			c.Onde = cond
			m.avaliar(c, &cnt)
		}
	}
	inicio := time.Now()
	for i := 0; i < n; i++ {
		var c Consulta
		switch i % 8 {
		case 0, 1:
			m.origem, c = "gerada (livre)", gerar(r)
		case 2, 3:
			m.origem, c = "gerada (correta)", gerarCorreta(r, false)
		case 4:
			m.origem, c = "gerada (com defeito)", gerarCorreta(r, true)
		case 5:
			m.origem, c = "mutação estruturada", mutarEstruturado(r, escolher(r, aceitas))
		case 6:
			m.origem, c = "mutação de token", mutar(r, escolher(r, aceitas))
		default:
			if r.Intn(4) == 0 {
				m.origem, c = "sequência aleatória", sequenciaAleatoria(r)
			} else {
				m.origem, c = "mutação de gerada", mutar(r, gerar(r))
			}
		}
		if m.avaliar(c, &cnt) && len(aceitas) < 400 {
			aceitas = append(aceitas, c)
		}
		if t.Failed() && cnt.total > 50 && i%1000 == 0 {
			break
		}
	}
	t.Logf("FUZZ: %d declarações, %d aceitas, %d recusadas, %d execuções (%d com erro de SQL do Postgres) em %v",
		cnt.total, cnt.aceitas, cnt.recusadas, cnt.executadas, cnt.comErroSQL, time.Since(inicio).Round(time.Millisecond))
	for o, st := range m.stats {
		t.Logf("  %-22s %6d declarações %6d aceitas %6d execuções %6d com erro de SQL", o, st.total, st.aceitas, st.executadas, st.comErro)
	}
	// o gerador tem de EXERCITAR: a maioria das execuções roda de verdade (erro de SQL do Postgres não
	// devolve dado e não testa nada). Antes da revisão final ~40% eram erros.
	limpas := cnt.executadas - cnt.comErroSQL
	if limpas*100 < cnt.executadas*85 || limpas < 500 {
		t.Errorf("só %d de %d execuções rodaram sem erro de SQL: o gerador não exercita a sombra e o oráculo", limpas, cnt.executadas)
	}
	if cnt.aceitas < 50 {
		t.Errorf("o fuzz aceitou só %d declarações: o gerador não exercita a gramática", cnt.aceitas)
	}
}
