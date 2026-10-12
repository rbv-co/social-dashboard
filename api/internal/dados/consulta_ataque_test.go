package dados

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

// Ataques contra a leitura declarada, reproduzidos no banco real pela revisão da Task 5. Cada
// caso de TestConsultaRecusaDeclaracaoQueVaza passava na Validar e devolvia as contas A1 e A2 a
// quem só vê A1 (ou a equipe E2 a quem só é gestor de E1).
const catalogoDeAtaque = `[
 {"tabela":"conta","nome":"le","tipo":"permissive","comando":"select","papeis":["authenticated"],"using":"(auth.role() = 'authenticated'::text)","withCheck":null},
 {"tabela":"conta","nome":"so","tipo":"restrictive","comando":"select","papeis":["authenticated"],"using":"pode_ver_conta((id)::text)","withCheck":null},
 {"tabela":"coisa","nome":"le","tipo":"permissive","comando":"select","papeis":["public"],"using":"true","withCheck":null},
 {"tabela":"coisa","nome":"so","tipo":"restrictive","comando":"select","papeis":["authenticated"],"using":"pode_ver_conta(account_id)","withCheck":null},
 {"tabela":"eq_a","nome":"le","tipo":"permissive","comando":"select","papeis":["authenticated"],"using":"tenho_papel_na_equipe(equipe_id, ARRAY['gestor'::text])","withCheck":null},
 {"tabela":"eq_b","nome":"le","tipo":"permissive","comando":"select","papeis":["authenticated"],"using":"pode_ver_equipe(equipe_id)","withCheck":null}
]`

func consultaAtaque(sql string) Consulta {
	return Consulta{Tabela: "coisa", Alias: "c", SQL: sql, OrdemPadrao: "c.nome", Desempate: "c.id"}
}

func TestConsultaRecusaDeclaracaoQueVaza(t *testing.T) {
	cat, err := autz.Compilar([]byte(catalogoDeAtaque))
	if err != nil {
		t.Fatal(err)
	}
	casos := map[string]Consulta{
		// o que o scanner de regex não enxergava
		"comentário de bloco depois do from":      consultaAtaque("select c.nome, (select json_agg(k.id) from /**/ conta k) as vaza from coisa c"),
		"comentário de linha depois do from":      consultaAtaque("select c.nome, (select json_agg(k.id) from -- x\n conta k) as vaza from coisa c"),
		"vírgula depois de subconsulta":           consultaAtaque("select c.nome, k.id as vaza from coisa c, (select 1) s, conta k"),
		"parêntese dentro de string":              consultaAtaque("select c.nome, k.id as vaza from coisa c, generate_series(1, length(')')) g, conta k"),
		"join lateral com vírgula":                consultaAtaque("select c.nome from coisa c cross join lateral generate_series(1,2) g, conta k"),
		"table dentro de array()":                 consultaAtaque("select c.nome, array(table conta) as vaza from coisa c"),
		"marcador dentro de comentário":           consultaAtaque("select c.nome, (select json_agg(k.id) from conta k where true /* {ler:conta:k} */) as vaza from coisa c"),
		"marcador dentro de string":               consultaAtaque("select c.nome, (select json_agg(k.id) from conta k where '{ler:conta:k}' <> '') as vaza from coisa c"),
		"principal lida duas vezes":               consultaAtaque("select c.nome, (select count(*) from coisa c) as vaza from coisa c"),
		"alias repetido, uma leitura sem regra":   consultaAtaque("select c.nome, (select json_agg(k.id) from conta k) as vaza from coisa c left join conta k on k.id = c.dona and {ler:conta:k}"),
		"union all":                               consultaAtaque("select c.nome, c.account_id as vaza from coisa c where c.nome <> '' union all select c.nome, c.account_id from coisa c"),
		"right join":                              consultaAtaque("select c.nome, k.id as vaza from coisa c right join conta k on k.id = c.dona and {ler:conta:k}"),
		"full join":                               consultaAtaque("select c.nome from coisa c full join conta k on k.id = c.dona and {ler:conta:k}"),
		"principal no lado nulo de um left join":  consultaAtaque("select c.nome, k.id as vaza from conta k left join coisa c on c.dona = k.id and {ler:conta:k}"),
		"lateral":                                 consultaAtaque("select c.nome, k.vaza from coisa c, lateral (select 1 as vaza) k"),
		"junção por vírgula com where no nível 0": consultaAtaque("select c.nome from coisa c, conta k where k.id = c.dona and {ler:conta:k}"),
		"where no nível 0":                        consultaAtaque("select c.nome from coisa c where c.nome <> ''"),
		"cte":                                     consultaAtaque("with k as (select id from conta) select c.nome from coisa c"),
		"função fora da lista no from":            consultaAtaque("select c.nome from coisa c, equipe_que_le_tabela(c.id) f"),
		"using":                                   consultaAtaque("select c.nome from coisa c join conta k using (id)"),
		"marcador em or":                          consultaAtaque("select c.nome from coisa c left join conta k on k.id = c.dona or {ler:conta:k}"),
		"marcador em or aninhado":                 consultaAtaque("select c.nome, (select json_agg(k.id) from conta k where k.id = c.dona or ({ler:conta:k})) from coisa c"),
		"or antes do marcador, no mesmo nível":    consultaAtaque("select c.nome from coisa c left join conta k on k.id = c.dona or k.id = 'z' and {ler:conta:k}"),
		"or no grupo que envolve o marcador":      consultaAtaque("select c.nome from coisa c left join conta k on (k.id = c.dona or k.id = 'z' and {ler:conta:k})"),
		"comentário em qualquer lugar":            consultaAtaque("select c.nome -- x\n from coisa c"),
		"comentário de bloco colado":              consultaAtaque("select c.nome from coisa c /* x */"),
		"principal relida com o marcador dela":    consultaAtaque("select c.nome, (select count(*) from coisa c where {ler:coisa:c}) as n from coisa c"),
		"principal relida com outro alias":        consultaAtaque("select c.nome, (select count(*) from coisa d where {ler:coisa:d}) as n from coisa c"),
		"marcador em grupo negado":                consultaAtaque("select c.nome from coisa c left join conta k on k.id = c.dona and not ({ler:conta:k})"),
		"marcador dentro de função":               consultaAtaque("select c.nome from coisa c left join conta k on k.id = c.dona and coalesce({ler:conta:k}, true)"),
		"marcador dentro de subselect":            consultaAtaque("select c.nome, (select json_agg(k.id) from conta k where k.id = c.dona and (select true from generate_series(1, 2) g where g > 0 and {ler:conta:k})) from coisa c"),
		"marcador negado":                         consultaAtaque("select c.nome from coisa c left join conta k on k.id = c.dona and not {ler:conta:k}"),
		"marcador comparado":                      consultaAtaque("select c.nome from coisa c left join conta k on k.id = c.dona and {ler:conta:k} is not true"),
		"marcador na junção errada":               consultaAtaque("select c.nome, (select json_agg(m.id) from conta m left join eq_b b on true and {ler:conta:m} and {ler:eq_b:b}) from coisa c"),
		"Onde lendo tabela sem regra": func() Consulta {
			c := consultaAtaque("select c.nome from coisa c")
			c.Onde = "exists (select 1 from conta k where k.id = c.dona)"
			return c
		}(),
		"Onde com is distinct from": func() Consulta {
			c := consultaAtaque("select c.nome from coisa c")
			c.Onde = "c.dona is distinct from null"
			return c
		}(),
		"filtro lendo tabela sem regra": func() Consulta {
			c := consultaAtaque("select c.nome from coisa c")
			c.Filtros = []Filtro{{Param: "x", SQL: "c.dona in (select k.id from conta k where k.id = @x::text)", Tipo: "texto"}}
			return c
		}(),
		"ordem lendo tabela": func() Consulta {
			c := consultaAtaque("select c.nome from coisa c")
			c.Ordens = map[string]string{"x": "(select count(*) from conta k)"}
			return c
		}(),
		// BLOQUEIO 2: o mesmo alias em duas tabelas faz um marcador sobrescrever os parâmetros do outro
		"mesmo alias em duas tabelas": consultaAtaque(`select c.nome,
			(select json_agg(x.nome) from eq_a x where {ler:eq_a:x}) as a,
			(select count(*) from eq_b x where {ler:eq_b:x}) as b from coisa c`),
		"duas aliases para a mesma tabela": consultaAtaque(`select c.nome,
			(select count(*) from conta k where {ler:conta:k}) as a,
			(select count(*) from conta m where {ler:conta:m}) as b from coisa c`),
	}
	for nome, c := range casos {
		err := c.Validar(cat)
		switch {
		case err == nil:
			t.Errorf("%s: ACEITO (vazaria dados)", nome)
		case !errors.Is(err, ErrDeclaracao):
			t.Errorf("%s: recusado sem ErrDeclaracao (viraria 400): %v", nome, err)
		}
	}
}

// O que as rotas de domínio precisam continua passando.
func TestConsultaGramaticaAceitaOUsual(t *testing.T) {
	cat, _ := autz.Compilar([]byte(catalogoDeAtaque))
	casos := map[string]Consulta{
		"principal sozinha":                      consultaAtaque("select c.nome from coisa c"),
		"left join com regra":                    consultaAtaque("select c.nome, k.id from coisa c left join conta k on k.id = c.dona and {ler:conta:k}"),
		"inner join com regra":                   consultaAtaque("select c.nome from coisa c inner join conta k on k.id = c.dona and {ler:conta:k}"),
		"as no alias":                            consultaAtaque("select c.nome from coisa as c left join conta as k on {ler:conta:k} and k.id = c.dona"),
		"subconsulta na lista":                   consultaAtaque("select c.nome, (select row_to_json(k) from conta k where k.id = c.dona and {ler:conta:k}) as dona from coisa c"),
		"subconsulta agregada":                   consultaAtaque("select c.nome, (select json_agg(k.id order by k.id) from conta k where {ler:conta:k} and k.id <> c.dona) as ids from coisa c"),
		"exists no where":                        consultaAtaque("select c.nome, exists (select 1 from conta k where k.id = c.dona and {ler:conta:k}) as tem from coisa c"),
		"marcador entre parênteses":              consultaAtaque("select c.nome, (select count(*) from conta k where (k.id = c.dona and {ler:conta:k})) as n from coisa c"),
		"or em grupo que não envolve o marcador": consultaAtaque("select c.nome from coisa c left join conta k on (k.id = c.dona or k.id = 'z') and {ler:conta:k}"),
		"marcador na ponta do and":               consultaAtaque("select c.nome from coisa c left join conta k on {ler:conta:k} and (k.id = c.dona or k.id = 'z')"),
		"mesma tabela em dois lugares com marcador em cada": consultaAtaque(`select c.nome,
			(select count(*) from conta k where {ler:conta:k} and k.id = c.dona) as a,
			(select count(*) from conta k where {ler:conta:k} and k.id <> c.dona) as b from coisa c`),
		"função de conjunto sobre coluna": consultaAtaque("select c.nome, e.value from coisa c, jsonb_array_elements(c.dona::jsonb) e"),
		"função de conjunto com alias as": consultaAtaque("select c.nome, e from coisa c, generate_series(1, 3) as e"),
		"left() e right() são funções":    consultaAtaque("select left(c.nome, 2), right(c.nome, 1) from coisa c"),
		"parêntese dentro de string":      consultaAtaque("select c.nome, length(')') from coisa c"),
		"order by dentro de agregado":     consultaAtaque("select string_agg(c.nome, ',' order by c.nome) from coisa c"),
		"Onde com subconsulta e regra": func() Consulta {
			c := consultaAtaque("select c.nome from coisa c")
			c.Onde = "exists (select 1 from conta k where k.id = c.dona and {ler:conta:k})"
			return c
		}(),
		"Onde simples": func() Consulta { c := consultaAtaque("select c.nome from coisa c"); c.Onde = "c.nome <> 'x'"; return c }(),
	}
	for nome, c := range casos {
		if err := c.Validar(cat); err != nil {
			t.Errorf("%s: recusado: %v", nome, err)
		}
	}
}

func montarAtaque(t *testing.T, c Consulta, e *autz.Escopo) http.Handler {
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
		insert into conta values ('A1'), ('A2');
		insert into coisa (nome, account_id, dona) values ('a', 'A1', 'A1'), ('b', 'A1', 'A2'), ('c', 'A2', 'A1'), ('d', null, null);
		insert into eq_a (equipe_id, nome) values ('E1', 'gestor-ok'), ('E2', 'so-membro-NAO-PODE');
		insert into eq_b (equipe_id, nome) values ('E1', 'b1'), ('E2', 'b2')`); err != nil {
		t.Fatal(err)
	}
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			next.ServeHTTP(w, req.WithContext(autz.NoContexto(req.Context(), e)))
		})
	})
	r.Get("/x", c.Handler(p, cat))
	return r
}

// BLOQUEIO 1: a condição do filtro entrava sem parênteses; `a or b` virava `(regra) and a or b`
// e cancelava a regra. Quem só vê a conta A1 recebia a linha "c" (conta A2) com ?q=A1.
func TestConsultaFiltroComOrNaoCancelaARegra(t *testing.T) {
	c := consultaAtaque("select c.nome, c.account_id from coisa c")
	c.Filtros = []Filtro{{Param: "q", SQL: "c.nome = @q::text or c.dona = @q::text", Tipo: "texto"}}
	a1 := &autz.Escopo{ID: "11111111-0000-4000-a000-000000000001", TemPerfil: true, Ativo: true, Contas: []string{"A1"}}
	w := pedir(montarAtaque(t, c, a1), "/x?q=A1")
	if w.Code != 200 || compacto(w.Body.String()) != `[{"nome":"a","account_id":"A1"}]` {
		t.Errorf("?q=A1 = %d %s (a linha da conta A2 vazou)", w.Code, w.Body)
	}
	// o filtro continua valendo (não virou "sem filtro"): outro valor, outro resultado
	w = pedir(montarAtaque(t, c, a1), "/x?q=d")
	if w.Code != 200 || compacto(w.Body.String()) != `[{"nome":"d","account_id":null}]` {
		t.Errorf("?q=d = %d %s", w.Code, w.Body)
	}
}

// BLOQUEIO 2 (parte do runtime): com um alias por tabela, cada marcador leva os próprios
// parâmetros. Quem é gestor só de E1 vê "gestor-ok" em eq_a e as duas equipes que vê em eq_b.
func TestConsultaMarcadoresDeTabelasDiferentesNaoDividemParametros(t *testing.T) {
	c := consultaAtaque(`select c.nome,
		(select json_agg(x.nome) from eq_a x where {ler:eq_a:x}) as eq_a_visiveis,
		(select count(*) from eq_b y where {ler:eq_b:y}) as eq_b_n
		from coisa c`)
	a1 := &autz.Escopo{ID: "11111111-0000-4000-a000-000000000001", TemPerfil: true, Ativo: true, Contas: []string{"A1"},
		Vinculos: map[string][]string{"E1": {"gestor"}, "E2": {"membro"}}}
	w := pedir(montarAtaque(t, c, a1), "/x?limite=1")
	if w.Code != 200 || compacto(w.Body.String()) != `[{"nome":"a","eq_a_visiveis":["gestor-ok"],"eq_b_n":2}]` {
		t.Errorf("= %d %s", w.Code, w.Body)
	}
}

// Segunda camada do BLOQUEIO 2: mesmo que uma declaração com o mesmo alias em duas tabelas
// passasse pela Validar, a montagem recusa (parâmetro com dois valores) em vez de deixar o
// último sobrescrever. Aqui `montar` é chamado direto, sem Validar.
func TestMontarRecusaParametroDeRegraComDoisValores(t *testing.T) {
	cat, _ := autz.Compilar([]byte(catalogoDeAtaque))
	c := consultaAtaque(`select c.nome,
		(select json_agg(x.nome) from eq_a x where {ler:eq_a:x}) as a,
		(select count(*) from eq_b x where {ler:eq_b:x}) as b from coisa c`)
	e := &autz.Escopo{ID: "11111111-0000-4000-a000-000000000001", TemPerfil: true, Ativo: true, Contas: []string{"A1"},
		Vinculos: map[string][]string{"E1": {"gestor"}, "E2": {"membro"}}}
	_, _, _, err := c.montar(map[string][]string{}, e, cat)
	if !errors.Is(err, ErrDeclaracao) {
		t.Errorf("montar = %v, esperava ErrDeclaracao", err)
	}
}

func TestJuntarArgs(t *testing.T) {
	args := pgx.NamedArgs{"autz_x_0_1": []string{"a"}}
	igual := autz.Filtro{Args: pgx.NamedArgs{"autz_x_0_1": []string{"a"}, "autz_x_0_2": true}}
	if err := juntarArgs(args, igual); err != nil || args["autz_x_0_2"] != true {
		t.Errorf("mesmos valores (o mesmo marcador duas vezes) = %v", err)
	}
	if err := juntarArgs(args, autz.Filtro{Args: pgx.NamedArgs{"autz_x_0_1": []string{"b"}}}); !errors.Is(err, ErrDeclaracao) {
		t.Errorf("valores diferentes = %v", err)
	}
	if got := args["autz_x_0_1"].([]string); got[0] != "a" {
		t.Errorf("o valor antigo foi sobrescrito: %v", got)
	}
}

// 404 e 403 nunca se trocam, no HTTP: id de outra conta é 404 (não confirma que existe) e
// linha visível sem permissão é 403; defeito da declaração é 500 sem texto interno.
func TestErroDeEscritaNoHTTP(t *testing.T) {
	casos := []struct {
		err    error
		status int
		corpo  string
	}{
		{autz.ErrNaoEncontrado, 404, `{"error":"nao_encontrado"}`},
		{fmt.Errorf("conferir: %w", autz.ErrNaoEncontrado), 404, `{"error":"nao_encontrado"}`},
		{autz.ErrNegado, 403, `{"error":"sem_permissao"}`},
		{fmt.Errorf("conferir: %w", autz.ErrNegado), 403, `{"error":"sem_permissao"}`},
		{fmt.Errorf("%w: segredo interno", autz.ErrDeclaracao), 500, `{"error":"erro_interno"}`},
		{fmt.Errorf("%w: segredo interno", ErrDeclaracao), 500, `{"error":"erro_interno"}`},
		{&pgconn.PgError{Code: "23505"}, 409, `{"error":"conflito","mensagem":"Já existe um registro com esses dados."}`},
	}
	for _, c := range casos {
		w := httptest.NewRecorder()
		ErroDeEscrita(w, c.err)
		if w.Code != c.status || compacto(w.Body.String()) != c.corpo {
			t.Errorf("%v = %d %s, esperava %d %s", c.err, w.Code, w.Body, c.status, c.corpo)
		}
	}
}
