package dados

import (
	"context"
	"fmt"
	"math/rand"
	"net/http/httptest"
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
}

func (m *mundoFuzz) rodar(p *pgxpool.Pool, c Consulta, e *autz.Escopo, sombra []string) (string, error) {
	sql, _, args, err := c.montar(map[string][]string{}, e, m.cat, sombra)
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

// avaliar: uma declaração candidata. Devolve true se foi aceita pela Validar.
func (m *mundoFuzz) avaliar(c Consulta, cnt *contagem) bool {
	m.t.Helper()
	cnt.total++
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
	for _, sombra := range [][]string{c.tabelasDaSombra(m.amb), nil} {
		got, e1 := m.rodar(m.cheio, c, m.eA1, sombra)
		want, e2 := m.rodar(m.a1, c, m.eTodas, sombra)
		if e1 != nil || e2 != nil {
			m.t.Errorf("montar: %v / %v em %+v", e1, e2, c)
			continue
		}
		cnt.executadas++
		if strings.HasPrefix(got, "ERRO") || strings.HasPrefix(want, "ERRO") {
			cnt.comErroSQL++
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

func novoMundoFuzz(t *testing.T) *mundoFuzz {
	t.Helper()
	cat, err := autz.Compilar([]byte(catalogoDoFuzz))
	if err != nil {
		t.Fatal(err)
	}
	m := &mundoFuzz{t: t, cat: cat, cheio: testebanco.Novo(t), a1: testebanco.Novo(t)}
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
		"pg_sleep(0)", "to_regclass('conta')", "query_to_xml('select 1', true, false, '')", "::regclass", "set x", "for update",
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
	n := 20000
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
	for i := range conhecidas {
		conhecidas[i].Desempate = "c.id"
		if !m.avaliar(conhecidas[i], &cnt) {
			t.Errorf("semente válida recusada: %s", conhecidas[i].SQL)
		}
	}
	aceitas = append(aceitas, conhecidas...)
	// sistemático: toda forma de marcador (certa e torta) em todo contexto (on de left join, on de
	// join, where de subconsulta escalar/agregada/exists, Onde) para as tabelas do catálogo
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
		switch i % 4 {
		case 0, 1:
			c = gerar(r)
		case 2:
			c = mutar(r, escolher(r, aceitas))
		default:
			if r.Intn(4) == 0 {
				c = sequenciaAleatoria(r)
			} else {
				c = mutar(r, gerar(r))
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
	if cnt.aceitas < 50 {
		t.Errorf("o fuzz aceitou só %d declarações: o gerador não exercita a gramática", cnt.aceitas)
	}
}
