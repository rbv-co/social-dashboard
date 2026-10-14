// Package testebanco dá a cada teste um schema novo e migrado num Postgres real.
// Pula sozinho se TEST_DATABASE_URL não existir (use `make teste`).
package testebanco

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"os"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
)

// Tabelas que em produção vêm do dump do Supabase. Aqui só o mínimo que o núcleo lê.
const legado = `
create table profiles (
  id uuid primary key, email text, name text, role text,
  is_superadmin boolean default false, permissions jsonb default '{}'::jsonb,
  disabled boolean default false,
  features text[] default '{banco}', escopo_por_equipe boolean default false,
  avatar_url text, allowed_accounts text[], precisa_trocar_senha boolean not null default false
);
create table robos_execucoes (
  id bigserial primary key, robo text not null, request_id bigint,
  disparado_em timestamptz not null default now(), status_code int, ok boolean,
  resposta text, conferido_em timestamptz
);`

func Novo(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL ausente: rode `make teste` em api/")
	}
	ctx := context.Background()
	admin, err := pgx.Connect(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	b := make([]byte, 6)
	rand.Read(b)
	esquema := "t_" + hex.EncodeToString(b)
	if _, err := admin.Exec(ctx, "create schema "+esquema); err != nil {
		t.Fatal(err)
	}
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = esquema
	banco.Configurar(cfg)
	p, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		p.Close()
		admin.Exec(ctx, "drop schema "+esquema+" cascade")
		admin.Close(ctx)
	})
	if err := banco.Migrar(p); err != nil {
		t.Fatal(err)
	}
	if _, err := p.Exec(ctx, legado); err != nil {
		t.Fatal(err)
	}
	return p
}

// TabelasDoEscopo cria (se faltarem) as tabelas que autz.CarregarEscopo lê, com as colunas que
// ele usa. Para os testes de rotas que passam por autz.ComEscopo sem montar o mundo inteiro.
func TabelasDoEscopo(t *testing.T, p *pgxpool.Pool) {
	t.Helper()
	if _, err := p.Exec(context.Background(), `
alter table profiles add column if not exists allowed_accounts text[];
create table if not exists equipes (id uuid primary key, canal_loja_id bigint);
alter table equipes add column if not exists local_id uuid, add column if not exists deposito_id bigint;
create table if not exists equipes_membros (equipe_id uuid not null, profile_id uuid not null, papel text);
create table if not exists canais_grupos_membros (grupo_id uuid not null, profile_id uuid not null, papel text);
create table if not exists bling_lojas (loja_id bigint primary key, nome text, grupo text, grupo_id uuid);
create table if not exists equipes_permissoes (equipe_id uuid not null, profile_id uuid not null, chave text not null);
create table if not exists acessos_pessoas (id uuid primary key, nome text, profile_id uuid, email_corporativo text);`); err != nil {
		t.Fatal(err)
	}
}
