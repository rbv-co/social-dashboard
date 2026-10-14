package banco_test

// Atenção: os testes deste pacote NÃO podem rodar em paralelo entre si (não use t.Parallel()).
// A camada de compatibilidade cria objetos de cluster (papéis) e de banco (schemas auth e
// extensions, extensões) compartilhados por todos os testes do mesmo banco. Tudo é idempotente
// e nada disso é removido na limpeza.

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

const uidA = "11111111-1111-1111-1111-111111111111"

// umaConexao devolve um pool de UMA conexão só (mesma URL e search_path de p). Os testes de
// vazamento precisam das duas fases na mesma sessão: numa conexão nova o GUC nunca foi
// definido e o teste passaria sem provar nada.
func umaConexao(t *testing.T, p *pgxpool.Pool) *pgxpool.Pool {
	t.Helper()
	cfg := p.Config().Copy()
	cfg.MaxConns = 1
	p1, err := pgxpool.NewWithConfig(context.Background(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(p1.Close)
	return p1
}

func TestCompat(t *testing.T) {
	p := testebanco.Novo(t)
	ctx := context.Background()
	// aplica duas vezes: tem de ser idempotente
	for i := 0; i < 2; i++ {
		if _, err := p.Exec(ctx, banco.Compat); err != nil {
			t.Fatalf("aplicação %d: %v", i+1, err)
		}
	}

	var uid *string
	if err := p.QueryRow(ctx, `select auth.uid()::text`).Scan(&uid); err != nil || uid != nil {
		t.Fatalf("sem app.usuario_id deveria ser null, veio %v (err %v)", uid, err)
	}

	p1 := umaConexao(t, p)
	tx, err := p1.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `select set_config('app.usuario_id', $1, true)`, uidA); err != nil {
		t.Fatal(err)
	}
	var dentro string
	if err := tx.QueryRow(ctx, `select auth.uid()::text`).Scan(&dentro); err != nil || dentro != uidA {
		t.Fatalf("dentro da transação: %q (err %v)", dentro, err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	// set_config(..., true) vale só na transação: não pode vazar. Na MESMA conexão o GUC
	// continua definido como '' (peculiaridade do Postgres): auth.uid() precisa do nullif.
	var guc string
	if err := p1.QueryRow(ctx, `select current_setting('app.usuario_id', true)`).Scan(&guc); err != nil || guc != "" {
		t.Fatalf("GUC após o commit = %q, esperado '' (err %v)", guc, err)
	}
	uid = nil
	if err := p1.QueryRow(ctx, `select auth.uid()::text`).Scan(&uid); err != nil || uid != nil {
		t.Fatalf("vazou para fora da transação: %v (err %v)", uid, err)
	}

	// valor inválido vira null, nunca erro
	tx, err = p.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `select set_config('app.usuario_id', 'isto-nao-e-uuid', true)`); err != nil {
		t.Fatal(err)
	}
	uid = nil
	if err := tx.QueryRow(ctx, `select auth.uid()::text`).Scan(&uid); err != nil || uid != nil {
		t.Fatalf("valor inválido: %v (err %v)", uid, err)
	}

	// extensions.* resolve (as 18 funções de produção que usam pgcrypto/uuid)
	var n int
	if err := p.QueryRow(ctx, `select length(extensions.gen_random_bytes(8))`).Scan(&n); err != nil || n != 8 {
		t.Fatalf("gen_random_bytes: %d (err %v)", n, err)
	}
	var u string
	if err := p.QueryRow(ctx, `select extensions.uuid_generate_v4()::text`).Scan(&u); err != nil || len(u) != 36 {
		t.Fatalf("uuid_generate_v4: %q (err %v)", u, err)
	}

	// auth.role() é conservador: sem configuração, 'authenticated' (nunca 'service_role')
	var papel string
	if err := p.QueryRow(ctx, `select auth.role()`).Scan(&papel); err != nil || papel != "authenticated" {
		t.Fatalf("auth.role() = %q (err %v)", papel, err)
	}

	// 'dono' (só banco.ComAnonimo o põe) é a conexão direta do dono: auth.role() nulo; 'anon' é anon; nada vaza adiante
	var nulo bool
	if err := comAnonimoBool(ctx, p, "dono", "", `select auth.role() is null`, &nulo); err != nil || !nulo {
		t.Fatalf("auth.role() com papel dono: nulo=%t (err %v)", nulo, err)
	}
	if err := p.QueryRow(ctx, `select auth.role()`).Scan(&papel); err != nil || papel != "authenticated" {
		t.Fatalf("depois do ComAnonimo o papel vazou: %q (err %v)", papel, err)
	}

	// os três papéis existem e não fazem login
	var q int
	if err := p.QueryRow(ctx, `select count(*) from pg_roles where rolname in ('anon','authenticated','service_role') and not rolcanlogin`).Scan(&q); err != nil || q != 3 {
		t.Fatalf("papéis NOLOGIN = %d (err %v)", q, err)
	}
}

// Extensão já instalada em outro schema: a camada tem de falhar com mensagem clara, não passar calada.
// Extensões são do banco inteiro, então o teste usa um banco descartável próprio.
func TestCompatFalhaSeExtensaoEstaEmOutroSchema(t *testing.T) {
	_ = testebanco.Novo(t) // só para pular sem TEST_DATABASE_URL
	ctx := context.Background()
	cfg, err := pgx.ParseConfig(os.Getenv("TEST_DATABASE_URL"))
	if err != nil {
		t.Fatal(err)
	}
	admin, err := pgx.ConnectConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	nome := fmt.Sprintf("t_ext_%d", time.Now().UnixNano())
	if _, err := admin.Exec(ctx, "create database "+nome); err != nil {
		admin.Close(ctx)
		t.Fatal(err)
	}
	var c *pgx.Conn
	// um só Cleanup, na ordem certa: fecha a conexão do banco de teste, derruba o banco pela conexão admin
	// (ainda aberta) e só então fecha a admin; se o drop falhar o teste falha (não deixa t_ext_* para trás)
	t.Cleanup(func() {
		if c != nil {
			c.Close(ctx)
		}
		if _, err := admin.Exec(ctx, "drop database if exists "+nome+" with (force)"); err != nil {
			t.Errorf("não consegui apagar o banco de teste %s: %v", nome, err)
		}
		admin.Close(ctx)
	})

	cfg2 := cfg.Copy()
	cfg2.Database = nome
	c, err = pgx.ConnectConfig(ctx, cfg2)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := c.Exec(ctx, `create extension pgcrypto with schema public`); err != nil {
		t.Fatal(err)
	}
	_, err = c.Exec(ctx, banco.Compat)
	if err == nil || !strings.Contains(err.Error(), "pgcrypto") || !strings.Contains(err.Error(), "public") {
		t.Fatalf("esperava erro citando pgcrypto e public, veio %v", err)
	}
}

// comAnonimoBool roda uma consulta de uma coluna booleana dentro de ComAnonimo.
func comAnonimoBool(ctx context.Context, p *pgxpool.Pool, papel, ip, sql string, destino *bool) error {
	return banco.ComAnonimo(ctx, p, papel, ip, func(tx pgx.Tx) error { return tx.QueryRow(ctx, sql).Scan(destino) })
}

// ComAnonimo: papel fora da lista fechada é recusado; o IP chega em request.headers e some no fim da transação; a
// transação não tem usuário (auth.uid() nulo).
func TestComAnonimo(t *testing.T) {
	p := testebanco.Novo(t)
	ctx := context.Background()
	if err := banco.ComAnonimo(ctx, p, "service_role", "1.2.3.4", func(pgx.Tx) error { return nil }); !errors.Is(err, banco.ErrPapelInvalido) {
		t.Errorf("papel fora da lista = %v, esperava ErrPapelInvalido", err)
	}
	var ip, papel string
	var semUsuario bool
	err := banco.ComAnonimo(ctx, p, "anon", "203.0.113.9", func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `select current_setting('request.headers')::json ->> 'x-forwarded-for'`).Scan(&ip); err != nil {
			return err
		}
		if err := tx.QueryRow(ctx, `select auth.role(), auth.uid() is null`).Scan(&papel, &semUsuario); err != nil {
			return err
		}
		return nil
	})
	if err != nil || ip != "203.0.113.9" || papel != "anon" || !semUsuario {
		t.Errorf("ip %q papel %q semUsuario %t err %v", ip, papel, semUsuario, err)
	}
	var depois *string
	if err := p.QueryRow(ctx, `select nullif(current_setting('request.headers', true), '')`).Scan(&depois); err != nil || depois != nil {
		t.Errorf("request.headers vazou para fora da transação: %v (err %v)", depois, err)
	}
	// sem IP: cabeçalhos vazios, a função cai em "sem-ip"
	if err := banco.ComAnonimo(ctx, p, "anon", "", func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `select coalesce(current_setting('request.headers')::json ->> 'x-forwarded-for', 'sem-ip')`).Scan(&ip)
	}); err != nil || ip != "sem-ip" {
		t.Errorf("sem IP = %q (err %v)", ip, err)
	}
}
