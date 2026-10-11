package meta

import (
	"context"
	"encoding/json"
	"errors"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/core"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
	"github.com/rbv-co/social-dashboard/api/internal/worker"
)

// Tabelas anteriores às migrations (accounts, daily_snapshots, engagement_snapshots, content_snapshots,
// data_integrity_checks) têm aqui SÓ as colunas que o coletor usa; o ensaio confere em produção
// (ops/migracao/conferir-worker.sql). followers_leituras vem de 2026-07-16-followers-leituras.sql.
const tabelasColeta = `
create table accounts (id uuid primary key, name text, instagram_id text, ad_account_id text, access_token text, picture_url text);
create table daily_snapshots (account_id uuid not null, captured_at date not null, followers_count int, gained int, lost int,
  unique (account_id, captured_at));
create table followers_leituras (id bigserial primary key, account_id uuid not null, followers_count int not null,
  lido_em timestamptz not null default now(), origem text);
create table engagement_snapshots (account_id uuid not null, captured_at date not null, period_days int not null,
  likes int, comments int, saves int, shares int, reach int, views int, total_interactions int, accounts_engaged int, profile_views int,
  unique (account_id, captured_at, period_days));
create table content_snapshots (account_id uuid not null, captured_at date not null, period_days int not null, posts_count int,
  reels_count int, stories_count int, story_shares int, story_replies int, story_reach int, story_interactions int,
  story_navigation int, story_profile_visits int, story_follows int, story_nav_forward int, story_nav_back int, story_nav_exit int,
  story_nav_next int, unique (account_id, captured_at, period_days));
create table data_integrity_checks (id bigserial primary key, checked_date date not null, account_id uuid, check_name text not null,
  status text not null, detail text);
insert into accounts (id, name, instagram_id, ad_account_id, access_token) values
  ('aaaaaaaa-0000-0000-0000-0000000000a1', 'Vessel', '1784', null, 'tok'),
  ('aaaaaaaa-0000-0000-0000-0000000000a2', 'Mantova Móveis', '1785', null, 'tok'),
  ('aaaaaaaa-0000-0000-0000-0000000000a3', 'Breno', '1786', null, 'tok'),
  ('aaaaaaaa-0000-0000-0000-0000000000a4', 'Sem token', '1787', null, null);`

const (
	contaA1 = "aaaaaaaa-0000-0000-0000-0000000000a1"
	contaA3 = "aaaaaaaa-0000-0000-0000-0000000000a3"
)

// agoraColeta: sábado 2026-10-10 07:00 em São Paulo (10:00 UTC, a rodada das 07h).
var agoraColeta = time.Date(2026, 10, 10, 10, 0, 0, 0, time.UTC)

// permitidoNoCore: a allow-list de GET do proxy da Meta (vessel-core-go@e8a06e8c3,
// services/core/internal/meta/http.go:111). Caminho fora dela = 400 no core de verdade.
var dataISO = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

var permitidoNoCore = regexp.MustCompile(`^(/(me|act_\d+|\d+)(/[a-z_]+){0,3}|/search)$`)

func diaDoSince(p core.PedidoMeta) string {
	s, _ := p.Parametros["since"].(string)
	n, _ := strconv.ParseInt(s, 10, 64)
	return time.Unix(n, 0).In(saoPaulo).Format("2006-01-02")
}

func graphDaColeta(p core.PedidoMeta) (int, string, map[string]string) {
	m := func(k string) string { s, _ := p.Parametros[k].(string); return s }
	if _, tem := p.Parametros["since"]; tem { // janela de insights: since < until, ou a Meta recusa
		si, _ := strconv.ParseInt(m("since"), 10, 64)
		ui, _ := strconv.ParseInt(m("until"), 10, 64)
		if si <= 0 || ui <= si {
			return 400, `{"error":{"message":"(#100) since/until inválidos"}}`, nil
		}
	}
	if tr := m("time_range"); tr != "" { // anúncios: {"since":"AAAA-MM-DD","until":"AAAA-MM-DD"}, since <= until
		var j struct{ Since, Until string }
		if json.Unmarshal([]byte(tr), &j) != nil || !dataISO.MatchString(j.Since) || !dataISO.MatchString(j.Until) || j.Since > j.Until {
			return 400, `{"error":{"message":"(#100) time_range inválido"}}`, nil
		}
	}
	switch {
	case p.Caminho == "/1785":
		return 500, `{"error":{"message":"(#2) Service temporarily unavailable"}}`, nil
	case (p.Caminho == "/1784" || p.Caminho == "/1786") && m("fields") == "followers_count":
		return 200, `{"followers_count":24345}`, nil
	case m("metric") == "follows_and_unfollows":
		switch diaDoSince(p) {
		case "2026-10-09":
			return 200, `{"data":[]}`, nil // ontem sem número: atraso normal, ainda não é recado
		case "2026-10-08":
			if p.Caminho == "/1784"+"/insights" {
				return 200, `{"data":[{"total_value":{"breakdowns":[{"results":[]}]}}]}`, nil // respondeu sem número
			}
		}
		return 200, `{"data":[{"total_value":{"breakdowns":[{"results":[{"dimension_values":["FOLLOWER"],"value":14},{"dimension_values":["NON_FOLLOWER"],"value":3}]}]}}]}`, nil
	case strings.HasPrefix(m("metric"), "likes,comments"):
		if p.Caminho == "/1786/insights" { // a Meta pela metade: curtidas zeradas com 556 interações
			return 200, `{"data":[{"name":"likes","total_value":{"value":0}},{"name":"comments","total_value":{"value":34}},{"name":"reach","total_value":{"value":900}},{"name":"total_interactions","total_value":{"value":556}}]}`, nil
		}
		return 200, `{"data":[{"name":"likes","total_value":{"value":100}},{"name":"comments","total_value":{"value":10}},{"name":"saves","total_value":{"value":5}},
			{"name":"shares","total_value":{"value":3}},{"name":"reach","total_value":{"value":1000}},{"name":"views","total_value":{"value":2000}},
			{"name":"total_interactions","total_value":{"value":118}},{"name":"accounts_engaged","total_value":{"value":50}},{"name":"profile_views","total_value":{"value":20}}]}`, nil
	case p.Caminho == "/1784/stories":
		return 200, `{"data":[{"id":"501","timestamp":"2026-10-10T12:00:00+0000"},{"id":"502","timestamp":"2026-10-09T20:00:00+0000"}]}`, nil
	case p.Caminho == "/501/insights" && m("breakdown") == "":
		return 200, `{"data":[{"name":"reach","values":[{"value":10}]},{"name":"replies","value":1},{"name":"shares","value":2},
			{"name":"total_interactions","value":5},{"name":"navigation","value":8},{"name":"profile_visits","value":1},{"name":"follows","value":0}]}`, nil
	case p.Caminho == "/501/insights":
		return 200, `{"data":[{"total_value":{"breakdowns":[{"results":[{"dimension_values":["tap_forward"],"value":5},{"dimension_values":["tap_back"],"value":1},
			{"dimension_values":["tap_exit"],"value":1},{"dimension_values":["swipe_forward"],"value":1}]}]}}]}`, nil
	case p.Caminho == "/1784/media":
		return 200, `{"data":[
			{"id":"1","media_product_type":"REELS","timestamp":"2026-10-10T11:00:00+0000","owner":{"id":"1784"}},
			{"id":"2","media_product_type":"FEED","timestamp":"2026-10-10T11:30:00+0000","owner":{"id":"1784"}},
			{"id":"3","media_product_type":"FEED","timestamp":"2026-10-09T15:00:00+0000"},
			{"id":"4","media_product_type":"FEED","timestamp":"2026-09-30T15:00:00+0000","owner":{"id":"1784"}},
			{"id":"5","media_product_type":"FEED","timestamp":"2026-10-10T11:00:00+0000","owner":{"id":"999"}},
			{"id":"6","media_product_type":"STORY","timestamp":"2026-10-10T11:00:00+0000","owner":{"id":"1784"}}]}`, nil
	}
	return 200, `{"data":[]}`, nil
}

func ambienteColeta(t *testing.T) (*ColetaDiaria, *coreMeta, *pgxpool.Pool, *worker.Agendador) {
	t.Helper()
	p := testebanco.Novo(t)
	if _, err := p.Exec(context.Background(), tabelasColeta); err != nil {
		t.Fatal(err)
	}
	cli, f := coreDeTeste(t, graphDaColeta)
	ag := worker.Novo(p)
	c := &ColetaDiaria{Pool: p, Core: cli, Gravar: ag.Gravador(), Agora: func() time.Time { return agoraColeta },
		Dormir: func(context.Context, time.Duration) error { return nil }}
	return c, f, p, ag
}

func TestColetaDiariaUmaLinhaPorContaComONomeDeProducao(t *testing.T) {
	c, f, p, ag := ambienteColeta(t)
	ctx := context.Background()
	ex, err := ag.Rodar(ctx, c.Tarefas()[0])
	if !ex || !falhaDeContas(err) {
		t.Fatalf("a conta que falha fica na linha dela e a rodada sinaliza (sem linha agregada): ex=%v err=%v", ex, err)
	}
	linhas, _ := p.Query(ctx, `select robo, ok, coalesce(resposta, '') from robos_execucoes order by robo`)
	var got []string
	for linhas.Next() {
		var robo, resp string
		var ok bool
		linhas.Scan(&robo, &ok, &resp)
		got = append(got, robo+"|"+strconv.FormatBool(ok)+"|"+resp)
	}
	quer := []string{
		"coletar-dados-07h · Breno|true|ok",
		"coletar-dados-07h · Mantova Móveis|false|Meta API /1785: (#2) Service temporarily unavailable",
		"coletar-dados-07h · Vessel|true|ok",
	}
	if strings.Join(got, "\n") != strings.Join(quer, "\n") {
		t.Fatalf("robos_execucoes =\n%s\nesperava\n%s", strings.Join(got, "\n"), strings.Join(quer, "\n"))
	}
	for _, ped := range f.lista() {
		if !permitidoNoCore.MatchString(ped.Caminho) || ped.Parametros["access_token"] != nil || ped.Metodo != "GET" {
			t.Errorf("pedido fora do contrato do core: %+v", ped)
		}
		if strings.HasPrefix(ped.Caminho, "/1787") {
			t.Error("conta sem access_token não entra na rodada (o filtro de disparar_coletor)")
		}
	}
}

func TestColetaDiariaGravaComoAEdge(t *testing.T) {
	c, _, p, _ := ambienteColeta(t)
	ctx := context.Background()
	if err := c.Rodada(ctx, "07h"); err != nil && !falhaDeContas(err) {
		t.Fatal(err)
	}
	var seguidores, ganho, perda int
	p.QueryRow(ctx, `select followers_count, gained, lost from daily_snapshots where account_id = $1::uuid and captured_at = '2026-10-10'`, contaA1).
		Scan(&seguidores, &ganho, &perda)
	if seguidores != 24345 || ganho != 14 || perda != 3 {
		t.Fatalf("daily_snapshots: %d %d %d", seguidores, ganho, perda)
	}
	var leituras int
	p.QueryRow(ctx, `select count(*) from followers_leituras where origem = 'diario'`).Scan(&leituras)
	if leituras != 2 {
		t.Fatalf("uma leitura por conta coletada: %d", leituras)
	}
	var recado string
	p.QueryRow(ctx, `select detail from data_integrity_checks where check_name = 'bruto_seguidores_parado' and account_id = $1::uuid`, contaA1).Scan(&recado)
	if recado != "Vessel: o Instagram não publica seguiram/deixaram desde 08/10 (1 dia sem número)" {
		t.Fatalf("recado do bruto parado: %q", recado)
	}
	var posts0, reels0, stories0, alcance0, frente0, posts7, reels7, posts14 int
	var stories7 *int
	p.QueryRow(ctx, `select posts_count, reels_count, stories_count, story_reach, story_nav_forward from content_snapshots
		where account_id = $1::uuid and period_days = 0`, contaA1).Scan(&posts0, &reels0, &stories0, &alcance0, &frente0)
	p.QueryRow(ctx, `select posts_count, reels_count, stories_count from content_snapshots where account_id = $1::uuid and period_days = 7`, contaA1).
		Scan(&posts7, &reels7, &stories7)
	p.QueryRow(ctx, `select posts_count from content_snapshots where account_id = $1::uuid and period_days = 14`, contaA1).Scan(&posts14)
	if posts0 != 1 || reels0 != 1 || stories0 != 1 || alcance0 != 10 || frente0 != 5 {
		t.Fatalf("período 0: posts=%d reels=%d stories=%d alcance=%d frente=%d", posts0, reels0, stories0, alcance0, frente0)
	}
	if posts7 != 2 || reels7 != 1 || stories7 != nil || posts14 != 3 {
		t.Fatalf("7d: posts=%d reels=%d stories=%v; 14d: posts=%d", posts7, reels7, stories7, posts14)
	}
	var periodos string
	p.QueryRow(ctx, `select string_agg(period_days::text || '=' || likes, ',' order by period_days) from engagement_snapshots where account_id = $1::uuid`, contaA1).Scan(&periodos)
	if periodos != "0=100,1=100,7=100,14=100,30=100,99=100" {
		t.Fatalf("engajamento: %q", periodos)
	}
	var zerada string
	var engBreno int
	p.QueryRow(ctx, `select detail from data_integrity_checks where check_name = 'coleta_zerada'`).Scan(&zerada)
	p.QueryRow(ctx, `select count(*) from engagement_snapshots where account_id = $1::uuid`, contaA3).Scan(&engBreno)
	quer := "⚠️ Coleta IG: a Meta retornou métricas zeradas/inconsistentes (alcance 0 ou likes/comments/saves/shares zerados com interações>0) mesmo após 5 tentativas em: " +
		"Breno 0d · Breno 7d (sem histórico) · Breno 14d (sem histórico) · Breno 30d (sem histórico) · Breno mês (sem histórico). " +
		"Mantive o valor mais recente válido (não zerei o painel). Verificar token/permissões da Meta."
	if zerada != quer || engBreno != 0 {
		t.Fatalf("leitura pela metade não vira linha: zerada=%q linhas=%d", zerada, engBreno)
	}
}

func TestColetaDiariaUsaOUltimoBomEAgendas(t *testing.T) {
	c, _, p, _ := ambienteColeta(t)
	ctx := context.Background()
	p.Exec(ctx, `insert into engagement_snapshots (account_id, captured_at, period_days, likes, comments, saves, shares, reach, views, total_interactions, accounts_engaged, profile_views)
		values ($1::uuid, '2026-10-09', 7, 80, 9, 4, 2, 800, 1500, 95, 40, 15)`, contaA3)
	if err := c.Rodada(ctx, "12h"); err != nil && !falhaDeContas(err) {
		t.Fatal(err)
	}
	var likes, comments int
	p.QueryRow(ctx, `select likes, comments from engagement_snapshots where account_id = $1::uuid and captured_at = '2026-10-10' and period_days = 7`, contaA3).Scan(&likes, &comments)
	if likes != 80 || comments != 34 {
		t.Fatalf("o zero vem do último bom e o que a Meta mandou fica: likes=%d comments=%d", likes, comments)
	}
	var quer = map[string]string{"coletar-dados-07h": "0 10 * * *", "coletar-dados-12h": "0 15 * * *", "coletar-dados-18h": "0 21 * * *", "coletar-dados-2359": "59 2 * * *"}
	for _, tf := range c.Tarefas() {
		if quer[tf.Nome] != tf.Agenda || tf.Trava != "coletar-dados" || !tf.RegistroProprio {
			t.Errorf("%+v", tf)
		}
	}
}

// Core fora do ar: nenhuma conta coleta, cada uma fica com a linha dela (ok=false) e a rodada sinaliza.
// O endereço do core (core.Cliente devolve o *url.Error), o webhook de alerta e o token não aparecem
// nas linhas, no erro da rodada nem no log.
func TestColetaDiariaCoreForaDoArNaoVazaSegredos(t *testing.T) {
	p := testebanco.Novo(t)
	ctx := context.Background()
	if _, err := p.Exec(ctx, tabelasColeta); err != nil {
		t.Fatal(err)
	}
	log := capturarLog(t)
	ag := worker.Novo(p)
	ag.Segredos = []string{"http://127.0.0.1:1/hook-secreto-456", "token-inventado"}
	cli := core.Novo("http://127.0.0.1:1/core-secreto-789", "token-inventado")
	c := &ColetaDiaria{Pool: p, Core: cli, Gravar: ag.Gravador(), Alerta: "http://127.0.0.1:1/hook-secreto-456",
		Agora: func() time.Time { return agoraColeta }, Dormir: func(context.Context, time.Duration) error { return nil }}
	err := c.Rodada(ctx, "07h")
	var fi *worker.FalhaDeItens
	if !errors.As(err, &fi) || fi.Quantos != 3 {
		t.Fatalf("3 contas falharam: %v", err)
	}
	var resp string
	var n int
	if err := p.QueryRow(ctx, `select string_agg(coalesce(resposta, ''), ' | '), count(*) from robos_execucoes where not ok`).Scan(&resp, &n); err != nil {
		t.Fatal(err)
	}
	tudo := resp + " " + err.Error() + " " + log.String()
	if n != 3 || strings.Contains(tudo, "secreto") || strings.Contains(tudo, "token-inventado") {
		t.Fatalf("linhas=%d, saída = %q", n, tudo)
	}
	if strings.Count(log.String(), "coletar-dados: conta falhou") != 3 || !strings.Contains(log.String(), `conta="Mantova Móveis"`) {
		t.Fatalf("um slog.Error por conta que falhou: %s", log)
	}
}
