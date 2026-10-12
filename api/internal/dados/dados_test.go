package dados

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

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
		// 42501 e 22023 também são códigos que o Postgres usa nas próprias mensagens (nome de
		// tabela, valor): só P0001 (raise exception nosso) leva texto até a pessoa.
		{&pgconn.PgError{Code: "42501", Message: "Sem acesso para cadastrar colaborador", Detail: "SEGREDO"}, 403, `{"error":"sem_permissao"}`},
		{&pgconn.PgError{Code: "42501", Message: `permission denied for table SEGREDO`}, 403, `{"error":"sem_permissao"}`},
		{&pgconn.PgError{Code: "42501", Message: `new row violates row-level security policy for table "SEGREDO"`}, 403, `{"error":"sem_permissao"}`},
		{&pgconn.PgError{Code: "22023", Message: `unit "SEGREDO" not recognized for type timestamp with time zone`}, 400, `{"error":"pedido_invalido"}`},
		{&pgconn.PgError{Code: "57014", Message: "canceling statement due to statement timeout"}, 504, `{"error":"prazo_esgotado"}`},
		{context.Canceled, 499, `{"error":"requisicao_cancelada"}`},
		{fmt.Errorf("timeout: %w", context.DeadlineExceeded), 504, `{"error":"prazo_esgotado"}`},
		{&pgconn.PgError{Code: "P0001", Message: "Lote já gravado", Detail: "SEGREDO"}, 400, `{"error":"regra_de_negocio","mensagem":"Lote já gravado"}`},
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
		{`null`, false, 400}, // decodificaria sem erro e deixaria o destino vazio
		{" null\n", false, 400},
		{`[]`, false, 400},
		{`{"nome":"a"}` + strings.Repeat(" ", 1<<20), false, 413}, // lixo que atravessa o teto continua 413
		{`{"nome":"a"}` + "\n", true, 200},
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

// O pool de teste usa banco.Configurar: o servidor de teste pode estar em outro fuso, a data sai +00:00.
func TestPoolDeTesteFalaUTC(t *testing.T) {
	p := testebanco.Novo(t)
	var fuso string
	if err := p.QueryRow(context.Background(), `show timezone`).Scan(&fuso); err != nil || fuso != "UTC" {
		t.Fatalf("timezone = %q (%v), esperava UTC", fuso, err)
	}
	w := httptest.NewRecorder()
	Lista(context.Background(), p, w, `select '2026-10-11 09:00:00-03'::timestamptz as q`, nil)
	if w.Body.String() != `[{"q":"2026-10-11T12:00:00+00:00"}]` {
		t.Fatalf("= %s", w.Body)
	}
}

// Rota que esquece o filtro/limite não devolve mais de 1000 linhas nem monta a tabela toda:
// a linha 1001 (divisão por zero) nunca chega a ser calculada.
func TestListaTemTetoDuro(t *testing.T) {
	p := testebanco.Novo(t)
	w := httptest.NewRecorder()
	Lista(context.Background(), p, w, `select n, 1 / (case when n = 1001 then 0 else 1 end) as x from generate_series(1, 5000) n`, nil)
	var linhas []map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &linhas); err != nil || w.Code != 200 || len(linhas) != LimitePadrao {
		t.Fatalf("%d, %d linhas, %v: %.80s", w.Code, len(linhas), err, w.Body)
	}
}

// Um olha no máximo duas linhas: a linha 3 (divisão por zero) nunca é calculada e o resultado
// é o defeito da rota (500 erro_interno), não um erro da conta da linha 3.
func TestUmNaoMontaATabelaToda(t *testing.T) {
	p := testebanco.Novo(t)
	w := httptest.NewRecorder()
	Um(context.Background(), p, w, `select n, 1 / (case when n = 3 then 0 else 1 end) as x from generate_series(1, 100000) n`, nil)
	if w.Code != 500 || strings.TrimSpace(w.Body.String()) != `{"error":"erro_interno"}` {
		t.Fatalf("= %d %s", w.Code, w.Body)
	}
}

func capturarLog(t *testing.T) *bytes.Buffer {
	t.Helper()
	var buf bytes.Buffer
	antes := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() { slog.SetDefault(antes) })
	return &buf
}

// Cliente que desistiu: sem log de erro (não é defeito nosso); prazo estourado: 504.
func TestContextoCanceladoEExpiradoDeVerdade(t *testing.T) {
	p := testebanco.Novo(t)
	log := capturarLog(t)

	ctx, cancela := context.WithCancel(context.Background())
	cancela()
	w := httptest.NewRecorder()
	Lista(ctx, p, w, `select 1`, nil)
	if w.Code != 499 || strings.TrimSpace(w.Body.String()) != `{"error":"requisicao_cancelada"}` {
		t.Errorf("cancelado = %d %s", w.Code, w.Body)
	}
	if strings.Contains(log.String(), "level=ERROR") {
		t.Errorf("cancelamento do cliente logou erro: %s", log)
	}

	ctx, cancela = context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancela()
	w = httptest.NewRecorder()
	Lista(ctx, p, w, `select pg_sleep(5)`, nil)
	if w.Code != 504 || strings.TrimSpace(w.Body.String()) != `{"error":"prazo_esgotado"}` {
		t.Errorf("expirado = %d %s", w.Code, w.Body)
	}
}

// Erro nativo do Postgres de verdade: nada do valor do pedido chega ao cliente.
func TestErroNativoDoBancoNaoVazaOValor(t *testing.T) {
	p := testebanco.Novo(t)
	w := httptest.NewRecorder()
	Lista(context.Background(), p, w, `select date_trunc('SEGREDO', now())`, nil)
	if w.Code != 400 || strings.TrimSpace(w.Body.String()) != `{"error":"pedido_invalido"}` {
		t.Fatalf("= %d %s", w.Code, w.Body)
	}
	w = httptest.NewRecorder()
	Lista(context.Background(), p, w, `select 'SEGREDO'::uuid`, nil)
	if w.Code != 400 || strings.Contains(w.Body.String(), "SEGREDO") {
		t.Fatalf("= %d %s", w.Code, w.Body)
	}
	// raise exception nosso (P0001) mantém a frase; a classe 22 (divisão por zero) fica genérica
	if _, err := p.Exec(context.Background(), `create function lote() returns int language plpgsql as $$ begin raise exception 'Lote já gravado'; end $$`); err != nil {
		t.Fatal(err)
	}
	w = httptest.NewRecorder()
	Lista(context.Background(), p, w, `select lote()`, nil)
	if w.Code != 400 || strings.TrimSpace(w.Body.String()) != `{"error":"regra_de_negocio","mensagem":"Lote já gravado"}` {
		t.Fatalf("P0001 = %d %s", w.Code, w.Body)
	}
	w = httptest.NewRecorder()
	Lista(context.Background(), p, w, `select 1 / (n - n) from generate_series(1, 1) n`, nil)
	if w.Code != 400 || strings.TrimSpace(w.Body.String()) != `{"error":"pedido_invalido"}` {
		t.Fatalf("22012 = %d %s", w.Code, w.Body)
	}
}

// RAISE escrito por nós (a primeira linha de Where termina em " at RAISE") leva a frase até a
// pessoa nos códigos que as funções do banco de produção usam; erro nativo do Postgres (mesmo
// com o mesmo código, mesmo dentro do plpgsql) e RAISE re-lançado de erro nativo continuam
// genéricos. Roda funções de verdade: a regra depende do Where que o servidor monta.
func TestErroDoBancoDistingueRaiseNossoDeErroNativo(t *testing.T) {
	p := testebanco.Novo(t)
	ctx := context.Background()
	if _, err := p.Exec(ctx, `
		create table unico (x text unique);
		insert into unico values ('SEGREDO-constraint');
		create function f_42501() returns int language plpgsql as $$ begin raise exception 'Sem acesso à lista de colaboradores' using errcode = '42501'; end $$;
		create function f_p0001() returns int language plpgsql as $$ begin raise exception 'Digite o nome antes de criar.'; end $$;
		create function f_22023() returns int language plpgsql as $$ begin raise exception 'o fim vem antes do começo' using errcode = '22023'; end $$;
		create function f_p0002() returns int language plpgsql as $$ begin raise exception 'edicao nao encontrada' using errcode = 'P0002'; end $$;
		create function f_23514() returns trigger language plpgsql as $$ begin raise exception 'periodo longo demais (maximo 190 dias)' using errcode = '23514'; end $$;
		create table com_gatilho (x int);
		create trigger t before insert on com_gatilho for each row execute function f_23514();
		create function f_aninhada() returns int language plpgsql as $$ begin return f_42501(); end $$;
		create function f_nativa_22p02() returns int language plpgsql as $$ begin return 'SEGREDO'::uuid::text::int; end $$;
		create function f_nativa_22012() returns int language plpgsql as $$ declare n int := 0; begin return 1 / n; end $$;
		create function f_nativa_22023() returns int language plpgsql as $$ begin return extract(epoch from date_trunc('SEGREDO', now())); end $$;
		create function f_nativa_42501() returns int language sql as $$ select 1 $$;
		create function f_reraise_23505() returns int language plpgsql as $$ begin insert into unico values ('SEGREDO-constraint'); return 1; exception when unique_violation then raise; end $$;
		create function f_codigo_fora_da_lista() returns int language plpgsql as $$ begin raise exception 'SEGREDO fora da lista' using errcode = '23505'; end $$;
		create function f_sql() returns int language sql as $$ select (1 / (select 0))::int $$;
		do $r$ begin create role sem_poder_dados nologin; exception when duplicate_object then null; end $r$;
		do $r$ begin execute format('grant usage on schema %I to sem_poder_dados', current_schema()); end $r$;
		create table fechada (x int);
		revoke all on fechada from public;`); err != nil {
		t.Fatal(err)
	}
	casos := []struct {
		sql    string
		status int
		corpo  string
	}{
		{`select f_42501()`, 403, `{"error":"sem_permissao","mensagem":"Sem acesso à lista de colaboradores"}`},
		{`select f_aninhada()`, 403, `{"error":"sem_permissao","mensagem":"Sem acesso à lista de colaboradores"}`},
		{`select f_p0001()`, 400, `{"error":"regra_de_negocio","mensagem":"Digite o nome antes de criar."}`},
		{`select f_22023()`, 400, `{"error":"regra_de_negocio","mensagem":"o fim vem antes do começo"}`},
		{`select f_p0002()`, 404, `{"error":"nao_encontrado","mensagem":"edicao nao encontrada"}`},
		// nativos, mesmo dentro do plpgsql: sem texto do banco
		{`select f_nativa_22p02()`, 400, `{"error":"pedido_invalido"}`},
		{`select f_nativa_22012()`, 400, `{"error":"pedido_invalido"}`},
		{`select f_nativa_22023()`, 400, `{"error":"pedido_invalido"}`},
		{`select f_sql()`, 400, `{"error":"pedido_invalido"}`},
		// re-lançado (raise;) de erro nativo: continua o texto fixo do 409
		{`select f_reraise_23505()`, 409, `{"error":"conflito","mensagem":"Já existe um registro com esses dados."}`},
		// código fora da lista, mesmo com RAISE: genérico
		{`select f_codigo_fora_da_lista()`, 409, `{"error":"conflito","mensagem":"Já existe um registro com esses dados."}`},
	}
	for _, c := range casos {
		w := httptest.NewRecorder()
		Lista(ctx, p, w, c.sql, nil)
		if w.Code != c.status || strings.TrimSpace(w.Body.String()) != c.corpo {
			t.Errorf("%s = %d %s, esperava %d %s", c.sql, w.Code, w.Body, c.status, c.corpo)
		}
		if strings.Contains(w.Body.String(), "SEGREDO") {
			t.Errorf("%s vazou: %s", c.sql, w.Body)
		}
	}
	// 23514 vindo de gatilho com RAISE nosso: a frase passa (escrita numa transação)
	_, err := p.Exec(ctx, `insert into com_gatilho values (1)`)
	w := httptest.NewRecorder()
	ErroDoBanco(w, err)
	if w.Code != 400 || strings.TrimSpace(w.Body.String()) != `{"error":"regra_de_negocio","mensagem":"periodo longo demais (maximo 190 dias)"}` {
		t.Errorf("23514 do gatilho = %d %s", w.Code, w.Body)
	}
	// 23514 nativo (CHECK) e 42501 nativo (permissão de tabela): sem texto
	if _, err := p.Exec(ctx, `create table ck (x int check (x > 0))`); err != nil {
		t.Fatal(err)
	}
	_, err = p.Exec(ctx, `insert into ck values (-1)`)
	w = httptest.NewRecorder()
	ErroDoBanco(w, err)
	if w.Code != 400 || strings.Contains(w.Body.String(), "ck") || strings.Contains(w.Body.String(), "mensagem") {
		t.Errorf("23514 nativo = %d %s", w.Code, w.Body)
	}
	tx, err := p.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `set local role sem_poder_dados`); err != nil {
		t.Fatal(err)
	}
	_, err = tx.Exec(ctx, `select * from fechada`)
	w = httptest.NewRecorder()
	ErroDoBanco(w, err)
	if w.Code != 403 || strings.TrimSpace(w.Body.String()) != `{"error":"sem_permissao"}` {
		t.Errorf("42501 nativo = %d %s (err %v)", w.Code, w.Body, err)
	}
}

// Sem Where (erro montado à mão) nada passa; com Where de RAISE só os códigos da lista.
func TestErroDoBancoRaiseSinteticoPorCodigo(t *testing.T) {
	raise := "PL/pgSQL function f() line 3 at RAISE"
	casos := []struct {
		pe     pgconn.PgError
		status int
		corpo  string
	}{
		{pgconn.PgError{Code: "42501", Message: "frase", Where: raise}, 403, `{"error":"sem_permissao","mensagem":"frase"}`},
		{pgconn.PgError{Code: "42501", Message: "frase", Where: raise + "\nSQL statement \"select f()\"\nPL/pgSQL function g() line 1 at RETURN"}, 403, `{"error":"sem_permissao","mensagem":"frase"}`},
		{pgconn.PgError{Code: "42501", Message: "permission denied for table SEGREDO", Where: "SQL function \"f\" during inlining"}, 403, `{"error":"sem_permissao"}`},
		{pgconn.PgError{Code: "42501", Message: "permission denied for table SEGREDO", Where: "PL/pgSQL function f() line 2 at RETURN\nPL/pgSQL function g() line 1 at RAISE"}, 403, `{"error":"sem_permissao"}`},
		{pgconn.PgError{Code: "P0002", Message: "x", Where: raise}, 404, `{"error":"nao_encontrado","mensagem":"x"}`},
		{pgconn.PgError{Code: "23514", Message: "x", Where: raise}, 400, `{"error":"regra_de_negocio","mensagem":"x"}`},
		{pgconn.PgError{Code: "22023", Message: "x", Where: raise}, 400, `{"error":"regra_de_negocio","mensagem":"x"}`},
		{pgconn.PgError{Code: "22023", Message: "SEGREDO", Where: "PL/pgSQL function f() line 2 at SQL statement"}, 400, `{"error":"pedido_invalido"}`},
		{pgconn.PgError{Code: "23505", Message: "SEGREDO", Where: raise}, 409, `{"error":"conflito","mensagem":"Já existe um registro com esses dados."}`},
		{pgconn.PgError{Code: "22P02", Message: "SEGREDO", Where: raise}, 400, `{"error":"pedido_invalido"}`},
		{pgconn.PgError{Code: "XX000", Message: "SEGREDO", Where: raise}, 500, `{"error":"erro_interno"}`},
		{pgconn.PgError{Code: "P0002", Message: "SEGREDO"}, 500, `{"error":"erro_interno"}`},
	}
	for _, c := range casos {
		w := httptest.NewRecorder()
		ErroDoBanco(w, &c.pe)
		if w.Code != c.status || strings.TrimSpace(w.Body.String()) != c.corpo {
			t.Errorf("%s %q: %d %s, esperava %d %s", c.pe.Code, c.pe.Where, w.Code, w.Body, c.status, c.corpo)
		}
	}
}

func TestLerPagina(t *testing.T) {
	for q, quer := range map[string]Pagina{"": {1000, 0}, "limite=10&deslocamento=20": {10, 20}, "limite=1000": {1000, 0}, "deslocamento=2147483647": {1000, 2147483647}} {
		v, _ := url.ParseQuery(q)
		if p, err := LerPagina(v); err != nil || p != quer {
			t.Errorf("%q = %+v %v", q, p, err)
		}
	}
	for _, q := range []string{"limite=0", "limite=1001", "limite=x", "limite=+5", "limite=-1", "limite=1&limite=2", "limite=1&limite=x",
		"deslocamento=-1", "deslocamento=1.5", "deslocamento=+5", "deslocamento=2147483648", "deslocamento=9223372036854775807",
		"deslocamento=99999999999999999999", "deslocamento=1&deslocamento=2"} {
		v, _ := url.ParseQuery(q)
		if _, err := LerPagina(v); err == nil {
			t.Errorf("%q aceito", q)
		}
	}
}

func TestLerOrdemSoComCamposPermitidos(t *testing.T) {
	perm := map[string]string{"quando": "u.criado_em", "placa": "v.placa"}
	// o desempate único vem sempre por último: é ele que faz o deslocamento não repetir nem pular
	for q, quer := range map[string]string{"": "u.criado_em desc, u.id", "ordem=quando": "u.criado_em asc, u.id", "ordem=placa.desc": "v.placa desc, u.id", "ordem=placa.asc": "v.placa asc, u.id"} {
		v, _ := url.ParseQuery(q)
		if got, err := LerOrdem(v, perm, "u.criado_em desc", "u.id"); err != nil || got != quer {
			t.Errorf("%q = %q %v", q, got, err)
		}
	}
	// url.Values direto: ParseQuery descartaria o par com ";" e o teste não testaria nada
	for _, o := range []string{"id", "quando.desc;drop table x", "quando.nullsfirst", "u.criado_em", "quando desc", "quando.", "quando.desc.asc", ".desc", "Quando"} {
		if got, err := LerOrdem(url.Values{"ordem": {o}}, perm, "x", "u.id"); err == nil {
			t.Errorf("%q aceito: %q", o, got)
		}
	}
	if got, err := LerOrdem(url.Values{"ordem": {"quando", "placa"}}, perm, "x", "u.id"); err == nil {
		t.Errorf("ordem repetida aceita: %q", got)
	}
	// declaração sem desempate (ou com texto que não é coluna) é defeito da rota
	for _, d := range []string{"", "u.id; drop", "1", "u.id desc", "id, nome"} {
		if got, err := LerOrdem(url.Values{}, perm, "x", d); !errors.Is(err, ErrDeclaracao) {
			t.Errorf("desempate %q aceito: %q %v", d, got, err)
		}
		if err := ValidarOrdem(perm, "x", d); !errors.Is(err, ErrDeclaracao) {
			t.Errorf("ValidarOrdem aceitou desempate %q", d)
		}
	}
	if err := ValidarOrdem(perm, "", "u.id"); err == nil {
		t.Error("ValidarOrdem aceitou padrão vazio")
	}
	if err := ValidarOrdem(map[string]string{"a": ""}, "x", "u.id"); err == nil {
		t.Error("ValidarOrdem aceitou expressão vazia")
	}
	if err := ValidarOrdem(perm, "x", "u.id"); err != nil {
		t.Error(err)
	}
}

// Chaves de ordem repetidas: com o desempate, as páginas do deslocamento não repetem nem pulam.
func TestOrdemPaginaSemRepetirNemPular(t *testing.T) {
	p := testebanco.Novo(t)
	ctx := context.Background()
	if _, err := p.Exec(ctx, `create table t (id int primary key, g int);
		insert into t select n, (n - 1) / 3 from generate_series(1, 9) n`); err != nil {
		t.Fatal(err)
	}
	ordem, err := LerOrdem(url.Values{"ordem": {"g.desc"}}, map[string]string{"g": "t.g"}, "t.id", "t.id")
	if err != nil {
		t.Fatal(err)
	}
	var vistos []int
	for desl := 0; desl < 9; desl += 2 {
		rows, err := p.Query(ctx, `select id from t order by `+ordem+` limit 2 offset @d::int`, pgx.NamedArgs{"d": desl})
		if err != nil {
			t.Fatal(err)
		}
		for rows.Next() {
			var id int
			rows.Scan(&id)
			vistos = append(vistos, id)
		}
		rows.Close()
	}
	if fmt.Sprint(vistos) != "[7 8 9 4 5 6 1 2 3]" {
		t.Fatalf("páginas = %v", vistos)
	}
}

func TestLerQuery(t *testing.T) {
	// pares malformados que r.URL.Query() descarta em silêncio (o filtro simplesmente sumiria)
	for _, alvo := range []string{"/x?loja=1;x=2", "/x?loja=%zz", "/x?dia=2026-10-02;x", "/x?a=1&b=%"} {
		r := httptest.NewRequest("GET", alvo, nil)
		if _, err := Query(r); err == nil {
			t.Errorf("Query(%q) aceito", alvo)
		}
		w := httptest.NewRecorder()
		if _, ok := LerQuery(w, r); ok || w.Code != 400 || !strings.HasPrefix(w.Body.String(), `{"error":"parametro_invalido"`) {
			t.Errorf("LerQuery(%q) = %v %d %s", alvo, ok, w.Code, w.Body)
		}
	}
	r := httptest.NewRequest("GET", "/x?loja=1&dia=2026-10-02&loja=2", nil)
	if v, err := Query(r); err != nil || len(v["loja"]) != 2 || v.Get("dia") != "2026-10-02" {
		t.Errorf("Query = %v %v", v, err)
	}
	if v, err := Query(httptest.NewRequest("GET", "/x", nil)); err != nil || len(v) != 0 {
		t.Errorf("sem query = %v %v", v, err)
	}
}

func TestFiltroValidar(t *testing.T) {
	for _, f := range []Filtro{
		{Param: "veiculo", SQL: "u.veiculo_id = @veiculo::uuid", Tipo: "uuid"},
		{Param: "veiculo", SQL: "u.veiculo_id = @veiculo::UUID", Tipo: "uuid"},
		{Param: "n", SQL: "u.n = @n::bigint", Tipo: "inteiro"},
		{Param: "n", SQL: "u.n = @n::int8", Tipo: "inteiro"},
		{Param: "n", SQL: "u.n = @n::numeric", Tipo: "inteiro"},
		{Param: "n", SQL: "u.n = any(@n::bigint[])", Tipo: "inteiro[]"},
		{Param: "nome", SQL: "u.nome = @nome::text", Tipo: "texto"},
		{Param: "dia", SQL: "u.dia >= @dia::date and u.dia <= @dia::date", Tipo: "data"},
		{Param: "q", SQL: "u.q >= @q::timestamptz", Tipo: "instante"},
		{Param: "ok", SQL: "u.ok = @ok::boolean", Tipo: "booleano"},
		{Param: "ok", SQL: "u.tags @> @ok::boolean[]", Tipo: "booleano[]"}, // @> não é parâmetro
	} {
		if err := f.Validar(); err != nil {
			t.Errorf("%+v recusado: %v", f, err)
		}
	}
	for _, f := range []Filtro{
		{Param: "veiculo", SQL: "u.veiculo_id = @veiculo", Tipo: "uuid"}, // sem cast
		{Param: "limite", SQL: "x = @limite::int", Tipo: "inteiro"},      // reservado
		{Param: "Veiculo", SQL: "x = @Veiculo::uuid", Tipo: "uuid"},
		{Param: "veiculo", SQL: "x = @veiculo::uuid", Tipo: "numero"},
		// o pgx não codifica int64 em int4/int2: viraria 500 com 2147483648
		{Param: "n", SQL: "u.n = @n::int", Tipo: "inteiro"},
		{Param: "n", SQL: "u.n = @n::int4", Tipo: "inteiro"},
		{Param: "n", SQL: "u.n = @n::integer", Tipo: "inteiro"},
		{Param: "n", SQL: "u.n = @n::smallint", Tipo: "inteiro"},
		{Param: "n", SQL: "u.n = any(@n::int[])", Tipo: "inteiro[]"},
		// cast que não combina com o tipo do valor
		{Param: "veiculo", SQL: "x = @veiculo::text", Tipo: "uuid"},
		{Param: "dia", SQL: "x = @dia::timestamptz", Tipo: "data"},
		{Param: "q", SQL: "x = @q::timestamp", Tipo: "instante"},
		{Param: "n", SQL: "x = any(@n::bigint[])", Tipo: "inteiro"},     // lista num cast escalar
		{Param: "n", SQL: "x = @n::bigint", Tipo: "inteiro[]"},          // escalar num cast de lista
		{Param: "n", SQL: "x = @n::bigint and y = @n", Tipo: "inteiro"}, // uma ocorrência sem cast
		{Param: "n", SQL: "x = @n::bigint and y = @n::int", Tipo: "inteiro"},
		// parâmetro sem filtro declarado
		{Param: "n", SQL: "x = @n::bigint and y = @outro::text", Tipo: "inteiro"},
		{Param: "n", SQL: "x = @n::bigint and y = @n_2::bigint", Tipo: "inteiro"},
	} {
		if f.Validar() == nil {
			t.Errorf("%+v aceito", f)
		}
	}
}

func TestValidarFiltros(t *testing.T) {
	a := Filtro{Param: "a", SQL: "x = @a::uuid", Tipo: "uuid"}
	b := Filtro{Param: "b", SQL: "y = @b::date", Tipo: "data"}
	if err := ValidarFiltros([]Filtro{a, b}, "escopo_1"); err != nil {
		t.Fatal(err)
	}
	if err := ValidarFiltros([]Filtro{a, b, a}); err == nil {
		t.Error("Param repetido aceito")
	}
	if err := ValidarFiltros([]Filtro{a, b}, "b"); err == nil {
		t.Error("colisão com argumento da rota aceita")
	}
	if err := ValidarFiltros([]Filtro{a, {Param: "c", SQL: "z = @c", Tipo: "uuid"}}); err == nil {
		t.Error("filtro inválido aceito")
	}
}

// A condição com `or` sai embrulhada: `(regra) and <cond>` não pode virar `(regra) and a or b`.
func TestLerFiltrosEmbrulhaACondicaoEmParenteses(t *testing.T) {
	fs := []Filtro{{Param: "q", SQL: "c.nome = @q::text or c.dona = @q::text", Tipo: "texto"}}
	conds, err := LerFiltros(url.Values{"q": {"x"}}, fs, pgx.NamedArgs{})
	if err != nil || len(conds) != 1 || conds[0] != "(c.nome = @q::text or c.dona = @q::text)" {
		t.Fatalf("conds = %v err = %v", conds, err)
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
	// SQL determinístico: condições na ordem do nome do parâmetro (o map da query embaralha)
	// e cada condição JÁ SAI entre parênteses (nenhum chamador precisa lembrar: `a or b` solta
	// anularia a regra de leitura que vem antes dela num `and`)
	if conds[0] != "("+fs[2].SQL+")" || conds[1] != "("+fs[1].SQL+")" || conds[2] != "("+fs[0].SQL+")" {
		t.Fatalf("conds fora de ordem ou sem parênteses: %v", conds)
	}
	if args["veiculo"] != "aaaaaaaa-1111-1111-1111-111111111111" || len(args["lojas"].([]int64)) != 2 || args["desde"] != "2026-10-01" {
		t.Fatalf("args = %#v", args)
	}
	for _, v := range []url.Values{
		{"cor": {"azul"}}, {"veiculo": {"1"}}, {"veiculo": {"a", "b"}}, {"lojas": {"1,x"}},
		{"desde": {"01/10/2026"}}, {"veiculo": {"'; drop table x"}}, {"lojas": {strings.Repeat("1,", 1000) + "1"}},
		// reservado repetido: recusado antes de olhar o valor (LerPagina/LerOrdem leriam só o primeiro)
		{"limite": {"1", "2"}}, {"ordem": {"a", "b"}}, {"contar": {"1", "1"}},
		{"lojas": {"9223372036854775808"}}, {"lojas": {"2147483648,x"}},
	} {
		if _, err := LerFiltros(v, fs, pgx.NamedArgs{}); err == nil {
			t.Errorf("%v aceito", v)
		}
	}
	// valor da rota que já está nos argumentos não é sobrescrito pelo pedido
	if _, err := LerFiltros(url.Values{"desde": {"2026-10-01"}}, fs, pgx.NamedArgs{"desde": "outro"}); err == nil {
		t.Error("sobrescreveu argumento da rota")
	}
	// declaração ruim é defeito da rota, não 400 do pedido
	ruim := []Filtro{{Param: "n", SQL: "x = @n::int", Tipo: "inteiro"}}
	for _, n := range []string{"1", "2147483648", "9223372036854775807"} {
		if _, err := LerFiltros(url.Values{"n": {n}}, ruim, pgx.NamedArgs{}); !errors.Is(err, ErrDeclaracao) {
			t.Errorf("n=%s com ::int: %v", n, err)
		}
	}
}

// Cada tipo declarado vira um parâmetro que o Postgres aceita, inclusive nos limites do int64
// e nas listas; nenhum valor do pedido chega a dar 500.
func TestTiposDosFiltrosNumaConsultaReal(t *testing.T) {
	p := testebanco.Novo(t)
	ctx := context.Background()
	fs := []Filtro{
		{Param: "n", SQL: "@n::bigint is not null", Tipo: "inteiro"},
		{Param: "num", SQL: "@num::numeric is not null", Tipo: "inteiro"},
		{Param: "ns", SQL: "@ns::bigint[] is not null", Tipo: "inteiro[]"},
		{Param: "q", SQL: "@q::timestamptz is not null", Tipo: "instante"},
		{Param: "qs", SQL: "@qs::timestamptz[] is not null", Tipo: "instante[]"},
		{Param: "bs", SQL: "@bs::boolean[] is not null", Tipo: "booleano[]"},
		{Param: "b", SQL: "@b::boolean is not null", Tipo: "booleano"},
		{Param: "ds", SQL: "@ds::date[] is not null", Tipo: "data[]"},
		{Param: "t", SQL: "@t::text is not null", Tipo: "texto"},
		{Param: "us", SQL: "@us::uuid[] is not null", Tipo: "uuid[]"},
	}
	if err := ValidarFiltros(fs); err != nil {
		t.Fatal(err)
	}
	ler := func(consulta, query string) (string, string) {
		v, err := url.ParseQuery(query)
		if err != nil {
			t.Fatal(err)
		}
		args := pgx.NamedArgs{}
		conds, err := LerFiltros(v, fs, args)
		if err != nil {
			return "", err.Error()
		}
		w := httptest.NewRecorder()
		Lista(ctx, p, w, strings.ReplaceAll(consulta, "{onde}", strings.Join(append([]string{"true"}, conds...), " and ")), args)
		var c bytes.Buffer // o json_agg separa as linhas com ", \n ": compacta para comparar
		if err := json.Compact(&c, w.Body.Bytes()); err != nil {
			t.Fatalf("%s: %v", w.Body, err)
		}
		return c.String(), ""
	}
	casos := []struct{ consulta, query, quer string }{
		{`select @n::bigint as n where {onde}`, "n=2147483648", `[{"n":2147483648}]`},
		{`select @n::bigint as n where {onde}`, "n=9223372036854775807", `[{"n":9223372036854775807}]`},
		{`select @num::numeric as n where {onde}`, "num=9223372036854775807", `[{"n":9223372036854775807}]`},
		{`select unnest(@ns::bigint[]) as n where {onde}`, "ns=1,9223372036854775807", `[{"n":1},{"n":9223372036854775807}]`},
		{`select @q::timestamptz as q where {onde}`, "q=2026-10-11T09:00:00-03:00", `[{"q":"2026-10-11T12:00:00+00:00"}]`},
		{`select unnest(@qs::timestamptz[]) as q where {onde}`, "qs=2026-10-11T09:00:00-03:00,2026-10-12T00:00:00Z", `[{"q":"2026-10-11T12:00:00+00:00"},{"q":"2026-10-12T00:00:00+00:00"}]`},
		{`select unnest(@bs::boolean[]) as b where {onde}`, "bs=true,false,1", `[{"b":true},{"b":false},{"b":true}]`},
		{`select @b::boolean as b where {onde}`, "b=false", `[{"b":false}]`},
		{`select unnest(@ds::date[]) as d where {onde}`, "ds=2026-10-01,2026-10-02", `[{"d":"2026-10-01"},{"d":"2026-10-02"}]`},
		{`select @t::text as txt where {onde}`, "t=" + strings.Repeat("a", 500), `[{"txt":"` + strings.Repeat("a", 500) + `"}]`},
		{`select unnest(@us::uuid[]) as u where {onde}`, "us=AAAAAAAA-1111-1111-1111-111111111111", `[{"u":"aaaaaaaa-1111-1111-1111-111111111111"}]`},
	}
	for _, c := range casos {
		if got, e := ler(c.consulta, c.query); got != c.quer {
			t.Errorf("%.40s: %s (%s), esperava %s", c.query, got, e, c.quer)
		}
	}
	// recusas: sempre erro de pedido, nunca chega ao banco
	for _, q := range []string{"n=9223372036854775808", "n=1.5", "n=", "q=2026-10-11", "q=2026-10-11T09:00:00", "qs=2026-10-11T09:00:00Z,x",
		"bs=true,talvez", "b=sim", "ds=2026-10-01,01/10/2026", "t=" + strings.Repeat("a", 501), "us=x", "ns=1,,2"} {
		if _, e := ler(`select 1 where {onde}`, q); e == "" {
			t.Errorf("%.40q aceito", q)
		}
	}
}

// Os valores de LerFiltros entram de verdade numa consulta com o cast declarado.
func TestFiltrosNumaConsultaReal(t *testing.T) {
	p := testebanco.Novo(t)
	ctx := context.Background()
	if _, err := p.Exec(ctx, `create table u (veiculo_id uuid, loja_id bigint, dia date);
		insert into u values ('aaaaaaaa-1111-1111-1111-111111111111', 1, '2026-10-02'), ('bbbbbbbb-1111-1111-1111-111111111111', 2, '2026-09-01'), (null, 3, '2026-10-05')`); err != nil {
		t.Fatal(err)
	}
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
}
