package meta

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/rbv-co/social-dashboard/api/internal/core"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

func f(v float64) *float64 { return &v }

func TestVereditoComoAEdge(t *testing.T) {
	for _, c := range []struct {
		painel, meta    *float64
		status, detalhe string
	}{
		{nil, f(10), "warn", "sem dado p/ comparar"},
		{f(10), nil, "warn", "sem dado p/ comparar"},
		{f(0), f(51), "fail", "painel=0 vs Meta=51"},
		{f(0), f(50), "fail", "painel=0 vs Meta=50"}, // div = 1 > 0,30
		{f(100), f(80), "warn", "painel=100 vs Meta=80 (25%)"},
		{f(100), f(70), "fail", "painel=100 vs Meta=70"},
		{f(12.5), f(10), "warn", "painel=12.5 vs Meta=10 (25%)"},
		{f(100), f(120), "warn", "painel=100 vs Meta=120 (17%)"},
		{f(100), f(110), "ok", "painel=100 vs Meta=110"},
	} {
		if st, d := veredito(c.painel, c.meta); st != c.status || d != c.detalhe {
			t.Errorf("%v × %v = %s %q", c.painel, c.meta, st, d)
		}
	}
}

func TestAuditoriaChecksSpotcheckEAviso(t *testing.T) {
	p := testebanco.Novo(t)
	ctx := context.Background()
	if _, err := p.Exec(ctx, tabelasColeta); err != nil {
		t.Fatal(err)
	}
	for _, sql := range []string{
		`insert into daily_snapshots values ('` + contaA1 + `', '2026-10-07', 1000, 5, 1), ('` + contaA1 + `', '2026-10-09', 1000, 0, 0),
			('` + contaA1 + `', '2026-10-10', 700, 0, 0)`,
		`insert into engagement_snapshots (account_id, captured_at, period_days, likes, reach, views, total_interactions) values
			('` + contaA1 + `', '2026-10-10', 7, 100, 1000, 1200, 120), ('` + contaA1 + `', '2026-10-10', 14, 90, 900, 1100, 100),
			('` + contaA1 + `', '2026-10-10', 30, 200, 2000, 2500, 230)`,
		`insert into content_snapshots (account_id, captured_at, period_days, posts_count) values ('` + contaA1 + `', '2026-10-10', 0, 1)`,
		// recados que o coletar-dados deixou no dia: NÃO podem ser apagados pela auditoria
		`insert into data_integrity_checks (checked_date, account_id, check_name, status, detail) values
			('2026-10-10', '` + contaA1 + `', 'bruto_seguidores_parado', 'fail', 'Vessel: parou'),
			('2026-10-10', null, 'coleta_zerada', 'fail', 'Breno 0d'),
			('2026-10-10', '` + contaA1 + `', 'frescor', 'fail', 'velho')`,
	} {
		if _, err := p.Exec(ctx, sql); err != nil {
			t.Fatal(err)
		}
	}
	cli, f := coreDeTeste(t, func(pd core.PedidoMeta) (int, string, map[string]string) {
		if pd.Caminho == "/1784/insights" {
			return 200, `{"data":[{"name":"likes","total_value":{"value":120}},{"name":"reach","total_value":{"value":1000}}]}`, nil
		}
		return 400, `{"error":{"message":"conta sem acesso"}}`, nil
	})
	var recebido string
	alerta := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		var m map[string]string
		json.Unmarshal(b, &m)
		recebido = m["text"]
	}))
	t.Cleanup(alerta.Close)
	a := &Auditoria{Pool: p, Core: cli, Alerta: alerta.URL + "/hook-secreto", Agora: func() time.Time { return agoraColeta }}
	if err := a.Rodar(ctx); err != nil {
		t.Fatal(err)
	}
	estado := func(check string) string {
		var s string
		p.QueryRow(ctx, `select status || ' ' || coalesce(detail, '') from data_integrity_checks where check_name = $1 and account_id = $2::uuid`, check, contaA1).Scan(&s)
		return s
	}
	for check, quer := range map[string]string{
		"frescor":          "ok daily=2026-10-10 eng=2026-10-10",
		"bruto_seguidores": "warn ultimo=2026-10-07",
		"aninhamento":      "fail likes 100/90/200",
		"queda_seguidores": "fail hoje=700 ontem=1000",
		"alcance_vs_views": "ok reach=1000 views=1200",
		"meta_spotcheck":   "warn curtidas painel=100 vs Meta=120 (17%) · alcance painel=1000 vs Meta=1000",
	} {
		if got := estado(check); got != quer {
			t.Errorf("%s = %q, esperava %q", check, got, quer)
		}
	}
	var n int
	p.QueryRow(ctx, `select count(*) from data_integrity_checks where check_name in ('bruto_seguidores_parado', 'coleta_zerada')`).Scan(&n)
	if n != 2 {
		t.Fatalf("os recados do coletar-dados sumiram: %d", n)
	}
	if !strings.HasPrefix(recebido, "Saúde dos dados (2026-10-10)\n\n🚨 ") || !strings.Contains(recebido, "• ? · coleta_zerada (Breno 0d)") ||
		!strings.Contains(recebido, "• Vessel · bruto_seguidores_parado (Vessel: parou)") || !strings.Contains(recebido, "⚠️ ") {
		t.Fatalf("aviso = %q", recebido)
	}
	for _, pd := range f.lista() {
		if pd.Caminho == "//insights" || strings.Contains(pd.Caminho, "null") {
			t.Fatalf("conta sem instagram_id não vira pedido: %+v", pd)
		}
	}
}

func TestAuditoriaSemSnapshotsEErro(t *testing.T) {
	p := testebanco.Novo(t)
	p.Exec(context.Background(), tabelasColeta)
	cli, _ := coreDeTeste(t, graphOK(`{}`))
	if err := (&Auditoria{Pool: p, Core: cli}).Rodar(context.Background()); err == nil || err.Error() != "sem snapshots" {
		t.Fatalf("err=%v", err)
	}
	if tf := (&Auditoria{}).Tarefa(); tf.Nome != "auditar-dados" || tf.Agenda != "30 2 * * *" {
		t.Fatalf("%+v", tf)
	}
}

func TestAvisarWebhookNaoVazaAURL(t *testing.T) {
	err := avisarWebhook(context.Background(), &http.Client{Timeout: time.Second}, "http://127.0.0.1:1/hook-secreto-123", "x")
	if err == nil || strings.Contains(err.Error(), "hook-secreto-123") {
		t.Fatalf("err=%v", err)
	}
}
