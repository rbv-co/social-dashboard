package meta

import (
	"context"
	"fmt"
	"strconv"
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
	ch, p, _ := ambienteHoraCom(t, graphDaHora(gasto), agora)
	return ch, p
}

// ambienteHoraCom: o mesmo ambiente com a Graph de mentira à escolha; devolve também o core de mentira
// para os testes conferirem o que foi pedido.
func ambienteHoraCom(t *testing.T, graph func(core.PedidoMeta) (int, string, map[string]string), agora time.Time) (*ColetaHora, *pgxpool.Pool, *coreMeta) {
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
	cli, f := coreDeTeste(t, graph)
	return &ColetaHora{Pool: p, Core: cli, Agora: func() time.Time { return agora }}, p, f
}

// falhando: a Graph de mentira com um defeito a mais: o pedido que `alvo` reconhece volta com `status`.
func falhando(base func(core.PedidoMeta) (int, string, map[string]string), status int, alvo func(core.PedidoMeta) bool) func(core.PedidoMeta) (int, string, map[string]string) {
	return func(p core.PedidoMeta) (int, string, map[string]string) {
		if alvo(p) {
			return status, `{"error":{"message":"(#2) Service temporarily unavailable"}}`, nil
		}
		return base(p)
	}
}

// trocando: a Graph de mentira com a resposta de `alvo` trocada.
func trocando(base func(core.PedidoMeta) (int, string, map[string]string), alvo func(core.PedidoMeta) bool, corpo string) func(core.PedidoMeta) (int, string, map[string]string) {
	return func(p core.PedidoMeta) (int, string, map[string]string) {
		if alvo(p) {
			return 200, corpo, nil
		}
		return base(p)
	}
}

func pedidoCom(caminho string, param, valor string) func(core.PedidoMeta) bool {
	return func(p core.PedidoMeta) bool {
		v, _ := p.Parametros[param].(string)
		return p.Caminho == caminho && (param == "" || v == valor)
	}
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
	if err := c.Rodada(ctx, "07h"); err != nil && !falhaDeContas(err) {
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

func TestMetaHoraPedeODiaDeSaoPauloNaGraph(t *testing.T) {
	ch, p, f := ambienteHoraCom(t, graphDaHora("25.5"), time.Date(2026, 10, 10, 14, 5, 0, 0, time.UTC)) // 11:05 em SP
	_ = p
	if err := ch.Rodar(context.Background()); err != nil {
		t.Fatal(err)
	}
	vistos := map[string]bool{}
	for _, ped := range f.lista() {
		if !permitidoNoCore.MatchString(ped.Caminho) || ped.Metodo != "GET" {
			t.Errorf("pedido fora do contrato do core: %+v", ped)
		}
		if ped.Caminho == "/act_999/insights" {
			if ped.Parametros["time_range"] != `{"since":"2026-10-10","until":"2026-10-10"}` {
				t.Errorf("time_range de %v: %v", ped.Parametros["level"], ped.Parametros["time_range"])
			}
			vistos[ped.Parametros["level"].(string)] = true
		}
		if ped.Caminho == "/1784/insights" {
			desde := time.Date(2026, 10, 10, 3, 0, 0, 0, time.UTC).Unix() // meia-noite de SP
			ate := time.Date(2026, 10, 10, 14, 5, 0, 0, time.UTC).Unix()
			if ped.Parametros["since"] != strconv.FormatInt(desde, 10) || ped.Parametros["until"] != strconv.FormatInt(ate, 10) {
				t.Errorf("janela das visitas: %v..%v", ped.Parametros["since"], ped.Parametros["until"])
			}
		}
	}
	if !vistos["campaign"] || !vistos["ad"] {
		t.Fatalf("pediu insights de campanha e de anúncio: %v", vistos)
	}
}

func TestMetaHoraAntesDaViradaEmSaoPauloEODiaAnterior(t *testing.T) {
	// 02:05 UTC de 10/10 = 23:05 de 09/10 em São Paulo: dia 09/10 e hora 23 (a data não vem do UTC).
	ch, p, f := ambienteHoraCom(t, graphDaHora("5"), time.Date(2026, 10, 10, 2, 5, 0, 0, time.UTC))
	if err := ch.Rodar(context.Background()); err != nil {
		t.Fatal(err)
	}
	var dia string
	var hora int
	p.QueryRow(context.Background(), `select dia::text, hora from campaign_insights_hora`).Scan(&dia, &hora)
	if dia != "2026-10-09" || hora != 23 {
		t.Fatalf("23:05 de SP gravou dia=%s hora=%d", dia, hora)
	}
	for _, ped := range f.lista() {
		if ped.Caminho == "/act_999/insights" && ped.Parametros["time_range"] != `{"since":"2026-10-09","until":"2026-10-09"}` {
			t.Errorf("time_range: %v", ped.Parametros["time_range"])
		}
	}
}

func TestMetaHoraRodadaPosteriorSobrescreveAAnterior(t *testing.T) {
	// A repescagem existe para isto: o que a rodada das 00:05 gravou pela metade, a das 00:30 corrige.
	ch, p, _ := ambienteHoraCom(t, graphDaHora("1"), time.Date(2026, 10, 10, 3, 5, 0, 0, time.UTC))
	ctx := context.Background()
	if err := ch.Rodar(ctx); err != nil {
		t.Fatal(err)
	}
	melhor := graphDaHora("3")
	melhor = trocando(melhor, pedidoCom("/act_999/insights", "level", "ad"), `{"data":[{"ad_id":"ad-outro","campaign_id":"c-axiom","spend":"2","actions":[{"action_type":"link_click","value":"11"}]}]}`)
	melhor = trocando(melhor, pedidoCom("/1784/insights", "", ""), `{"data":[{"name":"profile_views","total_value":{"value":55}}]}`)
	ch.Core, _ = coreDeTeste(t, melhor)
	ch.Agora = func() time.Time { return time.Date(2026, 10, 10, 3, 30, 0, 0, time.UTC) }
	if err := ch.Rodar(ctx); err != nil {
		t.Fatal(err)
	}
	var n int
	var gasto, gastoHora, adGasto float64
	var adCliques, visitas int
	p.QueryRow(ctx, `select count(*), max(gasto_acumulado)::float8, max(gasto_hora)::float8 from campaign_insights_hora`).Scan(&n, &gasto, &gastoHora)
	p.QueryRow(ctx, `select gasto_acumulado::float8, cliques_acumulados from ad_insights_hora`).Scan(&adGasto, &adCliques)
	p.QueryRow(ctx, `select visitas_acumuladas from perfil_visitas_hora`).Scan(&visitas)
	if n != 1 || gasto != 3 || gastoHora != 3 || adGasto != 2 || adCliques != 11 || visitas != 55 {
		t.Fatalf("a rodada posterior atualiza as linhas: n=%d gasto=%v hora=%v ad=%v/%d visitas=%d", n, gasto, gastoHora, adGasto, adCliques, visitas)
	}
}

func TestMetaHoraFalhaDeUmaFonteViraErroMasOsDadosFicam(t *testing.T) {
	agora := time.Date(2026, 10, 10, 14, 5, 0, 0, time.UTC)
	for nome, c := range map[string]struct {
		falha func(core.PedidoMeta) bool
		antes string
		quer  string
	}{
		"seguidores":    {pedidoCom("/1784", "fields", "followers_count"), "", "Vessel: seguidores (Meta API /1784"},
		"visitas":       {pedidoCom("/1784/insights", "metric", "profile_views"), "", "Vessel: visitas ao perfil (Meta API /1784/insights"},
		"anuncios":      {pedidoCom("/act_999/insights", "level", "ad"), "", "Vessel: ads outro (Meta API /act_999/insights"},
		"gravar-visita": {func(core.PedidoMeta) bool { return false }, "alter table perfil_visitas_hora add check (visitas_acumuladas < 0)", "Vessel: falha ao gravar visitas ao perfil"},
		"gravar-ads":    {func(core.PedidoMeta) bool { return false }, "alter table ad_insights_hora add check (gasto_acumulado < 0)", "Vessel: falha ao gravar ad_insights_hora"},
	} {
		t.Run(nome, func(t *testing.T) {
			ch, p, _ := ambienteHoraCom(t, falhando(graphDaHora("25.5"), 500, c.falha), agora)
			if c.antes != "" {
				if _, err := p.Exec(context.Background(), c.antes); err != nil {
					t.Fatal(err)
				}
			}
			err := ch.Rodar(context.Background())
			if err == nil || !strings.Contains(err.Error(), c.quer) || strings.Contains(err.Error(), "nada coletado") {
				t.Fatalf("falha de uma fonte = erro da tarefa, que não é 'nada coletado': %v", err)
			}
			var n int
			p.QueryRow(context.Background(), `select count(*) from campaign_insights_hora where hora = 11`).Scan(&n)
			if n != 1 {
				t.Fatalf("o resto da coleta fica gravado: %d linhas de campanha", n)
			}
		})
	}
}

func TestMetaHoraContaQueFalhaNaoParaAsOutras(t *testing.T) {
	// "Mantova Móveis" vem antes de "Vessel" na ordem por nome: a que falha não pode impedir a seguinte.
	ch, p, _ := ambienteHoraCom(t, falhando(graphDaHora("25.5"), 500, func(p core.PedidoMeta) bool {
		return strings.HasPrefix(p.Caminho, "/act_888")
	}), time.Date(2026, 10, 10, 14, 5, 0, 0, time.UTC))
	ctx := context.Background()
	if _, err := p.Exec(ctx, `update accounts set ad_account_id = '888', instagram_id = null where id = 'aaaaaaaa-0000-0000-0000-0000000000a2'`); err != nil {
		t.Fatal(err)
	}
	err := ch.Rodar(ctx)
	if err == nil || !strings.Contains(err.Error(), "Mantova Móveis") || strings.Contains(err.Error(), "nada coletado") || strings.Contains(err.Error(), "Vessel") {
		t.Fatalf("a conta que falha é nomeada no erro; a outra não: %v", err)
	}
	var n, s int
	p.QueryRow(ctx, `select count(*) from campaign_insights_hora where account_id = $1::uuid`, contaA1).Scan(&n)
	p.QueryRow(ctx, `select count(*) from followers_leituras where origem = 'hora'`).Scan(&s)
	if n != 1 || s != 1 {
		t.Fatalf("os dados da conta boa foram gravados: campanhas=%d seguidores=%d", n, s)
	}
}

func TestMetaHoraGraphRecusaViraErroDaTarefa(t *testing.T) {
	ch, _, _ := ambienteHoraCom(t, falhando(graphDaHora("25.5"), 400, pedidoCom("/act_999/insights", "level", "campaign")),
		time.Date(2026, 10, 10, 14, 5, 0, 0, time.UTC))
	err := ch.Rodar(context.Background())
	if err == nil || !strings.Contains(err.Error(), "Vessel: Meta API /act_999/insights") {
		t.Fatalf("400 da Graph = erro com a conta e a rota: %v", err)
	}
}

func TestInteiroEFloatDoJS(t *testing.T) {
	i := func(v any) string {
		if n := inteiroJS(v); n != nil {
			return strconv.FormatInt(*n, 10)
		}
		return "nulo"
	}
	f := func(v any) string {
		if n := floatJS(v); n != nil {
			return strconv.FormatFloat(*n, 'g', -1, 64)
		}
		return "nulo"
	}
	for _, c := range []struct {
		entrada            any
		inteiro, flutuante string
	}{
		{nil, "0", "0"}, {"12.9", "12", "12.9"}, {"  7x", "7", "7"}, {"-3", "-3", "-3"}, {"abc", "nulo", "nulo"}, {"", "nulo", "nulo"},
		{".5", "nulo", "0.5"}, {"1e3", "1", "1000"}, {float64(42), "42", "42"},
	} {
		if got := i(c.entrada); got != c.inteiro {
			t.Errorf("inteiroJS(%v) = %s, quer %s", c.entrada, got, c.inteiro)
		}
		if got := f(c.entrada); got != c.flutuante {
			t.Errorf("floatJS(%v) = %s, quer %s", c.entrada, got, c.flutuante)
		}
	}
}

// graphDosAnuncios: campanhas/anúncios/conjuntos de mentira; o insights devolve, para qualquer janela,
// uma linha cujo gasto é o DIA da janela (since) mais 100 por `variante`, e cujos cliques/conversas vêm dela.
func graphDosAnuncios(variante *int) func(core.PedidoMeta) (int, string, map[string]string) {
	return func(p core.PedidoMeta) (int, string, map[string]string) {
		m := func(k string) string { s, _ := p.Parametros[k].(string); return s }
		switch p.Caminho {
		case "/act_999/campaigns":
			return 200, `{"data":[{"id":"c1","name":"[CAMPANHA WPP] Leads","objective":"OUTCOME_LEADS","status":"ACTIVE"}]}`, nil
		case "/act_999/ads":
			return 200, `{"data":[{"id":"a1","campaign_id":"c1"}]}`, nil
		case "/act_999/adsets":
			return 200, `{"data":[{"id":"s1","campaign_id":"c1","destination_type":"WHATSAPP"},{"id":"s2","campaign_id":"c1"},{"id":"s3"}]}`, nil
		case "/act_999/insights":
			var desde, ate string
			if _, err := fmt.Sscanf(m("time_range"), `{"since":"%10s","until":"%10s"}`, &desde, &ate); err != nil {
				return 400, `{"error":{"message":"time_range inválido"}}`, nil
			}
			dia, _ := strconv.Atoi(desde[8:])
			cliques := []string{`"abc"`, `"20"`}[*variante]
			return 200, `{"data":[{"campaign_id":"c1","spend":"` + strconv.Itoa(dia+100**variante) + `","clicks":` + cliques + `,
				"actions":[{"action_type":"onsite_conversion.total_messaging_connection","value":"` + strconv.Itoa(1+*variante) + `"}]}]}`, nil
		}
		return 200, `{"data":[]}`, nil
	}
}

func TestColetaDiariaAnunciosJanelasELimites(t *testing.T) {
	c, f, p, _ := ambienteColeta(t)
	ctx := context.Background()
	if _, err := p.Exec(ctx, tabelasAnuncios); err != nil {
		t.Fatal(err)
	}
	p.Exec(ctx, `update accounts set ad_account_id = '999' where id = '`+contaA1+`'`)
	resp := f.resp
	variante := 0
	ads := graphDosAnuncios(&variante)
	f.resp = func(pd core.PedidoMeta) (int, string, map[string]string) {
		if strings.HasPrefix(pd.Caminho, "/act_999") {
			return ads(pd)
		}
		return resp(pd)
	}
	if err := c.Rodada(ctx, "07h"); err != nil && !falhaDeContas(err) {
		t.Fatal(err)
	}
	// Janelas pedidas: as 4 de N dias completos (0 = hoje), e 1 por dia dos 7 anteriores.
	pedidas := map[string]int{}
	for _, ped := range f.lista() {
		if ped.Caminho == "/act_999/insights" {
			pedidas[ped.Parametros["time_range"].(string)]++
			if ped.Parametros["limit"] != "500" || ped.Parametros["level"] != "campaign" {
				t.Errorf("insights: %+v", ped.Parametros)
			}
		}
		if ped.Caminho == "/act_999/ads" && ped.Parametros["limit"] != "100" {
			t.Errorf("ads: limit %v", ped.Parametros["limit"])
		}
		if (ped.Caminho == "/act_999/campaigns" || ped.Caminho == "/act_999/adsets") && ped.Parametros["limit"] != "500" {
			t.Errorf("%s: limit %v", ped.Caminho, ped.Parametros["limit"])
		}
	}
	quer := map[string]int{
		`{"since":"2026-10-10","until":"2026-10-10"}`: 1, // 0 d
		`{"since":"2026-10-09","until":"2026-10-09"}`: 2, // 1 d e o pd=0 de ontem
		`{"since":"2026-10-03","until":"2026-10-09"}`: 1, // 7 d
		`{"since":"2026-09-26","until":"2026-10-09"}`: 1, // 14 d
		`{"since":"2026-09-10","until":"2026-10-09"}`: 1, // 30 d
	}
	for d := 2; d <= 7; d++ {
		quer[fmt.Sprintf(`{"since":"2026-10-%02d","until":"2026-10-%02d"}`, 10-d, 10-d)]++
	}
	if len(pedidas) != len(quer) {
		t.Errorf("janelas pedidas: %v", pedidas)
	}
	for k, n := range quer {
		if pedidas[k] != n {
			t.Errorf("janela %s pedida %d vez(es), quer %d (todas: %v)", k, pedidas[k], n, pedidas)
		}
	}
	var dias string
	p.QueryRow(ctx, `select string_agg(captured_at::text || '=' || spend, ',' order by captured_at) from campaign_insights where period_days = 0`).Scan(&dias)
	if dias != "2026-10-03=3,2026-10-04=4,2026-10-05=5,2026-10-06=6,2026-10-07=7,2026-10-08=8,2026-10-09=9,2026-10-10=10" {
		t.Fatalf("pd=0: hoje e os 7 dias anteriores: %q", dias)
	}
	var clicks *int64
	var impressoes int64
	p.QueryRow(ctx, `select clicks, impressions from campaign_insights where period_days = 7`).Scan(&clicks, &impressoes)
	if clicks != nil || impressoes != 0 {
		t.Fatalf("sem número = NULL (NaN do parseInt); campo ausente = 0 (parseInt('0')): clicks=%v impressions=%d", clicks, impressoes)
	}
	var adsets string
	p.QueryRow(ctx, `select string_agg(adset_id || '=' || coalesce(destination_type, 'nulo'), ',' order by adset_id) from campaign_adsets`).Scan(&adsets)
	if adsets != "s1=WHATSAPP,s2=nulo" {
		t.Fatalf("conjuntos (sem campanha pula; campo ausente = NULL): %q", adsets)
	}

	// Segunda coleta no mesmo dia: o on conflict ATUALIZA (a Meta corrige o gasto e as contagens).
	variante = 1
	if err := c.Rodada(ctx, "12h"); err != nil && !falhaDeContas(err) {
		t.Fatal(err)
	}
	var n, conversas int
	var gasto float64
	p.QueryRow(ctx, `select count(*), max(clicks), max(conversas), max(spend)::float8 from campaign_insights where period_days = 7`).Scan(&n, &clicks, &conversas, &gasto)
	if n != 1 || clicks == nil || *clicks != 20 || conversas != 2 || gasto != 103 {
		t.Fatalf("a segunda coleta atualiza a linha: n=%d clicks=%v conversas=%d gasto=%v", n, clicks, conversas, gasto)
	}
}

func TestColetaDiariaAnunciosFalhaDeInsightsViraDegradado(t *testing.T) {
	c, f, p, _ := ambienteColeta(t)
	ctx := context.Background()
	if _, err := p.Exec(ctx, tabelasAnuncios); err != nil {
		t.Fatal(err)
	}
	p.Exec(ctx, `update accounts set ad_account_id = '999' where id = '`+contaA1+`'`)
	resp := f.resp
	variante := 1
	ads := graphDosAnuncios(&variante)
	f.resp = func(pd core.PedidoMeta) (int, string, map[string]string) {
		if pd.Caminho == "/act_999/insights" && pd.Parametros["time_range"] == `{"since":"2026-10-03","until":"2026-10-09"}` {
			return 500, `{"error":{"message":"(#2) Service temporarily unavailable"}}`, nil
		}
		if strings.HasPrefix(pd.Caminho, "/act_999") {
			return ads(pd)
		}
		return resp(pd)
	}
	if err := c.Rodada(ctx, "07h"); err != nil && !falhaDeContas(err) {
		t.Fatalf("falha de janela é aviso, a conta segue: %v", err)
	}
	var recado string
	p.QueryRow(ctx, `select detail from data_integrity_checks where check_name = 'coleta_zerada' and detail like '%insights de campanha%'`).Scan(&recado)
	if !strings.Contains(recado, "Vessel: 1 de 12 janelas de insights de campanha falharam (Meta API /act_999/insights: (#2) Service temporarily unavailable)") {
		t.Fatalf("recado ao super admin: %q", recado)
	}
	var n int
	p.QueryRow(ctx, `select count(*) from campaign_insights where period_days = 14`).Scan(&n)
	if n != 1 {
		t.Fatalf("as outras janelas seguem gravadas: %d", n)
	}
}
