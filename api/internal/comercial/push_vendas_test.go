package comercial

import (
	"context"
	"crypto/ecdh"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
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

// Rodar de novo nunca reenvia: a mesma execução repetida (manual depois do cron, nova tentativa depois
// de queda, segunda instância) não manda o push outra vez; a chave leva a tarefa (modo) e o dia de referência.
func TestPushVendasRodarDeNovoNaoReenvia(t *testing.T) {
	pv, _, pf, p := ambientePush(t, pedidosPorDia)
	inscrever(t, p, "quer", "cccccccc-0000-0000-0000-000000000001")
	ctx := context.Background()
	if err := pv.Rodar(ctx, "hoje"); err != nil {
		t.Fatal(err)
	}
	if err := pv.Rodar(ctx, "hoje"); err != nil { // reexecução toda "repetida": não é falha
		t.Fatalf("repetição não pode ficar vermelha: %v", err)
	}
	if len(pf.recebidos) != 1 {
		t.Fatalf("a segunda execução do dia reenviou: %v", pf.recebidos)
	}
}

// O 22h do dia D e o 07h de D+1 têm o mesmo dia de referência (D): a chave do livro leva o modo, senão o
// push das 07h nunca sairia.
func TestPushVendas22hDoDiaDE07hDoDiaSeguinteSaemOsDois(t *testing.T) {
	pv, _, pf, p := ambientePush(t, pedidosPorDia)
	inscrever(t, p, "quer", "cccccccc-0000-0000-0000-000000000001")
	ctx := context.Background()
	if err := pv.Rodar(ctx, "hoje"); err != nil { // 22h de 09/10 (ref 09/10)
		t.Fatal(err)
	}
	pv.Agora = func() time.Time { return time.Date(2026, 10, 10, 10, 0, 0, 0, time.UTC) } // 07h de 10/10 (ref 09/10)
	if err := pv.Rodar(ctx, "ontem"); err != nil {
		t.Fatal(err)
	}
	if len(pf.recebidos) != 2 {
		t.Fatalf("22h e 07h deviam sair, saíram %d", len(pf.recebidos))
	}
	var chaves []string
	linhas, _ := p.Query(ctx, `select chave from envios_feitos order by chave`)
	for linhas.Next() {
		var c string
		linhas.Scan(&c)
		chaves = append(chaves, c)
	}
	if len(chaves) != 2 || !strings.HasPrefix(chaves[0], "enviar-push-vendas-07h:2026-10-09:") || !strings.HasPrefix(chaves[1], "enviar-push-vendas-22h:2026-10-09:") {
		t.Fatalf("chaves do livro: %v", chaves)
	}
	// e a repetição de cada um continua sem enviar
	if err := pv.Rodar(ctx, "ontem"); err != nil || len(pf.recebidos) != 2 {
		t.Fatalf("err=%v recebidos=%d", err, len(pf.recebidos))
	}
}

// Queda no meio do laço: quem já foi reservado (e o envio pode ter saído) não recebe de novo; quem falhou
// (serviço de push recusou) tem a reserva desfeita e a próxima execução tenta outra vez.
func TestPushVendasReexecucaoDepoisDeFalhaNoMeioDoLaco(t *testing.T) {
	pv, _, pf, p := ambientePush(t, pedidosPorDia)
	inscrever(t, p, "a/boa", "cccccccc-0000-0000-0000-000000000001")
	inscrever(t, p, "b/e500", "cccccccc-0000-0000-0000-000000000002")
	inscrever(t, p, "c/ja-reservada", "cccccccc-0000-0000-0000-000000000003")
	ctx := context.Background()
	h := sha256.Sum256([]byte("https://example.com/push/c/ja-reservada")) // reservada por uma execução que caiu
	if _, err := p.Exec(ctx, `insert into envios_feitos (chave) values ($1)`, "enviar-push-vendas-22h:2026-10-09:"+hex.EncodeToString(h[:8])); err != nil {
		t.Fatal(err)
	}
	if err := pv.Rodar(ctx, "hoje"); err != nil { // 1 aceito: o aparelho que recusou não derruba a tarefa
		t.Fatal(err)
	}
	if got := strings.Join(pf.recebidos, ","); got != "/push/a/boa,/push/b/e500" {
		t.Fatalf("primeira execução: %s", got)
	}
	// a/boa repetida (conta como entregue: a reexecução manual não fica vermelha), b/e500 tenta de novo
	// (reserva desfeita), c/ja-reservada nunca
	if err := pv.Rodar(ctx, "hoje"); err != nil {
		t.Fatalf("há quem já recebeu: %v", err)
	}
	if got := strings.Join(pf.recebidos, ","); got != "/push/a/boa,/push/b/e500,/push/b/e500" {
		t.Fatalf("segunda execução: %s", got)
	}
	// sem ninguém entregue (só o aparelho que recusa), é erro da tarefa
	p.Exec(ctx, `delete from push_subs where endpoint not like '%/b/e500'`)
	if err := pv.Rodar(ctx, "hoje"); err == nil || !strings.Contains(err.Error(), "nenhum_push_entregue") {
		t.Fatalf("só falha = erro: %v", err)
	}
}

// espelhoDoPush: o espelho do core com os pedidos de 08 e 09/10 (a mesma massa de pedidosPorDia) e os itens; conta as
// leituras e recusa por dia sem pedido.
// sincroniaDoPush: o `ultimo_ok` do espelho falso — 5 min antes do "agora" do ambientePush; os testes de defasagem o trocam.
var sincroniaDoPush = "2026-10-10T00:55:00Z"

func espelhoDoPush(t *testing.T, falha *atomic.Bool) (*core.Cliente, *atomic.Int32) {
	t.Helper()
	var n atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n.Add(1)
		if falha != nil && falha.Load() {
			w.WriteHeader(500)
			return
		}
		tabela := strings.TrimPrefix(r.URL.Path, "/api/interno/espelho/")
		contagem := strings.HasSuffix(tabela, "/contagem")
		tabela = strings.TrimSuffix(tabela, "/contagem")
		var linhas []map[string]any
		switch tabela {
		case "pedidos":
			if ids := r.URL.Query()["pedido_id_bling[]"]; len(ids) > 0 { // leitura por id (pedidos que entraram pela data da nota)
				linhas = []map[string]any{}
				for _, id := range ids {
					if id == "1" || id == "2" || id == "3" {
						linhas = append(linhas, map[string]any{"pedido_id_bling": id, "data": "2026-10-09", "total": 10})
					}
				}
				break
			}
			switch r.URL.Query().Get("data_de") {
			case "2026-10-09":
				linhas = []map[string]any{{"pedido_id_bling": "1", "data": "2026-10-09", "total": 100, "loja_id_bling": "205657609"}, {"pedido_id_bling": "2", "data": "2026-10-09", "total": 50, "loja_id_bling": "205657609"}}
			case "2026-10-08":
				linhas = []map[string]any{{"pedido_id_bling": "3", "data": "2026-10-08", "total": 70, "loja_id_bling": "205657609"}}
			default:
				linhas = []map[string]any{}
			}
		case "pedido_itens":
			linhas = []map[string]any{}
			for _, id := range r.URL.Query()["pedido_id_bling[]"] {
				for range map[string]int{"1": 1, "2": 2, "3": 3}[id] { // o pedido N tem N linhas
					linhas = append(linhas, map[string]any{"pedido_id_bling": id, "codigo": "X", "quantidade": 1, "valor": 1})
				}
			}
		}
		if contagem {
			json.NewEncoder(w).Encode(map[string]any{"linhas": len(linhas)})
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"data": linhas, "proximo_cursor": nil,
			"sincronia": map[string]any{"ultimo_ok": sincroniaDoPush, "atrasado": false}})
	}))
	t.Cleanup(srv.Close)
	cli := core.Novo(srv.URL, "tok")
	cli.Dormir = func(context.Context, time.Duration) error { return nil }
	return cli, &n
}

// Com `push=espelho` o push dispara SEM o Bling (que aqui devolveria 500 em tudo), com a quantidade de itens do espelho.
func TestPushVendasNoEspelhoNaoChamaOBling(t *testing.T) {
	pv, f, pf, p := ambientePush(t, func(core.PedidoBling, int) (int, string, map[string]string) { return 500, `{}`, nil })
	pv.Fonte = "push=espelho"
	pv.Core, _ = espelhoDoPush(t, nil)
	inscrever(t, p, "quer", "cccccccc-0000-0000-0000-000000000001")
	if err := pv.Rodar(context.Background(), "hoje"); err != nil {
		t.Fatal(err)
	}
	if f.n() != 0 {
		t.Fatalf("chamou o Bling %d vez(es)", f.n())
	}
	if len(pf.recebidos) != 1 {
		t.Fatalf("push não saiu: %v", pf.recebidos)
	}
}

// Espelho fora: a tarefa falha com `espelho_indisponivel` e NÃO envia nada (exatidão primeiro, como com o Bling).
func TestPushVendasEspelhoForaNaoEnvia(t *testing.T) {
	pv, _, pf, p := ambientePush(t, pedidosPorDia)
	pv.Fonte = "espelho"
	var fora atomic.Bool
	fora.Store(true)
	pv.Core, _ = espelhoDoPush(t, &fora)
	inscrever(t, p, "quer", "cccccccc-0000-0000-0000-000000000001")
	err := pv.Rodar(context.Background(), "hoje")
	if err == nil || !strings.Contains(err.Error(), "espelho_indisponivel") || len(pf.recebidos) != 0 {
		t.Fatalf("err=%v enviados=%v", err, pf.recebidos)
	}
}

// Sincronia parada às 15h: às 22h o espelho daria um total menor que o do dia. Não envia, e diz por quê.
func TestPushVendasEspelhoDefasadoNaoEnvia(t *testing.T) {
	sincroniaDoPush = "2026-10-09T18:00:00Z"
	t.Cleanup(func() { sincroniaDoPush = "2026-10-10T00:55:00Z" })
	pv, f, pf, p := ambientePush(t, pedidosPorDia)
	pv.Fonte = "push=espelho"
	pv.Core, _ = espelhoDoPush(t, nil)
	inscrever(t, p, "quer", "cccccccc-0000-0000-0000-000000000001")
	err := pv.Rodar(context.Background(), "hoje")
	if err == nil || !strings.Contains(err.Error(), "espelho_defasado") || len(pf.recebidos) != 0 || f.n() != 0 {
		t.Fatalf("err=%v enviados=%v bling=%d", err, pf.recebidos, f.n())
	}
}

func TestEspelhoServeAoPush(t *testing.T) {
	agora := time.Date(2026, 10, 10, 1, 0, 0, 0, time.UTC) // 22h de 09/10 em SP
	em := func(h, m int) *time.Time { x := time.Date(2026, 10, 10, h, m, 0, 0, time.UTC); return &x }
	ontem := time.Date(2026, 10, 9, 2, 0, 0, 0, time.UTC) // 23h de 08/10 em SP
	for nome, c := range map[string]struct {
		s   *core.Sincronia
		dia string
		ok  bool
	}{
		"fresca hoje":            {&core.Sincronia{UltimoOK: em(0, 50)}, "2026-10-09", true},
		"velha hoje":             {&core.Sincronia{UltimoOK: em(0, 20)}, "2026-10-09", false},
		"atrasada":               {&core.Sincronia{UltimoOK: em(0, 55), Atrasado: true}, "2026-10-09", false},
		"sem bloco":              {nil, "2026-10-09", false},
		"sem ultimo_ok":          {&core.Sincronia{}, "2026-10-09", false},
		"ontem depois da virada": {&core.Sincronia{UltimoOK: em(0, 5)}, "2026-10-08", true},
		"ontem antes da virada":  {&core.Sincronia{UltimoOK: &ontem}, "2026-10-08", false},
	} {
		if err := espelhoServeAoPush(c.s, agora, c.dia); (err == nil) != c.ok {
			t.Errorf("%s: err=%v", nome, err)
		}
	}
}

// Pedido que entrou pela data da nota (fora da lista do dia) ganha a contagem de itens do espelho, sem o Bling.
func TestPushVendasContaItensDeFora(t *testing.T) {
	pv, f, _, _ := ambientePush(t, pedidosPorDia)
	pv.Core, _ = espelhoDoPush(t, nil)
	cache := map[int64]int{1: 1}
	if err := pv.contarItensNoEspelho(context.Background(), []*pedido{{ID: 1}, {ID: 2}}, cache); err != nil || cache[2] != 2 {
		t.Fatalf("err=%v cache=%v", err, cache)
	}
	if err := pv.contarItensNoEspelho(context.Background(), []*pedido{{ID: 77}}, map[int64]int{}); err == nil || !strings.Contains(err.Error(), "fora do espelho") {
		t.Fatalf("err=%v", err)
	}
	if f.n() != 0 {
		t.Fatalf("chamou o Bling %d vez(es)", f.n())
	}
}
