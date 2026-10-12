// Package autzteste monta o ORÁCULO do teste de contrato de permissão: um banco novo com as
// 144 tabelas do catálogo, a RLS LIGADA com as 276 policies de produção verbatim, as funções
// que elas chamam (ajudantes.sql, verbatim de produção) e um mundo de pessoas, equipes, grupos,
// lojas, locais e bens. Perguntar ao Postgres "o que esta pessoa vê/grava" com
// `set local role authenticated` é perguntar à própria RLS de produção.
package autzteste

import (
	"context"
	"crypto/rand"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"regexp"
	"slices"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
)

//go:embed ajudantes.sql
var Ajudantes string

// Colunas que as policies leem da linha, com o tipo do oráculo. account_id é text: casa as
// duas formas do catálogo (pode_ver_conta(account_id) e pode_ver_conta((account_id)::text)).
var Colunas = []struct{ Nome, Tipo string }{
	{"account_id", "text"}, {"user_id", "uuid"}, {"criado_por", "uuid"}, {"criada_por", "uuid"},
	{"decidido_por", "uuid"}, {"quem", "uuid"}, {"profile_id", "uuid"}, {"equipe_id", "uuid"},
	{"grupo_id", "uuid"}, {"local_id", "uuid"}, {"pessoa_id", "uuid"}, {"bem_id", "uuid"},
	{"loja_id", "bigint"}, {"canal_loja_id", "bigint"}, {"deposito_id", "bigint"},
	{"papel", "text"}, {"chave", "text"},
}

// Tabelas do MUNDO: as funções das policies leem estas linhas, então o teste não gera linhas
// sintéticas nelas (mudaria quem é membro de quê); as linhas do mundo são as candidatas.
var DoMundo = map[string]bool{"profiles": true, "equipes": true, "equipes_membros": true, "equipes_permissoes": true,
	"canais_grupos_membros": true, "bling_lojas": true, "acessos_pessoas": true, "patrimonio_bens": true}

func id(prefixo string, n int) string { return fmt.Sprintf("%s-0000-4000-a000-%012d", prefixo, n) }

// Identificadores fixos do mundo.
var (
	T1, T2, T3, T4, TX = id("e0000000", 1), id("e0000000", 2), id("e0000000", 3), id("e0000000", 4), id("e0000000", 9)
	G1, G2             = id("c0000000", 1), id("c0000000", 2)
	L1, L2             = id("10c00000", 1), id("10c00000", 2)
	PE1, PE2           = id("9e000000", 1), id("9e000000", 2)
	B1, B2, B3, B4     = id("be000000", 1), id("be000000", 2), id("be000000", 3), id("be000000", 4)
)

// Valores que cada coluna assume nas linhas geradas (nil = NULL). Colunas de dono usam os ids
// das pessoas (ValoresDeDono).
var Valores = map[string][]any{
	"account_id": {"A1", "A2", nil}, "equipe_id": {T1, T2, T3, T4, TX, nil}, "grupo_id": {G1, G2, nil},
	"local_id": {L1, L2, nil}, "pessoa_id": {PE1, PE2, nil}, "bem_id": {B1, B2, B3, B4, nil},
	"loja_id": {int64(1), int64(2), int64(3), int64(4), int64(5), nil}, "canal_loja_id": {int64(1), int64(2), int64(3), int64(4), int64(5), nil},
	"deposito_id": {int64(11), int64(12), int64(13), int64(14), nil},
}

var DeDono = map[string]bool{"user_id": true, "criado_por": true, "criada_por": true, "decidido_por": true, "quem": true, "profile_id": true}

type Persona struct {
	Nome, ID string
	perfil   map[string]any // colunas de profiles; nil = sem perfil
	depois   []string       // SQL do mundo desta pessoa (%s = id)
}

type Mundo struct {
	Pool     *pgxpool.Pool // superusuário: ignora a RLS
	Personas []Persona
}

func (m *Mundo) Pessoa(nome string) Persona {
	for _, p := range m.Personas {
		if p.Nome == nome {
			return p
		}
	}
	panic("persona desconhecida: " + nome)
}

// ComoPessoa roda fn numa transação como `authenticated` com auth.uid() = id, e DESFAZ tudo.
func (m *Mundo) ComoPessoa(ctx context.Context, idPessoa string, fn func(tx pgx.Tx) error) error {
	tx, err := m.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `select set_config('app.usuario_id', $1::text, true)`, idPessoa); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `set local role authenticated`); err != nil {
		return err
	}
	return fn(tx)
}

var reLiterais = map[string]*regexp.Regexp{
	"modulo": regexp.MustCompile(`'([^']+)'::text = ANY \(p\.features\)`),
	"chave":  regexp.MustCompile(`p\.permissions \? '([^']+)'::text`),
}

// personas: as fixas e uma por módulo/chave/ferramenta que o catálogo e as funções citam.
func personas(catalogo []map[string]any) []Persona {
	perfil := func(kv ...any) map[string]any {
		m := map[string]any{"role": "viewer", "permissions": map[string]any{}, "is_superadmin": false, "escopo_por_equipe": false}
		for i := 0; i+1 < len(kv); i += 2 {
			m[kv[i].(string)] = kv[i+1]
		}
		return m
	}
	ps := []Persona{
		{Nome: "sem-perfil"},
		{Nome: "comum", perfil: perfil()},
		{Nome: "admin", perfil: perfil("role", "admin")},
		{Nome: "super-ficha", perfil: perfil("is_superadmin", true)},
		{Nome: "super-email", perfil: perfil("email", autz.SuperAdminsPorEmail[0])},
		{Nome: "desativado", perfil: perfil("role", "admin", "is_superadmin", true, "disabled", true,
			"email", autz.SuperAdminsPorEmail[1], "features", []string{"frota", "acessos", "patrimonio", "autenticidade", "sales"},
			"permissions", map[string]any{"atendimentos": []string{"ver", "editar"}})},
		{Nome: "vendedora", perfil: perfil("escopo_por_equipe", true), depois: []string{
			`insert into equipes_membros (equipe_id, profile_id, papel) values ('` + T1 + `', '%s', 'vendedora')`,
			`insert into acessos_pessoas (id, profile_id) values ('` + PE1 + `', '%s')`}},
		{Nome: "papel-nulo", perfil: perfil("escopo_por_equipe", true), depois: []string{
			`insert into equipes_membros (equipe_id, profile_id, papel) values ('` + T1 + `', '%s', null)`}},
		{Nome: "gestor", perfil: perfil("escopo_por_equipe", true), depois: []string{
			`insert into equipes_membros (equipe_id, profile_id, papel) values ('` + T2 + `', '%s', 'gestor')`}},
		{Nome: "gestor-sem-trava", perfil: perfil(), depois: []string{
			`insert into equipes_membros (equipe_id, profile_id, papel) values ('` + T2 + `', '%s', 'gestor')`}},
		{Nome: "supervisora-time", perfil: perfil("escopo_por_equipe", true), depois: []string{
			`insert into equipes_membros (equipe_id, profile_id, papel) values ('` + T3 + `', '%s', 'supervisora')`}},
		{Nome: "supervisora-grupo", perfil: perfil("escopo_por_equipe", true), depois: []string{
			`insert into canais_grupos_membros (grupo_id, profile_id, papel) values ('` + G1 + `', '%s', 'supervisora')`}},
		{Nome: "membro-grupo", perfil: perfil("escopo_por_equipe", true), depois: []string{
			`insert into canais_grupos_membros (grupo_id, profile_id, papel) values ('` + G2 + `', '%s', 'membro')`}},
		{Nome: "estoque", perfil: perfil("escopo_por_equipe", true), depois: []string{
			`insert into equipes_membros (equipe_id, profile_id, papel) values ('` + T4 + `', '%s', 'vendedora')`,
			`insert into equipes_permissoes (equipe_id, profile_id, chave) values ('` + T4 + `', '%s', 'estoque')`}},
		{Nome: "estoque-sem-membro", perfil: perfil("escopo_por_equipe", true), depois: []string{
			`insert into equipes_permissoes (equipe_id, profile_id, chave) values ('` + T4 + `', '%s', 'estoque')`}},
		{Nome: "sem-time", perfil: perfil("escopo_por_equipe", true)},
		{Nome: "contas-a1", perfil: perfil("allowed_accounts", []string{"A1"})},
		{Nome: "contas-vazio", perfil: perfil("allowed_accounts", []string{})},
		{Nome: "admin-contas-vazio", perfil: perfil("role", "admin", "allowed_accounts", []string{})},
		{Nome: "permissions-lista", perfil: perfil("permissions", []string{"meta.hora", "atendimentos"})},
		{Nome: "permissions-chave-nao-array", perfil: perfil("permissions", map[string]any{"meta.opr": true, "atendimentos": "ver"})},
	}
	modulos := []string{"frota", "acessos", "patrimonio", "autenticidade", "meta.leads", "sales", "frota.aprovar",
		"atendimentos", "atendimentos.pracas", "atendimentos2"}
	var chaves []string
	for _, p := range catalogo {
		texto := fmt.Sprint(p["using"], " ", p["withCheck"])
		for _, m := range reLiterais["modulo"].FindAllStringSubmatch(texto, -1) {
			modulos = append(modulos, m[1])
		}
		for _, m := range reLiterais["chave"].FindAllStringSubmatch(texto, -1) {
			chaves = append(chaves, m[1])
		}
	}
	slices.Sort(modulos)
	slices.Sort(chaves)
	for _, m := range slices.Compact(modulos) {
		ps = append(ps, Persona{Nome: "modulo:" + m, perfil: perfil("features", []string{m})})
	}
	for _, c := range slices.Compact(chaves) {
		ps = append(ps, Persona{Nome: "chave:" + c, perfil: perfil("permissions", map[string]any{c: []string{"ver"}})})
	}
	for _, f := range autz.FerramentasVessel {
		ps = append(ps,
			Persona{Nome: "vessel:" + f + ":ver", perfil: perfil("permissions", map[string]any{f: []string{"ver"}})},
			Persona{Nome: "vessel:" + f + ":editar", perfil: perfil("permissions", map[string]any{f: []string{"ver", "editar"}})},
			Persona{Nome: "vessel:" + f + ":so-editar", perfil: perfil("permissions", map[string]any{f: []string{"editar"}})})
	}
	for i := range ps {
		ps[i].ID = id("00000000", i+1)
	}
	return ps
}

// Novo cria um BANCO novo (as funções de produção fixam search_path = public, então um schema
// por teste não serve) e o apaga no fim. Pula sem TEST_DATABASE_URL, como o testebanco.
func Novo(t *testing.T) *Mundo {
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
	nome := "autz_" + hex.EncodeToString(b)
	if _, err := admin.Exec(ctx, "create database "+nome); err != nil {
		t.Fatal(err)
	}
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.Database = nome
	cfg.MaxConns = 16 // o teste de contrato roda uma pessoa por goroutine
	banco.Configurar(cfg)
	p, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		p.Close()
		admin.Exec(ctx, "drop database "+nome+" with (force)")
		admin.Close(ctx)
	})
	var catalogo []map[string]any
	if err := json.Unmarshal(autz.CatalogoJSON(), &catalogo); err != nil {
		t.Fatal(err)
	}
	m := &Mundo{Pool: p, Personas: personas(catalogo)}
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := p.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%v\n%s", err, sql)
		}
	}
	exec(banco.Compat)
	var ddl strings.Builder
	for _, tab := range autz.Producao.Tabelas() {
		fmt.Fprintf(&ddl, "create table %s (id uuid primary key default gen_random_uuid()", pgx.Identifier{tab}.Sanitize())
		for _, c := range Colunas {
			fmt.Fprintf(&ddl, ", %s %s", c.Nome, c.Tipo)
		}
		if tab == "profiles" {
			ddl.WriteString(", email text, role text not null default 'viewer', disabled boolean, features text[]," +
				" permissions jsonb not null default '{}', allowed_accounts text[], is_superadmin boolean not null default false," +
				" escopo_por_equipe boolean not null default false")
		}
		ddl.WriteString(");\n")
	}
	exec(ddl.String())
	exec(Ajudantes)
	var pol strings.Builder
	for _, tab := range autz.Producao.Tabelas() {
		fmt.Fprintf(&pol, "alter table %s enable row level security;\n", pgx.Identifier{tab}.Sanitize())
	}
	for _, c := range catalogo {
		var papeis []string
		for _, r := range c["papeis"].([]any) {
			if r == "public" {
				papeis = append(papeis, "public")
			} else {
				papeis = append(papeis, pgx.Identifier{r.(string)}.Sanitize())
			}
		}
		fmt.Fprintf(&pol, "create policy %s on %s as %s for %s to %s",
			pgx.Identifier{c["nome"].(string)}.Sanitize(), pgx.Identifier{c["tabela"].(string)}.Sanitize(),
			c["tipo"], c["comando"], strings.Join(papeis, ", "))
		if u, ok := c["using"].(string); ok {
			fmt.Fprintf(&pol, " using (%s)", u)
		}
		if w, ok := c["withCheck"].(string); ok {
			fmt.Fprintf(&pol, " with check (%s)", w)
		}
		pol.WriteString(";\n")
	}
	pol.WriteString(`grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to anon, authenticated, service_role;`)
	exec(pol.String())

	// O mundo: equipes T1..T4 (canal, local, depósito), lojas 1..5 (3 e 5 no grupo G1, 4 no G2),
	// pessoas PE1/PE2, bens B1 (local L1), B2 (L2), B3 (da pessoa PE1), B4 (sem nada).
	exec(`insert into equipes (id, canal_loja_id, local_id, deposito_id) values
	  ($1, 1, $5, 11), ($2, 2, $6, 12), ($3, 3, null, 13), ($4, 4, null, 14)`, T1, T2, T3, T4, L1, L2)
	exec(`insert into bling_lojas (loja_id, grupo_id) values (1, null), (2, null), (3, $1), (4, $2), (5, $1)`, G1, G2)
	exec(`insert into acessos_pessoas (id, profile_id) values ($1, null)`, PE2)
	exec(`insert into patrimonio_bens (id, local_id, pessoa_id) values ($1, $5, null), ($2, $6, null), ($3, null, $7), ($4, null, null)`,
		B1, B2, B3, B4, L1, L2, PE1)
	for _, ps := range m.Personas {
		if ps.perfil != nil {
			ps.perfil["id"] = ps.ID
			if _, ok := ps.perfil["email"]; !ok {
				ps.perfil["email"] = strings.ReplaceAll(ps.Nome, ":", "-") + "@teste"
			}
			j, _ := json.Marshal(ps.perfil)
			exec(`insert into profiles select * from jsonb_populate_record(null::profiles, $1::jsonb)`, string(j))
		}
		for _, sql := range ps.depois {
			exec(strings.ReplaceAll(sql, "%s", ps.ID))
		}
	}
	return m
}
