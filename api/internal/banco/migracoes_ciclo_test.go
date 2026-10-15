package banco_test

import (
	"context"
	"database/sql"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/pressly/goose/v3"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

// estrutura: uma foto textual e ordenada do schema atual (colunas, índices, constraints, funções), sem a
// tabela de controle do goose. Duas fotos iguais = a mesma estrutura.
func estrutura(t *testing.T, p *pgxpool.Pool) string {
	t.Helper()
	linhas, err := p.Query(context.Background(), `
		select 'col ' || table_name || '.' || column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, '')
		  from information_schema.columns where table_schema = current_schema() and table_name <> 'goose_db_version'
		union all select 'idx ' || indexdef from pg_indexes where schemaname = current_schema() and tablename <> 'goose_db_version'
		union all select 'con ' || conrelid::regclass::text || ' ' || conname || ' ' || pg_get_constraintdef(oid)
		  from pg_constraint where connamespace = current_schema()::regnamespace and conrelid::regclass::text <> 'goose_db_version'
		union all select 'fn ' || pg_get_functiondef(oid) from pg_proc where pronamespace = current_schema()::regnamespace
		order by 1`)
	if err != nil {
		t.Fatal(err)
	}
	defer linhas.Close()
	var b strings.Builder
	for linhas.Next() {
		var s string
		if err := linhas.Scan(&s); err != nil {
			t.Fatal(err)
		}
		b.WriteString(s + "\n")
	}
	if err := linhas.Err(); err != nil {
		t.Fatal(err)
	}
	return b.String()
}

func tabelasDoSchema(t *testing.T, p *pgxpool.Pool) string {
	t.Helper()
	var s string
	if err := p.QueryRow(context.Background(), `select coalesce(string_agg(tablename, ',' order by tablename), '') from pg_tables
		where schemaname = current_schema() and tablename <> 'goose_db_version'`).Scan(&s); err != nil {
		t.Fatal(err)
	}
	return s
}

func gooseDe(t *testing.T, p *pgxpool.Pool) *sql.DB {
	t.Helper()
	db, _, err := banco.GooseDoTeste(p)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

// Plano 03-C: cada migração sobe, desce e sobe de novo deixando a MESMA estrutura (sem sobra do Down nem
// falta no Up), e descer tudo deixa só o que não é da API (profiles e robos_execucoes, do dump).
func TestMigracoesSobemDescemESobemDeNovo(t *testing.T) {
	p := testebanco.Novo(t) // já migrada até a última
	db := gooseDe(t, p)
	cheia := estrutura(t, p)
	if !strings.Contains(cheia, "col usuarios.id") {
		t.Fatalf("a foto da estrutura veio sem as tabelas da API:\n%.300s", cheia)
	}

	// de cima para baixo, uma versão por vez, guardando a foto de cada degrau
	versao, err := goose.GetDBVersion(db)
	if err != nil || versao < 9 {
		t.Fatalf("versão = %d (%v), esperava ao menos 9", versao, err)
	}
	fotos := map[int64]string{versao: cheia}
	for v := versao; v >= 1; v-- {
		if err := goose.Down(db, "migracoes"); err != nil {
			t.Fatalf("down da versão %d: %v", v, err)
		}
		if got, _ := goose.GetDBVersion(db); got != v-1 {
			t.Fatalf("depois do down de %d a versão é %d", v, got)
		}
		fotos[v-1] = estrutura(t, p)
	}
	// no zero só ficam as tabelas do dump
	if got := tabelasDoSchema(t, p); got != "profiles,robos_execucoes" {
		t.Fatalf("depois de descer tudo ficaram: %s (esperava só profiles,robos_execucoes)", got)
	}
	// a 00009 troca uma função que é do dump e o Down dela não a desfaz (a de produção volta ao restaurar o
	// dump de novo): é a única que pode sobrar
	var fns string
	p.QueryRow(context.Background(), `select coalesce(string_agg(proname, ',' order by proname), '') from pg_proc
		where pronamespace = current_schema()::regnamespace`).Scan(&fns)
	if fns != "vessel_convite_marcar" {
		t.Fatalf("depois de descer tudo sobraram as funções %q (esperava só vessel_convite_marcar)", fns)
	}
	// de baixo para cima: cada versão sobe, desce e sobe de novo e cai sempre na foto do degrau
	for v := int64(1); v <= versao; v++ {
		for _, passo := range []struct {
			nome string
			quer int64
			f    func() error
		}{
			{"up", v, func() error { return goose.UpByOne(db, "migracoes") }},
			{"down", v - 1, func() error { return goose.Down(db, "migracoes") }},
			{"up de novo", v, func() error { return goose.UpByOne(db, "migracoes") }},
		} {
			if err := passo.f(); err != nil {
				t.Fatalf("versão %d, %s: %v", v, passo.nome, err)
			}
			if got := estrutura(t, p); got != fotos[passo.quer] {
				t.Fatalf("versão %d, %s: a estrutura não é a do degrau %d:\n%s", v, passo.nome, passo.quer, diferenca(fotos[passo.quer], got))
			}
		}
	}
}

// Rodar o up duas vezes (deploy repetido) não muda nada nem falha.
func TestMigrarDuasVezesNaoMudaNada(t *testing.T) {
	p := testebanco.Novo(t)
	antes := estrutura(t, p)
	if err := banco.Migrar(p); err != nil {
		t.Fatal(err)
	}
	if got := estrutura(t, p); got != antes {
		t.Fatalf("o segundo Migrar mudou a estrutura:\n%s", diferenca(antes, got))
	}
}

func diferenca(a, b string) string {
	la, lb := map[string]bool{}, map[string]bool{}
	for _, l := range strings.Split(a, "\n") {
		la[l] = true
	}
	var out []string
	for _, l := range strings.Split(b, "\n") {
		lb[l] = true
		if !la[l] {
			out = append(out, "+ "+l)
		}
	}
	for l := range la {
		if !lb[l] {
			out = append(out, "- "+l)
		}
	}
	if len(out) > 12 {
		out = out[:12]
	}
	return strings.Join(out, "\n")
}
