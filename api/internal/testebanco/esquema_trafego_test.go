package testebanco

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
)

const marcaTeste = "b7000000-0000-4000-a000-000000000001"

// alvosDoTrafego: os ON CONFLICT da tela (config de métricas, objetivos), da RPC e do robô sugerir-interesses.
var alvosDoTrafego = []struct{ tabela, chave, linha string }{
	{"gt_config_metricas", "balde", `(balde) values ('engajamento')`},
	{"gt_objetivo_interacao", "alvo_id", `(alvo_id, nivel, interacao) values ('9001', 'campanha', 'curtidas')`},
	{"gt_problemas_meta", "ad_id, codigo", `(ad_id, codigo, account_id) values ('7001', 1, 'A1')`},
	{"interesses_sugeridos", "marca_id, objetivo", `(marca_id, objetivo) values ('` + marcaTeste + `', 'seguidores')`},
}

// As 11 tabelas da fatia: as 10 da linha 5.7 e fabrica_marcas (dona: 5.8; Ruling 5.7-1).
var tabelasDoTrafego = []string{"gt_config_metricas", "gt_budget_analises", "gt_ad_analises", "gt_fila_decisoes",
	"gt_ponderada_config", "gt_ponderada_config_log", "gt_objetivo_interacao", "gt_campanhas_rascunho",
	"gt_problemas_meta", "interesses_sugeridos", "fabrica_marcas"}

// A fatia 5.7 do esquema de produção: gestão de tráfego, com o gatilho do rascunho e gt_registrar_problemas verbatim.
func TestFatiaDoTrafego(t *testing.T) {
	p := ComEsquemaDeProducao(t)
	ctx := context.Background()
	const (
		gestor = "5e000000-0000-4000-a000-0000000000b1"
		viewer = "5e000000-0000-4000-a000-0000000000b2"
	)
	quantos := func(sql string, args ...any) int {
		t.Helper()
		var n int
		if err := p.QueryRow(ctx, sql, args...).Scan(&n); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
		return n
	}
	um := func(sql string) string {
		t.Helper()
		var s string
		if err := p.QueryRow(ctx, sql).Scan(&s); err != nil {
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

	for _, tb := range tabelasDoTrafego {
		if quantos(`select (to_regclass($1::text) is not null)::int`, "public."+tb) != 1 {
			t.Errorf("tabela %s não existe", tb)
		}
	}
	if len(tabelasDoTrafego) != 11 {
		t.Errorf("a fatia tem %d tabelas, esperava 11", len(tabelasDoTrafego))
	}

	if _, err := p.Exec(ctx, `
		insert into usuarios (id, email) values ('`+gestor+`', 'gestor@x.com'), ('`+viewer+`', 'viewer@x.com');
		insert into profiles (id, email, role, features) values ('`+gestor+`', 'gestor@x.com', 'viewer', '{meta.gestor}'),
		  ('`+viewer+`', 'viewer@x.com', 'viewer', '{}');
		insert into fabrica_marcas (id, nome, ad_account, page_id, ig_id, account_id)
		  values ('`+marcaTeste+`', 'Marca', 'act_1', 'p1', 'i1', 'A1')`); err != nil {
		t.Fatal(err)
	}

	// um gatilho só, e ele age
	if g := um(`select coalesce(string_agg(g.tgname, ','), '') from pg_trigger g join pg_class c on c.oid = g.tgrelid
		where not g.tgisinternal and c.relname in ('` + strings.Join(tabelasDoTrafego, "','") + `')`); g != "gt_rascunho_updated_at" {
		t.Errorf("gatilhos nas tabelas da fatia = %q, esperava gt_rascunho_updated_at", g)
	}
	if _, err := p.Exec(ctx, `insert into gt_campanhas_rascunho (account_id, criado_por, updated_at) values ('A0', '`+gestor+`', '2020-01-01')`); err != nil {
		t.Fatal(err)
	}
	if _, err := p.Exec(ctx, `update gt_campanhas_rascunho set nome = 'x' where account_id = 'A0'`); err != nil {
		t.Fatal(err)
	}
	if v := um(`select (updated_at > '2020-01-02')::text from gt_campanhas_rascunho where account_id = 'A0'`); v != "true" {
		t.Error("gt_rascunho_toca_updated_at não rodou: updated_at ficou no valor inserido")
	}

	// criado_por default auth.uid()
	var quem string
	err := banco.ComUsuario(ctx, p, gestor, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `insert into gt_campanhas_rascunho (account_id) values ('A1') returning criado_por::text`).Scan(&quem)
	})
	if err != nil || quem != gestor {
		t.Errorf("criado_por = %q (%v), esperava %s", quem, err, gestor)
	}

	// únicos: a 2ª inserção não duplica
	for _, a := range alvosDoTrafego {
		ins := `insert into ` + a.tabela + ` ` + a.linha + ` on conflict (` + a.chave + `) do nothing`
		for i := 0; i < 2; i++ {
			if _, err := p.Exec(ctx, ins); err != nil {
				t.Fatalf("%s: %v", a.tabela, err)
			}
		}
		if n := quantos(`select count(*)::int from ` + a.tabela); n != 1 {
			t.Errorf("%s tem %d linhas, esperava 1", a.tabela, n)
		}
	}

	// checks (23514) e FKs (23503)
	inexistente := "b7000000-0000-4000-a000-0000000000ff"
	for nome, c := range map[string]struct{ sql, quer string }{
		"gt_fila_decisoes.escopo":          {`insert into gt_fila_decisoes (campaign_id, veredito, decisao, escopo) values ('1', 'v', 'aprovada', 'outro')`, "23514"},
		"gt_fila_decisoes.decisao":         {`insert into gt_fila_decisoes (campaign_id, veredito, decisao) values ('1', 'v', 'talvez')`, "23514"},
		"gt_campanhas_rascunho.status":     {`insert into gt_campanhas_rascunho (account_id, criado_por, status) values ('A0', '` + gestor + `', 'x')`, "23514"},
		"gt_ponderada_config.id":           {`insert into gt_ponderada_config (id) values (2)`, "23514"},
		"gt_objetivo_interacao.interacao":  {`insert into gt_objetivo_interacao (alvo_id, nivel, interacao) values ('9002', 'campanha', 'likes')`, "23514"},
		"gt_objetivo_interacao.nivel":      {`insert into gt_objetivo_interacao (alvo_id, nivel, interacao) values ('9003', 'conta', 'curtidas')`, "23514"},
		"interesses_sugeridos.marca_id":    {`insert into interesses_sugeridos (marca_id, objetivo) values ('` + inexistente + `', 'x')`, "23503"},
		"gt_campanhas_rascunho.criado_por": {`insert into gt_campanhas_rascunho (account_id, criado_por) values ('A0', '` + inexistente + `')`, "23503"},
	} {
		if got := codigo(execErr(ctx, p, c.sql)); got != c.quer {
			t.Errorf("%s: código %s, esperava %s", nome, got, c.quer)
		}
	}
	if _, err := p.Exec(ctx, `delete from fabrica_marcas where id = '`+marcaTeste+`'`); err != nil {
		t.Fatal(err)
	}
	if n := quantos(`select count(*)::int from interesses_sugeridos`); n != 0 {
		t.Errorf("%d interesses_sugeridos sobraram após apagar a marca (on delete cascade)", n)
	}

	// gt_registrar_problemas verbatim e viva
	var def string
	if err := p.QueryRow(ctx, `select pg_get_functiondef('public.gt_registrar_problemas(text,jsonb)'::regprocedure)`).Scan(&def); err != nil {
		t.Fatal(err)
	}
	for _, trecho := range []string{"SECURITY DEFINER", "service_role", "distinct on (ad_id, codigo)"} {
		if !strings.Contains(def, trecho) {
			t.Errorf("gt_registrar_problemas sem %q:\n%s", trecho, def)
		}
	}
	registrar := func(quem string) (int, error) {
		var n int
		err := banco.ComUsuario(ctx, p, quem, func(tx pgx.Tx) error {
			return tx.QueryRow(ctx, `select public.gt_registrar_problemas($1::text, $2::jsonb)`,
				"A1", `[{"ad_id":"8001","codigo":2,"titulo":"t"}]`).Scan(&n)
		})
		return n, err
	}
	if n, err := registrar(gestor); err != nil || n != 1 {
		t.Errorf("gestor registrou %d (%v), esperava 1", n, err)
	}
	if v := um(`select account_id from gt_problemas_meta where ad_id = '8001' and codigo = 2`); v != "A1" {
		t.Errorf("account_id gravado = %q, esperava A1", v)
	}
	_, err = registrar(viewer)
	var pe *pgconn.PgError
	if !errors.As(err, &pe) || pe.Code != "P0001" || pe.Message != "Sem permissao na Gestao de Trafego." {
		t.Errorf("viewer sem módulo: %v, esperava P0001 'Sem permissao na Gestao de Trafego.'", err)
	}
}

func errString(err error) string {
	if err == nil {
		return "nil"
	}
	return err.Error()
}

func execErr(ctx context.Context, p interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
}, sql string) error {
	_, err := p.Exec(ctx, sql)
	return err
}
