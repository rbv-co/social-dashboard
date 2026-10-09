package banco_test

// Atenção: os testes deste pacote NÃO podem rodar em paralelo entre si (não use t.Parallel()).
// A camada de compatibilidade cria objetos de cluster (papéis) e de banco (schemas auth e
// extensions, extensões) compartilhados por todos os testes do mesmo banco. Tudo é idempotente
// e nada disso é removido na limpeza.

import (
	"context"
	"testing"

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
	tx.Rollback(ctx)

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

	// os três papéis existem e não fazem login
	var q int
	if err := p.QueryRow(ctx, `select count(*) from pg_roles where rolname in ('anon','authenticated','service_role') and not rolcanlogin`).Scan(&q); err != nil || q != 3 {
		t.Fatalf("papéis NOLOGIN = %d (err %v)", q, err)
	}
}
