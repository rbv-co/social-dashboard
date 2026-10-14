package testebanco

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// As 9 tabelas da linha 5.8: 8 desta fatia e fabrica_marcas, declarada na fatia 5.7 (Ruling 5.7-1).
var tabelasDaFabrica = []string{"fabrica_marcas", "fabrica_lojas", "fabrica_campanhas", "fabrica_criativos",
	"fabrica_meta_jobs", "fabrica_jobs", "fabrica_objetivos", "fabrica_publicos", "fabrica_looks"}

// A fatia 5.8 do esquema de produção: Fábrica de anúncios, sem gatilho nem função de produção.
func TestFatiaDaFabrica(t *testing.T) {
	p := ComEsquemaDeProducao(t)
	ctx := context.Background()
	const (
		quem        = "5e000000-0000-4000-a000-0000000000c1"
		inexistente = "5e000000-0000-4000-a000-0000000000ff"
	)
	var n int
	escalar := func(sql string, args ...any) string {
		t.Helper()
		var s string
		if err := p.QueryRow(ctx, sql, args...).Scan(&s); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
		return s
	}
	codigo := func(err error) string {
		var pe *pgconn.PgError
		if errors.As(err, &pe) {
			return pe.Code
		}
		return "sem erro do Postgres: " + errString(err)
	}
	// desfeita roda fn numa transação sempre desfeita.
	desfeita := func(fn func(tx pgx.Tx)) {
		t.Helper()
		tx, err := p.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer tx.Rollback(ctx)
		fn(tx)
	}
	linha := func(tx pgx.Tx, sql string) string {
		t.Helper()
		var s string
		if err := tx.QueryRow(ctx, sql).Scan(&s); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
		return s
	}

	for _, tb := range tabelasDaFabrica {
		if err := p.QueryRow(ctx, `select (to_regclass($1::text) is not null)::int`, "public."+tb).Scan(&n); err != nil || n != 1 {
			t.Errorf("tabela %s não existe (%v)", tb, err)
		}
	}

	// nenhum gatilho em fabrica_*
	if err := p.QueryRow(ctx, `select count(*)::int from pg_trigger g join pg_class c on c.oid = g.tgrelid
		where not g.tgisinternal and c.relname like 'fabrica\_%'`).Scan(&n); err != nil || n != 0 {
		t.Errorf("%d gatilhos em fabrica_* (%v), esperava 0", n, err)
	}

	if _, err := p.Exec(ctx, `insert into usuarios (id, email) values ('`+quem+`', 'fabricante@x.com')`); err != nil {
		t.Fatal(err)
	}

	// defaults
	desfeita(func(tx pgx.Tx) {
		if g := linha(tx, `insert into fabrica_campanhas (nome) values ('x') returning concat_ws('|', status, objetivo, desconto_tipo, parcelas)`); g != "gerando|engajamento|fixo|10" {
			t.Errorf("defaults de fabrica_campanhas = %q", g)
		}
		if g := linha(tx, `insert into fabrica_jobs (tipo) values ('gerar') returning concat_ws('|', status, params::text)`); g != "enfileirado|{}" {
			t.Errorf("defaults de fabrica_jobs = %q", g)
		}
		if g := linha(tx, `insert into fabrica_looks (chave, nome, arquetipo) values ('k', 'n', 'a') returning concat_ws('|', excluido::text, tipo)`); g != "false|codigo" {
			t.Errorf("defaults de fabrica_looks = %q", g)
		}
		if g := linha(tx, `insert into fabrica_publicos (nome) values ('p') returning concat_ws('|', idade_min, idade_max, generos::text)`); g != "18|65|{}" {
			t.Errorf("defaults de fabrica_publicos = %q", g)
		}
	})

	// FKs
	desfeita(func(tx pgx.Tx) {
		c := linha(tx, `insert into fabrica_campanhas (nome) values ('c') returning id::text`)
		if _, err := tx.Exec(ctx, `insert into fabrica_criativos (campanha_id, arquetipo, template, formato) values ($1::uuid, 'a', 't', 'f')`, c); err != nil {
			t.Fatal(err)
		}
		if _, err := tx.Exec(ctx, `delete from fabrica_campanhas where id = $1::uuid`, c); err != nil {
			t.Fatal(err)
		}
		if err := tx.QueryRow(ctx, `select count(*)::int from fabrica_criativos where campanha_id = $1::uuid`, c).Scan(&n); err != nil || n != 0 {
			t.Errorf("%d criativos sobraram após apagar a campanha (on delete cascade) (%v)", n, err)
		}
	})
	desfeita(func(tx pgx.Tx) {
		m := linha(tx, `insert into fabrica_marcas (nome, ad_account, page_id, ig_id, account_id) values ('m', 'act_1', 'p', 'i', 'A1') returning id::text`)
		pub := linha(tx, `insert into fabrica_publicos (nome, marca_id) values ('p', '`+m+`') returning id::text`)
		if _, err := tx.Exec(ctx, `delete from fabrica_marcas where id = $1::uuid`, m); err != nil {
			t.Fatal(err)
		}
		if g := linha(tx, `select coalesce(marca_id::text, 'nulo') from fabrica_publicos where id = '`+pub+`'`); g != "nulo" {
			t.Errorf("marca_id do público = %q após apagar a marca, esperava nulo (on delete set null)", g)
		}
	})
	for nome, c := range map[string]struct{ sql, quer string }{
		"fabrica_jobs.criado_por":      {`insert into fabrica_jobs (tipo, criado_por) values ('gerar', '` + inexistente + `')`, "23503"},
		"fabrica_campanhas.criado_por": {`insert into fabrica_campanhas (nome, criado_por) values ('x', '` + inexistente + `')`, "23503"},
		"fabrica_lojas.marca_id":       {`insert into fabrica_lojas (deposito_id, nome, marca_id) values ('D1', 'L', '` + inexistente + `')`, "23503"},
	} {
		desfeita(func(tx pgx.Tx) {
			_, err := tx.Exec(ctx, c.sql)
			if got := codigo(err); got != c.quer {
				t.Errorf("%s: código %s, esperava %s", nome, got, c.quer)
			}
		})
	}
	// com a pessoa que existe, a FK passa
	desfeita(func(tx pgx.Tx) {
		if _, err := tx.Exec(ctx, `insert into fabrica_jobs (tipo, criado_por) values ('gerar', '`+quem+`')`); err != nil {
			t.Errorf("criado_por existente: %v", err)
		}
	})

	// tipos que as rotas presumem
	for col, quer := range map[string]string{
		"fabrica_lojas.deposito_id":   "text",
		"fabrica_lojas.canal_loja_id": "text",
		"fabrica_lojas.geo_cities":    "jsonb",
		"fabrica_criativos.preco_de":  "numeric",
		"fabrica_publicos.generos":    "integer[]",
		"fabrica_looks.objetivos":     "text[]",
		"fabrica_meta_jobs.payload":   "jsonb",
	} {
		tb, at, _ := strings.Cut(col, ".")
		if got := escalar(`select format_type(atttypid, atttypmod) from pg_attribute where attrelid = ($1::text)::regclass and attname = $2::text`, tb, at); got != quer {
			t.Errorf("%s é %s, esperava %s", col, got, quer)
		}
	}
}
