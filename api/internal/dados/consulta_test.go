package dados

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

// O mesmo catálogo de teste do autz (coisa lida por conta; conta lida por allowed_accounts).
const catalogoDeTeste = `[
 {"tabela":"conta","nome":"le","tipo":"permissive","comando":"select","papeis":["authenticated"],"using":"(auth.role() = 'authenticated'::text)","withCheck":null},
 {"tabela":"conta","nome":"so","tipo":"restrictive","comando":"select","papeis":["authenticated"],"using":"pode_ver_conta((id)::text)","withCheck":null},
 {"tabela":"coisa","nome":"le","tipo":"permissive","comando":"select","papeis":["public"],"using":"true","withCheck":null},
 {"tabela":"coisa","nome":"so","tipo":"restrictive","comando":"select","papeis":["authenticated"],"using":"pode_ver_conta(account_id)","withCheck":null}
]`

var consultaDeTeste = Consulta{
	Tabela: "coisa", Alias: "c",
	SQL: `select c.nome, c.account_id,
	        (select row_to_json(k) from conta k where k.id = c.dona and {ler:conta:k}) as dona
	      from coisa c`,
	Filtros:     []Filtro{{Param: "conta", SQL: "c.account_id = @conta::text", Tipo: "texto"}},
	Ordens:      map[string]string{"nome": "c.nome"},
	OrdemPadrao: "c.nome asc",
	Desempate:   "c.id",
}

func montarConsulta(t *testing.T, e *autz.Escopo) http.Handler {
	t.Helper()
	cat, err := autz.Compilar([]byte(catalogoDeTeste))
	if err != nil {
		t.Fatal(err)
	}
	if err := consultaDeTeste.Validar(cat); err != nil {
		t.Fatal(err)
	}
	p := testebanco.Novo(t)
	if _, err := p.Exec(context.Background(), `create table conta (id text primary key);
		create table coisa (id serial primary key, nome text, account_id text, dona text);
		insert into conta values ('A1'), ('A2');
		insert into coisa (nome, account_id, dona) values ('a', 'A1', 'A1'), ('b', 'A1', 'A2'), ('c', 'A2', 'A1'), ('d', null, null)`); err != nil {
		t.Fatal(err)
	}
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			if e != nil {
				req = req.WithContext(autz.NoContexto(req.Context(), e))
			}
			next.ServeHTTP(w, req)
		})
	})
	r.Get("/coisas", consultaDeTeste.Handler(p, cat))
	return r
}

// compacto: o json_agg separa os itens com ", \n " (igual ao PostgREST); o teste compara o conteúdo.
func compacto(s string) string {
	var b bytes.Buffer
	if json.Compact(&b, []byte(s)) != nil {
		return s
	}
	return b.String()
}

func pedir(h http.Handler, url string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", url, nil))
	return w
}

// IDOR: quem só vê a conta A1 não recebe linha de A2 nem filtrando por ela, e a conta
// embutida que não vê sai null (a regra vale também na tabela embutida).
func TestConsultaAplicaARegraNaPrincipalENaEmbutida(t *testing.T) {
	a1 := &autz.Escopo{ID: "11111111-0000-4000-a000-000000000001", TemPerfil: true, Ativo: true, Contas: []string{"A1"}}
	h := montarConsulta(t, a1)
	casos := map[string]string{
		"/coisas":                          `[{"nome":"a","account_id":"A1","dona":{"id":"A1"}}, {"nome":"b","account_id":"A1","dona":null}, {"nome":"d","account_id":null,"dona":null}]`,
		"/coisas?conta=A2":                 `[]`,
		"/coisas?ordem=nome.desc&limite=1": `[{"nome":"d","account_id":null,"dona":null}]`,
	}
	for url, quer := range casos {
		w := pedir(h, url)
		if w.Code != 200 || compacto(w.Body.String()) != compacto(quer) {
			t.Errorf("%s = %d %s", url, w.Code, w.Body)
		}
	}
	w := pedir(h, "/coisas?contar=1&limite=1")
	if w.Header().Get("X-Total-Count") != "3" {
		t.Errorf("X-Total-Count = %q", w.Header().Get("X-Total-Count"))
	}
	// 400: parâmetro desconhecido, ordem fora da lista, contar inválido, limite acima do teto,
	// e query malformada (par descartado em silêncio pelo r.URL.Query() = filtro ignorado)
	for _, url := range []string{"/coisas?cor=azul", "/coisas?ordem=id", "/coisas?contar=sim", "/coisas?limite=5000",
		"/coisas?conta=A2;x=1", "/coisas?conta=%zz", "/coisas?conta=A1&conta=A2", "/coisas?contar=1&contar=1"} {
		if w := pedir(h, url); w.Code != 400 {
			t.Errorf("%s = %d %s", url, w.Code, w.Body)
		}
	}
	// a query malformada também não chega ao caminho de contagem
	if w := pedir(h, "/coisas?contar=1&conta=%zz"); w.Code != 400 || w.Header().Get("X-Total-Count") != "" {
		t.Errorf("contar com query malformada = %d %q", w.Code, w.Header().Get("X-Total-Count"))
	}
	todas := &autz.Escopo{ID: a1.ID, TemPerfil: true, Ativo: true, TodasContas: true}
	if w := pedir(montarConsulta(t, todas), "/coisas?conta=A2"); compacto(w.Body.String()) != `[{"nome":"c","account_id":"A2","dona":{"id":"A1"}}]` {
		t.Errorf("quem vê tudo, filtrando A2 = %s", w.Body)
	}
	// sem nenhuma conta: lista negada é 200 [] (Ruling 9), nunca 403 nem linhas
	nenhuma := &autz.Escopo{ID: a1.ID, TemPerfil: true, Ativo: true}
	if w := pedir(montarConsulta(t, nenhuma), "/coisas"); w.Code != 200 || compacto(w.Body.String()) != `[{"nome":"d","account_id":null,"dona":null}]` {
		t.Errorf("sem conta alguma = %d %s", w.Code, w.Body)
	}
	if w := pedir(montarConsulta(t, nil), "/coisas"); w.Code != 500 {
		t.Errorf("sem escopo = %d (a rota precisa de autz.ComEscopo)", w.Code)
	}
}

func TestConsultaValidar(t *testing.T) {
	cat, _ := autz.Compilar([]byte(catalogoDeTeste))
	ok := func(c Consulta) Consulta {
		if c.OrdemPadrao == "" {
			c.OrdemPadrao = "c.nome"
		}
		if c.Desempate == "" {
			c.Desempate = "c.id"
		}
		if c.Tabela == "" {
			c.Tabela, c.Alias = "coisa", "c"
		}
		return c
	}
	if err := ok(Consulta{SQL: `select c.nome, x.v from coisa c, jsonb_array_elements('[]') x`}).Validar(cat); err != nil {
		t.Errorf("função no from recusada: %v", err)
	}
	for nome, c := range map[string]Consulta{
		"join sem regra":            ok(Consulta{SQL: `select c.nome from coisa c join conta k on k.id = c.dona`}),
		"subconsulta sem regra":     ok(Consulta{SQL: `select (select k.id from conta k where k.id = c.dona) from coisa c`}),
		"tabela sem alias":          ok(Consulta{SQL: `select c.nome from coisa c where exists (select 1 from conta where id = c.dona)`}),
		"alias trocado":             ok(Consulta{SQL: `select x.nome from coisa x`}),
		"não lê a principal":        ok(Consulta{SQL: `select k.id from conta k where {ler:conta:k}`}),
		"marcador fora do catálogo": ok(Consulta{SQL: `select c.nome from coisa c join outra o on {ler:outra:o}`}),
		"principal fora":            {Tabela: "outra", Alias: "o", SQL: `select 1 from outra o`, OrdemPadrao: "1", Desempate: "o.id"},
		"sem ordem":                 {Tabela: "coisa", Alias: "c", SQL: `select c.nome from coisa c`, Desempate: "c.id"},
		"sem desempate":             {Tabela: "coisa", Alias: "c", SQL: `select c.nome from coisa c`, OrdemPadrao: "c.nome"},
		"desempate com SQL":         ok(Consulta{SQL: `select c.nome from coisa c`, Desempate: "c.id; drop table x"}),
		"alias inválido":            {Tabela: "coisa", Alias: "C", SQL: `select 1 from coisa C`, OrdemPadrao: "1", Desempate: "C.id"},
		"filtro sem cast":           ok(Consulta{SQL: `select c.nome from coisa c`, Filtros: []Filtro{{Param: "x", SQL: "c.nome = @x", Tipo: "texto"}}}),
		"filtro com nome do escopo": ok(Consulta{SQL: `select c.nome from coisa c`, Filtros: []Filtro{{Param: "autz_c_0_1", SQL: "c.nome = @autz_c_0_1::text", Tipo: "texto"}}}),
		"filtro repetido": ok(Consulta{SQL: `select c.nome from coisa c`, Filtros: []Filtro{
			{Param: "x", SQL: "c.nome = @x::text", Tipo: "texto"}, {Param: "x", SQL: "c.dona = @x::text", Tipo: "texto"}}}),
		// as brechas que o regex simples deixaria passar
		"tabela entre aspas":        ok(Consulta{SQL: `select c.nome from coisa c where exists (select 1 from "conta" k where k.id = c.dona)`}),
		"junção por vírgula":        ok(Consulta{SQL: `select c.nome from coisa c, conta k where k.id = c.dona`}),
		"vírgula depois da função":  ok(Consulta{SQL: `select c.nome from coisa c, jsonb_array_elements('[]') x, conta k`}),
		"tabela entre parênteses":   ok(Consulta{SQL: `select c.nome from (coisa c join conta k on true)`}),
		"Onde com tabela sem regra": ok(Consulta{SQL: `select c.nome from coisa c`, Onde: `exists (select 1 from conta k where k.id = c.dona)`}),
		"filtro com tabela sem regra": ok(Consulta{SQL: `select c.nome from coisa c`, Filtros: []Filtro{
			{Param: "x", SQL: "c.dona in (select k.id from conta k where k.id = @x::text)", Tipo: "texto"}}}),
		"ordem com tabela sem regra": ok(Consulta{SQL: `select c.nome from coisa c`, Ordens: map[string]string{"x": "(select count(*) from conta k)"}}),
	} {
		err := c.Validar(cat)
		if err == nil {
			t.Errorf("%s: aceito", nome)
		} else if !errors.Is(err, ErrDeclaracao) {
			t.Errorf("%s: erro sem ErrDeclaracao (seria 400 em vez de 500): %v", nome, err)
		}
	}
	for nome, c := range map[string]Consulta{
		"join com regra":    ok(Consulta{SQL: `select c.nome from coisa c left join conta k on k.id = c.dona and {ler:conta:k}`}),
		"vírgula com regra": ok(Consulta{SQL: `select c.nome from coisa c, conta k where k.id = c.dona and {ler:conta:k}`}),
		"Onde com regra":    ok(Consulta{SQL: `select c.nome from coisa c`, Onde: `exists (select 1 from conta k where k.id = c.dona and {ler:conta:k})`}),
		"extract(from)":     ok(Consulta{SQL: `select extract(year from now()) from coisa c`}),
	} {
		if err := c.Validar(cat); err != nil {
			t.Errorf("%s: recusado: %v", nome, err)
		}
	}
}

// Rota montada sem validar não sobe: Handler recusa a declaração torta (deny by default).
func TestConsultaHandlerRecusaDeclaracaoInvalida(t *testing.T) {
	cat, _ := autz.Compilar([]byte(catalogoDeTeste))
	defer func() {
		if recover() == nil {
			t.Error("Handler aceitou uma consulta que lê tabela sem regra")
		}
	}()
	Consulta{Tabela: "coisa", Alias: "c", OrdemPadrao: "c.nome", Desempate: "c.id",
		SQL: `select c.nome from coisa c join conta k on true`}.Handler(nil, cat)
}
