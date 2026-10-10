package comercial

import (
	"context"
	"crypto/ecdh"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"encoding/base64"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/core"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
	"github.com/rbv-co/social-dashboard/api/internal/webpush"
)

const tabelasDoPush = `
create table bling_lojas (loja_id bigint primary key, nome text, grupo text, grupo_id uuid);
create table bling_pedido_nota (pedido_id bigint primary key, loja_id bigint, data_pedido date not null, total numeric(12,2),
  nota_situacao smallint, data_da_nota date, data_da_venda date generated always as (coalesce(data_da_nota, data_pedido)) stored);
create table bling_pedido_ajuste_valor (pedido_id bigint primary key, total_corrigido numeric(12,2) not null);
create table bling_pedido_vendedor (pedido_id bigint primary key, qtd_itens int);
create table push_subs (endpoint text primary key, p256dh text not null, auth text not null, user_id uuid);
create table push_preferencias (user_id uuid not null, tipo text not null, ativo boolean not null, primary key (user_id, tipo));
insert into bling_lojas values (205657609, 'Dom Pedro', null, null);
insert into bling_pedido_vendedor values (1, 3);
insert into bling_pedido_ajuste_valor values (1, 90);`

type pushFalso struct {
	mu        sync.Mutex
	recebidos []string // caminhos que receberam push
	corpos    map[string][]byte
}

// ambientePush: banco, core de mentira (pedidos por dia) e serviço de push em https://example.com.
func ambientePush(t *testing.T, resp func(core.PedidoBling, int) (int, string, map[string]string)) (*PushVendas, *coreFalso, *pushFalso, *pgxpool.Pool) {
	t.Helper()
	p := testebanco.Novo(t)
	if _, err := p.Exec(context.Background(), tabelasDoPush); err != nil {
		t.Fatal(err)
	}
	f := &coreFalso{resp: resp}
	srvCore := httptest.NewServer(f)
	t.Cleanup(srvCore.Close)
	cli := core.Novo(srvCore.URL, "token-do-core")
	cli.Prazo = 100 * time.Millisecond
	cli.Dormir = func(context.Context, time.Duration) error { return nil }

	pf := &pushFalso{}
	srvPush := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		pf.mu.Lock()
		pf.recebidos = append(pf.recebidos, r.URL.Path)
		if pf.corpos == nil {
			pf.corpos = map[string][]byte{}
		}
		pf.corpos[r.URL.Path], _ = io.ReadAll(r.Body)
		pf.mu.Unlock()
		for sufixo, st := range map[string]int{"/morta": 410, "/nf": 404, "/e500": 500, "/e503": 503, "/e429": 429, "/e403": 403} {
			if strings.HasSuffix(r.URL.Path, sufixo) {
				w.WriteHeader(st)
				return
			}
		}
		if strings.HasSuffix(r.URL.Path, "/rede") {
			c, _, _ := w.(http.Hijacker).Hijack()
			c.Close()
			return
		}
		w.WriteHeader(http.StatusCreated)
	}))
	t.Cleanup(srvPush.Close)
	hc := srvPush.Client()
	hc.Transport.(*http.Transport).DialContext = func(ctx context.Context, rede, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, rede, srvPush.Listener.Addr().String())
	}
	k, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	d, _ := k.Bytes()
	pub, _ := k.PublicKey.Bytes()
	v := webpush.VAPID{Publica: base64.RawURLEncoding.EncodeToString(pub), Privada: base64.RawURLEncoding.EncodeToString(d), Assunto: "mailto:t@exemplo.com"}
	// 2026-10-10 01:00 UTC = 2026-10-09 22:00 em São Paulo
	agora := func() time.Time { return time.Date(2026, 10, 10, 1, 0, 0, 0, time.UTC) }
	return &PushVendas{Pool: p, Core: cli, VAPID: v, HTTP: hc, Agora: agora}, f, pf, p
}

func inscrever(t *testing.T, p *pgxpool.Pool, caminho string, userID any) *ecdh.PrivateKey {
	t.Helper()
	ua, _ := ecdh.P256().GenerateKey(rand.Reader)
	if _, err := p.Exec(context.Background(), `insert into push_subs values ($1, $2, $3, $4)`, "https://example.com/push/"+caminho,
		base64.RawURLEncoding.EncodeToString(ua.PublicKey().Bytes()), base64.RawURLEncoding.EncodeToString(make([]byte, 16)), userID); err != nil {
		t.Fatal(err)
	}
	return ua
}

// pedidosPorDia: 09/10 tem o pedido 1 (Dom Pedro, total 100) e o 2 (sem cache de itens); 08/10, o 3.
func pedidosPorDia(p core.PedidoBling, _ int) (int, string, map[string]string) {
	switch {
	case p.Caminho == "/pedidos/vendas" && p.Query["dataInicial"] == "2026-10-09":
		return 200, `{"data":[{"id":1,"data":"2026-10-09","total":100,"loja":{"id":205657609}},{"id":2,"data":"2026-10-09","total":50,"loja":{"id":205657609}}]}`, nil
	case p.Caminho == "/pedidos/vendas" && p.Query["dataInicial"] == "2026-10-08":
		return 200, `{"data":[{"id":3,"data":"2026-10-08","total":70,"loja":{"id":205657609}}]}`, nil
	case p.Caminho == "/pedidos/vendas" && p.Query["dataInicial"] == "2026-10-07":
		return 200, `{"data":[]}`, nil
	case strings.HasPrefix(p.Caminho, "/pedidos/vendas/"):
		return 200, `{"data":{"id":0,"itens":[{},{}]}}`, nil
	}
	return 404, `{}`, nil
}

func TestPushVendasEnviaAQuemQuerEPodaMortas(t *testing.T) {
	pv, f, pf, p := ambientePush(t, pedidosPorDia)
	const quer, naoQuer, semPref = "cccccccc-0000-0000-0000-000000000001", "cccccccc-0000-0000-0000-000000000002", "cccccccc-0000-0000-0000-000000000003"
	inscrever(t, p, "quer", quer)
	inscrever(t, p, "nao-quer", naoQuer)
	inscrever(t, p, "sem-pref", semPref)
	inscrever(t, p, "sem-dono", nil)
	inscrever(t, p, "morta", semPref)
	p.Exec(context.Background(), `insert into push_preferencias values ($1, 'vendas', true), ($2, 'vendas', false)`, quer, naoQuer)
	if err := pv.Rodar(context.Background(), "hoje"); err != nil {
		t.Fatal(err)
	}
	got := strings.Join(pf.recebidos, ",")
	for _, c := range []string{"/push/quer", "/push/sem-pref", "/push/morta"} {
		if !strings.Contains(got, c) {
			t.Errorf("%s não recebeu (%s)", c, got)
		}
	}
	if strings.Contains(got, "nao-quer") || strings.Contains(got, "sem-dono") {
		t.Fatalf("recebeu quem não devia: %s", got)
	}
	var n int
	p.QueryRow(context.Background(), `select count(*) from push_subs where endpoint like '%/morta'`).Scan(&n)
	if n != 0 {
		t.Fatal("inscrição 410 deveria ser apagada")
	}
	// 22h: hoje (09/10) × ontem (08/10); detalhe só do que não está no cache (2 e 3).
	var dias, detalhes []string
	for _, ped := range f.pedidos {
		if ped.Caminho == "/pedidos/vendas" {
			dias = append(dias, ped.Query["dataInicial"].(string))
		} else {
			detalhes = append(detalhes, ped.Caminho)
		}
	}
	if strings.Join(dias, ",") != "2026-10-09,2026-10-08" || len(detalhes) != 2 {
		t.Fatalf("dias=%v detalhes=%v", dias, detalhes)
	}
}

func TestPushVendasModoOntem(t *testing.T) {
	pv, f, _, _ := ambientePush(t, pedidosPorDia)
	if err := pv.Rodar(context.Background(), "ontem"); err != nil {
		t.Fatal(err)
	}
	if f.pedidos[0].Query["dataInicial"] != "2026-10-08" || f.pedidos[1].Query["dataInicial"] != "2026-10-07" {
		t.Fatalf("07h deveria comparar ontem com anteontem: %v %v", f.pedidos[0].Query, f.pedidos[1].Query)
	}
}

func TestPushVendasNaoEnviaComDadoIncompleto(t *testing.T) {
	casos := map[string]func(core.PedidoBling, int) (int, string, map[string]string){
		"bling_indisponivel": func(core.PedidoBling, int) (int, string, map[string]string) { return 503, `{}`, nil },
		"itens_incompletos": func(p core.PedidoBling, n int) (int, string, map[string]string) {
			if strings.HasPrefix(p.Caminho, "/pedidos/vendas/") {
				return 500, `{}`, nil
			}
			return pedidosPorDia(p, n)
		},
	}
	for motivo, resp := range casos {
		pv, _, pf, p := ambientePush(t, resp)
		inscrever(t, p, "quer", "cccccccc-0000-0000-0000-000000000001")
		err := pv.Rodar(context.Background(), "hoje")
		if err == nil || !strings.Contains(err.Error(), motivo) || len(pf.recebidos) != 0 {
			t.Errorf("%s: err=%v pushes=%d", motivo, err, len(pf.recebidos))
		}
	}
	pv, _, _, _ := ambientePush(t, pedidosPorDia)
	pv.VAPID = webpush.VAPID{}
	if err := pv.Rodar(context.Background(), "hoje"); err == nil || !strings.Contains(err.Error(), "vapid") {
		t.Fatalf("sem VAPID: %v", err)
	}
}

func TestPushVendasInscricaoRuimNaoDerrubaAsOutras(t *testing.T) {
	pv, _, pf, p := ambientePush(t, pedidosPorDia)
	inscrever(t, p, "boa", "cccccccc-0000-0000-0000-000000000001")
	p.Exec(context.Background(), `insert into push_subs values ('https://example.com/push/ruim', 'nao-e-chave', 'x', 'cccccccc-0000-0000-0000-000000000002')`)
	if err := pv.Rodar(context.Background(), "hoje"); err != nil {
		t.Fatal(err)
	}
	if strings.Join(pf.recebidos, ",") != "/push/boa" {
		t.Fatalf("recebidos = %v", pf.recebidos)
	}
	var n int
	p.QueryRow(context.Background(), `select count(*) from push_subs where endpoint like '%/ruim'`).Scan(&n)
	if n != 1 {
		t.Fatal("inscrição malformada não pode ser apagada")
	}
}

func TestPushVendasAgendas(t *testing.T) {
	ts := (&PushVendas{}).Tarefas()
	if len(ts) != 2 || ts[0].Nome != "enviar-push-vendas-07h" || ts[0].Agenda != "0 10 * * *" || ts[1].Nome != "enviar-push-vendas-22h" || ts[1].Agenda != "0 1 * * *" {
		t.Fatalf("%+v", ts)
	}
}
