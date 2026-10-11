package core

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

// naoVaza: o erro devolvido não leva o host, a porta, o caminho do core nem o token.
func naoVaza(t *testing.T, saida, alvo string) {
	t.Helper()
	u, err := url.Parse(alvo)
	if err != nil {
		t.Fatal(err)
	}
	for _, proibido := range []string{u.Host, u.Hostname(), u.Port(), "/api/interno", "api/interno", "bling/proxy", "meta/graph", tokenDeTeste, "dial tcp", "Post "} {
		if proibido != "" && strings.Contains(saida, proibido) {
			t.Fatalf("%q vazou em %q", proibido, saida)
		}
	}
}

// servidorLento responde depois do prazo de qualquer teste (e volta logo, para o Close não esperar).
func servidorLento() *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, _ *http.Request) { time.Sleep(300 * time.Millisecond) }))
}

func portaFechada(t *testing.T) string {
	t.Helper()
	srv := httptest.NewServer(http.NotFoundHandler())
	srv.Close()
	return srv.URL
}

func TestFalhaDeTransporteTemMensagemFixaSemEndereco(t *testing.T) {
	tls := httptest.NewTLSServer(http.NotFoundHandler()) // certificado de uma CA que o cliente não conhece
	defer tls.Close()
	lento := servidorLento()
	defer lento.Close()
	casos := []struct {
		nome, url, quer string
		prazo           time.Duration
	}{
		{"conexão recusada", portaFechada(t), "core: conexão recusada", time.Second},
		{"prazo vencido", lento.URL, "core: prazo vencido", 50 * time.Millisecond},
		{"TLS", tls.URL, "core: TLS", time.Second},
		{"DNS", "http://core-que-nao-existe.invalid:4433", "core: DNS", time.Second},
	}
	for _, k := range casos {
		t.Run(k.nome, func(t *testing.T) {
			c := Novo(k.url, tokenDeTeste)
			ctx, cancela := context.WithTimeout(context.Background(), k.prazo)
			defer cancela()
			_, err := c.Meta(ctx, PedidoMeta{Caminho: "/me", Metodo: "GET"}, 1)
			if err == nil || err.Error() != k.quer {
				t.Fatalf("Meta: err = %v, quer %q", err, k.quer)
			}
			naoVaza(t, err.Error(), k.url)
			var ue *url.Error
			if errors.As(err, &ue) {
				t.Fatal("o *url.Error continua na cadeia")
			}
			// Bling: mesma classe na causa não existe (a frase de gente fica), mas nada vaza.
			c.Prazo = k.prazo
			c.Dormir = func(context.Context, time.Duration) error { return nil }
			_, err = c.Bling(context.Background(), leitura)
			var sr *SemResposta
			if !errors.As(err, &sr) {
				t.Fatalf("Bling: err = %v", err)
			}
			naoVaza(t, err.Error(), k.url)
		})
	}
}

func TestPrazoEhDeadlineExceededECancelaEhCanceled(t *testing.T) {
	lento := servidorLento()
	defer lento.Close()
	c := Novo(lento.URL, tokenDeTeste)
	ctx, cancela := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancela()
	_, err := c.Meta(ctx, PedidoMeta{Caminho: "/me", Metodo: "GET"}, 1)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("deadline: %v", err)
	}
	ctx2, cancela2 := context.WithCancel(context.Background())
	go func() { time.Sleep(50 * time.Millisecond); cancela2() }()
	_, err = c.Meta(ctx2, PedidoMeta{Caminho: "/me", Metodo: "GET"}, 1)
	if !errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("cancelado: %v", err)
	}
	naoVaza(t, err.Error(), lento.URL)
}

func TestTimeoutDoClienteHTTPEhPrazoVencido(t *testing.T) {
	lento := servidorLento()
	defer lento.Close()
	c := Novo(lento.URL, tokenDeTeste)
	c.HTTP.Timeout = 50 * time.Millisecond
	_, err := c.Meta(context.Background(), PedidoMeta{Caminho: "/me", Metodo: "GET"}, 1)
	if err == nil || err.Error() != "core: prazo vencido" {
		t.Fatalf("err = %v", err)
	}
	naoVaza(t, err.Error(), lento.URL)
}

// Corpo cortado no meio: erro de leitura, sem endereço, classe "rede".
func TestCorpoCortadoEhRedeSemEndereco(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Length", "100")
		w.Write([]byte("abc"))
		w.(http.Flusher).Flush()
		panic(http.ErrAbortHandler)
	}))
	defer srv.Close()
	c := Novo(srv.URL, tokenDeTeste)
	_, err := c.Meta(context.Background(), PedidoMeta{Caminho: "/me", Metodo: "GET"}, 1)
	if err == nil || err.Error() != "core: rede" {
		t.Fatalf("err = %v", err)
	}
	naoVaza(t, err.Error(), srv.URL)
}

func TestURLDoCoreInvalidaNaoVazaNoErro(t *testing.T) {
	c := Novo("http://usuario:senha-do-core@host ruim", tokenDeTeste)
	_, err := c.Meta(context.Background(), PedidoMeta{Caminho: "/me", Metodo: "GET"}, 1)
	if err == nil || strings.Contains(err.Error(), "senha-do-core") || strings.Contains(err.Error(), "host ruim") {
		t.Fatalf("err = %v", err)
	}
}

// A causa só vai ao slog.Debug, como classe e operação: sem host, porta, caminho nem token.
func TestFalhaDeTransporteLogaSoClasseEOperacao(t *testing.T) {
	var log bytes.Buffer
	antes := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&log, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() { slog.SetDefault(antes) })
	alvo := portaFechada(t)
	c := Novo(alvo, tokenDeTeste)
	c.Dormir = func(context.Context, time.Duration) error { return nil }
	c.Meta(context.Background(), PedidoMeta{Caminho: "/me", Metodo: "GET"}, 1)
	c.Bling(context.Background(), leitura)
	l := log.String()
	if !strings.Contains(l, "level=DEBUG") || !strings.Contains(l, "conexão recusada") || !strings.Contains(l, "op=meta") || !strings.Contains(l, "op=bling") {
		t.Fatalf("log sem classe e operação: %q", l)
	}
	naoVaza(t, l, alvo)
	if _, _, err := net.SplitHostPort(strings.TrimPrefix(alvo, "http://")); err != nil {
		t.Fatal(err)
	}
}

// A política de repetição não muda: sem resposta no Bling repete 3 vezes; na Meta não repete.
func TestRepeticaoComTransportePermanece(t *testing.T) {
	c := Novo(portaFechada(t), tokenDeTeste)
	esperas := 0
	c.Dormir = func(context.Context, time.Duration) error { esperas++; return nil }
	_, err := c.Bling(context.Background(), leitura)
	var sr *SemResposta
	if !errors.As(err, &sr) || sr.Tentativas != 3 || esperas != 2 {
		t.Fatalf("Bling: err=%v esperas=%d", err, esperas)
	}
	esperas = 0
	if _, err := c.Meta(context.Background(), PedidoMeta{Caminho: "/me", Metodo: "GET"}, 5); err == nil || esperas != 0 {
		t.Fatalf("Meta não repete rede: err=%v esperas=%d", err, esperas)
	}
}
