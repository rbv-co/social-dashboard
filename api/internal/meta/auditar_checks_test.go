package meta

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/core"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

func TestVereditoFronteiras(t *testing.T) {
	for _, c := range []struct {
		painel, meta    float64
		status, detalhe string
	}{
		{85, 100, "ok", "painel=85 vs Meta=100"},         // divergência exatamente 0,15: ainda ok
		{84, 100, "warn", "painel=84 vs Meta=100 (16%)"}, // acima de 0,15
		{70, 100, "warn", "painel=70 vs Meta=100 (30%)"}, // exatamente 0,30: ainda aviso
		{69, 100, "fail", "painel=69 vs Meta=100"},       // acima de 0,30
		{0, 50, "fail", "painel=0 vs Meta=50"},           // divergência 1,0
		{0, 0, "ok", "painel=0 vs Meta=0"},               // Meta 0: o divisor mínimo é 1
		{1, 0, "fail", "painel=1 vs Meta=0"},             // |1-0| / max(0,1) = 1
		{12, 10, "warn", "painel=12 vs Meta=10 (20%)"},
	} {
		if st, d := veredito(&c.painel, &c.meta); st != c.status || d != c.detalhe {
			t.Errorf("%v × %v = %s %q (queria %s %q)", c.painel, c.meta, st, d, c.status, c.detalhe)
		}
	}
}

const dadosDosChecks = `
insert into daily_snapshots values
  ('aaaaaaaa-0000-0000-0000-0000000000a1', '2026-10-08', 1000, 3, 0), ('aaaaaaaa-0000-0000-0000-0000000000a1', '2026-10-09', 1000, 0, 0), ('aaaaaaaa-0000-0000-0000-0000000000a1', '2026-10-10', 900, 0, 0),
  ('aaaaaaaa-0000-0000-0000-0000000000a2', '2026-10-07', 1000, 1, 0), ('aaaaaaaa-0000-0000-0000-0000000000a2', '2026-10-09', 1000, 0, 0), ('aaaaaaaa-0000-0000-0000-0000000000a2', '2026-10-10', 899, 0, 0),
  ('aaaaaaaa-0000-0000-0000-0000000000a3', '2026-10-09', 1000, 0, 0), ('aaaaaaaa-0000-0000-0000-0000000000a3', '2026-10-10', 750, 0, 0),
  ('aaaaaaaa-0000-0000-0000-0000000000a4', '2026-10-09', 1000, 0, 0), ('aaaaaaaa-0000-0000-0000-0000000000a4', '2026-10-10', 749, 0, 0);
insert into engagement_snapshots (account_id, captured_at, period_days, likes, reach, views, total_interactions) values
  ('aaaaaaaa-0000-0000-0000-0000000000a1', '2026-10-10', 7, 0, 105, 100, 51), ('aaaaaaaa-0000-0000-0000-0000000000a1', '2026-10-10', 14, 5, 200, 150, 10),
  ('aaaaaaaa-0000-0000-0000-0000000000a1', '2026-10-10', 30, 9, 300, 250, 60),
  ('aaaaaaaa-0000-0000-0000-0000000000a2', '2026-10-10', 7, 0, 50, 50, 50), ('aaaaaaaa-0000-0000-0000-0000000000a2', '2026-10-10', 14, 3, 60, 60, 10),
  ('aaaaaaaa-0000-0000-0000-0000000000a2', '2026-10-10', 30, 2, 70, 70, 10),
  ('aaaaaaaa-0000-0000-0000-0000000000a3', '2026-10-10', 7, 1, 0, 10, 5);
insert into content_snapshots (account_id, captured_at, period_days, stories_count, story_navigation, story_nav_forward, story_nav_back, story_nav_exit, story_nav_next) values
  ('aaaaaaaa-0000-0000-0000-0000000000a1', '2026-10-10', 1, 2, 8, 5, 1, 1, 1),
  ('aaaaaaaa-0000-0000-0000-0000000000a2', '2026-10-10', 1, 2, 8, 5, 1, 1, 0);`

func ambienteAuditoria(t *testing.T, likesDaMeta *int) (*Auditoria, *pgxpool.Pool, *coreMeta) {
	t.Helper()
	p := testebanco.Novo(t)
	ctx := context.Background()
	for _, sql := range []string{tabelasColeta, dadosDosChecks} {
		if _, err := p.Exec(ctx, sql); err != nil {
			t.Fatal(err)
		}
	}
	var mu sync.Mutex
	cli, f := coreDeTeste(t, func(pd core.PedidoMeta) (int, string, map[string]string) {
		if pd.Caminho != "/1784/insights" {
			return 400, `{"error":{"message":"conta sem acesso"}}`, nil
		}
		ate := agoraColeta.Unix() // a janela do spot-check: os últimos 7 dias até agora
		if pd.Parametros["since"] != strconv.FormatInt(ate-7*86400, 10) || pd.Parametros["until"] != strconv.FormatInt(ate, 10) ||
			pd.Parametros["metric"] != "likes,reach" || pd.Parametros["period"] != "day" || pd.Parametros["metric_type"] != "total_value" {
			return 400, `{"error":{"message":"janela do spot-check errada"}}`, nil
		}
		mu.Lock()
		defer mu.Unlock()
		return 200, `{"data":[{"name":"likes","total_value":{"value":` + strconv.Itoa(*likesDaMeta) + `}},{"name":"reach","total_value":{"value":105}}]}`, nil
	})
	return &Auditoria{Pool: p, Core: cli, Agora: func() time.Time { return agoraColeta }}, p, f
}

func estadoDosChecks(t *testing.T, p *pgxpool.Pool) map[string]string {
	t.Helper()
	linhas, err := p.Query(context.Background(), `select d.check_name || '/' || coalesce(a.name, '?'), d.status || ' ' || coalesce(d.detail, '')
		from data_integrity_checks d left join accounts a on a.id = d.account_id`)
	if err != nil {
		t.Fatal(err)
	}
	defer linhas.Close()
	out := map[string]string{}
	for linhas.Next() {
		var k, v string
		linhas.Scan(&k, &v)
		out[k] = strings.TrimSpace(v)
	}
	return out
}

// Cada check, em cada conta, com os valores em cima da fronteira (0,10 / 0,25 da queda; > 50 interações;
// últimos 2 dias do bruto; reach = views + 5).
func TestAuditoriaTodosOsChecksEmCimaDasFronteiras(t *testing.T) {
	likes := 100
	a, p, _ := ambienteAuditoria(t, &likes)
	if err := a.Rodar(context.Background()); err != nil {
		t.Fatal(err)
	}
	quer := map[string]string{
		"frescor/Vessel": "ok daily=2026-10-10 eng=2026-10-10", "frescor/Mantova Móveis": "ok daily=2026-10-10 eng=2026-10-10",
		"frescor/Breno": "fail daily=2026-10-10 eng=2026-10-10", "frescor/Sem token": "fail daily=2026-10-10 eng=-",
		"bruto_seguidores/Vessel": "ok ultimo=2026-10-08", "bruto_seguidores/Mantova Móveis": "warn ultimo=2026-10-07",
		"bruto_seguidores/Breno": "warn ultimo=nunca", "bruto_seguidores/Sem token": "warn ultimo=nunca",
		"eng_likes0/Vessel": "fail p7", "eng_likes0/Mantova Móveis": "ok", "eng_likes0/Breno": "ok", // 50 interações não passa de "> 50"
		"aninhamento/Vessel": "ok likes 0/5/9", "aninhamento/Mantova Móveis": "fail likes 0/3/2", "aninhamento/Breno": "fail likes 1/0/0",
		"nav_soma/Vessel": "ok", "nav_soma/Mantova Móveis": "fail",
		"queda_seguidores/Vessel": "ok hoje=900 ontem=1000", "queda_seguidores/Mantova Móveis": "warn hoje=899 ontem=1000",
		"queda_seguidores/Breno": "warn hoje=750 ontem=1000", "queda_seguidores/Sem token": "fail hoje=749 ontem=1000",
		"alcance_vs_views/Vessel": "ok reach=105 views=100", "alcance_vs_views/Mantova Móveis": "ok reach=50 views=50",
		"alcance_vs_views/Breno":        "fail reach=0 views=10",
		"meta_spotcheck/Vessel":         "fail curtidas painel=0 vs Meta=100 · alcance painel=105 vs Meta=105",
		"meta_spotcheck/Mantova Móveis": "warn curtidas sem dado p/ comparar · alcance sem dado p/ comparar",
		"meta_spotcheck/Breno":          "warn curtidas sem dado p/ comparar · alcance sem dado p/ comparar",
		"meta_spotcheck/Sem token":      "warn curtidas sem dado p/ comparar · alcance sem dado p/ comparar",
	}
	got := estadoDosChecks(t, p)
	for k, v := range quer {
		if got[k] != v {
			t.Errorf("%s = %q, queria %q", k, got[k], v)
		}
	}
	for k, v := range got {
		if _, ok := quer[k]; !ok {
			t.Errorf("check a mais: %s = %q", k, v)
		}
	}
}

// Rodar de novo no mesmo dia regrava: nada duplica (inclusive o meta_spotcheck, que apaga o próprio
// antes) e os valores refletem a 2ª rodada.
func TestAuditoriaRodarDeNovoRegravaSemDuplicar(t *testing.T) {
	likes := 100
	a, p, _ := ambienteAuditoria(t, &likes)
	ctx := context.Background()
	if err := a.Rodar(ctx); err != nil {
		t.Fatal(err)
	}
	var antes int
	p.QueryRow(ctx, `select count(*) from data_integrity_checks`).Scan(&antes)
	likes = 0 // a Meta agora também diz 0: o painel (0) bate
	p.Exec(ctx, `update engagement_snapshots set likes = 0, total_interactions = 5 where account_id = 'aaaaaaaa-0000-0000-0000-0000000000a1' and period_days = 7`)
	if err := a.Rodar(ctx); err != nil {
		t.Fatal(err)
	}
	var depois, repetidos int
	p.QueryRow(ctx, `select count(*) from data_integrity_checks`).Scan(&depois)
	p.QueryRow(ctx, `select count(*) from (select 1 from data_integrity_checks group by check_name, account_id having count(*) > 1) x`).Scan(&repetidos)
	got := estadoDosChecks(t, p)
	// eng_likes0 da Vessel deixou de ser fail (5 interações) e o spot-check agora bate (Meta também diz 0)
	if depois != antes || repetidos != 0 || got["meta_spotcheck/Vessel"] != "ok curtidas painel=0 vs Meta=0 · alcance painel=105 vs Meta=105" ||
		got["eng_likes0/Vessel"] != "ok" {
		t.Fatalf("linhas antes=%d depois=%d repetidas=%d spot=%q eng_likes0=%q", antes, depois, repetidos, got["meta_spotcheck/Vessel"], got["eng_likes0/Vessel"])
	}
}

// run_integrity_checks é UMA transação: um check que quebra no meio desfaz o delete e os inserts dos outros.
func TestAuditoriaChecksNumaTransacaoSoDesfazTudoSeUmQuebra(t *testing.T) {
	likes := 100
	a, p, _ := ambienteAuditoria(t, &likes)
	ctx := context.Background()
	p.Exec(ctx, `insert into data_integrity_checks (checked_date, account_id, check_name, status, detail) values ('2026-10-10', 'aaaaaaaa-0000-0000-0000-0000000000a1', 'frescor', 'ok', 'antigo')`)
	if _, err := p.Exec(ctx, `alter table content_snapshots drop column story_nav_exit`); err != nil { // o nav_soma (5º check) passa a falhar
		t.Fatal(err)
	}
	err := a.Rodar(ctx)
	if err == nil || !strings.Contains(err.Error(), "run_integrity_checks") {
		t.Fatalf("o check quebrado é erro da tarefa: %v", err)
	}
	var antigos, novos int
	p.QueryRow(ctx, `select count(*) from data_integrity_checks where check_name = 'frescor' and detail = 'antigo'`).Scan(&antigos)
	p.QueryRow(ctx, `select count(*) from data_integrity_checks where check_name <> 'frescor' or detail <> 'antigo'`).Scan(&novos)
	if antigos != 1 || novos != 0 {
		t.Fatalf("a transação desfez tudo: frescor antigo=%d, linhas novas=%d", antigos, novos)
	}
}

// O aviso sai de verdade (corpo {text, content}) e a URL do webhook, que é segredo, não aparece no erro,
// no log nem nas linhas.
func TestAuditoriaWebhookEntregaOCorpoESemVazarAURL(t *testing.T) {
	likes := 100
	a, p, _ := ambienteAuditoria(t, &likes)
	var corpo []byte
	var metodo, tipo string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		corpo, _ = io.ReadAll(r.Body)
		metodo, tipo = r.Method, r.Header.Get("Content-Type")
	}))
	t.Cleanup(srv.Close)
	a.Alerta, a.HTTP = srv.URL+"/hook-secreto-789", srv.Client()
	log := capturarLog(t)
	if err := a.Rodar(context.Background()); err != nil {
		t.Fatal(err)
	}
	var m map[string]string
	if err := json.Unmarshal(corpo, &m); err != nil || metodo != "POST" || tipo != "application/json" {
		t.Fatalf("método=%s tipo=%s corpo=%s err=%v", metodo, tipo, corpo, err)
	}
	if m["content"] == "" || m["content"] != m["text"] || !strings.HasPrefix(m["content"], "Saúde dos dados (2026-10-10)\n\n🚨 ") {
		t.Fatalf("o Discord lê `content` e o Slack lê `text`: %v", m)
	}
	var linhas string
	p.QueryRow(context.Background(), `select string_agg(coalesce(detail, ''), ' ') from data_integrity_checks`).Scan(&linhas)
	if strings.Contains(log.String(), "hook-secreto") || strings.Contains(linhas, "hook-secreto") {
		t.Fatalf("a URL do webhook vazou: log=%s", log)
	}
}

func TestAvisarWebhookErrosSemAURL(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(500) }))
	t.Cleanup(srv.Close)
	ctx := context.Background()
	err := avisarWebhook(ctx, srv.Client(), srv.URL+"/hook-secreto-789", "x")
	if err == nil || err.Error() != "webhook de alerta respondeu 500" {
		t.Fatalf("err=%v", err)
	}
	if err := avisarWebhook(ctx, nil, "://hook-secreto-789 inválida", "x"); err == nil || strings.Contains(err.Error(), "secreto") {
		t.Fatalf("URL inválida: %v", err)
	}
	if err := avisarWebhook(ctx, nil, "", "x"); err != nil {
		t.Fatalf("sem webhook configurado não é erro: %v", err)
	}
	// 500 do webhook dentro da auditoria: só log, a auditoria termina bem e sem a URL.
	likes := 100
	a, _, _ := ambienteAuditoria(t, &likes)
	a.Alerta, a.HTTP = srv.URL+"/hook-secreto-789", srv.Client()
	log := capturarLog(t)
	if err := a.Rodar(ctx); err != nil {
		t.Fatalf("webhook fora é aviso: %v", err)
	}
	if !strings.Contains(log.String(), "webhook de alerta respondeu 500") || strings.Contains(log.String(), "hook-secreto") {
		t.Fatalf("log=%s", log)
	}
}
