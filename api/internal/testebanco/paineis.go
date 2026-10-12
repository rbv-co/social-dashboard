package testebanco

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// TabelasDosPaineis cria as tabelas do sub-plano 5.12 com a DDL das migrations (o D0 não é deste
// plano: Ruling 16 do 5.12) e a visão robos_saude com o texto da migração que está em produção.
// robos_execucoes já vem do legado.
func TabelasDosPaineis(t *testing.T, p *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()
	// db/migrations/007_noticias_concorrentes.sql:7-19 (+ produtos: coluna que só existe em produção;
	// a tela lê row.produtos em tela-de-noticias.vue:328); acessos/017_noticias_panorama.sql:2-8;
	// 025_ia_execucoes.sql:6-23; 2026-07-31-saude-dos-robos.sql:134-141.
	if _, err := p.Exec(ctx, `
create table noticias_concorrentes (
  id uuid primary key default gen_random_uuid(), marca text not null, titulo text not null, resumo text,
  categoria text, url text, fonte text, data_publicacao date, rodada date not null default current_date,
  destaque boolean not null default false, created_at timestamptz not null default now(), produtos jsonb);
create table noticias_panorama (
  rodada date primary key, conteudo_md text not null, modelo text, uso text, created_at timestamptz not null default now());
create table ia_execucoes (
  id uuid primary key default gen_random_uuid(), run_at timestamptz not null default now(), robo text not null,
  acao text not null, modelo text, input_tokens bigint not null default 0, output_tokens bigint not null default 0,
  chamadas int not null default 0, usd numeric(10,4) not null default 0, duracao_ms bigint, itens int, unidade text,
  status text not null default 'ok', detalhe text, github_run_id text, created_at timestamptz not null default now());
create table robos_esperados (
  robo text primary key, horas_sem_sucesso_ate int not null, critico boolean not null default false, porque text);`); err != nil {
		t.Fatal(err)
	}
	// A visão verbatim de 2026-09-22-…:58-124 (= levantamento/11-views.csv, produção), sem o "public."
	// para nascer no schema do teste.
	_, aqui, _, _ := runtime.Caller(0)
	b, err := os.ReadFile(filepath.Join(filepath.Dir(aqui), "../../../db/migrations/2026-09-22-vigia-dos-robos-cada-um-no-seu-teto.sql"))
	if err != nil {
		t.Fatal(err)
	}
	s := string(b)
	i := strings.Index(s, "create or replace view public.robos_saude as")
	j := strings.Index(s[max(i, 0):], "x.robo;")
	if i < 0 || j < 0 {
		t.Fatal("não achei a visão robos_saude na migração de 2026-09-22")
	}
	visao := strings.Replace(s[i:i+j+len("x.robo;")], "public.robos_saude", "robos_saude", 1)
	if _, err := p.Exec(ctx, visao); err != nil {
		t.Fatal(err)
	}
}
