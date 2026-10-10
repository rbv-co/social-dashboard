package meta

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/core"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

// Tabelas de hora como nas migrations 2026-09-11/12/18 (campaign_insights_hora, perfil_visitas_hora,
// ad_insights_hora, ads); campaigns e campaign_insights são anteriores às migrations (colunas usadas).
const tabelasAnuncios = `
create table campaigns (campaign_id text primary key, account_id uuid, name text, objective text, status text, synced_at date);
create table ads (ad_id text primary key, campaign_id text not null, account_id uuid not null, name text not null default '',
  status text not null default '', destino_link text, synced_at date not null default current_date);
create table campaign_adsets (adset_id text primary key, campaign_id text not null, account_id uuid not null, destination_type text,
  optimization_goal text, synced_at date not null default current_date);
create table campaign_insights (campaign_id text not null, account_id uuid not null, captured_at date not null, period_days int not null,
  spend numeric, impressions bigint, clicks bigint, reach bigint, post_engagement int, likes int, comments int, shares int, saves int,
  conversas int, cadastros int, compras int, visitas int, unique (campaign_id, account_id, captured_at, period_days));
create table campaign_insights_hora (campaign_id text not null, account_id uuid not null, dia date not null,
  hora smallint not null check (hora between 0 and 23), gasto_acumulado numeric(12,2) not null default 0,
  conversas_acumuladas integer not null default 0, gasto_hora numeric(12,2) not null default 0, conversas_hora integer not null default 0,
  coletado_em timestamptz not null default now(), cliques_acumulados integer not null default 0, cliques_hora integer not null default 0,
  unique (campaign_id, account_id, dia, hora));
create table perfil_visitas_hora (account_id uuid not null, dia date not null, hora smallint not null check (hora between 0 and 23),
  visitas_acumuladas integer not null default 0, visitas_hora integer not null default 0, coletado_em timestamptz not null default now(),
  unique (account_id, dia, hora));
create table ad_insights_hora (ad_id text not null, campaign_id text not null, account_id uuid not null, dia date not null,
  hora smallint not null check (hora between 0 and 23), gasto_acumulado numeric not null default 0, gasto_hora numeric not null default 0,
  cliques_acumulados integer not null default 0, cliques_hora integer not null default 0, coletado_em timestamptz not null default now(),
  unique (ad_id, account_id, dia, hora));`

func graphDaHora(gasto string) func(core.PedidoMeta) (int, string, map[string]string) {
	return func(p core.PedidoMeta) (int, string, map[string]string) {
		m := func(k string) string { s, _ := p.Parametros[k].(string); return s }
		switch {
		case p.Caminho == "/act_999/insights" && m("level") == "campaign":
			if gasto == "" {
				return 200, `{"data":[]}`, nil // 00:05: a Meta ainda não processou o dia
			}
			return 200, `{"data":[{"campaign_id":"c-wpp","spend":"` + gasto + `","actions":[{"action_type":"onsite_conversion.messaging_conversation_started_7d","value":"7"},{"action_type":"link_click","value":"30"}]}]}`, nil
		case p.Caminho == "/act_999/insights" && m("level") == "ad":
			return 200, `{"data":[{"ad_id":"ad-outro","campaign_id":"c-axiom","spend":"4.5","actions":[{"action_type":"link_click","value":"9"}]},
				{"ad_id":"ad-wpp","campaign_id":"c-wpp","spend":"9","actions":[]}]}`, nil
		case p.Caminho == "/1784" && m("fields") == "followers_count":
			return 200, `{"followers_count":24350}`, nil
		case p.Caminho == "/1784/insights" && m("metric") == "profile_views":
			return 200, `{"data":[{"name":"profile_views","total_value":{"value":40}}]}`, nil
		}
		return 404, `{"erro":"rota de teste desconhecida"}`, nil
	}
}

func ambienteHora(t *testing.T, gasto string, agora time.Time) (*ColetaHora, *pgxpool.Pool) {
	t.Helper()
	p := testebanco.Novo(t)
	ctx := context.Background()
	if _, err := p.Exec(ctx, tabelasColeta+tabelasAnuncios); err != nil {
		t.Fatal(err)
	}
	for _, sql := range []string{
		`update accounts set ad_account_id = '999' where id = '` + contaA1 + `'`,
		`insert into campaigns values ('c-wpp', '` + contaA1 + `', '[CAMPANHA WPP] Leads', '', '', null), ('c-axiom', '` + contaA1 + `', 'AXIOM bolsas', '', '', null)`,
		`insert into ads (ad_id, campaign_id, account_id, destino_link) values ('ad-outro', 'c-axiom', '` + contaA1 + `', 'https://loja/x'),
			('ad-wpp', 'c-wpp', '` + contaA1 + `', 'https://loja/y')`,
	} {
		if _, err := p.Exec(ctx, sql); err != nil {
			t.Fatal(err)
		}
	}
	cli, _ := coreDeTeste(t, graphDaHora(gasto))
	return &ColetaHora{Pool: p, Core: cli, Agora: func() time.Time { return agora }}, p
}

func TestMetaHoraDeltaContraAHoraAnterior(t *testing.T) {
	ch, p := ambienteHora(t, "25.5", time.Date(2026, 10, 10, 14, 5, 0, 0, time.UTC)) // 11:05 em SP
	ctx := context.Background()
	p.Exec(ctx, `insert into campaign_insights_hora (campaign_id, account_id, dia, hora, gasto_acumulado, conversas_acumuladas, cliques_acumulados)
		values ('c-wpp', '`+contaA1+`', '2026-10-10', 10, 20, 5, 40), ('c-wpp', '`+contaA1+`', '2026-10-10', 9, 10, 2, 10)`)
	p.Exec(ctx, `insert into perfil_visitas_hora (account_id, dia, hora, visitas_acumuladas) values ('`+contaA1+`', '2026-10-10', 10, 31)`)
	if err := ch.Rodar(ctx); err != nil {
		t.Fatal(err)
	}
	var gastoHora float64
	var conversasHora, cliquesHora, hora int
	p.QueryRow(ctx, `select gasto_hora::float8, conversas_hora, cliques_hora, hora from campaign_insights_hora where hora = 11`).Scan(&gastoHora, &conversasHora, &cliquesHora, &hora)
	if gastoHora != 5.5 || conversasHora != 2 || cliquesHora != 0 || hora != 11 {
		t.Fatalf("delta contra a hora 10 (nunca negativo): gasto=%v conversas=%d cliques=%d hora=%d", gastoHora, conversasHora, cliquesHora, hora)
	}
	var visitas, leituras int
	p.QueryRow(ctx, `select visitas_hora from perfil_visitas_hora where hora = 11`).Scan(&visitas)
	p.QueryRow(ctx, `select count(*) from followers_leituras where origem = 'hora'`).Scan(&leituras)
	if visitas != 9 || leituras != 1 {
		t.Fatalf("visitas_hora=%d leituras=%d", visitas, leituras)
	}
	var anuncios string
	p.QueryRow(ctx, `select string_agg(ad_id || '=' || cliques_hora, ',') from ad_insights_hora`).Scan(&anuncios)
	if anuncios != "ad-outro=9" {
		t.Fatalf("só anúncios de campanha 'outro': %q", anuncios)
	}
	// Segunda rodada NA MESMA hora: atualiza a mesma linha (não duplica nem se compara consigo mesma).
	if err := ch.Rodar(ctx); err != nil {
		t.Fatal(err)
	}
	var n int
	p.QueryRow(ctx, `select count(*) from campaign_insights_hora where hora = 11`).Scan(&n)
	p.QueryRow(ctx, `select conversas_hora from campaign_insights_hora where hora = 11`).Scan(&conversasHora)
	if n != 1 || conversasHora != 2 {
		t.Fatalf("repetida: linhas=%d conversas_hora=%d", n, conversasHora)
	}
}

func TestMetaHoraNaViradaDoDiaEmSaoPaulo(t *testing.T) {
	// 03:05 UTC = 00:05 em São Paulo: o dia é o NOVO (10/10) e a hora é 0, não a 3 do UTC.
	ch, p := ambienteHora(t, "", time.Date(2026, 10, 10, 3, 5, 0, 0, time.UTC))
	err := ch.Rodar(context.Background())
	if err == nil || !strings.Contains(err.Error(), "nada coletado (dia 2026-10-10, hora 0)") {
		t.Fatalf("00:05 sem gasto ainda = erro visível (a repescagem das 00:30 cobre): %v", err)
	}
	ch.Agora = func() time.Time { return time.Date(2026, 10, 10, 3, 30, 0, 0, time.UTC) }
	ch.Core, _ = coreDeTeste(t, graphDaHora("3"))
	if err := ch.Rodar(context.Background()); err != nil {
		t.Fatal(err)
	}
	var dia string
	var hora int
	p.QueryRow(context.Background(), `select dia::text, hora from campaign_insights_hora`).Scan(&dia, &hora)
	if dia != "2026-10-10" || hora != 0 {
		t.Fatalf("repescagem gravou dia=%s hora=%d", dia, hora)
	}
	ts := ch.Tarefas()
	if ts[0].Nome != "meta-hora" || ts[0].Agenda != "5 * * * *" || ts[1].Nome != "meta-hora-retentativa-00h" || ts[1].Agenda != "30 3 * * *" ||
		ts[0].Trava != ts[1].Trava || ts[0].Trava == "" {
		t.Fatalf("%+v", ts)
	}
}

func TestTipoDaCampanha(t *testing.T) {
	for nome, quer := range map[string]string{
		"[CAMPANHA WPP] x": "wpp", "[+ SEGUIDORES] y": "seguidores", "[+ ENGAJAMENTO] z": "engajamento",
		"[ENGAJAMENTO] POST 10": "engajamento", "[Engajamento] vaga": "outro", "AXIOM": "outro",
	} {
		if got := tipoDaCampanha(nome); got != quer {
			t.Errorf("%q = %q", nome, got)
		}
	}
}

func TestColetaDiariaAnuncios(t *testing.T) {
	c, f, p, _ := ambienteColeta(t)
	ctx := context.Background()
	if _, err := p.Exec(ctx, tabelasAnuncios); err != nil {
		t.Fatal(err)
	}
	p.Exec(ctx, `update accounts set ad_account_id = '999' where id = '`+contaA1+`'`)
	resp := f.resp
	f.resp = func(pd core.PedidoMeta) (int, string, map[string]string) {
		m := func(k string) string { s, _ := pd.Parametros[k].(string); return s }
		switch pd.Caminho {
		case "/act_999/campaigns":
			return 200, `{"data":[{"id":"c1","name":"[CAMPANHA WPP] Leads","objective":"OUTCOME_LEADS","status":"ACTIVE"}]}`, nil
		case "/act_999/ads":
			return 200, `{"data":[{"id":"a1","name":"Anúncio","campaign_id":"c1","status":"ACTIVE","creative":{"asset_feed_spec":{"link_urls":[{"website_url":"https://x"},{"website_url":"https://y"}]}}},
				{"id":"a2","campaign_id":"c1","creative":{"object_story_spec":{"video_data":{"call_to_action":{"value":{"link":"https://v"}}}}}}]}`, nil
		case "/act_999/adsets":
			return 500, `{"error":{"message":"conjuntos fora"}}`, nil
		case "/act_999/insights":
			if m("time_range") == `{"since":"2026-10-03","until":"2026-10-09"}` { // 7d: últimos 7 dias COMPLETOS
				return 200, `{"data":[{"campaign_id":"c1","spend":"70.25","impressions":"1000","clicks":"12.9","reach":"800",
					"actions":[{"action_type":"post_reaction","value":"9"},{"action_type":"onsite_conversion.total_messaging_connection","value":"4"},
					{"action_type":"onsite_conversion.messaging_conversation_started_7d","value":"6"},{"action_type":"landing_page_view","value":"3"}]}]}`, nil
			}
			return 200, `{"data":[]}`, nil
		}
		return resp(pd)
	}
	if err := c.Rodada(ctx, "07h"); err != nil {
		t.Fatal(err)
	}
	var links string
	p.QueryRow(ctx, `select string_agg(ad_id || '=' || coalesce(destino_link, 'nulo'), ',' order by ad_id) from ads`).Scan(&links)
	if links != "a1=https://x | https://y,a2=https://v" {
		t.Fatalf("destino_link: %q", links)
	}
	var spend float64
	var clicks, likes, conversas, visitas int
	p.QueryRow(ctx, `select spend::float8, clicks, likes, conversas, visitas from campaign_insights where period_days = 7`).Scan(&spend, &clicks, &likes, &conversas, &visitas)
	if spend != 70.25 || clicks != 12 || likes != 9 || conversas != 4 || visitas != 3 {
		t.Fatalf("7d: spend=%v clicks=%d likes=%d conversas=%d (a 1ª forma, sem somar) visitas=%d", spend, clicks, likes, conversas, visitas)
	}
	var nCampanha int
	p.QueryRow(ctx, `select count(*) from campaigns where campaign_id = 'c1' and synced_at = '2026-10-10'`).Scan(&nCampanha)
	if nCampanha != 1 {
		t.Fatal("campanhas sincronizadas com synced_at = hoje")
	}
}
