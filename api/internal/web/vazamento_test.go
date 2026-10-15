package web

// Plano 07 do esforço REVISAO-TESTES-2026-10 (item B): sem vazamento de goroutine, de conexão nem de transação aberta
// quando a API leva carga real: rota de leitura, RPC (que abre transação), 401, 404, corpo inválido e cliente que
// DESISTE no meio do pedido (cancela o contexto e derruba a conexão). Por padrão roda 3 s; para o ensaio longo,
//
//	CARGA_VAZAMENTO=30m go test ./internal/web -run TestSemVazamentoSobCarga -timeout 40m
//
// (a medição de 30 min na VPS está no Resultado do plano 07; esta é a versão que fica na suíte).

import (
	"context"
	"io"
	"math/rand/v2"
	"net/http"
	"net/http/httptest"
	"os"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"
)

func goroutinesQuando(t *testing.T, ate int) int {
	t.Helper()
	var n int
	for fim := time.Now().Add(10 * time.Second); time.Now().Before(fim); time.Sleep(50 * time.Millisecond) {
		if n = runtime.NumGoroutine(); n <= ate {
			return n
		}
	}
	return n
}

func TestSemVazamentoSobCarga(t *testing.T) {
	p, h, sessoes, _, _ := mundoDaMatriz(t)
	tok := sessoes()[pSuper]
	srv := httptest.NewServer(h)
	cli := &http.Client{Transport: &http.Transport{}, Timeout: 5 * time.Second} // sem o teto, um vazamento de conexão travaria o teste em vez de reprová-lo
	dur := 3 * time.Second
	if v := os.Getenv("CARGA_VAZAMENTO"); v != "" {
		d, err := time.ParseDuration(v)
		if err != nil {
			t.Fatal(err)
		}
		dur = d
	}
	type pedido struct{ metodo, caminho, corpo, token string }
	pedidos := []pedido{
		{"GET", "/auth/eu", "", tok}, {"GET", "/comercial/lojas", "", tok}, {"GET", "/redes/contas", "", tok},
		{"POST", "/rpc/vessel_alertas", "{}", tok}, {"POST", "/rpc/vessel_agenda_das_lojas", "{}", tok}, // a 2ª dá 400 (parâmetro obrigatório)
		{"GET", "/nao-existe", "", tok}, {"GET", "/auth/eu", "", "token-que-nao-existe"}, {"POST", "/rpc/vessel_alertas", "{lixo", tok},
	}
	faz := func(pd pedido, ctx context.Context) {
		r, err := http.NewRequestWithContext(ctx, pd.metodo, srv.URL+pd.caminho, strings.NewReader(pd.corpo))
		if err != nil {
			t.Error(err)
			return
		}
		r.Header.Set("Authorization", "Bearer "+pd.token)
		if resp, err := cli.Do(r); err == nil {
			io.Copy(io.Discard, resp.Body)
			resp.Body.Close()
		}
	}
	for _, pd := range pedidos { // aquece: pool, cache de statements, conexões do cliente
		faz(pd, context.Background())
	}
	cli.CloseIdleConnections()
	time.Sleep(300 * time.Millisecond)
	antes := runtime.NumGoroutine()

	fim := time.Now().Add(dur)
	var wg sync.WaitGroup
	for range 16 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for time.Now().Before(fim) {
				pd := pedidos[rand.IntN(len(pedidos))]
				if rand.IntN(4) == 0 { // 1 em 4 desiste no meio: 1 a 5 ms
					ctx, cancela := context.WithTimeout(context.Background(), time.Duration(1+rand.IntN(5))*time.Millisecond)
					faz(pd, ctx)
					cancela()
				} else {
					faz(pd, context.Background())
				}
			}
		}()
	}
	wg.Wait()
	cli.CloseIdleConnections()
	srv.Close()

	// o que sobrar de goroutine do pool e do pgx é constante (estava em `antes`, com o servidor de teste de pé: sobra +2 dele)
	if depois := goroutinesQuando(t, antes); depois > antes {
		buf := make([]byte, 1<<16)
		t.Errorf("goroutines: %d antes, %d depois da carga\n%s", antes, depois, buf[:runtime.Stack(buf, true)])
	}
	if n := p.Stat().AcquiredConns(); n != 0 {
		t.Fatalf("%d conexões do pool ficaram emprestadas depois da carga", n) // Fatalf: a consulta abaixo precisaria de uma delas
	}
	var abertas int
	if err := p.QueryRow(context.Background(), `select count(*) from pg_stat_activity
		where datname = current_database() and pid <> pg_backend_pid() and state like 'idle in transaction%'`).Scan(&abertas); err != nil {
		t.Fatal(err)
	}
	if abertas != 0 {
		t.Errorf("%d transações ficaram abertas no banco depois da carga", abertas)
	}
}
