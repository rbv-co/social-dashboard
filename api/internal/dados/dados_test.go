package dados

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

func TestErroDoBanco(t *testing.T) {
	casos := []struct {
		err    error
		status int
		corpo  string
	}{
		{pgx.ErrNoRows, 404, `{"error":"nao_encontrado"}`},
		{&pgconn.PgError{Code: "42501", Message: "Sem acesso para cadastrar colaborador", Detail: "SEGREDO"}, 403, `{"error":"sem_permissao","mensagem":"Sem acesso para cadastrar colaborador"}`},
		{&pgconn.PgError{Code: "P0001", Message: "Lote já gravado", Detail: "SEGREDO"}, 400, `{"error":"regra_de_negocio","mensagem":"Lote já gravado"}`},
		{&pgconn.PgError{Code: "22023", Message: "Digite o nome antes de criar."}, 400, `{"error":"regra_de_negocio","mensagem":"Digite o nome antes de criar."}`},
		{&pgconn.PgError{Code: "23505", Message: `duplicate key value violates unique constraint "x_email"`, Detail: "Key (email)=(SEGREDO@x) already exists."}, 409, `{"error":"conflito","mensagem":"Já existe um registro com esses dados."}`},
		{&pgconn.PgError{Code: "23503", Message: "fk", Detail: "SEGREDO"}, 409, `{"error":"conflito","mensagem":"O registro está ligado a outro que não existe ou que ainda depende dele."}`},
		{&pgconn.PgError{Code: "22P02", Message: `invalid input syntax for type uuid: "SEGREDO"`}, 400, `{"error":"pedido_invalido"}`},
		{&pgconn.PgError{Code: "23502", Message: `null value in column "SEGREDO"`}, 400, `{"error":"pedido_invalido"}`},
		{&pgconn.PgError{Code: "XX000", Message: "SEGREDO interno"}, 500, `{"error":"erro_interno"}`},
		{context.DeadlineExceeded, 504, `{"error":"prazo_esgotado"}`},
		{errors.New("dial tcp 10.0.0.1:5432: SEGREDO"), 500, `{"error":"erro_interno"}`},
	}
	for _, c := range casos {
		w := httptest.NewRecorder()
		ErroDoBanco(w, c.err)
		if w.Code != c.status || strings.TrimSpace(w.Body.String()) != c.corpo {
			t.Errorf("%v: %d %s, esperava %d %s", c.err, w.Code, w.Body, c.status, c.corpo)
		}
		if strings.Contains(w.Body.String(), "SEGREDO") {
			t.Errorf("%v: vazou detalhe na resposta: %s", c.err, w.Body)
		}
	}
}

func TestLerCorpo(t *testing.T) {
	type alvo struct {
		Nome string `json:"nome"`
	}
	casos := []struct {
		corpo  string
		ok     bool
		status int
	}{
		{`{"nome":"a"}`, true, 200},
		{`{"nome":"a","is_superadmin":true}`, false, 400}, // campo não declarado: nunca vira coluna
		{`{"nome":"a"} {"nome":"b"}`, false, 400},
		{`{"nome":`, false, 400},
		{`{"nome":"` + strings.Repeat("x", 1<<20) + `"}`, false, 413},
	}
	for _, c := range casos {
		w := httptest.NewRecorder()
		var a alvo
		ok := LerCorpo(w, httptest.NewRequest("POST", "/", strings.NewReader(c.corpo)), &a)
		if ok != c.ok || (!ok && w.Code != c.status) {
			t.Errorf("%.40q: ok=%v status=%d", c.corpo, ok, w.Code)
		}
	}
}

// O JSON sai do Postgres, como no PostgREST: data com +00:00 (pool em UTC), numeric com as
// casas, nulo, jsonb aninhado e chaves na ordem das colunas.
func TestListaEUmNoFormatoDoPostgREST(t *testing.T) {
	p := testebanco.Novo(t)
	ctx := context.Background()
	if _, err := p.Exec(ctx, `create table coisa (id int, quando timestamptz, valor numeric(10,2), nada text, extra jsonb);
		insert into coisa values (1, '2026-10-11 09:00:00-03', 10.5, null, '{"a":[1,2]}'), (2, '2026-10-12 00:00:00+00', 0, 'x', null)`); err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	Lista(ctx, p, w, `select * from coisa where id = @id::int`, pgx.NamedArgs{"id": 1})
	quer := `[{"id":1,"quando":"2026-10-11T12:00:00+00:00","valor":10.50,"nada":null,"extra":{"a": [1, 2]}}]`
	if w.Code != 200 || w.Body.String() != quer || w.Header().Get("Content-Type") != "application/json" {
		t.Fatalf("Lista = %d %s", w.Code, w.Body)
	}
	w = httptest.NewRecorder()
	Lista(ctx, p, w, `select * from coisa where id = @id::int`, pgx.NamedArgs{"id": 99})
	if w.Body.String() != `[]` {
		t.Fatalf("Lista vazia = %s", w.Body)
	}
	for _, c := range []struct {
		onde   string
		status int
		corpo  string
	}{
		{"id = 2", 200, `{"id":2,"quando":"2026-10-12T00:00:00+00:00","valor":0.00,"nada":"x","extra":null}`},
		{"id = 99", 404, `{"error":"nao_encontrado"}`},
		{"true", 500, `{"error":"erro_interno"}`},
	} {
		w = httptest.NewRecorder()
		Um(ctx, p, w, `select * from coisa where `+c.onde, nil)
		if w.Code != c.status || strings.TrimSpace(w.Body.String()) != c.corpo {
			t.Errorf("Um(%s) = %d %s", c.onde, w.Code, w.Body)
		}
	}
}

func TestLerPagina(t *testing.T) {
	for q, quer := range map[string]Pagina{"": {1000, 0}, "limite=10&deslocamento=20": {10, 20}, "limite=1000": {1000, 0}} {
		v, _ := url.ParseQuery(q)
		if p, err := LerPagina(v); err != nil || p != quer {
			t.Errorf("%q = %+v %v", q, p, err)
		}
	}
	for _, q := range []string{"limite=0", "limite=1001", "limite=x", "deslocamento=-1", "deslocamento=1.5"} {
		v, _ := url.ParseQuery(q)
		if _, err := LerPagina(v); err == nil {
			t.Errorf("%q aceito", q)
		}
	}
}

func TestLerOrdemSoComCamposPermitidos(t *testing.T) {
	perm := map[string]string{"quando": "u.criado_em", "placa": "v.placa"}
	for q, quer := range map[string]string{"": "u.criado_em desc", "ordem=quando": "u.criado_em asc", "ordem=placa.desc": "v.placa desc", "ordem=placa.asc": "v.placa asc"} {
		v, _ := url.ParseQuery(q)
		if got, err := LerOrdem(v, perm, "u.criado_em desc"); err != nil || got != quer {
			t.Errorf("%q = %q %v", q, got, err)
		}
	}
	// url.Values direto: ParseQuery descartaria o par com ";" e o teste não testaria nada
	for _, o := range []string{"id", "quando.desc;drop table x", "quando.nullsfirst", "u.criado_em", "quando desc"} {
		if got, err := LerOrdem(url.Values{"ordem": {o}}, perm, "x"); err == nil {
			t.Errorf("%q aceito: %q", o, got)
		}
	}
}

func TestFiltroValidar(t *testing.T) {
	if err := (Filtro{Param: "veiculo", SQL: "u.veiculo_id = @veiculo::uuid", Tipo: "uuid"}).Validar(); err != nil {
		t.Fatal(err)
	}
	for _, f := range []Filtro{
		{Param: "veiculo", SQL: "u.veiculo_id = @veiculo", Tipo: "uuid"}, // sem cast
		{Param: "limite", SQL: "x = @limite::int", Tipo: "inteiro"},      // reservado
		{Param: "Veiculo", SQL: "x = @Veiculo::uuid", Tipo: "uuid"},
		{Param: "veiculo", SQL: "x = @veiculo::uuid", Tipo: "numero"},
	} {
		if f.Validar() == nil {
			t.Errorf("%+v aceito", f)
		}
	}
}

func TestLerFiltros(t *testing.T) {
	fs := []Filtro{
		{Param: "veiculo", SQL: "u.veiculo_id = @veiculo::uuid", Tipo: "uuid"},
		{Param: "lojas", SQL: "u.loja_id = any(@lojas::bigint[])", Tipo: "inteiro[]"},
		{Param: "desde", SQL: "u.dia >= @desde::date", Tipo: "data"},
	}
	v, _ := url.ParseQuery("veiculo=AAAAAAAA-1111-1111-1111-111111111111&lojas=1,2&desde=2026-10-01&limite=5")
	args := pgx.NamedArgs{}
	conds, err := LerFiltros(v, fs, args)
	if err != nil || len(conds) != 3 {
		t.Fatalf("conds=%v err=%v", conds, err)
	}
	if args["veiculo"] != "aaaaaaaa-1111-1111-1111-111111111111" || len(args["lojas"].([]int64)) != 2 || args["desde"] != "2026-10-01" {
		t.Fatalf("args = %#v", args)
	}
	for _, v := range []url.Values{
		{"cor": {"azul"}}, {"veiculo": {"1"}}, {"veiculo": {"a", "b"}}, {"lojas": {"1,x"}},
		{"desde": {"01/10/2026"}}, {"veiculo": {"'; drop table x"}}, {"lojas": {strings.Repeat("1,", 1000) + "1"}},
	} {
		if _, err := LerFiltros(v, fs, pgx.NamedArgs{}); err == nil {
			t.Errorf("%v aceito", v)
		}
	}
}

// Os valores de LerFiltros entram de verdade numa consulta com o cast declarado.
func TestFiltrosNumaConsultaReal(t *testing.T) {
	p := testebanco.Novo(t)
	ctx := context.Background()
	p.Exec(ctx, `create table u (veiculo_id uuid, loja_id bigint, dia date);
		insert into u values ('aaaaaaaa-1111-1111-1111-111111111111', 1, '2026-10-02'), ('bbbbbbbb-1111-1111-1111-111111111111', 2, '2026-09-01'), (null, 3, '2026-10-05')`)
	fs := []Filtro{
		{Param: "lojas", SQL: "loja_id = any(@lojas::bigint[])", Tipo: "inteiro[]"},
		{Param: "desde", SQL: "dia >= @desde::date", Tipo: "data"},
		{Param: "veiculos", SQL: "veiculo_id = any(@veiculos::uuid[])", Tipo: "uuid[]"},
	}
	v, _ := url.ParseQuery("lojas=1,2,3&desde=2026-10-01&veiculos=aaaaaaaa-1111-1111-1111-111111111111")
	args := pgx.NamedArgs{}
	conds, err := LerFiltros(v, fs, args)
	if err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	Lista(ctx, p, w, `select loja_id from u where `+strings.Join(conds, " and ")+` order by 1`, args)
	if w.Body.String() != `[{"loja_id":1}]` {
		t.Fatalf("= %s", w.Body)
	}
	_ = http.StatusOK
}
