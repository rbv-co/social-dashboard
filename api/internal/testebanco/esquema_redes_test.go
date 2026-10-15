package testebanco

import (
	"context"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
)

const (
	a1 = "a1000000-0000-4000-a000-000000000001"
	a2 = "a1000000-0000-4000-a000-000000000002"
)

// alvos: os ON CONFLICT do worker (coleta.go, coleta_anuncios.go, hora.go) e das telas (Task 7).
var alvos = []struct{ tabela, chave, linha string }{
	{"daily_snapshots", "account_id, captured_at", `(account_id, captured_at) values ('` + a1 + `', '2026-10-11')`},
	{"engagement_snapshots", "account_id, captured_at, period_days", `(account_id, captured_at, period_days) values ('` + a1 + `', '2026-10-11', 7)`},
	{"content_snapshots", "account_id, captured_at, period_days", `(account_id, captured_at, period_days) values ('` + a1 + `', '2026-10-11', 7)`},
	{"campaigns", "campaign_id", `(campaign_id, account_id) values ('9', '` + a1 + `')`},
	{"campaign_adsets", "adset_id", `(adset_id, campaign_id, account_id) values ('8', '9', '` + a1 + `')`},
	{"ads", "ad_id", `(ad_id, campaign_id, account_id) values ('7', '9', '` + a1 + `')`},
	{"campaign_insights", "campaign_id, account_id, captured_at, period_days", `(campaign_id, account_id, captured_at, period_days) values ('9', '` + a1 + `', '2026-10-11', 0)`},
	{"account_insights", "account_id, captured_at, period_days", `(account_id, captured_at, period_days) values ('` + a1 + `', '2026-10-11', 7)`},
	{"campaign_insights_hora", "campaign_id, account_id, dia, hora", `(campaign_id, account_id, dia, hora) values ('9', '` + a1 + `', '2026-10-11', 9)`},
	{"perfil_visitas_hora", "account_id, dia, hora", `(account_id, dia, hora) values ('` + a1 + `', '2026-10-11', 9)`},
	{"ad_insights_hora", "ad_id, account_id, dia, hora", `(ad_id, campaign_id, account_id, dia, hora) values ('7', '9', '` + a1 + `', '2026-10-11', 9)`},
	{"social_metas", "account_id, periodo, indicador", `(account_id, periodo, indicador, valor) values ('` + a1 + `', '1', 'seguidores', 1)`},
	{"campaign_filters", "account_id", `(account_id) values ('` + a1 + `')`},
}

// As 16 tabelas da fatia; ads_snapshots fica de fora (Ruling 5.6-9).
var tabelasDaFatia = []string{"accounts", "daily_snapshots", "followers_leituras", "engagement_snapshots",
	"content_snapshots", "campaigns", "campaign_adsets", "ads", "campaign_insights", "account_insights",
	"campaign_insights_hora", "perfil_visitas_hora", "ad_insights_hora", "visitas_perfil_dia",
	"social_metas", "campaign_filters"}

// A fatia 5.6 do esquema de produção: contas e métricas da Meta, sem gatilhos, com pode_ver_conta verbatim.
func TestFatiaDasRedes(t *testing.T) {
	p := ComEsquemaDeProducao(t)
	ctx := context.Background()
	quantos := func(sql string, args ...any) int {
		t.Helper()
		var n int
		if err := p.QueryRow(ctx, sql, args...).Scan(&n); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
		return n
	}

	// as 16 existem, ads_snapshots não
	for _, tb := range tabelasDaFatia {
		if quantos(`select (to_regclass($1::text) is not null)::int`, "public."+tb) != 1 {
			t.Errorf("tabela %s não existe", tb)
		}
	}
	if len(tabelasDaFatia) != 16 {
		t.Errorf("a fatia tem %d tabelas, esperava 16", len(tabelasDaFatia))
	}
	if quantos(`select (to_regclass('public.ads_snapshots'::text) is not null)::int`) != 0 {
		t.Error("ads_snapshots não deveria existir (Ruling 5.6-9)")
	}

	// nenhum gatilho em produção nestas tabelas
	if n := quantos(`select count(*)::int from pg_trigger g join pg_class c on c.oid = g.tgrelid
		where not g.tgisinternal and c.relname = any($1::text[])`, tabelasDaFatia); n != 0 {
		t.Errorf("%d gatilhos nas tabelas da fatia, esperava 0", n)
	}

	if _, err := p.Exec(ctx, `insert into accounts (id, name, username, instagram_id) values ('`+a1+`', 'A1', 'a1', '1'), ('`+a2+`', 'A2', 'a2', '2')`); err != nil {
		t.Fatal(err)
	}

	// cada alvo de ON CONFLICT existe: a 1ª grava, a 2ª não duplica e não dá erro
	for _, a := range alvos {
		ins := `insert into ` + a.tabela + ` ` + a.linha + ` on conflict (` + a.chave + `) do nothing`
		if tag, err := p.Exec(ctx, ins); err != nil || tag.RowsAffected() != 1 {
			t.Errorf("%s: 1ª inserção: %v (linhas %d)", a.tabela, err, tag.RowsAffected())
			continue
		}
		if tag, err := p.Exec(ctx, ins); err != nil || tag.RowsAffected() != 0 {
			t.Errorf("%s: 2ª inserção duplicou ou falhou: %v (linhas %d)", a.tabela, err, tag.RowsAffected())
		}
		if n := quantos(`select count(*)::int from ` + a.tabela); n != 1 {
			t.Errorf("%s tem %d linhas, esperava 1", a.tabela, n)
		}
	}

	// FKs: apagar a conta leva junto as linhas dela (e só dela)
	if _, err := p.Exec(ctx, `
		insert into followers_leituras (account_id, followers_count) values ('`+a1+`', 10), ('`+a2+`', 20);
		insert into visitas_perfil_dia (account_id, dia, visitas) values ('`+a1+`', '2026-10-11', 3), ('`+a2+`', '2026-10-11', 4)`); err != nil {
		t.Fatal(err)
	}
	// em produção account_insights e data_integrity_checks referenciam a conta SEM cascade: a linha tem de sair antes
	if _, err := p.Exec(ctx, `delete from account_insights where account_id = '`+a1+`'; delete from data_integrity_checks where account_id = '`+a1+`'`); err != nil {
		t.Fatal(err)
	}
	if _, err := p.Exec(ctx, `delete from accounts where id = '`+a1+`'`); err != nil {
		t.Fatal(err)
	}
	for _, tb := range []string{"followers_leituras", "campaign_adsets", "visitas_perfil_dia"} {
		if n := quantos(`select count(*)::int from ` + tb + ` where account_id = '` + a1 + `'`); n != 0 {
			t.Errorf("%s: %d linhas de A1 sobraram após apagar a conta", tb, n)
		}
	}
	for _, tb := range []string{"followers_leituras", "visitas_perfil_dia"} {
		if n := quantos(`select count(*)::int from ` + tb + ` where account_id = '` + a2 + `'`); n != 1 {
			t.Errorf("%s: a linha de A2 sumiu (%d)", tb, n)
		}
	}

	// pode_ver_conta carregada verbatim e com a regra viva
	var def string
	if err := p.QueryRow(ctx, `select pg_get_functiondef('public.pode_ver_conta(text)'::regprocedure)`).Scan(&def); err != nil {
		t.Fatal(err)
	}
	for _, trecho := range []string{"p_conta is null", "SECURITY DEFINER"} {
		if !strings.Contains(def, trecho) {
			t.Errorf("pode_ver_conta sem %q:\n%s", trecho, def)
		}
	}
	const vazia = "5e000000-0000-4000-a000-0000000000a1"
	if _, err := p.Exec(ctx, `
		insert into usuarios (id, email) values ('`+vazia+`', 'vazia@x.com');
		insert into profiles (id, email, role, allowed_accounts) values ('`+vazia+`', 'vazia@x.com', 'viewer', '{}')`); err != nil {
		t.Fatal(err)
	}
	pode := func(conta any) bool {
		var ok bool
		err := banco.ComUsuario(ctx, p, vazia, func(tx pgx.Tx) error {
			return tx.QueryRow(ctx, `select public.pode_ver_conta($1::text)`, conta).Scan(&ok)
		})
		if err != nil {
			t.Fatal(err)
		}
		return ok
	}
	if !pode(nil) {
		t.Error("pode_ver_conta(null) deveria ser true para lista vazia")
	}
	if pode(a1) {
		t.Error("pode_ver_conta(A1) deveria ser false para lista vazia")
	}
}
